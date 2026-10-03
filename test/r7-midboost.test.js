/*
 * Bug hunt A.3 (session 6): the day plan's mid-boost test had a 300-happy floor, the one the gym page had. A small
 * candy boost (Candy Kisses × 4 = +200) never reached it, so with the candy eaten and the Xanax not yet taken the
 * day plan started again from the bars: a plain Xanax, the boost's happy not trained on, and the candy planned a
 * second time. The floor is now the gym page's rule (never more than half the boost itself), in one place.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { dayTimeline, boostEatenOver, MID_BOOST_MIN } from '../src/core/plan.js';
import { eatenOver } from '../src/core/gympage.js';
import { normalizeState, tornDayStart, HOUR, MIN } from '../src/core/bars.js';
import { unlockedGyms } from '../src/core/gyms.js';
import { BUILDS } from '../src/core/builds.js';
import { XANAX, ECSTASY, POINTS, CANDY_KISSES } from '../src/core/items.js';

const T0 = Date.UTC(2026, 8, 29, 10, 48);
const HAPPY_MAX = 5025;
function player({ happy, energy = 150, drug = 0, booster = 0 }) {
    return normalizeState({
        bars: { energy: { current: energy, maximum: 150, increment: 5, interval: 600, tick_time: 120 }, happy: { current: happy, maximum: HAPPY_MAX, increment: 5, interval: 900, tick_time: 300 } },
        cooldowns: { drug, booster },
        refills: { energy: true, special_count: 0 },
        battlestats: { strength: { value: 118400 }, speed: { value: 110900 }, defense: { value: 96200 }, dexterity: { value: 82700 } },
        gym: { id: 18 },
    }, T0);
}
const ctx = (n) => ({ shares: BUILDS.hank.shares, unlocked: unlockedGyms(18), active: 18, candyId: CANDY_KISSES, candyCount: n });
const candyOf = (s) => (s.items || []).filter((it) => it.id !== XANAX && it.id !== ECSTASY && it.id !== POINTS).reduce((a, it) => a + it.qty, 0);
const plan = (state, n) => dayTimeline({ state, now: T0, strategy: 'candyXanax', ctx: ctx(n), until: T0 + 48 * HOUR });

test('one threshold for the day plan and the gym page: a share of the boost, at least 300, never more than half the boost', () => {
    assert.equal(boostEatenOver(200), 100);
    assert.equal(boostEatenOver(2450), 612.5);
    assert.equal(boostEatenOver(12500), 3125);
    assert.equal(boostEatenOver(0), MID_BOOST_MIN);
    for (const b of [0, 150, 200, 599, 600, 2450, 12500]) assert.equal(eatenOver(b), boostEatenOver(b));
});

test('Candy Kisses × 4 eaten (+200 happy), the Xanax not yet: the Xanax now, trained at the candy’s happy; the candy is not planned again today', () => {
    // 4 candy are in: happy 200 over the maximum, 2 h on the booster cooldown, the drug cooldown clear.
    const steps = plan(player({ happy: HAPPY_MAX + 200, booster: 2 * 3600 }), 4);
    const first = steps[0];
    assert.ok(first.at - T0 <= 15 * MIN, 'the next step is now: ' + first.label);
    assert.match(first.label, /Xanax/);
    assert.equal(candyOf(first), 0, 'the candy is eaten: none again with this Xanax (' + first.label + ')');
    assert.doesNotMatch(first.note || '', /No candy with this one/);
    const again = steps.filter((s) => s.kind === 'boost' && s.at > first.at && tornDayStart(s.at) === tornDayStart(T0));
    assert.equal(again.length, 0, 'a second candy boost today: ' + again.map((s) => s.label).join(' | '));
});

test('the large boost is read as before (49 candy, +2,450): the floor only moved for boosts under 600 happy', () => {
    const steps = plan(player({ happy: HAPPY_MAX + 2450, booster: 24.5 * 3600 }), 49);
    assert.ok(steps[0].at - T0 <= 15 * MIN);
    assert.match(steps[0].label, /Xanax/);
    assert.equal(candyOf(steps[0]), 0);
});

test('happy a little over the maximum is not a boost under way: a Xanax’s +75, or +99 on a 200 boost', () => {
    for (const over of [75, 99]) {
        const first = plan(player({ happy: HAPPY_MAX + over }), 4).find((s) => s.kind === 'boost');
        assert.ok(first && candyOf(first) === 4, over + ' over: the boost is still planned whole (' + (first && first.label) + ')');
    }
});
