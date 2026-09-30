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
import { energyAt, happyAt, drugFreeAt, boosterFreeAt, refillAvailable, tornDayStart, msToTornMidnight, DAY, countdown, tornClock } from './bars.js';
import { dayTimeline, targetShares, drugsToday, itemsNeeded, strictWarnings, REFILL_WARN_MS } from './plan.js';
import { simulateStrategy, feasibleStrategies, STRATEGIES, CANDY_PLANS, consoleBlocked } from './strategies.js';
import { recommend, pickWarning } from './recommend.js';
import { needList, livePrices, marketPricesFrom, npcPricesFrom, shopsAllowed, allowanceLeft } from './market.js';
import { bestCandy } from './candy.js';
import { companyJob, jobHappyOf, freeEdvdPerDayOf, worksAt, VOYEUR_JP, JOB_LOCK_H } from './jobs.js';
import { energyLadder, boosterChoice, priceFor } from './ladder.js';
import { upcomingEvents, holdBoosterFor, eventHeadsUp, eventMults } from './events.js';
import { PICK_BY } from './recommend.js';
import { XANAX, SAMPLE_PRICES, ITEMS, XANAX_CD_MIN, GAME_CONSOLE, POINTS } from './items.js';
import { xanaxCdOf } from './drugcd.js';
import { realGains } from './gains.js';
import { HAPPY_CAP } from './gain.js';
import { JUMP_STACK } from './strategies.js';
import { budgetOf, effectivePickBy, affordLine, autoWaitLine, unlockDays, unlockEnergyLeft } from './auto.js';

/*
 * The 30-day build projection is the heavy part of a model (thousands of
 * simulated trains) and only changes when the stats, build or gyms do, so
 * the last one is kept.
 */
const projectionMemo = { key: '', value: null };

/** How far the look-ahead runs (Home's "Next 48 h" and the bot). */
export const LOOK_AHEAD_MS = 48 * 3600e3;

/** "14:15", "tomorrow 06:15" or "Thu 06:15" (Torn time). */
export function whenWords(at, now) {
    const days = Math.round((tornDayStart(at) - tornDayStart(now)) / DAY);
    const day = days <= 0 ? '' : days === 1 ? 'tomorrow ' : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][new Date(at).getUTCDay()] + ' ';
    return day + tornClock(at);
}

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
 * @param {object} settings - {npcShops: city shops ticked, npcShopsOff: default shops switched off}
 * @param {number} [now] - for today's city-shop allowance (a read from an earlier Torn day leaves all 100)
 */
export function itemContext(statics = {}, settings = {}, now = null) {
    const info = (statics && statics.items) || {};
    const inv = (statics && statics.inventory) || {};
    const cj = companyJob(statics && statics.job, statics && statics.jobPoints);
    return {
        // Torn's own market price: a candy's price until its listings load (never over a live listing).
        marketPrices: marketPricesFrom(info),
        // City shops: Sally's by default (the tick switches it off), and today's allowance left of 100 items.
        npc: npcPricesFrom(info, shopsAllowed(settings)),
        cityLeft: allowanceLeft(statics && statics.cityShop, now !== null ? now : (statics && statics.cityShop && statics.cityShop.at) || 0),
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
        // The booster cooldown running now: the first boosts wait for it (a full candy load takes 24.5 h).
        boosterCdMin: Math.max(0, Number(state.boosterCd) || 0) / 60,
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
        // Boosters you hold go first and cost nothing new (candy and energy drinks as a pool).
        held: heldBoosters(statics.inventory),
        // Later Xanax at your own median cooldown once a few are recorded (else 7 h).
        xanaxCdMin: xanaxCdOf(statics.xanaxCds).min,
        // Today's candy pick, kept unless another is clearly cheaper.
        candyPrefer: statics.candyPick && statics.candyPick.day === tornDayStart(state.at) ? statics.candyPick.id : null,
    };
}

