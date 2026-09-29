/*
 * The live state feed. Exactly one VISIBLE Torn/app tab (the leader) asks
 * Torn for the user's state every 30 s and stores it; every other tab reads
 * the stored copy through GM change events. Hidden tabs ask nothing (Torn's
 * rules; trading's leader pattern). Slower data (perks, property, gyms,
 * inventory, key info) refreshes on its own clock, still only from the leader.
 *
 * Everything the feed needs is injected, so tests drive it with a fake
 * clock, store and client.
 */

import { decideLeader } from '../core/leader.js';
import { normalizeState, diffStates, tornDayStart } from '../core/bars.js';
import { logFromDiff } from '../core/plan.js';
import { totalOf } from '../core/gain.js';
import { calibrationSample, addCalibration } from '../core/calibration.js';
import { mergeLiveGyms, GYMS } from '../core/gyms.js';
import { parsePerks } from '../core/perks.js';
import { fetchUserState, fetchPerks, fetchProperty, fetchGyms, fetchInventory, fetchKeyInfo } from '../api/torn.js';
import { KEY_DEAD_CODES } from '../api/client.js';

export const STATE_POLL_MS = 30000;

/** After a failed state call, wait this long before asking again (not every 3 s heartbeat). */
export const STATE_RETRY_MS = 30000;

/** Torn's "access level too low": this key never gets the state, so the feed waits for a new key. */
export const ACCESS_TOO_LOW = 16;

/** How often each slower part refreshes. */
export const STATIC_EVERY = {
    perks: 60 * 60 * 1000,
    property: 6 * 60 * 60 * 1000,
    gyms: 24 * 60 * 60 * 1000,
    inventory: 30 * 60 * 1000,
    keyInfo: 24 * 60 * 60 * 1000,
};

export class StateFeed {
    /**
     * @param {object} o
     * @param {object} o.client - TornApiClient
     * @param {object} o.store - {get(key, fallback), set(key, value)}
     * @param {string} o.tabId
     * @param {function} [o.now]
     * @param {function} [o.isVisible]
     * @param {function} [o.nextStep] - () => the plan's next step (names a drug taken)
     * @param {function} [o.onState] - (state, api) => void, after each poll
     * @param {function} [o.onError] - (error) => void
     * @param {object} [o.keys] - store keys {state, static, log, leader, history}
     */
    constructor({ client, store, tabId, now = () => Date.now(), isVisible = () => true, nextStep = () => null, onState = () => {}, onError = () => {}, keys = {} }) {
        this.client = client;
        this.store = store;
        this.tabId = tabId;
        this.now = now;
        this.isVisible = isVisible;
        this.nextStep = nextStep;
        this.onState = onState;
        this.onError = onError;
        this.keys = { state: 'userState', static: 'userStatic', log: 'dayLog', leader: 'leader', history: 'statsHistory', dead: 'apiKeyDead', stateError: 'stateError', ...keys };
        this.polling = false;
    }

    /** Leader election: one heartbeat. Returns true when this tab may poll. */
    heartbeat() {
        const d = decideLeader(this.store.get(this.keys.leader, null), this.tabId, { now: this.now(), visible: this.isVisible() });
        if (d.write) this.store.set(this.keys.leader, d.write);
        return d.lead && d.confirmed;
    }

    /** The stored state (any tab). */
    current() {
        const s = this.store.get(this.keys.state, null);
        return s && s.api ? normalizeState(s.api, s.at) : null;
    }

