/*
 * The Discord ping ticks in this browser (core/pings.js has the rules): stored in GM so every tab syncs the same
 * ticks, read with the modes that move them (stacking, an overdose, a war of your faction).
 */

import { K, get, set } from './platform/store.js';
import { warOnNow } from './runtime.js';
import { warBegun, warKeyOf } from './core/eye/war.js';
import { pingStore, pingTicks, pingSync, setTick, adoptKinds, warSeen } from './core/pings.js';

const pingsRead = () => pingStore(get(K.pings, null));

function pingsWrite(next, was) {
    if (JSON.stringify(next) === JSON.stringify(was)) return false;
    set(K.pings, next);
    return true;
}

/**
 * The modes on now. A war of your faction that has begun (as Torn Eye's War mode has it) is noted with the time
 * it was first seen, so a tick set by hand before it gives way and one set during it stays.
 * @param {object} m - the model (stacking, overdose)
 * @returns {{chain: number|null, overdose: number|null, war: number|null}} since when, in ms
 */
export function pingModes(m, now = Date.now()) {
    const was = pingsRead();
    const enemy = warOnNow(now, get(K.userStatic, {}) || {});
    const st = warSeen(was, enemy && warBegun(enemy, Math.floor(now / 1000)) ? warKeyOf(enemy) : null, now);
    pingsWrite(st, was);
    return {
        chain: m && m.stacking ? Number(m.stacking.since) || 1 : null,
        overdose: m && m.overdose ? Number(m.overdose.at) || 1 : null,
        war: st.war ? st.war.since || 1 : null,
    };
}

/** The ticks as Settings shows them: {kind: {on, base, hand, mode}}. */
export function pingsNow(m, now = Date.now()) {
    const modes = pingModes(m, now);
    return pingTicks(pingsRead(), modes);
}

/** What the plan sync sends: {rules, rulesAt, keep}. */
export function pingsForSync(m, now = Date.now()) {
    const modes = pingModes(m, now);
    return pingSync(pingsRead(), modes);
}

/** A tick set by hand in Settings. */
export function setPing(kind, on, now = Date.now()) {
    const was = pingsRead();
    return pingsWrite(setTick(was, kind, on, now), was);
}

/** The service's answer: /settings changes made in Discord are taken over. True when a tick changed. */
export function adoptPings(kindsSet) {
    const was = pingsRead();
    return pingsWrite(adoptKinds(was, kindsSet), was);
}
