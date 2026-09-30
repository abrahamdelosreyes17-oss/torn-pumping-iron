/*
 * Learning from the player's own results (docs/research-learning.md).
 * Gym: a per-stat multiplier (unknown perks) and the damping above 50M.
 * Torn Eye: how often predicted wins come true, and how much HP is kept.
 * Both learn on the older 70% of the data and test on the newest 30%;
 * a change is kept only when it beats today's model there by a margin.
 * Pure and deterministic: no DOM, no storage, no randomness.
 */

import { STATS, STAT_LABEL, POST_50M_MODE, HAPPY_LOSS_PER_ENERGY, gainPerTrain } from './gain.js';

export const LEARN_MODES = ['log10', 'ln', 'power'];
/** Share of the data (oldest first) used to learn; the rest tests. */
export const LEARN_SPLIT = 0.7;
/** Sessions (or fights) needed in the learning part before a change is kept. */
export const LEARN_MIN = 10;
/** A stat needs this many learning sessions for its own multiplier. */
export const LEARN_MIN_PER_STAT = 5;
/** Held-out gym error (percentage points) the learned model must win by. */
export const LEARN_MARGIN_PCT = 0.2;
/** Held-out Brier score the fight model must win by. */
export const LEARN_MARGIN_BRIER = 0.0005;
/** Held-out HP-kept error (share of HP, 0.002 = 0.2 points) it must win by. */
export const LEARN_MARGIN_HP = 0.002;
/**
 * One fight is a coin toss, so a small margin alone would let noise through.
 * The newest fights must also show today's forecast off in the learned
 * direction by at least this many standard errors (more wins than
 * predicted, or HP kept above the forecast more often than below).
 */
export const LEARN_Z = 2;
/** The HP scale stays in this range whatever the data says. */
export const LEARN_HP_CLAMP = [0.5, 1.5];

function learnMedian(a) {
    if (!a.length) return null;
    const b = [...a].sort((x, y) => x - y);
    const m = Math.floor(b.length / 2);
    return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2;
}

function learnPct(x, digits = 0) {
    return `${(x * 100).toFixed(digits)}%`;
}

/** Oldest first, by `at` when present (stable otherwise); nothing after `now`. */
function learnByTime(rows, now) {
    const list = (rows || []).filter((r) => r && !(Number.isFinite(now) && Number.isFinite(r.at) && r.at > now));
    return list.map((r, i) => [r, i]).sort((x, y) => (x[0].at ?? 0) - (y[0].at ?? 0) || x[1] - y[1]).map((x) => x[0]);
}

function learnCut(n, cut) {
    return Number.isInteger(cut) && cut >= 0 && cut <= n ? cut : Math.floor(n * LEARN_SPLIT);
}

// ---------------------------------------------------------------- gym

/** Every stat present with a number (1 when missing). */
function learnFullMult(mult) {
    return Object.fromEntries(STATS.map((k) => [k, Number(mult && mult[k]) > 0 ? Number(mult[k]) : 1]));
}

function learnNormModel(m) {
    return { mult: learnFullMult(m && m.mult), mode: LEARN_MODES.includes(m && m.mode) ? m.mode : POST_50M_MODE };
}

/** A sample can be re-predicted when it carries the train inputs. */
function learnHasInputs(r) {
    return Number.isFinite(r.S) && Number.isFinite(r.H) && r.dots > 0 && (r.E || r.energyPerTrain) > 0 && r.trains >= 1;
}

/**
 * The gain the formula predicts for one sample, with multiplier `mult`
 * on top of the perks the sample already knew. Samples without inputs use
 * their stored `predicted` (made with the known perks and `baseMode`).
 */
function learnPredict(r, mode, mult, baseMode) {
    if (!learnHasInputs(r)) return mode === baseMode && r.predicted > 0 ? r.predicted * mult : null;
    const E = r.E || r.energyPerTrain;
    const perks = (Number(r.perks) > 0 ? Number(r.perks) : 1) * mult;
    let s = r.S;
    let h = r.H;
    for (let i = 0; i < r.trains; i++) {
        s += gainPerTrain(r.stat, s, h, r.dots, E, perks, mode);
        h = Math.max(0, h - HAPPY_LOSS_PER_ENERGY * E);
    }
    return s - r.S;
}

