/*
 * Torn Eye's data: for each player shown, the best estimate we can get
 * (spy → your fights → FFScouter → public stats), a fight forecast against
 * you, a band, respect and the chip's words. Requests only from a visible
 * tab, inside each service's own budget; answers are cached (FFScouter 5
 * min in memory and 1 h stored, as its guidance asks).
 */

import { K, get, set, getKey, getSettings, getShared } from './platform/store.js';
import { pageGet, pageSet } from './platform/archive.js';
import { learnedModel } from './core/learndata.js';
import { applyFightModel } from './core/learn.js';
import { idbGet, idbSet } from './platform/idb.js';
import { pi, tornClient, isVisible } from './runtime.js';
import { isPaused } from './turns.js';
import { fetchProfile, fetchPersonalStats, fetchAttacks, fetchEquipment, fetchFactionMembers } from './api/torn.js';
import { makeFfsClient, fetchFfsStats, fetchFfsTargets, FFS_MEMORY_MS, FFS_STORED_MS } from './api/ffscouter.js';
import { makeTsClient, fetchSpyUser } from './api/tornstats.js';
import { estimatePlayer } from './core/eye/estimate.js';
import { forecast, respectFor, fairFight, bssOf, DEFAULT_GEAR } from './core/eye/fight.js';
import { bandOf, chipFigures } from './core/eye/bands.js';
import { gearSummary, myGear } from './core/eye/gear.js';
import { lifeFromLevel, targetParams, targetQueries, listIgnoresFf, mergeTargetLists, inFfRange, selectTargets, listRowAsFfs, TARGETS_PER_MINUTE } from './core/eye/targets.js';
import { trackFlights, warBandOf } from './core/eye/war.js';
import { makePause } from './core/slices.js';
import { watchOf, addWatch, removeWatch, tagWatch, dismissOffer, isWatched, dueForRead, readEvents, watchOffers, EVENT_KEEP_MS } from './core/eye/watch.js';


export const PROFILE_FRESH_MS = 10 * 60 * 1000;
export const PUBLIC_FRESH_MS = 24 * 60 * 60 * 1000;
export const SPY_FRESH_MS = 60 * 60 * 1000;
export const ATTACKS_FRESH_MS = 60 * 60 * 1000;
export const EQUIPMENT_FRESH_MS = 6 * 60 * 60 * 1000;

/** GM storage (every tab and the webpage see it): the target list, the watch list and its reads, flights first seen. */
export const TARGETS_KEY = 'eyeTargets';
export const WATCH_KEY = 'eyeWatch';
export const WATCH_STATE_KEY = 'eyeWatchState';
export const FLIGHTS_KEY = 'eyeFlights';
/** GM storage: the bands the Torn Eye tab's war mode worked out (warBandTable in core/eye/war.js), for Torn's war page. */
export const WAR_BANDS_KEY = 'eyeWarBands';

const eye = { cache: null, loading: null, ffs: null, ts: null, pending: new Set(), timer: null, listeners: [], mem: new Map(), fc: new Map(), flushing: null, again: false, todo: new Map(), working: false, idling: false, side: null };

/** The one FFScouter client in this tab (Torn Eye and Settings share it, and its dead-key mark). */
export function sharedFfsClient() {
    if (!eye.ffs) eye.ffs = makeFfsClient({ getKey: () => getKey(K.ffsKey), isVisible, loadShared: () => get('ffsWindow', {}), saveShared: (s) => set('ffsWindow', s) });
    return eye.ffs;
}

/** A new FFScouter key: start a fresh client. */
export function resetFfsClient() {
    eye.ffs = null;
    eye.mem.clear();
}

