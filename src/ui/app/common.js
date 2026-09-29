/*
 * Pieces every webpage tab shares: the status strip, the stats-vs-build rows,
 * section headers, time words. All numbers come from the model.
 */

import { h, t, sparkline } from '../dom.js';
import { STAT_LABEL } from '../../core/gain.js';
import { countdown, tornClock } from '../../core/bars.js';
import { fmtInt, fmtSigned } from '../../core/format.js';
import { itemName } from '../../core/items.js';

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export const STAT_COLOR = { str: '#e5534b', spd: '#f0c02f', def: '#4a8ff0', dex: '#43b86c' };

/** A clock in the user's chosen time (Torn time is UTC). */
export function clock(ts, settings) {
    if (settings && settings.timeFormat === 'local') {
        const d = new Date(ts);
        return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    }
    return tornClock(ts);
}

/** A countdown node that the app's 1-second tick keeps current. */
export function cd(at, now, { prefix = '', cls = '' } = {}) {
    return h('span', { class: cls, 'data-cd': String(at), 'data-cd-prefix': prefix, text: prefix + countdown(at - now) });
}

export function sectionHead(title, meta = null, right = null, level = 'h2') {
    return h('div', { class: 'sh' }, [h(level, { text: title }), meta, right ? h('span', { class: 'right' }, [right]) : null]);
}

export function meta(parts) {
    return h('span', { class: 'meta num' }, parts);
}

/** "DEX × 27" or "DEX × 20 · DEF × 7" */
export function trainsText(trains) {
    const parts = Object.entries(trains || {}).filter(([, n]) => n > 0).map(([k, n]) => STAT_LABEL[k] + ' × ' + n);
    return parts.join(' · ');
}

export function itemsText(items) {
    return (items || []).map((it) => itemName(it.id) + (it.qty > 1 ? ' × ' + it.qty : '')).join(' + ');
}

function stCell(label, value, valueCls, pct, color, small) {
    return h('div', { class: 'st' }, [
        h('div', { class: 'st-h' }, [t('lab', label), h('b', { class: valueCls || null, text: value })]),
        h('div', { class: 'bar' }, [h('i', { style: 'width:' + Math.max(0, Math.min(100, pct)).toFixed(1) + '%;background:' + color })]),
        h('small', { text: small }),
    ]);
}

/** Energy · Happy · Drug · (Booster, only when the plan uses one) · Refill (Home). */
export function statusStrip(m, settings) {
    const s = m.strip;
    const now = m.now;
    const drugTxt = s.drug.left > 0 ? countdown(s.drug.left) : 'Ready';
    const drugPct = s.drug.left > 0 && s.drug.total > 0 ? (100 * s.drug.left) / s.drug.total : 0;
    const boosterTxt = s.booster.left > 0 ? countdown(s.booster.left) : 'Ready';
    const withBooster = s.booster.used || s.booster.left > 0 || Boolean(s.booster.next);
    return h('div', { class: 'strip num' + (withBooster ? '' : ' four') }, [
        stCell('Energy', s.energy.current + ' / ' + s.energy.max, null, (100 * s.energy.current) / Math.max(1, s.energy.max), 'var(--chalk)', s.energy.fullAt ? 'Full at ' + clock(s.energy.fullAt, settings) : 'Full'),
        stCell('Happy', fmtInt(s.happy.current), null, (100 * Math.min(s.happy.current, s.happy.max)) / Math.max(1, s.happy.max), 'var(--good)', 'Max ' + fmtInt(s.happy.max) + (s.happy.property ? ' · ' + s.happy.property : '')),
        (() => {
            const c = stCell('Drug', drugTxt, s.drug.left > 0 ? 'warn' : 'good', drugPct, 'var(--warn)', 'Xanax ' + Math.min(s.drug.xanaxDone + 1, Math.max(1, s.drug.xanaxPlanned)) + ' of ' + Math.max(1, s.drug.xanaxPlanned) + ' today');
            if (s.drug.left > 0) c.querySelector('b').setAttribute('data-cd', String(now + s.drug.left));
            return c;
        })(),
        withBooster ? stCell('Booster', boosterTxt, s.booster.left > 0 ? null : 'good', s.booster.capH ? (100 * Math.min(s.booster.left, s.booster.capH * 3600e3)) / (s.booster.capH * 3600e3) : 0, 'var(--chalk)', boosterWords(s.booster, now)) : null,
        stCell('Refill', s.refill.free ? 'Unused' : 'Used', null, s.refill.free ? 0 : 100, 'var(--chalk)', s.refill.free ? (s.refill.plannedAt ? 'Planned ' + clock(s.refill.plannedAt, settings) : 'Use before 00:00') : 'Next at 00:00 Torn time'),
    ]);
}

