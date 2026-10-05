/*
 * Round 9, Torn Eye "Your loadouts against it" (mockups/round9/companion.html §2, the owner's pick B): under their
 * gear on the fight card, one row per loadout of yours the app knows, best first, each in the same fight that gives
 * "With their gear". Here: the read on Torn's items page (the Torn client is a stand-in), what is stored and under
 * which key, the fights of the rows, and the block on the card. The pure parts are in r9-eye-loadouts.test.js.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { installFakeDom, cleanText } from './support/fake-dom.mjs';

installFakeDom();
const { pi } = await import('../src/runtime.js');
const { K, get, set, setKey } = await import('../src/platform/store.js');
const { makeFfsClient } = await import('../src/api/ffscouter.js');
const { forecast } = await import('../src/core/eye/fight.js');
const { parseAttackData, gearSummary, loadoutOf, loadoutList, withLoadout, loadoutRows, LOADOUT_SETTLE_MS, LOADOUT_CONFIRM_MS } = await import('../src/core/eye/gear.js');
const { ensureFfsStats, saveGear, eyeView, eyeLoadouts, lookLoadout, clearEye, LOADOUTS_KEY } = await import('../src/eye-service.js');
const { eyeLoadoutBlock, eyeFightCard, EYE_LOADOUTS_HOW, EYE_LOADOUTS_CHANGE, EYE_LOADOUTS_KEEP, EYE_CSS } = await import('../src/ui/eye/eye-ui.js');

const DAY = 86400000;
const NOW = Date.parse('2026-10-05T12:00:00Z');

/* /v2/user/equipment answers: three loadouts as they would be worn. */
const piece = (type, sub, name, stats, bonuses = []) => ({ type, sub_type: sub, name, stats, bonuses });
const armour = (set, v) => ['Helmet', 'Body', 'Pants', 'Gloves', 'Boots'].map((p, i) => piece('Armor', p, set + ' ' + p, { armor: v + i * 0.2 }));
const ARMALITE = { equipment: [piece('Weapon', 'Primary', 'ArmaLite M-15A4', { damage: 68.2, accuracy: 57.4 }, [{ title: 'Powerful', value: 24 }]), piece('Weapon', 'Secondary', 'Beretta M9', { damage: 31.9, accuracy: 57 }), ...armour('Riot', 45)], clothing: [] };
const KODACHI = { equipment: [piece('Weapon', 'Primary', 'Sawed-Off Shotgun', { damage: 40, accuracy: 48 }), piece('Weapon', 'Melee', 'Kodachi', { damage: 76.5, accuracy: 63.1 }), ...armour('Dune', 52)], clothing: [] };
const MP9 = { equipment: [piece('Weapon', 'Primary', 'BT MP9', { damage: 55.3, accuracy: 54.2 }), ...armour('Riot', 45)], clothing: [] };

const STORED = withLoadout(withLoadout(withLoadout(null, 1, loadoutOf(ARMALITE), NOW - 5 * DAY), 2, loadoutOf(KODACHI), NOW - 3 * DAY), 3, loadoutOf(MP9), NOW - 12 * DAY);
/** A made-up fight: the better the weapon, the better the numbers. */
const byDamage = (gear) => ({ pWin: Math.min(0.99, gear.dmg / 95), keep: gear.dmg / 110 });

/* ------------------------------------------------------------ the service: the read, what is stored, the fights */

const ME = { str: 49.3e6, spd: 13.8e6, def: 39.5e6, dex: 39.5e6 };
pi.model = { ready: true, pc: { stats: { ...ME } }, state: { statMods: {}, life: { current: 5000, maximum: 5000 } } };
const down = makeFfsClient({ getKey: () => 'FfsKeyTest123456', fetchImpl: async () => { throw new Error('down'); }, sleep: async () => {} });
const their = parseAttackData(JSON.parse(await readFile(new URL('./fixtures/attackData.json', import.meta.url), 'utf8'))).items;
/* A rival about as strong as you (the list's own estimate of their total; life as the attack page shows it). */
const RIVAL = { playerId: 8_200_001, name: 'Rival', level: 64, bsEstimate: 150e6 };
const SHOWN = { level: RIVAL.level, life: 6000 };
/** The Torn client's stand-in: answers /user/equipment with what is "worn" and notes each call. */
const torn = { worn: ARMALITE, calls: [], fail: false };
pi.client = {
    get: async (path, params) => {
        torn.calls.push([path, params]);
        if (torn.fail) throw new Error('Torn is down');
        return torn.worn;
    },
};
const box = (n, eq) => ({ n, sig: 'Loadout #' + n + ' ' + eq.equipment.map((e) => e.name).join(' ') });

