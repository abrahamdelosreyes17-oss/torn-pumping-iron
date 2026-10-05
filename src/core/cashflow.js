/*
 * The statements read off the ledger (round 7, R7.5; ROUND7-PLAN §C.3–C.5):
 * what you have, what you earned and spent, whether the log explains your
 * cash (the reconciliation), and the budget a plan may spend. Pure: sums
 * over core/ledger.js, every number traceable to its lines.
 *
 * Round 8, the accountant's answers (docs/LEDGER-ANSWERS.txt): one
 * statement in six sections by what a line is, and what you own as free
 * cash (what the gym may use) and restricted cash (the bank, stocks held for
 * a benefit block, what is kept back for property upkeep not paid yet).
 * A plan counts on recurring income less committed costs; the casino, gifts
 * and sales reach it as cash, at the next recalibration. So does trading
 * (session 12, his answer to question 21): one line, sales less purchases.
 */

import { DAY } from './bars.js';
import { fmtMoney, fmtDollars } from './format.js';
import { LEDGER_UPKEEP } from './ledger.js';

/** "Reconciled" only when the difference is under this share of a month's recurring income and no line is unsorted. */
export const RECONCILE_INCOME_PCT = 1;

/** The statement's sections, in order: the accounts each one adds up, and whether it counts in a daily figure. */
export const STATEMENT_SECTIONS = [
    { id: 'recurring', name: 'Recurring income', what: 'what comes in by its nature, month after month', accounts: ['recurring'], daily: true },
    { id: 'committed', name: 'Committed costs', what: 'what you must pay to keep what you have', accounts: ['committed'], daily: true },
    { id: 'spending', name: 'What you chose to spend it on', what: 'the gym competes with these', accounts: ['training', 'chosen'], daily: true },
    { id: 'uncontrollable', name: 'Uncontrollable gains and losses', what: 'outside your control: never counted on, a large one calls for a recalibration', accounts: ['uncontrollable'], daily: false },
    { id: 'nonrecurring', name: 'Non-recurring', what: 'by what they are, whatever their size: never in a daily figure', accounts: ['nonrecurring', 'trading'], daily: false },
    { id: 'transfers', name: 'Transfers between your own accounts', what: 'your money changing place: never income, never spending', accounts: ['transfers'], daily: false },
];

/**
 * Shares held for benefit blocks: Torn's blocks double (the 2nd needs twice the 1st), so `increment` blocks hold
 * requirement × (2^increment − 1) shares.
 * @param {object[]} userStocks - /user/stocks [{id, shares, bonus: {increment}}]
 * @param {object[]} tornStocks - /torn/stocks, slim [{id, acronym, price, bonus: {requirement}}]
 * @returns {{amount:number, other:number, lines:{id, name, blocks, amount}[]}|null} null when no price is known
 */
export function stockBlocks(userStocks, tornStocks) {
    const info = new Map((tornStocks || []).map((s) => [Number(s.id), s]));
    const lines = [];
    let other = 0;
    let priced = false;
    for (const us of userStocks || []) {
        const s = info.get(Number(us && us.id));
        const price = s ? Number(s.price) : NaN;
        const shares = Number(us && us.shares) || 0;
        if (!(price > 0) || !(shares > 0)) continue;
        priced = true;
        const blocks = Number(us.bonus && us.bonus.increment) || 0;
        const need = Number(s.bonus && s.bonus.requirement) || 0;
        const held = blocks > 0 && need > 0 ? Math.min(shares, need * (2 ** blocks - 1)) : 0;
        if (held > 0) lines.push({ id: us.id, name: s.acronym || s.name || 'Stock ' + us.id, blocks, amount: held * price });
        other += (shares - held) * price;
    }
    if (!priced) return null;
    return { amount: lines.reduce((n, l) => n + l.amount, 0), other, lines: lines.sort((a, b) => b.amount - a.amount) };
}

/**
 * The statements over the ledger's days.
 * @param {object} o
 * @param {object} o.ledger - ledgerOf()
 * @param {number|null} [o.liquid] - wallet + vault now
 * @param {object|null} [o.bank] - the city bank investment {amount, profit, until (ms)}
 * @param {object|null} [o.blocks] - stockBlocks()
 * @param {number|null} [o.habitPerDay] - what the gym really cost a day (receipts: what was used, priced)
 * @param {number} [o.now] - ms (the days of upkeep not paid yet); the ledger's last moment when left out
 * @returns {object} {days, have, sections, disposable, surplus, change, earnsPerDay, comesIn, trainingPerDay, habitPerDay, oneOffs, unsorted}
 */
