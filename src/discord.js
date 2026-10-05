/*
 * Settings › Discord (Log in with Discord) and the plan sync. The plan's
 * next steps go to the Pumping Iron service when they change, and at least every 10 minutes (at
 * most once a minute, from a visible tab); the Worker reads Torn and pings
 * Discord. Its answer brings the bot's button presses back ("acks"): a
 * Skip re-times the plan, a Done is information only (the done log still
 * comes from Torn's own state).
 */

import { K, get, set, getKey } from './platform/store.js';
import { tornClient, isVisible } from './runtime.js';
import { isPaused } from './turns.js';
import { fetchDiscord } from './api/torn.js';
import { workerBase, newSecret, stepsForWorker, workerSync, workerTest, workerForget, workerLink, workerLoginStart, workerLoginStatus, workerLoginCancel, DEFAULT_WORKER } from './api/worker.js';
import { gmOpenTab } from './platform/gm.js';
import { normBand } from './core/eye/bands.js';
import { pingsForSync, adoptPings } from './pings.js';
import { discordView, testFailOf, testSentWords } from './core/discord-state.js';
import { logProblem, logNote } from './problem-log.js';

/** Set by the runtime: a Discord skip redraws this tab's model. */
let onSkippedChange = null;
export function onSkipped(fn) {
    onSkippedChange = fn;
}

export const SYNC_MIN_MS = 60 * 1000;

/** A changed ping tick goes sooner than that, but not on every click of a row of ticks. */
export const TICK_SYNC_MIN_MS = 5 * 1000;

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

/* Torn Eye's war and watch list for the Worker (ROUND4-PLAN §B8, §I): the lead sends them with the plan. */
const EYE_SYNC_WAR_MAX = 100;
const EYE_SYNC_WATCH_MAX = 50;

function eyeSyncRow(r, withTag = false) {
    const id = Number(r && r.id);
    if (!(id > 0)) return null;
    const pct = (x) => (x === null || x === undefined || !Number.isFinite(Number(x)) ? null : Math.max(0, Math.min(100, Math.round(Number(x)))));
    const row = { id, name: r.name ? String(r.name).slice(0, 40) : null, level: Number(r.level) > 0 ? Math.round(Number(r.level)) : null, band: normBand(r.band), win: pct(r.win), keep: pct(r.keep) };
    if (withTag) row.tag = r.tag ? String(r.tag).slice(0, 24) : null;
    return row;
}

/**
 * The enemy faction and the watch list, for the bot's war and watch pings (set by the webpage).
 * @param {object} o - {war: {factionId, members:[{id,name,level,band,win,keep}]} | null, watch: [{id,name,level,band,win,keep,tag}] | null}
 */
export function setEyeForSync({ war = null, watch = null } = {}) {
    const w = war && Number(war.factionId) > 0 ? { factionId: Number(war.factionId), members: (war.members || []).map((r) => eyeSyncRow(r)).filter(Boolean).slice(0, EYE_SYNC_WAR_MAX) } : null;
    const list = (watch || []).map((r) => eyeSyncRow(r, true)).filter(Boolean).slice(0, EYE_SYNC_WATCH_MAX);
    const sig = JSON.stringify([w, list]);
    if (sig === sync.eyeSig) return;
    sync.eye = { war: w, watch: list };
    sync.eyeSig = sig;
}

/** What the plan sync can add to its body: {war, watch, sig} (sig changes when either does). */
export function eyeSyncPayload() {
    return { war: sync.eye ? sync.eye.war : null, watch: sync.eye ? sync.eye.watch : [], sig: sync.eyeSig || '' };
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
    const before = JSON.stringify(get(K.skipped, []) || []);
    set(K.skipped, skipped);
    // A step skipped in Discord: this tab's model follows at once (a local write fires no change event here).
    if (JSON.stringify(skipped) !== before && typeof onSkippedChange === 'function') onSkippedChange();
    return ids;
}

/** The Worker stopped pinging (Torn refused its key): said in Settings until a new key is sent. */
function pausedText(r) {
    return r && r.paused ? 'Your Worker paused pings: ' + (r.lastError || 'Torn refused its key') + '. Paste a new key for it.' : null;
}

