/*
 * Plan and Buy drawn with a tiny stand-in DOM (no browser): "current plan"
 * on the plan you're on, a pending pick's own look, the candy named in
 * "What you do", Buy's city shop row and its "Shops I can buy from" ticks.
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
globalThis.document = { createElement: (t) => new El(t), createElementNS: (ns, t) => new El(t), createTextNode: (s) => ({ textContent: String(s) }) };

const { renderPlan } = await import('../src/ui/app/plan.js');
const { renderBuy } = await import('../src/ui/app/buy.js');
const { compareStrategies, buildModel, playerContext, buildOf } = await import('../src/core/model.js');
const { targetShares } = await import('../src/core/plan.js');
const { normalizeState } = await import('../src/core/bars.js');
const { unlockedGyms } = await import('../src/core/gyms.js');
const { XANAX, ECSTASY, EDVD, FHC, POINTS, LOLLIPOP, BOX_CHOC, CANDY_KISSES } = await import('../src/core/items.js');

const T0 = Date.UTC(2026, 8, 29, 10, 48);
const PRICES = { [XANAX]: 845000, [ECSTASY]: 34000, [EDVD]: 4310000, [FHC]: 13950000, [POINTS]: 45000, [LOLLIPOP]: 400, [BOX_CHOC]: 320, 36: 26000, [CANDY_KISSES]: 32000 };
const SETTINGS = { horizonDays: 30, budget: 150e6 };

function friend() {
    const state = normalizeState({
        bars: { energy: { current: 20, maximum: 150, increment: 5, interval: 600, tick_time: 120 }, happy: { current: 5025, maximum: 5025, increment: 5, interval: 900, tick_time: 300 } },
        cooldowns: { drug: 0, booster: 0 },
        refills: { energy: false, special_count: 0 },
        battlestats: { strength: { value: 118400 }, speed: { value: 110900 }, defense: { value: 96200 }, dexterity: { value: 82700 } },
        gym: { id: 18 },
    }, T0);
    const pc = playerContext(state, {}, { unlockedKnown: unlockedGyms(18) });
    const shares = targetShares({ build: 'baldr:str' }, pc.stats, buildOf('baldr:str').shares);
    return { state, pc, shares };
}

function ctxFor(plan, compare, extra = {}) {
    const wanted = [];
    return {
        plan: { build: 'baldr:str', buildPicked: true, pickBy: 'most', ...plan },
        settings: { ...SETTINGS, ...(extra.settings || {}) },
        compare,
        statics: extra.statics || {},
        prices: extra.prices || {},
        ui: extra.ui || {},
        setPlan: () => {},
        setSettings: () => {},
        rerender: () => {},
        go: () => {},
        wantPrices: (ids, slim) => wanted.push({ ids, slim }),
        wanted,
    };
}

function rows(out) {
    const root = new El('root');
    for (const x of [...out.main, ...out.pane]) if (x) root.appendChild(x);
    return root.all((e) => e.tagName === 'tr');
}

test('Plan: “current plan” on the plan you’re on, whatever you’re picking; a pending pick looks different', () => {
    const f = friend();
    const compare = compareStrategies({ state: f.state, pc: f.pc, shares: f.shares, settings: SETTINGS, prices: PRICES });
    const plan = { strategy: 'chocoJump' };
    const m = buildModel({ state: f.state, plan: { ...plan, build: 'baldr:str' }, settings: SETTINGS, compare, unlockedKnown: unlockedGyms(18), now: T0 });
    assert.notEqual(m.recommendation.recommended, 'chocoJump', 'the friend is on a plan that isn’t the pick');
    const ctx = ctxFor(plan, compare, { ui: { planPick: 'dailyChoco' } });
    const trs = rows(renderPlan(m, ctx));
    const mine = trs.find((r) => /Choco jump/.test(r.textContent) && /current plan/.test(r.textContent));
    assert.ok(mine, 'the choco jump row says “current plan”');
    assert.match(mine.attrs.class, /\bsel\b/);
    const pick = trs.find((r) => /Daily choco boost/.test(r.textContent) && !/what-if/.test(r.textContent));
    assert.match(pick.attrs.class, /\bpending\b/);
    assert.ok(!/current plan/.test(pick.textContent));
    assert.match(pick.textContent, /picked · see the warning/);
    assert.ok(!trs.some((r) => /\byours\b/.test(r.textContent)), '“yours” is gone');
    // The candy is named in “What you do”.
    const name = { [BOX_CHOC]: 'Box of Chocolate Bars', 36: 'Big Box of Chocolate Bars', [CANDY_KISSES]: 'Candy Kisses', [LOLLIPOP]: 'Lollipop' }[compare.chocoJump.candy.id];
    assert.ok(mine.textContent.includes(name + ' × 49'), mine.textContent);
    assert.ok(ctx.wanted.some((w) => w.slim && w.slim.includes(LOLLIPOP)), 'every candy is priced (slim)');
});

test('Buy: the plan’s candy named with why, a ticked city shop’s row links to the shop and warns of the daily allowance', () => {
    const f = friend();
    const items = { [LOLLIPOP]: { market: 399, shops: [{ shop: "Sally's Sweet Shop", buy: 25 }] } };
    const settings = { ...SETTINGS, npcShops: ["Sally's Sweet Shop"] };
    // Bigger candy out of reach: the 25-happy ones compete, and Sally's $25 Lollipop beats a $400 one.
    const prices = { ...PRICES, 36: 50e6, [CANDY_KISSES]: 50e6 };
    const compare = compareStrategies({ state: f.state, pc: f.pc, shares: f.shares, settings, prices, statics: { items } });
    assert.equal(compare.chocoJump.candy.id, LOLLIPOP, 'Sally’s $25 Lollipop wins');
    const plan = { strategy: 'chocoJump' };
    const m = buildModel({ state: f.state, statics: { items }, plan: { ...plan, build: 'baldr:str' }, settings, compare, unlockedKnown: unlockedGyms(18), now: T0 });
    const ctx = ctxFor(plan, compare, { settings: { npcShops: ["Sally's Sweet Shop"], buyWindow: 'today' }, statics: { items } });
    const out = renderBuy(m, ctx);
    const text = rows(out).map((r) => r.textContent).join('\n');
    assert.match(text, /Lollipop × 49/);
    assert.match(text, /the plan’s pick: the most stats in your budget/);
    assert.match(text, /Sally's Sweet Shop/);
    assert.match(text, /daily items allowance/);
    const root = new El('root');
    for (const x of out.main) root.appendChild(x);
    const open = root.all((e) => e.tagName === 'a' && e.attrs.href === 'https://www.torn.com/shops.php?step=candy');
    assert.ok(open.length, 'Open → the shop page');
    // The shops tick in the controls, and candy shown although hidden by default.
    const ctl = new El('ctl');
    for (const bar of out.ctl) for (const x of bar) if (x && typeof x === 'object') ctl.appendChild(x);
    assert.match(ctl.textContent, /Shops I can buy from/);
    const candyTick = ctl.all((e) => e.tagName === 'button' && e.textContent === 'Candy')[0];
    assert.equal(candyTick.attrs['aria-pressed'], 'true', 'the plan uses candy: its tick is on');
    // A steady plan with no item data yet: no shops row, candy stays off, nothing breaks.
    const ms = buildModel({ state: f.state, plan: { strategy: 'steady', build: 'baldr:str' }, settings: SETTINGS, compare, unlockedKnown: unlockedGyms(18), now: T0 });
    const steady = renderBuy(ms, ctxFor({ strategy: 'steady' }, compare));
    assert.equal(steady.ctl.length, 1);
    const c2 = new El('ctl');
    for (const x of steady.ctl[0]) if (x && typeof x === 'object') c2.appendChild(x);
    assert.equal(c2.all((e) => e.tagName === 'button' && e.textContent === 'Candy')[0].attrs['aria-pressed'], 'false');
});
