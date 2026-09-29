/*
 * The training strategies as event simulators over N days, in 5-minute
 * steps (the model of docs/sims/sim30.mjs, generalised to four stats and
 * specialist gyms). Pure. ENGINE-SPEC §4.
 *
 * Each strategy decides when drugs, boosters and the refill are used; every
 * train in between goes through one trainer (one stat, or greedy toward a
 * build's shares), so strategies compare like for like.
 */

import { STATS, gainPerTrain, HAPPY_CAP, HAPPY_LOSS_PER_ENERGY, totalOf } from './gain.js';
import { XANAX, ECSTASY, EDVD, FHC, CANDY_KISSES, POINTS, REFILL_POINTS, XANAX_CD_MIN, ECSTASY_CD_MIN, ITEMS, boostersThatFit, BOOSTER_CAP_H } from './items.js';

export const STRATEGY_IDS = ['steady', 'dailyChoco', 'chocoJump', 'edvdJump', 'happy99k', 'blissSteady', 'steadyBoost', 'steadyMax', 'candyXanax', 'consoleJump', 'consoleJumpToy', 'edvdJumpAN'];

/** Special refills, counted like an item (free: they come with the account). */
export const SPECIAL = 'special';

/**
 * The console jump (the friend's guide, docs/research-console-jump.md;
 * docs/research-events-perks.md §3): the Game Console (item 104), "Hardcore
 * Game" 5 energy for 80–120 happy, doubled by the 5★ Toy/Game Shop "Gamer"
 * perk. Happy above the maximum resets at the next quarter tick, so it all
 * happens in one tick window. [verify] in game; named exports to replace.
 */
export const CONSOLE_ITEM = 104;
export const CONSOLE_USES = 60;
export const CONSOLE_ENERGY_EACH = 5;
export const CONSOLE_HAPPY_EACH = 100;
export const CONSOLE_STACK = 3;
export const CONSOLE_CANDY = 10;

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
    consoleJump: { id: 'consoleJump', kind: 'jump', name: 'Console jump', short: 'Console jump', what: 'Stack 3 Xanax, 300 energy on the Game Console for happy, candy + Ecstasy, train it all', unverified: true },
    consoleJumpToy: { id: 'consoleJumpToy', kind: 'jump', name: 'Console jump, 5★ Toy/Game Shop', short: 'Console jump 5★', what: 'The console jump with your job’s doubled console happy', unverified: true },
    edvdJumpAN: { id: 'edvdJumpAN', kind: 'jump', name: 'EDVD jump, 10★ Adult Novelties', short: 'EDVD jump AN', what: 'Stack 4 Xanax, then 5 EDVD (doubled by your job) + Ecstasy' },
};

/** Minutes per simulation step. */
export const STEP_MIN = 5;

/** Xanax stacked before a jump (ffscouter guide's 4-Xan jumps). */
export const JUMP_STACK = 4;

/** Minutes after a quarter tick the boost lands (the reset has just passed). */
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
 * @returns {{id, gained:number, perStat:object, cost:number, energyTrained:number, daily:number[], used:object}}
 */
