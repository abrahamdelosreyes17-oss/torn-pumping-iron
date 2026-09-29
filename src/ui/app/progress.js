/*
 * Progress (mockups/round3/V-progress.html): one question, "am I on the
 * line?". Total stats against the plan's line, one chart per stat on its own
 * scale, gained against plan each day, and the last trains (what the plan
 * said, what Torn showed). Before any history: the planned line and today,
 * never a "come back tomorrow" paragraph (owner).
 */

import { h, t } from '../dom.js';
import { STATS, STAT_LABEL } from '../../core/gain.js';
import { fmtInt, fmtSigned, fmtMoney, fmtShort, fmtPct } from '../../core/format.js';
import { XANAX, POINTS, REFILL_POINTS } from '../../core/items.js';
import { unitPrice } from '../../core/market.js';
import { STRATEGIES } from '../../core/strategies.js';
import { gymById, GEORGES, GYMS, gymAccess } from '../../core/gyms.js';
import { tornDayStart, DAY } from '../../core/bars.js';
import { lineChart, planBars } from '../charts.js';
import { clock, sectionHead, meta, gainsCard, STAT_COLOR, MONTH_NAMES, DAY_NAMES } from './common.js';
import { sessionsOf } from '../../core/gains.js';
import { summarizeReceipts, spentOverDays, itemsWords, receiptDays, readReceipts, whatIfPeriod, whatIfLines, runWhatIf } from '../../core/receipts.js';

const dayLabel = (d) => new Date(d).getUTCDate() + ' ' + MONTH_NAMES[new Date(d).getUTCMonth()];

/** Plan-vs-actual colour: green within ±20%, yellow 50–79% or 121–150%, red further off. */
export function planColor(ratio) {
    if (ratio >= 0.8 && ratio <= 1.2) return 'good';
    if ((ratio >= 0.5 && ratio < 0.8) || (ratio > 1.2 && ratio <= 1.5)) return 'warn';
    return 'bad';
}

/** Days from the plan's start to show (14, 30 or all), with the plan's cumulative line under them. */
function seriesFor(m, ctx, range) {
    const hist = ctx.history || {};
    const today = tornDayStart(m.now);
    const line = ctx.planProjection && ctx.planProjection.start <= today ? ctx.planProjection : null;
    let days = Object.keys(hist).map(Number).filter((d) => d <= today).sort((a, b) => a - b);
    if (line) days = days.filter((d) => d >= line.start);
    if (range !== 'all') days = days.slice(-range);
    if (!days.length || days[days.length - 1] !== today) days.push(today);
    const actual = days.map((d) => (d === today ? m.total : hist[d] ? hist[d].total : null));
    const first = days[0];
    // The plan line: from the day it was set; before any history, the line from today forward (planned + today).
    const start = line ? line.start : today;
    const base = line ? line.total : m.total;
    const planAt = (d) => {
        const i = Math.round((d - start) / DAY);
        if (i < 0) return null;
        const daily = line ? line.daily : m.compare && m.compare[ctx.plan.strategy] ? m.compare[ctx.plan.strategy].daily : [];
        return i === 0 ? base : daily[Math.min(i - 1, daily.length - 1)] !== undefined ? base + daily[Math.min(i - 1, daily.length - 1)] : null;
    };
    return { days, actual, planAt, first, start, line };
}

function totalChart(m, ctx, s) {
    const onlyToday = s.days.length === 1;
    // With only today, show the plan's line ahead (planned + today).
    const ahead = onlyToday ? 14 : 0;
    const xs = s.days.concat(Array.from({ length: ahead }, (_, i) => s.days[s.days.length - 1] + (i + 1) * DAY));
    const plan = xs.map((d) => s.planAt(d));
    const you = s.actual.concat(Array(ahead).fill(null));
    const lbl = (i) => (onlyToday && i === 0 ? 'today' : dayLabel(xs[i]));
    const labels = [[0, lbl(0)], [xs.length - 1, lbl(xs.length - 1)]];
    const vals = plan.concat(you).filter((v) => v !== null);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return h('div', {}, [
        h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:6px' }, [t('lab', 'Total stats against the plan'), h('span', { class: 'legend2' }, [h('span', {}, [h('i', { style: 'background:var(--chalk)' }), 'you']), h('span', {}, [h('i', { class: 'dash', style: 'color:var(--muted)' }), 'plan'])])]),
        lineChart(
            [
                { name: 'plan', color: 'var(--muted)', dash: '5 4', width: 1.5, values: plan, label: 'plan' },
                { name: 'you', color: 'var(--chalk)', width: 2.5, values: you, label: 'you ' + fmtShort(m.total) },
            ],
            { w: 1000, h: 200, left: 50, right: 110, yMin: lo - (hi - lo) * 0.08, yMax: hi + (hi - lo) * 0.08 || hi * 1.01, grid: [lo, hi], xLabels: labels, n: xs.length, today: onlyToday ? 0 : undefined, label: 'Total stats against the plan' },
        ),
        onlyToday ? h('div', { class: 'note2', text: 'Your line starts today; the dashed line is where the plan takes you. Each day adds a point.' }) : null,
    ]);
}

