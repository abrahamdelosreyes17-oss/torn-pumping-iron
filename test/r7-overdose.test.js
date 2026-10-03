/*
 * The overdose as one shared state (the owner, 2026-10-03, on 1.4.1: Torn's panel said "Overdosed · fly to
 * Switzerland" while Home's Today still said "Train DEX × 6" and ticked the Xanax step Done). It is one GM key
 * (K.overdose), seen from Torn's API answer on the webpage and from the sidebar on Torn's pages; the model carries it
 * as `m.overdose`, and Home, the strip and the bot's plan say the same words with no training steps. "Rehab done"
 * ends it and recalibrates.
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
    querySelector(sel) {
        return this.all((n) => n.tagName === sel)[0] || null;
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

const { K, get, set, DATA_GROUPS } = await import('../src/platform/store.js');
const { pi, currentModel, setWhere, overdoseSeen, overdoseDone } = await import('../src/runtime.js');
const { buildModel } = await import('../src/core/model.js');
const { normalizeState } = await import('../src/core/bars.js');
const { nextOverdose, overdoseOn, planGymPage, gymPanel, OVERDOSE_WORDS } = await import('../src/core/gympage.js');
const { renderHome } = await import('../src/ui/app/home.js');
const { statusStrip } = await import('../src/ui/app/common.js');
const { planPayload } = await import('../src/discord.js');

const HOUR = 3600e3;
const T0 = Date.UTC(2026, 9, 3, 10, 48);
const api = ({ energy = 150, happy = 5025, drug = 232 } = {}) => ({
    bars: { energy: { current: energy, maximum: 150, increment: 5, interval: 600, tick_time: 120, full_time: 0 }, happy: { current: happy, maximum: 5025, increment: 5, interval: 900, tick_time: 300, full_time: 0 } },
    cooldowns: { drug, medical: 0, booster: 0 },
    refills: { energy: false, nerve: false, token: false, special_count: 0 },
    battlestats: { strength: { value: 118400 }, defense: { value: 96200 }, speed: { value: 110900 }, dexterity: { value: 82700 }, total: 408200 },
    gym: { id: 18, name: 'Gun Shop' },
});
// The owner's report: two hours after the overdose the bar has 60 energy again, and the day plan says "Train DEX × 6".
const AFTER = api({ energy: 60, happy: 120, drug: 22 * 3600 });
const PLAN = { type: 'steady', strategy: 'steady', build: 'baldr', buildPicked: true, strategyPicked: false, pickBy: 'most', createdAt: 1 };
const OD = { at: T0 - 2 * HOUR, until: T0 + 22 * HOUR };

function model(overdose, a = AFTER, now = T0) {
    return buildModel({ state: normalizeState(a, now), statics: {}, plan: PLAN, settings: { horizonDays: 30, budget: 150e6 }, overdose, now });
}
const ctxFor = (calls = []) => ({ settings: { timeFormat: 'torn' }, prices: {}, statics: {}, ui: {}, plan: PLAN, go: () => {}, endOverdose: () => calls.push('end') });
const text = (nodes) => nodes.map((n) => (n ? n.textContent : '')).join(' | ');

test('the cause: without the shared state the model plans training on the energy that came back', () => {
    const m = model(null);
    assert.equal(m.overdose, null);
    assert.ok(m.steps.some((s) => Object.keys(s.trains || {}).length), 'the day plan has training steps (what Home showed)');
    assert.match(text(renderHome(m, ctxFor()).main), /Train|then train/);
});

test('the key: one GM key for every tab, cleared with the plan\'s data', () => {
    assert.equal(K.overdose, 'overdose', 'the key Torn\'s pages already wrote in 1.4.0 and 1.4.1');
    assert.ok(DATA_GROUPS.plan.includes(K.overdose));
});

test('the model carries m.overdose = {at, until} while it is on; ended or past its cooldown: null', () => {
    assert.deepEqual(model(OD).overdose, OD);
    assert.ok(model(OD).steps.length, 'the steps stay in the model: each surface holds them back');
    assert.equal(model({ ...OD, ended: T0 - 60e3 }).overdose, null);
    assert.equal(model({ at: T0 - 30 * HOUR, until: T0 - HOUR }).overdose, null);
});

test('seen from Torn\'s API answer (the webpage has no sidebar): bars at 0 with the overdose\'s day-long drug cooldown', () => {
    set(K.overdose, null);
    set(K.plan, PLAN);
    pi.barsSeen = null;
    const now = Date.now();
    for (const where of ['app', 'torn']) {
        setWhere(where);
        set(K.overdose, null);
        set(K.userState, { api: api({ energy: 150, happy: 5025, drug: 232 }), at: now });
        assert.equal(currentModel(now).overdose, null, where + ': a normal state');
        set(K.userState, { api: api({ energy: 0, happy: 0, drug: 24 * 3600 }), at: now });
        const m = currentModel(now);
        assert.ok(m.overdose && m.overdose.at === now && m.overdose.until === now + 24 * HOUR, where + ': seen, until the cooldown it started ends');
        assert.deepEqual(get(K.overdose), { at: now, until: now + 24 * HOUR }, where + ': stored for every tab');
        // Two hours on the bars have climbed by regeneration alone: still overdosed (the owner's "Train DEX × 6").
        set(K.userState, { api: AFTER, at: now + 2 * HOUR });
        assert.ok(currentModel(now + 2 * HOUR).overdose, where + ': 60 energy two hours later is regeneration, not the end');
        // A refill (150 energy at once) is more than regeneration gives: over.
        set(K.userState, { api: api({ energy: 210, happy: 120, drug: 21 * 3600 }), at: now + 2 * HOUR + 60e3 });
        assert.equal(currentModel(now + 2 * HOUR + 60e3).overdose, null, where + ': a refill ends it');
    }
    setWhere('app');
    set(K.overdose, null);
});

test('a read from before Torn\'s page saw it does not clear it', () => {
    const now = Date.now();
    setWhere('app');
    set(K.overdose, { at: now, until: now + 24 * HOUR });
    set(K.userState, { api: api({ energy: 150, happy: 5025, drug: 232 }), at: now - 20e3 });
    assert.ok(currentModel(now + 1000).overdose, 'the answer is 20 s older than the overdose');
    assert.deepEqual(get(K.overdose), { at: now, until: now + 24 * HOUR });
    set(K.overdose, null);
});

test('Torn\'s pages and the webpage share it: what one sees the other reads (overdoseSeen)', () => {
    const now = Date.now();
    set(K.overdose, null);
    const zero = { happy: { current: 0, max: 5025 }, energy: { current: 0, max: 150 }, drugLeft: 24 * HOUR };
    const od = overdoseSeen(zero, now, null);
    assert.deepEqual(od, { at: now, until: now + 24 * HOUR });
    set(K.userState, { api: AFTER, at: now + 2 * HOUR });
    setWhere('app');
    assert.deepEqual(currentModel(now + 2 * HOUR).overdose, od, 'the webpage follows what Torn\'s panel saw');
    set(K.overdose, null);
});

test('Home, overdosed: "Overdosed · fly to Switzerland", no training steps, the rehab price, Rehab done', () => {
    const calls = [];
    const out = renderHome(model(OD), ctxFor(calls));
    const lead = out.main[0];
    const t = lead.textContent;
    assert.match(t, /overdosed/);
    assert.match(t, /Overdosed · fly to Switzerland/);
    assert.match(t, /No training steps until rehab is done/);
    assert.match(t, /Rehab there: about \$215k a session|Rehab there: about \$215,000 a session/);
    assert.match(t, /No Discord pings about energy or training/);
    assert.equal(lead.all((n) => n.tagName === 'table').length, 0, 'no step table (the Xanax step ticked Done is gone too)');
    assert.doesNotMatch(t, /Train DEX|Open the gym|then train|NOW/, 'no training step anywhere in Today');
    assert.doesNotMatch(text(out.main), /Next 48 h/);
    const travel = lead.all((n) => n.tagName === 'a')[0];
    assert.equal(travel.textContent, 'Open Travel');
    assert.match(travel.attrs.href, /travelagency\.php/);
    lead.all((n) => n.tagName === 'button' && n.textContent === 'Rehab done · recalibrate')[0].listeners.click.forEach((f) => f());
    assert.deepEqual(calls, ['end']);
    assert.equal(lead.all((n) => n.attrs['data-overdose'] === 'on').length, 1);
});

test('the strip\'s Drug cell says it too', () => {
    const on = statusStrip(model(OD), { timeFormat: 'torn' });
    assert.match(on.textContent, /Overdosed · fly to Switzerland/);
    assert.doesNotMatch(on.textContent, /Xanax \d of \d today/);
    assert.match(statusStrip(model(null), { timeFormat: 'torn' }).textContent, /Xanax \d of \d today/);
});

test('the gym page and Torn\'s panel read the same state and words', () => {
    const p = planGymPage(model(OD), { selectedId: 18 }, null, T0);
    assert.equal(p.state.kind, 'overdose', 'from m.overdose, with nothing passed by the page');
    assert.equal(p.pill, OVERDOSE_WORDS.pill);
    const card = gymPanel(p);
    assert.deepEqual([card.title, card.step, card.sub], [OVERDOSE_WORDS.title, OVERDOSE_WORDS.step, OVERDOSE_WORDS.sub]);
    assert.ok(Object.values(p.perStat).every((x) => x.kind === 'off'), 'no train mark on any stat');
});

test('the bot\'s plan: no steps and `overdose: {at, until}` (seconds); an older Worker keeps energy and refill quiet', () => {
    assert.deepEqual(planPayload(model(OD)), { type: 'jump', noRefill: true, steps: [], overdose: { at: Math.floor(OD.at / 1000), until: Math.floor(OD.until / 1000) } });
    assert.ok(planPayload(model(null)).steps.length);
});

test('"Rehab done": over for you, kept as ended until its cooldown has run out (the same bars are not a new one)', async () => {
    const now = Date.now();
    setWhere('app');
    set(K.planNow, null);
    set(K.overdose, { at: now, until: now + 24 * HOUR });
    set(K.userState, { api: api({ energy: 0, happy: 0, drug: 24 * 3600 }), at: now });
    assert.ok(currentModel(now).overdose);
    assert.equal(await overdoseDone(), null, 'no saved plan to recalibrate: the steps simply come back');
    assert.ok(get(K.overdose).ended > 0);
    assert.equal(currentModel(now + 1000).overdose, null, 'bars still at 0 with the long cooldown: not seen again');
    assert.equal(overdoseOn(get(K.overdose), now + 1000), false);
    // Pure: an ended one is kept until its cooldown ends, then a new overdose can be seen.
    const ended = { at: T0, until: T0 + 24 * HOUR, ended: T0 + HOUR };
    const zero = { happy: { current: 0 }, energy: { current: 0 }, drugLeft: 23 * HOUR };
    assert.equal(nextOverdose(ended, zero, T0 + HOUR, null), ended);
    assert.deepEqual(nextOverdose(ended, { ...zero, drugLeft: 24 * HOUR }, T0 + 25 * HOUR, null), { at: T0 + 25 * HOUR, until: T0 + 49 * HOUR });
    set(K.overdose, null);
});

test('his real overdose, from his log (2026-10-03): eight hours of regeneration do not end it; the rehab does, by the happy it gives back', () => {
    // 02:44 TCT the overdose (happy and energy to 0, a day of drug cooldown); 10:52 the rehab, which gave back 3,835 happy;
    // 11:37 his gym page read 150/150 energy and 4,000/4,000 happy on the flight home.
    const at = Date.UTC(2026, 9, 3, 2, 44);
    const od = { at, until: at + 24 * HOUR };
    const reads = (happy, energy, t) => ({ happy: { current: happy, max: 4000 }, energy: { current: energy, max: 150 }, drugLeft: od.until - t });
    const before = at + 8 * HOUR;
    assert.deepEqual(nextOverdose(od, reads(160, 150, before), before), od, 'the bars filled by regeneration alone: still overdosed');
    const rehab = Date.UTC(2026, 9, 3, 10, 53);
    assert.equal(nextOverdose(od, reads(3835, 150, rehab), rehab), null, 'more happy than regeneration gives back: the rehab is done');
    const seen = Date.UTC(2026, 9, 3, 11, 37);
    assert.equal(nextOverdose(null, reads(4000, 150, seen), seen), null, 'and full bars with the cooldown still running are not a new overdose');
});

test('while overdosed the strip plans no refill and Home names no gym to train in', () => {
    const m = model(OD);
    const strip = statusStrip(m, { timeFormat: 'torn' }).textContent;
    assert.doesNotMatch(strip, /Planned \d\d:\d\d/, strip);
    assert.match(strip, /After rehab/);
    assert.doesNotMatch(text(renderHome(m, ctxFor()).main), /Train in /);
});
