/*
 * Round 7, R7.5: the statements, the reconciliation and the budget offer
 * read off the ledger (core/cashflow.js). Real field names, made-up ids and
 * amounts.
 *
 * Round 8: the statement in six sections by what a line is, free and
 * restricted cash, and a reconciliation that lists its difference to the
 * dollar (the accountant's answers, docs/LEDGER-ANSWERS.txt).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ledgerOf } from '../src/core/ledger.js';
import { cashflowOf, reconcile, cashCheck, budgetOffer, stockBlocks, RECONCILE_INCOME_PCT } from '../src/core/cashflow.js';

const DAY = 864e5;
const T = Date.parse('2026-10-03T12:00:00Z');
const FROM = T - 30 * DAY;
const line = (id, type, daysAgo, data, title = '') => ({ id, type, title, at: T - daysAgo * DAY - 3600e3, data });
const pay = (n = 30, each = 1e6) => Array.from({ length: n }, (_, i) => line('pay' + i, 6221, i, { pay: each }));
const book = (lines) => ledgerOf(lines, { from: FROM, to: T });
const sectionOf = (flow, id) => flow.sections.find((s) => s.id === id);

test('a $2B gift gives a budget near the real pay: it is non-recurring, on its own line', () => {
    const ledger = book([...pay(30, 1e6), line('gift', 4810, 9, { sender: 1, money: 2e9 })]);
    const flow = cashflowOf({ ledger, liquid: 2.05e9, habitPerDay: 400e3 });
    assert.equal(Math.round(flow.earnsPerDay), 1e6);
    assert.deepEqual(flow.oneOffs.map((e) => [e.id, e.amount]), [['gift', 2e9]]);
    const offer = budgetOffer({ flow, days: 30, now: T });
    assert.equal(offer.recommended, 'stretch');
    assert.equal(Math.round(offer.perDay), 1e6);
    assert.match(offer.why, /About \$1(\.0)?M a day comes in after your committed costs/);
    // The gift is cash now: "all your free cash" spreads it over the plan's days, on top of what comes in.
    assert.deepEqual(offer.options.map((o) => [o.id, Number.isFinite(o.perDay) ? Math.round(o.perDay) : null, o.fits]), [['habit', 400e3, true], ['stretch', 1e6, true], ['free', Math.round(1e6 + 2.05e9 / 30), true], ['max', null, null]]);
});

test('the statement: six sections by what a line is; disposable income is recurring less committed; the sections add up to the change in cash', () => {
    const ledger = book([
        ...pay(30, 1e6),
        line('crime', 9015, 2, { money_gained: 600e3 }),
        line('up', 5920, 6, { upkeep_paid: 5e6 }),
        line('edu', 5960, 9, { cost: 10e3 }),
        line('rehab', 6005, 4, { cost: 430e3, rehab_times: 2 }),
        line('toy', 4201, 4, { item: 9998, quantity: 1, cost_each: 20e3, cost_total: 20e3 }),
        line('j', 8410, 2, { table: 1, value: 40e6 }),
        line('l', 8411, 2, { table: 1, value: 4e6 }),
        line('mug', 8156, 3, { attacker: 1, money_mugged: 140e3 }),
        line('gift', 4810, 9, { sender: 1, money: 2e9 }),
        line('chk', 5460, 3, { amount: 25e6 }),
        line('inv', 5450, 8, { amount: 2e9, worth: 2.09e9 }),
        line('sell', 5511, 7, { stock: 1, amount: 1, worth: 100e6, profit: -4e6 }),
        line('vault', 5851, 2, { withdrawn: 7e6 }),
    ]);
    const flow = cashflowOf({ ledger });
    assert.deepEqual(flow.sections.map((s) => [s.id, s.total]), [
        ['recurring', 30.6e6],
        ['committed', -5.01e6],
        ['spending', -450e3],
        ['uncontrollable', -36.14e6],
        ['nonrecurring', 2e9 + 25e6 - 4e6],
        // The vault line is listed and not added: your liquid money did not change.
        ['transfers', -2e9 + 104e6],
    ]);
    assert.equal(sectionOf(flow, 'transfers').lines.find((l) => l.type === 5851).internal, true);
    assert.equal(flow.disposable.total, 30.6e6 - 5.01e6);
    assert.equal(flow.surplus.total, 30.6e6 - 5.01e6 - 450e3);
    assert.equal(Math.round(flow.earnsPerDay), Math.round((30.6e6 - 5.01e6) / 30), 'a plan counts on recurring income less committed costs');
    const cash = ledger.entries.reduce((n, e) => n + (e.internal ? 0 : e.amount), 0);
    assert.equal(flow.change, cash, 'the statement adds up to what the log did to your liquid money');
    // The realised loss is its own line in the non-recurring section (Q5).
    assert.deepEqual(sectionOf(flow, 'nonrecurring').lines.map((l) => l.title).sort(), ['Cashiers check withdraw', 'Money receive', 'Stock sell: gain or loss']);
});

test('the casino is outside your control: a losing month does not lower what a plan counts on (Q7)', () => {
    const ledger = book([...pay(30, 1e6), line('j', 8410, 2, { table: 1, value: 40e6 }), line('l', 8411, 2, { table: 1, value: 4e6 })]);
    const flow = cashflowOf({ ledger, liquid: 500e6, habitPerDay: 2.5e6 });
    assert.equal(Math.round(flow.earnsPerDay), 1e6);
    assert.equal(sectionOf(flow, 'uncontrollable').total, -36e6);
    const offer = budgetOffer({ flow, days: 30, now: T });
    assert.equal(offer.recommended, 'habit');
    assert.equal(offer.perDay, 2.5e6);
    assert.match(offer.why, /free cash covers the difference/);
});

test('the bank: the principal going in is a transfer, never spending; its profit counts on the day it is paid, inside the plan’s days only', () => {
    const ledger = book([...pay(30, 1e6), line('inv', 5450, 3, { amount: 2e9, worth: 2.09e9, duration: 7776000, percent: 4.5 })]);
    const bank = { amount: 2e9, profit: 90e6, until: T + 20 * DAY };
    const flow = cashflowOf({ ledger, liquid: 5e6, bank, habitPerDay: 3e6 });
    assert.equal(Math.round(flow.earnsPerDay), 1e6, 'no share of the profit a day');
    assert.equal(sectionOf(flow, 'transfers').total, -2e9);
    assert.deepEqual(flow.have.locked, bank);
    assert.deepEqual(flow.have.restricted.map((r) => [r.id, r.amount]), [['bank', 2e9]]);
    // The habit ($3M a day against $1M coming in and $5M of free cash) runs out before the bank pays on day 20.
    const offer = budgetOffer({ flow, days: 30, now: T });
    assert.equal(offer.options[0].fits, false);
    assert.equal(offer.options[0].runsOutDay, 3);
    assert.deepEqual(offer.dated.map((d) => [d.day, d.amount]), [[20, 90e6]]);
    assert.equal(offer.recommended, 'covers');
    assert.match(offer.why, /runs out on day 3/);
    // A plan that ends before the bank does gets nothing from it.
    assert.deepEqual(budgetOffer({ flow, days: 10, now: T }).dated, []);
    // With cash on hand to bridge the 20 days, the habit fits.
    const rich = budgetOffer({ flow: cashflowOf({ ledger, liquid: 60e6, bank, habitPerDay: 3e6 }), days: 30, now: T });
    assert.equal(rich.recommended, 'habit');
    assert.equal(rich.perDay, 3e6);
});

test('free and restricted cash (Q2, Q10, Q19): upkeep not paid yet is kept back out of the wallet; the bank and stocks held for a block are restricted', () => {
    // $3M of upkeep paid once, 10 days ago, in a 30-day log: $100k a day, so $1M is owed by now.
    const ledger = book([...pay(30, 1e6), line('up', 5920, 10, { upkeep_paid: 3e6 })]);
    const blocks = stockBlocks(
        [{ id: 1, shares: 3_500_000, bonus: { increment: 2 } }, { id: 2, shares: 500, bonus: { increment: 0 } }, { id: 3, shares: 10, bonus: { increment: 1 } }],
        [{ id: 1, acronym: 'FHG', price: 100, bonus: { requirement: 1_000_000 } }, { id: 2, acronym: 'TCT', price: 10, bonus: { requirement: 100_000 } }, { id: 3, acronym: 'NOP', price: null, bonus: { requirement: 10 } }],
    );
    // Two blocks hold 1M + 2M shares; the other 500k shares, and the stock with no block, are not restricted.
    assert.deepEqual(blocks.lines, [{ id: 1, name: 'FHG', blocks: 2, amount: 300e6 }]);
    assert.equal(blocks.other, 50e6 + 5000);
    const flow = cashflowOf({ ledger, liquid: 20e6, bank: { amount: 2e9, profit: 1, until: T + DAY }, blocks, now: T });
    const up = flow.have.restricted.find((r) => r.id === 'upkeep');
    assert.ok(Math.abs(up.amount - (3e6 / 30) * (10 + 1 / 24)) < 2, 'upkeep a day × the days since it was last paid');
    assert.equal(flow.have.free, 20e6 - up.amount);
    assert.deepEqual(flow.have.restricted.map((r) => r.id), ['bank', 'blocks', 'upkeep']);
    assert.equal(flow.have.restrictedTotal, 2e9 + 300e6 + up.amount);
    // The offer spends free cash only.
    assert.equal(budgetOffer({ flow, days: 30, now: T }).liquid, flow.have.free);
    // No price read: nothing is said about stocks.
    assert.equal(stockBlocks([{ id: 3, shares: 10, bonus: { increment: 1 } }], [{ id: 3, price: null, bonus: { requirement: 10 } }]), null);
});

test('a trader: items bought are not spending on the gym, and they do not lower what a plan counts on', () => {
    const buys = Array.from({ length: 10 }, (_, i) => line('buy' + i, 1112, i * 2, { seller: 1, items: [{ id: 9999, uid: null, qty: 1 }], cost_each: 5e6, cost_total: 5e6 }));
    const flow = cashflowOf({ ledger: book([...pay(30, 1e6), ...buys]), liquid: 100e6, habitPerDay: 0 });
    assert.equal(Math.round(flow.trainingPerDay), 0);
    assert.equal(sectionOf(flow, 'spending').total, -50e6);
    assert.equal(Math.round(flow.earnsPerDay), 1e6);
    assert.equal(flow.surplus.total, -20e6);
});

test('nothing comes in and nothing was spent on the gym: nothing is taken from savings unasked', () => {
    const ledger = book([line('up', 5920, 6, { upkeep_paid: 5e6 })]);
    const idle = budgetOffer({ flow: cashflowOf({ ledger, liquid: 500e6, habitPerDay: 0 }), days: 30, now: T });
    assert.equal(idle.perDay, 0);
    assert.match(idle.why, /unless you pick a budget/);
});

test('the reconciliation (Q3): the difference to the dollar; "Reconciled" only under 1% of a month’s recurring income with nothing unsorted', () => {
    const ledger = book([...pay(30, 1e6), line('up', 5920, 6, { upkeep_paid: 5e6 }), line('vault', 5851, 2, { withdrawn: 7e6 })]);
    const exact = reconcile({ ledger, opening: 10e6, closing: 35e6 });
    assert.equal(exact.in, 30e6);
    assert.equal(exact.out, 5e6);
    assert.equal(exact.gap, 0);
    assert.equal(exact.reconciled, true);
    assert.equal(exact.words, 'Reconciled: the log explains your cash to the dollar.');
    assert.equal(exact.limit, (RECONCILE_INCOME_PCT / 100) * 30e6);
    // $200k off against $30M of recurring income a month: under 1%.
    const near = reconcile({ ledger, opening: 10e6, closing: 35.2e6 });
    assert.equal(near.gap, 200e3);
    assert.equal(near.reconciled, true);
    assert.match(near.words, /^Reconciled: \$200,000 more came in than the log explains, under 1% of a month’s recurring income\.$/);
    // $1M off: 3% of the money that moved, which the first rule (5%) forgave. Not any more.
    const far = reconcile({ ledger, opening: 10e6, closing: 34e6 });
    assert.equal(far.reconciled, false);
    assert.equal(far.rough, true);
    assert.match(far.words, /^Off by \$1(,000,000|M|\.0+M): more went out than the log explains\.$/);
    // A line nobody has shown yet: never "Reconciled", even at zero.
    const unknown = reconcile({ ledger: book([...pay(30, 1e6), line('u', 4999, 2, { money: 5 }, 'New')]), opening: 0, closing: 30e6 });
    assert.equal(unknown.reconciled, false);
    assert.match(unknown.words, /^Off by \$0: .*and 1 line is not sorted yet\.$/);
    assert.equal(reconcile({ ledger, opening: null, closing: 1 }), null);
});

test('the cash check goes day by day: dated money on its day, the keep-aside never touched', () => {
    const c = cashCheck({ liquid: 10e6, earnsPerDay: 1e6, costDaily: Array(10).fill(3e6), dated: [] });
    assert.deepEqual([c.fits, c.runsOutDay], [false, 6]);
    assert.equal(cashCheck({ liquid: 10e6, earnsPerDay: 1e6, costDaily: Array(5).fill(3e6) }).fits, true);
    assert.equal(cashCheck({ liquid: 10e6, earnsPerDay: 1e6, costDaily: Array(10).fill(3e6), dated: [{ day: 4, amount: 20e6 }] }).fits, true);
    assert.equal(cashCheck({ liquid: 10e6, earnsPerDay: 1e6, costDaily: Array(10).fill(3e6), dated: [{ day: 7, amount: 20e6 }] }).runsOutDay, 6, 'money that arrives after the cash is gone does not save the days before');
    assert.equal(cashCheck({ liquid: 10e6, earnsPerDay: 1e6, costDaily: Array(5).fill(3e6), keepAside: 5e6 }).runsOutDay, 3);
    // A lumpy plan (a jump every few days) is checked on the days it pays, not on its average.
    assert.equal(cashCheck({ liquid: 5e6, earnsPerDay: 1e6, costDaily: [20e6, 0, 0, 0, 0, 0, 0, 0, 0, 0] }).runsOutDay, 1);
});
