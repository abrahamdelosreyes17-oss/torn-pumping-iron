/*
 * Getting a ping to the user: a DM from the bot (with Done / Snooze / Skip
 * buttons), or the user's channel webhook when DMs can't reach them
 * (Discord error 50007: no shared server, or DMs off). Pings due in the
 * same minute go out as one message. A message is rebuilt from its rows in
 * `sent`, so a button press or an auto-close edits it the same way.
 */

import { Q, parse } from './db.js';
import { DISCORD_API, CANNOT_DM, CHALK, GREY, AMBER, discordCall, button, linkButton, row as actionRow } from './discord.js';
import { settingsOf } from './settings.js';
import { clock, PAGES } from './format.js';

/** After a DM fails with 50007, use the webhook for this long before trying DMs again. */
export const DM_RETRY_S = 6 * 3600;
/** Discord allows 5 button rows: one per ping, so 5 pings a message. */
export const PER_MESSAGE = 5;

export const KIND_WORD = { drug: 'Drug', drugready: 'Drug', booster: 'Booster', energy: 'Energy', nerve: 'Nerve', refill: 'Refill', jump: 'Jump', step: 'Jump', landed: 'Travel', price: 'Price', watch: 'Watch', war: 'War', chain: 'Chain', stale: 'Plan', test: 'Test' };

export function bodyOf(row) {
    return typeof row.body === 'string' ? parse(row.body, {}) : row.body || {};
}

const active = (r) => !r.state || r.state === 'sent';

export function stateLine(r) {
    if (r.state === 'done') return bodyOf(r).kind === 'war' ? 'Done: no more war pings for this war' : 'Done';
    if (r.state === 'snoozed') return 'Snoozed until ' + clock(r.until) + ' TCT';
    if (r.state === 'skipped') return 'Step skipped: your plan re-times on its next sync';
    if (r.state === 'resolved') return 'Seen in Torn';
    return null;
}

function embeds(rows) {
    return rows.map((r) => {
        const b = bodyOf(r);
        const line = stateLine(r);
        // Kept well under Discord's 6,000 characters for all embeds of one message.
        const e = { title: String(b.title || '').slice(0, 256), description: String(b.text || '').slice(0, 600), color: active(r) ? CHALK : r.state === 'snoozed' ? AMBER : GREY };
        if (b.link) e.url = b.link;
        if (line) e.footer = { text: line };
        return e;
    });
}

function headline(rows) {
    const live = rows.filter((r) => active(r) || r.state === 'snoozed');
    return (live.length ? live : rows).map((r) => bodyOf(r).title).join(' · ');
}

/** Chain pings: one message edited in place; Done and a link, no snooze or skip. */
export const LIVE_KINDS = new Set(['war', 'chain']);
/** Pings about players (war, watch list) and the chain: no Snooze (they're about the next few minutes). */
export const NO_SNOOZE = new Set(['war', 'watch', 'chain']);

function liveMessage(r) {
    const b = bodyOf(r);
    const btns = [];
    if (active(r)) btns.push(button('Done', 'done:' + r.alert, 3));
    for (const t of (Array.isArray(b.attack) ? b.attack : []).slice(0, 4)) btns.push(linkButton('Attack ' + t.name, PAGES.attack(t.id)));
    if (btns.length < 5 && b.link) btns.push(linkButton('Open in Torn', b.link));
    return { content: String(b.title || '').slice(0, 1900), embeds: embeds([r]), components: btns.length ? [actionRow(btns)] : [], allowed_mentions: { parse: [] } };
}

/**
 * War pings (one or several enemies, a new message each time so Discord
 * notifies): one row of buttons: Done (stops war pings for this war) and
 * an Attack link per enemy.
 */
function warMessage(rows) {
    const btns = [];
    const open = rows.find(active);
    if (open && !rows.some((r) => r.state === 'done')) btns.push(button('Done: stop war pings', 'done:' + open.alert, 3));
    const seen = new Set();
    for (const r of rows) {
        for (const t of Array.isArray(bodyOf(r).attack) ? bodyOf(r).attack : []) {
            if (btns.length >= 5 || seen.has(t.id)) continue;
            seen.add(t.id);
            btns.push(linkButton('Attack ' + t.name, PAGES.attack(t.id)));
        }
    }
    return { content: headline(rows).slice(0, 1900), embeds: embeds(rows), components: btns.length ? [actionRow(btns)] : [], allowed_mentions: { parse: [] } };
}

