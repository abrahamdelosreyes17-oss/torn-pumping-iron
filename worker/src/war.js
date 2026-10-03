/*
 * Wars, the watch list and chains, from the user's own key only (faction:
 * wars, members, chain; user: profile). The Worker never attacks: every
 * Attack button is a link.
 *
 *   /war    the whole enemy faction, page by page: who you can hit now,
 *           online or not, hospital out-at times, flights and their
 *           estimated landing; coloured by the bands the userscript synced
 *   /chain  your faction's chain and its timeout
 *   cron    wars are checked every 10 minutes (ranked, territory, raids);
 *           during one, the enemy faction is read once a minute (one call)
 *           and compared with the last read, kept in users.war. Pings go
 *           out ahead of time, only about enemies you can beat (Stomp, Good
 *           or Tough): out of hospital within a few minutes, landing in Torn
 *           within a few minutes, out early, came online. Each is a new
 *           message (edits don't notify); ones due the same minute share
 *           one. War pings have their own cap; Done stops them for the war.
 *           The watch list (players the userscript syncs) gets the same
 *           pings, reading at most 5 players a minute in turn.
 *           Chain pings (off unless switched on): 10+ hits, under 60 s left.
 */

import { Q } from './db.js';
import { factionWars, factionMembers, factionChain, playerProfile, TornError } from './torn.js';
import { PAGES, clock, rel, dur } from './format.js';
import { editAlertMessage, PER_MESSAGE } from './deliver.js';

export const WAR_CHECK_S = 10 * 60;
/** A last read older than this can't show a change (a muted or skipped minute): no "out early" or "came online" from it. */
export const WAR_FRESH_S = 3 * 60;
/** War messages one user can get in one minute (5 pings each). */
export const WAR_MESSAGES_PER_RUN = 2;
/** A change that couldn't go out this minute (cap, budget) waits this long. */
export const WAR_PENDING_S = 3 * 60;
export const MAX_PENDING = 20;
/** "Came online" at most once per player in this long. */
export const ONLINE_EVERY_S = 30 * 60;
export const MAX_WAR_MEMBERS = 100;
export const MAX_WATCH = 50;
/** Watched players read per minute at most, in turn; with 50, each at least every 10 minutes. */
export const EYE_PER_RUN = 5;
export const EYE_CYCLE = 5;
export const EYE_FRESH_S = 6 * 60;
export const CHAIN_MIN_HITS = 10;
export const CHAIN_WARN_S = 60;
export const CHAIN_MESSAGE_S = 10 * 60;

/*
 * Torn Eye's bands (round 7, copied from the userscript's src/core/eye/bands.js): by the HP kept over the fights won.
 * Stomp 99%+, Good 70–99%, Fair 50–69%; under 50% ('low') is never listed and never pinged.
 */
export const BAND_ORDER = ['stomp', 'good', 'fair', 'low', 'none'];
export const BAND_WORDS = { stomp: 'Stomp', good: 'Good', fair: 'Fair', low: 'Under 50%', none: 'No data' };
/** "Beatable" everywhere: half your HP kept or more; never under 50%, never no data. */
export const BEATABLE = new Set(['stomp', 'good', 'fair']);

/** A band as synced, older userscripts included (1.3.x sent Tough and Can't win: both read as under 50%). */
export function normBand(band) {
    if (BAND_ORDER.includes(band)) return band;
    if (band === 'tough' || band === 'cant') return 'low';
    return 'none';
}

/**
 * Standard-class flight times in minutes (copied from the userscript's
 * src/core/eye/war.js; an airstrip or business class is faster, so a
 * landing is always an estimate).
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

/* ---------- Finding the war ---------- */

