/*
 * Torn Eye on Torn's pages (DESIGN §6, mockup R): a one-line chip (band,
 * win, HP kept, respect, source), a hover card, the war list's column,
 * summary and order, and a side panel on the attack page. Never the words
 * FF or fair fight. FFScouter is credited wherever its numbers show.
 */

import { h, fill } from '../dom.js';
import { BAND_WORDS, BAND_COLORS } from '../../core/eye/bands.js';
import { BUILD_WORDS } from '../../core/eye/fight.js';
import { FFS_SITE_URL } from '../../api/ffscouter.js';

export const EYE_CSS = `
.pi-chip { display: inline-flex; align-items: center; gap: 8px; height: 28px; padding: 0 10px 0 8px; margin: 6px 0; border-radius: 14px; background: #1e2124; border: 1px solid #3a4046; font: 12px Arial, sans-serif; color: #e3e5e8; white-space: nowrap; cursor: default; vertical-align: middle; }
.pi-chip .pi-dot { width: 12px; height: 12px; border-radius: 50%; box-shadow: inset 0 0 0 3px currentColor; background: #111; flex: none; }
.pi-chip b { font-weight: bold; }
.pi-chip .pi-src { color: #939aa1; font-size: 11px; }
.pi-chip.pi-mini { height: 22px; margin: 0 0 0 6px; padding: 0 8px 0 6px; gap: 6px; font-size: 11px; }
.pi-chip.pi-mini .pi-dot { width: 10px; height: 10px; }
.pi-eyecard { position: fixed; z-index: 99991; width: 330px; background: #1c1f22; border: 1px solid #3a4046; border-radius: 10px; padding: 12px 14px; box-shadow: 0 8px 24px rgba(0,0,0,.45); display: flex; flex-direction: column; gap: 10px; font: 12px/1.4 Arial, sans-serif; color: #e3e5e8; pointer-events: none; }
.pi-eyecard .pi-hh { display: flex; align-items: baseline; gap: 8px; }
.pi-eyecard .pi-hh b.pi-name { color: #fff; font-size: 14px; }
.pi-eyecard .pi-lab { font-size: 11px; font-weight: bold; letter-spacing: .5px; text-transform: uppercase; color: #939aa1; }
.pi-kept { display: grid; grid-template-columns: 80px minmax(0,1fr) 40px; gap: 8px; align-items: center; }
.pi-kept .pi-bar { height: 6px; border-radius: 3px; background: #24282c; overflow: hidden; }
.pi-kept .pi-bar i { display: block; height: 100%; }
.pi-eyecard .pi-foot { font-size: 11px; color: #939aa1; border-top: 1px solid #2c3136; padding-top: 8px; }
.pi-eyecard .pi-warnline { color: #e8a33d; font-weight: bold; }
.pi-warsum { display: flex; flex-wrap: wrap; gap: 18px; align-items: center; padding: 7px 10px; margin: 6px 0 8px; background: #1b1e21; border: 1px solid #3a4046; border-radius: 6px; font: 12px Arial, sans-serif; color: #e3e5e8; }
.pi-warsum b { color: #fff; font-size: 14px; }
.pi-warsum .pi-muted { color: #939aa1; margin-left: auto; }
.pi-early { background: #1f2a1d !important; }
.pi-warlist { display: flex !important; flex-direction: column; }
.pi-warsum a { color: #8fb8e8; }
.pi-earlytag { color: #9bdc8a; font-weight: bold; font-size: 11px; margin-left: 6px; }
.pi-landtag { color: #8fb8e8; font-weight: bold; font-size: 11px; margin-left: 6px; }
.pi-edge-stomp { box-shadow: inset 3px 0 0 #3fbf5a !important; }
.pi-edge-good { box-shadow: inset 3px 0 0 #a6e08a !important; }
.pi-edge-tough { box-shadow: inset 3px 0 0 #f0a040 !important; }
.pi-edge-cant { box-shadow: inset 3px 0 0 #ff5a4e !important; }
.pi-watch { display: inline-flex; align-items: center; gap: 6px; margin: 6px 0 6px 8px; vertical-align: middle; font: 12px Arial, sans-serif; }
.pi-watch button, .pi-watch select, .pi-watch input { height: 24px; border-radius: 12px; border: 1px solid #3a4046; background: #1e2124; color: #e3e5e8; font: bold 11px Arial, sans-serif; padding: 0 10px; cursor: pointer; }
.pi-watch input { cursor: text; width: 130px; border-radius: 5px; font-weight: normal; }
.pi-watch select { border-radius: 5px; padding: 0 6px; }
.pi-watch button[aria-pressed="true"] { color: #efebe2; border-color: #efebe2; }
.pi-watch .pi-full { color: #e8a33d; font-size: 11px; }
`;

