/*
 * Round 7: the review of 2026-10-02 as tests (docs/review-2026-10-02.md; each
 * was a script in docs/sims/review-2026-10-02/ that printed the bug). A test
 * marked `todo` shows a bug not fixed yet: it fails without failing the run,
 * and loses its mark in the step that fixes it (ROUND7-PLAN §6). The Plan
 * page's sentences are held to its numbers here too (§2.3).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { PLAYERS, T0, DAY, apiOf, compareFor, dumpPrices, useClock, setNow, setup, setState, noPause, fakeDocument, sessionsOfTrace } from './support/ref.mjs';
import { firstBoost } from './support/sim-vs-day.mjs';
import { recommend, perMillion } from '../src/core/recommend.js';
import { buildModel, simInputs, playerContext, buildOf } from '../src/core/model.js';
import { simulateStrategy } from '../src/core/strategies.js';
import { normalizeState, tornDayStart } from '../src/core/bars.js';
import { targetShares } from '../src/core/plan.js';
import { ITEMS } from '../src/core/items.js';
import { bestCandy } from '../src/core/candy.js';
import { incomeFloor } from '../src/core/income-floor.js';
import { incomeBreakdown, autoState, incomeFrom } from '../src/core/auto.js';
import { parsePerks } from '../src/core/perks.js';
import { pi, refresh, createPlan, followStrategy, recalibratePlan } from '../src/runtime.js';
import { K, get, getPlan, getSettings, getPrices } from '../src/platform/store.js';
import { renderProgress, dayGainPlan } from '../src/ui/app/progress.js';
import { readLines, planStatAt, plannedBetween } from '../src/core/planline.js';

/** The fix still to come: the step that removes the mark. */
const TODO = (step) => ({ todo: 'fixed in ' + step });

const friend = PLAYERS.friend;
const MIN = 60e3;
const HOUR = 3600e3;

/* ------------------------------------------------- 1. the recommendation */

/** The friend's cases (budget.mjs): the Plan rule, the money for the 31 days, with and without "Unlock Racing Fitness". */
const CASES = [
    ['most', 155e6],
    ['most', 60e6],
    ['value', 155e6],
    ['most', 600e6],
    ['max', Infinity],
];
const UNLOCK = { gymId: 13, name: 'Racing Fitness', days: null, horizon: 31 };
const cache = new Map();
function friendCase(pickBy, budget) {
    const key = pickBy + budget;
    if (!cache.has(key)) cache.set(key, compareFor(friend, { pickBy, budget, progress: 3553 }));
    return cache.get(key);
}
const recFor = (pickBy, budget, goal) => recommend(friendCase(pickBy, budget).compare, { budget, pickBy, openBy: goal });
const pickable = (compare) => Object.values(compare).filter((r) => r && !r.blocked);
const limitOf = (pickBy, budget) => (pickBy === 'max' ? Infinity : budget);

test('review 1.1 · friend, Max gains + "Unlock Racing Fitness": the plan with the most stats is picked', () => {
    const { compare } = friendCase('max', Infinity);
    const rec = recFor('max', Infinity, UNLOCK);
    const most = pickable(compare).reduce((a, b) => (b.gained > a.gained ? b : a));
    assert.equal(rec.recommended, most.id, 'the goal must not outrank stats (it picked ' + rec.recommended + ', +' + compare[rec.recommended].gained + ' for $' + compare[rec.recommended].cost + ')');
    assert.equal(rec.recommended, 'edvdJump');
});

test('review 1.1 · friend, $600M + the unlock goal: the most stats inside the budget (the EDVD jump)', () => {
    assert.equal(recFor('most', 600e6, UNLOCK).recommended, 'edvdJump');
});

test('review 1.4 · friend, $60M for the month: the pick fits the budget (a plan for a small budget exists)', () => {
    const { compare } = friendCase('most', 60e6);
    const rec = recFor('most', 60e6, null);
    assert.ok(compare[rec.recommended].cost <= 60e6, rec.recommended + ' costs $' + compare[rec.recommended].cost);
});

