/*
 * Torn Eye tab (mockups/round3/W-eye.html): one question, "who can I hit?".
 * Four modes: Targets (FFScouter's list judged by our own fight model:
 * only players you beat are ever kept, most respect first), Chain (only
 * Stomp and Good, most respect first, always), War (everyone in the enemy
 * faction, found by itself from your faction's wars, coloured by risk:
 * online status, hospital out-times, landings, jail) and Watched (the
 * players you chose to keep an eye on). Sorts and tick filters per mode;
 * the colour bands live in Settings.
 */

import { h, t } from '../dom.js';
import { BAND_WORDS, BAND_COLORS } from '../../core/eye/bands.js';
import { sortWar, warSummary, statusParts, activityOf, ACTIVITY_COLORS, ACTIVITY_WORDS, WAR_KIND_WORDS } from '../../core/eye/war.js';
import { TARGET_FF, needsRefetch, targetDetails, targetsMessage, isBeatable, OLD_ESTIMATE_DAYS } from '../../core/eye/targets.js';
import { WATCH_TAGS, WATCH_MAX, TAG_MAX, headsUps } from '../../core/eye/watch.js';
import { profileUrl, attackUrl } from '../../sources/route.js';
import { FFS_SITE_URL } from '../../api/ffscouter.js';
import { tornDayStart, countdown } from '../../core/bars.js';
import { fmtInt, fmtShort } from '../../core/format.js';
import { clock, cd, sectionHead, meta } from './common.js';

export const EYE_MODES = [
    ['targets', 'Targets'],
    ['chain', 'Chain'],
    ['war', 'War'],
    ['watched', 'Watched'],
];

export const EYE_SORTS = [
    ['respect', 'Most respect'],
    ['easy', 'Easiest'],
    ['keep', 'HP kept'],
    ['level', 'Level'],
    ['active', 'Last active'],
];

