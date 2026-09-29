/*
 * Torn Eye's target list (ROUND4-PLAN §A). FFScouter's finder answers the
 * strongest accounts first, 50 at most, so one ask with no slices gave the
 * owner 50 level-100 players he can't beat. We ask in slices instead:
 *
 *   - fair fight 1.0–1.5, 1.5–2.0, 2.0–2.5 and 2.5–3.0 (FFScouter's own
 *     figure against you). Strongest-first inside a slice is the top of that
 *     slice, so every difficulty shows up, from sure wins to the most respect;
 *   - the level range cut in up to 3 bands, so it isn't only level 100.
 *
 * 4 × 3 = 12 asks at most (FFScouter allows 25 a minute on its target
 * finder; we pace to 20), then the estimates (≤ 205 per ask). If FFScouter
 * ignores the fair-fight range (a slice answers far outside itself), the
 * other slices of that level band are skipped: they'd be the same list.
 *
 * Then the owner's hard rule: every candidate goes through our fight model
 * and only players you beat (Stomp, Good or Tough) are ever stored. The
 * list is sorted by the most respect you can win.
 */

import { estimatePlayer } from './estimate.js';
import { forecast, respectFor, fairFight, bssOf } from './fight.js';
import { bandOf } from './bands.js';

/** The full range: no respect cap (owner). Torn caps fair fight at 3. */
export const TARGET_FF = { min: 1.0, max: 3.0 };

/** Bumped when the way lists are asked changes: an older stored list is asked again once. */
export const TARGETS_VERSION = 2;

export const FF_SLICES = [
    [1.0, 1.5],
    [1.5, 2.0],
    [2.0, 2.5],
    [2.5, 3.0],
];

/** FFScouter's target finder: 25 a minute per IP; we keep to 20. */
export const TARGETS_PER_MINUTE = 20;

/** An estimate older than this is marked "old". */
export const OLD_ESTIMATE_DAYS = 180;

export const BEATABLE = ['stomp', 'good', 'tough'];

export function isBeatable(band) {
    return BEATABLE.includes(band);
}

/** [calibrate] Max life from level when no profile was read: Torn's base plus typical merits and perks. */
export function lifeFromLevel(level) {
    return Math.round((100 + 50 * Math.max(0, (Number(level) || 1) - 1)) * 1.25);
}

/** The level range in up to 3 bands (a narrow range stays one band). */
export function levelBands(minLevel = 1, maxLevel = 100) {
    const lo = Math.max(1, Math.min(100, Math.round(Number(minLevel) || 1)));
    const hi = Math.max(lo, Math.min(100, Math.round(Number(maxLevel) || 100)));
    const span = hi - lo + 1;
    const n = span >= 60 ? 3 : span >= 30 ? 2 : 1;
    const out = [];
    for (let i = 0; i < n; i++) {
        const a = lo + Math.round((i * span) / n);
        const b = i === n - 1 ? hi : lo + Math.round(((i + 1) * span) / n) - 1;
        out.push([a, b]);
    }
    return out;
}

/** The asks for one load: each level band (highest first: more respect) × each fair-fight slice. */
export function targetQueries({ minLevel = 1, maxLevel = 100, inactiveOnly = 1, factionless = null } = {}) {
    const out = [];
    for (const [a, b] of levelBands(minLevel, maxLevel).reverse()) {
        for (const [f0, f1] of FF_SLICES) out.push({ minLevel: a, maxLevel: b, minFf: f0, maxFf: f1, inactiveOnly, factionless });
    }
    return out;
}

/** The params stored with a list; a list stored without this version is asked again once. */
export function targetParams({ minLevel = 1, maxLevel = 100, inactiveOnly = 1, factionless = null } = {}) {
    return { v: TARGETS_VERSION, minLevel, maxLevel, inactiveOnly, factionless, minFf: TARGET_FF.min, maxFf: TARGET_FF.max };
}

export function needsRefetch(params) {
    return !params || params.v !== TARGETS_VERSION;
}

/** Did FFScouter ignore the fair-fight range of this ask? (most rows with a figure fall outside it) */
export function listIgnoresFf(rows, q) {
    const known = (rows || []).filter((r) => r && Number.isFinite(r.fairFight));
    if (known.length < 3) return false;
    const out = known.filter((r) => r.fairFight < q.minFf - 0.05 || r.fairFight > q.maxFf + 0.05).length;
    return out / known.length > 0.5;
}

/** One list from many asks, each player once (the first answer wins). */
export function mergeTargetLists(lists) {
    const seen = new Map();
    for (const list of lists || []) for (const r of list || []) if (r && r.playerId > 0 && !seen.has(r.playerId)) seen.set(r.playerId, r);
    return [...seen.values()];
}

