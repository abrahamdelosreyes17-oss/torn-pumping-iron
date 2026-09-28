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
import { energyAt, happyAt, drugFreeAt, refillAvailable, tornDayStart, nextQuarterTick, DAY, MIN, HOUR } from './bars.js';
import { XANAX, ECSTASY, EDVD, CANDY_KISSES, POINTS, REFILL_POINTS, ITEMS, XANAX_CD_MIN, ECSTASY_CD_MIN, BOOSTER_CAP_H, boostersThatFit } from './items.js';
import { STRATEGIES, JUMP_STACK } from './strategies.js';
import { HAPPY_CAP } from './gain.js';

export const PLAN_TYPES = ['steady', 'goal', 'jump'];

/** Strict steps warn this long before their time. */
export const STRICT_WARN_MS = 5 * MIN;

/** An unused refill is flagged this long before Torn midnight. */
export const REFILL_WARN_MS = 2 * HOUR;

/** A refill the plan couldn't place earlier goes this long before midnight. */
export const REFILL_LAST_CALL_MS = 30 * MIN;

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

function sessionGain(ctx, stats, energy, happy) {
    return splitSession({
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

/**
 * The day's remaining steps, worked out from the live state.
 *
 * @param {object} o
 * @param {object} o.state - normalizeState() output
 * @param {number} o.now
 * @param {string} o.strategy
 * @param {object} o.ctx - {shares, unlocked, perks, keep, active, table, bliss, happyLossMult,
 *   xanaxCdMin, ecstasyCdMin, candyId, candyCount, edvdCount, boosterCapH, stackedSoFar, drugsToday}
 * @param {number} [o.until] - end of the window (default: the next Torn midnight)
 * @returns {object[]} steps {id, at, kind, label, items:[{id,qty}], trains:{}, gyms:{}, gain, energy, strict, warnAt, note}
 */
export function dayTimeline({ state, now, strategy, ctx, until = null }) {
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
    let drugAt = Math.max(now, drugFreeAt(state));
    let refillLeft = refillAvailable(state, now);
    let xanN = (ctx.drugsToday || 0) + 1;
    const steps = [];
    let n = 0;

    // Natural regeneration from t to t2 (none above the maximum), and happy back up.
    const advance = (t2) => {
        if (t2 <= t) return;
        if (E < maxE) E = Math.min(maxE, E + inc * Math.floor((t2 - t) / interval));
        if (!bliss && H > happyMax) H = nextQuarterTick(t) <= t2 ? happyMax : H;
        else if (H < (bliss ? HAPPY_CAP : happyMax)) H = Math.min(bliss ? HAPPY_CAP : happyMax, H + 5 * Math.floor((t2 - t) / (15 * MIN)));
        t = t2;
    };
    const train = (at, kind, label, items, extra = {}) => {
        const split = sessionGain(ctx, stats, E, H);
        stats = split.statsAfter;
        const step = { id: kind + '-' + ++n, at, kind, label, items, trains: trainsOf(split), gyms: gymsOf(split), gain: Math.round(split.gain), energy: split.energyUsed, strict: false, warnAt: null, ...extra };
        E = split.energyLeft;
        H = split.happyAfter;
        steps.push(step);
        return step;
    };
    const fullAt = () => (E >= maxE ? t : t + Math.ceil((maxE - E) / inc) * interval);

    const s = STRATEGIES[strategy] ? strategy : 'steady';

    if (s === 'chocoJump' || s === 'edvdJump' || s === 'happy99k') {
        let stacked = ctx.stackedSoFar || 0;
        while (stacked < JUMP_STACK) {
            advance(drugAt);
            E += ITEMS[XANAX].energy;
            H += ITEMS[XANAX].happy;
            stacked++;
            steps.push({ id: 'stack-' + ++n, at: drugAt, kind: 'stack', label: 'Xanax #' + stacked + ' of ' + JUMP_STACK + ' · don\'t train', items: [{ id: XANAX, qty: 1 }], trains: {}, gyms: {}, gain: 0, energy: 0, strict: false, warnAt: null });
            drugAt += xanCD;
        }
        // The boost lands just after a quarter tick, once the drug cooldown allows the Ecstasy.
        const tick = nextQuarterTick(drugAt - 1);
        const at = tick + MIN;
        advance(at);
        const capH = ctx.boosterCapH || BOOSTER_CAP_H;
        let items;
        if (s === 'chocoJump') {
            const candyId = ctx.candyId || CANDY_KISSES;
            const qty = ctx.candyCount || boostersThatFit(candyId, capH);
            H += qty * ITEMS[candyId].happy;
            items = [{ id: candyId, qty }];
        } else {
            const qty = ctx.edvdCount || (s === 'happy99k' ? boostersThatFit(EDVD, capH) : 5);
            H += qty * ITEMS[EDVD].happy * (ctx.adultNovelties10 ? 2 : 1);
            items = [{ id: EDVD, qty }];
        }
        H = Math.min(HAPPY_CAP, H * ITEMS[ECSTASY].happyMult);
        items.push({ id: ECSTASY, qty: 1 });
        const label = (s === 'chocoJump' ? 'Candy × ' + items[0].qty : 'EDVD × ' + items[0].qty) + ' + Ecstasy, then train it all';
        const jump = train(at, 'jump', label, items, { strict: true, warnAt: tick - STRICT_WARN_MS, note: 'Right after the ' + clockOf(tick) + ' tick' });
        jump.tick = tick;
        if (refillLeft) {
            E += Math.max(0, maxE - E);
            train(at + MIN, 'refill', 'Refill · ' + REFILL_POINTS + ' points', [{ id: POINTS, qty: REFILL_POINTS }]);
            refillLeft = false;
        }
        drugAt = at + ecsCD;
        return steps;
    }

    // Daily choco: one Xanax a day is held (its energy kept, not trained); at
    // its cooldown end, candy + Ecstasy just after a tick, train it all, refill.
    const daily = s === 'dailyChoco';
    let boosted = Boolean(ctx.boostedToday);
    let holding = Boolean(ctx.holding);
    let naturalOk = true;
    for (let guard = 0; guard < 50; guard++) {
        if (daily && holding) {
            const tick = nextQuarterTick(drugAt - 1);
            const at = tick + MIN;
            if (at >= end && steps.length) break;
            advance(at);
            const candyId = ctx.candyId || CANDY_KISSES;
            const qty = ctx.candyCount || boostersThatFit(candyId, ctx.boosterCapH || BOOSTER_CAP_H);
            H = Math.min(HAPPY_CAP, (H + qty * ITEMS[candyId].happy) * ITEMS[ECSTASY].happyMult);
            train(at, 'boost', 'Candy × ' + qty + ' + Ecstasy, then train it all', [{ id: candyId, qty }, { id: ECSTASY, qty: 1 }], { strict: true, warnAt: tick - STRICT_WARN_MS, tick });
            if (refillLeft) {
                E += Math.max(0, maxE - E);
                train(at + MIN, 'refill', 'Refill · ' + REFILL_POINTS + ' points', [{ id: POINTS, qty: REFILL_POINTS }]);
                refillLeft = false;
            }
            drugAt = at + ecsCD;
            boosted = true;
            holding = false;
            continue;
        }
        // Natural energy fills up before the next drug: train it then, so none is wasted.
        const full = fullAt();
        if (naturalOk && full < drugAt && full < end && maxE >= minTrain) {
            advance(full);
            const st = train(full, 'natural', 'Natural energy', []);
            if (!st.energy) {
                steps.pop();
                naturalOk = false;
            }
            continue;
        }
        if (drugAt >= end && steps.length) break;
        advance(drugAt);
        E += ITEMS[XANAX].energy;
        H += ITEMS[XANAX].happy;
        if (daily && !boosted) {
            steps.push({ id: 'hold-' + ++n, at: drugAt, kind: 'hold', label: 'Xanax #' + xanN++ + ' · keep the energy for the boost', items: [{ id: XANAX, qty: 1 }], trains: {}, gyms: {}, gain: 0, energy: 0, strict: false, warnAt: null });
            holding = true;
            drugAt += xanCD;
            continue;
        }
        train(drugAt, 'xanax', 'Xanax #' + xanN++, [{ id: XANAX, qty: 1 }]);
        // The refill is worth most right after a session, when energy is near zero.
        if (refillLeft && !daily && drugAt + 5 * MIN < end) {
            advance(drugAt + 5 * MIN);
            E += Math.max(0, maxE - E);
            train(t, 'refill', 'Refill · ' + REFILL_POINTS + ' points', [{ id: POINTS, qty: REFILL_POINTS }]);
            refillLeft = false;
        }
        drugAt += xanCD;
        if (drugAt >= end) {
            // Energy that comes in after the last drug of the day.
            const f = fullAt();
            if (naturalOk && f < end) {
                advance(f);
                const st = train(f, 'natural', 'Natural energy', []);
                if (!st.energy) steps.pop();
            }
            break;
        }
    }
    // A refill still unused goes in before midnight.
    if (refillLeft) {
        const at = Math.max(now, end - REFILL_LAST_CALL_MS);
        advance(at);
        E += Math.max(0, maxE - E);
        train(at, 'refill', 'Refill · ' + REFILL_POINTS + ' points', [{ id: POINTS, qty: REFILL_POINTS }], { note: 'Use before 00:00 Torn time' });
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

/** Items a list of steps uses, summed: {[itemId]: qty}. */
export function itemsNeeded(steps) {
    const out = {};
    for (const s of steps || []) for (const it of s.items || []) out[it.id] = (out[it.id] || 0) + it.qty;
    return out;
}

/* ------------------------------------------------------------- done steps */

/**
 * The day's log of what was done, from state changes. `diff` is diffStates()
 * between the last two polls. A drug taken becomes the step it most likely
 * was (the next planned drug step); trains add to the latest entry, or to
 * a "Natural energy" entry when nothing else happened.
 */
export function logFromDiff(log, diff, { at, nextStep = null }) {
    const out = (log || []).filter((e) => tornDayStart(e.at) === tornDayStart(at));
    const trained = diff && diff.trained ? diff.trained : {};
    const gain = STATS.reduce((a, k) => a + (trained[k] || 0), 0);
    if (diff && (diff.drugTaken || diff.refillUsed || diff.boosterUsed)) {
        const kind = diff.refillUsed && !diff.drugTaken ? 'refill' : nextStep && nextStep.kind !== 'natural' ? nextStep.kind : 'xanax';
        const label = diff.refillUsed && !diff.drugTaken ? 'Refill · ' + REFILL_POINTS + ' points' : nextStep && nextStep.kind !== 'natural' ? nextStep.label : 'Xanax';
        out.push({ at, kind, label, trained: { ...trained }, gain });
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

/** Drugs taken so far today, from the log (numbers the next Xanax). */
export function drugsToday(log, now) {
    return (log || []).filter((e) => tornDayStart(e.at) === tornDayStart(now) && (e.kind === 'xanax' || e.kind === 'stack')).length;
}