/**
 * What the service's sync answer says, kept for Settings and the problem report (core/discord-state.js). An older
 * service sends no `delivery`, `tornRead` or `kinds`: those stay null, and Settings says only what it knows.
 */
function answered(r, now = Date.now()) {
    const d = r.delivery && typeof r.delivery === 'object' ? r.delivery : null;
    const tr = r.tornRead && typeof r.tornRead === 'object' ? r.tornRead : null;
    return {
        lastError: pausedText(r),
        paused: Boolean(r.paused),
        pauseText: pausedText(r),
        syncFail: null,
        answerAt: now,
        ready: Boolean(r.ready),
        linked: Boolean(r.linked),
        bot: Boolean(r.bot),
        delivery: d ? { ok: Boolean(d.ok), via: d.via || null, reason: d.reason || null, dmRefusedAt: Number(d.dmRefusedAt) || null, webhook: Boolean(d.webhook) } : null,
        tornRead: tr ? { ok: tr.ok === true ? true : tr.ok === false ? false : null, at: Number(tr.at) || null, travel: tr.travel !== false, since: Number(tr.since) || null, code: tr.code === undefined ? null : tr.code, error: tr.error ? String(tr.error).slice(0, 200) : null } : null,
        kinds: r.kinds && typeof r.kinds === 'object' ? r.kinds : null,
    };
}

/** A change for the worse in what the service says goes to the problem log, once (not at every sync). */
function logAnswer(was, now) {
    const v0 = discordView(was);
    const v1 = discordView(now);
    if (!v1 || (v0 && v0.key === v1.key)) return;
    if (v1.key === 'ok') {
        if (v0 && v0.key !== 'waiting') logNote('Discord pings work again', 'was: ' + v0.tag);
        return;
    }
    if (v1.key === 'waiting') return;
    logProblem('error', 'Discord pings: ' + (v1.title || v1.tag), v1.text);
}

/** What's stored about the service, connected or not (a login may be under way). */
export function discordRaw() {
    const w = get(K.worker, null);
    return w && w.base && w.secret ? w : null;
}

/** A connected service (logged in with Discord, or your own service set up): only then is anything synced. */
export function discordState() {
    const w = discordRaw();
    return w && (w.discordName || w.connectedAt) ? w : null;
}

/**
 * The plan the Worker pings from. Stacking for a chain (round 7, Home's "I'm stacking"): `chain: {since}` (unix
 * seconds) and no steps, so the bot sends nothing about energy or training (worker/src/alerts.js) and /today lists
 * nothing until Resume. Not the jump plan's stack (`type: 'jump'`): that one is part of a training plan.
 */
export function planPayload(m, keep = []) {
    if (!m || !m.ready) return null;
    // type 'jump' + noRefill: a Worker from before round 7 ignores chain but still holds back the energy-full and refill pings.
    // Overdosed (the one stored state, m.overdose): no steps either, and the bot says "Overdosed · fly to Switzerland" once.
    // `keep`: the energy and training pings ticked back on by hand during it (Settings › Discord pings); the bot sends those.
    const kept = keep && keep.length ? { keep: [...keep] } : {};
    if (m.overdose) return { type: 'jump', noRefill: true, steps: [], overdose: { at: Math.floor(m.overdose.at / 1000), until: Math.floor(m.overdose.until / 1000), ...kept } };
    if (m.stacking) return { type: 'jump', noRefill: true, steps: [], chain: { since: Math.floor(m.stacking.since / 1000), ...kept } };
    return { type: m.steps.some((s) => s.kind === 'stack' || s.kind === 'jump') ? 'jump' : 'steady', steps: stepsForWorker(m.upcoming || m.steps), ...(m.noRefill ? { noRefill: true } : {}) };
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
    if (f.tornKey && [getKey(K.ffsKey), getKey(K.tsKey), getKey(K.fullKey)].filter(Boolean).includes(f.tornKey.trim())) throw new Error('That is your FFScouter, TornStats or Full key. Use a Torn key made for Pumping Iron (Limited, or a custom key with user: basic, bars, cooldowns, refills, travel).');
    const prev = discordState();
    // A new address: the old Worker forgets you (best-effort), so your key and webhook don't stay there.
    if (prev && prev.base !== base) {
        try {
            await workerForget({ base: prev.base, secret: prev.secret });
        } catch {
            // It may be gone already.
        }
    }
    const secret = prev && prev.base === base ? prev.secret : newSecret();
    const ticks = pingsForSync(model);
    const body = { base, secret, invite: f.invite || null, plan: planPayload(model, ticks.keep), rules: ticks.rules, rulesAt: ticks.rulesAt };
    if (f.webhookUrl) body.webhookUrl = f.webhookUrl.trim();
    if (f.tornKey) body.tornKey = f.tornKey.trim();
    if (f.discordId) body.discordId = String(f.discordId).replace(/\D/g, '');
    const r = await workerSync(body);
    set(K.worker, { base, secret, discordId: body.discordId || (prev && prev.discordId) || null, connectedAt: Date.now(), lastSync: Date.now(), lastSig: null, ...answered(r), ready: Boolean(r.ready) || Boolean(prev && prev.ready) });
    adoptPings(r.kindsSet);
    return r;
}