/** The watch reasons offered on Torn's pages (the webpage offers the same, plus your own words there). */
export const WATCH_TAG_WORDS = ['hospitalize', 'mug', 'revenge', 'bounty'];

/**
 * "☆ Watch" / "★ Watching" with the reason picker when watched.
 * @param {object} s - {watching, tag, full}
 * @param {object} on - {toggle(), tag(value)}
 */
export function watchControl(s, on) {
    const kids = [h('button', { type: 'button', 'aria-pressed': String(Boolean(s.watching)), title: s.watching ? 'Torn Eye is watching this player · click to stop' : 'Watch this player in Torn Eye (status, hospital, flights)', onclick: (e) => { e.preventDefault(); e.stopPropagation(); on.toggle(); }, text: s.watching ? '★ Watching' : '☆ Watch' })];
    if (s.watching) {
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
    if (s.full) kids.push(h('span', { class: 'pi-full', text: 'Watch list full (20)' }));
    return h('span', { class: 'pi-mark pi-watch', 'data-pi-watch': [s.watching ? 1 : 0, s.tag || '', s.full ? 1 : 0].join('|') }, kids);
}

export function ensureEyeCss(doc = document) {
    if (doc.getElementById('pi-eye-css')) return;
    const st = doc.createElement('style');
    st.id = 'pi-eye-css';
    st.textContent = EYE_CSS;
    (doc.head || doc.documentElement).appendChild(st);
}

/** The short figure on a list row: HP kept where you'd win, else the win chance (or "rough"). */
export function miniFigure(v) {
    const f = v.forecast;
    if (v.est && v.est.confidence === 'rough' && f.pWin < 0.6) return 'rough';
    if (v.band === 'cant' || f.keep === null || f.keep === undefined) return 'win ' + Math.round(f.pWin * 100) + '%';
    return 'keep ' + (v.est && v.est.confidence === 'exact' ? '' : '~') + Math.round(f.keep * 100) + '%';
}

/** The chip for one player view (eyeView()). */
export function chipEl(v, { mini = false, id = null } = {}) {
    const band = v ? v.band : 'none';
    const color = BAND_COLORS[band];
    const kids = [h('i', { class: 'pi-dot', style: 'color:' + color }), h('b', { style: 'color:' + color, text: BAND_WORDS[band] })];
    if (v && v.forecast) kids.push(h('span', { text: mini ? miniFigure(v) : v.figures }));
    else kids.push(h('span', { text: mini ? '' : 'no estimate yet' }));
    if (!mini && v && v.source) kids.push(h('span', { class: 'pi-src', text: v.source }));
    // The player id is always on the chip, estimate or not: redraw checks compare it.
    const title = v && v.est ? 'Torn Eye · stats: ' + (v.est.source === 'ffscouter' ? 'FFScouter (ffscouter.com)' : v.source) : 'Torn Eye';
    return h('span', { class: 'pi-mark pi-chip' + (mini ? ' pi-mini' : ''), 'data-pi-player': String(id || (v && v.id) || ''), title, tabindex: '0', role: 'button', 'aria-label': title + ' · ' + BAND_WORDS[band] }, kids);
}

/** The hover card: HP kept by likely build, gear, sources with credit. */
export function cardEl(v) {
    const band = v.band;
    const kids = [h('div', { class: 'pi-hh' }, [h('b', { style: 'color:' + BAND_COLORS[band], text: BAND_WORDS[band] }), h('b', { class: 'pi-name', text: (v.name || 'Player') + (v.level ? ' [' + v.level + ']' : '') })])];
    const f = v.plain || v.forecast;
    if (f && f.perBuild && !f.exact) {
        kids.push(h('span', { class: 'pi-lab', text: 'HP you keep, by their likely build' }));
        const rows = Object.entries(f.perBuild).sort((a, b) => (b[1].keep || 0) - (a[1].keep || 0)).slice(0, 3);
        for (const [k, r] of rows) {
            const pct = Math.round((r.keep || 0) * 100);
            kids.push(h('div', { class: 'pi-kept' }, [h('span', { text: BUILD_WORDS[k] || k }), h('div', { class: 'pi-bar' }, [h('i', { style: 'width:' + pct + '%;background:' + BAND_COLORS[band] })]), h('span', { text: r.pWin < 0.05 ? 'lose' : pct + '%' })]));
        }
    } else if (f) {
        kids.push(h('span', { text: 'Their exact stats (spy): win ' + Math.round(f.pWin * 100) + '% · keep ' + Math.round((f.keep || 0) * 100) + '%' }));
    }
    if (v.gear) {
        const days = Math.max(0, Math.round((Date.now() - v.gear.seenAt) / 86400000));
        kids.push(h('div', {}, [h('span', { style: 'color:#939aa1', text: 'Their gear, seen ' + (days ? days + ' days ago' : 'today') + ' on your attack:' }), h('br'), v.gear.text || 'no weapons shown']));
        if (v.withGear) kids.push(h('span', { class: 'pi-warnline', text: 'With their gear: win ' + Math.round(v.withGear.pWin * 100) + '% · keep ~' + Math.round((v.withGear.keep || 0) * 100) + '%' }));
    }
    const src = v.est ? v.est.source : null;
    const foot = src === 'ffscouter' ? ['Stats: ', h('b', { text: 'FFScouter' }), ' (' + FFS_SITE_URL.replace('https://', '').replace(/\/$/, '') + '), ' + (v.est.ageDays ?? '?') + ' days old.'] : src === 'spy' ? ['Stats: a spy, ' + v.est.ageDays + ' days old.'] : src === 'fight' ? ['Stats: from your own fight with them' + (v.est.lowerBound ? ' (at least this strong)' : '') + '.'] : src === 'public' ? ['Stats: rough, from public stats (' + v.est.range + ').'] : ['No estimate yet. Connect FFScouter or fight them once.'];
    if (v.forecast && v.forecast.turns) foot.push(' About ' + v.forecast.turns + ' turns.');
    kids.push(h('div', { class: 'pi-foot' }, foot));
    return h('div', { class: 'pi-mark pi-eyecard' }, kids);
}

/** One floating card for the page, shown next to the chip under the pointer. */
export function bindCard(doc, getView) {
    let card = null;
    let shownFor = null;
    const hide = () => {
        if (card) card.remove();
        card = null;
        shownFor = null;
    };
    // Hover, keyboard focus or a tap shows the card; Escape or leaving hides it.
    const show = (e) => {
        const chip = e.target && e.target.closest ? e.target.closest('.pi-chip[data-pi-player]') : null;
        if (!chip) {
            if (card) hide();
            return;
        }
        // Moving within the same chip (its dot, its words) keeps the card: it was rebuilt on every move (round 6).
        if (card && shownFor === chip && e.type === 'mouseover') return;
        const v = getView(Number(chip.getAttribute('data-pi-player')));
        if (!v) return;
        hide();
        card = cardEl(v);
        shownFor = chip;
        doc.body.appendChild(card);
        const r = chip.getBoundingClientRect();
        const x = Math.min(window.innerWidth - 340, Math.max(8, r.left));
        const below = r.bottom + 8 + card.offsetHeight < window.innerHeight;
        card.style.left = x + 'px';
        card.style.top = (below ? r.bottom + 6 : Math.max(8, r.top - card.offsetHeight - 6)) + 'px';
    };
    doc.addEventListener('mouseover', show);
    doc.addEventListener('focusin', show);
    doc.addEventListener('click', (e) => {
        if (e.target && e.target.closest && e.target.closest('.pi-chip[data-pi-player]')) show(e);
    });
    doc.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hide();
    });
    doc.addEventListener('scroll', hide, true);
}