function clients() {
    sharedFfsClient();
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

/**
 * Load the stored estimates without asking anybody (round 7): a local IndexedDB read. Torn's faction and war lists
 * ask about nobody (the 1.3.0 rule), so nothing else loaded them there and every row said "No data".
 * @returns {Promise<boolean>} whether this call was the one that loaded them (listeners are told once)
 */
export function loadEyeCache() {
    if (eye.cache) return Promise.resolve(false);
    const first = !eye.loading;
    return cache().then(() => {
        if (first) notify();
        return first;
    });
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
    pageSet(TARGETS_KEY, null);
    for (const k of [WATCH_KEY, 'eyeWarAuto', WAR_BANDS_KEY]) set(k, null);
    pageSet(WATCH_STATE_KEY, null);
    pageSet(FLIGHTS_KEY, null);
    notify();
}

/** Attacks on you kept for the watch list's "Watch?" offers (it looks back one hour). */
export const INCOMING_KEEP_S = 24 * 60 * 60;

/**
 * Your attacks and the attacks on you, from one read of /user/attacks.
 * @returns {{list: object[], incoming: object[]}}
 */
export function slimAttacks(list, myId, nowS = Math.floor(Date.now() / 1000)) {
    const out = (list || [])
        .filter((a) => a && a.defender && (!myId || (a.attacker && a.attacker.id === myId)))
        .map((a) => ({ def: a.defender.id, ended: a.ended, ff: a.modifiers ? Number(a.modifiers.fair_fight) : null, result: a.result, respect: a.respect_gain, level: a.defender.level }));
    // Attacks on you (stealthed ones name nobody): offered on the watch list.
    const incoming = myId
        ? (list || [])
              .filter((a) => a && a.attacker && a.attacker.id && a.attacker.id !== myId && a.defender && a.defender.id === myId && nowS - (Number(a.ended) || 0) < INCOMING_KEEP_S)
              .map((a) => ({ att: a.attacker.id, name: a.attacker.name || null, level: a.attacker.level || null, ended: a.ended, result: a.result }))
        : [];
    return { list: out, incoming };
}

/** Your attacks (for the "your fight" layer), refreshed hourly by whichever tab needs them. */
async function myAttacks() {
    const stored = get('myAttacks', null);
    if (stored && Date.now() - stored.at < ATTACKS_FRESH_MS) return stored.list;
    if (!isVisible() || !getKey(K.apiKey)) return stored ? stored.list : [];
    try {
        const list = await fetchAttacks(tornClient(), { limit: 100 });
        const me = (get(K.userStatic, {}) || {}).keyInfo;
        const slim = slimAttacks(list, me && me.userId);
        set('myAttacks', { at: Date.now(), list: slim.list, incoming: slim.incoming });
        return slim.list;
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

/** One sweep at a time: a second call while one runs waits and sweeps what came in meanwhile. */
async function flush() {
    if (eye.flushing) {
        eye.again = true;
        return eye.flushing;
    }
    eye.flushing = flushOnce().finally(() => {
        eye.flushing = null;
        if (eye.again) {
            eye.again = false;
            flush();
        }
    });
    return eye.flushing;
}

async function flushOnce() {
    // Nothing asked while hidden, or while Torn Trading runs (the two take turns); the ids stay pending.
    if (!isVisible() || isPaused()) return;
    const want = [...eye.pending];
    eye.pending.clear();
    const ids = [...new Set(want.map((x) => Number(String(x).split(':')[0])))];
    const withProfile = new Set(want.filter((x) => String(x).endsWith(':p')).map((x) => Number(String(x).split(':')[0])));
    const c = await cache();
    const now = Date.now();
    let changed = false;
    // Every write goes through here: the sweep saves only when one happened.
    const rec = (id) => {
        changed = true;
        return (c.players[id] = c.players[id] || {});
    };
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
            } catch (error) {
                // Paused mid-sweep: ask again later instead of remembering "nothing".
                if (!(error && error.takingTurns)) r.profileAt = Date.now();
            }
        }
        // Public stats only when nothing better exists.
        if (!r.ffs || !r.ffs.bsEstimate) {
            if (!(r.pubAt && now - r.pubAt < PUBLIC_FRESH_MS)) {
                try {
                    // The public "popular" group has crimes.total and networth.total (research-api-shapes.md §2).
                    const ps = (await fetchPersonalStats(tornClient(), { id, cat: 'popular' })) || {};
                    r.pub = { crimes: Number(ps.crimes && ps.crimes.total) || 0, networth: Number(ps.networth && ps.networth.total) || 0 };
                    r.pubAt = Date.now();
                } catch (error) {
                    if (!(error && error.takingTurns)) {
                        r.pub = null;
                        r.pubAt = Date.now();
                    }
                }
            }
        }
    }
    // Saved only when something changed (round 6: the whole cache was written on every sweep); `seen` (which players to
    // keep) moves at most hourly.
    for (const id of ids) if (!c.players[id] || !(now - (c.players[id].seen || 0) < 3600e3)) rec(id).seen = Date.now();
    if (changed) saveSoon();
    // Your own attacks and gear: read on the webpage's Torn Eye tab only (owner, round 6: Torn's pages ask about the
    // player you view or attack, nothing else).
    if (pi.where === 'app') {
        await myAttacks();
        await myEquipment();
    }
    notify();
}