/** The boosters in the inventory (candy, energy drinks, EDVD, FHC): {[id]: qty}. */
export function heldBoosters(inventory) {
    const out = {};
    for (const [k, v] of Object.entries(inventory || {})) if (ITEMS[k] && ITEMS[k].kind === 'booster' && Number(v) > 0) out[k] = Math.floor(Number(v));
    return out;
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
    const pick = bestCandy({ prices: base.prices, npc: base.npc, capH: base.boosterCapH, cdCuts: base.cdMult, happyMult: base.candyMult, budget, pickBy, evaluate, prefer: base.candyPrefer });
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
export function compareStrategies(args) {
    const steps = compareSteps(args);
    let r = steps.next();
    while (!r.done) r = steps.next();
    return r.value;
}

/**
 * The same comparison in slices, one plan at a time with a break for the
 * page in between (a comparison is 60+ thirty-day runs: in one go it froze
 * the page for a few hundred ms after a click, e.g. ticking a city shop).
 */
export async function compareStrategiesAsync(args, { pause = () => new Promise((r) => setTimeout(r, 0)) } = {}) {
    const steps = compareSteps(args);
    let r = steps.next();
    while (!r.done) {
        await pause();
        r = steps.next();
    }
    return r.value;
}

/** The comparison, yielding after each plan (see compareStrategies / compareStrategiesAsync). */
function* compareSteps({ state, pc, shares, settings, prices, special = 0, statics = {}, pickBy = 'most' }) {
    const base = simInputs({ state, pc, shares, settings, prices, special, statics });
    const results = {};
    const budget = budgetOf(settings);
    for (const id of feasibleStrategies({ bliss: pc.perks.bliss, boosterCapH: base.boosterCapH, toyShop5: base.toyShop5, adultNovelties10: base.adultNovelties10 })) {
        yield id;
        if (id === 'consoleJump' || id === 'consoleJumpToy') {
            // Low-stat players only: over 250k in a stat it trains, it's shown (behind the tick) and never picked.
            const probe = simulateStrategy(id, { ...base, special: 0 });
            const blocked = consoleBlocked(pc.stats, probe.perStat);
            if (blocked) {
                results[id] = { ...probe, blocked };
                continue;
            }
        }
        results[id] = withBestRefill(id, base, { budget, pickBy }, (b) => (CANDY_PLANS.has(id) ? withBestCandy(id, b, { budget, pickBy }).result : withBestSpecial(id, b)));
    }
    if (results.steady && Number.isFinite(budget)) {
        const choice = boosterChoice({ perDay: (budget - results.steady.cost) / base.days, maxE: base.energyMax, prices: base.prices, canMult: base.canMult, capH: base.boosterCapH });
        // Only a real middle rung: fewer than steadyMax's FHC every time.
        if (choice && !(choice.id === steadyMaxItem() && results.steadyMax && choice.perDay >= boostersPerDayMax(base))) {
            yield 'steadyBoost';
            results.steadyBoost = { ...withBestSpecial('steadyBoost', { ...base, energyBooster: { id: choice.id, perDay: choice.perDay } }), booster: choice };
        }
    }
    return results;
}

/**
 * Is the daily points refill worth its price (owner, 2026-09-29)? The plan
 * is run without it too, and the refill is kept only when the Plan rule
 * says so: inside the budget it's kept (more stats), unless it's what puts
 * the plan over the budget; for "best value" it's kept only if it doesn't
 * lower the stats per $1M. The result says which (`refill`, `refillGain`,
 * `refillCost`), and the day plan follows it.
 */
export function withBestRefill(id, base, { budget = Infinity, pickBy = 'most' } = {}, run) {
    const withIt = run(base);
    // Nothing to decide: no points bought for refills in this plan (special refills stand in), or no limit and "most".
    if (!(withIt.used && withIt.used[POINTS] > 0)) return withIt;
    const limit = pickBy === 'max' ? Infinity : budget;
    if (pickBy !== 'value' && withIt.cost <= limit) return { ...withIt, refill: true };
    const without = run({ ...base, noRefill: true });
    const gain = withIt.gained - without.gained;
    const cost = withIt.cost - without.cost;
    const per = (r) => (r.cost > 0 ? r.gained / r.cost : Infinity);
    const keep = pickBy === 'value' ? per(withIt) >= per(without) && withIt.cost <= limit : withIt.cost <= limit || without.cost > limit;
    return keep ? { ...withIt, refill: true, refillGain: gain, refillCost: cost } : { ...without, refill: false, refillGain: gain, refillCost: cost };
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

/** The steady plan's cost a day (Auto's income adds it back while receipts cover under 3 days: it never depends on the budget). */
export function steadyCostPerDay(args) {
    const base = simInputs(args);
    return simulateStrategy('steady', base).cost / base.days;
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

export function drugNotBefore(skipped, now, cdMin = XANAX_CD_MIN) {
    const today = (skipped || []).filter((x) => DRUG_STEP_KINDS.has(x.kind) && tornDayStart(x.stepAt || 0) === tornDayStart(now));
    if (!today.length) return 0;
    return Math.max(...today.map((x) => x.stepAt)) + cdMin * 60 * 1000;
}

/**
 * Round 6: the numbers come from the saved plan (`compare`: every plan's result, or on Torn's pages the small part;
 * `rec`: its recommendation; `warn`: plans whose pick warns). `lite` (Torn's pages): only what those pages show is
 * worked out (today's steps, the 48 h look-ahead, the strip, the gym page's next two days); no ladder, no 30-day
 * projection. `saved`: where the saved plan stands (null: no plan yet).
 */
export function buildModel({ state, statics = {}, plan, settings, log = [], history = {}, prices = {}, compare = null, rec: recIn = null, warn = null, lite = false, saved = null, whatIf = null, jobWhatIf = null, gymProgress = null, unlockedKnown = null, learnedMult = null, skipped = [], pc: pcIn = null, auto = null, warOn = null, now }) {
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
        // The comparison found the points refill not worth it in this plan: the day plan leaves it out.
        noRefill: Boolean(compare && compare[plan.strategy] && compare[plan.strategy].refill === false),
        toyShop5: Boolean(pc.perks.toyShop5),
        adultNovelties10: Boolean(pc.perks.adultNovelties10),
    };
    // Later Xanax at your own median cooldown (recorded from your real ones) once there are a few.
    const xcd = xanaxCdOf(statics.xanaxCds);
    ctx.xanaxCdMin = xcd.min;
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
    // Boosters you hold go first (owner: "it should exhaust my inventory first").
    ctx.held = heldBoosters(statics.inventory);
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
    ctx.drugNotBefore = drugNotBefore(skipped, now, xcd.min);
    // A faction war on (your faction's wars, read by Torn Eye) and energy kept for it: the day plan trains above it.
    const warKeep = warOn && settings.warReserve > 0 ? Math.min(settings.warReserve, 1000) : 0;
    if (warKeep) ctx.keepEnergy = warKeep;
    // During CaffeineCon / World Diabetes Day the day plan counts the event's cans or candy.
    const em = eventMults(events);
    ctx.canMult = (ctx.canMult || 1) * em.canMult;
    ctx.candyMult = (ctx.candyMult || 1) * em.candyMult;
    const steps = withoutSkipped(dayTimeline({ state, now, strategy: plan.strategy, ctx }), skipped);
    const next = steps[0] || null;
    // The next 48 hours (owner: "plan everything ahead for me, when not to take xanax, when to take candy, when not
    // to take boosters"): the same plan with the days rolling on, for Home's "Next 48 h" and the bot.
    const lookAhead = withoutSkipped(dayTimeline({ state, now, strategy: plan.strategy, ctx, until: now + LOOK_AHEAD_MS }), skipped);
    // Buy: the next boost or jump in full, whatever day it lands (today's steps stop at Torn midnight).
    const kindNow = (STRATEGIES[plan.strategy] || {}).kind;
    const boostStep = (s) => s.kind === 'boost' || s.kind === 'jump';
    const ahead = (kindNow === 'boost' || kindNow === 'jump') && !steps.some(boostStep) ? (lookAhead.some(boostStep) ? lookAhead : withoutSkipped(dayTimeline({ state, now, strategy: plan.strategy, ctx, until: tornDayStart(now) + 3 * DAY }), skipped)) : steps;
    // Past today's steps: what the look-ahead adds (Home's "Next 48 h"); `upcoming` is both, for the bot.
    const lastToday = steps.length ? Math.max(...steps.map((x) => x.at)) : now;
    const later = lookAhead.filter((x) => x.at > lastToday && x.at >= tornDayStart(now) + DAY);
    const upcoming = steps.concat(later);
    // The next step that uses a booster (candy, EDVD, FHC, cans), today or in the look-ahead.
    const usesBooster = (s) => (s.items || []).some((it) => ITEMS[it.id] && ITEMS[it.id].kind === 'booster' && it.qty > 0);
    const nextBoost = lookAhead.find(usesBooster) || ahead.find(usesBooster) || null;

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
        // The cooldown left, when it's back under the cap (a booster can be used again), and the plan's next booster step.
        booster: { left: boosterLeft, capH: ctx.boosterCapH, underCapIn: Math.max(0, boosterLeft - ctx.boosterCapH * 3600e3), used: steps.some(usesBooster), next: nextBoost ? { at: nextBoost.at, label: nextBoost.label, kind: nextBoost.kind } : null },
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
    // What Torn's stats really rose: today, 7 and 30 days (today from the day log until a day's opening read exists).
    const gains = realGains(history, pc.stats, now);
    if (!gains.today) gains.today = { total: Math.round(STATS.reduce((a, k) => a + (trainedToday[k] || 0), 0)), perStat: { ...trainedToday }, since: tornDayStart(now), days: 1, fromLog: true };
    const plannedGain = gainedToday + steps.filter((s) => s.at < tornDayStart(now) + DAY).reduce((a, s) => a + (s.gain || 0), 0);

    // Build ETA and next gym
    const energyPerDay = Math.round(((e.interval <= 600 ? 720 : 480) + 250 * Math.floor(1440 / 420) + e.maximum) / 10) * 10;
    // With Ignorance Is Bliss happy doesn't fall back to the maximum: the projection trains at today's happy.
    const projHappy = pc.perks.bliss ? Math.min(HAPPY_CAP, Math.max(state.happy.current, state.happy.maximum) + 300) : state.happy.maximum + 300;
    const proj = projectionFor({ stats: pc.stats, shares, energyPerDay, happy: projHappy, unlocked: pc.unlocked, perks: pc.perks.mult, keep, days: lite ? 2 : 30, active: state.gymId, table: pc.table });
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
    if (refillFree && msToTornMidnight(now) < REFILL_WARN_MS && !ctx.noRefill) heads.push({ tone: 'warn', text: 'Refill unused', sub: 'use before 00:00 Torn time' });
    if (ctx.noRefill) {
        const r = compare[plan.strategy];
        heads.push({ tone: 'plain', text: 'Daily refill left out', sub: 'not worth its price in your plan' + (r && r.refillGain > 0 ? ' (+' + Math.round(r.refillGain).toLocaleString('en-US') + ' stats for $' + Math.round(r.refillCost / 1e6) + 'M over the plan)' : ''), go: 'plan' });
    }
    if (ng && ng.gym) heads.push({ tone: 'plain', text: ng.gym.name + (ng.known ? ' in about ' + Math.max(1, Math.round(ng.days)) + ' days' : ' is next'), sub: 'buy it for $' + (ng.cost >= 1e6 ? ng.cost / 1e6 + 'M' : ng.cost), go: 'progress' });
    for (const e of events.slice(0, 2)) {
        const hu = eventHeadsUp(e, now);
        heads.push({ tone: e.active ? 'good' : 'plain', text: hu.text, sub: hu.sub, event: e.id, go: 'plan' });
    }
    if (warKeep) heads.push({ tone: 'warn', text: 'War: keeping ' + warKeep + ' energy', sub: 'against ' + (warOn.name || 'the enemy faction') + ' · Settings › Keep for war days', go: 'eye' });
    // A candy plan with no candy today (the booster cooldown is full): say so, and when the next boost is.
    const candyPlan = CANDY_PLANS.has(plan.strategy);
    const todayEnd = tornDayStart(now) + DAY;
    if (candyPlan && !hold && !steps.some((s) => s.at < todayEnd && usesBooster(s)) && boosterLeft > 0) {
        heads.push({ tone: 'warn', text: 'No candy today · booster cooldown ' + countdown(boosterLeft), sub: nextBoost ? 'next candy boost ' + whenWords(nextBoost.at, now) + ' TCT' : 'the plan trains as steady until it has room', go: null });
    } else if (nextBoost && nextBoost.at - now > 30 * 60e3 && (boostStep(nextBoost) || candyPlan)) {
        heads.push({ tone: 'plain', text: 'No boosters before ' + whenWords(nextBoost.at, now) + ' TCT', sub: 'the ' + (nextBoost.kind === 'jump' ? 'jump' : 'candy boost') + ' then needs room under the ' + ctx.boosterCapH + ' h booster cap' });
    }
    if (hold) heads.push({ tone: 'warn', text: 'Booster cooldown kept free', sub: hold.name + ' starts within a day: your plan’s ' + (hold.id === 'diabetes' ? 'candy' : 'cans and FHC') + ' count ' + (hold.canMult || hold.candyMult || 1) + '× then' });
    let rec = null;
    let ladder = null;
    // Auto without its Full key (or before the income is read) runs as "most stats in my budget".
    const pickBy = effectivePickBy(PICK_BY[plan.pickBy] ? plan.pickBy : 'most', auto);
    const goalKind = plan.goal && plan.goal.kind === 'unlockGym' ? 'unlock' : null;
    if (auto && auto.needsKey) heads.unshift({ tone: 'warn', text: 'Auto mode needs a Full key', sub: 'Settings › Full key · until then a new plan uses your budget', go: 'settings' });
    // No saved plan yet (a new install, or plans from before round 6): today's steps follow the plan picked (steady by
    // default) until you create one. Nothing is worked out in the background.
    if (!saved && !compare) heads.unshift({ tone: 'warn', text: 'Create your plan', sub: 'Plan › Create plan · until then the steps follow ' + ((STRATEGIES[plan.strategy] || STRATEGIES.steady).name || 'steady training').toLowerCase(), go: 'plan' });
    if (saved && saved.progress && saved.progress.ended) heads.unshift({ tone: 'warn', text: 'Your plan has ended', sub: 'Plan › Create plan for the next one', go: 'plan' });
    if (compare) {
        const r = recIn || recommend(compare, { budget: budgetOf(settings), bliss: pc.perks.bliss, pickBy, goal: goalKind });
        rec = r;
        const mine = compare[plan.strategy];
        if (r.recommended === plan.strategy) heads.push({ tone: 'good', text: (STRATEGIES[plan.strategy] || {}).name + ' is your plan' });
        else if (mine && r.recommended && compare[r.recommended]) {
            const w = warn ? { warn: Boolean(warn[plan.strategy]) } : pickWarning(compare[r.recommended], mine, { bliss: pc.perks.bliss, days: settings.horizonDays || 30 });
            if (w.warn) heads.push({ tone: 'warn', text: (STRATEGIES[r.recommended] || {}).name + ' would gain more', sub: 'see Plan', go: 'plan' });
        }
        if (!lite && r.recommended && compare[r.recommended]) ladder = energyLadder({ state, pc, shares, prices, compare, recommended: r.recommended, days: settings.horizonDays || 30, budget: budgetOf(settings), specialHave: state.specialRefills || 0, specialUse: specialLeft(plan, state) });
    }
    // Spend per day, and how long the cash on hand lasts at the recommended plan's pace.
    const horizon = settings.horizonDays || 30;
    const recRow = rec && compare ? compare[rec.recommended] : null;
    const cash = statics.inventory && Number.isFinite(statics.inventory.cash) ? statics.inventory.cash : null;
    const spend = recRow ? { perDay: recRow.cost / horizon, budgetPerDay: Number.isFinite(settings.budget) ? settings.budget / horizon : null, cash, lastsDays: cash !== null && recRow.cost > 0 ? cash / (recRow.cost / horizon) : null } : null;
    // Unlock goal: when the gym opens on each plan (energy through the gym), and what it costs in stats against the best plan.
    let unlock = null;
    if (goalKind && compare && !lite) {
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
        lookAhead,
        later,
        upcoming,
        next,
        done: today,
        strip,
        statRows,
        total: totalOf(pc.stats),
        gainedToday,
        gains,
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
        noRefill: Boolean(ctx.noRefill),
        auto: auto ? { ...auto, afford: affordLine(auto, recRow ? recRow.cost / horizon : 0), wait: autoWaitLine(auto) } : null,
        // The saved plan: its dates and where it stands (null: no plan yet), and the days its numbers cover.
        saved,
        planDays: horizon,
        unlock,
        // Your Xanax cooldown (median of the ones recorded, the range) and when the Torn day resets.
        xanaxCd: xcd,
        dayResetAt: tornDayStart(now) + DAY,
        // held: while any are held the daily refill is a special (Torn blocks the points refill until they're spent [verify]).
        special: { have: state.specialRefills, left: specialLeft(plan, state), use: plan.specialUse || 0, held: ctx.specialHeld },
        prices,
    };
}

