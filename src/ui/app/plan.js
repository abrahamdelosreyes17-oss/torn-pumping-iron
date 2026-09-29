/*
 * Plan (mockups/L-plan.html): the recommended strategy, the others against
 * it with a warning before a worse pick, the build, and the 30-day chart.
 */

import { h, t } from '../dom.js';
import { STATS, STAT_LABEL } from '../../core/gain.js';
import { fmtInt, fmtShort, fmtMoney, fmtPct, fmtSigned } from '../../core/format.js';
import { STRATEGIES } from '../../core/strategies.js';
import { pickWarning } from '../../core/recommend.js';
import { BUILDS, BUILD_ORDER, BUILD_ALIASES, resolveBuild, highStatOf } from '../../core/builds.js';
import { GEORGES } from '../../core/gyms.js';
import { gymById } from '../../core/gyms.js';
import { XANAX, EDVD, ECSTASY, POINTS, REFILL_POINTS } from '../../core/items.js';
import { sectionHead, meta, statRowsBlock, headsList, STAT_COLOR } from './common.js';

const KIND_TAG = { steady: 'Steady', boost: 'Boost', jump: 'Jump' };

function planPerDay(r, days) {
    const x = (r.used[XANAX] || 0) / days;
    const parts = [];
    if (x) parts.push((Math.round(x * 2) / 2).toString().replace('.5', '½') + ' Xanax');
    if (r.used[EDVD]) parts.push(Math.round((r.used[EDVD] / days) * 10) / 10 + ' EDVD');
    if ((r.used[POINTS] || 0) >= REFILL_POINTS * days * 0.9) parts.push('refill');
    return parts.join(' + ') || '—';
}

function planChart(compare, recommended, days) {
    const W = 290;
    const H = 150;
    const ids = Object.keys(compare);
    const max = Math.max(1, ...ids.map((id) => compare[id].gained));
    const top = Math.pow(10, Math.floor(Math.log10(max)));
    const gridV = Math.floor(max / top) * top;
    const svg = h('svg', { class: 'chart num', viewBox: '0 0 352 180', role: 'img', 'aria-label': 'Stats gained over ' + days + ' days per plan' });
    const y = (v) => H - (v / max) * (H - 10);
    svg.appendChild(h('line', { class: 'ax', x1: 0, y1: H, x2: W, y2: H }));
    svg.appendChild(h('line', { class: 'ax', x1: 0, y1: y(gridV).toFixed(1), x2: W, y2: y(gridV).toFixed(1), 'stroke-dasharray': '2 4' }));
    svg.appendChild(h('text', { x: 0, y: (y(gridV) - 5).toFixed(1), text: fmtShort(gridV) }));
    const labels = [];
    const order = ids.filter((id) => id !== recommended).concat(recommended);
    for (const id of order) {
        const r = compare[id];
        const pts = ['0,' + H].concat(r.daily.map((v, i) => (((i + 1) / r.daily.length) * W).toFixed(1) + ',' + y(v).toFixed(1)));
        const rec = id === recommended;
        const color = rec ? '#efebe2' : r.gained < compare[recommended].gained * 0.8 ? '#e8a33d' : '#6c737a';
        svg.appendChild(h('polyline', { fill: 'none', stroke: color, 'stroke-width': rec ? '2.5' : '1.5', points: pts.join(' ') }));
        labels.push({ id, y: y(r.gained), color, rec });
    }
    labels.sort((a, b) => a.y - b.y);
    let last = -Infinity;
    for (const l of labels) {
        const yy = Math.max(l.y + 4, last + 13);
        last = yy;
        svg.appendChild(h('text', { x: W + 4, y: yy.toFixed(1), style: 'fill:' + l.color + (l.rec ? ';font-weight:bold' : ''), text: (STRATEGIES[l.id] || {}).short || l.id }));
    }
    svg.appendChild(h('text', { x: 0, y: H + 18, text: 'today' }));
    svg.appendChild(h('text', { x: W, y: H + 18, 'text-anchor': 'end', text: days + ' d' }));
    return svg;
}

function weekBars(days) {
    const W = 700;
    const colW = 70;
    const gap = (W - 7 * colW) / 7;
    const max = Math.max(1, ...days.map((d) => STATS.reduce((a, k) => a + d[k], 0)));
    const svg = h('svg', { class: 'chart', viewBox: '0 0 ' + W + ' 92', role: 'img', 'aria-label': 'Trains per stat over the next 7 days' });
    const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const today = new Date(Date.now()).getUTCDay();
    days.forEach((d, i) => {
        const x = gap / 2 + i * (colW + gap);
        let yy = 4;
        for (const k of ['dex', 'def', 'spd', 'str']) {
            const hgt = (d[k] / max) * 64;
            if (hgt > 0) svg.appendChild(h('rect', { x: x.toFixed(1), y: yy.toFixed(1), width: colW, height: hgt.toFixed(1), fill: STAT_COLOR[k] }));
            yy += hgt;
        }
        svg.appendChild(h('text', { x: (x + colW / 2).toFixed(1), y: 86, 'text-anchor': 'middle', text: names[(today + i) % 7] }));
    });
    return svg;
}

