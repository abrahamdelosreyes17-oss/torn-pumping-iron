/*
 * Round 6 (owner, 2026-09-30: "all of Torn is laggy"; "no more automatic"): the plan is made on a click and saved.
 * Nothing works a comparison out by itself any more: no Auto re-pick, no hourly or per-change run, no event switch.
 * Create plan (1/3/6/12 months) and Recalibrate (keeps the end date, re-plans the days left) are the only runs;
 * Torn's pages follow the saved plan's small part and re-time today's steps. Also the engine's happy-terms cache.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { pi, currentModel, refresh, createPlan, recalibratePlan, followStrategy, setWhere, planNowStored } from '../src/runtime.js';
import { K, get, set, dropOldKeys, DROPPED_KEYS } from '../src/platform/store.js';
import { loadSavedPlan } from '../src/platform/plan-store.js';
import { gainPerTrain, happyTerms, HAPPY_CAP, STAT_AB, effectiveStat, round4 } from '../src/core/gain.js';
import { planWindow, daysLeft, addMonths, planProgress, makeSavedPlan, monthlyOf, planNowOf, usablePlanNow, slimResult } from '../src/core/saved-plan.js';
import { DAY, tornDayStart } from '../src/core/bars.js';

const API = {
    bars: { energy: { current: 20, maximum: 150, increment: 5, interval: 600, tick_time: 120, full_time: 15600 }, happy: { current: 5025, maximum: 5025, increment: 5, interval: 900, tick_time: 300, full_time: 0 } },
    cooldowns: { drug: 232, medical: 0, booster: 0 },
    refills: { energy: false, nerve: false, token: false, special_count: 0 },
    battlestats: { strength: { value: 118400 }, defense: { value: 96200 }, speed: { value: 110900 }, dexterity: { value: 82700 }, total: 408200 },
    gym: { id: 18, name: 'Gun Shop' },
};

const nowPause = () => Promise.resolve();

function setup(strategy = 'steady', extra = {}) {
    pi.model = null;
    pi.saved = null;
    pi.savedLoading = null;
    pi.planBusy = null;
    setWhere('app');
    for (const k of [K.planNow, 'savedPlanFull', K.planLine]) set(k, null);
    set(K.userState, { api: API, at: Date.now() });
    set(K.plan, { type: 'steady', strategy, build: 'baldr', buildPicked: true, strategyPicked: false, pickBy: 'most', createdAt: 1, ...extra });
    set(K.settings, null);
}

/** Run with the clock moved on (Date.now only; timers are unaffected). */
async function at(t, fn) {
    const real = Date.now;
    Date.now = () => t;
    try {
        return await fn();
    } finally {
        Date.now = real;
    }
}

test('no plan yet: the model works nothing out, Home asks for one and the steps follow the plan picked', () => {
    setup('steady');
    const m = currentModel();
    assert.ok(m.ready);
    assert.equal(m.compare, null, 'no comparison in the background');
    assert.equal(m.saved, null);
    assert.equal(m.heads[0].text, 'Create your plan');
    assert.ok(m.steps.length, 'today still has steps (steady by default)');
    assert.equal(get(K.planNow, null), null, 'and nothing was saved');
});

test('Create plan (12 months): every plan over the year, saved with what it saw; Torn pages get the small part', async () => {
    setup('dailyChoco');
    const saved = await createPlan({ months: 12, pause: nowPause });
    const pn = planNowStored();
    assert.ok(pn, 'the small part is in GM');
    assert.equal(pn.rev, saved.rev);
    assert.equal(saved.days, Math.round((addMonths(tornDayStart(Date.now()), 12) - tornDayStart(Date.now())) / DAY));
    assert.ok(saved.days >= 365 && saved.days <= 366);
    assert.equal(saved.compare.steady.daily.length, saved.days, 'day by day over the whole year');
    assert.equal(saved.monthly.length, 12, 'a line per month');
    assert.deepEqual(saved.snapshot.stats, { str: 118400, spd: 110900, def: 96200, dex: 82700 }, 'it remembers what it saw');
    assert.equal(get(K.plan, null).strategy, saved.rec.recommended, 'the plan followed is the recommended one');
    assert.ok(!('daily' in pn.slim.steady), 'Torn pages never get the day-by-day lines');
    assert.ok(JSON.stringify(pn).length < 6000, 'planNow stays small: ' + JSON.stringify(pn).length);
    assert.ok(get(K.planLine, null).daily.length === saved.days, 'Progress has the plan line');
    // In node there is no IndexedDB: the whole plan went to GM instead.
    assert.equal((await loadSavedPlan()).rev, saved.rev);
});

