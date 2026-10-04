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
const MAX = 15000;
/** A read at `nowS` on top of `kept`, the way refreshMoneyLog does it. */
async function readAt(nowS, kept, maxLines = MAX) {
    const since = (nowS - 30 * DAY) * 1000;
    const at = { get: async (path, q) => ({ log: LOG[q.cat].filter((e) => e.timestamp >= q.from && e.timestamp <= (q.to || nowS)).slice(0, q.limit) }) };
    const log = await fetchMoneyLog(at, { from: Math.floor(moneyLogAskFrom(kept, since) / 1000), categories: CATS, pages: kept ? 12 : 6 });
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
    const first = await readAt(NOW - 10 * DAY, null);
    // Ten days away on this log is more than twelve pages a category: the old lines cannot be joined.
    const late = await readAt(NOW, moneyLogKept(first, 2));
    assert.equal(late.joined, false);
    assert.ok(late.days > 3.9 && late.days < 4.1, 'what twelve pages of the busiest category cover: ' + late.days.toFixed(2));
    assert.ok(late.lines.every((l) => l.at >= late.from));
    // The cap: the newest lines stay, and the books start where they start.
    const cut = await readAt(NOW, null, 500);
    assert.ok(cut.lines.length <= 500 && cut.lines.length > 400);
    assert.ok(cut.lines.every((l) => l.at >= cut.from) && cut.days < 1.3);
    assert.equal(moneyLogKept({ v: 1, lines: [{}], from: 1, at: 2 }, 2), null, 'an older row shape is read again from the start');
});
