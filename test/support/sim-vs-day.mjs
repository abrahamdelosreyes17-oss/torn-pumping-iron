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
import { XANAX } from '../../src/core/items.js';
import { targetShares } from '../../src/core/plan.js';
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
    simulateStrategy(strategy, { ...simInputs({ state, pc, shares, settings, prices: {}, special: 0, statics: {} }), trace: (x) => rows.push(x) });
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
    const base = simInputs({ state, pc, shares, settings: { horizonDays: 31, budget: Infinity }, prices: {}, special: 0, statics: {} });
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
