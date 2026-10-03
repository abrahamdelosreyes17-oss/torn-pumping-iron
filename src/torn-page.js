/*
 * On torn.com: the overlay pill and the marks on the page being viewed.
 * Reads only the page the user opened; types into Torn's reps box only on
 * a Fill click; never clicks Torn's buttons; nothing from a hidden tab.
 */

import { gmMenu, gmOpenTab } from './platform/gm.js';
import { K, get, set, getKey, getSettings, getPlan, getPrices } from './platform/store.js';
import { keyProblem } from './ui/key-status.js';
import { onModel, isVisible, refresh, pi, beatFocus, readSoon, overdoseSeen } from './runtime.js';
import { isPaused, tradingWhere } from './turns.js';
import { Overlay } from './ui/overlay.js';
import { ensureMarkCss, clearMarks, drawGymMarks, markListing, placeMarks, scheduleMarks, marksLost, marksCount, gymFill, gymNotes } from './ui/marks/marks.js';
import { gymRoot, gymLoading, readStatBoxes, readGymButtons, gymListSummary, readEnergyBar, readHappyBar, barsActed, fillTrains } from './sources/dom/gym.js';
import { readItemRows, readBazaarCards, readItemMarketRows, readPointsRows } from './sources/dom/market.js';
import { planGymPage, pageReading, nextSession, gymPanel, liveNextStep, isBoostStep, boostProgress, nextBarsSeen, agedCooldowns, boostHappyTrained, OVERDOSE_WORDS, awayWords, TRAVEL_URL, DUE_SLACK_MS } from './core/gympage.js';
import { unlockEnergyAfter } from './core/gyms.js';
import { needsForWindow, shownTypes, typeOf } from './ui/app/buy.js';
import { itemContext } from './core/model.js';
import { loadPrices } from './app-page.js';
import { eyeRideChain } from './eye-page.js';
import { needList, fillCheapest, npcListing, SOURCE_BAZAAR, SOURCE_ITEM_MARKET, SOURCE_POINTS } from './core/market.js';
import { panelStep } from './ui/app/home.js';
import { trainsText } from './ui/app/common.js';
import { tornClock } from './core/bars.js';
import { fmtInt } from './core/format.js';
import { POINTS } from './core/items.js';
import { detectPage, bazaarOwnerId, itemMarketItemOf, gymUrl, itemsUrl, pointsUrl, APP_PAGE_URL, PAGE_GYM, PAGE_ITEMS, PAGE_BAZAAR, PAGE_ITEM_MARKET, PAGE_POINTS, PAGE_PROFILE, PAGE_FACTION, PAGE_ATTACK } from './sources/route.js';

const tp = { overlay: null, model: null, observer: null, gymSig: '', lastGymPlan: null };

/** Torn's page (its sidebar and content column) as {left, right}; a centred 976 px guess if it can't be measured. */
function pageRect() {
    const parts = [document.querySelector('.content-wrapper'), document.getElementById('sidebarroot'), document.getElementById('sidebar')].filter(Boolean);
    const rects = parts.map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    if (rects.length) return { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)) };
    const w = Math.min(window.innerWidth, 976);
    return { left: (window.innerWidth - w) / 2, right: (window.innerWidth + w) / 2 };
}

/** The trading script's NPC Arbitrage panel, if it is on this page (read only: its open shadow root). */
function tradingRect() {
    const host = document.getElementById('ttv2-host');
    const panel = host && host.shadowRoot && host.shadowRoot.querySelector('.ttv2-panel');
    return panel ? panel.getBoundingClientRect() : null;
}

/** The column Torn Eye's list tags use ({left, right} on screen), from its layer's data-pi-col; null: none. */
function eyeColumn() {
    const layer = document.getElementById('pi-eye-layer');
    const v = layer && layer.getAttribute('data-pi-col');
    const [left, right] = v ? v.split(',').map(Number) : [];
    return Number.isFinite(left) && Number.isFinite(right) ? { left, right } : null;
}

/* ---------------------------------------------------------------- pill */

