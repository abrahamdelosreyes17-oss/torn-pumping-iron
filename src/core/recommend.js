/*
 * Recommend a strategy, rank the others against it, and explain a worse
 * pick in plain words. Pure. ENGINE-SPEC §5.
 */

import { STRATEGIES } from './strategies.js';
import { fmtShort, fmtMoney } from './format.js';

/** A pick this much worse in stats (or costlier without being this much better) gets the warning. */
export const WARN_STATS_PCT = 5;

/** Re-check when a price moves this much against its 7-day average. */
export const PRICE_MOVE_PCT = 15;

/** Re-check when total stats have grown this many times since the last check. */
export const STATS_GROWTH_X = 2;

/** The daily re-check, Torn time. */
export const DAILY_CHECK_HOUR = 6;

const JUMP_LIKE = new Set(['chocoJump', 'edvdJump', 'happy99k', 'consoleJump', 'consoleJumpToy', 'edvdJumpAN']);
const HAPPY_BOUGHT = new Set(['dailyChoco', 'chocoJump', 'edvdJump', 'happy99k', 'consoleJump', 'consoleJumpToy', 'edvdJumpAN']);
const BOOSTERS = new Set(['steadyBoost', 'steadyMax']);

/** The Plan dropdown: what "best" means. */
export const PICK_BY = {
    auto: { id: 'auto', name: 'Auto (from your income)', what: 'Picks the plan and items your income affords, and plans around events. Needs a Full key. Default.' },
    most: { id: 'most', name: 'Most stats in my budget', what: 'The most stats the budget you set allows.' },
    value: { id: 'value', name: 'Best value for money', what: 'The most stats for each $1M: cheaper plans can win.' },
    max: { id: 'max', name: 'Max gains, no budget', what: 'Adds FHC and cans on top whenever they add stats; says what it costs a day.' },
};

/** A plan that loses more than this share of the best plan's stats doesn't fit the player (hidden unless asked). */
export const FIT_MIN_SHARE = 0.5;

/** Does a plan fit this player? (Owner: only show what fits; a tick shows the rest.) */
export function fitsPlayer(r, best) {
    if (!r || !best) return true;
    return !(best.gained > 0) || r.gained >= FIT_MIN_SHARE * best.gained;
}

/** Stats per $1M (a free plan: Infinity). */
export function perMillion(r) {
    return r && r.cost > 0 ? r.gained / (r.cost / 1e6) : Infinity;
}

/**
 * @param {object} results - {id: simulateStrategy result}
 * @param {object} o
 * @param {number} [o.budget] - money for the horizon; Infinity when unset
 * @param {string} [o.pickBy] - 'auto' (most stats in the income budget), 'most' (most stats in the budget), 'value' (most per $1M in the budget), 'max' (most stats, no budget)
 * @param {string} [o.goal] - 'unlock': the plan that puts the most energy through the gym (unlocks soonest) in the budget
 * @returns {{recommended:string, pickBy:string, alternatives:object[], reasons:string[]}}
 */
export function recommend(results, { budget = Infinity, bliss = false, pickBy = 'most', goal = null } = {}) {
    const list = Object.values(results).filter(Boolean);
    if (!list.length) return { recommended: null, pickBy, alternatives: [], reasons: [] };
    const limit = pickBy === 'max' ? Infinity : budget;
    // A plan whose numbers aren't checked in game yet (the console jump) is shown, never picked.
    const pickable = list.filter((r) => !(STRATEGIES[r.id] && STRATEGIES[r.id].unverified));
    const inBudget = (pickable.length ? pickable : list).filter((r) => r.cost <= limit);
    const pool = inBudget.length ? inBudget : [(pickable.length ? pickable : list).reduce((a, b) => (b.cost < a.cost ? b : a))];
    const perM = perMillion;
    if (goal === 'unlock') pool.sort((a, b) => (b.energyTrained || 0) - (a.energyTrained || 0) || b.gained - a.gained);
    else if (pickBy === 'value') pool.sort((a, b) => perM(b) - perM(a) || b.gained - a.gained);
    else pool.sort((a, b) => b.gained - a.gained || perM(b) - perM(a));
    const best = pool[0];
    budget = limit;
    const alternatives = list
        .filter((r) => r.id !== best.id)
        .map((r) => {
            const deltaStatsPct = best.gained > 0 ? (100 * (r.gained - best.gained)) / best.gained : 0;
            const deltaCost = r.cost - best.cost;
            const overBudget = r.cost > budget;
            let verdict = 'worse';
            if (overBudget && r.gained > best.gained) verdict = 'overBudget';
            else if (Math.abs(deltaStatsPct) < 1 && Math.abs(deltaCost) < 1e6) verdict = 'same';
            else if (deltaStatsPct > 0 && !overBudget) verdict = 'better';
            const alt = { id: r.id, gained: r.gained, cost: r.cost, perM: perM(r), deltaStatsPct, deltaCost, overBudget, verdict, fits: fitsPlayer(r, best) };
            return { ...alt, why: whyNot(best, alt, { bliss, budget, pickBy }) };
        })
        .sort((a, b) => b.gained - a.gained);
    return { recommended: best.id, pickBy, goal, perM: perM(best), alternatives, reasons: whyRecommended(best, results, { budget, pickBy, goal }) };
}

