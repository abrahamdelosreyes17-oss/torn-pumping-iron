/*
 * Round 7, Home's "Stacking for a chain" (the owner's pick in mockups/round7/home.html): the flag kept in GM for
 * every tab, the model's `m.stacking = {since}`, Home in both states, Resume re-planning at once (Re-plan's run),
 * and the bot's plan saying `chain` with no steps.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

class El {
    constructor(tag) {
        this.tagName = tag;
        this.children = [];
        this.attrs = {};
        this.own = '';
        this.listeners = {};
    }
    setAttribute(k, v) {
        this.attrs[k] = v;
    }
    getAttribute(k) {
        return this.attrs[k];
    }
    appendChild(c) {
        this.children.push(c);
        return c;
    }
    addEventListener(e, f) {
        (this.listeners[e] = this.listeners[e] || []).push(f);
    }
    querySelector() {
        return null;
    }
    set textContent(v) {
        this.own = String(v);
        this.children = [];
    }
    get textContent() {
        return this.own + this.children.map((c) => c.textContent).join('');
    }
    all(pred, out = []) {
        if (pred(this)) out.push(this);
        for (const c of this.children) if (c instanceof El) c.all(pred, out);
        return out;
    }
}
globalThis.document = { createElement: (t) => new El(t), createElementNS: (ns, t) => new El(t), createTextNode: (s) => ({ textContent: String(s) }), visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };

const { K, get, set, getStacking, setStacking, DATA_GROUPS } = await import('../src/platform/store.js');
const { pi, currentModel, setWhere, startStacking, resumeTraining, createPlan, cancelPlan } = await import('../src/runtime.js');
const { buildModel } = await import('../src/core/model.js');
const { normalizeState } = await import('../src/core/bars.js');
const { renderHome, chainCard, trainingHead } = await import('../src/ui/app/home.js');
const { planPayload } = await import('../src/discord.js');

const T0 = Date.UTC(2026, 8, 29, 10, 48);
const API = {
    bars: { energy: { current: 1000, maximum: 150, increment: 5, interval: 600, tick_time: 120, full_time: 0 }, happy: { current: 5025, maximum: 5025, increment: 5, interval: 900, tick_time: 300, full_time: 0 } },
    cooldowns: { drug: 232, medical: 0, booster: 0 },
    refills: { energy: false, nerve: false, token: false, special_count: 0 },
    battlestats: { strength: { value: 118400 }, defense: { value: 96200 }, speed: { value: 110900 }, dexterity: { value: 82700 }, total: 408200 },
    gym: { id: 18, name: 'Gun Shop' },
};
const PLAN = { type: 'steady', strategy: 'steady', build: 'baldr', buildPicked: true, strategyPicked: false, pickBy: 'most', createdAt: 1 };

function model(stacking, api = API, now = T0) {
    return buildModel({ state: normalizeState(api, now), statics: {}, plan: PLAN, settings: { horizonDays: 30, budget: 150e6 }, stacking, now });
}

function ctxFor(calls = []) {
    return { settings: { timeFormat: 'torn' }, prices: {}, statics: {}, ui: {}, plan: PLAN, go: () => {}, startStacking: () => calls.push('start'), resumeStacking: () => calls.push('resume') };
}

const text = (nodes) => nodes.map((n) => (n ? n.textContent : '')).join(' | ');
const click = (node) => node.listeners.click.forEach((f) => f());

test('the flag: kept in GM across tabs and reloads, since the first press; Resume removes it', () => {
    setStacking(false);
    assert.equal(getStacking(), null);
    assert.deepEqual(setStacking(true, T0), { since: T0 });
    assert.deepEqual(get(K.stacking), { since: T0 }, 'stored as {since} under its own GM key (every tab gets its change event)');
    assert.equal(K.stacking, 'stackingChain');
    assert.deepEqual(setStacking(true, T0 + 60e3), { since: T0 }, 'a second press keeps when it began');
    assert.deepEqual(getStacking(), { since: T0 });
    set(K.stacking, { since: 'x' });
    assert.equal(getStacking(), null, 'a damaged value reads as off');
    setStacking(true, T0);
    assert.equal(setStacking(false), null);
    assert.equal(get(K.stacking, null), null);
    assert.ok(DATA_GROUPS.plan.includes(K.stacking), 'Settings › Your data › Plan clears it too');
});

test('the model carries m.stacking = {since} (null while training), on the webpage and on Torn\'s pages', () => {
    assert.equal(model(null).stacking, null);
    assert.deepEqual(model({ since: T0 - 3600e3 }).stacking, { since: T0 - 3600e3 });
    assert.ok(model({ since: T0 }).steps.length, 'the steps stay in the model: each surface holds them back');
    set(K.userState, { api: API, at: Date.now() });
    set(K.plan, PLAN);
    for (const where of ['app', 'torn']) {
        setWhere(where);
        setStacking(false);
        assert.equal(currentModel().stacking, null, where + ': off');
        const v = startStacking();
        assert.deepEqual(currentModel().stacking, v, where + ': on, read from the store');
    }
    setStacking(false);
    setWhere('app');
});

test('Home, training: the pane starts with "Training · Stacking energy for a chain? [I\'m stacking]"', () => {
    const calls = [];
    const m = model(null);
    const out = renderHome(m, ctxFor(calls));
    const card = out.pane[0];
    assert.equal(card.attrs['data-chain'], 'off');
    assert.match(card.textContent, /^Training/);
    assert.match(card.textContent, /Stacking energy for a chain\?/);
    const btn = card.all((n) => n.tagName === 'button')[0];
    assert.equal(btn.textContent, 'I’m stacking');
    click(btn);
    assert.deepEqual(calls, ['start']);
    assert.doesNotMatch(text(out.main), /Stacking for a chain/);
    assert.equal(out.main[0].all((n) => n.tagName === 'table').length, 1, "today's steps are listed");
});

test('Home, stacking: Today says what waits (real energy numbers) instead of the steps; the card shows Resume', () => {
    const calls = [];
    const m = model({ since: T0 - 2 * 3600e3 - 46 * 60e3 });
    const out = renderHome(m, ctxFor(calls));
    const lead = out.main[0];
    const t = lead.textContent;
    assert.match(t, /training paused/);
    assert.match(t, /Stacking for a chain/);
    assert.match(t, /No training steps until you resume/);
    assert.match(t, /No Discord pings about energy or training/);
    assert.match(t, /Energy now 1,000 \/ 150, kept for the chain/);
    assert.equal(lead.all((n) => n.tagName === 'table').length, 0, 'no step table');
    assert.doesNotMatch(t, /Open the gym|then train|NOW/, 'no training step anywhere in Today');
    assert.doesNotMatch(text(out.main), /Next 48 h/, 'no look-ahead of training steps');
    assert.doesNotMatch(text(out.main), /today every train goes to/);
    const card = out.pane[0];
    assert.equal(card.attrs['data-chain'], 'on');
    assert.match(card.textContent, /Stacking since 08:02/);
    const resume = card.all((n) => n.tagName === 'button')[0];
    assert.equal(resume.textContent, 'Resume');
    click(resume);
    click(lead.all((n) => n.tagName === 'button' && n.textContent === 'Resume and re-plan')[0]);
    assert.deepEqual(calls, ['resume', 'resume']);
    // A stack begun yesterday says its day.
    assert.match(chainCard(model({ since: T0 - 20 * 3600e3 }), ctxFor()).textContent, /Stacking since Mon 14:48/);
});

test('Home, stacking: heads-up lines that ask you to train or use energy are held back', () => {
    assert.ok(trainingHead({ text: 'Refill unused' }));
    assert.ok(trainingHead({ text: 'In 4 min: Xanax #3 · right after the tick' }));
    assert.ok(trainingHead({ text: 'No candy today · booster cooldown 3h' }));
    assert.ok(trainingHead({ text: 'No boosters before 18:00 TCT' }));
    assert.ok(!trainingHead({ text: 'Pick your build type' }));
    // Late in the Torn day the refill is unused: training says so, stacking doesn't.
    const late = Date.UTC(2026, 8, 29, 23, 0);
    const api = { ...API, bars: { ...API.bars, energy: { ...API.bars.energy, current: 20 } } };
    const heads = (st) => renderHome(model(st, api, late), ctxFor()).pane.find((n) => /Heads-up/.test(n.textContent)).textContent;
    assert.match(heads(null), /Refill unused/);
    assert.doesNotMatch(heads({ since: late - 60e3 }), /Refill unused/);
});

test('Home: Re-plan running after Resume shows the Plan card\'s bar with its light sweep', () => {
    const m = { ...model(null), planBusy: { recalibrate: true, at: T0, done: 0.3, words: 'Comparing plans' } };
    const out = renderHome(m, ctxFor());
    const run = out.main[0].all((n) => n.attrs.class === 'planrun')[0];
    assert.ok(run, 'the .planrun bar (styles.js: the 2A sweep, still with Settings › Animations off)');
    assert.equal(run.all((n) => n.attrs['data-plan-bar'])[0].attrs.style, 'width:30%');
    assert.equal(run.all((n) => n.attrs.role === 'progressbar')[0].attrs['aria-label'], 'Re-planning');
    assert.ok(out.pane[0].all((n) => n.tagName === 'button')[0].attrs.disabled !== undefined, "I'm stacking waits for the run");
});

test('Resume clears the flag and re-plans at once (the Re-plan run); with no plan to re-plan, the steps just come back', async () => {
    set(K.userState, { api: API, at: Date.now() });
    set(K.plan, PLAN);
    for (const k of [K.planNow, 'savedPlanFull', K.planLine]) set(k, null);
    pi.saved = null;
    pi.planBusy = null;
    setWhere('app');
    startStacking();
    assert.equal(await resumeTraining(), null, 'no saved plan: nothing to re-plan');
    assert.equal(getStacking(), null);
    // A saved plan: Resume starts the same run as Re-plan (recalibrate), right away.
    const pause = () => Promise.resolve();
    await createPlan({ months: 1, pause });
    startStacking();
    const p = resumeTraining({ pause });
    assert.equal(getStacking(), null, 'off before the run starts');
    assert.ok(pi.planBusy && pi.planBusy.recalibrate === true, 'the Re-plan run is under way at once');
    assert.equal(currentModel().planBusy.recalibrate, true, 'the model says so (Home draws the bar)');
    const saved = await p;
    assert.ok(saved && saved.recalibratedAt, 'the plan was re-planned');
    assert.equal(currentModel().stacking, null);
});

test('the bot\'s plan: chain {since} in seconds and no steps while stacking; the training plan as before after', () => {
    const on = planPayload(model({ since: T0 }));
    assert.deepEqual(on, { type: 'jump', noRefill: true, steps: [], chain: { since: T0 / 1000 } });
    const off = planPayload(model(null));
    assert.equal(off.chain, undefined);
    assert.equal(off.chain, undefined);
    assert.ok(off.steps.length > 0);
});
