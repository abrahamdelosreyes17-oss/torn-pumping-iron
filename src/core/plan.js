/*
 * Plans and the day's steps. Pure. ENGINE-SPEC §6.
 *
 * The timeline is always worked out again from the live state, so a step
 * done late (or early) moves every later step with it: steady and goal plans
 * re-time silently. Jump steps are strict: they carry a warning time ahead
 * of the tick they depend on. Steps are marked done from state changes
 * (a drug cooldown that jumped, a stat that rose), never from a click.
 */

import { STATS, totalOf, trainsToReach } from './gain.js';
import { splitSession } from './builds.js';
import { energyAt, happyAt, drugFreeAt, boosterFreeAt, refillAvailable, tornDayStart, nextQuarterTick, DAY, MIN, HOUR } from './bars.js';
import { XANAX, ECSTASY, EDVD, FHC, CANDY_KISSES, POINTS, REFILL_POINTS, ITEMS, XANAX_CD_MIN, ECSTASY_CD_MIN, BOOSTER_CAP_H, boostersThatFit, itemName, boosterHours } from './items.js';
import { STRATEGIES, JUMP_STACK, SPECIAL, CONSOLE_STACK, CONSOLE_USES, CONSOLE_ENERGY_EACH, CONSOLE_HAPPY_EACH, CONSOLE_ITEM, stackRoom, TICK_OFFSET_MIN } from './strategies.js';
import { spendJobPoints, jobHappyWords } from './jobs.js';
import { HAPPY_CAP, ENERGY_CAP, HAPPY_LOSS_PER_ENERGY } from './gain.js';
import { catchUpLabel } from './turns.js';
import { fillFromPool, takeFromHeld, fillWords, heldWords, tierWords } from './candy.js';

export const PLAN_TYPES = ['steady', 'goal', 'jump'];

/** Strict steps warn this long before their time. */
export const STRICT_WARN_MS = 5 * MIN;

/** An unused refill is flagged this long before Torn midnight. */
export const REFILL_WARN_MS = 2 * HOUR;

/** A refill the plan couldn't place earlier goes this long before midnight. */
export const REFILL_LAST_CALL_MS = 30 * MIN;

/**
 * Round 7 (review 2.6): in the middle of a boost or jump. Happy this far above the maximum (a share of what the
 * plan's boosters add, at least MID_BOOST_MIN) means the boosters are eaten: the step stays, and what is left of it
 * (the drug, the trains, the refill) is due before the quarter tick that resets the happy.
 */
export const MID_BOOST_SHARE = 0.25;
export const MID_BOOST_MIN = 300;

/**
 * How far above its maximum happy must be for the boosters to count as eaten: the share of the boost above, at
 * least MID_BOOST_MIN, but never more than half the boost itself. A small candy boost (Candy Kisses x 4 = +200)
 * never reached the 300 floor: the gym page stayed on "eat first" and the day plan planned the candy a second time.
 * Half of it is still more than a Xanax's +75 for any boost over 150. One rule for the day plan and the gym page.
 */
export function boostEatenOver(boostHappy) {
    const b = Math.max(0, Number(boostHappy) || 0);
    const over = Math.max(MID_BOOST_MIN, MID_BOOST_SHARE * b);
    return b > 0 ? Math.min(over, b / 2) : over;
}

/**
 * A boost or jump as its actions in order (round 7, D.1), each with what proves it done from Torn's bars:
 * the boosters (the booster cooldown goes up, happy goes above the maximum), job points, the drug (the drug
 * cooldown goes up), the trains (energy goes down), the refill and its trains. `now` is the action of the moment.
 * @param {object} o - {eat: words|null, eaten, jp: words|null, drug: 'Ecstasy'|'Xanax'|null, drugDone, trained, refill}
 * @returns {{list:{id, text, proof, done}[], now:number}}
 */
export function boostActions({ eat = null, eaten = false, jp = null, drug = null, drugDone = false, trained = false, refill = false }) {
    const list = [];
    if (eat) list.push({ id: 'eat', text: 'Eat ' + eat, proof: 'the booster cooldown goes up and happy goes above your maximum', done: eaten });
    if (jp) list.push({ id: 'jp', text: jp, proof: 'happy goes up', done: eaten && drugDone });
    if (drug) list.push({ id: 'drug', text: 'Take the ' + drug, proof: 'the drug cooldown starts', done: drugDone });
    list.push({ id: 'train', text: 'Train it all', proof: 'energy goes down', done: trained });
    if (refill) list.push({ id: 'refill', text: 'Refill, then train again', proof: 'the refill shows as used', done: false });
    const now = list.findIndex((a) => !a.done);
    return { list, now: now < 0 ? list.length - 1 : now };
}

/** The plan type a strategy belongs to. */
export function planTypeOf(strategyId, goal = null) {
    if (goal) return 'goal';
    const s = STRATEGIES[strategyId];
    return s && s.kind === 'jump' ? 'jump' : 'steady';
}

/**
 * @param {object} o - {strategy, build, goal?, createdAt}
 *   goal: {kind:'unlockGym', gymId} | {kind:'reachBuild', buildId} | {kind:'statTargets', targets:{str,...}}
 */
export function makePlan({ strategy = 'steady', build = 'balanced', goal = null, createdAt = 0 } = {}) {
    return { type: planTypeOf(strategy, goal), strategy, build, goal, createdAt };
}

/**
 * The shares each train aims at. A stat-number goal aims at what's still
 * missing; otherwise the build's shares.
 */
export function targetShares(plan, stats, buildShares) {
    if (plan && plan.goal && plan.goal.kind === 'statTargets' && stats) {
        const t = plan.goal.targets || {};
        const gap = {};
        let sum = 0;
        for (const k of STATS) {
            gap[k] = Math.max(0, (Number(t[k]) || 0) - (stats[k] || 0));
            sum += gap[k];
        }
        if (sum > 0) {
            // Shares that make the greedy split close the biggest gaps first.
            const total = totalOf(stats) + sum;
            const out = {};
            for (const k of STATS) out[k] = ((stats[k] || 0) + gap[k]) / total;
            return out;
        }
    }
    return buildShares;
}

