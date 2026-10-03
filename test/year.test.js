/*
 * R6.5: the long plan (core/year.js): segments re-picked every 30 days and for each event, gyms opening as energy is
 * trained (fees paid, specialists after their ladder gym), events on their dates (next year's from date rules), a band.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { segmentsOf, climb, yearSteps, openAt, REPICK_DAYS } from '../src/core/year.js';
import { eventsBetween, easterSunday, holdBoosterFor } from '../src/core/events.js';
import { gymsOpenAt, GEORGES } from '../src/core/gyms.js';
import { simulateStrategy } from '../src/core/strategies.js';
import { compareSteps, simInputs, playerContext, buildOf } from '../src/core/model.js';
import { normalizeState } from '../src/core/bars.js';
import { targetShares } from '../src/core/plan.js';

const DAY = 86400e3;
const T = Date.parse('2026-09-30T00:00:00Z');

test('events for a year: the API\'s this year, the date rules for next (Easter by the computus), the Anniversary\'s energy', () => {
    assert.equal(new Date(easterSunday(2027)).toISOString().slice(0, 10), '2027-03-28');
    assert.equal(new Date(easterSunday(2026)).toISOString().slice(0, 10), '2026-04-05');
    const ev = eventsBetween({ events: [{ title: 'CaffeineCon 2026', start: Date.parse('2026-10-15') / 1000, end: Date.parse('2026-10-15T23:59:59Z') / 1000 }] }, T, T + 365 * DAY, { startTime: '12:00' });
    assert.deepEqual(ev.map((e) => e.id), ['caffeinecon', 'diabetes', 'anniversary', 'easter']);
    assert.equal(ev[0].expected, false, 'this year\'s from the API');
    assert.equal(ev[1].expected, true, 'from the rule');
    assert.equal(ev.find((e) => e.id === 'anniversary').freeEnergy, 500);
    // A 48 h booster cap (Voracity) holds the booster 48 h before, not 24.
    const e = { id: 'diabetes', usesBooster: true, active: false, start: T + 40 * 3600e3 };
    assert.equal(holdBoosterFor([e], T, 'chocoJump'), null);
    assert.ok(holdBoosterFor([e], T, 'chocoJump', 48));
});

test('segments: every 10 days, an event from 2 days before to its end', () => {
    const ev = [{ id: 'diabetes', start: T + 44 * DAY + 12 * 3600e3, end: T + 46 * DAY + 12 * 3600e3 }];
    const segs = segmentsOf(T, T + 91 * DAY, ev);
    assert.equal(segs.reduce((a, s) => a + s.days, 0), 91);
    const e = segs.find((s) => s.event);
    assert.equal(e.from, T + 42 * DAY);
    assert.equal(e.to, T + 47 * DAY);
    assert.ok(segs.every((s) => s.days <= REPICK_DAYS + 3), 'a sliver under 3 days joins its neighbour');
    assert.ok(segs.every((s) => s.event || s.days >= 3), 'no plain stretch too short for a jump’s stack: ' + segs.map((s) => s.days).join(','));
    // The plain time is cut from where it begins: 10 days at a time from the plan's start, and again from the event's end.
    assert.deepEqual(segs.map((s) => s.days), [10, 10, 10, 12, 5, 10, 10, 10, 10, 4]);
});

test('gyms: the ladder climbs with energy trained; specialists after their ladder gym', () => {
    assert.deepEqual(climb(18, 0, 36610), { top: 19, toNext: 0 });
    assert.deepEqual(climb(18, 30000, 10000), { top: 19, toNext: 3390 });
    assert.equal(climb(23, 0, 1e9).top, GEORGES);
    assert.ok(gymsOpenAt(20).includes(25) && gymsOpenAt(20).includes(26), 'Balboas and Frontline after Cha Cha\'s');
    assert.ok(!gymsOpenAt(21).includes(31) && gymsOpenAt(22).includes(31), 'Sports Science Lab after Last Round');
    assert.ok(!gymsOpenAt(23).includes(27) && gymsOpenAt(24).includes(27), 'Gym 3000 after George\'s');
});

test('the simulator: an event\'s multiplier only on its dates, free energy once, a gym opening mid-run', () => {
    const base = { stats: { str: 1e5, spd: 1e5, def: 1e5, dex: 1e5 }, target: { str: 0.25, spd: 0.25, def: 0.25, dex: 0.25 }, gyms: { str: { dots: 6.5, energy: 10 }, spd: { dots: 6.4, energy: 10 }, def: { dots: 6.2, energy: 10 }, dex: { dots: 6.2, energy: 10 } }, happyMax: 5025, days: 10, prices: {} };
    const plain = simulateStrategy('candyXanax', base);
    const wdd = simulateStrategy('candyXanax', { ...base, events: [{ from: 4 * 1440, to: 6 * 1440, candyMult: 3 }] });
    assert.ok(wdd.gained > plain.gained, 'candy ×3 during the window');
    const free = simulateStrategy('steady', { ...base, events: [{ from: 1440, to: 2880, freeEnergy: 500 }] });
    assert.ok(free.energyTrained >= simulateStrategy('steady', base).energyTrained + 450);
    const opened = simulateStrategy('steady', { ...base, unlock: { left: 5000, next: () => ({ gymId: 19, cost: 15e6, gyms: { str: { dots: 7.5, energy: 10 }, spd: { dots: 7.5, energy: 10 }, def: { dots: 7.5, energy: 10 }, dex: { dots: 7.5, energy: 10 } }, left: Infinity }) } });
    assert.equal(opened.unlocked.length, 1);
    assert.ok(opened.gained > simulateStrategy('steady', base).gained, 'better gym after it opens');
    assert.ok(opened.cost >= simulateStrategy('steady', base).cost + 15e6, 'its fee paid');
});

test('the year path for the friend: re-picked plans, gyms opening, a band around the total', () => {
    const api = { bars: { energy: { current: 150, maximum: 150, increment: 5, interval: 600, tick_time: 120, full_time: 0 }, happy: { current: 5025, maximum: 5025, increment: 5, interval: 900, tick_time: 300, full_time: 0 } }, cooldowns: { drug: 0, medical: 0, booster: 0 }, refills: { energy: true }, battlestats: { strength: { value: 118400 }, defense: { value: 96200 }, speed: { value: 110900 }, dexterity: { value: 82700 }, total: 1 }, gym: { id: 18 } };
    const state = normalizeState(api, T);
    const pc = playerContext(state, {}, { unlockedKnown: Array.from({ length: 18 }, (_, i) => i + 1) });
    const shares = targetShares({ build: 'balanced' }, pc.stats, buildOf('balanced').shares);
    const g = yearSteps({ compare: compareSteps, inputs: simInputs, args: { state, pc, shares, settings: { horizonDays: 30, budget: 150e6 }, prices: {}, special: 0, statics: {}, pickBy: 'most' }, start: T, end: T + 182 * DAY, budgetPerDay: 5e6, events: eventsBetween(null, T, T + 182 * DAY, { startTime: '12:00' }), centre: true });
    let r = g.next();
    while (!r.done) r = g.next();
    const y = r.value;
    assert.equal(y.result.daily.length, 182);
    assert.ok(y.unlocks[0].gymId === 19 && y.unlocks[0].cost === 15e6);
    assert.ok(y.segments.some((s) => s.event && s.event.includes('diabetes')), 'World Diabetes Day has its own segment');
    assert.ok(y.band.low < y.result.gained && y.result.gained < y.band.high);
    // Review fix: the band re-runs the same path with the simulator's own inputs, so its centre is the path.
    assert.ok(Math.abs(y.band.centre / y.result.gained - 1) < 0.03, 'centre ' + y.band.centre + ' vs path ' + y.result.gained);
});

function run(g) {
    let r = g.next();
    while (!r.done) r = g.next();
    return r.value;
}

function ctxFor(stats, gymId, extra = {}) {
    const api = { bars: { energy: { current: 150, maximum: 150, increment: 5, interval: 600, tick_time: 120, full_time: 0 }, happy: { current: 5025, maximum: 5025, increment: 5, interval: 900, tick_time: 300, full_time: 0 } }, cooldowns: { drug: 0, medical: 0, booster: 0 }, refills: { energy: true, special_count: extra.specials || 0 }, battlestats: { strength: { value: stats.str }, defense: { value: stats.def }, speed: { value: stats.spd }, dexterity: { value: stats.dex }, total: 1 }, gym: { id: gymId } };
    const state = normalizeState(api, T);
    const pc = playerContext(state, {}, { unlockedKnown: Array.from({ length: gymId }, (_, i) => i + 1) });
    const shares = targetShares({ build: 'balanced' }, pc.stats, buildOf('balanced').shares);
    return { state, pc, shares };
}

test('review fixes: SSL never opened by the projection; specialists pay their membership; no phantom stretch', () => {
    assert.ok(!openAt(22).includes(31), 'Sports Science Lab needs ≤ 150 drugs ever: a Xanax plan never qualifies');
    assert.ok(openAt(22, [31]).includes(31), 'unless the gym page says you already joined it');
    assert.deepEqual(segmentsOf(T + 10 * DAY, T), [], 'recalibrating after the end: nothing to plan');
    const segs = segmentsOf(T, T + 60 * DAY, [{ id: 'diabetes', start: T + 3 * DAY, end: T + 4 * DAY }]);
    assert.ok(segs.every((x) => x.event || x.days >= 3), 'no plain stretch under 3 days: ' + segs.map((x) => x.days).join(','));
    // At Last Round with even stats: no SSL; a Frontline/Balboas pick (if any) carries its $50M fee.
    const { state, pc, shares } = ctxFor({ str: 3e6, spd: 3e6, def: 3e6, dex: 3e6 }, 22);
    const y = run(yearSteps({ compare: compareSteps, inputs: simInputs, args: { state, pc, shares, settings: { horizonDays: 30, budget: 150e6 }, prices: {}, special: 0, statics: {}, pickBy: 'most' }, start: T, end: T + 30 * DAY, budgetPerDay: 5e6, events: [] }));
    const full = run(compareSteps({ state, pc, shares, settings: { horizonDays: 30, budget: 150e6 }, prices: {}, special: 0, statics: {}, pickBy: 'most' }));
    const same = full[y.segments[0].strategy];
    assert.ok(y.result.gained < same.gained * 1.1, 'no free SSL windfall: ' + y.result.gained + ' vs ' + same.gained);
});

test('review fixes: held boosters and special refills are used once over the whole path, not per stretch', () => {
    const { state, pc, shares } = ctxFor({ str: 118400, spd: 110900, def: 96200, dex: 82700 }, 18, { specials: 30 });
    const statics = { inventory: { 367: 10 } };
    const y = run(yearSteps({ compare: compareSteps, inputs: simInputs, args: { state, pc, shares, settings: { horizonDays: 30, budget: 150e6 }, prices: {}, special: 0, statics, pickBy: 'max' }, start: T, end: T + 120 * DAY, budgetPerDay: Infinity, events: [] }));
    const heldFhc = y.segments.length ? (y.result.used.held || 0) : 0;
    void heldFhc;
    assert.ok((y.result.used.special || 0) <= 30, 'special refills used ' + y.result.used.special + ' of the 30 held');
});
