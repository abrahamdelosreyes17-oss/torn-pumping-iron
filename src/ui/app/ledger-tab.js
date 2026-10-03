/*
 * The Ledger tab (round 8; the owner's pick: mockups/round8/ledger.html
 * option A, adjusted to the accountant's answers in docs/LEDGER-ANSWERS.txt).
 * Statements first: the statement of cash received and paid in six sections
 * by what a line is, what you own as free and restricted cash, then every
 * account and every line. A log type the table does not know is a warning at
 * the top, with "Export log" for what we need to teach it. Every figure is to
 * the dollar and opens to Torn's own log lines.
 */

import { h } from '../dom.js';
import { fmtInt, fmtMoney, fmtDollars } from '../../core/format.js';
import { LEDGER_ACCOUNTS, LEDGER_TYPES, ledgerCsv, ledgerExportOf } from '../../core/ledger.js';
import { sectionHead, meta, MONTH_NAMES } from './common.js';

/** Lines shown in "Every line" before "Show all". */
export const LEDGER_LINES_SHOWN = 12;

const ledgerDay = (at) => {
    const d = new Date(at);
    return d.getUTCDate() + ' ' + MONTH_NAMES[d.getUTCMonth()];
};
const ledgerWhen = (at) => ledgerDay(at) + ' ' + new Date(at).toISOString().slice(11, 16);
/** A figure of the statement: to the dollar, a cost in brackets (the accountant's way), nothing as a dash. */
const ledgerFig = (v) => (Math.round(v) === 0 ? '–' : v < 0 ? '(' + fmtDollars(-v) + ')' : fmtDollars(v));

/** Save text as a file from our own page (never on torn.com). */
function ledgerSave(text, name, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = h('a', { href: url, download: name, style: 'display:none' });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
    }, 1000);
}

/** "Export log": the log types, their field names and counts (never an amount), so the table can be taught. */
function exportLedgerLog(b, ctx) {
    const mf = ctx.dev && ctx.dev.moneyFields ? ctx.dev.moneyFields() : { list: [] };
    ledgerSave(ledgerExportOf({ ledger: b.ledger, fields: mf.list, version: ctx.version || '', now: Date.now() }), 'pumping-iron-ledger-log-' + new Date().toISOString().slice(0, 10) + '.json', 'application/json');
}

/**
 * The warning (the owner's word, 2026-10-03): a line the table does not know is flagged here, on the Ledger tab,
 * with which lines and how many, and a button that exports what we need to fix it.
 */
export function unsortedWarning(b, ctx) {
    const list = b.ledger.unsorted || [];
    if (!list.length) return null;
    const n = list.reduce((s, u) => s + u.n, 0);
    return h('div', { class: 'lead ledger-warn', role: 'alert', 'data-ledger-warn': '1' }, [
        h('div', { class: 'sh' }, [h('h2', { text: n + (n === 1 ? ' log line is' : ' log lines are') + ' not sorted' }), h('span', { class: 'tag warn', text: 'The figures below leave ' + (n === 1 ? 'it' : 'them') + ' out' })]),
        h('p', { style: 'margin:0 0 12px', text: 'Pumping Iron has not met ' + (list.length === 1 ? 'this kind of log line' : 'these kinds of log line') + ' before, so it reads no amount from ' + (n === 1 ? 'it' : 'them') + ' and your cash will not reconcile until it knows ' + (n === 1 ? 'it' : 'them') + '.' }),
        h('ul', { class: 'ledger-unsorted' }, list.map((u) => h('li', {}, [h('b', { class: 'white', text: u.title || 'Log type ' + u.type }), ' ', h('span', { class: 'muted num', text: 'type ' + u.type + ' · ' + u.n + (u.n === 1 ? ' line' : ' lines') })]))),
        h('div', { class: 'row', style: 'margin-top:16px;gap:12px;align-items:center' }, [
            h('button', { class: 'btn primary', type: 'button', 'data-ledger-export': '1', onclick: () => exportLedgerLog(b, ctx), text: 'Export log' }),
            h('span', { class: 'muted', text: 'The file holds log types, field names and counts, never an amount: send it with Settings › Report a problem and the table gets fixed.' }),
        ]),
    ]);
}

