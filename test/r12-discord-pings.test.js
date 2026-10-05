/*
 * Session 13: the Discord ping ticks (Settings › Discord pings) and what Settings says about the service.
 * A friend "did not receive an alert from the discord bot": Discord refused the bot's DM, Settings said Working,
 * the test ping said "Your Worker answered 502." and nothing was in his problem log.
 * The ticks: the owner wants every ping on a tick, and "I'm stacking" and a war to move the ticks by themselves.
 * Run against a stand-in for the service in use today (an older build) and against the real handler of this one.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { PING_DEFAULTS, PING_KINDS, PING_GROUPS, CHAIN_OFF, WAR_ON, MODE_NOTE, pingTicks, pingSync, setTick, adoptKinds, warSeen, pingStore } from '../src/core/pings.js';
import { discordView, testFailOf, testSentWords, DM_STEPS, discordWhen } from '../src/core/discord-state.js';
import { KIND_DEFAULTS } from '../worker/src/settings.js';
import { CHAIN_SKIPPED } from '../worker/src/alerts.js';
import { KINDS } from '../worker/src/commands.js';
import { handle, runCron } from '../worker/src/index.js';
import { handleInteraction } from '../worker/src/interactions.js';
import { botEnv, world, tornState, jsonRes, command, ctx, DISCORD_USER, HOOK } from '../worker/test/helpers.js';
import { gmSet, gmGet, gmDel } from '../src/platform/gm.js';
import { maybeSyncPlan, syncTicksSoon, connectDiscord, testDiscord, loginDiscord, discordRaw, planPayload, SYNC_MIN_MS, TICK_SYNC_MIN_MS } from '../src/discord.js';
import { pingsNow, setPing } from '../src/pings.js';
import { problemLogNow, clearProblemLog } from '../src/problem-log.js';

const BASE = 'https://svc.workers.dev';
const SECRET = 'c'.repeat(64);
const T = Date.UTC(2026, 9, 5, 12, 0);
const tick = () => new Promise((r) => setTimeout(r, 5));
const model = (o = {}) => ({ ready: true, steps: [{ at: T + 3600e3, kind: 'xanax', label: 'Xanax #1', trains: {} }], ...o });
const logLines = () => problemLogNow().map((e) => e.what + (e.detail ? ' | ' + e.detail : ''));
const clean = () => {
    for (const k of ['worker', 'pingTicks', 'userStatic', 'eyeWarAuto', 'apiKey']) gmDel(k);
    clearProblemLog();
};

/** The service in use today (built from userscript 1.2.3): it knows no reason, no delivery state, no nerve. */
function oldService({ test: testStatus = 200 } = {}) {
    const calls = [];
    const f = async (url, init = {}) => {
        const path = new URL(url).pathname;
        calls.push({ path, method: init.method, body: init.body ? JSON.parse(init.body) : null });
        if (path === '/test') return testStatus === 200 ? { ok: true, status: 200, json: async () => ({ ok: true }) } : { ok: false, status: testStatus, json: async () => ({ ok: false }) };
        return { ok: true, status: 200, json: async () => ({ ok: true, created: false, acks: [], ready: true, paused: false, lastError: null, linked: true, bot: true }) };
    };
    f.calls = calls;
    return f;
}

async function withFetch(f, run) {
    const real = globalThis.fetch;
    globalThis.fetch = f;
    try {
        return await run();
    } finally {
        globalThis.fetch = real;
    }
}

/* ------------------------------------------------------------------ the ticks, pure */

