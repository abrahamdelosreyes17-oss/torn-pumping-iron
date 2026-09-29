/*
 * A user's bot settings (stored as JSON in users.settings) and which ping
 * kinds are on. Rules synced by the userscript (users.rules) come first;
 * a /settings change in Discord wins over them.
 */

import { parse } from './db.js';

/**
 * Chain pings are for people who chain: off until switched on. `price` is
 * a price watch (/watch); `watch` is Torn Eye's watch list (players).
 */
export const KIND_DEFAULTS = { drug: true, drugready: true, booster: true, energy: true, refill: true, jump: true, landed: true, price: true, watch: true, war: true, chain: false, stale: true };

/**
 * warPerHour: war pings have their own cap (a war can be busy), apart from
 * perHour / perDay. warLead: minutes ahead for "out of hospital soon" and
 * "lands soon" (war and watch list).
 */
export const DEFAULT_SETTINGS = { delivery: 'dm', quiet: null, perHour: 10, perDay: 60, warPerHour: 30, warLead: 3, kinds: {}, mute: {} };

/** A synced plan older than this is "out of date": only state pings go out. */
export const PLAN_STALE_S = 12 * 3600;

export function settingsOf(row) {
    const s = parse(row && row.settings, {});
    return { ...DEFAULT_SETTINGS, ...s, kinds: { ...(s.kinds || {}) }, mute: { ...(s.mute || {}) } };
}

export function kindsOn(row) {
    const rules = parse(row && row.rules, {});
    return { ...KIND_DEFAULTS, ...(rules && typeof rules === 'object' ? rules : {}), ...settingsOf(row).kinds };
}

/** Is this kind muted by /snooze right now? */
export function muted(settings, kind, nowS) {
    const m = settings.mute || {};
    // Jump sequence steps without a tick ("step") are jump pings too.
    const k = kind === 'step' ? 'jump' : kind;
    return (Number(m.all) || 0) > nowS || (Number(m[k]) || 0) > nowS;
}

/** Quiet hours {from, to} in Torn hours; wraps past midnight (23-7). */
export function inQuiet(settings, nowS) {
    const q = settings.quiet;
    if (!q || q.from === q.to) return false;
    const h = Math.floor((nowS % 86400) / 3600);
    return q.from < q.to ? h >= q.from && h < q.to : h >= q.from || h < q.to;
}

/** "23-7" → {from: 23, to: 7}; "off" → null; anything else → undefined. */
export function parseQuiet(text) {
    const t = String(text || '').trim().toLowerCase();
    if (t === 'off' || t === 'none') return null;
    const m = t.match(/^(\d{1,2})(?::00)?\s*-\s*(\d{1,2})(?::00)?$/);
    if (!m) return undefined;
    const from = Number(m[1]);
    const to = Number(m[2]);
    if (from > 23 || to > 23) return undefined;
    return { from, to };
}

export function planAge(row, nowS) {
    const at = Number(row && (row.plan_at || row.updated)) || 0;
    return at ? nowS - at : null;
}

export function planStale(row, nowS) {
    const age = planAge(row, nowS);
    return age !== null && age > PLAN_STALE_S;
}
