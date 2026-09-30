import test from 'node:test';
import assert from 'node:assert/strict';

import { runCron, handle } from '../src/index.js';
import { dueAlerts, nextPrev, resolvedBy } from '../src/alerts.js';
import { handleInteraction } from '../src/interactions.js';
import { linkedEnv, world, tornState, T0, body, command, ctx, jsonRes, req, KEY, PLAN, DISCORD_USER, botEnv } from './helpers.js';

const posts = (f) => f.calls.filter((c) => c.url.includes('discord.com') && (c.init.method || 'POST') === 'POST' && c.url.endsWith('/messages'));

/* ---------- /timers ---------- */

test('/timers: "thinking…" at once, then the answer from one Torn read with the user’s own key', async () => {
    const { env } = await linkedEnv();
    const f = world({ torn: tornState({ drug: 232, booster: 7200, energy: 20, travel: 0 }) });
    const c = ctx();
    const r = await body(handleInteraction(command('timers'), env, f, c, T0));
    assert.deepEqual(r, { type: 5, data: { flags: 64 } });
    await c.done();
    const torn = f.calls.filter((x) => x.url.startsWith('https://api.torn.com/'));
    assert.equal(torn.length, 1);
    assert.equal(torn[0].init.headers.Authorization, 'ApiKey ' + KEY);
    const patch = f.calls.find((x) => x.url === 'https://discord.com/api/v10/webhooks/111/tok-timers/messages/@original');
    assert.equal(patch.init.method, 'PATCH');
    const text = patch.body.content;
    assert.match(text, /Drug: 4 min \(ends 10:51/);
    assert.match(text, /Booster: 2 h \(ends 12:48/);
    assert.match(text, /Medical: \*\*ready\*\*/);
    assert.match(text, /Energy: 20\/150 · full in 1 h 18 min \(12:06\)/);
    assert.match(text, /Refill: \*\*unused\*\*/);
    assert.match(text, /Travel: in Torn/);
    assert.deepEqual(patch.body.allowed_mentions, { parse: [] });
});

test('/timers: at most one Torn command every 5 seconds; a dead key pauses and says so', async () => {
    const { env, user } = await linkedEnv();
    const f = world({ torn: jsonRes({ error: { code: 13, error: 'The key is owned by a user in federal jail' } }) });
    const c = ctx();
    await handleInteraction(command('timers'), env, f, c, T0);
    const again = await body(handleInteraction(command('timers'), env, f, ctx(), T0 + 2));
    assert.match(again.data.content, /wait a few seconds/);
    await c.done();
    assert.equal(user().paused, 1);
    const patch = f.calls.find((x) => x.url.endsWith('/messages/@original'));
    assert.match(patch.body.content, /Pings are paused/);
    const later = await body(handleInteraction(command('timers'), env, f, ctx(), T0 + 60));
    assert.match(later.data.content, /^Paused: Torn error 13/);
    assert.equal(f.calls.filter((x) => x.url.startsWith('https://api.torn.com/')).length, 1, 'no second call with a dead key');
});

test('/timers in DRY_RUN: the follow-up goes to the outbox, Torn is still read', async () => {
    const { env } = await linkedEnv({ DRY_RUN: '1' });
    const f = world();
    const c = ctx();
    await handleInteraction(command('timers'), env, f, c, T0);
    await c.done();
    assert.equal(f.calls.filter((x) => x.url.includes('discord.com')).length, 0);
    assert.equal(env.DB.outbox.at(-1).route, 'followup');
    assert.match(JSON.parse(env.DB.outbox.at(-1).body).content, /\*\*Timers\*\*/);
});

/* ---------- New automatic pings ---------- */

test('booster cooldown: pinged 30–90 s ahead when the plan has a booster step; over, when a run missed that', () => {
    const plan = { type: 'jump', steps: [{ at: T0 + 600, kind: 'boost', label: 'EDVD × 5', train: null }] };
    // Ahead: 60 s left, the last read (150 s) was outside the window.
    let prev = nextPrev(null, tornState({ drug: 3600, booster: 150 }), T0 - 60);
    const soon = dueAlerts(tornState({ drug: 3600, booster: 60 }), plan, T0, {}, { prev });
    assert.deepEqual(soon.map((x) => [x.kind, x.title, x.text, x.readyAt]), [['booster', 'Booster cooldown ends in 60 s', 'EDVD × 5', T0 + 60]]);
    // The next read inside the window, or the one that sees it over: not again.
    prev = nextPrev(prev, tornState({ drug: 3600, booster: 60 }), T0);
    assert.deepEqual(dueAlerts(tornState({ drug: 3600, booster: 5 }), plan, T0 + 55, {}, { prev }).filter((x) => x.kind === 'booster'), []);
    assert.deepEqual(dueAlerts(tornState({ drug: 3600, booster: 0 }), plan, T0 + 60, {}, { prev }).filter((x) => x.kind === 'booster'), []);
    // A missed run (the last read saw 120 s left, now it's over): pinged then.
    prev = nextPrev(null, tornState({ drug: 3600, booster: 120 }), T0 - 120);
    const a = dueAlerts(tornState({ drug: 3600, booster: 0 }), plan, T0, {}, { prev });
    assert.deepEqual(a.map((x) => [x.kind, x.title, x.text]), [['booster', 'Booster cooldown is over', 'EDVD × 5']]);
    assert.deepEqual(dueAlerts(tornState({ drug: 3600, booster: 0 }), PLAN, T0, {}, { prev }), [], 'a plan in use with no booster step: no ping');
});

test('booster and drug-unused pings with no plan in use (out of date, or none synced): every time, plain words', () => {
    const prev = nextPrev(null, tornState({ drug: 3600, booster: 150 }), T0 - 60);
    const stale = dueAlerts(tornState({ drug: 3600, booster: 60 }), PLAN, T0, {}, { prev, planStale: true, planAge: 49 * 3600, planAt: T0 - 49 * 3600, });
    const b = stale.find((x) => x.kind === 'booster');
    assert.equal(b.title, 'Booster cooldown ends in 60 s');
    assert.equal(b.text, 'Room for a candy, energy drink, FHC or EDVD');
    assert.equal(b.step, null);
    assert.ok(dueAlerts(tornState({ drug: 3600, booster: 60 }), null, T0, {}, { prev }).some((x) => x.kind === 'booster'), 'never synced: pinged too');
    let p = nextPrev(null, tornState({ drug: 0 }), T0 - 16 * 60);
    p = nextPrev(p, tornState({ drug: 0 }), T0 - 60);
    const d = dueAlerts(tornState({ drug: 0 }), PLAN, T0, {}, { prev: p, planStale: true, planAge: 49 * 3600, planAt: T0 - 49 * 3600 }).find((x) => x.kind === 'drugready');
    assert.equal(d.title, 'Drug ready for 16 min, unused');
    assert.match(d.text, /next Xanax/);
    assert.deepEqual(dueAlerts(tornState({ drug: 0 }), { type: 'steady', steps: [{ at: T0 + 3 * 3600, kind: 'xanax', label: 'Xanax #3' }] }, T0, {}, { prev: p }).filter((x) => x.kind === 'drugready'), [], 'a plan in use that waits: no nudge');
});

test('an early booster ping is not closed while the cooldown still runs; a new cooldown after it closes it', () => {
    assert.equal(resolvedBy('booster', tornState({ booster: 30 }), T0, { readyAt: T0 + 30 }), false);
    assert.equal(resolvedBy('booster', tornState({ booster: 86000 }), T0 + 400, { readyAt: T0 + 30 }), true);
    assert.equal(resolvedBy('booster', tornState({ booster: 0 }), T0 + 400, { readyAt: T0 + 30 }), false);
});

test('drug ready 15 minutes and unused: one nudge per ready spell', () => {
    const plan = { type: 'steady', steps: [{ at: T0 - 600, kind: 'xanax', label: 'Xanax #2', train: 'DEX × 27' }] };
    let prev = nextPrev(null, tornState({ drug: 0 }), T0 - 16 * 60);
    assert.equal(prev.drugZeroAt, T0 - 16 * 60);
    prev = nextPrev(prev, tornState({ drug: 0 }), T0 - 60);
    assert.equal(prev.drugZeroAt, T0 - 16 * 60, 'kept while it stays 0');
    const a = dueAlerts(tornState({ drug: 0 }), plan, T0, {}, { prev });
    assert.deepEqual(a.map((x) => [x.id, x.title]), [['drugready:' + (T0 - 960), 'Drug ready for 16 min, unused']]);
    assert.equal(nextPrev(prev, tornState({ drug: 25000 }), T0).drugZeroAt, null);
});

test('back from travel with a step waiting', () => {
    const prev = nextPrev(null, tornState({ drug: 3600, travel: 30 }), T0 - 60);
    const a = dueAlerts(tornState({ drug: 3600, travel: 0 }), { type: 'steady', steps: [{ at: T0 + 300, kind: 'refill', label: 'Refill · 30 points', train: 'DEX × 15' }] }, T0, {}, { prev });
    assert.deepEqual(a.map((x) => [x.title, x.text, x.link]), [['Back in Torn', 'Next: Refill · 30 points, then DEX × 15', 'https://www.torn.com/points.php']]);
});

test('jump sequence steps without a tick: pinged when their time comes', () => {
    const plan = { type: 'jump', steps: [{ at: T0 + 90, kind: 'boost', label: 'Ecstasy', train: null, strict: false }] };
    const a = dueAlerts(tornState({ drug: 3600 }), plan, T0);
    assert.deepEqual(a.map((x) => [x.kind, x.title]), [['step', 'Boost step in 2 min']]);
    assert.deepEqual(dueAlerts(tornState({ drug: 3600 }), plan, T0 - 600), []);
});

test('a plan out of date: state pings only, plus one "out of date" a day', () => {
    const a = dueAlerts(tornState({ drug: 232 }), PLAN, T0, {}, { planStale: true, planAge: 14 * 3600 });
    assert.deepEqual(a.map((x) => [x.kind, x.text]), [['drug', 'Ready for the next drug'], ['stale', 'Last synced 14 h ago. Open Pumping Iron so it sends your plan; until then only timer pings come.']]);
});

test('cron keeps what it read for next time (users.prev)', async () => {
    const { env, user } = await linkedEnv();
    await runCron(env, T0, world({ torn: tornState({ drug: 0, booster: 30, travel: 0 }) }));
    // Energy 20/150 fills in 4,680 s: on the tick nearest T0 + 4,680 (the energy ping's id).
    assert.deepEqual(JSON.parse(user().prev), { at: T0, drug: 0, booster: 30, travel: 0, drugZeroAt: T0, drugNudged: null, fill: Math.round((T0 + 4680) / 300) * 300, watchAt: T0, staleFor: null });
    assert.equal(user().ran, T0);
});

test('Done on a drug ping also stops the "unused" nudge', async () => {
    const plan = { type: 'steady', steps: [{ at: T0 + 232, kind: 'xanax', label: 'Xanax #2', train: 'DEX × 27' }] };
    const { env, id, user } = await linkedEnv({}, { plan });
    await runCron(env, T0, world({ torn: tornState({ drug: 232 }) }));
    const drugRow = [...env.DB.sent.values()][0];
    const { press } = await import('./helpers.js');
    await handleInteraction(press('done:' + drugRow.alert, drugRow.message), env, world(), ctx(), T0 + 30);
    user().prev = JSON.stringify({ at: T0 + 1200, drug: 0, booster: 0, travel: 0, drugZeroAt: T0 + 240 });
    user().plan_at = T0 + 1200;
    const f = world({ torn: tornState({ drug: 0 }) });
    await runCron(env, T0 + 1260, f);
    assert.equal(posts(f).length, 0);
    assert.ok(![...env.DB.sent.keys()].some((k) => k.startsWith(id + '|drugready:')));
});

/* ---------- Quiet hours, caps, mutes ---------- */

test('quiet hours hold pings; strict jump steps still go through', async () => {
    const tick = T0 + 240;
    const plan = { type: 'jump', steps: [{ at: T0 + 232, kind: 'xanax', label: 'Xanax #2', train: null }, { at: tick + 60, kind: 'jump', label: 'EDVD × 5 + Ecstasy', strict: true, tick }] };
    const { env, user } = await linkedEnv({}, { plan });
    user().settings = JSON.stringify({ quiet: { from: 10, to: 12 } });
    const f = world({ torn: tornState({ drug: 232 }) });
    await runCron(env, T0, f);
    const sent = posts(f);
    assert.equal(sent.length, 1);
    assert.deepEqual(sent[0].body.embeds.map((e) => e.title), ['Jump in 4 min']);
});

test('caps: at most N messages an hour (a grouped message counts once)', async () => {
    const { env, user } = await linkedEnv();
    user().settings = JSON.stringify({ perHour: 1 });
    await runCron(env, T0, world({ torn: tornState({ drug: 232, energy: 150 }) }));
    const f = world({ torn: tornState({ drug: 3600, energy: 20, refill: false }) });
    await runCron(env, Date.UTC(2026, 8, 29, 11, 30) / 1000, f);
    assert.equal(posts(f).length, 0, 'the hour’s one message is used');
});

test('/snooze mutes a kind (or all) for a while; minutes:0 unmutes', async () => {
    const { env, user } = await linkedEnv();
    let r = await body(handleInteraction(command('snooze', { minutes: 30, kind: 'drug' }), env, world(), ctx(), T0));
    assert.match(r.data.content, /Muted Drug cooldown ending until 11:18 TCT/);
    let f = world();
    await runCron(env, T0, f);
    assert.equal(posts(f).length, 0);
    r = await body(handleInteraction(command('snooze', { minutes: 0, kind: 'drug' }), env, world(), ctx(), T0 + 60));
    assert.match(r.data.content, /Unmuted/);
    f = world({ torn: tornState({ drug: 172 }) });
    await runCron(env, T0 + 60, f);
    assert.equal(posts(f).length, 1);
    assert.deepEqual(JSON.parse(user().settings).mute, {});
});

test('/settings shows and changes quiet hours, kinds and caps', async () => {
    const { env, user } = await linkedEnv();
    let r = await body(handleInteraction(command('settings'), env, world(), ctx(), T0));
    assert.match(r.data.content, /Quiet hours: off/);
    assert.match(r.data.content, /Off: Chain timeout/);
    r = await body(handleInteraction(command('settings', { quiet: '23-7', kind: 'chain', on: true, per_hour: 5 }), env, world(), ctx(), T0));
    assert.match(r.data.content, /^Saved: quiet hours, Chain timeout on, per hour\./);
    assert.match(r.data.content, /Quiet hours: 23–7 TCT/);
    assert.match(r.data.content, /At most: 5 an hour/);
    assert.deepEqual(JSON.parse(user().settings).quiet, { from: 23, to: 7 });
    r = await body(handleInteraction(command('settings', { quiet: 'soon' }), env, world(), ctx(), T0));
    assert.match(r.data.content, /look like `23-7`/);
    r = await body(handleInteraction(command('settings', { delivery: 'channel' }), env, world(), ctx(), T0));
    assert.match(r.data.content, /No channel webhook saved/);
});

/* ---------- Free-plan limits ---------- */

test('many users: one run stays under 50 subrequests and 50 D1 queries; the rest go next minute', async () => {
    const env = await botEnv();
    for (let n = 0; n < 20; n++) {
        const secret = String(n).padStart(2, '0') + 'x'.repeat(38);
        await handle(req('PUT', '/plan', { secret, invite: 'x', body: { tornKey: KEY, plan: PLAN } }), env);
    }
    for (const u of env.DB.users.values()) Object.assign(u, { discord_id: DISCORD_USER, linked: 1, plan_at: T0 });
    const f = world();
    const before = env.DB.log.length;
    const out = await runCron(env, T0, f);
    assert.ok(f.calls.length <= 45, f.calls.length + ' subrequests');
    assert.ok(env.DB.log.length - before <= 46, env.DB.log.length - before + ' queries');
    assert.ok(out.some((o) => o.later), 'some users wait');
    assert.ok(out.filter((o) => o.sent).length >= 3);
    // The first run after an update also migrates the schema: still under 50 queries in all.
    const { fakeD1 } = await import('./fake-d1.js');
    const { Q } = await import('../src/db.js');
    const fresh = { ...env, DB: fakeD1() };
    for (const u of env.DB.users.values()) await fresh.DB.prepare(Q.userInsert).bind(u.id, u.torn_key, u.discord_id, '', u.plan, u.rules, 0, null, T0, T0, null, null, null, null, null).run();
    for (const u of fresh.DB.users.values()) Object.assign(u, { linked: 1 });
    const n0 = fresh.DB.log.length;
    await runCron(fresh, T0, world());
    assert.ok(fresh.DB.log.some((s) => s.startsWith('ALTER TABLE')), 'migrated');
    assert.ok(fresh.DB.log.length - n0 <= 48, fresh.DB.log.length - n0 + ' queries with the migration');
    // Next minute: the ones that waited go first.
    const waited = out.filter((o) => o.later).length;
    const g = world({ torn: tornState({ drug: 172 }) });
    const out2 = await runCron(env, T0 + 60, g);
    assert.ok(out2.slice(0, Math.min(waited, 3)).every((o) => o.sent === 1));
});
