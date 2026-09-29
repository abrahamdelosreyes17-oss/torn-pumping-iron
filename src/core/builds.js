/*
 * Builds (how the total splits across the four stats) and the per-session
 * energy split toward one. Pure; ENGINE-SPEC §7, research-builds-gympage.md.
 */

import { STATS, gainPerTrain, HAPPY_LOSS_PER_ENERGY, totalOf } from './gain.js';
import { gymAccess, gymById, bestGymFor, GYMS, BALBOAS, FRONTLINE, GYM_3000, ISOYAMAS, ELITES, TOTAL_REBOUND, GEORGES } from './gyms.js';

/** Share of the total, per stat. The first listed gyms are the ones the build relies on. */
export const BUILDS = {
    balanced: { id: 'balanced', name: 'Balanced', shares: { str: 0.25, spd: 0.25, def: 0.25, dex: 0.25 }, gyms: [GEORGES], line: 'Even split. No specialist gym, no stat for merits to lift.' },
    baldr: { id: 'baldr', name: "Baldr's", shares: { str: 0.309, spd: 0.247, def: 0.222, dex: 0.222 }, gyms: [GYM_3000, FRONTLINE], line: 'One stat high, its partner close. Easy to leave.' },
    baldrDef: { id: 'baldrDef', name: "Baldr's defensive", shares: { str: 0.222, spd: 0.222, def: 0.309, dex: 0.247 }, gyms: [ISOYAMAS, BALBOAS], line: 'Hard to hit and hard to hurt.' },
    hank: { id: 'hank', name: "Hank's", shares: { str: 0.347, spd: 0.097, def: 0.278, dex: 0.278 }, gyms: [GYM_3000, BALBOAS], line: 'Fastest total growth, weakest in a fight.' },
    hankDef: { id: 'hankDef', name: "Hank's defensive", shares: { str: 0.278, spd: 0.278, def: 0.347, dex: 0.097 }, gyms: [ISOYAMAS, FRONTLINE], line: 'Same idea with DEF high.' },
    tank: { id: 'tank', name: 'Tank', shares: { str: 0.19, spd: 0.19, def: 0.31, dex: 0.31 }, gyms: [BALBOAS], line: 'Survives attacks; slow to win your own.' },
    offense: { id: 'offense', name: 'Offense', shares: { str: 0.31, spd: 0.31, def: 0.19, dex: 0.19 }, gyms: [FRONTLINE], line: 'Hits often and hard; takes hits badly.' },
};

/**
 * The builds you pick from. Baldr's and Hank's take a high stat you choose
 * (their defensive versions are DEF or DEX high), then the pair builds, and
 * Balanced last.
 */
export const BUILD_ORDER = ['baldr', 'hank', 'tank', 'offense', 'balanced'];

/** Old ids of the defensive presets, as a base + high stat. */
export const BUILD_ALIASES = { baldrDef: 'baldr:def', hankDef: 'hank:def' };

/**
 * Until you pick, plans work toward Baldr's with STR high (a specialist build
 * that stays close to even), and Home asks you to pick. The owner's rule:
 * specialist builds are the meta; the plan follows the build you choose.
 */
export const DEFAULT_BUILD = 'baldr';

/** Builds with a high stat you choose (the single-stat specialist gym and your merits go there). */
export function highStatOf(buildId) {
    const id = BUILD_ALIASES[buildId] || String(buildId || DEFAULT_BUILD);
    const [base, high] = id.split(':');
    const b = BUILDS[base];
    if (!b) return null;
    const sorted = [...STATS].sort((x, y) => b.shares[y] - b.shares[x]);
    // A single high stat only when it clearly leads (Tank, Offense and Balanced have none).
    if (!(b.shares[sorted[0]] - b.shares[sorted[1]] > 0.02)) return null;
    return STATS.includes(high) ? high : sorted[0];
}

/** Within this many percentage points of the target counts as "on build". */
export const ON_BUILD_PP = 0.5;

const SINGLE = { str: GYM_3000, def: ISOYAMAS, spd: TOTAL_REBOUND, dex: ELITES };
const PAIR_OF = { str: FRONTLINE, spd: FRONTLINE, def: BALBOAS, dex: BALBOAS };

/** The same-side partner of each stat (STR+SPD attack, DEF+DEX defence). */
const PARTNER = { str: 'spd', spd: 'str', def: 'dex', dex: 'def' };

