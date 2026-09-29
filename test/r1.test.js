import test from 'node:test';
import assert from 'node:assert/strict';

import { buildModel, compareStrategies, playerContext, buildOf } from '../src/core/model.js';
import { normalizeState, tornClock, MIN, DAY, tornDayStart } from '../src/core/bars.js';
import { targetShares, dayTimeline, logFromDiff, drugsToday } from '../src/core/plan.js';
import { unlockedGyms } from '../src/core/gyms.js';
import { BUILDS } from '../src/core/builds.js';
import { XANAX, EDVD, POINTS, SAMPLE_PRICES } from '../src/core/items.js';
import { unitPrice, livePrices, listingsFromW3b, BAZAAR_MAX_AGE_MS } from '../src/core/market.js';
import { tradingRunning, shouldMarkSeen, catchUpLabel, resumesAt, TRADING_GRACE_MS, TRADING_SEEN_KEY } from '../src/core/turns.js';
import { StateFeed, STATIC_RETRY_MS, STATIC_EVERY } from '../src/feed/state.js';
import { TornApiClient } from '../src/api/client.js';
import { fetchPoints } from '../src/api/torn.js';

const T0 = Date.UTC(2026, 8, 29, 10, 48);
const PLAN = { strategy: 'steady', build: 'balanced', goal: null };
const SETTINGS = { horizonDays: 30, budget: 150e6 };
const STATICS = { property: { property: { name: 'Private Island' }, happy: 5025 }, inventory: { [XANAX]: 1 }, perks: { property: ['+ 2% gym gains'] } };

function friend({ at = T0, energy = 20, drug = 232, happy = 5100, booster = 0, refill = false } = {}) {
    return normalizeState({
        bars: { energy: { current: energy, maximum: 150, increment: 5, interval: 600, tick_time: 120 }, happy: { current: happy, maximum: 5025, increment: 5, interval: 900, tick_time: 300 } },
        cooldowns: { drug, booster },
        refills: { energy: refill },
        battlestats: { strength: { value: 118400 }, speed: { value: 110900 }, defense: { value: 96200 }, dexterity: { value: 82700 } },
        gym: { id: 18 },
    }, at);
}

const priceRow = (price, qty = 50, extra = {}) => ({ at: T0, listings: [{ source: 'itemmarket', price, qty }], imAt: T0, w3bAt: null, error: null, avg7: null, ...extra });

/* #1 live prices were read as $0 */

test('#1 a stored price row counts what 10 units cost, never $0', () => {
    assert.equal(unitPrice(priceRow(845000)), 845000);
    assert.equal(unitPrice({ listings: [{ price: 800000, qty: 2 }, { price: 900000, qty: 50 }] }), (2 * 800000 + 8 * 900000) / 10);
    assert.equal(unitPrice({ listings: [], avg7: 830000 }), 830000);
    assert.equal(unitPrice({ listings: [] }), null);
    assert.equal(unitPrice(1234), 1234);
    assert.equal(unitPrice(0), null);
    assert.deepEqual(Object.keys(livePrices({ [XANAX]: priceRow(845000), 197: { listings: [] } })), [String(XANAX)]);
});

test('#1 the comparison costs the same with stored rows as with plain numbers', () => {
    const state = friend();
    const pc = playerContext(state, STATICS);
    const shares = targetShares(PLAN, pc.stats, buildOf('balanced').shares);
    const rows = compareStrategies({ state, pc, shares, settings: SETTINGS, prices: { [XANAX]: priceRow(SAMPLE_PRICES[XANAX]), [POINTS]: priceRow(SAMPLE_PRICES[POINTS], 5000) } });
    const plain = compareStrategies({ state, pc, shares, settings: SETTINGS, prices: {} });
    assert.ok(rows.steady.cost > 50e6, 'Xanax and points are not free');
    assert.equal(rows.steady.cost, plain.steady.cost);
});

/* #2 jump plans stuck at Xanax #1 */

