/*
 * What the gym page marks say, worked out purely (DESIGN §5, ROUND4-PLAN
 * §C5): the walk-through of the current train step, part by part ("George's:
 * STR × 12 → Frontline Fitness: DEX × 8"). In the gym of the current part,
 * that stat is outlined and Fill types the trains left; when the part is in
 * another gym, that gym's button is outlined ("Next: Frontline Fitness · DEX
 * × 8") and the stat boxes go grey. Progress comes from a snapshot taken
 * when the step starts, moved on by every train Torn shows. The UI only
 * draws this; nothing here (or there) clicks, trains or switches gyms.
 */

import { STATS, STAT_LABEL, totalOf, gainPerTrain, HAPPY_LOSS_PER_ENERGY } from './gain.js';
import { splitSession, BUILDS } from './builds.js';
import { gymById } from './gyms.js';
import { fmtInt, fmtSigned } from './format.js';
import { XANAX, ECSTASY, ITEMS } from './items.js';
import { tornClock } from './bars.js';
import { MID_BOOST_MIN, MID_BOOST_SHARE } from './plan.js';

/** A walk-through older than this is over (a session takes minutes; the next drug is hours away). */
export const SESSION_MAX_MS = 3 * 60 * 60 * 1000;

/** This much more energy than the session still needs (a Xanax, a refill, a full bar) starts a new one. */
export const NEW_SESSION_E = 50;

/** A step counts as now when it is due within this long. */
export const DUE_SLACK_MS = 60 * 1000;

/** "George's: STR × 12" */
export function partText(p) {
    return p.gymName + ': ' + STAT_LABEL[p.stat] + ' × ' + p.trains;
}

/** "George's: STR × 12 → Frontline Fitness: DEX × 8" */
export function partsText(parts) {
    return (parts || []).map(partText).join(' → ');
}

/**
 * The train step the gym page walks through: the first step with trains
 * that is due now; else the energy you have now, split the same way.
 * @returns {{id, kind, label, at, items, parts}|null}
 */
export function currentTrainStep(m, now = m.now) {
    const due = (m.steps || []).find((s) => s.parts && s.parts.length && s.at <= now + DUE_SLACK_MS);
    if (due) return due;
    // Xanax stacked for a jump (energy above the maximum on a jump plan): that energy waits for the jump, so the page
    // never says to train it now (round 7: between stacks it said "Train DEX × 100" with the jump's energy).
    if (m.strip && m.strip.refill && m.strip.refill.stacking) return null;
    const energy = m.strip.energy.current;
    const r = splitSession({
        stats: m.pc.stats,
        shares: m.shares,
        energy,
        happy: m.strip.happy.current,
        happyMax: m.state.happy.maximum,
        unlocked: m.pc.unlocked,
        perks: m.pc.perks.mult,
        keep: m.keep,
        table: m.pc.table,
        active: m.state.gymId,
        happyLossMult: m.pc.perks.happyLossMult,
    });
    if (!r.parts.length) return null;
    return { id: 'now', kind: 'now', label: 'The energy you have now', at: now, items: [], parts: r.parts };
}

/**
 * What the page shows now: each stat from Torn's boxes where they show it
 * (they change the moment a train lands), else from the model; energy from
 * Torn's sidebar bar, else the model.
 * @param {object} m - model
 * @param {{stat, value}[]} [boxes] - readStatBoxes()
 * @param {{current:number}|null} [bar] - readEnergyBar()
 */
export function pageReading(m, boxes = [], bar = null) {
    const stats = { ...m.pc.stats };
    for (const b of boxes || []) if (STATS.includes(b.stat) && Number.isFinite(b.value) && b.value > 0) stats[b.stat] = Math.max(stats[b.stat] || 0, b.value);
    const energy = bar && Number.isFinite(bar.current) ? bar.current : m.strip.energy.current;
    return { stats, energy, happy: m.strip.happy.current };
}

/** A new walk-through, snapshot of the stats and energy as the step starts. */
export function startSession(step, reading, m, now) {
    const spent = { str: 0, spd: 0, def: 0, dex: 0 };
    return {
        v: 1,
        at: now,
        build: m.build.id,
        stepId: step.id,
        label: step.label || '',
        drug: (step.items || []).some((it) => it.id === XANAX),
        parts: step.parts.map((p) => ({ gymId: p.gymId, gymName: p.gymName, stat: p.stat, trains: p.trains, perTrain: p.perTrain, gain: p.gain || 0, ...(p.stopAt !== undefined ? { stopAt: p.stopAt, stopReason: p.stopReason } : {}) })),
        stats0: { ...reading.stats },
        energy0: reading.energy,
        happy0: reading.happy,
        last: { stats: { ...reading.stats }, energy: reading.energy },
        spent,
        // Energy the step leaves on purpose (kept for a war, or a stop that keeps a specialist gym): not a sign of a new session.
        spare: Math.max(0, Number(m.keepEnergy) || 0),
    };
}