test('the ticks list the service’s own kinds with its defaults', () => {
    assert.deepEqual(PING_DEFAULTS, KIND_DEFAULTS, 'the two lists are the same');
    assert.deepEqual([...PING_KINDS].sort(), Object.keys(KIND_DEFAULTS).sort(), 'every kind has a tick, and only real kinds');
    assert.deepEqual([...PING_KINDS].sort(), Object.keys(KINDS).sort(), 'the same kinds /settings in Discord switches');
    for (const g of PING_GROUPS) for (const [, label, hint] of g.kinds) assert.ok(label && hint && !/—/.test(label + hint));
    assert.ok(CHAIN_OFF.every((k) => CHAIN_SKIPPED.includes(k)), 'the stacking ticks are kinds the bot silences while stacking');
    assert.ok(!CHAIN_OFF.includes('nerve') && !CHAIN_SKIPPED.includes('nerve'), 'nerve is not an energy or training kind');
    const t = pingTicks(null);
    assert.deepEqual(Object.fromEntries(PING_KINDS.map((k) => [k, t[k].on])), KIND_DEFAULTS);
    assert.ok(PING_KINDS.every((k) => !t[k].hand && !t[k].mode));
});

test('"I’m stacking" turns the energy and training ticks off, Resume brings back what they were', () => {
    let st = setTick(null, 'refill', false, T - 5000); // set off by hand long before
    const during = pingTicks(st, { chain: T });
    assert.deepEqual(CHAIN_OFF.map((k) => [k, during[k].on, during[k].mode]), [['energy', false, 'chain'], ['refill', false, null], ['jump', false, 'chain']], 'a tick that was off already did not move');
    assert.equal(during.nerve.on, true, 'nerve stays');
    assert.equal(during.drug.on, true);
    assert.equal(MODE_NOTE.chain, 'off while you are stacking · back on Resume');
    const after = pingTicks(st, {});
    assert.deepEqual(CHAIN_OFF.map((k) => after[k].on), [true, false, true], 'what they were');
    // An overdose does the same, with its own words.
    assert.equal(pingTicks(st, { overdose: T }).energy.mode, 'overdose');
    // A tick changed by hand while stacking wins over the mode, and is kept afterwards.
    st = setTick(st, 'energy', true, T + 60000);
    assert.deepEqual([pingTicks(st, { chain: T }).energy.on, pingTicks(st, { chain: T }).energy.mode], [true, null]);
    st = setTick(st, 'jump', false, T + 61000);
    assert.equal(pingTicks(st, {}).jump.on, false, 'ticked off by hand during it: off after Resume too');
    assert.equal(pingTicks(st, {}).energy.on, true);
    // The next time stacking starts, the mode wins again (the hand change is older than it).
    assert.equal(pingTicks(st, { chain: T + 86400e3 }).energy.on, false);
});

test('a war turns the war ticks on, the end of it brings them back; a hand change during it stays', () => {
    assert.deepEqual(WAR_ON, ['war', 'chain']);
    let st = setTick(null, 'war', false, T - 5000);
    const during = pingTicks(st, { war: T });
    assert.deepEqual([during.war.on, during.war.mode, during.chain.on, during.chain.mode], [true, 'war', true, 'war']);
    assert.deepEqual([pingTicks(st, {}).war.on, pingTicks(st, {}).chain.on], [false, false], 'back to what they were');
    st = setTick(st, 'chain', false, T + 1000);
    assert.deepEqual([pingTicks(st, { war: T }).chain.on, pingTicks(st, { war: T }).chain.mode], [false, null], 'unticked during the war: stays off');
    // The war is noted once, with the time it was first seen, and dropped when it is over.
    const seen = warSeen(null, 'ranked:77', T);
    assert.deepEqual(seen.war, { key: 'ranked:77', since: T });
    assert.deepEqual(warSeen(seen, 'ranked:77', T + 9999).war, { key: 'ranked:77', since: T });
    assert.equal(warSeen(seen, null, T + 9999).war, null);
});

