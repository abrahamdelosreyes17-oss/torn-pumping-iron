/*
 * Torn Eye's colour bands (user-set in the Torn Eye tab; ENGINE-SPEC §10):
 * Stomp, Good, Tough, Can't win, or No data. Never "FF".
 */

export const BAND_ORDER = ['stomp', 'good', 'tough', 'cant', 'none'];
export const BAND_WORDS = { stomp: 'Stomp', good: 'Good', tough: 'Tough', cant: "Can't win", none: 'No data' };
export const BAND_COLORS = { stomp: '#3fbf5a', good: '#a6e08a', tough: '#f0a040', cant: '#ff5a4e', none: '#6c737a' };
export const DEFAULT_BAND_LIMITS = { stomp: { win: 99, keep: 75 }, good: { win: 90, keep: 40 }, tough: { win: 60, keep: 0 } };

/**
 * @param {object|null} f - forecast() output (pWin 0..1, keep 0..1)
 * @param {object} [limits] - {stomp:{win,keep}, good:{win,keep}, tough:{win}} in percent
 */
export function bandOf(f, limits = DEFAULT_BAND_LIMITS) {
    if (!f || !Number.isFinite(f.pWin)) return 'none';
    const win = f.pWin * 100;
    const keep = (f.keep || 0) * 100;
    const L = { ...DEFAULT_BAND_LIMITS, ...(limits || {}) };
    if (win >= L.stomp.win && keep >= L.stomp.keep) return 'stomp';
    if (win >= L.good.win && keep >= L.good.keep) return 'good';
    if (win >= L.tough.win) return 'tough';
    return 'cant';
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