/**
 * A preset with its high stat moved, keeping its shape: Baldr's on DEX is
 * DEX high with DEF (its partner) close behind, using Elites + Balboas;
 * Hank's on DEF is Hank's defensive. The stat's partner follows it, the
 * other pair swaps sides when needed, and the gyms follow the stats.
 */
export function withHighStat(buildId, stat) {
    const b = BUILDS[buildId];
    if (!b || !STATS.includes(stat)) return null;
    const high = STATS.reduce((a, k) => (b.shares[k] > b.shares[a] ? k : a), 'str');
    if (high === stat) return b;
    const to = {};
    if (PARTNER[high] === stat) {
        to[high] = stat;
        to[stat] = high;
        for (const k of STATS) if (!(k in to)) to[k] = k;
    } else {
        to[high] = stat;
        to[PARTNER[high]] = PARTNER[stat];
        to[stat] = high;
        to[PARTNER[stat]] = PARTNER[high];
    }
    const shares = {};
    for (const k of STATS) shares[to[k]] = b.shares[k];
    const gymOf = {};
    for (const k of STATS) {
        gymOf[SINGLE[k]] = SINGLE[to[k]];
        gymOf[PAIR_OF[k]] = PAIR_OF[to[k]];
    }
    const gyms = b.gyms.map((id) => gymOf[id] || id);
    return { ...b, id: buildId + ':' + stat, shares, gyms };
}

const HIGH_WORD = { str: 'STR', spd: 'SPD', def: 'DEF', dex: 'DEX' };

/** A build id ("hank", "hank:def", "baldrDef") as the build the plan uses, named with its high stat. */
export function resolveBuild(buildId) {
    const id = BUILD_ALIASES[buildId] || String(buildId || DEFAULT_BUILD);
    const [base] = id.split(':');
    if (!BUILDS[base]) return resolveBuild(DEFAULT_BUILD);
    const high = highStatOf(id);
    if (!high) return BUILDS[base];
    const b = withHighStat(base, high) || BUILDS[base];
    return { ...b, base, high, name: BUILDS[base].name + ', ' + HIGH_WORD[high] + ' high' };
}

/** Each stat's share of the total, and its gap to the build (in stat points). */
export function buildGaps(stats, shares) {
    const total = totalOf(stats);
    const out = {};
    for (const k of STATS) {
        const share = total > 0 ? stats[k] / total : 0;
        out[k] = { share, target: shares[k], gap: Math.max(0, shares[k] * total - stats[k]), over: share > shares[k] + ON_BUILD_PP / 100 };
    }
    return out;
}

/** True when every stat is within ON_BUILD_PP of the build. */
export function onBuild(stats, shares) {
    const g = buildGaps(stats, shares);
    return STATS.every((k) => Math.abs(g[k].share - shares[k]) * 100 <= ON_BUILD_PP);
}

/** Would these stats still have every gym in `keep` (ids)? */
function keepsGyms(stats, keep) {
    return keep.every((id) => gymAccess(gymById(id), stats).ok);
}

/**
 * How many trains of `stat` at `gym` before a gym in `keep` is lost
 * ("Stop at 18 trains: more loses Balboas"). Also stops at `maxTrains`.
 * @returns {{trains:number, gain:number, breaks:object|null}}
 */
export function allowedTrains({ stat, stats, gym, happy, perks = 1, keep = [], maxTrains = Infinity }) {
    const s = { ...stats };
    let h = happy;
    let n = 0;
    let gain = 0;
    const cap = Number.isFinite(maxTrains) ? maxTrains : 100000;
    const keepNow = keep.filter((id) => gymAccess(gymById(id), s).ok);
    while (n < cap) {
        const d = gainPerTrain(stat, s[stat], h, gym.dots[stat], gym.energy, perks);
        const after = { ...s, [stat]: s[stat] + d };
        const broken = keepNow.find((id) => !gymAccess(gymById(id), after).ok);
        if (broken) return { trains: n, gain, breaks: gymById(broken) };
        s[stat] = after[stat];
        gain += d;
        n++;
        h = Math.max(0, h - HAPPY_LOSS_PER_ENERGY * gym.energy);
    }
    return { trains: n, gain, breaks: null };
}

