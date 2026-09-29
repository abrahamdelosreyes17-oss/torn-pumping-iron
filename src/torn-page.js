/*
 * On torn.com: the overlay pill and the marks on the page being viewed.
 * Reads only the page the user opened; types into Torn's reps box only on
 * a Fill click; never clicks Torn's buttons; nothing from a hidden tab.
 */

import { gmMenu, gmOpenTab } from './platform/gm.js';
import { K, get, set, getKey, getSettings, getPlan } from './platform/store.js';
import { keyProblem } from './ui/key-status.js';
import { onModel, isVisible, refresh } from './runtime.js';
import { isPaused, onPauseChange } from './turns.js';
import { Overlay } from './ui/overlay.js';
import { ensureMarkCss, clearMarks, drawGymMarks, outline } from './ui/marks/marks.js';
import { gymRoot, gymLoading, readStatBoxes, readGymButtons, gymListSummary } from './sources/dom/gym.js';
import { readItemRows, readBazaarCards, readItemMarketRows, readPointsRows } from './sources/dom/market.js';
import { planGymPage } from './core/gympage.js';
import { unlockEnergyAfter } from './core/gyms.js';
import { needsForWindow } from './ui/app/buy.js';
import { loadPrices } from './app-page.js';
import { needList, fillCheapest, SOURCE_BAZAAR, SOURCE_ITEM_MARKET, SOURCE_POINTS } from './core/market.js';
import { stepWords } from './ui/app/home.js';
import { trainsText } from './ui/app/common.js';
import { tornClock } from './core/bars.js';
import { fmtInt } from './core/format.js';
import { POINTS } from './core/items.js';
import { detectPage, bazaarOwnerId, itemMarketItemOf, APP_PAGE_URL, PAGE_GYM, PAGE_ITEMS, PAGE_BAZAAR, PAGE_ITEM_MARKET, PAGE_POINTS } from './sources/route.js';

const tp = { overlay: null, model: null, observer: null, drawing: false, lastGymPlan: null };

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

/* ---------------------------------------------------------------- pill */

/** Why there's no state yet (key refused, too limited, Torn not answering), or null. */
function currentProblem() {
    return keyProblem({ hasKey: Boolean(getKey(K.apiKey)), dead: Boolean(get(K.apiKeyDead, false)), stateError: get(K.stateError, null), keyInfo: (get(K.userStatic, {}) || {}).keyInfo || null });
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
    const next = m.next;
    const later = m.steps.slice(1, 3).map((x) => tornClock(x.at) + ' · ' + x.label + (trainsText(x.trains) ? ', ' + trainsText(x.trains) : ''));
    const v = { energy: m.strip.energy, happy: m.strip.happy, later };
    if (page === PAGE_GYM && tp.lastGymPlan && tp.lastGymPlan.pill) {
        v.pillNow = 'Now';
        v.pillText = tp.lastGymPlan.pill;
    }
    if (next) {
        const due = next.at <= Date.now();
        if (!v.pillText) {
            if (due) {
                v.pillNow = 'Now';
                v.pillText = next.kind === 'natural' ? 'Train ' + trainsText(next.trains) : next.label.split(' · ')[0];
            } else {
                v.cdAt = next.at;
                v.pillText = next.label.split(' · ')[0];
            }
        } else if (!due) v.cdAt = next.at;
        v.cardStep = stepWords(next);
        v.cardSub = next.gain ? 'about +' + fmtInt(next.gain) + (next.energy ? ' · ' + fmtInt(next.energy) + ' energy' : '') : null;
        if (next.strict && next.warnAt !== null && Date.now() >= next.warnAt) v.warn = 'Strict: ' + (next.note || 'on the tick');
    } else {
        v.pillText = 'Done for today';
        v.cardStep = 'Nothing left today';
    }
    return v;
}

/** The panel while Torn Trading runs: a warning sign, why, how to switch, and the plan's last steps. */
export function pausedView(m) {
    const steps = m && m.ready ? m.steps.slice(0, 2).map((x) => x.label.split(' · ')[0] + ' at ' + tornClock(x.at)) : [];
    return {
        paused: true,
        pillText: 'Paused · Torn Trading is on',
        cardStep: 'Pumping Iron and Torn Trading can’t run at the same time: they’d share Torn’s 100 calls a minute and mark the same listings.',
        cardSub: 'To use Pumping Iron: turn off Torn Trading in Tampermonkey (or close its Torn Bids tab). Pumping Iron starts again by itself within a minute. Nothing is asked from Torn while paused.',
        later: steps.length ? ['Your plan’s next steps: ' + steps.join(' · ')] : [],
    };
}

