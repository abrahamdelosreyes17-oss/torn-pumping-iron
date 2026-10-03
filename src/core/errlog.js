/*
 * The problem log (round 7; the pattern is Torn Trading's core/errlog.js).
 * Every tab adds what went wrong (a script error, a read that failed, a
 * plan that couldn't be worked out) and what you did just before (Create
 * plan, Recalibrate, a plan picked), plus how long each plan took. Kept 7 days,
 * LOG_MAX lines at most. Settings › Report a problem puts it in the zip, so
 * a bug is found from what happened, not by guessing. No key (masked before
 * it is stored), no player id or name. Pure.
 */

export const LOG_MAX = 400;
export const LOG_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/** Lines a Torn page keeps in the shared store until the webpage takes them (it is handed to every page: kept small). */
export const LOG_BUFFER_MAX = 40;

/** The stored log plus new entries: oldest first, a week at most, `max` lines at most. */
export function addLogEntries(stored, entries, now = Date.now(), max = LOG_MAX) {
    const all = [...(Array.isArray(stored) ? stored : []), ...(entries || [])]
        .filter((e) => e && Number.isFinite(Number(e.at)) && now - Number(e.at) < LOG_KEEP_MS)
        .sort((a, b) => a.at - b.at);
    // The same line twice in a row within a minute is counted, not repeated.
    const out = [];
    for (const e of all) {
        const last = out[out.length - 1];
        if (last && last.kind === e.kind && last.where === e.where && last.what === e.what && e.at - (last.lastAt || last.at) < 60000) {
            last.times = (last.times || 1) + (e.times || 1);
            last.lastAt = e.lastAt || e.at;
        } else {
            out.push({ ...e });
        }
    }
    return out.slice(-max);
}

/** A line of text, never a key: anything key-like is masked (16 letters and digits), and a link's query is dropped. */
export function logText(text, max = 300) {
    return String(text === null || text === undefined ? '' : text)
        .replace(/key=[^&\s"']+/gi, 'key=****')
        .replace(/\b[A-Za-z0-9]{16}\b/g, '****')
        .replace(/\b(XID|ID|user2ID|userID)=\d+/gi, '$1=N')
        .slice(0, max);
}

/** The log as plain text, one line each, in Torn time (UTC), for the report. */
export function logAsText(list) {
    const t = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
    return (list || []).map((e) => t(e.at) + '  ' + (e.kind === 'error' ? 'ERROR ' : e.kind === 'action' ? 'did   ' : 'note  ') + '[' + (e.where || '?') + '] ' + e.what + (e.detail ? ' - ' + e.detail : '') + (e.times > 1 ? ' (x' + e.times + ', last ' + t(e.lastAt) + ')' : '')).join('\n') + '\n';
}
