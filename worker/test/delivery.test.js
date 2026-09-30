import test from 'node:test';
import assert from 'node:assert/strict';

import { runCron } from '../src/index.js';
import { handle } from '../src/index.js';
import { linkedEnv, world, jsonRes, tornState, T0, DISCORD_USER, HOOK, req } from './helpers.js';

const discordCalls = (f) => f.calls.filter((c) => new URL(c.url).hostname === 'discord.com');

test('a linked user gets a DM from the bot, with Done, Snooze, Skip and Open in Torn', async () => {
    const { env, id, user } = await linkedEnv();
    const f = world();
    await runCron(env, T0, f);
    const d = discordCalls(f);
    assert.equal(d.length, 2, 'open the DM, then post');
    assert.equal(d[0].url, 'https://discord.com/api/v10/users/@me/channels');
    assert.deepEqual(d[0].body, { recipient_id: DISCORD_USER });
    assert.equal(d[0].init.headers.authorization, 'Bot bot-token');
    assert.equal(d[1].url, 'https://discord.com/api/v10/channels/dm-chan-1/messages');
    const m = d[1].body;
    assert.equal(m.content, 'Drug cooldown ends in 4 min');
    assert.equal(m.embeds[0].description, 'Xanax #2, then DEX × 27');
    assert.equal(m.embeds[0].url, 'https://www.torn.com/item.php');
    assert.deepEqual(m.allowed_mentions, { parse: [] });
    const btns = m.components[0].components;
    assert.deepEqual(btns.map((b) => b.label), ['Done', 'Snooze 10 min', 'Skip step', 'Open in Torn']);
    assert.deepEqual(btns.map((b) => b.custom_id || b.url), ['done:' + 'drug:' + Math.round((T0 + 232) / 300), 'snooze:drug:' + Math.round((T0 + 232) / 300), 'skip:drug:' + Math.round((T0 + 232) / 300), 'https://www.torn.com/item.php']);
    const row = [...env.DB.sent.values()][0];
    assert.equal(row.via, 'dm');
    assert.equal(row.channel, 'dm-chan-1');
    assert.match(row.message, /^msg-/);
    assert.equal(JSON.parse(row.body).step.label, 'Xanax #2');
    assert.equal(user().dm_channel, 'dm-chan-1', 'the DM channel is kept');
    // An hour on: the drug was taken (the ping closes itself), energy is full (a new ping, same DM channel).
    const g = world({ torn: tornState({ drug: 3600, energy: 150 }) });
    await runCron(env, T0 + 3600, g);
    assert.deepEqual(discordCalls(g).map((c) => (c.init.method || 'GET') + ' ' + new URL(c.url).pathname), ['PATCH /api/v10/channels/dm-chan-1/messages/' + row.message, 'POST /api/v10/channels/dm-chan-1/messages']);
    assert.equal(discordCalls(g)[0].body.embeds[0].footer.text, 'Seen in Torn');
    assert.deepEqual(discordCalls(g)[0].body.components[0].components.map((b) => b.label), ['Open in Torn']);
    assert.ok(env.DB.sent.has(id + '|energy:' + Math.floor((T0 + 3600) / 3600)));
});

