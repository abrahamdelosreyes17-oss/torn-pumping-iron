/*
 * Round 7, Torn Eye (ROUND7-PLAN §3 I). Each block names the report it answers and the cause it pins.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { pi } from '../src/runtime.js';
import { set } from '../src/platform/store.js';
import { warBandTable, warBandOf, WAR_BANDS_MAX, WAR_BANDS_KEEP_MS } from '../src/core/eye/war.js';
import { eyeView, eyeReady, loadEyeCache, sharedView, onEye, WAR_BANDS_KEY } from '../src/eye-service.js';
import { knownStatus, STATUS_FRESH_MS, ownHits, hitText, OWN_HIT_MS, ATTACK_OPENED_MS } from '../src/core/eye/targets.js';
import { filterTargets, stateOf } from '../src/ui/app/eye-tab.js';

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

/* ---- I.6 (b): players abroad or travelling shown as targets ---- */

const T0 = Date.parse('2026-10-02T12:00:00Z');
const MIN = 60000;

test('the cause: a stored target has no status of its own, so it read as Okay and "Hide traveling" kept it', () => {
    // A row as the Torn Eye tab builds it from the stored list: FFScouter's list carries no status, and nothing reads one.
    const row = { id: 1, band: 'good', forecast: { pWin: 0.95, keep: 0.8 }, hospitalUntil: null, status: null };
    assert.equal(stateOf(row, T0), 'unknown', 'not "okay": nothing was read');
    assert.deepEqual(filterTargets([row], { hideTravel: true }, { now: T0 }).map((r) => r.id), [1], 'nothing known: it can only stay');
    // The same player, seen flying by the watch list 5 minutes ago.
    const st = knownStatus([{ status: { state: 'Traveling', description: 'Traveling to Mexico' }, at: T0 - 5 * MIN }], { now: T0 });
    assert.equal(st.state, 'travel');
    assert.deepEqual(filterTargets([{ ...row, status: st.status }], { hideTravel: true }, { now: T0 }), []);
    assert.equal(stateOf({ ...row, status: st.status }, T0), 'travel');
});

test('what was already read about a player: the newest read wins, and an old one is dropped', () => {
    const okay = { state: 'Okay', description: 'Okay' };
    const abroad = { state: 'Abroad', description: 'In Mexico' };
    assert.equal(knownStatus([], { now: T0 }), null);
    assert.equal(knownStatus([{ status: null, at: T0 }, null], { now: T0 }), null);
    // Watch list read 2 min ago (Okay) against a war read 10 min ago (abroad): the newer one.
    assert.equal(knownStatus([{ status: abroad, at: T0 - 10 * MIN }, { status: okay, at: T0 - 2 * MIN }], { now: T0 }).state, 'okay');
    assert.equal(knownStatus([{ status: abroad, at: T0 - 10 * MIN }], { now: T0 }).state, 'travel');
    assert.equal(knownStatus([{ status: abroad, at: T0 - STATUS_FRESH_MS - 1 }], { now: T0 }), null, 'too old to say');
    assert.equal(knownStatus([{ status: okay, at: T0 - STATUS_FRESH_MS - 1 }], { now: T0 }), null);
    // Hospital is believed until its own time, however old the read.
    const hosp = { state: 'Hospital', description: 'In hospital', until: (T0 + 40 * MIN) / 1000 };
    assert.equal(knownStatus([{ status: hosp, at: T0 - 3 * 3600000 }], { now: T0 }).state, 'hospital');
    assert.equal(knownStatus([{ status: { ...hosp, until: (T0 - MIN) / 1000 }, at: T0 - 3 * 3600000 }], { now: T0 }), null, 'out by now: not known');
    // A flight is believed until it lands (Mexico: 26 min), then for the usual quarter of an hour at most.
    const fly = { state: 'Traveling', description: 'Traveling to Mexico' };
    assert.equal(knownStatus([{ status: fly, at: T0 - 20 * MIN }], { now: T0 }).state, 'travel');
    assert.equal(knownStatus([{ status: fly, at: T0 - 40 * MIN }], { now: T0 }), null);
    // A flight first seen by the war or watch reads counts as a read of its own.
    assert.equal(knownStatus([], { flight: { desc: 'Traveling to Japan', at: T0 - 100 * MIN }, now: T0 }).state, 'travel');
    assert.equal(knownStatus([], { flight: { desc: 'In Japan', at: T0 - 100 * MIN }, now: T0 }), null);
    assert.equal(knownStatus([{ status: okay, at: T0 - MIN }], { flight: { desc: 'Traveling to Japan', at: T0 - 100 * MIN }, now: T0 }).state, 'okay', 'seen back since');
});

