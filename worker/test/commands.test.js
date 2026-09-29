import test from 'node:test';
import assert from 'node:assert/strict';

import { COMMAND_DEFS, HELP } from '../src/commands.js';
import { registration } from '../scripts/register.mjs';
import { handleInteraction } from '../src/interactions.js';
import { recorder, ctx, command, linkedEnv, botEnv, body, T0 } from './helpers.js';

const noFetch = recorder(() => {
    throw new Error('no outside call expected');
});

test('the command list is what Discord accepts', () => {
    const names = COMMAND_DEFS.map((c) => c.name);
    assert.equal(new Set(names).size, names.length, 'unique names');
    for (const c of COMMAND_DEFS) {
        assert.match(c.name, /^[a-z_]{1,32}$/);
        assert.ok(c.description.length >= 1 && c.description.length <= 100, c.name + ' description length');
        assert.ok((c.options || []).length <= 25);
        let optionalSeen = false;
        for (const o of c.options || []) {
            assert.match(o.name, /^[a-z_]{1,32}$/);
            assert.ok(o.description.length <= 100, c.name + '.' + o.name + ' description length');
            assert.ok(!(o.choices && o.choices.length > 25));
            if (!o.required) optionalSeen = true;
            else assert.ok(!optionalSeen, 'required options come first');
        }
    }
    for (const n of ['help', 'link', 'unlink', 'next', 'plan', 'timers', 'buy', 'watch', 'targets', 'target', 'war', 'chain', 'snooze', 'settings', 'status']) assert.ok(names.includes(n), '/' + n);
    assert.doesNotMatch(JSON.stringify(COMMAND_DEFS) + HELP, /\bFF\b/);
});

test('registration: a guild list without contexts; the global list with them; only discord.com', () => {
    const g = registration({ appId: '111222333', guildId: '444555666' });
    assert.equal(g.url, 'https://discord.com/api/v10/applications/111222333/guilds/444555666/commands');
    assert.ok(g.body.every((c) => c.contexts === undefined && c.integration_types === undefined));
    const all = registration({ appId: '111222333' });
    assert.equal(all.url, 'https://discord.com/api/v10/applications/111222333/commands');
    assert.deepEqual(all.body[0].contexts, [0, 1]);
    assert.throws(() => registration({ appId: '' }), /DISCORD_APP_ID/);
});

test('commands that need a link say how to link', async () => {
    const env = await botEnv();
    for (const name of ['status', 'plan', 'next']) {
        const b = await body(handleInteraction(command(name), env, noFetch, ctx(), T0));
        assert.match(b.data.content, /Get a link code/, name);
        assert.equal(b.data.flags, 64);
    }
});

test('/next: the next step with its Torn time and an Open in Torn link', async () => {
    const { env } = await linkedEnv();
    const b = await body(handleInteraction(command('next'), env, noFetch, ctx(), T0));
    assert.match(b.data.content, /\*\*Next:\*\* `10:51` Xanax #2 → DEX × 27 · <t:\d+:R>/);
    assert.equal(b.data.components[0].components[0].url, 'https://www.torn.com/item.php');
    assert.equal(b.data.components[0].components[0].style, 5, 'a link, not an action');
});

test('/plan: today’s steps in Torn time; a plan older than 12 h says so', async () => {
    const { env, user } = await linkedEnv();
    let b = await body(handleInteraction(command('plan'), env, noFetch, ctx(), T0));
    assert.match(b.data.content, /`10:51` Xanax #2 → DEX × 27/);
    assert.match(b.data.content, /`10:56` Refill · 30 points/);
    assert.match(b.data.content, /`15:48` Natural energy/);
    assert.doesNotMatch(b.data.content, /out of date/);
    user().plan_at = T0 - 13 * 3600;
    b = await body(handleInteraction(command('plan'), env, noFetch, ctx(), T0));
    assert.match(b.data.content, /out of date \(last synced 13 h ago\)/);
});

test('/status: key, plan sync, pings, and the test mode note', async () => {
    const { env, user } = await linkedEnv({ DRY_RUN: '1' });
    let b = await body(handleInteraction(command('status'), env, noFetch, ctx(), T0));
    assert.match(b.data.content, /pings go to your DMs/);
    assert.match(b.data.content, /Torn key: working/);
    assert.match(b.data.content, /Plan: synced 1 min ago/);
    assert.match(b.data.content, /0 in the last hour \(at most 10\), 0 today \(at most 60\)/);
    assert.match(b.data.content, /Off: Chain timeout/);
    assert.match(b.data.content, /Test mode/);
    Object.assign(user(), { paused: 1, last_error: 'Torn error 2: Incorrect key' });
    b = await body(handleInteraction(command('status'), env, noFetch, ctx(), T0));
    assert.match(b.data.content, /\*\*paused\*\*: Torn error 2/);
});
