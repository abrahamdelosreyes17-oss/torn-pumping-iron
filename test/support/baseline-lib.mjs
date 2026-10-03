/*
 * Round 7's safety net (ROUND7-PLAN §2.1): every plan for three reference
 * players, as the real Create plan works them out, in one table. An engine
 * change lands alone; the table before and after shows what it moved (and
 * what it cost in time). test/r7-baseline.test.js holds the numbers still;
 * `node test/baseline.mjs` prints the table and the difference from the
 * stored one, `--write` stores a new one once a change is meant.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { createPlan } from '../../src/runtime.js';
import { itemName, ITEMS } from '../../src/core/items.js';
import { STRATEGIES } from '../../src/core/strategies.js';
import { gymById, GYMS } from '../../src/core/gyms.js';
import { PLAYERS, T0, useClock, setNow, setup, noPause, dumpPrices } from './ref.mjs';

const here = dirname(fileURLToPath(import.meta.url));
export const BASELINE_FILE = join(here, '..', 'baseline', 'round7.json');

/** The Plan rules each player's month is worked out under (the budget: Settings' default, $150M for 30 days). */
export const RULES = [
    { id: 'max', pickBy: 'max', settings: null, words: 'Max gains, no budget' },
    { id: 'most', pickBy: 'most', settings: { budget: 150e6, horizonDays: 30 }, words: 'Most stats in $5M a day' },
    // Under what steady costs: the plan for a small budget (R7.1).
    { id: 'small', pickBy: 'most', settings: { budget: 60e6, horizonDays: 30 }, words: 'Most stats in $2M a day' },
    // Every candy priced (the 2024 items dump): which candy each plan takes (R7.1's cost-per-stat rule).
    { id: 'candy', pickBy: 'max', settings: null, prices: 'dump', words: 'Max gains, every candy priced (2024 dump)' },
];

/** The plan lengths timed (months). */
export const LENGTHS = [1, 3, 12];

/**
 * The paths under a budget (session 9): "Most stats in my budget" at these dollars a day, over these months. The
 * path must stay inside the budget and should not total less than the best single plan (`single`, the comparison's
 * pick over the same days): docs/sims/round8/path-vs-single.mjs.
 */
export const PATH_BUDGETS = [5e6, 2e6];
export const PATH_BUDGET_LENGTHS = [3, 12];

const itemsOf = (used = {}) => {
    const out = {};
    for (const [k, v] of Object.entries(used)) if (typeof v === 'number' && v > 0 && (ITEMS[k] || k === 'points' || k === 'special')) out[k] = v;
    return out;
};

/** One plan's row: what the table holds still. */
function rowOf(r) {
    const row = { gained: r.gained, cost: r.cost, energy: r.energyTrained, used: itemsOf(r.used) };
    if (r.candy) row.candy = r.candy.id + 'x' + r.candy.count;
    if (r.booster) row.booster = r.booster.id + 'x' + r.booster.perDay;
    if (r.refill === false) row.refill = false;
    if (r.unlocked && r.unlocked.length) row.gyms = r.unlocked.map((u) => u.gymId);
    if (r.blocked) row.blocked = true;
    return row;
}

async function plan(p, { months, pickBy, settings, prices = null }) {
    setNow(T0);
    setup(p, { plan: { pickBy, pickByPicked: true }, settings, prices: prices === 'dump' ? dumpPrices() : null });
    const t = performance.now();
    const saved = await createPlan({ months, pause: noPause });
    return { saved, ms: performance.now() - t };
}

/**
 * The whole table. `lengths`: which plan lengths to run for the path (12 months
 * takes a second or two a player). `timed`: repeat each run for a steadier time (the test doesn't need it).
 * @returns {Promise<{numbers: object, time: object}>} numbers: what must not move by accident; time: ms, this machine
 */
