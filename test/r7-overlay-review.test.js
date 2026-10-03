/*
 * Round 7, the independent review of the overlays and the gym page (2026-10-03): each finding shown first (the cause,
 * on the models the page really gets), then fixed.
 *   1. the gym page said "Train" with energy the plan keeps (the daily choco boost's held Xanax, the console jump's bar)
 *   2. a small candy boost was never seen as eaten (red EAT FIRST, Fill held, for the whole boost)
 *   3. the panel docked under a small Torn Eye card reached over Torn's page
 *   4. a false overdose: happy 0 + energy 0 + a drug cooldown is also a small happy maximum trained to the end
 *   5. "out early" on war lists lasted a second; every tag was rebuilt every second
 *   6. the panel and Torn Eye's list tags could take the same margin
 *   7. the model's cooldowns weren't aged
 *   8. the Torn Trading pause could flicker off between a hidden tab's once-a-minute marks
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { planGymPage, currentTrainStep, nextSession, startSession, pageReading, boostProgress, eatenOver, isOverdose, nextOverdose, nextBarsSeen, agedCooldowns, gymPanel, keptAll, OD_CD_MS } from '../src/core/gympage.js';
import { buildModel, keptEnergyOf } from '../src/core/model.js';
import { normalizeState } from '../src/core/bars.js';
import { boostActions } from '../src/core/plan.js';
import { CANDY_KISSES, XANAX, EDVD, ECSTASY } from '../src/core/items.js';
import { dockUnder, spots, spotsClearOf, pointOf, MINI_W } from '../src/ui/overlay.js';
import { TRADING_GRACE_MS, tradingRunning } from '../src/core/turns.js';

class FakeNode {
    constructor(tag, text = null) {
        this.tagName = tag ? tag.toUpperCase() : '#text';
        this.children = [];
        this.attrs = {};
        this.text = text;
    }
    setAttribute(k, v) {
        this.attrs[k] = String(v);
    }
    getAttribute(k) {
        return this.attrs[k] ?? null;
    }
    addEventListener() {}
    appendChild(c) {
        this.children.push(c);
        return c;
    }
    set textContent(v) {
        this.text = String(v);
        this.children = [];
    }
    get textContent() {
        return (this.text || '') + this.children.map((c) => c.textContent).join('');
    }
    all(pred, out = []) {
        if (pred(this)) out.push(this);
        for (const c of this.children) if (c.all) c.all(pred, out);
        return out;
    }
    querySelectorAll(sel) {
        const m = sel.match(/^\[([\w-]+)\]$/);
        return m ? this.all((n) => n !== this && n.attrs && n.attrs[m[1]] !== undefined) : [];
    }
}
globalThis.document = { createElement: (t) => new FakeNode(t), createElementNS: (_, t) => new FakeNode(t), createTextNode: (t) => new FakeNode(null, t) };
const { eyeRowSpot, eyeCardSpot, eyeRowTag, eyeSummary, eyeSummaryTag, eyeTickOut, eyeNextEarly, eyeRowsSig, eyeUntilMoved, EYE_ROW_LEAST } = await import('../src/ui/eye/eye-ui.js');
const { memberState } = await import('../src/core/eye/war.js');

const T0 = Date.UTC(2026, 8, 29, 10, 48);
const MIN = 60e3;
const HOUR = 3600e3;
const FRIEND = { str: 118400, spd: 110900, def: 96200, dex: 82700 };

function model(strategy, { energy = 275, gymId = 18, happy = 5025, drug = 3600, booster = 0, warOn = null, warReserve = 0 } = {}) {
    const state = normalizeState({
        bars: { energy: { current: energy, maximum: 150, increment: 5, interval: 600, tick_time: 120 }, happy: { current: happy, maximum: 5025, increment: 5, interval: 900, tick_time: 300 } },
        cooldowns: { drug, booster },
        refills: { energy: true },
        battlestats: { strength: { value: FRIEND.str }, speed: { value: FRIEND.spd }, defense: { value: FRIEND.def }, dexterity: { value: FRIEND.dex } },
        gym: { id: gymId },
    }, T0);
    return buildModel({ state, statics: {}, plan: { strategy, build: 'balanced', goal: null }, settings: { horizonDays: 30, budget: 150e6, warReserve }, warOn, now: T0 });
}

const trainMarks = (p) => Object.values(p.perStat).filter((x) => x.kind === 'train');

/* 1 · energy the plan keeps */

