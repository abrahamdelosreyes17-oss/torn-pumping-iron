/*
 * Buy (mockups/round3/U-buy.html): one question, "what do I buy, where,
 * now?". Every Item Market listing (Torn API) and bazaar listing (TornW3B)
 * sorted together and filled from the cheapest; each item says which side
 * is cheaper; deals show even for items you hold; type ticks filter both
 * lists. Every row links to that exact listing. You buy by hand.
 */

import { h, t, sparkline } from '../dom.js';
import { fmtInt, fmtMoney } from '../../core/format.js';
import { itemName, ITEMS, REFILL_POINTS, POINTS, XANAX, ECSTASY, EDVD, FHC, CANDY_KISSES, MUNSTER, CANDY_IDS, GAME_CONSOLE } from '../../core/items.js';
import { itemsNeeded } from '../../core/plan.js';
import { tornDayStart, DAY } from '../../core/bars.js';
import { needList, fillCheapest, whereText, linkFor, WINDOWS, SOURCE_BAZAAR, SOURCE_ITEM_MARKET, SOURCE_NPC, npcListing, candyShopsFrom, shopsAllowed, toggleShop, CITY_DAILY_ALLOWANCE } from '../../core/market.js';
import { itemContext } from '../../core/model.js';
import { CANDY_PLANS } from '../../core/strategies.js';
import { tierWords, poolOf } from '../../core/candy.js';
import { W3B_SITE_URL } from '../../api/w3b.js';
import { itemMarketUrl, pointsMarketUrl } from '../../sources/route.js';
import { sectionHead, meta } from './common.js';

const WINDOW_LABEL = { today: 'Today', three: '3 days', week: 'Week' };

/** Items Buy keeps an eye on for deals, plan or not. */
export const TRACKED = [XANAX, POINTS, ECSTASY, EDVD, FHC, CANDY_KISSES, MUNSTER];

/** The type ticks, and which items each covers. */
export const BUY_TYPES = [
    ['drug', 'Drugs'],
    ['booster', 'Boosters'],
    ['candy', 'Candy'],
    ['energy', 'Energy drinks'],
    ['points', 'Points'],
];
export const DEFAULT_BUY_TYPES = ['drug', 'booster', 'points'];

export function typeOf(id) {
    if (id === POINTS) return 'points';
    const it = ITEMS[id];
    if (!it) return 'booster';
    if (it.kind === 'drug') return 'drug';
    if (it.category === 'Candy') return 'candy';
    if (it.category === 'Energy Drink') return 'energy';
    return 'booster';
}

/**
 * The plan's needs for a window: the real schedule (today's steps, and the
 * next boost or jump in full whatever day it lands, with its Xanax stack),
 * then the days after it at the plan's daily average.
 * @param {object} m - the model ({now, steps, ahead}: `ahead` runs on to the next boost)
 */
export function needsForWindow(m, compare, plan, windowKey, horizonDays) {
    const days = WINDOWS[windowKey] || 1;
    const dayStart = tornDayStart(m.now);
    const steps = (m.ahead && m.ahead.length ? m.ahead : m.steps) || [];
    const boostAt = steps.findIndex((s) => s.kind === 'jump' || s.kind === 'boost');
    const real = steps.filter((s, i) => s.at < dayStart + DAY || (boostAt >= 0 && i <= boostAt));
    const out = itemsNeeded(real);
    if (days <= 1) return out;
    // Days the real schedule already covers (at least today); the rest at the 30-day average.
    const last = real.length ? Math.max(...real.map((s) => s.at)) : m.now;
    const covered = Math.max(1, Math.ceil((last + 1 - dayStart) / DAY));
    const rest = days - covered;
    const r = compare && compare[plan.strategy];
    if (r && rest > 0) {
        const add = {};
        for (const [id, n] of Object.entries(r.used || {})) {
            // Not bought: special refills (and their counters), EDVD the job pays for; the console is bought once.
            if (id !== POINTS && !/^\d+$/.test(id)) continue;
            if (Number(id) === GAME_CONSOLE) continue;
            // Candy (and cans) the simulation took from your inventory count as the plan's pick on the days after:
            // Buy's list then takes everything you hold off once (the same id, or the pool).
            const pool = poolOf(Number(id));
            const to = pool === 'Candy' && r.candy ? String(r.candy.id) : pool === 'Energy Drink' && r.booster && r.booster.id ? String(r.booster.id) : id;
            add[to] = (add[to] || 0) + ((n || 0) / (horizonDays || 30)) * rest;
        }
        for (const [id, extra] of Object.entries(add)) if (extra > 0) out[id] = Math.ceil((out[id] || 0) + extra - 1e-9);
    }
    return out;
}