test('DMs closed (50007): the ping goes to the channel webhook with a mention, and DMs rest for 6 h', async () => {
    const { env, user } = await linkedEnv({}, { webhookUrl: HOOK });
    const f = world({ dmPost: () => jsonRes({ code: 50007, message: 'Cannot send messages to this user' }, 403) });
    await runCron(env, T0, f);
    const d = discordCalls(f);
    assert.equal(d.length, 3, 'open, DM refused, webhook');
    assert.equal(d[2].url, HOOK + '?wait=true');
    assert.equal(d[2].init.headers.authorization, undefined, 'no bot token to a webhook');
    assert.match(d[2].body.content, new RegExp('^<@' + DISCORD_USER + '> drug cooldown ends in 4 min'));
    assert.deepEqual(d[2].body.allowed_mentions, { users: [DISCORD_USER], parse: [] });
    assert.equal(d[2].body.components, undefined, 'a plain webhook has no buttons');
    assert.equal(user().dm_fail, T0);
    assert.equal([...env.DB.sent.values()][0].via, 'hook');
    // Next hour: straight to the webhook.
    const g = world({ torn: tornState({ drug: 3600, energy: 150 }) });
    await runCron(env, T0 + 3600, g);
    const hookRow = [...env.DB.sent.values()].find((r) => r.alert.startsWith('drug:'));
    assert.deepEqual(discordCalls(g).map((c) => c.url), [HOOK + '/messages/' + hookRow.message, HOOK + '?wait=true'], 'the webhook message is closed by an edit, then the new ping');
});

test('no shared server (50007 when opening the DM) also falls back', async () => {
    const { env } = await linkedEnv({}, { webhookUrl: HOOK });
    const f = world({ dmOpen: () => jsonRes({ code: 50007, message: 'Cannot send messages to this user' }, 400) });
    await runCron(env, T0, f);
    assert.deepEqual(discordCalls(f).map((c) => c.url), ['https://discord.com/api/v10/users/@me/channels', HOOK + '?wait=true']);
});

test('Discord down and no webhook: nothing is recorded, so the ping is tried again next minute', async () => {
    const { env } = await linkedEnv();
    await runCron(env, T0, world({ dmPost: () => jsonRes({ message: 'oops' }, 500) }));
    assert.equal(env.DB.sent.size, 0);
    const f = world({ torn: tornState({ drug: 172 }) });
    await runCron(env, T0 + 60, f);
    assert.equal(env.DB.sent.size, 1);
});

test('pings due in the same minute go out as one message, one button row each', async () => {
    const { env } = await linkedEnv({}, { plan: { type: 'steady', steps: [{ at: T0 + 232, kind: 'xanax', label: 'Xanax #2', train: 'DEX × 27' }] } });
    const f = world({ torn: tornState({ drug: 232, energy: 150 }) });
    await runCron(env, T0, f);
    const posts = discordCalls(f).filter((c) => c.url.endsWith('/messages'));
    assert.equal(posts.length, 1);
    const m = posts[0].body;
    assert.equal(m.embeds.length, 2);
    assert.equal(m.content, 'Drug cooldown ends in 4 min · Energy is full');
    assert.deepEqual(m.components.map((r) => r.components[0].label), ['Done · Drug', 'Done · Energy']);
    assert.equal(env.DB.sent.size, 2);
    assert.equal(new Set([...env.DB.sent.values()].map((r) => r.message)).size, 1);
});

test('delivery set to channel: the webhook even when linked', async () => {
    const { env, user } = await linkedEnv({}, { webhookUrl: HOOK });
    user().settings = JSON.stringify({ delivery: 'channel' });
    const f = world();
    await runCron(env, T0, f);
    assert.deepEqual(discordCalls(f).map((c) => c.url), [HOOK + '?wait=true']);
});

test('DRY_RUN=1: Torn is read, nothing is posted, the bodies land in the outbox', async () => {
    const { env } = await linkedEnv({ DRY_RUN: '1' }, { webhookUrl: HOOK });
    const f = world();
    await runCron(env, T0, f);
    assert.equal(discordCalls(f).length, 0);
    assert.equal(f.calls.length, 1, 'only the Torn read');
    assert.equal(env.DB.outbox.length, 2, 'the DM open and the message');
    assert.equal(env.DB.outbox[1].route, 'dm:' + DISCORD_USER);
    assert.equal(JSON.parse(env.DB.outbox[1].body).embeds[0].title, 'Drug cooldown ends in 4 min');
    assert.equal([...env.DB.sent.values()][0].via, 'dry');
});

