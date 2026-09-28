/*
 * Which page are we on? Pure string work, so it is testable.
 *
 * Every page the script marks is one the user opened; nothing here loads a
 * page. The harness stands in for Torn's pages with `?page=<name>` on its own
 * host (never on torn.com), the way the trading app's harness does.
 */

export const PAGE_GYM = 'gym';
export const PAGE_ITEMS = 'items';
export const PAGE_ITEM_MARKET = 'itemmarket';
export const PAGE_BAZAAR = 'bazaar';
export const PAGE_POINTS = 'points';
export const PAGE_PROFILE = 'profile';
export const PAGE_FACTION = 'faction';
export const PAGE_ATTACK = 'attack';
export const PAGE_OTHER = 'other';

/** The webpage the script draws over (GitHub Pages, gh-pages branch). */
export const APP_PAGE_URL = 'https://abrahamdelosreyes17-oss.github.io/torn-pumping-iron/app.html';

/** The harness boots the webpage on its own host with this marker. */
export const APP_PAGE_PARAM = 'pi';
export const APP_PAGE_VALUE = 'app';

function queryOf(href) {
    try {
        return new URL(href).searchParams;
    } catch {
        return new URLSearchParams();
    }
}

function hostOf(href) {
    try {
        return new URL(href).hostname.toLowerCase();
    } catch {
        return '';
    }
}

export function isTornHost(href) {
    return /(^|\.)torn\.com$/.test(hostOf(href));
}

/** A query value whatever its spelling (Torn's own links vary: XID, userId, userID). */
function param(href, name) {
    const want = name.toLowerCase();
    for (const [k, v] of queryOf(href)) if (k.toLowerCase() === want) return v;
    // Some Torn pages keep their parameters in the hash (#/p=...&ID=5).
    const hash = String(href || '').split('#')[1] || '';
    for (const part of hash.replace(/^\/+/, '').split(/[&?]/)) {
        const [k, v] = part.split('=');
        if (k && k.toLowerCase() === want) return v || '';
    }
    return null;
}

function numParam(href, name) {
    const v = param(href, name);
    return v && /^\d+$/.test(v) ? v : null;
}

/**
 * @param {string} href - normally location.href
 * @returns {string} one of the PAGE_* constants
 */
export function detectPage(href) {
    if (typeof href !== 'string' || !href) return PAGE_OTHER;
    const url = href.toLowerCase();

    // The harness: ?page=gym etc. on a host that is not Torn.
    if (!isTornHost(href)) {
        const p = (queryOf(href).get('page') || '').toLowerCase();
        const known = [PAGE_GYM, PAGE_ITEMS, PAGE_ITEM_MARKET, PAGE_BAZAAR, PAGE_POINTS, PAGE_PROFILE, PAGE_FACTION, PAGE_ATTACK];
        return known.includes(p) ? p : PAGE_OTHER;
    }

    if (url.includes('/gym.php')) return PAGE_GYM;
    if (url.includes('/item.php')) return PAGE_ITEMS;
    if (url.includes('sid=itemmarket') || url.includes('/imarket.php')) return PAGE_ITEM_MARKET;
    if (url.includes('/bazaar.php')) return PAGE_BAZAAR;
    if (url.includes('/pmarket.php')) return PAGE_POINTS;
    if (url.includes('/profiles.php')) return PAGE_PROFILE;
    if (url.includes('/factions.php')) return PAGE_FACTION;
    if (url.includes('sid=attack') && url.includes('loader.php')) return PAGE_ATTACK;
    return PAGE_OTHER;
}

/** The player a profile page shows (profiles.php?XID=), or null. */
export function profileIdOf(href) {
    return detectPage(href) === PAGE_PROFILE ? numParam(href, 'XID') : null;
}

/** The defender on the attack page (loader.php?sid=attack&user2ID=), or null. */
export function attackTargetOf(href) {
    return detectPage(href) === PAGE_ATTACK ? numParam(href, 'user2ID') : null;
}

/** Whose bazaar this is (bazaar.php?userId=), or null for your own. */
export function bazaarOwnerId(href) {
    return detectPage(href) === PAGE_BAZAAR ? numParam(href, 'userId') : null;
}

/** The faction a faction page shows (factions.php?step=profile&ID=), or null (your own). */
export function factionIdOf(href) {
    return detectPage(href) === PAGE_FACTION ? numParam(href, 'ID') : null;
}

/** The item the Item Market page is showing (#/market/view=search&itemID=), or null. */
export function itemMarketItemOf(href) {
    return detectPage(href) === PAGE_ITEM_MARKET ? numParam(href, 'itemID') : null;
}

export function isAppPageUrl(href) {
    if (String(href || '').split(/[?#]/)[0] === APP_PAGE_URL) return true;
    // The harness boots the webpage on its own page with the marker.
    return queryOf(href).get(APP_PAGE_PARAM) === APP_PAGE_VALUE && !isTornHost(href);
}

/* ---------------------------------------------------------- Torn links */

/*
 * Every action in the app is a link to the exact Torn page (owner rule 6).
 * One click, one navigation: nothing is bought, used or trained.
 */

export const TORN = 'https://www.torn.com/';

export function gymUrl() {
    return TORN + 'gym.php';
}

export function itemsUrl() {
    return TORN + 'item.php';
}

export function pointsMarketUrl() {
    return TORN + 'pmarket.php';
}

export function bazaarUrl(userId) {
    return TORN + 'bazaar.php?userId=' + encodeURIComponent(String(userId)) + '#/';
}

export function itemMarketUrl(itemId) {
    return TORN + 'page.php?sid=ItemMarket#/market/view=search&itemID=' + encodeURIComponent(String(itemId));
}

export function profileUrl(userId) {
    return TORN + 'profiles.php?XID=' + encodeURIComponent(String(userId));
}

export function attackUrl(userId) {
    return TORN + 'loader.php?sid=attack&user2ID=' + encodeURIComponent(String(userId));
}

export function factionUrl(factionId) {
    return TORN + 'factions.php?step=profile&ID=' + encodeURIComponent(String(factionId));
}

export function apiKeyPageUrl() {
    return TORN + 'preferences.php#tab=api';
}
