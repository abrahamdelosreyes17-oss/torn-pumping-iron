/*
 * Typed settings and saved data over gm.js (prefix pumpingIron.v1.). Small
 * values live in GM storage, which every tab sees and gets change events
 * for; big, one-page data (Torn Eye estimates, captured gear) goes to
 * IndexedDB so it doesn't slow every Torn page (the trading app's lesson).
 */

import { gmGet, gmSet, gmDel, gmGetShared } from './gm.js';
import { idbGet, idbSet } from './idb.js';
import { slimPriceRow } from '../core/market.js';

export const K = {
    apiKey: 'apiKey',
    apiKeyDead: 'apiKeyDead',
    keyInfo: 'keyInfo',
    ffsKey: 'ffsKey',
    ffsState: 'ffsState',
    tsKey: 'tsKey',
    // Auto mode: the Full key (only for your money log) and what it read.
    fullKey: 'fullKey',
    fullKeyState: 'fullKeyState',
    moneyLog: 'moneyLog',
    worker: 'worker',
    settings: 'settings',
    plan: 'plan',
    userState: 'userState',
    userStatic: 'userStatic',
    dayLog: 'dayLog',
    statsHistory: 'statsHistory',
    dayTotals: 'dayTotals',
    receipts: 'receipts',
    priceHistory: 'priceHistory',
    prices: 'prices',
    recheck: 'recheck',
    unlocked: 'unlockedGyms',
    gymProgress: 'gymProgress',
    gymSession: 'gymSession',
    leader: 'leader',
    overlayPos: 'overlayPos',
    overlayCollapsed: 'overlayCollapsed',
    apiPause: 'apiPause',
    lastError: 'lastError',
    stateError: 'stateError',
    planLine: 'planLine',
    learned: 'learned',
    learnLog: 'learnLog',
    fightLog: 'fightLog',
    eyePredictions: 'eyePredictions',
    devUnlocked: 'devUnlocked',
    skipped: 'skippedSteps',
    // Your real Xanax cooldowns (core/drugcd.js).
    xanaxCds: 'xanaxCds',
    // The saved plan's small part that Torn's pages and the bot follow (core/saved-plan.js; the whole plan is in
    // IndexedDB: platform/plan-store.js).
    planNow: 'planNow',
    // Your trains from Torn's log (Full key): the sessions no read of ours saw (core/gymlog.js).
    gymLog: 'gymLog',
};

/** Torn Eye colour bands (ENGINE-SPEC §10), user-settable. */
export const DEFAULT_BANDS = {
    stomp: { win: 99, keep: 75 },
    good: { win: 90, keep: 40 },
    tough: { win: 60, keep: 0 },
};

export const DEFAULT_SETTINGS = {
    timeFormat: 'torn',
    pill: true,
    gymMarks: true,
    marketMarks: true,
    eyeChips: true,
    budget: 150000000,
    horizonDays: 30,
    buyWindow: 'three',
    bands: DEFAULT_BANDS,
    w3b: true,
    // Auto mode: energy kept for a faction war (0 = you decide).
    warReserve: 0,
    // Buy › Shops I can buy from: city shops ticked (Sally's Sweet Shop counts by default; npcShopsOff switches it off).
    npcShops: [],
    npcShopsOff: [],
};

/**
 * pickBy: the Plan dropdown (auto | most | value | max; Auto is the default, owner 2026-09-29). specialUse: special refills the plan may use (0 until the
 * player sets it); specialStart: how many the account had when it was set (the rest are counted from there).
 */
export const DEFAULT_PLAN = { type: 'steady', strategy: 'steady', build: 'baldr', buildPicked: false, goal: null, createdAt: 0, strategyPicked: false, pickBy: 'auto', specialUse: 0, specialStart: null };

function merged(stored, defaults) {
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? { ...defaults, ...stored } : { ...defaults };
}

export function getSettings() {
    const s = merged(gmGet(K.settings, null), DEFAULT_SETTINGS);
    s.bands = { ...DEFAULT_BANDS, ...(s.bands || {}) };
    return s;
}

export function setSettings(partial) {
    const next = { ...getSettings(), ...partial };
    gmSet(K.settings, next);
    return next;
}

export function getPlan() {
    const p = merged(gmGet(K.plan, null), DEFAULT_PLAN);
    // Plans saved before Auto existed kept the old default ("most"): they move to Auto once, unless the player chose it.
    if (p.pickBy === 'most' && !p.pickByPicked && !p.autoMigrated) {
        p.pickBy = 'auto';
        p.autoMigrated = true;
    }
    return p;
}

export function setPlan(plan) {
    gmSet(K.plan, plan);
    return plan;
}

