/*
 * The plan's line: what the plan you follow says your stats should be at any
 * moment (Progress, the Plan card, Home). Pure. Round 7, review §4.
 *
 * What was wrong: the line was read by Torn day against "you" at the day's
 * last read, so it was a day off (a player doing exactly what the plan said
 * read 151% of plan); a pick re-based the whole line to the plan's first
 * day; Recalibrate wiped it.
 *
 * Now a line is read by time. It starts at the moment it was made (Create
 * plan, Recalibrate, a pick, back to the saved plan) from your stats at that
 * moment, and a new one never erases the ones before it: the old line ends
 * where the new one starts. The simulator's result gives the shape: `daily`
 * (the gain by the end of each of its days: Torn days, the first from its start to Torn's midnight), `quart` (when in each of
 * those days the gain lands, so a jump is a step and steady training a
 * slope) and `statLine` (each stat's own line).
 */

import { DAY } from './bars.js';
import { STATS } from './gain.js';

export const PLAN_LINE_V = 2;

/** Lines kept (the last few picks and recalibrates). */
export const PLAN_LINES_KEPT = 12;
/**
 * Lines kept when the plan recalibrates by itself once a day (round 8): a line a day, each cut down to the days it
 * was the plan, so two months of them are kept.
 */
export const PLAN_AUTO_LINES_KEPT = 60;

/**
 * "N% of plan" is shown once the line is this old and has planned anything. In its first hours a session done a
 * little early or late is most of the number (the plan trains energy as it comes, you train a bar at a time).
 */
export const PCT_MIN_AGE_MS = 6 * 3600e3;
export const MIN_PLANNED_FOR_PCT = 1;

/** Marks a day in `quart`: the minutes by which a quarter, half and three quarters of the day's gain were reached. */
export const QUART = 3;

/**
 * How far into a day's gain the plan is at `minute` of that day, 0–1, from
 * the day's marks. A session lands at once, so the gain reached at a mark is
 * there from that minute on; between two marks the line is straight.
 */
function dayShape(minute, q, len = 1440) {
    const m = Math.max(0, Math.min(len, minute));
    const xs = [0, q[0], q[1], q[2], len];
    const ys = [0, 0.25, 0.5, 0.75, 1];
    // The last mark at or before this minute (marks on the same minute: the highest), then straight to the next.
    let i = 0;
    for (let j = 1; j < 4; j++) if (xs[j] <= m) i = j;
    if (m >= len) return 1;
    const x0 = xs[i];
    const x1 = xs[i + 1];
    return x1 > x0 ? ys[i] + ((ys[i + 1] - ys[i]) * (m - x0)) / (x1 - x0) : ys[i + 1];
}

/**
 * The day grid of a result (round 7, the plan's span): its days are Torn days, the first from the moment the run
 * began to Torn's midnight (`dayMin`: the minute of the Torn day it began at; results and lines from before have
 * none, and their days are 24 h from the start). `ms` after the start → the day it is in, the minute into that day
 * and the day's length (minutes).
 */
function gridAt(dayMin, ms) {
    const first = 1440 - (Number(dayMin) || 0);
    const m = ms / 60000;
    if (m < first) return { i: 0, minute: m, len: first };
    const i = 1 + Math.floor((m - first) / 1440);
    return { i, minute: m - first - (i - 1) * 1440, len: 1440 };
}

/** How long after the start of a run day `d` ends (ms; d = 1: the first day's end, Torn's first midnight). */
export function dayEndMs(dayMin, d) {
    return d <= 0 ? 0 : (1440 - (Number(dayMin) || 0) + (d - 1) * 1440) * 60000;
}

/**
 * A result's total gain `ms` after its simulation began: 0 at the start, the
 * day marks at each day's end, shaped inside a day by `quart`, flat after the end.
 */
export function curveAt(r, ms) {
    const daily = (r && r.daily) || [];
    const n = daily.length;
    if (!n || !(ms > 0)) return 0;
    const { i, minute, len } = gridAt(r.dayMin, ms);
    if (i >= n) return daily[n - 1];
    const a = i === 0 ? 0 : daily[i - 1];
    const b = daily[i];
    const q = r.quart && r.quart.length >= QUART * (i + 1) ? r.quart.slice(QUART * i, QUART * i + QUART) : null;
    // A step inside the day (a jump: every mark at one minute): nothing before it, everything after.
    if (q && q[0] === q[2] && q[0] > 0 && q[0] < len) return minute >= q[0] ? b : a;
    const f = q ? dayShape(minute, q, len) : minute / len;
    return a + (b - a) * f;
}

