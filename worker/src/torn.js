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
export const DEAD_KEY_CODES = [2, 13, 18];

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

export const userState = (f, key) => tornGet(f, key, TORN_URL);
export const itemMarket = (f, key, itemId) => tornGet(f, key, tornUrl('market/' + Number(itemId) + '/itemmarket'));
export const playerBasic = (f, key, id) => tornGet(f, key, tornUrl('user/' + Number(id) + '/basic'));
export const factionWars = (f, key) => tornGet(f, key, tornUrl('faction/wars'));
export const factionMembers = (f, key, id) => tornGet(f, key, tornUrl('faction/' + Number(id) + '/members'));
export const factionChain = (f, key) => tornGet(f, key, tornUrl('faction/chain'));
