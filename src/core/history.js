/*
 * Price history the script records itself. Pure - the caller stores it.
 *
 * No API gives an item's price history: Torn's market value is a single
 * daily average of sales, and TornW3B publishes only what is listed now. So
 * the only way to say "what did this go for over the past week" is to write
 * down what was asked, regularly, from now on. What is recorded:
 *
 *   im  - the lowest Item Market asking price (one Torn call per item)
 *   bz  - the lowest bazaar asking price (TornW3B's one-call summary)
 *   mv  - Torn's market value, once a day (the one sale-based number)
 *
 * Three resolutions, each a fixed window, so storage stays small:
 *
 *   5-minute buckets for the last 24 hours   (288 buckets)
 *   hourly buckets    for the last 7 days    (168)
 *   6-hourly buckets  for the last 30 days   (120)
 *
 * A bucket is [bucketNumber, im, bz] - the LAST sample in that bucket for
 * 5-minute buckets, the average of samples for the coarser ones ([n, im, bz,
 * count]). Only items the user has shown interest in (their own bazaar, their
 * inventory) are tracked, up to HISTORY_MAX_ITEMS, oldest interest dropped.
 *
 * An average is only as good as its coverage: every average carries the
 * share of its window that actually has data, and callers must show it.
 */

export const HISTORY_VERSION = 1;
export const HISTORY_MAX_ITEMS = 60;

export const RES = {
    m5: { ms: 5 * 60 * 1000, keep: 288 },
    h1: { ms: 60 * 60 * 1000, keep: 168 },
    h6: { ms: 6 * 60 * 60 * 1000, keep: 120 },
};

export const DAY_MS = 24 * 60 * 60 * 1000;

/** The windows the UI shows, with the resolution that spans each. */
export const WINDOWS = [
    { key: '1h', label: '1 hour', ms: 60 * 60 * 1000, res: 'm5' },
    { key: '6h', label: '6 hours', ms: 6 * 60 * 60 * 1000, res: 'm5' },
    { key: '24h', label: '24 hours', ms: DAY_MS, res: 'm5' },
    { key: '7d', label: '7 days', ms: 7 * DAY_MS, res: 'h1' },
    { key: '30d', label: '30 days', ms: 30 * DAY_MS, res: 'h6' },
];

export function emptyHistory() {
    return { version: HISTORY_VERSION, items: {} };
}

export function readHistory(entry) {
    if (!entry || entry.version !== HISTORY_VERSION || !entry.items || typeof entry.items !== 'object') {
        return emptyHistory();
    }
    return entry;
}

function itemRec(store, itemId, now) {
    const id = String(itemId);
    if (!store.items[id]) store.items[id] = { m5: [], h1: [], h6: [], mv: [], seen: now };
    const rec = store.items[id];
    rec.seen = now;
    return rec;
}

