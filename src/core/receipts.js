/*
 * Receipts (Progress): what you used to train, per Torn day, and "what if
 * you'd done another plan" with the same energy and money. Pure; the feed
 * stores the result (key `receipts`, 120 days like statsHistory).
 *
 * What is recorded, from two reads 30 s apart (never while paused for Torn
 * Trading: the feed asks nothing then; the first read after a pause is one
 * catch-up change that still adds its totals):
 *   - energy trained and trains, by gym and stat (the energy bar's drop,
 *     plus what a drug, booster or refill in between added);
 *   - stats gained;
 *   - items used: only when a use shows in Torn's own counters (the drug
 *     cooldown jumped, the booster cooldown jumped), then named from the
 *     inventory's drop of that kind of item. Selling or moving an item drops
 *     the inventory without a cooldown, so it never counts. Until the next
 *     inventory read names it, a use is the plan's next step (or a Xanax);
 *   - points refills and special refills;
 *   - the cheapest price seen that day for each item used (money spent).
 *
 * receipts = {v: 1, days: {[dayStart]: day}, pend: {[dayStart]: {d, bh}}, inv: {at, c: {[id]: n}} | null}
 * day = {s0: stats as recording started, e: energy, n: trains, by: {'spd@24': [trains, energy]}, gain: {str,…},
 *        items: {[id]: n}, guess: {[id]: n} (not yet seen in the inventory), px: {[id]: $ cheapest that day},
 *        refills, special, catchUp, est (energy worked out, not read)}
 */

import { STATS, gainPerTrain, totalOf } from './gain.js';
import { energyAt, tornDayStart, DAY } from './bars.js';
import { gymById, GYMS } from './gyms.js';
import { ITEMS, XANAX, POINTS, REFILL_POINTS, SAMPLE_PRICES, itemName } from './items.js';
import { unitPrice } from './market.js';
import { readPriceHistory, DAY_MS } from './history.js';
import { compareStrategies } from './model.js';

/** Days kept (like statsHistory). */
export const RECEIPT_DAYS = 120;

/** Booster cooldown hours an item may miss by and still count as that use (clock and rounding). */
export const BOOSTER_SLACK_H = 0.25;

/** The what-if runs each plan at least this many days to find its stats per energy. */
export const WHAT_IF_MIN_DAYS = 14;

/** In a catch-up after a long pause, one drug per this many hours may have been taken. */
export const DRUG_EVERY_H = 6;

export function emptyReceipts() {
    return { v: 1, days: {}, pend: {}, inv: null };
}

export function readReceipts(raw) {
    return raw && raw.v === 1 && raw.days && typeof raw.days === 'object' ? { pend: {}, inv: null, ...raw } : emptyReceipts();
}

const rcIsDrug = (id) => ITEMS[id] && ITEMS[id].kind === 'drug';
const rcIsBooster = (id) => ITEMS[id] && ITEMS[id].kind === 'booster';

/** The plan's next step names what a use probably was: {drug: id|null, boosters: {id: n}}. */
function rcHintItems(hint) {
    const out = { drug: null, boosters: {} };
    for (const it of (hint && hint.items) || []) {
        const id = Number(it.id);
        if (rcIsDrug(id) && !out.drug) out.drug = id;
        else if (rcIsBooster(id)) out.boosters[id] = (out.boosters[id] || 0) + (Number(it.qty) || 1);
    }
    return out;
}

/** Split `total` whole trains over weights, largest remainder first (stable in STATS order). */
function rcSplitWhole(total, weights) {
    const keys = Object.keys(weights).filter((k) => weights[k] > 0);
    const sum = keys.reduce((a, k) => a + weights[k], 0);
    const out = {};
    if (!keys.length || !(sum > 0)) return out;
    let left = total;
    const rem = [];
    for (const k of keys) {
        const exact = (total * weights[k]) / sum;
        out[k] = Math.floor(exact);
        left -= out[k];
        rem.push([k, exact - out[k]]);
    }
    rem.sort((a, b) => b[1] - a[1]);
    for (let i = 0; i < left; i++) out[rem[i % rem.length][0]]++;
    return out;
}

