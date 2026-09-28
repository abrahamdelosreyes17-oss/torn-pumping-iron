/*
 * FFScouter (ffscouter.com/api/v1): stat estimates for players you haven't
 * fought, and target lists. The key is the user's own Torn key registered
 * at FFScouter - FFScouter already has it; it goes nowhere else from here.
 * Credited wherever its data shows (DESIGN §6), with a link to its home page,
 * where its data policy lives (research-third-party-api.md §1.8).
 */

import { ThirdPartyClient, ThirdPartyError } from './third.js';

export const FFS_HOST = 'ffscouter.com';
export const FFS_BASE = 'https://ffscouter.com/api/v1/';
export const FFS_SITE_URL = 'https://ffscouter.com/';
export const FFS_POLICY_URL = 'https://ffscouter.com/';

/** get-stats allows 120/min per IP; we keep to half. */
export const FFS_MAX_PER_MINUTE = 60;
export const FFS_BATCH = 205;

/** Estimates are cached 5 min in memory, 1 h in storage (FFScouter's guidance). */
export const FFS_MEMORY_MS = 5 * 60 * 1000;
export const FFS_STORED_MS = 60 * 60 * 1000;

export function makeFfsClient(opts) {
    return new ThirdPartyClient({ service: 'FFScouter', host: FFS_HOST, maxPerMinute: FFS_MAX_PER_MINUTE, ...opts });
}

function url(path, key, params = {}) {
    const u = new URL(path, FFS_BASE);
    u.searchParams.set('key', key);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
    return u.toString();
}

/** An FFScouter answer: throws on its error envelope, pauses on 429 (codes 20/21). */
function unwrap(client, r) {
    const b = r.body;
    if (r.ok && b && (Array.isArray(b) || b.code === undefined)) return b;
    const code = b && Number.isFinite(Number(b.code)) ? Number(b.code) : null;
    const retry = b && Number(b.retry_after_seconds) > 0 ? Number(b.retry_after_seconds) : null;
    if (r.status === 429 || code === 20 || code === 21) {
        client.pause(retry || 60);
        throw new ThirdPartyError('FFScouter asked us to slow down.', { service: 'FFScouter', http: r.status, code, paused: true, retryAfterS: retry || 60 });
    }
    const dead = code === 1 || code === 2 || code === 6 || code === 4010 || code === 4011;
    if (dead) client.dead = true;
    const msg = code === 6 ? 'This key is not registered at FFScouter.' : b && b.error ? String(b.error) : 'HTTP ' + r.status;
    throw new ThirdPartyError('FFScouter: ' + msg.split(r.key || '\u0000').join('<redacted>'), { service: 'FFScouter', http: r.status, code, deadKey: dead });
}

/** One row as the estimator reads it; null fields where FFScouter has nothing. */
export function normalizeFfsRow(row) {
    const id = Number(row && row.player_id);
    const has = row && row.bs_estimate > 0 && row.last_updated > 0;
    return {
        playerId: id,
        bsEstimate: has ? Number(row.bs_estimate) : null,
        bssPublic: row && row.bss_public > 0 ? Number(row.bss_public) : null,
        fairFight: row && row.fair_fight > 0 ? Number(row.fair_fight) : null,
        updatedAt: has ? Number(row.last_updated) * 1000 : null,
        source: row && row.source ? String(row.source) : null,
        distribution: row && row.distribution && row.distribution.stats_percentage ? { ...row.distribution.stats_percentage } : null,
    };
}

/**
 * Estimates for up to any number of ids, in batches of 205. Every id asked
 * for comes back (a missing one as an empty row, as FF Scouter V2 does).
 * @returns {Promise<Map<number, object>>}
 */
export async function fetchFfsStats(client, playerIds) {
    const list = [...new Set((playerIds || []).map(Number).filter((x) => x > 0))];
    const out = new Map();
    for (let i = 0; i < list.length; i += FFS_BATCH) {
        const batch = list.slice(i, i + FFS_BATCH);
        const r = await client.request((key) => url('get-stats', key, { targets: batch.join(',') }));
        const rows = unwrap(client, r);
        for (const row of Array.isArray(rows) ? rows : []) out.set(Number(row.player_id), normalizeFfsRow(row));
        for (const id of batch) if (!out.has(id)) out.set(id, normalizeFfsRow({ player_id: id }));
    }
    return out;
}

/** Is this key registered at FFScouter? */
export async function checkFfsKey(client) {
    const r = await client.request((key) => url('check-key', key));
    const b = unwrap(client, r);
    return { registered: Boolean(b.is_registered), premium: Boolean(b.is_premium), policyUpdate: Boolean(b.policy_update_required) };
}

/**
 * Target list: {preset:'respect'|'level'} or level/FF filters. No match is
 * HTTP 404 code 17: an empty list, not an error.
 */
export async function fetchFfsTargets(client, { preset = null, minLevel = null, maxLevel = null, inactiveOnly = 1, factionless = null, maxFf = null, minFf = null, limit = 50 } = {}) {
    const params = preset ? { preset, limit } : { minlevel: minLevel, maxlevel: maxLevel, inactiveonly: inactiveOnly, factionless, minff: minFf, maxff: maxFf, limit };
    const r = await client.request((key) => url('get-targets', key, params));
    if (r.status === 404 && r.body && Number(r.body.code) === 17) return [];
    const b = unwrap(client, r);
    return (b.targets || []).map((t) => ({
        playerId: Number(t.player_id),
        name: t.name || null,
        level: Number(t.level) || null,
        fairFight: t.fair_fight > 0 ? Number(t.fair_fight) : null,
        bsEstimate: t.bs_estimate > 0 ? Number(t.bs_estimate) : null,
        bssPublic: t.bss_public > 0 ? Number(t.bss_public) : null,
        lastAction: t.last_action ? Number(t.last_action) * 1000 : null,
        hospitalUntil: t.hospital_until ? Number(t.hospital_until) * 1000 : null,
    }));
}
