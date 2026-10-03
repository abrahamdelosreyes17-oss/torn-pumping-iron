/*
 * Torn Eye on torn.com (round 7, the owner's pick in mockups/round7/overlays.html):
 *   - a profile: a card in the free space beside Torn's page, level with the
 *     profile's title (full, narrower or smallest by the room there; the
 *     left-hand space when the right one is too narrow); never a line on
 *     Torn's page;
 *   - the mini-profile popup: one tag on our layer just under it (above it
 *     when the window has no room below), never inside or over it;
 *   - faction and ranked-war lists: Torn's rows untouched and in Torn's own
 *     order; a band edge on our own layer and a tag per row in the free space,
 *     level with the row, and a summary tag on top (our order lives there);
 *   - the attack page: the fight card (#pi-eyecard) beside the fight, and the
 *     read-only attackData reader that saves their gear.
 * Re-placed when the window is resized or Torn's page moves. Nothing of ours
 * goes into Torn's page: no element, class or style on Torn's own elements.
 */

import { K, get, set, getSettings } from './platform/store.js';
import { addPrediction } from './core/learndata.js';
import { pi, onModel, isVisible } from './runtime.js';
import { isPaused, onPauseChange } from './turns.js';
import { installAttackHook } from './platform/page-hook.js';
import { gmOnChange } from './platform/gm.js';
import { wantPlayers, eyeView, sharedView, eyeReady, loadEyeCache, onEye, saveGear, getWatch, toggleWatch, setWatchTag, EYE_CHAIN_KEY, EYE_NEXT_KEY } from './eye-service.js';
import { WATCH_MAX } from './core/eye/watch.js';
import { parseAttackData } from './core/eye/gear.js';
import { sortWar, memberState } from './core/eye/war.js';
import { chainFromBar, chainSide, sharedChain, CHAIN_FRESH_MS } from './core/eye/chain.js';
import { nextTarget, ATTACK_OPENED_MS } from './core/eye/targets.js';
import { profileLevel, profileAnchor, readFactionRows, readWarRows, miniProfileId, attackRoot, readChainBar, enemyFactionId } from './sources/dom/eye.js';
import { ensureEyeCss, bindCard, eyeCardSpot, eyeRowSpot, eyeProfileCard, eyeFightCard, eyeMiniLine, eyeMiniSpot, eyeRowTag, eyeEdgeBar, eyeSummary, eyeSummaryTag, eyeStatusSeconds, eyeShown, eyeLayer, eyeLayerPart, eyeClearPart, eyeTickOut, eyeNextEarly, eyeRowsSig, eyeUntilMoved, eyeChainCard, eyeChainTick, EYE_CHAIN_LINES_W } from './ui/eye/eye-ui.js';
import { ensureMarkCss } from './ui/marks/marks.js';
import { fill } from './ui/dom.js';
import { detectPage, profileIdOf, attackTargetOf, attackUrl, APP_PAGE_URL, PAGE_PROFILE, PAGE_FACTION, PAGE_ATTACK } from './sources/route.js';

const ep = { extras: new Map(), war: { prev: null, early: new Map() }, drawn: { war: null, faction: null }, attack: { gearVisible: false, gearSaved: false }, drawing: false, sig: {}, lists: {}, layoutSig: '', chain: { sig: '', spot: null } };

function view(id) {
    const x = ep.extras.get(id) || {};
    const v = eyeView(id, x, { war: false });
    // No estimate on this site: what the Torn Eye tab's war mode worked out, when it did.
    return v && v.est ? v : sharedView(id, x) || v;
}

/* ------------------------------------------------------------- where Torn's page is */

/** Torn's page (sidebar + content) on screen; a centred 976 px page when it can't be measured. */
function eyeTornPage() {
    const parts = [document.querySelector('.content-wrapper'), document.getElementById('sidebarroot'), document.getElementById('sidebar')].filter(Boolean);
    const rects = parts.map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
    if (rects.length) return { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)) };
    const vw = eyeViewW();
    const w = Math.min(vw, 976);
    return { left: (vw - w) / 2, right: (vw + w) / 2 };
}

/** The window's width without its scrollbar. */
function eyeViewW() {
    return (document.documentElement && document.documentElement.clientWidth) || window.innerWidth;
}

/**
 * The training panel on screen (our own, in its shadow root; null when hidden). Round 7 review: the list tags and the
 * hover card leave its margin when the other one has room, and the panel leaves the tags' column (data-pi-col).
 */