/**
 * What one read-to-read change adds to the receipts.
 * @param {object} prev - normalizeState() before
 * @param {object} next - after
 * @param {object} diff - diffStates(prev, next)
 * @param {object} o - {table, perks (per-stat multipliers), canMult, hint (the plan's next step), catchUp}
 * @returns {{at, s0, e, n, by, gain, drugs, drugGuess, boosterH, boosterGuess, refills, special, catchUp, est}}
 */
export function receiptChange(prev, next, diff, { table = GYMS, perks = null, canMult = 1, hint = null, catchUp = false } = {}) {
    const out = { at: next.at, s0: prev.stats ? { ...prev.stats } : null, e: 0, n: 0, by: {}, gain: {}, drugs: 0, drugGuess: null, boosterH: 0, boosterGuess: {}, refills: 0, special: 0, catchUp: Boolean(catchUp), est: false };
    const trained = (diff && diff.trained) || {};
    for (const k of STATS) if (trained[k] > 0) out.gain[k] = trained[k];
    const elapsed = Math.max(0, (next.at - prev.at) / 1000);
    const h = rcHintItems(hint);
    const maxE = next.energy.maximum || prev.energy.maximum || 150;
    // Uses, from Torn's own counters.
    if (diff && diff.drugTaken) {
        out.drugs = catchUp ? 1 + Math.floor(elapsed / 3600 / DRUG_EVERY_H) : 1;
        out.drugGuess = h.drug || XANAX;
    }
    if (diff && diff.boosterUsed) {
        const added = next.boosterCd - Math.max(0, prev.boosterCd - elapsed);
        out.boosterH = Math.max(0, added / 3600);
        // The plan's boosters, as many as the cooldown shows (the inventory names them later).
        let room = out.boosterH + BOOSTER_SLACK_H;
        for (const [id, n] of Object.entries(h.boosters)) {
            const each = ITEMS[id].boosterH;
            const fit = Math.min(n, Math.floor(room / each + 1e-9));
            if (fit > 0) {
                out.boosterGuess[id] = fit;
                room -= fit * each;
            }
        }
    }
    if (diff && diff.refillUsed) out.refills = 1;
    if (prev.specialRefills !== null && next.specialRefills !== null && prev.specialRefills > next.specialRefills) out.special = prev.specialRefills - next.specialRefills;

    const stats = Object.keys(out.gain);
    if (!stats.length) return out;
    const gym = gymById(next.gymId || prev.gymId, table);
    const ept = gym ? gym.energy : 0;
    // Energy: the bar's drop plus what came in between (the drug, boosters, refills).
    const expected = energyAt(prev, next.at);
    let added = 0;
    if (out.drugs) added += (ITEMS[out.drugGuess].energy || 0) * out.drugs;
    for (const [id, n] of Object.entries(out.boosterGuess)) {
        const it = ITEMS[id];
        if (it.toMax) added += Math.max(0, maxE - expected) * Math.min(1, n);
        else if (it.energy) added += Math.round(it.energy * canMult) * n;
    }
    // A refill fills the bar up to its maximum, never above (O2): the first adds what was missing, each further one a
    // full bar (the one before was trained first, or it would have added nothing).
    const fills = out.refills + out.special;
    const fillLo = fills > 0 ? Math.max(0, maxE - expected) + (fills - 1) * maxE : 0;
    const fillHi = fills * maxE;
    // The gain model's count, for when the bar can't say (and to split several stats).
    const model = {};
    let eModel = 0;
    for (const k of stats) {
        const per = gym && prev.stats ? gainPerTrain(k, prev.stats[k], prev.happy.current, gym.dots[k], ept, perks ? perks[k] : 1) : 0;
        model[k] = per > 0 ? out.gain[k] / per : 0;
        eModel += model[k] * ept;
    }
    // Refills: trained first then refilled (a full bar each) or refilled at once (what was missing); the gains decide.
    const barWith = (fill) => Math.max(0, expected + added + fill - next.energy.current);
    const eBar = fills > 0 && eModel > 0 ? [fillLo, fillHi].map(barWith).sort((a, b) => Math.abs(a - eModel) - Math.abs(b - eModel))[0] : barWith(fillLo);
    const exact = !out.drugs && !out.boosterH && !out.refills && !out.special && !catchUp;
    out.est = !exact;
    let e = eBar > 0 ? eBar : eModel;
    if (!ept) {
        out.e = Math.round(e);
        return out;
    }
    const n = Math.max(1, Math.round(e / ept));
    out.n = n;
    out.e = n * ept;
    const split = stats.length === 1 ? { [stats[0]]: n } : rcSplitWhole(n, Object.values(model).some((v) => v > 0) ? model : out.gain);
    for (const k of STATS) if (split[k] > 0) out.by[k + '@' + gym.id] = [split[k], split[k] * ept];
    return out;
}

