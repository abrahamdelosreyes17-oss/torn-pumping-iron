import test from 'node:test';
import assert from 'node:assert/strict';

import { runCron } from '../src/index.js';
import { handleInteraction } from '../src/interactions.js';
import { findWar, warView, easyTargets, membersOf } from '../src/war.js';
import { linkedEnv, world, tornState, jsonRes, T0, body, command, ctx, press } from './helpers.js';

const WARS = { wars: { ranked: { war_id: 555, start: T0 - 3600, end: 0, target: 3000, winner: null, factions: [{ id: 777, name: 'Our Gym', score: 100, chain: 12 }, { id: 888, name: 'Red Fist', score: 90, chain: 3 }] }, raids: [], territory: [] } };
const NO_WAR = { wars: { ranked: null, raids: [], territory: [] } };
const BANDS = { 1: 'stomp', 2: 'good', 3: 'stomp', 4: 'cant' };

function members(nowS, { laterUntil = T0 + 1800 } = {}) {
    return {
        members: [
            { id: 1, name: 'Easy_Okay', level: 10, status: { state: 'Okay', description: 'Okay', until: 0 } },
            { id: 2, name: 'Soon_Out', level: 12, status: { state: 'Hospital', description: 'In hospital', until: T0 + 90 } },
            { id: 3, name: 'Later_Out', level: 15, status: { state: 'Hospital', description: 'In hospital', until: laterUntil } },
            { id: 4, name: 'Tank', level: 80, status: { state: 'Okay', description: 'Okay', until: 0 } },
            { id: 5, name: 'Flyer', level: 20, status: { state: 'Traveling', description: 'Traveling to Mexico', until: 0 } },
        ],
    };
}

function tornFor({ wars = WARS, mem = () => members(), chain = { chain: { id: 9, current: 0, max: 10, timeout: 0, modifier: 1, cooldown: 0, start: 0, end: 0 } }, state = tornState({ drug: 3600 }) } = {}) {
    return (url) => {
        if (url.includes('/faction/wars')) return typeof wars === 'function' ? wars() : wars;
        if (url.includes('/members')) return mem(url);
        if (url.includes('/faction/chain')) return chain;
        return state;
    };
}

async function warEnv(settings = null) {
    const le = await linkedEnv();
    Object.assign(le.user(), { faction_id: 777, targets: JSON.stringify({ at: T0, list: [], bands: BANDS }) });
    if (settings) le.user().settings = JSON.stringify(settings);
    return le;
}

test('the war, the enemy, and who you can hit (pure)', () => {
    const w = findWar(WARS, 777, T0);
    assert.deepEqual(w, { id: '555', kind: 'ranked', start: T0 - 3600, end: 0, enemy: 888, enemyName: 'Red Fist' });
    assert.equal(findWar(WARS, 123, T0), null, 'not our war');
    assert.equal(findWar({ wars: { ranked: { ...WARS.wars.ranked, end: T0 - 1 } } }, 777, T0), null, 'over');
    const v = warView(membersOf(members()), BANDS, T0);
    assert.deepEqual(v.hit.map((x) => x.name), ['Easy_Okay', 'Tank'], 'Stomp before Can’t win');
    assert.deepEqual(v.hospital.map((x) => x.name), ['Soon_Out', 'Later_Out']);
    assert.deepEqual(v.away.map((x) => x.name), ['Flyer']);
    assert.deepEqual(easyTargets(v, T0).map((x) => x.name), ['Easy_Okay', 'Soon_Out'], 'Stomp/Good out now or within 2 min');
    assert.equal(membersOf({ members: { 7: { name: 'Obj' } } })[0].id, 7, 'members as an object too');
});

