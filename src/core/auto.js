/*
 * Auto mode (the Plan dropdown's default): the plan picks itself from what
 * you can afford. Pure. ROUND4-PLAN §E.
 *
 * The money comes from your books (round 7, R7.5; the Full key): your money
 * log sorted into accounts (core/ledger.js) and the budget offer read off it
 * (core/cashflow.js): what the gym costs you now, what comes in, what your
 * cash covers. Networth growth from Torn's own history (personal stats at
 * past dates, plus the gym spend) is the cross-check, and the fallback until
 * the log is read.
 *
 * Events: when an event multiplies what a plan uses (World Diabetes Day's
 * candy ×3, CaffeineCon's cans ×2), Auto compares the event plans over the
 * event's days with the multiplier; if one wins clearly, the plan switches to
 * it in time to stack (saving days skip natural energy: energy above the
 * maximum doesn't regenerate anyway) and switches back after.
 */

import { DAY, HOUR } from './bars.js';
import { EVENT_PLANS } from './events.js';
import { STRATEGIES, JUMP_STACK, CONSOLE_STACK } from './strategies.js';
import { XANAX_CD_MIN } from './items.js';
import { fmtMoney } from './format.js';
import { unlockEnergyAfter } from './gyms.js';

/** Personal stats read for income: networth and its cash parts (10 at most per call). */
export const NETWORTH_STATS = ['networth', 'networthwallet', 'networthvault', 'networthbank', 'networthcayman'];

/** How far back income is measured (and the shortest span that counts). */
export const INCOME_DAYS = 30;
export const INCOME_MIN_DAYS = 3;

/** An event plan must beat the usual plan by this much over the event's days to switch. */
export const EVENT_WIN_PCT = 10;

/** Events Auto plans around, this far ahead. */
export const EVENT_PLAN_AHEAD_MS = 14 * DAY;

/**
 * Income per day from networth snapshots.
 * @param {{at:number, networth:number, cash?:number}[]} snaps - ms times
 * @param {object} o
 * @param {number} [o.spentPerDay] - what the gym plan spent a day meanwhile (added back: it left networth)
 * @returns {{perDay:number, growthPerDay:number, cashPerDay:number|null, days:number, from:number, to:number}|null}
 */
export function incomeFrom(snaps, { spentPerDay = 0 } = {}) {
    const list = (snaps || []).filter((s) => s && Number.isFinite(s.at) && Number.isFinite(s.networth)).sort((a, b) => a.at - b.at);
    if (list.length < 2) return null;
    const last = list[list.length - 1];
    // The oldest snapshot within the window (at least INCOME_MIN_DAYS back).
    const old = list.find((s) => last.at - s.at <= INCOME_DAYS * DAY + HOUR && last.at - s.at >= INCOME_MIN_DAYS * DAY);
    if (!old) return null;
    const days = (last.at - old.at) / DAY;
    const growthPerDay = (last.networth - old.networth) / days;
    const cashPerDay = Number.isFinite(last.cash) && Number.isFinite(old.cash) ? (last.cash - old.cash) / days : null;
    return { perDay: growthPerDay + Math.max(0, spentPerDay || 0), growthPerDay, cashPerDay, days, from: old.at, to: last.at };
}

/**
 * Where Auto stands.
 * @param {object} o
 * @param {object} o.plan - stored plan ({pickBy})
 * @param {object} o.settings
 * @param {boolean} o.hasFullKey
 * @param {object|null} o.income - incomeFrom() (networth)
 * @param {object|null} [o.books] - budgetOffer() of your ledger, with its `flow` (cashflowOf)
 * @returns {{on:boolean, ready:boolean, needsKey:boolean, waiting:boolean, perDay:number|null, budgetPerDay:number|null, budget:number|null, source:'books'|'networth'|'floor'|null, networthPerDay:number|null}}
 */
