/*
 * Torn Eye tab (mockups/round3/W-eye.html): one question, "who can I hit?".
 * Three modes: Targets (FFScouter's list ranked by our own fight estimate),
 * Chain (only Stomp and Good, most respect first, always) and War (everyone
 * in the enemy faction, coloured by risk: attackable now first, then who's
 * out of hospital soonest; travellers with where they're going and an
 * estimated landing). Sorts and tick filters in every mode; the colour
 * bands live in Settings.
 */

import { h, t } from '../dom.js';
import { BAND_WORDS, BAND_COLORS, BAND_ORDER } from '../../core/eye/bands.js';
import { memberState, sortWar, warSummary, travelOf, landingAt } from '../../core/eye/war.js';
import { profileUrl, attackUrl } from '../../sources/route.js';
import { FFS_SITE_URL } from '../../api/ffscouter.js';
import { tornDayStart, countdown } from '../../core/bars.js';
import { fmtInt, fmtShort } from '../../core/format.js';
import { clock, sectionHead, meta } from './common.js';

export const EYE_SORTS = [
    ['easy', 'Easiest'],
    ['respect', 'Most respect'],
    ['keep', 'HP kept'],
    ['level', 'Level'],
    ['active', 'Last active'],
];

export const EYE_TICKS = [
    ['hideCant', 'Hide can’t win'],
    ['stompOnly', 'Stomp only'],
    ['keep50', 'Keep over 50% HP'],
    ['hideHosp', 'Hide hospital'],
    ['hideTravel', 'Hide traveling'],
    ['inactive', 'Inactive 14+ days'],
    ['factionless', 'No faction'],
    ['notToday', 'Not attacked by me today'],
    // War shows everyone by default (owner): its own ticks, all off.
    ['warHideCant', 'Hide can’t win'],
    ['warHideHosp', 'Hide hospital'],
    ['warHideTravel', 'Hide traveling'],
];

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

/** Sort by the chosen key (unknown estimates last). */
export function sortTargets(rows, key) {
    const val = {
        easy: (r) => (r.forecast ? r.forecast.pWin * (r.forecast.keep || 0) : -1),
        respect: (r) => (r.forecast && r.forecast.pWin >= 0.5 ? r.respect || 0 : -1),
        keep: (r) => (r.forecast ? r.forecast.keep || 0 : -1),
        level: (r) => -(r.level || 999),
        active: (r) => -(r.lastAction || Infinity),
    }[key] || ((r) => (r.forecast ? r.forecast.pWin : -1));
    return [...rows].sort((a, b) => val(b) - val(a));
}

function stateOf(r, now) {
    const st = r.status || {};
    const s = String(st.state || st.description || '').toLowerCase();
    if ((r.hospitalUntil && r.hospitalUntil > now) || s.includes('hospital')) return 'hospital';
    if (s.includes('travel') || s.includes('abroad') || s.startsWith('in ')) return 'travel';
    return 'okay';
}

/** Apply the ticks. */
export function filterTargets(rows, f, { now, attackedToday = new Set() } = {}) {
    return rows.filter((r) => {
        if (f.hideCant && r.band === 'cant') return false;
        if (f.stompOnly && r.band !== 'stomp') return false;
        if (f.keep50 && !(r.forecast && r.forecast.keep > 0.5)) return false;
        const st = stateOf(r, now);
        if (f.hideHosp && st === 'hospital') return false;
        if (f.hideTravel && st === 'travel') return false;
        if (f.notToday && attackedToday.has(Number(r.id))) return false;
        return true;
    });
}

function bandCell(band) {
    return h('span', { class: 'band2' }, [h('i', { style: 'background:' + BAND_COLORS[band] }), BAND_WORDS[band]]);
}

function ago(ts, now) {
    if (!ts) return '—';
    const d = Math.round((now - ts) / 86400000);
    return d < 1 ? 'today' : d + ' d';
}

function statusCell(r, now) {
    if (r.hospitalUntil && r.hospitalUntil > now) return h('td', { class: 'cdn', text: 'Hospital ' + countdown(r.hospitalUntil - now) });
    const st = r.status || {};
    const d = st.description || st.state;
    if (d && !/^okay$/i.test(d)) return h('td', { class: /hospital/i.test(d) ? 'cdn' : null, text: d });
    return h('td', { text: 'Okay' });
}

function pct(x) {
    return x === null || x === undefined ? '—' : Math.round(x * 100) + '%';
}