/** Why there's no state yet (key refused, too limited, Torn not answering), or null. */
function currentProblem() {
    return keyProblem({ hasKey: Boolean(getKey(K.apiKey)), dead: Boolean(get(K.apiKeyDead, false)), stateError: get(K.stateError, null), keyInfo: (get(K.userStatic, {}) || {}).keyInfo || null });
}

/** The bars as Torn's sidebar shows them now (they move before our next read), else the model's. */
function liveReads(m, now = Date.now()) {
    const happy = readHappyBar() || (m && m.strip && m.strip.happy ? { current: m.strip.happy.current, max: m.strip.happy.max } : null);
    const energy = readEnergyBar() || (m && m.strip ? m.strip.energy : null);
    return { happy, energy, ...agedCooldowns(m, now) };
}

/**
 * An overdose seen on the bars (gympage.js nextOverdose: the bars at 0 with the overdose's long cooldown, or a fall
 * training can't explain), kept while fresh readings still look like it and until the drug cooldown it started is over.
 * The one stored state (runtime.js overdoseSeen, GM key K.overdose): here it is checked against Torn's sidebar, which
 * moves before our next read; the webpage and the bot's sync follow the same key.
 */
function overdoseOf(m, reads = liveReads(m), now = Date.now()) {
    if (!m || !m.ready) return null;
    const od = overdoseSeen(reads, now, tp.barsSeen);
    tp.barsSeen = nextBarsSeen(tp.barsSeen, reads, now);
    return od;
}

/** The step's one action on Torn: the page it is done on (none when you are on it). */
export function stepAction(step, page, boost = null) {
    if (!step) return null;
    const items = (step.items || []).filter((it) => it.qty > 0);
    const trains = Boolean(step.parts && step.parts.length);
    if (boost) return boost.ready ? (page === PAGE_GYM ? null : { text: 'Open the gym', href: gymUrl() }) : page === PAGE_ITEMS ? null : { text: 'Open Items', href: itemsUrl() };
    if (items.some((it) => it.id === POINTS)) return page === PAGE_POINTS ? null : { text: 'Open Points', href: pointsUrl() };
    if (items.length) return page === PAGE_ITEMS ? null : { text: 'Open Items', href: itemsUrl() };
    if (trains && page !== PAGE_GYM) return { text: 'Open the gym', href: gymUrl() };
    return null;
}

