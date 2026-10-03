/*
 * Plan (mockups/round3/T-plan.html): one question, "which plan, and why?".
 * On top, the Plan dropdown (most stats in my budget · best value · max
 * gains) and the inputs that change every number: days, budget, what you
 * train toward, special refills (only when the account has some), Ignorance
 * Is Bliss. Then the Recommended card, every other plan with why it isn't
 * the pick (plans that don't fit you hidden behind a tick), and where your
 * energy comes from. Pane: the 30-day chart, the build, the Bliss card.
 */

import { h, t } from '../dom.js';
import { STATS, STAT_LABEL } from '../../core/gain.js';
import { fmtInt, fmtShort, fmtMoney, fmtPct, fmtSigned } from '../../core/format.js';
import { STRATEGIES, SPECIAL, planWhat } from '../../core/strategies.js';
import { tierWords } from '../../core/candy.js';
import { pickWarning, perMillion, PICK_BY } from '../../core/recommend.js';
import { budgetOf } from '../../core/auto.js';
import { BUILDS, BUILD_ORDER, BUILD_ALIASES, resolveBuild, highStatOf } from '../../core/builds.js';
import { GEORGES, gymById } from '../../core/gyms.js';
import { XANAX, EDVD, FHC, POINTS, REFILL_POINTS, ITEMS, CANDY_KISSES, CANDY_IDS, itemName } from '../../core/items.js';
import { lineChart, chartNum } from '../charts.js';
import { sectionHead, meta, STAT_COLOR, planRunWords } from './common.js';
import { trainInText, whyOneStat, whyMix } from '../../core/gympage.js';
import { progressOf } from '../../core/planline.js';
import { monthlyOf } from '../../core/saved-plan.js';

const KIND_TAG = { steady: 'Steady', boost: 'Boost', jump: 'Jump' };

/** "2 Xanax + refill", "3 Xanax + 4 FHC + refill", "¾ EDVD". */
export function planPerDay(r, days) {
    const per = (id) => ((r.used && r.used[id]) || 0) / days;
    const n = (v) => (v >= 1 ? String(Math.round(v)) : v >= 0.7 ? '¾' : v >= 0.4 ? '½' : '¼');
    const parts = [];
    if (per(XANAX)) parts.push(n(per(XANAX)) + ' Xanax');
    if (per(EDVD)) parts.push(n(per(EDVD)) + ' EDVD');
    if (per(FHC)) parts.push(n(per(FHC)) + ' FHC');
    for (const id of [530, 532, 533]) if (per(id)) parts.push(n(per(id)) + ' ' + ITEMS[id].name.replace(/^Can of /, ''));
    // The candy the plan picked, by name.
    const candyId = r.candy ? r.candy.id : CANDY_KISSES;
    if (per(candyId) && !per(EDVD)) parts.push(r.candy ? itemName(candyId) : 'candy');
    // A refill a day, points or (while specials are held) a special.
    if (((r.used && r.used[POINTS]) || 0) / REFILL_POINTS + ((r.used && r.used.dailySpecial) || 0) >= days * 0.9) parts.push('refill');
    return parts.join(' + ') || '—';
}

/** The table's why-not: what it loses, then the first reason (the whole line is the cell's tooltip). */
function shortWhy(why) {
    const s = String(why || '');
    const i = s.indexOf(': ');
    if (i < 0) return s;
    const first = s.slice(i + 2).split('; ')[0].replace(/\.$/, '');
    return s.slice(0, i) + ': ' + first + (s.slice(i + 2).includes('; ') ? '…' : '.');
}

function kindOf(id) {
    const s = STRATEGIES[id];
    if (id === 'blissSteady') return 'Book';
    return s ? KIND_TAG[s.kind] || 'Steady' : '';
}

/** Picking another of the saved plans yourself: followed at once, nothing is worked out again (round 6). */
export function pickPlan(ctx, id) {
    ctx.setPlan({ strategy: id, strategyPicked: true });
}

/** The Plan dropdown: stands out, chalk-edged. */
function planChooser(ctx) {
    const cur = PICK_BY[ctx.plan.pickBy] ? ctx.plan.pickBy : 'most';
    const det = h('details', { class: 'plansel' }, [h('summary', {}, [t('lab', 'Plan'), h('b', { text: PICK_BY[cur].name })])]);
    // The options exist only while it's open (nothing hidden to click by accident).
    const menu = () =>
        h(
            'div',
            { class: 'menu', role: 'listbox', 'aria-label': 'What to plan for' },
            Object.values(PICK_BY).map((o) =>
                h('button', { type: 'button', class: 'opt' + (o.id === cur ? ' on' : ''), role: 'option', 'aria-selected': String(o.id === cur), onclick: () => { det.open = false; ctx.setPlan({ pickBy: o.id, pickByPicked: true }); } }, [h('b', { text: o.name }), h('span', { text: o.what })]),
            ),
        );
    det.addEventListener('toggle', () => {
        const old = det.querySelector('.menu');
        if (old) old.remove();
        if (det.open) det.appendChild(menu());
    });
    return det;
}

function numberInput(value, width, onSet, { money = false, min = 0, max = Infinity, label = null } = {}) {
    const inp = h('input', { class: 'inp num', inputmode: 'numeric', 'aria-label': label, style: 'width:' + width + 'px', value: money ? '$' + fmtInt(value) : String(value) });
    inp.addEventListener('change', () => {
        const v = Number(String(inp.value).replace(/[^\d]/g, ''));
        if (Number.isFinite(v)) onSet(Math.max(min, Math.min(max, v)));
    });
    return inp;
}

/** Every build, specialist ones with each high stat (DEF/DEX high = their defensive versions), as a real dropdown. */
export function buildOptions() {
    const out = [];
    for (const id of BUILD_ORDER) {
        if (highStatOf(id + ':str')) for (const k of STATS) out.push({ value: id + ':' + k, label: resolveBuild(id + ':' + k).name });
        else out.push({ value: id, label: BUILDS[id].name });
    }
    return out;
}

function buildSelect(ctx) {
    const plan = ctx.plan;
    const current = BUILD_ALIASES[plan.build] || String(plan.build || 'baldr');
    const opts = buildOptions();
    const sel = h(
        'select',
        { 'aria-label': 'Build to train toward', onchange: (e) => ctx.setPlan({ build: e.target.value, buildPicked: true }) },
        [plan.buildPicked ? null : h('option', { value: '', text: 'Pick your build', disabled: true }), ...opts.map((o) => h('option', { value: o.value, text: 'Build · ' + o.label }))],
    );
    sel.value = plan.buildPicked || opts.some((o) => o.value === current) ? current : '';
    return sel;
}

/**
 * The money part of the bar: Auto shows what your income affords (no box to
 * fill); the manual plans keep the budget box; "Max gains" has none.
 */