test('/war: our war’s enemy from faction/wars, then their members; bands from the last sync', async () => {
    const { env } = await warEnv();
    const f = world({ torn: tornFor() });
    const c = ctx();
    await handleInteraction(command('war'), env, f, c, T0);
    await c.done();
    const torn = f.calls.filter((x) => x.url.startsWith('https://api.torn.com/')).map((x) => x.url);
    assert.deepEqual(torn, ['https://api.torn.com/v2/faction/wars?comment=PumpingIronPings', 'https://api.torn.com/v2/faction/888/members?comment=PumpingIronPings']);
    const m = f.calls.find((x) => x.url.endsWith('/@original')).body;
    assert.match(m.content, /\*\*War vs Red Fist\*\*/);
    assert.match(m.content, /\*\*Hit now\*\* \(2\)\n\*\*Stomp\*\* · Easy_Okay · Lv 10\n\*\*Can’t win\*\* · Tank · Lv 80/);
    assert.match(m.content, /\*\*Out of hospital next\*\*\n\*\*Good\*\* · Soon_Out · Lv 12 · out 10:49/);
    assert.match(m.content, /Flyer · Traveling to Mexico/);
    assert.deepEqual(m.components[0].components.map((b) => b.label), ['Attack Easy_Okay', 'Attack Tank', 'Faction']);
    assert.ok(m.components[0].components.every((b) => b.style === 5), 'links only');
});

test('/war without a synced faction asks for one; /war faction:<id> reads that faction only', async () => {
    const { env, user } = await linkedEnv();
    const r = await body(handleInteraction(command('war'), env, world(), ctx(), T0));
    assert.match(r.data.content, /doesn’t know your faction yet/);
    user().cmd_at = 0;
    const f = world({ torn: tornFor() });
    const c = ctx();
    await handleInteraction(command('war', { faction: 999 }), env, f, c, T0);
    await c.done();
    assert.deepEqual(f.calls.filter((x) => x.url.startsWith('https://api.torn.com/')).map((x) => new URL(x.url).pathname), ['/v2/faction/999/members']);
});

test('/chain: count and timeout', async () => {
    const { env } = await warEnv();
    const f = world({ torn: tornFor({ chain: { chain: { id: 9, current: 45, max: 100, timeout: 192, modifier: 1.1, cooldown: 0 } } }) });
    const c = ctx();
    await handleInteraction(command('chain'), env, f, c, T0);
    await c.done();
    assert.match(f.calls.find((x) => x.url.endsWith('/@original')).body.content, /^\*\*Chain 45\*\* \/ 100 · times out in 3 min \(<t:\d+:R>\) · bonus ×1\.1$/);
});

test('cron in a war: one message for Stomp/Good targets out, edited in place as the list changes', async () => {
    const { env, id, user } = await warEnv();
    let f = world({ torn: tornFor() });
    await runCron(env, T0, f);
    let torn = f.calls.filter((x) => x.url.startsWith('https://api.torn.com/')).map((x) => new URL(x.url).pathname);
    assert.deepEqual(torn, ['/v2/user', '/v2/faction/wars', '/v2/faction/888/members']);
    const post = f.calls.find((x) => x.url.endsWith('/messages'));
    assert.equal(post.body.embeds[0].title, 'War: 2 Stomp or Good to hit');
    assert.match(post.body.embeds[0].description, /\*\*Stomp\*\* · Easy_Okay · Lv 10 · out now\n\*\*Good\*\* · Soon_Out · Lv 12 · out 10:49/);
    assert.deepEqual(post.body.components[0].components.map((b) => b.label), ['Done', 'Attack Easy_Okay', 'Attack Soon_Out', 'Open in Torn']);
    assert.equal(JSON.parse(user().war).enemy, 888);
    // A minute on: wars not read again (every 10 min); the list changed (Later_Out is out in 2 min): an edit, no new message.
    f = world({ torn: tornFor({ mem: () => members(T0 + 60, { laterUntil: T0 + 150 }) }) });
    await runCron(env, T0 + 60, f);
    torn = f.calls.filter((x) => x.url.startsWith('https://api.torn.com/')).map((x) => new URL(x.url).pathname);
    assert.deepEqual(torn, ['/v2/user', '/v2/faction/888/members']);
    const d = f.calls.filter((x) => x.url.includes('discord.com'));
    assert.equal(d.length, 1);
    assert.equal(d[0].init.method, 'PATCH');
    assert.equal(d[0].body.embeds[0].title, 'War: 3 Stomp or Good to hit');
    // Same list on the next read: no edit.
    f = world({ torn: tornFor({ mem: () => members(T0 + 80, { laterUntil: T0 + 150 }) }) });
    await runCron(env, T0 + 80, f);
    assert.equal(f.calls.filter((x) => x.url.includes('discord.com')).length, 0);
    assert.equal([...env.DB.sent.keys()].filter((k) => k.startsWith(id + '|war:')).length, 1);
});

