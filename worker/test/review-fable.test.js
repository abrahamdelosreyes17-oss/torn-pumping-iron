/*
 * Fixes from the three-pass review (docs/review-fable-2026-09-29.md):
 * a user cap, own-property dispatch, a failing row moved to the back, and a
 * message Discord refuses recorded as failed instead of retried forever.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { handle, runCron, DEFAULT_MAX_USERS } from '../src/index.js';
import { handleInteraction } from '../src/interactions.js';
import { botEnv, linkedEnv, world, tornState, jsonRes, T0, PLAN, KEY, req, body, command, ctx } from './helpers.js';

test('S-2: one Worker serves at most MAX_USERS people; people already on it keep syncing', async () => {
    const env = await botEnv({ MAX_USERS: '3' });
    for (let n = 0; n < 3; n++) {
        const r = await handle(req('PUT', '/plan', { secret: String(n).padStart(2, '0') + 'z'.repeat(38), invite: 'x', body: { tornKey: KEY, plan: PLAN } }), env);
        assert.equal(r.status, 200);
    }
    const full = await handle(req('PUT', '/plan', { secret: '99' + 'z'.repeat(38), invite: 'x', body: { tornKey: KEY, plan: PLAN } }), env);
    assert.equal(full.status, 403);
    assert.match((await body(full)).error, /full/);
    const again = await handle(req('PUT', '/plan', { secret: '00' + 'z'.repeat(38), body: { plan: PLAN } }), env);
    assert.equal(again.status, 200, 'an existing user still syncs');
    assert.ok(DEFAULT_MAX_USERS >= 2);
});

test('S-2: a sync over 30 kB is refused', async () => {
    const env = await botEnv();
    const r = await handle(req('PUT', '/plan', { invite: 'x', body: { tornKey: KEY, plan: { steps: [], pad: 'x'.repeat(31000) } } }), env);
    assert.equal(r.status, 413);
});

test('S-3: a command or button named like an Object method is "unknown", not a crash', async () => {
    const env = await botEnv();
    for (const name of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
        const res = await handleInteraction(command(name), env, async () => jsonRes({}), ctx(), T0);
        assert.ok(res instanceof Response);
        assert.match(JSON.stringify(await res.json()), /don.t know that command/);
    }
    const btn = await handleInteraction({ type: 3, data: { custom_id: 'constructor:x' }, member: { user: { id: '1' } } }, env, async () => jsonRes({}), ctx(), T0);
    assert.ok(btn instanceof Response);
});

test('B-9: a row that fails for a non-Torn reason goes to the back of the line', async () => {
    const { env, user } = await linkedEnv();
    const before = Number(user().ran) || 0;
    const f = world({ torn: () => { throw new TypeError('network down'); } });
    await runCron(env, T0 + 120, f);
    assert.ok(Number(user().ran) > before, 'ran moved on (' + user().ran + ')');
});

test('B-15: a message Discord refuses (400) is recorded as failed, not retried every minute', async () => {
    const { env, user } = await linkedEnv();
    let posts = 0;
    const f = world({ dmPost: () => (posts++, jsonRes({ code: 50035, message: 'Invalid Form Body' }, 400)) });
    await runCron(env, T0, f);
    const first = posts;
    assert.ok(first >= 1);
    // A minute later the same cooldown (60 s less): the same alert, which must not go out again.
    const g = world({ torn: tornState({ drug: 172 }), dmPost: () => (posts++, jsonRes({ code: 50035, message: 'Invalid Form Body' }, 400)) });
    await runCron(env, T0 + 60, g);
    assert.equal(posts, first, 'not sent again');
    void user;
});
