/*
 * The Torn Eye tab draws every mode without throwing (a tiny stand-in DOM,
 * enough for h()): Targets with details open, Chain, War with every kind
 * of status, Watched with an offer and a heads-up. The look itself is
 * checked in the browser by test/ux-check.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

class FakeNode {
    constructor(tag, text = null) {
        this.tagName = tag ? tag.toUpperCase() : '#text';
        this.children = [];
        this.attrs = {};
        this.text = text;
        this.value = '';
    }
    setAttribute(k, v) {
        this.attrs[k] = String(v);
    }
    getAttribute(k) {
        return this.attrs[k] ?? null;
    }
    addEventListener(ev, fn) {
        (this.listeners = this.listeners || {})[ev] = fn;
    }
    appendChild(c) {
        this.children.push(c);
        return c;
    }
    set textContent(v) {
        this.text = String(v);
        this.children = [];
    }
    get textContent() {
        return (this.text || '') + this.children.map((c) => c.textContent).join('');
    }
    find(pred, out = []) {
        if (pred(this)) out.push(this);
        for (const c of this.children) if (c.find) c.find(pred, out);
        return out;
    }
}
globalThis.document = { createElement: (t) => new FakeNode(t), createElementNS: (_, t) => new FakeNode(t), createTextNode: (t) => new FakeNode(null, t), visibilityState: 'visible' };

const eyeTab = await import('../src/ui/app/eye-tab.js');
const { renderEye } = eyeTab;

const fixture = async (name) => JSON.parse(await readFile(new URL('./fixtures/' + name, import.meta.url), 'utf8'));
const text = (out) => [...out.ctl.flat(), ...out.main, ...out.pane].filter(Boolean).map((n) => (typeof n === 'string' ? n : n.textContent)).join(' | ');

function ctxFor(mode, extra = {}) {
    const now = Date.now();
    const view = (id) => ({ id, band: id % 3 === 0 ? 'low' : id % 3 === 1 ? 'stomp' : 'good', forecast: { pWin: 0.97, keep: id % 3 === 1 ? 1 : 0.8 }, respect: id > 2 ? 4 - id / 100 : 3.1, ours: 2.4, est: { source: 'ffscouter', sourceText: 'FFScouter 3 d', ageDays: 3, confidence: 'good' } });
    const n = extra.n || 2;
    const list = Array.from({ length: n }, (_, i) => ({ playerId: i + 1, name: i < 2 ? 'AB'[i] : 'P' + (i + 1), level: 60 + (i % 40), fairFight: 2.5 }));
    const stored = { at: now - 60000, params: { v: 3 }, list, dropped: { low: 7, none: 0, range: 3 }, ffIgnored: false, ...(extra.stored || {}) };
    const refills = [];
    const shown = [];
    return {
        shown,
        refills,
        ui: { eyeMode: mode, eyeOpen: 1, ...(extra.ui || {}) },
        settings: { timeFormat: 'torn' },
        paused: false,
        flags: { hasFfs: true, hasTs: false },
        rerender: () => {},
        go: () => {},
        eye: {
            rows: () => stored.list.map((x) => ({ ...view(x.playerId), name: x.name, level: x.level, stored: x, ...(extra.row ? extra.row(x.playerId) : {}) })),
            statuses: { show: (o) => shown.push(o), attack() {}, active: () => true },
            stored: () => stored,
            load: () => {},
            refill: () => refills.push(Date.now()),
            reserve: () => (extra.reserve === undefined ? 100 : extra.reserve),
            loading: () => false,
            error: () => extra.error || null,
            sources: () => ({ fights: 3, ffsFree: 50, gear: 1 }),
            view: (id) => view(id),
            attacks: () => [],
            updatedAt: () => stored.at,
            war: { state: () => ({ fid: 7777, manual: null, name: 'Rival Syndicate', enemies: [{ id: 7777, name: 'Rival Syndicate', kind: 'ranked' }, { id: 5555, name: 'Night Shift', kind: 'raid' }], myFaction: 9001, members: extra.members || [], early: new Set([424242]), loading: false, error: null }), watch() {}, pick() {}, auto() {} },
            watch: {
                state: () => ({ list: [{ id: 777001, name: 'Brix', tag: 'revenge' }, { id: 515151, name: 'Flyer', tag: 'my own words' }], states: { 777001: { status: { state: 'Hospital', until: Math.floor(now / 1000) + 100 }, last_action: { status: 'Idle', timestamp: Math.floor(now / 1000) - 300 } }, 515151: { status: { state: 'Traveling', description: 'Traveling to Mexico' } } }, flights: { 515151: { at: now - 60000 } }, offers: [{ id: 31, name: 'Mugger', level: 30, at: now - 120000, mugged: true }] }),
                isWatched: (id) => id === 777001,
                toggle: () => ({ ok: true }),
                tag() {},
                remove() {},
                dismiss() {},
            },
        },
    };
}

const model = { ready: true, pc: { stats: { str: 1e8, spd: 1e8, def: 1e8, dex: 1e8 } }, state: { statMods: {}, life: { maximum: 7500 } } };

test('Targets: only listed bands, the dropped count, details open; no Sort, Level, Refresh or Show ticks; Chain is gone', () => {
    const t = text(renderEye(model, ctxFor('targets')));
    assert.match(t, /7 players left out \(you’d keep under 50% HP\)/);
    assert.match(t, /About 52% as strong as you \(our estimate\) · 56% by FFScouter’s list · estimate 3 days old · from FFScouter 3 d/);
    assert.doesNotMatch(t, /Hide can.t win|Most respect|Easiest|Refresh|Stomp only|Keep over 50% HP|Not attacked by me today|Torn Eye colours/);
    assert.match(t, /Order: band › respect › HP kept › win/);
    assert.match(t, /All 2.*Stomp 1.*Good 1.*Fair 0.*Ready now/);
    const c = text(renderEye(model, ctxFor('chain')));
    assert.match(c, /Targets/, 'an old "chain" view opens Targets');
    assert.doesNotMatch(c, /only Stomp and Good/);
    const err = text(renderEye(model, ctxFor('targets', { error: { message: 'HTTP 500' } })));
    assert.match(err, /Couldn’t load targets: HTTP 500 · showing the list from \d\d:\d\d/, 'a failed load still shows above the old list');
});

/** The rows a draw built (FakeNode tree): each target row's player name. */
function drawnNames(out) {
    const names = [];
    for (const n of out.main) if (n && n.find) for (const tr of n.find((x) => x.tagName === 'TR' && /click/.test(x.attrs.class || ''))) names.push(tr.children[1].textContent);
    return names;
}

