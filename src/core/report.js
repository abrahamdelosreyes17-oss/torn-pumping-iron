/*
 * Settings › Report a problem (round 7; the pattern is Torn Trading's
 * ui/report-view.js): what happened, what you expected, screenshots, and one
 * .zip that also holds the problem log (core/errlog.js) and what the app
 * knows: your stats and gym set-up, your trains from Torn's log, the saved
 * plan in short, how long each plan took, and the field names of your money
 * log. Nothing is sent anywhere: the zip is downloaded, and you send it.
 * No API key, player id or name is in it. Pure.
 */

import { logAsText } from './errlog.js';

export const REPORT_KIND = 'torn-pumping-iron-report';

/** The first money-like field of a log line's data (what moneyOf reads), or null. */
export const MONEY_FIELDS = ['money', 'total_value', 'value', 'cost', 'total_cost', 'price', 'amount', 'worth'];

export function moneyFieldOf(data) {
    if (!data || typeof data !== 'object') return null;
    for (const k of MONEY_FIELDS) {
        const n = Number(data[k]);
        if (Number.isFinite(n) && n > 0) return k;
    }
    return null;
}

/** What a value is, never the value: "number", "text", "list", or an object's own field names. */
function logShapeOf(v) {
    if (v === null || v === undefined) return 'empty';
    if (Array.isArray(v)) {
        const first = v.find((x) => x && typeof x === 'object');
        return first ? 'list of {' + Object.keys(first).sort().join(', ') + '}' : 'list';
    }
    if (typeof v === 'object') return '{' + Object.keys(v).sort().join(', ') + '}';
    if (typeof v === 'number') return 'number';
    if (typeof v === 'boolean') return 'yes/no';
    return /^-?\d+(\.\d+)?$/.test(String(v)) ? 'number as text' : 'text';
}

/**
 * The money log by log type: Torn's title and type id, how many lines on how
 * many days, the names of the `data` fields (never an amount, an id or a
 * name) and which field was read as the amount (ROUND7-PLAN §3 C.0: the
 * account table is written from this, not from guesses). A line listed under
 * two categories counts once.
 * @param {object[]} rows - raw v2 log lines ({id, timestamp, details: {id, title, category}, data})
 * @param {object} [acc] - what earlier pages gave: {types: {}, seen: Set}
 */
export function logFieldsOf(rows, acc = null) {
    const out = acc || { types: {}, seen: new Set() };
    for (const e of Array.isArray(rows) ? rows : []) {
        if (!e) continue;
        const key = e.id !== undefined && e.id !== null ? String(e.id) : null;
        if (key) {
            if (out.seen.has(key)) continue;
            out.seen.add(key);
        }
        const d = e.details || {};
        const type = d.id !== undefined && d.id !== null ? String(d.id) : 'title:' + String(d.title || '?');
        const r = out.types[type] || (out.types[type] = { type: d.id !== undefined && d.id !== null ? Number(d.id) : null, title: String(d.title || ''), category: String(d.category || ''), lines: 0, days: {}, fields: {}, amount: {} });
        r.lines++;
        r.days[Math.floor(Number(e.timestamp) / 86400)] = 1;
        const data = e.data && typeof e.data === 'object' ? e.data : {};
        for (const [k, v] of Object.entries(data)) {
            const f = r.fields[k] || (r.fields[k] = { lines: 0, is: {} });
            f.lines++;
            f.is[logShapeOf(v)] = 1;
        }
        const m = moneyFieldOf(data) || '(none read)';
        r.amount[m] = (r.amount[m] || 0) + 1;
    }
    return out;
}

/** The stored form: a list, the busiest type first; names and counts only. */
export function logFieldsList(acc) {
    return Object.values((acc && acc.types) || {})
        .map((r) => ({ type: r.type, title: r.title, category: r.category, lines: r.lines, days: Object.keys(r.days).length, fields: Object.entries(r.fields).map(([name, f]) => ({ name, lines: f.lines, is: Object.keys(f.is).sort().join(' / ') })), amount: r.amount }))
        .sort((a, b) => b.lines - a.lines || String(a.title).localeCompare(String(b.title)));
}

const reportTotal = (s) => ['str', 'spd', 'def', 'dex'].reduce((a, k) => a + (Number(s && s[k]) || 0), 0);

