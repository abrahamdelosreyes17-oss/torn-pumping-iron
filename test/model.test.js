import test from 'node:test';
import assert from 'node:assert/strict';

import { buildModel, compareStrategies, playerContext, buildOf, projectionFor } from '../src/core/model.js';
import { normalizeState } from '../src/core/bars.js';
import { targetShares } from '../src/core/plan.js';
import { XANAX, POINTS } from '../src/core/items.js';

const T0 = Date.UTC(2026, 8, 29, 10, 48);
const PLAN = { strategy: 'steady', build: 'balanced', goal: null };
const SETTINGS = { horizonDays: 30, budget: 150e6 };

function friend({ at = T0, refill = false, drug = 232 } = {}) {
    return normalizeState({
        bars: { energy: { current: 20, maximum: 150, increment: 5, interval: 600, tick_time: 120 }, happy: { current: 5100, maximum: 5025, increment: 5, interval: 900, tick_time: 300 }, life: { current: 7000, maximum: 7000, increment: 100, interval: 300, tick_time: 60 } },
        cooldowns: { drug, booster: 0 },
        refills: { energy: refill },
        battlestats: { strength: { value: 118400 }, speed: { value: 110900 }, defense: { value: 96200 }, dexterity: { value: 82700 } },
        gym: { id: 18 },
    }, at);
}

const STATICS = { property: { property: { name: 'Private Island' }, happy: 5025 }, inventory: { [XANAX]: 1 }, perks: { property: ['+ 2% gym gains'] } };

test('no state yet: not ready', () => {
    assert.deepEqual(buildModel({ state: null, plan: PLAN, settings: SETTINGS, now: T0 }), { ready: false });
});

test('the strip reads like K: energy, happy with the property, drug countdown, refill planned', () => {
    const m = buildModel({ state: friend(), statics: STATICS, plan: PLAN, settings: SETTINGS, now: T0 });
    assert.equal(m.strip.energy.current, 20);
    assert.equal(m.strip.happy.property, 'Private Island');
    assert.equal(m.strip.drug.left, 232000);
    assert.equal(m.strip.refill.free, true);
    assert.ok(m.strip.refill.plannedAt > T0);
    assert.equal(m.next.label, 'Xanax #1');
});

test('buy today: the plan\'s items minus what you hold', () => {
    const m = buildModel({ state: friend(), statics: STATICS, plan: PLAN, settings: SETTINGS, now: T0 });
    const x = m.buyToday.find((n) => n.id === XANAX);
    assert.equal(x.need, 2);
    assert.equal(x.have, 1);
    assert.equal(x.buy, 1);
    assert.equal(m.buyToday.find((n) => n.id === POINTS).buy, 30);
});

test('heads-up: refill unused near midnight, the next gym, and the plan check', () => {
    const late = Date.UTC(2026, 8, 29, 20, 0);
    const state = friend({ at: late, drug: 3 * 3600 });
    const pc = playerContext(state, STATICS);
    const compare = compareStrategies({ state, pc, shares: targetShares(PLAN, pc.stats, buildOf('balanced').shares), settings: SETTINGS, prices: {} });
    const m = buildModel({ state, statics: STATICS, plan: PLAN, settings: SETTINGS, compare, now: late });
    const texts = m.heads.map((h) => h.text);
    assert.ok(texts.includes('Refill unused'));
    assert.ok(texts.some((t) => /^Force Training/.test(t)));
    assert.ok(texts.includes('Steady training is still best'));
    assert.equal(m.recommendation.recommended, 'steady');
});

test('the next gym uses the gym page\'s progress when it matches the gym being unlocked', () => {
    const m = buildModel({ state: friend(), statics: STATICS, plan: PLAN, settings: SETTINGS, gymProgress: { nextId: 19, energy: 29288 }, now: T0 });
    assert.equal(m.nextGym.gym.name, 'Force Training');
    assert.equal(m.nextGym.known, true);
    assert.equal(m.nextGym.energyLeft, 36610 - 29288);
    const stale = buildModel({ state: friend(), statics: STATICS, plan: PLAN, settings: SETTINGS, gymProgress: { nextId: 12, energy: 5 }, now: T0 });
    assert.equal(stale.nextGym.known, false);
});

test('today\'s done steps come from the log; the gain so far adds them up', () => {
    const log = [{ at: T0 - 3600e3, kind: 'xanax', label: 'Xanax #1', trained: { dex: 2084 }, gain: 2084 }, { at: T0 - 86400e3, kind: 'xanax', label: 'yesterday', trained: { dex: 5 }, gain: 5 }];
    const m = buildModel({ state: friend(), statics: STATICS, plan: PLAN, settings: SETTINGS, log, now: T0 });
    assert.equal(m.done.length, 1);
    assert.equal(m.gainedToday, 2084);
    assert.equal(m.next.label, 'Xanax #2', 'numbering continues after the one taken');
    assert.equal(m.statRows.find((r) => r.stat === 'dex').today, 2084);
});

test('stat rows against the build, with 7-day sparklines from history', () => {
    const history = {};
    for (let d = 0; d < 9; d++) history[Date.UTC(2026, 8, 20 + d)] = { str: 118400, spd: 110900, def: 96200, dex: 80000 + d * 300, total: 0 };
    const m = buildModel({ state: friend(), statics: STATICS, plan: PLAN, settings: SETTINGS, history, now: T0 });
    const dex = m.statRows.find((r) => r.stat === 'dex');
    assert.equal(dex.spark.length, 7);
    assert.ok(dex.gap > 19000 && dex.gap < 20000);
    assert.equal(m.statRows.find((r) => r.stat === 'str').over, true);
});

test('the projection is kept while nothing it depends on changes', () => {
    const args = { stats: { str: 1e5, spd: 1e5, def: 1e5, dex: 9e4 }, shares: buildOf('balanced').shares, energyPerDay: 1620, happy: 5325, unlocked: [1, 2, 3], perks: null, keep: [], days: 3, active: 3, table: playerContext(friend(), {}).table };
    const a = projectionFor(args);
    assert.equal(projectionFor({ ...args }), a);
    assert.notEqual(projectionFor({ ...args, days: 4 }), a);
});

test('a build with its high stat moved ("baldr:dex")', () => {
    assert.equal(buildOf('baldr:dex').shares.dex, 0.309);
    assert.equal(buildOf('nonsense').id, 'balanced');
});