/** Targets and Chain hold only players you beat (owner's hard rule), so there is no "Hide can't win" there. */
export const EYE_TICKS = [
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

export const DEFAULT_EYE_FILTERS = { minLevel: 1, maxLevel: 100, inactive: true, factionless: false, stompOnly: false, keep50: false, hideHosp: false, hideTravel: false, notToday: false, sort: 'respect' };

/**
 * Load the targets without a click: the first visit with FFScouter connected,
 * and once for a list asked the old way (1.1.x: one ask, strongest first,
 * can't-win players kept; 1.1.0 even without a fair-fight range).
 */
export function shouldAutoLoad({ mode, hasFfs, paused, stored, loading, error, autoLoaded, ready = true }) {
    return ready && (mode === 'targets' || mode === 'chain') && Boolean(hasFfs) && !paused && (!stored || needsRefetch(stored.params)) && !loading && !error && !autoLoaded;
}

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

/** Apply the ticks (and, whatever the ticks, the hard rule: only players you beat). */
export function filterTargets(rows, f, { now, attackedToday = new Set() } = {}) {
    return rows.filter((r) => {
        if (!isBeatable(r.band)) return false;
        if (f.stompOnly && r.band !== 'stomp') return false;
        if (f.keep50 && !(r.forecast && r.forecast.keep > 0.5)) return false;
        const st = stateOf(r, now);
        if (f.hideHosp && st === 'hospital') return false;
        if (f.hideTravel && st === 'travel') return false;
        if (f.notToday && attackedToday.has(Number(r.id))) return false;
        return true;
    });
}

/**
 * How strong they are next to you, from Torn's fight modifier (the owner:
 * never the words "FF" or "fair fight" on screen): 3 means 75% or more of
 * your battle strength, 1 means far weaker.
 */
export function strengthPct(ff) {
    if (!Number.isFinite(ff)) return null;
    return Math.round((3 / 8) * (Math.min(3, Math.max(1, ff)) - 1) * 100);
}

/** "About 53% as strong as you (our estimate) · 60% by FFScouter’s list · estimate 12 days old · from FFScouter 12 d" */
export function detailsText(d) {
    const pct = (v) => {
        const p = strengthPct(v);
        return p === null ? '—' : p >= 75 ? '75%+' : p + '%';
    };
    const parts = ['About ' + pct(d.ours) + ' as strong as you (our estimate) · ' + pct(d.list) + ' by FFScouter’s list'];
    if (d.ageDays !== null && d.ageDays !== undefined) parts.push('estimate ' + (d.ageDays < 1 ? 'from today' : d.ageDays + ' days old') + (d.old ? ' (old: past ' + OLD_ESTIMATE_DAYS + ' days)' : ''));
    if (d.source) parts.push('from ' + d.source);
    return parts.join(' · ');
}

function bandCell(band) {
    return h('span', { class: 'band2' }, [h('i', { style: 'background:' + BAND_COLORS[band] }), BAND_WORDS[band]]);
}

/** The first cell of a row, with the band colour on the row's edge. */
function edgeTd(band, kids) {
    return h('td', { style: 'box-shadow:inset 3px 0 0 ' + BAND_COLORS[band || 'none'] }, kids);
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

/** A war-style status cell: "Hospital · out 14:32 TCT (3:10)", "→ Mexico, lands ~15:05 (est.)". */
function statusTd(parts, now, settings) {
    const local = settings && settings.timeFormat === 'local';
    const kids = [parts.pre];
    if (parts.at) {
        kids.push(clock(parts.at, settings));
        if (parts.cd) kids.push((local ? '' : ' TCT') + ' (', cd(parts.at, now), ')');
    }
    if (parts.post) kids.push(parts.post);
    return h('td', { class: parts.cls || null }, kids);
}

function dot(kind) {
    return kind ? h('i', { title: ACTIVITY_WORDS[kind], 'aria-label': ACTIVITY_WORDS[kind], style: 'display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;vertical-align:1px;background:' + ACTIVITY_COLORS[kind] }) : null;
}

function pct(x) {
    return x === null || x === undefined ? '—' : Math.round(x * 100) + '%';
}

function attackBtn(id, primary, ghost) {
    return h('a', { class: 'btn sm' + (primary ? ' primary' : ghost ? ' ghost' : ''), href: attackUrl(id), target: '_blank', rel: 'noopener', text: 'Attack' });
}

function sourceShort(r, now) {
    const e = r.est;
    if (!e) return r.stored && r.stored.source ? r.stored.source : 'no estimate yet';
    const s = String(e.sourceText || e.source || '');
    const when = e.at ? ' · ' + ago(e.at, now) : '';
    const old = e.ageDays > OLD_ESTIMATE_DAYS ? ' · old' : '';
    if (/spy/i.test(s)) return 'spy' + when;
    if (/fight/i.test(s)) return 'your fight' + when;
    if (/ffscouter/i.test(s)) return s + old;
    if (/public|rank/i.test(s)) return 'public stats · rough';
    return s.slice(0, 30);
}

/** ☆ / ★ on a row: watch this player (the row's own click is left alone). */
function starBtn(ctx, p) {
    const w = ctx.eye.watch;
    if (!w) return null;
    const on = w.isWatched(p.id);
    return h('button', {
        class: 'btn sm ghost',
        type: 'button',
        'data-act': 'star',
        'aria-pressed': String(on),
        'aria-label': (on ? 'Stop watching ' : 'Watch ') + (p.name || p.id),
        title: on ? 'Watching · click to stop' : 'Watch this player',
        onclick: (ev) => {
            ev.stopPropagation();
            const r = w.toggle(p);
            ctx.ui.eyeNote = r && !r.ok && r.reason === 'full' ? 'Your watch list is full (' + WATCH_MAX + ' players): remove someone first.' : null;
            ctx.rerender();
        },
        text: on ? '★' : '☆',
    });
}

function targetsTable(rows, { now, chain = false, ctx }) {
    const head = chain
        ? ['Band', 'Player', 'Lvl', 'Respect', 'Win', 'HP kept', 'Status', 'Active', '', '']
        : ['Band', 'Player', 'Lvl', 'Win', 'HP kept', 'Respect', 'Status', 'Active', 'Estimate from', '', ''];
    const right = [2, 3, 4, 5, 7];
    const open = ctx.ui.eyeOpen;
    const body = [];
    rows.forEach((r, i) => {
        const win = h('td', { class: 'r', text: r.forecast ? pct(r.forecast.pWin) : '—' });
        const keep = h('td', { class: 'r', text: r.forecast && r.forecast.keep !== null ? (r.est && r.est.confidence === 'exact' ? '' : '~') + pct(r.forecast.keep) : '—' });
        const resp = h('td', { class: 'r' }, [chain ? h('b', { class: 'white', text: r.respect ? r.respect.toFixed(2) : '—' }) : r.respect ? r.respect.toFixed(2) : '—']);
        const cells = [edgeTd(r.band, [bandCell(r.band)]), h('td', {}, [h('a', { href: profileUrl(r.id), target: '_blank', rel: 'noopener', onclick: (ev) => ev.stopPropagation() }, [h('b', { class: 'w', text: r.name || String(r.id) })])]), h('td', { class: 'r', text: r.level ? String(r.level) : '—' })];
        if (chain) cells.push(resp, win, keep);
        else cells.push(win, keep, resp);
        cells.push(statusCell(r, now), h('td', { class: 'r muted', text: ago(r.lastAction, now) }));
        if (!chain) cells.push(h('td', { class: 'muted', text: sourceShort(r, now) }));
        cells.push(h('td', { class: 'r', style: 'width:40px' }, [starBtn(ctx, r)]));
        cells.push(h('td', { class: 'r' }, [attackBtn(r.id, i === 0, false)]));
        const d = detailsText(targetDetails(r.stored || {}, r));
        const isOpen = open === r.id;
        body.push(h('tr', { class: 'click' + (isOpen ? ' sel' : ''), tabindex: '0', title: d, 'aria-expanded': String(isOpen), onclick: () => { ctx.ui.eyeOpen = isOpen ? null : r.id; ctx.rerender(); }, onkeydown: (ev) => { if (ev.key === 'Enter') { ctx.ui.eyeOpen = isOpen ? null : r.id; ctx.rerender(); } } }, cells));
        if (isOpen) body.push(h('tr', { class: 'sub' }, [h('td', { colspan: String(head.length), class: 'muted', style: 'font-size:12px' }, [d])]));
    });
    return h('table', { class: 'tbl num' }, [
        h('thead', {}, [h('tr', {}, head.map((x, i) => h('th', { class: right.includes(i) ? 'r' : null, style: i === 0 ? 'width:110px' : null, text: x })))]),
        h('tbody', {}, body),
    ]);
}

/** War and Watched rows share one layout: band edge, online dot, status with out-times and landings, win and HP kept. */
function memberRow(w, { now, ctx, first, extra = [], respect = true }) {
    const r = w.view || { band: 'none' };
    const m = w.m;
    const act = activityOf(m, now);
    const attackable = w.state === 'okay' || w.state === 'early';
    const cells = [
        edgeTd(r.band || 'none', [bandCell(r.band || 'none')]),
        h('td', {}, [dot(act.kind), h('a', { href: profileUrl(w.id), target: '_blank', rel: 'noopener' }, [h('b', { class: 'w', text: m.name || String(w.id) })])]),
        h('td', { class: 'r', text: m.level ? String(m.level) : '—' }),
        h('td', { class: 'r', text: r.forecast ? pct(r.forecast.pWin) : '—' }),
        h('td', { class: 'r', text: r.forecast && r.forecast.keep !== null ? pct(r.forecast.keep) : '—' }),
    ];
    if (respect) cells.push(h('td', { class: 'r', text: r.respect ? r.respect.toFixed(2) : '—' }));
    cells.push(statusTd(w.parts, now, ctx.settings), h('td', { class: 'muted', text: act.text }));
    cells.push(...extra);
    cells.push(h('td', { class: 'r' }, [attackable || w.state === 'hospital' ? attackBtn(w.id, first && attackable, r.band === 'cant') : null]));
    return h('tr', { class: w.state === 'fallen' ? 'whatif' : null }, cells);
}

function memberHead(cols, widths = {}) {
    const right = new Set(['Lvl', 'Win', 'HP kept', 'Respect']);
    return h('thead', {}, [h('tr', {}, cols.map((x, i) => h('th', { class: right.has(x) ? 'r' : null, style: i === 0 ? 'width:110px' : widths[x] || null, text: x })))]);
}

function warTable(rows, { now, ctx }) {
    let first = true;
    const body = rows.map((w) => {
        const tr = memberRow(w, { now, ctx, first, extra: [h('td', { class: 'r', style: 'width:40px' }, [starBtn(ctx, { id: w.id, name: w.m.name, level: w.m.level })])] });
        if (w.state === 'okay' || w.state === 'early') first = false;
        return tr;
    });
    return h('table', { class: 'tbl num' }, [memberHead(['Band', 'Player', 'Lvl', 'Win', 'HP kept', 'Respect', 'Status', 'Active', '', ''], { Status: 'width:300px' }), h('tbody', {}, body)]);
}

/** The reason box on a watched row: the four words, or your own (≤ 24 characters). */
function tagCell(ctx, entry) {
    const w = ctx.eye.watch;
    const tag = entry.tag || '';
    const custom = tag && !WATCH_TAGS.includes(tag);
    const editing = ctx.ui.eyeTagEdit === entry.id;
    const sel = h(
        'select',
        {
            class: 'inp',
            style: 'height:26px;padding:0 6px;font-size:12px',
            'aria-label': 'Reason for ' + (entry.name || entry.id),
            onchange: (ev) => {
                const v = ev.target.value;
                if (v === '__custom') {
                    ctx.ui.eyeTagEdit = entry.id;
                    ctx.rerender();
                    return;
                }
                ctx.ui.eyeTagEdit = null;
                w.tag(entry.id, v || null);
            },
        },
        [h('option', { value: '', text: 'no reason' }), ...WATCH_TAGS.map((x) => h('option', { value: x, text: x })), custom ? h('option', { value: tag, text: tag }) : null, h('option', { value: '__custom', text: 'your own…' })],
    );
    sel.value = editing ? '__custom' : tag;
    const kids = [sel];
    if (editing) {
        const inp = h('input', { class: 'inp', style: 'height:26px;width:130px;margin-left:6px', maxlength: String(TAG_MAX), placeholder: 'your reason', 'aria-label': 'Your reason for ' + (entry.name || entry.id), value: custom ? tag : '' });
        const save = () => {
            ctx.ui.eyeTagEdit = null;
            w.tag(entry.id, inp.value);
        };
        inp.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter') save();
            if (ev.key === 'Escape') {
                ctx.ui.eyeTagEdit = null;
                ctx.rerender();
            }
        });
        kids.push(inp, h('button', { class: 'btn sm', type: 'button', style: 'margin-left:6px', onclick: save, text: 'Save' }));
    }
    return h('td', {}, kids);
}