function attackBtn(id, primary, ghost) {
    return h('a', { class: 'btn sm' + (primary ? ' primary' : ghost ? ' ghost' : ''), href: attackUrl(id), target: '_blank', rel: 'noopener', text: 'Attack' });
}

function sourceShort(r, now) {
    const e = r.est;
    if (!e) return 'no estimate yet';
    const s = String(e.sourceText || e.source || '');
    const when = e.at ? ' · ' + ago(e.at, now) : '';
    if (/spy/i.test(s)) return 'spy' + when;
    if (/fight/i.test(s)) return 'your fight' + when;
    if (/ffscouter/i.test(s)) return 'FFScouter' + when;
    if (/public|rank/i.test(s)) return 'public stats · rough';
    return s.slice(0, 30);
}

function targetsTable(rows, { now, chain = false }) {
    const head = chain
        ? ['Band', 'Player', 'Lvl', 'Respect', 'Win', 'HP kept', 'Status', 'Active', '']
        : ['Band', 'Player', 'Lvl', 'Win', 'HP kept', 'Respect', 'Status', 'Active', 'Estimate from', ''];
    const right = chain ? [2, 3, 4, 5, 7] : [2, 3, 4, 5, 7];
    const body = rows.map((r, i) => {
        const win = h('td', { class: 'r', text: r.forecast ? pct(r.forecast.pWin) : '—' });
        const keep = h('td', { class: 'r', text: r.forecast && r.forecast.keep !== null ? (r.est && r.est.confidence === 'exact' ? '' : '~') + pct(r.forecast.keep) : '—' });
        const resp = h('td', { class: 'r' }, [chain ? h('b', { class: 'white', text: r.respect ? r.respect.toFixed(2) : '—' }) : r.respect ? r.respect.toFixed(2) : '—']);
        const cells = [h('td', {}, [bandCell(r.band)]), h('td', {}, [h('a', { href: profileUrl(r.id), target: '_blank', rel: 'noopener' }, [h('b', { class: 'w', text: r.name || String(r.id) })])]), h('td', { class: 'r', text: r.level ? String(r.level) : '—' })];
        if (chain) cells.push(resp, win, keep);
        else cells.push(win, keep, resp);
        cells.push(statusCell(r, now), h('td', { class: 'r muted', text: ago(r.lastAction, now) }));
        if (!chain) cells.push(h('td', { class: 'muted', text: sourceShort(r, now) }));
        cells.push(h('td', { class: 'r' }, [attackBtn(r.id, i === 0, r.band === 'cant')]));
        return h('tr', {}, cells);
    });
    return h('table', { class: 'tbl num' }, [
        h('thead', {}, [h('tr', {}, head.map((x, i) => h('th', { class: right.includes(i) ? 'r' : null, style: i === 0 ? 'width:110px' : null, text: x })))]),
        h('tbody', {}, body),
    ]);
}

function warTable(rows, { now, seen }) {
    const nowS = Math.floor(now / 1000);
    const body = rows.map((w, i) => {
        const r = w.view || { band: 'none' };
        const m = w.m;
        let status;
        if (w.state === 'okay' || w.state === 'early') status = h('td', { class: 'c-good', text: w.state === 'early' ? 'Out early · attack now' : 'Okay · attack now' });
        else if (w.state === 'hospital') status = h('td', { class: 'cdn', text: 'Hospital · out in ' + countdown(Math.max(0, (w.until - nowS) * 1000)) });
        else if (w.state === 'traveling' || w.state === 'abroad') {
            const tr = travelOf(m);
            const land = landingAt(tr, seen.get(w.id), now);
            status = h('td', {}, [
                tr ? (tr.kind === 'abroad' ? 'In ' + tr.place + (land ? ' · back ~' + clock(land) + ' if they fly now' : '') : (tr.kind === 'back' ? 'Returning from ' + tr.place : 'Traveling → ' + tr.place) + (land ? ' · lands ~' + clock(land) : '')) : (m.status && m.status.description) || 'Traveling',
                land ? h('span', { class: 'muted', text: ' (estimate)' }) : null,
            ]);
        } else status = h('td', { class: 'muted', text: (m.status && m.status.description) || w.state });
        const attackable = w.state === 'okay' || w.state === 'early';
        return h('tr', {}, [
            h('td', {}, [bandCell(r.band || 'none')]),
            h('td', {}, [h('a', { href: profileUrl(w.id), target: '_blank', rel: 'noopener' }, [h('b', { class: 'w', text: m.name || String(w.id) })])]),
            h('td', { class: 'r', text: m.level ? String(m.level) : '—' }),
            h('td', { class: 'r', text: r.forecast ? pct(r.forecast.pWin) : '—' }),
            h('td', { class: 'r', text: r.forecast && r.forecast.keep !== null ? pct(r.forecast.keep) : '—' }),
            h('td', { class: 'r', text: r.respect ? r.respect.toFixed(2) : '—' }),
            status,
            h('td', { class: 'r' }, [attackable || w.state === 'hospital' ? attackBtn(w.id, i === 0 && attackable, r.band === 'cant') : null]),
        ]);
    });
    return h('table', { class: 'tbl num' }, [
        h('thead', {}, [h('tr', {}, ['Band', 'Player', 'Lvl', 'Win', 'HP kept', 'Respect', 'Status', ''].map((x, i) => h('th', { class: [2, 3, 4, 5].includes(i) ? 'r' : null, style: i === 0 ? 'width:110px' : i === 6 ? 'width:300px' : null, text: x })))]),
        h('tbody', {}, body),
    ]);
}