test('what the sync sends: every kind, the war mode in it, stacking left to the bot (with what was ticked back on)', () => {
    const base = pingSync(null, {});
    assert.deepEqual(base, { rules: KIND_DEFAULTS, rulesAt: {}, keep: [] });
    // Stacking: the bot silences those kinds itself from the plan's flag, so the rules stay what they will be after Resume.
    assert.deepEqual(pingSync(null, { chain: T }), { rules: KIND_DEFAULTS, rulesAt: {}, keep: [] });
    let st = setTick(null, 'energy', true, T + 1000);
    st = setTick(st, 'refill', false, T + 2000);
    const s = pingSync(st, { chain: T });
    assert.deepEqual(s.keep, ['energy'], 'ticked back on during it: the bot sends it all the same');
    assert.equal(s.rules.refill, false);
    assert.deepEqual(s.rulesAt, { energy: Math.floor((T + 1000) / 1000), refill: Math.floor((T + 2000) / 1000) });
    // The war mode is in the rules (the bot has no war mode of its own).
    assert.equal(pingSync(null, { war: T }).rules.chain, true);
    assert.equal(pingSync(null, {}).rules.chain, false);
    // The plan's flag carries what was kept.
    assert.deepEqual(planPayload(model({ stacking: { since: T } }), ['energy']).chain, { since: T / 1000, keep: ['energy'] });
    assert.deepEqual(planPayload(model({ stacking: { since: T } })).chain, { since: T / 1000 }, 'nothing kept: as before');
    assert.deepEqual(planPayload(model({ overdose: { at: T, until: T + 3600e3 } }), ['refill']).overdose.keep, ['refill']);
});

test('/settings in Discord and the ticks: the latest change wins', () => {
    // Switched off in Discord at T: taken over as a hand change of that time.
    let st = adoptKinds(null, { energy: { on: false, at: T / 1000 } });
    assert.deepEqual(st.hand.energy, { on: false, at: T });
    assert.equal(pingTicks(st).energy.on, false);
    // A tick set here later is not undone by the same (older) Discord change coming again.
    st = setTick(st, 'energy', true, T + 5000);
    assert.equal(adoptKinds(st, { energy: { on: false, at: T / 1000 } }).hand.energy.on, true);
    // A newer Discord change wins over it.
    assert.equal(adoptKinds(st, { energy: { on: false, at: T / 1000 + 60 } }).hand.energy.on, false);
    // Unknown kinds and odd shapes are ignored; a change with no time (made before the service kept one) is taken once.
    assert.deepEqual(adoptKinds(null, { bogus: { on: true, at: 1 }, drug: 'off', watch: { on: false } }).hand, { watch: { on: false, at: 0 } });
    assert.deepEqual(pingStore({ hand: { drug: { on: 'yes' }, bogus: { on: true, at: 1 } } }).hand, {});
});

/* ------------------------------------------------------------------ the state in words */