export function autoState({ plan, settings, hasFullKey, income, books = null, floor = null }) {
    const on = Boolean(plan && plan.pickBy === 'auto');
    const horizon = (settings && settings.horizonDays) || 30;
    const certain = floor && floor.perDay > 0 ? floor.perDay : 0;
    if (!on) return { on, ready: false, needsKey: false, waiting: false, perDay: null, budgetPerDay: null, budget: null };
    // Round 6 (R6.4): the income that is certain (bank, dividends, rent: Limited key) lets Auto plan without the Full key.
    if (!hasFullKey) {
        if (!certain) return { on, ready: false, needsKey: true, waiting: false, perDay: null, budgetPerDay: null, budget: null };
        return { on, ready: true, needsKey: false, waiting: false, perDay: certain, budgetPerDay: certain, budget: certain * horizon, days: null, source: 'floor', networthPerDay: null, floor };
    }
    const nw = income && Number.isFinite(income.perDay) ? income.perDay : null;
    // Your books: what comes in is what the log's lines add up to (the bank's profit counts on the day it is paid,
    // a one-off gift or a stock sale never), and the budget is the offer's pick.
    if (books && Number.isFinite(books.perDay)) {
        return { on, ready: true, needsKey: false, waiting: false, perDay: books.earnsPerDay, budgetPerDay: books.perDay, budget: books.perDay * horizon, days: books.flow ? books.flow.days : null, source: 'books', networthPerDay: nw, floor: null, books };
    }
    // Until the log is read: networth growth already holds the certain part: whichever is higher, never both.
    const measured = nw !== null ? Math.max(certain, nw) : null;
    const perDay = measured !== null ? measured : certain || null;
    if (perDay === null) return { on, ready: false, needsKey: false, waiting: true, perDay: null, budgetPerDay: null, budget: null, source: null, networthPerDay: null };
    const budgetPerDay = Math.max(0, perDay);
    const source = nw !== null ? (certain > nw ? 'floor' : 'networth') : 'floor';
    return { on, ready: true, needsKey: false, waiting: false, perDay, budgetPerDay, budget: budgetPerDay * horizon, days: income ? income.days : null, source, networthPerDay: nw, floor };
}

/**
 * The settings the plans run with: in Auto, the budget is what your income
 * affords over the horizon; otherwise the ones you set. Auto without its key
 * (or before the income is read) runs as "Most stats in my budget".
 */
export function effectiveSettings(settings, auto) {
    if (auto && auto.ready) return { ...settings, budget: auto.budget, autoBudget: true };
    return settings;
}

/** The budget the plans run with: a number (Auto's can be 0: nothing that costs money), else no limit. */
export function budgetOf(settings) {
    const b = settings ? settings.budget : null;
    return typeof b === 'number' && Number.isFinite(b) && b >= 0 ? b : Infinity;
}

/** The pick rule the recommender uses (Auto is "most stats" inside the income budget). */
export function effectivePickBy(pickBy, auto) {
    if (pickBy === 'auto') return auto && auto.ready ? 'auto' : 'most';
    return pickBy;
}

/**
 * "You can afford this with your income: about $4.2M a day comes in, this plan costs $3.1M a day."
 * @param {object|null} [cash] - the plan's own cash check (cashflow.js planCash): a plan that buys in lumps can run
 *   out on a day although its cost a day is covered
 */
export function affordLine(auto, planPerDay, cash = null) {
    if (!auto || !auto.ready) return null;
    // From your books: the offer's own reason, then what this plan costs.
    if (auto.source === 'books' && auto.books) return auto.books.why + (planPerDay > 0 ? ' This plan costs ' + fmtMoney(Math.round(planPerDay)) + ' a day' + (cash && cash.fits === false ? ', but it buys in lumps: your cash runs out on day ' + cash.runsOutDay + '.' : '.') : ' This plan costs nothing.');
    const inText = fmtMoney(Math.round(auto.perDay));
    if (!(auto.perDay > 0)) return 'Your networth hasn’t grown over the last ' + Math.round(auto.days) + ' days, so Auto picks a plan that costs nothing.';
    if (!(planPerDay > 0)) return 'About ' + inText + ' a day comes in; this plan costs nothing.';
    return 'You can afford this with your income: about ' + inText + ' a day comes in' + certainWords(auto) + ', this plan costs ' + fmtMoney(Math.round(planPerDay)) + ' a day.';
}

/** " (about $2.2M a day of it is certain: bank $1.9M, dividends $0.3M)" when the floor counts. */
export function certainWords(auto) {
    const f = auto && auto.floor;
    if (!f || !(f.perDay > 0)) return '';
    const parts = [['bank', f.bank], ['dividends', f.dividends], ['rent', f.rent]].filter(([, v]) => v > 0).map(([k, v]) => k + ' ' + fmtMoney(Math.round(v)));
    return ' (' + (auto.source === 'floor' ? 'all of it certain' : 'about ' + fmtMoney(Math.round(f.perDay)) + ' a day of it certain') + ': ' + parts.join(', ') + ')';
}

/** How long before an event a plan must start to have its stack ready (jumps stack Xanax). */
export function stackLeadMs(strategyId, xanaxCdMin = XANAX_CD_MIN) {
    const s = STRATEGIES[strategyId];
    if (!s || s.kind !== 'jump') return HOUR;
    const n = strategyId === 'consoleJump' || strategyId === 'consoleJumpToy' ? CONSOLE_STACK : JUMP_STACK;
    return n * xanaxCdMin * 60 * 1000 + HOUR;
}

/**
 * The next event worth planning around, with the plans it boosts.
 * @returns {object|null} the event (from upcomingEvents) plus {plans}
 */