function watchedTable(rows, { now, ctx }) {
    const w = ctx.eye.watch;
    let first = true;
    const body = rows.map((row) => {
        const extra = [tagCell(ctx, row.entry), h('td', { class: 'r' }, [h('button', { class: 'btn sm ghost', type: 'button', 'aria-label': 'Remove ' + (row.entry.name || row.id), onclick: () => { w.remove(row.id); ctx.rerender(); }, text: 'Remove' })])];
        const tr = memberRow(row, { now, ctx, first, extra, respect: false });
        if (row.state === 'okay' || row.state === 'early') first = false;
        return tr;
    });
    return h('table', { class: 'tbl num' }, [memberHead(['Band', 'Player', 'Lvl', 'Win', 'HP kept', 'Status', 'Active', 'Reason', '', ''], { Status: 'width:280px', Reason: 'width:150px' }), h('tbody', {}, body)]);
}

/** Members (war or watched) with their view, state and status parts. */
function memberRows(members, e, { now, early = new Set(), flights = {}, war = false }) {
    const views = new Map((members || []).map((mm) => [Number(mm.id), e.view(Number(mm.id), { level: mm.level, name: mm.name, life: mm.life || null }, { war })]));
    const bands = {};
    const respect = {};
    for (const [id, v] of views) {
        if (v) {
            bands[id] = v.band;
            respect[id] = v.respect || 0;
        }
    }
    return sortWar(members || [], { bands, respect, early, nowS: Math.floor(now / 1000) }).map((r) => ({ ...r, view: views.get(r.id), parts: statusParts(r.m, { now, seenAt: flights[r.id] ? flights[r.id].at : null, early: r.state === 'early' }) }));
}

