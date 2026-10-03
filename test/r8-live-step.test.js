/*
 * Session 9, the owner's report with a screenshot of the panel: he trained,
 * the header said "Session done" and the card kept "Train DEX × 6 · about
 * +170,329 · 150 energy" with the bar at 0 / 150. The header follows Torn's
 * own page; the card took its step from our last read of his state, which
 * was from before the train. The panel's step now comes from the bars the
 * page shows (core/gympage.js liveNextStep).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { liveNextStep } from '../src/core/gympage.js';

const T = Date.parse('2026-10-03T18:40:00Z');
const MIN = 60e3;
const train = (at, extra = {}) => ({ id: 'natural-1', at, kind: 'natural', label: 'Natural energy', trains: { dex: 6 }, parts: [{ stat: 'dex', trains: 6, energy: 150, perTrain: 25 }], gain: 170329, energy: 150, ...extra });
const later = [train(T + 70 * MIN, { id: 'natural-2' }), { id: 'refill-3', at: T + 290 * MIN, kind: 'refill', label: 'Refill', trains: { dex: 6 }, parts: [{ stat: 'dex', trains: 6, energy: 150, perTrain: 25 }] }];

test('the cause · the read is from before the train: the first step is still "train with 150 energy" while the bar shows 0', () => {
    const steps = [train(T - MIN), ...later];
    // What the panel did: the model's first step, whatever the bar says.
    assert.equal(steps[0].kind, 'natural');
    assert.ok(steps[0].at <= T && steps[0].energy === 150);
    // By the bar: that train is done, the next step is the one after it.
    const live = liveNextStep(steps, { energy: { current: 0, max: 150 } }, T);
    assert.equal(live.spent, true);
    assert.equal(live.next.id, 'natural-2');
    assert.deepEqual(live.rest.map((x) => x.id), ['refill-3']);
});

test('the step is left alone while it can still be done, and for every step that is not a train on the energy at hand', () => {
    const steps = [train(T - MIN), ...later];
    for (const e of [25, 150, 1000]) assert.equal(liveNextStep(steps, { energy: { current: e, max: 150 } }, T).spent, false, e + ' energy pays a train');
    assert.equal(liveNextStep(steps, { energy: { current: 24, max: 150 } }, T).spent, true, '24 energy pays none');
    // No reading of the bar (another page layout): the model's own step.
    assert.equal(liveNextStep(steps, { energy: null }, T).next.id, 'natural-1');
    assert.equal(liveNextStep(steps, null, T).next.id, 'natural-1');
    // A train still ahead: the bar is expected to be empty until then.
    assert.equal(liveNextStep([train(T + 30 * MIN), ...later], { energy: { current: 0 } }, T).spent, false);
    // A Xanax or a refill gives the energy itself: an empty bar is how it starts.
    for (const kind of ['xanax', 'refill', 'special', 'boost']) assert.equal(liveNextStep([{ ...train(T - MIN), kind }, ...later], { energy: { current: 0 } }, T).spent, false, kind);
    // The last step of the day spent: nothing is next.
    const last = liveNextStep([train(T - MIN)], { energy: { current: 0 } }, T);
    assert.deepEqual([last.spent, last.next, last.rest], [true, null, []]);
    assert.deepEqual(liveNextStep([], { energy: { current: 0 } }, T), { next: null, rest: [], spent: false });
});
