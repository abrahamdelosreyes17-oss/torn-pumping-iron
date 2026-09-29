/*
 * Torn Eye's watch list (ROUND4-PLAN §I, the owner's idea). Up to 20
 * players you want to keep an eye on, each with an optional short reason
 * (hospitalize, mug, revenge, bounty or your own words). Their status is
 * read every 60 s while the Watched view or a Torn tab is open; someone
 * in hospital for a long while, or on a long flight, every 5 min. A
 * heads-up shows in the app when a watched player is out of hospital or
 * lands within 3 minutes, or comes online. People who attacked or mugged
 * you in the last hour are offered, never added by themselves. A player
 * stays until you remove them.
 */

import { memberState, travelOf, landingAt } from './war.js';

export const WATCH_MAX = 20;
export const WATCH_TAGS = ['hospitalize', 'mug', 'revenge', 'bounty'];
export const TAG_MAX = 24;
export const WATCH_POLL_MS = 60 * 1000;
export const WATCH_SLOW_MS = 5 * 60 * 1000;
/** Someone out of hospital (or landing) further away than this is read on the slow clock. */
export const WATCH_FAR_MS = 10 * 60 * 1000;
export const HEADS_UP_MS = 3 * 60 * 1000;
/** A "came online" heads-up shows this long. */
export const EVENT_KEEP_MS = 10 * 60 * 1000;
export const OFFER_WINDOW_MS = 60 * 60 * 1000;
export const OFFERS_SHOWN = 5;

export function emptyWatch() {
    return { list: [], dismissed: {} };
}

export function watchOf(stored) {
    const s = stored && typeof stored === 'object' ? stored : {};
    return { list: Array.isArray(s.list) ? s.list.filter((x) => x && Number(x.id) > 0) : [], dismissed: s.dismissed && typeof s.dismissed === 'object' ? s.dismissed : {} };
}

/** A reason tag: trimmed, one line, 24 characters at most; empty = none. */
export function normTag(tag) {
    const t = String(tag === null || tag === undefined ? '' : tag)
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, TAG_MAX);
    return t || null;
}

export function isWatched(state, id) {
    return watchOf(state).list.some((x) => Number(x.id) === Number(id));
}

/**
 * Add a player (or refresh their name and level if already there).
 * @returns {{state, ok:boolean, reason?:'full'|'bad'}}
 */
export function addWatch(state, player, now = Date.now()) {
    const s = watchOf(state);
    const id = Number(player && player.id);
    if (!(id > 0)) return { state: s, ok: false, reason: 'bad' };
    const i = s.list.findIndex((x) => Number(x.id) === id);
    if (i >= 0) {
        const cur = s.list[i];
        const list = s.list.slice();
        list[i] = { ...cur, name: player.name || cur.name || null, level: player.level || cur.level || null, ...(player.tag !== undefined ? { tag: normTag(player.tag) } : {}) };
        return { state: { ...s, list }, ok: true };
    }
    if (s.list.length >= WATCH_MAX) return { state: s, ok: false, reason: 'full' };
    const dismissed = { ...s.dismissed };
    delete dismissed[id];
    return { state: { list: [...s.list, { id, name: player.name || null, level: player.level || null, tag: normTag(player.tag), addedAt: now }], dismissed }, ok: true };
}

export function removeWatch(state, id) {
    const s = watchOf(state);
    return { ...s, list: s.list.filter((x) => Number(x.id) !== Number(id)) };
}

export function tagWatch(state, id, tag) {
    const s = watchOf(state);
    return { ...s, list: s.list.map((x) => (Number(x.id) === Number(id) ? { ...x, tag: normTag(tag) } : x)) };
}

/** "Not now" on an offer: that attack isn't offered again (a newer one is). */
export function dismissOffer(state, id, now = Date.now()) {
    const s = watchOf(state);
    const dismissed = { ...s.dismissed, [Number(id)]: now };
    // Old dismissals go (a day is plenty: offers look back one hour).
    for (const k of Object.keys(dismissed)) if (now - dismissed[k] > 86400000) delete dismissed[k];
    return { ...s, dismissed };
}

/**
 * Is this watched player's status due a read? Every 60 s; every 5 min
 * when their hospital or jail time or their landing is more than 10 min off.
 * @param {object|null} rec - last read {status, readAt}
 */
