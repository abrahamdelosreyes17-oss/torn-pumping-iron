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
 *   PUT  /plan            (Authorization: Bearer <secret>) store {tornKey?, discordId, webhookUrl, plan, rules,
 *                         targets?, factionId?, playerId?, ackIds?}; answers {ready, paused, lastError, linked, bot, acks}
 *                         the first PUT for a secret needs X-Invite: <INVITE_CODE>
 *   POST /test            (Authorization: Bearer <secret>) send a test ping
 *   DELETE /plan          (Authorization: Bearer <secret>) forget this user
 *   POST /link            (Authorization: Bearer <secret>) a one-time code for /link in Discord (10 min)
 *   POST /interactions    Discord's slash commands and buttons (Ed25519-signed)
 */

import { isDiscordWebhook, LINKS } from './alerts.js';
import { runCron, sendAlerts } from './cron.js';
import { canDeliver, hookUrl } from './deliver.js';
import { pendingAcks } from './buttons.js';
import { sealKey, openKey } from './keys.js';
import { cleanTargets } from './cmd-torn.js';

/** A plan, its targets and bands fit easily in this. */
const MAX_BODY = 100000;
import { Q, SCHEMA, ensureSchema } from './db.js';
import { guard } from './net.js';
import { interactionsRoute } from './interactions.js';
import { newLinkCode } from './cmd-core.js';

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

async function putPlan(req, env) {
    const { id, row, error } = await userFor(req, env);
    if (error) return error;
    if (!row && !(env.INVITE_CODE && (await sameSecret(req.headers.get('x-invite'), env.INVITE_CODE)))) return json({ ok: false, error: 'Unknown secret: the first sync needs the invite code' }, 403);
    let body;
    const text = await req.text();
    if (text.length > MAX_BODY) return json({ ok: false, error: 'Too much data in one sync' }, 413);
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
    }
    // A Discord id linked with /link (signed by Discord) wins over one typed in Settings.
    const linked = Boolean(row && Number(row.linked));
    const discordId = !linked && body.discordId !== undefined ? String(body.discordId || '').replace(/\D/g, '') : row ? row.discord_id : '';
    const plan = body.plan !== undefined ? JSON.stringify(body.plan || null) : row ? row.plan : 'null';
    const rules = body.rules !== undefined ? JSON.stringify(body.rules || {}) : row ? row.rules : '{}';
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
    if (row) await env.DB.prepare(Q.userSync).bind(tornKey, discordId, hook, plan, rules, paused, lastError, nowS, planAt, targets, factionId, playerId, id).run();
    else await env.DB.prepare(Q.userInsert).bind(id, tornKey, discordId, hook, plan, rules, paused, lastError, nowS, planAt, targets, factionId, playerId).run();
    // Acks (Done / Skip in Discord): the userscript says which it applied; the rest go back to it.
    if (Array.isArray(body.ackIds)) for (const a of body.ackIds.slice(0, 50)) if (typeof a === 'string' && a.length <= 120) await env.DB.prepare(Q.ackDelete).bind(id, a).run();
    const acks = await pendingAcks(env.DB, id);
    return json({ ok: true, created: !row, acks, ready: Boolean(tornKey && (webhook || (linked && env.BOT_TOKEN))), paused: Boolean(paused), lastError, linked, bot: Boolean(env.BOT_TOKEN && env.DISCORD_PUBLIC_KEY) });
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
    if (!canDeliver(env, row)) return json({ ok: false, error: 'No webhook saved and Discord not linked' }, 400);
    const nowS = Math.floor(Date.now() / 1000);
    // A step of kind "test": its Skip button can be tried; the userscript ignores that ack.
    const alert = { id: 'test:' + nowS, kind: 'test', link: LINKS.items, title: 'Test ping from Pumping Iron', text: 'Pings will look like this: "Drug cooldown ends in 5 min · Xanax #2, then DEX × 27".', step: { at: nowS + 300, kind: 'test', label: 'Test step' } };
    const { sent } = await sendAlerts(env, guard(fetchImpl), env.DB, row, [alert], nowS);
    return json({ ok: sent > 0 }, sent > 0 ? 200 : 502);
}

async function forget(req, env) {
    const { id, error } = await userFor(req, env);
    if (error) return error;
    for (const sql of [Q.userDelete, Q.sentDeleteUser, Q.ackDeleteUser, Q.watchDeleteUser, Q.linkDeleteUser, Q.priceDeleteUser]) await env.DB.prepare(sql).bind(id).run();
    return json({ ok: true });
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
    return json({ ok: false, error: 'Not found' }, 404);
}

export default {
    fetch: (req, env, ctx) => handle(req, env, fetch, ctx),
    scheduled: (event, env, ctx) => ctx.waitUntil(runCron(env)),
};
