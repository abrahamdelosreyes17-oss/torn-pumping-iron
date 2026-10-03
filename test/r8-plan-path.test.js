/*
 * Session 9, the owner's pick A of mockups/round8/plan-path.html: the Plan
 * page shows the path as what is recommended. The plan card says "your path"
 * with Now and Next, each month names the plans it follows, Recommended is
 * the table of stretches, and every single plan is listed as "one plan the
 * whole way" and can be followed (the best of them too, which could not be
 * clicked before: the friend's report).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { PLAYERS, T0, DAY, useClock, setNow, setup, noPause, fakeDocument } from './support/ref.mjs';
import { pathStretches, monthPlans, pathWhy } from '../src/core/saved-plan.js';
import { pi, refresh, createPlan, followStrategy, followPath } from '../src/runtime.js';
import { getPlan, getSettings, getPrices } from '../src/platform/store.js';
import { STRATEGIES } from '../src/core/strategies.js';

useClock(T0);
globalThis.document = fakeDocument();
const { renderPlan, wholeWayWarning } = await import('../src/ui/app/plan.js');

const esc = (x) => x.replace(/[+.()]/g, '\\$&');
const seg = (from, days, strategy, gained, cost, extra = {}) => ({ from: T0 + from * DAY, to: T0 + (from + days) * DAY, days, strategy, gained, cost, ...extra });

test('the path’s stretches: the same plan in a row is one stretch, its days, gain and cost added', () => {
    const list = pathStretches([seg(0, 12, 'consoleJump', 10, 100), seg(12, 3, 'consoleJump', 5, 20), seg(15, 15, 'steadyLite', 7, 30, { xanaxPerDay: 1 }), seg(30, 30, 'steadyLite', 9, 40, { xanaxPerDay: 2, joined: [26] }), seg(60, 30, 'consoleJump', 1, 1)]);
    assert.deepEqual(list.map((x) => [x.strategy, x.days, x.gained, x.cost]), [['consoleJump', 15, 15, 120], ['steadyLite', 45, 16, 70], ['consoleJump', 30, 1, 1]]);
    assert.deepEqual(list[1].xanax, [1, 2]);
    assert.deepEqual(list[1].joined, [26]);
    assert.equal(list[0].to, T0 + 15 * DAY);
    assert.deepEqual(pathStretches(null), []);
});

test('the plans a month follows: those that take 5 days or more of it, in order; the longest when none does', () => {
    const st = pathStretches([seg(0, 12, 'consoleJump', 1, 1), seg(12, 18, 'chocoJump', 1, 1), seg(30, 3, 'steady', 1, 1), seg(33, 60, 'candyXanax', 1, 1)]);
    assert.deepEqual(monthPlans(st, T0, T0 + 31 * DAY), ['consoleJump', 'chocoJump'], 'one day of steady is not named');
    assert.deepEqual(monthPlans(st, T0 + 31 * DAY, T0 + 61 * DAY), ['candyXanax']);
    assert.deepEqual(monthPlans(st, T0 + 30 * DAY, T0 + 33 * DAY), ['steady'], 'nothing takes 5 days: the longest');
    assert.deepEqual(monthPlans(st, T0 - 30 * DAY, T0), [], 'a month before the path starts');
});

test('why the path is the pick, from its numbers; when one plan the whole way gains more the page says so', () => {
    const path = { gained: 43.3e6, cost: 1.22e9 };
    const a = pathWhy({ path, budget: 1.46e9, pickBy: 'most', single: { gained: 18.1e6, cost: 1.38e9 }, singleName: 'Steady, fewer Xanax' });
    assert.equal(a.wins, true);
    assert.equal(a.text, 'the most stats inside your $1.46B: +43.3M for $1.22B. The best single plan inside it, Steady, fewer Xanax, gains +18.1M for $1.38B.');
    const b = pathWhy({ path, budget: null, pickBy: 'max', single: { gained: 30e6, cost: 5e9 }, singleName: 'Steady + FHC, max' });
    assert.equal(b.text, 'the most stats: +43.3M for $1.22B. The best single plan, Steady + FHC, max, gains +30M for $5B.');
    const c = pathWhy({ path, budget: 1.46e9, pickBy: 'most', single: { gained: 50e6, cost: 1.4e9 }, singleName: 'Candy + Xanax' });
    assert.equal(c.wins, false);
    assert.match(c.text, /^The path: \+43\.3M for \$1\.22B\. Candy \+ Xanax the whole way gains more, \+50M for \$1\.4B/);
    const d = pathWhy({ path, budget: 1.46e9, pickBy: 'most', single: { gained: 50e6, cost: 2e9 }, singleName: 'Candy + Xanax' });
    assert.equal(d.wins, true, 'a plan over the budget does not beat the path');
    assert.match(d.text, /No single plan fits it; the closest, Candy \+ Xanax, gains \+50M for \$2B\.$/);
    assert.match(pathWhy({ path: { gained: 1e6, cost: 1.5e9 }, budget: 1.46e9, pickBy: 'most' }).text, /It ends \$40M over that/);
});

test('leaving the path asks once, with the numbers', () => {
    const path = { gained: 43.3e6, cost: 1.22e9 };
    const less = wholeWayWarning({ gained: 18.1e6, cost: 1.38e9 }, 'Steady, fewer Xanax', path, { budget: 1.46e9, days: 365 });
    assert.equal(less.title, 'Steady, fewer Xanax the whole way gains less than the path');
    assert.match(less.text, /^365 days: about \+18\.1M stats, against \+43\.3M on the path, and \$160M more\./);
    const over = wholeWayWarning({ gained: 171e6, cost: 2.52e9 }, 'Candy + Xanax', path, { budget: 1.46e9, days: 365 });
    assert.equal(over.title, 'Candy + Xanax the whole way is over your budget');
    assert.match(over.text, /Over your \$1\.46B budget by \$1\.06B\./);
});

/** The Plan page from the real saved plan, as the webpage draws it. */
function page(ui = {}) {
    refresh();
    const m = pi.model;
    const calls = [];
    const ctx = { model: m, settings: getSettings(), plan: { ...getPlan(), strategy: m.strategy }, statics: {}, prices: getPrices(), compare: m.compare, ui, planLines: [], setPlan: (p) => calls.push(['setPlan', p]), followPath: () => calls.push(['followPath']), setSettings: () => {}, rerender: () => calls.push(['rerender']), go: () => {}, wantPrices: () => {}, recalibratePlan: () => {} };
    const out = renderPlan(m, ctx);
    const root = { children: [...out.main, ...out.pane].filter(Boolean) };
    const all = (pred, node = root, acc = []) => {
        for (const c of node.children || []) {
            if (c && c.tagName) {
                if (pred(c)) acc.push(c);
                all(pred, c, acc);
            }
        }
        return acc;
    };
    const text = out.main.filter(Boolean).map((n) => n.textContent).join('\n');
    return { m, ctx, calls, all, text, out };
}

