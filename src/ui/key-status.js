/*
 * Why there is no state yet, in the player's words: the one warning the
 * webpage, Settings and the pill all show instead of waiting forever.
 */

import { missingSelections } from '../api/torn.js';

const PLAIN = { bars: 'energy and happy', cooldowns: 'cooldowns', refills: 'refills', battlestats: 'battle stats', gym: 'gym' };

const list = (xs) => (xs.length > 1 ? xs.slice(0, -1).join(', ') + ' or ' + xs[xs.length - 1] : xs[0] || '');

/**
 * @param {object} o - {hasKey, dead, stateError: {code, message}|null, keyInfo}
 * @returns {null|{kind, short, title, text}} null = no problem known (or no key yet)
 */
export function keyProblem({ hasKey, dead, stateError = null, keyInfo = null }) {
    if (!hasKey) return null;
    if (dead) return { kind: 'dead', short: 'Key refused · open Settings', title: 'Torn refused this key', text: 'It was deleted, paused or mistyped. Paste a new Limited key in Settings.' };
    const missing = missingSelections(keyInfo);
    if ((stateError && stateError.code === 16) || (missing && missing.length)) {
        const what = missing && missing.length ? ' It can’t read your ' + list(missing.map((s) => PLAIN[s] || s)) + '.' : '';
        const said = stateError && stateError.code === 16 ? 'Torn says its access level is too low.' : '';
        return { kind: 'access', short: 'Key too limited · open Settings', title: 'This key can’t read your state', text: (said + what).trim() + ' Make a Limited key and paste it in Settings.' };
    }
    if (stateError) return { kind: 'retry', short: 'Torn didn’t answer · retrying', title: 'Torn didn’t answer', text: String(stateError.message || 'The call failed.') + ' Trying again every 30 s.' };
    return null;
}
