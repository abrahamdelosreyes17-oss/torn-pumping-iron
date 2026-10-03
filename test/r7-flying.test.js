/*
 * Flying (the owner's live gym page, 2026-10-03 11:37 TCT, read only): he was in the air and the panel said
 * "Now · Train DEX × 6" while Torn said "This area is unavailable while you're traveling". The cause: the state
 * read never asked Torn for `travel`, so the model could not know. One shared state, like stacking and the
 * overdose: `m.away = {flying, where, until}`; the gym page, the panel and Home hold the training
 * steps back and say when you are back.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

class El {
    constructor(tag) {
        this.tagName = tag;
        this.children = [];
        this.attrs = {};
        this.own = '';
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
    addEventListener() {}
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
}
globalThis.document = { createElement: (t) => new El(t), createElementNS: (ns, t) => new El(t), createTextNode: (s) => ({ textContent: String(s) }), visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };

const { USER_STATE_SELECTIONS, USER_STATE_REQUIRED, fetchUserState, missingSelections, ACCESS_CUSTOM } = await import('../src/api/torn.js');
const { TornApiError } = await import('../src/api/client.js');
const { buildModel } = await import('../src/core/model.js');
const { normalizeState } = await import('../src/core/bars.js');
const { planGymPage, gymPanel, awayWords } = await import('../src/core/gympage.js');
const { renderHome } = await import('../src/ui/app/home.js');

const MIN = 60e3;
const T0 = Date.UTC(2026, 9, 3, 11, 37);
const S0 = Math.floor(T0 / 1000);
const api = (travel) => ({
    bars: { energy: { current: 60, maximum: 150, increment: 5, interval: 600, tick_time: 120, full_time: 0 }, happy: { current: 4000, maximum: 4000, increment: 5, interval: 900, tick_time: 300, full_time: 0 } },
    cooldowns: { drug: 0, medical: 0, booster: 0 },
    refills: { energy: true, nerve: false, token: false, special_count: 0 },
    battlestats: { strength: { value: 118400 }, defense: { value: 96200 }, speed: { value: 110900 }, dexterity: { value: 82700 }, total: 408200 },
    gym: { id: 18, name: 'Gun Shop' },
    ...(travel ? { travel } : {}),
});
// His flight home from Switzerland, 43 minutes left; the outbound leg; landed abroad; at home.
const HOME_LEG = { destination: 'Torn', method: 'Airstrip', departed_at: S0 - 3600, arrival_at: S0 + 43 * 60, time_left: 43 * 60 };
const OUT_LEG = { destination: 'Switzerland', method: 'Airstrip', departed_at: S0 - 600, arrival_at: S0 + 110 * 60, time_left: 110 * 60 };
const ABROAD = { destination: 'Switzerland', method: 'Airstrip', departed_at: S0 - 7200, arrival_at: S0 - 600, time_left: 0 };
const IN_TORN = { destination: 'Torn', method: 'Airstrip', departed_at: S0 - 9000, arrival_at: S0 - 3600, time_left: 0 };
const PLAN = { type: 'steady', strategy: 'steady', build: 'baldr', buildPicked: true, strategyPicked: false, pickBy: 'most', createdAt: 1 };
const model = (travel, now = T0) => buildModel({ state: normalizeState(api(travel), T0), statics: {}, plan: PLAN, settings: { horizonDays: 30, budget: 150e6 }, now });
const BOXES = ['str', 'def', 'spd', 'dex'].map((stat) => ({ stat, locked: false, energyPerTrain: 10 }));
const gym = (m, now = T0) => planGymPage(m, { selectedId: 18, boxes: BOXES, reading: true }, null, now);
const ctx = { settings: { timeFormat: 'torn' }, prices: {}, statics: {}, ui: {}, plan: PLAN, go: () => {} };
const text = (nodes) => nodes.map((n) => (n ? n.textContent : '')).join(' | ');

test('the cause: Torn is asked for travel with the bars (it was not), and the state keeps it', () => {
    assert.ok(USER_STATE_SELECTIONS.split(',').includes('travel'));
    assert.deepEqual(normalizeState(api(HOME_LEG), T0).travel, { destination: 'Torn', left: 43 * MIN, arriveAt: T0 + 43 * MIN });
    assert.equal(normalizeState(api(null), T0).travel, null, 'an answer without travel (an older stored read) is not "in Torn" by guess');
});

test('the model carries m.away while you fly or stand abroad, and nothing once you are back in Torn', () => {
    assert.deepEqual(model(HOME_LEG).away, { flying: true, where: 'Torn', until: T0 + 43 * MIN });
    assert.deepEqual(model(OUT_LEG).away, { flying: true, where: 'Switzerland', until: T0 + 110 * MIN });
    assert.deepEqual(model(ABROAD).away, { flying: false, where: 'Switzerland', until: null });
    assert.equal(model(IN_TORN).away, null);
    assert.equal(model(null).away, null);
    // The read is 44 minutes old and the flight home has landed since: no longer away.
    assert.equal(model(HOME_LEG, T0 + 44 * MIN).away, null);
    // The flight out has landed since: abroad, not in Torn.
    assert.deepEqual(model(OUT_LEG, T0 + 111 * MIN).away, { flying: false, where: 'Switzerland', until: null });
    assert.ok(model(HOME_LEG).steps.length, 'the steps stay in the model: each surface holds them back');
});

test('the words: back at a Torn time on the way home, lands at on the way out, fly back when abroad', () => {
    assert.deepEqual(awayWords({ flying: true, where: 'Torn', until: T0 + 43 * MIN }), { title: 'Flying', pill: 'Flying · back in Torn at 12:20', step: 'Back in Torn at 12:20', sub: 'The gym is closed while you travel. Your steps start again when you land.' });
    assert.equal(awayWords({ flying: true, where: 'Switzerland', until: T0 + 110 * MIN }).pill, 'Flying to Switzerland · lands 13:27');
    assert.equal(awayWords({ flying: false, where: 'Switzerland', until: null }).pill, 'In Switzerland · fly back to train');
});

test('the gym page (his report): no "Train DEX × 6" and no train mark while flying; the panel says when you are back', () => {
    const home = gym(model(IN_TORN));
    assert.match(home.pill, /^Train /, 'in Torn the page asks to train: ' + home.pill);
    const p = gym(model(HOME_LEG));
    assert.equal(p.state.kind, 'away');
    assert.equal(p.pill, 'Flying · back in Torn at 12:20');
    assert.doesNotMatch(p.pill + ' ' + p.line.head + ' ' + p.line.text, /Train (STR|DEF|SPD|DEX)/);
    assert.equal(Object.values(p.perStat).filter((s) => s.mark === 'train' || s.fill > 0).length, 0, 'no stat is marked to train, no Fill');
    const panel = gymPanel(p);
    assert.deepEqual([panel.tone, panel.title, panel.step], ['amber', 'Flying', 'Back in Torn at 12:20']);
    assert.equal(gym(model(ABROAD)).pill, 'In Switzerland · fly back to train');
});

test('Home: Today says you are flying, with no training step to do now, and what comes first when you land', () => {
    const m = model(HOME_LEG);
    const out = text(renderHome(m, ctx).main);
    assert.match(out, /Flying · back in Torn at 12:20/);
    assert.match(out, /No training until you are back in Torn/);
    assert.match(out, /First when you land: /);
    assert.doesNotMatch(out.split('First when you land')[0], /Train (STR|DEF|SPD|DEX) ×|Open the gym/);
    assert.match(text(renderHome(model(IN_TORN), ctx).main), /Train|train/, 'in Torn the steps are back');
});

test('a custom key without travel: asked once with it, then without; the app goes on, and the key is not called short', async () => {
    const asked = [];
    const client = {
        get: async (path, q) => {
            asked.push(q.selections);
            if (q.selections.includes('travel')) throw new TornApiError('Access level of this key is not high enough', { code: 16 });
            return api(null);
        },
    };
    assert.equal(normalizeState(await fetchUserState(client), T0).travel, null);
    await fetchUserState(client);
    assert.deepEqual(asked, [USER_STATE_SELECTIONS, USER_STATE_REQUIRED, USER_STATE_REQUIRED], 'the refused call is not repeated');
    assert.deepEqual(missingSelections({ level: ACCESS_CUSTOM, selections: { user: USER_STATE_REQUIRED.split(',') } }), []);
    // Any other error is not swallowed.
    await assert.rejects(fetchUserState({ get: async () => { throw new TornApiError('Incorrect key', { code: 2 }); } }), /Incorrect key/);
});