function statCharts(m, ctx, s) {
    const hist = ctx.history || {};
    const today = tornDayStart(m.now);
    const trains = {};
    for (const st of m.steps) for (const [k, n] of Object.entries(st.trains || {})) trains[k] = (trains[k] || 0) + n;
    const cells = STATS.map((k) => {
        const vals = s.days.map((d) => (d === today ? m.pc.stats[k] : hist[d] ? hist[d][k] : null));
        const known = vals.filter((v) => v !== null);
        const gained = known.length > 1 ? known[known.length - 1] - known[0] : 0;
        const row = m.statRows.find((r) => r.stat === k);
        const what = trains[k] ? trains[k] + ' trains today' : row && row.over ? 'over target, skipped' : 'no trains today';
        // The plan's line for this stat: its share of the plan's gains, over the same days (and 14 ahead on day one).
        const ahead = s.days.length === 1 ? 14 : 0;
        const r = s.line ? { perStat: s.line.perStatGain, gained: s.line.daily[s.line.daily.length - 1], daily: s.line.daily, base: s.line.perStat[k] } : m.compare && m.compare[ctx.plan.strategy] ? { ...m.compare[ctx.plan.strategy], base: m.pc.stats[k] } : null;
        const share = r && r.gained > 0 ? (r.perStat[k] || 0) / r.gained : 0;
        const planVals = r ? s.days.concat(Array.from({ length: ahead }, (_, i) => s.days[s.days.length - 1] + (i + 1) * DAY)).map((d) => {
            const i = Math.round((d - s.start) / DAY);
            return i < 0 ? null : r.base + (i === 0 ? 0 : (r.daily[Math.min(i - 1, r.daily.length - 1)] || 0) * share);
        }) : [];
        const youVals = vals.concat(Array(ahead).fill(null));
        const all = known.concat(planVals.filter((v) => v !== null));
        const lo = Math.min(...all);
        const hi = Math.max(...all);
        const series = [];
        if (share > 0) series.push({ name: 'plan', color: 'var(--muted)', dash: '5 4', width: 1.2, values: planVals, label: false });
        series.push({ name: k, color: STAT_COLOR[k], width: 2, values: youVals.length > 1 ? youVals : [youVals[0], youVals[0]], label: false });
        return h('div', {}, [
            h('div', { class: 't' }, [h('b', { class: 's-' + k, text: STAT_LABEL[k] }), h('span', { text: fmtInt(m.pc.stats[k]) + (gained ? ' · ' + fmtSigned(gained) : '') + ' · ' + what })]),
            lineChart(series, { w: 460, h: 90, left: 4, right: 4, yMin: lo - (hi - lo || hi * 0.01) * 0.1, yMax: hi + (hi - lo || hi * 0.01) * 0.1, n: youVals.length > 1 ? youVals.length : 2, label: STAT_LABEL[k] + ' over the days shown' }),
        ]);
    });
    return h('div', {}, [h('div', { class: 'lab', style: 'margin-bottom:8px', text: 'Each stat · own scale' }), h('div', { class: 'mult num' }, cells)]);
}

function dayBars(m, ctx) {
    const totals = ctx.dayTotals || {};
    const today = tornDayStart(m.now);
    const days = Object.keys(totals).map(Number).filter((d) => d <= today).sort((a, b) => a - b).slice(-14);
    if (!days.includes(today)) days.push(today);
    const pct = days.map((d) => {
        const r = d === today ? { gained: m.gainedToday, planned: m.plannedGain } : totals[d];
        return r && r.planned > 0 ? (100 * (r.gained || 0)) / r.planned : null;
    });
    const labels = days.map((d, i) => (d === today ? 'today' : i === 0 || i % 3 === 0 ? dayLabel(d) : ''));
    const done = days.filter((d) => d < today);
    const onPlan = done.filter((d) => totals[d] && totals[d].planned > 0 && totals[d].gained / totals[d].planned >= 0.95).length;
    return h('div', {}, [
        h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:6px' }, [
            h('span', {}, [t('lab', 'Gained against plan, each day'), done.length ? h('span', { class: 'muted', style: 'margin-left:10px;font-size:12px', text: onPlan + ' of ' + done.length + ' days on plan' }) : null]),
            h('span', { class: 'legend2' }, [h('span', {}, [h('i', { style: 'background:var(--good)' }), 'on plan']), h('span', {}, [h('i', { style: 'background:var(--spd)' }), '75–95%']), h('span', {}, [h('i', { style: 'background:var(--bad)' }), 'under 75%']), h('span', {}, [h('i', { style: 'background:var(--line2)' }), 'today so far'])]),
        ]),
        planBars(pct, labels, { w: 1000, h: 110, partial: days.length - 1, label: 'Stats gained each day as a share of the plan' }),
    ]);
}

