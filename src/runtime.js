/*
 * What every tab shares at run time: the one Torn client (40/min across
 * tabs, visible only), the state feed, and the model every surface renders
 * from. Userscript-only; core/ and api/ stay plain modules.
 */

import { gmOnChange } from './platform/gm.js';
import { K, get, set, del, getKey, getSettings, getPlan } from './platform/store.js';
import { tabWindow } from './platform/tab-window.js';
import { makeTabId, LEADER_HEARTBEAT_MS } from './core/leader.js';
import { TornApiClient } from './api/client.js';
import { StateFeed } from './feed/state.js';
import { normalizeState, tornDayStart } from './core/bars.js';
import { buildModel, compareStrategies, playerContext, buildOf } from './core/model.js';
import { targetShares } from './core/plan.js';

export const pi = {
    tabId: makeTabId(),
    client: null,
    feed: null,
    model: null,
    compare: null,
    compareKey: '',
    listeners: [],
};

export function isVisible() {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export const storeApi = { get: (k, fb) => get(k, fb), set: (k, v) => set(k, v), del: (k) => del(k) };

/**
 * Our share of Torn's 100 calls a minute (per player, every tool together).
 * The trading script (NPC Arbitrage, Torn Bids) keeps its own count of up to
 * 30, so 40 here leaves room for both plus another tool. The plan needs ~2 a
 * minute; only Torn Eye sweeps and price loads come near it, and they queue.
 */
export const TORN_PER_MINUTE = 40;

/** The one Torn client every part of this tab uses: 40/min across tabs, visible only. */
export function tornClient() {
    if (pi.client) return pi.client;
    const win = tabWindow('apiWindow', pi.tabId, storeApi);
    pi.client = new TornApiClient({
        maxPerMinute: TORN_PER_MINUTE,
        // A key Torn refused (2, 13, 18) is not used again, by any part of any tab, until a new one is saved.
        getKey: () => (get(K.apiKeyDead, false) ? '' : getKey(K.apiKey)),
        loadWindow: () => win.load(),
        addToWindow: (at) => win.add(at),
        loadPause: () => get(K.apiPause, null),
        savePause: (p) => set(K.apiPause, p),
        isVisible,
        onDeadKey: () => set(K.apiKeyDead, true),
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

/**
 * Today's totals for Progress (gained vs planned, Xanax, refills), written
 * only when they change: one small GM write, not one a second.
 */
function recordDayTotals(m) {
    if (!m || !m.ready) return;
    const day = tornDayStart(m.now);
    const row = {
        gained: Math.round(m.gainedToday),
        planned: Math.round(m.plannedGain),
        xanax: m.done.filter((e) => e.kind === 'xanax' || e.kind === 'stack' || e.kind === 'hold').length,
        xanaxPlanned: m.strip.drug.xanaxPlanned,
        refills: m.strip.refill.free ? 0 : 1,
    };
    const all = get(K.dayTotals, {}) || {};
    if (JSON.stringify(all[day]) === JSON.stringify(row)) return;
    all[day] = row;
    const days = Object.keys(all).map(Number).sort((a, b) => a - b);
    while (days.length > 120) delete all[days.shift()];
    set(K.dayTotals, all);
}

export function refresh() {
    try {
        pi.model = currentModel();
        recordDayTotals(pi.model);
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

/** Ask the feed now (a new key was saved): no waiting for the next heartbeat. */
export function nudgeFeed() {
    if (!pi.feed) return;
    pi.feed.tick().catch(() => {});
    setTimeout(() => pi.feed.tick().catch(() => {}), 500);
}

export function onModel(fn) {
    pi.listeners.push(fn);
    if (pi.model) fn(pi.model);
}

export function startFeed() {
    pi.feed = new StateFeed({
        client: tornClient(),
        store: storeApi,
        tabId: pi.tabId,
        isVisible,
        nextStep: () => (pi.model && pi.model.next) || null,
        onState: () => refresh(),
        onError: (error) => {
            set(K.lastError, { at: Date.now(), where: 'feed', code: error && error.code, message: String((error && error.message) || error) });
            // This tab's own writes fire no change event here: redraw so the warning shows now.
            refresh();
        },
    });
    // Leaving the page hands the lead to another tab at once, instead of after the 10 s timeout.
    window.addEventListener('pagehide', () => {
        const rec = get(K.leader, null);
        if (rec && rec.id === pi.tabId) set(K.leader, { id: null, ts: 0 });
    });
    const tick = () => pi.feed.tick().catch(() => {});
    tick();
    setInterval(tick, LEADER_HEARTBEAT_MS);
    // The first heartbeat only claims the lead; confirm it half a second later instead of a whole heartbeat.
    setTimeout(tick, 500);
    // Coming back to a tab: take the lead and read at once, not at the next heartbeat.
    document.addEventListener('visibilitychange', () => {
        if (!isVisible()) return;
        tick();
        setTimeout(tick, 500);
    });
    // Follower tabs redraw when the leader stores a new state; everyone redraws each second for countdowns.
    gmOnChange(K.userState, refresh);
    gmOnChange(K.userStatic, refresh);
    gmOnChange(K.plan, refresh);
    gmOnChange(K.settings, refresh);
    gmOnChange(K.stateError, refresh);
    gmOnChange(K.apiKeyDead, refresh);
    // Countdowns tick by themselves every second; the model itself is worked out again every 5 s.
    setInterval(refresh, 5000);
    refresh();
}