/**
 * Round 6 (R6.6, docs/research-learner-retrain.md P3): a per-stat keep test.
 * The pooled rule dilutes a 1% error on one stat with the others' sessions:
 * at 200 sessions it kept a real +1% only 6% of the time. Per stat, on the
 * newest sessions of that stat, the log of actual ÷ predicted must lean the
 * learned way by z ≥ 3 (94% kept at 200 sessions, noise kept under 5%).
 */
export const LEARN_STAT_Z = 3;
export const LEARN_STAT_MIN_TEST = 8;
export const LEARN_STAT_MIN_CHANGE = 0.003;

/** z of the newest sessions' residuals against the model in use, signed toward the learned multiplier. */
function learnStatZ(test, stat, base, learnedMult, baseMode) {
    const rows = test.filter((r) => r.stat === stat);
    if (rows.length < LEARN_STAT_MIN_TEST) return { z: 0, n: rows.length };
    const res = rows.map((r) => Math.log(r.actual / learnPredict(r, base.mode, base.mult[stat] || 1, baseMode)));
    const mean = res.reduce((a, x) => a + x, 0) / res.length;
    const sd = Math.max(0.002, Math.sqrt(res.reduce((a, x) => a + (x - mean) * (x - mean), 0) / Math.max(1, res.length - 1)));
    const dir = Math.sign(Math.log(learnedMult / (base.mult[stat] || 1)));
    return { z: (dir * mean) / (sd / Math.sqrt(res.length)), n: rows.length };
}

/** Mean absolute error in % of the actual gain. */
function learnMape(rows, model, baseMode) {
    if (!rows.length) return null;
    let sum = 0;
    for (const r of rows) {
        const p = learnPredict(r, model.mode, model.mult[r.stat] || 1, baseMode);
        sum += Math.abs(p - r.actual) / r.actual;
    }
    return (sum / rows.length) * 100;
}

/**
 * Learn the gym model from recorded sessions.
 * A sample: {at?, stat, trains, actual, S?, H?, dots?, E? (or energyPerTrain), perks?, predicted?}.
 * With S/H/dots/E the damping mode can be learned too; without them only
 * the multiplier (from `predicted`, made with the current mode).
 * @param {object[]} samples
 * @param {object} o - {now?, current?: {mult, mode}, cut?: sessions to learn on (default 70%)}
 * @returns {{accepted, model:{mult, mode}, current, heldOut:{current, learned}, sessions, learnSessions, testSessions, reasons:string[], candidates:{mode, error}[], at}}
 */