/** The statement of cash received and paid: six sections by what a line is, with the three results between them. */
export function statementCard(b) {
    const f = b.flow;
    const days = Math.round(f.days);
    const sec = Object.fromEntries(f.sections.map((s) => [s.id, s]));
    const rows = [];
    const head = (n, s) => rows.push(h('tr', { class: 'ih' }, [h('td', { class: 'num', style: 'width:28px', text: String(n) }), h('td', { colspan: '4' }, [h('b', { text: s.name }), ' ', h('small', { text: s.what })])]));
    const line = (l, daily) =>
        rows.push(
            h('tr', {}, [
                h('td'),
                h('td', {}, [l.title + ' ', h('small', { class: 'num', text: String(l.type) }), l.internal ? h('small', { text: ' · wallet ↔ vault, not added' }) : null]),
                h('td', { class: 'r num', text: fmtInt(l.n) }),
                h('td', { class: 'r num' + (l.total < 0 ? ' c-cost' : ''), text: ledgerFig(l.total) }),
                h('td', { class: 'r num muted', text: daily ? ledgerFig(l.perDay) : '' }),
            ]),
        );
    const total = (label, v, perDay, cls = '') => rows.push(h('tr', { class: 'sum ' + cls }, [h('td'), h('td', {}, [h('b', { class: 'w', text: label })]), h('td'), h('td', { class: 'r num' }, [h('b', { class: 'w', text: ledgerFig(v) })]), h('td', { class: 'r num', text: perDay === null ? '' : ledgerFig(perDay) })]));
    const section = (n, s) => {
        head(n, s);
        if (!s.lines.length) rows.push(h('tr', {}, [h('td'), h('td', { class: 'muted', colspan: '4', text: 'Nothing in these ' + days + ' days.' })]));
        for (const l of s.lines) line(l, s.daily);
        total('Total ' + s.name.replace(/^What you chose to spend it on$/, 'chosen spending').replace(/^[A-Z]/, (c) => c.toLowerCase()), s.total, s.daily ? s.perDay : null);
    };
    section(1, sec.recurring);
    section(2, sec.committed);
    total('Disposable income · 1 less 2, what is yours to spend', f.disposable.total, f.disposable.perDay, 'key');
    section(3, sec.spending);
    total('Surplus (deficit) from these ' + days + ' days · disposable income less 3', f.surplus.total, f.surplus.perDay, 'key');
    section(4, sec.uncontrollable);
    section(5, sec.nonrecurring);
    section(6, sec.transfers);
    total('Change in cash by the books · surplus (deficit) + 4 + 5 + 6', f.change, null, 'key');
    // The reconciliation: the books against Torn's own cash figure at two dates.
    const r = b.recon;
    if (r) {
        rows.push(h('tr', { class: 'ih' }, [h('td'), h('td', { colspan: '4' }, [h('b', { text: 'Does it add up?' }), ' ', h('small', { text: ledgerDay(b.reconSpan.from) + ' to ' + ledgerDay(b.reconSpan.to) + ' · your cash by the books against Torn’s own figure' })])]));
        const kv = (label, v, cls = '') => rows.push(h('tr', { class: cls }, [h('td'), h('td', { text: label }), h('td'), h('td', { class: 'r num', text: fmtDollars(v) }), h('td')]));
        kv('Cash on ' + ledgerDay(b.reconSpan.from) + ' · wallet + vault', r.opening);
        kv('Cash by the books · + received − paid', r.expected);
        kv('Cash Torn says, ' + ledgerDay(b.reconSpan.to), r.closing);
        rows.push(h('tr', { class: 'sum key', 'data-ledger-recon': r.reconciled ? 'reconciled' : 'off' }, [h('td'), h('td', {}, [h('span', { class: 'tag ' + (r.reconciled ? 'good' : 'warn'), text: r.reconciled ? 'Reconciled' : 'Off by ' + fmtDollars(Math.abs(r.gap)) }), ' ', h('span', { class: r.reconciled ? 'muted' : 'c-warn', text: r.words.replace(/^(Reconciled|Off by [^:]+): /, '') })]), h('td'), h('td', { class: 'r num' }, [h('b', { class: 'w', text: (r.gap > 0 ? '+' : '') + fmtDollars(r.gap) })]), h('td')]));
    }
    return h('div', { class: 'lead' }, [
        sectionHead('How your income was worked out', meta([fmtInt(b.ledger.entries.length) + ' log lines, each once · ' + ledgerDay(b.ledger.from) + ' to ' + ledgerDay(b.ledger.to) + ' · booked by what each line is · to the dollar'])),
        h('table', { class: 'tbl num ledger-st' }, [
            h('thead', {}, [h('tr', {}, [h('th'), h('th', { text: 'Statement of cash received and paid' }), h('th', { class: 'r', style: 'width:56px', text: 'Lines' }), h('th', { class: 'r', style: 'width:170px', text: days + ' days' }), h('th', { class: 'r', style: 'width:130px', text: 'A day' })])]),
            h('tbody', {}, rows),
        ]),
        r ? null : h('div', { class: 'note2', text: 'The check against Torn’s own cash figure needs your cash at two dates the log covers (read every 6 hours): not there yet.' }),
    ]);
}

