/*
 * Round 7, R7.5: the ledger (core/ledger.js). Every log line once, booked by
 * Torn's log type id, never by words in its title. The field names are the
 * real ones (the owner's log, docs/log-shapes-2026-10-02.json); every id and
 * amount here is made up.
 *
 * Round 8: sorted by what a line is, never by its size (the accountant's
 * answers, docs/LEDGER-ANSWERS.txt).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

import { ledgerOf, ledgerEntry, ledgerParts, ledgerCsv, ledgerShape, LEDGER_TYPES, LEDGER_ACCOUNTS } from '../src/core/ledger.js';
import { ITEMS, XANAX } from '../src/core/items.js';

const DAY = 864e5;
const T = Date.parse('2026-10-03T12:00:00Z');
const FROM = T - 30 * DAY;
const line = (id, type, daysAgo, data, title = '') => ({ id, type, title, at: T - daysAgo * DAY - 3600e3, data });
const pay = (n = 30, each = 1e6) => Array.from({ length: n }, (_, i) => line('pay' + i, 6221, i, { pay: each, job_points: 1, working_stats_received: '1,2,3', company: 9 }));
const isGymItem = (id) => Boolean(ITEMS[id]);
const book = (lines, o = {}) => ledgerOf(lines, { from: FROM, to: T, isGymItem, ...o });

test('ledger: every type in the table has an account, a sign and an amount; the accounts are the statement’s', () => {
    const ids = new Set(LEDGER_ACCOUNTS.map((a) => a.id));
    for (const [id, s] of Object.entries(LEDGER_TYPES)) {
        assert.ok(ids.has(s.account), id + ' has an account');
        assert.ok(s.sign === 1 || s.sign === -1, id + ' has a sign');
        assert.equal(typeof s.amount, 'function');
        assert.ok(s.title, id + ' has Torn’s title');
    }
    assert.deepEqual([...ids], ['recurring', 'committed', 'training', 'chosen', 'uncontrollable', 'nonrecurring', 'transfers', 'unsorted']);
});

test('ledger: the amount is read from the type’s own field, signed by what it did to the wallet, and booked by what the line is', () => {
    const cases = [
        [6221, { pay: 1000000 }, 'recurring', 1000000],
        [5531, { stock: 3, money: 4000000 }, 'recurring', 4000000],
        [9015, { crime_action: 'x', outcome: 1, nerve: 5, money_gained: 300 }, 'recurring', 300],
        [8155, { defender: 1, money_mugged: 77 }, 'recurring', 77],
        [6710, { lister: 1, target: 2, bounty_reward: 50000 }, 'recurring', 50000],
        [5920, { upkeep_paid: 5000, upkeep_due: 0 }, 'committed', -5000],
        [5960, { course: 1, duration: 1, cost: 60 }, 'committed', -60],
        [6005, { cost: 430000, rehab_times: 2, addiction: 100, happy_increased: 3960 }, 'training', -430000],
        [4201, { item: 268, quantity: 18, cost_each: 10, cost_total: 180 }, 'chosen', -180],
        // The casino and being mugged: outside your control (the accountant's Q7, Q11).
        [8305, { bet_amount: 100, won_amount: 273 }, 'uncontrollable', 173],
        [8305, { bet_amount: 100, won_amount: 27 }, 'uncontrollable', -73],
        [8301, { bet_amount: 10 }, 'uncontrollable', -10],
        [8306, { bet_amount: 10 }, 'uncontrollable', -10],
        [8350, { player_cards: 'x', bet: 500 }, 'uncontrollable', -500],
        [8391, { game_id: 1, bet_amount: 9 }, 'uncontrollable', -9],
        [8410, { table: 1, value: 1000 }, 'uncontrollable', -1000],
        [8411, { table: 1, value: 400 }, 'uncontrollable', 400],
        [8156, { attacker: 1, money_mugged: 140 }, 'uncontrollable', -140],
        // Non-recurring by what they are, whatever their size (Q4, Q8, Q9, Q12).
        [4810, { sender: 1, money: 123 }, 'nonrecurring', 123],
        [4800, { receiver: 1, money: 8 }, 'nonrecurring', -8],
        [4440, { user: 1, trade_id: 'x', money: 2000 }, 'nonrecurring', -2000],
        [5011, { buyer: 1, quantity: 10, cost_each: 45000, cost_total: 450000 }, 'nonrecurring', 450000],
        [4310, { owner: 1, item: [{ id: 614, uid: 1, qty: 1 }], bid_price: 150 }, 'nonrecurring', -150],
        [5460, { amount: 25 }, 'nonrecurring', 25],
        [5450, { amount: 2000, worth: 2351, duration: 7776000, percent: 17.55 }, 'transfers', -2000],
        [5510, { stock: 1, amount: 10, worth: 5000, price: '500' }, 'transfers', -5000],
        [5511, { stock: 1, amount: 10, worth: 4995, price: '500', fees: 5, profit: -20 }, 'transfers', 4995],
        [6726, { faction: 1, money_deposited: 40 }, 'transfers', -40],
    ];
    for (const [type, data, account, amount] of cases) {
        const e = ledgerEntry({ id: 'x', type, title: '', at: T, data });
        assert.equal(e.account, account, type + ' account');
        assert.equal(e.amount, amount, type + ' amount');
        assert.equal(e.known, true);
    }
    // The vault is liquid money too: a withdrawal changes nothing you can spend.
    assert.equal(ledgerEntry({ id: 'v', type: 5851, at: T, data: { withdrawn: 500, balance: 1 } }).internal, true);
});

/*
 * The types an "Export log" of 2026-10-04 listed as not sorted (a log of about 470 lines a day: bazaar buys, sales
 * to item shops and in a bazaar, money from trades). Field names as that file gave them; the amounts are made up.
 */
