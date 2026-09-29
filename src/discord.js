/*
 * Settings › Discord and the plan sync. The plan's next steps go to the
 * user's own Worker when they change, and at least every 10 minutes (at
 * most once a minute, from a visible tab); the Worker reads Torn and pings
 * Discord. Its answer brings the bot's button presses back ("acks"): a
 * Skip re-times the plan, a Done is information only (the done log still
 * comes from Torn's own state).
 */

import { K, get, set, getKey } from './platform/store.js';
import { tornClient, isVisible } from './runtime.js';
import { isPaused } from './turns.js';
import { fetchDiscord } from './api/torn.js';
import { workerBase, newSecret, stepsForWorker, workerSync, workerTest, workerForget, workerLink } from './api/worker.js';

export const SYNC_MIN_MS = 60 * 1000;

/** Sync at least this often while a tab is visible (a plan not synced for 12 h is "out of date" on the Worker). */
export const SYNC_EVERY_MS = 10 * 60 * 1000;

/** Torn Eye's list goes to the Worker at most this often, and only when it changed. */
export const TARGETS_EVERY_MS = 5 * 60 * 1000;

/** A skipped step stays skipped this long. */
export const SKIP_KEEP_MS = 24 * 60 * 60 * 1000;

const sync = { targets: null, targetsSig: '', targetsSentAt: 0 };

/** Torn Eye's current list and bands, for the bot's /targets, /target and /war (set by the webpage). */
export function setTargetsForSync(list, bands) {
    const t = { list: (list || []).slice(0, 50), bands: Object.fromEntries(Object.entries(bands || {}).slice(0, 500)) };
    const sig = JSON.stringify(t);
    if (sig === sync.targetsSig) return;
    sync.targets = t;
    sync.targetsSig = sig;
}

/** Steps the player skipped in Discord (the Worker's acks), still in force. */
export function skippedSteps(now = Date.now()) {
    return (get(K.skipped, []) || []).filter((x) => now - x.at < SKIP_KEEP_MS);
}

/** Apply acks from the Worker: skips are remembered (the plan drops that step); done is only acknowledged. */
export function applyAcks(acks, now = Date.now()) {
    const skipped = skippedSteps(now);
    const ids = [];
    for (const a of acks || []) {
        if (!a || !a.id) continue;
        ids.push(a.id);
        if (a.kind === 'skip' && a.step && a.step.kind !== 'test') skipped.push({ at: now, stepAt: Number(a.step.at) * 1000, kind: a.step.kind, label: a.step.label || null });
    }
    set(K.skipped, skipped);
    return ids;
}

/** The Worker stopped pinging (Torn refused its key): said in Settings until a new key is sent. */
function pausedText(r) {
    return r && r.paused ? 'Your Worker paused pings: ' + (r.lastError || 'Torn refused its key') + '. Paste a new key for it.' : null;
}

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
    if (f.tornKey && [getKey(K.apiKey), getKey(K.ffsKey), getKey(K.tsKey)].filter(Boolean).includes(f.tornKey.trim())) throw new Error('That is your main key. Make a separate custom key for the Worker (user: basic, bars, cooldowns, refills, travel · faction: members, chain, wars · market: itemmarket).');
    const prev = discordState();
    const secret = prev && prev.base === base ? prev.secret : newSecret();
    const body = { base, secret, invite: f.invite || null, plan: planPayload(model) };
    if (f.webhookUrl) body.webhookUrl = f.webhookUrl.trim();
    if (f.tornKey) body.tornKey = f.tornKey.trim();
    if (f.discordId) body.discordId = String(f.discordId).replace(/\D/g, '');
    const r = await workerSync(body);
    set(K.worker, { base, secret, discordId: body.discordId || (prev && prev.discordId) || null, connectedAt: Date.now(), lastSync: Date.now(), lastSig: null, ready: Boolean(r.ready) || Boolean(prev && prev.ready), linked: Boolean(r.linked), bot: Boolean(r.bot), lastError: pausedText(r) });
    return r;
}

/** Link Discord: a one-time code from your Worker (on a click only; never stored). */
export async function linkDiscord() {
    const w = discordState();
    if (!w) throw new Error('Connect your Worker first.');
    const r = await workerLink({ base: w.base, secret: w.secret });
    return { code: String(r.code || ''), expiresAt: Number(r.expiresAt) || Math.floor(Date.now() / 1000) + 600 };
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

/**
 * After each model refresh: send the plan when its steps changed, at least
 * every 10 minutes, and right after an answer that carried acks (never more
 * than once a minute; visible tab only; not while Torn Trading runs).
 */
export function maybeSyncPlan(m, now = Date.now()) {
    const w = discordState();
    // While Torn Trading runs the plan is only the last read moving on the clock: don't send it.
    if (!w || !isVisible() || isPaused()) return false;
    const plan = planPayload(m);
    if (!plan) return false;
    const sig = JSON.stringify(plan.steps.map((s) => [s.kind, s.label, Math.round(s.at / 300)]));
    const pendingAcks = w.pendingAcks || [];
    const targetsDue = sync.targets && sync.targetsSig !== w.targetsSig && now - (w.targetsAt || 0) >= TARGETS_EVERY_MS;
    const due = sig !== w.lastSig || now - (w.lastSync || 0) >= SYNC_EVERY_MS || pendingAcks.length > 0 || targetsDue;
    if (!due || now - (w.lastSync || 0) < SYNC_MIN_MS) return false;
    const statics = get(K.userStatic, {}) || {};
    const ki = statics.keyInfo || {};
    const body = { base: w.base, secret: w.secret, plan, ackIds: pendingAcks };
    if (ki.userId) body.playerId = ki.userId;
    if (ki.factionId !== undefined) body.factionId = ki.factionId || null;
    if (targetsDue) body.targets = sync.targets;
    set(K.worker, { ...w, lastSync: now, lastSig: sig, pendingAcks: [], ...(targetsDue ? { targetsSig: sync.targetsSig, targetsAt: now } : {}) });
    workerSync(body)
        .then((r) => {
            const acked = applyAcks(r.acks, Date.now());
            set(K.worker, { ...(get(K.worker, {}) || {}), lastError: pausedText(r), ready: Boolean(r.ready), linked: Boolean(r.linked), bot: Boolean(r.bot), pendingAcks: acked });
        })
        .catch((e) => set(K.worker, { ...(get(K.worker, {}) || {}), lastError: String((e && e.message) || e), pendingAcks }));
    return true;
}