function overlayView(m, page) {
    const s = getSettings();
    const relevant = [PAGE_GYM, PAGE_ITEMS, PAGE_BAZAAR, PAGE_ITEM_MARKET, PAGE_POINTS].includes(page);
    if (!s.pill && !relevant) return { off: true };
    if (!m || !m.ready) {
        const hasKey = Boolean(getKey(K.apiKey));
        const p = currentProblem();
        if (p) return { pillText: p.short, cardStep: p.title, cardSub: p.text, warn: p.kind === 'retry' ? null : 'Open Pumping Iron › Settings' };
        return hasKey ? { pillText: 'Reading your state…', cardStep: 'Asking Torn for your bars, stats and gym.' } : { pillText: 'Open to set up', cardStep: 'Add your Torn key in Pumping Iron’s Settings.' };
    }
    const now = Date.now();
    const reads = liveReads(m);
    // The next step by the bars Torn's page shows now: a train whose energy is already spent is not offered again
    // while our read of your state is still the one from before it.
    const live = liveNextStep(m.steps, reads, now);
    const next = live.next;
    const later = live.rest.slice(0, 2).map((x) => tornClock(x.at) + ' ' + x.label.split(' · ')[0] + (trainsText(x.trains) ? ', ' + trainsText(x.trains) : ''));
    const energy = readEnergyBar() || m.strip.energy;
    // Stacking energy for a chain (Home's "I'm stacking"): no training steps, the energy is kept.
    if (m.stacking) {
        return { tone: 'amber', label: 'Stacking', pillText: 'Stacking for a chain · training paused', cardStep: 'Stacking for a chain', cardSub: 'Training paused · energy now ' + fmtInt(energy.current) + ' / ' + fmtInt(energy.max) + ', kept', energy, later: [] };
    }
    if (overdoseOf(m, reads, now)) {
        // Flying to Switzerland is the one thing to do: the plate rings.
        return { tone: 'amber', ring: true, label: OVERDOSE_WORDS.title, pillText: OVERDOSE_WORDS.pill, cardStep: OVERDOSE_WORDS.step, cardSub: OVERDOSE_WORDS.sub, later: [], action: { text: 'Open Travel', href: TRAVEL_URL } };
    }
    // Flying or abroad (Torn's travel answer): the gym is closed; the panel says when you are back, never "Train".
    if (m.away) {
        const w = awayWords(m.away);
        return { tone: 'amber', label: w.title, pillText: w.pill, cdAt: m.away.flying && m.away.until > now ? m.away.until : null, cardStep: w.step, cardSub: w.sub, energy, later };
    }
    const v = { energy, later };
    // On the gym page the bar follows the walk-through. Round 7: once the session is done and the next step is still
    // ahead, it moves on to that step and its countdown (it stayed on "Now · Session done").
    const gp = page === PAGE_GYM ? tp.lastGymPlan : null;
    const sessionOver = Boolean(((gp && gp.done) || live.spent) && next && next.at > now);
    if (gp && gp.pill && !sessionOver && !live.spent) {
        v.pillNow = 'Now';
        v.pillText = gp.pill;
    }
    // A jump or a daily boost due now: its checklist, ticked from the bars (every Torn page).
    const boostReads = { ...reads, happyTrained: next && isBoostStep(next) ? boostHappyTrained(get(K.gymSession, null), next, m.pc && m.pc.perks ? m.pc.perks.happyLossMult : 1, now) : 0 };
    const boost = next && isBoostStep(next) && next.at <= now + DUE_SLACK_MS ? boostProgress(next, boostReads) : null;
    if (next) {
        // Round 8 (the owner's pick B): a step due now is its actions in order, the one of the moment in the bar and in
        // big type, and the plate rings; a step still ahead is said in words, with its countdown (home.js panelStep).
        const ps = panelStep(next, { now, boost, sessionOver, reads: boostReads, steps: m.steps });
        if (!v.pillText) {
            if (ps.pillNow) v.pillNow = ps.pillNow;
            if (ps.cdAt) v.cdAt = ps.cdAt;
            v.pillText = ps.pillText;
        } else if (next.at > now) v.cdAt = next.at;
        Object.assign(v, { tone: ps.tone, ring: ps.ring, label: ps.label, cardStep: ps.cardStep, cardSub: ps.cardSub });
        if (ps.checklist) v.checklist = ps.checklist;
        if (next.strict && next.warnAt !== null && now >= next.warnAt) v.warn = 'Strict: ' + (next.note || 'on the tick');
        // The one button follows the action of the moment; with nothing due it is the webpage's alone.
        v.action = ps.acting ? stepAction(next, page, boost) : null;
    } else {
        v.pillText = 'Done for today';
        v.cardStep = 'Nothing left today';
        v.label = 'Today';
    }
    // The gym page's own states (overlays.html §6): the right gym, the wrong one, eat first, ready.
    const panel = gp && !sessionOver && !live.spent ? gymPanel(gp) : null;
    if (panel) {
        Object.assign(v, { tone: panel.tone, label: panel.title, cardStep: panel.step, cardSub: panel.sub, checklist: panel.checklist, action: panel.action });
        // The specialist stop ("Stop at 18 trains …"): it was the box's own line, now the panel's warning.
        const ps = gp.current && gp.perStat ? gp.perStat[gp.current.stat] : null;
        v.warn = ps && ps.warn ? ps.warn : null;
        // Something to do here now (train, switch gyms, eat first): the plate rings. "Take the Xanax first" rings only
        // once that Xanax is due (the step's own ring, above).
        v.ring = gp.state.kind === 'right' && ps && ps.noEnergy ? Boolean(v.ring) : ['right', 'wrong', 'eat', 'ready', 'overdose'].includes(gp.state.kind);
    }
    // Round 7 (the owner): nothing of ours inside Torn's page. The strip's words (where to switch, the group of gyms to
    // open, the energy kept, the session's parts) and Fill N are the panel's now.
    if (gp && !sessionOver && !live.spent) {
        const notes = gymNotes(gp, { hint: tp.gymHint || null });
        if (notes.length) v.notes = notes;
        const f = gymFill(gp);
        if (f) v.fill = { text: 'Fill ' + f.shown, disabled: f.disabled, title: f.title };
    }
    return v;
}

