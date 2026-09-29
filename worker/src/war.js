/*
 * Wars and chains, from the user's own key only (faction: wars, members,
 * chain). The Worker never attacks: every Attack button is a link.
 *
 *   /war    who in the enemy faction you can hit now, who is out of
 *           hospital next, who is travelling; coloured by your synced
 *           Torn Eye bands
 *   /chain  your faction's chain and its timeout
 *   cron    wars are checked every 10 minutes; during one, the enemy
 *           faction is read once a minute and a Stomp or Good target out
 *           of hospital (or out within 2 minutes) gets one message, edited
 *           in place as the list changes (a new message at most every 30
 *           minutes). Chain pings (off unless switched on): the chain has
 *           10+ hits and under 60 seconds left.
 */

import { Q } from './db.js';
import { factionWars, factionMembers, factionChain } from './torn.js';
import { PAGES, clock, rel, dur } from './format.js';
import { editAlertMessage } from './deliver.js';

export const WAR_CHECK_S = 10 * 60;
export const WAR_SOON_S = 2 * 60;
export const WAR_MESSAGE_S = 30 * 60;
export const CHAIN_MIN_HITS = 10;
export const CHAIN_WARN_S = 60;
export const CHAIN_MESSAGE_S = 10 * 60;

const BAND_ORDER = ['stomp', 'good', 'tough', 'cant', 'none'];
const BAND_WORDS = { stomp: 'Stomp', good: 'Good', tough: 'Tough', cant: 'Can’t win', none: 'No data' };
const EASY = new Set(['stomp', 'good']);

/** The war the user's faction is in now (or about to be): ranked wars and raids. */
export function findWar(data, factionId, nowS) {
    const w = (data && data.wars) || {};
    const list = [];
    if (w.ranked && typeof w.ranked === 'object') list.push({ ...w.ranked, kind: 'ranked' });
    for (const r of Array.isArray(w.raids) ? w.raids : []) list.push({ ...r, kind: 'raid' });
    for (const x of list) {
        const factions = Array.isArray(x.factions) ? x.factions : [x.aggressor, x.defender].filter(Boolean);
        if (!factions.some((f) => Number(f.id) === Number(factionId))) continue;
        const end = Number(x.end) || 0;
        if (end && end <= nowS) continue;
        const enemy = factions.find((f) => Number(f.id) !== Number(factionId));
        if (!enemy) continue;
        return { id: String(x.war_id || x.id || x.start), kind: x.kind, start: Number(x.start) || 0, end, enemy: Number(enemy.id), enemyName: String(enemy.name || 'the enemy') };
    }
    return null;
}

export function membersOf(data) {
    const m = data && data.members;
    const list = Array.isArray(m) ? m : m && typeof m === 'object' ? Object.entries(m).map(([id, v]) => ({ id: Number(id), ...v })) : [];
    return list.filter((x) => x && x.id);
}

/** Split an enemy faction by what you can do about each member now. */
export function warView(members, bands, nowS) {
    const band = (id) => (bands && bands[id]) || 'none';
    const rank = (x) => BAND_ORDER.indexOf(x.band);
    const all = members.map((x) => ({ id: Number(x.id), name: String(x.name || x.id), level: Number(x.level) || 0, band: band(x.id), state: (x.status && x.status.state) || '', until: Number(x.status && x.status.until) || 0, description: (x.status && x.status.description) || '' }));
    const hit = all.filter((x) => x.state === 'Okay').sort((a, b) => rank(a) - rank(b) || a.level - b.level);
    const hospital = all.filter((x) => x.state === 'Hospital' && x.until > nowS).sort((a, b) => a.until - b.until);
    const away = all.filter((x) => x.state === 'Traveling' || x.state === 'Abroad');
    return { hit, hospital, away };
}

const who = (x) => '**' + BAND_WORDS[x.band] + '** · ' + x.name + (x.level ? ' · Lv ' + x.level : '');

export function warText(war, view, nowS) {
    const lines = ['**War vs ' + war.enemyName + '**' + (war.start > nowS ? ' (starts ' + clock(war.start) + ' · ' + rel(war.start) + ')' : '')];
    lines.push('', '**Hit now** (' + view.hit.length + ')');
    lines.push(...(view.hit.length ? view.hit.slice(0, 8).map(who) : ['Nobody out of hospital.']));
    if (view.hospital.length) lines.push('', '**Out of hospital next**', ...view.hospital.slice(0, 8).map((x) => who(x) + ' · out ' + clock(x.until) + ' (' + rel(x.until) + ')'));
    if (view.away.length) lines.push('', '**Travelling** (' + view.away.length + ')', ...view.away.slice(0, 5).map((x) => x.name + ' · ' + (x.description || 'travelling')));
    lines.push('', 'Bands from your last Torn Eye sync. You attack in Torn yourself.');
    return lines.join('\n');
}

