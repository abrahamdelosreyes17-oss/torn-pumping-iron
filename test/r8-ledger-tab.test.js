/*
 * Round 8: the Ledger tab (the owner's pick: option A, adjusted to the accountant's answers), the warning for log
 * lines the table does not know with its "Export log", Plan's money block (P1) and the budget choice at Create plan.
 * Real field names, made-up ids and amounts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

class El {
    constructor(tag) {
        this.tagName = tag;
        this.children = [];
        this.attrs = {};
        this.own = '';
        this.listeners = {};
    }
    setAttribute(k, v) {
        this.attrs[k] = v;
    }
    getAttribute(k) {
        return this.attrs[k];
    }
    appendChild(c) {
        this.children.push(c);
        return c;
    }
    addEventListener(e, f) {
        (this.listeners[e] = this.listeners[e] || []).push(f);
    }
    set textContent(v) {
        this.own = String(v);
        this.children = [];
    }
    get textContent() {
        return this.own + this.children.map((c) => c.textContent).join('');
    }
    all(pred, out = []) {
        if (pred(this)) out.push(this);
        for (const c of this.children) if (c instanceof El) c.all(pred, out);
        return out;
    }
}
globalThis.document = { createElement: (t) => new El(t), createElementNS: (ns, t) => new El(t), createTextNode: (s) => ({ textContent: String(s) }) };

const { ledgerOf, ledgerExportOf } = await import('../src/core/ledger.js');
const { cashflowOf, reconcile, budgetOffer, moneyFigures } = await import('../src/core/cashflow.js');
const { renderLedger, unsortedWarning, statementCard, ownCard, linesCard, LEDGER_LINES_SHOWN } = await import('../src/ui/app/ledger-tab.js');

const DAY = 864e5;
const T = Date.parse('2026-10-03T12:00:00Z');
const FROM = T - 30 * DAY;
const line = (id, type, daysAgo, data, title = '') => ({ id, type, title, at: T - daysAgo * DAY - 3600e3, data });
const pay = (n = 30, each = 1e6) => Array.from({ length: n }, (_, i) => line('pay' + i, 6221, i, { pay: each }));
const LINES = [
    ...pay(30, 1e6),
    line('up', 5920, 10, { upkeep_paid: 3e6 }),
    line('xan', 1225, 2, { items: [{ id: 206, qty: 3 }], cost_total: 2.49e6 }),
    line('j', 8410, 2, { table: 1, value: 40e6 }),
    line('gift', 4810, 9, { sender: 1, money: 2e9 }),
    line('send', 4800, 7, { receiver: 1, money: 600e3 }),
    line('sell', 5511, 7, { stock: 1, amount: 1, worth: 100e6, profit: -4e6 }),
];
const UNKNOWN = [line('bz1', 1226, 3, { buyer: 9, cost_total: 77 }, 'Bazaar sell'), line('bz2', 1226, 4, { buyer: 9, cost_total: 78 }, 'Bazaar sell'), line('odd', 5861, 5, { deposited: 5 }, 'Vault deposit')];

function books(lines, { liquid = 442.28e6, bank = { amount: 3e9, profit: 526.5e6, until: T + 33 * DAY }, opening = null, closing = null, days = 92, pick = null } = {}) {
    const ledger = ledgerOf(lines, { from: FROM, to: T, isGymItem: (id) => id === 206 });
    const flow = cashflowOf({ ledger, liquid, bank, habitPerDay: 2.6e6, now: T });
    const recon = opening === null ? null : reconcile({ ledger, opening, closing });
    return { at: T, from: FROM, days: 30, lines: lines.length, ledger, flow, recon, reconSpan: recon ? { from: FROM, to: T } : null, offer: { ...budgetOffer({ flow, days, now: T, pick }), flow, ledger } };
}
const ctxFor = (b, over = {}) => ({ settings: { oneOffs: {} }, ui: {}, plan: { pickBy: 'auto' }, fullKey: { has: true, ok: true }, books: () => b, dev: { moneyFields: () => ({ list: [{ type: 1226, title: 'Bazaar sell', category: 'Money incoming', lines: 2, days: 2, fields: [{ name: 'buyer', is: 'number' }, { name: 'cost_total', is: 'number' }] }] }) }, version: '1.5.0', rerender: () => {}, setSettings: () => {}, go: () => {}, ...over });
const textOf = (nodes) => nodes.filter(Boolean).map((n) => n.textContent).join(' | ');
const buttons = (node) => node.all((n) => n.tagName === 'button');

test('Ledger: the statement leads; six sections by what a line is, with disposable income, the surplus and the change in cash', () => {
    const b = books(LINES, { opening: 300e6, closing: 300e6 + 30e6 - 3e6 - 2.49e6 - 40e6 + 2e9 - 600e3 + 100e6 });
    const page = renderLedger({ auto: { offer: b.offer } }, ctxFor(b));
    assert.equal(page.main[0].attrs.class, 'lead', 'no warning: the statement is the first card');
    const st = page.main[0].textContent;
    for (const words of ['How your income was worked out', '1Recurring income', 'Company employee pay 6221', '2Committed costs', 'Property upkeep 5920', 'Disposable income', '3What you chose to spend it on', 'Bazaar buy 1225', 'Surplus (deficit) from these 30 days', '4Uncontrollable gains and losses', 'Casino poker table join 8410', '5Non-recurring', 'Money receive 4810', 'Stock sell: gain or loss 5511', '6Transfers between your own accounts', 'Change in cash by the books', 'Does it add up?']) assert.ok(st.includes(words), 'the statement says: ' + words);
    // To the dollar, a cost in brackets.
    assert.ok(st.includes('$30,000,000') && st.includes('($3,000,000)') && st.includes('($40,000,000)') && st.includes('($4,000,000)'), st.slice(0, 400));
    assert.ok(st.includes('$27,000,000'), 'disposable income: $30M of pay less $3M of upkeep');
    assert.equal(page.main[0].all((n) => n.attrs['data-ledger-recon'] === 'reconciled').length, 1);
    assert.match(textOf(page.ctl[0]), /36 log lines, each once · 30 days · read 3 Oct 12:00 TCT.*Reconciled/);
    assert.deepEqual(page.main.map((c) => (c.textContent.match(/^(How your income was worked out|What you own|By account|Every line)/) || [''])[0]), ['How your income was worked out', 'What you own', 'By account', 'Every line']);
});

test('Ledger: what you own is free cash and restricted cash; upkeep not paid yet is kept back out of the wallet', () => {
    const b = books(LINES);
    const own = ownCard(b).textContent;
    const owed = Math.round((3e6 / 30) * (10 + 1 / 24));
    assert.ok(own.includes('Cash wallet + vault$442,280,000'), own);
    assert.ok(own.includes('Total free cash what the gym, or an investment, may use$' + (442.28e6 - owed).toLocaleString('en-US')), own);
    assert.ok(own.includes('Bank deposit until 5 Nov · then +$527M profit, counted on the day it is paid$3,000,000,000'), own);
    assert.ok(own.includes('Kept back for property upkeep'));
});

test('Ledger: a log line the table does not know is a warning at the top, with which lines, how many, and "Export log" (never an amount)', () => {
    const b = books([...LINES, ...UNKNOWN], { opening: 0, closing: 5 });
    const ctx = ctxFor(b);
    const page = renderLedger({ auto: null }, ctx);
    const warn = page.main[0];
    assert.equal(warn.attrs['data-ledger-warn'], '1', 'the warning is the first card on the tab');
    assert.ok(warn.textContent.includes('3 log lines are not sorted'));
    assert.ok(warn.textContent.includes('Bazaar sell type 1226 · 2 lines') && warn.textContent.includes('Vault deposit type 5861 · 1 line'), warn.textContent);
    assert.deepEqual(buttons(warn).map((x) => x.textContent), ['Export log']);
    // Never "Reconciled" while a line is unsorted, and the top bar says by how much it is off.
    assert.match(textOf(page.ctl[0]), /Off by \$/);
    assert.equal(unsortedWarning(books(LINES), ctx), null, 'nothing unsorted: no warning');
    // The file: types, field names and counts; no amount, no log id, no player.
    const file = ledgerExportOf({ ledger: b.ledger, fields: ctx.dev.moneyFields().list, version: '1.5.0', now: T });
    const j = JSON.parse(file);
    assert.deepEqual(j.unsorted, [{ type: 1226, title: 'Bazaar sell', lines: 2, fields: [{ name: 'buyer', is: 'number' }, { name: 'cost_total', is: 'number' }] }, { type: 5861, title: 'Vault deposit', lines: 1, fields: [] }]);
    assert.deepEqual(j.types.map((t) => [t.type, t.sorted]), [[1226, false]]);
    for (const secret of ['bz1', '2000000000', '40000000', '"77"', ': 77', ': 78']) assert.ok(!file.includes(secret), 'the export holds ' + secret);
});

test('Ledger: every line, newest first; a filter by account, "Show all", a tick to count a line as non-recurring or not', () => {
    const b = books(LINES);
    const sets = [];
    const ctx = ctxFor(b, { setSettings: (p) => sets.push(p) });
    const card = linesCard(b, ctx);
    assert.equal(card.all((n) => n.tagName === 'tbody')[0].children.length, LEDGER_LINES_SHOWN);
    assert.ok(card.textContent.includes('Showing 12 of 36 lines'));
    assert.deepEqual(buttons(card).map((x) => x.textContent), ['Download CSV', 'All 36', 'Recurring income 30', 'Committed costs 1', 'Gym 1', 'Uncontrollable gains and losses 1', 'Non-recurring 2', 'Transfers 1']);
    ctx.ui.ledgerFilter = 'nonrecurring';
    const filtered = linesCard(b, ctx);
    const rows = filtered.all((n) => n.tagName === 'tbody')[0].children;
    assert.deepEqual(rows.map((r) => r.children[1].textContent), ['Money send 4800', 'Money receive 4810']);
    // Unticking the gift counts it as usual money; ticking it back is what it already is by its type, so no tick is kept.
    const box = rows[1].all((n) => n.tagName === 'input')[0];
    assert.equal(box.checked, true);
    box.listeners.change.forEach((f) => f({ target: { checked: false } }));
    assert.deepEqual(sets.pop(), { oneOffs: { gift: false } });
    ctx.settings.oneOffs = { gift: false };
    box.listeners.change.forEach((f) => f({ target: { checked: true } }));
    assert.deepEqual(sets.pop(), { oneOffs: {} });
    // A transfer has no tick: money that only changed place is never income.
    ctx.ui.ledgerFilter = 'transfers';
    assert.equal(linesCard(b, ctx).all((n) => n.tagName === 'input').length, 0);
});

test('Ledger: without a Full key, or before the first read, the tab says what is missing', () => {
    const none = renderLedger({}, ctxFor(null, { fullKey: { has: false } }));
    assert.match(textOf(none.main), /needs a Full key: add one in Settings/);
    const waiting = renderLedger({}, ctxFor(null, { fullKey: { has: true, ok: true } }));
    assert.match(textOf(waiting.main), /has not been read yet/);
    assert.ok(textOf(waiting.ctl[0]).includes('Read now'));
});

test('Plan’s money block (P1): six figures in the accountant’s words, the last one says whether the plan fits your free cash', () => {
    const b = books(LINES);
    const figs = moneyFigures({ offer: b.offer, perDay: 2.41e6, cash: { fits: true, runsOutDay: null }, days: 92 });
    assert.deepEqual(figs.map((f) => f.label), ['Total free cash', 'Comes in a day', 'Your gym habit', 'Restricted until 5 Nov', 'Non-recurring, not counted', 'This plan a day']);
    assert.match(figs[0].value, /^\$441(\.\d+)?M$/);
    assert.match(figs[0].sub, /^wallet \+ vault, less \$1(\.\d+)?M kept for upkeep$/);
    assert.equal(figs[1].value, '$900,000');
    assert.equal(figs[1].sub, 'pay $1M · upkeep −$100,000');
    assert.deepEqual([figs[2].value, figs[2].sub], ['$2.6M a day', 'what you used, priced']);
    assert.match(figs[3].sub, /^the bank · then \+\$527M profit · upkeep$/);
    assert.deepEqual([figs[4].value, figs[4].sub], ['2 lines', '$2B together']);
    assert.deepEqual([figs[5].value, figs[5].sub, figs[5].tone], ['$2.41M', 'fits: lasts all 92 days', 'ok']);
    const out = moneyFigures({ offer: b.offer, perDay: 9e6, cash: { fits: false, runsOutDay: 55 }, days: 92 })[5];
    assert.deepEqual([out.sub, out.tone], ['your free cash runs out on day 55', 'warn']);
});

test('the budget at Create plan: the books recommend one; your own choice wins and is said in words; "all your free cash" spreads it over the plan’s days', () => {
    const b = books(LINES);
    assert.deepEqual(b.offer.options.map((o) => o.id), ['habit', 'stretch', 'free', 'max']);
    assert.equal(b.offer.recommended, 'habit');
    assert.equal(b.offer.picked, null);
    assert.equal(b.offer.perDay, 2.6e6);
    const free = books(LINES, { pick: 'free' }).offer;
    const owed = Math.round((3e6 / 30) * (10 + 1 / 24));
    assert.equal(free.picked, 'free');
    // The bank pays inside these 92 days: its profit is part of what the cash covers.
    assert.ok(Math.abs(free.perDay - (900e3 + (442.28e6 - owed + 526.5e6) / 92)) < 1, String(free.perDay));
    assert.match(free.why, /^Your pick: all your free cash, your free cash spread over these 92 days, plus what comes in\.$/);
    const max = books(LINES, { pick: 'max' }).offer;
    assert.equal(max.perDay, Infinity);
    assert.equal(books(LINES, { pick: 'nonsense' }).offer.picked, null, 'an unknown pick is the recommendation');
});