/**
 * Your side of every fight, the same for each row of one draw: read and worked out once per draw, not once per row
 * (round 7: 300 rows read the settings, your gear and your attacks 300 times). Forgotten when the draw's task ends.
 */
function yourSide(m) {
    if (eye.side && eye.side.m === m) return eye.side;
    // Your stats as they fight: merits and passives (Torn's battlestats modifier) included.
    const mods = m.state.statMods || {};
    const meStats = Object.fromEntries(Object.entries(m.pc.stats).map(([k, v]) => [k, v * (1 + (mods[k] || 0) / 100)]));
    const statics = getShared(K.userStatic, {}) || {};
    const attacksBy = new Map();
    for (const a of (getShared('myAttacks', null) || {}).list || []) {
        const def = Number(a.def);
        if (!attacksBy.has(def)) attacksBy.set(def, []);
        attacksBy.get(def).push(a);
    }
    for (const l of attacksBy.values()) l.sort((a, b) => b.ended - a.ended);
    eye.side = {
        m,
        meStats,
        statics,
        gMe: statics.equipment ? myGear(statics.equipment) : DEFAULT_GEAR,
        myLife: (m.state.life && m.state.life.maximum) || 7500,
        // Your stats in ~1% steps (round 6): every train moved them, and every chip's Monte Carlo ran again (~50 ms for 100).
        meKey: Object.values(meStats).map((v) => Math.round(Math.log1p(v) * 100)),
        fm: learnedModel(getShared(K.learned, null)).fight,
        bands: getSettings().bands,
        attacksBy,
    };
    Promise.resolve().then(() => {
        eye.side = null;
    });
    return eye.side;
}

/**
 * Everything the chip and card show for one player, from cached data (sync
 * once the cache is loaded). `extra` gives what the page itself shows
 * (level, life, name), which fills gaps without a request.
 * `later` (the Torn Eye tab's target list, round 7): a fight not worked out yet is not simulated inside the draw
 * (300 targets froze the click for 0.4 s, 1.9 s on a slow PC: docs/sims/round7/startup.mjs). The view comes back
 * `pending`, the fight is queued and worked out a few ms at a time, and one redraw follows.
 */
