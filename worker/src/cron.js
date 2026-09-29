/*
 * The minute: for each user, one Torn read, what's due, one message for
 * what's new. Users are taken oldest-run first while the run has
 * subrequests and D1 queries left (free plan: 50 each per invocation), so
 * with many users each is read every minute or two instead of failing.
 */

import { dueAlerts, resolvedBy } from './alerts.js';
import { Q, parse, meterDb, ensureSchema } from './db.js';
import { guard, BudgetError } from './net.js';
import { userState, pauseUser, TornError } from './torn.js';
import { deliver, canDeliver, bodyOf, PER_MESSAGE } from './deliver.js';
import { clock } from './format.js';
import { kindsOn } from './settings.js';

export const SENT_KEEP_S = 2 * 86400;
/** What one user can cost at most in a minute (Torn reads, Discord calls; D1 queries). */
export const USER_SUBREQUESTS = 10;
export const USER_QUERIES = 12;

const chunks = (list, n) => {
    const out = [];
    for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
    return out;
};

/** Send the new alerts, grouped; record each in `sent` with its message. */
export async function sendAlerts(env, f, db, user, alerts, nowS) {
    let sent = 0;
    const sorted = [...alerts].sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const group of chunks(sorted, PER_MESSAGE)) {
        const rows = group.map((a) => ({ user: user.id, alert: a.id, at: nowS, state: 'sent', until: null, body: { title: a.title, text: a.text, kind: a.kind, link: a.link || null, step: a.step ? { at: a.step.at, kind: a.step.kind, label: a.step.label } : null } }));
        const d = await deliver(env, f, db, user, rows, nowS);
        if (!d.ok) break;
        for (const r of rows) await db.prepare(Q.sentPut).bind(user.id, r.alert, nowS, 'sent', null, d.channel, d.message, JSON.stringify(r.body), d.via).run();
        sent += rows.length;
    }
    return sent;
}

/** One user's minute. */
export async function runUser(env, row, nowS, fetchImpl = fetch, db = env.DB) {
    const f = guard(fetchImpl);
    if (!row.torn_key || Number(row.paused) || !canDeliver(env, row)) return { sent: 0, skipped: true };
    let state;
    try {
        state = await userState(f, row.torn_key);
    } catch (e) {
        if (e instanceof TornError) {
            if (e.dead) await pauseUser(db, row.id, e);
            return { sent: 0, error: 'Torn error ' + e.code };
        }
        throw e;
    }
    const plan = parse(row.plan, null);
    const alerts = dueAlerts(state, plan, nowS, kindsOn(row));
    const { results } = await db.prepare(Q.sentList).bind(row.id).all();
    const seen = new Map((results || []).map((r) => [r.alert, r]));
    const fresh = alerts.filter((a) => !seen.has(a.id));
    // Snoozed pings come back after 10 minutes, unless Torn shows them done.
    for (const r of seen.values()) {
        if (r.state !== 'snoozed' || Number(r.until) > nowS) continue;
        const b = bodyOf(r);
        const now = alerts.find((a) => a.id === r.alert);
        if (now) fresh.push(now);
        else if (!resolvedBy(b.kind, state, nowS, b)) fresh.push({ id: r.alert, kind: b.kind, link: b.link, step: b.step, title: 'Reminder (snoozed at ' + clock(Number(r.until) - 600) + ')', text: b.title + (b.text ? ' · ' + b.text : '') });
        else await db.prepare(Q.sentState).bind('resolved', null, row.id, r.alert).run();
    }
    const sent = await sendAlerts(env, f, db, row, fresh, nowS);
    await db.prepare(Q.userRan).bind(nowS, row.prev || null, row.war || null, row.id).run();
    return { sent };
}

export async function runCron(env, nowS = Math.floor(Date.now() / 1000), fetchImpl = fetch) {
    await ensureSchema(env.DB);
    const f = guard(fetchImpl);
    const db = meterDb(env.DB);
    const { results } = await db.prepare(Q.usersDue).bind(20).all();
    const out = [];
    for (const row of results || []) {
        if (f.left() < USER_SUBREQUESTS || db.left() < USER_QUERIES) {
            out.push({ sent: 0, later: true });
            continue;
        }
        try {
            out.push(await runUser(env, row, nowS, f, db));
        } catch (e) {
            if (e instanceof BudgetError) {
                out.push({ sent: 0, later: true });
                break;
            }
            out.push({ sent: 0, error: String((e && e.message) || e) });
        }
    }
    if (Math.floor(nowS / 60) % 10 === 0 || out.length === 0) {
        await db.prepare(Q.sentClean).bind(nowS - SENT_KEEP_S).run();
        await db.prepare(Q.ackClean).bind(nowS - SENT_KEEP_S).run();
        await db.prepare(Q.linkClean).bind(nowS).run();
    }
    return out;
}
