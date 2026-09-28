import test from 'node:test';
import assert from 'node:assert/strict';

import { BUILDS, BUILD_ORDER, DEFAULT_BUILD, splitSession, projectBuild, allowedTrains, buildGaps, onBuild, withHighStat } from '../src/core/builds.js';
import { unlockedGyms, gymById, GYM_3000, BALBOAS, ELITES, ISOYAMAS, GEORGES } from '../src/core/gyms.js';

const FRIEND = { str: 118400, spd: 110900, def: 96200, dex: 82700 };
const BAL = BUILDS.balanced.shares;

test('seven presets, shares adding to 100%, Balanced by default', () => {
    assert.equal(BUILD_ORDER.length, 7);
    assert.equal(DEFAULT_BUILD, 'balanced');
    for (const id of BUILD_ORDER) {
        const s = BUILDS[id].shares;
        assert.ok(Math.abs(s.str + s.spd + s.def + s.dex - 1) < 0.002, id);
    }
    assert.deepEqual(BUILDS.hank.gyms, [GYM_3000, BALBOAS]);
});

test('a preset\'s high stat can move: Baldr\'s on DEX uses Elites', () => {
    const b = withHighStat('baldr', 'dex');
    assert.equal(b.shares.dex, BUILDS.baldr.shares.str);
    assert.equal(b.shares.str, BUILDS.baldr.shares.dex);
    assert.ok(b.gyms.includes(ELITES));
    assert.equal(withHighStat('baldr', 'str'), BUILDS.baldr);
    assert.equal(withHighStat('nope', 'str'), null);
});

test('friend, Balanced: day 1 all DEX (162 trains, about +8,723)', () => {
    const r = projectBuild({ stats: FRIEND, shares: BAL, energyPerDay: 1620, happy: 5325, unlocked: unlockedGyms(18), active: 18, days: 1 });
    assert.deepEqual(r.days[0], { str: 0, spd: 0, def: 0, dex: 162, gain: r.days[0].gain });
    assert.ok(Math.abs(r.days[0].gain - 8723) < 5);
});

test('friend, Balanced: DEF joins on day 2, SPD by day 5, STR last, balanced in about 6–7 days', () => {
    const r = projectBuild({ stats: FRIEND, shares: BAL, energyPerDay: 1620, happy: 5325, unlocked: unlockedGyms(18), active: 18, days: 8 });
    assert.ok(r.days[1].def > 0 && r.days[1].dex > r.days[1].def);
    assert.equal(r.days[0].spd + r.days[1].spd + r.days[2].spd + r.days[3].spd, 0);
    assert.ok(r.days[4].spd > 0);
    assert.ok(r.days.slice(0, 6).every((d) => d.str === 0));
    assert.ok(r.reachedDay >= 6 && r.reachedDay <= 7, 'reached ' + r.reachedDay);
});

test('a 270 E session after Xanax #2: DEX × 27 at Gun Shop', () => {
    const r = splitSession({ stats: FRIEND, shares: BAL, energy: 275, happy: 5325, unlocked: unlockedGyms(18), active: 18 });
    assert.equal(r.perStat.dex.trains, 27);
    assert.equal(r.perStat.dex.gym.name, 'Gun Shop');
    assert.equal(r.energyLeft, 5);
    assert.deepEqual(r.order, ['dex']);
});

test('the split never spends energy it does not have, nor a train it cannot afford', () => {
    const r = splitSession({ stats: FRIEND, shares: BAL, energy: 7, happy: 5000, unlocked: unlockedGyms(18) });
    assert.equal(r.energyUsed, 0);
    assert.equal(r.gain, 0);
});

test('Hank\'s cap: STR at Gym 3000 stops at 18 trains, or Balboas is lost', () => {
    const owner = { str: 360e6, spd: 98.4e6, def: 288e6, dex: 288e6 };
    const r = allowedTrains({ stat: 'str', stats: owner, gym: gymById(GYM_3000), happy: 5025, keep: [GYM_3000, BALBOAS] });
    assert.equal(r.trains, 18);
    assert.equal(r.breaks.id, BALBOAS);
    assert.ok(Math.abs(r.gain - 2361741) < 1000);
    const unlimited = allowedTrains({ stat: 'str', stats: owner, gym: gymById(GYM_3000), happy: 5025, keep: [], maxTrains: 30 });
    assert.equal(unlimited.trains, 30);
    assert.equal(unlimited.breaks, null);
});

test('the split marks stopAt when the next train would lose a gym the build needs', () => {
    const owner = { str: 360e6, spd: 98.4e6, def: 288e6, dex: 288e6 };
    // Aim STR high so every train wants STR; Balboas must survive.
    const shares = { str: 0.5, spd: 0.05, def: 0.225, dex: 0.225 };
    const unl = [...unlockedGyms(GEORGES), GYM_3000, BALBOAS, ISOYAMAS];
    const r = splitSession({ stats: owner, shares, energy: 2000, happy: 5025, unlocked: unl, keep: [GYM_3000, BALBOAS] });
    assert.equal(r.perStat.str.trains, 18);
    assert.equal(r.perStat.str.stopAt, 18);
    assert.equal(r.perStat.str.stopReason, 'Balboas Gym');
    assert.ok(r.perStat.def.trains + r.perStat.dex.trains > 0, 'the rest of the energy goes elsewhere');
});

test('gaps and on-build', () => {
    const g = buildGaps(FRIEND, BAL);
    assert.ok(Math.abs(g.dex.share - 0.2026) < 0.001);
    assert.equal(g.str.over, true);
    assert.ok(Math.abs(g.dex.gap - (0.25 * 408200 - 82700)) < 1e-6);
    assert.equal(onBuild(FRIEND, BAL), false);
    assert.equal(onBuild({ str: 100, spd: 100, def: 100, dex: 101 }, BAL), true);
});
