import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeState, energyAt, energyReachesAt, happyAt, nextQuarterTick, tornDayStart, msToTornMidnight, tornClock, countdown, refillAvailable, diffStates, boosterRoomH, drugFreeAt, fastEnergy, MIN, HOUR, DAY } from '../src/core/bars.js';
import { ITEMS, boostersThatFit, EDVD, CANDY_KISSES, XANAX, FHC, itemName, POINTS } from '../src/core/items.js';

const T0 = Date.UTC(2026, 8, 29, 10, 48);

function api(over = {}) {
    return {
        bars: {
            energy: { current: 20, maximum: 150, increment: 5, interval: 600, tick_time: 120, full_time: 0 },
            happy: { current: 5025, maximum: 5025, increment: 5, interval: 900, tick_time: 300, full_time: 0 },
            ...(over.bars || {}),
        },
        cooldowns: { drug: 232, booster: 0, medical: 0, ...(over.cooldowns || {}) },
        refills: { energy: false, nerve: false, token: false, special_count: 0, ...(over.refills || {}) },
        battlestats: { strength: { value: 118400 }, speed: { value: 110900 }, defense: { value: 96200 }, dexterity: { value: 82700 }, total: 408200 },
        gym: { id: 18, name: 'Gun Shop' },
    };
}

test('one API answer becomes the engine state', () => {
    const s = normalizeState(api(), T0);
    assert.equal(s.energy.current, 20);
    assert.equal(s.energy.interval, 600);
    assert.equal(s.happy.maximum, 5025);
    assert.equal(s.drugCd, 232);
    assert.equal(s.refillUsed, false);
    assert.deepEqual(s.stats, { str: 118400, spd: 110900, def: 96200, dex: 82700 });
    assert.equal(s.gymId, 18);
    assert.equal(fastEnergy(s), true);
});

test('a partial answer leaves the missing parts null', () => {
    const s = normalizeState({ bars: {} }, T0);
    assert.equal(s.stats, null);
    assert.equal(s.refillUsed, null);
    assert.equal(s.gymId, null);
    assert.equal(s.energy.maximum, 150);
});

test('energy regenerates on ticks and stops at the maximum', () => {
    const s = normalizeState(api(), T0);
    assert.equal(energyAt(s, T0 + 60e3), 20, 'before the first tick');
    assert.equal(energyAt(s, T0 + 120e3), 25, 'first tick after tick_time');
    assert.equal(energyAt(s, T0 + 120e3 + 600e3), 30);
    assert.equal(energyAt(s, T0 + 10 * HOUR), 150, 'capped');
});

test('regen above the maximum never happens (after a Xanax)', () => {
    const s = normalizeState(api({ bars: { energy: { current: 400, maximum: 150, increment: 5, interval: 600, tick_time: 120 } } }), T0);
    assert.equal(energyAt(s, T0 + 5 * HOUR), 400);
});

test('when energy is full', () => {
    const s = normalizeState(api(), T0);
    // 130 to go at 5 per 10 min: first tick in 2 min, 25 more ticks.
    assert.equal(energyReachesAt(s, 150), T0 + 120e3 + 25 * 600e3);
    assert.equal(energyReachesAt(s, 10), T0);
    assert.equal(energyReachesAt(s, 151), null);
});

test('happy: regenerates up to max; above max it resets at the next quarter tick', () => {
    const s = normalizeState(api({ bars: { happy: { current: 5100, maximum: 5025, increment: 5, interval: 900, tick_time: 300 } } }), T0);
    assert.equal(happyAt(s, T0 + 60e3), 5100, 'before 10:45? no: 10:48 → next tick 11:00');
    assert.equal(happyAt(s, Date.UTC(2026, 8, 29, 11, 0)), 5025, 'reset at 11:00');
    const low = normalizeState(api({ bars: { happy: { current: 4000, maximum: 5025, increment: 5, interval: 900, tick_time: 300 } } }), T0);
    assert.equal(happyAt(low, T0 + 300e3 + 900e3), 4010);
});

