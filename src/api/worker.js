/*
 * The userscript's side of the Discord service: talks only to the user's
 * own Cloudflare Worker (https://<name>.<account>.workers.dev), with a
 * secret this browser made. The userscript never posts to Discord itself
 * (no alerts from a Torn tab); the Worker does, from the API.
 *
 * What goes to the Worker: the plan's next steps, your Torn key once you
 * log in with Discord (stored encrypted there, used only for your pings and
 * the bot's commands; owner's decision 2026-09-29), the Discord webhook if
 * you run your own service, and (for the bot's /targets, /war and watch
 * pings) Torn Eye's lists and bands, your player and faction id. Never your
 * Full key, FFScouter or TornStats keys (worker/USERSCRIPT-INTERFACE.md).
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

/**
 * The plan's steps as the Worker needs them (seconds, words only). Up to 48:
 * the next 48 h even on a busy plan, so the bot can follow them while the
 * laptop is closed (the Worker uses them for up to 48 h after a sync).
 */
export function stepsForWorker(steps, limit = 48) {
    return (steps || []).slice(0, limit).map((s) => ({
        at: Math.round(s.at / 1000),
        kind: s.kind,
        label: s.label,
        train: Object.entries(s.trains || {}).filter(([, n]) => n > 0).map(([k, n]) => STAT_LABEL[k] + ' × ' + n).join(' · ') || null,
        // A step in the middle of a boost or jump (round 7) is due now and ends at the tick: for the Worker it is a
        // "step now" (its strict pings say "right after the tick", which would be the wrong way round).
        strict: Boolean(s.strict) && !s.mid,
        tick: s.tick && !s.mid ? Math.round(s.tick / 1000) : null,
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
 * @param {object} o - {base, secret, invite?, plan, tornKey?, webhookUrl?, discordId?, rules?, war?, watch?}
 */
export function workerSync({ base, secret, invite = null, plan, tornKey, webhookUrl, discordId, rules, ackIds, targets, factionId, playerId, war, watch, fetchImpl }) {
    const body = { plan };
    if (war !== undefined) body.war = war;
    if (watch !== undefined) body.watch = watch;
    if (ackIds && ackIds.length) body.ackIds = ackIds.slice(0, 50);
    if (targets !== undefined) body.targets = targets;
    if (factionId !== undefined) body.factionId = factionId;
    if (playerId !== undefined) body.playerId = playerId;
    if (tornKey !== undefined) body.tornKey = tornKey;
    if (webhookUrl !== undefined) body.webhookUrl = webhookUrl;
    if (discordId !== undefined) body.discordId = discordId;
    if (rules !== undefined) body.rules = rules;
    return workerCall(base, '/plan', { method: 'PUT', secret, invite, body, fetchImpl });
}

/** A one-time code to type as /link CODE in Discord (10 min, single use). Only on a click. */
export function workerLink({ base, secret, fetchImpl }) {
    return workerCall(base, '/link', { method: 'POST', secret, fetchImpl });
}

export function workerTest({ base, secret, fetchImpl }) {
    return workerCall(base, '/test', { method: 'POST', secret, fetchImpl });
}

export function workerForget({ base, secret, fetchImpl }) {
    return workerCall(base, '/plan', { method: 'DELETE', secret, fetchImpl });
}

/** The Pumping Iron service everyone logs in to (the owner's Worker); "your own service" can replace it. */
export const DEFAULT_WORKER = 'https://pumping-iron.pumping-iron-worker.workers.dev';

/** Log in with Discord, step 1: an address to open (15 minutes, this browser's secret). */
export function workerLoginStart({ base, secret, fetchImpl }) {
    return workerCall(base, '/login/start', { method: 'POST', secret, fetchImpl });
}

/** Log in with Discord, step 2: how it went ({state: open|done|not_member|denied|full|failed|expired, name}). */
export function workerLoginStatus({ base, secret, id, fetchImpl }) {
    return workerCall(base, '/login/status', { method: 'POST', secret, body: { id }, fetchImpl });
}

/** Log in with Discord: close an open login (Cancel), so finishing Discord's page afterwards does nothing. */
export function workerLoginCancel({ base, secret, id, fetchImpl }) {
    return workerCall(base, '/login/cancel', { method: 'POST', secret, body: { id }, fetchImpl });
}