function warControls(ctx, e) {
    const w = e.war.state();
    const kids = [];
    const cur = w.enemies.find((x) => x.id === w.fid);
    if (w.fid) kids.push(h('span', { class: 'sel', text: 'vs ' + (w.name || (cur && cur.name) || 'faction') + ' [' + w.fid + ']' + (cur ? ' · ' + WAR_KIND_WORDS[cur.kind] : w.manual ? ' · picked by you' : '') }));
    // More than one war: pick which (ranked first).
    if (w.enemies.length > 1 && !w.manual) {
        kids.push(h('div', { class: 'seg', role: 'group', 'aria-label': 'Which war' }, w.enemies.slice(0, 4).map((x) => h('button', { type: 'button', 'aria-pressed': String(x.id === w.fid), onclick: () => e.war.pick(x.id), text: (x.name || x.id) + ' · ' + WAR_KIND_WORDS[x.kind] }))));
    }
    // A faction typed in can always be cleared (back to your faction's own war, or to none).
    if (w.manual) kids.push(h('button', { class: 'btn sm', type: 'button', onclick: () => e.war.auto(), text: w.enemies.length ? 'Back to our war' : 'Clear' }));
    let fidIn;
    kids.push(
        h('span', { class: 'sep' }),
        t('lab', w.enemies.length ? 'Other faction' : 'Enemy faction'),
        (fidIn = h('input', { class: 'inp num', inputmode: 'numeric', style: 'width:90px', placeholder: 'faction id', 'aria-label': 'Enemy faction id', value: w.manual ? String(w.manual) : '' })),
        h('button', { class: 'btn sm', type: 'button', 'data-act': 'war-watch', onclick: () => { const v = Number(String(fidIn.value).replace(/\D/g, '')); if (v) e.war.watch(v); }, text: 'Show this faction' }),
    );
    return kids;
}