/** One line on why the recommended plan wins. */
function whyRecommended(best, results, { budget, pickBy = 'most', goal = null }) {
    const out = [];
    if (goal === 'unlock') out.push('It puts the most energy through the gym, so the next gym opens soonest.');
    if (pickBy === 'value') out.push('The most stats for each $1M you spend.');
    if (pickBy === 'max') out.push('The most stats, whatever it costs.');
    if (BOOSTERS.has(best.id)) out.push('FHC and cans use the booster cooldown, so they add to your Xanax instead of replacing it.');
    const beaten = Object.values(results).filter((r) => r && r.id !== best.id && r.gained > best.gained);
    if (beaten.length && beaten.every((r) => r.cost > budget)) out.push('Anything that gains more is over your budget.');
    if (best.id === 'steady') out.push('Stacking Xanax for a jump stops natural energy, so you end with fewer stats.');
    if (best.id === 'blissSteady') out.push('Ignorance Is Bliss lets happy climb above your maximum, so boosters keep paying off.');
    if (JUMP_LIKE.has(best.id)) out.push('At your stats a bigger happy multiplies each train more than the energy you lose while stacking.');
    return out;
}

/**
 * One line on why an alternative is not the recommendation (Plan › Other
 * plans): the number that decides it first, then the mechanism.
 * @param {object} best - the recommended result {id, gained, cost}
 * @param {object} alt - an alternatives[] row
 */
export function whyNot(best, alt, { bliss = false, budget = Infinity, pickBy = 'most' } = {}) {
    if (!best || !alt) return '';
    const pct = Math.round(alt.deltaStatsPct);
    // Picking by value: a plan with more stats loses on stats per $1M.
    if (pickBy === 'value' && pct > 0) return '+' + pct + '% stats but fewer per $1M (' + fmtShort(alt.perM || 0) + ' vs ' + fmtShort(perMillion(best)) + ').';
    // Over budget is the reason only when it would otherwise win; a worse plan leads with what it loses.
    if (alt.overBudget && alt.gained > best.gained) return 'Over your ' + fmtMoney(budget) + ' budget (it would gain +' + pct + '% more).';
    if (alt.verdict === 'same') return 'The same stats for the same money: nothing to gain by switching.';
    const why = [];
    if (STRATEGIES[alt.id] && STRATEGIES[alt.id].unverified) why.push('from a player’s guide, not checked in game yet (needs a Game Console)');
    if (JUMP_LIKE.has(alt.id)) why.push('holding Xanax for the jump stops natural energy');
    if (HAPPY_BOUGHT.has(alt.id)) why.push('the Ecstasy takes a drug cooldown a Xanax would fill');
    if (alt.id === 'dailyChoco' || alt.id === 'candyXanax') why.push('the candy lifts happy for one session a day');
    if (alt.id === 'consoleJump' || alt.id === 'consoleJumpToy') why.push('300 energy a day goes to the console, not the gym');
    if (BOOSTERS.has(alt.id)) why.push('FHC and cans cost far more per stat than Xanax and the refill');
    if (HAPPY_BOUGHT.has(alt.id) && !bliss) why.push('without Ignorance Is Bliss the extra happy resets');
    const head = pct < 0 ? '−' + -pct + '% stats' : pct > 0 ? '+' + pct + '% stats for ' + fmtMoney(alt.deltaCost) + ' more' : 'No more stats';
    const cost = pct < 0 && alt.deltaCost > 0 ? ' and ' + fmtMoney(alt.deltaCost) + ' more' + (alt.overBudget ? ', over your budget' : '') : '';
    return head + cost + (why.length ? ': ' + why.join('; ') + '.' : '.');
}

