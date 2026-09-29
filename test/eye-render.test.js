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
    addEventListener() {}
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

const { renderEye } = await import('../src/ui/app/eye-tab.js');

const fixture = async (name) => JSON.parse(await readFile(new URL('./fixtures/' + name, import.meta.url), 'utf8'));
const text = (out) => [...out.ctl.flat(), ...out.main, ...out.pane].filter(Boolean).map((n) => (typeof n === 'string' ? n : n.textContent)).join(' | ');

function ctxFor(mode, extra = {}) {
    const now = Date.now();
    const view = (id) => ({ id, band: id % 3 === 0 ? 'cant' : id % 3 === 1 ? 'stomp' : 'good', forecast: { pWin: 0.97, keep: 0.8 }, respect: 3.1, ours: 2.4, est: { source: 'ffscouter', sourceText: 'FFScouter 3 d', ageDays: 3, confidence: 'good' } });
    const stored = { at: now - 60000, params: { v: 2 }, list: [{ playerId: 1, name: 'A', level: 60, fairFight: 2.5 }, { playerId: 2, name: 'B', level: 70, fairFight: 2.2 }], dropped: { cant: 7, none: 0, range: 3 }, ffIgnored: false };
    return {
        ui: { eyeMode: mode, eyeOpen: 1 },
        settings: { timeFormat: 'torn' },
        paused: false,
        flags: { hasFfs: true, hasTs: false },
        rerender: () => {},
        go: () => {},
        eye: {
            rows: () => stored.list.map((x) => ({ ...view(x.playerId), name: x.name, level: x.level, stored: x })),
            stored: () => stored,
            load: () => {},
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

test('Targets: only beatable rows, the dropped count, details open; Chain: Stomp and Good only', () => {
    const t = text(renderEye(model, ctxFor('targets')));
    assert.match(t, /7 can’t-win players dropped \(never kept\)/);
    assert.match(t, /About 52% as strong as you \(our estimate\) · 56% by FFScouter’s list · estimate 3 days old · from FFScouter 3 d/);
    assert.doesNotMatch(t, /Hide can.t win/);
    assert.match(t, /Most respect/);
    const c = text(renderEye(model, ctxFor('chain')));
    assert.match(c, /only Stomp and Good/);
    const err = text(renderEye(model, ctxFor('targets', { error: { message: 'HTTP 500' } })));
    assert.match(err, /Couldn’t load targets: HTTP 500 · showing the list from \d\d:\d\d/, 'a failed load still shows above the old list');
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
    assert.match(t, /2 of 20 players/);
});
