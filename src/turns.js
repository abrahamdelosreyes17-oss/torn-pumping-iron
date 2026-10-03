/*
 * Taking turns with Torn Trading, in the page. Any tab that sees Torn
 * Trading (its NPC Arbitrage panel on a Torn page, or its Torn Bids page)
 * notes the time in GM storage; every tab and the webpage read it and pause
 * (core/turns.js). Read only: we look for Torn Trading's host element and
 * never touch it.
 *
 * Round 7: each such tab also notes itself (TRADING_TABS_KEY), so the paused
 * card says where Torn Trading still runs. Turning it off in Tampermonkey
 * leaves it running in the tabs already open (core/turns.js has the cause).
 */

import { gmOnChange } from './platform/gm.js';
import { get, set } from './platform/store.js';
import { TRADING_SEEN_KEY, TRADING_TABS_KEY, tradingRunning, shouldMarkSeen, nextTradingTabs, tradingSeenWhere } from './core/turns.js';
import { detectPage, isTradingPageUrl } from './sources/route.js';

/** Torn Trading's own hosts: NPC Arbitrage on Torn's pages, Torn Bids on its page. */
export const TRADING_HOST_IDS = ['ttv2-host', 'ttv2-sell-host'];

const turns = { listeners: [], last: null, started: false, tabId: Math.random().toString(36).slice(2, 10) };

export function tradingSeenAt() {
    return Number(get(TRADING_SEEN_KEY, 0)) || 0;
}

/** True while Torn Trading runs (seen within the last minute). */
export function isPaused(now = Date.now()) {
    return tradingRunning(tradingSeenAt(), now);
}

/** Where Torn Trading is still seen, for the paused card ({count, where, lastAt, resumesAt}). */
export function tradingWhere(now = Date.now()) {
    return tradingSeenWhere(get(TRADING_TABS_KEY, null), tradingSeenAt(), now);
}

/** Is Torn Trading on this page right now? */
export function tradingOnThisPage(doc = document) {
    return TRADING_HOST_IDS.some((id) => doc.getElementById(id));
}

function whereAmI() {
    const href = typeof location !== 'undefined' ? location.href : '';
    return isTradingPageUrl(href) ? 'trading' : detectPage(href);
}

/** One look: mark Torn Trading seen (shared time, and this tab's entry), or take this tab's entry off. */
export function lookOnce(doc = typeof document !== 'undefined' ? document : null, now = Date.now()) {
    if (!doc) return;
    const seen = tradingOnThisPage(doc);
    if (seen && shouldMarkSeen(tradingSeenAt(), now)) set(TRADING_SEEN_KEY, now);
    const tabs = nextTradingTabs(get(TRADING_TABS_KEY, null), turns.tabId, seen, whereAmI(), now);
    if (tabs) set(TRADING_TABS_KEY, tabs);
}

function check() {
    const p = isPaused();
    if (p === turns.last) return;
    turns.last = p;
    for (const fn of turns.listeners) {
        try {
            fn(p);
        } catch {
            // One listener failing doesn't stop the others.
        }
    }
}

/** Call fn(paused) now and whenever it changes (another tab's mark, or the minute running out). */
export function onPauseChange(fn) {
    turns.listeners.push(fn);
    fn(isPaused());
}

/**
 * Watch for Torn Trading on this page (it may mount after us) and for the
 * pause starting or ending anywhere. Cheap: one getElementById every few
 * seconds and one small GM write every 15 s while it's seen.
 */
export function watchTrading() {
    if (turns.started) return;
    turns.started = true;
    turns.last = isPaused();
    lookOnce();
    check();
    if (typeof document !== 'undefined' && document.body && typeof MutationObserver === 'function') {
        // Torn Trading mounts its panel on the body, usually within a second or two of ours.
        const mo = new MutationObserver(() => {
            if (tradingOnThisPage()) {
                lookOnce();
                check();
            }
        });
        mo.observe(document.body, { childList: true });
        setTimeout(() => mo.disconnect(), 10000);
    }
    setInterval(() => {
        lookOnce();
        check();
    }, 5000);
    // A tab closed or reloaded is no longer one to name on the card.
    if (typeof window !== 'undefined') {
        window.addEventListener('pagehide', () => {
            const tabs = nextTradingTabs(get(TRADING_TABS_KEY, null), turns.tabId, false, whereAmI(), Date.now());
            if (tabs) set(TRADING_TABS_KEY, tabs);
        });
    }
    gmOnChange(TRADING_SEEN_KEY, () => check());
}
