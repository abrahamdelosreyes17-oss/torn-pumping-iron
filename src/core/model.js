/*
 * Everything a page shows, worked out from stored data in one pure pass:
 * the live state, the slow data (perks, property, gyms, inventory), the
 * plan, the day's log and settings. The webpage and the overlay both render
 * from this, so they can never disagree.
 */

import { STATS, totalOf } from './gain.js';
import { parsePerks } from './perks.js';
import { mergeLiveGyms, unlockedGyms, bestGymFor, gymAccess, gymById, nextGym, GYMS } from './gyms.js';
import { buildGaps, projectBuild, resolveBuild } from './builds.js';
import { energyAt, happyAt, drugFreeAt, boosterFreeAt, refillAvailable, tornDayStart, msToTornMidnight, DAY } from './bars.js';
import { dayTimeline, targetShares, drugsToday, itemsNeeded, strictWarnings, REFILL_WARN_MS } from './plan.js';
import { simulateStrategy, feasibleStrategies, STRATEGIES } from './strategies.js';
import { recommend, pickWarning } from './recommend.js';
import { needList, livePrices } from './market.js';
import { energyLadder, boosterChoice, priceFor } from './ladder.js';
import { upcomingEvents, holdBoosterFor, eventHeadsUp } from './events.js';
import { PICK_BY } from './recommend.js';
import { XANAX, SAMPLE_PRICES, ITEMS } from './items.js';
import { HAPPY_CAP } from './gain.js';
import { JUMP_STACK } from './strategies.js';

/*
 * The 30-day build projection is the heavy part of a model (thousands of
 * simulated trains) and only changes when the stats, build or gyms do, so
 * the last one is kept.
 */
const projectionMemo = { key: '', value: null };

/** Energy above the maximum that isn't counted as a stacked or held Xanax (a can or two). */
export const STRAY_ENERGY = 50;

/** Drug steps in the day log (a held Xanax and a catch-up with a drug count too): one rule everywhere. */
export function isDrugEntry(e) {
    return e.kind === 'xanax' || e.kind === 'stack' || e.kind === 'hold' || (e.kind === 'catchup' && e.drug);
}

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
    return resolveBuild(id);
}

/**
 * The context the engine needs about this player right now.
 * @param {object} state - normalizeState()
 * @param {object} statics - stored slow data {perks, property, gyms, inventory, keyInfo}
 * @param {object} extra - {unlockedKnown, drugsTaken, learnedMult: per-stat multipliers the learner kept (unknown perks)}
 */
export function playerContext(state, statics = {}, extra = {}) {
    const table = statics.gyms && statics.gyms.length ? mergeLiveGyms(statics.gyms) : GYMS;
    const perks = parsePerks(statics.perks || {});
    // What the learner found in your own trains (an unknown perk): on top of the perks Torn lists.
    if (extra.learnedMult) for (const k of STATS) perks.mult[k] *= Number(extra.learnedMult[k]) > 0 ? Number(extra.learnedMult[k]) : 1;
    const unlocked = unlockedGyms(state && state.gymId, extra.unlockedKnown || null);
    const stats = (state && state.stats) || { str: 0, spd: 0, def: 0, dex: 0 };
    const best = {};
    for (const k of STATS) best[k] = bestGymFor(k, stats, unlocked, { table, drugsTaken: extra.drugsTaken ?? null, active: state && state.gymId });
    return { table, perks, unlocked, stats, best };
}

/** The booster cap: 24 h, plus faction Voracity's extra hours, or the setting if higher. */
export function boosterCapOf(pc, settings = {}) {
    return Math.max(settings.boosterCapH || 24, 24 + ((pc.perks && pc.perks.boosterCapExtraH) || 0));
}

