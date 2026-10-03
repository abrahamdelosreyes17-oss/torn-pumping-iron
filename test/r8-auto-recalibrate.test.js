/*
 * Round 8 (the accountant, docs/LEDGER-ANSWERS.txt: "everyday at torn reset you will recalibrate the plan once per
 * day. Keep the button for manual recalibration"; the owner: "that's the auto, the manual still there"). The plan
 * recalibrates by itself once a Torn day, from the webpage; Progress still measures you since the plan was made or
 * recalibrated by hand, not since each morning.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { pi, createPlan, recalibratePlan, setWhere, planNowStored } from '../src/runtime.js';
import { K, get, set } from '../src/platform/store.js';
import { pageGet } from '../src/platform/archive.js';
import { autoRecalibrateDue, AUTO_RECAL_AFTER_MS, AUTO_RECAL_RETRY_MS } from '../src/core/saved-plan.js';
import { readLines, addLine, makeLine, progressOf, cutLine, curveAt, PLAN_LINES_KEPT, PLAN_AUTO_LINES_KEPT } from '../src/core/planline.js';
import { DAY, tornDayStart } from '../src/core/bars.js';

const T = Date.UTC(2026, 9, 3, 12, 0);
const TODAY = tornDayStart(T);
const PLAN_NOW = { rev: TODAY - 3 * DAY + 3600e3, createdAt: TODAY - 3 * DAY + 3600e3, recalibratedAt: null, start: TODAY - 3 * DAY, end: TODAY + 27 * DAY };
const due = (o = {}) => autoRecalibrateDue({ planNow: PLAN_NOW, settings: {}, stateAt: T - 60e3, now: T, ...o });

test('due once a Torn day: from two minutes after the reset, with a fresh read, not while a plan runs, in chain mode or after an overdose', () => {
    assert.deepEqual(due(), { due: true, why: 'due' });
    assert.equal(due({ now: TODAY + AUTO_RECAL_AFTER_MS - 1, stateAt: TODAY }).why, 'just after the reset');
    assert.equal(due({ now: TODAY + AUTO_RECAL_AFTER_MS, stateAt: TODAY }).due, true, 'at the reset, when the page is open');
    assert.equal(due({ settings: { autoRecalibrate: false } }).why, 'off');
    assert.equal(due({ planNow: null }).why, 'no plan');
    assert.equal(due({ planNow: { ...PLAN_NOW, end: TODAY } }).why, 'ended');
    assert.equal(due({ busy: true }).why, 'busy');
    assert.equal(due({ stacking: true }).why, 'stacking');
    assert.equal(due({ overdose: true }).why, 'overdose');
    assert.equal(due({ stateAt: T - 11 * 60e3 }).why, 'waiting for a read');
    assert.equal(due({ stateAt: null }).why, 'waiting for a read');
});

test('done for the day once the plan was made or recalibrated today, by you or by itself; a failed try waits half an hour', () => {
    assert.equal(due({ planNow: { ...PLAN_NOW, recalibratedAt: TODAY + 5 * 60e3, rev: TODAY + 5 * 60e3 } }).why, 'done today');
    assert.equal(due({ planNow: { ...PLAN_NOW, createdAt: TODAY + 60e3, rev: TODAY + 60e3 } }).why, 'done today');
    assert.equal(due({ planNow: { ...PLAN_NOW, recalibratedAt: TODAY - 60e3, rev: TODAY - 60e3 } }).due, true, 'yesterday’s recalibration does not count');
    assert.equal(due({ last: { day: TODAY, at: T - 60e3, ok: false } }).why, 'tried');
    assert.equal(due({ last: { day: TODAY, at: T - AUTO_RECAL_RETRY_MS, ok: false } }).due, true);
    assert.equal(due({ last: { day: TODAY, at: T - 60e3, ok: null } }).why, 'another tab', 'a run under way in another tab of the webpage');
    assert.equal(due({ last: { day: TODAY - DAY, at: T - DAY, ok: false } }).due, true, 'yesterday’s failure is not today’s');
});

const R = { daily: Array.from({ length: 30 }, (_, i) => (i + 1) * 1000), quart: Array.from({ length: 90 }, (_, i) => [360, 720, 1080][i % 3]), perStat: { str: 30000, spd: 0, def: 0, dex: 0 }, cost: 0, dayMin: 0 };
const S0 = { str: 1000, spd: 0, def: 0, dex: 0 };

test('Progress: a recalibration by itself carries on from the line before it (you are measured since your own plan, not since this morning)', () => {
    const t0 = TODAY - 3 * DAY;
    let store = addLine(null, makeLine({ at: t0, stats: S0, result: R, strategy: 'path', why: 'create' }));
    // Two mornings on, the plan recalibrates by itself each day; you gained 900 a day against 1,000 planned.
    store = addLine(store, makeLine({ at: t0 + DAY, stats: { ...S0, str: 1900 }, result: R, strategy: 'path', why: 'auto' }));
    store = addLine(store, makeLine({ at: t0 + 2 * DAY, stats: { ...S0, str: 2800 }, result: R, strategy: 'path', why: 'auto' }));
    const lines = readLines(store);
    const p = progressOf(lines, t0 + 2.5 * DAY, 3250);
    assert.equal(p.line.at, t0, 'since the plan was made');
    assert.equal(p.gained, 2250);
    assert.equal(Math.round(p.planned), 2500, '1,000 a day for two days, and half of today');
    assert.equal(Math.round(p.pct), 90);
    assert.equal(Math.round(p.whole), 2000 + 30000, 'what was planned so far, then the line you follow now to its end');
    // A recalibration by hand starts the measure again from that moment.
    const byHand = readLines(addLine(store, makeLine({ at: t0 + 2.5 * DAY, stats: { ...S0, str: 3250 }, result: R, strategy: 'path', why: 'replan' })));
    assert.equal(progressOf(byHand, t0 + 2.75 * DAY, 3400).line.at, t0 + 2.5 * DAY);
});

test('a line that has ended keeps only the days it was the plan, with the same numbers inside them; two months of daily lines are kept', () => {
    const t0 = TODAY - 3 * DAY;
    const year = { ...R, daily: Array.from({ length: 365 }, (_, i) => (i + 1) * 1000), quart: Array.from({ length: 365 * 3 }, (_, i) => [360, 720, 1080][i % 3]) };
    const line = makeLine({ at: t0, stats: S0, result: year, strategy: 'path', why: 'create' });
    const cut = cutLine(line, t0 + DAY);
    assert.equal(cut.daily.length, 3);
    assert.equal(cut.quart.length, 9);
    for (const ms of [3600e3, 12 * 3600e3, DAY - 1, DAY]) assert.equal(curveAt(cut, ms), curveAt(line, ms), 'the same plan at ' + ms / 3600e3 + ' h');
    let store = addLine(null, line);
    for (let i = 1; i <= 70; i++) store = addLine(store, makeLine({ at: t0 + i * DAY, stats: S0, result: year, strategy: 'path', why: 'auto' }));
    const kept = readLines(store);
    assert.equal(kept.length, PLAN_AUTO_LINES_KEPT);
    assert.ok(PLAN_AUTO_LINES_KEPT > PLAN_LINES_KEPT);
    assert.ok(kept.slice(0, -1).every((l) => l.daily.length <= 3), 'every ended line is cut down');
    assert.equal(kept[kept.length - 1].daily.length, 365, 'the line you follow is whole');
    assert.ok(JSON.stringify(store).length < 400e3, 'two months of daily lines stay small: ' + JSON.stringify(store).length);
});

/* The run itself: the same Recalibrate, marked as the plan's own. */
const API = {
    bars: { energy: { current: 20, maximum: 150, increment: 5, interval: 600, tick_time: 120, full_time: 15600 }, happy: { current: 5025, maximum: 5025, increment: 5, interval: 900, tick_time: 300, full_time: 0 } },
    cooldowns: { drug: 232, medical: 0, booster: 0 },
    refills: { energy: false, nerve: false, token: false, special_count: 0 },
    battlestats: { strength: { value: 118400 }, defense: { value: 96200 }, speed: { value: 110900 }, dexterity: { value: 82700 }, total: 408200 },
    gym: { id: 18, name: 'Gun Shop' },
};
const nowPause = () => Promise.resolve();
async function at(t, fn) {
    const real = Date.now;
    Date.now = () => t;
    try {
        return await fn();
    } finally {
        Date.now = real;
    }
}

