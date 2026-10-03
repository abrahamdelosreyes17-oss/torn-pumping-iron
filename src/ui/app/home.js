/*
 * Home (mockups/round3/S-home.html): one question, "what do I do today?".
 * Today's steps as one rail with the step of the moment on it (the page's
 * primary card; round 8, mockups/round8/steps-panel.html pick B), you against
 * the build, the next 7 days; Buy today, Heads-up, the plan in one line and
 * this week in the pane.
 */

import { h, t, tickMark } from '../dom.js';
import { STATS, STAT_LABEL, HAPPY_CAP } from '../../core/gain.js';
import { fmtInt, fmtSigned, fmtMoney, fmtShort } from '../../core/format.js';
import { POINTS, XANAX, ECSTASY, REFILL_POINTS, ITEMS } from '../../core/items.js';
import { STRATEGIES } from '../../core/strategies.js';
import { fillCheapest, whereText, priceVerdict, unitPrice, npcListing } from '../../core/market.js';
import { itemContext } from '../../core/model.js';
import { tornDayStart, DAY } from '../../core/bars.js';
import { itemsUrl, gymUrl, pointsUrl, itemMarketUrl, pointsMarketUrl } from '../../sources/route.js';
import { stackBars } from '../charts.js';
import { clock, cd, sectionHead, meta, trainsText, headsList, gainsCard, planRunWords, STAT_COLOR, DAY_NAMES, MONTH_NAMES } from './common.js';
import { partsText, trainInText, whyMix, whyOneStat, isBoostStep, boostProgress, OVERDOSE_WORDS, awayWords, REHAB_COST, TRAVEL_URL, DUE_SLACK_MS } from '../../core/gympage.js';
import { spentOverDays } from '../../core/receipts.js';
import { hm } from '../../core/drugcd.js';
import { lineAt, plannedBetween, planStatAt } from '../../core/planline.js';
import { dayGainPlan } from './progress.js';

const DAYS = DAY_NAMES;
const MONTHS = MONTH_NAMES;

function dateLine(now) {
    const d = new Date(now);
    return DAYS[d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()];
}

/** The step in words: "Take Xanax #2, then train DEX × 27". */
export function stepWords(s) {
    const tr = trainsText(s.trains);
    const then = tr ? ', then train ' + tr : '';
    switch (s.kind) {
        case 'xanax':
            return 'Take ' + s.label + then;
        case 'refill':
            return 'Use your refill' + then;
        case 'special':
            return 'Use ' + s.label.toLowerCase() + then;
        case 'booster':
            return 'Use ' + s.label.replace(', train after each', '') + then;
        case 'natural':
            return tr ? 'Train ' + tr : 'Natural energy';
        case 'stack':
        case 'hold':
            return 'Take ' + s.label;
        case 'jump':
        case 'boost':
            return s.label.replace('train it all', 'train ' + (tr || 'it all'));
        default:
            return s.label + then;
    }
}

/**
 * Where a step's trains go, what they gain and the energy: "Gun Shop · about +1,391 · 270 energy" (one gym: its
 * name; more: "George's: STR × 12 → Frontline Fitness: DEX × 8").
 */
function trainDetail(s, about = true) {
    const out = [];
    const parts = s.parts || [];
    const gyms = [...new Set(parts.length ? parts.map((p) => p.gymName) : Object.values(s.gyms || {}).filter(Boolean))];
    if (gyms.length > 1 && parts.length) out.push(partsText(parts));
    else if (gyms.length) out.push(gyms.join(' / '));
    if (s.gain) out.push((about ? 'about ' : '') + fmtSigned(s.gain));
    if (s.energy) out.push(fmtInt(s.energy) + ' energy');
    return out.join(' · ');
}

/**
 * A step as its actions in order (round 8, the owner's pick B in mockups/round8/steps-panel.html): "Take Xanax #2,
 * then train DEX × 27" is 1 Take Xanax #2, 2 Train DEX × 27; a jump or boost is its own list, ticked from the bars
 * (gympage.js boostProgress). `now` is the action of the moment: the first one not done (none once all are).
 * @param {object} step - plan.js step
 * @param {object} [o] - reads: {happy:{current,max}, boosterLeft, drugLeft, happyTrained, trained} (a boost's progress);
 *   steps: the day's steps (the refill that follows a boost gives its line's gain)
 * @returns {{id, text, detail, done, now, page: 'items'|'points'|'gym'|null}[]} page: the Torn page it is done on
 */