/** The saved plan, short: its dates, rule and every plan's totals (no day-by-day lines). */
export function planSummary(saved) {
    if (!saved) return null;
    const plans = {};
    for (const [id, r] of Object.entries(saved.compare || {})) if (r) plans[id] = { gained: r.gained, cost: r.cost, energy: r.energyTrained, perStat: r.perStat, candy: r.candy ? { id: r.candy.id, count: r.candy.count } : null, refill: r.refill, blocked: r.blocked || null, gyms: (r.unlocked || []).map((u) => u.gymId) };
    const y = saved.year;
    return {
        months: saved.months,
        days: saved.days,
        start: saved.start,
        end: saved.end,
        from: saved.from,
        createdAt: saved.createdAt,
        recalibratedAt: saved.recalibratedAt,
        budget: saved.budget,
        recommended: saved.rec ? saved.rec.recommended : null,
        rule: saved.rec ? saved.rec.pickBy : null,
        reasons: saved.rec ? saved.rec.reasons : [],
        plans,
        path: y ? { gained: y.path && y.path.gained, cost: y.path && y.path.cost, band: y.band || null, segments: (y.segments || []).map((s) => ({ from: s.from, to: s.to, days: s.days, strategy: s.strategy, gained: s.gained, cost: s.cost })), unlocks: y.unlocks || [] } : null,
        snapshot: saved.snapshot ? { at: saved.snapshot.at, stats: saved.snapshot.stats, gymId: saved.snapshot.gymId, happyMax: saved.snapshot.happyMax, energyMax: saved.snapshot.energyMax, budgetPerDay: saved.snapshot.budgetPerDay, build: saved.snapshot.build, goal: saved.snapshot.goal, pickBy: saved.snapshot.pickBy } : null,
        history: (saved.history || []).map((h) => ({ at: h.at, from: h.from && { strategy: h.from.strategy, gained: h.from.gained, days: h.from.days }, to: h.to && { strategy: h.to.strategy, gained: h.to.gained, days: h.to.days } })),
    };
}

/**
 * What goes in the report zip (tested): the words, the screenshots, the
 * problem log and the data files.
 * @param {object} r
 * @param {string} r.happened
 * @param {string} r.expected
 * @param {Array<{name: string, data: Uint8Array}>} r.shots
 * @param {object[]} r.log - the problem log
 * @param {object} r.state - {version, build, settings, plan, runs, diagnostics, keys: which are saved (yes/no only)}
 * @param {object|null} r.player - {stats, happyMax, energyMax, gymId, unlocked, build, perks: {mult, lines, unknown}, job}
 * @param {object|null} r.saved - the whole saved plan (summarised here)
 * @param {object[]} [r.learning] - the learning export's files (core/learndata.js exportFiles): gym samples, gym log, fights, model
 * @param {object[]|null} [r.moneyFields] - logFieldsList()
 * @param {object} [r.statsHistory] - {day: {str, spd, def, dex, total}}
 * @param {object} [r.env] - {userAgent, screen, memoryMB, cores}
 * @returns {Array<{name: string, data: string|Uint8Array}>}
 */
