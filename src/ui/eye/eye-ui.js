/*
 * Torn Eye on Torn's pages (round 7, mockups/round7/overlays.html): one look
 * for everything we draw there, an opaque near-black tag with the plate
 * mark, a coloured edge, a 1 px border and (on the one thing per page that
 * matters most) a soft glow in its colour. The numbers that decide a fight
 * are big and always in the list's order: respect, HP kept, win.
 *
 * Never on top of Torn's content and never inside a cell other scripts
 * restyle: the profile card and the list tags sit in the free space beside
 * Torn's page (never a line on it: smaller type instead), the mini-profile
 * gets one line of its own, the attack page's card sits beside the fight.
 * Never the words FF or fair fight. FFScouter is credited wherever its
 * numbers show. Segoe UI / system-ui only (Torn's page can't load fonts).
 */

import { h, fill } from '../dom.js';
import { BAND_WORDS, BAND_COLORS } from '../../core/eye/bands.js';
import { BUILD_WORDS } from '../../core/eye/fight.js';
import { FFS_SITE_URL } from '../../api/ffscouter.js';

const EYE_FONT = "'Segoe UI', system-ui, -apple-system, sans-serif";

export const EYE_CSS = `
.pi-mark.pi-eye, .pi-mark.pi-eye *, .pi-hovercard, .pi-hovercard * { box-sizing: border-box; font-family: ${EYE_FONT}; letter-spacing: normal; text-transform: none; text-shadow: none; }
.pi-eye { --b: #efebe2; color: #f2f3f5; font-size: 13px; line-height: 1.3; text-align: left; }
#pi-eye-layer { position: absolute; left: 0; top: 0; width: 0; height: 0; overflow: visible; z-index: 9990; }
#pi-eye-layer > *, #pi-eye-layer > * > * { position: absolute; }
#pi-eye-layer .pi-tag { width: max-content; }
.pi-eye .pi-edge { align-self: stretch; width: 5px; flex: none; background: var(--b); }
.pi-eye .pi-mk { width: 14px; height: 14px; border-radius: 50%; background: #efebe2; box-shadow: inset 0 0 0 3px #efebe2, inset 0 0 0 4px #2a2d31; display: inline-grid; place-items: center; flex: none; }
.pi-eye .pi-mk i { width: 4px; height: 4px; border-radius: 50%; background: #15171a; }
.pi-eye .pi-band { font-weight: 700; letter-spacing: .6px; text-transform: uppercase; color: var(--b); white-space: nowrap; }
.pi-eye .pi-sep { width: 1px; align-self: stretch; margin: 6px 0; background: #2f3439; flex: none; }
.pi-eye .pi-fig { color: #c9cdd2; font-size: 12px; white-space: nowrap; }
.pi-eye .pi-fig b { color: #fff; font-size: 14px; font-weight: 700; font-variant-numeric: tabular-nums; }
.pi-eye .pi-src, .pi-eye .pi-muted { color: #9aa1a8; font-size: 12px; }
.pi-eye .pi-src { font-size: 11px; }
.pi-eye .pi-muted a, .pi-eye .pi-src a { color: #8fb8e8; }
.pi-eye.pi-tag { display: flex; align-items: center; gap: 8px; min-height: 26px; padding: 0 10px 0 0; border-radius: 6px; background: #101214; border: 1px solid color-mix(in srgb, var(--b) 55%, transparent); box-shadow: 0 2px 8px rgba(0,0,0,.4); overflow: hidden; white-space: nowrap; cursor: default; }
.pi-eye.pi-tag .pi-band { font-size: 12px; }
.pi-eye.pi-glow { box-shadow: 0 0 0 3px color-mix(in srgb, var(--b) 14%, transparent), 0 0 16px color-mix(in srgb, var(--b) 24%, transparent), 0 2px 8px rgba(0,0,0,.4); }
.pi-eye.pi-dimmed { opacity: .5; }
.pi-eye.pi-short { gap: 6px; padding-right: 7px; }
.pi-eye.pi-short .pi-fig b { font-size: 12px; }
.pi-eye.pi-sum { white-space: normal; padding: 4px 10px 4px 0; min-height: 30px; }
.pi-eye.pi-sum .pi-sumtext { min-width: 0; }
.pi-eye.pi-sum.pi-short { font-size: 11px; line-height: 1.25; }
.pi-eye.pi-sum .pi-edge { align-self: stretch; margin: -4px 0; }
.pi-eye.pi-sum b { color: #fff; font-weight: 700; }
.pi-eye.pi-edgebar { width: 4px; border-radius: 2px; background: var(--b); pointer-events: none; }
.pi-eye.pi-mini-line { display: block; width: 100%; max-width: 100%; margin: 8px 0 0; clear: both; }
.pi-eye.pi-mini-line .pi-tag { width: 100%; }
.pi-eye.pi-card { background: #101214; border: 1px solid color-mix(in srgb, var(--b) 45%, #3a4046); border-radius: 10px; box-shadow: 0 8px 26px rgba(0,0,0,.6); overflow: hidden; }
.pi-eye.pi-card.pi-glow { box-shadow: 0 0 0 3px color-mix(in srgb, var(--b) 14%, transparent), 0 0 18px color-mix(in srgb, var(--b) 22%, transparent), 0 8px 26px rgba(0,0,0,.6); }
.pi-card .pi-ribbon { height: 4px; background: var(--b); }
.pi-card .pi-top { display: flex; align-items: center; gap: 10px; padding: 10px 14px; border-bottom: 1px solid #262a2e; min-width: 0; }
.pi-card .pi-top .pi-band { font-size: 16px; }
.pi-card .pi-who { color: #fff; font-weight: 700; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pi-card .pi-bd { padding: 10px 14px; display: flex; flex-direction: column; gap: 8px; }
.pi-card .pi-big3 { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.pi-card .pi-big3 > div { background: #181b1e; border-radius: 6px; padding: 6px 8px; }
.pi-card .pi-big3 small { display: block; color: #9aa1a8; font-size: 10px; letter-spacing: .5px; text-transform: uppercase; }
.pi-card .pi-big3 b { font-size: 20px; font-weight: 700; color: #fff; font-variant-numeric: tabular-nums; }
.pi-card .pi-stack { display: grid; grid-template-columns: auto minmax(0, 1fr); row-gap: 2px; column-gap: 8px; align-items: baseline; }
.pi-card .pi-stack span { color: #9aa1a8; font-size: 10px; letter-spacing: .5px; text-transform: uppercase; }
.pi-card .pi-stack b { font-size: 17px; font-weight: 700; color: #fff; text-align: right; font-variant-numeric: tabular-nums; }
.pi-card .pi-row2 { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 12px; }
.pi-card .pi-meter { height: 6px; border-radius: 3px; background: #2a2e33; overflow: hidden; }
.pi-card .pi-meter i { display: block; height: 100%; background: var(--b); }
.pi-card .pi-warnline { color: #e8a33d; font-weight: 700; font-size: 12px; }
.pi-card .pi-good { color: #9bdc8a; font-weight: 700; font-size: 12px; }
.pi-card.pi-mid .pi-top, .pi-card.pi-mid .pi-bd { padding: 8px 10px; }
.pi-card.pi-mid .pi-top { gap: 6px; }
.pi-card.pi-mid .pi-top .pi-band { font-size: 14px; }
.pi-card.pi-mid .pi-who { font-size: 11px; font-weight: 400; color: #c9cdd2; }
.pi-card.pi-mid .pi-muted { font-size: 11px; }
.pi-card.pi-small .pi-top, .pi-card.pi-small .pi-bd { padding: 6px 8px; }
.pi-card.pi-small .pi-top .pi-band { font-size: 13px; }
.pi-card.pi-small .pi-stack b { font-size: 15px; }
.pi-card.pi-small .pi-stack { column-gap: 6px; }
.pi-eye.pi-card.pi-fixed { position: fixed; z-index: 9991; overflow: hidden auto; }
.pi-warlist { display: flex !important; flex-direction: column; }
.pi-eye .pi-watch { display: inline-flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; }
.pi-eye .pi-watch button, .pi-eye .pi-watch select, .pi-eye .pi-watch input { height: 24px; border-radius: 5px; border: 1px solid color-mix(in srgb, #efebe2 45%, transparent); background: #1c1f22; color: #fff; font: 700 11px ${EYE_FONT}; padding: 0 9px; cursor: pointer; margin: 0; }
.pi-eye .pi-watch input { cursor: text; width: 120px; font-weight: 400; }
.pi-eye .pi-watch select { padding: 0 4px; max-width: 120px; }
.pi-eye .pi-watch button[aria-pressed="true"] { color: #101214; background: #efebe2; border-color: #efebe2; }
.pi-eye .pi-watch .pi-full { color: #e8a33d; font-size: 11px; }
.pi-hovercard { position: fixed; z-index: 99991; width: 330px; background: #101214; border: 1px solid #3a4046; border-radius: 10px; padding: 12px 14px; box-shadow: 0 8px 24px rgba(0,0,0,.5); display: flex; flex-direction: column; gap: 10px; font-size: 12px; line-height: 1.4; color: #e3e5e8; pointer-events: none; text-align: left; }
.pi-hovercard .pi-hh { display: flex; align-items: baseline; gap: 8px; }
.pi-hovercard .pi-hh b.pi-name { color: #fff; font-size: 14px; }
.pi-hovercard .pi-lab { font-size: 11px; font-weight: 700; letter-spacing: .5px; text-transform: uppercase; color: #939aa1; }
.pi-hovercard .pi-kept { display: grid; grid-template-columns: 80px minmax(0,1fr) 40px; gap: 8px; align-items: center; }
.pi-hovercard { max-height: calc(100vh - 16px); overflow: hidden; }
.pi-hovercard.pi-mid, .pi-hovercard.pi-small { padding: 8px 10px; gap: 6px; font-size: 11px; }
.pi-hovercard.pi-mid .pi-kept { grid-template-columns: minmax(0,1fr) 48px 32px; gap: 6px; }
.pi-hovercard.pi-small .pi-kept { grid-template-columns: minmax(0,1fr) auto; gap: 6px; }
.pi-hovercard.pi-small .pi-bar { display: none; }
.pi-hovercard.pi-small .pi-hh { flex-wrap: wrap; }
.pi-hovercard.pi-small .pi-hh b.pi-name { font-size: 12px; }
.pi-hovercard .pi-bar { height: 6px; border-radius: 3px; background: #24282c; overflow: hidden; }
.pi-hovercard .pi-bar i { display: block; height: 100%; }
.pi-hovercard .pi-foot { font-size: 11px; color: #939aa1; border-top: 1px solid #2c3136; padding-top: 8px; }
.pi-hovercard .pi-warnline { color: #e8a33d; font-weight: 700; }
`;

