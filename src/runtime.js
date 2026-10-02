/*
 * What every tab shares at run time: the one Torn client (85/min across
 * tabs, visible only, silent while Torn Trading runs), the state feed, and the model every surface renders
 * from. Userscript-only; core/ and api/ stay plain modules.
 */

import { gmOnChange } from './platform/gm.js';
import { K, get, set, del, getKey, getSettings, getPlan, setPlan, getPrices, getShared } from './platform/store.js';
import { tabWindow } from './platform/tab-window.js';
import { makeTabId, LEADER_HEARTBEAT_MS } from './core/leader.js';
import { focusFrom, FOCUS_FRESH_MS } from './core/lanes.js';
import { TornApiClient } from './api/client.js';
import { StateFeed } from './feed/state.js';
import { normalizeState, tornDayStart } from './core/bars.js';
import { buildModel, compareSteps, simInputs, compareStrategiesAsync, blissWhatIfSteps, companyWhatIfSteps, playerContext, buildOf, isDrugEntry, specialLeft, heldBoosters, steadyCostPerDay, openByOf, gymWorthSteps } from './core/model.js';
import { recommend, pickWarning, PICK_BY } from './core/recommend.js';
import { targetShares } from './core/plan.js';
import { INCOME_MIN_DAYS, budgetOf, incomeFrom, autoState, effectivePickBy, incomeBreakdown } from './core/auto.js';
import { incomeFloor } from './core/income-floor.js';
import { eventsBetween } from './core/events.js';
import { yearSteps, segEvents, unlockHook, segmentsOf } from './core/year.js';
import { planWindow, scheduleAt, daysLeft, planProgress, snapshotOf, makeSavedPlan, planNowOf, usablePlanNow, SAVED_PLAN_V } from './core/saved-plan.js';
import { loadSavedPlan, saveSavedPlan } from './platform/plan-store.js';
import { archived, pageGet, pageSet, archivesReady } from './platform/archive.js';
import { summarizeReceipts } from './core/receipts.js';
import { livePrices } from './core/market.js';
import { TORN_PER_MINUTE_ALONE } from './core/turns.js';
import { isPaused, onPauseChange } from './turns.js';
import { useDampingMode } from './core/gain.js';
import { parsePerks } from './core/perks.js';
import { joinFights, runLearning, learnedModel } from './core/learndata.js';
import { applyGymModel } from './core/learn.js';
import { logAction, logError, logNote, notePlanRun } from './problem-log.js';
import { makeLine, addLine } from './core/planline.js';
import { makePause, runSliced, PlanCancelled } from './core/slices.js';
import { STRATEGIES } from './core/strategies.js';

export const pi = {
    tabId: makeTabId(),
    client: null,
    feed: null,
    model: null,
    // 'app' (the webpage) or 'torn' (Torn's pages): main.js says which.
    where: 'app',
    // The whole saved plan (webpage), and a Create plan / Recalibrate being worked out.
    saved: null,
    savedLoading: null,
    planBusy: null,
    listeners: [],
};

export function isVisible() {
    return typeof document === 'undefined' || document.visibilityState !== 'hidden';
}

export const storeApi = { get: (k, fb) => get(k, fb), set: (k, v) => set(k, v), del: (k) => del(k) };

/**
 * Our share of Torn's 100 calls a minute (per player, every tool together).
 * Pumping Iron and Torn Trading (NPC Arbitrage, Torn Bids) take turns: while
 * Torn Trading runs, this makes no Torn call at all, so it may use Torn
 * Trading's own 70. The plan needs ~2 a minute; only Torn Eye sweeps and
 * price loads come near it, and they queue.
 */
export const TORN_PER_MINUTE = TORN_PER_MINUTE_ALONE;

/** A burst of Torn calls writes its request window once every 2 s, not once a call (round 6; there is room: 85 of Torn's 100). */
export const WINDOW_BATCH_MS = 2000;

/** Where each tab's focus heartbeat is kept ({tabId: {focus, war, at}}), and each side's shared minute. */
const FOCUS_KEY = 'apiFocus';
const laneWindows = {};
function laneWindow(side) {
    if (!laneWindows[side]) laneWindows[side] = tabWindow('apiLane_' + side, pi.tabId, storeApi, undefined, { batchMs: WINDOW_BATCH_MS });
    return laneWindows[side];
}

/** What's open across the tabs (core/lanes.js): Torn Eye, prices, both or neither. */
export function apiFocus(now = Date.now()) {
    return focusFrom(get(FOCUS_KEY, {}) || {}, now);
}

/** Lane options every Torn client in this tab shares. */
function laneOptions() {
    return { focus: () => apiFocus(), loadLaneWindow: (side) => laneWindow(side).load(), addLaneWindow: (side, at) => laneWindow(side).add(at) };
}

/**
 * This tab says what it shows, so the Torn calls for it go first: a page
 * sets `pi.focusOf` (() => {focus: 'eye'|'prices'|null, war}); a heartbeat
 * every few seconds keeps it fresh while the tab is visible.
 */
