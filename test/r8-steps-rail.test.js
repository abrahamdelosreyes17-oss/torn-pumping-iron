/*
 * Round 8, the owner's pick B in mockups/round8/steps-panel.html: today's steps as one rail on Home and the panel on
 * Torn's pages, with the plate ring (his pick 1D) on the one action of the moment. A step with more than one action
 * is its actions in order; the first button follows the action of the moment; eaten boosters keep their name; one
 * ring per surface, none on a countdown or when there is nothing to do; opacity and transform only, still under
 * "reduce motion" and with Settings › Animations off.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { PLAYERS, apiOf, fakeDocument, byClass } from './support/ref.mjs';

globalThis.document = fakeDocument();

const { buildModel } = await import('../src/core/model.js');
const { normalizeState, nextQuarterTick } = await import('../src/core/bars.js');
const { boostProgress } = await import('../src/core/gympage.js');
const { XANAX, POINTS } = await import('../src/core/items.js');
const { subSteps, panelStep, renderHome } = await import('../src/ui/app/home.js');
const { APP_CSS } = await import('../src/ui/styles.js');
const { OVERLAY_CSS } = await import('../src/ui/overlay.js');

const friend = PLAYERS.friend;
const MIN = 60e3;
const HOUR = 3600e3;
// One minute after a quarter tick: 14 minutes until happy above the maximum resets.
const NOW = Date.parse('2026-10-01T12:16:00Z');
const TICK = nextQuarterTick(NOW);

function model(strategy, bars = {}, extra = {}) {
    const state = normalizeState(apiOf(friend, { refillUsed: true, ...bars }), NOW);
    return buildModel({ state, statics: {}, plan: { strategy, build: friend.build, goal: null }, settings: { horizonDays: 30 }, log: [], now: NOW, unlockedKnown: Array.from({ length: 12 }, (_, i) => i + 1), ...extra });
}
const readsOf = (m) => ({ happy: { current: m.strip.happy.current, max: m.strip.happy.max }, boosterLeft: m.strip.booster.left, drugLeft: m.strip.drug.left });
const ctx = { settings: { timeFormat: 'torn' }, prices: {}, statics: {}, ui: {}, plan: { strategy: 'steady', build: friend.build }, go: () => {} };
const part = (stat, trains, gymName = 'Gun Shop') => ({ gymId: 18, gymName, stat, trains, energy: trains * 10, perTrain: 10, gain: 50 * trains });
const XAN = { id: 'xanax-1', kind: 'xanax', label: 'Xanax #2', at: NOW, items: [{ id: XANAX, qty: 1 }], trains: { dex: 27 }, gyms: { dex: 'Gun Shop' }, parts: [part('dex', 27)], gain: 1391, energy: 270 };

test('a step with more than one action is its actions in order: "Take Xanax #2, then train DEX × 27" is two', () => {
    const subs = subSteps(XAN);
    assert.deepEqual(subs.map((x) => [x.id, x.text, x.detail, x.now, x.page]), [
        ['use', 'Take Xanax #2', '+250 energy', true, 'items'],
        ['train', 'Train DEX × 27', 'Gun Shop · about +1,391 · 270 energy', false, 'gym'],
    ]);
    assert.ok(subs.every((x) => !x.done));
});

test('one action stays one: a natural train, a stacked Xanax ("don\'t train" under it), a refill with its points', () => {
    const natural = subSteps({ kind: 'natural', label: 'Natural energy', at: NOW, items: [], trains: { def: 8, dex: 7 }, parts: [part('def', 8), part('dex', 7)], gain: 766, energy: 150 });
    assert.deepEqual(natural.map((x) => [x.text, x.detail, x.now, x.page]), [['Train DEF × 8 · DEX × 7', 'Gun Shop · about +766 · 150 energy', true, 'gym']]);
    const stack = subSteps({ kind: 'stack', label: "Xanax #1 of 4 · don't train", at: NOW, items: [{ id: XANAX, qty: 1 }], trains: {}, gain: 0, energy: 0 });
    assert.deepEqual(stack.map((x) => [x.text, x.detail, x.page]), [['Take Xanax #1 of 4', "don't train", 'items']]);
    const refill = subSteps({ kind: 'refill', label: 'Refill · 30 points', at: NOW, items: [{ id: POINTS, qty: 30 }], trains: { dex: 15 }, parts: [part('dex', 15)], gain: 772, energy: 150 });
    assert.deepEqual(refill.map((x) => [x.text, x.detail, x.page]), [['Use your refill', '30 points', 'points'], ['Train DEX × 15', 'Gun Shop · about +772 · 150 energy', 'gym']]);
    // Two gyms in one session: the walk-through is said, not one gym's name.
    const two = subSteps({ kind: 'natural', label: 'Natural energy', at: NOW, items: [], trains: { str: 12, dex: 8 }, parts: [part('str', 12, "George's"), part('dex', 8, 'Frontline Fitness')], gain: 900, energy: 200 });
    assert.match(two[0].detail, /^George's: STR × 12 → Frontline Fitness: DEX × 8 · about \+900 · 200 energy$/);
});

test('a planned jump: eat first is the action of the moment, in the plan\'s own words', () => {
    const m = model('edvdJump', { energy: 1000 });
    const jump = m.steps.find((s) => s.kind === 'jump');
    const subs = subSteps(jump, { reads: readsOf(m), steps: m.steps });
    assert.deepEqual(subs.map((x) => [x.id, x.done, x.now, x.page]), [['eat', false, true, 'items'], ['drug', false, false, 'items'], ['train', false, false, 'gym']]);
    assert.equal(subs[0].text, 'Eat EDVD × 5');
    assert.equal(subs[1].text, 'Take the Ecstasy');
    assert.equal(subs[1].detail, 'doubles your happy');
    assert.match(subs[2].text, /^Train it all: /);
    assert.match(subs[2].detail, /about \+[\d,]+ · 1,000 energy$/);
});

test('mid-jump: the EDVD keep their name once eaten (it said "Boosters"), ticked, and the Ecstasy is the action of the moment', () => {
    const m = model('edvdJump', { energy: 1000, happy: 16500, booster: 30 * 3600, refillUsed: false });
    const s = m.steps[0];
    assert.ok(s.mid);
    assert.equal(s.actions.find((a) => a.id === 'eat').text, 'Eat EDVD × 5', 'the plan names its boosters in a step found under way');
    assert.equal(boostProgress(s, readsOf(m)).list[0].text, 'EDVD × 5');
    const subs = subSteps(s, { reads: readsOf(m), steps: m.steps });
    assert.deepEqual(subs.map((x) => [x.id, x.done, x.now]), [['eat', true, false], ['drug', false, true], ['train', false, false], ['refill', false, false]]);
    assert.deepEqual([subs[0].text, subs[0].detail], ['EDVD × 5', 'happy 16,500']);
    assert.deepEqual([subs[1].text, subs[1].detail], ['Take the Ecstasy', 'doubles your happy: 16,500 → 33,000']);
    const refill = m.steps.find((x) => x.kind === 'refill');
    assert.deepEqual([subs[3].text, subs[3].detail, subs[3].page], ['Refill, then train again', 'about +' + refill.gain.toLocaleString('en-US'), null], 'the refill is a step of its own: its button comes with its turn');
    // The Ecstasy in: the train is the action of the moment.
    const m2 = model('edvdJump', { energy: 1000, happy: 33000, booster: 30 * 3600, drug: 4 * 3600 - 120 });
    const subs2 = subSteps(m2.steps[0], { reads: readsOf(m2), steps: m2.steps });
    assert.deepEqual(subs2.map((x) => [x.id, x.done, x.now]), [['eat', true, false], ['drug', true, false], ['train', false, true]]);
    assert.deepEqual([subs2[1].text, subs2[1].detail], ['Ecstasy', 'happy 33,000']);
});

test('eaten boosters by name: a jump has its whole load\'s count; a daily candy boost the name alone (it can be smaller)', () => {
    const eat = (strategy, bars) => model(strategy, bars).steps[0].actions.find((a) => a.id === 'eat').text;
    assert.match(eat('chocoJump', { energy: 1000, happy: 16500, booster: 30 * 3600 }), /^Eat [A-Z][A-Za-z ]+ × \d+$/);
    const daily = eat('candyXanax', { energy: 150, happy: 6450, booster: 24.5 * 3600 });
    assert.match(daily, /^Eat [A-Z][A-Za-z ]+$/);
    assert.doesNotMatch(daily, /×|the boosters/);
    assert.doesNotMatch(eat('dailyChoco', { energy: 400, happy: 6450, booster: 24.5 * 3600 }), /×|the boosters/);
});

test('the panel, a step due: the action of the moment in the bar and in big type, what follows on one line, the ring', () => {
    const v = panelStep(XAN, { now: NOW });
    assert.deepEqual(
        { pillNow: v.pillNow, pillText: v.pillText, tone: v.tone, ring: v.ring, label: v.label, cardStep: v.cardStep, cardSub: v.cardSub },
        { pillNow: 'Now', pillText: 'Take Xanax #2', tone: 'chalk', ring: true, label: 'Now', cardStep: 'Take Xanax #2', cardSub: 'then train DEX × 27 · about +1,391 · 270 energy' },
    );
    assert.equal(v.cdAt, undefined, 'no countdown on a step that is due');
    assert.deepEqual(v.checklist, [{ text: 'Take Xanax #2', done: false, next: true }, { text: 'Train DEX × 27', done: false, next: false }]);
    // One action: no list, the gain alone under it.
    const one = panelStep({ kind: 'natural', label: 'Natural energy', at: NOW, items: [], trains: { dex: 15 }, parts: [part('dex', 15)], gain: 766, energy: 150 }, { now: NOW });
    assert.deepEqual([one.pillText, one.cardStep, one.cardSub, one.checklist, one.ring], ['Train DEX × 15', 'Train DEX × 15', 'about +766 · 150 energy', undefined, true]);
});

test('the panel, nothing due: said in words with the countdown, nothing rings; "Session done" right after a train', () => {
    const at = NOW + 5 * HOUR;
    const v = panelStep({ ...XAN, at }, { now: NOW });
    assert.deepEqual(
        { acting: v.acting, pillNow: v.pillNow, pillText: v.pillText, cdAt: v.cdAt, tone: v.tone, ring: v.ring, label: v.label, cardStep: v.cardStep, cardSub: v.cardSub, checklist: v.checklist },
        { acting: false, pillNow: undefined, pillText: 'Nothing due', cdAt: at, tone: null, ring: false, label: 'Next at 17:16', cardStep: 'Nothing due now', cardSub: 'Next at 17:16: take Xanax #2, then train DEX × 27 · about +1,391 · 270 energy', checklist: undefined },
    );
    assert.equal(panelStep({ ...XAN, at }, { now: NOW, sessionOver: true }).cardStep, 'Session done');
    // An item's name is not lowered ("EDVD × 5 + Ecstasy, …").
    assert.match(panelStep({ kind: 'jump', label: 'EDVD × 5 + Ecstasy, then train it all', at, items: [], trains: { str: 100 }, gain: 9000, energy: 1000 }, { now: NOW }).cardSub, /^Next at 17:16: EDVD × 5 \+ Ecstasy, then train STR × 100 · /);
});

test('the panel, a jump mid-way: it counts down to the tick that resets the happy, red until the Ecstasy is in', () => {
    const m = model('edvdJump', { energy: 1000, happy: 16500, booster: 30 * 3600, refillUsed: false });
    const s = m.steps[0];
    const reads = readsOf(m);
    const v = panelStep(s, { now: NOW, boost: boostProgress(s, reads), reads, steps: m.steps });
    assert.equal(v.pillNow, undefined);
    assert.equal(v.cdAt, TICK);
    assert.deepEqual([v.pillText, v.cardStep, v.tone, v.ring, v.label], ['Take the Ecstasy', 'Take the Ecstasy', 'red', true, 'Jump · finish before 12:30']);
    assert.match(v.cardSub, /^then train it all · about \+[\d,]+ · 1,000 energy$/);
    assert.deepEqual(v.checklist.map((c) => [c.text.split(':')[0], c.done, c.next]), [['EDVD × 5', true, false], ['Take the Ecstasy', false, true], ['Train it all', false, false], ['Refill, then train again', false, false]]);
});

const rings = (node) => byClass(node, 'ring');
const buttons = (node) => node.all((n) => n.tagName === 'a' && byClass(n, 'btn').length).map((n) => n.textContent + (byClass(n, 'primary').length ? '*' : ''));

test('Home, a step due: one rail, its actions under the step of the moment, one ring (on the action to do now)', () => {
    const m = model('steady', { energy: 20 });
    assert.equal(m.next.kind, 'xanax');
    assert.ok(m.next.at <= NOW);
    const lead = renderHome(m, ctx).main[0];
    const rail = byClass(lead, 'rail');
    assert.equal(rail.length, 1);
    assert.equal(rail[0].attrs['data-rail'], 'due');
    assert.equal(lead.all((n) => n.tagName === 'table').length, 0, 'no step table and no separate band');
    assert.equal(byClass(lead, 'nowb').length, 0);
    const subs = byClass(lead, 'subr')[0].children;
    assert.equal(subs.length, 2);
    assert.match(subs[0].textContent, /^Take Xanax #1Step 1 of 2 · \+250 energy$/);
    assert.match(subs[1].textContent, /^Train [A-Z]{3} × \d+ · .+ · about \+[\d,]+ · 270 energy$/);
    assert.equal(rings(lead).length, 1, 'one ring per surface, never two');
    assert.equal(rings(subs[0]).length, 1, 'on the action of the moment');
    assert.match(byClass(lead, 'nb')[0].textContent, /NOW/);
    assert.deepEqual(buttons(lead), ['Items*', 'Open the gym'], 'the first button follows the action of the moment');
    // The later steps hang on the same rail, each with when it comes.
    const later = rail[0].children.slice(1);
    assert.ok(later.length >= 1);
    assert.match(later[0].textContent, /in \d/);
});

test('Home, nothing due: "Nothing due now · Next at …" with the countdown; a countdown never rings; no buttons', () => {
    const m = model('steady', { energy: 20, drug: 5 * 3600 });
    assert.ok(m.next.at > NOW);
    const lead = renderHome(m, ctx).main[0];
    assert.equal(byClass(lead, 'rail')[0].attrs['data-rail'], 'wait');
    const nb = byClass(lead, 'nb')[0];
    assert.match(nb.textContent, /^Nothing due nowNext at \d\d:\d\d: (take Xanax #\d, then train|train) [A-Z]{3} × \d+ · /);
    assert.match(nb.textContent, /next at \d\d:\d\d$/);
    assert.ok(byClass(nb, 'cd').length === 1 && byClass(nb, 'cd')[0].attrs['data-cd'], 'the countdown the page keeps current');
    assert.equal(rings(lead).length, 0);
    assert.deepEqual(buttons(lead), []);
    assert.equal(byClass(lead, 'subr').length, 0);
});

test('Home, a jump mid-way: the eaten EDVD ticked, the ring on the Ecstasy, the countdown to the tick, Items first', () => {
    const m = model('edvdJump', { energy: 1000, happy: 16500, booster: 30 * 3600, refillUsed: false });
    const lead = renderHome(m, { ...ctx, plan: { strategy: 'edvdJump', build: friend.build } }).main[0];
    const subs = byClass(lead, 'subr')[0].children;
    assert.deepEqual(subs.map((li) => li.attrs.class || ''), ['done', 'now', '', '']);
    assert.match(subs[0].textContent, /^EDVD × 5 · happy 16,500$/);
    assert.match(subs[1].textContent, /^Take the EcstasyStep 2 of 4 · doubles your happy: 16,500 → 33,000$/);
    assert.equal(subs[0].all((n) => n.tagName === 'svg').length, 1, 'a tick on the one that is done');
    assert.equal(rings(lead).length, 1);
    assert.equal(rings(subs[1]).length, 1);
    const side = byClass(lead, 'side')[0];
    assert.equal(byClass(side, 'cd')[0].attrs['data-cd'], String(TICK));
    assert.match(side.textContent, /until 12:30, when happy resets/);
    assert.doesNotMatch(side.textContent, /NOW/);
    assert.deepEqual(buttons(lead), ['Items*', 'Open the gym']);
});

test('Home, overdosed: the rail\'s point is the plate with the ring (fly to Switzerland is the thing to do); flying: nothing rings', () => {
    const od = model('steady', { energy: 0, happy: 0, drug: 22 * 3600 }, { overdose: { at: NOW - HOUR, until: NOW + 22 * HOUR } });
    const lead = renderHome(od, ctx).main[0];
    const rail = byClass(lead, 'rail')[0];
    assert.equal(rail.children.length, 1, 'no steps on the rail');
    assert.equal(rings(lead).length, 1);
    assert.equal(rings(byClass(rail, 'node')[0]).length, 1, 'the ring is the rail\'s point, not a second plate in the box');
    assert.match(lead.textContent, /Overdosed · fly to Switzerland/);
    const S = Math.floor(NOW / 1000);
    const api = { ...apiOf(friend, { energy: 60 }), travel: { destination: 'Torn', method: 'Airstrip', departed_at: S - 3600, arrival_at: S + 43 * 60, time_left: 43 * 60 } };
    const fly = buildModel({ state: normalizeState(api, NOW), statics: {}, plan: { strategy: 'steady', build: friend.build, goal: null }, settings: { horizonDays: 30 }, now: NOW });
    assert.ok(fly.away && fly.away.flying);
    const lead2 = renderHome(fly, ctx).main[0];
    assert.equal(rings(lead2).length, 0, 'nothing you can do until you land');
    assert.equal(byClass(lead2, 'rail')[0].children.length, 1);
    assert.match(byClass(lead2, 't')[0].textContent, /^12:59$/, 'the rail\'s time is when you are back');
    assert.equal(byClass(byClass(lead2, 'big')[0], 'cd')[0].attrs['data-cd'], String(NOW + 43 * MIN), 'the countdown beside the words');
});

/** The property names inside one @keyframes block. */
function keyframeProps(css, name) {
    const from = css.indexOf('@keyframes ' + name + ' {');
    assert.ok(from >= 0, name + ' is defined');
    const block = css.slice(from, css.indexOf('\n', from));
    return [...new Set([...block.matchAll(/([a-z-]+)\s*:/g)].map((x) => x[1]))].sort();
}

