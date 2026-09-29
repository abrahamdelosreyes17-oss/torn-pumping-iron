/*
 * Settings › Discord and the plan sync. The plan's next steps go to the
 * user's own Worker when they change (at most once a minute, from a
 * visible tab); the Worker reads Torn and pings Discord.
 */

import { K, get, set } from './platform/store.js';
import { tornClient, isVisible } from './runtime.js';
import { fetchDiscord } from './api/torn.js';
import { workerBase, newSecret, stepsForWorker, workerSync, workerTest, workerForget } from './api/worker.js';

export const SYNC_MIN_MS = 60 * 1000;

export function discordState() {
    const w = get(K.worker, null);
    return w && w.base && w.secret ? w : null;
}

function planPayload(m) {
    if (!m || !m.ready) return null;
    return { type: m.steps.some((s) => s.kind === 'stack' || s.kind === 'jump') ? 'jump' : 'steady', steps: stepsForWorker(m.steps) };
}

/** Your Discord id, if linked in Torn (/user/discord). */
export async function linkedDiscordId() {
    try {
        const d = await fetchDiscord(tornClient());
        return d && d.discord_id ? String(d.discord_id) : null;
    } catch {
        return null;
    }
}

/**
 * First connect (or a change of webhook, key or Discord id).
 * @param {object} f - {base, invite, webhookUrl, tornKey, discordId}
 */
export async function connectDiscord(f, model) {
    const base = workerBase(f.base);
    const prev = discordState();
    const secret = prev && prev.base === base ? prev.secret : newSecret();
    const body = { base, secret, invite: f.invite || null, plan: planPayload(model) };
    if (f.webhookUrl) body.webhookUrl = f.webhookUrl.trim();
    if (f.tornKey) body.tornKey = f.tornKey.trim();
    if (f.discordId) body.discordId = String(f.discordId).replace(/\D/g, '');
    const r = await workerSync(body);
    set(K.worker, { base, secret, discordId: body.discordId || (prev && prev.discordId) || null, connectedAt: Date.now(), lastSync: Date.now(), lastSig: null, ready: Boolean(r.ready) || Boolean(prev && prev.ready), lastError: null });
    return r;
}

export async function testDiscord() {
    const w = discordState();
    if (!w) throw new Error('Connect your Worker first.');
    return workerTest({ base: w.base, secret: w.secret });
}

export async function forgetDiscord() {
    const w = discordState();
    if (w) {
        try {
            await workerForget({ base: w.base, secret: w.secret });
        } catch {
            // Forget here anyway.
        }
    }
    set(K.worker, null);
}

/** After each model refresh: send the plan if its steps changed (≤ once a minute, visible tab only). */
export function maybeSyncPlan(m, now = Date.now()) {
    const w = discordState();
    if (!w || !isVisible()) return false;
    const plan = planPayload(m);
    if (!plan) return false;
    const sig = JSON.stringify(plan.steps.map((s) => [s.kind, s.label, Math.round(s.at / 300)]));
    if (sig === w.lastSig || now - (w.lastSync || 0) < SYNC_MIN_MS) return false;
    set(K.worker, { ...w, lastSync: now, lastSig: sig });
    workerSync({ base: w.base, secret: w.secret, plan })
        .then(() => set(K.worker, { ...(get(K.worker, {}) || {}), lastError: null }))
        .catch((e) => set(K.worker, { ...(get(K.worker, {}) || {}), lastError: String((e && e.message) || e) }));
    return true;
}
