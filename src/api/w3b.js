/*
 * TornW3B (weav3r.dev) - the crowd-sourced bazaar price feed.
 *
 * Torn's API has no per-listing bazaar prices a Public key can trust (the
 * `user -> bazaar` selection can be served days old on a Public key, and the
 * `market -> bazaar` selection is a directory with no prices). TornW3B polls
 * bazaars with keys their SELLERS donated, for their own bazaar only, and
 * publishes the result. TornTools, TornPDA and Weav3r's own script read it.
 *
 * Non-negotiables, enforced here rather than by convention:
 *
 *   1. This client NEVER sees a Torn API key. It has no key parameter, no
 *      getKey, and the only query it ever sends is `comment`. The Torn client
 *      and this one share nothing.
 *   2. weav3r.dev is the only destination - asserted on the resolved URL, not
 *      just implied by a constant, exactly as client.js does for api.torn.com.
 *   3. Its own sliding window, well under TornW3B's 100/min Cloudflare limit,
 *      and a hard cooldown on 429 or a non-JSON (Cloudflare challenge) body.
 *
 * Responses are cached server-side for 60s, so asking faster is pointless.
 */

import { gmFetch } from '../platform/gm.js';

export const W3B_API_BASE = 'https://weav3r.dev/api/';
export const W3B_HOST = 'weav3r.dev';
export const W3B_TERMS_URL = 'https://weav3r.dev/terms-of-service';
export const W3B_SITE_URL = 'https://weav3r.dev';

/** TornW3B enforces 100/min per IP; leave 40 for TornTools and friends. */
export const W3B_MAX_PER_MINUTE = 60;

/**
 * Every tab together: each client's own ceiling only limits itself. The
 * trading app and TornTools draw on the same 100/min per IP, so this app
 * stays well under it (the Buy tab asks for a handful of items).
 */
export const W3B_SHARED_PER_MINUTE = 80;

/** After a 429 or a challenge page, stop asking for this long. */
export const W3B_COOLDOWN_MS = 60000;

export class W3bError extends Error {
    constructor(message, { http = null, blocked = false } = {}) {
        super(message);
        this.name = 'W3bError';
        this.http = http;
        this.blocked = blocked;
    }
}