function headsUpBlock(list, now, settings) {
    return h('div', {}, [
        sectionHead('Heads-up', meta(['watched players']), null, 'h3'),
        h(
            'ul',
            { class: 'heads' },
            list.slice(0, 6).map((x) => h('li', { class: x.kind === 'online' ? 'g' : 'w' }, [h('i'), h('div', {}, [x.text, h('span', { text: ' · ' + (x.at > now ? 'at ' + clock(x.at, settings) : Math.max(1, Math.round((now - x.at) / 60000)) + ' min ago') })])])),
        ),
    ]);
}

export function renderEye(m, ctx) {
    const e = ctx.eye;
    const now = Date.now();
    const ui = ctx.ui;
    const mode = EYE_MODES.some(([k]) => k === ui.eyeMode) ? ui.eyeMode : 'targets';
    const f = ui.eyeFilters || (ui.eyeFilters = { ...DEFAULT_EYE_FILTERS });
    const inputs = {};
    const reload = () => {
        f.minLevel = Math.max(1, Math.min(100, Number(inputs.min && inputs.min.value) || f.minLevel || 1));
        f.maxLevel = Math.max(f.minLevel, Math.min(100, Number(inputs.max && inputs.max.value) || f.maxLevel || 100));
        e.load({ minLevel: f.minLevel, maxLevel: f.maxLevel, inactiveOnly: f.inactive ? 1 : 0, factionless: f.factionless ? 1 : null });
    };
    const attacks = e.attacks ? e.attacks() : [];
    const today = tornDayStart(now);
    const attackedToday = new Set(attacks.filter((a) => (a.ended || 0) * 1000 >= today).map((a) => Number(a.def)));
    const watch = e.watch ? e.watch.state() : { list: [], states: {}, flights: {}, offers: [] };

    // Controls
    const modeSeg = h('div', { class: 'seg modes', role: 'group', 'aria-label': 'Mode' }, EYE_MODES.map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(k === mode), onclick: () => { ui.eyeMode = k; ctx.rerender(); }, text: k === 'watched' && watch.list.length ? label + ' ' + watch.list.length : label })));
    const bar1 = [modeSeg];
    if (mode === 'war' && e.war) bar1.push(...warControls(ctx, e));
    if (mode === 'targets' || mode === 'chain') {
        bar1.push(h('span', { class: 'sep' }), t('lab', 'Sort'));
        if (mode === 'chain') bar1.push(h('span', { class: 'muted', text: 'most respect first, always' }));
        else bar1.push(h('div', { class: 'seg', role: 'group', 'aria-label': 'Sort' }, EYE_SORTS.map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(k === f.sort), onclick: () => { f.sort = k; ctx.rerender(); }, text: label }))));
        bar1.push(h('span', { class: 'sep' }), t('lab', 'Level'), (inputs.min = h('input', { class: 'inp num', inputmode: 'numeric', style: 'width:44px', 'aria-label': 'Lowest level', value: String(f.minLevel), onchange: reload })), '–', (inputs.max = h('input', { class: 'inp num', inputmode: 'numeric', style: 'width:50px', 'aria-label': 'Highest level', value: String(f.maxLevel), onchange: reload })));
        if (ctx.flags.hasFfs) bar1.push(h('button', { class: 'btn sm', type: 'button', onclick: reload, disabled: e.loading() || ctx.paused, text: e.loading() ? 'Loading…' : 'Refresh' }));
    } else if (mode === 'war') {
        bar1.push(h('span', { class: 'muted', text: 'attackable now first, then out of hospital soonest' }));
    } else {
        bar1.push(h('span', { class: 'sep' }), h('span', { class: 'muted', text: watch.list.length + ' of ' + WATCH_MAX + ' · read every 60 s while this is open' }));
    }
    const tickKeys = mode === 'war' ? ['warHideCant', 'warHideHosp', 'warHideTravel'] : mode === 'chain' ? ['stompOnly', 'keep50', 'hideHosp', 'hideTravel', 'inactive', 'factionless', 'notToday'] : mode === 'targets' ? EYE_TICKS.map(([k]) => k).filter((k) => !k.startsWith('war')) : [];
    const refetch = new Set(['inactive', 'factionless']);
    const bar2 = tickKeys.length
        ? [
              t('lab', 'Show'),
              h('div', { class: 'ticks', role: 'group', 'aria-label': 'Show' }, EYE_TICKS.filter(([k]) => tickKeys.includes(k)).map(([k, label]) => h('button', { type: 'button', class: 'tk', 'aria-pressed': String(Boolean(f[k])), onclick: () => { f[k] = !f[k]; if (refetch.has(k) && ctx.flags.hasFfs) reload(); else ctx.rerender(); } }, [h('i'), label]))),
          ]
        : [];

    const main = [];
    const pane = [];
    const stored = e.stored ? e.stored() : null;
    const rowsAll = e.rows();
    // First visit with FFScouter connected: load the targets without a click; also once for a list asked the old way
    // (1.1.x: one ask, strongest first, can't-win players kept).
    if (shouldAutoLoad({ mode, hasFfs: ctx.flags.hasFfs, paused: ctx.paused, stored, loading: e.loading(), error: e.error(), autoLoaded: ui.eyeAutoLoaded, ready: Boolean(m && m.ready) })) {
        ui.eyeAutoLoaded = true;
        setTimeout(reload, 0);
    }

    // Heads-ups for the watch list show in every mode.
    const heads = headsUps(watch.list, watch.states, watch.flights, now);

    if (mode === 'war') {
        const w = e.war ? e.war.state() : { members: [], enemies: [] };
        let rows = memberRows(w.members || [], e, { now, early: w.early || new Set(), flights: watch.flights, war: true });
        rows = rows.filter((r) => !(f.warHideCant && r.band === 'cant') && !(f.warHideHosp && r.state === 'hospital') && !(f.warHideTravel && (r.state === 'traveling' || r.state === 'abroad')));
        const sum = warSummary(rows, Math.floor(now / 1000));
        const fallen = rows.filter((r) => r.state === 'fallen').length;
        const empty = w.fid
            ? w.loading && !rows.length
                ? 'Reading the faction…'
                : w.error || 'No members to show.'
            : w.myFaction === null
              ? 'You’re not in a faction, or your key can’t tell: type the enemy faction’s id. On Torn’s own war page the chips and the order show by themselves.'
              : w.warsLoading
                ? 'Looking for your faction’s wars…'
                : 'Your faction isn’t at war right now. Type a faction’s id to watch it anyway.';
        main.push(
            h('div', { class: 'lead', 'data-mode': 'war' }, [
                sectionHead('War' + (w.name ? ' · ' + w.name : ''), meta(['everyone, coloured by how the fight goes for you · attackable now first, then who’s out soonest' + (w.fid ? ' · read every 10 s while open' : '')])),
                w.error && rows.length ? h('div', { class: 'why', style: 'margin-bottom:8px', text: 'Couldn’t read the faction just now: ' + w.error }) : null,
                rows.length ? warTable(rows, { now, ctx }) : h('p', { class: 'muted', style: 'margin:0', text: empty }),
                h('div', { class: 'note2', text: 'War shows everyone, even Can’t win (the colour tells you the risk) and the fallen (greyed, at the bottom). Landing times are estimated from when we first saw them fly and the standard flight time.' }),
            ]),
        );
        const outs = rows.filter((r) => r.state === 'hospital').slice(0, 5);
        const lands = rows.filter((r) => r.state === 'traveling' && r.parts.at).sort((a, b) => a.parts.at - b.parts.at).slice(0, 3);
        pane.push(
            h('div', {}, [
                sectionHead('Next out of hospital', null, null, 'h3'),
                outs.length || lands.length
                    ? h('dl', { class: 'facts num' }, [
                          ...outs.flatMap((r) => [h('dt', { text: countdown(Math.max(0, r.until * 1000 - now)) }), h('dd', { text: (r.m.name || r.id) + ' · ' + BAND_WORDS[r.band || 'none'] })]),
                          ...lands.flatMap((r) => [h('dt', { text: '~' + clock(r.parts.at, ctx.settings) }), h('dd', { text: (r.m.name || r.id) + ' lands' })]),
                      ])
                    : h('p', { class: 'muted', style: 'margin:0', text: 'Nobody in hospital.' }),
                h('div', { class: 'note2', text: sum.attackable + ' attackable now · ' + rows.filter((r) => r.state === 'hospital' && r.until * 1000 - now < 5 * 60000).length + ' out within 5 min · ' + (sum.traveling + rows.filter((r) => r.state === 'abroad').length) + ' traveling or abroad · ' + rows.filter((r) => r.band === 'cant').length + ' can’t win' + (fallen ? ' · ' + fallen + ' fallen' : '') }),
            ]),
        );
        if (heads.length) pane.push(headsUpBlock(heads, now, ctx.settings));
    } else if (mode === 'watched') {
        const members = watch.list.map((x) => {
            const s = watch.states[x.id] || {};
            return { id: x.id, name: x.name || s.name || null, level: x.level || s.level || null, life: s.life || null, status: s.status || null, last_action: s.last_action || null, has_early_discharge: s.has_early_discharge, is_revivable: s.is_revivable };
        });
        const byId = new Map(watch.list.map((x) => [Number(x.id), x]));
        const rows = memberRows(members, e, { now, flights: watch.flights }).map((r) => ({ ...r, entry: byId.get(r.id) }));
        const offers = watch.offers || [];
        const kids = [sectionHead('Watched', meta([watch.list.length + ' of ' + WATCH_MAX + ' players · online status, hospital, flights · stays until you remove them']))];
        if (offers.length) {
            kids.push(
                h('div', { style: 'margin-bottom:12px' }, [
                    h('div', { class: 'lab', style: 'margin-bottom:6px', text: 'Watch? They attacked you in the last hour' }),
                    h(
                        'div',
                        { class: 'data' },
                        offers.map((o) =>
                            h('div', { class: 'dr' }, [
                                h('div', {}, [h('a', { href: profileUrl(o.id), target: '_blank', rel: 'noopener' }, [h('b', { text: o.name || String(o.id) })]), h('small', { text: (o.level ? ' [' + o.level + ']' : '') + ' · ' + (o.mugged ? 'mugged you' : 'attacked you') + ' ' + Math.max(1, Math.round((now - o.at) / 60000)) + ' min ago' })]),
                                h('div', { class: 'acts' }, [
                                    h('button', { class: 'btn sm primary', type: 'button', onclick: () => { const r = e.watch.toggle({ id: o.id, name: o.name, level: o.level, tag: o.mugged ? 'mug' : 'revenge' }); if (r && !r.ok && r.reason === 'full') ui.eyeNote = 'Your watch list is full (' + WATCH_MAX + ' players): remove someone first.'; ctx.rerender(); }, text: 'Watch' }),
                                    h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { e.watch.dismiss(o.id); ctx.rerender(); }, text: 'Not now' }),
                                ]),
                            ]),
                        ),
                    ),
                ]),
            );
        }
        if (ui.eyeNote) kids.push(h('div', { class: 'why', style: 'margin-bottom:8px', text: ui.eyeNote }));
        kids.push(rows.length ? watchedTable(rows, { now, ctx }) : h('p', { class: 'muted', style: 'margin:0', text: 'Nobody watched yet. Press ☆ on a Targets or War row, on a player’s profile on Torn, or on the attack page.' }));
        kids.push(h('div', { class: 'note2', text: 'Read every 60 s while this view or a Torn tab is open (someone in hospital or flying for a long while, every 5 min). Heads-ups show here when a watched player is out of hospital or lands within 3 minutes, or comes online.' }));
        main.push(h('div', { class: 'lead', 'data-mode': 'watched' }, kids));
        pane.push(heads.length ? headsUpBlock(heads, now, ctx.settings) : h('div', {}, [sectionHead('Heads-up', meta(['watched players']), null, 'h3'), h('p', { class: 'muted', style: 'margin:0', text: 'Nothing coming up in the next 3 minutes.' })]));
    } else {
        let rows = filterTargets(rowsAll, f, { now, attackedToday });
        const hiddenKeep = f.keep50 ? rowsAll.filter((r) => !(r.forecast && r.forecast.keep > 0.5)).length : 0;
        if (mode === 'chain') rows = rows.filter((r) => r.band === 'stomp' || r.band === 'good').sort((a, b) => (b.respect || 0) - (a.respect || 0));
        else rows = sortTargets(rows, f.sort);
        const msg = targetsMessage({ paused: ctx.paused, error: e.error(), loading: e.loading(), stored });
        let body;
        if (!ctx.flags.hasFfs) body = h('p', { class: 'muted', style: 'margin:0' }, ['Targets come from FFScouter. ', h('a', { href: '#settings', onclick: (ev) => { ev.preventDefault(); ctx.go('settings'); }, text: 'Connect it in Settings' }), '; chips on Torn’s pages work without it (your fights and public stats).']);
        else if (!rows.length) {
            const text = msg.kind !== 'none' ? msg.text : rowsAll.length ? 'Nobody passes your ticks.' : 'No targets yet.';
            body = h('p', { class: msg.kind === 'dead' || msg.kind === 'error' ? 'c-bad' : 'muted', style: 'margin:0' }, [text, msg.kind === 'dead' ? h('span', {}, [' · ', h('a', { href: '#settings', onclick: (ev) => { ev.preventDefault(); ctx.go('settings'); }, text: 'check it in Settings' })]) : null]);
        } else body = targetsTable(rows, { now, chain: mode === 'chain', ctx });
        const notes = [];
        const d = (stored && stored.dropped) || {};
        if (mode === 'targets' && stored && stored.list && stored.list.length) {
            if (d.cant) notes.push(d.cant + ' can’t-win player' + (d.cant === 1 ? '' : 's') + ' dropped (never kept)');
            if (d.none) notes.push(d.none + ' with no estimate dropped');
            if (stored.ffIgnored) notes.push('FFScouter’s list ignored the strength range this time; our own fight check still decided');
        }
        if (hiddenKeep) notes.push(hiddenKeep + ' hidden because you’d keep under 50% HP');
        // A load that failed still says so above an older list.
        const warnLine = rows.length && (msg.kind === 'error' || msg.kind === 'dead' || msg.kind === 'wait' || msg.kind === 'paused') ? h('div', { class: 'why', style: 'margin-bottom:8px', text: msg.text + (stored && stored.at ? ' · showing the list from ' + clock(stored.at, ctx.settings) : '') }) : null;
        main.push(
            h('div', { class: 'lead', 'data-mode': mode }, [
                sectionHead(mode === 'chain' ? 'Chain' : 'Targets', meta([mode === 'chain' ? 'only Stomp and Good · most respect first · ' + rows.length + ' players' : rowsAll.length + ' players you beat · win and HP kept from your stats against theirs · ' + (EYE_SORTS.find(([k]) => k === f.sort) || [0, ''])[1].toLowerCase() + ' first'])),
                warnLine,
                ui.eyeNote ? h('div', { class: 'why', style: 'margin-bottom:8px', text: ui.eyeNote }) : null,
                body,
                notes.length ? h('div', { class: 'note2', text: notes.join(' · ') + '.' }) : null,
                mode === 'chain'
                    ? h('div', { class: 'note2', text: 'Chains only list players you’ll beat (green and light green); Tough never shows here, and Can’t win is never kept.' })
                    : h('div', { class: 'note2', text: 'Only players you beat are kept: FFScouter is asked for players up to 75% of your strength (the most respect Torn gives), by levels, then each one is checked with the fight model. Click a row for its details.' }),
            ]),
        );
        if (heads.length) pane.push(headsUpBlock(heads, now, ctx.settings));
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
