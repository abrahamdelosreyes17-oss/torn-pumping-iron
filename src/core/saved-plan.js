/*
 * Saved plans (round 6, owner 2026-09-30: "no more automatic"). Pure.
 *
 * A plan is made on a click and saved with the numbers it was made from:
 *   - Create plan: 1, 3, 6 or 12 months from today, worked out from scratch
 *     from your stats, income, prices and gyms now;
 *   - Recalibrate (only on a click): re-reads everything as it is now and
 *     re-plans the time left, keeping the end date (2 months into a year,
 *     still 10 months left).
 * Nothing re-plans by itself. Everything else (today's steps and their
 * timing, the booster cooldown, links, gym marks, Buy, Progress, the Discord
 * pings) follows the saved plan with the same logic as before.
 *
 * Two parts:
 *   - the saved plan (webpage, IndexedDB): every plan's results with their
 *     day-by-day lines, the recommendation, the what-ifs, what it saw
 *     (`snapshot`), a line per month and the history of recalibrations;
 *   - `planNow` (GM, a few KB): what Torn's pages and the bot need to follow
 *     it (per plan: candy, refill, special refills, items used, gains, cost).
 */

import { DAY, tornDayStart } from './bars.js';
import { STATS } from './gain.js';

/** The lengths Create plan offers, in months (owner: 1 / 3 / 6 / 12). */
export const PLAN_MONTHS = [1, 3, 6, 12];

/** The saved plan's shape version: an older one is read as "no plan yet". */
export const SAVED_PLAN_V = 1;

/** Recalibrations kept in a plan's history. */
export const HISTORY_KEEP = 24;

/** The same UTC date `months` later (the 31st becomes the month's last day). */
export function addMonths(t, months) {
    const d = new Date(t);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + months;
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds());
}

/** A new plan's span: from today's Torn day to the same day `months` later. */
export function planWindow(months, now) {
    const n = PLAN_MONTHS.includes(Number(months)) ? Number(months) : 1;
    const start = tornDayStart(now);
    const end = addMonths(start, n);
    return { months: n, start, end, days: Math.round((end - start) / DAY) };
}

/** Torn days left in a plan from today (today counts; at least 1). */
export function daysLeft(saved, now) {
    if (!saved || !Number.isFinite(saved.end)) return 0;
    return Math.max(1, Math.round((saved.end - tornDayStart(now)) / DAY));
}

/** Where a plan stands: day N of M, and whether it has ended. */
export function planProgress(saved, now) {
    if (!saved) return null;
    const of = Math.round((saved.end - saved.start) / DAY);
    const day = Math.min(of, Math.max(1, Math.floor((tornDayStart(now) - saved.start) / DAY) + 1));
    return { day, of, left: daysLeft(saved, now), ended: tornDayStart(now) >= saved.end };
}

/** What Torn's pages need of one plan's result to follow it (no day-by-day line). */
export function slimResult(r) {
    if (!r) return null;
    const out = { id: r.id, gained: r.gained, cost: r.cost, used: r.used || {}, perStat: r.perStat || {} };
    for (const k of ['candy', 'refill', 'refillGain', 'refillCost', 'specialHelps', 'specialGain', 'booster', 'blocked']) if (r[k] !== undefined) out[k] = r[k];
    return out;
}

/**
 * The plan's months: the stats it plans at each month's end (per stat), what
 * the month gains and costs, and what it uses (items, points). From the
 * result's day-by-day line; items and cost spread evenly over the days.
 * @param {object} r - a strategy result ({daily, perStat, cost, used, gained})
 * @param {object} o - {start, days, stats: the stats it starts from}
 */
export function monthlyOf(r, { start, days, stats }) {
    if (!r || !Array.isArray(r.daily) || !days) return [];
    const out = [];
    const perDayCost = r.cost / days;
    const gainedAt = (d) => (d <= 0 ? 0 : r.daily[Math.min(r.daily.length, d) - 1] || 0);
    const total = r.gained || 0;
    const statTotal = STATS.reduce((a, k) => a + ((r.perStat && r.perStat[k]) || 0), 0);
    let from = start;
    let d0 = 0;
    for (let i = 1; d0 < days; i++) {
        const to = Math.min(addMonths(start, i), start + days * DAY);
        const d1 = Math.min(days, Math.round((to - start) / DAY));
        const gained = gainedAt(d1) - gainedAt(d0);
        const share = total > 0 ? gainedAt(d1) / total : d1 / days;
        const planned = {};
        for (const k of STATS) planned[k] = Math.round((stats[k] || 0) + (statTotal > 0 ? ((r.perStat[k] || 0) / statTotal) * total * share : 0));
        const used = {};
        for (const [id, n] of Object.entries(r.used || {})) if (n > 0) used[id] = Math.round(((n * (d1 - d0)) / days) * 10) / 10;
        out.push({ month: i, from, to, days: d1 - d0, gained: Math.round(gained), cost: Math.round(perDayCost * (d1 - d0)), stats: planned, used });
        from = to;
        d0 = d1;
    }
    return out;
}

