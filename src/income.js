/*
 * Auto mode's Full key: saved only in this browser and used for one thing,
 * your money log (where your income comes from). Checked with key/info when
 * saved (it must be a Full key); read at most every 6 hours by the leader
 * tab, never while Torn Trading runs.
 */

import { K, get, set, del, getKey, setKey, getPlan } from './platform/store.js';
import { fetchKeyInfo, fetchLogCategories, fetchMoneyLog, ACCESS_FULL } from './api/torn.js';
import { MONEY_LOG_CATEGORY } from './core/auto.js';
import { fullKeyClient, tornClient, pi } from './runtime.js';
import { isPaused } from './turns.js';

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
        del(K.moneyLog);
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
    del(K.moneyLog);
    pi.fullClient = null;
}

/**
 * Read the money log (Full key), at most every 6 hours: the log categories
 * about money (Torn's own list, read with the main key), 30 days back.
 */
export async function refreshMoneyLog({ force = false, now = Date.now() } = {}) {
    const st = get(K.fullKeyState, {}) || {};
    if (!getKey(K.fullKey) || !st.ok || st.dead || isPaused()) return null;
    const prev = get(K.moneyLog, null);
    if (!force && prev && now - prev.at < MONEY_LOG_EVERY_MS) return prev;
    const cats = (await fetchLogCategories(tornClient())).filter((c) => MONEY_LOG_CATEGORY.test(String(c.title || ''))).slice(0, MONEY_LOG_MAX_CATS);
    const log = await fetchMoneyLog(fullKeyClient(), { from: Math.floor(now / 1000) - MONEY_LOG_DAYS * 86400, categories: cats });
    // Only what the breakdown needs (title, amount, time), newest 1,500.
    // Only the lines from when every category is complete count (a busy category's page may not reach back 30 days).
    const since = log.coveredFrom || now - MONEY_LOG_DAYS * 86400e3;
    const kept = log.filter((e) => e.at >= since);
    const row = { at: now, days: Math.max(1, (now - since) / 86400e3), cats: cats.map((c) => c.title), log: kept.slice(0, 1500).map((e) => ({ at: e.at, title: e.title, money: e.money })) };
    set(K.moneyLog, row);
    return row;
}
