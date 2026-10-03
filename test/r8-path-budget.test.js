/*
 * Session 9: a path under a budget (docs/sims/round8/path-vs-single.mjs showed the fault: a gym's one-off fee was
 * charged to the stretch it fell in, so that stretch trained with what was left, and the path could total less than
 * one plan the whole way). The money is the whole path's: a stretch spends its share of what is left, the fees of
 * the gyms still to open kept back. The numbers themselves are held by the baseline table (`pathBudget`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ladderFeesAhead } from '../src/core/year.js';
import { GYMS, gymById, unlockEnergyAfter, GEORGES } from '../src/core/gyms.js';
import { createPlan } from '../src/runtime.js';
import { PLAYERS, T0, useClock, setNow, setup, noPause, fakeDocument } from './support/ref.mjs';

test('the fees of the ladder gyms still to open: none short of the next gym, each gym once its energy is trained, nothing past George’s', () => {
    const need13 = unlockEnergyAfter(12);
    const fee = (id) => gymById(id, GYMS).cost;
    assert.equal(ladderFeesAhead(12, 0, need13 - 1, 1, GYMS), 0);
    assert.equal(ladderFeesAhead(12, 0, need13, 1, GYMS), fee(13));
    assert.equal(ladderFeesAhead(12, need13 - 10, 10, 1, GYMS), fee(13), 'what is already trained toward it counts');
    assert.equal(ladderFeesAhead(12, 0, need13 + unlockEnergyAfter(13), 1, GYMS), fee(13) + fee(14));
    assert.equal(ladderFeesAhead(12, 0, need13 / 2, 2, GYMS), fee(13), 'a gym experience perk halves the energy');
    assert.equal(ladderFeesAhead(GEORGES, 0, 1e9, 1, GYMS), 0);
    let all = 0;
    for (let id = 13; id <= GEORGES; id++) all += fee(id);
    assert.equal(ladderFeesAhead(12, 0, 1e9, 1, GYMS), all);
});

test('the friend, 3 months at $2M a day: the path stays inside the budget and does not total less than one plan the whole way', async () => {
    useClock(T0);
    globalThis.document = fakeDocument();
    setNow(T0);
    setup(PLAYERS.friend, { plan: { pickBy: 'most', pickByPicked: true }, settings: { budget: 60e6, horizonDays: 30 } });
    const saved = await createPlan({ months: 3, pause: noPause });
    const path = saved.year.path;
    const one = saved.compare[saved.rec.recommended];
    assert.ok(path.cost <= 2e6 * saved.days, 'the path costs $' + path.cost + ' against $' + 2e6 * saved.days);
    // It was +352,870 against +366,613: the stretches where a gym opened dropped to fewer Xanax to pay its fee.
    assert.ok(path.gained >= one.gained, 'the path +' + path.gained + ', ' + saved.rec.recommended + ' the whole way +' + one.gained);
    // The budget is used, a week at a time (round 8): what a week leaves over goes to the weeks after it, so the
    // Xanax a day move between whole numbers around what the money covers; no week trains on natural energy only.
    const lite = saved.year.segments.filter((s) => s.strategy === 'steadyLite').map((s) => s.xanaxPerDay);
    assert.ok(lite.length && lite.every((n) => n >= 1), 'Xanax a day by stretch: ' + lite.join(', '));
    assert.ok(path.cost >= 0.9 * 2e6 * saved.days, 'at least nine tenths of the budget is used: $' + path.cost);
});

test('a membership is joined only when it pays: the 142M player at $2M a day keeps training instead of paying $150M on day 1', async () => {
    useClock(T0);
    globalThis.document = fakeDocument();
    setNow(T0);
    setup(PLAYERS.owner, { plan: { pickBy: 'most', pickByPicked: true }, settings: { budget: 60e6, horizonDays: 30 } });
    const saved = await createPlan({ months: 3, pause: noPause });
    const y = saved.year;
    const one = saved.compare[saved.rec.recommended];
    assert.ok(y.path.cost <= 2e6 * saved.days, 'the path costs $' + y.path.cost + ' against $' + 2e6 * saved.days + ' (it was $282.8M: the memberships on top of the budget)');
    // A path that follows one plan in every stretch is that plan, to within the stretches' own boundaries (round 8: a
    // stretch starts from where the one before ended, so it no longer gets a free bar that put it ahead).
    assert.ok(y.path.gained >= one.gained * 0.999, 'the path +' + y.path.gained + ', one plan the whole way +' + one.gained);
    const first = y.segments[0];
    assert.equal(first.joined, undefined, 'nothing joined on day 1');
    assert.ok(first.gained / first.days > 200e3, 'the first stretch trains with Xanax (on natural energy only it gained +152k a day): +' + Math.round(first.gained / first.days) + ' a day');
    // What is joined is said: a membership in the list of gyms, on its stretch's first day, with its fee.
    for (const u of y.unlocks.filter((x) => x.member)) {
        assert.ok(u.gymId > GEORGES && u.cost > 0);
        assert.ok(y.segments.some((s) => (s.joined || []).includes(u.gymId) && Math.round((s.from - y.segments[0].from) / 864e5) === u.day));
    }
});

test('Max gains: no money to weigh, every specialist with more dots is joined on day 1, and the list of gyms says so', async () => {
    useClock(T0);
    setNow(T0);
    setup(PLAYERS.owner, { plan: { pickBy: 'max', pickByPicked: true } });
    const saved = await createPlan({ months: 3, pause: noPause });
    const y = saved.year;
    assert.ok((y.segments[0].joined || []).length >= 1);
    const fees = y.unlocks.filter((u) => u.member && u.day === 0).reduce((a, u) => a + u.cost, 0);
    assert.equal(fees, 150e6);
});

test('the friend, 12 months at $2M a day: a ladder gym that opens in the last stretch is foreseen (the path ended $93M over its budget)', async () => {
    useClock(T0);
    globalThis.document = fakeDocument();
    setNow(T0);
    setup(PLAYERS.friend, { plan: { pickBy: 'most', pickByPicked: true }, settings: { budget: 60e6, horizonDays: 30 } });
    const saved = await createPlan({ months: 12, pause: noPause });
    const path = saved.year.path;
    assert.ok(path.cost <= 2e6 * saved.days, 'the path costs $' + path.cost + ' against $' + 2e6 * saved.days);
});