/** The easy targets for the war ping: out now, or out within 2 minutes. */
export function easyTargets(view, nowS) {
    return [...view.hit.filter((x) => EASY.has(x.band)), ...view.hospital.filter((x) => EASY.has(x.band) && x.until - nowS <= WAR_SOON_S)];
}

export function warBody(war, easy, nowS) {
    const lines = easy.slice(0, 8).map((x) => who(x) + ' · ' + (x.state === 'Okay' ? 'out now' : 'out ' + clock(x.until) + ' (' + rel(x.until) + ')'));
    return {
        kind: 'war',
        title: easy.length ? 'War: ' + easy.length + ' Stomp or Good to hit' : 'War: none to hit right now',
        text: (lines.length ? lines.join('\n') : 'Nobody easy is out. This message updates by itself.') + '\nvs ' + war.enemyName + '. You attack in Torn yourself.',
        link: PAGES.faction(war.enemy),
        attack: easy.slice(0, 4).map((x) => ({ id: x.id, name: x.name })),
        step: null,
    };
}

export function chainText(c, nowS) {
    const cur = Number(c.current) || 0;
    const to = Number(c.timeout) || 0;
    const cd = Number(c.cooldown) || 0;
    if (cd > 0) return 'Chain on cooldown: ends ' + clock(nowS + cd) + ' (' + rel(nowS + cd) + ').';
    if (cur <= 0 || to <= 0) return 'No chain running.';
    return '**Chain ' + cur + '** / ' + (Number(c.max) || '?') + ' · times out in ' + dur(to) + ' (' + rel(nowS + to) + ')' + (c.modifier ? ' · bonus ×' + c.modifier : '');
}

/* ---------- cron ---------- */

/** Edit a live message (war or chain) when its text changed. */
async function refresh(env, f, db, user, existing, body) {
    const text = JSON.stringify(body);
    if ((existing.state || 'sent') !== 'sent' || !existing.message || existing.body === text) return 0;
    await db.prepare(Q.sentBody).bind(text, user.id, existing.alert).run();
    await editAlertMessage(env, f, db, user, [{ ...existing, body: text }]);
    return 1;
}

/**
 * One minute of war for one user. `send(alerts)` sends through the normal
 * path (caps, quiet hours already checked by `mayStart`).
 * @returns {Promise<object>} the war state to keep in users.war
 */
export async function warTick({ env, f, db, user, key, nowS, rows, war, bands, mayStart, send }) {
    if (!war || nowS - (Number(war.checked) || 0) >= WAR_CHECK_S) war = { checked: nowS, ...(findWar(await factionWars(f, key), user.faction_id, nowS) || {}) };
    if (!war.enemy || war.start > nowS || (war.end && war.end <= nowS)) return war;
    const view = warView(membersOf(await factionMembers(f, key, war.enemy)), bands, nowS);
    const easy = easyTargets(view, nowS);
    const body = warBody(war, easy, nowS);
    const id = 'war:' + war.id + ':' + Math.floor(nowS / WAR_MESSAGE_S);
    const existing = rows.find((r) => r.alert === id);
    if (existing) {
        await refresh(env, f, db, user, existing, body);
        return war;
    }
    // Done on this war's ping: no more for this war.
    if (rows.some((r) => String(r.alert).startsWith('war:' + war.id + ':') && r.state === 'done')) return war;
    if (easy.length && mayStart()) await send([{ id, ...body }]);
    return war;
}

export async function chainTick({ env, f, db, user, key, nowS, rows, mayStart, send }) {
    const c = ((await factionChain(f, key)) || {}).chain || {};
    const cur = Number(c.current) || 0;
    const to = Number(c.timeout) || 0;
    if (cur < CHAIN_MIN_HITS || to <= 0 || to > CHAIN_WARN_S) return;
    const body = { kind: 'chain', title: 'Chain ' + cur + ': under a minute left', text: 'Times out ' + rel(nowS + to) + ' (' + clock(nowS + to) + ' TCT). A hit keeps it going. You attack in Torn yourself.', link: PAGES.myFaction, step: null };
    const id = 'chain:' + (c.start || c.id || 0) + ':' + Math.floor(nowS / CHAIN_MESSAGE_S);
    const existing = rows.find((r) => r.alert === id);
    if (existing) return refresh(env, f, db, user, existing, body);
    if (mayStart()) await send([{ id, ...body }]);
}
