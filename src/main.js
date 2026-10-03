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
import { set, dropOldKeys } from './platform/store.js';
import { pi, startFeed, refresh, onModel, setWhere, createPlan, recalibratePlan, followStrategy, cancelPlan } from './runtime.js';
import { maybeSyncPlan, onSkipped } from './discord.js';
import { bootAppPage } from './app-page.js';
import { bootTornPage } from './torn-page.js';
import { bootEyePage } from './eye-page.js';
import { detectPage, isAppPageUrl, isTradingPageUrl, APP_PAGE_URL } from './sources/route.js';
import { watchTrading } from './turns.js';
import { gymLogTick } from './income.js';
import { startProblemLog, logNote } from './problem-log.js';

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
    // Round 6: what 1.2.3 kept for the comparison it ran on every page goes (Tampermonkey hands every key to every page).
    dropOldKeys();
    // The webpage holds the whole saved plan; Torn's pages only follow it.
    setWhere(where === 'app' ? 'app' : 'torn');
    // The problem log (Settings › Report a problem): script errors of ours, and on the webpage its own freezes.
    startProblemLog({ where: where === 'app' ? 'app' : 'torn' });
    // The report says which build was running and when the webpage was opened (bug hunt A.7); Torn's pages, opened
    // many times a minute, do not write one.
    if (where === 'app') logNote('Pumping Iron ' + PI_BUILD_VERSION + ' opened');
    if (where === 'app') bootAppPage();
    else {
        bootTornPage();
        bootEyePage();
    }
    startFeed();
    // The plan's next steps go to your Discord Worker when they change (if you set one up).
    onModel((m) => maybeSyncPlan(m));
    // A step skipped in Discord: the model follows at once (Torn pages rebuild only when due otherwise).
    onSkipped(() => refresh());
    // Trains Torn logged that no read saw (your phone, the laptop closed): the webpage reads them every 15 minutes (Full key).
    if (where === 'app') {
        setTimeout(gymLogTick, 20000);
        setInterval(gymLogTick, 60000);
    }
    // Off torn.com (the harness), expose the model for checks. On torn.com the sandbox keeps it private anyway.
    if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(href)) window.__pi = { model: () => pi.model, refresh, feed: () => pi.feed, createPlan, recalibratePlan, followStrategy, cancelPlan, extras: () => pi.planExtras || Promise.resolve(null), busy: () => pi.planBusy };
}
