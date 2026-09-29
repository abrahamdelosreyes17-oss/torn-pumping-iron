/*
 * Wiring. The only file that knows it is a userscript; core/ and api/ are
 * plain modules tested under node.
 *
 * Two entry points share it:
 *   - every Torn page: the state feed (one visible leader tab), the overlay
 *     pill, the marks on the page being viewed, and Torn Eye chips;
 *   - the webpage (GitHub Pages app.html): the full tabs, drawn over the
 *     placeholder the page shows without the script.
 */

import { gmMenu, gmOpenTab } from './platform/gm.js';
import { set } from './platform/store.js';
import { pi, startFeed, refresh, onModel } from './runtime.js';
import { maybeSyncPlan } from './discord.js';
import { bootAppPage } from './app-page.js';
import { bootTornPage } from './torn-page.js';
import { bootEyePage } from './eye-page.js';
import { detectPage, isAppPageUrl, isTradingPageUrl, APP_PAGE_URL } from './sources/route.js';
import { watchTrading } from './turns.js';

function menus() {
    gmMenu('Open Pumping Iron', () => gmOpenTab(APP_PAGE_URL));
    gmMenu('Diagnostics', () => gmOpenTab(APP_PAGE_URL + '#settings'));
}

export function boot() {
    const href = typeof location !== 'undefined' ? location.href : '';
    const where = isAppPageUrl(href) ? 'app' : isTradingPageUrl(href) ? 'trading' : detectPage(href);
    set('lastBoot', { at: Date.now(), where, version: PI_BUILD_VERSION });
    if (typeof document !== 'undefined' && document.documentElement) document.documentElement.setAttribute('data-pi-booted', where);
    if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body) return;
    // Torn Trading's Torn Bids page: only note that Torn Trading runs (the two take turns). Nothing else here.
    if (where === 'trading') {
        watchTrading();
        return;
    }
    watchTrading();
    menus();
    if (where === 'app') bootAppPage();
    else {
        bootTornPage();
        bootEyePage();
    }
    startFeed();
    // The plan's next steps go to your Discord Worker when they change (if you set one up).
    onModel((m) => maybeSyncPlan(m));
    // Off torn.com (the harness), expose the model for checks. On torn.com the sandbox keeps it private anyway.
    if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(href)) window.__pi = { model: () => pi.model, refresh, feed: () => pi.feed };
}