/** Energy spent so far this session. */
function spentTotal(session) {
    return STATS.reduce((a, k) => a + (session.spent[k] || 0), 0);
}

/**
 * Count the trains that happened since the last reading. A stat that rose
 * gets the energy that went (the sidebar's drop); when the bar hasn't moved
 * yet, the trains the rise stands for (its gain ÷ the gain of one train in
 * that part's gym), so the page moves on as soon as Torn shows the train.
 * @returns {object} the session, moved on
 */
export function advanceSession(session, reading, { table = undefined, perks = null } = {}) {
    const last = session.last;
    const rose = STATS.filter((k) => reading.stats[k] - (last.stats[k] || 0) >= 1);
    const spent = { ...session.spent };
    if (rose.length) {
        const happy = Math.max(0, (session.happy0 || 0) - HAPPY_LOSS_PER_ENERGY * spentTotal(session));
        const est = {};
        for (const k of rose) {
            const part = session.parts.find((p) => p.stat === k);
            const gym = part ? gymById(part.gymId, table) : null;
            if (!gym || !(gym.dots[k] > 0)) {
                est[k] = 0;
                continue;
            }
            const one = gainPerTrain(k, last.stats[k], happy, gym.dots[k], gym.energy, perks ? perks[k] : 1);
            est[k] = one > 0 ? Math.max(1, Math.round((reading.stats[k] - last.stats[k]) / one)) * gym.energy : 0;
        }
        const dE = Number.isFinite(last.energy) && Number.isFinite(reading.energy) ? last.energy - reading.energy : 0;
        const estSum = rose.reduce((a, k) => a + est[k], 0);
        for (const k of rose) spent[k] += dE > 0 ? (estSum > 0 ? (dE * est[k]) / estSum : dE / rose.length) : est[k];
    }
    const stats = { ...last.stats };
    for (const k of STATS) stats[k] = Math.max(stats[k] || 0, reading.stats[k] || 0);
    return { ...session, spent, last: { stats, energy: Number.isFinite(reading.energy) ? reading.energy : last.energy } };
}

/**
 * The parts with what's done: each stat's energy spent fills its parts in
 * order. `current` is the first part not finished (null = session done).
 */
export function sessionProgress(session) {
    const used = { str: 0, spd: 0, def: 0, dex: 0 };
    let current = null;
    const parts = session.parts.map((p, i) => {
        const avail = Math.max(0, (session.spent[p.stat] || 0) - used[p.stat]);
        const done = Math.min(p.trains, Math.round(avail / p.perTrain));
        used[p.stat] += done >= p.trains ? p.trains * p.perTrain : avail;
        const q = { ...p, index: i, done, left: p.trains - done, energy: p.trains * p.perTrain };
        if (q.left > 0 && current === null) current = q;
        return q;
    });
    for (const q of parts) q.state = q.left === 0 ? 'done' : q === current ? 'current' : 'later';
    return { parts, current, done: current === null };
}

/** Torn lists its gyms in groups of eight: the one a gym is in, to find its button. */
export function gymGroupWord(gymId) {
    const id = Number(gymId);
    return id <= 8 ? 'a lightweight gym' : id <= 16 ? 'a middleweight gym' : id <= 24 ? 'a heavyweight gym' : 'a specialist gym';
}

/** Energy the session still needs. */
export function sessionEnergyLeft(session) {
    return sessionProgress(session).parts.reduce((a, p) => a + p.left * p.perTrain, 0);
}

/** Start a new walk-through? (none yet, another build, too old, or clearly more energy than it needs). */
export function needsNewSession(session, reading, m, now) {
    if (!session || session.v !== 1 || !Array.isArray(session.parts) || !session.parts.length) return true;
    if (session.build !== m.build.id) return true;
    if (!(now - session.at < SESSION_MAX_MS) || now < session.at) return true;
    return Number.isFinite(reading.energy) && reading.energy - sessionEnergyLeft(session) - (session.spare || 0) >= NEW_SESSION_E;
}

