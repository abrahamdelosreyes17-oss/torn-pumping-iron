/*
 * Home (mockups/K-home.html): the next step, today's steps, stats against
 * the build; Buy today, Heads-up and the current plan in the pane.
 */

import { h, t } from '../dom.js';
import { STAT_LABEL } from '../../core/gain.js';
import { fmtInt, fmtSigned, fmtMoney } from '../../core/format.js';
import { POINTS } from '../../core/items.js';
import { STRATEGIES } from '../../core/strategies.js';
import { fillCheapest, whereText, priceVerdict } from '../../core/market.js';
import { itemsUrl, gymUrl, pointsUrl, itemMarketUrl, pointsMarketUrl } from '../../sources/route.js';
import { clock, cd, sectionHead, meta, trainsText, statRowsBlock, headsList } from './common.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

function stepSub(s) {
    const parts = [];
    const gyms = [...new Set(Object.values(s.gyms || {}).filter(Boolean))];
    if (gyms.length) parts.push('At ' + gyms.join(' / '));
    if (s.gain) parts.push('about ' + fmtSigned(s.gain) + (Object.keys(s.trains).length === 1 ? ' ' + STAT_LABEL[Object.keys(s.trains)[0]] : ''));
    if (s.energy) parts.push('uses ' + fmtInt(s.energy) + ' energy');
    if (s.note) parts.push(s.note);
    return parts.join(' · ');
}

function stepLinks(s) {
    const items = (s.items || []).filter((it) => it.id !== POINTS);
    const out = [];
    if (s.kind === 'refill') out.push(h('a', { class: 'btn primary', href: pointsUrl(), target: '_blank', rel: 'noopener', text: 'Points' }));
    if (items.length) out.push(h('a', { class: 'btn primary', href: itemsUrl(), target: '_blank', rel: 'noopener', text: 'Items' }));
    if (Object.keys(s.trains || {}).length) out.push(h('a', { class: 'btn' + (out.length ? '' : ' primary'), href: gymUrl(), target: '_blank', rel: 'noopener', text: 'Gym' }));
    return out;
}

/** Cheapest fill for one need, from stored listings. */
export function buyRow(need, prices, history) {
    const p = prices && prices[need.id];
    if (!p || !Array.isArray(p.listings) || !p.listings.length) return { need, fill: null, verdict: null };
    const fill = fillCheapest(p.listings, need.buy, need.id);
    const cheapest = fill.rows[0] ? fill.rows[0].price : null;
    return { need, fill, verdict: priceVerdict(cheapest, p.avg7 || null) };
}

function buyPane(m, ctx) {
    const needs = m.buyToday.filter((n) => n.buy > 0);
    // Home refreshes today's prices too, at most every 5 minutes (ENGINE-SPEC §13).
    if (needs.length && ctx.wantPrices) ctx.wantPrices(needs.map((n) => n.id));
    const held = m.buyToday.filter((n) => n.have > 0);
    const rows = needs.map((n) => buyRow(n, ctx.prices));
    const total = rows.reduce((a, r) => a + (r.fill ? r.fill.total : 0), 0);
    const list = h('div', { class: 'buy num' }, [
        ...rows.map(({ need, fill, verdict }) => {
            const first = fill && fill.rows[0];
            const link = first ? first.link : need.id === POINTS ? pointsMarketUrl() : itemMarketUrl(need.id);
            const where = first ? whereText(first) + (fill.rows.length > 1 ? ' + ' + (fill.rows.length - 1) + ' more' : '') + (verdict && verdict.pct !== null ? ' · ' + verdict.text.split(' · ')[1] : '') : 'Prices load on the Buy tab';
            return h('div', { class: 'bi' }, [
                h('div', {}, [h('b', { text: need.name + ' × ' + need.buy })]),
                h('span', { class: 'p', text: fill ? fmtMoney(fill.total) : '' }),
                h('a', { class: 'btn sm', href: link, target: '_blank', rel: 'noopener', text: 'Open' }),
                h('small', { text: need.id === POINTS ? where + ' · for the refill' : where }),
            ]);
        }),
        needs.length ? null : h('div', { class: 'bi' }, [h('div', {}, [h('b', { text: 'Nothing to buy today' })]), h('span'), h('span'), h('small', { text: 'Your inventory covers the plan' })]),
        h('div', { class: 'buyfoot' }, [h('span', { text: held.length ? held.map((n) => n.have + ' ' + n.name + ' in inventory').join(' · ') : 'Nothing held yet' }), h('b', { text: total ? fmtMoney(total) : '' })]),
    ]);
    return h('div', {}, [sectionHead('Buy today', h('span', { class: 'meta' }, [h('a', { href: '#buy', onclick: (e) => { e.preventDefault(); ctx.go('buy'); }, text: 'Next 3 days' })])), list]);
}

