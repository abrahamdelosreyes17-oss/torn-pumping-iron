/*
 * Round 7, R7.3: steps you can't miss (the logic). A boost or jump carries
 * its actions in order; in the middle of one the plan keeps its place (read
 * from Torn's bars, never from a click); the day log records a step when it
 * is finished; steps past midnight say their day; a stack day has no
 * "Refill unused".
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { PLAYERS, T0, apiOf } from './support/ref.mjs';
import { buildModel } from '../src/core/model.js';
import { normalizeState, tornDayStart, nextQuarterTick } from '../src/core/bars.js';
import { logFromDiff, drugsToday, boostActions, MID_BOOST_MIN } from '../src/core/plan.js';
import { XANAX, ECSTASY, EDVD, CANDY_KISSES } from '../src/core/items.js';

const friend = PLAYERS.friend;
const MIN = 60e3;
const HOUR = 3600e3;
// One minute after a quarter tick: 14 minutes until happy above the maximum resets.
const NOW = Date.parse('2026-10-01T12:16:00Z');
const TICK = nextQuarterTick(NOW);

function model(strategy, bars, { log = [], now = NOW } = {}) {
    const state = normalizeState(apiOf(friend, { refillUsed: true, ...bars }), now);
    return buildModel({ state, statics: {}, plan: { strategy, build: friend.build, goal: null }, settings: { horizonDays: 30 }, log, now, unlockedKnown: Array.from({ length: 12 }, (_, i) => i + 1) });
}

test('a planned jump carries its actions in order, each with what proves it done; the first is the one of the moment', () => {
    const m = model('edvdJump', { energy: 1000 });
    const jump = m.steps.find((s) => s.kind === 'jump');
    assert.deepEqual(jump.actions.map((a) => a.id), ['eat', 'drug', 'train']);
    assert.equal(jump.actions[0].text, 'Eat EDVD × 5');
    assert.equal(jump.actions[1].text, 'Take the Ecstasy');
    assert.ok(jump.actions.every((a) => !a.done && a.proof));
    assert.equal(jump.actionNow, 0, 'eat first');
    assert.equal(jump.deadline, jump.tick + 15 * MIN, 'all of it before the tick after the one it starts on');
    // With the refill still unused it is the last action.
    const withRefill = model('edvdJump', { energy: 1000, refillUsed: false }).steps.find((s) => s.kind === 'jump');
    assert.equal(withRefill.actions[withRefill.actions.length - 1].id, 'refill');
    const acts = boostActions({ eat: 'Candy Kisses × 49', jp: '10 job points on happy', drug: 'Xanax', refill: true });
    assert.deepEqual(acts.list.map((a) => a.id), ['eat', 'jp', 'drug', 'train', 'refill']);
});

test('mid-jump, the EDVD eaten and the Ecstasy not yet: "Ecstasy now, then train it all", due before the tick (was "in 30 h")', () => {
    const m = model('edvdJump', { energy: 1000, happy: 16500, booster: 30 * 3600 });
    const s = m.steps[0];
    assert.equal(s.kind, 'jump');
    assert.equal(s.at, NOW);
    assert.equal(s.label, 'Ecstasy now, then train it all');
    assert.equal(s.energy, 1000);
    assert.equal(s.deadline, TICK);
    assert.ok(s.mid && s.strict);
    assert.match(s.note, /finish before the 12:30 tick, when the happy resets/);
    assert.deepEqual(s.items, [{ id: ECSTASY, qty: 1 }], 'no second load of EDVD to buy');
    assert.equal(s.actions.find((a) => a.id === 'eat').done, true);
    assert.equal(s.actions[s.actionNow].id, 'drug');
    // The same gain as the jump planned before anything was eaten (the Ecstasy doubles the happy now on the bar).
    const planned = model('edvdJump', { energy: 1000 }).steps.find((x) => x.kind === 'jump');
    assert.equal(s.gain, planned.gain);
    // Then the next stack starts from nothing, after the Ecstasy's cooldown.
    const next = m.steps.find((x) => x.kind === 'stack');
    assert.equal(next.label, 'Xanax #1 of 4 · don’t train'.replace('’', "'"));
    assert.equal(next.at, NOW + 4 * HOUR);
});

test('mid-jump, the Ecstasy taken: "Train it all now"; the stack trained and the refill unused: the refill now', () => {
    // The Ecstasy is in (its cooldown runs past the tick), happy doubled, the stack untouched.
    let m = model('edvdJump', { energy: 1000, happy: 33000, booster: 30 * 3600, drug: 4 * 3600 - 120 });
    assert.equal(m.steps[0].label, 'Train it all now');
    assert.equal(m.steps[0].at, NOW);
    assert.equal(m.steps[0].energy, 1000);
    assert.deepEqual(m.steps[0].items, []);
    assert.equal(m.steps[0].actions[m.steps[0].actionNow].id, 'train');
    // Trained, the refill still there, happy still up: the refill is the step, still before the tick.
    m = model('edvdJump', { energy: 0, happy: 32400, booster: 30 * 3600, drug: 4 * 3600 - 300, refillUsed: false });
    assert.equal(m.steps[0].kind, 'refill');
    assert.equal(m.steps[0].at, NOW + MIN);
    assert.equal(m.steps[0].deadline, TICK);
    assert.equal(m.steps[0].energy, 150);
});

test('the boosters eaten early, an earlier Xanax still cooling down: the Ecstasy waits for it when that is before the tick', () => {
    const m = model('edvdJump', { energy: 1000, happy: 16500, booster: 30 * 3600, drug: 5 * 60 });
    assert.equal(m.steps[0].label, 'Ecstasy at 12:21, then train it all');
    assert.equal(m.steps[0].at, NOW + 5 * MIN);
    assert.equal(m.steps[0].deadline, TICK);
});

test('mid-boost, Candy + Xanax: the candy eaten, "Xanax #1 now, then train it all"; no second boost today (was a plain Xanax and 14 more candy)', () => {
    const m = model('candyXanax', { energy: 150, happy: 6450, booster: 24.5 * 3600 });
    const s = m.steps[0];
    assert.equal(s.kind, 'boost');
    assert.equal(s.label, 'Xanax #1 now, then train it all');
    assert.equal(s.energy, 400);
    assert.deepEqual(s.items, [{ id: XANAX, qty: 1 }]);
    assert.equal(m.steps.filter((x) => x.kind === 'boost' && tornDayStart(x.at) === tornDayStart(NOW)).length, 1);
    assert.equal(m.strip.drug.xanaxPlanned, 2, 'the Xanax in the boost counts in the day (and the one after it)');
});

test('mid-boost, daily choco: the candy eaten while the Xanax is held: "Ecstasy now, then train it all"', () => {
    const m = model('dailyChoco', { energy: 400, happy: 6450, booster: 24.5 * 3600 });
    assert.equal(m.steps[0].label, 'Ecstasy now, then train it all');
    assert.equal(m.steps[0].energy, 400);
});

test('happy a little above the maximum is not a boost under way (an FHC, the Xanax itself)', () => {
    const m = model('edvdJump', { energy: 1000, happy: 4000 + MID_BOOST_MIN - 1 });
    assert.equal(m.steps[0].mid, undefined);
    assert.match(m.steps[0].label, /^EDVD × 5 \+ Ecstasy/);
    // A steady plan never has a mid-step.
    assert.ok(model('steady', { energy: 150, happy: 9000 }).steps.every((s) => !s.mid));
});

test('the day log: a boost is logged when its drug is taken, not when its candy is eaten; its Xanax counts in the day', () => {
    const at = NOW;
    const step = { kind: 'boost', label: 'Candy Kisses × 49 + Xanax #1, then train it all', items: [{ id: CANDY_KISSES, qty: 49 }, { id: XANAX, qty: 1 }] };
    // The candy goes in (the booster cooldown jumps): noted, not done.
    let log = logFromDiff([], { boosterUsed: true, drugTaken: false, refillUsed: false, trained: {} }, { at, nextStep: step });
    assert.equal(log[0].kind, 'boosting');
    assert.equal(drugsToday(log, at), 0);
    // The plan still shows the step (from the bars): the Xanax, then train.
    const m = model('candyXanax', { energy: 150, happy: 6450, booster: 24.5 * 3600 }, { log });
    assert.equal(m.steps[0].label, 'Xanax #1 now, then train it all');
    // The Xanax and the trains: now the boost is done, and it was a Xanax.
    log = logFromDiff(log, { boosterUsed: false, drugTaken: true, refillUsed: false, trained: { str: 1003 } }, { at: at + 2 * MIN, nextStep: m.steps[0] });
    const done = log[log.length - 1];
    assert.equal(done.kind, 'boost');
    assert.equal(done.xanax, true);
    assert.equal(done.gain, 1003);
    assert.equal(drugsToday(log, at + 2 * MIN), 1, '"Xanax 1 of N today" counts the one in the boost');
    // A jump: the EDVD eaten is "boosting"; the Ecstasy finishes it and is not a Xanax.
    const jump = { kind: 'jump', label: 'EDVD × 5 + Ecstasy, then train it all', items: [{ id: EDVD, qty: 5 }, { id: ECSTASY, qty: 1 }] };
    let j = logFromDiff([], { boosterUsed: true, drugTaken: false, refillUsed: false, trained: {} }, { at, nextStep: jump });
    assert.equal(j[0].kind, 'boosting');
    j = logFromDiff(j, { boosterUsed: false, drugTaken: true, refillUsed: false, trained: { str: 9000 } }, { at: at + MIN, nextStep: { ...jump, label: 'Ecstasy now, then train it all', items: [{ id: ECSTASY, qty: 1 }], mid: true } });
    assert.equal(j[j.length - 1].kind, 'jump');
    assert.equal(j[j.length - 1].xanax, undefined);
    assert.equal(drugsToday(j, at + MIN), 0);
    // Booster and drug in one read (eaten and taken between two reads): done at once, as before.
    const both = logFromDiff([], { boosterUsed: true, drugTaken: true, refillUsed: false, trained: { str: 1003 } }, { at, nextStep: step });
    assert.equal(both[0].kind, 'boost');
    // A plain energy booster in a steady plan (an FHC): still logged as it was.
    const fhc = logFromDiff([], { boosterUsed: true, drugTaken: false, refillUsed: false, trained: { str: 300 } }, { at, nextStep: { kind: 'booster', label: 'FHC × 1, train after each', items: [{ id: 367, qty: 1 }] } });
    assert.equal(fhc[0].kind, 'booster');
});

test('a stack day: no "Refill unused" heads-up and the strip says why; "trains today" counts today only', () => {
    const now = tornDayStart(T0) + 22.5 * HOUR;
    // Two Xanax stacked (650 energy), the third due in 3 h, today's refill unused.
    const m = model('edvdJump', { energy: 650, drug: 3 * 3600, refillUsed: false }, { now });
    assert.ok(!m.heads.some((h) => /Refill unused/.test(h.text)), m.heads.map((h) => h.text).join(' | '));
    assert.equal(m.strip.refill.stacking, true);
    assert.equal(m.strip.refill.free, true);
    // The jump lands tomorrow: its trains are not "trains today".
    const jump = m.steps.find((s) => s.kind === 'jump');
    assert.ok(jump && tornDayStart(jump.at) > tornDayStart(now));
    assert.ok(m.statRows.every((r) => r.plannedTrains === 0), 'trains today: ' + m.statRows.map((r) => r.stat + ' ' + r.plannedTrains).join(', '));
    // A steady plan late in the day with the refill unused still warns.
    const steady = model('steady', { energy: 0, drug: 6 * 3600, refillUsed: false }, { now });
    assert.ok(steady.heads.some((h) => /Refill unused/.test(h.text)));
});
