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
import { XANAX, ECSTASY, EDVD, CANDY_KISSES, POINTS, REFILL_POINTS, XANAX_CD_MIN, ECSTASY_CD_MIN, ITEMS, boostersThatFit, BOOSTER_CAP_H } from './items.js';

export const STRATEGY_IDS = ['steady', 'dailyChoco', 'chocoJump', 'edvdJump', 'happy99k', 'blissSteady'];

export const STRATEGIES = {
    steady: { id: 'steady', kind: 'steady', name: 'Steady training', short: 'Steady', what: 'Xanax on cooldown, daily refill, natural energy as it comes' },
    dailyChoco: { id: 'dailyChoco', kind: 'boost', name: 'Daily choco boost', short: 'Daily choco', what: 'Candy + Ecstasy once a day on top of a Xanax' },
    chocoJump: { id: 'chocoJump', kind: 'jump', name: 'Choco jump', short: 'Choco jump', what: 'Stack 4 Xanax, then candy + Ecstasy, train it all' },
    edvdJump: { id: 'edvdJump', kind: 'jump', name: 'EDVD jump', short: 'EDVD jump', what: 'Stack 4 Xanax, then 5 EDVD + Ecstasy' },
    happy99k: { id: 'happy99k', kind: 'jump', name: '99k happy jump', short: '99k jump', what: 'EDVD to the booster cap + Ecstasy, near 99,999 happy' },
    blissSteady: { id: 'blissSteady', kind: 'steady', name: 'Steady with Bliss', short: 'Bliss steady', what: 'Steady, plus EDVD whenever the booster allows; happy keeps climbing' },
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
    const candyHappy = ITEMS[candyId].happy;
    let edvdN = o.edvdCount || 5;
    if (id === 'happy99k' && !o.edvdCount) edvdN = boostersThatFit(EDVD, capH);
    const edvdHappy = ITEMS[EDVD].happy * (o.adultNovelties10 ? 2 : 1);
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
    const used = { [XANAX]: 0, [ECSTASY]: 0, [EDVD]: 0, [candyId]: 0, [POINTS]: 0 };
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

        if (id === 'steady' || id === 'blissSteady') {
            if (t >= drugFree) xanax(t);
            if (id === 'blissSteady' && boosterFree - t < capH * 60) {
                H = Math.min(HAPPY_CAP, H + edvdHappy);
                buy(EDVD);
                boosterFree = Math.max(boosterFree, t) + ITEMS[EDVD].boosterH * 60;
            }
            if (day !== refillDay && E < 20) refill(day);
            train();
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
                if (stacked === JUMP_STACK) phase = 'wait';
            }
            if (phase === 'wait' && t >= drugFree && t % 15 === TICK_OFFSET_MIN) {
                if (id === 'chocoJump') {
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
export function feasibleStrategies({ bliss = false, boosterCapH = BOOSTER_CAP_H } = {}) {
    // The 99k jump only differs from the EDVD jump when faction perks raise the booster cap.
    return STRATEGY_IDS.filter((id) => (id === 'blissSteady' ? bliss : id === 'happy99k' ? boosterCapH > BOOSTER_CAP_H : true));
}
