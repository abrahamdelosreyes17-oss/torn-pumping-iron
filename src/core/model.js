/*
 * Everything a page shows, worked out from stored data in one pure pass:
 * the live state, the slow data (perks, property, gyms, inventory), the
 * plan, the day's log and settings. The webpage and the overlay both render
 * from this, so they can never disagree.
 */

import { STATS, totalOf } from './gain.js';
import { parsePerks } from './perks.js';
import { mergeLiveGyms, unlockedGyms, bestGymFor, gymAccess, gymById, nextGym, GYMS } from './gyms.js';
import { BUILDS, withHighStat, buildGaps, projectBuild, DEFAULT_BUILD } from './builds.js';
import { energyAt, happyAt, drugFreeAt, boosterFreeAt, refillAvailable, tornDayStart, msToTornMidnight, DAY } from './bars.js';
import { dayTimeline, targetShares, drugsToday, itemsNeeded, strictWarnings, REFILL_WARN_MS } from './plan.js';
import { simulateStrategy, feasibleStrategies, STRATEGIES } from './strategies.js';
import { recommend, pickWarning } from './recommend.js';
import { needList } from './market.js';
import { XANAX, SAMPLE_PRICES } from './items.js';

/*
 * The 30-day build projection is the heavy part of a model (thousands of
 * simulated trains) and only changes when the stats, build or gyms do, so
 * the last one is kept.
 */
const projectionMemo = { key: '', value: null };

export function projectionFor(args) {
    const key = JSON.stringify([args.stats, args.shares, args.energyPerDay, args.happy, args.unlocked, args.perks, args.keep, args.days, args.active, args.table.map((g) => [g.id, g.dots])]);
    if (key !== projectionMemo.key) {
        projectionMemo.key = key;
        projectionMemo.value = projectBuild(args);
    }
    return projectionMemo.value;
}

/** Build shares for a plan's build id ("baldr" or "baldr:dex"). */
export function buildOf(id) {
    const [base, high] = String(id || DEFAULT_BUILD).split(':');
    const b = high ? withHighStat(base, high) : BUILDS[base];
    return b || BUILDS[DEFAULT_BUILD];
}

/**
 * The context the engine needs about this player right now.
 * @param {object} state - normalizeState()
 * @param {object} statics - stored slow data {perks, property, gyms, inventory, keyInfo}
 * @param {object} extra - {unlockedKnown, drugsTaken}
 */
export function playerContext(state, statics = {}, extra = {}) {
    const table = statics.gyms && statics.gyms.length ? mergeLiveGyms(statics.gyms) : GYMS;
    const perks = parsePerks(statics.perks || {});
    const unlocked = unlockedGyms(state && state.gymId, extra.unlockedKnown || null);
    const stats = (state && state.stats) || { str: 0, spd: 0, def: 0, dex: 0 };
    const best = {};
    for (const k of STATS) best[k] = bestGymFor(k, stats, unlocked, { table, drugsTaken: extra.drugsTaken ?? null, active: state && state.gymId });
    return { table, perks, unlocked, stats, best };
}

/** Run every feasible strategy for the horizon (cached by the caller per day). */
export function compareStrategies({ state, pc, shares, settings, prices }) {
    const gyms = {};
    for (const k of STATS) if (pc.best[k]) gyms[k] = { dots: pc.best[k].dots[k], energy: pc.best[k].energy };
    const results = {};
    for (const id of feasibleStrategies({ bliss: pc.perks.bliss, boosterCapH: settings.boosterCapH || 24 })) {
        results[id] = simulateStrategy(id, {
            stats: pc.stats,
            target: shares,
            gyms,
            perks: pc.perks.mult,
            happyMax: state.happy.maximum,
            energyMax: state.energy.maximum,
            fastEnergy: state.energy.interval <= 600,
            days: settings.horizonDays || 30,
            prices: { ...SAMPLE_PRICES, ...(prices || {}) },
            bliss: pc.perks.bliss,
            happyLossMult: pc.perks.happyLossMult,
            boosterCapH: settings.boosterCapH || 24,
        });
    }
    return results;
}

/**
 * @param {object} o
 * @param {object} o.state - normalizeState() of the stored user state (null before the first poll)
 * @param {object} o.statics
 * @param {object} o.plan - stored plan
 * @param {object} o.settings
 * @param {object[]} o.log - today's done steps
 * @param {object} o.history - statsHistory {day: {str,...,total}}
 * @param {object} [o.prices] - {itemId: cheapest price}
 * @param {object} [o.compare] - cached compareStrategies() result
 * @param {object} [o.gymProgress] - {gymId, energy} read from the gym page
 * @param {number} o.now
 */
