/*
 * The webpage's wiring: what each tab can read and do. Prices are fetched
 * only for items the Buy list needs (plus a few tracked ones), at most once
 * every 5 minutes, and only while this tab is visible.
 */

import { gmOnChange } from './platform/gm.js';
import { K, get, set, getKey, setKey, getSettings, setSettings, getPlan, setPlan, clearGroup } from './platform/store.js';
import { pi, tornClient, refresh, onModel, isVisible } from './runtime.js';
import { PiApp } from './ui/app/app.js';
import { fetchKeyInfo, fetchItemMarket, fetchPointsMarket, keyIsEnough } from './api/torn.js';
import { W3bClient, fetchW3bListings } from './api/w3b.js';
import { makeFfsClient, checkFfsKey } from './api/ffscouter.js';
import { tabWindow } from './platform/tab-window.js';
import { listingsFromItemMarket, listingsFromW3b, listingsFromPoints } from './core/market.js';
import { recordPrice, average7, dailyLows, readPriceHistory } from './core/history.js';
import { parsePerks } from './core/perks.js';
import { POINTS } from './core/items.js';
import { STRATEGIES } from './core/strategies.js';
import { redactKey } from './api/client.js';

/** How long fetched prices count as fresh. */
export const PRICE_FRESH_MS = 5 * 60 * 1000;

const page = { app: null, w3b: null, ffs: null, loading: new Set() };

function w3bClient() {
    if (!page.w3b) {
        const win = tabWindow('w3bWindow', pi.tabId, { get: (k, fb) => get(k, fb), set: (k, v) => set(k, v), del: (k) => set(k, null) });
        page.w3b = new W3bClient({ isVisible, addShared: (at) => win.add(at), loadShared: () => ({ recent: win.load(), cooldownUntil: get('w3bCooldown', 0) }), saveShared: (s) => set('w3bCooldown', s.cooldownUntil || 0) });
    }
    return page.w3b;
}

export function ffsClient() {
    if (!page.ffs) page.ffs = makeFfsClient({ getKey: () => getKey(K.ffsKey), isVisible, loadShared: () => get('ffsWindow', {}), saveShared: (s) => set('ffsWindow', s) });
    return page.ffs;
}

/** Fetch listings for the items the Buy list shows, if older than 5 minutes. */
async function loadPrices(ids) {
    if (!getKey(K.apiKey)) return;
    const prices = { ...(get(K.prices, {}) || {}) };
    const now = Date.now();
    const due = [...new Set(ids.map(String))].filter((id) => !page.loading.has(id) && !(prices[id] && now - (prices[id].at || 0) < PRICE_FRESH_MS));
    if (!due.length) return;
    for (const id of due) page.loading.add(id);
    let hist = readPriceHistory(get(K.priceHistory, null));
    for (const id of due) {
        const row = { at: Date.now(), listings: [], imAt: null, w3bAt: null, error: null };
        try {
            if (id === POINTS) {
                row.listings = listingsFromPoints(await fetchPointsMarket(tornClient()));
                row.imAt = Date.now();
            } else {
                row.listings = listingsFromItemMarket(await fetchItemMarket(tornClient(), id));
                row.imAt = Date.now();
                try {
                    const w = await fetchW3bListings(w3bClient(), id);
                    row.listings = row.listings.concat(listingsFromW3b(w).filter((l) => l.sellerId && l.price > 1));
                    row.w3bAt = Date.now();
                } catch {
                    // Bazaars are a bonus; the Item Market still answers.
                }
            }
        } catch (error) {
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
    const merged = { ...(get(K.prices, {}) || {}), ...Object.fromEntries(due.map((id) => [id, prices[id]])) };
    set(K.prices, merged);
    refresh();
    if (page.app) page.app.render(true);
}

async function saveTornKey(v) {
    if (!v) return { ok: false, text: 'Paste a key first.' };
    if (!/^[A-Za-z0-9]{16}$/.test(v)) return { ok: false, text: 'A Torn key is 16 letters and numbers.' };
    setKey(K.apiKey, v);
    set(K.userStatic, { ...(get(K.userStatic, {}) || {}), keyInfoAt: 0 });
    try {
        const info = await fetchKeyInfo(tornClient());
        const s = { ...(get(K.userStatic, {}) || {}), keyInfo: info, keyInfoAt: Date.now() };
        set(K.userStatic, s);
        const enough = keyIsEnough(info);
        if (enough === false) return { ok: false, text: 'Saved, but this is a ' + (info.type || 'low') + ' key: make a Limited one for stats and attacks.' };
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
        ffs: page.ffs ? page.ffs.stats().usedLastMinute : 0,
        w3b,
        lastError: err ? new Date(err.at).toISOString().slice(11, 16) + ' ' + err.message : null,
        unknownPerks: parsePerks(statics.perks || {}).unknown.length,
        version: PI_BUILD_VERSION,
        historyDays: Object.keys(get(K.statsHistory, {}) || {}).length,
        priceItems: Object.keys((readPriceHistory(get(K.priceHistory, null)) || {}).items || {}).length,
        eyeLine: 'estimates and gear seen',
    };
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
        settings,
        plan,
        statics,
        prices,
        compare: pi.model && pi.model.compare,
        history: get(K.statsHistory, {}) || {},
        dayTotals: get(K.dayTotals, {}) || {},
        gymProgress: get(K.gymProgress, null),
        calibration: get('calibration', null),
        flags: { hasKey: Boolean(getKey(K.apiKey)), keyDead: Boolean(get(K.apiKeyDead, false)), hasFfs: Boolean(getKey(K.ffsKey)), ffsDead: Boolean(ffsState && ffsState.registered === false), hasTs: Boolean(getKey(K.tsKey)) },
        planLine: S.short + ' · ' + ((pi.model && pi.model.build && pi.model.build.name) || 'Balanced') + (plan.createdAt ? ', since ' + new Date(plan.createdAt).toISOString().slice(0, 10) : ''),
        sig: [JSON.stringify(settings), JSON.stringify(plan), Object.values(prices).map((p) => p.at).join(','), statics.perksAt || 0, statics.inventoryAt || 0, statics.keyInfoAt || 0, getKey(K.apiKey) ? 1 : 0, get(K.apiKeyDead, false) ? 1 : 0, getKey(K.ffsKey) ? 1 : 0, getKey(K.tsKey) ? 1 : 0].join('|'),
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
            clearGroup(g);
            refresh();
            page.app.render(true);
        },
        diagnostics,
    };
}

export function bootAppPage({ renderers = {} } = {}) {
    page.app = new PiApp({ getCtx, renderers, getUpdated: () => (get(K.userState, null) || {}).at || null });
    page.app.mount();
    onModel(() => page.app.render());
    for (const k of [K.prices, K.settings, K.plan, K.userStatic]) gmOnChange(k, () => page.app.render());
    page.app.render(true);
    return page.app;
}
