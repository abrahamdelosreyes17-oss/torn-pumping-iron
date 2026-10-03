/*
 * Round 7, overlays on Torn (the owner's picks, 2026-10-03; mockups/round7/overlays.html): the gym page's states A–E
 * plus stacking for a chain, the boost checklist read from the bars, the overdose kept until its cooldown ends, the
 * panel docked under Torn Eye's fight card, and the paused card that says where Torn Trading still runs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { planGymPage, gymPageState, boostProgress, isOverdose, nextOverdose, gymPanel, currentTrainStep, REHAB_COST, TRAVEL_URL } from '../src/core/gympage.js';
import { buildModel } from '../src/core/model.js';
import { normalizeState } from '../src/core/bars.js';
import { boostActions } from '../src/core/plan.js';
import { EDVD, ECSTASY, XANAX, POINTS } from '../src/core/items.js';
import { dockUnder, DOCK_GAP, fitTier, spots, pointOf, FIT_FULL_W, FIT_NARROW_W, FIT_COMPACT_W, MINI_W, CORNER_TOP } from '../src/ui/overlay.js';
import { nextTradingTabs, tradingSeenWhere, tradingRunning, TRADING_GRACE_MS, TRADING_SEEN_KEY, TRADING_TABS_KEY } from '../src/core/turns.js';
import { lookOnce, isPaused, tradingWhere } from '../src/turns.js';
import { get, set } from '../src/platform/store.js';

const T0 = Date.UTC(2026, 8, 29, 10, 48);
const MIN = 60e3;
const HOUR = 3600e3;
const FRIEND = { str: 118400, spd: 110900, def: 96200, dex: 82700 };

function model({ energy = 275, gymId = 18, happy = 5025, happyMax = 5025, drug = 3600 } = {}) {
    const state = normalizeState({
        bars: { energy: { current: energy, maximum: 150, increment: 5, interval: 600, tick_time: 120 }, happy: { current: happy, maximum: happyMax, increment: 5, interval: 900, tick_time: 300 } },
        cooldowns: { drug, booster: 0 },
        refills: { energy: true },
        battlestats: { strength: { value: FRIEND.str }, speed: { value: FRIEND.spd }, defense: { value: FRIEND.def }, dexterity: { value: FRIEND.dex } },
        gym: { id: gymId },
    }, T0);
    return buildModel({ state, statics: {}, plan: { strategy: 'steady', build: 'balanced', goal: null }, settings: { horizonDays: 30, budget: 150e6 }, now: T0 });
}

/** The friend's model with an EDVD jump due now at Gun Shop (DEX × 27, as the plan's jump steps carry it). */
function jumpModel(opts = {}) {
    const m = model(opts);
    const base = m.steps.find((s) => s.parts && s.parts.length);
    const acts = boostActions({ eat: 'EDVD × 5', drug: 'Ecstasy', refill: true });
    const jump = { ...base, id: 'jump-1', kind: 'jump', at: T0, label: 'EDVD × 5 + Ecstasy, then train it all', items: [{ id: EDVD, qty: 5 }, { id: ECSTASY, qty: 1 }], gain: 13500, strict: true, deadline: T0 + 12 * MIN, tick: T0 - 3 * MIN, actions: acts.list, actionNow: acts.now };
    const refill = { id: 'refill-2', kind: 'refill', at: T0 + MIN, label: 'Refill · 30 points', items: [{ id: POINTS, qty: 30 }], parts: [], trains: {}, gain: 0 };
    m.steps = [jump, refill];
    m.next = jump;
    return m;
}

const fresh = { happy: { current: 5025, max: 5025 }, boosterLeft: 0, drugLeft: 0 };
const eaten = { happy: { current: 17550, max: 5025 }, boosterLeft: 30 * HOUR, drugLeft: 0 };
const both = { happy: { current: 35100, max: 5025 }, boosterLeft: 30 * HOUR, drugLeft: 4 * HOUR };

/* A · the right gym */

