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
