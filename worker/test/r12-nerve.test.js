/*
 * Session 13: a new ping, "nerve is full" (the owner: "we can also add in bot, ping when nerve is full"). Like the
 * energy ping it goes 30 to 90 s ahead of the tick; unlike it, once per fill and never again while the bar stays
 * full. A state ping: it goes with a stale plan, and stacking for a chain or an overdose does not silence it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { dueAlerts, nextPrev, resolvedBy, LINKS, NERVE_LEAD_S, CHAIN_SKIPPED } from '../src/alerts.js';
import { KIND_DEFAULTS } from '../src/settings.js';
import { KINDS, COMMAND_DEFS } from '../src/commands.js';
import { KIND_WORD } from '../src/deliver.js';
import { runCron } from '../src/index.js';
import { linkedEnv, world, tornState, T0, PLAN } from './helpers.js';

/** Torn's read at `at` with a nerve bar: `nerve` of `max`, +1 on every 5-minute tick. */
const withNerve = (nerve, at = T0, max = 60, o = {}) => {
    const s = tornState({ drug: 3600, ...o });
    s.bars.nerve = { current: nerve, maximum: max, full_time: nerve >= max ? 0 : (max - nerve - 1) * 300 + (300 - (at % 300)) };
    return s;
};
const kinds = (a) => a.map((x) => x.kind).sort();
/** The messages that tell about nerve (a day on, "Plan out of date" goes out too). */
const posts = (f) => f.calls.filter((c) => (c.init.method || 'GET') === 'POST' && /\/channels\/[^/]+\/messages$/.test(c.url) && /nerve/i.test(JSON.stringify(c.body)));
/** T0 is 10:48:00 TCT: the next tick is 10:50:00. */
const TICK = T0 + 120;
const NOW = T0 + 60;

test('nerve: its kind, its words and its link', () => {
    assert.equal(KIND_DEFAULTS.nerve, true, 'on unless switched off');
    assert.equal(KINDS.nerve, 'Nerve full');
    assert.equal(KIND_WORD.nerve, 'Nerve');
    assert.equal(LINKS.crimes, 'https://www.torn.com/page.php?sid=crimes');
    assert.ok(!CHAIN_SKIPPED.includes('nerve'), 'not an energy or training kind');
    const kind = COMMAND_DEFS.find((c) => c.name === 'settings').options.find((o) => o.name === 'kind');
    assert.ok(kind.choices.some((c) => c.value === 'nerve' && c.name === 'Nerve full'), '/settings kind: lists it');
    assert.ok(NERVE_LEAD_S >= 60 && NERVE_LEAD_S < 120, 'runs come a minute apart: one of them, and only one, is inside the lead');
});

test('nerve: pinged ahead of the tick that fills it, and "is full" when the fill was not seen coming', () => {
    const prev = nextPrev(null, withNerve(59, T0), T0);
    // 59 of 60 at 10:48:00, 120 s to the tick: more than a run ahead, nothing yet.
    assert.deepEqual(dueAlerts(withNerve(59, T0), PLAN, T0, {}, { prev: nextPrev(null, withNerve(59, T0 - 60), T0 - 60) }), []);
    // A minute on, 60 s to the tick: the early ping.
    const early = dueAlerts(withNerve(59, NOW), PLAN, NOW, {}, { prev });
    assert.deepEqual(kinds(early), ['nerve']);
    assert.equal(early[0].id, 'nerve:' + TICK / 300);
    assert.equal(early[0].title, 'Nerve full in 60 s (10:50:00 TCT)');
    assert.equal(early[0].text, 'Do a crime so none is wasted');
    assert.equal(early[0].link, LINKS.crimes);
    assert.equal(early[0].fullAt, TICK);
    // Two ticks away: nothing.
    assert.deepEqual(dueAlerts(withNerve(58, NOW), PLAN, NOW, {}, { prev }), []);
    // Full at once (a nerve refill, a level up): "Nerve is full".
    const full = dueAlerts(withNerve(60, NOW), PLAN, NOW, {}, { prev: nextPrev(null, withNerve(40, T0), T0) });
    assert.equal(full[0].title, 'Nerve is full');
    // Switched off: nothing.
    assert.deepEqual(dueAlerts(withNerve(59, NOW), PLAN, NOW, { nerve: false }, { prev }), []);
    // A read without a nerve bar says nothing.
    assert.deepEqual(dueAlerts(tornState({ drug: 3600 }), PLAN, NOW, {}, { prev }), []);
});

