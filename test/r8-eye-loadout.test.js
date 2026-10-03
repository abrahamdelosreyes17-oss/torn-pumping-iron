/*
 * Round 8, Torn Eye §5 (mockups/round8/torn-eye.html, the owner's pick B): "What they were wearing" on the attack
 * page's fight card. Every piece with its own numbers (weapons, then armour head to foot), what the fight counts of
 * it, and the plain "Not seen yet · attack once to read it" before their gear was ever read. The gear is the harness
 * attack answer (test/fixtures/attackData.json); a number Torn did not give stays empty.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installFakeDom, cleanText } from './support/fake-dom.mjs';

installFakeDom();
const { parseAttackData, gearRows, gearCountedText, gearSummary } = await import('../src/core/eye/gear.js');
const { eyeGearBlock, eyeFightCard, eyeSeenText, EYE_CSS } = await import('../src/ui/eye/eye-ui.js');

const DAY = 86400000;
const NOW = Date.parse('2026-10-03T12:00:00Z');
const items = parseAttackData(JSON.parse(await readFile(new URL('./fixtures/attackData.json', import.meta.url), 'utf8'))).items;
const viewOf = (o = {}) => ({ id: 424242, name: 'Rival', level: 64, band: 'good', respect: 4.29, forecast: { pWin: 0.74, keep: 0.63, turns: 8, exact: true }, plain: { pWin: 0.79, keep: 0.7, turns: 8, exact: true }, est: { source: 'ffscouter', ageDays: 5 }, source: 'FFScouter 5 d', ...o });
const worn = (seenAt = NOW - 12 * DAY) => ({ items, seenAt, text: gearSummary(items).text });

test('every piece with its own numbers: weapons in slot order with the temporary, armour head to foot', () => {
    const r = gearRows(items);
    assert.deepEqual(r.weapons.map((w) => w.name), ['AK-47', 'Beretta M9', 'Butterfly Knife', 'Tear Gas']);
    assert.deepEqual(r.weapons[0], { name: 'AK-47', sub: 'Primary · Powerful 23%, Deadeye 41%', dmg: 57.33, acc: 49.12 });
    assert.equal(r.weapons[1].sub, 'Secondary');
    assert.equal(r.weapons[2].sub, 'Melee · Bleed 34%');
    assert.deepEqual(r.weapons[3], { name: 'Tear Gas', sub: 'Temporary', dmg: null, acc: null }, 'a temporary has no damage or accuracy to show');
    assert.deepEqual(r.armour.map((a) => a.name.replace(/^Riot /, '')), ['Helmet', 'Body', 'Pants', 'Gloves', 'Boots']);
    assert.deepEqual(r.armour[1], { name: 'Riot Body', sub: 'Impregnable 12%', armour: 41.2 });
    assert.deepEqual(gearRows(null), { weapons: [], armour: [] });
    // An armour piece whose value Torn did not give: empty, never a made-up number.
    assert.equal(gearRows([{ slot: '4', name: 'Riot Body', armour: 0, bonuses: [] }]).armour[0].armour, null);
});

test('what the fight counts of it, in words', () => {
    const g = gearSummary(items);
    assert.equal(gearCountedText(items), 'The fight counts their best weapon (57.3 damage, 49.1 accuracy, +23%) and their armour on average (' + g.armour.toFixed(1) + ').');
    assert.match(gearCountedText(items.filter((i) => Number(i.slot) <= 3)), /and a usual armour \(no armour value was seen\)\.$/);
    assert.equal(gearCountedText([]), '');
});

test('seen before: the two lists, when it was seen, and the amber line with their gear', () => {
    const el = eyeGearBlock(viewOf({ gear: worn() }), 'full', { now: NOW });
    assert.equal(el.getAttribute('data-pi-gear'), 'seen');
    const t = cleanText(el.textContent);
    assert.match(t, /^What they were wearingseen 12 d agoWeaponsDmgAccAK-47Primary · Powerful 23%, Deadeye 41%57\.349\.1Beretta M9Secondary31\.957\.4/);
    assert.match(t, /Tear GasTemporaryArmourArmourRiot Helmet/, 'the temporary row has no numbers');
    assert.match(t, /Riot BodyImpregnable 12%41\.2/);
    assert.match(t, /The fight counts their best weapon \(57\.3 damage, 49\.1 accuracy, \+23%\) and their armour on average/);
    assert.equal(el.byAttr('data-pi-gt').length, 2);
    // On the card: under the numbers and the turns, over the amber line.
    const card = cleanText(eyeFightCard(viewOf({ gear: worn(), withGear: { pWin: 0.74, keep: 0.63 } }), 'full', { gearVisible: false }).textContent);
    assert.ok(card.indexOf('What they were wearing') > card.indexOf('About 8 turns'));
    assert.ok(card.indexOf('With their gear: win 74% · HP kept ~63%') > card.indexOf('The fight counts'));
    assert.ok(!/Last seen|saved for next time/.test(card), 'the old one-line notes are gone');
});

test('not seen yet: the plain state; read during a fight it says "seen just now"', () => {
    const none = eyeGearBlock(viewOf({ gear: null }), 'full', { now: NOW });
    assert.equal(none.getAttribute('data-pi-gear'), 'none');
    assert.equal(cleanText(none.textContent), 'What they were wearingNot seen yet · attack once to read itTorn shows it when the fight starts. It is saved for next time.');
    assert.match(cleanText(eyeGearBlock(viewOf({ gear: worn(NOW - 20000) }), 'full', { now: NOW }).textContent), /^What they were wearingseen just now/);
    // Torn shows their side and nothing is on it.
    assert.equal(cleanText(eyeGearBlock(viewOf({ gear: null }), 'full', { shown: true, now: NOW }).textContent), 'What they were wearingNothing equipped in this fight.');
    assert.equal(eyeSeenText(NOW - 40 * 60000, NOW), 'seen 40 min ago');
    assert.equal(eyeSeenText(NOW - 5 * 3600000, NOW), 'seen 5 h ago');
    assert.equal(eyeSeenText(NOW - 12 * DAY, NOW), 'seen 12 d ago');
});

test('the narrower card says it in one line; the smallest card has no room for it', () => {
    const mid = cleanText(eyeGearBlock(viewOf({ gear: worn() }), 'mid', { now: NOW }).textContent);
    assert.equal(mid, 'What they were wearingseen 12 d agoAK-47 · Powerful 23%, Deadeye 41% · Riot armour');
    assert.ok(!/wearing/.test(cleanText(eyeFightCard(viewOf({ gear: worn() }), 'small', {}).textContent)));
    assert.match(EYE_CSS, /\.pi-card \.pi-gt \{ display: grid/);
});
