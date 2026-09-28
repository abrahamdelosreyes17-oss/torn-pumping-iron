/*
 * Gyms: the table, specialist rules and which gym is best for each stat.
 * Pure. The table is Torn's /torn/gyms dump (research-gym.md); the live
 * list replaces it by id when the API answers (mergeLiveGyms).
 */

import { STATS, STAT_API } from './gain.js';

/** [id, name, energy per train, cost, str, spd, def, dex] */
const GYM_ROWS = [
    [1, 'Premier Fitness', 5, 10, 2.0, 2.0, 2.0, 2.0],
    [2, 'Average Joes', 5, 100, 2.4, 2.4, 2.7, 2.4],
    [3, "Woody's Workout Club", 5, 250, 2.7, 3.2, 3.0, 2.7],
    [4, 'Beach Bods', 5, 500, 3.2, 3.2, 3.2, 0],
    [5, 'Silver Gym', 5, 1000, 3.4, 3.6, 3.4, 3.2],
    [6, 'Pour Femme', 5, 2500, 3.4, 3.6, 3.6, 3.8],
    [7, 'Davies Den', 5, 5000, 3.7, 0, 3.7, 3.7],
    [8, 'Global Gym', 5, 10000, 4.0, 4.0, 4.0, 4.0],
    [9, 'Knuckle Heads', 10, 50000, 4.8, 4.4, 4.0, 4.2],
    [10, 'Pioneer Fitness', 10, 100000, 4.4, 4.6, 4.8, 4.4],
    [11, 'Anabolic Anomalies', 10, 250000, 5.0, 4.6, 5.2, 4.6],
    [12, 'Core', 10, 500000, 5.0, 5.2, 5.0, 5.0],
    [13, 'Racing Fitness', 10, 1000000, 5.0, 5.4, 4.8, 5.2],
    [14, 'Complete Cardio', 10, 2000000, 5.5, 5.7, 5.5, 5.2],
    [15, 'Legs, Bums and Tums', 10, 3000000, 0, 5.5, 5.5, 5.7],
    [16, 'Deep Burn', 10, 5000000, 6.0, 6.0, 6.0, 6.0],
    [17, 'Apollo Gym', 10, 7500000, 6.0, 6.2, 6.4, 6.2],
    [18, 'Gun Shop', 10, 10000000, 6.5, 6.4, 6.2, 6.2],
    [19, 'Force Training', 10, 15000000, 6.4, 6.5, 6.4, 6.8],
    [20, "Cha Cha's", 10, 20000000, 6.4, 6.4, 6.8, 7.0],
    [21, 'Atlas', 10, 30000000, 7.0, 6.4, 6.4, 6.5],
    [22, 'Last Round', 10, 50000000, 6.8, 6.5, 7.0, 6.5],
    [23, 'The Edge', 10, 75000000, 6.8, 7.0, 7.0, 6.8],
    [24, "George's", 10, 100000000, 7.3, 7.3, 7.3, 7.3],
    [25, 'Balboas Gym', 25, 50000000, 0, 0, 7.5, 7.5],
    [26, 'Frontline Fitness', 25, 50000000, 7.5, 7.5, 0, 0],
    [27, 'Gym 3000', 50, 100000000, 8.0, 0, 0, 0],
    [28, 'Mr. Isoyamas', 50, 100000000, 0, 0, 8.0, 0],
    [29, 'Total Rebound', 50, 100000000, 0, 8.0, 0, 0],
    [30, 'Elites', 50, 100000000, 0, 0, 0, 8.0],
    [31, 'Sports Science Lab', 25, 500000000, 9.0, 9.0, 9.0, 9.0],
    [33, 'Jail Gym', 5, 0, 3.4, 3.4, 4.6, 0],
];

export const GEORGES = 24;
export const BALBOAS = 25;
export const FRONTLINE = 26;
export const GYM_3000 = 27;
export const ISOYAMAS = 28;
export const TOTAL_REBOUND = 29;
export const ELITES = 30;
export const SSL = 31;
export const JAIL_GYM = 33;

