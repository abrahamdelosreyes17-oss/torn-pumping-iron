/*
 * The ledger (round 7, R7.5; ROUND7-PLAN §C): your money as books, not
 * guesses. Every line of Torn's log once (by its log id), sorted into an
 * account by Torn's log type id, never by words in its title. Pure.
 *
 * Cash basis: a line's amount is what it did to your wallet, signed. A type
 * the table does not know goes to "Not sorted" and is shown, never guessed.
 * The table was written from real log lines (the field names per type are
 * shown in Settings › Developer and in the report zip); a type nobody has
 * shown yet is not in it.
 *
 * Round 8, the accountant's answers (docs/LEDGER-ANSWERS.txt): a line is
 * sorted by what it is, never by its size. Recurring income comes back by
 * its nature; a gift, a trade payment, an auction or a sale of points is
 * non-recurring whatever its size; the casino, being mugged and what others
 * pay into your faction balance are outside your control and stand apart.
 */

import { DAY } from './bars.js';

/** Property upkeep: a cost that runs every day, whenever it is paid (cashflow.js keeps cash back for the days not paid yet). */
export const LEDGER_UPKEEP = 5920;

/**
 * The accounts, in the statement's order. `kind`: income (recurring: what a plan may count on), spend (what you
 * pay out), apart (shown, never in a daily figure), balance (money that only changed place), none (not sorted).
 */
export const LEDGER_ACCOUNTS = [
    { id: 'recurring', name: 'Recurring income', kind: 'income', what: 'pay, stock benefits, crimes, bounties, mugs' },
    { id: 'committed', name: 'Committed costs', kind: 'spend', what: 'property upkeep, education' },
    { id: 'training', name: 'Gym', kind: 'spend', what: 'gym items bought, rehab' },
    { id: 'chosen', name: 'Other spending', kind: 'spend', what: 'items bought that are not for the gym' },
    { id: 'uncontrollable', name: 'Uncontrollable gains and losses', kind: 'apart', what: 'the casino, being mugged, what others pay into your faction balance' },
    { id: 'nonrecurring', name: 'Non-recurring', kind: 'apart', what: 'gifts, money sent, trades, auctions, points sold, a gain or loss on stocks sold' },
    { id: 'transfers', name: 'Transfers', kind: 'balance', what: 'the bank, stocks bought and sold, the faction vault, your vault' },
    { id: 'unsorted', name: 'Not sorted', kind: 'none', what: 'log types the table does not know yet' },
];

const ledgerNum = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
/** An amount read from named fields of a line's data: `fields` says which (the report names them, never a value). */
const ledgerAmount = (fields, read) => Object.assign(read, { fields });
const ledgerField = (k) => ledgerAmount([k], (d) => ledgerNum(d[k]));

/**
 * Torn's log type id → how it is booked.
 *   amount(data): the money, positive (a roulette win is its payout less the stake, so it can be negative)
 *   sign: +1 into your wallet, −1 out of it
 *   internal: wallet ↔ vault, your liquid money is unchanged (left out of the reconciliation's flow)
 *   items(data): the item ids a purchase is about (gym items go to Gym)
 *   gain(data): the part of the amount that is a realised gain or loss (a stock sale's profit): booked as
 *     non-recurring, the rest stays in the line's own account
 */
