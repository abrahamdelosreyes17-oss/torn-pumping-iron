/*
 * The webpage's wiring: what each tab can read and do. Prices are fetched
 * only for items the Buy list needs (plus a few tracked ones), at most once
 * every 5 minutes, and only while this tab is visible.
 */

import { gmOnChange } from './platform/gm.js';
import { K, get, getShared, set, del, getKey, setKey, getSettings, setSettings, getPlan, setPlan, clearGroup, DATA_GROUPS, getPrices, PRICE_LISTINGS_KEPT, loadLocalPrices, localPrices, setLocalPrices, clearLocalPrices } from './platform/store.js';
import { pi, tornClient, refresh, onModel, isVisible, nudgeFeed, TORN_PER_MINUTE, beatFocus, apiFocus, createPlan, recalibratePlan, followStrategy, followPath, cancelPlan, onPlanProgress, startStacking, resumeTraining, overdoseDone, booksReport } from './runtime.js';
import { ledgerShape } from './core/ledger.js';
import { forgetSavedPlan } from './platform/plan-store.js';
import { archived, pageGet, loadArchives, drainArchives, clearArchived, archivesReady } from './platform/archive.js';
import { PiApp } from './ui/app/app.js';
import { fetchKeyInfo, fetchItemMarket, fetchPointsMarket, fetchFactionMembers, fetchFactionWars, fetchFactionChain, keyIsEnough } from './api/torn.js';
import { chainFromApi, sharedChain } from './core/eye/chain.js';
import { outEarly, enemiesFromWars, warBandTable, warAskNext, warBegun, warKeyOf } from './core/eye/war.js';
import { targetStatus, ownHits, statusOrder, splitTargets, cutTargets, nextTable, nextTableSig, ATTACK_OPENED_MS } from './core/eye/targets.js';
import { normBand } from './core/eye/bands.js';
import { isWatched } from './core/eye/watch.js';
import { W3bClient, fetchW3bListings } from './api/w3b.js';
import { checkFfsKey } from './api/ffscouter.js';
import { renderEye, readsTargetStatuses } from './ui/app/eye-tab.js';
import { wantPlayers, eyeView, warmFights, fightsPending, onEye, gearCount, clearEye, sharedFfsClient, resetFfsClient, importTargets, refillTargets, dropHitTargets, storedTargets, TARGETS_KEY, WAR_BANDS_KEY, WAR_ASK_KEY, EYE_CHAIN_KEY, EYE_NEXT_KEY, rememberFlights, flightsSeen, getWatch, watchStates, toggleWatch, setWatchTag, dismissWatchOffer, watchOffersNow, pollWatch, pumpStatuses, statusRead, onStatus, loadStatuses, attacksAfterOpen } from './eye-service.js';
import { discordState, discordRaw, connectDiscord, testDiscord, forgetDiscord, linkedDiscordId, linkDiscord, setTargetsForSync, setEyeForSync, loginDiscord, cancelLogin, resumeLogin } from './discord.js';
import { saveFullKey, forgetFullKey, refreshMoneyLog } from './income.js';
import { WORKER_SETUP_URL } from './api/worker.js';
import { tabWindow } from './platform/tab-window.js';
import { listingsFromItemMarket, listingsFromW3b, listingsFromPoints, slimPriceRow } from './core/market.js';
import { recordPrice, average7, dailyLows, readPriceHistory } from './core/history.js';
import { parsePerks } from './core/perks.js';
import { POINTS } from './core/items.js';
import { STRATEGIES } from './core/strategies.js';
import { redactKey } from './api/client.js';
import { keyProblem } from './ui/key-status.js';
import { isPaused, onPauseChange } from './turns.js';
import { joinFights } from './core/learndata.js';
import { maybeLearn, BUILD, planNowStored } from './runtime.js';
import { autoRecalibrateDue } from './core/saved-plan.js';
import { tornDayStart } from './core/bars.js';
import { normalizeState } from './core/bars.js';
import { readLines } from './core/planline.js';
import { problemLogNow, clearProblemLog, planRuns, logAction, logError } from './problem-log.js';

/** What Settings shows about the Full key (never the key itself). */
function fullKeyView() {
    const st = get(K.fullKeyState, null) || {};
    const ml = pageGet(K.moneyLog, null);
    return { has: Boolean(getKey(K.fullKey)), ok: Boolean(st.ok && !st.dead), error: st.error || null, logAt: ml ? ml.at : null, logLines: ml && ml.lines ? ml.lines.length : 0 };
}

/** How long fetched prices count as fresh. */
export const PRICE_FRESH_MS = 5 * 60 * 1000;

const page = { app: null, w3b: null, ffs: null, loading: new Set(), eye: { loading: false, error: null, gear: 0 } };

function w3bClient() {
    if (!page.w3b) {
        const win = tabWindow('w3bWindow', pi.tabId, { get: (k, fb) => get(k, fb), set: (k, v) => set(k, v), del: (k) => del(k) });
        page.w3b = new W3bClient({ isVisible, addShared: (at) => win.add(at), loadShared: () => ({ recent: win.load(), cooldownUntil: get('w3bCooldown', 0) }), saveShared: (s) => set('w3bCooldown', s.cooldownUntil || 0) });
    }
    return page.w3b;
}

export function ffsClient() {
    page.ffs = sharedFfsClient();
    return page.ffs;
}

/**
 * Listings kept for an item priced only so the plan can weigh it (every candy
 * the plan might pick): the cheapest few, enough for a boost's 49.
 */
export const PRICE_LISTINGS_SLIM = 15;

/** ...and are asked again every 30 minutes, not 5 (about 19 candy: Torn's own market price fills in between). */
export const PRICE_SLIM_FRESH_MS = 30 * 60 * 1000;

/**
 * Fetch listings for the items the Buy list shows, if older than 5 minutes.
 * `slim` ids (priced only to weigh them: the candy the plan might pick) keep fewer listings.
 */
