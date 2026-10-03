/*
 * Round 4 Torn Eye (ROUND4-PLAN §A, §B, §I): targets asked in slices and
 * judged before they're stored (only players you beat), war mode found by
 * itself with online status, out-times and landings, the watch list, and
 * what goes to the Discord Worker. Fixtures only; no live call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { pi } from '../src/runtime.js';
import { K, get, set, setKey } from '../src/platform/store.js';
import { makeFfsClient, fetchFfsTargets } from '../src/api/ffscouter.js';
import { fetchFactionWars } from '../src/api/torn.js';
import { bssOf } from '../src/core/eye/fight.js';
import { totalFromBss } from '../src/core/eye/estimate.js';
import { judgeTarget, selectTargets, findEdges, askPlan, nextAsk, pickZone, bandRank, TARGET_ASKS_MAX, levelBands, needsRefetch, targetParams, inFfRange, listIgnoresFf, targetsMessage, targetDetails, isBeatable, TARGET_FF, TARGETS_VERSION, OLD_ESTIMATE_DAYS } from '../src/core/eye/targets.js';
import { enemiesFromWars, activityOf, trackFlights, statusParts, statusText, sortWar, memberState, FLIGHT_MIN } from '../src/core/eye/war.js';
import { addWatch, removeWatch, tagWatch, normTag, dueForRead, readEvents, headsUps, watchOffers, dismissOffer, WATCH_MAX, TAG_MAX, WATCH_POLL_MS, WATCH_SLOW_MS } from '../src/core/eye/watch.js';
import { importTargets, TARGETS_KEY, WATCH_KEY, WATCH_STATE_KEY, slimAttacks, pollWatch, toggleWatch, getWatch, watchStates, rememberFlights, flightsSeen, setWatchTag, watchOffersNow } from '../src/eye-service.js';
import { shouldAutoLoad, detailsText, EYE_TICKS, EYE_MODES, DEFAULT_EYE_FILTERS } from '../src/ui/app/eye-tab.js';
import { listTargets, TARGETS_REFRESH_MS } from '../src/core/eye/targets.js';
import { setEyeForSync, eyeSyncPayload } from '../src/discord.js';
import { countdown, tornClock } from '../src/core/bars.js';

const fixture = async (name) => JSON.parse(await readFile(new URL('./fixtures/' + name, import.meta.url), 'utf8'));

/* The owner (2026-09-29): level 50, 142M raw, 172M as he fights (merits), SPD only 4M, life 2,375. */
const OWNER_RAW = { str: 35.4e6, spd: 4.06e6, def: 82.4e6, dex: 20.5e6 };
const MOD = 172e6 / (35.4e6 + 4.06e6 + 82.4e6 + 20.5e6);
const OWNER = Object.fromEntries(Object.entries(OWNER_RAW).map(([k, v]) => [k, v * MOD]));
const OWNER_LIFE = 2375;
const MY_BSS = bssOf(OWNER);
const NOW_S = Math.floor(Date.now() / 1000);

function ownerModel() {
    const p = (MOD - 1) * 100;
    pi.model = { ready: true, pc: { stats: { ...OWNER_RAW } }, state: { statMods: { str: p, spd: p, def: p, dex: p }, life: { current: OWNER_LIFE, maximum: OWNER_LIFE } } };
}

/* A made-up Torn: 600 players, levels 1–100, FFScouter's fair fight against the owner 1.0–8.0. */
const POP = Array.from({ length: 600 }, (_, i) => {
    const ff = 1 + ((i * 7919) % 700) / 100;
    const bss = (3 / 8) * (ff - 1) * MY_BSS;
    return { id: 5_000_000 + i, name: 'P' + i, level: 1 + ((i * 37) % 100), ff, bss };
});

