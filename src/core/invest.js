/*
 * Investments that grow recurring income (round 8; the accountant, docs/
 * LEDGER-ANSWERS.txt Q5 and Q19: "suggest which investment should we do so we
 * can grow the recurring income to be able to afford a plan", weighing "the
 * potential loss of the benefit block if sold"). Pure.
 *
 * Only what pays money on a date: a stock's benefit block with a money
 * dividend, and the city bank at the rate it last paid you. Each idea says
 * what it costs now, what it pays a day, its return a year and how long it
 * takes to pay for itself. It is a list to choose from, never a step: the
 * shares can lose value, and selling them ends the benefit.
 */

import { dividendMoney } from './income-floor.js';

/** Shares that `blocks` benefit blocks hold: Torn's blocks double, so requirement × (2^blocks − 1). */
export function blockShares(requirement, blocks) {
    return requirement * (2 ** Math.max(0, blocks) - 1);
}

/**
 * @param {object} o
 * @param {object[]} [o.moneyStocks] - every stock whose benefit pays money: [{id, acronym, name, price, bonus: {frequency (days), requirement (shares), description}}]
 * @param {object[]} [o.userStocks] - /user/stocks, slim: [{id, shares, bonus: {increment}}]
 * @param {object|null} [o.bank] - your city bank investment {amount, profit, duration (days)}: the rate it last paid
 * @param {number|null} [o.freeCash] - what you could spend (cashflow.js have.free)
 * @returns {{id, kind:'block'|'bank', name, what, cost, perDay, yearlyPct, paybackDays, fits:boolean|null, short:number}[]} best return a year first
 */
export function investmentIdeas({ moneyStocks = [], userStocks = [], bank = null, freeCash = null } = {}) {
    const mine = new Map((userStocks || []).map((u) => [Number(u.id), u]));
    const out = [];
    for (const s of moneyStocks || []) {
        const price = Number(s && s.price);
        const b = s && s.bonus;
        const amount = b ? dividendMoney(b.description) : null;
        const freq = b ? Number(b.frequency) : 0;
        const req = b ? Number(b.requirement) : 0;
        if (!(price > 0) || !(amount > 0) || !(freq > 0) || !(req > 0)) continue;
        const u = mine.get(Number(s.id));
        const have = u ? Number(u.shares) || 0 : 0;
        const blocks = u && u.bonus ? Number(u.bonus.increment) || 0 : 0;
        // The next block: its own shares, less what you hold over your blocks already.
        const need = Math.max(0, blockShares(req, blocks + 1) - Math.max(have, blockShares(req, blocks)));
        const cost = need * price;
        if (!(cost > 0)) continue;
        const perDay = amount / freq;
        out.push({
            id: 'block:' + s.id,
            kind: 'block',
            name: (s.acronym || s.name || 'Stock ' + s.id) + ' benefit block' + (blocks > 0 ? ' ' + (blocks + 1) : ''),
            what: fmtShares(need) + ' shares · pays every ' + freq + ' days',
            cost,
            perDay,
            yearlyPct: (100 * perDay * 365) / cost,
            paybackDays: cost / perDay,
        });
    }
    if (bank && bank.amount > 0 && bank.profit > 0 && bank.duration > 0) {
        const perDay = bank.profit / bank.duration;
        out.push({ id: 'bank', kind: 'bank', name: 'The city bank, at the rate it last paid you', what: Math.round(bank.duration) + ' days · the money is locked until it ends', cost: bank.amount, perDay, yearlyPct: (100 * perDay * 365) / bank.amount, paybackDays: bank.amount / perDay });
    }
    const cash = Number.isFinite(freeCash) ? freeCash : null;
    return out
        .map((x) => ({ ...x, fits: cash === null ? null : x.kind === 'bank' ? cash > 0 : x.cost <= cash, short: cash === null || x.kind === 'bank' ? 0 : Math.max(0, x.cost - cash) }))
        .sort((a, b) => b.yearlyPct - a.yearlyPct);
}

const fmtShares = (n) => Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
