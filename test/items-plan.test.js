/*
 * Items in the engine and on the pages (round 4 §D): the plan's candy named
 * in steps, Plan and Buy; the console jump for low stats; refills fill to the
 * maximum; special refills held; job points; company what-ifs; Buy's window.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { simulateStrategy, consoleBlocked, planWhat, CANDY_PLANS, SPECIAL, CONSOLE_MAX_STAT, SPECIAL_WEEK_MAX } from '../src/core/strategies.js';
import { dayTimeline, itemsNeeded, targetShares } from '../src/core/plan.js';
import { compareStrategies, companyWhatIf, buildModel, playerContext, buildOf, itemContext } from '../src/core/model.js';
import { recommend } from '../src/core/recommend.js';
import { normalizeState, tornDayStart, DAY, HOUR, MIN } from '../src/core/bars.js';
import { unlockedGyms } from '../src/core/gyms.js';
import { BUILDS } from '../src/core/builds.js';
import { XANAX, ECSTASY, EDVD, FHC, POINTS, LOLLIPOP, BOX_CHOC, CANDY_KISSES, PIXIE_STICKS, CUPCAKE, GAME_CONSOLE, SAMPLE_PRICES } from '../src/core/items.js';
import { needsForWindow, shownTypes, toggleType, candyNote, DEFAULT_BUY_TYPES } from '../src/ui/app/buy.js';
import { stepsForWorker } from '../src/api/worker.js';

const T0 = Date.UTC(2026, 8, 29, 10, 48);
const FRIEND = [118400, 110900, 96200, 82700];
const OWNER = [35.4e6, 4.06e6, 82.4e6, 20.4e6];
const SETTINGS = { horizonDays: 30, budget: 150e6 };
const PRICES = { [XANAX]: 845000, [ECSTASY]: 34000, [EDVD]: 4310000, [FHC]: 13950000, [POINTS]: 45000, [LOLLIPOP]: 400, [BOX_CHOC]: 320, 36: 26000, [CANDY_KISSES]: 32000, 528: 50000, 529: 100000, [PIXIE_STICKS]: 264000, [CUPCAKE]: 2088000 };

function player({ stats, happy = 5025, energy = 20, drug = 0, special = 0, gym = 18, at = T0 }) {
    return normalizeState({
        bars: { energy: { current: energy, maximum: 150, increment: 5, interval: 600, tick_time: 120 }, happy: { current: happy, maximum: happy, increment: 5, interval: 900, tick_time: 300 } },
        cooldowns: { drug, booster: 0 },
        refills: { energy: false, special_count: special },
        battlestats: { strength: { value: stats[0] }, speed: { value: stats[1] }, defense: { value: stats[2] }, dexterity: { value: stats[3] } },
        gym: { id: gym },
    }, at);
}

function setup(who, { special = 0, at = T0, energy = 20, drug = 0 } = {}) {
    const owner = who === 'owner';
    const state = player({ stats: owner ? OWNER : FRIEND, happy: owner ? 4000 : 5025, special, gym: owner ? 24 : 18, at, energy, drug });
    const pc = playerContext(state, {}, { unlockedKnown: owner ? unlockedGyms(24) : unlockedGyms(18) });
    const build = owner ? 'hank:def' : 'baldr:str';
    const shares = targetShares({ build }, pc.stats, buildOf(build).shares);
    return { state, pc, shares, build };
}

const SIM = { stats: { str: 118400, spd: 0, def: 0, dex: 0 }, target: 'str', gyms: { str: { dots: 6.5, energy: 10 } }, happyMax: 5025, prices: SAMPLE_PRICES };

/* The engine */