export function renderPlan(m, ctx) {
    const compare = ctx.compare || {};
    const rec = m.recommendation;
    const days = ctx.settings.horizonDays || 30;
    const plan = ctx.plan;
    if (!rec || !rec.recommended || !compare[rec.recommended]) return { main: [h('p', { class: 'muted', text: 'Working out the plans…' })], pane: [] };
    const best = compare[rec.recommended];
    const S = STRATEGIES[rec.recommended];
    const pick = ctx.ui.planPick || null;
    const using = plan.strategy;

    const recCard = h('div', {}, [
        sectionHead('Recommended', meta(['for ' + fmtInt(m.total) + ' total · ' + fmtMoney(ctx.settings.budget) + ' budget · ' + days + ' days'])),
        h('div', { class: 'prime num' }, [
            h('div', {}, [h('span', { class: 'pill-tag chalk', text: KIND_TAG[S.kind] }), h('span', { class: 'k', style: 'margin-left:8px', text: S.name }), h('div', { class: 'd', style: 'margin-top:6px', text: S.what })]),
            h('div', { class: 'figs' }, [
                h('div', { class: 'fig' }, [t('lab', days + ' days'), h('b', { class: 'good', text: '+' + fmtShort(best.gained) })]),
                h('div', { class: 'fig' }, [t('lab', 'Cost'), h('b', { text: fmtMoney(best.cost) })]),
                h('div', { class: 'fig' }, [t('lab', 'Per day'), h('b', { text: planPerDay(best, days) })]),
            ]),
            h('div', { class: 'why' }, [
                'Why: ' + (rec.reasons[0] || 'It gains the most stats inside your budget.') + ' ',
                using === rec.recommended ? h('span', { class: 'c-good', text: 'You’re on it.' }) : h('a', { href: '#', onclick: (e) => { e.preventDefault(); ctx.setPlan({ strategy: rec.recommended, strategyPicked: true }); ctx.ui.planPick = null; }, text: 'Use it' }),
            ]),
        ]),
    ]);

    const altRows = [];
    if (m.nextGym && m.nextGym.gym) {
        altRows.push(h('tr', { class: 'click' + (plan.goal && plan.goal.kind === 'unlockGym' ? ' sel' : ''), tabindex: '0', onclick: () => ctx.setPlan({ goal: plan.goal && plan.goal.kind === 'unlockGym' ? null : { kind: 'unlockGym', gymId: m.nextGym.gym.id }, type: 'goal' }) }, [h('td', {}, [h('small', { text: 'Goal' })]), h('td', {}, [h('b', { class: 'w', text: 'Unlock a gym' })]), h('td', { class: 'muted', text: m.nextGym.gym.name + (m.nextGym.days !== null ? ' in about ' + Math.max(1, Math.round(m.nextGym.days)) + ' days' : ' is next') + ' on ' + (STRATEGIES[using] || S).short.toLowerCase() }), h('td', { class: 'r muted', text: 'same' }), h('td', { class: 'r muted', text: 'same' })]));
    }
    altRows.push(h('tr', { class: 'click' + (plan.goal && plan.goal.kind === 'statTargets' ? ' sel' : ''), tabindex: '0', onclick: () => { ctx.ui.goalForm = !ctx.ui.goalForm; ctx.rerender(); } }, [h('td', {}, [h('small', { text: 'Goal' })]), h('td', {}, [h('b', { class: 'w', text: 'Reach stat numbers' })]), h('td', { class: 'muted', text: plan.goal && plan.goal.kind === 'statTargets' ? Object.entries(plan.goal.targets).map(([k, v]) => STAT_LABEL[k] + ' ' + fmtInt(v)).join(' · ') : 'e.g. DEX 150,000: aims each train at what’s missing' }), h('td', { class: 'r muted', text: 'same' }), h('td', { class: 'r muted', text: 'same' })]));
    for (const a of rec.alternatives) {
        const st = STRATEGIES[a.id];
        const sel = (pick || using) === a.id;
        altRows.push(
            h('tr', { class: 'click' + (sel ? ' sel' : ''), tabindex: '0', onclick: () => { const w = pickWarning(best, compare[a.id], { bliss: m.pc.perks.bliss, days }); if (w.warn) { ctx.ui.planPick = a.id; ctx.rerender(); } else { ctx.ui.planPick = null; ctx.setPlan({ strategy: a.id, strategyPicked: true }); } } }, [
                h('td', {}, [h('small', { text: KIND_TAG[st.kind] })]),
                h('td', {}, [h('b', { class: 'w', text: st.name })]),
                h('td', { class: 'muted', text: st.what + (a.overBudget ? ' · over budget' : '') }),
                h('td', { class: 'r ' + (a.deltaStatsPct >= 0 ? 'c-good' : 'c-bad'), text: fmtPct(a.deltaStatsPct) }),
                h('td', { class: 'r ' + (a.deltaCost > 0 ? 'c-bad' : 'c-good'), text: (a.deltaCost >= 0 ? '+' : '−') + fmtMoney(Math.abs(a.deltaCost)) }),
            ]),
        );
    }
    const altTable = h('table', { class: 'tbl num' }, [h('thead', {}, [h('tr', {}, [h('th', { style: 'width:70px', text: 'Kind' }), h('th', { style: 'width:170px', text: 'Plan' }), h('th', { text: 'What you do' }), h('th', { class: 'r', style: 'width:90px', text: 'Stats' }), h('th', { class: 'r', style: 'width:90px', text: 'Cost' })])]), h('tbody', {}, altRows)]);

    const blocks = [sectionHead('Other plans', meta(['compared with ' + S.short.toLowerCase() + ' · click a row to pick it'])), altTable];
    if (ctx.ui.goalForm) {
        const vals = (plan.goal && plan.goal.kind === 'statTargets' && plan.goal.targets) || {};
        const inputs = {};
        blocks.push(
            h('div', { class: 'row num', style: 'margin-top:10px;flex-wrap:wrap' }, [
                ...STATS.map((k) => h('label', { class: 'field', style: 'width:140px' }, [t('lab', STAT_LABEL[k]), (inputs[k] = h('input', { class: 'inp num', inputmode: 'numeric', placeholder: fmtInt(m.pc.stats[k]), value: vals[k] ? String(vals[k]) : '' }))])),
                h('button', { class: 'btn primary', type: 'button', style: 'align-self:flex-end', onclick: () => { const targets = {}; for (const k of STATS) { const v = Number(String(inputs[k].value).replace(/[^\d]/g, '')); if (v > m.pc.stats[k]) targets[k] = v; } ctx.ui.goalForm = false; ctx.setPlan(Object.keys(targets).length ? { goal: { kind: 'statTargets', targets }, type: 'goal' } : { goal: null }); }, text: 'Save goal' }),
            ]),
        );
    }
    if (pick && compare[pick]) {
        const w = pickWarning(best, compare[pick], { bliss: m.pc.perks.bliss, days });
        blocks.push(
            h('div', { class: 'warnb num', style: 'margin-top:12px' }, [
                h('b', { text: w.title }),
                h('p', { text: w.text + ' ' + w.reasons.join(' ') }),
                h('div', { class: 'acts' }, [
                    h('button', { class: 'btn primary', type: 'button', onclick: () => { ctx.ui.planPick = null; ctx.setPlan({ strategy: rec.recommended, strategyPicked: true }); }, text: 'Keep ' + S.short.toLowerCase() }),
                    h('button', { class: 'btn', type: 'button', onclick: () => { ctx.ui.planPick = null; ctx.setPlan({ strategy: pick, strategyPicked: true }); }, text: 'Use it anyway' }),
                ]),
            ]),
        );
    }

    // The build is yours to pick (specialist builds first); the high stat decides where the specialist gym and merits go.
    const current = BUILD_ALIASES[plan.build] || String(plan.build || 'baldr');
    const curBase = current.split(':')[0];
    const high = highStatOf(current) || 'str';
    const buildFor = (id) => (highStatOf(id) ? resolveBuild(id + ':' + high) : BUILDS[id]);
    const buildIdFor = (id) => (highStatOf(id) ? id + ':' + high : id);
    const buildRows = BUILD_ORDER.map((id) => {
        const b = buildFor(id);
        const sel = curBase === id;
        return h('div', { class: 'brow' + (sel ? ' sel' : ''), tabindex: '0', role: 'button', onclick: () => ctx.setPlan({ build: buildIdFor(id), buildPicked: true }) }, [
            h('b', {}, [BUILDS[id].name, sel ? h('span', { class: 'pill-tag chalk', style: 'margin-left:6px', text: plan.buildPicked ? 'Yours' : 'Pick one' }) : null]),
            h('div', { class: 'ratio' }, STATS.map((k) => h('i', { style: 'width:' + (b.shares[k] * 100).toFixed(1) + '%;background:' + STAT_COLOR[k] }))),
            t('', b.line),
            t('', b.gyms.map((g) => (gymById(g) || { name: '' }).name.replace(' Gym', '').replace('Mr. ', '')).join(' + ')),
        ]);
    });

    const todayTrains = m.projection[0] || {};
    const todayTxt = STATS.filter((k) => todayTrains[k]).map((k) => STAT_LABEL[k] + ' ' + todayTrains[k]).join(', ');
    const youVs = h('div', {}, [
        sectionHead('You vs ' + m.build.name, meta(['Today: ' + STATS.reduce((a, k) => a + (todayTrains[k] || 0), 0) + ' trains → ', h('b', { text: todayTxt || 'none' })])),
        statRowsBlock(m, { todayCol: 'trains' }),
        h('div', { style: 'margin-top:16px' }, [
            h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:6px' }, [t('lab', 'Next 7 days · trains per stat'), h('span', { class: 'legend' }, STATS.map((k) => h('span', {}, [h('i', { style: 'background:' + STAT_COLOR[k] }), STAT_LABEL[k]])))]),
            weekBars(m.projection),
            h('div', { class: 'sgfoot num' }, [h('span', {}, [m.build.name + ' in ', h('b', { text: m.reachedDay === null ? 'more than 30 days' : m.reachedDay === 0 ? 'now' : 'about ' + m.reachedDay + ' days' })])]),
        ]),
    ]);

    let daysIn;
    let budgetIn;
    const pane = [
        h('div', {}, [
            sectionHead(days + ' days', meta(['stats gained, each plan'])),
            planChart(compare, rec.recommended, days),
            h('dl', { class: 'kv num', style: 'margin-top:8px' }, Object.values(compare).sort((a, b) => b.gained - a.gained).flatMap((r) => [h('dt', { text: STRATEGIES[r.id].name }), h('dd', { class: r.id === rec.recommended ? 'white' : r.gained < best.gained * 0.8 ? 'c-warn' : null, text: '+' + fmtShort(r.gained) + ' · ' + fmtMoney(r.cost) })])),
        ]),
        h('div', {}, [
            sectionHead('Plan for', null, null, 'h3'),
            h('div', { class: 'row' }, [
                h('label', { class: 'field', style: 'flex:1' }, [t('lab', 'Days'), (daysIn = h('input', { class: 'inp num', inputmode: 'numeric', value: String(days), onchange: () => { const v = Math.max(3, Math.min(90, Number(daysIn.value) || 30)); ctx.setSettings({ horizonDays: v }); } }))]),
                h('label', { class: 'field', style: 'flex:2' }, [t('lab', 'Budget'), (budgetIn = h('input', { class: 'inp num', inputmode: 'numeric', value: '$' + fmtInt(ctx.settings.budget), onchange: () => { const v = Number(String(budgetIn.value).replace(/[^\d]/g, '')) || 0; ctx.setSettings({ budget: v }); } }))]),
            ]),
            rec.alternatives.some((a) => a.overBudget) ? h('p', { class: 'muted', style: 'margin:8px 0 0;font-size:12px', text: rec.alternatives.filter((a) => a.overBudget).map((a) => STRATEGIES[a.id].short).join(', ') + ' over this budget.' }) : null,
        ]),
        h('div', {}, [sectionHead('When you’re late', null, null, 'h3'), headsList([{ tone: 'plain', text: 'Steady and goal plans', sub: 're-time by themselves; later steps move' }, { tone: 'warn', text: 'Jump plans', sub: 'warn 5 min before the tick or cooldown, then re-time' }])]),
    ];

    const highSeg = h('div', { class: 'row', style: 'margin:0 0 8px' }, [
        t('lab', 'High stat'),
        h('div', { class: 'seg', role: 'group', 'aria-label': 'High stat' }, STATS.map((k) => h('button', { type: 'button', 'aria-pressed': String(k === high), onclick: () => ctx.setPlan({ build: (highStatOf(curBase) ? curBase : 'baldr') + ':' + k, buildPicked: true }), text: STAT_LABEL[k] }))),
        h('span', { class: 'muted', style: 'font-size:12px', text: highStatOf(curBase) ? 'where the single-stat gym and your merits go (DEF or DEX high = the defensive version)' : 'for Baldr\u2019s and Hank\u2019s' }),
    ]);
    const georges = m.pc.unlocked.includes(GEORGES);
    const buildNote = georges ? null : h('p', { class: 'muted', style: 'margin:8px 0 0;font-size:12px', text: 'Specialist gyms open after George\u2019s. Until then every train still moves you toward this build, so you qualify the day they open.' });
    return { main: [recCard, h('div', {}, blocks), h('div', {}, [sectionHead('Build', meta([plan.buildPicked ? 'the plan trains toward your build' : 'pick your build type: the plan trains toward it'])), highSeg, h('div', { class: 'builds num' }, buildRows), buildNote]), youVs], pane };
}
