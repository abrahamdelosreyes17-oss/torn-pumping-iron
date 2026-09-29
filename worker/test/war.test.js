import test from 'node:test';
import assert from 'node:assert/strict';

import { runCron, handle } from '../src/index.js';
import { handleInteraction } from '../src/interactions.js';
import { findWar, membersOf, playerNow, snapEntry, playerEvents, landingOf, estimator, warPages, eyeTurn, FLIGHT_MIN } from '../src/war.js';
import { linkedEnv, botEnv, world, tornState, jsonRes, T0, body, command, ctx, press, req, KEY, PLAN, DISCORD_USER } from './helpers.js';

const WARS = { wars: { ranked: { war_id: 555, start: T0 - 3600, end: 0, target: 3000, winner: null, factions: [{ id: 777, name: 'Our Gym', score: 100, chain: 12 }, { id: 888, name: 'Red Fist', score: 90, chain: 3 }] }, raids: [], territory: [] } };
const NO_WAR = { wars: { ranked: null, raids: [], territory: [] } };
const BANDS = { 1: 'stomp', 2: 'good', 3: 'stomp', 4: 'cant', 5: 'stomp' };
/** What the userscript syncs for the enemy faction (PUT /plan `war`): win % for the pings. */
const WAR_LIST = { factionId: 888, members: [{ id: 1, name: 'Easy_Okay', level: 10, band: 'stomp', win: 99, keep: 90 }, { id: 2, name: 'Soon_Out', level: 12, band: 'good', win: 95, keep: 70 }, { id: 3, name: 'Later_Out', level: 15, band: 'stomp', win: 98, keep: 85 }, { id: 4, name: 'Tank', level: 80, band: 'cant', win: 2, keep: 0 }] };

const la = (status, ago = 600) => ({ status, timestamp: T0 - ago, relative: '' });
const m = (id, name, level, state, { until = 0, description = state, online = 'Offline' } = {}) => ({ id, name, level, last_action: la(online), status: { state, description, until } });

/** The enemy at 10:48: one Stomp out, one Good out in 2.5 min, one Stomp out in 30 min, a Can't win out in 100 s, a flyer, one with no data out in a minute. */
function members({ early = false, online = 'Offline', flyer = 'Traveling to Mexico', flyerState = 'Traveling' } = {}) {
    return {
        members: [
            m(1, 'Easy_Okay', 10, 'Okay', { online }),
            m(2, 'Soon_Out', 12, 'Hospital', { until: T0 + 150 }),
            early ? m(3, 'Later_Out', 15, 'Okay') : m(3, 'Later_Out', 15, 'Hospital', { until: T0 + 1800 }),
            m(4, 'Tank', 80, 'Hospital', { until: T0 + 100 }),
            m(5, 'Flyer', 20, flyerState, { description: flyer }),
            m(6, 'Nobody_Knows', 30, 'Hospital', { until: T0 + 60 }),
        ],
    };
}

function tornFor({ wars = WARS, mem = () => members(), chain = { chain: { id: 9, current: 0, max: 10, timeout: 0, modifier: 1, cooldown: 0, start: 0, end: 0 } }, state = tornState({ drug: 3600 }), profile = () => ({ error: { code: 6, error: 'Incorrect ID' } }) } = {}) {
    return (url) => {
        if (url.includes('/faction/wars')) return typeof wars === 'function' ? wars() : wars;
        if (url.includes('/members')) return mem(url);
        if (url.includes('/faction/chain')) return chain;
        if (url.includes('/profile')) return profile(Number(new URL(url).pathname.split('/')[3]));
        return state;
    };
}

async function warEnv(settings = null, { warList = WAR_LIST } = {}) {
    const le = await linkedEnv();
    Object.assign(le.user(), { faction_id: 777, targets: JSON.stringify({ at: T0, list: [], bands: BANDS }), war_list: warList ? JSON.stringify({ at: T0, ...warList }) : null });
    if (settings) le.user().settings = JSON.stringify(settings);
    return le;
}

const posts = (f) => f.calls.filter((x) => x.url.endsWith('/messages') && (x.init.method || 'POST') === 'POST');
const tornPaths = (f) => f.calls.filter((x) => x.url.startsWith('https://api.torn.com/')).map((x) => new URL(x.url).pathname);

