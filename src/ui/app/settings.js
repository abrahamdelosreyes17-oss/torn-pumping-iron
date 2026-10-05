/*
 * Settings (mockups/round3/X-settings.html): keys and data, ordered by use,
 * each key with Torn's ToS table where it is entered. Discord folds to one
 * line once it works (Torn Eye's bands are fixed, round 7: no setting); Developer (export
 * learning data for everyone, the developer key unlocks the rest);
 * Diagnostics against Torn Trading's limits (the two take turns).
 */

import { h, t } from '../dom.js';
import { keyInputAttrs, keyMask } from '../mask.js';
import { K } from '../../platform/store.js';
import { FFS_SITE_URL, FFS_POLICY_URL } from '../../api/ffscouter.js';
import { TS_TOS_URL } from '../../api/tornstats.js';
import { W3B_SITE_URL, W3B_TERMS_URL } from '../../api/w3b.js';
import { workerBase } from '../../api/worker.js';
import { PING_GROUPS, PING_KINDS, MODE_NOTE } from '../../core/pings.js';
import { apiKeyPageUrl } from '../../sources/route.js';
import { sectionHead, headsList } from './common.js';
import { developerSection, renderDeveloper } from './developer.js';
import { reportSection } from './report.js';
import { backupSection } from './backup-card.js';

/** Torn's API ToS disclosure for the userscript's Torn key. */
export const TOS_TORN = [
    ['Data storage', 'In this browser. If you log in with Discord, also on the Pumping Iron service (a Cloudflare Worker run by the Pumping Iron owner), the key encrypted (AES-GCM) with a key only that service holds, until you press Disconnect (or type /unlink in Discord); rows not synced for 30 days are deleted'],
    ['Data sharing', 'Nobody. (Other data, never this key: player ids you look at go to FFScouter and TornStats if you connect them; item ids go to TornW3B; with Discord pings on, the Pumping Iron service gets your plan’s next steps, your player and faction id, and Torn Eye’s lists: player ids, names, levels, colour bands, win % and HP kept, watch tags.) The service’s owner runs it and could decrypt stored keys; it only uses yours for your own pings.'],
    ['Purpose of use', 'Personal gain: gym planning, fight estimates and your gym pings; Competitive advantage: war pings, /war and /chain'],
    ['Key storage & sharing', 'Stored locally / With Discord pings: stored (encrypted) on the Pumping Iron service and used only for your own pings and the bot commands you type; shared with nobody'],
    ['Key access level', 'Limited (user: basic, bars, cooldowns, refills, travel, battlestats, gym, perks, property, equipment, inventory, attacks, personalstats, discord, profile, job, jobpoints, money; other players: profile; torn: gyms, items, itemdetails, attacklog, logcategories, calendar; market: itemmarket, pointsmarket; faction: members, wars, chain; key: info)'],
    ['Other services', 'This key goes to api.torn.com, and to the Pumping Iron service only if you log in with Discord. FFScouter and TornStats use the key you give them in their own sections (it may be the same Torn key, which they already hold). TornW3B never receives it. The webpage’s font comes from fonts.googleapis.com (no data of yours).'],
];

export const TOS_FFS = [
    ['Data storage', 'Only locally, in this browser'],
    ['Data sharing', 'The player ids you look at go to FFScouter'],
    ['Purpose of use', 'Fight estimates'],
    ['Key storage & sharing', 'Stored locally / Sent only to ffscouter.com, which already has it'],
    ['Key access level', 'The key you registered at FFScouter; we only read estimates and targets'],
];

export const TOS_TS = [
    ['Data storage', 'Only locally, in this browser'],
    ['Data sharing', 'The player and faction ids you look at go to TornStats'],
    ['Purpose of use', 'Exact stats your faction shared (spies)'],
    ['Key storage & sharing', 'Stored locally / Sent only to tornstats.com, which already has it'],
    ['Key access level', 'The key on your TornStats account; we only read spies'],
];

/** Auto mode's Full key: only in this browser, only for your log (money and gym trains). */
export const TOS_FULL = [
    ['Data storage', 'Only locally, in this browser: the key, your money log’s lines as Torn gives them (type, amounts, times, the other player’s id; 30 days) and your gym trains from the log (stat, trains, energy, gym, gain; up to 120 days)'],
    ['Data sharing', 'Nobody. Never sent to the Pumping Iron service, FFScouter, TornStats or TornW3B'],
    ['Purpose of use', 'Personal gain: Auto mode sizes your gym plan to your income; Progress shows the trains you did while Pumping Iron wasn’t open (e.g. on your phone)'],
    ['Key storage & sharing', 'Stored locally / Not shared'],
    ['Key access level', 'Full (used only for user: log, the money categories and the gym trains; nothing else is read with it)'],
];