export const LEDGER_TYPES = {
    6221: { title: 'Company employee pay', account: 'recurring', sign: 1, amount: ledgerField('pay') },
    5531: { title: 'Stock special money', account: 'recurring', sign: 1, amount: ledgerField('money') },
    9015: { title: 'Crime success money gain', account: 'recurring', sign: 1, amount: ledgerField('money_gained') },
    8155: { title: 'Attack mug', account: 'recurring', sign: 1, amount: ledgerField('money_mugged') },
    6710: { title: 'Bounty claim', account: 'recurring', sign: 1, amount: ledgerField('bounty_reward') },
    5920: { title: 'Property upkeep', account: 'committed', sign: -1, amount: ledgerField('upkeep_paid') },
    5960: { title: 'Education start', account: 'committed', sign: -1, amount: ledgerField('cost') },
    6005: { title: 'Rehab', account: 'training', sign: -1, amount: ledgerField('cost') },
    1112: { title: 'Item market buy', account: 'chosen', sign: -1, amount: ledgerField('cost_total'), items: (d) => (Array.isArray(d.items) ? d.items.map((x) => x && x.id) : []) },
    1225: { title: 'Bazaar buy', account: 'chosen', sign: -1, amount: ledgerField('cost_total'), items: (d) => (Array.isArray(d.items) ? d.items.map((x) => x && x.id) : []) },
    4201: { title: 'Item abroad buy', account: 'chosen', sign: -1, amount: ledgerField('cost_total'), items: (d) => [d.item] },
    // One line per spin: the payout holds the winning stake, the whole bet left the wallet.
    8305: { title: 'Casino roulette win', account: 'uncontrollable', sign: 1, amount: ledgerAmount(['won_amount', 'bet_amount'], (d) => ledgerNum(d.won_amount) - ledgerNum(d.bet_amount)) },
    8301: { title: 'Casino slots lose', account: 'uncontrollable', sign: -1, amount: ledgerField('bet_amount') },
    8306: { title: 'Casino roulette lose', account: 'uncontrollable', sign: -1, amount: ledgerField('bet_amount') },
    8350: { title: 'Casino blackjack start', account: 'uncontrollable', sign: -1, amount: ledgerField('bet') },
    8391: { title: 'Casino russian roulette join', account: 'uncontrollable', sign: -1, amount: ledgerField('bet_amount') },
    8410: { title: 'Casino poker table join', account: 'uncontrollable', sign: -1, amount: ledgerField('value') },
    8411: { title: 'Casino poker table leave', account: 'uncontrollable', sign: 1, amount: ledgerField('value') },
    8156: { title: 'Attack mug receive', account: 'uncontrollable', sign: -1, amount: ledgerField('money_mugged') },
    4810: { title: 'Money receive', account: 'nonrecurring', sign: 1, amount: ledgerField('money') },
    4800: { title: 'Money send', account: 'nonrecurring', sign: -1, amount: ledgerField('money') },
    4440: { title: 'Trade money outgoing', account: 'nonrecurring', sign: -1, amount: ledgerField('money') },
    5011: { title: 'Points market sell', account: 'nonrecurring', sign: 1, amount: ledgerField('cost_total') },
    // The whole bid leaves the wallet; what is over the winning price comes back as a cashier's check.
    4310: { title: 'Auction house item bid', account: 'nonrecurring', sign: -1, amount: ledgerField('bid_price') },
    5460: { title: 'Cashiers check withdraw', account: 'nonrecurring', sign: 1, amount: ledgerField('amount') },
    5450: { title: 'Bank invest', account: 'transfers', sign: -1, amount: ledgerField('amount') },
    5510: { title: 'Stock buy', account: 'transfers', sign: -1, amount: ledgerField('worth') },
    // `worth` is what reached the wallet (the fee is already off it); `profit` of it is the realised gain or loss.
    5511: { title: 'Stock sell', account: 'transfers', sign: 1, amount: ledgerField('worth'), gain: ledgerField('profit') },
    5851: { title: 'Vault withdraw', account: 'transfers', sign: 1, amount: ledgerField('withdrawn'), internal: true },
    6726: { title: 'Faction deposit money', account: 'transfers', sign: -1, amount: ledgerField('money_deposited') },
};

/** How a log type is booked, in names only: its account, its sign and the fields its amount is read from; null for a type not in the table. */
export function ledgerBooking(type) {
    const spec = LEDGER_TYPES[type];
    return spec ? { account: spec.account, sign: spec.sign, fields: [...spec.amount.fields, ...(spec.gain ? spec.gain.fields : [])] } : null;
}

/**
 * One raw log line (as fetchMoneyLog keeps it) into a ledger entry.
 * @param {{id:string, type:number, title:string, at:number, data:object}} line
 * @param {function} [isGymItem] - (item id) → is it something the gym plan uses
 */