test('Targets: 20 a page, only those drawn, the pager, and the statuses told which rows are on screen', () => {
    // 60 stored: every third is under 50% (never listed), so 40 are listed: two pages.
    const ctx = ctxFor('targets', { n: 60 });
    const out = renderEye(model, ctx);
    const t = text(out);
    assert.equal(drawnNames(out).length, 20, 'only the page on screen is built');
    assert.match(t, /40 players you beat · 1–20 shown/);
    assert.match(t, /‹ Prev.*1.*2.*Next ›/);
    assert.match(t, /20 a page · page 1 of 2/);
    assert.match(t, /Statuses: 0 of 40 checked · this page first · the rest in about 2 min/);
    assert.match(t, /checking/);
    // The one order: band first (Stomp), then respect (P4 is the Stomp with the most), then HP kept.
    assert.equal(drawnNames(out)[0], 'P4');
    const s = ctx.shown.at(-1);
    assert.equal(s.page.length, 20);
    assert.equal(s.all.length, 40, 'every listed row, whatever the chips');
    assert.deepEqual(s.page, s.all.slice(0, 20), 'this page first');
    // Page 2.
    const ctx2 = ctxFor('targets', { n: 60, ui: { eyePage: 1 } });
    const out2 = renderEye(model, ctx2);
    assert.match(text(out2), /21–40 shown/);
    assert.deepEqual(ctx2.shown.at(-1).page, ctx2.shown.at(-1).all.slice(20, 40));
    // A page past the end is brought back.
    const ctx3 = ctxFor('targets', { n: 60, ui: { eyePage: 9 } });
    renderEye(model, ctx3);
    assert.equal(ctx3.ui.eyePage, 1);
});

