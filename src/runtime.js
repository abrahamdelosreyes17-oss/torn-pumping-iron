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
import { buildModel, compareStrategiesAsync, blissWhatIf, companyWhatIf, playerContext, buildOf, isDrugEntry, specialLeft, heldBoosters, steadyCostPerDay } from './core/model.js';
import { recommend, pickWarning, PICK_BY } from './core/recommend.js';
import { targetShares } from './core/plan.js';
import { INCOME_MIN_DAYS, budgetOf, incomeFrom, autoState, effectivePickBy, incomeBreakdown } from './core/auto.js';
import { planWindow, daysLeft, planProgress, snapshotOf, makeSavedPlan, planNowOf, usablePlanNow, SAVED_PLAN_V } from './core/saved-plan.js';
import { loadSavedPlan, saveSavedPlan } from './platform/plan-store.js';
import { archived, pageGet, pageSet } from './platform/archive.js';
import { summarizeReceipts } from './core/receipts.js';
import { livePrices } from './core/market.js';
import { TORN_PER_MINUTE_ALONE } from './core/turns.js';
import { isPaused } from './turns.js';
import { useDampingMode } from './core/gain.js';
import { joinFights, runLearning, learnedModel } from './core/learndata.js';
import { applyGymModel } from './core/learn.js';

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

/** Where each tab's focus heartbeat is kept ({tabId: {focus, war, at}}), and each side's shared minute. */
const FOCUS_KEY = 'apiFocus';
const laneWindows = {};
function laneWindow(side) {
    if (!laneWindows[side]) laneWindows[side] = tabWindow('apiLane_' + side, pi.tabId, storeApi);
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
    if (JSON.stringify(had || null) !== JSON.stringify(all[pi.tabId] || null) || (all[pi.tabId] && now - ((had && had.at) || 0) > FOCUS_FRESH_MS / 3)) set(FOCUS_KEY, all);
}

/** The one Torn client every part of this tab uses: 85/min across tabs, visible only, nothing while paused; what's open goes first. */
export function tornClient() {
    if (pi.client) return pi.client;
    const win = tabWindow('apiWindow', pi.tabId, storeApi);
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
    const win = tabWindow('apiWindow', pi.tabId, storeApi);
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
    const breakdown = ml && ml.log ? incomeBreakdown(ml.log, ml.at || Date.now(), ml.days || null) : null;
    const auto = autoState({ plan, settings, hasFullKey: hasFullKey(), income, log: breakdown, spentPerDay });
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
    if (pi.saved && pi.saved.rev === pn.rev) return pi.saved;
    if (pi.savedLoading !== pn.rev) {
        pi.savedLoading = pn.rev;
        loadSavedPlan()
            .then((p) => {
                if (p && p.rev === pn.rev) {
                    pi.saved = p;
                    refresh();
                }
            })
            .catch(() => {});
    }
    return null;
}

/**
 * Create plan (1, 3, 6 or 12 months) or Recalibrate, on a click only: every
 * plan is worked out over the plan's days from what's true now (stats,
 * income, prices, gyms), the best one is recommended, and the whole thing is
 * saved with what it saw. Recalibrate keeps the plan's start and end and
 * re-plans only the days left. Worked out in slices (the page stays free).
 * @param {object} o - {months: 1|3|6|12} or {recalibrate: true}
 * @returns {Promise<object>} the saved plan
 */
