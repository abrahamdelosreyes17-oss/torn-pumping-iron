/*
 * Wiring. The only file that knows it is a userscript; core/ and api/ are
 * plain modules tested under node.
 *
 * Two entry points share it:
 *   - every Torn page: the overlay pill, the marks on the page being viewed,
 *     and Torn Eye chips;
 *   - the webpage (GitHub Pages app.html): the full tabs, drawn over the
 *     placeholder the page shows without the script.
 */

import { gmGet, gmSet } from './platform/gm.js';
import { detectPage, isAppPageUrl } from './sources/route.js';

export function boot() {
    const href = typeof location !== 'undefined' ? location.href : '';
    const where = isAppPageUrl(href) ? 'app' : detectPage(href);
    gmSet('lastBoot', { at: Date.now(), where, version: PI_BUILD_VERSION });
    if (typeof document !== 'undefined' && document.documentElement) {
        document.documentElement.setAttribute('data-pi-booted', where);
    }
    return gmGet('lastBoot', null);
}