/**
 * The gym page's session as it should be now: moved on by this reading,
 * or a new one when a new step has started.
 * @returns {object|null}
 */
export function nextSession(prev, m, reading, now, ctx = {}) {
    if (!needsNewSession(prev, reading, m, now)) return advanceSession(prev, reading, ctx);
    const step = currentTrainStep(m, now);
    return step ? startSession(step, reading, m, now) : null;
}

/* ------------------------------------------- round 7: the gym page's states */

/** Rehab in Switzerland after an overdose: about this much a session (the owner's own log, 2026-10-02). */
export const REHAB_COST = 215000;
export const TRAVEL_URL = 'https://www.torn.com/travelagency.php';

/** A jump or a daily boost: candy or EDVD (or the console) with the drug, then train it all. Never FHC or cans. */
export function isBoostStep(step) {
    return Boolean(step) && (step.kind === 'jump' || step.kind === 'boost');
}

/** "EDVD × 5" from "Eat EDVD × 5"; the plan's mid-step words ("the boosters") read "Boosters". */
function eatWordsOf(text) {
    const w = String(text || '').replace(/^Eat /, '');
    return w === 'the boosters' ? 'Boosters' : w;
}

/**
 * A boost or jump step and how far it is, from the bars (round 7). Not eaten: happy not above its maximum (by the
 * share of the boost the plan uses to tell a boost under way: plan.js MID_BOOST_*; a stack of Xanax adds a few hundred).
 * Eaten: happy above it and the booster cooldown running. The drug (Ecstasy or Xanax): its cooldown running once the
 * boosters are in, unless the plan still lists it to take (an earlier Xanax's cooldown that ends before the tick).
 * @param {object} step - plan.js jump/boost step {items, actions, mid, deadline, gain, parts}
 * @param {object} reads - {happy:{current,max}|null, boosterLeft:ms, drugLeft:ms, trained:boolean}
 * @returns {{jump, eaten, drugIn, ready, eat, drug, deadline, gain, list:{id, text, done, next}[]}}
 */
export function boostProgress(step, { happy = null, boosterLeft = 0, drugLeft = 0, trained = false } = {}) {
    const acts = Array.isArray(step.actions) ? step.actions : [];
    const act = (id) => acts.find((a) => a.id === id) || null;
    const eatA = act('eat');
    const jpA = act('jp');
    const drugA = act('drug');
    const items = step.items || [];
    const boostHappy = items.reduce((a, it) => a + (ITEMS[it.id] && ITEMS[it.id].kind === 'booster' ? (ITEMS[it.id].happy || 0) * (it.qty || 0) : 0), 0);
    const over = Math.max(MID_BOOST_MIN, MID_BOOST_SHARE * boostHappy);
    const live = happy && Number.isFinite(happy.current) && Number.isFinite(happy.max);
    const eaten = live ? happy.current >= happy.max + over && (boosterLeft > 0 || Boolean(step.mid)) : Boolean(step.mid || (eatA && eatA.done));
    const drugToTake = items.some((it) => it.id === XANAX || it.id === ECSTASY);
    const drugIn = !drugA ? eaten : eaten && (Boolean(drugA.done) || (drugLeft > 0 && !(step.mid && drugToTake)));
    const drug = drugA ? drugA.text.replace(/^Take the /, '') : null;
    const trainWords = (() => {
        const by = {};
        for (const p of step.parts || []) by[p.stat] = (by[p.stat] || 0) + p.trains;
        const t = Object.entries(by).map(([k, n]) => STAT_LABEL[k] + ' × ' + n).join(' + ');
        return t ? 'Train it all: ' + t : 'Train it all';
    })();
    const list = [];
    if (eatA) list.push({ id: 'eat', text: eatWordsOf(eatA.text), done: eaten });
    if (jpA) list.push({ id: 'jp', text: jpA.text, done: drugIn });
    if (drugA) list.push({ id: 'drug', text: drug, done: drugIn });
    list.push({ id: 'train', text: trainWords, done: Boolean(trained) });
    if (act('refill')) list.push({ id: 'refill', text: 'Refill, then train again', done: false });
    const next = list.findIndex((x) => !x.done);
    list.forEach((x, i) => (x.next = i === next));
    return { jump: step.kind === 'jump', eaten, drugIn, ready: eaten && drugIn, eat: eatA ? eatWordsOf(eatA.text) : null, drug, deadline: step.deadline || null, gain: step.gain || 0, list };
}

