/*
 * A realistic Pumping Iron store for the perf check (test/perf-check.mjs):
 * every big key at the size a player who has used the app for months has,
 * built from the code's own shapes and caps (docs/research-lag-measured.md).
 * Deterministic (seeded), so runs compare.
 *
 *   realisticStore({receiptsDays: 1}) → {gm: {'pumpingIron.v1.<key>': raw JSON}, eye: IndexedDB 'eye' value}
 *
 * receiptsDays 1 is the owner's state in round 6 (receipts started 2026-09-29).
 */
import { readFileSync } from 'node:fs';
import { ITEMS, CANDY_IDS } from '../../src/core/items.js';
import { GYMS } from '../../src/core/gyms.js';

export function realisticStore({ receiptsDays = 120 } = {}) {
const base = JSON.parse(readFileSync(new URL('./base-store.json', import.meta.url), 'utf8'));
const P = 'pumpingIron.v1.';
const T0 = Date.parse('2026-09-29T10:48:00Z');
const DAY = 86400e3;
const today = Math.floor(T0 / DAY) * DAY;
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const ri = (a, b) => Math.floor(a + rnd() * (b - a + 1));
const pick = (arr) => arr[ri(0, arr.length - 1)];
const STATS = ['str', 'spd', 'def', 'dex'];
const ids = Object.keys(ITEMS).map(Number);
const names = ['Iron_Monk', 'LuckyLefty', 'Brix', 'Mira_Vex', 'Sly', 'Duchess', 'Kilo', 'Rook', 'Vandal', 'Pixie'];
const out = {};
const put = (k, v) => (out[P + k] = JSON.stringify(v));

// Keep the base (keys, plan, userState, learned, compareCache...).
Object.assign(out, base);

// calibration: 200 samples (CALIBRATION_KEEP).
const samples = [];
for (let i = 0; i < 200; i++) {
    const stat = pick(STATS);
    const trains = ri(5, 150);
    const pred = ri(50000, 5000000) + rnd();
    samples.push({ at: T0 - (200 - i) * 6 * 3600e3, stat, trains, predicted: pred, actual: pred * (0.95 + rnd() * 0.1), S: ri(50e6, 400e6) + rnd(), H: ri(4000, 99999), dots: 7.5, E: 10, gym: pick(['The Edge', "George's", 'Gym 3000', 'Balboas Gym']), perks: 1.03 });
}
put('calibration', { samples, n: 200, errPct: 1.23456 });

// receipts: 120 days (RECEIPT_DAYS).
const days = {};
for (let d = 119; d >= 0; d--) {
    const s0 = { str: 300e6 + d * 1e6, spd: 90e6, def: 280e6, dex: 280e6 };
    const items = {};
    const px = {};
    for (let j = 0; j < 6; j++) {
        const id = pick(ids);
        items[id] = ri(1, 30);
        px[id] = ri(500, 900000);
    }
    days[today - d * DAY] = { s0, e: ri(500, 4000), n: ri(50, 400), by: { 'str@27': [ri(10, 90), ri(500, 4500)], 'spd@23': [ri(10, 90), ri(100, 900)], 'def@24': [ri(1, 50), ri(10, 500)] }, gain: { str: ri(1e5, 5e6) + rnd(), spd: ri(1e5, 5e6) + rnd(), def: ri(1e5, 5e6) + rnd(), dex: 0 }, items, guess: {}, px, refills: 1, special: 0, catchUp: ri(0, 2), est: false };
}
const invC = {};
for (const id of ids) invC[id] = ri(0, 200);
put('receipts', { v: 1, days, pend: {}, inv: { at: T0 - 600e3, c: invC } });

// statsHistory: 120 days.
const sh = {};
for (let d = 119; d >= 0; d--) {
    const st = { str: 360e6 - d * 1e6 + rnd(), spd: 98.4e6 - d * 3e5 + rnd(), def: 288e6 - d * 5e5, dex: 288e6 - d * 5e5 };
    sh[today - d * DAY] = { ...st, total: st.str + st.spd + st.def + st.dex, special: 3, open: { ...st } };
}
put('statsHistory', sh);

// dayTotals: 120 days.
const dt = {};
for (let d = 119; d >= 0; d--) dt[today - d * DAY] = { gained: ri(1e6, 9e6), planned: ri(1e6, 9e6), xanax: ri(0, 3), xanaxPlanned: 3, refills: ri(0, 1) };
put('dayTotals', dt);

// dayLog: today only (logFromDiff keeps today): ~15 entries.
const dl = [];
for (let i = 0; i < 15; i++) dl.push({ at: today + i * 40 * 60e3, kind: pick(['natural', 'xanax', 'refill']), label: pick(['Natural energy', 'Xanax', 'Refill · 25 points']), trained: { str: ri(1e5, 2e6), spd: ri(0, 1e6) }, gain: ri(1e5, 3e6) });
put('dayLog', dl);

// fightLog 500, eyePredictions 300, learnLog 30.
const fl = [];
for (let i = 0; i < 500; i++) fl.push({ key: ri(100000, 3999999) + ':' + (Math.floor(T0 / 1000) - (500 - i) * 3000), at: T0 - (500 - i) * 3000e3, who: 'p' + ri(1e8, 9e9).toString(36), predictedWin: Math.round(rnd() * 1000) / 1000, won: rnd() > 0.2, predictedHpKept: Math.round(rnd() * 1000) / 1000, hpKept: null, respect: Math.round(rnd() * 800) / 100 });
put('fightLog', fl);
const ep = [];
for (let i = 0; i < 300; i++) ep.push({ def: ri(100000, 3999999), at: T0 - (300 - i) * 3600e3, pWin: Math.round(rnd() * 1000) / 1000, keep: Math.round(rnd() * 1000) / 1000 });
put('eyePredictions', ep);
const ll = [];
for (let i = 0; i < 30; i++) ll.push({ at: T0 - (30 - i) * 6 * 3600e3, gym: { accepted: false, heldOut: { current: 3.1, learned: 3.4 }, mode: 'log10', mult: { str: 1, spd: 1, def: 1, dex: 1 }, sessions: 180, candidates: [{ mode: 'log10', error: 3.1 }, { mode: 'sqrt', error: 4.2 }, { mode: 'lin', error: 5.5 }] }, fights: { accepted: false, model: { winScale: 1, hpScale: 1 }, fights: 480, heldOut: { brier: { current: 0.12, learned: 0.13 }, hpError: { current: null, learned: null } } } });
put('learnLog', ll);

// moneyLog: 1,500 lines, 8 categories (income.js).
const cats = ['Bazaars', 'Item market', 'Company', 'Stocks', 'Trades', 'Faction', 'Missions', 'Crimes'];
const mlog = [];
for (let i = 0; i < 1500; i++) mlog.push({ at: T0 - i * 1700e3, title: pick(['Bazaar sell', 'Item market buy', 'Item market sell', 'Company pay', 'Stock sell', 'Trade money', 'Faction payout', 'Mission reward']), money: ri(1e4, 5e8) });
put('moneyLog', { at: T0 - 3600e3, days: 30, cats, log: mlog });

// gymLog: 600 lines (GYM_LOG_KEEP).
const gl = [];
for (let i = 0; i < 600; i++) {
    const stat = pick(STATS);
    const before = ri(80e6, 360e6) + rnd();
    const gain = ri(1e4, 3e6) + rnd();
    gl.push({ id: 'g' + (1000000 + i), at: T0 - (600 - i) * 4 * 3600e3, stat, trains: ri(1, 150), energy: ri(10, 1500), happy: ri(5, 750), gymId: pick([23, 24, 27, 25]), before, after: before + gain, gain });
}
put('gymLog', { lines: gl, at: T0 - 600e3, newest: gl[gl.length - 1].at, gap: null });

// prices: every item (28) + points, PRICE_LISTINGS_KEPT = 60 listings each (bazaar rows carry seller names).
const prices = {};
for (const id of [...ids, 'points']) {
    const base = id === 'points' ? 45000 : ri(500, 900000);
    const listings = [];
    for (let j = 0; j < 60; j++) {
        const price = base + j * ri(1, 500);
        if (id === 'points') listings.push({ source: 'points', listingId: String(ri(90000000, 99999999)), price, qty: ri(1, 5000) });
        else if (j % 2) listings.push({ source: 'bazaar', sellerId: String(ri(100000, 3999999)), sellerName: pick(names), price, qty: ri(1, 500), dataAt: T0 - ri(10, 110) * 1000 });
        else listings.push({ source: 'itemmarket', price, qty: ri(1, 5000) });
    }
    prices[id] = { at: T0 - ri(1, 20) * 60e3, listings, imAt: T0 - 60e3, w3bAt: T0 - 60e3, error: null, avg7: base * 1.01, lows7: [base, base, base, base, base, base, base] };
}
put('prices', prices);
// priceHistory: 30 days × every item.
const phItems = {};
for (const id of [...ids, 'points']) {
    const rec = {};
    for (let d = 0; d < 30; d++) rec[Math.floor(T0 / DAY) - d] = ri(500, 900000);
    phItems[id] = rec;
}
put('priceHistory', { v: 1, items: phItems });

// userStatic: the captured one plus realistic items info, inventory, gyms, perks, job, calendar, wars, equipment.
const us = JSON.parse(base[P + 'userStatic']);
us.gyms = GYMS.map((g) => ({ id: g.id, name: g.name, class: g.specialist ? 'Specialist' : 'Heavyweight', energy_cost: g.energy, cost: g.cost * 1000, modifiers: { strength: g.dots.str, speed: g.dots.spd, defense: g.dots.def, dexterity: g.dots.dex }, note: g.specialist ? 'Requires a stat to be 25% higher than the others' : null }));
us.inventory = { points: 4500, cash: 881000000 };
for (let i = 0; i < 150; i++) us.inventory[ri(1, 1400)] = ri(1, 500);
for (const id of ids) us.inventory[id] = ri(0, 60);
us.items = {};
for (const id of CANDY_IDS.concat([104])) us.items[id] = { id, name: 'Item ' + id, type: 'Candy', marketPrice: ri(500, 90000), sell: ri(100, 5000), shop: { id: 'sally', name: "Sally's Sweet Shop", price: ri(100, 5000) }, circulation: ri(1e5, 1e7), effect: 'Increases happiness by 25 upon consumption.' };
us.perks = { faction: ['+ 10% gym gains', '+ 2% dexterity gym gains', '+ 5 maximum energy'], job: ['+ 5% happiness gains'], property: ['+ 2% gym gains', '+ 25% happy upon property purchase'], education: ['+ 1% dexterity gym gains', '+ 1% speed gym gains', '+ 1% strength gym gains', '+ 1% defense gym gains', '+ 10% gym gains'], enhancer: [], book: [], stock: ['+ 10% energy regeneration'], merit: ['+ 3% strength gym gains', '+ 3% speed gym gains', '+ 3% defense gym gains', '+ 3% dexterity gym gains'] };
us.job = { type: 'company', type_id: 12, name: 'Gas Station', position: 'Manager', days_in_company: 300, rating: 10 };
us.jobPoints = { jobs: { army: 0, grocer: 0 }, companies: [{ company: { id: 12, name: 'Gas Station' }, points: 3000 }] };
us.factionWars = { enemies: [{ id: 7777, name: 'Rivals', start: Math.floor(T0 / 1000) + 3600 * 30, end: null, kind: 'ranked' }], at: T0 - 300e3 };
us.equipment = { weapons: [{ type: 'Weapon', sub_type: 'Primary', name: 'Minigun', stats: { damage: 71.2, accuracy: 51 }, bonuses: [] }, { type: 'Weapon', sub_type: 'Secondary', name: 'Raven MP25', stats: { damage: 60, accuracy: 55 }, bonuses: [] }], armour: [] };
us.equipmentAt = T0 - 3600e3;
put('userStatic', us);

// xanaxCds 30.
put('xanaxCds', Array.from({ length: 30 }, (_, i) => ({ at: T0 - (30 - i) * 8 * 3600e3, min: ri(360, 480) })));

// Torn Eye GM keys: myAttacks (100 attacks), eyeTargets (~300), eyeWatch (50), eyeWatchState (50), eyeFlights (400), eyeWarAuto.
put('myAttacks', { at: T0 - 1800e3, list: Array.from({ length: 100 }, (_, i) => ({ def: ri(100000, 3999999), ended: Math.floor(T0 / 1000) - i * 3000, ff: 1 + Math.round(rnd() * 200) / 100, result: pick(['Attacked', 'Mugged', 'Hospitalized', 'Lost', 'Stalemate']), respect: Math.round(rnd() * 800) / 100, level: ri(10, 100) })), incoming: Array.from({ length: 10 }, (_, i) => ({ att: ri(100000, 3999999), name: pick(names), level: ri(10, 100), ended: Math.floor(T0 / 1000) - i * 3000, result: 'Attacked' })) });
put('eyeTargets', { at: T0 - 86400e3, params: { minLevel: 1, maxLevel: 100, inactiveOnly: true, factionless: false }, list: Array.from({ length: 300 }, () => ({ playerId: ri(100000, 3999999), name: pick(names) + ri(1, 999), level: ri(10, 100), fairFight: 1 + Math.round(rnd() * 200) / 100, bsEstimate: ri(1e6, 2e9), lastAction: Math.floor(T0 / 1000) - ri(1, 90) * 86400, hospitalUntil: null, band: pick(['stomp', 'good', 'tough']), win: Math.round(rnd() * 1000) / 1000, keep: Math.round(rnd() * 1000) / 1000, respect: Math.round(rnd() * 800) / 100, ours: false, source: 'ffs', ageDays: ri(0, 60) })), dropped: 120, asked: 12, found: 420, ffIgnored: false });
const watchList = Array.from({ length: 50 }, (_, i) => ({ id: 400000 + i, name: pick(names) + i, level: ri(10, 100), tag: pick([null, 'bounty', 'war', 'revenge']), addedAt: T0 - i * 86400e3 }));
put('eyeWatch', { list: watchList, dismissed: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [500000 + i, T0 - i * 3600e3])) });
put('eyeWatchState', { at: T0 - 30e3, players: Object.fromEntries(watchList.map((w) => [w.id, { id: w.id, name: w.name, level: w.level, status: { state: pick(['Okay', 'Hospital', 'Traveling']), until: Math.floor(T0 / 1000) + ri(0, 3600), description: 'In hospital for 12 mins' }, lastAction: { status: 'Offline', timestamp: Math.floor(T0 / 1000) - ri(60, 86400) }, life: { current: 7000, maximum: 7500 }, readAt: T0 - ri(10, 300) * 1000, events: [] }])) });
put('eyeFlights', Object.fromEntries(Array.from({ length: 400 }, () => [String(ri(100000, 3999999)), { desc: pick(['Traveling to Mexico', 'Traveling to Japan', 'In Switzerland', 'Returning to Torn from Cayman Islands']), at: T0 - ri(0, 11) * 3600e3 }])));
put('eyeWarAuto', { at: T0 - 300e3, enemies: [{ id: 7777, name: 'Rivals', start: Math.floor(T0 / 1000) + 3600 * 30, end: null }] });
// Shared request windows: several tabs' timestamps (tab-window.js), lanes, focus, third-party windows.
const tabs = {};
// Two earlier pages' request windows (a few calls each, ~1-2 minutes old) and two older tabs' keys not yet cleaned up.
for (let i = 0; i < 4; i++) {
    const t = 'tab' + i + '-x' + i;
    tabs[t] = T0 - 40e3 - i * 30e3;
    put('apiWindow.' + t, Array.from({ length: 6 }, (_, j) => T0 - 40e3 - i * 30e3 - j * 9000));
    put('apiLane_prices.' + t, Array.from({ length: 3 }, (_, j) => T0 - 40e3 - i * 30e3 - j * 9000));
}
put('apiWindow.tabs', tabs);
put('apiLane_prices.tabs', tabs);
put('apiFocus', Object.fromEntries(Object.keys(tabs).map((t) => [t, { focus: 'prices', war: false, at: T0 - 2000 }])));
put('ffsWindow', { stamps: Array.from({ length: 50 }, (_, j) => T0 - j * 1000) });
put('skippedSteps', [{ id: 'x', at: T0 - 3600e3 }]);
delete out[P + 'compareCache'];
delete out[P + 'eventCompareCache'];