test('nerve: stacking for a chain, an overdose and a plan out of date do not silence it', () => {
    const prev = nextPrev(null, withNerve(59, T0), T0);
    const chain = { type: 'jump', noRefill: true, steps: [], chain: { since: T0 - 3600 } };
    assert.deepEqual(kinds(dueAlerts(withNerve(60, NOW, 60, { energy: 1000 }), chain, NOW, {}, { prev })), ['nerve'], 'the stacked bar is silent, nerve is not');
    const od = { type: 'jump', noRefill: true, steps: [], overdose: { at: T0 - 600, until: T0 + 80000 } };
    assert.deepEqual(kinds(dueAlerts(withNerve(60, NOW), od, NOW, {}, { prev })), ['nerve', 'overdose']);
    assert.ok(kinds(dueAlerts(withNerve(60, NOW), PLAN, NOW, {}, { prev: { ...prev, staleFor: 1 }, planStale: true, planAge: 13 * 3600, planAt: 1 })).includes('nerve'));
    assert.deepEqual(kinds(dueAlerts(withNerve(60, NOW), null, NOW, {}, { prev })), ['nerve'], 'no plan at all');
});

test('nerve: closed as seen in Torn once some is spent, not while it is still filling', () => {
    assert.equal(resolvedBy('nerve', withNerve(59, NOW), NOW, { fullAt: TICK }), false, 'the early ping stays');
    assert.equal(resolvedBy('nerve', withNerve(60, TICK + 60), TICK + 60, { fullAt: TICK }), false);
    assert.equal(resolvedBy('nerve', withNerve(45, TICK + 60), TICK + 60, { fullAt: TICK }), true);
    assert.equal(resolvedBy('nerve', tornState(), TICK + 60, { fullAt: TICK }), false, 'a read without the bar closes nothing');
});

test('the Worker: one nerve ping per fill, none while the bar stays full (even after its sent row is cleaned up), a new one for the next fill', async () => {
    const { env, id, user } = await linkedEnv();
    const sent = () => [...env.DB.sent.keys()].filter((k) => k.startsWith(id + '|nerve:'));
    await runCron(env, T0, world({ torn: withNerve(59, T0) }));
    assert.deepEqual(sent(), [], '120 s ahead: not yet');
    const f = world({ torn: withNerve(59, NOW) });
    await runCron(env, NOW, f);
    assert.equal(posts(f).length, 1);
    assert.equal(posts(f)[0].body.content, 'Nerve full in 60 s (10:50:00 TCT)');
    assert.deepEqual(sent(), [id + '|nerve:' + TICK / 300]);
    assert.equal(JSON.parse(user().prev).nervePinged, TICK);
    // Full a minute on, and still full an hour, a day and a week on: nothing more.
    for (const at of [TICK, TICK + 3600, TICK + 86400, TICK + 7 * 86400]) {
        // The cleanup deletes sent rows after 2 days; the bar can stay full far longer.
        if (at > T0 + 2 * 86400) env.DB.sent.clear();
        const g = world({ torn: withNerve(60, at) });
        await runCron(env, at, g);
        assert.equal(posts(g).length, 0, 'no second ping at +' + (at - T0) + ' s');
        assert.equal(JSON.parse(user().prev).nervePinged, TICK);
    }
    // A crime spends some, then it fills again: the next fill is a new ping.
    const later = TICK + 7 * 86400 + 600;
    await runCron(env, later, world({ torn: withNerve(40, later) }));
    assert.equal(JSON.parse(user().prev).nervePinged, null);
    const h = world({ torn: withNerve(60, later + 60) });
    await runCron(env, later + 60, h);
    assert.equal(posts(h).length, 1);
    assert.equal(posts(h)[0].body.content, 'Nerve is full');
});

test('the Worker: a bar already full at its first read is not pinged (nobody saw it fill), the next fill is', async () => {
    const { env, user } = await linkedEnv();
    // A user from before this build: a memory of the last read without the nerve bar.
    user().prev = JSON.stringify({ at: T0 - 60, drug: 3660, booster: 0, travel: 0, drugZeroAt: null, drugNudged: null, fill: null });
    for (const at of [T0, T0 + 60, T0 + 120]) {
        const f = world({ torn: withNerve(60, at) });
        await runCron(env, at, f);
        assert.equal(posts(f).length, 0);
    }
    await runCron(env, T0 + 180, world({ torn: withNerve(55, T0 + 180) }));
    const g = world({ torn: withNerve(60, T0 + 240) });
    await runCron(env, T0 + 240, g);
    assert.equal(posts(g)[0].body.content, 'Nerve is full');
});

test('the Worker: a nerve ping held back by quiet hours comes when they end, once', async () => {
    const { env, user } = await linkedEnv();
    const hour = new Date(T0 * 1000).getUTCHours();
    user().settings = JSON.stringify({ quiet: { from: hour, to: (hour + 1) % 24 } });
    await runCron(env, T0, world({ torn: withNerve(58, T0) }));
    const f = world({ torn: withNerve(60, NOW) });
    await runCron(env, NOW, f);
    assert.equal(posts(f).length, 0, 'quiet');
    const g = world({ torn: withNerve(60, T0 + 3600) });
    await runCron(env, T0 + 3600, g);
    assert.equal(posts(g).length, 1, 'still full after the quiet hour: told once');
    const h = world({ torn: withNerve(60, T0 + 3660) });
    await runCron(env, T0 + 3660, h);
    assert.equal(posts(h).length, 0);
});