export async function loadPrices(ids, slim = []) {
    // Nothing from Torn or TornW3B while Torn Trading runs (the two take turns).
    if (!getKey(K.apiKey) || isPaused() || get(K.apiKeyDead, false)) return;
    // This site's own listings decide what is due (the other site's reads left only small rows in GM).
    const first = !page.localPrices;
    await loadLocalPrices();
    page.localPrices = true;
    const prices = { ...localPrices() };
    const skip = new Set();
    const now = Date.now();
    const full = new Set(ids.map(String));
    const slimSet = new Set(slim.map(String).filter((id) => !full.has(id)));
    const fresh = (id) => (slimSet.has(id) ? PRICE_SLIM_FRESH_MS : PRICE_FRESH_MS);
    const due = [...new Set([...full, ...slimSet])].filter((id) => !page.loading.has(id) && !(prices[id] && now - (prices[id].at || 0) < fresh(id)));
    if (!due.length) {
        // This site's listings just came from its IndexedDB: the Buy list and market outlines can show them now.
        if (first) {
            refresh();
            if (page.app) page.app.render(true);
        }
        return;
    }
    for (const id of due) page.loading.add(id);
    let hist = readPriceHistory(get(K.priceHistory, null));
    const loaded = {};
    for (const id of due) {
        // Paused mid-load: keep what's stored, ask again once Torn Trading stops.
        if (isPaused()) {
            skip.add(id);
            page.loading.delete(id);
            continue;
        }
        const row = { at: Date.now(), listings: [], imAt: null, w3bAt: null, error: null };
        try {
            if (id === POINTS) {
                row.listings = listingsFromPoints(await fetchPointsMarket(tornClient()));
                row.imAt = Date.now();
            } else {
                row.listings = listingsFromItemMarket(await fetchItemMarket(tornClient(), id));
                row.imAt = Date.now();
                try {
                    if (getSettings().w3b === false) throw new Error('TornW3B is off');
                    if (isPaused()) throw new Error('Paused while Torn Trading runs.');
                    const w = await fetchW3bListings(w3bClient(), id);
                    // Bazaars TornW3B re-checked in the last 2 minutes, never a $1 locked listing.
                    row.listings = row.listings.concat(listingsFromW3b(w, { now: Date.now() }));
                    row.w3bAt = Date.now();
                } catch {
                    // Bazaars are a bonus; the Item Market still answers.
                }
            }
        } catch (error) {
            if (error && error.takingTurns) {
                skip.add(id);
                page.loading.delete(id);
                continue;
            }
            row.error = redactKey(String((error && error.message) || error), getKey(K.apiKey));
            // A failed load keeps the last good listings, and is asked again in 30 s, not 5 min.
            const old = prices[id];
            const retryAt = Date.now() - PRICE_FRESH_MS + 30000;
            if (old && Array.isArray(old.listings) && old.listings.length) {
                prices[id] = { ...old, error: row.error, at: retryAt };
                loaded[id] = prices[id];
                page.loading.delete(id);
                continue;
            }
            row.at = retryAt;
        }
        // Kept small: the cheapest listings only (GM storage is read on every Torn page).
        row.listings = row.listings.sort((a, b) => a.price - b.price).slice(0, slimSet.has(id) ? PRICE_LISTINGS_SLIM : PRICE_LISTINGS_KEPT);
        const cheapest = row.listings.length ? row.listings[0].price : null;
        if (cheapest) hist = recordPrice(hist, id, Date.now(), cheapest);
        const avg = average7(hist, id, Date.now());
        row.avg7 = avg.days >= 2 ? avg.avg : null;
        row.lows7 = dailyLows(hist, id, Date.now(), 7);
        prices[id] = row;
        loaded[id] = row;
        page.loading.delete(id);
    }
    set(K.priceHistory, hist);
    // The listings stay on this site; GM gets one small row per item (every Torn page is handed GM).
    const got = Object.fromEntries(Object.entries(loaded).filter(([id]) => !skip.has(id)));
    setLocalPrices(got);
    const small = { ...(get(K.prices, {}) || {}) };
    for (const [id, row] of Object.entries(small)) if (row && row.listings) small[id] = slimPriceRow(id, row);
    for (const [id, row] of Object.entries(got)) small[id] = slimPriceRow(id, row);
    set(K.prices, small);
    refresh();
    if (page.app) page.app.render(true);
}


async function saveTornKey(v) {
    if (!v) return { ok: false, text: 'Paste a key first.' };
    if (!/^[A-Za-z0-9]{16}$/.test(v)) return { ok: false, text: 'A Torn key is 16 letters and numbers.' };
    setKey(K.apiKey, v);
    set(K.userStatic, { ...(get(K.userStatic, {}) || {}), keyInfo: null, keyInfoAt: 0 });
    try {
        const info = await fetchKeyInfo(tornClient());
        const s = { ...(get(K.userStatic, {}) || {}), keyInfo: info, keyInfoAt: Date.now() };
        set(K.userStatic, s);
        const enough = keyIsEnough(info);
        nudgeFeed();
        if (enough === false) {
            const p = keyProblem({ hasKey: true, dead: false, keyInfo: info });
            return { ok: false, text: 'Saved, but this ' + (info.type || '') + ' key won’t work. ' + (p ? p.text : 'Make a Limited key.') };
        }
        return { ok: true, text: 'Saved · ' + (info.type || 'key accepted') + '.' };
    } catch (error) {
        return { ok: false, text: String((error && error.message) || error) };
    }
}

async function saveFfsKey(v) {
    if (!v) return { ok: false, text: 'Paste your FFScouter key first.' };
    setKey(K.ffsKey, v);
    resetFfsClient();
    page.ffs = null;
    try {
        const r = await checkFfsKey(ffsClient());
        set(K.ffsState, { registered: r.registered, checkedAt: Date.now() });
        return r.registered ? { ok: true, text: 'Connected to FFScouter.' + (r.policyUpdate ? ' Their data policy changed: accept it on ffscouter.com.' : '') } : { ok: false, text: 'Saved, but FFScouter doesn’t know this key yet. Sign up there first.' };
    } catch (error) {
        return { ok: false, text: String((error && error.message) || error) };
    }
}

async function saveTsKey(v) {
    setKey(K.tsKey, v);
    return { ok: true, text: v ? 'Saved. Spies show on Torn Eye.' : 'Removed.' };
}

function diagnostics() {
    const statics = get(K.userStatic, {}) || {};
    const err = get(K.lastError, null);
    const w3b = page.w3b ? page.w3b.stats().usedLastMinute : 0;
    return {
        torn: tornClient().stats().usedLastMinute,
        tornMax: TORN_PER_MINUTE,
        // Which calls go first right now (Settings › Diagnostics).
        focus: (() => {
            const f = apiFocus();
            return f.eye && f.prices ? 'Torn Eye and prices, half each' : f.eye ? (f.war ? 'the war, then Torn Eye' : 'Torn Eye') : f.prices ? 'prices' : '';
        })(),
        ffs: page.ffs ? page.ffs.stats().usedLastMinute : 0,
        w3b,
        lastError: err ? new Date(err.at).toISOString().slice(11, 16) + ' ' + err.message : null,
        unknownPerks: parsePerks(statics.perks || {}).unknown.length,
        version: PI_BUILD_VERSION,
        historyDays: Object.keys(archived(K.statsHistory, {}) || {}).length,
        priceItems: Object.keys((readPriceHistory(archived(K.priceHistory, null)) || {}).items || {}).length,
        eyeLine: 'targets, estimates and gear for ' + page.eye.gear + ' player' + (page.eye.gear === 1 ? '' : 's'),
        learnLine: (((archived('calibration', null) || {}).samples) || []).length + ' sessions · ' + (pageGet(K.fightLog, []) || []).length + ' fights · what it learned',
    };
}

/**
 * Targets for the Torn Eye tab: FFScouter asked just under your stomp edge, each answer judged by the fight model,
 * only the ones you beat stored, the active 100 and a reserve (eye-service).
 */
async function loadTargets(params) {
    if (!getKey(K.ffsKey) || isPaused() || page.eye.loading || page.eye.refilling) return;
    page.eye.loading = true;
    page.eye.error = null;
    page.app.render(true);
    try {
        await importTargets(params, { client: ffsClient() });
    } catch (error) {
        const msg = redactKey(String((error && error.message) || error), getKey(K.ffsKey));
        page.eye.error = { message: msg, deadKey: Boolean(error && error.deadKey), paused: Boolean(error && error.paused), retryAfterS: (error && error.retryAfterS) || null, takingTurns: Boolean(error && error.takingTurns) };
    }
    page.eye.loading = false;
    page.app.render(true);
}