function eyePanelRect() {
    const host = document.getElementById('pi-overlay');
    const w = host && host.shadowRoot && host.shadowRoot.querySelector('.wrap');
    if (!w) return null;
    const r = w.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? r : null;
}

/** The chain counter on screen (null when hidden): with no panel to ride on it holds a margin of its own. */
function eyeChainRect() {
    const el = document.getElementById('pi-chaincard');
    const r = el ? el.getBoundingClientRect() : null;
    return r && r.width > 0 && r.height > 0 ? r : null;
}

/** Where list tags go now (eyeRowSpot, clear of the panel and of the chain counter that sits on it). */
function eyeListSpot() {
    return eyeRowSpot(eyeViewW(), eyeTornPage(), eyePanelRect() || eyeChainRect());
}

/** Note the tags' column on our layer (x from, x to, on screen) for the panel to keep out of; none: no tags. */
function eyeMarkColumn(spot) {
    const layer = document.getElementById('pi-eye-layer');
    if (!layer) return;
    const v = spot && spot.mode !== 'none' && Object.keys(ep.lists).length ? Math.round(spot.x) + ',' + Math.round(spot.x + spot.width) : null;
    if (v === layer.getAttribute('data-pi-col')) return;
    if (v) layer.setAttribute('data-pi-col', v);
    else layer.removeAttribute('data-pi-col');
}

/** Where our layer's (0, 0) is on screen: its children are placed in page coordinates from there. */
function eyeOrigin() {
    const r = eyeLayer().getBoundingClientRect();
    return { x: r.left, y: r.top };
}

/* ------------------------------------------------------------- watch */

const watchUi = { full: null };

function watchState(id) {
    const w = getWatch();
    const e = w.list.find((x) => Number(x.id) === Number(id));
    return { watching: Boolean(e), tag: e ? e.tag : null, full: watchUi.full === Number(id) && !e && w.list.length >= WATCH_MAX };
}

function toggleFor(id) {
    const v = view(id) || {};
    const x = ep.extras.get(id) || {};
    const r = toggleWatch({ id, name: v.name || x.name || null, level: v.level || x.level || null });
    watchUi.full = r.ok ? null : id;
    drawAll();
}

function watchHandlers(id) {
    return { toggle: () => toggleFor(id), tag: (t) => { setWatchTag(id, t); drawAll(); } };
}

/* ------------------------------------------------------------ profile */

function drawProfile() {
    const id = Number(profileIdOf(location.href));
    const anchor = profileAnchor();
    const part = eyeLayerPart('profile');
    if (!id || !anchor) return;
    ep.extras.set(id, { ...(ep.extras.get(id) || {}), level: profileLevel() });
    const spot = eyeCardSpot(eyeViewW(), eyeTornPage());
    if (spot.mode === 'none') {
        // No room beside Torn's page: nothing (owner: never a line on Torn's page).
        fill(part, []);
        ep.sig.profile = '';
        return;
    }
    const next = eyeProfileCard(view(id), spot.mode, { id, watch: { state: watchState(id), on: watchHandlers(id) } });
    // The card stays while it says the same (a redraw would close the watch reason picker).
    let card = part.firstElementChild;
    if (!card || ep.sig.profile !== next.outerHTML) {
        ep.sig.profile = next.outerHTML;
        fill(part, [next]);
        card = next;
    }
    const o = eyeOrigin();
    const t = anchor.getBoundingClientRect();
    card.style.width = spot.width + 'px';
    card.style.left = Math.round(spot.x - o.x) + 'px';
    card.style.top = Math.round(t.top - o.y) + 'px';
}

/** Torn's mini-profile popup (the box we sit under), or null. */
function miniPopup() {
    const root = document.getElementById('profile-mini-root');
    return root ? root.querySelector('.mini-profile-wrapper') || root.querySelector('.profile-container') || root : null;
}

/** The mini-profile's tag, on our layer (round 7, the owner: never inside Torn's popup). */
function drawMini() {
    const id = miniProfileId();
    const part = eyeLayerPart('mini');
    if (!id || !miniPopup()) {
        fill(part, []);
        return;
    }
    // At most one thing glows on a page: the mini-profile only when nothing else does.
    const glow = !document.querySelector('#pi-eye-layer [data-pi-part]:not([data-pi-part="mini"]) .pi-glow, #pi-eyecard.pi-glow');
    fill(part, [eyeMiniLine(view(id), { id, glow })]);
    placeMini();
}

