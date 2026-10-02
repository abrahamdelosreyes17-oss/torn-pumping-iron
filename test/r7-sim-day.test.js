/*
 * Round 7, R7.0: one rule, two places (ROUND7-PLAN §2.2). Every strategy is
 * worked out by the simulator (core/strategies.js: the plan's numbers) and by
 * the day plan (core/plan.js: Home's steps). For every plan with a boosted
 * session, and each reference player, the first one must be the same both
 * ways: the energy trained, the trains per stat, the gain, the time. An
 * engine rule changed in one place only fails here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { PLAYERS } from './support/ref.mjs';
import { firstBoost, secondJump, jumpCycle, manyDays, liteDay, firstDayFrom, BOOSTED } from './support/sim-vs-day.mjs';
import { STATS } from '../src/core/gain.js';
import { STRATEGIES } from '../src/core/strategies.js';

/** The two step differently (5-minute steps against the minute after the tick): this much apart is the same session. */
const MINUTES_APART = 5;
/** The split is greedy train by train; a tie can fall either way once. */
const TRAINS_APART = 1;
const GAIN_APART = 0.001;

for (const [pid, p] of Object.entries(PLAYERS)) {
    for (const id of BOOSTED) {
        test('simulator = day plan · ' + pid + ' · ' + id + ': the first boosted session', () => {
            const { sim, day } = firstBoost(p, id);
            assert.ok(sim, 'the simulator has a boosted session');
            assert.ok(day, 'the day plan has a boosted session');
            assert.equal(day.energy, sim.energy, 'energy trained');
            for (const k of STATS) assert.ok(Math.abs((day.trains[k] || 0) - (sim.trains[k] || 0)) <= TRAINS_APART, k + ' trains: day plan ' + (day.trains[k] || 0) + ', simulator ' + (sim.trains[k] || 0));
            assert.ok(Math.abs(day.gain - sim.gain) <= GAIN_APART * sim.gain, 'gain: day plan ' + Math.round(day.gain) + ', simulator ' + Math.round(sim.gain));
            assert.ok(Math.abs(day.at - sim.at) <= MINUTES_APART, 'when: day plan at ' + day.at + ' min, simulator at ' + sim.at + ' min');
        });
    }
}

// Round 7 (B.2, the jump cycle): the jump after the first one, as the player sees it once the first is trained.
// Before, the day plan waited for the next quarter tick when the Ecstasy's cooldown ended a few minutes after one, so
// every jump sat a quarter of an hour after the simulator's.
const JUMPS = BOOSTED.filter((id) => STRATEGIES[id].kind === 'jump');
for (const [pid, p] of Object.entries(PLAYERS)) {
    for (const id of JUMPS) {
        test('simulator = day plan · ' + pid + ' · ' + id + ': the second jump', () => {
            const { sim, day } = secondJump(p, id);
            assert.ok(sim, 'the simulator has a second jump');
            assert.ok(day, 'the day plan shows the next jump');
            assert.ok(Math.abs(day.at - sim.at) <= MINUTES_APART, 'when: day plan at ' + day.at + ' min, simulator at ' + sim.at + ' min');
            assert.equal(day.bar, sim.bar, 'energy in the bar at the jump');
            assert.equal(day.energy, sim.energy, 'energy trained');
            for (const k of STATS) assert.ok(Math.abs((day.trains[k] || 0) - (sim.trains[k] || 0)) <= TRAINS_APART, k + ' trains: day plan ' + (day.trains[k] || 0) + ', simulator ' + (sim.trains[k] || 0));
            assert.ok(Math.abs(day.gain - sim.gain) <= GAIN_APART * sim.gain, 'gain: day plan ' + Math.round(day.gain) + ', simulator ' + Math.round(sim.gain));
        });
    }
}

// The whole cycle over 25 days (15 for the console jump: 14 jumps), for a plan made at six hours of the Torn day: the
// refills used, the jumps and the energy trained are the same both ways, and every jump lands in the same tick window.
// (A day with no jump leaves its refill unused in both: that refill is a rule of its own, not this one.)
for (const [id, days] of [['edvdJump', 25], ['chocoJump', 25], ['consoleJump', 15]]) {
    for (const hour of [0, 4, 8, 12, 16, 20]) {
        test('simulator = day plan · friend · ' + id + ' made at ' + String(hour).padStart(2, '0') + ':00: ' + days + ' days of jumps', () => {
            const { sim, day } = jumpCycle(PLAYERS.friend, id, { hour, days });
            assert.ok(sim.jumps.length >= 10, 'jumps: ' + sim.jumps.length);
            assert.equal(day.jumps.length, sim.jumps.length, 'jumps');
            assert.equal(day.refills, sim.refills, 'refills used');
            assert.equal(day.energy, sim.energy, 'energy trained');
            sim.jumps.forEach((j, i) => {
                assert.ok(Math.abs(day.jumps[i].at - j.at) <= MINUTES_APART, 'jump ' + (i + 1) + ': day plan at ' + day.jumps[i].at + ' min, simulator at ' + j.at + ' min');
                assert.equal(day.jumps[i].bar, j.bar, 'jump ' + (i + 1) + ': energy in the bar');
            });
        });
    }
}

