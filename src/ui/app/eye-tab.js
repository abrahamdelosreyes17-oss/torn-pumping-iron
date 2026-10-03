/*
 * Torn Eye tab (mockups/round7/torn-eye-targets.html, picked by the owner): one question, "who can I hit?".
 * Three views: Targets (FFScouter's list judged by our own fight model: only players you beat keeping half your HP or
 * more are ever kept), War (everyone in the enemy faction, found by itself from your faction's wars: online status,
 * hospital out-times, landings, jail) and Watched (the players you chose to keep an eye on). Chain is gone (round 7:
 * it was the same list as Targets).
 *
 * Targets: the band chips (All / Stomp / Good / Fair, with counts) and "Ready now" (on by default); one order for
 * everything, most respect, then most HP kept, then the highest win; 20 rows a page, only those drawn; the statuses
 * read the Torn Trading way (eye-service.js `pumpStatuses`), this page first, then the rest quietly.
 */

import { h, t } from '../dom.js';
import { BAND_WORDS, BAND_COLORS } from '../../core/eye/bands.js';
import { sortWar, warSummary, statusParts, activityOf, ACTIVITY_COLORS, ACTIVITY_WORDS, WAR_KIND_WORDS } from '../../core/eye/war.js';
import { needsRefetch, targetDetails, targetsMessage, hitText, OLD_ESTIMATE_DAYS, TARGET_LOAD, TARGETS_REFRESH_MS, listTargets, pageOf, pagerItems, rowState, statusProgress, statusLine, BAND_CHIPS, PAGE_SIZE } from '../../core/eye/targets.js';
import { WATCH_TAGS, WATCH_MAX, TAG_MAX, headsUps } from '../../core/eye/watch.js';
import { profileUrl, attackUrl } from '../../sources/route.js';
import { FFS_SITE_URL } from '../../api/ffscouter.js';
import { countdown } from '../../core/bars.js';
import { fmtInt, fmtShort } from '../../core/format.js';
import { clock, cd, sectionHead, meta } from './common.js';

export const EYE_MODES = [
    ['targets', 'Targets'],
    ['war', 'War'],
    ['watched', 'Watched'],
];

/** War shows everyone by default (owner): its own ticks, all off. Targets has the band chips and "Ready now" instead. */
export const EYE_TICKS = [
    ['warHideLow', 'Hide under 50%'],
    ['warHideHosp', 'Hide hospital'],
    ['warHideTravel', 'Hide traveling'],
];

/** "Ready now" is on by default (the owner's default stands until he says). */
export const DEFAULT_EYE_FILTERS = { band: 'all', ready: true, warHideLow: false, warHideHosp: false, warHideTravel: false };

/** The filters, from whatever was kept: keys of older versions (sort, level range, the seven Show ticks) are dropped. */
export function eyeFilters(f) {
    const src = f && typeof f === 'object' ? f : {};
    const out = { ...DEFAULT_EYE_FILTERS };
    if (BAND_CHIPS.includes(src.band)) out.band = src.band;
    for (const k of ['ready', 'warHideLow', 'warHideHosp', 'warHideTravel']) if (typeof src[k] === 'boolean') out[k] = src[k];
    return out;
}

/** The chips' words. */
const CHIP_WORDS = { all: 'All', stomp: 'Stomp', good: 'Good', fair: 'Fair' };

/**
 * Load the targets without a click (there is no Refresh button): the first visit with FFScouter connected, a list
 * asked or judged the old way, and a list older than TARGETS_REFRESH_MS. `autoLoaded`: when this page last did it
 * (true: once, for good).
 */
export function shouldAutoLoad({ mode, hasFfs, paused, stored, loading, error, autoLoaded, ready = true, now = Date.now() }) {
    if (!(ready && mode === 'targets' && Boolean(hasFfs) && !paused && !loading && !error)) return false;
    if (typeof autoLoaded === 'number' ? now - autoLoaded < TARGETS_REFRESH_MS : autoLoaded) return false;
    return !stored || needsRefetch(stored.params) || !(now - (Number(stored.at) || 0) < TARGETS_REFRESH_MS);
}

/** Where a target row is (core/eye/targets.js rowState): 'hospital', 'travel', 'jail', 'okay', 'other' or 'unknown'. */
export const stateOf = rowState;

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
    return h('span', { class: 'band2' }, [h('i', { style: 'background:' + BAND_COLORS[band || 'none'] }), BAND_WORDS[band || 'none']]);
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