export function subSteps(step, { reads = null, steps = [] } = {}) {
    if (!step) return [];
    const out = [];
    const join = (...x) => x.filter(Boolean).join(' · ');
    if (isBoostStep(step)) {
        const b = boostProgress(step, reads || {});
        const happy = reads && reads.happy && Number.isFinite(reads.happy.current) ? reads.happy.current : null;
        // The plan's own words for an action still to do ("Eat EDVD × 5", "Take the Ecstasy"); done, it is its name.
        const said = (id) => ((step.actions || []).find((a) => a.id === id) || {}).text || null;
        const refill = (steps || []).find((x) => x !== step && x.kind === 'refill') || null;
        for (const a of b.list) {
            if (a.id === 'eat') out.push({ id: a.id, text: a.done ? a.text : said('eat') || a.text, detail: a.done && !b.drugIn && happy !== null ? 'happy ' + fmtInt(happy) : '', done: a.done, page: 'items' });
            else if (a.id === 'drug') {
                const doubled = b.eaten && happy !== null ? ': ' + fmtInt(happy) + ' → ' + fmtInt(Math.min(HAPPY_CAP, happy * ITEMS[ECSTASY].happyMult)) : '';
                const todo = /Ecstasy/.test(a.text) ? 'doubles your happy' + doubled : '+' + ITEMS[XANAX].energy + ' energy';
                out.push({ id: a.id, text: a.done ? a.text : said('drug') || a.text, detail: a.done ? (happy !== null ? 'happy ' + fmtInt(happy) : '') : todo, done: a.done, page: 'items' });
            } else if (a.id === 'train') out.push({ id: a.id, text: a.text, detail: trainDetail(step), done: a.done, page: 'gym' });
            // The refill is a step of its own on the day's line (its Points button comes with its turn): no page here.
            else if (a.id === 'refill') out.push({ id: a.id, text: a.text, detail: refill && refill.gain ? 'about ' + fmtSigned(refill.gain) : '', done: a.done, page: null });
            else out.push({ id: a.id, text: a.text, detail: '', done: a.done, page: null });
        }
    } else {
        const trains = trainsText(step.trains);
        const items = (step.items || []).filter((it) => it.qty > 0);
        const points = items.find((it) => it.id === POINTS) || null;
        const page = step.kind === 'refill' ? 'points' : items.some((it) => it.id !== POINTS && ITEMS[it.id]) ? 'items' : null;
        if (step.kind === 'stack' || step.kind === 'hold') {
            // "Xanax #1 of 4 · don't train": the Xanax is the action, the rest is said under it.
            const [what, ...rest] = String(step.label).split(' · ');
            out.push({ id: 'use', text: 'Take ' + what, detail: join(rest.join(' · '), step.note), done: false, page });
        } else if (step.kind === 'natural' || !trains) {
            out.push({ id: trains ? 'train' : 'use', text: stepWords(step), detail: join(trains ? trainDetail(step) : '', step.note), done: false, page: trains ? 'gym' : page });
        } else {
            const adds = step.kind === 'xanax' ? '+' + ITEMS[XANAX].energy + ' energy' : points ? fmtInt(points.qty) + ' points' : '';
            out.push({ id: 'use', text: stepWords({ ...step, trains: {} }), detail: adds, done: false, page });
            out.push({ id: 'train', text: 'Train ' + trains, detail: join(trainDetail(step), step.note), done: false, page: 'gym' });
        }
    }
    const now = out.findIndex((x) => !x.done);
    out.forEach((x, i) => (x.now = i === now));
    return out;
}

/** "Take Xanax #2" → "take Xanax #2" after "then" or "Next at 17:00:"; an item's name ("EDVD × 5 + …") stays as it is. */
function lowerAction(words) {
    return /^(Take|Use|Train|Eat|Refill|Natural)\b/.test(words) ? words.charAt(0).toLowerCase() + words.slice(1) : words;
}

/**
 * The panel's words for the plan's next step on Torn's pages (round 8, the owner's pick B). Due now (a jump or boost:
 * within the minute): the action of the moment in the bar and in big type, what follows it on one line, the step's
 * actions as a list, and the plate's ring. Still ahead: "Nothing due now" ("Session done" right after a train) and
 * "Next at 17:00: …" with the countdown; nothing rings.
 * @param {object} next - the step
 * @param {object} o - now; boost: gympage.js boostProgress() of a jump or boost due now, else null; sessionOver: the
 *   train before it was just done; reads and steps: as for subSteps
 * @returns {{acting, pillText, pillNow?, cdAt?, tone, ring, label, cardStep, cardSub, checklist?}}
 */
export function panelStep(next, { now, boost = null, sessionOver = false, reads = null, steps = [] } = {}) {
    const acting = next.at <= now || Boolean(boost);
    const gain = next.gain ? 'about +' + fmtInt(next.gain) + (next.energy ? ' · ' + fmtInt(next.energy) + ' energy' : '') : '';
    if (!acting) {
        const at = clock(next.at);
        return { acting, pillText: 'Nothing due', cdAt: next.at, tone: null, ring: false, label: 'Next at ' + at, cardStep: sessionOver ? 'Session done' : 'Nothing due now', cardSub: 'Next at ' + at + ': ' + [lowerAction(stepWords(next)), gain].filter(Boolean).join(' · ') };
    }
    const subs = subSteps(next, { reads, steps });
    const cur = subs.find((x) => x.now) || null;
    const after = cur ? subs[subs.indexOf(cur) + 1] || null : null;
    const out = {
        acting,
        pillText: cur ? cur.text : next.label.split(' · ')[0],
        // A chalk edge only when it's time to act.
        tone: 'chalk',
        ring: Boolean(cur),
        label: 'Now',
        cardStep: cur ? cur.text : stepWords(next),
        cardSub: [after ? 'then ' + lowerAction(after.text.split(':')[0]) : '', gain].filter(Boolean).join(' · ') || null,
    };
    // A jump or boost counts down to the tick that resets the happy; any other step due says "Now".
    if (boost && boost.deadline > now) out.cdAt = boost.deadline;
    else out.pillNow = 'Now';
    if (subs.length > 1) out.checklist = subs.map((x) => ({ text: x.text, done: x.done, next: x.now }));
    if (boost) {
        out.tone = boost.ready ? 'green' : 'red';
        out.label = (boost.jump ? 'Jump' : 'Boost') + (boost.ready ? ' · now' : boost.deadline ? ' · finish before ' + clock(boost.deadline) : '');
    }
    return out;
}

/** The step's Torn pages, the action of the moment first (it is the primary button): Items, Points, the gym. */
function stepButtons(subs) {
    const to = { points: ['Points', pointsUrl], items: ['Items', itemsUrl], gym: ['Open the gym', gymUrl] };
    const pages = [];
    for (const x of subs) if (!x.done && x.page && !pages.includes(x.page)) pages.push(x.page);
    return pages.map((p, i) => h('a', { class: 'btn' + (i === 0 ? ' primary' : ''), href: to[p][1](), target: '_blank', rel: 'noopener', text: to[p][0] }));
}