/** The bot's message (DMs): buttons per ping, the Torn link on each. */
export function alertMessage(rows) {
    if (rows.length && rows.every((r) => bodyOf(r).kind === 'war' && bodyOf(r).event)) return warMessage(rows);
    if (rows.length === 1 && LIVE_KINDS.has(bodyOf(rows[0]).kind)) return liveMessage(rows[0]);
    const many = rows.length > 1;
    const components = [];
    for (const r of rows.slice(0, PER_MESSAGE)) {
        const b = bodyOf(r);
        const tag = many ? ' · ' + (KIND_WORD[b.kind] || 'Ping') : '';
        const btns = [];
        if (active(r)) {
            btns.push(button('Done' + tag, 'done:' + r.alert, 3));
            if (!NO_SNOOZE.has(b.kind)) btns.push(button('Snooze 10 min' + tag, 'snooze:' + r.alert, 2));
            if (b.step) btns.push(button('Skip step' + tag, 'skip:' + r.alert, 2));
        } else if (r.state === 'snoozed') {
            btns.push(button('Done' + tag, 'done:' + r.alert, 3));
        }
        if (b.link) btns.push(linkButton((Array.isArray(b.attack) && b.attack.length === 1 ? 'Attack ' + b.attack[0].name : 'Open in Torn') + tag, b.link));
        if (btns.length) components.push(actionRow(btns));
    }
    return { content: headline(rows).slice(0, 1900), embeds: embeds(rows), components, allowed_mentions: { parse: [] } };
}

/** The channel webhook's message: the mention in content (embeds don't ping), no buttons (a plain webhook can't have them). */
export function webhookMessage(rows, discordId) {
    const id = String(discordId || '').replace(/\D/g, '');
    const text = headline(rows);
    return { content: ((id ? '<@' + id + '> ' : '') + text.charAt(0).toLowerCase() + text.slice(1)).slice(0, 1900), embeds: embeds(rows), allowed_mentions: { users: id ? [id] : [], parse: [] } };
}

const dry = (env) => String(env.DRY_RUN || '') === '1';

/**
 * A webhook address to call: always on discord.com (discordapp.com is the
 * same service), with `extra` added to the path; a thread_id is kept.
 */
export function hookUrl(webhook, extra = '', params = {}) {
    const u = new URL(String(webhook));
    u.hostname = 'discord.com';
    u.pathname = u.pathname.replace(/\/+$/, '') + extra;
    const thread = u.searchParams.get('thread_id');
    u.search = '';
    if (thread) u.searchParams.set('thread_id', thread);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    return u.toString();
}

/** Can this user get a ping at all? */
export function canDeliver(env, user) {
    return Boolean(user.webhook) || dmPossible(env, user);
}

function dmPossible(env, user) {
    return Boolean(Number(user.linked) && user.discord_id && (env.BOT_TOKEN || dry(env)));
}

/**
 * Where this user's pings go now, for the sync answer (the browser says it in words): `via` 'dm', 'channel' (the
 * webhook) or null; `reason` why nothing can arrive ('dm_refused': Discord refused the bot's last DM and there is
 * no webhook; 'no_route': no linked account and no webhook); `dmRefusedAt` the last refused DM (unix s) until one
 * arrives again; `webhook` whether a channel webhook is saved.
 */
export function deliveryState(env, user) {
    const dm = dmPossible(env, user) && settingsOf(user).delivery !== 'channel';
    const refusedAt = dmPossible(env, user) && Number(user.dm_fail) > 0 ? Number(user.dm_fail) : null;
    const hook = Boolean(user.webhook);
    const via = dm && !refusedAt ? 'dm' : hook ? 'channel' : null;
    const reason = via ? null : dm && refusedAt ? 'dm_refused' : 'no_route';
    return { ok: via !== null, via, reason, dmRefusedAt: refusedAt, webhook: hook };
}

/** Is the bot resting DMs to this user (a DM was refused less than DM_RETRY_S ago)? */
export function dmResting(user, nowS) {
    return Number(user.dm_fail) > nowS - DM_RETRY_S;
}

/**
 * Send one message for these rows.
 *
 * A failure says why (`why`), so a test ping can tell the browser: 'dm_refused' (Discord refused the bot's DM:
 * 50007, 403 or 404, and there is no webhook to fall back on), 'discord_error' (Discord answered another error;
 * `status` and `code` are Discord's), 'no_route' (nothing to deliver through: no DM possible now, no webhook).
 * `dmRefused: true` rides along whenever the DM was refused in this call, also when the webhook then delivered.
 *
 * @param {object} [o] - {force: true} tries the DM even inside the rest after a refused one (the test ping)
 * @returns {Promise<{ok: true, via, channel, message, dmRefused?} | {ok: false, why, retry?, bad?, status?, code?, dmRefused?}>}
 */
