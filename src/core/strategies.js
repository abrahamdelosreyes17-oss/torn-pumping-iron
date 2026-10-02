/*
 * The training strategies as event simulators over N days, in 5-minute
 * steps (the model of docs/sims/sim30.mjs, generalised to four stats and
 * specialist gyms). Pure. ENGINE-SPEC §4.
 *
 * Each strategy decides when drugs, boosters and the refill are used; every
 * train in between goes through one trainer (one stat, or greedy toward a
 * build's shares), so strategies compare like for like.
 */

import { STATS, STAT_LABEL, gainPerTrain, HAPPY_CAP, ENERGY_CAP, HAPPY_LOSS_PER_ENERGY, totalOf } from './gain.js';
import { XANAX, ECSTASY, EDVD, FHC, CANDY_KISSES, POINTS, REFILL_POINTS, XANAX_CD_MIN, ECSTASY_CD_MIN, ITEMS, boostersThatFit, boosterHours, BOOSTER_CAP_H, GAME_CONSOLE } from './items.js';
import { candyWords, fillFromPool, takeFromHeld } from './candy.js';
import { pickStat } from './builds.js';

export const STRATEGY_IDS = ['steady', 'dailyChoco', 'chocoJump', 'edvdJump', 'happy99k', 'blissSteady', 'steadyBoost', 'steadyMax', 'candyXanax', 'consoleJump', 'consoleJumpToy', 'edvdJumpAN', 'steadyLite'];

/** Special refills, counted like an item (free: they come with the account). */
export const SPECIAL = 'special';

/**
 * The console jump (the friend's guide, docs/research-console-jump.md;
 * docs/research-events-perks.md §3): the Game Console (item 104), "Hardcore
 * Game" 5 energy for 80–120 happy, doubled by the 5★ Toy/Game Shop "Gamer"
 * perk (the wiki confirms both). Happy above the maximum resets at the next
 * quarter tick, so it all happens in one tick window: 60 × Hardcore, candy
 * to the booster cap (the plan's candy), Ecstasy, train, refill, train.
 */
export const CONSOLE_ITEM = GAME_CONSOLE;
export const CONSOLE_USES = 60;
export const CONSOLE_ENERGY_EACH = 5;
export const CONSOLE_HAPPY_EACH = 100;
export const CONSOLE_STACK = 3;

/**
 * Owner (2026-09-29): the console jump is "only for low stat players (below
 * 250k per stat)". Decided: every stat the plan trains (a stat its days add
 * to) must be under 250,000 when the plan is worked out. One stat at or over
 * it and the plan is never recommended; it shows only behind "plans that
 * don't fit you".
 */
export const CONSOLE_MAX_STAT = 250000;

/** Why the console jump doesn't fit these stats, or null when it does. */
export function consoleBlocked(stats, perStat = null) {
    const trained = STATS.filter((k) => perStat && perStat[k] > 0);
    const over = (trained.length ? trained : STATS).filter((k) => (Number(stats && stats[k]) || 0) >= CONSOLE_MAX_STAT);
    if (!over.length) return null;
    return 'for stats under 250k; your ' + over.map((k) => STAT_LABEL[k]).join(', ') + (over.length > 1 ? ' are' : ' is') + ' over it';
}

/** Special refills Torn allows a week (O2, ROUND4-PLAN §D7). */
export const SPECIAL_WEEK_MAX = 100;

/** Plans that eat candy: the plan picks which one (core/candy.js). */
export const CANDY_PLANS = new Set(['dailyChoco', 'chocoJump', 'candyXanax', 'consoleJump', 'consoleJumpToy']);

export const STRATEGIES = {
    steady: { id: 'steady', kind: 'steady', name: 'Steady training', short: 'Steady', what: 'Xanax on cooldown, daily refill, natural energy as it comes' },
    dailyChoco: { id: 'dailyChoco', kind: 'boost', name: 'Daily choco boost', short: 'Daily choco', what: 'Candy + Ecstasy once a day on top of a Xanax' },
    chocoJump: { id: 'chocoJump', kind: 'jump', name: 'Choco jump', short: 'Choco jump', what: 'Stack 4 Xanax, then candy + Ecstasy, train it all' },
    edvdJump: { id: 'edvdJump', kind: 'jump', name: 'EDVD jump', short: 'EDVD jump', what: 'Stack 4 Xanax, then 5 EDVD + Ecstasy' },
    happy99k: { id: 'happy99k', kind: 'jump', name: '99k happy jump', short: '99k jump', what: 'EDVD to the booster cap + Ecstasy, near 99,999 happy' },
    blissSteady: { id: 'blissSteady', kind: 'steady', name: 'Steady with Bliss', short: 'Bliss steady', what: 'Steady, plus EDVD whenever the booster allows; happy keeps climbing' },
    steadyBoost: { id: 'steadyBoost', kind: 'steady', name: 'Steady + energy boosters', short: 'Steady + boosters', what: 'Steady, plus FHC or cans on the booster cooldown as far as the budget goes' },
    steadyMax: { id: 'steadyMax', kind: 'steady', name: 'Steady + FHC, max', short: 'Steady + FHC max', what: 'Steady, plus an FHC every time the booster cooldown allows' },
    candyXanax: { id: 'candyXanax', kind: 'boost', name: 'Candy + Xanax', short: 'Candy + Xanax', what: 'Candy just after a tick, then a Xanax session, once a day (no Ecstasy)' },
    consoleJump: { id: 'consoleJump', kind: 'jump', name: 'Console jump', short: 'Console jump', what: 'Stack 3 Xanax, 300 energy on the Game Console for happy, candy + Ecstasy, train it all' },
    consoleJumpToy: { id: 'consoleJumpToy', kind: 'jump', name: 'Console jump, 5★ Toy/Game Shop', short: 'Console jump 5★', what: 'The console jump with your job’s doubled console happy' },
    edvdJumpAN: { id: 'edvdJumpAN', kind: 'jump', name: 'EDVD jump, 10★ Adult Novelties', short: 'EDVD jump AN', what: 'Stack 4 Xanax, then 5 EDVD (doubled by your job) + Ecstasy' },
    // Round 7 (A.4): steady when the budget doesn't cover a Xanax on every cooldown: as many a day as the money covers.
    steadyLite: { id: 'steadyLite', kind: 'steady', name: 'Steady, fewer Xanax', short: 'Steady, fewer Xanax', what: 'As many Xanax a day as the budget covers, natural energy as it comes' },
};

