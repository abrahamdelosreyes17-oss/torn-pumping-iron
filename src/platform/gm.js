/*
 * Userscript-host adapter.
 *
 * Every GM_* call in the project goes through this file. core/ and api/ never
 * touch it directly, so those layers stay portable to a plain web app: swap
 * this one module for a localStorage (or server) adapter and nothing else
 * changes.
 *
 * Falls back to an in-memory store when the GM_* globals are absent, which is
 * what lets the unit tests run under plain node.
 */

const GM_NAMESPACE = 'pumpingIron.v1.';

const gmMemoryStore = new Map();

const gmHasStorage =
    typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

function gmKey(key) {
    return GM_NAMESPACE + key;
}

/** Read a JSON-serialisable value. Returns `fallback` if absent or corrupt. */
export function gmGet(key, fallback = null) {
    const full = gmKey(key);

    let raw;
    if (gmHasStorage) {
        raw = GM_getValue(full, null);
    } else {
        raw = gmMemoryStore.has(full) ? gmMemoryStore.get(full) : null;
    }

    if (raw === null || raw === undefined || raw === '') return fallback;

    try {
        return JSON.parse(raw);
    } catch {
        // A corrupt entry is not worth crashing over; treat it as absent.
        return fallback;
    }
}

const gmParsed = new Map();

/**
 * Read a big, read-only value (prices): parsed once per stored version, not
 * on every read. Callers must not change what it returns (copy first).
 */
export function gmGetShared(key, fallback = null) {
    const full = gmKey(key);
    const raw = gmHasStorage ? GM_getValue(full, null) : gmMemoryStore.has(full) ? gmMemoryStore.get(full) : null;
    if (raw === null || raw === undefined || raw === '') return fallback;
    const hit = gmParsed.get(full);
    if (hit && hit.raw === raw) return hit.value;
    try {
        const value = JSON.parse(raw);
        gmParsed.set(full, { raw, value });
        return value;
    } catch {
        return fallback;
    }
}

/** Write a JSON-serialisable value. */
export function gmSet(key, value) {
    const full = gmKey(key);
    const raw = JSON.stringify(value);

    if (gmHasStorage) {
        GM_setValue(full, raw);
    } else {
        gmMemoryStore.set(full, raw);
    }
}

/** Remove a stored value. */
export function gmDel(key) {
    const full = gmKey(key);

    if (gmHasStorage && typeof GM_deleteValue === 'function') {
        GM_deleteValue(full);
    } else if (gmHasStorage) {
        GM_setValue(full, '');
    } else {
        gmMemoryStore.delete(full);
    }
}

/** Register a Tampermonkey menu command, if the host supports them. */
export function gmMenu(label, handler) {
    if (typeof GM_registerMenuCommand === 'function') {
        GM_registerMenuCommand(label, handler);
    }
}

/**
 * HTTP through the userscript host's own transport.
 *
 * A plain fetch() from a userscript runs in the PAGE's context and is subject
 * to Torn's Content-Security-Policy, which can block api.torn.com outright
 * (the trading app learned this the hard way: "it does not scan").
 * GM_xmlhttpRequest runs outside the page, so the CSP does not apply; every
 * host it reaches needs an `@connect` line in the header.
 *
 * Falls back to fetch when the host does not provide it (and under node, for
 * the tests).
 *
 * @param {string} url
 * @param {object} [init] - {method, headers, body}; GET when omitted
 * @returns {Promise<{ok: boolean, status: number, json: function, text: function}>}
 */
export function gmFetch(url, init = {}) {
    const method = (init && init.method) || 'GET';
    const headers = (init && init.headers) || {};
    const body = init && init.body !== undefined ? init.body : undefined;

    if (typeof GM_xmlhttpRequest !== 'function') {
        if (typeof fetch === 'function') {
            return method === 'GET' && !Object.keys(headers).length
                ? fetch(url)
                : fetch(url, { method, headers, body });
        }
        return Promise.reject(new Error('No HTTP transport available.'));
    }

    return new Promise((resolve, reject) => {
        GM_xmlhttpRequest({
            method,
            url,
            headers,
            data: body,
            timeout: 30000,
            onload(response) {
                resolve({
                    ok: response.status >= 200 && response.status < 300,
                    status: response.status,
                    json: async () => JSON.parse(response.responseText),
                    text: async () => String(response.responseText || ''),
                });
            },
            onerror() {
                reject(new Error('Network request failed.'));
            },
            ontimeout() {
                reject(new Error('Request timed out.'));
            },
        });
    });
}

/** Open a URL in a new tab, if the host supports it; otherwise fall back. */
export function gmOpenTab(url) {
    if (typeof GM_openInTab === 'function') {
        GM_openInTab(url, { active: true });
    } else if (typeof window !== 'undefined') {
        window.open(url, '_blank', 'noopener');
    }
}

/**
 * Be told when ANOTHER tab changes a stored value. This is how follower tabs
 * see the live feed the leader tab writes, without polling anything.
 * Returns false when the host has no listener API (the caller then re-reads
 * on its own timer).
 */
export function gmOnChange(key, handler) {
    if (typeof GM_addValueChangeListener !== 'function') return false;

    GM_addValueChangeListener(gmKey(key), (_name, _old, _new, remote) => {
        if (remote) handler();
    });

    return true;
}
