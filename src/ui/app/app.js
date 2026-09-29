/*
 * The webpage: a full-page shadow host drawn over app.html's placeholder
 * (the trading app's traders-page pattern). Top bar with tabs and the
 * the status strip on Home and Plan, then the 70/30 body.
 * Countdowns tick every second without redrawing the page.
 */

import { h, t, fill } from '../dom.js';
import { APP_CSS } from '../styles.js';
import { countdown } from '../../core/bars.js';
import { clock, statusStrip } from './common.js';
import { renderHome } from './home.js';
import { renderPlan } from './plan.js';
import { renderBuy } from './buy.js';
import { renderProgress } from './progress.js';
import { renderSettings } from './settings.js';

export const APP_TABS = [
    ['home', 'Home'],
    ['plan', 'Plan'],
    ['buy', 'Buy'],
    ['progress', 'Progress'],
    ['eye', 'Torn Eye'],
    ['settings', 'Settings'],
];

const RENDERERS = { home: renderHome, plan: renderPlan, buy: renderBuy, progress: renderProgress, settings: renderSettings };

const FONT_URL = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&display=swap';

/** The warning while Torn Trading runs (Z-paused). */
export function pausedBanner(m, settings) {
    const at = m && m.ready ? m.state.at : null;
    return h('div', { class: 'warnb paused', role: 'status' }, [
        h('b', { text: '⚠ Paused: Torn Trading is running' }),
        h('p', {
            text:
                'No Torn calls while it runs' +
                (at ? ', so this is your plan as of ' + clock(at, settings) + ' and it keeps moving on the clock' : '') +
                '. Turn Torn Trading off (or close its Torn Bids tab) and Pumping Iron reads Torn again by itself within a minute; whatever changed meanwhile shows as one catch-up entry in Progress.',
        }),
    ]);
}

export class PiApp {
    /** @param {object} o - {getCtx: () => ctx, renderers: {tab: fn} (extra tabs, e.g. Torn Eye)} */
    constructor({ getCtx, renderers = {}, getUpdated = null }) {
        this.getCtx = getCtx;
        this.getUpdated = getUpdated;
        this.renderers = { ...RENDERERS, ...renderers };
        this.tab = this.tabFromHash();
        this.sig = '';
        this.ui = {};
    }

