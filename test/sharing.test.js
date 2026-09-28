/*
 * What tabs share: the Torn API request window (one per tab, added up), the
 * pause after an IP block / outage / rate block, and "never from a hidden
 * tab". Review findings S3, B2, B3 (2026-09-27).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { tabWindow, TAB_WINDOW_STALE_MS } from '../src/platform/tab-window.js';
import { TornApiClient, TORN_ERROR_IP_BLOCK, TORN_PAUSE_MS } from '../src/api/client.js';

function store() {
    const data = new Map();
    return {
        data,
        get: (k, fb) => (data.has(k) ? JSON.parse(data.get(k)) : fb),
        set: (k, v) => data.set(k, JSON.stringify(v)),
        del: (k) => data.delete(k),
    };
}

test('two tabs taking slots never erase each other: the total is every tab\'s slots', () => {
    const s = store();
    let t = 1_000_000;
    const now = () => t;
    const a = tabWindow('w', 'A', s, now);
    const b = tabWindow('w', 'B', s, now);
    a.add(t);
    b.add(t);
    a.add(t + 1);
    b.add(t + 1);
    b.add(t + 2);
    assert.equal(a.load().length, 5);
    assert.equal(b.load().length, 5);
    // The old single array: B wrote back [its view + its slot] and A's were gone.
    // Here each tab writes only its own key.
    assert.deepEqual(s.get('w.A'), [t, t + 1]);
    assert.deepEqual(s.get('w.B'), [t, t + 1, t + 2]);
});

test('a registry write lost to a race heals on that tab\'s next slot', () => {
    const s = store();
    let t = 1_000_000;
    const now = () => t;
    const a = tabWindow('w', 'A', s, now);
    const b = tabWindow('w', 'B', s, now);
    a.add(t);
    b.add(t);
    // B registered from a stale copy that did not have A yet.
    s.set('w.tabs', { B: t });
    assert.equal(b.load().length, 1, 'A is uncounted for now');
    assert.equal(a.load().length, 2, 'A still counts its own');
    t += 10;
    a.add(t);
    assert.equal(b.load().length, 3, 'A is back, with every slot it took');
});

test('slots older than a minute stop counting; a tab gone for 2 minutes is removed', () => {
    const s = store();
    let t = 1_000_000;
    const now = () => t;
    const a = tabWindow('w', 'A', s, now);
    const b = tabWindow('w', 'B', s, now);
    a.add(t);
    b.add(t);
    t += 61_000;
    assert.equal(a.load().length, 0);
    t += TAB_WINDOW_STALE_MS;
    a.add(t);
    assert.equal(s.data.has('w.B'), false, 'the closed tab\'s key is deleted');
    assert.deepEqual(Object.keys(s.get('w.tabs')), ['A']);
});

/* ------------------------------------------------------------ the pause */

const ok = (body) => ({ ok: true, status: 200, json: async () => body });

function sharedClients(fetchImpl) {
    const s = store();
    const make = () => new TornApiClient({
        getKey: () => 'abcdefgh12345678',
        fetchImpl,
        dedupTtlMs: 0,
        loadPause: () => s.get('pause', null),
        savePause: (p) => s.set('pause', p),
    });
    return [make(), make()];
}

test('an IP block (8) in one tab stops every tab from asking Torn for 10 minutes', async (t) => {
    let calls = 0;
    const [a, b] = sharedClients(async () => {
        calls += 1;
        return ok({ error: { code: TORN_ERROR_IP_BLOCK, error: 'IP block' } });
    });
    await assert.rejects(a.get('user'), (e) => e.code === 8 && !e.paused);
    assert.equal(calls, 1, 'not retried');
    await assert.rejects(b.get('torn'), (e) => e.paused && /blocked this IP/.test(e.message));
    await assert.rejects(a.get('market'), (e) => e.paused);
    assert.equal(calls, 1, 'nothing sent during the pause, from either tab');

    // After the pause both may ask again.
    t.mock.timers.enable({ apis: ['Date'], now: Date.now() + TORN_PAUSE_MS[8] + 1000 });
    await assert.rejects(b.get('torn'), (e) => e.code === 8 && !e.paused);
    assert.equal(calls, 2);
});

test('the API being down (9) is not retried at 1-2-4 s; it pauses instead', async () => {
    let calls = 0;
    const [a, b] = sharedClients(async () => {
        calls += 1;
        return ok({ error: { code: 9, error: 'API disabled' } });
    });
    await assert.rejects(a.get('user'), (e) => e.code === 9);
    await assert.rejects(b.get('user'), (e) => e.paused && /down/.test(e.message));
    assert.equal(calls, 1);
});

test('a request queued in a visible tab is not sent once the tab is hidden', async () => {
    let visible = false;
    let calls = 0;
    const c = new TornApiClient({
        getKey: () => 'abcdefgh12345678',
        fetchImpl: async () => {
            calls += 1;
            return ok({ fine: true });
        },
        isVisible: () => visible,
    });
    const p = c.get('user');
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(calls, 0, 'hidden: nothing sent');
    visible = true;
    assert.deepEqual(await p, { fine: true }, 'sent once visible again');
    assert.equal(calls, 1);
});
