/*
 * Torn Eye on torn.com: chips on profiles, the mini-profile popup and
 * faction lists; war mode on ranked-war lists (the enemy faction read every
 * 10 s while the tab is visible); the attack page's panel and the
 * read-only attackData reader that saves their gear.
 */

import { K, get, set, getSettings } from './platform/store.js';
import { addPrediction } from './core/learndata.js';
import { onModel, isVisible } from './runtime.js';
import { isPaused, onPauseChange } from './turns.js';
import { installAttackHook } from './platform/page-hook.js';
import { wantPlayers, eyeView, onEye, saveGear, flightsSeen, getWatch, toggleWatch, setWatchTag } from './eye-service.js';
import { WATCH_MAX } from './core/eye/watch.js';
import { parseAttackData } from './core/eye/gear.js';
import { sortWar, warSummary, outEarly, statusParts } from './core/eye/war.js';
import { profileLevel, profileAnchor, readFactionRows, readWarRows, miniProfileId } from './sources/dom/eye.js';
import { ensureEyeCss, chipEl, bindCard, warSummaryEl, attackPanel, attackPanelContent, watchControl } from './ui/eye/eye-ui.js';
import { tornClock } from './core/bars.js';
import { ensureMarkCss } from './ui/marks/marks.js';
import { fill } from './ui/dom.js';
import { detectPage, profileIdOf, attackTargetOf, PAGE_PROFILE, PAGE_FACTION, PAGE_ATTACK } from './sources/route.js';

const ep = { extras: new Map(), war: { factionId: null, members: null, prev: null, at: 0, polling: false }, attack: { gearVisible: false, gearSaved: false }, drawing: false };

function view(id) {
    return eyeView(id, ep.extras.get(id) || {}, { war: Boolean(ep.war.members) });
}

const EDGES = ['pi-edge-stomp', 'pi-edge-good', 'pi-edge-tough', 'pi-edge-cant'];

function removeChips(scope, { watch = true } = {}) {
    for (const el of scope.querySelectorAll('.pi-chip, .pi-warsum, .pi-earlytag, .pi-landtag' + (watch ? ', .pi-watch' : ''))) el.remove();
    for (const el of scope.querySelectorAll('.pi-early')) el.classList.remove('pi-early');
    for (const el of scope.querySelectorAll('.' + EDGES.join(', .'))) el.classList.remove(...EDGES);
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
    if (!id || !anchor) return;
    ep.extras.set(id, { ...(ep.extras.get(id) || {}), level: profileLevel() });
    // The watch button stays while you use it (a redraw would close its picker); it's replaced when it changed.
    const ws = watchState(id);
    const sig = [ws.watching ? 1 : 0, ws.tag || '', ws.full ? 1 : 0].join('|');
    const old = anchor.parentNode.querySelector('.pi-watch');
    const keepWatch = old && old.getAttribute('data-pi-watch') === sig && old.getAttribute('data-pi-player') === String(id);
    removeChips(anchor.parentNode, { watch: !keepWatch });
    const chip = chipEl(view(id), { id });
    anchor.parentNode.insertBefore(chip, anchor.nextSibling);
    if (keepWatch) chip.after(old);
    else {
        const wc = watchControl(ws, watchHandlers(id));
        wc.setAttribute('data-pi-player', String(id));
        chip.after(wc);
    }
}

function drawMini() {
    const id = miniProfileId();
    const root = document.getElementById('profile-mini-root');
    if (!id || !root) return;
    const at = root.querySelector('.profile-container .description .last-action') || root.querySelector('.description') || root;
    removeChips(root);
    at.appendChild(chipEl(view(id), { mini: true, id }));
}

/* ------------------------------------------------------ faction + war */

function drawFaction() {
    const rows = readFactionRows();
    for (const r of rows) ep.extras.set(r.id, { level: r.level, name: r.name });
    for (const r of rows) {
        for (const c of r.cell.querySelectorAll('.pi-chip')) c.remove();
        r.cell.appendChild(chipEl(view(r.id), { mini: true, id: r.id }));
    }
}