/** The war the user's faction is in now (or about to be): ranked, territory, raids. */
export function findWar(data, factionId, nowS) {
    const w = (data && data.wars) || {};
    const list = [];
    if (w.ranked && typeof w.ranked === 'object') list.push({ ...w.ranked, kind: 'ranked' });
    for (const t of Array.isArray(w.territory) ? w.territory : []) list.push({ ...t, kind: 'territory' });
    for (const r of Array.isArray(w.raids) ? w.raids : []) list.push({ ...r, kind: 'raid' });
    for (const x of list) {
        if (!x || typeof x !== 'object') continue;
        const factions = Array.isArray(x.factions) ? x.factions : [x.aggressor, x.defender].filter(Boolean);
        if (!factions.some((f) => Number(f.id) === Number(factionId))) continue;
        const end = Number(x.end) || 0;
        if (end && end <= nowS) continue;
        const enemy = factions.find((f) => Number(f.id) !== Number(factionId));
        if (!enemy) continue;
        return { id: String(x.war_id || x.id || x.start), kind: x.kind, start: Number(x.start) || 0, end, enemy: Number(enemy.id), enemyName: String(enemy.name || 'the enemy') };
    }
    return null;
}

export function membersOf(data) {
    const m = data && data.members;
    const list = Array.isArray(m) ? m : m && typeof m === 'object' ? Object.entries(m).map(([id, v]) => ({ id: Number(id), ...v })) : [];
    return list.filter((x) => x && x.id);
}

/* ---------- One player now ---------- */

/** A member (faction members) or a profile (user/{id}/profile), in one plain shape. */
export function playerNow(x) {
    const st = (x && x.status) || {};
    const la = (x && (x.last_action || x.lastAction)) || {};
    const online = String(la.status || '').toLowerCase();
    return {
        id: Number(x.id || x.player_id) || 0,
        name: String(x.name || x.id || '?').slice(0, 40),
        level: Number(x.level) || 0,
        state: String(st.state || ''),
        until: Number(st.until) || 0,
        description: String(st.description || ''),
        online: ['online', 'idle', 'offline'].includes(online) ? online : '',
        lastSeen: Number(la.timestamp) || 0,
    };
}

/** Where a traveller is: "Traveling to Mexico", "Returning to Torn from Mexico", "In Mexico". */
export function travelOf(description) {
    const d = String(description || '');
    let m;
    const mins = (p) => FLIGHT_MIN[p.toLowerCase()] ?? null;
    if ((m = d.match(/returning to torn from (.+)$/i))) return { kind: 'back', place: m[1].trim(), minutes: mins(m[1].trim()) };
    if ((m = d.match(/travel(?:l)?ing to (.+)$/i))) return { kind: 'to', place: m[1].trim(), minutes: mins(m[1].trim()) };
    if ((m = d.match(/^in (.+)$/i))) return { kind: 'in', place: m[1].trim(), minutes: mins(m[1].trim()) };
    return null;
}

function travelKey(p) {
    if (p.state !== 'Traveling' && p.state !== 'Abroad') return '';
    const t = travelOf(p.description);
    return t ? t.kind + ':' + t.place : 'away';
}

/**
 * What we remember about one player: state, until, online status, travel,
 * and since when (f) this state was first seen; k = 1 when we saw it start
 * (so a landing estimate from f is close, not only "by then").
 */
export function snapEntry(p, prev, fresh, nowS) {
    const t = travelKey(p);
    const same = prev && prev.s === p.state && (prev.t || '') === t;
    return { s: p.state, u: p.until, o: p.online, t, f: same ? Number(prev.f) || nowS : nowS, k: same ? Number(prev.k) || 0 : prev && fresh ? 1 : 0 };
}

/** A flight back to Torn: when it lands (estimated from first seen + the flight time). */
export function landingOf(e) {
    if (!e || !String(e.t || '').startsWith('back:')) return null;
    const place = String(e.t).slice(5);
    const minutes = FLIGHT_MIN[place.toLowerCase()];
    if (!minutes) return null;
    return { at: Number(e.f) + minutes * 60, known: Boolean(Number(e.k)), place };
}

/**
 * What is coming or just changed for one player (pure).
 * @param {object|null} prev - the last snapshot entry
 * @param {object} cur - this read's entry (snapEntry)
 * @param {boolean} fresh - the last read is recent enough to compare
 * @returns {{event, bucket, at?, place?, known?, was?}[]}
 */
