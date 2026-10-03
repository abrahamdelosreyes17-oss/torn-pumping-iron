/*
 * Torn Eye's target list (ROUND4-PLAN §A; round 7, the owner, 2026-10-03). FFScouter's finder answers the strongest
 * accounts inside the asked range first, 50 at most. We want Stomps with the most respect: respect grows with fair
 * fight and level, and a Stomp (you keep 99% HP or more) is a much weaker player, so the best Stomps sit just under
 * "the stomp edge", the strength at which you'd start losing HP.
 *
 *   - The edges come from our own fight model (findEdges): for each level band (the level range in up to 3), the fair
 *     fight at which a typical player of the band's top level stops being a Stomp, a Good and a Fair for you. Worked
 *     out once per your-stats key (eye-service.js myEdges).
 *   - Each ask is one level band and one zone: Stomp is fair fight 1.0 up to the stomp edge, Good from there to the
 *     good edge, Fair to the fair edge. Strongest-first inside a zone is its top, so each answer is the most respect
 *     that zone has; the next ask of that band starts just under the weakest player the last one gave (a cursor), or
 *     the zone is done when an answer comes back short.
 *   - Which ask next: the open band whose top could give the most respect (high levels first, then lower); Stomp
 *     first, Good and Fair only once Stomps run short (the Stomp zone is done, or the Stomps so far won't reach 100
 *     in the asks left).
 *   - Every answer is judged at once, and the asking stops as soon as the list holds 100 Stomps and a full reserve
 *     (200 in all), or after TARGET_ASKS_MAX asks (~300 players looked at). FFScouter allows 25 a minute on its
 *     finder; we pace to 20. If FFScouter ignores the fair-fight range (an answer far outside itself), that level
 *     band is not asked again: it'd be the same list.
 *
 * Then the owner's hard rule: every candidate goes through our fight model and only players you beat keeping half
 * your HP or more (Stomp, Good or Fair) are ever stored. At most 200 are kept: the active list (the first 100 in the
 * order, the only ones shown and whose statuses are read) and a quiet reserve of up to 100 more. A player you hit
 * drops out at once and the next one slides in; when the reserve runs low, one more ask follows (refillTargets).
 * One order: band first (Stomp, Good, Fair), then the most respect, then the most HP kept, then the highest win.
 */

import { estimatePlayer } from './estimate.js';
import { forecast, respectFor, fairFight, bssOf } from './fight.js';
import { bandOf, isListedBand, BAND_KEEP } from './bands.js';
import { memberState, travelOf } from './war.js';

/** The full range: no respect cap (owner). Torn caps fair fight at 3. */
export const TARGET_FF = { min: 1.0, max: 3.0 };

/** Bumped when the way lists are asked or judged changes: an older stored list is asked again once (4: the stomp edge, 100 + 100). */
export const TARGETS_VERSION = 4;

/** What the list is asked with (round 7: the Level range and the Show ticks are gone; inactive players, any faction). */
export const TARGET_LOAD = { minLevel: 1, maxLevel: 100, inactiveOnly: 1, factionless: null };

/**
 * [calibrate] The list is asked again by itself when the Torn Eye tab is open and the stored one is this old (no
 * Refresh button). Kept as the fallback beside the refill: the refill only replaces players you hit, while your stats
 * grow every day (the stored players' fair fight against you falls, so each gives less respect, and the best Stomps
 * just under the edge are other players by then) and the inactive players change.
 */
export const TARGETS_REFRESH_MS = 6 * 60 * 60 * 1000;

/** The active list: shown, statuses read (the owner: "at most 100 targets"). */
export const ACTIVE_MAX = 100;
/** The quiet reserve behind it: stored and fight-judged, never shown, no status reads. */
export const RESERVE_MAX = 100;
/** Everything stored. */
export const LIST_MAX = ACTIVE_MAX + RESERVE_MAX;
/** [calibrate] Fewer than this in reserve: one more FFScouter ask, quietly. */
export const RESERVE_LOW = 20;
/** [calibrate] A refill is not tried again sooner (one that found nobody new included). */
export const REFILL_GAP_MS = 2 * 60 * 1000;
/** A list load asks FFScouter's finder this many times at most (6 × 50: ~300 players looked at). */
export const TARGET_ASKS_MAX = 6;
/** FFScouter's finder answers 50 at most. */
export const ASK_LIMIT = 50;
/** [calibrate] A player you hit is not brought back by a refill or a reload for this long. */
export const GONE_KEEP_MS = 24 * 60 * 60 * 1000;

/** FFScouter's target finder: 25 a minute per IP; we keep to 20. */
export const TARGETS_PER_MINUTE = 20;

/** An estimate older than this is marked "old". */
export const OLD_ESTIMATE_DAYS = 180;

/** Only these are ever listed or pinged (round 7: HP kept 50% or more over the fights you win). */
export const BEATABLE = ['stomp', 'good', 'fair'];

