/*
 * Typed settings and saved data over gm.js (prefix pumpingIron.v1.). Small
 * values live in GM storage, which every tab sees and gets change events
 * for; big, one-page data (Torn Eye estimates, captured gear) goes to
 * IndexedDB so it doesn't slow every Torn page (the trading app's lesson).
 */

import { gmGet, gmSet, gmDel } from './gm.js';

export const K = {
    apiKey: 'apiKey',
    apiKeyDead: 'apiKeyDead',
    keyInfo: 'keyInfo',
    ffsKey: 'ffsKey',
    ffsState: 'ffsState',
    tsKey: 'tsKey',
    worker: 'worker',
    settings: 'settings',
    plan: 'plan',
    userState: 'userState',
    userStatic: 'userStatic',
    dayLog: 'dayLog',
    statsHistory: 'statsHistory',
    priceHistory: 'priceHistory',
    prices: 'prices',
    recheck: 'recheck',
    unlocked: 'unlockedGyms',
    gymProgress: 'gymProgress',
    leader: 'leader',
    overlayPos: 'overlayPos',
    apiPause: 'apiPause',
    lastError: 'lastError',
};

/** Torn Eye colour bands (ENGINE-SPEC §10), user-settable. */
export const DEFAULT_BANDS = {
    stomp: { win: 99, keep: 75 },
    good: { win: 90, keep: 40 },
    tough: { win: 60, keep: 0 },
};

export const DEFAULT_SETTINGS = {
    density: 'compact',
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
};

export const DEFAULT_PLAN = { type: 'steady', strategy: 'steady', build: 'balanced', goal: null, createdAt: 0, strategyPicked: false };

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
    return merged(gmGet(K.plan, null), DEFAULT_PLAN);
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
    if (name === K.apiKey) gmDel(K.apiKeyDead);
    return v;
}

export function get(name, fallback = null) {
    return gmGet(name, fallback);
}

export function set(name, value) {
    gmSet(name, value);
}

export function del(name) {
    gmDel(name);
}

/** What "Your data" in Settings can clear, by group. */
export const DATA_GROUPS = {
    keys: [K.apiKey, K.apiKeyDead, K.keyInfo, K.ffsKey, K.ffsState, K.tsKey, K.worker],
    plan: [K.plan, K.recheck],
    progress: [K.statsHistory, K.dayLog],
    prices: [K.priceHistory, K.prices],
};

export function clearGroup(group) {
    for (const k of DATA_GROUPS[group] || []) gmDel(k);
}
