/*
 * Pumping Iron's Discord service: a Cloudflare Worker (free plan) that reads
 * each user's Torn timers once a minute and pings them in Discord (a DM
 * from the bot, or their own channel webhook) when a step is due, and
 * answers the bot's slash commands. It never acts in Torn; it only reads
 * through the API with each user's own custom key, stored encrypted
 * (KEY_ENC). Setup: worker/SETUP.md. What's built: worker/BOT.md.
 *
 * Routes:
 *   GET  /health          → {ok}
 *   PUT  /plan            (Authorization: Bearer <secret>) store {tornKey?, discordId, webhookUrl, plan, rules?, rulesAt?,
 *                         targets?, war?, watch?, factionId?, playerId?, ackIds?}; answers {ready, paused, lastError, linked, bot, acks,
 *                         tornRead, delivery, kinds, kindsSet}
 *                         the first PUT for a secret needs X-Invite: <INVITE_CODE> (or a finished Discord login)
 *   POST /test            (Authorization: Bearer <secret>) send a test ping (the DM is always tried); answers {ok, via, dmRefused?},
 *                         or why nothing arrived: {ok: false, reason: dm_refused (409) | discord_error (502) | no_route (400), error}
 *   DELETE /plan          (Authorization: Bearer <secret>) forget this user
 *   POST /link            (Authorization: Bearer <secret>) a one-time code for /link in Discord (10 min)
 *   POST /login/start     (Authorization: Bearer <secret>) → {id, url, expiresAt}: "Log in with Discord" (login.js)
 *   POST /login/status    (Authorization: Bearer <secret>) {id} → {state, name}
 *   POST /login/cancel    (Authorization: Bearer <secret>) {id}: that login is dropped (Discord's page then does nothing)
 *   GET  /login?id=…      → Discord's authorize page; GET /login/callback: Discord sends the browser back here
 *   POST /interactions    Discord's slash commands and buttons (Ed25519-signed)
 */

import { isDiscordWebhook, LINKS } from './alerts.js';
import { runCron, sendAlerts } from './cron.js';
import { canDeliver, hookUrl, deliveryState } from './deliver.js';
import { settingsOf, kindsOn, cleanRules, settleKinds, kindsSet } from './settings.js';
import { pendingAcks } from './buttons.js';
import { sealKey, openKey, isSealed } from './keys.js';
import { cleanTargets, cleanWarList, cleanWatch } from './cmd-torn.js';
import { loginStart, loginStatus, loginCancel, loginGo, loginCallback } from './login.js';

/** A 48-step plan + 50 targets + 500 bands + a 100-member war list + 25 watched players is under 40 kB. */
export const MAX_BODY = 64000;

/** People one Worker serves (a leaked invite can't fill it); MAX_USERS in wrangler.toml [vars] changes it. */
export const DEFAULT_MAX_USERS = 10;
import { Q, SCHEMA, parse, ensureSchema, ackDeleteMany, forgetUser, MAX_ACK_IDS } from './db.js';
import { tornReadOf } from './torn.js';
import { guard, readLimited } from './net.js';
import { interactionsRoute } from './interactions.js';
import { newLinkCode, saveSettings } from './cmd-core.js';

export { SCHEMA };

export { TORN_URL, DEAD_KEY_CODES } from './torn.js';
export { runUser, runCron } from './cron.js';

async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// No CORS headers: the userscript talks to the Worker through Tampermonkey, not from a web page.
function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Compare two strings without an early exit (the invite code). */
async function sameSecret(a, b) {
    const [x, y] = await Promise.all([sha256(String(a || '')), sha256(String(b || ''))]);
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
    return diff === 0 && Boolean(a);
}

function bearer(req) {
    const m = String(req.headers.get('authorization') || '').match(/^Bearer\s+([A-Za-z0-9_-]{24,128})$/);
    return m ? m[1] : null;
}

async function userFor(req, env) {
    const secret = bearer(req);
    if (!secret) return { error: json({ ok: false, error: 'Missing or malformed secret' }, 401) };
    const id = await sha256(secret);
    const row = await env.DB.prepare(Q.userGet).bind(id).first();
    return { id, row };
}

