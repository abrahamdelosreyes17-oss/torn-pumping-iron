/*
 * Checking the gain model against your own trains (Progress › Gain model).
 * Between two polls where exactly one stat rose and the energy used is
 * known, the model's prediction for those trains is compared with what
 * your stat actually did. Pure; the feed stores the samples.
 */

import { trainSession } from './gain.js';
import { gymById } from './gyms.js';

/** Samples kept (the learner wants many; each is ~150 bytes). */
export const CALIBRATION_KEEP = 200;

/**
 * @param {object} prev - normalizeState() before
 * @param {object} next - after
 * @param {object} diff - diffStates(prev, next)
 * @param {object} o - {table, perks (per-stat multipliers), happyLossMult}
 * @returns {{at, stat, trains, predicted, actual, S, H, dots, E, gym, perks}|null} (S/H/dots/E let the learner try other formulas)
 */
export function calibrationSample(prev, next, diff, { table, perks = null } = {}) {
    const stats = Object.keys((diff && diff.trained) || {});
    if (stats.length !== 1 || diff.drugTaken || diff.boosterUsed || diff.refillUsed) return null;
    const stat = stats[0];
    const gym = gymById(next.gymId || prev.gymId, table);
    if (!gym || !(gym.dots[stat] > 0) || !prev.stats) return null;
    const spent = diff.energySpent;
    const trains = Math.round(spent / gym.energy);
    if (!(trains >= 1) || Math.abs(trains * gym.energy - spent) > 1) return null;
    const pred = trainSession({ stat, S: prev.stats[stat], H: prev.happy.current, dots: gym.dots[stat], energyPerTrain: gym.energy, energy: trains * gym.energy, perks: perks ? perks[stat] : 1 });
    return { at: next.at, stat, trains, predicted: pred.gain, actual: diff.trained[stat], S: prev.stats[stat], H: prev.happy.current, dots: gym.dots[stat], E: gym.energy, gym: gym.name, perks: perks ? perks[stat] : 1 };
}

/** Keep the last samples and the error of the total (actual vs predicted, %). */
export function addCalibration(store, sample) {
    const samples = [...((store && store.samples) || []), sample].slice(-CALIBRATION_KEEP);
    const p = samples.reduce((a, s) => a + s.predicted, 0);
    const a = samples.reduce((x, s) => x + s.actual, 0);
    return { samples, n: samples.length, errPct: p > 0 ? (100 * (a - p)) / p : 0 };
}
