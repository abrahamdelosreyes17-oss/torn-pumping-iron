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
const STEADY_LIKE = new Set(['steady', 'steadyLite', 'steadyBoost', 'steadyMax', 'blissSteady']);

/** The Plan dropdown: what "best" means. */
export const PICK_BY = {
    auto: { id: 'auto', name: 'Auto (from your income)', what: 'Picks the plan and items your income affords, and plans around events. Needs a Full key. Default.' },
    most: { id: 'most', name: 'Most stats in my budget', what: 'The most stats the budget you set allows.' },
    value: { id: 'value', name: 'Best value for money', what: 'The most stats for each $1M: cheaper plans can win.' },
    max: { id: 'max', name: 'Max gains, no budget', what: 'Adds FHC and cans on top whenever they add stats; says what it costs a day.' },
};

/** A plan that loses more than this share of the best plan's stats doesn't fit the player (hidden unless asked). */
export const FIT_MIN_SHARE = 0.5;

/**
 * Does a plan fit this player? (Owner: only show what fits; a tick shows the rest.)
 * `best` is the plan that gains most inside the limit (round 7: not the pick,
 * which under "best value" can be a small plan and hid everything else).
 */
export function fitsPlayer(r, best) {
    if (!r || !best) return true;
    return !(best.gained > 0) || r.gained >= FIT_MIN_SHARE * best.gained;
}

/** Stats per $1M (a free plan: Infinity). */
export function perMillion(r) {
    return r && r.cost > 0 ? r.gained / (r.cost / 1e6) : Infinity;
}

/**
 * The day of a plan a gym opens on (1 = its first day), from the simulator's
 * own run (`unlocked[].t`, minutes); null when the plan doesn't open it in
 * its days.
 */
export function opensOnDay(r, gymId) {
    const u = r && Array.isArray(r.unlocked) ? r.unlocked.find((x) => Number(x.gymId) === Number(gymId)) : null;
    return u && Number.isFinite(u.t) ? Math.floor(u.t / 1440) + 1 : null;
}

const cheaperOf = (a, b) => (b.cost < a.cost ? b : a);
const shortNameOf = (id) => (STRATEGIES[id] && STRATEGIES[id].short) || id;

/**
 * Round 7 (ROUND7-PLAN §3 A): the pick is always by the Plan rule. A gym to
 * unlock never outranks stats: every plan says when it opens the gym, and an
 * optional "open it by" day leaves out the plans that miss it (when any plan
 * makes it), then the rule picks as usual.
 *
 * @param {object} results - {id: simulateStrategy result}
 * @param {object} o
 * @param {number} [o.budget] - money for the horizon; Infinity when unset
 * @param {string} [o.pickBy] - 'auto' (most stats in the income budget), 'most' (most stats in the budget), 'value' (most per $1M in the budget), 'max' (most stats, no budget)
 * @param {object} [o.openBy] - {gymId, days, name?, horizon?}: the gym to unlock; with `days`, it must open by that day
 *   of the run (horizon: the run's days; a day past it can't be judged in this run and leaves nothing out)
 * @returns {{recommended:string, pickBy:string, alternatives:object[], reasons:string[], facts:object}}
 */
