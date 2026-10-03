/*
 * The panel on torn.com (DESIGN §4), docked like the trading script's NPC
 * Arbitrage panel: a header bar (the countdown and the step) you drag by,
 * and a body under it that collapses. It lives in the empty margin beside
 * Torn's page, the LEFT one first, so the right-hand column stays NPC
 * Arbitrage's and Torn Bids'. Dragging keeps it inside a margin; only when
 * neither margin is wide enough does it float. Alt+` collapses/expands it
 * (NPC Arbitrage uses ` alone). In its own shadow root (:host{all:initial}).
 * No sounds, pop-ups or title changes, ever.
 *
 * Round 7's look (overlays.html §5): the step in big type, one muted line,
 * the energy bar, "then …", one action button ("Open the gym"); a coloured
 * edge only when it's time to act (chalk) or the page says so (green, red,
 * amber); folded it is one tag. On the attack page it folds to one line
 * under Torn Eye's fight card and never covers it.
 */

import { h, fill } from './dom.js';
import { countdown } from '../core/bars.js';

/** Its usual width, and the least a margin must have to hold it. */
export const PANEL_W = 300;
export const PANEL_MIN_W = 220;
/** Space kept from Torn's page and from the window's edge. */
export const GAP = 12;
export const EDGE = 12;
/** Its default top: level with Torn's page title. */
export const DEFAULT_TOP = 80;
/** Under NPC Arbitrage's layer, so the trading script's windows stay on top if they ever meet. */
export const Z = 2147482990;

/** Space between Torn Eye's fight card and the panel docked under it (the attack page). */
export const DOCK_GAP = 8;

/** The edge colours (round 7's one look): chalk "do this", green train, red wrong or not yet, amber paused or overdosed. */
export const TONES = { chalk: '#efebe2', green: '#3fbf5a', red: '#ff6b5e', amber: '#e8a33d' };