export async function runBaseline({ lengths = LENGTHS, timed = true } = {}) {
    useClock(T0);
    const numbers = {};
    const time = {};
    for (const [pid, p] of Object.entries(PLAYERS)) {
        const out = { month: {}, path: {}, pathBudget: {} };
        time[pid] = {};
        for (const rule of RULES) {
            const { saved } = await plan(p, { months: 1, pickBy: rule.pickBy, settings: rule.settings, prices: rule.prices });
            const plans = {};
            for (const [id, r] of Object.entries(saved.compare)) if (r) plans[id] = rowOf(r);
            out.month[rule.id] = { days: saved.days, recommended: saved.rec.recommended, plans };
        }
        for (const months of lengths) {
            // The time: the best of three (the first run warms the engine up).
            let best = null;
            let ms = Infinity;
            for (let i = 0; i < (!timed ? 1 : months === 12 ? 2 : 3); i++) {
                const r = await plan(p, { months, pickBy: 'max', settings: null });
                ms = Math.min(ms, r.ms);
                best = r.saved;
            }
            const y = best.year;
            out.path[months] = { days: best.days, gained: y.path.gained, cost: y.path.cost, energy: y.path.energyTrained, low: y.band ? y.band.low : null, high: y.band ? y.band.high : null, plans: y.segments.map((s) => s.strategy + ':' + s.days).join(' ') };
            time[pid][months] = Math.round(ms);
        }
        for (const perDay of PATH_BUDGETS) {
            for (const months of PATH_BUDGET_LENGTHS) {
                const { saved } = await plan(p, { months, pickBy: 'most', settings: { budget: perDay * 30, horizonDays: 30 } });
                const y = saved.year;
                const one = saved.compare[saved.rec.recommended];
                out.pathBudget[perDay / 1e6 + 'M:' + months] = { days: saved.days, budget: perDay * saved.days, gained: y.path.gained, cost: y.path.cost, plans: y.segments.map((s) => s.strategy + ':' + s.days).join(' '), single: saved.rec.recommended, singleGained: one.gained, singleCost: one.cost };
            }
        }
        numbers[pid] = out;
    }
    return { numbers, time };
}

export function readStored() {
    return existsSync(BASELINE_FILE) ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) : null;
}

/** JSON with one plan a line (a change reads as changed lines in a diff). */
export function stringify({ numbers, time }) {
    const lines = ['{', '  "numbers": {'];
    const pids = Object.keys(numbers);
    pids.forEach((pid, pi) => {
        const n = numbers[pid];
        lines.push('    ' + JSON.stringify(pid) + ': {', '      "month": {');
        const rules = Object.keys(n.month);
        rules.forEach((rid, ri) => {
            const m = n.month[rid];
            lines.push('        ' + JSON.stringify(rid) + ': { "days": ' + m.days + ', "recommended": ' + JSON.stringify(m.recommended) + ', "plans": {');
            const ids = Object.keys(m.plans);
            ids.forEach((id, i) => lines.push('          ' + JSON.stringify(id) + ': ' + JSON.stringify(m.plans[id]) + (i < ids.length - 1 ? ',' : '')));
            lines.push('        } }' + (ri < rules.length - 1 ? ',' : ''));
        });
        lines.push('      },', '      "path": {');
        const lens = Object.keys(n.path);
        lens.forEach((len, li) => lines.push('        ' + JSON.stringify(len) + ': ' + JSON.stringify(n.path[len]) + (li < lens.length - 1 ? ',' : '')));
        lines.push('      },', '      "pathBudget": {');
        const keys = Object.keys(n.pathBudget || {});
        keys.forEach((k, ki) => lines.push('        ' + JSON.stringify(k) + ': ' + JSON.stringify(n.pathBudget[k]) + (ki < keys.length - 1 ? ',' : '')));
        lines.push('      }', '    }' + (pi < pids.length - 1 ? ',' : ''));
    });
    lines.push('  },', '  "time": ' + JSON.stringify(time), '}');
    return lines.join('\n') + '\n';
}

const fmtInt = (v) => Math.round(v).toLocaleString('en-US');
const fmtMoney = (v) => (Math.abs(v) >= 1e9 ? '$' + (v / 1e9).toFixed(2) + 'B' : '$' + (v / 1e6).toFixed(1) + 'M');
const usedWords = (used) => Object.entries(used || {}).map(([k, n]) => (k === 'special' ? 'Special refill' : itemName(Number.isNaN(Number(k)) ? k : Number(k))) + ' × ' + fmtInt(n)).join(', ') || '—';
const nameOf = (id) => (STRATEGIES[id] ? STRATEGIES[id].short : id);

