/*
 * The one place that talks to the network.
 *
 * Non-negotiables enforced here rather than by convention:
 *
 *   1. api.torn.com is the ONLY destination. The base URL is a constant and
 *      callers pass a path, never a URL. No third party ever receives a Torn
 *      key, because no third party can be addressed from this client.
 *   2. The key is never logged. Errors are redacted before they are thrown,
 *      so a stack trace pasted into Discord cannot leak it.
 *   3. Every call goes through one rate-limited queue (85/min by default against
 *      Torn's ~100/min ceiling) with request dedup and exponential backoff.
 *      A key that trips abuse detection is a worse outcome than a slow panel.
 */

import { laneOf, sideOf, laneCap, laneRank } from '../core/lanes.js';
import { gmFetch } from '../platform/gm.js';

export const TORN_API_BASE = 'https://api.torn.com/';

/** Torn error codes worth reacting to specifically. */
export const TORN_ERROR_KEY_INVALID = 2;
export const TORN_ERROR_RATE_LIMIT = 5;
export const TORN_ERROR_IP_BLOCK = 8;
export const TORN_ERROR_UNAVAILABLE = 9;
export const TORN_ERROR_KEY_DISABLED = 13;
export const TORN_ERROR_KEY_PAUSED = 18;

/**
 * Errors that mean "this key must not be used again until the user changes
 * it". Torn's docs: "Multiple requests using invalid keys may result in a
 * temporary IP ban - you must account for this by removing disabled or
 * invalid keys upon error."
 */
export const KEY_DEAD_CODES = new Set([
    TORN_ERROR_KEY_INVALID,
    TORN_ERROR_KEY_DISABLED,
    TORN_ERROR_KEY_PAUSED,
]);

/** Torn's rate block lasts "a small period"; 1-2-4s retries only burn it. */
export const RATE_LIMIT_BACKOFF_MS = 30000;

/**
 * After these answers EVERY tab stops asking Torn for a while (shared through
 * storage): asking through an IP block (8) only lengthens it, and a disabled
 * API (9) or a rate block (5) will not clear in seconds either.
 */
export const TORN_PAUSE_MS = {
    [TORN_ERROR_RATE_LIMIT]: RATE_LIMIT_BACKOFF_MS,
    [TORN_ERROR_IP_BLOCK]: 10 * 60 * 1000,
    [TORN_ERROR_UNAVAILABLE]: 2 * 60 * 1000,
};

/** A hidden tab waiting for a slot checks again this often. */
const HIDDEN_POLL_MS = 1000;

export class TornApiError extends Error {
    constructor(message, { code = null, http = null, paused = false } = {}) {
        super(message);
        this.name = 'TornApiError';
        this.code = code;
        this.http = http;
        /** Refused by this client during a shared pause: nothing was sent. */
        this.paused = paused;
    }
}

function apiSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Strip anything that looks like an API key out of a string before it can
 * reach a console, an alert, or the panel.
 */
export function redactKey(text, key) {
    let out = String(text === null || text === undefined ? '' : text);

    if (key) out = out.split(key).join('<redacted>');

    // Belt and braces: catch a key that arrived from somewhere else.
    return out.replace(/key=[A-Za-z0-9]{8,}/g, 'key=<redacted>');
}

