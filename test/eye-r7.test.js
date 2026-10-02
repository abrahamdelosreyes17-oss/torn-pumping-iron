/*
 * Round 7, Torn Eye (ROUND7-PLAN §3 I). Each block names the report it answers and the cause it pins.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { pi } from '../src/runtime.js';
import { set } from '../src/platform/store.js';
import { warBandTable, warBandOf, WAR_BANDS_MAX, WAR_BANDS_KEEP_MS } from '../src/core/eye/war.js';
import { eyeView, eyeReady, loadEyeCache, sharedView, onEye, WAR_BANDS_KEY } from '../src/eye-service.js';

const ME = { str: 49.3e6, spd: 13.8e6, def: 39.5e6, dex: 39.5e6 };

/* ---- I.1: war and faction rows said "No data" on Torn's faction page ---- */

test('the stored estimates load without asking about anybody, and the page is told once', async () => {
    pi.model = { ready: true, pc: { stats: { ...ME } }, state: { statMods: {}, life: { current: 5000, maximum: 5000 } } };
    // The cause: a view needs the cache, and only asking about a player loaded it (a faction page asks about nobody).
    assert.equal(eyeReady(), false);
    assert.equal(eyeView(424242, { level: 64 }), null, 'no cache, no view: the row said "No data"');
    let told = 0;
    onEye(() => told++);
    const [a, b] = await Promise.all([loadEyeCache(), loadEyeCache()]);
    assert.equal(eyeReady(), true);
    assert.deepEqual([a, b], [true, false], 'two callers, one load');
    assert.equal(told, 1);
    assert.equal(await loadEyeCache(), false, 'already loaded: nothing to do, nobody told');
    assert.equal(told, 1);
    const v = eyeView(424242, { level: 64 });
    assert.ok(v && v.band === 'none' && v.est === null, 'a player nothing is known about has no band (and gets no chip)');
});

test('war mode\'s bands as a small table: no "No data" rows, a cap, whole numbers', () => {
    const t = warBandTable(
        [
            { id: 1, band: 'stomp', win: 99.6, keep: 91.2 },
            { id: 2, band: 'cant', win: 12, keep: null },
            { id: 3, band: 'none', win: null, keep: null },
            { id: 0, band: 'good', win: 95, keep: 60 },
            { id: 5, band: 'whatever', win: 95, keep: 60 },
        ],
        { fid: 7777, now: 1000 },
    );
    assert.deepEqual(t, { at: 1000, fid: 7777, p: { 1: ['stomp', 100, 91], 2: ['cant', 12, null] } });
    const many = warBandTable(Array.from({ length: 400 }, (_, i) => ({ id: i + 1, band: 'good', win: 95, keep: 60 })), { fid: 1, now: 1 });
    assert.equal(Object.keys(many.p).length, WAR_BANDS_MAX);
    assert.ok(JSON.stringify(many).length < 4000, 'small enough for shared storage (' + JSON.stringify(many).length + ' characters)');
});

test('a band from the table: there, not too old, never "No data"', () => {
    const t = warBandTable([{ id: 9, band: 'good', win: 93, keep: 55 }], { fid: 1, now: 5000 });
    assert.deepEqual(warBandOf(t, 9, 6000), { band: 'good', win: 93, keep: 55, at: 5000 });
    assert.equal(warBandOf(t, '9', 6000).band, 'good');
    assert.equal(warBandOf(t, 10, 6000), null);
    assert.equal(warBandOf(t, 9, 5000 + WAR_BANDS_KEEP_MS), null, 'a day old: not shown');
    assert.equal(warBandOf(null, 9, 6000), null);
    assert.equal(warBandOf({ at: 5000, p: { 9: ['none', null, null] } }, 9, 6000), null);
    assert.equal(warBandOf({ at: 5000, p: { 9: 'good' } }, 9, 6000), null);
});

test('Torn\'s page shows what war mode read for a player it holds no estimate for', () => {
    const now = Date.now();
    assert.equal(sharedView(515151, { name: 'Flyer', level: 40 }, now), null, 'nothing shared yet');
    set(WAR_BANDS_KEY, warBandTable([{ id: 515151, band: 'good', win: 93, keep: 55 }, { id: 777001, band: 'cant', win: 4, keep: null }], { fid: 7777, now: now - 60000 }));
    const v = sharedView(515151, { name: 'Flyer', level: 40 }, now);
    assert.equal(v.band, 'good');
    assert.equal(v.name, 'Flyer');
    assert.equal(v.est, null);
    assert.deepEqual(v.forecast, { pWin: 0.93, keep: 0.55, turns: null });
    assert.equal(v.figures, 'win 93% · keep ~55%');
    assert.equal(v.shared.at, now - 60000);
    assert.equal(sharedView(777001, {}, now).figures, 'win 4%');
    assert.equal(sharedView(424242, {}, now), null);
});
