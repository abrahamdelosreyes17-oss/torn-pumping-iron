import test from 'node:test';
import assert from 'node:assert/strict';

import { learnGym, applyGymModel, describeGym, learnFights, applyFightModel, describeFights, LEARN_MIN } from '../src/core/learn.js';
import { gainPerTrain } from '../src/core/gain.js';
import { fightOnce, simulateFights, mulberry32 } from '../src/core/eye/fight.js';

/*
 * The simulation suite of docs/sims/learn-sim.mjs: a hidden truth makes the
 * sessions with the engine's own formula (plus Torn's random happy loss and
 * extra noise), the learner sees only the sessions.
 */

const T0 = Date.UTC(2026, 8, 1);
const HOUR = 3600e3;

// The sim's generator, one per scenario so each test is deterministic on its own.
function simRng(seed) {
    let s = seed;
    return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
}

function simSession(rnd, { stat, S, H, dots, E, trains }, truth) {
    let s = S;
    let h = H;
    for (let i = 0; i < trains; i++) {
        s += gainPerTrain(stat, s, h, dots, E, truth.mult[stat] || 1, truth.mode) * (1 + (rnd() - 0.5) * 2 * truth.noise);
        h = Math.max(0, h - (0.4 + 0.2 * rnd()) * E);
    }
    return s - S;
}

function simSessions(profile, truth, { n = 60, outliers = 0, seed = 7 } = {}) {
    const rnd = simRng(seed);
    const out = [];
    const st = { ...profile.stats };
    for (let i = 0; i < n; i++) {
        const stat = profile.train[i % profile.train.length];
        const x = { at: T0 + i * 8 * HOUR, stat, S: st[stat], H: profile.happy * (1 + rnd() * 0.3), dots: profile.dots, E: profile.E, trains: 15 + Math.floor(rnd() * 26) };
        let actual = simSession(rnd, x, truth);
        if (i < outliers) actual *= 1.25; // trains during a temporary perk the model didn't know
        st[stat] += actual;
        out.push({ ...x, actual });
    }
    return out;
}

const friend = { stats: { str: 118400, spd: 110900, def: 96200, dex: 82700 }, train: ['dex', 'def'], happy: 5025, dots: 6.2, E: 10 };
const ownerSpd = { stats: { spd: 4057438 }, train: ['spd'], happy: 4000, dots: 8.0, E: 10 };
const ownerDef = { stats: { def: 82440191 }, train: ['def'], happy: 4000, dots: 8.0, E: 10 };
const big = { stats: { str: 5e8 }, train: ['str'], happy: 5025, dots: 8.0, E: 10 };
const T = (mode, mult, noise) => ({ mode, mult, noise });
const NOW = T0 + 60 * 8 * HOUR;

for (const [name, profile] of [['friend', friend], ['owner SPD 4M', ownerSpd], ['owner DEF 82M', ownerDef]]) {
    test(`S1 already right (${name}): keeps the current model`, () => {
        const r = learnGym(simSessions(profile, T('log10', {}, 0.01)), { now: NOW });
        assert.equal(r.accepted, false, r.reasons.join(' '));
        assert.ok(r.heldOut.current < 0.5);
        assert.deepEqual(applyGymModel(r), { mult: { str: 1, spd: 1, def: 1, dex: 1 }, mode: 'log10' });
        assert.match(describeGym(r)[0], /already matches/);
    });
}

test('S2 a hidden +4% SPD perk: accepted, mult ≈ 1.04, found within 5 sessions', () => {
    const rows = simSessions(ownerSpd, T('log10', { spd: 1.04 }, 0.01));
    const r = learnGym(rows, { now: NOW });
    assert.equal(r.accepted, true, r.reasons.join(' '));
    assert.ok(Math.abs(r.model.mult.spd - 1.04) < 0.005, String(r.model.mult.spd));
    assert.ok(r.heldOut.current > 3 && r.heldOut.learned < 0.5);
    assert.equal(applyGymModel(r).mult.spd, r.model.mult.spd);
    assert.match(describeGym(r)[0], /^Your SPD gains run 4% above the formula: an unknown perk\? The plan now counts it\.$/);
    // Learning on only the first 5 sessions already gets within 1 point of the truth on the newest ones.
    const test = rows.slice(42);
    const five = learnGym([...rows.slice(0, 5), ...test], { cut: 5 });
    assert.ok(Math.abs(five.model.mult.spd - 1.04) < 0.01, String(five.model.mult.spd));
    assert.ok(five.heldOut.learned < 1);
});

test('S3 "power" damping at 82M: keeps current (the modes barely differ there)', () => {
    const r = learnGym(simSessions(ownerDef, T('power', {}, 0.01)), { now: NOW });
    assert.equal(r.accepted, false, r.reasons.join(' '));
    assert.equal(applyGymModel(r).mode, 'log10');
});

test('S3b "power" damping at 500M: accepted, mode found', () => {
    const r = learnGym(simSessions(big, T('power', {}, 0.01)), { now: NOW });
    assert.equal(r.accepted, true, r.reasons.join(' '));
    assert.equal(r.model.mode, 'power');
    assert.ok(Math.abs(r.model.mult.str - 1) < 0.01);
    assert.equal(r.candidates.length, 3);
    assert.ok(describeGym(r).some((l) => /Above 50M/.test(l)));
});

