/*
 * "Where your energy comes from": every energy source ordered by what a
 * stat costs through it, and which ones the plan uses. Pure. The plan climbs
 * this ladder until the budget runs out ("Max gains": no limit).
 *
 * Cans and FHC use the booster cooldown, so they add to Xanax, never replace
 * it; FHC fills the booster better (150 E per 6 h vs 60 E for Munster).
 * Special refills are free and sit right after natural energy.
 */

import { STATS, gainPerTrain, totalOf } from './gain.js';
import { XANAX, FHC, MUNSTER, RED_COW, TAURINE, CANDY_KISSES, POINTS, REFILL_POINTS, ITEMS, SAMPLE_PRICES, BOOSTER_CAP_H, boostersThatFit } from './items.js';
import { livePrices } from './market.js';
import { fmtShort, fmtMoney } from './format.js';
import { STRATEGIES } from './strategies.js';

/** The cans the ladder compares (the cheapest energy per $ wins). */
export const CANS = [MUNSTER, RED_COW, TAURINE];

/** Prices when nothing live is known yet (docs, 2026-09-29 TornW3B). */
export const LADDER_SAMPLE_PRICES = { [MUNSTER]: 1830000, [RED_COW]: 2410000, [TAURINE]: 3990000 };

/** The stat the next train goes to: furthest behind its share. */
export function nextStat(stats, shares, best) {
    const tot = totalOf(stats) || 1;
    let pick = null;
    let gap = -Infinity;
    for (const k of STATS) {
        if (!best[k]) continue;
        const d = (shares[k] || 0) - (stats[k] || 0) / tot;
        if (d > gap) {
            gap = d;
            pick = k;
        }
    }
    return pick;
}

/** Stats one energy buys right now (the next stat, its gym, today's happy). */
export function statsPerEnergy({ stats, shares, best, happy, perks = {} }) {
    const k = nextStat(stats, shares, best);
    if (!k) return { stat: null, perEnergy: 0 };
    const g = best[k];
    const e = g.energy;
    return { stat: k, gym: g.name, perEnergy: gainPerTrain(k, stats[k], happy, g.dots[k], e, perks[k] || 1) / e };
}

/** The price to count for an item: live (10 units from the cheapest up) or the sample. */
export function priceFor(id, prices) {
    const live = livePrices(prices || {});
    return live[id] || SAMPLE_PRICES[id] || LADDER_SAMPLE_PRICES[id] || null;
}

/** The can with the cheapest energy, with faction/book perks and an event (CaffeineCon ×2). */
export function bestCan(prices, { canMult = 1, eventMult = 1 } = {}) {
    let out = null;
    for (const id of CANS) {
        const p = priceFor(id, prices);
        if (!p) continue;
        const e = Math.round(ITEMS[id].energy * canMult) * eventMult;
        const perE = p / e;
        if (!out || perE < out.perE) out = { id, price: p, energy: e, perE };
    }
    return out;
}

/**
 * How the plan should spend what's left of the budget each day on energy
 * boosters: FHC (to max, 6 h) or cans (2 h each), whichever buys more energy
 * a day within the booster cooldown. null when nothing fits.
 * @param {object} o - {perDay: $ left a day, maxE, prices, canMult, capH}
 */
export function boosterChoice({ perDay, maxE, prices, canMult = 1, capH = BOOSTER_CAP_H }) {
    if (!(perDay > 0)) return null;
    const out = [];
    const fhcP = priceFor(FHC, prices);
    if (fhcP) {
        const n = Math.min(Math.floor(capH / ITEMS[FHC].boosterH), Math.floor(perDay / fhcP));
        if (n > 0) out.push({ id: FHC, perDay: n, energy: n * maxE, cost: n * fhcP });
    }
    const can = bestCan(prices, { canMult });
    if (can) {
        const n = Math.min(Math.floor(capH / ITEMS[can.id].boosterH), Math.floor(perDay / can.price));
        if (n > 0) out.push({ id: can.id, perDay: n, energy: n * can.energy, cost: n * can.price });
    }
    out.sort((a, b) => b.energy - a.energy || a.cost - b.cost);
    return out[0] || null;
}

/**
 * The ladder rows, cheapest per stat first.
 * @param {object} o
 * @param {object} o.state - normalizeState()
 * @param {object} o.pc - playerContext()
 * @param {object} o.shares
 * @param {object} o.prices - stored price rows
 * @param {object} [o.compare] - compareStrategies() results (what each source adds over the horizon)
 * @param {string} [o.recommended] - the plan the ladder describes
 * @param {number} [o.days]
 * @param {number} [o.budget]
 * @param {number} [o.specialHave] - special refills on the account
 * @param {number} [o.specialUse] - how many the plan may use
 * @returns {{rows:object[], perEnergy:number, stat:string|null, gym:string|null}}
 */
