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
import { GEORGES, SSL, gymsOpenAt, bestGymFor, gymById, unlockEnergyAfter } from './gyms.js';
import { simulateStrategy, STAT_LINE_DAILY_DAYS } from './strategies.js';
import { statCurveAt, statLineFrom } from './planline.js';
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
    if (!(end > start)) return [];
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
    const segs = [];
    for (let i = 0; i < list.length - 1; i++) {
        const seg = { from: list[i], to: list[i + 1] };
        seg.event = events.some((e) => e.start < seg.to && e.end > seg.from && seg.from >= Math.floor((e.start - EVENT_LEAD_MS) / DAY) * DAY - 1);
        segs.push(seg);
    }
    // A plain sliver under 3 days joins the stretch before it (the first one, the stretch after): a plan re-picked
    // over a day or two can't even finish a jump's stack.
    const out = [];
    for (const seg of segs) {
        const prev = out[out.length - 1];
        if (!seg.event && seg.to - seg.from < 3 * DAY && prev) prev.to = seg.to;
        else out.push({ ...seg });
    }
    if (out.length > 1 && !out[0].event && out[0].to - out[0].from < 3 * DAY) {
        out[1].from = out[0].from;
        out.shift();
    }
    return out.map((x) => ({ ...x, days: Math.round((x.to - x.from) / DAY) })).filter((x) => x.days > 0);
}

/** The events inside a span, in the simulator's minutes from its start. */
export function segEvents(events, seg) {
    return events
        .filter((e) => e.start < seg.to && e.end > seg.from)
        .map((e) => ({ from: Math.max(0, Math.round((e.start - seg.from) / 60000)), to: Math.round((e.end - seg.from) / 60000), candyMult: e.candyMult || 1, canMult: e.canMult || 1, freeEnergy: e.freeEnergy || 0, freeHappy: e.freeHappy || 0, id: e.id }));
}