export function playerEvents(prev, cur, nowS, leadS, { early = true } = {}) {
    const out = [];
    if (cur.s === 'Hospital' && cur.u > nowS && cur.u - nowS <= leadS) out.push({ event: 'out', bucket: cur.u, at: cur.u });
    const land = landingOf(cur);
    if (land && land.at - nowS <= leadS && land.at > nowS - 60) out.push({ event: 'lands', bucket: cur.f, at: land.at, place: land.place, known: land.known });
    if (prev && prev.fresh) {
        if (early && prev.s === 'Hospital' && cur.s === 'Okay' && Number(prev.u) - nowS > 60) out.push({ event: 'early', bucket: Number(prev.u), was: Number(prev.u) });
        if (cur.s === 'Okay' && cur.o === 'online' && prev.o && prev.o !== 'online') out.push({ event: 'online', bucket: Math.floor(nowS / ONLINE_EVERY_S) });
    }
    return out;
}

const mins = (at, nowS) => Math.max(1, Math.ceil((at - nowS) / 60));

function estimateBits(est) {
    const b = est && normBand(est.band) !== 'none' ? '**' + BAND_WORDS[normBand(est.band)] + '**' : 'No estimate';
    const bits = [b];
    if (est && est.win !== null && est.win !== undefined && est.band !== 'none') bits.push('win ' + Math.round(est.win) + '%');
    return bits.join(' · ');
}

/**
 * One ping for one event. `prefix` is "war:<warId>" or "eye"; kind is
 * 'war' or 'watch'. The link is the Attack page (the user clicks).
 */
export function eventAlert(prefix, kind, ev, p, est, nowS, { vs = null, tag = null } = {}) {
    const name = p.name;
    let title;
    let text;
    if (ev.event === 'out') {
        title = name + ' out of hospital in ' + mins(ev.at, nowS) + ' min';
        text = 'Out ' + clock(ev.at) + ' TCT (' + rel(ev.at) + ')';
    } else if (ev.event === 'lands') {
        title = name + ' lands in Torn in ~' + mins(ev.at, nowS) + ' min';
        text = 'Returning to Torn from ' + ev.place + ', lands ' + (ev.known ? '~' : 'by ~') + clock(ev.at) + ' TCT (est.)';
    } else if (ev.event === 'early') {
        title = name + ' is out of hospital early';
        text = 'Was due out ' + clock(ev.was) + ' TCT. Out now';
    } else {
        title = name + ' came online';
        text = 'Okay and online now';
    }
    const tail = [estimateBits(est)];
    if (p.level) tail.push('Lv ' + p.level);
    if (tag) tail.push('watching: ' + tag);
    if (vs) tail.push('vs ' + vs);
    return {
        id: prefix + ':' + p.id + ':' + ev.event + ':' + ev.bucket,
        kind,
        event: ev.event,
        title,
        text: text + '\n' + tail.join(' · ') + '\nYou attack in Torn yourself.',
        link: PAGES.attack(p.id),
        attack: [{ id: p.id, name }],
        step: null,
    };
}

const EVENT_ORDER = ['start', 'out', 'lands', 'early', 'online'];
const TRANSITIONS = new Set(['start', 'early', 'online']);
const byPriority = (a, b) => EVENT_ORDER.indexOf(a.event) - EVENT_ORDER.indexOf(b.event) || (a.id < b.id ? -1 : 1);

/**
 * The band (and win %) for a player: the synced war list first (when it is
 * for this enemy), then Torn Eye's bands.
 */