/**
 * The reserve ran low (players you hit dropped out): one more FFScouter ask, quietly (no "loading", an error kept to
 * itself; the tab tries again after REFILL_GAP_MS). Visible tab, an FFScouter key, never while Torn Trading runs or
 * while a load or another refill is under way; paced with the loads (20 a minute).
 */
async function refillQuietly() {
    if (!getKey(K.ffsKey) || isPaused() || !isVisible() || page.eye.loading || page.eye.refilling) return;
    page.eye.refilling = true;
    try {
        await refillTargets({ client: ffsClient() });
    } catch {
        // Quiet: the list stays as it is; the 6 h reload or the next refill tries again.
    } finally {
        page.eye.refilling = false;
    }
}

/*
 * War mode on the webpage: the enemy is found by itself from your own
 * faction's wars (every 5 min while the page is open), or picked by id.
 * Its members are read every 10 s while the War view shows, and every
 * 5 min otherwise when Discord is set up (the bot's war pings need the bands).
 */
const war = { manual: null, pick: null, members: [], membersFid: null, name: null, early: new Set(), at: 0, readAt: 0, loading: false, error: null, enemies: [], warsAt: 0, warsLoading: false, myFaction: undefined };

export const WAR_TAB_POLL_MS = 10000;
export const WAR_BACKGROUND_POLL_MS = 5 * 60 * 1000;
export const OWN_WARS_POLL_MS = 5 * 60 * 1000;

/** The faction War mode watches: yours picked by id, else the war you chose, else the first of your faction's wars. */
function warFid() {
    if (war.manual) return war.manual;
    if (war.pick && war.enemies.some((x) => x.id === war.pick)) return war.pick;
    return war.enemies.length ? war.enemies[0].id : null;
}

function myFactionId() {
    const ki = (get(K.userStatic, {}) || {}).keyInfo;
    if (!ki) return undefined;
    return ki.factionId || null;
}

/** Your faction's own war that War mode shows now (null for a faction typed in, or no war). */
function warEnemyNow() {
    if (war.manual) return null;
    const fid = warFid();
    return war.enemies.find((x) => x.id === fid) || null;
}

/**
 * War mode by itself (round 8, the owner's pick A): a war that has begun and was not seen before is noted (its key,
 * when it was seen, no answer yet), and the Torn Eye tab opens on War: at a new war, and on a page load that has not
 * picked a view yet. A view you pick stays.
 */
function warModeCheck(now = Date.now()) {
    const enemy = warEnemyNow();
    const next = warAskNext(get(WAR_ASK_KEY, null), enemy, now);
    if (next.fresh) set(WAR_ASK_KEY, next.rec);
    if (page.app && warBegun(enemy, Math.floor(now / 1000)) && (next.fresh || page.app.ui.eyeMode === undefined)) page.app.ui.eyeMode = 'war';
    return next.fresh;
}

/** This war's record (the answer to the termed-war question), or null when War mode shows no war of your own. */
function warAskNow() {
    const enemy = warEnemyNow();
    const kept = get(WAR_ASK_KEY, null);
    return enemy && kept && kept.key === warKeyOf(enemy) ? { ...kept, kind: enemy.kind, start: enemy.start } : null;
}

async function pollOwnWars(force = false) {
    if (war.warsLoading || !isVisible() || isPaused() || !getKey(K.apiKey) || get(K.apiKeyDead, false)) return;
    const mine = myFactionId();
    war.myFaction = mine;
    if (!mine) return;
    if (!force && Date.now() - war.warsAt < OWN_WARS_POLL_MS) return;
    war.warsLoading = true;
    try {
        const resp = await fetchFactionWars(tornClient(), mine);
        war.enemies = enemiesFromWars(resp, mine);
        set('eyeWarAuto', { at: Date.now(), myFaction: mine, enemies: war.enemies });
    } catch {
        // Keep the last answer; asked again in 5 min.
    } finally {
        war.warsLoading = false;
        war.warsAt = Date.now();
    }
    warModeCheck();
    if (page.app) page.app.render(true);
}

async function pollWarTab() {
    const fid = warFid();
    if (!fid || war.loading || !isVisible() || isPaused()) return;
    const viewing = page.app && page.app.tab === 'eye' && (page.app.ui.eyeMode || 'targets') === 'war';
    const every = viewing ? WAR_TAB_POLL_MS : discordState() ? WAR_BACKGROUND_POLL_MS : null;
    if (!every || (war.membersFid === fid && Date.now() - war.at < every)) return;
    war.loading = true;
    try {
        const members = await fetchFactionMembers(tornClient(), fid);
        if (warFid() !== fid) return;
        const nowMs = Date.now();
        war.early = war.membersFid === fid ? outEarly(war.members, members, Math.floor(nowMs / 1000)) : new Set();
        // When each flight was first seen (kept across reloads): the landing estimate counts from it.
        rememberFlights(members, nowMs);
        war.members = members;
        war.membersFid = fid;
        // When the members were last read for real (`at` also moves on a failed read).
        war.readAt = nowMs;
        war.error = null;
        wantPlayers(members.map((m) => Number(m.id)));
    } catch (error) {
        war.error = String((error && error.message) || error);
    } finally {
        war.loading = false;
        war.at = Date.now();
    }
    if (page.app) page.app.render(true);
}

function warName(fid) {
    const e = war.enemies.find((x) => x.id === fid);
    return e && e.name ? e.name : null;
}

/** The enemy's chain is read this often while the War view shows or chain mode is on (one small call). */
export const ENEMY_CHAIN_POLL_MS = 30 * 1000;

const enemyChain = { fid: null, raw: null, at: 0, loading: false };

/**
 * The chain counter's other side (round 8): the enemy faction's chain, read while the War view shows or chain mode is
 * on, and left in shared storage for Torn's own pages (they ask nothing for a war). Yours comes with your bars.
 */
async function pollEnemyChain() {
    const fid = warFid();
    const viewing = page.app && page.app.tab === 'eye' && (page.app.ui.eyeMode || 'targets') === 'war';
    const chaining = Boolean(pi.model && pi.model.ready && pi.model.stacking);
    if (!fid || enemyChain.loading || !(viewing || chaining) || !isVisible() || isPaused() || !getKey(K.apiKey) || get(K.apiKeyDead, false)) return;
    if (enemyChain.fid === fid && Date.now() - enemyChain.at < ENEMY_CHAIN_POLL_MS) return;
    enemyChain.loading = true;
    try {
        const c = await fetchFactionChain(tornClient(), fid);
        const at = Date.now();
        enemyChain.raw = chainFromApi(c, at);
        enemyChain.fid = fid;
        if (enemyChain.raw) set(EYE_CHAIN_KEY, { ...enemyChain.raw, fid, name: warName(fid) || (war.membersFid === fid ? war.name : null) || null });
    } catch {
        // Asked again in 30 s; the counter says "Not read yet" once the last read is old.
    } finally {
        enemyChain.loading = false;
        enemyChain.at = Date.now();
    }
    if (page.app && page.app.tab === 'eye') page.app.render(true);
}