test('A · right gym: the stat is green with "TRAIN THIS · 27 trains · about +…", the gym is a steady green, Fill 27', () => {
    const p = planGymPage(model(), { selectedId: 18 });
    assert.equal(p.state.kind, 'right');
    assert.deepEqual({ id: p.hereGym.id, wrong: p.hereGym.wrong }, { id: 18, wrong: false });
    assert.equal(p.nextGym, null, 'no gym pulses');
    const d = p.perStat.dex;
    assert.deepEqual({ kind: d.kind, mark: d.mark, hold: d.hold, fill: d.fill }, { kind: 'train', mark: 'right', hold: false, fill: 27 });
    assert.match(d.tab, /^Train this · 27 trains · about \+1,\d{3}$/);
    assert.deepEqual({ tone: p.line.tone, head: p.line.head }, { tone: 'green', head: 'Train DEX × 27 here' });
    // The other stats: a small dark tag, the full words on hover.
    assert.equal(p.perStat.str.tag, 'skip · over target');
    assert.equal(p.perStat.def.tag, 'tomorrow');
    const panel = gymPanel(p);
    assert.deepEqual({ tone: panel.tone, title: panel.title, step: panel.step, action: panel.action }, { tone: 'green', title: 'Now', step: 'Train DEX × 27', action: null });
});

/* B · the wrong gym */

test('B · wrong gym: the panel says switch and by how much; the strip names both gyms with their DEX', () => {
    const p = planGymPage(model({ energy: 150 }), { selectedId: 6 });
    assert.equal(p.state.kind, 'wrong');
    const panel = gymPanel(p);
    assert.equal(panel.tone, 'red');
    assert.equal(panel.step, 'Switch to Gun Shop');
    assert.equal(panel.sub, 'DEX trains at 6.2 there, 3.8 here: 1.6× the gain for the same energy');
});

/* C · a jump, boosters not taken yet */

test('C · jump, nothing eaten (happy at the maximum): the stat pulses red "EAT FIRST", Fill waits, the strip says what to eat in order and by when', () => {
    const m = jumpModel();
    const p = planGymPage(m, { selectedId: 18, reads: fresh });
    assert.equal(p.state.kind, 'eat');
    const d = p.perStat.dex;
    assert.deepEqual({ mark: d.mark, hold: d.hold, fill: d.fill, tab: d.tab, sub: d.sub }, { mark: 'eat', hold: true, fill: 0, tab: 'Eat first', sub: 'EDVD × 5 + Ecstasy first' });
    assert.deepEqual({ tone: p.line.tone, head: p.line.head, text: p.line.text, src: p.line.src }, { tone: 'red', head: 'Jump: eat first', text: 'EDVD × 5, then the Ecstasy, then train it all', src: 'finish before 11:00' });
    assert.equal(p.pill, 'Eat first · EDVD × 5');
    const panel = gymPanel(p);
    assert.equal(panel.title, 'Jump · 11:00');
    assert.deepEqual(panel.checklist.map((c) => [c.text, c.done, c.next]), [['EDVD × 5', false, true], ['Ecstasy', false, false], ['Train it all: DEX × 27', false, false], ['Refill, then train again', false, false]]);
});

test('C · the boosters in, the Ecstasy not yet: EDVD ticked, the Ecstasy next, still red', () => {
    const p = planGymPage(jumpModel(), { selectedId: 18, reads: eaten });
    assert.equal(p.state.kind, 'eat');
    assert.deepEqual(p.state.boost.list.map((c) => [c.id, c.done, c.next]), [['eat', true, false], ['drug', false, true], ['train', false, false], ['refill', false, false]]);
    assert.equal(p.line.text, 'the Ecstasy, then train it all');
});

test('C · stacked Xanax put happy a few hundred above the maximum: that is not the boosters', () => {
    const b = boostProgress(jumpModel().next, { happy: { current: 5025 + 300, max: 5025 }, boosterLeft: 10 * HOUR, drugLeft: 0 });
    assert.equal(b.eaten, false);
});

/* D · a jump, boosters and the drug in */

