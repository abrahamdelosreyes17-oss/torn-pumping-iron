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
import { energyAt, happyAt, drugFreeAt, boosterFreeAt, refillAvailable, tornDayStart, msToTornMidnight, DAY, countdown, tornClock, awayOf } from './bars.js';
import { dayTimeline, targetShares, drugsToday, itemsNeeded, strictWarnings, REFILL_WARN_MS } from './plan.js';
import { simulateStrategy, simulateSteps, SIM_SLICE_DAYS, feasibleStrategies, STRATEGIES, CANDY_PLANS, consoleBlocked } from './strategies.js';
import { recommend, pickWarning, opensOnDay } from './recommend.js';
import { needList, livePrices, marketPricesFrom, npcPricesFrom, shopsAllowed, allowanceLeft } from './market.js';
import { bestCandy } from './candy.js';
import { companyJob, jobHappyOf, freeEdvdPerDayOf, worksAt, VOYEUR_JP, JOB_LOCK_H } from './jobs.js';
import { energyLadder, boosterChoice, priceFor } from './ladder.js';
import { upcomingEvents, holdBoosterFor, eventHeadsUp, eventMults } from './events.js';
import { PICK_BY } from './recommend.js';
import { XANAX, ECSTASY, SAMPLE_PRICES, ITEMS, XANAX_CD_MIN, GAME_CONSOLE, POINTS } from './items.js';
import { xanaxCdOf } from './drugcd.js';
import { realGains } from './gains.js';
import { rehabParams } from './rehab.js';
import { HAPPY_CAP } from './gain.js';
import { JUMP_STACK, CONSOLE_STACK, stackRoom } from './strategies.js';
import { budgetOf, effectivePickBy, affordLine, autoWaitLine, unlockDays, unlockEnergyLeft } from './auto.js';
import { makePause, runSliced } from './slices.js';

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
    return e.kind === 'xanax' || e.kind === 'stack' || e.kind === 'hold' || e.xanax === true || (e.kind === 'catchup' && e.drug);
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
    // Happy lost per energy as your own gym log measured it (R6.6), on top of the perks'.
    if (Number(extra.learnedHappyLoss) > 0) perks.happyLossMult = (perks.happyLossMult || 1) * Number(extra.learnedHappyLoss);
    const unlocked = unlockedGyms(state && state.gymId, extra.unlockedKnown || null);
    const stats = (state && state.stats) || { str: 0, spd: 0, def: 0, dex: 0 };
    const best = {};
    for (const k of STATS) best[k] = bestGymFor(k, stats, unlocked, { table, drugsTaken: extra.drugsTaken ?? null, active: state && state.gymId });
    return { table, perks, unlocked, stats, best };
}

/**
 * The gym to unlock (Plan › Train toward › Unlock): its id and name, and with
 * an "open it by" date the day of the run it must open by. Null once the gym
 * is open (the goal has nothing left to do). Round 7: it never outranks stats.
 * @param {number} from - the run's first day (ms)
 * @param {number} days - the run's days
 */
