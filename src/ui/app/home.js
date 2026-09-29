/*
 * Home (mockups/round3/S-home.html): one question, "what do I do today?".
 * The Now band and today's steps (the page's primary card), you against the
 * build, the next 7 days; Buy today, Heads-up, the plan in one line and this
 * week in the pane.
 */

import { h, t } from '../dom.js';
import { STATS, STAT_LABEL } from '../../core/gain.js';
import { fmtInt, fmtSigned, fmtMoney, fmtShort } from '../../core/format.js';
import { POINTS, XANAX, REFILL_POINTS, ITEMS } from '../../core/items.js';
import { STRATEGIES } from '../../core/strategies.js';
import { fillCheapest, whereText, priceVerdict, unitPrice } from '../../core/market.js';
import { tornDayStart, DAY } from '../../core/bars.js';
import { itemsUrl, gymUrl, pointsUrl, itemMarketUrl, pointsMarketUrl } from '../../sources/route.js';
import { stackBars } from '../charts.js';
import { clock, cd, sectionHead, meta, trainsText, headsList, STAT_COLOR, DAY_NAMES, MONTH_NAMES } from './common.js';

const DAYS = DAY_NAMES;
const MONTHS = MONTH_NAMES;

function dateLine(now) {
    const d = new Date(now);
    return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
}

/** The step in words: "Take Xanax #2, then train DEX × 27". */
export function stepWords(s) {
    const tr = trainsText(s.trains);
    const then = tr ? ', then train ' + tr : '';
    switch (s.kind) {
        case 'xanax':
            return 'Take ' + s.label + then;
        case 'refill':
            return 'Use your refill' + then;
        case 'special':
            return 'Use ' + s.label.toLowerCase() + then;
        case 'booster':
            return 'Use ' + s.label.replace(', train after each', '') + then;
        case 'natural':
            return tr ? 'Train ' + tr : 'Natural energy';
        case 'stack':
        case 'hold':
            return 'Take ' + s.label;
        case 'jump':
        case 'boost':
            return s.label.replace('train it all', 'train ' + (tr || 'it all'));
        default:
            return s.label + then;
    }
}

/** "George's · +72,335 · 400 energy". */
function stepSub(s) {
    const parts = [];
    const gyms = [...new Set(Object.values(s.gyms || {}).filter(Boolean))];
    if (gyms.length) parts.push(gyms.join(' / '));
    if (s.gain) parts.push(fmtSigned(s.gain));
    if (s.energy) parts.push(fmtInt(s.energy) + ' energy');
    if (s.note) parts.push(s.note);
    return parts.join(' · ');
}

/** One click to the exact Torn page for this step: the gym (Fill is ready there), the items page, the points page. */
function stepLinks(s) {
    const items = (s.items || []).filter((it) => it.id !== POINTS && ITEMS[it.id]);
    const out = [];
    const trains = Object.keys(s.trains || {}).length > 0;
    if (s.kind === 'refill') out.push(h('a', { class: 'btn' + (trains ? '' : ' primary'), href: pointsUrl(), target: '_blank', rel: 'noopener', text: 'Points' }));
    if (items.length) out.push(h('a', { class: 'btn' + (trains ? '' : ' primary'), href: itemsUrl(), target: '_blank', rel: 'noopener', text: 'Items' }));
    if (trains) out.push(h('a', { class: 'btn primary', href: gymUrl(), target: '_blank', rel: 'noopener', text: 'Open the gym' }));
    return out;
}

/** Cheapest fill for one need, from stored listings. */
export function buyRow(need, prices) {
    const p = prices && prices[need.id];
    if (!p || !Array.isArray(p.listings) || !p.listings.length) return { need, fill: null, verdict: null };
    const fill = fillCheapest(p.listings, need.buy, need.id);
    const cheapest = fill.rows[0] ? fill.rows[0].price : null;
    return { need, fill, verdict: priceVerdict(cheapest, p.avg7 || null) };
}