/*
 * Today as one rail (round 8, the owner's pick B): the day is one line from done to later, the step of the moment a
 * box on it, its actions hanging under it on the same line. The plate with the ring (his pick 1D) marks the one
 * action to do now: one ring on the page, never two; a countdown never rings, and nothing rings when there is
 * nothing you can do.
 */

/** The app's plate; `ring`: the one ring that leaves it. */
const plateMark = (ring = false) => h('span', { class: 'pl' + (ring ? ' ring' : ''), 'aria-hidden': 'true' });
/** A point on the rail: hollow (later), `on` (the step of the moment), `open` (nothing to do now). */
const railDot = (cls = '') => h('span', { class: 'dot' + (cls ? ' ' + cls : '') });

/** One row of the rail: its point on the line, its time, what it is, and what stands on the right. */
function railRow(cls, node, when, body, right = null) {
    return h('li', { class: cls || null }, [h('span', { class: 'node' }, [node]), h('span', { class: 't num' }, [].concat(when)), body, right]);
}

/** The step of the moment's actions, under each other: done ones ticked, the one to do now large with the ring. */
function subList(subs) {
    const n = subs.length;
    return h(
        'ol',
        { class: 'subr' },
        subs.map((x, i) => {
            const under = x.now ? [n > 1 ? 'Step ' + (i + 1) + ' of ' + n : '', x.detail].filter(Boolean).join(' · ') : x.detail ? ' · ' + x.detail : '';
            return h('li', { class: x.done ? 'done' : x.now ? 'now' : null }, [h('span', { class: 'node' }, [x.done ? tickMark() : x.now ? plateMark(true) : railDot()]), h('div', {}, [h('b', { class: 'a', text: x.text }), under ? h('span', { class: 's', text: under }) : null])]);
        }),
    );
}

/** A state that takes the whole day (stacking, overdosed, flying) as the rail's one point, its box beside it. */
function railBox(node, when, box) {
    return h('ol', { class: 'rail' }, [railRow('now', node, when, h('div', { class: 'nb solo' }, [box]))]);
}

/**
 * When the Torn day (00:00 TCT) resets in your own time (owner, 2026-09-29: "does this reset per day? at 00:00
 * torn time?"): "Torn day resets at 08:00 your time". Xanax "today" counts from that reset.
 */
export function dayResetWords(m) {
    const d = new Date(m.dayResetAt || tornDayStart(m.now) + DAY);
    return 'Torn day resets at ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' your time';
}

/** "Xanax cooldown ~6h 52m (your last 5: 6h 10m–7h 40m)", or Torn's 6–8 h until three are recorded. */
export function xanaxCdWords(x) {
    if (!x || !x.own) return 'Xanax cooldown 6–8 h (planned at 7 h until 3 of yours are seen)';
    return 'Xanax cooldown ~' + hm(x.min) + ' (your last ' + x.n + (x.lo !== x.hi ? ': ' + hm(x.lo) + '–' + hm(x.hi) : '') + ')';
}

/** Cheapest fill for one need, from stored listings; `left`: today's city-shop allowance still free. */
export function buyRow(need, prices, ic = null, left = null) {
    const p = (prices && prices[need.id]) || {};
    // A city shop you may buy from (Sally's by default) joins the listings up to today's allowance, as on the Buy tab.
    const shop = ic && ic.npc && ic.npc[need.id] ? npcListing(ic.npc[need.id], need.buy, left !== null ? left : ic.cityLeft) : null;
    const listings = (Array.isArray(p.listings) ? p.listings : []).concat(shop ? [shop] : []);
    if (!listings.length) return { need, fill: null, verdict: null };
    const fill = fillCheapest(listings, need.buy, need.id);
    const cheapest = fill.rows[0] ? fill.rows[0].price : null;
    return { need, fill, verdict: priceVerdict(cheapest, p.avg7 || null) };
}

/** buyRow for a list, the city-shop allowance shared between them. */
export function buyRows(needs, prices, ic) {
    let left = ic ? ic.cityLeft : null;
    return needs.map((n) => {
        const r = buyRow(n, prices, ic, left);
        if (r.fill && left !== null) left = Math.max(0, left - r.fill.rows.filter((x) => x.source === 'npc').reduce((a, x) => a + x.qty, 0));
        return r;
    });
}

function buyCard(m, ctx) {
    const needs = m.buyToday.filter((n) => n.buy > 0);
    // Home refreshes today's prices too, at most every 5 minutes.
    if (needs.length && ctx.wantPrices) ctx.wantPrices(needs.map((n) => n.id));
    const ic = itemContext(ctx.statics || {}, ctx.settings || {}, m.now);
    const rows = buyRows(needs, ctx.prices, ic);
    const total = rows.reduce((a, r) => a + (r.fill ? r.fill.total : 0), 0);
    const trs = rows.map(({ need, fill }) => {
        const first = fill && fill.rows[0];
        const link = first ? first.link : need.id === POINTS ? pointsMarketUrl() : itemMarketUrl(need.id);
        const where = first ? whereText(first) + (fill.rows.length > 1 ? ' + ' + (fill.rows.length - 1) + ' more' : '') : ctx.paused ? 'prices wait while paused' : 'checking prices…';
        const why = need.id === POINTS ? 'for the refill' : 'have ' + need.have + ', need ' + need.need + (need.fromPool ? ' · your ' + need.fromPool.map((x) => x.qty + ' ' + x.name).join(' + ') + ' cover the rest' : '');
        return h('tr', {}, [
            h('td', {}, [h('b', { class: 'w', text: need.name + ' × ' + fmtInt(need.buy) }), h('br'), h('small', { class: 'muted', text: where + ' · ' + why })]),
            h('td', { class: 'r', text: fill ? fmtMoney(fill.total) : '' }),
            h('td', { class: 'r', style: 'width:64px' }, [h('a', { class: 'btn sm', href: link, target: '_blank', rel: 'noopener', text: 'Open' })]),
        ]);
    });
    if (!trs.length) trs.push(h('tr', {}, [h('td', { colspan: '3' }, [h('b', { class: 'w', text: 'Nothing to buy today' }), h('br'), h('small', { class: 'muted', text: 'What you hold covers today’s steps' })])]));
    return h('div', {}, [
        sectionHead('Buy today', h('span', { class: 'meta right num', text: total ? fmtMoney(total) : '' }), null, 'h3'),
        h('table', { class: 'tbl num' }, [h('tbody', {}, trs)]),
        h('div', { class: 'note2' }, [h('a', { href: '#buy', onclick: (e) => { e.preventDefault(); ctx.go('buy'); }, text: 'Deals and the rest of the week → Buy' })]),
    ]);
}

