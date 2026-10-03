/*
 * Round 7 review, finding 4: every status answer (30 a minute while Targets shows) rewrote the whole eye cache to
 * IndexedDB 1.5 s later. A status answer now waits STATUS_SAVE_MS (one write for all of them); the statuses
 * themselves still go to their own small `eyeStatus` record within 3 s; a sooner save (an estimate) covers it.
 * A stand-in IndexedDB counts the writes; the clock is node's mock timers.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';

const data = new Map();
const puts = [];
const later = (fn) => setImmediate(fn);
globalThis.indexedDB = {
    open() {
        const r = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
        r.result = {
            transaction() {
                const tx = { oncomplete: null, onerror: null, onabort: null };
                const store = {
                    get(k) {
                        const q = { result: data.get(k), onsuccess: null };
                        queueMicrotask(() => q.onsuccess && q.onsuccess());
                        return q;
                    },
                    put(v, k) {
                        data.set(k, v);
                        puts.push(k);
                        return { result: k };
                    },
                    delete(k) {
                        data.delete(k);
                        return {};
                    },
                };
                tx.objectStore = () => store;
                later(() => tx.oncomplete && tx.oncomplete());
                return tx;
            },
        };
        later(() => r.onsuccess && r.onsuccess());
        return r;
    },
};

const { pi } = await import('../src/runtime.js');
const { K, set, setKey } = await import('../src/platform/store.js');
const { loadEyeCache, loadStatuses, pumpStatuses, statusRead, STATUS_SAVE_MS } = await import('../src/eye-service.js');

const settle = async (n = 5) => {
    for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

test('status answers write the eye cache once per 30 s, not 1.5 s after each one; the statuses still go to eyeStatus', async () => {
    setKey(K.apiKey, 'HarnessKey123456');
    set(K.apiKeyDead, false);
    pi.client = {
        get: async (path) => {
            const id = Number(path.match(/^v2\/user\/(\d+)\/profile$/)[1]);
            return { profile: { id, name: 'P' + id, level: 40, life: { maximum: 5000 }, status: { state: 'Okay', description: 'Okay', until: 0 } } };
        },
    };
    await loadEyeCache();
    await loadStatuses();
    await settle();
    puts.length = 0;
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        assert.deepEqual(pumpStatuses({ order: [901, 902, 903] }), [901, 902, 903]);
        await settle();
        assert.equal(statusRead(901).status.state, 'Okay');
        mock.timers.tick(1600);
        await settle();
        assert.equal(puts.filter((k) => k === 'eye').length, 0, 'not 1.5 s after each answer');
        mock.timers.tick(2000);
        await settle();
        assert.equal(puts.filter((k) => k === 'eyeStatus').length, 1, 'the statuses themselves within 3 s');
        // More answers before the 30 s are up: still one write.
        mock.timers.tick(5000);
        assert.deepEqual(pumpStatuses({ order: [904, 905] }), [904, 905]);
        await settle();
        mock.timers.tick(STATUS_SAVE_MS);
        await settle();
        assert.equal(puts.filter((k) => k === 'eye').length, 1, 'one write for all of them');
        assert.equal(data.get('eye').players[905].profile.level, 40, 'level and life kept for the fight model');
        // Nothing waiting: no further write.
        mock.timers.tick(STATUS_SAVE_MS * 2);
        await settle();
        assert.equal(puts.filter((k) => k === 'eye').length, 1);
    } finally {
        mock.timers.reset();
    }
    assert.equal(STATUS_SAVE_MS, 30000);
});