/** Just under the popup, as wide as it, inside the window (above it when there's no room below). */
function placeMini() {
    const layer = document.getElementById('pi-eye-layer');
    const line = layer && layer.querySelector('[data-pi-part="mini"] .pi-mini-line');
    if (!line) return;
    const pop = miniPopup();
    const r = pop ? pop.getBoundingClientRect() : null;
    if (!r || !(r.width > 0) || !(r.height > 0) || !miniProfileId()) {
        line.style.display = 'none';
        return;
    }
    line.style.display = '';
    const o = eyeOrigin();
    line.style.width = Math.round(Math.min(r.width, eyeViewW() - 4)) + 'px';
    const s = eyeMiniSpot(r, line.offsetHeight || 28, eyeViewW(), window.innerHeight);
    line.style.width = s.width + 'px';
    line.style.left = Math.round(s.x - o.x) + 'px';
    line.style.top = Math.round(s.y - o.y) + 'px';
}

/* ------------------------------------------------------ faction + war */

/** A row's state and when it is out, from what Torn's row shows ("Hospital 01:17:00"). */
function eyeRowMember(r, nowS) {
    const secs = eyeStatusSeconds(r.status);
    return { id: r.id, level: r.level, status: { state: r.status, until: secs ? nowS + secs : 0 } };
}

/**
 * Tags and edges for one list, on our layer. `rows` in the order to judge them (war: our order); the first ready
 * row with a band glows when `glow`.
 */
function eyeDrawList(name, rows, byId, nowS, { glow, note }) {
    const part = eyeLayerPart(name);
    const spot = eyeListSpot();
    const items = [];
    let glowed = !glow;
    let fromFfs = false;
    for (const s of rows) {
        const r = byId.get(s.id);
        if (!r || s.state === 'fallen') continue;
        const v = view(s.id);
        if (!eyeShown(v)) continue;
        if (v.est && v.est.source === 'ffscouter') fromFfs = true;
        const ready = s.state === 'okay' || s.state === 'early';
        const on = ready && !glowed;
        if (on) glowed = true;
        const edge = eyeEdgeBar(v.band, !ready);
        // A war row (round 8, his pick B): the band, HP kept, then where they are; a faction row keeps the three numbers.
        const tag = spot.mode === 'none' ? null : eyeRowTag(v, { mode: spot.mode, state: s.state, outInS: s.until > nowS ? s.until - nowS : null, outAt: s.until > nowS ? s.until : null, glow: on, where: name === 'war' });
        items.push({ row: r.el, edge, tag });
    }
    const summary = spot.mode === 'none' ? null : eyeSummaryTag(eyeSummary(rows, nowS), { note, fromFfs, short: spot.mode !== 'full', war: name === 'war' });
    const kids = [summary, ...items.map((i) => i.edge), ...items.map((i) => i.tag)].filter(Boolean);
    fill(part, kids);
    ep.lists[name] = { items, summary, spotMode: spot.mode, first: rows.length ? byId.get(rows[0].id) : null, rowsEl: [...byId.values()].map((r) => r.el) };
    eyePlaceList(name);
    return glowed && glow;
}

/** Put a list's edges and tags level with their rows, and its summary above the first row. */
function eyePlaceList(name) {
    const L = ep.lists[name];
    if (!L) return;
    const spot = eyeListSpot();
    eyeMarkColumn(spot);
    const o = eyeOrigin();
    let topRow = Infinity;
    for (const el of L.rowsEl) {
        const r = el.getBoundingClientRect();
        if (r.height > 0) topRow = Math.min(topRow, r.top);
    }
    for (const it of L.items) {
        const r = it.row.getBoundingClientRect();
        const shown = r.height > 0 && r.width > 0;
        it.edge.style.display = shown ? '' : 'none';
        if (it.tag) it.tag.style.display = shown ? '' : 'none';
        if (!shown) continue;
        it.edge.style.left = Math.round(r.left - o.x) + 'px';
        it.edge.style.top = Math.round(r.top - o.y + 2) + 'px';
        it.edge.style.height = Math.max(4, Math.round(r.height - 4)) + 'px';
        if (it.tag) {
            it.tag.style.maxWidth = spot.width + 'px';
            it.tag.style.left = Math.round(spot.x - o.x) + 'px';
            it.tag.style.top = Math.round(r.top - o.y + (r.height - (it.tag.offsetHeight || 26)) / 2) + 'px';
        }
    }
    if (L.summary) {
        L.summary.style.display = Number.isFinite(topRow) ? '' : 'none';
        L.summary.style.maxWidth = spot.width + 'px';
        L.summary.style.left = Math.round(spot.x - o.x) + 'px';
        if (Number.isFinite(topRow)) L.summary.style.top = Math.round(topRow - o.y - (L.summary.offsetHeight || 28) - 8) + 'px';
    }
}