export function energyLadder({ state, pc, shares, prices = {}, compare = null, recommended = null, days = 30, budget = Infinity, specialHave = 0, specialUse = 0 }) {
    const maxE = state.energy.maximum;
    const happy = state.happy.maximum;
    const perks = pc.perks || {};
    const spe = statsPerEnergy({ stats: pc.stats, shares, best: pc.best, happy, perks: perks.mult || {} });
    const perStat = (dollars, energy) => (spe.perEnergy > 0 && energy > 0 ? dollars / (energy * spe.perEnergy) : null);
    const rec = compare && recommended ? compare[recommended] : null;
    const usedIn = (id) => Boolean(rec && rec.used && rec.used[id] > 0);
    const steady = compare && compare.steady;
    const maxPlan = compare && compare.steadyMax;
    const rows = [];

    const natural = Math.round((1440 / (state.energy.interval / 60)) * state.energy.increment);
    rows.push({ id: 'natural', name: 'Natural energy', cooldown: 'none · ' + state.energy.increment + ' per ' + Math.round(state.energy.interval / 60) + ' min', energy: '~' + natural + ' a day', costPerStat: 0, perDay: '—', inPlan: true, note: null });

    if (specialHave > 0) {
        // Every train costs happy: at the maximum they can cost more than they add, so the plan uses them only where they help.
        const helps = !(rec && rec.specialHelps === false);
        const boosted = compare ? Object.values(compare).filter((r) => r && r.specialHelps && r.id !== recommended).sort((x, y) => y.specialGain - x.specialGain)[0] : null;
        const note = !(specialUse > 0) ? 'you have ' + specialHave + '; set how many the plan may use' : helps ? 'using ' + specialUse + ' of ' + specialHave : 'they add stats only in a boosted session (each train costs happy)' + (boosted ? ': +' + fmtShort(boosted.specialGain) + ' with ' + ((STRATEGIES[boosted.id] && STRATEGIES[boosted.id].short) || boosted.id).toLowerCase() : '');
        rows.push({ id: 'special', name: 'Special refills', cooldown: 'none', energy: maxE + ' each', costPerStat: 0, perDay: 'any', inPlan: specialUse > 0 && helps, note });
    }

    const pointsP = priceFor(POINTS, prices);
    rows.push({ id: POINTS, name: 'Points refill', cooldown: 'once a day', energy: String(maxE), costPerStat: pointsP ? perStat(pointsP * REFILL_POINTS, maxE) : null, perDay: '1', inPlan: rec ? usedIn(POINTS) : true, note: null });

    const xanP = priceFor(XANAX, prices);
    rows.push({ id: XANAX, name: 'Xanax', cooldown: 'drug · ~7 h', energy: String(ITEMS[XANAX].energy), costPerStat: xanP ? perStat(xanP, ITEMS[XANAX].energy) : null, perDay: '2–3', inPlan: rec ? usedIn(XANAX) : true, note: null });

    const capH = BOOSTER_CAP_H + (perks.boosterCapExtraH || 0);
    const fhcP = priceFor(FHC, prices);
    const maxNote = steady && maxPlan && maxPlan.gained > steady.gained ? 'with "Max gains": +' + fmtShort((maxPlan.gained - steady.gained) / days) + ' stats a day for ' + fmtMoney((maxPlan.cost - steady.cost) / days) : null;
    const fhcIn = usedIn(FHC);
    rows.push({
        id: FHC,
        name: 'FHC',
        cooldown: 'booster · 6 h',
        energy: 'to max (' + maxE + ')',
        costPerStat: fhcP ? perStat(fhcP, maxE) : null,
        perDay: 'up to ' + (boostersThatFit(FHC, capH) - 1),
        inPlan: fhcIn,
        note: fhcIn ? null : [rec && fhcP && (budget - rec.cost) / days < fhcP ? 'over your budget' : null, maxNote].filter(Boolean).join(' · ') || null,
    });

    const can = bestCan(prices, { canMult: perks.canMult || 1 });
    if (can) {
        const canIn = CANS.some((id) => usedIn(id));
        rows.push({ id: can.id, name: 'Cans (' + ITEMS[can.id].name.replace(/^Can of /, '') + ')', cooldown: 'booster · 2 h each', energy: String(can.energy), costPerStat: perStat(can.price, can.energy), perDay: 'up to ' + (boostersThatFit(can.id, capH) - 1), inPlan: canIn, note: canIn ? null : 'FHC fills the booster better (' + maxE + ' E per 6 h vs ' + can.energy * 3 + ' E)' });
    }

    // The candy the Candy + Xanax plan picked (by name), else Candy Kisses.
    const cx = compare && compare.candyXanax;
    const candyId = cx && cx.candy ? cx.candy.id : CANDY_KISSES;
    const candyP = cx && cx.candy ? cx.candy.unit : priceFor(CANDY_KISSES, prices);
    if (candyP) {
        const n = cx && cx.candy ? cx.candy.count : boostersThatFit(candyId, capH, 0, perks.consumableCdMult || 1);
        const add = Math.round(n * ITEMS[candyId].happy * (perks.candyMult || 1));
        const extra = cx && steady ? cx.gained - steady.gained : null;
        rows.push({
            id: 'candy',
            name: 'Candy (' + (ITEMS[candyId].short || ITEMS[candyId].name) + '), no Ecstasy',
            cooldown: 'booster · 30 min each',
            energy: '0 (+' + add.toLocaleString('en-US') + ' happy)',
            costPerStat: extra > 0 && cx.cost > steady.cost ? (cx.cost - steady.cost) / extra : null,
            perDay: String(n - 1),
            inPlan: usedIn(candyId) && recommended === 'candyXanax',
            note: extra === null ? null : extra > 0 ? 'tops up happy your trains use up: +' + fmtShort(extra) + ' stats in ' + days + ' days for ' + fmtMoney(cx.cost - steady.cost) : 'adds nothing at your stats',
        });
    }

    // Free first, then cheapest per stat; unknown prices last.
    rows.sort((a, b) => ladderRank(a) - ladderRank(b));
    return { rows, perEnergy: spe.perEnergy, stat: spe.stat, gym: spe.gym };
}

function ladderRank(r) {
    if (r.id === 'natural') return -2;
    if (r.id === 'special') return -1;
    return r.costPerStat === null ? Infinity : r.costPerStat;
}