function w3bSleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export class W3bClient {
    /**
     * @param {object} [options]
     * @param {function} [options.fetchImpl] - injectable for tests
     * @param {number} [options.maxPerMinute]
     * @param {function} [options.now]
     * @param {function} [options.loadShared] - () => {recent: number[], cooldownUntil}
     *   stored for every tab: one window across all of them, and a 429 seen
     *   by one tab stops them all.
     * @param {function} [options.saveShared] - (state) => void
     * @param {function} [options.addShared] - (at) => void: record one slot of
     *   THIS tab only (platform/tab-window.js), so tabs never overwrite each
     *   other's; without it the whole window is written back through saveShared
     * @param {number} [options.sharedPerMinute]
     * @param {function} [options.sleep] - (ms) => Promise; injectable for tests
     * @param {function} [options.isVisible] - () => boolean; nothing is sent
     *   from a hidden tab, even a request queued while it was visible
     */
    constructor({
        fetchImpl = gmFetch,
        maxPerMinute = W3B_MAX_PER_MINUTE,
        now = () => Date.now(),
        loadShared = null,
        saveShared = null,
        sharedPerMinute = W3B_SHARED_PER_MINUTE,
        sleep = w3bSleep,
        isVisible = () => true,
        addShared = null,
    } = {}) {
        this.addShared = addShared;
        this.sleep = sleep;
        this.isVisible = isVisible;
        this.fetchImpl = fetchImpl;
        this.maxPerMinute = maxPerMinute;
        this.now = now;
        this.loadShared = loadShared;
        this.saveShared = saveShared;
        this.sharedPerMinute = sharedPerMinute;
        this.recent = [];
        this.chain = Promise.resolve();
        this.cooldownUntil = 0;
    }

    /** What every tab has used, and any wait one of them was told to make. */
    readShared(t) {
        const out = { recent: [], cooldownUntil: 0 };
        if (!this.loadShared) return out;
        let s;
        try {
            s = this.loadShared();
        } catch {
            return out;
        }
        if (!s || typeof s !== 'object') return out;
        if (Array.isArray(s.recent)) out.recent = s.recent.filter((x) => Number.isFinite(x) && t - x < 60000).sort((a, b) => a - b);
        if (Number.isFinite(Number(s.cooldownUntil))) out.cooldownUntil = Number(s.cooldownUntil);
        return out;
    }

    writeShared(state) {
        if (!this.saveShared) return;
        try {
            this.saveShared(state);
        } catch {
            // Sharing is best-effort; this tab still limits itself.
        }
    }

    /** The later of this tab's wait and any other tab's. */
    blockedUntil(t = this.now()) {
        return Math.max(this.cooldownUntil, this.readShared(t).cooldownUntil);
    }

    stats() {
        const t = this.now();
        const used = this.recent.filter((x) => t - x < 60000).length;
        return {
            usedLastMinute: used,
            remaining: Math.max(0, this.maxPerMinute - used),
            coolingDown: t < this.blockedUntil(t),
            sharedLastMinute: this.loadShared ? this.readShared(t).recent.length : used,
        };
    }

    async waitForSlot() {
        for (;;) {
            // Hidden: take no slot and send nothing until the tab is back.
            if (!this.isVisible()) {
                await this.sleep(1000);
                continue;
            }
            const t = this.now();
            this.recent = this.recent.filter((x) => t - x < 60000);
            const shared = this.readShared(t);
            const sharedFull = this.loadShared && shared.recent.length >= this.sharedPerMinute;

            if (this.recent.length < this.maxPerMinute && !sharedFull) {
                this.recent.push(t);
                if (this.addShared) {
                    try {
                        this.addShared(t);
                    } catch {
                        // Best-effort; this tab still limits itself.
                    }
                } else if (this.loadShared) {
                    this.writeShared({ ...shared, recent: [...shared.recent, t] });
                }
                return;
            }

            // Wait until every full window has a slot again.
            const frees = [];
            if (this.recent.length >= this.maxPerMinute) frees.push(this.recent[this.recent.length - this.maxPerMinute]);
            if (sharedFull) frees.push(shared.recent[shared.recent.length - this.sharedPerMinute]);
            await this.sleep(Math.max(50, 60000 - (t - Math.max(...frees)) + 25));
        }
    }

    /** Stop asking - this tab and, through storage, every other. */
    coolDown() {
        const t = this.now();
        this.cooldownUntil = t + W3B_COOLDOWN_MS;
        if (this.loadShared) this.writeShared({ ...this.readShared(t), cooldownUntil: this.cooldownUntil });
    }

    /** Build and check a URL. Exposed for tests. */
    buildUrl(path) {
        const url = new URL(String(path).replace(/^\/+/, ''), W3B_API_BASE);

        if (url.hostname !== W3B_HOST) {
            throw new W3bError('Refusing to contact ' + url.hostname + '.');
        }

        // Nothing but an attribution comment ever goes in the query.
        url.search = '';
        url.searchParams.set('comment', 'PumpingIron');

        return url;
    }

    /** GET one TornW3B path. Serialised, rate-limited, never keyed. */
    get(path) {
        const run = () => this.execute(path);
        const promise = this.chain.catch(() => {}).then(run);
        this.chain = promise.catch(() => {});
        return promise;
    }

    async execute(path) {
        if (this.now() < this.blockedUntil()) {
            throw new W3bError('TornW3B is rate limiting us; paused briefly.', {
                blocked: true,
            });
        }

        const url = this.buildUrl(path);
        await this.waitForSlot();
        // Another tab may have been blocked while this one waited for a slot.
        if (this.now() < this.blockedUntil()) {
            throw new W3bError('TornW3B is rate limiting us; paused briefly.', {
                blocked: true,
            });
        }

        let response;
        try {
            response = await this.fetchImpl(url.toString());
        } catch (error) {
            throw new W3bError(
                'TornW3B network error: ' + ((error && error.message) || error),
            );
        }

        if (response.status === 429) {
            this.coolDown();
            throw new W3bError('TornW3B rate limit (429).', {
                http: 429,
                blocked: true,
            });
        }

        if (!response.ok) {
            throw new W3bError('TornW3B HTTP ' + response.status, {
                http: response.status,
            });
        }

        try {
            return await response.json();
        } catch {
            // Cloudflare answers a challenge page with HTML, not JSON.
            this.coolDown();
            throw new W3bError('TornW3B returned a non-JSON page (blocked?).', {
                blocked: true,
            });
        }
    }
}

/**
 * Cheapest bazaar price for every item, in one request.
 *
 * @returns {Promise<Array<{itemId: string, name: string, lowestPrice: number|null,
 *   marketPrice: number|null, bazaarAverage: number|null, totalBazaars: number}>>}
 */
export async function fetchW3bSummary(client) {
    const data = await client.get('marketplace');
    const items = data && Array.isArray(data.items) ? data.items : null;

    if (!items) throw new W3bError('TornW3B returned no item summary.');

    return items
        .filter((i) => i && Number.isFinite(Number(i.item_id)))
        .map((i) => ({
            itemId: String(i.item_id),
            name: i.item_name || '',
            lowestPrice: positiveOrNull(i.lowest_price),
            marketPrice: positiveOrNull(i.market_price),
            bazaarAverage: positiveOrNull(i.bazaar_average),
            totalBazaars: Number(i.total_bazaars) || 0,
        }));
}

/**
 * Every bazaar listing TornW3B knows for one item.
 *
 * Retries once when the payload says there are listings but sends none - a
 * known mid-scan glitch. `maxPrice` and friends are deliberately NOT sent:
 * they are not in TornW3B's spec, TornTools filters client-side anyway, and
 * trusting an ignored filter is how a list fills with rows that are not deals.
 *
 * @returns {Promise<{listings: Array, total: number}>} raw listing objects
 */
export async function fetchW3bListings(client, itemId) {
    const path = 'marketplace/' + encodeURIComponent(String(itemId));

    let data = await client.get(path);

    const empty = (d) =>
        d &&
        Number(d.total_listings) > 0 &&
        Array.isArray(d.listings) &&
        d.listings.length === 0;

    if (empty(data)) data = await client.get(path);

    return {
        listings: data && Array.isArray(data.listings) ? data.listings : [],
        total: Number(data && data.total_listings) || 0,
    };
}

function positiveOrNull(value) {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
}