/** FFScouter's own fair fight from the list: outside 1.0–3.0 it isn't a player we asked for. Unknown stays. */
export function inFfRange(row) {
    const ff = row ? row.fairFight : null;
    return !Number.isFinite(ff) || (ff >= TARGET_FF.min && ff <= TARGET_FF.max);
}

/** Most respect first; then the surer win. */
export function byRespect(a, b) {
    return (b.respect || 0) - (a.respect || 0) || (b.win ?? -1) - (a.win ?? -1);
}

/**
 * The hard rule: judge every candidate, keep only the ones you beat.
 * @param {object[]} rows - merged list rows
 * @param {function} judge - row => {band, win (0–100), keep (0–100|null), respect, ours (fair fight), source, ageDays} | null
 * @returns {{kept: object[], dropped: {cant, none, range}}}
 */
export function selectTargets(rows, judge) {
    const kept = [];
    const dropped = { cant: 0, none: 0, range: 0 };
    for (const r of rows || []) {
        if (!inFfRange(r)) {
            dropped.range++;
            continue;
        }
        const j = judge(r);
        if (!j || !j.band || j.band === 'none') dropped.none++;
        else if (!isBeatable(j.band)) dropped.cant++;
        else kept.push({ ...r, ...j });
    }
    kept.sort(byRespect);
    return { kept, dropped };
}

/** The FFScouter row our estimator reads, from the list itself (when get-stats had nothing). */
export function listRowAsFfs(row, now = Date.now()) {
    return {
        playerId: row.playerId,
        bsEstimate: row.bsEstimate || null,
        bssPublic: row.bssPublic || null,
        fairFight: row.fairFight || null,
        // The list carries no date: counted as today's.
        updatedAt: row.bsEstimate || row.fairFight ? now : null,
        source: 'list',
        distribution: null,
    };
}

/**
 * A plain judge (no cache, no gear, no learner): the tests' and a fallback.
 * @param {object} o - {me: {str,spd,def,dex}, myLife, row, ffs (normalizeFfsRow), limits, now}
 */
export function judgeTarget({ me, myLife = 7500, row, ffs = null, limits = undefined, now = Date.now() }) {
    const est = estimatePlayer({ me, ffs: ffs || listRowAsFfs(row, now), now });
    if (!est) return null;
    const f = forecast({ me: { ...me, life: myLife }, target: { id: row.playerId, life: lifeFromLevel(row.level), bss: est.bss } });
    const ours = fairFight(est.bss, bssOf(me));
    return {
        band: bandOf(f, limits),
        win: Math.round(f.pWin * 100),
        keep: f.keep === null ? null : Math.round(f.keep * 100),
        respect: row.level ? respectFor(row.level, ours) : null,
        ours,
        source: est.source,
        ageDays: est.ageDays,
    };
}

/**
 * The row's details: our fair fight, FFScouter's from its list, how old
 * the estimate is and where it came from.
 */
export function targetDetails(row, view = null) {
    const est = view && view.est;
    const ours = Number.isFinite(row.ours) ? row.ours : null;
    const ageDays = est ? est.ageDays : row.ageDays ?? null;
    return {
        ours: view && Number.isFinite(view.ours) ? view.ours : ours,
        list: Number.isFinite(row.fairFight) ? row.fairFight : null,
        ageDays,
        old: ageDays !== null && ageDays !== undefined && ageDays > OLD_ESTIMATE_DAYS,
        source: est ? est.sourceText : row.source || null,
    };
}

/**
 * What to say instead of an empty table ("press Refresh" said nothing).
 * @returns {{kind:'paused'|'dead'|'wait'|'error'|'loading'|'empty'|'none', text}}
 */
export function targetsMessage({ paused = false, error = null, loading = false, stored = null } = {}) {
    if (paused) return { kind: 'paused', text: 'Paused · Torn Trading is on' };
    if (error && error.deadKey) return { kind: 'dead', text: 'FFScouter refused the key' };
    if (loading) return { kind: 'loading', text: 'Asking FFScouter for targets…' };
    if (error && error.paused) return { kind: 'wait', text: 'FFScouter asked us to wait' + (error.retryAfterS ? ' ' + error.retryAfterS + ' s' : '') };
    if (error) return { kind: 'error', text: 'Couldn’t load targets: ' + (error.message || String(error)) };
    if (stored && !(stored.list || []).length) {
        const d = stored.dropped || {};
        const parts = [];
        if (d.cant) parts.push(d.cant + ' can’t-win dropped');
        if (d.none) parts.push(d.none + ' with no estimate');
        return { kind: 'empty', text: 'FFScouter found nobody you can beat in range' + (parts.length ? ' · ' + parts.join(' · ') : '') };
    }
    return { kind: 'none', text: stored ? '' : 'No targets yet.' };
}
