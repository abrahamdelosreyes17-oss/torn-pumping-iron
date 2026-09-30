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
        // Round 6 (research-year-events.md): the T gives energy too (+50 each, 10 uses).
        freeEnergy: 500,
        freeHappy: 500,
        effect: 'The R in the TORN logo gives +500 happy and the T +50 energy (each once per 15 min, 10 times).',
        advice: 'One R click fits a jump window: +500 happy; the ten T clicks are 500 free energy.',
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

/** Which plans each event helps (the rest train as usual through it). */
export const EVENT_PLANS = {
    caffeinecon: ['steadyBoost', 'steadyMax'],
    diabetes: ['dailyChoco', 'chocoJump', 'candyXanax', 'consoleJump', 'consoleJumpToy'],
    easter: ['steadyBoost', 'steadyMax', 'edvdJump', 'edvdJumpAN', 'happy99k', 'blissSteady'],
};

/**
 * Should the plan keep the booster cooldown free now: an event that uses it
 * starts within one booster cap (24 h; 48 h with faction Voracity), and this
 * plan uses what the event boosts.
 */
export function holdBoosterFor(events, now, strategy = null, capH = 24) {
    const hold = Math.max(EVENT_BOOSTER_HOLD_MS, (Number(capH) || 24) * HOUR);
    return (events || []).find((e) => e.usesBooster && !e.active && e.start - now <= hold && (!strategy || (EVENT_PLANS[e.id] || []).includes(strategy))) || null;
}

/** Easter Sunday (UTC midnight) of a year (the Gregorian computus). */
export function easterSunday(year) {
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31);
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return Date.UTC(year, month - 1, day);
}

/**
 * Next year's dates (research-year-events.md §1a): fixed days, and Easter
 * Sunday −3 to +3. Marked `expected` until the API lists them.
 */
export function ruleEvents(year) {
    const day = (m, d) => Math.floor(Date.UTC(year, m - 1, d) / 1000);
    const easter = Math.floor(easterSunday(year) / 1000);
    return [
        { title: 'CaffeineCon ' + year, start: day(10, 15), end: day(10, 15) + 86399, expected: true },
        { title: 'World Diabetes Day', start: day(11, 14), end: day(11, 14) + 86399, expected: true },
        { title: 'Torn Anniversary', start: day(11, 15), end: day(11, 15) + 86399, fixed_start_time: true, expected: true },
        { title: 'Easter Egg Hunt', start: easter - 3 * 86400, end: easter + 4 * 86400 - 1, expected: true },
    ];
}

/**
 * Every training event between two times (a year plan): this year's from
 * `/torn/calendar` (a fixed event already past comes back with `start` in
 * next year and `end` in this one: read as this year's), the rest from the
 * date rules. Soonest first, with the player's window.
 */
export function eventsBetween(calendar, from, to, { startTime = null } = {}) {
    const slot = slotMinutes(startTime);
    const api = (calendar && Array.isArray(calendar.events) ? calendar.events : []).map((ev) => (ev && Number(ev.start) > Number(ev.end) ? { ...ev, start: Number(ev.start) - 365 * 86400 } : ev));
    const out = [];
    const seen = new Set();
    const add = (ev) => {
        const title = String((ev && ev.title) || '');
        const def = TRAINING_EVENTS.find((d) => d.match.test(title));
        if (!def) return;
        const w = eventWindow(ev, slot);
        if (!w || w.end <= from || w.start >= to) return;
        const key = def.id + ':' + new Date(w.start + 2 * DAY).getUTCFullYear();
        if (seen.has(key)) return;
        seen.add(key);
        const { match, ...rest } = def;
        void match;
        out.push({ ...rest, title, start: w.start, end: w.end, exact: w.exact, expected: Boolean(ev.expected) });
    };
    for (const ev of api) add(ev);
    const y0 = new Date(from).getUTCFullYear();
    const y1 = new Date(to).getUTCFullYear();
    for (let y = y0; y <= y1; y++) for (const ev of ruleEvents(y)) add(ev);
    return out.sort((a, b) => a.start - b.start);
}

/** While an event runs: × on can energy and candy happy (on top of perks). */
export function eventMults(events) {
    const out = { canMult: 1, candyMult: 1 };
    for (const e of events || []) {
        if (!e.active) continue;
        if (e.canMult) out.canMult *= e.canMult;
        if (e.candyMult) out.candyMult *= e.candyMult;
    }
    return out;
}

/** Home's line: "CaffeineCon in 2 days: …" / "CaffeineCon now (until 16 Oct 12:00)". */
export function eventHeadsUp(e, now) {
    if (!e) return null;
    const when = e.active ? 'now' : e.inMs < HOUR ? 'within the hour' : e.inMs < DAY ? 'in ' + Math.round(e.inMs / HOUR) + ' h' : 'in ' + Math.round(e.inMs / DAY) + ' days';
    return { text: e.name + ' ' + when + (e.exact ? '' : ' (about)'), sub: e.effect + ' ' + e.advice, at: e.start, active: e.active, id: e.id, until: e.end };
}