/* ---------- Pure parts ---------- */

test('the war: ranked, territory and raids; the enemy; members as a list or an object', () => {
    assert.deepEqual(findWar(WARS, 777, T0), { id: '555', kind: 'ranked', start: T0 - 3600, end: 0, enemy: 888, enemyName: 'Red Fist' });
    assert.equal(findWar(WARS, 123, T0), null, 'not our war');
    assert.equal(findWar({ wars: { ranked: { ...WARS.wars.ranked, end: T0 - 1 } } }, 777, T0), null, 'over');
    const territory = { wars: { ranked: null, raids: [], territory: [{ war_id: 42, territory: 'ABC', start: T0 - 60, end: 0, target: 1000, factions: [{ id: 999, name: 'Land Grab' }, { id: 777, name: 'Our Gym' }] }] } };
    assert.deepEqual(findWar(territory, 777, T0), { id: '42', kind: 'territory', start: T0 - 60, end: 0, enemy: 999, enemyName: 'Land Grab' });
    const raid = { wars: { ranked: null, territory: [], raids: [{ war_id: 7, start: T0 - 60, end: 0, aggressor: { id: 777, name: 'Our Gym' }, defender: { id: 321, name: 'Raided' } }] } };
    assert.equal(findWar(raid, 777, T0).enemy, 321);
    assert.equal(membersOf({ members: { 7: { name: 'Obj' } } })[0].id, 7, 'members as an object too');
    const p = playerNow(m(1, 'A', 5, 'Okay', { online: 'Idle' }));
    assert.deepEqual([p.online, p.lastSeen], ['idle', T0 - 600]);
});

test('per-player changes: out soon, lands soon, out early, came online (pure)', () => {
    const lead = 180;
    const hosp = snapEntry(playerNow(m(2, 'S', 1, 'Hospital', { until: T0 + 150 })), null, false, T0);
    assert.deepEqual(playerEvents(null, hosp, T0, lead), [{ event: 'out', bucket: T0 + 150, at: T0 + 150 }]);
    const later = snapEntry(playerNow(m(3, 'L', 1, 'Hospital', { until: T0 + 1800 })), null, false, T0);
    assert.deepEqual(playerEvents(null, later, T0, lead), [], 'out in 30 min: not yet');
    // Out early: in hospital until 11:18 a minute ago, Okay now.
    const out = snapEntry(playerNow(m(3, 'L', 1, 'Okay')), later, true, T0 + 60);
    assert.deepEqual(playerEvents({ ...later, fresh: true }, out, T0 + 60, lead).map((e) => e.event), ['early']);
    assert.deepEqual(playerEvents({ ...later, fresh: false }, out, T0 + 60, lead), [], 'an old read shows no change');
    // Came online while Okay (once per half hour: the bucket).
    const off = snapEntry(playerNow(m(1, 'E', 1, 'Okay')), null, false, T0);
    const on = snapEntry(playerNow(m(1, 'E', 1, 'Okay', { online: 'Online' })), off, true, T0 + 60);
    assert.deepEqual(playerEvents({ ...off, fresh: true }, on, T0 + 60, lead), [{ event: 'online', bucket: Math.floor((T0 + 60) / 1800) }]);
    // A flight back: seen leaving Mexico at 10:49, lands ~11:15 (26 min); the ping comes 3 min before.
    const abroad = snapEntry(playerNow(m(5, 'F', 1, 'Abroad', { description: 'In Mexico' })), null, false, T0);
    const back = snapEntry(playerNow(m(5, 'F', 1, 'Traveling', { description: 'Returning to Torn from Mexico' })), abroad, true, T0 + 60);
    assert.deepEqual([back.t, back.f, back.k], ['back:Mexico', T0 + 60, 1]);
    assert.deepEqual(landingOf(back), { at: T0 + 60 + FLIGHT_MIN.mexico * 60, known: true, place: 'Mexico' });
    assert.deepEqual(playerEvents(null, back, T0 + 120, lead), []);
    const soon = snapEntry(playerNow(m(5, 'F', 1, 'Traveling', { description: 'Returning to Torn from Mexico' })), back, true, T0 + 60 + 24 * 60);
    assert.equal(soon.f, T0 + 60, 'first seen is kept');
    assert.deepEqual(playerEvents(null, soon, T0 + 60 + 24 * 60, lead).map((e) => [e.event, e.known]), [['lands', true]]);
    // First seen already in the air: the landing is "by then", not "about then".
    assert.equal(snapEntry(playerNow(m(5, 'F', 1, 'Traveling', { description: 'Returning to Torn from Mexico' })), null, false, T0).k, 0);
});

