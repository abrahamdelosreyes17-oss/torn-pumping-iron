/*
 * Torn Eye tab (mockups/O-torn-eye.html): targets from FFScouter ranked by
 * our own fight estimate (easy ↔ respect slider), the colour bands you set,
 * and where the numbers come from.
 */

import { h, t } from '../dom.js';
import { BAND_WORDS, BAND_COLORS, DEFAULT_BAND_LIMITS } from '../../core/eye/bands.js';
import { profileUrl, attackUrl } from '../../sources/route.js';
import { FFS_SITE_URL } from '../../api/ffscouter.js';
import { sectionHead, meta, headsList } from './common.js';

/** Rank targets: 0 = easiest first (win × HP kept), 1 = most respect you can still win. */
export function rankTargets(rows, slider) {
    const s = Math.max(0, Math.min(1, slider));
    const maxR = Math.max(1e-9, ...rows.map((r) => r.respect || 0));
    const score = (r) => {
        if (!r.forecast) return -1;
        const easy = r.forecast.pWin * (r.forecast.keep || 0);
        const resp = ((r.respect || 0) / maxR) * r.forecast.pWin;
        return (1 - s) * easy + s * resp;
    };
    return [...rows].sort((a, b) => score(b) - score(a));
}

function bandCell(band) {
    return h('span', { class: 'band', style: 'color:' + BAND_COLORS[band] }, [h('i', { class: 'dot' }), BAND_WORDS[band]]);
}

function ago(ts, now) {
    if (!ts) return '—';
    const d = Math.round((now - ts) / 86400000);
    return d < 1 ? 'today' : d + ' d';
}

