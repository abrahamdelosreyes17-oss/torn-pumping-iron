/*
 * The panel's tiles for the step of the moment (round 9, the owner's pick 1B, mockups/round9/companion.html §1): each
 * item the step takes, whether using it now would work, how many you hold and whether the plan's next days need more.
 * Pure: the caller reads the bars, the cooldowns, what you hold and the Buy list. Nothing here acts on Torn: the
 * tile's "Show" goes to Torn's own row, where Torn's own Use is pressed.
 */

import { ITEMS, POINTS, BOOSTER_CAP_H, itemName, boostersThatFit } from './items.js';
import { ENERGY_CAP } from './gain.js';
import { tornDayStart } from './bars.js';
import { fmtInt } from './format.js';

const TILE_DAY_MS = 24 * 3600e3;
const TILE_HOUR_MS = 3600e3;
const TILE_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The tab of Torn's items page an item sits on (the "Show" button's hint when its row isn't on the open tab). */
export const TORN_TAB = { Drug: 'Drugs', Booster: 'Boosters', Candy: 'Candy', 'Energy Drink': 'Energy Drinks', Special: 'Special' };

export function tornTabOf(id) {
    const it = ITEMS[id];
    return it ? TORN_TAB[it.category] || null : null;
}

/** "today" for a one-day Buy window, else the first Torn day after it: {long: 'before Thursday', short: 'before Thu'}. */
export function windowWords(now, days) {
    if (!(days > 1)) return { long: 'today', short: 'today' };
    const day = TILE_WEEKDAYS[new Date(tornDayStart(now) + days * TILE_DAY_MS).getUTCDay()];
    return { long: 'before ' + day, short: 'before ' + day.slice(0, 3) };
}

/** The step's items as one row an id (the console jump lists its console twice: the plays, and the one to buy). */
function tileItemsOf(step) {
    const by = new Map();
    for (const it of (step && step.items) || []) {
        if (it.id === POINTS || !ITEMS[it.id]) continue;
        const qty = Math.max(0, Number(it.qty) || 0);
        const uses = Math.max(0, Number(it.uses) || 0);
        if (!qty && !uses) continue;
        const row = by.get(it.id) || { id: it.id, qty: 0, uses: 0 };
        row.qty += qty;
        row.uses += uses;
        by.set(it.id, row);
    }
    return [...by.values()];
}

function tileJoinAnd(list) {
    return list.length <= 1 ? list.join('') : list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1];
}

/**
 * @param {object} step - plan.js step {kind, items:[{id, qty, uses}], parts}
 * @param {object} o
 * @param {object|null} o.inventory - {[itemId]: held}; null until Torn's answer about what you hold is in
 * @param {{current, max}|null} o.energy - the energy bar now
 * @param {number} o.drugLeft - ms of drug cooldown left
 * @param {number} o.boosterLeft - ms of booster cooldown left
 * @param {number} o.capH - the booster cooldown's cap, hours
 * @param {number} o.cdMult - the consumable cooldown cut (candy, cans)
 * @param {{id, need, have, buy}[]} o.needs - the Buy list's rows for its window (market.js needList)
 * @param {number} o.windowDays - that window, days
 * @param {object[]} o.rest - the steps after this one
 * @param {{boosters:boolean, drug:boolean}} o.done - a boost under way: what the bars say is already in
 * @param {boolean} o.boost - a jump or a daily boost (the drug goes in after the boosters)
 * @returns {{tiles:{id, name, status, cdAt, after, tone, ok, done, show, hold, low, tab}[], warn:string|null, later:{text, hold}|null}|null}
 */
