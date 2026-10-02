import test from 'node:test';
import assert from 'node:assert/strict';

import { recommend, pickWarning, recheckTriggers, dailyCheckDue, whyNot, WARN_STATS_PCT } from '../src/core/recommend.js';
import { simulateStrategy } from '../src/core/strategies.js';
import { SAMPLE_PRICES } from '../src/core/items.js';

function runAll(S0, happyMax, extra = {}) {
    const out = {};
    for (const id of ['steady', 'dailyChoco', 'chocoJump', 'edvdJump', ...(extra.bliss ? ['blissSteady'] : [])]) {
        out[id] = simulateStrategy(id, { stats: { str: S0, spd: 0, def: 0, dex: 0 }, target: 'str', gyms: { str: { dots: 6.5, energy: 10 } }, happyMax, prices: SAMPLE_PRICES, candyCount: 48, ...extra });
    }
    return out;
}

const FRIEND = runAll(118400, 5025);

test('the friend on $150M: steady training is recommended (EDVD gains more but is over budget)', () => {
    const r = recommend(FRIEND, { budget: 150e6 });
    assert.equal(r.recommended, 'steady');
    const edvd = r.alternatives.find((a) => a.id === 'edvdJump');
    assert.equal(edvd.verdict, 'overBudget');
    // 14% before round 7; 6% once energy stops at 1,000 (a jump trains 1,000 at jump happy, not 1,150 and 1,120); 11%
    // with the refill used before the stack on a day with no jump (30 refills in the 30 days, it was 22).
    assert.ok(Math.round(edvd.deltaStatsPct) === 11);
    assert.ok(Math.abs(edvd.deltaCost - 398.25e6) < 1e6);
    assert.ok(r.reasons.some((x) => /budget/.test(x)));
});

test('with no budget limit, the most stats wins', () => {
    assert.equal(recommend(FRIEND).recommended, 'edvdJump');
});

test('alternatives carry the Plan table\'s deltas: daily −13%, choco −39%', () => {
    const r = recommend(FRIEND, { budget: 150e6 });
    const d = Object.fromEntries(r.alternatives.map((a) => [a.id, Math.round(a.deltaStatsPct)]));
    assert.equal(d.dailyChoco, -13);
    assert.equal(d.chocoJump, -39);
    assert.equal(r.alternatives.find((a) => a.id === 'chocoJump').verdict, 'worse');
});

test('picking the choco jump warns, with its reasons', () => {
    const w = pickWarning(FRIEND.steady, FRIEND.chocoJump);
    assert.equal(w.warn, true);
    assert.equal(w.title, "A choco jump isn't worth it for you");
    assert.equal(w.text, '30 days: about +603k stats, against +989k on steady, and $25M more.');
    assert.ok(w.reasons.includes('Holding four Xanax stops natural energy.'));
    assert.ok(w.reasons.includes('The Ecstasy uses a drug cooldown a Xanax would have filled.'));
    assert.ok(w.reasons.includes('Worth it only if you read Ignorance Is Bliss.'));
});

test('no warning for the recommended plan itself or a plan that is not worse', () => {
    assert.equal(pickWarning(FRIEND.steady, FRIEND.steady).warn, false);
    const better = { id: 'edvdJump', gained: FRIEND.steady.gained * 1.2, cost: FRIEND.steady.cost + 1e6 };
    assert.equal(pickWarning(FRIEND.steady, better).warn, false);
});

test('the warning rule: >5% fewer stats, or costlier without being 5% better', () => {
    const rec = { id: 'steady', gained: 1000, cost: 100 };
    assert.equal(pickWarning(rec, { id: 'dailyChoco', gained: 940, cost: 100 }).warn, true);
    assert.equal(pickWarning(rec, { id: 'dailyChoco', gained: 960, cost: 100 }).warn, false);
    assert.equal(pickWarning(rec, { id: 'dailyChoco', gained: 1040, cost: 101 }).warn, true);
    assert.equal(pickWarning(rec, { id: 'dailyChoco', gained: 1060, cost: 101 }).warn, false);
    assert.equal(WARN_STATS_PCT, 5);
});

test('with Ignorance Is Bliss, the Bliss plan is recommended when it wins', () => {
    const all = runAll(118400, 5025, { bliss: true });
    // Bliss runs the boosters every day; allow the money for it.
    const r = recommend(all, { budget: 700e6 });
    assert.equal(r.recommended, 'blissSteady');
    assert.ok(r.reasons.some((x) => /Bliss/.test(x)));
    // and the Bliss line never tells a Bliss reader to "read Bliss"
    assert.equal(pickWarning(all.blissSteady, all.chocoJump, { bliss: true }).reasons.some((x) => /Bliss/.test(x)), false);
});

test('nothing in budget: the cheapest plan is recommended', () => {
    assert.equal(recommend(FRIEND, { budget: 1 }).recommended, 'steady');
    assert.equal(recommend({}).recommended, null);
});

test('ties go to more stats per $1M', () => {
    const r = recommend({ a: { id: 'a', gained: 100, cost: 50e6 }, b: { id: 'b', gained: 100, cost: 10e6 } });
    assert.equal(r.recommended, 'b');
});

test('re-check triggers: book, gym, stats ×2, price move, budget', () => {
    const last = { bliss: false, statBooks: 0, unlockedTop: 18, total: 400e3, budget: 150e6 };
    assert.deepEqual(recheckTriggers(last, { ...last }), []);
    const kinds = recheckTriggers(last, { bliss: true, statBooks: 1, unlockedTop: 19, total: 800e3, budget: 200e6, prices: { 206: { now: 1e6, avg7: 830e3 }, 197: { now: 55e3, avg7: 55e3 } } }).map((x) => x.kind);
    assert.deepEqual(kinds, ['book', 'book', 'gym', 'stats', 'budget', 'price']);
    assert.equal(recheckTriggers(null, last)[0].kind, 'first');
});

test('the daily re-check is due once per Torn day from 06:00', () => {
    const d = Date.UTC(2026, 8, 29);
    assert.equal(dailyCheckDue(d - 3600e3, d + 5 * 3600e3), false, 'before 06:00, yesterday\'s check still counts');
    assert.equal(dailyCheckDue(d - 3600e3, d + 6 * 3600e3), true);
    assert.equal(dailyCheckDue(d + 6.5 * 3600e3, d + 9 * 3600e3), false);
    assert.equal(dailyCheckDue(d - 30 * 3600e3, d + 3600e3), true, 'missed yesterday\'s');
});

test('each other plan says why it is not the pick', () => {
    const best = { id: 'steady', gained: 39.7e6, cost: 0 };
    const choco = { id: 'dailyChoco', gained: 27.2e6, cost: 47e6, deltaStatsPct: -31.5, deltaCost: 47e6, overBudget: false, verdict: 'worse' };
    const why = whyNot(best, choco, { bliss: false, budget: 150e6 });
    assert.match(why, /^−31% stats and \$47M more/);
    assert.match(why, /candy lifts happy for one session a day/);
    assert.match(why, /without Ignorance Is Bliss/);
    assert.doesNotMatch(whyNot(best, choco, { bliss: true, budget: 150e6 }), /Ignorance/);
    assert.match(whyNot(best, { ...choco, gained: 50e6, deltaStatsPct: 26, overBudget: true }, { budget: 150e6 }), /^Over your \$150/);
    const r = recommend({ steady: best, dailyChoco: { id: 'dailyChoco', gained: 27.2e6, cost: 47e6 } }, { budget: 150e6 });
    assert.ok(r.alternatives[0].why.length > 10);
});
