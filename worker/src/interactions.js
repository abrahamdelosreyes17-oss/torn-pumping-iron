/*
 * Slash commands and buttons (Discord's HTTP interactions). Each handler is
 * pure: (interaction, env, fetchImpl, ctx) → Response. Answers that only
 * read D1 come back at once (type 4); answers that read Torn are deferred
 * (type 5) and filled in with ctx.waitUntil.
 *
 * Nothing here acts in Torn. Buttons that lead to Torn are links the user
 * clicks. Every reply is ephemeral: only the person who asked sees it.
 */

import { T, R, json, reply, verifyDiscord, interactionUser } from './discord.js';
import { ensureSchema } from './db.js';
import { HELP } from './commands.js';
import { needsLink, statusCmd, planCmd, nextCmd } from './cmd-core.js';

const COMMANDS = {
    help: async () => reply(HELP),
    status: needsLink(statusCmd),
    plan: needsLink(planCmd),
    next: needsLink(nextCmd),
};

const BUTTONS = {};

/** Options of a slash command as {name: value} (sub-commands are not used). */
export function options(i) {
    const out = {};
    for (const o of (i.data && i.data.options) || []) out[o.name] = o.value;
    return out;
}

export async function handleInteraction(interaction, env, fetchImpl, ctx, nowS = Math.floor(Date.now() / 1000)) {
    const i = interaction || {};
    if (i.type === T.PING) return json({ type: R.PONG });
    if (!interactionUser(i)) return json({ error: 'No user' }, 400);
    if (i.type === T.COMMAND) {
        const h = COMMANDS[i.data && i.data.name];
        return h ? h(i, env, fetchImpl, ctx, nowS) : reply('I don’t know that command. Try /help.');
    }
    if (i.type === T.COMPONENT) {
        const id = String((i.data && i.data.custom_id) || '');
        const verb = id.split(':')[0];
        const h = BUTTONS[verb];
        return h ? h(i, id.slice(verb.length + 1), env, fetchImpl, ctx, nowS) : reply('That button no longer works.');
    }
    return json({ error: 'Unsupported interaction' }, 400);
}

/** POST /interactions: verify, then answer. 401 on a bad signature (Discord tests this). */
export async function interactionsRoute(req, env, fetchImpl, ctx, nowS = Math.floor(Date.now() / 1000)) {
    const v = await verifyDiscord(req, env.DISCORD_PUBLIC_KEY, nowS);
    if (!v.ok) return new Response('Bad request signature', { status: 401 });
    let interaction;
    try {
        interaction = JSON.parse(v.body);
    } catch {
        return json({ error: 'Body is not JSON' }, 400);
    }
    if (interaction.type !== T.PING) await ensureSchema(env.DB);
    return handleInteraction(interaction, env, fetchImpl, ctx, nowS);
}