export function learnGym(samples, { now, current, cut } = {}) {
    const base = learnNormModel(current);
    const rows = learnByTime(samples, now).filter((r) => STATS.includes(r.stat) && r.actual > 0 && (learnHasInputs(r) || r.predicted > 0));
    const k = learnCut(rows.length, cut);
    const train = rows.slice(0, k);
    const test = rows.slice(k);
    const reasons = [];
    const allInputs = rows.length > 0 && rows.every(learnHasInputs);
    // Today's mode first, so a tie (all stats under 50M) keeps it.
    const modes = allInputs ? [base.mode, ...LEARN_MODES.filter((m) => m !== base.mode)] : [base.mode];
    const candidates = [];
    let best = null;
    for (const mode of modes) {
        const mult = { ...base.mult };
        for (const stat of STATS) {
            const mine = train.filter((r) => r.stat === stat);
            if (mine.length < LEARN_MIN_PER_STAT) continue; // too few: keep today's value
            mult[stat] = learnMedian(mine.map((r) => r.actual / learnPredict(r, mode, 1, base.mode))); // median: bad sessions don't count
        }
        const error = train.length ? learnMape(train, { mode, mult }, base.mode) : null;
        candidates.push({ mode, error });
        if (!best || (error !== null && error < best.error)) best = { mode, mult, error };
    }
    const model = { mult: best.mult, mode: best.mode };
    const heldOut = { current: learnMape(test, base, base.mode), learned: learnMape(test, model, base.mode) };

    if (!allInputs && rows.length) reasons.push('Some sessions lack the stat, happy and gym, so only the multipliers were learned.');
    let accepted = false;
    // The per-stat test (same mode as in use): a stat whose newest sessions clearly lean the learned way is kept.
    const perStat = {};
    const statModel = { mode: base.mode, mult: { ...base.mult } };
    if (test.length) {
        const sameMode = best.mode === base.mode ? best.mult : null;
        if (sameMode) {
            for (const stat of STATS) {
                const change = Math.abs((sameMode[stat] || 1) / (base.mult[stat] || 1) - 1);
                const t = learnStatZ(test, stat, base, sameMode[stat] || 1, base.mode);
                perStat[stat] = { z: Math.round(t.z * 100) / 100, n: t.n, keep: t.z >= LEARN_STAT_Z && change >= LEARN_STAT_MIN_CHANGE };
                if (perStat[stat].keep) statModel.mult[stat] = sameMode[stat];
            }
        }
    }
    if (train.length < LEARN_MIN) {
        reasons.push(`Only ${train.length} sessions to learn from; ${LEARN_MIN} are needed.`);
    } else if (!test.length) {
        reasons.push('No newer sessions left to test on.');
    } else {
        const gain = heldOut.current - heldOut.learned;
        const words = `On the newest ${test.length} sessions the formula was off by ${heldOut.current.toFixed(2)}%, the learned model by ${heldOut.learned.toFixed(2)}%.`;
        const kept = STATS.filter((k) => perStat[k] && perStat[k].keep);
        const statErr = kept.length ? learnMape(test, statModel, base.mode) : null;
        if (gain >= LEARN_MARGIN_PCT) {
            accepted = true;
            reasons.push(`${words} Kept: better by ${gain.toFixed(2)} points.`);
        } else if (kept.length && statErr !== null && statErr <= heldOut.current) {
            // The per-stat test: only the stats that clearly lean, and only if the newest sessions don't get worse.
            accepted = true;
            model.mode = statModel.mode;
            model.mult = statModel.mult;
            heldOut.learned = statErr;
            reasons.push(`${words} Kept for ${kept.map((k) => STAT_LABEL[k]).join(', ')}: their newest sessions lean that way clearly (z ≥ ${LEARN_STAT_Z}).`);
        } else {
            reasons.push(`${words} Not kept: the gain (${gain.toFixed(2)} points) is under the ${LEARN_MARGIN_PCT} needed, and no stat leans clearly on its own.`);
        }
    }
    return { accepted, model, current: base, heldOut, perStat, sessions: rows.length, learnSessions: train.length, testSessions: test.length, reasons, candidates, at: Number.isFinite(now) ? now : null };
}

// ---------------------------------------------------------------- happy loss (R6.6, P1)

/** Happy lost per energy the formula assumes (0.5), and what the learned factor must clear. */
export const HAPPY_LOSS_MIN_TRAINS = 150;
export const HAPPY_LOSS_Z = 3;
export const HAPPY_LOSS_MIN_CHANGE = 0.02;
/** Per-click spread of happy_used ÷ energy_used (research: 0.058). */
export const HAPPY_LOSS_SD = 0.058;

/**
 * Happy lost per energy, from Torn's gym log (Full key: every click's
 * `happy_used` and `energy_used`), as a factor on 0.5 × your perks'.
 * Clicks where happy hit 0 (happy_used under 80% of the expected) are left
 * out. Kept only with ≥ 150 trains, a change ≥ 2%, the newest 30% of clicks
 * leaning the same way by z ≥ 3, and closer on them than the constant.
 * @param {object[]} lines - core/gymlog.js lines ({at, trains, energy, happy})
 * @param {object} o - {now, lossMult: your perks' happy-loss multiplier, current: the factor in use (1)}
 * @returns {{accepted, factor, current, trains, heldOut:{current, learned}|null, reasons:string[]}}
 */
