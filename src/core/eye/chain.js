/*
 * The chain counter (round 8, mockups/round8/torn-eye.html §1, the owner's pick B): for each faction's chain the
 * count, the time left on the 5:00 chain timer and the hits to the next bonus. Yours comes from Torn's own bars (the
 * sidebar on Torn's pages, the bars read on the webpage); the enemy's from one read of their chain by the Torn Eye
 * tab. Pure: no page, no request. A side nothing was read about is 'unknown', never a made-up figure.
 */

/** Torn's chain bonuses: the hit that carries each one. */
export const CHAIN_BONUSES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000];

/** The chain timer: every hit sets it back to this (seconds). */
export const CHAIN_TIMER_S = 300;

/** Under this much left the timer turns amber. */
export const CHAIN_LOW_S = 60;

/** A read of the enemy's chain is believed this long (hits since are not known): then that side says "not read". */
export const CHAIN_FRESH_MS = 2 * 60 * 1000;

/**
 * The next bonus above a count and the hits to it; null past the last bonus. `max` is Torn's own next mark (the
 * sidebar's "247/250"), used when it is above the count.
 * @returns {{at: number, hits: number}|null}
 */
export function chainNext(count, max = null) {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const at = Number(max) > n ? Number(max) : CHAIN_BONUSES.find((b) => b > n);
    return at ? { at, hits: at - n } : null;
}

/** "3:42", "0:48"; over an hour (a cooldown) "1:05:00". */
export function chainClock(s) {
    const t = Math.max(0, Math.ceil(Number(s) || 0));
    const m = Math.floor((t % 3600) / 60);
    const ss = String(t % 60).padStart(2, '0');
    return t >= 3600 ? Math.floor(t / 3600) + ':' + String(m).padStart(2, '0') + ':' + ss : m + ':' + ss;
}

/**
 * A chain as Torn's API gives it ({current, max, timeout: seconds until it breaks, cooldown: when a cooldown ends},
 * from /user bars or /faction/{id}/chain), read at `at` (ms).
 * @returns {{current, max, until, cooldownUntil, at}|null} until, cooldownUntil: ms, 0 when none
 */
export function chainFromApi(c, at = Date.now()) {
    if (!c || typeof c !== 'object') return null;
    const timeout = Math.max(0, Number(c.timeout) || 0);
    const cool = Number(c.cooldown) || 0;
    return { current: Math.max(0, Number(c.current) || 0), max: Number(c.max) || 0, until: timeout > 0 ? at + timeout * 1000 : 0, cooldownUntil: cool * 1000 > at ? cool * 1000 : 0, at };
}

/**
 * Torn's sidebar chain bar as text ("247/250" and "03:42") [check live: the bar's markup follows the energy bar's].
 * @returns {{current, max, until, cooldownUntil, at}|null}
 */
export function chainFromBar(valueText, timeText, at = Date.now()) {
    const m = String(valueText || '').replace(/,/g, '').match(/(\d+)\s*\/\s*(\d+)/);
    if (!m) return null;
    const t = String(timeText || '').match(/(?:(\d+):)?(\d{1,2}):(\d{2})/);
    const left = t ? (Number(t[1]) || 0) * 3600 + Number(t[2]) * 60 + Number(t[3]) : 0;
    // The chain timer never shows more than 5:00: a longer clock on the bar is the cooldown after a chain.
    const cooling = left > CHAIN_TIMER_S;
    return { current: Number(m[1]), max: Number(m[2]), until: left > 0 && !cooling ? at + left * 1000 : 0, cooldownUntil: cooling ? at + left * 1000 : 0, at };
}

/**
 * One side of the counter as it shows now.
 * @param {object|null} raw - chainFromApi() / chainFromBar(); null: nothing read
 * @returns {{state: 'on'|'cooldown'|'off'|'unknown', count: number|null, leftS: number, low: boolean, pct: number, next: {at, hits}|null, until: number}}
 *   on: a chain with time left; cooldown: `leftS` is what is left of it; off: no chain running; pct: the timer's bar
 */
export function chainSide(raw, now = Date.now()) {
    if (!raw) return { state: 'unknown', count: null, leftS: 0, low: false, pct: 0, next: null, until: 0 };
    const count = Math.max(0, Number(raw.current) || 0);
    if (Number(raw.cooldownUntil) > now) return { state: 'cooldown', count, leftS: Math.ceil((raw.cooldownUntil - now) / 1000), low: false, pct: 0, next: null, until: raw.cooldownUntil };
    const leftS = Number(raw.until) > now ? Math.ceil((raw.until - now) / 1000) : 0;
    if (!(count > 0) || !(leftS > 0)) return { state: 'off', count: 0, leftS: 0, low: false, pct: 0, next: null, until: 0 };
    return { state: 'on', count, leftS, low: leftS < CHAIN_LOW_S, pct: Math.max(0, Math.min(100, Math.round((100 * leftS) / CHAIN_TIMER_S))), next: chainNext(count, raw.max), until: raw.until };
}

/** The line under a side's count: "3 hits to the 250 bonus", "No chain running", "On cooldown", "Not read yet". */
export function chainBonusText(side) {
    if (side.state === 'unknown') return 'Not read yet';
    if (side.state === 'cooldown') return 'On cooldown';
    if (side.state === 'off') return 'No chain running';
    return side.next ? side.next.hits + ' hit' + (side.next.hits === 1 ? '' : 's') + ' to the ' + side.next.at.toLocaleString('en-US') + ' bonus' : 'Past the last bonus';
}

/** The enemy's chain as shared by the Torn Eye tab ({at, fid, name, current, max, until, cooldownUntil}): null once it is old. */
export function sharedChain(rec, now = Date.now()) {
    if (!rec || !(Number(rec.at) > 0) || !(now - rec.at < CHAIN_FRESH_MS)) return null;
    return rec;
}