test('the band: the synced war list first, then Torn Eye’s bands', () => {
    const est = estimator({ factionId: 888, members: [{ id: 1, band: 'good', win: 90 }, { id: 2, band: 'none', win: null }] }, 888, { 1: 'cant', 2: 'tough', 3: 'stomp' });
    assert.equal(est(1).band, 'good');
    assert.equal(est(1).win, 90);
    assert.equal(est(2).band, 'tough', 'no data in the war list: Torn Eye’s band');
    assert.equal(est(3).band, 'stomp');
    assert.equal(est(4).band, 'none');
    assert.equal(estimator({ factionId: 111, members: [{ id: 1, band: 'good' }] }, 888, {})(1).band, 'none', 'a list for another faction is not used');
});

test('the watch list turn: at most 5 a minute, each at least every 5 minutes', () => {
    const list = Array.from({ length: 25 }, (_, i) => ({ id: i + 1 }));
    let cursor = 0;
    const seen = new Set();
    for (let run = 0; run < 5; run++) {
        const t = eyeTurn(list, cursor);
        assert.equal(t.ids.length, 5);
        t.ids.forEach((id) => seen.add(id));
        cursor = t.cursor;
    }
    assert.equal(seen.size, 25);
    assert.equal(eyeTurn(list.slice(0, 3), 0).ids.length, 1, 'three players: one a minute, each every 3 minutes');
    assert.equal(eyeTurn(list.slice(0, 7), 0).ids.length, 2);
});

/* ---------- /war ---------- */

test('/war: the whole faction with online status, out-at times and flights; bands from the war list', async () => {
    const { env } = await warEnv();
    const f = world({ torn: tornFor({ mem: () => members({ online: 'Online', flyer: 'Returning to Torn from Mexico' }) }) });
    const c = ctx();
    await handleInteraction(command('war'), env, f, c, T0);
    await c.done();
    assert.deepEqual(tornPaths(f), ['/v2/faction/wars', '/v2/faction/888/members']);
    const msg = f.calls.find((x) => x.url.endsWith('/@original')).body;
    assert.match(msg.content, /^\*\*War vs Red Fist\*\*\n1 you can beat out now · next out 10:49 · 1 away/);
    assert.match(msg.content, /\*\*Hit now\*\* \(1\)\n\*\*Stomp\*\* · Easy_Okay · Lv 10 · win 99% · online/);
    assert.match(msg.content, /\*\*In hospital\*\* \(4\)\n\*\*No data\*\* · Nobody_Knows · Lv 30 · out 10:49 \(<t:\d+:R>\) · offline 10 min\n\*\*Can’t win\*\* · Tank · Lv 80 · win 2% · out 10:49/);
    assert.match(msg.content, /\*\*Good\*\* · Soon_Out · Lv 12 · win 95% · out 10:50/);
    assert.match(msg.content, /\*\*Stomp\*\* · Flyer · Lv 20 · ← from Mexico, lands by ~11:14 \(est\.\)/);
    assert.doesNotMatch(msg.content, /Page/);
    assert.deepEqual(msg.components[0].components.map((b) => b.label), ['Attack Easy_Okay', 'Faction']);
    assert.ok(msg.components[0].components.every((b) => b.style === 5), 'links only');
});