const rcAdd = (obj, k, v) => {
    if (v) obj[k] = (obj[k] || 0) + v;
};

/** The cheapest price we know for an item now (or null): today's low, else the cheapest listing. */
export function receiptPriceNow(id, { prices = {}, priceHistory = null, now }) {
    const h = readPriceHistory(priceHistory).items[id] || {};
    const low = h[Math.floor(now / DAY_MS)] > 0 ? h[Math.floor(now / DAY_MS)] : null;
    const row = prices[id];
    const fresh = row && typeof row === 'object' && tornDayStart(row.at || 0) === tornDayStart(now) ? unitPrice({ listings: row.listings }, id === POINTS ? REFILL_POINTS : 1) : null;
    const p = [low, fresh].filter((v) => v > 0);
    return p.length ? Math.min(...p) : null;
}

/** Note the day's cheapest price for everything it used. */
function rcNotePrices(day, priceOf) {
    if (!priceOf) return day;
    const ids = Object.keys(day.items || {}).filter((id) => day.items[id] > 0);
    if (day.refills > 0) ids.push(POINTS);
    for (const id of ids) {
        const p = priceOf(id === POINTS ? POINTS : Number(id));
        if (p > 0) day.px[id] = day.px[id] > 0 ? Math.min(day.px[id], p) : p;
    }
    return day;
}

function rcBlankDay(s0) {
    return { s0: s0 ? { ...s0 } : null, e: 0, n: 0, by: {}, gain: {}, items: {}, guess: {}, px: {}, refills: 0, special: 0, catchUp: 0, est: false };
}

/**
 * The reducer: a day's receipt plus one change. Items named by a guess stay
 * marked as guesses until the inventory confirms them.
 * @param {object|null} prevDay
 * @param {object} change - receiptChange()
 * @param {object} [o] - {priceOf(id) → $|null}
 */
export function addToReceiptDay(prevDay, change, { priceOf = null } = {}) {
    const d = prevDay ? { ...rcBlankDay(prevDay.s0), ...prevDay, by: { ...prevDay.by }, gain: { ...prevDay.gain }, items: { ...prevDay.items }, guess: { ...(prevDay.guess || {}) }, px: { ...(prevDay.px || {}) } } : rcBlankDay(change.s0);
    d.e += change.e || 0;
    d.n += change.n || 0;
    for (const [k, [n, e]] of Object.entries(change.by || {})) d.by[k] = [(d.by[k] ? d.by[k][0] : 0) + n, (d.by[k] ? d.by[k][1] : 0) + e];
    for (const k of STATS) rcAdd(d.gain, k, change.gain && change.gain[k]);
    if (change.drugs) {
        rcAdd(d.items, change.drugGuess, change.drugs);
        rcAdd(d.guess, change.drugGuess, change.drugs);
    }
    for (const [id, n] of Object.entries(change.boosterGuess || {})) {
        rcAdd(d.items, id, n);
        rcAdd(d.guess, id, n);
    }
    d.refills += change.refills || 0;
    d.special += change.special || 0;
    if (change.catchUp) d.catchUp += 1;
    if (change.est) d.est = true;
    return rcNotePrices(d, priceOf);
}

/** Drop the oldest days past RECEIPT_DAYS. */
function trimReceiptDays(days) {
    const keys = Object.keys(days).map(Number).sort((a, b) => a - b);
    while (keys.length > RECEIPT_DAYS) delete days[keys.shift()];
    return days;
}