/**
 * The next 48 hours past today's steps (owner, 2026-09-29: "plan everything ahead for me, when not to take
 * xanax, when to take candy, when not to take boosters"): drugs, boosts, jumps and refills; natural energy left out.
 */
export function nextDays(m, settings) {
    const rows = (m.later || []).filter((st) => st.kind !== 'natural').slice(0, 12);
    if (!rows.length) return null;
    const day = (at) => {
        const d = Math.round((tornDayStart(at) - tornDayStart(m.now)) / DAY);
        return d === 1 ? 'Tomorrow' : DAYS[new Date(at).getUTCDay()];
    };
    return h('div', {}, [
        sectionHead('Next 48 h', meta(['the plan runs on past midnight · Torn time']), null, 'h3'),
        h('table', { class: 'tbl num' }, [
            h(
                'tbody',
                {},
                rows.map((st) => {
                    const k = Object.keys(st.trains || {});
                    return h('tr', {}, [
                        h('td', { class: 't', style: 'width:130px;white-space:nowrap', text: day(st.at) + ' ' + clock(st.at, settings) }),
                        h('td', {}, [h('b', { class: 'w', text: st.label }), st.note ? h('br') : null, st.note ? h('small', { class: 'muted', text: st.note }) : null]),
                        h('td', { style: 'width:190px' }, [h('span', { class: k.length === 1 ? 's-' + k[0] : null, text: trainsText(st.trains) || '—' })]),
                        h('td', { class: 'r', style: 'width:110px', text: st.gain ? fmtSigned(st.gain) : '' }),
                    ]);
                }),
            ),
        ]),
    ]);
}

/** Share bar against the target, "24.9% → 27.8%", what's left, and today's trains (none while stacking for a chain). */
function youVsBuild(m, ctx = null) {
    const tot = {};
    for (const st of m.stacking || m.overdose || m.away ? [] : m.steps) for (const [k, n] of Object.entries(st.trains || {})) tot[k] = (tot[k] || 0) + n;
    const only = Object.keys(tot).length === 1 ? Object.keys(tot)[0] : null;
    const rows = m.statRows.map((r) => {
        const k = r.stat;
        const trains = tot[k] || 0;
        const toGo = r.over ? 'over' : r.gap > 0 ? '+' + fmtShort(r.gap) + ' to go' : 'on target';
        const tod = trains ? h('span', { class: 'tod s-' + k, text: trains + ' train' + (trains === 1 ? '' : 's') }) : h('span', { class: 'tod muted', text: r.over ? 'skip' : 'later' });
        return h('div', { class: 'sgr' }, [
            h('b', { class: 'n s-' + k, text: STAT_LABEL[k] }),
            h('span', { class: 'v', text: fmtInt(r.value) }),
            h('div', { class: 'share' }, [h('i', { style: 'width:' + Math.min(100, r.share * 100).toFixed(1) + '%;background:' + STAT_COLOR[k] }), h('em', { style: 'left:' + Math.min(100, r.target * 100).toFixed(1) + '%' })]),
            h('span', { class: 'gap', text: (r.share * 100).toFixed(1) + '% → ' + (r.target * 100).toFixed(1) + '%' }),
            h('span', { class: 'gap', text: toGo }),
            tod,
        ]);
    });
    const metaParts = [fmtInt(m.total) + ' total'];
    return h('div', {}, [
        sectionHead('You vs ' + m.build.name, meta([...metaParts, only ? ' · today every train goes to ' : '', only ? h('b', { style: 'color:var(--' + only + ')', text: STAT_LABEL[only] }) : ''])),
        h('div', { class: 'sg num' }, rows),
        buildFoot(m, ctx),
    ]);
}

function buildFoot(m, ctx = null) {
    const foot = [];
    // Overdosed, stacking, flying: nothing is trained now, so no gym to train in.
    const tin = m.overdose || m.stacking || m.away ? null : trainInText(m);
    if (tin) foot.push(h('span', {}, ['Train in ', h('b', { text: tin })]));
    // Why this session mixes stats (or trains one): "STR + DEX this session: +8.4% toward Hank's vs STR only".
    const why = ctx && ctx.plan && ctx.plan.goal ? null : whyMix(m) || whyOneStat(m);
    if (why) foot.push(h('span', { title: why.title || null, text: why.text }));
    if (m.reachedDay !== null && m.reachedDay !== undefined) foot.push(h('span', {}, [m.build.name + ' in ', h('b', { text: m.reachedDay === 0 ? 'now' : 'about ' + m.reachedDay + ' day' + (m.reachedDay === 1 ? '' : 's') })]));
    if (m.nextGym && m.nextGym.gym) foot.push(h('span', {}, [m.nextGym.gym.name + ' ', h('b', { text: m.nextGym.known ? 'in ' + fmtInt(m.nextGym.energyLeft) + ' E' : 'next' }), m.nextGym.known ? ' (about ' + Math.max(1, Math.round(m.nextGym.days)) + ' days)' : ' · open Torn’s gym page once to track it']));
    return foot.length ? h('div', { class: 'sgfoot num' }, foot) : null;
}

