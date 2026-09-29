/*
 * Commands that answer from D1 alone (at once, type 4): /status, /plan,
 * /next. The plan is the one the userscript last synced; the bot never
 * works a plan out itself.
 */

import { Q, parse } from './db.js';
import { reply, interactionUser, linkButton, row as actionRow } from './discord.js';
import { clock, rel, dur, dayStart, DAY_S, PAGES } from './format.js';
import { settingsOf, kindsOn, planAge, planStale, muted, parseQuiet } from './settings.js';
import { KINDS } from './commands.js';

export const NOT_LINKED = 'You’re not linked yet. In Pumping Iron: Settings → Discord → **Get a link code**, then type `/link CODE` here.';

/** The Pumping Iron user this Discord account is linked to, or null. */
export async function linkedUser(i, env) {
    const id = interactionUser(i);
    return id ? env.DB.prepare(Q.userByDiscord).bind(id).first() : null;
}

/** Commands that need a linked user get it as their first argument. */
export const needsLink = (h) => async (i, env, fetchImpl, ctx, nowS) => {
    const user = await linkedUser(i, env);
    return user ? h(user, i, env, fetchImpl, ctx, nowS) : reply(NOT_LINKED);
};

/* ---------- Linking: the Discord id comes from the signed interaction, never from a form ---------- */

export const LINK_TTL_S = 10 * 60;
const LINK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I

