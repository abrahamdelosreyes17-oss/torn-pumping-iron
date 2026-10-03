import test from 'node:test';
import assert from 'node:assert/strict';

import { runCron, handle } from '../src/index.js';
import { handleInteraction } from '../src/interactions.js';
import { linkedEnv, world, tornState, jsonRes, T0, body, command, ctx, req, KEY, DISCORD_USER, PLAN } from './helpers.js';

const IM = { itemmarket: { item: { id: 206, name: 'Xanax' }, listings: [{ price: 829900, amount: 12 }, { price: 830000, amount: 3 }] } };
const W3B = { item_id: 206, listings: [{ player_id: 1234567, player_name: 'Iron_Monk', price: 826500, quantity: 3 }, { player_id: 2345678, player_name: 'LuckyLefty', price: 828000, quantity: 4 }], total_listings: 2 };
/** 10:50 TCT: a 5-minute mark, when watches are checked. */
const T5 = Date.UTC(2026, 8, 29, 10, 50) / 1000;

function tornWith({ im = IM, state = tornState({ drug: 3600 }) } = {}) {
    return (url) => (url.includes('/itemmarket') ? (typeof im === 'function' ? im() : im) : url.includes('/basic') ? BASIC : state);
}
const BASIC = { profile: { id: 1234567, name: 'Iron_Monk', level: 23, status: { description: 'In hospital for 12 mins', state: 'Hospital', until: T0 + 720 } } };

test('/buy: the Item Market with the user’s key, bazaars from TornW3B with no key; links to buy in Torn', async () => {
    const { env } = await linkedEnv();
    const f = world({ torn: tornWith(), w3b: () => jsonRes(W3B) });
    const c = ctx();
    const r = await body(handleInteraction(command('buy', { item: '206' }), env, f, c, T0));
    assert.equal(r.type, 5);
    await c.done();
    const torn = f.calls.find((x) => x.url.startsWith('https://api.torn.com/'));
    assert.equal(torn.url, 'https://api.torn.com/v2/market/206/itemmarket?comment=PumpingIronPings');
    assert.equal(torn.init.headers.Authorization, 'ApiKey ' + KEY);
    const w = f.calls.find((x) => x.url.startsWith('https://weav3r.dev/'));
    assert.equal(w.url, 'https://weav3r.dev/api/marketplace/206?comment=PumpingIronPings');
    assert.ok(!JSON.stringify(w).includes(KEY), 'no key to TornW3B');
    assert.equal(w.init.headers.Authorization, undefined);
    const e = f.calls.find((x) => x.url.endsWith('/@original')).body;
    assert.equal(e.embeds[0].title, 'Xanax: cheapest now');
    assert.equal(e.embeds[0].description, 'Item Market: $829,900 (12 at that price)\nBazaar: $826,500 · Iron_Monk (3)\nCheapest: the bazaar, $3,400 less');
    assert.match(e.embeds[0].footer.text, /TornW3B \(weav3r\.dev\)/);
    assert.deepEqual(e.components[0].components.map((b) => [b.style, b.label, b.url]), [
        [5, 'Item Market', 'https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=206'],
        [5, 'Iron_Monk’s bazaar', 'https://www.torn.com/bazaar.php?userId=1234567#/'],
    ]);
    // A minute later: from the cache, no new reads.
    const g = world({ torn: tornWith(), w3b: () => jsonRes(W3B) });
    const c2 = ctx();
    await handleInteraction(command('buy', { item: '206' }), env, g, c2, T0 + 30);
    await c2.done();
    assert.equal(g.calls.filter((x) => !x.url.includes('discord.com')).length, 0);
});

test('/buy: TornW3B busy (429) → the Item Market alone; nothing guessed is stored', async () => {
    const { env } = await linkedEnv();
    const f = world({ torn: tornWith(), w3b: () => new Response('slow down', { status: 429 }) });
    const c = ctx();
    await handleInteraction(command('buy'), env, f, c, T0);
    await c.done();
    const e = f.calls.find((x) => x.url.endsWith('/@original')).body;
    assert.match(e.embeds[0].description, /Bazaar: TornW3B has nothing right now/);
    assert.ok(!env.DB.prices.has('w3b:206'));
});

