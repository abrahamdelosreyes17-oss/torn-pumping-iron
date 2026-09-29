/*
 * The webpage's decisions that aren't drawing: buy windows, plan-vs-actual
 * colours, step words.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { needsForWindow } from '../src/ui/app/buy.js';
import { planColor, receiptsCard, whatIfCard, whatIfSummary, whatIfShown } from '../src/ui/app/progress.js';
import { recordChange, receiptChange } from '../src/core/receipts.js';
import { normalizeState, diffStates, DAY } from '../src/core/bars.js';
import { playerContext, buildOf } from '../src/core/model.js';
import { stepWords } from '../src/ui/app/home.js';
import { XANAX, POINTS } from '../src/core/items.js';

const T0 = Date.UTC(2026, 8, 29, 10, 48);
const model = { now: T0, steps: [{ at: T0 + 180e3, items: [{ id: XANAX, qty: 1 }] }, { at: T0 + 480e3, items: [{ id: POINTS, qty: 30 }] }, { at: T0 + 7 * 3600e3, items: [{ id: XANAX, qty: 1 }] }] };
const compare = { steady: { used: { [XANAX]: 103, [POINTS]: 900 } } };

test('buy windows: today from the timeline, later days at the plan\'s daily average', () => {
    assert.deepEqual(needsForWindow(model, compare, { strategy: 'steady' }, 'today', 30), { [XANAX]: 2, [POINTS]: 30 });
    const three = needsForWindow(model, compare, { strategy: 'steady' }, 'three', 30);
    assert.equal(three[XANAX], Math.ceil(2 + (103 / 30) * 2));
    assert.equal(three[POINTS], 90);
    assert.equal(needsForWindow(model, compare, { strategy: 'steady' }, 'week', 30)[POINTS], 210);
    assert.deepEqual(needsForWindow(model, null, { strategy: 'steady' }, 'week', 30), { [XANAX]: 2, [POINTS]: 30 }, 'no comparison yet: today only');
});

test('plan-vs-actual colours (TrainingPeaks): green ±20%, yellow 50–79% / 121–150%, red further', () => {
    assert.equal(planColor(1), 'good');
    assert.equal(planColor(0.8), 'good');
    assert.equal(planColor(1.2), 'good');
    assert.equal(planColor(0.79), 'warn');
    assert.equal(planColor(0.5), 'warn');
    assert.equal(planColor(1.3), 'warn');
    assert.equal(planColor(1.5), 'warn');
    assert.equal(planColor(0.42), 'bad');
    assert.equal(planColor(1.51), 'bad');
});

test('the next step in words', () => {
    assert.equal(stepWords({ kind: 'xanax', label: 'Xanax #2', trains: { dex: 27 } }), 'Take Xanax #2, then train DEX × 27');
    assert.equal(stepWords({ kind: 'refill', label: 'Refill · 30 points', trains: { dex: 15 } }), 'Use your refill, then train DEX × 15');
    assert.equal(stepWords({ kind: 'natural', label: 'Natural energy', trains: { def: 8, dex: 7 } }), 'Train DEF × 8 · DEX × 7');
    assert.equal(stepWords({ kind: 'stack', label: "Xanax #2 of 4 · don't train", trains: {} }), "Take Xanax #2 of 4 · don't train");
    assert.equal(stepWords({ kind: 'jump', label: 'EDVD × 5 + Ecstasy, then train it all', trains: { str: 102 } }), 'EDVD × 5 + Ecstasy, then train STR × 102');
});

/* ---------- Progress › Receipts and the what-if graph, rendered on a tiny fake DOM ---------- */

function fakeDocument() {
    class Node {
        constructor(tag) {
            this.tagName = tag;
            this.attrs = {};
            this.children = [];
            this.listeners = {};
            this.text = '';
            this.classList = { add: (c) => (this.attrs.class = ((this.attrs.class || '') + ' ' + c).trim()) };
        }
        setAttribute(k, v) {
            this.attrs[k] = String(v);
        }
        getAttribute(k) {
            return this.attrs[k] ?? null;
        }
        appendChild(c) {
            this.children.push(c);
            return c;
        }
        addEventListener(ev, fn) {
            this.listeners[ev] = fn;
        }
        set textContent(v) {
            this.children = [];
            this.text = String(v);
        }
        get textContent() {
            return this.text + this.children.map((c) => c.textContent).join('');
        }
        all(pred, out = []) {
            if (pred(this)) out.push(this);
            for (const c of this.children) if (c.all) c.all(pred, out);
            return out;
        }
    }
    return { createElement: (t) => new Node(t), createElementNS: (ns, t) => new Node(t), createTextNode: (s) => ({ textContent: s }) };
}