/** Your own service (Advanced): the key you give it, stored on your own Cloudflare Worker. */
export const TOS_WORKER = [
    ['Data storage', 'On your own Cloudflare Worker (D1), the key encrypted, until you press Forget'],
    ['Data sharing', 'Nobody: pings and replies only you can see (DMs, replies only you see, or your own webhook channel). It also holds what Pumping Iron syncs: your plan\u2019s next steps, your player and faction id, and Torn Eye\u2019s list (player ids, names, levels, colour bands) for /targets and /war.'],
    ['Purpose of use', 'Personal gain (gym pings and timers); Competitive advantage (/war, /chain, war pings)'],
    ['Key storage & sharing', 'Stored / Used only for automation and the commands you type'],
    ['Key access level', 'Custom (user: basic, bars, cooldowns, refills, travel · faction: members, chain, wars · market: itemmarket)'],
    ['Other services', '/buy and price watches read TornW3B (weav3r.dev) bazaar prices; no key is sent there. The key is stored encrypted (AES-GCM).'],
];

export function tosTable(rows) {
    return h('table', { class: 'tos' }, rows.map(([k, v]) => h('tr', {}, [h('th', { text: k }), h('td', { text: v })])));
}

/** A masked key row: input, Show, Save (or Check and save). */
function keyRow({ label, placeholder, saveText, onSave, onReveal, primary = true }) {
    const attrs = keyInputAttrs();
    const input = h('input', { class: 'inp', 'aria-label': label, placeholder, ...attrs });
    const show = h('button', { class: 'btn', type: 'button', text: 'Show' });
    const msg = h('span', { class: 'msg' });
    const mask = keyMask(input, 'masked', { onReveal, onChange: (hidden) => (show.textContent = hidden ? 'Show' : 'Hide') });
    show.addEventListener('click', () => mask.toggle());
    const save = async () => {
        const v = input.value.trim();
        msg.className = 'msg';
        msg.textContent = 'Checking…';
        try {
            const r = await onSave(v);
            msg.className = 'msg ' + (r && r.ok ? 'ok' : 'bad');
            msg.textContent = (r && r.text) || '';
        } catch (error) {
            msg.className = 'msg bad';
            msg.textContent = String((error && error.message) || error);
        }
        input.value = '';
        mask.hide();
    };
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
    });
    return { row: h('div', { class: 'keyrow' }, [input, show, h('button', { class: 'btn' + (primary ? ' primary' : ''), type: 'button', onclick: save, text: saveText || 'Save' })]), msg };
}

function stateTag(tone, text) {
    return h('span', { class: 'state ' + tone }, [h('i'), text]);
}

/** A button that deletes asks once more ("Sure? Forget keys") for 5 seconds; a second click does it. */
export function confirmButton(ctx, id, text, run) {
    const c = ctx.ui.confirm;
    const armed = c && c.id === id && Date.now() < c.until;
    return h('button', {
        class: 'btn sm' + (armed ? ' primary' : ''),
        type: 'button',
        onclick: () => {
            if (armed) {
                ctx.ui.confirm = null;
                run();
            } else {
                ctx.ui.confirm = { id, until: Date.now() + 5000 };
                ctx.rerender();
                setTimeout(() => {
                    if (ctx.ui.confirm && ctx.ui.confirm.id === id) {
                        ctx.ui.confirm = null;
                        ctx.rerender();
                    }
                }, 5100);
            }
        },
        text: armed ? 'Sure? ' + text : text,
    });
}

function settingsSection(title, state, body) {
    return h('div', { class: 'sec' }, [h('div', {}, [h('h3', { text: title }), state]), h('div', { class: 'secbody' }, body)]);
}

function settingsCheck(label, on, onchange) {
    return h('label', { class: 'check' }, [h('input', { type: 'checkbox', checked: on, onchange: (e) => onchange(e.target.checked) }), label]);
}

function segOf(value, options, onpick, aria) {
    return h('div', { class: 'seg', role: 'group', 'aria-label': aria }, options.map(([v, label]) => h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => onpick(v), text: label })));
}