/**
 * The attack page (round 8, mockups/round8/torn-eye.html §4): Torn Eye's fight card has a Next button there, so the
 * panel's line under it reads "Training: DEX × 17 · after this fight" and never "Next": on that page "Next" means
 * one thing, the next target.
 */
export function attackPanelView(v, page) {
    if (page !== PAGE_ATTACK || !v || v.off || v.paused) return v;
    const out = { ...v };
    if (/^Train /.test(String(v.pillText || ''))) {
        out.pillText = 'Training: ' + String(v.pillText).slice(6) + (v.pillNow ? ' · after this fight' : '');
        delete out.pillNow;
    }
    if (v.label === 'Next') out.label = 'Training';
    if (v.cardStep) out.cardStep = String(v.cardStep).replace('Session done. Next: ', 'Session done. Then: ');
    return out;
}

/**
 * The panel while Torn Trading runs: an amber card that says where it is still seen and when it was last seen (round 7:
 * it said "starts again by itself within a minute", which isn't so while a tab opened before Torn Trading was turned
 * off still runs it), then the plan's next steps.
 */
export function pausedView(m, seen = tradingWhere()) {
    const steps = m && m.ready ? m.steps.slice(0, 2).map((x) => x.label.split(' · ')[0] + ' at ' + tornClock(x.at)) : [];
    return {
        paused: true,
        tone: 'amber',
        label: 'Paused · Torn Trading is on',
        pillText: 'Paused · Torn Trading is on',
        cardStep: '',
        seen,
        later: steps.length ? [steps.join(' · ')] : [],
    };
}

/** Everything we drew on Torn's page, gone (paused). */
function clearAll() {
    clearMarks();
    tp.lastGymPlan = null;
    tp.fill = null;
}

/** The panel's Fill N: types the number into Torn's reps box as it is now (React may have replaced it). Never TRAIN. */
function fillNow() {
    const f = tp.fill;
    if (!f || f.disabled || isPaused()) return;
    const box = readStatBoxes(gymRoot()).find((b) => b.stat === f.stat);
    if (box) fillTrains(box.input, f.n);
}

/* ----------------------------------------------------------- gym marks */

