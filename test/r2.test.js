import test from 'node:test';
import assert from 'node:assert/strict';

import { buildModel, compareStrategies, blissWhatIf, playerContext, buildOf, specialLeft, boosterCapOf } from '../src/core/model.js';
import { normalizeState, tornClock, HOUR, DAY, MIN } from '../src/core/bars.js';
import { targetShares, dayTimeline, itemsNeeded } from '../src/core/plan.js';
import { unlockedGyms } from '../src/core/gyms.js';
import { BUILDS } from '../src/core/builds.js';
import { simulateStrategy, feasibleStrategies, STRATEGIES, SPECIAL, CONSOLE_ITEM } from '../src/core/strategies.js';
import { recommend, fitsPlayer, PICK_BY } from '../src/core/recommend.js';
import { energyLadder, boosterChoice, bestCan, statsPerEnergy } from '../src/core/ladder.js';
import { upcomingEvents, eventWindow, slotMinutes, holdBoosterFor, eventHeadsUp } from '../src/core/events.js';
import { XANAX, ECSTASY, EDVD, FHC, MUNSTER, RED_COW, CANDY_KISSES, POINTS } from '../src/core/items.js';

const T0 = Date.UTC(2026, 8, 29, 10, 48);
/** Today's TornW3B prices (ROUND3-PLAN §1). */
const PRICES = { [XANAX]: 845000, [ECSTASY]: 34000, [EDVD]: 4310000, [CANDY_KISSES]: 54000, [FHC]: 13950000, [POINTS]: 45000, [MUNSTER]: 1830000, [RED_COW]: 2410000 };
const SETTINGS = { horizonDays: 30, budget: 150e6 };

function player({ stats, happy = 5025, energy = 20, drug = 0, booster = 0, special = 0, gym = 18, at = T0 }) {
    return normalizeState({
        bars: { energy: { current: energy, maximum: 150, increment: 5, interval: 600, tick_time: 120 }, happy: { current: happy, maximum: happy, increment: 5, interval: 900, tick_time: 300 } },
        cooldowns: { drug, booster },
        refills: { energy: false, special_count: special },
        battlestats: { strength: { value: stats[0] }, speed: { value: stats[1] }, defense: { value: stats[2] }, dexterity: { value: stats[3] } },
        gym: { id: gym },
    }, at);
}

const FRIEND = [118400, 110900, 96200, 82700];
const OWNER = [35.4e6, 4.06e6, 82.4e6, 20.4e6];
const OWNER_GYMS = unlockedGyms(24).concat([25, 26, 27, 28, 29, 30, 31, 32]);

function setup(who, { special = 0, perks = {} } = {}) {
    const owner = who === 'owner';
    const state = player({ stats: owner ? OWNER : FRIEND, happy: owner ? 4000 : 5025, special, gym: owner ? 24 : 18 });
    const pc = playerContext(state, { perks }, { unlockedKnown: owner ? OWNER_GYMS : unlockedGyms(18) });
    const build = owner ? 'hank:def' : 'baldr:str';
    const shares = targetShares({ build }, pc.stats, buildOf(build).shares);
    return { state, pc, shares, build };
}

/* Special refills (§1 item 19) */

test('special refills: read from the state; 0 until set; counted down from when they were set', () => {
    const s = player({ stats: FRIEND, special: 100 });
    assert.equal(s.specialRefills, 100);
    assert.equal(specialLeft({ specialUse: 0 }, s), 0, 'default 0');
    assert.equal(specialLeft({ specialUse: 40, specialStart: 100 }, s), 40);
    assert.equal(specialLeft({ specialUse: 40, specialStart: 100 }, player({ stats: FRIEND, special: 90 })), 30, '10 used since');
    assert.equal(specialLeft({ specialUse: 40, specialStart: 100 }, player({ stats: FRIEND, special: 20 })), 0);
    assert.equal(specialLeft({ specialUse: 500, specialStart: 100 }, s), 100, 'never more than the account has');
});

