/*
 * Torn Eye's bands (round 7, the owner, decided 2026-10-02/03): by the HP you keep over the fights you win, nothing
 * else ("no need for minimum win chance, we already have stomp, good and fair"; "HP kept on fights you win that fight
 * only"). Fixed, not user-set:
 *
 *   Stomp  you keep 99% or more of your HP
 *   Good   70–99%
 *   Fair   50–69%
 *   low    under 50%: never listed as a target and never pinged; War and Watched still show it (they show everyone)
 *   none   nothing known about the player
 *
 * The win chance is a plain number beside the band, never part of it. Never "FF".
 */

export const BAND_ORDER = ['stomp', 'good', 'fair', 'low', 'none'];
export const BAND_WORDS = { stomp: 'Stomp', good: 'Good', fair: 'Fair', low: 'Under 50%', none: 'No data' };
export const BAND_COLORS = { stomp: '#3fbf5a', good: '#a6e08a', fair: '#f0c02f', low: '#ff6b5e', none: '#6c737a' };

/** The least HP kept (whole percent, as shown) for each listed band. */
export const BAND_KEEP = { stomp: 99, good: 70, fair: 50 };

/** The bands a target may have: everyone else is never listed and never pinged. */
export const LISTED_BANDS = ['stomp', 'good', 'fair'];

export function isListedBand(band) {
    return LISTED_BANDS.includes(band);
}

/**
 * A band name as stored by an older version (1.3.x: stomp, good, tough, cant): Tough and Can't win are gone, and
 * both are read as under 50% (never pinged) until the player is judged again. Anything unknown is 'none'.
 */
export function normBand(band) {
    if (BAND_ORDER.includes(band)) return band;
    if (band === 'tough' || band === 'cant') return 'low';
    return 'none';
}

/**
 * @param {object|null} f - forecast() output (pWin 0..1, keep 0..1 over the fights you win, or null when you win none)
 * @returns {'stomp'|'good'|'fair'|'low'|'none'}
 */
export function bandOf(f) {
    if (!f || !Number.isFinite(f.pWin)) return 'none';
    if (!(f.pWin > 0) || f.keep === null || f.keep === undefined || !Number.isFinite(f.keep)) return 'low';
    // By the whole percent the row shows, so a row never reads "99%" and Good.
    const keep = Math.round(f.keep * 100);
    if (keep >= BAND_KEEP.stomp) return 'stomp';
    if (keep >= BAND_KEEP.good) return 'good';
    if (keep >= BAND_KEEP.fair) return 'fair';
    return 'low';
}

/** "win 96% · keep ~62% · 2.80 respect" (no "~" when the stats are exact). */
export function chipFigures(f, est, respect) {
    if (!f) return 'no estimate yet';
    const parts = ['win ' + Math.round(f.pWin * 100) + '%'];
    if (f.pWin >= 0.05 && f.keep !== null && f.keep !== undefined) parts.push('keep ' + (est && est.confidence === 'exact' ? '' : '~') + Math.round(f.keep * 100) + '%');
    if (f.pWin < 0.05 && est && est.confidence === 'rough') parts.push('rough estimate');
    else if (respect) parts.push(respect.toFixed(2) + ' respect');
    return parts.join(' · ');
}