/** An overdose seen on the bars: happy and energy at 0 right after a drug (its cooldown running). */
export function isOverdose({ happy = null, energy = null, drugLeft = 0 } = {}) {
    return Boolean(happy && energy) && happy.current === 0 && energy.current === 0 && drugLeft > 0;
}

/**
 * The overdose kept across reads (the bars climb again a tick later): {at, until: the drug cooldown's end} once seen,
 * until that cooldown is over; null otherwise.
 */
export function nextOverdose(prev, reads, now) {
    if (prev && Number.isFinite(prev.until) && now < prev.until && now >= (prev.at || 0)) return prev;
    return isOverdose(reads) ? { at: now, until: now + reads.drugLeft } : null;
}

/**
 * Which of the gym page's states it is (owner's picks, 2026-10-03; overlays.html §6):
 *   stacking  stacking energy for a chain: training paused, no train marks
 *   overdose  every jump mark stops; fly to Switzerland
 *   wrong     the part is in another gym: that gym pulses, Fill waits
 *   eat       a jump or daily boost with the boosters or the drug still to take: the stat pulses red, Fill waits
 *   ready     the boosters and the drug are in: steady green, train it all
 *   right     the right gym, train now (steady green)
 *   done      the session is done; idle: nothing to train now
 */
export function gymPageState({ step = null, cur = null, here = false, done = false, reads = {}, overdose = null, stacking = null, now = 0 } = {}) {
    if (stacking) return { kind: 'stacking', since: Number(stacking.since) || null, boost: null };
    if (overdose && now < overdose.until) return { kind: 'overdose', at: overdose.at, cost: REHAB_COST, boost: null };
    const boost = isBoostStep(step) ? boostProgress(step, { ...reads, trained: done }) : null;
    if (!cur) return { kind: done ? 'done' : 'idle', boost };
    if (!here) return { kind: 'wrong', boost };
    if (boost && !boost.ready) return { kind: 'eat', boost };
    return { kind: boost ? 'ready' : 'right', boost };
}

/** "EDVD × 5, then the Ecstasy, then train it all" */
function eatOrder(boost) {
    const parts = [];
    for (const x of boost.list) if (!x.done && x.id !== 'train' && x.id !== 'refill') parts.push(x.id === 'drug' ? 'the ' + x.text : x.text);
    parts.push('train it all');
    return parts.map((p, i) => (i ? 'then ' + p : p)).join(', ');
}

/**
 * @param {object} m - buildModel() output (m.stacking: {since}|null while stacking for a chain)
 * @param {object} page - {selectedId, boxes: [{stat, locked, energyPerTrain}], reading,
 *   reads: {happy, energy, boosterLeft, drugLeft} (the sidebar's bars, the model's cooldowns), overdose: {at, until}|null}
 * @param {object|null} [session] - the walk-through (nextSession); null = the current step, nothing done yet
 * @param {number} [now]
 * @returns {{strip:string[], parts:object[], current:object|null, done:boolean, nextGym:{id, label, group}|null, switchHint:string|null,
 *   perStat:object, pill:string|null, gym:object|null, hereGym:{id, wrong}|null, state:object, line:object}}
 */