test('1 · the cause: after "Xanax #1 · keep the energy for the boost" the gym page said Train with the held energy', () => {
    const m = model('dailyChoco', { energy: 400 });
    // What the plan does with it: no trains before the boost after the tick.
    assert.match(m.steps[0].label, /Candy Kisses × \d+ \+ Ecstasy, then train it all/);
    assert.ok(m.steps[0].at > T0 + 30 * MIN, 'the boost is at the next tick, not now');
    // The page before the fix: no signal, so "the energy you have now" was split into trains.
    const before = { ...m, energyKept: null };
    assert.equal(currentTrainStep(before, T0).id, 'now', 'before: Train X × N in steady green');
});

test('1 · daily choco holding: the energy is kept for the boost: no train mark, the strip says how much and why', () => {
    const m = model('dailyChoco', { energy: 400 });
    assert.deepEqual({ why: m.energyKept.why, amount: m.energyKept.amount, all: m.energyKept.all }, { why: 'boost', amount: 400, all: true });
    assert.equal(currentTrainStep(m, T0), null);
    const p = planGymPage(m, { selectedId: 18 });
    assert.equal(p.state.kind, 'kept');
    assert.equal(trainMarks(p).length, 0, 'no green Train');
    assert.equal(p.hereGym, null);
    assert.equal(p.pill, null, 'the panel keeps the plan\'s next step and its countdown');
    assert.deepEqual({ tone: p.line.tone, head: p.line.head }, { tone: 'plain', head: 'Keeping 400 energy for the boost' });
    assert.match(p.line.text, /don’t train it now/);
    assert.match(p.line.src, /^next: 12:01 Candy Kisses × \d+ \+ Ecstasy, then train it all$/);
    assert.equal(gymPanel(p), null, 'the usual panel: the next step');
    // Not holding (energy at the bar): trained as before.
    const free = model('dailyChoco', { energy: 140 });
    assert.equal(free.energyKept, null);
    assert.equal(planGymPage(free, { selectedId: 18 }).state.kind, 'right');
});

test('1 · console jump before its stack: the bar stays under the 3 Xanax (the plan trains none of a 150 bar)', () => {
    for (const drug of [0, 3600]) {
        const m = model('consoleJump', { energy: 140, drug });
        assert.ok(!m.steps.some((s) => s.kind === 'natural' && s.at <= T0 + MIN), 'the plan trains nothing now');
        assert.equal(currentTrainStep({ ...m, energyKept: null }, T0).id, 'now', 'before the fix: Train with it');
        assert.deepEqual({ why: m.energyKept.why, amount: m.energyKept.amount, all: m.energyKept.all }, { why: 'console', amount: 140, all: true });
        const p = planGymPage(m, { selectedId: 18 });
        assert.equal(p.state.kind, 'kept');
        assert.equal(trainMarks(p).length, 0);
        assert.equal(p.line.head, 'Keeping 140 energy for the console jump');
    }
});

test('1 · a 4-Xanax jump: the bar the plan trains before the stack still shows; stacked Xanax are kept', () => {
    for (const drug of [0, 3600]) {
        const m = model('edvdJump', { energy: 150, drug });
        assert.equal(m.energyKept, null, 'nothing kept before the stack (4 Xanax need an empty bar)');
        const step = currentTrainStep(m, T0);
        assert.ok(step && step.kind === 'natural', 'the plan\'s own natural step: ' + (step && step.label));
        const p = planGymPage(m, { selectedId: 18 });
        assert.equal(p.state.kind, 'right');
        assert.equal(trainMarks(p).length, 1);
    }
    const stacked = model('edvdJump', { energy: 650 });
    assert.deepEqual({ why: stacked.energyKept.why, all: stacked.energyKept.all, stacked: stacked.energyKept.stacked, stackTo: stacked.energyKept.stackTo }, { why: 'jump', all: true, stacked: 2, stackTo: 4 });
    const p = planGymPage(stacked, { selectedId: 18 });
    assert.equal(p.state.kind, 'kept');
    assert.deepEqual([p.line.head, p.line.text], ['Keeping 650 energy for the jump', 'Xanax 2 of 4 stacked · don’t train it now']);
});

