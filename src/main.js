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
import { pi, startFeed, refresh } from './runtime.js';
import { bootAppPage } from './app-page.js';
import { bootTornPage } from './torn-page.js';
import { detectPage, isAppPageUrl, isTornHost, APP_PAGE_URL } from './sources/route.js';

function menus() {
    gmMenu('Open Pumping Iron', () => gmOpenTab(APP_PAGE_URL));
    gmMenu('Diagnostics', () => gmOpenTab(APP_PAGE_URL + '#settings'));
}

export function boot() {
    const href = typeof location !== 'undefined' ? location.href : '';
    const where = isAppPageUrl(href) ? 'app' : detectPage(href);
    set('lastBoot', { at: Date.now(), where, version: PI_BUILD_VERSION });
    if (typeof document !== 'undefined' && document.documentElement) document.documentElement.setAttribute('data-pi-booted', where);
    if (typeof window === 'undefined' || typeof document === 'undefined' || !document.body) return;
    menus();
    if (where === 'app') bootAppPage();
    else bootTornPage();
    startFeed();
    // Off torn.com (the harness), expose the model for checks. On torn.com the sandbox keeps it private anyway.
    if (!isTornHost(href)) window.__pi = { model: () => pi.model, refresh, feed: () => pi.feed };
}
