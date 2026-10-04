/*
 * Session 11, the owner: "does pumping iron now use the xanax and edvd etc in
 * inventory?" Xanax, yes (session 10). The boosters held were used only by
 * the plans built on them (Steady + FHC max, the EDVD jump, the candy plans),
 * and a small budget fits none of those. Engine rule: the FHC you hold are
 * used in plain steady training too, whatever the budget, and none is bought
 * (the simulator and the day plan together). EDVD and candy stay with their
 * own plans: at high stats a jump with free EDVD gains less than steady
 * training (docs/sims/round10/held-worth.mjs). Every number here is made up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { simulateStrategy } from '../src/core/strategies.js';
import { dayTimeline } from '../src/core/plan.js';
import { normalizeState, DAY } from '../src/core/bars.js';
import { unlockedGyms } from '../src/core/gyms.js';
import { BUILDS } from '../src/core/builds.js';
import { XANAX, ECSTASY, EDVD, FHC, POINTS } from '../src/core/items.js';

const PRICE = { [XANAX]: 830000, [ECSTASY]: 70000, [EDVD]: 4300000, [FHC]: 14000000, [POINTS]: 30000 };
const SIM = { stats: { str: 1e6, spd: 1e6, def: 1e6, dex: 1e6 }, target: 'str', gyms: { str: { dots: 7.3, energy: 10 } }, happyMax: 5000, prices: PRICE, days: 7 };

test('the simulator: the small plan uses the FHC you hold, and buys none', () => {
    const none = simulateStrategy('steadyLite', { ...SIM, xanaxPerDay: 1 });
    const held = simulateStrategy('steadyLite', { ...SIM, xanaxPerDay: 1, held: { [FHC]: 6 } });
    assert.equal(none.used[FHC] || 0, 0);
    assert.equal(held.used[FHC], 6);
    assert.equal(held.used.held[FHC], 6, 'counted as held: the next stretch starts without them');
    assert.equal(held.cost, none.cost, 'nothing more is paid');
    assert.equal(held.energyTrained, none.energyTrained + 6 * 150, 'a bar of energy each');
    assert.ok(held.gained > none.gained);
});

test('the simulator: plain steady uses them too; with none held nothing changes; Steady + FHC max still buys', () => {
    const none = simulateStrategy('steady', SIM);
    const held = simulateStrategy('steady', { ...SIM, held: { [FHC]: 3 } });
    assert.equal(held.used[FHC], 3);
    assert.equal(held.cost, none.cost);
    assert.ok(held.gained > none.gained);
    assert.equal(none.used[FHC] || 0, 0, 'none held: none used');
    const max = simulateStrategy('steadyMax', { ...SIM, held: { [FHC]: 3 } });
    assert.ok(max.used[FHC] > 3 && max.cost > none.cost, 'the plan built on FHC buys the rest');
    // The EDVD you hold stay with the jump plans: steady training takes none.
    assert.equal(simulateStrategy('steady', { ...SIM, held: { [EDVD]: 20 } }).used[EDVD] || 0, 0);
});

const T0 = Date.UTC(2026, 9, 4, 14, 0);
const state = normalizeState(
    {
        bars: { energy: { current: 150, maximum: 150, increment: 5, interval: 600, tick_time: 120 }, happy: { current: 5000, maximum: 5000, increment: 5, interval: 900, tick_time: 300 } },
        cooldowns: { drug: 0, booster: 0 },
        refills: { energy: false, special_count: 0 },
        battlestats: { strength: { value: 1e6 }, speed: { value: 1e6 }, defense: { value: 1e6 }, dexterity: { value: 1e6 } },
        gym: { id: 18 },
    },
    T0,
);
const CTX = { shares: BUILDS.balanced.shares, unlocked: unlockedGyms(18), active: 18 };
const fhcOf = (steps) => steps.filter((s) => s.kind === 'booster').reduce((n, s) => n + s.items.filter((i) => i.id === FHC).reduce((a, i) => a + i.qty, 0), 0);
const plan = (strategy, ctx) => dayTimeline({ state, now: T0, strategy, ctx: { ...CTX, ...ctx }, until: T0 + 3 * DAY });

test('the day plan: the small plan says to use the FHC you hold after a session, never more than you hold', () => {
    const steps = plan('steadyLite', { xanaxPerDay: 1, held: { [FHC]: 6 } });
    const first = steps.find((s) => s.kind === 'booster');
    assert.ok(first, 'an FHC step');
    assert.match(first.label, /× \d+, train after each/);
    assert.match(first.note, /from your items/);
    assert.ok(steps.indexOf(first) > steps.findIndex((s) => s.kind === 'xanax'), 'after the Xanax session');
    assert.equal(fhcOf(steps), 6, 'all six over the three days, and no seventh');
    assert.equal(fhcOf(plan('steadyLite', { xanaxPerDay: 1 })), 0, 'none held: none planned');
    assert.equal(fhcOf(plan('steady', { held: { [FHC]: 2 } })), 2, 'plain steady too');
});

test('the day plan: with no Xanax at all the FHC follow a natural-energy session', () => {
    const steps = plan('steadyLite', { xanaxPerDay: 0, held: { [FHC]: 2 } });
    assert.ok(!steps.some((s) => s.kind === 'xanax'));
    assert.equal(fhcOf(steps), 2);
});
