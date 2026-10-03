/*
 * Taking turns with Torn Trading (NPC Arbitrage, Torn Bids). Pure.
 *
 * The owner's rule: the two scripts never run together. While Torn Trading
 * is seen (its panel on a Torn page, or its Torn Bids tab), Pumping Iron
 * makes no Torn calls and draws nothing on Torn's pages; it starts again by
 * itself about a minute after Torn Trading was last seen. Because only one
 * runs at a time, Pumping Iron may use Torn Trading's own limits.
 */

import { STATS } from './gain.js';
import { fmtShort } from './format.js';

/** GM key every tab and the webpage read: when Torn Trading was last seen. */
export const TRADING_SEEN_KEY = 'tradingSeenAt';

/** Pumping Iron starts again this long after Torn Trading was last seen. */
export const TRADING_GRACE_MS = 60 * 1000;

/** A tab that sees Torn Trading notes it at most this often (one small GM write). */
export const TRADING_MARK_EVERY_MS = 15 * 1000;

/** Torn Trading's own limits, which Pumping Iron may use while it runs alone. */
export const TORN_PER_MINUTE_ALONE = 85;
export const W3B_PER_MINUTE_ALONE = 80;

/** Is Torn Trading running now (seen within the grace period)? */
export function tradingRunning(seenAt, now) {
    const t = Number(seenAt) || 0;
    return t > 0 && now - t < TRADING_GRACE_MS;
}

/** When Pumping Iron starts again if Torn Trading isn't seen any more. */
export function resumesAt(seenAt) {
    return (Number(seenAt) || 0) + TRADING_GRACE_MS;
}

/** Should this tab write a fresh "seen" mark? */
export function shouldMarkSeen(seenAt, now) {
    const t = Number(seenAt) || 0;
    // A mark from the future (the clock moved back) is replaced, or the pause would never start.
    return !(t > 0) || now - t >= TRADING_MARK_EVERY_MS || t > now;
}

/*
 * Round 7, the pause that "stays on" (the owner, 2026-10-02: Torn Trading turned off, Pumping Iron paused for
 * minutes). The cause: turning a script off in Tampermonkey stops it on the next page load only. A tab opened before
 * keeps Torn Trading running, and keeps its host (#ttv2-host) in the page, so our own look in that tab (every 5 s,
 * hidden tabs too) keeps marking it seen until the tab is reloaded or closed. The pause was right (Torn Trading was
 * still running there); the card's "starts again by itself within a minute" was wrong, and it never said where.
 * Each tab that sees it now notes itself too, so the card can say which tabs to reload or close.
 */

/** GM key: {[tabId]: {at, where}} for each tab that sees Torn Trading now. */
export const TRADING_TABS_KEY = 'tradingTabs';

/** The page words for a tab that sees Torn Trading ("Item Market"). */
export const TRADING_WHERE_WORDS = {
    gym: 'Gym',
    items: 'Items',
    itemmarket: 'Item Market',
    bazaar: 'a bazaar',
    points: 'Points market',
    profile: 'a profile',
    faction: 'a faction page',
    attack: 'the attack page',
    trading: 'Torn Bids',
    other: 'a Torn page',
};

/** This tab's entry in the tabs record, moved on (seen now, or gone); null when nothing changes. */
export function nextTradingTabs(tabs, tabId, seen, where, now) {
    const cur = tabs && typeof tabs === 'object' ? tabs : {};
    const fresh = {};
    // Entries older than the grace period are gone (a tab closed without saying so).
    for (const [id, e] of Object.entries(cur)) if (e && now - (Number(e.at) || 0) < TRADING_GRACE_MS && id !== tabId) fresh[id] = e;
    const mine = cur[tabId];
    if (seen) {
        if (mine && !shouldMarkSeen(mine.at, now) && mine.where === where && Object.keys(fresh).length === Object.keys(cur).length - 1) return null;
        fresh[tabId] = { at: now, where };
        return fresh;
    }
    if (!mine && Object.keys(fresh).length === Object.keys(cur).length) return null;
    return fresh;
}

/**
 * Where Torn Trading is still seen, for the paused card: the tabs that saw it within the grace period, in words,
 * the last time it was seen and when Pumping Iron starts again.
 * @returns {{count:number, where:string[], lastAt:number, resumesAt:number}}
 */
export function tradingSeenWhere(tabs, seenAt, now) {
    const list = Object.values(tabs && typeof tabs === 'object' ? tabs : {}).filter((e) => e && now - (Number(e.at) || 0) < TRADING_GRACE_MS && Number(e.at) <= now + 1000);
    const words = [];
    for (const e of list.sort((a, b) => b.at - a.at)) {
        const w = TRADING_WHERE_WORDS[e.where] || TRADING_WHERE_WORDS.other;
        if (!words.includes(w)) words.push(w);
    }
    return { count: list.length, where: words, lastAt: Number(seenAt) || 0, resumesAt: resumesAt(seenAt) };
}

/**
 * The one Progress entry for what changed while paused: "While paused:
 * +2.1M SPD, Xanax taken, refill used". `trained` is {str,...}. A Limited
 * key can't read how many drugs were taken in between, only that one was.
 */
export function catchUpLabel(trained = {}, { drug = false, booster = false, refill = false } = {}) {
    const parts = [];
    for (const k of STATS) if (trained[k] > 0) parts.push('+' + fmtShort(trained[k]) + ' ' + k.toUpperCase());
    if (drug) parts.push('Xanax taken');
    if (booster) parts.push('booster used');
    if (refill) parts.push('refill used');
    return 'While paused' + (parts.length ? ': ' + parts.join(', ') : '');
}