export function beatFocus(now = Date.now()) {
    const all = { ...(get(FOCUS_KEY, {}) || {}) };
    const mine = isVisible() && pi.focusOf ? pi.focusOf() : null;
    const had = all[pi.tabId];
    // Old entries from closed tabs go too.
    for (const [id, b] of Object.entries(all)) if (!b || !(now - (b.at || 0) < FOCUS_FRESH_MS * 4)) delete all[id];
    if (mine && (mine.focus || mine.war)) all[pi.tabId] = { focus: mine.focus || null, war: Boolean(mine.war), at: now };
    else delete all[pi.tabId];
    // Written when what this tab shows changes, or to renew it (the time alone is not a change).
    const same = (x, y) => (x ? x.focus + ':' + x.war : '') === (y ? y.focus + ':' + y.war : '');
    if (!same(had, all[pi.tabId]) || (all[pi.tabId] && now - ((had && had.at) || 0) > FOCUS_FRESH_MS / 3)) set(FOCUS_KEY, all);
}

/** This tab's request window (one for every Torn client here: two on the same key hid each other's slots). */
function apiWindow() {
    if (!pi.apiWindow) pi.apiWindow = tabWindow('apiWindow', pi.tabId, storeApi, undefined, { batchMs: WINDOW_BATCH_MS });
    return pi.apiWindow;
}

/** Write every batched request window now (the page is going). */
function flushWindows() {
    if (pi.apiWindow) pi.apiWindow.flush();
    for (const w of Object.values(laneWindows)) w.flush();
}

/** The one Torn client every part of this tab uses: 85/min across tabs, visible only, nothing while paused; what's open goes first. */
export function tornClient() {
    if (pi.client) return pi.client;
    const win = apiWindow();
    pi.client = new TornApiClient({
        maxPerMinute: TORN_PER_MINUTE,
        // A key Torn refused (2, 13, 18) is not used again, by any part of any tab, until a new one is saved.
        getKey: () => (get(K.apiKeyDead, false) ? '' : getKey(K.apiKey)),
        loadWindow: () => win.load(),
        addToWindow: (at) => win.add(at),
        loadPause: () => get(K.apiPause, null),
        savePause: (p) => set(K.apiPause, p),
        isVisible,
        onDeadKey: () => set(K.apiKeyDead, true),
        isPaused: () => isPaused(),
        ...laneOptions(),
    });
    return pi.client;
}

/**
 * The Full key's own client (Auto mode: only your money log). Same shared
 * 70-a-minute window as the main client; a refused key is marked, never retried.
 */
export function fullKeyClient() {
    if (pi.fullClient) return pi.fullClient;
    const win = apiWindow();
    pi.fullClient = new TornApiClient({
        maxPerMinute: TORN_PER_MINUTE,
        getKey: () => ((get(K.fullKeyState, {}) || {}).dead ? '' : getKey(K.fullKey)),
        loadWindow: () => win.load(),
        addToWindow: (at) => win.add(at),
        loadPause: () => get(K.apiPause, null),
        savePause: (p) => set(K.apiPause, p),
        isVisible,
        onDeadKey: () => set(K.fullKeyState, { ...(get(K.fullKeyState, {}) || {}), ok: false, dead: true, error: 'Torn refused the Full key', at: Date.now() }),
        isPaused: () => isPaused(),
        ...laneOptions(),
    });
    return pi.fullClient;
}

/** Is a working Full key saved (Auto mode's condition)? */
export function hasFullKey() {
    const st = get(K.fullKeyState, {}) || {};
    return Boolean(getKey(K.fullKey)) && st.ok === true && !st.dead;
}

/**
 * Income (Auto, "Plan from my income"): from the money log (Full key) or the
 * networth history, plus what the gym plan spent meanwhile. Read when a plan
 * is made or recalibrated, and on the webpage to show it.
 * @param {function} steadyPerDay - the steady plan's cost a day, while receipts cover under 3 days (it doesn't depend on the budget)
 */
function autoFor(plan, settings, statics, steadyPerDay) {
    // What the gym really cost over the same days (receipts), added back: it left your networth and shows in the log's "out".
    // Never the plan's own projected cost, which would feed the budget back into itself.
    const now = Date.now();
    const rc = archived(K.receipts, null);
    const today = tornDayStart(now);
    // 30 Torn days, today included.
    const sum = rc ? summarizeReceipts(rc, today - 29 * 86400e3, today, { prices: getPrices(), priceHistory: archived(K.priceHistory, null) }) : null;
    const spentPerDay = sum && sum.days >= INCOME_MIN_DAYS ? sum.cost / sum.days : plan.pickBy === 'auto' && hasFullKey() ? steadyPerDay() : 0;
    const income = incomeFrom(statics.income || [], { spentPerDay });
    const ml = pageGet(K.moneyLog, null);
    // The income that is certain (bank, dividends, rent), read with the main key: the floor under the rest.
    const pv = statics.passive || null;
    const floor = pv ? incomeFloor({ ...pv, meId: statics.keyInfo && statics.keyInfo.userId, now }) : null;
    const breakdown = ml && ml.log ? incomeBreakdown(ml.log, ml.at || Date.now(), ml.days || null, floor) : null;
    const auto = autoState({ plan, settings, hasFullKey: hasFullKey(), income, log: breakdown, spentPerDay, floor });
    auto.breakdown = breakdown;
    auto.income = income;
    return auto;
}

/** Your faction's war, as Torn Eye last read it (its wars every 5 minutes): on now or within a day, read in the last 6 hours. */
export function warOnNow(now = Date.now(), statics = null) {
    // The feed reads your faction's wars every 15 minutes; Torn Eye's own read (webpage) counts too, whichever is newer.
    const fw = statics && statics.factionWars;
    const ea = get('eyeWarAuto', null);
    const w = [fw, ea].filter((x) => x && Array.isArray(x.enemies)).sort((a, b) => (b.at || 0) - (a.at || 0))[0];
    if (!w || !w.enemies.length || !(now - (w.at || 0) < 6 * 3600e3)) return null;
    const nowS = Math.floor(now / 1000);
    return w.enemies.find((e) => (!e.start || e.start - nowS <= 86400) && (!e.end || e.end > nowS)) || null;
}