/** The war summary line: "5 attackable now · 0:48 until the next one is out · 1 traveling". */
export function warSummaryEl(sum, updatedAgoS, fromFfs = false) {
    const mmss = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
    return h('div', { class: 'pi-mark pi-warsum' }, [
        h('span', { class: 'pi-plate' }, [h('i')]),
        h('span', {}, [h('b', { text: String(sum.attackable) }), ' attackable now' + (sum.early ? ' (' + sum.early + ' out early)' : '')]),
        sum.nextOutS !== null ? h('span', {}, [h('b', { text: mmss(sum.nextOutS) }), ' until the next one is out']) : null,
        h('span', {}, [h('b', { text: String(sum.traveling) }), ' traveling']),
        // Torn's pages read nothing for the war (owner, round 6): what this page shows; the live read is on the Torn Eye tab.
        h('span', { class: 'pi-muted' }, [updatedAgoS === null || updatedAgoS === undefined ? 'from this page · live war mode on Pumping Iron’s Torn Eye tab' : 'updated ' + updatedAgoS + 's ago · every 10 s while this tab is open', fromFfs ? ' · stats: ' : '', fromFfs ? h('a', { href: FFS_SITE_URL, target: '_blank', rel: 'noopener', text: 'FFScouter' }) : null]),
    ]);
}

