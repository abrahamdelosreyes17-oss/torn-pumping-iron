import test from 'node:test';
import assert from 'node:assert/strict';

import { handle } from '../src/index.js';
import { handleInteraction } from '../src/interactions.js';
import { Q } from '../src/db.js';
import { recorder, ctx, command, botEnv, body, req, signed, KEY, DISCORD_USER, SECRET } from './helpers.js';

const noFetch = recorder(() => {
    throw new Error('no outside call expected');
});
const now = () => Math.floor(Date.now() / 1000);

async function connected() {
    const env = await botEnv();
    await handle(req('PUT', '/plan', { invite: 'x', body: { tornKey: KEY, discordId: '1234567890' } }), env);
    const [id] = env.DB.users.keys();
    return { env, id };
}

test('POST /link: a one-time code for a connected user; the code is stored hashed', async () => {
    const { env, id } = await connected();
    const b = await body(handle(req('POST', '/link'), env));
    assert.equal(b.ok, true);
    assert.match(b.code, /^[A-HJ-NP-Z2-9]{8}$/);
    assert.equal(b.command, '/link ' + b.code);
    assert.ok(b.expiresAt - now() <= 600 && b.expiresAt - now() > 590);
    const [row] = env.DB.links.values();
    assert.equal(row.user, id);
    assert.notEqual(row.hash, b.code);
    assert.ok(!JSON.stringify([...env.DB.links.values()]).includes(b.code));
    // A second code replaces the first.
    await handle(req('POST', '/link'), env);
    assert.equal(env.DB.links.size, 1);
    // Unknown secret, no secret.
    assert.equal((await handle(req('POST', '/link', { secret: 'b'.repeat(40) }), env)).status, 403);
    assert.equal((await handle(req('POST', '/link', { secret: null }), env)).status, 401);
});

test('/link CODE links the Discord account that typed it (from the signed interaction); single use', async () => {
    const { env, id } = await connected();
    const { code } = await body(handle(req('POST', '/link'), env));
    const r = await body(handle(await signed(command('link', { code: code.slice(0, 4).toLowerCase() + '-' + code.slice(4) })), env, noFetch, ctx()));
    assert.match(r.data.content, /^Linked\. Pings now come to you by DM/);
    assert.equal(r.data.flags, 64);
    const u = env.DB.users.get(id);
    assert.equal(u.discord_id, DISCORD_USER, 'the typed id 1234567890 is replaced by the signed one');
    assert.equal(u.linked, 1);
    assert.equal(env.DB.links.size, 0);
    // Used once: someone else can't reuse it.
    const again = await body(handleInteraction(command('link', { code }, { user: '222' }), env, noFetch, ctx(), now()));
    assert.match(again.data.content, /wrong or expired/);
    // A plan sync can't change a linked id; the answer says linked.
    const p = await body(handle(req('PUT', '/plan', { body: { discordId: '999', plan: null } }), env));
    assert.equal(p.linked, true);
    assert.equal(env.DB.users.get(id).discord_id, DISCORD_USER);
});

test('an expired or wrong code does nothing', async () => {
    const { env, id } = await connected();
    const { code } = await body(handle(req('POST', '/link'), env));
    const late = await body(handleInteraction(command('link', { code }), env, noFetch, ctx(), now() + 601));
    assert.match(late.data.content, /wrong or expired/);
    const wrong = await body(handleInteraction(command('link', { code: 'AAAAAAAA' }), env, noFetch, ctx(), now()));
    assert.match(wrong.data.content, /wrong or expired/);
    assert.equal(env.DB.users.get(id).linked, 0);
});

test('one Discord account links one user: linking again moves it', async () => {
    const env = await botEnv();
    await handle(req('PUT', '/plan', { invite: 'x', body: { tornKey: KEY } }), env);
    await handle(req('PUT', '/plan', { secret: 'c'.repeat(40), invite: 'x', body: { tornKey: 'OtherCustomKey12' } }), env);
    const [a, b] = env.DB.users.keys();
    const c1 = (await body(handle(req('POST', '/link', { secret: SECRET }), env))).code;
    await handleInteraction(command('link', { code: c1 }), env, noFetch, ctx(), now());
    const c2 = (await body(handle(req('POST', '/link', { secret: 'c'.repeat(40) }), env))).code;
    await handleInteraction(command('link', { code: c2 }), env, noFetch, ctx(), now());
    assert.equal(env.DB.users.get(a).linked, 0);
    assert.equal(env.DB.users.get(b).linked, 1);
});

test('/unlink is the Discord side of Forget: the user row and its data are deleted', async () => {
    const { env, id } = await connected();
    const { code } = await body(handle(req('POST', '/link'), env));
    await handleInteraction(command('link', { code }), env, noFetch, ctx(), now());
    await env.DB.prepare(Q.ackPut).bind('done:x', id, 'done', 'x', null, now()).run();
    await env.DB.prepare(Q.sentPut).bind(id, 'drug:1', now(), 'sent', null, null, null, '{}', 'dm').run();
    await env.DB.prepare(Q.watchPut).bind(id, 206, 800000).run();
    await handle(req('POST', '/link'), env);
    const r = await body(handleInteraction(command('unlink'), env, noFetch, ctx(), now()));
    assert.match(r.data.content, /^Unlinked and forgotten: your key, plan and pings are deleted from the service\./);
    assert.deepEqual([env.DB.users.size, env.DB.acks.size, env.DB.sent.size, env.DB.watches.size, env.DB.links.size], [0, 0, 0, 0, 0]);
    assert.match((await body(handleInteraction(command('unlink'), env, noFetch, ctx(), now()))).data.content, /isn’t linked/);
    // The browser's next sync: an unknown secret (it shows "disconnected").
    assert.equal((await handle(req('PUT', '/plan', { body: { plan: null } }), env)).status, 403);
});

test('Forget (DELETE /plan) removes codes too', async () => {
    const { env } = await connected();
    await handle(req('POST', '/link'), env);
    await handle(req('DELETE', '/plan'), env);
    assert.equal(env.DB.links.size, 0);
    assert.equal(env.DB.users.size, 0);
});
