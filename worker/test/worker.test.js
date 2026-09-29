import test from 'node:test';
import assert from 'node:assert/strict';

import { dueAlerts, webhookBody, isDiscordWebhook, DRUG_LEAD_S } from '../src/alerts.js';
import { handle, runCron, TORN_URL } from '../src/index.js';
import { fakeD1 } from './fake-d1.js';
import { KEY_ENC } from './helpers.js';
import { openKey } from '../src/keys.js';

const SECRET = 'a'.repeat(40);
const HOOK = 'https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-123';
const KEY = 'CustomKey1234567';
const DISCORD = '987654321098765432';
const T = Date.UTC(2026, 8, 29, 10, 48) / 1000;

const plan = {
    type: 'steady',
    steps: [
        { at: T + 232, kind: 'xanax', label: 'Xanax #2', train: 'DEX × 27' },
        { at: T + 532, kind: 'refill', label: 'Refill · 30 points', train: 'DEX × 15' },
        { at: T + 18000, kind: 'natural', label: 'Natural energy', train: 'DEX × 15' },
    ],
};

function state({ drug = 232, energy = 20, refill = false, travel = 0 } = {}) {
    return { bars: { energy: { current: energy, maximum: 150 } }, cooldowns: { drug, booster: 0, medical: 0 }, refills: { energy: refill }, travel: { time_left: travel } };
}

test('drug cooldown ending within 5 minutes: ping with the next drug step', () => {
    const a = dueAlerts(state({ drug: 232 }), plan, T);
    assert.equal(a.length, 1);
    assert.equal(a[0].title, 'Drug cooldown ends in 4 min');
    assert.equal(a[0].text, 'Xanax #2, then DEX × 27');
    assert.deepEqual(dueAlerts(state({ drug: DRUG_LEAD_S + 60 }), plan, T), []);
    assert.deepEqual(dueAlerts(state({ drug: 0 }), plan, T), []);
});

test('energy full while the plan trains natural energy; not while stacking for a jump', () => {
    const a = dueAlerts(state({ drug: 3600, energy: 150 }), plan, T);
    assert.equal(a[0].title, 'Energy is full');
    assert.equal(a[0].text, 'Train DEX × 27');
    assert.deepEqual(dueAlerts(state({ drug: 3600, energy: 150 }), { ...plan, type: 'jump' }, T), []);
});

test('refill unused two hours before Torn midnight, once per day', () => {
    const late = Date.UTC(2026, 8, 29, 22, 30) / 1000;
    const a = dueAlerts(state({ drug: 3600 }), plan, late);
    assert.equal(a[0].id, 'refill:' + Math.floor(late / 86400));
    assert.match(a[0].text, /90 min left/);
    assert.deepEqual(dueAlerts(state({ drug: 3600, refill: true }), plan, late), []);
    assert.deepEqual(dueAlerts(state({ drug: 3600 }), plan, Date.UTC(2026, 8, 29, 21, 0) / 1000), []);
});

test('a strict jump step pings 5 minutes before its tick', () => {
    const tick = T + 12 * 60;
    const p = { type: 'jump', steps: [{ at: tick + 60, kind: 'jump', label: 'EDVD × 5 + Ecstasy, then train it all', strict: true, tick }] };
    assert.deepEqual(dueAlerts(state({ drug: 3600 }), p, T), [], '12 min out: not yet');
    const a = dueAlerts(state({ drug: 3600 }), p, tick - 300);
    assert.equal(a[0].title, 'Jump in 5 min');
    assert.equal(a[0].text, 'EDVD × 5 + Ecstasy, then train it all, right after the 11:00 tick');
});

test('rules turn pings off; flying is noted', () => {
    assert.deepEqual(dueAlerts(state({ drug: 100 }), plan, T, { drug: false }), []);
    assert.match(dueAlerts(state({ drug: 100, travel: 600 }), plan, T)[0].text, /you’re flying/);
});