test('POST /test goes through the same path: a DM with buttons when linked', async () => {
    const { env } = await linkedEnv();
    const f = world();
    const r = await handle(req('POST', '/test'), env, f);
    assert.equal(r.status, 200);
    const post = discordCalls(f).find((c) => c.url.endsWith('/messages'));
    assert.equal(post.body.embeds[0].title, 'Test ping from Pumping Iron');
    assert.deepEqual(post.body.components[0].components.map((b) => b.label), ['Done', 'Snooze 10 min', 'Skip step', 'Open in Torn']);
});

test('a discordapp.com webhook is kept on discord.com (the only Discord host called); a thread is kept', async () => {
    const { hookUrl } = await import('../src/deliver.js');
    assert.equal(hookUrl('https://discordapp.com/api/webhooks/1/abc'), 'https://discord.com/api/webhooks/1/abc');
    assert.equal(hookUrl('https://discord.com/api/webhooks/1/abc?thread_id=9&x=1', '/messages/5', { wait: 'true' }), 'https://discord.com/api/webhooks/1/abc/messages/5?thread_id=9&wait=true');
    const { env, user } = await linkedEnv({}, { webhookUrl: 'https://discordapp.com/api/webhooks/123/abc' });
    assert.equal(user().webhook, 'https://discord.com/api/webhooks/123/abc');
    user().linked = 0;
    const f = world();
    await runCron(env, T0, f);
    assert.deepEqual(discordCalls(f).map((c) => c.url), ['https://discord.com/api/webhooks/123/abc?wait=true']);
});

test('a user with neither webhook nor link is skipped without a Torn read', async () => {
    const { env, user } = await linkedEnv();
    user().linked = 0;
    const f = world();
    assert.deepEqual(await runCron(env, T0, f), [], 'not even picked: it would block the line');
    assert.equal(f.calls.length, 0);
});

test('energy: pinged ahead when Torn says it fills within 90 s; the full read after is the same ping, and filling does not close it', async () => {
    const { env, id } = await linkedEnv();
    // 146/150: full in 144 s, past the lead: nothing about energy yet (the drug ping goes).
    await runCron(env, T0, world({ torn: tornState({ drug: 3600, energy: 146 }) }));
    assert.ok(![...env.DB.sent.keys()].some((k) => k.includes('|energy:')), 'not yet: 144 s is more than a run ahead');
    // A minute on, 148/150: full in 72 s, the last run 30 s ahead of it.
    const f = world({ torn: tornState({ drug: 3600, energy: 148 }) });
    await runCron(env, T0 + 60, f);
    const post = discordCalls(f).find((c) => (c.init.method || 'GET') === 'POST' && /messages$/.test(c.url));
    assert.equal(post.body.content, 'Energy full in 72 s (' + new Date((T0 + 132) * 1000).toISOString().slice(11, 19) + ' TCT)');
    const key = id + '|energy:' + Math.floor((T0 + 132) / 3600);
    assert.ok(env.DB.sent.has(key));
    assert.equal(JSON.parse(env.DB.sent.get(key).body).fullAt, T0 + 132);
    // Still filling at the next run (149/150, 36 s left): not "Seen in Torn", no second ping.
    const g = world({ torn: tornState({ drug: 3600, energy: 149 }) });
    await runCron(env, T0 + 96, g);
    assert.equal(discordCalls(g).length, 0, 'no edit, no new message');
    assert.equal(env.DB.sent.get(key).state, 'sent');
    // Full: the same ping (same id), nothing new.
    const h = world({ torn: tornState({ drug: 3600, energy: 150 }) });
    await runCron(env, T0 + 156, h);
    assert.equal(discordCalls(h).length, 0);
    // Trained after it filled: closed as seen in Torn.
    const k = world({ torn: tornState({ drug: 3600, energy: 20 }) });
    await runCron(env, T0 + 216, k);
    assert.equal(env.DB.sent.get(key).state, 'resolved');
});
