/*
 * TornStats spies (optional): exact stats your faction shared. The key is
 * the Torn key on the user's TornStats account (TornStats has it already)
 * and sits in the URL PATH, so the host is asserted and URLs are never
 * logged. research-third-party-api.md §2.
 */

import { ThirdPartyClient, ThirdPartyError } from './third.js';

export const TS_HOST = 'www.tornstats.com';
export const TS_BASE = 'https://www.tornstats.com/api/v2/';
export const TS_TOS_URL = 'https://tornstats.com/tos';

/** TornStats documents 100/min; we keep to 30. */
export const TS_MAX_PER_MINUTE = 30;

export function makeTsClient(opts) {
    return new ThirdPartyClient({ service: 'TornStats', host: TS_HOST, maxPerMinute: TS_MAX_PER_MINUTE, ...opts });
}

const seg = (x) => encodeURIComponent(String(x).replace(/[^A-Za-z0-9_]/g, ''));

function tsUnwrap(client, r) {
    const b = r.body;
    if (b && b.status === false) {
        const dead = r.status === 404 || /user not found|invalid/i.test(String(b.message || ''));
        if (dead) client.dead = true;
        throw new ThirdPartyError('TornStats: ' + String(b.message || 'refused').split(r.key || '\u0000').join('<redacted>'), { service: 'TornStats', http: r.status, deadKey: dead });
    }
    if (r.status === 429) {
        client.pause(60);
        throw new ThirdPartyError('TornStats asked us to slow down.', { service: 'TornStats', http: 429, paused: true, retryAfterS: 60 });
    }
    if (!r.ok || !b) throw new ThirdPartyError('TornStats HTTP ' + r.status, { service: 'TornStats', http: r.status });
    return b;
}

function spyOf(s) {
    if (!s || s.status === false) return null;
    const v = (k) => (Number(s[k]) > 0 ? Number(s[k]) : null);
    const ts = Number(s.timestamp) || 0;
    const stats = { str: v('strength'), spd: v('speed'), def: v('defense'), dex: v('dexterity') };
    if (!Object.values(stats).some(Boolean) && !v('total')) return null;
    return { ...stats, total: v('total'), at: ts > 0 ? ts * 1000 : null };
}

/** One player's spy, or null. */
export async function fetchSpyUser(client, userId) {
    const r = await client.request((key) => TS_BASE + seg(key) + '/spy/user/' + seg(userId));
    return spyOf(tsUnwrap(client, r).spy);
}

/** A faction's members with spies: {[playerId]: spy}. */
export async function fetchSpyFaction(client, factionId) {
    const r = await client.request((key) => TS_BASE + seg(key) + '/spy/faction/' + seg(factionId));
    const f = tsUnwrap(client, r).faction || {};
    const out = {};
    for (const [id, m] of Object.entries(f.members || {})) {
        const s = spyOf(m && m.spy);
        if (s) out[Number(id)] = s;
    }
    return out;
}
