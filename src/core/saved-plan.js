/*
 * Saved plans (round 6, owner 2026-09-30: "no more automatic"). Pure.
 *
 * A plan is made on a click and saved with the numbers it was made from:
 *   - Create plan: 1, 3, 6 or 12 months from today, worked out from scratch
 *     from your stats, income, prices and gyms now;
 *   - Recalibrate (only on a click): re-reads everything as it is now and
 *     recalibrates the time left, keeping the end date (2 months into a year,
 *     still 10 months left).
 * Nothing recalibrates by itself. Everything else (today's steps and their
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
import { statCurveAt, dayEndMs } from './planline.js';
import { fmtMoney, fmtShort } from './format.js';

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
    const out = { id: r.id, gained: r.gained, cost: r.cost, used: r.used || {}, perStat: r.perStat || {}, energyTrained: r.energyTrained || 0 };
    for (const k of ['candy', 'refill', 'refillGain', 'refillCost', 'specialHelps', 'specialGain', 'booster', 'blocked', 'xanaxPerDay', 'cash', 'costParts', 'overdoseLost']) if (r[k] !== undefined) out[k] = r[k];
    return out;
}

/**
 * The plan's months: the stats it plans at each month's end (per stat), what
 * the month gains and costs, and what it uses (items, points). From the
 * result's day-by-day line; items and cost spread evenly over the days.
 * @param {object} r - a strategy result ({daily, perStat, cost, used, gained})
 * @param {object} o - {start, days, stats: the stats it starts from}
 */
export function monthlyOf(r, { start, days, stats, anchor = start }) {
    if (!r || !Array.isArray(r.daily) || !days) return [];
    const out = [];
    const perDayCost = r.cost / days;
    const gainedAt = (d) => (d <= 0 ? 0 : r.daily[Math.min(r.daily.length, d) - 1] || 0);
    const total = r.gained || 0;
    const statTotal = STATS.reduce((a, k) => a + ((r.perStat && r.perStat[k]) || 0), 0);
    let from = start;
    let d0 = 0;
    for (let i = 1; d0 < days; i++) {
        // Month ends count from the plan's first day (`anchor`), so a recalibrate mid-month keeps the plan's own months.
        if (addMonths(anchor, i) <= start) continue;
        const to = Math.min(addMonths(anchor, i), start + days * DAY);
        const d1 = Math.min(days, Math.round((to - start) / DAY));
        const gained = gainedAt(d1) - gainedAt(d0);
        const share = total > 0 ? gainedAt(d1) / total : d1 / days;
        const planned = {};
        // Each stat from its own line (round 7); results from before it: the stat's share of the whole gain.
        for (const k of STATS) planned[k] = Math.round((stats[k] || 0) + (r.statLine ? statCurveAt(r.statLine, k, dayEndMs(r.statLine.dayMin, d1)) : statTotal > 0 ? ((r.perStat[k] || 0) / statTotal) * total * share : 0));
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
        income: income ? { perDay: income.perDay, source: income.source || null, days: income.days || null, certain: income.certain || null } : null,
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
 * @param {object|null} [o.year] - core/year.js yearSteps' value: the path followed (a plan per segment, re-picked
 *   every 10 days and for each event), gyms opening, the events, the band
 */
export function makeSavedPlan({ compare, rec, snapshot, start, end, months, days, budget, whatIf = null, jobWhatIf = [], prev = null, year = null, gymWorth = [], extras = 'done', auto = false, now }) {
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
        // Who asked for the last recalibration: you (the button), or the plan itself (once a day, round 8).
        recalibratedBy: prev ? (auto ? 'auto' : 'you') : null,
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
        // What each of the first gyms the recommended plan opens adds, against its fee (round 7).
        gymWorth: gymWorth || [],
        // 'pending' while the what-ifs above are still being worked out after the plan was saved (R7.3b), then 'done'.
        extras,
        // The months of the path you follow (the year's path when there is one).
        monthly: year && year.result ? monthlyOf(year.result, { start: from, days, stats: snapshot.stats, anchor: prev ? prev.start : start }) : best ? monthlyOf(best, { start: from, days, stats: snapshot.stats, anchor: prev ? prev.start : start }) : [],
        year: year ? { path: year.result, segments: year.segments, band: year.band, unlocks: year.unlocks, events: (year.events || []).map((e) => ({ id: e.id, name: e.name, start: e.start, end: e.end, expected: Boolean(e.expected) })) } : null,
        history,
    };
}

