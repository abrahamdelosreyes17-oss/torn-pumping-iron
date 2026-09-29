/*
 * Auto mode (the Plan dropdown's default): the plan picks itself from what
 * you can afford. Pure. ROUND4-PLAN §E.
 *
 * Income is how fast your networth grows, read from Torn's own history
 * (personal stats at past dates), plus what the gym already cost you over
 * those days (it left your networth). The plan may spend up to that a day:
 * "you can afford this with your income". Auto needs the Full key (owner's
 * rule): the key reads your money log for where the money comes from.
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
 * @param {object|null} o.income - incomeFrom()
 * @returns {{on:boolean, ready:boolean, needsKey:boolean, waiting:boolean, perDay:number|null, budgetPerDay:number|null, budget:number|null}}
 */
export function autoState({ plan, settings, hasFullKey, income }) {
    const on = Boolean(plan && plan.pickBy === 'auto');
    const horizon = (settings && settings.horizonDays) || 30;
    if (!on) return { on, ready: false, needsKey: false, waiting: false, perDay: null, budgetPerDay: null, budget: null };
    if (!hasFullKey) return { on, ready: false, needsKey: true, waiting: false, perDay: null, budgetPerDay: null, budget: null };
    if (!income || !Number.isFinite(income.perDay)) return { on, ready: false, needsKey: false, waiting: true, perDay: null, budgetPerDay: null, budget: null };
    const budgetPerDay = Math.max(0, income.perDay);
    return { on, ready: true, needsKey: false, waiting: false, perDay: income.perDay, budgetPerDay, budget: budgetPerDay * horizon, days: income.days };
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

/** The pick rule the recommender uses (Auto is "most stats" inside the income budget). */
export function effectivePickBy(pickBy, auto) {
    if (pickBy === 'auto') return auto && auto.ready ? 'auto' : 'most';
    return pickBy;
}

/** "You can afford this with your income: about $4.2M a day comes in, this plan costs $3.1M a day." */
export function affordLine(auto, planPerDay) {
    if (!auto || !auto.ready) return null;
    const inText = fmtMoney(Math.round(auto.perDay));
    if (!(auto.perDay > 0)) return 'Your networth hasn’t grown over the last ' + Math.round(auto.days) + ' days, so Auto picks a plan that costs nothing.';
    if (!(planPerDay > 0)) return 'About ' + inText + ' a day comes in; this plan costs nothing.';
    return 'You can afford this with your income: about ' + inText + ' a day comes in, this plan costs ' + fmtMoney(Math.round(planPerDay)) + ' a day.';
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

/** [calibrate] Money-log categories read for the breakdown (by title; Torn's list comes from /torn/logcategories). */
export const MONEY_LOG_CATEGORY = /(money|bank|bazaar|market|trad|compan|job|stock|points|auction|loan|mug|casino)/i;

/** [calibrate] Log lines that bring money in, and ones that send it out, by title words. */
const IN_WORDS = /(sell|sold|receive|dividend|payout|pay ?day|wage|salary|won|win|refund|collect|mugged|reward|profit|matur)/i;
const OUT_WORDS = /(buy|bought|purchase|send|sent|paid|fee|lose|lost|bet|donat|deposit|upkeep)/i;

/**
 * Where your money comes from, from the money log: amounts in and out by
 * log line, over the days read (biggest first). Titles that say neither are
 * left out rather than guessed.
 * @param {{at, title, money}[]} log
 * @param {number} now
 * @param {number} [windowDays] - how far back the log was read
 * @returns {{days:number, inPerDay:number, outPerDay:number, lines:{title:string, perDay:number, n:number, dir:'in'|'out'}[]}|null}
 */
export function incomeBreakdown(log, now, windowDays = null) {
    const rows = (log || []).filter((e) => e && e.money > 0 && Number.isFinite(e.at));
    if (!rows.length) return null;
    // Spread over the whole span that was read (one sale 2 days ago in a 30-day read is 1/30 a day, not 1/2).
    const oldest = Math.min(...rows.map((e) => e.at));
    const days = Math.max(1, windowDays || 0, (now - oldest) / DAY);
    const by = new Map();
    for (const e of rows) {
        const dir = IN_WORDS.test(e.title) ? 'in' : OUT_WORDS.test(e.title) ? 'out' : null;
        if (!dir) continue;
        const k = dir + '|' + e.title;
        const r = by.get(k) || { title: e.title, dir, total: 0, n: 0 };
        r.total += e.money;
        r.n++;
        by.set(k, r);
    }
    const lines = [...by.values()].map((r) => ({ title: r.title, dir: r.dir, n: r.n, perDay: r.total / days })).sort((a, b) => b.perDay - a.perDay);
    const sum = (d) => lines.filter((l) => l.dir === d).reduce((a, l) => a + l.perDay, 0);
    return { days, inPerDay: sum('in'), outPerDay: sum('out'), lines };
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
