/*
 * Commands that answer from D1 alone (at once, type 4): /status, /plan,
 * /next. The plan is the one the userscript last synced; the bot never
 * works a plan out itself.
 */

import { Q, parse } from './db.js';
import { reply, interactionUser, linkButton, row as actionRow } from './discord.js';
import { clock, rel, dur, dayStart, DAY_S, PAGES } from './format.js';
import { settingsOf, kindsOn, planAge, planStale, muted } from './settings.js';
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
