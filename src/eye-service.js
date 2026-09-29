/*
 * Torn Eye's data: for each player shown, the best estimate we can get
 * (spy → your fights → FFScouter → public stats), a fight forecast against
 * you, a band, respect and the chip's words. Requests only from a visible
 * tab, inside each service's own budget; answers are cached (FFScouter 5
 * min in memory and 1 h stored, as its guidance asks).
 */

import { K, get, set, getKey, getSettings } from './platform/store.js';
import { idbGet, idbSet } from './platform/idb.js';
import { pi, tornClient, isVisible } from './runtime.js';
import { fetchProfile, fetchPersonalStats, fetchAttacks, fetchEquipment } from './api/torn.js';
import { makeFfsClient, fetchFfsStats, FFS_MEMORY_MS, FFS_STORED_MS } from './api/ffscouter.js';
import { makeTsClient, fetchSpyUser } from './api/tornstats.js';
import { estimatePlayer } from './core/eye/estimate.js';
import { forecast, respectFor, fairFight, bssOf, DEFAULT_GEAR } from './core/eye/fight.js';
import { bandOf, chipFigures } from './core/eye/bands.js';
import { gearSummary, myGear } from './core/eye/gear.js';

export const PROFILE_FRESH_MS = 10 * 60 * 1000;
export const PUBLIC_FRESH_MS = 24 * 60 * 60 * 1000;
export const SPY_FRESH_MS = 60 * 60 * 1000;
export const ATTACKS_FRESH_MS = 60 * 60 * 1000;
export const EQUIPMENT_FRESH_MS = 6 * 60 * 60 * 1000;

/** [calibrate] Max life from level when no profile was read: Torn's base plus typical merits and perks. */
export function lifeFromLevel(level) {
    return Math.round((100 + 50 * Math.max(0, (Number(level) || 1) - 1)) * 1.25);
}

const eye = { cache: null, loading: null, ffs: null, ts: null, pending: new Set(), timer: null, listeners: [], mem: new Map() };

function clients() {
    if (!eye.ffs) eye.ffs = makeFfsClient({ getKey: () => getKey(K.ffsKey), isVisible, loadShared: () => get('ffsWindow', {}), saveShared: (s) => set('ffsWindow', s) });
    if (!eye.ts) eye.ts = makeTsClient({ getKey: () => getKey(K.tsKey), isVisible, loadShared: () => get('tsWindow', {}), saveShared: (s) => set('tsWindow', s) });
    return eye;
}

/** The stored per-player cache (IndexedDB; memory if refused). */
async function cache() {
    if (eye.cache) return eye.cache;
    if (!eye.loading) {
        // torn.com and the webpage keep separate IndexedDBs; a Clear on either reaches both through this mark.
        const clearedAt = Number(get('eyeClearAt', 0)) || 0;
        eye.loading = idbGet('eye')
            .then((v) => (eye.cache = v && v.players && !((v.savedAt || 0) < clearedAt) ? v : { players: {}, gear: {} }))
            .catch(() => (eye.cache = { players: {}, gear: {} }));
    }
    return eye.loading;
}

let saveTimer = null;
function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        const c = eye.cache;
        if (!c) return;
        // Keep the newest 3,000 players.
        const ids = Object.keys(c.players);
        if (ids.length > 3000) {
            ids.sort((a, b) => (c.players[a].seen || 0) - (c.players[b].seen || 0));
            for (const id of ids.slice(0, ids.length - 3000)) delete c.players[id];
        }
        c.savedAt = Date.now();
        idbSet('eye', c).catch(() => {});
    }, 1500);
}

export function onEye(fn) {
    eye.listeners.push(fn);
}

function notify() {
    for (const fn of eye.listeners) {
        try {
            fn();
        } catch {
            // a listener's problem stays there
        }
    }
}

/** Remember a player's gear from the attack page. */
export async function saveGear(playerId, items) {
    const c = await cache();
    c.gear[playerId] = { items, seenAt: Date.now() };
    // The count is shared (GM storage) so the webpage can show it; the gear itself stays with Torn's pages.
    set('eyeGearCount', Object.keys(c.gear).length);
    saveSoon();
    notify();
}

