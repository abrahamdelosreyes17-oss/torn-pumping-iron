/*
 * Torn API v2 calls the app makes, each a thin wrapper over TornApiClient
 * (one rate-limited queue, api.torn.com only, the key redacted from errors).
 * Shapes: docs/research-api-shapes.md. Every function returns plain data the
 * core can read; none of them retries on its own beyond the client.
 */

import { TornApiError } from './client.js';
import { TRAINING_EVENTS } from '../core/events.js';
import { itemsInfoFrom } from '../core/market.js';

/** Torn's "incorrect category" and "access level too low". */
export const TORN_ERROR_WRONG_FIELDS = 4;
export const TORN_ERROR_ACCESS_LEVEL = 16;
export const TORN_ERROR_INCORRECT_CATEGORY = 21;

/** The one call Home and the overlay live on, every 30 s while visible (Limited key). */
export const USER_STATE_SELECTIONS = 'bars,cooldowns,refills,battlestats,gym';

/** Inventory categories a gym plan cares about (always sent: no-cat answers 21). Special: the Game Console. */
export const INVENTORY_CATS = ['Drug', 'Booster', 'Candy', 'Energy Drink', 'Special'];

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

/**
 * Points held (for the refill) and cash on hand (how long a spend lasts):
 * /user/money. A key that can't read it answers null, not an error.
 * @returns {Promise<{points:number, cash:number}|null>}
 */
export async function fetchMoney(client) {
    try {
        const d = await client.get('v2/user/money');
        const m = d && d.money;
        const p = m ? Number(m.points) : NaN;
        if (!Number.isFinite(p)) return null;
        // Money you can spend today: wallet, vault, Cayman (the city bank is locked in until it matures).
        const cash = ['wallet', 'vault', 'cayman_bank'].reduce((a, k) => a + (Number(m[k]) || 0), 0);
        return { points: p, cash };
    } catch (error) {
        if (error instanceof TornApiError && (error.code === TORN_ERROR_ACCESS_LEVEL || error.code === TORN_ERROR_WRONG_FIELDS)) return null;
        throw error;
    }
}

/** Points held, or null (see fetchMoney). */
export async function fetchPoints(client) {
    const m = await fetchMoney(client);
    return m ? m.points : null;
}

/**
 * Torn's calendar and this player's event time slot (most events run 48 h
 * from it). The slot needs a key that can read it; without, it's null.
 * @returns {Promise<{calendar:{events:object[], competitions:object[]}, startTime:string|null}>}
 */
export async function fetchCalendar(client) {
    const d = await client.get('v2/torn/calendar');
    let startTime = null;
    try {
        const u = await client.get('v2/user/calendar');
        startTime = (u && u.calendar && u.calendar.start_time) || null;
    } catch (error) {
        if (!(error instanceof TornApiError && (error.code === TORN_ERROR_ACCESS_LEVEL || error.code === TORN_ERROR_WRONG_FIELDS))) throw error;
    }
    // Only the events the plan cares about are kept (the whole calendar would ride along on every Torn page).
    const events = ((d && d.calendar && d.calendar.events) || []).filter((e) => TRAINING_EVENTS.some((t) => t.match.test(String((e && e.title) || ''))));
    return { calendar: { events, competitions: [] }, startTime };
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
    return { level, type: access.type || null, userId: info.user && info.user.id ? Number(info.user.id) : null, factionId: info.user && info.user.faction_id ? Number(info.user.faction_id) : null, selections: info.selections || null };
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

/**
 * Networth now and at past dates (Auto mode's income), from personal stats:
 * one call per date, the `timestamp` form gives the values then. Public
 * access, so the main key reads it.
 * @param {object} client
 * @param {object} o - {stats: names (≤10), dates: unix seconds (null = now)}
 * @returns {Promise<{at:number, networth:number, cash:number}[]>} ms times, oldest first
 */
export async function fetchNetworthHistory(client, { stats, dates }) {
    const out = [];
    for (const ts of dates) {
        const ps = await fetchPersonalStats(client, { stat: stats, timestamp: ts || null });
        const v = personalStatValues(ps);
        if (!Number.isFinite(v.networth) || !(v.networth || v.networthwallet)) continue;
        // Money you can spend: wallet, vault, Cayman (as fetchMoney counts it; the city bank is locked in).
        const cash = (v.networthwallet || 0) + (v.networthvault || 0) + (v.networthcayman || 0);
        out.push({ at: ts ? ts * 1000 : Date.now(), networth: v.networth, cash });
    }
    return out.sort((a, b) => a.at - b.at);
}

/** Torn's log categories ({id, title}); public. */
export async function fetchLogCategories(client) {
    const d = await client.get('v2/torn/logcategories');
    return (d && d.logcategories) || [];
}

/**
 * Your money log since a time (Full key only): the categories whose titles
 * are about money, newest first, as {at, title, category, money} where money
 * is the entry's main amount (0 when it has none).
 */
export async function fetchMoneyLog(client, { from, categories, perCategory = 100 }) {
    const out = [];
    for (const c of categories) {
        const d = await client.get('v2/user/log', { cat: c.id, from, limit: perCategory });
        for (const e of (d && d.log) || []) out.push({ at: Number(e.timestamp) * 1000, title: String((e.details && e.details.title) || ''), category: c.title, money: moneyOf(e.data) });
    }
    return out.sort((a, b) => b.at - a.at);
}

/** The amount a log entry is about: the first money-like field it carries. */
export function moneyOf(data) {
    if (!data || typeof data !== 'object') return 0;
    for (const k of ['money', 'total_value', 'value', 'cost', 'total_cost', 'price', 'amount', 'worth']) {
        const n = Number(data[k]);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return 0;
}

/**
 * A faction's current wars (Public): {pacts, wars: {ranked, raids, territory}}.
 * Without an id, your own faction's.
 */
export async function fetchFactionWars(client, factionId = null) {
    const d = await client.get(factionId ? 'v2/faction/' + ids(factionId)[0] + '/wars' : 'v2/faction/wars');
    return { pacts: (d && d.pacts) || [], wars: (d && d.wars) || {} };
}

/**
 * Your job (Public): a company {type:'company', id, type_id, name, rating (stars),
 * position, days_in_company}, a city job, or null. Company what-ifs read it.
 */
export async function fetchJob(client) {
    const d = await client.get('v2/user/job');
    return (d && d.job) || null;
}

/**
 * Job points (Minimal): {jobs:{army,...}, companies:[{company:{id: type id, name}, points}]}.
 * A key that can't read it answers null, not an error.
 */
export async function fetchJobPoints(client) {
    try {
        const d = await client.get('v2/user/jobpoints');
        return (d && d.jobpoints) || null;
    } catch (error) {
        if (error instanceof TornApiError && (error.code === TORN_ERROR_ACCESS_LEVEL || error.code === TORN_ERROR_WRONG_FIELDS)) return null;
        throw error;
    }
}

/**
 * Torn's data for the items the plan may buy (candy, the Game Console): Torn's
 * market price and the city shops that sell each (`value.shops`), kept small.
 * @returns {Promise<object>} {[id]: {market, shops:[{shop, buy}]}}
 */
export async function fetchItemsInfo(client, itemIds) {
    return itemsInfoFrom(await fetchItems(client, itemIds));
}