test('webhook body: the mention in content, only that user allowed to be pinged', () => {
    const b = webhookBody({ title: 'Drug cooldown ends in 5 min', text: 'Xanax #2, then DEX × 27' }, DISCORD);
    assert.equal(b.content, '<@' + DISCORD + '> drug cooldown ends in 5 min');
    assert.deepEqual(b.allowed_mentions, { users: [DISCORD], parse: [] });
    assert.equal(b.embeds[0].description, 'Xanax #2, then DEX × 27');
    assert.equal(isDiscordWebhook(HOOK), true);
    assert.equal(isDiscordWebhook('https://evil.example/api/webhooks/1/x'), false);
    assert.equal(isDiscordWebhook('http://discord.com/api/webhooks/1/x'), false);
});

function recorder(handler) {
    const calls = [];
    const f = async (url, init = {}) => {
        calls.push({ url: String(url), init });
        return handler(String(url), init);
    };
    f.calls = calls;
    return f;
}

const req = (method, path, { secret = SECRET, invite = null, body = null } = {}) =>
    new Request('https://pumping-iron.test.workers.dev' + path, { method, headers: { ...(secret ? { authorization: 'Bearer ' + secret } : {}), ...(invite ? { 'x-invite': invite } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });

test('PUT /plan: the first sync needs the invite code; the secret is stored hashed', async () => {
    const env = { DB: fakeD1(), INVITE_CODE: 'letmein', KEY_ENC };
    let r = await handle(req('PUT', '/plan', { body: { tornKey: KEY, webhookUrl: HOOK, discordId: DISCORD, plan } }), env);
    assert.equal(r.status, 403);
    r = await handle(req('PUT', '/plan', { invite: 'letmein', body: { tornKey: KEY, webhookUrl: HOOK, discordId: DISCORD, plan } }), env);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, created: true, acks: [], ready: true, paused: false, lastError: null, linked: false, bot: false });
    const [id] = env.DB.users.keys();
    assert.notEqual(id, SECRET);
    assert.equal(id.length, 64, 'sha-256 hex');
    // Later syncs: the secret alone; fields left out are kept.
    r = await handle(req('PUT', '/plan', { body: { plan: { type: 'steady', steps: [] } } }), env);
    assert.equal((await r.json()).created, false);
    assert.match(env.DB.users.get(id).torn_key, /^v1./, 'the key is stored sealed');
    assert.equal((await openKey(env.DB.users.get(id).torn_key, env, id)).key, KEY);
    assert.equal(env.DB.users.get(id).webhook, HOOK);
});

test('PUT /plan refuses a bad secret, a non-Discord webhook and a malformed key', async () => {
    const env = { DB: fakeD1(), INVITE_CODE: 'x', KEY_ENC };
    assert.equal((await handle(req('PUT', '/plan', { secret: 'short', invite: 'x', body: {} }), env)).status, 401);
    assert.equal((await handle(req('PUT', '/plan', { invite: 'x', body: { webhookUrl: 'https://evil.example/hook' } }), env)).status, 400);
    assert.equal((await handle(req('PUT', '/plan', { invite: 'x', body: { tornKey: 'nope' } }), env)).status, 400);
    assert.equal((await handle(req('GET', '/nothing'), env)).status, 404);
});

test('POST /test sends one ping to the saved webhook', async () => {
    const env = { DB: fakeD1(), INVITE_CODE: 'x', KEY_ENC };
    await handle(req('PUT', '/plan', { invite: 'x', body: { tornKey: KEY, webhookUrl: HOOK, discordId: DISCORD } }), env);
    const f = recorder(() => new Response(null, { status: 204 }));
    const r = await handle(req('POST', '/test'), env, f);
    assert.equal(r.status, 200);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].url, HOOK + '?wait=true');
    assert.match(JSON.parse(f.calls[0].init.body).content, new RegExp('^<@' + DISCORD + '> test ping'));
});

test('GET /health says only that it is up (no user count), with no CORS header', async () => {
    const env = { DB: fakeD1(), INVITE_CODE: 'x', KEY_ENC };
    await handle(req('PUT', '/plan', { invite: 'x', body: { tornKey: KEY, webhookUrl: HOOK } }), env);
    const r = await handle(req('GET', '/health', { secret: null }), env);
    assert.deepEqual(await r.json(), { ok: true });
    assert.equal(r.headers.get('access-control-allow-origin'), null);
});

