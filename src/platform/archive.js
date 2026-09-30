/*
 * Keeping Tampermonkey's store small (round 6, R6.2). Tampermonkey hands
 * every GM value to every Torn page before the script starts and copies it
 * on every read, so the growing histories made every Torn page slower
 * (Torn Bids' lesson: its ledger lives in IndexedDB).
 *
 * IndexedDB belongs to one site: what torn.com stores there, the webpage
 * (github.io) never sees. So:
 *   - histories the leader tab records (it can be a Torn page) keep only
 *     their recent part in GM; the webpage moves the older part into its own
 *     IndexedDB (`drainArchives`) and reads the two together (`archived`);
 *   - data only the webpage uses lives in the webpage's IndexedDB
 *     (`pageGet` / `pageSet`), with a copy in memory for synchronous reads.
 * Without IndexedDB (some private windows) everything stays in GM, as before.
 */

import { idbGet, idbSet } from './idb.js';
import { gmGet, gmSet, gmDel } from './gm.js';
import { DAY } from '../core/bars.js';

/** A map of day starts (ms or day numbers) inside a value: which days are old, and the value without them. */
function daysSpec({ get, put, keepDays, dayOf = (k) => Number(k), cap = Infinity }) {
    return {
        kind: 'days',
        // The days older than keepDays (by the value's own day keys), as {key: row}.
        old(v, now) {
            const m = get(v);
            if (!m) return {};
            const cut = dayOf.cutoff(now, keepDays);
            return Object.fromEntries(Object.entries(m).filter(([k]) => dayOf(k) < cut));
        },
        trim(v, archivedKeys) {
            const m = get(v);
            if (!m) return v;
            return put(v, Object.fromEntries(Object.entries(m).filter(([k]) => !archivedKeys.has(k))));
        },
        absorb(arch, rows) {
            const next = { ...(arch || {}), ...rows };
            const keys = Object.keys(next).sort((a, b) => dayOf(a) - dayOf(b));
            while (keys.length > cap) delete next[keys.shift()];
            return next;
        },
        keysOf: (rows) => Object.keys(rows),
        merge(arch, v) {
            if (!arch || !Object.keys(arch).length) return v;
            const m = get(v) || {};
            return put(v || null, { ...arch, ...m });
        },
    };
}

/** A list of entries (newest last) inside a value: all but the newest `keep` are old. */
function listSpec({ get, put, keep, cap, id }) {
    return {
        kind: 'list',
        old(v) {
            const l = get(v) || [];
            return l.length > keep ? l.slice(0, l.length - keep) : [];
        },
        trim(v, archivedKeys) {
            const l = get(v);
            if (!l) return v;
            return put(v, l.filter((x) => !archivedKeys.has(id(x))));
        },
        absorb(arch, rows) {
            const seen = new Set((arch || []).map(id));
            return [...(arch || []), ...rows.filter((x) => !seen.has(id(x)))].slice(-cap);
        },
        keysOf: (rows) => rows.map(id),
        merge(arch, v) {
            if (!arch || !arch.length) return v;
            const l = get(v) || [];
            const seen = new Set(l.map(id));
            return put(v || null, [...arch.filter((x) => !seen.has(id(x))), ...l].slice(-cap));
        },
    };
}

/** Day-start keys in ms (statsHistory, dayTotals, receipts). */
const msDay = (k) => Number(k);
msDay.cutoff = (now, keep) => Math.floor(now / DAY) * DAY - (keep - 1) * DAY;
/** Day-number keys (priceHistory). */
const numDay = (k) => Number(k);
numDay.cutoff = (now, keep) => Math.floor(now / DAY) - (keep - 1);

/** Price history keeps its days per item: flattened to "item|day" keys here. */
function priceDaysGet(v) {
    if (!v || !v.items) return null;
    const out = {};
    for (const [id, rec] of Object.entries(v.items)) for (const [d, p] of Object.entries(rec || {})) out[id + '|' + d] = p;
    return out;
}
function priceDaysPut(v, flat) {
    const items = {};
    for (const [k, p] of Object.entries(flat)) {
        const [id, d] = k.split('|');
        (items[id] = items[id] || {})[d] = p;
    }
    return { v: 1, ...(v || {}), items };
}
const priceDay = (k) => Number(String(k).split('|')[1]);
priceDay.cutoff = numDay.cutoff;

/**
 * The histories split between GM (recent) and the webpage's IndexedDB (older):
 * GM keeps what Torn's pages and the leader use (the build's 7-day sparkline,
 * today's receipts, the week of prices behind the 7-day average).
 */