test('special refills pay in a boosted session; at the maximum each train’s happy loss can outweigh them', () => {
    const { state, pc, shares } = setup('friend', { special: 100 });
    const c = compareStrategies({ state, pc, shares, settings: SETTINGS, prices: PRICES, special: 100 });
    const none = compareStrategies({ state, pc, shares, settings: SETTINGS, prices: PRICES, special: 0 });
    assert.ok(c.chocoJump.gained > none.chocoJump.gained * 1.3, 'choco jump +30% or more with them');
    assert.equal(c.chocoJump.specialHelps, true);
    assert.ok(c.chocoJump.used[SPECIAL] > 0);
    // Free themselves, but the specials held also stand in for the daily points refill: spent in jumps, later days pay points.
    assert.ok(c.chocoJump.cost >= none.chocoJump.cost);
    assert.ok(none.chocoJump.used[POINTS] < 30 * 30, 'held specials replace some points refills');
    assert.ok(c.steady.gained >= none.steady.gained, 'never worse: kept only where they help');
    assert.ok(c.steady.used[SPECIAL] <= 100 && c.steady.used[SPECIAL] >= 0);
});

test('special refills in the day plan: a boosted session takes as many as keep happy above the maximum', () => {
    const state = player({ stats: FRIEND, energy: 1150, drug: 3600, special: 100 });
    const ctx = { shares: BUILDS.balanced.shares, unlocked: unlockedGyms(18), active: 18, specialLeft: 100, specialPerDay: 4 };
    const steps = dayTimeline({ state, now: T0, strategy: 'chocoJump', ctx });
    const sp = steps.find((s) => s.kind === 'special');
    assert.ok(sp && sp.items[0].id === SPECIAL && sp.items[0].qty > 4, 'more than a day’s share in the jump');
    assert.match(sp.label, /^Special refills × \d+, train after each$/);
    assert.equal(itemsNeeded(steps)[SPECIAL], undefined, 'never on the Buy list');
});

/* Energy boosters and the ladder (§1 item 18) */

test('the ladder: free first, then cheapest per stat; FHC and cans on the booster cooldown', () => {
    const { state, pc, shares } = setup('owner');
    const c = compareStrategies({ state, pc, shares, settings: SETTINGS, prices: PRICES });
    const r = recommend(c, { budget: 150e6 });
    const l = energyLadder({ state, pc, shares, prices: PRICES, compare: c, recommended: r.recommended, budget: 150e6 });
    assert.equal(l.rows[0].id, 'natural');
    const cost = Object.fromEntries(l.rows.map((x) => [x.id, x.costPerStat]));
    assert.ok(cost[XANAX] < cost[POINTS], 'a Xanax’s 250 energy is cheaper per stat than 30 points for 150');
    assert.ok(cost[FHC] > 10 * cost[XANAX], 'FHC costs far more per stat');
    const fhc = l.rows.find((x) => x.id === FHC);
    assert.equal(fhc.inPlan, false);
    assert.match(fhc.note, /over your budget/);
    assert.match(fhc.note, /Max gains/);
    assert.ok(!l.rows.some((x) => x.id === 'special'), 'no special refills row without any');
    const costs = l.rows.map((x) => x.costPerStat).filter((x) => x !== null);
    assert.deepEqual(costs, [...costs].sort((a, b) => a - b));
});

test('boosterChoice: FHC or cans, whichever buys more energy a day in the budget and the cooldown', () => {
    assert.equal(boosterChoice({ perDay: 5e6, maxE: 150, prices: PRICES }).id, MUNSTER, '$5M a day: 2 cans, no FHC');
    const big = boosterChoice({ perDay: 60e6, maxE: 150, prices: PRICES });
    assert.equal(big.id, FHC);
    assert.equal(big.perDay, 4, 'the booster cap is 24 h');
    assert.equal(boosterChoice({ perDay: 0, maxE: 150, prices: PRICES }), null);
    assert.equal(bestCan(PRICES, { canMult: 1.5 }).energy, 30, 'faction Voracity +50%');
    assert.equal(bestCan(PRICES, { eventMult: 2 }).energy, 40, 'CaffeineCon doubles cans');
});