for (const goal of [null, UNLOCK]) {
    for (const [pickBy, budget] of CASES) {
        const name = pickBy + ' · ' + (Number.isFinite(budget) ? '$' + budget / 1e6 + 'M' : 'no budget') + (goal ? ' · unlock goal' : '');
        // Wrong today: with the goal (it sorts by energy and the lines contradict the table); under $60M nothing says the pick is over it.
        const broken = false;
        test('review 1.3 · sentences match the numbers · ' + name, broken ? TODO('R7.1') : {}, () => {
            const { compare } = friendCase(pickBy, budget);
            const rec = recFor(pickBy, budget, goal);
            const best = compare[rec.recommended];
            const limit = limitOf(pickBy, budget);
            const inside = pickable(compare).filter((r) => r.cost <= limit && !(rec.facts.late || []).includes(r.id));
            const text = rec.reasons.join(' ');
            // "The most stats" only when nothing inside the limit gains more.
            if (/most stats(?! for each)/i.test(text)) assert.ok(!inside.some((r) => r.gained > best.gained), '"most stats" is said, but ' + inside.filter((r) => r.gained > best.gained).map((r) => r.id).join(', ') + ' gain more inside the limit');
            // Over the budget: said in the first line, never silent.
            if (best.cost > limit) assert.match(rec.reasons[0] || '', /nothing fits|cheapest/i, 'the pick is over the budget and the first line doesn’t say so: ' + rec.reasons[0]);
            for (const a of rec.alternatives) {
                // A cheaper plan is never "more"; no negative "more".
                assert.doesNotMatch(a.why, /−\$[\d.,]+[MBK]? more|-\$[\d.,]+[MBK]? more/, a.id + ': ' + a.why);
                if (a.deltaCost < 0) assert.doesNotMatch(a.why, /\$[\d.,]+[MBK]? more/, a.id + ' is cheaper but its line calls the cost "more": ' + a.why);
                // More stats for less money and still not the pick: the line gives the real reason (it doesn't fit, it's over a limit, it misses a date).
                if (a.gained > best.gained && a.cost <= best.cost) assert.match(a.why, /doesn’t fit|over your|per \$1M|after|misses/i, a.id + ' beats the pick on both columns and its line gives no reason: ' + a.why);
            }
        });
    }
}

test('review 1.6 · fit: the cheapest plan is never hidden, and fit is measured against the best plan inside the limit', () => {
    for (const [pickBy, budget] of CASES) {
        for (const goal of [null, UNLOCK]) {
            const { compare } = friendCase(pickBy, budget);
            const rec = recFor(pickBy, budget, goal);
            const cheapest = pickable(compare).reduce((a, b) => (b.cost < a.cost ? b : a));
            const row = rec.alternatives.find((a) => a.id === cheapest.id);
            if (row) assert.ok(row.fits, pickBy + ' $' + budget + (goal ? ' unlock' : '') + ': the cheapest plan (' + cheapest.id + ') is hidden');
        }
    }
});

test('review 1.5 · candy: a stronger candy is taken only at an equal or better cost per stat (the whole plan)', () => {
    const { compare } = compareFor(friend, { pickBy: 'max', prices: dumpPrices() });
    for (const id of ['candyXanax', 'dailyChoco', 'chocoJump']) {
        const r = compare[id];
        assert.ok(r && r.candy, id + ' names its candy');
        // No Birthday Cupcake at $2.1M each when a candy a tenth of the price gives most of the stats.
        assert.notEqual(r.candy.id, 1028, id + ' takes Birthday Cupcake × 49: +' + r.gained + ' for $' + r.cost);
    }
    // The owner's example (2026-10-03): "+151k for $176M vs $616M... I would take 176k if it costs let's say 200".
    const plan = { 586: { gained: 151000, cost: 176e6 }, 1028: { gained: 176000, cost: 616e6 } };
    const prices = { 586: 100, 1028: 400 };
    const pick = (o) => bestCandy({ prices, pickBy: 'max', evaluate: (id) => o[id] }).id;
    assert.equal(pick(plan), 586, '+16.6% stats for +250% cost ($3,500 a stat against $1,166): rejected');
    assert.equal(pick({ ...plan, 1028: { gained: 176000, cost: 200e6 } }), 1028, '+16.6% stats for +14% cost ($1,136 a stat): taken');
    assert.equal(pick({ ...plan, 1028: { gained: 176000, cost: 205.2e6 } }), 586, 'a hair worse per stat: no tolerance');
});

/* ------------------------------------------------------- 2. the simulator */

