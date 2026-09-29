/*
 * Commands that read Torn with the user's own key (their own Worker key,
 * never anyone else's). They answer "thinking…" at once and fill in the
 * answer when Torn replies. One such command per user every 5 seconds,
 * so a user's key stays far under Torn's 100 calls a minute.
 */

import { Q } from './db.js';
import { reply, defer, linkButton, row as actionRow } from './discord.js';
import { keyFor, KeyError } from './keys.js';
import { userState, pauseUser, tornErrorText, TornError } from './torn.js';
import { clock, rel, dur, PAGES } from './format.js';

export const COMMAND_GAP_S = 5;

/**
 * Checks shared by every Torn-reading command, then the deferred work.
 * `work(key)` returns the message data.
 */
export async function withTorn(user, i, env, fetchImpl, ctx, nowS, work) {
    if (!user.torn_key) return reply('No Torn key on the Worker yet: add one in Pumping Iron → Settings → Discord.');
    if (Number(user.paused)) return reply('Paused: ' + (user.last_error || 'Torn refused the key') + '. Paste a new key in Pumping Iron → Settings → Discord.');
    if (nowS - (Number(user.cmd_at) || 0) < COMMAND_GAP_S) return reply('One moment: wait a few seconds between commands that read Torn.');
    await env.DB.prepare(Q.userCmd).bind(nowS, user.id).run();
    return defer(ctx, env, fetchImpl, env.DB, i, async () => {
        let key;
        try {
            key = await keyFor(env, env.DB, user);
        } catch (e) {
            if (e instanceof KeyError) await env.DB.prepare(Q.userPause).bind(e.message, user.id).run();
            return { content: String(e.message) };
        }
        try {
            return await work(key);
        } catch (e) {
            if (e instanceof TornError && e.dead) await pauseUser(env.DB, user.id, e);
            return { content: tornErrorText(e) };
        }
    });
}

function cooldownLine(name, s, nowS) {
    const n = Number(s) || 0;
    return name + ': ' + (n > 0 ? dur(n) + ' (ends ' + clock(nowS + n) + ' · ' + rel(nowS + n) + ')' : '**ready**');
}

export function timersText(state, nowS) {
    const cd = state.cooldowns || {};
    const e = (state.bars && state.bars.energy) || {};
    const t = state.travel || {};
    const lines = ['**Timers** (Torn time)'];
    lines.push(cooldownLine('Drug', cd.drug, nowS));
    lines.push(cooldownLine('Booster', cd.booster, nowS));
    lines.push(cooldownLine('Medical', cd.medical, nowS));
    const full = Number(e.full_time) || 0;
    lines.push('Energy: ' + (Number(e.current) || 0) + '/' + (Number(e.maximum) || 0) + (Number(e.current) >= Number(e.maximum) ? ' · **full**' : full > 0 ? ' · full in ' + dur(full) + ' (' + clock(nowS + full) + ')' : ''));
    const r = state.refills || {};
    lines.push('Refill: ' + (r.energy === true ? 'used today' : '**unused** (resets 00:00 TCT · ' + rel(Math.floor(nowS / 86400 + 1) * 86400) + ')'));
    const left = Number(t.time_left) || 0;
    if (left > 0) lines.push('Travel: flying to ' + (t.destination || '?') + ', lands ' + clock(nowS + left) + ' · ' + rel(nowS + left));
    else if (t.destination && t.destination !== 'Torn') lines.push('Travel: in ' + t.destination);
    else lines.push('Travel: in Torn');
    return lines.join('\n');
}

export async function timersCmd(user, i, env, fetchImpl, ctx, nowS) {
    return withTorn(user, i, env, fetchImpl, ctx, nowS, async (key) => {
        const s = await userState(fetchImpl, key);
        return { content: timersText(s, nowS), components: [actionRow([linkButton('Items', PAGES.items), linkButton('Gym', PAGES.gym)])] };
    });
}
