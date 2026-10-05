/*
 * Round 9, Torn Eye "Your loadouts against it" (mockups/round9/companion.html §2, the owner's pick B), the parts that
 * need no page and no service: Torn's API has no saved loadouts, so one is learned when it is worn with Torn's items
 * page open: its number from the page's text ("Loadout #2"), its gear from the API (/user/equipment), kept per number.
 * Here: what a loadout is, the one text read on the items page, what is kept, the rows of the card, and when your
 * gear is read. The service and the card are in r9-eye-loadout-card.test.js. Nothing calls a live service.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { myGear, loadoutOf, sameLoadout, loadoutList, withLoadout, loadoutRows, loadoutLook, loadoutAnswer, LOADOUT_ROWS, LOADOUT_SETTLE_MS, LOADOUT_CONFIRM_MS, LOADOUT_RETRY_MS } from '../src/core/eye/gear.js';
import { readLoadout } from '../src/sources/dom/eye.js';
import { fetchEquipment } from '../src/api/torn.js';

const DAY = 86400000;
const NOW = Date.parse('2026-10-05T12:00:00Z');

/* /v2/user/equipment answers: three loadouts as they would be worn. */
const piece = (type, sub, name, stats, bonuses = []) => ({ type, sub_type: sub, name, stats, bonuses });
const armour = (set, v) => ['Helmet', 'Body', 'Pants', 'Gloves', 'Boots'].map((p, i) => piece('Armor', p, set + ' ' + p, { armor: v + i * 0.2 }));
const ARMALITE = { equipment: [piece('Weapon', 'Primary', 'ArmaLite M-15A4', { damage: 68.2, accuracy: 57.4 }, [{ title: 'Powerful', value: 24 }]), piece('Weapon', 'Secondary', 'Beretta M9', { damage: 31.9, accuracy: 57 }), ...armour('Riot', 45)], clothing: [] };
const KODACHI = { equipment: [piece('Weapon', 'Primary', 'Sawed-Off Shotgun', { damage: 40, accuracy: 48 }), piece('Weapon', 'Melee', 'Kodachi', { damage: 76.5, accuracy: 63.1 }), ...armour('Dune', 52)], clothing: [] };
const MP9 = { equipment: [piece('Weapon', 'Primary', 'BT MP9', { damage: 55.3, accuracy: 54.2 }), ...armour('Riot', 45)], clothing: [] };

test('a loadout is what the fight reads of your gear, and two names for the card', () => {
    const lo = loadoutOf(ARMALITE);
    const g = myGear(ARMALITE);
    assert.deepEqual(lo.gear, { dmg: g.dmg, acc: g.acc, armour: g.armour, dmgBonus: g.dmgBonus }, 'the same four numbers "With their gear" is worked out with');
    assert.equal(lo.weapon, 'ArmaLite M-15A4');
    assert.equal(lo.armour, 'Riot');
    assert.equal(loadoutOf(KODACHI).weapon, 'Kodachi', 'the main weapon is the one the fight counts: the best damage');
    assert.equal(loadoutOf(null), null, 'never read');
    assert.equal(loadoutOf({ equipment: [], clothing: [] }), null, 'nothing worn');
    assert.ok(sameLoadout(loadoutOf(ARMALITE), JSON.parse(JSON.stringify(loadoutOf(ARMALITE)))), 'the same after it was stored and read back');
    assert.ok(!sameLoadout(loadoutOf(ARMALITE), loadoutOf(MP9)));
    assert.ok(!sameLoadout(null, null));
});

/* ------------------------------------------------------------ Torn's items page: one text is read */

/** A stand-in for Torn's document that notes everything asked of the box (the reader may only read its text). */
function boxDoc(text) {
    const asked = [];
    const root = new Proxy({}, { get: (_, k) => { asked.push(String(k)); return k === 'textContent' ? text : undefined; } });
    return { doc: { getElementById: (id) => (id === 'loadoutsRoot' && text !== null ? root : null) }, asked };
}