test('the friend, 3 months at $5M a day: the card says "your path" with Now and Next, the months name their plans, Recommended lists the stretches', async () => {
    setNow(T0);
    setup(PLAYERS.friend, { plan: { pickBy: 'most', pickByPicked: true }, settings: { budget: 150e6, horizonDays: 30 } });
    const saved = await createPlan({ months: 3, pause: noPause });
    const stretches = pathStretches(saved.year.segments);
    const p = page();
    assert.match(p.text, /3-month plan · your path/);
    assert.match(p.text, new RegExp(stretches.length + ' stretches'));
    assert.match(p.text, new RegExp('Now ' + esc(STRATEGIES[stretches[0].strategy].short) + ', day 1 of ' + stretches[0].days + ' · then ' + esc(STRATEGIES[stretches[1].strategy].short) + ' from '));
    assert.match(p.text, /the plan each month follows · total stats planned at its end/);
    const months = p.all((n) => /\bmo\b/.test(n.attrs.class || ''));
    assert.equal(months.length, 3);
    assert.match(months[0].textContent, new RegExp(esc(STRATEGIES[stretches[0].strategy].short)));
    // Recommended: the path, a row for each stretch, the line under the one you are in, the whole plan at the foot.
    assert.match(p.text, /Recommended/);
    assert.match(p.text, /The best plan for each stretch/);
    const trs = p.all((n) => n.tagName === 'tr');
    const here = trs.filter((n) => /you are here/.test(n.textContent));
    assert.ok(here.length === 1 && !/^Now: /.test(here[0].textContent));
    assert.equal(here.length, 1);
    assert.match(here[0].attrs.class, /\bsel\b/);
    assert.ok(trs.some((n) => /^Now: /.test(n.textContent)), 'what you do in the stretch you are in');
    const foot = trs.find((n) => /^Whole plan/.test(n.textContent));
    assert.match(foot.textContent, new RegExp(stretches.length + ' stretches' + saved.days));
    assert.match(p.text, /Wins because: the most stats inside your \$460M: /);
    assert.match(p.text, /You’re on it\./);
    assert.doesNotMatch(p.text, /Your saved plan follows/, 'the grey line that named a plan you were not on is gone');
    assert.doesNotMatch(p.text, /Other plans/);
    // The path's figures are the path's, not the best single plan's.
    const figs = p.all((n) => (n.attrs.class || '') === 'fig').map((n) => n.textContent);
    assert.ok(figs.some((x) => x.includes(saved.days + ' days') && x.includes('+')), figs.join(' | '));
});