test('Settings says what state the service is in, and never Working when the bot is known not to reach you', () => {
    const base = { base: BASE, secret: SECRET, discordName: 'Friend', lastSync: T, answerAt: T, ready: true, linked: true, bot: true, paused: false, syncFail: null, lastError: null };
    const ok = { ok: true, via: 'dm', reason: null, dmRefusedAt: null, webhook: false };
    assert.equal(discordView(null), null);
    assert.equal(discordView({ base: BASE, secret: SECRET, login: { id: 'x', at: T } }), null, 'a login under way is not a connected service');
    let v = discordView({ ...base, delivery: ok, tornRead: { ok: true, at: T / 1000, travel: true } }, T);
    assert.deepEqual([v.key, v.tone, v.tag, v.title, v.steps.length, v.notes.length], ['ok', 'ok', 'Working', null, 0, 0]);
    // Discord refuses the bot's DM and there is no webhook (the friend's case, said by a service of this build).
    v = discordView({ ...base, delivery: { ok: false, via: null, reason: 'dm_refused', dmRefusedAt: T / 1000 - 3600, webhook: false } }, T);
    assert.deepEqual([v.key, v.tone, v.tag, v.title], ['dm_refused', 'bad', 'Not reaching you', 'Discord refuses the bot’s DMs']);
    assert.equal(v.text, 'No ping can reach you until Direct Messages from the server are on. Last refused 11:00 UTC.');
    assert.deepEqual(v.steps, ['In Discord, open the server the bot is in.', 'Click the server name, then Privacy Settings.', 'Turn Direct Messages on.', 'Then press Send a test ping here.']);
    // The service in use today says nothing; only the failed test ping is known (a bare 502).
    v = discordView({ ...base, delivery: undefined, testFail: { at: T, reason: 'unknown', http: 502 } }, T);
    assert.deepEqual([v.key, v.tag, v.title], ['test_failed', 'Not reaching you', 'The test ping did not arrive']);
    assert.deepEqual(v.steps.slice(0, 3), DM_STEPS);
    assert.equal(v.steps[3], 'Then press Disconnect here and Log in with Discord again (after a refused DM the bot waits 6 hours; a new login ends the wait).');
    assert.equal(v.steps[4], 'Then press Send a test ping.');
    // Refused DMs with a channel webhook: pings arrive, so Working, and the note says where.
    v = discordView({ ...base, delivery: { ok: true, via: 'channel', reason: null, dmRefusedAt: T / 1000, webhook: true } }, T);
    assert.equal(v.tag, 'Working');
    assert.match(v.notes[0], /pings go to your channel/);
    assert.equal(v.steps.length, 4);
    // Nothing to deliver through.
    v = discordView({ ...base, delivery: { ok: false, via: null, reason: 'no_route', dmRefusedAt: null, webhook: false } }, T);
    assert.deepEqual([v.key, v.tag], ['no_route', 'Not reaching you']);
    assert.match(v.text, /Press Disconnect, then Log in with Discord again/);
    // The service's own Torn read is failing.
    v = discordView({ ...base, delivery: ok, tornRead: { ok: false, at: T / 1000 - 600, travel: true, since: T / 1000 - 300, code: 17, error: 'Torn’s API is down (Torn error 17).' } }, T);
    assert.deepEqual([v.key, v.tag, v.title], ['torn', 'Not reading Torn', 'The service can’t read your Torn timers']);
    assert.equal(v.text, 'Torn’s API is down (Torn error 17). Since 11:55 UTC. Nothing to do here: pings start again by themselves when Torn answers.');
    assert.match(discordView({ ...base, delivery: ok, tornRead: { ok: false, since: 1, code: 16, error: 'x.' } }, T).text, /Save a Limited Torn key above/);
    assert.match(discordView({ ...base, delivery: ok, tornRead: { ok: true, travel: false } }, T).notes[0], /can’t read travel/);
    // Torn refused the key: paused (as before). A failed sync is not a pause any more.
    v = discordView({ ...base, paused: true, pauseText: 'Your Worker paused pings: Incorrect key. Paste a new key for it.', lastError: 'x' }, T);
    assert.deepEqual([v.key, v.tag, v.title], ['paused', 'Paused', 'Pings are paused']);
    v = discordView({ ...base, delivery: ok, syncFail: { at: T, text: 'Could not reach your Worker.' }, lastError: 'Could not reach your Worker.' }, T);
    assert.deepEqual([v.key, v.tag, v.title], ['sync', 'Last sync failed', 'The last sync did not get through']);
    assert.equal(v.text, 'Could not reach your Worker. It tries again within a minute; pings still come from the plan sent before.');
    // Not synced yet.
    v = discordView({ ...base, ready: false, answerAt: 0 }, T);
    assert.deepEqual([v.key, v.tag, v.text], ['waiting', 'Not pinging yet', 'Waiting for the first sync (open Home once).']);
    // A record written by 1.5.3 (no `paused` field): the old words still read right.
    assert.equal(discordView({ base: BASE, secret: SECRET, discordName: 'F', ready: true, lastError: 'Your Worker paused pings: Incorrect key. Paste a new key for it.' }, T).key, 'paused');
    assert.equal(discordView({ base: BASE, secret: SECRET, discordName: 'F', ready: true, lastError: 'Could not reach your Worker.' }, T).key, 'sync');
    // Your own service: its own words.
    v = discordView({ ...base, discordName: null, connectedAt: T, delivery: undefined, testFail: { at: T, reason: 'unknown' } }, T);
    assert.match(v.steps[4], /Forget and Connect again ends the wait/);
    assert.equal(discordWhen(T - 86400e3, T), '4 Oct 12:00 UTC');
});

