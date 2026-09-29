/*
 * The buttons under a ping. None of them acts in Torn, and none marks the
 * plan: the plan's done log still comes from Torn's own state.
 *
 *   Done          hides the ping and stops its repeats (snooze, nudges)
 *   Snooze 10 min brings it back in 10 minutes unless Torn shows it done
 *   Skip step     stored; the userscript picks it up on its next sync and re-times
 *
 * The answer (type 7) rebuilds the message from its rows in `sent`.
 */

import { Q } from './db.js';
import { reply, update } from './discord.js';
import { alertMessage, bodyOf } from './deliver.js';
import { linkedUser, NOT_LINKED } from './cmd-core.js';

export const SNOOZE_S = 10 * 60;

async function press(verb, i, alertId, env, fetchImpl, ctx, nowS) {
    const user = await linkedUser(i, env);
    if (!user) return reply(NOT_LINKED);
    const r = await env.DB.prepare(Q.sentOne).bind(user.id, alertId).first();
    if (!r) return reply('This ping is gone (pings are kept for 2 days).');
    const body = bodyOf(r);
    let state = r.state || 'sent';
    let until = null;
    let ack = null;
    if (verb === 'done') {
        state = 'done';
        ack = 'done';
    } else if (verb === 'snooze') {
        if (state !== 'sent') return reply('This ping is already ' + (state === 'snoozed' ? 'snoozed' : 'closed') + '.');
        state = 'snoozed';
        until = nowS + SNOOZE_S;
    } else if (verb === 'skip') {
        if (!body.step) return reply('This ping has no step to skip.');
        state = 'skipped';
        ack = 'skip';
    }
    await env.DB.prepare(Q.sentState).bind(state, until, user.id, alertId).run();
    if (ack) await env.DB.prepare(Q.ackPut).bind(ack + ':' + alertId, user.id, ack, alertId, body.step ? JSON.stringify(body.step) : null, nowS).run();
    let rows = r.message ? (await env.DB.prepare(Q.sentByMessage).bind(user.id, r.message).all()).results || [] : [];
    rows = rows.length ? rows.map((x) => (x.alert === alertId ? { ...x, state, until } : x)) : [{ ...r, state, until }];
    rows.sort((a, b) => (a.alert < b.alert ? -1 : 1));
    return update(alertMessage(rows));
}

export const BUTTON_HANDLERS = {
    done: (i, id, env, f, ctx, nowS) => press('done', i, id, env, f, ctx, nowS),
    snooze: (i, id, env, f, ctx, nowS) => press('snooze', i, id, env, f, ctx, nowS),
    skip: (i, id, env, f, ctx, nowS) => press('skip', i, id, env, f, ctx, nowS),
};

/** For PUT /plan: the acks waiting for the userscript (it clears them with ackIds on its next sync). */
export async function pendingAcks(db, userId) {
    const { results } = await db.prepare(Q.ackList).bind(userId).all();
    return (results || [])
        .map((a) => {
            let step = null;
            try {
                step = a.step ? JSON.parse(a.step) : null;
            } catch {
                step = null;
            }
            return { id: a.id, kind: a.kind, alert: a.alert, step, at: Number(a.at) };
        })
        .sort((a, b) => a.at - b.at);
}
