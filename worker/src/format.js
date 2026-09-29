/*
 * Words and numbers as the bot shows them. Torn time (TCT) is UTC.
 */

export const TORN = 'https://www.torn.com/';
export const DAY_S = 86400;

export const clock = (s) => new Date(Number(s) * 1000).toISOString().slice(11, 16);

/** Discord shows this as "in 4 minutes" in the reader's own clock, and keeps it current. */
export const rel = (s) => '<t:' + Math.round(Number(s)) + ':R>';

export function dur(s) {
    const n = Math.max(0, Math.round(Number(s) || 0));
    if (n < 60) return n + ' s';
    if (n < 3600) return Math.round(n / 60) + ' min';
    const h = Math.floor(n / 3600);
    const m = Math.round((n % 3600) / 60);
    return m ? h + ' h ' + m + ' min' : h + ' h';
}

export const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');

export const dayStart = (s) => Math.floor(s / DAY_S) * DAY_S;

export const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Torn pages the bot links to. The user clicks; the Worker never opens them. */
export const PAGES = {
    items: TORN + 'item.php',
    gym: TORN + 'gym.php',
    points: TORN + 'points.php',
    travel: TORN + 'page.php?sid=travel',
    itemMarket: (id) => TORN + 'page.php?sid=ItemMarket#/market/view=search&itemID=' + encodeURIComponent(String(id)),
    bazaar: (id) => TORN + 'bazaar.php?userId=' + encodeURIComponent(String(id)) + '#/',
    profile: (id) => TORN + 'profiles.php?XID=' + encodeURIComponent(String(id)),
    attack: (id) => TORN + 'loader.php?sid=attack&user2ID=' + encodeURIComponent(String(id)),
    faction: (id) => TORN + 'factions.php?step=profile&ID=' + encodeURIComponent(String(id)),
    myFaction: TORN + 'factions.php?step=your',
};