/** This build's version (Diagnostics; a saved plan's shape is versioned in core/saved-plan.js). */
export const BUILD = (typeof PI_BUILD_VERSION !== 'undefined' ? PI_BUILD_VERSION : 'dev') + '+' + (typeof PI_BUILD_HASH !== 'undefined' ? PI_BUILD_HASH : 'dev');

/** The part of the saved plan Torn's pages and the bot follow (GM, a few KB), if there is one. */
export function planNowStored() {
    return usablePlanNow(getShared(K.planNow, null));
}

/**
 * The whole saved plan (webpage): read from IndexedDB once, and again when
 * another tab saves a new one (planNow's `rev` moves).
 */
function savedFor(pn) {
    if (!pn) return null;
    // The same plan, with its what-ifs if they have been added since (another tab worked them out).
    if (pi.saved && pi.saved.rev === pn.rev && (pi.saved.extrasAt || 0) >= (pn.extrasAt || 0)) return pi.saved;
    const want = pn.rev + ':' + (pn.extrasAt || 0);
    if (pi.savedLoading !== want) {
        pi.savedLoading = want;
        loadSavedPlan()
            .then((p) => {
                if (p && p.rev === pn.rev) {
                    pi.saved = p;
                    refresh();
                } else pi.savedLoading = null;
            })
            .catch(() => {
                pi.savedLoading = null;
            });
    }
    return null;
}

/** Listeners for a running plan's progress (the Plan card's bar and words): called with the busy record. */
const progressListeners = [];
export function onPlanProgress(fn) {
    progressListeners.push(fn);
}

/** The Plan card's Cancel: the run stops at its next break, nothing is saved, the old plan stays. */
export function cancelPlan() {
    if (pi.planBusy) pi.planBusy.cancel = true;
}

/** How much of a run each part is (measured: the comparison about 40%, the path about 45%, its range the rest). */
const RUN_SHARE = { compare: 0.4, path: 0.45, band: 0.15 };

/**
 * Create plan (1, 3, 6 or 12 months) or Re-plan, on a click only: every plan
 * is worked out over the plan's days from what's true now (stats, income,
 * prices, gyms), the best one is recommended, and the whole thing is saved
 * with what it saw. Re-plan keeps the plan's start and end and re-plans only
 * the days left.
 *
 * Round 7 (R7.3b): worked out in slices of about 30 ms with breaks that are
 * not timers (so it finishes in a tab you left), with live progress and
 * Cancel; nothing is saved until the end, so a cancelled run leaves the old
 * plan. The what-ifs (Bliss, a company, what each gym is worth) are worked
 * out after the plan is saved and shown, and added to it.
 * @param {object} o - {months: 1|3|6|12} or {recalibrate: true}; `pause` (tests): the caller's own break, and the
 *   what-ifs are waited for
 * @returns {Promise<object|null>} the saved plan (null: cancelled)
 */