test('1 · a war reserve: only what is above it is trained; all of it kept says so', () => {
    assert.deepEqual(keptEnergyOf({ strategy: 'steady', energy: 275, warKeep: 100, warName: 'Rivals' }), { why: 'war', amount: 100, all: false, stacked: 0, stackTo: 4, war: 'Rivals' });
    assert.equal(keptEnergyOf({ strategy: 'steady', energy: 275 }), null);
    assert.equal(keptEnergyOf({ strategy: 'consoleJump', energy: 0 }), null);
    const m = model('steady', { energy: 275, warOn: { name: 'Rivals' }, warReserve: 100 });
    assert.equal(m.energyKept.amount, 100);
    const now = { ...m, steps: [] };
    const step = currentTrainStep(now, T0);
    const energy = step.parts.reduce((a, x) => a + x.trains * x.perTrain, 0);
    assert.ok(energy <= 175, 'the war\'s 100 left: ' + energy);
    const all = model('steady', { energy: 80, warOn: { name: 'Rivals' }, warReserve: 100 });
    const p = planGymPage({ ...all, steps: [] }, { selectedId: 18 });
    assert.equal(p.state.kind, 'kept');
    assert.match(p.line.text, /kept for Rivals/);
});

test('1 · a walk-through of "the energy you have now" ends once the energy is kept (a Xanax held or stacked)', () => {
    const free = model('dailyChoco', { energy: 140 });
    const reading = pageReading(free, [], { current: 140 });
    const s = startSession(currentTrainStep(free, T0), reading, free, T0);
    assert.equal(s.stepId, 'now');
    const held = model('dailyChoco', { energy: 400 });
    assert.equal(keptAll(held), true);
    assert.equal(nextSession(s, held, pageReading(held, [], { current: 400 }), T0 + MIN), null);
    assert.equal(planGymPage(held, { selectedId: 18 }, s, T0 + MIN).state.kind, 'kept');
});

/* 2 · a small candy boost */

const ckStep = () => {
    const acts = boostActions({ eat: 'Candy Kisses × 4', drug: 'Xanax' });
    return { id: 'boost-1', kind: 'boost', at: T0, tick: T0 - MIN, items: [{ id: CANDY_KISSES, qty: 4 }, { id: XANAX, qty: 1 }], actions: acts.list, parts: [{ gymId: 18, gymName: 'Gun Shop', stat: 'dex', trains: 30, perTrain: 10 }], deadline: T0 + 14 * MIN };
};

test('2 · the cause: Candy Kisses × 4 + Xanax put happy 275 over the maximum; the 300 floor never counted it eaten', () => {
    const reads = { happy: { current: 5025 + 275, max: 5025 }, boosterLeft: 2 * HOUR, drugLeft: 7 * HOUR };
    // The old rule: max(300, 25% of the boost).
    assert.ok(5025 + 275 < 5025 + Math.max(300, 0.25 * 200));
    const b = boostProgress(ckStep(), reads);
    assert.deepEqual({ eaten: b.eaten, drugIn: b.drugIn, ready: b.ready }, { eaten: true, drugIn: true, ready: true });
});

test('2 · the line is capped at half the boost: the Xanax alone (+75) is not the candy; big boosts keep the plan\'s share', () => {
    assert.equal(eatenOver(200), 100);
    assert.equal(eatenOver(12500), 3125, 'EDVD × 5: the plan\'s 25%');
    assert.equal(eatenOver(0), 300);
    const xanOnly = boostProgress(ckStep(), { happy: { current: 5025 + 75, max: 5025 }, boosterLeft: 0, drugLeft: 7 * HOUR });
    assert.equal(xanOnly.eaten, false);
    assert.equal(xanOnly.list.find((x) => x.next).id, 'eat');
});

test('2 · training the boost down does not un-eat it (the happy its trains took is added back)', () => {
    const reads = { happy: { current: 5025 + 275 - 200, max: 5025 }, boosterLeft: 2 * HOUR, drugLeft: 7 * HOUR };
    assert.equal(boostProgress(ckStep(), reads).eaten, false, '400 energy trained took 200 happy');
    assert.equal(boostProgress(ckStep(), { ...reads, happyTrained: 200 }).eaten, true);
    // On the gym page the session's trains count.
    const m = model('steady', { energy: 400 });
    const step = ckStep();
    m.steps = [step];
    m.next = step;
    const session = { ...startSession(step, pageReading(m, [], { current: 400 }), m, T0), spent: { str: 0, spd: 0, def: 0, dex: 400 } };
    const p = planGymPage(m, { selectedId: 18, reads }, session, T0 + 5 * MIN);
    assert.equal(p.state.boost.eaten, true);
});

/* 3 · the panel docked under a small Torn Eye card */