function lastTrains(m, ctx) {
    // One row a session (owner: "my 15 trains = +305,123 showed as three rows"), its reads added up.
    const sessions = sessionsOf((ctx.calibration && ctx.calibration.samples) || []).slice(0, 6);
    const offOf = (p, a) => (p > 0 ? (100 * (a - p)) / p : 0);
    const rows = sessions.map((x) => {
        const off = offOf(x.predicted, x.actual);
        const stats = Object.keys(x.trains);
        return h('tr', {}, [
            h('td', { class: 't', text: clock(x.at, ctx.settings) }),
            h('td', { class: stats.length === 1 ? 's-' + stats[0] : null, text: stats.map((k) => STAT_LABEL[k] + ' × ' + x.trains[k]).join(' · ') }),
            h('td', { text: x.gyms.join(' / ') }),
            h('td', { class: 'r', text: fmtSigned(x.predicted) }),
            h('td', { class: 'r', text: fmtSigned(x.actual) }),
            h('td', { class: 'r ' + (Math.abs(off) <= 1 ? 'c-good' : 'c-warn'), text: fmtPct(off, 1) }),
        ]);
    });
    if (rows.length > 1) {
        const p = sessions.reduce((a, x) => a + x.predicted, 0);
        const a = sessions.reduce((s, x) => s + x.actual, 0);
        const off = offOf(p, a);
        rows.push(h('tr', { class: 'total' }, [h('td'), h('td', {}, [h('b', { text: 'Total' })]), h('td'), h('td', { class: 'r', text: fmtSigned(p) }), h('td', { class: 'r' }, [h('b', { text: fmtSigned(a) })]), h('td', { class: 'r ' + (Math.abs(off) <= 1 ? 'c-good' : 'c-warn'), text: fmtPct(off, 1) })]));
    }
    return h('div', {}, [
        sectionHead('Last trains', meta(['what the plan said, what Torn showed']), null, 'h3'),
        rows.length
            ? h('table', { class: 'tbl num' }, [h('thead', {}, [h('tr', {}, [h('th', { style: 'width:64px', text: 'When' }), h('th', { text: 'Session' }), h('th', { text: 'Gym' }), h('th', { class: 'r', text: 'Plan said' }), h('th', { class: 'r', text: 'You got' }), h('th', { class: 'r', style: 'width:80px', text: 'Off by' })])]), h('tbody', {}, rows)])
            : null,
        h('p', { class: 'muted', style: rows.length ? 'margin:6px 0 0;font-size:12px' : 'margin:0', text: 'Only the reads with one stat trained and nothing taken in between (no drug, booster or refill): they check the gain maths, so a session’s total here can be less than what you really gained. Your real gains are under “Your gains”.' }),
    ]);
}

function weekFacts(m, ctx) {
    const totals = ctx.dayTotals || {};
    const today = tornDayStart(m.now);
    const days = Object.keys(totals).map(Number).filter((d) => d > today - 7 * DAY && d <= today);
    const sum = (k) => days.reduce((a, d) => a + ((totals[d] && totals[d][k]) || 0), 0);
    const g = sum('gained');
    const p = sum('planned');
    const xp = unitPrice((ctx.prices || {})[XANAX]) || 0;
    const pp = unitPrice((ctx.prices || {})[POINTS], 300) || 0;
    // Money really spent this week (receipts: every item and refill at that day's price); before receipts, Xanax and refills.
    const spent = spentOverDays(ctx.receipts, days, { priceHistory: ctx.priceHistory, prices: ctx.prices || {} }, (d) => ((totals[d] && totals[d].xanax) || 0) * xp + ((totals[d] && totals[d].refills) || 0) * REFILL_POINTS * pp);
    const first = new Date(today - 6 * DAY);
    return h('div', {}, [
        sectionHead('This week', meta([DAY_NAMES[first.getUTCDay()] + '–' + DAY_NAMES[new Date(today).getUTCDay()] + ' · ' + days.length + ' of 7 days']), null, 'h3'),
        h('dl', { class: 'facts num' }, [
            h('dt', { text: 'Gained' }),
            h('dd', {}, [fmtSigned(g) + (p ? ' of ' + fmtShort(p) : ''), h('div', { class: 'mini' }, [h('i', { style: 'width:' + (p ? Math.min(100, (100 * g) / p) : 0).toFixed(0) + '%' })])]),
            h('dt', { text: 'Xanax' }),
            h('dd', { text: sum('xanax') + ' of ' + sum('xanaxPlanned') }),
            h('dt', { text: 'Refills' }),
            h('dd', { text: sum('refills') + ' of ' + days.length }),
            h('dt', { text: 'Spent' }),
            h('dd', { text: xp || pp ? 'about ' + fmtMoney(spent) : '—' }),
        ]),
    ]);
}