test('D · happy far above the maximum, the booster and drug cooldowns running: steady green "TRAIN IT ALL · about +13,500", Fill 27', () => {
    const p = planGymPage(jumpModel(), { selectedId: 18, reads: both });
    assert.equal(p.state.kind, 'ready');
    const d = p.perStat.dex;
    assert.deepEqual({ mark: d.mark, hold: d.hold, fill: d.fill, tab: d.tab }, { mark: 'ready', hold: false, fill: 27, tab: 'Train it all · about +13,500' });
    assert.deepEqual({ tone: p.line.tone, head: p.line.head, text: p.line.text }, { tone: 'green', head: 'Jump ready · happy 35,100', text: 'train it all, then the refill' });
    const panel = gymPanel(p);
    assert.deepEqual({ tone: panel.tone, title: panel.title, step: panel.step }, { tone: 'green', title: 'Jump · now', step: 'Train it all: DEX × 27' });
    assert.deepEqual(panel.checklist.map((c) => [c.done, c.next]), [[true, false], [true, false], [false, true], [false, false]]);
});

test('D · the plan\'s mid-step lists the drug still to take (an earlier Xanax ends before the tick): its cooldown running is not the drug', () => {
    const acts = boostActions({ eat: 'the boosters', eaten: true, drug: 'Xanax', drugDone: false });
    const step = { kind: 'boost', mid: true, items: [{ id: XANAX, qty: 1 }], actions: acts.list, parts: [], deadline: T0 + 10 * MIN };
    const b = boostProgress(step, { happy: { current: 9000, max: 5025 }, boosterLeft: 5 * HOUR, drugLeft: 8 * MIN });
    assert.deepEqual({ eaten: b.eaten, drugIn: b.drugIn, eat: b.eat }, { eaten: true, drugIn: false, eat: 'Boosters' });
});

/* E · overdosed */

test('E · overdose: happy and energy 0 right after a drug; kept until that cooldown ends; every mark stops; Open Travel', () => {
    const reads = { happy: { current: 0, max: 5025 }, energy: { current: 0, max: 150 }, drugLeft: 30 * HOUR };
    assert.equal(isOverdose(reads), true);
    assert.equal(isOverdose({ ...reads, drugLeft: 0 }), false, 'no drug just taken');
    assert.equal(isOverdose({ ...reads, energy: { current: 5, max: 150 } }), false);
    const od = nextOverdose(null, reads, T0);
    assert.deepEqual(od, { at: T0, until: T0 + 30 * HOUR });
    // A tick later the bars climb again: still overdosed until the cooldown it started ends.
    assert.equal(nextOverdose(od, { happy: { current: 5, max: 5025 }, energy: { current: 5, max: 150 }, drugLeft: 29 * HOUR }, T0 + HOUR), od);
    assert.equal(nextOverdose(od, fresh, T0 + 31 * HOUR), null);
    const p = planGymPage(jumpModel(), { selectedId: 18, reads: fresh, overdose: od }, null, T0 + MIN);
    assert.equal(p.state.kind, 'overdose');
    assert.ok(Object.values(p.perStat).every((x) => x.kind === 'off'), 'every jump mark stops');
    assert.equal(p.hereGym, null);
    assert.equal(p.nextGym, null);
    assert.equal(p.line.tone, 'amber');
    assert.match(p.line.text, /fly to Switzerland for rehab, about \$215,000 a session/);
    assert.deepEqual(p.line.link, { text: 'Open Travel', href: 'https://www.torn.com/travelagency.php' });
    const panel = gymPanel(p);
    assert.deepEqual({ title: panel.title, step: panel.step, action: panel.action }, { title: 'Overdosed', step: 'Fly to Switzerland', action: { text: 'Open Travel', href: TRAVEL_URL } });
    assert.equal(REHAB_COST, 215000);
});

/* Stacking for a chain */

test('stacking for a chain (m.stacking): no train or jump marks, one amber strip line; undefined = as before', () => {
    const m = jumpModel();
    m.stacking = { since: T0 - HOUR };
    const p = planGymPage(m, { selectedId: 18, reads: both });
    assert.equal(p.state.kind, 'stacking');
    assert.ok(Object.values(p.perStat).every((x) => x.kind === 'off'));
    assert.equal(p.hereGym, null);
    assert.deepEqual({ tone: p.line.tone, head: p.line.head, text: p.line.text }, { tone: 'amber', head: 'Stacking for a chain', text: 'training paused · no train marks until you resume' });
    assert.equal(p.pill, 'Stacking for a chain · training paused');
    delete m.stacking;
    assert.equal(planGymPage(m, { selectedId: 18, reads: both }).state.kind, 'ready');
});

