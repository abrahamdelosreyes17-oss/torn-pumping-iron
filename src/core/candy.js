/*
 * Which candy a boost or jump uses, and how many. Pure.
 *
 * The owner: "we're defaulting to whatever Pumping Iron says we should take,
 * it should just tell us what we should take/buy." So there is no default
 * candy: every candy with a known price is weighed under the Plan's rule
 * (most stats in the budget, best value for money, or max gains) and the
 * winner is named everywhere (steps, Plan, Buy, Discord).
 *
 * Every candy costs the same booster cooldown (30 min, less with the
 * consumable cuts), so a boost holds the same number of any of them; what
 * differs is the happy each gives and its price.
 */

import { ITEMS, CANDY_IDS, BOOSTER_CAP_H, boostersThatFit, itemName, isCandy } from './items.js';

/**
 * The cheapest known price of each candy: the market (item market and
 * bazaars, as the app loaded them) or an NPC shop the player ticked.
 * @param {object} prices - {[id]: $ per unit} (market)
 * @param {object} [npc] - {[id]: {price, shop}} NPC shop prices the player may use
 * @returns {object} {[id]: {id, price, source:'market'|'npc', shop}}
 */
export function candyPrices(prices = {}, npc = {}) {
    const out = {};
    for (const id of CANDY_IDS) {
        const m = Number(prices && prices[id]);
        const n = npc && npc[id] && Number(npc[id].price);
        if (n > 0 && !(m > 0 && m <= n)) out[id] = { id, price: n, source: 'npc', shop: npc[id].shop || null };
        else if (m > 0) out[id] = { id, price: m, source: 'market', shop: null };
    }
    return out;
}

/**
 * Candy worth weighing: a candy another beats on both happy and price is
 * dropped (Lollipop vs Box of Chocolate Bars: the cheaper 25-happy one stays).
 * @param {object} priced - candyPrices() output
 * @returns {object[]} fewest happy first
 */
export function candyCandidates(priced) {
    const list = Object.values(priced || {}).filter((c) => c && c.price > 0 && ITEMS[c.id]);
    return list
        .filter((c) => !list.some((o) => o !== c && ITEMS[o.id].happy >= ITEMS[c.id].happy && o.price <= c.price && (ITEMS[o.id].happy > ITEMS[c.id].happy || o.price < c.price || o.id < c.id)))
        .sort((a, b) => ITEMS[a.id].happy - ITEMS[b.id].happy || a.price - b.price);
}

/** How many candy fit one boost: the booster cap from `cdH` already used, each 30 min × the cuts. */
export function candyCount({ capH = BOOSTER_CAP_H, cdH = 0, cdMult = 1 } = {}) {
    return boostersThatFit(CANDY_IDS[0], capH, cdH, cdMult);
}

/**
 * The candy that gives the most stats under the Plan's rule.
 *
 * Without `evaluate`, each candy is scored by the happy it adds (a stand-in
 * for stats: more happy, more stats) and the cost of `boosts` boosts. With
 * `evaluate(id, count)` returning the whole plan's {gained, cost} (the
 * engine passes a simulation), the scores are real stats and money, and
 * `budget` is the plan's budget.
 *
 * @param {object} o
 * @param {object} o.prices - {[id]: $} market unit prices
 * @param {object} [o.npc] - {[id]: {price, shop}} NPC shop prices the player may use (ticked shops only)
 * @param {number} [o.capH] - booster cooldown cap, hours (24; faction Voracity up to 48)
 * @param {number} [o.cdH] - booster cooldown already used, hours
 * @param {number} [o.cdCuts] - the consumable cooldown cuts as one multiplier (0.9 × 0.75 × 0.5 …)
 * @param {number} [o.happyMult] - candy happy perks and events (Voracity +50%, a book ×2, World Diabetes Day ×3)
 * @param {number} [o.budget] - money the candy may cost: over `boosts` boosts (proxy), or the whole plan (evaluate)
 * @param {number} [o.boosts] - boosts the budget covers (Auto mode: boosts a day with a daily budget)
 * @param {string} [o.pickBy] - 'most' (most stats in the budget) | 'value' (most stats per $) | 'max' (no budget)
 * @param {object} [o.base] - {gained, cost} of the rest of the plan (proxy scores, for 'value')
 * @param {function} [o.evaluate] - (id, count) => {gained, cost} of the whole plan with that candy
 * @param {number} [o.count] - a fixed count per boost instead of filling the booster cap
 * @param {number} [o.prefer] - the candy picked earlier today: kept while it gives the same happy and the
 *   winner isn't at least CANDY_SWITCH_PCT cheaper for the whole boost (so the name doesn't flip on every price load)
 * @returns {null|{id, name, count, happyEach, unit, source, shop, perBoost, gained, cost, fits, options:object[]}}
 */
