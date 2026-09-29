import test from 'node:test';
import assert from 'node:assert/strict';

import { runCron, runUser, handle } from '../src/index.js';
import { dueAlerts, nextPrev } from '../src/alerts.js';
import { meterDb, Q } from '../src/db.js';
import { BudgetError } from '../src/net.js';
import { isSealed } from '../src/keys.js';
import { handleInteraction } from '../src/interactions.js';
import { linkedEnv, botEnv, world, tornState, jsonRes, T0, PLAN, KEY, HOOK, DISCORD_USER, req, body, command, press, ctx } from './helpers.js';

const posts = (f) => f.calls.filter((c) => c.url.includes('discord.com') && (c.init.method || 'POST') === 'POST' && (c.url.endsWith('/messages') || c.url.includes('/webhooks/')));

/* 1. The D1 budget is enforced */

test('meterDb throws BudgetError past its budget', async () => {
    const env = await botEnv();
    const db = meterDb(env.DB, 2);
    await db.prepare(Q.userGet).bind('a').first();
    await db.prepare(Q.userGet).bind('b').first();
    await assert.rejects(db.prepare(Q.userGet).bind('c').first(), BudgetError);
    assert.equal(env.DB.log.filter((s) => s === Q.userGet).length, 2, 'the third never reached D1');
});

test('no room to record a ping: it is not sent (so it is not sent twice next minute)', async () => {
    const { env, user } = await linkedEnv();
    const f = world();
    await assert.rejects(runUser(env, user(), T0, f, meterDb(env.DB, 3)), BudgetError);
    assert.equal(posts(f).length, 0);
    const g = world();
    await runCron(env, T0 + 1, g);
    assert.equal(posts(g).length, 1);
    const h = world({ torn: tornState({ drug: 171 }) });
    await runCron(env, T0 + 61, h);
    assert.equal(posts(h).length, 0);
});

test('a cleanup minute with many users stays under 50 queries, cleanup included', async () => {
    const env = await botEnv();
    for (let n = 0; n < 20; n++) await handle(req('PUT', '/plan', { secret: String(n).padStart(2, '0') + 'y'.repeat(38), invite: 'x', body: { tornKey: KEY, plan: PLAN } }), env);
    for (const u of env.DB.users.values()) Object.assign(u, { discord_id: DISCORD_USER, linked: 1, plan_at: T0 });
    const t = T0 + 120; // 10:50
    const n0 = env.DB.log.length;
    await runCron(env, t, world());
    const run = env.DB.log.slice(n0);
    assert.ok(run.length <= 45, run.length + ' queries');
    assert.ok(run.includes(Q.sentClean) && run.includes(Q.linkClean), 'the cleanup ran inside the budget');
});

/* 2. PUT /plan: acks cleared in one statement */

test('PUT /plan clears up to 50 acks with one DELETE', async () => {
    const { env, id } = await linkedEnv();
    for (let n = 0; n < 60; n++) await env.DB.prepare(Q.ackPut).bind('done:x' + n, id, 'done', 'x' + n, null, T0).run();
    const n0 = env.DB.log.length;
    const p = await body(handle(req('PUT', '/plan', { body: { ackIds: Array.from({ length: 60 }, (_, n) => 'done:x' + n) } }), env));
    const run = env.DB.log.slice(n0);
    assert.equal(run.filter((s) => s.startsWith('DELETE FROM acks')).length, 1);
    assert.ok(run.length <= 5, run.length + ' queries');
    assert.equal(p.acks.length, 10, 'the 50 sent back are gone, 10 remain');
});

/* 3. Booster and landed pings: the id is the Torn event */

test('booster and landed ids come from the event, so a replayed transition pings once', async () => {
    const plan = { type: 'jump', steps: [{ at: T0 + 600, kind: 'boost', label: 'EDVD × 5' }] };
    const prev = nextPrev(null, tornState({ drug: 3600, booster: 45, travel: 30 }), T0 - 60);
    const a = dueAlerts(tornState({ drug: 3600, booster: 0, travel: 0 }), plan, T0, {}, { prev });
    const b = dueAlerts(tornState({ drug: 3600, booster: 0, travel: 0 }), plan, T0 + 60, {}, { prev });
    assert.deepEqual(a.map((x) => x.id), b.map((x) => x.id));
    assert.deepEqual(a.map((x) => x.kind).sort(), ['booster', 'landed']);
});

test('cron: a run whose saved state was lost doesn’t ping the booster again', async () => {
    const plan = { type: 'jump', steps: [{ at: T0 + 600, kind: 'boost', label: 'EDVD × 5' }] };
    const { env, user } = await linkedEnv({}, { plan });
    user().prev = JSON.stringify(nextPrev(null, tornState({ drug: 3600, booster: 45 }), T0 - 60));
    const old = user().prev;
    let f = world({ torn: tornState({ drug: 3600, booster: 0 }) });
    await runCron(env, T0, f);
    assert.equal(posts(f).length, 1);
    user().prev = old; // as if the run had stopped before saving
    f = world({ torn: tornState({ drug: 3600, booster: 0 }) });
    await runCron(env, T0 + 60, f);
    assert.equal(posts(f).length, 0);
});

/* 4. Plain 1.0 keys get sealed */

