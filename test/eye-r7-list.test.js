/*
 * Round 7, Torn Eye › Targets (mockups/round7/torn-eye-targets.html, picked by the owner): the bands by HP kept, one
 * order everywhere, the band chips and "Ready now", 20 rows a page, and the statuses read the Torn Trading way
 * (its updateSellPresence: this page first, 3 at once, 30 a minute, each again after 10 min, the one opened to
 * attack after 90 s). Pure functions with a clock passed in.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { pi } from '../src/runtime.js';
import { K, set, setKey } from '../src/platform/store.js';
import { pumpStatuses, statusRead, onStatus, loadStatuses } from '../src/eye-service.js';

import {
    byStored,
    cutTargets,
    splitTargets,
    dropHits,
    ACTIVE_MAX,
    RESERVE_MAX,
    LIST_MAX,
    GONE_KEEP_MS,
    byOrder,
    listTargets,
    isReadyNow,
    pageOf,
    pagerItems,
    PAGE_SIZE,
    statusOrder,
    statusesToAsk,
    statusProgress,
    statusLine,
    mergeStatuses,
    selectTargets,
    STATUS_REFRESH_MS,
    STATUS_OPEN_REFRESH_MS,
    STATUS_PER_MIN,
    STATUS_MAX_PENDING,
    STATUS_KEEP,
    OWN_HIT_MS,
} from '../src/core/eye/targets.js';

const T0 = Date.parse('2026-10-03T12:00:00Z');
const MIN = 60000;
const row = (id, band, respect, keep, win, extra = {}) => ({ id, band, respect, forecast: { keep, pWin: win }, ...extra });

test('one order everywhere (the owner, 2026-10-03): band first (Stomp, Good, Fair), then respect, HP kept, win', () => {
    const rows = [row(1, 'good', 3, 0.8, 1), row(2, 'stomp', 3, 1, 0.99), row(3, 'fair', 4, 0.5, 0.7), row(4, 'stomp', 3, 1, 1), row(5, 'good', 3, 0.8, 0.9), row(6, 'stomp', 2.5, 1, 1), row(7, 'good', 3.5, 0.75, 1)];
    // A Fair with the most respect still comes after every Stomp and Good.
    assert.deepEqual([...rows].sort(byOrder).map((r) => r.id), [4, 2, 6, 7, 1, 5, 3]);
    // The stored list (whole percents) the same way.
    const stored = [{ id: 1, band: 'good', respect: 2, keep: 80, win: 100 }, { id: 2, band: 'good', respect: 2, keep: 90, win: 90 }, { id: 3, band: 'fair', respect: 2.5, keep: 50, win: 60 }, { id: 4, band: 'good', respect: 2, keep: 90, win: 95 }, { id: 5, band: 'stomp', respect: 1.2, keep: 100, win: 100 }];
    assert.deepEqual([...stored].sort(byStored).map((r) => r.id), [5, 4, 2, 1, 3]);
    // What is stored follows it, and only Stomp, Good and Fair are kept.
    const judge = (r) => ({ band: r.b, respect: r.respect, keep: r.keep, win: r.win });
    const { kept, dropped } = selectTargets([{ playerId: 1, b: 'fair', respect: 3, keep: 55, win: 100 }, { playerId: 2, b: 'low', respect: 9, keep: 30, win: 100 }, { playerId: 3, b: 'good', respect: 2, keep: 80, win: 100 }, { playerId: 4, b: 'none' }], judge);
    assert.deepEqual(kept.map((r) => r.playerId), [3, 1]);
    assert.deepEqual(dropped, { low: 1, none: 1, range: 0 });
});

test('100 + 100: an older stored list of 600 is cut to the active 100 and a reserve of 100, in the new order', () => {
    const bands = ['fair', 'good', 'stomp'];
    // 600 rows as round 7's first lists stored them (most respect first, bands mixed).
    const old = Array.from({ length: 600 }, (_, i) => ({ playerId: 9000 + i, band: bands[i % 3], respect: 6 - i / 200, keep: 60 + (i % 3) * 20, win: 100 }));
    const cut = cutTargets(old, { now: T0 });
    assert.equal(cut.length, LIST_MAX);
    assert.equal(LIST_MAX, ACTIVE_MAX + RESERVE_MAX);
    assert.deepEqual([ACTIVE_MAX, RESERVE_MAX], [100, 100]);
    // All 200 Stomps first (there are 200 of 600), most respect first.
    assert.ok(cut.every((r) => r.band === 'stomp'), 'the 200 Stomps fill it');
    assert.ok(cut.every((r, i) => i === 0 || r.respect <= cut[i - 1].respect));
    // A player hit lately stays out.
    const gone = { [cut[0].playerId]: T0 - 60000 };
    assert.equal(cutTargets(old, { gone, now: T0 })[0].playerId, cut[1].playerId);
    assert.equal(cutTargets(old, { gone: { [cut[0].playerId]: T0 - GONE_KEEP_MS - 1 }, now: T0 })[0].playerId, cut[0].playerId, 'not for ever');
    // The live split: the first 100 shown, the next 100 the reserve; a row under 50% or one you hit is not listed.
    const live = Array.from({ length: 230 }, (_, i) => row(i + 1, i === 0 ? 'low' : i < 120 ? 'stomp' : 'good', 5 - i / 100, 1, 1, i === 1 ? { hit: { kind: 'hit', at: T0 } } : i === 2 ? { hit: { kind: 'opened', at: T0 } } : {}));
    const s = splitTargets(live);
    assert.equal(s.active.length, 100);
    assert.equal(s.reserve.length, 100);
    assert.equal(s.active[0].id, 3, 'the low row and the one you hit are out; an attack page opened is not a hit');
    assert.ok(s.active.every((r, i) => i === 0 || byOrder(s.active[i - 1], r) <= 0));
    assert.equal(s.reserve[0].id, 103, 'the next one in the order is the first of the reserve');
});

test('hit → drop: a player you hit drops out of the stored list and is remembered, an opened attack page is not', () => {
    const stored = { at: T0 - 3600e3, list: [{ playerId: 1, band: 'stomp' }, { playerId: 2, band: 'stomp' }, { playerId: 3, band: 'good' }], gone: { 77: T0 - GONE_KEEP_MS - 1, 78: T0 - 1000 } };
    const hits = new Map([[2, { kind: 'hit', at: T0 - 60000, result: 'Hospitalized' }], [3, { kind: 'opened', at: T0 - 60000 }]]);
    const out = dropHits(stored, hits, T0);
    assert.deepEqual(out.list.map((r) => r.playerId), [1, 3]);
    assert.deepEqual(Object.keys(out.gone).sort(), ['2', '78'], 'the hit remembered; an old one forgotten');
    assert.equal(dropHits(stored, new Map([[3, { kind: 'opened', at: T0 }]]), T0), null, 'nothing to drop: nothing written');
    assert.equal(dropHits(null, hits, T0), null);
});

test('the chips: counts of every listed row, one band, and "Ready now" hiding hospital, away, jail and your hits', () => {
    const okay = { status: { state: 'Okay', description: 'Okay' } };
    const rows = [
        row(1, 'stomp', 3, 1, 1, okay),
        row(2, 'stomp', 2, 1, 1, { status: { state: 'Hospital', description: 'In hospital', until: (T0 + 30 * MIN) / 1000 } }),
        row(3, 'good', 5, 0.8, 1, { status: { state: 'Traveling', description: 'Traveling to Japan' } }),
        row(4, 'good', 4, 0.8, 1, { status: { state: 'Abroad', description: 'In Japan' } }),
        row(5, 'fair', 1, 0.6, 1, { status: { state: 'Jail', description: 'In jail' } }),
        row(6, 'fair', 6, 0.6, 1, { hit: { kind: 'hit', at: T0 - 10 * MIN, result: 'Hospitalized' } }),
        row(7, 'fair', 7, 0.6, 1, { hit: { kind: 'opened', at: T0 - 2 * MIN, result: null } }),
        row(8, 'good', 0.5, 0.8, 1, { hospitalUntil: T0 + 5 * MIN }),
        row(9, 'good', 0.4, 0.8, 1),
        row(10, 'low', 9, 0.3, 1, okay),
        row(11, 'none', 9, null, null),
    ];
    const all = listTargets(rows, { ready: false, now: T0 });
    assert.deepEqual(all.counts, { all: 9, stomp: 2, good: 4, fair: 3 });
    assert.equal(all.hidden, 0);
    assert.deepEqual(all.rows.map((r) => r.id), [1, 2, 3, 4, 8, 9, 7, 6, 5], 'band first, then respect');
    const ready = listTargets(rows, { now: T0 });
    assert.deepEqual(ready.rows.map((r) => r.id), [1, 9, 7], 'an opened attack page is not a hit; nothing read stays');
    assert.equal(ready.hidden, 6);
    assert.deepEqual(ready.counts, all.counts, 'the chips count before "Ready now"');
    const good = listTargets(rows, { band: 'good', now: T0 });
    assert.deepEqual(good.rows.map((r) => r.id), [9]);
    assert.equal(good.hidden, 3);
    assert.deepEqual(listTargets(rows, { band: 'tough', ready: false, now: T0 }).rows.length, 9, 'an unknown chip is All');
    // A hit over an hour ago is no longer hidden (your attacks drop it: ownHits).
    assert.equal(isReadyNow(row(1, 'good', 1, 1, 1, { hit: null }), T0), true);
    assert.equal(OWN_HIT_MS, 60 * MIN);
});

test('20 rows a page, clamped, and the pager\'s numbers', () => {
    const rows = Array.from({ length: 605 }, (_, i) => i);
    const p = pageOf(rows, 0);
    assert.equal(PAGE_SIZE, 20);
    assert.deepEqual([p.rows.length, p.page, p.pages, p.from, p.to], [20, 0, 31, 1, 20]);
    const last = pageOf(rows, 30);
    assert.deepEqual([last.rows, last.from, last.to], [[600, 601, 602, 603, 604], 601, 605]);
    assert.equal(pageOf(rows, 99).page, 30);
    assert.equal(pageOf(rows, -3).page, 0);
    assert.deepEqual(pageOf([], 4), { rows: [], page: 0, pages: 1, from: 0, to: 0 });
    assert.deepEqual(pagerItems(0, 30), [0, 1, 2, '…', 28, 29]);
    assert.deepEqual(pagerItems(10, 30), [0, 1, 2, '…', 9, 10, 11, '…', 28, 29]);
    assert.deepEqual(pagerItems(3, 30), [0, 1, 2, 3, 4, '…', 28, 29]);
    assert.deepEqual(pagerItems(1, 4), [0, 1, 2, 3]);
});

test('who is asked first: the player opened to attack, then this page, then everyone else in order (once each)', () => {
    assert.deepEqual(statusOrder({ open: [9], page: [3, 4, 9], all: [1, 2, 3, 4, 5, 9] }), [9, 3, 4, 1, 2, 5]);
    assert.deepEqual(statusOrder({ page: ['7', 0, -1], all: [7, 8] }), [7, 8]);
});

test('the scheduler (Trading\'s updateSellPresence): 3 at once, 30 a minute, again after 10 min, the opened player after 90 s', () => {
    const order = Array.from({ length: 600 }, (_, i) => i + 1);
    // Nothing read: the first three go.
    let r = statusesToAsk({ order, now: T0 });
    assert.deepEqual(r.ask, [1, 2, 3]);
    assert.equal(STATUS_MAX_PENDING, 3);
    // Three still pending: nobody else.
    assert.deepEqual(statusesToAsk({ order, pending: new Set([1, 2, 3]), asked: r.asked, now: T0 + 500 }).ask, []);
    // A minute's worth: never more than 30 in any minute.
    const reads = new Map();
    let asked = [];
    let total = 0;
    for (let s = 0; s < 60; s++) {
        const now = T0 + s * 1000;
        const x = statusesToAsk({ order, readAt: (id) => reads.get(id) || 0, asked, now });
        asked = x.asked;
        for (const id of x.ask) reads.set(id, now);
        total += x.ask.length;
    }
    assert.equal(total, STATUS_PER_MIN);
    assert.deepEqual([...reads.keys()].slice(0, 5), [1, 2, 3, 4, 5], 'in order');
    // Read 9 minutes ago: not yet; 10: again. The one opened to attack: again after 90 s.
    const at = (ms) => () => T0 - ms;
    assert.deepEqual(statusesToAsk({ order: [7], readAt: at(9 * MIN), now: T0 }).ask, []);
    assert.deepEqual(statusesToAsk({ order: [7], readAt: at(STATUS_REFRESH_MS), now: T0 }).ask, [7]);
    assert.deepEqual(statusesToAsk({ order: [7], open: new Set([7]), readAt: at(STATUS_OPEN_REFRESH_MS - 1000), now: T0 }).ask, []);
    assert.deepEqual(statusesToAsk({ order: [7], open: new Set([7]), readAt: at(STATUS_OPEN_REFRESH_MS), now: T0 }).ask, [7]);
    // A failed read waits its turn; the rest go on.
    assert.deepEqual(statusesToAsk({ order: [7, 8], retryAt: new Map([[7, T0 + MIN]]), now: T0 }).ask, [8]);
    // A full minute already: nothing until the oldest ask is a minute old.
    const full = Array.from({ length: 30 }, (_, i) => T0 - 59000 + i * 100);
    assert.deepEqual(statusesToAsk({ order, asked: full, now: T0 }).ask, []);
    assert.deepEqual(statusesToAsk({ order, asked: full, now: T0 + 1001 }).ask, [1], 'one slot freed');
});

test('a full pass over the active 100 at 30 a minute is under 4 minutes, and the line says so', () => {
    const ids = Array.from({ length: ACTIVE_MAX }, (_, i) => i + 1);
    const p = statusProgress(ids, (id) => id <= 37);
    assert.deepEqual(p, { checked: 37, total: 100, leftMin: 3 });
    assert.equal(statusLine(p), 'Statuses: 37 of 100 checked · this page first · the rest in about 3 min');
    assert.equal(statusLine(statusProgress(ids, (id) => id <= 20)), 'Statuses: 20 of 100 checked · this page first · the rest in about 3 min');
    assert.equal(statusLine(statusProgress(ids, () => true)), 'Statuses: all 100 checked · each again every 10 min');
    assert.equal(statusLine(statusProgress(ids, (id) => id !== 5)), 'Statuses: 99 of 100 checked · this page first · the rest in about 1 min');
    assert.equal(statusLine(statusProgress([], () => false)), '');
});

test('pumpStatuses: Torn\'s public profile in the eye lane, 3 at once, kept, the listener told, not asked again for 10 min', async () => {
    setKey(K.apiKey, 'HarnessKey123456');
    set(K.apiKeyDead, false);
    const nowS = Math.floor(Date.now() / 1000);
    const calls = [];
    let release;
    const gate = new Promise((r) => (release = r));
    pi.client = {
        get: async (path) => {
            calls.push(path);
            await gate;
            const id = Number(path.match(/^v2\/user\/(\d+)\/profile$/)[1]);
            if (id === 803) throw new Error('HTTP 500');
            return { profile: { id, name: 'P' + id, level: 40, life: { maximum: 5000 }, status: id === 802 ? { state: 'Hospital', description: 'In hospital', until: nowS + 900 } : { state: 'Okay', description: 'Okay', until: 0 } } };
        },
    };
    const told = [];
    onStatus((id) => told.push(id));
    // The kept statuses load first (this site's IndexedDB; none in node): nothing is asked before.
    await loadStatuses();
    const order = [801, 802, 803, 804, 805];
    const asked = pumpStatuses({ order, readAt: () => 0 });
    assert.deepEqual(asked, [801, 802, 803], 'three at once');
    assert.deepEqual(pumpStatuses({ order }), [], 'three pending: nobody else');
    assert.ok(calls.every((p) => /^v2\/user\/\d+\/profile$/.test(p)), 'the eye lane (core/lanes.js laneOf)');
    release();
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(told.sort(), [801, 802, 803]);
    assert.equal(statusRead(801).status.state, 'Okay');
    assert.equal(statusRead(802).status.state, 'Hospital');
    assert.equal(statusRead(803), null, 'a failed read keeps nothing');
    // Next: the two never asked (801/802 read just now, 803 waits its retry).
    assert.deepEqual(pumpStatuses({ order }), [804, 805]);
    // Free reads first: a player the war list read a minute ago is not asked.
    await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(pumpStatuses({ order: [806, 807], readAt: (id) => (id === 806 ? Date.now() - 60000 : 0) }), [807]);
});

test('statuses kept across tabs and reloads: two tabs merged, the newest read wins, capped, nothing over a day old', () => {
    const a = { 1: [{ state: 'Okay' }, T0 - 5 * MIN], 2: [{ state: 'Hospital' }, T0 - 2 * MIN], 3: [{ state: 'Okay' }, T0 - 25 * 3600e3], 4: ['x', 0], 5: null };
    const b = { 1: [{ state: 'Abroad' }, T0 - MIN], 2: [{ state: 'Okay' }, T0 - 9 * MIN] };
    const m = mergeStatuses(a, b, T0);
    assert.deepEqual(Object.keys(m).sort(), ['1', '2']);
    assert.equal(m[1][0].state, 'Abroad');
    assert.equal(m[2][0].state, 'Hospital');
    const many = Object.fromEntries(Array.from({ length: 700 }, (_, i) => [i + 1, [{ state: 'Okay' }, T0 - i * 1000]]));
    const kept = mergeStatuses(many, null, T0);
    assert.equal(Object.keys(kept).length, STATUS_KEEP);
    assert.ok(STATUS_KEEP >= LIST_MAX, 'the active list and the reserve that slides in all fit');
    assert.ok(kept[1] && !kept[700], 'the newest kept');
});