/** One stat's gain `ms` after the simulation began, from its `statLine` (straight between its marks). */
export function statCurveAt(statLine, k, ms) {
    const arr = statLine && Array.isArray(statLine[k]) ? statLine[k] : null;
    if (!arr || !arr.length || !(ms > 0)) return 0;
    const step = statLine.step || 1;
    const days = statLine.days || arr.length * step;
    // The position in days on the result's day grid (the first day may be a part day).
    const g = gridAt(statLine.dayMin, ms);
    const d = Math.min(days, g.i + g.minute / g.len);
    // Mark j is at day min((j + 1) × step, days).
    const j = Math.min(arr.length - 1, Math.floor(d / step));
    const x0 = j * step;
    const x1 = Math.min((j + 1) * step, days);
    const a = j === 0 ? 0 : arr[j - 1];
    return x1 > x0 ? a + ((arr[j] - a) * Math.max(0, Math.min(1, (d - x0) / (x1 - x0)))) : arr[j];
}

/** Day-by-day per-stat values squeezed to one mark every `step` days (the last at `days`). */
export function statLineFrom(perDay, step = 1) {
    const days = (perDay.str || []).length;
    const out = { step, days, str: [], spd: [], def: [], dex: [] };
    for (const k of STATS) {
        const arr = perDay[k] || [];
        for (let d = step; d < days; d += step) out[k].push(arr[d - 1]);
        if (days > 0) out[k].push(arr[days - 1]);
    }
    return out;
}

/**
 * A new line.
 * @param {object} o
 * @param {number} o.at - when it starts being the plan (ms)
 * @param {number} [o.t0] - when the result's simulation began (the saved plan's own moment; `at` for a new plan)
 * @param {object} o.stats - your stats at `at`
 * @param {object} o.result - the plan's result ({daily, quart, statLine, perStat, cost})
 * @param {string} o.strategy - its id ('path' for the saved path)
 * @param {string} o.why - 'create' | 'replan' | 'auto' (a recalibration that ran by itself) | 'pick' | 'path'
 */
export function makeLine({ at, t0 = at, stats, result, strategy, build = null, why = 'create' }) {
    const off = curveAt(result, at - t0);
    const statOff = {};
    for (const k of STATS) statOff[k] = statCurveAt(result.statLine, k, at - t0);
    return {
        at,
        t0,
        off,
        base: STATS.reduce((a, k) => a + (Number(stats[k]) || 0), 0),
        perStat: Object.fromEntries(STATS.map((k) => [k, Number(stats[k]) || 0])),
        daily: result.daily,
        // The day grid `daily` and `quart` are on (the first day: from the run's start to Torn's midnight).
        dayMin: Number(result.dayMin) || 0,
        quart: result.quart || null,
        statLine: result.statLine || null,
        statOff,
        perStatGain: result.perStat || null,
        cost: result.cost || 0,
        days: result.daily.length,
        strategy,
        build,
        why,
    };
}

/** A line cut to the days it was the plan: until `endAt`, and a day more. Its numbers inside those days do not change. */
export function cutLine(line, endAt) {
    const n = gridAt(line.dayMin, Math.max(0, endAt - line.t0)).i + 2;
    if (!Array.isArray(line.daily) || line.daily.length <= n) return line;
    return { ...line, daily: line.daily.slice(0, n), quart: Array.isArray(line.quart) ? line.quart.slice(0, QUART * n) : line.quart };
}

/** The stored lines (also what 1.3.0 stored: one line from a Torn day's start), oldest first. */
export function readLines(store) {
    if (!store) return [];
    if (store.v === PLAN_LINE_V && Array.isArray(store.lines)) return store.lines.filter((l) => l && Array.isArray(l.daily)).sort((a, b) => a.at - b.at);
    if (Array.isArray(store.daily) && Number.isFinite(store.start)) {
        return [{ at: store.start, t0: store.start, off: 0, base: store.total, perStat: store.perStat || {}, daily: store.daily, quart: null, statLine: null, statOff: {}, perStatGain: store.perStatGain || null, cost: store.cost || 0, days: store.days || store.daily.length, strategy: String(store.key || '').split('|')[1] || null, build: null, why: 'create' }];
    }
    return [];
}

/** The lines with a new one added: it ends the one before it; lines that began at or after it are replaced. */
export function addLine(store, line) {
    const lines = readLines(store).filter((l) => l.at < line.at);
    // A line that has ended keeps only the days it was the plan (a year's line would be a year of numbers, every day).
    const ended = lines.map((l, i) => cutLine(l, i + 1 < lines.length ? lines[i + 1].at : line.at));
    const autos = [...ended, line].filter((l) => l.why === 'auto').length;
    return { v: PLAN_LINE_V, lines: [...ended, line].slice(-(autos ? PLAN_AUTO_LINES_KEPT : PLAN_LINES_KEPT)) };
}

