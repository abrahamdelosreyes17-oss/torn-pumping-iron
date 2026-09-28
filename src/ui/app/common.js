/*
 * Pieces every webpage tab shares: the status strip, the stats-vs-build rows,
 * section headers, time words. All numbers come from the model.
 */

import { h, t, sparkline } from '../dom.js';
import { STAT_LABEL } from '../../core/gain.js';
import { countdown, tornClock } from '../../core/bars.js';
import { fmtInt, fmtSigned } from '../../core/format.js';
import { itemName } from '../../core/items.js';

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

/** Energy · Happy · Drug · Booster · Refill (Home and Plan only). */
export function statusStrip(m, settings) {
    const s = m.strip;
    const now = m.now;
    const drugTxt = s.drug.left > 0 ? countdown(s.drug.left) : 'Ready';
    const drugPct = s.drug.left > 0 && s.drug.total > 0 ? (100 * s.drug.left) / s.drug.total : 0;
    const boosterTxt = s.booster.left > 0 ? countdown(s.booster.left) : 'Ready';
    return h('div', { class: 'strip num' }, [
        stCell('Energy', s.energy.current + ' / ' + s.energy.max, null, (100 * s.energy.current) / Math.max(1, s.energy.max), 'var(--chalk)', s.energy.fullAt ? 'Full at ' + clock(s.energy.fullAt, settings) : 'Full'),
        stCell('Happy', fmtInt(s.happy.current), null, (100 * Math.min(s.happy.current, s.happy.max)) / Math.max(1, s.happy.max), 'var(--good)', 'Max ' + fmtInt(s.happy.max) + (s.happy.property ? ' · ' + s.happy.property : '')),
        (() => {
            const c = stCell('Drug', drugTxt, s.drug.left > 0 ? 'warn' : 'good', drugPct, 'var(--warn)', 'Xanax ' + Math.min(s.drug.xanaxDone + 1, Math.max(1, s.drug.xanaxPlanned)) + ' of ' + Math.max(1, s.drug.xanaxPlanned) + ' today');
            if (s.drug.left > 0) c.querySelector('b').setAttribute('data-cd', String(now + s.drug.left));
            return c;
        })(),
        stCell('Booster', boosterTxt, s.booster.left > 0 ? null : 'good', 0, 'var(--chalk)', s.booster.used ? 'Used by this plan' : 'Not used by this plan'),
        stCell('Refill', s.refill.free ? 'Unused' : 'Used', null, s.refill.free ? 0 : 100, 'var(--chalk)', s.refill.free ? (s.refill.plannedAt ? 'Planned ' + clock(s.refill.plannedAt, settings) : 'Use before 00:00') : 'Next at 00:00 Torn time'),
    ]);
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
            else tod = h('span', { class: 'tod' + (r.today ? ' s-' + k : ''), style: r.today ? null : 'color:var(--dim)', text: r.today ? fmtSigned(r.today) + ' today' : r.plannedTrains ? r.plannedTrains + ' planned' : '+0 today' });
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

/** A dot-and-line list (Heads-up). */
export function headsList(items) {
    return h(
        'ul',
        { class: 'heads num' },
        items.map((x) => h('li', { class: x.tone === 'warn' ? 'w' : x.tone === 'good' ? 'g' : null }, [h('i'), h('div', {}, [x.text, x.sub ? h('span', { text: ' · ' + x.sub }) : null])])),
    );
}
