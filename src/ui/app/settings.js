/*
 * Settings (mockups/P-settings.html): keys, each with Torn's ToS table
 * where it is entered; FFScouter, TornStats, Discord, overlay, display,
 * diagnostics; "Your data" in the pane.
 */

import { h, t } from '../dom.js';
import { keyInputAttrs, keyMask } from '../mask.js';
import { K } from '../../platform/store.js';
import { FFS_SITE_URL, FFS_POLICY_URL } from '../../api/ffscouter.js';
import { TS_TOS_URL } from '../../api/tornstats.js';
import { W3B_SITE_URL, W3B_TERMS_URL } from '../../api/w3b.js';
import { apiKeyPageUrl } from '../../sources/route.js';
import { sectionHead, headsList } from './common.js';

/** Torn's API ToS disclosure for the userscript's Torn key. */
export const TOS_TORN = [
    ['Data storage', 'Only locally, in this browser'],
    ['Data sharing', 'Nobody'],
    ['Purpose of use', 'Personal gain: gym planning and fight estimates'],
    ['Key storage & sharing', 'Stored locally / Not shared'],
    ['Key access level', 'Limited (user: bars, cooldowns, refills, battlestats, gym, perks, property, equipment, inventory, attacks, personalstats, discord, profile; torn: gyms, items, itemdetails, attacklog; market: itemmarket, pointsmarket; faction: members; key: info)'],
    ['Other services', 'None. FFScouter, TornStats, TornW3B and your Discord service never receive this key.'],
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

/** The Worker's own key (a custom key made for it), stored on the user's Cloudflare Worker. */
export const TOS_WORKER = [
    ['Data storage', 'On your own Cloudflare Worker (D1 database) until you press Forget'],
    ['Data sharing', 'Nobody. Only your Worker reads it; pings go to your Discord webhook'],
    ['Purpose of use', 'Personal: Discord pings for your gym plan'],
    ['Key storage & sharing', 'Stored / Used only for automation'],
    ['Key access level', 'Custom (user: bars, cooldowns, refills, travel)'],
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

function settingsSection(title, state, body) {
    return h('div', { class: 'sec' }, [h('div', {}, [h('h3', { text: title }), state]), h('div', { class: 'secbody' }, body)]);
}

function settingsCheck(label, on, onchange) {
    return h('label', { class: 'check' }, [h('input', { type: 'checkbox', checked: on, onchange: (e) => onchange(e.target.checked) }), label]);
}

function segOf(value, options, onpick, aria) {
    return h('div', { class: 'seg', role: 'group', 'aria-label': aria }, options.map(([v, label]) => h('button', { type: 'button', 'aria-pressed': String(v === value), onclick: () => onpick(v), text: label })));
}

function discordSection(ctx) {
    const d = ctx.discord;
    const st = d.state();
    const tag = !st ? stateTag('off', 'Not set up yet') : st.lastError ? stateTag('bad', 'Last sync failed') : st.ready ? stateTag('ok', 'Connected') : stateTag('bad', 'Needs the webhook and key');
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
            let discordId = f.discordId.value.trim();
            if (!discordId) discordId = (await d.linkedId()) || '';
            await d.connect({ base: f.base.value, invite: f.invite.value.trim(), webhookUrl: f.hook.value, tornKey: f.key.value, discordId });
            f.hook.value = '';
            f.key.value = '';
            ctx.rerender();
        }, 'Connected. Your plan syncs by itself when it changes.');
    const rows = [
        h('p', { text: 'A small free service on your Cloudflare account checks your timers every minute and tags you, even with your PC off: "Drug cooldown ends in 5 min · Xanax #2, then DEX × 27". Pings never come from a Torn tab.' }),
        h('div', { class: 'row', style: 'flex-wrap:wrap;max-width:760px' }, [field('base', 'Service address', { placeholder: 'https://pumping-iron.you.workers.dev', value: st ? st.base : '' }), field('invite', 'Invite code (first time)', { placeholder: 'from SETUP.md', ...keyAttrs, class: secretCls })]),
        h('div', { class: 'row', style: 'flex-wrap:wrap;max-width:760px' }, [field('hook', 'Discord webhook', { placeholder: st ? 'Saved on your Worker · paste to change' : 'https://discord.com/api/webhooks/…', ...keyAttrs, class: secretCls }), field('key', 'Torn key for the Worker', { placeholder: st ? 'Saved on your Worker · paste to change' : 'Custom: bars, cooldowns, refills, travel', ...keyAttrs, class: secretCls })]),
        h('div', { class: 'row', style: 'max-width:760px' }, [field('discordId', 'Your Discord user id', { placeholder: 'Blank: the one linked in Torn', value: st && st.discordId ? st.discordId : '', inputmode: 'numeric' })]),
        h('div', { class: 'row' }, [h('button', { class: 'btn primary', type: 'button', onclick: connect, text: st ? 'Save' : 'Connect' }), h('button', { class: 'btn', type: 'button', disabled: !st, onclick: () => run(() => d.test(), 'Test ping sent. Check your channel.'), text: 'Send a test ping' }), st ? h('button', { class: 'btn ghost', type: 'button', onclick: () => run(async () => { await d.forget(); ctx.rerender(); }, 'Forgotten here and on your Worker.'), text: 'Forget' }) : null, h('a', { href: d.setupUrl, target: '_blank', rel: 'noopener', text: 'Set it up (10 minutes)' })]),
        msg,
        st ? h('p', { class: 'num', text: 'Last sync ' + (st.lastSync ? new Date(st.lastSync).toISOString().slice(11, 16) + ' UTC' : 'never') + (st.lastError ? ' · ' + st.lastError : '') + ' · Later: DMs, /plan, Done and Snooze buttons.' }) : null,
        h('details', { class: 'dis' }, [h('summary', { text: 'How the Worker’s key is used' }), tosTable(TOS_WORKER), h('p', { style: 'margin-top:6px', text: 'Make a new custom key for the Worker in Torn (API settings). Your main key never goes to the Worker.' })]),
    ];
    return settingsSection('Discord pings', tag, rows);
}

