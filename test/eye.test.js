import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { hitChance, mitigation, baseDamage, withAccuracy, forecast, statsFromBss, bssOf, respectFor, fairFight, simulateFights, DEFAULT_GEAR, MAX_TURNS, LIKELY_BUILDS } from '../src/core/eye/fight.js';
import { estimatePlayer, bssFromFairFight, fairFightInformative, rankNumber, rankBucket, totalFromBss, bssFromTotal, STAT_BUCKETS } from '../src/core/eye/estimate.js';
import { bandOf, chipFigures, BAND_WORDS, DEFAULT_BAND_LIMITS } from '../src/core/eye/bands.js';
import { parseAttackData, gearSummary, myGear } from '../src/core/eye/gear.js';
import { sortWar, warSummary, outEarly, memberState } from '../src/core/eye/war.js';
import { installAttackHook, isAttackDataUrl, HOOK_FLAG } from '../src/platform/page-hook.js';

const ME = { ...statsFromBss(LIKELY_BUILDS.balanced, bssOf({ str: 250e6, spd: 250e6, def: 250e6, dex: 250e6 })), life: 7500 };
const near = (a, b, t, m) => assert.ok(Math.abs(a - b) <= t, `${m || ''} ${a} vs ${b}`);

test('hit chance and mitigation follow the community formulas at their edges', () => {
    assert.equal(hitChance(64, 1), 1);
    near(hitChance(1, 1), 0.5, 1e-9, 'equal SPD and DEX: 50%');
    near(hitChance(1, 64), (50 / 7) * (8 * Math.sqrt(1 / 64) - 1) / 100, 1e-9);
    assert.equal(hitChance(1, 100), 0);
    near(mitigation(1, 1), 0.5, 1e-9);
    assert.equal(mitigation(14, 1), 1);
    assert.equal(mitigation(1, 40), 0);
    assert.ok(baseDamage(1e9) > baseDamage(1e6));
    near(withAccuracy(0.5, 60), 0.6, 1e-9);
    near(withAccuracy(0.9, 60), 0.936, 1e-9);
});

test('a balanced 1.0B player: stats from BSS round-trip', () => {
    near(ME.total, 1e9, 1e3);
    const s = statsFromBss(LIKELY_BUILDS.hank, 50000);
    near(bssOf(s), 50000, 1e-6);
});

test('round-2 H band ordering: Pallas stomp, Dune_Ferro good, Old_Tom tough, Vorhees can\'t win', () => {
    const t = (total, life, id) => ({ id, bss: bssFromTotal(total), life });
    const bands = [
        bandOf(forecast({ me: ME, target: { ...t(150e6, 6250, 1), stats: statsFromBss(LIKELY_BUILDS.balanced, bssFromTotal(150e6)) } })),
        bandOf(forecast({ me: ME, target: t(600e6, 7300, 71) })),
        bandOf(forecast({ me: ME, target: t(780e6, 8200, 80) })),
        bandOf(forecast({ me: ME, target: t(2600e6, 7700, 72) })),
    ];
    assert.deepEqual(bands, ['stomp', 'good', 'tough', 'cant']);
});

test('the forecast is steady for the same player (seeded) and HP kept falls as they get stronger', () => {
    const a = forecast({ me: ME, target: { id: 5, bss: bssFromTotal(500e6), life: 7000 } });
    const b = forecast({ me: ME, target: { id: 5, bss: bssFromTotal(500e6), life: 7000 } });
    assert.deepEqual(a, b);
    const weak = forecast({ me: ME, target: { id: 6, bss: bssFromTotal(200e6), life: 7000 } });
    const strong = forecast({ me: ME, target: { id: 6, bss: bssFromTotal(700e6), life: 7000 } });
    assert.ok(weak.keep > strong.keep);
    assert.equal(Object.keys(a.perBuild).length, 5);
});