test('review 2.2 · the energy cap: a jump trains at most 1,000 energy at jump happy (plus the refill)', () => {
    for (const id of ['edvdJump', 'chocoJump', 'consoleJump']) {
        const { sim, day } = firstBoost(friend, id);
        assert.ok(sim.energy <= 1000 + 150, id + ' · simulator: ' + sim.energy + ' E in the first jump');
        assert.ok(day.energy <= 1000 + 150, id + ' · day plan: ' + day.energy + ' E in the first jump');
    }
    // Every jump of the month, not only the first: never more than 1,000 in the bar (it was 1,150, then 1,120).
    const p = friend;
    const state = normalizeState(apiOf(p), T0);
    const pc = playerContext(state, {}, { unlockedKnown: Array.from({ length: p.gym }, (_, i) => i + 1) });
    const shares = targetShares({ strategy: 'edvdJump', build: p.build, goal: null }, pc.stats, buildOf(p.build).shares);
    const rows = [];
    simulateStrategy('edvdJump', { ...simInputs({ state, pc, shares, settings: { horizonDays: 31, budget: Infinity }, prices: {}, special: 0, statics: {}, live: true }), trace: (x) => rows.push(x) });
    assert.ok(rows.every((x) => x.E <= 1000), 'the most energy in the bar at a train: ' + Math.max(...rows.map((x) => x.E)));
    const sessions = sessionsOfTrace(rows);
    const jumps = sessions.filter((s) => s.H0 > p.happyMax * 1.5);
    assert.ok(jumps.length > 20 && jumps.every((s) => s.E0 === 1000), 'energy at each jump: ' + jumps.map((s) => s.E0).join(', '));
    // What was in the bar is trained before the stack, at normal happy; and, with no jump today, today's refill after it.
    const first = sessions[0];
    assert.ok(first.t === 0 && first.energy === 300 && first.H0 <= p.happyMax, 'the full bar and the day’s refill are trained before Xanax #1: ' + JSON.stringify(first));
});

test('review 2.3 · the second jump is the same in the simulator and the day plan (the jump cycle)', () => {
    const p = friend;
    const state = normalizeState(apiOf(p), T0);
    const unlockedKnown = Array.from({ length: p.gym }, (_, i) => i + 1);
    const pc = playerContext(state, {}, { unlockedKnown });
    const plan = { strategy: 'edvdJump', build: p.build, goal: null };
    const shares = targetShares(plan, pc.stats, buildOf(p.build).shares);
    const rows = [];
    simulateStrategy('edvdJump', { ...simInputs({ state, pc, shares, settings: { horizonDays: 31, budget: Infinity }, prices: {}, special: 0, statics: {}, live: true }), trace: (x) => rows.push(x) });
    const jumps = sessionsOfTrace(rows).filter((s) => s.H0 > p.happyMax * 1.5);
    // The day plan right after the first jump, as the player would see it (energy 0, the Ecstasy's cooldown, the boosters').
    const t1 = T0 + jumps[0].t * MIN + 10 * MIN;
    const after = normalizeState(apiOf(p, { energy: 0, drug: 4 * 3600 - 600, booster: 30 * 3600 - 600, refillUsed: true }), t1);
    const m = buildModel({ state: after, statics: {}, plan, settings: { horizonDays: 31 }, log: [], now: t1, unlockedKnown });
    const j = m.ahead.concat(m.lookAhead).find((s) => s.kind === 'jump');
    assert.ok(j, 'the day plan shows the next jump');
    assert.ok(Math.abs((j.at - T0) / MIN - jumps[1].t) <= 5, 'second jump: day plan at ' + Math.round((j.at - T0) / MIN) + ' min, simulator at ' + jumps[1].t + ' min');
    assert.equal(j.energy, jumps[1].E0, 'energy in the second jump: day plan ' + j.energy + ', simulator ' + jumps[1].E0);
});

test('review 2.5 · all nine energy drinks are known', TODO('R7.4'), () => {
    const cans = Object.values(ITEMS).filter((it) => it.category === 'Energy Drink');
    assert.equal(cans.length, 9, cans.map((c) => c.name).join(', '));
});

/* ------------------------------------------------- 2.6 the middle of a step */

function midModel(strategy, o) {
    const now = Date.parse('2026-10-01T12:16:00Z'); // one minute after a quarter tick
    const api = apiOf(friend, { energy: o.e, happy: o.h, drug: o.drug || 0, booster: o.booster || 0, refillUsed: true });
    const state = normalizeState(api, now);
    return { now, m: buildModel({ state, statics: {}, plan: { strategy, build: friend.build, goal: null }, settings: { horizonDays: 30 }, log: [], now, unlockedKnown: Array.from({ length: 12 }, (_, i) => i + 1) }) };
}