/** What you own: free cash (what the gym may use) and restricted cash, as the accountant asked for it. */
export function ownCard(b) {
    const hv = b.flow.have;
    if (hv.liquid === null) return h('div', {}, [sectionHead('What you own', null, null, 'h3'), h('p', { class: 'muted', style: 'margin:0', text: 'Your cash has not been read yet.' })]);
    const kept = hv.restricted.filter((r) => r.fromCash);
    const row = (label, sub, v, cls = '') => h('tr', { class: cls }, [h('td', {}, [cls ? h('b', { class: 'w', text: label }) : label, sub ? h('small', { text: ' ' + sub }) : null]), h('td', { class: 'r num' }, [cls ? h('b', { class: 'w', text: fmtDollars(v) }) : fmtDollars(v)])]);
    const until = (r) => (r.until ? 'until ' + ledgerDay(r.until) + (r.profit > 0 ? ' · then +' + fmtMoney(Math.round(r.profit)) + ' profit, counted on the day it is paid' : '') : '');
    const rows = [
        row('Cash', 'wallet + vault', hv.liquid),
        ...kept.map((r) => row('Less: ' + r.name.toLowerCase(), fmtMoney(Math.round(r.perDay)) + ' a day, for the days not paid yet', -r.amount)),
        row('Total free cash', 'what the gym, or an investment, may use', hv.free, 'sum key'),
        h('tr', { class: 'ih' }, [h('td', { colspan: '2' }, [h('b', { text: 'Restricted cash' }), ' ', h('small', { text: 'yours, but not for spending' })])]),
        ...hv.restricted.map((r) => row(r.name, r.id === 'bank' ? until(r) : r.id === 'blocks' ? r.lines.map((l) => l.name + ' × ' + l.blocks).join(', ') + ' · at today’s price' : 'held out of your cash, above', r.amount)),
        hv.restricted.length ? row('Total restricted cash', '', hv.restrictedTotal, 'sum') : h('tr', {}, [h('td', { class: 'muted', colspan: '2', text: 'Nothing restricted: no bank deposit, no benefit block, no upkeep owed.' })]),
        hv.otherStocks > 0 ? row('Other stocks', 'not held for a block · at today’s price', hv.otherStocks) : null,
    ];
    return h('div', {}, [sectionHead('What you own', meta(['free cash is what a plan spends from · restricted cash never is']), null, 'h3'), h('table', { class: 'tbl num', 'data-ledger-own': '1' }, [h('tbody', {}, rows)])]);
}

