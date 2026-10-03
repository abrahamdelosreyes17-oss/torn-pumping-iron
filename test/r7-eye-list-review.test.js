/*
 * Round 7 review of Torn Eye › Targets: each finding shown by a test first, then fixed.
 *   1. a fresh status read beats FFScouter's stored hospital out-time (the list is up to 6 h old);
 *   2. the order compares what the row shows, so its tie-breaks apply (Targets, the stored list, War);
 *   3. statuses read and redrawn only while Targets shows, with FFScouter connected;
 *   4. a status answer doesn't rewrite the whole eye cache (lazy save, own file: r7-eye-save.test.js);
 *   6. a hospital row is asked again 10 min after its last read, not at the stay's end;
 *   7. a jail read ends at its own out-time;
 *   8. the progress line counts only rows actually read;
 *   9. your attacks read again once, a few minutes after an attack page was opened.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { pi } from '../src/runtime.js';
import { K, get, set, setKey } from '../src/platform/store.js';
import { attacksDueAt, attacksAfterOpen, ATTACKS_AFTER_OPEN_MS } from '../src/eye-service.js';
import { targetStatus, knownStatus, rowState, isReadyNow, listTargets, byOrder, byStored, statusesToAsk, statusChecked, statusProgress, statusLine, STATUS_REFRESH_MS, OWN_HIT_MS } from '../src/core/eye/targets.js';
import { sortWar } from '../src/core/eye/war.js';
import { readsTargetStatuses, eyeModeOf } from '../src/ui/app/eye-tab.js';

const T0 = Date.parse('2026-10-03T12:00:00Z');
const MIN = 60000;
const S = (ms) => Math.floor(ms / 1000);

test('1. a status read newer than the list beats its stored hospital out-time (revived early, read Okay)', () => {
    const listAt = T0 - 2 * 3600e3;
    const hospitalUntil = T0 + 3 * 3600e3;
    // Read "Okay" 5 min ago, after the list was asked: no longer in hospital, shown by "Ready now".
    const okay = targetStatus([{ status: { state: 'Okay', description: 'Okay', until: 0 }, at: T0 - 5 * MIN }], { listAt, hospitalUntil, now: T0 });
    assert.equal(okay.hospitalUntil, null);
    const row = { id: 1, band: 'good', respect: 2, forecast: { keep: 0.8, pWin: 1 }, ...okay };
    assert.equal(rowState(row, T0), 'okay');
    assert.equal(isReadyNow(row, T0), true);
    assert.deepEqual(listTargets([row], { ready: true, now: T0 }).rows.map((r) => r.id), [1]);
    // No read since the list: its out-time stands.
    const none = targetStatus([null], { listAt, hospitalUntil, now: T0 });
    assert.equal(none.hospitalUntil, hospitalUntil);
    assert.equal(rowState({ ...row, ...none }, T0), 'hospital');
    // A read older than the list (from yesterday's pass) doesn't beat it either.
    const older = targetStatus([{ status: { state: 'Okay' }, at: listAt - 10 * MIN }], { listAt, hospitalUntil, now: T0 });
    assert.equal(older.hospitalUntil, hospitalUntil);
    assert.equal(rowState({ ...row, ...older }, T0), 'hospital');
    // A newer hospital read: its own out-time is the one shown.
    const hosp = targetStatus([{ status: { state: 'Hospital', description: 'In hospital', until: S(T0 + 20 * MIN) }, at: T0 - MIN }], { listAt, hospitalUntil, now: T0 });
    assert.equal(hosp.hospitalUntil, null);
    assert.equal(rowState({ ...row, ...hosp }, T0), 'hospital');
});

test('2. the order compares what the row shows: respect to 2 decimals, then HP kept, then win, in whole percents', () => {
    const r = (id, respect, keep, pWin) => ({ id, band: 'good', respect, forecast: { keep, pWin } });
    // Both read "3.00": HP kept decides (it was the third decimal of respect).
    assert.deepEqual([r(1, 3.004, 0.7, 1), r(2, 3.001, 0.9, 1)].sort(byOrder).map((x) => x.id), [2, 1]);
    // Both read "3.00" and "80%": the win decides.
    assert.deepEqual([r(1, 3.004, 0.804, 0.9), r(2, 3.001, 0.801, 0.99)].sort(byOrder).map((x) => x.id), [2, 1]);
    // A real respect difference still comes first.
    assert.deepEqual([r(1, 3.0, 1, 1), r(2, 3.01, 0.5, 0.6)].sort(byOrder).map((x) => x.id), [2, 1]);
    // The stored list (whole percents) the same way.
    assert.deepEqual([{ id: 1, respect: 2.004, keep: 70, win: 100 }, { id: 2, respect: 2.001, keep: 90, win: 90 }].sort(byStored).map((x) => x.id), [2, 1]);
    assert.deepEqual([{ id: 1, respect: 2.004, keep: 80, win: 90 }, { id: 2, respect: 2.001, keep: 80, win: 95 }, { id: 3, respect: 2.002, keep: null, win: 99 }].sort(byStored).map((x) => x.id), [2, 1, 3]);
    // War: within a band too.
    const members = [1, 2, 3].map((id) => ({ id, status: { state: 'Okay' } }));
    const order = sortWar(members, { bands: { 1: 'good', 2: 'good', 3: 'good' }, respect: { 1: 3.004, 2: 3.001, 3: 3.002 }, keep: { 1: 0.7, 2: 0.9, 3: 0.9 }, win: { 1: 1, 2: 0.95, 3: 0.951 }, nowS: S(T0) });
    assert.deepEqual(order.map((x) => x.id), [2, 3, 1]);
    // War keeps its own rules: band before respect, attackable before hospital.
    const w2 = sortWar([{ id: 4, status: { state: 'Okay' } }, { id: 5, status: { state: 'Okay' } }, { id: 6, status: { state: 'Hospital', until: S(T0) + 60 } }], { bands: { 4: 'good', 5: 'stomp', 6: 'stomp' }, respect: { 4: 9, 5: 1, 6: 9 }, nowS: S(T0) });
    assert.deepEqual(w2.map((x) => x.id), [5, 4, 6]);
});

test('3. statuses are read (and redrawn for) only while Targets shows, with FFScouter connected', () => {
    assert.equal(readsTargetStatuses({ tab: 'eye', ui: { eyeMode: 'targets' }, hasFfs: true }), true);
    assert.equal(readsTargetStatuses({ tab: 'eye', ui: {}, hasFfs: true }), true, 'Targets is the default view');
    assert.equal(readsTargetStatuses({ tab: 'eye', ui: { eyeMode: 'chain' }, hasFfs: true }), true, 'a mode of an older version shows Targets');
    assert.equal(readsTargetStatuses({ tab: 'eye', ui: { eyeMode: 'war' }, hasFfs: true }), false);
    assert.equal(readsTargetStatuses({ tab: 'eye', ui: { eyeMode: 'watched' }, hasFfs: true }), false);
    assert.equal(readsTargetStatuses({ tab: 'home', ui: { eyeMode: 'targets' }, hasFfs: true }), false);
    assert.equal(readsTargetStatuses({ tab: 'eye', ui: { eyeMode: 'targets' }, hasFfs: false }), false);
    assert.equal(eyeModeOf({ eyeMode: 'war' }), 'war');
});

test('6. a hospital row is asked again 10 min after its last read, not only when the stay ends', () => {
    const until = S(T0 + 3 * 3600e3);
    const read = { status: { state: 'Hospital', description: 'In hospital', until }, at: T0 - 11 * MIN };
    const ts = targetStatus([read], { now: T0 });
    assert.equal(ts.statusAt, T0 - 11 * MIN, 'the last read, not until − 10 min');
    assert.deepEqual(statusesToAsk({ order: [7], readAt: () => ts.statusAt, now: T0 }).ask, [7]);
    // Read 5 min ago: not yet.
    const recent = targetStatus([{ ...read, at: T0 - 5 * MIN }], { now: T0 });
    assert.deepEqual(statusesToAsk({ order: [7], readAt: () => recent.statusAt, now: T0 }).ask, []);
    assert.ok(STATUS_REFRESH_MS === 10 * MIN);
});

test('7. a jail read ends at its own out-time, like hospital', () => {
    const jail = (untilMs, at) => ({ status: { state: 'Jail', description: 'In jail', until: S(untilMs) }, at });
    assert.equal(knownStatus([jail(T0 - MIN, T0 - 5 * MIN)], { now: T0 }), null, 'out a minute ago: no longer jail');
    assert.equal(knownStatus([jail(T0 + 2 * 3600e3, T0 - 40 * MIN)], { now: T0 }).state, 'jail', 'a long stay is believed until it ends');
    // A row holding an old jail read: not jail, not hidden by "Ready now".
    const row = { id: 3, band: 'fair', status: jail(T0 - MIN, T0 - 5 * MIN).status };
    assert.equal(rowState(row, T0), 'unknown');
    assert.equal(isReadyNow(row, T0), true);
    assert.equal(rowState({ ...row, status: jail(T0 + MIN, T0).status }, T0), 'jail');
    // The same for a hospital read past its time.
    assert.equal(rowState({ id: 4, status: { state: 'Hospital', until: S(T0 - MIN) } }, T0), 'unknown');
});

test('8. the progress line counts only rows whose status was read', () => {
    const rows = [
        { id: 1, status: { state: 'Okay', description: 'Okay' } },
        { id: 2, hospitalUntil: T0 + 30 * MIN, status: null },
        { id: 3, hit: { kind: 'hit', at: T0 - MIN, result: 'Hospitalized' }, status: null },
        { id: 4, status: null },
        { id: 5, status: { state: 'Jail', until: S(T0 - MIN) } },
    ];
    assert.deepEqual(rows.map((r) => statusChecked(r, T0)), [true, false, false, false, false]);
    const p = statusProgress(rows.map((r) => r.id), (id) => statusChecked(rows.find((r) => r.id === id), T0));
    assert.equal(statusLine(p), 'Statuses: 1 of 5 checked · this page first · the rest in about 1 min');
});

test('9. your attacks read again once, 3 min after an attack page was opened (not hourly, not in a loop)', async () => {
    // Pure: the earliest open not covered by a read made 3 min after it, once that time has come.
    const opens = [{ def: 1, at: T0 - 4 * MIN }, { def: 2, at: T0 - MIN }];
    assert.equal(attacksDueAt(opens, T0 - 30 * MIN, T0), T0 - MIN, 'the first open is due');
    assert.equal(attacksDueAt(opens, T0 - MIN + 1000, T0), null, 'a read after it covers it; the second is not due yet');
    assert.equal(attacksDueAt(opens, T0 - MIN + 1000, T0 + 2 * MIN), T0 + 2 * MIN);
    assert.equal(attacksDueAt([{ def: 1, at: T0 - OWN_HIT_MS }], 0, T0), null, 'older than an hour: nothing to show');
    assert.equal(attacksDueAt([{ def: 1, at: T0 - MIN }], 0, T0), null, 'opened a minute ago: not yet');

    // The read itself: one /user/attacks call through the shared client, then quiet.
    setKey(K.apiKey, 'HarnessKey123456');
    set(K.apiKeyDead, false);
    const now = Date.now();
    const calls = [];
    pi.client = {
        get: async (path) => {
            calls.push(path);
            return { attacks: [{ attacker: { id: 0 }, defender: { id: 9001, level: 20 }, ended: S(now - 2 * MIN), result: 'Hospitalized', respect_gain: 2 }] };
        },
    };
    // Your attacks were read 20 min ago (fresh for the hourly rule), an attack page opened 4 min ago.
    set('myAttacks', { at: now - 20 * MIN, list: [], incoming: [] });
    set(K.eyePredictions, [{ def: 9001, at: now - 4 * MIN, pWin: 0.9, keep: 0.8 }]);
    assert.equal(await attacksAfterOpen(now), true);
    assert.deepEqual(calls, ['v2/user/attacks']);
    assert.ok(((get('myAttacks', null) || {}).list || []).some((a) => a.def === 9001), 'the hit is in');
    // Covered: no second read, even after the gap.
    assert.equal(await attacksAfterOpen(now + 1000), false);
    assert.equal(await attacksAfterOpen(now + ATTACKS_AFTER_OPEN_MS + 1000), false);
    assert.equal(calls.length, 1);
});