export function eventToPlan(events, now) {
    for (const e of events || []) {
        if (!(e.canMult > 1 || e.candyMult > 1)) continue;
        if (e.end && e.end <= now) continue;
        if (!e.active && e.start - now > EVENT_PLAN_AHEAD_MS) continue;
        const plans = (EVENT_PLANS[e.id] || []).filter((id) => STRATEGIES[id]);
        if (plans.length) return { ...e, plans };
    }
    return null;
}

/**
 * Decide the event switch: the best event plan (compared over the event's
 * days with the event's multiplier, inside the same budget) against the best
 * usual plan over the same days.
 * @param {object} o
 * @param {object} o.event - eventToPlan()
 * @param {object} o.eventCompare - compareStrategies() over the event's days, with the multiplier
 * @param {object} o.normalCompare - the same days without it
 * @param {number} o.budgetPerDay - Infinity for no limit
 * @param {number} o.now
 * @returns {{id:string, event:object, from:number, until:number, gainPct:number, active:boolean}|null}
 */
export function eventSwitch({ event, eventCompare, normalCompare, budgetPerDay = Infinity, now }) {
    if (!event || !eventCompare || !normalCompare) return null;
    const days = Math.max(1, (event.end - event.start) / DAY);
    const fits = (r) => r && (!Number.isFinite(budgetPerDay) || r.cost / days <= budgetPerDay + 1);
    const bestOf = (list) => list.filter(fits).sort((a, b) => b.gained - a.gained)[0] || null;
    const eventBest = bestOf(event.plans.map((id) => eventCompare[id]).filter(Boolean));
    const normalBest = bestOf(Object.values(normalCompare).filter(Boolean));
    if (!eventBest || !normalBest || !(normalBest.gained > 0)) return null;
    const gainPct = (100 * (eventBest.gained - normalBest.gained)) / normalBest.gained;
    if (gainPct < EVENT_WIN_PCT) return null;
    const from = event.start - stackLeadMs(eventBest.id);
    return { id: eventBest.id, event, from, until: event.end, gainPct, active: now >= from && now < event.end, normal: normalBest.id };
}

/** The heads-up line for a planned event switch. */
export function eventSwitchHeads(sw, now) {
    if (!sw) return null;
    const name = (STRATEGIES[sw.id] || {}).name || sw.id;
    const jump = (STRATEGIES[sw.id] || {}).kind === 'jump';
    const at = (t) => new Date(t).toISOString().slice(5, 16).replace('T', ' ').replace('-', '/') + ' TCT';
    if (sw.active) return { tone: 'good', text: 'Auto: ' + name + ' for ' + sw.event.name, sub: '+' + Math.round(sw.gainPct) + '% over the event’s days' + (jump ? ' · stacking skips natural energy' : '') + ' · back to your usual plan after ' + at(sw.until) };
    return { tone: 'plain', text: 'Auto switches to ' + name + ' for ' + sw.event.name, sub: 'from ' + at(sw.from) + (jump ? ' (stacking skips natural energy)' : '') + ' · +' + Math.round(sw.gainPct) + '% over the event’s days' };
}

/**
 * Unlock goal: days until the gym opens on each plan, from the energy the
 * plan puts through the gym (unlock progress is energy spent, whatever the
 * happy). Null when the plan trains nothing.
 */
export function unlockDays(result, energyLeft, horizonDays = 30) {
    if (!result || !(result.energyTrained > 0) || !(energyLeft >= 0)) return null;
    return energyLeft / (result.energyTrained / horizonDays);
}

/** Money line for the Plan page when Auto is waiting for its key or its first income read. */
export function autoWaitLine(auto) {
    if (!auto || !auto.on) return null;
    if (auto.needsKey) return 'Auto mode needs a Full key (Settings › Full key). Until then the plan uses your budget.';
    if (auto.waiting) return 'Reading your income from Torn… until then the plan uses your budget.';
    return null;
}

/**
 * Energy still to spend in the gym before a ladder gym opens: every ladder
 * step from your highest unlocked gym up to it, less the progress read from
 * the gym page on the next one. Null when it can't be worked out.
 */
export function unlockEnergyLeft(unlocked, gymId, gymProgress = null, gymExpMult = 1) {
    const target = Number(gymId);
    if (!(target >= 2 && target <= 24)) return null;
    const ladder = (unlocked || []).map(Number).filter((id) => id >= 1 && id <= 24);
    if (ladder.includes(target)) return 0;
    const top = Math.max(0, ...ladder);
    if (!top || top >= target) return null;
    let left = 0;
    for (let id = top; id < target; id++) {
        const e = unlockEnergyAfter(id, gymExpMult);
        if (e === null) return null;
        left += e;
    }
    if (gymProgress && Number(gymProgress.nextId) === top + 1) left -= Number(gymProgress.energy) || 0;
    return Math.max(0, left);
}