export function renderEye(m, ctx) {
    const e = ctx.eye;
    const s = ctx.settings;
    const f = ctx.ui.eyeFilters || (ctx.ui.eyeFilters = { minLevel: 1, maxLevel: 100, inactive: true, factionless: false, hideCant: true, slider: 50 });
    const now = Date.now();
    const rowsAll = e.rows();
    const shown = rankTargets(rowsAll.filter((r) => !(f.hideCant && r.band === 'cant')), f.slider / 100);
    const hidden = rowsAll.filter((r) => f.hideCant && r.band === 'cant');
    const inputs = {};
    const refresh = () => {
        f.minLevel = Math.max(1, Math.min(100, Number(inputs.min.value) || 1));
        f.maxLevel = Math.max(f.minLevel, Math.min(100, Number(inputs.max.value) || 100));
        e.load({ minLevel: f.minLevel, maxLevel: f.maxLevel, inactiveOnly: f.inactive ? 1 : 0, factionless: f.factionless ? 1 : null });
    };
    const check = (label, key, reload) => h('label', { class: 'check' }, [h('input', { type: 'checkbox', checked: f[key], onchange: (ev) => { f[key] = ev.target.checked; if (reload) refresh(); else ctx.rerender(); } }), label]);
    const filters = h('div', { class: 'filters num' }, [
        h('label', { class: 'row' }, [t('lab', 'Level'), (inputs.min = h('input', { class: 'inp', inputmode: 'numeric', value: String(f.minLevel), 'aria-label': 'Lowest level', onchange: refresh })), '–', (inputs.max = h('input', { class: 'inp', inputmode: 'numeric', value: String(f.maxLevel), 'aria-label': 'Highest level', onchange: refresh }))]),
        check('Inactive 14+ days', 'inactive', true),
        check('No faction', 'factionless', true),
        check('Hide Can’t win', 'hideCant', false),
        h('span', { class: 'grow' }),
        h('label', { class: 'slider' }, ['Easy ', h('input', { type: 'range', min: '0', max: '100', value: String(f.slider), 'aria-label': 'Easy to respect', onchange: (ev) => { f.slider = Number(ev.target.value); ctx.rerender(); } }), ' Respect']),
    ]);
    let table;
    if (!ctx.flags.hasFfs) {
        table = h('p', { class: 'muted', style: 'margin:0' }, ['Targets come from FFScouter. ', h('a', { href: '#settings', onclick: (ev) => { ev.preventDefault(); ctx.go('settings'); }, text: 'Connect it in Settings' }), '; chips on Torn’s pages work without it (your fights and public stats).']);
    } else {
        const body = shown.map((r) =>
            h('tr', {}, [
                h('td', {}, [h('a', { href: profileUrl(r.id), target: '_blank', rel: 'noopener', text: r.name || String(r.id) })]),
                h('td', { class: 'r', text: r.level ? String(r.level) : '—' }),
                h('td', {}, [bandCell(r.band)]),
                h('td', { class: 'r', text: r.forecast ? Math.round(r.forecast.pWin * 100) + '%' : '—' }),
                h('td', { class: 'r', text: r.forecast && r.forecast.keep !== null ? (r.est && r.est.confidence === 'exact' ? '' : '~') + Math.round(r.forecast.keep * 100) + '%' : '—' }),
                h('td', { class: 'r' }, [h('b', { class: 'w', text: r.respect ? r.respect.toFixed(2) : '—' })]),
                h('td', { class: r.hospitalUntil && r.hospitalUntil > now ? 'sthos' : 'stok', text: r.hospitalUntil && r.hospitalUntil > now ? 'Hospital · ' + Math.ceil((r.hospitalUntil - now) / 60000) + ' min' : 'Okay' }),
                h('td', { class: 'r muted', text: ago(r.lastAction, now) }),
                h('td', { class: 'r' }, [h('a', { class: 'btn sm', href: attackUrl(r.id), target: '_blank', rel: 'noopener', text: 'Attack' })]),
            ]),
        );
        table = h('table', { class: 'tbl num' }, [
            h('thead', {}, [h('tr', {}, ['Player', 'Level', 'Band', 'Win', 'HP kept', 'Respect', 'Status', 'Last active', ''].map((x, i) => h('th', { class: [1, 3, 4, 5, 7].includes(i) ? 'r' : null, text: x })))]),
            h('tbody', {}, body.length ? body : [h('tr', {}, [h('td', { colspan: '9', class: 'muted', text: e.loading() ? 'Asking FFScouter for targets…' : e.error() || 'No targets yet: press Refresh.' })])]),
            h('tfoot', {}, [h('tr', {}, [h('td', { colspan: '9' }, [hidden.length ? 'Hidden: ' + hidden.length + ' Can’t win · ' : '', 'Targets from ', h('a', { href: FFS_SITE_URL, target: '_blank', rel: 'noopener', text: 'FFScouter' }), ', ranked by our fight estimate · "~" means an estimate, not a spy'])])]),
        ]);
    }
    const main = [h('div', {}, [sectionHead('Targets', meta([rowsAll.length + ' players · win and HP kept from your stats against theirs']), ctx.flags.hasFfs ? h('button', { class: 'btn sm', type: 'button', onclick: refresh, text: 'Refresh' }) : null), filters, table])];

    const limits = { ...DEFAULT_BAND_LIMITS, ...(s.bands || {}) };
    const bandInput = (band, key) => h('input', { class: 'inp', inputmode: 'numeric', value: String(limits[band][key]), 'aria-label': BAND_WORDS[band] + ' ' + key, onchange: (ev) => { const v = Math.max(0, Math.min(100, Number(ev.target.value) || 0)); ctx.setSettings({ bands: { ...limits, [band]: { ...limits[band], [key]: v } } }); } });
    const src = e.sources();
    const pane = [
        h('div', {}, [
            sectionHead('Colours', meta(['where each band starts'])),
            h('div', { class: 'bands num' }, [
                h('div', { class: 'bandr' }, [bandCell('stomp'), h('span', { class: 'row' }, ['win ', bandInput('stomp', 'win'), ' % · keep ', bandInput('stomp', 'keep'), ' %'])]),
                h('div', { class: 'bandr' }, [bandCell('good'), h('span', { class: 'row' }, ['win ', bandInput('good', 'win'), ' % · keep ', bandInput('good', 'keep'), ' %'])]),
                h('div', { class: 'bandr' }, [bandCell('tough'), h('span', { class: 'row' }, ['win ', bandInput('tough', 'win'), ' %'])]),
                h('div', { class: 'bandr' }, [bandCell('cant'), h('span', { class: 'muted', text: 'everything below' })]),
                h('div', { class: 'bandr' }, [bandCell('none'), h('span', { class: 'muted', text: 'no estimate yet' })]),
            ]),
        ]),
        h('div', {}, [
            sectionHead('Sources', meta(['best first']), null, 'h3'),
            headsList([
                { tone: ctx.flags.hasTs ? 'good' : 'plain', text: 'TornStats spies', sub: ctx.flags.hasTs ? 'connected' : 'optional · add a key in Settings' },
                { tone: src.fights ? 'good' : 'plain', text: 'Your fights', sub: src.fights + ' attacks read' },
                { tone: ctx.flags.hasFfs ? 'good' : 'plain', text: 'FFScouter', sub: ctx.flags.hasFfs ? 'connected · ' + src.ffsFree + ' of 60 a minute free' : 'not connected' },
                { tone: 'plain', text: 'Public stats', sub: 'always on, labelled rough' },
            ]),
        ]),
        h('div', {}, [sectionHead('Gear seen', null, null, 'h3'), h('dl', { class: 'kv num' }, [h('dt', { text: 'Players with gear' }), h('dd', { text: String(src.gear) }), h('dt', { text: 'Stored' }), h('dd', { text: 'on this computer only' })])]),
    ];
    return { main, pane };
}