export async function gearCount() {
    const c = await cache();
    return Math.max(Object.keys(c.gear || {}).length, Number(get('eyeGearCount', 0)) || 0);
}

export async function clearEye() {
    eye.cache = { players: {}, gear: {}, savedAt: Date.now() };
    eye.mem.clear();
    set('eyeClearAt', Date.now());
    set('eyeGearCount', 0);
    await idbSet('eye', eye.cache).catch(() => {});
    set('myAttacks', null);
    notify();
}

/** Your attacks (for the "your fight" layer), refreshed hourly by whichever tab needs them. */
async function myAttacks() {
    const stored = get('myAttacks', null);
    if (stored && Date.now() - stored.at < ATTACKS_FRESH_MS) return stored.list;
    if (!isVisible() || !getKey(K.apiKey)) return stored ? stored.list : [];
    try {
        const list = await fetchAttacks(tornClient(), { limit: 100 });
        const me = (get(K.userStatic, {}) || {}).keyInfo;
        const myId = me && me.userId;
        const slim = list
            .filter((a) => a && a.defender && (!myId || (a.attacker && a.attacker.id === myId)))
            .map((a) => ({ def: a.defender.id, ended: a.ended, ff: a.modifiers ? Number(a.modifiers.fair_fight) : null, result: a.result, respect: a.respect_gain, level: a.defender.level }));
        set('myAttacks', { at: Date.now(), list: slim });
        return slim;
    } catch {
        return stored ? stored.list : [];
    }
}

async function myEquipment() {
    const statics = get(K.userStatic, {}) || {};
    if (statics.equipment && Date.now() - (statics.equipmentAt || 0) < EQUIPMENT_FRESH_MS) return statics.equipment;
    if (!isVisible() || !getKey(K.apiKey)) return statics.equipment || null;
    try {
        const eq = await fetchEquipment(tornClient());
        set(K.userStatic, { ...(get(K.userStatic, {}) || {}), equipment: eq, equipmentAt: Date.now() });
        return eq;
    } catch {
        return statics.equipment || null;
    }
}

/**
 * Fetch what's missing for these players (batched), then notify. Safe to
 * call often: it coalesces and only asks for what's stale.
 * @param {number[]} ids
 * @param {object} [o] - {profiles: also read public profiles (level, life, rank, status)}
 */
export function wantPlayers(ids, { profiles = false } = {}) {
    for (const id of ids) if (Number(id) > 0) eye.pending.add(Number(id) + (profiles ? ':p' : ''));
    clearTimeout(eye.timer);
    eye.timer = setTimeout(flush, 120);
}

async function flush() {
    if (!isVisible()) return;
    const want = [...eye.pending];
    eye.pending.clear();
    const ids = [...new Set(want.map((x) => Number(String(x).split(':')[0])))];
    const withProfile = new Set(want.filter((x) => String(x).endsWith(':p')).map((x) => Number(String(x).split(':')[0])));
    const c = await cache();
    const now = Date.now();
    const rec = (id) => (c.players[id] = c.players[id] || {});
    clients();
    // FFScouter, batched, for anything not fresh.
    if (getKey(K.ffsKey)) {
        const need = ids.filter((id) => !(eye.mem.has(id) && now - eye.mem.get(id) < FFS_MEMORY_MS) && !(c.players[id] && c.players[id].ffsAt && now - c.players[id].ffsAt < FFS_STORED_MS));
        if (need.length) {
            try {
                const rows = await fetchFfsStats(eye.ffs, need);
                for (const [id, row] of rows) {
                    rec(id).ffs = row;
                    rec(id).ffsAt = Date.now();
                    eye.mem.set(id, Date.now());
                }
            } catch {
                // FFScouter off or paused: the other layers still work.
            }
        }
    }
    // TornStats spies (optional), one by one, only for players shown alone (profile/attack).
    if (getKey(K.tsKey)) {
        for (const id of ids.filter((x) => withProfile.has(x)).slice(0, 3)) {
            if (c.players[id] && c.players[id].spyAt && now - c.players[id].spyAt < SPY_FRESH_MS) continue;
            try {
                rec(id).spy = await fetchSpyUser(eye.ts, id);
            } catch {
                rec(id).spy = null;
            }
            rec(id).spyAt = Date.now();
        }
    }
    // Public profiles (life, level, rank, status) where asked.
    for (const id of ids.filter((x) => withProfile.has(x)).slice(0, 5)) {
        if (!getKey(K.apiKey)) break;
        const r = rec(id);
        if (!(r.profileAt && now - r.profileAt < PROFILE_FRESH_MS)) {
            try {
                const p = await fetchProfile(tornClient(), id);
                if (p) r.profile = { level: p.level, rank: p.rank, life: p.life && p.life.maximum, status: p.status || null, name: p.name, faction: p.faction_id || null };
                r.profileAt = Date.now();
            } catch {
                r.profileAt = Date.now();
            }
        }
        // Public stats only when nothing better exists.
        if (!r.ffs || !r.ffs.bsEstimate) {
            if (!(r.pubAt && now - r.pubAt < PUBLIC_FRESH_MS)) {
                try {
                    // The public "popular" group has crimes.total and networth.total (research-api-shapes.md §2).
                    const ps = (await fetchPersonalStats(tornClient(), { id, cat: 'popular' })) || {};
                    r.pub = { crimes: Number(ps.crimes && ps.crimes.total) || 0, networth: Number(ps.networth && ps.networth.total) || 0 };
                } catch {
                    r.pub = null;
                }
                r.pubAt = Date.now();
            }
        }
    }
    for (const id of ids) rec(id).seen = Date.now();
    saveSoon();
    await myAttacks();
    await myEquipment();
    notify();
}