export function cashflowOf({ ledger, liquid = null, bank = null, blocks = null, habitPerDay = null, now = null }) {
    const a = ledger.accounts;
    const days = ledger.days;
    const per = (v) => v / days;
    const sections = STATEMENT_SECTIONS.map((sec) => {
        const lines = ledger.types
            .filter((t) => sec.accounts.includes(t.account) && (t.in || t.out))
            .map((t) => ({ type: t.type, title: t.title, account: t.account, n: t.n, days: t.days, internal: Boolean(t.internal), total: t.in - t.out, perDay: per(t.in - t.out) }))
            .sort((x, y) => Math.abs(y.total) - Math.abs(x.total));
        // Trading is one line (the accountant, Q21): sales less purchases, whatever log types they came as.
        const traded = ledger.types.filter((t) => t.account === 'trading' && sec.accounts.includes('trading'));
        if (traded.length) {
            const sold = traded.reduce((n, t) => n + t.in, 0);
            const bought = traded.reduce((n, t) => n + t.out, 0);
            const rest = lines.filter((l) => l.account !== 'trading');
            rest.push({ type: '', title: 'Trading', account: 'trading', n: traded.reduce((n, t) => n + t.n, 0), days: Math.max(...traded.map((t) => t.days)), internal: false, total: sold - bought, perDay: per(sold - bought), sold, bought });
            lines.splice(0, lines.length, ...rest.sort((x, y) => Math.abs(y.total) - Math.abs(x.total)));
        }
        // A wallet ↔ vault line is listed, never added: your liquid money did not change.
        const total = lines.reduce((n, l) => n + (l.internal ? 0 : l.total), 0);
        return { id: sec.id, name: sec.name, what: sec.what, daily: sec.daily, lines, total, perDay: per(total) };
    });
    const sec = Object.fromEntries(sections.map((s) => [s.id, s]));
    const disposable = sec.recurring.total + sec.committed.total;
    const surplus = disposable + sec.spending.total;
    const change = surplus + sec.uncontrollable.total + sec.nonrecurring.total + sec.transfers.total;
    // Upkeep runs every day, whenever it is paid: the days since the last payment are cash to be spent, kept back.
    const up = ledger.types.find((t) => t.type === LEDGER_UPKEEP && t.account === 'committed');
    const end = Number.isFinite(now) ? now : ledger.to;
    const upkeepPerDay = up ? per(up.out) : 0;
    const upkeepOwed = up && up.last ? Math.max(0, Math.round(upkeepPerDay * Math.min(days, (end - up.last) / DAY))) : 0;
    const restricted = [];
    if (bank && bank.amount > 0) restricted.push({ id: 'bank', name: 'Bank deposit', amount: bank.amount, until: bank.until || null, profit: bank.profit || 0 });
    if (blocks && blocks.amount > 0) restricted.push({ id: 'blocks', name: 'Stocks held for a benefit block', amount: blocks.amount, lines: blocks.lines });
    if (upkeepOwed > 0) restricted.push({ id: 'upkeep', name: 'Kept back for property upkeep', amount: upkeepOwed, perDay: upkeepPerDay, fromCash: true });
    const has = Number.isFinite(liquid);
    return {
        days,
        have: {
            liquid: has ? liquid : null,
            // What the gym (or an investment) may use: the wallet and vault, less what is kept back out of them.
            free: has ? Math.max(0, liquid - upkeepOwed) : null,
            restricted,
            restrictedTotal: restricted.reduce((n, r) => n + r.amount, 0),
            otherStocks: blocks ? blocks.other : null,
            locked: bank && bank.amount > 0 ? { amount: bank.amount, profit: bank.profit || 0, until: bank.until || null } : null,
        },
        sections,
        disposable: { total: disposable, perDay: per(disposable) },
        surplus: { total: surplus, perDay: per(surplus) },
        change,
        // What a plan may count on a day: recurring income less committed costs.
        earnsPerDay: per(disposable),
        comesIn: [...sec.recurring.lines, ...sec.committed.lines].sort((x, y) => Math.abs(y.perDay) - Math.abs(x.perDay)),
        trainingPerDay: per(a.training.out - a.training.in),
        habitPerDay: Number.isFinite(habitPerDay) ? habitPerDay : null,
        oneOffs: ledger.oneOffs.map((e) => ({ id: e.id, at: e.at, title: e.title, account: e.account, amount: e.amount, ticked: Boolean(e.ticked) })),
        unsorted: ledger.unsorted,
    };
}

