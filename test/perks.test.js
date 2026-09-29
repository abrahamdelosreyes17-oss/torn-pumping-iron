import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePerks, noPerks } from '../src/core/perks.js';

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-9, `${msg || ''} ${a} vs ${b}`);

test('faction steadfast, per stat', () => {
    const p = parsePerks({ faction: ['+ 20% strength gym gains', '+ 15% speed gym gains'] });
    near(p.mult.str, 1.2);
    near(p.mult.spd, 1.15);
    near(p.mult.def, 1);
    assert.equal(p.lines.length, 2);
});

test('education: +1% per stat course and +1% all, multiplied', () => {
    const p = parsePerks({ education: ['+ 1% strength gym gains', '+ 1% gym gains'] });
    near(p.mult.str, 1.01 * 1.01);
    near(p.mult.dex, 1.01);
});

test('property +2% and company perks (TornTools wording)', () => {
    const p = parsePerks({ property: ['+ 2% gym gains'], job: ['3% gym gains', '10% dexterity gym gains'] });
    near(p.mult.dex, 1.02 * 1.03 * 1.1);
    near(p.mult.str, 1.02 * 1.03);
});

test('books: Get Hard Or Go Home and a stat book, with their days', () => {
    const p = parsePerks({ book: ['Increases all gym gains by 20% for 31 days'] });
    near(p.mult.def, 1.2);
    assert.deepEqual(p.books.map((b) => [b.kind, b.pct, b.days]), [['all', 20, 31]]);
    const q = parsePerks({ book: ['Incr. Str gym gains by 30% (31 days).'] });
    near(q.mult.str, 1.3);
    near(q.mult.spd, 1);
    assert.equal(q.books[0].stat, 'str');
});

test('Sports Sneakers: +5% speed gym gains (enhancer)', () => {
    near(parsePerks({ enhancer: ['+ 5% speed gym gains'] }).mult.spd, 1.05);
});

test('Ignorance Is Bliss is detected from its item text, and is not a gain multiplier', () => {
    const p = parsePerks({ book: ['Happiness can regenerate above maximum for 31 days.'] });
    assert.equal(p.bliss, true);
    assert.equal(p.blissDays, 31);
    near(p.mult.str, 1);
    assert.equal(parsePerks({ book: ['Increases all gym gains by 20% for 31 days'] }).bliss, false);
});

test('Music Store "30% gym experience" and Goal Oriented happy loss', () => {
    const p = parsePerks({ job: ['30% gym experience', '50% happy loss reduction in gym'] });
    near(p.gymExpMult, 1.3);
    near(p.happyLossMult, 0.5);
    near(p.mult.str, 1, 'neither is a gain multiplier');
});

test('lines we don\'t understand are kept for diagnostics only when they look gym-related', () => {
    const p = parsePerks({ merit: ['+ 6% life'], stock: ['Gym membership discount of 10%'] });
    assert.deepEqual(p.unknown, ['stock: Gym membership discount of 10%']);
    near(p.mult.str, 1);
});

test('junk input gives no perks', () => {
    for (const x of [null, undefined, 'x', { faction: 'nope' }, { faction: [null, ''] }]) {
        const p = parsePerks(x);
        near(p.mult.str * p.mult.spd * p.mult.def * p.mult.dex, 1);
    }
    assert.equal(noPerks().bliss, false);
});

test('round 3: company, faction and book perks in both of Torn’s wordings (research-events-perks.md §2)', () => {
    const a = parsePerks({ job: ['+ 100% console happiness', '+ 30% increased gym experience', '- 50% reduction of happiness loss in gym'] });
    assert.equal(a.consoleMult, 2);
    assert.equal(a.toyShop5, true);
    assert.ok(Math.abs(a.gymExpMult - 1.3) < 1e-9);
    assert.equal(a.happyLossMult, 0.5);
    assert.deepEqual(a.unknown, []);
    const b = parsePerks({ job: ['100% happy gain from Game Console', '30% gym experience', '50% happy loss reduction in gym'] });
    assert.equal(b.consoleMult, 2);
    assert.ok(Math.abs(b.gymExpMult - 1.3) < 1e-9);
    assert.equal(b.happyLossMult, 0.5);
    const an = parsePerks({ job: ['+ 100% bonus to Erotic DVDs'] });
    assert.equal(an.adultNovelties10, true);
    assert.equal(parsePerks({ job: ['100% happy gain from Erotic DVDs'] }).edvdMult, 2);
    const f = parsePerks({ faction: ['+ Increases energy gain from energy drinks by 50%', '+ Increase happy gain from candy by 50%', '+ Adds 24 hours of maximum booster cooldown', '+ Increases strength gym gains by 20%'] });
    assert.equal(f.canMult, 1.5);
    assert.equal(f.candyMult, 1.5);
    assert.equal(f.boosterCapExtraH, 24);
    assert.ok(Math.abs(f.mult.str - 1.2) < 1e-9);
    const g = parsePerks({ job: ['+ 10% consumable boost', '+ 25% consumable cool down reduction'], book: ['+ Doubles energy drink effects for 31 days'] });
    assert.ok(Math.abs(g.canMult - 2.2) < 1e-9);
    assert.ok(Math.abs(g.candyMult - 1.1) < 1e-9);
    assert.equal(g.consumableCdMult, 0.75);
    assert.equal(parsePerks({ job: ['10% consumable gain'] }).candyMult, 1.1);
    assert.equal(parsePerks({ book: ['Decreases all consumable cooldowns by 50% for 31 days'] }).consumableCdMult, 0.5);
    assert.equal(parsePerks({}).toyShop5, false);
});