/** Link Discord (the bot): a one-time code to type as /link CODE in your server, on a click only. */
function linkRow(ctx) {
    const d = ctx.discord;
    const box = h('div', { class: 'row', style: 'flex-wrap:wrap' });
    const code = ctx.ui.linkCode;
    if (code && code.expiresAt * 1000 > Date.now()) {
        box.appendChild(h('span', {}, ['Type ', h('b', { class: 'white', text: '/link ' + code.code }), ' in your Discord server · works once, ']));
        box.appendChild(h('span', { class: 'muted', 'data-cd': String(code.expiresAt * 1000), 'data-cd-prefix': 'expires in ', text: 'expires in 10:00' }));
    } else {
        const msg = h('span', { class: 'msg' });
        box.appendChild(h('button', { class: 'btn sm primary', type: 'button', onclick: async () => { msg.textContent = 'Asking your service…'; try { ctx.ui.linkCode = await d.linkCode(); ctx.rerender(); } catch (e) { msg.className = 'msg bad'; msg.textContent = String((e && e.message) || e); } }, text: 'Get a link code' }));
        box.appendChild(h('span', { class: 'muted', text: 'DMs from the bot, with Done / Snooze / Skip buttons (the webhook stays the fallback)' }));
        box.appendChild(msg);
    }
    return box;
}

/** The state of the service in words (core/discord-state.js): what is wrong, and the steps that fix it. */
function discordStateRows(view) {
    if (!view) return [];
    const steps = view.steps.length ? h('ol', { class: 'steps-list' }, view.steps.map((s) => h('li', { text: s }))) : null;
    const rows = [];
    if (view.title) rows.push(h('div', { class: 'warnb', 'data-discord': view.key }, [h('b', { text: view.title }), view.text ? h('p', { text: view.text }) : null, steps]));
    else if (view.text) rows.push(h('p', { class: 'muted', text: view.text }));
    for (const n of view.notes) rows.push(h('p', { class: 'muted', text: n }));
    if (!view.title && steps) rows.push(steps);
    return rows;
}

/**
 * Which pings the bot sends: a tick each, closed until opened (the owner: "what pings can it send we can tick on
 * and off as we want (collasable in the discord setting)"). Stacking, an overdose and a war move ticks by
 * themselves, and the tick says so; a tick set by hand during one stays as set.
 */
function pingTicksBlock(ctx) {
    const d = ctx.discord;
    const ticks = d.ticks();
    const st = d.state();
    // A service that answered without saying which kinds it knows is an older one: it has no nerve ping.
    const noNerve = Boolean(st && st.answerAt && !(st.kinds && Object.prototype.hasOwnProperty.call(st.kinds, 'nerve')));
    const off = PING_KINDS.filter((k) => !ticks[k].on).length;
    const row = ([kind, label, hint]) => {
        const tk = ticks[kind];
        const why = tk.mode ? MODE_NOTE[tk.mode] : kind === 'nerve' && noNerve ? 'the service is older · no nerve pings yet' : null;
        return h('label', { class: 'check', 'data-ping': kind }, [h('input', { type: 'checkbox', checked: tk.on, onchange: (e) => d.setTick(kind, e.target.checked) }), label, h('span', { class: 'muted', text: '· ' + hint }), why ? h('span', { class: 'why', text: why }) : null]);
    };
    return h('details', { class: 'dis pings', open: Boolean(ctx.ui.pingsOpen), ontoggle: (e) => { ctx.ui.pingsOpen = e.target.open; } }, [
        h('summary', { text: 'Which pings the bot sends' + (off ? ' · ' + off + ' off' : '') }),
        h('div', { class: 'pingset' }, [
            ...PING_GROUPS.map((g) => h('div', { class: 'pinggroup' }, [t('lab', g.title), ...g.kinds.map(row)])),
            h('p', { class: 'muted', text: 'A change here reaches the bot within a minute. /settings in Discord switches the same kinds; the latest change wins.' }),
        ]),
    ]);
}

