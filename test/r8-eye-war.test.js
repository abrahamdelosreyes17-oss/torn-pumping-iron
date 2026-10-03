/*
 * Round 8, Torn Eye §3 (mockups/round8/torn-eye.html, the owner's pick A): war mode by itself, and the question
 * "Termed war / med-out deal?" as a card on top of the War list. The app sees your faction's war and the Torn Eye tab
 * opens on War, once per war; the answer sets the list's ticks (a real war hides hospital rows; a termed one keeps
 * them in place by band and respect, greyed), then folds to one line with Change. A new war asks again.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, cleanText } from './support/fake-dom.mjs';

installFakeDom();
const { sortWar, warKeyOf, warBegun, warAskNext, termedFilters, TERMED_WORDS, enemiesFromWars } = await import('../src/core/eye/war.js');
const { renderEye } = await import('../src/ui/app/eye-tab.js');

const NOW = Date.now();
const S = Math.floor(NOW / 1000);
const ENEMY = { id: 8124, name: 'Iron Legion', kind: 'ranked', warId: 25000, start: S - 36 * 60, end: null };

test('a war is named by its kind and Torn’s war id; it counts once it has begun', () => {
    assert.equal(warKeyOf(ENEMY), 'ranked:25000');
    assert.equal(warKeyOf({ id: 8124, kind: 'raid', warId: null }), 'raid:f8124');
    assert.equal(warKeyOf(null), null);
    assert.equal(warBegun(ENEMY, S), true);
    assert.equal(warBegun({ ...ENEMY, start: S + 3600 }, S), false, 'a ranked war is listed before it starts');
    assert.equal(warBegun({ ...ENEMY, start: null }, S), true);
    assert.equal(warBegun(null, S), false);
    // From Torn's own answer.
    const e = enemiesFromWars({ wars: { ranked: { war_id: 25000, start: S - 60, end: null, factions: [{ id: 9001 }, { id: 8124, name: 'Iron Legion' }] } } }, 9001, S)[0];
    assert.equal(warKeyOf(e), 'ranked:25000');
});

test('war mode turns itself on once per war; a new war asks again', () => {
    const first = warAskNext(null, ENEMY, NOW);
    assert.deepEqual(first, { rec: { key: 'ranked:25000', autoAt: NOW, termed: null }, fresh: true });
    const answered = { ...first.rec, termed: true };
    assert.deepEqual(warAskNext(answered, ENEMY, NOW + 60000), { rec: answered, fresh: false }, 'the same war: nothing changes, the answer stays');
    const next = warAskNext(answered, { ...ENEMY, warId: 25001 }, NOW + 9e6);
    assert.equal(next.fresh, true);
    assert.equal(next.rec.termed, null, 'a new war asks again');
    assert.deepEqual(warAskNext(answered, null, NOW), { rec: answered, fresh: false }, 'no war: what was kept stays');
    assert.equal(warAskNext(null, { ...ENEMY, start: S + 3600 }, NOW).fresh, false, 'a war that has not begun does not turn it on');
});

test('what the answer sets: a real war hides hospital rows, a termed one keeps them; both hide the away', () => {
    assert.deepEqual(termedFilters(false), { warHideHosp: true, warHideTravel: true });
    assert.deepEqual(termedFilters(true), { warHideHosp: false, warHideTravel: true });
    assert.equal(termedFilters(null), null);
    assert.deepEqual(TERMED_WORDS, { no: 'Real war · hospital rows hidden', yes: 'Termed war · hospital rows stay in the list' });
});

// The mockup's war list: band and respect from the fight model, where they are set by hand.
const WM = [
    [1, 'Red_Badger', 100, 'stomp', 3.37, 'okay'],
    [2, 'Brass_Moth', 98, 'stomp', 3.17, 'hosp', 100],
    [3, 'Red_Pike', 100, 'good', 4.35, 'okay'],
    [4, 'Iron_Monk', 94, 'good', 4.29, 'hosp', 724],
    [5, 'Feral_Otter', 93, 'good', 4.24, 'hosp', 4620],
    [6, 'Tiny_Moth30', 98, 'good', 4.07, 'travel'],
    [7, 'Dusty_Viper', 93, 'fair', 4.36, 'abroad'],
    [8, 'Feral_Tom76', 91, 'fair', 4.32, 'okay'],
    [9, 'Grim_Bishop', 100, 'low', 0, 'okay'],
];
const members = WM.map(([id, name, level, , , st, s]) => ({ id, name, level, status: st === 'okay' ? { state: 'Okay', description: 'Okay' } : st === 'hosp' ? { state: 'Hospital', description: 'In hospital', until: S + s } : st === 'travel' ? { state: 'Traveling', description: 'Traveling to Mexico' } : { state: 'Abroad', description: 'In Mexico' } }));
const bands = Object.fromEntries(WM.map(([id, , , band]) => [id, band]));
const respect = Object.fromEntries(WM.map(([id, , , , r]) => [id, r]));

test('a termed war: a hospital row keeps its place by band and respect; the hospital clock does not move it', () => {
    const names = (rows) => rows.map((r) => r.m.name);
    assert.deepEqual(names(sortWar(members, { bands, respect, nowS: S })).slice(0, 7), ['Red_Badger', 'Red_Pike', 'Feral_Tom76', 'Grim_Bishop', 'Brass_Moth', 'Iron_Monk', 'Feral_Otter'], 'as today: ready first, then out of hospital soonest');
    assert.deepEqual(names(sortWar(members, { bands, respect, nowS: S, termed: true })).slice(0, 7), ['Red_Badger', 'Brass_Moth', 'Red_Pike', 'Iron_Monk', 'Feral_Otter', 'Feral_Tom76', 'Grim_Bishop'], 'Stomp, then respect, hospital rows in place');
    assert.deepEqual(names(sortWar(members, { bands, respect, nowS: S, termed: true })).slice(7), ['Tiny_Moth30', 'Dusty_Viper'], 'the away stay at the foot');
});

function ctxFor({ termed = null, ask = true, ui = {}, hits = new Map() } = {}) {
    const calls = [];
    const view = (id) => ({ id, band: bands[id], respect: respect[id], forecast: { pWin: 0.8, keep: 0.7 } });
    return {
        calls,
        ui: { eyeMode: 'war', ...ui },
        settings: { timeFormat: 'torn' },
        paused: false,
        flags: { hasFfs: true, hasTs: false },
        rerender: () => calls.push('render'),
        go: () => {},
        eye: {
            rows: () => [],
            stored: () => null,
            load: () => {},
            loading: () => false,
            error: () => null,
            sources: () => ({ fights: 0, ffsFree: 50, gear: 0 }),
            view,
            attacks: () => [],
            hits: () => hits,
            updatedAt: () => null,
            war: {
                state: () => ({ fid: 8124, manual: ask ? null : 8124, name: 'Iron Legion', enemies: ask ? [ENEMY] : [], myFaction: 9001, members, early: new Set(), loading: false, error: null, ask: ask ? { key: 'ranked:25000', autoAt: Date.parse('2026-10-03T14:02:00Z'), termed, kind: 'ranked', start: Math.floor(Date.parse('2026-10-03T14:01:00Z') / 1000) } : null }),
                termed: (v) => calls.push(['termed', v]),
                watch() {},
                pick() {},
                auto() {},
            },
            watch: { state: () => ({ list: [], states: {}, flights: {}, offers: [] }), isWatched: () => false, toggle: () => ({ ok: true }) },
        },
    };
}
const model = { ready: true, pc: { stats: { str: 1e8, spd: 1e8, def: 1e8, dex: 1e8 } }, state: { statMods: {}, life: { maximum: 7500 } } };
const lead = (out) => out.main[0];
const drawn = (out) => lead(out).find((n) => n.tagName === 'TR' && n.attrs['data-state']).map((tr) => tr.children[1].textContent);
const ticks = (out) => Object.fromEntries(out.ctl[1].filter(Boolean).flatMap((n) => n.byAttr('data-tick')).map((b) => [b.attrs['data-tick'], { on: b.attrs['aria-pressed'] === 'true', ring: b.classList.contains('set') }]));
const hidden = (out) => cleanText(lead(out).byAttr('data-war-hidden')[0].textContent);

test('just asked: the question is the first thing in the War card; the list is as it is today', () => {
    const ctx = ctxFor();
    const out = renderEye(model, ctx);
    const t = cleanText(lead(out).textContent);
    assert.match(t, /^War · Iron LegionWar mode turned itself on at 14:02, when your faction’s ranked war began · read every 10 s while openTermed war \/ med-out deal\?You hit, they med out, you hit again\. Your answer sets this war’s filters\. Asked once per war\.YesNo/);
    assert.equal(lead(out).byAttr('data-war-ask', 'ask').length, 1);
    assert.equal(drawn(out).length, 9, 'everyone shown');
    assert.deepEqual(ticks(out), { warHideLow: { on: false, ring: false }, warHideHosp: { on: false, ring: false }, warHideTravel: { on: false, ring: false } });
    assert.equal(hidden(out), 'Not answered yet: the list is as it is today, everyone shown.');
    lead(out).byAttr('data-termed', 'yes')[0].fire('click');
    lead(out).byAttr('data-termed', 'no')[0].fire('click');
    assert.deepEqual(ctx.calls, [['termed', true], ['termed', false]]);
});

test('answered No, a real war: hospital and away rows hidden, the answer in one line with Change', () => {
    const ctx = ctxFor({ termed: false });
    const out = renderEye(model, ctx);
    assert.equal(lead(out).byAttr('data-war-ask', 'ask').length, 0, 'the card folds');
    assert.equal(cleanText(lead(out).byAttr('data-war-ask', 'no')[0].textContent), 'Real war · hospital rows hiddenChange');
    assert.deepEqual(drawn(out), ['Red_Badger', 'Red_Pike', 'Feral_Tom76', 'Grim_Bishop']);
    assert.deepEqual(ticks(out), { warHideLow: { on: false, ring: false }, warHideHosp: { on: true, ring: true }, warHideTravel: { on: true, ring: true } }, 'the ticks the answer set are on, with a soft ring');
    assert.match(hidden(out), /^Hidden by your answer: 3 in hospital \(next out in 1:40\) · 2 away\.$/);
    assert.equal(cleanText(out.ctl[1].filter(Boolean).flatMap((n) => n.byClass('eye-rule'))[0].textContent), 'ready first, then out of hospital soonest');
    // The ticks still work by hand after the answer: a tick you change stays on the next draw.
    out.ctl[1].filter(Boolean).flatMap((n) => n.byAttr('data-tick', 'warHideHosp'))[0].fire('click');
    const again = renderEye(model, ctx);
    assert.equal(ticks(again).warHideHosp.on, false);
    assert.equal(drawn(again).length, 7);
    assert.match(hidden(again), /^Hidden by your ticks: 2 away\.$/);
    lead(again).byAttr('data-termed', 'change')[0].fire('click');
    assert.deepEqual(ctx.calls, ['render', ['termed', null]], 'Change asks again');
});

test('answered Yes, a termed war: hospital rows stay in place, greyed, with when they are due back', () => {
    const hits = new Map([[4, { kind: 'hit', at: NOW - 3 * 60000, result: 'Hospitalized' }]]);
    const out = renderEye(model, ctxFor({ termed: true, hits }));
    assert.equal(cleanText(lead(out).byAttr('data-war-ask', 'yes')[0].textContent), 'Termed war · hospital rows stay in the listChange');
    assert.deepEqual(drawn(out), ['Red_Badger', 'Brass_Moth', 'Red_Pike', 'Iron_Monk', 'Feral_Otter', 'Feral_Tom76', 'Grim_Bishop']);
    assert.deepEqual(ticks(out), { warHideLow: { on: false, ring: false }, warHideHosp: { on: false, ring: true }, warHideTravel: { on: true, ring: true } });
    const rows = lead(out).find((n) => n.tagName === 'TR' && n.attrs['data-state']);
    const brass = rows[1];
    assert.equal(brass.attrs.class, 'whatif', 'a hospital row is greyed');
    assert.equal(cleanText(brass.byAttr('data-termed', 'hosp')[0].textContent), 'Hospital · 1:40 · back soon');
    assert.equal(cleanText(rows[3].byAttr('data-termed', 'hit')[0].textContent), 'You hit 3m ago · med out due', 'a player you just hit stays, and says so');
    assert.ok(rows[1].find((n) => n.tagName === 'A' && n.textContent === 'Attack').length === 1, 'a hospital row still has its Attack button');
    assert.equal(rows[0].attrs.class, undefined, 'a ready row is bright');
    assert.match(hidden(out), /^Hidden by your answer: 2 away\. Hospital rows stay: they med out\.$/);
    assert.equal(cleanText(out.ctl[1].filter(Boolean).flatMap((n) => n.byClass('eye-rule'))[0].textContent), 'Stomp, then respect · hospital keeps its place');
});

test('a faction typed in by hand is not your war: no question, the list as it was', () => {
    const out = renderEye(model, ctxFor({ ask: false }));
    const t = cleanText(lead(out).textContent);
    assert.ok(!/Termed war|turned itself on|Hidden by/.test(t));
    assert.match(t, /^War · Iron Legioneveryone, coloured by how the fight goes for you/);
    assert.equal(drawn(out).length, 9);
});