test('#2 a jump plan counts the Xanax already stacked (read from energy above the maximum)', () => {
    const state = friend({ energy: 650, drug: 3600 });
    const m = buildModel({ state, statics: STATICS, plan: { ...PLAN, strategy: 'edvdJump' }, settings: SETTINGS, now: T0 });
    assert.equal(m.steps[0].label, 'Xanax #3 of 4 · don\'t train');
    assert.equal(m.steps.filter((s) => s.kind === 'stack').length, 2);
    assert.equal(m.steps.find((s) => s.kind === 'jump').strict, true);
});

test('#2 all four stacked: the next step is the jump itself', () => {
    const m = buildModel({ state: friend({ energy: 1150, drug: 3600 }), statics: STATICS, plan: { ...PLAN, strategy: 'chocoJump' }, settings: SETTINGS, now: T0 });
    assert.equal(m.steps[0].kind, 'jump');
});

/* #3 daily choco trained the held Xanax as natural energy */

test('#3 daily choco with a held Xanax goes straight to the boost', () => {
    const m = buildModel({ state: friend({ energy: 400, drug: 3600 }), statics: STATICS, plan: { ...PLAN, strategy: 'dailyChoco' }, settings: SETTINGS, now: T0 });
    assert.equal(m.steps[0].kind, 'boost');
    assert.ok(m.steps[0].energy >= 390, 'the held energy is trained at the boosted happy');
    assert.ok(!m.steps.some((s) => s.kind === 'natural' && s.at < m.steps[0].at));
});

/* #4 points never read */

test('#4 points held come from /user/money; a key that can’t read it gives null', async () => {
    const ok = new TornApiClient({ getKey: () => 'k'.repeat(16), maxRetries: 0, dedupTtlMs: 0, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ money: { points: 45 } }) }) });
    assert.equal(await fetchPoints(ok), 45);
    const no = new TornApiClient({ getKey: () => 'k'.repeat(16), maxRetries: 0, dedupTtlMs: 0, fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ error: { code: 16, error: 'Access level' } }) }) });
    assert.equal(await fetchPoints(no), null);
});

test('#4 with 45 points held, the Buy list asks for none today', () => {
    const m = buildModel({ state: friend(), statics: { ...STATICS, inventory: { [XANAX]: 1, [POINTS]: 45 } }, plan: PLAN, settings: SETTINGS, now: T0 });
    assert.equal(m.buyToday.find((n) => n.id === POINTS).buy, 0);
});

/* #6 Bliss */

test('#6 Steady with Bliss adds EDVD to the Xanax steps while the booster has room', () => {
    const ctx = { shares: BUILDS.balanced.shares, unlocked: unlockedGyms(18), active: 18, drugsToday: 1, bliss: true };
    const steps = dayTimeline({ state: friend(), now: T0, strategy: 'blissSteady', ctx });
    const x = steps.filter((s) => s.kind === 'xanax');
    assert.deepEqual(x[0].items, [{ id: XANAX, qty: 1 }, { id: EDVD, qty: 5 }], 'the last one may overshoot the 24 h cap');
    assert.equal(x[0].label, 'Xanax #2 + EDVD × 5');
    const plain = dayTimeline({ state: friend(), now: T0, strategy: 'steady', ctx });
    assert.ok(x[0].gain > plain.find((s) => s.kind === 'xanax').gain * 1.3, 'trained at the boosted happy');
});

test('#6 with Bliss the projection trains at today’s happy, not the maximum', () => {
    const statics = { ...STATICS, perks: { book: ['Happiness can regenerate above maximum for 31 days'] } };
    const low = buildModel({ state: friend({ happy: 5100 }), statics, plan: PLAN, settings: SETTINGS, now: T0 });
    const high = buildModel({ state: friend({ happy: 60000 }), statics, plan: PLAN, settings: SETTINGS, now: T0 });
    assert.equal(high.pc.perks.bliss, true);
    assert.ok(high.projection[6].gain > low.projection[6].gain * 2);
});

/* #7 a failed slow read waited its whole period */