/** Both chains for the Torn Eye tab's chain mode card: yours from your bars, theirs from the last read (null: none). */
function chainsNow(now = Date.now()) {
    const m = pi.model;
    const fid = warFid();
    const theirs = fid && enemyChain.fid === fid ? sharedChain(enemyChain.raw, now) : null;
    return { mine: m && m.ready && m.state ? m.state.chain || null : null, enemy: fid ? { fid, name: warName(fid), raw: theirs } : null };
}

/** The watch list as stored, read once per draw (a list's 300 stars each asked for a copy of it). */
let watchMemo = null;
function watchNow() {
    if (!watchMemo) {
        watchMemo = getWatch();
        Promise.resolve().then(() => {
            watchMemo = null;
        });
    }
    return watchMemo;
}

/**
 * Stored targets, judged again now, split into the active list (the first 100 in the order: shown, statuses read,
 * synced to Discord) and the quiet reserve behind it. Only players you still beat are listed (your stats or colours
 * may have changed) and a player you just hit is out at once: the next one slides in. Worked out once per draw.
 */
let listsMemo = null;
function eyeLists() {
    if (!listsMemo) {
        listsMemo = splitTargets(judgedTargets());
        Promise.resolve().then(() => {
            listsMemo = null;
        });
    }
    return listsMemo;
}

/** The active list (Targets, the bot's /targets). */
function eyeRows() {
    return eyeLists().active;
}

/** Every kept target (at most 200, an older 600 list cut in the order), judged again now. */
function judgedTargets() {
    const stored = pageGet(TARGETS_KEY, null);
    if (!stored || !Array.isArray(stored.list)) return [];
    // Where each target is, from reads already made (round 7): the list itself asks Torn about nobody, so a row's
    // status is whatever the watch list, the war list, a profile or a flight first seen left, if it is fresh.
    const now = Date.now();
    const watched = watchStates().players;
    const flights = flightsSeen();
    const fid = warFid();
    const warBy = new Map((war.membersFid === fid ? war.members || [] : []).map((mm) => [Number(mm.id), mm]));
    // Who you just hit: your attacks (read hourly) and the attack pages you opened since.
    const hits = ownHits((getShared('myAttacks', null) || {}).list || [], getShared(K.eyePredictions, []) || [], now);
    return cutTargets(stored.list, { gone: stored.gone, now }).map((x) => {
        // A fight not worked out yet isn't simulated inside the draw: the row shows what the list stored until it is.
        const live = eyeView(x.playerId, { level: x.level, name: x.name }, { later: true });
        const v = live && !live.pending ? live : null;
        const base = v || { id: x.playerId, band: normBand(x.band), forecast: Number.isFinite(x.win) ? { pWin: x.win / 100, keep: Number.isFinite(x.keep) ? x.keep / 100 : null } : null, respect: x.respect || null };
        const ws = watched[x.playerId];
        const wm = warBy.get(Number(x.playerId));
        // The free reads first (the watch list, the war list, a flight first seen), then the statuses read one by one.
        const sr = statusRead(x.playerId);
        const reads = [ws ? { status: ws.status, at: ws.readAt } : null, wm ? { status: wm.status, at: war.readAt } : null, live && live.statusAt ? { status: live.status, at: live.statusAt } : null, sr];
        // The newest read believed now; asked again 10 min after the last read (a hospital stay too: a revive shows);
        // the list's hospital out-time only while no read is newer than the list (targetStatus, round 7 review).
        const ts = targetStatus(reads, { listAt: stored.at, hospitalUntil: x.hospitalUntil, flight: flights[x.playerId] || null, now });
        const hit = hits.get(Number(x.playerId)) || null;
        return { ...base, name: x.name, level: x.level, hospitalUntil: ts.hospitalUntil, lastAction: x.lastAction, id: x.playerId, stored: x, status: ts.status, statusAt: ts.statusAt, hit };
    });
}

/*
 * Target statuses (round 7, the Torn Trading way): the Torn Eye tab says which rows are on screen at each draw; the
 * players opened to attack go first, then that page, then every other listed row in the list's order.
 */
const statusPlan = { order: [], page: new Set(), open: new Set(), readAt: new Map(), clicked: new Map() };

function showStatuses({ page = [], all = [], opened = [], readAt = new Map() } = {}) {
    const now = Date.now();
    for (const [id, at] of statusPlan.clicked) if (!(now - at < ATTACK_OPENED_MS)) statusPlan.clicked.delete(id);
    const open = [...statusPlan.clicked.keys(), ...opened];
    statusPlan.order = statusOrder({ open, page, all });
    statusPlan.page = new Set(page.map(Number));
    statusPlan.open = new Set(open.map(Number));
    statusPlan.readAt = readAt;
    pumpTargetStatuses();
}

/** Targets shows, with FFScouter connected: the only time target statuses are read or redrawn for (round 7 review). */
function targetsShowing() {
    return Boolean(page.app) && readsTargetStatuses({ tab: page.app.tab, ui: page.app.ui, hasFfs: Boolean(getKey(K.ffsKey)) });
}

function pumpTargetStatuses() {
    if (!targetsShowing() || !statusPlan.order.length) return;
    pumpStatuses({ order: statusPlan.order, open: statusPlan.open, readAt: (id) => statusPlan.readAt.get(id) || 0 });
}

/* The bot's /targets, /war and watch pings read Torn Eye (ids, names, levels, bands, win, HP kept; disclosed in Settings), only if you set up Discord. */
let eyeSyncAt = 0;
export const EYE_SYNC_EVERY_MS = 30 * 1000;

function syncEye(force = false) {
    if (!discordState() || !isVisible()) return;
    if (!force && Date.now() - eyeSyncAt < EYE_SYNC_EVERY_MS) return;
    // Fights still being worked out: the bot gets the bands once they are known (asked again in 2 s).
    if (fightsPending()) return;
    eyeSyncAt = Date.now();
    const row = (id, name, level, v, extra = {}) => ({ id, name: name || (v && v.name) || null, level: level || (v && v.level) || null, band: v ? v.band : 'none', win: v && v.forecast ? Math.round(v.forecast.pWin * 100) : null, keep: v && v.forecast && v.forecast.keep !== null && v.forecast.keep !== undefined ? Math.round(v.forecast.keep * 100) : null, ...extra });
    // The bot's /targets: the first 50 of the active list, in the one order (band, respect, HP kept, win).
    const rows = eyeRows();
    const bands = {};
    for (const r of rows) if (r.band) bands[r.id] = r.band;
    const fid = warFid();
    const members = war.membersFid === fid ? war.members || [] : [];
    const warRows = members.map((mm) => row(Number(mm.id), mm.name, mm.level, eyeView(Number(mm.id), { level: mm.level, name: mm.name }, { war: true })));
    for (const r of warRows) bands[r.id] = r.band;
    setTargetsForSync(rows.map((r) => row(r.id, r.name, r.level, r)), bands);
    const w = getWatch();
    const st = watchStates().players;
    const watchRows = w.list.map((x) => {
        const s = st[x.id] || {};
        return row(Number(x.id), x.name || s.name, x.level || s.level, eyeView(Number(x.id), { level: x.level || s.level, name: x.name || s.name, life: s.life || null }), { tag: x.tag || null });
    });
    setEyeForSync({ war: fid && warRows.length ? { factionId: fid, members: warRows } : null, watch: watchRows });
}

