/*
 * A busy money log (an "Export log" of 2026-10-04: bazaar buys, shop sales
 * and trades, about 470 lines a day). The read stops after 6 pages of 100
 * lines a category, so both categories ended at exactly 600 lines and the
 * books covered 2 days, not 30. Fixed by keeping the lines between reads
 * (core/moneylog.js): the days grow with every read. Every id and amount is
 * made up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { fetchMoneyLog } from '../src/api/torn.js';
import { mergeMoneyLog, moneyLogKept, moneyLogAskFrom } from '../src/core/moneylog.js';
import { MONEY_LOG_MAX_LINES, MONEY_LOG_PAGES, MONEY_LOG_PAGES_JOIN } from '../src/income.js';

const DAY = 86400;
const NOW = 1790000000;
const FROM = NOW - 30 * DAY;
/** A category with `perDay` lines a day, evenly spread, 30 days back. */
const category = (cat, perDay, type, title, data) => Array.from({ length: perDay * 30 }, (_, i) => ({ id: cat + '-' + i, timestamp: NOW - Math.round((i * DAY) / perDay), details: { id: type, title, category: title }, data }));
const LOG = {
    17: category(17, 120, 4210, 'Item shop sell', { item: 1, quantity: 1, value_each: 1, total_value: 1, area: 'x' }),
    14: category(14, 300, 1225, 'Bazaar buy', { seller: 1, items: [{ id: 1, uid: null, qty: 1 }], cost_each: 1, cost_total: 1 }),
};
const client = { get: async (path, q) => ({ log: LOG[q.cat].filter((e) => e.timestamp >= q.from && (!q.to || e.timestamp <= q.to)).slice(0, q.limit) }) };
const CATS = [{ id: 17, title: 'Money incoming' }, { id: 14, title: 'Money outgoing' }];

test('money log read: a log of 420 lines a day is complete for 2 days only (the 600 lines a category the read stops at)', async () => {
    const log = await fetchMoneyLog(client, { from: FROM, categories: CATS });
    assert.equal(log.calls, 12, 'six pages a category');
    // Pages overlap at their edge second, so a few of the 600 are the same line twice.
    const bought = log.filter((e) => e.type === 1225).length;
    assert.ok(bought > 590 && bought <= 600, 'bazaar buys read: ' + bought);
    const days = (NOW * 1000 - log.coveredFrom) / (DAY * 1000);
    assert.ok(days > 1.9 && days < 2.1, 'the books’ days: ' + days.toFixed(2));
});

/* The fix: the lines kept are built on, so the days grow with every read (core/moneylog.js; src/income.js does this with the stored row). */
const MAX = MONEY_LOG_MAX_LINES;
/** A read at `nowS` on top of `kept`, the way refreshMoneyLog does it. */
async function readAt(nowS, kept, maxLines = MAX, log0 = LOG) {
    const since = (nowS - 30 * DAY) * 1000;
    const at = { get: async (path, q) => ({ log: log0[q.cat].filter((e) => e.timestamp >= q.from && e.timestamp <= (q.to || nowS)).slice(0, q.limit) }) };
    const log = await fetchMoneyLog(at, { from: Math.floor(moneyLogAskFrom(kept, since) / 1000), categories: CATS, pages: kept ? MONEY_LOG_PAGES_JOIN : MONEY_LOG_PAGES });
    return { v: 2, calls: log.calls, ...mergeMoneyLog(kept, log, { now: nowS * 1000, since, maxLines }) };
}

test('money log kept between reads: the days the books cover grow with every read, up to what the log holds; each line once', async () => {
    // Reads every 6 hours from 20 days before NOW (the made-up log starts 30 days before NOW).
    let row = await readAt(NOW - 20 * DAY, null);
    assert.ok(row.days > 1.9 && row.days < 2.1, 'the first read: ' + row.days.toFixed(2) + ' days');
    let most = 0;
    for (let t = NOW - 20 * DAY + DAY / 4; t <= NOW; t += DAY / 4) {
        row = await readAt(t, moneyLogKept(row, 2));
        assert.equal(row.joined, true);
        most = Math.max(most, row.calls);
    }
    assert.ok(row.days > 21.9 && row.days < 22.1, 'two days at first, then twenty more: ' + row.days.toFixed(2));
    assert.ok(most <= 4, 'a read asks only for what is new: at most ' + most + ' calls');
    assert.equal(new Set(row.lines.map((l) => l.id)).size, row.lines.length);
    const want = LOG[14].filter((e) => e.timestamp * 1000 >= row.from).length + LOG[17].filter((e) => e.timestamp * 1000 >= row.from).length;
    assert.equal(row.lines.length, want, 'every line of those days, none missing');
    const types = Object.fromEntries(row.fields.map((f) => [f.type, f]));
    assert.equal(types[1225].lines, row.lines.filter((l) => l.type === 1225).length, 'the field names are counted over every line kept');
    assert.equal(types[1225].category, 'Bazaar buy', 'with Torn’s category from the reads');
    assert.ok(!/"cost_total":\s*1\b/.test(JSON.stringify(row.fields)), 'names only');
});