export function estimator(warList, enemyId, bands) {
    const byId = new Map();
    // A war list stored before round 7's deploy still says Tough or Can't win: read as under 50% like any synced band.
    if (warList && Array.isArray(warList.members) && (!warList.factionId || !enemyId || Number(warList.factionId) === Number(enemyId))) for (const m of warList.members) if (m) byId.set(Number(m.id), { ...m, band: normBand(m.band) });
    return (id) => {
        const m = byId.get(Number(id)) || null;
        if (m && BEATABLE.has(m.band)) return m;
        if (m && m.band === 'low') return m;
        const b = bands && normBand(bands[id]);
        if (b && b !== 'none') return { ...(m || {}), band: b, win: m ? m.win : null };
        return m || { band: 'none', win: null, keep: null };
    };
}

/* ---------- /war: the whole faction, page by page ---------- */

const who = (p, est) => '**' + BAND_WORDS[normBand(est && est.band)] + '** · ' + p.name + (p.level ? ' · Lv ' + p.level : '') + (est && est.win !== null && est.win !== undefined && est.band !== 'none' ? ' · win ' + Math.round(est.win) + '%' : '');

function onlineBit(p, nowS) {
    if (p.online === 'online') return 'online';
    if (p.online === 'idle') return 'idle' + (p.lastSeen ? ' ' + dur(nowS - p.lastSeen) : '');
    if (p.online === 'offline') return 'offline' + (p.lastSeen ? ' ' + dur(nowS - p.lastSeen) : '');
    return '';
}

/** "← from Mexico, lands ~15:05 (est.)", "→ Mexico", "in Mexico". */
export function travelText(p, entry, nowS) {
    const t = travelOf(p.description);
    if (!t) return p.description || 'travelling';
    if (t.kind === 'to') return '→ ' + t.place;
    if (t.kind === 'in') return 'in ' + t.place;
    const land = landingOf(entry && String(entry.t || '').startsWith('back:') ? entry : { t: 'back:' + t.place, f: nowS, k: 0 });
    return '← from ' + t.place + (land ? ', lands ' + (land.known ? '~' : 'by ~') + clock(Math.max(land.at, nowS)) + ' (est.)' : '');
}

/** Split an enemy faction into groups, in the order /war shows them. */
export function warGroups(players, est, nowS) {
    const rank = (p) => BAND_ORDER.indexOf(normBand(est(p.id).band));
    const groups = { hit: [], hospital: [], away: [], jail: [], other: [], fallen: [] };
    for (const p of players) {
        if (p.state === 'Okay') groups.hit.push(p);
        else if (p.state === 'Hospital') groups.hospital.push(p);
        else if (p.state === 'Traveling' || p.state === 'Abroad') groups.away.push(p);
        else if (p.state === 'Jail' || p.state === 'Federal') groups.jail.push(p);
        else if (p.state === 'Fallen') groups.fallen.push(p);
        else groups.other.push(p);
    }
    const online = (p) => ['online', 'idle', 'offline', ''].indexOf(p.online);
    groups.hit.sort((a, b) => rank(a) - rank(b) || online(a) - online(b) || a.level - b.level);
    groups.hospital.sort((a, b) => a.until - b.until);
    groups.jail.sort((a, b) => a.until - b.until);
    groups.away.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
    return groups;
}

/** Discord's message limit is 2,000 characters: pages of at most this. */
export const PAGE_CHARS = 1800;

/**
 * /war as pages of text: a header on each, then every member of the enemy
 * faction with band, win %, online status, hospital out-at, flight and
 * landing. `snap` is the cron's last read of this faction (first-seen
 * times for landings), or null.
 */
