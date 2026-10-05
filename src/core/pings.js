/*
 * Which Discord pings are ticked on (Settings › Discord pings). Pure: the storage and the sync are in src/pings.js
 * and src/discord.js.
 *
 * A tick is on or off by default (the service's own defaults), or set by hand: {on, at}. Two modes move ticks by
 * themselves: stacking for a chain (or an overdose) turns the energy and training ticks off, and a war of your
 * faction turns the war ticks on. Nothing is stored for a mode: when it ends the ticks are what they were. A tick
 * set by hand AFTER the mode came on wins over it, and is what stays afterwards.
 *
 * The bot's /settings in Discord can switch a kind too: the service tells the change with its time and the ticks
 * take it over as a hand change of that time, unless a tick here was set later (the latest change wins).
 */

/** The service's defaults (worker/src/settings.js KIND_DEFAULTS; a test keeps the two the same). */
export const PING_DEFAULTS = { drug: true, drugready: true, booster: true, energy: true, nerve: true, refill: true, jump: true, landed: true, price: true, watch: true, war: true, chain: false, stale: true };

/** Every ping in plain words, grouped as Settings lists them. */
export const PING_GROUPS = [
    {
        title: 'Cooldowns',
        kinds: [
            ['drug', 'Drug cooldown ending', '5 min before it ends'],
            ['drugready', 'Drug ready and unused', 'once, after 15 min'],
            ['booster', 'Booster cooldown ending', 'about a minute before'],
        ],
    },
    {
        title: 'Bars',
        kinds: [
            ['energy', 'Energy full', 'about a minute before, then hourly while full'],
            ['nerve', 'Nerve full', 'about a minute before, once'],
            ['refill', 'Daily refill unused', '2 h before Torn midnight'],
        ],
    },
    {
        title: 'Your plan',
        kinds: [
            ['jump', 'Jump steps', '5 min before each tick'],
            ['landed', 'Landed with a step waiting', 'back in Torn'],
            ['stale', 'Plan out of date', 'not synced for 12 h'],
        ],
    },
    {
        title: 'Players and prices',
        kinds: [
            ['war', 'War targets', 'enemies you can beat, a few minutes ahead'],
            ['chain', 'Chain about to drop', '10+ hits, under a minute left'],
            ['watch', 'Watch list', 'players you watch in Torn Eye'],
            ['price', 'Price watch', 'an item at your price (/watch in Discord)'],
        ],
    },
];

export const PING_KINDS = PING_GROUPS.flatMap((g) => g.kinds.map(([kind]) => kind));

/** Stacking for a chain, or overdosed: these ticks go off by themselves (the bot's own rule: no energy or training pings). */
export const CHAIN_OFF = ['energy', 'refill', 'jump'];
/** A war of your faction: these ticks go on by themselves. */
export const WAR_ON = ['war', 'chain'];

/** Why a tick moved by itself, next to it. */
export const MODE_NOTE = {
    chain: 'off while you are stacking · back on Resume',
    overdose: 'off while you are overdosed · back when it is over',
    war: 'on while your faction is at war · back off after it',
};

const pingStoreEmpty = () => ({ hand: {}, war: null });

/** The stored ticks, made safe to read. */
export function pingStore(raw) {
    const s = raw && typeof raw === 'object' ? raw : {};
    const hand = {};
    for (const k of PING_KINDS) {
        const h = s.hand && s.hand[k];
        if (h && typeof h.on === 'boolean') hand[k] = { on: h.on, at: Number(h.at) || 0 };
    }
    const war = s.war && s.war.key ? { key: String(s.war.key), since: Number(s.war.since) || 0 } : null;
    return { ...pingStoreEmpty(), hand, war };
}

/**
 * The ticks as they are now.
 * @param {object} store - pingStore()
 * @param {object} [modes] - {chain: ms since "I'm stacking" | null, overdose: ms | null, war: ms since the war was seen | null}
 * @returns {Object<string, {on: boolean, base: boolean, hand: boolean, mode: 'chain'|'overdose'|'war'|null}>} `mode` only when it moved the tick
 */
export function pingTicks(store, modes = {}) {
    const st = pingStore(store);
    // One of the two at a time, as the plan sync has it: an overdose first.
    const offMode = modes.overdose ? 'overdose' : modes.chain ? 'chain' : null;
    const offSince = offMode ? Number(modes[offMode]) : null;
    const out = {};
    for (const k of PING_KINDS) {
        const h = st.hand[k] || null;
        const base = h ? h.on : PING_DEFAULTS[k];
        let on = base;
        let mode = null;
        if (offMode && CHAIN_OFF.includes(k) && !(h && h.at > offSince)) {
            on = false;
            mode = offMode;
        }
        if (modes.war && WAR_ON.includes(k) && !(h && h.at > Number(modes.war))) {
            on = true;
            mode = 'war';
        }
        out[k] = { on, base, hand: Boolean(h), mode: on !== base ? mode : null };
    }
    return out;
}

/**
 * What the sync sends.
 * - `rules`: every kind, on or off. The war mode is in them (the service knows no war mode); stacking and an
 *   overdose are NOT: the service silences those kinds itself from the plan's flag, and brings them back by itself
 *   when an overdose runs out with this browser closed.
 * - `keep`: the stacking kinds ticked back on by hand during it (the plan's flag carries them).
 * - `rulesAt`: when each hand-set tick was set (unix s), so the service knows which /settings changes it has seen.
 */
export function pingSync(store, modes = {}) {
    const st = pingStore(store);
    const ticks = pingTicks(st, modes);
    const rules = {};
    const keep = [];
    for (const k of PING_KINDS) {
        const t = ticks[k];
        const stacked = t.mode === 'chain' || t.mode === 'overdose';
        rules[k] = stacked ? t.base : t.on;
        if (CHAIN_OFF.includes(k) && (modes.chain || modes.overdose) && t.on) keep.push(k);
    }
    const rulesAt = {};
    for (const [k, h] of Object.entries(st.hand)) rulesAt[k] = Math.floor(h.at / 1000);
    return { rules, rulesAt, keep };
}

/** A tick set by hand. */
export function setTick(store, kind, on, now = Date.now()) {
    const st = pingStore(store);
    if (!PING_KINDS.includes(kind)) return st;
    return { ...st, hand: { ...st.hand, [kind]: { on: Boolean(on), at: now } } };
}

/**
 * The /settings changes made in Discord that the service tells (`kindsSet`: {kind: {on, at (unix s)}}): each is
 * taken over as a hand change of that time, unless the tick here was set later. Returns the same store when
 * nothing changed.
 */
export function adoptKinds(store, kindsSet) {
    const st = pingStore(store);
    if (!kindsSet || typeof kindsSet !== 'object') return st;
    let hand = st.hand;
    for (const k of PING_KINDS) {
        const c = kindsSet[k];
        if (!c || typeof c.on !== 'boolean') continue;
        const at = (Number(c.at) || 0) * 1000;
        const h = st.hand[k];
        if (h && h.at >= at) continue;
        hand = { ...hand, [k]: { on: c.on, at } };
    }
    return hand === st.hand ? st : { ...st, hand };
}

/** The war the ticks follow: kept with the time it was first seen, dropped when it is over. */
export function warSeen(store, warKey, now = Date.now()) {
    const st = pingStore(store);
    if (!warKey) return st.war ? { ...st, war: null } : st;
    return st.war && st.war.key === warKey ? st : { ...st, war: { key: warKey, since: now } };
}
