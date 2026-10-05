/*
 * Trading (the accountant's answer to question 21, 2026-10-05, in
 * docs/LEDGER-ANSWERS.txt: "extra lang na bibilangin pag sa wallet na. tapos
 * one line na "trading" ... if nakita na bumili ka tapos tinrade mo ng mas
 * mahal"). A trader's "Export log" of the same day: about 600 bazaar buys a
 * day were other spending and his sales non-recurring, in two places of the
 * statement. Now an item both bought and sold inside the books' days is
 * Trading: one line, sales less purchases, never in a daily figure. Every id
 * and amount is made up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ledgerOf, ledgerShape, LEDGER_ACCOUNTS } from '../src/core/ledger.js';
import { cashflowOf, budgetOffer } from '../src/core/cashflow.js';
import { ITEMS, XANAX } from '../src/core/items.js';

const DAY = 864e5;
const T = Date.parse('2026-10-05T12:00:00Z');
const FROM = T - 10 * DAY;
const line = (id, type, daysAgo, data) => ({ id, type, title: '', at: T - daysAgo * DAY - 3600e3, data });
const pay = (n = 10, each = 1e6) => Array.from({ length: n }, (_, i) => line('pay' + i, 6221, i, { pay: each, job_points: 1, working_stats_received: '1,2,3', company: 9 }));
const bazaarBuy = (id, item, daysAgo, total, qty = 1) => line(id, 1225, daysAgo, { seller: 1, items: [{ id: item, uid: null, qty }], cost_each: total / qty, cost_total: total });
const marketBuy = (id, item, daysAgo, total) => line(id, 1112, daysAgo, { seller: 1, anonymous: 0, items: [{ id: item, uid: null, qty: 1 }], cost_each: total, cost_total: total });
const bazaarSell = (id, item, daysAgo, total, qty = 1) => line(id, 1226, daysAgo, { buyer: 1, items: [{ id: item, uid: null, qty }], cost_each: total / qty, cost_total: total });
const shopSell = (id, item, daysAgo, total, qty = 1) => line(id, 4210, daysAgo, { item, quantity: qty, value_each: total / qty, total_value: total, area: 'x' });
const tradeIn = (id, daysAgo, money) => line(id, 4441, daysAgo, { user: 1, trade_id: 'x', parsed_trade_id: 7, money });
const isGymItem = (id) => Boolean(ITEMS[id]);
const book = (lines, o = {}) => ledgerOf(lines, { from: FROM, to: T, isGymItem, ...o });
const accountOf = (l, id) => l.entries.find((e) => e.id === id).account;

// Made-up items nobody trains with.
const PLUSHIE = 99901;
const FLOWER = 99902;
const LOOT = 99903;

test('trading: an item bought and sold inside the days is Trading, both lines; sales less purchases is its figure', () => {
    const l = book([...pay(), bazaarBuy('b1', PLUSHIE, 3, 50e6, 100), marketBuy('b2', PLUSHIE, 2, 5e6), shopSell('s1', PLUSHIE, 2, 40e6, 70), bazaarSell('s2', PLUSHIE, 1, 20e6, 31)]);
    assert.ok(LEDGER_ACCOUNTS.some((a) => a.id === 'trading' && a.name === 'Trading' && a.kind === 'apart'), 'an account of its own, never in a daily figure');
    for (const id of ['b1', 'b2', 's1', 's2']) assert.equal(accountOf(l, id), 'trading', id);
    assert.equal(l.accounts.trading.in, 60e6);
    assert.equal(l.accounts.trading.out, 55e6);
    assert.equal(l.accounts.trading.net, 5e6);
    assert.equal(l.accounts.chosen.out, 0, 'no longer other spending');
    assert.equal(l.accounts.nonrecurring.in, 0, 'no longer a plain sale');
    assert.deepEqual(l.oneOffs, [], 'not listed line by line as non-recurring');
    assert.equal(l.entries.reduce((n, e) => n + e.amount, 0), 10e6 + 5e6, 'the cash adds up');
});

test('trading: bought and kept is other spending, sold and never bought (loot) is a plain sale, trade money carries no item', () => {
    const l = book([...pay(), bazaarBuy('kept', FLOWER, 3, 2e6), shopSell('loot', LOOT, 2, 300e3), tradeIn('trade', 1, 7e6), bazaarBuy('b', PLUSHIE, 3, 1e6), bazaarSell('s', PLUSHIE, 1, 1.2e6)]);
    assert.equal(accountOf(l, 'kept'), 'chosen');
    assert.equal(accountOf(l, 'loot'), 'nonrecurring');
    assert.equal(accountOf(l, 'trade'), 'nonrecurring');
    assert.equal(accountOf(l, 'b'), 'trading');
    assert.equal(accountOf(l, 's'), 'trading');
    // A sale before the purchase (restocking) is the same business; one outside the days is not seen.
    const order = book([bazaarSell('s', PLUSHIE, 5, 1.2e6), bazaarBuy('b', PLUSHIE, 1, 1e6), bazaarBuy('old', FLOWER, 20, 1e6), shopSell('now', FLOWER, 1, 2e6)]);
    assert.equal(accountOf(order, 's'), 'trading');
    assert.equal(accountOf(order, 'b'), 'trading');
    assert.equal(accountOf(order, 'now'), 'nonrecurring', 'its purchase is older than the books');
    // A loss is trading as well.
    assert.equal(book([bazaarBuy('b', PLUSHIE, 2, 9e6), shopSell('s', PLUSHIE, 1, 1e6)]).accounts.trading.net, -8e6);
});

test('trading: a gym item that is resold is Trading, not Gym; one bought and not sold is Gym; a sale is never Gym', () => {
    const resold = book([bazaarBuy('b', XANAX, 2, 8.3e6, 10), bazaarSell('s', XANAX, 1, 8.6e6, 10)]);
    assert.equal(accountOf(resold, 'b'), 'trading');
    assert.equal(resold.accounts.training.out, 0);
    const used = book([bazaarBuy('b', XANAX, 2, 8.3e6, 10)]);
    assert.equal(accountOf(used, 'b'), 'training');
    const sold = book([bazaarSell('s', XANAX, 1, 8.6e6, 10)]);
    assert.equal(accountOf(sold, 's'), 'nonrecurring');
    assert.equal(sold.accounts.training.in, 0);
});

test('trading: your tick on a line is kept, and that line no longer makes its item a traded one', () => {
    const lines = [bazaarBuy('b', PLUSHIE, 2, 1e6), shopSell('s', PLUSHIE, 1, 1.5e6)];
    // The sale unticked: it counts as usual money, so nothing was "sold again".
    const l = book(lines, { overrides: { s: false } });
    assert.equal(accountOf(l, 's'), 'recurring');
    assert.equal(accountOf(l, 'b'), 'chosen');
    assert.equal(l.accounts.trading.n, 0);
});

test('trading: the statement has one line "Trading" under non-recurring; what comes in a day and the budget do not move', () => {
    const base = [...pay(), line('up', 5920, 2, { upkeep_paid: 1e6, upkeep_due: 0, ownership: 'x', property: 1, property_id: 1 })];
    const trade = [];
    for (let i = 0; i < 50; i++) trade.push(bazaarBuy('b' + i, PLUSHIE, (i % 9) + 0.5, 1e6), i % 2 ? shopSell('s' + i, PLUSHIE, i % 9, 1.1e6) : bazaarSell('s' + i, PLUSHIE, i % 9, 1.1e6));
    const plain = cashflowOf({ ledger: book(base), liquid: 100e6, now: T });
    const l = book([...base, ...trade, tradeIn('t', 1, 3e6)]);
    const f = cashflowOf({ ledger: l, liquid: 100e6, now: T });
    const nr = f.sections.find((s) => s.id === 'nonrecurring');
    const tr = nr.lines.filter((x) => x.account === 'trading');
    assert.equal(tr.length, 1, 'one line, not one per log type');
    assert.equal(tr[0].title, 'Trading');
    assert.equal(tr[0].n, 100);
    assert.equal(tr[0].total, 5e6, 'sales less purchases');
    assert.equal(tr[0].sold, 55e6);
    assert.equal(tr[0].bought, 50e6);
    assert.equal(nr.total, 8e6, 'with the trade money beside it');
    assert.equal(f.sections.find((s) => s.id === 'spending').total, 0, 'the purchases are not chosen spending');
    assert.equal(f.earnsPerDay, plain.earnsPerDay, 'comes in a day');
    assert.equal(f.surplus.total, plain.surplus.total);
    assert.equal(f.change, plain.change + 8e6, 'the cash adds up');
    assert.deepEqual(f.oneOffs.map((e) => e.id), ['t'], 'the side list holds the trade money, not a hundred trading lines');
    const offer = (flow) => budgetOffer({ flow, days: 30, now: T }).perDay;
    assert.equal(offer(f), offer(plain), 'the budget offered');
    // In names and counts (the export): Trading with its log types.
    const shape = ledgerShape(l);
    assert.equal(shape.accounts.find((a) => a.id === 'trading').lines, 100);
    assert.deepEqual(shape.types.filter((t) => t.account === 'trading').map((t) => t.type).sort(), [1225, 1226, 4210]);
});