test('a failed test ping in words: the service’s reason, or a bare 502 from an older one', () => {
    assert.deepEqual(testFailOf({ http: 409, reason: 'dm_refused', message: 'Discord refused the bot’s DM. In Discord…' }), { reason: 'dm_refused', text: 'Discord refused the bot’s DM. What to do is above.' });
    assert.deepEqual(testFailOf({ http: 502, reason: 'discord_error', message: 'Discord answered an error (500). Try again in a minute.' }), { reason: 'discord_error', text: 'Discord answered an error (500). Try again in a minute.' });
    assert.deepEqual(testFailOf({ http: 502, reason: null, message: 'Your Worker answered 502.' }), { reason: 'unknown', text: 'The test ping did not arrive. What to try is above.' });
    assert.equal(testFailOf({ http: 403, message: 'Unknown secret' }).reason, 'forgotten');
    assert.equal(testFailOf(new Error('Could not reach your Worker.')).reason, 'error');
    assert.equal(testSentWords({ ok: true, via: 'dm' }), 'Sent. Check your Discord DMs.');
    assert.equal(testSentWords({ ok: true }), 'Sent. Check your Discord DMs.', 'an older service says no via');
    assert.equal(testSentWords({ ok: true, via: 'hook', dmRefused: true }), 'Sent to your channel. Discord refused the bot’s DM.');
    assert.equal(testSentWords({ ok: true, via: 'hook' }), 'Sent. Check your channel.');
});

/* ------------------------------------------------------------------ against the service in use today (older) */

test('the service in use today: ticks are synced, a bare 502 on the test ping says what to do and goes to the problem log', async () => {
    clean();
    gmSet('worker', { base: BASE, secret: SECRET, discordName: 'Friend', keyTag: '', lastSync: 0, ready: true });
    const f = oldService({ test: 502 });
    await withFetch(f, async () => {
        setPing('booster', false, T - 1000);
        assert.equal(maybeSyncPlan(model(), T), true);
        await tick();
        const body = f.calls[0].body;
        assert.deepEqual(body.rules, { ...KIND_DEFAULTS, booster: false }, 'every kind, as ticked');
        assert.deepEqual(body.rulesAt, { booster: Math.floor((T - 1000) / 1000) });
        let w = gmGet('worker');
        assert.equal(w.kinds, null, 'it does not say which kinds it knows: an older service');
        assert.equal(w.delivery, null);
        assert.equal(discordView(w).tag, 'Working', 'nothing known against it yet');
        // The friend presses Send a test ping.
        await assert.rejects(testDiscord(), /^Error: The test ping did not arrive\. What to try is above\.$/);
        w = gmGet('worker');
        assert.equal(w.testFail.reason, 'unknown');
        const v = discordView(w);
        assert.equal(v.tag, 'Not reaching you');
        assert.match(v.steps.join(' '), /Privacy Settings.*Turn Direct Messages on.*Disconnect here and Log in with Discord again/);
        assert.ok(logLines().some((l) => /^Discord test ping failed: unknown \| Your Worker answered 502\. \[http 502\]$/.test(l)), JSON.stringify(logLines()));
        // The next sync keeps that (the older service still says nothing about delivery).
        gmSet('worker', { ...gmGet('worker'), lastSync: 0 });
        maybeSyncPlan(model(), T + SYNC_MIN_MS + 1);
        await tick();
        assert.equal(discordView(gmGet('worker')).tag, 'Not reaching you');
    });
    // He fixed Discord and logged in again; the test ping arrives.
    await withFetch(oldService(), async () => {
        const r = await testDiscord();
        assert.equal(r.text, 'Sent. Check your Discord DMs.');
        assert.equal(gmGet('worker').testFail, null);
        assert.equal(discordView(gmGet('worker')).tag, 'Working');
    });
    clean();
});

