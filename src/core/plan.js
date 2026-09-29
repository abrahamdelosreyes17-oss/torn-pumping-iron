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
import { STRATEGIES, JUMP_STACK, SPECIAL, CONSOLE_STACK, CONSOLE_USES, CONSOLE_ENERGY_EACH, CONSOLE_HAPPY_EACH, CONSOLE_ITEM } from './strategies.js';
import { spendJobPoints, jobHappyWords } from './jobs.js';
import { HAPPY_CAP, HAPPY_LOSS_PER_ENERGY } from './gain.js';
import { catchUpLabel } from './turns.js';
import { fillFromPool, takeFromHeld, fillWords, heldWords, tierWords } from './candy.js';

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
 *   toyShop5, adultNovelties10}
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
    const train = (at, kind, label, items, extra = {}) => {
        // A faction war (Settings › Keep for war days): never train below the energy kept for it.
        const keep = Math.max(0, Math.min(E, ctx.keepEnergy || 0));
        const split = sessionGain(ctx, stats, E - keep, H, happyMax);
        stats = split.statsAfter;
        const step = { id: kind + '-' + ++n, at, kind, label, items, trains: trainsOf(split), gyms: gymsOf(split), parts: partsOf(split), gain: Math.round(split.gain), energy: split.energyUsed, strict: false, warnAt: null, ...extra };
        if (step.note === undefined) delete step.note;
        if (keep > 0) step.note = (step.note ? step.note + ' · ' : '') + 'keeps ' + keep + ' energy for the war';
        E = split.energyLeft + keep;
        H = split.happyAfter;
        steps.push(step);
        return step;
    };
    const fullAt = () => (E >= maxE ? t : t + Math.ceil((maxE - E) / inc) * interval);
    // A refill (points or special) or an FHC sets energy to the maximum, never above it (O2): `qty` of them are
    // used one at a time, each once the last is trained, and shown as one step.
    const trainEach = (at, kind, label, items, qty, extra = {}, happyEach = 0) => {
        const keep = Math.max(0, ctx.keepEnergy || 0);
        // Energy kept for a war fills the bar on its own: a refill or FHC then adds nothing, so none is planned (or bought).
        if (keep >= maxE && E >= maxE) return null;
        const first = steps.length;
        // A full bar is trained first: a refill or FHC only fills up to the maximum.
        if (E >= maxE && E - keep >= minTrain) train(at, kind, label, items, extra);
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
        if (!trainEach(at, 'special', 'Special refills × ' + qty + ', train after each', [{ id: SPECIAL, qty }], qty, { note: 'free: they come with your account · each fills energy to ' + maxE + ', never above' })) {
            shareLeft += qty;
            return;
        }
        specialLeft -= qty;
        heldLeft = Math.max(0, heldLeft - qty);
    };
    // The day's refill: a special while any are held (never both on one day), else 30 points.
    const refill = (at, extra = {}) => {
        if (Math.max(0, ctx.keepEnergy || 0) >= maxE && E >= maxE) return null;
        if (heldLeft > 0) {
            heldLeft--;
            specialLeft = Math.min(specialLeft, heldLeft);
            return trainEach(at, 'refill', 'Special refill (instead of the points refill)', [{ id: SPECIAL, qty: 1 }], 1, { ...extra, note: 'Torn lets you use the points refill only once your special refills are spent [1 source]' });
        }
        // Not worth its price under the Plan rule (the comparison decided): the points refill is left out.
        if (ctx.noRefill) return null;
        return trainEach(at, 'refill', 'Refill · ' + REFILL_POINTS + ' points', [{ id: POINTS, qty: REFILL_POINTS }], 1, extra);
    };
    const candyMult = ctx.candyMult || 1;
    const candyId = ctx.candyId && ITEMS[ctx.candyId] ? ctx.candyId : CANDY_KISSES;
    const candyQty = () => ctx.candyCount || boostersThatFit(candyId, capH, 0, cdMult);
    // A candy boost of `qty`, from what you hold first: the happy, the items, the words and the note.
    const candyBoost = (qty) => {
        const f = fillPool(qty, candyId);
        const planned = candyQty();
        const notes = [heldWords(f), qty < planned ? 'the booster cooldown has room for ' + qty + ' of ' + planned : null, tierWords(candyId) || null].filter(Boolean);
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

    // A new Torn day: its refill (today's, if unused, goes in before midnight), Xanax count, boost and share.
    const rollDay = (at) => {
        while (tornDayStart(at) > curDay) {
            if (refillLeft && !isJump) {
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

    if (isJump) {
        const stackTo = isConsole ? CONSOLE_STACK : JUMP_STACK;
        let stacked = Math.min(stackTo, ctx.stackedSoFar || 0);
        for (let jumps = 0; jumps < 20; jumps++) {
            // Today's plan always shows the next jump in full; the look-ahead runs on to its end.
            if (jumps > 0 && (drugAt >= end || !lookAhead)) break;
            while (stacked < stackTo) {
                if (jumps > 0 && drugAt >= end) return steps.sort((a, b) => a.at - b.at);
                rollDay(drugAt);
                advance(drugAt);
                E += ITEMS[XANAX].energy;
                H += ITEMS[XANAX].happy;
                stacked++;
                steps.push({ id: 'stack-' + ++n, at: drugAt, kind: 'stack', label: 'Xanax #' + stacked + ' of ' + stackTo + ' · don\'t train', items: [{ id: XANAX, qty: 1 }], trains: {}, gyms: {}, gain: 0, energy: 0, strict: false, warnAt: null });
                drugAt += xanCD;
            }
            // The boost lands just after a quarter tick, once the drug cooldown allows the Ecstasy and the booster
            // cooldown has room for the whole boost (a jump is worth its full load). An event that boosts this
            // plan's items starts soon: the boost waits for it.
            const candyJump = s === 'chocoJump' || isConsole;
            const boostItem = candyJump ? candyId : EDVD;
            const want = candyJump ? candyQty() : ctx.edvdCount || (s === 'happy99k' ? boostersThatFit(EDVD, capH) : 5);
            const qty = Math.min(want, boostersThatFit(boostItem, capH, 0, cdMult));
            const room = roomFor(boostItem, qty);
            const tick = nextQuarterTick(Math.max(drugAt, ctx.holdBooster ? ctx.holdUntil || 0 : 0, room) - 1);
            const at = tick + MIN;
            if (jumps > 0 && at >= end) break;
            rollDay(at);
            advance(at);
            let items;
            let label;
            let note = 'Right after the ' + clockOf(tick) + ' tick';
            if (room > drugAt) note += '; it waits for room under the ' + capH + ' h booster cap';
            note += '; no other boosters before it';
            const jp = jobPoints();
            if (isConsole) {
                // The Game Console's "Hardcore Game": 5 energy for 80–120 happy (×2 with the 5★ Toy/Game Shop "Gamer" perk),
                // then candy to the booster cap, the Ecstasy, train, refill, train (docs/research-console-jump.md).
                const uses = Math.min(CONSOLE_USES, Math.floor(E / CONSOLE_ENERGY_EACH));
                const each = CONSOLE_HAPPY_EACH * (s === 'consoleJumpToy' || ctx.toyShop5 ? 2 : 1);
                E -= uses * CONSOLE_ENERGY_EACH;
                const c = candyBoost(qty);
                H += uses * each + c.happy;
                items = [{ id: CONSOLE_ITEM, qty: 0, uses }, ...c.items];
                if (!ctx.consoleOwned) items.push({ id: CONSOLE_ITEM, qty: 1 });
                label = 'Game Console × ' + uses + ' (Hardcore) + ' + c.words + ' + Ecstasy, then train it all';
                note += '; the Xanax cooldown must be clear for the Ecstasy' + (ctx.consoleOwned ? '' : '; buy a Game Console first');
                if (c.note) note += '; ' + c.note;
            } else if (s === 'chocoJump') {
                const c = candyBoost(qty);
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
            const jump = train(at, 'jump', label, items, { strict: true, warnAt: tick - STRICT_WARN_MS, note });
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
            const c = qty > 0 ? candyBoost(qty) : { happy: 0, items: [], words: '', note: candyRoomWords() };
            const jp = jobPoints();
            H = Math.min(HAPPY_CAP, (H + c.happy + jp.happy) * ITEMS[ECSTASY].happyMult);
            if (qty > 0) addBooster(candyId, qty, at);
            train(at, 'boost', (c.words ? c.words + ' + ' : '') + 'Ecstasy, then train it all', [...c.items, { id: ECSTASY, qty: 1 }], { strict: true, warnAt: tick - STRICT_WARN_MS, tick, note: joinNote(jp.happy ? 'Before the Ecstasy: ' + jp.words : null, c.note) });
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
            }
            continue;
        }
        if (drugAt >= end && steps.length) break;
        rollDay(drugAt);
        advance(drugAt);
        // A daily boost waits for room under the booster cap: until then its Xanax is a plain session.
        let waitNote = null;
        if (daily && !boosted) {
            const boostAt = nextQuarterTick(drugAt + xanCD - 1) + MIN;
            if (fitsAt(candyId, boostAt) > 0) {
                E += ITEMS[XANAX].energy;
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
                advance(at);
                E += ITEMS[XANAX].energy;
                H += ITEMS[XANAX].happy;
                const qty = Math.min(candyQty(), fits);
                const c = candyBoost(qty);
                const jp = jobPoints();
                H = Math.min(HAPPY_CAP, H + c.happy + jp.happy);
                addBooster(candyId, qty, at);
                train(at, 'boost', c.words + ' + Xanax #' + xanN++ + ', then train it all', [...c.items, { id: XANAX, qty: 1 }], { strict: true, warnAt: tick - STRICT_WARN_MS, tick, note: joinNote('Right after the ' + clockOf(tick) + ' tick' + (jp.happy ? '; with it: ' + jp.words : ''), c.note) });
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
        E += ITEMS[XANAX].energy;
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
                    E += Math.round(f.value * (ctx.canMult || 1));
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
    if (refillLeft && curDay + DAY <= end) {
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
