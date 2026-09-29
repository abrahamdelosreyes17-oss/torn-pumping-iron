/*
 * An in-memory stand-in for Cloudflare D1 that understands exactly the SQL
 * the Worker sends (and fails loudly on anything else, so a new query is
 * noticed).
 */

export function fakeD1() {
    const users = new Map();
    const sent = new Map();
    const log = [];
    const handlers = [
        [/^CREATE TABLE/, () => ({})],
        [/^SELECT \* FROM users WHERE id = \?$/, ([id]) => ({ first: users.get(id) || null })],
        [/^SELECT \* FROM users WHERE paused = 0$/, () => ({ all: [...users.values()].filter((u) => !u.paused) })],
        [/^SELECT COUNT\(\*\) AS n FROM users$/, () => ({ first: { n: users.size } })],
        [/^INSERT OR REPLACE INTO users/, ([id, torn_key, discord_id, webhook, plan, rules, paused, last_error, updated]) => (users.set(id, { id, torn_key, discord_id, webhook, plan, rules, paused, last_error, updated }), {})],
        [/^UPDATE users SET paused = 1, last_error = \? WHERE id = \?$/, ([err, id]) => {
            const u = users.get(id);
            if (u) Object.assign(u, { paused: 1, last_error: err });
            return {};
        }],
        [/^DELETE FROM users WHERE id = \?$/, ([id]) => (users.delete(id), {})],
        [/^DELETE FROM sent WHERE user = \?$/, ([id]) => {
            for (const k of [...sent.keys()]) if (k.startsWith(id + '|')) sent.delete(k);
            return {};
        }],
        [/^SELECT at FROM sent WHERE user = \? AND alert = \?$/, ([u, a]) => ({ first: sent.has(u + '|' + a) ? { at: sent.get(u + '|' + a) } : null })],
        [/^INSERT OR REPLACE INTO sent/, ([u, a, at]) => (sent.set(u + '|' + a, at), {})],
        [/^DELETE FROM sent WHERE at < \?$/, ([t]) => {
            for (const [k, at] of [...sent]) if (at < t) sent.delete(k);
            return {};
        }],
    ];
    const exec = (sql, args) => {
        log.push(sql);
        const h = handlers.find(([re]) => re.test(sql));
        if (!h) throw new Error('fakeD1: unexpected SQL: ' + sql);
        return h[1](args);
    };
    const stmt = (sql, args = []) => ({
        bind: (...a) => stmt(sql, a),
        run: async () => (exec(sql, args), { success: true }),
        first: async () => exec(sql, args).first ?? null,
        all: async () => ({ results: exec(sql, args).all || [] }),
    });
    return { prepare: (sql) => stmt(sql), users, sent, log };
}