    tabFromHash() {
        const want = String((typeof location !== 'undefined' && location.hash) || '').replace(/^#\/?/, '').split(/[?&]/)[0];
        return APP_TABS.some(([id]) => id === want) ? want : 'home';
    }

    mount() {
        document.title = 'Pumping Iron';
        // Our own page (GitHub Pages): the display font may load here, never on torn.com.
        if (!document.querySelector('link[data-pi-font]')) document.head.appendChild(h('link', { rel: 'stylesheet', href: FONT_URL, 'data-pi-font': '1' }));
        for (const el of document.body.children) if (el.id !== 'pi-app') el.style.display = 'none';
        this.host = document.getElementById('pi-app') || h('div', { id: 'pi-app', style: 'position:fixed;inset:0;overflow:auto;z-index:1' });
        if (!this.host.parentNode) document.body.appendChild(this.host);
        document.body.style.margin = '0';
        document.body.style.background = '#141618';
        this.shadow = this.host.shadowRoot || this.host.attachShadow({ mode: 'open' });
        fill(this.shadow, [h('style', { text: APP_CSS }), (this.root = h('div', { class: 'pi-root' }))]);
        window.addEventListener('hashchange', () => this.go(this.tabFromHash(), false));
        setInterval(() => this.tick(), 1000);
    }

    go(tab, push = true) {
        if (!this.renderers[tab] && tab !== 'eye') return;
        this.tab = tab;
        if (push && location.hash !== '#' + tab) history.replaceState(null, '', '#' + tab);
        this.render(true);
        this.host.scrollTop = 0;
    }

    /** The box being typed in: which one (its label), what's in it and where the cursor is. */
    focusedInput() {
        const a = this.shadow && this.shadow.activeElement;
        if (!a || !(a.tagName === 'INPUT' || a.tagName === 'TEXTAREA') || a.type === 'checkbox' || a.type === 'file') return null;
        const key = a.getAttribute('aria-label') || a.getAttribute('placeholder') || a.getAttribute('name');
        if (!key) return null;
        let s = null;
        let e = null;
        try {
            s = a.selectionStart;
            e = a.selectionEnd;
        } catch {
            // Some input types have no selection.
        }
        return { key, value: a.value, s, e, masked: a.classList.contains('masked') };
    }

    restoreInput(k) {
        const el = [...this.root.querySelectorAll('input, textarea')].find((x) => (x.getAttribute('aria-label') || x.getAttribute('placeholder') || x.getAttribute('name')) === k.key);
        if (!el) return;
        el.value = k.value;
        el.focus();
        try {
            if (k.s !== null) el.setSelectionRange(k.s, k.e);
        } catch {
            // Not every input keeps a cursor.
        }
    }

    /** True while the user is typing in the page: a redraw would lose the cursor. */
    typing() {
        const a = this.shadow && this.shadow.activeElement;
        return Boolean(a && (a.tagName === 'INPUT' || a.tagName === 'SELECT' || a.tagName === 'TEXTAREA'));
    }

    render(force = false) {
        if (!this.root) return;
        const ctx = this.getCtx();
        this.lastTickCtx = ctx;
        ctx.ui = this.ui;
        ctx.go = (tab) => this.go(tab);
        ctx.rerender = () => this.render(true);
        const m = ctx.model;
        const sig = [this.tab, m && m.ready ? m.state.at : 'x', ctx.sig || '', JSON.stringify(this.ui), ctx.paused ? 'paused' : ''].join('|');
        if (!force && (sig === this.sig || this.typing())) return;
        this.sig = sig;
        const s = ctx.settings;
        const app = h('div', { class: 'app' });
        app.appendChild(this.topBar(ctx, m));
        // Taking turns with Torn Trading: say so on top; the plan below keeps moving on the clock from the last read.
        if (ctx.paused) app.appendChild(pausedBanner(m, s));
        let tab = this.tab;
        if (!m || !m.ready) {
            // No state yet: keys first. Settings always opens, so a key can always be replaced.
            // Stay there once a key is saved, so its message (e.g. "this key won't work") is read, not swapped for Home.
            if (!ctx.flags.hasKey || ctx.flags.keyDead) tab = this.tab = 'settings';
            else if (tab !== 'settings' && ctx.paused) {
                fill(this.root, [app]);
                return;
            } else if (tab !== 'settings') {
                const p = ctx.keyProblem;
                app.appendChild(
                    p
                        ? h('div', { class: 'empty' }, [h('div', { class: 'warnb' }, [h('b', { text: p.title }), h('p', { text: p.text }), h('div', { class: 'acts' }, [h('button', { class: 'btn primary sm', type: 'button', onclick: () => this.go('settings'), text: 'Open Settings' })])])])
                        : h('div', { class: 'empty' }, [h('h2', { text: 'Reading your state…' }), h('p', { text: 'One call to Torn for your bars, cooldowns, stats and gym. It shows here in a few seconds.' })]),
                );
                fill(this.root, [app]);
                return;
            }
        }
        const fn = this.renderers[tab] || this.renderers.home;
        let out;
        try {
            out = fn(m && m.ready ? m : { ready: false, now: Date.now(), statRows: [], steps: [], heads: [] }, ctx);
        } catch (error) {
            out = { main: [h('div', { class: 'warnb' }, [h('b', { text: 'This tab hit a problem' }), h('p', { text: String((error && error.message) || error) })])], pane: [] };
        }
        // A page's control bars (the inputs that drive every number on it), then the status strip where the page wants it.
        for (const bar of out.ctl || []) if (bar && bar.length) app.appendChild(h('div', { class: 'ctl num' }, bar));
        if (out.strip && m && m.ready) app.appendChild(statusStrip(m, s));
        this.updText = out.upd || null;
        app.appendChild(h('div', { class: 'body' }, [h('div', { class: 'main' }, out.main || []), h('div', { class: 'pane' }, out.pane || [])]));
        // A background redraw (prices, Torn Eye, the war read) never takes what you're typing: the box, its text and the cursor come back.
        const keep = this.focusedInput();
        fill(this.root, [app]);
        if (keep) this.restoreInput(keep);
        this.tick();
    }

    topBar(ctx = null, m = null) {
        // Buy shows how many things to buy today; Settings a dot when the key needs you.
        const buyN = m && m.ready ? (m.buyToday || []).filter((n) => n.buy > 0).length : 0;
        const badge = (id) => (id === 'buy' && buyN ? h('span', { class: 'n', text: String(buyN) }) : id === 'settings' && ctx && ctx.keyProblem ? h('span', { class: 'dotw', 'aria-label': 'needs you' }) : null);
        const tabs = APP_TABS.filter(([id]) => this.renderers[id]).map(([id, label]) => h('a', { class: 'tab' + (id === this.tab ? ' on' : ''), href: '#' + id, onclick: (e) => { e.preventDefault(); this.go(id); } }, [label, badge(id)]));
        this.clockEl = h('span', { class: 'upd num' }, [h('i'), (this.clockText = t('', ''))]);
        return h('div', { class: 'top' }, [
            h('div', { class: 'mark' }, [h('i')]),
            h('span', { class: 'brand', text: 'Pumping Iron' }),
            ...tabs,
            h('div', { class: 'grow' }),
            this.clockEl,
        ]);
    }

    /** Every second: countdowns and the clock, without a redraw. */
    tick() {
        if (!this.root) return;
        const now = Date.now();
        const ctx = this.lastTickCtx || null;
        for (const el of this.root.querySelectorAll('[data-cd]')) {
            const at = Number(el.getAttribute('data-cd'));
            el.textContent = (el.getAttribute('data-cd-prefix') || '') + countdown(at - now);
        }
        if (this.clockText) {
            const st = this.getUpdated ? this.getUpdated() : null;
            const settings = (ctx && ctx.settings) || null;
            const ago = st ? Math.max(0, Math.round((now - st) / 1000)) : null;
            if (ctx && ctx.paused) {
                this.clockText.textContent = 'Paused' + (st ? ' · last read ' + clock(st, settings) : '');
                return;
            }
            if (this.updText) {
                this.clockText.textContent = clock(now, settings) + (settings && settings.timeFormat === 'local' ? ' local' : ' Torn time') + ' · ' + this.updText;
                return;
            }
            this.clockText.textContent = clock(now, settings) + (settings && settings.timeFormat === 'local' ? ' local' : ' Torn time') + (ago !== null ? ' · updated ' + (ago < 90 ? ago + 's' : Math.round(ago / 60) + ' min') + ' ago' : '');
        }
    }
}