test('review 2.6 · EDVD jump, the 5 EDVD eaten and the Ecstasy not yet: the step stays (take the Ecstasy now), not "in 30 h"', () => {
    const { now, m } = midModel('edvdJump', { e: 1000, h: 16500, booster: 30 * 3600 });
    const next = m.steps[0];
    assert.ok(next && next.at - now <= 15 * MIN, 'the next step is in ' + ((next.at - now) / HOUR).toFixed(1) + ' h: ' + next.label);
    assert.match(next.label, /Ecstasy/);
    assert.equal(next.energy, 1000, 'it trains the stack');
});

test('review 2.6 · Candy + Xanax, the 49 candy eaten and the Xanax not yet: the Xanax now, trained at the candy’s happy; no second boost today', () => {
    const { now, m } = midModel('candyXanax', { e: 150, h: 6450, booster: 24.5 * 3600 });
    const next = m.steps[0];
    assert.ok(next.at - now <= 15 * MIN);
    assert.doesNotMatch(next.note || '', /No candy with this one/, 'the candy was just eaten: ' + next.note);
    const later = m.steps.filter((s) => s.kind === 'boost' && s.at > next.at && tornDayStart(s.at) === tornDayStart(now));
    assert.equal(later.length, 0, 'a second candy boost is planned today: ' + later.map((s) => s.label).join(' | '));
});

test('review 2.3 · a stack day: no "Refill unused" heads-up while Xanax are stacked for a jump', () => {
    const now = tornDayStart(T0) + 22.5 * HOUR;
    const state = normalizeState(apiOf(friend, { energy: 650, drug: 3 * 3600, refillUsed: false }), now);
    const m = buildModel({ state, statics: {}, plan: { strategy: 'edvdJump', build: friend.build, goal: null }, settings: { horizonDays: 30 }, log: [], now, unlockedKnown: Array.from({ length: 12 }, (_, i) => i + 1) });
    assert.ok(!m.heads.some((h) => /Refill unused/.test(h.text)), 'Home says: ' + m.heads.map((h) => h.text).join(' | '));
});

/* ----------------------------------------------------------------- 3. money */

test('review 3.1 · a $2B gift banked for 3 months is not income: the budget stays near the real pay ($0.5M a day)', TODO('R7.5'), () => {
    const now = Date.parse('2026-10-02T12:00:00Z');
    const cityBank = { amount: 2e9, profit: 90e6, duration: 90, until: Math.floor((now + 80 * DAY) / 1000) };
    const floor = incomeFloor({ cityBank, now });
    const log = [{ at: now - 10 * DAY, title: 'Money receive', money: 2e9 }, { at: now - 10 * DAY, title: 'Bank invest', money: 2e9 }, ...Array.from({ length: 30 }, (_, i) => ({ at: now - i * DAY, title: 'Company pay', money: 500e3 }))];
    const bd = incomeBreakdown(log, now, 30, floor);
    const snaps = [{ at: now - 30 * DAY, networth: 300e6 }, { at: now, networth: 2.32e9 }];
    const a = autoState({ plan: { pickBy: 'auto' }, settings: { horizonDays: 30 }, hasFullKey: true, income: incomeFrom(snaps), log: bd, floor });
    assert.ok(a.budgetPerDay < 2e6, 'the budget is $' + Math.round(a.budgetPerDay / 1e5) / 10 + 'M a day');
});

/* ------------------------------------------------------- 4. Progress */

/**
 * A player who does exactly what the saved plan's simulator assumed, on the
 * Progress page: every "ahead" or "behind" is the page's own error.
 */
