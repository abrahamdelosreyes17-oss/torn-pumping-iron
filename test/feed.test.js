import test from 'node:test';
import assert from 'node:assert/strict';

import { StateFeed, STATE_POLL_MS } from '../src/feed/state.js';
import { TornApiClient } from '../src/api/client.js';

function memStore() {
    const m = new Map();
    return { m, get: (k, fb) => (m.has(k) ? JSON.parse(m.get(k)) : fb), set: (k, v) => m.set(k, JSON.stringify(v)), del: (k) => m.delete(k) };
}

function userApi({ drug = 0, dex = 82700, energy = 20, refill = false } = {}) {
    return {
        bars: { energy: { current: energy, maximum: 150, increment: 5, interval: 600, tick_time: 120 }, happy: { current: 5025, maximum: 5025, increment: 5, interval: 900, tick_time: 300 } },
        cooldowns: { drug, booster: 0, medical: 0 },
        refills: { energy: refill },
        battlestats: { strength: { value: 118400 }, speed: { value: 110900 }, defense: { value: 96200 }, dexterity: { value: dex } },
        gym: { id: 18, name: 'Gun Shop' },
    };
}

function fakeTorn(script) {
    const calls = [];
    const f = async (url) => {
        calls.push(url);
        const u = new URL(url);
        const body = script(u);
        return { ok: true, status: 200, json: async () => body };
    };
    f.calls = calls;
    return f;
}

function staticAnswers(u, user) {
    const p = u.pathname;
    if (p === '/v2/user' && u.searchParams.get('selections')) return user();
    if (p === '/v2/user/perks') return { perks: { property: ['+ 2% gym gains'] } };
    if (p === '/v2/user/property') return { property: { happy: 5025, property: { name: 'Private Island' } } };
    if (p === '/v2/torn/gyms') return { gyms: [{ id: 18, name: 'Gun Shop', energy_cost: 10, modifiers: { strength: 6.5, speed: 6.4, defense: 6.2, dexterity: 6.2 } }] };
    if (p === '/v2/user/inventory') return { inventory: { items: u.searchParams.get('cat') === 'Drug' ? [{ id: 206, amount: 1 }] : [] } };
    if (p === '/v2/key/info') return { info: { access: { level: 3, type: 'Limited Access' }, user: { id: 1 } } };
    return {};
}

test('the leader polls the user state at most every 30 s, and stores it for every tab', async () => {
    let t = 1_790_000_000_000;
    const store = memStore();
    let user = userApi();
    const f = fakeTorn((u) => staticAnswers(u, () => user));
    const client = new TornApiClient({ getKey: () => 'k'.repeat(16), fetchImpl: f, maxRetries: 0, dedupTtlMs: 0 });
    const feed = new StateFeed({ client, store, tabId: 'A', now: () => t });
    assert.equal(await feed.tick(), false, 'first heartbeat claims, not yet confirmed');
    assert.equal(await feed.tick(), true, 'confirmed leader polls');
    const n = f.calls.filter((c) => c.includes('selections=')).length;
    assert.equal(n, 1);
    t += 10000;
    assert.equal(await feed.tick(), false, 'not due yet');
    t += STATE_POLL_MS;
    assert.equal(await feed.tick(), true);
    assert.equal(f.calls.filter((c) => c.includes('selections=')).length, 2);
    assert.equal(feed.current().energy.current, 20);
    const st = store.get('userStatic');
    assert.equal(st.property.happy, 5025);
    assert.deepEqual(st.inventory, { 206: 1 });
    assert.equal(st.keyInfo.level, 3);
    assert.equal(st.gyms[0].name, 'Gun Shop');
});

test('a second tab follows: it never polls while the leader is alive', async () => {
    let t = 1_790_000_000_000;
    const store = memStore();
    const f = fakeTorn((u) => staticAnswers(u, userApi));
    const client = new TornApiClient({ getKey: () => 'k'.repeat(16), fetchImpl: f, maxRetries: 0, dedupTtlMs: 0 });
    const a = new StateFeed({ client, store, tabId: 'A', now: () => t });
    const b = new StateFeed({ client, store, tabId: 'B', now: () => t });
    await a.tick();
    await a.tick();
    const before = f.calls.length;
    t += 40000;
    assert.equal(await b.tick(), false);
    assert.equal(f.calls.length, before);
    assert.equal(b.current().gymId, 18, 'but reads the stored state');
});

test('a hidden tab never polls', async () => {
    const store = memStore();
    const f = fakeTorn((u) => staticAnswers(u, userApi));
    const client = new TornApiClient({ getKey: () => 'k'.repeat(16), fetchImpl: f, maxRetries: 0 });
    const feed = new StateFeed({ client, store, tabId: 'A', isVisible: () => false });
    await feed.tick();
    await feed.tick();
    assert.equal(f.calls.length, 0);
});

test('state changes become done steps in the day log', async () => {
    let t = Date.UTC(2026, 8, 29, 10, 50);
    const store = memStore();
    let user = userApi({ drug: 0 });
    const f = fakeTorn((u) => staticAnswers(u, () => user));
    const client = new TornApiClient({ getKey: () => 'k'.repeat(16), fetchImpl: f, maxRetries: 0, dedupTtlMs: 0 });
    const feed = new StateFeed({ client, store, tabId: 'A', now: () => t, nextStep: () => ({ kind: 'xanax', label: 'Xanax #2' }) });
    await feed.tick();
    await feed.tick();
    user = userApi({ drug: 7 * 3600, dex: 84100, energy: 5 });
    t += STATE_POLL_MS;
    await feed.tick();
    const log = store.get('dayLog');
    assert.equal(log.length, 1);
    assert.equal(log[0].label, 'Xanax #2');
    assert.deepEqual(log[0].trained, { dex: 1400 });
    const hist = store.get('statsHistory');
    assert.equal(Object.values(hist)[0].dex, 84100);
});

test('a dead key (Torn error 2) stops the feed until a new key is saved', async () => {
    let t = 1_790_000_000_000;
    const store = memStore();
    const f = fakeTorn(() => ({ error: { code: 2, error: 'Incorrect key' } }));
    const client = new TornApiClient({ getKey: () => 'k'.repeat(16), fetchImpl: f, maxRetries: 0, dedupTtlMs: 0 });
    const errors = [];
    const feed = new StateFeed({ client, store, tabId: 'A', now: () => t, onError: (e) => errors.push(e) });
    await feed.tick();
    await feed.tick();
    assert.equal(store.get('apiKeyDead'), true);
    const n = f.calls.length;
    t += STATE_POLL_MS * 2;
    await feed.tick();
    assert.equal(f.calls.length, n, 'nothing more is sent');
    assert.equal(errors.length, 1);
});

test('slower parts refresh on their own clocks, not every poll', async () => {
    let t = 1_790_000_000_000;
    const store = memStore();
    const f = fakeTorn((u) => staticAnswers(u, userApi));
    const client = new TornApiClient({ getKey: () => 'k'.repeat(16), fetchImpl: f, maxRetries: 0, dedupTtlMs: 0 });
    const feed = new StateFeed({ client, store, tabId: 'A', now: () => t });
    await feed.tick();
    await feed.tick();
    const perksCalls = () => f.calls.filter((c) => c.includes('/v2/user/perks')).length;
    assert.equal(perksCalls(), 1);
    for (let i = 0; i < 5; i++) {
        t += STATE_POLL_MS;
        await feed.tick();
    }
    assert.equal(perksCalls(), 1, 'perks once an hour');
    t += 3600e3;
    await feed.tick();
    assert.equal(perksCalls(), 2);
});