/**
 * Next 7 days: stats gained a day, split by the stats trained. Round 7: from the plan you follow (its own line, read
 * by time: a jump plan shows its stack days and its jumps), today being what is left of it; with no plan line yet,
 * the steady projection as before.
 */
function weekChart(m, ctx) {
    const lines = (ctx && ctx.planLines) || [];
    const today = tornDayStart(m.now);
    let days = m.projection || [];
    let fromPlan = false;
    if (lineAt(lines, m.now)) {
        fromPlan = true;
        days = Array.from({ length: 7 }, (_, i) => {
            const from = i === 0 ? m.now : today + i * DAY;
            const to = today + (i + 1) * DAY;
            const d = { gain: Math.max(0, plannedBetween(lines, from, to) || 0) };
            // The split: each stat's own planned gain that day (used as weights, like trains).
            for (const k of STATS) d[k] = Math.max(0, Math.round((planStatAt(lines, k, to) || 0) - (planStatAt(lines, k, from) || 0)));
            return d;
        });
    }
    if (!days.length) return null;
    const start = new Date(m.now).getUTCDay();
    const perDay = days.map((d) => {
        const trains = STATS.reduce((a, k) => a + (d[k] || 0), 0) || 1;
        return STATS.filter((k) => d[k]).map((k) => ({ c: STAT_COLOR[k], v: ((d.gain || 0) * d[k]) / trains }));
    });
    const totals = days.map((d) => d.gain || 0);
    const used = STATS.filter((k) => days.some((d) => d[k]));
    const legend = h('span', { class: 'legend2' }, used.map((k) => h('span', {}, [h('i', { style: 'background:' + STAT_COLOR[k] }), STAT_LABEL[k]])));
    return h('div', {}, [
        h('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:6px' }, [t('ct', fromPlan ? 'Next 7 days · gained a day' : 'Next 7 days · stats gained a day'), legend]),
        stackBars(perDay, days.map((_, i) => DAYS[(start + i) % 7]), { w: 1000, h: 84, top: totals.map((v) => '+' + fmtShort(v)), label: 'Stats gained each of the next 7 days' }),
    ]);
}

/** This week from the recorded day totals (Tue–Mon style: the last 7 Torn days, today included). */
function weekCard(m, ctx) {
    const totals = ctx.dayTotals || {};
    const today = tornDayStart(m.now);
    const days = Object.keys(totals).map(Number).filter((d) => d > today - 7 * DAY && d <= today).sort((a, b) => a - b);
    const sum = (k) => days.reduce((a, d) => a + ((totals[d] && totals[d][k]) || 0), 0);
    // Gained: what your stats really rose each day; planned: the plan's line for those days (round 7).
    const nums = days.map((d) => dayGainPlan(m, ctx, d));
    const gained = nums.reduce((a, r) => a + (r.gained || 0), 0);
    const planned = nums.reduce((a, r) => a + (r.planned || 0), 0);
    const xan = sum('xanax');
    const xanP = sum('xanaxPlanned');
    const refills = sum('refills');
    const xp = unitPrice((ctx.prices || {})[XANAX]) || 0;
    const pp = unitPrice((ctx.prices || {})[POINTS], 300) || 0;
    // Money really spent this week (receipts: every item and refill at that day's price); before receipts, Xanax and refills.
    const spent = spentOverDays(ctx.receipts, days, { priceHistory: ctx.priceHistory, prices: ctx.prices || {} }, (d) => ((totals[d] && totals[d].xanax) || 0) * xp + ((totals[d] && totals[d].refills) || 0) * REFILL_POINTS * pp);
    const pct = planned > 0 ? Math.min(100, (100 * gained) / planned) : 0;
    return h('div', {}, [
        sectionHead('This week', meta([days.length ? days.length + ' day' + (days.length === 1 ? '' : 's') + ' recorded' : 'from today']), null, 'h3'),
        h('dl', { class: 'facts num' }, [
            h('dt', { text: 'Gained' }),
            h('dd', {}, [fmtSigned(gained) + (planned ? ' of ' + fmtShort(planned) : ''), h('div', { class: 'mini' }, [h('i', { style: 'width:' + pct.toFixed(0) + '%' })])]),
            h('dt', { text: 'Xanax' }),
            h('dd', { text: xan + (xanP ? ' of ' + xanP : '') }),
            h('dt', { text: 'Refills' }),
            h('dd', { text: refills + ' of ' + Math.max(1, days.length) }),
            h('dt', { text: 'Spent' }),
            h('dd', { text: xp || pp ? 'about ' + fmtMoney(spent) : '—' }),
        ]),
    ]);
}

function planLine(m, ctx) {
    const plan = ctx.plan;
    const strat = STRATEGIES[plan.strategy] || STRATEGIES.steady;
    const r = ctx.compare && ctx.compare[plan.strategy];
    const days = m.planDays || ctx.settings.horizonDays || 30;
    const perDay = r ? Math.round(((r.used && r.used[XANAX]) || 0) / days) : null;
    const sub = r ? (perDay ? perDay + ' Xanax' : 'no Xanax') + ((r.used && r.used[POINTS]) ? ' + refill' : '') + ' a day · +' + fmtShort(r.gained) + ' in ' + days + ' days' : strat.what;
    return h('div', {}, [
        h('div', { class: 'one' }, [
            h('div', {}, [t('lab', 'Plan'), h('div', {}, [h('b', { class: 'white', text: strat.short + ' · ' + m.build.name })]), h('span', { class: 'muted', style: 'font-size:12px', text: sub })]),
            h('a', { class: 'btn sm', href: '#plan', onclick: (e) => { e.preventDefault(); ctx.go('plan'); }, text: 'Change' }),
        ]),
    ]);
}

