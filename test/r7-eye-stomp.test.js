/*
 * Round 7, Torn Eye's smarter target asks (the owner, 2026-10-03): the stomp edge found with our own fight model, the
 * asks just under it (high levels first, then lower), each answer judged at once, the asking stopped once the list
 * holds 100 Stomps and a reserve of 100 (or after 6 asks), and hit → drop → refill when the reserve runs low.
 * A made-up FFScouter (strongest first inside the asked range, 50 at most); no live call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { pi } from '../src/runtime.js';
import { makeFfsClient } from '../src/api/ffscouter.js';
import { bssOf } from '../src/core/eye/fight.js';
import { totalFromBss } from '../src/core/eye/estimate.js';
import {
    findEdges,
    edgeFor,
    keepAt,
    askPlan,
    nextAsk,
    noteAnswer,
    pickZone,
    zoneOpen,
    judgeTarget,
    dropHits,
    targetParams,
    TARGET_FF,
    TARGET_ASKS_MAX,
    ACTIVE_MAX,
    LIST_MAX,
    RESERVE_LOW,
    REFILL_GAP_MS,
} from '../src/core/eye/targets.js';
import { importTargets, refillTargets, myEdges } from '../src/eye-service.js';
import { shouldRefill } from '../src/ui/app/eye-tab.js';

/* The owner (2026-09-29, as in eye-r4.test.js): 172M as he fights, SPD only 4M, life 2,375. */
const OWNER_RAW = { str: 35.4e6, spd: 4.06e6, def: 82.4e6, dex: 20.5e6 };
const MOD = 172e6 / (35.4e6 + 4.06e6 + 82.4e6 + 20.5e6);
const OWNER = Object.fromEntries(Object.entries(OWNER_RAW).map(([k, v]) => [k, v * MOD]));
const OWNER_LIFE = 2375;
const MY_BSS = bssOf(OWNER);
const NOW_S = Math.floor(Date.now() / 1000);
const EDGES = findEdges({ me: OWNER, myLife: OWNER_LIFE });

function ownerModel() {
    const p = (MOD - 1) * 100;
    pi.model = { ready: true, pc: { stats: { ...OWNER_RAW } }, state: { statMods: { str: p, spd: p, def: p, dex: p }, life: { current: OWNER_LIFE, maximum: OWNER_LIFE } } };
}

/** A dense made-up Torn: 20,000 inactive players, levels 1–100, fair fight against the owner 1.0–3.5. */
const DENSE = Array.from({ length: 20000 }, (_, i) => {
    const ff = 1 + ((i * 7919) % 25000) / 10000;
    return { id: 6_000_000 + i, name: 'D' + i, level: 1 + ((i * 37) % 100), ff, bss: (3 / 8) * (ff - 1) * MY_BSS };
});

const res = (body, status = 200) => ({ status, ok: status >= 200 && status < 300, json: async () => body });

/** FFScouter's finder: the asked level and fair-fight range, strongest first, 50 at most; get-stats knows nobody. */
function fakeFfs(pop = DENSE) {
    const asks = [];
    const fetchImpl = async (url) => {
        const u = new URL(url);
        const q = (k, d) => (u.searchParams.has(k) ? Number(u.searchParams.get(k)) : d);
        if (u.pathname.endsWith('/get-targets')) {
            const a = { minLevel: q('minlevel', 1), maxLevel: q('maxlevel', 100), minFf: q('minff', 1), maxFf: q('maxff', 3), limit: q('limit', 20) };
            asks.push(a);
            const rows = pop.filter((p) => p.level >= a.minLevel && p.level <= a.maxLevel && p.ff >= a.minFf && p.ff <= a.maxFf).sort((x, y) => y.bss - x.bss).slice(0, a.limit);
            if (!rows.length) return res({ code: 17, error: 'No targets found' }, 404);
            return res({ parameters: {}, targets: rows.map((p) => ({ player_id: p.id, name: p.name, level: p.level, fair_fight: p.ff, bss_public: Math.round(p.bss), bs_estimate: Math.round(totalFromBss(p.bss)), last_action: NOW_S - 20 * 86400 })) });
        }
        if (u.pathname.endsWith('/get-stats')) return res((u.searchParams.get('targets') || '').split(',').map((id) => ({ player_id: Number(id) })));
        return res({}, 404);
    };
    return { client: makeFfsClient({ getKey: () => 'FfsKeyTest123456', fetchImpl, sleep: async () => {}, isVisible: () => true }), asks };
}