test('a tick changed in Settings goes within seconds, not behind the one-a-minute gate', async () => {
    clean();
    gmSet('worker', { base: BASE, secret: SECRET, discordName: 'Friend', keyTag: '', lastSync: 0, ready: true });
    const f = oldService();
    await withFetch(f, async () => {
        maybeSyncPlan(model(), T);
        await tick();
        assert.equal(maybeSyncPlan(model(), T + TICK_SYNC_MIN_MS + 1), false, 'nothing changed');
        setPing('nerve', false, T + 1000);
        assert.equal(maybeSyncPlan(model(), T + 1500), false, 'not on every click of a row of ticks');
        assert.equal(maybeSyncPlan(model(), T + TICK_SYNC_MIN_MS + 1), true);
        await tick();
        assert.equal(f.calls[1].body.rules.nerve, false);
        // A failed sync leaves the ticks unsent: the next try sends them.
    });
    await withFetch(async () => { throw new Error('offline'); }, async () => {
        setPing('nerve', true, T + 20000);
        assert.equal(maybeSyncPlan(model(), T + 30000), true);
        await tick();
    });
    const g = oldService();
    await withFetch(g, async () => {
        assert.equal(maybeSyncPlan(model(), T + 30000 + SYNC_MIN_MS), true);
        await tick();
        assert.equal(g.calls[0].body.rules.nerve, true);
    });
    clean();
});

test('a tick changed right after a sync is sent a few seconds on by itself, not at the next read of Torn', async () => {
    clean();
    gmSet('worker', { base: BASE, secret: SECRET, discordName: 'Friend', keyTag: '', lastSync: 0, ready: true });
    const f = oldService();
    await withFetch(f, async () => {
        const m = model({ steps: [{ at: Date.now() + 3600e3, kind: 'xanax', label: 'Xanax #1', trains: {} }] });
        assert.equal(syncTicksSoon(() => m), true, 'nothing sent yet: it goes now');
        await tick();
        // The sync went 4.8 s ago.
        gmSet('worker', { ...gmGet('worker'), lastSync: Date.now() - (TICK_SYNC_MIN_MS - 200) });
        setPing('booster', false);
        assert.equal(syncTicksSoon(() => m, 300), false, 'a sync has just gone');
        assert.equal(f.calls.length, 1);
        await new Promise((r) => setTimeout(r, 400));
        assert.equal(f.calls.length, 2, 'sent by itself');
        assert.equal(f.calls[1].body.rules.booster, false);
        assert.ok(f.calls[1].body.rulesAt.booster > 0);
    });
    clean();
});

test('modes move the ticks by themselves: stacking, and a war of your faction', async () => {
    clean();
    const now = Date.now();
    const stacking = model({ stacking: { since: now - 60000 } });
    assert.deepEqual(CHAIN_OFF.map((k) => pingsNow(stacking, now)[k].mode), ['chain', 'chain', 'chain']);
    assert.equal(pingsNow(model(), now).energy.on, true, 'Resume: back');
    // A hand change while stacking is kept after Resume.
    setPing('energy', true, now);
    assert.equal(pingsNow(stacking, now).energy.on, true);
    setPing('refill', false, now);
    assert.deepEqual([pingsNow(model(), now).energy.on, pingsNow(model(), now).refill.on, pingsNow(model(), now).jump.on], [true, false, true]);
    // A war that has begun (Torn Eye's read of your faction's wars): the war ticks go on, and say why.
    assert.equal(pingsNow(model(), now).chain.on, false);
    gmSet('userStatic', { factionWars: { at: now, enemies: [{ id: 5, kind: 'ranked', warId: 77, start: Math.floor(now / 1000) - 600, end: 0 }] } });
    const war = pingsNow(model(), now + 1000);
    assert.deepEqual([war.chain.on, war.chain.mode, war.war.on, war.war.mode], [true, 'war', true, null], 'war was on already: it did not move');
    assert.equal(gmGet('pingTicks').war.key, 'ranked:77');
    // A war listed but not begun yet moves nothing.
    gmSet('userStatic', { factionWars: { at: now, enemies: [{ id: 6, kind: 'ranked', warId: 78, start: Math.floor(now / 1000) + 7200, end: 0 }] } });
    assert.equal(pingsNow(model(), now + 2000).chain.on, false);
    // Over: back to what it was.
    gmSet('userStatic', { factionWars: { at: now, enemies: [] } });
    assert.equal(pingsNow(model(), now + 3000).chain.on, false);
    assert.equal(gmGet('pingTicks').war, null);
    clean();
});

