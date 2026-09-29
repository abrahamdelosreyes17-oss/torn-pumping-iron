/*
 * Taking turns with Torn Trading, in the page. Any tab that sees Torn
 * Trading (its NPC Arbitrage panel on a Torn page, or its Torn Bids page)
 * notes the time in GM storage; every tab and the webpage read it and pause
 * (core/turns.js). Read only: we look for Torn Trading's host element and
 * never touch it.
 */

import { gmOnChange } from './platform/gm.js';
import { get, set } from './platform/store.js';
import { TRADING_SEEN_KEY, tradingRunning, shouldMarkSeen } from './core/turns.js';

/** Torn Trading's own hosts: NPC Arbitrage on Torn's pages, Torn Bids on its page. */
export const TRADING_HOST_IDS = ['ttv2-host', 'ttv2-sell-host'];

const turns = { listeners: [], last: null, started: false };

export function tradingSeenAt() {
    return Number(get(TRADING_SEEN_KEY, 0)) || 0;
}

/** True while Torn Trading runs (seen within the last minute). */
export function isPaused(now = Date.now()) {
    return tradingRunning(tradingSeenAt(), now);
}

/** Is Torn Trading on this page right now? */
export function tradingOnThisPage(doc = document) {
    return TRADING_HOST_IDS.some((id) => doc.getElementById(id));
}

function look() {
    if (typeof document === 'undefined' || !tradingOnThisPage()) return;
    const now = Date.now();
    if (shouldMarkSeen(tradingSeenAt(), now)) set(TRADING_SEEN_KEY, now);
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
    look();
    check();
    if (typeof document !== 'undefined' && document.body && typeof MutationObserver === 'function') {
        // Torn Trading mounts its panel on the body, usually within a second or two of ours.
        const mo = new MutationObserver(() => {
            if (tradingOnThisPage()) {
                look();
                check();
            }
        });
        mo.observe(document.body, { childList: true });
        setTimeout(() => mo.disconnect(), 10000);
    }
    setInterval(() => {
        look();
        check();
    }, 5000);
    gmOnChange(TRADING_SEEN_KEY, () => check());
}