test('the items page: the number of the loadout worn, from the start of the box’s text and nothing else', () => {
    const a = boxDoc('Loadout #2\n  Primary ArmaLite M-15A4 Secondary Beretta M9 Melee Kodachi');
    assert.deepEqual(readLoadout(a.doc), { n: 2, sig: 'Loadout #2 Primary ArmaLite M-15A4 Secondary Beretta M9 Melee Kodachi' });
    assert.deepEqual(a.asked, ['textContent'], 'only the text is looked at: nothing clicked, no button or menu looked for');
    assert.equal(readLoadout(boxDoc('  Loadout #12Primary').doc).n, 12);
    assert.equal(readLoadout(boxDoc(null).doc), null, 'no box on the page');
    for (const other of ['', 'Loadouts', 'Primary Loadout #2', 'Loadout', 'Loadout #0', 'Loadout #123', 'Loadout #x', 'Equipped items']) assert.equal(readLoadout(boxDoc(other).doc), null, JSON.stringify(other) + ': not read');
    // The text is the mark of a change: another piece in the same loadout is another text.
    assert.notEqual(readLoadout(boxDoc('Loadout #2 Primary BT MP9').doc).sig, a.asked && readLoadout(a.doc).sig);
});

/* ------------------------------------------------------------ what is kept */

test('kept per loadout number: a newer reading replaces that number only, onto what is stored now', () => {
    let stored = withLoadout(null, 1, loadoutOf(ARMALITE), NOW - 3 * DAY);
    stored = withLoadout(stored, 2, loadoutOf(KODACHI), NOW - 2 * DAY);
    assert.deepEqual(Object.keys(stored), ['1', '2']);
    assert.deepEqual(stored[2], { n: 2, at: NOW - 2 * DAY, gear: loadoutOf(KODACHI).gear, weapon: 'Kodachi', armour: 'Dune' });
    assert.ok(JSON.stringify(stored).length < 400, 'small: ' + JSON.stringify(stored).length + ' characters for two loadouts');
    // You changed loadout 1 (another weapon): the newer reading is the one kept.
    const edited = withLoadout(stored, 1, loadoutOf(MP9), NOW);
    assert.equal(edited[1].weapon, 'BT MP9');
    assert.equal(edited[1].at, NOW);
    assert.deepEqual(edited[2], stored[2], 'the other number is untouched');
    // Two tabs: each writes onto what is stored at that moment, so neither loses the other's loadout.
    const tabA = withLoadout(stored, 3, loadoutOf(MP9), NOW);
    const tabB = withLoadout(tabA, 1, loadoutOf(ARMALITE), NOW + 1000);
    assert.deepEqual(loadoutList(tabB).map((l) => l.n), [1, 2, 3]);
    // Nothing worn under that number any more: forgotten. A number that is no loadout's: nothing changes.
    assert.deepEqual(Object.keys(withLoadout(stored, 2, null, NOW)), ['1']);
    assert.deepEqual(withLoadout(stored, 0, loadoutOf(MP9), NOW), stored);
    assert.deepEqual(withLoadout(stored, 99, loadoutOf(MP9), NOW), stored);
    assert.deepEqual(loadoutList({ 1: { n: 1 }, x: null, 2: stored[2] }).map((l) => l.n), [2], 'a record that is not a loadout is left out');
});

/* ------------------------------------------------------------ the rows */

const STORED = withLoadout(withLoadout(withLoadout(null, 1, loadoutOf(ARMALITE), NOW - 5 * DAY), 2, loadoutOf(KODACHI), NOW - 3 * DAY), 3, loadoutOf(MP9), NOW - 12 * DAY);
/** A made-up fight: the better the weapon, the better the numbers. */
const byDamage = (gear) => ({ pWin: Math.min(0.99, gear.dmg / 95), keep: gear.dmg / 110 });

test('the rows: best first, "best" on the top one, "on you" on the one you wear (its number known from what was kept)', () => {
    const lo = loadoutRows({ worn: loadoutOf(ARMALITE), stored: STORED, fight: byDamage });
    assert.deepEqual(lo.rows.map((r) => [r.n, r.weapon, r.armour, r.best, r.worn]), [
        [2, 'Kodachi', 'Dune', true, false],
        [1, 'ArmaLite M-15A4', 'Riot', false, true],
        [3, 'BT MP9', 'Riot', false, false],
    ]);
    assert.equal(lo.rows[0].seenAt, NOW - 3 * DAY, 'a remembered loadout says when it was seen');
    assert.equal(lo.rows[1].seenAt, null, 'the one on you does not');
    assert.deepEqual([lo.known, lo.more], [3, 0]);
    // The one on you is the best: it leads and carries both.
    const top = loadoutRows({ worn: loadoutOf(KODACHI), stored: STORED, fight: byDamage });
    assert.deepEqual([top.rows[0].n, top.rows[0].best, top.rows[0].worn], [2, true, true]);
    // A tie goes to the one on you: nothing to change for nothing.
    const tie = loadoutRows({ worn: loadoutOf(MP9), stored: STORED, fight: () => ({ pWin: 0.8, keep: 0.6 }) });
    assert.deepEqual([tie.rows[0].n, tie.rows[0].worn], [3, true]);
});