test('/war pages through a big faction; every page fits in one Discord message', async () => {
    const { env, user } = await warEnv();
    const big = { members: Array.from({ length: 100 }, (_, i) => m(i + 1, 'Member_Number_' + (i + 1), 50 + (i % 40), i % 3 ? 'Hospital' : 'Okay', { until: T0 + 600 + i * 30, online: i % 2 ? 'Idle' : 'Offline' })) };
    const f = world({ torn: tornFor({ mem: () => big }) });
    let c = ctx();
    await handleInteraction(command('war'), env, f, c, T0);
    await c.done();
    const first = f.calls.find((x) => x.url.endsWith('/@original')).body.content;
    const pages = Number(first.match(/Page 1 of (\d+)/)[1]);
    assert.ok(pages >= 3, pages + ' pages');
    assert.match(first, /`\/war page:2` for more/);
    const names = new Set();
    for (let p = 1; p <= pages; p++) {
        user().cmd_at = 0;
        const g = world({ torn: tornFor({ mem: () => big }) });
        c = ctx();
        await handleInteraction(command('war', { page: p }), env, g, c, T0);
        await c.done();
        const content = g.calls.find((x) => x.url.endsWith('/@original')).body.content;
        assert.ok(content.length <= 2000, 'page ' + p + ': ' + content.length + ' characters');
        for (const n of content.match(/Member_Number_\d+/g) || []) names.add(n);
    }
    assert.equal(names.size, 100, 'everyone is on some page');
    user().cmd_at = 0;
    const g = world({ torn: tornFor({ mem: () => big }) });
    c = ctx();
    await handleInteraction(command('war', { page: 20 }), env, g, c, T0);
    await c.done();
    assert.match(g.calls.find((x) => x.url.endsWith('/@original')).body.content, /^\(Only \d+ pages\.\)/);
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
    assert.deepEqual(tornPaths(f), ['/v2/faction/999/members']);
});

test('/chain: count and timeout', async () => {
    const { env } = await warEnv();
    const f = world({ torn: tornFor({ chain: { chain: { id: 9, current: 45, max: 100, timeout: 192, modifier: 1.1, cooldown: 0 } } }) });
    const c = ctx();
    await handleInteraction(command('chain'), env, f, c, T0);
    await c.done();
    assert.match(f.calls.find((x) => x.url.endsWith('/@original')).body.content, /^\*\*Chain 45\*\* \/ 100 · times out in 3 min \(<t:\d+:R>\) · bonus ×1\.1$/);
});

/* ---------- War pings (cron) ---------- */

test('cron in a war: pings ahead about enemies you can beat only; one message for the minute', async () => {
    const { env, user } = await warEnv();
    const f = world({ torn: tornFor() });
    await runCron(env, T0, f);
    assert.deepEqual(tornPaths(f), ['/v2/user', '/v2/faction/wars', '/v2/faction/888/members']);
    const p = posts(f);
    assert.equal(p.length, 1, 'the minute’s war pings share one message');
    const titles = p[0].body.embeds.map((e) => e.title);
    assert.deepEqual(titles, ['Soon_Out out of hospital in 3 min', 'War vs Red Fist: 1 you can beat is out now']);
    assert.match(p[0].body.embeds[0].description, /^Out 10:50 TCT \(<t:\d+:R>\)\n\*\*Good\*\* · win 95% · Lv 12 · vs Red Fist/);
    assert.match(p[0].body.content, /Soon_Out out of hospital in 3 min/, 'the notification says it');
    // Tank (Can't win, out in 100 s) and Nobody_Knows (no data, out in 60 s): no ping.
    assert.doesNotMatch(JSON.stringify(p[0].body), /Tank|Nobody_Knows/);
    assert.deepEqual(p[0].body.components[0].components.map((b) => b.label), ['Done: stop war pings', 'Attack Soon_Out', 'Attack Easy_Okay']);
    const w = JSON.parse(user().war);
    assert.equal(w.enemy, 888);
    assert.deepEqual(Object.keys(w.snap).sort(), ['1', '2', '3', '4', '5', '6']);
    assert.deepEqual(w.snap[2], { s: 'Hospital', u: T0 + 150, o: 'offline', t: '', f: T0, k: 0 });
});

