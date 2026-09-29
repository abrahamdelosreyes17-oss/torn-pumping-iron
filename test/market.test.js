import test from 'node:test';
import assert from 'node:assert/strict';

import { needList, fillCheapest, priceVerdict, listingsFromItemMarket, listingsFromW3b, listingsFromPoints, whereText, linkFor, SOURCE_BAZAAR, SOURCE_ITEM_MARKET, SOURCE_POINTS, WINDOWS } from '../src/core/market.js';
import { emptyPriceHistory, recordPrice, dailyLows, average7, readPriceHistory } from '../src/core/history.js';
import { fmtInt, fmtSigned, fmtShort, fmtMoney, fmtPct } from '../src/core/format.js';
import { XANAX, POINTS, EDVD } from '../src/core/items.js';

test('need list: plan minus inventory, drugs first, points last', () => {
    const l = needList({ [POINTS]: 90, [XANAX]: 9, [EDVD]: 0 }, { [XANAX]: 1 });
    assert.deepEqual(l.map((r) => [r.id, r.need, r.have, r.buy]), [[XANAX, 9, 1, 8], [POINTS, 90, 0, 90]]);
    assert.equal(l[0].name, 'Xanax');
    assert.deepEqual(needList(null), []);
});

test('F-buy example: 8 Xanax split across two bazaars and the Item Market, cheapest first', () => {
    const listings = [
        { source: SOURCE_ITEM_MARKET, price: 829900, qty: 12 },
        { source: SOURCE_BAZAAR, sellerId: '1234567', sellerName: 'Iron_Monk', price: 826500, qty: 3 },
        { source: SOURCE_BAZAAR, sellerId: '2345678', sellerName: 'LuckyLefty', price: 828000, qty: 4 },
    ];
    const f = fillCheapest(listings, 8, XANAX);
    assert.deepEqual(f.rows.map((r) => [r.sellerName, r.qty, r.price, r.subtotal]), [['Iron_Monk', 3, 826500, 2479500], ['LuckyLefty', 4, 828000, 3312000], [null, 1, 829900, 829900]]);
    assert.equal(f.total, 6621400);
    assert.equal(f.filled, 8);
    assert.equal(f.short, 0);
    assert.equal(f.rows[0].link, 'https://www.torn.com/bazaar.php?userId=1234567#/');
    assert.equal(f.rows[2].link, 'https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=206');
});

test('points: 90 from a lot of 60 and part of a lot of 100', () => {
    const f = fillCheapest([{ source: SOURCE_POINTS, price: 45000, qty: 100 }, { source: SOURCE_POINTS, price: 44900, qty: 60 }], 90, POINTS);
    assert.deepEqual(f.rows.map((r) => [r.qty, r.price]), [[60, 44900], [30, 45000]]);
    assert.equal(f.total, 4044000);
    assert.equal(f.rows[0].link, 'https://www.torn.com/pmarket.php');
});

test('not enough listed: what is short is reported', () => {
    const f = fillCheapest([{ source: SOURCE_ITEM_MARKET, price: 1, qty: 2 }], 5, XANAX);
    assert.equal(f.filled, 2);
    assert.equal(f.short, 3);
});

test('a price tie keeps the Item Market first (no trip for the same price)', () => {
    const f = fillCheapest([{ source: SOURCE_ITEM_MARKET, price: 10, qty: 1 }, { source: SOURCE_BAZAAR, sellerId: '1', price: 10, qty: 1 }], 1, XANAX);
    assert.equal(f.rows[0].source, SOURCE_ITEM_MARKET);
});

test('bad listings are ignored', () => {
    const f = fillCheapest([null, { price: 0, qty: 5 }, { price: 5, qty: 0 }, { source: SOURCE_ITEM_MARKET, price: 5, qty: 1 }], 1, XANAX);
    assert.equal(f.rows.length, 1);
});

test('verdicts against the 7-day average: buy ≤ +1%, stock up ≤ −3%, wait > +3% with slack', () => {
    assert.equal(priceVerdict(826500, 838200).kind, 'buy');
    assert.equal(priceVerdict(826500, 838200).text, 'Buy now · 1.4% under the 7-day average');
    assert.equal(priceVerdict(810000, 838200).kind, 'bulk');
    assert.equal(priceVerdict(845000, 838200).kind, 'buy', '+0.81% is still buy now');
});

