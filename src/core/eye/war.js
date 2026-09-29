/*
 * War mode (ENGINE-SPEC §12): an enemy faction's members, sorted by what
 * you can do now. Out early (left hospital before their time: revived or
 * medded) first, then Okay by band and respect, then Hospital by time out,
 * then Traveling, then Abroad; a summary line on top.
 */

import { BAND_ORDER } from './bands.js';

export function memberState(m) {
    const st = (m && m.status) || {};
    const s = String(st.state || st.description || '').toLowerCase();
    if (s.includes('hospital')) return 'hospital';
    if (s.includes('travel')) return 'traveling';
    if (s.includes('abroad')) return 'abroad';
    if (s.includes('jail') || s.includes('federal')) return 'jail';
    if (s.includes('fallen')) return 'fallen';
    return 'okay';
}

/**
 * Members that left hospital early: Hospital with a future `until` before,
 * Okay now, before that time.
 * @returns {Set<number>}
 */
export function outEarly(prevMembers, members, nowS) {
    const prev = new Map((prevMembers || []).map((m) => [Number(m.id), m]));
    const out = new Set();
    for (const m of members || []) {
        const p = prev.get(Number(m.id));
        if (!p || memberState(p) !== 'hospital' || memberState(m) !== 'okay') continue;
        const until = Number(p.status && p.status.until) || 0;
        if (until > nowS + 30) out.add(Number(m.id));
    }
    return out;
}

const STATE_RANK = { early: 0, okay: 1, hospital: 2, traveling: 3, abroad: 4, jail: 5, fallen: 6 };

/**
 * @param {object[]} members - /faction/{id}/members rows
 * @param {object} o - {bands: {id: band}, respect: {id: number}, early: Set, nowS}
 * @returns {object[]} rows {m, id, state, band, respect, until}
 */
export function sortWar(members, { bands = {}, respect = {}, early = new Set(), nowS = 0 } = {}) {
    const rows = (members || []).map((m) => {
        const id = Number(m.id);
        const state = early.has(id) ? 'early' : memberState(m);
        return { m, id, state, band: bands[id] || 'none', respect: respect[id] || 0, until: Number(m.status && m.status.until) || 0 };
    });
    rows.sort((a, b) => {
        const s = STATE_RANK[a.state] - STATE_RANK[b.state];
        if (s) return s;
        if (a.state === 'okay' || a.state === 'early') {
            const bd = BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band);
            if (bd) return bd;
            return b.respect - a.respect;
        }
        if (a.state === 'hospital' || a.state === 'traveling') return (a.until || Infinity) - (b.until || Infinity);
        return a.id - b.id;
    });
    return rows;
}

/** "7 attackable now · 0:48 until the next one is out · 3 traveling" as numbers. */
export function warSummary(rows, nowS) {
    const attackable = rows.filter((r) => r.state === 'okay' || r.state === 'early').length;
    const outs = rows.filter((r) => r.state === 'hospital' && r.until > nowS).map((r) => r.until - nowS);
    return { attackable, nextOutS: outs.length ? Math.min(...outs) : null, traveling: rows.filter((r) => r.state === 'traveling').length, early: rows.filter((r) => r.state === 'early').length };
}

/**
 * Standard-class flight times in minutes (Torn's travel agency; an airstrip
 * or business class is faster, so landings are marked as estimates).
 */
export const FLIGHT_MIN = {
    mexico: 26,
    'cayman islands': 35,
    canada: 41,
    hawaii: 134,
    'united kingdom': 159,
    argentina: 167,
    switzerland: 175,
    japan: 225,
    china: 242,
    uae: 271,
    'united arab emirates': 271,
    'south africa': 297,
};

/**
 * Where a traveller is going, from the status line: "Traveling to Mexico",
 * "Returning to Torn from Mexico", "In Mexico".
 * @returns {{kind:'to'|'back'|'abroad', place:string, minutes:number|null}|null}
 */
export function travelOf(member) {
    const d = String((member && member.status && member.status.description) || '');
    let m;
    const mins = (p) => FLIGHT_MIN[p.toLowerCase()] ?? null;
    if ((m = d.match(/returning to torn from (.+)$/i))) return { kind: 'back', place: m[1].trim(), minutes: mins(m[1].trim()) };
    if ((m = d.match(/travel(?:l)?ing to (.+)$/i))) return { kind: 'to', place: m[1].trim(), minutes: mins(m[1].trim()) };
    if ((m = d.match(/^in (.+)$/i))) return { kind: 'abroad', place: m[1].trim(), minutes: mins(m[1].trim()) };
    return null;
}

/**
 * When a traveller lands (ms): from when we first saw this flight plus the
 * flight time; abroad: "if they fly now". null when unknown.
 */
export function landingAt(travel, seenAt, now) {
    if (!travel || !travel.minutes) return null;
    if (travel.kind === 'abroad') return now + travel.minutes * 60000;
    return Math.max(now, (seenAt || now) + travel.minutes * 60000);
}