/** Gyms open with the ladder at `top`: its gyms, the specialists it opens (not Sports Science Lab: its ≤ 150 Xanax + Ecstasy rule fails for any plan that takes Xanax), and specialists you already joined. */
export function openAt(top, known = []) {
    return [...new Set([...gymsOpenAt(top).filter((id) => id !== SSL), ...known])].sort((a, b) => a - b);
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

/** Specialist memberships a gym choice needs that aren't paid yet: [{id, cost}]. */
function newMemberships(best, paid, table) {
    const out = [];
    for (const g of Object.values(best || {})) if (g && g.id > GEORGES && !paid.has(g.id) && !out.some((x) => x.id === g.id)) out.push({ id: g.id, cost: (gymById(g.id, table) || {}).cost || 0 });
    return out;
}

/**
 * The ladder still to climb (gym experience = energy trained, any gym): a
 * helper the simulator asks when a step's energy is reached. `memo` is one
 * run's own (the specialists that run has joined), so plans compared side by
 * side don't share it. The ladder gym's fee and a specialist's membership are
 * paid when they're first used.
 */
export function unlockHook({ top, progress, gymExpMult, table, active, drugsTaken, known, paid = new Set(), stopAt = GEORGES }) {
    if (!(top >= 1 && top < GEORGES)) return null;
    const steps = [];
    let acc = -Math.max(0, progress || 0);
    // `stopAt` (round 7, "is this gym worth opening"): the ladder stops there, as if the next gym were never bought.
    for (let id = top; id < Math.min(GEORGES, stopAt); id++) {
        const e = unlockEnergyAfter(id, gymExpMult);
        if (e === null) break;
        acc += e;
        steps.push({ gymId: id + 1, at: acc });
    }
    if (!steps.length) return null;
    return {
        left: Math.max(1, steps[0].at),
        next(S, trained, memo = {}) {
            let i = -1;
            for (let j = 0; j < steps.length; j++) if (steps[j].at <= trained) i = j;
            if (i < 0) return null;
            const gymTop = steps[i].gymId;
            const open = openAt(gymTop, known || []);
            const g = gymById(gymTop, table);
            const { best, gyms } = gymsFor(S, open, { table, active, drugsTaken });
            memo.paid = memo.paid || new Set(paid);
            const joined = newMemberships(best, memo.paid, table);
            for (const x of joined) memo.paid.add(x.id);
            return { gymId: gymTop, cost: (g ? g.cost : 0) + joined.reduce((a, x) => a + x.cost, 0), joined: joined.map((x) => x.id), gyms, left: i + 1 < steps.length ? steps[i + 1].at - steps[i].at : Infinity };
        },
    };
}

/** What's left of today's one-off resources after a stretch (held boosters, special refills), for the next one. */
function carryOver(args, r) {
    const usedHeld = (r.used && r.used.held) || {};
    const inv = { ...((args.statics && args.statics.inventory) || {}) };
    for (const [id, n] of Object.entries(usedHeld)) inv[id] = Math.max(0, (Number(inv[id]) || 0) - n);
    // used.special counts every special refill (the daily one too); dailySpecial the daily ones among them.
    const specialUsed = (r.used && r.used.special) || 0;
    const extraUsed = Math.max(0, specialUsed - ((r.used && r.used.dailySpecial) || 0));
    const held = Math.max(0, (Number(args.state.specialRefills) || 0) - specialUsed);
    return {
        ...args,
        statics: { ...(args.statics || {}), inventory: inv },
        // The live booster cooldown is today's only; later stretches start with it spent.
        state: { ...args.state, specialRefills: args.state.specialRefills === null || args.state.specialRefills === undefined ? args.state.specialRefills : held, boosterCd: 0 },
        special: Math.max(0, (args.special || 0) - extraUsed),
    };
}

/**
 * The projection, in slices (a generator: one comparison per step; the caller
 * pauses between them, like compareStrategiesAsync).
 * @param {object} o
 * @param {function} o.compare - (args) → a generator like model.js compareSteps (yields between plans, returns the comparison)
 * @param {function} o.inputs - model.js simInputs (the band re-runs each stretch's plan with the same inputs)
 * @param {object} o.args - compareStrategies' arguments now ({state, pc, shares, settings, prices, special, statics, pickBy})
 * @param {number} o.start - the plan's first day (ms)
 * @param {number} o.end
 * @param {number} o.budgetPerDay - Infinity: none
 * @param {object[]} [o.events] - eventsBetween() for the span
 * @param {object} [o.progress] - {top: highest ladder gym open, energy: gym experience toward the next}
 * @param {boolean} [o.centre] - also re-run the path unchanged (`band.centre`: it should match the path; a check for tests)
 * @param {object|null} [o.openBy] - the gym to unlock {gymId, name, by (ms, or null)}: passed to the stretches before it opens
 * @returns {Generator} whose value is {segments, result, band, unlocks, events}
 */
export function* yearSteps({ compare, inputs = null, args, start, end, budgetPerDay = Infinity, events = [], progress = null, openBy = null, centre = false }) {
    const pc0 = args.pc;
    const table = pc0.table;
    const gymExpMult = (pc0.perks && pc0.perks.gymExpMult) || 1;
    const active = args.state.gymId;
    let stats = { ...pc0.stats };
    const knownSpecialists = (pc0.unlocked || []).filter((id) => id > GEORGES);
    // Memberships held already: the specialists you've joined (Torn's gym page lists them as unlocked).
    const paid = new Set(knownSpecialists);
    const top0 = Math.max(1, ...(pc0.unlocked || []).filter((id) => id <= GEORGES));
    let top = top0;
    const toNext0 = progress && Number(progress.top) === top0 ? Number(progress.energy) || 0 : 0;
    let toNext = toNext0;
    const segs = segmentsOf(start, end, events);
    const out = [];
    const daily = [];
    // Round 7 (Progress): when in each day the gain lands, and each stat's own line, along the whole path.
    const quart = [];
    const statDaily = { str: [], spd: [], def: [], dex: [] };
    const perStat = { str: 0, spd: 0, def: 0, dex: 0 };
    const used = {};
    const unlocks = [];
    let cost = 0;
    let energy = 0;
    let cur = args;
    const startTotal = totalOf(stats);
    for (const seg of segs) {
        yield seg;
        const open = openAt(top, knownSpecialists);
        const { best } = gymsFor(stats, open, { table, active, drugsTaken: null });
        // A specialist first used now: its membership is paid now.
        let fees = 0;
        for (const x of newMemberships(best, paid, table)) {
            fees += x.cost;
            paid.add(x.id);
        }
        const pc = { ...pc0, stats: { ...stats }, unlocked: open, best };
        const state = { ...cur.state, stats: { ...stats } };
        const unlock = unlockHook({ top, progress: toNext, gymExpMult, table, active, known: knownSpecialists, paid });
        // Only the first stretch starts from the bars as they are now; later ones from a full bar (their day isn't known).
        const segArgs = { ...cur, state, pc, settings: { ...cur.settings, horizonDays: seg.days, budget: Number.isFinite(budgetPerDay) ? Math.max(0, budgetPerDay * seg.days - fees) : Infinity }, events: segEvents(events, seg), unlock, live: Boolean(args.live) && !out.length };
        const cmp = yield* compare(segArgs);
        // The gym to unlock: only for the stretches before it opens, with what's left of its date.
        const segOpenBy = openBy && top < openBy.gymId ? { gymId: openBy.gymId, name: openBy.name || null, days: openBy.by ? Math.ceil((openBy.by - seg.from) / DAY) : null, horizon: seg.days } : null;
        const rec = recommend(cmp, { budget: budgetOf(segArgs.settings), bliss: pc.perks.bliss, pickBy: cur.pickBy || 'most', openBy: segOpenBy });
        const r = cmp[rec.recommended];
        if (!r) break;
        const base = totalOf(stats) - startTotal;
        for (const v of r.daily) daily.push(Math.round(base + v));
        if (r.quart) quart.push(...r.quart);
        else for (let d = 0; d < r.daily.length; d++) quart.push(360, 720, 1080);
        for (const k of STATS) for (let d = 1; d <= r.daily.length; d++) statDaily[k].push(Math.round(perStat[k] + statCurveAt(r.statLine, k, d * DAY)));
        for (const k of STATS) {
            stats[k] += r.perStat[k] || 0;
            perStat[k] += r.perStat[k] || 0;
        }
        for (const [id, n] of Object.entries(r.used || {})) if (typeof n === 'number') used[id] = (used[id] || 0) + n;
        cost += r.cost + fees;
        energy += r.energyTrained || 0;
        // The ladder: what this segment's energy opened (the simulator switched gyms when it did).
        for (const u of r.unlocked || []) unlocks.push({ gymId: u.gymId, day: Math.round((seg.from - start) / DAY) + Math.floor((u.at / Math.max(1, r.energyTrained || 1)) * seg.days), cost: u.cost });
        for (const u of r.unlocked || []) for (const id of u.joined || []) paid.add(id);
        ({ top, toNext } = climb(top, toNext, r.energyTrained || 0, gymExpMult));
        out.push({ from: seg.from, to: seg.to, days: seg.days, event: seg.event ? segEvents(events, seg).map((e) => e.id) : null, strategy: rec.recommended, gained: r.gained, cost: r.cost + fees, energy: r.energyTrained || 0, statsEnd: { ...stats }, candy: r.candy || null, refill: r.refill, booster: r.booster || null, ...(Number.isFinite(r.xanaxPerDay) ? { xanaxPerDay: r.xanaxPerDay } : {}), alternatives: rec.alternatives.slice(0, 3).map((a) => ({ id: a.id, deltaStatsPct: a.deltaStatsPct })) });
        cur = carryOver(cur, r);
    }
    const result = { id: 'year', gained: Math.round(totalOf(stats) - startTotal), perStat: Object.fromEntries(STATS.map((k) => [k, Math.round(perStat[k])])), cost: Math.round(cost), energyTrained: energy, daily, used, unlocks, quart, statLine: statLineFrom(statDaily, daily.length > STAT_LINE_DAILY_DAYS ? 7 : 1) };
    const band = inputs ? yield* yearBandSteps(out, args, { inputs, events, gymExpMult, knownSpecialists, table, active, top0, toNext0, centre }) : null;
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

/**
 * The same path (the plan, candy, booster and refill picked for each stretch,
 * with the simulator's own inputs) with the model a little off each way: low
 * and high totals. With `centre` the same re-run unchanged too (it should
 * match the path: a check; round 7 leaves it out of a plan's own work, a
 * third of the band's time). A generator: it yields 'band' before each
 * stretch of each run (a chance for a break).
 */
function* yearBandSteps(segments, args, { inputs, events, gymExpMult, knownSpecialists, table, active, top0, toNext0, centre = false }) {
    const run = function* (gainMult, lossMult) {
        let stats = { ...args.pc.stats };
        let top = top0;
        let toNext = toNext0;
        let cur = args;
        const paid = new Set(knownSpecialists);
        const t0 = totalOf(stats);
        for (const s of segments) {
            yield 'band';
            const open = openAt(top, knownSpecialists);
            const { best } = gymsFor(stats, open, { table, active, drugsTaken: null });
            for (const x of newMemberships(best, paid, table)) paid.add(x.id);
            const pc = { ...args.pc, stats: { ...stats }, unlocked: open, best };
            const base = inputs({ ...cur, state: { ...cur.state, stats: { ...stats } }, pc, settings: { ...cur.settings, horizonDays: s.days }, live: Boolean(args.live) && s === segments[0] });
            const o = {
                ...base,
                perks: Object.fromEntries(STATS.map((k) => [k, ((base.perks && base.perks[k]) || 1) * gainMult])),
                happyLossMult: (base.happyLossMult || 1) * lossMult,
                ...(s.candy ? { candyId: s.candy.id, candyCount: s.candy.count } : {}),
                ...(s.booster ? { energyBooster: { id: s.booster.id, perDay: s.booster.perDay } } : {}),
                ...(s.refill === false ? { noRefill: true } : {}),
                ...(Number.isFinite(s.xanaxPerDay) ? { xanaxPerDay: s.xanaxPerDay } : {}),
                special: 0,
                events: segEvents(events, s),
                unlock: unlockHook({ top, progress: toNext, gymExpMult, table, active, known: knownSpecialists, paid }),
            };
            const r = simulateStrategy(s.strategy, o);
            stats = { ...stats };
            for (const k of STATS) stats[k] += r.perStat[k] || 0;
            for (const u of r.unlocked || []) for (const id of u.joined || []) paid.add(id);
            ({ top, toNext } = climb(top, toNext, r.energyTrained || 0, gymExpMult));
            cur = carryOver(cur, r);
        }
        return Math.round(totalOf(stats) - t0);
    };
    const low = yield* run(1 - BAND_GAIN, 1 + BAND_HAPPY_LOSS);
    const mid = centre ? yield* run(1, 1) : null;
    const high = yield* run(1 + BAND_GAIN, 1 - BAND_HAPPY_LOSS);
    return { low, ...(centre ? { centre: mid } : {}), high };
}