test('ledger: sales and money from a trade are non-recurring, shop and ammo buys are spending, money the faction gives is a transfer, a slots win is the casino', () => {
    const cases = [
        // A sale is cash that is not certain to come again (the accountant's Q8, on points sold).
        [1226, { buyer: 1, items: [{ id: 9999, uid: null, qty: 2 }], cost_each: 500, cost_total: 1000 }, 'nonrecurring', 1000],
        [4210, { item: 9999, quantity: 3, value_each: 100, total_value: 300, area: 'x' }, 'nonrecurring', 300],
        [4441, { user: 1, trade_id: 'x', parsed_trade_id: 7, money: 2500 }, 'nonrecurring', 2500],
        [4200, { item: 9999, quantity: 2, cost_each: 50, cost_total: 100, area: 1 }, 'chosen', -100],
        [4500, { ammo: 1, quantity: 100, value: 4000 }, 'chosen', -4000],
        // Your faction balance paid out to your wallet: the other way of 6726.
        [6736, { sender: 1, faction: 1, money_given: 900 }, 'transfers', 900],
        [8300, { bet_amount: 100, won_amount: 350, barrel_positions: [1, 1, 1], combination: 3 }, 'uncontrollable', 250],
    ];
    for (const [type, data, account, amount] of cases) {
        const e = ledgerEntry({ id: 'x', type, title: '', at: T, data });
        assert.equal(e.known, true, type + ' is in the table');
        assert.equal(e.account, account, type + ' account');
        assert.equal(e.amount, amount, type + ' amount');
    }
    // Candy from a shop is for the gym, as from a bazaar.
    assert.equal(ledgerEntry({ id: 's', type: 4200, at: T, data: { item: XANAX, quantity: 1, cost_each: 9, cost_total: 9, area: 1 } }, isGymItem).account, 'training');
});

test('ledger: a trader’s days sort to the last line; what was sold is not counted on, and the cash adds up', () => {
    const l = book([
        ...pay(2, 1e6),
        line('buy', 1225, 1, { seller: 1, items: [{ id: 9999, uid: null, qty: 10 }], cost_each: 1000, cost_total: 10000 }),
        line('shop', 4210, 1, { item: 9999, quantity: 6, value_each: 1200, total_value: 7200, area: 'x' }),
        line('baz', 1226, 1, { buyer: 1, items: [{ id: 9999, uid: null, qty: 2 }], cost_each: 1500, cost_total: 3000 }),
        line('trade', 4441, 1, { user: 1, trade_id: 'x', parsed_trade_id: 7, money: 3200 }),
    ]);
    assert.deepEqual(l.unsorted, []);
    assert.equal(l.accounts.recurring.in, 2e6, 'pay only');
    assert.equal(l.accounts.chosen.out, 10000);
    assert.equal(l.accounts.nonrecurring.in, 13400);
    assert.equal(l.entries.reduce((n, e) => n + e.amount, 0), 2e6 - 10000 + 13400);
});

