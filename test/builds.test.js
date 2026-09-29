import test from 'node:test';
import assert from 'node:assert/strict';

import { BUILDS, BUILD_ORDER, DEFAULT_BUILD, splitSession, projectBuild, allowedTrains, buildGaps, onBuild, withHighStat } from '../src/core/builds.js';
import { unlockedGyms, gymById, GYM_3000, BALBOAS, ELITES, ISOYAMAS, GEORGES } from '../src/core/gyms.js';

const FRIEND = { str: 118400, spd: 110900, def: 96200, dex: 82700 };
const BAL = BUILDS.balanced.shares;

test('the presets add to 100%; specialist first, Balanced last and not the default', () => {
    assert.equal(BUILD_ORDER.length, 5);
    assert.equal(DEFAULT_BUILD, 'baldr');
    assert.equal(BUILD_ORDER[BUILD_ORDER.length - 1], 'balanced');
    for (const id of Object.keys(BUILDS)) {
        const s = BUILDS[id].shares;
        assert.ok(Math.abs(s.str + s.spd + s.def + s.dex - 1) < 0.002, id);
    }
    assert.deepEqual(BUILDS.hank.gyms, [GYM_3000, BALBOAS]);
});

test('a preset\'s high stat can move and keeps its shape: Baldr\'s on DEX is DEX + DEF, Elites + Balboas', () => {
    const b = withHighStat('baldr', 'dex');
    assert.equal(b.shares.dex, BUILDS.baldr.shares.str);
    assert.equal(b.shares.def, BUILDS.baldr.shares.spd, 'its partner follows');
    assert.equal(b.shares.str, BUILDS.baldr.shares.dex);
    assert.ok(b.gyms.includes(ELITES));
    assert.ok(b.gyms.includes(BALBOAS));
    assert.deepEqual(withHighStat('hank', 'def').shares, BUILDS.hankDef.shares, "Hank's on DEF is Hank's defensive");
    assert.deepEqual(withHighStat('hank', 'def').gyms, BUILDS.hankDef.gyms);
    const spd = withHighStat('baldr', 'spd');
    assert.equal(spd.shares.spd, 0.309);
    assert.equal(spd.shares.str, 0.247);
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

test('parts: the trains in gym parts, the gym you\'re in first; their trains and energy add up to the split', () => {
    const f = { str: 100e3, spd: 120e3, def: 99e3, dex: 125e3 };
    const unl = unlockedGyms(9);
    for (const active of [8, 9]) {
        const r = splitSession({ stats: f, shares: BAL, energy: 400, happy: 2500, happyMax: 2500, unlocked: unl, active });
        assert.equal(r.parts[0].gymId, active, 'the gym you are in comes first');
        assert.deepEqual(r.parts.map((p) => p.stat).sort(), ['def', 'str']);
        for (const k of ['def', 'str']) assert.equal(r.parts.filter((p) => p.stat === k).reduce((a, p) => a + p.trains, 0), r.perStat[k].trains);
        assert.equal(r.parts.reduce((a, p) => a + p.energy, 0), r.energyUsed);
        assert.ok(Math.abs(r.parts.reduce((a, p) => a + p.gain, 0) - r.gain) <= r.parts.length, 'each part rounded');
        assert.deepEqual(r.order, r.parts.map((p) => p.stat));
    }
    // DEF ties at Global Gym (5 E) and Knuckle Heads (10 E): in Knuckle Heads it stays there (one gym, no switch).
    const kh = splitSession({ stats: f, shares: BAL, energy: 400, happy: 2500, happyMax: 2500, unlocked: unl, active: 9 });
    assert.equal(kh.parts.length, 2);
    assert.ok(kh.parts.every((p) => p.gymId === 9));
});

test('the new split never trains a stat over its share while another is under (the owner: no DEF), and trains the faster one first', () => {
    const owner = { str: 35.4e6, spd: 4.06e6, def: 82.4e6, dex: 20.5e6 };
    const shares = BUILDS.hank.shares;
    const r = projectBuild({ stats: owner, shares, energyPerDay: 1620, happy: 5325, unlocked: unlockedGyms(24), active: 24, days: 10 });
    assert.ok(r.days.every((d) => d.def === 0));
    // STR (35M, 10 pts under) before DEX (20M, 13 pts under): gain per energy × gap, not the gap alone.
    assert.ok(r.days[0].str > r.days[0].dex);
    const old = projectBuild({ stats: owner, shares, energyPerDay: 1620, happy: 5325, unlocked: unlockedGyms(24), active: 24, days: 10, rule: 'deficit' });
    assert.ok(old.days[0].dex > old.days[0].str, 'the old rule: the stat furthest behind');
    assert.ok(r.days.reduce((a, d) => a + d.gain, 0) > old.days.reduce((a, d) => a + d.gain, 0));
});

test('pickStat: when no stat under its share can train here, the old rule\'s pick (energy is still spent)', async () => {
    const { pickStat } = await import('../src/core/builds.js');
    const s = { str: 100, spd: 100, def: 100, dex: 50 };
    // Only STR and SPD can train (a gym without DEX): both over their share, the less-over one is picked.
    const c = pickStat([{ k: 'str', dots: 3, energy: 5 }, { k: 'spd', dots: 3, energy: 5 }], { ...s, str: 110 }, BAL, 1000);
    assert.equal(c.k, 'spd');
    assert.equal(pickStat([], s, BAL, 1000), null);
});

test('projection: catch-up day per stat', () => {
    const r = projectBuild({ stats: FRIEND, shares: BAL, energyPerDay: 1620, happy: 5325, unlocked: unlockedGyms(18), active: 18, days: 10 });
    assert.equal(r.catchUp.str, 0, 'over its share already');
    assert.ok(r.catchUp.dex >= 3 && r.catchUp.dex <= r.reachedDay);
});

test('gaps and on-build', () => {
    const g = buildGaps(FRIEND, BAL);
    assert.ok(Math.abs(g.dex.share - 0.2026) < 0.001);
    assert.equal(g.str.over, true);
    assert.ok(Math.abs(g.dex.gap - (0.25 * 408200 - 82700)) < 1e-6);
    assert.equal(onBuild(FRIEND, BAL), false);
    assert.equal(onBuild({ str: 100, spd: 100, def: 100, dex: 101 }, BAL), true);
});

test('high stats: only builds with a clear leader take one; names say it', async () => {
    const { highStatOf, resolveBuild } = await import('../src/core/builds.js');
    assert.equal(highStatOf('baldr'), 'str');
    assert.equal(highStatOf('hank:dex'), 'dex');
    assert.equal(highStatOf('tank'), null);
    assert.equal(highStatOf('offense'), null);
    assert.equal(highStatOf('balanced'), null);
    assert.equal(highStatOf('baldrDef'), 'def');
    assert.equal(resolveBuild('hank:def').name, "Hank's, DEF high");
    assert.deepEqual(resolveBuild('hankDef').shares, BUILDS.hankDef.shares);
    assert.equal(resolveBuild('tank').name, 'Tank');
    assert.equal(resolveBuild('nope').base, 'baldr');
});
