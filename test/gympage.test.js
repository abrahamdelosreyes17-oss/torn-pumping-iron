import test from 'node:test';
import assert from 'node:assert/strict';

import { planGymPage, nextSession, startSession, advanceSession, sessionProgress, needsNewSession, currentTrainStep, pageReading, partsText, trainInText, whyOneStat, NEW_SESSION_E, SESSION_MAX_MS } from '../src/core/gympage.js';
import { buildModel } from '../src/core/model.js';
import { normalizeState } from '../src/core/bars.js';
import { gainPerTrain } from '../src/core/gain.js';
import { gymById } from '../src/core/gyms.js';
import { spots, pointOf, dragTo, posOf, PANEL_W, DEFAULT_TOP } from '../src/ui/overlay.js';

const T0 = Date.UTC(2026, 8, 29, 10, 48);
const FRIEND = { str: 118400, spd: 110900, def: 96200, dex: 82700 };

function model({ stats, energy, gymId, build = 'balanced', unlockedKnown = null, happy = 5025, happyMax = 5025, drug = 3600 }) {
    const state = normalizeState({
        bars: { energy: { current: energy, maximum: 150, increment: 5, interval: 600, tick_time: 120 }, happy: { current: happy, maximum: happyMax, increment: 5, interval: 900, tick_time: 300 } },
        cooldowns: { drug, booster: 0 },
        refills: { energy: true },
        battlestats: { strength: { value: stats.str }, speed: { value: stats.spd }, defense: { value: stats.def }, dexterity: { value: stats.dex } },
        gym: { id: gymId },
    }, T0);
    return buildModel({ state, statics: {}, plan: { strategy: 'steady', build, goal: null }, settings: { horizonDays: 30, budget: 150e6 }, now: T0, unlockedKnown });
}

test('the friend at Gun Shop with 275 energy: one part, DEX × 27 here, the rest get a grey word', () => {
    const m = model({ stats: FRIEND, energy: 275, gymId: 18 });
    const p = planGymPage(m, { selectedId: 18 });
    assert.equal(partsText(p.parts), 'Gun Shop: DEX × 27');
    assert.equal(p.perStat.dex.kind, 'train');
    assert.equal(p.perStat.dex.trains, 27);
    assert.equal(p.perStat.dex.fill, 27);
    assert.match(p.perStat.dex.sub, /^all your energy · about \+1,\d{3}$/);
    assert.equal(p.perStat.str.kind, 'skip');
    assert.match(p.perStat.str.text, /over target/);
    assert.equal(p.perStat.def.text, 'Next · starts tomorrow');
    assert.equal(p.pill, 'Train DEX × 27');
    assert.equal(p.strip[0], 'Balanced');
    assert.equal(p.switchHint, null, 'Gun Shop ties Apollo on DEX: no switch for nothing');
    assert.equal(p.nextGym, null);
});

test('in a gym the current part isn\'t in: that gym\'s button is outlined ("Next: Gun Shop · DEX × 15"), one strip line, no box greyed', () => {
    // At Pour Femme (6): DEX 3.8 there, but the part is at Gun Shop (6.2).
    const m = model({ stats: FRIEND, energy: 150, gymId: 18 });
    const p = planGymPage(m, { selectedId: 6 });
    assert.deepEqual(p.nextGym, { id: 18, label: 'Next: Gun Shop · DEX × 15', group: 'a heavyweight gym' });
    assert.equal(p.switchHint, 'This session trains at Gun Shop: open it · then DEX × 15');
    assert.equal(p.pill, 'This session trains at Gun Shop: open it · then DEX × 15');
    assert.ok(Object.values(p.perStat).every((x) => x.kind === 'away'), 'nothing to Fill here');
    // Round 6 (owner: "it's just greyed out, I can still click it"): Torn's boxes get nothing; the strip says where.
    assert.ok(Object.values(p.perStat).every((x) => x.text === ''), 'nothing on the boxes');
});

test('the page and the API disagree on the gym you are in: the page wins (Torn\'s API lags a gym switch)', () => {
    // The API still says Pour Femme (6); the page shows the part's gym selected: train here, no switch line.
    const m = model({ stats: FRIEND, energy: 150, gymId: 6, unlockedKnown: Array.from({ length: 18 }, (_, i) => i + 1) });
    const part = planGymPage(m, { selectedId: 6 }).nextGym.id;
    const p = planGymPage(m, { selectedId: part });
    assert.equal(p.switchHint, null);
    assert.equal(p.perStat.dex.kind, 'train');
    assert.match(p.pill, /^Train DEX × \d+$/);
});