test('Max gains, no budget: FHC every time the cooldown allows beats steady, at a price a day', () => {
    const { state, pc, shares } = setup('owner');
    const c = compareStrategies({ state, pc, shares, settings: SETTINGS, prices: PRICES });
    assert.ok(c.steadyMax.gained > c.steady.gained * 1.5);
    assert.ok(c.steadyMax.used[FHC] >= 30 * 3, 'three or more FHC a day');
    const max = recommend(c, { budget: 150e6, pickBy: 'max' });
    assert.equal(max.recommended, 'steadyMax');
    assert.equal(recommend(c, { budget: 150e6 }).recommended, 'steady');
    assert.equal(Object.keys(PICK_BY).join(), 'auto,most,value,max');
});

test('a budget with room buys a middle rung: Steady + energy boosters', () => {
    const { state, pc, shares } = setup('owner');
    const c = compareStrategies({ state, pc, shares, settings: { horizonDays: 30, budget: 900e6 }, prices: PRICES });
    assert.ok(c.steadyBoost, 'steadyBoost simulated');
    // $25.8M a day left: 12 Munster (240 E, what the 24 h cooldown sustains) beat one FHC (150 E).
    assert.equal(c.steadyBoost.booster.id, MUNSTER);
    assert.equal(c.steadyBoost.booster.perDay, 12);
    assert.ok(c.steadyBoost.cost <= 900e6);
    assert.ok(c.steadyBoost.gained > c.steady.gained);
    assert.equal(recommend(c, { budget: 900e6 }).recommended, 'steadyBoost');
});

test('Best value for money picks the most stats per $1M inside the budget', () => {
    const results = { a: { id: 'a', gained: 100, cost: 10e6 }, b: { id: 'b', gained: 150, cost: 30e6 }, c: { id: 'c', gained: 400, cost: 900e6 } };
    assert.equal(recommend(results, { budget: 50e6 }).recommended, 'b');
    const v = recommend(results, { budget: 50e6, pickBy: 'value' });
    assert.equal(v.recommended, 'a');
    assert.match(v.alternatives.find((x) => x.id === 'b').why, /fewer per \$1M/);
    assert.equal(recommend(results, { budget: 50e6, pickBy: 'max' }).recommended, 'c');
});

/* Candy without Ecstasy (§1 item 20) */

test('Candy + Xanax: candy just after a tick, a Xanax session, no Ecstasy', () => {
    const state = player({ stats: FRIEND, drug: 0 });
    const steps = dayTimeline({ state, now: T0, strategy: 'candyXanax', ctx: { shares: BUILDS.balanced.shares, unlocked: unlockedGyms(18), active: 18 } });
    const b = steps.find((s) => s.kind === 'boost');
    assert.ok(b);
    assert.equal(new Date(b.at).getUTCMinutes() % 15, 1, 'a minute after the tick');
    assert.deepEqual(b.items.map((i) => i.id), [CANDY_KISSES, XANAX]);
    assert.ok(!steps.some((s) => (s.items || []).some((i) => i.id === ECSTASY)));
    assert.equal(b.strict, true);
});

/* Bliss what-if (§1 item 22) */

test('Ignorance Is Bliss what-if: shown when the book isn’t active, never recommended from', () => {
    const { state, pc, shares } = setup('owner');
    const w = blissWhatIf({ state, pc, shares, settings: SETTINGS, prices: PRICES });
    const c = compareStrategies({ state, pc, shares, settings: SETTINGS, prices: PRICES });
    assert.ok(w.blissSteady.whatIf && w.blissSteady.gained > c.steady.gained * 1.3);
    assert.ok(w.dailyChoco.gained > c.dailyChoco.gained);
    assert.equal(c.blissSteady, undefined, 'not a real option without the book');
});

/* Only what fits (§1 item 23) */