/** Add one change to the stored receipts (a new object). Nothing changed → the same object. */
export function recordChange(receipts, change, { priceOf = null } = {}) {
    const r = readReceipts(receipts);
    const busy = change.e > 0 || change.drugs || change.boosterH || change.refills || change.special || Object.keys(change.gain || {}).length;
    if (!busy) return r;
    const day = tornDayStart(change.at);
    const days = { ...r.days, [day]: addToReceiptDay(r.days[day] || null, change, { priceOf }) };
    const pend = { ...r.pend };
    if (change.drugs || change.boosterH) {
        const p = pend[day] || { d: 0, bh: 0 };
        pend[day] = { d: p.d + (change.drugs || 0), bh: p.bh + (change.boosterH || 0) };
    }
    return { ...r, days: trimReceiptDays(days), pend };
}

/** Only the items a gym plan uses count (drugs, candy, cans, EDVD, FHC). */
function rcConsumables(inv) {
    const out = {};
    for (const [id, n] of Object.entries(inv || {})) if (ITEMS[id] && Number(n) >= 0) out[id] = Number(n) || 0;
    return out;
}

/**
 * A new inventory read: name the uses since the last read from what dropped.
 * A drop counts only against a use Torn's cooldowns showed (a drug per drug
 * cooldown jump, boosters up to the hours the booster cooldown rose), so
 * items sold, traded or moved never count.
 * @param {object} receipts
 * @param {object} inventory - {[itemId]: qty} as read now
 * @param {number} at - when it was read
 */
export function applyInventory(receipts, inventory, at, { priceOf = null } = {}) {
    const r = readReceipts(receipts);
    const now = rcConsumables(inventory);
    // The first read is the baseline: uses before it keep their guesses.
    if (!r.inv) return { ...r, inv: { at, c: now }, pend: {} };
    if (!(at > r.inv.at)) return r;
    const pool = {};
    for (const [id, n] of Object.entries(r.inv.c || {})) if (n > (now[id] || 0)) pool[id] = n - (now[id] || 0);
    const days = { ...r.days };
    for (const dk of Object.keys(r.pend).map(Number).sort((a, b) => a - b)) {
        const p = r.pend[dk];
        const old = days[dk];
        if (!old) continue;
        const d = { ...old, items: { ...old.items }, guess: { ...(old.guess || {}) }, px: { ...(old.px || {}) } };
        const guessed = (pred) => Object.keys(d.guess).filter((id) => pred(Number(id)) && d.guess[id] > 0);
        const take = (id, n) => {
            pool[id] -= n;
            if (!(pool[id] > 0)) delete pool[id];
        };
        // Drugs: one per cooldown jump, the guessed kind first.
        if (p.d > 0) {
            const order = [...new Set([...guessed(rcIsDrug), ...Object.keys(pool).filter((id) => rcIsDrug(Number(id)))])].filter((id) => pool[id] > 0);
            let left = p.d;
            const seen = {};
            for (const id of order) {
                const n = Math.min(left, pool[id]);
                if (n > 0) {
                    seen[id] = n;
                    take(id, n);
                    left -= n;
                }
            }
            if (Object.keys(seen).length) {
                // Replace as many guesses as were seen; the rest stay guesses.
                let replace = p.d - left;
                for (const id of guessed(rcIsDrug)) {
                    const n = Math.min(replace, d.guess[id]);
                    d.items[id] -= n;
                    d.guess[id] -= n;
                    replace -= n;
                    if (!(d.items[id] > 0)) delete d.items[id];
                    if (!(d.guess[id] > 0)) delete d.guess[id];
                }
                for (const [id, n] of Object.entries(seen)) rcAdd(d.items, id, n);
            }
        }
        // Boosters: as many as the cooldown's hours cover, the guessed kinds first.
        if (p.bh > 0) {
            let room = p.bh + BOOSTER_SLACK_H;
            const order = [...new Set([...guessed(rcIsBooster), ...Object.keys(pool).filter((id) => rcIsBooster(Number(id))).sort((a, b) => ITEMS[b].boosterH - ITEMS[a].boosterH)])].filter((id) => pool[id] > 0);
            const seen = {};
            for (const id of order) {
                const each = ITEMS[id].boosterH;
                const n = Math.min(pool[id], Math.floor(room / each + 1e-9));
                if (n > 0) {
                    seen[id] = n;
                    take(id, n);
                    room -= n * each;
                }
            }
            if (Object.keys(seen).length) {
                for (const id of guessed(rcIsBooster)) {
                    d.items[id] -= d.guess[id];
                    if (!(d.items[id] > 0)) delete d.items[id];
                    delete d.guess[id];
                }
                for (const [id, n] of Object.entries(seen)) rcAdd(d.items, id, n);
            }
        }
        days[dk] = rcNotePrices(d, dk === tornDayStart(at) ? priceOf : null);
    }
    return { ...r, days, pend: {}, inv: { at, c: now } };
}

