/*
 * Trains from Torn's own log (owner, 2026-09-30: trains on the phone while the laptop was closed): parsed, kept,
 * read since the newest line, grouped into sessions and merged into "Last trains" (fixtures only; no live call).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { parseGymLog, mergeGymLog, gymLogFrom, logSessions, mergeSessions, GYM_LOG_KEEP, GYM_LOG_FIRST_DAYS } from '../src/core/gymlog.js';
import { sessionsOf } from '../src/core/gains.js';
import { fetchGymLog } from '../src/api/torn.js';

const T = Date.UTC(2026, 8, 30, 7, 0) / 1000;

/* The shape seen in a real capture (docs/research-gym-log.md): `_before` a string, `_after` and `_increased` numbers. */
const line = (id, at, type, data, title) => ({ id, timestamp: at, details: { id: type, title: title || { 5300: 'Gym train strength', 5301: 'Gym train defense', 5302: 'Gym train speed', 5303: 'Gym train dexterity' }[type], category: 'Gym' }, data, params: {} });
const ROWS = [
    line('c', T + 120, 5301, { trains: 5, energy_used: 50, defense_before: '288000000.00', defense_after: 288002500.5, defense_increased: 2500.5, happy_used: 25, gym: 27 }),
    line('b', T + 60, 5300, { trains: 10, energy_used: 100, strength_before: '2314.62', strength_after: 2411.39, strength_increased: 96.77, happy_used: 49, gym: 9 }),
    line('a', T, 5300, { trains: 10, energy_used: 100, strength_before: 2217.85, strength_after: 2314.62, happy_used: 50, gym: 9 }),
    line('x', T + 30, 5320, { gym: 9 }, 'Gym purchase'),
    line('y', T + 40, 5300, { trains: 0, energy_used: 0, gym: 9 }),
    { id: 'z', timestamp: T + 50, details: { title: 'Gym train speed' }, data: { trains: 2, energy_used: 20, gym: 9 } },
];

test('the log’s train lines are read: stat from the type (or the title), numbers from strings, the gain from before/after when missing', () => {
    const got = parseGymLog(ROWS);
    assert.deepEqual(got.map((x) => x.id), ['c', 'b', 'a', 'z'], 'not a purchase, not an empty train');
    const b = got.find((x) => x.id === 'b');
    assert.deepEqual(b, { id: 'b', at: (T + 60) * 1000, stat: 'str', trains: 10, energy: 100, happy: 49, gymId: 9, before: 2314.62, after: 2411.39, gain: 96.77 });
    assert.equal(got.find((x) => x.id === 'c').stat, 'def');
    assert.ok(Math.abs(got.find((x) => x.id === 'a').gain - 96.77) < 1e-9, 'gain = after − before');
    assert.equal(got.find((x) => x.id === 'z').stat, 'spd', 'no type: the title says it');
    assert.equal(got.find((x) => x.id === 'z').gain, null);
    assert.deepEqual(parseGymLog(null), []);
});

test('kept lines: deduped by id, oldest first, at most GYM_LOG_KEEP; the next read starts after the newest', () => {
    const now = (T + 600) * 1000;
    const first = mergeGymLog(null, parseGymLog(ROWS), now);
    assert.deepEqual(first.lines.map((x) => x.id), ['a', 'z', 'b', 'c']);
    assert.equal(first.newest, (T + 120) * 1000);
    const again = mergeGymLog(first, parseGymLog(ROWS.slice(0, 2)), now + 1000);
    assert.equal(again.lines.length, 4, 'the overlap at a page edge is not counted twice');
    assert.equal(gymLogFrom(again, now), T + 120);
    assert.equal(gymLogFrom(null, now), Math.floor(now / 1000) - GYM_LOG_FIRST_DAYS * 86400, 'the first read: a week back');
    const many = Array.from({ length: GYM_LOG_KEEP + 50 }, (_, i) => ({ id: 'n' + i, at: now - i * 1000, stat: 'str', trains: 1, energy: 10 }));
    const capped = mergeGymLog(null, many, now);
    assert.equal(capped.lines.length, GYM_LOG_KEEP);
    assert.equal(capped.lines.at(-1).id, 'n0', 'the newest are kept');
    const old = mergeGymLog(null, [{ id: 'old', at: now - 200 * 86400e3, stat: 'str', trains: 1, energy: 10 }], now);
    assert.equal(old.lines.length, 0, 'older than 120 days: gone');
});