/** "edvdJump:12 edvdJump:3 steadyMax:16" → "EDVD jump 15 d → Steady + FHC max 16 d" (stretches of the same plan joined). */
function pathWords(plans) {
    const out = [];
    for (const part of String(plans || '').split(' ').filter(Boolean)) {
        const [id, days] = part.split(':');
        const last = out[out.length - 1];
        if (last && last.id === id) last.days += Number(days);
        else out.push({ id, days: Number(days) });
    }
    return out.map((x) => nameOf(x.id) + ' ' + x.days + ' d').join(' → ');
}

/** The table as markdown (for HANDOFF.md and the commit message). */
export function markdown({ numbers, time }) {
    const out = [];
    for (const [pid, n] of Object.entries(numbers)) {
        out.push('**' + PLAYERS[pid].name + '**', '');
        for (const rule of RULES) {
            const m = n.month[rule.id];
            if (!m) continue;
            out.push(rule.words + ' · ' + m.days + ' days · recommended: ' + nameOf(m.recommended), '', '| Plan | Stats | Cost | Energy | Gyms opened | Items |', '|---|---|---|---|---|---|');
            for (const [id, r] of Object.entries(m.plans).sort((a, b) => b[1].gained - a[1].gained)) out.push('| ' + nameOf(id) + (r.blocked ? ' (doesn’t fit)' : '') + ' | +' + fmtInt(r.gained) + ' | ' + fmtMoney(r.cost) + ' | ' + fmtInt(r.energy) + ' | ' + ((r.gyms || []).map((g) => (gymById(g, GYMS) || {}).name || g).join(', ') || '—') + ' | ' + usedWords(r.used) + (r.refill === false ? ' · no refill' : '') + ' |');
            out.push('');
        }
        out.push('| Length | Path | Stats | Cost | Range | Time (ms) |', '|---|---|---|---|---|---|');
        for (const [len, y] of Object.entries(n.path)) out.push('| ' + len + ' mo (' + y.days + ' d) | ' + pathWords(y.plans) + ' | +' + fmtInt(y.gained) + ' | ' + fmtMoney(y.cost) + ' | ' + (y.low === null ? '—' : '+' + fmtInt(y.low) + ' to +' + fmtInt(y.high)) + ' | ' + (time && time[pid] && time[pid][len] !== undefined ? fmtInt(time[pid][len]) : '—') + ' |');
        out.push('');
        if (n.pathBudget && Object.keys(n.pathBudget).length) {
            out.push('| Budget · length | Path | Stats | Cost (budget) | Best single plan | Path against it |', '|---|---|---|---|---|---|');
            for (const [k, y] of Object.entries(n.pathBudget)) {
                const [b, len] = k.split(':');
                const pct = (100 * (y.gained - y.singleGained)) / y.singleGained;
                out.push('| $' + b + ' a day · ' + len + ' mo (' + y.days + ' d) | ' + pathWords(y.plans) + ' | +' + fmtInt(y.gained) + ' | ' + fmtMoney(y.cost) + ' (' + fmtMoney(y.budget) + (y.cost > y.budget ? ', OVER' : '') + ') | ' + nameOf(y.single) + ' +' + fmtInt(y.singleGained) + ' for ' + fmtMoney(y.singleCost) + ' | ' + (pct >= 0 ? '+' : '') + pct.toFixed(1) + '%' + (pct < -1 ? ' LOSES' : '') + ' |');
            }
            out.push('');
        }
    }
    return out.join('\n');
}

/** What moved between two tables: one line per changed number, "player · rule · plan: field before → after". */
export function diffBaseline(before, after) {
    const out = [];
    const walk = (a, b, path) => {
        if (a === b) return;
        const obj = (x) => x && typeof x === 'object';
        if (obj(a) && obj(b)) {
            for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) walk(a[k], b[k], path.concat(k));
            return;
        }
        if (JSON.stringify(a) !== JSON.stringify(b)) out.push(path.join(' · ') + ': ' + (a === undefined ? '(none)' : JSON.stringify(a)) + ' → ' + (b === undefined ? '(gone)' : JSON.stringify(b)));
    };
    walk(before, after, []);
    return out;
}