/** Every account, opening to its log types. */
export function accountsCard(b) {
    const days = b.ledger.days;
    const m = (v) => (v ? fmtDollars(v) : '·');
    const rows = [];
    for (const a of LEDGER_ACCOUNTS) {
        const acc = b.ledger.accounts[a.id];
        const mine = b.ledger.types.filter((t) => t.account === a.id);
        const daily = a.kind === 'income' || a.kind === 'spend';
        rows.push(
            h('tr', { class: 'ih' }, [
                h('td', {}, [h('b', { text: a.name }), ' ', h('small', { text: a.what })]),
                h('td', { class: 'r', text: fmtInt(acc.n) }),
                h('td'),
                h('td', { class: 'r', text: m(acc.in) }),
                h('td', { class: 'r', text: m(acc.out) }),
                h('td', { class: 'r' }, [h('b', { class: 'w', text: acc.net ? (acc.net > 0 ? '+' : '') + fmtDollars(acc.net) : '·' }), daily && acc.net ? h('small', { text: ' ' + (acc.net > 0 ? '+' : '') + fmtMoney(Math.round(acc.net / days)) + ' a day' }) : null]),
            ]),
        );
        for (const t of mine) rows.push(h('tr', { class: 'sub' }, [h('td', {}, [h('small', { class: 'num', text: String(t.type) + ' ' }), t.title]), h('td', { class: 'r', text: fmtInt(t.n) }), h('td', { class: 'r', text: String(t.days) }), h('td', { class: 'r', text: m(t.in) }), h('td', { class: 'r', text: m(t.out) }), h('td')]));
    }
    return h('div', {}, [
        sectionHead('By account', meta(['every account opens to Torn’s own log lines']), null, 'h3'),
        h('table', { class: 'tbl num' }, [h('thead', {}, [h('tr', {}, [h('th', { text: 'Account' }), h('th', { class: 'r', style: 'width:56px', text: 'Lines' }), h('th', { class: 'r', style: 'width:52px', text: 'Days' }), h('th', { class: 'r', style: 'width:140px', text: 'In' }), h('th', { class: 'r', style: 'width:140px', text: 'Out' }), h('th', { class: 'r', style: 'width:230px', text: 'Net · a day' })])]), h('tbody', {}, rows)]),
    ]);
}

/** Is a line non-recurring by its type (before any tick of yours)? */
const ledgerByNature = (e) => Boolean(LEDGER_TYPES[e.type]) && LEDGER_TYPES[e.type].account === 'nonrecurring';

/** Every line, newest first: filter by account, tick a line to count it as non-recurring (or not), download them all. */
export function linesCard(b, ctx) {
    const names = Object.fromEntries(LEDGER_ACCOUNTS.map((a) => [a.id, a.name]));
    const all = b.ledger.entries;
    const filter = ctx.ui.ledgerFilter || 'all';
    const shown = filter === 'all' ? all : all.filter((e) => e.account === filter);
    const list = ctx.ui.ledgerAll ? shown : shown.slice(0, LEDGER_LINES_SHOWN);
    const chip = (id, label, n) => h('button', { type: 'button', class: 'btn sm' + (filter === id ? ' on' : ''), 'aria-pressed': String(filter === id), onclick: () => { ctx.ui.ledgerFilter = id; ctx.ui.ledgerAll = false; ctx.rerender(); }, text: label + ' ' + fmtInt(n) });
    const chips = [chip('all', 'All', all.length), ...LEDGER_ACCOUNTS.filter((a) => b.ledger.accounts[a.id].n).map((a) => chip(a.id, a.name, b.ledger.accounts[a.id].n))];
    const tick = (e, on) => {
        const next = { ...(ctx.settings.oneOffs || {}) };
        // A tick that says what the line already is by its type is no tick at all.
        if (on === ledgerByNature(e)) delete next[e.id];
        else next[e.id] = on;
        ctx.setSettings({ oneOffs: next });
    };
    const rows = list.map((e) =>
        h('tr', {}, [
            h('td', { class: 't', style: 'width:110px', text: ledgerWhen(e.at) }),
            h('td', {}, [e.title + ' ', h('small', { class: 'num', text: String(e.type) })]),
            h('td', { class: e.known ? '' : 'c-warn', text: names[e.account] || e.account }),
            h('td', { class: 'r', text: e.amount > 0 ? fmtDollars(e.amount) : '' }),
            h('td', { class: 'r', text: e.amount < 0 ? fmtDollars(-e.amount) : '' }),
            h('td', { class: 'r' }, [e.known && !e.internal && LEDGER_ACCOUNTS.find((a) => a.id === e.account).kind !== 'balance' ? h('label', { class: 'ledger-tick' }, [h('input', { type: 'checkbox', checked: e.oneOff, 'aria-label': 'Non-recurring', onchange: (ev) => tick(e, ev.target.checked) }), ' non-recurring']) : null]),
        ]),
    );
    return h('div', {}, [
        sectionHead('Every line', meta(['newest first · tick a line to keep it out of the daily figures, untick one to count it as usual money']), h('button', { class: 'btn sm', type: 'button', 'data-ledger-csv': '1', onclick: () => ledgerSave(ledgerCsv(b.ledger), 'pumping-iron-ledger-' + new Date().toISOString().slice(0, 10) + '.csv', 'text/csv'), text: 'Download CSV' }), 'h3'),
        h('div', { class: 'row ledger-chips', role: 'group', 'aria-label': 'Account' }, chips),
        h('table', { class: 'tbl num' }, [h('thead', {}, [h('tr', {}, [h('th', { text: 'When (TCT)' }), h('th', { text: 'Torn’s log line' }), h('th', { style: 'width:190px', text: 'Account' }), h('th', { class: 'r', style: 'width:130px', text: 'In' }), h('th', { class: 'r', style: 'width:130px', text: 'Out' }), h('th', { class: 'r', style: 'width:140px', text: 'Count as' })])]), h('tbody', {}, rows)]),
        shown.length > list.length ? h('div', { class: 'note2' }, ['Showing ' + list.length + ' of ' + fmtInt(shown.length) + ' lines · ', h('a', { href: '#ledger', onclick: (ev) => { ev.preventDefault(); ctx.ui.ledgerAll = true; ctx.rerender(); }, text: 'Show all' })]) : null,
    ]);
}