function fakeClock(start) {
    let t = start;
    return { now: () => t, sleep: async (ms) => { t += ms; }, tick: (ms) => (t += ms) };
}

/** A store in memory (the webpage's IndexedDB copy in the app). */
function memStore(initial = null) {
    let v = initial;
    return { load: () => v, store: (x) => (v = x) };
}

const judge = (r) => judgeTarget({ me: OWNER, myLife: OWNER_LIFE, row: r });

test('the stomp edge: the highest fair fight you still keep 99% against, by bisection on our fight model', () => {
    // A plain step: kept 100% up to 2.37, then 50%.
    assert.equal(edgeFor((ff) => (ff <= 2.37 ? 100 : 50), 99), 2.36);
    assert.equal(edgeFor(() => 100, 99), TARGET_FF.max, 'even the strongest is a Stomp');
    assert.equal(edgeFor(() => 0, 50), TARGET_FF.min, 'nobody is');
    // The owner: Stomp under Good under Fair, highest levels first (most life: the lowest edge).
    assert.deepEqual(EDGES.map((e) => e.maxLevel), [100, 67, 33]);
    for (const e of EDGES) assert.ok(TARGET_FF.min < e.stomp && e.stomp <= e.good && e.good <= e.fair && e.fair <= TARGET_FF.max, JSON.stringify(e));
    assert.ok(EDGES[0].stomp <= EDGES[1].stomp && EDGES[1].stomp <= EDGES[2].stomp, 'a lower level band (less life) has a higher edge');
    const at = (ff, level) => keepAt({ me: OWNER, myLife: OWNER_LIFE, level, ff });
    assert.ok(at(EDGES[0].stomp, 100) >= 99, 'at the edge: a Stomp');
    assert.ok(at(EDGES[0].stomp + 0.05, 100) < 99, 'just over it: not');
    assert.ok(at(EDGES[0].good, 100) >= 70 && at(EDGES[0].good + 0.05, 100) < 70);
});

test('myEdges: your side as it fights, worked out once per your-stats key', () => {
    ownerModel();
    const a = myEdges();
    assert.equal(myEdges(), a, 'cached');
    assert.deepEqual(a.map((e) => e.stomp), EDGES.map((e) => e.stomp), 'the same as the plain probe for the same stats, life and gear');
    pi.model = { ...pi.model, pc: { stats: Object.fromEntries(Object.entries(OWNER_RAW).map(([k, v]) => [k, v * 1.5])) } };
    const b = myEdges();
    assert.notEqual(b, a, 'new stats: worked out again');
    assert.equal(b.length, a.length);
    ownerModel();
});