export function renderEye(m, ctx) {
    const e = ctx.eye;
    const now = Date.now();
    const ui = ctx.ui;
    const mode = ui.eyeMode || 'targets';
    const f = ui.eyeFilters || (ui.eyeFilters = { minLevel: 1, maxLevel: 100, inactive: true, factionless: false, hideCant: true, stompOnly: false, keep50: false, hideHosp: false, hideTravel: false, notToday: false, sort: 'easy' });
    const inputs = {};
    const reload = () => {
        f.minLevel = Math.max(1, Math.min(100, Number(inputs.min && inputs.min.value) || f.minLevel || 1));
        f.maxLevel = Math.max(f.minLevel, Math.min(100, Number(inputs.max && inputs.max.value) || f.maxLevel || 100));
        e.load({ minLevel: f.minLevel, maxLevel: f.maxLevel, inactiveOnly: f.inactive ? 1 : 0, factionless: f.factionless ? 1 : null });
    };
    const attacks = e.attacks ? e.attacks() : [];
    const today = tornDayStart(now);
    const attackedToday = new Set(attacks.filter((a) => (a.ended || 0) * 1000 >= today).map((a) => Number(a.def)));

    // Controls
    const modeSeg = h('div', { class: 'seg modes', role: 'group', 'aria-label': 'Mode' }, [['targets', 'Targets'], ['chain', 'Chain'], ['war', 'War']].map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(k === mode), onclick: () => { ui.eyeMode = k; ctx.rerender(); }, text: label })));
    const bar1 = [modeSeg];
    if (mode === 'war') {
        const w = e.war ? e.war.state() : {};
        let fidIn;
        bar1.push(
            t('lab', 'Enemy faction'),
            (fidIn = h('input', { class: 'inp num', inputmode: 'numeric', style: 'width:90px', placeholder: 'faction id', 'aria-label': 'Enemy faction id', value: w.fid ? String(w.fid) : '' })),
            h('button', { class: 'btn sm', type: 'button', onclick: () => { const v = Number(String(fidIn.value).replace(/\D/g, '')); if (v && e.war) e.war.watch(v); }, text: w.fid ? 'Watch this one' : 'Watch' }),
            w.fid ? h('span', { class: 'muted', text: 'Watching ' + (w.name || 'faction ' + w.fid) + ' · read every 10 s while open' }) : null,
        );
    }
    bar1.push(h('span', { class: 'sep' }), t('lab', 'Sort'));
    if (mode === 'chain') bar1.push(h('span', { class: 'muted', text: 'most respect first, always' }));
    else if (mode === 'war') bar1.push(h('span', { class: 'muted', text: 'attackable now first, then out of hospital soonest' }));
    else bar1.push(h('div', { class: 'seg', role: 'group', 'aria-label': 'Sort' }, EYE_SORTS.map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(k === f.sort), onclick: () => { f.sort = k; ctx.rerender(); }, text: label }))));
    if (mode !== 'war') {
        bar1.push(h('span', { class: 'sep' }), t('lab', 'Level'), (inputs.min = h('input', { class: 'inp num', inputmode: 'numeric', style: 'width:44px', 'aria-label': 'Lowest level', value: String(f.minLevel), onchange: reload })), '–', (inputs.max = h('input', { class: 'inp num', inputmode: 'numeric', style: 'width:50px', 'aria-label': 'Highest level', value: String(f.maxLevel), onchange: reload })));
        if (ctx.flags.hasFfs) bar1.push(h('button', { class: 'btn sm', type: 'button', onclick: reload, text: e.loading() ? 'Loading…' : 'Refresh' }));
    }
    const tickKeys = mode === 'war' ? ['warHideCant', 'warHideHosp', 'warHideTravel'] : mode === 'chain' ? ['stompOnly', 'keep50', 'hideHosp', 'hideTravel', 'inactive', 'factionless', 'notToday'] : EYE_TICKS.map(([k]) => k).filter((k) => !k.startsWith('war'));
    const refetch = new Set(['inactive', 'factionless']);
    const bar2 = [
        t('lab', 'Show'),
        h('div', { class: 'ticks', role: 'group', 'aria-label': 'Show' }, EYE_TICKS.filter(([k]) => tickKeys.includes(k)).map(([k, label]) => h('button', { type: 'button', class: 'tk', 'aria-pressed': String(Boolean(f[k])), onclick: () => { f[k] = !f[k]; if (refetch.has(k) && ctx.flags.hasFfs) reload(); else ctx.rerender(); } }, [h('i'), label]))),
    ];

    const main = [];
    const pane = [];
    const rowsAll = e.rows();
    // First visit with FFScouter connected: load the targets without a click.
    if (mode !== 'war' && ctx.flags.hasFfs && !rowsAll.length && !e.loading() && !e.error() && !ui.eyeAutoLoaded) {
        ui.eyeAutoLoaded = true;
        setTimeout(reload, 0);
    }

    if (mode === 'war') {
        const w = e.war ? e.war.state() : { members: [] };
        const views = new Map((w.members || []).map((mm) => [Number(mm.id), e.view(Number(mm.id), { level: mm.level, name: mm.name }, { war: true })]));
        const bands = {};
        const respect = {};
        for (const [id, v] of views) {
            if (v) {
                bands[id] = v.band;
                respect[id] = v.respect || 0;
            }
        }
        let rows = sortWar(w.members || [], { bands, respect, early: w.early || new Set(), nowS: Math.floor(now / 1000) }).map((r) => ({ ...r, view: views.get(r.id) }));
        rows = rows.filter((r) => r.state !== 'fallen' && !(f.warHideCant && r.band === 'cant') && !(f.warHideHosp && r.state === 'hospital') && !(f.warHideTravel && (r.state === 'traveling' || r.state === 'abroad')));
        const sum = warSummary(rows, Math.floor(now / 1000));
        main.push(
            h('div', { class: 'lead', 'data-mode': 'war' }, [
                sectionHead('War' + (w.name ? ' · ' + w.name : ''), meta(['everyone, coloured by how the fight goes for you · attackable now first, then who’s out soonest'])),
                w.fid ? (rows.length ? warTable(rows, { now, seen: w.seen || new Map() }) : h('p', { class: 'muted', style: 'margin:0', text: w.loading ? 'Reading the faction…' : w.error || 'No members to show.' })) : h('p', { class: 'muted', style: 'margin:0', text: 'Type the enemy faction’s id and press Watch. On Torn’s own war page the chips and the order show by themselves.' }),
                h('div', { class: 'note2', text: 'War shows everyone, even barely beatable: the colour tells you the risk. Landing times are estimated from when we saw them leave and the standard flight time.' }),
            ]),
        );
        const outs = rows.filter((r) => r.state === 'hospital').slice(0, 5);
        pane.push(
            h('div', {}, [
                sectionHead('Next out of hospital', null, null, 'h3'),
                outs.length ? h('dl', { class: 'facts num' }, outs.flatMap((r) => [h('dt', { text: countdown(Math.max(0, r.until * 1000 - now)) }), h('dd', { text: (r.m.name || r.id) + ' · ' + BAND_WORDS[r.band || 'none'] })])) : h('p', { class: 'muted', style: 'margin:0', text: 'Nobody in hospital.' }),
                h('div', { class: 'note2', text: sum.attackable + ' attackable now · ' + rows.filter((r) => r.state === 'hospital' && r.until * 1000 - now < 5 * 60000).length + ' out within 5 min · ' + (sum.traveling + rows.filter((r) => r.state === 'abroad').length) + ' traveling or abroad' }),
            ]),
        );
    } else {
        let rows = filterTargets(rowsAll, f, { now, attackedToday });
        const hiddenCant = f.hideCant ? rowsAll.filter((r) => r.band === 'cant').length : 0;
        const hiddenKeep = f.keep50 ? rowsAll.filter((r) => r.band !== 'cant' && !(r.forecast && r.forecast.keep > 0.5)).length : 0;
        if (mode === 'chain') {
            rows = rows.filter((r) => r.band === 'stomp' || r.band === 'good').sort((a, b) => (b.respect || 0) - (a.respect || 0));
        } else rows = sortTargets(rows, f.sort);
        let body;
        if (!ctx.flags.hasFfs) body = h('p', { class: 'muted', style: 'margin:0' }, ['Targets come from FFScouter. ', h('a', { href: '#settings', onclick: (ev) => { ev.preventDefault(); ctx.go('settings'); }, text: 'Connect it in Settings' }), '; chips on Torn’s pages work without it (your fights and public stats).']);
        else if (!rows.length) body = h('p', { class: 'muted', style: 'margin:0', text: e.loading() ? 'Asking FFScouter for targets…' : e.error() || (rowsAll.length ? 'Nobody passes your ticks.' : 'No targets yet: press Refresh.') });
        else body = targetsTable(rows, { now, chain: mode === 'chain' });
        const notes = [];
        if (hiddenCant && mode === 'targets') notes.push(hiddenCant + ' can’t-win player' + (hiddenCant === 1 ? '' : 's') + ' hidden');
        if (hiddenKeep) notes.push(hiddenKeep + ' hidden because you’d keep under 50% HP');
        main.push(
            h('div', { class: 'lead', 'data-mode': mode }, [
                sectionHead(mode === 'chain' ? 'Chain' : 'Targets', meta([mode === 'chain' ? 'only Stomp and Good · most respect first · ' + rows.length + ' players' : rowsAll.length + ' players · win and HP kept from your stats against theirs · ' + (EYE_SORTS.find(([k]) => k === f.sort) || [0, ''])[1].toLowerCase() + ' first'])),
                body,
                notes.length ? h('div', { class: 'note2', text: notes.join(' · ') + '.' }) : null,
                mode === 'chain' ? h('div', { class: 'note2', text: 'Chains only list players you’ll beat (green and light green); Tough and Can’t win never show here.' }) : null,
            ]),
        );
    }

    const src = e.sources();
    pane.push(
        h('div', {}, [
            sectionHead('How sure', meta(['best source first']), null, 'h3'),
            h('dl', { class: 'facts num' }, [
                h('dt', { text: 'Faction spies (TornStats)' }),
                h('dd', { text: ctx.flags.hasTs ? 'connected' : 'add a key in Settings' }),
                h('dt', { text: 'Your own fights' }),
                h('dd', { text: fmtInt(src.fights) + ' attacks read' }),
                h('dt', { text: 'FFScouter estimates' }),
                h('dd', { text: ctx.flags.hasFfs ? src.ffsFree + ' of 60 left this min' : 'not connected' }),
                h('dt', { text: 'Public stats (rough)' }),
                h('dd', { text: 'always on' }),
                h('dt', { text: 'Gear seen' }),
                h('dd', { text: fmtInt(src.gear) + ' players · this computer only' }),
            ]),
            h('div', { class: 'note2' }, ['Estimates by ', h('a', { href: FFS_SITE_URL, target: '_blank', rel: 'noopener', text: 'FFScouter' }), '. Colours: Settings › Torn Eye colours.']),
        ]),
    );
    if (m && m.ready) {
        const mods = m.state.statMods || {};
        const eff = Object.entries(m.pc.stats).reduce((a, [k, v]) => a + v * (1 + (mods[k] || 0) / 100), 0);
        pane.push(h('div', {}, [sectionHead('Your side', meta(['what the fight uses']), null, 'h3'), h('dl', { class: 'facts num' }, [h('dt', { text: 'Stats as they fight' }), h('dd', { text: fmtShort(eff) + ' (merits and passives in)' }), h('dt', { text: 'Life' }), h('dd', { text: m.state.life ? fmtInt(m.state.life.maximum) : '—' })])]));
    }
    const upd = e.updatedAt && e.updatedAt() ? 'targets ' + Math.max(0, Math.round((now - e.updatedAt()) / 60000)) + ' min ago' : null;
    return { ctl: [bar1, bar2], main, pane, upd };
}

void BAND_ORDER;
void memberState;