/** The side pane's "A day": what a plan counts on, what the gym costs you, and the budget the books offer. */
export function ledgerDayFacts(b, m, ctx) {
    const f = b.flow;
    const offer = m.auto && m.auto.offer ? m.auto.offer : null;
    const habit = offer ? offer.habitPerDay : f.habitPerDay !== null ? f.habitPerDay : f.trainingPerDay;
    const pick = offer ? offer.options.find((o) => o.id === offer.recommended) || { name: 'what your free cash covers' } : null;
    const kv = (label, sub, value, cls = '') => [h('dt', {}, [h('span', { class: 'white', text: label }), sub ? h('span', { text: ' · ' + sub }) : null]), h('dd', { class: 'num ' + cls, text: value })];
    return h('div', {}, [
        sectionHead('A day', meta(['what the plan uses']), null, 'h3'),
        h('dl', { class: 'kv', 'data-ledger-day': '1' }, [
            ...kv('Comes in a day', 'recurring income less committed costs', (f.earnsPerDay < 0 ? '−' : '') + fmtMoney(Math.abs(Math.round(f.earnsPerDay))), f.earnsPerDay < 0 ? 'c-warn' : 'white'),
            ...kv('The gym costs you a day', f.habitPerDay !== null ? 'your habit, from what you used' : 'gym items and rehab bought', fmtMoney(Math.round(habit)), 'white'),
            ...kv('Total free cash', 'wallet + vault, less what is kept back', f.have.free === null ? 'not read yet' : fmtMoney(Math.round(f.have.free)), 'white'),
            ...kv('Restricted cash', f.have.locked && f.have.locked.until ? 'the bank until ' + ledgerDay(f.have.locked.until) : '', fmtMoney(Math.round(f.have.restrictedTotal))),
            ...(offer ? kv('A plan may spend', pick.name.toLowerCase(), fmtMoney(Math.round(offer.perDay)) + ' a day', 'white') : []),
        ]),
        offer ? h('p', { class: 'why ok', style: 'margin:16px 0 0', text: offer.why }) : null,
        h('p', { class: 'muted', style: 'margin:12px 0 0;font-size:13px', text: 'The casino, gifts and sales are never counted on ahead: they reach the plan as cash, at the next recalibration.' }),
        h('div', { style: 'margin-top:16px' }, [h('a', { class: 'btn sm', href: '#plan', onclick: (ev) => { ev.preventDefault(); ctx.go && ctx.go('plan'); }, text: 'Open Plan' })]),
    ]);
}

