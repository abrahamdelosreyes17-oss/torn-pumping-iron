/*
 * Which Torn tab runs the live feed. Pure: the caller reads and writes the
 * shared record.
 *
 * Every Torn tab boots this script. Without one leader, five tabs make five
 * times the requests - Torn's 100/min is per USER across every key and tool,
 * and TornW3B's 100/min is per IP. So exactly one tab polls and the others
 * render what it stores.
 *
 * Only a VISIBLE tab may lead. Torn's rules forbid software that works from
 * unfocused pages to "generate alerts, or draw attention to itself"; a hidden
 * tab polling in the background is the shape of that, so a tab that is
 * hidden gives up the role instead of keeping it.
 */

/** A leader that has not renewed in this long is presumed gone. */
export const LEADER_STALE_MS = 10000;

/** How often the leader renews its claim. */
export const LEADER_HEARTBEAT_MS = 3000;

/**
 * @param {object|null} record - { id, ts } as last stored
 * @param {string} me - this tab's id
 * @param {object} opts
 * @param {number} opts.now
 * @param {boolean} opts.visible
 * @returns {{lead: boolean, confirmed: boolean, write: object|null}}
 *   `write` is the record to store (null = leave it alone). `confirmed` is
 *   true only when the stored record ALREADY named this tab: two tabs can
 *   both claim a stale record in the same instant, and only the one whose
 *   write survived sees itself there on the next tick. Poll only when
 *   confirmed, and the race costs one heartbeat instead of double requests.
 */
export function decideLeader(record, me, { now, visible, staleMs = LEADER_STALE_MS }) {
    const held = record && record.id && Number.isFinite(record.ts);
    const mine = held && record.id === me;
    const fresh = held && now - record.ts < staleMs;

    if (mine) {
        if (visible) {
            return { lead: true, confirmed: true, write: { id: me, ts: now } };
        }
        // Hidden: step down so a visible tab can take over at once.
        return { lead: false, confirmed: false, write: { id: null, ts: 0 } };
    }

    if (!fresh && visible) {
        return { lead: true, confirmed: false, write: { id: me, ts: now } };
    }

    return { lead: false, confirmed: false, write: null };
}

export function makeTabId() {
    return (
        Date.now().toString(36) +
        '-' +
        Math.random().toString(36).slice(2, 10)
    );
}
