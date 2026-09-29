/*
 * Which pings are due, from one Torn state read and the synced plan. Pure,
 * so it's tested without Cloudflare or Discord. Every alert has an id so a
 * ping is sent once however many minutes it stays true.
 */

export const DRUG_LEAD_S = 5 * 60;
export const JUMP_LEAD_S = 5 * 60;
export const REFILL_WARN_S = 2 * 60 * 60;
export const DAY_S = 86400;

const clock = (s) => new Date(s * 1000).toISOString().slice(11, 16);

const TORN = 'https://www.torn.com/';
export const LINKS = { items: TORN + 'item.php', gym: TORN + 'gym.php', points: TORN + 'points.php' };

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
 * @param {object} [rules] - {drug, energy, refill, jump} booleans (default all on)
 * @returns {{id, kind, title, text, link, step}[]}
 */
export function dueAlerts(state, plan, nowS, rules = {}) {
    const on = { drug: true, energy: true, refill: true, jump: true, ...rules };
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
        out.push({ id: 'energy:' + Math.floor(nowS / 3600), kind: 'energy', link: LINKS.gym, title: 'Energy is full', text: step && step.train ? 'Train ' + step.train : 'Train your energy so none is wasted', step: step || null });
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
