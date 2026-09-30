/*
 * The 1.2.3 review's findings on the bot's pings, each pinned: one "drug unused" nudge per ready spell even after
 * its sent row is cleaned up; no "over"/"landed" ping from an old read; a plan with nothing ahead is not "in use";
 * the energy ping is keyed to the fill (one ping per fill across an hour boundary, a second fill in the same hour
 * pinged, a full bar re-pinged hourly).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runCron } from '../src/index.js';
import { dueAlerts, nextPrev } from '../src/alerts.js';
import { linkedEnv, world, tornState, T0, PLAN } from './helpers.js';

const posts = (f) => f.calls.filter((c) => c.url.includes('discord.com') && (c.init.method || 'POST') === 'POST' && c.url.endsWith('/messages'));
const kinds = (a) => a.map((x) => x.kind).sort();

test('no plan in use: one "drug unused" nudge per ready spell, not again when its sent row is cleaned up 2 days on', async () => {
    const { env, user } = await linkedEnv();
    user().plan_at = T0 - 49 * 3600; // out of date: no plan in use
    await runCron(env, T0, world({ torn: tornState({ drug: 0, energy: 20 }) }));
    const f = world({ torn: tornState({ drug: 0, energy: 20 }) });
    await runCron(env, T0 + 16 * 60, f);
    assert.ok(posts(f).some((c) => /Drug ready for 16 min, unused/.test(c.body.content)), 'nudged once');
    assert.equal(JSON.parse(user().prev).drugNudged, T0);
    // Two days on, the drug still unused, the sent rows cleaned: nothing.
    for (const k of [...env.DB.sent.keys()]) env.DB.sent.delete(k);
    const g = world({ torn: tornState({ drug: 0, energy: 20 }) });
    await runCron(env, T0 + 2 * 86400 + 120, g);
    assert.ok(!posts(g).some((c) => /unused/.test(c.body.content)), 'not again for the same spell');
    // A new spell (a drug taken, over again): a new nudge.
    await runCron(env, T0 + 2 * 86400 + 180, world({ torn: tornState({ drug: 25000, energy: 20 }) }));
    await runCron(env, T0 + 2 * 86400 + 240, world({ torn: tornState({ drug: 0, energy: 20 }) }));
    const h = world({ torn: tornState({ drug: 0, energy: 20 }) });
    await runCron(env, T0 + 2 * 86400 + 240 + 16 * 60, h);
    assert.ok(posts(h).some((c) => /unused/.test(c.body.content)), 'the next spell gets its nudge');
});

test('"booster over" and "back in Torn" only from a recent read, not one frozen days ago (a paused key)', () => {
    const plan = { type: 'jump', steps: [{ at: T0 + 600, kind: 'boost', label: 'EDVD × 5' }] };
    const old = nextPrev(null, tornState({ drug: 3600, booster: 3600, travel: 600 }), T0 - 3 * 86400);
    assert.deepEqual(dueAlerts(tornState({ drug: 3600, booster: 0, travel: 0 }), plan, T0, {}, { prev: old }).filter((x) => x.kind === 'booster' || x.kind === 'landed'), []);
    assert.deepEqual(dueAlerts(tornState({ drug: 3600, booster: 0, travel: 0 }), null, T0, {}, { prev: old }).filter((x) => x.kind === 'booster'), [], 'no plan in use either');
    const recent = nextPrev(null, tornState({ drug: 3600, booster: 120, travel: 30 }), T0 - 120);
    assert.deepEqual(kinds(dueAlerts(tornState({ drug: 3600, booster: 0, travel: 0 }), plan, T0, {}, { prev: recent })), ['booster', 'landed']);
});

test('a synced plan with nothing ahead (empty, or every step past) is not "in use": the plain booster and drug pings come', () => {
    const prev = nextPrev(null, tornState({ drug: 3600, booster: 150 }), T0 - 60);
    for (const plan of [{ type: 'steady', steps: [] }, { type: 'steady', steps: [{ at: T0 - 3600, kind: 'natural', label: 'Natural energy' }] }]) {
        const b = dueAlerts(tornState({ drug: 3600, booster: 60 }), plan, T0, {}, { prev }).find((x) => x.kind === 'booster');
        assert.ok(b, JSON.stringify(plan.steps));
        assert.equal(b.text, 'Room for a candy, energy drink, FHC or EDVD');
    }
    // A plan with steps ahead and no booster step: quiet, as before.
    assert.deepEqual(dueAlerts(tornState({ drug: 3600, booster: 60 }), PLAN, T0, {}, { prev }).filter((x) => x.kind === 'booster'), []);
});

test('energy: one ping per fill, across an hour boundary; a second fill in the same hour is pinged; full for an hour, pinged again', () => {
    // T0 is 10:48. Fill at 10:55: early at 10:53:52 (68 s), full at 11:00:52 — the same ping.
    const e = (current, fullIn) => ({ ...tornState({ drug: 3600, energy: current }), bars: { energy: { current, maximum: 150, full_time: fullIn } } });
    const t1 = T0 + 5 * 60 + 52;
    let prev = nextPrev(null, e(145, 400), t1 - 60);
    const early = dueAlerts(e(148, 68), null, t1, {}, { prev }).find((x) => x.kind === 'energy');
    assert.equal(early.title, 'Energy full in 68 s (10:55:00 TCT)');
    prev = nextPrev(prev, e(148, 68), t1);
    for (let t = t1 + 60; t <= t1 + 7 * 60; t += 60) {
        const now = dueAlerts(e(150, 0), null, t, {}, { prev }).find((x) => x.kind === 'energy');
        assert.equal(now.id, early.id, 'the same ping at ' + new Date(t * 1000).toISOString().slice(11, 19));
        prev = nextPrev(prev, e(150, 0), t);
    }
    // Still full an hour after the fill: a new ping (the hourly reminder).
    const hour = dueAlerts(e(150, 0), null, T0 + 7 * 60 + 3600 + 30, {}, { prev });
    assert.notEqual(hour.find((x) => x.kind === 'energy').id, early.id);
    // Trained at 11:02, full again at 11:30 (same clock hour as the 11:00 read): a new ping.
    prev = nextPrev(prev, e(20, 4680), T0 + 14 * 60);
    prev = nextPrev(prev, e(146, 144), T0 + 40 * 60);
    const second = dueAlerts(e(148, 72), null, T0 + 41 * 60, {}, { prev }).find((x) => x.kind === 'energy');
    assert.ok(second && second.id !== early.id, 'the second fill has its own ping');
});