/*
 * Stacking for a chain (round 7, the owner's pick in mockups/round7/home.html): a small card on top of the pane turns
 * it on; Today then shows that training waits instead of the steps, and Resume recalibrates at once (Recalibrate's run, its
 * light sweep included). The flag is stored for every tab (platform/store.js K.stacking); the model carries it as
 * `m.stacking = {since}`.
 */

/** "since 14:02", or "since Tue 14:02" when it began before today's Torn day. */
function sinceWords(since, now, settings) {
    return (tornDayStart(since) < tornDayStart(now) ? DAY_NAMES[settings && settings.timeFormat === 'local' ? new Date(since).getDay() : new Date(since).getUTCDay()] + ' ' : '') + clock(since, settings);
}

/** Heads-up lines that ask you to train or to use energy (a strict step coming, the refill, boosters): held back while stacking. */
export function trainingHead(x) {
    const text = String((x && x.text) || '');
    return /^In \d+ min: /.test(text) || text === 'Refill unused' || /^No candy today/.test(text) || /^No boosters before /.test(text);
}

/** The pane's first card: "Training · Stacking energy for a chain? [I'm stacking]", or since when and Resume. */
export function chainCard(m, ctx) {
    const st = m.stacking;
    const busy = Boolean(m.planBusy);
    return h('div', { class: 'chain' + (st ? ' on' : ''), 'data-chain': st ? 'on' : 'off' }, [
        h('div', { class: 'chain-row' }, [
            h('div', {}, [
                h('div', { class: 'chain-state', text: st ? 'Stacking since ' + sinceWords(st.since, m.now, ctx.settings) : 'Training' }),
                h('p', { text: st ? 'Resume recalibrates from your bars right away.' : 'Stacking energy for a chain?' }),
            ]),
            st
                ? h('button', { class: 'btn primary', type: 'button', disabled: busy, title: 'Training steps come back and the plan is recalibrated now, from your bars', onclick: () => ctx.resumeStacking && ctx.resumeStacking(), text: 'Resume' })
                : h('button', { class: 'btn', type: 'button', disabled: busy, title: 'No training steps and no Discord pings about energy or training until you resume', onclick: () => ctx.startStacking && ctx.startStacking(), text: 'I’m stacking' }),
        ]),
    ]);
}

/** Today while stacking: no steps, what waits, the energy kept, and Resume. */
function stackingBox(m, ctx) {
    const e = m.strip.energy;
    return h('div', { class: 'stackbox num', role: 'status' }, [
        h('div', { class: 'big', text: 'Stacking for a chain' }),
        h('ul', {}, [
            h('li', {}, [h('b', { text: 'No training steps' }), ' until you resume']),
            h('li', {}, [h('b', { text: 'No Discord pings' }), ' about energy or training']),
            h('li', {}, ['Energy now ', h('b', { text: fmtInt(e.current) + ' / ' + fmtInt(e.max) }), ', kept for the chain']),
        ]),
        h('button', { class: 'btn primary', type: 'button', disabled: Boolean(m.planBusy), onclick: () => ctx.resumeStacking && ctx.resumeStacking(), text: 'Resume and recalibrate' }),
    ]);
}

/**
 * Recalibrate running (Resume starts it from here): the Plan card's bar with the owner's light sweep (2A; still with
 * Settings › Animations off or the PC's reduce-motion). app.js planProgress moves it without a redraw.
 */
function homeRun(m, ctx) {
    const busy = m.planBusy;
    if (!busy) {
        const err = ctx.ui && ctx.ui.homeReplan && ctx.ui.planError;
        return err ? h('p', { class: 'c-bad', style: 'margin:8px 0 0', text: err }) : null;
    }
    return h('div', { class: 'planrun', role: 'status', 'aria-live': 'polite' }, [
        h('div', { class: 'dayline', role: 'progressbar', 'aria-label': busy.recalibrate ? 'Recalibrating' : 'Working out your plan' }, [h('i', { 'data-plan-bar': '1', style: 'width:' + Math.round(100 * Math.max(0.02, busy.done || 0)) + '%' })]),
        h('div', { class: 'row', style: 'justify-content:space-between;margin-top:6px' }, [h('span', { class: 'pc-sub num', 'data-plan-words': '1', text: planRunWords(busy) }), h('span', { class: 'muted', style: 'font-size:12px', text: 'Today’s steps follow your bars meanwhile' })]),
    ]);
}

