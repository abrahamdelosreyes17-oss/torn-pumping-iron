#!/usr/bin/env node
/*
 * Tell Discord about the bot's slash commands (the owner runs this once,
 * and again whenever the command list changes). It replaces the whole list.
 *
 *   node scripts/register.mjs --print                 show what would be sent, send nothing
 *   node scripts/register.mjs --guild 123456789012    your server: shows up at once (recommended)
 *   node scripts/register.mjs --global                every server and DMs with the bot: up to an hour
 *
 * Needs DISCORD_APP_ID and BOT_TOKEN in the environment (the same values
 * you gave `wrangler secret put`). Only discord.com is called.
 */

import { COMMAND_DEFS } from '../src/commands.js';

const API = 'https://discord.com/api/v10';

export function registration({ appId, guildId = null }) {
    if (!/^\d{5,25}$/.test(String(appId || ''))) throw new Error('DISCORD_APP_ID is missing or not a number');
    if (guildId && !/^\d{5,25}$/.test(String(guildId))) throw new Error('The guild id is not a number');
    // Guild commands take no contexts or install types: they live in that server only.
    const body = guildId ? COMMAND_DEFS.map(({ contexts, integration_types, ...c }) => c) : COMMAND_DEFS;
    const url = guildId ? API + '/applications/' + appId + '/guilds/' + guildId + '/commands' : API + '/applications/' + appId + '/commands';
    return { url, body };
}

async function main(argv) {
    const arg = (name) => {
        const i = argv.indexOf(name);
        return i >= 0 ? argv[i + 1] : null;
    };
    const print = argv.includes('--print');
    const global = argv.includes('--global');
    const guildId = arg('--guild');
    if (!print && !global && !guildId) {
        console.log('Usage: node scripts/register.mjs --guild <server id> | --global | --print');
        process.exit(2);
    }
    const appId = process.env.DISCORD_APP_ID || (print ? '0000000000' : '');
    const { url, body } = registration({ appId, guildId: global ? null : guildId });
    if (print) {
        console.log('PUT ' + url);
        console.log(JSON.stringify(body, null, 2));
        return;
    }
    if (!process.env.BOT_TOKEN) throw new Error('BOT_TOKEN is missing');
    const res = await fetch(url, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bot ' + process.env.BOT_TOKEN }, body: JSON.stringify(body) });
    const text = await res.text();
    if (!res.ok) throw new Error('Discord answered ' + res.status + ': ' + text.slice(0, 500));
    const list = JSON.parse(text);
    console.log('Registered ' + list.length + ' commands: ' + list.map((c) => '/' + c.name).join(' '));
}

if (String(process.argv[1] || '').endsWith('register.mjs')) {
    main(process.argv.slice(2)).catch((e) => {
        console.error(String((e && e.message) || e));
        process.exit(1);
    });
}
