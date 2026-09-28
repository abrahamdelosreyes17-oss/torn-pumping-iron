import test from 'node:test';
import assert from 'node:assert/strict';

import { makePlan, planTypeOf, dayTimeline, strictWarnings, itemsNeeded, logFromDiff, drugsToday, targetShares, goalEta, STRICT_WARN_MS, REFILL_LAST_CALL_MS } from '../src/core/plan.js';
import { normalizeState, diffStates, tornClock, HOUR, MIN, DAY } from '../src/core/bars.js';
import { BUILDS } from '../src/core/builds.js';
import { unlockedGyms, gymById } from '../src/core/gyms.js';
import { XANAX, ECSTASY, EDVD, CANDY_KISSES, POINTS } from '../src/core/items.js';

const T0 = Date.UTC(2026, 8, 29, 10, 48);
const CTX = { shares: BUILDS.balanced.shares, unlocked: unlockedGyms(18), active: 18, drugsToday: 1 };

function state({ at = T0, energy = 20, drug = 232, refill = false, happy = 5100, booster = 0 } = {}) {
    return normalizeState({
        bars: { energy: { current: energy, maximum: 150, increment: 5, interval: 600, tick_time: 120 }, happy: { current: happy, maximum: 5025, increment: 5, interval: 900, tick_time: 300 } },
        cooldowns: { drug, booster },
        refills: { energy: refill },
        battlestats: { strength: { value: 118400 }, speed: { value: 110900 }, defense: { value: 96200 }, dexterity: { value: 82700 } },
        gym: { id: 18 },
    }, at);
}

test('plan types follow the strategy; a goal makes it a goal plan', () => {
    assert.equal(planTypeOf('steady'), 'steady');
    assert.equal(planTypeOf('chocoJump'), 'jump');
    assert.equal(planTypeOf('dailyChoco'), 'steady');
    assert.equal(makePlan({ strategy: 'edvdJump' }).type, 'jump');
    assert.equal(makePlan({ strategy: 'steady', goal: { kind: 'unlockGym', gymId: 19 } }).type, 'goal');
});

test('steady day (K): Xanax #2 → DEX × 27, refill, natural energy, Xanax #3', () => {
    const steps = dayTimeline({ state: state(), now: T0, strategy: 'steady', ctx: CTX });
    assert.deepEqual(steps.map((s) => [tornClock(s.at), s.kind]), [['10:51', 'xanax'], ['10:56', 'refill'], ['15:56', 'natural'], ['17:51', 'xanax'], ['22:41', 'natural']]);
    assert.equal(steps[0].label, 'Xanax #2');
    assert.deepEqual(steps[0].trains, { dex: 27 });
    assert.equal(steps[0].gyms.dex, 'Gun Shop');
    assert.ok(Math.abs(steps[0].gain - 1400) < 30);
    assert.deepEqual(steps[1].items, [{ id: POINTS, qty: 30 }]);
    assert.equal(steps[3].label, 'Xanax #3');
});

test('a late Xanax shifts every later step', () => {
    const onTime = dayTimeline({ state: state(), now: T0, strategy: 'steady', ctx: CTX });
    // An hour later, the Xanax still not taken (cooldown long over).
    const late = dayTimeline({ state: state({ at: T0 + HOUR, drug: 0, energy: 50 }), now: T0 + HOUR, strategy: 'steady', ctx: CTX });
    assert.equal(late[0].kind, 'xanax');
    assert.equal(late[0].at, T0 + HOUR);
    const xanOn = onTime.filter((s) => s.kind === 'xanax')[1].at;
    const xanLate = late.filter((s) => s.kind === 'xanax')[1].at;
    assert.ok(xanLate - xanOn >= 55 * MIN, 'Xanax #3 moved by the delay');
});

test('an unused refill stays before midnight', () => {
    const at = Date.UTC(2026, 8, 29, 23, 0);
    const steps = dayTimeline({ state: state({ at, drug: 3 * 3600 }), now: at, strategy: 'steady', ctx: CTX });
    const refill = steps.find((s) => s.kind === 'refill');
    assert.ok(refill);
    assert.ok(refill.at < Date.UTC(2026, 8, 30));
    assert.equal(refill.at, Date.UTC(2026, 8, 30) - REFILL_LAST_CALL_MS);
    assert.equal(refill.note, 'Use before 00:00 Torn time');
});

test('no refill step once today\'s is used', () => {
    const steps = dayTimeline({ state: state({ refill: true }), now: T0, strategy: 'steady', ctx: CTX });
    assert.equal(steps.some((s) => s.kind === 'refill'), false);
});

test('a jump: four Xanax without training, then the boost right after a tick, strict', () => {
    const steps = dayTimeline({ state: state(), now: T0, strategy: 'chocoJump', ctx: { ...CTX, drugsToday: 0 } });
    const stacks = steps.filter((s) => s.kind === 'stack');
    assert.equal(stacks.length, 4);
    assert.ok(stacks.every((s) => !Object.keys(s.trains).length));
    const jump = steps.find((s) => s.kind === 'jump');
    assert.equal(jump.strict, true);
    assert.equal(new Date(jump.tick).getUTCMinutes() % 15, 0);
    assert.equal(jump.at, jump.tick + MIN);
    assert.deepEqual(jump.items, [{ id: CANDY_KISSES, qty: 49 }, { id: ECSTASY, qty: 1 }]);
    assert.ok(jump.trains.dex > 90, 'trains the stacked energy');
});

