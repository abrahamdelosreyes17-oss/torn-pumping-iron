/*
 * The lowest price we saw each Torn day, per item, for the last few weeks.
 * Pure - the caller stores it. (The trading app's core/history.js idea:
 * no API gives price history, so we write down what we see.)
 *
 * store = {v: 1, items: {[itemId]: {[dayNumber]: lowest}}}
 */

export const HISTORY_DAYS_KEPT = 30;
export const DAY_MS = 86400000;

export function emptyPriceHistory() {
    return { v: 1, items: {} };
}

export function readPriceHistory(raw) {
    return raw && raw.v === 1 && raw.items && typeof raw.items === 'object' ? raw : emptyPriceHistory();
}

const dayOf = (t) => Math.floor(t / DAY_MS);

/** Remember a price seen now; keeps the day's lowest. Returns a new store. */
export function recordPrice(store, itemId, now, price) {
    if (!(price > 0)) return store;
    const s = readPriceHistory(store);
    const d = dayOf(now);
    const rec = { ...(s.items[itemId] || {}) };
    rec[d] = rec[d] > 0 ? Math.min(rec[d], price) : price;
    for (const k of Object.keys(rec)) if (Number(k) <= d - HISTORY_DAYS_KEPT) delete rec[k];
    return { ...s, items: { ...s.items, [itemId]: rec } };
}

/** Daily lows for the last `days` days, oldest first; null where nothing was seen. */
export function dailyLows(store, itemId, now, days = 7) {
    const rec = readPriceHistory(store).items[itemId] || {};
    const d = dayOf(now);
    const out = [];
    for (let i = days - 1; i >= 0; i--) out.push(rec[d - i] > 0 ? rec[d - i] : null);
    return out;
}

/** Average of the daily lows over the last 7 days, and how many days it covers. */
export function average7(store, itemId, now) {
    const lows = dailyLows(store, itemId, now, 7).filter((v) => v !== null);
    if (!lows.length) return { avg: null, days: 0 };
    return { avg: lows.reduce((a, b) => a + b, 0) / lows.length, days: lows.length };
}