test('the read walks back a page at a time only while pages come back full', async () => {
    const calls = [];
    const page = (n, newest) => Array.from({ length: n }, (_, i) => line('p' + newest + '-' + i, newest - i * 10, 5300, { trains: 1, energy_used: 10, gym: 9 }));
    const client = { get: async (path, params) => { calls.push({ path, ...params }); return { log: calls.length === 1 ? page(100, T + 5000) : page(40, T + 4010) }; } };
    const rows = await fetchGymLog(client, { from: T });
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0], { path: 'v2/user/log', log: '5300,5301,5302,5303', from: T, limit: 100 });
    assert.equal(calls[1].to, T + 5000 - 99 * 10, 'the next page ends at the oldest line of the full one');
    assert.equal(rows.length, 140);
    const one = { get: async () => ({ log: page(3, T + 100) }) };
    assert.equal((await fetchGymLog(one, { from: T })).length, 3);
});

test('"Last trains": the log’s sessions join the reads’ ones, except where a read saw the same session', () => {
    const now = (T + 7200) * 1000;
    const lines = mergeGymLog(null, parseGymLog(ROWS), now).lines;
    const logged = logSessions(lines);
    assert.equal(logged.length, 1, 'clicks a minute apart are one session');
    assert.deepEqual(logged[0].trains, { str: 20, spd: 2, def: 5 });
    assert.equal(logged[0].fromLog, true);
    assert.equal(logged[0].predicted, null);
    assert.ok(logged[0].gyms.length >= 1);
    // A read session at the same time: the read's kept (it has the prediction).
    const reads = sessionsOf([{ at: (T + 90) * 1000, stat: 'str', trains: 10, predicted: 95, actual: 96.77, gym: 'Mr. Isoyamas' }]);
    const merged = mergeSessions(reads, logged);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].fromLog, undefined);
    // A phone session hours later, no read: it shows.
    const later = logSessions(parseGymLog([line('p', T + 5 * 3600, 5302, { trains: 3, energy_used: 30, speed_increased: 12, gym: 9 })]));
    const both = mergeSessions(reads, [...later, ...logged]);
    assert.deepEqual(both.map((x) => Boolean(x.fromLog)), [true, false], 'newest first');
});

test('a long time away (more than one read’s 300 lines): the rest is read a minute at a time until nothing is missing', async () => {
    const { K, set, get } = await import('../src/platform/store.js');
    const { refreshGymLog } = await import('../src/income.js');
    // Torn's log: 450 clicks, one every 5 minutes, newest first, honouring from (after) and to (up to and including).
    const ALL = Array.from({ length: 450 }, (_, i) => line('L' + i, T + i * 300, 5300 + (i % 4), { trains: 1, energy_used: 10, gym: 9, strength_increased: 1, defense_increased: 1, speed_increased: 1, dexterity_increased: 1 }));
    let calls = 0;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        calls++;
        const u = new URL(url);
        const from = Number(u.searchParams.get('from'));
        const to = u.searchParams.get('to') ? Number(u.searchParams.get('to')) : Infinity;
        const limit = Number(u.searchParams.get('limit')) || 20;
        const log = ALL.filter((e) => e.timestamp > from && e.timestamp <= to).sort((a, b) => b.timestamp - a.timestamp).slice(0, limit);
        return { ok: true, status: 200, json: async () => ({ log }), text: async () => JSON.stringify({ log }) };
    };
    try {
        set(K.apiKey, 'MainKeyHarness12');
        set(K.fullKey, 'FullKeyHarness12');
        set(K.fullKeyState, { ok: true, at: 1 });
        set(K.gymLog, { lines: [], newest: (T - 60) * 1000, at: 0 });
        let now = (T + 450 * 300) * 1000;
        await refreshGymLog({ now });
        let kept = get(K.gymLog, null);
        assert.ok(kept.lines.length < 450 && kept.gap, 'the first read stopped at its page limit and left a gap (' + kept.lines.length + ')');
        for (let i = 0; i < 5 && kept.gap; i++) {
            now += 60e3;
            await refreshGymLog({ now });
            kept = get(K.gymLog, null);
        }
        assert.equal(kept.gap, null, 'the gap is filled');
        assert.equal(kept.lines.length, 450, 'every click is kept');
        assert.equal(new Set(kept.lines.map((x) => x.id)).size, 450);
        // Then back to every 15 minutes, from the newest.
        const before = calls;
        await refreshGymLog({ now: now + 60e3 });
        assert.equal(calls, before, 'not due for 15 minutes');
    } finally {
        globalThis.fetch = realFetch;
    }
});

test('a session whose gain Torn didn’t give (an unknown field name) shows no gain, not +0', () => {
    const s = logSessions(parseGymLog([line('q', T, 5301, { trains: 4, energy_used: 40, defence_increased: 9, gym: 9 })]));
    assert.equal(s[0].actual, null);
    const t = logSessions(parseGymLog([line('q', T, 5301, { trains: 4, energy_used: 40, defense_increased: 9, gym: 9 })]));
    assert.equal(t[0].actual, 9);
});
