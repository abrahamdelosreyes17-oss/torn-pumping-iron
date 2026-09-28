/*
 * Buy (mockups/M-buy.html): what the plan needs for today / 3 days / a week,
 * minus what you hold, filled from the cheapest listings across the Item
 * Market, bazaars (TornW3B) and the points market, each with a link to
 * that exact listing. You buy by hand.
 */

import { h, t, sparkline } from '../dom.js';
import { fmtInt, fmtMoney } from '../../core/format.js';
import { itemName, POINTS, XANAX, ECSTASY, EDVD, FHC, CANDY_KISSES } from '../../core/items.js';
import { itemsNeeded } from '../../core/plan.js';
import { tornDayStart, DAY } from '../../core/bars.js';
import { needList, fillCheapest, priceVerdict, whereText, WINDOWS } from '../../core/market.js';
import { W3B_SITE_URL } from '../../api/w3b.js';
import { sectionHead, meta } from './common.js';

const WINDOW_LABEL = { today: 'Today', three: '3 days', week: 'Week' };
const TRACKED = [XANAX, POINTS, ECSTASY, EDVD];

/** The plan's needs for a window: today's steps, plus later days at the plan's daily average. */
export function needsForWindow(m, compare, plan, windowKey, horizonDays) {
    const days = WINDOWS[windowKey] || 1;
    const today = itemsNeeded(m.steps.filter((s) => s.at < tornDayStart(m.now) + DAY));
    if (days <= 1) return today;
    const r = compare && compare[plan.strategy];
    const out = { ...today };
    if (r) {
        for (const [id, n] of Object.entries(r.used || {})) {
            const extra = ((n || 0) / (horizonDays || 30)) * (days - 1);
            if (extra > 0) out[id] = Math.ceil((out[id] || 0) + extra - 1e-9);
        }
    }
    return out;
}

function agoText(at, now) {
    if (!at) return 'not yet';
    const s = Math.max(0, Math.round((now - at) / 1000));
    return s < 90 ? s + 's ago' : Math.round(s / 60) + ' min ago';
}