export function planGymPage(m, page = {}, session = null, now = m.now) {
    const table = m.pc.table;
    const selectedId = Number(page.selectedId || m.state.gymId);
    const gym = gymById(selectedId, table);
    const stats = m.pc.stats;
    const reading = page.reading || { stats, energy: m.strip.energy.current };
    const energy = reading.energy;
    const perStat = {};
    const out = { strip: [], parts: [], current: null, done: false, nextGym: null, switchHint: null, perStat, pill: null, gym, hereGym: null, state: { kind: 'idle', boost: null }, line: null };
    if (!gym) return out;
    const due = currentTrainStep(m, now);
    if (!session) session = due ? startSession(due, reading, m, now) : null;
    const prog = session ? sessionProgress(session) : { parts: [], current: null, done: false };
    out.parts = prog.parts;
    out.current = prog.current;
    out.done = Boolean(session) && prog.done;
    const cur = prog.current;
    const here = Boolean(cur) && cur.gymId === selectedId;
    const reads = page.reads || { happy: m.strip.happy ? { current: m.strip.happy.current, max: m.strip.happy.max } : null, energy: m.strip.energy, boosterLeft: m.strip.booster ? m.strip.booster.left : 0, drugLeft: m.strip.drug ? m.strip.drug.left : 0 };
    const state = gymPageState({ step: due, cur, here, done: out.done, reads, overdose: page.overdose || null, stacking: m.stacking || null, now });
    out.state = state;
    const off = state.kind === 'stacking' || state.kind === 'overdose';

    const total = totalOf(stats);
    const tomorrow = (m.projection && m.projection[1]) || {};
    const boxes = new Map((page.boxes || []).map((b) => [b.stat, b]));
    const partsOfStat = (k) => prog.parts.filter((p) => p.stat === k);
    // The word on a box that isn't trained now: in full (hover), and its small corner tag.
    const greyWord = (stat, all, left, lockedHere) => {
        if (all.length && !left.length) return { text: 'Done ✓ · ' + STAT_LABEL[stat] + ' × ' + all.reduce((a, p) => a + p.trains, 0), tag: 'done ✓' };
        if (left.length) {
            const p = left[0];
            return p.gymId === selectedId ? { text: 'Next · ' + STAT_LABEL[stat] + ' × ' + p.left + ' after ' + (cur ? STAT_LABEL[cur.stat] : 'this'), tag: 'next · after ' + (cur ? STAT_LABEL[cur.stat] : 'this') } : { text: 'Later · ' + STAT_LABEL[stat] + ' × ' + p.left + ' at ' + p.gymName, tag: 'later · ' + p.gymName };
        }
        if (lockedHere) return { text: 'Not trained here', tag: 'not here' };
        const share = total > 0 ? stats[stat] / total : 0;
        if (share > m.shares[stat] + 0.005) return { text: 'Skip · ' + (share * 100).toFixed(0) + '% of total, over target', tag: 'skip · over target' };
        if (tomorrow[stat] > 0) return { text: 'Next · starts tomorrow', tag: 'tomorrow' };
        return { text: 'Skip · not in this session', tag: 'skip' };
    };

    for (const k of STATS) {
        const box = boxes.get(k);
        const locked = (box && box.locked) || !(gym.dots[k] > 0);
        const mine = partsOfStat(k);
        const open = mine.filter((p) => p.left > 0);
        if (off) {
            // Stacking for a chain, or an overdose: no train or jump mark anywhere (the strip says why).
            perStat[k] = { kind: 'off', text: '' };
        } else if (here && k === cur.stat) {
            const n = cur.left;
            const canNow = Number.isFinite(energy) ? Math.max(0, Math.min(n, Math.floor(energy / cur.perTrain))) : n;
            const allEnergy = n * cur.perTrain > energy - cur.perTrain;
            const gain = cur.trains > 0 ? (cur.gain * n) / cur.trains : 0;
            const waitWord = canNow < n ? (canNow === 0 ? ' · energy ' + fmtInt(energy) + (session.drug ? ', take the Xanax first' : ', wait for more') : ' · ' + canNow + ' now, the rest after more energy') : '';
            const b = state.boost;
            const eat = state.kind === 'eat';
            perStat[k] = {
                kind: 'train',
                // right / ready: steady green; eat: pulses red, Fill waits.
                mark: state.kind,
                hold: eat,
                trains: n,
                fill: eat ? 0 : canNow,
                fillN: n,
                gain: Math.round(gain),
                tab: eat ? 'Eat first' : state.kind === 'ready' ? 'Train it all · about ' + fmtSigned(Math.round(b.gain || gain)) : 'Train this · ' + fmtInt(n) + ' train' + (n === 1 ? '' : 's') + (cur.done > 0 ? ' left' : '') + ' · about ' + fmtSigned(gain),
                text: fmtInt(n) + ' train' + (n === 1 ? '' : 's') + (cur.done > 0 ? ' left' : ''),
                sub: eat ? b.list.filter((x) => !x.done && (x.id === 'eat' || x.id === 'drug' || x.id === 'jp')).map((x) => x.text).join(' + ') + ' first' : (allEnergy ? 'all ' + (state.kind === 'ready' ? fmtInt(energy) + ' ' : 'your ') + 'energy' : fmtInt(n * cur.perTrain) + ' energy') + ' · about ' + fmtSigned(gain) + waitWord,
                warn: cur.stopAt !== undefined ? 'Stop at ' + n + ' trains. More puts you under the rule for ' + cur.stopReason + ' and you lose it.' : null,
            };
        } else if (cur && !here && k === cur.stat && !locked) {
            // The wrong gym: the stat the part trains is marked dashed grey, and Fill waits until you switch.
            perStat[k] = { kind: 'wait', trains: cur.left, fill: 0, fillN: cur.left, tab: 'After you switch: ' + STAT_LABEL[k] + ' × ' + cur.left, text: 'switch gyms first', sub: '' };
        } else if (cur && !here) {
            // The current part is in another gym: the strip says so in one line; Torn's boxes are left as they are
            // (owner, round 6: greying them read as "the gym is disabled"). A part already done here still says so.
            const w = mine.length && !open.length ? greyWord(k, mine, open, locked) : { text: '', tag: '' };
            perStat[k] = { kind: 'away', text: w.text, tag: w.tag };
        } else {
            const w = greyWord(k, mine, open, locked);
            perStat[k] = { kind: open.length ? 'next' : mine.length ? 'done' : w.text === 'Not trained here' ? 'none' : w.text.startsWith('Next') ? 'next' : 'skip', text: w.text, tag: w.tag };
        }
    }

    const target = cur ? gymById(cur.gymId, table) : null;
    out.target = target;
    if (cur && !here && !off) {
        const k = cur.stat;
        const label = 'Next: ' + cur.gymName + ' · ' + STAT_LABEL[k] + ' × ' + cur.left;
        out.nextGym = { id: cur.gymId, label, group: gymGroupWord(cur.gymId) };
        const dots = (g) => (g.dots[k] > 0 ? STAT_LABEL[k] + ' ' + g.dots[k] : 'no ' + STAT_LABEL[k]);
        out.switchHint = 'you’re in ' + gym.name + ' (' + dots(gym) + ') · switch to ' + cur.gymName + (target ? ' (' + dots(target) + ')' : '');
    }
    // The gym you're in: a steady outline, green when the part is here, red when it isn't.
    if (cur && !off) out.hereGym = { id: selectedId, wrong: !here, label: here ? 'Train here · ' + STAT_LABEL[cur.stat] + ' × ' + cur.left : 'Wrong gym' };

    out.strip.push(m.build.name);
    let nextGymWords = null;
    if (m.nextGym && m.nextGym.gym) {
        const ng = m.nextGym.gym;
        const k = cur ? cur.stat : STATS.reduce((a, x) => (m.shares[x] - stats[x] / total > m.shares[a] - stats[a] / total ? x : a), 'str');
        nextGymWords = ng.name + (m.nextGym.known ? ' in ' + fmtInt(m.nextGym.energyLeft) + ' E' : ' next') + ', ' + STAT_LABEL[k] + ' ' + ng.dots[k] + ' there';
        out.strip.push(nextGymWords);
    }

    // The strip's one line: its colour, a bold head, the words, a small source; a link for an overdose.
    const b = state.boost;
    const finish = b && b.deadline ? 'finish before ' + tornClock(b.deadline) : null;
    const what = b ? (b.jump ? 'Jump' : 'Boost') : null;
    if (state.kind === 'stacking') {
        out.line = { tone: 'amber', head: 'Stacking for a chain', text: 'training paused · no train marks until you resume', src: null };
        out.pill = 'Stacking for a chain · training paused';
    } else if (state.kind === 'overdose') {
        out.line = { tone: 'amber', head: 'Overdosed', text: 'happy and energy went to 0 · no training now · fly to Switzerland for rehab, about $' + fmtInt(REHAB_COST) + ' a session · the plan is worked out again after rehab', src: null, link: { text: 'Open Travel', href: TRAVEL_URL } };
        out.pill = 'Overdosed · fly to Switzerland';
    } else if (state.kind === 'wrong') {
        out.line = { tone: 'red', head: 'Wrong gym', text: out.switchHint + (b && !b.ready ? ' · eat first: ' + eatOrder(b) : ''), src: null };
        out.pill = 'Wrong gym · switch to ' + cur.gymName;
    } else if (state.kind === 'eat') {
        out.line = { tone: 'red', head: what + ': eat first', text: eatOrder(b), src: finish };
        out.pill = 'Eat first · ' + (b.list.find((x) => x.next) || { text: 'the boosters' }).text;
    } else if (state.kind === 'ready') {
        out.line = { tone: 'green', head: what + ' ready' + (reads.happy && Number.isFinite(reads.happy.current) ? ' · happy ' + fmtInt(reads.happy.current) : ''), text: 'train it all' + (b.list.some((x) => x.id === 'refill') ? ', then the refill' : ''), src: finish };
        out.pill = 'Train it all · ' + STAT_LABEL[cur.stat] + ' × ' + cur.left;
    } else if (state.kind === 'right') {
        out.line = { tone: 'green', head: 'Train ' + STAT_LABEL[cur.stat] + ' × ' + cur.left + ' here', text: [gym.name, m.build.name].join(' · '), src: nextGymWords };
        out.pill = 'Train ' + STAT_LABEL[cur.stat] + ' × ' + cur.left;
    } else if (state.kind === 'done') {
        out.line = { tone: 'plain', head: 'Session done', text: m.build.name, src: nextGymWords };
        out.pill = 'Session done';
    } else {
        out.pill = energy < gym.energy ? 'Energy ' + fmtInt(energy) + ' · wait for the next step' : null;
        out.line = { tone: 'plain', head: out.pill || 'Nothing to train now', text: m.build.name, src: nextGymWords };
    }
    return out;
}

