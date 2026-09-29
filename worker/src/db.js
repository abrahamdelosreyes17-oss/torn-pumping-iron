/*
 * Every SQL statement the Worker sends, in one place (the test D1 knows
 * exactly these and fails on anything else), and the schema.
 *
 * The schema is checked once per Worker instance, not on every request:
 * one small read (`meta.schema`) the first time, then nothing.
 */

import { BudgetError } from './net.js';

export const SCHEMA_VERSION = 5;

/** Free plan: 50 D1 queries per invocation. Keep a few spare. */
export const QUERY_BUDGET = 45;

export const Q = {
    metaGet: 'SELECT v FROM meta WHERE k = ?',
    metaPut: 'INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)',

    userGet: 'SELECT * FROM users WHERE id = ?',
    userByDiscord: 'SELECT * FROM users WHERE discord_id = ? AND linked = 1',
    // Only users the cron can serve (a key, and a webhook or a Discord link): others never block the line.
    usersCount: 'SELECT COUNT(*) AS n FROM users',
    usersDue: "SELECT * FROM users WHERE paused = 0 AND torn_key != '' AND (webhook != '' OR linked = 1) ORDER BY ran ASC LIMIT ?",
    usersPlainKeys: "SELECT id, torn_key FROM users WHERE torn_key != '' AND torn_key NOT LIKE 'v1.%' LIMIT 5",
    userInsert: 'INSERT INTO users (id, torn_key, discord_id, webhook, plan, rules, paused, last_error, updated, plan_at, targets, faction_id, player_id, war_list, watch_list, linked, ran) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)',
    userSync: 'UPDATE users SET torn_key = ?, discord_id = ?, webhook = ?, plan = ?, rules = ?, paused = ?, last_error = ?, updated = ?, plan_at = ?, targets = ?, faction_id = ?, player_id = ?, war_list = ?, watch_list = ? WHERE id = ?',
    userPause: 'UPDATE users SET paused = 1, last_error = ? WHERE id = ?',
    userDelete: 'DELETE FROM users WHERE id = ?',
    userRan: 'UPDATE users SET ran = ?, prev = ?, war = ? WHERE id = ?',
    // The war's per-enemy memory and the watch list's, saved together once a minute when they changed.
    userLive: 'UPDATE users SET war = ?, watch_state = ? WHERE id = ?',
    userKey: 'UPDATE users SET torn_key = ? WHERE id = ?',
    userLink: 'UPDATE users SET discord_id = ?, linked = 1, dm_channel = NULL, dm_fail = 0 WHERE id = ?',
    userUnlink: "UPDATE users SET discord_id = '', linked = 0, dm_channel = NULL WHERE discord_id = ? AND linked = 1",
    userSettings: 'UPDATE users SET settings = ? WHERE id = ?',
    userDm: 'UPDATE users SET dm_channel = ?, dm_fail = ? WHERE id = ?',
    userCmd: 'UPDATE users SET cmd_at = ? WHERE id = ?',
    // Other rows this Discord account is linked to (a login in a second browser), and rows nobody has synced for long.
    usersLinkedElsewhere: 'SELECT id, updated FROM users WHERE discord_id = ? AND linked = 1 AND id != ? LIMIT 5',
    usersStale: 'SELECT id FROM users WHERE COALESCE(updated, 0) < ? LIMIT ?',

    sentList: 'SELECT * FROM sent WHERE user = ?',
    sentOne: 'SELECT * FROM sent WHERE user = ? AND alert = ?',
    sentByMessage: 'SELECT * FROM sent WHERE user = ? AND message = ?',
    sentPut: 'INSERT OR REPLACE INTO sent (user, alert, at, state, until, channel, message, body, via) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    sentState: 'UPDATE sent SET state = ?, until = ? WHERE user = ? AND alert = ?',
    sentBody: 'UPDATE sent SET body = ? WHERE user = ? AND alert = ?',
    sentDeleteUser: 'DELETE FROM sent WHERE user = ?',
    sentClean: 'DELETE FROM sent WHERE at < ?',
    // War and watch-list pings are about the next few minutes: kept 6 hours (Done on a war is kept in users.war).
    sentCleanLive: "DELETE FROM sent WHERE at < ? AND (alert LIKE 'war:%' OR alert LIKE 'eye:%')",

    linkDeleteUser: 'DELETE FROM link_codes WHERE user = ?',
    linkPut: 'INSERT INTO link_codes (hash, user, expires) VALUES (?, ?, ?)',
    linkGet: 'SELECT * FROM link_codes WHERE hash = ?',
    linkDelete: 'DELETE FROM link_codes WHERE hash = ?',
    linkClean: 'DELETE FROM link_codes WHERE expires < ?',

    // "Log in with Discord": one open login per browser secret, 15 minutes.
    // `ip`: a sha256 of the caller's address and the day (never the address itself), for a per-address cap.
    loginPut: 'INSERT OR REPLACE INTO logins (id, user, at, discord_id, name, state, ip) VALUES (?, ?, ?, NULL, NULL, ?, ?)',
    loginGet: 'SELECT * FROM logins WHERE id = ?',
    loginSet: 'UPDATE logins SET discord_id = ?, name = ?, state = ? WHERE id = ?',
    // Open logins in all, and from this address (one query).
    loginsOpen: "SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN ip = ? THEN 1 ELSE 0 END), 0) AS mine FROM logins WHERE state = 'open'",
    loginEvictOldest: "DELETE FROM logins WHERE id = (SELECT id FROM logins WHERE state = 'open' ORDER BY at ASC LIMIT 1)",
    loginCancel: 'DELETE FROM logins WHERE id = ? AND user = ?',
    loginDeleteUser: 'DELETE FROM logins WHERE user = ?',
    loginClean: 'DELETE FROM logins WHERE at < ?',

    ackPut: 'INSERT OR REPLACE INTO acks (id, user, kind, alert, step, at) VALUES (?, ?, ?, ?, ?, ?)',
    ackList: 'SELECT * FROM acks WHERE user = ?',
    ackDeleteUser: 'DELETE FROM acks WHERE user = ?',
    ackClean: 'DELETE FROM acks WHERE at < ?',

    watchList: 'SELECT * FROM watches WHERE user = ?',
    watchPut: 'INSERT OR REPLACE INTO watches (user, item, price, fired) VALUES (?, ?, ?, 0)',
    watchDelete: 'DELETE FROM watches WHERE user = ? AND item = ?',
    watchMark: 'UPDATE watches SET fired = ? WHERE user = ? AND item = ?',
    watchDeleteUser: 'DELETE FROM watches WHERE user = ?',

    priceGet: 'SELECT * FROM prices WHERE k = ?',
    pricePut: 'INSERT OR REPLACE INTO prices (k, user, price, qty, seller, at) VALUES (?, ?, ?, ?, ?, ?)',
    priceDeleteUser: 'DELETE FROM prices WHERE user = ?',

    outboxPut: 'INSERT INTO outbox (at, route, body) VALUES (?, ?, ?)',
};