test('Targets: "Ready now" hides hospital, away and jail and says how many; a band chip; old kept filters are ignored', () => {
    const now = Date.now();
    const row = (id) => (id % 4 === 1 ? { status: { state: 'Hospital', description: 'In hospital', until: Math.floor(now / 1000) + 600 } } : id % 4 === 2 ? { status: { state: 'Okay', description: 'Okay' } } : {});
    const on = text(renderEye(model, ctxFor('targets', { n: 60, row })));
    assert.match(on, /Ready now · \d+ hidden/);
    assert.doesNotMatch(on, /Hospital · /, 'nobody in hospital shows');
    const off = text(renderEye(model, ctxFor('targets', { n: 60, row, ui: { eyeFilters: { ready: false } } })));
    assert.match(off, /Hospital · \d+:\d\d/, 'with it off, they show (greyed)');
    assert.doesNotMatch(off, /hidden/);
    const stompOnly = text(renderEye(model, ctxFor('targets', { n: 60, ui: { eyeFilters: { band: 'stomp', ready: false } } })));
    assert.match(stompOnly, /20 players you beat/);
    // An old kept filter (1.3.0: sort, level range, ticks) breaks nothing.
    const old = text(renderEye(model, ctxFor('targets', { n: 6, ui: { eyeFilters: { minLevel: 40, maxLevel: 9, sort: 'level', stompOnly: true, keep50: true, hideHosp: true, band: 'tough', ready: 'yes' } } })));
    assert.match(old, /4 players you beat/);
    assert.match(old, /Statuses: 0 of 4 checked/);
});

test('Targets (round 7 review): no statuses asked without FFScouter; "checked" counts only rows read; an old jail read says nothing', () => {
    const now = Date.now();
    // Without FFScouter: the list isn't drawn and nobody is asked about.
    const noFfs = ctxFor('targets', { n: 6 });
    noFfs.flags.hasFfs = false;
    const nt = text(renderEye(model, noFfs));
    assert.match(nt, /Connect it in Settings/);
    assert.doesNotMatch(nt, /Statuses:/, 'no progress line for reads that never happen');
    assert.equal(noFfs.shown.length, 0, 'statuses.show not called');
    // Row 1 read Okay; row 2 only the list's out-time; row 4 only your own hit; row 5 a jail read past its time.
    const row = (id) =>
        id === 1
            ? { status: { state: 'Okay', description: 'Okay' } }
            : id === 2
              ? { hospitalUntil: now + 30 * 60000 }
              : id === 4
                ? { hit: { kind: 'hit', at: now - 60000, result: 'Hospitalized' } }
                : id === 5
                  ? { status: { state: 'Jail', description: 'In jail', until: Math.floor(now / 1000) - 60 } }
                  : {};
    const t = text(renderEye(model, ctxFor('targets', { n: 6, row, ui: { eyeFilters: { ready: false } } })));
    assert.match(t, /Statuses: 1 of 4 checked/);
    assert.doesNotMatch(t, /In jail/, 'a jail stay that has ended is not shown');
});

