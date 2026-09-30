/*
 * The panel on torn.com (DESIGN §4), docked like the trading script's NPC
 * Arbitrage panel: a header bar (the countdown and the step) you drag by,
 * and a body under it that collapses. It lives in the empty margin beside
 * Torn's page, the LEFT one first, so the right-hand column stays NPC
 * Arbitrage's and Torn Bids'. Dragging keeps it inside a margin; only when
 * neither margin is wide enough does it float. Alt+` collapses/expands it
 * (NPC Arbitrage uses ` alone). In its own shadow root (:host{all:initial}).
 * No sounds, pop-ups or title changes, ever.
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

export const OVERLAY_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; }
.wrap { position: fixed; z-index: ${Z}; width: var(--w, ${PANEL_W}px); display: flex; flex-direction: column; background: #1b1e21; border: 1px solid #3a4046; border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.5); color: #e3e5e8; font-size: 13px; overflow: hidden; }
.head { display: flex; align-items: center; gap: 8px; height: 36px; padding: 0 4px 0 6px; font-weight: bold; cursor: move; user-select: none; touch-action: none; white-space: nowrap; }
.head:focus-visible { outline: 2px solid #efebe2; outline-offset: -2px; }
.head .cd { font: bold 16px "Arial Narrow", Arial, sans-serif; color: #efebe2; font-variant-numeric: tabular-nums; flex: none; }
.head .ti { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.plate { width: 24px; height: 24px; border-radius: 50%; background: #efebe2; display: grid; place-items: center; box-shadow: inset 0 0 0 4px #efebe2, inset 0 0 0 5px #2a2d31; flex: none; }
.plate i { width: 5px; height: 5px; border-radius: 50%; background: #15171a; }
.wrap.paused { border-color: #e8a33d; }
.wrap.paused .plate { background: #e8a33d; box-shadow: none; color: #15171a; font: bold 14px Arial, sans-serif; }
.wrap.paused .step { font-weight: bold; }
.wrap.paused .sub { color: #c9cdd1; }
.col { flex: none; width: 26px; height: 26px; padding: 0; border: 1px solid transparent; border-radius: 5px; background: transparent; color: #e3e5e8; font: bold 15px/24px Arial, sans-serif; cursor: pointer; }
.col:hover { border-color: #3a4046; }
.col:focus-visible { outline: 2px solid #efebe2; outline-offset: 1px; }
.body { border-top: 1px solid #2c3136; padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 8px; overflow: auto; }
.collapsed .body { display: none; }
.step { font-weight: bold; color: #fff; }
.sub { font-size: 12px; color: #939aa1; }
.mini { display: grid; grid-template-columns: 48px 1fr 64px; gap: 6px; align-items: center; font-size: 11px; color: #939aa1; font-variant-numeric: tabular-nums; }
.bar { height: 5px; border-radius: 3px; background: #24282c; overflow: hidden; }
.bar i { display: block; height: 100%; border-radius: 3px; }
.later { font-size: 12px; color: #939aa1; border-top: 1px solid #2c3136; padding-top: 6px; display: flex; flex-direction: column; gap: 3px; font-variant-numeric: tabular-nums; }
.open { height: 28px; border-radius: 5px; border: 0; background: #efebe2; color: #15171a; font: bold 12px Arial, sans-serif; cursor: pointer; }
.open:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.warn { color: #e8a33d; font-size: 12px; font-weight: bold; }
`;

/**
 * Where the panel may live. `page` is Torn's page (sidebar + content) as
 * {left, right}; null when it can't be measured.
 * @returns {{side: 'left'|'right'|'float', from: number, to: number, width: number}[]}
 *   each margin wide enough to hold it (left first), else one 'float' spot
 */
export function spots(viewW, page, want = PANEL_W, min = PANEL_MIN_W) {
    const out = [];
    if (page && Number.isFinite(page.left) && Number.isFinite(page.right)) {
        for (const m of [{ side: 'left', from: EDGE, to: page.left - GAP }, { side: 'right', from: page.right + GAP, to: viewW - EDGE }]) {
            if (m.to - m.from >= min) out.push({ ...m, width: Math.min(want, m.to - m.from) });
        }
    }
    if (!out.length) out.push({ side: 'float', from: 4, to: viewW - 4, width: Math.max(160, Math.min(want, viewW - 8)) });
    return out;
}