export function warPages(war, players, est, snap, nowS) {
    const g = warGroups(players, est, nowS);
    const canHit = g.hit.filter((p) => BEATABLE.has(est(p.id).band)).length;
    const line = (p, extra) => [who(p, est(p.id)), extra, onlineBit(p, nowS)].filter(Boolean).join(' · ');
    const sections = [
        ['Hit now', g.hit, (p) => line(p, '')],
        ['In hospital', g.hospital, (p) => line(p, p.until > nowS ? 'out ' + clock(p.until) + ' (' + rel(p.until) + ')' : 'out any moment')],
        ['Travelling', g.away, (p) => line(p, travelText(p, snap && snap[p.id], nowS))],
        ['Jail', g.jail, (p) => line(p, p.until > nowS ? 'out ' + clock(p.until) + ' (' + rel(p.until) + ')' : p.description || 'jail')],
        ['Other', g.other, (p) => line(p, p.description || p.state || '')],
        ['Fallen', g.fallen, (p) => p.name],
    ];
    const lines = [];
    for (const [title, list, fmt] of sections) {
        if (!list.length) continue;
        lines.push({ head: true, text: '**' + title + '** (' + list.length + ')' });
        for (const p of list) lines.push({ text: fmt(p).slice(0, 300) });
    }
    if (!lines.length) lines.push({ text: 'Nobody in this faction.' });
    const pages = [];
    let cur = [];
    let size = 0;
    for (const l of lines) {
        const n = l.text.length + 1;
        if (cur.length && size + n > PAGE_CHARS - 200) {
            pages.push(cur);
            cur = [];
            size = 0;
        }
        cur.push(l);
        size += n;
    }
    if (cur.length) pages.push(cur);
    // A section title never ends a page alone.
    for (let i = 0; i < pages.length - 1; i++) {
        const last = pages[i][pages[i].length - 1];
        if (last.head) pages[i + 1].unshift(pages[i].pop());
    }
    const nextOut = g.hospital.filter((p) => p.until > nowS)[0];
    const head = '**War vs ' + war.enemyName + '**' + (war.start > nowS ? ' (starts ' + clock(war.start) + ' · ' + rel(war.start) + ')' : '') + '\n' + canHit + ' you can beat out now' + (nextOut ? ' · next out ' + clock(nextOut.until) : '') + ' · ' + g.away.length + ' away';
    return pages.map((p, i) => {
        const foot = pages.length > 1 ? '\nPage ' + (i + 1) + ' of ' + pages.length + (i + 1 < pages.length ? ' · `/war page:' + (i + 2) + '` for more' : '') : '';
        return (head + '\n\n' + p.map((l) => l.text).join('\n') + '\n\nBands from your last Pumping Iron sync. Times TCT. You attack in Torn yourself.' + foot).slice(0, 2000);
    });
}

export function chainText(c, nowS) {
    const cur = Number(c.current) || 0;
    const to = Number(c.timeout) || 0;
    const cd = Number(c.cooldown) || 0;
    if (cd > 0) return 'Chain on cooldown: ends ' + clock(nowS + cd) + ' (' + rel(nowS + cd) + ').';
    if (cur <= 0 || to <= 0) return 'No chain running.';
    return '**Chain ' + cur + '** / ' + (Number(c.max) || '?') + ' · times out in ' + dur(to) + ' (' + rel(nowS + to) + ')' + (c.modifier ? ' · bonus ×' + c.modifier : '');
}

/* ---------- cron ---------- */

/** Edit a live message (chain) when its text changed. */
async function refresh(env, f, db, user, existing, body) {
    const text = JSON.stringify(body);
    if ((existing.state || 'sent') !== 'sent' || !existing.message || existing.body === text) return 0;
    await db.prepare(Q.sentBody).bind(text, user.id, existing.alert).run();
    await editAlertMessage(env, f, db, user, [{ ...existing, body: text }]);
    return 1;
}

const left = (x) => (x && typeof x.left === 'function' ? x.left() : Infinity);

/** The "war started" ping: the beatable enemies out now (first read of a war). */
function startAlert(war, players, est) {
    const ready = players.filter((p) => p.state === 'Okay' && BEATABLE.has(est(p.id).band)).sort((a, b) => BAND_ORDER.indexOf(est(a.id).band) - BAND_ORDER.indexOf(est(b.id).band));
    if (!ready.length) return null;
    return {
        id: 'war:' + war.id + ':start',
        kind: 'war',
        event: 'start',
        title: 'War vs ' + war.enemyName + ': ' + ready.length + ' you can beat ' + (ready.length === 1 ? 'is' : 'are') + ' out now',
        text: ready.slice(0, 8).map((p) => who(p, est(p.id)) + (p.online === 'online' ? ' · online' : '')).join('\n') + '\nYou attack in Torn yourself. `/war` shows everyone.',
        link: PAGES.faction(war.enemy),
        attack: ready.slice(0, 4).map((p) => ({ id: p.id, name: p.name })),
        step: null,
    };
}

