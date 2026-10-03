/*
 * Torn Eye on torn.com (round 7, the owner's pick in mockups/round7/overlays.html):
 *   - a profile: a card in the free space beside Torn's page, level with the
 *     profile's title (full, narrower or smallest by the room there; the
 *     left-hand space when the right one is too narrow); never a line on
 *     Torn's page;
 *   - the mini-profile popup: one tag as its last line;
 *   - faction and ranked-war lists: Torn's rows untouched; a band edge on our
 *     own layer and a tag per row in the free space, level with the row, and
 *     a summary tag on top (war rows are still shown in our order with CSS);
 *   - the attack page: the fight card (#pi-eyecard) beside the fight, and the
 *     read-only attackData reader that saves their gear.
 * Re-placed when the window is resized or Torn's page moves.
 */

import { K, get, set, getSettings } from './platform/store.js';
import { addPrediction } from './core/learndata.js';
import { onModel, isVisible } from './runtime.js';
import { isPaused, onPauseChange } from './turns.js';
import { installAttackHook } from './platform/page-hook.js';
import { wantPlayers, eyeView, sharedView, eyeReady, loadEyeCache, onEye, saveGear, getWatch, toggleWatch, setWatchTag } from './eye-service.js';
import { WATCH_MAX } from './core/eye/watch.js';
import { parseAttackData } from './core/eye/gear.js';
import { sortWar, memberState } from './core/eye/war.js';
import { profileLevel, profileAnchor, readFactionRows, readWarRows, miniProfileId, attackRoot } from './sources/dom/eye.js';
import { ensureEyeCss, bindCard, eyeCardSpot, eyeRowSpot, eyeProfileCard, eyeFightCard, eyeMiniLine, eyeRowTag, eyeEdgeBar, eyeSummary, eyeSummaryTag, eyeStatusSeconds, eyeShown, eyeLayer, eyeLayerPart, eyeClearPart, eyeTickOut, eyeNextEarly, eyeRowsSig, eyeUntilMoved } from './ui/eye/eye-ui.js';
import { ensureMarkCss } from './ui/marks/marks.js';
import { fill } from './ui/dom.js';
import { detectPage, profileIdOf, attackTargetOf, PAGE_PROFILE, PAGE_FACTION, PAGE_ATTACK } from './sources/route.js';

const ep = { extras: new Map(), war: { prev: null, early: new Map() }, drawn: { war: null, faction: null }, attack: { gearVisible: false, gearSaved: false }, drawing: false, sig: {}, lists: {}, layoutSig: '' };

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

/** Where list tags go now (eyeRowSpot, clear of the panel). */
function eyeListSpot() {
    return eyeRowSpot(eyeViewW(), eyeTornPage(), eyePanelRect());
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

function drawMini() {
    const id = miniProfileId();
    const root = document.getElementById('profile-mini-root');
    if (!id || !root) return;
    for (const el of root.querySelectorAll('.pi-mini-line')) el.remove();
    // The popup's last line, inside its width.
    const at = root.querySelector('.mini-profile-wrapper') || root.querySelector('.profile-container') || root;
    // At most one thing glows on a page: the mini-profile only when nothing else does.
    at.appendChild(eyeMiniLine(view(id), { id, glow: !document.querySelector('.pi-eye.pi-glow') }));
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
        const tag = spot.mode === 'none' ? null : eyeRowTag(v, { mode: spot.mode, state: s.state, outInS: s.until > nowS ? s.until - nowS : null, outAt: s.until > nowS ? s.until : null, glow: on });
        items.push({ row: r.el, edge, tag });
    }
    const summary = spot.mode === 'none' ? null : eyeSummaryTag(eyeSummary(rows, nowS), { note, fromFfs, short: spot.mode !== 'full' });
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
    const list = rows[0].el.parentNode;
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
    const sorted = sortWar(members, { bands, respect, early: new Set(early.keys()), nowS });
    ep.drawing = true;
    try {
        const byId = new Map(rows.map((r) => [r.id, r]));
        // Shown in our order with CSS (flex order); Torn's rows stay where React put them, unchanged.
        list.classList.add('pi-warlist');
        sorted.forEach((s, i) => {
            const r = byId.get(s.id);
            if (r && r.el.style.order !== String(i)) r.el.style.order = String(i);
        });
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

/* ------------------------------------------------------------- attack */

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
        const next = eyeFightCard(v, spot.mode, { ...ep.attack, watch: { ...ws, full: getWatch().list.length >= WATCH_MAX && !ws.watching, toggle: () => toggleFor(id) } });
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
        const top = Math.round(r && r.height ? Math.max(8, r.top) : 80);
        card.style.top = top + 'px';
        // Never taller than the window (it scrolls inside instead).
        card.style.maxHeight = Math.max(80, window.innerHeight - top - 8) + 'px';
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
    if (d.visible && d.items.length) {
        ep.attack.gearSaved = true;
        saveGear(d.defenderId, d.items);
    }
    if (getSettings().eyeChips) drawAttack();
}

/* ------------------------------------------------------------- wiring */

function eyeClearAll() {
    for (const el of document.querySelectorAll('#pi-eye-layer, #pi-eyecard, .pi-mini-line')) el.remove();
    ep.sig = {};
    ep.lists = {};
    ep.drawn = { war: null, faction: null };
    // Torn's war rows back in their own order.
    for (const list of document.querySelectorAll('.pi-warlist')) {
        list.classList.remove('pi-warlist');
        for (const li of list.children) li.style.order = '';
    }
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
    bindCard(document, (id) => view(id), () => eyeCardSpot(eyeViewW(), eyeTornPage(), detectPage(location.href) === PAGE_FACTION ? eyePanelRect() : null));
    const p = detectPage(location.href);
    if (p === PAGE_ATTACK) {
        // unsafeWindow is the page's own window in Tampermonkey; the harness has only window.
        const pageWin = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
        installAttackHook(pageWin, onAttackData);
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
    // A resized window re-places everything (once per frame).
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
            new MutationObserver(onMini).observe(root, { childList: true, subtree: true });
        }
        const id = miniProfileId();
        const shown = document.querySelector('#profile-mini-root .pi-mini-line');
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
