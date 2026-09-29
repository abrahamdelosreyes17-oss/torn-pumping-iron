/*
 * Fight simulation (ENGINE-SPEC §10): Monte Carlo over the builds a player
 * might have at their estimated battle-stat score, with gear when known.
 * Pure and seeded (the same player gives the same numbers every time).
 * The formulas are the community's (research-targets.md "Fight model");
 * the ones marked [calibrate] are fitted guesses to check against real logs.
 */

/** Chance to hit from SPD (attacker) against DEX (defender). */
export function hitChance(spdAtt, dexDef) {
    if (!(dexDef > 0)) return 1;
    const r = spdAtt / dexDef;
    if (r >= 64) return 1;
    if (r >= 1) return (100 - (50 / 7) * (8 * Math.sqrt(1 / r) - 1)) / 100;
    if (r > 1 / 64) return ((50 / 7) * (8 * Math.sqrt(r) - 1)) / 100;
    return 0;
}

/** Share of damage stopped by DEF (defender) against STR (attacker). */
export function mitigation(defDef, strAtt) {
    if (!(strAtt > 0)) return 1;
    const q = defDef / strAtt;
    if (q >= 14) return 1;
    if (q >= 1) return (50 + (50 * Math.log(q)) / Math.log(14)) / 100;
    if (q > 1 / 32) return (50 + (50 * Math.log(q)) / Math.log(32)) / 100;
    return 0;
}

/** [calibrate] Base damage from STR (community fit, research-targets.md). */
export function baseDamage(str) {
    const l = Math.log10(Math.max(10, str) / 10);
    return 7 * l * l + 27 * l + 30;
}

/**
 * [calibrate] Weapon accuracy (shown as 50 ± modifier) moves the hit chance
 * most near 50% and fades toward 0/100%.
 */
export function withAccuracy(p, acc = 50) {
    return Math.max(0, Math.min(1, p + ((acc - 50) / 100) * 4 * p * (1 - p)));
}

/** [calibrate] Where hits land: crits 12% (×3.5), chest/stomach/groin 35% (×2), limbs 40% (×1), hands/feet 13% (×0.7). */
export const HIT_ZONES = [
    [0.12, 3.5],
    [0.47, 2],
    [0.87, 1],
    [1, 0.7],
];

/** Torn's stalemate: a fight ends after 25 turns. */
export const MAX_TURNS = 25;

/** Gear assumed when unknown: an ordinary weapon and light armour [calibrate]. */
export const DEFAULT_GEAR = { dmg: 50, acc: 50, armour: 25, dmgBonus: 0 };

/** The builds a player of unknown split might have (share of total). */
export const LIKELY_BUILDS = {
    balanced: { str: 0.25, spd: 0.25, def: 0.25, dex: 0.25 },
    defHeavy: { str: 0.2, spd: 0.2, def: 0.35, dex: 0.25 },
    dexHeavy: { str: 0.2, spd: 0.2, def: 0.25, dex: 0.35 },
    hank: { str: 0.347, spd: 0.097, def: 0.278, dex: 0.278 },
    baldr: { str: 0.309, spd: 0.247, def: 0.222, dex: 0.222 },
};

export const BUILD_WORDS = { balanced: 'Balanced', defHeavy: 'DEF-heavy', dexHeavy: 'DEX-heavy', hank: "Hank's", baldr: "Baldr's" };

export function bssOf(s) {
    return Math.sqrt(s.str || 0) + Math.sqrt(s.spd || 0) + Math.sqrt(s.def || 0) + Math.sqrt(s.dex || 0);
}

/** Stats of a build that has a given battle-stat score: total = (BSS / Σ√share)². */
export function statsFromBss(shares, bss) {
    const k = Math.sqrt(shares.str) + Math.sqrt(shares.spd) + Math.sqrt(shares.def) + Math.sqrt(shares.dex);
    const total = (bss / k) ** 2;
    return { str: shares.str * total, spd: shares.spd * total, def: shares.def * total, dex: shares.dex * total, total };
}