function drawGym(m) {
    if (isPaused()) return;
    const root = gymRoot();
    if (!root || gymLoading(root)) return;
    const buttons = readGymButtons(root);
    const sum = gymListSummary(buttons);
    // What the gym page tells us that the API doesn't: unlocked gyms and progress to the next.
    if (sum.unlocked.length) {
        const prev = get(K.unlocked, null);
        const next = [...new Set(sum.unlocked)].sort((a, b) => a - b);
        if (JSON.stringify(prev) !== JSON.stringify(next)) {
            set(K.unlocked, next);
            pi.modelAt = 0;
        }
    }
    if (sum.inProgress && sum.inProgress.percent !== null) {
        const need = unlockEnergyAfter(sum.inProgress.id - 1, m && m.pc ? m.pc.perks.gymExpMult : 1) || 0;
        const gp = { nextId: sum.inProgress.id, energy: Math.round((need * sum.inProgress.percent) / 100), at: Date.now() };
        const prev = get(K.gymProgress, null);
        if (!prev || prev.nextId !== gp.nextId || prev.energy !== gp.energy) {
            set(K.gymProgress, gp);
            pi.modelAt = 0;
        }
    }
    if (!m || !m.ready || !getSettings().gymMarks) {
        clearMarks();
        // Marks off: the panel's pill stops showing the gym plan too.
        tp.lastGymPlan = null;
        tp.fill = null;
        return;
    }
    const boxes = readStatBoxes(root);
    // The walk-through: Torn's own boxes and energy bar move the moment a train lands (the model can be 30 s old).
    const now = Date.now();
    const reading = pageReading(m, boxes, readEnergyBar());
    const prev = get(K.gymSession, null);
    const session = nextSession(prev, m, reading, now, { table: m.pc.table, perks: m.pc.perks.mult });
    if (JSON.stringify(session) !== JSON.stringify(prev)) set(K.gymSession, session);
    // Round 7: the gym page's states come from the same reads (the sidebar's happy and energy, the model's cooldowns).
    const reads = liveReads(m);
    const plan = planGymPage(m, { selectedId: sum.selectedId || m.state.gymId, boxes, reading, reads, overdose: overdoseOf(m, reads, now) }, session, now);
    tp.lastGymPlan = plan;
    const f = gymFill(plan);
    tp.fill = f ? { stat: f.stat, n: f.n, disabled: f.disabled } : null;
    // On our own layer, over Torn's boxes (nothing goes into Torn's page).
    const drawn = drawGymMarks(plan, boxes, buttons, { motion: getSettings().motion !== false });
    // The gym to go to isn't on the page (Torn shows one group of gyms at a time): the panel says which group to open.
    tp.gymHint = plan.nextGym && !drawn.nextGymShown ? 'Open ' + plan.nextGym.group.replace(/^a /, 'the ') + 's to find it' : null;
    tp.gymSig = gymPageSig(root);
}

/** What Torn's gym page shows that the marks depend on: the stat boxes, the gym selected, the energy bar. */
function gymPageSig(root) {
    const boxes = readStatBoxes(root).map((b) => b.stat + ':' + b.value + ':' + (b.locked ? 1 : 0)).join(',');
    const sel = gymListSummary(readGymButtons(root)).selectedId;
    // A box we marked replaced by Torn (a re-render with the same value): drawn again over the new one.
    return [boxes, sel, JSON.stringify(readEnergyBar()), JSON.stringify(readHappyBar()), gymLoading(root) ? 1 : 0, marksLost() ? 1 : 0].join('|');
}

function watchGym() {
    const root = gymRoot();
    if (!root) return;
    // Torn may replace the gym root: watch the new one.
    if (tp.observer && tp.observedRoot === root) return;
    if (tp.observer) tp.observer.disconnect();
    tp.observedRoot = root;
    let timer = null;
    // Redraw only when Torn's own values change (a train, another gym, the energy bar, our marks wiped by a re-render),
    // never on any mutation: other scripts (TornTools) and Torn's timers change the page all the time, and two
    // scripts redrawing on each other's changes could loop.
    tp.observer = new MutationObserver(() => {
        if (isPaused()) return;
        // Torn's page moved (a message, a box re-rendered): our rings follow at the next frame. Nothing of ours is
        // inside #gymroot, so every change seen here is Torn's (or another script's).
        scheduleMarks();
        clearTimeout(timer);
        timer = setTimeout(() => {
            const r = gymRoot();
            if (r && gymPageSig(r) === tp.gymSig) return;
            drawGym(tp.model);
            // The panel's pill follows the walk-through at once (a train, another gym), not at the next model.
            if (tp.showView) tp.showView(tp.model);
        }, 150);
    });
    tp.observer.observe(root, { childList: true, subtree: true });
}

/* ------------------------------------------------ the sidebar's bars */

/**
 * Round 7 (D.4): the panel moved to the next step only at the next 30 s read. Torn's own sidebar shows an action the
 * moment it happens (energy drops on a train, jumps on a Xanax or refill; happy moves on a booster): when it does,
 * the state is read about two seconds after the last change (runtime readSoon). Read-only: two numbers are looked
 * at, nothing on Torn's page is touched. Regeneration ticks alone ask for nothing.
 */