test('the state order: stacking, overdose, then the gym, then eat first', () => {
    const step = jumpModel().next;
    const cur = { gymId: 18, stat: 'dex' };
    assert.equal(gymPageState({ step, cur, here: false, reads: fresh, now: T0 }).kind, 'wrong');
    assert.equal(gymPageState({ step, cur, here: true, reads: fresh, overdose: { at: T0, until: T0 + HOUR }, now: T0 }).kind, 'overdose');
    assert.equal(gymPageState({ step, cur, here: true, reads: fresh, stacking: { since: T0 }, overdose: { at: T0, until: T0 + HOUR }, now: T0 }).kind, 'stacking');
    assert.equal(gymPageState({ step: null, cur: null, done: true, now: T0 }).kind, 'done');
    assert.equal(gymPageState({ step: { ...step, kind: 'natural' }, cur, here: true, reads: fresh, now: T0 }).kind, 'right', 'not a boost: no eat first (FHC and cans never)');
});

test('between the stacks of a jump plan the page never says to train the stacked energy', () => {
    const m = model({ energy: 550 });
    m.steps = [];
    m.strip.refill.stacking = true;
    assert.equal(currentTrainStep(m, T0), null);
    m.strip.refill.stacking = false;
    assert.ok(currentTrainStep(m, T0));
});

/* The panel docked under Torn Eye's fight card (attack page) */

test('dock: directly under the fight card, as wide as it, never over it; above it when there is no room under it', () => {
    const card = { left: 1000, top: 80, right: 1300, bottom: 420, width: 300, height: 340 };
    assert.deepEqual(dockUnder(card, 1600, 900), { x: 1000, y: 420 + DOCK_GAP, width: 300, side: 'below' });
    const low = { left: 1000, top: 500, right: 1300, bottom: 880, width: 300, height: 380 };
    const d = dockUnder(low, 1600, 900, 36);
    assert.equal(d.side, 'above');
    assert.ok(d.y + 36 <= low.top, 'its bottom stays above the card');
    // Off the right edge: pulled back on screen, still the card's width.
    assert.equal(dockUnder({ ...card, left: 1400, right: 1700 }, 1600, 900).x, 1600 - 300 - 4);
    // Neither fits: under it (partly off screen), never on it.
    const tall = { left: 10, top: 20, right: 310, bottom: 880, width: 300, height: 860 };
    assert.ok(dockUnder(tall, 1600, 900).y >= tall.bottom);
});

/* The panel sized to the free space beside Torn's page (the owner: never over Torn's page, like NPC Arbitrage) */

test('fit: the free width picks the size and its type: full 300, narrower with smaller type, one tag, the smallest', () => {
    assert.deepEqual(fitTier(300), { tier: 'full', font: 13, step: 20, folded: false });
    assert.deepEqual(fitTier(FIT_FULL_W), { tier: 'full', font: 13, step: 20, folded: false });
    assert.deepEqual(fitTier(FIT_FULL_W - 1), { tier: 'narrow', font: 12, step: 16, folded: false });
    assert.deepEqual(fitTier(FIT_NARROW_W), { tier: 'narrow', font: 12, step: 16, folded: false });
    assert.deepEqual(fitTier(FIT_NARROW_W - 1), { tier: 'compact', font: 11, step: 14, folded: true });
    assert.deepEqual(fitTier(FIT_COMPACT_W), { tier: 'compact', font: 11, step: 14, folded: true });
    assert.equal(fitTier(FIT_COMPACT_W - 1).tier, 'mini');
});

