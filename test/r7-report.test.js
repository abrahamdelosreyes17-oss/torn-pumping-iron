/*
 * Round 7, R7.0b: the problem log and Settings › Report a problem. What goes
 * in the zip, and what never does (a key, a player id, a name, a money log
 * amount).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { addLogEntries, logText, logAsText, LOG_MAX, LOG_KEEP_MS, LOG_BUFFER_MAX } from '../src/core/errlog.js';
import { logFieldsOf, logFieldsList, moneyFieldOf, reportFiles, reportIncludes, planSummary } from '../src/core/report.js';
import { moneyOf, fetchMoneyLog } from '../src/api/torn.js';
import { makeZip, readZip } from '../src/core/zip.js';

const T = Date.parse('2026-10-03T12:00:00Z');

test('problem log: oldest first, a week at most, the same line in a row counted, never over the cap', () => {
    const old = { at: T - LOG_KEEP_MS - 1, kind: 'error', where: 'app plan', what: 'old' };
    const a = { at: T - 5000, kind: 'error', where: 'app plan', what: 'Create plan failed' };
    const b = { at: T - 4000, kind: 'error', where: 'app plan', what: 'Create plan failed' };
    const c = { at: T - 1000, kind: 'action', where: 'app plan', what: 'Re-plan pressed' };
    const log = addLogEntries([old, c], [b, a], T);
    assert.deepEqual(log.map((e) => e.what), ['Create plan failed', 'Re-plan pressed']);
    assert.equal(log[0].times, 2);
    assert.equal(log[0].lastAt, b.at);
    const many = Array.from({ length: LOG_MAX + 50 }, (_, i) => ({ at: T - (LOG_MAX + 50 - i) * 61000, kind: 'note', where: 'x', what: 'n' + i }));
    assert.equal(addLogEntries([], many, T).length, LOG_MAX);
    assert.equal(addLogEntries([], many, T, LOG_BUFFER_MAX).length, LOG_BUFFER_MAX, 'a Torn page keeps a small buffer');
});

test('problem log: a key or a player id in a link never gets in', () => {
    assert.equal(logText('GET https://api.torn.com/v2/user?key=AbCdEfGh12345678&x=1 failed'), 'GET https://api.torn.com/v2/user?key=****&x=1 failed');
    assert.equal(logText('token AbCdEfGh12345678 refused'), 'token **** refused');
    assert.equal(logText('profiles.php?XID=2345678'), 'profiles.php?XID=N');
    assert.ok(logText('x'.repeat(500)).length <= 300);
    assert.match(logAsText([{ at: T, kind: 'error', where: 'app plan', what: 'boom', detail: 'at x', times: 3, lastAt: T + 1000 }]), /^2026-10-03 12:00:00 {2}ERROR \[app plan\] boom - at x \(x3, last 2026-10-03 12:00:01\)\n$/);
});

/** Torn's v2 log lines, as the money categories answer them (the titles are real, from the owner's log; ids and values made up). */
const RAW = [
    { id: 'a1', timestamp: 1790000000, details: { id: 6221, title: 'Company employee pay', category: 'Company' }, data: { company: 91234, pay: 2500000, working_stats: { manual: 1, intelligence: 2 } } },
    { id: 'a2', timestamp: 1790086400, details: { id: 6221, title: 'Company employee pay', category: 'Company' }, data: { company: 91234, pay: 2500000 } },
    { id: 'b1', timestamp: 1790000100, details: { id: 4430, title: 'Trade money add', category: 'Trades' }, data: { user: 2345678, trade_id: '<a href="x">77</a>', money: 2000000000 } },
    { id: 'c1', timestamp: 1790000200, details: { id: 1225, title: 'Bazaar buy', category: 'Bazaars' }, data: { seller: 1111111, items: [{ id: 206, uid: null, qty: 3 }], cost_each: 830000, cost_total: 2490000 } },
];

test('money log fields: names and counts by log type, never a value; a line under two categories counts once', () => {
    const acc = logFieldsOf(RAW);
    logFieldsOf(RAW.slice(0, 2), acc); // the same lines again under an overlapping category
    const list = logFieldsList(acc);
    const pay = list.find((r) => r.type === 6221);
    assert.equal(pay.lines, 2);
    assert.equal(pay.days, 2);
    assert.deepEqual(pay.fields.map((f) => f.name), ['company', 'pay', 'working_stats']);
    assert.equal(pay.fields.find((f) => f.name === 'working_stats').is, '{intelligence, manual}');
    assert.deepEqual(pay.amount, { '(none read)': 2 }, 'today "pay" is not read as the amount: the block shows it');
    const trade = list.find((r) => r.type === 4430);
    assert.deepEqual(trade.amount, { money: 1 });
    assert.equal(list.find((r) => r.type === 1225).fields.find((f) => f.name === 'items').is, 'list of {id, qty, uid}');
    const text = JSON.stringify(list);
    for (const secret of ['2500000', '2000000000', '2345678', '91234', '1111111', '830000']) assert.ok(!text.includes(secret), 'a value got into the field names: ' + secret);
    // The amount field named is the one moneyOf reads.
    for (const e of RAW) assert.equal(Boolean(moneyFieldOf(e.data)), moneyOf(e.data) > 0);
});