test('a PUT resending the same key seals a plain 1.0 key', async () => {
    const { env, user } = await linkedEnv();
    user().torn_key = KEY;
    await handle(req('PUT', '/plan', { body: { tornKey: KEY } }), env);
    assert.ok(isSealed(user().torn_key));
    user().torn_key = KEY;
    await handle(req('PUT', '/plan', { body: { plan: PLAN } }), env);
    assert.ok(isSealed(user().torn_key), 'a plan-only sync seals it too');
});

test('paused users’ plain keys are sealed by the 10-minute cleanup', async () => {
    const { env, user } = await linkedEnv();
    Object.assign(user(), { torn_key: KEY, paused: 1 });
    await runCron(env, T0 + 120, world());
    assert.ok(isSealed(user().torn_key));
});

/* 5. A stale plan keeps strict jump steps; "out of date" once */

test('a stale plan still pings strict jump steps ahead; "plan out of date" once per synced plan', async () => {
    const tick = T0 + 240;
    const plan = { type: 'jump', steps: [{ at: T0 - 7200, kind: 'xanax', label: 'Xanax #1' }, { at: tick + 60, kind: 'jump', label: 'EDVD × 5 + Ecstasy', strict: true, tick }] };
    const a = dueAlerts(tornState({ drug: 3600 }), plan, T0, {}, { planStale: true, planAge: 13 * 3600, planAt: T0 - 13 * 3600 });
    assert.deepEqual(a.map((x) => x.kind).sort(), ['jump', 'stale']);
    const again = dueAlerts(tornState({ drug: 3600 }), plan, T0 + 86400, {}, { planStale: true, planAge: 37 * 3600, planAt: T0 - 13 * 3600, prev: { staleFor: T0 - 13 * 3600 } });
    assert.deepEqual(again.filter((x) => x.kind === 'stale'), []);
    const { env, user } = await linkedEnv({}, { plan });
    user().plan_at = T0 - 13 * 3600;
    await runCron(env, T0, world({ torn: tornState({ drug: 3600 }) }));
    assert.equal(JSON.parse(user().prev).staleFor, T0 - 13 * 3600);
    const f = world({ torn: tornState({ drug: 3600 }) });
    await runCron(env, T0 + 3 * 86400, f);
    assert.equal(posts(f).length, 0, 'not again after the sent row is cleared');
});

/* 6. Starvation */

test('rows no ping can reach never block the line; a Torn error still moves the user back', async () => {
    const { env, user } = await linkedEnv();
    for (let n = 0; n < 25; n++) await handle(req('PUT', '/plan', { secret: 'n' + String(n).padStart(2, '0') + 'z'.repeat(37), invite: 'x', body: { plan: PLAN } }), env);
    const f = world();
    await runCron(env, T0, f);
    assert.equal(posts(f).length, 1, 'the real user was served');
    const g = world({ torn: jsonRes({ error: { code: 17, error: 'Backend error' } }) });
    await runCron(env, T0 + 60, g);
    assert.equal(user().ran, T0 + 60);
});

/* 7. Buttons on a closed ping */

test('Done or Skip on a ping Torn already closed: "already done", no ack', async () => {
    const { env, id } = await linkedEnv();
    await runCron(env, T0, world());
    const row = [...env.DB.sent.values()][0];
    row.state = 'resolved';
    for (const verb of ['done', 'skip']) {
        const r = await body(handleInteraction(press(verb + ':' + row.alert, row.message), env, world(), ctx(), T0 + 60));
        assert.equal(r.type, 4);
        assert.equal(r.data.flags, 64);
        assert.match(r.data.content, /Already done: Torn shows it/);
    }
    assert.equal(env.DB.acks.size, 0);
    assert.equal(env.DB.sent.get(id + '|' + row.alert).state, 'resolved');
});

/* 8. /snooze kind:jump covers jump steps without a tick */

test('/snooze kind:jump also mutes jump sequence steps', async () => {
    const plan = { type: 'jump', steps: [{ at: T0 + 90, kind: 'boost', label: 'Ecstasy', strict: false }] };
    const { env } = await linkedEnv({}, { plan });
    await handleInteraction(command('snooze', { minutes: 30, kind: 'jump' }), env, world(), ctx(), T0);
    const f = world({ torn: tornState({ drug: 3600 }) });
    await runCron(env, T0, f);
    assert.equal(posts(f).length, 0);
});

/* 9. Watches: 5 minutes after the user's last check, whatever the minute */

test('price watches run 5 minutes after the last check, not only on :x0 / :x5', async () => {
    const { env } = await linkedEnv();
    await handleInteraction(command('watch', { item: '206', price: 1 }), env, world(), ctx(), T0);
    const reads = async (t) => {
        const f = world({ torn: (url) => (url.includes('/itemmarket') ? { itemmarket: { listings: [] } } : tornState({ drug: 3600 })) });
        await runCron(env, t, f);
        return f.calls.filter((c) => c.url.includes('/itemmarket')).length;
    };
    assert.equal(await reads(T0), 1, '10:48: first check');
    assert.equal(await reads(T0 + 60), 0);
    assert.equal(await reads(T0 + 240), 0, '4 minutes: not yet');
    assert.equal(await reads(T0 + 300), 1, '10:53');
    assert.ok(HOOK);
});