/** Everything the service keeps about one user (Forget, /unlink, a stale row); the row itself last, so a run cut short tries again. */
export const FORGET = [Q.sentDeleteUser, Q.ackDeleteUser, Q.watchDeleteUser, Q.linkDeleteUser, Q.priceDeleteUser, Q.loginDeleteUser, Q.userDelete];

export async function forgetUser(db, id) {
    for (const sql of FORGET) await db.prepare(sql).bind(id).run();
}

/** Acks the userscript applied, in one statement (at most MAX_ACK_IDS ids). */
export const MAX_ACK_IDS = 50;
export const ackDeleteMany = (n) => 'DELETE FROM acks WHERE user = ? AND id IN (' + Array.from({ length: n }, () => '?').join(', ') + ')';

/** Version 1 (1.0) tables first, then what the bot adds. Safe to run again. */
export const SCHEMA = [
    'CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, torn_key TEXT, discord_id TEXT, webhook TEXT, plan TEXT, rules TEXT, paused INTEGER DEFAULT 0, last_error TEXT, updated INTEGER)',
    'CREATE TABLE IF NOT EXISTS sent (user TEXT, alert TEXT, at INTEGER, PRIMARY KEY (user, alert))',
    'CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)',
    'CREATE TABLE IF NOT EXISTS link_codes (hash TEXT PRIMARY KEY, user TEXT, expires INTEGER)',
    'CREATE TABLE IF NOT EXISTS acks (id TEXT, user TEXT, kind TEXT, alert TEXT, step TEXT, at INTEGER, PRIMARY KEY (user, id))',
    'CREATE TABLE IF NOT EXISTS watches (user TEXT, item INTEGER, price INTEGER, fired INTEGER DEFAULT 0, PRIMARY KEY (user, item))',
    'CREATE TABLE IF NOT EXISTS prices (k TEXT PRIMARY KEY, user TEXT, price INTEGER, qty INTEGER, seller TEXT, at INTEGER)',
    'CREATE TABLE IF NOT EXISTS outbox (n INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER, route TEXT, body TEXT)',
    'CREATE TABLE IF NOT EXISTS logins (id TEXT PRIMARY KEY, user TEXT, at INTEGER, discord_id TEXT, name TEXT, state TEXT)',
    'ALTER TABLE users ADD COLUMN plan_at INTEGER',
    'ALTER TABLE users ADD COLUMN settings TEXT',
    'ALTER TABLE users ADD COLUMN linked INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN dm_channel TEXT',
    'ALTER TABLE users ADD COLUMN dm_fail INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN targets TEXT',
    'ALTER TABLE users ADD COLUMN faction_id INTEGER',
    'ALTER TABLE users ADD COLUMN player_id INTEGER',
    'ALTER TABLE users ADD COLUMN prev TEXT',
    'ALTER TABLE users ADD COLUMN war TEXT',
    'ALTER TABLE users ADD COLUMN ran INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN cmd_at INTEGER DEFAULT 0',
    'ALTER TABLE users ADD COLUMN war_list TEXT',
    'ALTER TABLE users ADD COLUMN watch_list TEXT',
    'ALTER TABLE users ADD COLUMN watch_state TEXT',
    'ALTER TABLE logins ADD COLUMN ip TEXT',
    "ALTER TABLE sent ADD COLUMN state TEXT DEFAULT 'sent'",
    'ALTER TABLE sent ADD COLUMN until INTEGER',
    'ALTER TABLE sent ADD COLUMN channel TEXT',
    'ALTER TABLE sent ADD COLUMN message TEXT',
    'ALTER TABLE sent ADD COLUMN body TEXT',
    'ALTER TABLE sent ADD COLUMN via TEXT',
    'CREATE INDEX IF NOT EXISTS users_discord ON users (discord_id)',
    'CREATE INDEX IF NOT EXISTS sent_at ON sent (at)',
];