function watchBars() {
    if (tp.barsTimer) return;
    const look = () => ({ energy: readEnergyBar(), happy: readHappyBar() });
    let last = look();
    let observed = null;
    let seen = 0;
    const check = () => {
        if (isPaused() || !isVisible()) return;
        const now = look();
        // The last reading with something in the bars: an overdose is a fall from it that training can't explain.
        tp.barsSeen = nextBarsSeen(tp.barsSeen, now, Date.now());
        if (barsActed(last, now)) readSoon();
        last = now;
    };
    const attach = () => {
        const node = document.getElementById('sidebarroot') || (document.getElementById('barEnergy') || {}).parentNode || null;
        if (!node || node === observed) return;
        if (tp.barsObserver) tp.barsObserver.disconnect();
        observed = node;
        tp.barsObserver = new MutationObserver(() => {
            // Torn's sidebar ticks its own timers every second: look at most every 300 ms.
            const t = Date.now();
            if (t - seen < 300) return;
            seen = t;
            check();
        });
        tp.barsObserver.observe(node, { childList: true, subtree: true, characterData: true });
    };
    attach();
    // Torn may replace the sidebar (page changes without a load): find it again, and look once in case a change was skipped.
    tp.barsTimer = setInterval(() => {
        attach();
        check();
    }, 5000);
}

/* -------------------------------------------------- items and markets */

function drawItems(m) {
    clearMarks();
    // Stacking for a chain: no step to buy for until Resume (the panel says so).
    if (!m || !m.ready || m.stacking || !getSettings().marketMarks) return;
    const idx = m.steps.findIndex((s) => (s.items || []).some((it) => it.id !== POINTS));
    if (idx < 0) return;
    const step = m.steps[idx];
    const n = m.done.length + idx + 1;
    // At most one thing glows on a page: the first one marked.
    let glow = true;
    for (const it of step.items) {
        for (const row of readItemRows().filter((r) => r.itemId === Number(it.id))) {
            markListing(row.el, 'Step ' + n + ' of today · ' + step.label.split(' · ')[0], { glow });
            glow = false;
        }
    }
    placeMarks();
}

/** The Buy list's chosen listings (same window as the Buy tab). */
function chosenFills(m) {
    const s = getSettings();
    const statics = get(K.userStatic, {}) || {};
    const prices = getPrices();
    const needs = needList(needsForWindow(m, m.compare, { ...getPlan(), strategy: m.strategy || getPlan().strategy }, s.buyWindow || 'three', m.planDays || s.horizonDays), statics.inventory || {});
    // The same list as the Buy tab: its type ticks, and a city shop you ticked joins the listings.
    const show = shownTypes(s, [...new Set(needs.map((n) => typeOf(n.id)))]);
    const ic = itemContext(statics, s, m.now);
    const out = [];
    // Today's city-shop allowance, shared by every item bought there.
    let left = ic.cityLeft;
    for (const n of needs) {
        if (!(n.buy > 0) || !show.has(typeOf(n.id))) continue;
        const p = prices[n.id] || {};
        const shop = ic.npc[n.id] ? npcListing(ic.npc[n.id], n.buy, left) : null;
        const listings = (Array.isArray(p.listings) ? p.listings : []).concat(shop ? [shop] : []);
        if (!listings.length) continue;
        const fill = fillCheapest(listings, n.buy, n.id);
        if (left !== null) left = Math.max(0, left - fill.rows.filter((r) => r.source === 'npc').reduce((a, r) => a + r.qty, 0));
        out.push({ id: n.id, fill });
    }
    return out;
}

