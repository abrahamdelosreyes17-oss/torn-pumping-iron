import test from 'node:test';
import assert from 'node:assert/strict';

import { sealKey, openKey, isSealed, KeyError } from '../src/keys.js';
import { handle, runCron } from '../src/index.js';
import { botEnv, req, world, KEY, KEY_ENC, T0, PLAN, HOOK, body } from './helpers.js';

const env = { KEY_ENC };

test('AES-GCM: sealed and opened; a fresh IV each time; bound to the user row', async () => {
    const a = await sealKey(KEY, env, 'user-a');
    const b = await sealKey(KEY, env, 'user-a');
    assert.ok(isSealed(a));
    assert.notEqual(a, b, 'random IV');
    assert.ok(!a.includes(KEY));
    assert.deepEqual(await openKey(a, env, 'user-a'), { key: KEY, legacy: false });
    await assert.rejects(openKey(a, env, 'user-b'), KeyError, 'copied to another row: does not open');
    await assert.rejects(openKey(a, { KEY_ENC: Buffer.alloc(32, 9).toString('base64') }, 'user-a'), /KEY_ENC changed/);
    await assert.rejects(sealKey(KEY, {}, 'u'), /no KEY_ENC/);
    await assert.rejects(sealKey(KEY, { KEY_ENC: 'short' }, 'u'), /32 random bytes/);
    assert.deepEqual(await openKey(KEY, env, 'u'), { key: KEY, legacy: true }, 'a 1.0 plain key still reads');
});

test('PUT /plan stores the key sealed; nowhere in D1 is it plain', async () => {
    const e = await botEnv();
    await handle(req('PUT', '/plan', { invite: 'x', body: { tornKey: KEY, webhookUrl: HOOK, plan: PLAN } }), e);
    const dump = JSON.stringify([...e.DB.users.values()]);
    assert.ok(!dump.includes(KEY));
});

test('no KEY_ENC on the Worker: a key is refused with a pointer to SETUP.md', async () => {
    const e = await botEnv({ KEY_ENC: '' });
    const r = await handle(req('PUT', '/plan', { invite: 'x', body: { tornKey: KEY } }), e);
    assert.equal(r.status, 500);
    assert.match((await r.json()).error, /KEY_ENC.*SETUP\.md/);
    assert.equal(e.DB.users.size, 0);
});

test('a 1.0 row with a plain key is sealed in place on its first read', async () => {
    const e = await botEnv();
    await handle(req('PUT', '/plan', { invite: 'x', body: { webhookUrl: HOOK, plan: PLAN } }), e);
    const [id] = e.DB.users.keys();
    e.DB.users.get(id).torn_key = KEY; // as 1.0 stored it
    const f = world();
    await runCron(e, T0, f);
    assert.equal(f.calls[0].init.headers.Authorization, 'ApiKey ' + KEY);
    assert.ok(isSealed(e.DB.users.get(id).torn_key));
    assert.equal((await openKey(e.DB.users.get(id).torn_key, e, id)).key, KEY);
});

test('KEY_ENC changed: the user is paused with a clear message, Torn is not called', async () => {
    const e = await botEnv();
    await handle(req('PUT', '/plan', { invite: 'x', body: { tornKey: KEY, webhookUrl: HOOK, plan: PLAN } }), e);
    e.KEY_ENC = Buffer.alloc(32, 1).toString('base64');
    const f = world();
    await runCron(e, T0, f);
    assert.equal(f.calls.length, 0);
    const u = [...e.DB.users.values()][0];
    assert.equal(u.paused, 1);
    assert.match(u.last_error, /could not open your key/);
    // The same key sent again (new KEY_ENC) unpauses.
    const p = await body(handle(req('PUT', '/plan', { body: { tornKey: KEY } }), e));
    assert.equal(p.paused, false);
});
