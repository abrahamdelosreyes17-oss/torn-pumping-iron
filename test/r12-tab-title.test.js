/*
 * Round 9, the owner's pick 4B (mockups/round9/companion.html §4): the webpage's tab reads "Pumping Iron" until the
 * last ten minutes before the next step, then counts down ("3:52 · Xanax #2 · Pumping Iron"), then says "Now".
 * Never on Torn's pages: only src/ui/app/app.js (the webpage) sets a title.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { tabTitle, TAB_TITLE } from '../src/core/tabtitle.js';

const NOW = Date.UTC(2026, 9, 5, 10);
const step = (inMs) => ({ at: NOW + inMs, label: 'Xanax #2 · train DEX × 27' });
const m = (inMs, more = {}) => ({ ready: true, next: step(inMs), steps: [step(inMs)], ...more });

test('plain until the last ten minutes', () => {
    assert.equal(TAB_TITLE, 'Pumping Iron');
    assert.equal(tabTitle(m(2 * 3600e3), NOW), 'Pumping Iron');
    assert.equal(tabTitle(m(10 * 60e3 + 1000), NOW), 'Pumping Iron');
});

test('the countdown and the step in the last ten minutes', () => {
    assert.equal(tabTitle(m(10 * 60e3), NOW), '10:00 · Xanax #2 · Pumping Iron');
    assert.equal(tabTitle(m(232e3), NOW), '3:52 · Xanax #2 · Pumping Iron');
    assert.equal(tabTitle(m(1000), NOW), '0:01 · Xanax #2 · Pumping Iron');
});

test('"Now" once the step is due', () => {
    assert.equal(tabTitle(m(0), NOW), 'Now · Xanax #2 · Pumping Iron');
    assert.equal(tabTitle(m(-5 * 60e3), NOW), 'Now · Xanax #2 · Pumping Iron');
});

test('no step to do: plain (nothing left today, no state, stacking, an overdose, away, Torn Trading\'s turn)', () => {
    assert.equal(tabTitle({ ready: true, next: null, steps: [] }, NOW), 'Pumping Iron');
    assert.equal(tabTitle(null, NOW), 'Pumping Iron');
    assert.equal(tabTitle({ ready: false }, NOW), 'Pumping Iron');
    assert.equal(tabTitle(m(0, { stacking: { since: NOW } }), NOW), 'Pumping Iron');
    assert.equal(tabTitle(m(0, { overdose: { at: NOW } }), NOW), 'Pumping Iron');
    assert.equal(tabTitle(m(0, { away: { flying: true } }), NOW), 'Pumping Iron');
    assert.equal(tabTitle(m(0), NOW, { paused: true }), 'Pumping Iron');
});

test('only the webpage sets a title: nothing that runs on Torn\'s pages touches document.title', () => {
    const files = [];
    const walk = (dir) => {
        for (const f of readdirSync(dir)) {
            const p = join(dir, f);
            if (statSync(p).isDirectory()) walk(p);
            else if (p.endsWith('.js')) files.push(p);
        }
    };
    walk('src');
    const setters = files.filter((p) => /document\.title\s*=/.test(readFileSync(p, 'utf8'))).map((p) => p.replace(/\\/g, '/'));
    assert.deepEqual(setters, ['src/ui/app/app.js']);
});