export function getKey(name) {
    const v = gmGet(name, '');
    return typeof v === 'string' ? v : '';
}

/** Keys are saved trimmed; an empty one is deleted. Saving a key clears its dead mark. */
export function setKey(name, value) {
    const v = String(value || '').trim();
    if (v) gmSet(name, v);
    else gmDel(name);
    if (name === K.apiKey) {
        gmDel(K.apiKeyDead);
        gmDel(K.stateError);
    }
    return v;
}

export function get(name, fallback = null) {
    return gmGet(name, fallback);
}

/** A big stored value, parsed once per change (read-only: copy before changing). */
export function getShared(name, fallback = null) {
    const v = gmGetShared(name, fallback);
    return v === null || v === undefined ? fallback : v;
}

/*
 * Prices (round 6): GM keeps one small row per item (when it was read, the
 * unit price the plan uses, the cheapest, the 7-day average); the listings
 * themselves (60 per item) stay on the site that loaded them, in its
 * IndexedDB, for its Buy list and market outlines.
 */
const local = { rows: null, loading: null, ver: 0 };
const pricesMemo = { slim: null, ver: -1, value: null };

/** This site's own listings, read once from its IndexedDB (market pages and the webpage). */
export function loadLocalPrices() {
    if (local.loading) return local.loading;
    local.loading = idbGet('prices')
        .then((v) => {
            local.rows = { ...(v || {}), ...(local.rows || {}) };
            local.ver++;
            return local.rows;
        })
        .catch(() => {
            local.rows = local.rows || {};
            return local.rows;
        });
    return local.loading;
}

/** This site's listings (only what it loaded itself). */
export function localPrices() {
    return local.rows || {};
}

/** Keep newly loaded listings on this site (memory now, IndexedDB after). */
export function setLocalPrices(rows) {
    local.rows = { ...(local.rows || {}), ...rows };
    local.ver++;
    idbSet('prices', local.rows).catch(() => {});
}

/**
 * Prices (read-only: copy before changing): GM's small rows, with this site's
 * listings where it has the newest read.
 */
export function getPrices() {
    const slim = gmGetShared(K.prices, {}) || {};
    if (!local.rows) return slim;
    if (pricesMemo.slim === slim && pricesMemo.ver === local.ver) return pricesMemo.value;
    const out = { ...slim };
    for (const [id, row] of Object.entries(local.rows)) if (row && (!slim[id] || (row.at || 0) >= (slim[id].at || 0))) out[id] = row;
    pricesMemo.slim = slim;
    pricesMemo.ver = local.ver;
    pricesMemo.value = out;
    return out;
}

/** Listings kept per item: the cheapest, enough to fill a week's plan from many sellers. */
export const PRICE_LISTINGS_KEPT = 60;

export function set(name, value) {
    gmSet(name, value);
}

export function del(name) {
    gmDel(name);
}

/**
 * Keys 1.2.3 kept and round 6 dropped (the comparison worked out on every page, Auto's event comparison, the turn to
 * work one out, today's candy pick): removed once, so Tampermonkey stops handing them to every page.
 */
export const DROPPED_KEYS = ['compareCache', 'eventCompareCache', 'compareBusy', 'candyPick'];

export function dropOldKeys() {
    for (const k of DROPPED_KEYS) if (gmGet(k, null) !== null) gmDel(k);
    // 1.2.3 kept every listing in GM (~140 KB): this site keeps them, GM gets the small rows.
    const prices = gmGet(K.prices, null);
    if (prices && Object.values(prices).some((r) => r && Array.isArray(r.listings))) {
        setLocalPrices(Object.fromEntries(Object.entries(prices).filter(([, r]) => r && Array.isArray(r.listings))));
        gmSet(K.prices, Object.fromEntries(Object.entries(prices).map(([id, r]) => [id, slimPriceRow(id, r)])));
    }
}

/** What "Your data" in Settings can clear, by group. */
export const DATA_GROUPS = {
    keys: [K.apiKey, K.apiKeyDead, K.keyInfo, K.ffsKey, K.ffsState, K.tsKey, K.worker, K.fullKey, K.fullKeyState, K.moneyLog],
    plan: [K.plan, K.recheck, K.gymSession, K.planNow, 'savedPlanFull'],
    progress: [K.statsHistory, K.dayLog, K.dayTotals, K.planLine, K.receipts, K.gymLog],
    learning: ['calibration', K.learned, K.learnLog, K.fightLog, K.eyePredictions],
    prices: [K.priceHistory, K.prices],
    eye: ['eyeTargets', 'myAttacks'],
};

export function clearGroup(group) {
    for (const k of DATA_GROUPS[group] || []) gmDel(k);
}
