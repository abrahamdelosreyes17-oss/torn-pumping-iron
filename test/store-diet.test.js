/*
 * Round 6, R6.2: Tampermonkey's store kept small. The histories keep their recent part in GM (what Torn's pages and
 * the leader use); the webpage moves the older part into its own IndexedDB and reads the two together. Prices keep
 * one small row per item in GM; the listings stay on the site that loaded them. The leader renews its claim every
 * 10 s, and the 30 s reads write only what changed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ARCHIVES, archived, pageGet, pageSet, resetArchivesForTest } from '../src/platform/archive.js';
import { slimPriceRow, livePrices, unitPrice } from '../src/core/market.js';
import { receiptPriceNow } from '../src/core/receipts.js';
import { K, get, set, getPrices, dropOldKeys } from '../src/platform/store.js';
import { StateFeed } from '../src/feed/state.js';

const DAY = 86400e3;
const T = Date.parse('2026-09-30T12:00:00Z');
const today = Math.floor(T / DAY) * DAY;

test('statsHistory: GM keeps 8 days (the build sparkline), older days go to the webpage and read back whole', () => {
    const spec = ARCHIVES.statsHistory;
    const h = {};
    for (let d = 0; d < 30; d++) h[today - d * DAY] = { str: 100 - d };
    const old = spec.old(h, T);
    assert.equal(Object.keys(old).length, 22);
    const arch = spec.absorb({}, old);
    const trimmed = spec.trim(h, new Set(Object.keys(old)));
    assert.equal(Object.keys(trimmed).length, 8);
    assert.ok(trimmed[today] && trimmed[today - 7 * DAY] && !trimmed[today - 8 * DAY]);
    assert.deepEqual(spec.merge(arch, trimmed), h, 'the webpage reads all 30 days');
});

test('a newer write the leader made while the webpage copied is kept (only what was copied is dropped)', () => {
    const spec = ARCHIVES.receipts;
    const r = { v: 1, days: { [today - 5 * DAY]: { e: 1 }, [today]: { e: 2 } }, pend: { [today]: { d: 1, bh: 0 } }, inv: null };
    const old = spec.old(r, T);
    assert.deepEqual(Object.keys(old), [String(today - 5 * DAY)]);
    // Meanwhile the leader recorded more today.
    const cur = { ...r, days: { ...r.days, [today]: { e: 3 } } };
    const trimmed = spec.trim(cur, new Set(Object.keys(old)));
    assert.deepEqual(trimmed.days, { [today]: { e: 3 } });
    assert.deepEqual(trimmed.pend, r.pend, 'pending uses stay');
    assert.deepEqual(spec.merge(spec.absorb(null, old), trimmed).days, { [today - 5 * DAY]: { e: 1 }, [today]: { e: 3 } });
});

test('calibration: the newest 20 samples stay in GM; merged back with its error recomputed', () => {
    const spec = ARCHIVES.calibration;
    const samples = Array.from({ length: 50 }, (_, i) => ({ at: T - (50 - i) * 1000, stat: 'str', predicted: 100, actual: i < 25 ? 110 : 90 }));
    const v = { samples, n: 50, errPct: 0 };
    const old = spec.old(v);
    assert.equal(old.length, 30);
    const trimmed = spec.trim(v, new Set(old.map((s) => s.at + ':' + s.stat)));
    assert.equal(trimmed.samples.length, 20);
    const whole = spec.merge(spec.absorb([], old), trimmed);
    assert.equal(whole.samples.length, 50);
    assert.equal(whole.n, 50);
    assert.equal(Math.round(whole.errPct), 0, 'error over all 50');
    assert.deepEqual(spec.absorb(spec.absorb([], old), old).length, 30, 'copied twice is kept once');
});

test('price history keeps the week behind the 7-day average in GM', () => {
    const spec = ARCHIVES.priceHistory;
    const d0 = Math.floor(T / DAY);
    const rec = {};
    for (let i = 0; i < 30; i++) rec[d0 - i] = 800000 + i;
    const v = { v: 1, items: { 206: rec, points: { [d0]: 45000 } } };
    const old = spec.old(v, T);
    assert.equal(Object.keys(old).length, 22);
    const trimmed = spec.trim(v, new Set(Object.keys(old)));
    assert.equal(Object.keys(trimmed.items[206]).length, 8);
    assert.deepEqual(trimmed.items.points, { [d0]: 45000 });
    assert.deepEqual(spec.merge(spec.absorb({}, old), trimmed), v);
});

test('without the webpage copy loaded (Torn pages, node), reads are GM as before', () => {
    resetArchivesForTest();
    set(K.statsHistory, { [today]: { str: 1 } });
    assert.deepEqual(archived(K.statsHistory, {}), { [today]: { str: 1 } });
    pageSet('moneyLog', { at: 1, log: [] });
    assert.deepEqual(pageGet('moneyLog', null), { at: 1, log: [] });
    pageSet('moneyLog', null);
    assert.equal(pageGet('moneyLog', null), null);
});

test('prices: GM gets one small row per item; the plan reads the same unit price from it', () => {
    const listings = Array.from({ length: 60 }, (_, i) => ({ source: i % 2 ? 'bazaar' : 'itemmarket', price: 800000 + i * 100, qty: 3, sellerId: '1', sellerName: 'Iron_Monk' }));
    const full = { at: T, listings, avg7: 810000, lows7: [1, 2], error: null };
    const small = slimPriceRow(206, full);
    assert.equal(small.listings, undefined);
    assert.equal(small.u, unitPrice(full, 10));
    assert.equal(small.low, 800000);
    assert.deepEqual(livePrices({ 206: small }), livePrices({ 206: full }));
    assert.ok(JSON.stringify(small).length < 150, JSON.stringify(small));
    assert.equal(receiptPriceNow(206, { prices: { 206: small }, now: T }), 800000, 'receipts price today from the small row');
});

test('1.2.3 full price rows move off GM once (this site keeps the listings)', () => {
    set(K.prices, { 206: { at: T, listings: [{ source: 'itemmarket', price: 5, qty: 10 }] } });
    dropOldKeys();
    const stored = get(K.prices, null);
    assert.equal(stored[206].listings, undefined);
    assert.equal(stored[206].u, 5);
    assert.equal(getPrices()[206].listings.length, 1, 'this site still has them');
});

test('the feed writes stats history and the day log only when they change', async () => {
    const writes = [];
    const mem = new Map();
    const store = { get: (k, fb) => (mem.has(k) ? JSON.parse(mem.get(k)) : fb), set: (k, v) => { writes.push(k); mem.set(k, JSON.stringify(v)); }, del: (k) => mem.delete(k) };
    const feed = new StateFeed({ client: null, store, tabId: 't', isVisible: () => true });
    const state = { at: T, stats: { str: 1, spd: 2, def: 3, dex: 4 }, specialRefills: 0 };
    feed.recordDaily(state);
    feed.recordDaily({ ...state, at: T + 30e3 });
    assert.equal(writes.filter((k) => k === feed.keys.history).length, 1, 'the same row twice: one write');
    feed.recordDaily({ ...state, at: T + 60e3, stats: { ...state.stats, str: 2 } });
    assert.equal(writes.filter((k) => k === feed.keys.history).length, 2);
});
