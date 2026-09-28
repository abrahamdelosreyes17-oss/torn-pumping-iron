import test from 'node:test';
import assert from 'node:assert/strict';

import { GYMS, gymById, mergeLiveGyms, unlockEnergyAfter, unlockedGyms, gymAccess, bestGymFor, nextGym, BALBOAS, FRONTLINE, GYM_3000, ISOYAMAS, TOTAL_REBOUND, ELITES, SSL, GEORGES, SSL_DRUG_LIMIT, UNLOCK_ENERGY, SPECIALIST_RATIO } from '../src/core/gyms.js';

const S = (str, spd, def, dex) => ({ str, spd, def, dex });

test('the table has the ladder, the specialists and the Jail Gym', () => {
    assert.equal(gymById(18).name, 'Gun Shop');
    assert.equal(gymById(GEORGES).dots.dex, 7.3);
    assert.equal(gymById(GYM_3000).energy, 50);
    assert.equal(gymById(BALBOAS).energy, 25);
    assert.equal(gymById(SSL).dots.spd, 9);
    assert.equal(gymById(99), null);
    assert.equal(UNLOCK_ENERGY.length, 23);
    assert.equal(GYMS.filter((g) => g.specialist).length, 7);
});

test('Balboas: DEF + DEX ≥ 1.25 × (STR + SPD), at the boundary', () => {
    const g = gymById(BALBOAS);
    assert.equal(gymAccess(g, S(100, 100, 125, 125)).ok, true, 'exactly 1.25');
    assert.equal(gymAccess(g, S(100, 100, 125, 124.9)).ok, false);
    assert.match(gymAccess(g, S(100, 100, 100, 100)).reason, /1\.25/);
});

test('Frontline: STR + SPD ≥ 1.25 × (DEF + DEX), at the boundary', () => {
    const g = gymById(FRONTLINE);
    assert.equal(gymAccess(g, S(125, 125, 100, 100)).ok, true);
    assert.equal(gymAccess(g, S(124.9, 125, 100, 100)).ok, false);
});

test('single-stat gyms: that stat ≥ 1.25 × the next-highest, at the boundary', () => {
    for (const [id, stat] of [[GYM_3000, 'str'], [ISOYAMAS, 'def'], [TOTAL_REBOUND, 'spd'], [ELITES, 'dex']]) {
        const ok = { str: 80, spd: 100, def: 90, dex: 70, [stat]: 125 };
        // next-highest among the others is 100 (or 90 when stat is spd)
        const next = Math.max(...Object.entries(ok).filter(([k]) => k !== stat).map(([, v]) => v));
        ok[stat] = SPECIALIST_RATIO * next;
        assert.equal(gymAccess(gymById(id), ok).ok, true, stat + ' at 1.25');
        assert.equal(gymAccess(gymById(id), { ...ok, [stat]: ok[stat] - 0.01 }).ok, false, stat + ' just under');
    }
});

test('Sports Science Lab: at most 150 Xanax + Ecstasy, unknown count allowed', () => {
    const g = gymById(SSL);
    assert.equal(SSL_DRUG_LIMIT, 150);
    assert.equal(gymAccess(g, S(1, 1, 1, 1), { drugsTaken: 150 }).ok, true);
    assert.equal(gymAccess(g, S(1, 1, 1, 1), { drugsTaken: 151 }).ok, false);
    assert.equal(gymAccess(g, S(1, 1, 1, 1)).ok, true);
});

test('ladder gyms have no stat rule', () => {
    assert.equal(gymAccess(gymById(18), S(1, 0, 0, 0)).ok, true);
    assert.equal(gymAccess(null, S(1, 1, 1, 1)).ok, false);
});

test('unlocked gyms from the active gym; the gym page wins when read', () => {
    assert.deepEqual(unlockedGyms(3), [1, 2, 3]);
    assert.equal(unlockedGyms(GYM_3000).includes(GEORGES), true);
    assert.equal(unlockedGyms(GYM_3000).includes(GYM_3000), true);
    assert.deepEqual(unlockedGyms(18, [18, 3, 3, 1]), [1, 3, 18]);
});

test('unlock energy, and the Music Store divides it by 1.3', () => {
    assert.equal(unlockEnergyAfter(1), 200);
    assert.equal(unlockEnergyAfter(18), 36610);
    assert.equal(unlockEnergyAfter(18, 1.3), Math.ceil(36610 / 1.3));
    assert.equal(unlockEnergyAfter(GEORGES), null);
});

test('best gym per stat: highest dots among unlocked and accessible', () => {
    const friend = S(118400, 110900, 96200, 82700);
    const unl = unlockedGyms(18);
    assert.equal(bestGymFor('str', friend, unl).name, 'Gun Shop');
    assert.equal(bestGymFor('def', friend, unl).name, 'Apollo Gym', 'Apollo has DEF 6.4 against Gun Shop 6.2');
    // DEX ties at 6.2 (Apollo, Gun Shop): stay where you are.
    assert.equal(bestGymFor('dex', friend, unl, { active: 18 }).name, 'Gun Shop');
    assert.equal(bestGymFor('dex', friend, unl, { active: 17 }).name, 'Apollo Gym');
});

test('a specialist is best only while its rule holds', () => {
    const unl = [...unlockedGyms(GEORGES), GYM_3000, BALBOAS];
    const hank = S(360e6, 98.4e6, 288e6, 288e6);
    assert.equal(bestGymFor('str', hank, unl).id, GYM_3000);
    assert.equal(bestGymFor('def', hank, unl).id, BALBOAS);
    const flat = S(100, 100, 100, 100);
    assert.equal(bestGymFor('str', flat, unl).id, GEORGES);
});

test('live gyms replace the table by id; ×10 dots are scaled back', () => {
    const t = mergeLiveGyms([{ id: 24, name: "George's", energy_cost: 10, cost: 1e8, modifiers: { strength: 7.4, speed: 7.3, defense: 7.3, dexterity: 7.3 } }, { id: 1, modifiers: { strength: 20, speed: 20, defense: 20, dexterity: 20 } }, { id: 40, name: 'New Gym', energy_cost: 25, modifiers: { strength: 9.5 } }]);
    assert.equal(gymById(24, t).dots.str, 7.4);
    assert.equal(gymById(1, t).dots.str, 2);
    assert.equal(gymById(40, t).energy, 25);
    assert.equal(gymById(24).dots.str, 7.3, 'the built-in table is untouched');
    assert.equal(mergeLiveGyms(null).length, GYMS.length);
});

test('next gym: Force Training from Gun Shop in 7,410 E is about 5 days at 1,620 E a day', () => {
    const n = nextGym(18, 36610 - 7410, 1620);
    assert.equal(n.gym.name, 'Force Training');
    assert.equal(n.energyLeft, 7410);
    assert.ok(Math.abs(n.days - 4.57) < 0.01);
    assert.equal(n.cost, 15e6);
    assert.equal(nextGym(GEORGES, 0, 100), null);
});