test('Torn pages follow the saved plan (light): no ladder, no 30-day projection, nothing re-run on changes', async () => {
    setup('steady');
    const saved = await createPlan({ months: 1, pause: nowPause });
    setWhere('torn');
    pi.saved = null;
    const m = currentModel();
    assert.ok(m.ready && m.compare && m.compare[m.recommendation.recommended]);
    assert.equal(m.ladder, null);
    assert.ok(m.projection.length <= 2, 'only the next days the gym page shows');
    assert.equal(m.savedPlan, null, 'the whole plan is never read on a Torn page');
    // Stats up, a new price, the hour: the saved plan stays as it was (only a click works it out again).
    set(K.userState, { api: { ...API, battlestats: { ...API.battlestats, strength: { value: 200000 } } }, at: Date.now() });
    set(K.prices, { 206: { at: Date.now(), listings: [{ source: 'itemmarket', price: 900000, qty: 50 }] } });
    for (let i = 0; i < 3; i++) refresh();
    assert.equal(planNowStored().rev, saved.rev, 'nothing re-planned by itself');
    assert.equal(pi.planBusy, null);
    setWhere('app');
});

test('Auto never rewrites the plan by itself any more (the old background re-pick is gone)', async () => {
    setup('steady', { pickBy: 'auto' });
    await createPlan({ months: 1, pause: nowPause });
    const picked = get(K.plan, null).strategy;
    const alt = Object.keys(pi.saved.compare).find((id) => id !== picked);
    followStrategy(alt);
    for (let i = 0; i < 3; i++) refresh();
    assert.equal(get(K.plan, null).strategy, alt, 'your pick stays');
    assert.equal(get(K.plan, null).pickBy, 'auto', 'and the Plan rule is untouched');
    assert.equal(get(K.planLine, null).key.split('|')[1], alt, 'Progress follows the pick');
});

test('Recalibrate keeps the end date and re-plans the days left from what is true now (2 months into a year)', async () => {
    setup('steady');
    const t0 = Date.now();
    const first = await createPlan({ months: 12, pause: nowPause });
    const later = t0 + 61 * DAY;
    // Richer and stronger two months on.
    set(K.userState, { api: { ...API, battlestats: { ...API.battlestats, strength: { value: 400000 } } }, at: later });
    const again = await at(later, () => recalibratePlan({ pause: nowPause }));
    assert.equal(again.start, first.start);
    assert.equal(again.end, first.end, 'same end date');
    assert.equal(again.createdAt, first.createdAt);
    assert.equal(again.days, daysLeft(first, later));
    assert.equal(again.days, Math.round((first.end - tornDayStart(later)) / DAY), 'about 10 months left');
    assert.ok(again.days < first.days - 55 && again.days > first.days - 65);
    assert.equal(again.from, tornDayStart(later));
    assert.equal(again.snapshot.stats.str, 400000, 'it re-read your stats');
    assert.equal(again.history.length, 1);
    assert.equal(again.history[0].from.stats.str, 118400);
    assert.equal(again.history[0].to.stats.str, 400000);
    assert.equal(again.compare.steady.daily.length, again.days);
});

test('Recalibrate with no plan says so; two clicks at once run once', async () => {
    setup('steady');
    await assert.rejects(recalibratePlan({ pause: nowPause }), /create one first/);
    const [a, b] = await Promise.all([createPlan({ months: 1, pause: nowPause }), createPlan({ months: 3, pause: nowPause })]);
    assert.equal(a.rev, b.rev, 'the second click waits for the first');
});