function buyCard(m, ctx) {
    const needs = m.buyToday.filter((n) => n.buy > 0);
    // Home refreshes today's prices too, at most every 5 minutes.
    if (needs.length && ctx.wantPrices) ctx.wantPrices(needs.map((n) => n.id));
    const rows = needs.map((n) => buyRow(n, ctx.prices));
    const total = rows.reduce((a, r) => a + (r.fill ? r.fill.total : 0), 0);
    const trs = rows.map(({ need, fill }) => {
        const first = fill && fill.rows[0];
        const link = first ? first.link : need.id === POINTS ? pointsMarketUrl() : itemMarketUrl(need.id);
        const where = first ? whereText(first) + (fill.rows.length > 1 ? ' + ' + (fill.rows.length - 1) + ' more' : '') : ctx.paused ? 'prices wait while paused' : 'checking prices…';
        const why = need.id === POINTS ? 'for the refill' : 'have ' + need.have + ', need ' + need.need;
        return h('tr', {}, [
            h('td', {}, [h('b', { class: 'w', text: need.name + ' × ' + fmtInt(need.buy) }), h('br'), h('small', { class: 'muted', text: where + ' · ' + why })]),
            h('td', { class: 'r', text: fill ? fmtMoney(fill.total) : '' }),
            h('td', { class: 'r', style: 'width:64px' }, [h('a', { class: 'btn sm', href: link, target: '_blank', rel: 'noopener', text: 'Open' })]),
        ]);
    });
    if (!trs.length) trs.push(h('tr', {}, [h('td', { colspan: '3' }, [h('b', { class: 'w', text: 'Nothing to buy today' }), h('br'), h('small', { class: 'muted', text: 'What you hold covers today’s steps' })])]));
    return h('div', {}, [
        sectionHead('Buy today', h('span', { class: 'meta right num', text: total ? fmtMoney(total) : '' }), null, 'h3'),
        h('table', { class: 'tbl num' }, [h('tbody', {}, trs)]),
        h('div', { class: 'note2' }, [h('a', { href: '#buy', onclick: (e) => { e.preventDefault(); ctx.go('buy'); }, text: 'Deals and the rest of the week → Buy' })]),
    ]);
}

/** Share bar against the target, "24.9% → 27.8%", what's left, and today's trains. */
function youVsBuild(m) {
    const tot = {};
    for (const st of m.steps) for (const [k, n] of Object.entries(st.trains || {})) tot[k] = (tot[k] || 0) + n;
    const only = Object.keys(tot).length === 1 ? Object.keys(tot)[0] : null;
    const rows = m.statRows.map((r) => {
        const k = r.stat;
        const trains = tot[k] || 0;
        const toGo = r.over ? 'over' : r.gap > 0 ? '+' + fmtShort(r.gap) + ' to go' : 'on target';
        const tod = trains ? h('span', { class: 'tod s-' + k, text: trains + ' train' + (trains === 1 ? '' : 's') }) : h('span', { class: 'tod muted', text: r.over ? 'skip' : 'later' });
        return h('div', { class: 'sgr' }, [
            h('b', { class: 'n s-' + k, text: STAT_LABEL[k] }),
            h('span', { class: 'v', text: fmtInt(r.value) }),
            h('div', { class: 'share' }, [h('i', { style: 'width:' + Math.min(100, r.share * 100).toFixed(1) + '%;background:' + STAT_COLOR[k] }), h('em', { style: 'left:' + Math.min(100, r.target * 100).toFixed(1) + '%' })]),
            h('span', { class: 'gap', text: (r.share * 100).toFixed(1) + '% → ' + (r.target * 100).toFixed(1) + '%' }),
            h('span', { class: 'gap', text: toGo }),
            tod,
        ]);
    });
    const metaParts = [fmtInt(m.total) + ' total'];
    return h('div', {}, [
        sectionHead('You vs ' + m.build.name, meta([...metaParts, only ? ' · today every train goes to ' : '', only ? h('b', { style: 'color:var(--' + only + ')', text: STAT_LABEL[only] }) : ''])),
        h('div', { class: 'sg num' }, rows),
        buildFoot(m),
    ]);
}

function buildFoot(m) {
    const foot = [];
    if (m.reachedDay !== null && m.reachedDay !== undefined) foot.push(h('span', {}, [m.build.name + ' in ', h('b', { text: m.reachedDay === 0 ? 'now' : 'about ' + m.reachedDay + ' day' + (m.reachedDay === 1 ? '' : 's') })]));
    if (m.nextGym && m.nextGym.gym) foot.push(h('span', {}, [m.nextGym.gym.name + ' ', h('b', { text: m.nextGym.known ? 'in ' + fmtInt(m.nextGym.energyLeft) + ' E' : 'next' }), m.nextGym.known ? ' (about ' + Math.max(1, Math.round(m.nextGym.days)) + ' days)' : ' · open Torn’s gym page once to track it']));
    return foot.length ? h('div', { class: 'sgfoot num' }, foot) : null;
}

