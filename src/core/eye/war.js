/*
 * War mode (ENGINE-SPEC §12): an enemy faction's members, sorted by what
 * you can do now. Out early (left hospital before their time: revived or
 * medded) first, then Okay by band and respect, then Hospital by time out,
 * then Traveling, then Abroad; a summary line on top.
 */

import { BAND_ORDER, normBand } from './bands.js';

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
 * Within a band the one order of round 7 (the owner): most respect, then most HP kept, then the highest win.
 * @param {object} o - {bands: {id: band}, respect: {id: number}, keep: {id: 0..1}, win: {id: 0..1}, early: Set, nowS}
 * @returns {object[]} rows {m, id, state, band, respect, until}
 */
export function sortWar(members, { bands = {}, respect = {}, keep = {}, win = {}, early = new Set(), nowS = 0 } = {}) {
    const rows = (members || []).map((m) => {
        const id = Number(m.id);
        const state = early.has(id) ? 'early' : memberState(m);
        return { m, id, state, band: bands[id] || 'none', respect: respect[id] || 0, keep: keep[id] || 0, win: win[id] || 0, until: Number(m.status && m.status.until) || 0 };
    });
    rows.sort((a, b) => {
        const s = STATE_RANK[a.state] - STATE_RANK[b.state];
        if (s) return s;
        if (a.state === 'okay' || a.state === 'early') {
            const bd = BAND_ORDER.indexOf(a.band) - BAND_ORDER.indexOf(b.band);
            if (bd) return bd;
            return b.respect - a.respect || b.keep - a.keep || b.win - a.win;
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

/* ------------------------------------------------ round 4: war mode (ROUND4-PLAN §B) */

/**
 * The enemy from your own faction's current wars (/faction/wars: ranked,
 * raids, territory). Ranked first, then territory, then raids; wars that
 * ended are skipped.
 * @returns {{id, name, kind:'ranked'|'territory'|'raid', warId, start, end}[]}
 */
export function enemiesFromWars(resp, myFactionId, nowS = Math.floor(Date.now() / 1000)) {
    const w = (resp && (resp.wars || resp)) || {};
    const mine = Number(myFactionId) || 0;
    const out = [];
    const add = (war, kind) => {
        if (!war || typeof war !== 'object') return;
        if (war.end && Number(war.end) < nowS) return;
        if (war.winner) return;
        const facs = Array.isArray(war.factions) ? war.factions : [];
        // Your side is found by id; without one, a war is read only when it's two-sided.
        const other = facs.filter((f) => f && Number(f.id) && Number(f.id) !== mine);
        if (!mine && other.length !== 1) return;
        for (const f of other) {
            if (out.some((x) => x.id === Number(f.id))) continue;
            out.push({ id: Number(f.id), name: f.name ? String(f.name) : null, kind, warId: Number(war.war_id || war.id) || null, start: Number(war.start) || null, end: Number(war.end) || null });
        }
    };
    add(w.ranked, 'ranked');
    for (const t of Array.isArray(w.territory) ? w.territory : []) add(t, 'territory');
    for (const r of Array.isArray(w.raids) ? w.raids : []) add(r, 'raid');
    return out;
}

export const WAR_KIND_WORDS = { ranked: 'ranked war', territory: 'territory war', raid: 'raid' };

/** "5 min ago", "3 h ago", "2 d ago". */
export function agoText(ms, now = Date.now()) {
    const s = Math.max(0, Math.round((now - ms) / 1000));
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400 * 2) return Math.round(s / 3600) + ' h ago';
    return Math.round(s / 86400) + ' d ago';
}

/** Online / Idle / Offline from Torn's last_action, with "last active". */
export function activityOf(m, now = Date.now()) {
    const la = (m && m.last_action) || null;
    if (!la) return { kind: null, at: null, text: '—' };
    const s = String(la.status || '').toLowerCase();
    const kind = s === 'online' ? 'online' : s === 'idle' ? 'idle' : 'offline';
    const at = Number(la.timestamp) ? Number(la.timestamp) * 1000 : null;
    const text = kind === 'online' ? 'Online' : at ? (kind === 'idle' ? 'Idle · ' : '') + agoText(at, now) : la.relative || (kind === 'idle' ? 'Idle' : 'Offline');
    return { kind, at, text };
}

export const ACTIVITY_COLORS = { online: '#9bdc8a', idle: '#e8a33d', offline: '#6c737a' };
export const ACTIVITY_WORDS = { online: 'Online', idle: 'Idle', offline: 'Offline' };

/** Flights are kept this long after first seen (the longest standard flight is under 5 h). */
export const FLIGHT_KEEP_MS = 12 * 60 * 60 * 1000;
export const FLIGHTS_KEPT = 400;

/**
 * When each flight was first seen, kept across reloads: {id: {desc, at}}.
 * A new status line is a new flight; someone no longer flying is dropped.
 * @returns {{seen: object, changed: boolean}}
 */
export function trackFlights(seen, members, now = Date.now()) {
    const next = { ...(seen || {}) };
    let changed = false;
    for (const m of members || []) {
        const n = Number(m && m.id);
        if (!(n > 0)) continue;
        const id = String(n);
        const st = memberState(m);
        const desc = String((m.status && m.status.description) || '');
        if (st === 'traveling' || st === 'abroad') {
            if (!next[id] || next[id].desc !== desc) {
                next[id] = { desc, at: now };
                changed = true;
            }
        } else if (next[id]) {
            delete next[id];
            changed = true;
        }
    }
    for (const id of Object.keys(next)) {
        if (now - (next[id].at || 0) > FLIGHT_KEEP_MS) {
            delete next[id];
            changed = true;
        }
    }
    const left = Object.keys(next);
    if (left.length > FLIGHTS_KEPT) {
        left.sort((a, b) => next[a].at - next[b].at);
        for (const id of left.slice(0, left.length - FLIGHTS_KEPT)) delete next[id];
        changed = true;
    }
    return { seen: next, changed };
}

/**
 * The status cell, in parts so the page can keep the countdown ticking:
 * text = pre + clock(at) [+ " TCT" (m:ss) when cd] + post.
 * @param {object} m - faction member or profile {status, has_early_discharge, is_revivable}
 * @param {object} o - {now (ms), seenAt (ms, first seen flying), early (left hospital early)}
 * @returns {{kind, pre, at, cd, post, cls, soonAt}}
 */
export function statusParts(m, { now = Date.now(), seenAt = null, early = false } = {}) {
    const st = memberState(m);
    const s = (m && m.status) || {};
    const until = Number(s.until) > 0 ? Number(s.until) * 1000 : null;
    if (early) return { kind: 'early', pre: 'Out early · attack now', at: null, cd: false, post: '', cls: 'c-good', soonAt: null };
    if (st === 'okay') return { kind: 'okay', pre: 'Okay · attack now', at: null, cd: false, post: '', cls: 'c-good', soonAt: null };
    if (st === 'hospital') {
        const flags = [m && m.has_early_discharge ? 'may leave early' : null, m && m.is_revivable ? 'revivable' : null].filter(Boolean);
        return { kind: 'hospital', pre: until ? 'Hospital · out ' : 'Hospital', at: until, cd: true, post: flags.length ? ' · ' + flags.join(' · ') : '', cls: 'cdn', soonAt: until };
    }
    if (st === 'jail') {
        const fed = /federal/i.test(String(s.state || s.description || ''));
        return { kind: 'jail', pre: fed ? 'Federal jail' : until ? 'Jail · out ' : 'Jail', at: fed ? null : until, cd: true, post: '', cls: 'muted', soonAt: fed ? null : until };
    }
    if (st === 'traveling' || st === 'abroad') {
        const tr = travelOf(m);
        if (!tr) return { kind: st, pre: s.description || 'Traveling', at: null, cd: false, post: '', cls: null, soonAt: null };
        if (tr.kind === 'abroad') {
            const back = landingAt(tr, null, now);
            return { kind: 'abroad', pre: 'In ' + tr.place + (back ? ' · back ~' : ''), at: back, cd: false, post: back ? ' at the earliest (est.)' : '', cls: null, soonAt: null };
        }
        const land = landingAt(tr, seenAt, now);
        const pre = (tr.kind === 'back' ? '← from ' : '→ ') + tr.place + (land ? ', lands ~' : '');
        return { kind: 'traveling', pre, at: land, cd: false, post: land ? ' (est.)' : '', cls: null, soonAt: land };
    }
    if (st === 'fallen') return { kind: 'fallen', pre: 'Fallen', at: null, cd: false, post: '', cls: 'muted', soonAt: null };
    return { kind: st, pre: s.description || st, at: null, cd: false, post: '', cls: null, soonAt: null };
}

/* ------------------------------------------------ round 7: what war mode read, for Torn's own war page */

/** The table is small on purpose (Tampermonkey hands it to every Torn page): at most this many players. */
export const WAR_BANDS_MAX = 150;

/** A band older than this is not shown on Torn's page (stats move slowly; a day-old band is still a fair guide). */
export const WAR_BANDS_KEEP_MS = 24 * 60 * 60 * 1000;

/**
 * The bands the Torn Eye tab's war mode worked out, as a small table for shared storage: Torn's war page asks
 * nothing (the 1.3.0 rule), so it shows these. Players with no estimate are left out.
 * @param {object[]} rows - {id, band, win (0–100|null), keep (0–100|null)}
 * @returns {{at, fid, p: {[id]: [band, win, keep]}}}
 */
export function warBandTable(rows, { fid = null, now = Date.now() } = {}) {
    const p = {};
    let n = 0;
    for (const r of rows || []) {
        const band = r && BAND_ORDER.includes(r.band) ? r.band : null;
        if (!r || !(Number(r.id) > 0) || !band || band === 'none') continue;
        if (n++ >= WAR_BANDS_MAX) break;
        p[Number(r.id)] = [band, Number.isFinite(r.win) ? Math.round(r.win) : null, Number.isFinite(r.keep) ? Math.round(r.keep) : null];
    }
    return { at: now, fid: Number(fid) || null, p };
}

/** One player's band from that table, or null when it has none or the table is too old. */
export function warBandOf(table, id, now = Date.now()) {
    if (!table || !table.p || !(now - (Number(table.at) || 0) < WAR_BANDS_KEEP_MS)) return null;
    const e = table.p[Number(id)];
    // A table written by an older version (Tough, Can't win) reads as under 50% until war mode writes it again.
    const band = Array.isArray(e) ? normBand(e[0]) : 'none';
    if (band === 'none') return null;
    return { band, win: Number.isFinite(e[1]) ? e[1] : null, keep: Number.isFinite(e[2]) ? e[2] : null, at: Number(table.at) };
}

/** The status cell as one line: "Hospital · out 14:32 TCT (3:10)", "→ Mexico, lands ~15:05 (est.)". */
export function statusText(parts, { now = Date.now(), clockFn, tct = true, countdownFn } = {}) {
    if (!parts.at) return parts.pre + parts.post;
    const c = parts.cd ? (tct ? ' TCT' : '') + ' (' + countdownFn(parts.at - now) + ')' : '';
    return parts.pre + clockFn(parts.at) + c + parts.post;
}
