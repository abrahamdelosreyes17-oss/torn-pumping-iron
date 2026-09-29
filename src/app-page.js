/*
 * The webpage's wiring: what each tab can read and do. Prices are fetched
 * only for items the Buy list needs (plus a few tracked ones), at most once
 * every 5 minutes, and only while this tab is visible.
 */

import { gmOnChange } from './platform/gm.js';
import { K, get, set, del, getKey, setKey, getSettings, setSettings, getPlan, setPlan, clearGroup } from './platform/store.js';
import { pi, tornClient, refresh, onModel, isVisible, nudgeFeed, TORN_PER_MINUTE } from './runtime.js';
import { PiApp } from './ui/app/app.js';
import { fetchKeyInfo, fetchItemMarket, fetchPointsMarket, fetchFactionMembers, keyIsEnough } from './api/torn.js';
import { outEarly, memberState } from './core/eye/war.js';
import { W3bClient, fetchW3bListings } from './api/w3b.js';
import { makeFfsClient, checkFfsKey, fetchFfsTargets } from './api/ffscouter.js';
import { renderEye } from './ui/app/eye-tab.js';
import { wantPlayers, eyeView, onEye, gearCount, clearEye } from './eye-service.js';
import { discordState, connectDiscord, testDiscord, forgetDiscord, linkedDiscordId, linkDiscord, setTargetsForSync } from './discord.js';
import { WORKER_SETUP_URL } from './api/worker.js';
import { tabWindow } from './platform/tab-window.js';
import { listingsFromItemMarket, listingsFromW3b, listingsFromPoints } from './core/market.js';
import { recordPrice, average7, dailyLows, readPriceHistory } from './core/history.js';
import { parsePerks } from './core/perks.js';
import { POINTS } from './core/items.js';
import { STRATEGIES } from './core/strategies.js';
import { redactKey } from './api/client.js';
import { keyProblem } from './ui/key-status.js';
import { isPaused, onPauseChange } from './turns.js';
import { joinFights } from './core/learndata.js';
import { maybeLearn } from './runtime.js';

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
    if (!page.ffs) page.ffs = makeFfsClient({ getKey: () => getKey(K.ffsKey), isVisible, loadShared: () => get('ffsWindow', {}), saveShared: (s) => set('ffsWindow', s) });
    return page.ffs;
}

/** Fetch listings for the items the Buy list shows, if older than 5 minutes. */
export async function loadPrices(ids) {
    // Nothing from Torn or TornW3B while Torn Trading runs (the two take turns).
    if (!getKey(K.apiKey) || isPaused()) return;
    const prices = { ...(get(K.prices, {}) || {}) };
    const now = Date.now();
    const due = [...new Set(ids.map(String))].filter((id) => !page.loading.has(id) && !(prices[id] && now - (prices[id].at || 0) < PRICE_FRESH_MS));
    if (!due.length) return;
    for (const id of due) page.loading.add(id);
    let hist = readPriceHistory(get(K.priceHistory, null));
    for (const id of due) {
        // Paused mid-load: keep what's stored, ask again once Torn Trading stops.
        if (isPaused()) {
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
                page.loading.delete(id);
                continue;
            }
            row.error = redactKey(String((error && error.message) || error), getKey(K.apiKey));
        }
        const cheapest = row.listings.length ? Math.min(...row.listings.map((l) => l.price)) : null;
        if (cheapest) hist = recordPrice(hist, id, Date.now(), cheapest);
        const avg = average7(hist, id, Date.now());
        row.avg7 = avg.days >= 2 ? avg.avg : null;
        row.lows7 = dailyLows(hist, id, Date.now(), 7);
        prices[id] = row;
        page.loading.delete(id);
    }
    set(K.priceHistory, hist);
    const merged = { ...(get(K.prices, {}) || {}), ...Object.fromEntries(due.filter((id) => prices[id] && prices[id].at >= now).map((id) => [id, prices[id]])) };
    set(K.prices, merged);
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
        ffs: page.ffs ? page.ffs.stats().usedLastMinute : 0,
        w3b,
        lastError: err ? new Date(err.at).toISOString().slice(11, 16) + ' ' + err.message : null,
        unknownPerks: parsePerks(statics.perks || {}).unknown.length,
        version: PI_BUILD_VERSION,
        historyDays: Object.keys(get(K.statsHistory, {}) || {}).length,
        priceItems: Object.keys((readPriceHistory(get(K.priceHistory, null)) || {}).items || {}).length,
        eyeLine: 'targets, estimates and gear for ' + page.eye.gear + ' player' + (page.eye.gear === 1 ? '' : 's'),
        learnLine: (((get('calibration', null) || {}).samples) || []).length + ' sessions · ' + (get(K.fightLog, []) || []).length + ' fights · what it learned',
    };
}

