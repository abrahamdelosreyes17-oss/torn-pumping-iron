/*
 * Session 13: the ping ticks (Settings › Discord pings in the userscript, synced as `rules`) and what the sync
 * answer says about delivery. The friend who "did not receive an alert" had DMs off: nothing told him, the sync
 * answered ready. And a /settings change in Discord won over the ticks for ever: now the latest change wins.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { handle, runCron } from '../src/index.js';
import { dueAlerts } from '../src/alerts.js';
import { KIND_DEFAULTS, cleanRules, settleKinds, kindsSet, settingsOf } from '../src/settings.js';
import { handleInteraction } from '../src/interactions.js';
import { linkedEnv, world, tornState, jsonRes, T0, req, body, command, ctx, PLAN, HOOK } from './helpers.js';

const sync = (env, extra = {}) => body(handle(req('PUT', '/plan', { body: { plan: PLAN, ...extra } }), env));
const refused = () => jsonRes({ message: 'Cannot send messages to this user', code: 50007 }, 403);
const kinds = (a) => a.map((x) => x.kind).sort();
const setting = (env, opts, at) => handleInteraction(command('settings', opts), env, world(), ctx(), at);

test('the sync answer says where pings go: the bot’s DM, the channel, or nowhere and why', async () => {
    const { env, user } = await linkedEnv();
    assert.deepEqual((await sync(env)).delivery, { ok: true, via: 'dm', reason: null, dmRefusedAt: null, webhook: false });
    // Discord refuses the DM (the friend: DMs off for everyone) and there is no webhook.
    await runCron(env, T0, world({ dmPost: refused }));
    let a = await sync(env);
    assert.deepEqual(a.delivery, { ok: false, via: null, reason: 'dm_refused', dmRefusedAt: T0, webhook: false });
    assert.equal(a.ready, true, 'ready keeps its old meaning for an older userscript (a key and a way are set up)');
    // With a channel webhook saved: pings arrive there, and the refused DM is still told.
    a = await sync(env, { webhookUrl: HOOK });
    assert.deepEqual(a.delivery, { ok: true, via: 'channel', reason: null, dmRefusedAt: T0, webhook: true });
    // A test ping that arrives by DM ends it.
    assert.equal((await handle(req('POST', '/test'), env, world())).status, 200);
    assert.deepEqual((await sync(env)).delivery, { ok: true, via: 'dm', reason: null, dmRefusedAt: null, webhook: true });
    // /settings delivery:channel: the webhook, whatever the DMs do.
    user().settings = JSON.stringify({ delivery: 'channel' });
    assert.equal((await sync(env)).delivery.via, 'channel');
    // Not linked and no webhook: nothing to deliver through.
    user().linked = 0;
    assert.deepEqual((await sync(env, { webhookUrl: '' })).delivery, { ok: false, via: null, reason: 'no_route', dmRefusedAt: null, webhook: false });
});

test('the ticks: stored clean (known kinds, true or false), told back as the kinds that are on', async () => {
    assert.deepEqual(cleanRules({ energy: false, nerve: true, bogus: true, drug: 'no', war: 0 }), { energy: false, nerve: true });
    assert.deepEqual(cleanRules(null), {});
    assert.deepEqual(cleanRules([true]), {});
    const { env, user } = await linkedEnv();
    let a = await sync(env);
    assert.deepEqual(a.kinds, KIND_DEFAULTS, 'nothing ticked off: the defaults (nerve among them: this service knows it)');
    assert.deepEqual(a.kindsSet, {});
    a = await sync(env, { rules: { energy: false, chain: true, bogus: true, drug: 'no' }, rulesAt: {} });
    assert.equal(user().rules, JSON.stringify({ energy: false, chain: true }));
    assert.deepEqual(a.kinds, { ...KIND_DEFAULTS, energy: false, chain: true });
    // A sync without ticks (an older userscript) keeps what is stored.
    a = await sync(env);
    assert.equal(a.kinds.energy, false);
    // A tick off stops that ping, a tick on brings it back.
    const f = world({ torn: tornState({ drug: 3600, energy: 150 }) });
    await runCron(env, T0, f);
    assert.equal(f.calls.filter((c) => c.url.endsWith('/messages')).length, 0, 'energy is ticked off');
    await sync(env, { rules: { energy: true }, rulesAt: { energy: T0 } });
    const g = world({ torn: tornState({ drug: 3600, energy: 150 }) });
    await runCron(env, T0 + 60, g);
    assert.equal(g.calls.filter((c) => c.url.endsWith('/messages')).length, 1);
});

test('the latest change wins: /settings in Discord over the ticks until they have seen it, a later tick over /settings', async () => {
    const { env, user } = await linkedEnv();
    await sync(env, { rules: { energy: true }, rulesAt: {} });
    // Energy switched off in Discord.
    const r = await body(setting(env, { kind: 'energy', on: false }, T0));
    assert.match(r.data.content, /^Saved: Energy full off\./);
    assert.equal(JSON.parse(user().settings).kindsAt.energy, T0);
    // The ticks sync as they were (not set by hand since): Discord's change stands and is told, to be taken over.
    let a = await sync(env, { rules: { energy: true }, rulesAt: {} });
    assert.equal(a.kinds.energy, false);
    assert.deepEqual(a.kindsSet, { energy: { on: false, at: T0 } });
    // A tick set by hand BEFORE the Discord change does not undo it either.
    a = await sync(env, { rules: { energy: true }, rulesAt: { energy: T0 - 600 } });
    assert.equal(a.kinds.energy, false, 'an older tick does not win');
    // The userscript took it over (its tick is off now, as of the Discord change): the ticks are the truth again.
    a = await sync(env, { rules: { energy: false }, rulesAt: { energy: T0 } });
    assert.equal(a.kinds.energy, false);
    assert.deepEqual(a.kindsSet, {});
    assert.deepEqual(JSON.parse(user().settings).kinds, {});
    // Ticked on again on the webpage: on, although /settings once said off.
    a = await sync(env, { rules: { energy: true }, rulesAt: { energy: T0 + 900 } });
    assert.equal(a.kinds.energy, true);
    // And the other way round: a tick set by hand AFTER a /settings change wins over it at once.
    await setting(env, { kind: 'nerve', on: false }, T0 + 1000);
    a = await sync(env, { rules: { energy: true, nerve: true }, rulesAt: { energy: T0 + 900, nerve: T0 + 1200 } });
    assert.equal(a.kinds.nerve, true);
    assert.deepEqual(a.kindsSet, {});
    // The other settings are kept through all of it.
    await setting(env, { quiet: '23-7', kind: 'chain', on: true }, T0 + 2000);
    a = await sync(env, { rules: { chain: false }, rulesAt: { chain: T0 + 3000 } });
    assert.equal(a.kinds.chain, false);
    assert.deepEqual(JSON.parse(user().settings).quiet, { from: 23, to: 7 });
});

test('a /settings change from before this build (no time kept) is taken over like any other', () => {
    const st = settingsOf({ settings: JSON.stringify({ kinds: { watch: false, bogus: true } }) });
    assert.deepEqual(kindsSet(st), { watch: { on: false, at: 0 } }, 'only kinds this build knows are told');
    assert.equal(settleKinds(st, {}), false, 'not seen yet');
    assert.equal(settleKinds(st, null), false);
    assert.equal(settleKinds(st, { watch: 0 }), true);
    assert.deepEqual(st.kinds, { bogus: true });
});

test('an older userscript (no ticks synced): /settings in Discord works as before', async () => {
    const { env, user } = await linkedEnv();
    await setting(env, { kind: 'energy', on: false }, T0);
    const a = await sync(env);
    assert.equal(a.kinds.energy, false);
    assert.equal(JSON.parse(user().settings).kinds.energy, false, 'kept: nothing took it over');
    const f = world({ torn: tornState({ drug: 3600, energy: 150 }) });
    await runCron(env, T0, f);
    assert.equal(f.calls.filter((c) => c.url.endsWith('/messages')).length, 0);
});

test('stacking for a chain or overdosed: a tick set on by hand during it (keep) goes out all the same', async () => {
    const CHAIN = { type: 'jump', noRefill: true, steps: [], chain: { since: T0 - 3600 } };
    const LATE = Math.floor(T0 / 86400) * 86400 + 86400 - 3600;
    const full = tornState({ drug: 3600, energy: 1000, max: 150 });
    assert.deepEqual(dueAlerts(full, CHAIN, T0), [], 'an older userscript: silent as before');
    const kept = dueAlerts(full, { ...CHAIN, chain: { since: T0 - 3600, keep: ['energy'] } }, T0);
    assert.deepEqual(kinds(kept), ['energy']);
    assert.equal(kept[0].text, 'You are stacking for a chain (this ping is ticked on in Pumping Iron)');
    assert.deepEqual(dueAlerts(tornState({ drug: 3600 }), { ...CHAIN, chain: { since: 1, keep: ['energy'] } }, LATE), [], 'the refill tick was not touched');
    assert.deepEqual(kinds(dueAlerts(tornState({ drug: 3600 }), { ...CHAIN, chain: { since: 1, keep: ['refill', 'drug', 7] } }, LATE)), ['refill']);
    // Ticked on by hand but switched off for good: off.
    assert.deepEqual(dueAlerts(full, { ...CHAIN, chain: { since: 1, keep: ['energy'] } }, T0, { energy: false }), []);
    // Overdosed: the same, next to the overdose ping.
    const OD = { type: 'jump', noRefill: true, steps: [], overdose: { at: T0 - 600, until: T0 + 80000 } };
    assert.deepEqual(kinds(dueAlerts(tornState({ drug: 80000, energy: 150 }), OD, LATE)), ['overdose']);
    assert.deepEqual(kinds(dueAlerts(tornState({ drug: 80000, energy: 150 }), { ...OD, overdose: { ...OD.overdose, keep: ['energy', 'refill'] } }, LATE)), ['energy', 'overdose', 'refill']);
    // Through the Worker: the plan is stored as sent, and the minute sends the kept ping.
    const { env } = await linkedEnv();
    await sync(env, { plan: { ...CHAIN, chain: { since: T0 - 3600, keep: ['energy'] } }, rules: { energy: true }, rulesAt: { energy: T0 - 60 } });
    const f = world({ torn: full });
    await runCron(env, T0, f);
    assert.equal(f.calls.filter((c) => c.url.endsWith('/messages')).length, 1);
});