test('the plan picks the candy for every candy plan, by the Plan’s rule, and names it', () => {
    const { state, pc, shares } = setup('friend');
    const most = compareStrategies({ state, pc, shares, settings: SETTINGS, prices: PRICES });
    for (const id of CANDY_PLANS) if (most[id]) assert.ok(most[id].candy && most[id].candy.id && most[id].candy.count === 49, id + ' names its candy');
    assert.equal(most.steady.candy, undefined);
    assert.ok(most.dailyChoco.cost <= 150e6, 'inside the budget');
    const max = compareStrategies({ state, pc, shares, settings: SETTINGS, prices: PRICES, pickBy: 'max' });
    assert.equal(max.chocoJump.candy.id, CUPCAKE, 'no budget: the most happy');
    assert.ok(max.chocoJump.gained > most.chocoJump.gained);
    assert.match(planWhat('chocoJump', max.chocoJump), /^Stack 4 Xanax, then Birthday Cupcake × 49 \+ Ecstasy/);
    assert.match(planWhat('dailyChoco', most.dailyChoco), / × 49 \+ Ecstasy once a day/);
    // Only sample prices known: Candy Kisses is the one priced candy.
    const bare = compareStrategies({ state, pc, shares, settings: SETTINGS, prices: {} });
    assert.equal(bare.chocoJump.candy.id, CANDY_KISSES);
});

test('Sally’s Sweet Shop counts by default (owner, 2026-09-29); its tick switches it off; other shops only when ticked', () => {
    const { state, pc, shares } = setup('friend');
    const items = { [LOLLIPOP]: { market: 399, shops: [{ shop: "Sally's Sweet Shop", buy: 25 }] }, [BOX_CHOC]: { market: 5000, shops: [{ shop: 'Bits n Bobs', buy: 20 }] } };
    const off = compareStrategies({ state, pc, shares, settings: { ...SETTINGS, npcShopsOff: ["Sally's Sweet Shop"] }, prices: { ...PRICES, [BOX_CHOC]: 5000 }, statics: { items } });
    const on = compareStrategies({ state, pc, shares, settings: SETTINGS, prices: { ...PRICES, [BOX_CHOC]: 5000 }, statics: { items } });
    assert.notEqual(off.candyXanax.candy.source, 'npc');
    assert.equal(on.candyXanax.candy.id, LOLLIPOP);
    assert.equal(on.candyXanax.candy.source, 'npc');
    assert.equal(itemContext({ items }, {}).npc[LOLLIPOP].price, 25, 'on by default');
    assert.equal(itemContext({ items }, { npcShopsOff: ["Sally's Sweet Shop"] }).npc[LOLLIPOP], undefined);
    assert.equal(itemContext({ items }, {}).npc[BOX_CHOC], undefined, 'another shop only once ticked');
    assert.equal(itemContext({ items }, { npcShops: ['Bits n Bobs'] }).npc[BOX_CHOC].price, 20);
});

test('console jump: on for stats under 250k in what it trains; the owner never gets it recommended', () => {
    assert.equal(CONSOLE_MAX_STAT, 250000);
    assert.equal(consoleBlocked({ str: 118e3, spd: 111e3, def: 96e3, dex: 83e3 }, { str: 1, spd: 1, def: 1, dex: 1 }), null);
    assert.match(consoleBlocked({ str: 300e3, spd: 1e3, def: 1e3, dex: 1e3 }, { str: 5, spd: 0, def: 0, dex: 0 }), /STR is over it/);
    assert.equal(consoleBlocked({ str: 300e3, spd: 1e3, def: 1e3, dex: 1e3 }, { str: 0, spd: 5, def: 0, dex: 0 }), null, 'only the stats it trains count');
    const o = setup('owner');
    const co = compareStrategies({ state: o.state, pc: o.pc, shares: o.shares, settings: SETTINGS, prices: PRICES });
    assert.ok(co.consoleJump.blocked);
    assert.notEqual(recommend(co, { budget: 150e6, pickBy: 'max' }).recommended, 'consoleJump');
    const f = setup('friend');
    const cf = compareStrategies({ state: f.state, pc: f.pc, shares: f.shares, settings: SETTINGS, prices: PRICES });
    assert.equal(cf.consoleJump.blocked, undefined);
    assert.equal(cf.consoleJump.used[GAME_CONSOLE], 1, 'no console held: one is bought');
    const owned = compareStrategies({ state: f.state, pc: f.pc, shares: f.shares, settings: SETTINGS, prices: PRICES, statics: { inventory: { [GAME_CONSOLE]: 1 } } });
    assert.ok(!owned.consoleJump.used[GAME_CONSOLE]);
    assert.ok(owned.consoleJump.cost < cf.consoleJump.cost);
});

