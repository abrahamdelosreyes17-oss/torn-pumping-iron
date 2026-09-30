/*
 * What to buy and where: the need list from the plan, the cheapest fill
 * across the Item Market, every bazaar (TornW3B) and the points market, and
 * a verdict against our own 7-day history. Pure. ENGINE-SPEC §8.
 */

import { POINTS, ITEMS, itemName, isCandy } from './items.js';
import { bazaarUrl, itemMarketUrl, pointsMarketUrl, shopUrl } from '../sources/route.js';
import { poolOf, fillFromPool, takeFromHeld } from './candy.js';
import { tornDayStart } from './bars.js';

export const SOURCE_BAZAAR = 'bazaar';
export const SOURCE_ITEM_MARKET = 'itemmarket';
export const SOURCE_POINTS = 'points';
/** A city (NPC) shop: Sally's Sweet Shop and the like. */
export const SOURCE_NPC = 'npc';

/**
 * The slice of /v2/torn/{ids}/items the plan keeps: Torn's market price and
 * the city shops that sell each item (only shops in Torn: abroad needs a flight).
 * @param {object[]} items - the `items` array
 * @returns {object} {[id]: {market:number|null, shops:[{shop, buy}]}}
 */
export function itemsInfoFrom(items) {
    const out = {};
    for (const it of Array.isArray(items) ? items : []) {
        const id = Number(it && it.id);
        if (!id) continue;
        const v = it.value || {};
        const shops = (Array.isArray(v.shops) ? v.shops : [])
            .filter((s) => s && (s.country === undefined || s.country === 'Torn') && Number(s.buy_price) > 0)
            .map((s) => ({ shop: String(s.shop), buy: Number(s.buy_price) }));
        out[id] = { market: Number(v.market_price) > 0 ? Number(v.market_price) : null, shops };
    }
    return out;
}

/** Torn's own market price per item (a price to weigh a candy by until listings load). */
export function marketPricesFrom(info) {
    const out = {};
    for (const [id, v] of Object.entries(info || {})) if (v && v.market > 0) out[id] = v.market;
    return out;
}

/** The city shops that sell candy (Buy › Shops I can buy from lists these). */
export function candyShopsFrom(info) {
    const set = new Set();
    for (const [id, v] of Object.entries(info || {})) if (isCandy(Number(id))) for (const s of (v && v.shops) || []) set.add(s.shop);
    return [...set].sort();
}

/** Sally's Sweet Shop: counted by default (owner, 2026-09-29), the Buy tick switches it off. */
export const SALLYS = "Sally's Sweet Shop";
export const DEFAULT_SHOPS = [SALLYS];

/**
 * Torn's Daily Items Allowance: 100 items a day from the city shops, all of them together, reset at 00:00 TCT
 * (docs/research-sallys-xanax.md, 4 sources). Read from the personal stat `cityitemsbought`.
 */
export const CITY_DAILY_ALLOWANCE = 100;

/** The city shops the plan may buy from: Sally's unless switched off, plus any other shop ticked. */
export function shopsAllowed(settings = {}) {
    const off = new Set(Array.isArray(settings.npcShopsOff) ? settings.npcShopsOff : []);
    const on = new Set([...DEFAULT_SHOPS, ...(Array.isArray(settings.npcShops) ? settings.npcShops : [])]);
    return [...on].filter((x) => !off.has(x)).sort();
}

/** A shop's tick clicked: the settings patch ({npcShops, npcShopsOff}). */
export function toggleShop(settings = {}, shop) {
    const onNow = shopsAllowed(settings).includes(shop);
    const on = new Set(Array.isArray(settings.npcShops) ? settings.npcShops : []);
    const off = new Set(Array.isArray(settings.npcShopsOff) ? settings.npcShopsOff : []);
    if (onNow) {
        on.delete(shop);
        off.add(shop);
    } else {
        off.delete(shop);
        on.add(shop);
    }
    return { npcShops: [...on], npcShopsOff: [...off] };
}

/**
 * Today's city-shop allowance left: 100 less what `cityitemsbought` rose since the Torn day began. Null
 * until both reads are in (and for a read from an earlier Torn day).
 * @param {object} cs - {day, start, now} stored by the feed
 */
