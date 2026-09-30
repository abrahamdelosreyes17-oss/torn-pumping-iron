/*
 * The long plan (round 6, R6.5; docs/research-year-events.md §5,
 * research-gym-unlock.md): 3, 6 or 12 months simulated day by day with the
 * same 5-minute simulator, in segments. At each segment's start the plans
 * are compared again from the stats projected for that day and the best one
 * is followed (stats grow, so the best plan changes):
 *   - a segment every 30 days;
 *   - an event gets its own segment, from 2 days before it (a jump stacks in
 *     ~29 h) to its end, with its multiplier (World Diabetes Day's candy ×3,
 *     CaffeineCon's cans ×2, the Anniversary's free energy and happy);
 *   - gyms open as energy is trained (the ladder's gym experience, its fee
 *     paid), specialists after their ladder gym (Balboas and Frontline after
 *     Cha Cha's, Sports Science Lab after Last Round, the rest after George's)
 *     and only while their stat rule holds.
 * A year compounds model error, so it also gives a band: the same path with
 * the gain model 5% lower and 10% more happy lost per train, and the other
 * way round. The monthly steps are what you follow; the year is a range.
 * Pure (compareStrategies is pure).
 */

import { STATS, totalOf } from './gain.js';
import { DAY } from './bars.js';
import { GEORGES, gymsOpenAt, bestGymFor, gymById, unlockEnergyAfter } from './gyms.js';
import { simulateStrategy } from './strategies.js';
import { recommend } from './recommend.js';
import { budgetOf } from './auto.js';

/** Plans are compared again this often (simulated days). */
export const REPICK_DAYS = 30;

/** An event segment starts this long before the event (a jump's stack: 4 Xanax ~29 h, and the booster hold). */
export const EVENT_LEAD_MS = 2 * DAY;

/** The band: the gain model this much off, and happy lost per train this much off (research: ±10% happy loss moved a year −8%…+39%). */
export const BAND_GAIN = 0.05;
export const BAND_HAPPY_LOSS = 0.1;

/** Segment boundaries: every REPICK_DAYS, and each event's lead-in and end (ms, from start to end). */
export function segmentsOf(start, end, events = []) {
    const cuts = new Set([start, end]);
    for (let t = start + REPICK_DAYS * DAY; t < end; t += REPICK_DAYS * DAY) cuts.add(t);
    for (const e of events) {
        const a = Math.max(start, Math.floor((e.start - EVENT_LEAD_MS) / DAY) * DAY);
        const b = Math.min(end, Math.ceil(e.end / DAY) * DAY);
        if (b > start && a < end) {
            cuts.add(a);
            cuts.add(b);
        }
    }
    const list = [...cuts].sort((x, y) => x - y);
    // A sliver under 3 days joins its neighbour (a 30-day cut right before an event's lead-in).
    const out = [];
    for (let i = 0; i < list.length - 1; i++) {
        const seg = { from: list[i], to: list[i + 1] };
        const isEvent = events.some((e) => e.start < seg.to && e.end > seg.from && seg.from >= Math.floor((e.start - EVENT_LEAD_MS) / DAY) * DAY - 1);
        const prev = out[out.length - 1];
        if (prev && seg.to - seg.from < 3 * DAY && !isEvent && !prev.event) prev.to = seg.to;
        else out.push({ ...seg, event: isEvent });
    }
    return out.map((s) => ({ ...s, days: Math.round((s.to - s.from) / DAY) })).filter((s) => s.days > 0);
}

/** The events inside a span, in the simulator's minutes from its start. */
export function segEvents(events, seg) {
    return events
        .filter((e) => e.start < seg.to && e.end > seg.from)
        .map((e) => ({ from: Math.max(0, Math.round((e.start - seg.from) / 60000)), to: Math.round((e.end - seg.from) / 60000), candyMult: e.candyMult || 1, canMult: e.canMult || 1, freeEnergy: e.freeEnergy || 0, freeHappy: e.freeHappy || 0, id: e.id }));
}

/** Each stat's gym (per stat {dots, energy}) with these gyms open and these stats (specialists only while their rule holds). */
function gymsFor(stats, open, { table, active, drugsTaken }) {
    const best = {};
    const gyms = {};
    for (const k of STATS) {
        best[k] = bestGymFor(k, stats, open, { table, drugsTaken, active });
        if (best[k]) gyms[k] = { dots: best[k].dots[k], energy: best[k].energy };
    }
    return { best, gyms };
}