export class TornApiClient {
    /**
     * @param {object} options
     * @param {function(): string} options.getKey - returns the current API key
     * @param {function} [options.fetchImpl]      - injectable for tests
     * @param {number} [options.maxPerMinute]     - request ceiling
     * @param {number} [options.dedupTtlMs]       - reuse identical responses
     * @param {number} [options.maxRetries]
     * @param {function(): number[]} [options.loadWindow] - shared request
     *   timestamps, so every open Torn tab draws on ONE budget. Torn's limit
     *   is per user across all keys; a per-tab window let two tabs make
     *   140/min against a 100/min ceiling.
     * @param {function(number[])} [options.saveWindow]
     * @param {function(number)} [options.addToWindow] - record one slot of
     *   THIS tab (platform/tab-window.js); preferred over saveWindow, which
     *   writes the whole shared array back and can drop another tab's slot
     * @param {function} [options.loadPause] - () => {until, code} shared by every tab
     * @param {function} [options.savePause] - ({until, code}) => void
     * @param {function} [options.isVisible] - () => boolean; a request never
     *   leaves a hidden tab, even one that was queued while it was visible
     * @param {function} [options.isPaused] - () => boolean; true while Torn
     *   Trading runs: nothing is sent (the two scripts take turns)
     */
    constructor({
        getKey,
        fetchImpl = gmFetch,
        maxPerMinute = 70,
        dedupTtlMs = 5000,
        maxRetries = 3,
        loadWindow = null,
        saveWindow = null,
        rateLimitBackoffMs = RATE_LIMIT_BACKOFF_MS,
        loadPause = null,
        savePause = null,
        isVisible = () => true,
        addToWindow = null,
        onDeadKey = null,
        isPaused = () => false,
        focus = null,
        loadLaneWindow = null,
        addLaneWindow = null,
    } = {}) {
        // What's open across the tabs (core/lanes.js): decides which calls go first and each side's share.
        this.focus = focus;
        this.loadLaneWindow = loadLaneWindow;
        this.addLaneWindow = addLaneWindow;
        /** Calls waiting their turn: {lane, run, resolve, reject, n}. */
        this.queue = [];
        this.pumping = false;
        this.queued = 0;
        this.onDeadKey = onDeadKey;
        this.isPaused = isPaused;
        this.addToWindow = addToWindow;
        this.loadPause = loadPause;
        this.savePause = savePause;
        this.isVisible = isVisible;
        this.pause = { until: 0, code: null };
        this.getKey = getKey;
        this.fetchImpl = fetchImpl;
        this.maxPerMinute = maxPerMinute;
        this.dedupTtlMs = dedupTtlMs;
        this.maxRetries = maxRetries;
        this.loadWindow = loadWindow;
        this.saveWindow = saveWindow;
        this.rateLimitBackoffMs = rateLimitBackoffMs;

        /** Timestamps of recent requests, for the sliding window. */
        this.recent = [];
        /** Serialises the queue so the window check cannot race. */
        this.chain = Promise.resolve();
        /** In-flight and recently-completed requests, keyed without the key. */
        this.inflight = new Map();
        this.cache = new Map();
    }

    /** Requests made in the last 60s, and room remaining. */
    stats(now = Date.now()) {
        this.syncWindow(now);
        const window = this.recent.filter((t) => now - t < 60000);
        return {
            usedLastMinute: window.length,
            remaining: Math.max(0, this.maxPerMinute - window.length),
        };
    }

    /**
     * Adopt the shared window: it already holds this tab's own requests,
     * because every slot taken is saved back to it. Replacing rather than
     * merging matters - two requests in the same millisecond are two
     * requests, and a Set of timestamps would count them as one.
     */
    syncWindow(now = Date.now()) {
        if (!this.loadWindow) return;

        let shared;
        try {
            shared = this.loadWindow();
        } catch {
            return;
        }
        if (!Array.isArray(shared)) return;

        this.recent = shared
            .filter((t) => Number.isFinite(t) && now - t < 60000)
            .sort((a, b) => a - b);
    }

    /** The focus now (what's open across the tabs), or null when nobody said. */
    focusNow() {
        try {
            return this.focus ? this.focus() : null;
        } catch {
            return null;
        }
    }

    /** Slots a side (Torn Eye or prices) used in the last minute, across the tabs. */
    sideUsed(side, now = Date.now()) {
        if (!side || !this.loadLaneWindow) return 0;
        try {
            return (this.loadLaneWindow(side) || []).filter((t) => now - t < 60000).length;
        } catch {
            return 0;
        }
    }

    /** Block until the sliding window has room for one more request (and this lane is inside its share). */
    async waitForSlot(lane = 'other') {
        for (;;) {
            const now = Date.now();
            this.syncWindow(now);
            this.recent = this.recent.filter((t) => now - t < 60000);

            // Hidden: take no slot and send nothing until the tab is back.
            if (!this.isVisible()) {
                await apiSleep(HIDDEN_POLL_MS);
                continue;
            }

            // (A side over its share never gets here: the queue passes it over until it has room, see pump().)
            const side = sideOf(lane);

            if (this.recent.length < this.maxPerMinute) {
                if (side && this.addLaneWindow) {
                    try {
                        this.addLaneWindow(side, now);
                    } catch {
                        // Best-effort: the whole-minute window below still limits every call.
                    }
                }
                this.recent.push(now);
                if (this.addToWindow) {
                    try {
                        this.addToWindow(now);
                    } catch {
                        // Best-effort, as below.
                    }
                } else if (this.saveWindow) {
                    try {
                        this.saveWindow(this.recent);
                    } catch {
                        // Sharing the window is best-effort; the local one
                        // still limits this tab.
                    }
                }
                return;
            }

            const oldest = this.recent[0];
            await apiSleep(Math.max(50, 60000 - (now - oldest) + 25));
        }
    }

    /**
     * GET a Torn API path.
     *
     * @param {string} path - e.g. "torn" or "user" or "market/123"
     * @param {object} params - query params; `key` is added here and only here
     */
    async get(path, params = {}, { lane = null } = {}) {
        const cacheKey = path + '?' + new URLSearchParams(params).toString();

        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.at < this.dedupTtlMs) {
            return cached.data;
        }