/** How many ideas the pane lists. */
export const LEDGER_IDEAS_SHOWN = 4;

/**
 * The side pane's investment ideas (the accountant's ask): what would add to recurring income, best return a year
 * first, against your free cash. A list to choose from, never a step of the plan.
 */
export function investFacts(b) {
    const list = (b.ideas || []).slice(0, LEDGER_IDEAS_SHOWN);
    if (!list.length) return null;
    const days = (d) => (d >= 730 ? (d / 365).toFixed(1) + ' years' : Math.round(d) + ' days');
    return h('div', { 'data-ledger-ideas': '1' }, [
        sectionHead('Growing your recurring income', meta(['best return a year first']), null, 'h3'),
        ...list.map((x) =>
            h('div', { class: 'ledger-idea' }, [
                h('div', {}, [h('b', { class: 'white', text: x.name }), h('span', { class: 'tag ' + (x.fits === null ? '' : x.fits ? 'good' : 'warn'), text: x.fits === null ? 'cash not read' : x.fits ? 'your free cash covers it' : fmtMoney(Math.round(x.short)) + ' short' })]),
                h('div', { class: 'muted num', text: fmtMoney(Math.round(x.cost)) + ' · ' + x.what }),
                h('div', { class: 'num' }, [h('b', { class: 'white', text: '+' + fmtMoney(Math.round(x.perDay)) + ' a day' }), ' · ' + x.yearlyPct.toFixed(1) + '% a year · pays for itself in ' + days(x.paybackDays)]),
            ]),
        ),
        h('p', { class: 'muted', style: 'margin:12px 0 0;font-size:13px', text: 'At today’s share prices. Shares can lose value, and selling them ends the benefit; the bank’s money is locked until its term ends. Money put here becomes restricted cash: the plan no longer spends it.' }),
    ]);
}

/** The side pane's non-recurring lines: on their own, never in a daily figure. */
export function nonRecurringFacts(b) {
    const list = b.flow.oneOffs;
    const sum = list.reduce((n, e) => n + e.amount, 0);
    return h('div', {}, [
        sectionHead('Non-recurring', meta([list.length ? list.length + (list.length === 1 ? ' line' : ' lines') + ', not counted · ' + (sum > 0 ? '+' : '') + fmtMoney(Math.round(sum)) + ' together' : 'none in these days']), null, 'h3'),
        ...list.slice(0, 8).map((e) => h('div', { class: 'ledger-one' }, [h('span', {}, [h('span', { class: 'white', text: e.title }), h('span', { class: 'muted', text: ' · ' + ledgerDay(e.at) + (e.ticked ? ' · your tick' : '') })]), h('b', { class: 'num ' + (e.amount < 0 ? 'c-cost' : 'white'), text: (e.amount > 0 ? '+' : '') + fmtMoney(Math.round(e.amount)) })])),
        list.length > 8 ? h('div', { class: 'note2', text: 'and ' + (list.length - 8) + ' more, in “Every line” under Non-recurring.' }) : null,
        h('p', { class: 'muted', style: 'margin:12px 0 0;font-size:13px', text: 'Gifts, money sent, trades, auctions and points sold are non-recurring by what they are, whatever their size. Untick a line in the list to count it as usual money.' }),
    ]);
}