export async function createPlan({ months = 1, recalibrate = false, pause: pauseIn = null } = {}) {
    if (pi.planBusy) return pi.planBusy.promise;
    const busy = { recalibrate, months, at: Date.now(), promise: null, part: 'start', done: 0, words: 'Reading what is true now', cancel: false };
    const cancelled = () => busy.cancel === true;
    // Breaks for the page: a message to ourselves, not a timer (a hidden tab's timers run once a second at best:
    // 3 seconds of work took minutes), and only once 30 ms of work is done since the last one.
    const own = pauseIn ? null : makePause({ cancelled });
    const pause = own || (() => (cancelled() ? Promise.reject(new PlanCancelled()) : pauseIn()));
    let told = 0;
    const tell = (part, done, words) => {
        const moved = part !== busy.part;
        busy.part = part;
        busy.done = Math.max(busy.done, Math.min(1, done));
        busy.words = words;
        // The card is told when the run moves to its next part, and otherwise at most ten times a second.
        const t = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
        if (!moved && t - told < 100 && done < 1) return;
        told = t;
        for (const fn of progressListeners) {
            try {
                fn(busy);
            } catch {
                // A listener's own problem never stops the run.
            }
        }
    };
    let extrasCtx = null;
    const run = (async () => {
        const now = Date.now();
        const s = get(K.userState, null);
        const state = s && s.api ? normalizeState(s.api, s.at) : null;
        if (!state) throw new Error('Waiting for the first read of your stats.');
        const prev = recalibrate ? await loadSavedPlan() : null;
        if (recalibrate && !(prev && prev.v === SAVED_PLAN_V)) throw new Error('No plan to re-plan yet: create one first.');
        if (recalibrate && planProgress(prev, now).ended) throw new Error('Your plan has ended: create a new one.');
        const plan = getPlan();
        const settings = getSettings();
        // The candy the plan named stays unless another is clearly cheaper now (candy.js's 10% rule).
        const keptCandy = prev && prev.compare && prev.compare[plan.strategy] && prev.compare[plan.strategy].candy;
        const statics = { ...(getShared(K.userStatic, {}) || {}), xanaxCds: get(K.xanaxCds, []) || [], candyPick: keptCandy ? { day: tornDayStart(state.at), id: keptCandy.id } : null };
        const win = recalibrate ? { start: prev.start, end: prev.end, months: prev.months, days: daysLeft(prev, now) } : planWindow(months, now);
        const pc = playerContext(state, statics, { unlockedKnown: get(K.unlocked, null), learnedMult: learnedNow().mult, learnedHappyLoss: learnedNow().happyLoss });
        const shares = targetShares(plan, pc.stats, buildOf(plan.build).shares);
        const prices = getPrices();
        const special = specialLeft(plan, state);
        // Money a day: Auto from your income (Full key), "Max gains" none, else the budget you set, per day.
        const auto = autoFor(plan, settings, statics, () => steadyCostPerDay({ state, pc, shares, settings: { ...settings, horizonDays: 30 }, prices, special, statics }));
        const perDay = plan.pickBy === 'max' ? Infinity : auto.ready ? auto.budgetPerDay : budgetOf(settings) / (settings.horizonDays || 30);
        const runSettings = { ...settings, horizonDays: win.days, budget: Number.isFinite(perDay) ? perDay * win.days : Infinity };
        const pickBy = effectivePickBy(PICK_BY[plan.pickBy] ? plan.pickBy : 'most', auto);
        // `live`: every plan starts from the bars as they are now (round 7), like today's steps do.
        const args = { state, pc, shares, settings: runSettings, prices, special, statics, pickBy, live: true };
        // R6.5: the events on their dates and the gyms opening as energy is trained, in every plan's run.
        const from = recalibrate ? tornDayStart(now) : win.start;
        const cal = statics.calendar || null;
        const events = eventsBetween(cal && cal.calendar, from, win.end, { startTime: cal && cal.startTime });
        const gp = get(K.gymProgress, null);
        const top = Math.max(1, ...pc.unlocked.filter((id) => id <= 24));
        const progress = gp && Number(gp.nextId) === top + 1 ? { top, energy: Number(gp.energy) || 0 } : null;
        const hookFor = (stopAt) => unlockHook({ top, progress: progress ? progress.energy : 0, gymExpMult: pc.perks.gymExpMult || 1, table: pc.table, active: state.gymId, known: pc.unlocked.filter((id) => id > 24), paid: new Set(pc.unlocked.filter((id) => id > 24)), ...(stopAt ? { stopAt } : {}) });
        const hook = hookFor(null);
        // The comparison: each plan over the whole length (its id is yielded as it starts).
        const names = [];
        const nPlans = 8;
        const compare = await runSliced(compareSteps({ ...args, events: segEvents(events, { from, to: win.end }), unlock: hook }), pause, (v) => {
            if (typeof v !== 'string') return;
            names.push(v);
            tell('compare', (RUN_SHARE.compare * (names.length - 0.5)) / Math.max(nPlans, names.length), 'Comparing plans: ' + ((STRATEGIES_NAME(v) || v).toLowerCase()) + ' (' + names.length + ')');
        });
        // Round 7: a gym to unlock never outranks stats. Every plan says when it opens the gym; an "open it by" date
        // leaves out the plans that miss it, then the Plan rule picks as usual.
        const openBy = openByOf(plan, pc, from, win.days);
        const budget = budgetOf(runSettings);
        const rec = recommend(compare, { budget, bliss: pc.perks.bliss, pickBy, openBy });
        // The path: the best plan again every 30 days and for each event, from the stats projected for that day.
        const nSegs = Math.max(1, segmentsOf(from, win.end, events).length);
        let seg = 0;
        let band = 0;
        const year = await runSliced(yearSteps({ compare: compareSteps, inputs: simInputs, args, start: from, end: win.end, budgetPerDay: perDay, events, progress, openBy }), pause, (v) => {
            if (v && typeof v === 'object' && Number.isFinite(v.from)) {
                seg++;
                const day = Math.round((v.from - from) / 86400e3) + 1;
                tell('path', RUN_SHARE.compare + (RUN_SHARE.path * (seg - 0.5)) / nSegs, 'Your ' + (win.months > 1 ? win.months + ' months' : 'month') + ': day ' + day + ' of ' + win.days);
            } else if (v === 'band') {
                band++;
                tell('band', RUN_SHARE.compare + RUN_SHARE.path + (RUN_SHARE.band * band) / (2 * nSegs), 'The range of the plan (a little better, a little worse)');
            }
        });
        tell('save', 1, 'Saving your plan');
        const snapshot = snapshotOf({ state, pc, statics, plan, prices: livePrices(prices), income: auto.ready ? { perDay: auto.perDay, source: auto.source, days: auto.days, certain: auto.floor ? { perDay: auto.floor.perDay, bank: auto.floor.bank, dividends: auto.floor.dividends, rent: auto.floor.rent } : null } : null, budgetPerDay: Number.isFinite(perDay) ? perDay : null, held: heldBoosters(statics.inventory), now });
        // The what-ifs come after the plan is saved and shown (`extras: 'pending'` until they are in).
        const saved = makeSavedPlan({ compare, rec, snapshot, start: win.start, end: win.end, months: win.months, days: win.days, budget, whatIf: null, jobWhatIf: [], prev, year, gymWorth: [], extras: 'pending', now });
        const best = compare[rec.recommended];
        const warn = {};
        for (const [id, r] of Object.entries(compare)) if (r && best && id !== rec.recommended) warn[id] = pickWarning(best, r, { bliss: pc.perks.bliss, days: win.days }).warn;
        if (cancelled()) throw new PlanCancelled();
        await saveSavedPlan(saved);
        pi.saved = saved;
        set(K.planNow, planNowOf(saved, warn));
        // The plan followed: the path (today's segment); a plan you picked yourself stays through a recalibration.
        const cur = getPlan();
        const keep = recalibrate && cur.strategyPicked && compare[cur.strategy];
        const strategy = keep ? cur.strategy : year.segments.length ? year.segments[0].strategy : rec.recommended;
        setPlan({ ...cur, strategy, strategyPicked: Boolean(keep), createdAt: now });
        recordPlanLine(saved, keep ? strategy : 'path', now, recalibrate ? 'replan' : 'create');
        extrasCtx = { args, compare, rec, bliss: pc.perks.bliss, gymArgs: { ...args, events: segEvents(events, { from, to: win.end }) }, hookFor };
        return saved;
    })();
    busy.promise = run;
    pi.planBusy = busy;
    refresh();
    // How long it took, and how much of that with the tab not in front (the problem log; Settings › Report a problem).
    const t0 = Date.now();
    let hiddenMs = 0;
    let hidAt = isVisible() ? null : t0;
    const onVis = () => {
        if (!isVisible() && hidAt === null) hidAt = Date.now();
        else if (isVisible() && hidAt !== null) {
            hiddenMs += Date.now() - hidAt;
            hidAt = null;
        }
    };
    const doc = typeof document !== 'undefined' && typeof document.addEventListener === 'function' ? document : null;
    if (doc) doc.addEventListener('visibilitychange', onVis);
    logAction(recalibrate ? 'Re-plan pressed' : 'Create plan pressed (' + months + (months === 1 ? ' month)' : ' months)'));
    const done = (ok, error, saved) => {
        if (doc) doc.removeEventListener('visibilitychange', onVis);
        if (hidAt !== null) hiddenMs += Date.now() - hidAt;
        notePlanRun({ at: t0, kind: recalibrate ? 'replan' : 'create', months: saved ? saved.months : months, days: saved ? saved.days : null, ms: Date.now() - t0, hiddenMs, ok, cancelled: Boolean(error && error.cancelled), error: ok ? null : String((error && error.message) || error) });
    };
    let saved = null;
    try {
        saved = await run;
        done(true, null, saved);
    } catch (error) {
        done(false, error, null);
        // Cancelled: nothing was saved, the old plan stays; not an error to show.
        if (!(error && error.cancelled)) throw error;
        return null;
    } finally {
        if (own) own.stop();
        pi.planBusy = null;
        refresh();
    }
    // The what-ifs, after the plan is saved and shown. A caller with its own pause (tests) waits for them.
    pi.planExtras = planExtras(saved, extrasCtx, pauseIn);
    if (pauseIn) return (await pi.planExtras) || saved;
    return saved;
}