/** A short fingerprint of the main key, so a changed key is sent again (the key itself isn't copied). */
export function keyTag(key) {
    let h = 2166136261;
    for (const c of String(key || '')) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
    return key ? h.toString(36) : '';
}

/** How long Log in with Discord waits for you on Discord's page, and how often it asks. */
export const LOGIN_WAIT_MS = 15 * 60 * 1000;
export const LOGIN_POLL_MS = 3000;

const LOGIN_FAIL = {
    not_member: 'You’re not in the Pumping Iron Discord server yet. Ask whoever runs it for an invite, then log in again.',
    denied: 'You cancelled on Discord. Press Log in with Discord again whenever you like.',
    full: 'The Pumping Iron service is full. Ask whoever runs it.',
    failed: 'Discord didn’t finish the login. Try again in a minute.',
    expired: 'The login timed out. Press Log in with Discord again.',
    elsewhere: 'This Discord account is already connected to Pumping Iron in another browser. Press Disconnect there, or type /unlink in Discord, then log in here again.',
};

/**
 * Log in with Discord: open Discord's page in a new tab, wait until you've
 * said yes there, then connect this browser: the plan and your Torn key go to
 * the service (encrypted there), and pings start. Being a member of the
 * Pumping Iron Discord server is what lets you in. The same browser secret is
 * kept across tries, so a second try (or a login finished after Cancel) lands
 * on the same row on the service.
 * @param {object} model
 * @param {object} [o] - {onUpdate(text), base (your own service), sleep, open}
 * @returns {Promise<{ok:boolean, name?:string, text:string}>}
 */
