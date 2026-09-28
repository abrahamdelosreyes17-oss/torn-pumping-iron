/*
 * Progress (mockups/N-progress.html): stats over time, gained against the
 * plan each day (TrainingPeaks colours), the gyms ahead; this week in the pane.
 */

import { h, t } from '../dom.js';
import { STATS, STAT_LABEL } from '../../core/gain.js';
import { fmtInt, fmtSigned, fmtMoney } from '../../core/format.js';
import { gymById, unlockEnergyAfter, GEORGES } from '../../core/gyms.js';
import { DAY } from '../../core/bars.js';
import { sectionHead, meta, headsList, STAT_COLOR } from './common.js';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayLabel = (d) => new Date(d).getUTCDate() + ' ' + MONTH_SHORT[new Date(d).getUTCMonth()];

/** Plan-vs-actual colour: green within ±20%, yellow 50–79% or 121–150%, red further off. */
export function planColor(ratio) {
    if (ratio >= 0.8 && ratio <= 1.2) return 'good';
    if ((ratio >= 0.5 && ratio < 0.8) || (ratio > 1.2 && ratio <= 1.5)) return 'warn';
    return 'bad';
}

const PC_HEX = { good: '#9bdc8a', warn: '#e8a33d', bad: '#ff6b5e' };

function smallMultiple(k, series) {
    const vals = series.map((s) => s[k]);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    const W = 180;
    const H = 64;
    const pts = vals.map((v, i) => ((vals.length === 1 ? 0 : i / (vals.length - 1)) * W).toFixed(1) + ',' + (hi === lo ? H / 2 : H - 2 - ((v - lo) / (hi - lo)) * (H - 4)).toFixed(1));
    const gained = vals[vals.length - 1] - vals[0];
    const firstUp = vals.findIndex((v, i) => i > 0 && v > vals[i - 1]);
    return h('div', { class: 'smc' }, [
        h('div', { class: 'h' }, [h('b', { class: 's-' + k, text: STAT_LABEL[k] }), h('span', { text: fmtInt(vals[vals.length - 1]) })]),
        h('svg', { class: 'chart', viewBox: '0 0 ' + W + ' ' + H, 'aria-hidden': 'true' }, [h('polyline', { fill: 'none', stroke: STAT_COLOR[k], 'stroke-width': '2', points: pts.join(' ') })]),
        h('small', { text: fmtSigned(gained) + (firstUp > 1 ? ' · from ' + dayLabel(series[firstUp].day) : firstUp === 1 ? ' · every day' : '') }),
    ]);
}

