/*
 * The webpage: a full-page shadow host drawn over app.html's placeholder
 * (the trading app's traders-page pattern). Top bar with tabs and the
 * density switch, the status strip on Home and Plan, then the 70/30 body.
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
        const sig = [this.tab, m && m.ready ? m.state.at : 'x', ctx.sig || '', JSON.stringify(this.ui)].join('|');
        if (!force && (sig === this.sig || this.typing())) return;
        this.sig = sig;
        const s = ctx.settings;
        const app = h('div', { class: 'app' + (s.density === 'comfy' ? ' comfy' : '') });
        app.appendChild(this.topBar(ctx));
        let tab = this.tab;
        if (!m || !m.ready) {
            // No state yet: keys first.
            if (!ctx.flags.hasKey || ctx.flags.keyDead) tab = 'settings';
            else {
                app.appendChild(h('div', { class: 'empty' }, [h('h2', { text: 'Reading your state…' }), h('p', { text: 'One call to Torn for your bars, cooldowns, stats and gym. It shows here in a few seconds.' })]));
                fill(this.root, [app]);
                return;
            }
        }
        if ((tab === 'home' || tab === 'plan') && m && m.ready) app.appendChild(statusStrip(m, s));
        const fn = this.renderers[tab] || this.renderers.home;
        let out;
        try {
            out = fn(m && m.ready ? m : { ready: false, now: Date.now(), statRows: [], steps: [], heads: [] }, ctx);
        } catch (error) {
            out = { main: [h('div', { class: 'warnb' }, [h('b', { text: 'This tab hit a problem' }), h('p', { text: String((error && error.message) || error) })])], pane: [] };
        }
        app.appendChild(h('div', { class: 'body' }, [h('div', { class: 'main' }, out.main || []), h('div', { class: 'pane' }, out.pane || [])]));
        fill(this.root, [app]);
        this.tick();
    }

    topBar(ctx) {
        const s = ctx.settings;
        const tabs = APP_TABS.filter(([id]) => this.renderers[id]).map(([id, label]) => h('a', { class: 'tab' + (id === this.tab ? ' on' : ''), href: '#' + id, onclick: (e) => { e.preventDefault(); this.go(id); }, text: label }));
        this.clockEl = h('span', { class: 'upd num' }, [h('i'), (this.clockText = t('', ''))]);
        return h('div', { class: 'top' }, [
            h('div', { class: 'mark' }, [h('i')]),
            h('span', { class: 'brand', text: 'Pumping Iron' }),
            ...tabs,
            h('div', { class: 'grow' }),
            this.clockEl,
            h('div', { class: 'seg', role: 'group', 'aria-label': 'Spacing' }, [
                h('button', { type: 'button', 'aria-pressed': String(s.density !== 'comfy'), onclick: () => ctx.setSettings({ density: 'compact' }), text: 'Compact' }),
                h('button', { type: 'button', 'aria-pressed': String(s.density === 'comfy'), onclick: () => ctx.setSettings({ density: 'comfy' }), text: 'Comfortable' }),
            ]),
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
            this.clockText.textContent = clock(now, settings) + (settings && settings.timeFormat === 'local' ? ' local' : ' Torn time') + (ago !== null ? ' · updated ' + (ago < 90 ? ago + 's' : Math.round(ago / 60) + ' min') + ' ago' : '');
        }
    }
}