/** A saved spot ({side, off, y}: off = distance from the margin's outer edge) as a point on screen. */
export function pointOf(pos, list, viewH, height = 36) {
    const spot = (pos && list.find((s) => s.side === pos.side)) || list[0];
    const off = pos && pos.side === spot.side && Number.isFinite(pos.off) ? pos.off : 0;
    // The left margin counts from the window's left edge; the right one and a floating panel from the right edge.
    const x = spot.side === 'left' ? spot.from + off : spot.to - spot.width - off;
    return clampInto(spot, x, pos && Number.isFinite(pos.y) ? pos.y : DEFAULT_TOP, viewH, height);
}

/** Keep a point inside its spot and on screen (at least the header stays visible). */
export function clampInto(spot, x, y, viewH, height = 36) {
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

export class Overlay {
    /**
     * @param {object} o
     * @param {function} o.onOpen
     * @param {function} o.loadPos - () => {side, off, y}|null
     * @param {function} o.savePos
     * @param {function} o.loadCollapsed - () => boolean
     * @param {function} o.saveCollapsed
     * @param {function} o.pageRect - () => {left, right}|null (Torn's sidebar + content)
     * @param {function} [o.avoidRect] - () => DOMRect|null: a panel to stay above (NPC Arbitrage)
     */
    constructor({ onOpen, loadPos, savePos, loadCollapsed, saveCollapsed, pageRect, avoidRect = () => null }) {
        this.onOpen = onOpen;
        this.loadPos = loadPos;
        this.savePos = savePos;
        this.loadCollapsed = loadCollapsed;
        this.saveCollapsed = saveCollapsed;
        this.pageRect = pageRect;
        this.avoidRect = avoidRect;
        this.off = false;
    }

    mount(doc = document) {
        this.host = doc.getElementById('pi-overlay') || h('div', { id: 'pi-overlay' });
        if (!this.host.parentNode) (doc.body || doc.documentElement).appendChild(this.host);
        this.shadow = this.host.shadowRoot || this.host.attachShadow({ mode: 'open' });
        this.head = h('div', { class: 'head', role: 'button', tabindex: '0', 'aria-label': 'Pumping Iron: next step (Alt+` to expand or collapse)' });
        this.headInfo = h('span', { class: 'ti' });
        this.colBtn = h('button', { class: 'col', type: 'button', onclick: () => this.setCollapsed(!this.collapsed, true) });
        this.body = h('div', { class: 'body' });
        this.wrap = h('div', { class: 'wrap' }, [this.head, this.body]);
        fill(this.shadow, [h('style', { text: OVERLAY_CSS }), this.wrap]);
        this.headInfo.textContent = 'Pumping Iron';
        fill(this.head, [h('span', { class: 'plate' }, [h('i')]), this.headInfo, this.colBtn]);
        this.bindDrag();
        this.head.addEventListener('keydown', (e) => {
            if (e.target === this.head && (e.key === 'Enter' || e.key === ' ')) {
                e.preventDefault();
                this.setCollapsed(!this.collapsed, true);
            }
        });
        doc.addEventListener('keydown', (e) => {
            if (e.altKey && !e.ctrlKey && !e.metaKey && !e.repeat && e.code === 'Backquote') {
                e.preventDefault();
                this.setCollapsed(!this.collapsed, true);
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

    setCollapsed(on, save, soon = false) {
        this.collapsed = Boolean(on);
        this.wrap.classList.toggle('collapsed', this.collapsed);
        this.colBtn.textContent = this.collapsed ? '+' : '–';
        this.colBtn.setAttribute('aria-label', this.collapsed ? 'Expand' : 'Collapse');
        this.colBtn.title = (this.collapsed ? 'Expand' : 'Collapse') + ' (Alt+`)';
        this.head.setAttribute('aria-expanded', String(!this.collapsed));
        if (save) this.saveCollapsed(this.collapsed);
        if (soon) this.placeSoon();
        else this.place();
    }

    spotList() {
        return spots(window.innerWidth, this.pageRect());
    }

    /** Put it where it was left (or the default), inside its margin, above NPC Arbitrage when they share one. */
    place() {
        if (!this.wrap) return;
        this.wrap.style.display = this.off ? 'none' : 'flex';
        if (this.off) return;
        this.wrap.style.visibility = '';
        const list = this.spotList();
        const stored = this.loadPos();
        const pos = stored && stored.side ? stored : null;
        const spot = (pos && list.find((s) => s.side === pos.side)) || list[0];
        this.wrap.style.setProperty('--w', spot.width + 'px');
        const p = pointOf(pos, list, window.innerHeight, this.wrap.offsetHeight || 36);
        this.apply(p);
    }

    apply(p) {
        this.wrap.style.left = p.x + 'px';
        this.wrap.style.top = p.y + 'px';
        this.wrap.style.setProperty('--w', p.spot.width + 'px');
        // The body scrolls inside the window, and stops above NPC Arbitrage if that panel is below it.
        let bottom = window.innerHeight - 12;
        const a = this.avoidRect();
        if (a && a.width && a.height && a.left < p.x + p.spot.width && a.right > p.x && a.top > p.y + 36) bottom = Math.min(bottom, a.top - 8);
        this.body.style.maxHeight = Math.max(60, bottom - p.y - 36) + 'px';
    }

    bindDrag() {
        let start = null;
        this.head.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
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
            else if (!moved && e.type === 'pointerup' && this.collapsed) this.setCollapsed(false, true);
        };
        this.head.addEventListener('pointerup', end);
        this.head.addEventListener('pointercancel', end);
    }

    /**
     * @param {object} v - {off, paused, cdAt, pillText, pillNow, cardStep, cardSub, warn, energy:{current,max}, happy:{current,max}, later:[string]}
     *   paused: Torn Trading runs (a warning sign instead of the plate, an amber edge)
     */
    update(v) {
        const wasOff = this.off;
        this.off = Boolean(v.off);
        if (this.off) {
            this.wrap.style.display = 'none';
            return;
        }
        const now = Date.now();
        const cdText = v.pillNow || (v.cdAt ? countdown(v.cdAt - now) : '');
        this.headInfo.textContent = v.pillText || 'Pumping Iron';
        this.wrap.classList.toggle('paused', Boolean(v.paused));
        fill(this.head, [v.paused ? h('span', { class: 'plate', text: '!', 'aria-label': 'Paused' }) : h('span', { class: 'plate' }, [h('i')]), cdText ? h('span', { class: 'cd', 'data-cd': v.cdAt && !v.pillNow ? String(v.cdAt) : null, text: cdText }) : null, this.headInfo, this.colBtn]);
        this.head.title = v.pillText || '';
        const bars = [];
        if (v.energy) bars.push(h('div', { class: 'mini' }, [h('span', { text: 'Energy' }), h('div', { class: 'bar' }, [h('i', { style: 'width:' + Math.min(100, (100 * v.energy.current) / Math.max(1, v.energy.max)) + '%;background:#efebe2' })]), h('span', { text: v.energy.current + ' / ' + v.energy.max })]));
        if (v.happy) bars.push(h('div', { class: 'mini' }, [h('span', { text: 'Happy' }), h('div', { class: 'bar' }, [h('i', { style: 'width:' + Math.min(100, (100 * v.happy.current) / Math.max(1, v.happy.max)) + '%;background:#9bdc8a' })]), h('span', { text: String(v.happy.current).replace(/\B(?=(\d{3})+(?!\d))/g, ',') })]));
        fill(this.body, [
            h('span', { class: 'step', text: v.cardStep || '' }),
            v.cardSub ? h('span', { class: 'sub', text: v.cardSub }) : null,
            v.warn ? h('span', { class: 'warn', text: v.warn }) : null,
            ...bars,
            v.later && v.later.length ? h('div', { class: 'later' }, v.later.map((x) => h('span', { text: x }))) : null,
            h('button', { class: 'open', type: 'button', onclick: () => this.onOpen(), text: 'Open Pumping Iron' }),
        ]);
        if (wasOff || !this.placed) {
            this.placed = true;
            this.placeSoon();
        }
    }

    /** Every second: the countdowns only. */
    tick() {
        if (!this.shadow) return;
        const now = Date.now();
        for (const el of this.shadow.querySelectorAll('[data-cd]')) el.textContent = countdown(Number(el.getAttribute('data-cd')) - now);
    }
}