export function mulberry32(seed) {
    let a = seed | 0;
    return function () {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function hitZone(rnd) {
    const x = rnd();
    for (const [p, m] of HIT_ZONES) if (x < p) return m;
    return 0.7;
}

/**
 * One fight: you attack, they answer, turn by turn.
 * @param {object} me - {str,spd,def,dex, life}
 * @param {object} them - same
 * @returns {{win:boolean, kept:number, turns:number, stalemate?:boolean}}
 */
export function fightOnce(me, them, rnd, gMe = DEFAULT_GEAR, gThem = DEFAULT_GEAR) {
    let hpMe = me.life;
    let hpThem = them.life;
    const hcMe = withAccuracy(hitChance(me.spd, them.dex), gMe.acc);
    const hcThem = withAccuracy(hitChance(them.spd, me.dex), gThem.acc);
    const dmgMe = baseDamage(me.str) * (gMe.dmg / 10) * (1 - mitigation(them.def, me.str)) * (1 - gThem.armour / 100) * (1 + (gMe.dmgBonus || 0) / 100);
    const dmgThem = baseDamage(them.str) * (gThem.dmg / 10) * (1 - mitigation(me.def, them.str)) * (1 - gMe.armour / 100) * (1 + (gThem.dmgBonus || 0) / 100);
    for (let t = 1; t <= MAX_TURNS; t++) {
        if (rnd() < hcMe) hpThem -= dmgMe * hitZone(rnd);
        if (hpThem <= 0) return { win: true, kept: Math.max(0, hpMe) / me.life, turns: t };
        if (rnd() < hcThem) hpMe -= dmgThem * hitZone(rnd);
        if (hpMe <= 0) return { win: false, kept: 0, turns: t };
    }
    return { win: false, kept: Math.max(0, hpMe) / me.life, turns: MAX_TURNS, stalemate: true };
}

function fightMedian(a) {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.floor(s.length / 2)];
}

/** n fights against one stat line. */
export function simulateFights(me, them, { n = 300, seed = 1, gearMe = DEFAULT_GEAR, gearThem = DEFAULT_GEAR } = {}) {
    const rnd = mulberry32(seed);
    let wins = 0;
    const kept = [];
    const turns = [];
    for (let i = 0; i < n; i++) {
        const r = fightOnce(me, them, rnd, gearMe, gearThem);
        if (r.win) {
            wins++;
            kept.push(r.kept);
            turns.push(r.turns);
        }
    }
    return { pWin: wins / n, keptMedian: fightMedian(kept), turnsMedian: fightMedian(turns) };
}

/**
 * The forecast Torn Eye shows: win chance and HP kept, over the likely
 * builds (or the exact stats when a spy gave them).
 * @param {object} o
 * @param {object} o.me - {str,spd,def,dex,life}
 * @param {object} o.target - {stats?} or {bss}, and {life, id}
 * @returns {{pWin, keep, turns, perBuild:{[build]:{pWin, keep}}, exact:boolean}}
 */
export function forecast({ me, target, gearMe = DEFAULT_GEAR, gearThem = DEFAULT_GEAR, n = 300 }) {
    const seed = (Number(target.id) || 7) * 2654435761;
    const lines = target.stats && target.stats.str ? { exact: target.stats } : Object.fromEntries(Object.entries(LIKELY_BUILDS).map(([k, sh]) => [k, statsFromBss(sh, target.bss)]));
    const perBuild = {};
    let pw = 0;
    const keeps = [];
    const turns = [];
    for (const [k, st] of Object.entries(lines)) {
        const r = simulateFights(me, { ...st, life: target.life }, { n, seed: seed + k.length, gearMe, gearThem });
        perBuild[k] = { pWin: r.pWin, keep: r.keptMedian };
        pw += r.pWin;
        if (r.keptMedian !== null) keeps.push(r.keptMedian);
        if (r.turnsMedian !== null) turns.push(r.turnsMedian);
    }
    const count = Object.keys(lines).length;
    return { pWin: pw / count, keep: fightMedian(keeps), turns: fightMedian(turns), perBuild, exact: Boolean(lines.exact) };
}

/** [calibrate] Respect for a win: base(level) × fair fight (Torn's, ≤ 3) × chain/war/retal/overseas. */
export function respectFor(level, ff, { chainHit = 0, war = false, retal = false, overseas = false } = {}) {
    const base = 1 + (Number(level) || 1) / 200;
    const chain = chainHit >= 11 ? 0.25 * Math.log10(chainHit) + 0.75 : 1;
    return base * Math.max(1, Math.min(3, ff || 1)) * chain * (war ? 2 : 1) * (retal ? 1.5 : 1) * (overseas ? 1.25 : 1);
}

/** Torn's fair fight modifier from the two battle-stat scores (capped at 3). */
export function fairFight(bssDef, bssAtt) {
    return Math.min(3, 1 + (8 / 3) * (bssDef / bssAtt));
}