export function bestCandy({ prices = {}, npc = {}, capH = BOOSTER_CAP_H, cdH = 0, cdCuts = 1, happyMult = 1, budget = Infinity, boosts = 1, pickBy = 'most', base = null, evaluate = null, count = null, prefer = null } = {}) {
    const priced = candyPrices(prices, npc);
    const cands = candyCandidates(priced);
    // Today's pick stays in the running even when another +same-happy candy is a little cheaper (it's kept unless 10% cheaper).
    if (prefer && priced[prefer] && !cands.some((c) => c.id === Number(prefer))) cands.push(priced[prefer]);
    if (!cands.length) return null;
    const n = count > 0 ? Math.floor(count) : candyCount({ capH, cdH, cdMult: cdCuts });
    if (!(n > 0)) return null;
    const limit = pickBy === 'max' ? Infinity : budget;
    const options = cands.map((c) => {
        const happyEach = ITEMS[c.id].happy * (happyMult || 1);
        const perBoost = n * c.price;
        let gained;
        let cost;
        if (evaluate) {
            const r = evaluate(c.id, n) || {};
            gained = Number(r.gained) || 0;
            cost = Number(r.cost) || 0;
        } else {
            gained = (base ? Number(base.gained) || 0 : 0) + boosts * n * happyEach;
            cost = (base ? Number(base.cost) || 0 : 0) + boosts * perBoost;
        }
        const own = evaluate ? cost : boosts * perBoost;
        return { id: c.id, name: itemName(c.id), count: n, happyEach, unit: c.price, source: c.source, shop: c.shop, perBoost, gained, cost, fits: own <= limit };
    });
    const perM = (o) => (o.cost > 0 ? o.gained / o.cost : Infinity);
    const pool = options.filter((o) => o.fits);
    let best;
    if (!pool.length) best = options.reduce((a, b) => (b.cost < a.cost ? b : a));
    else if (pickBy === 'value') best = pool.reduce((a, b) => (perM(b) > perM(a) || (perM(b) === perM(a) && b.gained > a.gained) ? b : a));
    else best = pool.reduce((a, b) => (b.gained > a.gained || (b.gained === a.gained && b.cost < a.cost) ? b : a));
    // Owner (2026-09-29): the candy named flipped between reloads (every +25 candy is interchangeable). Today's pick stays
    // unless the new one gives more happy or saves at least CANDY_SWITCH_PCT on the boost.
    const kept = prefer ? options.find((o) => o.id === Number(prefer) && o.fits) : null;
    if (kept && kept.id !== best.id && kept.happyEach === best.happyEach && best.perBoost > kept.perBoost * (1 - CANDY_SWITCH_PCT / 100)) best = kept;
    return { ...best, options };
}

/** A candy picked earlier today is kept unless another saves this much on the boost (%). */
export const CANDY_SWITCH_PCT = 10;

/** "Lollipop × 49" (the words steps, Plan and Buy use). */
export function candyWords(c) {
    if (!c || !c.id) return 'Candy';
    return itemName(c.id) + (c.count ? ' × ' + c.count : '');
}

/** What an item adds, for pooling: candy by happy, energy drinks by energy. */
function poolValue(id) {
    const it = ITEMS[id];
    if (!it) return 0;
    return it.category === 'Candy' ? it.happy || 0 : it.energy || 0;
}

/** Items that share a pool with `pickId`: every candy (same 30 min of booster cooldown), every energy drink (2 h). */
export function poolOf(pickId) {
    const it = ITEMS[pickId];
    if (!it) return null;
    return it.category === 'Candy' || it.category === 'Energy Drink' ? it.category : null;
}