/**
 * The item-type ticks: what the player chose, plus every type the plan uses
 * (candy was hidden by default), unless the player turned that one off.
 */
export function shownTypes(settings, planTypes = []) {
    const show = new Set(Array.isArray(settings.buyTypes) ? settings.buyTypes : DEFAULT_BUY_TYPES);
    const off = new Set(Array.isArray(settings.buyTypesOff) ? settings.buyTypesOff : []);
    for (const k of planTypes) if (!off.has(k)) show.add(k);
    return show;
}

/** A tick clicked: the settings patch ({buyTypes, buyTypesOff}). */
export function toggleType(settings, planTypes, k) {
    const show = shownTypes(settings, planTypes);
    const off = new Set(Array.isArray(settings.buyTypesOff) ? settings.buyTypesOff : []);
    const on = new Set(Array.isArray(settings.buyTypes) ? settings.buyTypes : DEFAULT_BUY_TYPES);
    if (show.has(k)) {
        on.delete(k);
        off.add(k);
    } else {
        on.add(k);
        off.delete(k);
    }
    return { buyTypes: [...on], buyTypesOff: [...off] };
}

/** "Lollipop · the plan’s pick: most stats in your budget, of 6 candy weighed". */
export function candyNote(candy, pickBy = 'most') {
    if (!candy) return '';
    const rule = pickBy === 'value' ? 'the most stats per $1M' : pickBy === 'max' ? 'the most stats, no budget' : 'the most stats in your budget';
    return 'the plan’s pick: ' + rule + (candy.options > 1 ? ', of ' + candy.options + ' candy weighed' : '');
}

export function agoShort(at, now) {
    if (!at) return '—';
    const s = Math.max(0, Math.round((now - at) / 1000));
    return s < 90 ? s + ' s' : s < 5400 ? Math.round(s / 60) + ' min' : Math.round(s / 3600) + ' h';
}

/** The lowest price of the days before today (the "7-day low"), or null. */
function low7(p) {
    const lows = (p && p.lows7) || [];
    const before = lows.slice(0, -1).filter((v) => v > 0);
    return before.length ? Math.min(...before) : null;
}

/** "Bazaars $3,000 cheaper than the Item Market" (or the other way), per unit. */
function sideLine(listings) {
    const bz = listings.filter((l) => l.source === SOURCE_BAZAAR).map((l) => l.price);
    const im = listings.filter((l) => l.source === SOURCE_ITEM_MARKET).map((l) => l.price);
    if (!bz.length || !im.length) return null;
    const b = Math.min(...bz);
    const i = Math.min(...im);
    if (b === i) return { good: true, text: 'Bazaars and the Item Market at the same price' };
    return b < i ? { good: true, text: 'Bazaars ' + fmtMoney(i - b) + ' cheaper than the Item Market' } : { good: true, text: 'The Item Market is ' + fmtMoney(b - i) + ' cheaper than bazaars' };
}

function checkedText(row, p, now) {
    if (row.source === SOURCE_NPC) return 'Torn item data';
    if (row.source === SOURCE_BAZAAR) return 'TornW3B · ' + agoShort(row.dataAt || p.w3bAt, now);
    return 'Torn API · ' + agoShort(p.imAt, now);
}

function openBtn(link, primary, ghost) {
    return h('a', { class: 'btn sm' + (primary ? ' primary' : ghost ? ' ghost' : ''), href: link, target: '_blank', rel: 'noopener', text: 'Open' });
}