export function eyeView(id, extra = {}, { war = false, later = false } = {}) {
    const m = pi.model;
    const c = eye.cache;
    if (!m || !m.ready || !c) return null;
    const r = c.players[id] || {};
    const prof = r.profile || {};
    const level = prof.level || extra.level || null;
    const life = prof.life || extra.life || lifeFromLevel(level);
    const { meStats, statics, gMe, myLife, meKey, fm, bands, attacksBy } = yourSide(m);
    const fights = attacksBy.get(Number(id)) || [];
    const pub = r.pub && (prof.rank || extra.rank) ? { rank: prof.rank || extra.rank, level, crimes: r.pub.crimes, networth: r.pub.networth } : null;
    const est = estimatePlayer({ me: meStats, spy: r.spy || null, fights, ffs: r.ffs || null, pub, now: Date.now() });
    const gearRec = c.gear[id];
    const gThem = gearRec ? gearSummary(gearRec.items) : null;
    let f = null;
    let fGear = null;
    let pending = false;
    if (est) {
        // The fight Monte Carlo runs again only when something it reads changed (a war page redraws every 10 s).
        // Kept per player and per what the fight read (round 7): one player shown by two lists with different facts (a
        // war row knows their life, the target list doesn't) used to be simulated again by each list on every draw.
        const key = id + '|' + JSON.stringify([est.bss, est.stats, life, myLife, meKey, gearRec ? gearRec.seenAt : 0, statics.equipmentAt || 0]);
        const memo = eye.fc.get(key);
        if (memo) {
            f = memo.f;
            fGear = memo.fGear;
        } else if (later) {
            pending = true;
            eye.todo.set(id, { extra, war });
            if (later === 'idle') fightsWhenIdle();
            else fightsSoon();
        } else {
            const target = { id, life, bss: est.bss, stats: est.stats };
            f = forecast({ me: { ...meStats, life: myLife }, target, gearMe: gMe });
            if (gThem) fGear = forecast({ me: { ...meStats, life: myLife }, target, gearMe: gMe, gearThem: gThem });
            if (eye.fc.size > 4000) eye.fc.clear();
            eye.fc.set(key, { f, fGear });
        }
    }
    let main = fGear || f;
    // What the fight learner kept from your own fights (only when it predicted your newest fights better).
    if (main && fm) main = { ...main, ...applyFightModel(fm, { pWin: main.pWin, keep: main.keep }), learned: true };
    const band = bandOf(main, bands);
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
        ours: ff,
        figures: chipFigures(main, est, respect),
        source: est ? est.sourceText : null,
        status: prof.status || null,
        pending,
    };
}

/**
 * A player this site holds no estimate for, as the Torn Eye tab's war mode judged them (round 7): the webpage's
 * estimates live in the webpage's own IndexedDB, and Torn's pages don't ask about war rows. Band, win and HP kept
 * only; null when war mode has nothing on them (or it is over a day old).
 */
export function sharedView(id, extra = {}, now = Date.now()) {
    const b = warBandOf(getShared(WAR_BANDS_KEY, null), id, now);
    if (!b) return null;
    const f = b.win === null ? null : { pWin: b.win / 100, keep: b.keep === null ? null : b.keep / 100, turns: null };
    return { id, name: extra.name || null, level: extra.level || null, life: extra.life || null, est: null, forecast: f, plain: null, withGear: null, gear: null, band: b.band, respect: null, ours: null, figures: chipFigures(f, null, null), source: 'war mode', status: null, pending: false, shared: { at: b.at } };
}

/** Work between two breaks while queued fights are worked out: a click or a scroll never waits longer. */
export const FIGHT_SLICE_MS = 8;

/** Fights queued by a list are still being worked out (their bands aren't known yet). */
export function fightsPending() {
    return eye.todo.size > 0;
}

function nextFight() {
    const [id, a] = eye.todo.entries().next().value;
    eye.todo.delete(id);
    eyeView(id, a.extra, { war: a.war });
}

/** The queued fights, a few ms at a time with a break for the page in between, then one redraw. */
function fightsSoon() {
    if (eye.working) return;
    eye.working = true;
    const pause = makePause({ everyMs: FIGHT_SLICE_MS });
    (async () => {
        try {
            // A hidden tab works nothing out: what's left is queued again by the next draw.
            while (eye.todo.size && isVisible()) {
                nextFight();
                await pause();
            }
        } finally {
            eye.working = false;
            pause.stop();
        }
        if (!eye.todo.size) notify();
    })().catch(() => {});
}

/**
 * The fights for these stored targets, worked out while the page has nothing else to do (the owner's idea: Torn Eye
 * gets ready quietly, never slowing the page). Local numbers only: no request, no redraw. Opening the tab meanwhile
 * takes over what is left (fightsSoon).
 * @param {{id: number, extra: object}[]} rows
 */