export function buildModel({ state, statics = {}, plan, settings, log = [], history = {}, prices = {}, compare = null, gymProgress = null, unlockedKnown = null, now }) {
    if (!state) return { ready: false };
    const pc = playerContext(state, statics, { unlockedKnown });
    const build = buildOf(plan.build);
    const shares = targetShares(plan, pc.stats, build.shares);
    const keep = (build.gyms || []).filter((id) => pc.unlocked.includes(id) && gymAccess(gymById(id, pc.table), pc.stats).ok);
    const today = (log || []).filter((e) => tornDayStart(e.at) === tornDayStart(now));
    const ctx = { shares, unlocked: pc.unlocked, perks: pc.perks.mult, keep, active: state.gymId, table: pc.table, bliss: pc.perks.bliss, happyLossMult: pc.perks.happyLossMult, drugsToday: drugsToday(today, now), boostedToday: today.some((e) => e.kind === 'boost') };
    const steps = dayTimeline({ state, now, strategy: plan.strategy, ctx });
    const next = steps[0] || null;

    // Status strip
    const energy = energyAt(state, now);
    const e = state.energy;
    const fullAt = energy >= e.maximum ? null : now + (Math.ceil((e.maximum - energy) / e.increment) * e.interval * 1000);
    const drugLeft = Math.max(0, drugFreeAt(state) - now);
    const boosterLeft = Math.max(0, boosterFreeAt(state) - now);
    const refillFree = refillAvailable(state, now);
    const refillStep = steps.find((s) => s.kind === 'refill');
    const xanaxPlanned = today.filter((x) => x.kind === 'xanax' || x.kind === 'stack').length + steps.filter((s) => (s.kind === 'xanax' || s.kind === 'stack' || s.kind === 'hold') && s.at < tornDayStart(now) + DAY).length;
    const strip = {
        energy: { current: energy, max: e.maximum, fullAt },
        happy: { current: happyAt(state, now, { bliss: pc.perks.bliss }), max: state.happy.maximum, property: statics.property && statics.property.property ? statics.property.property.name : null },
        drug: { left: drugLeft, total: drugLeft > 0 ? Math.max(drugLeft, state.drugCd * 1000) : 0, xanaxDone: ctx.drugsToday, xanaxPlanned },
        booster: { left: boosterLeft, used: steps.some((s) => (s.items || []).some((it) => it.id !== XANAX && it.id !== 'points' && it.id !== 197)) },
        refill: { free: refillFree, plannedAt: refillStep ? refillStep.at : null },
    };

    // Stats vs build
    const gaps = buildGaps(pc.stats, shares);
    const days = Object.keys(history || {}).map(Number).sort((a, b) => a - b).slice(-7);
    const trainedToday = {};
    for (const x of today) for (const k of STATS) trainedToday[k] = (trainedToday[k] || 0) + ((x.trained && x.trained[k]) || 0);
    const plannedToday = {};
    for (const s of steps) for (const [k, n] of Object.entries(s.trains || {})) plannedToday[k] = (plannedToday[k] || 0) + n;
    const statRows = STATS.map((k) => ({
        stat: k,
        value: pc.stats[k],
        share: gaps[k].share,
        target: shares[k],
        gap: gaps[k].gap,
        over: gaps[k].over,
        spark: days.map((d) => history[d][k]),
        today: trainedToday[k] || 0,
        plannedTrains: plannedToday[k] || 0,
    }));
    const gainedToday = today.reduce((a, x) => a + (x.gain || 0), 0);
    const plannedGain = gainedToday + steps.filter((s) => s.at < tornDayStart(now) + DAY).reduce((a, s) => a + (s.gain || 0), 0);

    // Build ETA and next gym
    const energyPerDay = Math.round(((e.interval <= 600 ? 720 : 480) + 250 * Math.floor(1440 / 420) + e.maximum) / 10) * 10;
    const proj = projectionFor({ stats: pc.stats, shares, energyPerDay, happy: state.happy.maximum + 300, unlocked: pc.unlocked, perks: pc.perks.mult, keep, days: 30, active: state.gymId, table: pc.table });
    // The next ladder gym after the highest one unlocked; its progress comes from the gym page (percentage on the button).
    const ladderTop = Math.max(0, ...pc.unlocked.filter((id) => id <= 24));
    const progressE = gymProgress && Number(gymProgress.nextId) === ladderTop + 1 ? gymProgress.energy : null;
    const ng = ladderTop >= 1 && ladderTop < 24 ? nextGym(ladderTop, progressE, energyPerDay, { gymExpMult: pc.perks.gymExpMult, table: pc.table }) : null;
    if (ng) ng.known = progressE !== null && progressE !== undefined;

    // Buy today
    const neededToday = itemsNeeded(steps.filter((s) => s.at < tornDayStart(now) + DAY));
    const buyToday = needList(neededToday, statics.inventory || {});

    // Heads-up
    const heads = [];
    for (const w of strictWarnings(steps, now)) heads.push({ tone: 'warn', text: w.text });
    if (refillFree && msToTornMidnight(now) < REFILL_WARN_MS * 6) heads.push({ tone: 'warn', text: 'Refill unused', sub: 'use before 00:00 Torn time' });
    if (ng && ng.gym) heads.push({ tone: 'plain', text: ng.gym.name + (ng.known ? ' in about ' + Math.max(1, Math.round(ng.days)) + ' days' : ' is next'), sub: 'buy it for $' + (ng.cost >= 1e6 ? ng.cost / 1e6 + 'M' : ng.cost) });
    let rec = null;
    if (compare) {
        const r = recommend(compare, { budget: settings.budget || Infinity });
        rec = r;
        const mine = compare[plan.strategy];
        if (r.recommended === plan.strategy) heads.push({ tone: 'good', text: (STRATEGIES[plan.strategy] || {}).name + ' is still best' });
        else if (mine) {
            const w = pickWarning(compare[r.recommended], mine, { bliss: pc.perks.bliss, days: settings.horizonDays || 30 });
            if (w.warn) heads.push({ tone: 'warn', text: (STRATEGIES[r.recommended] || {}).name + ' would gain more', sub: 'see Plan' });
        }
    }

    return {
        ready: true,
        now,
        state,
        pc,
        build,
        shares,
        keep,
        steps,
        next,
        done: today,
        strip,
        statRows,
        total: totalOf(pc.stats),
        gainedToday,
        plannedGain,
        reachedDay: proj.reachedDay,
        projection: proj.days.slice(0, 7),
        nextGym: ng,
        energyPerDay,
        buyToday,
        heads,
        recommendation: rec,
        compare,
        prices,
    };
}

