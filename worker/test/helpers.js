/*
 * Shared test tools: a recording fetch that fails on any host other than
 * Torn's API, Discord and TornW3B; Discord-signed requests with a key pair
 * made here; a waitUntil that can be awaited.
 */

import { fakeD1 } from './fake-d1.js';

export const ALLOWED = ['api.torn.com', 'discord.com', 'weav3r.dev'];
export const T0 = Date.UTC(2026, 8, 29, 10, 48) / 1000;
export const DISCORD_USER = '987654321098765432';
export const HOOK = 'https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi-123';
export const KEY = 'CustomKey1234567';
export const SECRET = 'a'.repeat(40);
/** 32 bytes, base64: the test KEY_ENC. */
export const KEY_ENC = Buffer.alloc(32, 7).toString('base64');

export function recorder(handler) {
    const calls = [];
    const f = async (url, init = {}) => {
        const u = new URL(String(url));
        if (!ALLOWED.includes(u.hostname)) throw new Error('Test: called a host that is not allowed: ' + u.hostname);
        calls.push({ url: String(url), init, body: init.body ? JSON.parse(init.body) : null });
        return handler(String(url), init);
    };
    f.calls = calls;
    return f;
}

export const jsonRes = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function ctx() {
    const p = [];
    return { waitUntil: (x) => p.push(x), done: () => Promise.all(p), pending: p };
}

let pair = null;
export async function keyPair() {
    if (!pair) {
        const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
        const raw = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey));
        pair = { ...kp, hex: Buffer.from(raw).toString('hex') };
    }
    return pair;
}

export async function signed(body, { ts = Math.floor(Date.now() / 1000), key = null, tamper = false } = {}) {
    const kp = await keyPair();
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'Ed25519' }, key || kp.privateKey, new TextEncoder().encode(String(ts) + text)));
    if (tamper) sig[0] ^= 1;
    return new Request('https://pumping-iron.test.workers.dev/interactions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-signature-ed25519': Buffer.from(sig).toString('hex'), 'x-signature-timestamp': String(ts) },
        body: text,
    });
}

export async function botEnv(extra = {}) {
    const kp = await keyPair();
    return { DB: fakeD1(), INVITE_CODE: 'x', DISCORD_PUBLIC_KEY: kp.hex, DISCORD_APP_ID: '111', BOT_TOKEN: 'bot-token', KEY_ENC, ...extra };
}

/** A slash command as Discord sends it (from a guild member). */
export function command(name, opts = {}, { user = DISCORD_USER, dm = false } = {}) {
    const u = { id: user, username: 'tester' };
    return {
        type: 2,
        id: 'i1',
        application_id: '111',
        token: 'tok-' + name,
        ...(dm ? { user: u } : { member: { user: u }, guild_id: '555' }),
        data: { name, options: Object.entries(opts).map(([n, value]) => ({ name: n, value })) },
    };
}

export function press(customId, messageId, { user = DISCORD_USER } = {}) {
    return { type: 3, id: 'i2', application_id: '111', token: 'tok-btn', user: { id: user }, message: { id: messageId }, data: { custom_id: customId, component_type: 2 } };
}

export const req = (method, path, { secret = SECRET, invite = null, body = null } = {}) =>
    new Request('https://pumping-iron.test.workers.dev' + path, { method, headers: { ...(secret ? { authorization: 'Bearer ' + secret } : {}), ...(invite ? { 'x-invite': invite } : {}), 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
