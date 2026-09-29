/*
 * The learning data (docs/research-learning.md): what the app saw, joined
 * into what the learner reads, and the .zip export anyone can make (names
 * and player ids left out by default). Pure.
 */

import { learnGym, learnFights, applyGymModel } from './learn.js';

/** Fight results that count as a win for you. */
export const WIN_RESULTS = new Set(['attacked', 'mugged', 'hospitalized', 'arrested', 'bounty', 'special']);

/** A prediction counts for a fight that ends within this long after it. */
export const PREDICTION_WINDOW_MS = 2 * 60 * 60 * 1000;

export const FIGHT_LOG_KEEP = 500;
export const PREDICTIONS_KEEP = 300;

/** A short, stable stand-in for a player id (not reversible by eye; the export is for the learner, not for tracking). */
export function hashId(id) {
    let h = 2166136261;
    for (const ch of String(id)) {
        h ^= ch.charCodeAt(0);
        h = Math.imul(h, 16777619);
    }
    return 'p' + (h >>> 0).toString(36);
}

/** Remember what Torn Eye said before a fight (one per player per 30 min). */
export function addPrediction(list, { def, at, pWin, keep }) {
    const all = Array.isArray(list) ? list : [];
    if (!(def > 0) || !Number.isFinite(pWin)) return all;
    const last = all.filter((p) => p.def === def).sort((a, b) => b.at - a.at)[0];
    if (last && at - last.at < 30 * 60 * 1000) return all;
    return [...all, { def, at, pWin: Math.round(pWin * 1000) / 1000, keep: Number.isFinite(keep) ? Math.round(keep * 1000) / 1000 : null }].slice(-PREDICTIONS_KEEP);
}

/**
 * Join your attacks with what was predicted before each, into the fight
 * log the learner reads (kept across the hourly attack reads).
 * @param {object[]} log - fights already joined
 * @param {object[]} attacks - myAttacks rows {def, ended (s), result, respect}
 * @param {object[]} predictions - {def, at (ms), pWin, keep}
 */
export function joinFights(log, attacks, predictions) {
    const out = [...(Array.isArray(log) ? log : [])];
    const seen = new Set(out.map((f) => f.key));
    for (const a of attacks || []) {
        const at = Number(a.ended) * 1000;
        const key = a.def + ':' + a.ended;
        if (!at || seen.has(key)) continue;
        const p = (predictions || []).filter((x) => x.def === Number(a.def) && x.at <= at && at - x.at <= PREDICTION_WINDOW_MS).sort((x, y) => y.at - x.at)[0];
        if (!p) continue;
        out.push({ key, at, who: hashId(a.def), predictedWin: p.pWin, won: WIN_RESULTS.has(String(a.result || '').toLowerCase()), predictedHpKept: p.keep, hpKept: null, respect: Number(a.respect) || 0 });
        seen.add(key);
    }
    return out.sort((x, y) => x.at - y.at).slice(-FIGHT_LOG_KEEP);
}

/** Stats rounded to 4 significant digits (enough for the learner, less of a fingerprint). */
export function round4sig(v) {
    if (!(v > 0)) return v;
    const p = Math.pow(10, Math.floor(Math.log10(v)) - 3);
    return Math.round(v / p) * p;
}

/**
 * Run both learners. `current` is the gym model in use (so a new one must
 * beat it on the newest sessions to replace it).
 */
export function runLearning({ samples = [], fights = [], now, current = null }) {
    const gym = learnGym(samples, { now, current: current || undefined });
    const fight = learnFights(fights, { now });
    return { at: now, gym, fights: fight };
}

/** What the engine uses from a learning run: per-stat multipliers, the damping mode, the fight model. */
export function learnedModel(learned) {
    if (!learned) return { mult: { str: 1, spd: 1, def: 1, dex: 1 }, mode: null, fight: null };
    // The model in use: the learned one when kept, else the one it was checked against (itself possibly learned earlier).
    const g = applyGymModel(learned.gym || null);
    return { mult: g.mult, mode: learned.gym ? g.mode : null, fight: learned.fights && learned.fights.accepted ? learned.fights.model : null };
}