/** Special refills the plan may still use: the number set, less what the account has used since. */
export function specialLeft(plan, state) {
    const use = Math.max(0, Math.floor((plan && plan.specialUse) || 0));
    if (!use || !state || state.specialRefills === null || state.specialRefills === undefined) return 0;
    const start = plan.specialStart === null || plan.specialStart === undefined ? state.specialRefills : plan.specialStart;
    const spent = Math.max(0, start - state.specialRefills);
    return Math.max(0, Math.min(state.specialRefills, use - spent));
}

/** The simulation inputs every strategy shares. */
function simInputs({ state, pc, shares, settings, prices, special = 0 }) {
    const gyms = {};
    for (const k of STATS) if (pc.best[k]) gyms[k] = { dots: pc.best[k].dots[k], energy: pc.best[k].energy };
    return {
        stats: pc.stats,
        target: shares,
        gyms,
        perks: pc.perks.mult,
        happyMax: state.happy.maximum,
        energyMax: state.energy.maximum,
        fastEnergy: state.energy.interval <= 600,
        days: settings.horizonDays || 30,
        // Stored price rows are objects: count what 10 units cost from the cheapest up (never $0).
        prices: { ...SAMPLE_PRICES, ...livePrices(prices) },
        bliss: pc.perks.bliss,
        happyLossMult: pc.perks.happyLossMult,
        boosterCapH: boosterCapOf(pc, settings),
        special,
        canMult: pc.perks.canMult || 1,
        candyMult: pc.perks.candyMult || 1,
        toyShop5: Boolean(pc.perks.toyShop5),
        adultNovelties10: Boolean(pc.perks.adultNovelties10),
    };
}

/**
 * Run every feasible strategy for the horizon (cached by the caller). Also
 * "Steady + energy boosters": what's left of the budget each day, spent on
 * FHC or cans on the booster cooldown (the ladder's next rung).
 * @param {object} o - {state, pc, shares, settings, prices, special}
 */
export function compareStrategies({ state, pc, shares, settings, prices, special = 0 }) {
    const base = simInputs({ state, pc, shares, settings, prices, special });
    const results = {};
    for (const id of feasibleStrategies({ bliss: pc.perks.bliss, boosterCapH: base.boosterCapH, toyShop5: base.toyShop5, adultNovelties10: base.adultNovelties10 })) {
        results[id] = withBestSpecial(id, base);
    }
    const budget = settings.budget || Infinity;
    if (results.steady && Number.isFinite(budget)) {
        const choice = boosterChoice({ perDay: (budget - results.steady.cost) / base.days, maxE: base.energyMax, prices: base.prices, canMult: base.canMult, capH: base.boosterCapH });
        // Only a real middle rung: fewer than steadyMax's FHC every time.
        if (choice && !(choice.id === steadyMaxItem() && results.steadyMax && choice.perDay >= boostersPerDayMax(base))) {
            results.steadyBoost = { ...withBestSpecial('steadyBoost', { ...base, energyBooster: { id: choice.id, perDay: choice.perDay } }), booster: choice };
        }
    }
    return results;
}

/**
 * Special refills are free energy, but every train costs happy: at the
 * maximum (steady training) spending them can cost more than they add. Run
 * the plan with and without them and keep the better (`specialHelps`).
 */
function withBestSpecial(id, base) {
    const r = simulateStrategy(id, base);
    if (!(base.special > 0)) return r;
    const without = simulateStrategy(id, { ...base, special: 0 });
    return without.gained > r.gained ? { ...without, specialHelps: false } : { ...r, specialHelps: true, specialGain: r.gained - without.gained };
}

function steadyMaxItem() {
    return 367;
}

function boostersPerDayMax(base) {
    return Math.floor(base.boosterCapH / 6);
}

/**
 * Ignorance Is Bliss, what if (Plan's Bliss card): the plans the book
 * changes most, run as if it were active. Not recommended from; shown.
 */
