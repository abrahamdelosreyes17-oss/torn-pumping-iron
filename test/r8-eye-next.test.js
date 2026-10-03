/*
 * Round 8, Torn Eye §4 (mockups/round8/torn-eye.html, the owner's pick A): the Next button, first row of the attack
 * page's fight card. It opens the attack page of the next player in your Torn Eye list, in the list's own order and
 * filters, skipping who is not ready (key N); in war mode it walks the war list. The list is what the Torn Eye tab
 * shows, handed over as a small table: Torn's pages ask nothing for it. Nobody left ready, or no list yet: a plain
 * button to the Torn Eye list. Once the fight is over the button is the one thing that glows.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installFakeDom, cleanText } from './support/fake-dom.mjs';

installFakeDom();
const { nextTable, nextTableSig, nextTarget, skippedText, NEXT_KEEP, NEXT_FRESH_MS, OWN_HIT_MS } = await import('../src/core/eye/targets.js');
const { parseAttackData, fightOver } = await import('../src/core/eye/gear.js');
const { eyeNextBox, eyeFightCard } = await import('../src/ui/eye/eye-ui.js');

const NOW = Date.parse('2026-10-03T14:38:00Z');
const S = Math.floor(NOW / 1000);
const okay = { state: 'Okay', description: 'Okay' };
// The Targets list as the tab shows it, in its order.
const TARGETS = [
    { id: 1, name: 'Iron_Monk', level: 94, band: 'good', respect: 4.29, forecast: { pWin: 0.79, keep: 0.7 }, status: okay },
    { id: 2, name: 'Feral_Otter', level: 93, band: 'good', respect: 4.24, forecast: { pWin: 0.8, keep: 0.78 }, status: { state: 'Hospital', until: S + 4620 } },
    { id: 3, name: 'Rust_Kestrel26', level: 87, band: 'good', respect: 4.234, forecast: { pWin: 0.81, keep: 0.72 }, status: okay },
    { id: 4, name: 'Tiny_Moth30', level: 98, band: 'good', respect: 4.07, forecast: { pWin: 0.89, keep: 0.82 }, status: { state: 'Traveling', description: 'Traveling to Mexico' } },
    { id: 5, name: 'Old_Crow', level: 60, band: 'fair', respect: 3.1, forecast: { pWin: 0.7, keep: 0.6 }, status: null },
    { id: 6, name: 'Just_Hit', level: 70, band: 'fair', respect: 3.0, forecast: { pWin: 0.7, keep: 0.6 }, status: okay, hit: { kind: 'hit', at: NOW - 600000, result: 'Hospitalized' } },
];

test('the list handed over: the tab’s order, each row with where they are', () => {
    const t = nextTable('targets', TARGETS, NOW);
    assert.equal(t.mode, 'targets');
    assert.equal(t.at, NOW);
    assert.deepEqual(t.rows[0], [1, 'Iron_Monk', 94, 'good', 4.29, 70, 'ok', 0]);
    assert.deepEqual(t.rows[1], [2, 'Feral_Otter', 93, 'good', 4.24, 78, 'hosp', (S + 4620) * 1000]);
    assert.deepEqual(t.rows[2].slice(4, 7), [4.23, 72, 'ok'], 'respect to two decimals, HP kept in whole percents');
    assert.equal(t.rows[3][6], 'away');
    assert.equal(t.rows[4][6], '?', 'a status not read: it may be ready');
    assert.deepEqual(t.rows[5].slice(6), ['hosp', NOW - 600000 + OWN_HIT_MS], 'your own hit: in hospital for the hour a hit counts');
    assert.equal(nextTable('targets', Array.from({ length: 90 }, (_, i) => ({ ...TARGETS[0], id: 100 + i })), NOW).rows.length, NEXT_KEEP, 'the first 40 only');
    // The same list a minute on is not written again; a status that changed is.
    assert.equal(nextTableSig(nextTable('targets', TARGETS, NOW + 60000)), nextTableSig(t));
    assert.notEqual(nextTableSig(nextTable('targets', [{ ...TARGETS[0], status: { state: 'Hospital', until: S + 60 } }, ...TARGETS.slice(1)], NOW)), nextTableSig(t));
    // The war list: its rows carry their state and out-time; the fallen are left out.
    const war = nextTable('war', [
        { id: 11, state: 'okay', until: 0, m: { name: 'Red_Badger', level: 100 }, view: { band: 'stomp', respect: 3.37, forecast: { pWin: 0.99, keep: 0.99 } } },
        { id: 12, state: 'hospital', until: S + 100, m: { name: 'Brass_Moth', level: 98 }, view: { band: 'stomp', respect: 3.17, forecast: { pWin: 1, keep: 1 } } },
        { id: 13, state: 'abroad', until: 0, m: { name: 'Dusty_Viper', level: 93 }, view: { band: 'fair' } },
        { id: 14, state: 'fallen', until: 0, m: { name: 'Gone', level: 1 }, view: null },
        { id: 15, state: 'early', until: 0, m: { name: 'Quick', level: 50 }, view: null },
    ], NOW);
    assert.equal(war.mode, 'war');
    assert.deepEqual(war.rows.map((r) => [r[0], r[6]]), [[11, 'ok'], [12, 'hosp'], [13, 'away'], [15, 'ok']]);
    assert.deepEqual(war.rows[0], [11, 'Red_Badger', 100, 'stomp', 3.37, 99, 'ok', 0]);
    assert.equal(war.rows[1][7], (S + 100) * 1000);
});

test('the next player: the first ready one after where you are, skipping who is not', () => {
    const t = nextTable('targets', TARGETS, NOW);
    // Attacking Iron_Monk: Feral_Otter is in hospital, so Rust_Kestrel26 is next.
    const n = nextTarget(t, 1, { now: NOW });
    assert.deepEqual(n.next, { id: 3, name: 'Rust_Kestrel26', level: 87, band: 'good', respect: 4.23, keep: 72 });
    assert.deepEqual(n.skipped, { hosp: 1, away: 0, jail: 0, opened: 0 });
    assert.equal(skippedText(n.skipped), 'skips 1 not ready: 1 in hospital');
    // From Rust_Kestrel26: the traveller is skipped, the one never read counts as ready.
    const m = nextTarget(t, 3, { now: NOW });
    assert.equal(m.next.name, 'Old_Crow');
    assert.equal(skippedText(m.skipped), 'skips 1 not ready: 1 away');
    // At the list's end it goes round to its top; never the player you are on.
    assert.equal(nextTarget(t, 5, { now: NOW }).next.name, 'Iron_Monk');
    assert.equal(skippedText(nextTarget(t, 5, { now: NOW }).skipped), 'skips 1 not ready: 1 in hospital', 'your own hit an hour ago counts as hospital');
    // Someone not in your list: from its top.
    assert.equal(nextTarget(t, 999, { now: NOW }).next.name, 'Iron_Monk');
    // The attack pages you opened in the last ten minutes are passed over.
    const o = nextTarget(t, 1, { now: NOW, opened: new Set([3]) });
    assert.equal(o.next.name, 'Old_Crow');
    assert.equal(skippedText(o.skipped), 'skips 3 not ready: 1 in hospital, 1 away, 1 you just opened');
    // A hospital row whose out-time has passed is ready again.
    assert.equal(nextTarget(t, 1, { now: NOW + 4621000 }).next.name, 'Feral_Otter');
    assert.equal(skippedText({}), '');
});

test('nobody left ready, and no list handed over', () => {
    const one = nextTable('targets', TARGETS.slice(0, 2), NOW);
    const none = nextTarget(one, 1, { now: NOW });
    assert.deepEqual([none.list, none.next], [true, null]);
    assert.deepEqual([nextTarget(null, 1, { now: NOW }).list, nextTarget(null, 1, { now: NOW }).next], [false, null]);
    assert.equal(nextTarget(one, 2, { now: NOW + NEXT_FRESH_MS }).list, false, 'a list six hours old is not walked');
    assert.equal(nextTarget({ at: NOW, mode: 'war', rows: [] }, 1, { now: NOW }).mode, 'war');
});

const links = { href: 'https://www.torn.com/page.php?sid=attack&user2ID=3', listHref: 'https://example.test/app.html#eye', over: false };

test('the button: "Next target N", who it is, and what it skipped', () => {
    const t = nextTable('targets', TARGETS, NOW);
    const box = eyeNextBox({ ...nextTarget(t, 1, { now: NOW }), ...links });
    assert.equal(box.getAttribute('data-pi-next'), '3');
    assert.equal(cleanText(box.textContent), 'Next target NRust_Kestrel26 [87] · Good · 4.23 · 72% HPskips 1 not ready: 1 in hospital');
    const a = box.find((n) => n.tagName === 'A')[0];
    assert.equal(a.getAttribute('href'), links.href);
    assert.equal(a.getAttribute('target'), null, 'the same tab: one press, the next attack page');
    assert.ok(!a.classList.contains('pi-glow'));
    assert.equal(box.byClass('pi-kbd')[0].textContent, 'N');
    // Nothing skipped: no third line.
    assert.equal(cleanText(eyeNextBox({ ...nextTarget(t, 2, { now: NOW }), ...links }).textContent), 'Next target NRust_Kestrel26 [87] · Good · 4.23 · 72% HP');
    // War mode: the same button walks the war list.
    const war = { at: NOW, mode: 'war', rows: [[11, 'Red_Badger', 100, 'stomp', 3.37, 99, 'ok', 0]] };
    assert.match(cleanText(eyeNextBox({ ...nextTarget(war, 1, { now: NOW }), ...links }).textContent), /^Next enemy NRed_Badger \[100\] · Stomp · 3\.37 · 99% HP$/);
    // The smallest card: the button alone.
    assert.equal(cleanText(eyeNextBox({ ...nextTarget(t, 1, { now: NOW }), ...links }, 'small').textContent), 'Next N');
});

test('nobody left ready: a plain button to the Torn Eye list; no list yet says so', () => {
    const none = eyeNextBox({ ...nextTarget(nextTable('targets', TARGETS.slice(0, 2), NOW), 1, { now: NOW }), ...links, href: null });
    assert.equal(none.getAttribute('data-pi-next'), 'none');
    assert.equal(cleanText(none.textContent), 'Open the Torn Eye listNo one else on your list is ready right now.');
    const a = none.find((n) => n.tagName === 'A')[0];
    assert.ok(a.classList.contains('pi-alt'));
    assert.equal(a.getAttribute('href'), links.listHref);
    const nolist = eyeNextBox({ ...nextTarget(null, 1, { now: NOW }), ...links, href: null });
    assert.equal(nolist.getAttribute('data-pi-next'), 'nolist');
    assert.equal(cleanText(nolist.textContent), 'Open the Torn Eye listYour Torn Eye list is not here yet: open it once.');
});

const viewOf = () => ({ id: 1, name: 'Iron_Monk', level: 94, band: 'good', respect: 4.29, forecast: { pWin: 0.79, keep: 0.7, turns: 8, exact: true }, est: { source: 'ffscouter', ageDays: 5 }, source: 'FFScouter 5 d' });

test('inside the fight card, first row; once the fight is over the button is the one thing that glows', () => {
    const next = { ...nextTarget(nextTable('targets', TARGETS, NOW), 1, { now: NOW }), ...links };
    const card = eyeFightCard(viewOf(), 'full', { next });
    const t = cleanText(card.textContent);
    assert.match(t, /^GoodIron_Monk \[94\]Next target NRust_Kestrel26 \[87\] · Good · 4\.23 · 72% HPskips 1 not ready: 1 in hospitalRespect4\.29HP kept70%Win79%/);
    assert.ok(card.classList.contains('pi-glow'));
    assert.equal(card.byClass('pi-glow').length, 1, 'the card glows, nothing in it');
    const over = eyeFightCard(viewOf(), 'full', { next: { ...next, over: true } });
    assert.ok(!over.classList.contains('pi-glow'));
    assert.deepEqual(over.byClass('pi-glow').map((n) => n.tagName), ['A'], 'the fight is over: the Next button glows, not the card');
    // Over with nobody left ready: nothing to press, the card keeps its glow.
    const done = eyeFightCard(viewOf(), 'full', { next: { ...nextTarget(nextTable('targets', TARGETS.slice(0, 1), NOW), 1, { now: NOW }), ...links, href: null, over: true } });
    assert.ok(done.classList.contains('pi-glow') && done.byClass('pi-glow').length === 1);
    // While their card is still being read the button is there already.
    assert.match(cleanText(eyeFightCard(null, 'full', { next }).textContent), /^Torn EyeNext target N/);
    // No list handed to the card (an older caller): the card as it was.
    assert.ok(!/Next/.test(cleanText(eyeFightCard(viewOf(), 'full', {}).textContent)));
});

test('the fight is over: a side at 0 life, or Torn saying so', async () => {
    const db = JSON.parse(await readFile(new URL('./fixtures/attackData.json', import.meta.url), 'utf8')).DB;
    assert.equal(fightOver(db), false, 'the harness answer: the fight has started');
    assert.equal(parseAttackData({ DB: db }).over, false);
    assert.equal(fightOver({ ...db, usersLife: { attacker: { currentLife: 5200 }, defender: { currentLife: 0 } } }), true);
    assert.equal(fightOver({ ...db, usersLife: { attacker: { currentLife: 0 }, defender: { currentLife: 800 } } }), true);
    assert.equal(fightOver({ attackStatus: 'end' }), true);
    assert.equal(fightOver({ attackStatus: 'notStarted' }), false);
    assert.equal(fightOver({ attackStatus: 'someWordWeDoNotKnow' }), false, 'unsure: not over');
    assert.equal(fightOver(null), false);
});