export function warmFights(rows) {
    if (!eye.cache || !(pi.model && pi.model.ready)) return false;
    for (const r of rows) if (!eye.todo.has(r.id)) eyeView(r.id, r.extra, { later: 'idle' });
    return true;
}

function fightsWhenIdle() {
    if (eye.idling || eye.working || typeof requestIdleCallback !== 'function') return;
    eye.idling = true;
    requestIdleCallback((deadline) => {
        eye.idling = false;
        if (eye.working) return;
        // A little per idle moment (an idle moment can be 50 ms long: that much work would be a freeze of its own).
        const t0 = performance.now();
        while (eye.todo.size && isVisible() && deadline.timeRemaining() > 2 && performance.now() - t0 < FIGHT_SLICE_MS) nextFight();
        if (eye.todo.size) fightsWhenIdle();
    });
}

export function eyeReady() {
    return Boolean(eye.cache);
}

/* ------------------------------------------------------ targets (ROUND4-PLAN §A) */

const targetCalls = [];

/** FFScouter's target finder allows 25 a minute: we wait for a slot past 20. */
async function paceTargets(sleep, now) {
    for (;;) {
        const t = now();
        while (targetCalls.length && t - targetCalls[0] >= 60000) targetCalls.shift();
        if (targetCalls.length < TARGETS_PER_MINUTE) {
            targetCalls.push(t);
            return;
        }
        await sleep(60000 - (t - targetCalls[0]) + 25);
    }
}

function takingTurnsError() {
    const e = new Error('Paused while Torn Trading runs.');
    e.takingTurns = true;
    return e;
}

/**
 * FFScouter's estimates for these list rows, awaited (the list is judged
 * right after). A row get-stats knows nothing about keeps the list's own
 * figures (its estimate and fair fight).
 */
export async function ensureFfsStats(rows, client = sharedFfsClient()) {
    const c = await cache();
    const now = Date.now();
    const rec = (id) => (c.players[id] = c.players[id] || {});
    const known = (r) => r && r.ffs && (r.ffs.bsEstimate || r.ffs.fairFight || r.ffs.bssPublic);
    const need = rows.map((r) => r.playerId).filter((id) => !(c.players[id] && c.players[id].ffsAt && now - c.players[id].ffsAt < FFS_STORED_MS && known(c.players[id])));
    if (need.length) {
        try {
            const got = await fetchFfsStats(client, need);
            for (const [id, row] of got) {
                rec(id).ffs = row;
                rec(id).ffsAt = Date.now();
                eye.mem.set(id, Date.now());
            }
        } catch (error) {
            // A refused key is said as such; anything else falls back to the list's own figures.
            if (error && error.deadKey) throw error;
        }
    }
    for (const r of rows) {
        const p = rec(r.playerId);
        if (!known(p)) p.ffs = listRowAsFfs(r, now);
        p.seen = now;
    }
    saveSoon();
}

/** The judge the webpage uses: the full Torn Eye view (spy, your fights, FFScouter, gear, what it learned). */
function viewJudge(r) {
    const v = eyeView(r.playerId, { level: r.level, name: r.name });
    if (!v) return null;
    const f = v.forecast;
    return {
        band: v.band,
        win: f ? Math.round(f.pWin * 100) : null,
        keep: f && f.keep !== null && f.keep !== undefined ? Math.round(f.keep * 100) : null,
        respect: v.respect,
        ours: Number.isFinite(v.ours) ? v.ours : null,
        source: v.est ? v.est.sourceText : null,
        ageDays: v.est ? v.est.ageDays : null,
    };
}

/**
 * Load Torn Eye's targets: FFScouter asked in slices, merged, the fair
 * fight range checked, every player judged by the fight model, and only
 * the ones you beat stored (most respect first). Throws on a refused key,
 * a pause or an FFScouter error; the stored list is then left as it was.
 * @param {object} input - {minLevel, maxLevel, inactiveOnly, factionless}
 * @param {object} [deps] - {client, judge, store, sleep, now} (tests)
 */