test('each minute’s new pings are a NEW message (edits don’t notify); the same ping never twice', async () => {
    const { env, id } = await warEnv();
    await runCron(env, T0, world({ torn: tornFor() }));
    // A minute on: Later_Out is out early and Easy_Okay came online. Soon_Out (already pinged) stays quiet.
    let f = world({ torn: tornFor({ mem: () => members({ early: true, online: 'Online' }) }) });
    await runCron(env, T0 + 60, f);
    assert.deepEqual(tornPaths(f), ['/v2/user', '/v2/faction/888/members'], 'wars are read every 10 minutes, the enemy every minute');
    assert.equal(f.calls.filter((x) => x.init.method === 'PATCH').length, 0, 'no edits');
    const p = posts(f);
    assert.equal(p.length, 1);
    assert.deepEqual(p[0].body.embeds.map((e) => e.title), ['Easy_Okay came online', 'Later_Out is out of hospital early']);
    assert.match(p[0].body.embeds[1].description, /^Was due out 11:18 TCT\. Out now\n\*\*Stomp\*\* · win 98%/);
    // Same state again: nothing new.
    f = world({ torn: tornFor({ mem: () => members({ early: true, online: 'Online' }) }) });
    await runCron(env, T0 + 120, f);
    assert.equal(posts(f).length, 0);
    const ids = [...env.DB.sent.keys()].filter((k) => k.startsWith(id + '|war:')).map((k) => k.split('|')[1]);
    assert.deepEqual(ids.sort(), ['war:555:1:online:' + Math.floor((T0 + 60) / 1800), 'war:555:2:out:' + (T0 + 150), 'war:555:3:early:' + (T0 + 1800), 'war:555:start']);
});

test('a flight back to Torn: pinged a few minutes before the estimated landing', async () => {
    const { env } = await warEnv();
    await runCron(env, T0, world({ torn: tornFor({ mem: () => members({ flyer: 'In Mexico', flyerState: 'Abroad' }) }) }));
    // Seen leaving Mexico at 10:49: lands ~11:15.
    const back = () => members({ flyer: 'Returning to Torn from Mexico' });
    let f = world({ torn: tornFor({ mem: back }) });
    await runCron(env, T0 + 60, f);
    assert.equal(posts(f).length, 0);
    f = world({ torn: tornFor({ mem: back }) });
    await runCron(env, T0 + 60 + 24 * 60, f);
    const p = posts(f);
    assert.equal(p.length, 1);
    assert.equal(p[0].body.embeds[0].title, 'Flyer lands in Torn in ~2 min');
    assert.match(p[0].body.embeds[0].description, /^Returning to Torn from Mexico, lands ~11:15 TCT \(est\.\)\n\*\*Stomp\*\*/);
});

test('war pings have their own cap, apart from the normal one', async () => {
    const { env, user } = await warEnv({ perHour: 1, warPerHour: 1 });
    let f = world({ torn: tornFor({ state: tornState({ drug: 232 }) }) });
    await runCron(env, T0, f);
    assert.equal(posts(f).length, 2, 'the drug ping and the war ping: each within its own cap');
    // Next minute: two new war changes, but the war cap (1 an hour) is used.
    f = world({ torn: tornFor({ mem: () => members({ early: true, online: 'Online' }) }) });
    await runCron(env, T0 + 60, f);
    assert.equal(posts(f).length, 0);
    assert.equal(JSON.parse(user().war).pending.length, 2, 'they wait a few minutes in case room comes');
    // The waiting changes go out if the cap allows within 3 minutes (here: the cap is raised).
    user().settings = JSON.stringify({ perHour: 1, warPerHour: 5 });
    f = world({ torn: tornFor({ mem: () => members({ early: true, online: 'Online' }) }) });
    await runCron(env, T0 + 120, f);
    assert.deepEqual(posts(f)[0].body.embeds.map((e) => e.title), ['Easy_Okay came online', 'Later_Out is out of hospital early']);
    assert.equal(JSON.parse(user().war).pending, undefined);
});

test('lead time is a setting (default 3 min)', async () => {
    const { env } = await warEnv({ warLead: 1 });
    const f = world({ torn: tornFor() });
    await runCron(env, T0, f);
    assert.doesNotMatch(JSON.stringify(posts(f)[0].body.embeds), /Soon_Out out/, '2.5 min away is not within 1 min');
});