test('fit: windows from 1920 to 1024 (Torn\'s page 976 wide, centred): never over the page, the bigger side wins, left on a tie', () => {
    const page = (w) => ({ left: (w - 976) / 2, right: (w + 976) / 2 });
    const at = (w) => {
        const list = spots(w, page(w));
        const p = pointOf(null, list, 900);
        return { side: p.spot.side, tier: p.spot.tier, width: p.spot.width, x: p.x, clear: p.x + p.spot.width <= page(w).left || p.x >= page(w).right || p.spot.side === 'corner' };
    };
    assert.deepEqual(at(1920), { side: 'left', tier: 'full', width: 300, x: 12, clear: true });
    assert.deepEqual(at(1600), { side: 'left', tier: 'full', width: 288, x: 12, clear: true });
    assert.deepEqual(at(1440), { side: 'left', tier: 'narrow', width: 208, x: 12, clear: true });
    assert.deepEqual(at(1280), { side: 'left', tier: 'compact', width: 128, x: 12, clear: true });
    // 1100: 38 px a side, not one tag: the smallest tag in the window's top corner (over Torn's header).
    assert.deepEqual(at(1100), { side: 'corner', tier: 'mini', width: MINI_W, x: 4, clear: true });
    assert.equal(pointOf(null, spots(1100, page(1100)), 900).y, CORNER_TOP);
    // Torn's page off centre (the sidebar wider on one side): the side with room for the bigger panel wins.
    const lop = spots(1440, { left: 140, right: 1116 });
    assert.deepEqual(lop.map((s) => [s.side, s.tier]), [['right', 'full'], ['left', 'compact']]);
    // Saved on the left, but the right holds a bigger panel now: it moves; saved on the bigger side: it stays.
    assert.equal(pointOf({ side: 'left', off: 0, y: 100 }, lop, 900).spot.side, 'right');
    assert.equal(pointOf({ side: 'right', off: 0, y: 100 }, spots(1920, page(1920)), 900).spot.side, 'right');
});

/* Paused: where Torn Trading is still seen */

test('paused, the cause: a tab opened before Torn Trading was turned off keeps its host, so it keeps marking it seen for as long as it is open', () => {
    set(TRADING_SEEN_KEY, 0);
    set(TRADING_TABS_KEY, null);
    // Turning a script off in Tampermonkey doesn't unload it from a page already open: its host stays.
    const oldTab = { getElementById: (id) => (id === 'ttv2-host' ? {} : null) };
    let t = T0;
    for (; t < T0 + 10 * MIN; t += 5000) lookOnce(oldTab, t);
    assert.equal(isPaused(t), true, 'ten minutes after it was turned off, still paused');
    assert.equal(tradingWhere(t).count, 1);
    // That tab reloaded (or closed): no host, its entry goes; the pause ends 60 s after its last mark.
    lookOnce({ getElementById: () => null }, t);
    const w = tradingWhere(t);
    assert.equal(w.count, 0);
    assert.equal(w.resumesAt, get(TRADING_SEEN_KEY, 0) + TRADING_GRACE_MS);
    assert.equal(isPaused(w.resumesAt), false);
});

test('paused card: "Still seen in 2 tabs: Item Market, Points market", last seen; a tab gone drops off; stale tabs age out', () => {
    let tabs = nextTradingTabs(null, 'a', true, 'itemmarket', T0);
    tabs = nextTradingTabs(tabs, 'b', true, 'points', T0 + 4000);
    assert.equal(nextTradingTabs(tabs, 'b', true, 'points', T0 + 6000), null, 'no write before the next 15 s mark');
    const w = tradingSeenWhere(tabs, T0 + 4000, T0 + 10000);
    assert.deepEqual({ count: w.count, where: w.where, lastAt: w.lastAt }, { count: 2, where: ['Points market', 'Item Market'], lastAt: T0 + 4000 });
    tabs = nextTradingTabs(tabs, 'a', false, 'itemmarket', T0 + 12000);
    assert.deepEqual(tradingSeenWhere(tabs, T0 + 4000, T0 + 12000).where, ['Points market']);
    assert.equal(tradingSeenWhere(tabs, T0 + 4000, T0 + 4000 + TRADING_GRACE_MS).count, 0, 'a tab closed without saying so ages out');
    assert.equal(tradingRunning(T0 + 4000, T0 + 4000 + TRADING_GRACE_MS - 1), true);
    assert.deepEqual(tradingSeenWhere({ x: { at: T0, where: 'trading' } }, T0, T0).where, ['Torn Bids']);
});
