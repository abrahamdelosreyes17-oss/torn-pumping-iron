/*
 * Round 7 (the owner, 2026-10-03): our marks are an overlay. Nothing goes into Torn's page; rings and pills are placed
 * on our own layer from Torn's rects. The placement math (ringRect, pillSpot, eyeMiniSpot) and the panel's new gym
 * lines (gymFill, gymNotes: the strip's words and Fill N moved off Torn's page).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ringRect, pillSpot, shortTab, gymFill, gymNotes, RING_PAD, VIEW_EDGE } from '../src/ui/marks/marks.js';
import { eyeMiniSpot, MINI_GAP } from '../src/ui/eye/eye-ui.js';
import { planGymPage } from '../src/core/gympage.js';
import { buildModel } from '../src/core/model.js';
import { normalizeState } from '../src/core/bars.js';

const T0 = Date.UTC(2026, 8, 29, 10, 48);

function model({ energy = 275, gymId = 18 } = {}) {
    const state = normalizeState({
        bars: { energy: { current: energy, maximum: 150, increment: 5, interval: 600, tick_time: 120 }, happy: { current: 5025, maximum: 5025, increment: 5, interval: 900, tick_time: 300 } },
        cooldowns: { drug: 3600, booster: 0 },
        refills: { energy: true },
        battlestats: { strength: { value: 118400 }, speed: { value: 110900 }, defense: { value: 96200 }, dexterity: { value: 82700 } },
        gym: { id: gymId },
    }, T0);
    return buildModel({ state, statics: {}, plan: { strategy: 'steady', build: 'balanced', goal: null }, settings: { horizonDays: 30, budget: 150e6 }, now: T0 });
}

const box = { left: 100, top: 200, width: 180, height: 150 };
// The page scrolled down 50 px: our layer's (0, 0) is 50 px above the window's top.
const scrolled = { x: 0, y: -50 };

test('ringRect: the box grown by 3 px, in page coordinates', () => {
    assert.equal(RING_PAD, 3);
    assert.deepEqual(ringRect(box, scrolled), { left: 97, top: 247, width: 186, height: 156 });
    assert.deepEqual(ringRect(box, { x: 0, y: 0 }, 2), { left: 98, top: 198, width: 184, height: 154 });
});

test('ringRect: never past the window\'s edges (nothing of ours makes Torn\'s page scroll sideways)', () => {
    const edge = { left: 0, top: 10, width: 300, height: 40 };
    const r = ringRect(edge, { x: 0, y: 0 }, 3, 300);
    assert.equal(r.left, 0);
    assert.equal(r.left + r.width, 300);
});

test('pillSpot: centred on the box, its middle on the ring\'s top edge (straddling the border)', () => {
    const p = pillSpot(box, scrolled, 120, 20);
    assert.equal(p.left, 100 + (180 - 120) / 2);
    // top border of the ring: 200 - 3 = 197 on screen; the pill's middle there: 187 on screen, 237 on the page.
    assert.equal(p.top, 237);
    assert.equal(p.maxWidth, 172);
});

test('pillSpot: a pill wider than the box is cut to the box (less 4 px a side), never over its neighbours', () => {
    const p = pillSpot({ left: 100, top: 200, width: 60, height: 40 }, { x: 0, y: 0 }, 120, 20);
    assert.equal(p.maxWidth, 52);
    assert.equal(p.left, 104);
});

test('pillSpot: a listing\'s pill sits 10 px in from its left edge; inside the window', () => {
    const p = pillSpot({ left: 300, top: 100, width: 600, height: 40 }, { x: 0, y: 0 }, 140, 20, { pad: 2, align: 'left' });
    assert.equal(p.left, 310);
    assert.equal(p.top, 100 - 2 - 10);
    const off = pillSpot({ left: -40, top: 100, width: 600, height: 40 }, { x: 0, y: 0 }, 140, 20, { viewW: 500 });
    assert.ok(off.left >= VIEW_EDGE && off.left + 140 <= 500 - VIEW_EDGE, JSON.stringify(off));
});

test('shortTab: the pill\'s two first parts, the rest on hover', () => {
    assert.equal(shortTab('Train this · 27 trains · about +1,234'), 'Train this · 27 trains');
    assert.equal(shortTab('Eat first'), 'Eat first');
    assert.equal(shortTab(null), '');
});

test('gymFill: the right gym fills 27 (the panel\'s Fill N)', () => {
    const f = gymFill(planGymPage(model(), { selectedId: 18 }));
    assert.deepEqual({ stat: f.stat, n: f.n, shown: f.shown, disabled: f.disabled }, { stat: 'dex', n: 27, shown: 27, disabled: false });
});

test('gymFill: the wrong gym waits (shows the trains, disabled, "Switch gyms first")', () => {
    const f = gymFill(planGymPage(model({ energy: 150 }), { selectedId: 6 }));
    assert.equal(f.disabled, true);
    assert.equal(f.title, 'Switch gyms first');
    assert.ok(f.shown > 0);
});

test('gymFill: no energy for one train (the Xanax first) and eat first both wait', () => {
    const noE = gymFill({ perStat: { dex: { kind: 'train', noEnergy: true, hold: true, fill: 0, fillN: 9, trains: 9, tab: 'Take the Xanax first · then DEX × 9' } } });
    assert.deepEqual({ shown: noE.shown, disabled: noE.disabled, title: noE.title }, { shown: 9, disabled: true, title: 'Take the Xanax first' });
    const eat = gymFill({ perStat: { str: { kind: 'skip' }, dex: { kind: 'train', mark: 'eat', hold: true, fill: 0, fillN: 27, trains: 27, tab: 'Eat first' } } });
    assert.deepEqual({ stat: eat.stat, shown: eat.shown, disabled: eat.disabled }, { stat: 'dex', shown: 27, disabled: true });
    assert.equal(gymFill({ perStat: { str: { kind: 'skip', tag: 'skip' } } }), null);
    assert.equal(gymFill(null), null);
});

test('gymNotes: the strip\'s words in the panel (the box\'s energy line; where you are and where to switch; the group to open)', () => {
    const right = gymNotes(planGymPage(model(), { selectedId: 18 }));
    assert.ok(right.some((n) => /^all your energy/.test(n) && !/about/.test(n)), JSON.stringify(right));
    const wrong = gymNotes(planGymPage(model({ energy: 150 }), { selectedId: 6 }), { hint: 'Open the middleweight gyms to find it' });
    assert.ok(wrong.some((n) => /^You’re in .+ · switch to Gun Shop \(DEX 6\.2\)$/.test(n)), JSON.stringify(wrong));
    assert.ok(wrong.includes('Open the middleweight gyms to find it'));
    assert.deepEqual(gymNotes({ state: { kind: 'overdose' } }), []);
    assert.deepEqual(gymNotes({ state: { kind: 'kept' }, line: { head: 'Keeping 650 energy for the jump', text: 'Xanax 2 of 4 stacked · don’t train it now' } }), ['Keeping 650 energy for the jump · Xanax 2 of 4 stacked · don’t train it now']);
});

test('eyeMiniSpot: the mini-profile\'s tag just under Torn\'s popup, as wide as it, never over it', () => {
    const pop = { left: 300, top: 100, right: 600, bottom: 400, width: 300, height: 300 };
    assert.deepEqual(eyeMiniSpot(pop, 28, 1280, 900), { x: 300, y: 400 + MINI_GAP, width: 300, side: 'below' });
});

test('eyeMiniSpot: above the popup when the window has no room under it; under it when neither fits', () => {
    const low = { left: 300, top: 600, right: 600, bottom: 890, width: 300, height: 290 };
    const s = eyeMiniSpot(low, 28, 1280, 900);
    assert.equal(s.side, 'above');
    assert.equal(s.y + 28, 600 - MINI_GAP);
    const tall = { left: 300, top: 10, right: 600, bottom: 890, width: 300, height: 880 };
    assert.equal(eyeMiniSpot(tall, 28, 1280, 900).side, 'below');
});

test('eyeMiniSpot: inside the window\'s width', () => {
    const s = eyeMiniSpot({ left: 1100, top: 100, right: 1400, bottom: 400, width: 300, height: 300 }, 28, 1280, 900);
    assert.ok(s.x >= 2 && s.x + s.width <= 1278, JSON.stringify(s));
});