test('#7 a slow part that fails is asked again in 5 minutes, and keeps what it had', async () => {
    let t = 1_790_000_000_000;
    const store = new Map();
    const st = { get: (k, fb) => (store.has(k) ? JSON.parse(store.get(k)) : fb), set: (k, v) => store.set(k, JSON.stringify(v)), del: (k) => store.delete(k) };
    let fail = true;
    const calls = [];
    const client = new TornApiClient({
        getKey: () => 'k'.repeat(16),
        maxRetries: 0,
        dedupTtlMs: 0,
        fetchImpl: async (url) => {
            const p = new URL(url).pathname;
            calls.push(p);
            if (p === '/v2/user/perks' && fail) return { ok: true, status: 200, json: async () => ({ error: { code: 17, error: 'Backend error occurred' } }) };
            if (p === '/v2/user/perks') return { ok: true, status: 200, json: async () => ({ perks: { property: ['+ 2% gym gains'] } }) };
            return { ok: true, status: 200, json: async () => ({}) };
        },
        rateLimitBackoffMs: 1,
    });
    st.set('userStatic', { perks: { property: ['old'] }, perksAt: t - STATIC_EVERY.perks - 1 });
    const feed = new StateFeed({ client, store: st, tabId: 'A', now: () => t });
    await feed.refreshStatic();
    const s1 = st.get('userStatic');
    assert.deepEqual(s1.perks, { property: ['old'] }, 'kept');
    assert.equal(s1.perksAt, t - STATIC_EVERY.perks + STATIC_RETRY_MS);
    fail = false;
    t += STATIC_RETRY_MS - 1000;
    const before = calls.filter((p) => p === '/v2/user/perks').length;
    await feed.refreshStatic();
    assert.equal(calls.filter((p) => p === '/v2/user/perks').length, before, 'not yet');
    t += 2000;
    await feed.refreshStatic();
    assert.deepEqual(st.get('userStatic').perks, { property: ['+ 2% gym gains'] });
});

/* #8 refill warned 12 h early */

test('#8 "Refill unused" shows only in the last 2 hours before Torn midnight', () => {
    const at = (h, m) => Date.UTC(2026, 8, 29, h, m);
    const has = (t) => buildModel({ state: friend({ at: t, drug: 3 * 3600 }), statics: STATICS, plan: PLAN, settings: SETTINGS, now: t }).heads.some((x) => x.text === 'Refill unused');
    assert.equal(has(at(20, 0)), false);
    assert.equal(has(at(22, 30)), true);
});

/* Taking turns with Torn Trading */

test('turns: paused within a minute of Torn Trading being seen, then back by itself', () => {
    const seen = 1_790_000_000_000;
    assert.equal(tradingRunning(0, seen), false);
    assert.equal(tradingRunning(seen, seen + 1000), true);
    assert.equal(tradingRunning(seen, seen + TRADING_GRACE_MS - 1), true);
    assert.equal(tradingRunning(seen, seen + TRADING_GRACE_MS), false);
    assert.equal(resumesAt(seen), seen + 60000);
    assert.equal(shouldMarkSeen(0, seen), true);
    assert.equal(shouldMarkSeen(seen, seen + 5000), false);
    assert.equal(shouldMarkSeen(seen, seen + 15000), true);
});

test('turns: while paused the Torn client sends nothing, and it isn’t a key problem', async () => {
    let paused = true;
    const sent = [];
    const client = new TornApiClient({ getKey: () => 'k'.repeat(16), maxRetries: 0, dedupTtlMs: 0, isPaused: () => paused, fetchImpl: async (url) => (sent.push(url), { ok: true, status: 200, json: async () => ({ ok: 1 }) }) });
    await assert.rejects(client.get('v2/user', { selections: 'bars' }), (e) => e.takingTurns === true && e.code === null);
    assert.equal(sent.length, 0);
    paused = false;
    assert.deepEqual(await client.get('v2/user', { selections: 'bars' }), { ok: 1 });
});