test('the saved plan shape: windows, months, progress, the slim part', () => {
    const now = Date.parse('2026-09-30T15:00:00Z');
    const w = planWindow(3, now);
    assert.equal(w.start, Date.parse('2026-09-30T00:00:00Z'));
    assert.equal(w.end, Date.parse('2026-12-30T00:00:00Z'));
    assert.equal(w.days, 91);
    assert.equal(planWindow(7, now).months, 1, 'only 1, 3, 6 or 12');
    assert.equal(addMonths(Date.parse('2026-01-31T00:00:00Z'), 1), Date.parse('2026-02-28T00:00:00Z'));
    const r = { id: 'steady', gained: 3000, cost: 90e6, perStat: { str: 3000, spd: 0, def: 0, dex: 0 }, used: { 206: 90 }, daily: Array.from({ length: 91 }, (_, i) => Math.round(((i + 1) * 3000) / 91)) };
    const months = monthlyOf(r, { start: w.start, days: w.days, stats: { str: 1000, spd: 0, def: 0, dex: 0 } });
    assert.deepEqual(months.map((x) => x.days), [30, 31, 30], 'Sep 30 → Oct 30 → Nov 30 → Dec 30');
    assert.equal(months.reduce((a, x) => a + x.gained, 0), 3000);
    assert.equal(months[2].stats.str, 4000);
    assert.ok(Math.abs(months.reduce((a, x) => a + x.cost, 0) - 90e6) < 3);
    assert.equal(months[0].used[206], 29.7);
    const saved = makeSavedPlan({ compare: { steady: r }, rec: { recommended: 'steady', pickBy: 'most' }, snapshot: { stats: { str: 1000, spd: 0, def: 0, dex: 0 } }, start: w.start, end: w.end, months: 3, days: w.days, budget: Infinity, now });
    assert.equal(saved.budget, null, 'no budget is stored as null');
    const pn = planNowOf(saved);
    assert.ok(usablePlanNow(pn));
    assert.equal(usablePlanNow({ ...pn, v: 0 }), null);
    assert.deepEqual(Object.keys(slimResult(r)).sort(), ['cost', 'gained', 'id', 'perStat', 'used']);
    assert.deepEqual(planProgress(saved, now), { day: 1, of: 91, left: 91, ended: false });
    assert.equal(planProgress(saved, w.end + 3600e3).ended, true);
});

test('keys 1.2.3 kept for its background comparison are dropped once', () => {
    for (const k of DROPPED_KEYS) set(k, { big: 'x'.repeat(100) });
    dropOldKeys();
    for (const k of DROPPED_KEYS) assert.equal(get(k, null), null, k);
});

test('a hidden tab works nothing out; it catches up when shown', () => {
    setup('steady');
    const had = Object.getOwnPropertyDescriptor(globalThis, 'document');
    globalThis.document = { visibilityState: 'hidden' };
    try {
        pi.model = null;
        refresh();
        assert.equal(pi.model, null);
        assert.equal(pi.stale, true);
    } finally {
        if (had) Object.defineProperty(globalThis, 'document', had);
        else delete globalThis.document;
    }
    refresh();
    assert.equal(pi.stale, false);
    assert.ok(pi.model && pi.model.ready);
});

test('happyTerms (kept for the last few happy values) gives gainPerTrain’s exact numbers', () => {
    const old = (stat, S, H, dots, E) => {
        const h = Math.min(HAPPY_CAP, Math.max(0, H || 0));
        const [A, B] = STAT_AB[stat];
        const inner = effectiveStat(S) * round4(1 + 0.07 * round4(Math.log(1 + h / 250))) + 8 * Math.pow(h, 1.05) + (1 - Math.pow(h / HAPPY_CAP, 2)) * A + B;
        return Math.max(0, (inner / 200000) * dots * E);
    };
    for (const H of [0, 1, 249.5, 5025, 4999.75, 5025, 0, 99999, 150000, -3, 5025]) {
        for (const [stat, S] of [['str', 118400], ['def', 2.88e8], ['dex', 0]]) assert.equal(gainPerTrain(stat, S, H, 7.3, 10), old(stat, S, H, 7.3, 10), stat + ' at happy ' + H);
        assert.strictEqual(happyTerms(H), happyTerms(H), 'kept');
    }
});
