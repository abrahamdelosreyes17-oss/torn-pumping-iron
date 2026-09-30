/*
 * Builds (how the total splits across the four stats) and the per-session
 * energy split toward one. Pure; ENGINE-SPEC §7, research-builds-gympage.md.
 */

import { STATS, gainPerTrain, HAPPY_LOSS_PER_ENERGY, STAT_AB, effectiveStat, totalOf, happyTerms } from './gain.js';
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
 * Which rule gives each train its stat (ENGINE-SPEC §7):
 * - 'speed' (1.3.0): the train that moves you furthest toward the build per
 *   energy: its gain per energy (the stat's value, happy now, the gym's dots,
 *   perks) times how far the stat is under its build share. A stat at or
 *   over its share never gets one while another stat is under, so the plan
 *   never drifts from the build you picked.
 * - 'deficit' (up to 1.2): always the stat furthest under its share
 *   (GTG+ runBalance). Kept for the simulator check (test/split-sim.test.js).
 */
export const SPLIT_RULE = 'speed';

/**
 * [tuned: test/split-sim.test.js] How much the happy you have now counts.
 * Steady training runs happy down (about 0.5 per energy; regeneration and
 * Xanax give back less), so the trains a stat doesn't get now come later,
 * at lower happy. Happy adds about the same amount to every train: a big
 * part of a low stat's gain, a small part of a high stat's. So the
 * high-happy trains go to the stats they lift most: each value is also
 * multiplied by (gain now ÷ gain at SPLIT_HAPPY_REF) ^ SPLIT_HAPPY_WEIGHT.
 * Without it (0) the friend's low stats wait until happy has run out and
 * a steady 90 days ends ~1.5% lower than the old rule; 6 keeps it level.
 */
export const SPLIT_HAPPY_WEIGHT = 6;

/** [calibrate] The happy later trains happen at: steady training runs it down to about 0 (the simulator). */
export const SPLIT_HAPPY_REF = 0;

/** pickStat's two passes: stats more than the on-build band under their share, then any under it. */
const CUTS = [ON_BUILD_PP / 100, 0];

/** gainPerTrain's bracket (before × dots × energy × perks ÷ 200,000): what a train gains per energy, up to that factor. */
function innerGain(stat, eff, t) {
    const [A, B] = STAT_AB[stat];
    return Math.max(0, eff * t.f + t.p + t.q * A + B);
}

/**
 * The stat the next train goes to: the most progress toward the build per
 * energy, value = gain per energy × (gap to its share − band) × happy weight.
 * While any stat is more than the on-build band (ON_BUILD_PP) under its
 * share, only those count, each measured to the band's edge: every stat
 * lands inside the band together, so the build is reached as early as the
 * old rule reaches it. Once all are inside, any stat under its share, the
 * fastest first ("near the build, the fastest mix"). When none of those can
 * train (no gym here, a specialist limit), the old rule's pick, so energy
 * is never left unspent where it used to be spent.
 *
 * @param {{k:string, dots:number, energy:number}[]} cands - stats that can train now, with the gym's dots and energy per train
 * @param {object} s - stats now
 * @param {object} shares - build shares
 * @param {number} happy - happy now (it falls with every train)
 * @param {object|null} [perks] - per-stat multipliers
 * @param {string} [rule]
 * @param {number} [happyRef] - the happy later trains happen at (SPLIT_HAPPY_REF; the build projection, which starts
 *   every session at the same happy, passes that happy)
 * @param {number|null} [happyMax] - the property's max happy: a boost above it is weighed as if at the max (every
 *   train of a jump is boosted, so the boost itself says nothing about which stat should get it)
 * @returns {object|null} the chosen candidate
 */