/**
 * Should picking `picked` over `recommended` warn, and in which words?
 * @returns {{warn:boolean, title:string, text:string, reasons:string[]}}
 */
export function pickWarning(recommended, picked, { bliss = false, days = 30 } = {}) {
    if (!recommended || !picked || recommended.id === picked.id) return { warn: false, title: '', text: '', reasons: [] };
    const dPct = recommended.gained > 0 ? (100 * (picked.gained - recommended.gained)) / recommended.gained : 0;
    const dCost = picked.cost - recommended.cost;
    const warn = dPct < -WARN_STATS_PCT || (dCost > 0 && dPct < WARN_STATS_PCT);
    const reasons = [];
    if (JUMP_LIKE.has(picked.id)) reasons.push('Holding four Xanax stops natural energy.');
    if (HAPPY_BOUGHT.has(picked.id)) reasons.push('The Ecstasy uses a drug cooldown a Xanax would have filled.');
    if (picked.id === 'dailyChoco') reasons.push('The candy lifts happy for one session a day only.');
    if (HAPPY_BOUGHT.has(picked.id) && !bliss) reasons.push('Worth it only if you read Ignorance Is Bliss.');
    const name = (STRATEGIES[picked.id] && STRATEGIES[picked.id].name) || picked.id;
    const recName = (STRATEGIES[recommended.id] && STRATEGIES[recommended.id].short) || recommended.id;
    const title = 'A ' + name.charAt(0).toLowerCase() + name.slice(1) + " isn't worth it for you";
    const money = dCost > 0 ? ', and ' + fmtMoney(dCost) + ' more' : dCost < 0 ? ', for ' + fmtMoney(-dCost) + ' less' : '';
    const text = days + ' days: about +' + fmtShort(picked.gained) + ' stats, against +' + fmtShort(recommended.gained) + ' on ' + recName.toLowerCase() + money + '.';
    return { warn, title, text, reasons };
}

/**
 * Things that should make the app look at the plan again (Home › Heads-up).
 * @param {object} last - snapshot at the last check {at, bliss, statBooks, unlockedTop, total, budget}
 * @param {object} now - the same, now; plus prices {[id]: {now, avg7}}
 * @returns {{kind:string, text:string}[]}
 */
export function recheckTriggers(last, now) {
    const out = [];
    if (!last) return [{ kind: 'first', text: 'First plan check' }];
    if (Boolean(now.bliss) !== Boolean(last.bliss)) out.push({ kind: 'book', text: now.bliss ? 'Ignorance Is Bliss is active: jumps may win now' : 'Ignorance Is Bliss ran out' });
    if ((now.statBooks || 0) !== (last.statBooks || 0)) out.push({ kind: 'book', text: 'A gym book changed' });
    if ((now.unlockedTop || 0) > (last.unlockedTop || 0)) out.push({ kind: 'gym', text: 'New gym unlocked' });
    if (last.total > 0 && now.total >= STATS_GROWTH_X * last.total) out.push({ kind: 'stats', text: 'Your stats doubled since the last check' });
    if ((now.budget || 0) !== (last.budget || 0)) out.push({ kind: 'budget', text: 'Budget changed' });
    for (const [id, p] of Object.entries(now.prices || {})) {
        if (p && p.avg7 > 0 && Math.abs(p.now / p.avg7 - 1) * 100 > PRICE_MOVE_PCT) out.push({ kind: 'price', item: id, text: 'A price moved more than ' + PRICE_MOVE_PCT + '%' });
    }
    return out;
}

/** Is the daily re-check due? (Once per Torn day, from 06:00 Torn time.) */
export function dailyCheckDue(lastAt, now) {
    const day = Math.floor(now / 86400000) * 86400000;
    const due = day + DAILY_CHECK_HOUR * 3600000;
    if (now < due) return lastAt < due - 86400000;
    return !(lastAt >= due);
}
