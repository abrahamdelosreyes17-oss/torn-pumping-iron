/*
 * The minute: for each user, one Torn read, what's due, one message for
 * what's new. Users are taken oldest-run first while the run has
 * subrequests and D1 queries left (free plan: 50 each per invocation), so
 * with many users each is read every minute or two instead of failing.
 * Both budgets are enforced: a call past them throws BudgetError, and a
 * message is only sent when there's room left to record it.
 */

import { dueAlerts, resolvedBy, nextPrev } from './alerts.js';
import { Q, parse, meterDb, ensureSchema, forgetUser, FORGET, QUERY_BUDGET } from './db.js';
import { LOGIN_TTL_S } from './login.js';
import { guard, BudgetError } from './net.js';
import { userState, pauseUser, TornError } from './torn.js';
import { deliver, canDeliver, bodyOf, editAlertMessage, PER_MESSAGE, NO_SNOOZE } from './deliver.js';
import { warTick, chainTick, eyeTick, EYE_PER_RUN, EYE_CYCLE } from './war.js';
import { targetsOf, warListOf, watchListOf } from './cmd-torn.js';
import { clock, DAY_S } from './format.js';
import { keyFor, sealKey, isSealed, KeyError } from './keys.js';
import { watchAlerts, WATCH_EVERY_S, MAX_WATCHES } from './market.js';
import { kindsOn, settingsOf, muted, inQuiet, planStale, planAge } from './settings.js';

export const SENT_KEEP_S = 2 * 86400;
/** War and watch-list pings are about the next minutes: their rows go after 6 hours. */
export const LIVE_KEEP_S = 6 * 3600;
/** What one user can cost at most in a minute (Torn reads, Discord calls; D1 queries). */
export const USER_SUBREQUESTS = 12;
export const USER_QUERIES = 14;
/** Extra when the user's price watches are due (3 watches: reads, cache writes, marks). */
export const WATCH_SUBREQUESTS = 2 * MAX_WATCHES;
export const WATCH_QUERIES = 8;
/**
 * Extra in a war: the reads and one message are in the base; each war
 * message checks the budget left before it goes (a ping that can't go now
 * waits a minute), so only a little is kept for the save.
 */
export const WAR_SUBREQUESTS = 0;
export const WAR_QUERIES = 2;
/** Extra with a watch list: its pings' rows (the reads, at most 5, are added per user). */
export const EYE_QUERIES = 5;
/** A user nobody has synced for this long is forgotten (key, plan, pings: as Forget does). */
export const STALE_USER_S = 30 * 86400;
/** Stale users forgotten per cleanup at most (each costs FORGET.length queries). */
export const STALE_PER_RUN = 2;
/** Sealing up to 5 plain 1.0 keys: one read and five writes. */
const SEAL_QUERIES = 6;
/**
 * The 10-minute cleanup: 5 cleans, the stale-user read and the key
 * sealing. Stale users are forgotten with what is left over; once an hour
 * room for one is kept too, so they always go in the end.
 */
export const CLEANUP_QUERIES = 5 + 1 + SEAL_QUERIES;
export const HOURLY_QUERIES = CLEANUP_QUERIES + FORGET.length;
/** Message edits (auto-close) per user per minute. */
export const MAX_EDITS = 2;
/** Cron runs drift by a few seconds: a watch checked 4.5 minutes ago counts as 5. */
const WATCH_SLACK_S = 30;

const chunks = (list, n) => {
    const out = [];
    for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
    return out;
};

/** Pings sent by war mode (they have their own cap). */
const isWarRow = (r) => String(r.alert).startsWith('war:');

/** What this user's minute may cost: subrequests and D1 queries (checked before the user is run). */
export function userCost(row, nowS) {
    const w = watchDue(row, nowS);
    const war = parse(row.war, null);
    const inWar = Boolean(war && war.enemy && !war.done);
    const eye = kindsOn(row).watch ? watchListOf(row).length : 0;
    return {
        sub: USER_SUBREQUESTS + (w ? WATCH_SUBREQUESTS : 0) + (inWar ? WAR_SUBREQUESTS : 0) + (eye ? Math.min(EYE_PER_RUN, Math.ceil(eye / EYE_CYCLE)) : 0),
        queries: USER_QUERIES + (w ? WATCH_QUERIES : 0) + (inWar ? WAR_QUERIES : 0) + (eye ? EYE_QUERIES : 0),
    };
}

/** Is this user's price-watch check due (at least 5 minutes since the last one)? */
export function watchDue(row, nowS) {
    const prev = parse(row.prev, null);
    return kindsOn(row).price && !(prev && Number(prev.watchAt) > nowS - (WATCH_EVERY_S - WATCH_SLACK_S));
}

/**
 * Send the new alerts, grouped; record each in `sent` with its message.
 * With a metered database, a message goes out only when there is room to
 * record it (a message sent but not recorded would be sent again).
 */