/** Days until each stat target is met at `energyPerDay` (a rough ETA from the current rate). */
export function goalEta({ stats, targets, gyms, happy, energyPerDay }) {
    let energy = 0;
    for (const k of STATS) {
        const t = Number(targets && targets[k]) || 0;
        if (!(t > (stats[k] || 0))) continue;
        const g = gyms[k];
        if (!g) return null;
        const r = trainsToReach({ stat: k, S: stats[k] || 0, target: t, H: happy, dots: g.dots[k] || g.dots, energyPerTrain: g.energy });
        if (!r) return null;
        energy += r.energy;
    }
    return energyPerDay > 0 ? { energy, days: energy / energyPerDay } : null;
}

/* --------------------------------------------------------------- timeline */

function sessionGain(ctx, stats, energy, happy, happyMax = null) {
    return splitSession({
        happyMax,
        stats,
        shares: ctx.shares,
        energy,
        happy,
        unlocked: ctx.unlocked,
        perks: ctx.perks || null,
        keep: ctx.keep || [],
        table: ctx.table,
        active: ctx.active,
        happyLossMult: ctx.happyLossMult || 1,
    });
}

function trainsOf(split) {
    const out = {};
    for (const k of STATS) if (split.perStat[k].trains) out[k] = split.perStat[k].trains;
    return out;
}

function gymsOf(split) {
    const out = {};
    for (const k of STATS) if (split.perStat[k].trains) out[k] = split.perStat[k].gym ? split.perStat[k].gym.name : null;
    return out;
}

/** The session in gym parts, in train order: [{gymId, gymName, stat, trains, energy, perTrain, gain, stopAt?, stopReason?}]. */
function partsOf(split) {
    return (split.parts || []).map((p) => ({ gymId: p.gymId, gymName: p.gymName, stat: p.stat, trains: p.trains, energy: p.energy, perTrain: p.perTrain, gain: p.gain, ...(p.stopAt !== undefined ? { stopAt: p.stopAt, stopReason: p.stopReason } : {}) }));
}

/**
 * The day's remaining steps, worked out from the live state.
 *
 * @param {object} o
 * @param {object} o.state - normalizeState() output
 * @param {number} o.now
 * @param {string} o.strategy
 * @param {object} o.ctx - {shares, unlocked, perks, keep, active, table, bliss, happyLossMult,
 *   xanaxCdMin, ecstasyCdMin, candyId, candyCount, edvdCount, boosterCapH, stackedSoFar, drugsToday,
 *   specialLeft (special refills the plan may still use), energyBooster {id, perDay} (steadyBoost),
 *   holdBooster (an event that needs the booster cooldown is near: no boosters), candyMult, canMult,
 *   toyShop5, adultNovelties10, xanaxPerDay (the small-budget plan: at most this many Xanax a Torn day)}
 *   held: {[id]: qty} boosters in the inventory (used first: candy and energy drinks as a pool)
 * @param {number} [o.until] - end of the window (default: the next Torn midnight; later: the look-ahead, days rolling on)
 * @returns {object[]} steps {id, at, kind, label, items:[{id,qty}], trains:{}, gyms:{}, parts:[] (train steps: the session in gym parts), gain, energy, strict, warnAt, note}
 */