export function openByOf(plan, pc, from, days) {
    const g = plan && plan.goal && plan.goal.kind === 'unlockGym' ? plan.goal : null;
    if (!g || !pc || (pc.unlocked || []).map(Number).includes(Number(g.gymId))) return null;
    const gym = gymById(g.gymId, pc.table);
    const by = Number(g.by) > 0 ? Number(g.by) : null;
    return { gymId: Number(g.gymId), name: gym ? gym.name : null, by, days: by ? Math.ceil((by - from) / DAY) : null, horizon: days };
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

/**
 * The simulation inputs every strategy shares. `live` (round 7; Create plan and Recalibrate): the run starts from the
 * bars as they are (energy, happy, the drug cooldown, today's refill used), like the day plan does; without it, from
 * a full bar with no cooldown (a stretch that starts later, a what-if over past days).
 */
export function simInputs({ state, pc, shares, settings, prices, special = 0, statics = {}, events = null, unlock = null, live = false, feesApart = false }) {
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
        // Special refills held: the daily refill uses them while any are left (the points refill waits: Torn uses the free ones first).
        specialHeld: Math.max(0, Number(state.specialRefills) || 0),
        canMult: pc.perks.canMult || 1,
        candyMult: pc.perks.candyMult || 1,
        cdMult: pc.perks.consumableCdMult || 1,
        toyShop5: Boolean(pc.perks.toyShop5) || worksAt(ic.job, 'Toy Shop', 5) || worksAt(ic.job, 'Game Shop', 5),
        adultNovelties10: Boolean(pc.perks.adultNovelties10) || worksAt(ic.job, 'Adult Novelties', 10),
        consoleOwned: ic.consoleOwned,
        jobHappy: ic.jobHappy,
        freeEdvdPerDay: ic.freeEdvdPerDay,
        // Boosters, Xanax and Ecstasy you hold go first and cost nothing new (candy and energy drinks as a pool).
        held: heldBoosters(statics.inventory),
        // Rehab and overdoses in every plan's cost (round 8): the faction's cuts from your perks, a session's size
        // from your lifetime rehabs (a new player's until they are read).
        rehab: rehabParams({ perks: statics.perks, drugs: statics.drugs }),
        // Later Xanax at your own median cooldown once a few are recorded (else 7 h).
        xanaxCdMin: xanaxCdOf(statics.xanaxCds).min,
        // Today's candy pick, kept unless another is clearly cheaper.
        candyPrefer: statics.candyPick && statics.candyPick.day === tornDayStart(state.at) ? statics.candyPick.id : null,
        // With them, the minute of the Torn day it is (the refill and the other once-a-day counts go by Torn's day).
        ...(live ? { start: { energy: state.energy.current, happy: state.happy.current, drugCdMin: Math.max(0, Number(state.drugCd) || 0) / 60, refillUsed: state.refillUsed === true }, dayMin: Math.floor((state.at - tornDayStart(state.at)) / 60000) } : {}),
        // Year plans (core/year.js): events on their dates, gyms opening as energy is trained.
        ...(events ? { events } : {}),
        ...(unlock ? { unlock } : {}),
        // A stretch of a path under a budget: a gym's fee is paid out of the money kept back for it, not the stretch's own.
        ...(feesApart ? { feesApart: true } : {}),
    };
}

/**
 * What a plan uses first out of the inventory, free: the boosters (candy, energy drinks, EDVD, FHC) and, from
 * session 10, the Xanax and Ecstasy (the owner: "I have Xanax in my inventory and it's not making me use my Xanax").
 * @returns {{[id]: qty}}
 */
export function heldBoosters(inventory) {
    const out = {};
    for (const [k, v] of Object.entries(inventory || {})) {
        const it = ITEMS[k];
        if (it && (it.kind === 'booster' || Number(k) === XANAX || Number(k) === ECSTASY) && Number(v) > 0) out[k] = Math.floor(Number(v));
    }
    return out;
}

/**
 * The candy a plan uses, picked by the Plan's rule: every candy with a known
 * price is run through the plan (the dominated ones skipped), and the one
 * with the most stats in the budget (or per $1M, or no budget) wins.
 * @returns {{result:object, candy:object|null}}
 */
function* withBestCandySteps(id, base, { budget = Infinity, pickBy = 'most' } = {}) {
    const ask = { prices: base.prices, npc: base.npc, capH: base.boosterCapH, cdCuts: base.cdMult, happyMult: base.candyMult, budget, pickBy, prefer: base.candyPrefer };
    // Which candy the pick will weigh (it asks about every candidate, whatever the answers), each run in slices.
    const asked = [];
    bestCandy({ ...ask, evaluate: (cid, n) => (asked.push([cid, n]), { gained: 0, cost: 0 }) });
    const runs = {};
    for (const [cid, n] of asked) if (!runs[cid]) runs[cid] = yield* simSliced(id, { ...base, special: 0, candyId: cid, candyCount: n });
    const pick = bestCandy({ ...ask, evaluate: (cid) => runs[cid] });
    if (!pick) return { result: yield* withBestSpecialSteps(id, base), candy: null };
    const input = { ...base, candyId: pick.id, candyCount: pick.count };
    const result = base.special > 0 ? yield* withBestSpecialSteps(id, input) : runs[pick.id];
    const candy = { id: pick.id, count: pick.count, unit: pick.unit, source: pick.source, shop: pick.shop, perBoost: pick.perBoost, options: pick.options.length };
    return { result: { ...result, candy }, candy };
}