/** Targets for the Torn Eye tab: FFScouter's list, estimated against you. */
async function loadTargets(params) {
    if (!getKey(K.ffsKey) || isPaused()) return;
    page.eye.loading = true;
    page.eye.error = null;
    page.app.render(true);
    try {
        const list = await fetchFfsTargets(ffsClient(), { ...params, limit: 50 });
        set('eyeTargets', { at: Date.now(), params, list });
        wantPlayers(list.map((x) => x.playerId));
    } catch (error) {
        page.eye.error = String((error && error.message) || error);
    }
    page.eye.loading = false;
    page.app.render(true);
}

/* War mode on the webpage: the enemy faction read every 10 s while the Torn Eye tab shows War. */
const war = { fid: null, name: null, members: [], prev: null, early: new Set(), seen: new Map(), at: 0, loading: false, error: null, timer: null };

export const WAR_TAB_POLL_MS = 10000;

async function pollWarTab() {
    if (!war.fid || war.loading || !isVisible() || isPaused()) return;
    if (!page.app || page.app.tab !== 'eye' || (page.app.ui.eyeMode || 'targets') !== 'war') return;
    if (Date.now() - war.at < WAR_TAB_POLL_MS) return;
    war.loading = true;
    try {
        const members = await fetchFactionMembers(tornClient(), war.fid);
        const nowMs = Date.now();
        war.early = outEarly(war.members, members, Math.floor(nowMs / 1000));
        // When each flight was first seen: the landing estimate counts from it.
        for (const m of members) {
            const id = Number(m.id);
            const st = memberState(m);
            const desc = (m.status && m.status.description) || '';
            const cur = war.seen.get(id);
            if (st === 'traveling' || st === 'abroad') {
                if (!cur || cur.desc !== desc) war.seen.set(id, { desc, at: nowMs });
            } else war.seen.delete(id);
        }
        war.prev = war.members;
        war.members = members;
        war.error = null;
        wantPlayers(members.map((m) => Number(m.id)));
    } catch (error) {
        war.error = String((error && error.message) || error);
    }
    war.at = Date.now();
    war.loading = false;
    if (page.app) page.app.render(true);
}

function eyeRows() {
    const stored = get('eyeTargets', null);
    if (!stored) return [];
    const rows = stored.list.map((x) => ({ ...(eyeView(x.playerId, { level: x.level, name: x.name }) || { id: x.playerId, band: 'none' }), name: x.name, level: x.level, hospitalUntil: x.hospitalUntil, lastAction: x.lastAction, id: x.playerId }));
    // The bot's /targets and /war read Torn Eye's list and bands (only if you set up Discord; ids and bands only).
    if (discordState()) {
        const bands = {};
        for (const r of rows) if (r.band) bands[r.id] = r.band;
        for (const mm of war.members || []) {
            const v = eyeView(Number(mm.id), { level: mm.level, name: mm.name }, { war: true });
            if (v && v.band) bands[Number(mm.id)] = v.band;
        }
        setTargetsForSync(rows.filter((r) => r.band !== 'cant').map((r) => ({ id: r.id, name: r.name || null, level: r.level || null, band: r.band, win: r.forecast ? Math.round(r.forecast.pWin * 100) : null, keep: r.forecast && r.forecast.keep !== null ? Math.round(r.forecast.keep * 100) : null })), bands);
    }
    return rows;
}