test('fits: a plan losing more than half the best plan’s stats is hidden unless asked', () => {
    assert.equal(fitsPlayer({ gained: 49 }, { gained: 100 }), false);
    assert.equal(fitsPlayer({ gained: 50 }, { gained: 100 }), true);
    const { state, pc, shares } = setup('owner');
    const r = recommend(compareStrategies({ state, pc, shares, settings: SETTINGS, prices: PRICES }), { budget: 150e6 });
    const hidden = r.alternatives.filter((a) => !a.fits).map((a) => a.id).sort();
    assert.ok(hidden.includes('edvdJump') && hidden.includes('chocoJump'), 'jumps lose more than half at 142M total');
});

/* Console jump and company variants (§1 items 21, 25) */

test('console jump: 3 Xanax, 300 energy on the Game Console, the plan’s candy to the cap + Ecstasy; bought only without one', () => {
    const state = player({ stats: FRIEND, energy: 900, drug: 3600 });
    const steps = dayTimeline({ state, now: T0, strategy: 'consoleJump', ctx: { shares: BUILDS.balanced.shares, unlocked: unlockedGyms(18), active: 18, stackedSoFar: 3, candyId: 310, consoleOwned: true } });
    const j = steps.find((s) => s.kind === 'jump');
    assert.match(j.label, /^Game Console × 60 \(Hardcore\) \+ Lollipop × 49 \+ Ecstasy/);
    assert.equal(j.energy, 600, '900 − 300 on the console');
    assert.equal(itemsNeeded(steps)[CONSOLE_ITEM], undefined, 'you have one: not bought');
    const none = dayTimeline({ state, now: T0, strategy: 'consoleJump', ctx: { shares: BUILDS.balanced.shares, unlocked: unlockedGyms(18), active: 18, stackedSoFar: 3, candyId: 310 } });
    assert.equal(itemsNeeded(none)[CONSOLE_ITEM], 1, 'none held: buy one');
    assert.equal(STRATEGIES.consoleJump.unverified, undefined, 'the wiki confirms it');
    const results = { steady: { id: 'steady', gained: 100, cost: 50e6 }, consoleJump: { id: 'consoleJump', gained: 200, cost: 40e6 } };
    assert.equal(recommend(results, { budget: 150e6 }).recommended, 'consoleJump', 'picked when it wins');
    const blocked = { ...results, consoleJump: { ...results.consoleJump, blocked: 'for stats under 250k; your STR is over it' } };
    const r = recommend(blocked, { budget: 150e6 });
    assert.equal(r.recommended, 'steady');
    assert.equal(r.alternatives[0].fits, false, 'behind the tick');
    assert.match(r.alternatives[0].why, /under 250k/);
});

test('company variants show only for players in that job (read from /user/perks)', () => {
    assert.ok(!feasibleStrategies({}).includes('consoleJumpToy'));
    assert.ok(!feasibleStrategies({}).includes('edvdJumpAN'));
    const toy = setup('friend', { perks: { job: ['+ 100% console happiness'] } });
    const an = setup('friend', { perks: { job: ['100% happy gain from Erotic DVDs'] } });
    const ct = compareStrategies({ state: toy.state, pc: toy.pc, shares: toy.shares, settings: SETTINGS, prices: PRICES });
    const ca = compareStrategies({ state: an.state, pc: an.pc, shares: an.shares, settings: SETTINGS, prices: PRICES });
    const plain = setup('friend');
    const cp = compareStrategies({ state: plain.state, pc: plain.pc, shares: plain.shares, settings: SETTINGS, prices: PRICES });
    assert.ok(ct.consoleJumpToy && ct.consoleJumpToy.gained > cp.consoleJump.gained);
    assert.equal(ct.consoleJump, undefined, 'in that job the variant replaces the plain plan');
    assert.ok(ca.edvdJumpAN && ca.edvdJumpAN.gained > cp.edvdJump.gained);
    assert.equal(ca.edvdJump, undefined);
    assert.equal(ct.edvdJumpAN, undefined);
});