export async function createPlan({ months = 1, recalibrate = false, pause = pauseForPage } = {}) {
    if (pi.planBusy) return pi.planBusy.promise;
    const run = (async () => {
        const now = Date.now();
        const s = get(K.userState, null);
        const state = s && s.api ? normalizeState(s.api, s.at) : null;
        if (!state) throw new Error('Waiting for the first read of your stats.');
        const prev = recalibrate ? await loadSavedPlan() : null;
        if (recalibrate && !(prev && prev.v === SAVED_PLAN_V)) throw new Error('No plan to recalibrate yet: create one first.');
        const plan = getPlan();
        const settings = getSettings();
        // The candy the plan named stays unless another is clearly cheaper now (candy.js's 10% rule).
        const keptCandy = prev && prev.compare && prev.compare[plan.strategy] && prev.compare[plan.strategy].candy;
        const statics = { ...(getShared(K.userStatic, {}) || {}), xanaxCds: get(K.xanaxCds, []) || [], candyPick: keptCandy ? { day: tornDayStart(state.at), id: keptCandy.id } : null };
        const win = recalibrate ? { start: prev.start, end: prev.end, months: prev.months, days: daysLeft(prev, now) } : planWindow(months, now);
        const pc = playerContext(state, statics, { unlockedKnown: get(K.unlocked, null), learnedMult: learnedNow().mult });
        const shares = targetShares(plan, pc.stats, buildOf(plan.build).shares);
        const prices = getPrices();
        const special = specialLeft(plan, state);
        // Money a day: Auto from your income (Full key), "Max gains" none, else the budget you set, per day.
        const auto = autoFor(plan, settings, statics, () => steadyCostPerDay({ state, pc, shares, settings: { ...settings, horizonDays: 30 }, prices, special, statics }));
        const perDay = plan.pickBy === 'max' ? Infinity : auto.ready ? auto.budgetPerDay : budgetOf(settings) / (settings.horizonDays || 30);
        const runSettings = { ...settings, horizonDays: win.days, budget: Number.isFinite(perDay) ? perDay * win.days : Infinity };
        const pickBy = effectivePickBy(PICK_BY[plan.pickBy] ? plan.pickBy : 'most', auto);
        const args = { state, pc, shares, settings: runSettings, prices, special, statics, pickBy };
        const compare = await compareStrategiesAsync(args, { pause });
        await pause();
        const goal = plan.goal && plan.goal.kind === 'unlockGym' ? 'unlock' : null;
        const budget = budgetOf(runSettings);
        const rec = recommend(compare, { budget, bliss: pc.perks.bliss, pickBy, goal });
        // Ignorance Is Bliss, what if: only while the book isn't active (active, the real plans already use it).
        const whatIf = pc.perks.bliss ? null : blissWhatIf(args);
        await pause();
        const jobWhatIf = companyWhatIf({ ...args, compare, recommended: rec.recommended });
        const snapshot = snapshotOf({ state, pc, statics, plan, prices: livePrices(prices), income: auto.ready ? { perDay: auto.perDay, source: auto.source, days: auto.days } : null, budgetPerDay: Number.isFinite(perDay) ? perDay : null, held: heldBoosters(statics.inventory), now });
        const saved = makeSavedPlan({ compare, rec, snapshot, start: win.start, end: win.end, months: win.months, days: win.days, budget, whatIf, jobWhatIf, prev, now });
        const best = compare[rec.recommended];
        const warn = {};
        for (const [id, r] of Object.entries(compare)) if (r && best && id !== rec.recommended) warn[id] = pickWarning(best, r, { bliss: pc.perks.bliss, days: win.days }).warn;
        await saveSavedPlan(saved);
        pi.saved = saved;
        set(K.planNow, planNowOf(saved, warn));
        // The plan followed: the recommended one (a plan you picked yourself stays through a recalibration).
        const cur = getPlan();
        const strategy = recalibrate && cur.strategyPicked && compare[cur.strategy] ? cur.strategy : rec.recommended;
        setPlan({ ...cur, strategy, strategyPicked: strategy !== rec.recommended && Boolean(cur.strategyPicked), createdAt: now });
        recordPlanLine(saved, strategy, now);
        return saved;
    })();
    pi.planBusy = { recalibrate, months, at: Date.now(), promise: run };
    refresh();
    try {
        return await run;
    } finally {
        pi.planBusy = null;
        refresh();
    }
}

/** Recalibrate (a click): the plan's end stays, the days left are re-planned from what's true now. */
export function recalibratePlan(o = {}) {
    return createPlan({ ...o, recalibrate: true });
}

/**
 * Picking another of the saved plans (the Plan page): nothing is worked out
 * again; Progress's line follows the pick.
 */
export function followStrategy(id) {
    const saved = pi.saved;
    const cur = getPlan();
    const rec = saved && saved.rec ? saved.rec.recommended : null;
    setPlan({ ...cur, strategy: id, strategyPicked: id !== rec, createdAt: Date.now() });
    if (saved && saved.compare && saved.compare[id]) recordPlanLine(saved, id, Date.now());
    refresh();
}