/**
 * The attack page's side panel (a shadow host beside Torn's layout).
 * @param {object} v - eyeView() or null
 * @param {object} s - {gearVisible, gearSaved}
 */
export function attackPanelContent(v, s) {
    const kids = [h('span', { class: 'row' }, [h('span', { class: 'plate' }, [h('i')]), h('b', { class: 'white', text: 'Torn Eye' })])];
    if (!v) {
        kids.push(h('span', { class: 'muted', text: 'Reading this player… (your fights, FFScouter, public stats)' }));
        if (s.watch) kids.push(h('button', { class: 'watch', type: 'button', 'aria-pressed': String(Boolean(s.watch.watching)), onclick: () => s.watch.toggle(), text: s.watch.watching ? '★ Watching' : '☆ Watch' }));
        return kids;
    }
    const f = v.forecast;
    kids.push(h('span', { class: 'big', style: 'color:' + BAND_COLORS[v.band], text: BAND_WORDS[v.band] + (f && f.pWin >= 0.05 && f.keep !== null ? ' · keep ' + (v.est && v.est.confidence === 'exact' ? '' : '~') + Math.round(f.keep * 100) + '%' : '') }));
    if (f) kids.push(h('span', { text: 'Win ' + Math.round(f.pWin * 100) + '%' + (v.respect ? ' · ' + v.respect.toFixed(2) + ' respect' : '') + (f.turns ? ' · about ' + f.turns + ' turns' : '') }));
    if (s.gearSaved) kids.push(h('span', { class: 'good', text: 'Their gear is saved for next time.' }));
    else if (!s.gearVisible) kids.push(h('span', { class: 'muted', text: 'Their gear isn’t shown yet. Torn shows it after Start Fight (earlier with the Gun Shop job perk). We’ll save it for next time.' }));
    if (v.gear) kids.push(h('span', { class: 'muted', text: 'Last seen: ' + (v.gear.text || 'gear') + ' · ' + Math.max(0, Math.round((Date.now() - v.gear.seenAt) / 86400000)) + ' days ago' }));
    if (v.source) kids.push(v.est && v.est.source === 'ffscouter' ? h('span', { class: 'muted' }, ['Stats: ', h('a', { href: FFS_SITE_URL, target: '_blank', rel: 'noopener', text: 'FFScouter' }), ', ' + (v.est.ageDays ?? '?') + ' days old']) : h('span', { class: 'muted', text: 'Stats: ' + v.source }));
    if (s.watch) kids.push(h('button', { class: 'watch', type: 'button', 'aria-pressed': String(Boolean(s.watch.watching)), onclick: () => s.watch.toggle(), text: s.watch.watching ? '★ Watching' + (s.watch.tag ? ' · ' + s.watch.tag : '') : s.watch.full ? 'Watch list full (20)' : '☆ Watch' }));
    return kids;
}

export const ATTACK_PANEL_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; }
.panel { position: fixed; z-index: 99989; pointer-events: none; width: 250px; background: #1b1e21; border: 1px solid #3a4046; border-radius: 10px; padding: 12px; display: flex; flex-direction: column; gap: 8px; font-size: 12px; color: #e3e5e8; box-shadow: 0 6px 18px rgba(0,0,0,.4); }
.row { display: flex; align-items: center; gap: 8px; }
.plate { width: 18px; height: 18px; border-radius: 50%; background: #efebe2; display: inline-grid; place-items: center; box-shadow: inset 0 0 0 3px #efebe2, inset 0 0 0 4px #2a2d31; }
.plate i { width: 4px; height: 4px; border-radius: 50%; background: #15171a; }
.white { color: #fff; }
.big { font: bold 22px "Arial Narrow", Arial, sans-serif; }
.muted { color: #939aa1; }
.good { color: #9bdc8a; font-weight: bold; }
a { color: #8fb8e8; pointer-events: auto; }
button.watch { pointer-events: auto; align-self: flex-start; height: 24px; padding: 0 10px; border-radius: 12px; border: 1px solid #3a4046; background: #1e2124; color: #e3e5e8; font: bold 11px Arial, sans-serif; cursor: pointer; }
button.watch[aria-pressed="true"] { color: #efebe2; border-color: #efebe2; }
`;

export function attackPanel(doc = document) {
    let host = doc.getElementById('pi-attack');
    if (!host) {
        host = h('div', { id: 'pi-attack' });
        (doc.body || doc.documentElement).appendChild(host);
        const sr = host.attachShadow({ mode: 'open' });
        fill(sr, [h('style', { text: ATTACK_PANEL_CSS }), h('div', { class: 'panel' })]);
    }
    return host.shadowRoot.querySelector('.panel');
}