/** Settings › Discord: one button (Log in with Discord); connected, one line; the old form under Advanced. */
function discordSection(ctx) {
    const d = ctx.discord;
    const st = d.state();
    const msg = h('span', { class: 'msg' });
    const say = (tone, text) => {
        msg.className = 'msg' + (tone ? ' ' + tone : '');
        msg.textContent = text;
    };
    if (ctx.ui.discordLogin) say('', ctx.ui.discordLogin);
    const login = async () => {
        ctx.ui.discordLogin = 'Opening Discord…';
        ctx.rerender();
        try {
            const r = await d.login({ onUpdate: (t) => { ctx.ui.discordLogin = t; ctx.rerender(); } });
            ctx.ui.discordLogin = null;
            ctx.ui.discordResult = { ok: r.ok, text: r.text };
        } catch (e) {
            ctx.ui.discordLogin = null;
            ctx.ui.discordResult = { ok: false, text: String((e && e.message) || e) };
        }
        ctx.rerender();
    };
    const result = ctx.ui.discordResult ? h('span', { class: 'msg ' + (ctx.ui.discordResult.ok ? 'ok' : 'bad'), text: ctx.ui.discordResult.text }) : null;
    const waiting = Boolean(st && st.login);
    const connected = Boolean(st && st.discordName && !waiting);
    // Your own service (set up by hand, no Discord login) opens the Advanced form; everyone else sees Log in with Discord.
    const ownService = Boolean(st && st.connectedAt && !st.discordName);
    // "Back to Log in with Discord" (discordAdvanced === false) shows the login view even when an own service is set up.
    if (ctx.ui.discordAdvanced === false || (!ctx.ui.discordAdvanced && !ownService)) {
        if (connected) {
            // The result is kept (the test changes what is known about the service, and that redraws the section).
            const test = async () => {
                say('', 'Sending…');
                try {
                    const r = await d.test();
                    ctx.ui.discordResult = { ok: true, text: (r && r.text) || 'Sent. Check your Discord DMs.' };
                } catch (e) {
                    ctx.ui.discordResult = { ok: false, text: String((e && e.message) || e) };
                }
                ctx.rerender();
            };
            const view = d.view();
            return settingsSection('Discord pings', stateTag(view.tone, view.tag), [
                h('div', { class: 'row', style: 'flex-wrap:wrap' }, [
                    h('span', {}, ['Connected as ', h('b', { class: 'white', text: st.discordName })]),
                    h('span', { class: 'muted num', text: '· last sync ' + (st.lastSync ? new Date(st.lastSync).toISOString().slice(11, 16) + ' UTC' : 'never') }),
                    h('span', { class: 'grow' }),
                    h('button', { class: 'btn sm', type: 'button', onclick: test, text: 'Send a test ping' }),
                    confirmButton(ctx, 'discord-forget', 'Disconnect', async () => { try { await d.forget(); } finally { ctx.ui.discordResult = { ok: true, text: 'Disconnected: the service forgot your key, plan and pings.' }; ctx.rerender(); } }),
                ]),
                ...discordStateRows(view),
                h('p', { class: 'muted', text: 'DMs from the Pumping Iron bot when a step is due, with Done / Snooze / Skip. In the server: /timers, /next, /war, /settings.' }),
                msg,
                result,
                pingTicksBlock(ctx),
                h('details', { class: 'dis' }, [h('summary', { text: 'How your Torn key is used there' }), tosTable(TOS_TORN)]),
            ]);
        }
        return settingsSection('Discord pings', waiting ? stateTag('off', 'Waiting for Discord') : stateTag('off', 'Not connected'), [
            h('p', { text: 'Get a Discord DM when a step is due, even with your PC off: "Drug cooldown ends in 5 min · Xanax #2, then DEX × 27". You need to be in the Pumping Iron Discord server.' }),
            h('div', { class: 'row' }, [
                waiting ? h('button', { class: 'btn', type: 'button', onclick: () => { d.cancel(); ctx.ui.discordLogin = null; ctx.rerender(); }, text: 'Cancel' }) : h('button', { class: 'btn primary', type: 'button', onclick: login, text: 'Log in with Discord' }),
                waiting ? h('span', { class: 'muted', text: ctx.ui.discordLogin || 'Waiting for you on Discord… (the tab it opened)' }) : null,
            ]),
            msg,
            result,
            st && st.lastError && !waiting ? h('p', { class: 'msg bad', text: st.lastError }) : null,
            h('p', { class: 'muted', text: 'Your Torn key goes to the Pumping Iron service, encrypted, so it can read your timers while you’re away. Disconnect (or /unlink in Discord) removes it.' }),
            h('details', { class: 'dis' }, [h('summary', { text: 'How your Torn key is used there' }), tosTable(TOS_TORN)]),
            h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { ctx.ui.discordAdvanced = true; ctx.rerender(); }, text: 'Advanced: your own service' }),
        ]);
    }
    return advancedDiscordSection(ctx, st);
}

