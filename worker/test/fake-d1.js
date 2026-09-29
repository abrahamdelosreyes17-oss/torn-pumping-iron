/*
 * An in-memory stand-in for Cloudflare D1 that understands exactly the SQL
 * the Worker sends (src/db.js) and fails loudly on anything else, so a new
 * query is noticed.
 */

import { Q } from '../src/db.js';

export function fakeD1() {
    const users = new Map();
    const sent = new Map(); // user|alert → row
    const links = new Map();
    const acks = new Map(); // user|id → row
    const watches = new Map(); // user|item → row
    const prices = new Map();
    const meta = new Map();
    const logins = new Map();
    const outbox = [];
    const log = [];

    const byUser = (map, u) => [...map.entries()].filter(([k]) => k.startsWith(u + '|')).map(([, v]) => v);
    const dropUser = (map, u) => {
        for (const k of [...map.keys()]) if (k.startsWith(u + '|')) map.delete(k);
    };
    const patch = (map, k, fields) => {
        const r = map.get(k);
        if (r) Object.assign(r, fields);
        return {};
    };

    const exact = {
        [Q.metaGet]: ([k]) => ({ first: meta.has(k) ? { v: meta.get(k) } : null }),
        [Q.metaPut]: ([k, v]) => (meta.set(k, v), {}),

        [Q.userGet]: ([id]) => ({ first: users.get(id) || null }),
        [Q.userByDiscord]: ([d]) => ({ first: [...users.values()].find((u) => u.discord_id === d && Number(u.linked) === 1) || null }),
        [Q.usersCount]: () => ({ first: { n: users.size } }),
        [Q.usersDue]: ([limit]) => ({ all: [...users.values()].filter((u) => !Number(u.paused) && u.torn_key && (u.webhook || Number(u.linked) === 1)).sort((a, b) => (Number(a.ran) || 0) - (Number(b.ran) || 0)).slice(0, limit) }),
        [Q.userInsert]: ([id, torn_key, discord_id, webhook, plan, rules, paused, last_error, updated, plan_at, targets, faction_id, player_id]) => {
            if (users.has(id)) throw new Error('UNIQUE constraint failed: users.id');
            users.set(id, { id, torn_key, discord_id, webhook, plan, rules, paused, last_error, updated, plan_at, targets, faction_id, player_id, linked: 0, ran: 0, settings: null, dm_channel: null, dm_fail: 0, prev: null, war: null, cmd_at: 0 });
            return {};
        },
        [Q.userSync]: ([torn_key, discord_id, webhook, plan, rules, paused, last_error, updated, plan_at, targets, faction_id, player_id, id]) => patch(users, id, { torn_key, discord_id, webhook, plan, rules, paused, last_error, updated, plan_at, targets, faction_id, player_id }),
        [Q.userPause]: ([last_error, id]) => patch(users, id, { paused: 1, last_error }),
        [Q.userDelete]: ([id]) => (users.delete(id), {}),
        [Q.userRan]: ([ran, prev, war, id]) => patch(users, id, { ran, prev, war }),
        [Q.userWar]: ([war, id]) => patch(users, id, { war }),
        [Q.usersPlainKeys]: () => ({ all: [...users.values()].filter((u) => u.torn_key && !String(u.torn_key).startsWith('v1.')).slice(0, 5).map((u) => ({ id: u.id, torn_key: u.torn_key })) }),
        [Q.userKey]: ([torn_key, id]) => patch(users, id, { torn_key }),
        [Q.userLink]: ([discord_id, id]) => patch(users, id, { discord_id, linked: 1, dm_channel: null, dm_fail: 0 }),
        [Q.userUnlink]: ([d]) => {
            for (const u of users.values()) if (u.discord_id === d && Number(u.linked) === 1) Object.assign(u, { discord_id: '', linked: 0, dm_channel: null });
            return {};
        },
        [Q.userSettings]: ([settings, id]) => patch(users, id, { settings }),
        [Q.userDm]: ([dm_channel, dm_fail, id]) => patch(users, id, { dm_channel, dm_fail }),
        [Q.userCmd]: ([cmd_at, id]) => patch(users, id, { cmd_at }),

        [Q.sentList]: ([u]) => ({ all: byUser(sent, u) }),
        [Q.sentOne]: ([u, a]) => ({ first: sent.get(u + '|' + a) || null }),
        [Q.sentByMessage]: ([u, m]) => ({ all: byUser(sent, u).filter((r) => r.message === m) }),
        [Q.sentPut]: ([user, alert, at, state, until, channel, message, body, via]) => (sent.set(user + '|' + alert, { user, alert, at, state, until, channel, message, body, via }), {}),
        [Q.sentState]: ([state, until, u, a]) => patch(sent, u + '|' + a, { state, until }),
        [Q.sentBody]: ([body, u, a]) => patch(sent, u + '|' + a, { body }),
        [Q.sentDeleteUser]: ([u]) => (dropUser(sent, u), {}),
        [Q.sentClean]: ([t]) => {
            for (const [k, r] of [...sent]) if (r.at < t) sent.delete(k);
            return {};
        },

        [Q.linkDeleteUser]: ([u]) => {
            for (const [k, r] of [...links]) if (r.user === u) links.delete(k);
            return {};
        },
        [Q.linkPut]: ([hash, user, expires]) => (links.set(hash, { hash, user, expires }), {}),
        [Q.linkGet]: ([hash]) => ({ first: links.get(hash) || null }),
        [Q.linkDelete]: ([hash]) => (links.delete(hash), {}),
        [Q.linkClean]: ([t]) => {
            for (const [k, r] of [...links]) if (r.expires < t) links.delete(k);
            return {};
        },

        [Q.loginPut]: ([id, user, at, state]) => (logins.set(id, { id, user, at, discord_id: null, name: null, state }), {}),
        [Q.loginGet]: ([id]) => ({ first: logins.get(id) || null }),
        [Q.loginSet]: ([discord_id, name, state, id]) => patch(logins, id, { discord_id, name, state }),
        [Q.loginsCount]: () => ({ first: { n: logins.size } }),
        [Q.loginDeleteUser]: ([u]) => {
            for (const [k, r] of [...logins]) if (r.user === u) logins.delete(k);
            return {};
        },
        [Q.loginClean]: ([t]) => {
            for (const [k, r] of [...logins]) if (r.at < t) logins.delete(k);
            return {};
        },

        [Q.ackPut]: ([id, user, kind, alert, step, at]) => (acks.set(user + '|' + id, { id, user, kind, alert, step, at }), {}),
        [Q.ackList]: ([u]) => ({ all: byUser(acks, u) }),
        [Q.ackDeleteUser]: ([u]) => (dropUser(acks, u), {}),
        [Q.ackClean]: ([t]) => {
            for (const [k, r] of [...acks]) if (r.at < t) acks.delete(k);
            return {};
        },

        [Q.watchList]: ([u]) => ({ all: byUser(watches, u) }),
        [Q.watchPut]: ([user, item, price]) => (watches.set(user + '|' + item, { user, item, price, fired: 0 }), {}),
        [Q.watchDelete]: ([u, item]) => (watches.delete(u + '|' + item), {}),
        [Q.watchMark]: ([fired, u, item]) => patch(watches, u + '|' + item, { fired }),
        [Q.watchDeleteUser]: ([u]) => (dropUser(watches, u), {}),

        [Q.priceGet]: ([k]) => ({ first: prices.get(k) || null }),
        [Q.pricePut]: ([k, user, price, qty, seller, at]) => (prices.set(k, { k, user, price, qty, seller, at }), {}),
        [Q.priceDeleteUser]: ([u]) => {
            for (const [k, r] of [...prices]) if (r.user === u) prices.delete(k);
            return {};
        },

        [Q.outboxPut]: ([at, route, body]) => (outbox.push({ n: outbox.length + 1, at, route, body }), {}),
    };
    const patterns = [
        [/^CREATE (TABLE|INDEX) IF NOT EXISTS /, () => ({})],
        [/^ALTER TABLE (users|sent) ADD COLUMN \w+ \w+( DEFAULT .+)?$/, () => ({})],
        [
            /^DELETE FROM acks WHERE user = \? AND id IN \(\?(, \?)*\)$/,
            ([u, ...ids]) => {
                for (const id of ids) acks.delete(u + '|' + id);
                return {};
            },
        ],
    ];

    const exec = (sql, args) => {
        log.push(sql);
        if (Object.prototype.hasOwnProperty.call(exact, sql)) return exact[sql](args);
        const p = patterns.find(([re]) => re.test(sql));
        if (!p) throw new Error('fakeD1: unexpected SQL: ' + sql);
        return p[1](args);
    };
    const stmt = (sql, args = []) => ({
        bind: (...a) => stmt(sql, a),
        run: async () => (exec(sql, args), { success: true }),
        first: async () => exec(sql, args).first ?? null,
        all: async () => ({ results: exec(sql, args).all || [] }),
    });
    return { prepare: (sql) => stmt(sql), users, sent, links, logins, acks, watches, prices, meta, outbox, log };
}