export function learnHappyLoss(lines, { now, lossMult = 1, current = 1 } = {}) {
    const expected = HAPPY_LOSS_PER_ENERGY * (lossMult || 1);
    const rows = (lines || [])
        .filter((l) => l && l.energy > 0 && Number.isFinite(l.happy) && l.happy >= 0.8 * expected * l.energy && (!now || now - l.at <= 30 * 86400e3))
        .sort((a, b) => a.at - b.at);
    const trains = rows.reduce((a, l) => a + (l.trains || 0), 0);
    const k = Math.floor(rows.length * LEARN_SPLIT);
    const train = rows.slice(0, k);
    const test = rows.slice(k);
    const ratio = (list) => list.reduce((a, l) => a + l.happy, 0) / Math.max(1, list.reduce((a, l) => a + l.energy, 0));
    const reasons = [];
    const base = Number(current) > 0 ? Number(current) : 1;
    if (trains < HAPPY_LOSS_MIN_TRAINS || !train.length || !test.length) {
        reasons.push(`Happy lost per energy: ${trains} trains in your gym log so far; ${HAPPY_LOSS_MIN_TRAINS} are needed.`);
        return { accepted: false, factor: base, current: base, trains, heldOut: null, reasons };
    }
    const factor = ratio(train) / expected;
    const testTrains = test.reduce((a, l) => a + (l.trains || 0), 0);
    const z = ((ratio(test) - expected * base) / (HAPPY_LOSS_SD / Math.sqrt(Math.max(1, testTrains)))) * Math.sign(factor - base);
    const err = (f) => test.reduce((a, l) => a + Math.abs(l.happy - expected * f * l.energy), 0) / test.length;
    const heldOut = { current: err(base), learned: err(factor) };
    const accepted = Math.abs(factor / base - 1) >= HAPPY_LOSS_MIN_CHANGE && z >= HAPPY_LOSS_Z && heldOut.learned < heldOut.current;
    reasons.push(`Happy lost per energy: ${(expected * factor).toFixed(3)} learned vs ${(expected * base).toFixed(3)} in use (${trains} trains). ${accepted ? 'Kept.' : 'Not kept: needs a 2% change your newest clicks clearly back (z ' + z.toFixed(1) + ' of ' + HAPPY_LOSS_Z + ').'}`);
    return { accepted, factor: accepted ? factor : base, learned: factor, current: base, trains, heldOut, reasons };
}

/**
 * What the engine should use: the learned {mult, mode} when accepted,
 * otherwise the model it was compared against (the plain formula by default).
 */
export function applyGymModel(result) {
    if (!result) return learnNormModel(null);
    if (!('accepted' in result)) return learnNormModel(result); // a bare model
    return learnNormModel(result.accepted ? result.model : result.current);
}

/** Plain lines for the Developer page. */
export function describeGym(result) {
    if (!result) return ['Nothing learned yet.'];
    if (!result.accepted) {
        if (result.learnSessions < LEARN_MIN) return [`Still learning: ${result.learnSessions} of ${LEARN_MIN} sessions so far.`];
        if (result.heldOut.current !== null && result.heldOut.current < 1) return [`The formula already matches your trains (off by ${result.heldOut.current.toFixed(2)}% on your newest sessions). Nothing changed.`];
        return [`No clear pattern in your trains yet (the formula is off by ${(result.heldOut.current ?? 0).toFixed(2)}%, mostly noise). Nothing changed.`];
    }
    const out = [];
    const before = result.current || learnNormModel(null);
    for (const stat of STATS) {
        const m = result.model.mult[stat];
        if (!(m > 0) || Math.abs(m - before.mult[stat]) < 0.01) continue;
        const d = m - 1;
        if (Math.abs(d) < 0.01) out.push(`Your ${STAT_LABEL[stat]} gains now match the formula again. The plan is back to it.`);
        else if (d > 0) out.push(`Your ${STAT_LABEL[stat]} gains run ${learnPct(d)} above the formula: an unknown perk? The plan now counts it.`);
        else out.push(`Your ${STAT_LABEL[stat]} gains run ${learnPct(-d)} below the formula: a perk that ended? The plan now counts it.`);
    }
    if (result.model.mode !== before.mode) out.push(`Above 50M your gains slow down on a different curve than assumed ("${result.model.mode}" fits better). The plan now uses it.`);
    out.push(`Newest sessions: off by ${result.heldOut.learned.toFixed(2)}% now, was ${result.heldOut.current.toFixed(2)}%.`);
    return out;
}

// ---------------------------------------------------------------- Torn Eye

const LEARN_P_EPS = 0.005;

/** A win chance after scaling its odds by k (k > 1: more wins than predicted). */
function learnScaleOdds(p, k) {
    const q = Math.min(1 - LEARN_P_EPS, Math.max(LEARN_P_EPS, p));
    const o = (k * q) / (1 - q);
    return o / (1 + o);
}

function learnMean(a) {
    return a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
}