export async function loginDiscord(model, { onUpdate = () => {}, base: baseIn = null, sleep = defaultSleep, open = gmOpenTab } = {}) {
    const prev = discordRaw();
    const base = workerBase(baseIn || (prev && prev.base) || DEFAULT_WORKER);
    const secret = prev && prev.base === base ? prev.secret : newSecret();
    let start;
    try {
        start = await workerLoginStart({ base, secret });
    } catch (e) {
        logProblem('error', 'Discord login could not start', String((e && e.message) || e) + (e && e.http ? ' [http ' + e.http + ']' : ''));
        throw e;
    }
    // Only an address on the service itself is opened (it sends you on to discord.com).
    let url = null;
    try {
        url = new URL(String(start.url));
    } catch {
        url = null;
    }
    if (!url || url.origin !== base) throw new Error('The service answered with an unexpected address.');
    set(K.worker, { ...(prev && prev.base === base ? prev : {}), base, secret, login: { id: start.id, at: Date.now() } });
    open(url.toString());
    onUpdate('Waiting for you on Discord…');
    return pollLogin(model, { sleep });
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Only one wait loop per tab (a reload resumes it; a second click doesn't start another). */
let polling = null;

/**
 * Wait for the login stored in `K.worker.login` (started here, or before a
 * reload) and finish it.
 */
export function pollLogin(model, { sleep = defaultSleep } = {}) {
    if (polling) return polling;
    polling = pollLoginOnce(model, { sleep }).finally(() => {
        polling = null;
    });
    return polling;
}

async function pollLoginOnce(model, { sleep }) {
    const first = discordRaw();
    if (!first || !first.login) return { ok: false, text: 'No login to wait for.' };
    let { base, secret } = first;
    let id = first.login.id;
    let until = (first.login.at || Date.now()) + LOGIN_WAIT_MS;
    while (Date.now() < until) {
        await sleep(LOGIN_POLL_MS);
        const w = discordRaw();
        // Cancelled here.
        if (!w || !w.login) return { ok: false, text: 'Login cancelled.' };
        // Another login started meanwhile (Cancel, then Log in again): wait for that one instead.
        if (w.login.id !== id) {
            ({ base, secret } = w);
            id = w.login.id;
            until = (w.login.at || Date.now()) + LOGIN_WAIT_MS;
            continue;
        }
        let st;
        try {
            st = await workerLoginStatus({ base, secret, id });
        } catch (e) {
            if (e && e.http === 404) return finishLogin(false, LOGIN_FAIL.expired, 'expired');
            continue; // A blip: ask again.
        }
        if (st.state === 'open') continue;
        if (st.state !== 'done') return finishLogin(false, LOGIN_FAIL[st.state] || LOGIN_FAIL.failed, String(st.state || 'failed'));
        // In. Saved first: if the first sync fails, the next minute's sync sends the plan and the key (no keyTag yet).
        // A new login starts afresh: what the service said before, and a failed test ping, are forgotten.
        set(K.worker, { ...(discordRaw() || {}), base, secret, login: null, discordName: st.name || null, keyTag: null, connectedAt: Date.now(), lastSync: 0, lastSig: null, lastError: null, paused: false, pauseText: null, syncFail: null, delivery: null, tornRead: null, kinds: null, testFail: null, testOkAt: null });
        const key = getKey(K.apiKey);
        const statics = get(K.userStatic, {}) || {};
        const ki = statics.keyInfo || {};
        const ticks = pingsForSync(model);
        const body = { base, secret, plan: planPayload(model, ticks.keep), rules: ticks.rules, rulesAt: ticks.rulesAt };
        if (key) body.tornKey = key;
        if (ki.userId) body.playerId = ki.userId;
        if (ki.factionId !== undefined) body.factionId = ki.factionId || null;
        try {
            const r = await workerSync(body);
            set(K.worker, { ...(discordRaw() || {}), ...answered(r), keyTag: keyTag(key), lastSync: Date.now() });
            adoptPings(r.kindsSet);
        } catch (e) {
            const text = String((e && e.message) || e);
            set(K.worker, { ...(discordRaw() || {}), lastError: 'First sync failed (' + text + '); it tries again within a minute.', syncFail: { at: Date.now(), text, http: (e && e.http) || null } });
            logProblem('error', 'Discord: the first sync after the login failed', text + (e && e.http ? ' [http ' + e.http + ']' : ''));
        }
        return { ok: true, name: st.name || null, text: 'Connected as ' + (st.name || 'you') + '. Pings come as DMs from the Pumping Iron bot.' };
    }
    return finishLogin(false, LOGIN_FAIL.expired, 'expired');
}

/** A login that didn't finish: the browser secret stays (the next try reuses it), nothing is connected. */
function endLogin() {
    const w = discordRaw();
    if (w) set(K.worker, { ...w, login: null });
}

function finishLogin(ok, text, state = null) {
    endLogin();
    // How a login ended, when not well: not_member, denied, full, elsewhere, expired, failed.
    if (!ok) logProblem('error', 'Discord login ended: ' + (state || 'failed'), text);
    return { ok, text };
}

/** Stop waiting for a login (the Cancel button); the service closes it too, so finishing Discord's page later does nothing. */
export function cancelLogin() {
    const w = discordRaw();
    if (w && w.login) workerLoginCancel({ base: w.base, secret: w.secret, id: w.login.id }).catch(() => {});
    endLogin();
}

/** After a reload in the middle of a login: keep waiting for it (at most until it expires). */
export function resumeLogin(model) {
    const w = discordRaw();
    if (!w || !w.login) return null;
    if (Date.now() - (w.login.at || 0) >= LOGIN_WAIT_MS) {
        endLogin();
        return null;
    }
    return pollLogin(model);
}

/** Link Discord: a one-time code from your Worker (on a click only; never stored). */
export async function linkDiscord() {
    const w = discordState();
    if (!w) throw new Error('Connect your Worker first.');
    const r = await workerLink({ base: w.base, secret: w.secret });
    return { code: String(r.code || ''), expiresAt: Number(r.expiresAt) || Math.floor(Date.now() / 1000) + 600 };
}

/**
 * Send a test ping. What came of it is kept (Settings says what to do, the report says what happened): a failure
 * with the service's reason, and what it means for where pings go now.
 * @returns {Promise<{ok: true, via: string|null, dmRefused?: boolean, text: string}>} throws an Error with words for the player
 */
export async function testDiscord() {
    const w = discordState();
    if (!w) throw new Error('Connect your Worker first.');
    const nowS = () => Math.floor(Date.now() / 1000);
    const keep = (patch) => {
        const cur = get(K.worker, null);
        if (cur && cur.secret === w.secret) set(K.worker, { ...cur, ...patch(cur) });
    };
    let r;
    try {
        r = await workerTest({ base: w.base, secret: w.secret });
    } catch (e) {
        const fail = testFailOf(e);
        logProblem('error', 'Discord test ping failed: ' + fail.reason, String((e && e.message) || e) + (e && e.http ? ' [http ' + e.http + ']' : ''));
        keep((cur) => ({
            testFail: { at: Date.now(), reason: fail.reason, http: (e && e.http) || null, text: String((e && e.message) || e) },
            // A service that tells where pings go: a refused DM is known at once, not at the next sync.
            ...(cur.delivery && fail.reason === 'dm_refused' ? { delivery: { ...cur.delivery, ok: false, via: null, reason: 'dm_refused', dmRefusedAt: nowS() } } : {}),
        }));
        throw new Error(fail.text);
    }
    const viaHook = r.via === 'hook';
    if (r.dmRefused) logProblem('error', 'Discord test ping: the bot’s DM was refused', 'it went to the channel webhook instead');
    keep((cur) => ({
        testFail: null,
        testOkAt: Date.now(),
        testVia: r.via || null,
        ...(cur.delivery ? { delivery: viaHook ? { ...cur.delivery, ok: true, via: 'channel', reason: null, webhook: true, ...(r.dmRefused ? { dmRefusedAt: nowS() } : {}) } : { ...cur.delivery, ok: true, via: 'dm', reason: null, dmRefusedAt: null } } : {}),
    }));
    return { ...r, text: testSentWords(r, !w.discordName) };
}

export async function forgetDiscord() {
    const w = discordRaw();
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
    // The ping ticks (Settings › Discord pings) go with every sync: which kinds are on, and when each was set by hand.
    const ticks = pingsForSync(m, now);
    const plan = planPayload(m, ticks.keep);
    if (!plan) return false;
    const ticksSig = JSON.stringify([ticks.rules, ticks.rulesAt, ticks.keep]);
    // "I'm stacking" and Resume change it too; so does a tick.
    const sig = JSON.stringify([plan.chain ? plan.chain.since : 0, plan.overdose ? plan.overdose.at : 0, plan.steps.map((s) => [s.kind, s.label, Math.round(s.at / 300)]), ticksSig]);
    const pendingAcks = w.pendingAcks || [];
    const targetsDue = sync.targets && sync.targetsSig !== w.targetsSig && now - (w.targetsAt || 0) >= TARGETS_EVERY_MS;
    // Logged in with Discord: a new main key goes along once (the service pauses pings on a refused key until then).
    const key = getKey(K.apiKey);
    const tag = keyTag(key);
    const keyDue = Boolean(w.discordName && key && w.keyTag !== tag);
    // Torn Eye's war and watch lists (bands, win %): whenever they change, so the bot's advance pings use today's estimates.
    const eye = eyeSyncPayload();
    const eyeDue = Boolean(eye.sig) && eye.sig !== w.eyeSig;
    const due = sig !== w.lastSig || now - (w.lastSync || 0) >= SYNC_EVERY_MS || pendingAcks.length > 0 || targetsDue || keyDue || eyeDue;
    // "I'm stacking" and Resume go at once, not behind the one-a-minute gate (a ping could slip out in that minute).
    // An overdose seen (or over) goes at once too.
    const chainFlip = (plan.chain ? plan.chain.since : 0) !== (w.lastChain || 0) || (plan.overdose ? plan.overdose.at : 0) !== (w.lastOverdose || 0);
    // A tick changed (by hand, or a mode moved it): a few seconds on, not a minute, so the bot follows what Settings shows.
    const tickFlip = w.lastTicks !== undefined && ticksSig !== w.lastTicks && now - (w.lastSync || 0) >= TICK_SYNC_MIN_MS;
    if (!due || (!chainFlip && !tickFlip && now - (w.lastSync || 0) < SYNC_MIN_MS)) return false;
    const statics = get(K.userStatic, {}) || {};
    const ki = statics.keyInfo || {};
    const body = { base: w.base, secret: w.secret, plan, ackIds: pendingAcks, rules: ticks.rules, rulesAt: ticks.rulesAt };
    if (ki.userId) body.playerId = ki.userId;
    if (ki.factionId !== undefined) body.factionId = ki.factionId || null;
    if (targetsDue) body.targets = sync.targets;
    if (keyDue) body.tornKey = key;
    if (eyeDue) {
        body.war = eye.war;
        body.watch = eye.watch;
    }
    set(K.worker, { ...w, lastSync: now, lastSig: sig, lastTicks: ticksSig, lastChain: plan.chain ? plan.chain.since : 0, lastOverdose: plan.overdose ? plan.overdose.at : 0, pendingAcks: [], ...(targetsDue ? { targetsSig: sync.targetsSig, targetsAt: now } : {}), ...(keyDue ? { keyTag: tag } : {}), ...(eyeDue ? { eyeSig: eye.sig } : {}) });
    workerSync(body)
        .then((r) => {
            const acked = applyAcks(r.acks, Date.now());
            const was = get(K.worker, {}) || {};
            const next = { ...was, ...answered(r), pendingAcks: acked };
            set(K.worker, next);
            logAnswer(was, next);
            // A kind switched with /settings in Discord: the ticks take it over (the next sync tells the service it was seen).
            adoptPings(r.kindsSet);
        })
        // Failed: the plan counts as unsent (next minute tries again); the acks wait too.
        .catch((e) => {
            // The service forgot this browser (Disconnect elsewhere, /unlink in Discord, or 30 days without a sync): disconnected here too.
            const cur = get(K.worker, null);
            if (e && e.http === 403 && cur && cur.secret === w.secret && !cur.login && (cur.discordName || cur.connectedAt)) {
                set(K.worker, { base: w.base, secret: w.secret, login: null, lastError: 'The Pumping Iron service no longer knows this browser (/unlink, or 30 days without a sync). ' + (cur.discordName ? 'Log in with Discord again.' : 'Connect your service again.') });
                logProblem('error', 'Discord: the service no longer knows this browser', 'disconnected here · ' + String((e && e.message) || e));
                return;
            }
            // In the problem log once per distinct error, not every minute it lasts.
            const text = String((e && e.message) || e);
            const before = (cur && cur.syncFail) || null;
            if (!before || before.text !== text) logProblem('error', 'Discord sync failed: ' + text, e && e.http ? 'http ' + e.http : null);
            set(K.worker, { ...(cur || {}), lastError: text, syncFail: before && before.text === text ? before : { at: Date.now(), text, http: (e && e.http) || null }, pendingAcks, lastSig: w.lastSig, lastTicks: w.lastTicks, ...(keyDue ? { keyTag: w.keyTag } : {}), ...(eyeDue ? { eyeSig: w.eyeSig } : {}) });
        });
    return true;
}

let tickSyncTimer = null;

/**
 * A ping tick was changed by hand: synced now, or a few seconds on when a sync has just gone (so the bot follows
 * what the ticks show without waiting for the next read of Torn).
 * @param {Function} model - () => the model, read again when the timer runs
 */
export function syncTicksSoon(model, wait = TICK_SYNC_MIN_MS + 250) {
    if (maybeSyncPlan(model())) return true;
    clearTimeout(tickSyncTimer);
    tickSyncTimer = setTimeout(() => maybeSyncPlan(model()), wait);
    if (tickSyncTimer && typeof tickSyncTimer.unref === 'function') tickSyncTimer.unref();
    return false;
}