/** Everything we drew on Torn's page, gone (paused). */
function clearAll() {
    const root = gymRoot();
    if (root) clearMarks(root);
    clearMarks(document.querySelector('.content-wrapper') || document);
    tp.lastGymPlan = null;
}

/* ----------------------------------------------------------- gym marks */

function drawGym(m) {
    const root = gymRoot();
    if (!root || gymLoading(root)) return;
    const buttons = readGymButtons(root);
    const sum = gymListSummary(buttons);
    // What the gym page tells us that the API doesn't: unlocked gyms and progress to the next.
    if (sum.unlocked.length) {
        const prev = get(K.unlocked, null);
        const next = [...new Set(sum.unlocked)].sort((a, b) => a - b);
        if (JSON.stringify(prev) !== JSON.stringify(next)) set(K.unlocked, next);
    }
    if (sum.inProgress && sum.inProgress.percent !== null) {
        const need = unlockEnergyAfter(sum.inProgress.id - 1, m && m.pc ? m.pc.perks.gymExpMult : 1) || 0;
        const gp = { nextId: sum.inProgress.id, energy: Math.round((need * sum.inProgress.percent) / 100), at: Date.now() };
        const prev = get(K.gymProgress, null);
        if (!prev || prev.nextId !== gp.nextId || prev.energy !== gp.energy) set(K.gymProgress, gp);
    }
    if (!m || !m.ready || !getSettings().gymMarks) {
        clearMarks(root);
        return;
    }
    const boxes = readStatBoxes(root);
    const plan = planGymPage(m, { selectedId: sum.selectedId || m.state.gymId, boxes });
    tp.lastGymPlan = plan;
    tp.drawing = true;
    try {
        drawGymMarks(root, plan, boxes, (stat) => readStatBoxes(gymRoot()).find((b) => b.stat === stat));
    } finally {
        tp.drawing = false;
    }
}

function watchGym() {
    const root = gymRoot();
    if (!root) return;
    // Torn may replace the gym root: watch the new one.
    if (tp.observer && tp.observedRoot === root) return;
    if (tp.observer) tp.observer.disconnect();
    tp.observedRoot = root;
    let timer = null;
    tp.observer = new MutationObserver((muts) => {
        if (tp.drawing) return;
        // Our own marks changing is not Torn re-rendering.
        if (muts.every((mu) => [...mu.addedNodes, ...mu.removedNodes].every((n) => n.nodeType === 1 && n.classList && n.classList.contains('pi-mark')))) return;
        clearTimeout(timer);
        timer = setTimeout(() => drawGym(tp.model), 150);
    });
    tp.observer.observe(root, { childList: true, subtree: true });
}

/* -------------------------------------------------- items and markets */

function drawItems(m) {
    clearMarks(document.querySelector('.content-wrapper') || document);
    if (!m || !m.ready || !getSettings().marketMarks) return;
    const idx = m.steps.findIndex((s) => (s.items || []).some((it) => it.id !== POINTS));
    if (idx < 0) return;
    const step = m.steps[idx];
    const n = m.done.length + idx + 1;
    for (const it of step.items) {
        for (const row of readItemRows().filter((r) => r.itemId === Number(it.id))) outline(row.el, 'Step ' + n + ' of today · ' + step.label.split(' · ')[0]);
    }
}

/** The Buy list's chosen listings (same window as the Buy tab). */
function chosenFills(m) {
    const s = getSettings();
    const statics = get(K.userStatic, {}) || {};
    const prices = get(K.prices, {}) || {};
    const needs = needList(needsForWindow(m, m.compare, getPlan(), s.buyWindow || 'three', s.horizonDays), statics.inventory || {});
    const out = [];
    for (const n of needs) {
        const p = prices[n.id];
        if (n.buy > 0 && p && p.listings) out.push({ id: n.id, fill: fillCheapest(p.listings, n.buy, n.id) });
    }
    return out;
}

