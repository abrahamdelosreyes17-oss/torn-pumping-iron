/*
 * Auto mode's Full key: saved only in this browser and used for one thing,
 * your money log (where your income comes from). Checked with key/info when
 * saved (it must be a Full key); read at most every 6 hours by the leader
 * tab, never while Torn Trading runs.
 */

import { K, get, set, del, getKey, setKey, getPlan } from './platform/store.js';
import { pageGet, pageSet } from './platform/archive.js';
import { fetchKeyInfo, fetchLogCategories, fetchMoneyLog, fetchGymLog, ACCESS_FULL } from './api/torn.js';
import { MONEY_LOG_CATEGORY } from './core/auto.js';
import { parseGymLog, mergeGymLog, gymLogFrom, GYM_LOG_EVERY_MS } from './core/gymlog.js';
import { fullKeyClient, tornClient, pi } from './runtime.js';
import { isPaused } from './turns.js';
import { logError } from './problem-log.js';

/** How often the money log is read, how far back, and how many categories at most (one call each). */
export const MONEY_LOG_EVERY_MS = 6 * 60 * 60 * 1000;
export const MONEY_LOG_DAYS = 30;
export const MONEY_LOG_MAX_CATS = 8;

/** Save and check the Full key (Settings). */
export async function saveFullKey(v) {
    if (!v) return { ok: false, text: 'Paste a key first.' };
    if (!/^[A-Za-z0-9]{16}$/.test(v)) return { ok: false, text: 'A Torn key is 16 letters and numbers.' };
    if (v === getKey(K.apiKey)) return { ok: false, text: 'That is your main key. Make a separate Full key for Auto mode.' };
    setKey(K.fullKey, v);
    set(K.fullKeyState, { ok: false, checking: true, at: Date.now() });
    pi.fullClient = null;
    try {
        const info = await fetchKeyInfo(fullKeyClient());
        if (info.level !== null && info.level !== ACCESS_FULL) {
            set(K.fullKeyState, { ok: false, error: 'This is a ' + (info.type || 'lower') + ' key, not a Full key', at: Date.now() });
            return { ok: false, text: 'Saved, but this is a ' + (info.type || 'lower') + ' key. Auto mode needs a Full key.' };
        }
        set(K.fullKeyState, { ok: true, at: Date.now(), type: info.type || 'Full Access' });
        pageSet(K.moneyLog, null);
        // Another key may be another account: its gym log starts fresh.
        pageSet(K.gymLog, null);
        refreshMoneyLog({ force: true }).catch(() => {});
        return { ok: true, text: getPlan().pickBy === 'auto' ? 'Saved · Full key. Auto mode is on.' : 'Saved · Full key. Pick Auto (from your income) on Plan to use it.' };
    } catch (error) {
        set(K.fullKeyState, { ok: false, error: String((error && error.message) || error), at: Date.now() });
        return { ok: false, text: String((error && error.message) || error) };
    }
}

/** Forget the Full key and what it read. */
export function forgetFullKey() {
    setKey(K.fullKey, '');
    del(K.fullKeyState);
    pageSet(K.moneyLog, null);
    pageSet(K.gymLog, null);
    pi.fullClient = null;
}

/**
 * Your trains from Torn's log (Full key), at most every 15 minutes, on the
 * webpage (visible), never while Torn Trading runs: what's new since the
 * newest line kept, a week back the first time. Trains on your phone, or
 * with the laptop closed, show in Progress' "Last trains".
 */
export async function refreshGymLog({ force = false, now = Date.now() } = {}) {
    const st = get(K.fullKeyState, {}) || {};
    if (!getKey(K.fullKey) || !st.ok || st.dead || isPaused()) return null;
    const kept = pageGet(K.gymLog, null);
    // A gap left by a long time away (more than a read's 300 lines) is filled a read a minute until it's done.
    const gap = kept && kept.gap ? kept.gap : null;
    if (!force && kept && !gap && now - (kept.at || 0) < GYM_LOG_EVERY_MS) return null;
    if (!force && kept && gap && now - (kept.at || 0) < 50e3) return null;
    // Asked before a slow answer came back: one read at a time.
    pageSet(K.gymLog, { ...(kept || { lines: [], newest: null }), at: now });
    const range = gap || { from: gymLogFrom(kept, now), to: null };
    const rows = await fetchGymLog(fullKeyClient(), range);
    // What's still missing: from where this read started back to the oldest line it reached.
    const left = rows.complete || !(rows.oldest > range.from) ? null : { from: range.from, to: rows.oldest };
    const next = mergeGymLog(pageGet(K.gymLog, null), parseGymLog(rows), now, left);
    pageSet(K.gymLog, next);
    return next;
}

/**
 * The gym-log clock (main.js calls it every minute), on the webpage only
 * (round 6): only the webpage shows it, and it keeps it in its own IndexedDB.
 * Torn's log goes back far enough that a day away is filled in when it opens.
 */
export function gymLogTick() {
    if (pi.where !== 'app' || typeof document === 'undefined' || document.visibilityState === 'hidden') return;
    refreshGymLog().catch((error) => {
        set(K.lastError, { at: Date.now(), where: 'gym log', code: error && error.code, message: String((error && error.message) || error) });
        logError('Reading your gym log', error);
    });
}

/**
 * Read the money log (Full key), at most every 6 hours: the log categories
 * about money (Torn's own list, read with the main key), 30 days back.
 */
export async function refreshMoneyLog({ force = false, now = Date.now() } = {}) {
    const st = get(K.fullKeyState, {}) || {};
    if (!getKey(K.fullKey) || !st.ok || st.dead || isPaused()) return null;
    const prev = pageGet(K.moneyLog, null);
    if (!force && prev && now - prev.at < MONEY_LOG_EVERY_MS) return prev;
    const cats = (await fetchLogCategories(tornClient())).filter((c) => MONEY_LOG_CATEGORY.test(String(c.title || ''))).slice(0, MONEY_LOG_MAX_CATS);
    const log = await fetchMoneyLog(fullKeyClient(), { from: Math.floor(now / 1000) - MONEY_LOG_DAYS * 86400, categories: cats });
    // Only what the breakdown needs (title, amount, time), newest 1,500.
    // Only the lines from when every category is complete count (a busy category's page may not reach back 30 days).
    const since = log.coveredFrom || now - MONEY_LOG_DAYS * 86400e3;
    const kept = log.filter((e) => e.at >= since);
    // `fields` (round 7, C.0): the log by type with its data field names, for Settings › Developer and the report zip.
    const row = { at: now, days: Math.max(1, (now - since) / 86400e3), cats: cats.map((c) => c.title), log: kept.slice(0, 1500).map((e) => ({ at: e.at, title: e.title, money: e.money })), fields: log.fields || [] };
    pageSet(K.moneyLog, row);
    return row;
}
