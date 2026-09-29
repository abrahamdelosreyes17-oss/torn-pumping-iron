import test from 'node:test';
import assert from 'node:assert/strict';

import { makeZip, readZip, crc32 } from '../src/core/zip.js';
import { joinFights, addPrediction, exportFiles, importFiles, runLearning, learnedModel, hashId, round4sig, WIN_RESULTS } from '../src/core/learndata.js';
import { checkDevKey, sha256Hex, DEV_KEY_SHA256 } from '../src/ui/app/developer.js';
import { gainPerTrain, useDampingMode, currentDampingMode, POST_50M_MODE } from '../src/core/gain.js';
import { playerContext } from '../src/core/model.js';
import { normalizeState } from '../src/core/bars.js';

test('zip: what we write, we read back; CRC-32 matches the standard', () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
    const files = [{ name: 'meta.json', data: '{"a":1}' }, { name: 'gym-samples.json', data: JSON.stringify([{ stat: 'spd', actual: 5 }]) }];
    const z = makeZip(files, Date.UTC(2026, 8, 29, 12, 0));
    assert.equal(z[0], 0x50);
    assert.equal(z[1], 0x4b);
    const back = readZip(z);
    assert.deepEqual(back.files, { 'meta.json': '{"a":1}', 'gym-samples.json': '[{"stat":"spd","actual":5}]' });
    assert.throws(() => readZip(new Uint8Array(10)), /Not a zip/);
});

test('learning data: fights joined to what Torn Eye said before them; one prediction per player per 30 min', () => {
    const t0 = Date.UTC(2026, 8, 29, 12, 0);
    let p = addPrediction([], { def: 5, at: t0, pWin: 0.9, keep: 0.6 });
    p = addPrediction(p, { def: 5, at: t0 + 10 * 60000, pWin: 0.8, keep: 0.5 });
    assert.equal(p.length, 1, 'within 30 min: kept once');
    p = addPrediction(p, { def: 7, at: t0, pWin: 0.4, keep: 0 });
    const attacks = [
        { def: 5, ended: (t0 + 5 * 60000) / 1000, result: 'Hospitalized', respect: 3.1 },
        { def: 7, ended: (t0 + 3 * 3600e3) / 1000, result: 'Lost', respect: 0 },
        { def: 9, ended: t0 / 1000, result: 'Attacked', respect: 2 },
    ];
    const log = joinFights([], attacks, p);
    assert.equal(log.length, 1, 'only fights with a prediction shortly before');
    assert.equal(log[0].won, true);
    assert.equal(log[0].predictedWin, 0.9);
    assert.match(log[0].who, /^p[0-9a-z]+$/);
    assert.equal(joinFights(log, attacks, p).length, 1, 'no duplicates');
    assert.ok(WIN_RESULTS.has('mugged') && !WIN_RESULTS.has('lost'));
});

test('learning data: the export leaves ids out, rounds stats, and reads back', () => {
    const samples = [{ at: 1, stat: 'spd', trains: 20, predicted: 1000.4, actual: 1040.6, S: 4061234, H: 5000, dots: 7.3, E: 10, perks: 1, gym: "George's" }];
    const fights = [{ key: '12345:99', at: 2, who: hashId(12345), predictedWin: 0.9, won: true, predictedHpKept: 0.6, hpKept: null }];
    const files = exportFiles({ samples, fights, version: '1.1.0', now: Date.UTC(2026, 8, 29) });
    assert.deepEqual(files.map((f) => f.name), ['gym-samples.json', 'fights.json', 'model.json', 'meta.json']);
    const all = files.map((f) => f.data).join('\n');
    assert.ok(!all.includes('12345'), 'no player id');
    assert.equal(JSON.parse(files[0].data)[0].S, 4061000, '4 significant digits');
    assert.equal(round4sig(82440191), 82440000);
    const back = importFiles(readZip(makeZip(files)).files);
    assert.equal(back.samples.length, 1);
    assert.equal(back.fights[0].who, hashId(12345));
    assert.equal(back.meta.ids, 'left out');
    assert.throws(() => importFiles({ 'x.json': '[]' }), /no learning data/);
});

test('learning: a kept model changes the engine (per-stat multiplier, damping mode); nothing kept changes nothing', () => {
    assert.deepEqual(learnedModel(null), { mult: { str: 1, spd: 1, def: 1, dex: 1 }, mode: null, fight: null });
    const fake = { gym: { accepted: true, model: { mult: { str: 1, spd: 1.04, def: 1, dex: 1 }, mode: 'power' }, current: { mult: { str: 1, spd: 1, def: 1, dex: 1 }, mode: 'log10' } }, fights: { accepted: false, model: { winScale: 1, hpScale: 1 } } };
    const l = learnedModel(fake);
    assert.equal(l.mult.spd, 1.04);
    assert.equal(l.mode, 'power');
    assert.equal(l.fight, null);
    const state = normalizeState({ bars: { energy: { current: 20, maximum: 150, increment: 5, interval: 600, tick_time: 120 }, happy: { current: 5025, maximum: 5025, increment: 5, interval: 900, tick_time: 300 } }, cooldowns: {}, refills: {}, battlestats: { strength: { value: 1e5 }, speed: { value: 1e5 }, defense: { value: 1e5 }, dexterity: { value: 1e5 } }, gym: { id: 18 } }, 0);
    assert.equal(playerContext(state, {}, { learnedMult: l.mult }).perks.mult.spd, 1.04);
    assert.equal(playerContext(state, {}).perks.mult.spd, 1);
    const at500 = gainPerTrain('def', 5e8, 5000, 8, 10);
    useDampingMode('power');
    assert.equal(currentDampingMode(), 'power');
    assert.notEqual(gainPerTrain('def', 5e8, 5000, 8, 10), at500, 'the learned formula is used');
    useDampingMode(null);
    assert.equal(currentDampingMode(), POST_50M_MODE);
    assert.equal(gainPerTrain('def', 5e8, 5000, 8, 10), at500);
});

test('learning: runLearning keeps nothing from too few sessions', () => {
    const r = runLearning({ samples: [{ stat: 'spd', trains: 10, predicted: 100, actual: 104 }], fights: [], now: 5 });
    assert.equal(r.gym.accepted, false);
    assert.equal(r.fights.accepted, false);
});

test('developer key: only its SHA-256 is in the script; a wrong key is refused', async () => {
    assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    assert.match(DEV_KEY_SHA256, /^[0-9a-f]{64}$/);
    assert.equal(await checkDevKey('not the key'), false);
    assert.equal(await checkDevKey(''), false);
});