/** A friend whose session is two parts in two gyms: Global Gym DEF, then Knuckle Heads STR. */
function twoGyms() {
    const m = model({ stats: { str: 100e3, spd: 120e3, def: 99e3, dex: 125e3 }, energy: 400, gymId: 8, happy: 2500, happyMax: 2500, unlockedKnown: [1, 2, 3, 4, 5, 6, 7, 8, 9] });
    return m;
}

test('a two-gym session: the gym you\'re in first, then the other ("Global Gym: DEF × 30 → Knuckle Heads: STR × 25")', () => {
    const m = twoGyms();
    const step = currentTrainStep(m);
    assert.equal(partsText(step.parts), 'Global Gym: DEF × 30 → Knuckle Heads: STR × 25');
    assert.equal(trainInText(m), 'Global Gym for DEF · Knuckle Heads for STR');
    assert.equal(whyOneStat(m), null, 'two stats: no "only" line');
    const p = planGymPage(m, { selectedId: 8 });
    assert.equal(p.perStat.def.kind, 'train');
    assert.equal(p.perStat.def.trains, 30);
    assert.equal(p.perStat.str.text, 'Later · STR × 25 at Knuckle Heads');
    assert.deepEqual(p.parts.map((x) => x.state), ['current', 'later']);
});

/** Torn shows `n` more trains of `stat` in `gymId`: the box's value and the sidebar's energy move. */
function trained(reading, stat, n, gymId, happy = 2500) {
    const g = gymById(gymId);
    const stats = { ...reading.stats };
    for (let i = 0; i < n; i++) stats[stat] += gainPerTrain(stat, stats[stat], happy, g.dots[stat], g.energy);
    return { ...reading, stats, energy: reading.energy - n * g.energy };
}

test('the walk-through moves on with every train Torn shows: part 1 ticks, then Knuckle Heads is outlined, then Session done', () => {
    const m = twoGyms();
    let r = pageReading(m, [], { current: 400 });
    let s = nextSession(null, m, r, T0);
    assert.equal(s.parts.length, 2);
    // 12 DEF trains at Global Gym: 18 left, Fill 18.
    r = trained(r, 'def', 12, 8);
    s = nextSession(s, m, r, T0 + 60e3);
    let p = planGymPage(m, { selectedId: 8, reading: r }, s, T0 + 60e3);
    assert.equal(p.perStat.def.trains, 18);
    assert.equal(p.perStat.def.fill, 18);
    assert.equal(p.perStat.def.text, '18 trains left');
    // The other 18: part 1 done, the next part is in another gym.
    r = trained(r, 'def', 18, 8);
    s = nextSession(s, m, r, T0 + 120e3);
    p = planGymPage(m, { selectedId: 8, reading: r }, s, T0 + 120e3);
    assert.deepEqual(p.parts.map((x) => x.state), ['done', 'current']);
    assert.deepEqual(p.nextGym, { id: 9, label: 'Next: Knuckle Heads · STR × 25', group: 'a middleweight gym' });
    assert.ok(Object.values(p.perStat).every((x) => x.kind === 'away'));
    assert.equal(p.perStat.def.text, 'Done ✓ · DEF × 30');
    // At Knuckle Heads: STR outlined, Fill 25.
    p = planGymPage(m, { selectedId: 9, reading: r }, s, T0 + 150e3);
    assert.equal(p.perStat.str.kind, 'train');
    assert.equal(p.perStat.str.fill, 25);
    assert.equal(p.nextGym, null);
    // Torn's sidebar hasn't moved yet: the stat's rise alone counts the trains.
    r = { ...trained(r, 'str', 25, 9), energy: r.energy };
    s = nextSession(s, m, r, T0 + 200e3);
    p = planGymPage(m, { selectedId: 9, reading: r }, s, T0 + 200e3);
    assert.equal(p.done, true);
    assert.equal(p.pill, 'Session done');
    assert.deepEqual(p.parts.map((x) => x.state), ['done', 'done']);
});

test('a new session starts on a Xanax\'s energy, another build, or after 3 hours; a few energy of regeneration doesn\'t', () => {
    const m = twoGyms();
    const r = pageReading(m, [], { current: 400 });
    const s = startSession(currentTrainStep(m), r, m, T0);
    assert.equal(needsNewSession(s, r, m, T0 + 60e3), false);
    assert.equal(needsNewSession(s, { ...r, energy: 400 + NEW_SESSION_E - 5 }, m, T0 + 60e3), false);
    assert.equal(needsNewSession(s, { ...r, energy: 650 }, m, T0 + 60e3), true, 'a Xanax');
    assert.equal(needsNewSession({ ...s, build: 'hank:str' }, r, m, T0 + 60e3), true);
    assert.equal(needsNewSession(s, r, m, T0 + SESSION_MAX_MS + 1), true);
    assert.equal(needsNewSession(null, r, m, T0), true);
    // Before the Xanax (energy 25 of the 400 the step needs): the part waits, Fill types what 25 energy allows.
    const low = { ...r, energy: 25 };
    const p = planGymPage(m, { selectedId: 8, reading: low }, startSession(currentTrainStep(m), low, m, T0), T0);
    assert.equal(p.perStat.def.fill, 5);
    assert.match(p.perStat.def.sub, /5 now, the rest after more energy/);
    assert.equal(sessionProgress(advanceSession(s, r)).current.left, 30, 'nothing trained, nothing counted');
});