export async function deliver(env, fetchImpl, db, user, rows, nowS, { force = false } = {}) {
    const st = settingsOf(user);
    const tryDm = dmPossible(env, user) && st.delivery !== 'channel' && (force || !dmResting(user, nowS));
    let blocked = false;
    if (tryDm) {
        let ch = user.dm_channel || null;
        const other = (r) => ({ ok: false, retry: true, why: 'discord_error', status: r.status, code: r.code });
        if (!ch) {
            const r = await discordCall(env, fetchImpl, db, { url: DISCORD_API + '/users/@me/channels', body: { recipient_id: String(user.discord_id) }, route: 'dm-open:' + user.discord_id });
            if (r.ok && r.data && r.data.id) {
                ch = String(r.data.id);
                user.dm_channel = ch;
                // After a refused DM the channel is saved with the message's outcome below (one write, and the
                // refusal stays on record until a DM really arrives: opening the channel proves nothing).
                if (!dry(env) && !Number(user.dm_fail)) await db.prepare(Q.userDm).bind(ch, 0, user.id).run();
            } else if (r.code === CANNOT_DM || r.status === 403) blocked = true;
            else if (!user.webhook) return other(r);
        }
        if (ch) {
            const r = await discordCall(env, fetchImpl, db, { url: DISCORD_API + '/channels/' + ch + '/messages', body: alertMessage(rows), route: 'dm:' + user.discord_id });
            if (r.ok) {
                // A DM that arrived ends the rest (and what the sync answer says about refused DMs).
                if (Number(user.dm_fail) && !dry(env)) {
                    user.dm_fail = 0;
                    await db.prepare(Q.userDm).bind(ch, 0, user.id).run();
                }
                return { ok: true, via: dry(env) ? 'dry' : 'dm', channel: ch, message: r.data && r.data.id ? String(r.data.id) : null };
            }
            if (r.status === 400) return { ok: false, bad: true, why: 'discord_error', status: r.status, code: r.code };
            if (r.code === CANNOT_DM || r.status === 403 || r.status === 404) blocked = true;
            else if (!user.webhook) return other(r);
        }
        if (blocked) {
            user.dm_channel = null;
            user.dm_fail = nowS;
            await db.prepare(Q.userDm).bind(null, nowS, user.id).run();
        }
    }
    const dmRefused = blocked ? { dmRefused: true } : {};
    if (user.webhook) {
        const r = await discordCall(env, fetchImpl, db, { url: hookUrl(user.webhook, '', { wait: 'true' }), body: webhookMessage(rows, user.discord_id), bot: false, route: 'hook' });
        if (r.ok) return { ok: true, via: dry(env) ? 'dry' : 'hook', channel: null, message: r.data && r.data.id ? String(r.data.id) : null, ...dmRefused };
        if (r.status === 400) return { ok: false, bad: true, why: 'discord_error', status: r.status, code: r.code, ...dmRefused };
        return { ok: false, retry: true, why: 'discord_error', status: r.status, code: r.code, ...dmRefused };
    }
    // Refused now, or still resting after a refusal: the DM is the only way and Discord does not take it.
    if (blocked || (dmPossible(env, user) && st.delivery !== 'channel' && dmResting(user, nowS))) return { ok: false, why: 'dm_refused', dmRefused: true };
    return { ok: false, why: 'no_route' };
}

/** Edit a message already sent, from its rows (all with the same message id). */
export async function editAlertMessage(env, fetchImpl, db, user, rows) {
    const first = rows[0];
    if (!first || !first.message) return { ok: false };
    if (first.via === 'dm' && first.channel) return discordCall(env, fetchImpl, db, { method: 'PATCH', url: DISCORD_API + '/channels/' + first.channel + '/messages/' + first.message, body: alertMessage(rows), route: 'edit-dm' });
    if (first.via === 'hook' && user.webhook) return discordCall(env, fetchImpl, db, { method: 'PATCH', url: hookUrl(user.webhook, '/messages/' + first.message), body: webhookMessage(rows, user.discord_id), bot: false, route: 'edit-hook' });
    if (first.via === 'dry') return discordCall(env, fetchImpl, db, { method: 'PATCH', url: DISCORD_API + '/channels/dry/messages/' + first.message, body: alertMessage(rows), route: 'edit-dry' });
    return { ok: false };
}