function budgetFacts(m, ctx, s) {
    const days = ctx.settings.horizonDays || 30;
    // Auto mode: the budget is what your income affords over the horizon.
    const auto = m.auto && m.auto.ready && ctx.plan && ctx.plan.pickBy === 'auto' ? m.auto : null;
    const budget = auto ? auto.budget : ctx.settings.budget || 0;
    const line = s.line;
    const dayN = line ? Math.min(days, Math.floor((tornDayStart(m.now) - line.start) / DAY) + 1) : 1;
    const perDay = line ? line.cost / days : m.spend ? m.spend.perDay : 0;
    const spent = perDay * dayN;
    return h('div', {}, [
        sectionHead('Budget', meta([fmtMoney(budget) + ' for ' + days + ' days' + (auto ? ' · Auto, from your income' : '')]), null, 'h3'),
        h('dl', { class: 'facts num' }, [
            h('dt', { text: 'At the plan’s pace' }),
            h('dd', {}, ['about ' + fmtMoney(spent) + ' · day ' + dayN + ' of ' + days, h('div', { class: 'mini' }, [h('i', { style: 'width:' + (budget ? Math.min(100, (100 * spent) / budget) : 0).toFixed(0) + '%;background:var(--muted)' })])]),
            h('dt', { text: 'On pace for' }),
            h('dd', { text: fmtMoney(perDay * days) }),
            m.spend && m.spend.cash !== null ? h('dt', { text: 'Cash on hand' }) : null,
            m.spend && m.spend.cash !== null ? h('dd', { text: fmtMoney(m.spend.cash) + (m.spend.lastsDays !== null ? (m.spend.lastsDays < 1 ? ' · lasts under a day' : ' · lasts ~' + Math.round(m.spend.lastsDays) + ' days') : '') }) : null,
        ]),
    ]);
}

/** The stat furthest behind the build, how far, and when it gets there at the recent pace. */
function buildFacts(m, ctx, s) {
    const behind = m.statRows.filter((r) => !r.over && r.gap > 0).sort((a, b) => b.target - b.share - (a.target - a.share))[0];
    const hist = ctx.history || {};
    const firstDay = s.days.find((d) => hist[d]);
    const pace = firstDay !== undefined && behind ? (m.pc.stats[behind.stat] - hist[firstDay][behind.stat]) / Math.max(1, (tornDayStart(m.now) - firstDay) / DAY) : 0;
    return h('div', {}, [
        sectionHead('Build', meta([m.build.name]), null, 'h3'),
        behind
            ? h('dl', { class: 'facts num' }, [
                  h('dt', { text: STAT_LABEL[behind.stat] + ' share' }),
                  h('dd', {}, [(behind.share * 100).toFixed(1) + '% of ' + (behind.target * 100).toFixed(1) + '%', h('div', { class: 'mini' }, [h('i', { style: 'width:' + Math.min(100, (100 * behind.share) / behind.target).toFixed(0) + '%;background:' + STAT_COLOR[behind.stat] })])]),
                  h('dt', { text: 'To go' }),
                  h('dd', { text: '+' + fmtShort(behind.gap) }),
                  h('dt', { text: 'At this pace' }),
                  h('dd', { text: pace > 0 ? 'about ' + Math.max(1, Math.round(behind.gap / pace)) + ' days' : m.reachedDay !== null && m.reachedDay !== undefined ? 'about ' + m.reachedDay + ' days (plan)' : 'more than 30 days' }),
              ])
            : h('p', { class: 'muted', style: 'margin:0', text: 'On build: every stat at or over its share.' }),
    ]);
}