function budgetControls(m, ctx) {
    const s = ctx.settings;
    const pickBy = ctx.plan.pickBy;
    const a = m.auto;
    if (pickBy === 'max') return [h('span', { class: 'muted', text: '· no budget' })];
    if (pickBy === 'auto' && a && a.ready) {
        return [t('lab', 'with'), h('b', { class: 'white num', text: fmtMoney(Math.round(a.budgetPerDay)) + ' a day' }), h('span', { class: 'muted', text: a.source === 'floor' ? 'from your certain income (bank, dividends, rent)' : 'from your income (last ' + Math.round(a.days) + ' days' + (a.source === 'log' ? ', money log' : ', networth') + ')' + (a.floor && a.floor.perDay > 0 ? ' · ' + fmtMoney(Math.round(a.floor.perDay)) + ' of it certain' : '') }), h('span', { class: 'info', title: (a.source === 'log' ? 'Income = money in less money out a day in your money log (Full key), plus what the gym plan spends.' : 'Income = how fast your networth grew (Torn’s own history), plus what the gym plan spends; your money log has nothing readable yet.') + (a.networthPerDay !== null && a.source === 'log' ? ' Cross-check: your networth grew ' + fmtMoney(Math.round(a.networthPerDay)) + ' a day.' : '') + ' Auto spends at most that a day.', text: 'i' })];
    }
    // Round 6: a budget a day (the plan's length comes from Create plan).
    const perDay = Math.round((s.budget || 0) / (s.horizonDays || 30));
    const box = [t('lab', 'with'), numberInput(perDay, 120, (v) => (v > 0 ? ctx.setSettings({ budget: v * 30, horizonDays: 30 }) : ctx.rerender()), { money: true, label: 'Budget a day' }), h('span', { class: 'muted', text: 'a day' })];
    if (pickBy === 'auto' && a && a.wait) box.push(h('span', { class: 'tag warn', title: a.wait, text: a.needsKey ? 'Auto needs a Full key' : 'Reading your income…' }));
    return box;
}

function controls(m, ctx) {
    const plan = ctx.plan;
    const s = ctx.settings;
    const days = s.horizonDays || 30;
    const goal = plan.goal;
    const goalChip =
        goal && goal.kind === 'statTargets'
            ? h('b', { class: 'white', text: 'Stat numbers · ' + Object.entries(goal.targets || {}).map(([k, v]) => STAT_LABEL[k] + ' ' + fmtShort(v)).join(' · ') })
            : goal && goal.kind === 'unlockGym'
              ? h('b', { class: 'white', text: 'Unlock ' + ((gymById(goal.gymId, m.pc && m.pc.table) || {}).name || 'a gym') })
              : buildSelect(ctx);
    void days;
    const bar1 = [
        planChooser(ctx),
        ...budgetControls(m, ctx),
        h('span', { class: 'sep' }),
        t('lab', 'Train toward'),
        goalChip,
        goal && goal.kind === 'unlockGym' ? openByInput(goal, ctx) : null,
        goal
            ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => ctx.setPlan({ goal: null }), text: 'Back to the build' })
            : h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { ctx.ui.goalForm = !ctx.ui.goalForm; ctx.rerender(); }, text: '+ Stat numbers' }),
        !goal && m.nextGym && m.nextGym.gym ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => ctx.setPlan({ goal: { kind: 'unlockGym', gymId: m.nextGym.gym.id } }), text: '+ Unlock ' + m.nextGym.gym.name }) : null,
    ];
    const bar2 = [];
    const sp = m.special || {};
    if (sp.have > 0) {
        const perE = m.ladder ? m.ladder.perEnergy : 0;
        const each = m.state.energy.maximum;
        bar2.push(
            t('lab', 'Special refills'),
            h('span', { class: 'muted' }, ['you have ', h('b', { class: 'white', text: fmtInt(sp.have) }), ' · use']),
            numberInput(sp.use || 0, 58, (v) => ctx.setPlan({ specialUse: Math.min(v, sp.have), specialStart: sp.have, specialSetAt: Date.now() }), { label: 'Special refills to use' }),
            h('span', { class: 'muted', text: 'in this plan · each adds ' + each + ' energy' + (perE ? ' (about +' + fmtShort(perE * each) + ' stats for you)' : '') + (sp.use ? ' · ' + sp.left + ' left' : ' · set how many to use') }),
            h('span', { class: 'info', title: 'Shown because Torn says your account has special refills. They aren’t limited to one a day (at most 100 a week): the plan puts them where they add the most (in a happy jump or boost, where the happy they cost resets anyway) and keeps the rest. A refill fills energy to the maximum, never above it, so each is used once the last is trained. While you hold any, Torn lets you use the points refill only once they’re spent (one source), so the plan’s daily refill is a special until then.', text: 'i' }),
            h('span', { class: 'muted', text: '· daily refill: a special while you hold any' }),
            h('span', { class: 'sep' }),
        );
    }
    const bliss = m.pc && m.pc.perks.bliss;
    bar2.push(t('lab', 'Ignorance Is Bliss'), h('span', { class: 'tag' + (bliss ? ' good' : ''), text: bliss ? 'Active' + (m.pc.perks.blissDays ? ' · ' + m.pc.perks.blissDays + ' days' : '') : 'Not active' }), h('span', { class: 'info', title: 'Read from your perks: the book’s line shows while it is active (31 days). The plan counts it the day it shows.', text: 'i' }));
    // The note for the whole bar sits at the right of the second line, so the first never wraps for it.
    bar2.push(h('span', { class: 'muted', style: 'margin-left:auto', text: 'Used by the next Create plan or Re-plan' }));
    return [bar1, bar2];
}

/**
 * "Open it by" (round 7, optional): a date for the gym to unlock. With one, the next Create plan or Re-plan leaves
 * out the plans that open it later; without one the gym is only shown on every plan. It never outranks stats.
 */
function openByInput(goal, ctx) {
    const value = goal.by ? new Date(goal.by - 1).toISOString().slice(0, 10) : '';
    const inp = h('input', { class: 'inp num', type: 'date', 'aria-label': 'Open it by', title: 'Optional: plans that open the gym after this day are left out of the next Create plan or Re-plan. The gym never outranks stats otherwise.', style: 'width:138px', value });
    inp.addEventListener('change', () => {
        const day = Date.parse(inp.value + 'T00:00:00Z');
        // Through that Torn day: its end.
        ctx.setPlan({ goal: { ...goal, by: Number.isFinite(day) ? day + 86400e3 : null } });
    });
    return h('span', { class: 'row', style: 'gap:6px' }, [t('lab', 'by'), inp]);
}

function goalForm(m, ctx) {
    const plan = ctx.plan;
    const vals = (plan.goal && plan.goal.kind === 'statTargets' && plan.goal.targets) || {};
    const inputs = {};
    return h('div', { class: 'row num', style: 'margin-top:12px;flex-wrap:wrap;gap:12px' }, [
        ...STATS.map((k) => h('label', { class: 'field', style: 'width:150px' }, [t('lab', STAT_LABEL[k] + ' to reach'), (inputs[k] = h('input', { class: 'inp num', inputmode: 'numeric', 'aria-label': STAT_LABEL[k] + ' to reach', placeholder: fmtInt(m.pc.stats[k]), value: vals[k] ? String(vals[k]) : '' }))])),
        h('button', {
            class: 'btn primary',
            type: 'button',
            style: 'align-self:flex-end',
            onclick: () => {
                const targets = {};
                for (const k of STATS) {
                    const v = Number(String(inputs[k].value).replace(/[^\d]/g, ''));
                    if (v > m.pc.stats[k]) targets[k] = v;
                }
                ctx.ui.goalForm = false;
                ctx.setPlan(Object.keys(targets).length ? { goal: { kind: 'statTargets', targets } } : { goal: null });
            },
            text: 'Train toward these',
        }),
    ]);
}