async function follower(strategy, hour) {
    useClock(T0);
    globalThis.document = fakeDocument();
    const start = tornDayStart(T0) + hour * HOUR;
    const day0 = tornDayStart(start);
    setNow(start);
    setup(friend);
    const saved = await createPlan({ months: 1, pause: noPause });
    followStrategy(strategy);
    const base = { ...saved.snapshot.stats };
    const state = normalizeState(get(K.userState).api, start);
    const pc = playerContext(state, {}, { unlockedKnown: get(K.unlocked) });
    const shares = targetShares(getPlan(), pc.stats, buildOf(friend.build).shares);
    const rows = [];
    const r = saved.compare[strategy];
    // `live`, as Create plan runs it: from the bars as they are, at this minute of the Torn day.
    simulateStrategy(strategy, { ...simInputs({ state, pc, shares, settings: { horizonDays: saved.days, budget: Infinity }, prices: {}, special: 0, statics: {}, live: true }), ...(r.candy ? { candyId: r.candy.id, candyCount: r.candy.count } : {}), trace: (x) => rows.push(x) });
    const statsAt = (ms) => {
        const o = { ...base };
        for (const x of rows) if (start + x.t * MIN <= ms) o[x.k] += x.gain;
        return o;
    };
    const total = (s) => Object.values(s).reduce((a, v) => a + v, 0);
    /** statsHistory as the feed writes it: each day's last read, with the stats at the day's first read. */
    const historyUpTo = (ms) => {
        const h = {};
        for (let d = day0; d <= tornDayStart(ms); d += DAY) {
            const s = statsAt(Math.min(ms, d + DAY - 1));
            h[d] = { ...s, total: total(s), open: d === day0 ? { ...base } : statsAt(d - 1) };
        }
        return h;
    };
    /** The page at a moment: the header's "+X gained" and "NN% of plan" (null: not shown), and the chart's lines. */
    const at = (ms, range = 14) => {
        setNow(ms);
        setState(apiOf(friend, { stats: statsAt(ms), energy: 0, drug: 3600 }));
        refresh();
        const m = pi.model;
        const ctx = { model: m, settings: getSettings(), plan: { ...getPlan(), strategy: m.strategy }, statics: {}, prices: getPrices(), compare: m.compare, history: historyUpTo(ms), dayTotals: get(K.dayTotals, {}) || {}, calibration: null, gymLog: null, planLines: readLines(get(K.planLine, null)), receipts: null, priceHistory: null, ui: { progressRange: range }, rerender() {}, go() {} };
        const out = renderProgress(m, ctx);
        const head = out.ctl[0].map((n) => n.textContent).join(' ');
        const hit = /(-?\d+)% of plan/.exec(head);
        const said = /([+−-][\d,]+) gained/.exec(head);
        const lines = out.main[0].all((n) => n.tagName === 'polyline').map((n) => n.attrs.points.split(' ').length);
        return { pct: hit ? Number(hit[1]) : null, head, said: said ? Number(said[1].replace(/[,+]/g, '').replace('−', '-')) : null, gained: total(statsAt(ms)) - total(base), lines, m, ctx };
    };
    return { day0, start, at, saved };
}

test('review 4.4 · Progress: a player who follows the plan exactly reads 100% of plan, whatever the hour the plan was made', async () => {
    for (const hour of [0, 12]) {
        const f = await follower('steady', hour);
        // At the end of each of the plan's days (Torn's midnight; a minute before, so a session on the mark itself isn't
        // counted early): exact. Since round 7 (the plan's span) the plan's days are Torn days, the first from the
        // moment it was made; before, they were 24 h from that moment.
        for (const n of [1, 2, 5]) {
            const r = f.at(f.day0 + n * DAY - MIN);
            assert.ok(r.pct !== null && Math.abs(r.pct - 100) <= 2, 'plan made at ' + hour + ':00, the end of day ' + n + ': ' + (r.pct === null ? 'no figure' : r.pct + '% of plan') + ' (1.3.0 read 151%, 181%, 114%)');
        }
        // In between, the line follows the plan's own shape of the day; a session a little before or after the read is
        // most of what is left (the plan trains energy as it comes, a bar at a time shows in steps).
        for (const [label, ms] of [['9 hours in', f.start + 9 * HOUR], ['24 hours in', f.start + DAY - MIN], ['36 hours in', f.start + 36 * HOUR], ['4.5 days in', f.start + 4.5 * DAY]]) {
            const r = f.at(ms);
            assert.ok(r.pct !== null && Math.abs(r.pct - 100) <= 12, 'plan made at ' + hour + ':00, ' + label + ': ' + (r.pct === null ? 'no figure' : r.pct + '% of plan'));
        }
        // The first hours: no figure yet (one session is the whole number), never a wild one.
        assert.equal(f.at(f.start + MIN).pct, null, 'a minute in: no "% of plan" yet');
    }
});

