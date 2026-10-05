/*
 * Session 13 (a friend: "I did not receive an alert from the discord bot"): his Discord refused the bot's DM
 * (error 50007, DMs off for everyone) and he has no channel webhook. All he saw was "Your Worker answered 502."
 * after Send a test ping, and once he had changed his Discord setting the test still answered 502: the bot rests
 * DMs for 6 hours after a refusal and the test ping kept to that rest.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { handle, runCron } from '../src/index.js';
import { DM_RETRY_S } from '../src/deliver.js';
import { linkedEnv, world, jsonRes, tornState, T0, HOOK, req, body } from './helpers.js';

const discordCalls = (f) => f.calls.filter((c) => new URL(c.url).hostname === 'discord.com');
const refused = () => jsonRes({ code: 50007, message: 'Cannot send messages to this user' }, 403);
const nowS = () => Math.floor(Date.now() / 1000);

test('test ping: the DM is tried inside the 6-hour rest after a refused one, and one that arrives ends the rest', async () => {
    const { env, user } = await linkedEnv();
    Object.assign(user(), { dm_fail: nowS() - 60, dm_channel: null });
    const f = world();
    const r = await handle(req('POST', '/test'), env, f);
    assert.equal(r.status, 200, 'it answered 502 without asking Discord: the rest also held the test back');
    assert.deepEqual(await r.json(), { ok: true, via: 'dm' });
    assert.deepEqual(discordCalls(f).map((c) => new URL(c.url).pathname), ['/api/v10/users/@me/channels', '/api/v10/channels/dm-chan-1/messages']);
    assert.equal(user().dm_fail, 0, 'the rest is over: the next ping is a DM again');
    assert.equal(user().dm_channel, 'dm-chan-1');
});

test('test ping: a refused DM and no webhook says so, in a reason the browser reads and in words', async () => {
    const { env, user } = await linkedEnv();
    const r = await handle(req('POST', '/test'), env, world({ dmPost: refused }));
    assert.equal(r.status, 409);
    const b = await r.json();
    assert.equal(b.ok, false);
    assert.equal(b.reason, 'dm_refused');
    assert.match(b.error, /Discord refused the bot’s DM\..*Privacy Settings.*Direct Messages on/);
    assert.ok(user().dm_fail >= nowS() - 5, 'the refusal is on record (the sync answer tells the browser)');
    // Still refused a minute later: asked again (a test never rests), the same answer.
    const g = world({ dmPost: refused });
    const again = await handle(req('POST', '/test'), env, g);
    assert.equal(again.status, 409);
    assert.equal(discordCalls(g).length, 2, 'open and post: Discord was asked');
    // 50007 when the DM channel is opened (no shared server) is the same refusal.
    Object.assign(user(), { dm_fail: 0, dm_channel: null });
    const open = await body(handle(req('POST', '/test'), env, world({ dmOpen: () => jsonRes({ code: 50007, message: 'x' }, 400) })));
    assert.equal(open.reason, 'dm_refused');
});

test('test ping: another Discord error is not called a refused DM, and starts no rest', async () => {
    const { env, user } = await linkedEnv();
    const r = await handle(req('POST', '/test'), env, world({ dmPost: () => jsonRes({ message: 'oops' }, 500) }));
    assert.equal(r.status, 502);
    assert.deepEqual(await r.json(), { ok: false, reason: 'discord_error', error: 'Discord answered an error (500). Try again in a minute.', discordStatus: 500, discordCode: null });
    assert.equal(Number(user().dm_fail) || 0, 0);
});

test('test ping: nothing to deliver through (not linked, no webhook)', async () => {
    const { env, user } = await linkedEnv();
    user().linked = 0;
    const f = world();
    const r = await handle(req('POST', '/test'), env, f);
    assert.equal(r.status, 400);
    const b = await r.json();
    assert.equal(b.reason, 'no_route');
    assert.match(b.error, /^Nothing to deliver through/);
    assert.equal(f.calls.length, 0);
});

test('test ping: a refused DM with a webhook saved goes to the channel, and says the DM was refused', async () => {
    const { env } = await linkedEnv({}, { webhookUrl: HOOK });
    const f = world({ dmPost: refused });
    const r = await handle(req('POST', '/test'), env, f);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { ok: true, via: 'hook', dmRefused: true });
    assert.equal(discordCalls(f).at(-1).url, HOOK + '?wait=true');
});

test('the minute still rests DMs for 6 hours after a refusal, then tries again; a DM that arrives clears the record', async () => {
    const { env, user } = await linkedEnv();
    await runCron(env, T0, world({ dmPost: refused }));
    assert.equal(user().dm_fail, T0);
    assert.equal(env.DB.sent.size, 0, 'nothing went out: it is tried again');
    // An hour on: no DM is tried (and with no webhook nothing is sent).
    const g = world({ torn: tornState({ drug: 200 }) });
    await runCron(env, T0 + 3600, g);
    assert.equal(discordCalls(g).length, 0);
    assert.equal(user().dm_fail, T0);
    // Past the rest: tried, and it arrives.
    const h = world({ torn: tornState({ drug: 200 }) });
    await runCron(env, T0 + DM_RETRY_S + 60, h);
    assert.equal(discordCalls(h).filter((c) => c.url.endsWith('/messages')).length, 1);
    assert.equal(user().dm_fail, 0);
    assert.equal(user().dm_channel, 'dm-chan-1');
});
