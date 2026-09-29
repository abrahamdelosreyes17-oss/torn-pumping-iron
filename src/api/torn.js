/*
 * Torn API v2 calls the app makes, each a thin wrapper over TornApiClient
 * (one rate-limited queue, api.torn.com only, the key redacted from errors).
 * Shapes: docs/research-api-shapes.md. Every function returns plain data the
 * core can read; none of them retries on its own beyond the client.
 */

import { TornApiError } from './client.js';

/** Torn's "incorrect category" and "access level too low". */
export const TORN_ERROR_WRONG_FIELDS = 4;
export const TORN_ERROR_ACCESS_LEVEL = 16;
export const TORN_ERROR_INCORRECT_CATEGORY = 21;

/** The one call Home and the overlay live on, every 30 s while visible (Limited key). */
export const USER_STATE_SELECTIONS = 'bars,cooldowns,refills,battlestats,gym';

/** Inventory categories a gym plan cares about (always sent: no-cat answers 21). */
export const INVENTORY_CATS = ['Drug', 'Booster', 'Candy', 'Energy Drink'];

/** key/info access levels (v1 numbering, assumed the same in v2). */
export const ACCESS_CUSTOM = 0;
export const ACCESS_PUBLIC = 1;
export const ACCESS_MINIMAL = 2;
export const ACCESS_LIMITED = 3;
export const ACCESS_FULL = 4;

const ids = (list) => [...new Set((Array.isArray(list) ? list : [list]).map((x) => String(x).replace(/\D/g, '')).filter(Boolean))];

export async function fetchUserState(client) {
    return client.get('v2/user', { selections: USER_STATE_SELECTIONS });
}

export async function fetchPerks(client) {
    const d = await client.get('v2/user/perks');
    return (d && d.perks) || {};
}

export async function fetchProperty(client) {
    const d = await client.get('v2/user/property');
    return (d && d.property) || null;
}

export async function fetchEquipment(client) {
    const d = await client.get('v2/user/equipment');
    return { equipment: (d && d.equipment) || [], clothing: (d && d.clothing) || [] };
}

/**
 * Held quantities for the gym plan's categories, one call per category
 * (Torn caches each for an hour). A category Torn refuses is skipped, not
 * fatal; a dead key still throws.
 * @returns {Promise<{[itemId:number]: number}>}
 */
export async function fetchInventory(client, cats = INVENTORY_CATS) {
    const out = {};
    for (const cat of cats) {
        let d;
        try {
            d = await client.get('v2/user/inventory', { cat, limit: 250 });
        } catch (error) {
            if (error instanceof TornApiError && (error.code === TORN_ERROR_INCORRECT_CATEGORY || error.code === TORN_ERROR_WRONG_FIELDS)) continue;
            throw error;
        }
        const inv = d && d.inventory;
        const items = Array.isArray(inv) ? inv : inv && Array.isArray(inv.items) ? inv.items : [];
        for (const it of items) {
            const id = Number(it && it.id);
            if (!id || it.faction_owned) continue;
            out[id] = (out[id] || 0) + (Number(it.amount ?? it.quantity) || 0);
        }
    }
    return out;
}

/** Points held (for the refill): /user/money. A key that can't read it answers null, not an error. */
export async function fetchPoints(client) {
    try {
        const d = await client.get('v2/user/money');
        const p = d && d.money ? Number(d.money.points) : NaN;
        return Number.isFinite(p) ? p : null;
    } catch (error) {
        if (error instanceof TornApiError && (error.code === TORN_ERROR_ACCESS_LEVEL || error.code === TORN_ERROR_WRONG_FIELDS)) return null;
        throw error;
    }
}

/** Your recent attacks (newest first), with Torn's fair-fight modifier and respect. */
export async function fetchAttacks(client, { limit = 100, from = null, to = null, filter = null } = {}) {
    const params = { limit, sort: 'DESC' };
    if (from) params.from = from;
    if (to) params.to = to;
    if (filter) params.filters = filter;
    const d = await client.get('v2/user/attacks', params);
    return (d && d.attacks) || [];
}

/**
 * Personal stats: a category (`cat`) or up to 10 named stats (`stat`), never
 * both (Torn error 26). With `timestamp`, the values at that date.
 * @returns {Promise<object|object[]>} the `personalstats` value
 */