export function recommend(results, { budget = Infinity, bliss = false, pickBy = 'most', openBy = null } = {}) {
    const list = Object.values(results).filter(Boolean);
    if (!list.length) return { recommended: null, pickBy, alternatives: [], reasons: [] };
    const limit = pickBy === 'max' ? Infinity : budget;
    // A plan that doesn't fit the player (the console jump over 250k in a stat it trains) is shown, never picked.
    const pickable = list.filter((r) => !r.blocked);
    const cands = pickable.length ? pickable : list;
    // "Open it by": the plans that open the gym in time, when any does.
    const date = openBy && openBy.gymId && openBy.days > 0 && !(openBy.horizon > 0 && openBy.days > openBy.horizon) ? openBy : null;
    const opens = {};
    if (openBy && openBy.gymId) for (const r of list) opens[r.id] = opensOnDay(r, openBy.gymId);
    const onTime = date ? cands.filter((r) => opens[r.id] !== null && opens[r.id] <= date.days) : cands;
    const missedDate = Boolean(date) && !onTime.length;
    const dated = missedDate ? cands : onTime;
    const late = new Set(date && !missedDate ? cands.filter((r) => !onTime.includes(r)).map((r) => r.id) : []);
    const inBudget = dated.filter((r) => r.cost <= limit);
    const nothingFits = !inBudget.length;
    const pool = nothingFits ? [dated.reduce(cheaperOf)] : inBudget;
    const perM = perMillion;
    if (pickBy === 'value') pool.sort((a, b) => perM(b) - perM(a) || b.gained - a.gained);
    else pool.sort((a, b) => b.gained - a.gained || perM(b) - perM(a));
    const best = pool[0];
    // Fit: against the plan that gains most inside the limit; the cheapest plan is never hidden.
    const top = pool.reduce((a, b) => (b.gained > a.gained ? b : a));
    const cheapest = cands.reduce(cheaperOf);
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
            const alt = { id: r.id, gained: r.gained, cost: r.cost, perM: perM(r), deltaStatsPct, deltaCost, overBudget, verdict, fits: !r.blocked && (r.id === cheapest.id || fitsPlayer(r, top)), blocked: r.blocked || null, buysConsole: Boolean(r.used && r.used[104] > 0), late: late.has(r.id), opens: opens[r.id] === undefined ? undefined : opens[r.id] };
            return { ...alt, why: whyNot(best, alt, { bliss, budget, pickBy, openBy: date }) };
        })
        .sort((a, b) => b.gained - a.gained);
    const facts = { limit: Number.isFinite(limit) ? limit : null, nothingFits, missedDate, late: [...late], top: top.id, cheapest: cheapest.id, opens: openBy && openBy.gymId ? opens[best.id] : undefined };
    return { recommended: best.id, pickBy, openBy: openBy || null, perM: perM(best), alternatives, reasons: whyRecommended(best, results, { budget, pickBy, date, missedDate, late, nothingFits, opens, cands }), facts };
}

/**
 * Why the recommended plan wins: sentences built from the comparison's own
 * numbers (round 7: a line that says "most stats" is only written when no
 * plan it could have picked gains more).
 */
function whyRecommended(best, results, { budget, pickBy = 'most', date = null, missedDate = false, late = new Set(), nothingFits = false, opens = {}, cands = [] }) {
    const out = [];
    const all = Object.values(results).filter(Boolean);
    const money = fmtMoney(best.cost);
    const gymName = date && date.name ? date.name : 'the gym';
    const among = late.size ? ' of the plans that open ' + gymName + ' by day ' + date.days : '';
    if (nothingFits) out.push('Nothing fits ' + fmtMoney(budget) + ': this is the cheapest plan' + among + ' at ' + money + ', ' + fmtMoney(best.cost - budget) + ' over.');
    else if (pickBy === 'value') out.push('The most stats for each $1M' + among + ': ' + (best.cost > 0 ? fmtShort(perMillion(best)) + ' per $1M' : 'it costs nothing') + (Number.isFinite(budget) ? ', inside your ' + fmtMoney(budget) : '') + '.');
    else if (!Number.isFinite(budget)) out.push('The most stats' + (among || ' of every plan') + ': +' + fmtShort(best.gained) + ' for ' + money + '.');
    else out.push('The most stats inside your ' + fmtMoney(budget) + among + ': +' + fmtShort(best.gained) + ' for ' + money + '.');
    // What gains more and why it isn't the pick: over the budget, or it misses the date.
    const more = cands.filter((r) => r.id !== best.id && r.gained > best.gained);
    const over = more.filter((r) => r.cost > budget && !late.has(r.id)).sort((a, b) => a.cost - b.cost);
    if (over.length && !nothingFits) out.push((over.length === 1 ? shortNameOf(over[0].id) + ' gains more but is' : over.length + ' plans gain more but are') + ' over your budget' + (over.length === 1 ? ' (' + fmtMoney(over[0].cost) + ')' : '; the cheapest of them is ' + shortNameOf(over[0].id) + ' at ' + fmtMoney(over[0].cost)) + '.');
    if (late.size) {
        const names = [...late].map((id) => shortNameOf(id) + (opens[id] ? ' (day ' + opens[id] + ')' : ' (not in these days)'));
        out.push('Left out for opening ' + gymName + ' after day ' + date.days + ': ' + names.join(', ') + '.');
    }
    if (missedDate) {
        const soonest = cands.filter((r) => opens[r.id]).sort((a, b) => opens[a.id] - opens[b.id])[0];
        out.push('No plan opens ' + gymName + ' by day ' + date.days + (soonest ? '; the soonest is ' + shortNameOf(soonest.id) + ' on day ' + opens[soonest.id] : '') + ', so the date is not counted.');
    }
    // The mechanism, only where the numbers back it.
    const jumps = all.filter((r) => JUMP_LIKE.has(r.id));
    const steady = results.steady;
    if (BOOSTERS.has(best.id)) out.push('FHC and cans use the booster cooldown, so they add to your Xanax instead of replacing it.');
    if (STEADY_LIKE.has(best.id) && jumps.length && jumps.every((r) => r.gained < best.gained)) out.push('Stacking Xanax for a jump stops natural energy, so the jumps end with fewer stats.');
    if (best.id === 'blissSteady') out.push('Ignorance Is Bliss lets happy climb above your maximum, so boosters keep paying off.');
    if (JUMP_LIKE.has(best.id) && steady && best.gained > steady.gained) out.push('At your stats a bigger happy multiplies each train more than the energy you lose while stacking.');
    return out;
}

