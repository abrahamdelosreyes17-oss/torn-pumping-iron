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
import { XANAX } from './items.js';

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

/** Energy the session still needs. */
export function sessionEnergyLeft(session) {
    return sessionProgress(session).parts.reduce((a, p) => a + p.left * p.perTrain, 0);
}

/** Start a new walk-through? (none yet, another build, too old, or clearly more energy than it needs). */
export function needsNewSession(session, reading, m, now) {
    if (!session || session.v !== 1 || !Array.isArray(session.parts) || !session.parts.length) return true;
    if (session.build !== m.build.id) return true;
    if (!(now - session.at < SESSION_MAX_MS) || now < session.at) return true;
    return Number.isFinite(reading.energy) && reading.energy - sessionEnergyLeft(session) >= NEW_SESSION_E;
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

/**
 * @param {object} m - buildModel() output
 * @param {object} page - {selectedId, boxes: [{stat, locked, energyPerTrain}]}
 * @param {object|null} [session] - the walk-through (nextSession); null = the current step, nothing done yet
 * @param {number} [now]
 * @returns {{strip:string[], parts:object[], current:object|null, done:boolean, nextGym:{id, label}|null, switchHint:string|null,
 *   perStat:object, pill:string|null, gym:object|null}}
 */
export function planGymPage(m, page = {}, session = null, now = m.now) {
    const table = m.pc.table;
    const selectedId = Number(page.selectedId || m.state.gymId);
    const gym = gymById(selectedId, table);
    const stats = m.pc.stats;
    const reading = page.reading || { stats, energy: m.strip.energy.current };
    const energy = reading.energy;
    const perStat = {};
    const out = { strip: [], parts: [], current: null, done: false, nextGym: null, switchHint: null, perStat, pill: null, gym };
    if (!gym) return out;
    if (!session) {
        const step = currentTrainStep(m, now);
        session = step ? startSession(step, reading, m, now) : null;
    }
    const prog = session ? sessionProgress(session) : { parts: [], current: null, done: false };
    out.parts = prog.parts;
    out.current = prog.current;
    out.done = Boolean(session) && prog.done;
    const cur = prog.current;
    const here = cur && cur.gymId === selectedId;

    const total = totalOf(stats);
    const tomorrow = (m.projection && m.projection[1]) || {};
    const boxes = new Map((page.boxes || []).map((b) => [b.stat, b]));
    const partsOfStat = (k) => prog.parts.filter((p) => p.stat === k);
    // The grey word on a box that isn't trained now.
    const greyWord = (stat, all, left, lockedHere) => {
        if (all.length && !left.length) return 'Done ✓ · ' + STAT_LABEL[stat] + ' × ' + all.reduce((a, p) => a + p.trains, 0);
        if (left.length) {
            const p = left[0];
            return p.gymId === selectedId ? 'Next · ' + STAT_LABEL[stat] + ' × ' + p.left + ' after ' + (cur ? STAT_LABEL[cur.stat] : 'this') : 'Later · ' + STAT_LABEL[stat] + ' × ' + p.left + ' at ' + p.gymName;
        }
        if (lockedHere) return 'Not trained here';
        const share = total > 0 ? stats[stat] / total : 0;
        if (share > m.shares[stat] + 0.005) return 'Skip · ' + (share * 100).toFixed(0) + '% of total, over target';
        if (tomorrow[stat] > 0) return 'Next · starts tomorrow';
        return 'Skip · not in this session';
    };

    for (const k of STATS) {
        const box = boxes.get(k);
        const locked = (box && box.locked) || !(gym.dots[k] > 0);
        const mine = partsOfStat(k);
        const open = mine.filter((p) => p.left > 0);
        if (here && k === cur.stat) {
            const n = cur.left;
            const canNow = Number.isFinite(energy) ? Math.max(0, Math.min(n, Math.floor(energy / cur.perTrain))) : n;
            const allEnergy = n * cur.perTrain > energy - cur.perTrain;
            const gain = cur.trains > 0 ? (cur.gain * n) / cur.trains : 0;
            const waitWord = canNow < n ? (canNow === 0 ? ' · energy ' + fmtInt(energy) + (session.drug ? ', take the Xanax first' : ', wait for more') : ' · ' + canNow + ' now, the rest after more energy') : '';
            perStat[k] = {
                kind: 'train',
                trains: n,
                fill: canNow,
                gain: Math.round(gain),
                text: fmtInt(n) + ' train' + (n === 1 ? '' : 's') + (cur.done > 0 ? ' left' : ''),
                sub: (allEnergy ? 'all your energy' : fmtInt(n * cur.perTrain) + ' energy') + ' · about ' + fmtSigned(gain) + waitWord,
                warn: cur.stopAt !== undefined ? 'Stop at ' + n + ' trains. More puts you under the rule for ' + cur.stopReason + ' and you lose it.' : null,
            };
        } else if (cur && !here) {
            // The current part is in another gym: every box here waits.
            perStat[k] = { kind: 'grey', text: k === cur.stat ? 'Next · ' + STAT_LABEL[k] + ' × ' + cur.left + ' at ' + cur.gymName : greyWord(k, mine, open, locked) };
        } else {
            const text = greyWord(k, mine, open, locked);
            perStat[k] = { kind: open.length ? 'next' : mine.length ? 'done' : text === 'Not trained here' ? 'none' : text.startsWith('Next') ? 'next' : 'skip', text };
        }
    }

    if (cur && !here) {
        const label = 'Next: ' + cur.gymName + ' · ' + STAT_LABEL[cur.stat] + ' × ' + cur.left;
        out.nextGym = { id: cur.gymId, label };
        out.switchHint = label;
    }

    out.strip.push(m.build.name);
    if (m.nextGym && m.nextGym.gym) {
        const ng = m.nextGym.gym;
        const k = cur ? cur.stat : STATS.reduce((a, x) => (m.shares[x] - stats[x] / total > m.shares[a] - stats[a] / total ? x : a), 'str');
        out.strip.push(ng.name + (m.nextGym.known ? ' in ' + fmtInt(m.nextGym.energyLeft) + ' E' : ' next') + ', ' + STAT_LABEL[k] + ' ' + ng.dots[k] + ' there');
    }
    if (out.done) out.pill = 'Session done';
    else if (cur && here) out.pill = 'Train ' + STAT_LABEL[cur.stat] + ' × ' + cur.left;
    else if (cur) out.pill = out.switchHint;
    else out.pill = energy < gym.energy ? 'Energy ' + fmtInt(energy) + ' · wait for the next step' : null;
    return out;
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
