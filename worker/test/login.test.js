import test from 'node:test';
import assert from 'node:assert/strict';

import { handle } from '../src/index.js';
import { LOGIN_TTL_S, LINK_ABANDONED_S, MAX_OPEN_LOGINS } from '../src/login.js';
import { Q } from '../src/db.js';
import { recorder, botEnv, body, req, jsonRes, KEY, DISCORD_USER, SECRET } from './helpers.js';

const GUILD = '1551784561237561344';
const ORIGIN = 'https://pumping-iron.test.workers.dev';

const loginEnv = (extra = {}) => botEnv({ DISCORD_CLIENT_SECRET: 'client-secret', GUILD_ID: GUILD, ...extra });

/** Discord for the login: the token exchange, who you are, and the bot's member check. */
function discord({ member = () => jsonRes({ user: { id: DISCORD_USER } }), name = 'Iron Tester', token = () => jsonRes({ access_token: 'user-at', token_type: 'Bearer', scope: 'identify' }) } = {}) {
    return recorder((url, init) => {
        const u = new URL(url);
        if (u.pathname === '/api/v10/oauth2/token') return token(url, init);
        if (u.pathname === '/api/v10/users/@me') return jsonRes({ id: DISCORD_USER, username: 'tester', global_name: name });
        if (u.pathname.startsWith('/api/v10/guilds/')) return member(url, init);
        throw new Error('discord: no answer for ' + url);
    });
}

const get = (path) => new Request(ORIGIN + path, { method: 'GET' });

/** A request from an address (Cloudflare's CF-Connecting-IP). */
function fromIp(r, ip) {
    const h = new Headers(r.headers);
    h.set('cf-connecting-ip', ip);
    return new Request(r, { headers: h });
}

async function started(env, secret = SECRET, ip = null) {
    const r = await handle(ip ? fromIp(req('POST', '/login/start', { secret }), ip) : req('POST', '/login/start', { secret }), env);
    assert.equal(r.status, 200);
    return r.json();
}

test('POST /login/start: needs the secret, answers the address to open; 501 when the login isn’t set up', async () => {
    const env = await loginEnv();
    assert.equal((await handle(req('POST', '/login/start', { secret: null }), env)).status, 401);
    const s = await started(env);
    assert.match(s.id, /^[0-9a-f]{48}$/);
    assert.equal(s.url, ORIGIN + '/login?id=' + s.id);
    assert.ok(s.expiresAt - Math.floor(Date.now() / 1000) <= LOGIN_TTL_S);
    // A second start replaces the first (one open login per browser).
    await started(env);
    assert.equal(env.DB.logins.size, 1);
    for (const missing of [{ DISCORD_CLIENT_SECRET: '' }, { GUILD_ID: '' }, { GUILD_ID: 'not-a-number' }, { BOT_TOKEN: '' }]) {
        const r = await handle(req('POST', '/login/start'), await loginEnv(missing));
        assert.equal(r.status, 501, JSON.stringify(missing));
        assert.match((await r.json()).error, /isn’t set up/);
    }
    const off = await loginEnv({ DISCORD_CLIENT_SECRET: '' });
    assert.equal((await handle(get('/login?id=' + s.id), off)).status, 501);
    assert.equal((await handle(get('/login/callback?code=x&state=' + s.id), off, discord())).status, 501);
});

test('POST /login/status: only for the browser that started it', async () => {
    const env = await loginEnv();
    const s = await started(env);
    const mine = await body(handle(req('POST', '/login/status', { body: { id: s.id } }), env));
    assert.deepEqual(mine, { ok: true, state: 'open', name: null });
    const other = await handle(req('POST', '/login/status', { secret: 'b'.repeat(40), body: { id: s.id } }), env);
    assert.equal(other.status, 404);
    assert.equal((await handle(req('POST', '/login/status', { body: { id: 'nope' } }), env)).status, 404);
    assert.equal((await handle(req('POST', '/login/status', { secret: null, body: { id: s.id } }), env)).status, 401);
});

test('GET /login: off to Discord’s authorize page with the login as state (scope identify only)', async () => {
    const env = await loginEnv();
    const s = await started(env);
    const r = await handle(get('/login?id=' + s.id), env);
    assert.equal(r.status, 302);
    const to = new URL(r.headers.get('location'));
    assert.equal(to.origin + to.pathname, 'https://discord.com/oauth2/authorize');
    assert.deepEqual(Object.fromEntries(to.searchParams), { client_id: '111', response_type: 'code', scope: 'identify', redirect_uri: ORIGIN + '/login/callback', state: s.id });
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const bad = await handle(get('/login?id=' + 'f'.repeat(48)), env);
    assert.equal(bad.status, 200);
    assert.match(await bad.text(), /This login has expired/);
});