/*
 * What war mode worked out, for Torn's own war page (round 7): that page asks about nobody, and this page's estimates
 * live in this site's IndexedDB, so the enemy's bands go to shared storage as one small table. Written only when a
 * band changed, or every 10 minutes so its age stays true.
 */
let warBandsSig = '';
let warBandsAt = 0;
export const WAR_BANDS_REWRITE_MS = 10 * 60 * 1000;

function shareWarBands() {
    const fid = warFid();
    if (!fid || war.membersFid !== fid || !(war.members || []).length || !isVisible() || fightsPending()) return;
    const views = war.members.map((mm) => eyeView(Number(mm.id), { level: mm.level, name: mm.name, life: mm.life || null }, { war: true, later: true }));
    // A fight still being worked out: the table waits for it (asked again in 2 s).
    if (views.some((v) => !v || v.pending)) return;
    const table = warBandTable(views.map((v) => ({ id: v.id, band: v.band, win: v.forecast ? v.forecast.pWin * 100 : null, keep: v.forecast && v.forecast.keep !== null && v.forecast.keep !== undefined ? v.forecast.keep * 100 : null })), { fid });
    const sig = fid + '|' + JSON.stringify(table.p);
    if (sig === warBandsSig && Date.now() - warBandsAt < WAR_BANDS_REWRITE_MS) return;
    warBandsSig = sig;
    warBandsAt = Date.now();
    set(WAR_BANDS_KEY, table);
}

/*
 * The Next button on Torn's attack page (round 8, the owner's pick A): the list the Torn Eye tab shows (Targets in
 * its order and filters, or the war list) is handed over in shared storage as a small table, the first 40 rows. It is
 * written when it changes, at most every 5 s, and again after 10 minutes so its age stays true.
 */
const nextShare = { sig: '', at: 0, timer: null, table: null };
export const NEXT_SHARE_GAP_MS = 5000;
export const NEXT_SHARE_REWRITE_MS = 10 * 60 * 1000;

function shareNext(mode, rows) {
    // The newest list always replaces the one waiting to be written (a sort undone inside the 5 s must not be written).
    nextShare.table = nextTable(mode, rows, Date.now());
    const same = () => nextTableSig(nextShare.table) === nextShare.sig && Date.now() - nextShare.at < NEXT_SHARE_REWRITE_MS;
    if (nextShare.timer || same()) return;
    const write = () => {
        nextShare.timer = null;
        if (same()) return;
        nextShare.sig = nextTableSig(nextShare.table);
        nextShare.at = Date.now();
        set(EYE_NEXT_KEY, { ...nextShare.table, at: nextShare.at });
    };
    const wait = NEXT_SHARE_GAP_MS - (Date.now() - nextShare.at);
    if (wait <= 0) write();
    else nextShare.timer = setTimeout(write, wait);
}

/** Settings the report carries: the switches and limits, never a key, a faction or a player id. */
const REPORT_SETTINGS = ['timeFormat', 'pill', 'gymMarks', 'marketMarks', 'eyeChips', 'motion', 'budget', 'horizonDays', 'buyWindow', 'w3b', 'warReserve', 'boosterCapH', 'npcShops', 'npcShopsOff'];

/**
 * What Settings › Report a problem puts in its zip (core/report.js), read
 * when asked: the problem log, your stats and gym set-up, the saved plan,
 * the plan runs with their time, the money log's field names. No key, no
 * player id, no name.
 */
function reportData() {
    const s = get(K.userState, null);
    const state = s && s.api ? normalizeState(s.api, s.at) : null;
    const statics = get(K.userStatic, {}) || {};
    const m = pi.model && pi.model.ready ? pi.model : null;
    const plan = getPlan();
    const settings = getSettings();
    const pk = m ? m.pc.perks : null;
    const job = m && m.job ? { type: m.job.type, stars: m.job.stars, days: m.job.days, jp: m.job.jp } : null;
    const player =
        state && m
            ? {
                  stats: { ...m.pc.stats },
                  happyMax: state.happy.maximum,
                  energyMax: state.energy.maximum,
                  energyEvery: state.energy.interval,
                  gymId: state.gymId,
                  unlocked: [...m.pc.unlocked],
                  build: plan.build,
                  buildPicked: Boolean(plan.buildPicked),
                  goal: plan.goal || null,
                  specialRefills: state.specialRefills,
                  property: (statics.property && statics.property.property && statics.property.property.name) || null,
                  job,
                  perks: { mult: pk.mult, bliss: pk.bliss, happyLossMult: pk.happyLossMult, gymExpMult: pk.gymExpMult, canMult: pk.canMult, candyMult: pk.candyMult, consumableCdMult: pk.consumableCdMult, boosterCapExtraH: pk.boosterCapExtraH, lines: (pk.lines || []).map((l) => ({ source: l.source, stat: l.stat, pct: l.pct, text: l.text })), unknown: pk.unknown || [] },
              }
            : null;
    const nav = typeof navigator !== 'undefined' ? navigator : {};
    const mem = typeof performance !== 'undefined' && performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
    return {
        log: problemLogNow(),
        player,
        saved: pi.saved,
        moneyFields: (pageGet(K.moneyLog, null) || {}).fields || [],
        // Your books in names and counts (never an amount).
        ledger: ledgerShape((booksReport() || {}).ledger || null),
        statsHistory: archived(K.statsHistory, {}) || {},
        learn: { samples: ((archived('calibration', null) || {}).samples) || [], gymLog: ((pageGet(K.gymLog, null) || {}).lines) || [], fights: joinFights(pageGet(K.fightLog, []) || [], (get('myAttacks', null) || {}).list || [], archived(K.eyePredictions, []) || []), learned: get(K.learned, null) },
        state: {
            version: PI_BUILD_VERSION,
            build: BUILD,
            settings: Object.fromEntries(REPORT_SETTINGS.filter((k) => settings[k] !== undefined).map((k) => [k, settings[k]])),
            plan: { pickBy: plan.pickBy, strategy: plan.strategy, strategyPicked: Boolean(plan.strategyPicked), build: plan.build, goal: plan.goal || null, specialUse: plan.specialUse || 0, following: m ? m.strategy : null },
            runs: planRuns(),
            diagnostics: diagnostics(),
            keys: { torn: Boolean(getKey(K.apiKey)), tornRefused: Boolean(get(K.apiKeyDead, false)), full: Boolean(getKey(K.fullKey)), ffscouter: Boolean(getKey(K.ffsKey)), tornstats: Boolean(getKey(K.tsKey)), discord: Boolean(discordRaw()) },
            paused: isPaused(),
        },
        env: { userAgent: nav.userAgent || '', screen: typeof window !== 'undefined' && window.screen ? window.screen.width + 'x' + window.screen.height : '', cores: nav.hardwareConcurrency || null, memoryGB: nav.deviceMemory || null, pageHeapMB: mem },
    };
}

/**
 * The daily recalibration (round 8; the accountant: "recalibrate once per day, at Torn's reset; keep the button").
 * Your books are read first (the money log, Full key), so the day's cash is what the plan runs on. A failure is
 * said on the plan card and tried again half an hour later; the manual button always works.
 */