export function renderHome(m, ctx) {
    const s = ctx.settings;
    const now = m.now;
    // An overdose first (you can't train either way), then stacking for a chain.
    if (m.overdose) return renderOverdose(m, ctx);
    if (m.stacking) return renderStacking(m, ctx);
    // Flying or abroad: the gym is closed (Torn's own page says so), whatever the plan has next.
    if (m.away) return renderAway(m, ctx);
    const next = m.next;
    const late = next && next.kind === 'xanax' && m.strip.drug.left === 0;
    // "On plan" only while no step is waiting on you (the plan re-times, so a due step is the one sign of being behind).
    const overdue = Boolean(next && next.at <= now - 5 * 60 * 1000);
    // What the plan says for today (its line: fixed for the day), else what today's steps add up to.
    const todayNums = dayGainPlan(m, ctx, tornDayStart(now));
    const plannedToday = todayNums.planned !== null && todayNums.planned !== undefined ? todayNums.planned : m.plannedGain;
    const buyTotal = buyRows(m.buyToday.filter((n) => n.buy > 0), ctx.prices, itemContext(ctx.statics || {}, ctx.settings || {}, now)).reduce((a, r) => a + (r.fill ? r.fill.total : 0), 0);

    const head = sectionHead(
        'Today',
        meta([
            dateLine(now) + ' · ',
            h('b', { text: fmtSigned(plannedToday) }),
            ' planned',
            buyTotal ? ' · ' + fmtMoney(buyTotal) + ' to spend' : '',
            ' · ',
            h('b', { style: late || overdue ? 'color:var(--warn)' : null, text: late ? 'Xanax ready' : overdue ? 'a step is due' : 'on plan' }),
        ]),
    );

    // A step past midnight says its day (round 7: tomorrow's jump was listed under Today with a clock only).
    const dayWord = (at) => (tornDayStart(at) > tornDayStart(now) ? (Math.round((tornDayStart(at) - tornDayStart(now)) / DAY) === 1 ? 'tomorrow' : DAY_NAMES[new Date(at).getUTCDay()]) : null);
    const when = (at) => (dayWord(at) ? [h('small', { text: dayWord(at) }), clock(at, s)] : [clock(at, s)]);
    // A jump or boost due within the minute counts as now (as on Torn's panel), like a step whose time has come.
    const due = Boolean(next && (next.at <= now || (isBoostStep(next) && next.at <= now + DUE_SLACK_MS)));
    const subs = due ? subSteps(next, { reads: { happy: { current: m.strip.happy.current, max: m.strip.happy.max }, boosterLeft: m.strip.booster.left, drugLeft: m.strip.drug.left }, steps: m.steps }) : [];

    const rail = [];
    for (const d of m.done) {
        const trained = Object.keys(d.trained || {}).map((k) => STAT_LABEL[k]).join(' · ');
        rail.push(railRow('done', tickMark(), clock(d.at, s), h('div', {}, [h('span', { text: d.label }), trained || d.gain ? h('span', { class: 's', text: ' · ' + [trained, d.gain ? fmtSigned(d.gain) : ''].filter(Boolean).join(' · ') }) : null]), h('span', { class: 'in', text: 'Done' })));
    }
    if (due) {
        // The step of the moment: its actions on the rail, the ring on the one to do now; the buttons follow it.
        const strict = isBoostStep(next) && next.deadline > now;
        const side = [strict ? cd(next.deadline, now, { cls: 'cd num' }) : h('span', { class: 'k', text: 'NOW' }), strict ? h('small', { text: 'until ' + clock(next.deadline, s) + ', when happy resets' }) : null];
        const links = stepButtons(subs);
        if (links.length) side.push(h('div', { class: 'acts' }, links));
        const note = isBoostStep(next) && next.note && !next.mid ? h('div', { class: 's', text: next.note }) : null;
        rail.push(railRow('now', railDot('on'), 'now', h('div', { class: 'nb num' }, [h('div', {}, [subList(subs), note]), h('div', { class: 'side' }, side)])));
    } else if (next) {
        // Nothing to do yet: said in words, with the countdown; a countdown never rings.
        const what = [lowerAction(stepWords(next)), trainDetail(next, false), next.note].filter(Boolean).join(' · ');
        rail.push(
            railRow('now', railDot('open'), when(next.at), h('div', { class: 'nb num' }, [
                h('div', {}, [h('b', { class: 'big1', text: 'Nothing due now' }), h('span', { class: 's', text: 'Next ' + (dayWord(next.at) ? dayWord(next.at) + ' ' : '') + 'at ' + clock(next.at, s) + ': ' + what })]),
                h('div', { class: 'side' }, [cd(next.at, now, { cls: 'cd num' }), h('small', { text: 'next at ' + clock(next.at, s) })]),
            ])),
        );
    } else {
        rail.push(railRow('now', railDot('open'), '', h('div', { class: 'nb num' }, [h('div', {}, [h('b', { class: 'big1', text: 'Nothing left today' }), h('span', { class: 's', text: 'Tomorrow’s plan starts at 00:00 Torn time' })]), h('div', { class: 'side' }, [h('span', { class: 'k', text: 'DONE' })])])));
    }
    m.steps.slice(next ? 1 : 0).forEach((st) => {
        const trains = trainsText(st.trains);
        rail.push(
            railRow(
                null,
                railDot(),
                when(st.at),
                h('div', {}, [h('b', { class: 'white', text: st.label }), trains || st.gain ? h('span', { class: 's', text: ' · ' + [trains, st.gain ? fmtSigned(st.gain) : ''].filter(Boolean).join(' · ') }) : null, st.mid && st.note ? h('div', { class: 's', text: st.note }) : null]),
                h('span', { class: 'in num' }, st.at > now ? ['in ', cd(st.at, now)] : ['now']),
            ),
        );
    });
    const steps = h('ol', { class: 'rail', 'data-rail': due ? 'due' : next ? 'wait' : 'done' }, rail);
    const foot = h('div', { class: 'row muted num', style: 'justify-content:space-between;margin-top:6px;font-size:12px;gap:12px;flex-wrap:wrap' }, [h('span', {}, ['So far ', h('b', { class: 'white', text: fmtSigned(m.gainedToday) }), ' of ' + fmtInt(plannedToday) + ' today']), h('span', { text: dayResetWords(m) + ' · ' + xanaxCdWords(m.xanaxCd) })]);

    const lead = h('div', { class: 'lead' }, [head, homeRun(m, ctx), steps, foot]);
    const week = weekChart(m, ctx);
    return {
        strip: true,
        main: [lead, nextDays(m, s), youVsBuild(m, ctx), week].filter(Boolean),
        pane: [chainCard(m, ctx), gainsCard(m), buyCard(m, ctx), headsCard(m, ctx), planLine(m, ctx), weekCard(m, ctx)],
    };
}