test('callback: a member of the server becomes a linked user (no invite); an abandoned row of the same Discord account (7+ days) is forgotten', async () => {
    const env = await loginEnv();
    // An older browser's row linked to the same Discord account, not synced for 8 days, with a key and data.
    await handle(req('PUT', '/plan', { secret: 'c'.repeat(40), invite: 'x', body: { tornKey: KEY, plan: null } }), env);
    const [oldId] = env.DB.users.keys();
    Object.assign(env.DB.users.get(oldId), { discord_id: DISCORD_USER, linked: 1, updated: Math.floor(Date.now() / 1000) - LINK_ABANDONED_S - 86400 });
    await env.DB.prepare(Q.ackPut).bind('done:x', oldId, 'done', 'x', null, 1).run();
    await env.DB.prepare(Q.watchPut).bind(oldId, 206, 800000).run();
    const s = await started(env);
    const f = discord();
    const r = await handle(get('/login/callback?code=the-code&state=' + s.id), env, f);
    assert.equal(r.status, 200);
    const html = await r.text();
    assert.match(html, /<h1>Connected as Iron Tester<\/h1>/);
    assert.equal(r.headers.get('content-security-policy'), "default-src 'none'; style-src 'unsafe-inline'");
    assert.equal(r.headers.get('x-frame-options'), 'DENY');
    assert.doesNotMatch(html, /<script/);
    // The three Discord calls: the code for a token (Basic auth, a form), who you are, the member check with the bot.
    assert.deepEqual(f.calls.map((c) => new URL(c.url).pathname), ['/api/v10/oauth2/token', '/api/v10/users/@me', '/api/v10/guilds/' + GUILD + '/members/' + DISCORD_USER]);
    const tok = f.calls[0].init;
    assert.equal(tok.method, 'POST');
    assert.equal(tok.headers.authorization, 'Basic ' + Buffer.from('111:client-secret').toString('base64'));
    assert.equal(tok.headers['content-type'], 'application/x-www-form-urlencoded');
    assert.deepEqual(Object.fromEntries(new URLSearchParams(tok.body)), { grant_type: 'authorization_code', code: 'the-code', redirect_uri: ORIGIN + '/login/callback' });
    assert.equal(f.calls[1].init.headers.authorization, 'Bearer user-at');
    assert.equal(f.calls[2].init.headers.authorization, 'Bot bot-token');
    // The row for this browser's secret: created and linked; the old one gone with its key and data.
    const { sha256 } = await import('../src/cmd-core.js');
    const me = env.DB.users.get(await sha256(SECRET));
    assert.deepEqual([me.discord_id, me.linked, me.torn_key], [DISCORD_USER, 1, '']);
    assert.equal(env.DB.users.has(oldId), false);
    assert.deepEqual([env.DB.users.size, env.DB.acks.size, env.DB.watches.size], [1, 0, 0]);
    assert.deepEqual(await body(handle(req('POST', '/login/status', { body: { id: s.id } }), env)), { ok: true, state: 'done', name: 'Iron Tester' });
    // Used once.
    assert.match(await (await handle(get('/login/callback?code=again&state=' + s.id), env, discord())).text(), /expired/);
    // The userscript then sends the main key: no invite needed, and pings are ready.
    const p = await body(handle(req('PUT', '/plan', { body: { tornKey: KEY, plan: null } }), env));
    assert.deepEqual([p.ok, p.created, p.linked, p.ready], [true, false, true, true]);
    assert.match(me.torn_key, /^v1\./, 'stored sealed');
});

test('callback: not a member (404) → no user, "not in the server"; the bot outside the server is an error, not "not a member"', async () => {
    const env = await loginEnv();
    let s = await started(env);
    const r = await handle(get('/login/callback?code=c&state=' + s.id), env, discord({ member: () => jsonRes({ message: 'Unknown Member', code: 10007 }, 404) }));
    assert.match(await r.text(), /Not in the server/);
    assert.equal(env.DB.users.size, 0);
    assert.equal((await body(handle(req('POST', '/login/status', { body: { id: s.id } }), env))).state, 'not_member');
    s = await started(env);
    const g = await handle(get('/login/callback?code=c&state=' + s.id), env, discord({ member: () => jsonRes({ message: 'Unknown Guild', code: 10004 }, 404) }));
    assert.match(await g.text(), /The bot is not in the Pumping Iron server/);
    assert.equal((await body(handle(req('POST', '/login/status', { body: { id: s.id } }), env))).state, 'failed');
    assert.equal(env.DB.users.size, 0);
});