export function ledgerEntry(line, isGymItem = null) {
    const spec = LEDGER_TYPES[line.type];
    const base = { id: String(line.id), at: line.at, type: line.type, title: (spec && spec.title) || line.title || 'Log type ' + line.type };
    if (!spec) return { ...base, account: 'unsorted', amount: 0, gain: 0, known: false, internal: false };
    const data = line.data && typeof line.data === 'object' ? line.data : {};
    const ids = spec.items ? spec.items(data).filter((x) => x !== undefined && x !== null) : [];
    const gym = Boolean(isGymItem && ids.length && ids.every((x) => isGymItem(x)));
    return { ...base, account: gym ? 'training' : spec.account, amount: spec.sign * spec.amount(data), gain: spec.gain ? spec.gain(data) : 0, known: true, internal: Boolean(spec.internal) };
}

/**
 * A line as the amounts it puts in each account: itself, except a sale with a realised gain or loss, whose gain is
 * non-recurring and whose cost coming back stays a transfer. The parts always add up to the line's amount.
 */
export function ledgerParts(e) {
    if (!e.gain || e.account === 'nonrecurring') return [{ account: e.account, amount: e.amount, gain: false }];
    return [
        { account: e.account, amount: e.amount - e.gain, gain: false },
        { account: 'nonrecurring', amount: e.gain, gain: true },
    ];
}

/**
 * The books over a span of days.
 * @param {object[]} lines - raw lines ({id, type, title, at (ms), data}); a line listed twice counts once
 * @param {object} o
 * @param {number} o.from - ms
 * @param {number} o.to - ms
 * @param {function} [o.isGymItem]
 * @param {object} [o.overrides] - {log id: true|false}: your tick. true: this line is non-recurring, whatever its
 *   type; false: a line non-recurring by its type counts as usual money (recurring income in, other spending out)
 * @returns {{from, to, days, entries, accounts, types, oneOffs, unsorted}}
 */
export function ledgerOf(lines, { from, to, isGymItem = null, overrides = {} } = {}) {
    const seen = new Set();
    const entries = [];
    for (const l of lines || []) {
        if (!l || l.id === undefined || l.id === null || !Number.isFinite(l.at)) continue;
        const key = String(l.id);
        if (seen.has(key) || l.at < from || l.at > to) continue;
        seen.add(key);
        const e = ledgerEntry(l, isGymItem);
        const tick = overrides ? overrides[e.id] : undefined;
        if (e.known && (tick === true || tick === false)) {
            e.ticked = true;
            if (tick && e.account !== 'nonrecurring') e.account = 'nonrecurring';
            else if (!tick && e.account === 'nonrecurring') e.account = e.amount >= 0 ? 'recurring' : 'chosen';
        }
        e.oneOff = e.account === 'nonrecurring';
        entries.push(e);
    }
    entries.sort((a, b) => b.at - a.at || (a.id < b.id ? -1 : 1));
    const days = Math.max(1, (to - from) / DAY);
    const dayOf = (at) => Math.floor((at - from) / DAY);

    const accounts = {};
    for (const a of LEDGER_ACCOUNTS) accounts[a.id] = { id: a.id, name: a.name, kind: a.kind, n: 0, in: 0, out: 0, net: 0 };
    const types = new Map();
    for (const e of entries) {
        accounts[e.account].n++;
        for (const p of ledgerParts(e)) {
            const a = accounts[p.account];
            const k = e.type + '|' + p.account + (p.gain ? '|gain' : '');
            const t = types.get(k) || { type: e.type, title: p.gain ? e.title + ': gain or loss' : e.title, account: p.account, gain: p.gain, internal: e.internal, n: 0, days: new Set(), in: 0, out: 0, last: 0 };
            t.n++;
            t.days.add(dayOf(e.at));
            t.last = Math.max(t.last, e.at);
            if (p.amount >= 0) {
                a.in += p.amount;
                t.in += p.amount;
            } else {
                a.out -= p.amount;
                t.out -= p.amount;
            }
            types.set(k, t);
        }
    }
    for (const a of Object.values(accounts)) a.net = a.in - a.out;
    return {
        from,
        to,
        days,
        entries,
        accounts,
        types: [...types.values()].map((t) => ({ ...t, days: t.days.size })).sort((a, b) => b.in + b.out - (a.in + a.out)),
        oneOffs: entries.filter((e) => e.oneOff),
        unsorted: [...types.values()].filter((t) => t.account === 'unsorted').map((t) => ({ type: t.type, title: t.title, n: t.n })),
    };
}

