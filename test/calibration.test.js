import test from 'node:test';
import assert from 'node:assert/strict';

import { calibrationSample, addCalibration, CALIBRATION_KEEP } from '../src/core/calibration.js';
import { normalizeState, diffStates } from '../src/core/bars.js';
import { trainSession } from '../src/core/gain.js';
import { GYMS } from '../src/core/gyms.js';

const T0 = Date.UTC(2026, 8, 29, 10, 48);
const st = (at, energy, dex, drug = 3600) => normalizeState({ bars: { energy: { current: energy, maximum: 150, increment: 5, interval: 600, tick_time: 600 }, happy: { current: 5025, maximum: 5025, increment: 5, interval: 900, tick_time: 900 } }, cooldowns: { drug }, refills: { energy: true }, battlestats: { strength: { value: 118400 }, speed: { value: 110900 }, defense: { value: 96200 }, dexterity: { value: dex } }, gym: { id: 18 } }, at);

test('one stat trained with known energy: predicted vs actual', () => {
    const pred = trainSession({ stat: 'dex', S: 82700, H: 5025, dots: 6.2, energyPerTrain: 10, energy: 150 }).gain;
    const a = st(T0, 150, 82700);
    const b = st(T0 + 30e3, 0, 82700 + Math.round(pred * 1.02), 3570);
    const s = calibrationSample(a, b, diffStates(a, b), { table: GYMS });
    assert.equal(s.stat, 'dex');
    assert.equal(s.trains, 15);
    assert.ok(Math.abs(s.predicted - pred) < 1e-6);
    assert.ok(Math.abs(s.actual / s.predicted - 1.02) < 0.01);
});

test('mixed polls are skipped: a drug taken, two stats, or no energy change', () => {
    const a = st(T0, 150, 82700);
    assert.equal(calibrationSample(a, st(T0 + 30e3, 250, 83500, 25200), diffStates(a, st(T0 + 30e3, 250, 83500, 25200)), { table: GYMS }), null);
    assert.equal(calibrationSample(a, a, diffStates(a, a), { table: GYMS }), null);
});

test('the error is of the totals, over the last 50', () => {
    let c = null;
    for (let i = 0; i < 60; i++) c = addCalibration(c, { predicted: 100, actual: 103 });
    assert.equal(c.n, CALIBRATION_KEEP);
    assert.ok(Math.abs(c.errPct - 3) < 1e-9);
});
