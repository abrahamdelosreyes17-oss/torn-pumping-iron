/*
 * Marks on Torn's own pages (DESIGN §5; round 7's one look, overlays.html), as an OVERLAY (the owner, 2026-10-03):
 * nothing of ours goes into Torn's page. No element is inserted into Torn's DOM and no class, style or attribute is
 * put on Torn's elements, so Torn's widths, heights and rows stay exactly as they are without the script. Everything
 * is drawn on our own layer (#pi-marks-layer, appended to <body>, position absolute in page coordinates), placed from
 * the rects of Torn's elements and placed again on resize, scroll and Torn's changes (once a frame at most).
 *
 * What is drawn: a thin ring over a box (+3 px) and a small pill straddling its top border. Green to train (the one
 * thing that glows), a red pulse to eat first, dashed grey to wait (the wrong gym, no energy yet), amber to warn,
 * chalk "take this" on markets. The gym you're in: a steady ring (green right, red wrong); the gym to go to pulses
 * green. The words the old strip said, and Fill N, are in the panel (overlay.js). Nothing takes the pointer.
 */

import { h, fill } from '../dom.js';

export const MARK_CSS = `
#pi-marks-layer { position: absolute; left: 0; top: 0; width: 0; height: 0; overflow: visible; z-index: 9989; pointer-events: none; }
#pi-marks-layer > * { position: absolute; pointer-events: none; box-sizing: border-box; margin: 0; }
.pi-mark, .pi-mark * { box-sizing: border-box; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
.pi-c-green { --b: #3fbf5a; } .pi-c-red { --b: #ff6b5e; } .pi-c-amber { --b: #e8a33d; } .pi-c-chalk { --b: #efebe2; } .pi-c-grey { --b: #6c737a; } .pi-c-plain { --b: #6c737a; }
.pi-ring { border: 2px solid var(--b, #efebe2); border-radius: 6px; background: transparent; }
.pi-ring.pi-dashed { border-style: dashed; }
.pi-ring.pi-glow { box-shadow: 0 0 0 3px color-mix(in srgb, var(--b) 14%, transparent), 0 0 16px color-mix(in srgb, var(--b) 24%, transparent); }
.pi-pulse::after { content: ''; position: absolute; inset: -2px; border-radius: 7px; box-shadow: 0 0 0 2px color-mix(in srgb, var(--b) 80%, transparent), 0 0 22px color-mix(in srgb, var(--b) 80%, transparent); opacity: 0; animation: pi-pulse 1.4s ease-in-out infinite; pointer-events: none; }
.pi-pulse.pi-still::after { animation: none; opacity: .7; }
@keyframes pi-pulse { 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .pi-pulse::after { animation: none; opacity: .7; } }
.pi-pill { display: flex; align-items: center; gap: 5px; width: max-content; height: 20px; padding: 0 8px 0 6px; border-radius: 5px; font: 700 11px/1 'Segoe UI', system-ui, -apple-system, sans-serif; letter-spacing: .4px; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; box-shadow: 0 1px 4px rgba(0,0,0,.45); }
.pi-pill > span { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.pi-pill::before { content: ''; width: 9px; height: 9px; border-radius: 50%; flex: none; box-shadow: inset 0 0 0 2px currentColor; }
.pi-pill.pi-solid { background: var(--b); color: #101214; border: 0; }
.pi-pill.pi-dark { background: #101214; color: #c5cad0; border: 1px solid #3a4046; text-transform: none; letter-spacing: 0; font-weight: 600; }
.pi-pill.pi-dark.pi-c-grey { border-color: #6c737a; color: #d6d9dc; }
.pi-pill.pi-dark.pi-c-chalk { border-color: #efebe2; color: #efebe2; }
`;

/** Our page CSS, once per page (torn.com: no outside fonts). */
export function ensureMarkCss(doc = document) {
    if (doc.getElementById('pi-mark-css')) return;
    const st = doc.createElement('style');
    st.id = 'pi-mark-css';
    st.textContent = MARK_CSS;
    (doc.head || doc.documentElement).appendChild(st);
}

/* ---------------------------------------------------------- placement math */

/** Space between a box and its ring. */
export const RING_PAD = 3;
/** A pill on a listing sits this far in from the row's left edge (the old label's spot). */
export const PILL_INSET = 10;
/** Kept from the window's edges (so nothing of ours makes the page scroll sideways). */
export const VIEW_EDGE = 2;

/**
 * The ring over a box: its rect grown by `pad`, in our layer's coordinates, kept inside the window's width.
 * @param {{left, top, width, height}} r - the box (viewport)
 * @param {{x, y}} o - our layer's (0, 0) on screen
 * @param {number} [pad]
 * @param {number} [viewW] - the window's width without its scrollbar
 * @returns {{left, top, width, height}}
 */
