/*
 * Your trains from Torn's own log (owner, 2026-09-30: "how about tracking of
 * stats such as training on phone since laptop was closed"). The log has one
 * line per TRAIN click: the stat, trains, energy, the gym, happy used, and
 * the stat before and after. With the Full key (the log is Full only), the
 * leader tab reads what's new; Progress' "Last trains" shows the sessions no
 * read of ours saw. Pure. Research: docs/research-gym-log.md.
 *
 * Not a gain-model check: the log doesn't say the happy a click started at,
 * so these sessions have no "Plan said" (Your gains already count them, from
 * Torn's stats).
 */

import { STAT_API } from './gain.js';
import { gymById } from './gyms.js';
import { SESSION_GAP_MS } from './gains.js';

/** Torn's log types for a train, by stat [code: factionops probe; snippet: logtypes dumps]. */
export const GYM_LOG_TYPES = { 5300: 'str', 5301: 'def', 5302: 'spd', 5303: 'dex' };

/** Lines kept (one a TRAIN click, ~120 bytes each: a few months for a heavy trainer), and for how long. */
export const GYM_LOG_KEEP = 600;
export const GYM_LOG_DAYS = 120;

/** How often the leader reads it, and how far back the first read goes. */
export const GYM_LOG_EVERY_MS = 15 * 60 * 1000;
export const GYM_LOG_FIRST_DAYS = 7;

const logNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
};

/**
 * Torn's log lines (v2 `log` array) as trains: {id, at (ms), stat, trains,
 * energy, happy, gymId, before, after, gain}. Lines that aren't a train, or
 * carry no trains or energy, are left out. The stat comes from the log type,
 * or from the title ("Gym train defense") when the type is missing.
 * `before` is a string in the one real sample seen [snippet]: numbers are read with Number().
 */
export function parseGymLog(rows) {
    const out = [];
    for (const e of Array.isArray(rows) ? rows : []) {
        if (!e || !e.data) continue;
        const type = Number(e.details && e.details.id);
        const title = String((e.details && e.details.title) || '').toLowerCase();
        const stat = GYM_LOG_TYPES[type] || (/^gym train /.test(title) ? { strength: 'str', defense: 'def', defence: 'def', speed: 'spd', dexterity: 'dex' }[title.slice(10).trim()] : null);
        if (!stat) continue;
        const trains = logNum(e.data.trains);
        const energy = logNum(e.data.energy_used);
        const at = logNum(e.timestamp);
        if (!(trains > 0) || !(energy > 0) || !(at > 0)) continue;
        const name = STAT_API[stat];
        const before = logNum(e.data[name + '_before']);
        const after = logNum(e.data[name + '_after']);
        let gain = logNum(e.data[name + '_increased']);
        if (gain === null && before !== null && after !== null) gain = after - before;
        out.push({ id: String(e.id || at + ':' + type), at: at * 1000, stat, trains, energy, happy: logNum(e.data.happy_used), gymId: logNum(e.data.gym), before, after, gain });
    }
    return out;
}

/**
 * Add new lines to the kept ones: deduped by id (pages overlap at the edge), oldest first, the last GYM_LOG_DAYS
 * and GYM_LOG_KEEP. `gap` ({from, to} in unix seconds, or null): what a read couldn't reach yet (it stopped at its
 * page limit), read next; the newest line can be newer than the gap, so `newest` alone would skip it.
 */
export function mergeGymLog(kept, lines, now, gap = null) {
    const byId = new Map();
    for (const x of [...((kept && kept.lines) || []), ...(lines || [])]) if (x && x.id) byId.set(x.id, x);
    const since = now - GYM_LOG_DAYS * 86400e3;
    const all = [...byId.values()].filter((x) => x.at >= since).sort((a, b) => a.at - b.at);
    // A gap older than what's kept doesn't need filling.
    const g = gap && gap.to > gap.from && gap.to * 1000 > since ? { from: Math.max(gap.from, Math.floor(since / 1000)), to: gap.to } : null;
    return { lines: all.slice(-GYM_LOG_KEEP), at: now, newest: all.length ? all[all.length - 1].at : (kept && kept.newest) || null, gap: g };
}

/** Where the next read starts (unix seconds): after the newest line kept, or GYM_LOG_FIRST_DAYS back. */
export function gymLogFrom(kept, now) {
    const newest = kept && kept.newest;
    return Math.floor((newest ? newest : now - GYM_LOG_FIRST_DAYS * 86400e3) / 1000);
}

/**
 * The log's lines as sessions (clicks within SESSION_GAP_MS of each other),
 * like gains.js' sessionsOf: {at, end, trains:{stat: n}, gyms:[names], actual, energy, fromLog: true}. Newest first.
 */
export function logSessions(lines, table) {
    const list = (lines || []).filter((x) => x && x.at).slice().sort((a, b) => a.at - b.at);
    const out = [];
    for (const x of list) {
        let s = out[out.length - 1];
        if (!s || x.at - s.end > SESSION_GAP_MS) out.push((s = { at: x.at, end: x.at, trains: {}, gyms: [], actual: 0, gained: false, energy: 0, reads: 0, predicted: null, fromLog: true }));
        s.end = x.at;
        s.trains[x.stat] = (s.trains[x.stat] || 0) + x.trains;
        const g = x.gymId ? gymById(x.gymId, table) : null;
        const name = g ? g.name : x.gymId ? 'Gym ' + x.gymId : null;
        if (name && !s.gyms.includes(name)) s.gyms.push(name);
        // A gain Torn didn't give (a field name we haven't seen) is unknown, not zero: a session with none shows "—".
        if (x.gain !== null && x.gain !== undefined) {
            s.actual = (s.actual || 0) + x.gain;
            s.gained = true;
        }
        s.energy += x.energy;
        s.reads++;
    }
    for (const s of out) if (!s.gained) s.actual = null;
    return out.reverse();
}

/**
 * "Last trains": the sessions our reads saw (with the plan's prediction) and
 * the ones only Torn's log has (a phone, another device, the laptop closed).
 * A log session that overlaps a read session is the same session: the read's
 * one is kept. Newest first.
 */
export function mergeSessions(readSessions, logList) {
    const reads = readSessions || [];
    const overlaps = (l) => reads.some((r) => l.at <= r.end + SESSION_GAP_MS && l.end >= r.at - SESSION_GAP_MS);
    return [...reads, ...(logList || []).filter((l) => !overlaps(l))].sort((a, b) => b.at - a.at);
}