/**
 * What a saved plan gets after it is shown (round 7, R7.3b): what each gym
 * the recommended plan opens is worth, the Bliss what-if, the company
 * what-ifs. Worked out in slices; dropped if another run starts or the plan
 * is replaced meanwhile. Then the plan is saved again with them.
 */
async function planExtras(saved, ctx, pauseIn = null) {
    const rev = saved.rev;
    const alive = () => !pi.planBusy && pi.saved && pi.saved.rev === rev;
    const own = pauseIn ? null : makePause({ cancelled: () => !alive() });
    const pause = own || pauseIn;
    const t0 = Date.now();
    try {
        // Is each gym the recommended plan opens worth its fee: the plan with and without it.
        const gymWorth = await runSliced(gymWorthSteps(ctx.compare[ctx.rec.recommended], ctx.gymArgs, ctx.hookFor), pause);
        // Ignorance Is Bliss, what if: only while the book isn't active (active, the real plans already use it).
        const whatIf = ctx.bliss ? null : await runSliced(blissWhatIfSteps(ctx.args), pause);
        const jobWhatIf = await runSliced(companyWhatIfSteps({ ...ctx.args, compare: ctx.compare, recommended: ctx.rec.recommended }), pause);
        if (!alive()) return null;
        const next = { ...pi.saved, gymWorth, whatIf, jobWhatIf, extras: 'done', extrasAt: Date.now() };
        await saveSavedPlan(next);
        if (!alive()) return null;
        pi.saved = next;
        // The other tabs of the webpage read the plan again (its small part says the what-ifs are in).
        const pn = getShared(K.planNow, null);
        if (pn && pn.rev === rev) set(K.planNow, { ...pn, extrasAt: next.extrasAt });
        logNote('The what-ifs after the plan took ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s');
        refresh();
        return next;
    } catch (error) {
        if (!(error && error.cancelled)) logError('The what-ifs after the plan', error);
        return null;
    } finally {
        if (own) own.stop();
    }
}

/** A plan's short name for the progress words. */
function STRATEGIES_NAME(id) {
    return STRATEGIES[id] ? STRATEGIES[id].short : null;
}

/** Recalibrate (a click): the plan's end stays, the days left are re-planned from what's true now. */
export function recalibratePlan(o = {}) {
    return createPlan({ ...o, recalibrate: true });
}

/**
 * Picking another of the saved plans yourself (the Plan page): followed the
 * whole length, nothing worked out again; Progress's line follows the pick.
 */
export function followStrategy(id) {
    const saved = pi.saved;
    const cur = getPlan();
    setPlan({ ...cur, strategy: id, strategyPicked: true, createdAt: Date.now() });
    if (saved && saved.compare && saved.compare[id]) recordPlanLine(saved, id, Date.now(), 'pick');
    logAction('Picked the plan ' + id);
    refresh();
}