/**
 * The reconciliation: opening liquid + in − out = closing liquid. Wallet ↔ vault lines are left out (liquid is
 * both). The difference is listed to the dollar; it is "Reconciled" only when no line is unsorted and the
 * difference is under RECONCILE_INCOME_PCT of a month's recurring income (the two balances are read hours apart
 * from the log's first and last lines, so exactly zero is rare).
 * @param {object} o - {ledger, opening, closing}: liquid money at the ledger's first and last moment
 * @returns {{opening, closing, in, out, expected, gap, limit, unsorted, reconciled, rough, words}|null} null without both ends
 */
export function reconcile({ ledger, opening, closing }) {
    if (!ledger || !Number.isFinite(opening) || !Number.isFinite(closing)) return null;
    let inn = 0;
    let out = 0;
    for (const e of ledger.entries) {
        if (e.internal) continue;
        if (e.amount >= 0) inn += e.amount;
        else out -= e.amount;
    }
    const expected = opening + inn - out;
    const gap = closing - expected;
    const limit = (RECONCILE_INCOME_PCT / 100) * (ledger.accounts.recurring.in / ledger.days) * 30;
    const unsorted = (ledger.unsorted || []).reduce((n, u) => n + u.n, 0);
    const off = Math.abs(Math.round(gap));
    const reconciled = unsorted === 0 && (off === 0 || off <= limit);
    const words = reconciled
        ? off === 0
            ? 'Reconciled: the log explains your cash to the dollar.'
            : 'Reconciled: ' + fmtDollars(off) + (gap > 0 ? ' more came in' : ' more went out') + ' than the log explains, under ' + RECONCILE_INCOME_PCT + '% of a month’s recurring income.'
        : 'Off by ' + fmtDollars(off) + ': ' + (gap > 0 ? 'more came in' : 'more went out') + ' than the log explains' + (unsorted ? ', and ' + unsorted + (unsorted === 1 ? ' line is' : ' lines are') + ' not sorted yet.' : '.');
    return { opening, closing, in: inn, out, expected, gap, limit, unsorted, reconciled, rough: !reconciled, words };
}

/**
 * The day-by-day cash check: a plan fits when free cash + what you earn + dated money − what it has cost so far
 * never goes under the money you keep aside.
 * @param {object} o
 * @param {number} o.liquid - free cash at the start
 * @param {number} o.earnsPerDay - what comes in a day before the gym (can be negative)
 * @param {number[]} o.costDaily - the plan's cost on each day
 * @param {{day:number, amount:number}[]} [o.dated] - money that arrives on a day (the bank's profit when it ends)
 * @param {number} [o.keepAside]
 * @returns {{fits:boolean, runsOutDay:number|null, lowest:number, lowestDay:number}}
 */
export function cashCheck({ liquid, earnsPerDay, costDaily, dated = [], keepAside = 0 }) {
    let cash = liquid;
    let lowest = cash;
    let lowestDay = 0;
    let runsOutDay = null;
    for (let d = 0; d < costDaily.length; d++) {
        cash += earnsPerDay - (costDaily[d] || 0);
        for (const x of dated) if (x.day === d) cash += x.amount;
        if (cash < lowest) {
            lowest = cash;
            lowestDay = d + 1;
        }
        if (runsOutDay === null && cash < keepAside - 0.5) runsOutDay = d + 1;
    }
    return { fits: runsOutDay === null, runsOutDay, lowest, lowestDay };
}

/**
 * The cash check on a plan's own days: the simulator's `costDaily` (a jump buys in lumps, so an even cost a day
 * can pass where the real days do not). Null without your books or a cash figure.
 * @param {object|null} books - budgetOffer()
 * @param {number[]} costDaily - what the plan pays on each day
 * @returns {{fits:boolean, runsOutDay:number|null, lowest:number, lowestDay:number}|null}
 */
export function planCash(books, costDaily) {
    if (!books || !Number.isFinite(books.liquid) || !Array.isArray(costDaily)) return null;
    const c = cashCheck({ liquid: books.liquid, earnsPerDay: books.earnsPerDay, costDaily, dated: books.dated || [], keepAside: books.keepAside || 0 });
    return { ...c, lowest: Math.round(c.lowest) };
}

/** A plan's result as it is kept: its cash check (`cash`) in place of the cost of every day. */
export function withCash(r, books) {
    if (!r || typeof r !== 'object') return r;
    const { costDaily, ...rest } = r;
    const cash = planCash(books, costDaily);
    return cash ? { ...rest, cash } : rest;
}

