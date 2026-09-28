/*
 * Energy, happy, cooldowns, refill and Torn time. Pure: every function takes
 * the time it is asked about. Torn time is UTC; a Torn day starts at 00:00
 * UTC. See ENGINE-SPEC §3 and research-api-shapes.md §1 for the bar fields.
 */

import { HAPPY_CAP } from './gain.js';

export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
export const QUARTER = 15 * MIN;

/** Natural regeneration: +5 energy per 10 min (donator/subscriber) or 15 min; +5 happy per 15 min. */
export const ENERGY_PER_TICK = 5;
export const HAPPY_PER_TICK = 5;

export function tornDayStart(t) {
    return Math.floor(t / DAY) * DAY;
}

export function msToTornMidnight(t) {
    return tornDayStart(t) + DAY - t;
}

/** The next :00/:15/:30/:45 Torn time strictly after t. */
export function nextQuarterTick(t) {
    return (Math.floor(t / QUARTER) + 1) * QUARTER;
}

/** "10:48" in Torn time (UTC). */
export function tornClock(t) {
    const d = new Date(t);
    return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}

/** A countdown the way the app shows it: "3:52" under an hour (m:ss), "2h 42m" above, "now" at 0. */
export function countdown(ms) {
    if (!(ms > 0)) return 'now';
    const s = Math.ceil(ms / 1000);
    if (s < 3600) return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h + 'h ' + String(m).padStart(2, '0') + 'm';
}

function bar(b, fallbackMax, increment, intervalS) {
    const o = b && typeof b === 'object' ? b : {};
    return {
        current: Number(o.current) || 0,
        maximum: Number(o.maximum) || fallbackMax,
        increment: Number(o.increment) || increment,
        interval: Number(o.interval) || intervalS,
        tickTime: Number.isFinite(Number(o.tick_time)) ? Number(o.tick_time) : intervalS,
        fullTime: Number(o.full_time) || 0,
    };
}

const API_STAT = { strength: 'str', speed: 'spd', defense: 'def', dexterity: 'dex' };

/**
 * One call's answer (`/v2/user?selections=bars,cooldowns,refills,battlestats,gym`)
 * as the state the engine reads. Missing parts stay null.
 */
export function normalizeState(api, at) {
    const a = api && typeof api === 'object' ? api : {};
    const bars = a.bars || {};
    const cd = a.cooldowns || {};
    let stats = null;
    if (a.battlestats && typeof a.battlestats === 'object') {
        stats = {};
        for (const [k, short] of Object.entries(API_STAT)) {
            const v = a.battlestats[k];
            stats[short] = Number(v && typeof v === 'object' ? v.value : v) || 0;
        }
    }
    return {
        at,
        energy: bar(bars.energy, 150, ENERGY_PER_TICK, 600),
        happy: bar(bars.happy, 5025, HAPPY_PER_TICK, 900),
        life: bars.life ? bar(bars.life, 0, 0, 300) : null,
        drugCd: Number(cd.drug) || 0,
        boosterCd: Number(cd.booster) || 0,
        medicalCd: Number(cd.medical) || 0,
        refillUsed: a.refills ? Boolean(a.refills.energy) : null,
        stats,
        gymId: a.gym && a.gym.id ? Number(a.gym.id) : null,
        gymName: a.gym && a.gym.name ? String(a.gym.name) : null,
    };
}

/** Is this a donator/subscriber's energy bar (5 per 10 min)? */
export function fastEnergy(state) {
    return state.energy.interval <= 600;
}

/** Ticks of a bar between the state's time and t. */
function ticksBy(b, stateAt, t) {
    if (t <= stateAt) return 0;
    const first = stateAt + b.tickTime * 1000;
    if (t < first) return 0;
    return 1 + Math.floor((t - first) / (b.interval * 1000));
}

/** Energy at time t, with natural regeneration (nothing regenerates above the maximum). */
export function energyAt(state, t) {
    const e = state.energy;
    if (e.current >= e.maximum) return e.current;
    return Math.min(e.maximum, e.current + e.increment * ticksBy(e, state.at, t));
}

/** When energy reaches `target` (≤ maximum) by natural regeneration; the state time if already there; null if never. */
export function energyReachesAt(state, target) {
    const e = state.energy;
    if (e.current >= target) return state.at;
    if (target > e.maximum) return null;
    const ticks = Math.ceil((target - e.current) / e.increment);
    return state.at + e.tickTime * 1000 + (ticks - 1) * e.interval * 1000;
}

/**
 * Happy at time t. Below the maximum it regenerates +5 a tick. Above it,
 * it resets to the maximum at the next quarter tick, unless Ignorance Is
 * Bliss is active (then it keeps regenerating, up to 99,999).
 */
export function happyAt(state, t, { bliss = false } = {}) {
    const h = state.happy;
    const ticks = ticksBy(h, state.at, t);
    if (bliss) return Math.min(HAPPY_CAP, h.current + h.increment * ticks);
    if (h.current > h.maximum) return nextQuarterTick(state.at) <= t ? h.maximum : h.current;
    return Math.min(h.maximum, h.current + h.increment * ticks);
}

export function drugFreeAt(state) {
    return state.at + state.drugCd * 1000;
}

export function boosterFreeAt(state) {
    return state.at + state.boosterCd * 1000;
}

/** Hours of booster cooldown left under the cap at time t (room for EDVD/candy). */
export function boosterRoomH(state, t, capH = 24) {
    const cdLeft = Math.max(0, state.boosterCd * 1000 - (t - state.at));
    return Math.max(0, capH - cdLeft / HOUR);
}

/** Is today's refill still unused at time t? The API flag covers the day of the state; a new Torn day resets it. */
export function refillAvailable(state, t) {
    if (tornDayStart(t) > tornDayStart(state.at)) return true;
    return state.refillUsed === false;
}

/**
 * What changed between two states: the plan marks steps done from these,
 * never from a click (ENGINE-SPEC §6).
 * @returns {{drugTaken:boolean, refillUsed:boolean, boosterUsed:boolean, energySpent:number, trained:object}}
 */
export function diffStates(prev, next) {
    const out = { drugTaken: false, refillUsed: false, boosterUsed: false, energySpent: 0, trained: {} };
    if (!prev || !next) return out;
    const elapsed = Math.max(0, (next.at - prev.at) / 1000);
    // The drug cooldown only ever counts down; a jump up means a drug was taken.
    if (next.drugCd > Math.max(0, prev.drugCd - elapsed) + 60) out.drugTaken = true;
    if (next.boosterCd > Math.max(0, prev.boosterCd - elapsed) + 60) out.boosterUsed = true;
    if (prev.refillUsed === false && next.refillUsed === true && tornDayStart(prev.at) === tornDayStart(next.at)) out.refillUsed = true;
    if (prev.stats && next.stats) {
        for (const k of Object.keys(next.stats)) {
            const d = (next.stats[k] || 0) - (prev.stats[k] || 0);
            if (d > 0) out.trained[k] = d;
        }
    }
    const expected = energyAt(prev, next.at);
    if (Object.keys(out.trained).length) out.energySpent = Math.max(0, expected - next.energy.current);
    return out;
}
