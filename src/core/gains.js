/*
 * Your real stat gains, plainly (owner, 2026-09-29: "the progress also only shows progression not my actual
 * stat increase"): today, the last 7 and the last 30 Torn days, from the stats Torn reported (statsHistory),
 * not from the plan. And "Last trains" grouped by session. Pure.
 */

import { STATS } from './gain.js';
import { tornDayStart, DAY } from './bars.js';

/** Reads closer than this belong to one session (a session's reads are ~30 s apart). */
export const SESSION_GAP_MS = 10 * 60 * 1000;

/**
 * Stats now against the stats as a window began: `days` Torn days back, today included (1 = today).
 * The window starts at the end of the day before it (or the first read inside it: the day's opening stats).
 * @param {object} history - statsHistory {day: {str,..., total, open?: {str,...}}}
 * @param {object} stats - stats now
 * @returns {null|{total:number, perStat:object, since:number, days:number}} null before any history
 */
export function gainOver(history, stats, now, days) {
    if (!stats) return null;
    const h = history || {};
    const today = tornDayStart(now);
    const start = today - (days - 1) * DAY;
    let base = null;
    let since = start;
    const before = Object.keys(h).map(Number).filter((d) => d < start).sort((a, b) => b - a)[0];
    if (before !== undefined && before >= start - DAY) base = h[before];
    else {
        // No read the day before the window: the first day inside it, from its opening stats (or its end, a day later).
        const first = Object.keys(h).map(Number).filter((d) => d >= start && d <= today).sort((a, b) => a - b)[0];
        if (first === undefined) return null;
        if (h[first] && h[first].open) {
            base = h[first].open;
            since = first;
        } else if (first < today) {
            base = h[first];
            since = first + DAY;
        } else return null;
    }
    if (!base) return null;
    const perStat = {};
    let total = 0;
    for (const k of STATS) {
        perStat[k] = Math.max(0, Math.round((Number(stats[k]) || 0) - (Number(base[k]) || 0)));
        total += perStat[k];
    }
    return { total, perStat, since, days: Math.round((today - since) / DAY) + 1 };
}

/** Today, 7 days, 30 days. */
export function realGains(history, stats, now) {
    return { today: gainOver(history, stats, now, 1), week: gainOver(history, stats, now, 7), month: gainOver(history, stats, now, 30) };
}

/**
 * The gain model's check samples grouped by session (owner: "my 15 trains = +305,123 showed as three rows"):
 * reads within SESSION_GAP_MS of the last one join it. Newest first.
 * @param {object[]} samples - calibration samples {at, stat, trains, predicted, actual, gym}
 * @returns {{at, end, trains:object, gyms:string[], predicted:number, actual:number, reads:number}[]}
 */
export function sessionsOf(samples) {
    const list = (samples || []).filter((x) => x && x.at).slice().sort((a, b) => a.at - b.at);
    const out = [];
    for (const x of list) {
        let s = out[out.length - 1];
        if (!s || x.at - s.end > SESSION_GAP_MS) out.push((s = { at: x.at, end: x.at, trains: {}, gyms: [], predicted: 0, actual: 0, reads: 0 }));
        s.end = x.at;
        s.trains[x.stat] = (s.trains[x.stat] || 0) + (x.trains || 0);
        if (x.gym && !s.gyms.includes(x.gym)) s.gyms.push(x.gym);
        s.predicted += x.predicted || 0;
        s.actual += x.actual || 0;
        s.reads++;
    }
    return out.reverse();
}