function recommendedCard(m, ctx, rec, compare, days) {
    const best = compare[rec.recommended];
    const S = STRATEGIES[rec.recommended];
    const using = ctx.plan.strategy;
    const pickBy = rec.pickBy || 'most';
    const figs = [
        h('div', { class: 'fig' }, [t('lab', days + ' days'), h('b', { class: 'good', text: '+' + fmtShort(best.gained) })]),
        h('div', { class: 'fig' }, [t('lab', 'Cost'), h('b', { text: fmtMoney(best.cost) })]),
        h('div', { class: 'fig' }, [t('lab', 'Per $1M'), h('b', { text: best.cost > 0 ? chartNum(perMillion(best)) + ' stats' : '—' })]),
        h('div', { class: 'fig' }, [t('lab', pickBy === 'max' ? 'A day' : 'Per day'), h('b', { text: pickBy === 'max' ? fmtMoney(best.cost / days) : planPerDay(best, days) })]),
    ];
    const reasons = rec.reasons.length ? rec.reasons.join(' ') : 'It gains the most stats inside your budget.';
    // Cash on hand against the plan's pace: under a day of it is said as that, never "lasts about 0 days".
    const spend = m.spend && m.spend.lastsDays !== null && m.spend.cash !== null ? (m.spend.lastsDays < 1 ? ' You have ' + fmtMoney(m.spend.cash) + ' on hand: less than a day of this plan (' + fmtMoney(m.spend.perDay) + ' a day).' : ' Your ' + fmtMoney(m.spend.cash) + ' on hand lasts about ' + Math.round(m.spend.lastsDays) + ' days at ' + fmtMoney(m.spend.perDay) + ' a day.') : '';
    const a = m.auto;
    // What the saved plan was made with (round 6: its budget and income are the ones it saw, until you recalibrate).
    const snap = m.savedPlan ? m.savedPlan.snapshot : null;
    const autoOn = Boolean(snap && snap.income && rec.pickBy === 'auto');
    const money = autoOn ? fmtMoney(Math.round(snap.budgetPerDay)) + ' a day from your income' : snap && snap.budgetPerDay !== null ? fmtMoney(Math.round(snap.budgetPerDay)) + ' a day' : 'no budget';
    const kids = [
        sectionHead('Recommended', meta(['for ' + fmtInt(m.total) + ' total · ' + money + ' · ' + days + ' days'])),
        h('div', { class: 'prime num' }, [
            h('div', {}, [h('span', { class: 'pill-tag chalk', text: kindOf(rec.recommended) }), h('span', { class: 'k', style: 'margin-left:8px', text: S.name }), h('div', { class: 'd', style: 'margin-top:6px', text: planWhat(rec.recommended, best) }), best && best.candy && tierWords(best.candy.id) ? h('div', { class: 'd muted', style: 'margin-top:2px;font-size:13px', text: 'Candy: ' + tierWords(best.candy.id) + '; what you hold goes first' }) : null]),
            h('div', { class: 'figs' }, figs),
            h('div', { class: 'why' }, [
                'Wins because: ' + reasons + (autoOn && a && a.afford ? ' ' + a.afford : spend) + ' ',
                using === rec.recommended
                    ? h('span', { class: 'c-good', text: 'You’re on it.' })
                    : m.saved && !ctx.plan.strategyPicked
                      ? h('span', { class: 'muted', text: 'Your saved plan follows ' + ((STRATEGIES[using] || {}).short || using).toLowerCase() + ' for these days and switches on its dates.' })
                      : null,
            ]),
        ]),
        ctx.plan.pickBy === 'auto' && a && a.wait ? h('div', { class: 'warnb', style: 'margin-top:10px' }, [h('b', { text: a.needsKey ? 'Auto mode needs a Full key' : 'Reading your income' }), h('p', { text: a.wait }), a.needsKey ? h('div', { class: 'acts' }, [h('button', { class: 'btn primary sm', type: 'button', onclick: () => ctx.go('settings'), text: 'Add it in Settings' })]) : null]) : null,
        autoOn && a.breakdown && a.breakdown.lines.length ? incomeLines(a.breakdown) : null,
        m.unlock ? unlockBlock(m, ctx, days) : null,
        refillLine(best, days),
        gymWorthLines(m, days),
        h('div', { class: 'note2', text: 'If you’re late: steady and goal plans re-time by themselves. Jump plans warn 5 min before the tick, then re-time.' }),
    ];
    if (ctx.ui.goalForm) kids.push(goalForm(m, ctx));
    const pick = ctx.ui.planPick;
    if (pick && compare[pick]) {
        const w = pickWarning(best, compare[pick], { bliss: m.pc.perks.bliss, days });
        kids.push(
            h('div', { class: 'warnb num', style: 'margin-top:12px' }, [
                h('b', { text: w.title }),
                h('p', { text: w.text + ' ' + w.reasons.join(' ') + '' }),
                h('div', { class: 'acts' }, [
                    h('button', { class: 'btn primary', type: 'button', onclick: () => { ctx.ui.planPick = null; ctx.setPlan({ strategy: rec.recommended, strategyPicked: true }); }, text: 'Keep ' + S.short.toLowerCase() }),
                    h('button', { class: 'btn', type: 'button', onclick: () => { ctx.ui.planPick = null; pickPlan(ctx, pick); }, text: 'Use it anyway' }),
                ]),
            ]),
        );
    }
    // Not on the recommended plan (your own pick): the card pulses and asks once: use it, or keep yours (the owner,
    // 2026-10-03). "No" stops the pulse for this page visit.
    const nudge = using !== rec.recommended && !(m.saved && !ctx.plan.strategyPicked) && ctx.ui.recNo !== rec.recommended;
    if (using !== rec.recommended && !(m.saved && !ctx.plan.strategyPicked))
        kids.splice(2, 0, h('div', { class: 'acts', style: 'margin-top:16px' }, [
            h('button', { class: 'btn primary', type: 'button', onclick: () => { ctx.ui.planPick = null; ctx.setPlan({ strategy: rec.recommended, strategyPicked: true }); }, text: 'Use ' + S.short.toLowerCase() }),
            nudge ? h('button', { class: 'btn', type: 'button', onclick: () => { ctx.ui.recNo = rec.recommended; ctx.rerender(); }, text: 'No, keep ' + ((STRATEGIES[using] || {}).short || using).toLowerCase() }) : null,
        ]));
    return h('div', { class: 'lead' + (nudge ? ' rec-nudge' : '') }, kids);
}

/**
 * Is each gym the plan opens worth its fee (round 7, the friend's question)? The plan was run with and without it:
 * "Racing Fitness opens on day 3: +12k stats by the plan's end for its $1M fee."
 */
function gymWorthLines(m, days) {
    const list = (m.savedPlan && m.savedPlan.gymWorth) || [];
    if (!list.length) return null;
    return h('div', { class: 'note2 num' }, [
        h('b', { class: 'white', text: 'Gyms this plan opens: ' }),
        list.map((g) => g.name + (g.day ? ' on day ' + g.day : '') + ': ' + (g.gain >= 0 ? '+' + fmtShort(g.gain) : '−' + fmtShort(-g.gain)) + ' stats by day ' + days + ' for its ' + fmtMoney(g.fee) + ' fee').join(' · ') + '.',
        ' Each is the plan run with and without that gym; the fees are in the plan’s cost.',
    ]);
}