export const OVERLAY_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
.wrap { --b: #3a4046; position: fixed; z-index: ${Z}; width: var(--w, ${PANEL_W}px); display: flex; flex-direction: column; background: #101214; border: 1px solid #3a4046; border-radius: 10px; box-shadow: 0 8px 26px rgba(0,0,0,.6); color: #f2f3f5; font-size: var(--fs, 13px); line-height: 1.4; overflow: hidden; }
.wrap.toned { border-color: color-mix(in srgb, var(--b) 55%, #3a4046); }
.ribbon { height: 4px; flex: none; background: var(--b); display: none; }
.wrap.toned .ribbon { display: block; }
.collapsed .ribbon { display: none !important; }
.wrap.collapsed { border-radius: 6px; }
.wrap.collapsed.toned { border-left: 5px solid var(--b); }
.head { display: flex; align-items: center; gap: 8px; height: 36px; flex: none; padding: 0 4px 0 8px; font-weight: 700; cursor: move; user-select: none; touch-action: none; white-space: nowrap; }
.head:focus-visible { outline: 2px solid #efebe2; outline-offset: -2px; }
.head .cd { font-weight: 700; font-size: 15px; color: #efebe2; font-variant-numeric: tabular-nums; flex: none; }
.head .ti { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; color: #fff; }
.plate { width: 18px; height: 18px; border-radius: 50%; background: #efebe2; display: grid; place-items: center; box-shadow: inset 0 0 0 3.5px #efebe2, inset 0 0 0 5px #15171a; flex: none; }
.plate i { width: 4px; height: 4px; border-radius: 50%; background: #15171a; }
.wrap.paused .plate { background: #e8a33d; box-shadow: none; color: #15171a; font: 700 12px 'Segoe UI', system-ui, sans-serif; }
.col, .app { flex: none; width: 26px; height: 26px; padding: 0; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #c5cad0; font: 700 14px/24px 'Segoe UI', system-ui, sans-serif; cursor: pointer; }
.col:hover, .app:hover { border-color: #3a4046; }
.col:focus-visible, .app:focus-visible { outline: 2px solid #efebe2; outline-offset: 1px; }
.body { border-top: 1px solid #262a2e; padding: 10px 14px 14px; display: flex; flex-direction: column; gap: 8px; overflow: auto; }
.collapsed .body { display: none; }
.lbl { font-size: 11px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: var(--lb, #9aa1a8); }
.step { font-weight: 700; font-size: var(--fstep, 20px); line-height: 1.2; color: #fff; }
.sub { font-size: 12px; color: #9aa1a8; }
.row2 { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; font-variant-numeric: tabular-nums; }
.row2 .k { color: #9aa1a8; }
.meter { height: 6px; border-radius: 3px; background: #2a2e33; overflow: hidden; }
.meter i { display: block; height: 100%; border-radius: 3px; background: #3fbf5a; }
.later { font-size: 12px; color: #9aa1a8; font-variant-numeric: tabular-nums; }
.check { display: flex; gap: 8px; align-items: center; font-size: 12px; color: #c5cad0; }
.check i { width: 14px; height: 14px; border-radius: 3px; border: 1.5px solid #6c737a; display: inline-grid; place-items: center; font-style: normal; font-size: 10px; flex: none; }
.check.done { color: #9aa1a8; }
.check.done i { background: #3fbf5a; border-color: #3fbf5a; color: #101214; }
.check.next { color: #fff; font-weight: 700; }
.check.next i { border-color: var(--b); }
.cta { display: block; height: 32px; line-height: 32px; text-align: center; border-radius: 6px; border: 0; background: #efebe2; color: #15171a; font: 700 13px 'Segoe UI', system-ui, sans-serif; cursor: pointer; text-decoration: none; }
.cta:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.warn { color: #e8a33d; font-size: 12px; font-weight: 700; }
/* Sized to the free space beside Torn's page (fitTier): narrower with smaller type, then one tag, then the smallest. */
.wrap.fit-narrow .body { padding: 8px 10px 10px; gap: 6px; }
.wrap.fit-narrow .sub, .wrap.fit-narrow .later, .wrap.fit-narrow .check, .wrap.fit-narrow .row2 { font-size: 11px; }
.wrap.fit-compact .head, .wrap.fit-mini .head { gap: 5px; padding: 0 2px 0 6px; }
.wrap.fit-compact .head .cd, .wrap.fit-mini .head .cd { font-size: 13px; }
.wrap.fit-compact .body { padding: 6px 8px 8px; gap: 5px; }
.wrap.fit-compact .app, .wrap.fit-mini .ti, .wrap.fit-mini .col, .wrap.fit-mini .app { display: none; }
`;

/**
 * Where the panel docks on the attack page: directly under Torn Eye's fight card, as wide as it, never on top of it.
 * Above the card when there is no room under it; under it (partly off screen) when neither fits.
 * @param {{left, top, right, bottom, width}} card - the card's rect (viewport)
 * @returns {{x:number, y:number, width:number, side:'below'|'above'}}
 */
/**
 * Another page's Torn Eye card (the profile) in the margin the panel would take: they share a side when their columns
 * overlap and the card starts above the panel's foot (the full panel is about 340 px tall). Then the panel docks under it.
 */
export function sharesMargin(card, x, y, width, height = 340) {
    if (!card || !(card.width > 0) || !(card.height > 0)) return false;
    return card.left < x + width && card.right > x && card.top < y + height && card.bottom > y;
}

export function dockUnder(card, viewW, viewH, height = 36, gap = DOCK_GAP) {
    const width = Math.max(160, Math.round(Math.min(card.width, viewW - 8)));
    const x = Math.round(Math.min(Math.max(4, card.left), Math.max(4, viewW - width - 4)));
    const below = card.bottom + gap;
    if (below + height > viewH - 4 && card.top - gap - height >= 4) return { x, y: Math.round(card.top - gap - height), width, side: 'above' };
    return { x, y: Math.round(below), width, side: 'below' };
}

/*
 * Round 7 (the owner): the panel never goes over Torn's page. Like NPC Arbitrage it sizes itself to the free space
 * beside Torn's page: the full card where a margin holds it, a narrower one with smaller type, then one tag; only with
 * no usable margin at all it is the smallest tag in the window's top corner (over Torn's header, never its content).
 */

/** The least width of each size, by the free width a margin gives. */
export const FIT_FULL_W = 260;
export const FIT_NARROW_W = 180;
export const FIT_COMPACT_W = 100;
/** The smallest tag (the plate and the countdown) and where it sits when no margin holds even one tag. */
export const MINI_W = 84;
export const CORNER_TOP = 4;

const TIER_RANK = { full: 3, narrow: 2, compact: 1, mini: 0 };

/**
 * The panel's size for a width it can have.
 * @returns {{tier: 'full'|'narrow'|'compact'|'mini', font: number, step: number, folded: boolean}}
 *   font: its type (px), step: the big step's type (px), folded: one tag (compact folds by itself; mini always)
 */
export function fitTier(width) {
    if (width >= FIT_FULL_W) return { tier: 'full', font: 13, step: 20, folded: false };
    if (width >= FIT_NARROW_W) return { tier: 'narrow', font: 12, step: 16, folded: false };
    if (width >= FIT_COMPACT_W) return { tier: 'compact', font: 11, step: 14, folded: true };
    return { tier: 'mini', font: 11, step: 14, folded: true };
}

/**
 * Where the panel may live. `page` is Torn's page (sidebar + content) as
 * {left, right}; null when it can't be measured.
 * @returns {{side: 'left'|'right'|'corner', from: number, to: number, width: number, tier, font, step, folded}[]}
 *   each margin that holds at least one tag, the best size first (the left one on a tie, so NPC Arbitrage keeps
 *   the right), else one 'corner' spot for the smallest tag
 */
export function spots(viewW, page, want = PANEL_W, min = FIT_COMPACT_W) {
    const out = [];
    if (page && Number.isFinite(page.left) && Number.isFinite(page.right)) {
        for (const m of [{ side: 'left', from: EDGE, to: page.left - GAP }, { side: 'right', from: page.right + GAP, to: viewW - EDGE }]) {
            const free = m.to - m.from;
            if (free >= min) {
                const width = Math.round(Math.min(want, free));
                out.push({ ...m, width, ...fitTier(width) });
            }
        }
    }
    out.sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier]);
    if (!out.length) out.push({ side: 'corner', from: 4, to: 4 + MINI_W, width: MINI_W, ...fitTier(0) });
    return out;
}

/** A saved spot ({side, off, y}: off = distance from the margin's outer edge) as a point on screen. */
export function pointOf(pos, list, viewH, height = 36) {
    // The side you left it on, unless the other side holds a bigger panel now (a narrower window).
    const saved = pos && list.find((s) => s.side === pos.side);
    const spot = saved && TIER_RANK[saved.tier] >= TIER_RANK[list[0].tier] ? saved : list[0];
    if (spot.side === 'corner') return { spot, x: spot.from, y: CORNER_TOP };
    const off = pos && pos.side === spot.side && Number.isFinite(pos.off) ? pos.off : 0;
    // The left margin counts from the window's left edge; the right one from the right edge.
    const x = spot.side === 'left' ? spot.from + off : spot.to - spot.width - off;
    return clampInto(spot, x, pos && Number.isFinite(pos.y) ? pos.y : DEFAULT_TOP, viewH, height);
}

/** Keep a point inside its spot and on screen (at least the header stays visible). */
export function clampInto(spot, x, y, viewH, height = 36) {
    if (spot.side === 'corner') return { spot, x: spot.from, y: CORNER_TOP };
    const maxX = Math.max(spot.from, spot.to - spot.width);
    const maxY = Math.max(4, viewH - Math.min(height, 40) - 4);
    return { spot, x: Math.round(Math.min(maxX, Math.max(spot.from, x))), y: Math.round(Math.min(maxY, Math.max(4, y))) };
}

/** While dragging: the spot nearest the pointer's panel position, and the point clamped into it. */
export function dragTo(list, x, y, viewH, height = 36) {
    let best = null;
    for (const s of list) {
        const cx = Math.min(Math.max(s.from, x), Math.max(s.from, s.to - s.width));
        const d = Math.abs(cx - x);
        if (!best || d < best.d) best = { s, d };
    }
    return clampInto(best.s, x, y, viewH, height);
}

/** The point as a saved spot (survives window resizes). */
export function posOf(p) {
    const s = p.spot;
    return { side: s.side, off: Math.round(s.side === 'left' ? p.x - s.from : s.to - s.width - p.x), y: p.y };
}


/** "12 s ago", "3 min ago" */
export function agoWords(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? s + ' s ago' : Math.round(s / 60) + ' min ago';
}

export class Overlay {
    /**
     * @param {object} o
     * @param {function} o.onOpen - open the webpage
     * @param {function} o.loadPos - () => {side, off, y}|null
     * @param {function} o.savePos
     * @param {function} o.loadCollapsed - () => boolean
     * @param {function} o.saveCollapsed
     * @param {function} o.pageRect - () => {left, right}|null (Torn's sidebar + content)
     * @param {function} [o.avoidRect] - () => DOMRect|null: a panel to stay above (NPC Arbitrage)
     * @param {function} [o.dockTo] - () => Element|null: dock folded under it (Torn Eye's fight card on the attack page)
     * @param {function} [o.dockIfShared] - () => Element|null: dock under it only when it sits in the panel's margin (the profile card)
     */
    constructor({ onOpen, loadPos, savePos, loadCollapsed, saveCollapsed, pageRect, avoidRect = () => null, dockTo = () => null, dockIfShared = () => null }) {
        this.onOpen = onOpen;
        this.loadPos = loadPos;
        this.savePos = savePos;
        this.loadCollapsed = loadCollapsed;
        this.saveCollapsed = saveCollapsed;
        this.pageRect = pageRect;
        this.avoidRect = avoidRect;
        this.dockTo = dockTo;
        this.dockIfShared = dockIfShared;
        this.docked = null;
        this.off = false;
    }

    mount(doc = document) {
        this.host = doc.getElementById('pi-overlay') || h('div', { id: 'pi-overlay' });
        if (!this.host.parentNode) (doc.body || doc.documentElement).appendChild(this.host);
        this.shadow = this.host.shadowRoot || this.host.attachShadow({ mode: 'open' });
        this.head = h('div', { class: 'head', role: 'button', tabindex: '0', 'aria-label': 'Pumping Iron: next step (Alt+` to expand or collapse)' });
        this.headInfo = h('span', { class: 'ti' });
        this.colBtn = h('button', { class: 'col', type: 'button', onclick: () => this.toggle() });
        this.ribbon = h('div', { class: 'ribbon' });
        this.body = h('div', { class: 'body' });
        this.wrap = h('div', { class: 'wrap' }, [this.ribbon, this.head, this.body]);
        fill(this.shadow, [h('style', { text: OVERLAY_CSS }), this.wrap]);
        this.headInfo.textContent = 'Pumping Iron';
        fill(this.head, [h('span', { class: 'plate' }, [h('i')]), this.headInfo, this.colBtn]);
        this.bindDrag();
        this.head.addEventListener('keydown', (e) => {
            if (e.target === this.head && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                this.toggle();
            }
        });
        doc.addEventListener('keydown', (e) => {
            if (e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat && e.code === 'Backquote') {
                e.preventDefault();
                this.toggle();
            }
        });
        window.addEventListener('resize', () => this.place());
        // Torn's page settles after load (sidebar, React): fit again then.
        setTimeout(() => this.place(), 1500);
        // Hidden until placed: where it goes is measured after Torn's first paint, never inside the page's boot.
        this.wrap.style.visibility = 'hidden';
        this.setCollapsed(Boolean(this.loadCollapsed()), false, true);
    }

    /** Place it after the page's next paint (measuring Torn's layout inside the boot task forced a layout: 80–136 ms at 4× CPU). */
    placeSoon() {
        if (this.placeTimer) return;
        const later = (fn) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => setTimeout(fn, 0)) : setTimeout(fn, 0));
        this.placeTimer = true;
        later(() => {
            this.placeTimer = null;
            this.place();
        });
    }

    /**
     * Docked under the fight card it stays one line (it would cover the card otherwise), and so does the smallest tag;
     * a one-tag panel (a narrow margin) opens for a look without changing your choice; else fold or unfold, remembered.
     */
    toggle() {
        if (this.docked || (this.fit && this.fit.tier === 'mini')) return;
        if (this.fit && this.fit.tier === 'compact') {
            this.peek = !this.peek;
            this.showFolded();
            this.place();
            return;
        }
        this.setCollapsed(!this.collapsed, true);
    }

    /** One tag now: your choice, docked under the fight card, or the free space holds no more (fitTier). */
    isFolded() {
        const f = this.fit;
        return this.collapsed || Boolean(this.docked) || Boolean(f && (f.tier === 'mini' || (f.tier === 'compact' && !this.peek)));
    }

    /** The size the free space gives it (fitTier): its type and how it folds. */
    setFit(width) {
        const f = fitTier(width);
        const changed = !this.fit || this.fit.tier !== f.tier;
        this.fit = f;
        this.wrap.style.setProperty('--fs', f.font + 'px');
        this.wrap.style.setProperty('--fstep', f.step + 'px');
        if (!changed) return;
        for (const t of ['full', 'narrow', 'compact', 'mini']) this.wrap.classList.toggle('fit-' + t, t === f.tier);
        this.wrap.setAttribute('data-fit', f.tier);
        if (f.tier !== 'compact') this.peek = false;
        this.showFolded();
    }

    setCollapsed(on, save, soon = false) {
        this.collapsed = Boolean(on);
        this.showFolded();
        this.colBtn.setAttribute('aria-label', this.collapsed ? 'Expand' : 'Collapse');
        this.colBtn.title = (this.collapsed ? 'Expand' : 'Collapse') + ' (Alt+`)';
        if (save) this.saveCollapsed(this.collapsed);
        if (soon) this.placeSoon();
        else this.place();
    }

    /** Folded = one tag: the user's choice, or always while docked under the fight card. */
    showFolded() {
        const folded = this.isFolded();
        this.wrap.classList.toggle('collapsed', folded);
        this.wrap.classList.toggle('docked', Boolean(this.docked));
        this.colBtn.textContent = folded ? '+' : '–';
        this.colBtn.style.display = this.docked || (this.fit && this.fit.tier === 'mini') ? 'none' : '';
        this.head.setAttribute('aria-expanded', String(!folded));
    }

    /** The card to dock under: the attack page's always; the profile's only when it took the panel's margin. */
    dockCard() {
        const card = this.dockTo ? this.dockTo() : null;
        if (card) return card;
        const other = this.dockIfShared ? this.dockIfShared() : null;
        if (!other || !other.getBoundingClientRect) return null;
        const stored = this.loadPos();
        const p = pointOf(stored && stored.side ? stored : null, this.spotList(), window.innerHeight);
        return sharesMargin(other.getBoundingClientRect(), p.x, p.y, p.spot.width) ? other : null;
    }

    spotList() {
        return spots(window.innerWidth, this.pageRect());
    }

    /** Put it where it was left (or the default), inside its margin, above NPC Arbitrage when they share one; on the attack page under the fight card. */
    place() {
        if (!this.wrap) return;
        this.wrap.style.display = this.off ? 'none' : 'flex';
        if (this.off) return;
        this.wrap.style.visibility = '';
        const card = this.dockCard();
        const r = card && card.getBoundingClientRect ? card.getBoundingClientRect() : null;
        const was = Boolean(this.docked);
        if (r && r.width > 0 && r.height > 0) {
            const d = dockUnder(r, window.innerWidth, window.innerHeight, 36);
            this.docked = { key: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), window.innerWidth, window.innerHeight].join(',') };
            if (!was) this.showFolded();
            this.wrap.style.left = d.x + 'px';
            this.wrap.style.top = d.y + 'px';
            this.wrap.style.setProperty('--w', d.width + 'px');
            this.setFit(d.width);
            return;
        }
        this.docked = null;
        if (was) this.showFolded();
        const list = this.spotList();
        const stored = this.loadPos();
        const pos = stored && stored.side ? stored : null;
        // Sized to the free space first (the height it then has places it).
        const first = pointOf(pos, list, window.innerHeight);
        this.wrap.style.setProperty('--w', first.spot.width + 'px');
        this.setFit(first.spot.width);
        const p = pointOf(pos, list, window.innerHeight, this.wrap.offsetHeight || 36);
        this.apply(p);
    }

    apply(p) {
        this.wrap.style.left = p.x + 'px';
        this.wrap.style.top = p.y + 'px';
        this.wrap.style.setProperty('--w', p.spot.width + 'px');
        this.setFit(p.spot.width);
        // The body scrolls inside the window, and stops above NPC Arbitrage if that panel is below it.
        let bottom = window.innerHeight - 12;
        const a = this.avoidRect();
        if (a && a.width && a.height && a.left < p.x + p.spot.width && a.right > p.x && a.top > p.y + 36) bottom = Math.min(bottom, a.top - 8);
        this.body.style.maxHeight = Math.max(60, bottom - p.y - 40) + 'px';
    }

    bindDrag() {
        let start = null;
        this.head.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 || this.docked) return;
            if (e.target.closest && e.target.closest('button, a, input')) return;
            const r = this.wrap.getBoundingClientRect();
            start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top, moved: false, list: this.spotList() };
            this.head.setPointerCapture(e.pointerId);
        });
        this.head.addEventListener('pointermove', (e) => {
            if (!start) return;
            const dx = e.clientX - start.x;
            const dy = e.clientY - start.y;
            if (!start.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
            start.moved = true;
            start.p = dragTo(start.list, start.left + dx, start.top + dy, window.innerHeight, this.wrap.offsetHeight);
            this.apply(start.p);
        });
        const end = (e) => {
            if (!start) return;
            const { moved, p } = start;
            start = null;
            if (this.head.hasPointerCapture && this.head.hasPointerCapture(e.pointerId)) this.head.releasePointerCapture(e.pointerId);
            if (moved && p) this.savePos(posOf(p));
            else if (!moved && e.type === 'pointerup' && this.isFolded()) this.toggle();
        };
        this.head.addEventListener('pointerup', end);
        this.head.addEventListener('pointercancel', end);
    }

    /**
     * @param {object} v - {off, paused, tone, label, cdAt, pillText, pillNow, cardStep, cardSub, warn, checklist, energy:{current,max},
     *   later:[string], action:{text, href}|null, seen:{count, where, lastAt, resumesAt}}
     *   tone: the edge's colour (chalk: time to act; green, red, amber); none: a plain border
     *   paused: Torn Trading runs (a warning sign instead of the plate, an amber card)
     *   action: the one button (a link to a Torn page, e.g. "Open the gym"); none: "Open Pumping Iron"
     */
    update(v) {
        const wasOff = this.off;
        this.off = Boolean(v.off);
        if (this.off) {
            this.wrap.style.display = 'none';
            return;
        }
        const now = Date.now();
        const tone = v.paused ? 'amber' : v.tone && TONES[v.tone] ? v.tone : null;
        this.wrap.style.setProperty('--b', tone ? TONES[tone] : '#3a4046');
        this.wrap.classList.toggle('toned', Boolean(tone));
        this.wrap.setAttribute('data-tone', tone || '');
        this.wrap.classList.toggle('paused', Boolean(v.paused));
        const cdText = v.pillNow || (v.cdAt ? countdown(v.cdAt - now) : '');
        this.headInfo.textContent = v.pillText || 'Pumping Iron';
        // One way to the webpage always: the big button when there is no Torn page to go to, else a small ↗ here.
        const link = v.action && v.action.href;
        const app = link ? h('button', { class: 'app open', type: 'button', title: 'Open Pumping Iron', 'aria-label': 'Open Pumping Iron', onclick: () => this.onOpen(), text: '↗' }) : null;
        fill(this.head, [v.paused ? h('span', { class: 'plate', text: '!', 'aria-label': 'Paused' }) : h('span', { class: 'plate' }, [h('i')]), cdText ? h('span', { class: 'cd', 'data-cd': v.cdAt && !v.pillNow ? String(v.cdAt) : null, text: cdText }) : null, this.headInfo, app, this.colBtn]);
        this.head.title = v.pillText || '';
        const kids = [];
        if (v.label) kids.push(h('span', { class: 'lbl', style: tone ? '--lb:' + TONES[tone] : null, text: v.label }));
        if (v.cardStep) kids.push(h('span', { class: 'step', text: v.cardStep }));
        if (v.cardSub) kids.push(h('span', { class: 'sub', text: v.cardSub }));
        if (v.warn) kids.push(h('span', { class: 'warn', text: v.warn }));
        if (v.seen) {
            const s = v.seen;
            if (s.count > 0) {
                kids.push(h('span', {}, ['Still seen in ', h('b', { style: 'color:#fff', text: s.count + ' tab' + (s.count === 1 ? '' : 's') }), ': ' + s.where.join(', ') + '.']));
                kids.push(h('span', { class: 'sub', text: 'Reload or close ' + (s.count === 1 ? 'it' : 'them') + '. Pumping Iron starts again 60 s after the last one.' }));
            } else {
                kids.push(h('span', {}, ['Torn Trading isn’t seen any more. Starting again in ', h('b', { style: 'color:#fff', 'data-cd': String(s.resumesAt), text: countdown(s.resumesAt - now) }), '.']));
            }
            if (s.lastAt) kids.push(h('div', { class: 'row2' }, [h('span', { class: 'k', text: 'Last seen' }), h('span', { 'data-ago': String(s.lastAt), text: agoWords(now - s.lastAt) })]));
        }
        if (v.checklist && v.checklist.length) for (const c of v.checklist) kids.push(h('div', { class: 'check' + (c.done ? ' done' : '') + (c.next ? ' next' : '') }, [h('i', { text: c.done ? '✓' : '' }), h('span', { text: c.text })]));
        if (v.energy) {
            kids.push(h('div', { class: 'row2' }, [h('span', { class: 'k', text: 'Energy' }), h('span', { text: fmtNum(v.energy.current) + ' / ' + fmtNum(v.energy.max) })]));
            kids.push(h('div', { class: 'meter' }, [h('i', { style: 'width:' + Math.min(100, (100 * v.energy.current) / Math.max(1, v.energy.max)) + '%' })]));
        }
        if (v.later && v.later.length) kids.push(h('div', { class: 'later', text: 'then ' + v.later.join(' · ') }));
        kids.push(link ? h('a', { class: 'cta go', href: v.action.href, text: v.action.text }) : h('button', { class: 'cta open', type: 'button', onclick: () => this.onOpen(), text: 'Open Pumping Iron' }));
        fill(this.body, kids);
        if (wasOff || !this.placed) {
            this.placed = true;
            this.placeSoon();
        }
    }

    /** Every second: the countdowns, and the dock follows the fight card. */
    tick() {
        if (!this.shadow) return;
        const now = Date.now();
        for (const el of this.shadow.querySelectorAll('[data-cd]')) el.textContent = countdown(Number(el.getAttribute('data-cd')) - now);
        for (const el of this.shadow.querySelectorAll('[data-ago]')) el.textContent = agoWords(now - Number(el.getAttribute('data-ago')));
        if (this.off || !this.wrap) return;
        const card = this.dockCard();
        if (!card && !this.docked) return;
        const r = card && card.getBoundingClientRect ? card.getBoundingClientRect() : null;
        const key = r ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height), window.innerWidth, window.innerHeight].join(',') : '';
        if (!this.docked || this.docked.key !== key) this.place();
    }
}

function fmtNum(n) {
    return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