/**
 * The war list as it is now, and who is out early: kept from reading to reading (eyeNextEarly) until the hospital end
 * they left before passes or their state changes. Called every second and on each draw; the same reading twice
 * changes nothing.
 */
function eyeWarReading(rows, nowS) {
    const members = rows.map((r) => eyeRowMember(r, nowS));
    ep.war.early = eyeNextEarly(ep.war.early, ep.war.prev, members, nowS, memberState);
    ep.war.prev = members;
    return { members, early: ep.war.early };
}

function drawWar() {
    const rows = readWarRows(document, 'enemy');
    if (!rows.length) {
        eyeClearPart('war');
        delete ep.lists.war;
        return false;
    }
    // What the row itself shows goes into the fight (round 7: a war row's level was never passed on, so a player
    // with an estimate but no profile read was fought with a level 1's life and came out Stomp).
    for (const r of rows) ep.extras.set(r.id, { ...(ep.extras.get(r.id) || {}), level: r.level, name: r.name });
    const nowS = Math.floor(Date.now() / 1000);
    const { members, early } = eyeWarReading(rows, nowS);
    ep.drawn.war = members;
    const bands = {};
    const respect = {};
    for (const m of members) {
        const v = view(Number(m.id));
        if (v) {
            bands[m.id] = v.band;
            respect[m.id] = v.respect || 0;
        }
    }
    // Our order (ready first) picks the row that glows and fills the summary; Torn's list keeps its own order and look
    // (round 7, the owner: we never change Torn's layout).
    const sorted = sortWar(members, { bands, respect, early: new Set(early.keys()), nowS });
    ep.drawing = true;
    try {
        const byId = new Map(rows.map((r) => [r.id, r]));
        // Torn's pages read nothing for the war (owner, round 6): what this page shows; the live read is on the Torn Eye tab.
        return eyeDrawList('war', sorted, byId, nowS, { glow: true, note: 'Torn Eye · from this page · live war mode on Pumping Iron’s Torn Eye tab' });
    } finally {
        ep.drawing = false;
    }
}

function drawFaction(glow) {
    const rows = readFactionRows();
    if (!rows.length) {
        eyeClearPart('faction');
        delete ep.lists.faction;
        return;
    }
    for (const r of rows) ep.extras.set(r.id, { ...(ep.extras.get(r.id) || {}), level: r.level, name: r.name });
    const nowS = Math.floor(Date.now() / 1000);
    const members = rows.map((r) => eyeRowMember(r, nowS));
    ep.drawn.faction = members;
    const list = members.map((m) => ({ id: m.id, state: memberState(m), until: m.status.until }));
    eyeDrawList('faction', list, new Map(rows.map((r) => [r.id, r])), nowS, { glow, note: 'Torn Eye · from what is already known (nothing is asked on this page)' });
}

/* ------------------------------------------------------ the chain counter */

/** Where the counter sits when no panel carries it: this far from the window's top (the panel's own default). */
const EYE_CHAIN_TOP = 80;

/** Is Torn's ranked-war list on this page (one look, no rows read)? */
function eyeOnWarPage() {
    return detectPage(location.href) === PAGE_FACTION && Boolean(document.querySelector('#faction_war_list_id ul.members-list > li.enemy'));
}

/**
 * The chains the counter shows now, yours first; null when it has no place here. It shows on Torn's war page, and on
 * every Torn page while chain mode is on (the owner, session 9: "in chain mode we are stacking, wire in the chain
 * counters"). Yours: Torn's own sidebar bar (it moves with every hit), else the bars as last read. Theirs: what the
 * Torn Eye tab's read of their chain left in shared storage (Torn's pages ask nothing for a war); none: "Not read yet".
 */
