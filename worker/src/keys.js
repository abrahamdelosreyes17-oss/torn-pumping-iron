/*
 * Torn keys at rest: AES-GCM with the Worker's KEY_ENC secret (32 random
 * bytes, base64). The user's row id is bound in as extra data, so a sealed
 * key copied to another row doesn't open. Stored as "v1.<iv>.<ciphertext>".
 * A 1.0 row still holding a plain key is read once and sealed in place.
 */

import { Q } from './db.js';

const te = new TextEncoder();
const td = new TextDecoder();
const PLAIN_KEY = /^[A-Za-z0-9]{16}$/;

export class KeyError extends Error {
    constructor(message) {
        super(message);
        this.name = 'KeyError';
    }
}

const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const cache = new Map();
function aesKey(secret) {
    const s = String(secret || '').trim();
    if (!s) throw new KeyError('The Worker has no KEY_ENC secret: see SETUP.md');
    if (!cache.has(s)) {
        let raw;
        try {
            raw = unb64(s);
        } catch {
            raw = null;
        }
        if (!raw || raw.length !== 32) throw new KeyError('KEY_ENC must be 32 random bytes in base64: see SETUP.md');
        cache.set(s, crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']));
    }
    return cache.get(s);
}

export const isSealed = (stored) => /^v1\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$/.test(String(stored || ''));

export async function sealKey(plain, env, userId) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(String(userId)) }, await aesKey(env.KEY_ENC), te.encode(plain)));
    return 'v1.' + b64(iv) + '.' + b64(ct);
}

/**
 * A user's Torn key for this call. A plain 1.0 key is sealed in place the
 * first time it's read (when KEY_ENC is set). Throws KeyError.
 */
export async function keyFor(env, db, user) {
    const { key, legacy } = await openKey(user.torn_key, env, user.id);
    if (legacy && key && env.KEY_ENC) {
        const sealed = await sealKey(key, env, user.id);
        await db.prepare(Q.userKey).bind(sealed, user.id).run();
        user.torn_key = sealed;
    }
    return key;
}

/** The plain key, or throws KeyError. `legacy` = stored plain (a 1.0 row). */
export async function openKey(stored, env, userId) {
    const s = String(stored || '');
    if (!s) return { key: '', legacy: false };
    if (PLAIN_KEY.test(s)) return { key: s, legacy: true };
    if (!isSealed(s)) throw new KeyError('The stored key is unreadable');
    const [, iv, ct] = s.split('.');
    try {
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: te.encode(String(userId)) }, await aesKey(env.KEY_ENC), unb64(ct));
        return { key: td.decode(pt), legacy: false };
    } catch (e) {
        if (e instanceof KeyError) throw e;
        throw new KeyError('The Worker could not open your key (was KEY_ENC changed?). Paste the key again in Pumping Iron.');
    }
}
