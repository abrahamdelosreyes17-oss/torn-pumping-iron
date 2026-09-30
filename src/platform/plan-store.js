/*
 * Where the saved plan lives (round 6): the whole plan (every plan's
 * day-by-day line, the what-ifs, what it saw, its months and history) in the
 * webpage's IndexedDB, so Tampermonkey never hands it to a Torn page. Torn's
 * pages follow the small part in GM (`planNow`, core/saved-plan.js).
 * Where IndexedDB is missing or refused, the whole plan goes to GM instead.
 */

import { idbGet, idbSet, idbDel } from './idb.js';
import { gmGet, gmSet, gmDel } from './gm.js';

const IDB_KEY = 'savedPlan';
export const SAVED_PLAN_GM_FALLBACK = 'savedPlanFull';

/** @returns {Promise<object|null>} */
export async function loadSavedPlan() {
    const gm = gmGet(SAVED_PLAN_GM_FALLBACK, null);
    try {
        const v = await idbGet(IDB_KEY);
        // The newer of the two (a save that fell back to GM after an IndexedDB one).
        if (v && !(gm && gm.rev > v.rev)) return v;
    } catch {
        // No IndexedDB here: the GM copy below.
    }
    return gm;
}

/** @returns {Promise<'idb'|'gm'>} where it went */
export async function saveSavedPlan(plan) {
    try {
        await idbSet(IDB_KEY, plan);
        gmDel(SAVED_PLAN_GM_FALLBACK);
        return 'idb';
    } catch {
        gmSet(SAVED_PLAN_GM_FALLBACK, plan);
        // An older copy there would be read first next time.
        try {
            await idbDel(IDB_KEY);
        } catch {
            // No IndexedDB at all.
        }
        return 'gm';
    }
}

export async function forgetSavedPlan() {
    gmDel(SAVED_PLAN_GM_FALLBACK);
    try {
        await idbDel(IDB_KEY);
    } catch {
        // Nothing stored there.
    }
}