export function ensureEyeCss(doc = document) {
    if (doc.getElementById('pi-eye-css')) return;
    const st = doc.createElement('style');
    st.id = 'pi-eye-css';
    st.textContent = EYE_CSS;
    (doc.head || doc.documentElement).appendChild(st);
}

/* ------------------------------------------------------------ bands and figures */

const EYE_NO_BAND = '#6c737a';

export function eyeBandColor(band) {
    return BAND_COLORS[band] || EYE_NO_BAND;
}

export function eyeBandWord(band) {
    return BAND_WORDS[band] || BAND_WORDS.none || 'No data';
}

/**
 * Whether a list row gets a tag: a band that says something, and never a fight where you'd keep under half your HP
 * (owner, round 7: "under 50% never listed"): bands.js's 'low' ("Under 50%") and 'none' are never drawn on a row;
 * words and colours come from bands.js.
 */
export function eyeShown(v) {
    if (!v || !v.band || v.band === 'none' || v.band === 'low' || !BAND_COLORS[v.band]) return false;
    const f = v.forecast;
    return !(f && Number.isFinite(f.keep) && f.keep < 0.5);
}

/**
 * The three numbers, always in this order: respect, HP kept, win.
 * @returns {{k: 'respect'|'keep'|'win', label: string, short: string, text: string}[]}
 */