test('refills fill energy to the maximum, never above it; special refills held stand in for the points refill', () => {
    const plain = simulateStrategy('steady', SIM);
    assert.equal(plain.used[POINTS], 30 * 30, 'a points refill a day');
    const held = simulateStrategy('steady', { ...SIM, specialHeld: 10 });
    assert.equal(held.used.dailySpecial, 10);
    assert.equal(held.used[SPECIAL], 10);
    assert.equal(held.used[POINTS], 20 * 30, 'the points refill only once they’re spent');
    assert.equal(plain.cost - held.cost, 10 * 30 * SAMPLE_PRICES[POINTS]);
    const week = simulateStrategy('chocoJump', { ...SIM, days: 7, specialHeld: 1000, special: 1000 });
    assert.ok(week.used[SPECIAL] <= SPECIAL_WEEK_MAX, 'at most 100 a week');
});

test('the day plan: specials one at a time, each to the maximum; held specials replace the points refill', () => {
    const state = player({ stats: FRIEND, energy: 1150, drug: 3600, special: 3 });
    const base = { shares: BUILDS.balanced.shares, unlocked: unlockedGyms(18), active: 18 };
    const steps = dayTimeline({ state, now: T0, strategy: 'chocoJump', ctx: { ...base, specialLeft: 2, specialPerDay: 1, specialHeld: 3, candyId: LOLLIPOP } });
    const refill = steps.find((s) => s.kind === 'refill');
    assert.equal(refill.label, 'Special refill (instead of the points refill)');
    assert.deepEqual(refill.items, [{ id: SPECIAL, qty: 1 }]);
    assert.match(refill.note, /points refill only once your special refills are spent/);
    assert.equal(itemsNeeded(steps)[POINTS], undefined, 'no points bought');
    const sp = steps.find((s) => s.kind === 'special');
    assert.ok(sp.items[0].qty <= 2, 'never more than held after the daily one');
    assert.ok(sp.energy <= sp.items[0].qty * 150 + 10, 'each fills to 150, none stacks above it');
    const none = dayTimeline({ state: player({ stats: FRIEND, energy: 1150, drug: 3600 }), now: T0, strategy: 'chocoJump', ctx: base });
    assert.equal(none.find((s) => s.kind === 'refill').label, 'Refill · 30 points');
});