/** Is the daily points refill worth it in this plan? (The comparison ran it with and without when it mattered.) */
function refillLine(r, days) {
    if (!r || r.refill === undefined) return null;
    const words = r.refillGain > 0 ? ' +' + fmtShort(r.refillGain) + ' stats for ' + fmtMoney(r.refillCost) + ' over ' + days + ' days' : '';
    if (r.refill === false) return h('div', { class: 'note2 num' }, [h('b', { class: 'white', text: 'Daily refill: left out.' }), words ? ' It would add' + words + ', which isn’t worth it under your Plan rule.' : ' Not worth its price under your Plan rule.']);
    return h('div', { class: 'note2 num' }, [h('b', { class: 'white', text: 'Daily refill: worth it.' }), words ? ' It adds' + words + '.' : ' It fits your budget.']);
}

/** Where Auto's income comes from, from the money log (the Full key). */
function incomeLines(b) {
    const top = b.lines.filter((l) => l.dir === 'in').slice(0, 4);
    if (!top.length) return null;
    return h('div', { class: 'note2 num', style: 'margin-top:8px' }, ['Coming in (your money log, ' + Math.round(b.days) + ' days): ', top.map((l) => l.title + ' ' + fmtMoney(Math.round(l.perDay)) + '/day').join(' · ')]);
}

/**
 * The gym to unlock: when each plan opens it, with its stats and cost against the recommended plan (the same
 * baseline as Other plans). Round 7: information, plus an optional date; it never changes the pick by itself.
 */
function unlockBlock(m, ctx, days) {
    const u = m.unlock;
    const when = (r) => (r.day ? 'day ' + r.day + ' \u00b7 ' + new Date(r.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : r.days !== null && r.days !== undefined ? (r.days < 1 ? 'today' : 'in about ' + Math.ceil(r.days) + ' days') : 'not in these ' + days + ' days');
    const order = (r) => (r.day ? r.day : r.days !== null && r.days !== undefined ? r.days + 1 : Infinity);
    const rec = u.rows[u.best] || null;
    const rows = Object.entries(u.rows)
        .filter(([, r]) => !r.blocked)
        .sort((x, y) => order(x[1]) - order(y[1]) || y[1].gained - x[1].gained)
        .slice(0, 8)
        .map(([id, r]) => {
            const late = u.byDay > 0 && (!r.day || r.day > u.byDay);
            return h('tr', { class: id === ctx.plan.strategy ? 'sel' : '' }, [
                h('td', {}, [h('b', { class: 'w', text: (STRATEGIES[id] || {}).name || id }), id === u.best ? h('span', { class: 'tag chalk', style: 'margin-left:6px', text: 'recommended' }) : null]),
                h('td', { class: 'r ' + (late ? 'c-bad' : ''), text: when(r) + (late ? ' \u00b7 after your date' : '') }),
                h('td', { class: 'r', text: '+' + fmtShort(r.gained) }),
                h('td', { class: 'r ' + (id === u.best ? 'muted' : r.statsPct < -0.5 ? 'c-bad' : r.statsPct > 0.5 ? 'c-good' : 'muted'), text: id === u.best ? '\u2014' : fmtPct(r.statsPct) }),
                h('td', { class: 'r', text: fmtMoney(r.cost) }),
            ]);
        });
    // Rushing it: the plan that opens the gym soonest against the recommended one.
    const fastest = Object.entries(u.rows).filter(([, r]) => !r.blocked && r.day).sort((x, y) => x[1].day - y[1].day || y[1].gained - x[1].gained)[0];
    const rush = fastest && rec && rec.day && fastest[0] !== u.best && fastest[1].day < rec.day ? ((STRATEGIES[fastest[0]] || {}).short || fastest[0]) + ' opens it ' + (rec.day - fastest[1].day) + ' day' + (rec.day - fastest[1].day === 1 ? '' : 's') + ' sooner for ' + (fastest[1].cost - rec.cost >= 0 ? fmtMoney(fastest[1].cost - rec.cost) + ' more' : fmtMoney(rec.cost - fastest[1].cost) + ' less') + ' and ' + (fastest[1].gained >= rec.gained ? fmtShort(fastest[1].gained - rec.gained) + ' more stats' : fmtShort(rec.gained - fastest[1].gained) + ' fewer stats') + ' over the ' + days + ' days.' : null;
    return h('div', { style: 'margin-top:12px' }, [
        sectionHead('Unlock ' + u.gym.name, meta([fmtInt(u.energyLeft) + ' energy through the gym to go \u00b7 ' + (u.byDay > 0 ? 'open it by day ' + u.byDay : 'no date set: shown on every plan, never a reason to pick fewer stats')]), null, 'h3'),
        h('table', { class: 'tbl num' }, [h('thead', {}, [h('tr', {}, [h('th', { text: 'Plan' }), h('th', { class: 'r', text: 'Opens' }), h('th', { class: 'r', text: 'Stats' }), h('th', { class: 'r', title: 'Against the recommended plan', text: 'vs pick' }), h('th', { class: 'r', text: 'Cost' })])]), h('tbody', {}, rows)]),
        rush ? h('div', { class: 'note2 num', text: rush }) : null,
    ]);
}

function otherPlans(m, ctx, rec, compare, days) {
    const best = compare[rec.recommended];
    const showAll = Boolean(ctx.ui.planShowAll);
    const hiddenAlts = rec.alternatives.filter((a) => !a.fits);
    const using = ctx.plan.strategy;
    const rows = [];
    for (const a of rec.alternatives) {
        if (!a.fits && !showAll) continue;
        const st = STRATEGIES[a.id];
        // The plan you're really on is marked whatever you're picking; a pick still waiting on its warning has its own look.
        const current = a.id === using;
        const pending = ctx.ui.planPick === a.id && !current;
        rows.push(
            h('tr', {
                class: 'click' + (current ? ' sel' : '') + (pending ? ' pending' : ''),
                tabindex: '0',
                role: 'button',
                'aria-label': 'Pick ' + st.name,
                onkeydown: (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.currentTarget.click();
                    }
                },
                onclick: () => {
                    const w = pickWarning(best, compare[a.id], { bliss: m.pc.perks.bliss, days });
                    if (w.warn) {
                        ctx.ui.planPick = a.id;
                        ctx.rerender();
                    } else {
                        ctx.ui.planPick = null;
                        pickPlan(ctx, a.id);
                    }
                },
            }, [
                h('td', {}, [h('small', { text: kindOf(a.id) })]),
                h('td', {}, [h('b', { class: 'w', text: st.name }), current ? h('span', { class: 'tag chalk', style: 'margin-left:6px', text: 'current plan' }) : null, pending ? h('span', { class: 'tag warn', style: 'margin-left:6px', text: 'picked · see the warning' }) : null]),
                h('td', { class: 'muted second', title: compare[a.id] && compare[a.id].candy ? tierWords(compare[a.id].candy.id) || null : null, text: planWhat(a.id, compare[a.id]) }),
                h('td', { class: 'r' }, ['+' + fmtShort(a.gained), h('br'), h('span', { class: a.deltaStatsPct >= 0 ? 'c-good' : 'c-bad', style: 'white-space:nowrap', text: fmtPct(a.deltaStatsPct) })]),
                h('td', { class: 'r' }, [fmtMoney(a.cost), h('br'), h('span', { class: a.deltaCost > 0 ? 'c-bad' : 'c-good', style: 'white-space:nowrap', text: (a.deltaCost >= 0 ? '+' : '−') + fmtMoney(Math.abs(a.deltaCost)) })]),
                h('td', { class: 'r', text: a.cost > 0 ? chartNum(a.perM) : '—' }),
                h('td', { class: 'why', title: a.why, text: shortWhy(a.why) }),
            ]),
        );
    }
    // Ignorance Is Bliss, what if (only while the book isn't active).
    for (const w of Object.values(m.whatIf || {})) {
        const st = STRATEGIES[w.id];
        const d = best.gained > 0 ? (100 * (w.gained - best.gained)) / best.gained : 0;
        rows.push(
            h('tr', { class: 'whatif' }, [
                h('td', {}, [h('small', { text: 'Book' })]),
                h('td', {}, [h('b', { class: 'w', text: st.name === 'Steady with Bliss' ? st.name : st.name + ' with Bliss' }), ' ', h('span', { class: 'tag', text: 'what-if' })]),
                h('td', { class: 'second', text: planWhat(w.id, w) }),
                h('td', { class: 'r', text: fmtPct(d) }),
                h('td', { class: 'r', text: (w.cost - best.cost >= 0 ? '+' : '−') + fmtMoney(Math.abs(w.cost - best.cost)) }),
                h('td', { class: 'r', text: chartNum(perMillion(w)) }),
                h('td', { class: 'why ok', text: 'Needs Ignorance Is Bliss active; see the Bliss card' }),
            ]),
        );
    }
    // Company what-ifs: only the ones that beat your plan ("Hired at a 10★ Adult Novelties: +X% stats this month").
    for (const w of m.jobWhatIf || []) {
        const r = w.result;
        const d = best.gained > 0 ? (100 * (r.gained - best.gained)) / best.gained : 0;
        rows.push(
            h('tr', { class: 'whatif job' }, [
                h('td', {}, [h('small', { text: 'Job' })]),
                h('td', {}, [h('b', { class: 'w', text: w.title }), ' ', h('span', { class: 'tag', text: 'what-if' })]),
                h('td', { class: 'second', text: planWhat(w.strategy, r) }),
                h('td', { class: 'r', text: fmtPct(d) }),
                h('td', { class: 'r', text: (r.cost - best.cost >= 0 ? '+' : '−') + fmtMoney(Math.abs(r.cost - best.cost)) }),
                h('td', { class: 'r', text: r.cost > 0 ? chartNum(perMillion(r)) : '—' }),
                h('td', { class: 'why ok', title: w.note, text: w.title + ': ' + fmtPct(d) + ' stats this ' + (days === 30 ? 'month' : days + ' days') + '. ' + w.note }),
            ]),
        );
    }
    const tick = hiddenAlts.length
        ? h('button', { type: 'button', class: 'tk', 'aria-pressed': String(showAll), onclick: () => { ctx.ui.planShowAll = !showAll; ctx.rerender(); } }, [h('i'), 'Show plans that don’t fit you (' + hiddenAlts.length + ')'])
        : null;
    // Hidden: only plans that gain under half of the best plan inside your limit, or don't fit you; the cheapest plan always shows.
    const one = hiddenAlts.length === 1;
    const note = hiddenAlts.length && !showAll ? h('div', { class: 'note2', text: 'Hidden: ' + hiddenAlts.map((a) => STRATEGIES[a.id].name).join(', ') + ' — ' + (one ? 'it gains' : 'they gain') + ' under half of what the best plan in your limit does at ' + fmtShort(m.total) + ' total, or ' + (one ? 'doesn’t' : 'don’t') + ' fit you. ' + (one ? 'It comes' : 'They come') + ' back on ' + (one ? 'its' : 'their') + ' own if that changes.' }) : null;
    return h('div', {}, [
        sectionHead('Other plans', meta(['against ' + STRATEGIES[rec.recommended].short.toLowerCase() + ' · click a row to pick it']), tick),
        h('table', { class: 'tbl num' }, [
            h('thead', {}, [h('tr', {}, [h('th', { style: 'width:60px', text: 'Kind' }), h('th', { style: 'width:150px', text: 'Plan' }), h('th', { style: 'width:180px', text: 'What you do' }), h('th', { class: 'r', style: 'width:76px', title: 'Stats gained over the ' + days + ' days, and the difference from the recommended plan', text: 'Stats' }), h('th', { class: 'r', style: 'width:88px', title: 'What it costs over the ' + days + ' days, and the difference from the recommended plan', text: 'Cost' }), h('th', { class: 'r', style: 'width:68px', title: 'Stats gained for each $1M spent over the ' + days + ' days', text: 'Per $1M' }), h('th', { text: 'Why it isn’t the pick' })])]),
            h('tbody', {}, rows.length ? rows : [h('tr', {}, [h('td', { colspan: '7', class: 'muted', text: 'No other plan fits you.' })])]),
        ]),
        note,
    ]);
}