test('/watch: add, list, change, stop; at most 3', async () => {
    const { env } = await linkedEnv();
    const run = async (o) => (await body(handleInteraction(command('watch', o), env, world(), ctx(), T0))).data.content;
    assert.match(await run({}), /No price watches/);
    assert.match(await run({ item: '206', price: 820000 }), /Watching Xanax: a ping when it’s at or under \$820,000/);
    assert.match(await run({ item: '206', price: 825000 }), /\$825,000/);
    await run({ item: '197', price: 50000 });
    await run({ item: '366', price: 4000000 });
    assert.match(await run({ item: '367', price: 1 }), /At most 3 watches/);
    assert.match(await run({}), /Xanax at or under \$825,000/);
    assert.match(await run({ item: '197' }), /Stopped watching Ecstasy/);
    assert.equal(env.DB.watches.size, 2);
});

test('cron: a watch pings once when the price is at or under; again only after it went back over', async () => {
    const { env, id } = await linkedEnv();
    await handleInteraction(command('watch', { item: '206', price: 827000 }), env, world(), ctx(), T0);
    const run = async (t, w3b) => {
        const f = world({ torn: tornWith(), w3b: () => jsonRes(w3b) });
        await runCron(env, t, f);
        return f;
    };
    let f = await run(T5, W3B);
    let post = f.calls.find((c) => c.url.endsWith('/messages'));
    assert.equal(post.body.embeds[0].title, 'Xanax at $826,500');
    assert.equal(post.body.embeds[0].description, '$826,500 in Iron_Monk’s bazaar (TornW3B), your watch is $827,000. You buy in Torn yourself.');
    assert.equal(post.body.embeds[0].url, 'https://www.torn.com/bazaar.php?userId=1234567#/');
    assert.equal(env.DB.watches.get(id + '|206').fired, 1);
    // Not a 5-minute mark: no price reads at all.
    f = await run(T5 + 60, W3B);
    assert.equal(f.calls.filter((c) => c.url.includes('itemmarket') || c.url.includes('weav3r')).length, 0);
    // Still under 5 minutes on: quiet.
    f = await run(T5 + 300, W3B);
    assert.equal(f.calls.filter((c) => c.url.endsWith('/messages')).length, 0);
    // Back over: re-armed; under again: pinged again.
    const over = { ...W3B, listings: [{ player_id: 1, player_name: 'X', price: 900000, quantity: 1 }] };
    await run(T5 + 600, over);
    assert.equal(env.DB.watches.get(id + '|206').fired, 0);
    f = await run(T5 + 900, W3B);
    assert.equal(f.calls.filter((c) => c.url.endsWith('/messages')).length, 1);
});

test('two users watching the same item: one TornW3B read, one Item Market read each with their own key', async () => {
    const { env } = await linkedEnv();
    const other = 'OtherCustomKey12';
    await handle(req('PUT', '/plan', { secret: 'z'.repeat(40), invite: 'x', body: { tornKey: other, plan: PLAN } }), env);
    const ids = [...env.DB.users.keys()];
    Object.assign(env.DB.users.get(ids[1]), { discord_id: '555000555000555000', linked: 1, plan_at: T5 });
    await handleInteraction(command('watch', { item: '206', price: 827000 }), env, world(), ctx(), T0);
    await handleInteraction(command('watch', { item: '206', price: 827000 }, { user: '555000555000555000' }), env, world(), ctx(), T0);
    const f = world({ torn: tornWith(), w3b: () => jsonRes(W3B) });
    await runCron(env, T5, f);
    assert.equal(f.calls.filter((c) => c.url.startsWith('https://weav3r.dev/')).length, 1);
    const im = f.calls.filter((c) => c.url.includes('/itemmarket'));
    assert.deepEqual(im.map((c) => c.init.headers.Authorization).sort(), ['ApiKey ' + KEY, 'ApiKey ' + other].sort());
    assert.equal(f.calls.filter((c) => c.url.endsWith('/messages')).length, 2);
});