test('Discord failures seen in the browser go to the problem log: a failed sync once per error, a login that ends badly, a forgotten browser', async () => {
    clean();
    gmSet('worker', { base: BASE, secret: SECRET, discordName: 'Friend', keyTag: '', lastSync: 0, ready: true });
    const failing = (status, error) => async () => ({ ok: false, status, json: async () => ({ ok: false, error }) });
    await withFetch(failing(500, 'D1 is down'), async () => {
        for (let i = 0; i < 3; i++) {
            maybeSyncPlan(model(), T + i * (SYNC_MIN_MS + 1));
            await tick();
        }
    });
    assert.deepEqual(problemLogNow().filter((e) => /^Discord sync failed/.test(e.what)).map((e) => [e.what, e.detail, e.times || 1]), [['Discord sync failed: D1 is down', 'http 500', 1]], 'once, not every minute');
    assert.equal(discordView(gmGet('worker')).key, 'sync');
    // Another error is another line.
    await withFetch(async () => { throw new Error('offline'); }, async () => {
        maybeSyncPlan(model(), T + 10 * SYNC_MIN_MS);
        await tick();
    });
    assert.equal(logLines().filter((l) => /^Discord sync failed/.test(l)).length, 2);
    // It works again: said once.
    await withFetch(oldService(), async () => {
        maybeSyncPlan(model(), T + 20 * SYNC_MIN_MS);
        await tick();
    });
    assert.ok(logLines().some((l) => /^Discord pings work again/.test(l)));
    assert.equal(gmGet('worker').syncFail, null);
    // The service forgot this browser.
    await withFetch(failing(403, 'Unknown secret'), async () => {
        maybeSyncPlan(model(), T + 30 * SYNC_MIN_MS);
        await tick();
    });
    assert.ok(logLines().some((l) => /^Discord: the service no longer knows this browser/.test(l)));
    // A login that ends in an error state.
    clean();
    for (const state of ['not_member', 'denied', 'full', 'elsewhere', 'expired']) {
        const f = async (url) => {
            const path = new URL(url).pathname;
            const body = path === '/login/start' ? { ok: true, id: 'a'.repeat(48), url: BASE + '/login?id=' + 'a'.repeat(48) } : { ok: true, state };
            return { ok: true, status: 200, json: async () => body };
        };
        await withFetch(f, async () => {
            const r = await loginDiscord(null, { base: BASE, open: () => {}, sleep: async () => {} });
            assert.equal(r.ok, false);
        });
        assert.ok(logLines().some((l) => l.startsWith('Discord login ended: ' + state + ' | ')), state + ': ' + JSON.stringify(logLines()));
    }
    const text = JSON.stringify(problemLogNow());
    assert.ok(!text.includes('a'.repeat(48)) && !text.includes(discordRaw().secret), 'never the login id or the secret');
    clean();
});

/* ------------------------------------------------------------------ against this build's service (the real handler) */

