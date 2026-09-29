/*
 * Torn calendar events that change training, and what the plan does about
 * them. Pure. Sources and confidence: docs/research-events-perks.md §1.
 *
 * `/v2/torn/calendar` gives each event's calendar day; most events run for
 * 48 hours from the player's own time slot (`/v2/user/calendar`
 * start_time), so the window is worked out the way TornTools does it and
 * shown as "about" until a live event confirms it.
 */

import { DAY, HOUR, MIN } from './bars.js';

/** How far ahead an event is worth a heads-up. */
export const EVENT_LOOKAHEAD_MS = 14 * DAY;

/** Keep the booster cooldown free this long before an event that uses it. */
export const EVENT_BOOSTER_HOLD_MS = 24 * HOUR;

/**
 * Events that matter, matched on the title (case-insensitive, start of title).
 * canMult / candyMult: × on top of perks. usesBooster: the plan should come
 * in with the booster cooldown at 0.
 */
export const TRAINING_EVENTS = [
    {
        id: 'caffeinecon',
        match: /^caffeinecon/i,
        name: 'CaffeineCon',
        canMult: 2,
        usesBooster: true,
        effect: 'Energy drinks give double energy (the booster cooldown per can stays 2 h).',
        advice: 'Come in with the booster cooldown at 0 and cans stocked; keep taking Xanax.',
    },
    {
        id: 'diabetes',
        match: /^world diabetes day/i,
        name: 'World Diabetes Day',
        candyMult: 3,
        usesBooster: true,
        effect: 'Candy gives triple happy.',
        advice: 'A candy happy jump: booster cooldown at 0, energy saved, candy + Ecstasy + train in one quarter-hour.',
    },
    {
        id: 'easter',
        match: /^easter egg hunt/i,
        name: 'Easter Egg Hunt',
        usesBooster: true,
        effect: 'Eggs: green +500 energy, yellow +10,000 happy, gold +1% all stats (each +6 h booster cooldown).',
        advice: 'Use yellow eggs in a jump, green ones for energy; leave booster room for them.',
    },
    {
        id: 'anniversary',
        match: /^torn anniversary/i,
        name: 'Torn Anniversary',
        effect: 'The R in the TORN logo gives +500 happy (once per 15 min, 10 times).',
        advice: 'One click fits a jump window: +500 happy.',
    },
    {
        id: 'ead',
        match: /^employee appreciation day/i,
        name: 'Employee Appreciation Day',
        effect: 'Job points triple (company training, not the gym).',
        advice: 'More job points for your company specials; the gym plan doesn’t change.',
    },
];

/** "HH:MM" from `/v2/user/calendar` start_time (e.g. "12:00" or "12:00:00 TCT"), in minutes after 00:00 TCT. */
export function slotMinutes(startTime) {
    const m = String(startTime || '').match(/(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const h = Number(m[1]);
    const mm = Number(m[2]);
    return h < 24 && mm < 60 ? h * 60 + mm : null;
}

/**
 * The window this player gets. Personal events: from the day before at
 * their slot to the day after at their slot (TornTools' rule); fixed ones:
 * as listed. Times in ms.
 */
export function eventWindow(ev, slotMin = null) {
    const start = Number(ev.start) * 1000;
    const end = Number(ev.end) * 1000;
    if (!(start > 0) || !(end > 0) || end <= start) return null;
    if (ev.fixed_start_time === true || slotMin === null) return { start, end, exact: ev.fixed_start_time === true };
    const day0 = Math.floor(start / DAY) * DAY;
    const day1 = Math.floor(end / DAY) * DAY;
    return { start: day0 - DAY + slotMin * MIN, end: day1 + DAY + slotMin * MIN, exact: false };
}

/**
 * The training events coming up (or running now), soonest first.
 * @param {object} calendar - /v2/torn/calendar's `calendar` {events[], competitions[]}
 * @param {number} now
 * @param {object} [o] - {startTime: /v2/user/calendar start_time}
 * @returns {{id, name, title, start, end, exact, active, inMs, effect, advice, canMult?, candyMult?, usesBooster?}[]}
 */
export function upcomingEvents(calendar, now, { startTime = null } = {}) {
    const list = calendar && Array.isArray(calendar.events) ? calendar.events : [];
    const slot = slotMinutes(startTime);
    const out = [];
    for (const ev of list) {
        const title = String((ev && ev.title) || '');
        const def = TRAINING_EVENTS.find((d) => d.match.test(title));
        if (!def) continue;
        const w = eventWindow(ev, slot);
        if (!w || w.end <= now || w.start - now > EVENT_LOOKAHEAD_MS) continue;
        const { match, ...rest } = def;
        void match;
        out.push({ ...rest, title, start: w.start, end: w.end, exact: w.exact, active: now >= w.start, inMs: Math.max(0, w.start - now) });
    }
    return out.sort((a, b) => a.start - b.start);
}

/** Should the plan keep the booster cooldown free now (an event that uses it starts within a day)? */
export function holdBoosterFor(events, now) {
    return (events || []).find((e) => e.usesBooster && !e.active && e.start - now <= EVENT_BOOSTER_HOLD_MS) || null;
}

/** Home's line: "CaffeineCon in 2 days: …" / "CaffeineCon now (until 16 Oct 12:00)". */
export function eventHeadsUp(e, now) {
    if (!e) return null;
    const when = e.active ? 'now' : e.inMs < HOUR ? 'within the hour' : e.inMs < DAY ? 'in ' + Math.round(e.inMs / HOUR) + ' h' : 'in ' + Math.round(e.inMs / DAY) + ' days';
    return { text: e.name + ' ' + when + (e.exact ? '' : ' (about)'), sub: e.effect + ' ' + e.advice, at: e.start, active: e.active, id: e.id, until: e.end };
}