/** A break for the page between two pieces of work. */
const pauseForPage = () => new Promise((r) => setTimeout(r, 0));

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
    const pc = playerContext(state, statics, { unlockedKnown: get(K.unlocked, null), learnedMult: learnedNow().mult });
    // The saved plan's numbers: every plan's whole result on the webpage, the small part on Torn's pages.
    let compare = null;
    let rec = null;
    let planSettings = settings;
    if (pn) {
        compare = saved ? saved.compare : pn.slim;
        rec = saved ? saved.rec : { recommended: pn.recommended, pickBy: pn.pickBy, alternatives: [], reasons: [] };
        planSettings = { ...settings, horizonDays: pn.days, budget: pn.budget === null ? Infinity : pn.budget };
    }
    // Income (Plan's "Plan from my income"): read on the webpage only, where a plan is made.
    const auto = app ? autoFor(plan, settings, statics, () => (pn && pn.slim.steady ? pn.slim.steady.cost / pn.days : 0)) : null;
    const planInfo = pn ? { start: pn.start, end: pn.end, months: pn.months, days: pn.days, from: pn.from, createdAt: pn.createdAt, recalibratedAt: pn.recalibratedAt, progress: planProgress(pn, now), whole: Boolean(saved) } : null;
    const m = buildModel({ state, statics, plan, settings: planSettings, auto, warOn: warOnNow(now, statics), log: get(K.dayLog, []) || [], history: (app ? archived(K.statsHistory, {}) : get(K.statsHistory, {})) || {}, prices: getPrices(), compare, rec, warn: pn ? pn.warn : null, lite: !app, saved: planInfo, whatIf: saved ? saved.whatIf : null, jobWhatIf: saved ? saved.jobWhatIf : null, pc, learnedMult: learnedNow().mult, skipped: (get(K.skipped, []) || []).filter((x) => now - x.at < 24 * 3600e3), gymProgress: get(K.gymProgress, null), unlockedKnown: get(K.unlocked, null), now });
    if (m.ready) {
        m.planBusy = pi.planBusy ? { recalibrate: pi.planBusy.recalibrate, months: pi.planBusy.months, at: pi.planBusy.at } : null;
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
 * The plan's line for Progress: the projection of the plan followed, from
 * the day it was made or recalibrated (or picked).
 */
function recordPlanLine(saved, strategy, now) {
    const r = saved && saved.compare ? saved.compare[strategy] : null;
    if (!r || !Array.isArray(r.daily)) return;
    const plan = getPlan();
    const stats = saved.snapshot.stats;
    pageSet(K.planLine, { key: [plan.createdAt || 0, strategy, plan.build].join('|'), start: tornDayStart(now), total: Object.values(stats).reduce((a, v) => a + v, 0), perStat: { ...stats }, daily: r.daily, perStatGain: r.perStat, cost: r.cost, days: r.daily.length });
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
    // On the webpage only (round 6: learning is a developer thing, and its data lives in the webpage's IndexedDB).
    if (!force && pi.where !== 'app') return null;
    // The 6-hour check first: reading and joining the samples and fights costs more than the check (every 5 s refresh).
    const prev = get(K.learned, null);
    if (!force && prev && now - Math.max(prev.at || 0, prev.checkedAt || 0) < LEARN_EVERY_MS) return prev;
    const cal = archived('calibration', null) || {};
    const samples = cal.samples || [];
    const fights = joinFights(pageGet(K.fightLog, []) || [], (get('myAttacks', null) || {}).list || [], archived(K.eyePredictions, []) || []);
    // New trains or fights since the last run (counts stop growing at the cap; the newest time doesn't).
    const sig = [samples.length, samples.length ? samples[samples.length - 1].at || 0 : 0, fights.length, fights.length ? fights[fights.length - 1].at : 0].join(':');
    if (!force && prev && prev.sig === sig) {
        // Nothing new: checked again in 6 hours, not on every refresh (`at` stays when it last learned).
        set(K.learned, { ...prev, checkedAt: now });
        return prev;
    }
    pageSet(K.fightLog, fights);
    // The model in use (kept earlier, or kept over and over since) is the one a new one must beat.
    const current = prev && prev.gym ? applyGymModel(prev.gym) : null;
    const res = { ...runLearning({ samples, fights, now, current }), sig };
    set(K.learned, res);
    const log = pageGet(K.learnLog, []) || [];
    log.push({ at: now, gym: { accepted: res.gym.accepted, heldOut: res.gym.heldOut, mode: res.gym.model.mode, mult: res.gym.model.mult, sessions: res.gym.sessions, candidates: res.gym.candidates }, fights: { accepted: res.fights.accepted, model: res.fights.model, fights: res.fights.fights, heldOut: res.fights.heldOut } });
    pageSet(K.learnLog, log.slice(-30));
    return res;
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
        recordDayTotals(pi.model);
    } catch (error) {
        set(K.lastError, { at: Date.now(), where: 'model', message: String((error && error.message) || error) });
        return;
    }
    for (const fn of pi.listeners) {
        try {
            fn(pi.model);
        } catch (error) {
            set(K.lastError, { at: Date.now(), where: 'render', message: String((error && error.message) || error) });
        }
    }
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
        onError: (error) => {
            set(K.lastError, { at: Date.now(), where: 'feed', code: error && error.code, message: String((error && error.message) || error) });
            // This tab's own writes fire no change event here: redraw so the warning shows now.
            refresh();
        },
    });
    // Leaving the page hands the lead to another tab at once, instead of after the 10 s timeout.
    window.addEventListener('pagehide', () => {
        const rec = get(K.leader, null);
        if (rec && rec.id === pi.tabId) set(K.leader, { id: null, ts: 0 });
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
    // Countdowns tick by themselves every second; the model itself is worked out again every 5 s, in a tab you can see.
    setInterval(() => {
        if (isVisible()) refresh();
    }, 5000);
    // The first model once Torn's page has settled (idle), not inside the page's own start-up.
    whenIdle(refresh);
}

/** Run when the page is idle (at most ~1.5 s later). */
export function whenIdle(fn) {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(() => fn(), { timeout: 1500 });
    else setTimeout(fn, 200);
}

