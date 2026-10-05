/*
 * Round 9, the owner's pick 3B (mockups/round9/companion.html §3): a stat box the session leaves alone says what one
 * train gives in this gym, and the gym of yours that gives more for the same energy. The box stays grey: no outline,
 * no Fill, and nothing switches gyms.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { offPlanLines } from '../src/core/gympage.js';
import { gymById } from '../src/core/gyms.js';
import { gainPerTrain } from '../src/core/gain.js';
import { gymNotes, pillSpot } from '../src/ui/marks/marks.js';

const GEORGES = gymById(24);
const FRONTLINE = gymById(26);
const o = { value: 2e6, happy: 4500, gym: GEORGES, perk: 1 };

test('no better gym: only what a train gives here', () => {
    const r = offPlanLines('def', { ...o, best: GEORGES });
    const here = Math.round(gainPerTrain('def', 2e6, 4500, 7.3, 10, 1));
    assert.deepEqual(r.lines, ['about +' + here.toLocaleString('en-US') + ' a train here']);
    assert.equal(r.foot, '+' + here.toLocaleString('en-US') + ' a train');
    assert.equal(r.better, null);
});

test('a better gym of yours: where, its dots, and both gains for the same energy', () => {
    const r = offPlanLines('spd', { ...o, best: FRONTLINE });
    assert.deepEqual(r.better, { id: 26, name: 'Frontline Fitness', dots: 7.5 });
    assert.equal(r.lines[0], 'Better at Frontline Fitness · 7.5 dots');
    // Frontline takes 25 energy a train, George's 10: the two are said for George's 10.
    const here = gainPerTrain('spd', 2e6, 4500, 7.3, 10, 1);
    const there = gainPerTrain('spd', 2e6, 4500, 7.5, 10, 1);
    assert.equal(r.lines[1], 'about +' + Math.round(here).toLocaleString('en-US') + ' for 10 energy here, +' + Math.round(there).toLocaleString('en-US') + ' there');
    assert.ok(r.gain.there > r.gain.here);
    assert.equal(r.foot, 'Better at Frontline Fitness');
});

test('the same energy a train: "a train here, … there"', () => {
    const same = { ...FRONTLINE, energy: 10 };
    assert.match(offPlanLines('spd', { ...o, best: same }).lines[1], /^about \+[\d,]+ a train here, \+[\d,]+ there$/);
});

test('the best gym is the one you are in, or no better: no "Better at"', () => {
    assert.equal(offPlanLines('str', { ...o, best: GEORGES }).better, null);
    assert.equal(offPlanLines('str', { ...o, best: { ...FRONTLINE, dots: { ...FRONTLINE.dots, str: 7.3 } } }).better, null);
});

test('a stat this gym does not train: where it is trained, and a train there', () => {
    const r = offPlanLines('dex', { ...o, gym: FRONTLINE, best: GEORGES });
    assert.equal(r.lines[0], 'Trained at George\'s · 7.3 dots');
    assert.match(r.lines[1], /^about \+[\d,]+ a train there$/);
    assert.equal(r.foot, 'Trained at George\'s');
    // Nowhere to train it: nothing to say.
    assert.equal(offPlanLines('dex', { ...o, gym: FRONTLINE, best: null }), null);
});

test('the panel lists a better gym once, with both gains; the box\'s second pill sits on its bottom border', () => {
    const more = offPlanLines('spd', { ...o, best: FRONTLINE });
    const plan = { state: { kind: 'right' }, current: null, parts: [], perStat: { spd: { kind: 'skip', text: 'Skip · not in this session', tag: 'skip', ...more }, str: { kind: 'skip', ...offPlanLines('str', { ...o, best: GEORGES }) } } };
    const notes = gymNotes(plan);
    assert.equal(notes.length, 1);
    assert.match(notes[0], /^SPD · better at Frontline Fitness · 7\.5 dots · about \+[\d,]+ for 10 energy here, \+[\d,]+ there$/);
    const box = { left: 100, top: 200, width: 180, height: 150 };
    assert.equal(pillSpot(box, { x: 0, y: 0 }, 120, 20).top, 200 - 3 - 10);
    assert.equal(pillSpot(box, { x: 0, y: 0 }, 120, 20, { edge: 'bottom' }).top, 350 + 3 - 10);
});
