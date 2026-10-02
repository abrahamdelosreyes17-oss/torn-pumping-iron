/*
 * The simulator (core/strategies.js) and the day plan (core/plan.js) side by
 * side: every strategy lives in both, and round 7's rule is that they change
 * together. For one player and plan this gives the first boosted session
 * (the jump, or the day's candy boost, with the refill that follows it) as
 * each of them works it out from the same moment.
 */
import { simulateStrategy, STRATEGIES } from '../../src/core/strategies.js';
import { buildModel, simInputs, playerContext, buildOf } from '../../src/core/model.js';
import { normalizeState, tornDayStart } from '../../src/core/bars.js';
import { XANAX, ECSTASY_CD_MIN, BOOSTER_CAP_H, boosterHours } from '../../src/core/items.js';
import { targetShares, dayTimeline } from '../../src/core/plan.js';
import { STATS } from '../../src/core/gain.js';
import { T0, apiOf, sessionsOfTrace } from './ref.mjs';

/** The plans with a boosted session (jumps and daily boosts). */
export const BOOSTED = Object.values(STRATEGIES).filter((s) => s.kind === 'jump' || s.kind === 'boost').map((s) => s.id);

/**
 * @returns {{sim: {at, energy, gain, trains}, day: {at, energy, gain, trains}}} the first boosted session each way
 *   (at: minutes from the start; trains: per stat)
 */
export function firstBoost(p, strategy, { now = T0, days = 31 } = {}) {
    const state = normalizeState(apiOf(p), now);
    const unlockedKnown = Array.from({ length: p.gym }, (_, i) => i + 1);
    const pc = playerContext(state, {}, { unlockedKnown });
    const plan = { strategy, build: p.build, goal: null };
    const shares = targetShares(plan, pc.stats, buildOf(p.build).shares);
    const settings = { horizonDays: days, budget: Infinity };
    // The simulator, with the inputs Create plan gives it.
    const rows = [];
    simulateStrategy(strategy, { ...simInputs({ state, pc, shares, settings, prices: {}, special: 0, statics: {}, live: true }), trace: (x) => rows.push(x) });
    // Its first session above the maximum happy: the boost, and the refill trained right after it.
    const s = sessionsOfTrace(rows).find((x) => x.H0 > p.happyMax + 100);
    const sim = s ? { at: s.t, energy: s.energy, gain: s.gain, trains: { ...s.trains } } : null;
    // The day plan, as Home builds it for the same moment.
    const m = buildModel({ state, statics: {}, plan, settings, log: [], now, unlockedKnown });
    const steps = m.ahead.concat(m.lookAhead).sort((a, b) => a.at - b.at);
    const b = steps.find((x) => x.kind === 'jump' || x.kind === 'boost');
    let day = null;
    if (b) {
        day = { at: Math.round((b.at - now) / 60e3), energy: 0, gain: 0, trains: {} };
        const seen = new Set();
        for (const x of steps) {
            // The boost and what's trained with it (the refill, special refills): the steps within 5 minutes of it.
            if (x.at < b.at || x.at > b.at + 5 * 60e3 || seen.has(x.id + x.at)) continue;
            seen.add(x.id + x.at);
            day.energy += x.energy || 0;
            for (const part of x.parts || []) day.gain += part.gain;
            for (const k of STATS) if (x.trains && x.trains[k]) day.trains[k] = (day.trains[k] || 0) + x.trains[k];
        }
    }
    return { sim, day };
}

/**
 * The jump after the first (round 7, B.2: the jump cycle): the simulator's second jump against the day plan as the
 * player sees it once the first one is trained (the bar empty, the Ecstasy's and the boosters' cooldowns starting, the
 * refill used, the stats the simulator has then).
 * @returns {{sim: {at, bar, energy, gain, trains}, day: {at, bar, energy, gain, trains}}} at: minutes from the plan's
 *   start; bar: the energy in the bar at the jump; energy, gain, trains: the jump and the refill trained with it
 */
