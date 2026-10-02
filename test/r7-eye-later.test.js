/*
 * Round 7, the slow Torn Eye tab (docs/sims/round7/startup.mjs): the click on the tab simulated every stored target's
 * fight inside the draw (300 targets: 0.4 s frozen, 1.9 s at 4× CPU). A list now asks with `later`: a fight not
 * worked out yet comes back `pending`, is worked out in small slices, and one redraw follows with the same numbers
 * the old way gave.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { pi } from '../src/runtime.js';
import { makeFfsClient } from '../src/api/ffscouter.js';
import { ensureFfsStats, eyeView, fightsPending, warmFights, onEye } from '../src/eye-service.js';

const ME = { str: 49.3e6, spd: 13.8e6, def: 39.5e6, dex: 39.5e6 };
pi.model = { ready: true, pc: { stats: { ...ME } }, state: { statMods: {}, life: { current: 5000, maximum: 5000 } } };

// FFScouter is down: the rows' own figures are what the cache keeps.
const down = makeFfsClient({ getKey: () => 'FfsKeyTest123456', fetchImpl: async () => { throw new Error('down'); }, sleep: async () => {} });
const ROWS = Array.from({ length: 40 }, (_, i) => ({ playerId: 7_000_000 + i, name: 'T' + i, level: 20 + i, bsEstimate: 2e6 + i * 1.5e6, fairFight: 2 }));
const redraw = () => new Promise((resolve) => onEye(resolve));

test('a list asks later: nothing is simulated in the draw, the fights follow in slices, then one redraw', async () => {
    await ensureFfsStats(ROWS, down);
    const drawn = redraw();
    const first = ROWS.map((r) => eyeView(r.playerId, { level: r.level, name: r.name }, { later: true }));
    assert.ok(first.every((v) => v && v.pending && v.forecast === null && v.band === 'none'), 'every row comes back pending, with no fight yet');
    assert.ok(first.every((v) => v.est && v.name), 'what needs no fight is there: the estimate and the name');
    assert.equal(fightsPending(), true);
    await drawn;
    assert.equal(fightsPending(), false);
    const second = ROWS.map((r) => eyeView(r.playerId, { level: r.level, name: r.name }, { later: true }));
    assert.ok(second.every((v) => !v.pending && v.forecast && v.band !== 'none'), 'after the redraw every row has its fight');
});

test('the fight worked out later is the fight worked out at once', async () => {
    const a = { playerId: 7_100_001, name: 'A', level: 44, bsEstimate: 30e6, fairFight: 2 };
    await ensureFfsStats([a], down);
    const drawn = redraw();
    assert.equal(eyeView(a.playerId, { level: a.level }, { later: true }).pending, true);
    await drawn;
    const later = eyeView(a.playerId, { level: a.level }, { later: true });
    // The same player under another id is simulated with another seed, so compare the same id: forget nothing, ask at once.
    const now = eyeView(a.playerId, { level: a.level });
    assert.deepEqual(later.forecast, now.forecast);
    assert.equal(later.band, now.band);
    assert.equal(now.pending, false);
});

test('a card (no `later`) still gets its fight at once', async () => {
    const b = { playerId: 7_100_002, name: 'B', level: 30, bsEstimate: 12e6, fairFight: 2 };
    await ensureFfsStats([b], down);
    const v = eyeView(b.playerId, { level: b.level });
    assert.equal(v.pending, false);
    assert.ok(v.forecast && Number.isFinite(v.forecast.pWin));
});

test('warming needs your stats and the cache; without an idle callback (node) the fights wait for the tab', async () => {
    const c = { playerId: 7_100_003, name: 'C', level: 30, bsEstimate: 9e6, fairFight: 2 };
    await ensureFfsStats([c], down);
    assert.equal(warmFights([{ id: c.playerId, extra: { level: c.level } }]), true);
    assert.equal(fightsPending(), true, 'queued, not simulated');
    const drawn = redraw();
    // The tab opens: its draw takes over what is left.
    eyeView(c.playerId, { level: c.level }, { later: true });
    await drawn;
    assert.equal(eyeView(c.playerId, { level: c.level }, { later: true }).pending, false);
});

test('one player in two lists settles: a war row (it knows their life) does not send the target row back to pending', async () => {
    // Found by ux-check: with one result kept per player, the war row's fight replaced the target row's, the target
    // row queued it again, and the page redrew for ever.
    const d = { playerId: 7_100_004, name: 'D', level: 40, bsEstimate: 20e6, fairFight: 2 };
    await ensureFfsStats([d], down);
    const drawn = redraw();
    eyeView(d.playerId, { level: d.level }, { later: true });
    await drawn;
    const war = eyeView(d.playerId, { level: d.level, life: 9000 }, { war: true });
    assert.equal(war.pending, false);
    assert.equal(eyeView(d.playerId, { level: d.level }, { later: true }).pending, false);
    assert.equal(fightsPending(), false);
});