let T = Date.parse('2026-10-05T12:00:00Z');
const clock = () => T;
const lookAt = (seen, t) => {
    T = t;
    return lookLoadout(seen, clock);
};

test('on the items page: your gear is read once the box stood still and kept under its number; nothing without a key', async () => {
    const t0 = T;
    // No key saved: looked at, never asked.
    assert.equal(await lookAt(box(1, ARMALITE), t0), false);
    assert.equal(await lookAt(box(1, ARMALITE), t0 + LOADOUT_SETTLE_MS), false);
    assert.equal(torn.calls.length, 0);
    setKey(K.apiKey, 'TornKeyTest12345');
    assert.equal(await lookAt(box(1, ARMALITE), t0 + LOADOUT_SETTLE_MS + 1000), true);
    assert.equal(torn.calls.length, 1, 'one call');
    assert.equal(torn.calls[0][0], 'v2/user/equipment');
    const kept = get(LOADOUTS_KEY, null);
    assert.deepEqual(kept, { 1: { n: 1, at: t0 + LOADOUT_SETTLE_MS + 1000, gear: loadoutOf(ARMALITE).gear, weapon: 'ArmaLite M-15A4', armour: 'Riot' } }, 'its number, the time it was seen, what the fight reads and two names');
    assert.deepEqual(get(K.userStatic, {}).equipment, ARMALITE, 'the same read is your gear for the fight from now on');
    assert.equal(get(K.userStatic, {}).equipmentAt, t0 + LOADOUT_SETTLE_MS + 1000);
    for (let i = 2; i < 600; i++) await lookAt(box(1, ARMALITE), t0 + LOADOUT_SETTLE_MS + i * 1000);
    assert.equal(torn.calls.length, 1, 'ten minutes on the page ask nothing more');
});

test('on the items page: you switch to loadout 2, it is kept under 2 (read twice), loadout 1 stays', async () => {
    const t0 = T + 1000;
    torn.worn = KODACHI;
    assert.equal(await lookAt(box(2, KODACHI), t0), false);
    assert.equal(await lookAt(box(2, KODACHI), t0 + LOADOUT_SETTLE_MS), true);
    assert.equal(torn.calls.length, 2);
    let kept = get(LOADOUTS_KEY, null);
    assert.deepEqual(loadoutList(kept).map((l) => [l.n, l.weapon, l.armour]), [[1, 'ArmaLite M-15A4', 'Riot'], [2, 'Kodachi', 'Dune']]);
    // The second read, later: the same gear, kept again with the newer time.
    assert.equal(await lookAt(box(2, KODACHI), t0 + LOADOUT_SETTLE_MS + LOADOUT_CONFIRM_MS - 1000), false, 'not yet');
    assert.equal(await lookAt(box(2, KODACHI), t0 + LOADOUT_SETTLE_MS + LOADOUT_CONFIRM_MS), true);
    assert.equal(torn.calls.length, 3);
    assert.equal(get(LOADOUTS_KEY, null)[2].at, t0 + LOADOUT_SETTLE_MS + LOADOUT_CONFIRM_MS);
    assert.equal(await lookAt(box(2, KODACHI), t0 + 10 * 60000), false);
    assert.equal(torn.calls.length, 3);
    // You change a piece of loadout 2 (the box's text changes, its number does not): the newer gear replaces the older.
    const edited = { equipment: [KODACHI.equipment[1], ...armour('Riot', 45)], clothing: [] };
    torn.worn = edited;
    const t1 = t0 + 11 * 60000;
    await lookAt(box(2, edited), t1);
    assert.equal(await lookAt(box(2, edited), t1 + LOADOUT_SETTLE_MS), true);
    assert.deepEqual(loadoutList(get(LOADOUTS_KEY, null)).map((l) => [l.n, l.weapon, l.armour]), [[1, 'ArmaLite M-15A4', 'Riot'], [2, 'Kodachi', 'Riot']]);
    // Torn is down for the next change: nothing kept, what was kept stays.
    torn.fail = true;
    torn.worn = MP9;
    const t2 = t0 + 20 * 60000;
    await lookAt(box(3, MP9), t2);
    assert.equal(await lookAt(box(3, MP9), t2 + LOADOUT_SETTLE_MS), false);
    kept = get(LOADOUTS_KEY, null);
    assert.deepEqual(Object.keys(kept), ['1', '2']);
    torn.fail = false;
});