test('review 4.4 · Progress: a jump plan reads 100% after each jump, and never "behind" while the stack is being built', async () => {
    const f = await follower('edvdJump', 12);
    // Round 7 (the 1,000 cap): the bar is trained before Xanax #1, so the stack day has that small gain planned (it had none).
    const stacking = f.at(f.start + 20 * HOUR).pct;
    assert.ok(stacking === null || Math.abs(stacking - 100) <= 12, 'stacking: only the bar before Xanax #1 is planned, and it is done: ' + stacking + '% of plan');
    // Within 2% (it was 1%): the plan's line is a step at the jump that holds the whole day's gain, and since round 7
    // that day also has the bar trained before the next stack (120 E at normal happy: 1.6% of the day's gain).
    const read = [['an hour after the first jump', f.start + 29 * HOUR + 5 * MIN], ['end of day 2', f.day0 + 2 * DAY - MIN], ['day 5, 12:00', f.day0 + 4 * DAY + 12 * HOUR]].map(([label, ms]) => [label, f.at(ms).pct]);
    const said = read.map(([label, pct]) => label + ': ' + (pct === null ? 'no figure' : pct + '% of plan')).join(' · ');
    assert.ok(read.every(([, pct]) => pct !== null && Math.abs(pct - 100) <= 2), said);
});

test('review 4.5 · Progress: "+X gained" at the end of day 1 is what was really gained, not +0', async () => {
    const f = await follower('steady', 0);
    const r = f.at(f.day0 + DAY - MIN);
    assert.ok(r.said !== null, r.head);
    assert.ok(Math.abs(r.said - r.gained) <= 0.02 * r.gained, 'the header says ' + r.said + ', the player gained +' + Math.round(r.gained));
});

test('review 4.6 · Progress: a pick starts a new line from today and the old one stays; Re-plan keeps the chart; 30 days and All show the history', async () => {
    const f = await follower('steady', 12);
    const t = f.day0 + 4 * DAY + 12 * HOUR;
    const before = f.at(t);
    assert.deepEqual(before.lines, [5, 5], 'one plan line and you, five days each');
    // Pick another plan on day 5: no re-basing to the plan's first day (1.3.0 read 27% of plan here).
    followStrategy('edvdJump');
    let r = f.at(t + MIN);
    assert.equal(r.pct, null, 'the new line starts where you are: nothing to be behind on yet');
    assert.equal(r.lines.length, 3, 'the earlier plan is still on the chart, the new one beside it, and you');
    assert.equal(r.lines[r.lines.length - 1], 5, 'your five days are all still there');
    assert.match(r.head, /followed since 5 Oct/);
    // Re-plan: the chart is not wiped.
    followStrategy('steady');
    await recalibratePlan({ pause: noPause });
    r = f.at(t + 2 * MIN, 30);
    assert.equal(r.lines[r.lines.length - 1], 5, 'Re-plan keeps your history on the chart');
    const lines = readLines(get(K.planLine, null));
    // The line from the first moment of the plan (the pick of the follower, made the instant the plan was), the two picks, the Re-plan.
    assert.deepEqual(lines.map((l) => l.why), ['pick', 'pick', 'replan'], 'the pick back to steady and the Re-plan were the same instant: one line');
    assert.equal(lines[0].at, f.start, 'the first line is still kept');
    assert.deepEqual(lines.map((l) => l.strategy), ['steady', 'edvdJump', 'steady']);
});

test('review 4.7 · Progress: each stat has its own plan line (not one share of the total for every day)', async () => {
    const f = await follower('steady', 0);
    const lines = readLines(get(K.planLine, null));
    const end2 = f.day0 + 2 * DAY - MIN;
    const r = f.at(end2);
    const you = r.m.pc.stats;
    for (const k of ['str', 'spd', 'def', 'dex']) {
        const plan = planStatAt(lines, k, end2);
        const gainedYou = you[k] - f.saved.snapshot.stats[k];
        const gainedPlan = plan - f.saved.snapshot.stats[k];
        assert.ok(Math.abs(gainedPlan - gainedYou) <= Math.max(60, 0.05 * gainedYou), k + ': the plan says +' + Math.round(gainedPlan) + ' by the end of day 2, the follower has +' + Math.round(gainedYou));
    }
});