/** Round-number milestones ahead for the stat the plan trains most, and the total. */
function milestones(m, ctx) {
    const r = ctx.compare && ctx.compare[ctx.plan.strategy];
    if (!r) return null;
    const days = ctx.settings.horizonDays || 30;
    const out = [];
    const main = STATS.filter((k) => r.perStat && r.perStat[k] > 0).sort((a, b) => r.perStat[b] - r.perStat[a])[0];
    const when = (target, cur, daily) => {
        const i = daily.findIndex((v) => cur + v >= target);
        return i < 0 ? null : i + 1;
    };
    const inDays = (d) => 'in ~' + d + ' day' + (d === 1 ? '' : 's');
    const step = (v) => Math.pow(10, Math.floor(Math.log10(Math.max(10, v))));
    const total = m.total;
    const tStep = step(total) / 2;
    const tTarget = Math.ceil((total + 1) / tStep) * tStep;
    const tDay = when(tTarget, total, r.daily);
    if (tDay) out.push([fmtShort(tTarget) + ' total', inDays(tDay)]);
    if (main) {
        const cur = m.pc.stats[main];
        const share = r.perStat[main] / Math.max(1, r.gained);
        const daily = r.daily.map((v) => v * share);
        const st = step(cur);
        for (const target of [Math.ceil((cur + 1) / st) * st, Math.ceil((cur + 1) / st) * st + st]) {
            const d = when(target, cur, daily);
            if (d) out.push([STAT_LABEL[main] + ' ' + fmtShort(target), inDays(d)]);
        }
    }
    if (m.nextGym && m.nextGym.gym) out.push([m.nextGym.gym.name, m.nextGym.known ? 'in ~' + Math.max(1, Math.round(m.nextGym.days)) + ' days' : 'open the gym page once to track it']);
    if (!out.length) return null;
    return h('div', {}, [sectionHead('Next milestones', meta(['at the plan’s pace, ' + days + ' days']), null, 'h3'), h('dl', { class: 'facts num' }, out.flatMap(([a, b]) => [h('dt', { text: a }), h('dd', { text: b })]))]);
}

function gymFacts(m) {
    const top = Math.max(0, ...m.pc.unlocked.filter((id) => id <= GEORGES));
    const specs = (m.pc.table || GYMS).filter((g) => g.id > GEORGES);
    const lines = [h('dt', { text: 'Ladder' }), h('dd', { text: top >= GEORGES ? 'George’s ✓ (all ' + GEORGES + ')' : ((gymById(top, m.pc.table) || {}).name || 'gym ' + top) + ' · ' + (GEORGES - top) + ' to go' })];
    for (const g of specs) {
        const have = m.pc.unlocked.includes(g.id);
        const acc = gymAccess(g, m.pc.stats);
        if (!have && top < GEORGES) continue;
        lines.push(h('dt', { text: g.name }), h('dd', { text: have && acc.ok ? '✓ open to you' : acc.reason || 'not unlocked' }));
    }
    return h('div', {}, [sectionHead('Gyms', null, null, 'h3'), h('dl', { class: 'facts num' }, lines)]);
}

/* ---------- Receipts ---------- */

/** Items, then refills, in words: "Xanax × 3 · EDVD × 5 · Refill × 1". */
export function usedWords(x) {
    const parts = [itemsWords(x.items)];
    if (x.refills > 0) parts.push('Refill × ' + x.refills);
    if (x.special > 0) parts.push('Special refill × ' + x.special);
    return parts.filter(Boolean).join(' · ');
}

/** Energy per 1,000 stats: "5.5", "1,480". */
function rcPerK(v) {
    return v === null ? '—' : v >= 100 ? fmtInt(v) : v.toFixed(v >= 10 ? 1 : 2);
}

/**
 * Today / 7 days / 30 days, and the last 14 days, from the stored receipts.
 * @returns {{cols: [label, summary][], days: {day, s, d}[], any: boolean}}
 */
export function receiptsView(receipts, now, sources = {}) {
    const today = tornDayStart(now);
    const cols = [
        ['Today', today],
        ['7 days', today - 6 * DAY],
        ['30 days', today - 29 * DAY],
    ].map(([label, from]) => [label, summarizeReceipts(receipts, from, today, sources)]);
    const r = readReceipts(receipts);
    const days = receiptDays(receipts)
        .filter((d) => d <= today)
        .slice(-14)
        .reverse()
        .map((d) => ({ day: d, s: summarizeReceipts(receipts, d, d, sources), d: r.days[d] }));
    return { cols, days, any: days.length > 0 };
}

const rcMoney = (s) => (s.cost > 0 ? (s.est ? '~' : '') + fmtMoney(s.cost) : '$0');