export async function sha256(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function normalCode(text) {
    return String(text || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, '');
}

/** A new single-use code for this user (any older one stops working). */
export async function newLinkCode(env, userId, nowS) {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    const code = [...bytes].map((b) => LINK_ALPHABET[b % 32]).join('');
    await env.DB.prepare(Q.linkDeleteUser).bind(userId).run();
    await env.DB.prepare(Q.linkPut).bind(await sha256('link:' + code), userId, nowS + LINK_TTL_S).run();
    return { code, expiresAt: nowS + LINK_TTL_S };
}

export async function linkCmd(i, env, fetchImpl, ctx, nowS) {
    const discordId = interactionUser(i);
    const code = normalCode(((i.data && i.data.options) || []).find((o) => o.name === 'code')?.value);
    const hash = await sha256('link:' + code);
    const row = code.length === 8 ? await env.DB.prepare(Q.linkGet).bind(hash).first() : null;
    if (!row || Number(row.expires) < nowS) return reply('That code is wrong or expired. Get a new one: Pumping Iron → Settings → Discord → **Get a link code** (it lasts 10 minutes).');
    await env.DB.prepare(Q.linkDelete).bind(hash).run();
    // One Discord account ↔ one Pumping Iron user: a link elsewhere moves here.
    await env.DB.prepare(Q.userUnlink).bind(discordId).run();
    await env.DB.prepare(Q.userLink).bind(discordId, row.user).run();
    const dm = env.BOT_TOKEN ? 'Pings now come to you by DM, with Done, Snooze and Skip buttons.' : 'Pings still go to your channel webhook (the bot has no token yet).';
    return reply('Linked. ' + dm + ' Try `/timers` or `/next`. `/unlink` undoes this.');
}

export async function unlinkCmd(i, env) {
    const user = await linkedUser(i, env);
    if (!user) return reply('This Discord account isn’t linked.');
    await env.DB.prepare(Q.userUnlink).bind(interactionUser(i)).run();
    return reply('Unlinked: no more DMs. ' + (user.webhook ? 'Pings go to your channel webhook, without buttons.' : 'Pings stop until you link again or add a webhook in Pumping Iron.'));
}

export function stepPage(step) {
    if (!step) return PAGES.gym;
    if (step.kind === 'refill') return PAGES.points;
    if (step.kind === 'natural') return PAGES.gym;
    return PAGES.items;
}

export function stepLine(s) {
    let t = '`' + clock(s.at) + '` ' + s.label + (s.train ? ' → ' + s.train : '');
    if (s.strict && s.tick) t += ' (right after the ' + clock(s.tick) + ' tick)';
    return t;
}

function steps(user) {
    const plan = parse(user.plan, null);
    return (plan && Array.isArray(plan.steps) ? plan.steps : []).filter((s) => s && Number(s.at) > 0).sort((a, b) => a.at - b.at);
}

function staleNote(user, nowS) {
    const age = planAge(user, nowS);
    if (age === null) return 'No plan synced yet: open Pumping Iron once (it sends your plan by itself).';
    if (planStale(user, nowS)) return 'Your plan is out of date (last synced ' + dur(age) + ' ago): open Pumping Iron to update it.';
    return null;
}

export async function planCmd(user, i, env, fetchImpl, ctx, nowS) {
    const all = steps(user).filter((s) => s.at >= nowS - 3600);
    const end = dayStart(nowS) + DAY_S;
    const today = all.filter((s) => s.at < end);
    const lines = today.length ? today.map((s) => stepLine(s) + (s.at < nowS - 60 ? ' · was due ' + rel(s.at) : '')) : ['No more steps today.'];
    if (!today.length && all.length) lines.push('', 'Next: ' + stepLine(all[0]) + ' · ' + rel(all[0].at));
    const note = staleNote(user, nowS);
    return reply(['**Today’s steps** (Torn time)', ...lines, ...(note ? ['', note] : [])].join('\n'));
}

export async function nextCmd(user, i, env, fetchImpl, ctx, nowS) {
    const s = steps(user).find((x) => x.at >= nowS - 60);
    const note = staleNote(user, nowS);
    if (!s) return reply(['No next step in your synced plan.', ...(note ? [note] : [])].join('\n'));
    return reply(['**Next:** ' + stepLine(s) + ' · ' + rel(s.at), ...(note ? ['', note] : [])].join('\n'), { components: [actionRow([linkButton('Open in Torn', stepPage(s))])] });
}

/* ---------- /snooze and /settings ---------- */

function optionsOf(i) {
    const out = {};
    for (const o of (i.data && i.data.options) || []) out[o.name] = o.value;
    return out;
}

async function saveSettings(env, user, st) {
    const { kinds, mute, delivery, quiet, perHour, perDay } = st;
    const text = JSON.stringify({ kinds, mute, delivery, quiet, perHour, perDay });
    await env.DB.prepare(Q.userSettings).bind(text, user.id).run();
    user.settings = text;
}

export async function snoozeCmd(user, i, env, fetchImpl, ctx, nowS) {
    const o = optionsOf(i);
    const kind = o.kind && (o.kind === 'all' || KINDS[o.kind]) ? o.kind : 'all';
    const minutes = Math.max(0, Math.min(1440, Math.round(Number(o.minutes) || 0)));
    const st = settingsOf(user);
    // Drop mutes that are over.
    for (const [k, until] of Object.entries(st.mute)) if (Number(until) <= nowS) delete st.mute[k];
    const what = kind === 'all' ? 'all pings' : KINDS[kind];
    if (minutes === 0) {
        if (kind === 'all') st.mute = {};
        else delete st.mute[kind];
        await saveSettings(env, user, st);
        return reply('Unmuted ' + what + '.');
    }
    st.mute[kind] = nowS + minutes * 60;
    await saveSettings(env, user, st);
    return reply('Muted ' + what + ' until ' + clock(nowS + minutes * 60) + ' TCT (' + rel(nowS + minutes * 60) + '). `/snooze minutes:0` unmutes.');
}

export function settingsText(user, env) {
    const st = settingsOf(user);
    const on = kindsOn(user);
    return [
        '**Settings**',
        'Pings go to: ' + (st.delivery === 'channel' ? 'your channel (webhook)' : 'DM' + (env.BOT_TOKEN ? '' : ' (the bot has no token yet: channel for now)')),
        'Quiet hours: ' + (st.quiet ? st.quiet.from + '–' + st.quiet.to + ' TCT (jump steps still come)' : 'off'),
        'At most: ' + st.perHour + ' an hour, ' + st.perDay + ' a day (jump steps still come)',
        'On: ' + Object.keys(KINDS).filter((k) => on[k]).map((k) => KINDS[k]).join(', '),
        'Off: ' + (Object.keys(KINDS).filter((k) => !on[k]).map((k) => KINDS[k]).join(', ') || 'none'),
    ].join('\n');
}

export async function settingsCmd(user, i, env) {
    const o = optionsOf(i);
    const st = settingsOf(user);
    const changed = [];
    if (o.quiet !== undefined) {
        const q = parseQuiet(o.quiet);
        if (q === undefined) return reply('Quiet hours look like `23-7` (from 23:00 to 07:00 Torn time) or `off`.');
        st.quiet = q;
        changed.push('quiet hours');
    }
    if (o.delivery === 'dm' || o.delivery === 'channel') {
        if (o.delivery === 'channel' && !user.webhook) return reply('No channel webhook saved: add one in Pumping Iron → Settings → Discord first.');
        st.delivery = o.delivery;
        changed.push('delivery');
    }
    if (o.kind !== undefined) {
        if (!KINDS[o.kind]) return reply('Unknown ping kind.');
        if (o.on === undefined) return reply('Say `on:True` or `on:False` with the kind.');
        st.kinds[o.kind] = Boolean(o.on);
        changed.push(KINDS[o.kind] + (o.on ? ' on' : ' off'));
    }
    if (o.per_hour !== undefined) {
        st.perHour = Math.max(1, Math.min(60, Math.round(Number(o.per_hour))));
        changed.push('per hour');
    }
    if (o.per_day !== undefined) {
        st.perDay = Math.max(1, Math.min(500, Math.round(Number(o.per_day))));
        changed.push('per day');
    }
    if (changed.length) await saveSettings(env, user, st);
    return reply((changed.length ? 'Saved: ' + changed.join(', ') + '.\n\n' : '') + settingsText(user, env));
}

export async function statusCmd(user, i, env, fetchImpl, ctx, nowS) {
    const st = settingsOf(user);
    const on = kindsOn(user);
    const { results } = await env.DB.prepare(Q.sentList).bind(user.id).all();
    const msgs = (since) => new Set((results || []).filter((r) => r.at >= since && r.message).map((r) => r.message)).size;
    const age = planAge(user, nowS);
    const lines = ['**Status**'];
    const viaDm = st.delivery !== 'channel' && env.BOT_TOKEN;
    lines.push('Linked: yes · pings go to ' + (viaDm ? 'your DMs' + (user.webhook ? ' (your channel if DMs fail)' : '') : user.webhook ? 'your channel' : 'nowhere yet: set delivery to DM or add a webhook in Pumping Iron'));
    if (!user.torn_key) lines.push('Torn key: none. Add the Worker’s key in Pumping Iron → Settings → Discord.');
    else if (Number(user.paused)) lines.push('Torn key: **paused**: ' + (user.last_error || 'Torn refused it') + '. Paste a new key in Pumping Iron.');
    else lines.push('Torn key: working' + (user.ran ? ' · last read ' + rel(user.ran) : ''));
    lines.push('Plan: ' + (age === null ? 'not synced yet' : planStale(user, nowS) ? '**out of date** (synced ' + dur(age) + ' ago)' : 'synced ' + dur(age) + ' ago'));
    lines.push('Pings: ' + msgs(nowS - 3600) + ' in the last hour (at most ' + st.perHour + '), ' + msgs(nowS - DAY_S) + ' today (at most ' + st.perDay + ')');
    lines.push('Quiet hours: ' + (st.quiet ? clock(st.quiet.from * 3600) + '–' + clock(st.quiet.to * 3600) + ' TCT (jump steps still come)' : 'off'));
    const mutes = Object.entries(st.mute || {}).filter(([k]) => muted({ mute: { [k]: st.mute[k] } }, k, nowS)).map(([k, until]) => (k === 'all' ? 'all pings' : KINDS[k] || k) + ' until ' + clock(until));
    if (mutes.length) lines.push('Muted: ' + mutes.join(', '));
    const off = Object.keys(KINDS).filter((k) => !on[k]);
    if (off.length) lines.push('Off: ' + off.map((k) => KINDS[k]).join(', '));
    if (String(env.DRY_RUN || '') === '1') lines.push('', 'Test mode (DRY_RUN): messages are stored, not sent.');
    return reply(lines.join('\n'));
}