test('the one on you is always there, with or without a number; alone, it is the only row', () => {
    // Worn gear that no kept number holds (never worn with the items page open, or changed since).
    const lo = loadoutRows({ worn: loadoutOf(MP9), stored: withLoadout(null, 2, loadoutOf(KODACHI), NOW - DAY), fight: byDamage });
    assert.deepEqual(lo.rows.map((r) => [r.n, r.weapon, r.worn, r.best]), [[2, 'Kodachi', false, true], [null, 'BT MP9', true, false]]);
    const alone = loadoutRows({ worn: loadoutOf(ARMALITE), stored: null, fight: byDamage });
    assert.deepEqual(alone.rows.map((r) => [r.n, r.worn, r.best]), [[null, true, false]], 'one row: nothing to be the best of');
    assert.equal(alone.known, 1);
    assert.equal(loadoutRows({ worn: null, stored: null, fight: byDamage }), null, 'your gear never read and nothing kept: no rows');
    assert.deepEqual(loadoutRows({ worn: null, stored: STORED, fight: byDamage }).rows.map((r) => r.worn), [false, false, false], 'your gear never read: the kept ones, none marked as on you');
    // Two kept loadouts with the same gear: the one read last is the one on you.
    const twins = withLoadout(withLoadout(null, 1, loadoutOf(MP9), NOW - 9 * DAY), 4, loadoutOf(MP9), NOW - DAY);
    assert.deepEqual(loadoutRows({ worn: loadoutOf(MP9), stored: twins, fight: byDamage }).rows.map((r) => [r.n, r.worn]), [[4, true], [1, false]]);
});

test('a long list: the best, the one on you and two more', () => {
    let many = null;
    for (let n = 1; n <= 7; n++) many = withLoadout(many, n, { gear: { dmg: 40 + n * 5, acc: 50, armour: 30, dmgBonus: 0 }, weapon: 'W' + n, armour: 'Set' }, NOW - n * DAY);
    // You wear the weakest (loadout 1).
    const lo = loadoutRows({ worn: loadoutList(many)[0], stored: many, fight: byDamage });
    assert.equal(LOADOUT_ROWS, 4);
    assert.deepEqual(lo.rows.map((r) => r.n), [7, 6, 5, 1], 'best first; the one on you is kept though it is last');
    assert.deepEqual([lo.rows[0].best, lo.rows[3].worn, lo.known, lo.more], [true, true, 7, 3]);
});

/* ------------------------------------------------------------ when your gear is read on the items page */

test('the items page: one read once the box has stood still, none while you stand on the page', () => {
    const seen = { n: 1, sig: 'Loadout #1 Primary ArmaLite' };
    let s = loadoutLook(null, seen, 1000);
    assert.equal(s.read, false, 'just seen: wait');
    s = loadoutLook(s.run, seen, 1000 + LOADOUT_SETTLE_MS - 1);
    assert.equal(s.read, false);
    s = loadoutLook(s.run, seen, 1000 + LOADOUT_SETTLE_MS);
    assert.equal(s.read, true, 'stood still for the settle time: read');
    let a = loadoutAnswer(s.run, seen.sig, true, 4500);
    assert.equal(a.keep, true);
    assert.equal(a.run.confirmAt, 0, 'the page’s first read needs no second one');
    for (let t = 5000; t < 5000 + 10 * 60000; t += 1000) {
        s = loadoutLook(a.run, seen, t);
        assert.equal(s.read, false, 'the same text: nothing more is asked (' + t + ')');
    }
});