test('ledger: a line listed under two categories counts once; a line outside the days does not count', () => {
    const lines = [...pay(3), ...pay(3), line('old', 6221, 40, { pay: 5e6 })];
    const l = book(lines);
    assert.equal(l.entries.length, 3);
    assert.equal(l.accounts.recurring.in, 3e6);
});

test('ledger: a type the table does not know is "Not sorted", shown with its title and count, never guessed', () => {
    const l = book([...pay(5), line('u1', 4999, 2, { money: 9e9 }, 'Something new'), line('u2', 4999, 3, { money: 1e9 }, 'Something new')]);
    assert.deepEqual(l.unsorted, [{ type: 4999, title: 'Something new', n: 2 }]);
    assert.equal(l.accounts.unsorted.n, 2);
    assert.equal(l.accounts.unsorted.in, 0, 'no amount is read from a type nobody has shown');
    assert.equal(l.accounts.recurring.in, 5e6);
});

test('ledger: a purchase of gym items is Gym; anything else bought is other spending', () => {
    const l = book([
        line('b1', 1225, 1, { seller: 1, items: [{ id: XANAX, uid: null, qty: 3 }], cost_each: 830000, cost_total: 2490000 }),
        line('b2', 1112, 2, { seller: 1, anonymous: 0, items: [{ id: 9999, uid: null, qty: 1 }], cost_each: 40000, cost_total: 40000 }),
        line('b3', 4201, 3, { item: 9998, quantity: 5, cost_each: 100, cost_total: 500 }),
    ]);
    assert.equal(l.accounts.training.out, 2490000);
    assert.equal(l.accounts.chosen.out, 40500);
});

test('ledger: by nature, never by size: a $5 gift is non-recurring, a $50M pay day is recurring, a lump of upkeep is committed', () => {
    const l = book([
        ...pay(29, 1e6),
        line('big', 6221, 29, { pay: 50e6 }),
        line('gift', 4810, 9, { sender: 1, money: 2e9 }),
        line('small', 4810, 4, { sender: 1, money: 5 }),
        line('trade', 4440, 5, { user: 1, trade_id: 'x', money: 2e9 }),
        line('up', 5920, 6, { upkeep_paid: 5e6, upkeep_due: 0 }),
        line('send', 4800, 7, { receiver: 1, money: 100e3 }),
    ]);
    assert.deepEqual(l.oneOffs.map((e) => e.id).sort(), ['gift', 'send', 'small', 'trade']);
    assert.equal(l.accounts.recurring.in, 79e6, 'every pay day, the large one too');
    assert.equal(l.accounts.committed.out, 5e6);
    assert.equal(l.accounts.nonrecurring.in, 2e9 + 5);
    assert.equal(l.accounts.nonrecurring.out, 2e9 + 100e3);
});

test('ledger: your tick moves a line either way, whatever its type', () => {
    const lines = [...pay(30, 1e6), line('gift', 4810, 9, { sender: 1, money: 2e9 }), line('send', 4800, 4, { receiver: 1, money: 200e3 })];
    const l = book(lines, { overrides: { gift: false, send: false, pay3: true } });
    assert.deepEqual(l.oneOffs.map((e) => e.id), ['pay3']);
    assert.equal(l.accounts.recurring.in, 29e6 + 2e9, 'the gift counts as usual money');
    assert.equal(l.accounts.chosen.out, 200e3, 'money sent, unticked, is other spending');
    assert.equal(l.accounts.nonrecurring.in, 1e6);
    assert.equal(l.entries.find((e) => e.id === 'gift').ticked, true);
});