/**
 * One simulator run in slices (round 7, R7.3b): it yields every SIM_SLICE_DAYS simulated days, so whoever drives
 * the work can give the page a break. The result is the same as simulateStrategy's.
 */
function* simSliced(id, o) {
    return yield* simulateSteps(id, { ...o, sliceDays: SIM_SLICE_DAYS });
}

/** Run a generator of work to its end in one go (no breaks). */
function drainSteps(gen) {
    let r = gen.next();
    while (!r.done) r = gen.next();
    return r.value;
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
export async function compareStrategiesAsync(args, { pause = null } = {}) {
    // Without a pause of the caller's: a break that is not a timer (core/slices.js), let go at the end.
    const own = pause ? null : makePause();
    try {
        return await runSliced(compareSteps(args), pause || own);
    } finally {
        if (own) own.stop();
    }
}

/**
 * The comparison as a generator: it yields the id of each plan as it starts on it (progress), and a number every few
 * simulated weeks inside a run (a chance for a break: see compareStrategies / compareStrategiesAsync, core/slices.js).
 */
export function* compareSteps({ state, pc, shares, settings, prices, special = 0, statics = {}, pickBy = 'most', events = null, unlock = null, live = false, feesApart = false }) {
    const base = simInputs({ state, pc, shares, settings, prices, special, statics, events, unlock, live, feesApart });
    const results = {};
    const budget = budgetOf(settings);
    for (const id of feasibleStrategies({ bliss: pc.perks.bliss, boosterCapH: base.boosterCapH, toyShop5: base.toyShop5, adultNovelties10: base.adultNovelties10 })) {
        yield id;
        if (id === 'consoleJump' || id === 'consoleJumpToy') {
            // Low-stat players only: over 250k in a stat it trains, it's shown (behind the tick) and never picked.
            const probe = yield* simSliced(id, { ...base, special: 0 });
            const blocked = consoleBlocked(pc.stats, probe.perStat);
            if (blocked) {
                results[id] = { ...probe, blocked };
                continue;
            }
        }
        results[id] = yield* withBestRefillSteps(id, base, { budget, pickBy }, function* (b) {
            return CANDY_PLANS.has(id) ? (yield* withBestCandySteps(id, b, { budget, pickBy })).result : yield* withBestSpecialSteps(id, b);
        });
    }
    if (results.steady && Number.isFinite(budget)) {
        const choice = boosterChoice({ perDay: (budget - results.steady.cost) / base.days, maxE: base.energyMax, prices: base.prices, canMult: base.canMult, capH: base.boosterCapH });
        // Only a real middle rung: fewer than steadyMax's FHC every time.
        if (choice && !(choice.id === steadyMaxItem() && results.steadyMax && choice.perDay >= boostersPerDayMax(base))) {
            yield 'steadyBoost';
            results.steadyBoost = { ...(yield* withBestSpecialSteps('steadyBoost', { ...base, energyBooster: { id: choice.id, perDay: choice.perDay } })), booster: choice };
        }
    }
    // Round 7 (A.4): steady costs more than the budget. Steady with as many Xanax a day as the money covers (3, 2, 1
    // or none) and the refill only when it fits: more Xanax is more stats, so the first that fits is the one.
    const limit = pickBy === 'max' ? Infinity : budget;
    if (results.steady && Number.isFinite(limit) && results.steady.cost > limit) {
        yield 'steadyLite';
        let lite = null;
        for (const n of [3, 2, 1, 0]) {
            const r = yield* withBestRefillSteps('steadyLite', { ...base, xanaxPerDay: n }, { budget, pickBy }, (b) => withBestSpecialSteps('steadyLite', b));
            lite = { ...r, xanaxPerDay: n };
            if (r.cost <= limit) break;
        }
        results.steadyLite = lite;
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
export function withBestRefill(id, base, opts = {}, run) {
    // eslint-disable-next-line require-yield
    return drainSteps(withBestRefillSteps(id, base, opts, function* (b) {
        return run(b);
    }));
}

/** withBestRefill in slices: `run` is a generator (a plan's run, yielding for breaks). */
function* withBestRefillSteps(id, base, { budget = Infinity, pickBy = 'most' } = {}, run) {
    const withIt = yield* run(base);
    // Nothing to decide: no points bought for refills in this plan (special refills stand in), or no limit and "most".
    if (!(withIt.used && withIt.used[POINTS] > 0)) return withIt;
    const limit = pickBy === 'max' ? Infinity : budget;
    if (pickBy !== 'value' && withIt.cost <= limit) return { ...withIt, refill: true };
    const without = yield* run({ ...base, noRefill: true });
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
function* withBestSpecialSteps(id, base) {
    const r = yield* simSliced(id, base);
    if (!(base.special > 0)) return r;
    const without = yield* simSliced(id, { ...base, special: 0 });
    return without.gained > r.gained ? { ...without, specialHelps: false } : { ...r, specialHelps: true, specialGain: r.gained - without.gained };
}

/** How many of the gyms a plan opens are weighed (the nearest ones: each is a run of the whole plan). */
export const GYM_WORTH_MAX = 3;

/**
 * Is a gym worth opening (round 7, the friend's question)? For the first
 * gyms a plan opens in its days, the plan is run again with the ladder
 * stopping just before each: the difference is what that gym adds by the
 * plan's end, against its fee. The plan keeps its own candy, booster,
 * refill and Xanax a day (as the year's band re-runs a stretch).
 * @param {object} r - the plan's result (with `unlocked`)
 * @param {object} args - compareSteps' arguments
 * @param {function} hookFor - (stopAt gym id) => an unlock hook that stops there
 * @returns {Generator} yielding between runs; its value: [{gymId, name, day, fee, gain}]
 */
export function* gymWorthSteps(r, args, hookFor) {
    const opened = r && Array.isArray(r.unlocked) ? r.unlocked.filter((u) => u.gymId <= 24).slice(0, GYM_WORTH_MAX) : [];
    if (!opened.length) return [];
    const base = simInputs(args);
    const run = function* (stopAt) {
        const out = yield* simSliced(r.id, {
            ...base,
            ...(r.candy ? { candyId: r.candy.id, candyCount: r.candy.count } : {}),
            ...(r.booster ? { energyBooster: { id: r.booster.id, perDay: r.booster.perDay } } : {}),
            ...(r.refill === false ? { noRefill: true } : {}),
            ...(Number.isFinite(r.xanaxPerDay) ? { xanaxPerDay: r.xanaxPerDay } : {}),
            ...(r.specialHelps === false ? { special: 0 } : {}),
            unlock: hookFor(stopAt),
        });
        return out.gained;
    };
    // With the ladder open up to each gym in turn; the gym's worth is the step between two runs.
    const upTo = [];
    yield 'gyms';
    upTo.push(yield* run(opened[0].gymId - 1));
    for (const u of opened) {
        yield 'gyms';
        upTo.push(yield* run(u.gymId));
    }
    return opened.map((u, i) => ({ gymId: u.gymId, name: (gymById(u.gymId, args.pc.table) || {}).name || 'Gym ' + u.gymId, day: Number.isFinite(u.t) ? Math.floor(u.t / 1440) + 1 : null, fee: u.cost || 0, gain: upTo[i + 1] - upTo[i] }));
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
export function blissWhatIf(args) {
    return drainSteps(blissWhatIfSteps(args));
}

/** blissWhatIf in slices (a generator: yields for breaks inside each run). */
export function* blissWhatIfSteps({ state, pc, shares, settings, prices, special = 0, statics = {}, pickBy = 'most', live = false }) {
    const base = { ...simInputs({ state, pc, shares, settings, prices, special, statics, live }), bliss: true };
    yield 'bliss';
    const steady = yield* simSliced('blissSteady', base);
    yield 'bliss';
    const choco = (yield* withBestCandySteps('dailyChoco', base, { budget: budgetOf(settings), pickBy })).result;
    return { blissSteady: { ...steady, whatIf: true }, dailyChoco: { ...choco, whatIf: true } };
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
export function companyWhatIf(args) {
    return drainSteps(companyWhatIfSteps(args));
}

/** companyWhatIf in slices (a generator: yields for breaks inside each run). */
export function* companyWhatIfSteps({ state, pc, shares, settings, prices, special = 0, statics = {}, pickBy = 'most', compare = null, recommended = null, live = false }) {
    const best = compare && recommended ? compare[recommended] : null;
    if (!best) return [];
    const base = simInputs({ state, pc, shares, settings, prices, special, statics, live });
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
        yield 'job';
        add('an10', 'edvdJumpAN', 'Adult Novelties', 10, yield* withBestSpecialSteps('edvdJumpAN', { ...base, adultNovelties10: true, freeEdvdPerDay: 10 / VOYEUR_JP, jobHappy: null }));
    }
    if (!base.toyShop5) {
        yield 'job';
        const probe = yield* simSliced('consoleJumpToy', { ...base, special: 0, toyShop5: true, jobHappy: null });
        if (!consoleBlocked(pc.stats, probe.perStat)) add('toy5', 'consoleJumpToy', 'Toy Shop or Game Shop', 5, (yield* withBestCandySteps('consoleJumpToy', { ...base, toyShop5: true, jobHappy: null }, { budget: budgetOf(settings), pickBy })).result);
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
 * Energy the day plan keeps on purpose right now (round 7 review): the gym page and the panel never say to train it.
 * Read from what the day plan does (plan.js), not a new rule:
 *   jump     Xanax stacked for a jump (energy above the maximum on a jump plan): all of it waits for the jump;
 *   boost    the daily choco boost's held Xanax ("Xanax #N · keep the energy for the boost"): all of it waits;
 *   console  the console jump before its stack: the bar stays under the 3 Xanax (strategies.js stackRoom), so the
 *            plan trains only what is above it (with a 100–150 bar: nothing);
 *   war      energy kept for a faction war (Settings › Keep for war days): the plan trains above it.
 * @returns {{why:'jump'|'boost'|'console'|'war', amount:number, all:boolean, stacked:number, stackTo:number, war:string|null}|null}
 *   amount: the energy kept now (never more than there is); all: none of the energy is to be trained now
 */
export function keptEnergyOf({ strategy, energy, stacking = false, stacked = 0, holding = false, warKeep = 0, warName = null }) {
    const e = Math.max(0, Number(energy) || 0);
    if (!(e > 0)) return null;
    const isConsole = strategy === 'consoleJump' || strategy === 'consoleJumpToy';
    const stackTo = isConsole ? CONSOLE_STACK : JUMP_STACK;
    let why = null;
    let amount = 0;
    if (stacking) {
        why = 'jump';
        amount = e;
    } else if (holding) {
        why = 'boost';
        amount = e;
    } else if (isConsole) {
        why = 'console';
        amount = Math.min(e, stackRoom(CONSOLE_STACK));
    }
    const war = Math.min(e, Math.max(0, Number(warKeep) || 0));
    if (war > amount) {
        why = 'war';
        amount = war;
    }
    if (!why || !(amount > 0)) return null;
    return { why, amount, all: amount >= e, stacked: why === 'jump' ? Math.max(1, Math.min(stackTo, Number(stacked) || 0)) : 0, stackTo, war: why === 'war' ? warName || null : null };
}

/**
 * Round 6: the numbers come from the saved plan (`compare`: every plan's result, or on Torn's pages the small part;
 * `rec`: its recommendation; `warn`: plans whose pick warns). `lite` (Torn's pages): only what those pages show is
 * worked out (today's steps, the 48 h look-ahead, the strip, the gym page's next two days); no ladder, no 30-day
 * projection. `saved`: where the saved plan stands (null: no plan yet).
 */
export function buildModel({ state, statics = {}, plan, settings, log = [], history = {}, prices = {}, compare = null, rec: recIn = null, warn = null, lite = false, saved = null, onPath = false, whatIf = null, jobWhatIf = null, gymProgress = null, unlockedKnown = null, learnedMult = null, skipped = [], pc: pcIn = null, auto = null, warOn = null, stacking = null, overdose = null, now }) {
    if (!state) return { ready: false };
    // One player context per refresh: the comparison's, when the caller has it.
    const pc = pcIn || playerContext(state, statics, { unlockedKnown, learnedMult });
    const build = buildOf(plan.build);
    const shares = targetShares(plan, pc.stats, build.shares);
    const keep = (build.gyms || []).filter((id) => pc.unlocked.includes(id) && gymAccess(gymById(id, pc.table), pc.stats).ok);
    const today = (log || []).filter((e) => tornDayStart(e.at) === tornDayStart(now));
    // Today's boost counts once it is finished (round 7: boosters eaten with the drug still to take is "boosting").
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
        // The small-budget plan: the Xanax a day the comparison found the money covers.
        ...(compare && compare[plan.strategy] && Number.isFinite(compare[plan.strategy].xanaxPerDay) ? { xanaxPerDay: compare[plan.strategy].xanaxPerDay } : {}),
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
    const hold = holdBoosterFor(events, now, plan.strategy, boosterCapOf(pc, settings));
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
    // Xanax today: the ones taken and the ones still planned before midnight, in whatever step they come (a candy +
    // Xanax boost carries one: round 7, "Xanax 1 of 1 today" while the next step was Xanax #2).
    const xanaxPlanned = today.filter(isDrugEntry).length + steps.filter((s) => (s.items || []).some((it) => it.id === XANAX) && s.at < tornDayStart(now) + DAY).length;
    // Xanax stacked for a jump: energy is above the maximum, so a refill (it only fills to the maximum) would add nothing.
    const stackingNow = (STRATEGIES[plan.strategy] || {}).kind === 'jump' && over > 0;
    const energyKept = keptEnergyOf({ strategy: plan.strategy, energy, stacking: stackingNow, stacked: ctx.stackedSoFar, holding: ctx.holding, warKeep, warName: warOn && warOn.name });
    const strip = {
        energy: { current: energy, max: e.maximum, fullAt },
        happy: { current: happyAt(state, now, { bliss: pc.perks.bliss }), max: state.happy.maximum, property: statics.property && statics.property.property ? statics.property.property.name : null },
        drug: { left: drugLeft, total: drugLeft > 0 ? Math.max(drugLeft, state.drugCd * 1000) : 0, xanaxDone: ctx.drugsToday, xanaxPlanned },
        // The cooldown left, when it's back under the cap (a booster can be used again), and the plan's next booster step.
        booster: { left: boosterLeft, capH: ctx.boosterCapH, underCapIn: Math.max(0, boosterLeft - ctx.boosterCapH * 3600e3), used: steps.some(usesBooster), next: nextBoost ? { at: nextBoost.at, label: nextBoost.label, kind: nextBoost.kind } : null },
        refill: { free: refillFree, plannedAt: refillStep ? refillStep.at : null, stacking: stackingNow },
    };

    // Stats vs build
    const gaps = buildGaps(pc.stats, shares);
    const days = Object.keys(history || {}).map(Number).sort((a, b) => a - b).slice(-7);
    const trainedToday = {};
    for (const x of today) for (const k of STATS) trainedToday[k] = (trainedToday[k] || 0) + ((x.trained && x.trained[k]) || 0);
    const plannedToday = {};
    // Today's trains only (round 7: tomorrow's jump was counted in "trains today").
    for (const s of steps) if (s.at < tornDayStart(now) + DAY) for (const [k, n] of Object.entries(s.trains || {})) plannedToday[k] = (plannedToday[k] || 0) + n;
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
    // Energy a day: the plan followed's own (round 7: the build date and the next gym's days were a fixed steady
    // 1,620 a day for every plan), else steady's.
    const planR = compare && compare[plan.strategy];
    const planDaysN = settings.horizonDays || 30;
    const energyPerDay = planR && planR.energyTrained > 0 ? Math.round(planR.energyTrained / planDaysN / 10) * 10 : Math.round(((e.interval <= 600 ? 720 : 480) + 250 * Math.floor(1440 / 420) + e.maximum) / 10) * 10;
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
    // Not on a stack day: with energy above the maximum the refill would do nothing (round 7).
    if (refillFree && msToTornMidnight(now) < REFILL_WARN_MS && !ctx.noRefill && !stackingNow) heads.push({ tone: 'warn', text: 'Refill unused', sub: 'use before 00:00 Torn time' });
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
    // A gym to unlock: said on every plan (when it opens), with an optional date; never a reason to pick fewer stats.
    const openBy = openByOf(plan, pc, saved && saved.from ? saved.from : tornDayStart(now), settings.horizonDays || 30);
    if (auto && auto.needsKey) heads.unshift({ tone: 'warn', text: 'Auto mode needs a Full key', sub: 'Settings › Full key · until then a new plan uses your budget', go: 'settings' });
    // No saved plan yet (a new install, or plans from before round 6): today's steps follow the plan picked (steady by
    // default) until you create one. Nothing is worked out in the background.
    if (!saved && !compare) heads.unshift({ tone: 'warn', text: 'Create your plan', sub: 'Plan › Create plan · until then the steps follow ' + ((STRATEGIES[plan.strategy] || STRATEGIES.steady).name || 'steady training').toLowerCase(), go: 'plan' });
    if (saved && saved.progress && saved.progress.ended) heads.unshift({ tone: 'warn', text: 'Your plan has ended', sub: 'Plan › Create plan for the next one', go: 'plan' });
    if (compare) {
        const r = recIn || recommend(compare, { budget: budgetOf(settings), bliss: pc.perks.bliss, pickBy, openBy });
        rec = r;
        const mine = compare[plan.strategy];
        // Following the saved path (its plan for this stretch): that is the plan, not a pick to warn about.
        if (onPath) heads.push({ tone: 'good', text: (STRATEGIES[plan.strategy] || {}).name + ' is your plan', sub: 'your saved plan for these days' });
        else if (r.recommended === plan.strategy) heads.push({ tone: 'good', text: (STRATEGIES[plan.strategy] || {}).name + ' is your plan' });
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
    // The gym to unlock: the day each plan opens it (the simulator's own run; an estimate from its energy a day for
    // plans saved before round 7), with its stats and cost against the recommended plan (one baseline on the page).
    let unlock = null;
    if (openBy && compare && !lite) {
        const gym = gymById(openBy.gymId, pc.table);
        const left = unlockEnergyLeft(pc.unlocked, openBy.gymId, gymProgress, pc.perks.gymExpMult);
        if (gym && left !== null) {
            const base = (rec && compare[rec.recommended]) || null;
            const from = saved && saved.from ? saved.from : tornDayStart(now);
            const rows = {};
            for (const [id, r] of Object.entries(compare)) {
                if (!r) continue;
                const day = opensOnDay(r, openBy.gymId);
                rows[id] = { day, at: day ? from + (day - 1) * DAY : null, days: day ? null : unlockDays(r, left, horizon), gained: r.gained, cost: r.cost, statsPct: base && base.gained > 0 ? (100 * (r.gained - base.gained)) / base.gained : 0, dCost: base ? r.cost - base.cost : 0, blocked: Boolean(r.blocked) };
            }
            unlock = { gym, energyLeft: left, rows, best: rec ? rec.recommended : null, by: openBy.by, byDay: openBy.days };
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
        // Energy the plan keeps on purpose now (null: none): what every "train now" surface leaves alone.
        energyKept,
        noRefill: Boolean(ctx.noRefill),
        auto: auto ? { ...auto, afford: affordLine(auto, recRow ? recRow.cost / horizon : 0, recRow ? recRow.cash : null), wait: autoWaitLine(auto) } : null,
        // The saved plan: its dates and where it stands (null: no plan yet), and the days its numbers cover.
        saved,
        planDays: horizon,
        unlock,
        // Your Xanax cooldown (median of the ones recorded, the range) and when the Torn day resets.
        xanaxCd: xcd,
        dayResetAt: tornDayStart(now) + DAY,
        // held: while any are held the daily refill is a special (Torn uses them before the points refill).
        special: { have: state.specialRefills, left: specialLeft(plan, state), use: plan.specialUse || 0, held: ctx.specialHeld },
        prices,
        // Stacking energy for a chain (round 7, Home's "I'm stacking"): {since: ms}, null while training. The steps
        // above stay as they are; every surface that would ask you to train reads this and holds them back.
        stacking: stacking && Number(stacking.since) > 0 ? { since: Number(stacking.since) } : null,
        // An overdose seen on your bars (runtime.js overdoseSeen): {at, until} while it is on, else null. Held back
        // the same way: the steps stay, every surface says "Overdosed · fly to Switzerland" instead of them.
        overdose: overdose && Number(overdose.until) > now && !overdose.ended ? { at: Number(overdose.at) || now, until: Number(overdose.until) } : null,
        // Flying or abroad (Torn's travel answer): {flying, where, until}. Held back the same way: the gym is closed.
        away: awayOf(state.travel, now),
    };
}