function drawMarket(m, page) {
    clearMarks();
    if (!m || !m.ready || !getSettings().marketMarks) return;
    // On a market page, the Buy list's prices are refreshed (at most every 5 minutes) so the outline is current.
    const s = getSettings();
    const want = needList(needsForWindow(m, m.compare, { ...getPlan(), strategy: m.strategy || getPlan().strategy }, s.buyWindow || 'three', m.planDays || s.horizonDays), (get(K.userStatic, {}) || {}).inventory || {}).filter((n) => n.buy > 0).map((n) => n.id);
    if (want.length) loadPrices(want).catch(() => {});
    const fills = chosenFills(m);
    const label = (r) => 'Take ' + fmtInt(r.qty) + ' · $' + fmtInt(r.subtotal);
    // The chosen listing with its chalk tab ("TAKE 3 · $2,479,500"); at most one thing glows on a page: the first.
    let glow = true;
    const mark = (el, text) => {
        markListing(el, text, { glow });
        glow = false;
    };
    if (page === PAGE_BAZAAR) {
        const owner = bazaarOwnerId(location.href);
        const cards = readBazaarCards();
        for (const f of fills) for (const r of f.fill.rows) if (r.source === SOURCE_BAZAAR && r.sellerId === owner) {
            const card = cards.find((c) => c.itemId === Number(f.id) && c.price === r.price);
            if (card) mark(card.el, label(r));
        }
    } else if (page === PAGE_ITEM_MARKET) {
        const item = Number(itemMarketItemOf(location.href));
        const rows = readItemMarketRows();
        for (const f of fills) if (Number(f.id) === item) for (const r of f.fill.rows) if (r.source === SOURCE_ITEM_MARKET) {
            const row = rows.find((x) => x.price === r.price);
            if (row) mark(row.el, label(r));
        }
    } else if (page === PAGE_POINTS) {
        const rows = readPointsRows();
        for (const f of fills) if (f.id === POINTS) for (const r of f.fill.rows) if (r.source === SOURCE_POINTS) {
            const row = rows.find((x) => (r.listingId && x.listingId === r.listingId) || x.price === r.price);
            if (row) mark(row.el, label(r));
        }
    }
    placeMarks();
}

/* ------------------------------------------------------------- wiring */

/** How many rows the page shows now: lists load after the page does. */
function pageRowsCount(p) {
    if (p === PAGE_ITEMS) return readItemRows().length;
    if (p === PAGE_BAZAAR) return readBazaarCards().length;
    if (p === PAGE_ITEM_MARKET) return readItemMarketRows().length;
    if (p === PAGE_POINTS) return readPointsRows().length;
    return 0;
}

/** What this Torn page is about, for the API lanes: Torn Eye pages or market pages go first while open. */
export function tornPageFocus(href = location.href) {
    const p = detectPage(href);
    if (p === PAGE_PROFILE || p === PAGE_FACTION || p === PAGE_ATTACK) return { focus: 'eye', war: p === PAGE_FACTION && Boolean(document.getElementById('faction_war_list_id')) };
    if (p === PAGE_ITEMS || p === PAGE_BAZAAR || p === PAGE_ITEM_MARKET || p === PAGE_POINTS) return { focus: 'prices', war: false };
    return { focus: null, war: false };
}