/**
 * What a plan does, in words, with its candy named (Plan's "What you do"):
 * "Stack 4 Xanax, then Lollipop × 49 + Ecstasy, train it all".
 * @param {string} id
 * @param {object} [r] - its simulateStrategy result (r.candy from the comparison)
 */
export function planWhat(id, r = null) {
    const s = STRATEGIES[id];
    if (!s) return '';
    if (id === 'steadyLite' && r && Number.isFinite(r.xanaxPerDay)) return (r.xanaxPerDay > 0 ? r.xanaxPerDay + ' Xanax a day' : 'No Xanax') + ', natural energy as it comes' + (r.used && r.used[POINTS] > 0 ? ', the daily refill' : ', no refill') + ': what your budget covers';
    const c = r && r.candy ? candyWords(r.candy) : null;
    if (!c) return s.what;
    if (id === 'dailyChoco') return c + ' + Ecstasy once a day on top of a Xanax';
    if (id === 'chocoJump') return 'Stack 4 Xanax, then ' + c + ' + Ecstasy, train it all';
    if (id === 'candyXanax') return c + ' just after a tick, then a Xanax session, once a day (no Ecstasy)';
    if (id === 'consoleJump') return 'Stack 3 Xanax, 300 energy on the Game Console, ' + c + ' + Ecstasy, train it all';
    if (id === 'consoleJumpToy') return 'Stack 3 Xanax, 300 energy on the Game Console (doubled by your job), ' + c + ' + Ecstasy, train it all';
    return s.what;
}

/** Minutes per simulation step. */
export const STEP_MIN = 5;

/** Plans up to this long keep each stat's line day by day; longer ones week by week (a year of days for every plan is too much to store). */
export const STAT_LINE_DAILY_DAYS = 92;

/** Xanax stacked before a jump (ffscouter guide's 4-Xan jumps). */
export const JUMP_STACK = 4;

/**
 * Round 7 (B.1): energy stops at 1,000 (gain.js ENERGY_CAP), so a stack only keeps what fits under it. Energy that may
 * stay in the bar when a stack of `stackTo` Xanax starts: 4 Xanax fill the 1,000, so the bar is trained to empty first
 * (at normal happy); 3 Xanax (the console jump: a full bar + 3 = 900) leave room for the bar. The day plan (plan.js)
 * uses the same number.
 */
export function stackRoom(stackTo) {
    return Math.max(0, ENERGY_CAP - stackTo * ITEMS[XANAX].energy);
}

/**
 * Minutes after a quarter tick the boost lands (the reset has just passed). The day plan (plan.js) counts a boost
 * that can start within this long after a tick as "right after the tick" too: ten minutes are left to finish it.
 */
export const TICK_OFFSET_MIN = 5;