export function isBeatable(band) {
    return isListedBand(band);
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

/** FFScouter's own fair fight from the list: outside 1.0–3.0 it isn't a player we asked for. Unknown stays. */
export function inFfRange(row) {
    const ff = row ? row.fairFight : null;
    return !Number.isFinite(ff) || (ff >= TARGET_FF.min && ff <= TARGET_FF.max);
}

/**
 * Respect as the row shows it (two decimals), in hundredths: the order compares what is on screen, so two rows that
 * both read "3.00" fall to HP kept, not to a third decimal nobody sees.
 */
export function shownRespect(respect) {
    return Math.round((Number(respect) || 0) * 100);
}

/** Where a band falls in the order: Stomp, Good, Fair, then anything else. */
export function bandRank(band) {
    const i = ['stomp', 'good', 'fair'].indexOf(band);
    return i < 0 ? 3 : i;
}

/**
 * The one order on stored rows (the owner, 2026-10-03): band first (Stomp, Good, Fair), then the most respect, then
 * the most HP kept, then the highest win. Rows {band, respect, keep, win (0–100)}.
 */
export function byStored(a, b) {
    const pc = (v) => (Number.isFinite(v) ? Math.round(v) : -1);
    return bandRank(a.band) - bandRank(b.band) || shownRespect(b.respect) - shownRespect(a.respect) || pc(b.keep) - pc(a.keep) || pc(b.win) - pc(a.win);
}

/** Players you hit lately ({id: when}), without the ones older than GONE_KEEP_MS. */
export function goneNow(gone, now = Date.now()) {
    const out = {};
    for (const [id, at] of Object.entries(gone || {})) if (Number(at) > 0 && now - Number(at) < GONE_KEEP_MS) out[id] = Number(at);
    return out;
}

/**
 * What is kept of a stored list: in the order, without the players you hit lately, at most LIST_MAX (the active 100
 * and the reserve). A list stored by an older version (600 players) is cut the same way.
 */
export function cutTargets(list, { gone = null, now = Date.now() } = {}) {
    const g = goneNow(gone, now);
    return (list || []).filter((r) => r && r.playerId > 0 && !g[r.playerId]).sort(byStored).slice(0, LIST_MAX);
}

/**
 * The live rows (judged again now, in byOrder) split: the active list (the first ACTIVE_MAX) and the reserve behind it.
 * A row under 50% HP kept (your stats or colours changed) or one you hit is not listed: the next one slides in.
 * @param {object[]} rows - {band, respect, forecast, hit}
 */
export function splitTargets(rows) {
    const listed = (rows || []).filter((r) => r && isBeatable(r.band) && !(r.hit && r.hit.kind === 'hit')).sort(byOrder);
    return { active: listed.slice(0, ACTIVE_MAX), reserve: listed.slice(ACTIVE_MAX, LIST_MAX) };
}

/**
 * A player you hit drops out of the stored list at once (the owner: "hit → drop → refill"), remembered in `gone` so a
 * refill or a reload doesn't bring them back for GONE_KEEP_MS.
 * @param {object} stored - the stored list {list, gone, …}
 * @param {Map<number, {kind}>} hits - ownHits(): only real hits (`kind: 'hit'`) drop a row, not an attack page opened
 * @returns {object|null} the stored list without them, or null when nobody was hit
 */
export function dropHits(stored, hits, now = Date.now()) {
    if (!stored || !Array.isArray(stored.list)) return null;
    const out = [];
    const gone = goneNow(stored.gone, now);
    let n = 0;
    for (const r of stored.list) {
        const h = r && hits && hits.get(Number(r.playerId));
        if (h && h.kind === 'hit') {
            gone[r.playerId] = now;
            n++;
        } else out.push(r);
    }
    return n ? { ...stored, list: out, gone } : null;
}

/* ------------------------------------------------ the stomp edge (the owner, 2026-10-03) */

/** The probe's id (it seeds the Monte Carlo, so the same stats give the same edges every time). */
export const EDGE_PROBE_ID = 1000003;
/** Bisection steps between fair fight 1 and 3: 2 / 2⁸ ≈ 0.008. */
export const EDGE_STEPS = 8;
/** [calibrate] Edges when your stats aren't known yet: roughly the old slices. */
export const FALLBACK_EDGES = { stomp: 2.0, good: 2.5, fair: 3.0 };

/**
 * HP kept (whole percent, as bandOf reads it; 0 when you never win) against a typical player of this level whose
 * strength is the given fair fight against you. The likely builds of fight.js at that battle-stat score.
 * @param {object} o - {me: {str,spd,def,dex}, myLife, gearMe, level, ff, adjust: forecast => {pWin, keep} (what the fight learner kept)}
 */
export function keepAt({ me, myLife = 7500, gearMe, level = 100, ff, adjust = null }) {
    const bss = (3 / 8) * (Math.max(1, ff) - 1) * bssOf(me);
    let f = forecast({ me: { ...me, life: myLife }, target: { id: EDGE_PROBE_ID, life: lifeFromLevel(level), bss }, gearMe });
    if (adjust) f = { ...f, ...adjust(f) };
    if (!(f.pWin > 0) || !Number.isFinite(f.keep)) return 0;
    return Math.round(f.keep * 100);
}

/**
 * The fair fight at which you'd stop keeping `keep`% of your HP against a typical player of this level: the highest
 * fair fight (1–3, two decimals) still at or over it. 3 when even the strongest keeps it; 1 when nobody does. Our fight
 * model's HP kept falls as the other player gets stronger, so a bisection finds it.
 */
export function edgeFor(probe, keep) {
    const at = (ff) => probe(ff) >= keep;
    if (at(TARGET_FF.max)) return TARGET_FF.max;
    if (!at(TARGET_FF.min)) return TARGET_FF.min;
    let lo = TARGET_FF.min;
    let hi = TARGET_FF.max;
    for (let i = 0; i < EDGE_STEPS; i++) {
        const mid = (lo + hi) / 2;
        if (at(mid)) lo = mid;
        else hi = mid;
    }
    return Math.floor(lo * 100) / 100;
}

/**
 * The stomp, good and fair edges of each level band (the band's top level: its strongest players, the most life), in
 * fair-fight terms, the figure FFScouter's finder is asked with.
 * @param {object} o - {me, myLife, gearMe, adjust, minLevel, maxLevel}
 * @returns {{minLevel, maxLevel, level, stomp, good, fair}[]} highest levels first
 */
export function findEdges({ me, myLife = 7500, gearMe, adjust = null, minLevel = 1, maxLevel = 100 }) {
    return levelBands(minLevel, maxLevel)
        .reverse()
        .map(([a, b]) => {
            const memo = new Map();
            const probe = (ff) => {
                const k = Math.round(ff * 1000);
                if (!memo.has(k)) memo.set(k, keepAt({ me, myLife, gearMe, level: b, ff, adjust }));
                return memo.get(k);
            };
            const stomp = edgeFor(probe, BAND_KEEP.stomp);
            const good = Math.max(stomp, edgeFor(probe, BAND_KEEP.good));
            const fair = Math.max(good, edgeFor(probe, BAND_KEEP.fair));
            return { minLevel: a, maxLevel: b, level: b, stomp, good, fair };
        });
}

/** The edges when your stats aren't known: FALLBACK_EDGES for every level band. */
export function fallbackEdges({ minLevel = 1, maxLevel = 100 } = {}) {
    return levelBands(minLevel, maxLevel)
        .reverse()
        .map(([a, b]) => ({ minLevel: a, maxLevel: b, level: b, ...FALLBACK_EDGES }));
}

/* ------------------------------------------------ the asks: zones under each edge, a cursor each */

/** The zones, in the order they are asked: Stomp under the stomp edge, then Good, then Fair. */
export const ZONES = ['stomp', 'good', 'fair'];

const round2 = (v) => Math.round(v * 100) / 100;

/** Where a band's zone starts (its weakest fair fight). */
function zoneBottom(b, zone) {
    return zone === 'stomp' ? TARGET_FF.min : zone === 'good' ? b.edges.stomp : b.edges.good;
}

/**
 * A new plan from the edges (stored with the list, so a refill goes on where the load stopped). Each band's zone has a
 * cursor (`top`: the next ask's highest fair fight) and is `dry` once an answer comes back short.
 */
export function askPlan(edges) {
    return {
        bands: (edges || []).map((e) => {
            const b = { minLevel: e.minLevel, maxLevel: e.maxLevel, edges: { stomp: e.stomp, good: e.good, fair: e.fair }, top: { stomp: e.stomp, good: e.good, fair: e.fair }, dry: {}, skip: false };
            for (const z of ZONES) b.dry[z] = !(b.top[z] > zoneBottom(b, z) + 0.005);
            return b;
        }),
        asks: { stomp: 0, good: 0, fair: 0 },
        ffIgnored: false,
    };
}

/** Whether any band still has this zone to ask. */
export function zoneOpen(plan, zone) {
    return Boolean(plan && plan.bands.some((b) => !b.skip && !b.dry[zone]));
}

/**
 * Which zone the next ask is in. Stomp first; Good and Fair only once Stomps run short: the Stomp zone is done, or
 * (after two Stomp asks) the Stomps so far won't reach ACTIVE_MAX at this rate in the asks left. null: nothing left.
 * @param {object} o - {stomps: Stomps kept so far, asked, cap}
 */
export function pickZone(plan, { stomps = 0, asked = 0, cap = TARGET_ASKS_MAX } = {}) {
    const open = zoneOpen(plan, 'stomp');
    const n = plan ? plan.asks.stomp : 0;
    const short = !open || (n >= 2 && stomps + (cap - asked) * (stomps / n) < ACTIVE_MAX);
    if (open && !short) return 'stomp';
    for (const z of ['good', 'fair']) if (zoneOpen(plan, z)) return z;
    return open ? 'stomp' : null;
}

/**
 * The next ask in a zone: the open band whose top could give the most respect (respect is base(level) × fair fight,
 * so high levels first, then lower), from the zone's bottom up to its cursor. null when the zone is done.
 */
export function nextAsk(plan, zone, { inactiveOnly = 1, factionless = null } = {}) {
    let best = -1;
    let worth = -Infinity;
    (plan ? plan.bands : []).forEach((b, i) => {
        if (b.skip || b.dry[zone]) return;
        const w = (1 + b.maxLevel / 200) * b.top[zone];
        if (w > worth) {
            worth = w;
            best = i;
        }
    });
    if (best < 0) return null;
    const b = plan.bands[best];
    return { minLevel: b.minLevel, maxLevel: b.maxLevel, minFf: round2(zoneBottom(b, zone)), maxFf: round2(b.top[zone]), inactiveOnly, factionless, zone, band: best };
}

/**
 * Move the plan on after an answer: FFScouter ignored the range (that band is not asked again), the zone ran out (a
 * short answer), or the cursor goes just under the weakest player the answer gave.
 */
export function noteAnswer(plan, q, rows, limit = ASK_LIMIT) {
    const b = plan.bands[q.band];
    plan.asks[q.zone] = (plan.asks[q.zone] || 0) + 1;
    if (listIgnoresFf(rows, q)) {
        b.skip = true;
        plan.ffIgnored = true;
        return plan;
    }
    if ((rows || []).length < limit) {
        b.dry[q.zone] = true;
        return plan;
    }
    const ffs = rows.map((r) => r && r.fairFight).filter((v) => Number.isFinite(v) && v <= q.maxFf + 0.05);
    const low = ffs.length ? Math.min(...ffs) : q.maxFf - 0.1;
    b.top[q.zone] = round2(Math.min(low, q.maxFf) - 0.01);
    if (!(b.top[q.zone] > zoneBottom(b, q.zone) + 0.005)) b.dry[q.zone] = true;
    return plan;
}

/**
 * The hard rule: judge every candidate, keep only the ones you beat.
 * @param {object[]} rows - merged list rows
 * @param {function} judge - row => {band, win (0–100), keep (0–100|null), respect, ours (fair fight), source, ageDays} | null
 * @returns {{kept: object[], dropped: {low, none, range}}} low: you'd keep under 50% HP (or never win)
 */
export function selectTargets(rows, judge) {
    const kept = [];
    const dropped = { low: 0, none: 0, range: 0 };
    for (const r of rows || []) {
        if (!inFfRange(r)) {
            dropped.range++;
            continue;
        }
        const j = judge(r);
        if (!j || !j.band || j.band === 'none') dropped.none++;
        else if (!isBeatable(j.band)) dropped.low++;
        else kept.push({ ...r, ...j });
    }
    kept.sort(byStored);
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
 * @param {object} o - {me: {str,spd,def,dex}, myLife, row, ffs (normalizeFfsRow), now}
 */
export function judgeTarget({ me, myLife = 7500, row, ffs = null, now = Date.now() }) {
    const est = estimatePlayer({ me, ffs: ffs || listRowAsFfs(row, now), now });
    if (!est) return null;
    const f = forecast({ me: { ...me, life: myLife }, target: { id: row.playerId, life: lifeFromLevel(row.level), bss: est.bss } });
    const ours = fairFight(est.bss, bssOf(me));
    return {
        band: bandOf(f),
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

/* ------------------------------------------------ round 7: where a target is, from what was already read */

/**
 * A status read is believed this long; a hospital stay until its own time, a flight until it lands. 15 min: one pass
 * over the active 100 at 30 a minute takes under 4 min and each player is read again every 10 min, so a row read in
 * the last pass is still known when the next one reaches it (25 min while the list was 600).
 */
export const STATUS_FRESH_MS = 15 * 60 * 1000;

/**
 * Where a player is, from reads already made, or null when nothing fresh is known. A stored target has no status of
 * its own (FFScouter's list carries none, and the list asks Torn about nobody), so a player abroad read as "Okay".
 * This joins what other reads left behind (the watch list, the war list, a profile, a flight first seen): the
 * newest wins, and one too old to trust is dropped.
 * @param {{status: object, at: number}[]} reads - Torn's {state, description, until (s)} and when it was read (ms)
 * @param {object} [o] - {flight: {desc, at} from the flights seen, now}
 * @returns {{status, at, state: 'okay'|'hospital'|'travel'|'jail'|'fallen'}|null}
 */
export function knownStatus(reads, { flight = null, now = Date.now() } = {}) {
    const all = (reads || []).filter((r) => r && r.status && r.at > 0);
    if (flight && flight.desc && flight.at > 0) all.push({ status: { state: /^in /i.test(flight.desc) ? 'Abroad' : 'Traveling', description: flight.desc }, at: flight.at });
    if (!all.length) return null;
    const r = all.reduce((a, b) => (b.at > a.at ? b : a));
    const m = { status: r.status };
    const st = memberState(m);
    const fresh = now - r.at < STATUS_FRESH_MS;
    if (st === 'hospital') {
        const until = Number(r.status.until) > 0 ? Number(r.status.until) * 1000 : null;
        if (until ? until <= now : !fresh) return null;
        return { status: r.status, at: r.at, state: 'hospital' };
    }
    if (st === 'traveling') {
        const tr = travelOf(m);
        const lands = tr && tr.minutes ? r.at + tr.minutes * 60000 : null;
        if (!fresh && !(lands && lands > now)) return null;
        return { status: r.status, at: r.at, state: 'travel' };
    }
    // Jail like hospital (round 7 review): until its own out-time, and no longer once that has passed.
    if (st === 'jail') {
        const until = Number(r.status.until) > 0 ? Number(r.status.until) * 1000 : null;
        if (until ? until <= now : !fresh) return null;
        return { status: r.status, at: r.at, state: 'jail' };
    }
    if (!fresh) return null;
    return { status: r.status, at: r.at, state: st === 'abroad' ? 'travel' : st };
}

/**
 * One stored target's status, from the reads already made (round 7 review):
 *   - `status`: the newest one still worth believing (knownStatus), or null;
 *   - `statusAt`: when the player was last read, by anything. The scheduler asks again STATUS_REFRESH_MS after it, a
 *     hospital stay included (a player revived early is seen within 10 minutes, not at the stay's end);
 *   - `hospitalUntil`: FFScouter's out-time from the list, only while no read is newer than the list. The list can be
 *     6 hours old: a player revived since and read "Okay" was still shown in hospital and hidden by "Ready now".
 * @param {{status, at}[]} reads - Torn's statuses and when each was read (ms); nulls are skipped
 * @param {object} o - {listAt: when the list was asked (ms), hospitalUntil: the list's out-time (ms), flight, now}
 * @returns {{status: object|null, statusAt: number, hospitalUntil: number|null}}
 */
export function targetStatus(reads, { listAt = 0, hospitalUntil = null, flight = null, now = Date.now() } = {}) {
    const real = (reads || []).filter((r) => r && r.status && r.at > 0);
    const statusAt = real.reduce((a, r) => Math.max(a, r.at), 0);
    const known = knownStatus(real, { flight, now });
    const fromList = Number(hospitalUntil) > 0 && !(statusAt > (Number(listAt) || 0)) ? Number(hospitalUntil) : null;
    return { status: known ? known.status : null, statusAt, hospitalUntil: fromList };
}

/* ------------------------------------------------ round 7: a player you just hit */

/** Results of your own attack that leave the other player in hospital. */
export const HIT_RESULTS = ['Hospitalized', 'Attacked', 'Mugged'];

/**
 * [calibrate] An attack of yours counts as a hit this long (Torn's hospital times vary with the hit and aren't in the
 * attack row): a target you hit inside it drops out of the list (dropHits) and is kept out for GONE_KEEP_MS.
 */
export const OWN_HIT_MS = 60 * 60 * 1000;

/** Your attacks are read hourly: until the next read, an attack page you opened this recently marks the row. */
export const ATTACK_OPENED_MS = 10 * 60 * 1000;

/**
 * Who you hit lately, with no call: from your attacks (read hourly) and, until that read, from the attack pages you
 * opened (Torn Eye notes each one for its fight learner).
 * @param {object[]} attacks - myAttacks rows {def, ended (s), result}
 * @param {object[]} predictions - {def, at (ms)}
 * @returns {Map<number, {kind: 'hit'|'opened', at, result}>}
 */
export function ownHits(attacks, predictions, now = Date.now()) {
    const out = new Map();
    for (const p of predictions || []) {
        const id = Number(p && p.def);
        if (!(id > 0) || !(now - p.at < ATTACK_OPENED_MS) || p.at > now) continue;
        if (!out.has(id) || out.get(id).at < p.at) out.set(id, { kind: 'opened', at: p.at, result: null });
    }
    for (const a of attacks || []) {
        const id = Number(a && a.def);
        const at = (Number(a && a.ended) || 0) * 1000;
        if (!(id > 0) || !HIT_RESULTS.includes(a.result) || !(now - at < OWN_HIT_MS)) continue;
        const cur = out.get(id);
        if (!cur || cur.kind !== 'hit' || cur.at < at) out.set(id, { kind: 'hit', at, result: a.result });
    }
    return out;
}

/** "You hospitalized them 12 min ago", "Attack opened 4 min ago". */
export function hitText(hit, now = Date.now()) {
    const min = Math.max(1, Math.round((now - hit.at) / 60000));
    if (hit.kind === 'opened') return 'Attack opened ' + min + ' min ago';
    return 'You ' + (hit.result === 'Hospitalized' ? 'hospitalized' : hit.result === 'Mugged' ? 'mugged' : 'beat') + ' them ' + min + ' min ago';
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
        if (d.low) parts.push(d.low + ' under 50% HP kept dropped');
        if (d.none) parts.push(d.none + ' with no estimate');
        return { kind: 'empty', text: 'FFScouter found nobody you can beat in range' + (parts.length ? ' · ' + parts.join(' · ') : '') };
    }
    return { kind: 'none', text: stored ? '' : 'No targets yet.' };
}

/* ------------------------------------------------ round 7: the list (mockups/round7/torn-eye-targets.html) */

/** Rows a page; only these are built (round 7: 300 rows drawn at once held the click up). */
export const PAGE_SIZE = 20;

/** The band chips, in order. */
export const BAND_CHIPS = ['all', 'stomp', 'good', 'fair'];

/**
 * The one order on the rows the tab draws (forecast 0..1), and on the targets synced to Discord: band first (Stomp,
 * Good, Fair), then the most respect, then the most HP kept, then the highest win.
 */
export function byOrder(a, b) {
    // Compared as the row shows them (respect to 2 decimals, HP kept and win in whole percents), so the tie-breaks apply.
    const k = (r) => (r.forecast && Number.isFinite(r.forecast.keep) ? Math.round(r.forecast.keep * 100) : -1);
    const w = (r) => (r.forecast && Number.isFinite(r.forecast.pWin) ? Math.round(r.forecast.pWin * 100) : -1);
    return bandRank(a.band) - bandRank(b.band) || shownRespect(b.respect) - shownRespect(a.respect) || k(b) - k(a) || w(b) - w(a);
}

/** A hospital or jail read whose own out-time has passed: they are out (or about to be), so it says nothing now. */
export function statusOver(status, now = Date.now()) {
    const st = status || {};
    const s = String(st.state || st.description || '').toLowerCase();
    return (s.includes('hospital') || s.includes('jail')) && Number(st.until) > 0 && Number(st.until) * 1000 <= now;
}

/**
 * Where a target row is, from what is known: 'hospital' (FFScouter's out-time, a read, or your own hit in the last
 * hour), 'travel' (flying or abroad), 'jail', 'okay', 'other', or 'unknown' when nothing fresh was read.
 */
export function rowState(r, now = Date.now()) {
    const st = (r && r.status) || {};
    const s = statusOver(st, now) ? '' : String(st.state || st.description || '').toLowerCase();
    if ((r.hospitalUntil && r.hospitalUntil > now) || s.includes('hospital') || (r.hit && r.hit.kind === 'hit')) return 'hospital';
    if (s.includes('travel') || s.includes('abroad') || s.startsWith('in ')) return 'travel';
    if (s.includes('jail') || s.includes('federal')) return 'jail';
    return s ? (s.includes('okay') ? 'okay' : 'other') : 'unknown';
}

/** "Ready now" hides these: in hospital (or hit by you in the last hour), flying or abroad, in jail. Unknown stays. */
export function isReadyNow(r, now = Date.now()) {
    const s = rowState(r, now);
    return !(s === 'hospital' || s === 'travel' || s === 'jail');
}

/**
 * The Targets view's rows: only listed bands (the hard rule, whatever was stored), the band chip, "Ready now", the one
 * order. Counts per chip are of every listed row (before "Ready now"); `hidden` is what "Ready now" took out.
 * @param {object[]} rows - {band, respect, forecast, status, hospitalUntil, hit}
 * @param {object} o - {band: 'all'|'stomp'|'good'|'fair', ready: boolean, now}
 * @returns {{rows: object[], counts: {all, stomp, good, fair}, hidden: number}}
 */
export function listTargets(rows, { band = 'all', ready = true, now = Date.now() } = {}) {
    const listed = (rows || []).filter((r) => r && isBeatable(r.band));
    const counts = { all: listed.length, stomp: 0, good: 0, fair: 0 };
    for (const r of listed) counts[r.band]++;
    const inBand = BAND_CHIPS.includes(band) && band !== 'all' ? listed.filter((r) => r.band === band) : listed;
    const out = ready ? inBand.filter((r) => isReadyNow(r, now)) : inBand;
    return { rows: [...out].sort(byOrder), counts, hidden: inBand.length - out.length };
}

/** One page of rows: {rows, page (0-based, clamped), pages, from, to (1-based, for "21–40")}. */
export function pageOf(rows, page = 0, per = PAGE_SIZE) {
    const n = (rows || []).length;
    const pages = Math.max(1, Math.ceil(n / per));
    const p = Math.max(0, Math.min(pages - 1, Math.floor(Number(page) || 0)));
    const slice = (rows || []).slice(p * per, p * per + per);
    return { rows: slice, page: p, pages, from: n ? p * per + 1 : 0, to: p * per + slice.length };
}

/** The pager's numbers: the first three, the last two, the ones next to this page, '…' between (0-based). */
export function pagerItems(page, pages) {
    const out = [];
    for (let p = 0; p < pages; p++) {
        if (p < 3 || p > pages - 3 || Math.abs(p - page) <= 1) out.push(p);
        else if (out[out.length - 1] !== '…') out.push('…');
    }
    return out;
}

/* ------------------------------------------------ round 7: statuses the Torn Trading way (its updateSellPresence) */

/** Each player is asked again after this (Torn Trading's SELL_PRESENCE_REFRESH_MS). */
export const STATUS_REFRESH_MS = 10 * 60 * 1000;
/** The player you opened to attack: again after this (Trading's open item, SELL_PRESENCE_OPEN_REFRESH_MS). */
export const STATUS_OPEN_REFRESH_MS = 90 * 1000;
/** At most this many asked a minute (Trading's SELL_PRESENCE_PER_MIN), in Torn Eye's API lane. */
export const STATUS_PER_MIN = 30;
/** At most this many asked at once (Trading's SELL_PRESENCE_MAX_PENDING). */
export const STATUS_MAX_PENDING = 3;
/** A failed read is not asked again sooner (Trading's PRESENCE_RETRY_MS). */
export const STATUS_RETRY_MS = 2 * 60 * 1000;
/** Statuses kept across reloads and tabs: the active 100 and the reserve that slides in behind it, and a few more. */
export const STATUS_KEEP = 240;

/** Who is asked first: the player opened to attack, then the page on screen, then every other row in the list's order. */
export function statusOrder({ open = [], page = [], all = [] } = {}) {
    const seen = new Set();
    const out = [];
    for (const id of [...open, ...page, ...all]) {
        const n = Number(id);
        if (n > 0 && !seen.has(n)) {
            seen.add(n);
            out.push(n);
        }
    }
    return out;
}

/**
 * Which players to ask now (Trading's updateSellPresence, pure): in order, skipping one asked or read lately (any
 * read counts: the war list, the watch list, a flight, our own), one pending, one failed lately; never more than 3 at
 * once or 30 in a minute.
 * @param {object} o - {order: id[], open: Set, readAt: id => ms|0, pending: Set, retryAt: Map, asked: ms[], now}
 * @returns {{ask: number[], asked: number[]}} asked: the minute's ask times, these included
 */
export function statusesToAsk({ order = [], open = new Set(), readAt = () => 0, pending = new Set(), retryAt = new Map(), asked = [], now = Date.now() } = {}) {
    const minute = asked.filter((t) => now - t < 60000);
    const ask = [];
    let busy = pending.size;
    for (const id of order) {
        if (busy >= STATUS_MAX_PENDING || minute.length >= STATUS_PER_MIN) break;
        if (pending.has(id) || now < (retryAt.get(id) || 0)) continue;
        const every = open.has(id) ? STATUS_OPEN_REFRESH_MS : STATUS_REFRESH_MS;
        if (now - (readAt(id) || 0) < every) continue;
        ask.push(id);
        minute.push(now);
        busy++;
    }
    return { ask, asked: minute };
}

/**
 * Whether a row's status was actually read (round 7 review): a status from a read, not FFScouter's out-time from the
 * list nor your own hit, which are known without asking Torn and left "checked" counting rows never read.
 */
export function statusChecked(r, now = Date.now()) {
    return Boolean(r && r.status && (r.status.state || r.status.description) && !statusOver(r.status, now));
}

/**
 * The progress line's numbers: how many of the list's players have a status known now, and about how long the rest
 * take at 30 a minute.
 * @param {number[]} ids - every row of the active list (the reserve's statuses are never read)
 * @param {function} known - id => boolean
 */
export function statusProgress(ids, known) {
    const total = (ids || []).length;
    const checked = (ids || []).filter((id) => known(id)).length;
    return { checked, total, leftMin: Math.ceil((total - checked) / STATUS_PER_MIN) };
}

/** "Statuses: 37 of 100 checked · this page first · the rest in about 3 min" (the mockup's words; the active list only). */
export function statusLine({ checked, total, leftMin }) {
    if (!total) return '';
    if (checked >= total) return 'Statuses: all ' + total + ' checked · each again every 10 min';
    return 'Statuses: ' + checked + ' of ' + total + ' checked · this page first · the rest in about ' + Math.max(1, leftMin) + ' min';
}

/**
 * The statuses kept across reloads and tabs ({id: [status, at]}): two tabs' merged, the newest read of each player
 * kept, the newest STATUS_KEEP players, none over a day old.
 */
export function mergeStatuses(a, b, now = Date.now()) {
    const out = {};
    for (const src of [a, b]) {
        for (const [id, v] of Object.entries(src || {})) {
            if (!Array.isArray(v) || !v[0] || !(Number(v[1]) > 0) || !(now - Number(v[1]) < 24 * 3600e3)) continue;
            if (!out[id] || out[id][1] < Number(v[1])) out[id] = [v[0], Number(v[1])];
        }
    }
    const kept = Object.entries(out).sort((x, y) => y[1][1] - x[1][1]).slice(0, STATUS_KEEP);
    return Object.fromEntries(kept);
}

/* ------------------------------------------------ round 8: sort by a column (mockups/round8/torn-eye.html §2, his pick A) */

/** The columns a click sorts by, with the words for each way ("Sorted by HP kept, most first"). */
export const SORT_KEYS = {
    band: { label: 'Band', words: ['Stomp first', 'Fair first'] },
    level: { label: 'Lvl', words: ['highest first', 'lowest first'] },
    respect: { label: 'Respect', words: ['most first', 'least first'] },
    keep: { label: 'HP kept', words: ['most first', 'least first'] },
    win: { label: 'Win', words: ['highest first', 'lowest first'] },
    status: { label: 'Status', words: ['ready first', 'away first'] },
    hit: { label: 'Last hit', words: ['newest first', 'not hit first'] },
};

/** A kept sort as {key, dir: 1|-1}, or null (the default order) for anything else. */
export function sortOf(s) {
    return s && SORT_KEYS[s.key] ? { key: s.key, dir: s.dir === -1 ? -1 : 1 } : null;
}

/** A click on a column head: a new column sorts its first way; the same column again flips it. */
export function nextSort(cur, key) {
    const c = sortOf(cur);
    if (!SORT_KEYS[key]) return c;
    return c && c.key === key ? { key, dir: -c.dir } : { key, dir: 1 };
}

/** "HP kept, most first". */
export function sortWords(s) {
    const c = sortOf(s);
    return c ? SORT_KEYS[c.key].label + ', ' + SORT_KEYS[c.key].words[c.dir === 1 ? 0 : 1] : '';
}

/** Where a row's status falls when sorting by it: ready, not read, anything else, hospital (by out-time), away, jail. */
const SORT_STATE_RANK = { okay: 0, unknown: 1, other: 2, hospital: 3, travel: 4, jail: 5 };

/**
 * When you last attacked each player, from your own attacks as read (the last 100, any result): Map id → ms.
 * A player not in it was not hit lately; whether ever is not known.
 */
export function lastHits(attacks) {
    const out = new Map();
    for (const a of attacks || []) {
        const id = Number(a && a.def);
        const at = (Number(a && a.ended) || 0) * 1000;
        if (id > 0 && at > 0 && !(out.get(id) >= at)) out.set(id, at);
    }
    return out;
}

/** The Last hit cell: "today", "5 d ago"; "—" when none of your attacks read is on them. */
export function lastHitText(at, now = Date.now()) {
    if (!(at > 0)) return '—';
    const d = Math.floor(Math.max(0, now - at) / 86400000);
    return d < 1 ? 'today' : d + ' d ago';
}

/**
 * The listed rows sorted by a column; rows that tie keep the default order (band, respect, HP kept, win). No sort:
 * the default order itself.
 * @param {object[]} rows - listTargets().rows
 * @param {{key, dir}|null} sort
 * @param {object} o - {now, hits: lastHits()}
 */
export function sortTargets(rows, sort, { now = Date.now(), hits = new Map() } = {}) {
    const list = [...(rows || [])].sort(byOrder);
    const s = sortOf(sort);
    if (!s) return list;
    const pc = (v) => (Number.isFinite(v) ? Math.round(v * 100) : -1);
    const outAt = (r) => (r.hospitalUntil && r.hospitalUntil > now ? r.hospitalUntil : Number(r.status && r.status.until) * 1000 || Infinity);
    const cmp = {
        band: (a, b) => bandRank(a.band) - bandRank(b.band),
        level: (a, b) => (Number(b.level) || 0) - (Number(a.level) || 0),
        respect: (a, b) => shownRespect(b.respect) - shownRespect(a.respect),
        keep: (a, b) => pc(b.forecast && b.forecast.keep) - pc(a.forecast && a.forecast.keep),
        win: (a, b) => pc(b.forecast && b.forecast.pWin) - pc(a.forecast && a.forecast.pWin),
        status: (a, b) => {
            const sa = rowState(a, now);
            const d = SORT_STATE_RANK[sa] - SORT_STATE_RANK[rowState(b, now)];
            return d || (sa === 'hospital' ? outAt(a) - outAt(b) : 0);
        },
        hit: (a, b) => (hits.get(Number(b.id)) || 0) - (hits.get(Number(a.id)) || 0),
    }[s.key];
    // A stable sort over the default order: ties stay as they were.
    return list.sort((a, b) => s.dir * cmp(a, b) || 0);
}

/* ------------------------------------------------ round 8: the Next button on the attack page (torn-eye.html §4, his pick A) */

/** The list handed to Torn's pages is this long at most (Tampermonkey gives it to every Torn page). */
export const NEXT_KEEP = 40;

/** A handed-over list older than this is not walked (the targets themselves are asked again every 6 h). */
export const NEXT_FRESH_MS = 6 * 60 * 60 * 1000;

/**
 * The list the Torn Eye tab shows, as a small table for Torn's attack page: in the list's own order and filters, each
 * row [id, name, level, band, respect, HP kept %, where, out-time ms]. `where`: 'ok', '?' (not read: it may be
 * ready), 'hosp', 'away', 'jail'.
 * @param {'targets'|'war'} mode
 * @param {object[]} rows - Targets rows (band, respect, forecast, status, hospitalUntil, hit) or War rows (state, until, view, m)
 */
export function nextTable(mode, rows, now = Date.now()) {
    const out = [];
    for (const r of rows || []) {
        if (out.length >= NEXT_KEEP) break;
        const v = mode === 'war' ? r.view || {} : r;
        const f = v.forecast || null;
        let where;
        let until = 0;
        if (mode === 'war') {
            if (r.state === 'fallen') continue;
            where = r.state === 'okay' || r.state === 'early' ? 'ok' : r.state === 'hospital' ? 'hosp' : r.state === 'jail' ? 'jail' : 'away';
            until = where === 'hosp' ? (Number(r.until) || 0) * 1000 : 0;
        } else {
            const s = rowState(r, now);
            where = s === 'okay' ? 'ok' : s === 'hospital' ? 'hosp' : s === 'travel' ? 'away' : s === 'jail' ? 'jail' : '?';
            // A hospital stay with no out-time read (your own hit): the hour a hit counts for.
            if (where === 'hosp') until = r.hospitalUntil && r.hospitalUntil > now ? r.hospitalUntil : Number(r.status && r.status.until) * 1000 > now ? Number(r.status.until) * 1000 : r.hit ? r.hit.at + OWN_HIT_MS : 0;
        }
        const name = mode === 'war' ? (r.m && r.m.name) || v.name : r.name;
        const level = mode === 'war' ? (r.m && r.m.level) || v.level : r.level;
        out.push([Number(r.id), name || null, Number(level) || null, v.band || 'none', Number.isFinite(v.respect) && v.respect > 0 ? Math.round(v.respect * 100) / 100 : null, f && Number.isFinite(f.keep) ? Math.round(f.keep * 100) : null, where, until]);
    }
    return { at: now, mode: mode === 'war' ? 'war' : 'targets', rows: out };
}

/** What changes a handed-over list (its age left out): written again only when this does. */
export function nextTableSig(t) {
    return t ? t.mode + '|' + JSON.stringify(t.rows) : '';
}

/**
 * The next player to open from the attack page: the first ready one after the player you are on, in the list's order
 * (from its top when they are not in it, round to its top at its end), skipping who is not ready and the attack pages
 * you opened in the last ten minutes (you were just there).
 * @param {object|null} table - nextTable()
 * @param {number} currentId - the player being attacked
 * @param {object} o - {now, opened: Set of ids opened lately}
 * @returns {{list: boolean, mode, next: {id, name, level, band, respect, keep}|null, skipped: {hosp, away, jail, opened}}}
 *   list: false when no list was handed over (or it is too old)
 */
export function nextTarget(table, currentId, { now = Date.now(), opened = new Set() } = {}) {
    const skipped = { hosp: 0, away: 0, jail: 0, opened: 0 };
    if (!table || !Array.isArray(table.rows) || !(now - (Number(table.at) || 0) < NEXT_FRESH_MS)) return { list: false, mode: 'targets', next: null, skipped };
    const rows = table.rows;
    const at = rows.findIndex((r) => Number(r[0]) === Number(currentId));
    for (let i = 1; i <= rows.length; i++) {
        const r = rows[(at + i + rows.length) % rows.length];
        const id = Number(r[0]);
        if (id === Number(currentId)) continue;
        if (opened.has(id)) skipped.opened++;
        else if (r[6] === 'hosp' && !(r[7] > 0 && r[7] <= now)) skipped.hosp++;
        else if (r[6] === 'away') skipped.away++;
        else if (r[6] === 'jail') skipped.jail++;
        else return { list: true, mode: table.mode === 'war' ? 'war' : 'targets', next: { id, name: r[1], level: r[2], band: r[3], respect: r[4], keep: r[5] }, skipped };
    }
    return { list: true, mode: table.mode === 'war' ? 'war' : 'targets', next: null, skipped };
}

/** "skips 3 not ready: 2 in hospital, 1 away"; '' when nothing was skipped. */
export function skippedText(skipped) {
    const s = skipped || {};
    const parts = [];
    if (s.hosp) parts.push(s.hosp + ' in hospital');
    if (s.away) parts.push(s.away + ' away');
    if (s.jail) parts.push(s.jail + ' in jail');
    if (s.opened) parts.push(s.opened + ' you just opened');
    const n = (s.hosp || 0) + (s.away || 0) + (s.jail || 0) + (s.opened || 0);
    return n ? 'skips ' + n + ' not ready: ' + parts.join(', ') : '';
}