export function dueForRead(rec, now = Date.now(), seenAt = null) {
    if (!rec || !rec.readAt) return true;
    const age = now - rec.readAt;
    if (age >= WATCH_SLOW_MS) return true;
    if (age < WATCH_POLL_MS) return false;
    const st = memberState(rec);
    const until = Number(rec.status && rec.status.until) * 1000 || 0;
    if ((st === 'hospital' || st === 'jail') && until - now > WATCH_FAR_MS) return false;
    if (st === 'traveling') {
        const land = landingAt(travelOf(rec), seenAt, now);
        if (land && land - now > WATCH_FAR_MS) return false;
    }
    return true;
}

/** What changed between two reads that's worth a heads-up later: came online, left hospital. */
export function readEvents(prev, rec, now = Date.now()) {
    const out = [];
    if (!prev || !rec) return out;
    const was = String((prev.last_action && prev.last_action.status) || '').toLowerCase();
    const is = String((rec.last_action && rec.last_action.status) || '').toLowerCase();
    if (is === 'online' && was && was !== 'online') out.push({ kind: 'online', at: now });
    if (memberState(prev) === 'hospital' && memberState(rec) === 'okay') out.push({ kind: 'out', at: now });
    return out;
}

/**
 * The heads-ups for the watch list, now: out of hospital within 3 min,
 * landing within 3 min (estimate), came online or left hospital lately.
 * @param {object[]} list - watch entries
 * @param {object} states - {id: {status, last_action, readAt, events:[{kind, at}]}}
 * @param {object} flights - {id: {desc, at}} first seen flying
 * @returns {{id, name, kind, at, text}[]} soonest first
 */
export function headsUps(list, states, flights, now = Date.now()) {
    const out = [];
    for (const w of list || []) {
        const rec = (states || {})[w.id];
        if (!rec) continue;
        const name = w.name || rec.name || 'Player ' + w.id;
        const st = memberState(rec);
        const until = Number(rec.status && rec.status.until) * 1000 || 0;
        if (st === 'hospital' && until > now && until - now <= HEADS_UP_MS) out.push({ id: w.id, name, kind: 'hospital', at: until, text: name + ' is out of hospital in ' + mmss(until - now) });
        if (st === 'traveling') {
            const tr = travelOf(rec);
            const land = landingAt(tr, flights && flights[w.id] ? flights[w.id].at : null, now);
            // Only when we saw them leave: a landing counted from "now" would always look far off.
            if (land && flights && flights[w.id] && land > now && land - now <= HEADS_UP_MS) out.push({ id: w.id, name, kind: 'lands', at: land, text: name + ' lands' + (tr.kind === 'back' ? ' in Torn' : ' in ' + tr.place) + ' in about ' + mmss(land - now) });
        }
        for (const e of rec.events || []) {
            if (now - e.at > EVENT_KEEP_MS) continue;
            if (e.kind === 'online') out.push({ id: w.id, name, kind: 'online', at: e.at, text: name + ' came online' });
            if (e.kind === 'out' && st === 'okay') out.push({ id: w.id, name, kind: 'out', at: e.at, text: name + ' is out of hospital' });
        }
    }
    return out.sort((a, b) => a.at - b.at);
}

function mmss(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

/**
 * "Watch?" offers: players who attacked or mugged you in the last hour,
 * not watched, not dismissed since. Newest first, one per player.
 * @param {object[]} incoming - [{att, name, level, ended (s), result}]
 */
export function watchOffers(incoming, state, now = Date.now()) {
    const s = watchOf(state);
    const watched = new Set(s.list.map((x) => Number(x.id)));
    const seen = new Set();
    const out = [];
    for (const a of [...(incoming || [])].sort((x, y) => (y.ended || 0) - (x.ended || 0))) {
        const id = Number(a && a.att);
        if (!(id > 0) || seen.has(id) || watched.has(id)) continue;
        const at = (Number(a.ended) || 0) * 1000;
        if (now - at > OFFER_WINDOW_MS) continue;
        if (s.dismissed[id] && s.dismissed[id] >= at) continue;
        seen.add(id);
        out.push({ id, name: a.name || null, level: a.level || null, at, mugged: /mug/i.test(String(a.result || '')), result: a.result || null });
    }
    return out.slice(0, OFFERS_SHOWN);
}