test('the fight card’s rows: the one on you IS "With their gear"; another loadout is the same fight with that gear', async () => {
    await ensureFfsStats([RIVAL], down);
    // You wear loadout 1 (the ArmaLite); 2 and 3 were worn before.
    set(K.userStatic, { ...(get(K.userStatic, {}) || {}), equipment: ARMALITE, equipmentAt: NOW });
    set(LOADOUTS_KEY, STORED);
    assert.equal(eyeLoadouts(RIVAL.playerId, SHOWN), null, 'their gear not seen yet: no rows');
    await saveGear(RIVAL.playerId, their);
    const v = eyeView(RIVAL.playerId, SHOWN);
    assert.ok(v.withGear && v.withGear.pWin > 0.02 && v.withGear.pWin < 0.98, 'a fight that gear can change (win ' + v.withGear.pWin + ')');
    const lo = eyeLoadouts(RIVAL.playerId, SHOWN);
    assert.deepEqual(lo.rows.map((r) => r.n).sort(), [1, 2, 3]);
    const on = lo.rows.find((r) => r.worn);
    assert.equal(on.n, 1);
    assert.equal(on.pWin, v.withGear.pWin, 'the row of the one on you: the very win chance of "With their gear"');
    assert.equal(on.keep, v.withGear.keep, 'and its HP kept');
    // Not just handed over: the same model run with the kept gear gives the same numbers.
    const me = { ...ME, life: 5000 };
    const target = { id: RIVAL.playerId, life: v.life, bss: v.est.bss, stats: v.est.stats };
    const gThem = gearSummary(their);
    const again = forecast({ me, target, gearMe: STORED[1].gear, gearThem: gThem });
    assert.deepEqual([again.pWin, again.keep], [v.withGear.pWin, v.withGear.keep]);
    for (const r of lo.rows.filter((x) => !x.worn)) {
        const f = forecast({ me, target, gearMe: STORED[r.n].gear, gearThem: gThem });
        assert.deepEqual([r.pWin, r.keep], [f.pWin, f.keep], 'loadout ' + r.n + ': the fight model’s own numbers with that gear');
    }
    assert.ok(lo.rows[0].pWin >= lo.rows[1].pWin && lo.rows[1].pWin >= lo.rows[2].pWin, 'best first');
    assert.equal(lo.rows[0].best, true);
    assert.deepEqual(lo.rows.map((r) => [r.pWin, r.keep]), eyeLoadouts(RIVAL.playerId, SHOWN).rows.map((r) => [r.pWin, r.keep]), 'the same numbers on every draw');
    // On the card: the amber line and the row "on you" say the same two numbers.
    const card = cleanText(eyeFightCard(v, 'full', { loadouts: lo }).textContent);
    const line = card.match(/With their gear: win (\d+)% · HP kept ~(\d+)%/);
    const row = cleanText(eyeLoadoutBlock(lo, { now: NOW }).textContent).match(/1 · ArmaLite M-15A4Riot armour(\d+)% · (\d+)%(best · )?on you/);
    assert.ok(line && row, card);
    assert.deepEqual([row[1], row[2]], [line[1], line[2]]);
});

test('Clear in Settings forgets the loadouts too', async () => {
    assert.ok(get(LOADOUTS_KEY, null));
    await clearEye();
    assert.equal(get(LOADOUTS_KEY, null), null);
});

/* ------------------------------------------------------------ the card */

const viewOf = (o = {}) => ({ id: 424242, name: 'Iron_Monk', level: 94, band: 'good', respect: 4.29, forecast: { pWin: 0.74, keep: 0.63, turns: 8, exact: true }, plain: { pWin: 0.79, keep: 0.7, turns: 8, exact: true }, est: { source: 'ffscouter', ageDays: 5 }, source: 'FFScouter 5 d', ...o });
const seenGear = { items: their, seenAt: NOW - 12 * DAY, text: gearSummary(their).text };
const mockFight = (gear) => (gear.dmg > 70 ? { pWin: 0.81, keep: 0.71 } : gear.dmg > 60 ? { pWin: 0.74, keep: 0.63 } : { pWin: 0.69, keep: 0.58 });

