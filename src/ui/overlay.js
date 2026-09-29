/*
 * The overlay on torn.com (DESIGN §4): a 36px pill with the countdown and
 * the step, and a card on hover or click. In its own shadow root
 * (:host{all:initial}) so Torn's CSS and ours never meet. It sits in the
 * free space right of Torn's content, can be dragged (the spot is kept),
 * and Alt+P hides it. No sounds, pop-ups or title changes, ever.
 */

import { h, fill } from './dom.js';
import { countdown } from '../core/bars.js';

export const OVERLAY_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; }
.wrap { position: fixed; z-index: 99990; display: flex; flex-direction: column; align-items: flex-start; gap: 8px; }
.pill { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 14px 0 6px; border-radius: 18px; background: #1b1e21; border: 1px solid #3a4046; box-shadow: 0 4px 14px rgba(0,0,0,.4); font: bold 13px Arial, sans-serif; color: #e3e5e8; cursor: grab; user-select: none; white-space: nowrap; }
.pill:focus-visible { outline: 2px solid #efebe2; outline-offset: 2px; }
.pill .cd { font: bold 16px "Arial Narrow", Arial, sans-serif; color: #efebe2; font-variant-numeric: tabular-nums; }
.plate { width: 24px; height: 24px; border-radius: 50%; background: #efebe2; display: grid; place-items: center; box-shadow: inset 0 0 0 4px #efebe2, inset 0 0 0 5px #2a2d31; flex: none; }
.plate i { width: 5px; height: 5px; border-radius: 50%; background: #15171a; }
.card { width: 280px; background: #1b1e21; border: 1px solid #3a4046; border-radius: 10px; padding: 12px 14px; box-shadow: 0 8px 24px rgba(0,0,0,.5); display: flex; flex-direction: column; gap: 8px; color: #e3e5e8; font-size: 13px; }
.card[hidden] { display: none; }
.lab { font-size: 11px; font-weight: bold; letter-spacing: .5px; text-transform: uppercase; color: #939aa1; }
.big { font: bold 34px/1 "Arial Narrow", Arial, sans-serif; color: #efebe2; font-variant-numeric: tabular-nums; }
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

/** Where the pill goes by default: just right of Torn's content column, or the right edge. */
export function defaultPosition(viewW, contentRight, pillW = 200) {
    const free = viewW - contentRight;
    if (free >= pillW + 24) return { x: contentRight + 12, y: 110 };
    return { x: Math.max(8, viewW - pillW - 12), y: 110 };
}

/** Keep a stored spot on screen after a resize. */
export function clampPosition(pos, viewW, viewH, w = 200, hgt = 40) {
    return { x: Math.max(4, Math.min(viewW - w - 4, pos.x)), y: Math.max(4, Math.min(viewH - hgt - 4, pos.y)) };
}

export class Overlay {
    /**
     * @param {object} o - {onOpen, loadPos, savePos, loadHidden, saveHidden, contentRight}
     */
    constructor({ onOpen, loadPos, savePos, loadHidden, saveHidden, contentRight }) {
        this.onOpen = onOpen;
        this.loadPos = loadPos;
        this.savePos = savePos;
        this.loadHidden = loadHidden;
        this.saveHidden = saveHidden;
        this.contentRight = contentRight;
        this.cardOpen = false;
        this.pinned = false;
    }

    mount(doc = document) {
        this.host = doc.getElementById('pi-overlay') || h('div', { id: 'pi-overlay' });
        if (!this.host.parentNode) (doc.body || doc.documentElement).appendChild(this.host);
        this.shadow = this.host.shadowRoot || this.host.attachShadow({ mode: 'open' });
        this.wrap = h('div', { class: 'wrap' });
        this.pill = h('div', { class: 'pill', role: 'button', tabindex: '0', 'aria-label': 'Pumping Iron: next step' });
        this.card = h('div', { class: 'card', hidden: true });
        this.wrap.append(this.pill, this.card);
        fill(this.shadow, [h('style', { text: OVERLAY_CSS }), this.wrap]);
        this.place();
        this.bindDrag();
        this.wrap.addEventListener('mouseenter', () => this.showCard(true));
        this.wrap.addEventListener('mouseleave', () => !this.pinned && this.showCard(false));
        this.pill.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                this.pinned = !this.pinned;
                this.showCard(this.pinned);
            }
        });
        doc.addEventListener('keydown', (e) => {
            if (e.altKey && (e.key === 'p' || e.key === 'P')) {
                const hidden = !this.isHidden();
                this.saveHidden(hidden);
                this.applyHidden();
            }
        });
        window.addEventListener('resize', () => this.place());
        this.applyHidden();
    }

    isHidden() {
        return Boolean(this.loadHidden());
    }

    applyHidden() {
        this.wrap.style.display = this.isHidden() || this.off ? 'none' : 'flex';
    }

    place() {
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const stored = this.loadPos();
        const pos = stored && Number.isFinite(stored.x) ? clampPosition(stored, vw, vh) : defaultPosition(vw, this.contentRight());
        this.wrap.style.left = pos.x + 'px';
        this.wrap.style.top = pos.y + 'px';
        // Open the card toward the side with room.
        this.wrap.style.alignItems = pos.x + 290 > vw ? 'flex-end' : 'flex-start';
    }

    bindDrag() {
        let start = null;
        this.pill.addEventListener('pointerdown', (e) => {
            start = { x: e.clientX, y: e.clientY, left: parseFloat(this.wrap.style.left), top: parseFloat(this.wrap.style.top), moved: false };
            this.pill.setPointerCapture(e.pointerId);
        });
        this.pill.addEventListener('pointermove', (e) => {
            if (!start) return;
            const dx = e.clientX - start.x;
            const dy = e.clientY - start.y;
            if (Math.abs(dx) + Math.abs(dy) > 4) start.moved = true;
            if (!start.moved) return;
            const p = clampPosition({ x: start.left + dx, y: start.top + dy }, window.innerWidth, window.innerHeight);
            this.wrap.style.left = p.x + 'px';
            this.wrap.style.top = p.y + 'px';
        });
        this.pill.addEventListener('pointerup', () => {
            if (!start) return;
            if (start.moved) this.savePos({ x: parseFloat(this.wrap.style.left), y: parseFloat(this.wrap.style.top) });
            else {
                this.pinned = !this.pinned;
                this.showCard(this.pinned);
            }
            start = null;
        });
    }

    showCard(on) {
        this.cardOpen = on;
        this.card.hidden = !on;
    }

    /**
     * @param {object} v - {off, noStep, cdAt, pillText, pillNow, cardStep, cardSub, warn, energy:{current,max}, happy:{current,max}, later:[string]}
     */
    update(v) {
        this.off = Boolean(v.off);
        this.applyHidden();
        if (this.off) return;
        const now = Date.now();
        const cdText = v.pillNow || (v.cdAt ? countdown(v.cdAt - now) : '');
        fill(this.pill, [h('span', { class: 'plate' }, [h('i')]), cdText ? h('span', { class: 'cd', 'data-cd': v.cdAt && !v.pillNow ? String(v.cdAt) : null, text: cdText }) : null, h('span', { text: v.pillText || 'Pumping Iron' })]);
        const bars = [];
        if (v.energy) bars.push(h('div', { class: 'mini' }, [h('span', { text: 'Energy' }), h('div', { class: 'bar' }, [h('i', { style: 'width:' + Math.min(100, (100 * v.energy.current) / Math.max(1, v.energy.max)) + '%;background:#efebe2' })]), h('span', { text: v.energy.current + ' / ' + v.energy.max })]));
        if (v.happy) bars.push(h('div', { class: 'mini' }, [h('span', { text: 'Happy' }), h('div', { class: 'bar' }, [h('i', { style: 'width:' + Math.min(100, (100 * v.happy.current) / Math.max(1, v.happy.max)) + '%;background:#9bdc8a' })]), h('span', { text: String(v.happy.current).replace(/\B(?=(\d{3})+(?!\d))/g, ',') })]));
        fill(this.card, [
            // A key problem has no next step: just the warning.
            v.noStep ? null : h('span', { class: 'lab', text: 'Next' }),
            v.noStep ? null : h('span', { class: 'big', 'data-cd': v.cdAt ? String(v.cdAt) : null, text: v.cdAt ? countdown(v.cdAt - now) : 'Now' }),
            h('span', { class: 'step', text: v.cardStep || '' }),
            v.cardSub ? h('span', { class: 'sub', text: v.cardSub }) : null,
            v.warn ? h('span', { class: 'warn', text: v.warn }) : null,
            ...bars,
            v.later && v.later.length ? h('div', { class: 'later' }, v.later.map((x) => h('span', { text: x }))) : null,
            h('button', { class: 'open', type: 'button', onclick: () => this.onOpen(), text: 'Open Pumping Iron' }),
        ]);
    }

    /** Every second: the countdowns only. */
    tick() {
        if (!this.shadow) return;
        const now = Date.now();
        for (const el of this.shadow.querySelectorAll('[data-cd]')) el.textContent = countdown(Number(el.getAttribute('data-cd')) - now);
    }
}
