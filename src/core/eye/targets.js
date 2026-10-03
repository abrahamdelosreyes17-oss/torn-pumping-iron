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
 * and only players you beat keeping half your HP or more (Stomp, Good or
 * Fair, round 7) are ever stored. One order everywhere: most respect, then
 * most HP kept, then the highest win.
 */

import { estimatePlayer } from './estimate.js';
import { forecast, respectFor, fairFight, bssOf } from './fight.js';
import { bandOf, isListedBand } from './bands.js';
import { memberState, travelOf } from './war.js';

/** The full range: no respect cap (owner). Torn caps fair fight at 3. */
export const TARGET_FF = { min: 1.0, max: 3.0 };

/** Bumped when the way lists are asked or judged changes: an older stored list is asked again once (3: round 7's bands). */
export const TARGETS_VERSION = 3;

/** What the list is asked with (round 7: the Level range and the Show ticks are gone; inactive players, any faction). */
export const TARGET_LOAD = { minLevel: 1, maxLevel: 100, inactiveOnly: 1, factionless: null };

/** [calibrate] The list is asked again by itself when the Torn Eye tab is open and the stored one is this old (no Refresh button). */
export const TARGETS_REFRESH_MS = 6 * 60 * 60 * 1000;

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

/**
 * Respect as the row shows it (two decimals), in hundredths: the order compares what is on screen, so two rows that
 * both read "3.00" fall to HP kept, not to a third decimal nobody sees.
 */
export function shownRespect(respect) {
    return Math.round((Number(respect) || 0) * 100);
}

/** The one order (round 7, the owner): most respect, then most HP kept, then the highest win. Rows {respect, keep, win} (0–100). */
export function byRespect(a, b) {
    const pc = (v) => (Number.isFinite(v) ? Math.round(v) : -1);
    return shownRespect(b.respect) - shownRespect(a.respect) || pc(b.keep) - pc(a.keep) || pc(b.win) - pc(a.win);
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
 * A status read is believed this long; a hospital stay until its own time, a flight until it lands. 25 min (round 7,
 * was 15): one pass over 600 targets at 30 a minute takes 20 min, so a row read in the last pass is still known when
 * the next one reaches it.
 */
export const STATUS_FRESH_MS = 25 * 60 * 1000;

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
 * [calibrate] A player you beat is greyed this long. Torn's hospital times vary with the hit and aren't in the
 * attack row; the next list load brings the real out-time (FFScouter's `hospital_until`).
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

/** The one order on the rows the tab draws (forecast 0..1): most respect, then most HP kept, then the highest win. */
export function byOrder(a, b) {
    // Compared as the row shows them (respect to 2 decimals, HP kept and win in whole percents), so the tie-breaks apply.
    const k = (r) => (r.forecast && Number.isFinite(r.forecast.keep) ? Math.round(r.forecast.keep * 100) : -1);
    const w = (r) => (r.forecast && Number.isFinite(r.forecast.pWin) ? Math.round(r.forecast.pWin * 100) : -1);
    return shownRespect(b.respect) - shownRespect(a.respect) || k(b) - k(a) || w(b) - w(a);
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
/** Statuses kept across reloads and tabs: 600 targets (FFScouter's finder asked 12 × 50) and a few more. */
export const STATUS_KEEP = 640;

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
 * @param {number[]} ids - every row of the stored list
 * @param {function} known - id => boolean
 */
export function statusProgress(ids, known) {
    const total = (ids || []).length;
    const checked = (ids || []).filter((id) => known(id)).length;
    return { checked, total, leftMin: Math.ceil((total - checked) / STATUS_PER_MIN) };
}

/** "Statuses: 40 of 600 checked · this page first · the rest in about 19 min" (the mockup's words). */
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
