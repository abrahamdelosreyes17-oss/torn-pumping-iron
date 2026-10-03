/*
 * Session 9, list B.1: the simulator says what a plan pays on each day
 * (`costDaily`), and the cash check runs on those days. The cause, first: a
 * jump buys in lumps, so the check on an even cost a day (what the budget
 * offer does) passes a plan whose real days run the cash out.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { simulateStrategy, STRATEGY_IDS } from '../src/core/strategies.js';
import { SAMPLE_PRICES } from '../src/core/items.js';
import { cashCheck, planCash, withCash } from '../src/core/cashflow.js';
import { affordLine } from '../src/core/auto.js';
import { slimResult } from '../src/core/saved-plan.js';
import { yearSteps } from '../src/core/year.js';
import { compareSteps, simInputs, playerContext, buildOf } from '../src/core/model.js';
import { normalizeState } from '../src/core/bars.js';
import { targetShares } from '../src/core/plan.js';
import { PLAYERS, T0, useClock, setNow, setup, noPause, fakeDocument } from './support/ref.mjs';
import { createPlan } from '../src/runtime.js';
import { K, set, setKey } from '../src/platform/store.js';
import { pageSet } from '../src/platform/archive.js';

const DAY = 864e5;
const sum = (a) => a.reduce((s, v) => s + v, 0);
const run = (id, extra = {}) => simulateStrategy(id, { stats: { str: 118400, spd: 0, def: 0, dex: 0 }, target: 'str', gyms: { str: { dots: 6.5, energy: 10 } }, happyMax: 1500, prices: SAMPLE_PRICES, candyCount: 48, ...extra });

test('the cause · an EDVD jump passes the check on an even cost a day and runs out on the days it really pays', () => {
    const r = run('edvdJump');
    const days = r.daily.length;
    const perDay = r.cost / days;
    // Exactly what the plan costs a day comes in, and a little is on hand: an even cost never touches the cash.
    const books = { liquid: 1e6, earnsPerDay: perDay, dated: [], keepAside: 0 };
    const even = cashCheck({ liquid: books.liquid, earnsPerDay: perDay, costDaily: Array.from({ length: days }, () => perDay) });
    assert.equal(even.fits, true, 'the even check: fits');
    const real = planCash(books, r.costDaily);
    assert.equal(real.fits, false, 'the real days: three jump days in a row cost more than comes in');
    assert.equal(real.runsOutDay, 4, 'runs out on day ' + real.runsOutDay + ', after the first three jumps');
    assert.ok(real.lowest < 0);
    // Steady training pays about the same every day: its real days fit where the even cost does.
    const s = run('steady');
    assert.equal(planCash({ liquid: 1e6, earnsPerDay: s.cost / s.daily.length, dated: [], keepAside: 0 }, s.costDaily).fits, true);
});

test('costDaily: one figure for each day of `daily`, adding up to the plan’s cost, for every plan', () => {
    for (const id of STRATEGY_IDS) {
        const r = run(id, id === 'blissSteady' ? { bliss: true } : {});
        assert.equal(r.costDaily.length, r.daily.length, id);
        assert.equal(sum(r.costDaily), r.cost, id + ': the days add up to the cost');
        assert.ok(r.costDaily.every((v) => Number.isInteger(v) && v >= 0), id);
    }
    // A jump day costs far more than a stack day (the EDVDs); steady training's days differ by a Xanax.
    const j = run('edvdJump');
    const s = run('steady');
    const spread = (r) => Math.max(...r.costDaily) - Math.min(...r.costDaily);
    assert.ok(spread(j) > 15e6, 'the jump: its dearest day against its cheapest, $' + spread(j));
    assert.ok(spread(s) < 1e6, 'steady: $' + spread(s));
    // The first day is the one the run starts in (from `dayMin` to Torn's midnight): a late start pays less on it.
    const late = run('steady', { dayMin: 23 * 60 });
    assert.equal(late.costDaily.length, late.daily.length);
    assert.ok(late.costDaily[0] < s.costDaily[0]);
});

test('withCash: a kept result carries the check, not the cost of every day; nothing without your books', () => {
    const r = run('edvdJump');
    const books = { liquid: 1e6, earnsPerDay: r.cost / r.daily.length, dated: [], keepAside: 0 };
    const kept = withCash(r, books);
    assert.equal(kept.costDaily, undefined);
    assert.equal(kept.cash.fits, false);
    assert.equal(kept.gained, r.gained);
    assert.deepEqual(slimResult(kept).cash, kept.cash, 'Torn’s pages get it too');
    const bare = withCash(r, null);
    assert.equal(bare.costDaily, undefined);
    assert.equal(bare.cash, undefined);
    assert.equal(withCash(r, { liquid: null, earnsPerDay: 1e6 }).cash, undefined, 'no liquid figure read yet: no check');
    assert.equal(withCash(null, books), null);
    // Money that arrives on a day (the bank's profit) and the keep-aside count, as in the offer.
    assert.equal(planCash({ ...books, dated: [{ day: 0, amount: 1e9 }] }, r.costDaily).fits, true);
    assert.equal(planCash({ ...books, liquid: 1e9, keepAside: 1e9 }, r.costDaily).fits, false);
});

test('the Plan page’s money line says when the pick runs out, and only then', () => {
    const auto = { ready: true, source: 'books', books: { why: 'About $4.0M a day comes in.' } };
    assert.equal(affordLine(auto, 2e6), 'About $4.0M a day comes in. This plan costs $2M a day.');
    assert.equal(affordLine(auto, 2e6, { fits: true, runsOutDay: null }), 'About $4.0M a day comes in. This plan costs $2M a day.');
    assert.equal(affordLine(auto, 2e6, { fits: false, runsOutDay: 3 }), 'About $4.0M a day comes in. This plan costs $2M a day, but it buys in lumps: your cash runs out on day 3.');
    assert.equal(affordLine(auto, 0, { fits: true, runsOutDay: null }), 'About $4.0M a day comes in. This plan costs nothing.');
});

test('the year path: the cost of every day along it, a membership on its stretch’s first day', () => {
    const T = Date.parse('2026-03-01T00:00:00Z');
    const stats = { str: 118400, spd: 110900, def: 96200, dex: 82700 };
    const api = { bars: { energy: { current: 150, maximum: 150, increment: 5, interval: 600, tick_time: 120, full_time: 0 }, happy: { current: 5025, maximum: 5025, increment: 5, interval: 900, tick_time: 300, full_time: 0 } }, cooldowns: { drug: 0, medical: 0, booster: 0 }, refills: { energy: true, special_count: 0 }, battlestats: { strength: { value: stats.str }, defense: { value: stats.def }, speed: { value: stats.spd }, dexterity: { value: stats.dex }, total: 1 }, gym: { id: 18 } };
    const state = normalizeState(api, T);
    const pc = playerContext(state, {}, { unlockedKnown: Array.from({ length: 18 }, (_, i) => i + 1) });
    const shares = targetShares({ build: 'balanced' }, pc.stats, buildOf('balanced').shares);
    const g = yearSteps({ compare: compareSteps, inputs: simInputs, args: { state, pc, shares, settings: { horizonDays: 30, budget: Infinity }, prices: {}, special: 0, statics: {}, pickBy: 'max' }, start: T, end: T + 75 * DAY, budgetPerDay: Infinity, events: [] });
    let x = g.next();
    while (!x.done) x = g.next();
    const y = x.value;
    assert.ok(y.segments.length >= 2, 'more than one stretch');
    assert.equal(y.result.costDaily.length, y.result.daily.length);
    assert.ok(Math.abs(sum(y.result.costDaily) - y.result.cost) <= y.segments.length, 'the days add up to the path’s cost: ' + sum(y.result.costDaily) + ' against ' + y.result.cost);
});

test('Create plan: every compared plan and the path are kept without the cost of every day', async () => {
    useClock(T0);
    globalThis.document = fakeDocument();
    setNow(T0);
    setup(PLAYERS.friend);
    const saved = await createPlan({ months: 1, pause: noPause });
    for (const [id, r] of Object.entries(saved.compare)) assert.equal(r.costDaily, undefined, id);
    assert.equal(saved.year.path.costDaily, undefined);
    for (const r of Object.values(saved.whatIf || {})) assert.equal(r.costDaily, undefined);
    for (const w of saved.jobWhatIf || []) assert.equal(w.result.costDaily, undefined);
    // No money log read in this fixture: no books, so no check is claimed.
    for (const r of Object.values(saved.compare)) assert.equal(r.cash, undefined);
});

test('Create plan with your books read: every plan carries its cash check, and the jump that runs out says so', async () => {
    useClock(T0);
    globalThis.document = fakeDocument();
    setNow(T0);
    setup(PLAYERS.friend);
    setKey(K.fullKey, 'FullKeyHarness12');
    set(K.fullKeyState, { ok: true, at: 1 });
    // $1M on hand, $1M of pay a day for 30 days (Torn's log type 6221).
    set(K.userStatic, { inventory: { cash: 1e6 } });
    pageSet(K.moneyLog, { v: 2, at: T0, from: T0 - 30 * DAY, lines: Array.from({ length: 30 }, (_, i) => ({ id: 'pay' + i, type: 6221, title: 'Company employee pay', at: T0 - i * DAY - 3600e3, data: { pay: 1e6 } })) });
    try {
        const saved = await createPlan({ months: 1, pause: noPause });
        for (const [id, r] of Object.entries(saved.compare)) {
            assert.equal(r.costDaily, undefined, id);
            assert.equal(typeof r.cash.fits, 'boolean', id);
        }
        assert.equal(typeof saved.year.path.cash.fits, 'boolean');
        // $1M a day against the EDVD jump's days: short from the first jump.
        const j = saved.compare.edvdJump;
        assert.equal(j.cash.fits, false);
        assert.ok(j.cash.runsOutDay >= 1 && j.cash.runsOutDay <= 3, 'day ' + j.cash.runsOutDay);
    } finally {
        pageSet(K.moneyLog, null);
        setKey(K.fullKey, '');
        set(K.fullKeyState, null);
        set(K.userStatic, null);
    }
});