/**
 * What a plan was made from (kept with it: "it remembers what it saw").
 * @param {object} o - {state, pc, statics, settings, plan, prices (id → unit price), income, budgetPerDay, held}
 */
export function snapshotOf({ state, pc, statics = {}, plan = {}, prices = {}, income = null, budgetPerDay = null, held = {}, now }) {
    return {
        at: now,
        stats: { ...pc.stats },
        gymId: state.gymId,
        unlocked: [...(pc.unlocked || [])],
        perks: { mult: { ...pc.perks.mult }, bliss: Boolean(pc.perks.bliss), happyLossMult: pc.perks.happyLossMult || 1, boosterCapExtraH: pc.perks.boosterCapExtraH || 0 },
        happyMax: state.happy.maximum,
        energyMax: state.energy.maximum,
        income: income ? { perDay: income.perDay, source: income.source || null, days: income.days || null } : null,
        budgetPerDay: Number.isFinite(budgetPerDay) ? budgetPerDay : null,
        prices: { ...prices },
        held: { ...held },
        cash: statics.inventory && Number.isFinite(statics.inventory.cash) ? statics.inventory.cash : null,
        build: plan.build || null,
        goal: plan.goal || null,
        pickBy: plan.pickBy || 'most',
    };
}

/**
 * A saved plan from a finished comparison.
 * @param {object} o
 * @param {object} o.compare - compareStrategies() over the plan's days
 * @param {object} o.rec - recommend() of it
 * @param {object} o.snapshot - snapshotOf()
 * @param {number} o.start - the plan's first Torn day
 * @param {number} o.end - the day after its last
 * @param {number} o.months
 * @param {number} o.days - days the comparison covers (the whole plan, or what's left of it)
 * @param {number} o.budget - the budget the comparison ran with (Infinity: none)
 * @param {object|null} [o.whatIf] - the Bliss what-if
 * @param {object[]} [o.jobWhatIf] - company what-ifs
 * @param {object|null} [o.prev] - the plan this one recalibrates (its start, end, history are kept)
 */
export function makeSavedPlan({ compare, rec, snapshot, start, end, months, days, budget, whatIf = null, jobWhatIf = [], prev = null, now }) {
    const from = prev ? tornDayStart(now) : start;
    const best = compare && rec && rec.recommended ? compare[rec.recommended] : null;
    const history = prev ? (prev.history || []).slice(-(HISTORY_KEEP - 1)) : [];
    if (prev) {
        const was = prev.compare && prev.rec ? prev.compare[prev.rec.recommended] : null;
        history.push({
            at: now,
            // What changed since the plan was made or last recalibrated.
            from: { at: prev.snapshot && prev.snapshot.at, stats: prev.snapshot && prev.snapshot.stats, incomePerDay: prev.snapshot && prev.snapshot.income ? prev.snapshot.income.perDay : null, budgetPerDay: prev.snapshot ? prev.snapshot.budgetPerDay : null, strategy: prev.rec ? prev.rec.recommended : null, gained: was ? was.gained : null, cost: was ? was.cost : null, days: prev.days },
            to: { stats: snapshot.stats, incomePerDay: snapshot.income ? snapshot.income.perDay : null, budgetPerDay: snapshot.budgetPerDay, strategy: rec ? rec.recommended : null, gained: best ? best.gained : null, cost: best ? best.cost : null, days },
        });
    }
    return {
        v: SAVED_PLAN_V,
        rev: now,
        createdAt: prev ? prev.createdAt : now,
        recalibratedAt: prev ? now : null,
        start: prev ? prev.start : start,
        end: prev ? prev.end : end,
        months: prev ? prev.months : months,
        // The comparison covers these days, from `from` (a recalibration: from today).
        from,
        days,
        budget: Number.isFinite(budget) ? budget : null,
        snapshot,
        compare,
        rec,
        whatIf,
        jobWhatIf: jobWhatIf || [],
        monthly: best ? monthlyOf(best, { start: from, days, stats: snapshot.stats }) : [],
        history,
    };
}

/**
 * The small part Torn's pages and the bot follow (GM): every plan's slim
 * result, so picking another plan on the webpage needs nothing new here.
 * @param {object} saved - makeSavedPlan()
 * @param {object} [warn] - {strategyId: true} plans whose pick warns against the recommended one
 */
export function planNowOf(saved, warn = {}) {
    if (!saved) return null;
    const slim = {};
    for (const [id, r] of Object.entries(saved.compare || {})) if (r) slim[id] = slimResult(r);
    return {
        v: SAVED_PLAN_V,
        rev: saved.rev,
        createdAt: saved.createdAt,
        recalibratedAt: saved.recalibratedAt,
        start: saved.start,
        end: saved.end,
        months: saved.months,
        from: saved.from,
        days: saved.days,
        budget: saved.budget,
        recommended: saved.rec ? saved.rec.recommended : null,
        pickBy: saved.rec ? saved.rec.pickBy : null,
        warn,
        slim,
    };
}

/** A stored planNow this build can follow (else: no plan yet). */
export function usablePlanNow(p) {
    return p && p.v === SAVED_PLAN_V && p.slim && Number.isFinite(p.end) && p.recommended ? p : null;
}