export function allowanceLeft(cs, now) {
    if (!cs || !(Number.isFinite(cs.start) && Number.isFinite(cs.now))) return null;
    if (tornDayStart(now) !== cs.day) return CITY_DAILY_ALLOWANCE;
    return Math.max(0, CITY_DAILY_ALLOWANCE - Math.max(0, cs.now - cs.start));
}

/**
 * NPC prices the player may use: only shops they ticked (Torn's API can't
 * tell who may buy there; the owner: Sally's is for newbies only).
 * @returns {object} {[id]: {price, shop}} the cheapest ticked shop per item
 */
export function npcPricesFrom(info, allowed = []) {
    const ok = new Set(Array.isArray(allowed) ? allowed : []);
    const out = {};
    if (!ok.size) return out;
    for (const [id, v] of Object.entries(info || {})) {
        for (const s of (v && v.shops) || []) {
            if (!ok.has(s.shop)) continue;
            if (!out[id] || s.buy < out[id].price) out[id] = { price: s.buy, shop: s.shop };
        }
    }
    return out;
}

/**
 * A shop "listing" for the Buy list: as many as needed at the shop's price, up to what's left of today's
 * city-shop allowance (`left`; null = not read yet, 100 at most). None once the allowance is used up.
 */
export function npcListing(npc, qty, left = null) {
    if (!npc || !(npc.price > 0)) return null;
    const cap = left === null || left === undefined ? CITY_DAILY_ALLOWANCE : Math.max(0, Math.floor(left));
    const n = Math.min(Math.max(1, Math.floor(qty || 1)), cap);
    if (!(n > 0)) return null;
    return { source: SOURCE_NPC, shop: npc.shop, sellerName: npc.shop, price: npc.price, qty: n };
}

/** Verdict thresholds vs the 7-day average of the lowest price. */
export const BUY_NOW_MAX_PCT = 1;
export const WAIT_OVER_PCT = 3;
export const BULK_UNDER_PCT = 3;

/** Bazaar listings TornW3B hasn't re-checked in this long are dropped (Torn Trading's rule). */
export const BAZAAR_MAX_AGE_MS = 2 * 60 * 1000;

/** Buy windows (Buy tab switch). */
export const WINDOWS = { today: 1, three: 3, week: 7 };

/**
 * @param {object} needed - {[itemId]: qty} for the window (plan.itemsNeeded over those days)
 * @param {object} inventory - {[itemId]: qty held}
 * @returns {{id, need:number, have:number, buy:number}[]} in a stable order (drugs, boosters, points)
 */
export function needList(needed, inventory = {}) {
    const order = (id) => (id === POINTS ? 3 : ITEMS[id] && ITEMS[id].kind === 'drug' ? 1 : 2);
    const rows = Object.entries(needed || {})
        .map(([k, q]) => {
            const id = k === POINTS ? POINTS : Number(k);
            const have = Math.max(0, Number(inventory[id]) || 0);
            return { id, name: itemName(id), need: q, have, buy: Math.max(0, q - have) };
        })
        .filter((r) => r.need > 0)
        .sort((a, b) => order(a.id) - order(b.id) || String(a.id).localeCompare(String(b.id)));
    // Candy and energy drinks are pools (owner: "it should exhaust my inventory first"): held ones the plan doesn't
    // use yet cover a need for another with as much or less happy (energy), so nothing held is bought again.
    const spare = {};
    for (const [k, q] of Object.entries(inventory || {})) {
        const id = Number(k);
        if (!poolOf(id) || !(Number(q) > 0)) continue;
        const used = rows.find((r) => r.id === id);
        spare[id] = Math.max(0, Math.floor(Number(q)) - (used ? used.need : 0));
    }
    for (const r of rows) {
        if (!(r.buy > 0) || !poolOf(r.id)) continue;
        const f = fillFromPool(r.buy, r.id, Object.fromEntries(Object.entries(spare).filter(([id]) => Number(id) !== r.id)));
        if (!f.held) continue;
        takeFromHeld(spare, f);
        r.fromPool = f.alloc.filter((a) => a.held > 0).map((a) => ({ id: a.id, name: itemName(a.id), qty: a.held }));
        r.buy = f.buy;
    }
    return rows;
}