test('ledger: the casino is uncontrollable, net: buy-ins out, cash-outs in, never in recurring income', () => {
    const l = book([...pay(30, 1e6), line('j1', 8410, 2, { table: 1, value: 10e6 }), line('l1', 8411, 2, { table: 1, value: 2e6 }), line('s1', 8301, 3, { bet_amount: 1e6 }), line('m', 8156, 3, { attacker: 1, money_mugged: 5e5 })]);
    assert.equal(l.accounts.uncontrollable.net, -9.5e6);
    assert.equal(l.accounts.recurring.net, 30e6);
    assert.equal(l.oneOffs.length, 0);
});

test('ledger: a stock sale is a transfer of its cost and a non-recurring gain or loss; the two add up to the cash (Q5)', () => {
    const sell = line('sell', 5511, 3, { stock: 1, amount: 1, worth: 2.7e9, price: '1', fees: 2.7e6, profit: -5e6 });
    const e = ledgerEntry(sell);
    assert.deepEqual(ledgerParts(e), [
        { account: 'transfers', amount: 2.705e9, gain: false },
        { account: 'nonrecurring', amount: -5e6, gain: true },
    ]);
    const l = book([...pay(30, 1e6), sell, line('inv', 5450, 3, { amount: 2e9, worth: 2.35e9, duration: 7776000, percent: 17.55 })]);
    assert.equal(l.accounts.recurring.in, 30e6);
    assert.equal(l.accounts.transfers.net, 0.705e9);
    assert.equal(l.accounts.nonrecurring.net, -5e6);
    assert.equal(l.entries.length, 32, 'the sale is one line');
    assert.equal(l.oneOffs.length, 0, 'the sale itself is not a one-off line; only its loss is non-recurring');
    const gain = l.types.find((t) => t.gain);
    assert.equal(gain.title, 'Stock sell: gain or loss');
    assert.equal(gain.out, 5e6);
});

test('ledger: in names and counts (the export) a split line is listed once; the CSV has every line once with Torn’s log id', () => {
    const l = book([...pay(2, 1e6), line('sell', 5511, 3, { stock: 1, amount: 1, worth: 1000, price: '1', fees: 1, profit: 10 }), line('q,1', 4999, 1, {}, 'New "thing"')]);
    const shape = ledgerShape(l);
    assert.deepEqual(shape.types.map((t) => t.type + ':' + t.lines).sort(), ['4999:1', '5511:1', '6221:2']);
    assert.deepEqual(shape.types.find((t) => t.type === 5511).fields, ['worth', 'profit']);
    assert.ok(!/1000000|1e6/.test(JSON.stringify(shape)), 'never an amount');
    const csv = ledgerCsv(l).split('\r\n');
    assert.equal(csv[0], 'When (TCT),Torn log id,Log type,Log line,Account,In,Out,Of it a gain or loss');
    assert.equal(csv.length, 4 + 2, 'a header, four lines, the closing line break');
    assert.ok(csv.some((r) => r.includes(',sell,5511,Stock sell,Transfers,1000,,10')), csv.join('|'));
    assert.ok(csv.some((r) => r.includes('"q,1",4999,"New ""thing""",Not sorted,,,')), 'cells with commas and quotes are quoted');
});

/* The owner's own files, when they are on this PC (docs/ is never committed): every line sorts, each once. */
test('ledger: on the real logs in docs/, nothing is "Not sorted" and no line counts twice', { skip: !existsSync(new URL('../docs/torn-log-cat17-2026-10-03.json', import.meta.url)) }, async () => {
    const { real, rawLines } = await import('../docs/sims/round7/ledger-real.mjs');
    assert.deepEqual(real.unsorted, []);
    assert.equal(new Set(real.entries.map((e) => e.id)).size, real.entries.length);
    assert.ok(rawLines.length >= real.entries.length);
    // The stock sale is 97% of the money that came in and none of what was earned.
    assert.ok(real.accounts.transfers.in > 20 * real.accounts.recurring.in);
    assert.ok(real.accounts.recurring.in / real.days < 2e6, 'recurring a day: ' + Math.round(real.accounts.recurring.in / real.days));
});
