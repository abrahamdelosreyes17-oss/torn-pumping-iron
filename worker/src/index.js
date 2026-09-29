/*
 * Pumping Iron's Discord service: a Cloudflare Worker (free plan) that reads
 * each user's Torn timers once a minute and tags them in Discord when a
 * step is due. It never acts in Torn; it only reads (a custom key with
 * bars, cooldowns, refills and travel) and posts to the user's own
 * Discord webhook. Setup: worker/SETUP.md.
 *
 * Routes:
 *   GET  /health          → {ok, users}
 *   PUT  /plan            (Authorization: Bearer <secret>) store {tornKey?, discordId, webhookUrl, plan, rules}
 *                         the first PUT for a secret needs X-Invite: <INVITE_CODE>
 *   POST /test            (Authorization: Bearer <secret>) send a test ping
 *   DELETE /plan          (Authorization: Bearer <secret>) forget this user
 */

import { dueAlerts, webhookBody, isDiscordWebhook } from './alerts.js';

export const TORN_URL = 'https://api.torn.com/v2/user?selections=bars,cooldowns,refills,travel&comment=PumpingIronPings';
export const DEAD_KEY_CODES = [2, 13, 18];
const SENT_KEEP_S = 2 * 86400;

export const SCHEMA = [
    'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, torn_key TEXT, discord_id TEXT, webhook TEXT, plan TEXT, rules TEXT, paused INTEGER DEFAULT 0, last_error TEXT, updated INTEGER)',
    'CREATE TABLE IF NOT EXISTS sent (user TEXT, alert TEXT, at INTEGER, PRIMARY KEY (user, alert))',
];

async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' } });
}

async function ensureSchema(env) {
    for (const sql of SCHEMA) await env.DB.prepare(sql).run();
}

function bearer(req) {
    const m = String(req.headers.get('authorization') || '').match(/^Bearer\s+([A-Za-z0-9_-]{24,128})$/);
    return m ? m[1] : null;
}

async function userFor(req, env) {
    const secret = bearer(req);
    if (!secret) return { error: json({ ok: false, error: 'Missing or malformed secret' }, 401) };
    const id = await sha256(secret);
    const row = await env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first();
    return { id, row };
}