/**
 * The panel on the gym page, from planGymPage's state (overlays.html §6): its colour, a small title, the big step,
 * one muted line, a checklist on a jump or boost, and its one action.
 * @returns {{tone, title, step, sub, checklist:{text, done, next}[]|null, action:{text, href}|null}|null} null: the usual panel
 */
export function gymPanel(plan) {
    const st = plan && plan.state;
    if (!st) return null;
    const cur = plan.current;
    const b = st.boost;
    const when = b && b.deadline ? 'finish before ' + tornClock(b.deadline) : null;
    const what = b ? (b.jump ? 'Jump' : 'Boost') : '';
    if (st.kind === 'overdose') return { tone: 'amber', title: 'Overdosed', step: 'Fly to Switzerland', sub: 'Rehab there: about $' + fmtInt(st.cost) + ' a session. The plan is worked out again after rehab.', checklist: null, action: { text: 'Open Travel', href: TRAVEL_URL } };
    if (st.kind === 'stacking') return { tone: 'amber', title: 'Stacking', step: 'Stacking for a chain', sub: 'Training paused · no train marks until you resume', checklist: null, action: null };
    if (st.kind === 'wrong') {
        const g = plan.gym;
        const t = plan.target || gymById(cur.gymId);
        const k = cur.stat;
        const there = STAT_LABEL[k] + ' trains at ' + (t ? t.dots[k] : '?') + ' there';
        const sub = g && t && g.dots[k] > 0 ? there + ', ' + g.dots[k] + ' here: ' + (t.dots[k] / g.dots[k]).toFixed(1) + '× the gain for the same energy' : there + ', not at all here';
        return { tone: 'red', title: 'Wrong gym', step: 'Switch to ' + cur.gymName, sub, checklist: b && !b.ready ? b.list : null, action: null };
    }
    if (st.kind === 'eat') return { tone: 'red', title: what + (b.deadline ? ' · ' + tornClock(b.deadline) : ''), step: (b.list.find((x) => x.next) || { text: 'Eat first' }).text, sub: [when, 'seen from your bars'].filter(Boolean).join(' · '), checklist: b.list, action: null };
    if (st.kind === 'ready') return { tone: 'green', title: what + ' · now', step: 'Train it all: ' + STAT_LABEL[cur.stat] + ' × ' + cur.left, sub: [when, 'about ' + fmtSigned(Math.round(b.gain))].filter(Boolean).join(' · '), checklist: b.list, action: null };
    if (st.kind === 'right') return { tone: 'green', title: 'Now', step: 'Train ' + STAT_LABEL[cur.stat] + ' × ' + cur.left, sub: [cur.gymName, plan.perStat[cur.stat] && plan.perStat[cur.stat].gain ? 'about ' + fmtSigned(plan.perStat[cur.stat].gain) : null].filter(Boolean).join(' · '), checklist: null, action: null };
    return null;
}

