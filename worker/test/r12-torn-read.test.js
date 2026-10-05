/*
 * Session 13: the Worker's own Torn read. It always asked for bars, cooldowns, refills and travel; a key without
 * the travel read (Torn error 16) works in the app, which reads again without travel, and failed every minute on
 * the Worker, with no pause and nothing said. And a read that keeps failing for another reason was never told.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { handle, runCron, TORN_URL } from '../src/index.js';
import { TORN_URL_NO_TRAVEL, NO_TRAVEL_RECHECK_S, READ_FAIL_RUNS, tornReadOf } from '../src/torn.js';
import { handleInteraction } from '../src/interactions.js';
import { linkedEnv, world, tornState, T0, req, body, command, ctx, PLAN } from './helpers.js';

const tornCalls = (f) => f.calls.filter((c) => c.url.startsWith('https://api.torn.com/')).map((c) => c.url);
const err = (code, error) => ({ error: { code, error } });
const ACCESS = err(16, 'Access level of this key is not high enough');
/** A key that reads everything but travel. */
const noTravelKey = (state = tornState()) => (url) => {
    if (url === TORN_URL) return ACCESS;
    const { travel: _t, ...rest } = state;
    return rest;
};
const sync = (env, extra = {}) => body(handle(req('PUT', '/plan', { body: { plan: PLAN, ...extra } }), env));

test('a key without the travel read: asked again without it, the ping goes, and the next minute asks once', async () => {
    const { env, user } = await linkedEnv();
    const f = world({ torn: noTravelKey() });
    const out = await runCron(env, T0, f);
    assert.deepEqual(tornCalls(f), [TORN_URL, TORN_URL_NO_TRAVEL], 'Torn answered 16 and nothing more was asked: no ping, every minute');
    assert.equal(out[0].sent, 1, 'the drug cooldown ping went out');
    assert.equal(JSON.parse(user().prev).noTravel, true);
    assert.equal(Number(user().paused) || 0, 0);
    const g = world({ torn: noTravelKey(tornState({ drug: 172 })) });
    await runCron(env, T0 + 60, g);
    assert.deepEqual(tornCalls(g), [TORN_URL_NO_TRAVEL], 'remembered: Torn is not asked twice a minute');
    assert.deepEqual((await sync(env)).tornRead, { ok: true, at: T0 + 60, travel: false });
});

test('a key without travel is asked for it again a day later, and at once when a new key is sent', async () => {
    const { env, user } = await linkedEnv();
    await runCron(env, T0, world({ torn: noTravelKey() }));
    // A day on, the key reads travel now: asked with it, and that is remembered.
    const f = world({ torn: tornState({ drug: 3600 }) });
    await runCron(env, T0 + NO_TRAVEL_RECHECK_S, f);
    assert.deepEqual(tornCalls(f), [TORN_URL]);
    assert.equal(JSON.parse(user().prev).noTravel, undefined);
    // Without travel again, then a new key: the next minute asks with travel first.
    await runCron(env, T0 + NO_TRAVEL_RECHECK_S + 60, world({ torn: noTravelKey(tornState({ drug: 3600 })) }));
    assert.equal(JSON.parse(user().prev).noTravel, true);
    assert.equal((await sync(env, { tornKey: 'NewCustomKey1234' })).tornRead.travel, true);
    const g = world({ torn: tornState({ drug: 3600 }) });
    await runCron(env, T0 + NO_TRAVEL_RECHECK_S + 120, g);
    assert.deepEqual(tornCalls(g), [TORN_URL]);
});

test('a read that keeps failing is told in the sync answer after a few minutes, never as a pause; one good read clears it', async () => {
    const { env, user } = await linkedEnv();
    assert.deepEqual((await sync(env)).tornRead, { ok: null, at: null, travel: true }, 'not read yet');
    await runCron(env, T0, world({ torn: tornState({ drug: 3600 }) }));
    assert.deepEqual((await sync(env)).tornRead, { ok: true, at: T0, travel: true });
    const down = () => world({ torn: err(17, 'Backend error occurred, please try again') });
    for (let i = 1; i < READ_FAIL_RUNS; i++) {
        await runCron(env, T0 + i * 60, down());
        assert.equal((await sync(env)).tornRead.ok, true, 'a hiccup of ' + i + ' min is not told');
    }
    await runCron(env, T0 + READ_FAIL_RUNS * 60, down());
    const a = await sync(env);
    assert.deepEqual(a.tornRead, { ok: false, at: T0, travel: true, since: T0 + 60, code: 17, error: 'Torn’s API is down (Torn error 17).' });
    assert.equal(a.paused, false, 'a Torn hiccup is not a pause');
    assert.equal(Number(user().paused) || 0, 0);
    assert.equal(JSON.parse(user().prev).at, T0, 'the last good read is kept');
    await runCron(env, T0 + 600, world({ torn: tornState({ drug: 3000 }) }));
    assert.deepEqual((await sync(env)).tornRead, { ok: true, at: T0 + 600, travel: true });
});

test('a key that can read neither: the reason is the access level, in words', async () => {
    const { env } = await linkedEnv();
    for (let i = 0; i < READ_FAIL_RUNS; i++) {
        const f = world({ torn: ACCESS });
        await runCron(env, T0 + i * 60, f);
        assert.equal(tornCalls(f).length, i === 0 ? 2 : 1, 'with travel then without the first time; after that the smaller read only');
    }
    const r = (await sync(env)).tornRead;
    assert.equal(r.ok, false);
    assert.equal(r.code, 16);
    assert.equal(r.error, 'The key on the service can’t read your bars and cooldowns (Torn error 16).');
    assert.deepEqual(tornReadOf('not json'), { ok: null, at: null, travel: true });
});

test('/timers answers for a key without the travel read', async () => {
    const { env } = await linkedEnv();
    const f = world({ torn: noTravelKey(tornState({ drug: 232 })) });
    const c = ctx();
    await handleInteraction(command('timers'), env, f, c, T0);
    await c.done();
    const patch = f.calls.find((x) => x.url === 'https://discord.com/api/v10/webhooks/111/tok-timers/messages/@original');
    assert.match(patch.body.content, /Drug: 4 min/, 'it said the key can’t read this');
});