test('this build’s service: a refused DM is said with what to do, a test ping that arrives ends it, and /settings in Discord meets the ticks', async () => {
    clean();
    const env = await botEnv();
    let dmPost = () => jsonRes({ message: 'Cannot send messages to this user', code: 50007 }, 403);
    const outside = () => world({ torn: tornState({ drug: 232 }), dmPost: (...a) => dmPost(...a) });
    const service = (url, init) => handle(new Request(url, init), env, outside());
    const user = () => [...env.DB.users.values()][0];
    await withFetch(service, async () => {
        await connectDiscord({ base: BASE, invite: 'x', tornKey: 'WorkerKey1234567' }, model());
        // As after "Log in with Discord": the row is linked to a Discord account.
        Object.assign(user(), { discord_id: DISCORD_USER, linked: 1 });
        gmSet('worker', { ...gmGet('worker'), discordName: 'Friend' });
        let now = Date.now() + SYNC_MIN_MS + 1;
        // The service's answer is waited for (the real Worker code runs: a fixed wait was too short on a busy machine).
        const answer = async (was) => {
            for (let i = 0; i < 300 && gmGet('worker').answerAt === was; i++) await new Promise((r) => setTimeout(r, 10));
            await tick();
        };
        const syncNow = async (m = model()) => {
            now += SYNC_MIN_MS + 1;
            await tick();
            const was = gmGet('worker').answerAt;
            gmSet('worker', { ...gmGet('worker'), lastSync: 0 });
            assert.equal(maybeSyncPlan(m, now), true);
            await answer(was);
        };
        await syncNow();
        let w = gmGet('worker');
        assert.deepEqual(w.delivery, { ok: true, via: 'dm', reason: null, dmRefusedAt: null, webhook: false });
        assert.deepEqual(w.kinds, KIND_DEFAULTS);
        assert.equal(discordView(w).tag, 'Working');
        // The bot's minute: Discord refuses the DM (his DMs are off).
        const nowS = Math.floor(Date.now() / 1000);
        await runCron(env, nowS, outside());
        assert.equal(user().dm_fail, nowS);
        await syncNow();
        w = gmGet('worker');
        assert.equal(w.delivery.reason, 'dm_refused');
        assert.equal(discordView(w).tag, 'Not reaching you');
        assert.ok(logLines().some((l) => /^Discord pings: Discord refuses the bot’s DMs \| No ping can reach you/.test(l)), JSON.stringify(logLines()));
        // The test ping says the same in words (and tries the DM although the bot is resting).
        await assert.rejects(testDiscord(), /^Error: Discord refused the bot’s DM\. What to do is above\.$/);
        assert.equal(gmGet('worker').testFail.reason, 'dm_refused');
        assert.ok(logLines().some((l) => /^Discord test ping failed: dm_refused/.test(l)));
        // He turns Direct Messages on; the test ping arrives and Settings says Working at once.
        dmPost = () => jsonRes({ id: 'msg-1', channel_id: 'dm-chan-1' });
        const r = await testDiscord();
        assert.equal(r.text, 'Sent. Check your Discord DMs.');
        assert.equal(discordView(gmGet('worker')).tag, 'Working');
        assert.equal(user().dm_fail, 0);
        await syncNow();
        assert.equal(gmGet('worker').delivery.dmRefusedAt, null);
        assert.ok(logLines().some((l) => /^Discord pings work again/.test(l)));

        // Energy switched off with /settings in Discord: the tick here follows at the next sync…
        await handleInteraction(command('settings', { kind: 'energy', on: false }), env, outside(), ctx(), Math.floor(now / 1000));
        await syncNow();
        assert.deepEqual([pingsNow(model(), now).energy.on, pingsNow(model(), now).energy.hand], [false, true]);
        // …and the sync after that tells the service it was seen: the ticks are the one truth again.
        await syncNow();
        assert.deepEqual(JSON.parse(user().settings).kinds, {});
        assert.equal(JSON.parse(user().rules).energy, false);
        // Ticked on again on the webpage: on, although /settings said off before.
        setPing('energy', true, now + 1000);
        await syncNow();
        assert.equal(gmGet('worker').kinds.energy, true);
        assert.equal(JSON.parse(user().rules).energy, true);

        // "I'm stacking": the plan carries the flag; energy ticked back on by hand during it is kept.
        const since = now;
        now += 1000;
        setPing('energy', true, now);
        const stacking = model({ stacking: { since } });
        await syncNow(stacking);
        assert.deepEqual(JSON.parse(user().plan).chain, { since: Math.floor(since / 1000), keep: ['energy'] });

        // A channel webhook saved and DMs refused again: the test ping goes to the channel and says so.
        user().webhook = HOOK;
        dmPost = () => jsonRes({ message: 'Cannot send messages to this user', code: 50007 }, 403);
        const r2 = await testDiscord();
        assert.equal(r2.text, 'Sent to your channel. Discord refused the bot’s DM.');
        const v = discordView(gmGet('worker'));
        assert.equal(v.tag, 'Working');
        assert.match(v.notes[0], /pings go to your channel/);
    });
    clean();
});