/** Back to the saved path (the recommended plan for each stretch, switching on its dates). */
export function followPath() {
    const saved = pi.saved;
    const cur = getPlan();
    const seg = scheduleAt(saved && saved.year ? saved.year.segments : null, Date.now());
    setPlan({ ...cur, strategy: seg ? seg.strategy : cur.strategy, strategyPicked: false, createdAt: Date.now() });
    if (saved) recordPlanLine(saved, saved.year ? 'path' : cur.strategy, Date.now(), 'path');
    logAction('Back to the saved plan');
    refresh();
}

/**
 * Where this tab runs: 'app' (the webpage: the whole saved plan, Plan,
 * Progress, Buy) or 'torn' (Torn's pages: today's steps from the saved plan,
 * re-timed from live timers; nothing else is worked out there).
 */
export function setWhere(where) {
    pi.where = where;
}

/** The model every surface renders from. */
export function currentModel(now = Date.now()) {
    const s = get(K.userState, null);
    const state = s && s.api ? normalizeState(s.api, s.at) : null;
    if (!state) return { ready: false, hasKey: Boolean(getKey(K.apiKey)), keyDead: Boolean(get(K.apiKeyDead, false)) };
    // Your Xanax cooldowns ride along with the stored data (the day plan reads them).
    const statics = { ...(getShared(K.userStatic, {}) || {}), xanaxCds: get(K.xanaxCds, []) || [] };
    const plan = getPlan();
    const settings = getSettings();
    const app = pi.where === 'app';
    const pn = planNowStored();
    const saved = app ? savedFor(pn) : null;
    const pc = playerContext(state, statics, { unlockedKnown: get(K.unlocked, null), learnedMult: learnedNow().mult, learnedHappyLoss: learnedNow().happyLoss });
    // The gym the plan was to unlock is open: the goal has nothing left to do (round 7; cleared once, on the webpage).
    if (app && plan.goal && plan.goal.kind === 'unlockGym' && pc.unlocked.map(Number).includes(Number(plan.goal.gymId))) {
        setPlan({ ...getPlan(), goal: null });
        logNote('The gym to unlock is open: the goal is cleared');
    }
    // The saved plan's numbers: every plan's whole result on the webpage, the small part on Torn's pages.
    let compare = null;
    let rec = null;
    let planSettings = settings;
    // The saved path: today's segment's plan, unless you picked one yourself (a switch on its date is the plan).
    const seg = pn && !plan.strategyPicked ? scheduleAt(pn.schedule, now) : null;
    const followed = seg && seg.strategy ? { ...plan, strategy: seg.strategy } : plan;
    if (pn) {
        compare = saved ? saved.compare : pn.slim;
        // This stretch's own candy and Xanax a day (the path re-picks them every stretch).
        if (seg && compare[seg.strategy] && (seg.candy || Number.isFinite(seg.xanaxPerDay))) compare = { ...compare, [seg.strategy]: { ...compare[seg.strategy], ...(seg.candy ? { candy: seg.candy } : {}), ...(Number.isFinite(seg.xanaxPerDay) ? { xanaxPerDay: seg.xanaxPerDay } : {}) } };
        rec = saved ? saved.rec : { recommended: pn.recommended, pickBy: pn.pickBy, alternatives: [], reasons: [] };
        planSettings = { ...settings, horizonDays: pn.days, budget: pn.budget === null ? Infinity : pn.budget };
    }
    // Income (Plan's "Plan from my income"): read on the webpage only, where a plan is made.
    const auto = app ? autoFor(plan, settings, statics, () => (pn && pn.slim.steady ? pn.slim.steady.cost / pn.days : 0)) : null;
    const planInfo = pn ? { start: pn.start, end: pn.end, months: pn.months, days: pn.days, from: pn.from, createdAt: pn.createdAt, recalibratedAt: pn.recalibratedAt, progress: planProgress(pn, now), whole: Boolean(saved) } : null;
    const m = buildModel({ state, statics, plan: followed, onPath: Boolean(seg && seg.strategy), settings: planSettings, auto, warOn: warOnNow(now, statics), log: get(K.dayLog, []) || [], history: (app ? archived(K.statsHistory, {}) : get(K.statsHistory, {})) || {}, prices: getPrices(), compare, rec, warn: pn ? pn.warn : null, lite: !app, saved: planInfo, whatIf: saved ? saved.whatIf : null, jobWhatIf: saved ? saved.jobWhatIf : null, pc, learnedMult: learnedNow().mult, skipped: (get(K.skipped, []) || []).filter((x) => now - x.at < 24 * 3600e3), gymProgress: get(K.gymProgress, null), unlockedKnown: get(K.unlocked, null), now });
    if (m.ready) {
        m.strategy = followed.strategy;
        m.planBusy = pi.planBusy ? { recalibrate: pi.planBusy.recalibrate, months: pi.planBusy.months, at: pi.planBusy.at, done: pi.planBusy.done, words: pi.planBusy.words } : null;
        m.savedPlan = saved;
    }
    return m;
}

/**
 * Today's totals for Progress (gained vs planned, Xanax, refills), written
 * only when they change: one small GM write, not one a second.
 */