function eyeChainSides(now = Date.now()) {
    const m = pi.model;
    const warPage = eyeOnWarPage();
    if (!warPage && !(m && m.ready && m.stacking)) return null;
    const bar = readChainBar();
    const read = m && m.ready && m.state ? m.state.chain : null;
    const mine = bar ? chainFromBar(bar.value, bar.time, now) : read && now - read.at < CHAIN_FRESH_MS ? read : null;
    const sides = [{ who: 'Your faction', short: 'You', side: chainSide(mine, now) }];
    const rec = sharedChain(get(EYE_CHAIN_KEY, null), now);
    const fid = warPage ? enemyFactionId() : null;
    const theirs = rec && (!fid || Number(rec.fid) === fid) ? rec : null;
    if (warPage || theirs) sides.push({ who: (theirs && theirs.name) || 'Enemy faction', short: 'Them', side: chainSide(theirs, now), hint: 'open War on the Torn Eye tab' });
    return sides;
}

/** Where the counter goes ({x, y, width} on screen), or null: on the panel when it carries it, else a margin of its own. */
function eyeChainSpot() {
    const p = detectPage(location.href);
    const own = eyeCardSpot(eyeViewW(), eyeTornPage());
    // The attack page: over the fight card (drawAttack places it); a profile: the card there has that margin.
    if (p === PAGE_ATTACK) return own.mode === 'none' ? null : { x: own.x, y: 0, width: own.width, lines: true };
    if (ep.chain.spot) return ep.chain.spot;
    if (p === PAGE_PROFILE || own.mode === 'none') return null;
    return { x: own.x, y: EYE_CHAIN_TOP, width: own.width };
}

/**
 * Draw the counter (once a second while it shows): rebuilt only when what it says changed, else its clocks move on.
 * @returns {boolean} whether it came or went (the attack page's fight card then moves)
 */
function drawChain(now = Date.now()) {
    const old = document.getElementById('pi-chaincard');
    const sides = isPaused() || !getSettings().eyeChips ? null : eyeChainSides(now);
    const spot = sides ? eyeChainSpot() : null;
    if (!sides || !spot) {
        if (old) old.remove();
        ep.chain.sig = '';
        return Boolean(old);
    }
    const lines = Boolean(spot.lines) || spot.width < EYE_CHAIN_LINES_W;
    const sig = JSON.stringify([lines, sides.map((x) => [x.who, x.side.state, x.side.count, x.side.next])]);
    let el = old;
    if (!el || ep.chain.sig !== sig) {
        ep.chain.sig = sig;
        el = eyeChainCard(sides, { lines });
        // The new one stays where the old one was (the attack page places it with the fight card).
        if (old) {
            el.style.cssText = old.style.cssText;
            old.replaceWith(el);
        } else (document.body || document.documentElement).appendChild(el);
    } else {
        // The same words: only when each chain ends moved (a hit sets the timer back to 5:00).
        const ends = el.querySelectorAll('[data-pi-chain-until]');
        const timed = sides.filter((x) => x.side.state === 'on' || x.side.state === 'cooldown');
        if (ends.length === timed.length) timed.forEach((x, i) => ends[i].setAttribute('data-pi-chain-until', String(x.side.until)));
    }
    eyeChainTick(el, now);
    if (detectPage(location.href) !== PAGE_ATTACK) {
        el.style.left = Math.round(spot.x) + 'px';
        el.style.top = Math.round(spot.y) + 'px';
        el.style.width = Math.round(spot.width) + 'px';
    }
    return !old;
}

/**
 * The training panel says where it would sit ({x, y, width} on screen; null when it is folded under a card, off or
 * in the window's corner): the counter takes that place and the panel starts under it (the owner's pick B: "its own
 * card at the top of the free space; the training panel sits under it").
 * @returns {number} the height the panel leaves for it (0: no counter there)
 */
export function eyeRideChain(spot) {
    const was = ep.chain.spot;
    ep.chain.spot = spot && spot.width > 0 ? { x: spot.x, y: spot.y, width: spot.width } : null;
    if (!document.getElementById('pi-chaincard') && !ep.chain.spot) return 0;
    if (JSON.stringify(was) !== JSON.stringify(ep.chain.spot)) drawChain();
    const el = document.getElementById('pi-chaincard');
    return el && ep.chain.spot && detectPage(location.href) !== PAGE_ATTACK ? el.offsetHeight : 0;
}

/* ------------------------------------------------------------- attack */

/** The room left under the fight card for the training panel's line docked there (its 36 px and the gap). */
const EYE_DOCK_ROOM = 44;

/**
 * The Next button's target from where you are (round 8, his pick A): the next ready player of the list the Torn Eye
 * tab last showed (Targets in its order and filters, or the war list), handed over in shared storage; the attack pages
 * you opened in the last ten minutes are passed over. No request: Torn's pages ask about the player attacked only.
 */