/** Brings the schema up to date; returns how many queries that took. */
async function migrate(db) {
    let v = 0;
    try {
        const r = await db.prepare(Q.metaGet).bind('schema').first();
        v = Number(r && r.v) || 0;
    } catch {
        v = 0; // No meta table yet: a 1.0 database or a new one.
    }
    if (v >= SCHEMA_VERSION) return 1;
    for (const sql of SCHEMA) {
        try {
            await db.prepare(sql).run();
        } catch (e) {
            // Another instance got there first: the column is already there.
            if (!/duplicate column/i.test(String((e && e.message) || e))) throw e;
        }
    }
    await db.prepare(Q.metaPut).bind('schema', String(SCHEMA_VERSION)).run();
    return SCHEMA.length + 2;
}

const checked = new WeakMap();

/**
 * Once per Worker instance (per database): the first request pays one
 * read (or the migration, once after an update). Returns the queries this
 * call spent, so a cron run can stay under 50.
 */
export async function ensureSchema(db) {
    if (checked.has(db)) {
        await checked.get(db);
        return 0;
    }
    const p = migrate(db);
    checked.set(
        db,
        p.catch((e) => {
            checked.delete(db);
            throw e;
        }),
    );
    return p;
}

/** Count queries so one run stays under the free plan's 50: one past the budget throws BudgetError. */
export function meterDb(db, budget = QUERY_BUDGET) {
    let used = 0;
    const count = () => {
        if (used >= budget) throw new BudgetError();
        used++;
    };
    const wrap = (s) => ({
        bind: (...a) => wrap(s.bind(...a)),
        run: async () => (count(), s.run()),
        first: async () => (count(), s.first()),
        all: async () => (count(), s.all()),
    });
    return {
        prepare: (sql) => wrap(db.prepare(sql)),
        get used() {
            return used;
        },
        left: () => budget - used,
    };
}

/** JSON from a column, or a fallback when it's empty or broken. */
export function parse(text, fallback) {
    if (text === null || text === undefined || text === '') return fallback;
    try {
        const v = JSON.parse(text);
        return v === null || v === undefined ? fallback : v;
    } catch {
        return fallback;
    }
}
