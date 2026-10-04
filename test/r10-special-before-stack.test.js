/*
 * Session 11, the friend's report (2026-10-04): a new player with 100 special
 * refills, on a happy jump plan with an empty bar, was told "Use your refill"
 * before Xanax #1. The refill before a stack is there because the points
 * refill is lost at Torn's midnight; a special refill is not lost, and in the
 * jump it is worth several times what it gives at normal happy. Engine rule:
 * a special refill is never used before a stack (the simulator and the day
 * plan together). Every number here is made up.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { simulateStrategy, SPECIAL } from '../src/core/strategies.js';
import { dayTimeline } from '../src/core/plan.js';
import { normalizeState, DAY } from '../src/core/bars.js';
import { unlockedGyms } from '../src/core/gyms.js';
import { BUILDS } from '../src/core/builds.js';
import { XANAX, ECSTASY, EDVD, POINTS } from '../src/core/items.js';

const T0 = Date.UTC(2026, 9, 4, 14, 0);
const player = ({ energy = 0, special = 100 } = {}) =>
    normalizeState(
        {
            bars: { energy: { current: energy, maximum: 100, increment: 5, interval: 900, tick_time: 120 }, happy: { current: 3450, maximum: 3500, increment: 5, interval: 900, tick_time: 300 } },
            cooldowns: { drug: 0, booster: 0 },
            refills: { energy: false, special_count: special },
            battlestats: { strength: { value: 9000 }, speed: { value: 9000 }, defense: { value: 9000 }, dexterity: { value: 9000 } },
            gym: { id: 11 },
        },
        T0,
    );
const CTX = { shares: BUILDS.balanced.shares, unlocked: unlockedGyms(11), active: 11, held: { [EDVD]: 5 } };
const plan = (ctx, state = player()) => dayTimeline({ state, now: T0, strategy: 'edvdJump', ctx: { ...CTX, ...ctx }, until: T0 + 3 * DAY });
const SIM = { stats: { str: 9000, spd: 9000, def: 9000, dex: 9000 }, target: 'spd', gyms: { spd: { dots: 4.6, energy: 10 } }, happyMax: 3500, energyMax: 100, fastEnergy: false, days: 3, prices: { [XANAX]: 830000, [ECSTASY]: 70000, [EDVD]: 4300000, [POINTS]: 30000 }, start: { energy: 0, happy: 3450, drugCdMin: 0, refillUsed: false }, dayMin: 14 * 60 };

test('the day plan: with special refills held, a jump plan starts with Xanax #1; the refill waits for the jump', () => {
    const steps = plan({ specialHeld: 100 });
    assert.equal(steps[0].kind, 'stack', steps[0].label);
    assert.equal(steps[0].label, 'Xanax #1 of 4 · don\'t train');
    const jump = steps.findIndex((s) => s.kind === 'jump');
    const refills = steps.filter((s) => s.kind === 'refill');
    assert.ok(jump > 0 && refills.length >= 1);
    assert.ok(steps.indexOf(refills[0]) > jump, 'the first special refill is after the jump, at its happy');
    assert.ok(refills[0].gain > 5 * 133, 'worth several times a refill at normal happy: +' + refills[0].gain);
});

test('the day plan: with no special refill held the points refill still goes in before the stack (it is lost at midnight), and says why', () => {
    const steps = plan({ specialHeld: 0 });
    assert.equal(steps[0].kind, 'refill');
    assert.deepEqual(steps[0].items, [{ id: POINTS, qty: 30 }]);
    assert.match(steps[0].note, /before Xanax #1: no jump today/);
    assert.equal(steps[1].kind, 'stack');
});

test('the day plan: a special refill says why it stands in for the points refill, and keeps the step’s own note', () => {
    // A stack already under way: the refill is the one after the jump.
    const steps = plan({ specialHeld: 3, stackedSoFar: 4 }, player({ energy: 1000, special: 3 }));
    const refill = steps.find((s) => s.kind === 'refill');
    assert.equal(refill.label, 'Special refill (instead of the points refill)');
    assert.match(refill.note, /points refill only once your special refills are spent/);
    assert.ok(!/1 source/.test(refill.note), 'Torn’s own page says so (the owner’s screenshot): no longer a guess');
});

test('the simulator: a special refill is not spent before a stack; every one used on a jump plan is used in a jump', () => {
    const held = simulateStrategy('edvdJump', { ...SIM, specialHeld: 100 });
    const jumps = held.used[ECSTASY];
    assert.ok(jumps >= 1);
    assert.equal(held.used[SPECIAL], jumps, 'one a jump: ' + held.used[SPECIAL] + ' used over ' + jumps + ' jumps');
    assert.equal(held.used[POINTS], 0, 'no points bought while specials are held');
    // Without specials the points refill before the stack stays.
    const none = simulateStrategy('edvdJump', { ...SIM, specialHeld: 0 });
    assert.equal(none.used[POINTS] / 30, none.used[ECSTASY] + 1, 'the day the stack starts on, and each jump');
});