test('the booster cap follows faction Voracity (+24 h)', () => {
    const { pc } = setup('friend', { perks: { faction: ['+ Adds 24 hours of maximum booster cooldown'] } });
    assert.equal(boosterCapOf(pc, {}), 48);
    assert.ok(feasibleStrategies({ boosterCapH: 48 }).includes('happy99k'));
});

/* Events (§1 item 26) */

const CAL = { competitions: [], events: [
    { title: 'CaffeineCon 2026', description: 'Energy drink effects are doubled', start: Date.UTC(2026, 9, 15) / 1000, end: Date.UTC(2026, 9, 15, 23, 59, 59) / 1000, fixed_start_time: false },
    { title: 'Tourism Day', description: 'x', start: Date.UTC(2026, 9, 1) / 1000, end: Date.UTC(2026, 9, 1, 23, 59, 59) / 1000, fixed_start_time: false },
    { title: 'Employee Appreciation Day', description: 'x', start: Date.UTC(2026, 9, 5) / 1000, end: Date.UTC(2026, 9, 7, 11, 59, 59) / 1000, fixed_start_time: true },
] };

test('events: the 48 h personal window from the player’s slot; only training events', () => {
    assert.equal(slotMinutes('12:00 TCT'), 720);
    assert.equal(slotMinutes(null), null);
    const w = eventWindow(CAL.events[0], 720);
    assert.equal(new Date(w.start).toISOString(), '2026-10-14T12:00:00.000Z');
    assert.equal(new Date(w.end).toISOString(), '2026-10-16T12:00:00.000Z');
    const now = Date.UTC(2026, 9, 3);
    const up = upcomingEvents(CAL, now, { startTime: '12:00' });
    assert.deepEqual(up.map((e) => e.id), ['ead', 'caffeinecon']);
    assert.equal(up.find((e) => e.id === 'caffeinecon').canMult, 2);
    assert.deepEqual(upcomingEvents(CAL, Date.UTC(2026, 8, 20)).map((e) => e.id), [], 'more than 14 days ahead');
});

test('events: keep the booster cooldown free the day before CaffeineCon; the plan drops its boosters', () => {
    const now = Date.UTC(2026, 9, 13, 18, 0);
    const up = upcomingEvents(CAL, now, { startTime: '12:00' });
    assert.equal(holdBoosterFor(up, now).id, 'caffeinecon');
    assert.equal(holdBoosterFor(up, Date.UTC(2026, 9, 10)), null);
    const hu = eventHeadsUp(up.find((e) => e.id === 'caffeinecon'), now);
    assert.match(hu.text, /^CaffeineCon in 18 h \(about\)$/);
    const state = player({ stats: OWNER, happy: 4000, gym: 24, at: now });
    const statics = { calendar: { calendar: CAL, startTime: '12:00' } };
    const m = buildModel({ state, statics, plan: { strategy: 'steadyMax', build: 'hank:def' }, settings: SETTINGS, unlockedKnown: OWNER_GYMS, now });
    assert.ok(!m.steps.some((s) => s.kind === 'booster'), 'no FHC in the day before');
    assert.ok(m.heads.some((h) => /^CaffeineCon/.test(h.text)));
    const later = buildModel({ state: player({ stats: OWNER, happy: 4000, gym: 24, at: Date.UTC(2026, 9, 10) }), statics, plan: { strategy: 'steadyMax', build: 'hank:def' }, settings: SETTINGS, unlockedKnown: OWNER_GYMS, now: Date.UTC(2026, 9, 10) });
    assert.ok(later.steps.some((s) => s.kind === 'booster' && s.items[0].id === FHC), 'FHC steps otherwise');
});

/* The model carries it all to the pages */

