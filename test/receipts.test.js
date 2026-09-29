/*
 * Receipts (Progress): energy and trains between two reads, items used
 * (only against a cooldown jump), money at that day's price, refills, the
 * pause for Torn Trading, and the what-if re-run.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeState, diffStates, tornDayStart, DAY } from '../src/core/bars.js';
import { GYMS } from '../src/core/gyms.js';
import { XANAX, LSD, ECSTASY, EDVD, CANDY_KISSES, POINTS, SAMPLE_PRICES } from '../src/core/items.js';
import { receiptChange, recordChange, addToReceiptDay, applyInventory, summarizeReceipts, receiptDayCost, receiptPriceNow, whatIfPeriod, whatIfLines, runWhatIf, itemsWords, RECEIPT_DAYS, emptyReceipts } from '../src/core/receipts.js';
import { recordPrice } from '../src/core/history.js';
import { playerContext, buildOf } from '../src/core/model.js';
import { StateFeed } from '../src/feed/state.js';
import { TornApiClient } from '../src/api/client.js';
import { TRADING_SEEN_KEY } from '../src/core/turns.js';

const T0 = Date.UTC(2026, 8, 29, 10, 48);
const D0 = tornDayStart(T0);

function st(at, { energy = 150, dex = 82700, str = 118400, drug = 0, booster = 0, refill = false, special = 0, happy = 5025, gym = 18 } = {}) {
    return normalizeState({ bars: { energy: { current: energy, maximum: 150, increment: 5, interval: 600, tick_time: 600 }, happy: { current: happy, maximum: 5025, increment: 5, interval: 900, tick_time: 900 } }, cooldowns: { drug, booster }, refills: { energy: refill, special_count: special }, battlestats: { strength: { value: str }, speed: { value: 110900 }, defense: { value: 96200 }, dexterity: { value: dex } }, gym: { id: gym } }, at);
}
const change = (a, b, o = {}) => receiptChange(a, b, diffStates(a, b), { table: GYMS, ...o });

test('energy: a plain session is read exactly from the bar, by gym and stat', () => {
    const a = st(T0, { energy: 150 });
    const b = st(T0 + 30e3, { energy: 0, dex: 83500 });
    const c = change(a, b);
    assert.equal(c.e, 150);
    assert.equal(c.n, 15);
    assert.deepEqual(c.by, { 'dex@18': [15, 150] });
    assert.deepEqual(c.gain, { dex: 800 });
    assert.equal(c.est, false);
    assert.equal(c.drugs, 0);
});

test('energy: a Xanax, a refill or special refills in between add their energy', () => {
    const a = st(T0, { energy: 150 });
    const xan = change(a, st(T0 + 30e3, { energy: 0, dex: 85000, drug: 7 * 3600 }));
    assert.equal(xan.e, 400, '150 + Xanax 250');
    assert.equal(xan.drugs, 1);
    assert.equal(xan.drugGuess, XANAX);
    assert.equal(xan.est, true);
    const ref = change(st(T0, { energy: 0 }), st(T0 + 30e3, { energy: 0, dex: 83500, refill: true }));
    assert.equal(ref.e, 150);
    assert.equal(ref.refills, 1);
    const sp = change(st(T0, { energy: 0, special: 5 }), st(T0 + 30e3, { energy: 0, dex: 84000, special: 3 }));
    assert.equal(sp.special, 2);
    assert.equal(sp.e, 300);
    // The plan's next step names the drug: an LSD adds 50.
    const lsd = change(a, st(T0 + 30e3, { energy: 0, dex: 83600, drug: 7 * 3600 }), { hint: { items: [{ id: LSD, qty: 1 }] } });
    assert.equal(lsd.drugGuess, LSD);
    assert.equal(lsd.e, 200);
});

test('energy: two stats share the trains by the gain model, whole trains adding up', () => {
    const a = st(T0, { energy: 150 });
    const b = st(T0 + 30e3, { energy: 0, dex: 83100, str: 118800 });
    const c = change(a, b);
    assert.equal(c.n, 15);
    const n = Object.values(c.by).reduce((x, [k]) => x + k, 0);
    assert.equal(n, 15);
    assert.ok(c.by['dex@18'][0] > 0 && c.by['str@18'][0] > 0);
});

test('nothing trained or used: nothing recorded', () => {
    const a = st(T0, { energy: 100 });
    const r = recordChange(null, change(a, st(T0 + 30e3, { energy: 100 })));
    assert.deepEqual(r.days, {});
});

test('items: a use is the plan’s guess until the inventory names it; sold items never count', () => {
    let r = applyInventory(null, { [XANAX]: 5, [LSD]: 2, [CANDY_KISSES]: 40 }, T0 - 60e3);
    assert.deepEqual(r.inv.c, { [XANAX]: 5, [LSD]: 2, [CANDY_KISSES]: 40 });
    const a = st(T0, { energy: 150 });
    r = recordChange(r, change(a, st(T0 + 30e3, { energy: 0, dex: 85000, drug: 7 * 3600 })));
    const day = r.days[D0];
    assert.deepEqual(day.items, { [XANAX]: 1 });
    assert.deepEqual(day.guess, { [XANAX]: 1 });
    assert.deepEqual(r.pend[D0], { d: 1, bh: 0 });
    // The read after: one LSD gone (it was LSD, not Xanax), candy moved out: only the LSD counts.
    r = applyInventory(r, { [XANAX]: 5, [LSD]: 1, [CANDY_KISSES]: 0 }, T0 + 40e3);
    assert.deepEqual(r.days[D0].items, { [LSD]: 1 });
    assert.deepEqual(r.days[D0].guess, {});
    assert.deepEqual(r.pend, {});
    // A later read with drops and no use: still nothing.
    r = applyInventory(r, { [XANAX]: 0, [LSD]: 0 }, T0 + 3600e3);
    assert.deepEqual(r.days[D0].items, { [LSD]: 1 });
});

test('items: a use bought and taken between two reads stays the guess', () => {
    let r = applyInventory(null, { [XANAX]: 0 }, T0 - 60e3);
    r = recordChange(r, change(st(T0), st(T0 + 30e3, { energy: 0, dex: 85000, drug: 7 * 3600 })));
    r = applyInventory(r, { [XANAX]: 0 }, T0 + 40e3);
    assert.deepEqual(r.days[D0].items, { [XANAX]: 1 });
    assert.deepEqual(r.days[D0].guess, { [XANAX]: 1 });
});

test('items: boosters count up to the hours the booster cooldown rose', () => {
    let r = applyInventory(null, { [EDVD]: 8, [ECSTASY]: 3, [CANDY_KISSES]: 60 }, T0 - 60e3);
    const hint = { items: [{ id: EDVD, qty: 5 }, { id: ECSTASY, qty: 1 }] };
    // 5 EDVD = 30 h of booster cooldown, and the Ecstasy on the drug cooldown.
    const c = change(st(T0, { energy: 1150 }), st(T0 + 30e3, { energy: 0, dex: 400000, drug: 4 * 3600, booster: 30 * 3600 }), { hint });
    assert.equal(c.drugGuess, ECSTASY);
    assert.ok(Math.abs(c.boosterH - 30) < 0.01);
    assert.deepEqual(c.boosterGuess, { [EDVD]: 5 });
    r = recordChange(r, c);
    // 10 candy went too (sold): the cooldown only covers the EDVD.
    r = applyInventory(r, { [EDVD]: 3, [ECSTASY]: 2, [CANDY_KISSES]: 50 }, T0 + 40e3);
    assert.deepEqual(r.days[D0].items, { [ECSTASY]: 1, [EDVD]: 5 });
    assert.deepEqual(r.days[D0].guess, {});
    assert.equal(itemsWords(r.days[D0].items), 'EDVD × 5 · Ecstasy × 1');
});

test('money: items × that day’s cheapest price, refills at 30 points; a missing price marks the day estimated', () => {
    let hist = recordPrice(null, XANAX, T0, 830000);
    hist = recordPrice(hist, XANAX, T0 + 1000, 815000);
    const day = addToReceiptDay(null, { at: T0, s0: null, e: 0, n: 0, by: {}, gain: { dex: 10 }, drugs: 2, drugGuess: XANAX, boosterGuess: {}, refills: 1, special: 0 }, { priceOf: (id) => receiptPriceNow(id, { priceHistory: hist, prices: { points: { at: T0, listings: [{ price: 45000, qty: 100 }] } }, now: T0 }) });
    assert.equal(day.px[XANAX], 815000);
    assert.equal(day.px[POINTS], 45000);
    assert.deepEqual(receiptDayCost(day, D0), { cost: 2 * 815000 + 30 * 45000, est: false });
    // No price seen that day for EDVD: the nearest known one, estimated.
    const d2 = { ...day, items: { ...day.items, [EDVD]: 1 } };
    const c2 = receiptDayCost(d2, D0);
    assert.equal(c2.est, true);
    assert.equal(c2.cost, 2 * 815000 + 30 * 45000 + SAMPLE_PRICES[EDVD]);
    // A day recorded before a price came in: the day's low from the price history.
    const d3 = { items: { [XANAX]: 1 }, px: {}, refills: 0 };
    assert.deepEqual(receiptDayCost(d3, D0, { priceHistory: hist }), { cost: 815000, est: false });
});

test('summaries: today / 7 days, $ and energy per 1,000 stats', () => {
    let r = emptyReceipts();
    const a = st(T0, { energy: 150 });
    r = recordChange(r, change(a, st(T0 + 30e3, { energy: 0, dex: 85000, drug: 7 * 3600 })), { priceOf: () => 800000 });
    r = recordChange(r, change(st(T0 - 2 * DAY), st(T0 - 2 * DAY + 30e3, { energy: 0, dex: 83700 })));
    const today = summarizeReceipts(r, D0, D0);
    assert.equal(today.days, 1);
    assert.equal(today.e, 400);
    assert.equal(today.cost, 800000);
    assert.equal(today.gained, 2300);
    assert.ok(Math.abs(today.perK - (800000 * 1000) / 2300) < 1e-6);
    assert.ok(Math.abs(today.ePerK - (400 * 1000) / 2300) < 1e-6);
    const week = summarizeReceipts(r, D0 - 6 * DAY, D0);
    assert.equal(week.days, 2);
    assert.equal(week.e, 550);
    assert.equal(week.n, 55);
});

test('receipts keep 120 days', () => {
    let r = null;
    for (let i = 0; i < RECEIPT_DAYS + 5; i++) r = recordChange(r, change(st(T0 + i * DAY), st(T0 + i * DAY + 30e3, { energy: 0, dex: 83000 })));
    const keys = Object.keys(r.days).map(Number).sort((a, b) => a - b);
    assert.equal(keys.length, RECEIPT_DAYS);
    assert.equal(keys[0], D0 + 5 * DAY);
});

function feedRig() {
    let t = Date.UTC(2026, 8, 29, 12, 29);
    const m = new Map();
    const store = { get: (k, fb) => (m.has(k) ? JSON.parse(m.get(k)) : fb), set: (k, v) => m.set(k, JSON.stringify(v)), del: (k) => m.delete(k) };
    const s = { spd: 4_060_000, drug: 0, energy: 150, xanax: 6 };
    const user = () => ({
        bars: { energy: { current: s.energy, maximum: 150, increment: 5, interval: 600, tick_time: 600 }, happy: { current: 4000, maximum: 4000, increment: 5, interval: 900, tick_time: 900 } },
        cooldowns: { drug: s.drug, booster: 0, medical: 0 },
        refills: { energy: false },
        battlestats: { strength: { value: 35.4e6 }, speed: { value: s.spd }, defense: { value: 82.4e6 }, dexterity: { value: 20.4e6 } },
        gym: { id: 24 },
    });
    const sent = [];
    const rig = { paused: false, store, s, sent, now: () => t, advance: (ms) => (t += ms) };
    const client = new TornApiClient({ getKey: () => 'k'.repeat(16), maxRetries: 0, dedupTtlMs: 0, isPaused: () => rig.paused, fetchImpl: async (url) => {
        sent.push(url);
        const u = new URL(url);
        let body = {};
        if (u.pathname === '/v2/user' && u.searchParams.get('selections')) body = user();
        if (u.pathname === '/v2/user/inventory') body = { inventory: { items: u.searchParams.get('cat') === 'Drug' ? [{ id: XANAX, amount: s.xanax }] : [] } };
        return { ok: true, status: 200, json: async () => body };
    } });
    rig.feed = new StateFeed({ client, store, tabId: 'A', now: () => t, isPaused: () => rig.paused, nextStep: () => ({ kind: 'xanax', items: [{ id: XANAX, qty: 1 }] }) });
    return rig;
}

test('feed: a Xanax and a train are recorded, and the inventory is read at once to name it', async () => {
    const rig = feedRig();
    await rig.feed.tick();
    assert.equal(await rig.feed.tick(), true);
    const inv0 = rig.store.get('receipts').inv;
    assert.equal(inv0.c[XANAX], 6, 'the first inventory read is the baseline');
    rig.advance(31e3);
    rig.s.drug = 7 * 3600;
    rig.s.energy = 0;
    rig.s.spd += 50_000;
    rig.s.xanax = 5;
    const before = rig.sent.filter((u) => u.includes('inventory')).length;
    assert.equal(await rig.feed.tick(), true);
    assert.ok(rig.sent.filter((u) => u.includes('inventory')).length > before, 'inventory asked right after the use');
    const r = rig.store.get('receipts');
    const day = r.days[tornDayStart(rig.now())];
    assert.equal(day.e, 400);
    assert.equal(day.n, 40);
    assert.deepEqual(day.by, { 'spd@24': [40, 400] });
    assert.deepEqual(day.items, { [XANAX]: 1 });
    assert.deepEqual(day.guess, {}, 'confirmed by the inventory drop');
    assert.equal(day.s0.spd, 4_060_000);
});

test('feed: nothing is recorded while paused for Torn Trading; the catch-up still records its totals', async () => {
    const rig = feedRig();
    await rig.feed.tick();
    await rig.feed.tick();
    const before = JSON.stringify(rig.store.get('receipts'));
    rig.paused = true;
    rig.store.set(TRADING_SEEN_KEY, rig.now() + 60000);
    rig.advance(2 * 3600e3);
    rig.s.spd += 2_100_000;
    rig.s.drug = 5 * 3600;
    rig.s.energy = 0;
    assert.equal(await rig.feed.tick(), false);
    assert.equal(JSON.stringify(rig.store.get('receipts')), before, 'nothing while paused');
    rig.paused = false;
    rig.advance(5000);
    await rig.feed.tick();
    await rig.feed.tick();
    const day = rig.store.get('receipts').days[tornDayStart(rig.now())];
    assert.equal(day.catchUp, 1);
    assert.equal(day.gain.spd, 2_100_000);
    assert.ok(day.e > 0 && day.est === true);
    assert.ok(day.items[XANAX] >= 1);
});

/* ---------- what if ---------- */