/* ------------------------------------------------ Home and Plan lines */

/** The first step that trains (its parts say which gym for which stat right now). */
export function firstTrainStep(m) {
    return (m.steps || []).find((s) => s.parts && s.parts.length) || null;
}

/**
 * "Train in": which gym for which stat right now, from the next training
 * step, e.g. [{gymName:"George's", stats:['STR']}, {gymName:'Balboas Gym', stats:['DEX']}].
 * Without a planned train today, each stat under its share at its best gym.
 */
export function trainIn(m) {
    const step = firstTrainStep(m);
    const out = [];
    const add = (gymName, k) => {
        let g = out.find((x) => x.gymName === gymName);
        if (!g) out.push((g = { gymName, stats: [] }));
        if (!g.stats.includes(STAT_LABEL[k])) g.stats.push(STAT_LABEL[k]);
    };
    if (step) for (const p of step.parts) add(p.gymName, p.stat);
    else {
        const total = totalOf(m.pc.stats);
        for (const k of STATS) if (m.pc.best[k] && total > 0 && m.pc.stats[k] / total < m.shares[k]) add(m.pc.best[k].name, k);
    }
    return out;
}

/** "George's for STR · Balboas Gym for DEX" */
export function trainInText(m) {
    return trainIn(m).map((g) => g.gymName + ' for ' + g.stats.join(', ')).join(' · ');
}