export function blissWhatIf({ state, pc, shares, settings, prices, special = 0 }) {
    const base = { ...simInputs({ state, pc, shares, settings, prices, special }), bliss: true };
    return { blissSteady: { ...simulateStrategy('blissSteady', base), whatIf: true }, dailyChoco: { ...simulateStrategy('dailyChoco', base), whatIf: true } };
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
/**
 * A step the player skipped in Discord (the bot's Skip button) is left out:
 * same kind within 10 minutes of its time, or the same words.
 */
export function withoutSkipped(steps, skipped = []) {
    if (!skipped || !skipped.length) return steps;
    return steps.filter((s) => !skipped.some((x) => x.kind === s.kind && (Math.abs((x.stepAt || 0) - s.at) <= 10 * 60 * 1000 || (x.label && x.label === s.label))));
}

export function buildModel({ state, statics = {}, plan, settings, log = [], history = {}, prices = {}, compare = null, whatIf = null, gymProgress = null, unlockedKnown = null, learnedMult = null, skipped = [], now }) {
    if (!state) return { ready: false };
    const pc = playerContext(state, statics, { unlockedKnown, learnedMult });
    const build = buildOf(plan.build);
    const shares = targetShares(plan, pc.stats, build.shares);
    const keep = (build.gyms || []).filter((id) => pc.unlocked.includes(id) && gymAccess(gymById(id, pc.table), pc.stats).ok);
    const today = (log || []).filter((e) => tornDayStart(e.at) === tornDayStart(now));
    const boostedToday = today.some((e) => e.kind === 'boost');
    // Energy above the maximum is stacked (a jump) or held (daily choco) Xanax: read from the bars, so it survives Torn midnight and reloads.
    // A can (+20–30) above the maximum isn't a Xanax; one Xanax always puts at least 100 above it.
    const over = Math.max(0, energyAt(state, now) - state.energy.maximum - STRAY_ENERGY);
    const ctx = {
        shares,
        unlocked: pc.unlocked,
        perks: pc.perks.mult,
        keep,
        active: state.gymId,
        table: pc.table,
        bliss: pc.perks.bliss,
        happyLossMult: pc.perks.happyLossMult,
        drugsToday: drugsToday(today, now),
        boostedToday,
        stackedSoFar: Math.min(JUMP_STACK, Math.ceil(over / ITEMS[XANAX].energy)),
        holding: plan.strategy === 'dailyChoco' && !boostedToday && over > 0,
        boosterCapH: boosterCapOf(pc, settings),
        // Only where the comparison found they add stats (they cost happy like any train).
        specialLeft: compare && compare[plan.strategy] && compare[plan.strategy].specialHelps === false ? 0 : specialLeft(plan, state),
        specialPerDay: Math.ceil(specialLeft(plan, state) / Math.max(1, (settings.horizonDays || 30) - Math.floor((now - (plan.specialSetAt || now)) / DAY))),
        energyBooster: compare && compare.steadyBoost ? compare.steadyBoost.booster : null,
        boostersToday: today.filter((e) => e.kind === 'booster').length,
        candyMult: pc.perks.candyMult || 1,
        canMult: pc.perks.canMult || 1,
        toyShop5: Boolean(pc.perks.toyShop5),
        adultNovelties10: Boolean(pc.perks.adultNovelties10),
    };
    // Torn events that change training: a heads-up, and no boosters in the day before one that needs the booster cooldown.
    const events = statics.calendar ? upcomingEvents(statics.calendar.calendar, now, { startTime: statics.calendar.startTime }) : [];
    const hold = holdBoosterFor(events, now);
    if (hold) ctx.holdBooster = hold.id;
    const steps = withoutSkipped(dayTimeline({ state, now, strategy: plan.strategy, ctx }), skipped);
    const next = steps[0] || null;

    // Status strip
    const energy = energyAt(state, now);
    const e = state.energy;
    const fullAt = energy >= e.maximum ? null : now + (Math.ceil((e.maximum - energy) / e.increment) * e.interval * 1000);
    const drugLeft = Math.max(0, drugFreeAt(state) - now);
    const boosterLeft = Math.max(0, boosterFreeAt(state) - now);
    const refillFree = refillAvailable(state, now);
    const refillStep = steps.find((s) => s.kind === 'refill');
    const xanaxPlanned = today.filter(isDrugEntry).length + steps.filter((s) => (s.kind === 'xanax' || s.kind === 'stack' || s.kind === 'hold') && s.at < tornDayStart(now) + DAY).length;
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
    // With Ignorance Is Bliss happy doesn't fall back to the maximum: the projection trains at today's happy.
    const projHappy = pc.perks.bliss ? Math.min(HAPPY_CAP, Math.max(state.happy.current, state.happy.maximum) + 300) : state.happy.maximum + 300;
    const proj = projectionFor({ stats: pc.stats, shares, energyPerDay, happy: projHappy, unlocked: pc.unlocked, perks: pc.perks.mult, keep, days: 30, active: state.gymId, table: pc.table });
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
    if (!plan.buildPicked) heads.push({ tone: 'warn', text: 'Pick your build type', sub: 'Plan › Build: the plan trains toward it' });
    for (const w of strictWarnings(steps, now)) heads.push({ tone: 'warn', text: w.text });
    if (refillFree && msToTornMidnight(now) < REFILL_WARN_MS) heads.push({ tone: 'warn', text: 'Refill unused', sub: 'use before 00:00 Torn time' });
    if (ng && ng.gym) heads.push({ tone: 'plain', text: ng.gym.name + (ng.known ? ' in about ' + Math.max(1, Math.round(ng.days)) + ' days' : ' is next'), sub: 'buy it for $' + (ng.cost >= 1e6 ? ng.cost / 1e6 + 'M' : ng.cost) });
    for (const e of events.slice(0, 2)) {
        const hu = eventHeadsUp(e, now);
        heads.push({ tone: e.active ? 'good' : 'plain', text: hu.text, sub: hu.sub, event: e.id });
    }
    if (hold && steps.some((s2) => (s2.items || []).some((it) => ITEMS[it.id] && ITEMS[it.id].kind === 'booster'))) heads.push({ tone: 'warn', text: 'Keep the booster cooldown free', sub: hold.name + ' starts within a day' });
    let rec = null;
    let ladder = null;
    const pickBy = PICK_BY[plan.pickBy] ? plan.pickBy : 'most';
    if (compare) {
        const r = recommend(compare, { budget: settings.budget || Infinity, bliss: pc.perks.bliss, pickBy });
        rec = r;
        const mine = compare[plan.strategy];
        if (r.recommended === plan.strategy) heads.push({ tone: 'good', text: (STRATEGIES[plan.strategy] || {}).name + ' is still best' });
        else if (mine) {
            const w = pickWarning(compare[r.recommended], mine, { bliss: pc.perks.bliss, days: settings.horizonDays || 30 });
            if (w.warn) heads.push({ tone: 'warn', text: (STRATEGIES[r.recommended] || {}).name + ' would gain more', sub: 'see Plan' });
        }
        ladder = energyLadder({ state, pc, shares, prices, compare, recommended: r.recommended, days: settings.horizonDays || 30, budget: settings.budget || Infinity, specialHave: state.specialRefills || 0, specialUse: specialLeft(plan, state) });
    }
    // Spend per day, and how long the cash on hand lasts at the recommended plan's pace.
    const horizon = settings.horizonDays || 30;
    const recRow = rec && compare ? compare[rec.recommended] : null;
    const cash = statics.inventory && Number.isFinite(statics.inventory.cash) ? statics.inventory.cash : null;
    const spend = recRow ? { perDay: recRow.cost / horizon, budgetPerDay: Number.isFinite(settings.budget) ? settings.budget / horizon : null, cash, lastsDays: cash !== null && recRow.cost > 0 ? cash / (recRow.cost / horizon) : null } : null;

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
        buildPicked: Boolean(plan.buildPicked),
        recommendation: rec,
        compare,
        whatIf,
        ladder,
        spend,
        events,
        pickBy,
        special: { have: state.specialRefills, left: specialLeft(plan, state), use: plan.specialUse || 0 },
        prices,
    };
}

