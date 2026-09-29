/*
 * Which Torn calls go first (owner, 2026-09-29): Pumping Iron has the
 * budget to itself (Torn Trading is off while it runs), and what you have
 * open decides who gets it. Pure.
 *
 *   - The plan's own reads always go first (a couple a minute).
 *   - Torn Eye open (its tab, or a profile, faction or attack page on Torn):
 *     Torn Eye first, the war read before anything else in it.
 *   - Buy open (or Torn's items, bazaar, Item Market or points pages): prices first.
 *   - Both open: half each.
 *   - A lane that isn't in front may still use what the front lane leaves,
 *     up to a share of the minute, so nothing sits idle and nothing starves.
 */

/** Lanes, by the Torn API path a call reads. */
export const LANES = ['plan', 'war', 'eye', 'prices', 'other'];

/** A tab's focus counts this long after its last heartbeat (a closed or hidden tab drops out). */
export const FOCUS_FRESH_MS = 15 * 1000;

/** Share of the minute a lane that isn't in front may use while another is (the rest is kept for the front one). */
export const BACK_LANE_SHARE = 0.3;

/** Share of the minute each of two front lanes may use when both are open (half each). */
export const BOTH_SHARE = 0.5;

/** The lane of a Torn API call, from its path. */
export function laneOf(path) {
    const p = String(path || '').replace(/^\/+/, '');
    if (/^v2\/market\//.test(p)) return 'prices';
    if (/^v2\/faction(\/|$)/.test(p)) return 'war';
    if (/^v2\/user\/\d+\//.test(p) || /^v2\/torn\/attacklog/.test(p) || /^v2\/user\/attacks/.test(p)) return 'eye';
    if (/^v2\/user(\/|$)/.test(p) || /^v2\/key\//.test(p)) return 'plan';
    return 'other';
}

/** Which Torn Eye lane a lane counts toward (war reads are Torn Eye's). */
export function sideOf(lane) {
    return lane === 'war' || lane === 'eye' ? 'eye' : lane === 'prices' ? 'prices' : null;
}

/**
 * What's open across the tabs, from each tab's heartbeat {focus: 'eye'|'prices'|null, war, at}.
 * @returns {{eye:boolean, prices:boolean, war:boolean}}
 */
export function focusFrom(beats, now = Date.now()) {
    const out = { eye: false, prices: false, war: false };
    for (const b of Object.values(beats || {})) {
        if (!b || !(now - (b.at || 0) < FOCUS_FRESH_MS)) continue;
        if (b.focus === 'eye') out.eye = true;
        if (b.focus === 'prices') out.prices = true;
        if (b.war) out.war = true;
    }
    return out;
}

/**
 * How many of the minute's slots a lane may be using at most before it waits.
 * @param {string} lane
 * @param {object} focus - focusFrom()
 * @param {number} max - the whole minute's budget
 */
export function laneCap(lane, focus, max) {
    const side = sideOf(lane);
    if (!side || !focus) return max;
    const front = focus.eye || focus.prices;
    if (!front) return max;
    if (focus.eye && focus.prices) return Math.floor(max * BOTH_SHARE);
    return focus[side] ? max : Math.floor(max * BACK_LANE_SHARE);
}

/**
 * Order of the queue: lower goes first; ties keep their order. With both
 * sides open, the side that has used less of the minute goes first.
 * @param {string} lane
 * @param {object} focus
 * @param {object} [used] - {eye, prices}: slots each side used in the last minute
 */
export function laneRank(lane, focus, used = {}) {
    if (lane === 'plan') return 0;
    const side = sideOf(lane);
    const f = focus || {};
    if (side && f[side]) {
        // War first inside Torn Eye; with both sides open, the one behind on its half goes next.
        const base = lane === 'war' ? 1 : 2;
        if (f.eye && f.prices) return base + ((used[side] || 0) > (used[side === 'eye' ? 'prices' : 'eye'] || 0) ? 0.5 : 0);
        return base;
    }
    if (lane === 'other') return 3;
    return 4;
}