/** Advanced: your own Cloudflare Worker (SETUP.md), the webhook, a link code. */
function advancedDiscordSection(ctx, st) {
    const d = ctx.discord;
    // The state in words, only for a service that is set up (a login under way or a forgotten one has none).
    const view = d.view();
    const shown = ctx.ui.discordResult ? h('span', { class: 'msg ' + (ctx.ui.discordResult.ok ? 'ok' : 'bad'), text: ctx.ui.discordResult.text }) : null;
    const testNow = async (say) => {
        say('', 'Sending…');
        try {
            const r = await d.test();
            ctx.ui.discordResult = { ok: true, text: (r && r.text) || 'Sent. Check Discord.' };
        } catch (e) {
            ctx.ui.discordResult = { ok: false, text: String((e && e.message) || e) };
        }
        ctx.rerender();
    };
    // Working: one line (owner). Edit opens the full form again.
    if (st && view && view.key === 'ok' && !ctx.ui.discordEdit) {
        const msg1 = h('span', { class: 'msg' });
        const test = () => testNow((tone, text) => { msg1.className = 'msg' + (tone ? ' ' + tone : ''); msg1.textContent = text; });
        return settingsSection('Discord pings', stateTag('ok', 'Working'), [
            h('div', { class: 'row', style: 'flex-wrap:wrap' }, [
                h('span', { class: 'muted num', text: 'Your service · last sync ' + (st.lastSync ? new Date(st.lastSync).toISOString().slice(11, 16) + ' UTC' : 'never') + (st.linked ? ' · linked to the bot' : '') }),
                h('span', { class: 'grow' }),
                h('button', { class: 'btn sm', type: 'button', onclick: test, text: 'Send a test ping' }),
                h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { ctx.ui.discordEdit = true; ctx.rerender(); }, text: 'Edit' }),
            ]),
            ...discordStateRows(view),
            st.bot && !st.linked ? linkRow(ctx) : null,
            msg1,
            shown,
            pingTicksBlock(ctx),
        ]);
    }
    const tag = !st || !view ? stateTag('off', 'Not set up yet') : stateTag(view.tone, view.tag);
    const f = {};
    const field = (key, label, attrs) => h('label', { class: 'field', style: 'flex:1;min-width:220px' }, [t('lab', label), (f[key] = h('input', { class: 'inp', ...attrs }))]);
    const keyAttrs = keyInputAttrs();
    const secretCls = 'inp' + (keyAttrs.type === 'text' ? ' masked' : '');
    const msg = h('span', { class: 'msg' });
    const run = async (fn, okText) => {
        msg.className = 'msg';
        msg.textContent = 'Working…';
        try {
            await fn();
            msg.className = 'msg ok';
            msg.textContent = okText;
        } catch (e) {
            msg.className = 'msg bad';
            msg.textContent = String((e && e.message) || e);
        }
    };
    const connect = () =>
        run(async () => {
            try {
                let discordId = f.discordId.value.trim();
                if (!discordId) discordId = (await d.linkedId()) || '';
                await d.connect({ base: f.base.value, invite: f.invite.value.trim(), webhookUrl: f.hook.value, tornKey: f.key.value, discordId });
            } finally {
                // Secrets never stay in the boxes, whether it worked or not.
                f.hook.value = '';
                f.key.value = '';
                f.invite.value = '';
            }
            ctx.rerender();
        }, 'Connected. Your plan syncs by itself when it changes.');
    const rows = [
        h('p', { text: 'A small free service on your Cloudflare account checks your timers every minute and tags you, even with your PC off: "Drug cooldown ends in 5 min · Xanax #2, then DEX × 27". Pings never come from a Torn tab.' }),
        h('div', { class: 'row', style: 'flex-wrap:wrap;max-width:760px' }, [field('base', 'Service address' + (st ? '' : ' (needed)'), { placeholder: 'https://pumping-iron.you.workers.dev', value: st ? st.base : '', onblur: (e) => { const v = e.target.value.trim(); if (!v) return; try { workerBase(v); msg.className = 'msg'; msg.textContent = 'Your Worker key and webhook will be stored on ' + new URL(v).hostname + '.'; } catch (err) { msg.className = 'msg bad'; msg.textContent = String(err.message || err); } } }), field('invite', 'Invite code' + (st ? ' (first time only)' : ' (needed the first time)'), { placeholder: 'from SETUP.md', ...keyAttrs, class: secretCls })]),
        h('div', { class: 'row', style: 'flex-wrap:wrap;max-width:760px' }, [field('hook', 'Discord webhook', { placeholder: st ? 'Saved on your Worker · paste to change' : 'https://discord.com/api/webhooks/…', ...keyAttrs, class: secretCls }), field('key', 'Torn key for your service' + (st ? '' : ' (needed)'), { placeholder: st ? 'Saved on your service · paste to change' : 'Your Torn key (Limited)', ...keyAttrs, class: secretCls })]),
        h('div', { class: 'row', style: 'max-width:760px' }, [field('discordId', 'Your Discord user id', { placeholder: 'Blank: the one linked in Torn', value: st && st.discordId ? st.discordId : '', inputmode: 'numeric' })]),
        h('div', { class: 'row' }, [h('button', { class: 'btn primary', type: 'button', onclick: connect, text: st ? 'Save' : 'Connect' }), h('button', { class: 'btn', type: 'button', disabled: !st, onclick: () => testNow((tone, text) => { msg.className = 'msg' + (tone ? ' ' + tone : ''); msg.textContent = text; }), text: 'Send a test ping' }), st ? confirmButton(ctx, 'discord-forget', 'Forget', () => run(async () => { await d.forget(); ctx.rerender(); }, 'Forgotten here and on your Worker.')) : null, h('a', { href: d.setupUrl, target: '_blank', rel: 'noopener', text: 'Set it up (10 minutes)' })]),
        msg,
        shown,
        ...discordStateRows(view),
        st ? h('p', { class: 'num', text: 'Last sync ' + (st.lastSync ? new Date(st.lastSync).toISOString().slice(11, 16) + ' UTC' : 'never') + (st.lastError && !view ? ' · ' + st.lastError : '') + (st.bot ? ' · the bot is set up: DMs with Done / Snooze / Skip, /plan, /timers' : '') }) : null,
        st && st.bot && !st.linked ? linkRow(ctx) : null,
        view ? pingTicksBlock(ctx) : null,
        st && st.ready ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { ctx.ui.discordEdit = false; ctx.rerender(); }, text: 'Done' }) : null,
        h('details', { class: 'dis' }, [h('summary', { text: 'How the Worker’s key is used' }), tosTable(TOS_WORKER), h('p', { style: 'margin-top:6px', text: 'Your own service: the key you paste here is stored encrypted on your Cloudflare Worker.' })]),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { ctx.ui.discordAdvanced = false; ctx.rerender(); }, text: 'Back to Log in with Discord' }),
    ];
    return settingsSection('Discord pings', tag, rows);
}

