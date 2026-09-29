/*
 * Every outside call the Worker makes goes through here. Only three hosts
 * are ever reached: Torn's API, Discord and TornW3B. Never torn.com pages.
 * A budget keeps one run under Cloudflare's 50 subrequests per invocation.
 */

export const ALLOWED_HOSTS = ['api.torn.com', 'discord.com', 'weav3r.dev'];

/** Free plan: 50 subrequests per invocation. Keep a few spare. */
export const SUBREQUEST_BUDGET = 45;

export class BudgetError extends Error {
    constructor() {
        super('Out of subrequests for this run');
        this.name = 'BudgetError';
    }
}

/**
 * Wrap a fetch: https only, allowed hosts only, at most `budget` calls.
 * @returns {function & {used: number, left: () => number}}
 */
export function guardedFetch(fetchImpl, budget = SUBREQUEST_BUDGET) {
    let used = 0;
    const f = async (url, init = {}) => {
        const u = new URL(String(url));
        if (u.protocol !== 'https:' || !ALLOWED_HOSTS.includes(u.hostname)) throw new Error('Blocked host: ' + u.hostname);
        if (used >= budget) throw new BudgetError();
        used++;
        return fetchImpl(u.toString(), init);
    };
    Object.defineProperty(f, 'used', { get: () => used });
    f.left = () => budget - used;
    f.guarded = true;
    return f;
}

/** Guard once: a fetch that is already guarded keeps its own budget. */
export function guard(fetchImpl, budget) {
    return fetchImpl && fetchImpl.guarded ? fetchImpl : guardedFetch(fetchImpl, budget);
}

/**
 * A request body as text, at most `max` bytes (not characters): a
 * `content-length` over it is refused before anything is read, and a body
 * without one is read only up to the limit. Null when it is too big.
 */
export async function readLimited(req, max) {
    const declared = Number(req.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > max) return null;
    if (!req.body) return '';
    const reader = req.body.getReader();
    const parts = [];
    let size = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > max) {
            await reader.cancel().catch(() => {});
            return null;
        }
        parts.push(value);
    }
    const all = new Uint8Array(size);
    let at = 0;
    for (const p of parts) {
        all.set(p, at);
        at += p.byteLength;
    }
    return new TextDecoder().decode(all);
}