function drawWar() {
    const rows = readWarRows(document, 'enemy');
    if (!rows.length) return;
    const list = rows[0].el.parentNode;
    const nowS = Math.floor(Date.now() / 1000);
    const members = ep.war.members || rows.map((r) => ({ id: r.id, level: r.level, status: { state: r.status } }));
    const bands = {};
    const respect = {};
    for (const m of members) {
        const v = view(Number(m.id));
        if (v) {
            bands[m.id] = v.band;
            respect[m.id] = v.respect || 0;
        }
    }
    const early = ep.war.prev ? outEarly(ep.war.prev, members, nowS) : new Set();
    const sorted = sortWar(members, { bands, respect, early, nowS });
    ep.drawing = true;
    try {
        removeChips(list.parentNode);
        const byId = new Map(rows.map((r) => [r.id, r]));
        // Shown in our order with CSS (flex order); Torn's rows stay where React put them.
        list.classList.add('pi-warlist');
        sorted.forEach((s, i) => {
            const r = byId.get(s.id);
            if (r) r.el.style.order = String(i);
        });
        const flights = flightsSeen();
        const nowMs = Date.now();
        for (const s of sorted) {
            const r = byId.get(s.id);
            if (!r) continue;
            r.cell.appendChild(chipEl(view(s.id), { mini: true, id: s.id }));
            // The row's edge in its band colour; a traveller's estimated landing next to Torn's status.
            if (EDGES.includes('pi-edge-' + s.band)) r.el.classList.add('pi-edge-' + s.band);
            if (s.state === 'traveling' && ep.war.members) {
                const parts = statusParts(s.m, { now: nowMs, seenAt: flights[s.id] ? flights[s.id].at : null });
                const st = r.el.querySelector('.status');
                if (st && parts.at) st.appendChild(Object.assign(document.createElement('span'), { className: 'pi-mark pi-landtag', textContent: 'lands ~' + tornClock(parts.at) }));
            }
            if (s.state === 'early') {
                r.el.classList.add('pi-early');
                const st = r.el.querySelector('.status');
                if (st) st.appendChild(Object.assign(document.createElement('span'), { className: 'pi-mark pi-earlytag', textContent: 'out early' }));
            }
        }
        const fromFfs = sorted.some((s) => {
            const v = view(s.id);
            return v && v.est && v.est.source === 'ffscouter';
        });
        list.parentNode.insertBefore(warSummaryEl(warSummary(sorted, nowS), ep.war.at ? Math.round((Date.now() - ep.war.at) / 1000) : null, fromFfs), list);
    } finally {
        ep.drawing = false;
    }
}

/* ------------------------------------------------------------- attack */

function drawAttack() {
    const id = Number(attackTargetOf(location.href));
    if (!id) return;
    const panel = attackPanel();
    const root = document.getElementById('attack-root');
    const r = root ? root.getBoundingClientRect() : null;
    const x = r && r.right + 262 < window.innerWidth ? r.right + 12 : window.innerWidth - 262;
    panel.style.left = Math.max(8, x) + 'px';
    panel.style.top = (r ? Math.max(8, r.top) : 110) + 'px';
    const v = view(id);
    const ws = watchState(id);
    fill(panel, attackPanelContent(v, { ...ep.attack, watch: { ...ws, full: getWatch().list.length >= WATCH_MAX && !ws.watching, toggle: () => toggleFor(id) } }));
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

function drawAll() {
    // Taking turns with Torn Trading, or Torn Eye chips switched off in Settings: nothing of ours on Torn's page.
    if (isPaused() || !getSettings().eyeChips) {
        removeChips(document);
        for (const el of document.querySelectorAll('#pi-attack')) el.remove();
        // Torn's war rows back in their own order.
        for (const list of document.querySelectorAll('.pi-warlist')) {
            list.classList.remove('pi-warlist');
            for (const li of list.children) li.style.order = '';
        }
        return;
    }
    if (!isVisible()) return;
    const p = detectPage(location.href);
    if (p === PAGE_PROFILE) drawProfile();
    if (p === PAGE_FACTION) {
        if (document.getElementById('faction_war_list_id')) drawWar();
        drawFaction();
    }
    if (p === PAGE_ATTACK) drawAttack();
    drawMini();
}

export function bootEyePage() {
    ensureMarkCss();
    ensureEyeCss();
    bindCard(document, (id) => view(id));
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
        const shown = document.querySelector('#profile-mini-root .pi-chip');
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