/**
 * One minute of war for one user: find the war (every 10 minutes), read
 * the enemy (one call), compare with the last read, and send what's new
 * about enemies you can beat. `mayStart()` says whether one more war
 * message fits (war cap, quiet hours); `send(alerts)` sends one message.
 * @returns {Promise<object>} the war state to keep in users.war
 */
export async function warTick({ env, f, db, user, key, nowS, rows, war, warList, bands, leadS, mayStart, send }) {
    if (!war || nowS - (Number(war.checked) || 0) >= WAR_CHECK_S) {
        const found = findWar(await factionWars(f, key), user.faction_id, nowS);
        // The same war: its memory (last read, Done, waiting pings) carries on.
        const keep = found && war && war.id === found.id ? { snap: war.snap, snapAt: war.snapAt, done: war.done, pending: war.pending } : {};
        war = { checked: nowS, ...(found || {}), ...keep };
    }
    if (!war.enemy || war.start > nowS || (war.end && war.end <= nowS)) return war;
    // Done on any of this war's pings: no more war pings (and no more reads) for this war.
    if (!war.done && rows.some((r) => String(r.alert).startsWith('war:' + war.id + ':') && r.state === 'done')) war.done = nowS;
    if (war.done) return war;

    const players = membersOf(await factionMembers(f, key, war.enemy)).map(playerNow).filter((p) => p.id);
    const est = estimator(warList, war.enemy, bands);
    const prevSnap = war.snap && typeof war.snap === 'object' ? war.snap : null;
    const fresh = Boolean(prevSnap) && nowS - (Number(war.snapAt) || 0) <= WAR_FRESH_S;
    const snap = {};
    const events = [];
    for (const p of players) {
        const prev = prevSnap && prevSnap[p.id];
        snap[p.id] = snapEntry(p, prev, fresh, nowS);
        if (!BEATABLE.has(est(p.id).band)) continue;
        for (const ev of playerEvents(prev ? { ...prev, fresh } : null, snap[p.id], nowS, leadS)) events.push(eventAlert('war:' + war.id, 'war', ev, p, est(p.id), nowS, { vs: war.enemyName }));
    }
    if (!prevSnap) {
        const s = startAlert(war, players, est);
        if (s) events.push(s);
    }
    war.snap = snap;
    war.snapAt = nowS;

    // Changes that couldn't go out last minute wait a little; the rest come from the read itself.
    const sentIds = new Set(rows.map((r) => r.alert));
    const waiting = (Array.isArray(war.pending) ? war.pending : []).filter((a) => nowS - Number(a.seen) <= WAR_PENDING_S && !events.some((e) => e.id === a.id));
    let due = [...events.map((a) => ({ ...a, seen: nowS })), ...waiting].filter((a) => !sentIds.has(a.id)).sort(byPriority);
    const done = new Set();
    for (let m = 0; m < WAR_MESSAGES_PER_RUN && due.length; m++) {
        const group = due.slice(0, PER_MESSAGE);
        // Room for the message (a DM channel, the post) and its rows, with a little spare for the rest of the minute.
        if (!mayStart() || left(f) < 4 || left(db) < group.length + 5) break;
        const ids = await send(group.map(({ seen, ...a }) => a));
        for (const id of ids) done.add(id);
        if (!ids.length) break;
        due = due.slice(PER_MESSAGE);
    }
    war.pending = due.filter((a) => TRANSITIONS.has(a.event) && !done.has(a.id)).slice(0, MAX_PENDING);
    if (!war.pending.length) delete war.pending;
    return war;
}

/* ---------- The watch list ---------- */