export function dayTimeline({ state, now, strategy, ctx, until = null }) {
    // One Torn day by default. With `until` past midnight (the 48 h look-ahead) the days roll on: each new
    // Torn day brings its refill, its Xanax count and its boost back.
    const lookAhead = until !== null && until > tornDayStart(now) + DAY;
    const end = until || tornDayStart(now) + DAY;
    const maxE = state.energy.maximum;
    const interval = state.energy.interval * 1000;
    const inc = state.energy.increment;
    const happyMax = state.happy.maximum;
    const xanCD = (ctx.xanaxCdMin || XANAX_CD_MIN) * MIN;
    const ecsCD = (ctx.ecstasyCdMin || ECSTASY_CD_MIN) * MIN;
    const bliss = Boolean(ctx.bliss);
    const minTrain = Math.min(...STATS.map((k) => (ctx.minTrainE && ctx.minTrainE[k]) || 10));

    let stats = { ...(state.stats || { str: 0, spd: 0, def: 0, dex: 0 }) };
    let t = now;
    let E = energyAt(state, now);
    let H = happyAt(state, now, { bliss });
    // A drug step skipped in Discord moves the next one to the cooldown that would have followed it.
    let drugAt = Math.max(now, drugFreeAt(state), ctx.drugNotBefore || 0);
    // While specials are held the day's refill is a special: one already used today counts as it.
    let refillLeft = refillAvailable(state, now) && !(ctx.specialHeld > 0 && (ctx.specialToday || 0) >= 1);
    let xanN = (ctx.drugsToday || 0) + 1;
    // The small-budget plan: at most this many Xanax a Torn day (the simulator keeps the same count: strategies.js).
    const xanCap = Number.isFinite(ctx.xanaxPerDay) ? Math.max(0, Math.floor(ctx.xanaxPerDay)) : Infinity;
    const steps = [];
    let n = 0;
    let curDay = tornDayStart(now);

    // The booster cooldown (owner, 2026-09-29: "cant do it once per day BECAUSE OF THE COOLDOWN"). A booster can be
    // used while the cooldown is under the cap, the last one overshooting it: every candy, EDVD, FHC and can here
    // is counted against the live cooldown and what the plan adds.
    const capH = ctx.boosterCapH || BOOSTER_CAP_H;
    const capMs = capH * HOUR;
    const cdMult = ctx.cdMult || 1;
    let boosterAt = Math.max(now, boosterFreeAt(state));
    const fitsAt = (id, at) => boostersThatFit(id, capH, Math.max(0, boosterAt - at) / HOUR, cdMult);
    const addBooster = (id, qty, at) => {
        boosterAt = Math.max(boosterAt, at) + qty * boosterHours(id, cdMult) * HOUR;
    };
    // The first time `qty` of an item fit under the cap.
    const roomFor = (id, qty) => boosterAt - capMs + Math.max(0, qty - 1) * boosterHours(id, cdMult) * HOUR;
    // Boosters you hold go first (candy and energy drinks as a pool): what's left carries to the next boost.
    const pool = {};
    for (const [k, v] of Object.entries(ctx.held || {})) if (Number(v) > 0) pool[k] = Math.floor(Number(v));
    const fillPool = (qty, pickId) => {
        const f = fillFromPool(qty, pickId, pool);
        takeFromHeld(pool, f);
        return f;
    };

    // Natural regeneration from t to t2 (none above the maximum), and happy back up.
    const advance = (t2) => {
        if (t2 <= t) return;
        if (E < maxE) E = Math.min(maxE, E + inc * Math.floor((t2 - t) / interval));
        if (!bliss && H > happyMax) H = nextQuarterTick(t) <= t2 ? happyMax : H;
        else if (H < (bliss ? HAPPY_CAP : happyMax)) H = Math.min(bliss ? HAPPY_CAP : happyMax, H + 5 * Math.floor((t2 - t) / (15 * MIN)));
        t = t2;
    };
    const train = (at, kind, label, items, extra = {}, leave = 0) => {
        // A faction war (Settings › Keep for war days): never train below the energy kept for it. `leave`: energy
        // that stays in the bar for the stack (round 7: what fits under the 1,000 cap with the Xanax to come).
        const keep = Math.max(0, Math.min(E, Math.max(ctx.keepEnergy || 0, leave)));
        const split = sessionGain(ctx, stats, E - keep, H, happyMax);
        stats = split.statsAfter;
        const step = { id: kind + '-' + ++n, at, kind, label, items, trains: trainsOf(split), gyms: gymsOf(split), parts: partsOf(split), gain: Math.round(split.gain), energy: split.energyUsed, strict: false, warnAt: null, ...extra };
        if (step.note === undefined) delete step.note;
        if (keep > 0 && keep > leave) step.note = (step.note ? step.note + ' · ' : '') + 'keeps ' + keep + ' energy for the war';
        E = split.energyLeft + keep;
        H = split.happyAfter;
        steps.push(step);
        return step;
    };
    const fullAt = () => (E >= maxE ? t : t + Math.ceil((maxE - E) / inc) * interval);
    // A refill (points or special) or an FHC sets energy to the maximum, never above it (O2): `qty` of them are
    // used one at a time, each once the last is trained, and shown as one step.
    const trainEach = (at, kind, label, items, qty, extra = {}, happyEach = 0, leave = 0) => {
        const keep = Math.max(0, ctx.keepEnergy || 0);
        // Energy kept for a war fills the bar on its own: a refill or FHC then adds nothing, so none is planned (or bought).
        if (keep >= maxE && E >= maxE) return null;
        const first = steps.length;
        // A full bar is trained first: a refill or FHC only fills up to the maximum.
        if (E >= maxE && E - keep >= minTrain) train(at, kind, label, items, extra);
        for (let i = 0; i < qty; i++) {
            E = Math.max(E, maxE);
            H += happyEach;
            // `leave`: the refill before a stack that has room for the bar (the console jump) stays in the bar.
            train(at, kind, label, items, extra, leave);
        }
        const parts = steps.splice(first);
        if (!parts.length) return null;
        const one = parts[0];
        for (const p of parts.slice(1)) {
            for (const [k, v] of Object.entries(p.trains || {})) one.trains[k] = (one.trains[k] || 0) + v;
            Object.assign(one.gyms, p.gyms || {});
            one.gain += p.gain || 0;
            one.energy += p.energy || 0;
            if (Array.isArray(one.parts) && Array.isArray(p.parts)) one.parts = one.parts.concat(p.parts);
        }
        steps.push(one);
        return one;
    };
    // Special refills the plan may use: all in the session that gains most (a jump or boost; else the next Xanax session).
    // In a boosted session: as many as keep happy above the maximum; otherwise what's left of today's share.
    // While specials are held the day's refill is one of them (Torn blocks the points refill until they're spent [verify]).
    let heldLeft = Math.max(0, Math.floor(ctx.specialHeld || 0));
    let specialLeft = Math.min(Math.max(0, Math.floor(ctx.specialLeft || 0)), ctx.specialHeld === undefined || ctx.specialHeld === null ? Infinity : heldLeft);
    let shareLeft = Math.max(0, Math.floor((ctx.specialPerDay || 0) - (ctx.specialToday || 0)));
    const special = (at) => {
        specialLeft = Math.min(specialLeft, ctx.specialHeld === undefined || ctx.specialHeld === null ? Infinity : heldLeft);
        if (!specialLeft) return;
        const drain = HAPPY_LOSS_PER_ENERGY * maxE * (ctx.happyLossMult || 1);
        let qty = Math.min(specialLeft, shareLeft);
        while (qty < specialLeft && H - drain * (qty + 1) > happyMax) qty++;
        shareLeft = Math.max(0, shareLeft - qty);
        if (!qty) return;
        if (!trainEach(at, 'special', 'Special refills × ' + qty + ', train after each', [{ id: SPECIAL, qty }], qty, { note: 'free: they come with your account · each fills energy to ' + maxE + ', never above' })) {
            shareLeft += qty;
            return;
        }
        specialLeft -= qty;
        heldLeft = Math.max(0, heldLeft - qty);
    };
    // The day's refill: a special while any are held (never both on one day), else 30 points.
    const refill = (at, extra = {}, leave = 0) => {
        if (Math.max(0, ctx.keepEnergy || 0) >= maxE && E >= maxE) return null;
        if (heldLeft > 0) {
            heldLeft--;
            specialLeft = Math.min(specialLeft, heldLeft);
            return trainEach(at, 'refill', 'Special refill (instead of the points refill)', [{ id: SPECIAL, qty: 1 }], 1, { ...extra, note: 'Torn lets you use the points refill only once your special refills are spent [1 source]' }, 0, leave);
        }
        // Not worth its price under the Plan rule (the comparison decided): the points refill is left out.
        if (ctx.noRefill) return null;
        return trainEach(at, 'refill', 'Refill · ' + REFILL_POINTS + ' points', [{ id: POINTS, qty: REFILL_POINTS }], 1, extra, 0, leave);
    };
    // Would the day's refill add energy (a special held, or the points refill when the plan keeps it)?
    const refillGives = () => heldLeft > 0 || !ctx.noRefill;
    const candyMult = ctx.candyMult || 1;
    const candyId = ctx.candyId && ITEMS[ctx.candyId] ? ctx.candyId : CANDY_KISSES;
    const candyQty = () => ctx.candyCount || boostersThatFit(candyId, capH, 0, cdMult);
    // A candy boost of `qty`, from what you hold first: the happy, the items, the words and the note.
    // Fewer than planned: the note says the cooldown at that time against the cap, and what one candy adds (the owner,
    // 2026-10-03: "Candy × 22" while his booster cooldown read 13h 05m, and the note didn't say why 22).
    const candyBoost = (qty, at = now) => {
        const f = fillPool(qty, candyId);
        const planned = candyQty();
        // Rounded up, so the words' own arithmetic gives the same count (13h 00m 20s reads 13h 01m: 22, not 23).
        const leftMin = Math.ceil(Math.max(0, boosterAt - at) / MIN);
        const eachMin = Math.round(boosterHours(candyId, cdMult) * 60);
        const room = qty < planned ? 'booster cooldown ' + Math.floor(leftMin / 60) + 'h ' + String(leftMin % 60).padStart(2, '0') + 'm of ' + capH + 'h: room for ' + qty + ' of ' + planned + ' (' + eachMin + ' min each)' : null;
        const notes = [heldWords(f), room, tierWords(candyId) || null].filter(Boolean);
        return { f, happy: f.value * candyMult, items: f.alloc.map((a) => ({ id: a.id, qty: a.qty })), words: fillWords(f, candyId), note: notes.join(' · ') };
    };
    // Job points banked where the player works: happy specials spent in the boosted session.
    let jpBank = ctx.jobHappy ? Math.max(0, Number(ctx.jobHappy.bank) || 0) : 0;
    const jobPoints = () => {
        if (!ctx.jobHappy) return { happy: 0, jp: 0, words: '' };
        const r = spendJobPoints(ctx.jobHappy, jpBank);
        jpBank -= r.jp;
        return { ...r, words: r.jp ? jobHappyWords(ctx.jobHappy, r.jp) : '' };
    };
    const joinNote = (...parts) => parts.filter(Boolean).join(' · ') || undefined;

    const s = STRATEGIES[strategy] ? strategy : 'steady';
    const isConsole = s === 'consoleJump' || s === 'consoleJumpToy';
    const isJump = s === 'chocoJump' || s === 'edvdJump' || s === 'happy99k' || s === 'edvdJumpAN' || isConsole;

    // Daily choco: one Xanax a day is held (its energy kept, not trained); at
    // its cooldown end, candy + Ecstasy just after a tick, train it all, refill.
    // Before an event that boosts candy, today's candy waits for it (plain Xanax sessions meanwhile).
    const daily = s === 'dailyChoco' && !ctx.holdBooster;
    // Candy + Xanax: once a day the Xanax waits for a quarter tick, then candy fills the booster cooldown (no Ecstasy).
    const candyDaily = s === 'candyXanax' && !ctx.holdBooster;
    // Energy boosters on the booster cooldown after each Xanax session (steadyBoost from the ladder; steadyMax: FHC as often as it allows).
    const eb = ctx.holdBooster ? null : s === 'steadyMax' ? { id: FHC, perDay: Infinity } : s === 'steadyBoost' && ctx.energyBooster && ITEMS[ctx.energyBooster.id] ? ctx.energyBooster : null;
    let ebToday = ctx.boostersToday || 0;
    // Steady with Bliss: EDVD with each Xanax whenever the booster cooldown has room (happy never falls back).
    const blissEdvd = s === 'blissSteady';
    let boosted = Boolean(ctx.boostedToday);
    let holding = Boolean(ctx.holding);
    let naturalOk = true;

    // What this plan's boosters add to happy (for telling a boost under way from the bars).
    const boostPlan = isJump || s === 'dailyChoco' || s === 'candyXanax';
    const boostHappy = () => {
        const candy = candyQty() * ITEMS[candyId].happy * candyMult;
        if (isConsole) return CONSOLE_USES * CONSOLE_HAPPY_EACH * (s === 'consoleJumpToy' || ctx.toyShop5 ? 2 : 1) + candy;
        if (s === 'chocoJump' || s === 'dailyChoco' || s === 'candyXanax') return candy;
        return (ctx.edvdCount || 5) * ITEMS[EDVD].happy * (ctx.adultNovelties10 || s === 'edvdJumpAN' ? 2 : 1);
    };
    // The same boosters by name, for a step found under way (round 8: once eaten they keep their name, "EDVD × 5",
    // where the list said "Boosters"). A jump waits for room for its whole load, so the count is the plan's; a daily
    // candy boost can be smaller (the room under the cooldown that day), so it has the name alone.
    const boostName = () => {
        if (isConsole) return 'Game Console + ' + itemName(candyId) + ' × ' + candyQty();
        if (s === 'chocoJump') return itemName(candyId) + ' × ' + candyQty();
        if (s === 'dailyChoco' || s === 'candyXanax') return itemName(candyId);
        return 'EDVD × ' + (ctx.edvdCount || (s === 'happy99k' ? boostersThatFit(EDVD, capH) : 5));
    };
    let midDone = false;

    // A new Torn day: its refill (today's, if unused, goes in before midnight), Xanax count, boost and share.
    const rollDay = (at) => {
        while (tornDayStart(at) > curDay) {
            // Not while a Xanax is held for the boost: the refill would train its energy.
            if (refillLeft && !isJump && !holding) {
                const last = Math.max(t, curDay + DAY - REFILL_LAST_CALL_MS);
                advance(last);
                refill(last, { note: 'Use before 00:00 Torn time' });
            }
            curDay += DAY;
            refillLeft = true;
            boosted = false;
            xanN = 1;
            ebToday = 0;
            shareLeft = Math.max(0, Math.floor(ctx.specialPerDay || 0));
            naturalOk = true;
        }
    };

    // Mid-step (round 7, review 2.6): the boosters of this plan's boost are in (happy is above the maximum by a boost's
    // worth, now). The step stays until it is finished: the drug if its cooldown is clear, train it all, the refill,
    // train; all before the next quarter tick, which resets the happy. Before, the plan was worked out again from the
    // bars as if nothing had started: after 5 EDVD it said the jump was in 30 hours (the booster cooldown it had just
    // filled), and after the day's candy it planned a plain Xanax and a second candy boost.
    if (boostPlan && H >= happyMax + boostEatenOver(boostHappy())) {
        const tick = nextQuarterTick(now);
        const keep = Math.max(0, Math.min(E, ctx.keepEnergy || 0));
        const drugName = s === 'candyXanax' ? 'Xanax' : 'Ecstasy';
        // The cooldown is clear: the step's drug is still to take. Running, and ending before the tick: an earlier
        // Xanax, the drug waits for it. Running past the tick: the drug is in.
        const drugDue = drugAt <= now;
        const drugSoon = !drugDue && drugAt < tick - MIN;
        const at = drugSoon ? drugAt : now;
        if (drugDue || drugSoon) {
            if (drugSoon) advance(at);
            if (s === 'candyXanax') {
                E = Math.min(ENERGY_CAP, E + ITEMS[XANAX].energy);
                H = Math.min(HAPPY_CAP, H + ITEMS[XANAX].happy);
            } else H = Math.min(HAPPY_CAP, H * ITEMS[ECSTASY].happyMult);
        }
        const takes = drugDue || drugSoon;
        const canTrain = E - keep >= minTrain;
        if (canTrain || refillLeft) {
            const label = takes ? (s === 'candyXanax' ? 'Xanax #' + xanN++ : 'Ecstasy') + (drugSoon ? ' at ' + clockOf(at) : ' now') + ', then train it all' : 'Train it all now';
            const note = (takes ? 'The boosters are in' : 'Your happy is boosted') + ': finish before the ' + clockOf(tick) + ' tick, when the happy resets';
            const acts = boostActions({ eat: boostName(), eaten: true, drug: drugName, drugDone: !takes, refill: refillLeft });
            if (canTrain) train(at, isJump ? 'jump' : 'boost', label, takes ? [{ id: s === 'candyXanax' ? XANAX : ECSTASY, qty: 1 }] : [], { strict: true, warnAt: now, tick, deadline: tick, mid: true, actions: acts.list, actionNow: acts.now, note });
            if (refillLeft) {
                refill(at + MIN, canTrain ? {} : { strict: true, warnAt: now, tick, deadline: tick, mid: true, note });
                refillLeft = false;
            }
            special(at + 2 * MIN);
            if (takes) drugAt = at + (s === 'candyXanax' ? xanCD : ecsCD);
            boosted = true;
            holding = false;
            midDone = true;
        }
    }

    if (isJump) {
        const stackTo = isConsole ? CONSOLE_STACK : JUMP_STACK;
        // Energy stops at 1,000 (round 7, B.1): what may stay in the bar under the stack (4 Xanax: nothing).
        const stackKeep = stackRoom(stackTo);
        // After a jump finished from the middle (above), the next stack starts from nothing.
        let stacked = midDone ? 0 : Math.min(stackTo, ctx.stackedSoFar || 0);
        for (let jumps = 0; jumps < 20; jumps++) {
            // Today's plan always shows the next jump in full; the look-ahead runs on to its end.
            if (jumps > 0 && (drugAt >= end || !lookAhead)) break;
            // The boost: its item and how many (the whole load, or the jump waits for room under the booster cap).
            const candyJump = s === 'chocoJump' || isConsole;
            const boostItem = candyJump ? candyId : EDVD;
            const want = candyJump ? candyQty() : ctx.edvdCount || (s === 'happy99k' ? boostersThatFit(EDVD, capH) : 5);
            const qty = Math.min(want, boostersThatFit(boostItem, capH, 0, cdMult));
            while (stacked < stackTo) {
                if (jumps > 0 && drugAt >= end) return steps.sort((a, b) => a.at - b.at);
                // Between a jump and the next stack (round 7, B.2; the simulator does the same: strategies.js):
                // natural energy is trained, at normal happy, down to what fits under the 1,000 cap with the stack
                // (4 Xanax: to empty). A bar that fills before the stack starts is trained then, so none is lost;
                // what is in the bar at the stack's first Xanax is trained just before it.
                if (stacked === 0 && stackKeep < maxE) {
                    for (let f = fullAt(); f < drugAt; f = fullAt()) {
                        rollDay(f);
                        advance(f);
                        const st = train(f, 'natural', 'Natural energy', [], {}, stackKeep);
                        if (!st.energy) {
                            steps.pop();
                            break;
                        }
                    }
                }
                rollDay(drugAt);
                advance(drugAt);
                if (stacked === 0) {
                    // No jump can land today and today's refill is unused: it goes in now, before the stack (once
                    // energy is stacked above the maximum a refill adds nothing). The bar is trained first, so the
                    // refill fills all of it. The simulator does the same (strategies.js).
                    const jumpFrom = Math.max(drugAt + stackTo * xanCD, ctx.holdBooster ? ctx.holdUntil || 0 : 0, roomFor(boostItem, qty));
                    const refillNow = refillLeft && jumpFrom >= curDay + DAY && refillGives();
                    const leave = refillNow ? 0 : stackKeep;
                    if (E - leave >= minTrain) {
                        const st = train(drugAt, 'natural', 'Train what’s in the bar', [], { note: 'before Xanax #1: energy stops at ' + ENERGY_CAP.toLocaleString('en-US') + (stackKeep ? '' : ', so ' + stackTo + ' Xanax need an empty bar') }, leave);
                        if (!st.energy) steps.pop();
                    }
                    if (refillNow) {
                        refill(drugAt, { note: 'before Xanax #1: no jump today, and a refill adds nothing once you stack' + (stackKeep ? ' · don’t train it: it stays in the bar for the jump' : '') }, stackKeep);
                        refillLeft = false;
                    }
                }
                E = Math.min(ENERGY_CAP, E + ITEMS[XANAX].energy);
                H += ITEMS[XANAX].happy;
                stacked++;
                steps.push({ id: 'stack-' + ++n, at: drugAt, kind: 'stack', label: 'Xanax #' + stacked + ' of ' + stackTo + ' · don\'t train', items: [{ id: XANAX, qty: 1 }], trains: {}, gyms: {}, gain: 0, energy: 0, strict: false, warnAt: null });
                drugAt += xanCD;
            }
            // The boost lands just after a quarter tick, once the drug cooldown allows the Ecstasy and the booster
            // cooldown has room for the whole boost (a jump is worth its full load). An event that boosts this
            // plan's items starts soon: the boost waits for it.
            const room = roomFor(boostItem, qty);
            // Ready within a few minutes after a tick (the Ecstasy's cooldown from the last jump ends then): the
            // boost goes at once, with ten minutes left of that tick's window (the simulator's rule: TICK_OFFSET_MIN).
            // Before, it waited for the next tick, so each jump drifted a quarter of an hour from the simulator's.
            const ready = Math.max(drugAt, ctx.holdBooster ? ctx.holdUntil || 0 : 0, room);
            const nextTick = nextQuarterTick(ready - 1);
            const lastTick = nextTick - 15 * MIN;
            const inWindow = nextTick !== ready && ready - lastTick <= TICK_OFFSET_MIN * MIN;
            const tick = inWindow ? lastTick : nextTick;
            const at = Math.max(ready, tick + MIN);
            if (jumps > 0 && at >= end) break;
            rollDay(at);
            advance(at);
            let items;
            let label;
            let note = at > tick + MIN ? 'At ' + clockOf(at) + ', in the window after the ' + clockOf(tick) + ' tick: finish before ' + clockOf(tick + 15 * MIN) : 'Right after the ' + clockOf(tick) + ' tick';
            if (room > drugAt) note += '; it waits for room under the ' + capH + ' h booster cap';
            note += '; no other boosters before it';
            const jp = jobPoints();
            if (isConsole) {
                // The Game Console's "Hardcore Game": 5 energy for 80–120 happy (×2 with the 5★ Toy/Game Shop "Gamer" perk),
                // then candy to the booster cap, the Ecstasy, train, refill, train (docs/research-console-jump.md).
                const uses = Math.min(CONSOLE_USES, Math.floor(E / CONSOLE_ENERGY_EACH));
                const each = CONSOLE_HAPPY_EACH * (s === 'consoleJumpToy' || ctx.toyShop5 ? 2 : 1);
                E -= uses * CONSOLE_ENERGY_EACH;
                const c = candyBoost(qty, at);
                H += uses * each + c.happy;
                items = [{ id: CONSOLE_ITEM, qty: 0, uses }, ...c.items];
                if (!ctx.consoleOwned) items.push({ id: CONSOLE_ITEM, qty: 1 });
                label = 'Game Console × ' + uses + ' (Hardcore) + ' + c.words + ' + Ecstasy, then train it all';
                note += '; the Xanax cooldown must be clear for the Ecstasy' + (ctx.consoleOwned ? '' : '; buy a Game Console first');
                if (c.note) note += '; ' + c.note;
            } else if (s === 'chocoJump') {
                const c = candyBoost(qty, at);
                H += c.happy;
                items = c.items;
                label = c.words + ' + Ecstasy, then train it all';
                if (c.note) note += '; ' + c.note;
            } else {
                H += qty * ITEMS[EDVD].happy * (ctx.adultNovelties10 || s === 'edvdJumpAN' ? 2 : 1);
                items = [{ id: EDVD, qty }];
                label = 'EDVD × ' + qty + ' + Ecstasy, then train it all';
                takeFromHeld(pool, fillFromPool(qty, EDVD, pool));
            }
            addBooster(boostItem, qty, at);
            if (jp.happy) {
                H += jp.happy;
                note += '; before the Ecstasy: ' + jp.words;
            }
            H = Math.min(HAPPY_CAP, H * ITEMS[ECSTASY].happyMult);
            items.push({ id: ECSTASY, qty: 1 });
            const acts = boostActions({ eat: label.split(' + Ecstasy')[0], jp: jp.happy ? jp.words : null, drug: 'Ecstasy', refill: refillLeft });
            const jump = train(at, 'jump', label, items, { strict: true, warnAt: tick - STRICT_WARN_MS, note, deadline: tick + 15 * MIN, actions: acts.list, actionNow: acts.now });
            jump.tick = tick;
            if (refillLeft) {
                refill(at + MIN);
                refillLeft = false;
            }
            special(at + 2 * MIN);
            drugAt = at + ecsCD;
            stacked = 0;
        }
        return steps.sort((a, b) => a.at - b.at);
    }

    // A daily candy boost can still happen today: the next Xanax (before midnight) finds room under the cap.
    const boostLater = (x) => x + xanCD < curDay + DAY && fitsAt(candyId, x + xanCD) > 0;
    // When the booster cooldown next has room for one candy (for the step's note).
    const candyRoomWords = () => {
        const at = roomFor(candyId, 1);
        return 'the booster cooldown is full; candy fits again at ' + (tornDayStart(at) > curDay ? 'tomorrow ' : '') + clockOf(at) + ' TCT';
    };
    for (let guard = 0; guard < 200; guard++) {
        if (daily && holding) {
            const tick = nextQuarterTick(drugAt - 1);
            const at = tick + MIN;
            if (at >= end && steps.length) break;
            rollDay(at);
            advance(at);
            const qty = Math.min(candyQty(), fitsAt(candyId, at));
            const c = qty > 0 ? candyBoost(qty, at) : { happy: 0, items: [], words: '', note: candyRoomWords() };
            const jp = jobPoints();
            H = Math.min(HAPPY_CAP, (H + c.happy + jp.happy) * ITEMS[ECSTASY].happyMult);
            if (qty > 0) addBooster(candyId, qty, at);
            const acts = boostActions({ eat: c.words || null, jp: jp.happy ? jp.words : null, drug: 'Ecstasy', refill: refillLeft });
            train(at, 'boost', (c.words ? c.words + ' + ' : '') + 'Ecstasy, then train it all', [...c.items, { id: ECSTASY, qty: 1 }], { strict: true, warnAt: tick - STRICT_WARN_MS, tick, deadline: tick + 15 * MIN, actions: acts.list, actionNow: acts.now, note: joinNote(jp.happy ? 'Before the Ecstasy: ' + jp.words : null, c.note) });
            if (refillLeft) {
                refill(at + MIN);
                refillLeft = false;
            }
            special(at + 2 * MIN);
            drugAt = at + ecsCD;
            boosted = true;
            holding = false;
            continue;
        }
        // Natural energy fills up before the next drug: train it then, so none is wasted.
        const full = fullAt();
        if (naturalOk && full < drugAt && full < end && maxE >= minTrain) {
            rollDay(full);
            advance(full);
            const st = train(full, 'natural', 'Natural energy', []);
            if (!st.energy) {
                steps.pop();
                naturalOk = false;
            } else if (refillLeft && xanN > xanCap && full + 5 * MIN < Math.min(end, curDay + DAY)) {
                // No Xanax left today (the small-budget plan): the day's refill goes right after this session, when energy is near zero.
                advance(full + 5 * MIN);
                refill(t);
                refillLeft = false;
            }
            continue;
        }
        if (drugAt >= end && steps.length) break;
        rollDay(drugAt);
        advance(drugAt);
        // The day's Xanax are taken (the small-budget plan): the next one waits for the next Torn day; natural
        // energy is trained as it fills meanwhile (the branch above).
        if (xanN > xanCap) {
            drugAt = curDay + DAY;
            if (drugAt >= end && !(naturalOk && fullAt() < end)) break;
            continue;
        }
        // A daily boost waits for room under the booster cap: until then its Xanax is a plain session.
        let waitNote = null;
        if (daily && !boosted) {
            const boostAt = nextQuarterTick(drugAt + xanCD - 1) + MIN;
            if (fitsAt(candyId, boostAt) > 0) {
                // The boost lands on a later Torn day: today's refill goes now, before the Xanax is held (a refill
                // during the hold would train the held energy).
                if (refillLeft && boostAt >= curDay + DAY && drugAt + MIN < Math.min(end, curDay + DAY)) {
                    refill(drugAt);
                    refillLeft = false;
                }
                E = Math.min(ENERGY_CAP, E + ITEMS[XANAX].energy);
                H += ITEMS[XANAX].happy;
                steps.push({ id: 'hold-' + ++n, at: drugAt, kind: 'hold', label: 'Xanax #' + xanN++ + ' · keep the energy for the boost', items: [{ id: XANAX, qty: 1 }], trains: {}, gyms: {}, gain: 0, energy: 0, strict: false, warnAt: null, note: 'no boosters until the boost' });
                holding = true;
                drugAt += xanCD;
                continue;
            }
            waitNote = 'No candy boost yet: ' + candyRoomWords();
        }
        if (candyDaily && !boosted) {
            // Wait for the tick (the Xanax energy isn't used until then), candy, then train it all.
            const tick = nextQuarterTick(drugAt - 1);
            const at = tick + MIN;
            const fits = fitsAt(candyId, at);
            if (fits > 0) {
                // The tick can fall after midnight: the boost (and its refill) then belong to the new Torn day.
                rollDay(at);
                advance(at);
                E = Math.min(ENERGY_CAP, E + ITEMS[XANAX].energy);
                H += ITEMS[XANAX].happy;
                const qty = Math.min(candyQty(), fits);
                const c = candyBoost(qty, at);
                const jp = jobPoints();
                H = Math.min(HAPPY_CAP, H + c.happy + jp.happy);
                addBooster(candyId, qty, at);
                const acts = boostActions({ eat: c.words, jp: jp.happy ? jp.words : null, drug: 'Xanax', refill: refillLeft });
                train(at, 'boost', c.words + ' + Xanax #' + xanN++ + ', then train it all', [...c.items, { id: XANAX, qty: 1 }], { strict: true, warnAt: tick - STRICT_WARN_MS, tick, deadline: tick + 15 * MIN, actions: acts.list, actionNow: acts.now, note: joinNote('Right after the ' + clockOf(tick) + ' tick' + (jp.happy ? '; with it: ' + jp.words : ''), c.note) });
                if (refillLeft) {
                    refill(at + MIN);
                    refillLeft = false;
                }
                special(at + 2 * MIN);
                boosted = true;
                drugAt = at + xanCD;
                continue;
            }
            waitNote = 'No candy with this one: ' + candyRoomWords();
        }
        E = Math.min(ENERGY_CAP, E + ITEMS[XANAX].energy);
        H += ITEMS[XANAX].happy;
        const items = [{ id: XANAX, qty: 1 }];
        let label = 'Xanax #' + xanN++;
        // Steady plans spend the job's banked happy points on the day's first Xanax session.
        let xNote = waitNote;
        if (!daily && !candyDaily && ctx.jobHappy && jpBank > 0) {
            const jp = jobPoints();
            if (jp.happy) {
                H += jp.happy;
                xNote = joinNote(xNote, 'Just before: ' + jp.words);
            }
        }
        if (blissEdvd) {
            const qty = fitsAt(EDVD, drugAt);
            if (qty > 0) {
                H = Math.min(HAPPY_CAP, H + qty * ITEMS[EDVD].happy * (ctx.adultNovelties10 ? 2 : 1));
                items.push({ id: EDVD, qty });
                label += ' + EDVD × ' + qty;
                addBooster(EDVD, qty, drugAt);
                takeFromHeld(pool, fillFromPool(qty, EDVD, pool));
            }
        }
        train(drugAt, 'xanax', label, items, xNote ? { note: xNote } : {});
        // The refill is worth most right after a session, when energy is near zero; a daily boost still to come today keeps it.
        const boostPending = (daily || candyDaily) && !boosted;
        if (refillLeft && drugAt + 5 * MIN < Math.min(end, curDay + DAY) && (!boostPending || !boostLater(drugAt))) {
            advance(drugAt + 5 * MIN);
            refill(t);
            refillLeft = false;
        }
        if (!daily && !candyDaily) special(t + MIN);
        if (eb) {
            // As many as the booster cooldown and the day's share allow, one after another (train after each).
            const it = ITEMS[eb.id];
            const at = t + MIN;
            let qty = 0;
            const boosterBefore = boosterAt;
            while (ebToday + qty < eb.perDay && boosterAt - at < capMs) {
                qty++;
                boosterAt = Math.max(boosterAt, at) + boosterHours(eb.id, cdMult) * HOUR;
            }
            if (qty > 0) {
                advance(at);
                // An FHC sets energy to the maximum (never above): one at a time, train after each.
                let used = true;
                if (it.toMax) {
                    used = Boolean(trainEach(at, 'booster', itemNameShort(eb.id) + ' × ' + qty + ', train after each', [{ id: eb.id, qty }], qty, {}, it.happy || 0));
                    if (used) takeFromHeld(pool, fillFromPool(qty, eb.id, pool));
                } else {
                    // Cans as a pool: the ones you hold first (the most energy first).
                    const f = fillPool(qty, eb.id);
                    E = Math.min(ENERGY_CAP, E + Math.round(f.value * (ctx.canMult || 1)));
                    const words = f.held ? fillWords(f, eb.id) : itemNameShort(eb.id) + ' × ' + qty;
                    train(at, 'booster', words + ', train after each', f.alloc.map((a) => ({ id: a.id, qty: a.qty })), f.held ? { note: heldWords(f) } : {});
                }
                if (used) ebToday += qty;
                else boosterAt = boosterBefore;
            }
        }
        drugAt += xanCD;
        if (drugAt >= end) {
            // Energy that comes in after the last drug of the day.
            const f = fullAt();
            if (naturalOk && f < end) {
                rollDay(f);
                advance(f);
                const st = train(f, 'natural', 'Natural energy', []);
                if (!st.energy) steps.pop();
            }
            break;
        }
    }
    // A refill still unused goes in before midnight.
    if (refillLeft && curDay + DAY <= end && !holding) {
        const at = Math.max(now, curDay + DAY - REFILL_LAST_CALL_MS);
        advance(at);
        refill(at, { note: 'Use before 00:00 Torn time' });
    }
    return steps.sort((a, b) => a.at - b.at);
}

