/*
 * Typed settings and saved data over gm.js (prefix pumpingIron.v1.). Small
 * values live in GM storage, which every tab sees and gets change events
 * for; big, one-page data (Torn Eye estimates, captured gear) goes to
 * IndexedDB so it doesn't slow every Torn page (the trading app's lesson).
 */

import { gmGet, gmSet, gmDel, gmGetShared } from './gm.js';

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
    donator: true,
    odRisk: 0,
    w3b: true,
    // Auto mode: energy kept for a faction war (0 = you decide).
    warReserve: 0,
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

/** Prices, parsed once per change (read-only: copy before changing). */
export function getPrices() {
    return gmGetShared(K.prices, {}) || {};
}

/** Listings kept per item: the cheapest, enough to fill a week's plan from many sellers. */
export const PRICE_LISTINGS_KEPT = 60;

export function set(name, value) {
    gmSet(name, value);
}

export function del(name) {
    gmDel(name);
}

/** What "Your data" in Settings can clear, by group. */
export const DATA_GROUPS = {
    keys: [K.apiKey, K.apiKeyDead, K.keyInfo, K.ffsKey, K.ffsState, K.tsKey, K.worker, K.fullKey, K.fullKeyState, K.moneyLog],
    plan: [K.plan, K.recheck],
    progress: [K.statsHistory, K.dayLog, K.dayTotals, K.planLine, K.receipts],
    learning: ['calibration', K.learned, K.learnLog, K.fightLog, K.eyePredictions],
    prices: [K.priceHistory, K.prices],
    eye: ['eyeTargets', 'myAttacks'],
};

export function clearGroup(group) {
    for (const k of DATA_GROUPS[group] || []) gmDel(k);
}