test('3 · the cause: at 1200 px the dock forced 160 px under a 100 px card, over Torn\'s page', () => {
    const vw = 1200;
    const page = { left: (vw - 976) / 2, right: (vw + 976) / 2 };
    const spot = eyeCardSpot(vw, page);
    assert.deepEqual({ mode: spot.mode, width: spot.width }, { mode: 'small', width: 100 });
    const card = { left: spot.x, right: spot.x + spot.width, top: 80, bottom: 200, width: spot.width, height: 120 };
    // The old rule: width = max(160, card), pulled back on screen → x = 1200 - 160 - 4 = 1036, 52 px over the page.
    assert.equal(1200 - 160 - 4, page.right - 52);
    const d = dockUnder(card, vw, 900, 36, 8, page);
    assert.ok(d.x >= page.right && d.x + d.width <= vw, 'never over Torn\'s page: ' + JSON.stringify(d));
    assert.deepEqual({ x: d.x, width: d.width }, { x: card.left, width: card.width });
});

test('3 · the dock stays in the card\'s margin at 1200 and 1280 on both sides; a margin too narrow: no dock', () => {
    for (const vw of [1200, 1280]) {
        const page = { left: (vw - 976) / 2, right: (vw + 976) / 2 };
        const s = eyeCardSpot(vw, page);
        const right = dockUnder({ left: s.x, right: s.x + s.width, top: 80, bottom: 200, width: s.width, height: 120 }, vw, 900, 36, 8, page);
        assert.ok(right.x >= page.right && right.x + right.width <= vw - 4, vw + ' right: ' + JSON.stringify(right));
        const lx = page.left - 6 - s.width;
        const left = dockUnder({ left: lx, right: lx + s.width, top: 80, bottom: 200, width: s.width, height: 120 }, vw, 900, 36, 8, page);
        assert.ok(left.x >= 4 && left.x + left.width <= page.left, vw + ' left: ' + JSON.stringify(left));
    }
    const page = { left: 50, right: 1026 };
    assert.equal(dockUnder({ left: 1030, right: 1100, top: 80, bottom: 200, width: 70, height: 120 }, 1110, 900, 36, 8, page), null, 'under ' + MINI_W + ' px: the panel takes its own place');
    assert.equal(dockUnder({ left: 400, right: 700, top: 80, bottom: 200, width: 300, height: 120 }, 1110, 900, 36, 8, page), null, 'a card over Torn\'s page: never docked there');
});

/* 4 · the overdose */

test('4 · the cause: a small happy maximum, a Xanax and every train: happy 0 + energy 0 + a drug cooldown', () => {
    // Happy maximum 100: +75 from the Xanax = 175; 400 energy trained takes 160–240 happy: both bars at 0.
    const reads = { happy: { current: 0, max: 100 }, energy: { current: 0, max: 150 }, drugLeft: 7 * HOUR };
    const before = { at: T0 - 2 * MIN, happy: 175, energy: 400 };
    assert.equal(isOverdose(reads, { before, now: T0 }), false, 'training explains it');
    assert.equal(nextOverdose(null, reads, T0, before), null);
});

test('4 · an overdose: the bars at 0 with the overdose\'s day-long cooldown, or a fall training can\'t explain', () => {
    const zero = { happy: { current: 0, max: 5025 }, energy: { current: 0, max: 150 } };
    assert.equal(isOverdose({ ...zero, drugLeft: 24 * HOUR }), true, 'about a day of drug cooldown: no Xanax\'s');
    assert.ok(OD_CD_MS > 8 * HOUR);
    assert.equal(isOverdose({ ...zero, drugLeft: 7 * HOUR }), false, 'a Xanax\'s cooldown alone is not enough');
    // A jump: 1,000 energy and 30,000 happy, then both at 0 at once.
    assert.equal(isOverdose({ ...zero, drugLeft: 3 * HOUR }, { before: { at: T0 - MIN, happy: 30000, energy: 1000 }, now: T0 }), true);
    assert.equal(isOverdose({ ...zero, drugLeft: 3 * HOUR }, { before: { at: T0 - HOUR, happy: 30000, energy: 1000 }, now: T0 }), false, 'a reading an hour old says nothing');
    assert.equal(isOverdose({ ...zero, drugLeft: 0 }, { before: { at: T0 - MIN, happy: 30000, energy: 1000 }, now: T0 }), false, 'no drug cooldown');
    // The last reading with something in the bars is what a fall is measured from.
    let seen = nextBarsSeen(null, { happy: { current: 30000 }, energy: { current: 1000 } }, T0 - MIN);
    seen = nextBarsSeen(seen, zero, T0);
    assert.deepEqual(seen, { at: T0 - MIN, happy: 30000, energy: 1000 });
});