/**
 * @param {string} id - a STRATEGY_IDS entry
 * @param {object} o
 * @param {object} o.stats - starting {str,spd,def,dex}
 * @param {string|object} o.target - one stat ('str') or build shares ({str:.25,...})
 * @param {object} o.gyms - per stat {dots, energy} of the gym each stat trains in
 * @param {object} [o.perks] - per-stat gain multipliers
 * @param {number} o.happyMax - the property's max happy
 * @param {number} [o.energyMax] - 150 (donator) or 100
 * @param {boolean} [o.fastEnergy] - +5 per 10 min (donator) instead of 15
 * @param {number} [o.days]
 * @param {object} o.prices - {[itemId]: $, points: $}
 * @param {number} [o.candyId] - which candy a choco boost uses
 * @param {number} [o.candyCount] - candy per boost (default: fill the booster cap)
 * @param {number} [o.edvdCount] - EDVD per jump (default 5; 99k: fill the cap)
 * @param {number} [o.boosterCapH]
 * @param {boolean} [o.bliss] - Ignorance Is Bliss active
 * @param {boolean} [o.adultNovelties10] - 10★ Adult Novelties: EDVD happy ×2
 * @param {number} [o.xanaxCdMin]
 * @param {number} [o.ecstasyCdMin]
 * @param {number} [o.happyLossMult]
 * @param {number} [o.special] - special refills the plan may use (each: +max energy, free); spent in the
 *   first boosted session (jumps, boosts), else right after the first Xanax session
 * @param {object} [o.energyBooster] - steadyBoost: {id: FHC|MUNSTER|RED_COW|TAURINE, perDay} on the booster cooldown
 * @param {number} [o.canMult] - energy-drink perks (faction): × can energy
 * @param {boolean} [o.toyShop5] - 5★ Toy/Game Shop: console happy × 2 [verify]
 * @param {number} [o.candyMult] - candy perks (faction Voracity, a book, Absorption): × candy happy
 * @param {number} [o.cdMult] - consumable cooldown cuts (Grocery 3★, Restaurant 10★, Self Control Is For Losers): × candy/can cooldown
 * @param {number} [o.specialHeld] - special refills the account holds. When given, the daily refill is a special
 *   while any are held (Torn blocks the points refill until they're spent [verify, 1 source]); extras (o.special)
 *   come from the same stock. At most SPECIAL_WEEK_MAX a week either way.
 * @param {boolean} [o.consoleOwned] - a Game Console in the inventory (else the console jump buys one)
 * @param {object} [o.jobHappy] - job-point happy specials where the player works: {specials:[{jp, happy}], jpPerDay, bank}
 *   spent in each boosted session (steady plans: the first Xanax session of a day), before the Ecstasy
 * @param {number} [o.freeEdvdPerDay] - Adult Novelties 3★ "Voyeur" (20 JP → 1 EDVD): EDVD the job pays for, a day
 * @param {string} [o.splitRule] - builds.js SPLIT_RULE (default) or 'deficit' (the old split, for the simulator check)
 * @param {number} [o.boosterCdMin] - booster cooldown already running at the start, minutes (the live one)
 * @param {object} [o.held] - {[itemId]: qty} boosters in the inventory: used first and free (candy and energy
 *   drinks as a pool, the most happy or energy first; EDVD and FHC as themselves). `used.held` counts them.
 * @param {object[]} [o.events] - round 6 (year plans): [{from, to (minutes from the start), candyMult, canMult,
 *   freeEnergy, freeHappy}]: candy and cans count the event's × while it runs; free energy/happy land at its start
 * @param {object} [o.unlock] - round 6: gyms opening as energy is trained: {left: energy to the next gym,
 *   next: () => ({gyms, left}|null)}: when the energy trained reaches `left`, the gyms switch to `next()`'s
 *   (per stat {dots, energy}) and `left` becomes the next step; `unlocked` counts them (with the day)
 * @param {object} [o.start] - round 7: the bars as they are when the plan is made: {energy, happy, drugCdMin (drug
 *   cooldown left, minutes), refillUsed (today's refill is gone)}. The day plan (plan.js) always started from the live
 *   bars; the simulator started from a full bar with no cooldown, so day one of a plan promised more than its own
 *   steps could do. Unset: a full bar, happy at its maximum, no cooldown (stretches of a plan that start later)
 * @param {number} [o.dayMin] - round 7: the minute of the Torn day the run starts at (0–1439; unset: Torn midnight).
 *   The refill, the day's boost and every other once-a-day count go by the Torn day, as in the day plan
 * @param {number} [o.xanaxPerDay] - round 7 (the small-budget plan): at most this many Xanax a day in a steady plan
 *   (0: natural energy only); unset: one on every cooldown
 * @param {function} [o.trace] - round 7: called for every train with {t (minutes from the start), k (stat), e (its
 *   energy), E and H (energy and happy before it), gain}. For tests and the baseline; it changes nothing.
 * @returns {{id, gained:number, perStat:object, cost:number, energyTrained:number, daily:number[], used:object, quart:number[], statLine:object}}
 *   daily: the total gained by the end of each 24 h from the start. Round 7 (Progress): `quart` says when in each of
 *   those days the gain lands (three minutes a day: a quarter, half and three quarters of the day's gain reached), so a jump
 *   reads as a step and steady training as a slope; `statLine` is each stat's own line ({step (days), days, str: [],
 *   spd, def, dex}: the gain by the end of every `step` days, the last entry at `days`).
 * Refills (points or special) set energy to the maximum, never above it: anything over is wasted (O2, owner).
 */
export function simulateStrategy(id, o) {
    const run = simulateSteps(id, o);
    let r = run.next();
    while (!r.done) r = run.next();
    return r.value;
}

/** Simulated days between two breaks of a sliced run: a few milliseconds of work each. */
export const SIM_SLICE_DAYS = 30;

/**
 * The same simulation as a generator (round 7, R7.3b): with `o.sliceDays` it yields every that many simulated days,
 * so a long plan can be worked out in slices with breaks for the page in between (one 12-month run is about a tenth
 * of a second: too long to hold the page at 4x slower). It returns what simulateStrategy returns; the numbers are
 * the same sliced or not.
 */