/**
 * The books in names and counts, never an amount (the learning-data export and the report zip): per account how
 * many lines, per log type how it is booked and from which fields, and the types not sorted.
 * @param {object|null} ledger - ledgerOf()
 */
export function ledgerShape(ledger) {
    if (!ledger) return null;
    const types = (ledger.types || []).filter((t) => !t.gain).map((t) => {
        const b = ledgerBooking(t.type);
        return { type: t.type, title: t.title, account: t.account, sign: b ? (b.sign > 0 ? '+' : '-') : null, fields: b ? b.fields : [], lines: t.n, days: t.days };
    });
    types.sort((a, b) => b.lines - a.lines || a.type - b.type);
    const accounts = LEDGER_ACCOUNTS.map((a) => {
        const mine = types.filter((t) => t.account === a.id);
        return { id: a.id, name: a.name, kind: a.kind, lines: mine.reduce((n, t) => n + t.lines, 0), types: mine.length };
    });
    return { days: Math.round(ledger.days), lines: (ledger.entries || []).length, accounts, types, unsorted: (ledger.unsorted || []).map((u) => ({ type: u.type, title: u.title, lines: u.n })) };
}

/** A cell for a CSV file: quoted when it holds a comma, a quote or a line break. */
const ledgerCsvCell = (v) => {
    const s = String(v === null || v === undefined ? '' : v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

/**
 * Every line of the books as a CSV file (the Ledger tab's "Download CSV"): when, Torn's log id and type, the
 * account it was booked in, and the money in or out, to the dollar.
 * @param {object} ledger - ledgerOf()
 * @returns {string}
 */
export function ledgerCsv(ledger) {
    const names = Object.fromEntries(LEDGER_ACCOUNTS.map((a) => [a.id, a.name]));
    const rows = [['When (TCT)', 'Torn log id', 'Log type', 'Log line', 'Account', 'In', 'Out', 'Of it a gain or loss']];
    for (const e of [...((ledger && ledger.entries) || [])].sort((a, b) => a.at - b.at)) {
        rows.push([new Date(e.at).toISOString().slice(0, 19).replace('T', ' '), e.id, e.type, e.title, names[e.account] || e.account, e.amount > 0 ? Math.round(e.amount) : '', e.amount < 0 ? Math.round(-e.amount) : '', e.gain ? Math.round(e.gain) : '']);
    }
    return rows.map((r) => r.map(ledgerCsvCell).join(',')).join('\r\n') + '\r\n';
}

/**
 * What we need to teach the table a log type it does not know (the Ledger tab's "Export log"): per log type its
 * title, how many lines and the names of its data fields, and how the known ones are booked. Never an amount, a
 * log id or a player.
 * @param {object} o
 * @param {object} o.ledger - ledgerOf()
 * @param {object[]} [o.fields] - the money log by type with its field names (core/report.js logFieldsList)
 * @returns {string} JSON
 */
export function ledgerExportOf({ ledger, fields = [], version = '', now = Date.now() }) {
    const shape = ledgerShape(ledger);
    const known = (type) => Boolean(LEDGER_TYPES[type]);
    return JSON.stringify(
        {
            what: 'Pumping Iron ledger log: log types, field names and counts. Never an amount, a log id or a player.',
            version,
            at: new Date(now).toISOString(),
            unsorted: (shape ? shape.unsorted : []).map((u) => ({ ...u, fields: ((fields || []).find((f) => Number(f.type) === Number(u.type)) || {}).fields || [] })),
            types: (fields || []).map((f) => ({ type: f.type, title: f.title, category: f.category, lines: f.lines, days: f.days, fields: f.fields, sorted: known(f.type) })),
            ledger: shape,
        },
        null,
        2,
    );
}