test('money log kept between reads: a read that cannot reach the last one starts over from what it covers; only the newest lines are kept', async () => {
    const first = await readAt(NOW - 25 * DAY, null);
    // Twenty-five days away on this log is more pages than a read may walk back: the old lines cannot be joined.
    const late = await readAt(NOW, moneyLogKept(first, 2));
    assert.equal(late.joined, false);
    const most = (MONEY_LOG_PAGES_JOIN * 100) / 300;
    assert.ok(late.days > most - 0.4 && late.days < most + 0.1, 'what the pages of the busiest category cover: ' + late.days.toFixed(2));
    assert.ok(late.lines.every((l) => l.at >= late.from));
    // The cap: the newest lines stay, and the books start where they start.
    const cut = await readAt(NOW, null, 500);
    assert.ok(cut.lines.length <= 500 && cut.lines.length > 400);
    assert.ok(cut.lines.every((l) => l.at >= cut.from) && cut.days < 1.3);
    assert.equal(moneyLogKept({ v: 1, lines: [{}], from: 1, at: 2 }, 2), null, 'an older row shape is read again from the start');
});

/*
 * Session 12: a busier log yet (an "Export log" of 2026-10-05, a trader: both categories at exactly 600 lines, the
 * 600 outgoing ones in 0.85 days, so about 700 outgoing and 110 incoming lines a day). Two faults at that volume:
 * 15,000 lines kept were full at 18 days, and twelve pages a read were 1.7 days of it, so two days without the
 * webpage open dropped every line kept.
 */
const TRADER = {
    17: category(17, 110, 4210, 'Item shop sell', { item: 1, quantity: 1, value_each: 1, total_value: 1, area: 'x' }),
    14: category(14, 700, 1225, 'Bazaar buy', { seller: 1, items: [{ id: 1, uid: null, qty: 1 }], cost_each: 1, cost_total: 1 }),
};
/** The made-up log reaches 30 days before NOW: a run of `days` ends at NOW. */
async function traderRun(everyH, days) {
    let row = await readAt(NOW - days * DAY, null, MAX, TRADER);
    let startedOver = 0;
    let most = 0;
    for (let t = NOW - days * DAY + everyH * 3600; t <= NOW; t += everyH * 3600) {
        row = await readAt(t, moneyLogKept(row, 2), MAX, TRADER);
        if (!row.joined) startedOver++;
        most = Math.max(most, row.calls);
    }
    return { row, startedOver, most };
}

test('money log, a trader’s 810 lines a day: two or three days without the webpage open still join, no line kept is dropped', async () => {
    for (const everyH of [48, 72]) {
        const { row, startedOver, most } = await traderRun(everyH, 24);
        assert.equal(startedOver, 0, 'every ' + everyH + ' h: reads that started over');
        // The first read covers 0.86 days (600 outgoing lines); 24 days of reads are added to it.
        assert.ok(row.days > 24.7 && row.days < 25, 'every ' + everyH + ' h: ' + row.days.toFixed(2) + ' days');
        assert.ok(most <= 26, 'three days of it is 21 pages and 4: at most ' + most + ' calls a read');
        const want = TRADER[14].filter((e) => e.timestamp * 1000 >= row.from).length + TRADER[17].filter((e) => e.timestamp * 1000 >= row.from).length;
        assert.equal(row.lines.length, want, 'every line of those days, none missing');
    }
});

test('money log, a trader’s 810 lines a day: the lines kept hold the days read, past the 18 days that 15,000 lines were', async () => {
    const { row } = await traderRun(24, 29);
    assert.ok(row.lines.length > 24000 && row.lines.length <= MONEY_LOG_MAX_LINES, row.lines.length + ' lines kept');
    assert.ok(row.days > 29.7, 'the books’ days: ' + row.days.toFixed(2));
    assert.ok(30 * 810 <= MONEY_LOG_MAX_LINES, 'thirty days of it fit');
});
