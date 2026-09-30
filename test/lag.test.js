/*
 * The lag fix (owner's friend, 2026-09-30: "masyadong laggy yung gym script"): every Torn page worked the whole
 * plan comparison out again in one go (~1 s on a slow machine). It's kept between pages now (K.compareCache), a
 * page opens on the kept one, today's candy being saved doesn't run it a second time, and a kept comparison for
 * other inputs never lets Auto rewrite the plan. Also the engine's happy-terms cache gives the same numbers.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { pi, currentModel, storedCompare, refresh } from '../src/runtime.js';
import { K, get, set } from '../src/platform/store.js';
import { gainPerTrain, happyTerms, HAPPY_CAP, STAT_AB, effectiveStat, round4 } from '../src/core/gain.js';

const API = {
    bars: { energy: { current: 20, maximum: 150, increment: 5, interval: 600, tick_time: 120, full_time: 15600 }, happy: { current: 5025, maximum: 5025, increment: 5, interval: 900, tick_time: 300, full_time: 0 } },
    cooldowns: { drug: 232, medical: 0, booster: 0 },
    refills: { energy: false, nerve: false, token: false, special_count: 0 },
    battlestats: { strength: { value: 118400 }, defense: { value: 96200 }, speed: { value: 110900 }, dexterity: { value: 82700 }, total: 408200 },
    gym: { id: 18, name: 'Gun Shop' },
};

/** A new Torn page: nothing in this page's memory, the store as the last page left it. */
function newPage() {
    clearTimeout(pi.compareTimer);
    Object.assign(pi, { compare: null, whatIf: null, jobWhatIf: null, compareKey: '', compareKeyNoPrice: '', compareWanted: '', compareScheduled: '' });
}

function setup(strategy) {
    newPage();
    for (const k of [K.compareCache, K.compareBusy, K.candyPick]) set(k, null);
    set(K.userState, { api: API, at: Date.now() });
    set(K.plan, { type: 'steady', strategy, build: 'baldr', buildPicked: true, strategyPicked: true, pickBy: 'most', createdAt: 1 });
}

test('a new page opens on the comparison the last page worked out: nothing is run again', () => {
    setup('steady');
    const m1 = currentModel();
    assert.ok(m1.ready && m1.compare && m1.compare.steady, 'the first page works it out');
    const kept = storedCompare();
    assert.ok(kept, 'and keeps it');
    assert.equal(kept.key, pi.compareKey);
    newPage();
    const m2 = currentModel();
    assert.equal(storedCompare().at, kept.at, 'the next page did not work it out again');
    assert.deepEqual(m2.compare, m1.compare);
    assert.equal(pi.compareWanted, pi.compareKey, 'nothing is waiting');
    assert.ok(!pi.compareScheduled, 'no run scheduled');
});

test('saving today’s candy (an input of the comparison) does not run it a second time', () => {
    setup('dailyChoco');
    const m1 = currentModel();
    const pick = get(K.candyPick, null);
    assert.ok(pick && m1.compare.dailyChoco.candy && pick.id === m1.compare.dailyChoco.candy.id, 'the candy is saved');
    const at = storedCompare().at;
    // The next redraw on the same page and on a new page: the key with the saved candy is the kept key.
    currentModel();
    assert.ok(!pi.compareScheduled, 'same page: nothing scheduled');
    newPage();
    currentModel();
    assert.equal(storedCompare().at, at, 'new page: not worked out again');
    assert.ok(!pi.compareScheduled);
});

test('a kept comparison for other inputs shows at once, a new one is scheduled, and Auto waits for it', () => {
    setup('steady');
    currentModel();
    const kept = storedCompare();
    // Another hour, or the stats moved: the kept one is for other inputs.
    set(K.compareCache, { ...kept, key: kept.key + '|older', keyNoPrice: kept.keyNoPrice + '|older' });
    newPage();
    const m = currentModel();
    assert.ok(m.compare && m.compare.steady, 'the last comparison shows');
    assert.notEqual(pi.compareWanted, pi.compareKey, 'not fresh: Auto does not rewrite the plan from it');
    assert.equal(pi.compareScheduled, pi.compareWanted, 'the new one is scheduled (in slices, after the page paints)');
    clearTimeout(pi.compareTimer);
});

test('another tab working it out: this tab waits and takes its result', async () => {
    setup('steady');
    currentModel();
    const kept = storedCompare();
    set(K.compareCache, { ...kept, key: kept.key + '|older', keyNoPrice: kept.keyNoPrice + '|older' });
    newPage();
    currentModel();
    const want = pi.compareWanted;
    set(K.compareBusy, { key: want, tab: 'other-tab', at: Date.now() });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(storedCompare().key, kept.key + '|older', 'this tab did not run it');
    assert.equal(pi.compareScheduled, '', 'it looks again at the next redraw');
    // The other tab finishes: the next redraw takes it.
    set(K.compareCache, { ...kept, key: want, at: kept.at + 1 });
    set(K.compareBusy, null);
    currentModel();
    assert.equal(pi.compareKey, want);
    assert.equal(pi.compareWanted, want);
});

test('a comparison kept by another version is not used', () => {
    setup('steady');
    currentModel();
    const kept = storedCompare();
    set(K.compareCache, { ...kept, v: '0.0.1' });
    assert.equal(storedCompare(), null);
    newPage();
    currentModel();
    assert.equal(storedCompare().v, kept.v, 'worked out again by this build');
});

test('a hidden tab works nothing out; it catches up when shown', () => {
    const had = Object.getOwnPropertyDescriptor(globalThis, 'document');
    globalThis.document = { visibilityState: 'hidden' };
    try {
        pi.model = null;
        refresh();
        assert.equal(pi.model, null);
        assert.equal(pi.stale, true);
    } finally {
        if (had) Object.defineProperty(globalThis, 'document', had);
        else delete globalThis.document;
    }
    set(K.userState, { api: API, at: Date.now() });
    refresh();
    assert.equal(pi.stale, false);
    assert.ok(pi.model && pi.model.ready);
});

test('happyTerms (kept for the last few happy values) gives gainPerTrain’s exact numbers', () => {
    const old = (stat, S, H, dots, E) => {
        const h = Math.min(HAPPY_CAP, Math.max(0, H || 0));
        const [A, B] = STAT_AB[stat];
        const inner = effectiveStat(S) * round4(1 + 0.07 * round4(Math.log(1 + h / 250))) + 8 * Math.pow(h, 1.05) + (1 - Math.pow(h / HAPPY_CAP, 2)) * A + B;
        return Math.max(0, (inner / 200000) * dots * E);
    };
    for (const H of [0, 1, 249.5, 5025, 4999.75, 5025, 0, 99999, 150000, -3, 5025]) {
        for (const [stat, S] of [['str', 118400], ['def', 2.88e8], ['dex', 0]]) assert.equal(gainPerTrain(stat, S, H, 7.3, 10), old(stat, S, H, 7.3, 10), stat + ' at happy ' + H);
        assert.strictEqual(happyTerms(H), happyTerms(H), 'kept');
    }
});