export const ARCHIVES = {
    statsHistory: daysSpec({ get: (v) => v, put: (_v, m) => m, keepDays: 8, dayOf: msDay, cap: 400 }),
    dayTotals: daysSpec({ get: (v) => v, put: (_v, m) => m, keepDays: 2, dayOf: msDay, cap: 400 }),
    receipts: daysSpec({ get: (v) => v && v.days, put: (v, m) => ({ v: 1, pend: {}, inv: null, ...(v || {}), days: m }), keepDays: 3, dayOf: msDay, cap: 400 }),
    priceHistory: daysSpec({ get: priceDaysGet, put: priceDaysPut, keepDays: 8, dayOf: priceDay, cap: 20000 }),
    calibration: listSpec({
        get: (v) => v && v.samples,
        put: (v, l) => {
            const p = l.reduce((a, s) => a + s.predicted, 0);
            const a = l.reduce((x, s) => x + s.actual, 0);
            return { ...(v || {}), samples: l, n: l.length, errPct: p > 0 ? (100 * (a - p)) / p : 0 };
        },
        keep: 20,
        cap: 500,
        id: (s) => s.at + ':' + s.stat,
    }),
    eyePredictions: listSpec({ get: (v) => v, put: (_v, l) => l, keep: 30, cap: 300, id: (p) => p.def + ':' + p.at }),
};

/** Data only the webpage uses: its IndexedDB, never GM (moved out of GM once). */
export const PAGE_KEYS = ['moneyLog', 'gymLog', 'fightLog', 'learnLog', 'planLine', 'eyeTargets', 'eyeFlights', 'eyeWatchState'];

const mem = { loaded: false, loading: null, arch: {}, page: {}, idb: false };

/** The webpage's copy is in memory (after `loadArchives`). */
export function archivesReady() {
    return mem.loaded;
}

/**
 * The webpage, at start: read its IndexedDB into memory, and move what 1.2.3
 * kept in GM (webpage-only data) over once. Without IndexedDB, GM stays in use.
 */
export function loadArchives() {
    if (mem.loading) return mem.loading;
    mem.loading = (async () => {
        try {
            const saved = (await idbGet('archives')) || {};
            mem.arch = saved.arch || {};
            mem.page = saved.page || {};
            mem.idb = true;
        } catch {
            mem.idb = false;
        }
        if (mem.idb) {
            let moved = false;
            for (const k of PAGE_KEYS) {
                const v = gmGet(k, null);
                if (v !== null && v !== undefined) {
                    if (mem.page[k] === undefined) mem.page[k] = v;
                    moved = true;
                }
            }
            if (moved) {
                await persist();
                for (const k of PAGE_KEYS) gmDel(k);
            }
        }
        mem.loaded = true;
        return mem;
    })();
    return mem.loading;
}

let writing = Promise.resolve();
/** One write at a time, the whole webpage copy (a few hundred KB, off Torn's pages). */
function persist() {
    const snap = { arch: mem.arch, page: mem.page };
    writing = writing.catch(() => {}).then(() => idbSet('archives', snap));
    return writing;
}

/** A history, whole: the webpage's older part with GM's recent part (elsewhere: GM's part). */
export function archived(key, fallback = null) {
    const v = gmGet(key, null);
    const spec = ARCHIVES[key];
    if (!spec || !mem.loaded) return v === null ? fallback : v;
    const out = spec.merge(mem.arch[key], v);
    return out === null || out === undefined ? fallback : out;
}

/** Webpage-only data: from the webpage's IndexedDB copy (GM until that's loaded or when there is no IndexedDB). */
export function pageGet(key, fallback = null) {
    if (mem.loaded && mem.idb) {
        const v = mem.page[key];
        return v === undefined || v === null ? fallback : v;
    }
    return gmGet(key, fallback);
}

export function pageSet(key, value) {
    if (mem.loaded && mem.idb) {
        if (value === null || value === undefined) delete mem.page[key];
        else mem.page[key] = value;
        persist().catch(() => {});
        return;
    }
    if (value === null || value === undefined) gmDel(key);
    else gmSet(key, value);
}

/**
 * The webpage moves the older part of each history out of GM into its
 * IndexedDB. GM is trimmed only after the copy is saved, and only of what was
 * copied (a newer entry the leader wrote meanwhile stays).
 */
export async function drainArchives(now = Date.now()) {
    await loadArchives();
    if (!mem.idb) return 0;
    let moved = 0;
    for (const [key, spec] of Object.entries(ARCHIVES)) {
        const rows = spec.old(gmGet(key, null), now);
        const keys = spec.keysOf(rows);
        if (!keys.length) continue;
        mem.arch[key] = spec.absorb(mem.arch[key], rows);
        try {
            await persist();
        } catch {
            return moved;
        }
        // Synchronous from here: read the newest GM value, drop only what is now safe in IndexedDB.
        const done = new Set(keys);
        const cur = gmGet(key, null);
        if (cur !== null) gmSet(key, spec.trim(cur, done));
        moved += keys.length;
    }
    return moved;
}

/** Forget the webpage's copy of some keys (Settings › Your data). */
export function clearArchived(keys) {
    let changed = false;
    for (const k of keys) {
        if (mem.arch[k] !== undefined) {
            delete mem.arch[k];
            changed = true;
        }
        if (mem.page[k] !== undefined) {
            delete mem.page[k];
            changed = true;
        }
    }
    if (changed && mem.idb) persist().catch(() => {});
}

/** For tests: start again as a fresh page. */
export function resetArchivesForTest() {
    mem.loaded = false;
    mem.loading = null;
    mem.arch = {};
    mem.page = {};
    mem.idb = false;
}