export function pickStat(cands, s, shares, happy, perks = null, rule = SPLIT_RULE, happyRef = SPLIT_HAPPY_REF, happyMax = null) {
    const total = totalOf(s);
    if (rule !== 'deficit') {
        const hNow = happyMax !== null && happy > happyMax ? happyMax : happy;
        const weigh = SPLIT_HAPPY_WEIGHT > 0 && hNow !== happyRef;
        // The happy parts of the formula are the same for every stat: once per pick (this runs for every simulated train).
        const tNow = happyTerms(happy);
        const tAt = hNow === happy ? tNow : happyTerms(hNow);
        const tRef = weigh ? happyTerms(happyRef) : null;
        for (const cut of CUTS) {
            let pick = null;
            let best = 0;
            for (const c of cands) {
                const w = shares[c.k] - (total > 0 ? s[c.k] / total : 0) - cut;
                if (!(w > 0)) continue;
                const eff = effectiveStat(s[c.k]);
                // Gain per energy up to the same factor for every stat (dots × perks ÷ 200,000).
                const scale = c.dots * (perks ? perks[c.k] : 1);
                const now = innerGain(c.k, eff, tNow) * scale;
                let v = now * w;
                if (weigh) {
                    const later = innerGain(c.k, eff, tRef);
                    if (later > 0) v *= Math.pow((tAt === tNow ? now / scale : innerGain(c.k, eff, tAt)) / later, SPLIT_HAPPY_WEIGHT);
                }
                if (v > best) {
                    best = v;
                    pick = c;
                }
            }
            if (pick) return pick;
        }
    }
    let pick = null;
    let best = -Infinity;
    for (const c of cands) {
        const d = shares[c.k] - (total > 0 ? s[c.k] / total : 0);
        if (d > best) {
            best = d;
            pick = c;
        }
    }
    return pick;
}

/**
 * The session's trains as parts, "George's: STR × 12 → Frontline: DEX × 8":
 * one part per gym and stat, the gym you're in first, then each gym in the
 * order the split first used it, so you switch gyms as few times as
 * possible. Replayed in that order (happy falls train by train, specialist
 * access is checked again); when that order would lose a gym the build
 * relies on, or use a gym before its ratio opens, the split's own order is
 * kept instead.
 * @returns {{parts:object[], statsAfter:object, happyAfter:number, gains:number[]}|null}
 */
function groupParts(seq, { stats, happy, perks, keepNow, table, active, happyLossMult }) {
    const byKey = new Map();
    const gymOrder = [];
    for (const x of seq) {
        const key = x.gym.id + ':' + x.k;
        if (!byKey.has(key)) byKey.set(key, { gym: x.gym, stat: x.k, trains: 0 });
        byKey.get(key).trains++;
        if (!gymOrder.includes(x.gym.id)) gymOrder.push(x.gym.id);
    }
    const a = Number(active);
    if (gymOrder.includes(a)) {
        gymOrder.splice(gymOrder.indexOf(a), 1);
        gymOrder.unshift(a);
    }
    const grouped = [];
    for (const id of gymOrder) for (const p of byKey.values()) if (p.gym.id === id) grouped.push(p);
    const replay = (list) => {
        const s = { ...stats };
        let h = happy;
        const gains = [];
        for (const p of list) {
            let g = 0;
            for (let i = 0; i < p.trains; i++) {
                if (p.gym.specialist && !gymAccess(p.gym, s).ok) return null;
                const d = gainPerTrain(p.stat, s[p.stat], h, p.gym.dots[p.stat], p.gym.energy, perks ? perks[p.stat] : 1);
                s[p.stat] += d;
                if (keepNow.some((id) => !gymAccess(gymById(id, table), s).ok)) return null;
                h = Math.max(0, h - HAPPY_LOSS_PER_ENERGY * p.gym.energy * happyLossMult);
                g += d;
            }
            gains.push(g);
        }
        return { s, h, gains };
    };
    let list = grouped;
    let r = replay(grouped);
    if (!r) {
        // The split's own order, consecutive trains of one stat in one gym joined.
        list = [];
        for (const x of seq) {
            const last = list[list.length - 1];
            if (last && last.gym.id === x.gym.id && last.stat === x.k) last.trains++;
            else list.push({ gym: x.gym, stat: x.k, trains: 1 });
        }
        r = replay(list);
        if (!r) return null;
    }
    const parts = list.map((p, i) => ({ gymId: p.gym.id, gymName: p.gym.name, stat: p.stat, trains: p.trains, energy: p.trains * p.gym.energy, perTrain: p.gym.energy, gain: Math.round(r.gains[i]) }));
    return { parts, statsAfter: r.s, happyAfter: r.h, gains: r.gains };
}

/**
 * Split one session's energy across the stats, one train at a time (the
 * stat pickStat chooses), each at that stat's best unlocked and accessible
 * gym. A train that would lose a gym in `keep` is never planned; that stat
 * gets `stopAt`. The trains come back grouped as `parts`, in train order.
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
 * @param {number} [o.active] - the gym you're in (its part comes first)
 * @param {string} [o.rule] - SPLIT_RULE, or 'deficit' (the old rule)
 * @param {number} [o.happyRef] - the happy later trains happen at (pickStat)
 * @param {number} [o.happyMax] - the property's max happy (pickStat)
 * @returns {{perStat:object, gain:number, energyUsed:number, energyLeft:number, happyAfter:number, statsAfter:object, order:string[],
 *   parts:{gymId:number, gymName:string, stat:string, trains:number, energy:number, perTrain:number, gain:number, stopAt?:number, stopReason?:string}[]}}
 */