async function putPlan(req, env) {
    const { id, row, error } = await userFor(req, env);
    if (error) return error;
    if (!row && (!env.INVITE_CODE || req.headers.get('x-invite') !== env.INVITE_CODE)) return json({ ok: false, error: 'Unknown secret: the first sync needs the invite code' }, 403);
    let body;
    try {
        body = await req.json();
    } catch {
        return json({ ok: false, error: 'Body is not JSON' }, 400);
    }
    const webhook = body.webhookUrl !== undefined ? String(body.webhookUrl || '') : row ? row.webhook : '';
    if (webhook && !isDiscordWebhook(webhook)) return json({ ok: false, error: 'That is not a Discord webhook URL' }, 400);
    const tornKey = body.tornKey !== undefined ? String(body.tornKey || '') : row ? row.torn_key : '';
    if (tornKey && !/^[A-Za-z0-9]{16}$/.test(tornKey)) return json({ ok: false, error: 'A Torn key is 16 letters and numbers' }, 400);
    const discordId = body.discordId !== undefined ? String(body.discordId || '').replace(/\D/g, '') : row ? row.discord_id : '';
    const plan = body.plan !== undefined ? JSON.stringify(body.plan || null) : row ? row.plan : 'null';
    const rules = body.rules !== undefined ? JSON.stringify(body.rules || {}) : row ? row.rules : '{}';
    await env.DB.prepare('INSERT OR REPLACE INTO users (id, torn_key, discord_id, webhook, plan, rules, paused, last_error, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(id, tornKey, discordId, webhook, plan, rules, 0, null, Math.floor(Date.now() / 1000))
        .run();
    return json({ ok: true, created: !row, ready: Boolean(tornKey && webhook) });
}

async function postWebhook(fetchImpl, url, body) {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return res.status >= 200 && res.status < 300;
}

async function testPing(req, env, fetchImpl) {
    const { row, error } = await userFor(req, env);
    if (error) return error;
    if (!row) return json({ ok: false, error: 'Unknown secret' }, 403);
    if (!row.webhook) return json({ ok: false, error: 'No webhook saved' }, 400);
    const ok = await postWebhook(fetchImpl, row.webhook, webhookBody({ title: 'Test ping from Pumping Iron', text: 'Pings will look like this: "Drug cooldown ends in 5 min · Xanax #2, then DEX × 27".' }, row.discord_id));
    return json({ ok }, ok ? 200 : 502);
}

async function forget(req, env) {
    const { id, error } = await userFor(req, env);
    if (error) return error;
    await env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
    await env.DB.prepare('DELETE FROM sent WHERE user = ?').bind(id).run();
    return json({ ok: true });
}

/** One user's minute: read Torn, work out what's due, ping once per alert. */
export async function runUser(env, row, nowS, fetchImpl = fetch) {
    if (!row.torn_key || !row.webhook || row.paused) return { sent: 0, skipped: true };
    const res = await fetchImpl(TORN_URL, { headers: { Authorization: 'ApiKey ' + row.torn_key } });
    let state;
    try {
        state = await res.json();
    } catch {
        return { sent: 0, error: 'Torn answered with something that is not JSON' };
    }
    const err = state && state.error;
    if (err) {
        const code = Number(err.code);
        if (DEAD_KEY_CODES.includes(code)) {
            // Stop on a dead key: Torn warns that repeated bad-key calls can block the IP.
            await env.DB.prepare('UPDATE users SET paused = 1, last_error = ? WHERE id = ?').bind('Torn error ' + code + ': ' + String(err.error || ''), row.id).run();
        }
        return { sent: 0, error: 'Torn error ' + code };
    }
    let plan = null;
    try {
        plan = JSON.parse(row.plan || 'null');
    } catch {
        plan = null;
    }
    let rules = {};
    try {
        rules = JSON.parse(row.rules || '{}') || {};
    } catch {
        rules = {};
    }
    let sent = 0;
    for (const a of dueAlerts(state, plan, nowS, rules)) {
        const seen = await env.DB.prepare('SELECT at FROM sent WHERE user = ? AND alert = ?').bind(row.id, a.id).first();
        if (seen) continue;
        const ok = await postWebhook(fetchImpl, row.webhook, webhookBody(a, row.discord_id));
        if (ok) {
            await env.DB.prepare('INSERT OR REPLACE INTO sent (user, alert, at) VALUES (?, ?, ?)').bind(row.id, a.id, nowS).run();
            sent++;
        }
    }
    return { sent };
}

export async function runCron(env, nowS = Math.floor(Date.now() / 1000), fetchImpl = fetch) {
    await ensureSchema(env);
    const { results } = await env.DB.prepare('SELECT * FROM users WHERE paused = 0').all();
    const out = [];
    for (const row of results || []) {
        try {
            out.push(await runUser(env, row, nowS, fetchImpl));
        } catch (e) {
            out.push({ sent: 0, error: String((e && e.message) || e) });
        }
    }
    await env.DB.prepare('DELETE FROM sent WHERE at < ?').bind(nowS - SENT_KEEP_S).run();
    return out;
}

export async function handle(req, env, fetchImpl = fetch) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, PUT, POST, DELETE', 'access-control-allow-headers': 'authorization, content-type, x-invite' } });
    await ensureSchema(env);
    if (url.pathname === '/health' && req.method === 'GET') {
        const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM users').first();
        return json({ ok: true, users: r ? Number(r.n) : 0 });
    }
    if (url.pathname === '/plan' && req.method === 'PUT') return putPlan(req, env);
    if (url.pathname === '/plan' && req.method === 'DELETE') return forget(req, env);
    if (url.pathname === '/test' && req.method === 'POST') return testPing(req, env, fetchImpl);
    return json({ ok: false, error: 'Not found' }, 404);
}

export default {
    fetch: (req, env) => handle(req, env),
    scheduled: (event, env, ctx) => ctx.waitUntil(runCron(env)),
};
