/*
 * The userscript's side of the Discord service: talks only to the user's
 * own Cloudflare Worker (https://<name>.<account>.workers.dev), with a
 * secret this browser made. The userscript never posts to Discord itself
 * (no alerts from a Torn tab); the Worker does, from the API.
 *
 * What goes to the Worker: the plan's next steps, the Discord webhook and
 * user id you enter, and a separate custom Torn key you make for it
 * (bars, cooldowns, refills, travel). Your main Torn key never does.
 */

import { gmFetch } from '../platform/gm.js';
import { STAT_LABEL } from '../core/gain.js';

export const WORKER_SETUP_URL = 'https://github.com/abrahamdelosreyes17-oss/torn-pumping-iron/blob/main/worker/SETUP.md';

export class WorkerError extends Error {
    constructor(message, { http = null } = {}) {
        super(message);
        this.name = 'WorkerError';
        this.http = http;
    }
}

/** Only https://*.workers.dev (the script's @connect allows nothing else). */
export function workerBase(url) {
    let u;
    try {
        u = new URL(String(url || '').trim());
    } catch {
        throw new WorkerError('That is not a web address.');
    }
    if (u.protocol !== 'https:' || !/\.workers\.dev$/.test(u.hostname)) throw new WorkerError('Use your Worker’s https://….workers.dev address.');
    return 'https://' + u.hostname;
}

/** A new secret for this browser: 32 random bytes as hex. */
export function newSecret(rng = null) {
    const bytes = new Uint8Array(32);
    if (rng) for (let i = 0; i < 32; i++) bytes[i] = rng() * 256;
    else crypto.getRandomValues(bytes);
    return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The plan's steps as the Worker needs them (seconds, words only). */
export function stepsForWorker(steps, limit = 24) {
    return (steps || []).slice(0, limit).map((s) => ({
        at: Math.round(s.at / 1000),
        kind: s.kind,
        label: s.label,
        train: Object.entries(s.trains || {}).filter(([, n]) => n > 0).map(([k, n]) => STAT_LABEL[k] + ' × ' + n).join(' · ') || null,
        strict: Boolean(s.strict),
        tick: s.tick ? Math.round(s.tick / 1000) : null,
    }));
}

async function workerCall(base, path, { method = 'GET', secret = null, invite = null, body = null, fetchImpl = gmFetch } = {}) {
    const headers = { 'content-type': 'application/json' };
    if (secret) headers.authorization = 'Bearer ' + secret;
    if (invite) headers['x-invite'] = invite;
    let res;
    try {
        res = await fetchImpl(workerBase(base) + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
        if (e instanceof WorkerError) throw e;
        throw new WorkerError('Could not reach your Worker.');
    }
    let data = null;
    try {
        data = await res.json();
    } catch {
        data = null;
    }
    if (!res.ok || !data || data.ok === false) throw new WorkerError((data && data.error) || 'Your Worker answered ' + res.status + '.', { http: res.status });
    return data;
}

export function workerHealth(base, opts) {
    return workerCall(base, '/health', opts);
}

/**
 * Store the plan (and on first connect the key, webhook and Discord id).
 * @param {object} o - {base, secret, invite?, plan, tornKey?, webhookUrl?, discordId?, rules?}
 */
export function workerSync({ base, secret, invite = null, plan, tornKey, webhookUrl, discordId, rules, fetchImpl }) {
    const body = { plan };
    if (tornKey !== undefined) body.tornKey = tornKey;
    if (webhookUrl !== undefined) body.webhookUrl = webhookUrl;
    if (discordId !== undefined) body.discordId = discordId;
    if (rules !== undefined) body.rules = rules;
    return workerCall(base, '/plan', { method: 'PUT', secret, invite, body, fetchImpl });
}

export function workerTest({ base, secret, fetchImpl }) {
    return workerCall(base, '/test', { method: 'POST', secret, fetchImpl });
}

export function workerForget({ base, secret, fetchImpl }) {
    return workerCall(base, '/plan', { method: 'DELETE', secret, fetchImpl });
}
