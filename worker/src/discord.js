/*
 * Discord's side: checking that a request really comes from Discord, the
 * answers an interaction can give, and every call to Discord's API (DMs,
 * the channel webhook, edits, follow-ups). With DRY_RUN=1 nothing is
 * posted: each message body goes to the `outbox` table instead.
 */

import { Q } from './db.js';

export const DISCORD_API = 'https://discord.com/api/v10';

/** Discord's signed timestamp may be at most this old (or this far ahead). */
export const MAX_SKEW_S = 5 * 60;

export const T = { PING: 1, COMMAND: 2, COMPONENT: 3, AUTOCOMPLETE: 4, MODAL: 5 };
export const R = { PONG: 1, MESSAGE: 4, DEFERRED: 5, DEFERRED_UPDATE: 6, UPDATE: 7 };
export const EPHEMERAL = 64;
/** Discord: "Cannot send messages to this user" (no shared server, or DMs off). */
export const CANNOT_DM = 50007;

export const CHALK = 0xefebe2;
export const GREY = 0x6c737a;
export const AMBER = 0xf0a040;

const te = new TextEncoder();
const keyCache = new Map();

export function hexToBytes(hex) {
    const s = String(hex || '');
    if (!/^([0-9a-f]{2})+$/i.test(s)) return null;
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
    return out;
}

async function publicKey(hex) {
    if (!keyCache.has(hex)) {
        const raw = hexToBytes(hex);
        if (!raw || raw.length !== 32) throw new Error('DISCORD_PUBLIC_KEY is not a 64-character hex key');
        keyCache.set(hex, crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, false, ['verify']));
    }
    return keyCache.get(hex);
}

/**
 * Check Discord's Ed25519 signature over `timestamp + body`.
 * @returns {Promise<{ok: boolean, body?: string, why?: string}>}
 */
export async function verifyDiscord(req, publicKeyHex, nowS = Math.floor(Date.now() / 1000)) {
    const sig = hexToBytes(req.headers.get('x-signature-ed25519'));
    const ts = String(req.headers.get('x-signature-timestamp') || '');
    const body = await req.text();
    if (!publicKeyHex) return { ok: false, why: 'no public key' };
    if (!sig || sig.length !== 64 || !/^\d{1,12}$/.test(ts)) return { ok: false, why: 'missing signature' };
    if (Math.abs(nowS - Number(ts)) > MAX_SKEW_S) return { ok: false, why: 'old timestamp' };
    let ok = false;
    try {
        ok = await crypto.subtle.verify({ name: 'Ed25519' }, await publicKey(publicKeyHex), sig, te.encode(ts + body));
    } catch {
        ok = false;
    }
    return ok ? { ok: true, body } : { ok: false, why: 'bad signature' };
}

export function json(body, status = 200) {
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const NO_PINGS = { parse: [] };

/** A reply only the person who asked can see. */
export function reply(content, { embeds, components, ephemeral = true } = {}) {
    const data = { content: content || '', allowed_mentions: NO_PINGS };
    if (embeds) data.embeds = embeds;
    if (components) data.components = components;
    if (ephemeral) data.flags = EPHEMERAL;
    return json({ type: R.MESSAGE, data });
}

/** Button press: replace the message the button was on. */
export function update(data) {
    return json({ type: R.UPDATE, data: { allowed_mentions: NO_PINGS, ...data } });
}

/** The Discord user behind an interaction (guild: member.user; DM: user). */
export function interactionUser(i) {
    const u = (i && i.member && i.member.user) || (i && i.user) || null;
    return u && u.id ? String(u.id) : null;
}

/** A link button (the user clicks; the bot never acts in Torn). */
export function linkButton(label, url) {
    return { type: 2, style: 5, label: String(label).slice(0, 80), url };
}

export function button(label, customId, style = 2) {
    return { type: 2, style, label: String(label).slice(0, 80), custom_id: String(customId).slice(0, 100) };
}

export function row(components) {
    return { type: 1, components: components.slice(0, 5) };
}

/**
 * One call to Discord. With DRY_RUN=1 the body is stored in `outbox` and a
 * made-up message comes back, so the rest of the flow runs the same.
 * @returns {Promise<{ok: boolean, status: number, code: number|null, data: object|null}>}
 */
export async function discordCall(env, fetchImpl, db, { method = 'POST', url, body = null, bot = true, route = null }) {
    if (String(env.DRY_RUN || '') === '1') {
        await db.prepare(Q.outboxPut).bind(Math.floor(Date.now() / 1000), route || method + ' ' + url.replace(/\/webhooks\/(\d+)\/[^/?]+/, '/webhooks/$1/…'), JSON.stringify(body)).run();
        const id = 'dry-' + Math.random().toString(36).slice(2, 10);
        return { ok: true, status: 200, code: null, data: { id, channel_id: 'dry' } };
    }
    const headers = { 'content-type': 'application/json' };
    if (bot) headers.authorization = 'Bot ' + env.BOT_TOKEN;
    const res = await fetchImpl(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    let data = null;
    try {
        data = res.status === 204 ? null : await res.json();
    } catch {
        data = null;
    }
    const ok = res.status >= 200 && res.status < 300;
    return { ok, status: res.status, code: !ok && data && data.code !== undefined ? Number(data.code) : null, data };
}

/** Replace a deferred answer (valid 15 minutes after the interaction). */
export function editOriginal(env, fetchImpl, db, interaction, data) {
    const app = env.DISCORD_APP_ID || interaction.application_id;
    return discordCall(env, fetchImpl, db, {
        method: 'PATCH',
        url: DISCORD_API + '/webhooks/' + app + '/' + interaction.token + '/messages/@original',
        body: { allowed_mentions: NO_PINGS, ...data },
        bot: false,
        route: 'followup',
    });
}