test('money log read: the field names ride along with the log', async () => {
    const client = { get: async () => ({ log: RAW }) };
    const log = await fetchMoneyLog(client, { from: 1789000000, categories: [{ id: 1, title: 'Money' }, { id: 2, title: 'Money outgoing' }] });
    assert.equal(log.length, 8, 'the log itself is unchanged (deduping it is R7.5)');
    assert.equal(log.fields.length, 3);
    assert.equal(log.fields[0].lines, 2);
});

const PLAYER = { stats: { str: 13530, spd: 13530, def: 13530, dex: 13531 }, happyMax: 4000, energyMax: 150, gymId: 12, unlocked: [1, 2, 3], build: 'baldr:str', perks: { mult: { str: 1, spd: 1, def: 1, dex: 1 }, lines: [{ source: 'property', stat: 'all', pct: 2, text: '+ 2% Gym Gains (Swimming Pool)' }], unknown: [] } };
const SAVED = { months: 3, days: 92, start: T, end: T + 92 * 864e5, from: T, createdAt: T, recalibratedAt: null, budget: null, rec: { recommended: 'edvdJump', pickBy: 'max', reasons: ['x'] }, compare: { edvdJump: { id: 'edvdJump', gained: 400611, cost: 538835000, energyTrained: 29240, perStat: { str: 1 }, daily: [1, 2, 3], used: {}, unlocked: [{ gymId: 13 }] } }, year: null, snapshot: { at: T, stats: PLAYER.stats, gymId: 12 }, history: [] };

test('report zip: the words, the log, the stats, the plan in short, the runs with their time; readable back', () => {
    const log = [{ at: T, kind: 'error', where: 'app plan', what: 'Re-plan 12 months (365 days) failed after 281.0 s, 277.2 s of it with the tab not in front' }, { at: T + 1, kind: 'action', where: 'app plan', what: 'Re-plan pressed' }];
    const files = reportFiles({ happened: 'It got stuck', expected: 'A new plan', shots: [{ name: 'my shot (1).png', data: new Uint8Array([1, 2, 3]) }], log, state: { version: '1.3.0', runs: [{ at: T, kind: 'replan', months: 12, days: 365, ms: 281000, hiddenMs: 277200, ok: false, error: 'x' }], keys: { torn: true, full: false } }, player: PLAYER, saved: SAVED, learning: [{ name: 'gym-log.json', data: '[]' }], moneyFields: logFieldsList(logFieldsOf(RAW)), statsHistory: { [T]: { str: 1, total: 4 } }, env: { userAgent: 'UA', cores: 12 }, now: T });
    const names = files.map((f) => f.name);
    for (const n of ['report.txt', 'problem-log.txt', 'problem-log.json', 'player.json', 'plan.json', 'state.json', 'stats-history.json', 'money-log-fields.json', 'learning/gym-log.json', 'screenshots/1-my_shot_1_.png']) assert.ok(names.includes(n), n + ' is in the zip');
    const txt = files[0].data;
    assert.match(txt, /WHAT HAPPENED\nIt got stuck/);
    assert.match(txt, /STR 13,530 · SPD 13,530 · DEF 13,530 · DEX 13,531 · total 54,121/);
    assert.match(txt, /last plan run: Re-plan 12 months, 281\.0 s \(277\.2 s of it with the tab not in front\) - x/);
    assert.match(txt, /1 errors and 1 other lines/);
    const plan = JSON.parse(files.find((f) => f.name === 'plan.json').data);
    assert.equal(plan.plans.edvdJump.gained, 400611);
    assert.equal(plan.plans.edvdJump.daily, undefined, 'no day-by-day lines');
    assert.deepEqual(plan.plans.edvdJump.gyms, [13]);
    const back = readZip(makeZip(files, T)).files;
    assert.equal(back['report.txt'], txt);
    assert.equal(planSummary(null), null);
    assert.equal(reportIncludes({ shots: 2, log, player: PLAYER, saved: SAVED, gymLog: 26, moneyTypes: 3 }).length, 8);
});

test('report zip: an empty report still works (nothing read yet, no plan)', () => {
    const files = reportFiles({ now: T });
    assert.match(files[0].data, /\(not filled in\)/);
    assert.match(files[0].data, /stats: not read yet/);
    assert.match(files[0].data, /plan: none saved/);
    assert.equal(files.find((f) => f.name === 'player.json').data, 'null');
});
