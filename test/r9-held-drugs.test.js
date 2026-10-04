/*
 * Session 10, the owner's report (2026-10-04): "I have Xanax in my inventory and it's not making me use my Xanax".
 * His saved plan (read from the webpage, read only): $1.83M a day, George's still to open, and the path "Steady,
 * fewer Xanax" at 0 Xanax a day for 23 days, with Xanax, 30 FHC, 20 EDVD and 53 candy in his inventory. The cause:
 * only boosters held were used first and free; every Xanax and Ecstasy was priced as bought, so a small budget cut
 * the ones he already owns (docs/sims/round9/held-probe.mjs: 0 or 40 Xanax held gave the same path). The rule: Xanax
 * and Ecstasy held are taken first and free, as boosters are, and the small plan that buys no Xanax still takes the
 * ones held. The simulator (strategies.js) and the day plan (plan.js) keep the same count.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { simulateStrategy } from '../src/core/strategies.js';
import { heldBoosters } from '../src/core/model.js';
import { createPlan } from '../src/runtime.js';
import { K, set } from '../src/platform/store.js';
import { XANAX, ECSTASY, FHC, EDVD } from '../src/core/items.js';
import { PLAYERS, T0, useClock, setNow, setup, noPause, fakeDocument } from './support/ref.mjs';
import { manyDays } from './support/sim-vs-day.mjs';

const PRICE = { [XANAX]: 830000, [ECSTASY]: 70000, points: 30000 };
const BASE = { stats: { str: 1e6, spd: 1e6, def: 1e6, dex: 1e6 }, target: 'str', gyms: { str: { dots: 7.3, energy: 10 } }, happyMax: 5000, prices: PRICE, days: 10 };

test('what a plan uses first out of the inventory: boosters, and now Xanax and Ecstasy', () => {
    assert.deepEqual(heldBoosters({ [XANAX]: 12, [ECSTASY]: 2, [FHC]: 3, [EDVD]: 0, cash: 5e6, 9999: 4 }), { [XANAX]: 12, [ECSTASY]: 2, [FHC]: 3 });
});

test('the simulator: Xanax held are taken first and cost nothing, the rest are bought', () => {
    const none = simulateStrategy('steady', { ...BASE, noRefill: true });
    const some = simulateStrategy('steady', { ...BASE, noRefill: true, held: { [XANAX]: 12 } });
    assert.equal(some.used[XANAX], none.used[XANAX], 'the same Xanax are taken');
    assert.equal(some.gained, none.gained);
    assert.equal(some.used.held[XANAX], 12);
    assert.equal(none.cost - some.cost, 12 * PRICE[XANAX], 'it was $0: every Xanax was priced as bought');
    const all = simulateStrategy('steady', { ...BASE, noRefill: true, held: { [XANAX]: 500 } });
    assert.equal(all.cost, 0);
    assert.equal(all.used.held[XANAX], all.used[XANAX]);
});

test('the simulator: Ecstasy held is free too (daily choco, a jump)', () => {
    for (const id of ['dailyChoco', 'edvdJump']) {
        const none = simulateStrategy(id, { ...BASE, noRefill: true });
        const some = simulateStrategy(id, { ...BASE, noRefill: true, held: { [ECSTASY]: 2 } });
        assert.ok(none.used[ECSTASY] >= 2, id);
        assert.equal(none.cost - some.cost, 2 * PRICE[ECSTASY], id);
        assert.equal(some.used.held[ECSTASY], 2, id);
    }
});

test('the small plan: a budget that buys no Xanax still takes the ones held; a count of 1 or more stays the count', () => {
    const zero = simulateStrategy('steadyLite', { ...BASE, noRefill: true, xanaxPerDay: 0 });
    assert.equal(zero.used[XANAX], 0);
    const own = simulateStrategy('steadyLite', { ...BASE, noRefill: true, xanaxPerDay: 0, held: { [XANAX]: 5 } });
    assert.equal(own.used[XANAX], 5, 'it was 0: "it’s not making me use my Xanax"');
    assert.equal(own.cost, 0);
    assert.ok(own.gained > zero.gained);
    const one = simulateStrategy('steadyLite', { ...BASE, noRefill: true, xanaxPerDay: 1, held: { [XANAX]: 5 } });
    assert.equal(one.used[XANAX], 10, 'one a day for ten days: held ones do not add to the count (what is bought ahead is not taken faster)');
    assert.equal(one.cost, 5 * PRICE[XANAX]);
});

for (const hour of [0, 8, 16]) {
    for (const [n, held, want] of [[0, 7, 7], [0, 40, null], [1, 7, 10], [2, 3, 20]]) {
        test('simulator = day plan · steady with ' + n + ' Xanax a day bought and ' + held + ' held, made at ' + String(hour).padStart(2, '0') + ':00: ten days', () => {
            const { sim, day } = manyDays(PLAYERS.friend, 'steadyLite', { hour, days: 10, xanaxPerDay: n, held: { [XANAX]: held } });
            assert.equal(day.xanax, sim.xanax, 'Xanax taken: simulator ' + sim.xanax + ', day plan ' + day.xanax);
            if (want !== null) assert.equal(sim.xanax, want);
            else assert.ok(sim.xanax > 25 && sim.xanax <= held, 'one per cooldown while they last: ' + sim.xanax);
            assert.equal(sim.heldUsed, Math.min(held, sim.xanax));
        });
    }
}

test('the day plan says where the Xanax comes from when the budget buys none', () => {
    const { day } = manyDays(PLAYERS.friend, 'steadyLite', { hour: 0, days: 2, xanaxPerDay: 0, held: { [XANAX]: 2 } });
    assert.equal(day.xanax, 2);
});

// The owner's player on 2026-10-04 (stats, happy, gyms, the boosters he holds, his prices), at his $1.83M a day.
const OWNER_NOW = { name: 'Owner, before George’s', stats: { str: 41e6, spd: 4e6, def: 82e6, dex: 21.5e6 }, happyMax: 4000, gym: 25, build: 'hank:str' };
const HELD = { 35: 1, 37: 1, 38: 4, 39: 1, 209: 1, 210: 37, 310: 8, 366: 20, 367: 30, 527: 7 };
async function ownerPath(xanax) {
    useClock(T0);
    globalThis.document = fakeDocument();
    setNow(T0);
    setup(OWNER_NOW, { plan: { pickBy: 'most', pickByPicked: true }, settings: { budget: 1.829e6 * 30, horizonDays: 30 } });
    set(K.unlocked, [...Array.from({ length: 23 }, (_, i) => i + 1), 25]);
    set(K.gymProgress, { nextId: 24, energy: 59305 });
    set(K.userStatic, { inventory: { ...HELD, ...(xanax ? { [XANAX]: xanax } : {}), cash: 500e6 }, inventoryAt: T0 });
    const saved = await createPlan({ months: 3, pause: noPause });
    set(K.userStatic, null);
    set(K.gymProgress, null);
    return saved;
}

test('the owner’s plan at $1.83M a day: with 40 Xanax held the first stretch takes them (it was natural energy only for three weeks)', async () => {
    const none = await ownerPath(0);
    const first0 = none.year.segments[0];
    assert.equal(first0.strategy, 'steadyLite');
    assert.equal(first0.xanaxPerDay, 0, 'nothing held: the money is kept for George’s, so no Xanax is bought');
    const some = await ownerPath(40);
    const first = some.year.segments[0];
    assert.ok(!(first.strategy === 'steadyLite' && first.xanaxPerDay === 0), 'the first stretch: ' + first.strategy);
    assert.ok(first.gained > first0.gained * 1.5, 'the first stretch +' + first.gained + ' against +' + first0.gained);
    assert.ok(some.year.path.gained > none.year.path.gained, 'the path +' + some.year.path.gained + ' against +' + none.year.path.gained);
    assert.ok(some.year.path.cost <= 1.829e6 * some.days * 1.001, 'inside the budget: $' + some.year.path.cost);
    assert.equal(some.snapshot.held[XANAX], 40, 'the saved plan says what was held');
    // What a stretch took is gone for the next one: no more than 40 are ever free.
    const bought = some.year.path.cost;
    assert.ok(bought >= ((some.year.path.used[XANAX] || 0) - 40) * 815000 * 0.5, 'the Xanax past the 40 held are paid for');
});
