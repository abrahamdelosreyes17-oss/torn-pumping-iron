/*
 * How strong is this player? Layered, best source first (ENGINE-SPEC §9):
 *   1. a spy (TornStats), when newer than 30 days: exact stats;
 *   2. your own fights with them: Torn's fair-fight modifier gives their
 *      battle-stat score against yours (1.05 < FF < 3 is informative);
 *   3. FFScouter: their estimate (credited wherever it shows);
 *   4. public stats: TornTools' rank buckets (level, crimes and networth
 *      triggers against the rank title), labelled rough.
 * Every result says where it came from and how old it is.
 */

import { bssOf } from './fight.js';

export const SPY_FRESH_DAYS = 30;
export const FIGHT_FRESH_DAYS = 60;
const DAY_MS_EYE = 86400000;

/** BSS of the defender from Torn's fair-fight modifier: BSS_def = (3/8)(FF − 1) · BSS_me. */
export function bssFromFairFight(ff, myBss) {
    return (3 / 8) * (ff - 1) * myBss;
}

/** Only 1.05 < FF < 3 tells us something; 3 (Torn's cap) is a lower bound. */
export function fairFightInformative(ff) {
    return ff > 1.05 && ff < 3;
}

/** A total for a balanced player with this BSS: BSS = 2√total. */
export function totalFromBss(bss) {
    return (bss / 2) ** 2;
}

export function bssFromTotal(total) {
    return 2 * Math.sqrt(Math.max(0, total));
}

/* TornTools' rank estimate (docs/reference/torntools-torn-utils.ts RANK_TRIGGERS, RANKS). */
export const RANK_TRIGGERS = {
    level: [2, 6, 11, 26, 31, 50, 71, 100],
    crimes: [100, 5000, 10000, 20000, 30000, 50000],
    networth: [5e6, 5e7, 5e8, 5e9, 5e10],
};
export const STAT_BUCKETS = [
    ['under 2k', 0, 2e3],
    ['2k – 25k', 2e3, 25e3],
    ['20k – 250k', 2e4, 25e4],
    ['200k – 2.5M', 2e5, 2.5e6],
    ['2M – 25M', 2e6, 2.5e7],
    ['20M – 250M', 2e7, 2.5e8],
    ['over 200M', 2e8, null],
];
export const RANK_NAMES = ['Absolute beginner', 'Beginner', 'Inexperienced', 'Rookie', 'Novice', 'Below average', 'Average', 'Reasonable', 'Above average', 'Competent', 'Highly competent', 'Veteran', 'Distinguished', 'Highly distinguished', 'Professional', 'Star', 'Master', 'Outstanding', 'Celebrity', 'Supreme', 'Idolized', 'Champion', 'Heroic', 'Legendary', 'Elite', 'Invincible'];

/** "Heroic Hitman" → 23 (the longest known prefix wins: "Highly competent" before "Competent"). */
export function rankNumber(rankTitle) {
    const t = String(rankTitle || '').toLowerCase();
    let best = null;
    RANK_NAMES.forEach((name, i) => {
        if (t.startsWith(name.toLowerCase()) && (!best || name.length > best.len)) best = { n: i + 1, len: name.length };
    });
    return best ? best.n : null;
}

/** The stat bucket TornTools reads from a profile: index into STAT_BUCKETS, or null. */
export function rankBucket({ rank, level, crimes, networth }) {
    const r = typeof rank === 'number' ? rank : rankNumber(rank);
    if (!r) return null;
    const passed = (list, v) => list.filter((x) => (Number(v) || 0) >= x).length;
    const idx = r - passed(RANK_TRIGGERS.level, level) - passed(RANK_TRIGGERS.crimes, crimes) - passed(RANK_TRIGGERS.networth, networth) - 1;
    return idx >= 0 && idx < STAT_BUCKETS.length ? idx : null;
}

/**
 * @param {object} o
 * @param {object} o.me - your stats {str,spd,def,dex}
 * @param {object} [o.spy] - {str,spd,def,dex,total,at}
 * @param {object[]} [o.fights] - your attacks on them, newest first: {ended (s), ff}
 * @param {object} [o.ffs] - normalizeFfsRow() output
 * @param {object} [o.pub] - {rank, level, crimes, networth}
 * @param {number} o.now
 * @returns {{bss, total, stats, source, sourceText, ageDays, confidence, lowerBound, range}|null}
 */
export function estimatePlayer({ me, spy = null, fights = [], ffs = null, pub = null, now }) {
    const myBss = bssOf(me || {});
    const age = (at) => (at ? Math.max(0, Math.round((now - at) / DAY_MS_EYE)) : null);
    if (spy && spy.str && spy.at && now - spy.at < SPY_FRESH_DAYS * DAY_MS_EYE) {
        const stats = { str: spy.str, spd: spy.spd, def: spy.def, dex: spy.dex };
        return { bss: bssOf(stats), total: spy.total || stats.str + stats.spd + stats.def + stats.dex, stats, source: 'spy', sourceText: 'spy ' + age(spy.at) + ' d', ageDays: age(spy.at), confidence: 'exact', lowerBound: false };
    }
    const fight = (fights || []).find((f) => f && fairFightInformative(f.ff) && now - f.ended * 1000 < FIGHT_FRESH_DAYS * DAY_MS_EYE);
    if (fight && myBss > 0) {
        const bss = bssFromFairFight(fight.ff, myBss);
        return { bss, total: totalFromBss(bss), stats: null, source: 'fight', sourceText: 'your fight ' + age(fight.ended * 1000) + ' d', ageDays: age(fight.ended * 1000), confidence: 'good', lowerBound: false };
    }
    const capped = (fights || []).find((f) => f && f.ff >= 3);
    if (ffs && (ffs.fairFight || ffs.bssPublic || ffs.bsEstimate)) {
        let bss;
        if (ffs.fairFight && myBss > 0) bss = bssFromFairFight(ffs.fairFight, myBss);
        else if (ffs.bssPublic) bss = ffs.bssPublic;
        else bss = bssFromTotal(ffs.bsEstimate);
        return { bss, total: ffs.bsEstimate || totalFromBss(bss), stats: null, source: 'ffscouter', sourceText: 'FFScouter ' + (age(ffs.updatedAt) ?? '?') + ' d', ageDays: age(ffs.updatedAt), confidence: 'good', lowerBound: false, distribution: ffs.distribution || null };
    }
    if (capped && myBss > 0) {
        const bss = bssFromFairFight(3, myBss);
        return { bss, total: totalFromBss(bss), stats: null, source: 'fight', sourceText: 'your fight · at least', ageDays: age(capped.ended * 1000), confidence: 'rough', lowerBound: true };
    }
    if (pub) {
        const i = rankBucket(pub);
        if (i !== null) {
            const [label, lo, hi] = STAT_BUCKETS[i];
            // The middle of the bucket on a log scale; the top bucket is open, so its floor ×2.5.
            const total = hi ? Math.sqrt(Math.max(lo, 500) * hi) : lo * 2.5;
            return { bss: bssFromTotal(total), total, stats: null, source: 'public', sourceText: 'public stats', ageDays: 0, confidence: 'rough', lowerBound: !hi, range: label };
        }
    }
    return null;
}
