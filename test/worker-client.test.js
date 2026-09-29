/*
 * The userscript's side of the Discord service: only https://*.workers.dev,
 * a bearer secret, the invite on first connect, and never the main Torn key.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { workerBase, newSecret, stepsForWorker, workerSync, workerTest, workerForget, workerHealth, WorkerError } from '../src/api/worker.js';
import { connectDiscord, maybeSyncPlan, discordState, SYNC_MIN_MS } from '../src/discord.js';
import { gmSet, gmGet } from '../src/platform/gm.js';

const BASE = 'https://pumping-iron.me.workers.dev';
const SECRET = 'b'.repeat(64);

function recorder(body = { ok: true }, status = 200) {
    const calls = [];
    const f = async (url, init = {}) => {
        calls.push({ url, init });
        return { ok: status < 300, status, json: async () => body };
    };
    f.calls = calls;
    return f;
}

test('only https://*.workers.dev addresses', () => {
    assert.equal(workerBase('https://pumping-iron.me.workers.dev/anything?x=1'), BASE);
    assert.throws(() => workerBase('http://pumping-iron.me.workers.dev'), WorkerError);
    assert.throws(() => workerBase('https://evil.example'), /workers\.dev/);
    assert.throws(() => workerBase('https://workers.dev.evil.example'), /workers\.dev/);
    assert.throws(() => workerBase('nope'), /web address/);
});

test('a secret is 64 hex characters', () => {
    assert.match(newSecret(), /^[0-9a-f]{64}$/);
    assert.notEqual(newSecret(), newSecret());
});

test('plan steps go as seconds and words', () => {
    const s = stepsForWorker([{ at: 1790000000123, kind: 'xanax', label: 'Xanax #2', trains: { dex: 27 }, strict: false }, { at: 1790003600000, kind: 'jump', label: 'EDVD × 5 + Ecstasy', trains: { str: 20, def: 3 }, strict: true, tick: 1790003540000 }]);
    assert.deepEqual(s[0], { at: 1790000000, kind: 'xanax', label: 'Xanax #2', train: 'DEX × 27', strict: false, tick: null });
    assert.equal(s[1].train, 'STR × 20 · DEF × 3');
    assert.equal(s[1].tick, 1790003540);
});

test('sync: PUT /plan with the bearer secret, the invite only when given', async () => {
    const f = recorder({ ok: true, created: true, ready: true });
    await workerSync({ base: BASE, secret: SECRET, invite: 'code', plan: { steps: [] }, webhookUrl: 'https://discord.com/api/webhooks/1/x', tornKey: 'WorkerKey1234567', fetchImpl: f });
    assert.equal(f.calls[0].url, BASE + '/plan');
    assert.equal(f.calls[0].init.method, 'PUT');
    assert.equal(f.calls[0].init.headers.authorization, 'Bearer ' + SECRET);
    assert.equal(f.calls[0].init.headers['x-invite'], 'code');
    assert.deepEqual(JSON.parse(f.calls[0].init.body), { plan: { steps: [] }, tornKey: 'WorkerKey1234567', webhookUrl: 'https://discord.com/api/webhooks/1/x' });
    await workerSync({ base: BASE, secret: SECRET, plan: { steps: [] }, fetchImpl: f });
    assert.equal(f.calls[1].init.headers['x-invite'], undefined);
    assert.deepEqual(JSON.parse(f.calls[1].init.body), { plan: { steps: [] } }, 'nothing else rides along');
});

test('test ping, forget, health', async () => {
    const f = recorder();
    await workerTest({ base: BASE, secret: SECRET, fetchImpl: f });
    await workerForget({ base: BASE, secret: SECRET, fetchImpl: f });
    await workerHealth(BASE, { fetchImpl: f });
    assert.deepEqual(f.calls.map((c) => [c.init.method, c.url]), [['POST', BASE + '/test'], ['DELETE', BASE + '/plan'], ['GET', BASE + '/health']]);
});

test('a Worker error comes back in words', async () => {
    await assert.rejects(workerTest({ base: BASE, secret: SECRET, fetchImpl: recorder({ ok: false, error: 'No webhook saved' }, 400) }), /No webhook saved/);
    await assert.rejects(workerTest({ base: BASE, secret: SECRET, fetchImpl: async () => { throw new Error('offline'); } }), /Could not reach/);
});

test('connect: stores the Worker and a secret, never the main Torn key; plan sync is throttled', async () => {
    gmSet('apiKey', 'MainTornKey12345');
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ ok: true, created: true, ready: true }) };
    };
    try {
        const model = { ready: true, steps: [{ at: Date.now() + 60000, kind: 'xanax', label: 'Xanax #2', trains: { dex: 27 } }] };
        await connectDiscord({ base: BASE, invite: 'code', webhookUrl: 'https://discord.com/api/webhooks/1/x', tornKey: 'WorkerKey1234567', discordId: '<@123>' }, model);
        const st = discordState();
        assert.equal(st.base, BASE);
        assert.match(st.secret, /^[0-9a-f]{64}$/);
        assert.equal(st.discordId, '123');
        assert.equal(JSON.stringify(gmGet('worker')).includes('WorkerKey1234567'), false, 'the Worker key is not kept here');
        assert.equal(JSON.stringify(gmGet('worker')).includes('webhooks'), false, 'nor the webhook');
        for (const c of calls) assert.equal(String(c.init.body).includes('MainTornKey12345'), false);
        // A changed plan syncs, but not twice within a minute.
        const now = Date.now() + SYNC_MIN_MS + 1;
        const changed = { ready: true, steps: [{ at: Date.now() + 7200000, kind: 'natural', label: 'Natural energy', trains: { dex: 15 } }] };
        assert.equal(maybeSyncPlan(changed, now), true);
        assert.equal(maybeSyncPlan({ ready: true, steps: [] }, now + 1000), false);
        await new Promise((r) => setTimeout(r, 0));
        assert.equal(calls.length, 2);
    } finally {
        globalThis.fetch = realFetch;
    }
});