const res = (body, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

/** FFScouter as its docs describe it: a filtered list comes strongest first, 50 at most. */
function fakeFfs({ honourFf = true, dead = false } = {}) {
    const calls = [];
    const fetchImpl = async (url) => {
        const u = new URL(url);
        calls.push(u);
        if (dead) return res({ code: 6, error: 'Invalid API key' }, 401);
        const q = (k, d) => (u.searchParams.has(k) ? Number(u.searchParams.get(k)) : d);
        if (u.pathname.endsWith('/get-targets')) {
            const [l0, l1, f0, f1, lim] = [q('minlevel', 1), q('maxlevel', 100), q('minff', 1), q('maxff', 3), q('limit', 20)];
            const rows = POP.filter((p) => p.level >= l0 && p.level <= l1 && (!honourFf || (p.ff >= f0 && p.ff <= f1)))
                .sort((a, b) => b.bss - a.bss)
                .slice(0, lim);
            if (!rows.length) return res({ code: 17, error: 'No targets found' }, 404);
            return res({ parameters: {}, targets: rows.map((p) => ({ player_id: p.id, name: p.name, level: p.level, fair_fight: p.ff, bss_public: Math.round(p.bss), bs_estimate: Math.round(totalFromBss(p.bss)), last_action: NOW_S - 20 * 86400, source: 'bss' })) });
        }
        if (u.pathname.endsWith('/get-stats')) {
            const ids = (u.searchParams.get('targets') || '').split(',').map(Number);
            return res(ids.map((id) => {
                const p = POP.find((x) => x.id === id);
                return p ? { player_id: id, fair_fight: p.ff, bs_estimate: Math.round(totalFromBss(p.bss)), bs_estimate_human: '', bss_public: Math.round(p.bss), last_updated: NOW_S - 5 * 86400, source: 'bss' } : { player_id: id };
            }));
        }
        return res({}, 404);
    };
    return { client: makeFfsClient({ getKey: () => 'FfsKeyTest123456', fetchImpl, sleep: async () => {}, isVisible: () => true }), calls };
}

/** A clock the target pacing can move forward (no real waiting in tests). */
function fakeClock(start) {
    let t = start;
    return { now: () => t, sleep: async (ms) => { t += ms; } };
}

test('the owner\'s case: the strongest-first level-100 list (1.1.1) is all can\'t win, and none of it is kept', async () => {
    const fx = await fixture('ffs-targets-strongest.json');
    const client = makeFfsClient({ getKey: () => 'FfsKeyTest123456', fetchImpl: async () => res(fx), sleep: async () => {} });
    const rows = await fetchFfsTargets(client, { minLevel: 1, maxLevel: 100, minFf: 1.3, maxFf: 2.6 });
    assert.equal(rows.length, 50);
    assert.ok(rows.every((r) => r.level === 100));
    const { kept, dropped } = selectTargets(rows, (r) => judgeTarget({ me: OWNER, myLife: OWNER_LIFE, row: r }));
    assert.equal(kept.length, 0, 'nothing he can\'t beat is kept');
    assert.equal(dropped.low, 50);
    assert.equal(targetsMessage({ stored: { list: [], dropped } }).text, 'FFScouter found nobody you can beat in range · 50 under 50% HP kept dropped');
});

test('the fight model is right for the owner: fair fight 2.0 at level 100 is a sure win, 3.0 is not', () => {
    const at = (ff, id) => judgeTarget({ me: OWNER, myLife: OWNER_LIFE, row: { playerId: id, level: 100, fairFight: ff } });
    assert.equal(at(2.0, 1).win, 100);
    assert.equal(at(2.0, 1).band, 'stomp');
    assert.equal(at(3.0, 2).band, 'low');
});

test('asks: up to 3 level bands, highest levels first, the first one just under the stomp edge of the top band', () => {
    assert.deepEqual(levelBands(1, 100), [[1, 33], [34, 67], [68, 100]]);
    assert.deepEqual(levelBands(40, 80), [[40, 60], [61, 80]]);
    assert.deepEqual(levelBands(45, 55), [[45, 55]]);
    const edges = findEdges({ me: OWNER, myLife: OWNER_LIFE });
    assert.deepEqual(edges.map((e) => [e.minLevel, e.maxLevel]), [[68, 100], [34, 67], [1, 33]]);
    const plan = askPlan(edges);
    const q = nextAsk(plan, pickZone(plan));
    assert.deepEqual([q.zone, q.minLevel, q.maxLevel, q.minFf, q.maxFf], ['stomp', 68, 100, TARGET_FF.min, edges[0].stomp]);
    assert.deepEqual(TARGET_FF, { min: 1, max: 3 });
    assert.equal(targetParams({}).v, TARGETS_VERSION);
    assert.equal(TARGETS_VERSION, 4, 'lists stored the 600 way are asked again once');
});

test('range and "FFScouter ignored the range" checks', () => {
    assert.equal(inFfRange({ fairFight: 31 }), false);
    assert.equal(inFfRange({ fairFight: 0.9 }), false);
    assert.equal(inFfRange({ fairFight: null }), true, 'unknown: the fight model decides');
    assert.equal(listIgnoresFf([{ fairFight: 5 }, { fairFight: 6 }, { fairFight: 1.2 }], { minFf: 1, maxFf: 1.5 }), true);
    assert.equal(listIgnoresFf([{ fairFight: 1.1 }, { fairFight: 1.4 }, { fairFight: 1.5 }], { minFf: 1, maxFf: 1.5 }), false);
});

test('import (the owner, strongest-first FFScouter): only beatable players are stored, band first, then most respect', async () => {
    ownerModel();
    const { client, calls } = fakeFfs();
    const clk = fakeClock(1e12);
    const out = await importTargets({ minLevel: 1, maxLevel: 100, inactiveOnly: 1 }, { client, ...clk });
    const stored = get(TARGETS_KEY, null);
    assert.deepEqual(stored.list.map((r) => r.playerId), out.list.map((r) => r.playerId), 'stored under eyeTargets');
    // This made-up Torn is thin (~35 players under each band's stomp edge): every zone answers short, so the asks
    // go Stomp, then Good, up to the cap.
    assert.ok(out.asked <= TARGET_ASKS_MAX, out.asked + ' asks');
    assert.equal(calls.filter((u) => u.pathname.endsWith('/get-targets')).length, out.asked);
    assert.ok(calls.filter((u) => u.pathname.endsWith('/get-stats')).length >= 1, 'estimates asked before judging');
    assert.ok(out.list.length >= 20, out.list.length + ' kept');
    assert.ok(out.list.every((r) => isBeatable(r.band)), 'never a row under 50% HP kept: ' + [...new Set(out.list.map((r) => r.band))]);
    assert.ok(out.list.every((r) => r.keep >= 50), 'every stored row keeps half your HP or more');
    assert.ok(out.list.filter((r) => r.band === 'stomp').length >= 20, 'asked under the stomp edge: Stomps');
    // Compared as the row shows them (respect to 2 decimals: round 7 review, so the tie-breaks apply).
    const shown = (r) => Math.round((r.respect || 0) * 100);
    assert.ok(out.list.every((r, i) => i === 0 || bandRank(r.band) >= bandRank(out.list[i - 1].band)), 'band first: Stomp, Good, Fair');
    const same = (r, i) => i > 0 && r.band === out.list[i - 1].band;
    assert.ok(out.list.every((r, i) => !same(r, i) || shown(r) <= shown(out.list[i - 1])), 'then most respect');
    assert.ok(out.list.every((r, i) => !same(r, i) || shown(r) !== shown(out.list[i - 1]) || r.keep <= out.list[i - 1].keep), 'then most HP kept');
    const best = Math.max(...out.list.map((r) => r.respect));
    assert.ok(best > 3, 'no respect cap: the best is above 3 (' + best.toFixed(2) + ')');
    // The best Stomp sits just under the edge: within a few hundredths of base(level) × the stomp edge.
    const top = out.list[0];
    const edge = out.plan.bands.find((b) => top.level >= b.minLevel && top.level <= b.maxLevel).edges.stomp;
    assert.equal(top.band, 'stomp');
    assert.ok(top.ours > edge - 0.3, 'the first Stomp is close under its band\'s edge (' + top.ours.toFixed(2) + ' vs ' + edge + ')');
    assert.ok(new Set(out.list.map((r) => r.level)).size > 5, 'not only level 100');
    assert.ok(out.list.every((r) => Number.isFinite(r.fairFight) && Number.isFinite(r.ours)), 'both fair fights kept for the details');
    assert.equal(out.params.v, TARGETS_VERSION);
    assert.equal(needsRefetch(stored.params), false);
});

test('import when FFScouter ignores the fair-fight range: one ask per level band, still only players you beat', async () => {
    ownerModel();
    const { client, calls } = fakeFfs({ honourFf: false });
    let stored = null;
    const out = await importTargets({ minLevel: 1, maxLevel: 100 }, { client, store: (v) => (stored = v), ...fakeClock(2e12) });
    assert.equal(out.ffIgnored, true);
    assert.equal(calls.filter((u) => u.pathname.endsWith('/get-targets')).length, 3);
    assert.ok(stored.list.every((r) => isBeatable(r.band)));
    assert.ok(stored.dropped.range > 0, 'rows outside 1.0–3.0 dropped');
    if (!stored.list.length) assert.match(targetsMessage({ stored }).text, /^FFScouter found nobody you can beat in range/);
});

test('a refused key: the old list stays, and the message says so', async () => {
    ownerModel();
    set(TARGETS_KEY, { at: 1, params: targetParams({}), list: [{ playerId: 9, band: 'good' }], dropped: {} });
    const { client } = fakeFfs({ dead: true });
    await assert.rejects(importTargets({}, { client, ...fakeClock(3e12) }), (e) => {
        assert.equal(targetsMessage({ error: e }).text, 'FFScouter refused the key');
        return Boolean(e.deadKey);
    });
    assert.equal(get(TARGETS_KEY, null).list[0].playerId, 9);
    assert.equal(targetsMessage({ paused: true }).text, 'Paused · Torn Trading is on');
    assert.match(targetsMessage({ error: new Error('HTTP 500') }).text, /Couldn’t load targets: HTTP 500/);
});

test('a list stored the old way (1.1.0 no range, 1.1.1 1.3–2.6) loads again once by itself', () => {
    const base = { mode: 'targets', hasFfs: true, paused: false, loading: false, error: null, autoLoaded: false };
    assert.equal(needsRefetch({ minLevel: 1, maxLevel: 100, minFf: 1.3, maxFf: 2.6 }), true);
    assert.equal(needsRefetch({ minLevel: 1, maxLevel: 100 }), true);
    assert.equal(shouldAutoLoad({ ...base, stored: { params: { minFf: 1.3, maxFf: 2.6 }, list: [{}] } }), true);
    assert.equal(shouldAutoLoad({ ...base, stored: null }), true);
    const now = 5e12;
    assert.equal(shouldAutoLoad({ ...base, now, stored: { at: now - 60000, params: targetParams({}), list: [] } }), false, 'a new list, even empty, is not asked again');
    assert.equal(shouldAutoLoad({ ...base, stored: null, autoLoaded: true }), false, 'once');
    assert.equal(shouldAutoLoad({ ...base, stored: null, paused: true }), false);
    assert.equal(shouldAutoLoad({ ...base, mode: 'war', stored: null }), false);
    assert.equal(shouldAutoLoad({ ...base, mode: 'chain', stored: null }), false, 'Chain is gone');
    assert.equal(shouldAutoLoad({ ...base, stored: null, ready: false }), false, 'waits for your stats');
    // Round 7: no Refresh button, so an old list is asked again by itself (and not again for the same while).
    const old = { at: now - TARGETS_REFRESH_MS - 1, params: targetParams({}), list: [{}] };
    assert.equal(shouldAutoLoad({ ...base, now, stored: old }), true);
    assert.equal(shouldAutoLoad({ ...base, now, stored: old, autoLoaded: now - 60000 }), false);
    assert.equal(shouldAutoLoad({ ...base, now, stored: old, autoLoaded: now - TARGETS_REFRESH_MS - 1 }), true);
});

test('round 7: three views (Chain is gone), no Sort and no Show ticks on Targets, and a row under 50% never shows', () => {
    assert.deepEqual(EYE_MODES.map(([k]) => k), ['targets', 'war', 'watched']);
    assert.deepEqual(EYE_TICKS.map(([k]) => k), ['warHideLow', 'warHideHosp', 'warHideTravel'], 'only War keeps its ticks');
    assert.equal(DEFAULT_EYE_FILTERS.sort, undefined);
    assert.equal(DEFAULT_EYE_FILTERS.ready, true, '"Ready now" on by default');
    const rows = [{ id: 1, band: 'stomp' }, { id: 2, band: 'low' }, { id: 3, band: 'none' }, { id: 4, band: 'fair' }, { id: 5, band: 'tough' }, { id: 6, band: 'cant' }];
    assert.deepEqual(listTargets(rows, { now: 0 }).rows.map((r) => r.id).sort(), [1, 4]);
});

test('row details: our fair fight, FFScouter\'s from its list, age ("old" past 180 days), source', () => {
    const d = targetDetails({ fairFight: 2.6, ours: 2.41, ageDays: 200, source: 'FFScouter 200 d' });
    assert.equal(d.old, true);
    assert.equal(OLD_ESTIMATE_DAYS, 180);
    assert.equal(detailsText(d), 'About 53% as strong as you (our estimate) · 60% by FFScouter’s list · estimate 200 days old (old: past 180 days) · from FFScouter 200 d');
    const v = targetDetails({ fairFight: 1.9 }, { ours: 1.75, est: { ageDays: 3, sourceText: 'your fight 3 d' } });
    assert.equal(v.old, false);
    assert.match(detailsText(v), /About 28% as strong as you \(our estimate\) · 34% by FFScouter’s list · estimate 3 days old · from your fight 3 d/);
});

/* ------------------------------------------------------------------ war */

test('war: the enemy from your own faction\'s wars (ranked first, ended wars skipped)', async () => {
    const fx = await fixture('faction-wars.json');
    const nowS = 1790000000;
    const e = enemiesFromWars(fx, 9001, nowS);
    assert.deepEqual(e.map((x) => [x.id, x.kind]), [[7777, 'ranked'], [6666, 'territory'], [5555, 'raid']]);
    assert.equal(e[0].name, 'Rival Syndicate');
    assert.deepEqual(enemiesFromWars({ wars: { ranked: null, raids: [], territory: [] } }, 9001, nowS), []);
    const urls = [];
    const client = { get: async (p) => (urls.push(p), fx) };
    const w = await fetchFactionWars(client, 9001);
    assert.equal(urls[0], 'v2/faction/9001/wars');
    assert.equal(w.wars.ranked.war_id, 25000);
    await fetchFactionWars(client);
    assert.equal(urls[1], 'v2/faction/wars');
});

test('war: online dot and last active, out-times with TCT and countdown, early outs, jail, travel, fallen last', async () => {
    const { members } = await fixture('faction-members-war.json');
    const now = 1790000000 * 1000;
    const by = Object.fromEntries(members.map((m) => [m.name, m]));
    assert.deepEqual(activityOf(by.Rival, now), { kind: 'online', at: 1789999990000, text: 'Online' });
    assert.equal(activityOf(by.Brix, now).text, 'Idle · 16 min ago');
    assert.equal(activityOf(by.Flyer, now).text, '3 h ago');
    const o = { now, clockFn: tornClock, countdownFn: countdown };
    assert.equal(statusText(statusParts(by.Brix, { now }), o), 'Hospital · out 14:16 TCT (3:10) · may leave early · revivable');
    assert.equal(statusText(statusParts(by.Jailbird, { now }), o), 'Jail · out 14:25 TCT (12:00)');
    const seen = now - 6 * 60000;
    assert.equal(statusText(statusParts(by.Flyer, { now, seenAt: seen }), o), '→ Mexico, lands ~' + tornClock(seen + FLIGHT_MIN.mexico * 60000) + ' (est.)');
    assert.match(statusText(statusParts(by.Homer, { now, seenAt: seen }), o), /^← from Mexico, lands ~\d\d:\d\d \(est\.\)$/);
    assert.equal(statusText(statusParts(by.Rival, { now }), o), 'Okay · attack now');
    assert.equal(statusText(statusParts(by.Rival, { now, early: true }), o), 'Out early · attack now');
    assert.equal(statusText(statusParts(by.Ghost, { now }), o), 'Fallen');
    assert.equal(memberState(by.Ghost), 'fallen');
    const order = sortWar(members, { nowS: now / 1000 }).map((r) => r.m.name);
    assert.equal(order[order.length - 1], 'Ghost', 'the fallen at the bottom');
    assert.equal(order[0], 'Rival');
});

test('flights: first seen is kept across reads and reloads (GM storage); a landing ends it', async () => {
    const { members } = await fixture('faction-members-war.json');
    const t0 = Date.now();
    const a = trackFlights({}, members, t0);
    assert.equal(a.changed, true);
    assert.deepEqual(Object.keys(a.seen).sort(), ['515151', '515152']);
    const b = trackFlights(a.seen, members, t0 + 60000);
    assert.equal(b.changed, false);
    assert.equal(b.seen['515151'].at, t0, 'the first sighting stays');
    const landed = members.map((m) => (m.id === 515151 ? { ...m, status: { state: 'Okay', description: 'Okay' } } : m));
    assert.equal(trackFlights(b.seen, landed, t0 + 120000).seen['515151'], undefined);
    rememberFlights(members, t0);
    rememberFlights(members, t0 + 5000);
    assert.equal(flightsSeen()['515151'].at, t0, 'stored, so a reload keeps the estimate');
});

/* ---------------------------------------------------------------- watch */

test('watch list: 20 at most, a short reason, remove; nothing added by itself', () => {
    let s = { list: [], dismissed: {} };
    for (let i = 1; i <= WATCH_MAX; i++) s = addWatch(s, { id: i, name: 'W' + i }).state;
    const full = addWatch(s, { id: 99 });
    assert.equal(full.ok, false);
    assert.equal(full.reason, 'full');
    s = tagWatch(s, 3, '   get   them   for the   bounty  on  their head ');
    assert.equal(s.list.find((x) => x.id === 3).tag.length, TAG_MAX);
    assert.equal(normTag('  mug '), 'mug');
    assert.equal(normTag(''), null);
    s = removeWatch(s, 3);
    assert.equal(s.list.length, WATCH_MAX - 1);
    assert.equal(addWatch(s, { id: 99, tag: 'revenge' }).state.list.at(-1).tag, 'revenge');
});

test('watch reads: every 60 s, every 5 min for a long hospital stay; came online and out of hospital are noticed', () => {
    const now = 1790000000000;
    assert.equal(dueForRead(null, now), true);
    assert.equal(dueForRead({ readAt: now - 30000, status: { state: 'Okay' } }, now), false);
    assert.equal(dueForRead({ readAt: now - WATCH_POLL_MS, status: { state: 'Okay' } }, now), true);
    assert.equal(dueForRead({ readAt: now - WATCH_POLL_MS, status: { state: 'Hospital', until: now / 1000 + 3600 } }, now), false);
    assert.equal(dueForRead({ readAt: now - WATCH_SLOW_MS, status: { state: 'Hospital', until: now / 1000 + 3600 } }, now), true);
    const prev = { last_action: { status: 'Offline' }, status: { state: 'Hospital' } };
    const cur = { last_action: { status: 'Online' }, status: { state: 'Okay' } };
    assert.deepEqual(readEvents(prev, cur, now).map((e) => e.kind), ['online', 'out']);
});

test('heads-ups: out of hospital within 3 min, lands within 3 min (seen leaving), came online', () => {
    const now = 1790000000000;
    const list = [{ id: 1, name: 'Brix' }, { id: 2, name: 'Flyer' }, { id: 3, name: 'Rival' }, { id: 4, name: 'Later' }];
    const states = {
        1: { status: { state: 'Hospital', until: now / 1000 + 150 } },
        2: { status: { state: 'Traveling', description: 'Traveling to Mexico' } },
        3: { status: { state: 'Okay' }, events: [{ kind: 'online', at: now - 60000 }] },
        4: { status: { state: 'Hospital', until: now / 1000 + 900 } },
    };
    const flights = { 2: { desc: 'Traveling to Mexico', at: now - (FLIGHT_MIN.mexico - 2) * 60000 } };
    const hu = headsUps(list, states, flights, now);
    assert.deepEqual(hu.map((x) => x.kind), ['online', 'lands', 'hospital']);
    assert.equal(hu[2].text, 'Brix is out of hospital in 2:30');
    assert.equal(hu[1].text, 'Flyer lands in Mexico in about 2:00');
    assert.equal(headsUps(list, states, {}, now).some((x) => x.kind === 'lands'), false, 'no landing heads-up without seeing them leave');
});

test('"Watch?" offers: who attacked or mugged you in the last hour, once each, not watched, not dismissed', () => {
    const nowS = 1790000000;
    const me = 2345678;
    const attacks = [
        { attacker: { id: 11, name: 'Mugger', level: 40 }, defender: { id: me }, ended: nowS - 600, result: 'Mugged' },
        { attacker: { id: 11, name: 'Mugger', level: 40 }, defender: { id: me }, ended: nowS - 900, result: 'Attacked' },
        { attacker: { id: 12, name: 'Old', level: 50 }, defender: { id: me }, ended: nowS - 7200, result: 'Hospitalized' },
        { attacker: null, defender: { id: me }, ended: nowS - 60, result: 'Hospitalized' },
        { attacker: { id: me }, defender: { id: 13, level: 20 }, ended: nowS - 60, result: 'Hospitalized', modifiers: { fair_fight: 2 } },
        { attacker: { id: 14, name: 'Hitter', level: 70 }, defender: { id: me }, ended: nowS - 1200, result: 'Hospitalized' },
    ];
    const slim = slimAttacks(attacks, me, nowS);
    assert.deepEqual(slim.list.map((a) => a.def), [13], 'your own attacks, as before');
    assert.deepEqual(slim.incoming.map((a) => a.att), [11, 11, 12, 14], 'attacks on you (stealthed ones name nobody)');
    const now = nowS * 1000;
    let s = { list: [], dismissed: {} };
    let offers = watchOffers(slim.incoming, s, now);
    assert.deepEqual(offers.map((o) => [o.id, o.mugged]), [[11, true], [14, false]]);
    s = dismissOffer(s, 11, now);
    s = addWatch(s, { id: 14 }).state;
    assert.deepEqual(watchOffers(slim.incoming, s, now), []);
    offers = watchOffers([{ att: 11, ended: nowS + 60, result: 'Attacked' }], s, now + 120000);
    assert.equal(offers.length, 1, 'a new attack after "Not now" is offered again');
});

test('pollWatch: one profile per due player through the Torn client, a war list costs nothing, then waits 60 s', async () => {
    setKey(K.apiKey, 'HarnessKey123456');
    set(WATCH_KEY, null);
    set(WATCH_STATE_KEY, null);
    const nowS = Math.floor(Date.now() / 1000);
    const profiles = {
        21: { id: 21, name: 'Brix', level: 67, life: { maximum: 7300 }, status: { state: 'Hospital', until: nowS + 120, description: 'In hospital' }, last_action: { status: 'Offline', timestamp: nowS - 600 }, revivable: true },
        22: { id: 22, name: 'Flyer', level: 40, life: { maximum: 5000 }, status: { state: 'Traveling', description: 'Traveling to Mexico' }, last_action: { status: 'Idle', timestamp: nowS - 60 } },
    };
    const calls = [];
    pi.client = { get: async (path) => { calls.push(path); const m = path.match(/^v2\/user\/(\d+)\/profile$/); return m ? { profile: profiles[m[1]] } : {}; } };
    assert.equal(toggleWatch({ id: 21, name: 'Brix', level: 67 }).watching, true);
    toggleWatch({ id: 22, name: 'Flyer', level: 40 });
    toggleWatch({ id: 23, name: 'Rival', level: 64 });
    setWatchTag(21, 'revenge');
    const war = [{ id: 23, name: 'Rival', level: 64, status: { state: 'Okay', description: 'Okay' }, last_action: { status: 'Online', timestamp: nowS } }];
    assert.equal(await pollWatch({ members: war }), true);
    assert.deepEqual(calls.filter((p) => p.includes('/profile')).sort(), ['v2/user/21/profile', 'v2/user/22/profile'], 'the war member was not asked');
    const st = watchStates().players;
    assert.equal(st[21].status.state, 'Hospital');
    assert.equal(st[21].is_revivable, true);
    assert.equal(st[23].last_action.status, 'Online');
    assert.ok(flightsSeen()['22'], 'the flight is remembered for the landing estimate');
    assert.equal(getWatch().list.find((x) => x.id === 21).tag, 'revenge');
    const before = calls.length;
    assert.equal(await pollWatch(), false, 'nothing due within 60 s');
    assert.equal(calls.length, before);
    // Five minutes later (a flight is read on the slow clock) Brix is out and Flyer came online.
    const old = get(WATCH_STATE_KEY, null);
    for (const k of Object.keys(old.players)) old.players[k].readAt -= WATCH_SLOW_MS + 1000;
    set(WATCH_STATE_KEY, { ...old, lockAt: 0 });
    profiles[21] = { ...profiles[21], status: { state: 'Okay', description: 'Okay' } };
    profiles[22] = { ...profiles[22], last_action: { status: 'Online', timestamp: nowS } };
    await pollWatch();
    const hu = headsUps(getWatch().list, watchStates().players, flightsSeen(), Date.now());
    assert.ok(hu.some((x) => x.kind === 'out' && x.id === 21), JSON.stringify(hu));
    assert.ok(hu.some((x) => x.kind === 'online' && x.id === 22));
    assert.equal(toggleWatch({ id: 23 }).watching, false, 'stays until removed');
    set('myAttacks', { at: Date.now(), list: [], incoming: [{ att: 31, name: 'Mugger', level: 30, ended: nowS - 60, result: 'Mugged' }] });
    assert.deepEqual(watchOffersNow().map((o) => o.id), [31]);
    pi.client = null;
});

/* ----------------------------------------------------------------- sync */

test('sync: war (≤100) and watch (≤50) rows for the Worker, band/win/keep cleaned; sig changes with them', () => {
    const members = Array.from({ length: 120 }, (_, i) => ({ id: i + 1, name: 'M' + i, level: 50, band: i === 0 ? 'weird' : i === 2 ? 'fair' : i === 3 ? 'low' : i === 4 ? 'cant' : 'good', win: i === 1 ? 104.4 : 91.6, keep: null }));
    const watch = Array.from({ length: 60 }, (_, i) => ({ id: 1000 + i, name: 'W' + i, level: 10, band: 'stomp', win: 100, keep: 88, tag: 'a much too long reason for the worker' }));
    setEyeForSync({ war: { factionId: 7777, members }, watch });
    const p = eyeSyncPayload();
    assert.equal(p.war.factionId, 7777);
    assert.equal(p.war.members.length, 100);
    assert.deepEqual(p.war.members[0], { id: 1, name: 'M0', level: 50, band: 'none', win: 92, keep: null });
    assert.equal(p.war.members[1].win, 100);
    assert.deepEqual(p.war.members.slice(2, 5).map((r) => r.band), ['fair', 'low', 'low'], 'round 7 bands; an old "can’t win" goes as under 50%');
    assert.equal(p.watch.length, 50);
    assert.deepEqual(Object.keys(p.watch[0]), ['id', 'name', 'level', 'band', 'win', 'keep', 'tag']);
    assert.equal(p.watch[0].tag.length, 24);
    const sig = p.sig;
    setEyeForSync({ war: null, watch: watch.slice(0, 2) });
    assert.notEqual(eyeSyncPayload().sig, sig);
    assert.equal(eyeSyncPayload().war, null);
});