/**
 * The budget a plan may spend a day, offered when a plan is made (ROUND7-PLAN §C.5): your habit (what the gym
 * really cost you), stretch (everything that comes in after committed costs), all your free cash spread over the
 * plan's days, no limit. Only free cash is spent (restricted cash never is): each offer passes or fails the cash
 * check over the plan's days, and one is recommended with its reason.
 * @param {object} o
 * @param {object} o.flow - cashflowOf()
 * @param {number} o.days - the plan's length
 * @param {number} [o.keepAside] - money never to go under (a setting; 0)
 * @param {number} [o.now] - ms (the bank's end date against the plan's days)
 * @param {string|null} [o.pick] - the budget you chose at Create plan (an option's id); the recommended one when left out
 * @returns {{options:object[], recommended:string, picked:string|null, perDay:number, why:string, earnsPerDay:number, liquid:number|null, dated:object[]}}
 */
export function budgetOffer({ flow, days, keepAside = 0, now = Date.now(), pick = null }) {
    const liquid = flow.have.free;
    const earns = flow.earnsPerDay;
    // The gym's own cost a day: receipts (what was used) when they cover enough days, else what the log shows bought.
    const habit = Math.max(0, flow.habitPerDay !== null ? flow.habitPerDay : flow.trainingPerDay);
    const locked = flow.have.locked;
    const dated = [];
    if (locked && locked.until && locked.profit > 0) {
        const day = Math.floor((locked.until - now) / DAY);
        if (day >= 0 && day < days) dated.push({ day, amount: locked.profit, what: 'the bank’s profit' });
    }
    const check = (perDay) => (liquid === null ? null : cashCheck({ liquid, earnsPerDay: earns, costDaily: Array.from({ length: Math.ceil(days) }, () => perDay), dated, keepAside }));
    // What your cash covers over these days: every free dollar above the keep-aside, plus what comes in.
    const datedSum = dated.reduce((s, x) => s + x.amount, 0);
    const covers = liquid === null ? Math.max(0, earns) : Math.max(0, earns + (liquid - keepAside + datedSum) / Math.max(1, days));
    const option = (id, name, perDay, what) => {
        const c = Number.isFinite(perDay) ? check(perDay) : null;
        return { id, name, perDay, what, fits: c ? c.fits : null, runsOutDay: c ? c.runsOutDay : null };
    };
    const stretch = Math.max(habit, earns);
    const options = [
        option('habit', 'Your habit', habit, 'what the gym cost you a day over the last ' + Math.round(flow.days) + ' days'),
        option('stretch', 'Stretch', stretch, stretch > habit ? 'everything that comes in a day after your committed costs' : 'no more comes in than your habit spends'),
        ...(liquid === null ? [] : [option('free', 'All your free cash', covers, 'your free cash spread over these ' + Math.round(days) + ' days, plus what comes in')]),
        option('max', 'No limit', Infinity, 'the plan that gains most, whatever it costs'),
    ];
    const [h, s] = options;
    let recommended;
    let perDay;
    let why;
    if (s.perDay > h.perDay && s.fits !== false) {
        recommended = 'stretch';
        perDay = s.perDay;
        why = 'About ' + fmtMoney(Math.round(earns)) + ' a day comes in after your committed costs, more than the gym costs you now (' + fmtMoney(Math.round(habit)) + ' a day): the plan may use all of it.';
    } else if (h.perDay > 0 && h.fits !== false) {
        recommended = 'habit';
        perDay = h.perDay;
        why = liquid === null
            ? 'The gym costs you ' + fmtMoney(Math.round(habit)) + ' a day; less than that comes in, so the plan keeps to it.'
            : 'The gym costs you ' + fmtMoney(Math.round(habit)) + ' a day and ' + fmtMoney(Math.round(Math.max(0, earns))) + ' a day comes in: your ' + fmtMoney(Math.round(liquid)) + ' of free cash covers the difference for these ' + Math.round(days) + ' days.';
    } else if (h.perDay > 0) {
        // Your habit does not last these days: what your cash covers, to the day.
        recommended = 'covers';
        perDay = Math.min(covers, h.perDay);
        why = 'Your habit (' + fmtMoney(Math.round(habit)) + ' a day) runs out on day ' + h.runsOutDay + ': the plan keeps to ' + fmtMoney(Math.round(perDay)) + ' a day, what your free cash covers.';
    } else {
        // Nothing comes in after your committed costs and nothing was spent on the gym: nothing is taken from your savings unasked.
        recommended = 'habit';
        perDay = 0;
        why = 'Nothing comes in after your committed costs and the gym cost you nothing in these days: the plan costs nothing unless you pick a budget.';
    }
    // Your own choice at Create plan wins over the recommendation; the page still says which one the books recommend.
    const chosen = pick ? options.find((o) => o.id === pick) || null : null;
    if (chosen) {
        perDay = chosen.perDay;
        why = 'Your pick: ' + chosen.name.toLowerCase() + ', ' + chosen.what + '.' + (chosen.fits === false ? ' At that pace your free cash runs out on day ' + chosen.runsOutDay + '.' : '');
    }
    return { options, recommended, picked: chosen ? chosen.id : null, perDay: Math.max(0, perDay), why, earnsPerDay: earns, habitPerDay: habit, covers, liquid, dated, keepAside };
}