export function secondJump(p, strategy, { now = T0, days = 31 } = {}) {
    const state = normalizeState(apiOf(p), now);
    const unlockedKnown = Array.from({ length: p.gym }, (_, i) => i + 1);
    const pc = playerContext(state, {}, { unlockedKnown });
    const plan = { strategy, build: p.build, goal: null };
    const shares = targetShares(plan, pc.stats, buildOf(p.build).shares);
    const settings = { horizonDays: days, budget: Infinity };
    const rows = [];
    simulateStrategy(strategy, { ...simInputs({ state, pc, shares, settings, prices: {}, special: 0, statics: {}, live: true }), trace: (x) => rows.push(x) });
    const jumps = sessionsOfTrace(rows).filter((x) => x.H0 > p.happyMax + 100);
    const [first, s] = jumps;
    const sim = s ? { at: s.t, bar: s.E0, energy: s.energy, gain: s.gain, trains: { ...s.trains } } : null;
    // The stats once the first jump is trained, and the boosters it took (from the day plan's own first jump).
    const stats = { ...p.stats };
    for (const x of rows) if (x.t <= first.end) stats[x.k] += x.gain;
    const m0 = buildModel({ state, statics: {}, plan, settings, log: [], now, unlockedKnown });
    const j0 = m0.ahead.concat(m0.lookAhead).find((x) => x.kind === 'jump');
    const boosterH = (j0.items || []).reduce((a, it) => a + boosterHours(it.id) * (it.qty || 0), 0);
    // The minute the first jump is trained: the cooldowns start here, and the bar's next 5 energy comes mid-way to
    // the next ten minutes (the console jump keeps natural energy under its 3 Xanax, so the count matters).
    const t1 = now + first.t * 60e3;
    const api = apiOf(p, { stats, energy: 0, drug: ECSTASY_CD_MIN * 60, booster: Math.round(boosterH * 3600), refillUsed: true });
    api.bars.energy.tick_time = 300;
    const after = normalizeState(api, t1);
    const m = buildModel({ state: after, statics: {}, plan, settings, log: [], now: t1, unlockedKnown });
    const seen = new Set();
    const steps = m.ahead.concat(m.lookAhead).sort((a, b) => a.at - b.at).filter((x) => !seen.has(x.id + x.at) && seen.add(x.id + x.at));
    const b = steps.find((x) => x.kind === 'jump');
    let day = null;
    if (b) {
        day = { at: Math.round((b.at - now) / 60e3), bar: b.energy, energy: 0, gain: 0, trains: {} };
        for (const x of steps) {
            if (x.at < b.at || x.at > b.at + 5 * 60e3) continue;
            day.energy += x.energy || 0;
            for (const part of x.parts || []) day.gain += part.gain;
            for (const k of STATS) if (x.trains && x.trains[k]) day.trains[k] = (day.trains[k] || 0) + x.trains[k];
        }
    }
    return { sim, day };
}

/**
 * A plan over many days, both ways, from a plan made at `hour` (Torn time) with these bars: the refills and Xanax
 * used, the boosts, every jump (its minute and the energy in the bar), and the energy trained. The simulator steps in
 * 5 minutes; the day plan's steps are dayTimeline's with the look-ahead run on to the last day.
 * `byDay`: the refills used in each 24 h from the start, both ways.
 */
export function manyDays(p, strategy, { hour = 12, days = 25, bars = {}, xanaxPerDay = undefined } = {}) {
    const now = tornDayStart(T0) + hour * 3600e3;
    const state = normalizeState(apiOf(p, bars), now);
    const pc = playerContext(state, {}, { unlockedKnown: Array.from({ length: p.gym }, (_, i) => i + 1) });
    const shares = targetShares({ strategy, build: p.build, goal: null }, pc.stats, buildOf(p.build).shares);
    const rows = [];
    const lite = Number.isFinite(xanaxPerDay) ? { xanaxPerDay } : {};
    const r = simulateStrategy(strategy, { ...simInputs({ state, pc, shares, settings: { horizonDays: days, budget: Infinity }, prices: {}, special: 0, statics: {}, live: true }), ...lite, trace: (x) => rows.push(x) });
    const sim = { refills: (r.used.points || 0) / 30, xanax: r.used[XANAX] || 0, boosts: r.used.candyBoosts || 0, energy: r.energyTrained, jumps: sessionsOfTrace(rows).filter((x) => x.H0 > p.happyMax + 100).map((x) => ({ at: x.t, bar: x.E0 })) };
    // The day plan's context as buildModel sets it for a player with nothing held and no perks.
    const ctx = { shares, unlocked: pc.unlocked, perks: pc.perks.mult, keep: [], active: state.gymId, table: pc.table, bliss: false, happyLossMult: pc.perks.happyLossMult, drugsToday: 0, stackedSoFar: 0, boosterCapH: BOOSTER_CAP_H, cdMult: 1, specialHeld: 0, held: {}, ...lite };
    const end = now + days * 86400e3;
    const steps = dayTimeline({ state, now, strategy, ctx, until: end }).filter((x) => x.at < end);
    const xanaxIn = (x) => (x.items || []).reduce((a, it) => a + (it.id === XANAX ? it.qty || 0 : 0), 0);
    const day = { refills: steps.filter((x) => x.kind === 'refill').length, xanax: steps.reduce((a, x) => a + xanaxIn(x), 0), boosts: steps.filter((x) => x.kind === 'boost').length, energy: steps.reduce((a, x) => a + (x.energy || 0), 0), jumps: steps.filter((x) => x.kind === 'jump').map((x) => ({ at: Math.round((x.at - now) / 60e3), bar: x.energy })) };
    return { sim, day, barE: state.energy.maximum };
}

