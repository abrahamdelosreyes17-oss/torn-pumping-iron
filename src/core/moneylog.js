/*
 * The money log kept between reads (session 11). A read walks each of
 * Torn's categories back at most a few pages of 100 lines; a busy log (a
 * trader: 470 lines a day) fills them in two days, and every read used to
 * start over, so the books covered 2 days, never 30. Now a read asks only
 * for what is newer than the last one and is joined to the lines kept: the
 * days the books cover grow with every read, up to 30. Pure.
 *
 * Session 12 (a trader's log: 700 outgoing lines a day): the read that
 * builds on the lines kept walks back as far as a week of such a log, and
 * 30 days of it fit in the lines kept (src/income.js).
 */

import { DAY } from './bars.js';
import { logFieldsOf, logFieldsList } from './report.js';

/** A read starts this long before the last one ended: lines Torn files a little late are not missed (each line counts once, by its id). */
export const MONEY_LOG_OVERLAP_MS = 10 * 60 * 1000;

/** The lines kept from the last read, when they can be built on. */
export function moneyLogKept(prev, v) {
    return prev && prev.v === v && Array.isArray(prev.lines) && prev.lines.length && Number.isFinite(prev.from) && Number.isFinite(prev.at) ? prev : null;
}

/** From when the next read asks (ms): just before the last read, or the start of the span when nothing is kept. */
export function moneyLogAskFrom(kept, since) {
    return kept ? Math.max(since, kept.at - MONEY_LOG_OVERLAP_MS) : since;
}

/**
 * The stored row after a read.
 * @param {object|null} kept - moneyLogKept(): {from, at, lines, fields}
 * @param {object[]} read - fetchMoneyLog()'s lines, with `coveredFrom` (ms: complete from there) and `fields`
 * @param {object} o
 * @param {number} o.now - ms
 * @param {number} o.since - ms: the oldest moment the books may reach (30 days back)
 * @param {number} o.maxLines - lines kept at most (the newest; the books then start at the oldest one kept)
 * @returns {{at, from, days, lines, fields, joined}} `joined`: the read reached back to the lines kept
 */
export function mergeMoneyLog(kept, read, { now, since, maxLines = Infinity }) {
    const covered = Number.isFinite(read.coveredFrom) ? read.coveredFrom : since;
    // The read is complete back to the moment of the last one: nothing is missing in between.
    const joined = Boolean(kept) && covered <= kept.at;
    let from = Math.max(since, joined ? kept.from : covered);
    const seen = new Set();
    let lines = [];
    for (const l of joined ? [...read, ...kept.lines] : read) {
        if (!l || seen.has(l.id) || !(l.at >= from)) continue;
        seen.add(l.id);
        lines.push(l);
    }
    lines.sort((a, b) => b.at - a.at);
    if (lines.length > maxLines) {
        // Only the newest are kept: the books start after the second the cut falls in (that second may be cut in two).
        from = Math.floor(lines[maxLines].at / 1000) * 1000 + 1000;
        lines = lines.filter((l) => l.at >= from);
    }
    // The field names by type, over every line kept (Torn's category comes from the reads: a kept line does not carry it).
    const cat = new Map([...((kept && kept.fields) || []), ...(read.fields || [])].map((f) => [Number(f.type), f.category]));
    const fields = logFieldsList(logFieldsOf(lines.map((l) => ({ id: l.id, timestamp: l.at / 1000, details: { id: l.type, title: l.title, category: cat.get(Number(l.type)) || '' }, data: l.data }))));
    return { at: now, from, days: Math.max(1, (now - from) / DAY), lines, fields, joined };
}