/** Next 7 days: stats gained a day, split by the stats trained. */
function weekChart(m) {
    const days = m.projection || [];
    if (!days.length) return null;
    const start = new Date(m.now).getUTCDay();
    const perDay = days.map((d) => {
        const trains = STATS.reduce((a, k) => a + (d[k] || 0), 0) || 1;
        return STATS.filter((k) => d[k]).map((k) => ({ c: STAT_COLOR[k], v: ((d.gain || 0) * d[k]) / trains }));
    });
    const totals = days.map((d) => d.gain || 0);
    const used = STATS.filter((k) => days.some((d) => d[k]));
    const legend = h('span', { class: 'legend2' }, used.map((k) => h('span', {}, [h('i', { style: 'background:' + STAT_COLOR[k] }), STAT_LABEL[k]])));
    return h('div', {}, [
        h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:6px' }, [t('lab', 'Next 7 days · stats gained a day'), legend]),
        stackBars(perDay, days.map((_, i) => DAYS[(start + i) % 7]), { w: 1000, h: 84, top: totals.map((v) => '+' + fmtShort(v)), label: 'Stats gained each of the next 7 days' }),
    ]);
}

/** This week from the recorded day totals (Tue–Mon style: the last 7 Torn days, today included). */
function weekCard(m, ctx) {
    const totals = ctx.dayTotals || {};
    const today = tornDayStart(m.now);
    const days = Object.keys(totals).map(Number).filter((d) => d > today - 7 * DAY && d <= today).sort((a, b) => a - b);
    const sum = (k) => days.reduce((a, d) => a + ((totals[d] && totals[d][k]) || 0), 0);
    const gained = sum('gained');
    const planned = sum('planned');
    const xan = sum('xanax');
    const xanP = sum('xanaxPlanned');
    const refills = sum('refills');
    const xp = unitPrice((ctx.prices || {})[XANAX]) || 0;
    const pp = unitPrice((ctx.prices || {})[POINTS], 300) || 0;
    const spent = xan * xp + refills * REFILL_POINTS * pp;
    const pct = planned > 0 ? Math.min(100, (100 * gained) / planned) : 0;
    return h('div', {}, [
        sectionHead('This week', meta([days.length ? days.length + ' day' + (days.length === 1 ? '' : 's') + ' recorded' : 'from today']), null, 'h3'),
        h('dl', { class: 'facts num' }, [
            h('dt', { text: 'Gained' }),
            h('dd', {}, [fmtSigned(gained) + (planned ? ' of ' + fmtShort(planned) : ''), h('div', { class: 'mini' }, [h('i', { style: 'width:' + pct.toFixed(0) + '%' })])]),
            h('dt', { text: 'Xanax' }),
            h('dd', { text: xan + (xanP ? ' of ' + xanP : '') }),
            h('dt', { text: 'Refills' }),
            h('dd', { text: refills + ' of ' + Math.max(1, days.length) }),
            h('dt', { text: 'Spent' }),
            h('dd', { text: xp || pp ? 'about ' + fmtMoney(spent) : '—' }),
        ]),
    ]);
}

function planLine(m, ctx) {
    const plan = ctx.plan;
    const strat = STRATEGIES[plan.strategy] || STRATEGIES.steady;
    const r = ctx.compare && ctx.compare[plan.strategy];
    const days = ctx.settings.horizonDays || 30;
    const perDay = r ? Math.round(((r.used && r.used[XANAX]) || 0) / days) : null;
    const sub = r ? (perDay ? perDay + ' Xanax' : 'no Xanax') + ((r.used && r.used[POINTS]) ? ' + refill' : '') + ' a day · +' + fmtShort(r.gained) + ' in ' + days + ' days' : strat.what;
    return h('div', {}, [
        h('div', { class: 'one' }, [
            h('div', {}, [t('lab', 'Plan'), h('div', {}, [h('b', { class: 'white', text: strat.short + ' · ' + m.build.name })]), h('span', { class: 'muted', style: 'font-size:12px', text: sub })]),
            h('a', { class: 'btn sm', href: '#plan', onclick: (e) => { e.preventDefault(); ctx.go('plan'); }, text: 'Change' }),
        ]),
    ]);
}