function getCtx() {
    const settings = getSettings();
    const plan = getPlan();
    const statics = get(K.userStatic, {}) || {};
    const prices = get(K.prices, {}) || {};
    const ffsState = get(K.ffsState, null);
    const S = STRATEGIES[plan.strategy] || STRATEGIES.steady;
    return {
        model: pi.model,
        paused: isPaused(),
        settings,
        plan,
        statics,
        prices,
        compare: pi.model && pi.model.compare,
        history: get(K.statsHistory, {}) || {},
        dayTotals: get(K.dayTotals, {}) || {},
        gymProgress: get(K.gymProgress, null),
        calibration: get('calibration', null),
        planLine: get(K.planLine, null),
        flags: { hasKey: Boolean(getKey(K.apiKey)), keyDead: Boolean(get(K.apiKeyDead, false)), hasFfs: Boolean(getKey(K.ffsKey)), ffsDead: Boolean(ffsState && ffsState.registered === false), hasTs: Boolean(getKey(K.tsKey)) },
        keyProblem: keyProblem({ hasKey: Boolean(getKey(K.apiKey)), dead: Boolean(get(K.apiKeyDead, false)), stateError: get(K.stateError, null), keyInfo: statics.keyInfo || null }),
        planLine: S.short + ' · ' + ((pi.model && pi.model.build && pi.model.build.name) || 'Balanced') + (plan.createdAt ? ', since ' + new Date(plan.createdAt).toISOString().slice(0, 10) : ''),
        sig: [JSON.stringify(settings), JSON.stringify(plan), JSON.stringify(get(K.worker, null)), Object.values(prices).map((p) => p.at).join(','), statics.perksAt || 0, statics.inventoryAt || 0, statics.keyInfoAt || 0, getKey(K.apiKey) ? 1 : 0, get(K.apiKeyDead, false) ? 1 : 0, getKey(K.ffsKey) ? 1 : 0, getKey(K.tsKey) ? 1 : 0, JSON.stringify(get(K.stateError, null)), (get(K.planLine, null) || {}).key || ''].join('|'),
        setSettings: (p) => {
            setSettings(p);
            refresh();
            page.app.render(true);
        },
        setPlan: (p) => {
            setPlan({ ...getPlan(), ...p, createdAt: Date.now() });
            refresh();
            page.app.render(true);
        },
        wantPrices: (ids) => {
            if (isVisible()) setTimeout(() => loadPrices(ids).catch(() => {}), 0);
        },
        saveTornKey,
        saveFfsKey,
        saveTsKey,
        revealKey: (name) => getKey(name),
        clearGroup: (g) => {
            if (g === 'eye') clearEye();
            clearGroup(g);
            refresh();
            page.app.render(true);
        },
        diagnostics,
        discord: {
            state: discordState,
            connect: (f) => connectDiscord(f, pi.model),
            test: testDiscord,
            forget: forgetDiscord,
            linkedId: linkedDiscordId,
            linkCode: linkDiscord,
            setupUrl: WORKER_SETUP_URL,
        },
        dev: {
            data: () => ({ samples: ((get('calibration', null) || {}).samples) || [], fights: joinFights(get(K.fightLog, []) || [], (get('myAttacks', null) || {}).list || [], get(K.eyePredictions, []) || []), learned: get(K.learned, null) || maybeLearn(Date.now(), true), version: PI_BUILD_VERSION }),
            unlocked: () => Boolean(get(K.devUnlocked, false)),
            setUnlocked: (v) => (v ? set(K.devUnlocked, true) : del(K.devUnlocked)),
            log: () => get(K.learnLog, []) || [],
            sizes: () => Object.fromEntries(['calibration', K.learned, K.learnLog, K.fightLog, K.eyePredictions, K.prices, K.priceHistory, K.statsHistory].map((k) => [k, JSON.stringify(get(k, null) || '').length])),
        },
        eye: {
            rows: eyeRows,
            load: (params) => loadTargets(params).catch(() => {}),
            loading: () => page.eye.loading,
            error: () => page.eye.error,
            sources: () => ({ fights: ((get('myAttacks', null) || {}).list || []).length, ffsFree: page.ffs ? page.ffs.stats().remaining : 60, gear: page.eye.gear }),
            view: (id, extra, o) => eyeView(id, extra, o),
            attacks: () => (get('myAttacks', null) || {}).list || [],
            updatedAt: () => (get('eyeTargets', null) || {}).at || null,
            war: {
                state: () => ({ fid: war.fid, name: war.name, members: war.members, early: war.early, seen: new Map([...war.seen].map(([k, v]) => [k, v.at])), loading: war.loading, error: war.error }),
                watch: (fid) => {
                    war.fid = fid;
                    war.members = [];
                    war.seen.clear();
                    war.at = 0;
                    setSettings({ warFaction: fid });
                    pollWarTab();
                },
            },
        },
    };
}

export function bootAppPage({ renderers = {} } = {}) {
    page.app = new PiApp({ getCtx, renderers: { eye: renderEye, ...renderers }, getUpdated: () => (get(K.userState, null) || {}).at || null });
    onEye(() => {
        gearCount().then((n) => (page.eye.gear = n));
        page.app.render(true);
    });
    gearCount().then((n) => (page.eye.gear = n));
    const stored = get('eyeTargets', null);
    if (stored) setTimeout(() => wantPlayers(stored.list.map((x) => x.playerId)), 500);
    page.app.mount();
    onModel(() => page.app.render());
    for (const k of [K.prices, K.settings, K.plan, K.userStatic, K.stateError, K.apiKeyDead]) gmOnChange(k, () => page.app.render());
    onPauseChange(() => page.app.render(true));
    // War mode: the faction you last watched, read every 10 s while that view is open.
    war.fid = getSettings().warFaction || null;
    setInterval(() => pollWarTab().catch(() => {}), 2000);
    page.app.render(true);
    return page.app;
}
