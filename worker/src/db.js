/*
 * Every SQL statement the Worker sends, in one place (the test D1 knows
 * exactly these and fails on anything else), and the schema.
 *
 * The schema is checked once per Worker instance, not on every request:
 * one small read (`meta.schema`) the first time, then nothing.
 */

export const SCHEMA_VERSION = 2;

/** Free plan: 50 D1 queries per invocation. Keep a few spare. */
export const QUERY_BUDGET = 45;

export const Q = {
    metaGet: 'SELECT v FROM meta WHERE k = ?',
    metaPut: 'INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)',

    userGet: 'SELECT * FROM users WHERE id = ?',
    userByDiscord: 'SELECT * FROM users WHERE discord_id = ? AND linked = 1',
    usersDue: 'SELECT * FROM users WHERE paused = 0 ORDER BY ran ASC LIMIT ?',
    userInsert: 'INSERT INTO users (id, torn_key, discord_id, webhook, plan, rules, paused, last_error, updated, plan_at, targets, faction_id, player_id, linked, ran) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)',
    userSync: 'UPDATE users SET torn_key = ?, discord_id = ?, webhook = ?, plan = ?, rules = ?, paused = ?, last_error = ?, updated = ?, plan_at = ?, targets = ?, faction_id = ?, player_id = ? WHERE id = ?',
    userPause: 'UPDATE users SET paused = 1, last_error = ? WHERE id = ?',
    userDelete: 'DELETE FROM users WHERE id = ?',
    userRan: 'UPDATE users SET ran = ?, prev = ?, war = ? WHERE id = ?',
    userKey: 'UPDATE users SET torn_key = ? WHERE id = ?',
    userLink: 'UPDATE users SET discord_id = ?, linked = 1, dm_channel = NULL, dm_fail = 0 WHERE id = ?',
    userUnlink: "UPDATE users SET discord_id = '', linked = 0, dm_channel = NULL WHERE discord_id = ? AND linked = 1",
    userSettings: 'UPDATE users SET settings = ? WHERE id = ?',
    userDm: 'UPDATE users SET dm_channel = ?, dm_fail = ? WHERE id = ?',
    userCmd: 'UPDATE users SET cmd_at = ? WHERE id = ?',

    sentList: 'SELECT * FROM sent WHERE user = ?',
    sentOne: 'SELECT * FROM sent WHERE user = ? AND alert = ?',
    sentByMessage: 'SELECT * FROM sent WHERE user = ? AND message = ?',
    sentPut: 'INSERT OR REPLACE INTO sent (user, alert, at, state, until, channel, message, body, via) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    sentState: 'UPDATE sent SET state = ?, until = ? WHERE user = ? AND alert = ?',
    sentBody: 'UPDATE sent SET body = ? WHERE user = ? AND alert = ?',
    sentDeleteUser: 'DELETE FROM sent WHERE user = ?',
    sentClean: 'DELETE FROM sent WHERE at < ?',

    linkDeleteUser: 'DELETE FROM link_codes WHERE user = ?',
    linkPut: 'INSERT INTO link_codes (hash, user, expires) VALUES (?, ?, ?)',
    linkGet: 'SELECT * FROM link_codes WHERE hash = ?',
    linkDelete: 'DELETE FROM link_codes WHERE hash = ?',
    linkClean: 'DELETE FROM link_codes WHERE expires < ?',

    ackPut: 'INSERT OR REPLACE INTO acks (id, user, kind, alert, step, at) VALUES (?, ?, ?, ?, ?, ?)',
    ackList: 'SELECT * FROM acks WHERE user = ?',
    ackDelete: 'DELETE FROM acks WHERE user = ? AND id = ?',
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
    "ALTER TABLE sent ADD COLUMN state TEXT DEFAULT 'sent'",
    'ALTER TABLE sent ADD COLUMN until INTEGER',
    'ALTER TABLE sent ADD COLUMN channel TEXT',
    'ALTER TABLE sent ADD COLUMN message TEXT',
    'ALTER TABLE sent ADD COLUMN body TEXT',
    'ALTER TABLE sent ADD COLUMN via TEXT',
    'CREATE INDEX IF NOT EXISTS users_discord ON users (discord_id)',
    'CREATE INDEX IF NOT EXISTS sent_at ON sent (at)',
];

async function migrate(db) {
    let v = 0;
    try {
        const r = await db.prepare(Q.metaGet).bind('schema').first();
        v = Number(r && r.v) || 0;
    } catch {
        v = 0; // No meta table yet: a 1.0 database or a new one.
    }
    if (v >= SCHEMA_VERSION) return;
    for (const sql of SCHEMA) {
        try {
            await db.prepare(sql).run();
        } catch (e) {
            // Another instance got there first: the column is already there.
            if (!/duplicate column/i.test(String((e && e.message) || e))) throw e;
        }
    }
    await db.prepare(Q.metaPut).bind('schema', String(SCHEMA_VERSION)).run();
}

const checked = new WeakMap();

/** Once per Worker instance (per database): the first request pays one read. */
export function ensureSchema(db) {
    if (!checked.has(db)) {
        checked.set(
            db,
            migrate(db).catch((e) => {
                checked.delete(db);
                throw e;
            }),
        );
    }
    return checked.get(db);
}

/** Count queries so one run stays under the free plan's 50. */
export function meterDb(db, budget = QUERY_BUDGET) {
    let used = 0;
    const count = () => {
        used++;
    };
    const wrap = (s) => ({
        bind: (...a) => wrap(s.bind(...a)),
        run: () => (count(), s.run()),
        first: () => (count(), s.first()),
        all: () => (count(), s.all()),
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