export function eyeFigures(v) {
    const f = v && v.forecast;
    const respect = v && Number.isFinite(v.respect) && v.respect > 0 ? v.respect.toFixed(2) : '—';
    const keep = f && f.pWin >= 0.05 && Number.isFinite(f.keep) ? Math.round(f.keep * 100) + '%' : '—';
    const win = f && Number.isFinite(f.pWin) ? Math.round(f.pWin * 100) + '%' : '—';
    return [
        { k: 'respect', label: 'Respect', short: 'Resp', text: respect },
        { k: 'keep', label: 'HP kept', short: 'HP', text: keep },
        { k: 'win', label: 'Win', short: 'Win', text: win },
    ];
}

/** "all 99%" / "70–74%": HP kept over their likely builds; '' when the stats are exact or there are none. */
export function eyeBuildsText(f) {
    if (!f || f.exact || !f.perBuild) return '';
    const ks = Object.values(f.perBuild).filter((r) => r && r.pWin >= 0.05 && Number.isFinite(r.keep)).map((r) => Math.round(r.keep * 100));
    if (!ks.length) return '';
    const lo = Math.min(...ks);
    const hi = Math.max(...ks);
    return lo === hi ? 'all ' + lo + '%' : lo + '–' + hi + '%';
}

/** Hours and minutes: "1:17" (an hour and 17 minutes), "0:48". */
export function eyeHmm(s) {
    const m = Math.max(0, Math.ceil(Number(s) / 60));
    return Math.floor(m / 60) + ':' + String(m % 60).padStart(2, '0');
}