test('4 · once seen it is checked against fresh readings: regeneration keeps it, a refill or the cooldown\'s end clears it', () => {
    const zero = { happy: { current: 0, max: 5025 }, energy: { current: 0, max: 150 }, drugLeft: 24 * HOUR };
    const od = nextOverdose(null, zero, T0);
    assert.deepEqual(od, { at: T0, until: T0 + 24 * HOUR });
    assert.equal(nextOverdose(od, { happy: { current: 10, max: 5025 }, energy: { current: 10, max: 150 }, drugLeft: 23 * HOUR }, T0 + 10 * MIN), od, 'regeneration');
    assert.equal(nextOverdose(od, { happy: { current: 10, max: 5025 }, energy: { current: 150, max: 150 }, drugLeft: 23 * HOUR }, T0 + 10 * MIN), null, 'a refill: the plan goes on');
    assert.equal(nextOverdose(od, { happy: { current: 0, max: 5025 }, energy: { current: 0, max: 150 }, drugLeft: 0 }, T0 + 2 * HOUR), null, 'the drug cooldown is over');
    assert.equal(nextOverdose(od, { ...zero, drugLeft: 0 }, T0 + 25 * HOUR), null, 'past its end');
});

/* 5 · "out early" */

test('5 · the cause: out early came from the one reading before, so the next second forgot it', () => {
    const nowS = 1_790_000_000;
    const hosp = [{ id: 1, status: { state: 'Hospital 01:17:00', until: nowS + 4620 } }];
    const okay = [{ id: 1, status: { state: 'Okay', until: 0 } }];
    let early = eyeNextEarly(null, hosp, okay, nowS, memberState);
    assert.deepEqual([...early], [[1, nowS + 4620]]);
    // The next second: the reading before is "okay" too; it stays out early until the hospital end it left.
    early = eyeNextEarly(early, okay, okay, nowS + 1, memberState);
    assert.deepEqual([...early.keys()], [1]);
    assert.deepEqual([...eyeNextEarly(early, okay, okay, nowS + 4621, memberState).keys()], [], 'its old hospital end passed');
    assert.deepEqual([...eyeNextEarly(early, okay, [{ id: 1, status: { state: 'Traveling', until: 0 } }], nowS + 2, memberState).keys()], [], 'another state');
    // Out at its time (within 30 s) is not early.
    assert.equal(eyeNextEarly(null, [{ id: 2, status: { state: 'Hospital 00:00:20', until: nowS + 20 } }], [{ id: 2, status: { state: 'Okay' } }], nowS, memberState).size, 0);
});

test('5 · the list is redrawn when a state changes, not every second as the hospital clock ticks; the clocks tick by themselves', () => {
    const nowS = 1_790_000_000;
    const a = [{ id: 1, status: { state: 'Hospital 01:17:00', until: nowS + 4620 } }, { id: 2, status: { state: 'Okay', until: 0 } }];
    const b = [{ id: 1, status: { state: 'Hospital 01:16:59', until: nowS + 4621 } }, { id: 2, status: { state: 'Okay', until: 0 } }];
    assert.equal(eyeRowsSig(a, memberState), eyeRowsSig(b, memberState));
    assert.equal(eyeUntilMoved(a, b), false, 'a second of wobble');
    assert.equal(eyeUntilMoved(a, [{ id: 1, status: { state: 'Hospital 03:00:00', until: nowS + 10800 } }]), true, 'hospitalised again');
    assert.notEqual(eyeRowsSig(a, memberState), eyeRowsSig([{ id: 1, status: { state: 'Okay' } }, a[1]], memberState));
    assert.notEqual(eyeRowsSig(a, memberState, new Map([[2, nowS + 99]])), eyeRowsSig(a, memberState));
    // The tag and the summary carry when they are out; eyeTickOut moves their clocks on.
    const tag = eyeRowTag({ id: 1, band: 'good', forecast: { pWin: 1, keep: 0.8 } }, { mode: 'full', state: 'hospital', outInS: 4620, outAt: nowS + 4620 });
    assert.match(tag.textContent, /out in 1:17$/);
    const sum = eyeSummaryTag(eyeSummary([{ state: 'hospital', until: nowS + 4620 }, { state: 'okay' }], nowS));
    assert.match(sum.textContent, /1 ready · 1 out in 1:17 · 0 traveling/);
    const root = new FakeNode('div');
    root.appendChild(tag);
    root.appendChild(sum);
    assert.equal(eyeTickOut(root, nowS + 61), 2);
    assert.match(tag.textContent, /out in 1:16$/);
    assert.match(sum.textContent, /1 out in 1:16/);
    assert.equal(eyeTickOut(root, nowS + 62), 0, 'nothing written while the minute is the same');
});