test('a plan sync does not undo a dead-key pause; a new key does', async () => {
    const env = { DB: fakeD1(), INVITE_CODE: 'x', KEY_ENC };
    await handle(req('PUT', '/plan', { invite: 'x', body: { tornKey: KEY, webhookUrl: HOOK, plan } }), env);
    await runCron(env, T, recorder(() => new Response(JSON.stringify({ error: { code: 2, error: 'Incorrect key' } }))));
    let r = await (await handle(req('PUT', '/plan', { body: { plan } }), env)).json();
    assert.equal(r.paused, true);
    assert.match(r.lastError, /Torn error 2/);
    r = await (await handle(req('PUT', '/plan', { body: { tornKey: KEY, plan } }), env)).json();
    assert.equal(r.paused, true, 'the same key again changes nothing');
    r = await (await handle(req('PUT', '/plan', { body: { tornKey: 'NewCustomKey1234', plan } }), env)).json();
    assert.equal(r.paused, false);
    assert.equal(r.lastError, null);
});

test('cron: one Torn read per user with the Worker key in a header, one ping per alert, deduped', async () => {
    const env = { DB: fakeD1(), INVITE_CODE: 'x', KEY_ENC };
    await handle(req('PUT', '/plan', { invite: 'x', body: { tornKey: KEY, webhookUrl: HOOK, discordId: DISCORD, plan } }), env);
    let now = T;
    // Torn's cooldown counts down with the clock.
    const f = recorder((url) => (url.startsWith('https://api.torn.com/') ? new Response(JSON.stringify(state({ drug: 232 - (now - T) }))) : new Response(null, { status: 204 })));
    await runCron(env, now, f);
    const torn = f.calls.filter((c) => c.url.startsWith('https://api.torn.com/'));
    assert.equal(torn.length, 1);
    assert.equal(torn[0].url, TORN_URL);
    assert.equal(torn[0].init.headers.Authorization, 'ApiKey ' + KEY);
    assert.ok(!torn[0].url.includes(KEY), 'the key never goes in the URL');
    const hooks = f.calls.filter((c) => c.url.startsWith(HOOK));
    assert.equal(hooks.length, 1);
    assert.match(JSON.parse(hooks[0].init.body).embeds[0].description, /Xanax #2, then DEX × 27/);
    // A minute later, still due: no second ping.
    now = T + 60;
    await runCron(env, now, f);
    assert.equal(f.calls.filter((c) => c.url.startsWith(HOOK)).length, 1);
});

test('cron: a dead Torn key pauses that user; nothing more is asked', async () => {
    const env = { DB: fakeD1(), INVITE_CODE: 'x', KEY_ENC };
    await handle(req('PUT', '/plan', { invite: 'x', body: { tornKey: KEY, webhookUrl: HOOK, plan } }), env);
    const f = recorder(() => new Response(JSON.stringify({ error: { code: 2, error: 'Incorrect key' } })));
    await runCron(env, T, f);
    const u = [...env.DB.users.values()][0];
    assert.equal(u.paused, 1);
    assert.match(u.last_error, /Torn error 2/);
    await runCron(env, T + 60, f);
    assert.equal(f.calls.length, 1);
});

test('cron: a user without a webhook or key is skipped; old sent rows are cleared', async () => {
    const env = { DB: fakeD1(), INVITE_CODE: 'x', KEY_ENC };
    await handle(req('PUT', '/plan', { invite: 'x', body: { plan } }), env);
    env.DB.sent.set('old|x', { user: 'old', alert: 'x', at: T - 3 * 86400 });
    const f = recorder(() => new Response('{}'));
    const out = await runCron(env, T + 120, f);
    assert.deepEqual(out, [{ sent: 0, skipped: true }]);
    assert.equal(f.calls.length, 0);
    assert.equal(env.DB.sent.size, 0);
});

test('DELETE /plan forgets the user', async () => {
    const env = { DB: fakeD1(), INVITE_CODE: 'x', KEY_ENC };
    await handle(req('PUT', '/plan', { invite: 'x', body: { plan } }), env);
    await handle(req('DELETE', '/plan'), env);
    assert.equal(env.DB.users.size, 0);
});