/**
 * The price a day's receipt counts for an item: the cheapest seen that day
 * (noted when it was used, or the day's low in the price history); else the
 * nearest we know, and the day is marked estimated.
 */
export function receiptDayPrice(day, dayStart, id, { priceHistory = null, prices = {} } = {}) {
    if (day.px && day.px[id] > 0) return { price: day.px[id], est: false };
    const low = (readPriceHistory(priceHistory).items[id] || {})[Math.floor(dayStart / DAY_MS)];
    if (low > 0) return { price: low, est: false };
    const now = unitPrice(prices[id], id === POINTS ? REFILL_POINTS : 1);
    if (now > 0) return { price: now, est: true };
    return { price: SAMPLE_PRICES[id] || 0, est: true };
}

/** Money a day's receipt spent: items × that day's price, plus points refills. */
export function receiptDayCost(day, dayStart, sources = {}) {
    let cost = 0;
    let est = false;
    for (const [id, n] of Object.entries(day.items || {})) {
        if (!(n > 0)) continue;
        const p = receiptDayPrice(day, dayStart, Number(id), sources);
        cost += n * p.price;
        est = est || p.est;
    }
    if (day.refills > 0) {
        const p = receiptDayPrice(day, dayStart, POINTS, sources);
        cost += day.refills * REFILL_POINTS * p.price;
        est = est || p.est;
    }
    return { cost: Math.round(cost), est };
}

/**
 * Totals over the days in [from, to] (day starts).
 * @returns {{days, e, n, items, guessed, refills, special, cost, est (a price wasn't seen that day), eEst (energy worked out
 *   around a drug, booster or refill), gained, gain, perK: $ per 1,000 stats, ePerK: energy per 1,000 stats}}
 */
export function summarizeReceipts(receipts, from, to, sources = {}) {
    const r = readReceipts(receipts);
    const out = { days: 0, e: 0, n: 0, items: {}, guessed: 0, refills: 0, special: 0, cost: 0, est: false, eEst: false, gained: 0, gain: {}, catchUp: 0 };
    for (const k of Object.keys(r.days).map(Number).filter((k) => k >= from && k <= to)) {
        const d = r.days[k];
        out.days++;
        out.e += d.e || 0;
        out.n += d.n || 0;
        for (const [id, n] of Object.entries(d.items || {})) rcAdd(out.items, id, n);
        out.guessed += Object.values(d.guess || {}).reduce((a, b) => a + b, 0);
        out.refills += d.refills || 0;
        out.special += d.special || 0;
        out.catchUp += d.catchUp || 0;
        for (const k2 of STATS) rcAdd(out.gain, k2, d.gain && d.gain[k2]);
        const c = receiptDayCost(d, k, sources);
        out.cost += c.cost;
        out.est = out.est || c.est;
        out.eEst = out.eEst || Boolean(d.est);
    }
    out.gained = totalOf(out.gain);
    out.perK = out.gained > 0 && out.cost > 0 ? (out.cost * 1000) / out.gained : null;
    out.ePerK = out.gained > 0 && out.e > 0 ? (out.e * 1000) / out.gained : null;
    return out;
}

/**
 * Money spent over some Torn days: receipts for the days they cover, `fallback(day)` for the rest (before
 * receipts existed), so a week isn't one receipt day against seven days of gains.
 */
export function spentOverDays(receipts, days, sources = {}, fallback = () => 0) {
    const r = readReceipts(receipts);
    let total = 0;
    for (const d of days) total += r.days[d] ? receiptDayCost(r.days[d], d, sources).cost : fallback(d) || 0;
    return total;
}

/** "Xanax × 3 · EDVD × 5", most used first. */
export function itemsWords(items) {
    return Object.entries(items || {})
        .filter(([, n]) => n > 0)
        .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))
        .map(([id, n]) => itemName(Number(id)) + ' × ' + n)
        .join(' · ');
}