export function ringRect(r, o, pad = RING_PAD, viewW = Infinity) {
    const l = Math.max(0, r.left - pad);
    const rt = Math.min(viewW, r.left + r.width + pad);
    return { left: Math.round(l - o.x), top: Math.round(r.top - pad - o.y), width: Math.max(0, Math.round(rt - l)), height: Math.max(0, Math.round(r.height + 2 * pad)) };
}

/**
 * A pill straddling a box's top border (its middle on the ring's top edge): centred, or `inset` px in from the left.
 * Never wider than the box (less 4 px each side), never past the window's edges.
 * @param {{left, top, width, height}} r - the box (viewport)
 * @param {{x, y}} o - our layer's (0, 0) on screen
 * @param {number} w - the pill's natural width
 * @param {number} ht - its height
 * `edge` 'bottom': straddling the box's bottom border instead (a grey gym box's second line).
 * @returns {{left, top, maxWidth}}
 */
export function pillSpot(r, o, w, ht, { pad = RING_PAD, align = 'center', inset = PILL_INSET, viewW = Infinity, edge = 'top' } = {}) {
    const maxWidth = Math.max(24, Math.min(r.width - 8, viewW - 2 * VIEW_EDGE));
    const ww = Math.min(w, maxWidth);
    let x = align === 'left' ? r.left + Math.min(inset, Math.max(4, r.width - ww - 4)) : r.left + (r.width - ww) / 2;
    x = Math.min(Math.max(x, VIEW_EDGE), viewW - VIEW_EDGE - ww);
    const y = edge === 'bottom' ? r.top + r.height + pad - ht / 2 : r.top - pad - ht / 2;
    return { left: Math.round(x - o.x), top: Math.round(y - o.y), maxWidth: Math.round(maxWidth) };
}

/* ---------------------------------------------------------- our layer */

const ml = { items: [], queued: false };

/** Our layer for the marks (made on first use, on <body>). */
export function marksLayer(doc = document) {
    let el = doc.getElementById('pi-marks-layer');
    if (!el) {
        el = h('div', { id: 'pi-marks-layer', class: 'pi-mark', 'aria-hidden': 'true' });
        (doc.body || doc.documentElement).appendChild(el);
    }
    return el;
}

/** Remove every mark we drew (nothing of ours is ever inside Torn's page, so this is only our layer). */
export function clearMarks(doc = document) {
    ml.items = [];
    const layer = doc.getElementById('pi-marks-layer');
    if (layer) fill(layer, []);
}

/** Marks drawn now. */
export function marksCount() {
    return ml.items.length;
}

/** A box we marked is gone from Torn's page (React replaced it): the marks are drawn again. */
export function marksLost() {
    return ml.items.some((it) => !it.target.isConnected);
}

function addRing(target, cls, { pad = RING_PAD, title = null, data = {} } = {}) {
    const el = h('div', { class: 'pi-ring ' + cls, title, ...data });
    marksLayer().appendChild(el);
    ml.items.push({ el, target, kind: 'ring', pad });
    return el;
}

function addPill(target, cls, text, { title = null, align = 'center', pad = RING_PAD, data = {}, edge = 'top' } = {}) {
    const el = h('div', { class: 'pi-pill ' + cls, title: title || text, ...data }, [h('span', { text })]);
    marksLayer().appendChild(el);
    ml.items.push({ el, target, kind: 'pill', pad, align, edge });
    return el;
}

/** Place every mark over its box now (all rects read first, then our styles written: one layout). */
export function placeMarks(doc = document) {
    if (!ml.items.length) return;
    const layer = doc.getElementById('pi-marks-layer');
    if (!layer) return;
    const lr = layer.getBoundingClientRect();
    const o = { x: lr.left, y: lr.top };
    const viewW = (doc.documentElement && doc.documentElement.clientWidth) || window.innerWidth;
    // A pill hidden last time has no width to read: shown again first (rare: its box came back).
    for (const it of ml.items) if (it.kind === 'pill' && it.el.style.display === 'none' && it.target.isConnected) it.el.style.display = '';
    const reads = ml.items.map((it) => {
        const r = it.target.isConnected ? it.target.getBoundingClientRect() : null;
        return { r: r && r.width > 0 && r.height > 0 ? r : null, w: it.kind === 'pill' ? it.el.scrollWidth : 0, ht: it.kind === 'pill' ? it.el.offsetHeight || 20 : 0 };
    });
    ml.items.forEach((it, i) => {
        const { r, w, ht } = reads[i];
        const s = it.el.style;
        if (!r) {
            s.display = 'none';
            return;
        }
        s.display = '';
        if (it.kind === 'ring') {
            const b = ringRect(r, o, it.pad, viewW);
            s.left = b.left + 'px';
            s.top = b.top + 'px';
            s.width = b.width + 'px';
            s.height = b.height + 'px';
        } else {
            const p = pillSpot(r, o, w, ht, { pad: it.pad, align: it.align, viewW, edge: it.edge });
            s.left = p.left + 'px';
            s.top = p.top + 'px';
            s.maxWidth = p.maxWidth + 'px';
        }
    });
}

