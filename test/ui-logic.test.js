/*
 * The webpage's decisions that aren't drawing: buy windows, plan-vs-actual
 * colours, step words.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { needsForWindow } from '../src/ui/app/buy.js';
import { planColor } from '../src/ui/app/progress.js';
import { stepWords } from '../src/ui/app/home.js';
import { XANAX, POINTS } from '../src/core/items.js';

const T0 = Date.UTC(2026, 8, 29, 10, 48);
const model = { now: T0, steps: [{ at: T0 + 180e3, items: [{ id: XANAX, qty: 1 }] }, { at: T0 + 480e3, items: [{ id: POINTS, qty: 30 }] }, { at: T0 + 7 * 3600e3, items: [{ id: XANAX, qty: 1 }] }] };
const compare = { steady: { used: { [XANAX]: 103, [POINTS]: 900 } } };

test('buy windows: today from the timeline, later days at the plan\'s daily average', () => {
    assert.deepEqual(needsForWindow(model, compare, { strategy: 'steady' }, 'today', 30), { [XANAX]: 2, [POINTS]: 30 });
    const three = needsForWindow(model, compare, { strategy: 'steady' }, 'three', 30);
    assert.equal(three[XANAX], Math.ceil(2 + (103 / 30) * 2));
    assert.equal(three[POINTS], 90);
    assert.equal(needsForWindow(model, compare, { strategy: 'steady' }, 'week', 30)[POINTS], 210);
    assert.deepEqual(needsForWindow(model, null, { strategy: 'steady' }, 'week', 30), { [XANAX]: 2, [POINTS]: 30 }, 'no comparison yet: today only');
});

test('plan-vs-actual colours (TrainingPeaks): green ±20%, yellow 50–79% / 121–150%, red further', () => {
    assert.equal(planColor(1), 'good');
    assert.equal(planColor(0.8), 'good');
    assert.equal(planColor(1.2), 'good');
    assert.equal(planColor(0.79), 'warn');
    assert.equal(planColor(0.5), 'warn');
    assert.equal(planColor(1.3), 'warn');
    assert.equal(planColor(1.5), 'warn');
    assert.equal(planColor(0.42), 'bad');
    assert.equal(planColor(1.51), 'bad');
});

test('the next step in words', () => {
    assert.equal(stepWords({ kind: 'xanax', label: 'Xanax #2', trains: { dex: 27 } }), 'Take Xanax #2, then train DEX × 27');
    assert.equal(stepWords({ kind: 'refill', label: 'Refill · 30 points', trains: { dex: 15 } }), 'Use your refill, then train DEX × 15');
    assert.equal(stepWords({ kind: 'natural', label: 'Natural energy', trains: { def: 8, dex: 7 } }), 'Train DEF × 8 · DEX × 7');
    assert.equal(stepWords({ kind: 'stack', label: "Xanax #2 of 4 · don't train", trains: {} }), "Take Xanax #2 of 4 · don't train");
    assert.equal(stepWords({ kind: 'jump', label: 'EDVD × 5 + Ecstasy, then train it all', trains: { str: 102 } }), 'EDVD × 5 + Ecstasy, then train STR × 102');
});