test('Ignorance Is Bliss: happy keeps regenerating above max, no reset, up to 99,999', () => {
    const s = normalizeState(api({ bars: { happy: { current: 20000, maximum: 5025, increment: 5, interval: 900, tick_time: 300 } } }), T0);
    assert.equal(happyAt(s, Date.UTC(2026, 8, 29, 11, 0), { bliss: true }), 20005);
    const top = normalizeState(api({ bars: { happy: { current: 99998, maximum: 5025, increment: 5, interval: 900, tick_time: 1 } } }), T0);
    assert.equal(happyAt(top, T0 + 2 * HOUR, { bliss: true }), 99999);
});

test('quarter ticks and Torn days are UTC', () => {
    assert.equal(nextQuarterTick(Date.UTC(2026, 8, 29, 10, 48)), Date.UTC(2026, 8, 29, 11, 0));
    assert.equal(nextQuarterTick(Date.UTC(2026, 8, 29, 11, 0)), Date.UTC(2026, 8, 29, 11, 15), 'strictly after');
    assert.equal(tornDayStart(T0), Date.UTC(2026, 8, 29));
    assert.equal(msToTornMidnight(Date.UTC(2026, 8, 29, 23, 0)), HOUR);
    assert.equal(tornClock(T0), '10:48');
});

test('countdowns read m:ss under an hour and Xh MMm above', () => {
    assert.equal(countdown(232e3), '3:52');
    assert.equal(countdown((2 * 60 + 42) * 60e3), '2h 42m');
    assert.equal(countdown(0), 'now');
    assert.equal(countdown(-5), 'now');
    assert.equal(countdown(59e3), '0:59');
});

test('refill: the API flag for today; a new Torn day makes it available', () => {
    const used = normalizeState(api({ refills: { energy: true } }), T0);
    assert.equal(refillAvailable(used, T0 + HOUR), false);
    assert.equal(refillAvailable(used, Date.UTC(2026, 8, 30, 0, 1)), true);
    assert.equal(refillAvailable(normalizeState(api(), T0), T0), true);
});

test('drug and booster timing', () => {
    const s = normalizeState(api({ cooldowns: { booster: 6 * 3600 } }), T0);
    assert.equal(drugFreeAt(s), T0 + 232e3);
    assert.equal(boosterRoomH(s, T0), 18);
    assert.equal(boosterRoomH(s, T0 + 6 * HOUR), 24);
});

test('state changes mark steps done: drug taken, refill used, trains', () => {
    const a = normalizeState(api({ cooldowns: { drug: 0 } }), T0);
    const b = normalizeState({ ...api({ cooldowns: { drug: 7 * 3600 }, refills: { energy: true }, bars: { energy: { current: 5, maximum: 150, increment: 5, interval: 600, tick_time: 100 } } }), battlestats: { strength: { value: 118400 }, speed: { value: 110900 }, defense: { value: 96200 }, dexterity: { value: 84120 } } }, T0 + 30e3);
    const d = diffStates(a, b);
    assert.equal(d.drugTaken, true);
    assert.equal(d.refillUsed, true);
    assert.deepEqual(d.trained, { dex: 1420 });
    assert.equal(diffStates(a, a).drugTaken, false);
    assert.deepEqual(diffStates(null, a).trained, {});
});

test('a cooldown ticking down is not a drug taken', () => {
    const a = normalizeState(api({ cooldowns: { drug: 3600 } }), T0);
    const b = normalizeState(api({ cooldowns: { drug: 3570 } }), T0 + 30e3);
    assert.equal(diffStates(a, b).drugTaken, false);
});

test('items: Torn\'s effects', () => {
    assert.equal(ITEMS[XANAX].energy, 250);
    assert.equal(ITEMS[XANAX].happy, 75);
    assert.equal(ITEMS[EDVD].happy, 2500);
    assert.equal(ITEMS[FHC].toMax, true);
    assert.equal(itemName(EDVD), 'EDVD');
    assert.equal(itemName(POINTS), 'Points');
});

test('booster cap: 5 EDVD or 49 candy on an empty 24 h cooldown', () => {
    assert.equal(boostersThatFit(EDVD), 5);
    assert.equal(boostersThatFit(CANDY_KISSES), 49);
    assert.equal(boostersThatFit(EDVD, 48), 9);
    assert.equal(boostersThatFit(EDVD, 24, 1), 4);
    assert.equal(boostersThatFit(EDVD, 24, 24), 0);
    assert.equal(boostersThatFit(XANAX), 0);
});

test('time constants', () => {
    assert.equal(DAY, 24 * HOUR);
    assert.equal(HOUR, 60 * MIN);
});
