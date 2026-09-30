/*
 * Which pings are due, from one Torn state read and the synced plan. Pure,
 * so it's tested without Cloudflare or Discord. Every alert has an id so a
 * ping is sent once however many minutes it stays true.
 */

export const DRUG_LEAD_S = 5 * 60;
export const JUMP_LEAD_S = 5 * 60;
export const REFILL_WARN_S = 2 * 60 * 60;
export const DAY_S = 86400;
/** A drug ready this long and still unused: one nudge. */
export const DRUG_IDLE_S = 15 * 60;
/** Jump sequence steps (not strict): ping this close to their time. */
export const STEP_LEAD_S = 2 * 60;

/**
 * Energy pings this far ahead of full at most. Runs come a minute apart, so the last run
 * before full that is still 30 s ahead sends it: the ping lands 30–90 s before the tick.
 */
export const ENERGY_LEAD_S = 90;
/** The same lead for the booster cooldown. */
export const BOOSTER_LEAD_S = 90;

const clock = (s) => new Date(s * 1000).toISOString().slice(11, 16);
const clockS = (s) => new Date(s * 1000).toISOString().slice(11, 19);

const TORN = 'https://www.torn.com/';
export const LINKS = { items: TORN + 'item.php', gym: TORN + 'gym.php', points: TORN + 'points.php' };

const DRUG_STEP = (s) => s.kind === 'xanax' || s.kind === 'stack' || s.kind === 'hold';
const withTrain = (s) => s.label + (s.train ? ', then ' + s.train : '');

/** Where in Torn a step is done (the user clicks; the bot never opens it). */
export function stepLink(s) {
    if (!s) return LINKS.gym;
    if (s.kind === 'refill') return LINKS.points;
    if (s.kind === 'natural') return LINKS.gym;
    return LINKS.items;
}

/** The earliest step that is due now or overdue (up to 6 h), within `lead` seconds. */
function dueStep(plan, nowS, lead, test = () => true) {
    const steps = (plan && Array.isArray(plan.steps) ? plan.steps : []).filter((s) => s && Number(s.at) <= nowS + lead && Number(s.at) >= nowS - 6 * 3600 && test(s));
    steps.sort((a, b) => a.at - b.at);
    return steps[0] || null;
}

/**
 * What to remember from this read for the next one (users.prev): the
 * cooldowns and travel, and since when the drug cooldown has been 0.
 */
export function nextPrev(prev, state, nowS) {
    const cd = (state && state.cooldowns) || {};
    const drug = Number(cd.drug) || 0;
    const zeroAt = drug === 0 ? (prev && Number(prev.drug) === 0 && prev.drugZeroAt ? Number(prev.drugZeroAt) : nowS) : null;
    // The "drug unused" nudge sent for this ready spell (one per spell, even after its sent row is cleaned up).
    const nudged = zeroAt !== null && prev && Number(prev.drugNudged) === zeroAt ? zeroAt : null;
    return { at: nowS, drug, booster: Number(cd.booster) || 0, travel: Number(state && state.travel && state.travel.time_left) || 0, drugZeroAt: zeroAt, drugNudged: nudged, fill: energyFill(prev, state, nowS) };
}

/**
 * When the energy bar fills (or filled), on Torn's 5-minute ticks: the
 * energy ping's id, so the early ping and the "full" read after are one
 * ping, and every new fill is a new one. Full now: the fill the last read
 * expected (or saw), else the tick just past. Filling: now + Torn's full_time.
 * Null when neither is known.
 */
export function energyFill(prev, state, nowS) {
    const e = (state && state.bars && state.bars.energy) || {};
    if (!(Number(e.maximum) > 0)) return null;
    if (Number(e.current) >= Number(e.maximum)) {
        const was = prev ? Number(prev.fill) : NaN;
        return was > 0 && was <= nowS + 60 && nowS - was < 2 * DAY_S ? was : Math.floor(nowS / 300) * 300;
    }
    const inS = Number(e.full_time) || 0;
    return inS > 0 ? Math.round((nowS + inS) / 300) * 300 : null;
}

/** A read this old (or older) is not "the last read" any more: a paused key, a skipped day. Its transitions are not pinged. */
export const PREV_FRESH_S = 10 * 60;

