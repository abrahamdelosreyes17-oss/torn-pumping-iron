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
import { clock, sectionHead, meta, STAT_COLOR, MONTH_NAMES, DAY_NAMES } from './common.js';

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
    const samples = ((ctx.calibration && ctx.calibration.samples) || []).slice(-6).reverse();
    const rows = samples.map((x) => {
        const off = x.predicted > 0 ? (100 * (x.actual - x.predicted)) / x.predicted : 0;
        return h('tr', {}, [
            h('td', { class: 't', text: x.at ? clock(x.at, ctx.settings) : '' }),
            h('td', { class: 's-' + x.stat, text: STAT_LABEL[x.stat] + ' × ' + x.trains }),
            h('td', { text: x.gym || '' }),
            h('td', { class: 'r', text: fmtSigned(x.predicted) }),
            h('td', { class: 'r', text: fmtSigned(x.actual) }),
            h('td', { class: 'r ' + (Math.abs(off) <= 1 ? 'c-good' : 'c-warn'), text: fmtPct(off, 1) }),
        ]);
    });
    return h('div', {}, [
        sectionHead('Last trains', meta(['what the plan said, what Torn showed']), null, 'h3'),
        rows.length
            ? h('table', { class: 'tbl num' }, [h('thead', {}, [h('tr', {}, [h('th', { style: 'width:64px', text: 'When' }), h('th', { text: 'Train' }), h('th', { text: 'Gym' }), h('th', { class: 'r', text: 'Plan said' }), h('th', { class: 'r', text: 'You got' }), h('th', { class: 'r', style: 'width:80px', text: 'Off by' })])]), h('tbody', {}, rows)])
            : h('p', { class: 'muted', style: 'margin:0', text: 'Your next train shows here: one stat trained between two reads, with no drug, booster or refill in between, is compared with what the plan said.' }),
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
    const spent = sum('xanax') * xp + sum('refills') * REFILL_POINTS * pp;
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
    const budget = ctx.settings.budget || 0;
    const line = s.line;
    const dayN = line ? Math.min(days, Math.floor((tornDayStart(m.now) - line.start) / DAY) + 1) : 1;
    const perDay = line ? line.cost / days : m.spend ? m.spend.perDay : 0;
    const spent = perDay * dayN;
    return h('div', {}, [
        sectionHead('Budget', meta([fmtMoney(budget) + ' for ' + days + ' days']), null, 'h3'),
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
        main: [lead, statCharts(m, ctx, s), dayBars(m, ctx), lastTrains(m, ctx)],
        pane: [weekFacts(m, ctx), budgetFacts(m, ctx, s), buildFacts(m, ctx, s), milestones(m, ctx), gymFacts(m)].filter(Boolean),
    };
}

