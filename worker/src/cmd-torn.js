/*
 * Commands that read Torn with the user's own key (their own Worker key,
 * never anyone else's). They answer "thinking…" at once and fill in the
 * answer when Torn replies. One such command per user every 5 seconds,
 * so a user's key stays far under Torn's 100 calls a minute.
 */

import { Q, parse } from './db.js';
import { reply, defer, linkButton, row as actionRow } from './discord.js';
import { keyFor, KeyError } from './keys.js';
import { userState, playerBasic, factionWars, factionMembers, factionChain, pauseUser, tornErrorText, TornError } from './torn.js';
import { findWar, membersOf, playerNow, estimator, warPages, warGroups, chainText, BEATABLE, BAND_WORDS, normBand, MAX_WAR_MEMBERS, MAX_WATCH } from './war.js';
import { bestPrice, buyMessage, itemName, MAX_WATCHES } from './market.js';
import { ITEMS } from './commands.js';
import { clock, rel, dur, money, PAGES } from './format.js';

export const COMMAND_GAP_S = 5;

/**
 * Checks shared by every Torn-reading command, then the deferred work.
 * `work(key)` returns the message data.
 */
export async function withTorn(user, i, env, fetchImpl, ctx, nowS, work) {
    if (!user.torn_key) return reply('No Torn key on the Worker yet: add one in Pumping Iron → Settings → Discord.');
    if (Number(user.paused)) return reply('Paused: ' + (user.last_error || 'Torn refused the key') + '. Paste a new key in Pumping Iron → Settings → Discord.');
    if (nowS - (Number(user.cmd_at) || 0) < COMMAND_GAP_S) return reply('One moment: wait a few seconds between commands that read Torn.');
    await env.DB.prepare(Q.userCmd).bind(nowS, user.id).run();
    return defer(ctx, env, fetchImpl, env.DB, i, async () => {
        let key;
        try {
            key = await keyFor(env, env.DB, user);
        } catch (e) {
            if (e instanceof KeyError) await env.DB.prepare(Q.userPause).bind(e.message, user.id).run();
            return { content: String(e.message) };
        }
        try {
            return await work(key);
        } catch (e) {
            if (e instanceof TornError && e.dead) await pauseUser(env.DB, user.id, e);
            return { content: tornErrorText(e) };
        }
    });
}

function cooldownLine(name, s, nowS) {
    const n = Number(s) || 0;
    return name + ': ' + (n > 0 ? dur(n) + ' (ends ' + clock(nowS + n) + ' · ' + rel(nowS + n) + ')' : '**ready**');
}

export function timersText(state, nowS) {
    const cd = state.cooldowns || {};
    const e = (state.bars && state.bars.energy) || {};
    const t = state.travel || {};
    const lines = ['**Timers** (Torn time)'];
    lines.push(cooldownLine('Drug', cd.drug, nowS));
    lines.push(cooldownLine('Booster', cd.booster, nowS));
    lines.push(cooldownLine('Medical', cd.medical, nowS));
    const full = Number(e.full_time) || 0;
    lines.push('Energy: ' + (Number(e.current) || 0) + '/' + (Number(e.maximum) || 0) + (Number(e.current) >= Number(e.maximum) ? ' · **full**' : full > 0 ? ' · full in ' + dur(full) + ' (' + clock(nowS + full) + ')' : ''));
    const r = state.refills || {};
    lines.push('Refill: ' + (r.energy === true ? 'used today' : '**unused** (resets 00:00 TCT · ' + rel(Math.floor(nowS / 86400 + 1) * 86400) + ')'));
    const left = Number(t.time_left) || 0;
    if (left > 0) lines.push('Travel: flying to ' + (t.destination || '?') + ', lands ' + clock(nowS + left) + ' · ' + rel(nowS + left));
    else if (t.destination && t.destination !== 'Torn') lines.push('Travel: in ' + t.destination);
    else lines.push('Travel: in Torn');
    return lines.join('\n');
}

/* ---------- /buy and /watch ---------- */

function opts(i) {
    const out = {};
    for (const o of (i.data && i.data.options) || []) out[o.name] = o.value;
    return out;
}

export async function buyCmd(user, i, env, fetchImpl, ctx, nowS) {
    const itemId = Number(opts(i).item) || 206;
    if (!ITEMS[itemId]) return reply('I don’t know that item.');
    return withTorn(user, i, env, fetchImpl, ctx, nowS, async (key) => buyMessage(itemId, await bestPrice(fetchImpl, env.DB, key, user.id, itemId, nowS, 60)));
}