/** When a timer seen last read ended (last read + what was left), in 5-minute steps. */
function eventBucket(prev, left, nowS) {
    const at = Number(prev && prev.at) || nowS;
    return Math.round((at + (Number(left) || 0)) / 300);
}

/** The first planned step at or after `nowS` matching a test. */
function nextStep(plan, nowS, test) {
    const steps = (plan && Array.isArray(plan.steps) ? plan.steps : []).filter((s) => s && Number(s.at) >= nowS - 60 && test(s));
    steps.sort((a, b) => a.at - b.at);
    return steps[0] || null;
}

/**
 * @param {object} state - Torn's answer to /v2/user?selections=bars,cooldowns,refills,travel
 * @param {object} plan - {type, steps:[{at (s), kind, label, train, strict, tick (s)}]}
 * @param {number} nowS - unix seconds
 * @param {object} [rules] - {drug, drugready, booster, energy, refill, jump, landed, stale} booleans (default all on)
 * @param {object} [ctx] - {prev: nextPrev() of the last read (+ staleFor), planStale: bool, planAge: s, planAt: s}
 * @returns {{id, kind, title, text, link, step, skip?}[]}
 */
export function dueAlerts(state, plan, nowS, rules = {}, ctx = {}) {
    const on = { drug: true, drugready: true, booster: true, energy: true, refill: true, jump: true, landed: true, stale: true, ...rules };
    const prev = ctx.prev || null;
    // A plan not synced for 12 h: pings from Torn's own state, strict jump steps still ahead
    // (a 1.0.1 client syncs only when its steps change), and one "out of date" per synced plan.
    if (ctx.planStale) plan = plan && Array.isArray(plan.steps) ? { type: plan.type, steps: plan.steps.filter((s) => s && s.strict && s.tick && Number(s.at) > nowS) } : null;
    const out = [];
    const cd = (state && state.cooldowns) || {};
    const bars = (state && state.bars) || {};
    const refills = (state && state.refills) || {};
    const traveling = Boolean(state && state.travel && Number(state.travel.time_left) > 0);

    // Drug cooldown ends within 5 minutes and the plan's next step takes a drug.
    const drug = Number(cd.drug) || 0;
    if (on.drug && drug > 0 && drug <= DRUG_LEAD_S) {
        const step = nextStep(plan, nowS, (s) => s.kind === 'xanax' || s.kind === 'stack' || s.kind === 'hold' || s.kind === 'boost' || s.kind === 'jump');
        const endS = nowS + drug;
        // A 5-minute bucket: cron runs can drift a few seconds, the ping must not repeat.
        out.push({ id: 'drug:' + Math.round(endS / 300), kind: 'drug', link: LINKS.items, title: 'Drug cooldown ends in ' + Math.max(1, Math.round(drug / 60)) + ' min', text: step ? step.label + (step.train ? ', then ' + step.train : '') : 'Ready for the next drug', step: step || null });
    }

    // Energy full while the plan trains natural energy (not while stacking for a jump); ahead of time when Torn's
    // full_time says it fills before the next run is ENERGY_LEAD_S early (owner: the ping came ~50 s after the tick).
    const e = bars.energy || {};
    const stacking = plan && plan.type === 'jump';
    const full = Number(e.maximum) > 0 && Number(e.current) >= Number(e.maximum);
    const fullIn = full ? 0 : Number(e.full_time) || 0;
    if (on.energy && !stacking && Number(e.maximum) > 0 && (full || (fullIn > 0 && fullIn <= ENERGY_LEAD_S))) {
        const step = nextStep(plan, nowS, (s) => s.kind === 'natural' || !!s.train);
        // The id is the fill (on Torn's 5-minute ticks, see energyFill), and every hour it stays full after it: the
        // early ping and the next run's "full" are one ping, a new fill is a new one, and a full bar is re-pinged hourly.
        const fullAt = energyFill(prev, state, nowS);
        const hours = nowS > fullAt ? Math.floor((nowS - fullAt) / 3600) : 0;
        const inS = Math.max(1, fullAt - nowS);
        out.push({ id: 'energy:' + Math.round(fullAt / 300) + ':' + hours, kind: 'energy', link: LINKS.gym, title: full ? 'Energy is full' : 'Energy full in ' + inS + ' s (' + clockS(fullAt) + ' TCT)', text: step && step.train ? 'Train ' + step.train : 'Train your energy so none is wasted', step: step || null, skip: false, fullAt: full ? nowS : fullAt });
    }

    // Refill unused, two hours before Torn midnight (UTC).
    const toMidnight = DAY_S - (nowS % DAY_S);
    // The plan left the points refill out (not worth its price for this player): no nudge to use it.
    if (on.refill && refills.energy === false && toMidnight <= REFILL_WARN_S && !(plan && plan.noRefill)) {
        out.push({ id: 'refill:' + Math.floor(nowS / DAY_S), kind: 'refill', link: LINKS.points, title: 'Refill unused', text: 'Use it before 00:00 Torn time (' + Math.round(toMidnight / 60) + ' min left)', step: null });
    }

    // A strict jump step: 5 minutes before its tick.
    if (on.jump) {
        for (const s of (plan && plan.steps) || []) {
            if (!s || !s.strict || !s.tick) continue;
            const lead = s.tick - nowS;
            if (lead > 0 && lead <= JUMP_LEAD_S) out.push({ id: 'jump:' + s.tick, kind: 'jump', link: LINKS.items, title: 'Jump in ' + Math.max(1, Math.round(lead / 60)) + ' min', text: s.label + ', right after the ' + clock(s.tick) + ' tick', step: s });
        }
    }

    // Jump sequence steps that aren't tied to a tick: when their time comes.
    if (on.jump) {
        for (const s of (plan && plan.steps) || []) {
            if (!s || s.strict || (s.kind !== 'boost' && s.kind !== 'jump')) continue;
            const lead = Number(s.at) - nowS;
            if (lead <= STEP_LEAD_S && lead > -60) out.push({ id: 'step:' + s.at + ':' + s.kind, kind: 'step', link: LINKS.items, title: (s.kind === 'boost' ? 'Boost' : 'Jump') + ' step ' + (lead > 60 ? 'in ' + Math.round(lead / 60) + ' min' : 'now'), text: withTrain(s), step: s });
        }
    }

    // Is a synced plan in use? Out of date (the laptop closed for long) or never synced, the bot can't tell which
    // boosts and drugs the plan wants, so those pings come every time (owner, 2026-09-30).
    // A synced plan with nothing left ahead (an empty list, every step past) says nothing either.
    const planInUse = Boolean(!ctx.planStale && plan && Array.isArray(plan.steps) && plan.steps.some((s) => s && Number(s.at) >= nowS - 60));
    // Transitions ("over", "landed") only from a recent read: after a paused key or a long gap it's old news.
    const prevFresh = Boolean(prev && nowS - Number(prev.at) <= PREV_FRESH_S);

    // Booster cooldown ending within BOOSTER_LEAD_S (the ping lands 30–90 s ahead, like energy), or just over when no
    // read saw it inside that window (a missed run). With a plan in use, only when a boost or jump step is next.
    const booster = Number(cd.booster) || 0;
    const prevB = prev ? Number(prev.booster) || 0 : 0;
    const boosterSoon = booster > 0 && booster <= BOOSTER_LEAD_S && !(prevB > 0 && prevB <= BOOSTER_LEAD_S);
    const boosterOver = booster === 0 && prevB > BOOSTER_LEAD_S && prevFresh && Number(prev.at) + prevB >= nowS - PREV_FRESH_S;
    if (on.booster && (boosterSoon || boosterOver)) {
        const step = nextStep(plan, nowS, (s) => s.kind === 'boost' || s.kind === 'jump');
        // The id is the Torn event (when the cooldown ends), so a replayed run can't ping twice.
        const readyAt = boosterSoon ? nowS + booster : Number(prev.at) + prevB;
        if (step || !planInUse) out.push({ id: 'booster:' + Math.round(readyAt / 300), kind: 'booster', link: LINKS.items, title: boosterSoon ? 'Booster cooldown ends in ' + booster + ' s' : 'Booster cooldown is over', text: step ? withTrain(step) : 'Room for a candy, energy drink, FHC or EDVD', step: step || null, readyAt });
    }

    // Drug ready for 15 minutes, unused: one nudge per ready spell. With a plan in use, only when a drug step is due.
    // Once per spell: prev.drugNudged remembers it (its sent row is cleaned up after 2 days; the spell can last longer).
    if (on.drugready && drug === 0 && prev && prev.drugZeroAt && nowS - Number(prev.drugZeroAt) >= DRUG_IDLE_S && Number(prev.drugNudged) !== Number(prev.drugZeroAt)) {
        const step = dueStep(plan, nowS, 60, DRUG_STEP);
        if (step || !planInUse) out.push({ id: 'drugready:' + prev.drugZeroAt, kind: 'drugready', link: LINKS.items, title: 'Drug ready for ' + Math.round((nowS - Number(prev.drugZeroAt)) / 60) + ' min, unused', text: step ? withTrain(step) : 'Your next Xanax, if you train today (open Pumping Iron for the plan)', step: step || null });
    }

    // Back from travel with a step waiting.
    if (on.landed && prevFresh && Number(prev.travel) > 0 && !traveling) {
        const step = dueStep(plan, nowS, 10 * 60);
        if (step) out.push({ id: 'landed:' + eventBucket(prev, prev.travel, nowS), kind: 'landed', link: stepLink(step), title: 'Back in Torn', text: 'Next: ' + withTrain(step), step });
    }

    if (on.stale && ctx.planStale && ctx.planAge && !(prev && ctx.planAt && Number(prev.staleFor) === Number(ctx.planAt))) {
        out.push({ id: 'stale:' + (ctx.planAt || Math.floor(nowS / DAY_S)), kind: 'stale', link: null, title: 'Plan out of date', text: 'Last synced ' + Math.round(ctx.planAge / 3600) + ' h ago. Open Pumping Iron so it sends your plan; until then only timer pings come.', step: null });
    }

    if (traveling) for (const a of out) a.text += ' (you’re flying)';
    return out;
}

