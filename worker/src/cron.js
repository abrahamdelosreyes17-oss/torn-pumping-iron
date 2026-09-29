/*
 * The minute: for each user, one Torn read, what's due, one message for
 * what's new. Users are taken oldest-run first while the run has
 * subrequests and D1 queries left (free plan: 50 each per invocation), so
 * with many users each is read every minute or two instead of failing.
 */

import { dueAlerts, resolvedBy, nextPrev } from './alerts.js';
import { Q, parse, meterDb, ensureSchema } from './db.js';
import { guard, BudgetError } from './net.js';
import { userState, pauseUser, TornError } from './torn.js';
import { deliver, canDeliver, bodyOf, editAlertMessage, PER_MESSAGE } from './deliver.js';
import { clock, DAY_S } from './format.js';
import { keyFor, KeyError } from './keys.js';
import { watchAlerts, WATCH_EVERY_S } from './market.js';
import { kindsOn, settingsOf, muted, inQuiet, planStale, planAge } from './settings.js';

export const SENT_KEEP_S = 2 * 86400;
/** What one user can cost at most in a minute (Torn reads, Discord calls; D1 queries). */
export const USER_SUBREQUESTS = 12;
export const USER_QUERIES = 14;
/** Message edits (auto-close) per user per minute. */
export const MAX_EDITS = 2;

const chunks = (list, n) => {
    const out = [];
    for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
    return out;
};

/** Send the new alerts, grouped; record each in `sent` with its message. */
export async function sendAlerts(env, f, db, user, alerts, nowS) {
    let sent = 0;
    let messages = 0;
    const ids = [];
    const sorted = [...alerts].sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const group of chunks(sorted, PER_MESSAGE)) {
        const rows = group.map((a) => ({ user: user.id, alert: a.id, at: nowS, state: 'sent', until: null, body: { title: a.title, text: a.text, kind: a.kind, link: a.link || null, step: a.step && a.skip !== false ? { at: a.step.at, kind: a.step.kind, label: a.step.label } : null } }));
        const d = await deliver(env, f, db, user, rows, nowS);
        if (!d.ok) break;
        for (const r of rows) await db.prepare(Q.sentPut).bind(user.id, r.alert, nowS, 'sent', null, d.channel, d.message, JSON.stringify(r.body), d.via).run();
        sent += rows.length;
        messages++;
        ids.push(...rows.map((r) => r.alert));
    }
    return { sent, messages, ids };
}

/** Messages (not pings: a grouped message counts once) sent since a time. */
function messagesSince(rows, since) {
    return new Set(rows.filter((r) => Number(r.at) >= since).map((r) => r.message || r.alert)).size;
}

/**
 * Close pings Torn shows done (a new drug started, energy trained...):
 * the message is edited to say so and loses its buttons. At most a few
 * edits a minute.
 */
async function autoResolve(env, f, db, user, rows, state, nowS) {
    const closing = rows.filter((r) => (r.state || 'sent') === 'sent' && r.message && Number(r.at) >= nowS - 12 * 3600 && resolvedBy(bodyOf(r).kind, state, nowS, bodyOf(r)));
    const messages = new Set();
    for (const r of closing) {
        r.state = 'resolved';
        await db.prepare(Q.sentState).bind('resolved', null, user.id, r.alert).run();
        messages.add(r.message);
    }
    let edits = 0;
    for (const m of messages) {
        if (edits >= MAX_EDITS) break;
        const group = rows.filter((r) => r.message === m).sort((a, b) => (a.alert < b.alert ? -1 : 1));
        await editAlertMessage(env, f, db, user, group);
        edits++;
    }
    return closing.length;
}

/** One user's minute. */
export async function runUser(env, row, nowS, fetchImpl = fetch, db = env.DB) {
    const f = guard(fetchImpl);
    if (!row.torn_key || Number(row.paused) || !canDeliver(env, row)) return { sent: 0, skipped: true };
    let key;
    try {
        key = await keyFor(env, db, row);
    } catch (e) {
        if (e instanceof KeyError) await db.prepare(Q.userPause).bind(e.message, row.id).run();
        return { sent: 0, error: String(e.message) };
    }
    let state;
    try {
        state = await userState(f, key);
    } catch (e) {
        if (e instanceof TornError) {
            if (e.dead) await pauseUser(db, row.id, e);
            return { sent: 0, error: 'Torn error ' + e.code };
        }
        throw e;
    }
    const st = settingsOf(row);
    const prev = parse(row.prev, null);
    const on = kindsOn(row);
    const alerts = dueAlerts(state, parse(row.plan, null), nowS, on, { prev, planStale: planStale(row, nowS), planAge: planAge(row, nowS) });
    // Price watches, every 5 minutes.
    if (on.watch && Math.floor(nowS / 60) % (WATCH_EVERY_S / 60) === 0) {
        try {
            alerts.push(...(await watchAlerts(f, db, key, row, nowS)).alerts);
        } catch (e) {
            if (e instanceof TornError && e.dead) {
                await pauseUser(db, row.id, e);
                return { sent: 0, error: 'Torn error ' + e.code };
            }
            if (e instanceof BudgetError) throw e;
        }
    }
    const { results } = await db.prepare(Q.sentList).bind(row.id).all();
    const rows = results || [];
    const seen = new Map(rows.map((r) => [r.alert, r]));

    const resolved = await autoResolve(env, f, db, row, rows, state, nowS);

    let fresh = alerts.filter((a) => !seen.has(a.id));
    // Snoozed pings come back after 10 minutes, unless Torn shows them done.
    for (const r of rows) {
        if (r.state !== 'snoozed' || Number(r.until) > nowS) continue;
        const b = bodyOf(r);
        const now = alerts.find((a) => a.id === r.alert);
        if (now) fresh.push(now);
        else if (!resolvedBy(b.kind, state, nowS, b)) fresh.push({ id: r.alert, kind: b.kind, link: b.link, step: b.step, title: 'Reminder (snoozed at ' + clock(Number(r.until) - 600) + ')', text: b.title + (b.text ? ' · ' + b.text : '') });
        else await db.prepare(Q.sentState).bind('resolved', null, row.id, r.alert).run();
    }
    // Done on a drug ping also stops the "drug ready, unused" nudge.
    const drugDone = rows.some((r) => String(r.alert).startsWith('drug:') && r.state === 'done' && Number(r.at) >= nowS - 3600);
    fresh = fresh.filter((a) => !(a.kind === 'drugready' && drugDone));
    // Muted kinds wait (not recorded: they come if still due when the mute ends).
    fresh = fresh.filter((a) => !muted(st, a.kind, nowS));
    // Quiet hours and caps: strict jump steps still go through.
    const room = Math.min(st.perHour - messagesSince(rows, nowS - 3600), st.perDay - messagesSince(rows, nowS - DAY_S));
    if (inQuiet(st, nowS) || room <= 0) fresh = fresh.filter((a) => a.kind === 'jump');
    else if (fresh.length > room * PER_MESSAGE) fresh = fresh.slice(0, room * PER_MESSAGE);

    const { sent, ids } = await sendAlerts(env, f, db, row, fresh, nowS);
    for (const a of fresh) if (a.kind === 'watch' && ids.includes(a.id)) await db.prepare(Q.watchMark).bind(1, row.id, a.item).run();
    await db.prepare(Q.userRan).bind(nowS, JSON.stringify(nextPrev(prev, state, nowS)), row.war || null, row.id).run();
    return { sent, resolved };
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