function receiptDetail(row, m) {
    const d = row.d;
    const table = (m.pc && m.pc.table) || GYMS;
    const by = Object.entries(d.by || {}).map(([k, [n, e]]) => {
        const [stat, gid] = k.split('@');
        return ((gymById(Number(gid), table) || {}).name || 'Gym ' + gid) + ' · ' + STAT_LABEL[stat] + ' × ' + fmtInt(n) + ' (' + fmtInt(e) + ' E)';
    });
    const gains = STATS.filter((k) => d.gain && d.gain[k] > 0).map((k) => fmtSigned(d.gain[k]) + ' ' + STAT_LABEL[k]);
    const prices = Object.entries(d.px || {}).map(([id, p]) => (id === POINTS ? 'points' : itemsWords({ [id]: 1 }).replace(/ × 1$/, '')) + ' ' + fmtMoney(p));
    const notes = [];
    if (Object.keys(d.guess || {}).length) notes.push(itemsWords(d.guess) + ' not seen in your inventory yet (the plan’s step)');
    if (d.catchUp) notes.push('includes ' + d.catchUp + ' catch-up after Torn Trading ran');
    if (d.est) notes.push('energy worked out around a drug, booster or refill');
    if (row.s.est) notes.push('a price wasn’t seen that day: nearest known price');
    return h('dl', { class: 'facts num', style: 'grid-template-columns:auto 1fr;padding:6px 0 10px' }, [
        h('dt', { text: 'Trained' }),
        h('dd', { style: 'text-align:left', text: by.length ? by.join(' · ') : fmtInt(d.e) + ' E' }),
        h('dt', { text: 'Gained' }),
        h('dd', { style: 'text-align:left', text: gains.join(' · ') || '+0' }),
        prices.length ? h('dt', { text: 'Cheapest that day' }) : null,
        prices.length ? h('dd', { style: 'text-align:left', text: prices.join(' · ') }) : null,
        notes.length ? h('dt', { text: 'Notes' }) : null,
        notes.length ? h('dd', { style: 'text-align:left', text: notes.join('; ') }) : null,
    ]);
}

export function receiptsCard(m, ctx) {
    const v = receiptsView(ctx.receipts, m.now, { priceHistory: ctx.priceHistory, prices: ctx.prices || {} });
    const line = (label, fn) => h('tr', {}, [h('td', { class: 'muted', text: label }), ...v.cols.map(([, s]) => h('td', { class: 'r', text: fn(s) }))]);
    const summary = h('table', { class: 'tbl num rc-sum' }, [
        h('thead', {}, [h('tr', {}, [h('th', { text: '' }), ...v.cols.map(([l]) => h('th', { class: 'r', text: l }))])]),
        h('tbody', {}, [
            line('Energy trained', (s) => fmtInt(s.e) + ' E'),
            line('Trains', (s) => fmtInt(s.n)),
            h('tr', {}, [h('td', { class: 'muted', text: 'Items used' }), ...v.cols.map(([, s]) => h('td', { class: 'r', style: 'white-space:normal', text: usedWords(s) || '—' }))]),
            line('Money spent', rcMoney),
            line('Stats gained', (s) => fmtSigned(s.gained)),
            line('$ per 1,000 stats', (s) => (s.perK === null ? '—' : fmtMoney(s.perK))),
            line('Energy per 1,000 stats', (s) => rcPerK(s.ePerK)),
        ]),
    ]);
    const open = ctx.ui.receiptOpen;
    const rows = [];
    for (const row of v.days) {
        const toggle = () => {
            ctx.ui.receiptOpen = open === row.day ? null : row.day;
            ctx.rerender();
        };
        rows.push(
            h('tr', { class: 'click' + (open === row.day ? ' sel' : ''), tabindex: '0', 'aria-expanded': String(open === row.day), onclick: toggle, onkeydown: (e) => { if (e.key === 'Enter') toggle(); } }, [
                h('td', { class: 't', text: row.day === tornDayStart(m.now) ? 'today' : dayLabel(row.day) }),
                h('td', { class: 'r', text: fmtInt(row.s.e) }),
                h('td', { class: 'r', text: fmtInt(row.s.n) }),
                h('td', { text: usedWords(row.s) || '—' }),
                h('td', { class: 'r', text: rcMoney(row.s) }),
                h('td', { class: 'r', text: fmtSigned(row.s.gained) }),
                h('td', { class: 'r', text: row.s.perK === null ? '—' : fmtMoney(row.s.perK) }),
            ]),
        );
        if (open === row.day) rows.push(h('tr', { class: 'sub' }, [h('td', { colspan: '7' }, [receiptDetail(row, m)])]));
    }
    const any = v.cols.some(([, s]) => s.est);
    return h('div', {}, [
        sectionHead('Receipts', meta(['energy, items and money you trained with']), null, 'h3'),
        summary,
        v.any
            ? h('table', { class: 'tbl num', style: 'margin-top:14px' }, [
                  h('thead', {}, [h('tr', {}, [h('th', { style: 'width:64px', text: 'Day' }), h('th', { class: 'r', text: 'Energy' }), h('th', { class: 'r', text: 'Trains' }), h('th', { text: 'Used' }), h('th', { class: 'r', text: 'Spent' }), h('th', { class: 'r', text: 'Gained' }), h('th', { class: 'r', text: '$ / 1k' })])]),
                  h('tbody', {}, rows),
              ])
            : null,
        h('div', { class: 'note2', text: v.any ? 'Click a day for its gyms, prices and notes.' + (any ? ' ~ a price that day wasn’t seen: the nearest known one.' : '') : 'Receipts start today: each train, drug, booster and refill is added here as Torn shows it.' }),
    ]);
}

