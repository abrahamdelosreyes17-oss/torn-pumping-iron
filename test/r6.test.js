/*
 * The userscript's side of the Discord bot (worker/USERSCRIPT-INTERFACE.md):
 * link codes on a click, acks back and forth (Skip re-times, Done never
 * marks anything done), Torn Eye's list at most every 5 minutes, and never
 * a key that isn't the Worker's own.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { workerSync, workerLink } from '../src/api/worker.js';
import { applyAcks, skippedSteps, SKIP_KEEP_MS } from '../src/discord.js';
import { withoutSkipped } from '../src/core/model.js';
import { gmSet, gmGet } from '../src/platform/gm.js';

const BASE = 'https://pumping-iron.me.workers.dev';
const SECRET = 'c'.repeat(64);

function recorder(body = { ok: true }) {
    const calls = [];
    const f = async (url, init = {}) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => body };
    };
    f.calls = calls;
    return f;
}

test('a link code comes from POST /link with the bearer secret, nothing else', async () => {
    const f = recorder({ ok: true, code: 'ABCD2345', expiresAt: 1790680000 });
    const r = await workerLink({ base: BASE, secret: SECRET, fetchImpl: f });
    assert.equal(r.code, 'ABCD2345');
    assert.equal(f.calls[0].url, BASE + '/link');
    assert.equal(f.calls[0].init.method, 'POST');
    assert.equal(f.calls[0].init.headers.authorization, 'Bearer ' + SECRET);
    assert.equal(f.calls[0].init.body, undefined);
});

test('PUT /plan carries acks back, the targets, player and faction ids; old fields unchanged', async () => {
    const f = recorder({ ok: true });
    const targets = { list: [{ id: 5, name: 'Iron_Monk', level: 23, band: 'stomp', win: 99, keep: 81 }], bands: { 5: 'stomp' } };
    await workerSync({ base: BASE, secret: SECRET, plan: { type: 'steady', steps: [] }, ackIds: ['skip:drug:1'], targets, factionId: 777, playerId: 3000001, fetchImpl: f });
    const body = JSON.parse(f.calls[0].init.body);
    assert.deepEqual(body.ackIds, ['skip:drug:1']);
    assert.deepEqual(body.targets, targets);
    assert.equal(body.factionId, 777);
    assert.equal(body.playerId, 3000001);
    await workerSync({ base: BASE, secret: SECRET, plan: null, fetchImpl: f });
    assert.deepEqual(Object.keys(JSON.parse(f.calls[1].init.body)), ['plan'], 'nothing new unless given');
    const many = Array.from({ length: 80 }, (_, i) => 'a' + i);
    await workerSync({ base: BASE, secret: SECRET, plan: null, ackIds: many, fetchImpl: f });
    assert.equal(JSON.parse(f.calls[2].init.body).ackIds.length, 50, 'at most 50 a sync');
});

test('acks: a skip is remembered for a day and drops that step; a done is only acknowledged', () => {
    gmSet('skippedSteps', []);
    const now = Date.UTC(2026, 8, 29, 12, 0);
    const stepAt = now + 30 * 60000;
    const ids = applyAcks([
        { id: 'skip:drug:1', kind: 'skip', step: { at: stepAt / 1000, kind: 'xanax', label: 'Xanax #2' } },
        { id: 'done:energy:2', kind: 'done', step: { at: now / 1000, kind: 'natural', label: 'Natural energy' } },
        { id: 'skip:test:3', kind: 'skip', step: { at: now / 1000, kind: 'test', label: 'Test' } },
    ], now);
    assert.deepEqual(ids, ['skip:drug:1', 'done:energy:2', 'skip:test:3'], 'every ack goes back');
    const sk = skippedSteps(now);
    assert.equal(sk.length, 1, 'only the real skip is kept');
    const steps = [{ kind: 'xanax', at: stepAt + 3 * 60000, label: 'Xanax #2' }, { kind: 'natural', at: now + 5 * 3600e3, label: 'Natural energy' }, { kind: 'xanax', at: now + 8 * 3600e3, label: 'Xanax #3' }];
    assert.deepEqual(withoutSkipped(steps, sk).map((s) => s.label), ['Natural energy', 'Xanax #3']);
    assert.equal(skippedSteps(now + SKIP_KEEP_MS + 1).length, 0, 'gone after a day');
    assert.ok(Array.isArray(gmGet('skippedSteps', null)));
});

test('the Worker never gets the main Torn key, the FFScouter key or the TornStats key', async () => {
    const f = recorder({ ok: true });
    const main = 'MainTornKey12345';
    const ffs = 'FfsKeyHarness123';
    const ts = 'TornStatsKey9876';
    gmSet('apiKey', main);
    gmSet('ffsKey', ffs);
    gmSet('tsKey', ts);
    await workerSync({ base: BASE, secret: SECRET, plan: { steps: [] }, targets: { list: [{ id: 1, band: 'good' }], bands: { 1: 'good' } }, ackIds: ['x'], fetchImpl: f });
    const sent = JSON.stringify(f.calls);
    for (const k of [main, ffs, ts]) assert.ok(!sent.includes(k));
    const { connectDiscord } = await import('../src/discord.js');
    await assert.rejects(connectDiscord({ base: BASE, tornKey: ffs }, null), /main key/);
});
