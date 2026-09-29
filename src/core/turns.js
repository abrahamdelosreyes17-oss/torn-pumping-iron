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