export function stepTiles(step, { inventory = null, energy = null, drugLeft = 0, boosterLeft = 0, capH = BOOSTER_CAP_H, cdMult = 1, needs = [], windowDays = 1, rest = [], done = {}, boost = false, now = Date.now() } = {}) {
    const items = tileItemsOf(step);
    if (!items.length) return null;
    const by = windowWords(now, windowDays);
    const heldOf = (id) => (inventory ? Math.max(0, Math.floor(Number(inventory[id]) || 0)) : null);
    const hasBoosters = items.some((x) => ITEMS[x.id].kind !== 'drug');
    const trains = Boolean(step.parts && step.parts.length);
    const cdAt = (left) => Math.round((now + left) / 1000) * 1000;
    const buys = [];
    const tiles = items.map((x) => {
        const it = ITEMS[x.id];
        const held = heldOf(x.id);
        const t = { id: x.id, name: itemName(x.id) + (x.qty > 1 ? ' × ' + x.qty : ''), status: 'Ready', cdAt: null, after: '', tone: 'green', ok: true, done: false, show: held !== 0, hold: '', low: false, tab: tornTabOf(x.id) };
        const stop = (status, tone = 'amber') => Object.assign(t, { status, tone, ok: false });
        const isDone = it.kind === 'drug' ? Boolean(done.drug) : Boolean(done.boosters);
        if (isDone) {
            Object.assign(t, { status: it.kind === 'drug' ? 'Taken' : 'Eaten', tone: 'grey', ok: false, done: true, show: false });
        } else if (held !== null && x.qty > 0 && held < x.qty) {
            stop(held ? 'You hold ' + held + ' of ' + x.qty : 'None held', 'red');
        } else if (it.kind === 'drug') {
            const over = it.energy && energy && Number.isFinite(energy.current) ? energy.current + it.energy * Math.max(1, x.qty) - ENERGY_CAP : 0;
            if (drugLeft > 0) Object.assign(stop('Drug cooldown · '), { cdAt: cdAt(drugLeft), after: ' left' });
            else if (boost && hasBoosters && !done.boosters) stop('After the boosters', 'grey');
            // A stack keeps its energy ("don't train"): the plan takes the Xanax anyway, so the tile only says the loss.
            else if (over > 0 && !trains) Object.assign(t, { status: 'Loses ' + fmtInt(over) + ' energy over ' + fmtInt(ENERGY_CAP), tone: 'amber' });
            else if (over > 0) stop('Would lose ' + fmtInt(over) + ' energy · train first');
            else if (it.energy && energy && Number.isFinite(energy.current)) t.status = 'Ready · energy ' + fmtInt(energy.current) + ' → ' + fmtInt(energy.current + it.energy * Math.max(1, x.qty));
        } else if (it.kind === 'booster') {
            const fit = boostersThatFit(x.id, capH, boosterLeft / TILE_HOUR_MS, cdMult);
            const gives = it.toMax && energy ? Math.max(0, energy.max - energy.current) : (it.energy || 0) * x.qty;
            const over = gives && energy && Number.isFinite(energy.current) ? energy.current + gives - ENERGY_CAP : 0;
            if (fit <= 0) Object.assign(stop('Booster cooldown full · room in '), { cdAt: cdAt(boosterLeft - capH * TILE_HOUR_MS) });
            else if (fit < x.qty) Object.assign(t, { status: 'Only ' + fit + ' of ' + x.qty + ' fit the booster cooldown', tone: 'amber' });
            else if (over > 0) stop('Would lose ' + fmtInt(over) + ' energy · train first');
            else if (gives && energy) t.status = 'Ready · energy ' + fmtInt(energy.current) + ' → ' + fmtInt(energy.current + gives);
            else if (x.qty > 1) t.status = 'Ready · all ' + x.qty + ' fit the booster cooldown';
        }
        if (held !== null) {
            const need = (needs || []).find((n) => n.id === x.id && n.buy > 0);
            if (need && !t.done) {
                t.hold = 'you hold ' + fmtInt(held) + ' · the plan takes ' + fmtInt(need.need) + ' ' + by.short;
                t.low = true;
                buys.push({ name: itemName(x.id), buy: need.buy });
            } else t.hold = 'you hold ' + fmtInt(held);
        }
        return t;
    });
    const warn = buys.length ? 'Buy ' + (buys.length === 1 ? fmtInt(buys[0].buy) + ' more' : tileJoinAnd(buys.map((b) => fmtInt(b.buy) + ' more ' + b.name))) + ' ' + by.long : null;
    // What the rest of the Torn day takes, on one small line (so a missing Ecstasy shows before its hour).
    const dayEnd = tornDayStart(now) + TILE_DAY_MS;
    const laterBy = new Map();
    for (const s of rest || []) {
        if (!(s.at < dayEnd)) continue;
        for (const x of tileItemsOf(s)) if (x.qty > 0) laterBy.set(x.id, (laterBy.get(x.id) || 0) + x.qty);
    }
    const laterIds = [...laterBy.keys()];
    const later = laterIds.length
        ? { text: 'Later today · ' + laterIds.map((id) => itemName(id) + (laterBy.get(id) > 1 ? ' × ' + laterBy.get(id) : '')).join(', '), hold: inventory ? 'you hold ' + tileJoinAnd(laterIds.map((id) => fmtInt(heldOf(id)))) : '' }
        : null;
    return { tiles, warn, later };
}