export function renderBuy(m, ctx) {
    const s = ctx.settings;
    const now = m.now;
    const win = s.buyWindow || 'three';
    const inv = ctx.statics.inventory || {};
    const needs = needList(needsForWindow(m, ctx.compare, { ...ctx.plan, strategy: m.strategy || ctx.plan.strategy }, win, m.planDays || s.horizonDays), inv);
    const planTypes = [...new Set(needs.map((n) => typeOf(n.id)))];
    const show = shownTypes(s, planTypes);
    const toBuy = needs.filter((n) => n.buy > 0 && show.has(typeOf(n.id)));
    // The plan's candy (picked in the comparison), and the city shops the player may buy from.
    const mine = ctx.compare && ctx.compare[ctx.plan.strategy];
    const candy = mine && mine.candy ? mine.candy : null;
    const ic = itemContext(ctx.statics, s, now);
    const tracked = TRACKED.map((id) => (id === CANDY_KISSES && candy ? candy.id : id));
    // Every candy the plan might pick is priced too (fewer listings, every 30 min), so the pick can change with prices.
    ctx.wantPrices([...new Set(toBuy.map((n) => n.id).concat(tracked.filter((id) => show.has(typeOf(id)))))], CANDY_PLANS.has(ctx.plan.strategy) ? CANDY_IDS : []);
    const prices = ctx.prices || {};
    let total = 0;
    const firstOpen = { done: false };

    const rows = [];
    // Today's city-shop allowance, shared by every item bought there (100 a day).
    let cityLeft = ic.cityLeft;
    for (const n of toBuy) {
        const p = prices[n.id] || {};
        // A city shop you may buy from sells it: its price joins the listings, up to today's allowance.
        const shop = ic.npc[n.id] ? npcListing(ic.npc[n.id], n.buy, cityLeft) : null;
        const listings = (Array.isArray(p.listings) ? p.listings : []).concat(shop ? [shop] : []);
        const fill = listings.length ? fillCheapest(listings, n.buy, n.id) : null;
        if (fill) total += fill.total;
        if (fill && cityLeft !== null) cityLeft = Math.max(0, cityLeft - fill.rows.filter((r) => r.source === SOURCE_NPC).reduce((a, r) => a + r.qty, 0));
        const days = WINDOWS[win] || 1;
        const perDay = n.id === GAME_CONSOLE ? 'once, for the console jump' : days > 1 ? Math.round((n.need / days) * 10) / 10 + ' a day' : n.need + ' today';
        const side = listings.length ? sideLine(listings) : null;
        const picked = candy && Number(n.id) === candy.id ? candyNote(candy, ctx.plan.pickBy) : '';
        rows.push(
            h('tr', { class: 'ih' }, [
                h('td', { colspan: '6' }, [
                    h('b', { text: n.name + ' × ' + fmtInt(n.buy) }),
                    h('span', { class: 'muted', text: ' · ' + (n.id === POINTS ? refillWords() : perDay) + ' · you have ' + fmtInt(n.have) + (n.fromPool ? ' (and ' + n.fromPool.map((x) => x.qty + ' ' + x.name).join(' + ') + ', the same use)' : '') + (fill ? ' · ' + fmtMoney(fill.total) : '') + (picked ? ' · ' + picked : '') + (tierWords(n.id) ? ' · ' + tierWords(n.id) : '') }),
                    side ? h('span', { class: 'verdict c-good', style: 'margin-left:10px', text: side.text }) : null,
                ]),
            ]),
        );
        if (!fill) {
            rows.push(h('tr', { class: 'sub' }, [h('td', { colspan: '5', class: 'muted', text: p.error ? 'Prices could not load: ' + p.error : ctx.paused ? 'Prices wait while Torn Trading runs' : 'Checking prices…' }), h('td', { class: 'r' }, [openBtn(n.id === POINTS ? pointsMarketUrl() : itemMarketUrl(n.id), false, true)])]));
            continue;
        }
        for (const r of fill.rows) {
            const primary = !firstOpen.done;
            firstOpen.done = true;
            rows.push(
                h('tr', { class: 'sub' }, [
                    h('td', { text: whereText(r) }),
                    h('td', { text: fmtInt(r.qty) + ' of ' + fmtInt(r.listed) }),
                    h('td', { class: 'r', text: '$' + fmtInt(r.price) }),
                    h('td', { class: 'r', text: '$' + fmtInt(r.subtotal) }),
                    h('td', { class: 'muted', text: checkedText(r, p, now) }),
                    h('td', { class: 'r' }, [openBtn(r.link, primary)]),
                ]),
            );
            if (r.source === SOURCE_NPC) rows.push(h('tr', { class: 'sub' }, [h('td', { colspan: '6', class: 'muted', text: 'City shop purchases count against Torn’s daily items allowance (' + CITY_DAILY_ALLOWANCE + ' a day' + (ic.cityLeft !== null ? ', ' + ic.cityLeft + ' left today' : '') + '); the rest comes from the market. Untick ' + r.shop + ' under “Shops I can buy from” to leave it out.' })]));
        }
        if (fill.short > 0) rows.push(h('tr', { class: 'sub' }, [h('td', { colspan: '6', class: 'c-bad', text: 'Only ' + fmtInt(fill.filled) + ' listed at these prices' })]));
        // The Item Market's cheapest, when the fill didn't need it: a check that bazaars really are cheaper.
        if (n.id !== POINTS && !fill.rows.some((r) => r.source === SOURCE_ITEM_MARKET)) {
            const im = listings.filter((l) => l.source === SOURCE_ITEM_MARKET).sort((a, b) => a.price - b.price)[0];
            if (im) rows.push(h('tr', { class: 'sub' }, [h('td', { class: 'muted', text: 'Item Market, cheapest' }), h('td', { class: 'muted', text: 'not needed' }), h('td', { class: 'r muted', text: '$' + fmtInt(im.price) }), h('td'), h('td', { class: 'muted', text: 'Torn API · ' + agoShort(p.imAt, now) }), h('td', { class: 'r' }, [openBtn(itemMarketUrl(n.id), false, true)])]));
        }
    }
    if (!rows.length) rows.push(h('tr', {}, [h('td', { colspan: '6' }, [h('b', { class: 'w', text: 'Nothing to buy' }), h('span', { class: 'muted', text: ' · what you hold covers the plan’s next ' + WINDOW_LABEL[win].toLowerCase() })])]));

    const listCard = h('div', { class: 'lead' }, [
        sectionHead('Your list', meta(['the plan’s next ' + (win === 'today' ? 'day' : WINDOW_LABEL[win].toLowerCase()) + ', minus what you hold · cheapest first'])),
        h('table', { class: 'tbl num' }, [h('thead', {}, [h('tr', {}, [h('th', { text: 'Where' }), h('th', { style: 'width:120px', text: 'Take' }), h('th', { class: 'r', style: 'width:110px', text: 'Each' }), h('th', { class: 'r', style: 'width:120px', text: 'Total' }), h('th', { style: 'width:130px', text: 'Checked' }), h('th', { style: 'width:70px' })])]), h('tbody', {}, rows)]),
        h('div', { class: 'note2', text: 'A listing can sell before you get there. Bazaar rows TornW3B hasn’t re-checked in 2 minutes are left out, and so are $1 locked listings.' }),
    ]);

    // Deals: under the lowest price of the last days, whether the plan needs it or you already hold some.
    const deals = [];
    let hiddenDeals = 0;
    const planIds = new Set(needs.map((n) => String(n.id)));
    for (const id of tracked) {
        const p = prices[id];
        if (!p || !Array.isArray(p.listings) || !p.listings.length) continue;
        const best = p.listings.slice().sort((a, b) => a.price - b.price)[0];
        const low = low7(p);
        if (!low || !(best.price < low)) continue;
        if (!show.has(typeOf(id))) {
            hiddenDeals++;
            continue;
        }
        const pct = (100 * (best.price - low)) / low;
        const link = linkFor(best, id);
        deals.push(
            h('tr', {}, [
                h('td', {}, [h('b', { class: 'w', text: itemName(id) }), planIds.has(String(id)) ? null : h('span', { class: 'tag', style: 'margin-left:6px', text: 'not in plan' })]),
                h('td', {}, [whereText(best), h('span', { class: 'muted', text: ' · ' + (best.source === SOURCE_BAZAAR ? 'TornW3B ' + agoShort(best.dataAt || p.w3bAt, now) : 'Torn API ' + agoShort(p.imAt, now)) })]),
                h('td', { class: 'r', text: '$' + fmtInt(best.price) }),
                h('td', { class: 'r c-good', text: '−' + Math.abs(pct).toFixed(1) + '%' }),
                h('td', { text: fmtInt(best.qty) }),
                h('td', { class: 'r' }, [openBtn(link, false)]),
            ]),
        );
    }
    const notInPlan = tracked.filter((id) => !planIds.has(String(id)) && show.has(typeOf(id)));
    const cheapestRows = notInPlan.map((id) => {
        const p = prices[id];
        const best = p && Array.isArray(p.listings) && p.listings.length ? p.listings.slice().sort((a, b) => a.price - b.price)[0] : null;
        return h('tr', {}, [h('td', {}, [h('b', { class: 'w', text: itemName(id) })]), h('td', { class: 'muted', text: best ? whereText(best) : 'checking…' }), h('td', { class: 'r', text: best ? '$' + fmtInt(best.price) : '' }), h('td', { class: 'r', style: 'width:70px' }, [best ? openBtn(linkFor(best, id), false, true) : null])]);
    });
    const dealsCard = h('div', {}, [
        sectionHead('Deals', meta(['under the lowest price of the last days · worth buying ahead, even if you hold some'])),
        deals.length
            ? h('table', { class: 'tbl num' }, [h('thead', {}, [h('tr', {}, [h('th', { style: 'width:170px', text: 'Item' }), h('th', { text: 'Where' }), h('th', { class: 'r', style: 'width:110px', text: 'Price' }), h('th', { class: 'r', style: 'width:110px', text: 'vs the low' }), h('th', { style: 'width:70px', text: 'Listed' }), h('th', { style: 'width:70px' })])]), h('tbody', {}, deals)])
            : h('p', { class: 'muted', style: 'margin:0', text: 'Nothing under its recent low right now. Deals need two days of prices: they show here as soon as one appears.' }),
        hiddenDeals ? h('div', { class: 'note2', text: hiddenDeals + ' deal' + (hiddenDeals === 1 ? '' : 's') + ' hidden by your ticks.' }) : null,
        cheapestRows.length ? h('details', { class: 'dis', style: 'margin-top:12px' }, [h('summary', { text: 'Not in your plan · the cheapest of each' }), h('table', { class: 'tbl num', style: 'margin-top:6px' }, [h('tbody', {}, cheapestRows)])]) : null,
    ]);

    // Pane: 7-day prices, what you hold, where prices come from.
    const spark = tracked.filter((id) => show.has(typeOf(id))).map((id) => {
        const p = prices[id] || {};
        const cheapest = p.listings && p.listings.length ? Math.min(...p.listings.map((l) => l.price)) : null;
        const pct = cheapest && p.avg7 ? (100 * (cheapest - p.avg7)) / p.avg7 : null;
        return h('tr', {}, [h('td', {}, [h('b', { class: 'w', text: itemName(id) })]), h('td', { style: 'width:96px' }, [sparkline(p.lows7 || [], { w: 90, h: 22, color: planIds.has(String(id)) ? '#efebe2' : '#6c737a' })]), h('td', { class: 'r' + (cheapest ? '' : ' muted'), text: cheapest ? '$' + fmtInt(cheapest) : ctx.paused ? 'paused' : p.error ? 'no answer' : 'loading…' }), h('td', { class: 'r ' + (pct !== null && pct < -1 ? 'c-good' : 'muted'), text: pct === null ? '' : (pct >= 0 ? '+' : '−') + Math.abs(pct).toFixed(1) + '%' })]);
    });
    const heldIds = [...new Set([XANAX, POINTS, ECSTASY, EDVD, candy ? candy.id : CANDY_KISSES, FHC, MUNSTER].map(String))];
    const held = heldIds.map((id) => [id === POINTS ? 'Points' : itemName(Number(id)), Number(inv[id === POINTS ? POINTS : Number(id)]) || 0]);
    const im = Object.values(prices).map((p) => p.imAt || 0);
    const bz = Object.values(prices).map((p) => p.w3bAt || 0);
    const pane = [
        h('div', {}, [sectionHead('7-day prices', meta(['lowest each day']), null, 'h3'), h('table', { class: 'tbl num' }, [h('tbody', {}, spark)])]),
        h('div', {}, [sectionHead('You hold', null, null, 'h3'), h('dl', { class: 'facts num' }, held.flatMap(([name, n]) => [h('dt', { text: name }), h('dd', { text: fmtInt(n) })]))]),
        h('div', {}, [
            sectionHead('Prices from', null, null, 'h3'),
            h('dl', { class: 'facts num' }, [h('dt', { text: 'Item Market' }), h('dd', { text: 'Torn API · ' + agoShort(Math.max(0, ...im), now) }), h('dt', { text: 'Points market' }), h('dd', { text: 'Torn API · ' + agoShort(prices[POINTS] && prices[POINTS].imAt, now) }), h('dt', { text: 'Bazaars' }), h('dd', {}, [s.w3b === false ? 'off in Settings' : h('a', { href: W3B_SITE_URL, target: '_blank', rel: 'noopener', text: 'TornW3B' }), s.w3b === false ? '' : ' · ' + agoShort(Math.max(0, ...bz), now)])]),
            h('div', { class: 'note2', text: 'Read at most every 5 min while this tab is open. Bazaar rows older than 2 min are hidden.' }),
        ]),
    ];

    const summary = toBuy.map((n) => fmtInt(n.buy) + ' ' + (n.id === POINTS ? 'points' : n.name)).join(' + ');
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Buy for' }, Object.keys(WINDOWS).map((k) => h('button', { type: 'button', 'aria-pressed': String(k === win), onclick: () => ctx.setSettings({ buyWindow: k }), text: WINDOW_LABEL[k] })));
    const ticks = h(
        'div',
        { class: 'ticks', role: 'group', 'aria-label': 'Show' },
        BUY_TYPES.map(([k, label]) =>
            h('button', { type: 'button', class: 'tk', 'aria-pressed': String(show.has(k)), onclick: () => ctx.setSettings(toggleType(s, planTypes, k)) }, [h('i'), label]),
        ),
    );
    const ctl = [t('lab', 'Buy for'), seg, h('span', { class: 'muted' }, [summary ? summary + ' · ' : 'Nothing to buy · ', h('b', { class: 'white', text: fmtMoney(total) })]), h('span', { class: 'sep' }), t('lab', 'Show'), ticks];
    const newest = Math.max(0, ...Object.values(prices).map((p) => p.at || 0));
    const shops = shopsControl(ctx, now);
    return { ctl: shops ? [ctl, shops] : [ctl], upd: newest ? 'prices ' + agoShort(newest, now) + ' ago' : 'prices load now', main: [listCard, dealsCard], pane };
}