function positive(v) {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

/**
 * Record one observation. Missing values (null) leave that column alone.
 * @param {object} sample - { im?: number, bz?: number }
 */
export function recordSample(store, itemId, now, sample) {
    const im = positive(sample && sample.im);
    const bz = positive(sample && sample.bz);
    if (im === null && bz === null) return store;

    const rec = itemRec(store, itemId, now);

    // 5-minute: the last sample wins.
    {
        const n = Math.floor(now / RES.m5.ms);
        const last = rec.m5[rec.m5.length - 1];
        if (last && last[0] === n) {
            if (im !== null) last[1] = im;
            if (bz !== null) last[2] = bz;
        } else {
            rec.m5.push([n, im, bz]);
        }
    }

    // Coarser: running averages per column, with separate counts.
    for (const key of ['h1', 'h6']) {
        const n = Math.floor(now / RES[key].ms);
        const arr = rec[key];
        let last = arr[arr.length - 1];
        if (!last || last[0] !== n) {
            last = [n, null, null, 0, 0];
            arr.push(last);
        }
        if (im !== null) {
            last[1] = last[3] ? Math.round((last[1] * last[3] + im) / (last[3] + 1)) : im;
            last[3] += 1;
        }
        if (bz !== null) {
            last[2] = last[4] ? Math.round((last[2] * last[4] + bz) / (last[4] + 1)) : bz;
            last[4] += 1;
        }
    }

    return store;
}

/** Torn's market value, once per day. */
export function recordMarketValue(store, itemId, now, value) {
    const v = positive(value);
    if (v === null) return store;
    const rec = itemRec(store, itemId, now);
    const day = Math.floor(now / DAY_MS);
    const last = rec.mv[rec.mv.length - 1];
    if (last && last[0] === day) last[1] = v;
    else rec.mv.push([day, v]);
    if (rec.mv.length > 31) rec.mv.splice(0, rec.mv.length - 31);
    return store;
}

/** Mark an item as one worth keeping (seen in your bazaar or inventory). */
export function touchItem(store, itemId, now) {
    itemRec(store, itemId, now);
    return store;
}

/** Drop buckets outside their window, and the least recently seen items over the cap. */
export function pruneHistory(store, now, maxItems = HISTORY_MAX_ITEMS) {
    for (const rec of Object.values(store.items)) {
        for (const key of Object.keys(RES)) {
            const oldest = Math.floor(now / RES[key].ms) - RES[key].keep + 1;
            rec[key] = (rec[key] || []).filter((b) => b[0] >= oldest);
        }
        const oldestDay = Math.floor(now / DAY_MS) - 30;
        rec.mv = (rec.mv || []).filter((b) => b[0] >= oldestDay);
    }

    const ids = Object.keys(store.items);
    if (ids.length > maxItems) {
        ids.sort((a, b) => (store.items[a].seen || 0) - (store.items[b].seen || 0));
        for (const id of ids.slice(0, ids.length - maxItems)) delete store.items[id];
    }
    return store;
}

/**
 * Averages for every window, each with its coverage.
 *
 * @returns {Object<string, {im: number|null, bz: number|null, coverage: number, buckets: number}>}
 *   coverage: buckets with any data / buckets in the window (0..1)
 */
export function averages(store, itemId, now) {
    const rec = store.items[String(itemId)];
    const out = {};

    for (const w of WINDOWS) {
        const res = RES[w.res];
        const total = Math.round(w.ms / res.ms);
        const oldest = Math.floor(now / res.ms) - total + 1;
        const buckets = rec ? (rec[w.res] || []).filter((b) => b[0] >= oldest) : [];

        let imSum = 0;
        let imN = 0;
        let bzSum = 0;
        let bzN = 0;
        let filled = 0;
        for (const b of buckets) {
            const im = b[1];
            const bz = b[2];
            if (im !== null || bz !== null) filled += 1;
            if (im !== null) {
                imSum += im;
                imN += 1;
            }
            if (bz !== null) {
                bzSum += bz;
                bzN += 1;
            }
        }

        out[w.key] = {
            im: imN ? Math.round(imSum / imN) : null,
            bz: bzN ? Math.round(bzSum / bzN) : null,
            coverage: total ? filled / total : 0,
            buckets: total,
        };
    }
    return out;
}

/**
 * Points for a graph over one window: [{t, im, bz}] oldest first, plus the
 * market value line as [{t, mv}].
 */
export function series(store, itemId, now, windowKey) {
    const w = WINDOWS.find((x) => x.key === windowKey) || WINDOWS[2];
    const res = RES[w.res];
    const total = Math.round(w.ms / res.ms);
    const oldest = Math.floor(now / res.ms) - total + 1;
    const rec = store.items[String(itemId)];

    const points = rec
        ? (rec[w.res] || [])
              .filter((b) => b[0] >= oldest)
              .map((b) => ({ t: b[0] * res.ms, im: b[1], bz: b[2] }))
        : [];

    const oldestDay = Math.floor((now - w.ms) / DAY_MS);
    const mv = rec ? (rec.mv || []).filter((b) => b[0] >= oldestDay).map((b) => ({ t: b[0] * DAY_MS, mv: b[1] })) : [];

    return { from: now - w.ms, to: now, points, mv, step: res.ms };
}

/**
 * Two copies of the history, one from storage and one from this tab, as
 * one. Every tab keeps its own copy and saves the whole thing, so without
 * this the selling tab's inventory items and the bazaar tab's samples
 * overwrite each other. Per item: buckets are the union by bucket number;
 * where both have a bucket, each column keeps the value backed by more
 * samples (coarse buckets) or the local one (5-minute buckets, where the
 * last sample wins and this tab's is the one it just took); `seen` is the
 * later. Neither input is changed.
 */
export function mergeHistory(stored, local) {
    const a = readHistory(stored);
    const b = readHistory(local);
    const out = emptyHistory();

    const ids = new Set([...Object.keys(a.items), ...Object.keys(b.items)]);
    for (const id of ids) {
        const ra = a.items[id];
        const rb = b.items[id];
        if (!ra || !rb) {
            out.items[id] = cloneRec(ra || rb);
            continue;
        }
        const rec = { m5: [], h1: [], h6: [], mv: [], seen: Math.max(Number(ra.seen) || 0, Number(rb.seen) || 0) };
        rec.m5 = mergeBuckets(ra.m5, rb.m5, mergeLast);
        rec.h1 = mergeBuckets(ra.h1, rb.h1, mergeAvg);
        rec.h6 = mergeBuckets(ra.h6, rb.h6, mergeAvg);
        rec.mv = mergeBuckets(ra.mv, rb.mv, (x, y) => [y[0], y[1]]);
        out.items[id] = rec;
    }
    return out;
}

function cloneRec(rec) {
    return {
        m5: (rec.m5 || []).map((b) => [...b]),
        h1: (rec.h1 || []).map((b) => [...b]),
        h6: (rec.h6 || []).map((b) => [...b]),
        mv: (rec.mv || []).map((b) => [...b]),
        seen: Number(rec.seen) || 0,
    };
}

/** Union by bucket number, ascending; `both(stored, local)` where both have one. */
function mergeBuckets(stored, local, both) {
    const byN = new Map();
    for (const b of stored || []) if (Array.isArray(b)) byN.set(b[0], [...b]);
    for (const b of local || []) {
        if (!Array.isArray(b)) continue;
        const s = byN.get(b[0]);
        byN.set(b[0], s ? both(s, [...b]) : [...b]);
    }
    return [...byN.values()].sort((x, y) => x[0] - y[0]);
}

/** 5-minute bucket: a column this tab has wins; a column it lacks comes from storage. */
function mergeLast(s, l) {
    const col = (i) => (l[i] !== null && l[i] !== undefined ? l[i] : s[i] ?? null);
    return [l[0], col(1), col(2)];
}

/** Averaged bucket: per column, the value backed by more samples (ties to this tab). */
function mergeAvg(s, l) {
    const pick = (vi, ci) => {
        const sc = Number(s[ci]) || 0;
        const lc = Number(l[ci]) || 0;
        return lc >= sc ? [l[vi] ?? null, lc] : [s[vi] ?? null, sc];
    };
    const im = pick(1, 3);
    const bz = pick(2, 4);
    return [l[0], im[0], bz[0], im[1], bz[1]];
}

/** How much of the window has data, as words: "40% of 24h". */
export function coverageText(cov, windowKey) {
    const pct = Math.round((Number(cov) || 0) * 100);
    return pct + '% of ' + windowKey;
}