function recordDayTotals(m) {
    if (!m || !m.ready) return;
    // Only the leader tab writes, so tabs with slightly different clocks don't take turns overwriting it.
    const lead = get(K.leader, null);
    if (!lead || lead.id !== pi.tabId) return;
    const day = tornDayStart(m.now);
    const row = {
        gained: Math.round(m.gainedToday),
        planned: Math.round(m.plannedGain),
        xanax: m.done.filter(isDrugEntry).length,
        xanaxPlanned: m.strip.drug.xanaxPlanned,
        refills: m.strip.refill.free ? 0 : 1,
    };
    const all = get(K.dayTotals, {}) || {};
    if (JSON.stringify(all[day]) === JSON.stringify(row)) return;
    all[day] = row;
    const days = Object.keys(all).map(Number).sort((a, b) => a - b);
    while (days.length > 120) delete all[days.shift()];
    set(K.dayTotals, all);
}

/**
 * The plan's line (core/planline.js; Progress, the Plan card, Home): a new
 * line from this moment, from your stats now. Create plan and Re-plan start
 * the saved plan's own run; a pick (or back to the saved plan) follows that
 * plan's saved run from where it stands today. The lines before it stay
 * (round 7: a pick no longer re-bases the line, Re-plan no longer wipes it).
 * @param {string} why - 'create' | 'replan' | 'pick' | 'path'
 */
function recordPlanLine(saved, strategy, now, why) {
    // 'path': the saved path (a plan per segment); else one plan over the whole length.
    const r = strategy === 'path' ? saved && saved.year && saved.year.path : saved && saved.compare ? saved.compare[strategy] : null;
    if (!r || !Array.isArray(r.daily)) return;
    const fresh = why === 'create' || why === 'replan';
    // Your stats at this moment: what the plan saw when it was just made, else the last read.
    const s = get(K.userState, null);
    const read = !fresh && s && s.api ? normalizeState(s.api, s.at).stats : null;
    const line = makeLine({ at: now, t0: fresh ? now : saved.rev || now, stats: read || saved.snapshot.stats, result: r, strategy, build: getPlan().build, why });
    pageSet(K.planLine, addLine(pageGet(K.planLine, null), line));
}

/**
 * What the learner kept (Settings › Developer), applied to the engine: the
 * per-stat multipliers and, when it found one, the damping formula above 50M.
 */
export function learnedNow() {
    const l = learnedModel(get(K.learned, null));
    useDampingMode(l.mode);
    return l;
}

/** How often the learner runs (and only when new trains or fights came in). */
export const LEARN_EVERY_MS = 6 * 60 * 60 * 1000;

/**
 * The app improves itself from your own trains and fights: at most every
 * 6 hours, in the leader tab, a change kept only if it predicts your newest
 * sessions better (docs/research-learning.md). Cheap: a few ms.
 */
export function maybeLearn(now = Date.now(), force = false) {
    // On the webpage only (round 6: learning is a developer thing, and its data lives in the webpage's IndexedDB), once
    // that copy has loaded (before, it would learn from GM's few recent samples and wait 6 hours).
    if (!force && (pi.where !== 'app' || !archivesReady())) return null;
    // The 6-hour check first: reading and joining the samples and fights costs more than the check (every 5 s refresh).
    const prev = get(K.learned, null);
    if (!force && prev && now - Math.max(prev.at || 0, prev.checkedAt || 0) < LEARN_EVERY_MS) return prev;
    const cal = archived('calibration', null) || {};
    const samples = cal.samples || [];
    const fights = joinFights(pageGet(K.fightLog, []) || [], (get('myAttacks', null) || {}).list || [], archived(K.eyePredictions, []) || []);
    // New trains or fights since the last run (counts stop growing at the cap; the newest time doesn't).
    const logNewest = ((pageGet(K.gymLog, null) || {}).newest) || 0;
    const sig = [samples.length, samples.length ? samples[samples.length - 1].at || 0 : 0, fights.length, fights.length ? fights[fights.length - 1].at : 0, logNewest].join(':');
    if (!force && prev && prev.sig === sig) {
        // Nothing new: checked again in 6 hours, not on every refresh (`at` stays when it last learned).
        set(K.learned, { ...prev, checkedAt: now });
        return prev;
    }
    pageSet(K.fightLog, fights);
    // The model in use (kept earlier, or kept over and over since) is the one a new one must beat.
    const current = prev && prev.gym ? applyGymModel(prev.gym) : null;
    const statics = getShared(K.userStatic, {}) || {};
    const lossMult = parsePerks(statics.perks || {}).happyLossMult || 1;
    const gymLog = (pageGet(K.gymLog, null) || {}).lines || [];
    const res = { ...runLearning({ samples, fights, now, current, gymLog, lossMult, happyCurrent: prev && prev.happy && prev.happy.factor > 0 ? prev.happy.factor : 1 }), sig };
    set(K.learned, res);
    const log = pageGet(K.learnLog, []) || [];
    log.push({ at: now, gym: { accepted: res.gym.accepted, heldOut: res.gym.heldOut, mode: res.gym.model.mode, mult: res.gym.model.mult, sessions: res.gym.sessions, candidates: res.gym.candidates }, fights: { accepted: res.fights.accepted, model: res.fights.model, fights: res.fights.fights, heldOut: res.fights.heldOut } });
    pageSet(K.learnLog, log.slice(-30));
    return res;
}

/** On Torn's pages a model with nothing new is kept this long (a new read or another tab's change redraws at once). */
export const TORN_MODEL_MAX_AGE_MS = 30000;

/**
 * Is a Torn page's model due again without anything new (round 6: rebuilding today's plan every 5 s was most of what
 * a Torn page cost)? When it's 30 s old, when a step's time has come, or at Torn midnight.
 */