/** The watched players this minute: in turn, at most 5, each at least every 5 minutes. */
export function eyeTurn(list, cursor) {
    const n = list.length;
    if (!n) return { ids: [], cursor: 0 };
    const k = Math.min(EYE_PER_RUN, Math.ceil(n / EYE_CYCLE));
    const start = (Number(cursor) || 0) % n;
    const ids = [];
    for (let i = 0; i < k; i++) ids.push(list[(start + i) % n].id);
    return { ids, cursor: (start + k) % n };
}

/**
 * One minute of the watch list: read a few watched players (in turn), and
 * return the pings due for any of them (hospital out soon and landing soon
 * from what was last read; came online from this read). Only players you
 * can beat, or with no estimate ("No estimate" in the ping).
 * @returns {Promise<{alerts: object[], state: object}>}
 */
export async function eyeTick({ f, key, nowS, list, state, bands, leadS }) {
    const old = state && typeof state === 'object' ? state : {};
    const snap = {};
    for (const x of list) if (old.snap && old.snap[x.id]) snap[x.id] = old.snap[x.id];
    // After a Torn error (a key that can't read profiles), try again in 10 minutes.
    const resting = old.errorAt && nowS - Number(old.errorAt) < WAR_CHECK_S;
    const turn = resting ? { ids: [], cursor: old.cursor || 0 } : eyeTurn(list, old.cursor);
    const changed = {};
    let error = resting ? { code: old.error, at: old.errorAt } : null;
    for (const id of turn.ids) {
        let d;
        try {
            d = await playerProfile(f, key, id);
        } catch (e) {
            if (!(e instanceof TornError) || e.dead) throw e;
            // A key without user: profile (16), a player Torn doesn't know (6): the rest wait.
            error = { code: e.code, at: nowS };
            break;
        }
        const p = playerNow({ id, ...((d && (d.profile || d)) || {}) });
        const prev = snap[id] || null;
        const fresh = Boolean(prev) && nowS - (Number(prev.a) || 0) <= EYE_FRESH_S;
        snap[id] = { ...snapEntry(p, prev, fresh, nowS), a: nowS, n: p.name };
        changed[id] = prev ? { ...prev, fresh } : null;
    }
    const alerts = [];
    for (const x of list) {
        const cur = snap[x.id];
        if (!cur) continue;
        const band = normBand(x.band && x.band !== 'none' ? x.band : bands && bands[x.id]);
        // Under 50% HP kept: never pinged (the owner, round 7).
        if (band === 'low') continue;
        const est = { band, win: band === x.band ? x.win : null };
        const p = { id: x.id, name: x.name || cur.n || String(x.id), level: x.level || 0 };
        const evs = playerEvents(Object.prototype.hasOwnProperty.call(changed, x.id) ? changed[x.id] : null, cur, nowS, leadS, { early: false });
        for (const ev of evs) alerts.push(eventAlert('eye', 'watch', ev, p, est, nowS, { tag: x.tag || null }));
    }
    return { alerts, state: { cursor: turn.cursor, snap, ...(error ? { error: error.code, errorAt: error.at } : {}) } };
}

export async function chainTick({ env, f, db, user, key, nowS, rows, mayStart, send }) {
    const c = ((await factionChain(f, key)) || {}).chain || {};
    const cur = Number(c.current) || 0;
    const to = Number(c.timeout) || 0;
    if (cur < CHAIN_MIN_HITS || to <= 0 || to > CHAIN_WARN_S) return;
    const body = { kind: 'chain', title: 'Chain ' + cur + ': under a minute left', text: 'Times out ' + rel(nowS + to) + ' (' + clock(nowS + to) + ' TCT). A hit keeps it going. You attack in Torn yourself.', link: PAGES.myFaction, step: null };
    const id = 'chain:' + (c.start || c.id || 0) + ':' + Math.floor(nowS / CHAIN_MESSAGE_S);
    const existing = rows.find((r) => r.alert === id);
    if (existing) return refresh(env, f, db, user, existing, body);
    if (mayStart()) await send([{ id, ...body }]);
}