export function autoRecalibrate(now = Date.now()) {
    const s = get(K.userState, null);
    const m = pi.model;
    const d = autoRecalibrateDue({ planNow: planNowStored(), settings: getSettings(), last: get(K.autoRecal, null), stateAt: s ? s.at : null, busy: Boolean(pi.planBusy), stacking: Boolean(m && m.stacking), overdose: Boolean(m && m.overdose), now });
    if (!d.due) return null;
    const day = tornDayStart(now);
    set(K.autoRecal, { day, at: now, ok: null });
    return refreshMoneyLog({ force: true })
        .catch(() => null)
        .then(() => recalibratePlan({ auto: true }))
        .then(
            (saved) => set(K.autoRecal, { day, at: Date.now(), ok: Boolean(saved) }),
            (e) => {
                set(K.autoRecal, { day, at: Date.now(), ok: false, error: String((e && e.message) || e) });
                logError('The daily recalibration', e);
            },
        )
        .then(() => page.app && page.app.render(true));
}

/** A Create plan or Recalibrate click: the page shows it working, then the new plan (or why it couldn't). */
function runPlan(fn) {
    page.app.ui.planError = null;
    page.app.render(true);
    return fn()
        .catch((e) => {
            page.app.ui.planError = String((e && e.message) || e);
        })
        .finally(() => page.app.render(true));
}

