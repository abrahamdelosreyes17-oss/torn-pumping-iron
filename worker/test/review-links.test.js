/*
 * Review fixes, round "links": stale rows forgotten by the cron, logins
 * cleaned, sync bodies limited in bytes, /war's "(Only N pages.)" inside
 * Discord's 2,000 characters. (Login-side fixes: login.test.js; /unlink:
 * link.test.js.)
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { handle, runCron, MAX_BODY } from '../src/index.js';
import { handleInteraction } from '../src/interactions.js';
import { Q, FORGET, QUERY_BUDGET } from '../src/db.js';
import { STALE_USER_S, STALE_PER_RUN } from '../src/cron.js';
import { LOGIN_TTL_S } from '../src/login.js';
import { botEnv, linkedEnv, world, tornState, T0, PLAN, KEY, DISCORD_USER, SECRET, req, command, ctx } from './helpers.js';

const CLEANUP = T0 + 120; // 10:50, a cleanup minute

test('cleanup: users not synced for 30 days are forgotten with their data, at most a few per run', async () => {
    const env = await botEnv();
    for (let n = 0; n < 4; n++) await handle(req('PUT', '/plan', { secret: String(n).padStart(2, '0') + 's'.repeat(38), invite: 'x', body: { tornKey: KEY, plan: PLAN } }), env);
    const ids = [...env.DB.users.keys()];
    // Three stale (one with a NULL `updated`), one synced 29 days ago.
    env.DB.users.get(ids[0]).updated = CLEANUP - STALE_USER_S - 1;
    env.DB.users.get(ids[1]).updated = null;
    env.DB.users.get(ids[2]).updated = CLEANUP - STALE_USER_S - 5000;
    env.DB.users.get(ids[3]).updated = CLEANUP - STALE_USER_S + 86400;
    await env.DB.prepare(Q.ackPut).bind('done:x', ids[0], 'done', 'x', null, CLEANUP).run();
    await env.DB.prepare(Q.watchPut).bind(ids[0], 206, 800000).run();
    await env.DB.prepare(Q.loginPut).bind('a'.repeat(48), ids[0], CLEANUP, 'open', null).run();
    await runCron(env, CLEANUP, world({ torn: tornState({ drug: 3600 }) }));
    assert.equal(env.DB.users.size, 4 - STALE_PER_RUN, STALE_PER_RUN + ' forgotten this run');
    assert.equal(env.DB.users.has(ids[0]), false);
    assert.equal(env.DB.acks.size + env.DB.watches.size, 0, 'with their data');
    assert.equal(env.DB.logins.has('a'.repeat(48)), false);
    await runCron(env, CLEANUP + 600, world({ torn: tornState({ drug: 3600 }) }));
    assert.deepEqual([...env.DB.users.keys()], [ids[3]], 'the next cleanup takes the rest; the recent one stays');
    // Not a cleanup minute: nobody is forgotten.
    env.DB.users.get(ids[3]).updated = 0;
    await runCron(env, CLEANUP + 660, world({ torn: tornState({ drug: 3600 }) }));
    assert.equal(env.DB.users.size, 1);
});

test('cleanup: logins older than 15 minutes go, finished ones too; fresh ones stay', async () => {
    const env = await botEnv();
    await env.DB.prepare(Q.loginPut).bind('1'.repeat(48), 'u1', CLEANUP - LOGIN_TTL_S - 1, 'open', null).run();
    await env.DB.prepare(Q.loginPut).bind('2'.repeat(48), 'u2', CLEANUP - LOGIN_TTL_S - 1, 'open', null).run();
    env.DB.logins.get('2'.repeat(48)).state = 'done';
    await env.DB.prepare(Q.loginPut).bind('3'.repeat(48), 'u3', CLEANUP - 60, 'open', null).run();
    await runCron(env, CLEANUP, world());
    assert.deepEqual([...env.DB.logins.keys()], ['3'.repeat(48)]);
});

test('a cleanup minute with many users and stale rows stays under the query budget; an hourly one always forgets one', async () => {
    const env = await botEnv();
    for (let n = 0; n < 20; n++) await handle(req('PUT', '/plan', { secret: String(n).padStart(2, '0') + 'y'.repeat(38), invite: 'x', body: { tornKey: KEY, plan: PLAN } }), env);
    for (const u of env.DB.users.values()) Object.assign(u, { discord_id: DISCORD_USER, linked: 1, plan_at: T0, updated: 0 });
    for (const t of [CLEANUP, T0 + 720]) {
        const before = env.DB.users.size;
        const n0 = env.DB.log.length;
        await runCron(env, t, world());
        const run = env.DB.log.slice(n0);
        assert.ok(run.length <= QUERY_BUDGET, run.length + ' queries');
        assert.ok(run.includes(Q.loginClean) && run.includes(Q.usersStale), 'the cleanup ran inside the budget');
        if (t === T0 + 720) assert.ok(env.DB.users.size <= before - 1, 'the hourly cleanup (11:00) keeps room for one');
    }
    assert.ok(FORGET.at(-1) === Q.userDelete, 'the row goes last, so a run cut short tries again');
});

test('PUT /plan: a declared length over 64 kB is refused unread; the limit counts bytes, not characters', async () => {
    const env = await botEnv();
    let pulled = false;
    const never = new ReadableStream({
        pull() {
            pulled = true;
            throw new Error('read');
        },
    }, { highWaterMark: 0 });
    const big = new Request('https://pumping-iron.test.workers.dev/plan', { method: 'PUT', headers: { authorization: 'Bearer ' + SECRET, 'x-invite': 'x', 'content-length': String(MAX_BODY + 1) }, body: never, duplex: 'half' });
    assert.equal((await handle(big, env)).status, 413);
    assert.equal(pulled, false, 'not read');
    // Under 64,000 characters, over 64,000 bytes (three-byte characters).
    const wide = { tornKey: KEY, plan: { steps: [], pad: '€'.repeat(22000) } };
    assert.ok(JSON.stringify(wide).length < MAX_BODY && new TextEncoder().encode(JSON.stringify(wide)).length > MAX_BODY);
    assert.equal((await handle(req('PUT', '/plan', { invite: 'x', body: wide }), env)).status, 413);
    assert.equal(env.DB.users.size, 0);
    // Still fine under it.
    assert.equal((await handle(req('PUT', '/plan', { invite: 'x', body: { tornKey: KEY, plan: { steps: [], pad: '€'.repeat(20000) } } }), env)).status, 200);
});

test('/war page past the end: "(Only N pages.)" and the page stay within 2,000 characters', async () => {
    const { env, user } = await linkedEnv();
    user().faction_id = 777;
    // A name long enough that every page is cut at 2,000 characters.
    const name = 'Very_Long_Faction_Name_'.repeat(100);
    const wars = { wars: { ranked: { war_id: 1, start: T0 - 3600, end: 0, factions: [{ id: 777, name: 'Us' }, { id: 888, name }] }, raids: [], territory: [] } };
    const members = { members: Array.from({ length: 40 }, (_, i) => ({ id: i + 1, name: 'Member_' + 'x'.repeat(40) + i, level: 50, last_action: { status: 'Offline', timestamp: T0 - 600 }, status: { state: 'Okay', description: 'Okay', until: 0 } })) };
    const f = world({ torn: (url) => (url.includes('/faction/wars') ? wars : url.includes('/members') ? members : tornState()) });
    const c = ctx();
    await handleInteraction(command('war', { page: 9 }), env, f, c, T0);
    await c.done();
    const content = f.calls.find((x) => x.url.endsWith('/@original')).body.content;
    assert.match(content, /^\(Only \d+ pages?\.\)\n\*\*War vs Very_Long/);
    assert.ok(content.length <= 2000, content.length + ' characters');
    assert.ok(content.length > 1990, 'a full page: ' + content.length);
});
