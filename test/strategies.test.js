/*
 * The strategy simulator against docs/sims/sim30.mjs (sample prices, STR
 * only, donator, 30 days): within 2%, and in fact exact, since the model is
 * the same. Round 7 (R7.4, the 1,000 energy cap): the two jumps no longer match
 * sim30, which stacks 1,150 and 1,120; their numbers here are the capped ones.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { simulateStrategy, STRATEGY_IDS, STRATEGIES, feasibleStrategies } from '../src/core/strategies.js';
import { SAMPLE_PRICES, XANAX, EDVD, ECSTASY, POINTS } from '../src/core/items.js';

const within = (a, b, pct, msg) => assert.ok(Math.abs(a - b) <= (Math.abs(b) * pct) / 100, `${msg || ''} ${a} vs ${b} (±${pct}%)`);

function run(id, S0, dots, happyMax, extra = {}) {
    return simulateStrategy(id, { stats: { str: S0, spd: 0, def: 0, dex: 0 }, target: 'str', gyms: { str: { dots, energy: 10 } }, happyMax, prices: SAMPLE_PRICES, candyCount: 48, ...extra });
}

test('friend at 118k, 1,500 happy: steady +603k/$126M, daily +596k/$160M, choco +418k/$151M, EDVD +902k/$524M', () => {
    // The jumps before the 1,000 cap (round 7): choco +410k, EDVD +936k; with the cap: +396k, +868k; with the refill
    // used before the stack on a day with no jump (30 refills in the 30 days, it was 22): +418k, +902k.
    const want = { steady: [603092, 126.0], dailyChoco: [595527, 159.6], chocoJump: [418234, 151.0], edvdJump: [902338, 524.2] };
    for (const [id, [g, c]] of Object.entries(want)) {
        const r = run(id, 118400, 6.5, 1500);
        within(r.gained, g, 2, id);
        within(r.cost / 1e6, c, 2, id + ' cost');
    }
});

test('friend with the Private Island (5,025): steady +994k, daily +864k, choco +603k, EDVD +1,096k', () => {
    // The jumps before the 1,000 cap (round 7): choco +592k, EDVD +1,125k; with the cap: +571k, +1,050k; with the
    // refill before the stack on a day with no jump: +603k, +1,096k.
    const want = { steady: 994142, dailyChoco: 863700, chocoJump: 603101, edvdJump: 1095514 };
    for (const [id, g] of Object.entries(want)) within(run(id, 118400, 6.5, 5025).gained, g, 2, id);
});

test('owner at 250M (George\'s, 5,025): steady +119M, EDVD jumps only +76M', () => {
    within(run('steady', 250e6, 7.3, 5025).gained, 119410643, 2);
    within(run('edvdJump', 250e6, 7.3, 5025).gained, 75973209, 2);
});

test('the friend should NOT choco jump: steady beats it by about 40%', () => {
    const s = run('steady', 118400, 6.5, 5025);
    const c = run('chocoJump', 118400, 6.5, 5025);
    assert.ok(c.gained < s.gained * 0.65);
    assert.ok(c.cost > s.cost);
});

test('what a steady month uses: a Xanax per 7 h cooldown and a refill a day', () => {
    const r = run('steady', 118400, 6.5, 5025);
    assert.equal(r.used[XANAX], Math.ceil((30 * 1440) / 420));
    assert.equal(r.used[POINTS], 30 * 30);
    assert.equal(r.used[EDVD], 0);
    assert.equal(r.daily.length, 30);
    assert.ok(r.daily.every((v, i) => i === 0 || v >= r.daily[i - 1]), 'cumulative');
});

test('jumps use Ecstasy and boosters; the 99k jump fills a 48 h cap with 9 EDVD', () => {
    const e = run('edvdJump', 118400, 6.5, 5025);
    assert.ok(e.used[ECSTASY] > 0 && e.used[EDVD] === 5 * e.used[ECSTASY]);
    const h = run('happy99k', 118400, 6.5, 5025, { boosterCapH: 48 });
    assert.equal(h.used[EDVD], 9 * h.used[ECSTASY]);
});

test('Ignorance Is Bliss: steady + EDVD whenever the booster allows beats plain steady by far', () => {
    const plain = run('steady', 118400, 6.5, 5025);
    const bliss = run('blissSteady', 118400, 6.5, 5025, { bliss: true });
    assert.ok(bliss.gained > plain.gained * 3);
    assert.ok(bliss.used[EDVD] >= 4 * 30);
});

test('a build target spreads trains across stats by deficit', () => {
    const r = simulateStrategy('steady', {
        stats: { str: 118400, spd: 110900, def: 96200, dex: 82700 },
        target: { str: 0.25, spd: 0.25, def: 0.25, dex: 0.25 },
        gyms: { str: { dots: 6.5, energy: 10 }, spd: { dots: 6.4, energy: 10 }, def: { dots: 6.2, energy: 10 }, dex: { dots: 6.2, energy: 10 } },
        happyMax: 5025,
        prices: SAMPLE_PRICES,
        days: 10,
    });
    assert.ok(r.perStat.dex > r.perStat.def && r.perStat.def > r.perStat.spd && r.perStat.spd >= r.perStat.str);
    // Each stat and the total are rounded on their own.
    assert.ok(Math.abs(Object.values(r.perStat).reduce((a, b) => a + b, 0) - r.gained) <= 2);
});

test('a non-donator bar (15 min) trains less', () => {
    within(run('steady', 118400, 6.5, 5025, { fastEnergy: false }).gained / run('steady', 118400, 6.5, 5025).gained, 0.85, 8);
});

test('strategy list and feasibility', () => {
    assert.equal(STRATEGY_IDS.length, 13);
    for (const id of STRATEGY_IDS) assert.ok(STRATEGIES[id].name);
    assert.equal(feasibleStrategies({ bliss: false }).includes('blissSteady'), false);
    assert.equal(feasibleStrategies({ bliss: true }).includes('blissSteady'), true);
    assert.equal(feasibleStrategies({}).includes('happy99k'), false, '24 h cap: same as the EDVD jump');
    assert.equal(feasibleStrategies({ boosterCapH: 48 }).includes('happy99k'), true);
});