/** Brier score of each fight: (chance − result)², 0 is perfect. */
function learnBrierEach(rows, k) {
    return rows.map((r) => (learnScaleOdds(r.predictedWin, k) - (r.won ? 1 : 0)) ** 2);
}

function learnBrier(rows, k) {
    return learnMean(learnBrierEach(rows, k));
}

/** Wins above the forecast, in standard errors (+: more wins than predicted). */
function learnWinZ(rows) {
    let d = 0;
    let v = 0;
    for (const r of rows) {
        const p = Math.min(1 - LEARN_P_EPS, Math.max(LEARN_P_EPS, r.predictedWin));
        d += (r.won ? 1 : 0) - p;
        v += p * (1 - p);
    }
    return v > 0 ? d / Math.sqrt(v) : 0;
}

/** HP kept above vs below the forecast, in standard errors (a sign test). */
function learnHpZ(rows) {
    const up = rows.filter((r) => r.hpKept > r.predictedHpKept).length;
    const down = rows.filter((r) => r.hpKept < r.predictedHpKept).length;
    return up + down ? (up - down) / Math.sqrt(up + down) : 0;
}

/** Fights with a usable HP pair: won, both numbers known. */
function learnHpRows(rows) {
    return rows.filter((r) => r.won && Number.isFinite(r.predictedHpKept) && r.predictedHpKept > 0 && Number.isFinite(r.hpKept));
}

function learnHpErrorEach(rows, scale) {
    return rows.map((r) => Math.abs(Math.min(1, r.predictedHpKept * scale) - r.hpKept));
}

function learnHpError(rows, scale) {
    return learnMean(learnHpErrorEach(rows, scale));
}

/** Reliability bins: of fights predicted 80–90%, how many were won. */
function learnBins(rows) {
    const bins = [];
    for (let i = 0; i < 10; i++) {
        const mine = rows.filter((r) => Math.min(9, Math.floor(r.predictedWin * 10)) === i);
        bins.push({
            from: i / 10,
            to: (i + 1) / 10,
            fights: mine.length,
            predicted: mine.length ? mine.reduce((a, r) => a + r.predictedWin, 0) / mine.length : null,
            won: mine.length ? mine.filter((r) => r.won).length / mine.length : null,
        });
    }
    return bins;
}

/**
 * Learn how far Torn Eye's forecasts are off.
 * A fight: {at, predictedWin (0..1), won (bool), predictedHpKept (0..1)|null, hpKept (0..1)|null}.
 * @param {object[]} fights
 * @param {object} o - {now?, cut?: fights to learn on (default 70%)}
 * @returns {{accepted, model:{winScale, hpScale}, learned:{winScale, hpScale}, heldOut:{brier:{current, learned, z}, hpError:{current, learned, z}}, fights, learnFights, testFights, reasons:string[], bins, winAccepted, hpAccepted}}
 */