export function modelDue(m, at, now) {
    if (!m || !m.ready || !at) return true;
    if (now - at >= TORN_MODEL_MAX_AGE_MS) return true;
    if (tornDayStart(now) !== tornDayStart(at)) return true;
    return (m.steps || []).some((x) => x.at > at && x.at <= now);
}

export function refresh() {
    // A tab you can't see works nothing out (same-site tabs often share one thread with the tab you're on, so its work
    // was your lag): it's worked out again when the tab is shown.
    if (!isVisible()) {
        pi.stale = true;
        return;
    }
    pi.stale = false;
    try {
        maybeLearn();
        pi.model = currentModel();
        pi.modelAt = Date.now();
        recordDayTotals(pi.model);
    } catch (error) {
        set(K.lastError, { at: Date.now(), where: 'model', message: String((error && error.message) || error) });
        logError('Working out the page', error);
        return;
    }
    for (const fn of pi.listeners) {
        try {
            fn(pi.model);
        } catch (error) {
            set(K.lastError, { at: Date.now(), where: 'render', message: String((error && error.message) || error) });
            logError('Drawing the page', error);
        }
    }
}

/**
 * Torn's own page shows something was done (the energy bar dropped, happy jumped): read the state about two seconds
 * after the last such change, not at the next 30 s read, so the panel moves to the next step with its countdown
 * (round 7, D.4). One read, by the tab that leads; nothing while paused or hidden.
 */
let soonTimer = null;
export function readSoon() {
    if (!pi.feed || !isVisible() || isPaused()) return;
    const at = pi.feed.wantSoon();
    if (soonTimer) clearTimeout(soonTimer);
    const go = () => {
        soonTimer = null;
        pi.feed
            .tick()
            .then((read) => {
                // Too soon after the read before it: once more when the gap has passed.
                if (!read && pi.feed.wantAt !== null && !soonTimer) soonTimer = setTimeout(go, 2000);
            })
            .catch(() => {});
    };
    soonTimer = setTimeout(go, Math.max(0, at - Date.now()) + 50);
}

/** Ask the feed now (a new key was saved): no waiting for the next heartbeat. */
export function nudgeFeed() {
    if (!pi.feed) return;
    pi.feed.tick().catch(() => {});
    setTimeout(() => pi.feed.tick().catch(() => {}), 500);
}

export function onModel(fn) {
    pi.listeners.push(fn);
    if (pi.model) fn(pi.model);
}

export function startFeed() {
    pi.feed = new StateFeed({
        client: tornClient(),
        store: storeApi,
        tabId: pi.tabId,
        isVisible,
        nextStep: () => (pi.model && pi.model.next) || null,
        isPaused: () => isPaused(),
        onState: () => refresh(),
        onStatic: () => refresh(),
        onError: (error) => {
            set(K.lastError, { at: Date.now(), where: 'feed', code: error && error.code, message: String((error && error.message) || error) });
            logError('Reading your state from Torn', error);
            // This tab's own writes fire no change event here: redraw so the warning shows now.
            refresh();
        },
    });
    // Leaving the page hands the lead to another tab at once, instead of after the 10 s timeout.
    window.addEventListener('pagehide', () => {
        const rec = get(K.leader, null);
        if (rec && rec.id === pi.tabId) set(K.leader, { id: null, ts: 0 });
        flushWindows();
    });
    const tick = () => pi.feed.tick().catch(() => {});
    tick();
    setInterval(tick, LEADER_HEARTBEAT_MS);
    // The first heartbeat only claims the lead; confirm it half a second later instead of a whole heartbeat.
    setTimeout(tick, 500);
    // Coming back to a tab: take the lead and read at once, not at the next heartbeat.
    document.addEventListener('visibilitychange', () => {
        if (!isVisible()) return;
        // What changed while it was hidden, shown at once (the read that follows may take a moment).
        if (pi.stale) refresh();
        tick();
        setTimeout(tick, 500);
    });
    // Follower tabs redraw when the leader stores a new state; everyone redraws each second for countdowns.
    gmOnChange(K.userState, refresh);
    gmOnChange(K.userStatic, refresh);
    gmOnChange(K.plan, refresh);
    gmOnChange(K.planNow, refresh);
    gmOnChange(K.skipped, refresh);
    gmOnChange(K.settings, refresh);
    gmOnChange(K.stateError, refresh);
    gmOnChange(K.apiKeyDead, refresh);
    // What this tab shows (Torn Eye, prices): its Torn calls go first while it's open.
    setInterval(() => beatFocus(), 4000);
    document.addEventListener('visibilitychange', () => beatFocus());
    window.addEventListener('pagehide', () => {
        pi.focusOf = null;
        beatFocus();
    });
    // Countdowns tick by themselves every second; the model is worked out again every 5 s in a tab you can see (on
    // Torn's pages only when it's due: see modelDue).
    setInterval(() => {
        if (isVisible() && (pi.where === 'app' || modelDue(pi.model, pi.modelAt, Date.now()))) refresh();
    }, 5000);
    // Taking turns with Torn Trading: the page follows a pause (or its end) at once, not at the next due model.
    let pausedWas = null;
    onPauseChange((p) => {
        if (pausedWas !== null && p !== pausedWas) refresh();
        pausedWas = p;
    });
    // The first model once Torn's page has settled (idle), not inside the page's own start-up.
    whenIdle(refresh);
}

/** Run when the page is idle (at most ~1.5 s later). */
export function whenIdle(fn) {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => fn(), { timeout: 1500 });
    else setTimeout(fn, 200);
}

