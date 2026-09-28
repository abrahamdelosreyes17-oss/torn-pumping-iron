import test from 'node:test';
import assert from 'node:assert/strict';

import { gainPerTrain, effectiveStat, trainSession, trainsToReach, round4, totalOf, HAPPY_CAP, POST_50M_MODE, HAPPY_LOSS_PER_ENERGY, STAT_AB } from '../src/core/gain.js';

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (±${tol})`);

test('the research sanity table: STR at George\'s (7.3), 10 E, exact to ±1', () => {
    near(gainPerTrain('str', 1e5, 5025, 7.3, 10), 68, 1, '100k, 5,025 happy');
    near(gainPerTrain('str', 1e5, 99999, 7.3, 10), 572, 1, '100k, 99,999 happy');
    near(gainPerTrain('str', 1e6, 5025, 7.3, 10), 467, 1, '1M, 5,025 happy');
    near(gainPerTrain('str', 1e6, 99999, 7.3, 10), 1038, 1, '1M, 99,999 happy');
});

test('the happy ratio shrinks as stats grow (8.4× at 100k, 2.2× at 1M, ~1.28× at 10M)', () => {
    const r = (S) => gainPerTrain('str', S, 99999, 7.3, 10) / gainPerTrain('str', S, 5025, 7.3, 10);
    near(r(1e5), 8.4, 0.1);
    near(r(1e6), 2.2, 0.05);
    near(r(1e7), 1.28, 0.02);
});

test('gain scales with dots, energy per train and perks', () => {
    const base = gainPerTrain('dex', 5e5, 5000, 5, 10);
    near(gainPerTrain('dex', 5e5, 5000, 10, 10), base * 2, 1e-9);
    near(gainPerTrain('dex', 5e5, 5000, 5, 50), base * 5, 1e-9);
    near(gainPerTrain('dex', 5e5, 5000, 5, 10, 1.2), base * 1.2, 1e-9);
});

test('DEF gains a little less than STR at the same numbers (B = −600)', () => {
    assert.ok(gainPerTrain('def', 1e5, 5000, 7, 10) < gainPerTrain('str', 1e5, 5000, 7, 10));
    assert.deepEqual(STAT_AB.def, [2100, -600]);
});

test('a gym without the stat, or an unknown stat, gains nothing', () => {
    assert.equal(gainPerTrain('str', 1e5, 5000, 0, 10), 0);
    assert.equal(gainPerTrain('luck', 1e5, 5000, 7, 10), 0);
    assert.equal(gainPerTrain('str', 1e5, 5000, 7, 0), 0);
});

test('happy is capped at 99,999 and never negative', () => {
    assert.equal(gainPerTrain('str', 1e6, 250000, 7.3, 10), gainPerTrain('str', 1e6, HAPPY_CAP, 7.3, 10));
    assert.equal(gainPerTrain('str', 1e6, -50, 7.3, 10), gainPerTrain('str', 1e6, 0, 7.3, 10));
});

test('above 50M the stat is damped; log10 by default, ln and power as alternatives', () => {
    assert.equal(POST_50M_MODE, 'log10');
    assert.equal(effectiveStat(4e7), 4e7);
    near(effectiveStat(1e9), 5e7 + 9.5e8 / (8.77635 * 9), 1);
    near(effectiveStat(1e9) / 1e6, 62.0, 0.1, 'research-gym: 1B → 62.0M (log10)');
    near(effectiveStat(1e9, 'ln') / 1e6, 55.2, 0.1, 'research-gym: 1B → 55.2M (ln)');
    near(effectiveStat(2.5e8, 'power') / 1e6, 52.96, 0.05);
});

test('round4 rounds to four places', () => {
    assert.equal(round4(1.23456), 1.2346);
    assert.equal(round4(0.00004), 0);
});

test('a session steps train by train: happy drops 0.5 × energy each train', () => {
    const r = trainSession({ stat: 'dex', S: 82700, H: 5325, dots: 6.2, energyPerTrain: 10, energy: 275 });
    assert.equal(r.trains, 27);
    assert.equal(r.energyUsed, 270);
    assert.equal(r.happyAfter, 5325 - 27 * 5);
    assert.equal(HAPPY_LOSS_PER_ENERGY, 0.5);
    near(r.gain, 1417, 5, 'K: about +1,420 DEX');
    assert.ok(r.statAfter > 82700);
});

test('a session never goes below zero happy and respects maxTrains', () => {
    const r = trainSession({ stat: 'str', S: 1e5, H: 30, dots: 5, energyPerTrain: 10, energy: 1000, maxTrains: 12 });
    assert.equal(r.trains, 12);
    assert.equal(r.happyAfter, 0);
});

test('one EDVD jump at 250M DEF (Isoyamas 8.0, 50 E, 1,000 E): +2.86M vs +2.56M plain', () => {
    const plain = trainSession({ stat: 'def', S: 250e6, H: 5325, dots: 8, energyPerTrain: 50, energy: 1000 });
    const jump = trainSession({ stat: 'def', S: 250e6, H: (5325 + 5 * 2500) * 2, dots: 8, energyPerTrain: 50, energy: 1000 });
    near(plain.gain / 1e6, 2.56, 0.01);
    near(jump.gain / 1e6, 2.86, 0.01);
    near(jump.gain - plain.gain, 297000, 1000, 'HANDOFF: +297k DEF');
});

test('trains to reach a target', () => {
    const r = trainsToReach({ stat: 'str', S: 1e5, target: 1e5 + 680, H: 5025, dots: 7.3, energyPerTrain: 10 });
    assert.equal(r.trains, 10);
    assert.equal(r.energy, 100);
    assert.deepEqual(trainsToReach({ stat: 'str', S: 10, target: 5, H: 0, dots: 1, energyPerTrain: 5 }), { trains: 0, energy: 0 });
    assert.equal(trainsToReach({ stat: 'str', S: 1e5, target: 1e9, H: 0, dots: 2, energyPerTrain: 5, limit: 10 }), null);
});

test('totalOf adds the four stats and ignores junk', () => {
    assert.equal(totalOf({ str: 1, spd: 2, def: 3, dex: 4 }), 10);
    assert.equal(totalOf({ str: 'x', spd: 2 }), 2);
    assert.equal(totalOf(null), 0);
});