export function renderBuy(m, ctx) {
    const s = ctx.settings;
    const win = s.buyWindow || 'three';
    const needs = needList(needsForWindow(m, ctx.compare, ctx.plan, win, s.horizonDays), ctx.statics.inventory || {});
    const toBuy = needs.filter((n) => n.buy > 0);
    ctx.wantPrices(toBuy.map((n) => n.id).concat(TRACKED));
    const prices = ctx.prices || {};
    let total = 0;
    const blocks = toBuy.map((n) => {
        const p = prices[n.id];
        const fill = p && p.listings ? fillCheapest(p.listings, n.buy, n.id) : null;
        if (fill) total += fill.total;
        const v = fill && fill.rows[0] ? priceVerdict(fill.rows[0].price, p.avg7 || null, { slack: n.have > 0 }) : null;
        const vColor = !v ? 'var(--dim)' : v.kind === 'buy' || v.kind === 'bulk' ? 'var(--good)' : v.kind === 'wait' ? 'var(--warn)' : 'var(--dim)';
        const perDay = WINDOWS[win] > 1 ? Math.round((n.need / WINDOWS[win]) * 10) / 10 + ' a day' : n.need + ' today';
        const rows = fill
            ? fill.rows.map((r) =>
                  h('tr', {}, [
                      h('td', {}, [h('b', { class: 'w', text: whereText(r) }), h('small', { text: ' · ' + (r.listed > r.qty ? r.listed + ' listed, take ' + r.qty : r.listed + ' listed') })]),
                      h('td', { class: 'r' }, [h('b', { class: 'w', text: fmtInt(r.qty) })]),
                      h('td', { class: 'r', text: fmtMoney(r.price) }),
                      h('td', { class: 'r', text: '$' + fmtInt(r.subtotal) }),
                      h('td', { class: 'r' }, [h('a', { class: 'btn sm', href: r.link, target: '_blank', rel: 'noopener', text: r.source === 'bazaar' ? 'Open bazaar' : r.source === 'points' ? 'Open points' : 'Open market' })]),
                  ]),
              )
            : [h('tr', {}, [h('td', { colspan: '5', class: 'muted', text: p && p.error ? 'Prices could not load: ' + p.error : 'Checking prices…' })])];
        return h('div', { class: 'item num' }, [
            h('div', { class: 'ih' }, [h('b', { text: n.name + ' × ' + fmtInt(n.buy) }), h('span', { class: 'need', text: perDay + (n.have ? ', ' + n.have + ' in inventory' : '') + (n.id === POINTS ? ' · for the refill' : '') }), h('span', { class: 'sum', text: fill ? fmtMoney(fill.total) : '' })]),
            v ? h('div', { class: 'verdict' }, [h('i', { style: 'background:' + vColor }), v.pct !== null ? h('span', {}, [h('b', { style: 'color:' + vColor, text: v.text.split(' · ')[0] }), h('span', { class: 'muted', text: ' · ' + v.text.split(' · ')[1] + ' (' + fmtMoney(Math.round(p.avg7)) + ')' })]) : h('span', { class: 'muted', text: 'Price history starts today: a verdict after two days' })]) : null,
            fill && fill.short > 0 ? h('div', { class: 'msg bad', text: 'Only ' + fill.filled + ' listed at these prices' }) : null,
            h('table', { class: 'tbl' }, [h('thead', {}, [h('tr', {}, [h('th', { text: 'Where' }), h('th', { class: 'r', style: 'width:80px', text: 'Take' }), h('th', { class: 'r', style: 'width:120px', text: 'Each' }), h('th', { class: 'r', style: 'width:130px', text: 'Subtotal' }), h('th', { style: 'width:130px' })])]), h('tbody', {}, rows)]),
        ]);
    });

    const held = needs.filter((n) => n.have > 0).map((n) => n.have + ' ' + n.name);
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Window', style: 'margin-top:6px' }, Object.keys(WINDOWS).map((k) => h('button', { type: 'button', 'aria-pressed': String(k === win), onclick: () => ctx.setSettings({ buyWindow: k }), text: WINDOW_LABEL[k] })));
    const summary = toBuy.map((n) => fmtInt(n.buy) + ' ' + (n.id === POINTS ? 'points' : n.name)).join(' and ');
    const top = h('div', { class: 'prime num', style: 'grid-template-columns:auto 1fr auto' }, [
        h('div', {}, [t('lab', 'Buy for'), seg]),
        h('div', { class: 'd', style: 'padding-left:12px', text: (summary || 'Nothing to buy') + (held.length ? ' · you have ' + held.join(', ') : '') + ' · cheapest first across the Item Market, bazaars and the points market' }),
        h('div', { style: 'text-align:right' }, [t('lab', 'Total'), h('div', { class: 'big', text: total ? fmtMoney(total) : '$0' })]),
    ]);

    const now = m.now;
    const spark = TRACKED.map((id) => {
        const p = prices[id] || {};
        const lows = p.lows7 || [];
        const cheapest = p.listings && p.listings.length ? Math.min(...p.listings.map((l) => l.price)) : null;
        const v = cheapest && p.avg7 ? priceVerdict(cheapest, p.avg7) : null;
        const inPlan = toBuy.some((n) => n.id === id);
        return h('div', { class: 'pr' }, [h('b', { text: itemName(id) }), sparkline(lows, { color: inPlan ? '#efebe2' : '#6c737a' }), h('span', { class: 'r ' + (v && v.pct > 3 ? 'c-warn' : !inPlan ? 'muted' : '') }, [cheapest ? fmtMoney(cheapest) : '—', v && v.pct !== null ? h('span', { class: v.pct < 0 ? 'c-good' : 'muted', text: ' ' + (v.pct >= 0 ? '+' : '−') + Math.abs(v.pct).toFixed(1) + '%' }) : null])]);
    });
    const notInPlan = [ECSTASY, EDVD, CANDY_KISSES, FHC].filter((id) => !toBuy.some((n) => n.id === id)).map(itemName);
    const im = Object.values(prices).map((p) => p.imAt || 0);
    const bz = Object.values(prices).map((p) => p.w3bAt || 0);
    const pane = [
        h('div', {}, [sectionHead('7-day prices', meta(['lowest listing we saw each day'])), h('div', { class: 'num' }, spark)]),
        notInPlan.length ? h('div', {}, [sectionHead('Not in your plan', null, null, 'h3'), h('details', { class: 'dis' }, [h('summary', { text: notInPlan.join(', ') }), h('p', { class: 'muted', style: 'margin:6px 0 0;font-size:12px', text: 'Your plan doesn’t use them. Pick a jump in Plan and they show here with sellers.' })])]) : null,
        h('div', {}, [sectionHead('Where prices come from', null, null, 'h3'), h('dl', { class: 'kv' }, [h('dt', { text: 'Item Market' }), h('dd', { text: 'Torn API · ' + agoText(Math.max(0, ...im), now) }), h('dt', { text: 'Points market' }), h('dd', { text: 'Torn API · ' + agoText(prices[POINTS] && prices[POINTS].imAt, now) }), h('dt', { text: 'Bazaars' }), h('dd', {}, [h('a', { href: W3B_SITE_URL, target: '_blank', rel: 'noopener', text: 'TornW3B' }), ' · ' + agoText(Math.max(0, ...bz), now)])])]),
    ];
    return { main: [top, h('div', { class: 'items' }, blocks), h('p', { class: 'muted', style: 'margin:0;font-size:12px', text: 'A listing can sell before you get there. The list checks again when you come back to this tab.' })], pane };
}