/** Place the marks at the next frame (resize, scroll, Torn's page changing): once a frame at most. */
export function scheduleMarks() {
    if (ml.queued || !ml.items.length) return;
    ml.queued = true;
    const run = () => {
        ml.queued = false;
        placeMarks();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
}

/* ---------------------------------------------------------- gym page */

/** "Train this · 27 trains · about +1,234" → "Train this · 27 trains": the pill's short words (the rest on hover). */
export function shortTab(tab) {
    return String(tab || '').split(' · ').slice(0, 2).join(' · ');
}

/**
 * Fill N in the panel, from planGymPage's per-stat words: the stat, how many to type, the number shown, and whether
 * it waits (the wrong gym, the boosters still to take, no energy for one train yet). null: nothing to fill.
 * @returns {{stat, n, shown, disabled, title}|null}
 */
export function gymFill(plan) {
    if (!plan || !plan.perStat) return null;
    for (const [stat, p] of Object.entries(plan.perStat)) {
        if (!p || (p.kind !== 'train' && p.kind !== 'wait')) continue;
        const wait = p.kind === 'wait';
        const n = p.fill !== undefined ? p.fill : p.trains;
        const shown = p.fillN !== undefined && (p.hold || wait) ? p.fillN : n;
        const disabled = Boolean(wait || p.hold || p.noEnergy || !(n > 0));
        const title = wait ? 'Switch gyms first' : p.noEnergy ? String(p.tab || '').split(' · then ')[0] : p.hold ? 'Take the boosters and the drug first' : 'Types ' + n + ' into Torn’s box (you press TRAIN)';
        return { stat, n, shown, disabled, title };
    }
    return null;
}

/**
 * The words the strip over the stat boxes used to say that the panel's own card doesn't (they now live in the panel):
 * where you are and where to switch, which group of gyms to open, the energy kept, the session's parts, the box's
 * own line (energy and what's left).
 * @param {object} plan - planGymPage()
 * @param {{hint?: string|null}} [o] - "Open the heavyweight gyms to find it" when the gym to go to isn't shown
 * @returns {string[]}
 */
export function gymNotes(plan, { hint = null } = {}) {
    const st = plan && plan.state;
    if (!st || st.kind === 'overdose' || st.kind === 'stacking' || st.kind === 'away') return [];
    const out = [];
    const cur = plan.current;
    const p = cur && plan.perStat ? plan.perStat[cur.stat] : null;
    if (p && p.kind === 'train' && !p.hold && p.sub) out.push(p.sub.replace(/ · about [+−-]?[\d,]+/, ''));
    if (st.kind === 'wrong' && plan.switchHint) out.push(plan.switchHint.charAt(0).toUpperCase() + plan.switchHint.slice(1));
    if (hint) out.push(hint);
    if (st.kind === 'kept' && plan.line) out.push([plan.line.head, plan.line.text].filter(Boolean).join(' · '));
    // The next gym and how far it is ("Force Training in 7,300 E, DEX 6.4 there").
    if ((st.kind === 'right' || st.kind === 'done' || st.kind === 'idle') && plan.line && plan.line.src) out.push('Next gym: ' + plan.line.src);
    // Round 9 (pick 3B): a stat outside the session that another gym of yours trains better, with both gains.
    for (const [stat, q] of Object.entries(plan.perStat || {})) if (q && q.better && q.lines) out.push(String(stat).toUpperCase() + ' · ' + q.lines.map((l, i) => (i ? l : l.charAt(0).toLowerCase() + l.slice(1))).join(' · '));
    const parts = plan.parts || [];
    if (parts.length > 1 || parts.some((x) => x.state === 'done')) {
        out.push(parts.map((x) => (x.state === 'done' ? '✓ ' : '') + x.gymName + ': ' + String(x.stat).toUpperCase() + ' × ' + x.trains + (x.state === 'current' && x.done > 0 ? ' (' + x.left + ' left)' : '')).join(' → '));
    }
    return out;
}

/**
 * Draw the gym page's marks from planGymPage() output, on our layer.
 * @param {object} plan - planGymPage(model, page)
 * @param {object[]} boxes - readStatBoxes(root)
 * @param {{id, el}[]} [buttons] - readGymButtons(root): the gym you're in and the gym to go to
 * @param {{motion:boolean}} [opts] - motion false (Settings › Animations off): the pulse is held still
 * @returns {{nextGymShown: boolean}} false: the gym to go to isn't on the page (Torn shows one group of gyms at a time)
 */
export function drawGymMarks(plan, boxes, buttons = [], { motion = true } = {}) {
    clearMarks();
    const still = motion === false ? ' pi-still' : '';
    let nextGymShown = true;
    // The gym you're in: a steady ring, green when right, red when wrong (no glow).
    if (plan.hereGym) {
        const b = buttons.find((x) => x.id === plan.hereGym.id);
        if (b && b.el) addRing(b.el, plan.hereGym.wrong ? 'pi-c-red' : 'pi-c-green', { pad: 2, title: plan.hereGym.label, data: { 'data-pi-gym': plan.hereGym.wrong ? 'wrong' : 'right', 'data-pi-gym-id': String(b.id) } });
    }
    // The gym to go to: green, and it pulses (the only pulse for gyms). The user switches; we never do.
    if (plan.nextGym) {
        const b = buttons.find((x) => x.id === plan.nextGym.id);
        if (b && b.el) addRing(b.el, 'pi-c-green pi-pulse' + still, { pad: 2, title: plan.nextGym.label, data: { 'data-pi-gym': 'go', 'data-pi-gym-id': String(b.id) } });
        else nextGymShown = false;
    }
    for (const box of boxes) {
        const p = plan.perStat[box.stat];
        if (!p || p.kind === 'off') continue;
        const data = { 'data-pi-stat': box.stat };
        if (p.kind === 'train' || p.kind === 'wait') {
            const wait = p.kind === 'wait' || p.noEnergy;
            const eat = !wait && p.mark === 'eat';
            const tone = wait ? 'pi-c-grey' : eat ? 'pi-c-red' : 'pi-c-green';
            // Steady green to train (the one thing that glows), a red pulse until the boosters are in, dashed grey
            // in the wrong gym or with no energy for one train yet.
            addRing(box.li, tone + (wait ? ' pi-dashed' : eat ? ' pi-pulse' + still : ' pi-glow'), { data: { ...data, 'data-pi-kind': p.noEnergy ? 'noenergy' : p.kind === 'wait' ? 'wait' : eat ? 'eat' : 'train' } });
            const full = [p.tab, p.kind === 'wait' ? 'Switch gyms first' : p.hold ? p.text : null, p.sub, p.warn].filter(Boolean).join(' · ');
            // Short enough for the box (the owner: "TAKE THE XANAX FIRST · TH…" was clipped): what comes first only;
            // the rest ("then DEX × 25") is in the panel and on hover.
            const words = eat ? 'Eat first' : p.warn && !wait ? p.warn.split('. ')[0] : p.noEnergy ? String(p.tab || '').split(' · then ')[0] : shortTab(p.tab);
            const pillCls = wait ? 'pi-dark pi-c-grey' : 'pi-solid ' + (p.warn ? 'pi-c-amber' : tone);
            addPill(box.li, pillCls, words, { title: full, data });
        } else if (p.tag) {
            // Never dims or covers Torn's boxes (round 6): a small dark pill on its top border, the full words on hover.
            addPill(box.li, 'pi-dark', p.tag, { title: p.text, data });
        }
        // Round 9 (pick 3B): a box the session leaves alone says what a train gives here, or the gym of yours that gives
        // more (chalk), on its bottom border. Still grey and quiet: no ring, no Fill.
        if (p.foot && p.kind !== 'train' && p.kind !== 'wait') addPill(box.li, 'pi-dark' + (p.better ? ' pi-c-chalk' : ''), p.foot, { title: [p.text].concat(p.lines || []).filter(Boolean).join(' · '), data: { ...data, 'data-pi-kind': 'gain' }, edge: 'bottom' });
    }
    placeMarks();
    return { nextGymShown };
}

/* ---------------------------------------------------------- markets */

/**
 * Mark one listing (items, bazaar cards, market rows, points lots): a chalk ring over its rect and its pill
 * ("TAKE 3 · $2,479,500") on its top edge. `glow`: the one thing that glows on the page (the first listing to take).
 */
export function markListing(el, label, { glow = false } = {}) {
    if (!el) return;
    addRing(el, 'pi-c-chalk' + (glow ? ' pi-glow' : ''), { pad: 2 });
    addPill(el, 'pi-solid pi-c-chalk', label, { align: 'left', pad: 2, data: { 'data-pi-listing': '1' } });
}
