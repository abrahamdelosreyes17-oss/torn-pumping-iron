/*
 * Round 7's reference players and a way to drive the real runtime in node
 * (Create plan, Re-plan, the model) with a clock we set. The baseline
 * (test/baseline.mjs) and the round's tests share it, so they all stand on
 * the same three players at the same moment.
 */
import { pi, setWhere } from '../../src/runtime.js';
import { K, set } from '../../src/platform/store.js';
import { SAVED_PLAN_GM_FALLBACK } from '../../src/platform/plan-store.js';
import { compareStrategies, playerContext, buildOf } from '../../src/core/model.js';
import { normalizeState } from '../../src/core/bars.js';
import { targetShares } from '../../src/core/plan.js';
import { unlockHook } from '../../src/core/year.js';

export const DAY = 86400e3;
/** The moment every reference run starts: 2026-10-01 12:00 Torn time. */
export const T0 = Date.parse('2026-10-01T12:00:00Z');

let clock = T0;
const realNow = Date.now;
/** From here on Date.now() is ours (a test file runs in its own process). */
export function useClock(t = T0) {
    clock = t;
    Date.now = () => clock;
}
export const setNow = (t) => (clock = t);
export const now = () => clock;
export const restoreClock = () => (Date.now = realNow);

const even = (total) => ({ str: total / 4, spd: total / 4, def: total / 4, dex: total / 4 });

/**
 * The three reference players (ROUND7-PLAN §2.1): the friend's screenshot
 * (example stats), a mid player, the owner (HANDOFF §1, checked 2026-09-29).
 */
export const PLAYERS = {
    friend: { name: 'Friend · 54k', stats: even(54121), happyMax: 4000, gym: 12, build: 'baldr:str' },
    mid: { name: 'Mid · 5M', stats: { str: 1.75e6, spd: 1.25e6, def: 1e6, dex: 1e6 }, happyMax: 4525, gym: 24, build: 'baldr:str' },
    owner: { name: 'Owner · 142M', stats: { str: 35e6, spd: 4e6, def: 82e6, dex: 20.5e6 }, happyMax: 5025, gym: 24, build: 'hank:def' },
};

/**
 * Candy at the 2024 items dump's market values (docs/reference/torn-items-dump-2024.json), as stored price rows: a
 * fixed table with every candy tier priced, so the candy choice is part of what the baseline holds still.
 */
export const DUMP_CANDY = { 310: 399, 210: 332, 209: 405, 35: 318, 37: 322, 38: 332, 39: 450, 36: 26377, 527: 31824, 1312: 166500, 528: 50509, 634: 52558, 529: 100810, 556: 101971, 151: 264307, 586: 260867, 587: 263581, 1039: 345303, 1028: 2088860 };
export const dumpPrices = () => Object.fromEntries(Object.entries(DUMP_CANDY).map(([id, u]) => [id, { u, low: u, at: T0 }]));

/** Torn's user answer for a player (bars full, no cooldowns, the refill unused, unless said). */
export function apiOf(p = PLAYERS.friend, { stats = null, energy = 150, happy = null, drug = 0, booster = 0, refillUsed = false } = {}) {
    const s = stats || p.stats;
    return {
        bars: { energy: { current: energy, maximum: 150, increment: 5, interval: 600, tick_time: 120, full_time: 0 }, happy: { current: happy === null ? p.happyMax : happy, maximum: p.happyMax, increment: 5, interval: 900, tick_time: 300, full_time: 0 } },
        cooldowns: { drug, medical: 0, booster },
        refills: { energy: refillUsed, nerve: false, token: false, special_count: 0 },
        battlestats: { strength: { value: s.str }, defense: { value: s.def }, speed: { value: s.spd }, dexterity: { value: s.dex }, total: s.str + s.def + s.spd + s.dex },
        gym: { id: p.gym, name: 'x' },
    };
}

