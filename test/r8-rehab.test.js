/*
 * Round 8, the rehab rule (docs/REHAB-PLAN.md §3, the owner's yes on 2026-10-03): a plan's cost has a rehab part and
 * an overdose part, priced on the plan's own days from what the app reads (the faction's cuts, lifetime rehabs).
 * The day's steps do not change, and a plan without drugs does not move.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { REHAB_PRICE, ADDICTION, OVERDOSE_CHANCE, sessionPoints, rehabParams, rehabOf, rehabWords } from '../src/core/rehab.js';
import { simulateStrategy } from '../src/core/strategies.js';
import { fetchDrugStats } from '../src/api/torn.js';
import { XANAX, ECSTASY } from '../src/core/items.js';
import { fmtMoney } from '../src/core/format.js';

const OWNER_PERKS = { faction: ['+ Reduces addiction gain by 50%', '+ Decreases risk of overdose by 30%', '+ Reduces rehabilitation costs by 14%', '+ Increases strength gym gains by 2%'], job: [], property: [] };

test('a session removes 87 points for a new player and fewer with every rehab done', () => {
    assert.equal(Math.round(sessionPoints(0) * 10) / 10, 87.5);
    assert.ok(sessionPoints(330) > 33 && sessionPoints(330) < 38, 'the owner: about 35 points a session (his three visits fit 33 to 38)');
    assert.ok(sessionPoints(2000) < 9, 'a veteran: about 8');
});

test('the player’s own numbers come from what the app reads: the faction’s three cuts and lifetime rehabs', () => {
    const p = rehabParams({ perks: OWNER_PERKS, drugs: { rehabs: 330 } });
    assert.equal(p.keep, 0.5);
    assert.equal(p.price, 215000, 'he pays $215,000 a session, every time');
    assert.ok(Math.abs(p.xanaxChance - OVERDOSE_CHANCE.xanax * 0.7) < 1e-12);
    assert.equal(p.rough, false);
    assert.ok(p.perPoint > 5600 && p.perPoint < 6500, 'about $6,100 a point: ' + Math.round(p.perPoint));
    // Nothing read yet: no cut, a new player's session (the least a point can cost), and the page says so.
    const d = rehabParams();
    assert.deepEqual([d.keep, d.price, d.rough, Math.round(d.perPoint)], [1, REHAB_PRICE, true, 2857]);
    // A perk line about something else is not a cut.
    assert.equal(rehabParams({ perks: { faction: ['+ Increases maximum happy by 20%'] } }).keep, 1);
});

test('his numbers (the plan’s check): 3 Xanax a day at 50% kept is 32.5 points a day, about $185k to $212k of rehab a day; 1 Xanax a day costs nothing', () => {
    const days = 30;
    const three = { xanDaily: Array(days).fill(3), ecsDaily: Array(days).fill(0), gainDaily: Array(days).fill(100000) };
    for (const [rehabs, lo, hi] of [[290, 180e3, 190e3], [370, 208e3, 216e3]]) {
        const r = rehabOf(three, rehabParams({ perks: { faction: ['+ Reduces addiction gain by 50%', '+ Reduces rehabilitation costs by 14%'] }, drugs: { rehabs } }));
        assert.ok(r.rehab / days > lo && r.rehab / days < hi, rehabs + ' rehabs: $' + Math.round(r.rehab / days) + ' a day');
    }
    const one = rehabOf({ xanDaily: Array(days).fill(1), ecsDaily: Array(days).fill(0), gainDaily: Array(days).fill(100000) }, rehabParams({ perks: OWNER_PERKS, drugs: { rehabs: 330 } }));
    assert.equal(one.rehab, 0, '17.5 points a day fade by themselves (20 a night)');
    assert.ok(one.overdose > 0, 'the overdose’s own addiction is still expected');
});

test('bursts count: four Xanax in one day cost rehab though the month’s average would fade by itself', () => {
    const p = rehabParams({ drugs: { rehabs: 0 } });
    const burst = rehabOf({ xanDaily: [4, 0, 0, 0, 0, 0, 0], ecsDaily: [0, 0, 0, 0, 0, 0, 0], gainDaily: [0, 0, 0, 0, 0, 0, 7000] }, p);
    assert.ok(Math.abs(burst.rehab - (4 * ADDICTION.xanax - ADDICTION.decay) * p.perPoint) < 1e-6);
    assert.deepEqual(burst.costDaily.slice(1), [0, 0, 0, 0, 0, 0], 'paid on the day the drugs are taken');
    // An overdose: a Xanax's stops a day of the plan; an Ecstasy's loses the jump's gain over a plain day.
    assert.ok(Math.abs(burst.lost - 4 * p.xanaxChance * 1000) < 1e-9);
    const jump = rehabOf({ xanDaily: [0, 0, 0], ecsDaily: [0, 0, 1], gainDaily: [100, 100, 5100] }, p);
    assert.ok(Math.abs(jump.lost - p.ecstasyChance * 5000) < 1e-9);
    assert.equal(rehabOf({ xanDaily: [0, 0], ecsDaily: [0, 0], gainDaily: [10, 10] }, p).rehab, 0);
});

const BASE = { stats: { str: 1e6, spd: 1e6, def: 1e6, dex: 1e6 }, target: 'str', gyms: { str: { dots: 7.3, energy: 10 } }, happyMax: 5000, days: 30, prices: { [XANAX]: 830000, [ECSTASY]: 70000, 367: 2500000, 366: 2000000, 0: 30000 } };

test('the engine rule: with rehab a plan that takes Xanax is dearer by its rehab and overdose parts, on the days the drugs are taken; its gain and its line do not move', () => {
    const without = simulateStrategy('steady', BASE);
    const p = rehabParams({ drugs: { rehabs: 0 } });
    const withIt = simulateStrategy('steady', { ...BASE, rehab: p });
    assert.equal(withIt.gained, without.gained, 'following the plan still reads 100%');
    assert.deepEqual(withIt.daily, without.daily);
    assert.ok(withIt.costParts.rehab > 0 && withIt.costParts.overdose > 0);
    assert.ok(Math.abs(withIt.cost - without.cost - withIt.costParts.rehab - withIt.costParts.overdose) <= withIt.costDaily.length, 'cost = items + rehab + overdoses');
    assert.equal(withIt.costDaily.reduce((a, v) => a + v, 0), withIt.cost, 'the days add up to the cost (the cash check runs on them)');
    assert.equal(withIt.costParts.rough, false);
    assert.ok(withIt.overdoseLost > 0 && withIt.overdoseLost < withIt.gained * 0.15, 'the training overdoses are expected to stop is said: ' + withIt.overdoseLost);
    // About 3 Xanax a day for a new player: (105 − 20) points a day at $2,857 a point.
    const perDay = withIt.costParts.rehab / 30;
    assert.ok(perDay > 200e3 && perDay < 320e3, '$' + Math.round(perDay) + ' of rehab a day');
    assert.equal(without.costParts, undefined, 'without the player’s numbers the simulator is as it was');
});

test('fewer Xanax a day, less rehab: one a day at the owner’s cut costs none', () => {
    const p = rehabParams({ perks: OWNER_PERKS, drugs: { rehabs: 330 } });
    const one = simulateStrategy('steadyLite', { ...BASE, xanaxPerDay: 1, rehab: p });
    const three = simulateStrategy('steady', { ...BASE, rehab: p });
    assert.equal(one.costParts.rehab, 0);
    assert.ok(three.costParts.rehab > 0);
    assert.ok(three.costParts.overdose > one.costParts.overdose);
});

test('the words on Plan: a day’s rehab and overdoses, "at least" while lifetime rehabs are not read; nothing for a plan without drugs', () => {
    assert.equal(rehabWords({ rehab: 30 * 185000, overdose: 30 * 20000, rough: false }, 30, fmtMoney), 'Rehab about $185,000 a day · overdoses about $20,000 a day');
    assert.equal(rehabWords({ rehab: 30 * 185000, overdose: 0, rough: true }, 30, fmtMoney), 'Rehab at least $185,000 a day · overdoses at least $0 a day');
    assert.equal(rehabWords({ rehab: 0, overdose: 0 }, 30, fmtMoney), null);
    assert.equal(rehabWords(undefined, 30, fmtMoney), null);
});

test('the read: lifetime rehabs from personalstats (cat drugs), with the main key; an answer without a drugs part is null', async () => {
    const calls = [];
    const client = { get: async (path, q) => (calls.push([path, q]), { personalstats: { drugs: { cannabis: 0, ecstasy: 12, xanax: 2400, overdoses: 60, rehabilitations: { amount: 330, fees: 70950000 }, total: 2412 } } }) };
    assert.deepEqual(await fetchDrugStats(client), { rehabs: 330, rehabFees: 70950000, xanax: 2400, ecstasy: 12, overdoses: 60 });
    assert.deepEqual(calls, [['v2/user/personalstats', { cat: 'drugs' }]]);
    assert.equal(await fetchDrugStats({ get: async () => ({ personalstats: {} }) }), null);
});