/**
 * The Booster cell's line (owner, 2026-09-29: "Not used by this plan" showed after the day's candy was taken):
 * the plan's next booster step, or when the cooldown is back under the cap.
 */
export function boosterWords(b, now) {
    if (b.next) return 'Next ' + (b.next.kind === 'jump' ? 'jump' : b.next.kind === 'boost' ? 'candy boost' : 'booster') + (b.next.at > now ? ' in ' + countdown(b.next.at - now) : ' now');
    if (b.left > 0) return b.underCapIn > 0 ? 'Used · room again in ' + countdown(b.underCapIn) : 'Used · room under the cap now';
    return 'Not used by this plan';
}

/** The four stat rows against the build (Home and Plan). */
export function statRowsBlock(m, { todayCol = 'gain' } = {}) {
    return h(
        'div',
        { class: 'sg num' },
        m.statRows.map((r) => {
            const k = r.stat;
            const shareW = Math.min(100, r.share * 200);
            const gapTxt = (r.share * 100).toFixed(1) + '% · ' + (r.over ? 'over' : r.gap > 0 ? '+' + fmtInt(r.gap) : 'on build');
            let tod;
            if (todayCol === 'trains') tod = h('span', { class: 'gap' + (r.plannedTrains ? ' s-' + k : ''), text: r.plannedTrains + ' trains' });
            else tod = h('span', { class: 'tod' + (r.today ? ' s-' + k : ''), style: r.today ? null : 'color:var(--muted)', text: r.today ? fmtSigned(r.today) + ' today' : r.plannedTrains ? r.plannedTrains + ' planned' : '+0 today' });
            return h('div', { class: 'sgr' }, [
                h('b', { class: 'n s-' + k, text: STAT_LABEL[k] }),
                h('span', { class: 'v', text: fmtInt(r.value) }),
                h('div', { class: 'share' }, [h('i', { style: 'width:' + shareW.toFixed(1) + '%;background:' + STAT_COLOR[k] }), h('em', { style: 'left:' + Math.min(100, r.target * 200).toFixed(1) + '%' })]),
                h('span', { class: 'gap', text: gapTxt }),
                sparkline(r.spark, { color: STAT_COLOR[k] }),
                tod,
            ]);
        }),
    );
}

/** "+305,123 (STR +169,900 · DEX +135,223)": a real gain in words. */
export function gainWords(g) {
    if (!g) return '—';
    const per = Object.entries(g.perStat || {}).filter(([, v]) => v > 0).map(([k, v]) => STAT_LABEL[k] + ' ' + fmtSigned(v));
    return fmtSigned(g.total) + (per.length ? ' (' + per.join(' · ') + ')' : '');
}

/**
 * Your real gains (owner, 2026-09-29: "the progress also only shows progression not my actual stat
 * increase"): what Torn's stats rose today, in 7 and in 30 days (Home and Progress).
 */
export function gainsCard(m) {
    const g = m.gains || {};
    const row = (label, x, n) => [h('dt', { text: label }), h('dd', { text: gainWords(x) + (x && n > 1 && x.days < n ? ' · ' + x.days + ' day' + (x.days === 1 ? '' : 's') + ' recorded' : '') })];
    return h('div', {}, [
        sectionHead('Your gains', meta(['what Torn’s stats rose']), null, 'h3'),
        h('dl', { class: 'facts num' }, [...row('Today', g.today, 1), ...row('7 days', g.week, 7), ...row('30 days', g.month, 30)]),
        g.today && g.today.fromLog ? h('div', { class: 'note2', text: 'Today from the trains seen since you opened Pumping Iron; from tomorrow, from the day’s first read.' }) : null,
    ]);
}

/** A dot-and-line list (Heads-up). */
export function headsList(items, go = null) {
    return h(
        'ul',
        { class: 'heads num' },
        items.map((x) => {
            const link = go && x.go;
            const open = () => go(x.go);
            return h('li', { class: [x.tone === 'warn' ? 'w' : x.tone === 'good' ? 'g' : null, link ? 'go' : null].filter(Boolean).join(' ') || null, role: link ? 'link' : null, tabindex: link ? '0' : null, onclick: link ? open : null, onkeydown: link ? (e) => { if (e.key === 'Enter') open(); } : null }, [h('i'), h('div', {}, [x.text, x.sub ? h('span', { text: ' · ' + x.sub }) : null])]);
        }),
    );
}