test('the block as the owner picked it: number and weapon, armour under it, win · HP kept, best and on you', () => {
    const lo = loadoutRows({ worn: loadoutOf(ARMALITE), stored: STORED, fight: mockFight });
    const el = eyeLoadoutBlock(lo, { now: NOW });
    assert.equal(el.getAttribute('data-pi-loadouts'), '3');
    assert.equal(
        cleanText(el.textContent),
        'Your loadouts against itwin · HP kept' + '2 · KodachiDune armour · seen 3 d ago81% · 71%best' + '1 · ArmaLite M-15A4Riot armour74% · 63%on you' + '3 · BT MP9Riot armour · seen 12 d ago69% · 58%' + 'Change it on Torn’s loadout menu before you start the fight.',
    );
    assert.equal(EYE_LOADOUTS_CHANGE, 'Change it on Torn’s loadout menu before you start the fight.');
    assert.equal(el.byClass('pi-best').length, 1, 'one row is marked as the best');
    // Words only: nothing in it can be pressed (the loadout is changed on Torn's own menu, by hand).
    assert.equal(el.find((n) => ['BUTTON', 'A', 'SELECT', 'INPUT'].includes(n.tagName) || Object.keys(n.listeners || {}).length > 0).length, 0);
    assert.ok(!/\bFF\b|fair fight|—/i.test(cleanText(el.textContent)));
    assert.match(EYE_CSS, /\.pi-card \.pi-lot \{ display: grid/);
});

test('the line under the rows is true to what is known', () => {
    const alone = eyeLoadoutBlock(loadoutRows({ worn: loadoutOf(ARMALITE), stored: null, fight: mockFight }), { now: NOW });
    assert.equal(cleanText(alone.textContent), 'Your loadouts against itwin · HP kept' + 'ArmaLite M-15A4Riot armour74% · 63%on you' + EYE_LOADOUTS_HOW);
    assert.equal(EYE_LOADOUTS_HOW, 'Your other loadouts show here once you have worn them with Torn’s items page open.');
    // The one on you is the best: nothing to change.
    const top = cleanText(eyeLoadoutBlock(loadoutRows({ worn: loadoutOf(KODACHI), stored: STORED, fight: mockFight }), { now: NOW }).textContent);
    assert.match(top, /2 · KodachiDune armour81% · 71%best · on you/);
    assert.ok(top.endsWith(EYE_LOADOUTS_KEEP) && !top.includes('Change it'));
    // More than fit: said.
    let many = null;
    for (let n = 1; n <= 6; n++) many = withLoadout(many, n, { gear: { dmg: 40 + n * 5, acc: 50, armour: 30, dmgBonus: 0 }, weapon: 'W' + n, armour: '' }, NOW - n * DAY);
    const cut = cleanText(eyeLoadoutBlock(loadoutRows({ worn: loadoutList(many)[0], stored: many, fight: byDamage }), { now: NOW }).textContent);
    assert.ok(cut.endsWith(EYE_LOADOUTS_CHANGE + ' 2 more not shown.'), cut);
    assert.match(cut, /6 · W6No armour · seen 6 d ago/, 'a loadout with no armour says so');
});

test('on the card: under their gear and the amber line; without their gear seen the card is exactly as before', () => {
    const lo = loadoutRows({ worn: loadoutOf(ARMALITE), stored: STORED, fight: mockFight });
    const v = viewOf({ gear: seenGear, withGear: { pWin: 0.74, keep: 0.63 } });
    const card = cleanText(eyeFightCard(v, 'full', { loadouts: lo }).textContent);
    assert.ok(card.indexOf('Your loadouts against it') > card.indexOf('With their gear: win 74% · HP kept ~63%'));
    assert.ok(card.indexOf('With their gear') > card.indexOf('What they were wearing'));
    assert.match(card, /1 · ArmaLite M-15A4Riot armour74% · 63%on you/, 'the row on you carries the amber line’s numbers');
    // Their gear not seen: the same card with or without loadouts known.
    const unseen = viewOf({ gear: null });
    assert.equal(eyeFightCard(unseen, 'full', { loadouts: lo }).outerHTML, eyeFightCard(unseen, 'full', {}).outerHTML);
    assert.match(cleanText(eyeFightCard(unseen, 'full', { loadouts: lo }).textContent), /Not seen yet · attack once to read it/);
    // The narrower cards have no room for it; no loadouts known: no block.
    assert.ok(!/Your loadouts/.test(cleanText(eyeFightCard(v, 'mid', { loadouts: lo }).textContent)));
    assert.ok(!/Your loadouts/.test(cleanText(eyeFightCard(v, 'small', { loadouts: lo }).textContent)));
    assert.equal(eyeFightCard(v, 'full', { loadouts: null }).outerHTML, eyeFightCard(v, 'full', {}).outerHTML);
});