export function renderHome(m, ctx) {
    const s = ctx.settings;
    const now = m.now;
    const next = m.next;
    const mainStat = (() => {
        const tot = {};
        for (const st of m.steps) for (const [k, n] of Object.entries(st.trains || {})) tot[k] = (tot[k] || 0) + n;
        const ks = Object.keys(tot);
        return ks.length === 1 ? ks[0] : null;
    })();
    const late = next && next.kind === 'xanax' && m.strip.drug.left === 0;
    const buyTotal = m.buyToday.reduce((a, n) => {
        const r = buyRow(n, ctx.prices);
        return a + (r.fill ? r.fill.total : 0);
    }, 0);

    const head = sectionHead(
        'Today',
        meta([
            dateLine(now) + ' · planned ',
            h('b', { style: mainStat ? 'color:var(--' + mainStat + ')' : null, text: fmtSigned(m.plannedGain) + (mainStat ? ' ' + STAT_LABEL[mainStat] : '') }),
            buyTotal ? ' · ' + fmtMoney(buyTotal) : '',
            ' · ',
            h('b', { style: late ? 'color:var(--warn)' : null, text: late ? 'Xanax ready' : 'on plan' }),
        ]),
    );

    const nextBand = next
        ? h('div', { class: 'next num' }, [
              next.at > now ? cd(next.at, now, { cls: 'cd' }) : h('span', { class: 'cd', text: 'Now' }),
              h('div', { class: 'what' }, [h('b', { text: stepWords(next) }), h('span', { text: stepSub(next) })]),
              h('div', { class: 'acts' }, stepLinks(next)),
          ])
        : h('div', { class: 'next num' }, [h('span', { class: 'cd', text: '—' }), h('div', { class: 'what' }, [h('b', { text: 'Nothing left today' }), h('span', { text: 'Tomorrow’s plan starts at 00:00 Torn time' })]), h('div')]);

    const rows = [];
    for (const d of m.done) rows.push(h('tr', { class: 'done' }, [h('td', { class: 't', text: clock(d.at, s) }), h('td', { text: d.label }), h('td', { text: Object.keys(d.trained || {}).map((k) => STAT_LABEL[k]).join(' · ') || '—' }), h('td', { class: 'r', text: d.gain ? fmtSigned(d.gain) : '' }), h('td', { class: 'r ok', text: 'Done' })]));
    m.steps.forEach((st, i) => {
        rows.push(
            h('tr', { class: i === 0 ? 'now' : null }, [
                h('td', { class: 't', text: clock(st.at, s) }),
                h('td', { text: st.label }),
                h('td', { text: trainsText(st.trains) || '—' }),
                h('td', { class: 'r', text: st.gain ? fmtSigned(st.gain) : '' }),
                h('td', { class: 'r' }, [st.at > now ? cd(st.at, now, { prefix: 'in ', cls: 'when' }) : h('span', { class: 'when', text: 'now' })]),
            ]),
        );
    });
    const steps = h('table', { class: 'tbl num' }, [
        h('thead', {}, [h('tr', {}, [h('th', { text: 'Time' }), h('th', { text: 'Step' }), h('th', { text: 'Train' }), h('th', { class: 'r', text: 'Gain' }), h('th', { class: 'r' })])]),
        h('tbody', {}, rows),
        h('tfoot', {}, [h('tr', {}, [h('td'), h('td', { colspan: '2' }, ['So far ', h('b', { text: fmtSigned(m.gainedToday) }), ' of ' + fmtSigned(m.plannedGain)]), h('td', { class: 'r', colspan: '2', text: 'Late on a step? The rest move with it.' })])]),
    ]);

    const foot = [];
    if (m.reachedDay !== null && m.reachedDay !== undefined) foot.push(h('span', {}, [m.build.name + ' in ', h('b', { text: m.reachedDay === 0 ? 'now' : 'about ' + m.reachedDay + ' day' + (m.reachedDay === 1 ? '' : 's') })]));
    if (m.nextGym && m.nextGym.gym) foot.push(h('span', {}, [m.nextGym.gym.name + ' ', h('b', { text: m.nextGym.known ? 'in ' + fmtInt(m.nextGym.energyLeft) + ' E' : 'next' }), m.nextGym.known ? ' (about ' + Math.max(1, Math.round(m.nextGym.days)) + ' days)' : ' · open Torn’s gym page once to track it']));

    const stats = h('div', {}, [sectionHead('Stats', meta(['against ' + m.build.name + ' build · ' + fmtInt(m.total) + ' total'])), statRowsBlock(m), h('div', { class: 'sgfoot num' }, foot)]);

    const plan = ctx.plan;
    const strat = STRATEGIES[plan.strategy] || STRATEGIES.steady;
    const planCard = h('div', { class: 'plan' }, [h('div', {}, [h('b', { text: strat.short + ' · ' + m.build.name + ' build' }), h('br'), h('span', { text: strat.what })]), h('div', { class: 'grow' }), h('a', { class: 'btn', href: '#plan', onclick: (e) => { e.preventDefault(); ctx.go('plan'); }, text: 'Change' })]);

    return {
        main: [h('div', {}, [head, nextBand]), steps, stats],
        pane: [buyPane(m, ctx), h('div', {}, [sectionHead('Heads-up'), headsList(m.heads.length ? m.heads : [{ tone: 'good', text: 'Nothing needs you' }])]), planCard],
    };
}