/** People this Worker serves (MAX_USERS in [vars], else 10). */
export const maxUsers = (env) => (Number(env.MAX_USERS) > 0 ? Number(env.MAX_USERS) : DEFAULT_MAX_USERS);

async function putPlan(req, env) {
    const { id, row, error } = await userFor(req, env);
    if (error) return error;
    // A row made by "Log in with Discord" needs no invite: the login checked the server membership.
    if (!row && !(env.INVITE_CODE && (await sameSecret(req.headers.get('x-invite'), env.INVITE_CODE)))) return json({ ok: false, error: 'Unknown secret: log in with Discord first (or the first sync needs the invite code)' }, 403);
    if (!row) {
        const max = maxUsers(env);
        const n = await env.DB.prepare(Q.usersCount).first();
        if (Number(n && n.n) >= max) return json({ ok: false, error: 'This Worker is full (' + max + ' people). Ask its owner, or deploy your own (SETUP.md).' }, 403);
    }
    let body;
    // Bytes, not characters; a declared length over the limit is refused unread.
    const text = await readLimited(req, MAX_BODY);
    if (text === null) return json({ ok: false, error: 'Too much data in one sync' }, 413);
    try {
        body = JSON.parse(text);
        if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('not an object');
    } catch {
        return json({ ok: false, error: 'Body is not JSON' }, 400);
    }
    const webhook = body.webhookUrl !== undefined ? String(body.webhookUrl || '') : row ? row.webhook : '';
    if (webhook && !isDiscordWebhook(webhook)) return json({ ok: false, error: 'That is not a Discord webhook URL' }, 400);
    // Kept on discord.com: the Worker calls no other host.
    const hook = webhook && body.webhookUrl !== undefined ? hookUrl(webhook) : webhook;
    const sentKey = body.tornKey !== undefined ? String(body.tornKey || '') : null;
    if (sentKey && !/^[A-Za-z0-9]{16}$/.test(sentKey)) return json({ ok: false, error: 'A Torn key is 16 letters and numbers' }, 400);
    // Keys are stored sealed (AES-GCM, KEY_ENC); the old one is opened only to see if this is a new key.
    let oldKey = '';
    try {
        oldKey = row && row.torn_key ? (await openKey(row.torn_key, env, id)).key : '';
    } catch {
        oldKey = '';
    }
    let tornKey = row ? row.torn_key || '' : '';
    if (sentKey !== null && sentKey !== oldKey) {
        try {
            tornKey = sentKey ? await sealKey(sentKey, env, id) : '';
        } catch (e) {
            return json({ ok: false, error: String(e.message) }, 500);
        }
    } else if (tornKey && oldKey && !isSealed(tornKey) && env.KEY_ENC) {
        // A plain key stored by 1.0 (even when the same key is sent again): sealed now.
        tornKey = await sealKey(oldKey, env, id);
    }
    // A Discord id linked with /link (signed by Discord) wins over one typed in Settings.
    const linked = Boolean(row && Number(row.linked));
    const discordId = !linked && body.discordId !== undefined ? String(body.discordId || '').replace(/\D/g, '') : row ? row.discord_id : '';
    const plan = body.plan !== undefined ? JSON.stringify(body.plan || null) : row ? row.plan : 'null';
    // The ping ticks (Settings › Discord pings in the userscript): known kinds, true or false.
    const rules = body.rules !== undefined ? JSON.stringify(cleanRules(body.rules)) : row ? row.rules : '{}';
    // A pause for a dead key stays until a new key is sent (plan syncs alone must not undo it).
    const newKey = sentKey !== null && (!row || sentKey !== oldKey);
    const paused = newKey ? 0 : row ? Number(row.paused) || 0 : 0;
    const lastError = newKey ? null : row ? row.last_error || null : null;
    const nowS = Math.floor(Date.now() / 1000);
    const planAt = body.plan !== undefined ? nowS : row ? row.plan_at || null : null;
    // Torn Eye's list, and whose faction the war commands look at (from the userscript).
    const cleaned = body.targets !== undefined ? cleanTargets(body.targets, nowS) : undefined;
    const targets = cleaned !== undefined ? (cleaned ? JSON.stringify(cleaned) : null) : row ? row.targets || null : null;
    const idOrKeep = (v, old) => (v === undefined ? old || null : Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
    const factionId = idOrKeep(body.factionId, row && row.faction_id);
    const playerId = idOrKeep(body.playerId, row && row.player_id);
    // The enemy faction as Torn Eye sees it, and the watch list: left out keeps them, null clears.
    const listOrKeep = (v, clean, old) => (v === undefined ? old || null : ((c) => (c ? JSON.stringify(c) : null))(clean(v, nowS)));
    const warList = listOrKeep(body.war, cleanWarList, row && row.war_list);
    const watchList = listOrKeep(body.watch, cleanWatch, row && row.watch_list);
    if (row) await env.DB.prepare(Q.userSync).bind(tornKey, discordId, hook, plan, rules, paused, lastError, nowS, planAt, targets, factionId, playerId, warList, watchList, id).run();
    else await env.DB.prepare(Q.userInsert).bind(id, tornKey, discordId, hook, plan, rules, paused, lastError, nowS, planAt, targets, factionId, playerId, warList, watchList).run();
    // A new key: what the old one could not read (travel) and its failed reads are forgotten; the next minute asks afresh.
    let prevText = row ? row.prev || null : null;
    const mem = newKey && prevText ? parse(prevText, null) : null;
    if (mem && (mem.noTravel || mem.fail)) {
        for (const k of ['noTravel', 'noTravelAt', 'fail']) delete mem[k];
        prevText = JSON.stringify(mem);
        await env.DB.prepare(Q.userRan).bind(Number(row.ran) || 0, prevText, row.war || null, id).run();
    }
    // The latest change wins: a /settings kind change in Discord gives way once the ticks have seen it (settleKinds).
    const after = { ...(row || {}), id, torn_key: tornKey, discord_id: discordId, webhook: hook, rules };
    const st = settingsOf(after);
    if (row && body.rules !== undefined && settleKinds(st, body.rulesAt)) await saveSettings(env, after, st);
    // Acks (Done / Skip in Discord): the userscript says which it applied; the rest go back to it.
    const ackIds = Array.isArray(body.ackIds) ? body.ackIds.filter((a) => typeof a === 'string' && a.length <= 120).slice(0, MAX_ACK_IDS) : [];
    if (ackIds.length) await env.DB.prepare(ackDeleteMany(ackIds.length)).bind(id, ...ackIds).run();
    const acks = await pendingAcks(env.DB, id);
    return json({
        ok: true,
        created: !row,
        acks,
        ready: Boolean(tornKey && (webhook || (linked && env.BOT_TOKEN))),
        paused: Boolean(paused),
        lastError,
        linked,
        bot: Boolean(env.BOT_TOKEN && env.DISCORD_PUBLIC_KEY),
        // The Worker's own read of Torn (cron.js): is it working, since when not, can the key read travel.
        tornRead: tornReadOf(prevText),
        // Where pings go now, and why not when nothing can arrive (deliver.js).
        delivery: deliveryState(env, after),
        // Which ping kinds are on (this build's kinds: a browser that sees no `nerve` here knows the service is older),
        // and the /settings changes made in Discord that its ticks have not taken over yet.
        kinds: kindsOn(after),
        kindsSet: kindsSet(st),
    });
}

async function linkCode(req, env) {
    const { id, row, error } = await userFor(req, env);
    if (error) return error;
    if (!row) return json({ ok: false, error: 'Unknown secret: connect first' }, 403);
    const { code, expiresAt } = await newLinkCode(env, id, Math.floor(Date.now() / 1000));
    return json({ ok: true, code, expiresAt, command: '/link ' + code });
}

async function testPing(req, env, fetchImpl) {
    const { row, error } = await userFor(req, env);
    if (error) return error;
    if (!row) return json({ ok: false, error: 'Unknown secret' }, 403);
    if (!canDeliver(env, row)) return json({ ok: false, reason: 'no_route', error: TEST_WORDS.no_route }, 400);
    const nowS = Math.floor(Date.now() / 1000);
    // A step of kind "test": its Skip button can be tried; the userscript ignores that ack.
    const alert = { id: 'test:' + nowS, kind: 'test', link: LINKS.items, title: 'Test ping from Pumping Iron', text: 'Pings will look like this: "Drug cooldown ends in 5 min · Xanax #2, then DEX × 27".', step: { at: nowS + 300, kind: 'test', label: 'Test step' } };
    // The DM is always tried, also inside the 6-hour rest after a refused one: the player has just changed
    // something in Discord and wants to know if it worked (a DM that arrives ends the rest).
    const { sent, last } = await sendAlerts(env, guard(fetchImpl), env.DB, row, [alert], nowS, { force: true });
    const d = last || {};
    if (sent > 0) return json({ ok: true, via: d.via || null, ...(d.dmRefused ? { dmRefused: true } : {}) });
    // Why nothing arrived, for the browser to say in words: `reason` for the script, `error` for a person.
    if (d.why === 'dm_refused') return json({ ok: false, reason: 'dm_refused', error: TEST_WORDS.dm_refused }, 409);
    if (d.why === 'no_route') return json({ ok: false, reason: 'no_route', error: TEST_WORDS.no_route }, 400);
    const status = Number(d.status) || null;
    return json({ ok: false, reason: 'discord_error', error: 'Discord answered an error' + (status ? ' (' + status + ')' : '') + '. Try again in a minute.', discordStatus: status, discordCode: d.code === undefined ? null : d.code, ...(d.dmRefused ? { dmRefused: true } : {}) }, 502);
}

/** What a failed test ping says (an older userscript shows `error` as it is). */
export const TEST_WORDS = {
    dm_refused: 'Discord refused the bot’s DM. In Discord, open the server the bot is in, click the server name, then Privacy Settings, and turn Direct Messages on. Then send a test ping again.',
    no_route: 'Nothing to deliver through: no Discord account is linked and no channel webhook is saved.',
};

async function forget(req, env) {
    const { id, error } = await userFor(req, env);
    if (error) return error;
    await forgetUser(env.DB, id);
    return json({ ok: true });
}

/** Routes that only need the browser's secret (its user row may not exist yet). */
async function withUser(req, env, h) {
    const secret = bearer(req);
    if (!secret) return json({ ok: false, error: 'Missing or malformed secret' }, 401);
    return h(req, env, await sha256(secret));
}

const NO_CTX = { waitUntil: () => {} };

export async function handle(req, env, fetchImpl = fetch, ctx = NO_CTX) {
    const url = new URL(req.url);
    if (url.pathname === '/health' && req.method === 'GET') return json({ ok: true });
    if (url.pathname === '/interactions' && req.method === 'POST') return interactionsRoute(req, env, guard(fetchImpl), ctx);
    await ensureSchema(env.DB);
    if (url.pathname === '/plan' && req.method === 'PUT') return putPlan(req, env);
    if (url.pathname === '/plan' && req.method === 'DELETE') return forget(req, env);
    if (url.pathname === '/test' && req.method === 'POST') return testPing(req, env, fetchImpl);
    if (url.pathname === '/link' && req.method === 'POST') return linkCode(req, env);
    if (url.pathname === '/login/start' && req.method === 'POST') return withUser(req, env, loginStart);
    if (url.pathname === '/login/status' && req.method === 'POST') return withUser(req, env, loginStatus);
    if (url.pathname === '/login/cancel' && req.method === 'POST') return withUser(req, env, loginCancel);
    if (url.pathname === '/login' && req.method === 'GET') return loginGo(req, env);
    if (url.pathname === '/login/callback' && req.method === 'GET') return loginCallback(req, env, guard(fetchImpl), { maxUsers: maxUsers(env) });
    return json({ ok: false, error: 'Not found' }, 404);
}

export default {
    fetch: (req, env, ctx) => handle(req, env, fetch, ctx),
    scheduled: (event, env, ctx) => ctx.waitUntil(runCron(env)),
};