/** The status cell: what was read, your own hit, or "checking" while the statuses are being read. */
function statusCell(r, now, checking) {
    if (r.hospitalUntil && r.hospitalUntil > now) return h('td', { class: 'cdn', text: 'Hospital · ' + countdown(r.hospitalUntil - now) });
    // Your own hit: known without asking Torn.
    if (r.hit && r.hit.kind === 'hit') return h('td', { class: 'cdn', text: hitText(r.hit, now) });
    const st = r.status || {};
    const d = st.description || st.state;
    if (d && /hospital/i.test(d) && Number(st.until) * 1000 > now) return h('td', { class: 'cdn', text: 'Hospital · ' + countdown(Number(st.until) * 1000 - now) });
    if (d && !/^okay$/i.test(st.state || d)) return h('td', { class: 'st-wait', text: d });
    // The attack page you opened (not a hit yet) says so beside Okay.
    if (d) return h('td', { class: 'st-ok', text: r.hit ? 'Okay · ' + hitText(r.hit, now).toLowerCase() : 'Okay' });
    if (r.hit) return h('td', { class: 'muted', text: hitText(r.hit, now) });
    // Nothing read yet: being read (this page first), or not at all without a key.
    if (checking) return h('td', {}, [h('span', { class: 'checking', text: 'checking' })]);
    return h('td', { class: 'muted', title: 'Not read. Statuses are read with your Torn key while this tab is open.', text: '—' });
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

function attackBtn(id, primary, ghost, onclick = null) {
    return h('a', { class: 'btn sm' + (primary ? ' primary' : ghost ? ' ghost' : ''), href: attackUrl(id), target: '_blank', rel: 'noopener', onclick, text: 'Attack' });
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

/** One page of targets (only these 20 are built). The numbers in the list's order: respect, HP kept, win. */
function targetsTable(rows, { now, ctx, checking }) {
    const head = ['Band', 'Player', 'Lvl', 'Respect', 'HP kept', 'Win', 'Status', 'Active', 'From', '', ''];
    const right = [2, 3, 4, 5, 7];
    const open = ctx.ui.eyeOpen;
    const down = (r) => {
        const s = rowState(r, now);
        return s === 'hospital' || s === 'travel' || s === 'jail';
    };
    // The bright Attack button goes to the first player known to be free now, never one you just put in hospital.
    const firstUp = rows.find((r) => !r.hit && rowState(r, now) === 'okay') || null;
    const statuses = ctx.eye.statuses;
    const rowOf = (r) => {
        const body = [];
        const keep = r.forecast && r.forecast.keep !== null && r.forecast.keep !== undefined ? (r.est && r.est.confidence === 'exact' ? '' : '~') + pct(r.forecast.keep) : '—';
        const cells = [
            edgeTd(r.band, [bandCell(r.band)]),
            h('td', {}, [h('a', { href: profileUrl(r.id), target: '_blank', rel: 'noopener', onclick: (ev) => ev.stopPropagation() }, [h('b', { class: 'w', text: r.name || String(r.id) })])]),
            h('td', { class: 'r', text: r.level ? String(r.level) : '—' }),
            h('td', { class: 'r resp' }, [h('b', { class: 'white', text: r.respect ? r.respect.toFixed(2) : '—' })]),
            h('td', { class: 'r', text: keep }),
            h('td', { class: 'r', text: r.forecast ? pct(r.forecast.pWin) : '—' }),
            statusCell(r, now, checking),
            h('td', { class: 'r muted', text: ago(r.lastAction, now) }),
            h('td', { class: 'muted', text: sourceShort(r, now) }),
            h('td', { class: 'r', style: 'width:40px' }, [starBtn(ctx, r)]),
            h('td', { class: 'r' }, [
                attackBtn(r.id, r === firstUp, false, (ev) => {
                    ev.stopPropagation();
                    if (statuses) statuses.attack(r.id);
                }),
            ]),
        ];
        const d = detailsText(targetDetails(r.stored || {}, r));
        const isOpen = open === r.id;
        // A player you just hit, in hospital, away or in jail: greyed (still listed when "Ready now" is off).
        const grey = (r.hit && r.hit.kind === 'hit') || down(r);
        body.push(h('tr', { class: 'click' + (isOpen ? ' sel' : '') + (grey ? ' whatif' : ''), tabindex: '0', title: d, 'aria-expanded': String(isOpen), onclick: () => { ctx.ui.eyeOpen = isOpen ? null : r.id; ctx.rerender(); }, onkeydown: (ev) => { if (ev.key === 'Enter') { ctx.ui.eyeOpen = isOpen ? null : r.id; ctx.rerender(); } } }, cells));
        if (isOpen) body.push(h('tr', { class: 'sub' }, [h('td', { colspan: String(head.length), class: 'muted', style: 'font-size:12px' }, [d])]));
        return body;
    };
    return h('table', { class: 'tbl num eyelist' }, [
        h('thead', {}, [h('tr', {}, head.map((x, i) => h('th', { class: [right.includes(i) ? 'r' : '', i === 3 ? 'key' : ''].filter(Boolean).join(' ') || null, style: i === 0 ? 'width:110px' : null, text: x })))]),
        h('tbody', {}, rows.flatMap(rowOf)),
    ]);
}

/** ‹ Prev · 1 2 3 … · Next › and "20 a page · page 2 of 30". */
function pager(pg, ctx) {
    const go = (p) => () => {
        ctx.ui.eyePage = p;
        ctx.rerender();
    };
    const kids = [h('button', { type: 'button', disabled: pg.page === 0, 'aria-label': 'Previous page', onclick: go(pg.page - 1), text: '‹ Prev' })];
    for (const p of pagerItems(pg.page, pg.pages)) kids.push(p === '…' ? h('span', { text: '…' }) : h('button', { type: 'button', class: p === pg.page ? 'on' : null, 'aria-current': p === pg.page ? 'page' : null, onclick: go(p), text: String(p + 1) }));
    kids.push(h('button', { type: 'button', disabled: pg.page >= pg.pages - 1, 'aria-label': 'Next page', onclick: go(pg.page + 1), text: 'Next ›' }));
    kids.push(h('span', { class: 'sp', text: PAGE_SIZE + ' a page · page ' + (pg.page + 1) + ' of ' + pg.pages }));
    return h('div', { class: 'eye-pager', role: 'navigation', 'aria-label': 'Pages' }, kids);
}

/** The band chips and "Ready now" (Targets). */
function targetChips(ctx, f, list) {
    const set = (k, v) => {
        ctx.ui.eyeFilters = { ...f, [k]: v };
        ctx.ui.eyePage = 0;
        ctx.rerender();
    };
    const bands = h(
        'div',
        { class: 'eye-chips', role: 'group', 'aria-label': 'Band' },
        BAND_CHIPS.map((b) => h('button', { type: 'button', class: 'eye-chip', 'aria-pressed': String(f.band === b), onclick: () => set('band', b) }, [b === 'all' ? null : h('i', { style: 'background:' + BAND_COLORS[b] }), CHIP_WORDS[b], h('span', { text: ' ' + list.counts[b] })])),
    );
    const ready = h('button', { type: 'button', class: 'eye-chip', 'data-act': 'ready', 'aria-pressed': String(f.ready), title: 'Hides hospital, abroad, traveling, jail and players you hit in the last hour', onclick: () => set('ready', !f.ready) }, ['Ready now', f.ready && list.hidden ? h('span', { text: ' · ' + list.hidden + ' hidden' }) : null]);
    return [bands, h('div', { class: 'eye-chips' }, [ready]), h('span', { class: 'eye-rule' }, ['Order: ', h('b', { text: 'respect' }), ' › ', h('b', { text: 'HP kept' }), ' › ', h('b', { text: 'win' })])];
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
    cells.push(h('td', { class: 'r' }, [attackable || w.state === 'hospital' ? attackBtn(w.id, first && attackable, r.band === 'low') : null]));
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
    const keep = {};
    const win = {};
    for (const [id, v] of views) {
        if (v) {
            bands[id] = v.band;
            respect[id] = v.respect || 0;
            keep[id] = v.forecast && Number.isFinite(v.forecast.keep) ? v.forecast.keep : 0;
            win[id] = v.forecast && Number.isFinite(v.forecast.pWin) ? v.forecast.pWin : 0;
        }
    }
    // Within a band the one order: respect, then HP kept, then win.
    return sortWar(members || [], { bands, respect, keep, win, early, nowS: Math.floor(now / 1000) }).map((r) => ({ ...r, view: views.get(r.id), parts: statusParts(r.m, { now, seenAt: flights[r.id] ? flights[r.id].at : null, early: r.state === 'early' }) }));
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
    // Kept filters of older versions (sort, level range, the seven Show ticks) are ignored.
    const f = eyeFilters(ui.eyeFilters);
    const reload = () => e.load({ ...TARGET_LOAD });
    const watch = e.watch ? e.watch.state() : { list: [], states: {}, flights: {}, offers: [] };
    const stored = e.stored ? e.stored() : null;
    const rowsAll = mode === 'targets' ? e.rows() : [];
    const list = mode === 'targets' ? listTargets(rowsAll, { band: f.band, ready: f.ready, now }) : null;

    // Controls
    const modeSeg = h('div', { class: 'seg modes', role: 'group', 'aria-label': 'Mode' }, EYE_MODES.map(([k, label]) => h('button', { type: 'button', 'aria-pressed': String(k === mode), onclick: () => { ui.eyeMode = k; ctx.rerender(); }, text: k === 'watched' && watch.list.length ? label + ' ' + watch.list.length : label })));
    const bar1 = [modeSeg];
    if (mode === 'war' && e.war) bar1.push(...warControls(ctx, e));
    if (mode === 'targets') {
        bar1.push(...targetChips(ctx, f, list));
    } else if (mode === 'war') {
        bar1.push(h('span', { class: 'muted', text: 'attackable now first, then out of hospital soonest' }));
    } else {
        bar1.push(h('span', { class: 'sep' }), h('span', { class: 'muted', text: watch.list.length + ' of ' + WATCH_MAX + ' · read every 60 s while this is open' }));
    }
    const bar2 =
        mode === 'war'
            ? [
                  t('lab', 'Show'),
                  h('div', { class: 'ticks', role: 'group', 'aria-label': 'Show' }, EYE_TICKS.map(([k, label]) => h('button', { type: 'button', class: 'tk', 'aria-pressed': String(Boolean(f[k])), onclick: () => { ui.eyeFilters = { ...f, [k]: !f[k] }; ctx.rerender(); } }, [h('i'), label]))),
              ]
            : [];

    const main = [];
    const pane = [];
    // First visit with FFScouter connected: load the targets without a click; again for a list asked or judged the
    // old way, and when the stored one is old (there is no Refresh button).
    if (shouldAutoLoad({ mode, hasFfs: ctx.flags.hasFfs, paused: ctx.paused, stored, loading: e.loading(), error: e.error(), autoLoaded: ui.eyeAutoLoaded, ready: Boolean(m && m.ready), now })) {
        ui.eyeAutoLoaded = now;
        setTimeout(reload, 0);
    }

    // Heads-ups for the watch list show in every mode.
    const heads = headsUps(watch.list, watch.states, watch.flights, now);

    if (mode === 'war') {
        const w = e.war ? e.war.state() : { members: [], enemies: [] };
        let rows = memberRows(w.members || [], e, { now, early: w.early || new Set(), flights: watch.flights, war: true });
        rows = rows.filter((r) => !(f.warHideLow && r.band === 'low') && !(f.warHideHosp && r.state === 'hospital') && !(f.warHideTravel && (r.state === 'traveling' || r.state === 'abroad')));
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
                h('div', { class: 'note2', text: 'War shows everyone, even under 50% HP kept (red: the colour tells you the risk) and the fallen (greyed, at the bottom). Landing times are estimated from when we first saw them fly and the standard flight time.' }),
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
                h('div', { class: 'note2', text: sum.attackable + ' attackable now · ' + rows.filter((r) => r.state === 'hospital' && r.until * 1000 - now < 5 * 60000).length + ' out within 5 min · ' + (sum.traveling + rows.filter((r) => r.state === 'abroad').length) + ' traveling or abroad · ' + rows.filter((r) => r.band === 'low').length + ' under 50%' + (fallen ? ' · ' + fallen + ' fallen' : '') }),
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
        const rows = list.rows;
        const pg = pageOf(rows, ui.eyePage || 0);
        if ((ui.eyePage || 0) !== pg.page) ui.eyePage = pg.page;
        const statuses = e.statuses || null;
        const checking = Boolean(statuses && statuses.active());
        // Statuses: the players opened to attack, then this page, then every other listed row in the one order.
        const everyone = listTargets(rowsAll, { band: 'all', ready: false, now }).rows;
        if (statuses) {
            statuses.show({ page: pg.rows.map((r) => r.id), all: everyone.map((r) => r.id), opened: everyone.filter((r) => r.hit && r.hit.kind === 'opened').map((r) => r.id), readAt: new Map(everyone.map((r) => [Number(r.id), r.statusAt || 0])) });
        }
        const msg = targetsMessage({ paused: ctx.paused, error: e.error(), loading: e.loading(), stored });
        let body;
        if (!ctx.flags.hasFfs) body = h('p', { class: 'muted', style: 'margin:0' }, ['Targets come from FFScouter. ', h('a', { href: '#settings', onclick: (ev) => { ev.preventDefault(); ctx.go('settings'); }, text: 'Connect it in Settings' }), '; chips on Torn’s pages work without it (your fights and public stats).']);
        else if (!rows.length) {
            const text = msg.kind !== 'none' ? msg.text : list.counts.all ? (f.ready && list.hidden ? 'Nobody ready now: ' + list.hidden + ' hidden (hospital, away, jail or just hit).' : 'Nobody in this band.') : 'No targets yet.';
            body = h('p', { class: msg.kind === 'dead' || msg.kind === 'error' ? 'c-bad' : 'muted', style: 'margin:0' }, [text, msg.kind === 'dead' ? h('span', {}, [' · ', h('a', { href: '#settings', onclick: (ev) => { ev.preventDefault(); ctx.go('settings'); }, text: 'check it in Settings' })]) : null]);
        } else body = targetsTable(pg.rows, { now, ctx, checking });
        const notes = [];
        const d = (stored && stored.dropped) || {};
        if (stored && stored.list && stored.list.length) {
            if (d.low) notes.push(d.low + ' player' + (d.low === 1 ? '' : 's') + ' you’d keep under 50% HP against dropped (never kept)');
            if (d.none) notes.push(d.none + ' with no estimate dropped');
            if (stored.ffIgnored) notes.push('FFScouter’s list ignored the strength range this time; our own fight check still decided');
        }
        // A load that failed still says so above an older list.
        const warnLine = rows.length && (msg.kind === 'error' || msg.kind === 'dead' || msg.kind === 'wait' || msg.kind === 'paused') ? h('div', { class: 'why', style: 'margin-bottom:8px', text: msg.text + (stored && stored.at ? ' · showing the list from ' + clock(stored.at, ctx.settings) : '') }) : null;
        // "Statuses: 40 of 600 checked · this page first · the rest in about 19 min" (every listed row, whatever the chips).
        const known = new Set(everyone.filter((r) => rowState(r, now) !== 'unknown').map((r) => r.id));
        const prog = statusProgress(everyone.map((r) => r.id), (id) => known.has(id));
        const progress = checking && prog.total ? h('div', { class: 'eye-bg' }, [h('div', { class: 'track' }, [h('div', { class: 'fill', style: 'width:' + Math.round((100 * prog.checked) / prog.total) + '%' })]), h('span', { 'data-eye-progress': '1', text: statusLine(prog) })]) : null;
        main.push(
            h('div', { class: 'lead', 'data-mode': mode }, [
                sectionHead('Targets', meta([rows.length + ' players you beat' + (rows.length ? ' · ' + pg.from + '–' + pg.to + ' shown' : '') + ' · win and HP kept from your stats against theirs'])),
                warnLine,
                ui.eyeNote ? h('div', { class: 'why', style: 'margin-bottom:8px', text: ui.eyeNote }) : null,
                body,
                rows.length > PAGE_SIZE || pg.page > 0 ? pager(pg, ctx) : null,
                progress,
                notes.length ? h('div', { class: 'note2', text: notes.join(' · ') + '.' }) : null,
                h('div', { class: 'note2', text: 'Only players you beat keeping half your HP or more are kept: FFScouter is asked for players up to 75% of your strength (the most respect Torn gives), by levels, then each one is checked with the fight model. Click a row for its details.' }),
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
            h('div', { class: 'note2' }, ['Estimates by ', h('a', { href: FFS_SITE_URL, target: '_blank', rel: 'noopener', text: 'FFScouter' }), '. Bands by the HP you keep over the fights you win: Stomp 99%+, Good 70–99%, Fair 50–69%.']),
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
