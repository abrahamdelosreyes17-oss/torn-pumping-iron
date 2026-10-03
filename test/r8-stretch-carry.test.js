/*
 * Round 8, the path's stretches (found by docs/sims/round8/repick-probe.mjs while checking the accountant's ask to
 * switch plans more often). The cause: every stretch after the first started from a full energy bar with no drug or
 * booster cooldown, so a path cut into more stretches trained energy nobody has. The rule: a stretch starts from the
 * bars and cooldowns the one before it ended with.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { simulateStrategy } from '../src/core/strategies.js';
import { segmentsOf, useRepick, REPICK_DAYS } from '../src/core/year.js';
import { createPlan } from '../src/runtime.js';
import { PLAYERS, T0, useClock, setNow, setup, noPause, fakeDocument } from './support/ref.mjs';
import { XANAX, ECSTASY } from '../src/core/items.js';

const BASE = { stats: { str: 1e6, spd: 1e6, def: 1e6, dex: 1e6 }, target: 'str', gyms: { str: { dots: 7.3, energy: 10 } }, happyMax: 5000, prices: { [XANAX]: 830000, [ECSTASY]: 70000, 0: 30000 } };
const next = (r, stats) => ({ start: { energy: r.end.energy, happy: r.end.happy, drugCdMin: r.end.drugCdMin, refillUsed: false }, boosterCdMin: r.end.boosterCdMin, dayMin: 0, stats });
const after = (o, r) => Object.fromEntries(Object.entries(o.stats).map(([k, v]) => [k, v + (r.perStat[k] || 0)]));

test('the run says where it ends: the energy and happy left, and what is left of the drug and booster cooldowns', () => {
    const r = simulateStrategy('steady', { ...BASE, days: 10 });
    assert.ok(r.end.energy >= 0 && r.end.energy < 150, 'steady trains what it has: ' + r.end.energy);
    assert.ok(r.end.drugCdMin >= 0 && r.end.drugCdMin <= 480, 'a Xanax’s cooldown at most: ' + r.end.drugCdMin);
    assert.equal(r.end.boosterCdMin, 0);
    const candy = simulateStrategy('candyXanax', { ...BASE, days: 10 });
    assert.ok(candy.end.boosterCdMin > 0, 'the day’s candy is still on the booster cooldown at midnight');
});

test('the cause: ten days in two halves from a full bar train energy that ten days in one go do not have', () => {
    for (const id of ['steady', 'candyXanax']) {
        const whole = simulateStrategy(id, { ...BASE, days: 10 });
        const a = simulateStrategy(id, { ...BASE, days: 5 });
        const fresh = simulateStrategy(id, { ...BASE, days: 5, stats: after(BASE, a) });
        const carried = simulateStrategy(id, { ...BASE, days: 5, ...next(a, after(BASE, a)) });
        assert.ok(a.energyTrained + fresh.energyTrained > whole.energyTrained + 100, id + ': a fresh second half has ' + (a.energyTrained + fresh.energyTrained - whole.energyTrained) + ' energy more than there is');
        assert.ok(Math.abs(a.energyTrained + carried.energyTrained - whole.energyTrained) <= 60, id + ': carried over, the two halves train what the whole does (' + (a.energyTrained + carried.energyTrained) + ' against ' + whole.energyTrained + ')');
        assert.ok(a.used[XANAX] + carried.used[XANAX] <= whole.used[XANAX] + 1, id + ': no Xanax inside a cooldown');
    }
});

test('the path: more stretches no longer train more energy than there is (the same plan in 30-day and in 7-day stretches)', async () => {
    useClock(T0);
    globalThis.document = fakeDocument();
    const energyOf = async (fn) => {
        useRepick(fn);
        setNow(T0);
        setup(PLAYERS.owner, { plan: { pickBy: 'max', pickByPicked: true } });
        const saved = await createPlan({ months: 3, pause: noPause });
        return { energy: saved.year.path.energyTrained, plans: new Set(saved.year.segments.map((s) => s.strategy)), n: saved.year.segments.length };
    };
    try {
        const month = await energyOf(() => 30);
        const week = await energyOf(() => 7);
        assert.ok(week.n > month.n);
        // Both follow one plan the whole way here, so the energy trained is the plan's own, however it is cut.
        if (month.plans.size === 1 && week.plans.size === 1 && [...month.plans][0] === [...week.plans][0]) assert.ok(Math.abs(week.energy - month.energy) / month.energy < 0.005, '7-day stretches train ' + week.energy + ', 30-day ones ' + month.energy);
        else assert.ok(week.energy <= month.energy * 1.05, 'a different mix of plans, but no free energy: ' + week.energy + ' against ' + month.energy);
    } finally {
        useRepick(null);
    }
    assert.equal(segmentsOf(T0, T0 + 90 * 864e5, []).length, Math.ceil(90 / REPICK_DAYS));
});