test('a jump warns at T−5 min before the tick, not before, not after', () => {
    const steps = dayTimeline({ state: state(), now: T0, strategy: 'edvdJump', ctx: { ...CTX, drugsToday: 0 } });
    const jump = steps.find((s) => s.kind === 'jump');
    assert.equal(jump.warnAt, jump.tick - STRICT_WARN_MS);
    assert.deepEqual(strictWarnings(steps, jump.warnAt - 1), []);
    const w = strictWarnings(steps, jump.warnAt);
    assert.equal(w.length, 1);
    assert.match(w[0].text, /^In 6 min: EDVD × 5 \+ Ecstasy/);
    assert.deepEqual(strictWarnings(steps, jump.at), []);
    assert.deepEqual(jump.items, [{ id: EDVD, qty: 5 }, { id: ECSTASY, qty: 1 }]);
});

test('a jump already stacking picks up where it is', () => {
    const steps = dayTimeline({ state: state(), now: T0, strategy: 'chocoJump', ctx: { ...CTX, stackedSoFar: 3 } });
    assert.equal(steps.filter((s) => s.kind === 'stack').length, 1);
    assert.equal(steps[0].label, "Xanax #4 of 4 · don't train");
});

test('daily choco: hold one Xanax, then candy + Ecstasy after a tick, then refill', () => {
    const steps = dayTimeline({ state: state(), now: T0, strategy: 'dailyChoco', ctx: CTX });
    assert.equal(steps[0].kind, 'hold');
    const boost = steps.find((s) => s.kind === 'boost');
    assert.equal(boost.strict, true);
    assert.equal(steps[steps.indexOf(boost) + 1].kind, 'refill');
    assert.equal(steps.filter((s) => s.kind === 'boost').length, 1, 'once a day');
});

test('items a day needs: steady = Xanax + 30 points', () => {
    const steps = dayTimeline({ state: state(), now: T0, strategy: 'steady', ctx: CTX });
    assert.deepEqual(itemsNeeded(steps), { [XANAX]: 2, [POINTS]: 30 });
});

test('done steps come from state changes, never a click', () => {
    const a = state({ drug: 0 });
    const b = { ...state({ at: T0 + 60e3, drug: 7 * 3600, energy: 5 }), stats: { str: 118400, spd: 110900, def: 96200, dex: 84100 } };
    const next = { kind: 'xanax', label: 'Xanax #2' };
    let log = logFromDiff([], diffStates(a, b), { at: b.at, nextStep: next });
    assert.equal(log.length, 1);
    assert.equal(log[0].label, 'Xanax #2');
    assert.deepEqual(log[0].trained, { dex: 1400 });
    // More trains a minute later add to the same step.
    const c = { ...b, at: T0 + 120e3, stats: { ...b.stats, dex: 84200 } };
    log = logFromDiff(log, diffStates(b, c), { at: c.at });
    assert.equal(log.length, 1);
    assert.equal(log[0].gain, 1500);
    // Trains hours later without a drug are natural energy.
    const d = { ...c, at: T0 + 5 * HOUR, drugCd: 7 * 3600 - (5 * HOUR - 60e3) / 1000, stats: { ...c.stats, dex: 85000 } };
    log = logFromDiff(log, diffStates(c, d), { at: d.at });
    assert.equal(log[1].kind, 'natural');
    assert.equal(drugsToday(log, d.at), 1);
    // A new Torn day starts a new log.
    assert.equal(logFromDiff(log, { trained: {} }, { at: T0 + DAY }).length, 0);
});

test('a stat-number goal aims each train at what is still missing', () => {
    const stats = { str: 100, spd: 100, def: 100, dex: 100 };
    const plan = makePlan({ goal: { kind: 'statTargets', targets: { dex: 300 } } });
    const s = targetShares(plan, stats, BUILDS.balanced.shares);
    assert.ok(s.dex > s.str && Math.abs(s.str - s.spd) < 1e-12);
    assert.equal(targetShares(makePlan({}), stats, BUILDS.balanced.shares), BUILDS.balanced.shares);
});

test('goal ETA from the current rate', () => {
    const gym = gymById(18);
    const eta = goalEta({ stats: { str: 0, spd: 0, def: 0, dex: 82700 }, targets: { dex: 90000 }, gyms: { dex: gym }, happy: 5325, energyPerDay: 1620 });
    assert.ok(eta.energy > 1000 && eta.energy < 1500);
    assert.ok(eta.days < 1);
    assert.equal(goalEta({ stats: { dex: 1 }, targets: { dex: 5 }, gyms: {}, happy: 0, energyPerDay: 10 }), null);
});