/** The side pane's table of how each log type is booked, with "Export log". */
export function bookingFacts(b, ctx) {
    const names = Object.fromEntries(LEDGER_ACCOUNTS.map((a) => [a.id, a.name]));
    const rows = Object.entries(LEDGER_TYPES).map(([type, s]) => h('tr', {}, [h('td', { class: 't num', text: type }), h('td', { text: s.title }), h('td', { text: names[s.account] + (s.gain ? ' · its gain or loss non-recurring' : '') }), h('td', { class: 'r', text: s.internal ? '=' : s.sign > 0 ? '+' : '−' })]));
    const n = (b.ledger.unsorted || []).reduce((s, u) => s + u.n, 0);
    return h('div', {}, [
        sectionHead('The account table', null, null, 'h3'),
        h('p', { class: 'muted', style: 'margin:0 0 12px;font-size:13px', text: 'Booked by Torn’s log type number, never by words in a title. A type the table does not know is “Not sorted” and no amount is read from it.' }),
        h('dl', { class: 'kv' }, [h('dt', { text: 'Not sorted' }), h('dd', { class: n ? 'c-warn' : 'c-good', text: n ? n + (n === 1 ? ' line' : ' lines') : 'none' })]),
        h('details', { class: 'dis', style: 'margin-top:12px' }, [h('summary', { text: 'How each of Torn’s log lines is booked (' + Object.keys(LEDGER_TYPES).length + ' types)' }), h('table', { class: 'tbl num', style: 'margin-top:12px' }, [h('tbody', {}, rows)])]),
        h('div', { style: 'margin-top:16px' }, [h('button', { class: 'btn sm', type: 'button', onclick: () => exportLedgerLog(b, ctx), text: 'Export log' })]),
    ]);
}

export function renderLedger(m, ctx) {
    const b = ctx.books ? ctx.books() : null;
    const fk = ctx.fullKey || {};
    if (!b) {
        const why = !fk.has
            ? 'The ledger is read from your money log, which needs a Full key: add one in Settings. It stays in this browser and is used for nothing else.'
            : !fk.ok
              ? 'The Full key in Settings is not working' + (fk.error ? ' (' + fk.error + ')' : '') + ': save it again.'
              : 'Your money log has not been read yet. It is read every 6 hours; “Read now” asks Torn at once.';
        return {
            ctl: [[h('span', { class: 'muted', text: 'Your money as books: every log line once, sorted by what it is' }), h('span', { class: 'grow' }), fk.ok ? h('button', { class: 'btn sm', type: 'button', disabled: Boolean(ctx.ui.ledgerReading), onclick: () => ctx.readBooks && ctx.readBooks(), text: ctx.ui.ledgerReading ? 'Reading…' : 'Read now' }) : null]],
            main: [h('div', { class: 'lead' }, [sectionHead('Ledger'), h('p', { style: 'margin:0', text: why }), fk.has ? null : h('div', { style: 'margin-top:16px' }, [h('a', { class: 'btn primary', href: '#settings', onclick: (ev) => { ev.preventDefault(); ctx.go && ctx.go('settings'); }, text: 'Open Settings' })])])],
            pane: [],
        };
    }
    const r = b.recon;
    const ctl = [
        h('span', { class: 'muted num', text: fmtInt(b.ledger.entries.length) + ' log lines, each once · ' + Math.round(b.days) + ' days · read ' + ledgerWhen(b.at) + ' TCT' }),
        h('button', { class: 'btn sm', type: 'button', disabled: Boolean(ctx.ui.ledgerReading), title: 'Reads your money log from Torn now (it is read by itself every 6 hours)', onclick: () => ctx.readBooks && ctx.readBooks(), text: ctx.ui.ledgerReading ? 'Reading…' : 'Read now' }),
        ctx.ui.ledgerError ? h('span', { class: 'c-warn', text: ctx.ui.ledgerError }) : null,
        h('span', { class: 'grow' }),
        r ? h('span', { class: 'tag ' + (r.reconciled ? 'good' : 'warn'), text: r.reconciled ? 'Reconciled' : 'Off by ' + fmtDollars(Math.abs(r.gap)) }) : h('span', { class: 'muted', text: 'not checked against Torn’s cash yet' }),
    ];
    return {
        ctl: [ctl],
        main: [unsortedWarning(b, ctx), statementCard(b), ownCard(b), accountsCard(b), linesCard(b, ctx)].filter(Boolean),
        pane: [ledgerDayFacts(b, m, ctx), investFacts(b), nonRecurringFacts(b), bookingFacts(b, ctx)].filter(Boolean),
    };
}
