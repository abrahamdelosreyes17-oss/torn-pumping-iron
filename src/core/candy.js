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

import { ITEMS, CANDY_IDS, BOOSTER_CAP_H, boostersThatFit, itemName } from './items.js';

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
 * @returns {null|{id, name, count, happyEach, unit, source, shop, perBoost, gained, cost, fits, options:object[]}}
 */
export function bestCandy({ prices = {}, npc = {}, capH = BOOSTER_CAP_H, cdH = 0, cdCuts = 1, happyMult = 1, budget = Infinity, boosts = 1, pickBy = 'most', base = null, evaluate = null, count = null } = {}) {
    const cands = candyCandidates(candyPrices(prices, npc));
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
    return { ...best, options };
}

/** "Lollipop × 49" (the words steps, Plan and Buy use). */
export function candyWords(c) {
    if (!c || !c.id) return 'Candy';
    return itemName(c.id) + (c.count ? ' × ' + c.count : '');
}
