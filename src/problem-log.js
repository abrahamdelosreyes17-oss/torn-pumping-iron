/*
 * The problem log, this tab's side (core/errlog.js has the rules). Each tab
 * keeps its new lines and adds them to the stored log every few seconds and
 * when the page goes. The webpage holds the log (its own IndexedDB, a week);
 * a Torn page's lines wait in a small shared buffer until the webpage takes
 * them, so Tampermonkey never hands a long log to every Torn page.
 * Settings › Report a problem puts it in the zip. Userscript-only.
 */

import { gmGet, gmSet } from './platform/gm.js';
import { K } from './platform/store.js';
import { pageGet, pageSet } from './platform/archive.js';
import { addLogEntries, logText, LOG_BUFFER_MAX } from './core/errlog.js';

const PLOG_FLUSH_MS = 5000;
/** A freeze of the webpage this long is worth a line. */
export const FREEZE_NOTE_MS = 200;
/** Plan runs kept with their time. */
export const PLAN_RUNS_KEPT = 12;

const plog = { where: 'torn', pending: [], timer: null, started: false };

/** Where this tab is: the webpage's tab, or the Torn page (its path, never its query). */
function plogWhere() {
    if (typeof location === 'undefined') return '?';
    if (plog.where === 'app') return 'app ' + (String(location.hash || '#home').replace(/^#\/?/, '').split(/[?&]/)[0] || 'home');
    return 'torn ' + location.pathname.replace(/^\//, '') + (location.search && /[?&]sid=([a-z]+)/i.test(location.search) ? ' ' + location.search.match(/[?&]sid=([a-z]+)/i)[1] : '');
}

/** kind: 'error' (something failed), 'action' (what you did), 'note'. */
export function logProblem(kind, what, detail = null) {
    plog.pending.push({ at: Date.now(), kind, where: plogWhere(), what: logText(what), ...(detail ? { detail: logText(detail) } : {}) });
    if (!plog.timer && typeof setTimeout === 'function') plog.timer = setTimeout(flushProblemLog, PLOG_FLUSH_MS);
}

export const logAction = (what, detail = null) => logProblem('action', what, detail);
export const logNote = (what, detail = null) => logProblem('note', what, detail);

/** Something failed: into the log, with where in the app it was. */
export function logError(area, error) {
    const msg = String((error && error.message) || error || 'failed');
    const stack = error && error.stack ? String(error.stack).split('\n').slice(1, 4).map((l) => l.trim()).join(' | ') : null;
    logProblem('error', area + ': ' + msg + (error && error.code ? ' [code ' + error.code + ']' : ''), stack);
}

export function flushProblemLog() {
    if (plog.timer) clearTimeout(plog.timer);
    plog.timer = null;
    const add = plog.pending;
    plog.pending = [];
    if (plog.where === 'app') {
        // The webpage: its own lines and what Torn's pages left in the buffer.
        const buf = gmGet(K.problemBuf, null);
        const more = Array.isArray(buf) ? buf : [];
        if (!add.length && !more.length) return;
        pageSet(K.problemLog, addLogEntries(pageGet(K.problemLog, null), [...more, ...add]));
        if (more.length) gmSet(K.problemBuf, []);
        return;
    }
    if (!add.length) return;
    gmSet(K.problemBuf, addLogEntries(gmGet(K.problemBuf, null), add, Date.now(), LOG_BUFFER_MAX));
}

/** The whole log now (the webpage): stored, the buffer and this tab's unsaved lines. */
export function problemLogNow() {
    const buf = gmGet(K.problemBuf, null);
    return addLogEntries(pageGet(K.problemLog, null), [...(Array.isArray(buf) ? buf : []), ...plog.pending]);
}

export function clearProblemLog() {
    plog.pending = [];
    pageSet(K.problemLog, []);
    gmSet(K.problemBuf, []);
}

/**
 * A Create plan or Recalibrate that finished (or failed): how long it took, how
 * much of that with the tab not in front, kept with the last few.
 * @param {object} run - {at, kind: 'create'|'replan', months, days, ms, hiddenMs, ok, error, cancelled}
 */
export function notePlanRun(run) {
    const list = [...(gmGet(K.planRuns, null) || []), run].slice(-PLAN_RUNS_KEPT);
    gmSet(K.planRuns, list);
    const words = (run.kind === 'replan' ? 'Recalibrate' : 'Create plan') + ' ' + (run.months || '?') + (run.months === 1 ? ' month' : ' months') + ' (' + (run.days || '?') + ' days)';
    // Where the time went (session 10): comparing the plans, the path's stretches, its range.
    const PART = { compare: 'comparing', path: 'the path', band: 'the range' };
    const parts = Object.entries(run.parts || {}).filter(([k, v]) => PART[k] && v >= 100).map(([k, v]) => PART[k] + ' ' + (v / 1000).toFixed(1) + ' s');
    const time = (run.ms / 1000).toFixed(1) + ' s' + (run.hiddenMs > 0 ? ', ' + (run.hiddenMs / 1000).toFixed(1) + ' s of it with the tab not in front' : '') + (parts.length ? ' (' + parts.join(', ') + ')' : '');
    if (run.ok) logNote(words + ' took ' + time);
    else if (run.cancelled) logNote(words + ' cancelled after ' + time);
    else logProblem('error', words + ' failed after ' + time, run.error || null);
}

export const planRuns = () => gmGet(K.planRuns, null) || [];

/** Ours only, never Torn's page's own scripts. */
const plogOurs = (file, stack) => /userscript|tampermonkey|pumping-?iron|harness/i.test(String(file || '') + ' ' + String(stack || ''));

/**
 * Start logging in this tab: script errors (ours), and on the webpage the
 * moments the page froze. Called once from main.js.
 */
export function startProblemLog({ where = 'torn' } = {}) {
    plog.where = where;
    if (plog.started || typeof window === 'undefined') return;
    plog.started = true;
    window.addEventListener('pagehide', flushProblemLog);
    window.addEventListener('error', (ev) => {
        if (!plogOurs(ev.filename, ev.error && ev.error.stack)) return;
        logProblem('error', 'Script error: ' + (ev.message || 'unknown'), ((ev.error && ev.error.stack) || '').split('\n').slice(0, 4).join(' | '));
    });
    window.addEventListener('unhandledrejection', (ev) => {
        const r = ev.reason;
        if (!plogOurs('', r && r.stack)) return;
        logProblem('error', 'Script error (promise): ' + ((r && r.message) || String(r)), ((r && r.stack) || '').split('\n').slice(0, 4).join(' | '));
    });
    if (where !== 'app') return;
    // The webpage takes the Torn pages' lines every minute, and notes its own freezes (a long task: the page didn't answer).
    setInterval(flushProblemLog, 60000);
    try {
        if (typeof PerformanceObserver === 'function' && (PerformanceObserver.supportedEntryTypes || []).includes('longtask')) {
            new PerformanceObserver((list) => {
                let worst = 0;
                for (const e of list.getEntries()) worst = Math.max(worst, e.duration);
                if (worst >= FREEZE_NOTE_MS) logNote('The page froze for a moment', Math.round(worst) + ' ms');
            }).observe({ entryTypes: ['longtask'] });
        }
    } catch {
        // No long-task timing in this browser: nothing to note.
    }
}