test('one plan the whole way: every single plan is a row you can click, the best of them included; a click asks once, then follows it', async () => {
    setNow(T0);
    setup(PLAYERS.friend, { plan: { pickBy: 'most', pickByPicked: true }, settings: { budget: 150e6, horizonDays: 30 } });
    const saved = await createPlan({ months: 3, pause: noPause });
    const best = saved.rec.recommended;
    let p = page();
    assert.match(p.text, /One plan the whole way/);
    assert.match(p.text, /against the path · click a row to follow it/);
    const rows = () => p.all((n) => n.tagName === 'tr' && /\bclick\b/.test(n.attrs.class || ''));
    const bestRow = rows().find((n) => n.textContent.includes(STRATEGIES[best].name) && /best one inside your budget/.test(n.textContent));
    assert.ok(bestRow, 'the best single plan is in the list: ' + rows().map((n) => n.textContent.slice(0, 40)).join(' | '));
    assert.ok(rows().length >= 3);
    assert.ok(rows().every((n) => /Inside it|Over by \$/.test(n.textContent)), 'each row says whether it is inside your budget');
    assert.ok(!rows().some((n) => /current plan/.test(n.textContent)), 'on the path, no single plan is the current one');
    // A click: the warning, nothing followed yet.
    const ui = {};
    p = page(ui);
    rows().find((n) => n.textContent.includes(STRATEGIES[best].name)).listeners.click();
    assert.equal(ui.planPick, best);
    assert.deepEqual(p.calls, [['rerender']]);
    p = page(ui);
    assert.match(p.text, new RegExp(esc(STRATEGIES[best].name) + ' the whole way (gains less than the path|is over your budget|is not the path)'));
    assert.match(p.text, /picked · see the warning/);
    const btn = (label) => p.all((n) => n.tagName === 'button' && n.textContent === label)[0];
    assert.ok(btn('Keep the path'));
    btn('Use it anyway').listeners.click();
    assert.deepEqual(p.calls, [['setPlan', { strategy: best, strategyPicked: true }]]);
    assert.equal(ui.planPick, null);
    // Followed: the card says so, its row is the current plan, and the path can be taken back.
    followStrategy(best);
    p = page();
    assert.match(p.text, new RegExp('3-month plan · ' + esc(STRATEGIES[best].name)));
    assert.match(p.text, /Following .* the whole way, your pick/);
    assert.ok(rows().find((n) => n.textContent.includes(STRATEGIES[best].name) && /current plan/.test(n.textContent)));
    assert.doesNotMatch(p.text, /You’re on it\./);
    assert.ok(!p.all((n) => n.tagName === 'tr').some((n) => /you are here/.test(n.textContent)), 'no stretch is marked: you are not on the path');
    btn('Use the path').listeners.click();
    assert.deepEqual(p.calls, [['followPath']]);
    followPath();
    p = page();
    assert.match(p.text, /3-month plan · your path/);
    assert.match(p.text, /You’re on it\./);
});

test('the chart: the path is the recommended line, beside one plan the whole way', async () => {
    setNow(T0);
    setup(PLAYERS.friend, { plan: { pickBy: 'most', pickByPicked: true }, settings: { budget: 150e6, horizonDays: 30 } });
    await createPlan({ months: 3, pause: noPause });
    const p = page();
    const pane = p.out.pane.filter(Boolean).map((n) => n.textContent).join('\n');
    assert.match(pane, /the path/);
    assert.match(pane, /one plan the whole way/);
    assert.match(pane, /far over your budget (is|are) left off the chart/);
});