function eyeNextNow(id, now = Date.now()) {
    const opened = new Set((get(K.eyePredictions, []) || []).filter((p) => p && now - p.at < ATTACK_OPENED_MS && Number(p.def) !== Number(id)).map((p) => Number(p.def)));
    const n = nextTarget(get(EYE_NEXT_KEY, null), id, { now, opened });
    return { ...n, href: n.next ? attackUrl(n.next.id) : null, listHref: APP_PAGE_URL + '#eye', over: Boolean(ep.attack.over) };
}

/** Key N on the attack page: the Next button's page (never while typing, never with a modifier key). */
function eyeNextKey(e) {
    if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || e.repeat || !(e.key === 'n' || e.key === 'N')) return;
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(String(t.tagName || '')))) return;
    if (isPaused() || !getSettings().eyeChips || detectPage(location.href) !== PAGE_ATTACK) return;
    const a = document.querySelector('#pi-eyecard a.pi-nextb:not(.pi-alt)');
    if (!a || !a.getAttribute('href')) return;
    e.preventDefault();
    location.assign(a.getAttribute('href'));
}

function drawAttack() {
    const id = Number(attackTargetOf(location.href));
    if (!id) return;
    const spot = eyeCardSpot(eyeViewW(), eyeTornPage());
    const old = document.getElementById('pi-eyecard');
    const v = view(id);
    if (spot.mode === 'none') {
        if (old) old.remove();
        ep.sig.attack = '';
    } else {
        const ws = watchState(id);
        const next = eyeFightCard(v, spot.mode, { ...ep.attack, next: eyeNextNow(id), watch: { ...ws, full: getWatch().list.length >= WATCH_MAX && !ws.watching, toggle: () => toggleFor(id) } });
        let card = old;
        if (!card || ep.sig.attack !== next.outerHTML) {
            ep.sig.attack = next.outerHTML;
            if (old) old.replaceWith(next);
            else (document.body || document.documentElement).appendChild(next);
            card = next;
        }
        // Beside the fight, level with its top; the training panel docks under it.
        const root = attackRoot();
        const r = root ? root.getBoundingClientRect() : null;
        card.style.width = spot.width + 'px';
        card.style.left = Math.round(spot.x) + 'px';
        let top = Math.round(r && r.height ? Math.max(8, r.top) : 80);
        // Chain mode: the counter's two lines sit over the card, the card starts under them.
        const chain = document.getElementById('pi-chaincard');
        if (chain) {
            chain.style.left = Math.round(spot.x) + 'px';
            chain.style.top = top + 'px';
            chain.style.width = spot.width + 'px';
            top += Math.round(chain.offsetHeight) + 8;
        }
        card.style.top = top + 'px';
        // Never taller than the window, less the training panel's one line under it (round 8: with their gear listed
        // the card filled the window and pushed that line off it); it scrolls inside instead.
        card.style.maxHeight = Math.max(80, window.innerHeight - top - 8 - EYE_DOCK_ROOM) + 'px';
    }
    // What Torn Eye said before this fight: the fight learner compares it with how the fight went.
    if (v && v.forecast && Number.isFinite(v.forecast.pWin)) {
        const list = get(K.eyePredictions, []) || [];
        const next = addPrediction(list, { def: id, at: Date.now(), pWin: v.forecast.pWin, keep: v.forecast.keep });
        if (next !== list) set(K.eyePredictions, next);
    }
}

function onAttackData(json) {
    if (isPaused()) return;
    const d = parseAttackData(json);
    if (!d || !d.defenderId) return;
    ep.extras.set(d.defenderId, { ...(ep.extras.get(d.defenderId) || {}), level: d.level, life: d.maxLife, name: d.defenderName });
    ep.attack.gearVisible = d.visible;
    // The fight is over: the Next button is the one thing that glows now.
    ep.attack.over = Boolean(d.over);
    if (d.visible && d.items.length) {
        ep.attack.gearSaved = true;
        saveGear(d.defenderId, d.items);
    }
    if (getSettings().eyeChips) drawAttack();
}

/* ------------------------------------------------------------- wiring */

function eyeClearAll() {
    for (const el of document.querySelectorAll('#pi-eye-layer, #pi-eyecard, #pi-chaincard')) el.remove();
    ep.chain.sig = '';
    ep.sig = {};
    ep.lists = {};
    ep.drawn = { war: null, faction: null };
}