function ladderCard(m, ctx) {
    const l = m.ladder;
    if (!l) return null;
    const rows = l.rows.map((r) =>
        h('tr', {}, [
            h('td', {}, [h('b', { class: 'w', text: r.name })]),
            h('td', { class: 'muted', text: r.cooldown }),
            h('td', { class: 'r', text: r.energy }),
            h('td', { class: 'r ' + (r.costPerStat === 0 ? 'c-good' : ''), text: r.costPerStat === 0 ? 'free' : r.costPerStat === null ? '—' : '~$' + fmtInt(r.costPerStat) }),
            h('td', { class: 'r', text: r.perDay }),
            h('td', { class: r.inPlan ? 'c-good' : 'muted', text: r.inPlan ? 'yes' + (r.note ? ' · ' + r.note : '') : r.note || 'no' }),
        ]),
    );
    const stat = l.stat ? STAT_LABEL[l.stat] : 'your next stat';
    return h('div', {}, [
        sectionHead('Where your energy comes from', meta(['cheapest per stat first · the plan climbs this until your budget runs out (“Max gains”: no limit)']), null, 'h3'),
        h('table', { class: 'tbl num' }, [h('thead', {}, [h('tr', {}, [h('th', { text: 'Source' }), h('th', { text: 'Cooldown it uses' }), h('th', { class: 'r', text: 'Energy' }), h('th', { class: 'r', text: 'Cost per stat' }), h('th', { class: 'r', text: 'A day' }), h('th', { text: 'In your plan' })])]), h('tbody', {}, rows)]),
        h('div', { class: 'note2', text: 'Today’s prices; your ' + stat + (l.gym ? ' at ' + l.gym : '') + '. FHC and cans use the booster cooldown, so they add to your Xanax, never replace it. Faction energy-drink perks raise what cans give and are read from your perks.' }),
    ]);
}

