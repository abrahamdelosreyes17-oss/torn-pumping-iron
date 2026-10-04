/*
 * Round 8, Torn Eye §2 (mockups/round8/torn-eye.html, the owner's pick A): sort the Targets list by a column. A click
 * on a head sorts by it, a click again flips it; the order line in the bar turns into "Sorted by HP kept, most first"
 * with a Default order button, which is the way back. The default order stays band, respect, HP kept, win, and rows
 * that tie on the sorted column keep it. "Last hit" is a new column, from your own attacks as read.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, cleanText } from './support/fake-dom.mjs';

installFakeDom();
const { SORT_KEYS, sortOf, nextSort, sortWords, sortTargets, lastHits, lastHitText, listTargets } = await import('../src/core/eye/targets.js');
const { renderEye } = await import('../src/ui/app/eye-tab.js');

const NOW = Date.parse('2026-10-03T14:38:00Z');
// The page reads the clock when it draws: held at NOW, or "1 d ago" turns into "2 d ago" the day after.
Date.now = () => NOW;
const DAY = 86400000;
const S = (ms) => Math.floor(ms / 1000);
// The mockup's ten players: level, respect, HP kept and win from the fight model; status and last hit set by hand.
const TG = [
    ['Red_Badger', 100, 'stomp', 3.37, 99, 99, 'okay', 2],
    ['Big_Wolf76', 94, 'stomp', 3.33, 99, 99, 'okay', 12],
    ['Silent_Bishop40', 74, 'stomp', 3.18, 99, 100, 'hosp', 1, 134],
    ['Cold_Hound', 41, 'stomp', 1.68, 100, 100, 'okay', null],
    ['Red_Pike', 100, 'good', 4.35, 73, 78, 'okay', 5],
    ['Iron_Monk', 94, 'good', 4.29, 70, 79, 'okay', null],
    ['Feral_Otter', 93, 'good', 4.24, 78, 80, 'hosp', null, 77],
    ['Tiny_Moth30', 98, 'good', 4.07, 82, 89, 'travel', 9],
    ['Dusty_Viper', 93, 'fair', 4.36, 69, 76, 'abroad', null],
    ['Feral_Tom76', 91, 'fair', 4.32, 68, 73, 'okay', 20],
];
const statusOf = (st, until) => (st === 'okay' ? { state: 'Okay', description: 'Okay' } : st === 'hosp' ? { state: 'Hospital', description: 'In hospital', until: S(NOW) + until * 60 } : st === 'travel' ? { state: 'Traveling', description: 'Traveling to Mexico' } : { state: 'Abroad', description: 'In Mexico' });
const rows = TG.map(([name, level, band, respect, keep, win, st, , until], i) => ({ id: i + 1, name, level, band, respect, forecast: { pWin: win / 100, keep: keep / 100 }, status: statusOf(st, until), statusAt: NOW, hit: null, stored: {} }));
const attacks = TG.flatMap(([, , , , , , , hit], i) => (hit === null ? [] : [{ def: i + 1, ended: S(NOW - hit * DAY) - 60, result: 'Attacked' }]));
const names = (list) => list.map((r) => r.name);

test('the words: a new column sorts its first way, the same column again flips it', () => {
    assert.deepEqual(Object.keys(SORT_KEYS), ['band', 'level', 'respect', 'keep', 'win', 'status', 'hit']);
    assert.equal(sortOf(null), null);
    assert.equal(sortOf({ key: 'nope', dir: 1 }), null);
    assert.deepEqual(nextSort(null, 'keep'), { key: 'keep', dir: 1 });
    assert.deepEqual(nextSort({ key: 'keep', dir: 1 }, 'keep'), { key: 'keep', dir: -1 });
    assert.deepEqual(nextSort({ key: 'keep', dir: -1 }, 'keep'), { key: 'keep', dir: 1 }, 'no third state: the way back is the Default order button');
    assert.deepEqual(nextSort({ key: 'keep', dir: -1 }, 'win'), { key: 'win', dir: 1 });
    assert.equal(sortWords({ key: 'keep', dir: 1 }), 'HP kept, most first');
    assert.equal(sortWords({ key: 'status', dir: -1 }), 'Status, away first');
    assert.equal(sortWords(null), '');
});

test('no sort is the default order: Stomp first, then respect, HP kept, win', () => {
    const def = sortTargets(rows, null, { now: NOW });
    assert.deepEqual(names(def), names(listTargets(rows, { ready: false, now: NOW }).rows));
    assert.deepEqual(names(def).slice(0, 5), ['Red_Badger', 'Big_Wolf76', 'Silent_Bishop40', 'Cold_Hound', 'Dusty_Viper'].slice(0, 4).concat('Red_Pike'));
});

test('each column sorts both ways; rows that tie keep the default order', () => {
    const hits = lastHits(attacks);
    const by = (key, dir = 1) => names(sortTargets(rows, { key, dir }, { now: NOW, hits }));
    assert.deepEqual(by('keep').slice(0, 5), ['Cold_Hound', 'Red_Badger', 'Big_Wolf76', 'Silent_Bishop40', 'Tiny_Moth30'], '100%, then the three at 99% in the default order, then 82%');
    assert.deepEqual(by('keep', -1).slice(0, 3), ['Feral_Tom76', 'Dusty_Viper', 'Iron_Monk']);
    assert.deepEqual(by('respect').slice(0, 3), ['Dusty_Viper', 'Red_Pike', 'Feral_Tom76']);
    assert.deepEqual(by('level').slice(0, 3), ['Red_Badger', 'Red_Pike', 'Tiny_Moth30'], 'the two at level 100: Stomp before Good');
    assert.deepEqual(by('win').slice(0, 2), ['Silent_Bishop40', 'Cold_Hound']);
    assert.deepEqual(by('band'), names(sortTargets(rows, null, { now: NOW })), 'by band, Stomp first, is the default order');
    assert.equal(by('band', -1)[0], 'Dusty_Viper', 'Fair first');
    // Status: ready first, then hospital by who is out soonest, then away.
    const st = by('status');
    assert.deepEqual(st.slice(0, 6), ['Red_Badger', 'Big_Wolf76', 'Cold_Hound', 'Red_Pike', 'Iron_Monk', 'Feral_Tom76']);
    assert.deepEqual(st.slice(6), ['Feral_Otter', 'Silent_Bishop40', 'Tiny_Moth30', 'Dusty_Viper'], 'out in 1h 17m before 2h 14m, then the two away');
    assert.equal(by('status', -1)[0], 'Tiny_Moth30', 'away first');
    // Last hit: newest first; the ones none of your attacks is on come last (first the other way).
    assert.deepEqual(by('hit').slice(0, 6), ['Silent_Bishop40', 'Red_Badger', 'Red_Pike', 'Tiny_Moth30', 'Big_Wolf76', 'Feral_Tom76']);
    assert.deepEqual(by('hit', -1).slice(0, 4), ['Cold_Hound', 'Iron_Monk', 'Feral_Otter', 'Dusty_Viper'], 'not hit first, in the default order (Stomp, Good, Fair)');
});

test('last hit: from your attacks as read, the newest per player; "—" when none is on them', () => {
    const hits = lastHits([{ def: 7, ended: S(NOW - 3 * DAY), result: 'Lost' }, { def: 7, ended: S(NOW - 9 * DAY), result: 'Attacked' }, { def: 0, ended: 5 }, null]);
    assert.equal(hits.size, 1);
    assert.equal(lastHitText(hits.get(7), NOW), '3 d ago');
    assert.equal(lastHitText(NOW - 3600e3, NOW), 'today');
    assert.equal(lastHitText(undefined, NOW), '—', 'never "never": only your last attacks are read');
});

function ctxFor(ui = {}) {
    const calls = { renders: 0 };
    const ctx = {
        calls,
        ui: { eyeMode: 'targets', eyeFilters: { ready: false }, ...ui },
        settings: { timeFormat: 'torn' },
        paused: false,
        flags: { hasFfs: true, hasTs: false },
        rerender: () => calls.renders++,
        go: () => {},
        eye: {
            rows: () => rows,
            statuses: { show() {}, attack() {}, active: () => true },
            stored: () => ({ at: Date.now() - 60000, params: { v: 4 }, list: rows.map((r) => ({ playerId: r.id })), plan: { done: true } }),
            load: () => {},
            loading: () => false,
            error: () => null,
            sources: () => ({ fights: attacks.length, ffsFree: 50, gear: 0 }),
            view: () => null,
            attacks: () => attacks,
            updatedAt: () => Date.now() - 60000,
            watch: { state: () => ({ list: [], states: {}, flights: {}, offers: [] }), isWatched: () => false, toggle: () => ({ ok: true }) },
        },
    };
    return ctx;
}
const model = { ready: true, pc: { stats: { str: 1e8, spd: 1e8, def: 1e8, dex: 1e8 } }, state: { statMods: {}, life: { maximum: 7500 } } };
const table = (out) => out.main[0].find((n) => n.tagName === 'TABLE')[0];
const drawn = (out) => table(out).find((n) => n.tagName === 'TR' && /click/.test(n.attrs.class || '')).map((tr) => tr.children[1].textContent);
const rule = (out) => out.ctl[0].filter(Boolean).flatMap((n) => n.byClass('eye-rule'))[0];

test('the Targets table: seven heads sort, the order line turns into the way back', () => {
    const ctx = ctxFor();
    let out = renderEye(model, ctx);
    const heads = table(out).byAttr('data-sort');
    assert.deepEqual(heads.map((b) => b.attrs['data-sort']), ['band', 'level', 'respect', 'keep', 'win', 'status', 'hit']);
    assert.deepEqual(heads.map((b) => cleanText(b.textContent)), ['Band', 'Lvl', 'Respect', 'HP kept', 'Win', 'Status', 'Last hit']);
    assert.ok(heads.every((b) => b.tagName === 'BUTTON' && !b.classList.contains('on')));
    assert.equal(cleanText(rule(out).textContent), 'Order: band › respect › HP kept › win');
    assert.equal(rule(out).byAttr('data-act', 'default-order').length, 0, 'no Default order button in the default order');
    assert.equal(drawn(out)[0], 'Red_Badger');
    // A click on HP kept.
    heads[3].fire('click');
    assert.deepEqual(ctx.ui.eyeSort, { key: 'keep', dir: 1 });
    assert.equal(ctx.ui.eyePage, 0, 'back to the first page');
    assert.equal(ctx.calls.renders, 1);
    out = renderEye(model, ctx);
    assert.equal(cleanText(rule(out).textContent), 'Sorted by HP kept, most firstDefault order');
    assert.deepEqual(drawn(out).slice(0, 2), ['Cold_Hound', 'Red_Badger']);
    const on = table(out).byAttr('data-sort', 'keep')[0];
    assert.ok(on.classList.contains('on') && !on.classList.contains('up'));
    // The same head again: flipped.
    on.fire('click');
    assert.deepEqual(ctx.ui.eyeSort, { key: 'keep', dir: -1 });
    out = renderEye(model, ctx);
    assert.equal(cleanText(rule(out).textContent), 'Sorted by HP kept, least firstDefault order');
    assert.equal(drawn(out)[0], 'Feral_Tom76');
    assert.ok(table(out).byAttr('data-sort', 'keep')[0].classList.contains('up'));
    // Default order: the way back.
    rule(out).byAttr('data-act', 'default-order')[0].fire('click');
    assert.equal(ctx.ui.eyeSort, null);
    out = renderEye(model, ctx);
    assert.equal(cleanText(rule(out).textContent), 'Order: band › respect › HP kept › win');
    assert.equal(drawn(out)[0], 'Red_Badger');
});

test('the Last hit column: when you last attacked them', () => {
    const out = renderEye(model, ctxFor());
    const cells = table(out).byAttr('data-col', 'hit').map((td) => td.textContent);
    assert.deepEqual(cells.slice(0, 4), ['2 d ago', '12 d ago', '1 d ago', '—']);
});

test('a sort covers the whole list, not the page on screen', () => {
    // 45 listed rows: the one with the least HP kept is on the last page in the default order, first when sorted.
    const many = Array.from({ length: 45 }, (_, i) => ({ id: 100 + i, name: 'P' + i, level: 50, band: i === 44 ? 'fair' : 'good', respect: 3, forecast: { pWin: 0.9, keep: i === 44 ? 0.5 : 0.8 }, status: { state: 'Okay' }, stored: {} }));
    const ctx = ctxFor({ eyeSort: { key: 'keep', dir: -1 } });
    ctx.eye.rows = () => many;
    assert.equal(drawn(renderEye(model, ctx))[0], 'P44');
});
