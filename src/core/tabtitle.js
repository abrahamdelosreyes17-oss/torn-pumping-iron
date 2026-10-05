/*
 * The webpage's tab title (round 9, the owner's pick 4B, mockups/round9/companion.html §4): plain "Pumping Iron" until
 * the last ten minutes before the plan's next step, then the countdown and the step, then "Now" once it is due.
 * Only on our own webpage: on Torn's pages the title is never touched (Torn's rule for pages not in front).
 */

import { countdown } from './bars.js';

export const TAB_TITLE = 'Pumping Iron';
/** The countdown shows this long before a step. */
export const TITLE_LEAD_MS = 10 * 60e3;

/**
 * @param {object|null} m - the model (m.next: the step Home shows; m.stacking, m.overdose, m.away: no step to do)
 * @param {number} now
 * @param {{paused?: boolean}} [o] - paused: Torn Trading has the turn (the plan is not read)
 * @returns {string}
 */
export function tabTitle(m, now = Date.now(), { paused = false } = {}) {
    if (!m || !m.ready || paused || m.stacking || m.overdose || m.away) return TAB_TITLE;
    const step = m.next || (m.steps || [])[0] || null;
    if (!step || !Number.isFinite(step.at)) return TAB_TITLE;
    const name = String(step.label || '').split(' · ')[0];
    if (!name) return TAB_TITLE;
    const left = step.at - now;
    if (left <= 0) return 'Now · ' + name + ' · ' + TAB_TITLE;
    if (left <= TITLE_LEAD_MS) return countdown(left) + ' · ' + name + ' · ' + TAB_TITLE;
    return TAB_TITLE;
}