/** The recorded days, oldest first (day starts). */
export function receiptDays(receipts) {
    return Object.keys(readReceipts(receipts).days).map(Number).sort((a, b) => a - b);
}

/**
 * What the what-if re-runs: the period's real starting stats, the energy
 * and money of each day, and the real line.
 * @param {object} receipts
 * @param {number[]} days - day starts in the period, oldest first
 */
export function whatIfPeriod(receipts, days, sources = {}) {
    const r = readReceipts(receipts);
    const list = days.filter((d) => r.days[d]);
    if (!list.length) return null;
    const first = r.days[list[0]];
    const start = first.s0 ? { ...first.s0 } : null;
    if (!start) return null;
    // Calendar days from the first to the last (a day with nothing recorded trained nothing).
    const span = Math.round((list[list.length - 1] - list[0]) / DAY) + 1;
    const perDay = [];
    for (let i = 0; i < span; i++) {
        const d = r.days[list[0] + i * DAY];
        perDay.push({ day: list[0] + i * DAY, e: d ? d.e || 0 : 0, gained: d ? totalOf(d.gain) : 0, cost: d ? receiptDayCost(d, list[0] + i * DAY, sources).cost : 0 });
    }
    return { start, startTotal: totalOf(start), days: perDay, energy: perDay.reduce((a, x) => a + x.e, 0), money: perDay.reduce((a, x) => a + x.cost, 0), gained: perDay.reduce((a, x) => a + x.gained, 0) };
}

/**
 * Each plan's line with YOUR energy and at most YOUR money, day by day.
 * `results` are the plans run from the period's starting stats for the
 * period's days (compareStrategies). A plan trains your energy at its own
 * stats per energy (its happy, boosters and jumps); where it would cost more
 * than you spent for that energy, only the share your money pays for
 * (spent ÷ its cost) gets its boost, and the rest trains at the cheapest
 * plan's rate.
 * @returns {{real: number[], plans: {[id]: {values:number[], gained:number, perE:number, cost:number, capped:boolean}}}}
 */
export function whatIfLines(period, results) {
    const real = [period.startTotal];
    for (const x of period.days) real.push(real[real.length - 1] + x.gained);
    const rows = Object.values(results || {}).filter((x) => x && x.energyTrained > 0);
    const plans = {};
    if (!rows.length) return { real, plans };
    const perE = (x) => x.gained / x.energyTrained;
    const costE = (x) => x.cost / x.energyTrained;
    const base = rows.reduce((a, b) => (costE(b) < costE(a) || (costE(b) === costE(a) && perE(b) > perE(a)) ? b : a));
    const E = period.energy;
    const M = period.money;
    for (const x of rows) {
        let rate = perE(x);
        const cost = costE(x) * E;
        let capped = false;
        if (x !== base && cost > M && rate > perE(base)) {
            // Your money pays for this share of it; the rest of the energy trains at the cheapest plan's rate.
            const f = Math.max(0, Math.min(1, M / cost));
            rate = perE(base) + (rate - perE(base)) * f;
            capped = true;
        }
        const values = [period.startTotal];
        for (const d of period.days) values.push(values[values.length - 1] + d.e * rate);
        plans[x.id] = { values, gained: Math.round(values[values.length - 1] - period.startTotal), perE: rate, cost: Math.round(capped ? M : cost), capped };
    }
    return { real, plans };
}

/**
 * Re-run every plan from the period's real starting stats for the period's
 * days (the same comparison Plan shows, compareStrategies), with the money
 * you spent as the budget. Deterministic: same inputs, same lines.
 * @param {object} o - {state, pc, shares, settings, prices} as the model has them
 * @param {object} period - whatIfPeriod()
 */
export function runWhatIf({ state, pc, shares, settings, prices }, period) {
    // At least two weeks, so a jump's stack-then-jump cycle is in its rate (budget scaled to match).
    const days = Math.max(WHAT_IF_MIN_DAYS, period.days.length);
    const budget = period.money > 0 ? (period.money * days) / period.days.length : 0;
    const results = compareStrategies({ state, pc: { ...pc, stats: { ...period.start } }, shares, settings: { ...settings, horizonDays: days, budget }, prices, special: 0 });
    return { results, ...whatIfLines(period, results) };
}