// IndexedDB 'eye': 3,000 players (FFScouter row, public profile) and 300 players' gear.
const players = {};
for (let i = 0; i < 3000; i++) {
    const id = 100000 + i * 7;
    players[id] = { ffs: { playerId: id, bsEstimate: ri(1e6, 3e9), bssPublic: null, fairFight: 1 + Math.round(rnd() * 200) / 100, updatedAt: T0 - ri(1, 90) * DAY, source: 'bss', distribution: null }, ffsAt: T0 - ri(1, 5) * DAY, seen: T0 - ri(1, 90) * DAY, ...(i % 3 === 0 ? { profile: { level: ri(1, 100), rank: 'Supreme Hitman', life: 7300, status: { state: 'Okay', description: 'Okay' }, name: 'P' + id, faction: ri(1, 50000) }, profileAt: T0 - ri(1, 5) * DAY } : {}) };
}
const gear = {};
for (let i = 0; i < 300; i++) gear[100000 + i * 7] = { items: [{ id: 1, name: 'Minigun', damage: 71.2, accuracy: 51, bonuses: [] }, { id: 2, name: 'Riot Helmet', armor: 40 }], seenAt: T0 - ri(1, 30) * DAY };
// receiptsDays < 120: the same store with only the newest days of receipts.
if (receiptsDays < 120) {
    const r = JSON.parse(out[P + 'receipts']);
    const ks = Object.keys(r.days).sort();
    r.days = Object.fromEntries(ks.slice(-receiptsDays).map((k) => [k, r.days[k]]));
    out[P + 'receipts'] = JSON.stringify(r);
}
return { gm: out, eye: { players, gear, savedAt: T0 - 60e3 } };
}
