import test from 'node:test';
import assert from 'node:assert/strict';

import { planGymPage } from '../src/core/gympage.js';
import { buildModel } from '../src/core/model.js';
import { normalizeState } from '../src/core/bars.js';
import { defaultPosition, clampPosition } from '../src/ui/overlay.js';

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

test('the pill sits right of Torn\'s content when there is room, else at the right edge; a stored spot stays on screen', () => {
    assert.deepEqual(defaultPosition(1920, 1448), { x: 1460, y: 110 });
    assert.deepEqual(defaultPosition(1280, 1128), { x: 1068, y: 110 });
    assert.deepEqual(clampPosition({ x: 5000, y: -20 }, 1280, 800), { x: 1076, y: 4 });
});