/**
 * "Shops I can buy from": a tick per city shop Torn's item data lists for
 * candy, all off until ticked. Torn's API can't tell who may buy there (the
 * owner: Sally's Sweet Shop is for newbies only), so the plan uses a shop's
 * price only once it's ticked.
 */
function shopsControl(ctx, now) {
    const list = candyShopsFrom((ctx.statics && ctx.statics.items) || {});
    if (!list.length) return null;
    const on = new Set(shopsAllowed(ctx.settings));
    const left = itemContext(ctx.statics || {}, ctx.settings, now).cityLeft;
    return [
        t('lab', 'Shops I can buy from'),
        h(
            'div',
            { class: 'ticks', role: 'group', 'aria-label': 'Shops I can buy from' },
            list.map((shop) => h('button', { type: 'button', class: 'tk shop', 'aria-pressed': String(on.has(shop)), onclick: () => ctx.setSettings(toggleShop(ctx.settings, shop)) }, [h('i'), shop])),
        ),
        left !== null ? h('span', { class: 'muted', text: left + ' of ' + CITY_DAILY_ALLOWANCE + ' city-shop items left today' }) : null,
        h('span', { class: 'info', title: 'Sally’s Sweet Shop counts by default; untick it to leave it out. Other city shops count once ticked. City shop buys share Torn’s daily allowance of ' + CITY_DAILY_ALLOWANCE + ' items (reset at 00:00 Torn time): the plan buys there only up to what’s left today, and the market for the rest.', text: 'i' }),
    ];
}

function refillWords() {
    return REFILL_POINTS + ' a day for the refill';
}
