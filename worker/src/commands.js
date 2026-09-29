/*
 * The slash commands: what Discord is told (scripts/register.mjs sends
 * this list) and the /help text. Plain words, the player's terms.
 */

/** Items /buy and /watch know (Torn item ids). */
export const ITEMS = {
    206: 'Xanax',
    197: 'Ecstasy',
    199: 'LSD',
    366: 'Erotic DVD',
    367: 'Feathery Hotel Coupon',
    310: 'Lollipop',
    36: 'Big Box of Chocolate Bars',
    530: 'Can of Munster',
    532: 'Can of Red Cow',
    533: 'Can of Taurine',
};

/** Ping kinds a user can mute or switch off. */
export const KINDS = {
    drug: 'Drug cooldown ending',
    drugready: 'Drug ready and unused',
    booster: 'Booster cooldown over',
    energy: 'Energy full',
    refill: 'Refill unused',
    jump: 'Jump steps',
    landed: 'Back from travel',
    watch: 'Price watch',
    war: 'War targets',
    chain: 'Chain timeout',
    stale: 'Plan out of date',
};

const STRING = 3;
const INTEGER = 4;
const BOOLEAN = 5;

const itemChoices = Object.entries(ITEMS).map(([id, name]) => ({ name, value: String(id) }));
const kindChoices = [{ name: 'All pings', value: 'all' }, ...Object.entries(KINDS).map(([value, name]) => ({ name, value }))];

/** Guild install; usable in the server and in the bot's DMs. */
const WHERE = { contexts: [0, 1], integration_types: [0] };

export const COMMAND_DEFS = [
    { name: 'help', description: 'What the bot does and its commands' },
    { name: 'link', description: 'Connect this Discord account to Pumping Iron', options: [{ type: STRING, name: 'code', description: 'The code from Pumping Iron → Settings → Discord', required: true, min_length: 4, max_length: 16 }] },
    { name: 'unlink', description: 'Stop DMs to this Discord account' },
    { name: 'status', description: 'Is everything working? Key, plan sync, pings today' },
    { name: 'next', description: 'Your next gym step' },
    { name: 'plan', description: 'Today’s gym steps' },
    { name: 'timers', description: 'Drug, booster, medical, energy, refill and travel now' },
    { name: 'buy', description: 'Cheapest price now (Item Market and bazaars)', options: [{ type: STRING, name: 'item', description: 'Which item (Xanax if left out)', choices: itemChoices }] },
    {
        name: 'watch',
        description: 'Ping when an item is under a price (no options: list your watches)',
        options: [
            { type: STRING, name: 'item', description: 'Which item', choices: itemChoices },
            { type: INTEGER, name: 'price', description: 'Ping at or under this price ($). Leave out to stop watching', min_value: 1, max_value: 1000000000 },
        ],
    },
    { name: 'targets', description: 'Your last Torn Eye list, with Attack links' },
    { name: 'target', description: 'One player: estimate and status now', options: [{ type: INTEGER, name: 'id', description: 'Torn player id', required: true, min_value: 1, max_value: 99999999 }] },
    { name: 'war', description: 'War: who you can hit now, who is out of hospital next', options: [{ type: INTEGER, name: 'faction', description: 'Another faction id (default: your war’s enemy)', min_value: 1, max_value: 999999 }] },
    { name: 'chain', description: 'Your faction’s chain and its timeout' },
    {
        name: 'snooze',
        description: 'Mute pings for a while',
        options: [
            { type: INTEGER, name: 'minutes', description: 'How long (0 = unmute)', required: true, min_value: 0, max_value: 1440 },
            { type: STRING, name: 'kind', description: 'Which pings (all if left out)', choices: kindChoices },
        ],
    },
    {
        name: 'settings',
        description: 'Quiet hours, DM or channel, caps, ping kinds (no options: show them)',
        options: [
            { type: STRING, name: 'quiet', description: 'Quiet hours in Torn time, like 23-7, or off', max_length: 8 },
            { type: STRING, name: 'delivery', description: 'Where pings go', choices: [{ name: 'DM', value: 'dm' }, { name: 'Channel (webhook)', value: 'channel' }] },
            { type: STRING, name: 'kind', description: 'A ping kind to switch on or off (with "on")', choices: kindChoices.slice(1) },
            { type: BOOLEAN, name: 'on', description: 'On or off for that kind' },
            { type: INTEGER, name: 'per_hour', description: 'At most this many pings an hour', min_value: 1, max_value: 60 },
            { type: INTEGER, name: 'per_day', description: 'At most this many pings a day', min_value: 1, max_value: 500 },
        ],
    },
].map((c) => ({ type: 1, ...WHERE, ...c }));

export const HELP = [
    '**Pumping Iron bot**',
    'Pings for your gym plan, by DM. It only reads Torn through the API: you do every train, use, buy and attack yourself.',
    '',
    '`/link CODE` connect (the code is in Pumping Iron → Settings → Discord) · `/unlink`',
    '`/next` · `/plan` your next step, today’s steps',
    '`/timers` drug, booster, medical, energy, refill, travel',
    '`/buy` · `/watch item price` cheapest now; a ping under a price',
    '`/targets` · `/target id` your Torn Eye list; one player now',
    '`/war` · `/chain` who you can hit now; the chain timer',
    '`/snooze` · `/settings` · `/status` mute, quiet hours, caps, health',
    '',
    'Under a ping: **Done** hides it, **Snooze 10 min**, **Skip step** (your plan re-times on its next sync), **Open in Torn**. Times are Torn time (TCT).',
].join('\n');