/** A jump plan's cycle over many days (see manyDays). */
export const jumpCycle = (p, strategy, o) => manyDays(p, strategy, o);

/**
 * The small-budget plan ("Steady, fewer Xanax") on its first Torn day, both ways: the Xanax taken, the energy
 * trained and the gain. The day plan trains natural energy a full bar at a time, so at midnight it can hold up to
 * one bar the simulator (which trains as energy comes) has already trained.
 */
export function liteDay(p, xanaxPerDay, { refill = true } = {}) {
    const now = tornDayStart(T0);
    const state = normalizeState(apiOf(p), now);
    const unlockedKnown = Array.from({ length: p.gym }, (_, i) => i + 1);
    const pc = playerContext(state, {}, { unlockedKnown });
    const plan = { strategy: 'steadyLite', build: p.build, goal: null };
    const shares = targetShares(plan, pc.stats, buildOf(p.build).shares);
    const rows = [];
    const base = simInputs({ state, pc, shares, settings: { horizonDays: 31, budget: Infinity }, prices: {}, special: 0, statics: {}, live: true });
    const r = simulateStrategy('steadyLite', { ...base, xanaxPerDay, noRefill: !refill, days: 1, trace: (x) => rows.push(x) });
    const sim = { xanax: r.used[XANAX] || 0, energy: rows.reduce((a, x) => a + x.e, 0), gain: rows.reduce((a, x) => a + x.gain, 0) };
    // The day plan follows the comparison's row (its Xanax a day, its refill).
    const compare = { steadyLite: { ...r, xanaxPerDay, refill } };
    const m = buildModel({ state, statics: {}, plan, settings: { horizonDays: 31 }, log: [], now, unlockedKnown, compare, rec: { recommended: 'steadyLite', alternatives: [], reasons: [] } });
    const today = m.steps.filter((s) => s.at < now + 86400e3);
    const day = { xanax: today.filter((s) => s.kind === 'xanax').length, energy: today.reduce((a, s) => a + (s.energy || 0), 0), gain: today.reduce((a, s) => a + (s.parts || []).reduce((b, x) => b + x.gain, 0), 0), refills: today.filter((s) => s.kind === 'refill').length };
    return { sim, day, barE: state.energy.maximum };
}

/**
 * A plan's first Torn day from bars that are NOT full (energy low, a drug cooldown running, the refill used or not):
 * the simulator (started from those bars: `live`) against the day plan, which always started from them.
 */
export function firstDayFrom(p, strategy, bars) {
    const now = tornDayStart(T0);
    const state = normalizeState(apiOf(p, bars), now);
    const unlockedKnown = Array.from({ length: p.gym }, (_, i) => i + 1);
    const pc = playerContext(state, {}, { unlockedKnown });
    const plan = { strategy, build: p.build, goal: null };
    const shares = targetShares(plan, pc.stats, buildOf(p.build).shares);
    const run = (live) => {
        const rows = [];
        const r = simulateStrategy(strategy, { ...simInputs({ state, pc, shares, settings: { horizonDays: 31, budget: Infinity }, prices: {}, special: 0, statics: {}, live }), days: 1, trace: (x) => rows.push(x) });
        return { xanax: r.used[XANAX] || 0, energy: rows.reduce((a, x) => a + x.e, 0), gain: rows.reduce((a, x) => a + x.gain, 0), refills: (r.used.points || 0) / 30 };
    };
    const m = buildModel({ state, statics: {}, plan, settings: { horizonDays: 31 }, log: [], now, unlockedKnown });
    const today = m.steps.filter((s) => s.at < now + 86400e3);
    const day = { xanax: today.filter((s) => s.kind === 'xanax').length, energy: today.reduce((a, s) => a + (s.energy || 0), 0), gain: today.reduce((a, s) => a + (s.parts || []).reduce((b, x) => b + x.gain, 0), 0), refills: today.filter((s) => s.kind === 'refill').length };
    return { sim: run(true), full: run(false), day, barE: state.energy.maximum };
}