export function renderHome(m, ctx) {
    const s = ctx.settings;
    const now = m.now;
    const next = m.next;
    const late = next && next.kind === 'xanax' && m.strip.drug.left === 0;
    const buyTotal = m.buyToday.reduce((a, n) => {
        const r = buyRow(n, ctx.prices);
        return a + (r.fill ? r.fill.total : 0);
    }, 0);

    const head = sectionHead(
        'Today',
        meta([
            dateLine(now) + ' · ',
            h('b', { text: fmtSigned(m.plannedGain) }),
            ' planned',
            buyTotal ? ' · ' + fmtMoney(buyTotal) + ' to spend' : '',
            ' · ',
            h('b', { style: late ? 'color:var(--warn)' : null, text: late ? 'Xanax ready' : 'on plan' }),
        ]),
    );

    const nowBand = next
        ? h('div', { class: 'nowb num' }, [
              next.at > now ? cd(next.at, now, { cls: 'cd' }) : h('span', { class: 'k', text: 'NOW' }),
              h('div', {}, [h('b', { text: stepWords(next) }), h('br'), h('span', { class: 's', text: stepSub(next) })]),
              h('div', { class: 'acts' }, stepLinks(next)),
          ])
        : h('div', { class: 'nowb num' }, [h('span', { class: 'k', text: 'DONE' }), h('div', {}, [h('b', { text: 'Nothing left today' }), h('br'), h('span', { class: 's', text: 'Tomorrow’s plan starts at 00:00 Torn time' })]), h('div')]);

    const rows = [];
    for (const d of m.done) rows.push(h('tr', { class: 'done' }, [h('td', { class: 't', text: clock(d.at, s) }), h('td', { text: d.label }), h('td', { text: Object.keys(d.trained || {}).map((k) => STAT_LABEL[k]).join(' · ') || '—' }), h('td', { class: 'r', text: d.gain ? fmtSigned(d.gain) : '' }), h('td', { class: 'r ok', text: 'Done' })]));
    m.steps.slice(next ? 1 : 0).forEach((st) => {
        const k = Object.keys(st.trains || {});
        rows.push(
            h('tr', {}, [
                h('td', { class: 't', text: clock(st.at, s) }),
                h('td', {}, [h('b', { class: 'w', text: st.label })]),
                h('td', {}, [h('span', { class: k.length === 1 ? 's-' + k[0] : null, text: trainsText(st.trains) || '—' })]),
                h('td', { class: 'r', text: st.gain ? fmtSigned(st.gain) : '' }),
                h('td', { class: 'r muted' }, [st.at > now ? cd(st.at, now, { cls: 'when' }) : h('span', { class: 'when', text: 'now' })]),
            ]),
        );
    });
    const steps = rows.length
        ? h('table', { class: 'tbl num', style: 'margin-top:8px' }, [
              h('thead', {}, [h('tr', {}, [h('th', { style: 'width:64px', text: 'When' }), h('th', { text: 'Step' }), h('th', { style: 'width:150px', text: 'Train' }), h('th', { class: 'r', style: 'width:110px', text: 'Gain' }), h('th', { class: 'r', style: 'width:110px', text: 'In' })])]),
              h('tbody', {}, rows),
          ])
        : null;
    const foot = h('div', { class: 'row muted num', style: 'justify-content:space-between;margin-top:6px;font-size:12px' }, [h('span', {}, ['So far ', h('b', { class: 'white', text: fmtSigned(m.gainedToday) }), ' of ' + fmtInt(m.plannedGain) + ' today']), h('span', { text: 'Late for a step? The rest move by themselves.' })]);

    const lead = h('div', { class: 'lead' }, [head, nowBand, steps, foot]);
    const week = weekChart(m);
    return {
        strip: true,
        main: [lead, youVsBuild(m), week].filter(Boolean),
        pane: [buyCard(m, ctx), h('div', {}, [sectionHead('Heads-up', null, null, 'h3'), headsList(m.heads.length ? m.heads : [{ tone: 'good', text: 'Nothing needs you' }], (tab) => ctx.go(tab))]), planLine(m, ctx), weekCard(m, ctx)],
    };
}
