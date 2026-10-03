/*
 * Round 7: stacking energy for a chain (the userscript's "I'm stacking", synced as plan.chain). The owner: "no Discord
 * bot alerts regarding energy and training" until Resume. Skipped: energy, refill, jump, step. Kept (told without a
 * training step): drug, drugready, booster, stale. Not the jump plan's own stack (plan.type 'jump').
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { dueAlerts, CHAIN_SKIPPED, stackingChain } from '../src/alerts.js';
import { runCron, handle } from '../src/index.js';
import { handleInteraction } from '../src/interactions.js';
import { linkedEnv, world, tornState, T0, PLAN, press, ctx, req, body } from './helpers.js';

// What the userscript sends (type 'jump' + noRefill so a Worker from before round 7 also keeps quiet).
const CHAIN = { type: 'jump', noRefill: true, steps: [], chain: { since: T0 - 3600 } };
const kinds = (a) => a.map((x) => x.kind).sort();
const LATE = Math.floor(T0 / 86400) * 86400 + 86400 - 3600; // 23:00 TCT: the refill nudge's window

/** A jump plan: a strict Xanax on a tick 3 min away, and a jump step now. */
const JUMPS = { type: 'jump', steps: [{ at: T0 + 180, tick: T0 + 180, strict: true, kind: 'stack', label: 'Xanax #4 of 4' }, { at: T0 + 30, kind: 'jump', label: 'EDVD × 5 + Ecstasy, then train it all', train: 'STR × 102' }] };

test('the kinds skipped while stacking for a chain', () => {
    assert.deepEqual(CHAIN_SKIPPED, ['energy', 'refill', 'jump', 'step']);
    assert.ok(stackingChain(CHAIN));
    assert.ok(!stackingChain(PLAN));
    assert.ok(!stackingChain({ type: 'jump', steps: [] }), 'the jump plan stacking Xanax is not a chain');
    assert.ok(!stackingChain(null));
});

test('training: energy full, the refill, jump and step pings go out; stacking for a chain: none of them', () => {
    // Energy full (a 150 bar at 150) while training natural energy.
    assert.deepEqual(kinds(dueAlerts(tornState({ drug: 3600, energy: 150 }), PLAN, T0)), ['energy']);
    assert.deepEqual(dueAlerts(tornState({ drug: 3600, energy: 1000 }), CHAIN, T0), [], 'a full (stacked) bar says nothing');
    assert.deepEqual(dueAlerts(tornState({ drug: 3600, energy: 148 }), CHAIN, T0), [], 'nor "full in 72 s"');
    // The refill unused, an hour before Torn midnight.
    assert.deepEqual(kinds(dueAlerts(tornState({ drug: 3600 }), PLAN, LATE)), ['refill']);
    assert.deepEqual(dueAlerts(tornState({ drug: 3600 }), CHAIN, LATE), []);
    // Jump steps (strict on a tick, and a sequence step).
    assert.deepEqual(kinds(dueAlerts(tornState({ drug: 3600 }), JUMPS, T0)), ['jump', 'step']);
    assert.deepEqual(dueAlerts(tornState({ drug: 3600 }), { ...JUMPS, chain: { since: T0 - 60 } }, T0), [], 'steps synced with the chain flag are ignored too');
});

test('stacking for a chain: the cooldown pings stay, told without a training step', () => {
    // Drug cooldown ending: the plan's next Xanax "then DEX × 27" while training; just the timer while stacking.
    assert.equal(dueAlerts(tornState({ drug: 232 }), PLAN, T0)[0].text, 'Xanax #2, then DEX × 27');
    const d = dueAlerts(tornState({ drug: 232 }), { ...PLAN, chain: { since: T0 - 60 } }, T0);
    assert.deepEqual(kinds(d), ['drug']);
    assert.equal(d[0].text, 'Ready for the next drug');
    assert.equal(d[0].step, null);
    // Booster cooldown ending: pinged (no training plan holds it back).
    const b = dueAlerts(tornState({ drug: 3600, booster: 60 }), CHAIN, T0, {}, { prev: { at: T0 - 60, booster: 120 } });
    assert.deepEqual(kinds(b), ['booster']);
    // Drug ready and unused for 15 minutes: a nudge that doesn't say "train".
    const r = dueAlerts(tornState({ drug: 0 }), CHAIN, T0, {}, { prev: { at: T0 - 60, drug: 0, drugZeroAt: T0 - 20 * 60 } });
    assert.deepEqual(kinds(r), ['drugready']);
    assert.doesNotMatch(r[0].text, /train/);
    assert.match(r[0].text, /Stacking for a chain/);
    // Back from travel: no step to name, no ping.
    assert.deepEqual(dueAlerts(tornState({ drug: 3600, travel: 0 }), CHAIN, T0, {}, { prev: { at: T0 - 60, travel: 30 } }), []);
    // The kinds switched off still stay off.
    assert.deepEqual(dueAlerts(tornState({ drug: 232 }), CHAIN, T0, { drug: false }), []);
});

test('the Worker: a plan synced with chain stops the energy ping; Resume (a plan without it) brings it back', async () => {
    const le = await linkedEnv();
    const sent = () => [...le.env.DB.sent.keys()].filter((k) => k.startsWith(le.id + '|')).map((k) => k.split('|')[1]);
    let r = await body(handle(req('PUT', '/plan', { body: { plan: CHAIN } }), le.env));
    assert.equal(r.ok, true);
    assert.deepEqual(JSON.parse(le.user().plan).chain, CHAIN.chain, 'stored as sent');
    await runCron(le.env, T0, world({ torn: tornState({ drug: 3600, energy: 1000, max: 150 }) }));
    assert.deepEqual(sent().filter((a) => a.startsWith('energy:')), [], 'no energy ping while stacking');
    r = await body(handle(req('PUT', '/plan', { body: { plan: PLAN } }), le.env));
    await runCron(le.env, T0 + 120, world({ torn: tornState({ drug: 3600, energy: 150 }) }));
    assert.equal(sent().filter((a) => a.startsWith('energy:')).length, 1, 'training again: the energy ping');
});

test('the Worker: an energy ping snoozed before "I\'m stacking" doesn\'t come back while stacking', async () => {
    const le = await linkedEnv();
    await runCron(le.env, T0, world({ torn: tornState({ drug: 3600, energy: 150 }) }));
    const key = [...le.env.DB.sent.keys()].find((k) => k.startsWith(le.id + '|energy:'));
    assert.ok(key, 'the energy ping went out');
    const alert = key.split('|')[1];
    await handleInteraction(press('snooze:' + alert, le.env.DB.sent.get(key).message), le.env, world(), ctx(), T0 + 60);
    assert.equal(le.env.DB.sent.get(key).state, 'snoozed');
    await handle(req('PUT', '/plan', { body: { plan: CHAIN } }), le.env);
    const f = world({ torn: tornState({ drug: 3600, energy: 150 }) });
    await runCron(le.env, T0 + 700, f);
    assert.equal(f.calls.filter((c) => c.url.includes('/messages') || c.url.includes('/api/webhooks/')).length, 0, 'no reminder');
    assert.equal(le.env.DB.sent.get(key).state, 'snoozed', 'it waits for Resume');
});

test('a Worker that ignores chain: the payload alone holds back the energy-full and refill pings', () => {
    const old = { type: 'jump', noRefill: true, steps: [] };
    assert.ok(!kinds(dueAlerts(tornState({ drug: 3600, energy: 150 }), old, T0)).includes('energy'));
    assert.ok(!kinds(dueAlerts(tornState({ drug: 3600 }), old, LATE)).includes('refill'));
});