test('step labels name the candy (Home, Discord), and the cooldown cuts fit more', () => {
    const base = { shares: BUILDS.balanced.shares, unlocked: unlockedGyms(18), active: 18 };
    const jump = dayTimeline({ state: player({ stats: FRIEND, energy: 1150, drug: 3600 }), now: T0, strategy: 'chocoJump', ctx: { ...base, candyId: LOLLIPOP } }).find((s) => s.kind === 'jump');
    assert.equal(jump.label, 'Lollipop × 49 + Ecstasy, then train it all');
    const cut = dayTimeline({ state: player({ stats: FRIEND, energy: 1150, drug: 3600 }), now: T0, strategy: 'chocoJump', ctx: { ...base, candyId: PIXIE_STICKS, cdMult: 0.5 } }).find((s) => s.kind === 'jump');
    assert.equal(cut.label, 'Pixie Sticks × 97 + Ecstasy, then train it all');
    const cx = dayTimeline({ state: player({ stats: FRIEND, energy: 20, drug: 0 }), now: T0, strategy: 'candyXanax', ctx: { ...base, candyId: BOX_CHOC } }).find((s) => s.kind === 'boost');
    assert.match(cx.label, /^Box of Chocolate Bars × 49 \+ Xanax #\d, then train it all$/);
    assert.equal(stepsForWorker([jump])[0].label, 'Lollipop × 49 + Ecstasy, then train it all', 'the bot pings the same words');
});

test('job points: happy specials where you work go into the boost; Voyeur pays for EDVD', () => {
    const jobHappy = { specials: [{ jp: 30, happy: 4500 }, { jp: 1, happy: 50 }], jpPerDay: 10, bank: 60, type: 'Sweet Shop', stars: 10 };
    const plain = simulateStrategy('chocoJump', { ...SIM, candyCount: 48 });
    const sweet = simulateStrategy('chocoJump', { ...SIM, candyCount: 48, jobHappy });
    assert.ok(sweet.gained > plain.gained * 1.05, 'thousands of happy a jump');
    const steady = simulateStrategy('steady', { ...SIM, jobHappy });
    assert.ok(steady.gained > simulateStrategy('steady', SIM).gained);
    const edvd = simulateStrategy('edvdJump', SIM);
    const voyeur = simulateStrategy('edvdJump', { ...SIM, freeEdvdPerDay: 0.5 });
    assert.ok(voyeur.used.freeEdvd >= 10);
    assert.ok(voyeur.cost < edvd.cost);
    const base = { shares: BUILDS.balanced.shares, unlocked: unlockedGyms(18), active: 18 };
    const j = dayTimeline({ state: player({ stats: FRIEND, energy: 1150, drug: 3600 }), now: T0, strategy: 'chocoJump', ctx: { ...base, jobHappy } }).find((s) => s.kind === 'jump');
    assert.match(j.note, /Sweet Shop special \(60 job points, 30 → 4,500 happy\)/);
});

test('company what-ifs show only when being hired would beat your plan', () => {
    const f = setup('friend');
    const settings = { horizonDays: 30, budget: 900e6 };
    const compare = compareStrategies({ state: f.state, pc: f.pc, shares: f.shares, settings, prices: PRICES });
    const rec = recommend(compare, { budget: 900e6 });
    const w = companyWhatIf({ state: f.state, pc: f.pc, shares: f.shares, settings, prices: PRICES, compare, recommended: rec.recommended });
    const an = w.find((x) => x.id === 'an10');
    assert.ok(an, 'EDVD doubled beats the friend’s plan with room in the budget');
    assert.equal(an.title, 'Hired at a 10★ Adult Novelties');
    assert.ok(an.deltaPct > 0 && an.result.gained > compare[rec.recommended].gained);
    assert.match(an.note, /being hired by that company.*locked for 72 h after joining/);
    assert.ok(an.result.used.freeEdvd > 0, 'Voyeur: a free EDVD every 2 days');
    const o = setup('owner');
    const co = compareStrategies({ state: o.state, pc: o.pc, shares: o.shares, settings: SETTINGS, prices: PRICES });
    const wo = companyWhatIf({ state: o.state, pc: o.pc, shares: o.shares, settings: SETTINGS, prices: PRICES, compare: co, recommended: recommend(co, { budget: 150e6 }).recommended });
    assert.ok(!wo.some((x) => x.id === 'toy5'), 'no console for the owner');
    assert.ok(wo.every((x) => x.result.gained > co[recommend(co, { budget: 150e6 }).recommended].gained));
    // In the model: kept only while it still beats the recommendation.
    const m = buildModel({ state: f.state, plan: { strategy: 'steady', build: f.build }, settings, compare, jobWhatIf: w, unlockedKnown: unlockedGyms(18), now: T0 });
    assert.equal(m.jobWhatIf.length, w.length);
});

test('the model names the plan’s candy in today’s steps and runs on to the next boost for Buy', () => {
    const f = setup('friend');
    const compare = compareStrategies({ state: f.state, pc: f.pc, shares: f.shares, settings: SETTINGS, prices: PRICES });
    const name = compare.chocoJump.candy.id;
    const m = buildModel({ state: f.state, plan: { strategy: 'chocoJump', build: f.build }, settings: SETTINGS, compare, unlockedKnown: unlockedGyms(18), now: T0 });
    const jump = m.ahead.find((s) => s.kind === 'jump');
    assert.ok(jump.items.some((i) => i.id === name && i.qty === compare.chocoJump.candy.count));
    // Daily choco held late in the day: the boost lands after Torn midnight, and Buy still gets it in full.
    const late = Date.UTC(2026, 8, 29, 23, 20);
    const s = setup('friend', { at: late });
    const dc = compareStrategies({ state: s.state, pc: s.pc, shares: s.shares, settings: SETTINGS, prices: PRICES });
    const md = buildModel({ state: s.state, plan: { strategy: 'dailyChoco', build: s.build }, settings: SETTINGS, compare: dc, unlockedKnown: unlockedGyms(18), now: late });
    assert.ok(!md.steps.some((x) => x.kind === 'boost'), 'not in today’s steps');
    const boost = md.ahead.find((x) => x.kind === 'boost');
    assert.ok(boost && boost.at >= tornDayStart(late) + DAY, 'tomorrow');
    const today = needsForWindow(md, dc, { strategy: 'dailyChoco' }, 'today', 30);
    assert.equal(today[dc.dailyChoco.candy.id], dc.dailyChoco.candy.count, 'the whole boost, even on “Today”');
    assert.equal(today[ECSTASY], 1);
});

/* Buy */

test('Buy windows: the real schedule to the next jump, then the 30-day average for the days after it', () => {
    const now = T0;
    const day = tornDayStart(now);
    const m = { now, steps: [], ahead: [
        { at: now + HOUR, kind: 'stack', items: [{ id: XANAX, qty: 1 }] },
        { at: now + 8 * HOUR, kind: 'stack', items: [{ id: XANAX, qty: 1 }] },
        { at: day + DAY + 6 * HOUR, kind: 'jump', items: [{ id: LOLLIPOP, qty: 49 }, { id: ECSTASY, qty: 1 }, { id: GAME_CONSOLE, qty: 1 }] },
    ] };
    const compare = { chocoJump: { used: { [XANAX]: 90, [LOLLIPOP]: 49 * 22, [ECSTASY]: 22, [POINTS]: 660, [GAME_CONSOLE]: 1, special: 5, freeEdvd: 3, dailySpecial: 2 } } };
    const plan = { strategy: 'chocoJump' };
    assert.deepEqual(needsForWindow(m, compare, plan, 'today', 30), { [XANAX]: 2, [LOLLIPOP]: 49, [ECSTASY]: 1, [GAME_CONSOLE]: 1 }, 'the jump in full, on Today');
    const three = needsForWindow(m, compare, plan, 'three', 30);
    assert.equal(three[XANAX], Math.ceil(2 + 90 / 30), 'two days real, one averaged');
    assert.equal(three[GAME_CONSOLE], 1, 'the console once');
    assert.equal(three.special, undefined);
    assert.equal(three.freeEdvd, undefined);
    assert.equal(three[POINTS], 22);
});

test('Buy ticks: the plan’s types turn on (candy was hidden), unless you turned one off', () => {
    assert.ok(!DEFAULT_BUY_TYPES.includes('candy'));
    const on = shownTypes({}, ['drug', 'candy']);
    assert.ok(on.has('candy'));
    const patch = toggleType({}, ['drug', 'candy'], 'candy');
    assert.ok(!patch.buyTypes.includes('candy') && patch.buyTypesOff.includes('candy'));
    assert.ok(!shownTypes(patch, ['drug', 'candy']).has('candy'), 'your “off” sticks');
    const back = toggleType(patch, ['drug', 'candy'], 'candy');
    assert.ok(shownTypes(back, ['candy']).has('candy'));
    const pts = toggleType({}, ['points'], 'points');
    assert.ok(!pts.buyTypes.includes('points'), 'ux-check: the Points tick hides points');
    assert.equal(candyNote({ id: LOLLIPOP, options: 6 }, 'most'), 'the plan’s pick: the most stats in your budget, of 6 candy weighed');
});

void MIN;
