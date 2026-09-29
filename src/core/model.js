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
import { simulateStrategy, feasibleStrategies, STRATEGIES, CANDY_PLANS, consoleBlocked } from './strategies.js';
import { recommend, pickWarning } from './recommend.js';
import { needList, livePrices, marketPricesFrom, npcPricesFrom } from './market.js';
import { bestCandy } from './candy.js';
import { companyJob, jobHappyOf, freeEdvdPerDayOf, worksAt, VOYEUR_JP, JOB_LOCK_H } from './jobs.js';
import { energyLadder, boosterChoice, priceFor } from './ladder.js';
import { upcomingEvents, holdBoosterFor, eventHeadsUp, eventMults } from './events.js';
import { PICK_BY } from './recommend.js';
import { XANAX, SAMPLE_PRICES, ITEMS, XANAX_CD_MIN, GAME_CONSOLE } from './items.js';
import { HAPPY_CAP } from './gain.js';
import { JUMP_STACK } from './strategies.js';
import { budgetOf, effectivePickBy, eventSwitchHeads, affordLine, autoWaitLine, unlockDays, unlockEnergyLeft } from './auto.js';

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

/** Days left to spread special refills over (the whole horizon again once it has passed, never one day). */
export function specialDaysLeft(horizon, daysSince) {
    const left = horizon - daysSince;
    return left >= 1 ? left : horizon;
}

/** Special refills the plan may still use: the number set, less what the account has used since. */
export function specialLeft(plan, state) {
    const use = Math.max(0, Math.floor((plan && plan.specialUse) || 0));
    if (!use || !state || state.specialRefills === null || state.specialRefills === undefined) return 0;
    const start = plan.specialStart === null || plan.specialStart === undefined ? state.specialRefills : plan.specialStart;
    const spent = Math.max(0, start - state.specialRefills);
    return Math.max(0, Math.min(state.specialRefills, use - spent));
}

/**
 * What the player's items, job and shop ticks add to the plan (candy choice,
 * the console, job points, NPC prices). Pure; read from the stored statics.
 * @param {object} statics - {inventory, items (Torn item data), job, jobPoints}
 * @param {object} settings - {npcShops: the city shops the player ticked}
 */
export function itemContext(statics = {}, settings = {}) {
    const info = (statics && statics.items) || {};
    const inv = (statics && statics.inventory) || {};
    const cj = companyJob(statics && statics.job, statics && statics.jobPoints);
    return {
        // Torn's own market price: a candy's price until its listings load (never over a live listing).
        marketPrices: marketPricesFrom(info),
        npc: npcPricesFrom(info, settings.npcShops),
        consoleOwned: Number(inv[GAME_CONSOLE]) > 0,
        job: cj,
        jobHappy: jobHappyOf(cj),
        freeEdvdPerDay: freeEdvdPerDayOf(cj),
    };
}

/** The simulation inputs every strategy shares. */
function simInputs({ state, pc, shares, settings, prices, special = 0, statics = {} }) {
    const gyms = {};
    for (const k of STATS) if (pc.best[k]) gyms[k] = { dots: pc.best[k].dots[k], energy: pc.best[k].energy };
    const ic = itemContext(statics, settings);
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
        prices: { ...SAMPLE_PRICES, ...ic.marketPrices, ...livePrices(prices) },
        npc: ic.npc,
        bliss: pc.perks.bliss,
        happyLossMult: pc.perks.happyLossMult,
        boosterCapH: boosterCapOf(pc, settings),
        special,
        // Special refills held: the daily refill uses them while any are left (the points refill waits) [verify].
        specialHeld: Math.max(0, Number(state.specialRefills) || 0),
        canMult: pc.perks.canMult || 1,
        candyMult: pc.perks.candyMult || 1,
        cdMult: pc.perks.consumableCdMult || 1,
        toyShop5: Boolean(pc.perks.toyShop5) || worksAt(ic.job, 'Toy Shop', 5) || worksAt(ic.job, 'Game Shop', 5),
        adultNovelties10: Boolean(pc.perks.adultNovelties10) || worksAt(ic.job, 'Adult Novelties', 10),
        consoleOwned: ic.consoleOwned,
        jobHappy: ic.jobHappy,
        freeEdvdPerDay: ic.freeEdvdPerDay,
    };
}