function clockOf(t) {
    const d = new Date(t);
    return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}

/** Strict steps whose warning time has come (and whose own time hasn't passed). */
export function strictWarnings(steps, now) {
    return (steps || []).filter((s) => s.strict && s.warnAt !== null && now >= s.warnAt && now < s.at).map((s) => ({ stepId: s.id, at: s.at, text: 'In ' + Math.max(1, Math.ceil((s.at - now) / MIN)) + ' min: ' + s.label }));
}

/**
 * Items a list of steps uses, summed: {[itemId]: qty}. Special refills aren't bought; the Game Console
 * is (once) only when the player has none (its uses ride along with qty 0).
 */
export function itemsNeeded(steps) {
    const out = {};
    for (const s of steps || []) for (const it of s.items || []) if (it.id !== SPECIAL && it.qty > 0) out[it.id] = it.id === CONSOLE_ITEM ? 1 : (out[it.id] || 0) + it.qty;
    return out;
}

function itemNameShort(id) {
    const it = ITEMS[id];
    return it ? (it.short || it.name).replace(/^Can of /, '') : String(id);
}

/* ------------------------------------------------------------- done steps */

/**
 * The day's log of what was done, from state changes. `diff` is diffStates()
 * between the last two polls. A drug taken becomes the step it most likely
 * was (the next planned drug step); trains add to the latest entry, or to
 * a "Natural energy" entry when nothing else happened.
 */
