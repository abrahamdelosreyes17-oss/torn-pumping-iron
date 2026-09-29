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

const clock = (s) => new Date(s * 1000).toISOString().slice(11, 16);

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
    return { at: nowS, drug, booster: Number(cd.booster) || 0, travel: Number(state && state.travel && state.travel.time_left) || 0, drugZeroAt: zeroAt };
}

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

    // Energy full while the plan trains natural energy (not while stacking for a jump).
    const e = bars.energy || {};
    const stacking = plan && plan.type === 'jump';
    if (on.energy && !stacking && Number(e.maximum) > 0 && Number(e.current) >= Number(e.maximum)) {
        const step = nextStep(plan, nowS, (s) => s.kind === 'natural' || !!s.train);
        out.push({ id: 'energy:' + Math.floor(nowS / 3600), kind: 'energy', link: LINKS.gym, title: 'Energy is full', text: step && step.train ? 'Train ' + step.train : 'Train your energy so none is wasted', step: step || null, skip: false });
    }

    // Refill unused, two hours before Torn midnight (UTC).
    const toMidnight = DAY_S - (nowS % DAY_S);
    if (on.refill && refills.energy === false && toMidnight <= REFILL_WARN_S) {
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

    // Booster cooldown just ended and the plan has a booster step next.
    const booster = Number(cd.booster) || 0;
    if (on.booster && prev && Number(prev.booster) > 0 && booster === 0) {
        const step = nextStep(plan, nowS, (s) => s.kind === 'boost' || s.kind === 'jump');
        // The id is the Torn event (when the old cooldown ended), so a replayed run can't ping twice.
        if (step) out.push({ id: 'booster:' + eventBucket(prev, prev.booster, nowS), kind: 'booster', link: LINKS.items, title: 'Booster cooldown is over', text: withTrain(step), step });
    }

    // Drug ready for 15 minutes and a drug step is due: one nudge per ready spell.
    if (on.drugready && drug === 0 && prev && prev.drugZeroAt && nowS - Number(prev.drugZeroAt) >= DRUG_IDLE_S) {
        const step = dueStep(plan, nowS, 60, DRUG_STEP);
        if (step) out.push({ id: 'drugready:' + prev.drugZeroAt, kind: 'drugready', link: LINKS.items, title: 'Drug ready for ' + Math.round((nowS - Number(prev.drugZeroAt)) / 60) + ' min, unused', text: withTrain(step), step });
    }

    // Back from travel with a step waiting.
    if (on.landed && prev && Number(prev.travel) > 0 && !traveling) {
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
    if (kind === 'booster') return Number(cd.booster) > 0;
    if (kind === 'energy') return Number(e.maximum) > 0 && Number(e.current) < Number(e.maximum);
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
