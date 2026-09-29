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
import { XANAX, ECSTASY, EDVD, FHC, CANDY_KISSES, POINTS, REFILL_POINTS, ITEMS, XANAX_CD_MIN, ECSTASY_CD_MIN, BOOSTER_CAP_H, boostersThatFit, itemName } from './items.js';
import { STRATEGIES, JUMP_STACK, SPECIAL, CONSOLE_STACK, CONSOLE_USES, CONSOLE_ENERGY_EACH, CONSOLE_HAPPY_EACH, CONSOLE_ITEM } from './strategies.js';
import { spendJobPoints, jobHappyWords } from './jobs.js';
import { HAPPY_CAP, HAPPY_LOSS_PER_ENERGY } from './gain.js';
import { catchUpLabel } from './turns.js';

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
 *   xanaxCdMin, ecstasyCdMin, candyId, candyCount, edvdCount, boosterCapH, stackedSoFar, drugsToday,
 *   specialLeft (special refills the plan may still use), energyBooster {id, perDay} (steadyBoost),
 *   holdBooster (an event that needs the booster cooldown is near: no boosters), candyMult, canMult,
 *   toyShop5, adultNovelties10}
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
    // A drug step skipped in Discord moves the next one to the cooldown that would have followed it.
    let drugAt = Math.max(now, drugFreeAt(state), ctx.drugNotBefore || 0);
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
    // A refill (points or special) or an FHC sets energy to the maximum, never above it (O2): `qty` of them are
    // used one at a time, each once the last is trained, and shown as one step.
    const trainEach = (at, kind, label, items, qty, extra = {}, happyEach = 0) => {
        const first = steps.length;
        for (let i = 0; i < qty; i++) {
            E = Math.max(E, maxE);
            H += happyEach;
            train(at, kind, label, items, extra);
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
        trainEach(at, 'special', 'Special refills × ' + qty + ', train after each', [{ id: SPECIAL, qty }], qty, { note: 'free: they come with your account · each fills energy to ' + maxE + ', never above' });
        specialLeft -= qty;
        heldLeft = Math.max(0, heldLeft - qty);
    };
    // The day's refill: a special while any are held (never both on one day), else 30 points.
    const refill = (at, extra = {}) => {
        if (heldLeft > 0) {
            heldLeft--;
            specialLeft = Math.min(specialLeft, heldLeft);
            return trainEach(at, 'refill', 'Special refill (instead of the points refill)', [{ id: SPECIAL, qty: 1 }], 1, { ...extra, note: 'Torn lets you use the points refill only once your special refills are spent [1 source]' });
        }
        return trainEach(at, 'refill', 'Refill · ' + REFILL_POINTS + ' points', [{ id: POINTS, qty: REFILL_POINTS }], 1, extra);
    };
    const candyMult = ctx.candyMult || 1;
    const candyId = ctx.candyId && ITEMS[ctx.candyId] ? ctx.candyId : CANDY_KISSES;
    const candyQty = () => ctx.candyCount || boostersThatFit(candyId, ctx.boosterCapH || BOOSTER_CAP_H, 0, ctx.cdMult || 1);
    const candyName = itemName(candyId);
    // Job points banked where the player works: happy specials spent in the boosted session.
    let jpBank = ctx.jobHappy ? Math.max(0, Number(ctx.jobHappy.bank) || 0) : 0;
    const jobPoints = () => {
        if (!ctx.jobHappy) return { happy: 0, jp: 0, words: '' };
        const r = spendJobPoints(ctx.jobHappy, jpBank);
        jpBank -= r.jp;
        return { ...r, words: r.jp ? jobHappyWords(ctx.jobHappy, r.jp) : '' };
    };

    const s = STRATEGIES[strategy] ? strategy : 'steady';
    const isConsole = s === 'consoleJump' || s === 'consoleJumpToy';

    if (s === 'chocoJump' || s === 'edvdJump' || s === 'happy99k' || s === 'edvdJumpAN' || isConsole) {
        const stackTo = isConsole ? CONSOLE_STACK : JUMP_STACK;
        let stacked = Math.min(stackTo, ctx.stackedSoFar || 0);
        while (stacked < stackTo) {
            advance(drugAt);
            E += ITEMS[XANAX].energy;
            H += ITEMS[XANAX].happy;
            stacked++;
            steps.push({ id: 'stack-' + ++n, at: drugAt, kind: 'stack', label: 'Xanax #' + stacked + ' of ' + stackTo + ' · don\'t train', items: [{ id: XANAX, qty: 1 }], trains: {}, gyms: {}, gain: 0, energy: 0, strict: false, warnAt: null });
            drugAt += xanCD;
        }
        // The boost lands just after a quarter tick, once the drug cooldown allows the Ecstasy.
        // An event that boosts this plan's items starts soon: the boost waits for it.
        const tick = nextQuarterTick(Math.max(drugAt, ctx.holdBooster ? ctx.holdUntil || 0 : 0) - 1);
        const at = tick + MIN;
        advance(at);
        const capH = ctx.boosterCapH || BOOSTER_CAP_H;
        let items;
        let label;
        let note = 'Right after the ' + clockOf(tick) + ' tick';
        const jp = jobPoints();
        if (isConsole) {
            // The Game Console's "Hardcore Game": 5 energy for 80–120 happy (×2 with the 5★ Toy/Game Shop "Gamer" perk),
            // then candy to the booster cap, the Ecstasy, train, refill, train (docs/research-console-jump.md).
            const uses = Math.min(CONSOLE_USES, Math.floor(E / CONSOLE_ENERGY_EACH));
            const each = CONSOLE_HAPPY_EACH * (s === 'consoleJumpToy' || ctx.toyShop5 ? 2 : 1);
            E -= uses * CONSOLE_ENERGY_EACH;
            const qty = candyQty();
            H += uses * each + qty * ITEMS[candyId].happy * candyMult;
            items = [{ id: CONSOLE_ITEM, qty: 0, uses }, { id: candyId, qty }];
            if (!ctx.consoleOwned) items.push({ id: CONSOLE_ITEM, qty: 1 });
            label = 'Game Console × ' + uses + ' (Hardcore) + ' + candyName + ' × ' + qty + ' + Ecstasy, then train it all';
            note += '; the Xanax cooldown must be clear for the Ecstasy' + (ctx.consoleOwned ? '' : '; buy a Game Console first');
        } else if (s === 'chocoJump') {
            const qty = candyQty();
            H += qty * ITEMS[candyId].happy * candyMult;
            items = [{ id: candyId, qty }];
            label = candyName + ' × ' + qty + ' + Ecstasy, then train it all';
        } else {
            const qty = ctx.edvdCount || (s === 'happy99k' ? boostersThatFit(EDVD, capH) : 5);
            H += qty * ITEMS[EDVD].happy * (ctx.adultNovelties10 || s === 'edvdJumpAN' ? 2 : 1);
            items = [{ id: EDVD, qty }];
            label = 'EDVD × ' + qty + ' + Ecstasy, then train it all';
        }
        if (jp.happy) {
            H += jp.happy;
            note += '; before the Ecstasy: ' + jp.words;
        }
        H = Math.min(HAPPY_CAP, H * ITEMS[ECSTASY].happyMult);
        items.push({ id: ECSTASY, qty: 1 });
        const jump = train(at, 'jump', label, items, { strict: true, warnAt: tick - STRICT_WARN_MS, note });
        jump.tick = tick;
        if (refillLeft) {
            refill(at + MIN);
            refillLeft = false;
        }
        special(at + 2 * MIN);
        drugAt = at + ecsCD;
        return steps;
    }

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
    const capMs = (ctx.boosterCapH || BOOSTER_CAP_H) * HOUR;
    const edvdMs = ITEMS[EDVD].boosterH * HOUR;
    let boosterAt = Math.max(now, boosterFreeAt(state));
    let boosted = Boolean(ctx.boostedToday);
    let holding = Boolean(ctx.holding);
    let naturalOk = true;
    for (let guard = 0; guard < 50; guard++) {
        if (daily && holding) {
            const tick = nextQuarterTick(drugAt - 1);
            const at = tick + MIN;
            if (at >= end && steps.length) break;
            advance(at);
            const qty = candyQty();
            const jp = jobPoints();
            H = Math.min(HAPPY_CAP, (H + qty * ITEMS[candyId].happy * candyMult + jp.happy) * ITEMS[ECSTASY].happyMult);
            train(at, 'boost', candyName + ' × ' + qty + ' + Ecstasy, then train it all', [{ id: candyId, qty }, { id: ECSTASY, qty: 1 }], { strict: true, warnAt: tick - STRICT_WARN_MS, tick, ...(jp.happy ? { note: 'Before the Ecstasy: ' + jp.words } : {}) });
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
        if (candyDaily && !boosted) {
            // Wait for the tick (the Xanax energy isn't used until then), candy, then train it all.
            const tick = nextQuarterTick(drugAt - 1);
            const at = tick + MIN;
            advance(at);
            const qty = candyQty();
            const jp = jobPoints();
            H = Math.min(HAPPY_CAP, H + qty * ITEMS[candyId].happy * candyMult + jp.happy);
            train(at, 'boost', candyName + ' × ' + qty + ' + Xanax #' + xanN++ + ', then train it all', [{ id: candyId, qty }, { id: XANAX, qty: 1 }], { strict: true, warnAt: tick - STRICT_WARN_MS, tick, note: 'Right after the ' + clockOf(tick) + ' tick' + (jp.happy ? '; with it: ' + jp.words : '') });
            if (refillLeft) {
                refill(at + MIN);
                refillLeft = false;
            }
            special(at + 2 * MIN);
            boosted = true;
            drugAt = at + xanCD;
            continue;
        }
        const items = [{ id: XANAX, qty: 1 }];
        let label = 'Xanax #' + xanN++;
        // Steady plans spend the job's banked happy points on the day's first Xanax session.
        let xNote = null;
        if (!daily && !candyDaily && ctx.jobHappy && jpBank > 0) {
            const jp = jobPoints();
            if (jp.happy) {
                H += jp.happy;
                xNote = 'Just before: ' + jp.words;
            }
        }
        if (blissEdvd) {
            const qty = Math.floor((capMs - Math.max(0, boosterAt - drugAt)) / edvdMs);
            if (qty > 0) {
                H = Math.min(HAPPY_CAP, H + qty * ITEMS[EDVD].happy * (ctx.adultNovelties10 ? 2 : 1));
                items.push({ id: EDVD, qty });
                label += ' + EDVD × ' + qty;
                boosterAt = Math.max(boosterAt, drugAt) + qty * edvdMs;
            }
        }
        train(drugAt, 'xanax', label, items, xNote ? { note: xNote } : {});
        // The refill is worth most right after a session, when energy is near zero.
        if (refillLeft && !daily && drugAt + 5 * MIN < end) {
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
            while (ebToday + qty < eb.perDay && boosterAt - at < capMs) {
                qty++;
                boosterAt = Math.max(boosterAt, at) + it.boosterH * HOUR;
            }
            if (qty > 0) {
                advance(at);
                // An FHC sets energy to the maximum (never above): one at a time, train after each.
                if (it.toMax) trainEach(at, 'booster', itemNameShort(eb.id) + ' × ' + qty + ', train after each', [{ id: eb.id, qty }], qty, {}, it.happy || 0);
                else {
                    E += qty * Math.round(it.energy * (ctx.canMult || 1));
                    train(at, 'booster', itemNameShort(eb.id) + ' × ' + qty + ', train after each', [{ id: eb.id, qty }]);
                }
                ebToday += qty;
            }
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

/** Drugs taken so far today, from the log (numbers the next Xanax; a held Xanax counts too). */
export function drugsToday(log, now) {
    return (log || []).filter((e) => tornDayStart(e.at) === tornDayStart(now) && (e.kind === 'xanax' || e.kind === 'stack' || e.kind === 'hold' || (e.kind === 'catchup' && e.drug))).length;
}
