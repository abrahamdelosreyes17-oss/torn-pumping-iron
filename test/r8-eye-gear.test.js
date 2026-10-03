/*
 * Round 8, backlog B.6 (the owner: "even after attacking them many times I still can't see what they were wearing").
 * The attack page read their gear and showed "saved for next time", but the save itself could be lost two ways:
 *   1. it waited 1.5 s after the LAST answer, and Torn answers after every hit: in a fast fight the wait started again
 *      each time, and leaving the page inside it (the next target of a chain) dropped the write;
 *   2. every Torn tab wrote its whole copy of the cache: a tab that loaded before the fight (a profile, a faction
 *      page, the next attack page) wrote its older copy afterwards and the gear was gone.
 * Now the gear is written at once, by itself, in one read-change-write on what is stored, and every later write keeps
 * the gear seen last per player. A stand-in IndexedDB holds what is "on disk"; the clock is node's mock timers.
 */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const data = new Map();
const later = (fn) => setImmediate(fn);
globalThis.indexedDB = {
    open() {
        const r = { result: null, onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null };
        r.result = {
            transaction() {
                const tx = { oncomplete: null, onerror: null, onabort: null };
                const store = {
                    get(k) {
                        // What a tab reads is its own copy (structured clone), as in a real IndexedDB.
                        const v = data.get(k);
                        const q = { result: v === undefined ? undefined : structuredClone(v), onsuccess: null };
                        queueMicrotask(() => q.onsuccess && q.onsuccess());
                        return q;
                    },
                    put(v, k) {
                        data.set(k, structuredClone(v));
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
const { parseAttackData, mergeGear, sameGear } = await import('../src/core/eye/gear.js');
// Two Torn tabs: each has its own copy of the cache in memory, both write the one IndexedDB.
const tabA = await import('../src/eye-service.js?tab=a');
const tabB = await import('../src/eye-service.js?tab=b');

const settle = async (n = 6) => {
    for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
};

const fixture = JSON.parse(await readFile(new URL('./fixtures/attackData.json', import.meta.url), 'utf8'));
const seen = parseAttackData(fixture);

test('the attack page answer on the harness: their weapons, armour and temporary, visible once the fight starts', () => {
    assert.equal(seen.defenderId, 424242);
    assert.equal(seen.visible, true);
    assert.deepEqual(seen.items.filter((i) => ['1', '2', '3'].includes(i.slot)).map((i) => i.name), ['AK-47', 'Beretta M9', 'Butterfly Knife']);
    assert.ok(seen.items.some((i) => i.slot === '5' && i.name === 'Tear Gas'), 'the temporary is kept for the card (it has no copy id)');
    assert.ok(!seen.items.some((i) => Number(i.slot) > 9), 'fists and kicks are not gear');
});

test('gear read in a fast fight is on disk when you leave the page (it waited 1.5 s after the last answer)', async () => {
    await tabA.loadEyeCache();
    await settle();
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        // Start fight, then a hit a second: Torn answers each time with the same gear.
        for (let i = 0; i < 5; i++) {
            await tabA.saveGear(seen.defenderId, seen.items);
            mock.timers.tick(1000);
        }
        // The fight is over: the next target's attack page opens a second later. Nothing else gets to run.
        await settle();
        const kept = data.get('eye');
        assert.ok(kept && kept.gear && kept.gear[424242], 'their gear is stored');
        assert.equal(kept.gear[424242].items.find((i) => i.slot === '1').name, 'AK-47');
    } finally {
        mock.timers.reset();
    }
});

test('the same gear answered again in the same fight is not written again', async () => {
    const before = data.get('eye').gear[424242].seenAt;
    assert.equal(await tabA.saveGear(seen.defenderId, seen.items), false);
    await settle();
    assert.equal(data.get('eye').gear[424242].seenAt, before);
});

test('another Torn tab that loaded before the fight does not wipe it with its older copy', async () => {
    data.clear();
    setKey(K.apiKey, 'HarnessKey123456');
    set(K.apiKeyDead, false);
    pi.client = {
        get: async (path) => {
            const id = Number(path.match(/^v2\/user\/(\d+)\/profile$/)[1]);
            return { profile: { id, name: 'P' + id, level: 40, life: { maximum: 5000 }, status: { state: 'Okay', description: 'Okay', until: 0 } } };
        },
    };
    // Tab B (a faction page, say) loads the cache: no gear in it yet.
    await tabB.clearEye();
    await tabB.loadEyeCache();
    await tabB.loadStatuses();
    await settle();
    // Tab A: the fight, their gear is read and stored.
    await tabA.clearEye();
    await tabA.saveGear(seen.defenderId, seen.items);
    await settle();
    assert.ok(data.get('eye').gear[424242], 'stored by the attack page');
    // Tab B writes its copy later (a status answer, 30 s on).
    mock.timers.enable({ apis: ['setTimeout'] });
    try {
        tabB.pumpStatuses({ order: [901] });
        await settle();
        mock.timers.tick(tabB.STATUS_SAVE_MS + 100);
        await settle();
    } finally {
        mock.timers.reset();
    }
    const kept = data.get('eye');
    assert.equal(kept.players[901].profile.level, 40, 'tab B did write');
    assert.ok(kept.gear[424242], 'and the gear the attack page saved is still there');
    assert.equal(await tabB.gearCount(), 1, 'tab B knows it too now');
});

test('mergeGear: per player the gear seen last; nothing from before a Clear', () => {
    const a = { 1: { items: [{ name: 'old' }], seenAt: 100 }, 2: { items: [], seenAt: 300 } };
    const b = { 1: { items: [{ name: 'new' }], seenAt: 200 }, 3: { items: [], seenAt: 50 } };
    const m = mergeGear(a, b);
    assert.equal(m[1].items[0].name, 'new');
    assert.deepEqual(Object.keys(m).sort(), ['1', '2', '3']);
    assert.deepEqual(Object.keys(mergeGear(a, b, 150)).sort(), ['1', '2'], 'entries seen before the Clear are gone');
    assert.deepEqual(mergeGear(null, null), {});
});

test('sameGear: the same copies in the same slots', () => {
    assert.equal(sameGear(seen.items, structuredClone(seen.items)), true);
    assert.equal(sameGear(seen.items, seen.items.slice(1)), false);
    assert.equal(sameGear(seen.items, seen.items.map((i, n) => (n ? i : { ...i, dmg: i.dmg + 1 }))), false);
    assert.equal(sameGear(null, []), true);
});