test('Done on a war ping: no more war pings (and no more enemy reads) for that war', async () => {
    const { env, id, user } = await warEnv();
    await runCron(env, T0, world({ torn: tornFor() }));
    const row = [...env.DB.sent.values()].find((r) => r.alert.startsWith('war:'));
    const r = await body(handleInteraction(press('done:' + row.alert, row.message), env, world(), ctx(), T0 + 10));
    assert.ok(r.data.embeds.some((e) => e.footer && e.footer.text === 'Done: no more war pings for this war'));
    assert.deepEqual(r.data.components[0].components.map((b) => b.label), ['Attack Soon_Out', 'Attack Easy_Okay'], 'the Done button is gone');
    const f = world({ torn: tornFor({ mem: () => members({ early: true, online: 'Online' }) }) });
    await runCron(env, T0 + 60, f);
    assert.equal(posts(f).length, 0);
    assert.deepEqual(tornPaths(f), ['/v2/user']);
    assert.ok(JSON.parse(user().war).done);
    assert.equal([...env.DB.sent.keys()].filter((k) => k.startsWith(id + '|war:')).length, 2);
});

test('/snooze kind:war: no war pings while muted; after it, an old read shows no false changes', async () => {
    const { env } = await warEnv();
    await runCron(env, T0, world({ torn: tornFor() }));
    await handleInteraction(command('snooze', { minutes: 10, kind: 'war' }), env, world(), ctx(), T0 + 5);
    let f = world({ torn: tornFor({ mem: () => members({ early: true, online: 'Online' }) }) });
    await runCron(env, T0 + 60, f);
    assert.equal(posts(f).length, 0);
    assert.deepEqual(tornPaths(f), ['/v2/user']);
    f = world({ torn: tornFor({ mem: () => members({ early: true, online: 'Online' }) }) });
    await runCron(env, T0 + 660, f);
    assert.equal(posts(f).length, 0, 'the last read is 11 minutes old: "out early" and "came online" can’t be told');
});

test('no war: faction/wars is read every 10 minutes, the enemy never', async () => {
    const { env } = await warEnv();
    let n = 0;
    for (let i = 0; i < 12; i++) {
        const f = world({ torn: tornFor({ wars: NO_WAR }) });
        await runCron(env, T0 + i * 60, f);
        n += f.calls.filter((x) => x.url.includes('/faction/')).length;
        assert.equal(f.calls.filter((x) => x.url.includes('/members')).length, 0);
    }
    assert.equal(n, 2);
});

test('a territory war is found and pinged like a ranked one', async () => {
    const { env, user } = await warEnv();
    const territory = { wars: { ranked: null, raids: [], territory: [{ war_id: 42, territory: 'ABC', start: T0 - 60, end: 0, factions: [{ id: 888, name: 'Red Fist' }, { id: 777, name: 'Our Gym' }] }] } };
    const f = world({ torn: tornFor({ wars: territory }) });
    await runCron(env, T0, f);
    assert.equal(JSON.parse(user().war).kind, 'territory');
    assert.ok(posts(f)[0].body.embeds.some((e) => e.title === 'Soon_Out out of hospital in 3 min'));
    assert.ok([...env.DB.sent.keys()].some((k) => k.includes('|war:42:2:out:')));
});

test('a key without the faction selections (16): pings still work, wars are tried again in 10 minutes', async () => {
    const { env, user } = await warEnv();
    const f = world({ torn: tornFor({ wars: () => jsonRes({ error: { code: 16, error: 'Access level of this key is not high enough' } }), state: tornState({ drug: 232 }) }) });
    await runCron(env, T0, f);
    assert.equal(user().paused, 0);
    assert.deepEqual(JSON.parse(user().war), { checked: T0, error: 16 });
    assert.equal(posts(f).length, 1, 'the drug ping went out');
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
    const post = posts(f)[0];
    assert.equal(post.body.embeds[0].title, 'Chain 45: under a minute left');
    assert.match(post.body.embeds[0].description, /^Times out <t:\d+:R> \(10:48 TCT\)/);
    f = world({ torn: tornFor({ wars: NO_WAR, chain: { chain: { ...hot.chain, current: 46, timeout: 290 } } }) });
    await runCron(env, T0 + 60, f);
    assert.equal(f.calls.filter((x) => x.url.includes('discord.com')).length, 0);
});