/**
 * The ladder still to climb (gym experience = energy trained, any gym): a
 * stateless helper the simulator asks when a step's energy is reached.
 */
export function unlockHook({ top, progress, gymExpMult, table, active, drugsTaken, known }) {
    if (!(top >= 1 && top < GEORGES)) return null;
    const steps = [];
    let acc = -Math.max(0, progress || 0);
    for (let id = top; id < GEORGES; id++) {
        const e = unlockEnergyAfter(id, gymExpMult);
        if (e === null) break;
        acc += e;
        steps.push({ gymId: id + 1, at: acc });
    }
    if (!steps.length) return null;
    return {
        left: Math.max(1, steps[0].at),
        next(S, trained) {
            let i = -1;
            for (let j = 0; j < steps.length; j++) if (steps[j].at <= trained) i = j;
            if (i < 0) return null;
            const gymTop = steps[i].gymId;
            const open = [...new Set([...gymsOpenAt(gymTop), ...(known || [])])];
            const g = gymById(gymTop, table);
            return { gymId: gymTop, cost: g ? g.cost : 0, gyms: gymsFor(S, open, { table, active, drugsTaken }).gyms, left: i + 1 < steps.length ? steps[i + 1].at - steps[i].at : Infinity };
        },
    };
}

/**
 * The projection, in slices (a generator: one comparison per step; the caller
 * pauses between them, like compareStrategiesAsync).
 * @param {object} o
 * @param {function} o.compare - (args) → a generator like model.js compareSteps (yields between plans, returns the comparison)
 * @param {object} o.args - compareStrategies' arguments now ({state, pc, shares, settings, prices, special, statics, pickBy})
 * @param {number} o.start - the plan's first day (ms)
 * @param {number} o.end
 * @param {number} o.budgetPerDay - Infinity: none
 * @param {object[]} [o.events] - eventsBetween() for the span
 * @param {object} [o.progress] - {top: highest ladder gym open, energy: gym experience toward the next}
 * @param {string|null} [o.goal] - recommend's goal ('unlock')
 * @returns {Generator} whose value is {segments, result, band, unlocks, events}
 */
export function* yearSteps({ compare, args, start, end, budgetPerDay = Infinity, events = [], progress = null, goal = null }) {
    const pc0 = args.pc;
    const table = pc0.table;
    const gymExpMult = (pc0.perks && pc0.perks.gymExpMult) || 1;
    const active = args.state.gymId;
    let stats = { ...pc0.stats };
    const knownSpecialists = (pc0.unlocked || []).filter((id) => id > GEORGES);
    let top = Math.max(1, ...(pc0.unlocked || []).filter((id) => id <= GEORGES));
    let toNext = progress && Number(progress.top) === top ? Number(progress.energy) || 0 : 0;
    const segs = segmentsOf(start, end, events);
    const out = [];
    const daily = [];
    const perStat = { str: 0, spd: 0, def: 0, dex: 0 };
    const used = {};
    const unlocks = [];
    let cost = 0;
    let energy = 0;
    const startTotal = totalOf(stats);
    for (const seg of segs) {
        yield seg;
        const open = [...new Set([...gymsOpenAt(top), ...knownSpecialists])];
        const { best } = gymsFor(stats, open, { table, active, drugsTaken: null });
        const pc = { ...pc0, stats: { ...stats }, unlocked: open, best };
        const state = { ...args.state, stats: { ...stats } };
        const unlock = unlockHook({ top, progress: toNext, gymExpMult, table, active, known: knownSpecialists });
        const segArgs = { ...args, state, pc, settings: { ...args.settings, horizonDays: seg.days, budget: Number.isFinite(budgetPerDay) ? budgetPerDay * seg.days : Infinity }, events: segEvents(events, seg), unlock };
        const cmp = yield* compare(segArgs);
        const rec = recommend(cmp, { budget: budgetOf(segArgs.settings), bliss: pc.perks.bliss, pickBy: args.pickBy || 'most', goal });
        const r = cmp[rec.recommended];
        if (!r) break;
        const base = totalOf(stats) - startTotal;
        for (const v of r.daily) daily.push(Math.round(base + v));
        for (const k of STATS) {
            stats[k] += r.perStat[k] || 0;
            perStat[k] += r.perStat[k] || 0;
        }
        for (const [id, n] of Object.entries(r.used || {})) if (typeof n === 'number') used[id] = (used[id] || 0) + n;
        cost += r.cost;
        energy += r.energyTrained || 0;
        // The ladder: what this segment's energy opened (the simulator switched gyms when it did).
        for (const u of r.unlocked || []) unlocks.push({ gymId: u.gymId, day: Math.round((seg.from - start) / DAY) + Math.floor((u.at / Math.max(1, r.energyTrained || 1)) * seg.days), cost: u.cost });
        ({ top, toNext } = climb(top, toNext, r.energyTrained || 0, gymExpMult));
        out.push({ from: seg.from, to: seg.to, days: seg.days, event: seg.event ? segEvents(events, seg).map((e) => e.id) : null, strategy: rec.recommended, gained: r.gained, cost: r.cost, energy: r.energyTrained || 0, statsEnd: { ...stats }, candy: r.candy || null, refill: r.refill, alternatives: rec.alternatives.slice(0, 3).map((a) => ({ id: a.id, deltaStatsPct: a.deltaStatsPct })) });
    }
    const result = { id: 'year', gained: Math.round(totalOf(stats) - startTotal), perStat: Object.fromEntries(STATS.map((k) => [k, Math.round(perStat[k])])), cost: Math.round(cost), energyTrained: energy, daily, used, unlocks };
    yield 'band';
    const band = yearBand(out, args, { start, events, progress, gymExpMult, knownSpecialists, table, active, top0: Math.max(1, ...(pc0.unlocked || []).filter((id) => id <= GEORGES)), toNext0: progress && Number(progress.top) === Math.max(1, ...(pc0.unlocked || []).filter((id) => id <= GEORGES)) ? Number(progress.energy) || 0 : 0 });
    return { segments: out, result, band, unlocks, events };
}