test('the run: the plan says who recalibrated it, keeps its end date, and the line it starts is the plan’s own ("auto")', async () => {
    pi.model = null;
    pi.saved = null;
    pi.savedLoading = null;
    pi.planBusy = null;
    setWhere('app');
    for (const k of [K.planNow, 'savedPlanFull', K.planLine]) set(k, null);
    const t0 = Date.now();
    set(K.userState, { api: API, at: t0 });
    set(K.plan, { type: 'steady', strategy: 'steady', build: 'baldr', buildPicked: true, strategyPicked: false, pickBy: 'most', createdAt: 1 });
    set(K.settings, null);
    const first = await createPlan({ months: 1, pause: nowPause });
    assert.equal(first.recalibratedBy, null);
    const tomorrow = tornDayStart(t0) + DAY + AUTO_RECAL_AFTER_MS;
    set(K.userState, { api: API, at: tomorrow });
    assert.equal(autoRecalibrateDue({ planNow: planNowStored(), settings: {}, stateAt: tomorrow, now: tomorrow }).due, true);
    const auto = await at(tomorrow, () => recalibratePlan({ auto: true, pause: nowPause }));
    assert.equal(auto.recalibratedBy, 'auto');
    assert.equal(auto.end, first.end);
    assert.equal(planNowStored().recalibratedBy, 'auto');
    assert.equal(autoRecalibrateDue({ planNow: planNowStored(), settings: {}, stateAt: tomorrow, now: tomorrow + 3600e3 }).why, 'done today');
    const lines = readLines(pageGet(K.planLine, null) || get(K.planLine, null));
    assert.deepEqual(lines.map((l) => l.why), ['create', 'auto']);
    // The button still works, any time, and says it was you.
    const hand = await at(tomorrow + 3600e3, () => recalibratePlan({ pause: nowPause }));
    assert.equal(hand.recalibratedBy, 'you');
});