test('callback: cancelled on Discord → denied; consent_required → Discord’s page again (without prompt=none)', async () => {
    const env = await loginEnv();
    let s = await started(env);
    const r = await handle(get('/login/callback?error=access_denied&state=' + s.id), env, discord());
    assert.match(await r.text(), /You cancelled on Discord/);
    assert.equal((await body(handle(req('POST', '/login/status', { body: { id: s.id } }), env))).state, 'denied');
    s = await started(env);
    const c = await handle(get('/login/callback?error=consent_required&state=' + s.id), env, discord());
    assert.equal(c.status, 302);
    const to = new URL(c.headers.get('location'));
    assert.equal(to.searchParams.get('state'), s.id);
    assert.equal(to.searchParams.get('prompt'), null);
    assert.equal((await body(handle(req('POST', '/login/status', { body: { id: s.id } }), env))).state, 'open', 'still waiting');
});

test('an old login (over 15 minutes) or an unknown state: the "expired" page; status says expired', async () => {
    const env = await loginEnv();
    const s = await started(env);
    env.DB.logins.get(s.id).at -= LOGIN_TTL_S + 1;
    assert.match(await (await handle(get('/login?id=' + s.id), env)).text(), /This login has expired/);
    const f = discord();
    assert.match(await (await handle(get('/login/callback?code=c&state=' + s.id), env, f)).text(), /This login has expired/);
    assert.equal(f.calls.length, 0, 'Discord is not asked');
    assert.equal((await body(handle(req('POST', '/login/status', { body: { id: s.id } }), env))).state, 'expired');
    assert.match(await (await handle(get('/login/callback?code=c&state=zzz'), env, f)).text(), /expired/);
});

test('callback: a full service (MAX_USERS) says so and adds nobody', async () => {
    const env = await loginEnv({ MAX_USERS: '1' });
    await handle(req('PUT', '/plan', { secret: 'c'.repeat(40), invite: 'x', body: { plan: null } }), env);
    const s = await started(env);
    const r = await handle(get('/login/callback?code=c&state=' + s.id), env, discord());
    assert.match(await r.text(), /The service is full/);
    assert.equal(env.DB.users.size, 1);
    assert.equal((await body(handle(req('POST', '/login/status', { body: { id: s.id } }), env))).state, 'full');
});

test('the landing page escapes the Discord name', async () => {
    const env = await loginEnv();
    const s = await started(env);
    const html = await (await handle(get('/login/callback?code=c&state=' + s.id), env, discord({ name: '<img src=x onerror=alert(1)>"&' }))).text();
    assert.ok(html.includes('Connected as &lt;img src=x onerror=alert(1)&gt;&quot;&amp;'));
    assert.doesNotMatch(html, /<img/);
});

test('callback: the Discord account linked in another browser that synced lately → "elsewhere", nothing moves', async () => {
    const env = await loginEnv();
    await handle(req('PUT', '/plan', { secret: 'c'.repeat(40), invite: 'x', body: { tornKey: KEY, plan: null } }), env);
    const [otherId] = env.DB.users.keys();
    Object.assign(env.DB.users.get(otherId), { discord_id: DISCORD_USER, linked: 1, updated: Math.floor(Date.now() / 1000) - LINK_ABANDONED_S + 3600 });
    const s = await started(env);
    const html = await (await handle(get('/login/callback?code=c&state=' + s.id), env, discord())).text();
    assert.match(html, /<h1>Connected in another browser<\/h1>/);
    assert.ok(html.includes('This Discord account is already connected to Pumping Iron in another browser. Press Disconnect there (Settings › Discord), or type /unlink in Discord, then log in here again.'));
    assert.deepEqual(await body(handle(req('POST', '/login/status', { body: { id: s.id } }), env)), { ok: true, state: 'elsewhere', name: 'Iron Tester' });
    // The other row keeps its link and key; no row for this browser.
    const other = env.DB.users.get(otherId);
    assert.deepEqual([other.discord_id, other.linked, env.DB.users.size], [DISCORD_USER, 1, 1]);
    assert.match(other.torn_key, /^v1\./);
});

test('callback: the same browser logging in again with the same Discord account is fine', async () => {
    const env = await loginEnv();
    let s = await started(env);
    await handle(get('/login/callback?code=c&state=' + s.id), env, discord());
    s = await started(env);
    const html = await (await handle(get('/login/callback?code=c&state=' + s.id), env, discord())).text();
    assert.match(html, /Connected as Iron Tester/);
    assert.equal(env.DB.users.size, 1);
    assert.equal([...env.DB.users.values()][0].linked, 1);
});

test('callback: a Discord error never shows the query text back', async () => {
    const env = await loginEnv();
    const s = await started(env);
    const html = await (await handle(get('/login/callback?error=' + encodeURIComponent('Call 555 now: your account is locked') + '&state=' + s.id), env, discord())).text();
    assert.match(html, /Discord didn’t finish the login\. Try again in a minute\./);
    assert.doesNotMatch(html, /555|locked/);
    assert.equal((await body(handle(req('POST', '/login/status', { body: { id: s.id } }), env))).state, 'failed');
});

