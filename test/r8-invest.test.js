/*
 * Round 8, the accountant's ask (docs/LEDGER-ANSWERS.txt Q5, Q19): investments that grow recurring income, as a
 * list on the Ledger tab: a stock's next benefit block with a money dividend, and the bank at the rate it last paid.
 * Made-up prices and holdings.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { investmentIdeas, blockShares } from '../src/core/invest.js';

const STOCKS = [
    { id: 1, acronym: 'FHG', price: 1000, bonus: { frequency: 7, requirement: 2_000_000, description: '$80,000,000' } },
    { id: 2, acronym: 'TCT', price: 500, bonus: { frequency: 31, requirement: 100_000, description: '$1,000,000' } },
    { id: 3, acronym: 'HRG', price: 300, bonus: { frequency: 31, requirement: 10_000_000, description: '1x Random Property' } },
    { id: 4, acronym: 'NOP', price: null, bonus: { frequency: 7, requirement: 10, description: '$5' } },
];

test('blocks double: the second block needs twice the first', () => {
    assert.deepEqual([0, 1, 2, 3].map((n) => blockShares(100, n)), [0, 100, 300, 700]);
});

test('the ideas: the next block of each stock that pays money, what it costs, a day, a year, how long it takes to pay for itself; best return first', () => {
    const ideas = investmentIdeas({ moneyStocks: STOCKS, userStocks: [], freeCash: 100e6 });
    assert.deepEqual(ideas.map((x) => x.id), ['block:1', 'block:2'], 'an item dividend and a stock with no price are left out');
    const fhg = ideas[0];
    assert.equal(fhg.cost, 2e9);
    assert.ok(Math.abs(fhg.perDay - 80e6 / 7) < 1e-6);
    assert.ok(Math.abs(fhg.yearlyPct - (100 * (80e6 / 7) * 365) / 2e9) < 1e-9, 'about 209% a year');
    assert.equal(Math.round(fhg.paybackDays), 175);
    assert.deepEqual([fhg.fits, fhg.short], [false, 1.9e9]);
    const tct = ideas[1];
    assert.deepEqual([tct.cost, tct.fits, tct.short], [50e6, true, 0]);
    assert.equal(tct.what, '100,000 shares · pays every 31 days');
});

test('shares you hold count: a block you have is not offered again, the next one is, less the shares over your blocks', () => {
    const ideas = investmentIdeas({ moneyStocks: STOCKS, userStocks: [{ id: 2, shares: 150_000, bonus: { increment: 1 } }], freeCash: null });
    const tct = ideas.find((x) => x.id === 'block:2');
    assert.equal(tct.name, 'TCT benefit block 2');
    // Two blocks hold 300,000 shares; 150,000 are held.
    assert.equal(tct.cost, 150_000 * 500);
    assert.equal(tct.fits, null, 'cash not read: no verdict');
});

test('the bank, at the rate it last paid you, stands in the same list', () => {
    const ideas = investmentIdeas({ moneyStocks: [STOCKS[1]], bank: { amount: 3e9, profit: 526.5e6, duration: 90 }, freeCash: 10e6 });
    const bank = ideas.find((x) => x.id === 'bank');
    assert.ok(Math.abs(bank.yearlyPct - (100 * (526.5e6 / 90) * 365) / 3e9) < 1e-9, 'about 71% a year');
    assert.equal(ideas[0].id, 'bank', '71% a year against the block’s 23.5%');
    assert.equal(bank.fits, true);
    assert.deepEqual(investmentIdeas({}), []);
});