export function logFromDiff(log, diff, { at, nextStep = null, catchUp = false }) {
    const out = (log || []).filter((e) => tornDayStart(e.at) === tornDayStart(at));
    const trained = diff && diff.trained ? diff.trained : {};
    const gain = STATS.reduce((a, k) => a + (trained[k] || 0), 0);
    // After a pause (Torn Trading ran): one entry for everything in between.
    if (catchUp && diff && (gain > 0 || diff.drugTaken || diff.refillUsed || diff.boosterUsed)) {
        out.push({ at, kind: 'catchup', label: catchUpLabel(trained, { drug: diff.drugTaken, booster: diff.boosterUsed, refill: diff.refillUsed }), trained: { ...trained }, gain, drug: Boolean(diff.drugTaken) });
        return out;
    }
    // Round 7: a boost or jump is logged when it is finished (its drug taken), not at its first sign. Its boosters eaten
    // with the drug still to take is noted as that ("boosting"), which is neither the boost done nor a drug taken: the
    // day plan keeps the step from the bars meanwhile. (It was logged as done at the candy, so the plan moved on.)
    const stepDrug = nextStep && (nextStep.kind === 'boost' || nextStep.kind === 'jump') && (nextStep.items || []).some((it) => it.id === XANAX || it.id === ECSTASY);
    if (diff && diff.boosterUsed && !diff.drugTaken && !diff.refillUsed && stepDrug && !nextStep.mid) {
        out.push({ at, kind: 'boosting', label: 'Boosters eaten · ' + nextStep.label, trained: { ...trained }, gain });
        return out;
    }
    if (diff && (diff.drugTaken || diff.refillUsed || diff.boosterUsed)) {
        const kind = diff.refillUsed && !diff.drugTaken ? 'refill' : nextStep && nextStep.kind !== 'natural' ? nextStep.kind : 'xanax';
        const label = diff.refillUsed && !diff.drugTaken ? 'Refill · ' + REFILL_POINTS + ' points' : nextStep && nextStep.kind !== 'natural' ? nextStep.label : 'Xanax';
        // `xanax`: this step's drug was a Xanax (a candy + Xanax boost carries one): it counts in the day's Xanax.
        const xanax = Boolean(diff.drugTaken && nextStep && (nextStep.items || []).some((it) => it.id === XANAX));
        out.push({ at, kind, label, trained: { ...trained }, gain, ...(xanax && kind !== 'xanax' && kind !== 'stack' && kind !== 'hold' ? { xanax: true } : {}) });
        return out;
    }
    if (gain > 0) {
        const last = out[out.length - 1];
        if (last && at - last.at < 30 * MIN) {
            for (const k of STATS) if (trained[k]) last.trained[k] = (last.trained[k] || 0) + trained[k];
            last.gain += gain;
        } else {
            out.push({ at, kind: 'natural', label: 'Natural energy', trained: { ...trained }, gain });
        }
    }
    return out;
}

/** Drugs taken so far today, from the log (numbers the next Xanax; a held Xanax counts too). */
export function drugsToday(log, now) {
    return (log || []).filter((e) => tornDayStart(e.at) === tornDayStart(now) && (e.kind === 'xanax' || e.kind === 'stack' || e.kind === 'hold' || e.xanax === true || (e.kind === 'catchup' && e.drug))).length;
}
