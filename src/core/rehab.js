/*
 * Rehab and overdoses in a plan's cost (round 8; docs/REHAB-PLAN.md §3, the
 * owner's yes on 2026-10-03). Pure.
 *
 * A Xanax adds 35 addiction points and an Ecstasy 20, less the faction's
 * Toleration cut; 20 points fade every night; what is left is paid off in
 * Switzerland, a session at a time. An overdose is priced as what it is
 * expected to cost: its chance per drug taken, times its 100 points of
 * addiction and the training it stops. The rule prices the habit; it never
 * tells the player when to rehab, and the day's steps do not change.
 *
 * Sources: docs/research-addiction-rehab.md and the owner's drug log (129
 * days, 3 rehabs, 3 overdoses in 95 Xanax). [verify] marks a single source.
 */

/** A rehab session's price before the faction's Excursion cut. */
export const REHAB_PRICE = 250000;
/** Addiction points: per Xanax, per Ecstasy, per overdose [verify: one source], and what fades each night. */
export const ADDICTION = { xanax: 35, ecstasy: 20, overdose: 100, decay: 20 };
/** The chance one drug taken is an overdose: Xanax 2 to 3% (his log: 3.2%), Ecstasy 4 to 6% [verify: forum only]. */
export const OVERDOSE_CHANCE = { xanax: 0.03, ecstasy: 0.05 };

/** Points one session removes: 250,000 ÷ (2,857 + 12.85 × lifetime rehabs): 87 for a new player, fewer with every rehab. */
export function sessionPoints(lifetimeRehabs = 0) {
    return REHAB_PRICE / (2857 + 12.85 * Math.max(0, Number(lifetimeRehabs) || 0));
}

/** The first "N%" in a perk line that speaks of `word`, as a share (0 to 1); 0 when there is none. */
function perkCut(perks, word) {
    let best = 0;
    for (const list of Object.values(perks && typeof perks === 'object' ? perks : {})) {
        for (const line of Array.isArray(list) ? list : []) {
            if (typeof line !== 'string' || !word.test(line)) continue;
            const m = line.match(/(\d+(?:\.\d+)?)\s*%/);
            if (m) best = Math.max(best, Math.min(100, Number(m[1])) / 100);
        }
    }
    return best;
}

/**
 * What rehab costs this player, from what the app reads (never asked).
 * @param {object} o
 * @param {object|null} [o.perks] - /v2/user/perks: Toleration ("Reduces addiction gain by X%", "…risk of overdose
 *   by X%"), Excursion ("Reduces rehabilitation costs by X%"), the Nightclub's cut of the overdose risk
 * @param {object|null} [o.drugs] - /v2/user/personalstats?cat=drugs, slimmed: {rehabs}
 * @returns {{price:number, perSession:number, perPoint:number, keep:number, xanaxChance:number, ecstasyChance:number, rehabs:number|null, rough:boolean}}
 *   `rough`: lifetime rehabs not read yet, so a session is priced as a new player's (the least it can cost)
 */
export function rehabParams({ perks = null, drugs = null } = {}) {
    const rehabs = drugs && Number.isFinite(Number(drugs.rehabs)) ? Number(drugs.rehabs) : null;
    const keep = 1 - Math.min(0.5, perkCut(perks, /addiction/i));
    const odCut = Math.min(0.9, perkCut(perks, /overdos/i));
    const price = REHAB_PRICE * (1 - Math.min(0.2, perkCut(perks, /rehab/i)));
    const perSession = sessionPoints(rehabs || 0);
    return { price, perSession, perPoint: price / perSession, keep, xanaxChance: OVERDOSE_CHANCE.xanax * (1 - odCut), ecstasyChance: OVERDOSE_CHANCE.ecstasy * (1 - odCut), rehabs, rough: rehabs === null };
}

const rehabMedian = (list) => {
    if (!list.length) return 0;
    const s = [...list].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/**
 * The rule on a plan's own days (bursts count: four Xanax in a day are not the month's average).
 * @param {object} o
 * @param {number[]} o.xanDaily - Xanax taken on each day
 * @param {number[]} o.ecsDaily - Ecstasy taken on each day
 * @param {number[]} o.gainDaily - stats gained on each day
 * @param {object} p - rehabParams()
 * @returns {{rehab:number, overdose:number, costDaily:number[], lost:number, factor:number}}
 *   `rehab`: sessions to pay off what the nights do not fade; `overdose`: the expected addiction of overdoses, as
 *   sessions; `lost`: stats an overdose is expected to stop (a Xanax's: a day of the plan; an Ecstasy's: the jump's
 *   gain over a plain day); `factor`: what is left of the plan's gain, 0 to 1
 */
export function rehabOf({ xanDaily = [], ecsDaily = [], gainDaily = [] }, p) {
    const n = Math.max(xanDaily.length, ecsDaily.length, gainDaily.length);
    const total = gainDaily.reduce((a, v) => a + (v || 0), 0);
    const avg = n ? total / n : 0;
    // A plain day: one without Ecstasy (the jump's own gain is what is over it).
    const plain = rehabMedian(gainDaily.filter((_, d) => !(ecsDaily[d] > 0)));
    const costDaily = [];
    let rehab = 0;
    let overdose = 0;
    let lost = 0;
    for (let d = 0; d < n; d++) {
        const x = xanDaily[d] || 0;
        const e = ecsDaily[d] || 0;
        const points = Math.max(0, (x * ADDICTION.xanax + e * ADDICTION.ecstasy) * p.keep - ADDICTION.decay);
        const ods = x * p.xanaxChance + e * p.ecstasyChance;
        const r = points * p.perPoint;
        const o = ods * ADDICTION.overdose * p.keep * p.perPoint;
        rehab += r;
        overdose += o;
        costDaily.push(r + o);
        lost += x * p.xanaxChance * avg + e * p.ecstasyChance * Math.max(0, (gainDaily[d] || 0) - plain);
    }
    lost = Math.min(total, lost);
    return { rehab, overdose, costDaily, lost, factor: total > 0 ? 1 - lost / total : 1 };
}

/** "Rehab about $185k a day · overdoses about $20k a day", or null when the plan takes no drugs. */
export function rehabWords(parts, days, fmt) {
    if (!parts || !(parts.rehab + parts.overdose > 0) || !(days > 0)) return null;
    const a = parts.rough ? 'at least ' : 'about ';
    return 'Rehab ' + a + fmt(Math.round(parts.rehab / days)) + ' a day · overdoses ' + a + fmt(Math.round(parts.overdose / days)) + ' a day';
}