/** Seconds left in a Torn status cell's clock ("Hospital 01:17:00", "42:10"); null when it shows none. */
export function eyeStatusSeconds(text) {
    const t = String(text || '');
    let m = t.match(/(\d{1,3}):(\d{2}):(\d{2})/);
    if (m) return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
    m = t.match(/(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/* ------------------------------------------------------------ where things go */

/** Free space thresholds (owner's pick): full card from 300 px, the narrower card from 160, the left side under 130. */
export const EYE_FREE = { full: 300, mid: 160, left: 130, least: 80 };
export const EYE_CARD_W = 300;

/** The least free width a list's tags can use (the 'tiny' tag, 58 px, and its 6 px a side). */
export const EYE_ROW_LEAST = 70;

/**
 * The side Torn Eye uses: the right, unless it is narrow and the left is wider. `avoid` (round 7 review): the training
 * panel's rect; when it sits in that side's free space and the other side has at least `least` px, the other side, so
 * the panel and Torn Eye's tags never share a margin (both stay off Torn's page).
 */
function eyeSide(viewW, page, avoid = null, least = 0) {
    const right = Math.max(0, Math.floor(viewW - page.right));
    const left = Math.max(0, Math.floor(page.left));
    const useLeft = right < EYE_FREE.left && left > right;
    let side = useLeft ? 'left' : 'right';
    if (avoid && avoid.width > 0 && avoid.height > 0) {
        const takes = (s) => (s === 'right' ? avoid.right > page.right && avoid.left < viewW : avoid.left < page.left && avoid.right > 0);
        const other = side === 'right' ? 'left' : 'right';
        if (takes(side) && !takes(other) && (other === 'right' ? right : left) >= least) side = other;
    }
    return { side, free: side === 'left' ? left : right };
}

/**
 * Where a card goes in the free space beside Torn's page (never on it).
 * @param {number} viewW - the window's width without its scrollbar
 * @param {{left: number, right: number}} page - Torn's page (sidebar + content)
 * @param {DOMRect|null} [avoid] - the training panel, whose margin the card leaves when the other one has room
 * @returns {{mode: 'full'|'mid'|'small'|'none', side: 'left'|'right', free: number, x: number, width: number}}
 */
export function eyeCardSpot(viewW, page, avoid = null) {
    const { side, free } = eyeSide(viewW, page, avoid, EYE_FREE.least);
    if (free < EYE_FREE.least) return { mode: 'none', side, free, x: 0, width: 0 };
    const mode = free >= EYE_FREE.full ? 'full' : free >= EYE_FREE.mid ? 'mid' : 'small';
    const pad = mode === 'full' ? 12 : mode === 'mid' ? 8 : 6;
    const width = mode === 'full' ? Math.min(EYE_CARD_W, free - 2 * pad) : free - 2 * pad;
    const x = side === 'right' ? page.right + pad : page.left - pad - width;
    return { mode, side, free, x: Math.round(x), width: Math.round(width) };
}

/**
 * Where list tags go, level with each row: 'full' (band word and the three numbers), 'short' (the three numbers;
 * the edge carries the band), 'tiny' (HP kept), 'none' (no room: only the row edges).
 */
export function eyeRowSpot(viewW, page, avoid = null) {
    const { side, free } = eyeSide(viewW, page, avoid, EYE_ROW_LEAST);
    const pad = free >= EYE_FREE.mid ? 10 : 6;
    const w = Math.min(250, free - 2 * pad);
    const mode = w >= 190 ? 'full' : w >= 118 ? 'short' : w >= 58 ? 'tiny' : 'none';
    const x = side === 'right' ? page.right + pad : page.left - pad - Math.max(0, w);
    return { mode, side, free, x: Math.round(x), width: Math.max(0, Math.round(w)) };
}

/* ------------------------------------------------------------ the pieces */

function eyeMk() {
    return h('span', { class: 'pi-mk', 'aria-hidden': 'true' }, [h('i')]);
}

function eyeSourceTitle(v) {
    if (!v) return 'Torn Eye';
    const parts = ['Torn Eye'];
    if (v.est && v.est.source === 'ffscouter') parts.push('stats: FFScouter (ffscouter.com), ' + (v.est.ageDays ?? '?') + ' d old');
    else if (v.source) parts.push('stats: ' + v.source);
    const b = eyeBuildsText(v.plain || v.forecast);
    if (b) parts.push('their likely builds: ' + b);
    return parts.join(' · ');
}

function eyeFigSpans(v, mode) {
    const fs = eyeFigures(v);
    if (mode === 'tiny') return [h('span', { class: 'pi-fig' }, [h('b', { text: fs[1].text }), ' HP'])];
    return [h('span', { class: 'pi-fig' }, [h('b', { text: fs[0].text })]), h('span', { class: 'pi-fig' }, [h('b', { text: fs[1].text }), ' HP']), h('span', { class: 'pi-fig' }, [h('b', { text: fs[2].text })])];
}

/**
 * A list row's tag. `state` is the row's: ready rows show the numbers; a row in hospital (dimmed) when it is out.
 * @param {object} v - eyeView()
 * @param {object} o - {mode, state: 'okay'|'early'|'hospital'|'traveling'|'abroad'|'jail', outInS, outAt, landText, glow}
 *   outAt: when they are out (epoch seconds): the "out in" clock is then moved on by eyeTickOut, not by a redraw
 */
export function eyeRowTag(v, { mode = 'full', state = 'okay', outInS = null, outAt = null, landText = null, glow = false } = {}) {
    const ready = state === 'okay' || state === 'early';
    const kids = [h('span', { class: 'pi-edge' })];
    if (mode === 'full') kids.push(h('span', { class: 'pi-band', text: eyeBandWord(v.band) }));
    if (ready) {
        kids.push(...eyeFigSpans(v, mode));
        if (state === 'early' && mode !== 'tiny') kids.push(h('span', { class: 'pi-src', text: 'out early' }));
    } else if (state === 'hospital' && Number.isFinite(outInS)) {
        kids.push(h('span', { class: 'pi-fig' }, ['out in ', h('span', { 'data-pi-out-at': Number.isFinite(outAt) ? String(outAt) : null, text: eyeHmm(outInS) })]));
    } else {
        const what = state === 'hospital' ? 'in hospital' : state === 'traveling' ? landText || 'traveling' : state === 'abroad' ? 'abroad' : state === 'jail' ? 'in jail' : state;
        kids.push(h('span', { class: 'pi-fig', text: what }));
    }
    const cls = 'pi-mark pi-eye pi-tag pi-rowtag' + (mode !== 'full' ? ' pi-short' : '') + (ready ? '' : ' pi-dimmed') + (glow && ready ? ' pi-glow' : '');
    return h('div', { class: cls, style: '--b:' + eyeBandColor(v.band), 'data-pi-player': String(v.id || ''), 'data-pi-hover': '1', title: eyeSourceTitle(v), tabindex: '0', role: 'button', 'aria-label': eyeBandWord(v.band) + ' · ' + eyeFigures(v).map((x) => x.label + ' ' + x.text).join(' · ') }, kids);
}

/** The 4 px band edge beside a row, on our own layer. */
export function eyeEdgeBar(band, dim = false) {
    return h('div', { class: 'pi-mark pi-eye pi-edgebar', style: '--b:' + eyeBandColor(band) + (dim ? ';opacity:.35' : ''), 'aria-hidden': 'true' });
}

/**
 * The summary over a list, as numbers: ready (okay or out early), in hospital (and when the next one is out),
 * traveling.
 * @param {object[]} rows - sortWar() rows ({state, until})
 */
export function eyeSummary(rows, nowS) {
    const ready = rows.filter((r) => r.state === 'okay' || r.state === 'early').length;
    const hosp = rows.filter((r) => r.state === 'hospital');
    const outs = hosp.filter((r) => r.until > nowS).map((r) => r.until - nowS);
    const nextOutS = outs.length ? Math.min(...outs) : null;
    return { ready, early: rows.filter((r) => r.state === 'early').length, hospital: hosp.length, nextOutS, nextOutAt: nextOutS === null ? null : nowS + nextOutS, traveling: rows.filter((r) => r.state === 'traveling').length };
}

/** "2 ready · 1 out in 1:17 · 0 traveling". */
export function eyeSummaryText(s) {
    const parts = [s.ready + ' ready' + (s.early ? ' (' + s.early + ' out early)' : '')];
    if (s.nextOutS !== null && s.nextOutS !== undefined) parts.push('1 out in ' + eyeHmm(s.nextOutS));
    else if (s.hospital) parts.push(s.hospital + ' in hospital');
    parts.push(s.traveling + ' traveling');
    return parts.join(' · ');
}

/** The summary tag on top of a list. `note` (where the numbers come from) goes in its title. */
export function eyeSummaryTag(s, { note = '', fromFfs = false, short = false } = {}) {
    const words = [];
    eyeSummaryText(s).split(' · ').forEach((p, i) => {
        if (i) words.push(' · ');
        const m = p.match(/^(\d+)(.*)$/);
        // "1 out in 1:17": its clock moves on by eyeTickOut (no redraw every second).
        const out = m && Number.isFinite(s.nextOutAt) && /^ out in /.test(m[2]);
        words.push(out ? h('span', {}, [h('b', { text: m[1] }), ' out in ', h('span', { 'data-pi-out-at': String(s.nextOutAt), text: m[2].replace(/^ out in /, '') })]) : m ? h('span', {}, [h('b', { text: m[1] }), m[2]]) : h('span', { text: p }));
    });
    if (fromFfs) words.push(h('span', { class: 'pi-src' }, [' · stats: ', h('a', { href: FFS_SITE_URL, target: '_blank', rel: 'noopener', text: 'FFScouter' })]));
    return h('div', { class: 'pi-mark pi-eye pi-tag pi-sum' + (short ? ' pi-short' : ''), title: note || 'Torn Eye' }, [h('span', { class: 'pi-edge' }), short ? null : eyeMk(), h('span', { class: 'pi-sumtext' }, words)]);
}

/** Move every "out in" clock on (they carry data-pi-out-at); only the ones whose minute changed are written. */
export function eyeTickOut(root, nowS) {
    if (!root || !root.querySelectorAll) return 0;
    let n = 0;
    for (const el of root.querySelectorAll('[data-pi-out-at]')) {
        const text = eyeHmm(Math.max(0, Number(el.getAttribute('data-pi-out-at')) - nowS));
        if (el.textContent !== text) {
            el.textContent = text;
            n++;
        }
    }
    return n;
}

/*
 * "Out early" (round 7 review: it lasted about a second). A member is out early when the last reading had them in
 * hospital with an end still ahead and this one shows them okay. Before, only the reading just before counted, and
 * the list was redrawn every second (the hospital clock in the status text ticks), so the next draw forgot them. They
 * are now kept until the hospital end they had passes, or their state changes again.
 */

/**
 * @param {Map<number, number>|null} prevEarly - id → the hospital end they left before (epoch seconds)
 * @param {object[]|null} prevMembers - the last reading ({id, status: {state, until}})
 * @param {object[]} members - this reading
 * @param {number} nowS
 * @param {function} stateOf - war.js memberState
 * @returns {Map<number, number>}
 */
export function eyeNextEarly(prevEarly, prevMembers, members, nowS, stateOf) {
    const before = new Map((prevMembers || []).map((m) => [Number(m.id), m]));
    const out = new Map();
    for (const m of members || []) {
        const id = Number(m.id);
        if (stateOf(m) !== 'okay') continue;
        const kept = prevEarly && prevEarly.get(id);
        if (Number.isFinite(kept) && kept > nowS) {
            out.set(id, kept);
            continue;
        }
        const p = before.get(id);
        const until = p && stateOf(p) === 'hospital' ? Number(p.status && p.status.until) || 0 : 0;
        if (until > nowS + 30) out.set(id, until);
    }
    return out;
}

/**
 * What a list's look depends on, without the ticking clocks: each row's id and state. `early`: the ids out early now.
 * A hospital end that moved is eyeUntilMoved's (read from a clock that ticks, it wobbles by a second).
 */
export function eyeRowsSig(members, stateOf, early = null) {
    const rows = (members || []).map((m) => m.id + ':' + stateOf(m));
    return rows.join(',') + (early && early.size ? '|early:' + [...early.keys()].sort((a, b) => a - b).join(',') : '');
}

/** Did any row's hospital end move by more than `slack` seconds (hospitalised again, a revive)? */
export function eyeUntilMoved(prevMembers, members, slack = 30) {
    const before = new Map((prevMembers || []).map((m) => [Number(m.id), Number(m.status && m.status.until) || 0]));
    return (members || []).some((m) => {
        const was = before.get(Number(m.id));
        return was !== undefined && Math.abs((Number(m.status && m.status.until) || 0) - was) > slack;
    });
}

/* ------------------------------------------------------------ watch */

/** The watch reasons offered on Torn's pages (the webpage offers the same, plus your own words there). */
export const WATCH_TAG_WORDS = ['hospitalize', 'mug', 'revenge', 'bounty'];

/**
 * "☆ Watch" / "★ Watching" with the reason picker when watched.
 * @param {object} s - {watching, tag, full}
 * @param {object} on - {toggle(), tag(value)}
 */
export function watchControl(s, on) {
    const kids = [h('button', { type: 'button', 'aria-pressed': String(Boolean(s.watching)), title: s.watching ? 'Torn Eye is watching this player · click to stop' : 'Watch this player in Torn Eye (status, hospital, flights)', onclick: (e) => { e.preventDefault(); e.stopPropagation(); on.toggle(); }, text: s.watching ? '★ Watching' : '☆ Watch' })];
    if (s.watching && on.tag) {
        const tag = s.tag || '';
        const custom = tag && !WATCH_TAG_WORDS.includes(tag);
        const sel = h('select', { 'aria-label': 'Why you watch them', onchange: (e) => { if (e.target.value === '__custom') { const inp = h('input', { maxlength: '24', placeholder: 'your reason', 'aria-label': 'Your reason', onkeydown: (ev) => { if (ev.key === 'Enter') on.tag(ev.target.value); } }); inp.addEventListener('blur', () => on.tag(inp.value)); sel.replaceWith(inp); inp.focus(); } else on.tag(e.target.value || null); } }, [
            h('option', { value: '', text: 'no reason' }),
            ...WATCH_TAG_WORDS.map((x) => h('option', { value: x, text: x })),
            custom ? h('option', { value: tag, text: tag }) : null,
            h('option', { value: '__custom', text: 'your own…' }),
        ]);
        sel.value = tag;
        kids.push(sel);
    }
    if (s.full) kids.push(h('span', { class: 'pi-full', text: 'Watch list full' }));
    return h('span', { class: 'pi-watch', 'data-pi-watch': [s.watching ? 1 : 0, s.tag || '', s.full ? 1 : 0].join('|') }, kids);
}

/* ------------------------------------------------------------ cards */

function eyeStatusLine(st) {
    if (!st) return '';
    return String(st.description || st.state || '').replace(/<[^>]*>/g, '').trim();
}

function eyeSourceLine(v, short) {
    if (!v || !v.est) return h('div', { class: 'pi-muted', text: v && v.shared ? 'from war mode on the Torn Eye tab' : 'no estimate yet' });
    const b = short ? '' : eyeBuildsText(v.plain || v.forecast);
    if (v.est.source === 'ffscouter') return h('div', { class: 'pi-muted' }, [h('a', { href: FFS_SITE_URL, target: '_blank', rel: 'noopener', text: 'FFScouter' }), ' ' + (v.est.ageDays ?? '?') + ' d' + (b ? ' · their likely builds: ' + b : '')]);
    return h('div', { class: 'pi-muted', text: (v.source || '') + (b ? ' · their likely builds: ' + b : '') });
}

function eyeNumbers(v, mode) {
    const fs = eyeFigures(v);
    if (mode === 'full') return h('div', { class: 'pi-big3' }, fs.map((x) => h('div', { 'data-pi-fig': x.k }, [h('small', { text: x.label }), h('b', { text: x.text })])));
    const kids = [];
    for (const x of fs) kids.push(h('span', { text: mode === 'small' ? x.short : x.label }), h('b', { 'data-pi-fig': x.k, text: x.text }));
    return h('div', { class: 'pi-stack' }, kids);
}

function eyeCardShell(v, mode, { id = null, who = '', hover = false } = {}) {
    const band = v ? v.band : 'none';
    const top = [];
    if (mode === 'full') top.push(eyeMk());
    top.push(h('span', { class: 'pi-band', text: v ? eyeBandWord(band) : 'Torn Eye' }));
    if (who && mode !== 'small') top.push(h('span', { class: 'pi-who', text: who }));
    const bd = h('div', { class: 'pi-bd' });
    const el = h('div', { class: 'pi-mark pi-eye pi-card pi-' + mode, style: '--b:' + eyeBandColor(band), 'data-pi-player': String(id || (v && v.id) || ''), 'data-pi-mode': mode, title: mode === 'small' ? eyeSourceTitle(v) : null, 'data-pi-hover': hover ? '1' : null, tabindex: hover ? '0' : null }, [h('div', { class: 'pi-ribbon' }), h('div', { class: 'pi-top' }, top), bd]);
    return { el, bd };
}

function eyeWhoText(v, mode) {
    if (!v) return '';
    const lvl = v.level ? '[' + v.level + ']' : '';
    if (mode === 'mid') return lvl;
    return ((v.name || '') + (lvl ? ' ' + lvl : '')).trim();
}

/**
 * The profile card, in the free space beside Torn's page. Full: the three numbers in boxes, the source, ★ Watch and
 * their status. Mid: the same narrower, the numbers stacked. Small: the band word and the three numbers (the rest
 * in its title and the hover card).
 * @param {object|null} v - eyeView() (null while reading)
 * @param {'full'|'mid'|'small'} mode
 * @param {object} o - {id, watch: {state, on}, glow}
 */
export function eyeProfileCard(v, mode, { id = null, watch = null, glow = true } = {}) {
    const { el, bd } = eyeCardShell(v, mode, { id, who: eyeWhoText(v, mode), hover: mode === 'small' });
    // The one Torn Eye card on a page (here or the attack page's): the training panel docks under #pi-eyecard.
    el.id = 'pi-eyecard';
    if (glow) el.classList.add('pi-glow');
    if (!v) {
        if (mode !== 'small') bd.appendChild(h('div', { class: 'pi-muted', text: 'Reading this player…' }));
        return el;
    }
    bd.appendChild(eyeNumbers(v, mode));
    if (mode === 'small') return el;
    bd.appendChild(eyeSourceLine(v, mode === 'mid'));
    const w = watch ? watchControl(watch.state, mode === 'full' ? watch.on : { toggle: watch.on.toggle }) : null;
    if (mode === 'full') {
        const st = eyeStatusLine(v.status);
        bd.appendChild(h('div', { class: 'pi-row2' }, [w, st ? h('span', { class: 'pi-muted', text: st }) : null]));
    } else if (w) bd.appendChild(w);
    return el;
}

/**
 * The attack page's fight card: band, the three numbers, turns and the gear note, HP kept per likely build. The
 * training panel docks under it (#pi-eyecard), so its foot is left free.
 * @param {object|null} v - eyeView()
 * @param {'full'|'mid'|'small'} mode
 * @param {object} s - {gearVisible, gearSaved, watch: {watching, tag, full, toggle}}
 */
export function eyeFightCard(v, mode, s = {}) {
    const { el, bd } = eyeCardShell(v, mode, { who: eyeWhoText(v, mode), hover: mode === 'small' });
    el.id = 'pi-eyecard';
    el.classList.add('pi-glow', 'pi-fixed');
    const watchBtn = () => (s.watch ? watchControl({ watching: s.watch.watching, tag: null, full: s.watch.full }, { toggle: s.watch.toggle }) : null);
    if (!v) {
        if (mode !== 'small') {
            bd.appendChild(h('div', { class: 'pi-muted', text: 'Reading this player… (your fights, FFScouter, public stats)' }));
            const w = watchBtn();
            if (w) bd.appendChild(w);
        }
        return el;
    }
    bd.appendChild(eyeNumbers(v, mode));
    if (mode === 'small') return el;
    const f = v.forecast;
    const gear = s.gearSaved ? 'their gear is saved for next time' : s.gearVisible ? '' : 'their gear shows once the fight starts';
    const turns = f && f.turns ? 'About ' + f.turns + ' turns' : '';
    const line = [turns, turns ? gear : gear.charAt(0).toUpperCase() + gear.slice(1)].filter(Boolean).join(' · ');
    if (line) bd.appendChild(h('div', { class: s.gearSaved ? 'pi-good' : 'pi-muted', text: line }));
    if (v.gear) bd.appendChild(h('div', { class: 'pi-muted', text: 'Last seen: ' + (v.gear.text || 'gear') + ' · ' + Math.max(0, Math.round((Date.now() - v.gear.seenAt) / 86400000)) + ' d ago' }));
    if (v.withGear && mode === 'full') bd.appendChild(h('div', { class: 'pi-warnline', text: 'With their gear: win ' + Math.round(v.withGear.pWin * 100) + '% · HP kept ~' + Math.round((v.withGear.keep || 0) * 100) + '%' }));
    const p = v.plain || f;
    if (mode === 'full' && p && p.perBuild && !p.exact) {
        const rows = Object.entries(p.perBuild).sort((a, b) => (b[1].keep || 0) - (a[1].keep || 0)).slice(0, 3);
        for (const [k, r] of rows) {
            const pct = Math.round((r.keep || 0) * 100);
            bd.appendChild(h('div', { class: 'pi-row2' }, [h('span', { class: 'pi-muted', text: BUILD_WORDS[k] || k }), h('span', { text: r.pWin < 0.05 ? 'lose' : pct + '%' })]));
            bd.appendChild(h('div', { class: 'pi-meter' }, [h('i', { style: 'width:' + (r.pWin < 0.05 ? 0 : pct) + '%' })]));
        }
    }
    bd.appendChild(eyeSourceLine(v, true));
    const w = watchBtn();
    if (w) bd.appendChild(w);
    return el;
}

/** The mini-profile's last line: one tag inside the popup's width. */
export function eyeMiniLine(v, { id = null, glow = false } = {}) {
    const band = v ? v.band : 'none';
    const kids = [h('span', { class: 'pi-edge' }), eyeMk(), h('span', { class: 'pi-band', text: eyeBandWord(band) })];
    if (v && v.forecast) {
        kids.push(h('span', { class: 'pi-sep' }));
        const fs = eyeFigures(v);
        kids.push(h('span', { class: 'pi-fig' }, [h('b', { text: fs[0].text }), ' resp']), h('span', { class: 'pi-fig' }, [h('b', { text: fs[1].text }), ' HP']), h('span', { class: 'pi-fig' }, [h('b', { text: fs[2].text }), ' win']));
    } else kids.push(h('span', { class: 'pi-src', text: 'no estimate yet' }));
    const tag = h('div', { class: 'pi-eye pi-tag' + (glow ? ' pi-glow' : ''), style: '--b:' + eyeBandColor(band), 'data-pi-player': String(id || (v && v.id) || ''), 'data-pi-hover': '1', title: eyeSourceTitle(v), tabindex: '0', role: 'button' }, kids);
    return h('div', { class: 'pi-mark pi-eye pi-mini-line', 'data-pi-player': String(id || (v && v.id) || '') }, [tag]);
}

/* ------------------------------------------------------------ hover card */

/** The hover card: HP kept by likely build, gear, sources with credit. */
export function cardEl(v, mode = 'full') {
    const band = v.band;
    const kids = [h('div', { class: 'pi-hh' }, [h('b', { style: 'color:' + eyeBandColor(band), text: eyeBandWord(band) }), h('b', { class: 'pi-name', text: (v.name || 'Player') + (v.level ? ' [' + v.level + ']' : '') })])];
    const f = v.plain || v.forecast;
    if (f && f.perBuild && !f.exact) {
        kids.push(h('span', { class: 'pi-lab', text: 'HP you keep, by their likely build' }));
        const rows = Object.entries(f.perBuild).sort((a, b) => (b[1].keep || 0) - (a[1].keep || 0)).slice(0, 3);
        for (const [k, r] of rows) {
            const pct = Math.round((r.keep || 0) * 100);
            kids.push(h('div', { class: 'pi-kept' }, [h('span', { text: BUILD_WORDS[k] || k }), h('div', { class: 'pi-bar' }, [h('i', { style: 'width:' + pct + '%;background:' + eyeBandColor(band) })]), h('span', { text: r.pWin < 0.05 ? 'lose' : pct + '%' })]));
        }
    } else if (f && v.shared) {
        kids.push(h('span', { text: 'Win ' + Math.round(f.pWin * 100) + '%' + (f.keep === null || f.keep === undefined ? '' : ' · keep ~' + Math.round(f.keep * 100) + '%') }));
    } else if (f) {
        kids.push(h('span', { text: 'Their exact stats (spy): win ' + Math.round(f.pWin * 100) + '% · keep ' + Math.round((f.keep || 0) * 100) + '%' }));
    }
    if (v.gear) {
        const days = Math.max(0, Math.round((Date.now() - v.gear.seenAt) / 86400000));
        kids.push(h('div', {}, [h('span', { style: 'color:#939aa1', text: 'Their gear, seen ' + (days ? days + ' days ago' : 'today') + ' on your attack:' }), h('br'), v.gear.text || 'no weapons shown']));
        if (v.withGear) kids.push(h('span', { class: 'pi-warnline', text: 'With their gear: win ' + Math.round(v.withGear.pWin * 100) + '% · keep ~' + Math.round((v.withGear.keep || 0) * 100) + '%' }));
    }
    const src = v.est ? v.est.source : null;
    const mins = v.shared ? Math.max(0, Math.round((Date.now() - v.shared.at) / 60000)) : 0;
    const foot = v.shared ? ['From war mode on Pumping Iron’s Torn Eye tab, ' + (mins < 1 ? 'just now' : mins < 90 ? mins + ' min ago' : Math.round(mins / 60) + ' h ago') + '. Open their profile for the full estimate.'] : src === 'ffscouter' ? ['Stats: ', h('b', { text: 'FFScouter' }), ' (' + FFS_SITE_URL.replace('https://', '').replace(/\/$/, '') + '), ' + (v.est.ageDays ?? '?') + ' days old.'] : src === 'spy' ? ['Stats: a spy, ' + v.est.ageDays + ' days old.'] : src === 'fight' ? ['Stats: from your own fight with them' + (v.est.lowerBound ? ' (at least this strong)' : '') + '.'] : src === 'public' ? ['Stats: rough, from public stats (' + v.est.range + ').'] : ['No estimate yet. Connect FFScouter or fight them once.'];
    if (v.forecast && v.forecast.turns) foot.push(' About ' + v.forecast.turns + ' turns.');
    kids.push(h('div', { class: 'pi-foot' }, foot));
    return h('div', { class: 'pi-mark pi-hovercard pi-' + mode }, kids);
}

/**
 * One floating card for the page, shown next to the tag under the pointer (tags marked data-pi-hover). Like
 * everything else it stays in the free space beside Torn's page, as wide as that allows (spotOf: eyeCardSpot);
 * with no room there it isn't shown.
 */
export function bindCard(doc, getView, spotOf = null) {
    let card = null;
    let shownFor = null;
    const hide = () => {
        if (card) card.remove();
        card = null;
        shownFor = null;
    };
    // Hover, keyboard focus or a tap shows the card; Escape or leaving hides it.
    const show = (e) => {
        const tag = e.target && e.target.closest ? e.target.closest('[data-pi-hover][data-pi-player]') : null;
        if (!tag) {
            if (card) hide();
            return;
        }
        // Moving within the same tag (its edge, its words) keeps the card (round 6: it was rebuilt on every move).
        if (card && shownFor === tag && e.type === 'mouseover') return;
        const v = getView(Number(tag.getAttribute('data-pi-player')));
        if (!v) return;
        const spot = spotOf ? spotOf() : null;
        if (spot && spot.mode === 'none') return;
        hide();
        card = cardEl(v, spot ? spot.mode : 'full');
        shownFor = tag;
        doc.body.appendChild(card);
        const r = tag.getBoundingClientRect();
        if (spot) card.style.width = spot.width + 'px';
        const x = spot ? spot.x : Math.min(window.innerWidth - 340, Math.max(8, r.left));
        const below = r.bottom + 8 + card.offsetHeight < window.innerHeight;
        card.style.left = x + 'px';
        card.style.top = (below ? r.bottom + 6 : Math.max(8, r.top - card.offsetHeight - 6)) + 'px';
    };
    doc.addEventListener('mouseover', show);
    doc.addEventListener('focusin', show);
    doc.addEventListener('click', (e) => {
        if (e.target && e.target.closest && e.target.closest('[data-pi-hover][data-pi-player]')) show(e);
    });
    doc.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hide();
    });
    doc.addEventListener('scroll', hide, true);
}

/* ------------------------------------------------------------ our layer */

/** Our own layer for everything placed beside Torn's page (absolute, in page coordinates). */
export function eyeLayer(doc = document) {
    let el = doc.getElementById('pi-eye-layer');
    if (!el) {
        el = h('div', { id: 'pi-eye-layer', class: 'pi-mark pi-eye' });
        (doc.body || doc.documentElement).appendChild(el);
    }
    return el;
}

/** One part of the layer (profile, war, faction), made on first use. */
export function eyeLayerPart(name, doc = document) {
    const layer = eyeLayer(doc);
    let part = layer.querySelector(':scope > [data-pi-part="' + name + '"]');
    if (!part) {
        part = h('div', { 'data-pi-part': name, style: 'position:absolute;left:0;top:0;width:0;height:0' });
        layer.appendChild(part);
    }
    return part;
}

/** Empty a part of the layer. */
export function eyeClearPart(name, doc = document) {
    const layer = doc.getElementById('pi-eye-layer');
    const part = layer && layer.querySelector(':scope > [data-pi-part="' + name + '"]');
    if (part) fill(part, []);
}