export function* simulateSteps(id, o) {
    const sliceMin = o.sliceDays > 0 ? Math.round(o.sliceDays) * 1440 : 0;
    const days = o.days || 30;
    const maxE = o.energyMax || 150;
    const maxH = o.happyMax;
    const regenEvery = o.fastEnergy === false ? 15 : 10;
    const xanCD = o.xanaxCdMin || XANAX_CD_MIN;
    const ecsCD = o.ecstasyCdMin || ECSTASY_CD_MIN;
    const capH = o.boosterCapH || BOOSTER_CAP_H;
    const cdMult = o.cdMult || 1;
    const candyId = o.candyId && ITEMS[o.candyId] ? o.candyId : CANDY_KISSES;
    const candyN = o.candyCount || boostersThatFit(candyId, capH, 0, cdMult);
    let edvdN = o.edvdCount || 5;
    if (id === 'happy99k' && !o.edvdCount) edvdN = boostersThatFit(EDVD, capH);
    const edvdHappy = ITEMS[EDVD].happy * (o.adultNovelties10 || id === 'edvdJumpAN' ? 2 : 1);
    const bliss = Boolean(o.bliss);
    const price = (k) => Number(o.prices && o.prices[k]) || 0;
    const lossMult = o.happyLossMult || 1;

    const S = { ...o.stats };
    const single = typeof o.target === 'string' ? o.target : null;
    const shares = single ? null : o.target;
    const st = o.start && typeof o.start === 'object' ? o.start : null;
    let E = st && Number.isFinite(st.energy) ? Math.max(0, st.energy) : maxE;
    let H = st && Number.isFinite(st.happy) ? Math.max(0, st.happy) : maxH;
    let cost = 0;
    let trainedE = 0;
    let drugFree = st ? Math.max(0, Number(st.drugCdMin) || 0) : 0;
    // Minute the booster cooldown reaches 0. Every booster (candy, EDVD, FHC, cans) goes in only while the cooldown
    // is under the cap (the last one overshoots it): 49 candy take 24.5 h, so a full load can't happen every day.
    let boosterFree = Math.max(0, Number(o.boosterCdMin) || 0);
    const fitsAt = (itemId, t) => boostersThatFit(itemId, capH, Math.max(0, boosterFree - t) / 60, cdMult);
    const addBooster = (itemId, n, t) => {
        boosterFree = Math.max(boosterFree, t) + n * boosterHours(itemId, cdMult) * 60;
    };
    // The Torn day (round 7): what is counted once a day (the refill, the day's boost, the Xanax a day of the small
    // plan, boosters a day, job points) is counted by Torn's day, as the day plan (plan.js) always did. `dayMin` is
    // the minute of the Torn day the run starts at. Before, a "day" was 24 hours from the moment the plan was made:
    // a plan made at noon lost the refill of its last half day, and a refill used today blocked 24 hours.
    const dayMin = Number.isFinite(o.dayMin) ? ((Math.floor(o.dayMin) % 1440) + 1440) % 1440 : 0;
    // A daily candy boost still to come today: the next Xanax (before midnight) will find room under the cap.
    const boostLaterToday = (t, day) => t + xanCD < (day + 1) * 1440 - dayMin && boosterFree - (t + xanCD) < capH * 60;
    // Today's refill already used: none until Torn's midnight.
    let refillDay = st && st.refillUsed ? 0 : -1;
    // The small-budget plan: at most this many Xanax a day (steady plans); the day plan (plan.js) keeps the same count.
    const xanCap = Number.isFinite(o.xanaxPerDay) ? Math.max(0, Math.floor(o.xanaxPerDay)) : Infinity;
    let xanDay = -1;
    let xanToday = 0;
    let stacked = 0;
    let phase = id === 'dailyChoco' ? 'free' : 'stack';
    let doneDay = -1;
    const used = { [XANAX]: 0, [ECSTASY]: 0, [EDVD]: 0, [candyId]: 0, [POINTS]: 0, [SPECIAL]: 0 };
    let specialLeft = Math.max(0, Math.floor(o.special || 0));
    // Special refills held: when the caller says how many, the daily refill uses them first (the points refill waits).
    const heldRule = o.specialHeld !== undefined && o.specialHeld !== null;
    let heldLeft = heldRule ? Math.max(0, Math.floor(o.specialHeld)) : Infinity;
    let spWeek = -1;
    let spWeekN = 0;
    // Job points: happy specials where the player works, and Adult Novelties' EDVD for 20 JP.
    const jh = o.jobHappy && Array.isArray(o.jobHappy.specials) && o.jobHappy.specials.length ? o.jobHappy : null;
    let jpBank = jh ? Math.max(0, Number(jh.bank) || 0) : 0;
    let jpDay = -1;
    let edvdBank = 0;
    let consoleBought = Boolean(o.consoleOwned);
    const eb = id === 'steadyMax' ? { id: FHC, perDay: Infinity } : id === 'steadyBoost' && o.energyBooster && ITEMS[o.energyBooster.id] ? o.energyBooster : null;
    const ebItem = eb ? ITEMS[eb.id] : null;
    const canMult = o.canMult || 1;
    // Events (year plans): the multipliers in force now, and free energy/happy handed out once at their start.
    const evs = Array.isArray(o.events) ? o.events.filter((e) => e && e.to > 0 && e.from < days * 1440) : [];
    let evCandy = 1;
    let evCan = 1;
    const evGiven = new Set();
    // Gyms opening as energy is trained (year plans).
    const unlocked = [];
    let unlockLeft = o.unlock && o.unlock.left > 0 ? o.unlock.left : Infinity;
    // This run's own (the specialists it has joined): plans compared side by side don't share it.
    const unlockMemo = {};
    let ebDay = -1;
    let ebToday = 0;
    const isConsole = id === 'consoleJump' || id === 'consoleJumpToy';
    const stackTo = isConsole ? CONSOLE_STACK : JUMP_STACK;
    const stackKeep = stackRoom(stackTo);
    // Energy already above the maximum at the start is Xanax stacked (a jump) or held (daily choco), as the day plan reads it.
    if (st && E > maxE + 50) {
        if (id === 'dailyChoco') phase = 'hold';
        else if (STRATEGIES[id] && STRATEGIES[id].kind === 'jump') {
            stacked = Math.min(stackTo, Math.ceil((E - maxE - 50) / ITEMS[XANAX].energy));
            if (stacked === stackTo) phase = 'wait';
        }
    }
    const consoleHappy = CONSOLE_HAPPY_EACH * (id === 'consoleJumpToy' || o.toyShop5 ? 2 : 1);
    const daily = [];
    const start = totalOf(S);
    const trace = typeof o.trace === 'function' ? o.trace : null;
    let curT = 0;
    // When in each day the gain lands (Progress's plan line), and each stat's own line.
    const quart = [];
    let gainSum = 0;
    let gainSeen = 0;
    let dayBase = 0;
    let dayMarks = [];
    const closeDay = () => {
        const total = gainSum - dayBase;
        // The minutes of the day by which a quarter, half and three quarters of its gain were reached (a day with
        // no gain: an even slope, which adds nothing).
        let q1 = 360;
        let q2 = 720;
        let q3 = 1080;
        if (total > 0) {
            q1 = q2 = q3 = dayMarks[dayMarks.length - 2];
            for (let i = dayMarks.length - 2; i >= 0; i -= 2) {
                if (dayMarks[i + 1] >= 0.75 * total) q3 = dayMarks[i];
                if (dayMarks[i + 1] >= 0.5 * total) q2 = dayMarks[i];
                if (dayMarks[i + 1] >= 0.25 * total) q1 = dayMarks[i];
            }
        }
        quart.push(q1, q2, q3);
        dayBase = gainSum;
        dayMarks = [];
    };
    const statStep = days > STAT_LINE_DAILY_DAYS ? 7 : 1;
    const statLine = { step: statStep, days, str: [], spd: [], def: [], dex: [] };
    const statMark = () => {
        for (const k of STATS) statLine[k].push(Math.round(S[k] - o.stats[k]));
    };

    // Toward a build: the same per-train split as the day plan (builds.js pickStat), in each stat's gym.
    const cands = single ? null : STATS.filter((k) => o.gyms[k] && o.gyms[k].dots > 0).map((k) => ({ k, dots: o.gyms[k].dots, energy: o.gyms[k].energy }));
    const pick = () => {
        if (single) return single;
        const c = pickStat(cands, S, shares, H, o.perks || null, o.splitRule, undefined, maxH);
        return c ? c.k : null;
    };
    // The cheapest train there is: with less energy than that nothing can be trained, whatever the split would pick
    // (round 7, R7.3b: the split was worked out on every 5-minute step, most of them with no energy to train: half
    // of all its calls. The result is the same: the pick's own train costs at least this).
    const minTrainE = () => (single ? (o.gyms[single] ? o.gyms[single].energy : Infinity) : cands.reduce((a, c) => Math.min(a, c.energy), Infinity));
    let minE = minTrainE();
    const train = (keep = 0) => {
        for (;;) {
            if (E - minE < keep) return;
            const k = pick();
            if (!k) return;
            const g = o.gyms[k];
            if (E - g.energy < keep) return;
            const gain = gainPerTrain(k, S[k], H, g.dots, g.energy, o.perks ? o.perks[k] : 1);
            if (trace) trace({ t: curT, k, e: g.energy, E, H, gain });
            S[k] += gain;
            gainSum += gain;
            E -= g.energy;
            H = Math.max(0, H - HAPPY_LOSS_PER_ENERGY * g.energy * lossMult);
            trainedE += g.energy;
            unlockLeft -= g.energy;
            if (unlockLeft <= 0) openGym();
        }
    };
    // The next gym opened: train there from now on (its fee is the caller's; `unlocked` says when).
    function openGym() {
        const n = o.unlock.next(S, trainedE, unlockMemo);
        if (!n) {
            unlockLeft = Infinity;
            return;
        }
        // `t`: the minute it opened (round 7: each plan says when it opens a gym).
        unlocked.push({ at: trainedE, t: curT, gymId: n.gymId, cost: n.cost || 0, joined: n.joined || [] });
        cost += n.cost || 0;
        if (n.gyms) {
            o = { ...o, gyms: n.gyms };
            if (cands) cands.splice(0, cands.length, ...STATS.filter((k) => o.gyms[k] && o.gyms[k].dots > 0).map((k) => ({ k, dots: o.gyms[k].dots, energy: o.gyms[k].energy })));
            minE = minTrainE();
        }
        unlockLeft += n.left > 0 ? n.left : Infinity;
    }
    const buy = (item, n = 1) => {
        used[item] = (used[item] || 0) + n;
        cost += price(item) * n;
    };
    // Boosters held: used first, free (owner, 2026-09-29: "it should exhaust my inventory first").
    const stock = {};
    for (const [k, v] of Object.entries(o.held || {})) if (ITEMS[k] && ITEMS[k].kind === 'booster' && Number(v) > 0) stock[k] = Math.floor(Number(v));
    const useBoosters = (item, n) => {
        const f = fillFromPool(n, item, stock);
        takeFromHeld(stock, f);
        for (const a of f.alloc) {
            used[a.id] = (used[a.id] || 0) + a.qty;
            if (a.held) used.held = { ...(used.held || {}), [a.id]: ((used.held && used.held[a.id]) || 0) + a.held };
        }
        cost += price(item) * f.buy;
        return f;
    };
    // A candy boost of `n`: the happy it adds (held candy may give more than the pick).
    const eatCandy = (n) => useBoosters(candyId, n).value * (o.candyMult || 1) * evCandy;
    // Special refills: in a boosted session as many as keep happy above the maximum (it resets there anyway);
    // otherwise a day's share. Each train costs happy, so dumping them all at the maximum drains it for days.
    const specialPerDay = Math.ceil(Math.max(0, Math.floor(o.special || 0)) / days);
    let spDay = -1;
    let spToday = 0;
    // One special refill: energy to the maximum (never above), within the week's 100 and what's held.
    const specialOk = (day) => {
        const w = Math.floor(day / 7);
        if (w !== spWeek) {
            spWeek = w;
            spWeekN = 0;
        }
        return heldLeft > 0 && spWeekN < SPECIAL_WEEK_MAX;
    };
    const useSpecial = () => {
        E = Math.max(E, maxE);
        heldLeft--;
        spWeekN++;
        used[SPECIAL]++;
    };
    const spendSpecial = (day) => {
        if (day !== spDay) {
            spDay = day;
            spToday = 0;
        }
        const drain = HAPPY_LOSS_PER_ENERGY * maxE * lossMult;
        // One at a time, each once energy is spent: a refill can't stack above the maximum.
        while (specialLeft > 0 && specialOk(day) && (spToday < specialPerDay || H - drain > maxH)) {
            useSpecial();
            specialLeft--;
            spToday++;
            train();
        }
    };
    // Job points arrive daily (1 per company star); happy specials spend them best-rate first.
    const jobHappy = (day) => {
        if (!jh) return 0;
        if (day !== jpDay) {
            if (jpDay >= 0) jpBank += (jh.jpPerDay || 0) * (day - jpDay);
            jpDay = day;
        }
        let add = 0;
        for (const sp of jh.specials) {
            const n = Math.floor(jpBank / sp.jp);
            if (n > 0) {
                add += n * sp.happy;
                jpBank -= n * sp.jp;
            }
        }
        return add;
    };
    const buyEdvd = (n, day) => {
        // EDVD the job has paid for so far (edvdBank: the ones already taken).
        if (o.freeEdvdPerDay > 0) {
            const free = Math.min(n, Math.floor(o.freeEdvdPerDay * (day + 1) + 1e-9) - edvdBank);
            if (free > 0) {
                edvdBank += free;
                used.freeEdvd = (used.freeEdvd || 0) + free;
                n -= free;
            }
        }
        if (n > 0) useBoosters(EDVD, n);
    };
    // Energy boosters on the booster cooldown, only once energy is spent (FHC fills to max; cans add theirs).
    const energyBoost = (t, day) => {
        if (!eb) return;
        if (day !== ebDay) {
            ebDay = day;
            ebToday = 0;
        }
        while (ebToday < eb.perDay && fitsAt(eb.id, t) > 0 && E < 10) {
            const f = useBoosters(eb.id, 1);
            if (ebItem.toMax) {
                E = Math.max(E, maxE);
                H += ebItem.happy || 0;
            } else E = Math.min(ENERGY_CAP, E + Math.round(f.value * canMult * evCan));
            addBooster(eb.id, 1, t);
            ebToday++;
            train();
        }
    };
    // The day's refill sets energy to the maximum (never above). While specials are held it is a special.
    const refill = (day) => {
        refillDay = day;
        if (heldRule && specialOk(day)) {
            useSpecial();
            specialLeft = Math.min(specialLeft, heldLeft);
            used.dailySpecial = (used.dailySpecial || 0) + 1;
            return;
        }
        // The points refill left out (it isn't worth its price under the Plan rule): special refills above still count.
        if (o.noRefill) return;
        E = Math.max(E, maxE);
        buy(POINTS, REFILL_POINTS);
    };
    // Would the day's refill add energy (a special held, or the points refill when the plan keeps it)?
    const refillGives = (day) => (heldRule && specialOk(day)) || !o.noRefill;
    const xanax = (t) => {
        // Never above 1,000: what doesn't fit is lost (900 + a Xanax = 1,000).
        E = Math.min(ENERGY_CAP, E + ITEMS[XANAX].energy);
        H += ITEMS[XANAX].happy;
        buy(XANAX);
        drugFree = t + xanCD;
    };

    for (let t = 0; t < days * 1440; t += STEP_MIN) {
        if (sliceMin && t && t % sliceMin === 0) yield t;
        // The Torn day this minute is in (0: the day the run starts in). The result's `daily` and `quart` stay by 24 h
        // from the start (the plan's line is read by time).
        const day = Math.floor((t + dayMin) / 1440);
        curT = t;
        if (gainSum !== gainSeen) {
            // What the last step trained, at that step's minute of its day.
            dayMarks.push((t - STEP_MIN) % 1440, gainSum - dayBase);
            gainSeen = gainSum;
        }
        if (t % 1440 === 0 && t) {
            daily.push(Math.round(totalOf(S) - start));
            closeDay();
            if ((t / 1440) % statStep === 0) statMark();
        }
        if (evs.length) {
            evCandy = 1;
            evCan = 1;
            for (let i = 0; i < evs.length; i++) {
                const ev = evs[i];
                if (t < ev.from || t >= ev.to) continue;
                evCandy *= ev.candyMult || 1;
                evCan *= ev.canMult || 1;
                if (!evGiven.has(i) && (ev.freeEnergy || ev.freeHappy)) {
                    evGiven.add(i);
                    E = Math.min(ENERGY_CAP, E + (ev.freeEnergy || 0));
                    H = Math.min(HAPPY_CAP, H + (ev.freeHappy || 0));
                }
            }
        }
        if (t % regenEvery === 0 && E < maxE) E = Math.min(maxE, E + 5);
        if (t % 15 === 0) {
            if (bliss) H = Math.min(HAPPY_CAP, H + 5);
            else H = H > maxH ? maxH : Math.min(maxH, H + 5);
        }

        if (id === 'steady' || id === 'blissSteady' || id === 'steadyBoost' || id === 'steadyMax' || id === 'steadyLite') {
            if (day !== xanDay) {
                xanDay = day;
                xanToday = 0;
            }
            const took = t >= drugFree && xanToday < xanCap;
            if (took) {
                xanax(t);
                xanToday++;
            }
            // Job-point happy: once a day, on that day's first Xanax session.
            if (took && jh && day !== jpDay) H += jobHappy(day);
            if (id === 'blissSteady' && fitsAt(EDVD, t) > 0) {
                H = Math.min(HAPPY_CAP, H + edvdHappy);
                buyEdvd(1, day);
                addBooster(EDVD, 1, t);
            }
            if (day !== refillDay && E < 20) refill(day);
            train();
            if (took) spendSpecial(day);
            energyBoost(t, day);
        } else if (id === 'candyXanax') {
            // Once a day the Xanax waits for a tick, then candy + Xanax and train it (no Ecstasy: the candy happy lasts one session).
            // The candy is what fits under the booster cap then; none fits, and it's a plain Xanax session (the boost waits).
            if (t >= drugFree && doneDay !== day && fitsAt(candyId, t) > 0) {
                if (t % 15 === TICK_OFFSET_MIN) {
                    const qty = Math.min(candyN, fitsAt(candyId, t));
                    H = Math.min(HAPPY_CAP, H + eatCandy(qty) + jobHappy(day));
                    addBooster(candyId, qty, t);
                    used.candyBoosts = (used.candyBoosts || 0) + 1;
                    xanax(t);
                    train();
                    if (day !== refillDay) {
                        refill(day);
                        train();
                    }
                    spendSpecial(day);
                    doneDay = day;
                }
            } else {
                if (t >= drugFree) xanax(t);
                // The day's refill after its boost; with no boost left today (the booster cooldown is full), after this session.
                if (day !== refillDay && E < 20 && (doneDay === day || !boostLaterToday(t, day))) refill(day);
                train();
            }
        } else if (id === 'dailyChoco') {
            // Hold one Xanax's worth of cooldown, then candy + Ecstasy in its place. A Xanax is held only when candy
            // will fit under the booster cap at its end; the candy is what fits then.
            if (phase === 'hold' && t >= drugFree && t % 15 === TICK_OFFSET_MIN) {
                const qty = Math.min(candyN, fitsAt(candyId, t));
                H = Math.min(HAPPY_CAP, (H + eatCandy(qty) + jobHappy(day)) * 2);
                addBooster(candyId, qty, t);
                used.candyBoosts = (used.candyBoosts || 0) + 1;
                buy(ECSTASY);
                drugFree = t + ecsCD;
                train();
                // One refill a Torn day: a day with no room for candy earlier may already have used it.
                if (day !== refillDay) {
                    refill(day);
                    train();
                }
                spendSpecial(day);
                phase = 'done';
                doneDay = day;
            } else if (phase !== 'hold' && t >= drugFree) {
                xanax(t);
                if (doneDay !== day && fitsAt(candyId, t + xanCD) > 0) phase = 'hold';
            }
            if (phase !== 'hold') {
                // No boost left today (the booster cooldown is full): the day's refill after this session.
                if (day !== refillDay && E < 20 && doneDay !== day && !boostLaterToday(t, day)) refill(day);
                train();
            }
        } else {
            // Jumps: stack Xanax without training, then boost just after a tick and train it all.
            // Between a jump and the next stack (round 7, B.2; the day plan does the same: plan.js): natural energy
            // is trained as it comes, at normal happy, down to what fits under the 1,000 cap with the stack (4 Xanax:
            // to empty). Before round 7 the bar went into the stack: 1,150 and 1,120 at jump happy.
            // The boost waits until the whole of it fits under the booster cap (a jump is worth its full load).
            const boostItem = id === 'chocoJump' || isConsole ? candyId : EDVD;
            const boostN = Math.min(boostItem === EDVD ? edvdN : candyN, boostersThatFit(boostItem, capH, 0, cdMult));
            if (phase === 'stack' && stacked === 0) {
                // The stack's first Xanax on a Torn day no jump can land in, with that day's refill unused: the
                // refill goes in now, before the stack (once energy is stacked above the maximum a refill adds
                // nothing). The bar is trained first, so the refill fills all of it. The day plan does the same.
                if (t >= drugFree && day !== refillDay && refillGives(day)) {
                    const jumpFrom = Math.max(t + stackTo * xanCD, boosterFree - capH * 60 + (boostN - 1) * boosterHours(boostItem, cdMult) * 60);
                    if (jumpFrom >= (day + 1) * 1440 - dayMin) {
                        train();
                        refill(day);
                    }
                }
                train(stackKeep);
            }
            if (phase === 'stack' && t >= drugFree) {
                xanax(t);
                stacked++;
                if (stacked === stackTo) phase = 'wait';
            }
            if (phase === 'wait' && t >= drugFree && t % 15 === TICK_OFFSET_MIN && fitsAt(boostItem, t) >= boostN) {
                const jp = jobHappy(day);
                if (isConsole) {
                    // 300 energy on the console for happy, candy to the booster cap, then the Ecstasy doubles it.
                    if (!consoleBought) {
                        buy(GAME_CONSOLE);
                        consoleBought = true;
                    }
                    const uses = Math.min(CONSOLE_USES, Math.floor(E / CONSOLE_ENERGY_EACH));
                    E -= uses * CONSOLE_ENERGY_EACH;
                    H = (H + uses * consoleHappy + eatCandy(boostN) + jp) * 2;
                } else if (id === 'chocoJump') {
                    H = (H + eatCandy(boostN) + jp) * 2;
                } else {
                    H = (H + boostN * edvdHappy + jp) * 2;
                    buyEdvd(boostN, day);
                }
                addBooster(boostItem, boostN, t);
                H = Math.min(HAPPY_CAP, H);
                buy(ECSTASY);
                drugFree = t + ecsCD;
                train();
                if (day !== refillDay) {
                    refill(day);
                    train();
                }
                spendSpecial(day);
                phase = 'stack';
                stacked = 0;
            }
        }
    }
    daily.push(Math.round(totalOf(S) - start));
    if (gainSum !== gainSeen) dayMarks.push(1435, gainSum - dayBase);
    closeDay();
    statMark();
    const perStat = {};
    for (const k of STATS) perStat[k] = Math.round(S[k] - o.stats[k]);
    const out = { id, gained: Math.round(totalOf(S) - start), perStat, cost: Math.round(cost), energyTrained: trainedE, daily, used, quart, statLine };
    if (unlocked.length) out.unlocked = unlocked;
    return out;
}

/** Which strategies can run at all for this player (items, cooldown caps, a book). */
export function feasibleStrategies({ bliss = false, boosterCapH = BOOSTER_CAP_H, toyShop5 = false, adultNovelties10 = false } = {}) {
    return STRATEGY_IDS.filter((id) => {
        if (id === 'blissSteady') return bliss;
        // The 99k jump only differs from the EDVD jump when faction perks raise the booster cap.
        if (id === 'happy99k') return boosterCapH > BOOSTER_CAP_H;
        // Needs the ladder's choice of FHC or cans and how many a day: the caller adds it.
        if (id === 'steadyBoost') return false;
        // Only when steady is over the budget, with the Xanax a day the money covers: the caller adds it.
        if (id === 'steadyLite') return false;
        // Only when steady is over the budget, with the Xanax a day the money covers: the caller adds it.
        if (id === 'steadyLite') return false;
        // In that job the variant replaces the plain plan (the same plan with the perk).
        if (id === 'consoleJumpToy') return toyShop5;
        if (id === 'consoleJump') return !toyShop5;
        if (id === 'edvdJumpAN') return adultNovelties10;
        if (id === 'edvdJump') return !adultNovelties10;
        return true;
    });
}