test('the ring moves with opacity and transform only, and is held still under "reduce motion" and with Animations off', () => {
    assert.deepEqual(keyframeProps(APP_CSS, 'pi-ring'), ['opacity', 'transform']);
    assert.deepEqual(keyframeProps(OVERLAY_CSS, 'pi-ring-in'), ['opacity', 'transform']);
    // The webpage: the PC's setting, and Settings › Animations (app.js puts .still on the root).
    assert.match(APP_CSS, /@media \(prefers-reduced-motion: reduce\) \{ \.pl\.ring::after \{ animation: none; opacity: \.55; transform: scale\(1\.7\); \} \}/);
    assert.match(APP_CSS, /\.pi-root\.still \.pl\.ring::after \{ animation: none; opacity: \.55; transform: scale\(1\.7\); \}/);
    // The panel on Torn's pages (its own shadow root): the same two switches.
    assert.match(OVERLAY_CSS, /@media \(prefers-reduced-motion: reduce\) \{ \.plate\.ring::after \{ animation: none; opacity: \.55; transform: scale\(1\.3\); \} \}/);
    assert.match(OVERLAY_CSS, /\.wrap\.still \.plate\.ring::after \{ animation: none; opacity: \.55; transform: scale\(1\.3\); \}/);
    // The ring is drawn only where the mark says so: no ring without the class.
    assert.doesNotMatch(APP_CSS, /\.pl::after/);
    assert.doesNotMatch(OVERLAY_CSS, /\.plate::after/);
});
