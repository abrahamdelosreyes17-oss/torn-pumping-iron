/*
 * Round 7, R7.3b: planning speed and live progress. A plan is worked out in
 * short slices with breaks that are not timers, it reports where it is, it
 * can be cancelled (nothing saved, the old plan stays), and the what-ifs
 * come after the plan is saved. Slicing never changes a number.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { makePause, runSliced, PlanCancelled, SLICE_MS } from '../src/core/slices.js';
import { simulateStrategy, simulateSteps, SIM_SLICE_DAYS } from '../src/core/strategies.js';
import { compareSteps, compareStrategies, simInputs, playerContext, buildOf } from '../src/core/model.js';
import { normalizeState } from '../src/core/bars.js';
import { targetShares } from '../src/core/plan.js';
import { PLAYERS, T0, apiOf, useClock, setNow, setup, noPause } from './support/ref.mjs';
import { pi, createPlan, recalibratePlan, cancelPlan, onPlanProgress } from '../src/runtime.js';
import { K, get } from '../src/platform/store.js';

test('a break costs nothing while the slice has time left; when it is due it is one turn of the page, never a timer', async () => {
    let t = 0;
    let turns = 0;
    const pause = makePause({ now: () => t, post: () => (turns++, Promise.resolve()) });
    await pause();
    t = SLICE_MS - 1;
    await pause();
    assert.equal(turns, 0, 'under 30 ms of work: no break');
    t = SLICE_MS;
    await pause();
    assert.equal(turns, 1);
    assert.equal(pause.breaks(), 1);
    t += 5;
    await pause();
    assert.equal(turns, 1, 'the slice starts again after a break');
    // The default break is a MessageChannel message (a hidden tab's timers run once a second at best).
    const src = makePause.toString();
    assert.match(src, /MessageChannel/);
    const real = makePause({ everyMs: 0 });
    const timers = [];
    const st = globalThis.setTimeout;
    globalThis.setTimeout = (...a) => (timers.push(a[1]), st(...a));
    try {
        await real();
        await real();
    } finally {
        globalThis.setTimeout = st;
        real.stop();
    }
    assert.deepEqual(timers, [], 'no timer was used for a break');
});

test('a cancelled run stops at its next break with PlanCancelled', async () => {
    let stop = false;
    let t = 0;
    const pause = makePause({ now: () => t, post: () => Promise.resolve(), cancelled: () => stop });
    function* work() {
        for (let i = 0; i < 100; i++) yield i;
        return 'done';
    }
    const seen = [];
    stop = false;
    assert.equal(await runSliced(work(), pause, (v) => seen.push(v)), 'done');
    assert.equal(seen.length, 100);
    const p = runSliced(work(), pause, (v) => {
        if (v === 3) stop = true;
    });
    await assert.rejects(p, (e) => e instanceof PlanCancelled && e.cancelled === true);
});

test('slicing never changes a number: a run in slices equals the run in one go', () => {
    const p = PLAYERS.friend;
    const state = normalizeState(apiOf(p), T0);
    const pc = playerContext(state, {}, { unlockedKnown: Array.from({ length: p.gym }, (_, i) => i + 1) });
    const shares = targetShares({ build: p.build, goal: null }, pc.stats, buildOf(p.build).shares);
    const base = simInputs({ state, pc, shares, settings: { horizonDays: 120, budget: Infinity }, prices: {}, special: 0, statics: {} });
    for (const id of ['steady', 'steadyMax', 'candyXanax', 'edvdJump']) {
        const whole = simulateStrategy(id, base);
        const g = simulateSteps(id, { ...base, sliceDays: SIM_SLICE_DAYS });
        let yields = 0;
        let r = g.next();
        while (!r.done) {
            yields++;
            r = g.next();
        }
        assert.equal(yields, Math.ceil(120 / SIM_SLICE_DAYS) - 1, id + ': a break every ' + SIM_SLICE_DAYS + ' simulated days');
        assert.deepEqual(r.value, whole, id);
    }
    // The comparison: it says which plan it is on (progress) and gives the same results as in one go.
    const args = { state, pc, shares, settings: { horizonDays: 60, budget: Infinity }, prices: {}, special: 0, statics: {}, pickBy: 'max' };
    const names = [];
    const g = compareSteps(args);
    let r = g.next();
    while (!r.done) {
        if (typeof r.value === 'string') names.push(r.value);
        r = g.next();
    }
    assert.deepEqual(names, Object.keys(r.value));
    assert.deepEqual(r.value, compareStrategies(args));
});

test('Create plan reports where it is, from the comparison to the save, and the what-ifs are in when a caller waits for them', async () => {
    useClock(T0);
    setNow(T0);
    setup(PLAYERS.friend);
    const seen = [];
    onPlanProgress((b) => seen.push({ part: b.part, done: b.done, words: b.words }));
    const saved = await createPlan({ months: 3, pause: noPause });
    assert.ok(seen.length >= 4, seen.length + ' progress reports');
    assert.equal(seen[seen.length - 1].done, 1);
    assert.equal(seen[seen.length - 1].words, 'Saving your plan');
    for (let i = 1; i < seen.length; i++) assert.ok(seen[i].done >= seen[i - 1].done, 'the bar never goes back: ' + seen[i - 1].done + ' then ' + seen[i].done);
    assert.ok(seen.some((x) => /^Comparing plans: /.test(x.words)));
    assert.ok(seen.some((x) => /^Your 3 months: day \d+ of 92$/.test(x.words)), seen.map((x) => x.words).join(' | '));
    assert.ok(seen.some((x) => x.part === 'band'));
    // A caller with its own pause (tests, the baseline) gets the whole plan: the what-ifs are in.
    assert.equal(saved.extras, 'done');
    assert.ok(saved.whatIf && saved.whatIf.blissSteady && saved.gymWorth.length >= 1);
    assert.equal(get(K.planNow, null).extrasAt, saved.extrasAt, 'the other tabs are told the what-ifs are in');
    assert.equal(pi.planBusy, null);
});

test('with the page’s own breaks: the plan is saved and shown first, the what-ifs follow; Cancel leaves the old plan', async () => {
    useClock(T0);
    setNow(T0);
    setup(PLAYERS.friend);
    // The browser's path: no pause passed, so the breaks are MessageChannel messages.
    const first = await createPlan({ months: 1 });
    assert.equal(first.extras, 'pending', 'returned as soon as it is saved');
    assert.equal(pi.saved.rev, first.rev);
    const full = await pi.planExtras;
    assert.equal(full.extras, 'done');
    assert.equal(full.rev, first.rev, 'the same plan, with the what-ifs added');
    assert.ok(pi.saved.gymWorth.length >= 1 && pi.saved.whatIf);
    // Re-plan, cancelled at the first progress report: nothing saved, the old plan stays, no error to show.
    setNow(T0 + 3600e3);
    const before = JSON.stringify(get(K.planNow, null));
    let n = 0;
    onPlanProgress(() => {
        if (++n === 2) cancelPlan();
    });
    const out = await recalibratePlan();
    assert.equal(out, null, 'a cancelled run resolves with nothing');
    assert.equal(pi.planBusy, null);
    assert.equal(pi.saved.rev, first.rev);
    assert.equal(JSON.stringify(get(K.planNow, null)), before, 'the plan Torn pages follow is untouched');
    const runs = get(K.planRuns, []);
    assert.equal(runs[runs.length - 1].cancelled, true, 'the problem log knows it was cancelled, not failed');
    // And the button works again.
    const again = await recalibratePlan({ pause: noPause });
    assert.ok(again && again.recalibratedAt);
});