test('turns: the feed asks nothing while paused, then one catch-up entry covers the gap', async () => {
    let t = Date.UTC(2026, 8, 29, 12, 29);
    const m = new Map();
    const store = { get: (k, fb) => (m.has(k) ? JSON.parse(m.get(k)) : fb), set: (k, v) => m.set(k, JSON.stringify(v)), del: (k) => m.delete(k) };
    let spd = 4_060_000;
    let drug = 0;
    const user = () => ({
        bars: { energy: { current: 20, maximum: 150, increment: 5, interval: 600, tick_time: 120 }, happy: { current: 4000, maximum: 4000, increment: 5, interval: 900, tick_time: 300 } },
        cooldowns: { drug, booster: 0, medical: 0 },
        refills: { energy: false },
        battlestats: { strength: { value: 35.4e6 }, speed: { value: spd }, defense: { value: 82.4e6 }, dexterity: { value: 20.4e6 } },
        gym: { id: 24 },
    });
    const sent = [];
    let paused = false;
    const client = new TornApiClient({ getKey: () => 'k'.repeat(16), maxRetries: 0, dedupTtlMs: 0, isPaused: () => paused, fetchImpl: async (url) => {
        sent.push(url);
        const u = new URL(url);
        return { ok: true, status: 200, json: async () => (u.pathname === '/v2/user' && u.searchParams.get('selections') ? user() : {}) };
    } });
    const feed = new StateFeed({ client, store, tabId: 'A', now: () => t, isPaused: () => paused });
    await feed.tick();
    assert.equal(await feed.tick(), true);
    paused = true;
    store.set(TRADING_SEEN_KEY, t + 60000);
    t += 2 * 3600e3;
    const n = sent.length;
    assert.equal(await feed.tick(), false);
    assert.equal(sent.length, n, 'no call while paused');
    spd += 2_100_000;
    drug = 5 * 3600;
    paused = false;
    t += 5000;
    await feed.tick();
    await feed.tick();
    const log = store.get('dayLog');
    assert.equal(log.length, 1);
    assert.equal(log[0].kind, 'catchup');
    assert.equal(log[0].label, 'While paused: +2.1M SPD, Xanax taken');
    assert.equal(drugsToday(log, t), 1);
});

test('turns: an ordinary gap (tabs closed, no Torn Trading) is not called a pause', () => {
    const out = logFromDiff([], { drugTaken: false, refillUsed: false, boosterUsed: false, trained: { spd: 5000 } }, { at: T0, catchUp: false });
    assert.equal(out[0].kind, 'natural');
    assert.equal(catchUpLabel({}, {}), 'While paused');
});

/* TornW3B freshness */

test('bazaar listings TornW3B hasn’t re-checked in 2 minutes are dropped, and never $1', () => {
    const now = 1_790_000_000_000;
    const s = now / 1000;
    const api = { listings: [
        { player_id: 1, price: 820000, quantity: 3, last_checked: s - 30 },
        { player_id: 2, price: 810000, quantity: 3, last_checked: s - BAZAAR_MAX_AGE_MS / 1000 - 5 },
        { player_id: 3, price: 1, quantity: 3, last_checked: s - 5 },
        { player_id: 4, price: 815000, quantity: 3 },
    ] };
    assert.deepEqual(listingsFromW3b(api, { now }).map((l) => l.sellerId), ['1']);
    assert.equal(listingsFromW3b(api).length, 4, 'without now: every listing (tests, shapes)');
});

test('the day plan still starts at Torn midnight after the fixes', () => {
    const steps = dayTimeline({ state: friend(), now: T0, strategy: 'steady', ctx: { shares: BUILDS.balanced.shares, unlocked: unlockedGyms(18), active: 18, drugsToday: 1 } });
    assert.equal(tornClock(steps[0].at), '10:51');
    assert.ok(steps.every((s) => s.at < tornDayStart(T0) + DAY + MIN));
});

/* From the R1 review */

test('review: a mark from the future (clock moved back) is replaced, so the pause still starts', () => {
    const now = 1_790_000_000_000;
    assert.equal(shouldMarkSeen(now + 5 * 60000, now), true);
    assert.equal(tradingRunning(now + 5 * 60000, now), true, 'a future mark still counts as running');
});

test('review: a can above the maximum is not a stacked or held Xanax', () => {
    const jump = buildModel({ state: friend({ energy: 175, drug: 0 }), statics: STATICS, plan: { ...PLAN, strategy: 'edvdJump' }, settings: SETTINGS, now: T0 });
    assert.equal(jump.steps[0].label, 'Xanax #1 of 4 · don\'t train');
    const choco = buildModel({ state: friend({ energy: 175, drug: 3600 }), statics: STATICS, plan: { ...PLAN, strategy: 'dailyChoco' }, settings: SETTINGS, now: T0 });
    assert.notEqual(choco.steps[0].kind, 'boost');
});
