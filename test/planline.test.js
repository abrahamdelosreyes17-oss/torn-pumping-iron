/*
 * Round 7, R7.2: the plan's line, read by time (core/planline.js).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { curveAt, statCurveAt, statLineFrom, makeLine, addLine, readLines, lineAt, lineEnd, planGain, planTotalAt, planStatAt, plannedBetween, progressOf, dayNumbers, PCT_MIN_AGE_MS, PLAN_LINES_KEPT } from '../src/core/planline.js';
import { monthlyOf } from '../src/core/saved-plan.js';

const DAY = 86400e3;
const HOUR = 3600e3;
const T = Date.UTC(2026, 9, 1, 12);
// Three days: an even day, a jump at minute 245 of day 2, an even day.
const R = { daily: [1000, 5000, 6000], quart: [360, 720, 1080, 245, 245, 245, 360, 720, 1080], perStat: { str: 3000, spd: 3000, def: 0, dex: 0 }, statLine: { step: 1, days: 3, str: [600, 2600, 3000], spd: [400, 2400, 3000], def: [0, 0, 0], dex: [0, 0, 0] }, cost: 9e6 };
const STATS0 = { str: 100, spd: 100, def: 100, dex: 100 };

test('the curve: 0 at the start, the day marks, a slope on an even day, a step on a jump day, flat after the end', () => {
    assert.equal(curveAt(R, 0), 0);
    assert.equal(curveAt(R, DAY), 1000);
    assert.equal(curveAt(R, 12 * HOUR), 500, 'an even day: half way at noon');
    assert.equal(curveAt(R, DAY + 244 * 60e3), 1000, 'before the jump: nothing of it');
    assert.equal(curveAt(R, DAY + 245 * 60e3), 5000, 'the jump lands at once');
    assert.equal(curveAt(R, 2 * DAY - 1), 5000);
    assert.equal(curveAt(R, 10 * DAY), 6000, 'flat after the plan ends');
    assert.equal(curveAt({ daily: [1000, 2000] }, 36 * HOUR), 1500, 'no shape stored: straight');
    assert.equal(curveAt({ daily: [] }, DAY), 0);
});

test('each stat has its own line; a long plan keeps one mark a week', () => {
    assert.equal(statCurveAt(R.statLine, 'str', 12 * HOUR), 300);
    assert.equal(statCurveAt(R.statLine, 'str', 2 * DAY), 2600);
    assert.equal(statCurveAt(R.statLine, 'def', 2 * DAY), 0);
    assert.equal(statCurveAt(null, 'str', DAY), 0);
    const perDay = { str: Array.from({ length: 16 }, (_, i) => (i + 1) * 10), spd: Array(16).fill(0), def: Array(16).fill(0), dex: Array(16).fill(0) };
    const weekly = statLineFrom(perDay, 7);
    assert.deepEqual(weekly.str, [70, 140, 160], 'days 7, 14 and the last (16)');
    assert.equal(statCurveAt(weekly, 'str', 7 * DAY), 70);
    assert.equal(statCurveAt(weekly, 'str', 15 * DAY), 150, 'between day 14 and day 16');
    assert.equal(statCurveAt(weekly, 'str', 99 * DAY), 160);
});

test('lines: a new one ends the one before it and never erases it; a pick follows the saved run from where it stands', () => {
    let store = addLine(null, makeLine({ at: T, stats: STATS0, result: R, strategy: 'path', why: 'create' }));
    let lines = readLines(store);
    assert.equal(lines.length, 1);
    assert.equal(planTotalAt(lines, T - 1), null, 'before the plan: no line');
    assert.equal(planTotalAt(lines, T), 400);
    assert.equal(planTotalAt(lines, T + DAY), 1400);
    // A pick 36 hours in, at stats 2,000 total: the picked plan's own run (made at T) from there on.
    const P = { daily: [300, 600, 900], perStat: { str: 900, spd: 0, def: 0, dex: 0 }, statLine: { step: 1, days: 3, str: [300, 600, 900], spd: [0, 0, 0], def: [0, 0, 0], dex: [0, 0, 0] } };
    const at = T + 36 * HOUR;
    store = addLine(store, makeLine({ at, t0: T, stats: { str: 1700, spd: 100, def: 100, dex: 100 }, result: P, strategy: 'steady', why: 'pick' }));
    lines = readLines(store);
    assert.equal(lines.length, 2, 'the first line stays');
    assert.equal(lineEnd(lines, lines[0]), at);
    assert.equal(lineAt(lines, at - 1).strategy, 'path');
    assert.equal(lineAt(lines, at).strategy, 'steady');
    assert.equal(planTotalAt(lines, at), 2000, 'the new line starts where you are');
    assert.equal(planTotalAt(lines, at + 12 * HOUR), 2150, 'and gains what the picked plan gains over those hours (450 to 600)');
    assert.equal(planStatAt(lines, 'str', at + 12 * HOUR), 1850);
    assert.equal(planGain(lines[1], at - 5), 0);
    // A day across both lines: each line's part of it.
    assert.equal(plannedBetween(lines, T + DAY, T + 2 * DAY), 5000 - 1000 + (600 - 450));
    assert.equal(plannedBetween(lines, T - 2 * DAY, T - DAY), null, 'no line that day');
    // Only the newest few are kept.
    for (let i = 0; i < 20; i++) store = addLine(store, makeLine({ at: at + (i + 1) * HOUR, stats: STATS0, result: R, strategy: 'x' + i }));
    assert.equal(readLines(store).length, PLAN_LINES_KEPT);
});

test('a line stored by 1.3.0 (one line from the start of a Torn day) still reads', () => {
    const old = { key: '123|steady|baldr:str', start: T, total: 400, perStat: STATS0, daily: [100, 200], perStatGain: { str: 200, spd: 0, def: 0, dex: 0 }, cost: 5, days: 2 };
    const lines = readLines(old);
    assert.equal(lines.length, 1);
    assert.equal(lines[0].strategy, 'steady');
    assert.equal(planTotalAt(lines, T + DAY), 500);
    assert.equal(planStatAt(lines, 'str', T + DAY), 200, 'no per-stat line then: the share of the whole gain');
    assert.deepEqual(readLines(null), []);
});

test('"% of plan": since the line you follow began; no figure in its first hours or while the plan has planned nothing', () => {
    const lines = readLines(addLine(null, makeLine({ at: T, stats: STATS0, result: R, strategy: 'path' })));
    assert.equal(progressOf(lines, T + HOUR, 450).pct, null, 'an hour in: one session is the whole number');
    const p = progressOf(lines, T + DAY, 1400);
    assert.equal(p.gained, 1000);
    assert.equal(p.planned, 1000);
    assert.equal(p.pct, 100);
    assert.equal(p.whole, 6000);
    assert.equal(progressOf(lines, T + PCT_MIN_AGE_MS, 400 + 125).pct, 50);
    assert.equal(progressOf([], T, 400), null);
    const stack = readLines(addLine(null, makeLine({ at: T, stats: STATS0, result: { daily: [0, 4000], quart: [360, 720, 1080, 245, 245, 245] }, strategy: 'edvdJump' })));
    assert.equal(progressOf(stack, T + 20 * HOUR, 400).pct, null, 'a stack day: nothing planned yet, nothing to be behind on');
});

test('the numbers of a day: gained from the stats history, planned from the lines; the stored totals fill the gaps', () => {
    const lines = readLines(addLine(null, makeLine({ at: T, stats: STATS0, result: R, strategy: 'path' })));
    const day0 = Date.UTC(2026, 9, 1);
    const history = { [day0]: { total: 900, open: { str: 50, spd: 100, def: 100, dex: 100 } }, [day0 + DAY]: { total: 4500, open: { str: 600, spd: 100, def: 100, dex: 100 } } };
    // The day the first line began at 12:00: both counted from the start of the line (400), not from the opening read.
    let n = dayNumbers({ lines, history, day: day0, today: day0 + DAY });
    assert.equal(n.gained, 500);
    assert.equal(n.planned, 500, 'the first 12 hours of the plan');
    n = dayNumbers({ lines, history, day: day0 + DAY, today: day0 + DAY, nowTotal: 2000 });
    assert.equal(n.gained, 1100, 'today: from the opening read of the day to now');
    assert.equal(n.planned, 4500, 'the plan for the whole day (12 h of day one, the jump of day two)');
    // No line and no history: what the stored totals of the day said.
    assert.deepEqual(dayNumbers({ lines: [], history: {}, totals: { [day0]: { gained: 7, planned: 9 } }, day: day0, today: day0 + DAY }), { gained: 7, planned: 9 });
    assert.deepEqual(dayNumbers({ lines: [], history: {}, totals: {}, day: day0, today: day0, gainedToday: 3, plannedToday: 4 }), { gained: 3, planned: 4 });
});

test('the months row counts in the months of the plan after a Recalibrate, and each stat follows its own line', () => {
    const start = Date.UTC(2026, 9, 1);
    const days = 61;
    const r = { daily: Array.from({ length: days }, (_, i) => (i + 1) * 100), gained: 6100, cost: 61e6, perStat: { str: 6100, spd: 0, def: 0, dex: 0 }, used: {}, statLine: { step: 1, days, str: Array.from({ length: days }, (_, i) => (i + 1) * 100), spd: Array(days).fill(0), def: Array(days).fill(0), dex: Array(days).fill(0) } };
    const whole = monthlyOf(r, { start, days, stats: STATS0 });
    assert.deepEqual(whole.map((m) => new Date(m.to).toISOString().slice(0, 10)), ['2026-11-01', '2026-12-01']);
    assert.equal(whole[0].stats.str, 100 + 3100);
    // Recalibrated on 20 Oct: the first cell ends on 1 Nov (the month of the plan), not on 20 Nov.
    const from = Date.UTC(2026, 9, 20);
    const left = monthlyOf({ ...r, daily: r.daily.slice(0, 42), gained: 4200 }, { start: from, days: 42, stats: STATS0, anchor: start });
    assert.deepEqual(left.map((m) => new Date(m.to).toISOString().slice(0, 10)), ['2026-11-01', '2026-12-01']);
    assert.deepEqual(left.map((m) => m.days), [12, 30]);
});