test('the model: ladder, spend a day and how long the cash lasts, special refills, the Plan dropdown', () => {
    const { state, pc, shares } = setup('friend', { special: 100 });
    const compare = compareStrategies({ state, pc, shares, settings: SETTINGS, prices: PRICES, special: 100 });
    const m = buildModel({ state, statics: { inventory: { [XANAX]: 1, cash: 200e6 } }, plan: { strategy: 'steady', build: 'baldr:str', pickBy: 'most', specialUse: 100, specialStart: 100 }, settings: SETTINGS, compare, unlockedKnown: unlockedGyms(18), now: T0 });
    assert.equal(m.pickBy, 'most');
    assert.deepEqual(m.special, { have: 100, left: 100, use: 100, held: 100 });
    assert.ok(m.ladder.rows.some((r) => r.id === 'special'));
    assert.ok(Math.abs(m.spend.perDay - compare.steady.cost / 30) < 1);
    assert.equal(Math.round(m.spend.lastsDays), Math.round(200e6 / (compare.steady.cost / 30)));
    const sp = m.steps.filter((s) => s.kind === 'special');
    if (compare.steady.specialHelps) assert.ok(sp.length && sp.reduce((a, s) => a + s.items[0].qty, 0) <= 4, 'steady: today’s share only (100 over 30 days)');
    else assert.equal(sp.length, 0, 'steady: not where they don’t help');
    const perE = statsPerEnergy({ stats: pc.stats, shares, best: pc.best, happy: 5025 });
    assert.ok(['str', 'spd', 'def', 'dex'].includes(perE.stat));
    assert.ok(perE.perEnergy > 0);
});

test('R2 keeps the old six plans’ numbers (sim30 at sample prices)', () => {
    const { state, pc, shares } = setup('friend');
    const c = compareStrategies({ state, pc, shares, settings: SETTINGS, prices: {} });
    const again = simulateStrategy('steady', { stats: pc.stats, target: shares, gyms: Object.fromEntries(Object.entries(pc.best).map(([k, g]) => [k, { dots: g.dots[k], energy: g.energy }])), perks: pc.perks.mult, happyMax: 5025, energyMax: 150, fastEnergy: true, days: 30, prices: {}, happyLossMult: 1 });
    assert.equal(c.steady.gained, again.gained);
    void HOUR;
    void DAY;
    void MIN;
    void tornClock;
});

test('war: where travellers go and an estimated landing from when we first saw them', async () => {
    const { travelOf, landingAt } = await import('../src/core/eye/war.js');
    assert.deepEqual(travelOf({ status: { description: 'Traveling to Mexico' } }), { kind: 'to', place: 'Mexico', minutes: 26 });
    assert.deepEqual(travelOf({ status: { description: 'Returning to Torn from Japan' } }), { kind: 'back', place: 'Japan', minutes: 225 });
    assert.equal(travelOf({ status: { description: 'In United Kingdom' } }).kind, 'abroad');
    assert.equal(travelOf({ status: { description: 'Okay' } }), null);
    const seen = Date.UTC(2026, 8, 29, 12, 0);
    assert.equal(landingAt(travelOf({ status: { description: 'Traveling to Mexico' } }), seen, seen + 60000), seen + 26 * 60000);
    assert.equal(landingAt(travelOf({ status: { description: 'In Mexico' } }), null, seen), seen + 26 * 60000, 'abroad: if they fly now');
});

test('review: an event holds the booster only for plans that use what it boosts, and counts ×2 cans while it runs', async () => {
    const { holdBoosterFor, eventMults } = await import('../src/core/events.js');
    const now = Date.UTC(2026, 9, 13, 18, 0);
    const up = upcomingEvents(CAL, now, { startTime: '12:00' });
    assert.equal(holdBoosterFor(up, now, 'steady'), null, 'steady uses no cans: nothing held');
    assert.equal(holdBoosterFor(up, now, 'steadyMax').id, 'caffeinecon');
    const during = upcomingEvents(CAL, Date.UTC(2026, 9, 15, 0, 0), { startTime: '12:00' });
    assert.deepEqual(eventMults(during), { canMult: 2, candyMult: 1 });
    assert.deepEqual(eventMults(up), { canMult: 1, candyMult: 1 });
});