function drawAll() {
    // Taking turns with Torn Trading, or Torn Eye switched off in Settings: nothing of ours on Torn's page.
    if (isPaused() || !getSettings().eyeChips) {
        eyeClearAll();
        return;
    }
    if (!isVisible()) return;
    const p = detectPage(location.href);
    // Faction and war lists (and the mini-profile) show what is already stored: read it once, from this site's own
    // IndexedDB, when one of them first shows. No request; the draw runs again when it is in.
    if (!eyeReady() && (p === PAGE_FACTION || miniProfileId())) loadEyeCache().catch(() => {});
    // The chain counter first: the list tags keep out of its margin, the attack page's card starts under it.
    drawChain();
    if (p === PAGE_PROFILE) drawProfile();
    if (p === PAGE_FACTION) {
        const glowed = document.getElementById('faction_war_list_id') ? drawWar() : false;
        drawFaction(!glowed);
    }
    if (p === PAGE_ATTACK) drawAttack();
    drawMini();
    if (!Object.keys(ep.lists).length) eyeMarkColumn(null);
    ep.layoutSig = eyeLayoutSig();
}

/** Only the positions, after a resize or when Torn's page moved (no rebuild). */
function eyePlaceAll() {
    if (isPaused() || !getSettings().eyeChips || !isVisible()) return;
    const p = detectPage(location.href);
    if (p === PAGE_PROFILE || p === PAGE_ATTACK) {
        drawAll();
        return;
    }
    // A list whose tags need another size is drawn again; otherwise they only move.
    const mode = eyeListSpot().mode;
    if (Object.values(ep.lists).some((L) => L.spotMode !== mode)) {
        drawAll();
        return;
    }
    for (const name of Object.keys(ep.lists)) eyePlaceList(name);
    placeMini();
    ep.layoutSig = eyeLayoutSig();
}

/** Where things are now: the window, Torn's page and the first row or title we sit level with. */
function eyeLayoutSig() {
    const pg = eyeTornPage();
    const p = detectPage(location.href);
    let y = '';
    if (p === PAGE_PROFILE) {
        const a = profileAnchor();
        y = a ? Math.round(a.getBoundingClientRect().top + window.scrollY) : '';
    } else if (p === PAGE_ATTACK) {
        const a = attackRoot();
        y = a ? Math.round(a.getBoundingClientRect().top) : '';
    } else {
        y = Object.values(ep.lists).map((L) => (L.first ? Math.round(L.first.el.getBoundingClientRect().top + window.scrollY) + ':' + L.rowsEl.length : '')).join(',');
    }
    // The panel's side too: the list tags leave its margin (eyeListSpot).
    const pr = p === PAGE_FACTION ? eyePanelRect() : null;
    return [eyeViewW(), Math.round(pg.left), Math.round(pg.right), y, pr ? Math.round(pr.left) + ':' + Math.round(pr.right) : ''].join('|');
}

