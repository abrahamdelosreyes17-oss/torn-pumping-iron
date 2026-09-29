import test from 'node:test';
import assert from 'node:assert/strict';

import { planGymPage } from '../src/core/gympage.js';
import { buildModel } from '../src/core/model.js';
import { normalizeState } from '../src/core/bars.js';
import { spots, pointOf, dragTo, posOf, PANEL_W, DEFAULT_TOP } from '../src/ui/overlay.js';

const T0 = Date.UTC(2026, 8, 29, 10, 48);

function model({ stats, energy, gymId, build = 'balanced', unlockedKnown = null, happy = 5025 }) {
    const state = normalizeState({
        bars: { energy: { current: energy, maximum: 150, increment: 5, interval: 600, tick_time: 120 }, happy: { current: happy, maximum: 5025, increment: 5, interval: 900, tick_time: 300 } },
        cooldowns: { drug: 3600, booster: 0 },
        refills: { energy: true },
        battlestats: { strength: { value: stats.str }, speed: { value: stats.spd }, defense: { value: stats.def }, dexterity: { value: stats.dex } },
        gym: { id: gymId },
    }, T0);
    return buildModel({ state, statics: {}, plan: { strategy: 'steady', build, goal: null }, settings: { horizonDays: 30, budget: 150e6 }, now: T0, unlockedKnown });
}

test('the friend at Gun Shop with 275 energy: DEX × 27, the rest get a grey word', () => {
    const m = model({ stats: { str: 118400, spd: 110900, def: 96200, dex: 82700 }, energy: 275, gymId: 18 });
    const p = planGymPage(m, { selectedId: 18 });
    assert.equal(p.perStat.dex.kind, 'train');
    assert.equal(p.perStat.dex.trains, 27);
    assert.match(p.perStat.dex.sub, /^all your energy · about \+1,\d{3}$/);
    assert.equal(p.perStat.str.kind, 'skip');
    assert.match(p.perStat.str.text, /over target/);
    assert.equal(p.perStat.def.text, 'Next · starts tomorrow');
    assert.equal(p.pill, 'Train DEX × 27');
    assert.deepEqual(p.strip.slice(0, 2), ['Balanced', 'DEX is furthest behind']);
    assert.equal(p.switchHint, null, 'Gun Shop ties Apollo on DEX: no switch for nothing');
});

test('a gym that doesn\'t train the stat the plan wants: switch hint, no Fill', () => {
    // At Pour Femme (6), DEX 3.8 is there but Gun Shop's 6.2 is unlocked.
    const m = model({ stats: { str: 118400, spd: 110900, def: 96200, dex: 82700 }, energy: 150, gymId: 18 });
    const p = planGymPage(m, { selectedId: 6 });
    assert.match(p.switchHint, /^Switch to (Gun Shop|Apollo Gym) for DEX \(6\.2 vs 3\.8\)$/);
});

test('the owner on Hank\'s at Gym 3000: stop at 18 trains, or Balboas is lost', () => {
    const unl = [...Array.from({ length: 24 }, (_, i) => i + 1), 25, 26, 27];
    const m = model({ stats: { str: 360e6, spd: 98.4e6, def: 288e6, dex: 288e6 }, energy: 1000, gymId: 27, build: 'hank', unlockedKnown: unl });
    const p = planGymPage(m, { selectedId: 27 });
    assert.equal(p.perStat.str.kind, 'train');
    assert.equal(p.perStat.str.trains, 18);
    assert.match(p.perStat.str.warn, /^Stop at 18 trains\. .*Balboas Gym/);
    assert.equal(p.perStat.spd.text, 'Not trained here');
});

test('too little energy for a train: the pill says wait', () => {
    const m = model({ stats: { str: 118400, spd: 110900, def: 96200, dex: 82700 }, energy: 5, gymId: 18 });
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