function chartCard(m, ctx, rec, compare, days) {
    const showAll = Boolean(ctx.ui.planShowAll);
    const fit = new Set([rec.recommended, ...rec.alternatives.filter((a) => a.fits || showAll).map((a) => a.id)]);
    const series = [];
    for (const id of Object.keys(compare)) {
        if (!fit.has(id)) continue;
        const r = compare[id];
        const isRec = id === rec.recommended;
        series.push({ name: (STRATEGIES[id] || {}).short || id, color: isRec ? 'var(--chalk)' : r.gained < compare[rec.recommended].gained * 0.8 ? 'var(--warn)' : 'var(--dim)', width: isRec ? 2.5 : 1.5, values: [0, ...r.daily], rec: isRec });
    }
    for (const w of Object.values(m.whatIf || {})) series.push({ name: (STRATEGIES[w.id].short || w.id) + ' + Bliss', color: 'var(--dim)', dash: '4 3', width: 1.2, values: [0, ...w.daily] });
    series.sort((a, b) => (a.rec ? 1 : 0) - (b.rec ? 1 : 0));
    const max = Math.max(1, ...series.map((s) => Math.max(...s.values)));
    const top = Math.pow(10, Math.floor(Math.log10(max)));
    return h('div', {}, [
        sectionHead(days + ' days', meta(['stats gained, each plan']), null, 'h3'),
        lineChart(series, { w: 360, h: 190, left: 36, right: 96, xLabels: [[0, 'today'], [days, days + ' d']], grid: [Math.floor(max / top) * top], n: days + 1, label: 'Stats gained over ' + days + ' days, each plan' }),
        h('div', { class: 'legend2', style: 'margin-top:6px' }, [h('span', {}, [h('i', { style: 'background:var(--chalk)' }), 'recommended']), m.whatIf ? h('span', {}, [h('i', { class: 'dash', style: 'color:var(--dim)' }), 'with Bliss (what-if)']) : null]),
    ]);
}

function buildCard(m, ctx) {
    const plan = ctx.plan;
    const current = BUILD_ALIASES[plan.build] || String(plan.build || 'baldr');
    const curBase = current.split(':')[0];
    const high = highStatOf(current) || 'str';
    const buildFor = (id) => (highStatOf(id) ? resolveBuild(id + ':' + high) : BUILDS[id]);
    const buildIdFor = (id) => (highStatOf(id) ? id + ':' + high : id);
    const rows = BUILD_ORDER.map((id) => {
        const b = buildFor(id);
        const sel = curBase === id;
        return h('div', { class: 'r' + (sel ? ' sel' : ''), tabindex: '0', role: 'button', 'aria-pressed': String(sel), onclick: () => ctx.setPlan({ build: buildIdFor(id), buildPicked: true }), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ctx.setPlan({ build: buildIdFor(id), buildPicked: true }); } } }, [
            h('b', { text: BUILDS[id].name + (sel && plan.buildPicked ? ' ✓' : '') }),
            h('div', { class: 'ratio' }, STATS.map((k) => h('i', { style: 'width:' + (b.shares[k] * 100).toFixed(1) + '%;background:' + STAT_COLOR[k] }))),
            h('span', { text: b.line }),
        ]);
    });
    const cur = buildFor(curBase);
    const gyms = (cur.gyms || []).map((g) => (gymById(g) || { name: '' }).name).filter(Boolean);
    const georges = m.pc.unlocked.includes(GEORGES);
    // Where the next session trains, why it's one stat (when it is), and the next gym to unlock.
    const tin = trainInText(m);
    // With a goal (stat numbers, a gym) the shares aren't the build's: no "under Hank's" line then.
    const why = plan.goal ? null : whyOneStat(m) || whyMix(m);
    const focusBuild = (e) => {
        e.preventDefault();
        const sel = e.currentTarget.getRootNode().querySelector('select[aria-label="Build to train toward"]');
        if (sel) {
            sel.scrollIntoView({ block: 'center' });
            sel.focus();
        }
    };
    const ng = m.nextGym && m.nextGym.gym ? m.nextGym : null;
    const lines = [
        tin ? h('div', { class: 'note2' }, ['Train in ', h('b', { class: 'white', text: tin })]) : null,
        why ? h('div', { class: 'note2', title: why.title || null }, [why.text + ' · ', h('a', { href: '#plan', onclick: focusBuild, text: 'Change build' })]) : null,
        ng ? h('div', { class: 'note2' }, ['Next gym unlock: ', h('b', { class: 'white', text: ng.gym.name }), ng.known && ng.days !== null ? ' in about ' + Math.max(1, Math.round(ng.days)) + ' day' + (Math.max(1, Math.round(ng.days)) === 1 ? '' : 's') : ' · open Torn’s gym page once to track it', ng.cost ? ' · ' + fmtMoney(ng.cost) + ' to buy once it opens' : '']) : null,
    ].filter(Boolean);
    return h('div', {}, [
        sectionHead('Build', meta([plan.buildPicked ? 'what the plan trains toward' : 'pick yours: the plan trains toward it']), null, 'h3'),
        lines.length ? h('div', { style: 'margin-bottom:8px' }, lines) : null,
        h('div', { class: 'row', style: 'margin-bottom:8px;gap:8px' }, [t('lab', 'High stat'), h('div', { class: 'seg', role: 'group', 'aria-label': 'High stat' }, STATS.map((k) => h('button', { type: 'button', 'aria-pressed': String(k === high), onclick: () => ctx.setPlan({ build: (highStatOf(curBase) ? curBase : 'baldr') + ':' + k, buildPicked: true }), text: STAT_LABEL[k] })))]),
        h('div', { class: 'bl' }, rows),
        h('div', { class: 'note2', text: (gyms.length ? 'Specialist gyms: ' + gyms.join(' + ') + '. ' : '') + (georges ? '' : 'They open after George’s; until then every train still moves you toward this build.') }),
    ]);
}

function blissCard(m, ctx, rec, compare, days) {
    const bliss = m.pc.perks.bliss;
    const best = compare[rec.recommended];
    const happyMax = fmtInt(m.state.happy.maximum);
    const w = m.whatIf || {};
    const lines = [];
    if (bliss) lines.push(h('b', { text: 'Now' }), h('span', { text: 'Active' + (m.pc.perks.blissDays ? ' for ' + m.pc.perks.blissDays + ' days' : '') + ': happy keeps climbing above ' + happyMax + ', so the plans above already count it.' }));
    lines.push(h('b', { text: 'Changes' }), h('span', { text: 'Happy stops resetting to ' + happyMax + ' at :00/:15/:30/:45 and keeps climbing (to 99,999), so boosters and candy keep paying for 31 days.' }));
    if (!bliss && !w.blissSteady && m.savedPlan && m.savedPlan.extras === 'pending') lines.push(h('b', { text: 'For you' }), h('span', { class: 'muted', text: 'Working it out… (the what-ifs come a moment after the plan)' }));
    if (!bliss && w.blissSteady) {
        const pct = (x) => Math.round((100 * (x.gained - best.gained)) / Math.max(1, best.gained));
        lines.push(h('b', { text: 'For you' }), h('span', { text: 'Steady with Bliss +' + fmtShort(w.blissSteady.gained) + ' in ' + days + ' days (' + fmtPct(pct(w.blissSteady)) + ') for ' + fmtMoney(w.blissSteady.cost) + (w.dailyChoco ? '; Daily choco with Bliss +' + fmtShort(w.dailyChoco.gained) + ' (' + fmtPct(pct(w.dailyChoco)) + ') for ' + fmtMoney(w.dailyChoco.cost) : '') + '.' }));
        const budget = m.auto && m.auto.ready && ctx.plan.pickBy === 'auto' ? m.auto.budget : budgetOf(ctx.settings);
        const cheapest = [w.blissSteady, w.dailyChoco].filter((x) => x && x.gained > best.gained).sort((a, b) => a.cost - b.cost)[0];
        lines.push(h('b', { text: 'Worth it?' }), h('span', {}, [cheapest ? (cheapest.cost <= budget ? 'Yes inside your budget: ' + STRATEGIES[cheapest.id].short.toLowerCase() + ' with the book beats today’s pick. ' : 'Only with a budget of ~' + fmtMoney(cheapest.cost) + '. ') : 'Not at your stats. ', h('a', { href: '#buy', onclick: (e) => { e.preventDefault(); ctx.go('buy'); }, text: 'Price on Buy' })]));
    }
    return h('div', {}, [sectionHead('Ignorance Is Bliss', meta([bliss ? 'active' : 'not active']), null, 'h3'), h('div', { class: 'bliss num' }, lines)]);
}

