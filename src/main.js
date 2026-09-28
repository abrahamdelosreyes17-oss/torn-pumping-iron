/*
 * Wiring. The only file that knows it is a userscript; core/ and api/ are
 * plain modules tested under node.
 *
 * Two entry points share it:
 *   - every Torn page: the state feed (one visible leader tab), the overlay
 *     pill, the marks on the page being viewed, and Torn Eye chips;
 *   - the webpage (GitHub Pages app.html): the full tabs, drawn over the
 *     placeholder the page shows without the script.
 */

import { gmOnChange, gmMenu, gmOpenTab } from './platform/gm.js';
import { K, get, set, getKey, getSettings, getPlan } from './platform/store.js';
import { tabWindow } from './platform/tab-window.js';
import { makeTabId, LEADER_HEARTBEAT_MS } from './core/leader.js';
import { TornApiClient } from './api/client.js';
import { StateFeed } from './feed/state.js';
import { normalizeState } from './core/bars.js';
import { buildModel, compareStrategies, playerContext, buildOf } from './core/model.js';
import { targetShares } from './core/plan.js';
import { detectPage, isAppPageUrl, isTornHost, APP_PAGE_URL } from './sources/route.js';

const pi = {
    tabId: makeTabId(),
    client: null,
    feed: null,
    model: null,
    compare: null,
    compareKey: '',
    listeners: [],
};

function isVisible() {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

const storeApi = { get: (k, fb) => get(k, fb), set: (k, v) => set(k, v), del: (k) => set(k, null) };

/** The one Torn client every part of this tab uses: 70/min across tabs, visible only. */
function tornClient() {
    if (pi.client) return pi.client;
    const win = tabWindow('apiWindow', pi.tabId, storeApi);
    pi.client = new TornApiClient({
        getKey: () => getKey(K.apiKey),
        loadWindow: () => win.load(),
        addToWindow: (at) => win.add(at),
        loadPause: () => get(K.apiPause, null),
        savePause: (p) => set(K.apiPause, p),
        isVisible,
    });
    return pi.client;
}

/** Re-run the strategy comparison at most once per Torn hour or when inputs change. */
function comparisonFor(state, statics, plan, settings) {
    const pc = playerContext(state, statics, { unlockedKnown: get(K.unlocked, null) });
    const shares = targetShares(plan, pc.stats, buildOf(plan.build).shares);
    const key = [Math.floor(Date.now() / 3600e3), plan.build, plan.goal ? JSON.stringify(plan.goal) : '', settings.horizonDays, state.gymId, state.happy.maximum, pc.perks.bliss, Math.round(pc.stats.str / 1000)].join('|');
    if (key !== pi.compareKey) {
        pi.compare = compareStrategies({ state, pc, shares, settings, prices: get(K.prices, {}) || {} });
        pi.compareKey = key;
    }
    return pi.compare;
}

/** The model every surface renders from. */
export function currentModel(now = Date.now()) {
    const s = get(K.userState, null);
    const state = s && s.api ? normalizeState(s.api, s.at) : null;
    if (!state) return { ready: false, hasKey: Boolean(getKey(K.apiKey)), keyDead: Boolean(get(K.apiKeyDead, false)) };
    const statics = get(K.userStatic, {}) || {};
    const plan = getPlan();
    const settings = getSettings();
    const compare = comparisonFor(state, statics, plan, settings);
    return buildModel({ state, statics, plan, settings, log: get(K.dayLog, []) || [], history: get(K.statsHistory, {}) || {}, prices: get(K.prices, {}) || {}, compare, gymProgress: get(K.gymProgress, null), unlockedKnown: get(K.unlocked, null), now });
}

function refresh() {
    try {
        pi.model = currentModel();
    } catch (error) {
        set(K.lastError, { at: Date.now(), where: 'model', message: String((error && error.message) || error) });
        return;
    }
    for (const fn of pi.listeners) {
        try {
            fn(pi.model);
        } catch (error) {
            set(K.lastError, { at: Date.now(), where: 'render', message: String((error && error.message) || error) });
        }
    }
}

export function onModel(fn) {
    pi.listeners.push(fn);
    if (pi.model) fn(pi.model);
}

function startFeed() {
    pi.feed = new StateFeed({
        client: tornClient(),
        store: storeApi,
        tabId: pi.tabId,
        isVisible,
        nextStep: () => (pi.model && pi.model.next) || null,
        onState: () => refresh(),
        onError: (error) => set(K.lastError, { at: Date.now(), where: 'feed', code: error && error.code, message: String((error && error.message) || error) }),
    });
    const tick = () => pi.feed.tick().catch(() => {});
    tick();
    setInterval(tick, LEADER_HEARTBEAT_MS);
    // Follower tabs redraw when the leader stores a new state; everyone redraws each second for countdowns.
    gmOnChange(K.userState, refresh);
    gmOnChange(K.userStatic, refresh);
    gmOnChange(K.plan, refresh);
    gmOnChange(K.settings, refresh);
    setInterval(refresh, 1000);
    refresh();
}

function menus() {
    gmMenu('Open Pumping Iron', () => gmOpenTab(APP_PAGE_URL));
}

export function boot() {
    const href = typeof location !== 'undefined' ? location.href : '';
    const where = isAppPageUrl(href) ? 'app' : detectPage(href);
    set('lastBoot', { at: Date.now(), where, version: PI_BUILD_VERSION });
    if (typeof document !== 'undefined' && document.documentElement) document.documentElement.setAttribute('data-pi-booted', where);
    if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body) return;
    menus();
    startFeed();
    // Off torn.com (the harness), expose the model for checks. On torn.com the sandbox keeps it private anyway.
    if (!isTornHost(href)) window.__pi = { model: () => pi.model, refresh, feed: () => pi.feed };
}