test('review 4.8 · the day’s "planned" is the plan’s line for that day: it doesn’t move as the day goes or as you train', async () => {
    const f = await follower('steady', 0);
    const lines = readLines(get(K.planLine, null));
    const day = f.day0 + DAY;
    const want = plannedBetween(lines, day, day + DAY);
    assert.ok(Math.abs(want - (f.saved.compare.steady.daily[1] - f.saved.compare.steady.daily[0])) <= 1, 'day 2 planned = the simulator’s day 2');
    for (const h of [0.1, 8, 16, 23.8]) {
        const r = f.at(day + h * HOUR);
        const n = dayGainPlan(r.m, r.ctx, day);
        assert.ok(Math.abs(n.planned - want) <= 1, 'at ' + h + ' h the day’s planned reads ' + Math.round(n.planned) + ' (1.3.0: 3,771 fell to 2,101 as the day went)');
        assert.ok(n.gained >= 0 && n.gained <= want * 1.15, 'gained so far ' + Math.round(n.gained));
    }
});

/* ------------------------------------------------------------- 5. perks */

test('review 5.1 · perks: job-point energy and the regeneration books are counted', TODO('R7.8'), () => {
    const base = JSON.stringify(parsePerks({}));
    for (const [src, text] of [['book', '+ Provides +20% energy regeneration for 31 days'], ['book', '+ Doubles happiness regeneration for 31 days'], ['faction', '+ Reduces drug addiction gain by 50%'], ['faction', '+ Reduces overdose chance by 30%']]) {
        const p = parsePerks({ [src]: [text] });
        const { lines, books, unknown, ...rest } = p;
        const { lines: l0, books: b0, unknown: u0, ...rest0 } = JSON.parse(base);
        assert.notEqual(JSON.stringify(rest), JSON.stringify(rest0), 'not counted: ' + text);
        void lines; void books; void unknown; void l0; void b0; void u0;
    }
});

void perMillion;

/* ------------------------------------- 1b. the gym to unlock, through Create plan */

test('round 7 · a gym to unlock: Create plan still picks by the rule, says when each plan opens it, and weighs the gyms the pick opens', async () => {
    useClock(T0);
    const goal = (by) => ({ kind: 'unlockGym', gymId: 13, by });
    // No date: the EDVD jump (the most stats) although Steady + FHC max opens Racing Fitness a week sooner.
    setNow(T0);
    setup(friend, { plan: { pickBy: 'max', pickByPicked: true, goal: goal(null) } });
    let saved = await createPlan({ months: 1, pause: noPause });
    assert.equal(saved.rec.recommended, 'edvdJump');
    const fhc = saved.rec.alternatives.find((a) => a.id === 'steadyMax');
    assert.ok(saved.rec.facts.opens > fhc.opens, 'the pick opens it on day ' + saved.rec.facts.opens + ', Steady + FHC max on day ' + fhc.opens);
    assert.ok(saved.year.segments.every((s) => s.strategy === 'edvdJump'), 'the path follows the pick, not the gym');
    // What the gyms it opens are worth: the plan with and without each.
    assert.deepEqual(saved.gymWorth.map((g) => g.gymId), [13, 14]);
    for (const g of saved.gymWorth) assert.ok(g.gain > 0 && g.fee > 0 && g.day > 0, g.name + ': +' + g.gain + ' for $' + g.fee + ' on day ' + g.day);
    // A date only one plan makes: that plan, and the others say why they were left out.
    setNow(T0);
    setup(friend, { plan: { pickBy: 'max', pickByPicked: true, goal: goal(tornDayStart(T0) + fhc.opens * DAY) } });
    saved = await createPlan({ months: 1, pause: noPause });
    assert.equal(saved.rec.recommended, 'steadyMax');
    assert.match(saved.rec.reasons.join(' '), /Left out for opening Racing Fitness after day \d+: .*EDVD jump \(day \d+\)/);
    assert.match(saved.rec.alternatives.find((a) => a.id === 'edvdJump').why, /^Opens Racing Fitness on day \d+, after your day \d+ \(it would gain \+\d+% for \$[\d.]+[MB] less\)/);
    // A date no plan makes isn't counted, and the page says so.
    setNow(T0);
    setup(friend, { plan: { pickBy: 'max', pickByPicked: true, goal: goal(tornDayStart(T0) + 2 * DAY) } });
    saved = await createPlan({ months: 1, pause: noPause });
    assert.equal(saved.rec.recommended, 'edvdJump');
    assert.match(saved.rec.reasons.join(' '), /No plan opens Racing Fitness by day 2; the soonest is Steady \+ FHC max on day \d+/);
});