/**
 * One line on why an alternative is not the recommendation (Plan › Other
 * plans): the numbers that decide it, then the mechanism. A cheaper plan is
 * never "more"; a plan that gains more says what kept it out (the budget,
 * the Plan rule, the date, or that it doesn't fit).
 * @param {object} best - the recommended result {id, gained, cost}
 * @param {object} alt - an alternatives[] row
 */
export function whyNot(best, alt, { bliss = false, budget = Infinity, pickBy = 'most', openBy = null } = {}) {
    if (!best || !alt) return '';
    const pct = Math.round(alt.deltaStatsPct);
    const dCost = alt.deltaCost;
    const moneyWords = dCost >= 0.5e6 ? fmtMoney(dCost) + ' more' : dCost <= -0.5e6 ? fmtMoney(-dCost) + ' less' : 'the same money';
    if (alt.blocked) return 'Doesn’t fit you: ' + alt.blocked + '.';
    if (alt.late && openBy) return (alt.opens ? 'Opens ' + (openBy.name || 'the gym') + ' on day ' + alt.opens + ', after your day ' + openBy.days : 'Misses your date: it doesn’t open ' + (openBy.name || 'the gym') + ' in these days') + (alt.gained > best.gained ? ' (it would gain +' + pct + '% for ' + moneyWords + ')' : '') + '.';
    if (alt.gained > best.gained) {
        // Picking by value: a plan with more stats loses on stats per $1M.
        if (pickBy === 'value' && !alt.overBudget) return '+' + pct + '% stats but fewer per $1M (' + fmtShort(alt.perM || 0) + ' vs ' + fmtShort(perMillion(best)) + ').';
        if (alt.overBudget) return 'Over your ' + fmtMoney(budget) + ' budget by ' + fmtMoney(alt.cost - budget) + ' (it would gain +' + pct + '% for ' + moneyWords + ').';
        return '+' + pct + '% stats for ' + moneyWords + '.';
    }
    if (alt.verdict === 'same') return 'The same stats for the same money: nothing to gain by switching.';
    const why = [];
    if (alt.buysConsole) why.push('the cost includes a Game Console (you have none)');
    if (JUMP_LIKE.has(alt.id)) why.push('holding Xanax for the jump stops natural energy');
    if (HAPPY_BOUGHT.has(alt.id)) why.push('the Ecstasy takes a drug cooldown a Xanax would fill');
    if (alt.id === 'dailyChoco' || alt.id === 'candyXanax') why.push('the candy lifts happy for one session a day');
    if (alt.id === 'consoleJump' || alt.id === 'consoleJumpToy') why.push('300 energy a day goes to the console, not the gym');
    if (BOOSTERS.has(alt.id) && dCost > 0) why.push('FHC and cans cost far more per stat than Xanax and the refill');
    if (HAPPY_BOUGHT.has(alt.id) && !bliss) why.push('without Ignorance Is Bliss the extra happy resets');
    if (pickBy === 'value' && Number.isFinite(alt.perM) && alt.perM < perMillion(best)) why.unshift('fewer stats per $1M (' + fmtShort(alt.perM) + ' vs ' + fmtShort(perMillion(best)) + ')');
    const head = pct < 0 ? '−' + -pct + '% stats' : 'No more stats';
    const cost = dCost >= 0.5e6 ? ' and ' + moneyWords + (alt.overBudget ? ', over your budget' : '') : dCost <= -0.5e6 ? ' for ' + moneyWords : '';
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
    if (JUMP_LIKE.has(picked.id)) reasons.push('Holding ' + (picked.id === 'consoleJump' || picked.id === 'consoleJumpToy' ? 'three' : 'four') + ' Xanax stops natural energy.');
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