export async function sendAlerts(env, f, db, user, alerts, nowS) {
    let sent = 0;
    let messages = 0;
    const ids = [];
    const sorted = [...alerts].sort((a, b) => (a.id < b.id ? -1 : 1));
    for (const group of chunks(sorted, PER_MESSAGE)) {
        // Room for: the rows, a DM channel save, a watch mark each, the user's minute.
        if (typeof db.left === 'function' && db.left() < group.length * 2 + 2) throw new BudgetError();
        const rows = group.map((a) => ({ user: user.id, alert: a.id, at: nowS, state: 'sent', until: null, body: { title: a.title, text: a.text, kind: a.kind, link: a.link || null, step: a.step && a.skip !== false ? { at: a.step.at, kind: a.step.kind, label: a.step.label } : null, ...(a.attack ? { attack: a.attack } : {}), ...(a.event ? { event: a.event } : {}) } }));
        const d = await deliver(env, f, db, user, rows, nowS);
        // Discord refused the message itself (400): record it as failed instead of retrying it every minute.
        if (!d.ok && d.bad) {
            for (const r of rows) await db.prepare(Q.sentPut).bind(user.id, r.alert, nowS, 'resolved', null, null, null, JSON.stringify(r.body), 'failed').run();
            continue;
        }
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
 * edits a minute; the buttons on the rest answer "already done".
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

/** Mark the user as run this minute (so a user that errors doesn't stay first in line). */
const touch = (db, row, nowS) => db.prepare(Q.userRan).bind(nowS, row.prev || null, row.war || null, row.id).run();

/** One user's minute. */
export async function runUser(env, row, nowS, fetchImpl = fetch, db = env.DB) {
    const f = guard(fetchImpl);
    if (!row.torn_key || Number(row.paused) || !canDeliver(env, row)) {
        await touch(db, row, nowS);
        return { sent: 0, skipped: true };
    }
    let key;
    try {
        key = await keyFor(env, db, row);
    } catch (e) {
        if (!(e instanceof KeyError)) throw e;
        await db.prepare(Q.userPause).bind(e.message, row.id).run();
        return { sent: 0, error: String(e.message) };
    }
    let state;
    try {
        state = await userState(f, key);
    } catch (e) {
        if (!(e instanceof TornError)) throw e;
        if (e.dead) await pauseUser(db, row.id, e);
        else await touch(db, row, nowS);
        return { sent: 0, error: 'Torn error ' + e.code };
    }
    const st = settingsOf(row);
    const prev = parse(row.prev, null);
    const on = kindsOn(row);
    const planAt = Number(row.plan_at || row.updated) || 0;
    const alerts = dueAlerts(state, parse(row.plan, null), nowS, on, { prev, planStale: planStale(row, nowS), planAge: planAge(row, nowS), planAt });
    // Price watches, when 5 minutes have passed since this user's last check.
    const watching = watchDue(row, nowS);
    if (watching) {
        try {
            alerts.push(...(await watchAlerts(f, db, key, row, nowS)).alerts);
        } catch (e) {
            if (e instanceof TornError && e.dead) {
                await pauseUser(db, row.id, e);
                return { sent: 0, error: 'Torn error ' + e.code };
            }
            if (!(e instanceof TornError)) throw e;
        }
    }
    // The watch list: a few watched players read in turn; their pings join this minute's.
    const oldEye = row.watch_state || null;
    let eye = parse(oldEye, null);
    const watched = watchListOf(row);
    if (!watched.length) eye = null;
    else if (on.watch && !muted(st, 'watch', nowS)) {
        try {
            const r = await eyeTick({ f, key, nowS, list: watched, state: eye, bands: targetsOf(row).bands, leadS: st.warLead * 60 });
            alerts.push(...r.alerts);
            eye = r.state;
        } catch (e) {
            // eyeTick keeps other Torn errors to itself: only a dead key comes here.
            if (!(e instanceof TornError && e.dead)) throw e;
            await pauseUser(db, row.id, e);
            return { sent: 0, error: 'Torn error ' + e.code };
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
        if (NO_SNOOZE.has(b.kind)) continue;
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
    // Quiet hours and caps: strict jump steps still go through. War pings have their own cap.
    const normal = rows.filter((r) => !isWarRow(r));
    const room = Math.min(st.perHour - messagesSince(normal, nowS - 3600), st.perDay - messagesSince(normal, nowS - DAY_S));
    let warRoom = st.warPerHour - messagesSince(rows.filter(isWarRow), nowS - 3600);
    if (inQuiet(st, nowS) || room <= 0) fresh = fresh.filter((a) => a.kind === 'jump');
    else if (fresh.length > room * PER_MESSAGE) fresh = fresh.slice(0, room * PER_MESSAGE);

    const out = await sendAlerts(env, f, db, row, fresh, nowS);
    let sent = out.sent;
    let used = out.messages;
    for (const a of fresh) if (a.kind === 'price' && out.ids.includes(a.id)) await db.prepare(Q.watchMark).bind(1, row.id, a.item).run();

    // What this read saw, saved right away: an aborted run later can't replay a transition.
    const next = nextPrev(prev, state, nowS);
    next.watchAt = watching ? nowS : (prev && prev.watchAt) || null;
    next.staleFor = out.ids.some((id) => id.startsWith('stale:')) ? planAt : (prev && prev.staleFor) || null;
    const oldWar = row.war || null;
    row.prev = JSON.stringify(next);
    await db.prepare(Q.userRan).bind(nowS, row.prev, oldWar, row.id).run();

    // Wars (a new message for each minute's pings, their own cap) and chains (a live message edited in place). See war.js.
    let war = parse(oldWar, null);
    const live = {
        env,
        f,
        db,
        user: row,
        key,
        nowS,
        rows,
        bands: targetsOf(row).bands,
        mayStart: () => !inQuiet(st, nowS) && room - used > 0,
        send: async (list) => {
            const r = await sendAlerts(env, f, db, row, list, nowS);
            sent += r.sent;
            used += r.messages;
            return r.ids;
        },
    };
    const warLive = {
        ...live,
        warList: warListOf(row),
        leadS: st.warLead * 60,
        mayStart: () => !inQuiet(st, nowS) && warRoom > 0,
        send: async (list) => {
            const r = await sendAlerts(env, f, db, row, list, nowS);
            sent += r.sent;
            warRoom -= r.messages;
            return r.ids;
        },
    };
    try {
        if (on.war && row.faction_id && !muted(st, 'war', nowS)) war = await warTick({ ...warLive, war });
        if (on.chain && !muted(st, 'chain', nowS)) await chainTick(live);
    } catch (e) {
        if (!(e instanceof TornError)) throw e;
        if (e.dead) {
            await pauseUser(db, row.id, e);
            return { sent, resolved, error: 'Torn error ' + e.code };
        }
        // A key without the faction selections (16), or a faction Torn doesn't know (6, 7):
        // wars are checked again in 10 minutes. Other Torn hiccups keep the war as it was.
        if ([6, 7, 16].includes(e.code)) war = { checked: nowS, error: e.code };
    }
    const newWar = war ? JSON.stringify(war) : null;
    const newEye = eye ? JSON.stringify(eye) : null;
    if (newWar !== oldWar || newEye !== oldEye) await db.prepare(Q.userLive).bind(newWar, newEye, row.id).run();
    return { sent, resolved };
}

/** Plain keys left from 1.0 (paused users, users no ping reaches): sealed a few at a time. */
async function sealPlainKeys(env, db) {
    if (!env.KEY_ENC) return 0;
    const { results } = await db.prepare(Q.usersPlainKeys).all();
    let n = 0;
    for (const r of results || []) {
        if (isSealed(r.torn_key)) continue;
        await db.prepare(Q.userKey).bind(await sealKey(String(r.torn_key), env, r.id), r.id).run();
        n++;
    }
    return n;
}

/** Users not synced for 30 days: forgotten, a few per cleanup, leaving room to seal keys after. */
async function forgetStale(db, nowS) {
    const room = Math.min(STALE_PER_RUN, Math.floor((db.left() - 1 - SEAL_QUERIES) / FORGET.length));
    if (room < 1) return 0;
    const { results } = await db.prepare(Q.usersStale).bind(nowS - STALE_USER_S, room).all();
    for (const r of results || []) await forgetUser(db, r.id);
    return (results || []).length;
}

export async function runCron(env, nowS = Math.floor(Date.now() / 1000), fetchImpl = fetch) {
    const spent = await ensureSchema(env.DB);
    const f = guard(fetchImpl);
    const db = meterDb(env.DB, QUERY_BUDGET - spent);
    const cleanup = Math.floor(nowS / 60) % 10 === 0;
    const hourly = Math.floor(nowS / 60) % 60 === 0;
    const keep = hourly ? HOURLY_QUERIES : cleanup ? CLEANUP_QUERIES : 0;
    const out = [];
    try {
        const { results } = await db.prepare(Q.usersDue).bind(20).all();
        let stop = false;
        for (const row of results || []) {
            const cost = userCost(row, nowS);
            if (stop || f.left() < cost.sub || db.left() < cost.queries + keep) {
                out.push({ sent: 0, later: true });
                continue;
            }
            try {
                out.push(await runUser(env, row, nowS, f, db));
            } catch (e) {
                if (!(e instanceof BudgetError)) {
                    // A network or Discord failure: to the back of the line, so one row can't hold the front every minute.
                    try {
                        await touch(db, row, nowS);
                    } catch {
                        // The next run tries again.
                    }
                    out.push({ sent: 0, error: String((e && e.message) || e) });
                    continue;
                }
                out.push({ sent: 0, later: true });
                stop = true;
            }
        }
        if (cleanup) {
            await db.prepare(Q.sentClean).bind(nowS - SENT_KEEP_S).run();
            await db.prepare(Q.sentCleanLive).bind(nowS - LIVE_KEEP_S).run();
            await db.prepare(Q.ackClean).bind(nowS - SENT_KEEP_S).run();
            await db.prepare(Q.linkClean).bind(nowS).run();
            await db.prepare(Q.loginClean).bind(nowS - LOGIN_TTL_S).run();
            await forgetStale(db, nowS);
            await sealPlainKeys(env, db);
        }
    } catch (e) {
        if (!(e instanceof BudgetError)) throw e;
    }
    return out;
}
