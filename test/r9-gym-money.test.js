/*
 * Session 10, found while checking the owner's Xanax report (docs/sims/round9/stretch-dump.mjs 40 1.829 4). A path
 * under a budget keeps the fee of a gym still to open back from every stretch, and gave it to the stretch the gym
 * was expected in, added to that stretch's budget. A plan that never opened the gym there could spend it on items:
 * the owner at $1.83M a day with 40 Xanax held got an EDVD jump for $73.0M in an 8-day stretch whose own share was
 * $7.4M (it gained 0.06M more than the small plan), and George's then never opened. The rule: a stretch's budget is
 * its item money; the gym it opens is paid apart, out of the money kept back for it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { simulateStrategy } from '../src/core/strategies.js';
import { unlockHook } from '../src/core/year.js';
import { GYMS, gymById, unlockEnergyAfter } from '../src/core/gyms.js';
import { createPlan } from '../src/runtime.js';
import { K, set } from '../src/platform/store.js';
import { XANAX } from '../src/core/items.js';
import { useClock, setNow, setup, noPause, fakeDocument } from './support/ref.mjs';

test('the simulator: with the fees apart, a gym opened is not in the cost; the two add up to what it was', () => {
    const hook = () => unlockHook({ top: 23, progress: unlockEnergyAfter(23) - 3000, gymExpMult: 1, table: GYMS, active: 23, known: [], paid: new Set() });
    const o = { stats: { str: 1e6, spd: 1e6, def: 1e6, dex: 1e6 }, target: 'str', gyms: { str: { dots: 6, energy: 10 } }, happyMax: 5000, prices: { [XANAX]: 830000, points: 30000 }, days: 10 };
    const whole = simulateStrategy('steady', { ...o, unlock: hook() });
    const apart = simulateStrategy('steady', { ...o, unlock: hook(), feesApart: true });
    const fee = gymById(24, GYMS).cost;
    assert.equal(whole.unlocked[0].gymId, 24);
    assert.equal(whole.fees, undefined);
    assert.equal(apart.fees, fee);
    assert.equal(apart.cost + apart.fees, whole.cost);
    assert.equal(apart.gained, whole.gained);
    assert.equal(apart.feeDays.length, 1);
    assert.equal(apart.costDaily.reduce((a, v) => a + v, 0), apart.cost, 'the days add up to the item cost');
    assert.equal(whole.costDaily[apart.feeDays[0].day] - apart.costDaily[apart.feeDays[0].day], fee, 'the fee was on the day the gym opened');
});

// The owner's player on 2026-10-04 at his $1.83M a day, with 40 Xanax held (test/r9-held-drugs.test.js has the same player).
const OWNER_NOW = { name: 'Owner, before George’s', stats: { str: 41e6, spd: 4e6, def: 82e6, dex: 21.5e6 }, happyMax: 4000, gym: 25, build: 'hank:str' };
const HELD = { 35: 1, 37: 1, 38: 4, 39: 1, 209: 1, 210: 37, 310: 8, 366: 20, 367: 30, 527: 7, [XANAX]: 40 };
// The moment of his recalibration (2026-10-04 12:04 UTC) and the prices his plan was made with.
const AT = 1791115475038;
const PRICES = { 35: 918, 36: 56184, 37: 860, 38: 1385, 39: 891, 151: 367180, 197: 34039, 206: 815000, 209: 892, 210: 912, 310: 1061, 366: 4324800, 367: 14098180, 527: 56050, 528: 90501, 529: 155625, 556: 161963, 586: 365513, 587: 376657, 634: 91793, 1028: 5051541, 1039: 782001, 1312: 1069324, points: 30987 };

test('the path: the money kept for George’s buys George’s, not an EDVD jump (the owner at $1.83M a day, 40 Xanax held)', async () => {
    useClock(AT);
    globalThis.document = fakeDocument();
    setNow(AT);
    const perDay = 1.829e6;
    setup(OWNER_NOW, { plan: { pickBy: 'most', pickByPicked: true }, settings: { budget: perDay * 30, horizonDays: 30 }, prices: Object.fromEntries(Object.entries(PRICES).map(([id, u]) => [id, { u, low: u, at: AT }])) });
    set(K.unlocked, [...Array.from({ length: 23 }, (_, i) => i + 1), 25]);
    set(K.gymProgress, { nextId: 24, energy: 59305 });
    set(K.userStatic, { inventory: { ...HELD, cash: 500e6 }, inventoryAt: AT });
    const saved = await createPlan({ months: 3, pause: noPause });
    set(K.userStatic, null);
    set(K.gymProgress, null);
    const y = saved.year;
    const fee = gymById(24, GYMS).cost;
    assert.ok(y.unlocks.some((u) => u.gymId === 24 && u.cost === fee), 'George’s opens (it never did: its money went to an EDVD jump)');
    assert.ok(y.path.cost <= perDay * saved.days * 1.001, 'inside the budget: $' + y.path.cost);
    // No stretch spends the gym's money on items: without the fee, a stretch stays near its own share of the budget.
    const total = y.segments.reduce((a, s) => a + s.cost, 0);
    assert.equal(Math.round(total), Math.round(y.path.cost), 'the stretches add up to the path’s cost');
    let feeSeen = 0;
    for (const s of y.segments) {
        const items = s.cost >= fee ? s.cost - fee : s.cost;
        if (s.cost >= fee) feeSeen++;
        assert.ok(items <= perDay * s.days * 3, s.strategy + ' over ' + s.days + ' days spent $' + Math.round(items) + ' on items (the EDVD jump was $73.0M in 8 days)');
    }
    assert.equal(feeSeen, 1, 'the fee is in one stretch’s cost');
});
