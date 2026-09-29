/*
 * Your own Xanax cooldowns (owner, 2026-09-29: "xanax isnt the same cooldown each time"). Torn gives a random
 * 6–8 h drug cooldown after a Xanax (360–480 min, docs/research-sallys-xanax.md, 3 sources); the plan used a
 * fixed 7 h for every Xanax after the next one. Each Xanax the feed sees is recorded with the cooldown Torn
 * then showed, and later Xanax are planned at your median. Pure; the feed stores the samples.
 */

import { XANAX_CD_MIN, XANAX } from './items.js';

/** Torn's Xanax cooldown range, minutes. Anything outside (Ecstasy's ~200–230, an overdose's ~24 h) isn't a Xanax. */
export const XANAX_CD_RANGE = [360, 480];

/** Samples kept, and how many it takes before the plan uses your median instead of 7 h. */
export const XANAX_CD_KEEP = 30;
export const XANAX_CD_MIN_SAMPLES = 3;

/**
 * A Xanax taken between two reads: the cooldown Torn showed, plus half the gap between the reads (it was taken
 * somewhere in between). Only when it's in Xanax's range and the plan's step (when known) was a Xanax.
 * @param {object} prev - normalizeState() before
 * @param {object} next - after
 * @param {object} diff - diffStates(prev, next)
 * @param {object|null} [hint] - the plan's next step (names the drug)
 * @returns {{at:number, min:number}|null}
 */
export function xanaxCdSample(prev, next, diff, hint = null) {
    if (!prev || !next || !diff || !diff.drugTaken) return null;
    if (hint && Array.isArray(hint.items) && hint.items.length && !hint.items.some((it) => it.id === XANAX)) return null;
    const min = Math.round((next.drugCd + Math.max(0, next.at - prev.at) / 2000) / 60);
    if (min < XANAX_CD_RANGE[0] - 5 || min > XANAX_CD_RANGE[1] + 5) return null;
    return { at: next.at, min: Math.min(XANAX_CD_RANGE[1], Math.max(XANAX_CD_RANGE[0], min)) };
}

export function addXanaxCd(list, sample) {
    return [...(Array.isArray(list) ? list : []), sample].filter(Boolean).slice(-XANAX_CD_KEEP);
}

/**
 * The cooldown the plan uses for later Xanax: your median once there are a few, else Torn's middle (7 h).
 * @returns {{min:number, n:number, lo:number|null, hi:number|null, own:boolean}}
 */
export function xanaxCdOf(list) {
    const v = (Array.isArray(list) ? list : []).map((s) => Number(s && s.min)).filter((x) => x >= XANAX_CD_RANGE[0] && x <= XANAX_CD_RANGE[1]).sort((a, b) => a - b);
    if (v.length < XANAX_CD_MIN_SAMPLES) return { min: XANAX_CD_MIN, n: v.length, lo: v.length ? v[0] : null, hi: v.length ? v[v.length - 1] : null, own: false };
    const mid = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    return { min: Math.round(mid), n: v.length, lo: v[0], hi: v[v.length - 1], own: true };
}

/** "7h 05m" */
export function hm(min) {
    const m = Math.round(min);
    return Math.floor(m / 60) + 'h ' + String(m % 60).padStart(2, '0') + 'm';
}