/** The line that is the plan at `t` (null before the first). */
export function lineAt(lines, t) {
    let hit = null;
    for (const l of lines || []) if (l.at <= t) hit = l;
    return hit;
}

/** When a line stops being the plan: the next one's start (Infinity for the last). */
export function lineEnd(lines, line) {
    const i = (lines || []).indexOf(line);
    return i >= 0 && i + 1 < lines.length ? lines[i + 1].at : Infinity;
}

/** What a line plans to have gained by `t` since it began. */
export function planGain(line, t) {
    if (!line || !(t > line.at)) return 0;
    return Math.max(0, curveAt(line, t - line.t0) - line.off);
}

/** Total stats the plan says at `t` (null before any line). */
export function planTotalAt(lines, t) {
    const l = lineAt(lines, t);
    return l ? l.base + planGain(l, t) : null;
}

/** One stat the plan says at `t` (null before any line). Lines from before round 7 have no per-stat line: the stat's share of the plan's whole gain. */
export function planStatAt(lines, k, t) {
    const l = lineAt(lines, t);
    if (!l) return null;
    const base = Number(l.perStat && l.perStat[k]) || 0;
    if (l.statLine) return base + Math.max(0, statCurveAt(l.statLine, k, t - l.t0) - ((l.statOff && l.statOff[k]) || 0));
    const whole = l.daily.length ? l.daily[l.daily.length - 1] : 0;
    const share = whole > 0 && l.perStatGain ? (l.perStatGain[k] || 0) / whole : 0;
    return base + planGain(l, t) * share;
}

/** What the plan gains between two moments, across the lines that were the plan in between (a day's "planned"). */
export function plannedBetween(lines, t1, t2) {
    let sum = 0;
    let any = false;
    for (const l of lines || []) {
        const from = Math.max(t1, l.at);
        const to = Math.min(t2, lineEnd(lines, l));
        if (!(to > from)) continue;
        any = true;
        sum += planGain(l, to) - planGain(l, from);
    }
    return any ? sum : null;
}

/**
 * Where you stand against the line you follow now: gained and planned since
 * it began, and the share. `pct` is null until the plan has planned anything.
 */
export function progressOf(lines, t, total) {
    const cur = lineAt(lines, t);
    if (!cur) return null;
    // A recalibration that ran by itself (once a day) carries on from the line before it: you are measured since
    // the plan was made, picked or recalibrated by hand, not since this morning.
    let i = lines.indexOf(cur);
    while (i > 0 && lines[i].why === 'auto') i--;
    const line = lines[i];
    const before = line === cur ? 0 : plannedBetween(lines, line.at, cur.at) || 0;
    const planned = before + planGain(cur, t);
    const gained = total - line.base;
    return { line, gained, planned, pct: planned >= MIN_PLANNED_FOR_PCT && t - line.at >= PCT_MIN_AGE_MS ? (100 * gained) / planned : null, whole: before + Math.max(0, (cur.daily.length ? cur.daily[cur.daily.length - 1] : 0) - cur.off) };
}

const sumStats = (o) => STATS.reduce((a, k) => a + (Number(o && o[k]) || 0), 0);

/**
 * One Torn day's gained and planned. Gained: what Torn's stats really rose
 * (the day's opening read to its last; from the line's start on the day a
 * first line began). Planned: what the lines say for that day (fixed once the
 * day begins: it no longer moves as you train). The day's stored totals fill
 * in where the history or a line is missing.
 * @param {object} o - {lines, history, totals, day, today, nowTotal, gainedToday, plannedToday}
 * @returns {{gained:number|null, planned:number|null}}
 */
export function dayNumbers({ lines = [], history = {}, totals = {}, day, today, nowTotal = null, gainedToday = null, plannedToday = null }) {
    const h = history && history[day];
    const row = totals && totals[day];
    const end = day === today ? nowTotal : h ? h.total : null;
    const first = lines.length && lines[0].at >= day && lines[0].at < day + DAY ? lines[0] : null;
    const open = first ? first.base : h && h.open ? sumStats(h.open) : null;
    const gained = open !== null && end !== null ? end - open : day === today ? gainedToday : row ? row.gained || 0 : null;
    const p = plannedBetween(lines, day, day + DAY);
    const planned = p !== null ? p : day === today ? plannedToday : row ? row.planned || 0 : null;
    return { gained, planned };
}