export function splitSession({ stats, shares, energy, happy, unlocked, perks = null, keep = [], table = GYMS, drugsTaken = null, happyLossMult = 1, active = null, rule = SPLIT_RULE, happyRef = SPLIT_HAPPY_REF, happyMax = null }) {
    const s = { ...stats };
    let h = happy;
    let left = energy;
    const perStat = {};
    for (const k of STATS) perStat[k] = { trains: 0, energy: 0, gain: 0, gym: null, stopAt: null, stopReason: null };
    const blocked = new Set();
    const keepNow = keep.filter((id) => gymAccess(gymById(id, table), s).ok);
    const seq = [];
    for (let guard = 0; guard < 100000; guard++) {
        const cands = [];
        for (const k of STATS) {
            if (blocked.has(k)) continue;
            const gym = bestGymFor(k, s, unlocked, { table, drugsTaken, active });
            if (!gym || gym.energy > left) continue;
            cands.push({ k, gym, dots: gym.dots[k], energy: gym.energy });
        }
        const pick = pickStat(cands, s, shares, h, perks, rule, happyRef, happyMax);
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
        seq.push({ k, gym });
    }
    let statsAfter = s;
    let happyAfter = h;
    let parts = [];
    if (seq.length) {
        const g = groupParts(seq, { stats, happy, perks, keepNow, table, active, happyLossMult });
        if (g) {
            parts = g.parts;
            statsAfter = g.statsAfter;
            happyAfter = g.happyAfter;
            // Gains as trained in the parts' order.
            for (const k of STATS) perStat[k].gain = 0;
            g.parts.forEach((p, i) => (perStat[p.stat].gain += g.gains[i]));
        }
        for (const k of STATS) {
            if (perStat[k].stopAt === null) continue;
            const last = [...parts].reverse().find((p) => p.stat === k);
            if (last) {
                last.stopAt = last.trains;
                last.stopReason = perStat[k].stopReason;
            }
        }
    }
    const order = [];
    for (const p of parts) if (!order.includes(p.stat)) order.push(p.stat);
    const gain = STATS.reduce((a, k) => a + perStat[k].gain, 0);
    return { perStat, gain, energyUsed: energy - left, energyLeft: left, happyAfter, statsAfter, order, parts };
}

/**
 * Trains per stat for each of the next `days` days at `energyPerDay`, and
 * the day the build is reached (null if not within `days`). `catchUp`: per
 * stat, the day it is back within the on-build band of its share (0 = it
 * is already; null = not within `days`).
 */
export function projectBuild({ stats, shares, energyPerDay, happy, unlocked, perks = null, keep = [], days = 7, sessionsPerDay = 6, table = GYMS, active = null, rule = SPLIT_RULE }) {
    let s = { ...stats };
    const out = [];
    let reachedDay = onBuild(s, shares) ? 0 : null;
    const caughtUp = (st, k) => st[k] / Math.max(1, totalOf(st)) >= shares[k] - ON_BUILD_PP / 100;
    const catchUp = {};
    for (const k of STATS) catchUp[k] = caughtUp(s, k) ? 0 : null;
    const perSession = Math.floor(energyPerDay / sessionsPerDay);
    for (let d = 1; d <= days; d++) {
        const day = { str: 0, spd: 0, def: 0, dex: 0, gain: 0 };
        let left = energyPerDay;
        for (let i = 0; i < sessionsPerDay && left > 0; i++) {
            const e = i === sessionsPerDay - 1 ? left : Math.min(left, perSession);
            // Happy is back at its usual level at the start of each session (regeneration + Xanax), so later trains get it too.
            const r = splitSession({ stats: s, shares, energy: e, happy, unlocked, perks, keep, table, active, rule, happyRef: happy });
            for (const k of STATS) day[k] += r.perStat[k].trains;
            day.gain += r.gain;
            left -= r.energyUsed;
            s = r.statsAfter;
            if (r.energyUsed === 0) break;
        }
        out.push(day);
        if (reachedDay === null && onBuild(s, shares)) reachedDay = d;
        for (const k of STATS) if (catchUp[k] === null && caughtUp(s, k)) catchUp[k] = d;
    }
    return { days: out, reachedDay, statsAfter: s, catchUp };
}