/** A clean store for one player: nothing saved, this tab leading, the ladder open up to the player's gym. */
export function setup(p = PLAYERS.friend, { api = null, strategy = 'steady', plan = {}, settings = null, prices = null } = {}) {
    pi.model = null;
    pi.saved = null;
    pi.savedLoading = null;
    pi.planBusy = null;
    setWhere('app');
    for (const k of [K.planNow, SAVED_PLAN_GM_FALLBACK, K.planLine, K.dayTotals, K.statsHistory, K.dayLog, 'calibration', K.userStatic, K.gymProgress, K.xanaxCds, K.skipped, K.prices]) set(k, null);
    set(K.userState, { api: api || apiOf(p), at: clock });
    set(K.unlocked, Array.from({ length: p.gym }, (_, i) => i + 1));
    set(K.plan, { type: 'steady', strategy, build: p.build, buildPicked: true, strategyPicked: false, pickBy: 'max', pickByPicked: true, createdAt: 1, ...plan });
    set(K.settings, settings);
    // No stored prices: the sample ones (core/items.js).
    set(K.prices, prices);
    // This tab leads (the day's totals are written only by the leader).
    set(K.leader, { id: pi.tabId, ts: clock });
}

export function setState(api) {
    set(K.userState, { api, at: clock });
}

/** No break between slices (node has no page to keep free). */
export const noPause = () => Promise.resolve();

/** A tiny DOM, enough for the pages' h() (as test/ui-logic.test.js does). */
export function fakeDocument() {
    class Node {
        constructor(tag) {
            this.tagName = tag;
            this.attrs = {};
            this.children = [];
            this.listeners = {};
            this.text = '';
            this.style = {};
            this.classList = { add: (c) => (this.attrs.class = ((this.attrs.class || '') + ' ' + c).trim()), contains: (c) => (this.attrs.class || '').split(' ').includes(c) };
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
        querySelector() {
            return null;
        }
    }
    return { createElement: (t) => new Node(t), createElementNS: (ns, t) => new Node(t), createTextNode: (s) => ({ textContent: s }), visibilityState: 'visible' };
}

export const byClass = (node, cls) => node.all((n) => (n.attrs.class || '').split(' ').includes(cls));

/** The simulator's trains (its `trace` rows) grouped into sessions: the same 5-minute step, or steps in a row. */
export function sessionsOfTrace(rows) {
    const out = [];
    for (const r of rows) {
        let s = out[out.length - 1];
        if (!s || r.t - s.end > 5) out.push((s = { t: r.t, end: r.t, E0: r.E, H0: r.H, energy: 0, gain: 0, trains: {} }));
        s.end = r.t;
        s.energy += r.e;
        s.gain += r.gain;
        s.trains[r.k] = (s.trains[r.k] || 0) + 1;
    }
    return out;
}

/**
 * Every plan for a player, straight from the engine (no runtime, no store): what Create plan compares, for tests
 * that only need the comparison. `progress`: gym experience toward the next ladder gym (so gyms open as trained).
 */
export function compareFor(p = PLAYERS.friend, { pickBy = 'max', budget = Infinity, days = 31, prices = {}, lossMult = 1, progress = 0, at = T0 } = {}) {
    const state = normalizeState(apiOf(p), at);
    const pc0 = playerContext(state, {}, { unlockedKnown: Array.from({ length: p.gym }, (_, i) => i + 1) });
    const pc = lossMult === 1 ? pc0 : { ...pc0, perks: { ...pc0.perks, happyLossMult: (pc0.perks.happyLossMult || 1) * lossMult } };
    const shares = targetShares({ build: p.build, goal: null }, pc.stats, buildOf(p.build).shares);
    const unlock = unlockHook({ top: p.gym, progress, gymExpMult: 1, table: pc.table, active: p.gym, known: [], paid: new Set() });
    const settings = { horizonDays: days, budget };
    const compare = compareStrategies({ state, pc, shares, settings, prices, special: 0, statics: {}, pickBy, unlock });
    return { compare, state, pc, shares, settings, days };
}
