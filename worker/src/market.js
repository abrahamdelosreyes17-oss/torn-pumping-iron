/*
 * Cheapest prices for /buy and price watches: the Item Market through
 * Torn's API with the user's own key, and bazaars through TornW3B
 * (weav3r.dev, crowd-sourced; no key ever goes there). Answers are kept a
 * few minutes in D1: TornW3B's for everyone (public data, no key), the
 * Item Market's per user (one user's key never feeds another's view).
 */

import { Q } from './db.js';
import { itemMarket } from './torn.js';
import { COMMENT } from './torn.js';
import { ITEMS } from './commands.js';
import { PAGES, money } from './format.js';

export const W3B_API = 'https://weav3r.dev/api/marketplace/';
export const WATCH_EVERY_S = 5 * 60;
export const MAX_WATCHES = 3;

export const itemName = (id) => ITEMS[id] || 'Item ' + id;

function cheapest(list, priceOf, qtyOf) {
    let best = null;
    for (const l of Array.isArray(list) ? list : []) {
        const price = Number(priceOf(l));
        const qty = Number(qtyOf(l)) || 0;
        if (!(price > 0) || qty <= 0) continue;
        if (!best || price < best.price) best = { price, qty, l };
    }
    return best;
}

async function cached(db, k, maxAgeS, nowS) {
    const r = await db.prepare(Q.priceGet).bind(k).first();
    return r && nowS - Number(r.at) <= maxAgeS ? r : null;
}

/** Cheapest Item Market listing, with the user's own key. Torn errors are thrown (dead key → caller pauses). */
export async function marketPrice(f, db, key, userId, itemId, nowS, maxAgeS) {
    const k = 'im:' + itemId + ':' + userId;
    const c = await cached(db, k, maxAgeS, nowS);
    if (c) return c.price ? { price: Number(c.price), qty: Number(c.qty) } : null;
    const d = await itemMarket(f, key, itemId);
    const im = (d && d.itemmarket) || {};
    const best = cheapest(im.listings, (l) => l.price, (l) => l.amount ?? l.quantity);
    await db.prepare(Q.pricePut).bind(k, userId, best ? best.price : 0, best ? best.qty : 0, null, nowS).run();
    return best ? { price: best.price, qty: best.qty } : null;
}

/** Cheapest bazaar listing TornW3B knows (no key, no auth header). null if TornW3B can't answer. */
export async function bazaarPrice(f, db, itemId, nowS, maxAgeS) {
    const k = 'w3b:' + itemId;
    const c = await cached(db, k, maxAgeS, nowS);
    if (c) {
        if (!c.price) return null;
        const [sellerId, sellerName] = String(c.seller || '|').split('|');
        return { price: Number(c.price), qty: Number(c.qty), sellerId, sellerName };
    }
    let d = null;
    try {
        const res = await f(W3B_API + Number(itemId) + '?comment=' + COMMENT, { headers: { accept: 'application/json' } });
        if (res.ok) d = await res.json();
    } catch {
        d = null;
    }
    if (!d) return null; // Busy or a challenge page: try again later, don't store a guess.
    const best = cheapest(d.listings, (l) => l.price, (l) => l.quantity);
    const seller = best ? String(best.l.player_id || '') + '|' + String(best.l.player_name || '').slice(0, 40) : null;
    await db.prepare(Q.pricePut).bind(k, null, best ? best.price : 0, best ? best.qty : 0, seller, nowS).run();
    return best ? { price: best.price, qty: best.qty, sellerId: String(best.l.player_id || ''), sellerName: String(best.l.player_name || '') } : null;
}

/** Both, and which is cheaper, with the Torn page to buy on. */
export async function bestPrice(f, db, key, userId, itemId, nowS, maxAgeS) {
    const market = await marketPrice(f, db, key, userId, itemId, nowS, maxAgeS);
    const bazaar = await bazaarPrice(f, db, itemId, nowS, maxAgeS);
    let best = null;
    if (market) best = { price: market.price, where: 'on the Item Market', link: PAGES.itemMarket(itemId) };
    if (bazaar && bazaar.sellerId && (!best || bazaar.price < best.price)) best = { price: bazaar.price, where: 'in ' + (bazaar.sellerName || 'a') + '’s bazaar (TornW3B)', link: PAGES.bazaar(bazaar.sellerId) };
    return { market, bazaar, best };
}

/** The /buy answer. */
export function buyMessage(itemId, { market, bazaar, best }) {
    const name = itemName(itemId);
    const lines = [];
    lines.push('Item Market: ' + (market ? money(market.price) + ' (' + market.qty + ' at that price)' : 'none listed'));
    lines.push('Bazaar: ' + (bazaar ? money(bazaar.price) + ' · ' + (bazaar.sellerName || '?') + ' (' + bazaar.qty + ')' : 'TornW3B has nothing right now'));
    if (market && bazaar) {
        const diff = market.price - bazaar.price;
        lines.push(diff > 0 ? 'Cheapest: the bazaar, ' + money(diff) + ' less' : diff < 0 ? 'Cheapest: the Item Market, ' + money(-diff) + ' less' : 'Same price: the Item Market (no trip)');
    }
    const buttons = [{ type: 2, style: 5, label: 'Item Market', url: PAGES.itemMarket(itemId) }];
    if (bazaar && bazaar.sellerId) buttons.push({ type: 2, style: 5, label: ((bazaar.sellerName || 'Seller') + '’s bazaar').slice(0, 80), url: PAGES.bazaar(bazaar.sellerId) });
    return {
        embeds: [{ title: name + ': cheapest now', description: lines.join('\n'), color: 0xefebe2, url: best ? best.link : PAGES.itemMarket(itemId), footer: { text: 'Bazaar prices from TornW3B (weav3r.dev), crowd-sourced. You buy in Torn yourself.' } }],
        components: [{ type: 1, components: buttons }],
    };
}

/**
 * Price watches for one user (cron, every 5 minutes): an alert when an
 * item is at or under the price; again only after it went back over.
 * @returns {Promise<{alerts: object[], watches: object[]}>}
 */
export async function watchAlerts(f, db, key, user, nowS) {
    const { results } = await db.prepare(Q.watchList).bind(user.id).all();
    const watches = (results || []).slice(0, MAX_WATCHES);
    const alerts = [];
    for (const w of watches) {
        const { best } = await bestPrice(f, db, key, user.id, w.item, nowS, WATCH_EVERY_S - 30);
        if (!best) continue;
        const under = best.price <= Number(w.price);
        if (under && !Number(w.fired)) alerts.push({ id: 'watch:' + w.item + ':' + Math.floor(nowS / WATCH_EVERY_S), kind: 'watch', item: w.item, link: best.link, title: itemName(w.item) + ' at ' + money(best.price), text: money(best.price) + ' ' + best.where + ', your watch is ' + money(w.price) + '. You buy in Torn yourself.', step: null });
        else if (!under && Number(w.fired)) await db.prepare(Q.watchMark).bind(0, user.id, w.item).run();
    }
    return { alerts, watches };
}