test('verdict edges', () => {
    assert.equal(priceVerdict(101, 100).kind, 'buy', '+1% exactly');
    assert.equal(priceVerdict(102, 100).kind, 'fine');
    assert.equal(priceVerdict(104, 100).kind, 'fine', 'no slack: buy anyway');
    assert.equal(priceVerdict(104, 100, { slack: true }).kind, 'wait');
    assert.equal(priceVerdict(97, 100).kind, 'bulk');
    assert.equal(priceVerdict(100, null).kind, 'unknown');
    assert.equal(priceVerdict(100, 100).text, 'Buy now · at the 7-day average');
});

test('listings from each source in one shape', () => {
    assert.deepEqual(listingsFromItemMarket({ itemmarket: { listings: [{ price: 5, amount: 2 }] } }), [{ source: SOURCE_ITEM_MARKET, price: 5, qty: 2 }]);
    assert.deepEqual(listingsFromW3b({ listings: [{ player_id: 9, player_name: 'Bo', price: 4, quantity: 3 }] }), [{ source: SOURCE_BAZAAR, sellerId: '9', sellerName: 'Bo', price: 4, qty: 3, dataAt: null }]);
    assert.deepEqual(listingsFromPoints({ pointsmarket: [{ id: 7, cost: 45000, quantity: 60 }] }), [{ source: SOURCE_POINTS, listingId: '7', price: 45000, qty: 60 }]);
    assert.deepEqual(listingsFromPoints({ pointsmarket: { 8: { cost: 1, quantity: 2 } } })[0].listingId, '8');
    assert.deepEqual(listingsFromW3b(null), []);
});

test('where each row sends you, in words and links', () => {
    assert.equal(whereText({ source: SOURCE_BAZAAR, sellerName: 'Iron_Monk' }), "Iron_Monk's bazaar");
    assert.equal(whereText({ source: SOURCE_ITEM_MARKET }), 'Item Market');
    assert.equal(whereText({ source: SOURCE_POINTS }), 'Points market');
    assert.equal(linkFor({ source: SOURCE_BAZAAR }, XANAX), 'https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=206', 'a bazaar without a seller falls back to the market');
    assert.deepEqual(WINDOWS, { today: 1, three: 3, week: 7 });
});

test('price history keeps each day\'s lowest and averages 7 days', () => {
    const d = Date.UTC(2026, 8, 29, 12);
    let h = emptyPriceHistory();
    h = recordPrice(h, XANAX, d, 840000);
    h = recordPrice(h, XANAX, d + 3600e3, 830000);
    h = recordPrice(h, XANAX, d + 7200e3, 850000);
    h = recordPrice(h, XANAX, d - 86400e3, 846000);
    assert.deepEqual(dailyLows(h, XANAX, d, 3), [null, 846000, 830000]);
    assert.deepEqual(average7(h, XANAX, d), { avg: 838000, days: 2 });
    assert.deepEqual(average7(h, EDVD, d), { avg: null, days: 0 });
    assert.equal(recordPrice(h, XANAX, d, 0), h, 'no price, no change');
});

test('history forgets days older than 30', () => {
    const d = Date.UTC(2026, 8, 29, 12);
    let h = recordPrice(emptyPriceHistory(), XANAX, d - 40 * 86400e3, 1);
    h = recordPrice(h, XANAX, d, 2);
    assert.equal(Object.keys(h.items[XANAX]).length, 1);
    assert.deepEqual(readPriceHistory({ junk: 1 }), emptyPriceHistory());
});

test('number words', () => {
    assert.equal(fmtInt(1234567), '1,234,567');
    assert.equal(fmtInt(-300), '−300');
    assert.equal(fmtSigned(1420), '+1,420');
    assert.equal(fmtShort(994142), '994k');
    assert.equal(fmtShort(1124595), '1.12M');
    assert.equal(fmtShort(119410643), '119M');
    assert.equal(fmtShort(8723), '8,723');
    assert.equal(fmtShort(2.6e9), '2.6B');
    assert.equal(fmtMoney(826500), '$826,500');
    assert.equal(fmtMoney(6621400), '$6.62M');
    assert.equal(fmtMoney(14242000), '$14.2M');
    assert.equal(fmtMoney(125990000), '$126M');
    assert.equal(fmtMoney(-2e6), '−$2M');
    assert.equal(fmtPct(13), '+13%');
    assert.equal(fmtPct(-40), '−40%');
    assert.equal(fmtPct(0), '0%');
});
