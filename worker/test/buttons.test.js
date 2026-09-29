import test from 'node:test';
import assert from 'node:assert/strict';

import { runCron, handle } from '../src/index.js';
import { handleInteraction } from '../src/interactions.js';
import { linkedEnv, world, tornState, T0, body, press, ctx, req, signed } from './helpers.js';

const DRUG_ID = 'drug:' + Math.round((T0 + 232) / 300);

async function pinged(extra = {}, planBody = {}) {
    const le = await linkedEnv(extra, planBody);
    await runCron(le.env, T0, world());
    const row = le.env.DB.sent.get(le.id + '|' + DRUG_ID);
    assert.ok(row, 'the drug ping went out');
    return { ...le, msg: row.message };
}

test('Done: the message says Done, only the Torn link stays; an ack waits for the userscript', async () => {
    const { env, id, msg } = await pinged();
    const f = world();
    const r = await body(handle(await signed(press('done:' + DRUG_ID, msg)), env, f, ctx()));
    assert.equal(r.type, 7, 'update the message the button was on');
    assert.equal(r.data.embeds[0].footer.text, 'Done');
    assert.deepEqual(r.data.components[0].components.map((b) => b.label), ['Open in Torn']);
    assert.equal(f.calls.length, 0, 'nothing is called: not Torn, not Discord');
    assert.equal(env.DB.sent.get(id + '|' + DRUG_ID).state, 'done');
    // The userscript's next sync gets the ack, then clears it.
    let p = await body(handle(req('PUT', '/plan', { body: { plan: null } }), env));
    assert.equal(p.acks.length, 1);
    assert.deepEqual({ ...p.acks[0], at: 0 }, { id: 'done:' + DRUG_ID, kind: 'done', alert: DRUG_ID, step: { at: T0 + 232, kind: 'xanax', label: 'Xanax #2' }, at: 0 });
    p = await body(handle(req('PUT', '/plan', { body: { plan: null, ackIds: ['done:' + DRUG_ID] } }), env));
    assert.deepEqual(p.acks, []);
});

test('Snooze 10 min: back after 10 minutes if Torn doesn’t show it done', async () => {
    const { env, id, msg } = await pinged();
    const r = await body(handleInteraction(press('snooze:' + DRUG_ID, msg), env, world(), ctx(), T0 + 60));
    assert.equal(r.data.embeds[0].footer.text, 'Snoozed until 10:59 TCT');
    assert.deepEqual(r.data.components[0].components.map((b) => b.label), ['Done', 'Open in Torn']);
    assert.equal(env.DB.sent.get(id + '|' + DRUG_ID).until, T0 + 660);
    // 5 minutes on: still quiet.
    let f = world({ torn: tornState({ drug: 0 }) });
    await runCron(env, T0 + 300, f);
    assert.equal(f.calls.filter((c) => c.url.includes('discord.com')).length, 0);
    // 10 minutes on, drug still unused: a reminder.
    f = world({ torn: tornState({ drug: 0 }) });
    await runCron(env, T0 + 660, f);
    const post = f.calls.find((c) => c.url.endsWith('/messages'));
    assert.equal(post.body.embeds[0].title, 'Reminder (snoozed at 10:49)');
    assert.equal(post.body.embeds[0].description, 'Drug cooldown ends in 4 min · Xanax #2, then DEX × 27');
    assert.equal(env.DB.sent.get(id + '|' + DRUG_ID).state, 'sent');
});

test('Snooze, then Torn shows the drug taken: no reminder', async () => {
    const { env, id, msg } = await pinged();
    await handleInteraction(press('snooze:' + DRUG_ID, msg), env, world(), ctx(), T0 + 60);
    const f = world({ torn: tornState({ drug: 25000 }) });
    await runCron(env, T0 + 700, f);
    assert.equal(f.calls.filter((c) => c.url.includes('/messages')).length, 0);
    assert.equal(env.DB.sent.get(id + '|' + DRUG_ID).state, 'resolved');
});

test('Skip step: stored for the userscript with the step; the plan is not touched here', async () => {
    const { env, id, msg, user } = await pinged();
    const planBefore = user().plan;
    const r = await body(handleInteraction(press('skip:' + DRUG_ID, msg), env, world(), ctx(), T0 + 30));
    assert.equal(r.data.embeds[0].footer.text, 'Step skipped: your plan re-times on its next sync');
    assert.equal(user().plan, planBefore);
    const p = await body(handle(req('PUT', '/plan', { body: {} }), env));
    assert.equal(p.acks[0].kind, 'skip');
    assert.deepEqual(p.acks[0].step, { at: T0 + 232, kind: 'xanax', label: 'Xanax #2' });
    assert.equal(env.DB.sent.get(id + '|' + DRUG_ID).state, 'skipped');
});

test('someone else’s press: not linked → how to link; linked but not theirs → gone', async () => {
    const { env, msg } = await pinged();
    let r = await body(handleInteraction(press('done:' + DRUG_ID, msg, { user: '42' }), env, world(), ctx(), T0));
    assert.match(r.data.content, /not linked/);
    assert.equal(r.data.flags, 64);
    r = await body(handleInteraction(press('done:nope:1', msg), env, world(), ctx(), T0));
    assert.match(r.data.content, /gone/);
});

test('in a grouped message, Done on one ping keeps the other’s buttons', async () => {
    const { env, id } = await linkedEnv({}, { plan: { type: 'steady', steps: [{ at: T0 + 232, kind: 'xanax', label: 'Xanax #2', train: 'DEX × 27' }] } });
    await runCron(env, T0, world({ torn: tornState({ drug: 232, energy: 150 }) }));
    const msg = env.DB.sent.get(id + '|' + DRUG_ID).message;
    const r = await body(handleInteraction(press('done:' + DRUG_ID, msg), env, world(), ctx(), T0));
    assert.equal(r.data.embeds.length, 2);
    assert.equal(r.data.embeds[0].footer.text, 'Done');
    assert.equal(r.data.embeds[1].footer, undefined);
    assert.deepEqual(r.data.components[1].components.map((b) => b.label), ['Done · Energy', 'Snooze 10 min · Energy', 'Skip step · Energy', 'Open in Torn · Energy']);
});