export async function watchCmd(user, i, env, fetchImpl, ctx, nowS) {
    const o = opts(i);
    const { results } = await env.DB.prepare(Q.watchList).bind(user.id).all();
    const list = results || [];
    const line = (w) => '• ' + itemName(w.item) + ' at or under ' + money(w.price) + (Number(w.fired) ? ' (pinged; again after it goes back over)' : '');
    if (o.item === undefined) return reply(list.length ? '**Your price watches** (checked every 5 minutes)\n' + list.map(line).join('\n') : 'No price watches. Add one: `/watch item:Xanax price:820000`.');
    const itemId = Number(o.item);
    if (!ITEMS[itemId]) return reply('I don’t know that item.');
    if (o.price === undefined) {
        await env.DB.prepare(Q.watchDelete).bind(user.id, itemId).run();
        return reply('Stopped watching ' + itemName(itemId) + '.');
    }
    const price = Math.round(Number(o.price));
    if (!(price > 0)) return reply('The price must be above $0.');
    if (!list.some((w) => Number(w.item) === itemId) && list.length >= MAX_WATCHES) return reply('At most ' + MAX_WATCHES + ' watches. Stop one first: `/watch item:<name>` without a price.');
    await env.DB.prepare(Q.watchPut).bind(user.id, itemId, price).run();
    return reply('Watching ' + itemName(itemId) + ': a ping when it’s at or under ' + money(price) + ' (Item Market or a bazaar on TornW3B, checked every 5 minutes). You buy in Torn yourself.');
}

/* ---------- /targets and /target ---------- */

const posInt = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 && Number(v) < 1e9 ? Number(v) : null);
const pct = (v) => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.max(0, Math.min(100, Number(v))));

/**
 * Torn Eye's list as the userscript syncs it (PUT /plan `targets`), kept
 * small and plain: {list: [{id, name, level, band, win, keep}] ≤ 50, bands: {id: band} ≤ 500}.
 */
export function cleanTargets(t, nowS) {
    if (!t || typeof t !== 'object') return null;
    const list = (Array.isArray(t.list) ? t.list : [])
        .slice(0, 50)
        .map((x) => ({ id: posInt(x && x.id), name: String((x && x.name) || '').slice(0, 40), level: posInt(x && x.level), band: normBand(x && x.band), win: pct(x && x.win), keep: pct(x && x.keep) }))
        .filter((x) => x.id);
    const bands = {};
    for (const [id, b] of Object.entries(t.bands && typeof t.bands === 'object' ? t.bands : {}).slice(0, 500)) if (posInt(id) && normBand(b) !== 'none') bands[posInt(id)] = normBand(b);
    return { at: nowS, list, bands };
}


/** One player as the userscript syncs it: {id, name, level, band, win, keep} (+ tag on the watch list). */
function cleanPlayer(x, withTag) {
    const p = { id: posInt(x && x.id), name: x && x.name ? String(x.name).slice(0, 40) : null, level: posInt(x && x.level), band: normBand(x && x.band), win: pct(x && x.win), keep: pct(x && x.keep) };
    if (withTag) p.tag = x && x.tag ? String(x.tag).slice(0, 24) : null;
    return p;
}

function uniqueById(list) {
    const seen = new Set();
    return list.filter((x) => x.id && !seen.has(x.id) && seen.add(x.id));
}

/**
 * The enemy faction as Torn Eye sees it (PUT /plan `war`):
 * {factionId, members: [{id, name, level, band, win, keep}] ≤ 100}; null clears.
 */
export function cleanWarList(w, nowS) {
    if (!w || typeof w !== 'object' || Array.isArray(w)) return null;
    const members = uniqueById((Array.isArray(w.members) ? w.members : []).slice(0, MAX_WAR_MEMBERS).map((x) => cleanPlayer(x, false)));
    return { at: nowS, factionId: posInt(w.factionId), members };
}

/** The watch list (PUT /plan `watch`): [{id, name, level, band, win, keep, tag}] ≤ 50; null clears. */
export function cleanWatch(list, nowS) {
    if (!Array.isArray(list)) return null;
    return { at: nowS, list: uniqueById(list.slice(0, MAX_WATCH).map((x) => cleanPlayer(x, true))) };
}

export function targetsOf(user) {
    const t = parse(user.targets, null);
    return t && typeof t === 'object' ? { at: Number(t.at) || 0, list: Array.isArray(t.list) ? t.list : [], bands: t.bands && typeof t.bands === 'object' ? t.bands : {} } : { at: 0, list: [], bands: {} };
}

/** The synced war list, or null. */
export function warListOf(user) {
    const w = parse(user && user.war_list, null);
    return w && typeof w === 'object' && Array.isArray(w.members) ? w : null;
}

/** The synced watch list ([] when none). */
export function watchListOf(user) {
    const w = parse(user && user.watch_list, null);
    return w && Array.isArray(w.list) ? w.list.filter((x) => x && posInt(x.id)) : [];
}

/** "**Good** (win 97%, keeps 81% life)"; a band stored before round 7's deploy (Tough, Can't win) reads as under 50%. */
export function estimateText(t) {
    const bits = [];
    if (t.win !== undefined && t.win !== null) bits.push('win ' + Math.round(t.win) + '%');
    if (t.keep !== undefined && t.keep !== null) bits.push('keeps ' + Math.round(t.keep) + '% life');
    return '**' + BAND_WORDS[normBand(t.band)] + '**' + (bits.length ? ' (' + bits.join(', ') + ')' : '');
}