    /** One tick of the feed: poll if leader and due. Resolves to true when it polled. */
    async tick() {
        if (this.polling || !this.heartbeat()) return false;
        if (this.store.get(this.keys.dead, false)) return false;
        const last = this.store.get(this.keys.state, null);
        const t = this.now();
        if (last && t - last.at < STATE_POLL_MS) {
            await this.refreshStatic();
            return false;
        }
        // A refused state call: a key without access waits for a new key (saving one clears this); anything else waits 30 s.
        const failed = this.store.get(this.keys.stateError, null);
        if (failed && (failed.code === ACCESS_TOO_LOW || t - failed.at < STATE_RETRY_MS)) return false;
        this.polling = true;
        try {
            const api = await fetchUserState(this.client);
            const at = this.now();
            const next = normalizeState(api, at);
            const prev = last && last.api ? normalizeState(last.api, last.at) : null;
            if (prev) {
                const diff = diffStates(prev, next);
                const log = logFromDiff(this.store.get(this.keys.log, []), diff, { at, nextStep: this.nextStep() });
                this.store.set(this.keys.log, log);
                // The gain model checks itself against your own trains.
                const st = this.store.get(this.keys.static, {}) || {};
                const sample = calibrationSample(prev, next, diff, { table: st.gyms && st.gyms.length ? mergeLiveGyms(st.gyms) : GYMS, perks: parsePerks(st.perks || {}).mult });
                if (sample) this.store.set('calibration', addCalibration(this.store.get('calibration', null), sample));
            }
            this.store.set(this.keys.state, { at, api });
            if (failed) this.clearStateError();
            this.recordDaily(next);
            this.onState(next, api);
            await this.refreshStatic();
            return true;
        } catch (error) {
            if (error && KEY_DEAD_CODES.has(error.code)) this.store.set(this.keys.dead, true);
            // No key yet is not a failed call: nothing was sent.
            else if (!(error && error.noKey)) this.store.set(this.keys.stateError, { at: this.now(), code: (error && error.code) ?? null, message: String((error && error.message) || error) });
            this.onError(error);
            return false;
        } finally {
            this.polling = false;
        }
    }

    clearStateError() {
        if (this.store.del) this.store.del(this.keys.stateError);
        else this.store.set(this.keys.stateError, null);
    }

    /** Stats at the end of each Torn day seen (Progress). Keeps 120 days. */
    recordDaily(state) {
        if (!state.stats) return;
        const h = this.store.get(this.keys.history, {}) || {};
        const day = tornDayStart(state.at);
        h[day] = { ...state.stats, total: totalOf(state.stats) };
        const days = Object.keys(h).map(Number).sort((a, b) => a - b);
        while (days.length > 120) delete h[days.shift()];
        this.store.set(this.keys.history, h);
    }

    /** Perks, property, gyms, inventory, key info: each on its own clock. */
    async refreshStatic() {
        if (this.refreshing) return this.store.get(this.keys.static, {}) || {};
        this.refreshing = true;
        try {
            return await this.refreshStaticOnce();
        } finally {
            this.refreshing = false;
        }
    }

    async refreshStaticOnce() {
        const st = { ...(this.store.get(this.keys.static, {}) || {}) };
        const at = this.now();
        const due = (k) => !(st[k + 'At'] && at - st[k + 'At'] < STATIC_EVERY[k]);
        const jobs = [
            ['keyInfo', () => fetchKeyInfo(this.client)],
            ['perks', () => fetchPerks(this.client)],
            ['property', () => fetchProperty(this.client)],
            ['gyms', () => fetchGyms(this.client)],
            ['inventory', () => fetchInventory(this.client)],
        ];
        let changed = false;
        for (const [k, fn] of jobs) {
            if (!due(k)) continue;
            try {
                st[k] = await fn();
            } catch (error) {
                if (error && KEY_DEAD_CODES.has(error.code)) {
                    this.store.set(this.keys.dead, true);
                    this.onError(error);
                    break;
                }
                // A part Torn refuses (e.g. access level) is retried on its clock, not every tick.
                this.onError(error);
            }
            st[k + 'At'] = at;
            changed = true;
            // Merge into what's stored now: other parts (e.g. equipment for Torn Eye) may have been saved meanwhile.
            this.store.set(this.keys.static, { ...(this.store.get(this.keys.static, {}) || {}), [k]: st[k], [k + 'At']: at });
        }
        void changed;
        return this.store.get(this.keys.static, {}) || st;
    }
}

