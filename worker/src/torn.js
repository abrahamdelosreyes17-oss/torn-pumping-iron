/*
 * Torn's API, the only way the Worker learns anything about Torn. The key
 * goes in the Authorization header, never the URL. A dead key (errors 2,
 * 13, 18) pauses that user: Torn warns that repeated bad-key calls can
 * block the IP. Only the user's own key is used for the user's own view.
 */

import { Q } from './db.js';

export const TORN_API = 'https://api.torn.com/v2/';
export const COMMENT = 'PumpingIronPings';
export const TORN_URL = TORN_API + 'user?selections=bars,cooldowns,refills,travel&comment=' + COMMENT;
/** The same read for a key that may not read travel (a custom key made without it): the pings need these three. */
export const TORN_URL_NO_TRAVEL = TORN_API + 'user?selections=bars,cooldowns,refills&comment=' + COMMENT;
export const DEAD_KEY_CODES = [2, 13, 18];
/** Torn's "access level of this key is not high enough". */
export const ACCESS_LEVEL = 16;
/** A key that could not read travel is asked for it again this often (a new key is asked at once). */
export const NO_TRAVEL_RECHECK_S = 24 * 3600;
/** This many reads failed in a row (about as many minutes): the sync answer says the Worker can't read Torn. */
export const READ_FAIL_RUNS = 3;

export class TornError extends Error {
    constructor(code, message) {
        super('Torn error ' + code + (message ? ': ' + message : ''));
        this.name = 'TornError';
        this.code = code;
        this.dead = DEAD_KEY_CODES.includes(code);
    }
}

export function tornUrl(path, params = {}) {
    const u = new URL(String(path).replace(/^\/+/, ''), TORN_API);
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) u.searchParams.set(k, String(v));
    u.searchParams.set('comment', COMMENT);
    return u.toString();
}

/** One Torn read. Throws TornError on Torn's own errors. */
export async function tornGet(fetchImpl, key, url) {
    const res = await fetchImpl(url, { headers: { Authorization: 'ApiKey ' + key } });
    let data;
    try {
        data = await res.json();
    } catch {
        throw new TornError(0, 'Torn answered with something that is not JSON');
    }
    if (data && data.error) throw new TornError(Number(data.error.code), String(data.error.error || ''));
    return data;
}

/** Stop using a key Torn called dead, until a new key is sent. */
export async function pauseUser(db, userId, err) {
    await db.prepare(Q.userPause).bind(err.message, userId).run();
}

/** What a user sees when a command's Torn read fails. */
export function tornErrorText(e) {
    if (!(e instanceof TornError)) return 'Torn didn’t answer. Try again in a minute.';
    if (e.dead) return 'Torn refused the Worker’s key (' + e.message + '). Pings are paused: paste a new key in Pumping Iron → Settings → Discord.';
    if (e.code === 16) return 'The Worker’s key can’t read this. Add the missing selection to it in Torn → Settings → API (see SETUP.md).';
    if (e.code === 5) return 'Torn says too many requests. Try again in a minute.';
    if (e.code === 17 || e.code === 9) return 'Torn’s API is down for a moment. Try again soon.';
    return 'Torn answered: ' + e.message;
}

/* ---------- The reads the bot makes ---------- */

export const userState = (f, key, { travel = true } = {}) => tornGet(f, key, travel ? TORN_URL : TORN_URL_NO_TRAVEL);

/**
 * The user's own state, as the userscript reads it (src/api/torn.js fetchUserState): a key without the travel read
 * (Torn error 16) is asked again without it, so its pings work; only "back in Torn" can't go out for that user.
 * `noTravel` (remembered by the caller in users.prev) skips the first ask, so Torn isn't asked twice a minute.
 * @returns {Promise<{state: object, noTravel: boolean}>}
 */
export async function readState(f, key, { noTravel = false } = {}) {
    if (!noTravel) {
        try {
            return { state: await userState(f, key), noTravel: false };
        } catch (e) {
            if (!(e instanceof TornError && e.code === ACCESS_LEVEL)) throw e;
        }
    }
    return { state: await userState(f, key, { travel: false }), noTravel: true };
}

/** A failed read in plain words (the sync answer; Settings › Discord pings shows it). */
export function readFailText(code, message = '') {
    if (code === ACCESS_LEVEL) return 'The key on the service can’t read your bars and cooldowns (Torn error 16).';
    if (code === 5) return 'Torn says too many requests for this key (Torn error 5).';
    if (code === 8) return 'Torn has blocked the service’s address for a while (Torn error 8).';
    if (code === 9 || code === 17) return 'Torn’s API is down (Torn error ' + code + ').';
    if (code === 0) return 'Torn answered with something that is not JSON.';
    return String(message || 'Torn error ' + code).replace(/\.+$/, '') + '.';
}

/**
 * users.prev after a read that failed (not a dead key: that pauses): the last good read stays, with how many reads
 * failed in a row, since when and why. One good read clears it (cron.js saves a new prev without `fail`).
 */
export function readFailed(prev, err, nowS) {
    const p = prev && typeof prev === 'object' ? prev : {};
    const was = p.fail && typeof p.fail === 'object' ? p.fail : null;
    return { ...p, fail: { code: Number(err.code) || 0, text: String(err.message || '').slice(0, 160), since: was ? Number(was.since) || nowS : nowS, n: (was ? Number(was.n) || 0 : 0) + 1 } };
}

/**
 * The Worker's own Torn read, for the sync answer: {ok (null: not read yet), at (the last good read), travel (false:
 * the key can't read travel, so no "back in Torn" pings), and once READ_FAIL_RUNS reads failed in a row: since, code, error}.
 */
export function tornReadOf(prevText) {
    let prev = null;
    try {
        prev = prevText ? JSON.parse(prevText) : null;
    } catch {
        prev = null;
    }
    if (!prev || typeof prev !== 'object') return { ok: null, at: null, travel: true };
    const fail = prev.fail && typeof prev.fail === 'object' ? prev.fail : null;
    const failing = Boolean(fail && Number(fail.n) >= READ_FAIL_RUNS);
    return { ok: failing ? false : Number(prev.at) > 0 ? true : null, at: Number(prev.at) || null, travel: !prev.noTravel, ...(failing ? { since: Number(fail.since) || null, code: Number(fail.code) || 0, error: readFailText(Number(fail.code) || 0, fail.text) } : {}) };
}
export const itemMarket = (f, key, itemId) => tornGet(f, key, tornUrl('market/' + Number(itemId) + '/itemmarket'));
export const playerBasic = (f, key, id) => tornGet(f, key, tornUrl('user/' + Number(id) + '/basic'));
/** A watched player's status and last action (the watch list). */
export const playerProfile = (f, key, id) => tornGet(f, key, tornUrl('user/' + Number(id) + '/profile'));
export const factionWars = (f, key) => tornGet(f, key, tornUrl('faction/wars'));
export const factionMembers = (f, key, id) => tornGet(f, key, tornUrl('faction/' + Number(id) + '/members'));
export const factionChain = (f, key) => tornGet(f, key, tornUrl('faction/chain'));