/** The lengths Create plan offers (owner: 1 / 3 / 6 / 12 months). */
const PLAN_LENGTHS = [1, 3, 6, 12];
const monthsWord = (n) => n + (n === 1 ? ' month' : ' months');
const dayWord = (t) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function lengthChoice(ctx, fallback = 3) {
    const cur = PLAN_LENGTHS.includes(ctx.ui.planMonths) ? ctx.ui.planMonths : fallback;
    return h(
        'div',
        { class: 'seg', role: 'group', 'aria-label': 'Plan length' },
        PLAN_LENGTHS.map((n) => h('button', { type: 'button', 'aria-pressed': String(n === cur), onclick: () => { ctx.ui.planMonths = n; ctx.ui.replaceAsk = false; ctx.rerender(); }, text: monthsWord(n) })),
    );
}

/**
 * A plan being worked out (round 7, R7.3b): a bar that fills, where the run is, the seconds so far, and Cancel. The
 * page stays usable meanwhile (other tabs too), and you can leave it: it finishes in a tab you are not looking at.
 * The bar is the card's own day line (its width only). app.js planProgress moves it without redrawing the page.
 */
function planRun(busy, ctx) {
    if (!busy) return null;
    return h('div', { class: 'planrun', role: 'status', 'aria-live': 'polite' }, [
        h('div', { class: 'dayline', role: 'progressbar', 'aria-label': busy.recalibrate ? 'Re-planning' : 'Working out your plan' }, [h('i', { 'data-plan-bar': '1', style: 'width:' + Math.round(100 * Math.max(0.02, busy.done || 0)) + '%' })]),
        h('div', { class: 'row', style: 'justify-content:space-between;margin-top:6px' }, [
            h('span', { class: 'pc-sub num', 'data-plan-words': '1', text: planRunWords(busy) }),
            h('span', { class: 'row', style: 'gap:10px' }, [h('span', { class: 'muted', style: 'font-size:13px', text: 'You can keep using the page, or leave it: your plan stays as it is until this is done.' }), h('button', { class: 'btn sm ghost', type: 'button', onclick: () => ctx.cancelPlan && ctx.cancelPlan(), text: 'Cancel' })]),
        ]),
    ]);
}

/** A Create plan / Recalibrate click: the page shows it working, then the new plan (or why it couldn't). */
function startPlan(ctx, months) {
    ctx.ui.newPlan = false;
    ctx.ui.replaceAsk = false;
    return ctx.createPlan(months);
}

/**
 * Your plan (round 6, the owner's pick: mockup A's card with C's months).
 * Nothing re-plans by itself: Create plan (1, 3, 6 or 12 months, from
 * scratch) and Recalibrate (any time: the days left from today, same end)
 * are the only things that work a plan out.
 */
function planCard(m, ctx) {
    const sv = m.saved;
    const busy = m.planBusy;
    const err = ctx.ui.planError ? h('p', { class: 'c-bad', style: 'margin:8px 0 0', text: ctx.ui.planError }) : null;
    const months = PLAN_LENGTHS.includes(ctx.ui.planMonths) ? ctx.ui.planMonths : sv ? sv.months : 3;
    if (!sv) {
        return h('div', { class: 'lead plancard' }, [
            sectionHead('No plan yet', meta(['worked out once from your stats, income, prices and gyms now, then saved · takes a few seconds'])),
            h('div', { class: 'row', style: 'gap:10px;flex-wrap:wrap;margin-top:6px' }, [
                lengthChoice(ctx, 3),
                h('button', { class: 'btn primary', type: 'button', disabled: Boolean(busy), onclick: () => startPlan(ctx, months), text: busy ? 'Working out your plan…' : 'Create plan' }),
            ]),
            planRun(busy, ctx),
            err,
        ]);
    }
    const S = STRATEGIES[m.strategy] || STRATEGIES.steady;
    const p = sv.progress || { day: 1, of: sv.days, ended: false };
    const last = m.savedPlan && m.savedPlan.history && m.savedPlan.history.length ? m.savedPlan.history[m.savedPlan.history.length - 1] : null;
    const incomeMove = last && last.from.budgetPerDay !== null && last.to.budgetPerDay !== null && Math.round(last.from.budgetPerDay) !== Math.round(last.to.budgetPerDay) ? ' on ' + fmtMoney(Math.round(last.to.budgetPerDay)) + ' a day (was ' + fmtMoney(Math.round(last.from.budgetPerDay)) + ')' : '';
    const sub = [dayWord(sv.start) + ' → ' + dayWord(sv.end), p.ended ? 'ended' : 'day ' + p.day + ' of ' + p.of, 'made ' + dayWord(sv.createdAt), sv.recalibratedAt ? 're-planned ' + dayWord(sv.recalibratedAt) + incomeMove : null, ctx.plan.strategyPicked ? 'following ' + S.short.toLowerCase() + ', your pick' : null].filter(Boolean).join(' · ');
    // The line above is time (day N of M). Beside it: what you gained against what the plan said by now, since the
    // line you follow began (round 7: the card's line never said whether you were on the plan).
    const pr = progressOf(ctx.planLines || [], m.now, m.total);
    const soFar = pr && !p.ended ? h('div', { class: 'pc-sub num' }, ['The line is time: day ' + p.day + ' of ' + p.of + '. Stats: ', h('b', { class: 'white', text: fmtSigned(pr.gained) }), ' of ' + fmtSigned(pr.planned) + ' planned so far' + (pr.pct !== null ? ' (' + Math.round(pr.pct) + '%)' : '') + ', +' + fmtShort(pr.whole) + ' by the end · ', h('a', { href: '#progress', onclick: (e) => { e.preventDefault(); ctx.go('progress'); }, text: 'Progress' })]) : null;
    // A build picked after the plan was made: today's steps follow it at once, the plan's numbers don't until a Re-plan.
    const madeFor = m.savedPlan && m.savedPlan.snapshot ? m.savedPlan.snapshot.build : null;
    const buildMoved = madeFor && ctx.plan.build && madeFor !== ctx.plan.build ? h('div', { class: 'pc-sub' }, [h('span', { class: 'tag warn', text: 'Build changed' }), ' Today’s steps already train toward ' + resolveBuild(ctx.plan.build).name + '; this plan’s numbers are for ' + resolveBuild(madeFor).name + '. ', h('b', { class: 'white', text: 'Re-plan to use it.' })]) : null;
    const kids = [
        h('div', { class: 'pc-top' }, [
            h('div', { class: 'pc-what' }, [
                h('div', { class: 'pc-title', text: monthsWord(sv.months).replace(' months', '-month').replace(' month', '-month') + ' plan · ' + S.name }),
                h('div', { class: 'pc-sub num', text: sub }),
                h('div', { class: 'dayline', role: 'img', 'aria-label': 'Day ' + p.day + ' of ' + p.of }, [h('i', { style: 'width:' + Math.min(100, (100 * p.day) / Math.max(1, p.of)).toFixed(1) + '%' })]),
                soFar,
                buildMoved,
            ]),
            h('div', { class: 'acts' }, [
                h('button', { class: 'btn primary', type: 'button', disabled: Boolean(busy) || p.ended, title: 'Re-reads your stats, income, prices and gyms now and re-plans the days left; the end date stays', onclick: () => { ctx.ui.newPlan = false; ctx.ui.replaceAsk = false; ctx.recalibratePlan(); }, text: busy && busy.recalibrate ? 'Re-planning…' : 'Re-plan' }),
                h('button', { class: 'btn ghost', type: 'button', disabled: Boolean(busy), 'aria-expanded': String(Boolean(ctx.ui.newPlan)), onclick: () => { ctx.ui.newPlan = !ctx.ui.newPlan; ctx.ui.replaceAsk = false; ctx.rerender(); }, text: busy && !busy.recalibrate ? 'Working out…' : 'New plan…' }),
            ]),
        ]),
    ];
    if (ctx.ui.newPlan || p.ended) {
        kids.push(
            h('div', { class: 'newrow' }, [
                t('lab', 'New plan for'),
                lengthChoice(ctx, sv.months),
                ctx.ui.replaceAsk
                    ? h('span', { class: 'confirm' }, [
                          h('b', { text: 'Replace your ' + monthsWord(sv.months).replace(' months', '-month').replace(' month', '-month') + ' plan?' }),
                          h('span', { class: 'muted', text: ' A new ' + monthsWord(months) + ' plan starts today; the old one stays in its history. ' }),
                          h('button', { class: 'btn sm primary', type: 'button', onclick: () => startPlan(ctx, months), text: 'Replace it' }),
                          h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { ctx.ui.replaceAsk = false; ctx.ui.newPlan = false; ctx.rerender(); }, text: 'Keep mine' }),
                      ])
                    : h('button', { class: 'btn sm primary', type: 'button', disabled: Boolean(busy), onclick: () => { ctx.ui.replaceAsk = true; ctx.rerender(); }, text: 'Create plan' }),
                ctx.ui.replaceAsk ? null : h('span', { class: 'muted', text: 'replaces this plan (kept in its history)' }),
            ]),
        );
    }
    const running = planRun(busy, ctx);
    if (running) kids.push(running);
    if (err) kids.push(err);
    return h('div', { class: 'lead plancard' }, kids);
}