export async function targetsCmd(user, i, env, fetchImpl, ctx, nowS) {
    const t = targetsOf(user);
    if (!t.list.length) return reply('No targets synced yet. Open Torn Eye in Pumping Iron once; it sends its list by itself.');
    const top = t.list.slice(0, 10);
    const lines = top.map((x) => estimateText(x) + ' · ' + x.name + ' [' + x.id + ']' + (x.level ? ' · Lv ' + x.level : ''));
    const buttons = top.slice(0, 5).map((x) => linkButton('Attack ' + x.name, PAGES.attack(x.id)));
    return reply(['**Your Torn Eye list**', ...lines, '', 'Synced ' + dur(nowS - t.at) + ' ago. Estimates, not promises. You attack in Torn yourself.'].join('\n'), { components: [actionRow(buttons)] });
}

export function statusText(status, nowS) {
    const s = status || {};
    const until = Number(s.until) || 0;
    if (s.state === 'Hospital' && until > nowS) return 'In hospital, out ' + clock(until) + ' (' + rel(until) + ')';
    if (s.state === 'Jail' && until > nowS) return 'In jail, out ' + clock(until) + ' (' + rel(until) + ')';
    if (s.state === 'Traveling' || s.state === 'Abroad') return s.description || s.state;
    return s.description || s.state || 'Unknown';
}

export async function targetCmd(user, i, env, fetchImpl, ctx, nowS) {
    const id = Math.round(Number(opts(i).id));
    if (!(id > 0)) return reply('A Torn player id is a number, like 1234567.');
    return withTorn(user, i, env, fetchImpl, ctx, nowS, async (key) => {
        const d = await playerBasic(fetchImpl, key, id);
        const p = (d && (d.profile || d)) || {};
        const t = targetsOf(user);
        const known = t.list.find((x) => Number(x.id) === id) || (t.bands[id] ? { band: t.bands[id] } : null);
        const lines = ['**' + (p.name || 'Player') + '** [' + id + ']' + (p.level ? ' · Lv ' + p.level : ''), 'Status: ' + statusText(p.status, nowS), 'Torn Eye: ' + (known ? estimateText(known) : 'no estimate synced (open their profile with Pumping Iron once)')];
        return { content: lines.join('\n'), components: [actionRow([linkButton('Attack', PAGES.attack(id)), linkButton('Profile', PAGES.profile(id))])] };
    });
}

/* ---------- /war and /chain ---------- */

export async function warCmd(user, i, env, fetchImpl, ctx, nowS) {
    const o = opts(i);
    const asked = Math.round(Number(o.faction)) || null;
    const page = Math.max(1, Math.round(Number(o.page)) || 1);
    if (!asked && !user.faction_id) return reply('The bot doesn’t know your faction yet: open Pumping Iron once (it sends it), or ask for one: `/war faction:<id>`.');
    return withTorn(user, i, env, fetchImpl, ctx, nowS, async (key) => {
        let war;
        if (asked) war = { enemy: asked, enemyName: 'faction ' + asked, start: 0 };
        else {
            war = findWar(await factionWars(fetchImpl, key), user.faction_id, nowS);
            if (!war) return { content: 'No war right now. `/war faction:<id>` shows any faction.' };
        }
        const data = await factionMembers(fetchImpl, key, war.enemy);
        const players = membersOf(data).map(playerNow).filter((p) => p.id);
        const est = estimator(warListOf(user), war.enemy, targetsOf(user).bands);
        // The cron's last read of this faction knows when flights were first seen (landing estimates).
        const kept = parse(user.war, null);
        const snap = kept && Number(kept.enemy) === Number(war.enemy) && kept.snap ? kept.snap : null;
        const pages = warPages(war, players, est, snap, nowS);
        const n = Math.min(page, pages.length);
        const ready = warGroups(players, est, nowS).hit.filter((p) => BEATABLE.has(est(p.id).band));
        const attack = ready.slice(0, 4).map((x) => linkButton('Attack ' + x.name, PAGES.attack(x.id)));
        // Discord's limit is 2,000 characters, the "(Only N pages.)" line included.
        const note = page > pages.length ? '(Only ' + pages.length + ' page' + (pages.length === 1 ? '' : 's') + '.)\n' : '';
        return { content: note + pages[n - 1].slice(0, 2000 - note.length), components: [actionRow([...attack, linkButton('Faction', PAGES.faction(war.enemy))])] };
    });
}

export async function chainCmd(user, i, env, fetchImpl, ctx, nowS) {
    return withTorn(user, i, env, fetchImpl, ctx, nowS, async (key) => {
        const c = ((await factionChain(fetchImpl, key)) || {}).chain || {};
        return { content: chainText(c, nowS), components: [actionRow([linkButton('Your faction', PAGES.myFaction)])] };
    });
}

export async function timersCmd(user, i, env, fetchImpl, ctx, nowS) {
    return withTorn(user, i, env, fetchImpl, ctx, nowS, async (key) => {
        const s = await userState(fetchImpl, key);
        return { content: timersText(s, nowS), components: [actionRow([linkButton('Items', PAGES.items), linkButton('Gym', PAGES.gym)])] };
    });
}