export function renderSettings(m, ctx) {
    const s = ctx.settings;
    const ki = (ctx.statics && ctx.statics.keyInfo) || null;
    const dead = ctx.flags.keyDead;
    const hasKey = ctx.flags.hasKey;
    const tornState = !hasKey ? stateTag('off', 'No key yet') : dead ? stateTag('bad', 'Torn rejected this key') : ki && ki.type ? stateTag(ki.level >= 3 || ki.level === 0 ? 'ok' : 'bad', (ki.level >= 3 || ki.level === 0 ? 'Connected · ' : 'Too low · ') + String(ki.type).replace(' Access', '').replace(' Only', '')) : stateTag('ok', 'Saved');

    const torn = keyRow({ label: 'Torn API key', placeholder: hasKey ? 'Saved · paste a new one to replace it' : 'Paste a Limited key', onSave: ctx.saveTornKey, onReveal: () => ctx.revealKey(K.apiKey) });
    const tornSec = settingsSection('Torn API key', tornState, [
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

    const overlaySec = settingsSection('Overlay on Torn', null, [
        h('div', { class: 'opts' }, [settingsCheck('Pill on every page', s.pill, (v) => ctx.setSettings({ pill: v })), settingsCheck('Marks on the gym page', s.gymMarks, (v) => ctx.setSettings({ gymMarks: v })), settingsCheck('Marks on items and markets', s.marketMarks, (v) => ctx.setSettings({ marketMarks: v })), settingsCheck('Torn Eye chips', s.eyeChips, (v) => ctx.setSettings({ eyeChips: v }))]),
        h('p', { class: 'num' }, ['Hide the pill: ', h('b', { class: 'white', text: 'Alt+P' }), ' · drag it anywhere; it stays out of Torn’s content.']),
        h('p', {}, ['Bazaar prices come from ', h('a', { href: W3B_SITE_URL, target: '_blank', rel: 'noopener', text: 'TornW3B' }), ' (item ids only, never a key; ', h('a', { href: W3B_TERMS_URL, target: '_blank', rel: 'noopener', text: 'their terms' }), ').']),
    ]);

    const displaySec = settingsSection('Display', null, [
        h('div', { class: 'row' }, [h('span', { class: 'lab', style: 'width:90px', text: 'Spacing' }), segOf(s.density, [['compact', 'Compact'], ['comfy', 'Comfortable']], (v) => ctx.setSettings({ density: v }), 'Spacing')]),
        h('div', { class: 'row' }, [h('span', { class: 'lab', style: 'width:90px', text: 'Time' }), segOf(s.timeFormat, [['torn', 'Torn time'], ['local', 'Local time']], (v) => ctx.setSettings({ timeFormat: v }), 'Time')]),
    ]);

    const d = ctx.diagnostics();
    const diagSec = settingsSection('Diagnostics', null, [h('dl', { class: 'kv num', style: 'max-width:460px' }, [h('dt', { text: 'Torn API, last minute' }), h('dd', { text: d.torn + ' of 70' }), h('dt', { text: 'FFScouter, last minute' }), h('dd', { text: d.ffs + ' of 60' }), h('dt', { text: 'TornW3B, last minute' }), h('dd', { text: d.w3b + ' of 60' }), h('dt', { text: 'Last error' }), h('dd', { text: d.lastError || 'none' }), h('dt', { text: 'Perk lines not understood' }), h('dd', { text: String(d.unknownPerks) }), h('dt', { text: 'Version' }), h('dd', { text: d.version })])]);

    const dataRows = [
        ['keys', 'Keys', 'Torn, FFScouter, TornStats, Discord service', 'Forget keys'],
        ['plan', 'Plan and build', ctx.planLine, 'Reset'],
        ['progress', 'Progress history', d.historyDays + ' day' + (d.historyDays === 1 ? '' : 's') + ' of stats', 'Clear'],
        ['prices', 'Price history', d.priceItems + ' item' + (d.priceItems === 1 ? '' : 's'), 'Clear'],
        ['eye', 'Torn Eye', d.eyeLine, 'Clear'],
    ];
    const pane = [
        h('div', {}, [sectionHead('Your data', h('span', { class: 'meta', text: 'all on this computer' })), h('div', { class: 'data num' }, dataRows.map(([g, name, sub, act]) => h('div', { class: 'dr' }, [h('div', {}, [h('b', { text: name }), h('br'), h('small', { text: sub })]), h('button', { class: 'btn sm', type: 'button', onclick: () => ctx.clearGroup(g), text: act })])))]),
        h('div', {}, [sectionHead('What it never does', null, null, 'h3'), headsList([{ tone: 'plain', text: 'Train, buy, use or attack', sub: 'Fill only types a number' }, { tone: 'plain', text: 'Load a Torn page by itself' }, { tone: 'plain', text: 'Ping from a Torn tab', sub: 'only your Discord service does' }])]),
    ];
    return { main: [h('div', {}, [sectionHead('Settings'), tornSec, ffsSec, tsSec, discordSec, overlaySec, displaySec, diagSec])], pane };
}