/** The plan's months (mockup C): total stats planned at each month's end, "you are here", the rough ones marked "~". */
function monthsRow(m, ctx) {
    const sp = m.savedPlan;
    if (!sp || !Array.isArray(sp.monthly)) return null;
    // The plan you follow: the saved path's months, or (a plan you picked yourself) that plan's, counted in the plan's
    // own months (round 7: the row showed the path whatever you followed).
    const picked = ctx.plan.strategyPicked && sp.compare && sp.compare[m.strategy] ? sp.compare[m.strategy] : null;
    const monthly = picked ? monthlyOf(picked, { start: sp.from, days: sp.days, stats: sp.snapshot.stats, anchor: sp.start }) : sp.monthly;
    if (monthly.length < 2) return null;
    const now = m.now;
    const total = (st) => Object.values(st || {}).reduce((a, v) => a + (Number(v) || 0), 0);
    const cells = monthly.map((mo, i) => {
        const past = mo.to <= now;
        const cur = now >= mo.from && now < mo.to;
        const rough = i >= 3;
        const name = new Date(mo.to - 1).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
        return h('div', { class: 'mo' + (past ? ' past' : '') + (cur ? ' now' : ''), title: dayWord(mo.from) + ' → ' + dayWord(mo.to) + ': +' + fmtShort(mo.gained) + ' for ' + fmtMoney(mo.cost) }, [h('span', { text: name }), h('b', { text: (rough ? '~' : '') + fmtShort(total(mo.stats)) }), cur ? h('em', { text: 'you are here' }) : null]);
    });
    const costs = monthly.map((x) => x.cost).filter((x) => x > 0);
    const y = sp.year;
    const foot = [
        costs.length ? 'About ' + fmtMoney(Math.min(...costs)) + (Math.max(...costs) > Math.min(...costs) * 1.05 ? '–' + fmtMoney(Math.max(...costs)) : '') + ' a month' : null,
        picked ? 'whole plan ~+' + fmtShort(picked.gained) + ' on ' + ((STRATEGIES[m.strategy] || {}).short || m.strategy).toLowerCase() + ', your pick' : y && y.band && y.path ? 'whole plan ~+' + fmtShort(y.path.gained) + ' (range +' + fmtShort(y.band.low) + ' to +' + fmtShort(y.band.high) + ': the model’s own error; later months are rougher)' : null,
        y && y.unlocks && y.unlocks.length ? 'gyms: ' + y.unlocks.slice(0, 3).map((u) => ((gymById(u.gymId) || {}).name || 'gym ' + u.gymId) + ' ~day ' + u.day).join(', ') : null,
    ].filter(Boolean);
    return h('div', {}, [
        sectionHead('Your ' + monthly.length + ' months', meta(['total stats planned at each month’s end'])),
        h('div', { class: 'months num', style: 'grid-template-columns:repeat(' + Math.min(12, monthly.length) + ',minmax(0,1fr))' }, cells),
        foot.length ? h('div', { class: 'note2 num', text: foot.join(' · ') }) : null,
    ]);
}

export function renderPlan(m, ctx) {
    const compare = ctx.compare || {};
    const rec = m.recommendation;
    const days = m.planDays || ctx.settings.horizonDays || 30;
    // Every candy a plan might pick is priced (a few listings, every 30 min), so the candy choice follows prices.
    if (ctx.wantPrices) ctx.wantPrices([], CANDY_IDS);
    if (!rec || !rec.recommended || !compare[rec.recommended] || (m.saved && !m.saved.whole)) {
        // Round 6: plans are made on a click (Create plan / Recalibrate) and saved; nothing is worked out by itself.
        const loading = m.saved && !m.saved.whole && !m.planBusy ? h('p', { class: 'muted', style: 'margin:0', text: 'Loading your saved plan…' }) : null;
        return { ctl: controls(m, ctx), main: [planCard(m, ctx), loading].filter(Boolean), pane: [] };
    }
    return {
        ctl: controls(m, ctx),
        main: [planCard(m, ctx), monthsRow(m, ctx), recommendedCard(m, ctx, rec, compare, days), otherPlans(m, ctx, rec, compare, days), ladderCard(m, ctx)].filter(Boolean),
        pane: [chartCard(m, ctx, rec, compare, days), buildCard(m, ctx), blissCard(m, ctx, rec, compare, days)],
    };
}

void SPECIAL;