/**
 * Split one session's energy across the stats, one train at a time, each
 * to the stat furthest below its share (GTG+ runBalance), at that stat's best
 * unlocked and accessible gym. A train that would lose a gym in `keep` is
 * never planned; that stat gets `stopAt`.
 *
 * @param {object} o
 * @param {object} o.stats - {str,spd,def,dex}
 * @param {object} o.shares - target shares
 * @param {number} o.energy - energy to spend
 * @param {number} o.happy - happy at the start
 * @param {number[]} o.unlocked - unlocked gym ids
 * @param {object} [o.perks] - per-stat multipliers {str,...}
 * @param {number[]} [o.keep] - gym ids the plan relies on
 * @param {object[]} [o.table] - gym table
 * @param {number} [o.happyLossMult] - Goal Oriented perk etc.
 * @returns {{perStat:object, gain:number, energyUsed:number, energyLeft:number, happyAfter:number, statsAfter:object, order:string[]}}
 */
export function splitSession({ stats, shares, energy, happy, unlocked, perks = null, keep = [], table = GYMS, drugsTaken = null, happyLossMult = 1, active = null }) {
    const s = { ...stats };
    let h = happy;
    let left = energy;
    const perStat = {};
    for (const k of STATS) perStat[k] = { trains: 0, energy: 0, gain: 0, gym: null, stopAt: null, stopReason: null };
    const blocked = new Set();
    const keepNow = keep.filter((id) => gymAccess(gymById(id, table), s).ok);
    const order = [];
    for (let guard = 0; guard < 100000; guard++) {
        const total = totalOf(s);
        let pick = null;
        let best = -Infinity;
        for (const k of STATS) {
            if (blocked.has(k)) continue;
            const gym = bestGymFor(k, s, unlocked, { table, drugsTaken, active });
            if (!gym || gym.energy > left) continue;
            const deficit = shares[k] - (total > 0 ? s[k] / total : 0);
            if (deficit > best) {
                best = deficit;
                pick = { k, gym };
            }
        }
        if (!pick) break;
        const { k, gym } = pick;
        const d = gainPerTrain(k, s[k], h, gym.dots[k], gym.energy, perks ? perks[k] : 1);
        const after = { ...s, [k]: s[k] + d };
        const broken = keepNow.find((id) => !gymAccess(gymById(id, table), after).ok);
        if (broken) {
            blocked.add(k);
            perStat[k].stopAt = perStat[k].trains;
            perStat[k].stopReason = gymById(broken, table).name;
            continue;
        }
        s[k] = after[k];
        h = Math.max(0, h - HAPPY_LOSS_PER_ENERGY * gym.energy * happyLossMult);
        left -= gym.energy;
        const p = perStat[k];
        p.trains++;
        p.energy += gym.energy;
        p.gain += d;
        p.gym = gym;
        if (order[order.length - 1] !== k) order.push(k);
    }
    const gain = STATS.reduce((a, k) => a + perStat[k].gain, 0);
    return { perStat, gain, energyUsed: energy - left, energyLeft: left, happyAfter: h, statsAfter: s, order };
}

/**
 * Trains per stat for each of the next `days` days at `energyPerDay`, and
 * the day the build is reached (null if not within `days`).
 */
export function projectBuild({ stats, shares, energyPerDay, happy, unlocked, perks = null, keep = [], days = 7, sessionsPerDay = 6, table = GYMS, active = null }) {
    let s = { ...stats };
    const out = [];
    let reachedDay = onBuild(s, shares) ? 0 : null;
    const perSession = Math.floor(energyPerDay / sessionsPerDay);
    for (let d = 1; d <= days; d++) {
        const day = { str: 0, spd: 0, def: 0, dex: 0, gain: 0 };
        let left = energyPerDay;
        for (let i = 0; i < sessionsPerDay && left > 0; i++) {
            const e = i === sessionsPerDay - 1 ? left : Math.min(left, perSession);
            // Happy is back at its usual level at the start of each session (regeneration + Xanax).
            const r = splitSession({ stats: s, shares, energy: e, happy, unlocked, perks, keep, table, active });
            for (const k of STATS) day[k] += r.perStat[k].trains;
            day.gain += r.gain;
            left -= r.energyUsed;
            s = r.statsAfter;
            if (r.energyUsed === 0) break;
        }
        out.push(day);
        if (reachedDay === null && onBuild(s, shares)) reachedDay = d;
    }
    return { days: out, reachedDay, statsAfter: s };
}