test('their gear changes the answer (a better weapon and armour cost you HP)', () => {
    const plain = forecast({ me: ME, target: { id: 9, bss: bssFromTotal(600e6), life: 7300 } });
    const geared = forecast({ me: ME, target: { id: 9, bss: bssFromTotal(600e6), life: 7300 }, gearThem: { dmg: 72, acc: 55, armour: 38, dmgBonus: 23 } });
    assert.ok(geared.keep < plain.keep);
    assert.ok(geared.pWin <= plain.pWin);
});

test('a fight never runs past 25 turns', () => {
    const r = simulateFights({ str: 1, spd: 1, def: 1e9, dex: 1e9, life: 100 }, { str: 1, spd: 1, def: 1e9, dex: 1e9, life: 100 }, { n: 10 });
    assert.equal(r.pWin, 0);
    assert.equal(MAX_TURNS, 25);
});

test('respect: base by level × Torn\'s fair fight (≤ 3) × war and chain', () => {
    near(respectFor(48, 3), (1 + 48 / 200) * 3, 1e-9);
    near(respectFor(48, 5), (1 + 48 / 200) * 3, 1e-9, 'capped');
    near(respectFor(60, 2, { war: true }), (1 + 60 / 200) * 2 * 2, 1e-9);
    near(respectFor(60, 2, { chainHit: 100 }), (1 + 60 / 200) * 2 * 1.25, 1e-9);
    near(fairFight(20000, 60000), 1 + 8 / 9, 1e-9);
});

test('estimate: a fresh spy wins, an old one does not', () => {
    const now = Date.UTC(2026, 8, 29);
    const spy = { str: 1e8, spd: 1e8, def: 2e8, dex: 1e8, total: 5e8, at: now - 9 * 86400000 };
    const e = estimatePlayer({ me: ME, spy, ffs: { bsEstimate: 1e9, updatedAt: now, bssPublic: 60000 }, now });
    assert.equal(e.source, 'spy');
    assert.equal(e.confidence, 'exact');
    assert.equal(e.sourceText, 'spy 9 d');
    const old = estimatePlayer({ me: ME, spy: { ...spy, at: now - 40 * 86400000 }, ffs: { bsEstimate: 1e9, updatedAt: now - 3 * 86400000, bssPublic: 60000 }, now });
    assert.equal(old.source, 'ffscouter');
    assert.equal(old.sourceText, 'FFScouter 3 d');
});

test('estimate: your own fight inverts Torn\'s fair fight; 3.0 is only a lower bound', () => {
    const now = Date.UTC(2026, 8, 29);
    const myBss = bssOf(ME);
    const e = estimatePlayer({ me: ME, fights: [{ ended: now / 1000 - 5 * 86400, ff: 2.2 }], now });
    near(e.bss, (3 / 8) * 1.2 * myBss, 1e-6);
    assert.equal(e.sourceText, 'your fight 5 d');
    assert.equal(fairFightInformative(3), false);
    assert.equal(fairFightInformative(1.02), false);
    const lb = estimatePlayer({ me: ME, fights: [{ ended: now / 1000 - 86400, ff: 3 }], now });
    assert.equal(lb.lowerBound, true);
    near(bssFromFairFight(3, 100), 75, 1e-9);
});

test('estimate: FFScouter\'s fair fight against you, else its public BSS, else its total', () => {
    const now = Date.UTC(2026, 8, 29);
    const myBss = bssOf(ME);
    near(estimatePlayer({ me: ME, ffs: { fairFight: 2.5, bsEstimate: 1, updatedAt: now }, now }).bss, (3 / 8) * 1.5 * myBss, 1e-6);
    assert.equal(estimatePlayer({ me: ME, ffs: { bssPublic: 12345, updatedAt: now }, now }).bss, 12345);
    near(estimatePlayer({ me: ME, ffs: { bsEstimate: 4e8, updatedAt: now }, now }).bss, 40000, 1e-6);
    near(totalFromBss(40000), 4e8, 1e-3);
});