const cashDay = (at) => new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * The Plan page's money block (the owner's pick P1, mockups/round8/ledger.html): six figures in a row, each with
 * one line under it, in the accountant's words (free cash, restricted cash, non-recurring).
 * @param {object} o
 * @param {object} o.offer - budgetOffer() with its `flow` (runtime booksFor)
 * @param {number} o.perDay - what the plan you follow costs a day
 * @param {object|null} [o.cash] - that plan's cash check (planCash)
 * @param {number} o.days - the plan's length
 * @returns {{id:string, label:string, value:string, sub:string, tone:string}[]}
 */
export function moneyFigures({ offer, perDay, cash = null, days }) {
    const f = offer.flow;
    const hv = f.have;
    const kept = hv.restricted.filter((r) => r.fromCash).reduce((n, r) => n + r.amount, 0);
    const signed = (v) => (v < 0 ? '−' : '') + fmtMoney(Math.abs(Math.round(v)));
    const top = f.comesIn.slice(0, 2).map((l) => l.title.replace(/^Company employee pay$/, 'pay').replace(/^Property upkeep$/, 'upkeep').replace(/^Stock special money$/, 'stock benefits') + ' ' + signed(l.perDay));
    const bank = hv.restricted.find((r) => r.id === 'bank');
    const others = hv.restricted.filter((r) => r.id !== 'bank');
    const oneOffSum = f.oneOffs.reduce((n, e) => n + e.amount, 0);
    return [
        { id: 'free', label: 'Total free cash', value: hv.free === null ? 'not read yet' : fmtMoney(Math.round(hv.free)), sub: 'wallet + vault' + (kept > 0 ? ', less ' + fmtMoney(kept) + ' kept for upkeep' : ''), tone: '' },
        { id: 'in', label: 'Comes in a day', value: signed(f.earnsPerDay), sub: top.length ? top.join(' · ') : 'recurring income less committed costs', tone: f.earnsPerDay < 0 ? 'warn' : '' },
        { id: 'habit', label: 'Your gym habit', value: fmtMoney(Math.round(offer.habitPerDay)) + ' a day', sub: f.habitPerDay !== null ? 'what you used, priced' : 'gym items and rehab bought', tone: '' },
        {
            id: 'restricted',
            label: bank && bank.until ? 'Restricted until ' + cashDay(bank.until) : 'Restricted cash',
            value: hv.restrictedTotal > 0 ? fmtMoney(Math.round(hv.restrictedTotal)) : 'none',
            sub: bank && bank.profit > 0 ? 'the bank · then +' + fmtMoney(Math.round(bank.profit)) + ' profit' + (others.length ? ' · ' + others.map((r) => (r.id === 'blocks' ? 'stock blocks' : 'upkeep')).join(', ') : '') : others.length ? others.map((r) => (r.id === 'blocks' ? 'stocks held for a benefit block' : 'kept for upkeep')).join(' · ') : 'no bank deposit, no benefit block',
            tone: '',
        },
        { id: 'oneoffs', label: 'Non-recurring, not counted', value: f.oneOffs.length + (f.oneOffs.length === 1 ? ' line' : ' lines'), sub: f.oneOffs.length ? signed(oneOffSum) + ' together' : 'none in these ' + Math.round(f.days) + ' days', tone: '' },
        {
            id: 'plan',
            label: 'This plan a day',
            value: perDay > 0 ? fmtMoney(Math.round(perDay)) : 'nothing',
            sub: cash ? (cash.fits ? 'fits: lasts all ' + Math.round(days) + ' days' : 'your free cash runs out on day ' + cash.runsOutDay) : perDay > 0 ? 'not checked against your cash yet' : 'costs nothing',
            tone: cash ? (cash.fits ? 'ok' : 'warn') : '',
        },
    ];
}