test('targets sync through PUT /plan (kept small); /targets lists them with Attack links', async () => {
    const { env, user } = await linkedEnv();
    const list = [
        { id: 1234567, name: 'Iron_Monk', level: 23, band: 'stomp', win: 99.4, keep: 81, junk: 'x'.repeat(500) },
        { id: 2345678, name: 'LuckyLefty', level: 31, band: 'good', win: 91, keep: 44 },
        { id: 'bad', name: 'nobody' },
        { id: 3456789, name: 'Tank', level: 60, band: 'weird' },
    ];
    await handle(req('PUT', '/plan', { body: { targets: { list, bands: { 1234567: 'stomp', 999: 'tough', x: 'good' } }, factionId: 777, playerId: 3000001 } }), env);
    const t = JSON.parse(user().targets);
    assert.equal(t.list.length, 3);
    assert.equal(t.list[2].band, 'none');
    assert.ok(!('junk' in t.list[0]));
    assert.deepEqual(t.bands, { 1234567: 'stomp', 999: 'low' }, 'an older userscript’s Tough reads as under 50%');
    assert.equal(user().faction_id, 777);
    assert.equal(user().player_id, 3000001);
    const r = await body(handleInteraction(command('targets'), env, world(), ctx(), t.at + 720));
    assert.match(r.data.content, /\*\*Stomp\*\* \(win 99%, keeps 81% life\) · Iron_Monk \[1234567\] · Lv 23/);
    assert.match(r.data.content, /Synced 12 min ago/);
    assert.deepEqual(r.data.components[0].components.map((b) => b.url), ['https://www.torn.com/page.php?sid=attack&user2ID=1234567', 'https://www.torn.com/page.php?sid=attack&user2ID=2345678', 'https://www.torn.com/page.php?sid=attack&user2ID=3456789']);
    // A plan sync without targets keeps them.
    await handle(req('PUT', '/plan', { body: { plan: PLAN } }), env);
    assert.equal(JSON.parse(user().targets).list.length, 3);
});

test('/target id: live status from Torn with the user’s key, and the synced estimate', async () => {
    const { env, user } = await linkedEnv();
    user().targets = JSON.stringify({ at: T0, list: [], bands: { 1234567: 'good' } });
    const f = world({ torn: tornWith() });
    const c = ctx();
    await handleInteraction(command('target', { id: 1234567 }), env, f, c, T0);
    await c.done();
    const torn = f.calls.find((x) => x.url.startsWith('https://api.torn.com/'));
    assert.equal(torn.url, 'https://api.torn.com/v2/user/1234567/basic?comment=PumpingIronPings');
    const m = f.calls.find((x) => x.url.endsWith('/@original')).body;
    assert.match(m.content, /\*\*Iron_Monk\*\* \[1234567\] · Lv 23/);
    assert.match(m.content, /Status: In hospital, out 11:00/);
    assert.match(m.content, /Torn Eye: \*\*Good\*\*/);
    assert.deepEqual(m.components[0].components.map((b) => b.label), ['Attack', 'Profile']);
});

test('the bot never reaches a host other than Torn’s API, Discord and TornW3B', async () => {
    const { env } = await linkedEnv();
    const { guardedFetch } = await import('../src/net.js');
    const g = guardedFetch(async () => jsonRes({}));
    await assert.rejects(g('https://www.torn.com/profiles.php?XID=1'), /Blocked host/);
    await assert.rejects(g('http://api.torn.com/v2/user'), /Blocked host/);
    await assert.rejects(g('https://evil.example/'), /Blocked host/);
    assert.equal(DISCORD_USER.length > 0, true);
    assert.ok(env);
});
