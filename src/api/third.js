/*
 * A client for one keyed third party (FFScouter, TornStats): one host,
 * asserted on the resolved URL; its own per-minute window shared across
 * tabs; a pause when the service says so; nothing from a hidden tab; the
 * key redacted from every error. The Torn key never reaches these clients:
 * each holds only the key its own service issued (or already has).
 */

import { gmFetch } from '../platform/gm.js';

export class ThirdPartyError extends Error {
    constructor(message, { service = '', http = null, code = null, paused = false, retryAfterS = null, deadKey = false } = {}) {
        super(message);
        this.name = 'ThirdPartyError';
        this.service = service;
        this.http = http;
        this.code = code;
        this.paused = paused;
        this.retryAfterS = retryAfterS;
        this.deadKey = deadKey;
    }
}

function tpSleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}

export function redactThirdKey(text, key) {
    let out = String(text === null || text === undefined ? '' : text);
    if (key) out = out.split(key).join('<redacted>');
    return out.replace(/key=[A-Za-z0-9_-]{8,}/g, 'key=<redacted>');
}

export class ThirdPartyClient {
    /**
     * @param {object} o
     * @param {string} o.service - name for messages
     * @param {string} o.host - the only hostname this client may reach
     * @param {function} o.getKey - () => this service's key
     * @param {number} [o.maxPerMinute]
     * @param {function} [o.fetchImpl]
     * @param {function} [o.now]
     * @param {function} [o.sleep]
     * @param {function} [o.isVisible]
     * @param {function} [o.loadShared] - () => {recent:number[], pauseUntil}
     * @param {function} [o.saveShared]
     */
    constructor({ service, host, getKey, maxPerMinute = 30, fetchImpl = gmFetch, now = () => Date.now(), sleep = tpSleep, isVisible = () => true, loadShared = null, saveShared = null }) {
        this.service = service;
        this.host = host;
        this.getKey = getKey;
        this.maxPerMinute = maxPerMinute;
        this.fetchImpl = fetchImpl;
        this.now = now;
        this.sleep = sleep;
        this.isVisible = isVisible;
        this.loadShared = loadShared;
        this.saveShared = saveShared;
        this.recent = [];
        this.pauseUntil = 0;
        this.chain = Promise.resolve();
        this.dead = false;
    }

    shared() {
        try {
            const s = this.loadShared ? this.loadShared() : null;
            return s && typeof s === 'object' ? s : {};
        } catch {
            return {};
        }
    }

    writeShared(s) {
        try {
            if (this.saveShared) this.saveShared(s);
        } catch {
            // best-effort
        }
    }

    window(t) {
        const s = this.shared();
        const list = Array.isArray(s.recent) ? s.recent : this.recent;
        return list.filter((x) => Number.isFinite(x) && t - x < 60000).sort((a, b) => a - b);
    }

    pausedUntil() {
        return Math.max(this.pauseUntil, Number(this.shared().pauseUntil) || 0);
    }

    stats() {
        const t = this.now();
        const used = this.window(t).length;
        return { usedLastMinute: used, remaining: Math.max(0, this.maxPerMinute - used), paused: t < this.pausedUntil() };
    }

    pause(seconds) {
        this.pauseUntil = this.now() + Math.max(1, seconds) * 1000;
        this.writeShared({ ...this.shared(), recent: this.window(this.now()), pauseUntil: this.pauseUntil });
    }

    async waitForSlot() {
        for (;;) {
            if (!this.isVisible()) {
                await this.sleep(1000);
                continue;
            }
            const t = this.now();
            const w = this.window(t);
            if (w.length < this.maxPerMinute) {
                w.push(t);
                this.recent = w;
                this.writeShared({ ...this.shared(), recent: w });
                return;
            }
            await this.sleep(Math.max(50, 60000 - (t - w[w.length - this.maxPerMinute]) + 25));
        }
    }

    /** Check a URL before anything is sent: right host, https. Exposed for tests. */
    checkUrl(url) {
        const u = new URL(url);
        if (u.hostname !== this.host || u.protocol !== 'https:') throw new ThirdPartyError('Refusing to contact ' + u.hostname + '.', { service: this.service });
        return u;
    }

    /** One request: queued, rate-limited, host-checked, key-redacted. `build(key)` returns the URL. */
    request(build, init = {}) {
        const run = () => this.execute(build, init);
        const p = this.chain.catch(() => {}).then(run);
        this.chain = p.catch(() => {});
        return p;
    }

    async execute(build, init) {
        const key = this.getKey ? this.getKey() : '';
        if (!key) throw new ThirdPartyError('No ' + this.service + ' key saved.', { service: this.service, deadKey: true });
        if (this.dead) throw new ThirdPartyError(this.service + ' rejected this key. Save a new one.', { service: this.service, deadKey: true });
        const paused = () => {
            if (this.now() < this.pausedUntil()) {
                const s = Math.ceil((this.pausedUntil() - this.now()) / 1000);
                throw new ThirdPartyError(this.service + ' asked us to wait ' + s + ' s.', { service: this.service, paused: true, retryAfterS: s });
            }
        };
        paused();
        const url = this.checkUrl(build(key)).toString();
        await this.waitForSlot();
        paused();
        let res;
        try {
            res = await this.fetchImpl(url, init);
        } catch (e) {
            throw new ThirdPartyError(this.service + ' network error: ' + redactThirdKey(e && e.message, key), { service: this.service });
        }
        let body = null;
        try {
            body = await res.json();
        } catch {
            body = null;
        }
        return { status: res.status, ok: res.ok, body, key };
    }
}