test('Done on the war ping: no more war pings for that war', async () => {
    const { env, id } = await warEnv();
    await runCron(env, T0, world({ torn: tornFor() }));
    const row = [...env.DB.sent.values()].find((r) => r.alert.startsWith('war:'));
    const r = await body(handleInteraction(press('done:' + row.alert, row.message), env, world(), ctx(), T0 + 10));
    assert.equal(r.data.embeds[0].footer.text, 'Done');
    const f = world({ torn: tornFor() });
    await runCron(env, T0 + 1800, f);
    assert.equal(f.calls.filter((x) => x.url.endsWith('/messages')).length, 0);
    assert.equal([...env.DB.sent.keys()].filter((k) => k.startsWith(id + '|war:')).length, 1);
});

test('no war: faction/wars is read every 10 minutes, the enemy never', async () => {
    const { env } = await warEnv();
    let n = 0;
    for (let m = 0; m < 12; m++) {
        const f = world({ torn: tornFor({ wars: NO_WAR }) });
        await runCron(env, T0 + m * 60, f);
        n += f.calls.filter((x) => x.url.includes('/faction/')).length;
        assert.equal(f.calls.filter((x) => x.url.includes('/members')).length, 0);
    }
    assert.equal(n, 2);
});

test('a key without the faction selections (16): pings still work, wars are tried again in 10 minutes', async () => {
    const { env, user } = await warEnv();
    const f = world({ torn: tornFor({ wars: () => jsonRes({ error: { code: 16, error: 'Access level of this key is not high enough' } }), state: tornState({ drug: 232 }) }) });
    await runCron(env, T0, f);
    assert.equal(user().paused, 0);
    assert.deepEqual(JSON.parse(user().war), { checked: T0, error: 16 });
    assert.equal(f.calls.filter((x) => x.url.endsWith('/messages')).length, 1, 'the drug ping went out');
});

test('chain pings (off by default): 10+ hits and under 60 s left', async () => {
    const hot = { chain: { id: 9, current: 45, max: 100, timeout: 38, modifier: 1, cooldown: 0, start: T0 - 4000 } };
    let { env } = await warEnv();
    let f = world({ torn: tornFor({ wars: NO_WAR, chain: hot }) });
    await runCron(env, T0, f);
    assert.equal(f.calls.filter((x) => x.url.includes('/faction/chain')).length, 0, 'off: not even read');
    ({ env } = await warEnv({ kinds: { chain: true } }));
    f = world({ torn: tornFor({ wars: NO_WAR, chain: hot }) });
    await runCron(env, T0, f);
    const post = f.calls.find((x) => x.url.endsWith('/messages'));
    assert.equal(post.body.embeds[0].title, 'Chain 45: under a minute left');
    assert.match(post.body.embeds[0].description, /^Times out <t:\d+:R> \(10:48 TCT\)/);
    // Safe again: nothing.
    f = world({ torn: tornFor({ wars: NO_WAR, chain: { chain: { ...hot.chain, current: 46, timeout: 290 } } }) });
    await runCron(env, T0 + 60, f);
    assert.equal(f.calls.filter((x) => x.url.includes('discord.com')).length, 0);
});