test('a part capped by a specialist gym says where to stop, and Fill uses the cap', () => {
    const unl = [...Array.from({ length: 24 }, (_, i) => i + 1), 25, 26, 27];
    const m = model({ stats: { str: 360e6, spd: 98.4e6, def: 288e6, dex: 288e6 }, energy: 1000, gymId: 27, build: 'hank', unlockedKnown: unl });
    const step = { id: 'x', label: 'Xanax #2', items: [], parts: [{ gymId: 27, gymName: 'Gym 3000', stat: 'str', trains: 18, perTrain: 50, gain: 2361741, stopAt: 18, stopReason: 'Balboas Gym' }] };
    const s = startSession(step, pageReading(m), m, T0);
    const p = planGymPage(m, { selectedId: 27 }, s, T0);
    assert.equal(p.perStat.str.kind, 'train');
    assert.equal(p.perStat.str.trains, 18);
    assert.match(p.perStat.str.warn, /^Stop at 18 trains\. .*Balboas Gym/);
    assert.equal(p.perStat.spd.text, 'Not trained here');
});

test('the owner (Hank\'s, far from it): STR only today, and the why line says how far and how long', () => {
    const m = model({ stats: { str: 35.4e6, spd: 4.06e6, def: 82.4e6, dex: 20.5e6 }, energy: 150, gymId: 24, build: 'hank:str', unlockedKnown: Array.from({ length: 24 }, (_, i) => i + 1) });
    const w = whyOneStat(m);
    assert.equal(w.stat, 'str');
    // STR catches up only as the total nears the one DEF sets (82.4M is 27.8% of ~296M): past the 30-day projection.
    assert.equal(w.text, "Training STR only: 10 pts under Hank's, more than 30 days to catch up");
    assert.equal(trainInText(m), "George's for STR");
    const f = whyOneStat(model({ stats: FRIEND, energy: 275, gymId: 18 }));
    assert.match(f.text, /^Training DEX only: 5 pts under Balanced, about \d days to catch up$/);
});

test('too little energy for a train: the pill says wait', () => {
    const m = model({ stats: FRIEND, energy: 5, gymId: 18 });
    const p = planGymPage(m, { selectedId: 18 });
    assert.equal(p.pill, 'Energy 5 · wait for the next step');
});

test('the panel lives in the empty LEFT margin first, so NPC Arbitrage keeps the right; it floats only when no margin fits', () => {
    // The owner's window: 1528 wide, Torn's sidebar + content from 320 to 1194.
    const page = { left: 320, right: 1194 };
    const list = spots(1528, page);
    assert.deepEqual(list.map((s) => s.side), ['left', 'right']);
    assert.equal(list[0].width, 296, 'the left margin is 12..308: a little under the usual 300');
    assert.deepEqual(pointOf(null, list, 784), { spot: list[0], x: 12, y: DEFAULT_TOP });
    // 1280 wide: Torn's page fills all but ~150 px each side, so it floats at the right edge.
    const narrow = spots(1280, { left: 152, right: 1128 });
    assert.equal(narrow.length, 1);
    assert.equal(narrow[0].side, 'float');
    assert.equal(pointOf(null, narrow, 700).x, 1276 - PANEL_W);
});

test('dragging keeps it inside a margin (never over Torn’s page), and the spot survives a resize', () => {
    const list = spots(1528, { left: 320, right: 1194 });
    // Dragged over Torn's content: held at the nearest margin's edge.
    const p = dragTo(list, 400, 300, 784);
    assert.equal(p.spot.side, 'left');
    assert.equal(p.x, 12);
    const q = dragTo(list, 1000, 300, 784);
    assert.equal(q.spot.side, 'right');
    assert.equal(q.x, 1206, 'right margin starts 12 px after Torn’s page');
    // Off the bottom: the header stays on screen.
    assert.equal(dragTo(list, 1300, 5000, 784).y, 784 - 36 - 4);
    // Saved against the right edge: after a wider window it is still at the right edge.
    const saved = posOf(dragTo(list, 5000, 200, 784));
    assert.deepEqual(saved, { side: 'right', off: 0, y: 200 });
    const wide = spots(1920, { left: 472, right: 1448 });
    assert.equal(pointOf(saved, wide, 900).x, 1908 - PANEL_W);
});