export async function importTargets(input = {}, { client = null, judge = null, store = (v) => pageSet(TARGETS_KEY, v), sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = () => Date.now() } = {}) {
    const ffs = client || sharedFfsClient();
    if (!judge && !(pi.model && pi.model.ready)) throw new Error('Waiting for your stats from Torn.');
    const params = targetParams(input);
    const lists = [];
    const skip = new Set();
    let asked = 0;
    let ffIgnored = false;
    for (const q of targetQueries(params)) {
        const band = q.minLevel + '-' + q.maxLevel;
        if (skip.has(band)) continue;
        if (isPaused()) throw takingTurnsError();
        await paceTargets(sleep, now);
        const rows = await fetchFfsTargets(ffs, { ...q, limit: 50 });
        asked++;
        lists.push(rows);
        // FFScouter ignored the range: the other slices of this level band would be the same list.
        if (listIgnoresFf(rows, q)) {
            ffIgnored = true;
            skip.add(band);
        }
    }
    const merged = mergeTargetLists(lists);
    await ensureFfsStats(merged.filter(inFfRange), ffs);
    const { kept, dropped } = selectTargets(merged, judge || viewJudge);
    const list = kept.map((r) => ({
        playerId: r.playerId,
        name: r.name,
        level: r.level,
        fairFight: r.fairFight,
        bsEstimate: r.bsEstimate,
        lastAction: r.lastAction,
        hospitalUntil: r.hospitalUntil,
        band: r.band,
        win: r.win,
        keep: r.keep,
        respect: r.respect,
        ours: r.ours,
        source: r.source,
        ageDays: r.ageDays,
    }));
    const out = { at: now(), params, list, dropped, asked, found: merged.length, ffIgnored };
    store(out);
    notify();
    return out;
}

/* ------------------------------------------------------ flights (war and watch) */

/** When each flight was first seen, kept across reloads (GM storage, so every tab agrees). */
export function flightsSeen() {
    return pageGet(FLIGHTS_KEY, {}) || {};
}

export function rememberFlights(members, now = Date.now()) {
    const { seen, changed } = trackFlights(flightsSeen(), members, now);
    if (changed) pageSet(FLIGHTS_KEY, seen);
    return seen;
}

/* ------------------------------------------------------ watch list (ROUND4-PLAN §I) */

export function getWatch() {
    return watchOf(get(WATCH_KEY, null));
}

export function watchStates() {
    const s = pageGet(WATCH_STATE_KEY, null) || {};
    return { at: s.at || 0, players: s.players || {} };
}

/**
 * Watch or stop watching a player.
 * @returns {{ok, watching, reason?}} reason 'full' at WATCH_MAX (50) players
 */
export function toggleWatch(player) {
    const cur = getWatch();
    if (isWatched(cur, player.id)) {
        set(WATCH_KEY, removeWatch(cur, player.id));
        notify();
        return { ok: true, watching: false };
    }
    const r = addWatch(cur, player);
    if (r.ok) {
        set(WATCH_KEY, r.state);
        notify();
    }
    return { ok: r.ok, watching: r.ok, reason: r.reason };
}

export function setWatchTag(id, tag) {
    set(WATCH_KEY, tagWatch(getWatch(), id, tag));
    notify();
}

export function dismissWatchOffer(id) {
    set(WATCH_KEY, dismissOffer(getWatch(), id));
    notify();
}

/** "Watch?" offers: who attacked or mugged you in the last hour (from your attacks, read hourly). */
export function watchOffersNow(now = Date.now()) {
    return watchOffers((get('myAttacks', null) || {}).incoming || [], getWatch(), now);
}


const watchRun = { busy: false };

