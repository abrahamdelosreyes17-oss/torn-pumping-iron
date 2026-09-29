/*
 * Reading the attack page's `page.php?sid=attackData` answer, read-only
 * (ENGINE-SPEC §11). We wrap the page's fetch ONCE and hand Torn back its
 * own, untouched promise and response; we read a clone, later, off to the
 * side. Nothing is rebuilt, rewritten or injected into Torn's state (KAL
 * does that; we don't). Any error inside falls back to doing nothing.
 */

export const HOOK_FLAG = '__piAttackHook';

export function isAttackDataUrl(url, base) {
    try {
        const u = new URL(String(url), base || 'https://www.torn.com/');
        return /(^|\.)torn\.com$/.test(u.hostname) || u.hostname === '127.0.0.1' || u.hostname === 'localhost' ? u.searchParams.get('sid') === 'attackData' : false;
    } catch {
        return false;
    }
}

/**
 * @param {object} win - the page's window (unsafeWindow)
 * @param {function} onData - (json) => void, called with a copy of each attackData answer
 * @returns {boolean} installed now
 */
export function installAttackHook(win, onData) {
    try {
        if (!win || win[HOOK_FLAG] || typeof win.fetch !== 'function') return false;
        const original = win.fetch;
        const wrapped = function (input, init) {
            // Torn's call goes through exactly as it would have.
            const promise = original.apply(this, arguments);
            try {
                const url = typeof input === 'string' ? input : input && input.url;
                if (isAttackDataUrl(url, win.location && win.location.href)) {
                    promise.then(
                        (res) => {
                            try {
                                res.clone()
                                    .json()
                                    .then(
                                        (j) => {
                                            try {
                                                onData(j);
                                            } catch {
                                                // our problem, never Torn's
                                            }
                                        },
                                        () => {},
                                    );
                            } catch {
                                // a body we can't copy: skip it
                            }
                        },
                        () => {},
                    );
                }
            } catch {
                // never let our reading touch Torn's call
            }
            return promise;
        };
        win.fetch = wrapped;
        win[HOOK_FLAG] = true;
        return true;
    } catch {
        return false;
    }
}
