/*
 * Gym gain: Vladar's formula V2 (rgiskard's C++ calculator, GreasyFork
 * 392876), stepped train by train because happy and the stat both change
 * with every train. Pure; see docs/ENGINE-SPEC.md §1 and research-gym.md.
 */

export const STATS = ['str', 'spd', 'def', 'dex'];

/** Torn's names for our short keys (API battlestats, gym modifiers). */
export const STAT_API = { str: 'strength', spd: 'speed', def: 'defense', dex: 'dexterity' };

export const STAT_LABEL = { str: 'STR', spd: 'SPD', def: 'DEF', dex: 'DEX' };

/** Per-stat constants A and B of the formula. */
export const STAT_AB = {
    str: [1600, 1700],
    spd: [1600, 2000],
    dex: [1800, 1500],
    def: [2100, -600],
};

export const HAPPY_CAP = 99999;

/**
 * [calibrate] How a stat above 50M is damped. Disputed in the community
 * (research-gym.md "Post-50M"): 'log10' (likely), 'ln', or 'power' (Gym
 * Gains Calculator+'s 50M + 0.057406·(S−50M)^0.928996). Calibrate against
 * the user's own trains (Progress › Gain model).
 */
export const POST_50M_MODE = 'log10';

/**
 * The damping mode the engine uses now: POST_50M_MODE until the learner
 * finds (and keeps) a better one from the player's own trains.
 */
let dampingMode = POST_50M_MODE;

/** Use a learned damping mode ('log10' | 'ln' | 'power'); anything else resets it. */
export function useDampingMode(mode) {
    dampingMode = mode === 'ln' || mode === 'power' || mode === 'log10' ? mode : POST_50M_MODE;
    return dampingMode;
}

export function currentDampingMode() {
    return dampingMode;
}

/**
 * [calibrate] Happy lost per train, per energy. Torn's real loss is random in
 * 0.4–0.6 × energy per train (research-gym.md); the mean is used.
 */
export const HAPPY_LOSS_PER_ENERGY = 0.5;

export function round4(x) {
    return Math.round(x * 1e4) / 1e4;
}

/** The stat the formula sees: itself up to 50M, damped above. */
export function effectiveStat(S, mode = dampingMode) {
    if (!(S > 5e7)) return Math.max(0, S || 0);
    if (mode === 'power') return 5e7 + 0.057406 * Math.pow(S - 5e7, 0.928996);
    const log = mode === 'ln' ? Math.log(S) : Math.log10(S);
    return 5e7 + (S - 5e7) / (8.77635 * log);
}

/**
 * Gain of ONE train.
 * @param {string} stat - 'str'|'spd'|'def'|'dex'
 * @param {number} S - the stat now
 * @param {number} H - happy now (capped at 99,999)
 * @param {number} dots - the gym's dots for this stat, as displayed (7.3)
 * @param {number} E - energy per train of the gym (5, 10, 25, 50)
 * @param {number} [perks] - product of every gym-gain multiplier (1.02 …)
 */
export function gainPerTrain(stat, S, H, dots, E, perks = 1, mode = dampingMode) {
    const ab = STAT_AB[stat];
    if (!ab || !(dots > 0) || !(E > 0)) return 0;
    const t = happyTerms(H);
    const [A, B] = ab;
    const inner = effectiveStat(S, mode) * t.f + t.p + t.q * A + B;
    return Math.max(0, (inner / 200000) * dots * E * perks);
}

/** Slots of happyTerms' cache: a simulated train asks for the happy now (twice) and the split's reference happy. */
const TERMS_SLOTS = 4;
const termsKey = new Array(TERMS_SLOTS).fill(NaN);
const termsVal = new Array(TERMS_SLOTS).fill(null);
let termsNext = 0;

/**
 * The happy-only parts of the formula, for one happy: f (the stat's
 * multiplier), p and q. The same numbers gainPerTrain always used; kept for
 * the last few happy values, since the simulator asks for the same happy
 * several times per train (the split's pick and the train itself), and the
 * log and powers were most of the plan comparison's time.
 */
export function happyTerms(H) {
    const h = Math.min(HAPPY_CAP, Math.max(0, H || 0));
    for (let i = 0; i < TERMS_SLOTS; i++) if (termsKey[i] === h) return termsVal[i];
    const v = { f: round4(1 + 0.07 * round4(Math.log(1 + h / 250))), p: 8 * Math.pow(h, 1.05), q: 1 - Math.pow(h / HAPPY_CAP, 2) };
    termsKey[termsNext] = h;
    termsVal[termsNext] = v;
    termsNext = (termsNext + 1) % TERMS_SLOTS;
    return v;
}

/**
 * Train one stat, one train at a time, until the energy (or maxTrains) runs out.
 * @returns {{gain:number, trains:number, energyUsed:number, statAfter:number, happyAfter:number}}
 */
export function trainSession({ stat, S, H, dots, energyPerTrain, energy, perks = 1, maxTrains = Infinity, mode = dampingMode }) {
    let s = S;
    let h = H;
    let trains = 0;
    const cap = Math.min(maxTrains, Math.floor(Math.max(0, energy) / energyPerTrain));
    for (; trains < cap; trains++) {
        s += gainPerTrain(stat, s, h, dots, energyPerTrain, perks, mode);
        h = Math.max(0, h - HAPPY_LOSS_PER_ENERGY * energyPerTrain);
    }
    return { gain: s - S, trains, energyUsed: trains * energyPerTrain, statAfter: s, happyAfter: h };
}

/**
 * Trains (and energy) to take a stat from S to at least `target`.
 * Returns null when it would take more than `limit` trains.
 */
export function trainsToReach({ stat, S, target, H, dots, energyPerTrain, perks = 1, limit = 1e6, mode = dampingMode }) {
    if (S >= target) return { trains: 0, energy: 0 };
    let s = S;
    let n = 0;
    while (s < target) {
        if (++n > limit) return null;
        s += gainPerTrain(stat, s, H, dots, energyPerTrain, perks, mode);
    }
    return { trains: n, energy: n * energyPerTrain };
}

/** Sum of the four stats. */
export function totalOf(stats) {
    // A plain loop, same order and sum as a reduce: the split asks for it on every simulated train.
    let a = 0;
    if (!stats) return a;
    for (let i = 0; i < STATS.length; i++) a += Number(stats[STATS[i]]) || 0;
    return a;
}