test('the plan: high levels first, a cursor under each answer, a short answer ends the zone, an ignored range the band', () => {
    const plan = askPlan(EDGES);
    const q1 = nextAsk(plan, 'stomp', { inactiveOnly: 1 });
    assert.deepEqual([q1.minLevel, q1.maxLevel, q1.minFf, q1.maxFf], [68, 100, 1, EDGES[0].stomp]);
    // A full answer: the next ask of that band starts just under its weakest player.
    noteAnswer(plan, q1, Array.from({ length: 50 }, (_, i) => ({ playerId: i + 1, fairFight: EDGES[0].stomp - i / 1000 })));
    assert.equal(plan.bands[0].top.stomp, Math.round((EDGES[0].stomp - 0.049 - 0.01) * 100) / 100);
    // A short answer: that band's Stomp zone is done; the next band down is asked.
    noteAnswer(plan, nextAsk(plan, 'stomp'), [{ playerId: 99, fairFight: 1.5 }]);
    assert.equal(plan.bands[0].dry.stomp, true);
    assert.deepEqual([nextAsk(plan, 'stomp').minLevel, nextAsk(plan, 'stomp').maxLevel], [34, 67]);
    // FFScouter ignored the range: that band isn't asked again in any zone.
    const q3 = nextAsk(plan, 'stomp');
    noteAnswer(plan, q3, [{ fairFight: 7 }, { fairFight: 8 }, { fairFight: 9 }]);
    assert.equal(plan.bands[1].skip, true);
    assert.equal(plan.ffIgnored, true);
    // Good asks from the stomp edge up to the good edge.
    const g = nextAsk(plan, 'good');
    assert.deepEqual([g.minLevel, g.minFf, g.maxFf], [68, EDGES[0].stomp, EDGES[0].good]);
    // Stomps run short: the Stomp zone is done, or the rate so far won't reach 100 in the asks left.
    assert.equal(pickZone(askPlan(EDGES)), 'stomp');
    const thin = askPlan(EDGES);
    thin.asks.stomp = 2;
    assert.equal(pickZone(thin, { stomps: 10, asked: 2 }), 'good', '5 a ask: 30 at most');
    assert.equal(pickZone(thin, { stomps: 60, asked: 2 }), 'stomp', '30 a ask: 100 in reach');
    const done = askPlan(EDGES);
    for (const b of done.bands) for (const z of ['stomp', 'good', 'fair']) b.dry[z] = true;
    assert.equal(pickZone(done), null);
    assert.equal(zoneOpen(done, 'stomp'), false);
});

test('stop early: a dense Torn gives 100 Stomps and a full reserve in a few asks just under the edge, high levels first', async () => {
    const { client, asks } = fakeFfs();
    const m = memStore();
    const out = await importTargets(targetParams({}), { client, judge, edges: EDGES, ...m, ...fakeClock(1e12) });
    assert.ok(out.asked < TARGET_ASKS_MAX, 'stopped before the cap (' + out.asked + ' asks)');
    assert.equal(asks.length, out.asked);
    assert.equal(out.list.length, LIST_MAX);
    const stomps = out.list.filter((r) => r.band === 'stomp');
    assert.ok(stomps.length >= ACTIVE_MAX, stomps.length + ' Stomps');
    // The first ask is the top band right under its edge; every ask stays under it and steps down.
    assert.deepEqual([asks[0].minLevel, asks[0].maxLevel, asks[0].maxFf], [68, 100, EDGES[0].stomp]);
    assert.ok(asks.every((a, i) => i === 0 || a.maxFf <= asks[i - 1].maxFf || a.minLevel !== asks[i - 1].minLevel), 'each band steps down');
    assert.ok(asks.every((a) => a.maxFf <= EDGES.find((e) => e.minLevel === a.minLevel).stomp), 'only under the stomp edge: no Good or Fair asked');
    // The Stomps found are the strong ones (the most respect): close under the edge, not the weakest accounts.
    assert.ok(stomps.slice(0, ACTIVE_MAX).every((r) => r.fairFight > EDGES[0].stomp - 0.25), 'the active Stomps sit just under the edge');
    assert.equal(m.load().plan.bands[0].top.stomp < EDGES[0].stomp, true, 'the cursor is stored for a refill');
});

test('stop at the cap: when Stomps stay short, 6 asks (~300 players), Good asked once Stomps run short', async () => {
    const { client, asks } = fakeFfs();
    // A judge that finds a Stomp in only one player of ten (the rest under 50%).
    const rare = (r) => (r.playerId % 10 === 0 ? { band: 'stomp', win: 100, keep: 100, respect: 2, ours: r.fairFight } : { band: 'low', win: 40, keep: 20, respect: 2, ours: r.fairFight });
    const out = await importTargets(targetParams({}), { client, judge: rare, edges: EDGES, ...memStore(), ...fakeClock(2e12) });
    assert.equal(out.asked, TARGET_ASKS_MAX);
    assert.equal(asks.length, TARGET_ASKS_MAX, 'never more than the cap');
    assert.ok(out.found <= TARGET_ASKS_MAX * 50);
    assert.ok(out.dropped.low > 0);
    assert.ok(asks.some((a) => a.minFf > TARGET_FF.min), 'Stomps short: the Good range above the edge is asked too');
    assert.ok(asks.slice(0, 2).every((a) => a.minFf === TARGET_FF.min), 'Stomps first');
});