const rst = (at, o = {}) => normalizeState({ bars: { energy: { current: o.energy ?? 150, maximum: 150, increment: 5, interval: 600, tick_time: 600 }, happy: { current: 5025, maximum: 5025, increment: 5, interval: 900, tick_time: 900 } }, cooldowns: { drug: o.drug || 0 }, refills: { energy: false }, battlestats: { strength: { value: 118400 }, speed: { value: 110900 }, defense: { value: 96200 }, dexterity: { value: o.dex || 82700 } }, gym: { id: 18 } }, at);
const rec = (r, a, b, o) => recordChange(r, receiptChange(a, b, diffStates(a, b)), o);

test('Progress › Receipts: before any record, then today / 7 days / 30 days and a day that opens', () => {
    globalThis.document = fakeDocument();
    let rerendered = 0;
    const ctx = { ui: {}, prices: {}, priceHistory: null, receipts: null, rerender: () => rerendered++ };
    const m = { now: T0, pc: {} };
    let card = receiptsCard(m, ctx);
    assert.match(card.textContent, /Receipts/);
    assert.match(card.textContent, /Receipts start today/);
    ctx.receipts = rec(null, rst(T0), rst(T0 + 30e3, { energy: 0, dex: 85000, drug: 7 * 3600 }), { priceOf: () => 800000 });
    card = receiptsCard(m, ctx);
    const text = card.textContent;
    for (const w of ['Today', '7 days', '30 days', 'Energy trained', '400 E', 'Xanax × 1', '$800,000', '+2,300', '$ per 1,000 stats', 'Energy per 1,000 stats', 'today']) assert.ok(text.includes(w), 'shows ' + w);
    const row = card.all((n) => n.tagName === 'tr' && n.listeners.click)[0];
    row.listeners.click();
    assert.equal(rerendered, 1);
    card = receiptsCard(m, ctx);
    assert.match(card.textContent, /Gun Shop · DEX × 40 \(400 E\)/);
    assert.match(card.textContent, /not seen in your inventory yet/);
    delete globalThis.document;
});

test('Progress › What if: waits for two days, then lines you can switch on and a one-line summary', () => {
    globalThis.document = fakeDocument();
    const state = rst(T0);
    const m = { now: T0 + DAY, state, pc: playerContext(state, {}), shares: buildOf('baldr').shares, recommendation: { recommended: 'steady' } };
    const ctx = { ui: {}, prices: {}, priceHistory: null, settings: { horizonDays: 30, budget: 150e6 }, receipts: null, rerender: () => {} };
    const r = rec(null, rst(T0), rst(T0 + 30e3, { energy: 0, dex: 84000 }));
    ctx.receipts = r;
    assert.match(whatIfCard(m, ctx).textContent, /Receipts start today; the comparison appears after two days/);
    ctx.receipts = rec(r, rst(T0 + DAY, { dex: 84000 }), rst(T0 + DAY + 30e3, { energy: 0, dex: 85300 }));
    const card = whatIfCard(m, ctx);
    const text = card.textContent;
    assert.match(text, /What if you’d done another plan/);
    assert.match(text, /Steady \(recommended\)/);
    assert.match(text, /Steady would have given [+−][\d,]+ over these 2 days/);
    const chips = card.all((n) => n.attrs.class === 'tk');
    assert.ok(chips.length >= 3, 'one chip per plan');
    assert.equal(chips.filter((n) => n.attrs['aria-pressed'] === 'true').length, 1, 'only the recommended plan on by default');
    assert.equal(card.all((n) => n.tagName === 'polyline').length, 2, 'you + the recommended plan');
    chips.find((n) => n.attrs['aria-pressed'] === 'false').listeners.click();
    assert.equal(ctx.ui.whatIfOn.length, 2);
    assert.equal(whatIfCard(m, ctx).all((n) => n.tagName === 'polyline').length, 3, 'a plan switched on is drawn');
    assert.deepEqual(whatIfShown({}, 'steady', ['chocoJump', 'steady']), ['steady']);
    assert.equal(whatIfSummary({ steady: { gained: 1200000 }, chocoJump: { gained: 1500000 } }, ['steady', 'chocoJump'], 14), 'Steady would have given +1,200,000, Choco jump +1,500,000 over these 14 days');
    delete globalThis.document;
});
