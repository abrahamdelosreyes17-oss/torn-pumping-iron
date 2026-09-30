/*
 * R6.4: the income that is certain (bank investment, money dividends, rent) as the floor under Auto's income
 * (docs/research-passive-income.md): perDay = certain + other (money log without the bank and dividend lines), or
 * max(certain, networth growth); Auto plans on the Limited key alone when something is certain.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { incomeFloor, dividendMoney } from '../src/core/income-floor.js';
import { autoState, incomeBreakdown, affordLine } from '../src/core/auto.js';

const T = Date.parse('2026-09-30T12:00:00Z');
const DAY = 86400e3;
const plan = { pickBy: 'auto' };
const settings = { horizonDays: 30 };

const passive = {
    cityBank: { amount: 2e9, profit: 171e6, duration: 90, until: Math.floor((T + 40 * DAY) / 1000) },
    userStocks: [{ id: 1, shares: 3e6, bonus: { available: false, increment: 2, progress: 3, frequency: 7 } }, { id: 2, shares: 100, bonus: { increment: 1, frequency: 31 } }],
    tornStocks: [{ id: 1, acronym: 'TCI', bonus: { passive: false, frequency: 7, description: '$50,000,000' } }, { id: 2, acronym: 'FHG', bonus: { frequency: 31, description: '1x Feathery Hotel Coupon' } }],
    properties: [{ status: 'rented', owner: { id: 2345678 }, property: { name: 'Private Island' }, cost_per_day: 600000, rental_period_remaining: 12 }, { status: 'rented', owner: { id: 999 }, cost_per_day: 1e6, rental_period_remaining: 5 }],
};

test('the certain income: bank profit over its term, money dividends per day, rent of your own rented properties', () => {
    const f = incomeFloor({ ...passive, meId: 2345678, now: T });
    assert.equal(Math.round(f.bank), 1.9e6);
    assert.equal(Math.round(f.dividends), Math.round((50e6 * 2) / 7), 'item dividends (a coupon) left out');
    assert.equal(f.rent, 600000, 'a property someone else owns is not yours');
    assert.equal(Math.round(f.perDay), Math.round(1.9e6 + (50e6 * 2) / 7 + 600000));
    assert.equal(f.lines[0].what, 'TCI dividend');
    assert.equal(dividendMoney('$1,234 cash'), 1234);
    assert.equal(dividendMoney('100x Points'), null);
    // An investment that has ended pays nothing more; a lease that ended neither.
    const ended = incomeFloor({ cityBank: { ...passive.cityBank, until: Math.floor((T - DAY) / 1000) }, properties: [{ ...passive.properties[0], rental_period_remaining: 0 }], now: T });
    assert.equal(ended.perDay, 0);
});

test('Auto: the floor plans without a Full key; with one, certain + other (no double count) or max with networth', () => {
    const floor = incomeFloor({ ...passive, meId: 2345678, now: T });
    const limited = autoState({ plan, settings, hasFullKey: false, income: null, floor });
    assert.equal(limited.ready, true);
    assert.equal(limited.source, 'floor');
    assert.equal(limited.perDay, floor.perDay);
    assert.equal(autoState({ plan, settings, hasFullKey: false, income: null, floor: null }).needsKey, true, 'nothing certain: still needs the Full key');
    // Networth grew less than what is certain (a 30-day window that missed the bank payout): the floor holds.
    const nwLow = autoState({ plan, settings, hasFullKey: true, income: { perDay: 1e6, days: 30 }, floor });
    assert.equal(nwLow.perDay, floor.perDay);
    const nwHigh = autoState({ plan, settings, hasFullKey: true, income: { perDay: 80e6, days: 30 }, floor });
    assert.equal(nwHigh.perDay, 80e6, 'networth growth already holds the certain part');
    // The money log: its bank maturity and dividend lines are the floor's, the rest adds on top.
    const log = incomeBreakdown([
        { at: T - 2 * DAY, title: 'Bazaar sell', money: 30e6 },
        { at: T - 3 * DAY, title: 'Bank investment matured', money: 2.171e9 },
        { at: T - 4 * DAY, title: 'Stock dividend', money: 100e6 },
    ], T, 30, floor);
    assert.equal(log.lines.length, 1, 'only the bazaar sale is "other" income');
    // With nothing certain counted, a dividend that arrived is income; a maturity line (principal + profit) never is.
    const bare = incomeBreakdown([{ at: T - 4 * DAY, title: 'Stock dividend', money: 100e6 }, { at: T - 3 * DAY, title: 'Bank investment matured', money: 2.171e9 }], T, 30);
    assert.deepEqual(bare.lines.map((l) => l.title), ['Stock dividend']);
    const withLog = autoState({ plan, settings, hasFullKey: true, income: { perDay: 80e6, days: 30 }, log, floor });
    assert.equal(Math.round(withLog.perDay), Math.round(floor.perDay + 1e6));
    assert.match(affordLine(withLog, 2e6), /certain: .*bank \$1\.9M/);
});
