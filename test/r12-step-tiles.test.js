/*
 * Round 9, the owner's pick 1B (mockups/round9/companion.html §1): the step's items as tiles in the panel on every
 * Torn page. Each tile says whether using the item now would work (ready, the drug cooldown, energy lost over 1,000,
 * the booster cooldown), how many you hold, and whether the Buy list's window needs more. Reads only: the tile's Show
 * goes to Torn's own row.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { stepTiles, windowWords, tornTabOf } from '../src/core/steptiles.js';
import { XANAX, ECSTASY, EDVD, CANDY_KISSES, FHC, GAME_CONSOLE, POINTS } from '../src/core/items.js';

const H = 3600e3;
// Mon 5 Oct 2026 10:00 TCT.
const NOW = Date.UTC(2026, 9, 5, 10);
const xanaxStep = { kind: 'xanax', at: NOW, label: 'Xanax #2 · train', items: [{ id: XANAX, qty: 1 }], parts: [{ stat: 'dex', trains: 27 }] };
const base = { now: NOW, inventory: { [XANAX]: 12 }, energy: { current: 150, max: 150 }, windowDays: 3 };

test('ready: the energy the Xanax gives and how many you hold', () => {
    const r = stepTiles(xanaxStep, base);
    assert.equal(r.tiles.length, 1);
    const t = r.tiles[0];
    assert.deepEqual([t.name, t.status, t.hold, t.ok, t.tone, t.low], ['Xanax', 'Ready · energy 150 → 400', 'you hold 12', true, 'green', false]);
    assert.equal(r.warn, null);
    assert.equal(r.later, null);
});

test('drug cooldown: greyed, with a countdown to its end', () => {
    const t = stepTiles(xanaxStep, { ...base, drugLeft: 1.2 * H }).tiles[0];
    assert.deepEqual([t.status, t.after, t.ok, t.tone], ['Drug cooldown · ', ' left', false, 'amber']);
    assert.equal(t.cdAt, NOW + 1.2 * H);
});

test('over 1,000: a Xanax before training would lose energy', () => {
    const t = stepTiles(xanaxStep, { ...base, energy: { current: 820, max: 150 } }).tiles[0];
    assert.deepEqual([t.status, t.ok, t.tone], ['Would lose 70 energy · train first', false, 'amber']);
    // Exactly 1,000 loses nothing.
    assert.equal(stepTiles(xanaxStep, { ...base, energy: { current: 750, max: 150 } }).tiles[0].status, 'Ready · energy 750 → 1,000');
});

test('a stack keeps its energy: the tile says the loss and never "train first"', () => {
    const stack = { kind: 'stack', at: NOW, label: 'Xanax #4 of 4 · don\'t train', items: [{ id: XANAX, qty: 1 }], trains: {} };
    const t = stepTiles(stack, { ...base, energy: { current: 790, max: 150 } }).tiles[0];
    assert.deepEqual([t.status, t.ok, t.tone], ['Loses 40 energy over 1,000', true, 'amber']);
});

test('running low: the Buy list\'s window needs more than you hold', () => {
    const r = stepTiles(xanaxStep, { ...base, inventory: { [XANAX]: 2 }, needs: [{ id: XANAX, need: 4, have: 2, buy: 2 }] });
    const t = r.tiles[0];
    assert.equal(t.status, 'Ready · energy 150 → 400');
    assert.equal(t.hold, 'you hold 2 · the plan takes 4 before Thu');
    assert.equal(t.low, true);
    assert.equal(r.warn, 'Buy 2 more before Thursday');
    // A one-day window says "today".
    assert.equal(stepTiles(xanaxStep, { ...base, windowDays: 1, inventory: { [XANAX]: 1 }, needs: [{ id: XANAX, need: 2, have: 1, buy: 1 }] }).warn, 'Buy 1 more today');
});

test('none held: red, and nothing to show', () => {
    const t = stepTiles(xanaxStep, { ...base, inventory: {} }).tiles[0];
    assert.deepEqual([t.status, t.ok, t.tone, t.hold], ['None held', false, 'red', 'you hold 0']);
});

test('what you hold is not read yet: no hold line, no guess', () => {
    const t = stepTiles(xanaxStep, { ...base, inventory: null }).tiles[0];
    assert.deepEqual([t.status, t.hold, t.ok], ['Ready · energy 150 → 400', '', true]);
});

test('a jump: the boosters first, the Ecstasy after them, ticked off from the bars', () => {
    const jump = { kind: 'jump', at: NOW, label: 'EDVD × 5 + Ecstasy, then train it all', items: [{ id: EDVD, qty: 5 }, { id: ECSTASY, qty: 1 }], parts: [{ stat: 'str', trains: 100 }] };
    const o = { ...base, boost: true, inventory: { [EDVD]: 20, [ECSTASY]: 3 }, energy: { current: 1000, max: 150 } };
    let r = stepTiles(jump, o);
    assert.deepEqual(r.tiles.map((t) => [t.name, t.status, t.ok]), [['EDVD × 5', 'Ready · all 5 fit the booster cooldown', true], ['Ecstasy', 'After the boosters', false]]);
    r = stepTiles(jump, { ...o, boosterLeft: 30 * H, done: { boosters: true } });
    assert.deepEqual(r.tiles.map((t) => [t.status, t.ok, t.done]), [['Eaten', false, true], ['Ready', true, false]]);
    r = stepTiles(jump, { ...o, boosterLeft: 30 * H, drugLeft: 3 * H, done: { boosters: true, drug: true } });
    assert.deepEqual(r.tiles.map((t) => t.status), ['Eaten', 'Taken']);
});

test('the booster cooldown: some fit, or none until it is under the cap', () => {
    const boostStep = { kind: 'boost', at: NOW, items: [{ id: CANDY_KISSES, qty: 10 }], parts: [] };
    const o = { ...base, boost: true, inventory: { [CANDY_KISSES]: 40 } };
    // 22 h used of 24: 2 h left is 4 candy, and the last one may overshoot: 5 fit.
    assert.equal(stepTiles(boostStep, { ...o, boosterLeft: 22 * H }).tiles[0].status, 'Only 5 of 10 fit the booster cooldown');
    const full = stepTiles(boostStep, { ...o, boosterLeft: 25 * H }).tiles[0];
    assert.deepEqual([full.status, full.ok, full.cdAt], ['Booster cooldown full · room in ', false, NOW + H]);
    // A cap raised by a faction perk.
    assert.equal(stepTiles(boostStep, { ...o, boosterLeft: 25 * H, capH: 48 }).tiles[0].ok, true);
});

test('an FHC fills the bar: it says to what, and warns over 1,000 never', () => {
    const fhc = { kind: 'fhc', at: NOW, items: [{ id: FHC, qty: 1 }], parts: [{ stat: 'str', trains: 15 }] };
    assert.equal(stepTiles(fhc, { ...base, inventory: { [FHC]: 30 }, energy: { current: 20, max: 150 } }).tiles[0].status, 'Ready · energy 20 → 150');
});

test('points are not a tile; a step without items has none', () => {
    assert.equal(stepTiles({ kind: 'refill', items: [{ id: POINTS, qty: 30 }] }, base), null);
    assert.equal(stepTiles({ kind: 'train', items: [], parts: [{ stat: 'str', trains: 5 }] }, base), null);
});

test('the console jump lists its console once', () => {
    const step = { kind: 'jump', at: NOW, items: [{ id: GAME_CONSOLE, qty: 0, uses: 30 }, { id: CANDY_KISSES, qty: 20 }, { id: GAME_CONSOLE, qty: 1 }, { id: ECSTASY, qty: 1 }] };
    const r = stepTiles(step, { ...base, boost: true, inventory: { [GAME_CONSOLE]: 1, [CANDY_KISSES]: 20, [ECSTASY]: 1 } });
    assert.deepEqual(r.tiles.map((t) => t.name), ['Game Console', 'Candy Kisses × 20', 'Ecstasy']);
});

test('later today: the rest of the Torn day on one line, with what you hold', () => {
    const rest = [
        { at: NOW + 4 * H, items: [{ id: EDVD, qty: 5 }, { id: ECSTASY, qty: 1 }] },
        { at: NOW + 5 * H, items: [{ id: POINTS, qty: 30 }] },
        // Tomorrow's Xanax is not today's.
        { at: NOW + 20 * H, items: [{ id: XANAX, qty: 1 }] },
    ];
    const r = stepTiles(xanaxStep, { ...base, inventory: { [XANAX]: 12, [EDVD]: 20, [ECSTASY]: 3 }, rest });
    assert.deepEqual(r.later, { text: 'Later today · EDVD × 5, Ecstasy', hold: 'you hold 20 and 3' });
});

test('the window\'s words and the Torn tab of an item', () => {
    assert.deepEqual(windowWords(NOW, 3), { long: 'before Thursday', short: 'before Thu' });
    assert.deepEqual(windowWords(NOW, 7), { long: 'before Monday', short: 'before Mon' });
    assert.deepEqual(windowWords(NOW, 1), { long: 'today', short: 'today' });
    assert.deepEqual([tornTabOf(XANAX), tornTabOf(EDVD), tornTabOf(CANDY_KISSES)], ['Drugs', 'Boosters', 'Candy']);
});