/** The plan to follow on a day: its segment of the path (null without one). */
export function scheduleAt(schedule, now) {
    if (!Array.isArray(schedule) || !schedule.length) return null;
    return schedule.find((s) => now >= s.from && now < s.to) || (now < schedule[0].from ? schedule[0] : schedule[schedule.length - 1]);
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
        recalibratedBy: saved.recalibratedBy || null,
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
        // Which plan the path follows when (a switch on its date is following the saved plan, not recalibrating).
        // When the what-ifs were added to the whole plan (other tabs read it again then).
        extrasAt: saved.extrasAt || null,
        schedule: saved.year ? scheduleOf(saved.year.segments) : null,
    };
}

/**
 * The path as Torn's pages follow it: which plan from when to when, with its candy and Xanax a day. Stretches in a
 * row that follow the same plan the same way are one entry (round 8: a stretch a week would be 52 entries a year, and
 * this part is handed to every Torn page).
 */
export function scheduleOf(segments) {
    const out = [];
    for (const s of segments || []) {
        const e = { from: s.from, to: s.to, strategy: s.strategy, candy: s.candy || null, ...(Number.isFinite(s.xanaxPerDay) ? { xanaxPerDay: s.xanaxPerDay } : {}) };
        const last = out[out.length - 1];
        const same = last && last.to === e.from && last.strategy === e.strategy && last.xanaxPerDay === e.xanaxPerDay && JSON.stringify(last.candy) === JSON.stringify(e.candy);
        if (same) last.to = e.to;
        else out.push(e);
    }
    return out;
}

/** A stored planNow this build can follow (else: no plan yet). */
export function usablePlanNow(p) {
    return p && p.v === SAVED_PLAN_V && p.slim && Number.isFinite(p.end) && p.recommended ? p : null;
}

/**
 * The path's stretches as the Plan page lists them (round 8, mockup A: the path is the recommendation): stretches
 * that follow the same plan in a row are one, their days, gain and cost added.
 * @param {object[]} segments - the saved plan's `year.segments`
 * @returns {Array<{from, to, days, strategy, gained, cost, candy, refill, xanax: number[], joined: number[]}>}
 *   xanax: the Xanax a day of a small-budget stretch (each value once); joined: specialist gyms joined at its start
 */
export function pathStretches(segments) {
    const out = [];
    for (const s of segments || []) {
        if (!s) continue;
        const last = out[out.length - 1];
        const xan = Number.isFinite(s.xanaxPerDay) ? s.xanaxPerDay : null;
        if (last && last.strategy === s.strategy) {
            last.to = s.to;
            last.days += s.days;
            last.gained += s.gained;
            last.cost += s.cost;
            if (xan !== null && !last.xanax.includes(xan)) last.xanax.push(xan);
            last.joined.push(...(s.joined || []));
        } else out.push({ from: s.from, to: s.to, days: s.days, strategy: s.strategy, gained: s.gained, cost: s.cost, candy: s.candy || null, refill: s.refill, xanax: xan === null ? [] : [xan], joined: [...(s.joined || [])] });
    }
    return out;
}

/**
 * The plans a month follows, in order: the ones that take `minDays` or more of it (none does: the one with the
 * most days). Empty for a month the path does not reach.
 * @param {object[]} stretches - pathStretches()
 */
export function monthPlans(stretches, from, to, minDays = 5) {
    const parts = [];
    for (const s of stretches || []) {
        const days = (Math.min(to, s.to) - Math.max(from, s.from)) / DAY;
        if (days > 0) parts.push({ strategy: s.strategy, days });
    }
    const long = parts.filter((x) => x.days >= minDays);
    const list = long.length ? long : parts.length ? [parts.reduce((a, b) => (b.days > a.days ? b : a))] : [];
    return list.map((x) => x.strategy).filter((id, i, all) => i === 0 || all[i - 1] !== id);
}