/* 6 · the panel and Torn Eye's list tags */

test('6 · list tags and the hover card leave the panel\'s margin when the other has room; the panel leaves their column', () => {
    // Torn's page off centre: 100 px on the right, 200 on the left: the tags would take the left, where the panel is.
    const vw = 1276;
    const page = { left: 200, right: 1176 };
    const panel = { left: 12, right: 124, top: 80, bottom: 116, width: 112, height: 36 };
    assert.equal(eyeRowSpot(vw, page).side, 'left', 'before: the same margin as the panel');
    const s = eyeRowSpot(vw, page, panel);
    assert.equal(s.side, 'right');
    assert.ok(s.x >= page.right && s.x + s.width <= vw, JSON.stringify(s));
    assert.equal(eyeCardSpot(vw, page, panel).side, 'right');
    // No room on the other side: they stay; the panel then leaves their column (the corner tag if no margin is left).
    const tight = { left: 200, right: 1176 + 40 };
    assert.equal(eyeRowSpot(vw, tight, panel).side, 'left');
    assert.ok(EYE_ROW_LEAST > 58);
    const col = { left: 20, right: 190 };
    const list = spots(vw, tight);
    assert.deepEqual(list.map((x) => x.side), ['left']);
    assert.deepEqual(spotsClearOf(list, col).map((x) => x.side), ['corner']);
    // Both margins usable: the panel takes the one without the tags.
    const wide = spots(1600, { left: 312, right: 1288 });
    const p = pointOf(null, spotsClearOf(wide, { left: 1298, right: 1548 }), 900);
    assert.ok(p.x + p.spot.width <= 312 && p.spot.side === 'left');
    const q = pointOf(null, spotsClearOf(wide, { left: 40, right: 290 }), 900);
    assert.equal(q.spot.side, 'right');
});

/* 7 · the model's cooldowns, aged */

test('7 · the cooldowns read from the model are what is left now, not when the model was made', () => {
    const m = { now: T0, strip: { drug: { left: 20e3 }, booster: { left: 5 * MIN } } };
    assert.deepEqual(agedCooldowns(m, T0 + 25e3), { boosterLeft: 5 * MIN - 25e3, drugLeft: 0 });
    assert.deepEqual(agedCooldowns(m, T0), { boosterLeft: 5 * MIN, drugLeft: 20e3 });
    assert.deepEqual(agedCooldowns(null, T0), { boosterLeft: 0, drugLeft: 0 });
    // The gym page's own reads (no live bars) are aged the same way.
    const jm = model('steady', { energy: 275, drug: 20 });
    assert.equal(planGymPage(jm, { selectedId: 18 }, null, T0 + 25e3).state.kind, 'right');
});

/* 8 · the pause */

test('8 · the Torn Trading pause outlasts a hidden tab\'s once-a-minute marks (Chrome\'s intensive throttling)', () => {
    assert.equal(TRADING_GRACE_MS, 120e3);
    const seen = T0;
    assert.equal(tradingRunning(seen, seen + 65e3), true, 'a mark a minute (plus a little) keeps it paused');
    assert.equal(tradingRunning(seen, seen + 120e3), false);
});

/* the EDVD jump states stay as they were (C/D of overlays.html) */

test('the EDVD jump\'s states are unchanged: not eaten at the maximum, ready with happy far above it', () => {
    const acts = boostActions({ eat: 'EDVD × 5', drug: 'Ecstasy', refill: true });
    const jump = { id: 'jump-1', kind: 'jump', at: T0, items: [{ id: EDVD, qty: 5 }, { id: ECSTASY, qty: 1 }], actions: acts.list, parts: [], deadline: T0 + 12 * MIN };
    assert.equal(boostProgress(jump, { happy: { current: 5025 + 300, max: 5025 }, boosterLeft: 10 * HOUR }).eaten, false);
    assert.equal(boostProgress(jump, { happy: { current: 35100, max: 5025 }, boosterLeft: 30 * HOUR, drugLeft: 4 * HOUR }).ready, true);
});