export async function fetchPersonalStats(client, { id = null, cat = null, stat = null, timestamp = null } = {}) {
    const path = id ? 'v2/user/' + ids(id)[0] + '/personalstats' : 'v2/user/personalstats';
    const params = {};
    if (stat) params.stat = (Array.isArray(stat) ? stat : [stat]).slice(0, 10).join(',');
    else params.cat = cat || 'popular';
    if (timestamp) params.timestamp = timestamp;
    const d = await client.get(path, params);
    return d && d.personalstats !== undefined ? d.personalstats : null;
}

/** Named stats as {name: value}, whichever form Torn answered in. */
export function personalStatValues(ps) {
    const out = {};
    if (Array.isArray(ps)) for (const r of ps) if (r && r.name) out[r.name] = Number(r.value) || 0;
    return out;
}

export async function fetchDiscord(client, id = null) {
    const d = await client.get(id ? 'v2/user/' + ids(id)[0] + '/discord' : 'v2/user/discord');
    return (d && d.discord) || null;
}

export async function fetchProfile(client, id) {
    const d = await client.get('v2/user/' + ids(id)[0] + '/profile');
    return (d && d.profile) || null;
}

export async function fetchGyms(client) {
    const d = await client.get('v2/torn/gyms');
    return (d && d.gyms) || [];
}

/** Items by id (≤ 100 per call here), details always filled in. */
export async function fetchItems(client, itemIds) {
    const list = ids(itemIds).slice(0, 100);
    if (!list.length) return [];
    const d = await client.get('v2/torn/' + list.join(',') + '/items');
    return (d && d.items) || [];
}

/** Exact stats of specific weapon/armour pieces by armoury id (≤ 25). */
export async function fetchItemDetails(client, armouryIds) {
    const list = ids(armouryIds).slice(0, 25);
    if (!list.length) return [];
    const d = await client.get('v2/torn/' + list.join(',') + '/itemdetails');
    const v = d && d.itemdetails;
    return Array.isArray(v) ? v : v ? [v] : [];
}

export async function fetchAttackLog(client, code) {
    const c = String(code || '').replace(/[^a-z0-9]/gi, '');
    if (!c) return null;
    return client.get('v2/torn/attacklog', { log: c });
}

export async function fetchItemMarket(client, itemId) {
    return client.get('v2/market/' + ids(itemId)[0] + '/itemmarket', { limit: 100 });
}

export async function fetchPointsMarket(client) {
    return client.get('v2/market/pointsmarket');
}

export async function fetchFactionMembers(client, factionId = null) {
    const d = await client.get(factionId ? 'v2/faction/' + ids(factionId)[0] + '/members' : 'v2/faction/members');
    const m = d && d.members;
    return Array.isArray(m) ? m : m && typeof m === 'object' ? Object.entries(m).map(([id, v]) => ({ id: Number(id), ...v })) : [];
}

/**
 * The key's access level and selections. The check is advisory (trading
 * pattern): if Torn's answer can't be read, level is null and nothing is said.
 */
export async function fetchKeyInfo(client) {
    const d = await client.get('v2/key/info');
    const info = (d && d.info) || {};
    const access = info.access || {};
    const level = Number.isFinite(Number(access.level)) ? Number(access.level) : null;
    return { level, type: access.type || null, userId: info.user && info.user.id ? Number(info.user.id) : null, selections: info.selections || null };
}

/**
 * The user-state selections a custom key lacks (Torn refuses the whole
 * state call, error 16, if even one is missing). Empty for Limited/Full;
 * null when key/info can't tell.
 */
export function missingSelections(info) {
    if (!info || info.level === null || info.level === undefined) return null;
    if (info.level >= ACCESS_LIMITED) return [];
    if (info.level !== ACCESS_CUSTOM) return USER_STATE_SELECTIONS.split(',');
    const u = (info.selections && info.selections.user) || [];
    return USER_STATE_SELECTIONS.split(',').filter((s) => !u.includes(s));
}

/** Is this key enough for the app (Limited or Full, or a custom key with the user state selections)? */
export function keyIsEnough(info) {
    const missing = missingSelections(info);
    return missing === null ? null : missing.length === 0;
}
