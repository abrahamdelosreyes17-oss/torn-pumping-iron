/*
 * What every tab shares at run time: the one Torn client (70/min across
 * tabs, visible only, silent while Torn Trading runs), the state feed, and the model every surface renders
 * from. Userscript-only; core/ and api/ stay plain modules.
 */

import { gmOnChange } from './platform/gm.js';
import { K, get, set, del, getKey, getSettings, getPlan, setPlan, getPrices, getShared } from './platform/store.js';
import { tabWindow } from './platform/tab-window.js';
import { makeTabId, LEADER_HEARTBEAT_MS } from './core/leader.js';
import { TornApiClient } from './api/client.js';
import { StateFeed } from './feed/state.js';
import { normalizeState, tornDayStart } from './core/bars.js';
import { buildModel, compareStrategies, blissWhatIf, companyWhatIf, playerContext, buildOf, isDrugEntry, specialLeft } from './core/model.js';
import { recommend } from './core/recommend.js';
import { targetShares } from './core/plan.js';
import { upcomingEvents } from './core/events.js';
import { incomeFrom, autoState, effectiveSettings, eventToPlan, eventSwitch, incomeBreakdown } from './core/auto.js';
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

/** The one Torn client every part of this tab uses: 70/min across tabs, visible only, nothing while paused. */
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
    const horizon = settings.horizonDays || 30;
    const r = pi.compare && pi.compare[plan.strategy];
    const income = incomeFrom(statics.income || [], { spentPerDay: r ? r.cost / horizon : 0 });
    const auto = autoState({ plan, settings, hasFullKey: hasFullKey(), income });
    const ml = get(K.moneyLog, null);
    auto.breakdown = ml && ml.log ? incomeBreakdown(ml.log, ml.at || Date.now()) : null;
    auto.income = income;
    return auto;
}

/** Your faction's war, as Torn Eye last read it (its wars every 5 minutes): on now or within a day, read in the last 6 hours. */
export function warOnNow(now = Date.now()) {
    const w = get('eyeWarAuto', null);
    if (!w || !Array.isArray(w.enemies) || !w.enemies.length || !(now - (w.at || 0) < 6 * 3600e3)) return null;
    const nowS = Math.floor(now / 1000);
    return w.enemies.find((e) => (!e.start || e.start - nowS <= 86400) && (!e.end || e.end > nowS)) || null;
}

/** The comparison over a coming event's days, with and without its multiplier (cached per event and inputs). */
function eventComparisonFor(event, state, pc, shares, settings, budgetPerDay) {
    const days = Math.max(1, Math.round((event.end - event.start) / (24 * 3600e3)));
    const key = [event.id, event.start, pi.compareKey, days, Math.round(budgetPerDay || 0)].join('|');
    if (pi.eventCompare && pi.eventCompare.key === key) return pi.eventCompare;
    const es = { ...settings, horizonDays: days, budget: Number.isFinite(budgetPerDay) ? budgetPerDay * days : Infinity };
    const prices = getPrices();
    const special = 0;
    const boosted = { ...pc, perks: { ...pc.perks, candyMult: (pc.perks.candyMult || 1) * (event.candyMult || 1), canMult: (pc.perks.canMult || 1) * (event.canMult || 1) } };
    pi.eventCompare = { key, eventCompare: compareStrategies({ state, pc: boosted, shares, settings: es, prices, special }), normalCompare: compareStrategies({ state, pc, shares, settings: es, prices, special }) };
    return pi.eventCompare;
}

/** Re-run the strategy comparison at most once per Torn hour or when inputs change. */
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
    const itemSig = JSON.stringify([pickBy, settings.npcShops || [], statics.itemsAt || 0, Number((statics.inventory || {})[104]) > 0, statics.job || null, statics.jobPoints || null, state.specialRefills || 0]);
    const key = [Math.floor(Date.now() / 3600e3), plan.build, plan.goal ? JSON.stringify(plan.goal) : '', settings.horizonDays, settings.budget, settings.boosterCapH || 24, state.gymId, state.happy.maximum, state.energy.maximum, pc.perks.bliss, perkSig, statsSig, priceSig, pc.unlocked.join(','), special, itemSig].join('|');
    if (key !== pi.compareKey) {
        const run = () => {
            pi.compare = compareStrategies({ state, pc, shares, settings, prices, special, statics, pickBy });
            // Ignorance Is Bliss, what if: only while the book isn't active (active, the real plans already use it).
            pi.whatIf = pc.perks.bliss ? null : blissWhatIf({ state, pc, shares, settings, prices, special, statics, pickBy });
            // Company what-ifs: hired where a jump variant would beat the recommended plan.
            const rec = recommend(pi.compare, { budget: settings.budget || Infinity, bliss: pc.perks.bliss, pickBy });
            pi.jobWhatIf = companyWhatIf({ state, pc, shares, settings, prices, special, statics, pickBy, compare: pi.compare, recommended: rec.recommended });
            pi.compareKey = key;
        };
        if (!pi.compare) run();
        else if (pi.compareWanted !== key) {
            // A click (build, budget, days) redraws at once; the 15 plan runs follow a moment later, off the click.
            pi.compareWanted = key;
            setTimeout(() => {
                if (pi.compareWanted !== key) return;
                run();
                refresh();
            }, 0);
        }
    }
    return { compare: pi.compare, pc };
}

/** The model every surface renders from. */
export function currentModel(now = Date.now()) {
    const s = get(K.userState, null);
    const state = s && s.api ? normalizeState(s.api, s.at) : null;
    if (!state) return { ready: false, hasKey: Boolean(getKey(K.apiKey)), keyDead: Boolean(get(K.apiKeyDead, false)) };
    const statics = getShared(K.userStatic, {}) || {};
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
            const ec = eventComparisonFor(ev, state, pc, shares, settings, auto.budgetPerDay);
            autoSwitch = eventSwitch({ event: ev, eventCompare: ec.eventCompare, normalCompare: ec.normalCompare, budgetPerDay: auto.budgetPerDay, now });
            if (autoSwitch && autoSwitch.active) strategy = autoSwitch.id;
        }
        // The plan follows Auto's pick (saved, so the day plan, Discord and Progress all see the same plan).
        if (strategy && strategy !== plan.strategy) plan = setPlan({ ...plan, strategy, strategyPicked: false, createdAt: now });
    }
    return buildModel({ state, statics, plan, settings, auto, autoSwitch, warOn: warOnNow(now), log: get(K.dayLog, []) || [], history: get(K.statsHistory, {}) || {}, prices: getPrices(), compare, whatIf: pi.whatIf || null, jobWhatIf: pi.jobWhatIf || null, pc, learnedMult: learnedNow().mult, skipped: (get(K.skipped, []) || []).filter((x) => now - x.at < 24 * 3600e3), gymProgress: get(K.gymProgress, null), unlockedKnown: get(K.unlocked, null), now });
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
    // Countdowns tick by themselves every second; the model itself is worked out again every 5 s, in a tab you can see.
    setInterval(() => {
        if (isVisible()) refresh();
    }, 5000);
    refresh();
}

