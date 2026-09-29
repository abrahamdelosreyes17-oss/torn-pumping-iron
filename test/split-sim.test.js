/*
 * The simulator check for the 1.3.0 split (ROUND4-PLAN §C2): the new rule
 * (builds.js pickStat: gain per energy × gap × happy weight) against the old
 * one (every train to the stat furthest under its share), over 30 and 90
 * days, for the owner and two low-stat friends. The new rule must reach the
 * build at least as fast and end with at least as many stats.
 *
 * Two models: the strategy simulator (steady plan, happy runs down as it
 * really does) and the build projection (every session at the same happy).
 * The one tolerance: at 90 days, 0.1% (see the note on the owner below).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { resolveBuild, projectBuild, onBuild } from '../src/core/builds.js';
import { unlockedGyms, bestGymFor, gymAccess, gymById } from '../src/core/gyms.js';
import { simulateStrategy } from '../src/core/strategies.js';
import { SAMPLE_PRICES } from '../src/core/items.js';
import { STATS, totalOf } from '../src/core/gain.js';

const PLAYERS = [
    // ROUND4-PLAN: the owner's real stats, George's (all 24 ladder gyms), Hank's STR high. Max happy assumed 5,025 (PI).
    { name: 'owner', stats: { str: 35.4e6, spd: 4.06e6, def: 82.4e6, dex: 20.5e6 }, build: 'hank:str', unlocked: unlockedGyms(24), happyMax: 5025 },
    // Low friends (stats 50k–500k, Knuckle Heads, Baldr's STR high, 2,500 max happy): one stat far ahead, the rest behind.
    { name: 'friend A', stats: { str: 480e3, spd: 60e3, def: 250e3, dex: 120e3 }, build: 'baldr:str', unlocked: unlockedGyms(9), happyMax: 2500 },
    { name: 'friend B', stats: { str: 150e3, spd: 90e3, def: 60e3, dex: 400e3 }, build: 'baldr:str', unlocked: unlockedGyms(9), happyMax: 2500 },
];

const ENERGY_PER_DAY = 1620; // the model's donator day: natural + 3 Xanax + refill

function setup(p) {
    const b = resolveBuild(p.build);
    const gyms = {};
    for (const k of STATS) {
        const g = bestGymFor(k, p.stats, p.unlocked, { active: p.unlocked[p.unlocked.length - 1] });
        if (g) gyms[k] = { dots: g.dots[k], energy: g.energy };
    }
    const keep = b.gyms.filter((id) => p.unlocked.includes(id) && gymAccess(gymById(id), p.stats).ok);
    return { shares: b.shares, gyms, keep };
}

function sim(p, rule, days) {
    const { shares, gyms } = setup(p);
    const r = simulateStrategy('steady', { stats: p.stats, target: shares, gyms, happyMax: p.happyMax, prices: SAMPLE_PRICES, days, splitRule: rule });
    const after = {};
    for (const k of STATS) after[k] = p.stats[k] + r.perStat[k];
    return { gained: r.gained, after };
}

/** First day the simulator is on the build (binary search: once there, maintenance keeps it there), or null. */
function simReach(p, rule, maxDays) {
    const { shares } = setup(p);
    const on = (d) => onBuild(sim(p, rule, d).after, shares);
    if (!on(maxDays)) return null;
    let lo = 1;
    let hi = maxDays;
    while (lo < hi) {
        const mid = Math.floor((lo + hi) / 2);
        if (on(mid)) hi = mid;
        else lo = mid + 1;
    }
    return lo;
}

function proj(p, rule, days) {
    const { shares, keep } = setup(p);
    const r = projectBuild({ stats: p.stats, shares, energyPerDay: ENERGY_PER_DAY, happy: p.happyMax + 300, unlocked: p.unlocked, keep, days, rule, active: p.unlocked[p.unlocked.length - 1] });
    return { gained: totalOf(r.statsAfter) - totalOf(p.stats), reach: r.reachedDay };
}

const pct = (a, b) => ((a / b - 1) * 100).toFixed(2) + '%';
const M = (x) => (x / 1e6).toFixed(3) + 'M';

for (const p of PLAYERS) {
    test(`${p.name}: the new split reaches the build as fast and ends with at least as many stats (30 and 90 days)`, (t) => {
        for (const days of [30, 90]) {
            const so = sim(p, 'deficit', days);
            const sn = sim(p, 'speed', days);
            const po = proj(p, 'deficit', days);
            const pn = proj(p, 'speed', days);
            const ro = simReach(p, 'deficit', days);
            const rn = simReach(p, 'speed', days);
            t.diagnostic(`${p.name} ${days} d · simulator old ${M(so.gained)} new ${M(sn.gained)} (${pct(sn.gained, so.gained)}), build day old ${ro} new ${rn} · projection old ${M(po.gained)} new ${M(pn.gained)} (${pct(pn.gained, po.gained)}), build day old ${po.reach} new ${pn.reach}`);
            // At 30 days: never fewer stats. At 90: within 0.1%. Both runs spend the same energy; once both have reached
            // the build, what is left is which stat got the high-happy trains before happy ran down (a fraction of a day).
            const tol = days === 30 ? 0 : 0.001;
            assert.ok(sn.gained >= so.gained * (1 - tol), `simulator ${days} d: ${sn.gained} vs ${so.gained}`);
            assert.ok(pn.gained >= po.gained * (1 - tol), `projection ${days} d: ${pn.gained} vs ${po.gained}`);
            if (ro !== null) assert.ok(rn !== null && rn <= ro, `simulator build day ${rn} vs ${ro}`);
            if (po.reach !== null) assert.ok(pn.reach !== null && pn.reach <= po.reach, `projection build day ${pn.reach} vs ${po.reach}`);
        }
    });
}

test('the owner: a month of the new split is far ahead (STR and DEX first, the faster stats), and on build the same day', () => {
    const p = PLAYERS[0];
    assert.ok(sim(p, 'speed', 30).gained > sim(p, 'deficit', 30).gained * 1.3);
    assert.ok(proj(p, 'speed', 30).gained > proj(p, 'deficit', 30).gained * 1.3);
    assert.equal(proj(p, 'speed', 90).reach, proj(p, 'deficit', 90).reach);
});