/* ---------- What if you'd done another plan ---------- */

/** One colour per plan (never the stat colours); "you" is chalk. */
export const WHAT_IF_COLOR = { steady: '#8fb8e8', dailyChoco: '#e8a33d', chocoJump: '#c79bf0', edvdJump: '#e98fb5', happy99k: '#f06f9f', blissSteady: '#5cc8c0', steadyBoost: '#a6e08a', steadyMax: '#d7d06a', candyXanax: '#f0c8a0', consoleJump: '#9aa8ff', consoleJumpToy: '#9aa8ff', edvdJumpAN: '#e98fb5' };

const whatIfMemo = { key: '', value: null };

/** The plans re-run for the period (heavy: kept until the period or the player's setup changes). */
function whatIfFor(m, ctx, period) {
    // The plan runs depend on the start, the days and (for the budget) the money; a new train only moves the lines.
    const key = JSON.stringify([period.start, period.days.length, Number((period.money || 0).toPrecision(2)), m.shares, m.pc.unlocked, m.pc.perks && m.pc.perks.mult, m.state.happy.maximum, m.state.energy.maximum, ctx.settings.boosterCapH || 24]);
    if (key !== whatIfMemo.key) {
        whatIfMemo.key = key;
        whatIfMemo.value = runWhatIf({ state: m.state, pc: m.pc, shares: m.shares, settings: ctx.settings, prices: ctx.prices || {} }, period).results;
    }
    return whatIfLines(period, whatIfMemo.value);
}

/** The plans switched on: what the user picked, else the recommended plan. */
export function whatIfShown(ui, recommended, ids) {
    const want = Array.isArray(ui.whatIfOn) ? ui.whatIfOn : [recommended];
    return ids.filter((id) => want.includes(id));
}

/** "Steady would have given +1.2M, Choco jump +1.5M over these 14 days". */
export function whatIfSummary(plans, shown, nDays) {
    const parts = shown.filter((id) => plans[id]).map((id) => ((STRATEGIES[id] || {}).short || id) + ' ' + fmtSigned(plans[id].gained));
    if (!parts.length) return '';
    return parts[0].replace(/ ([+−])/, ' would have given $1') + (parts.length > 1 ? ', ' + parts.slice(1).join(', ') : '') + ' over these ' + nDays + ' days';
}