test('the items page: a switch seen on the page is read, and once more later; opening Torn’s menu and closing it costs nothing', () => {
    const one = { n: 1, sig: 'Loadout #1 Primary ArmaLite' };
    const two = { n: 2, sig: 'Loadout #2 Melee Kodachi' };
    let run = loadoutAnswer(loadoutLook(loadoutLook(null, one, 0).run, one, LOADOUT_SETTLE_MS).run, one.sig, true, LOADOUT_SETTLE_MS).run;
    // Torn's own menu open (the box says something else, no number we can trust), then closed again.
    run = loadoutLook(run, null, 10000).run;
    run = loadoutLook(run, one, 12000).run;
    assert.equal(loadoutLook(run, one, 12000 + LOADOUT_SETTLE_MS).read, false, 'what the box says was read already');
    // You switch to loadout 2 on Torn's menu.
    let s = loadoutLook(run, two, 20000);
    assert.equal(s.read, false);
    s = loadoutLook(s.run, two, 20000 + LOADOUT_SETTLE_MS);
    assert.equal(s.read, true);
    const a = loadoutAnswer(s.run, two.sig, true, 23500);
    assert.deepEqual([a.keep, a.run.confirmAt], [true, 23500 + LOADOUT_CONFIRM_MS], 'kept, and read once more in case the answer lagged');
    assert.equal(loadoutLook(a.run, two, 23500 + LOADOUT_CONFIRM_MS - 1).read, false);
    s = loadoutLook(a.run, two, 23500 + LOADOUT_CONFIRM_MS);
    assert.equal(s.read, true, 'the second read');
    const b = loadoutAnswer(s.run, two.sig, true, 64000);
    assert.deepEqual([b.keep, b.run.confirmAt], [true, 0]);
    assert.equal(loadoutLook(b.run, two, 64000 + 5 * 60000).read, false, 'then nothing more');
});

test('the items page: an answer for a box that moved on is not kept; a failed read waits; a text that never stands still is never read', () => {
    const one = { n: 1, sig: 'Loadout #1 A' };
    const two = { n: 2, sig: 'Loadout #2 B' };
    let s = loadoutLook(loadoutLook(null, one, 0).run, one, LOADOUT_SETTLE_MS);
    assert.equal(s.read, true);
    // While Torn answers, you switch: the answer may be either loadout's gear.
    const moved = loadoutLook(s.run, two, LOADOUT_SETTLE_MS + 500).run;
    const a = loadoutAnswer(moved, one.sig, true, LOADOUT_SETTLE_MS + 900);
    assert.equal(a.keep, false);
    assert.equal(loadoutLook(a.run, two, 2 * LOADOUT_SETTLE_MS + 500).read, true, 'the new text is read in its turn');
    // Torn did not answer: tried again a minute later, not every second.
    s = loadoutLook(loadoutLook(null, one, 0).run, one, LOADOUT_SETTLE_MS);
    const failed = loadoutAnswer(s.run, one.sig, false, 4000);
    assert.equal(failed.keep, false);
    assert.equal(loadoutLook(failed.run, one, 4000 + LOADOUT_RETRY_MS - 1).read, false);
    assert.equal(loadoutLook(failed.run, one, 4000 + LOADOUT_RETRY_MS).read, true);
    // A box whose text changes every second (a clock in it, say): no call, ever.
    let run = null;
    for (let t = 0; t < 120000; t += 1000) {
        const step = loadoutLook(run, { n: 1, sig: 'Loadout #1 ' + t }, t);
        assert.equal(step.read, false);
        run = step.run;
    }
});

test('asking for what you wear now: the plain read as before, the fresh one with the time', async () => {
    const asked = [];
    const client = { get: async (path, params) => { asked.push([path, params]); return ARMALITE; } };
    assert.deepEqual(await fetchEquipment(client), ARMALITE);
    const eq = await fetchEquipment(client, { fresh: true });
    assert.deepEqual(eq.equipment, ARMALITE.equipment);
    assert.deepEqual(asked[0], ['v2/user/equipment', {}]);
    assert.equal(asked[1][0], 'v2/user/equipment');
    assert.deepEqual(Object.keys(asked[1][1]), ['timestamp']);
    assert.ok(Math.abs(asked[1][1].timestamp - Date.now() / 1000) < 5);
});

/** The page's clock in these tests: a look a second, as eye-page.js makes them. */