/**
 * The candy a plan uses, picked by the Plan's rule: every candy with a known
 * price is run through the plan (the dominated ones skipped), and the one
 * with the most stats in the budget (or per $1M, or no budget) wins.
 * @returns {{result:object, candy:object|null}}
 */
function withBestCandy(id, base, { budget = Infinity, pickBy = 'most' } = {}) {
    const runs = {};
    const evaluate = (cid, n) => (runs[cid] = runs[cid] || simulateStrategy(id, { ...base, special: 0, candyId: cid, candyCount: n }));
    const pick = bestCandy({ prices: base.prices, npc: base.npc, capH: base.boosterCapH, cdCuts: base.cdMult, happyMult: base.candyMult, budget, pickBy, evaluate });
    if (!pick) return { result: withBestSpecial(id, base), candy: null };
    const input = { ...base, candyId: pick.id, candyCount: pick.count };
    const result = base.special > 0 ? withBestSpecial(id, input) : runs[pick.id];
    const candy = { id: pick.id, count: pick.count, unit: pick.unit, source: pick.source, shop: pick.shop, perBoost: pick.perBoost, options: pick.options.length };
    return { result: { ...result, candy }, candy };
}

/**
 * Run every feasible strategy for the horizon (cached by the caller). Also
 * "Steady + energy boosters": what's left of the budget each day, spent on
 * FHC or cans on the booster cooldown (the ladder's next rung).
 * Candy plans name their candy (result.candy), picked under the Plan's rule
 * (`pickBy`). The console jump carries `blocked` when a stat it trains is at
 * or over 250k (never recommended then).
 * @param {object} o - {state, pc, shares, settings, prices, special, statics, pickBy}
 */
