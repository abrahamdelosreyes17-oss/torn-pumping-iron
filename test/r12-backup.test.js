/*
 * Round 9, the owner's pick 5B (mockups/round9/companion.html §5): back up and restore. One file with the settings,
 * the build and plan, progress history, the Torn Eye list and what the gym learned; the API keys only with the tick;
 * never the Discord login or the money log. A restore replaces those kinds and touches nothing else.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildBackup, readBackup, restoreOps, backupFileName, backupDay, BACKUP_GM, BACKUP_PAGE, BACKUP_KEYS, BACKUP_NEVER } from '../src/core/backup.js';
import { K, DATA_GROUPS } from '../src/platform/store.js';
import { PAGE_KEYS, ARCHIVES } from '../src/platform/archive.js';

const NOW = Date.UTC(2026, 9, 3, 18, 40);
const GM = {
    settings: { timeFormat: 'local', oneOffs: { 123: true } },
    plan: { type: 'steady', build: 'hank:str' },
    statsHistory: { 1791072000000: { str: 1 } },
    learned: { gym: { mult: 1.02 } },
    pingTicks: { hand: { nerve: { on: false, at: 5 } } },
    myAttacks: { list: [{ id: 1 }] },
    // What must never leave: the Discord login and the money log.
    worker: { base: 'https://w.example', secret: 'S3CRET', login: 'abc' },
    moneyLog: { lines: [1, 2, 3] },
    apiKey: 'AAAAkey',
    fullKey: 'FULLkey',
};
const PAGE = { eyeTargets: [{ id: 5 }], learnLog: [{ at: 1 }], moneyLog: { lines: [9] } };
const read = { gm: (k) => (k in GM ? GM[k] : null), page: (k) => (k in PAGE ? PAGE[k] : null), key: (k) => (typeof GM[k] === 'string' ? GM[k] : '') };
const SAVED = { rev: 3, days: 30, path: { gained: 1 } };

test('the file: settings, plan, history, the Torn Eye list, the learning; no keys unless ticked', () => {
    const b = buildBackup({ read, savedPlan: SAVED, version: '1.6.0', now: NOW });
    assert.deepEqual([b.app, b.kind, b.format, b.version, b.at, b.hasKeys], ['torn-pumping-iron', 'backup', 1, '1.6.0', NOW, false]);
    assert.deepEqual(Object.keys(b.gm).sort(), ['learned', 'myAttacks', 'pingTicks', 'plan', 'settings', 'statsHistory']);
    assert.deepEqual(Object.keys(b.page).sort(), ['eyeTargets', 'learnLog']);
    assert.deepEqual(b.savedPlan, SAVED);
    assert.equal('keys' in b, false);
    // The ticks on the Ledger travel with the settings.
    assert.deepEqual(b.gm.settings.oneOffs, { 123: true });
    const text = JSON.stringify(b);
    for (const secret of ['S3CRET', 'AAAAkey', 'FULLkey', 'w.example']) assert.equal(text.includes(secret), false, secret + ' is in the file');
});

test('with the tick: the API keys, and still never the Discord login', () => {
    const b = buildBackup({ read, savedPlan: null, withKeys: true, now: NOW });
    assert.deepEqual(b.keys, { apiKey: 'AAAAkey', fullKey: 'FULLkey' });
    assert.equal(b.hasKeys, true);
    assert.equal(JSON.stringify(b).includes('S3CRET'), false);
    assert.equal(backupFileName(NOW, true), 'pumping-iron-backup-20261003-1840-WITH-KEYS.json');
    assert.equal(backupFileName(NOW, false), 'pumping-iron-backup-20261003-1840.json');
});

test('the lists: nothing secret, nothing the webpage re-reads, and every name is a real store key', () => {
    const gm = Object.values(BACKUP_GM).flat();
    const page = Object.values(BACKUP_PAGE).flat();
    for (const k of [...gm, ...page, ...BACKUP_KEYS]) assert.equal(BACKUP_NEVER.includes(k), false, k);
    for (const k of [K.worker, K.moneyLog, K.keyInfo, K.leader]) assert.ok(BACKUP_NEVER.includes(k), k);
    for (const k of page) assert.ok(PAGE_KEYS.includes(k), k + ' is not the webpage\'s');
    // The Torn key names are the store's own.
    assert.deepEqual(BACKUP_KEYS, [K.apiKey, K.fullKey, K.ffsKey, K.tsKey]);
    // What "Your data" can clear and a backup holds are the same names (a typo here would back up nothing).
    const known = new Set([...Object.values(DATA_GROUPS).flat(), ...Object.values(K), ...Object.keys(ARCHIVES), 'eyeWatch', 'eyeWarBands', 'eyeWarAsk', 'eyeWarAuto', 'eyeLoadouts']);
    for (const k of gm) assert.ok(known.has(k), k + ' is not a known store key');
});

test('reading a file: ours or not, its day, what it holds', () => {
    const b = buildBackup({ read, savedPlan: SAVED, withKeys: true, version: '1.6.0', now: NOW });
    const r = readBackup(JSON.stringify(b));
    assert.equal(r.ok, true);
    assert.deepEqual([r.day, r.version, r.hasKeys], ['Sat 3 Oct', '1.6.0', true]);
    assert.deepEqual(r.parts, ['settings', 'your build and plan', 'progress history', 'the Torn Eye list', 'what the gym learned', '2 API keys']);
    assert.equal(backupDay(NOW), 'Sat 3 Oct');
    assert.deepEqual(readBackup('not json'), { ok: false, error: 'That file is not a Pumping Iron backup (it is not JSON).' });
    assert.equal(readBackup(JSON.stringify({ app: 'other' })).ok, false);
    assert.match(readBackup(JSON.stringify({ ...b, format: 2 })).error, /newer Pumping Iron/);
    assert.equal(readBackup(JSON.stringify({ ...b, at: null })).ok, false);
});

test('a restore replaces the backed-up kinds, removes what the file lacks, and never writes the Discord login', () => {
    const b = buildBackup({ read, savedPlan: SAVED, now: NOW });
    // A file someone edited to carry a login and a money log.
    const evil = { ...b, gm: { ...b.gm, worker: { secret: 'theirs' }, moneyLog: { lines: [] }, somethingElse: 1 }, page: { ...b.page, moneyLog: {} } };
    const ops = restoreOps(evil);
    const written = ops.gmSet.map((x) => x[0]);
    assert.deepEqual(written.sort(), ['learned', 'myAttacks', 'pingTicks', 'plan', 'settings', 'statsHistory']);
    for (const k of ['worker', 'moneyLog', 'somethingElse']) assert.equal(written.includes(k) || ops.gmDel.includes(k) || ops.pageSet.some((x) => x[0] === k), false, k);
    // What this browser has of the same kinds and the file lacks is removed, so the two never mix.
    assert.ok(ops.gmDel.includes('dayLog') && ops.gmDel.includes('calibration'));
    assert.deepEqual(ops.pageSet.find((x) => x[0] === 'eyeTargets')[1], [{ id: 5 }]);
    assert.equal(ops.pageSet.find((x) => x[0] === 'fightLog')[1], null);
    assert.deepEqual(ops.savedPlan, SAVED);
    // No keys in the file: the keys here stay as they are.
    assert.deepEqual(ops.keys, []);
    assert.deepEqual(restoreOps(buildBackup({ read, withKeys: true, now: NOW })).keys, [['apiKey', 'AAAAkey'], ['fullKey', 'FULLkey']]);
});