test('S3c "ln" damping at 500M: accepted, mode found', () => {
    const r = learnGym(simSessions(big, T('ln', {}, 0.01)), { now: NOW });
    assert.equal(r.accepted, true, r.reasons.join(' '));
    assert.equal(r.model.mode, 'ln');
    assert.ok(Math.abs(r.model.mult.str - 1) < 0.01);
});

test('S4 3% noise + 5 bad sessions (+25%): accepted, the median ignores them', () => {
    const r = learnGym(simSessions(friend, T('log10', { dex: 1.02 }, 0.03), { outliers: 5 }), { now: NOW });
    assert.equal(r.accepted, true, r.reasons.join(' '));
    assert.ok(Math.abs(r.model.mult.dex - 1.02) < 0.01, String(r.model.mult.dex));
    assert.ok(Math.abs(r.model.mult.def - 1) < 0.02, String(r.model.mult.def));
});

test('gym: fewer than 10 learning sessions are never accepted', () => {
    const r = learnGym(simSessions(ownerSpd, T('log10', { spd: 1.1 }, 0.01), { n: 12 }), { now: NOW });
    assert.equal(r.accepted, false);
    assert.match(describeGym(r)[0], /Still learning/);
});

test('gym: samples as recorded today (predicted only) learn the multiplier, keep the mode', () => {
    const rows = simSessions(ownerSpd, T('log10', { spd: 1.04 }, 0.01)).map((r) => ({
        at: r.at,
        stat: r.stat,
        trains: r.trains,
        actual: r.actual,
        predicted: simSession(() => 0.5, r, T('log10', {}, 0)),
    }));
    const r = learnGym(rows, { now: NOW });
    assert.equal(r.accepted, true);
    assert.equal(r.candidates.length, 1);
    assert.ok(Math.abs(r.model.mult.spd - 1.04) < 0.005);
});

test('gym: order comes from `at`, not from the array; future samples are ignored', () => {
    const rows = simSessions(ownerSpd, T('log10', { spd: 1.04 }, 0.01));
    const a = learnGym(rows, { now: NOW });
    const b = learnGym([...rows].reverse().concat([{ ...rows[0], at: NOW + HOUR, actual: rows[0].actual * 3 }]), { now: NOW });
    assert.deepEqual(b.model, a.model);
    assert.deepEqual(b.heldOut, a.heldOut);
});

// ---------------------------------------------------------------- Torn Eye

/*
 * Fights from the fight Monte Carlo: Torn Eye predicts with the usual
 * gear; the truth fights once with `dmgBonus` more damage. Opponents run
 * from 60% to 130% of my stats (forecasts of about 20–97%).
 * 10% more damage moves the win chance only ~4 points, so it takes about
 * 2,000 fights to see it clearly (at 300, 1 seed in 6 finds it).
 */
const ME = { str: 3e6, spd: 3e6, def: 3e6, dex: 3e6, life: 5000 };
const GEAR = { dmg: 50, acc: 50, armour: 25, dmgBonus: 0 };

function simFights(n, { dmgBonus = 0, seed = 11 } = {}) {
    const rnd = mulberry32(seed);
    const out = [];
    for (let i = 0; i < n; i++) {
        const k = 0.6 + 0.7 * rnd();
        const them = { str: ME.str * k, spd: ME.spd * k, def: ME.def * k, dex: ME.dex * k, life: 5000 };
        const p = simulateFights(ME, them, { n: 200, seed: 1000 + i });
        const real = fightOnce(ME, them, rnd, { ...GEAR, dmgBonus });
        out.push({ at: T0 + i * HOUR, predictedWin: p.pWin, won: real.win, predictedHpKept: p.keptMedian, hpKept: real.win ? real.kept : null });
    }
    return out;
}

for (const n of [300, 2000]) {
    test(`F1 fights already calibrated (${n} fights): no change`, () => {
        const r = learnFights(simFights(n));
        assert.equal(r.accepted, false, r.reasons.join(' '));
        assert.deepEqual(r.model, { winScale: 1, hpScale: 1 });
        assert.equal(r.bins.length, 10);
        assert.match(describeFights(r)[0], /already matches/);
    });
}

test('F2 real damage 10% higher (2,000 fights): accepted, more wins and more HP kept than predicted', () => {
    const r = learnFights(simFights(2000, { dmgBonus: 10 }));
    assert.equal(r.accepted, true, r.reasons.join(' '));
    assert.equal(r.winAccepted, true);
    assert.ok(r.model.winScale > 1);
    if (r.hpAccepted) assert.ok(r.model.hpScale > 1);
    assert.ok(r.learned.hpScale > 1, String(r.learned.hpScale));
    const high = r.bins.filter((b) => b.from >= 0.6 && b.from < 0.9 && b.fights >= 5);
    assert.ok(high.length && high.every((b) => b.won >= b.predicted - 0.05), JSON.stringify(high));
    const fixed = applyFightModel(r, { pWin: 0.7, keep: 0.5 });
    assert.ok(fixed.pWin >= 0.7 && fixed.keep >= 0.5);
    assert.ok(describeFights(r).every((l) => /^Your fights: .*fixed\.$/.test(l)), describeFights(r).join(' | '));
});

test('F3 fewer than 10 learning fights: never accepted', () => {
    const r = learnFights(simFights(LEARN_MIN + 3, { dmgBonus: 30 }));
    assert.equal(r.accepted, false);
    assert.deepEqual(r.model, { winScale: 1, hpScale: 1 });
    assert.match(describeFights(r)[0], /Still learning/);
});