export function compareStrategies({ state, pc, shares, settings, prices, special = 0, statics = {}, pickBy = 'most' }) {
    const base = simInputs({ state, pc, shares, settings, prices, special, statics });
    const results = {};
    const budget = budgetOf(settings);
    for (const id of feasibleStrategies({ bliss: pc.perks.bliss, boosterCapH: base.boosterCapH, toyShop5: base.toyShop5, adultNovelties10: base.adultNovelties10 })) {
        if (id === 'consoleJump' || id === 'consoleJumpToy') {
            // Low-stat players only: over 250k in a stat it trains, it's shown (behind the tick) and never picked.
            const probe = simulateStrategy(id, { ...base, special: 0 });
            const blocked = consoleBlocked(pc.stats, probe.perStat);
            if (blocked) {
                results[id] = { ...probe, blocked };
                continue;
            }
        }
        results[id] = CANDY_PLANS.has(id) ? withBestCandy(id, base, { budget, pickBy }).result : withBestSpecial(id, base);
    }
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
export function blissWhatIf({ state, pc, shares, settings, prices, special = 0, statics = {}, pickBy = 'most' }) {
    const base = { ...simInputs({ state, pc, shares, settings, prices, special, statics }), bliss: true };
    return { blissSteady: { ...simulateStrategy('blissSteady', base), whatIf: true }, dailyChoco: { ...withBestCandy('dailyChoco', base, { budget: budgetOf(settings), pickBy }).result, whatIf: true } };
}

/**
 * Company what-ifs (Plan, beside the Bliss what-if): the jump variants a job
 * makes better, run as if the player were hired there. Only the ones that
 * beat the recommended plan are kept (within the budget unless "Max gains").
 * - 10★ Adult Novelties: EDVD happy ×2, and 3★ "Voyeur" 20 JP → 1 EDVD (10 JP a day: a free EDVD every 2 days);
 * - 5★ Toy Shop or Game Shop "Gamer": the console jump's happy ×2 (low stats only, like the console jump).
 * @param {object} o - as compareStrategies, plus `compare` (the real plans) and `recommended` (its id)
 * @returns {object[]} [{id, strategy, company, stars, title, result, deltaPct, note}]
 */
export function companyWhatIf({ state, pc, shares, settings, prices, special = 0, statics = {}, pickBy = 'most', compare = null, recommended = null }) {
    const best = compare && recommended ? compare[recommended] : null;
    if (!best) return [];
    const base = simInputs({ state, pc, shares, settings, prices, special, statics });
    const cj = companyJob(statics.job, statics.jobPoints);
    const limit = pickBy === 'max' ? Infinity : budgetOf(settings);
    const out = [];
    const note = 'It means being hired by that company (its director hires you), and job specials are locked for ' + JOB_LOCK_H + ' h after joining.';
    const add = (key, strategy, company, stars, r) => {
        if (!r || !(r.gained > best.gained) || r.cost > limit) return;
        const deltaPct = best.gained > 0 ? (100 * (r.gained - best.gained)) / best.gained : 0;
        out.push({ id: key, strategy, company, stars, title: 'Hired at a ' + stars + '★ ' + company, result: { ...r, whatIf: true }, deltaPct, note });
    };
    if (!worksAt(cj, 'Adult Novelties', 10) && !base.adultNovelties10) {
        add('an10', 'edvdJumpAN', 'Adult Novelties', 10, withBestSpecial('edvdJumpAN', { ...base, adultNovelties10: true, freeEdvdPerDay: 10 / VOYEUR_JP, jobHappy: null }));
    }
    if (!base.toyShop5) {
        const probe = simulateStrategy('consoleJumpToy', { ...base, special: 0, toyShop5: true, jobHappy: null });
        if (!consoleBlocked(pc.stats, probe.perStat)) add('toy5', 'consoleJumpToy', 'Toy Shop or Game Shop', 5, withBestCandy('consoleJumpToy', { ...base, toyShop5: true, jobHappy: null }, { budget: budgetOf(settings), pickBy }).result);
    }
    return out.sort((a, b) => b.result.gained - a.result.gained);
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
    // Same Torn day only (labels like "Xanax #2" repeat every day), within 30 minutes of the skipped step's time.
    return steps.filter((s) => !skipped.some((x) => x.kind === s.kind && tornDayStart(x.stepAt || x.at) === tornDayStart(s.at) && Math.abs((x.stepAt || 0) - s.at) <= 30 * 60 * 1000));
}

/** Drug steps skipped today: the next drug is planned from the cooldown that would have followed. */
export const DRUG_STEP_KINDS = new Set(['xanax', 'stack', 'hold', 'boost', 'jump']);

export function drugNotBefore(skipped, now) {
    const today = (skipped || []).filter((x) => DRUG_STEP_KINDS.has(x.kind) && tornDayStart(x.stepAt || 0) === tornDayStart(now));
    if (!today.length) return 0;
    return Math.max(...today.map((x) => x.stepAt)) + XANAX_CD_MIN * 60 * 1000;
}

export function buildModel({ state, statics = {}, plan, settings, log = [], history = {}, prices = {}, compare = null, whatIf = null, jobWhatIf = null, gymProgress = null, unlockedKnown = null, learnedMult = null, skipped = [], pc: pcIn = null, auto = null, autoSwitch = null, warOn = null, now }) {
    if (!state) return { ready: false };
    // One player context per refresh: the comparison's, when the caller has it.
    const pc = pcIn || playerContext(state, statics, { unlockedKnown, learnedMult });
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
        // Special refills used since the Torn day began (the count at the day's first read, less now).
        specialToday: history && history[tornDayStart(now)] && history[tornDayStart(now)].special !== undefined && state.specialRefills !== null ? Math.max(0, history[tornDayStart(now)].special - state.specialRefills) : 0,
        specialPerDay: Math.ceil(specialLeft(plan, state) / specialDaysLeft(settings.horizonDays || 30, Math.floor((now - (plan.specialSetAt || now)) / DAY))),
        energyBooster: compare && compare.steadyBoost ? compare.steadyBoost.booster : null,
        boostersToday: today.filter((e) => e.kind === 'booster').length,
        candyMult: pc.perks.candyMult || 1,
        canMult: pc.perks.canMult || 1,
        toyShop5: Boolean(pc.perks.toyShop5),
        adultNovelties10: Boolean(pc.perks.adultNovelties10),
    };
    // Items: the plan's candy (picked in the comparison), cooldown cuts, the console, specials held, job points.
    const ic = itemContext(statics, settings);
    const mineR = compare && compare[plan.strategy];
    if (mineR && mineR.candy) {
        ctx.candyId = mineR.candy.id;
        ctx.candyCount = mineR.candy.count;
    }
    ctx.cdMult = pc.perks.consumableCdMult || 1;
    ctx.specialHeld = Math.max(0, Number(state.specialRefills) || 0);
    ctx.consoleOwned = ic.consoleOwned;
    ctx.toyShop5 = ctx.toyShop5 || worksAt(ic.job, 'Toy Shop', 5) || worksAt(ic.job, 'Game Shop', 5);
    ctx.adultNovelties10 = ctx.adultNovelties10 || worksAt(ic.job, 'Adult Novelties', 10);
    if (ic.jobHappy) ctx.jobHappy = ic.jobHappy;
    // Torn events that change training: a heads-up, and no boosters in the day before one that needs the booster cooldown.
    const events = statics.calendar ? upcomingEvents(statics.calendar.calendar, now, { startTime: statics.calendar.startTime }) : [];
    const hold = holdBoosterFor(events, now, plan.strategy);
    if (hold) {
        ctx.holdBooster = hold.id;
        ctx.holdUntil = hold.start;
    }
    ctx.drugNotBefore = drugNotBefore(skipped, now);
    // A faction war on (your faction's wars, read by Torn Eye) and energy kept for it: the day plan trains above it.
    const warKeep = warOn && settings.warReserve > 0 ? Math.min(settings.warReserve, 1000) : 0;
    if (warKeep) ctx.keepEnergy = warKeep;
    // During CaffeineCon / World Diabetes Day the day plan counts the event's cans or candy.
    const em = eventMults(events);
    ctx.canMult = (ctx.canMult || 1) * em.canMult;
    ctx.candyMult = (ctx.candyMult || 1) * em.candyMult;
    const steps = withoutSkipped(dayTimeline({ state, now, strategy: plan.strategy, ctx }), skipped);
    const next = steps[0] || null;
    // Buy: the next boost or jump in full, whatever day it lands (today's steps stop at Torn midnight).
    const kindNow = (STRATEGIES[plan.strategy] || {}).kind;
    const ahead = (kindNow === 'boost' || kindNow === 'jump') && !steps.some((s) => s.kind === 'boost' || s.kind === 'jump') ? withoutSkipped(dayTimeline({ state, now, strategy: plan.strategy, ctx, until: tornDayStart(now) + 3 * DAY }), skipped) : steps;

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
    if (!plan.buildPicked) heads.push({ tone: 'warn', text: 'Pick your build type', sub: 'Plan › Build: the plan trains toward it', go: 'plan' });
    for (const w of strictWarnings(steps, now)) heads.push({ tone: 'warn', text: w.text });
    if (refillFree && msToTornMidnight(now) < REFILL_WARN_MS) heads.push({ tone: 'warn', text: 'Refill unused', sub: 'use before 00:00 Torn time' });
    if (ng && ng.gym) heads.push({ tone: 'plain', text: ng.gym.name + (ng.known ? ' in about ' + Math.max(1, Math.round(ng.days)) + ' days' : ' is next'), sub: 'buy it for $' + (ng.cost >= 1e6 ? ng.cost / 1e6 + 'M' : ng.cost), go: 'progress' });
    for (const e of events.slice(0, 2)) {
        const hu = eventHeadsUp(e, now);
        heads.push({ tone: e.active ? 'good' : 'plain', text: hu.text, sub: hu.sub, event: e.id, go: 'plan' });
    }
    if (warKeep) heads.push({ tone: 'warn', text: 'War: keeping ' + warKeep + ' energy', sub: 'against ' + (warOn.name || 'the enemy faction') + ' · Settings › Keep for war days', go: 'eye' });
    if (hold) heads.push({ tone: 'warn', text: 'Booster cooldown kept free', sub: hold.name + ' starts within a day: your plan’s ' + (hold.id === 'diabetes' ? 'candy' : 'cans and FHC') + ' count ' + (hold.canMult || hold.candyMult || 1) + '× then' });
    let rec = null;
    let ladder = null;
    // Auto without its Full key (or before the income is read) runs as "most stats in my budget".
    const pickBy = effectivePickBy(PICK_BY[plan.pickBy] ? plan.pickBy : 'most', auto);
    const goalKind = plan.goal && plan.goal.kind === 'unlockGym' ? 'unlock' : null;
    if (auto && auto.needsKey) heads.unshift({ tone: 'warn', text: 'Auto mode needs a Full key', sub: 'Settings › Full key · until then the plan uses your budget', go: 'settings' });
    const sw = eventSwitchHeads(autoSwitch, now);
    if (sw) heads.push({ ...sw, go: 'plan' });
    if (compare) {
        const r = recommend(compare, { budget: budgetOf(settings), bliss: pc.perks.bliss, pickBy, goal: goalKind });
        rec = r;
        const mine = compare[plan.strategy];
        // Auto switched for an event: the usual comparison has no event in it, so it doesn't argue with the switch.
        const eventOn = autoSwitch && autoSwitch.active && autoSwitch.id === plan.strategy;
        if (eventOn) heads.push({ tone: 'good', text: (STRATEGIES[plan.strategy] || {}).name + ' for ' + autoSwitch.event.name });
        else if (r.recommended === plan.strategy) heads.push({ tone: 'good', text: (STRATEGIES[plan.strategy] || {}).name + ' is still best' });
        else if (mine) {
            const w = pickWarning(compare[r.recommended], mine, { bliss: pc.perks.bliss, days: settings.horizonDays || 30 });
            if (w.warn) heads.push({ tone: 'warn', text: (STRATEGIES[r.recommended] || {}).name + ' would gain more', sub: 'see Plan', go: 'plan' });
        }
        ladder = energyLadder({ state, pc, shares, prices, compare, recommended: r.recommended, days: settings.horizonDays || 30, budget: budgetOf(settings), specialHave: state.specialRefills || 0, specialUse: specialLeft(plan, state) });
    }
    // Spend per day, and how long the cash on hand lasts at the recommended plan's pace.
    const horizon = settings.horizonDays || 30;
    const recRow = rec && compare ? compare[rec.recommended] : null;
    const cash = statics.inventory && Number.isFinite(statics.inventory.cash) ? statics.inventory.cash : null;
    const spend = recRow ? { perDay: recRow.cost / horizon, budgetPerDay: Number.isFinite(settings.budget) ? settings.budget / horizon : null, cash, lastsDays: cash !== null && recRow.cost > 0 ? cash / (recRow.cost / horizon) : null } : null;
    // Unlock goal: when the gym opens on each plan (energy through the gym), and what it costs in stats against the best plan.
    let unlock = null;
    if (goalKind && compare) {
        const gym = gymById(plan.goal.gymId, pc.table);
        const left = unlockEnergyLeft(pc.unlocked, plan.goal.gymId, gymProgress, pc.perks.gymExpMult);
        if (gym && left !== null) {
            const most = Object.values(compare).filter(Boolean).reduce((a, b) => (b.gained > a.gained ? b : a), { gained: 0 });
            const rows = {};
            for (const [id, r] of Object.entries(compare)) if (r) rows[id] = { days: unlockDays(r, left, horizon), statsPct: most.gained > 0 ? (100 * (r.gained - most.gained)) / most.gained : 0 };
            unlock = { gym, energyLeft: left, rows, best: most.id || null };
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
        ahead,
        next,
        done: today,
        strip,
        statRows,
        total: totalOf(pc.stats),
        gainedToday,
        plannedGain,
        reachedDay: proj.reachedDay,
        projection: proj.days.slice(0, 7),
        buildCatchUp: proj.catchUp || null,
        nextGym: ng,
        energyPerDay,
        buyToday,
        heads,
        buildPicked: Boolean(plan.buildPicked),
        recommendation: rec,
        compare,
        whatIf,
        // Company what-ifs that still beat the recommended plan (the runtime works them out with the comparison).
        jobWhatIf: rec && compare && compare[rec.recommended] ? (jobWhatIf || []).filter((w) => w && w.result && w.result.gained > compare[rec.recommended].gained) : [],
        job: ic.job,
        consoleOwned: ic.consoleOwned,
        ladder,
        spend,
        events,
        pickBy,
        keepEnergy: warKeep,
        auto: auto ? { ...auto, afford: affordLine(auto, recRow ? recRow.cost / horizon : 0), wait: autoWaitLine(auto), switch: autoSwitch } : null,
        unlock,
        // held: while any are held the daily refill is a special (Torn blocks the points refill until they're spent [verify]).
        special: { have: state.specialRefills, left: specialLeft(plan, state), use: plan.specialUse || 0, held: ctx.specialHeld },
        prices,
    };
}