/**
 * Fill a boost's slots from what you hold first (owner, 2026-09-29: "it should exhaust my inventory first").
 * Candy is a pool: each one takes the same booster cooldown, only its happy differs; energy drinks the same by
 * energy. Held items with as much or more than the pick go in first (the most first), then the pick is bought
 * for the rest. EDVD, FHC and everything else only count the same item held.
 * @param {number} qty - slots in this boost
 * @param {number} pickId - the plan's pick (what is bought)
 * @param {object} held - {[id]: qty} still held (not changed here)
 * @returns {{alloc:{id, qty, held}[], held:number, buy:number, value:number}} value: happy (candy) or energy (drinks) before perks
 */
export function fillFromPool(qty, pickId, held = {}) {
    const n = Math.max(0, Math.floor(qty || 0));
    const pool = poolOf(pickId);
    const floor = poolValue(pickId);
    const rows = Object.entries(held || {})
        .map(([id, q]) => [Number(id), Math.max(0, Math.floor(Number(q) || 0))])
        .filter(([id, q]) => q > 0 && ITEMS[id] && (pool ? poolOf(id) === pool && poolValue(id) >= floor : id === pickId))
        .sort((a, b) => poolValue(b[0]) - poolValue(a[0]) || b[1] - a[1] || a[0] - b[0]);
    const alloc = [];
    let left = n;
    for (const [id, q] of rows) {
        if (left <= 0) break;
        const take = Math.min(q, left);
        alloc.push({ id, qty: take, held: take });
        left -= take;
    }
    if (left > 0) {
        const same = alloc.find((a) => a.id === pickId);
        if (same) same.qty += left;
        else alloc.push({ id: pickId, qty: left, held: 0 });
    }
    return { alloc, held: n - left, buy: left, value: alloc.reduce((a, x) => a + x.qty * poolValue(x.id), 0) };
}

/** Take a fill's held items out of `held` (the day plan and the simulator carry what's left to the next boost). */
export function takeFromHeld(held, fill) {
    for (const a of (fill && fill.alloc) || []) if (a.held > 0) held[a.id] = Math.max(0, (Number(held[a.id]) || 0) - a.held);
}

/**
 * A boost's candy in words: "Lollipop × 49", or with what you hold, "Candy × 49: your 29 Chocolate Kisses +
 * 20 Lollipop". `buy` says what is still bought ("buy 0" when the inventory covers it).
 */
export function fillWords(fill, pickId) {
    if (!fill || !fill.alloc.length) return candyWords({ id: pickId });
    const total = fill.held + fill.buy;
    if (fill.alloc.length === 1) {
        const a = fill.alloc[0];
        return itemName(a.id) + ' × ' + total + (a.held ? ' (' + (a.held === a.qty ? 'all yours' : a.held + ' yours, buy ' + (a.qty - a.held)) + ')' : '');
    }
    const noun = isCandy(pickId) ? 'Candy' : 'Energy drinks';
    const parts = fill.alloc.map((a) => (a.held === a.qty ? 'your ' + a.qty + ' ' + itemName(a.id) : a.qty + ' ' + itemName(a.id) + (a.held ? ' (' + a.held + ' yours)' : '')));
    return noun + ' × ' + total + ': ' + parts.join(' + ');
}

/** "your 29 Chocolate Kisses + 20 Lollipop · buy 0" for the step's note (null when nothing is held). */
export function heldWords(fill) {
    if (!fill || !fill.held) return null;
    const held = fill.alloc.filter((a) => a.held > 0).map((a) => a.held + ' ' + itemName(a.id));
    return 'from your items: ' + held.join(' + ') + ' · buy ' + fill.buy;
}

/**
 * The candy disclaimer (owner, 2026-09-29: the named candy changed between reloads): every candy with the same
 * happy is interchangeable. "any +25 candy works the same (Lollipop, Bag of Bon Bons, Chocolate Kisses…)".
 */
export function tierWords(id) {
    const it = ITEMS[id];
    if (!it || it.category !== 'Candy') return '';
    const same = CANDY_IDS.filter((c) => ITEMS[c].happy === it.happy);
    if (same.length < 2) return '';
    const names = [id, ...same.filter((c) => c !== id)].slice(0, 3).map(itemName);
    return 'any +' + it.happy + ' candy works the same (' + names.join(', ') + (same.length > 3 ? '…' : '') + ')';
}