export function renderProgress(m, ctx) {
    const range = ctx.ui.progressRange || 14;
    const hist = ctx.history || {};
    const days = Object.keys(hist).map(Number).sort((a, b) => a - b).slice(-range);
    const series = days.map((d) => ({ day: d, ...hist[d] }));
    const main = [];
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Range' }, [14, 30, 120].map((n) => h('button', { type: 'button', 'aria-pressed': String(n === range), onclick: () => { ctx.ui.progressRange = n; ctx.rerender(); }, text: n === 120 ? 'All' : n + ' days' })));
    if (series.length >= 2) {
        main.push(h('div', {}, [sectionHead('Stats', meta(['last ' + series.length + ' days · ' + fmtInt(series[0].total) + ' → ', h('b', { text: fmtInt(series[series.length - 1].total) }), ' total']), seg), h('div', { class: 'mult num' }, STATS.map((k) => smallMultiple(k, series)))]));
    } else {
        main.push(h('div', {}, [sectionHead('Stats', meta(['a line per stat once two days are recorded']), seg), h('p', { class: 'muted', style: 'margin:0', text: 'Pumping Iron records your stats once a day while a Torn or Pumping Iron tab is open. Come back tomorrow for the first line.' })]));
    }

    // Gained vs plan per day
    const totals = ctx.dayTotals || {};
    // Only finished Torn days are judged against the plan; today is still going.
    const todayStart = Math.floor(m.now / DAY) * DAY;
    const tdays = Object.keys(totals).map(Number).filter((d) => d < todayStart).sort((a, b) => a - b).slice(-14);
    if (!tdays.length) main.push(h('div', {}, [sectionHead('Gained vs plan', meta(['per day'])), h('p', { class: 'muted', style: 'margin:0', text: 'Your first full day shows here tomorrow: what you gained against what the plan said.' })]));
    if (tdays.length) {
        const W = 780;
        const H = 110;
        const colW = Math.min(36, W / tdays.length - 20);
        const step = W / tdays.length;
        const max = Math.max(1, ...tdays.map((d) => Math.max(totals[d].gained || 0, totals[d].planned || 0))) * 1.1;
        const svg = h('svg', { class: 'chart num', viewBox: '0 0 ' + W + ' 132', role: 'img', 'aria-label': 'Stats gained each day against the plan' });
        svg.appendChild(h('line', { class: 'ax', x1: 0, y1: H, x2: W, y2: H }));
        let onPlan = 0;
        const notes = [];
        tdays.forEach((d, i) => {
            const x = i * step + (step - colW) / 2;
            const g = totals[d].gained || 0;
            const p = totals[d].planned || 0;
            const ratio = p > 0 ? g / p : 1;
            const c = planColor(ratio);
            if (c === 'good') onPlan++;
            else notes.push(dayLabel(d) + ': ' + Math.round(ratio * 100) + '% of plan');
            const hg = (g / max) * H;
            svg.appendChild(h('rect', { x: x.toFixed(1), y: (H - hg).toFixed(1), width: colW.toFixed(1), height: hg.toFixed(1), rx: 2, fill: PC_HEX[c] }));
            if (p > 0) svg.appendChild(h('line', { x1: (x - 3).toFixed(1), x2: (x + colW + 3).toFixed(1), y1: (H - (p / max) * H).toFixed(1), y2: (H - (p / max) * H).toFixed(1), stroke: '#efebe2', 'stroke-width': 2 }));
            if (i === 0 || i === tdays.length - 1 || i % 5 === 0) svg.appendChild(h('text', { x: (x + colW / 2).toFixed(1), y: 126, 'text-anchor': 'middle', text: i === tdays.length - 1 ? 'today' : dayLabel(d) }));
        });
        const legendEl = h('span', { class: 'right legend' }, [h('span', {}, [h('i', { style: 'background:var(--good)' }), 'within 20%']), h('span', {}, [h('i', { style: 'background:var(--warn)' }), '50–79% or 121–150%']), h('span', {}, [h('i', { style: 'background:var(--bad)' }), 'further off']), h('span', {}, [h('i', { style: 'background:var(--chalk);height:2px;vertical-align:3px' }), 'plan'])]);
        main.push(h('div', {}, [sectionHead('Gained vs plan', meta(['per day · ', h('b', { text: onPlan + ' of ' + tdays.length + ' on plan' })]), legendEl), svg, notes.length ? h('div', { class: 'sgfoot num' }, notes.slice(-3).map((n) => h('span', { text: n }))) : null]));
    }

    // Gyms ahead
    const active = m.state.gymId || 1;
    const rows = [];
    let cumE = 0;
    const perDay = m.energyPerDay || 1620;
    if (active < GEORGES) {
        const cur = gymById(active, m.pc.table);
        rows.push(h('div', { class: 'tlr now' }, [h('i', { class: 'dotc' }), h('b', { text: cur ? cur.name : 'Gym ' + active }), h('span', { class: 'muted', text: bestDots(cur) }), h('span', { class: 'muted', text: m.nextGym && m.nextGym.energyLeft !== null && ctx.gymProgress ? fmtInt(m.nextGym.energyLeft) + ' E to the next' : 'open the gym page once to track progress' }), h('span', { class: 'r', text: 'now' })]));
        for (let id = active + 1; id <= GEORGES && rows.length < 7; id++) {
            const g = gymById(id, m.pc.table);
            const need = id === active + 1 && m.nextGym ? m.nextGym.energyLeft : unlockEnergyAfter(id - 1, m.pc.perks.gymExpMult);
            cumE += need || 0;
            rows.push(h('div', { class: 'tlr' + (id === active + 1 ? ' next' : '') }, [h('i', { class: 'dotc' }), h('b', { text: g.name }), h('span', { class: 'muted', text: bestDots(g) }), h('span', { class: 'muted', text: (id === active + 1 ? fmtInt(need) + ' E to go' : '+' + fmtInt(need) + ' E') + ' · ' + fmtMoney(g.cost) }), h('span', { class: 'r', text: 'about ' + Math.max(1, Math.round(cumE / perDay)) + ' days' })]));
        }
    } else {
        rows.push(h('div', { class: 'tlr now' }, [h('i', { class: 'dotc' }), h('b', { text: (gymById(active, m.pc.table) || {}).name || "George's" }), h('span', { class: 'muted', text: 'every ladder gym unlocked' }), h('span'), h('span', { class: 'r', text: 'now' })]));
    }
    main.push(h('div', {}, [sectionHead('Gyms', meta(['at ' + fmtInt(perDay) + ' energy a day'])), h('div', { class: 'tl num' }, rows)]));

    // Pane: this week
    const weekStart = Math.floor(m.now / DAY) * DAY - 6 * DAY;
    const wk = tdays.filter((d) => d >= weekStart).map((d) => totals[d]);
    const sum = (k) => wk.reduce((a, x) => a + (x[k] || 0), 0);
    const g = sum('gained');
    const p = sum('planned');
    const pct = p > 0 && wk.length ? Math.round((100 * g) / p) : null;
    const meter = (label, valText, sub, fillPct, color) => h('div', { class: 'meter' }, [h('span', { text: label }), h('b', {}, [valText, sub ? h('span', { class: 'muted', style: 'font-weight:normal', text: ' ' + sub }) : null]), h('div', { class: 'bar' }, [h('i', { style: 'width:' + Math.max(0, Math.min(100, fillPct)) + '%;background:' + color })])]);
    const pane = [
        h('div', {}, [
            sectionHead('This week', meta([wk.length ? wk.length + ' full day' + (wk.length === 1 ? '' : 's') : 'first full day tomorrow'])),
            h('div', { class: 'num' }, [
                meter('Stats gained', fmtSigned(g), pct !== null ? pct + '% of plan' : '', pct || 0, pct !== null && planColor(pct / 100) === 'good' ? 'var(--good)' : 'var(--warn)'),
                meter('Xanax taken', String(sum('xanax')), 'of ' + sum('xanaxPlanned'), sum('xanaxPlanned') ? (100 * sum('xanax')) / sum('xanaxPlanned') : 0, 'var(--chalk)'),
                meter('Refills used', String(sum('refills')), 'of ' + wk.length, wk.length ? (100 * sum('refills')) / wk.length : 0, 'var(--chalk)'),
            ]),
        ]),
        h('div', {}, [sectionHead('Gain model', null, null, 'h3'), headsList([ctx.calibration && ctx.calibration.n >= 10 ? { tone: Math.abs(ctx.calibration.errPct) <= 3 ? 'good' : 'warn', text: 'Within ' + Math.max(1, Math.round(Math.abs(ctx.calibration.errPct))) + '% of your last ' + ctx.calibration.n + ' sessions', sub: 'predicted against what your stats did' } : { tone: 'plain', text: 'Checks itself after 10 sessions', sub: 'from stat changes after each train' }])]),
        h('div', {}, [sectionHead('Totals', null, null, 'h3'), h('dl', { class: 'kv num' }, [h('dt', { text: 'Days recorded' }), h('dd', { text: String(Object.keys(hist).length) }), h('dt', { text: 'Best day' }), h('dd', { text: tdays.length ? fmtSigned(Math.max(...tdays.map((d) => totals[d].gained || 0))) : '—' })])]),
    ];
    return { main, pane };
}

function bestDots(g) {
    if (!g) return '';
    const best = Math.max(...STATS.map((k) => g.dots[k]));
    const which = STATS.filter((k) => g.dots[k] === best).map((k) => STAT_LABEL[k]);
    return best + ' ' + (which.length === 4 ? 'all' : which.join('/'));
}