        const existing = this.inflight.get(cacheKey);
        if (existing) return existing;

        // Wait its turn: the plan first, then what's open (core/lanes.js), in order within a lane.
        const ln = lane || laneOf(path);
        const promise = new Promise((resolve, reject) => {
            this.queue.push({ lane: ln, run: () => this.execute(path, params, cacheKey, ln), resolve, reject, n: this.queued++ });
            this.pump();
        });
        this.inflight.set(cacheKey, promise);

        try {
            const data = await promise;
            this.pruneCache();
            this.cache.set(cacheKey, { at: Date.now(), data });
            return data;
        } finally {
            this.inflight.delete(cacheKey);
        }
    }

    /** Is this lane's side inside its share of the minute (what's open decides the share)? */
    laneHasRoom(lane, focus, used) {
        const side = sideOf(lane);
        if (!side) return true;
        const cap = laneCap(lane, focus, this.maxPerMinute);
        return cap >= this.maxPerMinute || (used[side] || 0) < cap;
    }

    /**
     * Run the queue one call at a time, the best-ranked first. A call whose
     * side has used its share waits in the queue while the others go past it,
     * so one side never holds up another.
     */
    async pump() {
        if (this.pumping) return;
        this.pumping = true;
        try {
            while (this.queue.length) {
                const focus = this.focusNow();
                const now = Date.now();
                const used = { eye: this.sideUsed('eye', now), prices: this.sideUsed('prices', now) };
                let best = -1;
                for (let i = 0; i < this.queue.length; i++) {
                    const a = this.queue[i];
                    if (!this.laneHasRoom(a.lane, focus, used)) continue;
                    if (best < 0) {
                        best = i;
                        continue;
                    }
                    const b = this.queue[best];
                    const ra = laneRank(a.lane, focus, used);
                    const rb = laneRank(b.lane, focus, used);
                    if (ra < rb || (ra === rb && a.n < b.n)) best = i;
                }
                if (best < 0) {
                    // Everything waiting is over its share: look again in a second (the minute rolls on).
                    await apiSleep(1000);
                    continue;
                }
                const job = this.queue.splice(best, 1)[0];
                try {
                    job.resolve(await job.run());
                } catch (error) {
                    job.reject(error);
                }
            }
        } finally {
            this.pumping = false;
        }
    }

    /** The dedup cache is for bursts, not memory; a sweep adds hundreds. */
    pruneCache(now = Date.now()) {
        for (const [k, v] of this.cache) {
            if (now - v.at >= this.dedupTtlMs) this.cache.delete(k);
        }
    }

    /** While Torn Trading runs, nothing goes to Torn (no code: not a key problem). */
    throwIfTakingTurns() {
        if (!this.isPaused || !this.isPaused()) return;
        const e = new TornApiError('Paused while Torn Trading runs.');
        e.takingTurns = true;
        throw e;
    }

    async execute(path, params, cacheKey, lane = 'other') {
        if (!this.fetchImpl) {
            throw new TornApiError('No fetch implementation available.');
        }

        this.throwIfTakingTurns();
        const key = this.getKey ? this.getKey() : '';
        if (!key) {
            // Nothing to send with: not a key Torn refused (no code, so nothing marks a key dead).
            const e = new TornApiError('No API key set.');
            e.noKey = true;
            throw e;
        }

        let attempt = 0;
        let lastError = null;
        // A pause this call started itself (a rate block it is waiting out)
        // does not stop its own retry; a longer one from elsewhere does.
        let mine = 0;

        while (attempt <= this.maxRetries) {
            this.throwIfPaused(mine);
            await this.waitForSlot(lane);
            // Another tab may have hit a block while this one waited.
            this.throwIfPaused(mine);
            this.throwIfTakingTurns();

            try {
                return await this.requestOnce(path, params, key);
            } catch (error) {
                lastError = error;
                // Torn refused this key (2, 13, 18): every part of every tab stops using it.
                if (error instanceof TornApiError && KEY_DEAD_CODES.has(error.code) && this.onDeadKey) {
                    try {
                        this.onDeadKey(error.code);
                    } catch {
                        // best-effort
                    }
                }
                mine = Math.max(mine, this.pauseFor(error));

                if (!this.isRetryable(error) || attempt === this.maxRetries) {
                    throw error;
                }

                // Torn's rate block outlasts a quick retry; wait it out.
                // Otherwise exponential backoff: 1s, 2s, 4s.
                const rateLimited =
                    error instanceof TornApiError &&
                    (error.code === TORN_ERROR_RATE_LIMIT || error.http === 429);

                await apiSleep(
                    rateLimited
                        ? this.rateLimitBackoffMs
                        : 1000 * Math.pow(2, attempt),
                );
                attempt += 1;
            }
        }

        throw lastError;
    }

    /** The shared pause, the later of this tab's and storage's. */
    currentPause(now = Date.now()) {
        let p = this.pause;
        if (this.loadPause) {
            try {
                const s = this.loadPause();
                if (s && Number(s.until) > p.until) p = { until: Number(s.until), code: s.code ?? null };
            } catch {
                // Sharing is best-effort.
            }
        }
        return now < p.until ? p : null;
    }

    throwIfPaused(ignoreUntil = 0) {
        const p = this.currentPause();
        if (!p || p.until <= ignoreUntil) return;
        const secs = Math.ceil((p.until - Date.now()) / 1000);
        const why = p.code === TORN_ERROR_IP_BLOCK ? 'Torn has blocked this IP for a while' : p.code === TORN_ERROR_UNAVAILABLE ? 'the Torn API is down' : 'Torn asked us to slow down';
        throw new TornApiError('Paused: ' + why + '. Trying again in ' + (secs >= 90 ? Math.ceil(secs / 60) + ' min' : secs + 's') + '.', { code: p.code, paused: true });
    }

    /** Start a shared pause after an answer that asking again cannot fix soon. */
    pauseFor(error) {
        const code = error instanceof TornApiError ? error.code : null;
        // Torn's code 5, or an HTTP 429 (no code): every tab slows down, not just this one.
        const rateLimited = code === TORN_ERROR_RATE_LIMIT || (error instanceof TornApiError && error.http === 429);
        const ms = rateLimited ? this.rateLimitBackoffMs : TORN_PAUSE_MS[code];
        if (!ms || error.paused) return 0;
        const until = Date.now() + ms;
        if (until <= this.pause.until) return until;
        this.pause = { until, code };
        if (this.savePause) {
            try {
                this.savePause(this.pause);
            } catch {
                // This tab still pauses.
            }
        }
        return until;
    }

    isRetryable(error) {
        // A shared pause is waited out by the caller, not retried here.
        if (error instanceof TornApiError && error.paused) return false;
        if (error instanceof TornApiError && error.code === TORN_ERROR_UNAVAILABLE) return false;
        if (!(error instanceof TornApiError)) return true;

        if (error.code === TORN_ERROR_RATE_LIMIT) return true;
        if (error.code === TORN_ERROR_UNAVAILABLE) return true;
        if (error.http && error.http >= 500) return true;
        if (error.http === 429) return true;

        // A bad key or an IP block will not fix itself by asking again.
        return false;
    }

    async requestOnce(path, params, key) {
        /*
         * v1 paths take a trailing slash ("torn/?selections=items" is the form
         * verified in game). v2 paths are written without one everywhere they
         * are documented, so they are left exactly as given.
         */
        const clean = String(path).replace(/^\/+/, '');
        const url = new URL(
            /^v2\//.test(clean) ? clean : clean + '/',
            TORN_API_BASE,
        );

        /*
         * A relative path resolves under the base, but an ABSOLUTE one
         * ("https://elsewhere/steal") overrides it entirely — and the key is
         * attached below. The base being a constant is therefore not enough
         * on its own; this is the assertion that actually enforces "one
         * destination".
         */
        if (url.hostname !== 'api.torn.com' || url.protocol !== 'https:') {
            throw new TornApiError(
                'Refusing to send the API key to ' + url.hostname + '.',
            );
        }

        for (const [name, value] of Object.entries(params || {})) {
            if (value === undefined || value === null) continue;
            url.searchParams.set(name, String(value));
        }
        url.searchParams.set('key', key);
        url.searchParams.set('comment', 'PumpingIron');

        let response;
        try {
            response = await this.fetchImpl(url.toString());
        } catch (error) {
            throw new TornApiError(
                'Network error: ' + redactKey(error && error.message, key),
            );
        }

        if (!response.ok) {
            throw new TornApiError('HTTP ' + response.status, {
                http: response.status,
            });
        }

        let data;
        try {
            data = await response.json();
        } catch {
            throw new TornApiError('Torn API returned invalid JSON.');
        }

        /*
         * Errors arrive as HTTP 200 with { error: { code, error } } - and
         * some v2 endpoints are reported to put { code, error } at the top
         * level instead. Read both, or a v2 error looks like an empty result.
         */
        const err =
            data && data.error && typeof data.error === 'object'
                ? data.error
                : data &&
                    Number.isFinite(Number(data.code)) &&
                    typeof data.error === 'string'
                  ? { code: Number(data.code), error: data.error }
                  : null;

        if (err) {
            throw new TornApiError(
                'Torn API ' + err.code + ': ' + redactKey(err.error, key),
                { code: Number(err.code) },
            );
        }

        return data;
    }
}
