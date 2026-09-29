/*
 * "Log in with Discord": the easy way in. The userscript asks for a login
 * (POST /login/start, with its browser secret), opens the address it gets
 * back, and asks every few seconds how it went (POST /login/status).
 * Discord's OAuth page says who you are (scope `identify` only); the bot
 * checks you're a member of the owner's server (GUILD_ID), which replaces
 * the invite code; then this browser's user row is created and linked to
 * your Discord account. Nothing to type. A Discord account already
 * linked in another browser is refused ('elsewhere') unless that row has
 * not synced for a week (then it is forgotten and this login takes over).
 *
 * Needs: DISCORD_APP_ID, DISCORD_CLIENT_SECRET, BOT_TOKEN (secrets),
 * GUILD_ID ([vars]), and <address>/login/callback as a redirect on the
 * Discord application's OAuth2 page.
 */

import { Q, forgetUser } from './db.js';
import { DISCORD_API } from './discord.js';
import { readLimited } from './net.js';

/** A login waits this long for you to finish on Discord. */
export const LOGIN_TTL_S = 15 * 60;
/** Open logins at once: past it the oldest open one makes room (a flood of starts can't grow the table, or lock people out). */
export const MAX_OPEN_LOGINS = 50;
/** Open logins from one address (CF-Connecting-IP) at once. */
export const MAX_LOGINS_PER_IP = 5;
/** /login/status and /login/cancel bodies: {id} only. */
export const MAX_LOGIN_BODY = 1024;
/**
 * A Discord account linked to another browser's row: that row is taken
 * over (deleted) only when nobody has synced it for this long; otherwise
 * the login is refused ('elsewhere').
 */
export const LINK_ABANDONED_S = 7 * 86400;

const STATES = ['open', 'done', 'not_member', 'denied', 'full', 'failed', 'elsewhere'];

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** Is "Log in with Discord" set up on this Worker? */
export function loginReady(env) {
    return Boolean(env.DISCORD_APP_ID && env.DISCORD_CLIENT_SECRET && env.BOT_TOKEN && /^\d{5,25}$/.test(String(env.GUILD_ID || '')));
}