export function learnFights(fights, { now, cut } = {}) {
    const rows = learnByTime(fights, now).filter((r) => Number.isFinite(r.predictedWin) && r.predictedWin >= 0 && r.predictedWin <= 1 && typeof r.won === 'boolean');
    const k = learnCut(rows.length, cut);
    const train = rows.slice(0, k);
    const test = rows.slice(k);
    const reasons = [];

    // Win chance: one odds factor, the best of a grid (0.25× to 4×) on the learning fights.
    let winScale = 1;
    if (train.length) {
        let bestB = learnBrier(train, 1);
        for (let j = -40; j <= 40; j++) {
            const s = 2 ** (j / 20);
            const b = learnBrier(train, s);
            if (b < bestB - 1e-12) {
                bestB = b;
                winScale = s;
            }
        }
    }
    // HP kept: median of actual ÷ predicted, clamped.
    const hpTrain = learnHpRows(train);
    const hpTest = learnHpRows(test);
    const ratio = learnMedian(hpTrain.map((r) => r.hpKept / r.predictedHpKept));
    const hpScale = ratio === null ? 1 : Math.min(LEARN_HP_CLAMP[1], Math.max(LEARN_HP_CLAMP[0], ratio));

    const heldOut = {
        brier: { current: learnBrier(test, 1), learned: learnBrier(test, winScale) },
        hpError: { current: learnHpError(hpTest, 1), learned: learnHpError(hpTest, hpScale) },
    };
    let winAccepted = false;
    let hpAccepted = false;
    if (train.length < LEARN_MIN) {
        reasons.push(`Only ${train.length} fights to learn from; ${LEARN_MIN} are needed.`);
    } else if (!test.length) {
        reasons.push('No newer fights left to test on.');
    } else {
        const gain = heldOut.brier.current - heldOut.brier.learned;
        const z = learnWinZ(test) * Math.sign(Math.log(winScale)); // + when the newest fights lean the learned way
        heldOut.brier.z = z;
        winAccepted = gain >= LEARN_MARGIN_BRIER && z >= LEARN_Z;
        reasons.push(`Win chance on the newest ${test.length} fights: score ${heldOut.brier.current.toFixed(4)} before, ${heldOut.brier.learned.toFixed(4)} learned (lower is better). ${winAccepted ? 'Kept.' : `Not kept: needs ${LEARN_MARGIN_BRIER} better and a clear lean (${z.toFixed(1)} of ${LEARN_Z}).`}`);
        if (hpTrain.length < LEARN_MIN || !hpTest.length) {
            reasons.push(`HP kept: only ${hpTrain.length} won fights with HP to learn from; ${LEARN_MIN} are needed.`);
        } else {
            const gain = heldOut.hpError.current - heldOut.hpError.learned;
            const z = learnHpZ(hpTest) * Math.sign(Math.log(hpScale));
            heldOut.hpError.z = z;
            hpAccepted = gain >= LEARN_MARGIN_HP && z >= LEARN_Z;
            reasons.push(`HP kept on the newest ${hpTest.length} wins: off by ${learnPct(heldOut.hpError.current, 1)} before, ${learnPct(heldOut.hpError.learned, 1)} learned. ${hpAccepted ? 'Kept.' : `Not kept: needs ${learnPct(LEARN_MARGIN_HP, 1)} better and a clear lean (${z.toFixed(1)} of ${LEARN_Z}).`}`);
        }
    }
    return {
        accepted: winAccepted || hpAccepted,
        winAccepted,
        hpAccepted,
        model: { winScale: winAccepted ? winScale : 1, hpScale: hpAccepted ? hpScale : 1 },
        learned: { winScale, hpScale },
        heldOut,
        fights: rows.length,
        learnFights: train.length,
        testFights: test.length,
        reasons,
        bins: learnBins(rows),
        at: Number.isFinite(now) ? now : null,
    };
}

/** A forecast corrected by the fight model: {pWin, keep} in, the same out. */
export function applyFightModel(model, { pWin, keep }) {
    const m = model && model.model ? model.model : model;
    const ws = m && m.winScale > 0 ? m.winScale : 1;
    const hs = m && m.hpScale > 0 ? m.hpScale : 1;
    return { pWin: ws === 1 || !Number.isFinite(pWin) ? pWin : learnScaleOdds(pWin, ws), keep: Number.isFinite(keep) ? Math.min(1, keep * hs) : keep };
}

/** Plain lines for the Developer page. */
export function describeFights(result) {
    if (!result) return ['Nothing learned yet.'];
    if (result.learnFights < LEARN_MIN) return [`Still learning: ${result.learnFights} of ${LEARN_MIN} fights so far.`];
    const out = [];
    if (result.winAccepted) {
        const up = result.model.winScale > 1;
        // The clearest example: the band (10+ fights) furthest off in the learned direction.
        const gap = (b) => (up ? 1 : -1) * (b.won - b.predicted);
        const bin = result.bins.filter((b) => b.fights >= 10).sort((a, b) => gap(b) - gap(a))[0];
        const example = bin ? ` (fights called ${Math.round(bin.from * 100)}–${Math.round(bin.to * 100)}% were won ${learnPct(bin.won)} of the time)` : '';
        out.push(`Your fights: you win ${up ? 'more' : 'less'} often than Torn Eye said${example}; fixed.`);
    }
    if (result.hpAccepted) {
        const d = result.model.hpScale - 1;
        out.push(`Your fights: HP kept was ${learnPct(Math.abs(d))} too ${d > 0 ? 'pessimistic' : 'optimistic'}; fixed.`);
    }
    if (!out.length) out.push('Torn Eye already matches your fights. Nothing changed.');
    return out;
}