/* ---------- The watch list ---------- */

const WATCHED = [
    { id: 11, name: 'Mugger', level: 40, band: 'good', win: 88, keep: 60, tag: 'mugged me' },
    { id: 12, name: 'Big_Guy', level: 90, band: 'cant', win: 5, keep: 0, tag: 'avoid' },
    { id: 13, name: 'Stranger', level: 25, band: 'none', win: null, keep: null, tag: null },
];
const profileOf = (states) => (id) => ({ profile: { id, name: 'P' + id, level: 30, ...states[id] } });

test('watch list: hospital out soon and came online, with the tag; Can’t win never; no data says so', async () => {
    const { env, user } = await linkedEnv();
    await handle(req('PUT', '/plan', { body: { watch: WATCHED } }), env);
    const states = {
        11: { status: { state: 'Hospital', description: 'In hospital', until: T0 + 120 }, last_action: la('Offline') },
        12: { status: { state: 'Hospital', description: 'In hospital', until: T0 + 120 }, last_action: la('Offline') },
        13: { status: { state: 'Hospital', description: 'In hospital', until: T0 + 170 }, last_action: la('Offline') },
    };
    const seen = [];
    for (let i = 0; i < 3; i++) {
        const f = world({ torn: tornFor({ wars: NO_WAR, profile: profileOf(states) }) });
        await runCron(env, T0 + i * 60, f);
        seen.push(...tornPaths(f).filter((p) => p.endsWith('/profile')));
        if (i === 0) assert.equal(tornPaths(f).filter((p) => p.endsWith('/profile')).length, 1, 'three players: one read a minute');
    }
    assert.deepEqual(seen, ['/v2/user/11/profile', '/v2/user/12/profile', '/v2/user/13/profile']);
    const sent = [...env.DB.sent.values()].filter((r) => r.alert.startsWith('eye:')).map((r) => JSON.parse(r.body));
    assert.deepEqual(sent.map((b) => b.title).sort(), ['Mugger out of hospital in 2 min', 'Stranger out of hospital in 1 min']);
    const mugger = sent.find((b) => b.title.startsWith('Mugger'));
    assert.match(mugger.text, /\*\*Good\*\* · win 88% · Lv 40 · watching: mugged me/);
    assert.equal(mugger.kind, 'watch');
    assert.match(sent.find((b) => b.title.startsWith('Stranger')).text, /No estimate · Lv 25/);
    // Came online while Okay, on its next read (5 players or fewer: every few minutes).
    states[11] = { status: { state: 'Okay', description: 'Okay', until: 0 }, last_action: la('Online', 0) };
    const f = world({ torn: tornFor({ wars: NO_WAR, profile: profileOf(states) }) });
    await runCron(env, T0 + 180, f);
    assert.deepEqual(tornPaths(f).filter((p) => p.endsWith('/profile')), ['/v2/user/11/profile']);
    assert.equal(posts(f)[0].body.embeds[0].title, 'Mugger came online');
    // No Snooze on player pings; the link attacks.
    assert.deepEqual(posts(f)[0].body.components[0].components.map((b) => b.label), ['Done', 'Attack Mugger']);
});

test('watch list: /settings kind:watch off stops the reads; the price watch is its own kind', async () => {
    const { env } = await linkedEnv();
    await handle(req('PUT', '/plan', { body: { watch: WATCHED } }), env);
    const r = await body(handleInteraction(command('settings', { kind: 'watch', on: false }), env, world(), ctx(), T0));
    assert.match(r.data.content, /^Saved: Watch list off\./);
    assert.match(r.data.content, /Off: Watch list, Chain timeout/);
    const f = world({ torn: tornFor({ wars: NO_WAR }) });
    await runCron(env, T0, f);
    assert.equal(tornPaths(f).filter((p) => p.endsWith('/profile')).length, 0);
});