function newLoginId() {
    const b = new Uint8Array(24);
    crypto.getRandomValues(b);
    return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The caller's address, hashed with the day (never stored as is); null without CF-Connecting-IP. */
async function ipTag(req, nowS) {
    const ip = String(req.headers.get('cf-connecting-ip') || '').trim();
    return ip ? sha256('login-ip:' + ip + ':' + Math.floor(nowS / 86400)) : null;
}

/** The {id} of /login/status and /login/cancel: a 48-hex id, '' when missing or bad, null when the body is too big. */
async function bodyId(req) {
    const text = await readLimited(req, MAX_LOGIN_BODY);
    if (text === null) return null;
    try {
        const id = String(JSON.parse(text).id || '');
        return /^[0-9a-f]{48}$/.test(id) ? id : '';
    } catch {
        return '';
    }
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** The page you land on after Discord: plain, in Pumping Iron's colours, no scripts. */
export function page(title, text, ok, status = 200) {
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pumping Iron · ${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#15171a;color:#c9ccd0;font:15px/1.5 Arial,Helvetica,sans-serif}
main{max-width:440px;margin:16px;padding:22px 24px;background:#1b1e21;border:1px solid #2c3136;border-left:3px solid ${ok ? '#efebe2' : '#e8a33d'};border-radius:6px}
h1{margin:0 0 8px;font-size:18px;color:#fff}p{margin:0}small{display:block;margin-top:14px;color:#8a9096}</style></head>
<body><main><h1>${esc(title)}</h1><p>${esc(text)}</p><small>Pumping Iron · you can close this tab.</small></main></body></html>`;
    return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'", 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'cache-control': 'no-store' } });
}

const NOT_READY = 'Log in with Discord isn’t set up on this service yet (it needs DISCORD_CLIENT_SECRET and GUILD_ID).';
const ELSEWHERE = 'This Discord account is already connected to Pumping Iron in another browser. Press Disconnect there (Settings › Discord), or type /unlink in Discord, then log in here again.';
const EXPIRED = ['This login has expired', 'Go back to Pumping Iron → Settings → Discord and press Log in with Discord again.'];

/**
 * Discord's authorize page for this login. Always shown (no prompt=none):
 * a login link someone else started can't then link your Discord account
 * without you seeing Discord's "Authorize" page first. `quiet` is kept for
 * the old callers and ignored.
 */
function authorizeUrl(env, origin, id, quiet) {
    const q = new URLSearchParams({ client_id: String(env.DISCORD_APP_ID), response_type: 'code', scope: 'identify', redirect_uri: origin + '/login/callback', state: id });
    void quiet;
    return new Response(null, { status: 302, headers: { location: 'https://discord.com/oauth2/authorize?' + q.toString(), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
}

/** POST /login/start (Authorization: Bearer <secret>) → {url}: open it; then ask /login/status. */
export async function loginStart(req, env, userId) {
    if (!loginReady(env)) return json({ ok: false, error: NOT_READY }, 501);
    const nowS = Math.floor(Date.now() / 1000);
    await env.DB.prepare(Q.loginClean).bind(nowS - LOGIN_TTL_S).run();
    await env.DB.prepare(Q.loginDeleteUser).bind(userId).run();
    const ip = await ipTag(req, nowS);
    const n = await env.DB.prepare(Q.loginsOpen).bind(ip).first();
    if (ip && Number(n && n.mine) >= MAX_LOGINS_PER_IP) return json({ ok: false, error: 'Too many logins from this network at once. Try again in a few minutes.' }, 429);
    // A flood from many addresses: the oldest open login goes, so a real login always gets in.
    if (Number(n && n.n) >= MAX_OPEN_LOGINS) await env.DB.prepare(Q.loginEvictOldest).run();
    const id = newLoginId();
    await env.DB.prepare(Q.loginPut).bind(id, userId, nowS, 'open', ip).run();
    return json({ ok: true, id, url: new URL(req.url).origin + '/login?id=' + id, expiresAt: nowS + LOGIN_TTL_S });
}

/** POST /login/status {id} (same secret) → {state, name}. */
export async function loginStatus(req, env, userId) {
    const id = await bodyId(req);
    if (id === null) return json({ ok: false, error: 'Too much data' }, 413);
    const row = id ? await env.DB.prepare(Q.loginGet).bind(id).first() : null;
    if (!row || row.user !== userId) return json({ ok: false, error: 'That login is gone. Start again.' }, 404);
    const nowS = Math.floor(Date.now() / 1000);
    const state = row.state === 'open' && Number(row.at) < nowS - LOGIN_TTL_S ? 'expired' : row.state;
    return json({ ok: true, state, name: row.name || null });
}

/** POST /login/cancel {id} (same secret): the login is dropped; finishing Discord's page afterwards does nothing. */
export async function loginCancel(req, env, userId) {
    const id = await bodyId(req);
    if (id === null) return json({ ok: false, error: 'Too much data' }, 413);
    if (!id) return json({ ok: false, error: 'That login is gone. Start again.' }, 404);
    await env.DB.prepare(Q.loginCancel).bind(id, userId).run();
    return json({ ok: true });
}

/** GET /login?id=… → Discord's "allow Pumping Iron?" page. */
export async function loginGo(req, env) {
    if (!loginReady(env)) return page('Not set up', NOT_READY, false, 501);
    const url = new URL(req.url);
    const id = String(url.searchParams.get('id') || '');
    const row = /^[0-9a-f]{48}$/.test(id) ? await env.DB.prepare(Q.loginGet).bind(id).first() : null;
    const nowS = Math.floor(Date.now() / 1000);
    if (!row || row.state !== 'open' || Number(row.at) < nowS - LOGIN_TTL_S) return page(...EXPIRED, false);
    return authorizeUrl(env, url.origin, id, true);
}

async function finish(env, id, state, discordId = null, name = null) {
    if (!STATES.includes(state)) state = 'failed';
    await env.DB.prepare(Q.loginSet).bind(discordId, name, state, id).run();
}

/** Who logged in: the OAuth code for a token, then /users/@me. */
async function discordUser(env, f, code, redirectUri) {
    const basic = btoa(String(env.DISCORD_APP_ID) + ':' + String(env.DISCORD_CLIENT_SECRET));
    const tok = await f(DISCORD_API + '/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: 'Basic ' + basic },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri }).toString(),
    });
    const t = tok.ok ? await tok.json() : null;
    if (!t || !t.access_token) throw new Error('Discord did not accept the login (' + tok.status + ')');
    const me = await f(DISCORD_API + '/users/@me', { headers: { authorization: 'Bearer ' + t.access_token } });
    const u = me.ok ? await me.json() : null;
    if (!u || !/^\d{5,25}$/.test(String(u.id || ''))) throw new Error('Discord did not say who you are (' + me.status + ')');
    return { id: String(u.id), name: String(u.global_name || u.username || 'you').slice(0, 64) };
}

/** Discord's "Unknown Guild": the bot isn't in GUILD_ID (not "you aren't a member"). */
const UNKNOWN_GUILD = 10004;

/** Is this Discord account in the owner's server? The bot asks (it's a member there). */
async function inServer(env, f, discordId) {
    const r = await f(DISCORD_API + '/guilds/' + env.GUILD_ID + '/members/' + discordId, { headers: { authorization: 'Bot ' + env.BOT_TOKEN } });
    if (r.status === 404) {
        let code = null;
        try {
            code = Number((await r.json()).code);
        } catch {
            code = null;
        }
        if (code === UNKNOWN_GUILD) throw new Error('The bot is not in the Pumping Iron server (ask its owner)');
        return false;
    }
    if (!r.ok) throw new Error('The bot could not check the server (' + r.status + ')');
    return true;
}

/**
 * GET /login/callback?code&state: Discord sends you back here. A member
 * of the server becomes a user of this Worker (the invite code isn't
 * needed), linked to their Discord account like /link.
 */
export async function loginCallback(req, env, f, { maxUsers }) {
    if (!loginReady(env)) return page('Not set up', NOT_READY, false, 501);
    const url = new URL(req.url);
    const id = String(url.searchParams.get('state') || '');
    const nowS = Math.floor(Date.now() / 1000);
    const row = /^[0-9a-f]{48}$/.test(id) ? await env.DB.prepare(Q.loginGet).bind(id).first() : null;
    if (!row || row.state !== 'open' || Number(row.at) < nowS - LOGIN_TTL_S) return page(...EXPIRED, false);
    const err = url.searchParams.get('error');
    if (err) {
        // prompt=none on a first login: Discord asks us to show its page after all (never loops: no prompt=none this time).
        if (['consent_required', 'interaction_required', 'login_required'].includes(err)) return authorizeUrl(env, url.origin, id, false);
        if (err === 'access_denied') {
            await finish(env, id, 'denied');
            return page('Not connected', 'You cancelled on Discord. Press Log in with Discord again whenever you like.', false);
        }
        // Fixed words: the query text is never shown back.
        await finish(env, id, 'failed');
        return page('Not connected', 'Discord didn’t finish the login. Try again in a minute.', false);
    }
    const code = String(url.searchParams.get('code') || '');
    if (!code) {
        await finish(env, id, 'failed');
        return page('Not connected', 'Discord sent no login. Try again.', false);
    }
    let who;
    try {
        who = await discordUser(env, f, code, url.origin + '/login/callback');
        if (!(await inServer(env, f, who.id))) {
            await finish(env, id, 'not_member', who.id, who.name);
            return page('Not in the server', 'Pings come from the Pumping Iron bot in its Discord server, and ' + who.name + ' isn’t a member. Ask whoever runs it for an invite, then log in again.', false);
        }
    } catch (e) {
        await finish(env, id, 'failed');
        return page('Not connected', String((e && e.message) || e) + '. Try again in a minute.', false);
    }
    // One Discord account ↔ one Pumping Iron user, and never moved silently: a row in another
    // browser is taken over only when nobody has synced it for a week (then it is forgotten).
    const { results: others } = await env.DB.prepare(Q.usersLinkedElsewhere).bind(who.id, row.user).all();
    if ((others || []).some((o) => Number(o.updated) >= nowS - LINK_ABANDONED_S)) {
        await finish(env, id, 'elsewhere', who.id, who.name);
        return page('Connected in another browser', ELSEWHERE, false);
    }
    for (const o of others || []) await forgetUser(env.DB, o.id);
    const user = await env.DB.prepare(Q.userGet).bind(row.user).first();
    if (!user) {
        const n = await env.DB.prepare(Q.usersCount).first();
        if (Number(n && n.n) >= maxUsers) {
            await finish(env, id, 'full', who.id, who.name);
            return page('The service is full', 'It serves ' + maxUsers + ' people. Ask whoever runs it.', false);
        }
        await env.DB.prepare(Q.userInsert).bind(row.user, '', who.id, '', 'null', '{}', 0, null, nowS, null, null, null, null, null, null).run();
    }
    await env.DB.prepare(Q.userLink).bind(who.id, row.user).run();
    await finish(env, id, 'done', who.id, who.name);
    return page('Connected as ' + who.name, 'Go back to Pumping Iron: pings start by themselves. They come as DMs from the Pumping Iron bot.', true);
}