export function simulateStrategy(id, o) {
    const days = o.days || 30;
    const maxE = o.energyMax || 150;
    const maxH = o.happyMax;
    const regenEvery = o.fastEnergy === false ? 15 : 10;
    const xanCD = o.xanaxCdMin || XANAX_CD_MIN;
    const ecsCD = o.ecstasyCdMin || ECSTASY_CD_MIN;
    const capH = o.boosterCapH || BOOSTER_CAP_H;
    const candyId = o.candyId || CANDY_KISSES;
    const candyN = o.candyCount || boostersThatFit(candyId, capH);
    const candyHappy = ITEMS[candyId].happy * (o.candyMult || 1);
    let edvdN = o.edvdCount || 5;
    if (id === 'happy99k' && !o.edvdCount) edvdN = boostersThatFit(EDVD, capH);
    const edvdHappy = ITEMS[EDVD].happy * (o.adultNovelties10 || id === 'edvdJumpAN' ? 2 : 1);
    const bliss = Boolean(o.bliss);
    const price = (k) => Number(o.prices && o.prices[k]) || 0;
    const lossMult = o.happyLossMult || 1;

    const S = { ...o.stats };
    const single = typeof o.target === 'string' ? o.target : null;
    const shares = single ? null : o.target;
    let E = maxE;
    let H = maxH;
    let cost = 0;
    let trainedE = 0;
    let drugFree = 0;
    let boosterFree = 0; // minute the booster cooldown reaches 0
    let refillDay = -1;
    let stacked = 0;
    let phase = id === 'dailyChoco' ? 'free' : 'stack';
    let doneDay = -1;
    const used = { [XANAX]: 0, [ECSTASY]: 0, [EDVD]: 0, [candyId]: 0, [POINTS]: 0, [SPECIAL]: 0 };
    let specialLeft = Math.max(0, Math.floor(o.special || 0));
    const eb = id === 'steadyMax' ? { id: FHC, perDay: Infinity } : id === 'steadyBoost' && o.energyBooster && ITEMS[o.energyBooster.id] ? o.energyBooster : null;
    const ebItem = eb ? ITEMS[eb.id] : null;
    const canMult = o.canMult || 1;
    let ebDay = -1;
    let ebToday = 0;
    const isConsole = id === 'consoleJump' || id === 'consoleJumpToy';
    const stackTo = isConsole ? CONSOLE_STACK : JUMP_STACK;
    const consoleHappy = CONSOLE_HAPPY_EACH * (id === 'consoleJumpToy' || o.toyShop5 ? 2 : 1);
    const daily = [];
    const start = totalOf(S);

    const pick = () => {
        if (single) return single;
        const tot = totalOf(S);
        let best = null;
        let bd = -Infinity;
        for (const k of STATS) {
            if (!o.gyms[k] || !(o.gyms[k].dots > 0)) continue;
            const d = shares[k] - S[k] / tot;
            if (d > bd) {
                bd = d;
                best = k;
            }
        }
        return best;
    };
    const train = (keep = 0) => {
        for (;;) {
            const k = pick();
            if (!k) return;
            const g = o.gyms[k];
            if (E - g.energy < keep) return;
            S[k] += gainPerTrain(k, S[k], H, g.dots, g.energy, o.perks ? o.perks[k] : 1);
            E -= g.energy;
            H = Math.max(0, H - HAPPY_LOSS_PER_ENERGY * g.energy * lossMult);
            trainedE += g.energy;
        }
    };
    const buy = (item, n = 1) => {
        used[item] = (used[item] || 0) + n;
        cost += price(item) * n;
    };
    // Special refills: in a boosted session as many as keep happy above the maximum (it resets there anyway);
    // otherwise a day's share. Each train costs happy, so dumping them all at the maximum drains it for days.
    const specialPerDay = Math.ceil(Math.max(0, Math.floor(o.special || 0)) / days);
    const spendSpecial = () => {
        let n = 0;
        const drain = HAPPY_LOSS_PER_ENERGY * maxE * lossMult;
        while (specialLeft > 0 && (n < specialPerDay || H - drain > maxH)) {
            E += maxE;
            specialLeft--;
            used[SPECIAL]++;
            n++;
            train();
        }
    };
    // Energy boosters on the booster cooldown, only once energy is spent (FHC fills to max; cans add theirs).
    const energyBoost = (t, day) => {
        if (!eb) return;
        if (day !== ebDay) {
            ebDay = day;
            ebToday = 0;
        }
        while (ebToday < eb.perDay && boosterFree - t < capH * 60 && E < 10) {
            if (ebItem.toMax) {
                E = Math.max(E, maxE);
                H += ebItem.happy || 0;
            } else E += Math.round(ebItem.energy * canMult);
            buy(eb.id);
            boosterFree = Math.max(boosterFree, t) + ebItem.boosterH * 60;
            ebToday++;
            train();
        }
    };
    const refill = (day) => {
        E += maxE;
        buy(POINTS, REFILL_POINTS);
        refillDay = day;
    };
    const xanax = (t) => {
        E += ITEMS[XANAX].energy;
        H += ITEMS[XANAX].happy;
        buy(XANAX);
        drugFree = t + xanCD;
    };

    for (let t = 0; t < days * 1440; t += STEP_MIN) {
        const day = Math.floor(t / 1440);
        if (t % 1440 === 0 && t) daily.push(Math.round(totalOf(S) - start));
        if (t % regenEvery === 0 && E < maxE) E = Math.min(maxE, E + 5);
        if (t % 15 === 0) {
            if (bliss) H = Math.min(HAPPY_CAP, H + 5);
            else H = H > maxH ? maxH : Math.min(maxH, H + 5);
        }

        if (id === 'steady' || id === 'blissSteady' || id === 'steadyBoost' || id === 'steadyMax') {
            const took = t >= drugFree;
            if (took) xanax(t);
            if (id === 'blissSteady' && boosterFree - t < capH * 60) {
                H = Math.min(HAPPY_CAP, H + edvdHappy);
                buy(EDVD);
                boosterFree = Math.max(boosterFree, t) + ITEMS[EDVD].boosterH * 60;
            }
            if (day !== refillDay && E < 20) refill(day);
            train();
            if (took) spendSpecial();
            energyBoost(t, day);
        } else if (id === 'candyXanax') {
            // Once a day the Xanax waits for a tick, then candy + Xanax and train it (no Ecstasy: the candy happy lasts one session).
            if (t >= drugFree && doneDay !== day) {
                if (t % 15 === TICK_OFFSET_MIN) {
                    H += candyN * candyHappy;
                    buy(candyId, candyN);
                    boosterFree = Math.max(boosterFree, t) + candyN * ITEMS[candyId].boosterH * 60;
                    xanax(t);
                    train();
                    if (day !== refillDay) {
                        refill(day);
                        train();
                    }
                    spendSpecial();
                    doneDay = day;
                }
            } else {
                if (t >= drugFree) xanax(t);
                if (day !== refillDay && E < 20 && doneDay === day) refill(day);
                train();
            }
        } else if (id === 'dailyChoco') {
            // Hold one Xanax's worth of cooldown, then candy + Ecstasy in its place.
            if (phase === 'hold' && t >= drugFree && t % 15 === TICK_OFFSET_MIN) {
                H = (H + candyN * candyHappy) * 2;
                buy(candyId, candyN);
                buy(ECSTASY);
                drugFree = t + ecsCD;
                train();
                refill(day);
                train();
                spendSpecial();
                phase = 'done';
                doneDay = day;
            } else if (phase !== 'hold' && t >= drugFree) {
                xanax(t);
                if (doneDay !== day) phase = 'hold';
            }
            if (phase !== 'hold') train();
        } else {
            // Jumps: stack Xanax without training, then boost just after a tick and train it all.
            if (phase === 'stack' && t >= drugFree) {
                xanax(t);
                stacked++;
                if (stacked === stackTo) phase = 'wait';
            }
            if (phase === 'wait' && t >= drugFree && t % 15 === TICK_OFFSET_MIN) {
                if (isConsole) {
                    // 300 energy on the console for happy, a little candy, then the Ecstasy doubles it [verify].
                    const uses = Math.min(CONSOLE_USES, Math.floor(E / CONSOLE_ENERGY_EACH));
                    E -= uses * CONSOLE_ENERGY_EACH;
                    H = (H + uses * consoleHappy + CONSOLE_CANDY * candyHappy) * 2;
                    buy(candyId, CONSOLE_CANDY);
                } else if (id === 'chocoJump') {
                    H = (H + candyN * candyHappy) * 2;
                    buy(candyId, candyN);
                } else {
                    H = (H + edvdN * edvdHappy) * 2;
                    buy(EDVD, edvdN);
                }
                H = Math.min(HAPPY_CAP, H);
                buy(ECSTASY);
                drugFree = t + ecsCD;
                train();
                if (day !== refillDay) {
                    refill(day);
                    train();
                }
                spendSpecial();
                phase = 'stack';
                stacked = 0;
            }
        }
    }
    daily.push(Math.round(totalOf(S) - start));
    const perStat = {};
    for (const k of STATS) perStat[k] = Math.round(S[k] - o.stats[k]);
    return { id, gained: Math.round(totalOf(S) - start), perStat, cost: Math.round(cost), energyTrained: trainedE, daily, used };
}

/** Which strategies can run at all for this player (items, cooldown caps, a book). */
export function feasibleStrategies({ bliss = false, boosterCapH = BOOSTER_CAP_H, toyShop5 = false, adultNovelties10 = false } = {}) {
    return STRATEGY_IDS.filter((id) => {
        if (id === 'blissSteady') return bliss;
        // The 99k jump only differs from the EDVD jump when faction perks raise the booster cap.
        if (id === 'happy99k') return boosterCapH > BOOSTER_CAP_H;
        // Needs the ladder's choice of FHC or cans and how many a day: the caller adds it.
        if (id === 'steadyBoost') return false;
        // In that job the variant replaces the plain plan (the same plan with the perk).
        if (id === 'consoleJumpToy') return toyShop5;
        if (id === 'consoleJump') return !toyShop5;
        if (id === 'edvdJumpAN') return adultNovelties10;
        if (id === 'edvdJump') return !adultNovelties10;
        return true;
    });
}