/**
 * Why the path is the recommendation, from its numbers: against the money and against the best single plan over
 * the same days. `wins` is false when one plan the whole way gains more (the page then says so, not "wins").
 * @param {object} o
 * @param {{gained:number, cost:number}} o.path
 * @param {number|null} o.budget - the money for these days (null: none)
 * @param {string} o.pickBy - the Plan rule
 * @param {{gained:number, cost:number}|null} o.single - the comparison's pick, one plan the whole way
 * @param {string} o.singleName
 * @returns {{wins:boolean, text:string}}
 */
export function pathWhy({ path, budget = null, pickBy = 'most', single = null, singleName = '' }) {
    const limit = Number.isFinite(budget) && pickBy !== 'max' ? budget : null;
    const mine = '+' + fmtShort(path.gained) + ' for ' + fmtMoney(path.cost);
    const over = limit !== null && path.cost > limit ? ' It ends ' + fmtMoney(path.cost - limit) + ' over that: a gym’s fee near the end.' : '';
    const head = (pickBy === 'value' ? 'the best value, stretch by stretch' : 'the most stats') + (limit !== null ? ' inside your ' + fmtMoney(limit) : '') + ': ' + mine + '.' + over;
    if (!single) return { wins: true, text: head };
    const theirs = '+' + fmtShort(single.gained) + ' for ' + fmtMoney(single.cost);
    if (single.gained > path.gained && (limit === null || single.cost <= limit)) return { wins: false, text: 'The path: ' + mine + '. ' + singleName + ' the whole way gains more, ' + theirs + ': you can follow it below.' };
    const inside = limit === null || single.cost <= limit;
    return { wins: true, text: head + ' ' + (inside ? 'The best single plan' + (limit !== null ? ' inside it' : '') + ', ' + singleName + ', gains ' + theirs + '.' : 'No single plan fits it; the closest, ' + singleName + ', gains ' + theirs + '.') };
}

/** The daily recalibration waits this long after Torn's reset (the day's first reads and prices come in). */
export const AUTO_RECAL_AFTER_MS = 2 * 60 * 1000;
/** A run that failed is tried again this much later, not every minute. */
export const AUTO_RECAL_RETRY_MS = 30 * 60 * 1000;
/** The stats read it starts from must be this fresh. */
export const AUTO_RECAL_STATE_MS = 10 * 60 * 1000;

/**
 * Is the plan's own recalibration due (round 8; the accountant: "recalibrate once per day, at Torn's reset; keep
 * the button")? Once a Torn day, from two minutes after the reset, or the first moment after that the app is open.
 * A plan made or recalibrated today (by you or by itself) is done for the day.
 * @param {object} o
 * @param {object|null} o.planNow - the saved plan's small part ({rev, start, end, createdAt, recalibratedAt})
 * @param {object} o.settings - {autoRecalibrate}: off only when set to false
 * @param {object|null} [o.last] - the last try {day, at, ok}
 * @param {number|null} [o.stateAt] - when your stats were last read
 * @param {boolean} [o.busy] - a plan is being worked out
 * @param {boolean} [o.stacking] - chain mode: Resume recalibrates
 * @param {boolean} [o.overdose] - "Rehab done" recalibrates
 * @param {number} o.now
 * @returns {{due:boolean, why:string}}
 */
export function autoRecalibrateDue({ planNow, settings, last = null, stateAt = null, busy = false, stacking = false, overdose = false, now }) {
    const no = (why) => ({ due: false, why });
    if (settings && settings.autoRecalibrate === false) return no('off');
    if (!planNow || !Number.isFinite(planNow.end)) return no('no plan');
    if (now >= planNow.end) return no('ended');
    const today = tornDayStart(now);
    if (Math.max(planNow.createdAt || 0, planNow.recalibratedAt || 0, planNow.rev || 0) >= today) return no('done today');
    if (now - today < AUTO_RECAL_AFTER_MS) return no('just after the reset');
    if (busy) return no('busy');
    if (stacking) return no('stacking');
    if (overdose) return no('overdose');
    if (last && last.day === today && last.ok === false && now - last.at < AUTO_RECAL_RETRY_MS) return no('tried');
    if (last && last.day === today && last.ok === null && now - last.at < AUTO_RECAL_RETRY_MS) return no('another tab');
    if (!Number.isFinite(stateAt) || now - stateAt > AUTO_RECAL_STATE_MS) return no('waiting for a read');
    return { due: true, why: 'due' };
}