export function bootTornPage() {
    ensureMarkCss();
    pi.focusOf = () => tornPageFocus();
    beatFocus();
    tp.overlay = new Overlay({
        // A key problem opens straight on Settings, where the key is replaced.
        onOpen: () => gmOpenTab(APP_PAGE_URL + (currentProblem() && !(tp.model && tp.model.ready) ? '#settings' : '')),
        loadPos: () => get(K.overlayPos, null),
        savePos: (p) => set(K.overlayPos, p),
        loadCollapsed: () => Boolean(get(K.overlayCollapsed, false)),
        saveCollapsed: (v) => set(K.overlayCollapsed, v),
        pageRect,
        avoidRect: tradingRect,
        // The attack page: folded to one line under Torn Eye's fight card, never on top of it (round 7).
        dockTo: () => (detectPage(location.href) === PAGE_ATTACK ? document.getElementById('pi-eyecard') : null),
        // A profile's Torn Eye card that had to take the panel's margin: the panel folds under it instead of covering it.
        dockIfShared: () => document.getElementById('pi-eyecard'),
        // Torn Eye's tags on faction and war lists (eye-page.js notes their column on its layer): never the same margin.
        avoidColumn: eyeColumn,
        // Fill N on the gym page: types into Torn's reps box on your click (never TRAIN).
        onFill: fillNow,
        // Torn Eye's chain counter rides on top of the panel (round 8): the panel starts under it.
        ride: eyeRideChain,
    });
    tp.overlay.mount();
    gmMenu('Reset overlay position', () => {
        set(K.overlayPos, null);
        set(K.overlayCollapsed, false);
        tp.overlay.setCollapsed(false, false);
    });
    let lastSig = '';
    let lastView = '';
    tp.showView = (m) => {
        const view = attackPanelView(overlayView(m, detectPage(location.href)), detectPage(location.href));
        // Settings › Animations off: the plate's ring is drawn, not moving.
        if (!view.off) view.still = getSettings().motion === false;
        const vs = JSON.stringify(view);
        if (vs !== lastView) {
            lastView = vs;
            tp.overlay.update(view);
        }
    };
    // The paused card follows where Torn Trading is still seen (another tab reloaded or closed) without a new model.
    const showPaused = (m) => {
        const pv = pausedView(m);
        const s = JSON.stringify(pv);
        if (s !== lastView) {
            lastView = s;
            tp.overlay.update(pv);
        }
    };
    onModel((m) => {
        tp.model = m;
        if (!isVisible()) return;
        // Taking turns with Torn Trading: nothing on Torn's page, only the panel with a warning sign.
        if (isPaused()) {
            if (lastSig !== 'paused') {
                lastSig = 'paused';
                clearAll();
            }
            showPaused(m);
            return;
        }
        const p = detectPage(location.href);
        // The saved plan (made, recalibrated or another picked on the webpage) redraws the marks too.
        const planSig = m && m.ready && m.saved ? m.saved.createdAt + ':' + (m.saved.recalibratedAt || 0) : '';
        // What you hold is read after the first draw (the slow data): the marks take it off, so it redraws them.
        const heldSig = JSON.stringify((get(K.userStatic, {}) || {}).inventory || {});
        // Stacking for a chain, or an overdose seen on the bars: the gym page's marks change at once.
        const stateSig = JSON.stringify([(m && m.stacking) || null, overdoseOf(m), (m && m.away) || null]);
        const sig = [p, location.hash, m && m.ready ? m.state.at : 'x', JSON.stringify(getSettings()), JSON.stringify(getPlan()), planSig, heldSig, stateSig, Object.values(getPrices()).map((x) => x.at).join(), pageRowsCount(p)].join('|');
        if (sig !== lastSig) {
            lastSig = sig;
            if (p === PAGE_GYM) {
                watchGym();
                drawGym(m);
            } else if (p === PAGE_ITEMS) drawItems(m);
            else if (p === PAGE_BAZAAR || p === PAGE_ITEM_MARKET || p === PAGE_POINTS) drawMarket(m, p);
        }
        tp.showView(m);
    });
    setInterval(() => {
        tp.overlay.tick();
        if (isVisible() && isPaused()) showPaused(tp.model);
        // Our marks follow Torn's page (lists that load or grow, images): once a second they are placed again, and a
        // listing Torn replaced is marked again on the new one (nothing of ours is inside Torn's page to notice it).
        if (isVisible() && !isPaused() && marksCount()) {
            const p = detectPage(location.href);
            if (marksLost()) {
                if (p === PAGE_ITEMS) drawItems(tp.model);
                else if (p === PAGE_BAZAAR || p === PAGE_ITEM_MARKET || p === PAGE_POINTS) drawMarket(tp.model, p);
                else scheduleMarks();
            } else scheduleMarks();
        }
    }, 1000);
    // A resized window, or a scroll inside one of Torn's boxes: the marks are placed again (once a frame at most).
    window.addEventListener('resize', scheduleMarks);
    document.addEventListener('scroll', scheduleMarks, { capture: true, passive: true });
    watchBars();
    // Torn's pages change the hash without a load (Item Market search, items tabs).
    window.addEventListener('hashchange', () => {
        lastSig = '';
    });
}