export function renderSettings(m, ctx) {
    // The Developer page (unlocked only) replaces Settings while it is open.
    if (ctx.ui.devPage && ctx.dev && ctx.dev.unlocked()) return renderDeveloper(m, ctx);
    const s = ctx.settings;
    const ki = (ctx.statics && ctx.statics.keyInfo) || null;
    const dead = ctx.flags.keyDead;
    const hasKey = ctx.flags.hasKey;
    const problem = ctx.keyProblem;
    const kiType = ki && ki.type ? String(ki.type).replace(' Access', '').replace(' Only', '') : '';
    const tornState = !hasKey ? stateTag('off', 'No key yet') : dead ? stateTag('bad', 'Torn rejected this key') : problem && problem.kind === 'access' ? stateTag('bad', 'Too limited' + (kiType ? ' · ' + kiType : '')) : kiType ? stateTag('ok', 'Connected · ' + kiType) : stateTag('ok', 'Saved');

    const torn = keyRow({ label: 'Torn API key', placeholder: hasKey ? 'Saved · paste a new one to replace it' : 'Paste a Limited key', onSave: ctx.saveTornKey, onReveal: () => ctx.revealKey(K.apiKey) });
    const tornSec = settingsSection('Torn API key', tornState, [
        problem && problem.kind !== 'dead' ? h('div', { class: 'warnb' }, [h('b', { text: problem.title }), h('p', { text: problem.text })]) : null,
        torn.row,
        torn.msg,
        h('p', {}, ['Reads your bars, cooldowns, stats, perks, property, gear and attacks. It can’t train, buy or attack. ', h('a', { href: apiKeyPageUrl(), target: '_blank', rel: 'noopener', text: 'Make a Limited key' })]),
        h('details', { class: 'dis', open: !hasKey }, [h('summary', { text: 'How this key is used' }), tosTable(TOS_TORN)]),
    ]);

    const ffs = keyRow({ label: 'FFScouter key', placeholder: ctx.flags.hasFfs ? 'Saved · paste a new one to replace it' : 'Your FFScouter key', saveText: 'Check and save', onSave: ctx.saveFfsKey, onReveal: () => ctx.revealKey(K.ffsKey) });
    const ffsState = ctx.flags.hasFfs ? (ctx.flags.ffsDead ? stateTag('bad', 'Key refused') : stateTag('ok', 'Connected')) : stateTag('off', 'Not connected');
    const ffsSec = settingsSection('FFScouter', ffsState, [
        h('p', { text: 'Stat estimates for players you haven’t fought. Credited wherever they show.' }),
        h('ol', { class: 'steps-list muted' }, [h('li', {}, ['Sign up at ', h('a', { href: FFS_SITE_URL, target: '_blank', rel: 'noopener', text: 'ffscouter.com' }), ' with a Torn key and accept their ', h('a', { href: FFS_POLICY_URL, target: '_blank', rel: 'noopener', text: 'data policy' }), '.']), h('li', { text: 'Paste that same key here. We check it with FFScouter.' })]),
        ffs.row,
        ffs.msg,
        h('details', { class: 'dis' }, [h('summary', { text: 'How this key is used' }), tosTable(TOS_FFS)]),
    ]);

    const ts = keyRow({ label: 'TornStats key', placeholder: ctx.flags.hasTs ? 'Saved · paste a new one to replace it' : 'Your TornStats key', onSave: ctx.saveTsKey, onReveal: () => ctx.revealKey(K.tsKey), primary: false });
    const tsSec = settingsSection('TornStats spies', ctx.flags.hasTs ? stateTag('ok', 'Saved') : stateTag('off', 'Optional'), [h('p', {}, ['If your faction shares spies on TornStats, exact stats beat every estimate. ', h('a', { href: TS_TOS_URL, target: '_blank', rel: 'noopener', text: 'Their terms' })]), ts.row, ts.msg, h('details', { class: 'dis' }, [h('summary', { text: 'How this key is used' }), tosTable(TOS_TS)])]);

    const discordSec = discordSection(ctx);

    // Auto mode's Full key: only for your log (money, gym trains).
    const fk = ctx.fullKey || {};
    const full = keyRow({ label: 'Full key', placeholder: fk.has ? 'Saved · paste a new one to replace it' : 'Paste a Full access key', saveText: 'Check and save', onSave: ctx.saveFullKey, onReveal: () => ctx.revealKey(K.fullKey) });
    const fullState = !fk.has ? stateTag('off', ctx.plan && ctx.plan.pickBy === 'auto' ? 'Auto mode needs it' : 'Optional') : fk.ok ? stateTag('ok', 'Connected · Full') : stateTag('bad', fk.error || 'Not a Full key');
    const fullSec = settingsSection('Full key (Auto mode)', fullState, [
        h('p', { text: 'Auto mode, the default plan, sizes your gym spending to your income. It needs a Full key, used only to read your log: the money lines, to see where your income comes from, and your gym trains, so trains on your phone show in Progress. It never leaves this browser.' }),
        full.row,
        ctx.ui.fullKeyMsg ? h('span', { class: 'msg ' + (ctx.ui.fullKeyMsg.ok ? 'ok' : 'bad'), text: ctx.ui.fullKeyMsg.text }) : full.msg,
        fk.has ? h('div', { class: 'row' }, [fk.logAt ? h('span', { class: 'muted num', text: 'Money log read ' + new Date(fk.logAt).toISOString().slice(11, 16) + ' UTC' + (fk.logLines ? ' · ' + fk.logLines + ' lines' : '') }) : h('span', { class: 'muted', text: 'Money log not read yet' }), confirmButton(ctx, 'full-forget', 'Forget the Full key', () => { ctx.forgetFullKey(); ctx.rerender(); })]) : null,
        h('div', { class: 'row' }, [t('lab', 'Keep for war days'), h('input', { class: 'inp num', style: 'width:72px', inputmode: 'numeric', 'aria-label': 'Energy kept for war days', value: String(s.warReserve || 0), onchange: (ev) => ctx.setSettings({ warReserve: Math.max(0, Math.min(1000, Math.round(Number(ev.target.value) || 0))) }) }), h('span', { class: 'muted', text: 'energy · during a faction war the plan never trains below this (0 = you decide)' })]),
        h('p', {}, ['No Full key? Pick a manual plan on Plan (Most stats in my budget) and set the budget yourself. ', h('a', { href: apiKeyPageUrl(), target: '_blank', rel: 'noopener', text: 'Make a Full key' })]),
        h('details', { class: 'dis', open: !fk.has }, [h('summary', { text: 'How this key is used' }), tosTable(TOS_FULL)]),
    ]);

    const overlaySec = settingsSection('On Torn’s pages', null, [
        h('div', { class: 'opts' }, [settingsCheck('Panel on every page', s.pill, (v) => ctx.setSettings({ pill: v })), settingsCheck('Marks on the gym page', s.gymMarks, (v) => ctx.setSettings({ gymMarks: v })), settingsCheck('Marks on items and markets', s.marketMarks, (v) => ctx.setSettings({ marketMarks: v })), settingsCheck('Torn Eye chips', s.eyeChips, (v) => ctx.setSettings({ eyeChips: v }))]),
        h('p', { class: 'num' }, ['Expand or collapse the panel: ', h('b', { class: 'white', text: 'Alt+`' }), ' · drag it by its bar; it stays in the empty margin beside Torn’s page, left of it first, so NPC Arbitrage keeps the right.']),
        h('div', { class: 'opts' }, [settingsCheck('Bazaar prices from TornW3B', s.w3b !== false, (v) => ctx.setSettings({ w3b: v })), settingsCheck('Animations', s.motion !== false, (v) => ctx.setSettings({ motion: v }))]),
        h('p', {}, ['Bazaar prices come from ', h('a', { href: W3B_SITE_URL, target: '_blank', rel: 'noopener', text: 'TornW3B' }), ' (item ids only, never a key; ', h('a', { href: W3B_TERMS_URL, target: '_blank', rel: 'noopener', text: 'their terms' }), '). Off: Item Market and points market only.']),
        h('p', {}, [h('b', { class: 'white', text: 'Pumping Iron pauses while Torn Trading (NPC Arbitrage / Torn Bids) runs' }), ': the two never share Torn’s API limit or mark the same pages. While paused it asks Torn nothing, draws nothing on Torn’s pages and shows a warning sign; it starts again by itself about 2 minutes after the last tab running Torn Trading is reloaded or closed.']),
    ]);

    const displaySec = settingsSection('Display', null, [
        h('div', { class: 'row' }, [h('span', { class: 'lab', style: 'width:90px', text: 'Time' }), segOf(s.timeFormat, [['torn', 'Torn time'], ['local', 'Local time']], (v) => ctx.setSettings({ timeFormat: v }), 'Time')]),
    ]);

    const d = ctx.diagnostics();
    const diagSec = h('div', {}, [sectionHead('Diagnostics', null, null, 'h3'), h('dl', { class: 'facts num' }, [h('dt', { text: 'Torn API, last minute' }), h('dd', { text: d.torn + ' of ' + (d.tornMax || 85) + (d.focus ? ' · first: ' + d.focus : '') }), h('dt', { text: 'FFScouter, last minute' }), h('dd', { text: d.ffs + ' of 60' }), h('dt', { text: 'TornW3B, last minute' }), h('dd', { text: d.w3b + ' of 80' }), h('dt', { text: 'Last error' }), h('dd', { text: d.lastError || 'none' }), h('dt', { text: 'Perk lines not understood' }), h('dd', { text: String(d.unknownPerks) }), h('dt', { text: 'Version' }), h('dd', { text: d.version })])]);
    const devSec = developerSection(m, ctx);
    const reportSec = reportSection(m, ctx);
    const backupSec = backupSection(m, ctx);

    const dataRows = [
        ['keys', 'Keys', 'Torn, Full, FFScouter, TornStats, Discord service', 'Forget keys'],
        ['plan', 'Plan and build', ctx.planLine, 'Reset'],
        ['progress', 'Progress history', d.historyDays + ' day' + (d.historyDays === 1 ? '' : 's') + ' of stats', 'Clear'],
        ['prices', 'Price history', d.priceItems + ' item' + (d.priceItems === 1 ? '' : 's'), 'Clear'],
        ['eye', 'Torn Eye', d.eyeLine, 'Clear'],
        ['learning', 'Learning data', d.learnLine, 'Clear'],
    ];
    const pane = [
        diagSec,
        h('div', {}, [sectionHead('Your data', h('span', { class: 'meta', text: 'all on this computer' })), h('div', { class: 'data num' }, dataRows.map(([g, name, sub, act]) => h('div', { class: 'dr' }, [h('div', {}, [h('b', { text: name }), h('br'), h('small', { text: sub })]), confirmButton(ctx, 'clear:' + g, act, () => ctx.clearGroup(g))])))]),
        h('div', {}, [sectionHead('What it never does', null, null, 'h3'), headsList([{ tone: 'plain', text: 'Train, buy, use or attack', sub: 'Fill only types a number' }, { tone: 'plain', text: 'Load a Torn page by itself' }, { tone: 'plain', text: 'Ping from a Torn tab', sub: 'only your Discord service does' }])]),
    ];
    // One card per section, ordered by use.
    return { main: [tornSec, fullSec, discordSec, ffsSec, tsSec, overlaySec, displaySec, backupSec, reportSec, devSec].filter(Boolean), pane };
}