function getCtx() {
    const settings = getSettings();
    // The plan followed today: the saved path's for this stretch (its switches happen on their dates) or your pick.
    const plan = { ...getPlan(), ...(pi.model && pi.model.ready && pi.model.strategy ? { strategy: pi.model.strategy } : {}) };
    const statics = get(K.userStatic, {}) || {};
    const prices = getPrices();
    const ffsState = get(K.ffsState, null);
    const S = STRATEGIES[plan.strategy] || STRATEGIES.steady;
    return {
        model: pi.model,
        version: PI_BUILD_VERSION,
        paused: isPaused(),
        settings,
        plan,
        statics,
        prices,
        compare: pi.model && pi.model.compare,
        history: archived(K.statsHistory, {}) || {},
        dayTotals: archived(K.dayTotals, {}) || {},
        gymProgress: get(K.gymProgress, null),
        calibration: archived('calibration', null),
        gymLog: pageGet(K.gymLog, null),
        // The plan's lines, read by time (core/planline.js): Progress, the Plan card, Home.
        planLines: readLines(pageGet(K.planLine, null)),
        receipts: archived(K.receipts, null),
        priceHistory: archived(K.priceHistory, null),
        flags: { hasKey: Boolean(getKey(K.apiKey)), keyDead: Boolean(get(K.apiKeyDead, false)), hasFfs: Boolean(getKey(K.ffsKey)), ffsDead: Boolean(ffsState && ffsState.registered === false), hasTs: Boolean(getKey(K.tsKey)) },
        keyProblem: keyProblem({ hasKey: Boolean(getKey(K.apiKey)), dead: Boolean(get(K.apiKeyDead, false)), stateError: get(K.stateError, null), keyInfo: statics.keyInfo || null }),
        planLine: S.short + ' · ' + ((pi.model && pi.model.build && pi.model.build.name) || 'Balanced') + (plan.createdAt ? ', since ' + new Date(plan.createdAt).toISOString().slice(0, 10) : ''),
        fullKey: fullKeyView(),
        sig: [JSON.stringify(settings), JSON.stringify(plan), JSON.stringify(get(K.worker, null)), JSON.stringify(get(K.fullKeyState, null)), (pageGet(K.moneyLog, null) || {}).at || 0, getKey(K.fullKey) ? 1 : 0, Object.values(prices).map((p) => p.at).join(','), statics.perksAt || 0, statics.inventoryAt || 0, statics.keyInfoAt || 0, getKey(K.apiKey) ? 1 : 0, get(K.apiKeyDead, false) ? 1 : 0, getKey(K.ffsKey) ? 1 : 0, getKey(K.tsKey) ? 1 : 0, JSON.stringify(get(K.stateError, null)), readLines(pageGet(K.planLine, null)).map((l) => l.at).join(','), JSON.stringify(get(K.stacking, null)), JSON.stringify(get(K.overdose, null))].join('|'),
        setSettings: (p) => {
            setSettings(p);
            refresh();
            page.app.render(true);
        },
        setPlan: (p) => {
            const { strategy, strategyPicked, ...rest } = p;
            // Another of the saved plans: followed at once, nothing worked out again (Progress's line follows it). A plan
            // saved without a path (before round 6): its recommended one is the saved plan itself. With a path
            // (round 8), every single plan is followed the whole way, the best of them too; `followPath` goes back.
            const rec = pi.saved && pi.saved.rec ? pi.saved.rec.recommended : null;
            const hasPath = Boolean(pi.saved && pi.saved.year && pi.saved.year.segments && pi.saved.year.segments.length);
            if (strategy !== undefined && strategy === rec && !hasPath) followPath();
            else if (strategy !== undefined && (strategy !== ((pi.model && pi.model.strategy) || getPlan().strategy) || !getPlan().strategyPicked)) followStrategy(strategy);
            // Build, goal, the Plan rule, special refills: kept for the next Create plan or Recalibrate (a click).
            if (Object.keys(rest).length) setPlan({ ...getPlan(), ...rest });
            refresh();
            page.app.render(true);
        },
        // Back to the saved path (round 8: "Use the path").
        followPath: () => {
            followPath();
            refresh();
            page.app.render(true);
        },
        // Create plan (1, 3, 6 or 12 months) and Recalibrate: the only things that work a plan out (round 6).
        createPlan: (months) => runPlan(() => createPlan({ months })),
        recalibratePlan: () => runPlan(() => recalibratePlan()),
        // The Plan card's Cancel while a plan is being worked out: nothing is saved, the old plan stays.
        cancelPlan: () => cancelPlan(),
        // Home's "I'm stacking" (a chain) and Resume, which recalibrates at once like Recalibrate (round 7).
        startStacking: () => {
            page.app.ui.homeReplan = false;
            startStacking();
            page.app.render(true);
        },
        resumeStacking: () => {
            page.app.ui.homeReplan = true;
            return runPlan(() => resumeTraining());
        },
        // Home's "Rehab done · recalibrate" (an overdose): the steps come back and the plan is recalibrated, like Resume.
        endOverdose: () => {
            page.app.ui.homeReplan = true;
            return runPlan(() => overdoseDone());
        },
        wantPrices: (ids, slim = []) => {
            if (isVisible()) setTimeout(() => loadPrices(ids, slim).catch(() => {}), 0);
        },
        saveTornKey,
        saveFullKey: async (v) => {
            const r = await saveFullKey(v);
            // The answer stays on screen through the redraw that follows (the new key changes the page).
            page.app.ui.fullKeyMsg = r;
            refresh();
            page.app.render(true);
            return r;
        },
        forgetFullKey: () => {
            page.app.ui.fullKeyMsg = null;
            forgetFullKey();
            refresh();
            page.app.render(true);
        },
        saveFfsKey,
        saveTsKey,
        revealKey: (name) => getKey(name),
        clearGroup: (g) => {
            // Forget keys also removes your key, plan and pings from the Pumping Iron service (the ToS promise).
            if (g === 'keys' && discordRaw()) {
                forgetDiscord()
                    .catch(() => {})
                    .finally(() => {
                        clearGroup(g);
                        refresh();
                        page.app.render(true);
                    });
                return;
            }
            if (g === 'eye') clearEye();
            if (g === 'plan') {
                pi.saved = null;
                forgetSavedPlan().catch(() => {});
            }
            // The webpage's own copy (older history, webpage-only data) goes with GM's.
            clearArchived(DATA_GROUPS[g] || []);
            if (g === 'eye') clearArchived([TARGETS_KEY]);
            if (g === 'prices') clearLocalPrices();
            clearGroup(g);
            refresh();
            page.app.render(true);
        },
        diagnostics,
        logError,
        // Settings › Report a problem: the zip's data, read when the section is drawn or the button pressed.
        report: {
            data: reportData,
            clearLog: () => {
                clearProblemLog();
                logAction('Report downloaded or log cleared');
            },
        },
        discord: {
            state: discordRaw,
            connect: (f) => connectDiscord(f, pi.model),
            test: testDiscord,
            forget: forgetDiscord,
            linkedId: linkedDiscordId,
            linkCode: linkDiscord,
            login: (o) => loginDiscord(pi.model, o),
            cancel: cancelLogin,
            setupUrl: WORKER_SETUP_URL,
        },
        // The Ledger tab: your books, and a read of the money log now (it is read by itself every 6 hours).
        // The plan's own recalibration, once a day: its last try (the plan card says when, or why it failed).
        autoRecal: get(K.autoRecal, null),
        books: () => booksReport(),
        readBooks: () => {
            page.app.ui.ledgerReading = true;
            page.app.ui.ledgerError = null;
            page.app.render(true);
            return refreshMoneyLog({ force: true })
                .then(() => refresh())
                .catch((error) => {
                    page.app.ui.ledgerError = String((error && error.message) || error);
                    logError('Reading your money log', error);
                })
                .then(() => {
                    page.app.ui.ledgerReading = false;
                    page.app.render(true);
                });
        },
        dev: {
            data: () => ({ samples: ((archived('calibration', null) || {}).samples) || [], gymLog: ((pageGet(K.gymLog, null) || {}).lines) || [], fights: joinFights(pageGet(K.fightLog, []) || [], (get('myAttacks', null) || {}).list || [], archived(K.eyePredictions, []) || []), learned: get(K.learned, null), ledger: ledgerShape((booksReport() || {}).ledger || null), version: PI_BUILD_VERSION }),
            unlocked: () => Boolean(get(K.devUnlocked, false)),
            setUnlocked: (v) => (v ? set(K.devUnlocked, true) : del(K.devUnlocked)),
            log: () => pageGet(K.learnLog, []) || [],
            // The money log by type with its field names (round 7, C.0), and when it was read.
            moneyFields: () => ({ at: (pageGet(K.moneyLog, null) || {}).at || null, list: (pageGet(K.moneyLog, null) || {}).fields || [] }),
            // Your books (round 7, R7.5): the ledger by account, the one-offs, what is not sorted, the reconciliation.
            books: () => booksReport(),
            sizes: () => Object.fromEntries(['calibration', K.learned, K.learnLog, K.fightLog, K.eyePredictions, K.prices, K.priceHistory, K.statsHistory].map((k) => [k, JSON.stringify(get(k, null) || '').length])),
        },
        eye: {
            rows: eyeRows,
            /** How many wait in the quiet reserve behind the active list. */
            reserve: () => eyeLists().reserve.length,
            stored: () => pageGet(TARGETS_KEY, null),
            load: (params) => loadTargets(params).catch(() => {}),
            /** The reserve ran low: one more ask, quietly. */
            refill: () => refillQuietly().catch(() => {}),
            loading: () => page.eye.loading,
            error: () => page.eye.error,
            sources: () => ({ fights: ((get('myAttacks', null) || {}).list || []).length, ffsFree: page.ffs ? page.ffs.stats().remaining : 60, gear: page.eye.gear }),
            view: (id, extra, o) => eyeView(id, extra, o),
            attacks: () => (get('myAttacks', null) || {}).list || [],
            /** The list a draw shows, in its order (Targets or War): handed to Torn's attack page for its Next button. */
            shown: shareNext,
            /** The chain counter's two sides (chain mode): {mine, enemy: {fid, name, raw}|null}. */
            chains: () => chainsNow(),
            /** Who you hit lately (your attacks and the attack pages you opened): Map id → {kind, at, result}. */
            hits: () => ownHits((getShared('myAttacks', null) || {}).list || [], getShared(K.eyePredictions, []) || [], Date.now()),
            statuses: {
                /** The rows on screen and every listed row, in order (each draw of Targets). */
                show: showStatuses,
                /** An Attack button pressed on the list: that player is asked first. */
                attack: (id) => {
                    statusPlan.clicked.set(Number(id), Date.now());
                    statusPlan.order = statusOrder({ open: [id], all: statusPlan.order });
                    statusPlan.open.add(Number(id));
                    pumpTargetStatuses();
                },
                /** Whether statuses are being read now (a key, not paused): else a row with none says "—", not "checking". */
                active: () => Boolean(getKey(K.apiKey)) && !get(K.apiKeyDead, false) && !isPaused(),
            },
            updatedAt: () => (pageGet(TARGETS_KEY, null) || {}).at || null,
            params: () => (pageGet(TARGETS_KEY, null) || {}).params || null,
            war: {
                state: () => {
                    const fid = warFid();
                    return { fid, manual: war.manual, name: warName(fid), enemies: war.enemies, myFaction: war.myFaction === undefined ? myFactionId() : war.myFaction, warsLoading: war.warsLoading, members: war.membersFid === fid ? war.members : [], early: war.membersFid === fid ? war.early : new Set(), loading: war.loading, error: war.error, ask: warAskNow() };
                },
                /** The answer to "Termed war / med-out deal?" for this war: true, false, or null to be asked again. */
                termed: (v) => {
                    const kept = warAskNow();
                    if (!kept) return;
                    set(WAR_ASK_KEY, { key: kept.key, autoAt: kept.autoAt, termed: v === true || v === false ? v : null });
                    page.app.render(true);
                },
                /** Another faction by id (kept until "Back to our war"). */
                watch: (fid) => {
                    war.manual = fid;
                    war.at = 0;
                    setSettings({ warFaction: fid });
                    pollWarTab();
                    page.app.render(true);
                },
                /** One of your faction's wars, when there are several. */
                pick: (fid) => {
                    war.pick = fid;
                    war.at = 0;
                    warModeCheck();
                    pollWarTab();
                    page.app.render(true);
                },
                auto: () => {
                    war.manual = null;
                    war.at = 0;
                    setSettings({ warFaction: null });
                    warModeCheck();
                    pollWarTab();
                    page.app.render(true);
                },
            },
            watch: {
                state: () => ({ list: getWatch().list, states: watchStates().players, flights: flightsSeen(), offers: watchOffersNow() }),
                isWatched: (id) => isWatched(watchNow(), id),
                toggle: (p) => {
                    watchMemo = null;
                    return toggleWatch({ id: Number(p.id), name: p.name || null, level: p.level || null, tag: p.tag });
                },
                tag: (id, tag) => setWatchTag(id, tag),
                remove: (id) => (isWatched(getWatch(), id) ? toggleWatch({ id }) : null),
                dismiss: (id) => dismissWatchOffer(id),
            },
        },
    };
}