/**
 * Everything the chip and card show for one player, from cached data (sync
 * once the cache is loaded). `extra` gives what the page itself shows
 * (level, life, name), which fills gaps without a request.
 */
export function eyeView(id, extra = {}, { war = false } = {}) {
    const m = pi.model;
    const c = eye.cache;
    if (!m || !m.ready || !c) return null;
    const r = c.players[id] || {};
    const prof = r.profile || {};
    const level = prof.level || extra.level || null;
    const life = prof.life || extra.life || lifeFromLevel(level);
    // Your stats as they fight: merits and passives (Torn's battlestats modifier) included.
    const mods = m.state.statMods || {};
    const meStats = Object.fromEntries(Object.entries(m.pc.stats).map(([k, v]) => [k, v * (1 + (mods[k] || 0) / 100)]));
    const attacks = (get('myAttacks', null) || {}).list || [];
    const fights = attacks.filter((a) => Number(a.def) === Number(id)).sort((a, b) => b.ended - a.ended);
    const pub = r.pub && (prof.rank || extra.rank) ? { rank: prof.rank || extra.rank, level, crimes: r.pub.crimes, networth: r.pub.networth } : null;
    const est = estimatePlayer({ me: meStats, spy: r.spy || null, fights, ffs: r.ffs || null, pub, now: Date.now() });
    const gearRec = c.gear[id];
    const gThem = gearRec ? gearSummary(gearRec.items) : null;
    const statics = get(K.userStatic, {}) || {};
    const gMe = statics.equipment ? myGear(statics.equipment) : DEFAULT_GEAR;
    const myLife = (m.state.life && m.state.life.maximum) || 7500;
    let f = null;
    let fGear = null;
    if (est) {
        const target = { id, life, bss: est.bss, stats: est.stats };
        f = forecast({ me: { ...meStats, life: myLife }, target, gearMe: gMe });
        if (gThem) fGear = forecast({ me: { ...meStats, life: myLife }, target, gearMe: gMe, gearThem: gThem });
    }
    const main = fGear || f;
    const band = bandOf(main, getSettings().bands);
    const ff = est ? fairFight(est.bss, bssOf(meStats)) : null;
    const respect = est && level ? respectFor(level, ff, { war }) : null;
    return {
        id,
        name: prof.name || extra.name || null,
        level,
        life,
        est,
        forecast: main,
        plain: f,
        withGear: fGear,
        gear: gearRec ? { text: gThem ? gThem.text : '', seenAt: gearRec.seenAt } : null,
        band,
        respect,
        figures: chipFigures(main, est, respect),
        source: est ? est.sourceText : null,
        status: prof.status || null,
    };
}

export function eyeReady() {
    return Boolean(eye.cache);
}