test('estimate: public stats use TornTools\' rank buckets (rough)', () => {
    assert.equal(rankNumber('Heroic Hitman'), 23);
    assert.equal(rankNumber('Highly competent Thief'), 11);
    assert.equal(rankNumber('Nobody'), null);
    // Rank 23, level 72 (7 triggers), crimes 25k (4), networth 2B (3): 23 − 7 − 4 − 3 − 1 = 8 → out of range.
    assert.equal(rankBucket({ rank: 23, level: 72, crimes: 25000, networth: 2e9 }), null);
    // Rank 20: 20 − 7 − 4 − 3 − 1 = 5 → "20M – 250M"; rank 19 → "2M – 25M".
    assert.equal(STAT_BUCKETS[rankBucket({ rank: 20, level: 72, crimes: 25000, networth: 2e9 })][0], '20M – 250M');
    assert.equal(STAT_BUCKETS[rankBucket({ rank: 19, level: 72, crimes: 25000, networth: 2e9 })][0], '2M – 25M');
    const e = estimatePlayer({ me: ME, pub: { rank: 'Supreme Hitman', level: 72, crimes: 25000, networth: 2e9 }, now: 0 });
    assert.equal(e.confidence, 'rough');
    assert.equal(e.range, '20M – 250M');
    assert.equal(estimatePlayer({ me: ME, now: 0 }), null);
});

test('bands from win and HP kept, with the user\'s limits; chip figures', () => {
    assert.equal(bandOf({ pWin: 0.995, keep: 0.8 }), 'stomp');
    assert.equal(bandOf({ pWin: 0.995, keep: 0.6 }), 'good');
    assert.equal(bandOf({ pWin: 0.95, keep: 0.3 }), 'tough');
    assert.equal(bandOf({ pWin: 0.3, keep: 0.1 }), 'cant');
    assert.equal(bandOf(null), 'none');
    assert.equal(bandOf({ pWin: 0.95, keep: 0.5 }, { ...DEFAULT_BAND_LIMITS, good: { win: 97, keep: 40 } }), 'tough');
    assert.equal(BAND_WORDS.cant, "Can't win");
    assert.equal(chipFigures({ pWin: 0.96, keep: 0.62 }, { confidence: 'good' }, 2.8), 'win 96% · keep ~62% · 2.80 respect');
    assert.equal(chipFigures({ pWin: 1, keep: 0.9 }, { confidence: 'exact' }, 2.56), 'win 100% · keep 90% · 2.56 respect');
    assert.equal(chipFigures({ pWin: 0, keep: null }, { confidence: 'rough' }, 4.08), 'win 0% · rough estimate');
});

test('gear from the attack page: the defender\'s weapons, bonuses and armour', async () => {
    const json = JSON.parse(await readFile(new URL('./fixtures/attackData.json', import.meta.url), 'utf8'));
    const d = parseAttackData(json);
    assert.equal(d.defenderId, 424242);
    assert.equal(d.maxLife, 9800);
    assert.equal(d.visible, true);
    assert.ok(d.items.some((i) => i.name === 'AK-47' && i.bonuses.some((b) => b.title === 'Powerful' && b.value === 23)));
    assert.ok(!d.items.some((i) => i.slot === '999'), 'fists and kicks are not gear');
    const g = gearSummary(d.items);
    near(g.dmg, 57.33, 1e-9);
    assert.equal(g.dmgBonus, 23);
    assert.ok(g.armour > 0 && g.armour < 60);
    assert.match(g.text, /^AK-47 · Powerful 23%/);
    assert.equal(parseAttackData(null), null);
    assert.equal(gearSummary([]), null);
});

test('your gear from /user/equipment', () => {
    const g = myGear({ equipment: [{ type: 'Weapon', sub_type: 'Primary', name: 'Minigun', stats: { damage: 71.2, accuracy: 51 }, bonuses: [{ title: 'Powerful', value: 31 }] }, { type: 'Defensive', name: 'Riot Body', stats: { armor: 41 } }] });
    near(g.dmg, 71.2, 1e-9);
    assert.equal(g.dmgBonus, 31);
    assert.deepEqual(myGear(null), DEFAULT_GEAR);
});