export function bootEyePage() {
    ensureMarkCss();
    ensureEyeCss();
    // The hover card: in the free space, and on faction and war pages clear of the panel like the tags beside it.
    bindCard(document, (id) => view(id), () => eyeCardSpot(eyeViewW(), eyeTornPage(), detectPage(location.href) === PAGE_FACTION ? eyePanelRect() || eyeChainRect() : null));
    const p = detectPage(location.href);
    if (p === PAGE_ATTACK) {
        // unsafeWindow is the page's own window in Tampermonkey; the harness has only window.
        const pageWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        installAttackHook(pageWin, onAttackData);
        document.addEventListener('keydown', eyeNextKey);
        // The Torn Eye tab handed over a new list (a status read, another order): the Next button follows.
        gmOnChange(EYE_NEXT_KEY, () => {
            if (!isPaused() && getSettings().eyeChips && isVisible() && detectPage(location.href) === PAGE_ATTACK) drawAttack();
        });
    }
    // Owner (round 6): on Torn's pages Torn Eye asks only about the player you're viewing (their profile) or
    // attacking. Faction and war lists, mini-profiles and the watch list show what is already known; the list sweeps,
    // war mode's reads and the watch list run on the webpage's Torn Eye tab, only while it is open.
    const ask = () => {
        if (!getSettings().eyeChips || !isVisible() || isPaused()) return;
        const pg = detectPage(location.href);
        if (pg === PAGE_PROFILE) wantPlayers([Number(profileIdOf(location.href))], { profiles: true });
        if (pg === PAGE_ATTACK) wantPlayers([Number(attackTargetOf(location.href))], { profiles: true });
    };
    onEye(() => drawAll());
    let lastSig = '';
    onModel((m) => {
        if (!m || !m.ready) return;
        const sig = [location.href, m.state.at, readFactionRows().length, readWarRows().length, miniProfileId(), getSettings().eyeChips ? 1 : 0].join('|');
        if (sig !== lastSig) {
            lastSig = sig;
            ask();
            drawAll();
        }
    });
    onPauseChange(() => {
        lastSig = '';
        drawAll();
    });
    // A resized window re-places everything (once per frame); a scroll moves only the mini-profile's tag (Torn's popup
    // may be fixed on screen while ours is in page coordinates).
    let miniQueued = false;
    document.addEventListener(
        'scroll',
        () => {
            if (miniQueued || !document.querySelector('#pi-eye-layer [data-pi-part="mini"] .pi-mini-line')) return;
            miniQueued = true;
            const run = () => {
                miniQueued = false;
                placeMini();
            };
            if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
            else setTimeout(run, 16);
        },
        { capture: true, passive: true },
    );
    let resizeQueued = false;
    window.addEventListener('resize', () => {
        if (resizeQueued) return;
        resizeQueued = true;
        const run = () => {
            resizeQueued = false;
            eyePlaceAll();
        };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
        else setTimeout(run, 16);
    });
    // Faction and war lists render after the page: a cheap look each second (row ids only) draws their tags then.
    // On the pages we draw beside, the same look notices Torn's page moving (it settles after load) and re-places.
    let rowsSig = '';
    setInterval(() => {
        if (!isVisible() || isPaused() || !getSettings().eyeChips) return;
        const pg = detectPage(location.href);
        // The chain counter (any Torn page in chain mode, the war page always): its clocks, and Torn's bar read again.
        if (drawChain() && pg === PAGE_ATTACK) drawAttack();
        if (pg !== PAGE_FACTION && pg !== PAGE_PROFILE && pg !== PAGE_ATTACK) return;
        if (pg === PAGE_FACTION) {
            // Round 7 review: the status text carries Torn's hospital clock, so a signature of it changed every second
            // and every tag was rebuilt (focus lost, "out early" forgotten). Now: each row's state, who is out early,
            // and a hospital end that really moved; the "out in" clocks move on by themselves (eyeTickOut).
            const nowS = Math.floor(Date.now() / 1000);
            const faction = readFactionRows().map((r) => eyeRowMember(r, nowS));
            const warRows = readWarRows(document, 'enemy');
            const war = warRows.length ? eyeWarReading(warRows, nowS) : { members: [], early: new Map() };
            const sig = eyeRowsSig(faction, memberState) + '|' + eyeRowsSig(war.members, memberState, war.early);
            if (sig !== rowsSig || eyeUntilMoved(ep.drawn.faction, faction) || eyeUntilMoved(ep.drawn.war, war.members)) {
                rowsSig = sig;
                drawAll();
                return;
            }
            eyeTickOut(document.getElementById('pi-eye-layer'), nowS);
        }
        if (eyeLayoutSig() !== ep.layoutSig) eyePlaceAll();
    }, 1000);
    // The mini-profile popup is added to the body on the first hover, then re-drawn for each player.
    let watchedRoot = null;
    const onMini = () => {
        if (ep.drawing || isPaused() || !getSettings().eyeChips) return;
        const root = document.getElementById('profile-mini-root');
        if (root && root !== watchedRoot) {
            watchedRoot = root;
            // Its content and where Torn puts it (the popup moves and hides by its style or class).
            new MutationObserver(onMini).observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
        }
        const id = miniProfileId();
        const shown = document.querySelector('#pi-eye-layer [data-pi-part="mini"] .pi-mini-line');
        // The popup closed or moved: our tag follows it (or hides), nothing redrawn.
        if (shown && (!id || shown.getAttribute('data-pi-player') === String(id))) {
            if (!id) fill(eyeLayerPart('mini'), []);
            else placeMini();
            return;
        }
        if (id && (!shown || shown.getAttribute('data-pi-player') !== String(id)) && !(ep.miniAt && ep.miniId === id && Date.now() - ep.miniAt < 500)) {
            ep.miniId = id;
            ep.miniAt = Date.now();
            ep.drawing = true;
            try {
                drawMini();
            } finally {
                ep.drawing = false;
            }
        }
    };
    new MutationObserver(onMini).observe(document.body, { childList: true });
    onMini();
}