function drawMarket(m, page) {
    clearMarks(document.querySelector('.content-wrapper') || document);
    if (!m || !m.ready || !getSettings().marketMarks) return;
    // On a market page, the Buy list's prices are refreshed (at most every 5 minutes) so the outline is current.
    const s = getSettings();
    const want = needList(needsForWindow(m, m.compare, getPlan(), s.buyWindow || 'three', s.horizonDays), (get(K.userStatic, {}) || {}).inventory || {}).filter((n) => n.buy > 0).map((n) => n.id);
    if (want.length) loadPrices(want).catch(() => {});
    const fills = chosenFills(m);
    const label = (r) => 'Take ' + fmtInt(r.qty) + ' · $' + fmtInt(r.subtotal);
    if (page === PAGE_BAZAAR) {
        const owner = bazaarOwnerId(location.href);
        const cards = readBazaarCards();
        for (const f of fills) for (const r of f.fill.rows) if (r.source === SOURCE_BAZAAR && r.sellerId === owner) {
            const card = cards.find((c) => c.itemId === Number(f.id) && c.price === r.price);
            if (card) outline(card.el, label(r));
        }
    } else if (page === PAGE_ITEM_MARKET) {
        const item = Number(itemMarketItemOf(location.href));
        const rows = readItemMarketRows();
        for (const f of fills) if (Number(f.id) === item) for (const r of f.fill.rows) if (r.source === SOURCE_ITEM_MARKET) {
            const row = rows.find((x) => x.price === r.price);
            if (row) outline(row.el, label(r));
        }
    } else if (page === PAGE_POINTS) {
        const rows = readPointsRows();
        for (const f of fills) if (f.id === POINTS) for (const r of f.fill.rows) if (r.source === SOURCE_POINTS) {
            const row = rows.find((x) => (r.listingId && x.listingId === r.listingId) || x.price === r.price);
            if (row) outline(row.el, label(r));
        }
    }
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

export function bootTornPage() {
    ensureMarkCss();
    tp.overlay = new Overlay({
        // A key problem opens straight on Settings, where the key is replaced.
        onOpen: () => gmOpenTab(APP_PAGE_URL + (currentProblem() && !(tp.model && tp.model.ready) ? '#settings' : '')),
        loadPos: () => get(K.overlayPos, null),
        savePos: (p) => set(K.overlayPos, p),
        loadCollapsed: () => Boolean(get(K.overlayCollapsed, false)),
        saveCollapsed: (v) => set(K.overlayCollapsed, v),
        pageRect,
        avoidRect: tradingRect,
    });
    tp.overlay.mount();
    gmMenu('Reset overlay position', () => {
        set(K.overlayPos, null);
        set(K.overlayCollapsed, false);
        tp.overlay.setCollapsed(false, false);
    });
    let lastSig = '';
    let lastView = '';
    onModel((m) => {
        tp.model = m;
        if (!isVisible()) return;
        // Taking turns with Torn Trading: nothing on Torn's page, only the panel with a warning sign.
        if (isPaused()) {
            if (lastSig !== 'paused') {
                lastSig = 'paused';
                clearAll();
            }
            const pv = JSON.stringify(pausedView(m));
            if (pv !== lastView) {
                lastView = pv;
                tp.overlay.update(pausedView(m));
            }
            return;
        }
        const p = detectPage(location.href);
        const sig = [p, location.hash, m && m.ready ? m.state.at : 'x', JSON.stringify(getSettings()), Object.values(get(K.prices, {}) || {}).map((x) => x.at).join(), pageRowsCount(p)].join('|');
        if (sig !== lastSig) {
            lastSig = sig;
            if (p === PAGE_GYM) {
                watchGym();
                drawGym(m);
            } else if (p === PAGE_ITEMS) drawItems(m);
            else if (p === PAGE_BAZAAR || p === PAGE_ITEM_MARKET || p === PAGE_POINTS) drawMarket(m, p);
        }
        const view = overlayView(m, p);
        const vs = JSON.stringify(view);
        if (vs !== lastView) {
            lastView = vs;
            tp.overlay.update(view);
        }
    });
    setInterval(() => tp.overlay.tick(), 1000);
    // Torn's pages change the hash without a load (Item Market search, items tabs).
    window.addEventListener('hashchange', () => {
        lastSig = '';
    });
}