test('POST /login/cancel: the login is dropped; Discord’s page afterwards does nothing', async () => {
    const env = await loginEnv();
    const s = await started(env);
    // Another browser can't cancel it.
    assert.deepEqual(await body(handle(req('POST', '/login/cancel', { secret: 'b'.repeat(40), body: { id: s.id } }), env)), { ok: true });
    assert.equal(env.DB.logins.size, 1);
    assert.equal((await handle(req('POST', '/login/cancel', { secret: null, body: { id: s.id } }), env)).status, 401);
    assert.equal((await handle(req('POST', '/login/cancel', { body: { id: 'nope' } }), env)).status, 404);
    assert.deepEqual(await body(handle(req('POST', '/login/cancel', { body: { id: s.id } }), env)), { ok: true });
    assert.equal(env.DB.logins.size, 0);
    const f = discord();
    assert.match(await (await handle(get('/login/callback?code=c&state=' + s.id), env, f)).text(), /This login has expired/);
    assert.equal(f.calls.length, 0);
    assert.equal(env.DB.users.size, 0);
    assert.equal((await handle(req('POST', '/login/status', { body: { id: s.id } }), env)).status, 404);
});

test('a flood of logins: past 50 open the oldest makes room (no 429); at most 5 open per address', async () => {
    const env = await loginEnv();
    const nowS = Math.floor(Date.now() / 1000);
    // 50 open logins from 50 addresses, the first one oldest.
    for (let n = 0; n < MAX_OPEN_LOGINS; n++) await env.DB.prepare(Q.loginPut).bind(n.toString(16).padStart(48, '0'), 'u' + n, nowS - 600 + n, 'open', 'ip' + n).run();
    const s = await started(env, SECRET, '203.0.113.9');
    assert.equal(env.DB.logins.size, MAX_OPEN_LOGINS);
    assert.equal(env.DB.logins.has('0'.repeat(48)), false, 'the oldest went');
    assert.ok(env.DB.logins.has(s.id));
    // The address is stored hashed with the day, never as is.
    assert.match(env.DB.logins.get(s.id).ip, /^[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify([...env.DB.logins.values()]).includes('203.0.113.9'));
    // Five browsers behind one address: the sixth waits.
    for (let n = 1; n < 5; n++) await started(env, String(n).repeat(40), '203.0.113.9');
    const sixth = await handle(fromIp(req('POST', '/login/start', { secret: 'f'.repeat(40) }), '203.0.113.9'), env);
    assert.equal(sixth.status, 429);
    assert.match((await sixth.json()).error, /from this network/);
    // Another address still gets in; a finished login no longer counts.
    await started(env, 'e'.repeat(40), '198.51.100.7');
    env.DB.logins.get(s.id).state = 'done';
    await started(env, 'f'.repeat(40), '203.0.113.9');
});

test('login bodies: at most 1 kB, counted in bytes; a declared length over it is refused unread', async () => {
    const env = await loginEnv();
    const s = await started(env);
    // 400 three-byte characters: under 1,024 characters, over 1,024 bytes.
    const wide = JSON.stringify({ id: s.id, pad: '€'.repeat(400) });
    assert.ok(wide.length < 1024 && new TextEncoder().encode(wide).length > 1024);
    const post = (path, text, headers = {}) => new Request(ORIGIN + path, { method: 'POST', headers: { authorization: 'Bearer ' + SECRET, ...headers }, body: text });
    assert.equal((await handle(post('/login/status', wide), env)).status, 413);
    assert.equal((await handle(post('/login/cancel', wide), env)).status, 413);
    assert.equal(env.DB.logins.size, 1);
    // A body sent without a length (a stream) is read only up to the limit.
    const stream = (text) => new ReadableStream({ start: (c) => (c.enqueue(new TextEncoder().encode(text)), c.close()) });
    const chunked = new Request(ORIGIN + '/login/status', { method: 'POST', headers: { authorization: 'Bearer ' + SECRET }, body: stream(wide), duplex: 'half' });
    assert.equal(chunked.headers.get('content-length'), null);
    assert.equal((await handle(chunked, env)).status, 413);
    const ok = new Request(ORIGIN + '/login/status', { method: 'POST', headers: { authorization: 'Bearer ' + SECRET }, body: stream(JSON.stringify({ id: s.id })), duplex: 'half' });
    assert.equal((await body(handle(ok, env))).state, 'open');
});

test('Forget (DELETE /plan) also drops the browser’s logins', async () => {
    const env = await loginEnv();
    await started(env);
    await handle(req('DELETE', '/plan'), env);
    assert.equal(env.DB.logins.size, 0);
});