test('hit → drop → refill: the players you hit drop out, a low reserve asks once more, the gone ones stay out', async () => {
    const clk = fakeClock(3e12);
    const { client, asks } = fakeFfs();
    const m = memStore();
    await importTargets(targetParams({}), { client, judge, edges: EDGES, ...m, ...clk });
    const first = m.load();
    assert.equal(first.list.length, LIST_MAX);
    // You hit 90 of them: they drop out at once (the reserve now 10).
    const hit = first.list.slice(0, 90).map((r) => r.playerId);
    m.store(dropHits(first, new Map(hit.map((id) => [id, { kind: 'hit', at: clk.now(), result: 'Hospitalized' }])), clk.now()));
    const after = m.load();
    assert.equal(after.list.length, LIST_MAX - 90);
    const reserve = after.list.length - ACTIVE_MAX;
    assert.ok(reserve < RESERVE_LOW);
    const gates = { mode: 'targets', hasFfs: true, paused: false, loading: false, error: null, ready: true };
    clk.tick(REFILL_GAP_MS);
    assert.equal(shouldRefill({ ...gates, stored: after, reserve, now: clk.now() }), true, 'the reserve ran low: refill');
    const n = asks.length;
    const r = await refillTargets({ client, judge, ...m, ...clk });
    assert.equal(asks.length, n + 1, 'one ask');
    assert.ok(r.added > 0);
    const refilled = m.load();
    assert.equal(refilled.list.length, LIST_MAX - 90 + r.added);
    assert.ok(asks[n].maxFf <= first.plan.bands[0].top.stomp, 'it goes on under the last cursor');
    assert.ok(!refilled.list.some((x) => hit.includes(x.playerId)), 'nobody you hit came back');
    assert.equal(shouldRefill({ ...gates, stored: refilled, reserve, refilledAt: clk.now(), now: clk.now() + 1000 }), false, 'not again within the gap');
    // Asked from the top again (a reset plan): the players you hit are not brought back.
    m.store({ ...refilled, plan: askPlan(EDGES) });
    await refillTargets({ client, judge, ...m, ...clk });
    assert.ok(!m.load().list.some((x) => hit.includes(x.playerId)), 'gone stays gone');
});

test('the refill gates: a full reserve, a pause, a load under way, an old list, a plan with nothing left', async () => {
    const now = 4e12;
    const stored = { at: now - REFILL_GAP_MS - 1, params: targetParams({}), list: [], plan: askPlan(EDGES) };
    const base = { mode: 'targets', hasFfs: true, paused: false, loading: false, error: null, ready: true, stored, reserve: 5, now };
    assert.equal(shouldRefill(base), true);
    assert.equal(shouldRefill({ ...base, reserve: RESERVE_LOW }), false, 'the reserve is fine');
    assert.equal(shouldRefill({ ...base, paused: true }), false, 'Torn Trading runs');
    assert.equal(shouldRefill({ ...base, loading: true }), false);
    assert.equal(shouldRefill({ ...base, mode: 'war' }), false, 'Targets only');
    assert.equal(shouldRefill({ ...base, hasFfs: false }), false);
    assert.equal(shouldRefill({ ...base, stored: { ...stored, params: { v: 3 } } }), false, 'a list asked the old way is loaded again instead');
    assert.equal(shouldRefill({ ...base, stored: { ...stored, plan: { ...stored.plan, done: true } } }), false, 'nothing left to ask');
    assert.equal(shouldRefill({ ...base, stored: { ...stored, at: now - 1000 } }), false, 'a list just loaded');
    // A plan with nothing left: the refill says so and marks it done (asks nobody).
    const empty = askPlan(EDGES);
    for (const b of empty.bands) for (const z of ['stomp', 'good', 'fair']) b.dry[z] = true;
    const { client, asks } = fakeFfs();
    const m = memStore({ ...stored, plan: empty });
    assert.deepEqual(await refillTargets({ client, judge, ...m, ...fakeClock(now) }), { added: 0, done: true });
    assert.equal(asks.length, 0);
    assert.equal(m.load().plan.done, true);
});