/**
 * Read the watched players that are due (60 s; 5 min for a long hospital
 * stay or flight). One profile each, through the shared Torn client; a
 * player in the faction list just read (war) costs nothing. Only from a
 * visible tab, never while Torn Trading runs; two tabs don't both read.
 * @param {object} [o] - {members: faction members already read}
 * @returns {Promise<boolean>} whether anything was read
 */
export async function pollWatch({ members = null } = {}) {
    if (watchRun.busy || !isVisible() || isPaused() || !getKey(K.apiKey) || get(K.apiKeyDead, false)) return false;
    const w = getWatch();
    if (!w.list.length) return false;
    const now = Date.now();
    const st = pageGet(WATCH_STATE_KEY, null) || {};
    // The lock is shared (GM, tiny): two webpage tabs on Watched don't both read everyone.
    const lock = get('eyeWatchLock', null) || {};
    if (lock.at && now - lock.at < 20000 && lock.tab !== pi.tabId) return false;
    const flights = flightsSeen();
    const fromList = new Map((members || []).map((m) => [Number(m.id), m]));
    const players = { ...(st.players || {}) };
    const due = w.list.filter((x) => fromList.has(Number(x.id)) || dueForRead(players[x.id], now, flights[x.id] ? flights[x.id].at : null));
    if (!due.length) return false;
    set('eyeWatchLock', { at: now, tab: pi.tabId });
    watchRun.busy = true;
    const read = [];
    try {
        // Watched players in the same faction (two or more due): one faction read covers them all.
        const byFaction = new Map();
        for (const x of due) {
            const fid = players[x.id] && players[x.id].faction;
            if (!fid || fromList.has(Number(x.id))) continue;
            byFaction.set(fid, (byFaction.get(fid) || 0) + 1);
        }
        for (const [fid, n] of byFaction) {
            if (n < 2 || isPaused() || !isVisible()) continue;
            try {
                for (const mm of await fetchFactionMembers(tornClient(), fid)) if (mm && mm.id) fromList.set(Number(mm.id), { ...mm, faction: fid });
            } catch (error) {
                if (error && error.takingTurns) break;
            }
        }
        for (const x of due) {
            if (isPaused() || !isVisible()) break;
            let rec = null;
            const m = fromList.get(Number(x.id));
            if (m) rec = { name: m.name || null, level: m.level || null, status: m.status || null, last_action: m.last_action || null, has_early_discharge: Boolean(m.has_early_discharge), is_revivable: Boolean(m.is_revivable), faction: m.faction || (players[x.id] && players[x.id].faction) || null };
            else {
                try {
                    const p = await fetchProfile(tornClient(), x.id);
                    if (p) rec = { name: p.name || null, level: p.level || null, status: p.status || null, last_action: p.last_action || null, life: (p.life && p.life.maximum) || null, faction: p.faction_id || null, is_revivable: Boolean(p.revivable) };
                } catch (error) {
                    if (error && error.takingTurns) break;
                    continue;
                }
            }
            if (!rec) continue;
            const prev = players[x.id];
            const t = Date.now();
            const events = [...((prev && prev.events) || []).filter((e) => t - e.at < EVENT_KEEP_MS), ...readEvents(prev, rec, t)];
            players[x.id] = { ...rec, readAt: t, events };
            read.push({ id: x.id, ...rec });
        }
    } finally {
        watchRun.busy = false;
    }
    const ids = new Set(getWatch().list.map((x) => String(x.id)));
    for (const k of Object.keys(players)) if (!ids.has(k)) delete players[k];
    pageSet(WATCH_STATE_KEY, { at: Date.now(), players });
    rememberFlights(read);
    // Life and level for the fight model (this page's own cache).
    const c = await cache();
    for (const r of read) {
        const p = (c.players[r.id] = c.players[r.id] || {});
        if (r.life || r.level) p.profile = { ...(p.profile || {}), level: r.level || (p.profile && p.profile.level) || null, life: r.life || (p.profile && p.profile.life) || null, name: r.name, status: r.status };
    }
    if (read.length) wantPlayers(read.map((r) => r.id));
    notify();
    return read.length > 0;
}