/**
 * Has Torn's state closed this ping? (The user did the thing: a new drug
 * started, a booster used, energy trained, the refill used; or a jump step
 * is long past.) Used to close a ping by itself and to drop a snoozed one.
 */
export function resolvedBy(kind, state, nowS, body = {}) {
    const cd = (state && state.cooldowns) || {};
    const bars = (state && state.bars) || {};
    const e = bars.energy || {};
    if (kind === 'drug' || kind === 'drugready') return Number(cd.drug) > DRUG_LEAD_S;
    // A ping sent ahead of the end isn't closed by the cooldown still running: only by a new one after it ended.
    if (kind === 'booster') return Number(cd.booster) > 0 && !(Number(body.readyAt) > nowS);
    // A ping sent ahead of full isn't closed by energy still filling: only once the fill time has passed.
    if (kind === 'energy') return Number(e.maximum) > 0 && Number(e.current) < Number(e.maximum) && !(Number(body.fullAt) > nowS);
    if (kind === 'refill') return Boolean(state && state.refills && state.refills.energy === true);
    if (kind === 'jump' || kind === 'step' || kind === 'landed') return Boolean(body.step && nowS > Number(body.step.at) + 15 * 60);
    return false;
}

/** Discord's webhook body: the mention in `content` (embeds don't ping), only that user allowed. */
export function webhookBody(alert, discordId) {
    const id = String(discordId || '').replace(/\D/g, '');
    return {
        content: (id ? '<@' + id + '> ' : '') + alert.title.charAt(0).toLowerCase() + alert.title.slice(1),
        embeds: [{ title: alert.title, description: alert.text, color: 0xefebe2, ...(alert.link ? { url: alert.link } : {}) }],
        allowed_mentions: { users: id ? [id] : [], parse: [] },
    };
}

/** Only Discord's own webhook URLs. */
export function isDiscordWebhook(url) {
    try {
        const u = new URL(String(url));
        return u.protocol === 'https:' && /^(discord|discordapp)\.com$/.test(u.hostname) && /^\/api\/webhooks\/\d+\/[\w-]+$/.test(u.pathname);
    } catch {
        return false;
    }
}
