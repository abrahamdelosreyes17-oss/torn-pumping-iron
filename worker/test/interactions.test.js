import test from 'node:test';
import assert from 'node:assert/strict';

import { handle } from '../src/index.js';
import { handleInteraction } from '../src/interactions.js';
import { botEnv, signed, recorder, ctx, command, keyPair, req } from './helpers.js';

const noFetch = recorder(() => {
    throw new Error('no outside call expected');
});

test('PING → PONG with a good signature', async () => {
    const env = await botEnv();
    const r = await handle(await signed({ type: 1 }), env, noFetch, ctx());
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { type: 1 });
    assert.equal(noFetch.calls.length, 0);
});

test('a bad signature is refused with 401 (Discord probes this)', async () => {
    const env = await botEnv();
    const r = await handle(await signed({ type: 1 }, { tamper: true }), env, noFetch, ctx());
    assert.equal(r.status, 401);
});

test('a signature from another key is refused', async () => {
    const env = await botEnv();
    const other = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const r = await handle(await signed({ type: 1 }, { key: other.privateKey }), env, noFetch, ctx());
    assert.equal(r.status, 401);
});

test('an old (replayed) timestamp is refused with 401', async () => {
    const env = await botEnv();
    const r = await handle(await signed({ type: 1 }, { ts: Math.floor(Date.now() / 1000) - 600 }), env, noFetch, ctx());
    assert.equal(r.status, 401);
});

test('missing signature headers, or no public key set: 401', async () => {
    const env = await botEnv();
    const bare = new Request('https://x.workers.dev/interactions', { method: 'POST', body: '{"type":1}' });
    assert.equal((await handle(bare, env, noFetch, ctx())).status, 401);
    const noKey = { ...env, DISCORD_PUBLIC_KEY: '' };
    assert.equal((await handle(await signed({ type: 1 }), noKey, noFetch, ctx())).status, 401);
});

test('a changed body fails the signature', async () => {
    const env = await botEnv();
    const kp = await keyPair();
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, kp.privateKey, new TextEncoder().encode(ts + '{"type":1}')));
    const r = new Request('https://x.workers.dev/interactions', { method: 'POST', headers: { 'x-signature-ed25519': Buffer.from(sig).toString('hex'), 'x-signature-timestamp': ts }, body: '{"type":2}' });
    assert.equal((await handle(r, env, noFetch, ctx())).status, 401);
});

test('/help answers at once, only to the asker, and pings nobody', async () => {
    const env = await botEnv();
    const r = await handle(await signed(command('help')), env, noFetch, ctx());
    const b = await r.json();
    assert.equal(b.type, 4);
    assert.equal(b.data.flags, 64);
    assert.deepEqual(b.data.allowed_mentions, { parse: [] });
    assert.match(b.data.content, /\/link CODE/);
    assert.match(b.data.content, /you do every train, use, buy and attack yourself/);
    assert.doesNotMatch(b.data.content, /\bFF\b/);
});

test('an unknown command or button answers politely', async () => {
    const env = await botEnv();
    const b = await (await handleInteraction(command('nope'), env, noFetch, ctx())).json();
    assert.match(b.data.content, /\/help/);
    const btn = await (await handleInteraction({ type: 3, user: { id: '1' }, data: { custom_id: 'zzz:1' } }, env, noFetch, ctx())).json();
    assert.match(btn.data.content, /no longer works/);
});

test('the schema is checked once per Worker instance, not on every request', async () => {
    const env = await botEnv();
    await handle(req('PUT', '/plan', { invite: 'x', body: { plan: null } }), env, noFetch, ctx());
    const first = env.DB.log.length;
    assert.ok(env.DB.log.some((s) => s.startsWith('ALTER TABLE users ADD COLUMN')), 'a 1.0 database gets the new columns');
    assert.equal(env.DB.meta.get('schema'), '2');
    await handle(req('PUT', '/plan', { body: { plan: null } }), env, noFetch, ctx());
    const again = env.DB.log.slice(first);
    assert.ok(!again.some((s) => /^(CREATE|ALTER)|FROM meta/.test(s)), 'no schema work on the second request');
    // /health needs no database at all.
    assert.equal((await handle(new Request('https://x.workers.dev/health'), { DB: null }, noFetch, ctx())).status, 200);
});
