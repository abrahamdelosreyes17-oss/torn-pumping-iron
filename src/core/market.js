/*
 * What to buy and where: the need list from the plan, the cheapest fill
 * across the Item Market, every bazaar (TornW3B) and the points market, and
 * a verdict against our own 7-day history. Pure. ENGINE-SPEC §8.
 */

import { POINTS, ITEMS, itemName } from './items.js';
import { bazaarUrl, itemMarketUrl, pointsMarketUrl } from '../sources/route.js';

export const SOURCE_BAZAAR = 'bazaar';
export const SOURCE_ITEM_MARKET = 'itemmarket';
export const SOURCE_POINTS = 'points';

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
    return Object.entries(needed || {})
        .map(([k, q]) => {
            const id = k === POINTS ? POINTS : Number(k);
            const have = Math.max(0, Number(inventory[id]) || 0);
            return { id, name: itemName(id), need: q, have, buy: Math.max(0, q - have) };
        })
        .filter((r) => r.need > 0)
        .sort((a, b) => order(a.id) - order(b.id) || String(a.id).localeCompare(String(b.id)));
}

/** Where a row sends you: the exact bazaar, Item Market search or the points market. */
export function linkFor(row, itemId) {
    if (row.source === SOURCE_BAZAAR && row.sellerId) return bazaarUrl(row.sellerId);
    if (row.source === SOURCE_POINTS) return pointsMarketUrl();
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
        const row = { source: l.source, sellerId: l.sellerId || null, sellerName: l.sellerName || null, listed: l.qty, qty: take, price: l.price, subtotal: take * l.price };
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
    if (ls.length) {
        const f = fillCheapest(ls, qty, null);
        if (f.filled > 0) return f.total / f.filled;
    }
    return row.avg7 > 0 ? row.avg7 : null;
}

/** {itemId: price row} → {itemId: $ per unit}, only the ones known (points: per point, 300 at a time). */
export function livePrices(rows) {
    const out = {};
    for (const [id, row] of Object.entries(rows || {})) {
        const p = unitPrice(row, id === POINTS ? 300 : 10);
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
    return 'Item Market';
}