/**
 * The "why" when the next session mixes stats (owner, 2026-09-29): "STR + DEX this session: +20% toward
 * Hank's vs STR only". Toward the build = stat points that close a gap to the build's shares (points past a
 * stat's share count nothing). The one-stat way puts the whole session's energy into the stat the mix trains
 * most, at its rate in this session. Null for a one-stat session or when the mix isn't ahead by half a percent.
 */
export function whyMix(m) {
    const step = firstTrainStep(m);
    if (!step || !m.pc || !m.shares) return null;
    const by = {};
    const order = [];
    for (const p of step.parts) {
        if (!by[p.stat]) {
            by[p.stat] = { gain: 0, energy: 0 };
            order.push(p.stat);
        }
        by[p.stat].gain += p.gain || 0;
        by[p.stat].energy += p.energy || 0;
    }
    if (order.length < 2) return null;
    const top = order.reduce((a, b) => (by[b].energy > by[a].energy ? b : a));
    const total = totalOf(m.pc.stats);
    const gap = (k) => Math.max(0, (m.shares[k] || 0) * total - (m.pc.stats[k] || 0));
    const energy = order.reduce((a, k) => a + by[k].energy, 0);
    const mix = order.reduce((a, k) => a + Math.min(by[k].gain, gap(k)), 0);
    const one = by[top].energy > 0 ? Math.min((by[top].gain / by[top].energy) * energy, gap(top)) : 0;
    if (!(one > 0) || !(mix > one)) return null;
    const pct = (100 * (mix - one)) / one;
    if (pct < 0.5) return null;
    const name = (m.build && m.build.base && BUILDS[m.build.base] ? BUILDS[m.build.base].name : (m.build && m.build.name) || 'your build').replace(/, .*$/, '');
    const text = order.map((k) => STAT_LABEL[k]).join(' + ') + ' this session: +' + (pct < 10 ? pct.toFixed(1) : Math.round(pct)) + '% toward ' + name + ' vs ' + STAT_LABEL[top] + ' only';
    return { stats: order, top, pct, mix: Math.round(mix), one: Math.round(one), text, title: 'Stat points that close a gap to ' + name + '’s shares (points past a stat’s share don’t count): about ' + fmtSigned(Math.round(mix)) + ' this way, ' + fmtSigned(Math.round(one)) + ' with ' + STAT_LABEL[top] + ' only, the same energy' };
}

/**
 * The "why" when the next session trains one stat only: "Training STR only:
 * 6 pts under Hank's, about 9 days to catch up". Null when it mixes stats.
 */
export function whyOneStat(m) {
    const step = firstTrainStep(m);
    if (!step) return null;
    const stats = [...new Set(step.parts.map((p) => p.stat))];
    if (stats.length !== 1) return null;
    const k = stats[0];
    const total = totalOf(m.pc.stats);
    const pts = total > 0 ? (m.shares[k] - m.pc.stats[k] / total) * 100 : 0;
    const name = (m.build.base && BUILDS[m.build.base] ? BUILDS[m.build.base].name : m.build.name).replace(/, .*$/, '');
    const days = m.buildCatchUp ? m.buildCatchUp[k] : undefined;
    const ptsText = pts >= 1 ? Math.round(pts) + ' pts' : pts > 0 ? pts.toFixed(1) + ' pts' : null;
    let text = 'Training ' + STAT_LABEL[k] + ' only: ' + (ptsText ? ptsText + ' under ' + name : 'it is the one ' + name + ' needs now');
    if (ptsText && days !== undefined) text += days === null ? ', more than 30 days to catch up' : days > 0 ? ', about ' + days + ' day' + (days === 1 ? '' : 's') + ' to catch up' : '';
    return { stat: k, pts, days: days === undefined ? null : days, text };
}