/** The single-stat specialist gym of each stat. */
export const SINGLE_GYM = { str: GYM_3000, def: ISOYAMAS, spd: TOTAL_REBOUND, dex: ELITES };

/** Specialist access ratio: 1.25 (research-builds-gympage.md). */
export const SPECIALIST_RATIO = 1.25;

/** [calibrate] Sports Science Lab: at most this many Xanax + Ecstasy taken, ever (research-gym.md "uncertain vs 50+50"). */
export const SSL_DRUG_LIMIT = 150;

/** [calibrate] Specialist gyms open once George's is unlocked (unconfirmed; the stat rule is the hard part). */
export const SPECIALIST_NEEDS_GYM = GEORGES;

/**
 * Energy (gym experience) to unlock the NEXT ladder gym, from gym 1 → 2 up to
 * The Edge → George's. The Music Store's "30% gym experience" divides these.
 */
export const UNLOCK_ENERGY = [200, 500, 1000, 2000, 2750, 3000, 3500, 4000, 6000, 7000, 8000, 11000, 12420, 18000, 18100, 24140, 31260, 36610, 46640, 56520, 67775, 84535, 106305];

function rowToGym([id, name, energy, cost, str, spd, def, dex]) {
    return { id, name, energy, cost, dots: { str, spd, def, dex }, specialist: id >= 25 && id <= 31 };
}

export const GYMS = GYM_ROWS.map(rowToGym);

export function gymById(id, table = GYMS) {
    return table.find((g) => g.id === Number(id)) || null;
}

/**
 * Live /v2/torn/gyms replaces the table by id. `modifiers` are displayed dots
 * (7.3); an older v1 dump used ×10 integers, which are scaled back.
 */
export function mergeLiveGyms(apiGyms, table = GYMS) {
    const list = Array.isArray(apiGyms) ? apiGyms : apiGyms && typeof apiGyms === 'object' ? Object.entries(apiGyms).map(([id, g]) => ({ id: Number(id), ...g })) : [];
    const out = table.map((g) => ({ ...g, dots: { ...g.dots } }));
    for (const live of list) {
        const id = Number(live && live.id);
        if (!id) continue;
        let g = out.find((x) => x.id === id);
        if (!g) {
            g = { id, name: String(live.name || 'Gym ' + id), energy: 10, cost: 0, dots: { str: 0, spd: 0, def: 0, dex: 0 }, specialist: false };
            out.push(g);
        }
        if (live.name) g.name = String(live.name);
        if (Number(live.energy_cost) > 0) g.energy = Number(live.energy_cost);
        if (Number.isFinite(Number(live.cost))) g.cost = Number(live.cost);
        const mods = live.modifiers || live.stats || null;
        if (mods && typeof mods === 'object') {
            for (const k of STATS) {
                const v = Number(mods[STAT_API[k]]);
                if (Number.isFinite(v)) g.dots[k] = v > 12 ? v / 10 : v; // real dots never pass 9
            }
        }
    }
    return out.sort((a, b) => a.id - b.id);
}

/** Energy to unlock the ladder gym after `fromId` (null past George's). */
export function unlockEnergyAfter(fromId, gymExpMult = 1) {
    const e = UNLOCK_ENERGY[Number(fromId) - 1];
    return e === undefined ? null : Math.ceil(e / (gymExpMult || 1));
}

/**
 * Ladder gyms unlocked, inferred from the active gym (the API gives only
 * that). A specialist or the Jail Gym being active tells us George's is done.
 * `known` (read from the gym page's buttons) wins when present.
 */