/**
 * The export's files: gym-samples.json, fights.json, model.json, meta.json.
 * Player ids are left out (fights carry a hashed stand-in) unless asked.
 */
export function exportFiles({ samples = [], fights = [], learned = null, version = '', now = Date.now(), includeIds = false }) {
    const gym = samples.map((s) => ({ at: s.at || null, stat: s.stat, trains: s.trains, predicted: Math.round(s.predicted), actual: Math.round(s.actual), S: round4sig(s.S), H: s.H, dots: s.dots, E: s.E, perks: s.perks, gym: s.gym || null }));
    const fl = fights.map((f) => ({ at: f.at, who: includeIds ? f.key.split(':')[0] : f.who, predictedWin: f.predictedWin, won: f.won, predictedHpKept: f.predictedHpKept, hpKept: f.hpKept }));
    const model = learned ? { at: learned.at, gym: learned.gym ? { accepted: learned.gym.accepted, model: learned.gym.model, heldOut: learned.gym.heldOut, sessions: learned.gym.sessions } : null, fights: learned.fights ? { accepted: learned.fights.accepted, model: learned.fights.model, fights: learned.fights.fights } : null } : null;
    const meta = { app: 'Torn Pumping Iron', version, exportedAt: new Date(now).toISOString(), sessions: gym.length, fights: fl.length, ids: includeIds ? 'included' : 'left out' };
    return [
        { name: 'gym-samples.json', data: JSON.stringify(gym) },
        { name: 'fights.json', data: JSON.stringify(fl) },
        { name: 'model.json', data: JSON.stringify(model) },
        { name: 'meta.json', data: JSON.stringify(meta, null, 1) },
    ];
}

const STAT_KEYS = ['str', 'spd', 'def', 'dex'];
const inRange = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;

/** One imported gym sample, or null when it doesn't look like one (a crafted file can't hang the page). */
export function cleanSample(s) {
    if (!s || typeof s !== 'object' || !STAT_KEYS.includes(s.stat) || !inRange(s.trains, 1, 2000) || !inRange(s.actual, 0, 1e10)) return null;
    const out = { at: inRange(s.at, 0, 1e13) ? s.at : null, stat: s.stat, trains: Math.floor(s.trains), actual: s.actual, predicted: inRange(s.predicted, 0, 1e10) ? s.predicted : null };
    if (inRange(s.S, 0, 1e13) && inRange(s.H, 0, 99999) && inRange(s.dots, 0, 20) && inRange(s.E, 1, 50)) Object.assign(out, { S: s.S, H: s.H, dots: s.dots, E: s.E, perks: inRange(s.perks, 0.1, 10) ? s.perks : 1 });
    return out;
}

export function cleanFight(f) {
    if (!f || typeof f !== 'object' || !inRange(f.predictedWin, 0, 1) || typeof f.won !== 'boolean') return null;
    return { at: inRange(f.at, 0, 1e13) ? f.at : null, who: typeof f.who === 'string' ? f.who.slice(0, 20) : null, predictedWin: f.predictedWin, won: f.won, predictedHpKept: inRange(f.predictedHpKept, 0, 1) ? f.predictedHpKept : null, hpKept: inRange(f.hpKept, 0, 1) ? f.hpKept : null };
}

/** A friend's export, read back (never merged into your own data). */
export function importFiles(files) {
    const read = (n) => {
        try {
            return files[n] ? JSON.parse(files[n]) : null;
        } catch {
            return null;
        }
    };
    const samples = read('gym-samples.json');
    const fights = read('fights.json');
    const meta = read('meta.json');
    if (!Array.isArray(samples) && !Array.isArray(fights)) throw new Error('This zip has no learning data (gym-samples.json / fights.json).');
    return {
        samples: (Array.isArray(samples) ? samples : []).map(cleanSample).filter(Boolean).slice(-5000),
        fights: (Array.isArray(fights) ? fights : []).map(cleanFight).filter(Boolean).slice(-5000),
        meta: meta && typeof meta === 'object' && !Array.isArray(meta) ? meta : {},
    };
}