test('/settings: war pings per hour and lead time', async () => {
    const { env, user } = await linkedEnv();
    let r = await body(handleInteraction(command('settings'), env, world(), ctx(), T0));
    assert.match(r.data.content, /War pings: at most 30 an hour \(their own cap\) · 3 min ahead/);
    r = await body(handleInteraction(command('settings', { war_per_hour: 12, war_lead: 5 }), env, world(), ctx(), T0));
    assert.match(r.data.content, /^Saved: war pings per hour, war lead\./);
    assert.match(r.data.content, /War pings: at most 12 an hour \(their own cap\) · 5 min ahead/);
    const st = JSON.parse(user().settings);
    assert.deepEqual([st.warPerHour, st.warLead], [12, 5]);
});

test('free plan: users in a war with 25 watched players still fit one run (45 subrequests, 45 queries)', async () => {
    const env = await botEnv();
    const watch = Array.from({ length: 25 }, (_, i) => ({ id: 100 + i, name: 'W' + i, level: 20, band: 'stomp', win: 99, keep: 90, tag: null }));
    for (let n = 0; n < 8; n++) {
        const secret = String(n).padStart(2, '0') + 'w'.repeat(38);
        await handle(req('PUT', '/plan', { secret, invite: 'x', body: { tornKey: KEY, plan: PLAN, factionId: 777, war: WAR_LIST, watch } }), env);
    }
    for (const u of env.DB.users.values()) Object.assign(u, { discord_id: DISCORD_USER, linked: 1, plan_at: T0, targets: JSON.stringify({ at: T0, list: [], bands: BANDS }) });
    const hosp = (id) => ({ profile: { id, name: 'W', level: 20, status: { state: 'Hospital', description: 'In hospital', until: T0 + 100 }, last_action: la('Offline') } });
    for (let minute = 0; minute < 3; minute++) {
        const f = world({ torn: tornFor({ profile: hosp, mem: () => members({ early: minute > 0, online: minute > 0 ? 'Online' : 'Offline' }) }) });
        const before = env.DB.log.length;
        const out = await runCron(env, T0 + minute * 60, f);
        assert.ok(f.calls.length <= 45, 'minute ' + minute + ': ' + f.calls.length + ' subrequests');
        assert.ok(env.DB.log.length - before <= 46, 'minute ' + minute + ': ' + (env.DB.log.length - before) + ' queries');
        assert.ok(out.some((o) => o.sent > 0), 'someone was served');
        for (const u of env.DB.users.values()) {
            const eye = JSON.parse(u.watch_state || 'null');
            if (eye) assert.ok(Object.keys(eye.snap).length <= 5 * (minute + 1), 'at most 5 watched reads a minute');
        }
    }
});

/* ---------- PUT /plan: the war list and the watch list ---------- */

test('PUT /plan war and watch: cleaned, capped (100, 50), kept when left out, cleared with null', async () => {
    const { env, user } = await linkedEnv();
    const many = Array.from({ length: 130 }, (_, i) => ({ id: i + 1, name: 'N'.repeat(60), level: 10, band: i % 2 ? 'stomp' : 'weird', win: 140, keep: -5 }));
    const watch = [...Array.from({ length: 60 }, (_, i) => ({ id: 500 + i, band: 'good', tag: 'x'.repeat(40) })), { id: 'nope' }];
    let r = await handle(req('PUT', '/plan', { body: { war: { factionId: 888, members: [...many, { id: 1, band: 'good' }] }, watch } }), env);
    assert.equal(r.status, 200);
    const w = JSON.parse(user().war_list);
    assert.equal(w.factionId, 888);
    assert.equal(w.members.length, 100);
    assert.deepEqual(w.members[0], { id: 1, name: 'N'.repeat(40), level: 10, band: 'none', win: 100, keep: 0 });
    assert.equal(w.members[1].band, 'stomp');
    const l = JSON.parse(user().watch_list);
    assert.equal(l.list.length, 50);
    assert.equal(l.list[0].tag.length, 24);
    // Left out: kept. null: cleared.
    await handle(req('PUT', '/plan', { body: { plan: PLAN } }), env);
    assert.equal(JSON.parse(user().war_list).members.length, 100);
    r = await body(handle(req('PUT', '/plan', { body: { war: null, watch: null } }), env));
    assert.equal(r.ok, true);
    assert.equal(user().war_list, null);
    assert.equal(user().watch_list, null);
});