/** Where a row sends you: the exact bazaar, Item Market search or the points market. */
export function linkFor(row, itemId) {
    if (row.source === SOURCE_BAZAAR && row.sellerId) return bazaarUrl(row.sellerId);
    if (row.source === SOURCE_POINTS) return pointsMarketUrl();
    if (row.source === SOURCE_NPC) return shopUrl(row.shop);
    return itemMarketUrl(itemId);
}

/**
 * Take `qty` from the cheapest listings upward, whatever the source.
 * Listings: {source, sellerId?, sellerName?, price, qty}. Ties keep the
 * given order (callers list the Item Market first: no trip to a bazaar for
 * the same price).
 * @returns {{rows:object[], total:number, filled:number, short:number}}
 */
export function fillCheapest(listings, qty, itemId) {
    const sorted = (listings || [])
        .filter((l) => l && Number(l.price) > 0 && Number(l.qty) > 0)
        .map((l, i) => ({ ...l, i }))
        .sort((a, b) => a.price - b.price || a.i - b.i);
    const rows = [];
    let left = Math.max(0, qty);
    let total = 0;
    for (const l of sorted) {
        if (left <= 0) break;
        const take = Math.min(left, l.qty);
        const row = { source: l.source, sellerId: l.sellerId || null, sellerName: l.sellerName || null, listingId: l.listingId || null, listed: l.qty, qty: take, price: l.price, subtotal: take * l.price, dataAt: l.dataAt || null, ...(l.shop ? { shop: l.shop } : {}) };
        row.link = linkFor(row, itemId);
        rows.push(row);
        total += row.subtotal;
        left -= take;
    }
    return { rows, total, filled: qty - left, short: left };
}

/**
 * Buy now, fine, wait or stock up, from the cheapest price against the
 * 7-day average of daily lows.
 * @param {number} price - the cheapest price now
 * @param {number|null} avg7
 * @param {object} [o] - {slack: the plan can wait a day (enough in inventory for today)}
 */
export function priceVerdict(price, avg7, { slack = false } = {}) {
    if (!(avg7 > 0) || !(price > 0)) return { kind: 'unknown', pct: null, text: 'No 7-day history yet' };
    const pct = (100 * (price - avg7)) / avg7;
    const vs = Math.abs(pct) < 0.05 ? 'at the 7-day average' : Math.abs(pct).toFixed(1) + '% ' + (pct < 0 ? 'under' : 'over') + ' the 7-day average';
    if (pct <= -BULK_UNDER_PCT) return { kind: 'bulk', pct, text: 'Stock up · ' + vs };
    if (pct <= BUY_NOW_MAX_PCT) return { kind: 'buy', pct, text: 'Buy now · ' + vs };
    if (pct > WAIT_OVER_PCT && slack) return { kind: 'wait', pct, text: 'Wait · ' + vs };
    return { kind: 'fine', pct, text: 'Fine · ' + vs };
}

/**
 * Listings from each source in one shape.
 * - Item Market (/v2/market/{id}/itemmarket): itemmarket.listings[{price, amount}]
 * - TornW3B (/api/marketplace/{id}): listings[{player_id, player_name, price, quantity}]
 * - Points market (/v2/market/pointsmarket): pointsmarket[{id, cost, quantity}] (cost per point)
 */
export function listingsFromItemMarket(api) {
    const im = api && (api.itemmarket || api);
    const list = im && Array.isArray(im.listings) ? im.listings : [];
    return list.map((l) => ({ source: SOURCE_ITEM_MARKET, price: Number(l.price), qty: Number(l.amount ?? l.quantity) || 0 }));
}

/**
 * TornW3B's bazaar listings. With `now`, only listings re-checked within
 * BAZAAR_MAX_AGE_MS stay (Torn Trading's rule: an older one is often gone),
 * and never a $1 listing (locked, one person's).
 */