/** Gym experience: the ladder gym reached after training `energy` more, and the progress toward the next. */
export function climb(top, toNext, energy, gymExpMult = 1) {
    let t = top;
    let left = (toNext || 0) + energy;
    while (t < GEORGES) {
        const need = unlockEnergyAfter(t, gymExpMult);
        if (need === null || left < need) break;
        left -= need;
        t++;
    }
    return { top: t, toNext: t < GEORGES ? left : 0 };
}

/** The same path (the plan picked for each segment) with the model a little off each way: low and high year totals. */
function yearBand(segments, args, { start, events, gymExpMult, knownSpecialists, table, active, top0, toNext0 }) {
    const run = (gainMult, lossMult) => {
        let stats = { ...args.pc.stats };
        let top = top0;
        let toNext = toNext0;
        const t0 = totalOf(stats);
        for (const s of segments) {
            const open = [...new Set([...gymsOpenAt(top), ...knownSpecialists])];
            const { gyms } = gymsFor(stats, open, { table, active, drugsTaken: null });
            const perks = Object.fromEntries(STATS.map((k) => [k, ((args.pc.perks.mult && args.pc.perks.mult[k]) || 1) * gainMult]));
            const unlock = unlockHook({ top, progress: toNext, gymExpMult, table, active, known: knownSpecialists });
            const r = simulateStrategy(s.strategy, {
                stats,
                target: args.shares,
                gyms,
                perks,
                happyMax: args.state.happy.maximum,
                energyMax: args.state.energy.maximum,
                fastEnergy: args.state.energy.interval <= 600,
                days: s.days,
                prices: {},
                happyLossMult: (args.pc.perks.happyLossMult || 1) * lossMult,
                bliss: args.pc.perks.bliss,
                candyId: s.candy ? s.candy.id : undefined,
                candyCount: s.candy ? s.candy.count : undefined,
                events: segEvents(events, s),
                unlock,
            });
            stats = { ...stats };
            for (const k of STATS) stats[k] += r.perStat[k] || 0;
            ({ top, toNext } = climb(top, toNext, r.energyTrained || 0, gymExpMult));
        }
        return Math.round(totalOf(stats) - t0);
    };
    void start;
    return { low: run(1 - BAND_GAIN, 1 + BAND_HAPPY_LOSS), high: run(1 + BAND_GAIN, 1 - BAND_HAPPY_LOSS) };
}
