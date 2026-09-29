/*
 * Fixes from the three-pass review (docs/review-fable-2026-09-29.md).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { withoutSkipped, drugNotBefore, specialDaysLeft } from '../src/core/model.js';
import { dayTimeline } from '../src/core/plan.js';
import { normalizeState, DAY, HOUR, MIN } from '../src/core/bars.js';
import { unlockedGyms } from '../src/core/gyms.js';
import { BUILDS } from '../src/core/builds.js';
import { XANAX_CD_MIN } from '../src/core/items.js';
import { orderedBands } from '../src/ui/app/settings.js';
import { importFiles, cleanSample } from '../src/core/learndata.js';
import { DEFAULT_BAND_LIMITS } from '../src/core/eye/bands.js';

const T0 = Date.UTC(2026, 8, 29, 10, 48);
const state = (o = {}) => normalizeState({
    bars: { energy: { current: 20, maximum: 150, increment: 5, interval: 600, tick_time: 120 }, happy: { current: 5025, maximum: 5025, increment: 5, interval: 900, tick_time: 300 } },
    cooldowns: { drug: o.drug ?? 0, booster: 0 },
    refills: { energy: false },
    battlestats: { strength: { value: 118400 }, speed: { value: 110900 }, defense: { value: 96200 }, dexterity: { value: 82700 } },
    gym: { id: 18 },
}, T0);

test('B-2: a skip counts for that Torn day only (labels repeat daily)', () => {
    const skip = [{ at: T0, stepAt: T0 + 3 * HOUR, kind: 'xanax', label: 'Xanax #2' }];
    const tomorrow = { kind: 'xanax', at: T0 + 22 * HOUR, label: 'Xanax #2' };
    const today = { kind: 'xanax', at: T0 + 3 * HOUR + 10 * MIN, label: 'Xanax #2' };
    assert.deepEqual(withoutSkipped([today, tomorrow], skip), [tomorrow]);
});

test('B-2: skipping a Xanax re-times the day: the next one waits for the cooldown that would have followed', () => {
    const skip = [{ at: T0, stepAt: T0 + 5 * MIN, kind: 'xanax', label: 'Xanax #1' }];
    const not = drugNotBefore(skip, T0);
    assert.equal(not, T0 + 5 * MIN + XANAX_CD_MIN * MIN);
    const steps = dayTimeline({ state: state(), now: T0, strategy: 'steady', ctx: { shares: BUILDS.balanced.shares, unlocked: unlockedGyms(18), active: 18, drugsToday: 0, drugNotBefore: not } });
    const firstX = steps.find((s) => s.kind === 'xanax');
    assert.ok(firstX.at >= not, 'no Xanax before the cooldown the skipped one would have started');
    assert.equal(drugNotBefore(skip, T0 + DAY), 0, 'a new day starts clean');
});

test('B-13: special refills spread over the horizon again once it has passed (never all in one day)', () => {
    assert.equal(specialDaysLeft(30, 10), 20);
    assert.equal(specialDaysLeft(30, 30), 30);
    assert.equal(specialDaysLeft(30, 45), 30);
});

test('B-14: Torn Eye colour bands stay in order after an edit', () => {
    const l = JSON.parse(JSON.stringify(DEFAULT_BAND_LIMITS));
    const a = orderedBands({ ...l, stomp: { ...l.stomp, win: 50 } }, 'stomp');
    assert.ok(a.stomp.win >= a.good.win && a.good.win >= a.tough.win, JSON.stringify(a));
    const b = orderedBands({ ...l, tough: { ...l.tough, win: 95 } }, 'tough');
    assert.ok(b.stomp.win >= b.good.win && b.good.win >= b.tough.win, JSON.stringify(b));
    const c = orderedBands({ ...l, good: { ...l.good, keep: 90 } }, 'good');
    assert.ok(c.stomp.keep >= c.good.keep);
});

test('S-4: an imported export is cleaned: bad rows dropped, huge train counts refused', () => {
    assert.equal(cleanSample({ stat: 'spd', trains: 1e9, actual: 5 }), null);
    assert.equal(cleanSample({ stat: 'constructor', trains: 5, actual: 5 }), null);
    assert.deepEqual(cleanSample({ stat: 'spd', trains: 20.7, actual: 1000, predicted: 990, S: 4e6, H: 5000, dots: 7.3, E: 10, perks: 1 }), { at: null, stat: 'spd', trains: 20, actual: 1000, predicted: 990, S: 4e6, H: 5000, dots: 7.3, E: 10, perks: 1 });
    const out = importFiles({ 'gym-samples.json': JSON.stringify([{ stat: 'spd', trains: 5, actual: 10 }, { evil: true }, null]), 'fights.json': JSON.stringify([{ predictedWin: 2, won: true }, { predictedWin: 0.7, won: false, who: 'x'.repeat(99) }]), 'meta.json': '[]' });
    assert.equal(out.samples.length, 1);
    assert.equal(out.fights.length, 1);
    assert.equal(out.fights[0].who.length, 20);
    assert.deepEqual(out.meta, {});
});
