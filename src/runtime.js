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
import { buildModel, compareStrategies, compareStrategiesAsync, blissWhatIf, companyWhatIf, playerContext, buildOf, isDrugEntry, specialLeft, heldBoosters } from './core/model.js';
import { shopsAllowed } from './core/market.js';
import { xanaxCdOf } from './core/drugcd.js';
import { recommend } from './core/recommend.js';
import { targetShares } from './core/plan.js';
import { upcomingEvents } from './core/events.js';
import { INCOME_MIN_DAYS, budgetOf, incomeFrom, autoState, effectiveSettings, eventToPlan, eventSwitch, incomeBreakdown } from './core/auto.js';
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
    compare: null,
    whatIf: null,
    compareKey: '',
    compareWanted: '',
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
 * Auto mode for this refresh: income from the networth history (plus what
 * the plan spent meanwhile), the budget it affords, and whether a coming
 * event wins enough to switch the plan for it.
 */
function autoFor(plan, settings, statics) {
    // What the gym really cost over the same days (receipts), added back: it left your networth and shows in the log's "out".
    // Never the plan's own projected cost, which would feed the budget back into itself.
    const now = Date.now();
    const rc = get(K.receipts, null);
    const today = tornDayStart(now);
    // 30 Torn days, today included.
    const sum = rc ? summarizeReceipts(rc, today - 29 * 86400e3, today, { prices: getPrices(), priceHistory: get(K.priceHistory, null) }) : null;
    // Until receipts cover a few days (everyone upgrading starts with none), the steady plan's cost stands in: it
    // doesn't depend on the budget, so the budget never feeds itself.
    const steady = pi.compare && pi.compare.steady ? pi.compare.steady.cost / (settings.horizonDays || 30) : 0;
    const spentPerDay = sum && sum.days >= INCOME_MIN_DAYS ? sum.cost / sum.days : steady;
    const income = incomeFrom(statics.income || [], { spentPerDay });
    const ml = get(K.moneyLog, null);
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

/** The comparison over a coming event's days, with and without its multiplier (cached per event and inputs). */
function eventComparisonFor(event, state, pc, shares, settings, budgetPerDay, statics = {}) {
    const days = Math.max(1, Math.round((event.end - event.start) / (24 * 3600e3)));
    const key = [event.id, event.start, pi.compareKey, days, Math.round(budgetPerDay || 0)].join('|');
    if (pi.eventCompare && pi.eventCompare.key === key) return pi.eventCompare;
    // Kept between pages like the plan comparison (another page or tab worked it out).
    const kept = getShared(K.eventCompareCache, null);
    if (kept && kept.v === BUILD && kept.key === key) {
        pi.eventCompare = kept;
        return kept;
    }
    // Two more full comparisons: never inside a redraw, and only in a tab you can see. The last answer stands until the new one is ready.
    if (pi.eventWanted !== key && isVisible()) {
        pi.eventWanted = key;
        setTimeout(async () => {
            if (pi.eventWanted !== key) return;
            await runEventComparison(key, event, state, pc, shares, settings, budgetPerDay, statics, days);
            if (pi.eventWanted === key) refresh();
        }, COMPARE_CLICK_DELAY_MS * 2);
    }
    return pi.eventCompare || { eventCompare: null, normalCompare: null };
}

async function runEventComparison(key, event, state, pc, shares, settings, budgetPerDay, statics, days) {
    const es = { ...settings, horizonDays: days, budget: Number.isFinite(budgetPerDay) ? budgetPerDay * days : Infinity };
    const prices = getPrices();
    const special = 0;
    const boosted = { ...pc, perks: { ...pc.perks, candyMult: (pc.perks.candyMult || 1) * (event.candyMult || 1), canMult: (pc.perks.canMult || 1) * (event.canMult || 1) } };
    // Same inputs as the plan's own comparison (shops, console held, job), with the event's multiplier on one side.
    const eventCompare = await compareStrategiesAsync({ state, pc: boosted, shares, settings: es, prices, special, statics, pickBy: 'most' });
    const normalCompare = await compareStrategiesAsync({ state, pc, shares, settings: es, prices, special, statics, pickBy: 'most' });
    if (pi.eventWanted === key) {
        pi.eventCompare = { v: BUILD, key, eventCompare, normalCompare };
        set(K.eventCompareCache, pi.eventCompare);
    }
    return pi.eventCompare;
}

/** After a click, the plan runs wait this long (the page paints first); after new prices only, this long (batched). */
export const COMPARE_CLICK_DELAY_MS = 80;
export const COMPARE_PRICE_DELAY_MS = 5000;

/** This build's version: a comparison kept by another version is never used (its results may have another shape). */
const BUILD = typeof PI_BUILD_VERSION !== 'undefined' ? PI_BUILD_VERSION : 'dev';

/** A tab working out the comparison holds the turn this long; other tabs take its result instead of running their own. */
export const COMPARE_BUSY_MS = 30000;

/** The comparison kept between pages (K.compareCache), if this build wrote it. */
export function storedCompare() {
    const c = getShared(K.compareCache, null);
    return c && c.v === BUILD && c.key && c.compare ? c : null;
}

/** Use a kept comparison. `exact`: it is for the inputs now, so nothing is waiting. */
function adoptCompare(c, exact) {
    pi.compare = c.compare;
    pi.whatIf = c.whatIf || null;
    pi.jobWhatIf = c.jobWhatIf || [];
    pi.compareKey = c.key;
    pi.compareKeyNoPrice = c.keyNoPrice;
    if (exact) {
        pi.compareWanted = c.key;
        pi.compareScheduled = '';
    }
}

/**
 * Re-run the strategy comparison at most once per Torn hour or when inputs
 * change, in one tab, and keep it between pages: Torn loads a new page on
 * nearly every click, and each one used to work the whole comparison out
 * again in one go (owner's friend, 2026-09-30: "masyadong laggy"; ~1 s a
 * page on a slow machine). A page opens on the kept one; when the inputs
 * moved, the last one shows while the new one is worked out in slices.
 */
function comparisonFor(state, statics, plan, settings) {
    const pc = playerContext(state, statics, { unlockedKnown: get(K.unlocked, null), learnedMult: learnedNow().mult });
    const shares = targetShares(plan, pc.stats, buildOf(plan.build).shares);
    const prices = getPrices();
    // Every input that moves the answer: all four stats (in ~2% steps), prices (2 significant digits), perks, gyms.
    const statsSig = Object.values(pc.stats).map((v) => Math.round(Math.log1p(v) * 50)).join(',');
    const priceSig = Object.entries(livePrices(prices)).map(([id, p]) => id + ':' + Number(p.toPrecision(2))).join(',');
    const special = specialLeft(plan, state);
    const perkSig = JSON.stringify([learnedNow().mode, pc.perks.mult, pc.perks.happyLossMult, pc.perks.canMult, pc.perks.candyMult, pc.perks.consoleMult, pc.perks.edvdMult, pc.perks.boosterCapExtraH]);
    // Items and job: the candy rule (Plan dropdown), shops ticked, Torn's item data, a console held, the job, specials held.
    const pickBy = plan.pickBy || 'most';
    const keysFor = (candyPick) => {
        const itemSig = JSON.stringify([pickBy, shopsAllowed(settings), statics.itemsAt || 0, Number((statics.inventory || {})[104]) > 0, statics.job || null, statics.jobPoints || null, state.specialRefills || 0, Math.round((state.boosterCd || 0) / 3600), heldBoosters(statics.inventory), candyPick || null, xanaxCdOf(statics.xanaxCds).min]);
        const keyNoPrice = [BUILD, Math.floor(Date.now() / 3600e3), plan.build, plan.goal ? JSON.stringify(plan.goal) : '', settings.horizonDays, settings.budget, settings.boosterCapH || 24, state.gymId, state.happy.maximum, state.energy.maximum, pc.perks.bliss, perkSig, statsSig, pc.unlocked.join(','), special, itemSig].join('|');
        return { keyNoPrice, key: keyNoPrice + '|' + priceSig };
    };
    const { keyNoPrice, key } = keysFor(statics.candyPick);
    if (key === pi.compareKey) return { compare: pi.compare, pc };
    const stored = storedCompare();
    // Worked out already, on another page or in another tab.
    if (stored && stored.key === key) {
        adoptCompare(stored, true);
        return { compare: pi.compare, pc };
    }
    // A new page: the last one shows while the new one is worked out.
    if (!pi.compare && stored) adoptCompare(stored, false);
    pi.compareWanted = key;
    const whatIfs = (compare) => {
        // Ignorance Is Bliss, what if: only while the book isn't active (active, the real plans already use it).
        const whatIf = pc.perks.bliss ? null : blissWhatIf({ state, pc, shares, settings, prices, special, statics, pickBy });
        // Company what-ifs: hired where a jump variant would beat the recommended plan.
        const rec = recommend(compare, { budget: budgetOf(settings), bliss: pc.perks.bliss, pickBy });
        return { whatIf, jobWhatIf: companyWhatIf({ state, pc, shares, settings, prices, special, statics, pickBy, compare, recommended: rec.recommended }) };
    };
    const finish = (compare, { whatIf, jobWhatIf }) => {
        let keys = { key, keyNoPrice };
        // Today's candy stays named unless another is clearly cheaper (owner: it flipped on every price load). Keeping
        // it is one of the comparison's own inputs: the key it's kept under says so, so it doesn't run a second time.
        const mine = compare && compare[plan.strategy] && compare[plan.strategy].candy;
        const kept = get(K.candyPick, null);
        const day = tornDayStart(Date.now());
        if (mine && !(kept && kept.day === day && kept.id === mine.id)) {
            const pick = { day, id: mine.id };
            set(K.candyPick, pick);
            keys = keysFor(pick);
        }
        const c = { v: BUILD, key: keys.key, keyNoPrice: keys.keyNoPrice, at: Date.now(), tab: pi.tabId, compare, whatIf, jobWhatIf };
        set(K.compareCache, c);
        adoptCompare(c, true);
        del(K.compareBusy);
    };
    const args = { state, pc, shares, settings, prices, special, statics, pickBy };
    if (!pi.compare) {
        // Nothing kept yet (the first page after an install or an update): once, in one go.
        const compare = compareStrategies(args);
        finish(compare, whatIfs(compare));
    } else if (pi.compareScheduled !== key && isVisible()) {
        // A click (build, budget, days, a shop tick) redraws at once and the plan runs follow once the page has
        // painted. New prices alone (they arrive in batches while Buy loads) are gathered: one run 5 s later.
        const priceOnly = pi.compareKeyNoPrice === keyNoPrice;
        pi.compareScheduled = key;
        clearTimeout(pi.compareTimer);
        pi.compareTimer = setTimeout(async () => {
            if (pi.compareWanted !== key) return;
            // Another tab may have it by now, or be working it out: take its result at the next redraw.
            const again = storedCompare();
            if (again && again.key === key) {
                adoptCompare(again, true);
                refresh();
                return;
            }
            const busy = get(K.compareBusy, null);
            if (busy && busy.key === key && busy.tab !== pi.tabId && Date.now() - (busy.at || 0) < COMPARE_BUSY_MS) {
                pi.compareScheduled = '';
                return;
            }
            set(K.compareBusy, { key, tab: pi.tabId, at: Date.now() });
            // One plan at a time, with the page free in between; a newer change drops this run.
            const compare = await compareStrategiesAsync(args);
            if (pi.compareWanted !== key) return;
            await pauseForPage();
            const w = whatIfs(compare);
            if (pi.compareWanted !== key) return;
            finish(compare, w);
            refresh();
        }, priceOnly ? COMPARE_PRICE_DELAY_MS : COMPARE_CLICK_DELAY_MS);
    }
    return { compare: pi.compare, pc };
}

/** A break for the page between two pieces of work. */
const pauseForPage = () => new Promise((r) => setTimeout(r, 0));

/** The model every surface renders from. */
export function currentModel(now = Date.now()) {
    const s = get(K.userState, null);
    const state = s && s.api ? normalizeState(s.api, s.at) : null;
    if (!state) return { ready: false, hasKey: Boolean(getKey(K.apiKey)), keyDead: Boolean(get(K.apiKeyDead, false)) };
    // Your Xanax cooldowns and today's candy pick ride along with the stored data (the plan and the comparison read them).
    const statics = { ...(getShared(K.userStatic, {}) || {}), xanaxCds: get(K.xanaxCds, []) || [], candyPick: get(K.candyPick, null) };
    let plan = getPlan();
    const auto = autoFor(plan, getSettings(), statics);
    // Auto: the plans run inside what your income affords; without its Full key it's "most stats in my budget".
    const settings = effectiveSettings(getSettings(), auto);
    const { compare, pc } = comparisonFor(state, statics, plan, settings);
    let autoSwitch = null;
    if (auto.ready && compare) {
        const goal = plan.goal && plan.goal.kind === 'unlockGym' ? 'unlock' : null;
        let strategy = recommend(compare, { budget: settings.budget, bliss: pc.perks.bliss, pickBy: 'auto', goal }).recommended;
        // A coming event that multiplies what a plan uses: switch for it when it wins clearly (stacking skips natural energy).
        const events = statics.calendar ? upcomingEvents(statics.calendar.calendar, now, { startTime: statics.calendar.startTime }) : [];
        const ev = eventToPlan(events, now);
        if (ev) {
            const shares = targetShares(plan, pc.stats, buildOf(plan.build).shares);
            const ec = eventComparisonFor(ev, state, pc, shares, settings, auto.budgetPerDay, statics);
            autoSwitch = eventSwitch({ event: ev, eventCompare: ec.eventCompare, normalCompare: ec.normalCompare, budgetPerDay: auto.budgetPerDay, now });
            if (autoSwitch && autoSwitch.active) strategy = autoSwitch.id;
        }
        // The plan follows Auto's pick (saved, so the day plan, Discord and Progress all see the same plan): written by the
        // leader tab only, and only from an up-to-date comparison, so tabs never take turns rewriting it.
        const lead = get(K.leader, null);
        const fresh = !pi.compareWanted || pi.compareWanted === pi.compareKey;
        if (strategy && strategy !== plan.strategy && fresh && lead && lead.id === pi.tabId) plan = setPlan({ ...plan, strategy, strategyPicked: false, createdAt: now });
    }
    return buildModel({ state, statics, plan, settings, auto, autoSwitch, warOn: warOnNow(now, statics), log: get(K.dayLog, []) || [], history: get(K.statsHistory, {}) || {}, prices: getPrices(), compare, whatIf: pi.whatIf || null, jobWhatIf: pi.jobWhatIf || null, pc, learnedMult: learnedNow().mult, skipped: (get(K.skipped, []) || []).filter((x) => now - x.at < 24 * 3600e3), gymProgress: get(K.gymProgress, null), unlockedKnown: get(K.unlocked, null), now });
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
 * The plan's line for Progress: the 30-day projection as it stood when this
 * plan (strategy, build, start) was set. Written once per plan by the leader.
 */
function recordPlanLine(m) {
    if (!m || !m.ready || !m.compare) return;
    // Not while a new comparison is still coming (a click just changed the build).
    if (pi.compareWanted && pi.compareWanted !== pi.compareKey) return;
    const plan = getPlan();
    const r = m.compare[plan.strategy];
    if (!r) return;
    const key = [plan.createdAt || 0, plan.strategy, plan.build].join('|');
    const cur = get(K.planLine, null);
    if (cur && cur.key === key) return;
    const lead = get(K.leader, null);
    if (!lead || lead.id !== pi.tabId) return;
    set(K.planLine, { key, start: tornDayStart(m.now), total: m.total, perStat: { ...m.pc.stats }, daily: r.daily, perStatGain: r.perStat, cost: r.cost, days: r.daily.length });
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
    const lead = get(K.leader, null);
    if (!force && (!lead || lead.id !== pi.tabId)) return null;
    const cal = get('calibration', null) || {};
    const samples = cal.samples || [];
    const fights = joinFights(get(K.fightLog, []) || [], (get('myAttacks', null) || {}).list || [], get(K.eyePredictions, []) || []);
    const prev = get(K.learned, null);
    // New trains or fights since the last run (counts stop growing at the cap; the newest time doesn't).
    const sig = [samples.length, samples.length ? samples[samples.length - 1].at || 0 : 0, fights.length, fights.length ? fights[fights.length - 1].at : 0].join(':');
    if (!force && prev && (now - prev.at < LEARN_EVERY_MS || prev.sig === sig)) return prev;
    set(K.fightLog, fights);
    // The model in use (kept earlier, or kept over and over since) is the one a new one must beat.
    const current = prev && prev.gym ? applyGymModel(prev.gym) : null;
    const res = { ...runLearning({ samples, fights, now, current }), sig };
    set(K.learned, res);
    const log = get(K.learnLog, []) || [];
    log.push({ at: now, gym: { accepted: res.gym.accepted, heldOut: res.gym.heldOut, mode: res.gym.model.mode, mult: res.gym.model.mult, sessions: res.gym.sessions, candidates: res.gym.candidates }, fights: { accepted: res.fights.accepted, model: res.fights.model, fights: res.fights.fights, heldOut: res.fights.heldOut } });
    set(K.learnLog, log.slice(-30));
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
        recordPlanLine(pi.model);
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
    refresh();
}

