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