function periodReceipts(days = 3) {
    let r = emptyReceipts();
    let dex = 82700;
    for (let i = 0; i < days; i++) {
        const t = T0 + i * DAY;
        const a = st(t, { energy: 150, dex });
        dex += 1200;
        r = recordChange(r, change(a, st(t + 30e3, { energy: 0, dex, drug: 7 * 3600 })), { priceOf: () => 830000 });
    }
    return r;
}

test('what-if: the period starts from your real stats, with your energy and money per day', () => {
    const r = periodReceipts(3);
    const p = whatIfPeriod(r, [D0, D0 + DAY, D0 + 2 * DAY]);
    assert.equal(p.start.dex, 82700);
    assert.equal(p.days.length, 3);
    assert.equal(p.energy, 1200);
    assert.equal(p.money, 3 * 830000);
    assert.equal(p.gained, 3600);
});

test('what-if lines: each plan trains your energy at its own rate; one over your money counts only what it covers', () => {
    const period = { start: {}, startTotal: 1000, days: [{ e: 100, gained: 50 }, { e: 100, gained: 50 }], energy: 200, money: 1000, gained: 100 };
    const results = {
        steady: { id: 'steady', gained: 600, energyTrained: 1000, cost: 1000 },
        chocoJump: { id: 'chocoJump', gained: 1000, energyTrained: 1000, cost: 21000 },
    };
    const w = whatIfLines(period, results);
    assert.deepEqual(w.real, [1000, 1050, 1100]);
    assert.deepEqual(w.plans.steady.values, [1000, 1060, 1120]);
    assert.equal(w.plans.steady.capped, false);
    // Choco at your energy costs 4,200 and you spent 1,000: that share of its boost over steady's 0.6 per energy.
    const rate = 0.6 + 0.4 * (1000 / 4200);
    assert.ok(Math.abs(w.plans.chocoJump.perE - rate) < 1e-9);
    assert.equal(w.plans.chocoJump.capped, true);
    assert.equal(w.plans.chocoJump.gained, Math.round(200 * rate));
});

test('what-if re-run is deterministic: the same inputs give the same lines', () => {
    const r = periodReceipts(3);
    const period = whatIfPeriod(r, [D0, D0 + DAY, D0 + 2 * DAY]);
    const state = st(T0 + 3 * DAY);
    const pc = playerContext(state, {});
    const input = { state, pc, shares: buildOf('baldr').shares, settings: { horizonDays: 30, budget: 150e6 }, prices: {} };
    const a = runWhatIf(input, period);
    const b = runWhatIf(input, period);
    assert.deepEqual(a.plans, b.plans);
    assert.deepEqual(a.real, [period.startTotal, period.startTotal + 1200, period.startTotal + 2400, period.startTotal + 3600]);
    assert.ok(a.plans.steady && a.plans.steady.values.length === 4);
    for (const x of Object.values(a.plans)) assert.equal(x.values[0], period.startTotal);
});