export function bootAppPage({ renderers = {} } = {}) {
    page.app = new PiApp({ getCtx, renderers: { eye: renderEye, ...renderers }, getUpdated: () => (get(K.userState, null) || {}).at || null });
    // The API lanes: Torn Eye's calls go first while its tab is open (War mode: the war read first), prices while Buy is.
    pi.focusOf = () => ({ focus: page.app.tab === 'eye' ? 'eye' : page.app.tab === 'buy' ? 'prices' : null, war: page.app.tab === 'eye' && page.app.ui.eyeMode === 'war' });
    window.addEventListener('hashchange', () => beatFocus());
    beatFocus();
    onEye(() => {
        gearCount().then((n) => (page.eye.gear = n));
        page.app.render(true);
    });
    gearCount().then((n) => (page.eye.gear = n));
    // A status answered: a row on screen redraws at once; one on another page at most every 5 s (its counts and the
    // progress line), so a background pass never redraws what you're not looking at more than that.
    let statusDrawAt = 0;
    let statusDrawTimer = null;
    onStatus((id) => {
        // Only the Targets view shows statuses: War, Watched and the other tabs aren't redrawn for them (round 7 review).
        if (!targetsShowing()) return;
        if (statusPlan.page.has(Number(id))) {
            statusDrawAt = Date.now();
            page.app.render(true);
            return;
        }
        if (statusDrawTimer) return;
        statusDrawTimer = setTimeout(() => {
            statusDrawTimer = null;
            statusDrawAt = Date.now();
            if (targetsShowing()) page.app.render(true);
        }, Math.max(0, 5000 - (Date.now() - statusDrawAt)));
    });
    loadStatuses().catch(() => {});
    page.app.mount();
    // Torn Eye works only while its tab is open (owner, round 6): the targets' estimates are asked for when it opens.
    let eyeOpen = false;
    const eyeTab = () => {
        const open = page.app.tab === 'eye';
        if (open && !eyeOpen) {
            const kept = storedTargets();
            if (kept.length) wantPlayers(kept.map((x) => x.playerId));
            // At war by the last read of your faction's wars (a recent one): the tab opens on War (round 8). An older
            // read waits for the one this opening starts.
            const was = page.app.ui.eyeMode;
            if (Date.now() - (Number((get('eyeWarAuto', null) || {}).at) || 0) < 3 * OWN_WARS_POLL_MS) warModeCheck();
            if (page.app.ui.eyeMode !== was) page.app.render(true);
        }
        eyeOpen = open;
    };
    window.addEventListener('hashchange', eyeTab);
    // A click on the tab starts its reads at once (the tab bar changes no hash event; the 2 s check below was the only start).
    page.app.onTab = eyeTab;
    loadArchives().then(eyeTab).catch(() => {});
    // Torn Eye gets ready quietly (the owner, round 7): once the stored targets, the eye cache and your stats are in,
    // their fights are worked out while the page is idle. Local numbers only: nothing is asked unless the tab is open.
    let warmed = false;
    const warm = () => {
        if (warmed || page.app.tab === 'eye' || !archivesReady()) return;
        // Only the kept targets (the active list and the reserve, at most 200): an older 600 list is cut first.
        const kept = storedTargets();
        if (!kept.length) return;
        warmed = warmFights(kept.map((x) => ({ id: x.playerId, extra: { level: x.level, name: x.name } })));
    };
    Promise.all([loadArchives(), gearCount()]).then(() => setTimeout(warm, 1500)).catch(() => {});
    onModel(() => warm());
    onModel(() => page.app.render());
    // A plan being worked out: its card's bar and words follow the run without a redraw.
    onPlanProgress((busy) => page.app.planProgress(busy));
    // The webpage keeps the older history and its own data in its IndexedDB (GM stays small for Torn's pages).
    loadArchives()
        .then(() => {
            refresh();
            page.app.render(true);
            return drainArchives();
        })
        .catch(() => {});
    setInterval(() => {
        if (isVisible()) drainArchives().catch(() => {});
    }, 10 * 60 * 1000);
    loadLocalPrices().then(() => page.app.render(true)).catch(() => {});
    for (const k of [K.prices, K.settings, K.plan, K.userStatic, K.stateError, K.apiKeyDead]) gmOnChange(k, () => page.app.render());
    // The watch list is changed from Torn's pages too (☆ on a profile or the attack page) and read there.
    gmOnChange('eyeWatch', () => page.app.tab === 'eye' && page.app.render(true));
    // An attack page opened on Torn, or your attacks read again: the rows of the players you just hit grey at once.
    for (const k of [K.eyePredictions, 'myAttacks']) gmOnChange(k, () => page.app.tab === 'eye' && page.app.render(true));
    onPauseChange(() => page.app.render(true));
    // War mode: a faction picked by id stays until "Back to our war"; otherwise your faction's war, found by itself.
    war.manual = getSettings().warFaction || null;
    const auto = get('eyeWarAuto', null);
    if (auto && Array.isArray(auto.enemies) && auto.myFaction === myFactionId()) war.enemies = auto.enemies;
    setInterval(() => {
        // Nothing of Torn Eye's runs unless its tab is open (owner, round 6: it only runs on the Torn Eye tab).
        eyeTab();
        if (page.app.tab !== 'eye') return;
        // A target you hit is out of the stored list (the draw already leaves it out); a low reserve then refills.
        dropHitTargets();
        pollOwnWars().catch(() => {});
        pollWarTab().catch(() => {});
        pollEnemyChain().catch(() => {});
        // The Watched view reads its players every 60 s while it shows (the war list just read costs nothing).
        if (page.app.ui.eyeMode === 'watched') pollWatch({ members: war.members }).catch(() => {});
        syncEye();
        shareWarBands();
        pumpTargetStatuses();
        // An attack page opened 3 min ago: your attacks once more, so the players you just hit grey (round 7 review).
        attacksAfterOpen().catch(() => {});
    }, 2000);
    // A Log in with Discord that was under way when the page reloaded: keep waiting for it.
    setTimeout(() => {
        const p = resumeLogin(pi.model);
        if (p) p.then((r) => { page.app.ui.discordResult = { ok: r.ok, text: r.text }; page.app.render(true); }).catch(() => {});
    }, 1500);
    // Auto mode's money log (Full key): at most every 6 hours, visible tab only.
    const moneyLog = () => {
        if (isVisible()) refreshMoneyLog().then((r) => { if (r) refresh(); }).catch(() => {});
    };
    setTimeout(moneyLog, 5000);
    setInterval(moneyLog, 10 * 60 * 1000);
    // The plan recalibrates by itself once a Torn day (round 8), from this page, where the whole plan is kept: at
    // Torn's reset when it is open (a tab you are not looking at too), else the first time it is opened that day.
    setTimeout(autoRecalibrate, 15000);
    setInterval(autoRecalibrate, 60 * 1000);
    page.app.render(true);
    return page.app;
}