export function reportFiles({ happened = '', expected = '', shots = [], log = [], state = {}, player = null, saved = null, learning = [], moneyFields = null, statsHistory = null, env = {}, now = Date.now() }) {
    const errors = log.filter((e) => e.kind === 'error');
    const safe = (n) => String(n || 'screenshot').replace(/[^\w.-]+/g, '_').slice(0, 60);
    const stamp = new Date(now).toISOString();
    const fmt = (v) => Math.round(v).toLocaleString('en-US');
    const lines = [
        'Torn Pumping Iron - problem report',
        'Made ' + stamp + ' (UTC = Torn time)',
        'Version ' + (state.version || '?') + (state.build ? ' (' + state.build + ')' : '') + (env.userAgent ? ' · ' + env.userAgent : '') + (env.screen ? ' · screen ' + env.screen : '') + (env.cores ? ' · ' + env.cores + ' cores' : '') + (env.memoryGB ? ' · ' + env.memoryGB + ' GB' : ''),
        '',
        'WHAT HAPPENED',
        happened.trim() || '(not filled in)',
        '',
        'WHAT I EXPECTED',
        expected.trim() || '(not filled in)',
        '',
        'IN SHORT',
        player ? '  stats ' + ['str', 'spd', 'def', 'dex'].map((k) => k.toUpperCase() + ' ' + fmt(player.stats[k] || 0)).join(' · ') + ' · total ' + fmt(reportTotal(player.stats)) : '  stats: not read yet',
        player ? '  happy maximum ' + fmt(player.happyMax || 0) + ' · energy maximum ' + (player.energyMax || '?') + ' · gym ' + (player.gymId || '?') + ' · build ' + (player.build || '?') : null,
        saved ? '  plan: ' + saved.months + (saved.months === 1 ? ' month, ' : ' months, ') + (saved.rec ? saved.rec.recommended : '?') + ' recommended' : '  plan: none saved',
        (state.runs || []).length ? '  last plan run: ' + state.runs.slice(-1).map((x) => (x.kind === 'replan' ? 'Re-plan' : 'Create plan') + ' ' + (x.months || '?') + (x.months === 1 ? ' month, ' : ' months, ') + (x.ms / 1000).toFixed(1) + ' s' + (x.hiddenMs > 0 ? ' (' + (x.hiddenMs / 1000).toFixed(1) + ' s of it with the tab not in front)' : '') + (x.ok ? '' : ' - ' + (x.error || 'failed')))[0] : null,
        '',
        'ATTACHED',
        shots.length ? shots.map((s, i) => '  screenshots/' + (i + 1) + '-' + safe(s.name)).join('\n') : '  no screenshots',
        '  problem-log.txt - ' + errors.length + ' errors and ' + (log.length - errors.length) + ' other lines, the last 7 days, every tab',
        '  player.json - stats, happy and energy maximum, gym, gyms unlocked, build, the perks read (and the lines not understood)',
        '  plan.json - the saved plan in short: every plan\'s stats and cost, the path, what it was made from',
        '  state.json - version, settings (no keys), the last plan runs with their time, diagnostics',
        '  stats-history.json - your stats at each day\'s last read',
        '  learning/ - your trains from Torn\'s log, the sessions the app saw, fights, what it learned',
        '  money-log-fields.json - your money log by log type: titles and the NAMES of the fields, never an amount',
        '',
        'No API key, player id or name is in these files.',
    ].filter((x) => x !== null);
    const files = [
        { name: 'report.txt', data: lines.join('\n') + '\n' },
        { name: 'problem-log.txt', data: logAsText(log) },
        { name: 'problem-log.json', data: JSON.stringify(log) },
        { name: 'player.json', data: JSON.stringify(player, null, 1) },
        { name: 'plan.json', data: JSON.stringify(planSummary(saved), null, 1) },
        { name: 'state.json', data: JSON.stringify({ kind: REPORT_KIND, v: 1, exportedAt: stamp, ...state, env }, null, 1) },
        { name: 'stats-history.json', data: JSON.stringify(statsHistory || {}) },
        { name: 'money-log-fields.json', data: JSON.stringify(moneyFields || [], null, 1) },
    ];
    for (const f of learning || []) files.push({ name: 'learning/' + f.name, data: f.data });
    shots.forEach((s, i) => files.push({ name: 'screenshots/' + (i + 1) + '-' + safe(s.name), data: s.data }));
    return files;
}

/** The lines Settings shows before anything is made: what the zip will hold. */
export function reportIncludes({ shots = 0, log = [], player = null, saved = null, gymLog = 0, moneyTypes = 0 }) {
    const errors = log.filter((e) => e.kind === 'error').length;
    return [
        'What you wrote above',
        shots ? shots + (shots === 1 ? ' screenshot' : ' screenshots') : 'No screenshots yet',
        'The problem log: ' + errors + (errors === 1 ? ' error' : ' errors') + ' and ' + (log.length - errors) + ' other lines (what you clicked, how long each plan took), the last 7 days, every tab',
        player ? 'Your stats, happy maximum, gym, build and the perks read' : 'Your stats (not read yet)',
        saved ? 'Your saved plan in short (every plan’s stats and cost)' : 'No saved plan yet',
        gymLog ? 'Your trains from Torn’s log (' + gymLog + ' lines) and what the app learned' : 'What the app learned from your trains',
        moneyTypes ? 'Your money log by type (' + moneyTypes + ' types): titles and field names only, never an amount' : 'Money log fields: none read (needs the Full key)',
        'Version and settings: no API key, no player id or name',
    ];
}