export function unlockedGyms(activeId, known = null) {
    if (Array.isArray(known) && known.length) return [...new Set(known.map(Number))].sort((a, b) => a - b);
    const id = Number(activeId) || 1;
    const top = id >= 25 && id <= 31 ? GEORGES : id === JAIL_GYM ? 1 : Math.min(id, GEORGES);
    const out = [];
    for (let i = 1; i <= top; i++) out.push(i);
    if (id >= 25 && id <= 31) out.push(id);
    return out;
}

/** The second-highest stat other than `stat`. */
function highestOther(stats, stat) {
    return Math.max(...STATS.filter((k) => k !== stat).map((k) => Number(stats[k]) || 0));
}

/**
 * Can the player use this gym with these stats right now?
 * @returns {{ok:boolean, reason:string|null}}
 */
export function gymAccess(gym, stats, { drugsTaken = null } = {}) {
    if (!gym) return { ok: false, reason: 'Unknown gym' };
    const s = { str: +stats.str || 0, spd: +stats.spd || 0, def: +stats.def || 0, dex: +stats.dex || 0 };
    switch (gym.id) {
        case BALBOAS:
            return s.def + s.dex >= SPECIALIST_RATIO * (s.str + s.spd) ? { ok: true, reason: null } : { ok: false, reason: 'DEF + DEX under 1.25 × STR + SPD' };
        case FRONTLINE:
            return s.str + s.spd >= SPECIALIST_RATIO * (s.def + s.dex) ? { ok: true, reason: null } : { ok: false, reason: 'STR + SPD under 1.25 × DEF + DEX' };
        case GYM_3000:
        case ISOYAMAS:
        case TOTAL_REBOUND:
        case ELITES: {
            const stat = Object.keys(SINGLE_GYM).find((k) => SINGLE_GYM[k] === gym.id);
            return s[stat] >= SPECIALIST_RATIO * highestOther(s, stat) ? { ok: true, reason: null } : { ok: false, reason: stat.toUpperCase() + ' under 1.25 × your next-highest stat' };
        }
        case SSL:
            if (drugsTaken === null || drugsTaken === undefined) return { ok: true, reason: null };
            return drugsTaken <= SSL_DRUG_LIMIT ? { ok: true, reason: null } : { ok: false, reason: 'More than ' + SSL_DRUG_LIMIT + ' Xanax and Ecstasy taken' };
        default:
            return { ok: true, reason: null };
    }
}

/**
 * The best gym for a stat among the unlocked, accessible ones. Gain per
 * energy is proportional to dots, whatever the energy per train, so the
 * highest dots wins; on a tie, the cheaper train (less leftover energy).
 */
export function bestGymFor(stat, stats, unlockedIds, { table = GYMS, drugsTaken = null, active = null } = {}) {
    let best = null;
    for (const id of unlockedIds || []) {
        const g = gymById(id, table);
        if (!g || !(g.dots[stat] > 0)) continue;
        if (!gymAccess(g, stats, { drugsTaken }).ok) continue;
        if (!best || g.dots[stat] > best.dots[stat]) best = g;
        else if (g.dots[stat] === best.dots[stat]) {
            // A tie: stay in the gym you're in (no switch for nothing), else the cheaper train.
            if (g.id === Number(active) || (best.id !== Number(active) && g.energy < best.energy)) best = g;
        }
    }
    return best;
}

/**
 * The next ladder gym and how far away it is.
 * @param {number} activeId
 * @param {number|null} progressE - gym experience already earned toward it (from the gym page), or null
 * @param {number} energyPerDay
 */
export function nextGym(activeId, progressE, energyPerDay, { gymExpMult = 1, table = GYMS } = {}) {
    const id = Number(activeId);
    if (!(id >= 1 && id < GEORGES)) return null;
    const need = unlockEnergyAfter(id, gymExpMult);
    const left = Math.max(0, need - (Number(progressE) || 0));
    const g = gymById(id + 1, table);
    return { gym: g, energyLeft: left, days: energyPerDay > 0 ? left / energyPerDay : null, cost: g ? g.cost : null };
}