// Round 7 (the Torn day): what is counted once a day (the refill, the small plan's Xanax a day) goes by Torn's day in
// the simulator too. Before, its day was 24 hours from the moment the plan was made: for a plan made at any hour but
// 00:00 the day plan used 11 refills in ten days and the simulator counted 10, and "2 Xanax a day" took 21 or 22
// against 20; a refill already used today blocked the simulator for 24 hours instead of until Torn's midnight.
const TORN_DAY = [
    ['steady', {}, 'full bars'],
    ['steady', { refillUsed: true }, 'today’s refill used'],
    ['steadyMax', {}, 'full bars'],
    ['steadyLite', {}, '2 Xanax a day', 2],
    ['edvdJump', { refillUsed: true }, 'today’s refill used'],
];
for (const [id, bars, words, xanaxPerDay] of TORN_DAY) {
    for (const hour of [0, 4, 8, 12, 16, 20]) {
        test('simulator = day plan · friend · ' + id + ' (' + words + ') made at ' + String(hour).padStart(2, '0') + ':00: ten days of refills and Xanax', () => {
            const { sim, day, barE } = manyDays(PLAYERS.friend, id, { hour, days: 10, bars, xanaxPerDay });
            assert.equal(sim.refills, day.refills, 'refills used: simulator ' + sim.refills + ', day plan ' + day.refills);
            assert.equal(sim.xanax, day.xanax, 'Xanax taken: simulator ' + sim.xanax + ', day plan ' + day.xanax);
            // Plain steady: the day plan may hold up to one bar at the end that the simulator has already trained.
            if (id === 'steady') assert.ok(sim.energy - day.energy >= 0 && sim.energy - day.energy <= barE, 'energy: day plan ' + day.energy + ', simulator ' + sim.energy);
        });
    }
}

// Round 7 (A.4): the small-budget plan's Xanax a day is one rule in both places.
for (const [pid, p] of Object.entries(PLAYERS)) {
    for (const n of [0, 1, 2, 3]) {
        for (const refill of [true, false]) {
            test('simulator = day plan · ' + pid + ' · steady with ' + n + ' Xanax a day' + (refill ? ' and the refill' : ', no refill') + ': the first day', () => {
                const { sim, day, barE } = liteDay(p, n, { refill });
                assert.equal(day.xanax, sim.xanax, 'Xanax taken');
                assert.equal(sim.xanax, n);
                assert.equal(day.refills, refill ? 1 : 0, 'the refill');
                // The day plan may hold up to one bar at midnight that the simulator has already trained; never more.
                assert.ok(sim.energy - day.energy >= 0 && sim.energy - day.energy <= barE, 'energy: day plan ' + day.energy + ', simulator ' + sim.energy);
                assert.ok(Math.abs(day.gain / day.energy - sim.gain / sim.energy) <= 0.015 * (sim.gain / sim.energy), 'gain per energy: day plan ' + (day.gain / day.energy).toFixed(3) + ', simulator ' + (sim.gain / sim.energy).toFixed(3));
            });
        }
    }
}

// Round 7 (R7.2): the simulator starts from the bars as they are when the plan is made, like the day plan always did.
// Before, it started from a full bar with no cooldown, so day one of a plan promised more than its own steps could do.
const BARS = [
    ['energy 20, a drug cooldown of 3 h 51 m', { energy: 20, drug: 3 * 3600 + 51 * 60 }],
    ['energy 0, a drug cooldown of 6 h, the refill used', { energy: 0, drug: 6 * 3600, refillUsed: true }],
    ['energy 75, happy 3,000', { energy: 75, happy: 3000 }],
    ['full bars', {}],
];
for (const [pid, p] of Object.entries(PLAYERS)) {
    for (const [name, bars] of BARS) {
        test('simulator = day plan · ' + pid + ' · steady from ' + name + ': the first day', () => {
            const { sim, full, day, barE } = firstDayFrom(p, 'steady', bars);
            assert.equal(day.xanax, sim.xanax, 'Xanax taken');
            assert.equal(day.refills, sim.refills, 'refills');
            // The day plan may hold up to one bar at midnight that the simulator has already trained; never more.
            assert.ok(sim.energy - day.energy >= 0 && sim.energy - day.energy <= barE, 'energy: day plan ' + day.energy + ', simulator ' + sim.energy + ' (from a full bar it said ' + full.energy + ')');
            assert.ok(Math.abs(day.gain / day.energy - sim.gain / sim.energy) <= 0.02 * (sim.gain / sim.energy), 'gain per energy: day plan ' + (day.gain / day.energy).toFixed(3) + ', simulator ' + (sim.gain / sim.energy).toFixed(3));
        });
    }
}