function headsCard(m, ctx) {
    const heads = m.stacking || m.overdose || m.away ? m.heads.filter((x) => !trainingHead(x)) : m.heads;
    return h('div', {}, [sectionHead('Heads-up', null, null, 'h3'), headsList(heads.length ? heads : [{ tone: 'good', text: 'Nothing needs you' }], (tab) => ctx.go(tab))]);
}

/**
 * Home while overdosed (the owner, 2026-10-03: Torn's panel said "Overdosed · fly to Switzerland" while Today still
 * said "Train DEX × 6" and ticked the Xanax step Done). The same stored state as the panel (`m.overdose`): no steps,
 * what to do, what it costs, and "Rehab done · recalibrate" (Resume's run). It also ends by itself with the overdose's
 * drug cooldown, or as soon as your bars hold more than regeneration gives back (a refill, a can, a drug).
 */
function overdoseBox(m, ctx) {
    const od = m.overdose;
    const e = m.strip.energy;
    return h('div', { class: 'stackbox num', role: 'status', 'data-overdose': 'on' }, [
        h('div', { class: 'big', text: OVERDOSE_WORDS.pill }),
        h('ul', {}, [
            h('li', {}, [h('b', { text: 'No training steps' }), ' until rehab is done']),
            h('li', {}, ['Rehab there: about ', h('b', { text: fmtMoney(REHAB_COST) }), ' a session']),
            h('li', {}, ['No drug until ', h('b', { text: clock(od.until, ctx.settings) }), ' (', cd(od.until, m.now, { cls: 'when' }), ') · energy now ' + fmtInt(e.current) + ' / ' + fmtInt(e.max)]),
            h('li', {}, [h('b', { text: 'No Discord pings' }), ' about energy or training']),
        ]),
        h('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' }, [
            h('a', { class: 'btn primary', href: TRAVEL_URL, target: '_blank', rel: 'noopener', text: 'Open Travel' }),
            h('button', { class: 'btn', type: 'button', disabled: Boolean(m.planBusy), title: 'Training steps come back and the plan is recalibrated now, from your bars', onclick: () => ctx.endOverdose && ctx.endOverdose(), text: 'Rehab done · recalibrate' }),
        ]),
    ]);
}

function renderOverdose(m, ctx) {
    const head = sectionHead('Today', meta([dateLine(m.now) + ' · ', h('b', { style: 'color:var(--warn)', text: 'overdosed' })]));
    // Flying to Switzerland is the one thing to do: the rail's point is the plate with the ring.
    const lead = h('div', { class: 'lead' }, [head, homeRun(m, ctx), railBox(plateMark(true), 'now', overdoseBox(m, ctx))]);
    return {
        strip: true,
        main: [lead, youVsBuild(m, ctx), weekChart(m, ctx)].filter(Boolean),
        pane: [gainsCard(m), buyCard(m, ctx), headsCard(m, ctx), planLine(m, ctx), weekCard(m, ctx)],
    };
}

/**
 * Home while you fly or stand abroad (the owner's live page, 2026-10-03: "Train DEX × 6" in the air). The same state
 * as Torn's panel (`m.away`): no step to do now, when you are back, and what comes first when you land.
 */
function renderAway(m, ctx) {
    const w = awayWords(m.away);
    const first = m.steps[0] || null;
    const box = h('div', { class: 'stackbox num', role: 'status', 'data-away': 'on' }, [
        h('div', { class: 'big' }, [h('span', { text: w.pill }), m.away.flying ? cd(m.away.until, m.now, { cls: 'cd num' }) : null]),
        h('ul', {}, [
            h('li', {}, [h('b', { text: 'No training' }), ' until you are back in Torn: the gym is closed while you travel']),
            first ? h('li', {}, ['First when you land: ', h('b', { text: first.label.split(' · ')[0] + (trainsText(first.trains) ? ', then ' + trainsText(first.trains) : '') })]) : null,
            m.away.flying ? h('li', {}, [m.away.where === 'Torn' ? 'Back at ' : 'Lands at ', h('b', { text: clock(m.away.until, ctx.settings) }), ' (', cd(m.away.until, m.now, { cls: 'when' }), ')']) : null,
        ]),
    ]);
    const head = sectionHead('Today', meta([dateLine(m.now) + ' · ', h('b', { style: 'color:var(--warn)', text: m.away.flying ? 'flying' : 'abroad' })]));
    // Nothing you can do until you land: nothing rings; the rail's time is when you are back.
    const lead = h('div', { class: 'lead' }, [head, homeRun(m, ctx), railBox(railDot('open'), m.away.flying ? clock(m.away.until, ctx.settings) : 'now', box)]);
    return {
        strip: true,
        main: [lead, youVsBuild(m, ctx), weekChart(m, ctx)].filter(Boolean),
        pane: [chainCard(m, ctx), gainsCard(m), buyCard(m, ctx), headsCard(m, ctx), planLine(m, ctx), weekCard(m, ctx)],
    };
}

/** Home while stacking for a chain: Today says training waits; no steps, no 48 h look-ahead, no training heads-up. */
function renderStacking(m, ctx) {
    const head = sectionHead('Today', meta([dateLine(m.now) + ' · ', h('b', { style: 'color:var(--warn)', text: 'training paused' })]));
    const lead = h('div', { class: 'lead' }, [head, railBox(railDot('open'), 'now', stackingBox(m, ctx))]);
    return {
        strip: true,
        main: [lead, youVsBuild(m, ctx), weekChart(m, ctx)].filter(Boolean),
        pane: [chainCard(m, ctx), gainsCard(m), buyCard(m, ctx), headsCard(m, ctx), planLine(m, ctx), weekCard(m, ctx)],
    };
}