export function whatIfCard(m, ctx) {
    const head = sectionHead('What if you’d done another plan', meta(['your energy, at most your money']), null, 'h3');
    const rangeKey = ctx.ui.progressRange || 14;
    const today = tornDayStart(m.now);
    let days = receiptDays(ctx.receipts).filter((d) => d <= today);
    if (rangeKey !== 'all') days = days.filter((d) => d > today - rangeKey * DAY);
    const sources = { priceHistory: ctx.priceHistory, prices: ctx.prices || {} };
    const period = days.length >= 2 ? whatIfPeriod(ctx.receipts, days, sources) : null;
    if (!period || !m.state || !m.pc) return h('div', {}, [head, h('p', { class: 'muted', style: 'margin:0', text: 'Receipts start today; the comparison appears after two days.' })]);
    const w = whatIfFor(m, ctx, period);
    const ids = Object.keys(w.plans).sort((a, b) => w.plans[b].gained - w.plans[a].gained);
    const rec = m.recommendation && w.plans[m.recommendation.recommended] ? m.recommendation.recommended : ids.includes('steady') ? 'steady' : ids[0];
    const shown = whatIfShown(ctx.ui, rec, ids);
    const toggle = (id) => {
        const cur = whatIfShown(ctx.ui, rec, ids);
        ctx.ui.whatIfOn = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
        ctx.rerender();
    };
    const series = [{ name: 'you', color: 'var(--chalk)', width: 2.5, values: w.real, label: 'you ' + fmtSigned(period.gained) }];
    for (const id of shown) series.push({ name: id, color: WHAT_IF_COLOR[id] || 'var(--muted)', dash: '5 4', width: id === rec ? 2 : 1.5, values: w.plans[id].values, label: ((STRATEGIES[id] || {}).short || id) + ' ' + fmtSigned(w.plans[id].gained) });
    const vals = series.flatMap((s) => s.values);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const n = period.days.length;
    const lastDay = period.days[n - 1].day;
    const chips = ids.map((id) =>
        h('button', { type: 'button', class: 'tk', 'aria-pressed': String(shown.includes(id)), onclick: () => toggle(id) }, [
            h('i'),
            h('span', { style: 'display:inline-block;width:14px;height:2px;background:' + (WHAT_IF_COLOR[id] || 'var(--muted)') }),
            ((STRATEGIES[id] || {}).short || id) + (id === rec ? ' (recommended)' : '') + ' ' + fmtSigned(w.plans[id].gained),
        ]),
    );
    const summary = whatIfSummary(w.plans, shown, n);
    return h('div', {}, [
        head,
        h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:6px' }, [
            h('span', { class: 'muted', style: 'font-size:12px', text: 'You: ' + fmtSigned(period.gained) + ' from ' + fmtInt(period.energy) + ' E and ' + fmtMoney(period.money) }),
            h('span', { class: 'legend2' }, [h('span', {}, [h('i', { style: 'background:var(--chalk)' }), 'you']), h('span', {}, [h('i', { class: 'dash', style: 'color:var(--muted)' }), 'another plan'])]),
        ]),
        lineChart(series, { w: 1000, h: 180, left: 50, right: 150, yMin: lo - (hi - lo || hi * 0.01) * 0.08, yMax: hi + (hi - lo || hi * 0.01) * 0.08, grid: [lo, hi], xLabels: [[0, dayLabel(period.days[0].day)], [n, lastDay === today ? 'today' : dayLabel(lastDay)]], n: n + 1, label: 'Total stats: you against other plans with your energy' }),
        h('div', { class: 'ticks', role: 'group', 'aria-label': 'Plans on the graph', style: 'margin-top:8px' }, chips),
        summary ? h('div', { class: 'note2', text: summary + '. Each plan trains the energy you trained, with its own happy and boosters; one that costs more than you spent only counts what your money covers.' }) : null,
    ]);
}

export function renderProgress(m, ctx) {
    const rangeKey = ctx.ui.progressRange || 14;
    const s = seriesFor(m, ctx, rangeKey === 'all' ? 'all' : rangeKey);
    const hist = ctx.history || {};
    const firstVal = s.days.map((d) => hist[d]).find(Boolean);
    const gained = firstVal ? m.total - firstVal.total : m.gainedToday;
    const planned = s.planAt(tornDayStart(m.now));
    const pct = s.line && planned && planned > s.line.total ? Math.round((100 * (m.total - s.line.total)) / (planned - s.line.total)) : null;
    const strat = STRATEGIES[ctx.plan.strategy] || STRATEGIES.steady;
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Show' }, [14, 30, 'all'].map((n) => h('button', { type: 'button', 'aria-pressed': String(n === rangeKey), onclick: () => { ctx.ui.progressRange = n; ctx.rerender(); }, text: n === 'all' ? 'All' : n + ' days' })));
    const ctl = [
        t('lab', 'Show'),
        seg,
        h('span', { class: 'muted', text: (s.line ? 'since ' + dayLabel(s.line.start) : 'from today') + ' · plan: ' + strat.short + ' · ' + m.build.name }),
        h('span', { class: 'grow' }),
        h('span', { class: pct === null || pct >= 95 ? 'c-good' : 'c-warn' }, [h('b', { text: fmtSigned(gained) }), ' gained' + (pct !== null ? ' · ' + pct + '% of plan' : '')]),
    ];
    const lead = totalChart(m, ctx, s);
    lead.classList.add('lead');
    return {
        ctl: [ctl],
        main: [lead, statCharts(m, ctx, s), dayBars(m, ctx), receiptsCard(m, ctx), whatIfCard(m, ctx), lastTrains(m, ctx)],
        pane: [gainsCard(m), weekFacts(m, ctx), budgetFacts(m, ctx, s), buildFacts(m, ctx, s), milestones(m, ctx), gymFacts(m)].filter(Boolean),
    };
}