export function listingsFromW3b(api, { now = null, maxAgeMs = BAZAAR_MAX_AGE_MS } = {}) {
    const list = api && Array.isArray(api.listings) ? api.listings : [];
    const rows = list.map((l) => ({ source: SOURCE_BAZAAR, sellerId: l.player_id ? String(l.player_id) : null, sellerName: l.player_name || null, price: Number(l.price), qty: Number(l.quantity) || 0, dataAt: toMs(l.last_checked) || toMs(l.content_updated) }));
    if (now === null) return rows;
    return rows.filter((r) => r.sellerId && r.price > 1 && r.dataAt && now - r.dataAt <= maxAgeMs);
}

/** Seconds or milliseconds → milliseconds (TornW3B sends seconds). */
function toMs(v) {
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n < 1e12 ? n * 1000 : n;
}

/**
 * The price a plan should count for an item: what `qty` units cost from the
 * cheapest listings up, per unit. Stored price rows are objects
 * ({at, listings, avg7}), sample prices plain numbers; anything else is null
 * (never $0: a free item would win every comparison).
 */
export function unitPrice(row, qty = 10) {
    if (typeof row === 'number') return row > 0 ? row : null;
    if (!row || typeof row !== 'object') return null;
    const ls = Array.isArray(row.listings) ? row.listings : [];
    // Listings older than the row's unit price (the other site read later): the newer unit price.
    if (row.u > 0 && row.listingsAt && (row.at || 0) > row.listingsAt) return row.u;
    if (ls.length) {
        const f = fillCheapest(ls, qty, null);
        if (f.filled > 0) return f.total / f.filled;
    }
    // A small row (GM keeps no listings, round 6): the unit price worked out when they were read.
    if (row.u > 0) return row.u;
    return row.avg7 > 0 ? row.avg7 : null;
}

/**
 * The small row GM keeps for an item (round 6): no listings, the unit price
 * the plan uses (`u`, as livePrices works it out) and the cheapest (`low`).
 */
export function slimPriceRow(id, row) {
    if (!row || typeof row !== 'object') return row;
    const { listings, ...rest } = row;
    const ls = Array.isArray(listings) ? listings : [];
    const out = { ...rest };
    const u = ls.length ? unitPrice({ listings: ls }, String(id) === String(POINTS) ? 300 : isCandy(Number(id)) ? 50 : 10) : row.u;
    if (u > 0) out.u = u;
    const low = ls.length ? Math.min(...ls.filter((l) => l && l.price > 0).map((l) => l.price)) : row.low;
    if (low > 0 && Number.isFinite(low)) out.low = low;
    return out;
}

/** The last answer per stored price object: prices are parsed once per change, so this sorts each item's listings once per price load, not on every priceFor. */
const liveMemo = new WeakMap();

/**
 * {itemId: price row} → {itemId: $ per unit}, only the ones known (points: per point, 300 at a time; candy: a boost's 50).
 * Read-only: the same object comes back for the same rows (copy before changing).
 */
export function livePrices(rows) {
    if (rows && typeof rows === 'object') {
        const hit = liveMemo.get(rows);
        if (hit) return hit;
    }
    const out = computeLivePrices(rows);
    if (rows && typeof rows === 'object') liveMemo.set(rows, out);
    return out;
}

function computeLivePrices(rows) {
    const out = {};
    for (const [id, row] of Object.entries(rows || {})) {
        const p = unitPrice(row, id === POINTS ? 300 : isCandy(Number(id)) ? 50 : 10);
        if (p) out[id] = p;
    }
    return out;
}

export function listingsFromPoints(api) {
    const raw = api && api.pointsmarket;
    const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? Object.entries(raw).map(([id, v]) => ({ id, ...v })) : [];
    return list.map((l) => ({ source: SOURCE_POINTS, listingId: l.id ? String(l.id) : null, price: Number(l.cost ?? l.price), qty: Number(l.quantity) || 0 }));
}

/** A seller line: "Iron_Monk's bazaar", "Item Market", "Points market". */
export function whereText(row) {
    if (row.source === SOURCE_BAZAAR) return (row.sellerName ? row.sellerName + "'s" : 'A') + ' bazaar';
    if (row.source === SOURCE_POINTS) return 'Points market';
    if (row.source === SOURCE_NPC) return row.shop || 'City shop';
    return 'Item Market';
}