test('Targets: a low reserve asks once more by itself, quietly; a full one or a list asked the old way does not', async () => {
    const { targetParams, askPlan, fallbackEdges, REFILL_GAP_MS } = await import('../src/core/eye/targets.js');
    const fresh = { at: Date.now() - REFILL_GAP_MS - 1000, params: targetParams({}), plan: askPlan(fallbackEdges()) };
    const low = ctxFor('targets', { stored: fresh, reserve: 5 });
    const t = text(renderEye(model, low));
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(low.refills.length, 1, 'one refill');
    assert.doesNotMatch(t, /Asking FFScouter/, 'quiet: no loading line');
    // The same page again within the gap: not again.
    renderEye(model, low);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(low.refills.length, 1);
    const full = ctxFor('targets', { stored: fresh, reserve: 60 });
    renderEye(model, full);
    const old = ctxFor('targets', { reserve: 5, ui: { eyeAutoLoaded: true } });
    renderEye(model, old);
    await new Promise((r) => setTimeout(r, 5));
    assert.equal(full.refills.length + old.refills.length, 0);
});

test('War: found by itself, everyone with status, out-times, landings and the fallen', async () => {
    const { members } = await fixture('faction-members-war.json');
    const t = text(renderEye(model, ctxFor('war', { members })));
    assert.match(t, /vs Rival Syndicate \[7777\] · ranked war/);
    assert.match(t, /Night Shift · raid/);
    assert.match(t, /Out early · attack now/);
    assert.match(t, /Hospital · out \d\d:\d\d TCT \(/);
    assert.match(t, /may leave early · revivable/);
    assert.match(t, /→ Mexico, lands ~\d\d:\d\d \(est\.\)/);
    assert.match(t, /← from Mexico, lands ~/);
    assert.match(t, /Jail · out /);
    assert.match(t, /Fallen/);
    assert.match(t, /Online/);
    assert.match(t, /1 fallen/);
});

test('Watched: rows with reasons, the "Watch?" offer and the heads-up', () => {
    const t = text(renderEye(model, ctxFor('watched')));
    assert.match(t, /Watch\? They attacked you in the last hour/);
    assert.match(t, /Mugger.*mugged you 2 min ago/);
    assert.match(t, /Brix is out of hospital in 1:4\d/);
    assert.match(t, /Remove/);
    assert.match(t, /2 of 50 players/);
});

test('Chain mode: a card over "How sure" on every view; on, your energy is stacked (Home’s one state), and ending it recalibrates', () => {
    const { chainModeCard } = eyeTab;
    for (const mode of ['targets', 'war', 'watched']) {
        const out = renderEye(model, ctxFor(mode));
        const pane = out.pane.filter(Boolean).map((n) => n.textContent);
        const at = pane.findIndex((x) => /^Chain mode/.test(x));
        assert.ok(at >= 0 && /^How sure/.test(pane[at + 1]), mode + ': the card sits right over How sure (' + pane.map((x) => x.slice(0, 12)).join(' | ') + ')');
    }
    const calls = [];
    const ctx = { ...ctxFor('targets'), startStacking: () => calls.push('start'), resumeStacking: () => calls.push('resume') };
    const button = (card) => card.find((n) => n.tagName === 'BUTTON')[0];
    const press = (card) => {
        button(card).listeners.click();
        return button(card).textContent;
    };
    const off = chainModeCard(model, ctx);
    assert.equal(off.attrs['data-chain-mode'], 'off');
    assert.match(off.textContent, /^Chain modeoffChaining\? Chain mode stacks your energy/);
    assert.equal(press(off), 'Chain mode');
    const since = Date.parse('2026-10-03T14:02:00Z');
    const on = chainModeCard({ ...model, stacking: { since } }, ctx);
    assert.equal(on.attrs['data-chain-mode'], 'on');
    // Round 8: while it is on it carries the chain counter (here nothing was read: it says so).
    assert.match(on.textContent, /^Chain modeon since 14:02.* · stackingYour faction——Not read yetYour energy is kept for the chain/);
    assert.equal(press(on), 'End chain mode · recalibrate');
    assert.deepEqual(calls, ['start', 'resume']);
    // A plan being worked out: the button waits.
    assert.ok(button(chainModeCard({ ...model, stacking: { since }, planBusy: { recalibrate: true } }, ctx)).attrs.disabled !== undefined);
});