test('war list: out early first, then Okay by band and respect, Hospital by time out, then Traveling', () => {
    const now = 1_790_000_000;
    const m = (id, state, until = 0) => ({ id, name: 'p' + id, status: { state, until } });
    const prev = [m(1, 'Hospital', now + 600), m(2, 'Okay'), m(3, 'Okay'), m(4, 'Hospital', now + 48), m(5, 'Hospital', now + 252), m(6, 'Traveling'), m(7, 'Okay')];
    const cur = [m(1, 'Okay'), m(2, 'Okay'), m(3, 'Okay'), m(4, 'Hospital', now + 48), m(5, 'Hospital', now + 252), m(6, 'Traveling'), m(7, 'Okay')];
    const early = outEarly(prev, cur, now);
    assert.deepEqual([...early], [1]);
    const rows = sortWar(cur, { bands: { 1: 'stomp', 2: 'good', 3: 'stomp', 7: 'cant', 4: 'good', 5: 'stomp' }, respect: { 2: 8.1, 3: 7.4, 7: 9 }, early, nowS: now });
    assert.deepEqual(rows.map((r) => r.id), [1, 3, 2, 7, 4, 5, 6]);
    assert.deepEqual(warSummary(rows, now), { attackable: 4, nextOutS: 48, traveling: 1, early: 1 });
    assert.equal(memberState({ status: { description: 'In federal jail' } }), 'jail');
});

test('the attack hook hands Torn its own promise and response, untouched', async () => {
    const body = { DB: { defenderUser: { userID: 5 }, defenderItems: {} } };
    let cloned = 0;
    const response = { ok: true, status: 200, json: async () => body, clone() { cloned++; return { json: async () => JSON.parse(JSON.stringify(body)) }; } };
    const win = { location: { href: 'https://www.torn.com/loader.php?sid=attack&user2ID=5' }, fetch: () => Promise.resolve(response) };
    const originalFetch = win.fetch;
    const seen = [];
    assert.equal(installAttackHook(win, (j) => seen.push(j)), true);
    assert.equal(installAttackHook(win, () => {}), false, 'wrapped once');
    assert.notEqual(win.fetch, originalFetch);
    const p = win.fetch('page.php?sid=attackData&mode=json');
    const got = await p;
    assert.equal(got, response, 'the very same response object');
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(cloned, 1, 'we read a clone');
    assert.equal(seen[0].DB.defenderUser.userID, 5);
    const other = await win.fetch('page.php?sid=UserMiniProfile');
    assert.equal(other, response);
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(cloned, 1, 'other calls are not read');
    assert.equal(win[HOOK_FLAG], true);
});

test('a broken reader never breaks Torn\'s call', async () => {
    const response = { clone() { throw new Error('no'); } };
    const win = { location: { href: 'https://www.torn.com/' }, fetch: () => Promise.resolve(response) };
    installAttackHook(win, () => { throw new Error('ours'); });
    assert.equal(await win.fetch('page.php?sid=attackData'), response);
    assert.equal(isAttackDataUrl('https://evil.example/page.php?sid=attackData'), false);
    assert.equal(installAttackHook(null, () => {}), false);
});

/*
 * Replay: ten fights described the way FFScouter publishes its difficulty
 * scale (≤ 2 easy, ≤ 3.5 moderate, > 4.5 impossible), i.e. an outside
 * source, not our own model. Each "record" is Torn's fair fight between a
 * balanced attacker and a balanced defender and the outcome that scale
 * implies. Real attack logs replace these once the owner's history is
 * captured (HANDOFF: [calibrate]).
 */
test('replay: the sim picks the winner in at least 8 of 10 scale-described fights', () => {
    const records = [
        [1.3, true], [1.6, true], [1.9, true], [2.2, true], [2.6, true],
        [3.0, true], [3.4, true], [4.8, false], [5.5, false], [6.5, false],
    ];
    const myBss = bssOf(ME);
    let right = 0;
    records.forEach(([ff, won], i) => {
        const bss = (3 / 8) * (ff - 1) * myBss;
        const f = forecast({ me: ME, target: { id: 1000 + i, bss, life: 7500 } });
        if ((f.pWin >= 0.5) === won) right++;
    });
    assert.ok(right >= 8, right + ' of 10');
});