/* ---- backlog: a player you just put in hospital was still listed ---- */

test('your own hit: a player you beat in the last hour, from your attacks (no call)', () => {
    const s = (ms) => Math.floor(ms / 1000);
    const attacks = [
        { def: 5, ended: s(T0 - 12 * MIN), result: 'Hospitalized' },
        { def: 5, ended: s(T0 - 300 * MIN), result: 'Mugged' },
        { def: 6, ended: s(T0 - 20 * MIN), result: 'Lost' },
        { def: 7, ended: s(T0 - OWN_HIT_MS - MIN), result: 'Attacked' },
        { def: 8, ended: s(T0 - 3 * MIN), result: 'Mugged' },
    ];
    const hits = ownHits(attacks, [], T0);
    assert.deepEqual(hits.get(5), { kind: 'hit', at: T0 - 12 * MIN, result: 'Hospitalized' });
    assert.equal(hits.has(6), false, 'a lost fight put nobody in hospital');
    assert.equal(hits.has(7), false, 'over an hour ago');
    assert.equal(hits.get(8).result, 'Mugged');
    assert.equal(hitText(hits.get(5), T0), 'You hospitalized them 12 min ago');
    assert.equal(hitText(hits.get(8), T0), 'You mugged them 3 min ago');
    assert.equal(hitText({ kind: 'hit', at: T0 - 5 * MIN, result: 'Attacked' }, T0), 'You beat them 5 min ago');
});

test('your attacks are read hourly: until then, the attack page you opened marks the row', () => {
    const preds = [{ def: 9, at: T0 - 4 * MIN, pWin: 0.9, keep: 0.8 }, { def: 10, at: T0 - ATTACK_OPENED_MS - MIN, pWin: 0.9, keep: 0.8 }];
    const hits = ownHits([], preds, T0);
    assert.deepEqual(hits.get(9), { kind: 'opened', at: T0 - 4 * MIN, result: null });
    assert.equal(hits.has(10), false);
    assert.equal(hitText(hits.get(9), T0), 'Attack opened 4 min ago');
    // Once the attack itself is read, it says what happened.
    const both = ownHits([{ def: 9, ended: Math.floor((T0 - 3 * MIN) / 1000), result: 'Attacked' }], preds, T0);
    assert.equal(both.get(9).kind, 'hit');
});

test('a player you just hit is greyed, counts as in hospital for the ticks, and is never the row to attack first', () => {
    const rows = [
        { id: 5, band: 'stomp', forecast: { pWin: 1, keep: 1 }, hit: { kind: 'hit', at: T0 - 12 * MIN, result: 'Hospitalized' } },
        { id: 9, band: 'good', forecast: { pWin: 1, keep: 0.8 }, hit: { kind: 'opened', at: T0 - 4 * MIN, result: null } },
        { id: 11, band: 'good', forecast: { pWin: 1, keep: 0.8 } },
    ];
    assert.equal(stateOf(rows[0], T0), 'hospital');
    assert.equal(stateOf(rows[1], T0), 'unknown', 'an opened attack page is not a hit');
    assert.deepEqual(filterTargets(rows, { hideHosp: true }, { now: T0 }).map((r) => r.id), [9, 11]);
    assert.deepEqual(filterTargets(rows, {}, { now: T0 }).map((r) => r.id), [5, 9, 11], 'greyed, not hidden, without the tick');
});
