/*
 * Gear (ENGINE-SPEC §11): the defender's items from the attack page's
 * `attackData` answer (read-only, when Torn shows them), and your own from
 * /user/equipment. Reduced to what the fight sim uses: best weapon damage
 * and accuracy, damage bonuses, average armour.
 */

import { DEFAULT_GEAR } from './fight.js';

const WEAPON_SLOTS = ['1', '2', '3'];
const ARMOUR_SLOTS = ['4', '6', '7', '8', '9'];
const TEMP_SLOT = '5';
const DAMAGE_BONUSES = /^(Powerful|Specialist|Empower|Deadeye)$/i;

function numOr(v, d = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
}

/**
 * Is the fight over? Either side's life at 0, or Torn's attackStatus saying so [check live: its word once a fight has
 * ended is in no source read; "end" and the like are guesses]. Any other word: not over (the Next button then just
 * does not glow; it works all the same).
 */
export function fightOver(db) {
    if (!db || typeof db !== 'object') return false;
    const life = db.usersLife || {};
    const zero = (side) => Boolean(side) && side.currentLife !== undefined && side.currentLife !== null && Number(side.currentLife) <= 0;
    if (zero(life.attacker) || zero(life.defender)) return true;
    return /^(end|ended|finished|over|won|lost|stalemate|timeout|escaped?)$/i.test(String(db.attackStatus || ''));
}

/** The attackData JSON (with or without the DB wrapper) → the defender's side. */
export function parseAttackData(json) {
    const db = json && (json.DB || json);
    if (!db || typeof db !== 'object') return null;
    const du = db.defenderUser || {};
    const items = [];
    for (const [slot, box] of Object.entries(db.defenderItems || {})) {
        const list = box && Array.isArray(box.item) ? box.item : [];
        for (const it of list) {
            if (!it) continue;
            items.push({
                slot: String(slot),
                id: numOr(it.ID, null),
                name: String(it.name || ''),
                armouryId: it.armouryID || it.armoryID ? String(it.armouryID || it.armoryID) : null,
                dmg: numOr(it.dmg),
                acc: numOr(it.acc, 50),
                armour: numOr(it.arm ?? it.armor ?? it.armour),
                bonuses: Object.values(it.currentBonuses || {}).map((b) => ({ title: String(b.title || ''), value: numOr(b.value) })),
            });
        }
    }
    const real = items.filter((i) => Number(i.slot) >= 1 && Number(i.slot) <= 9 && i.armouryId && i.armouryId !== '0');
    const visible = real.length > 0 || db.showEnemyItems === true;
    // Their temporary (slot 5) has no copy id of its own: kept, for the fight card, once their gear shows.
    const temps = visible ? items.filter((i) => i.slot === TEMP_SLOT && i.name && !real.includes(i)) : [];
    return {
        defenderId: numOr(du.userID, null),
        defenderName: du.playername || null,
        level: numOr(du.level, null),
        maxLife: numOr(du.maxlife ?? (db.usersLife && db.usersLife.defender && db.usersLife.defender.maxLife), null),
        attackerId: db.attackerUser ? numOr(db.attackerUser.userID, null) : null,
        status: db.attackStatus || null,
        over: fightOver(db),
        visible,
        items: real.concat(temps).sort((a, b) => Number(a.slot) - Number(b.slot)),
    };
}

/** Is this the same gear (the same copies in the same slots, with the same numbers)? */
export function sameGear(a, b) {
    const sig = (list) => (list || []).map((i) => [i.slot, i.id, i.armouryId, i.dmg, i.acc, i.armour].join(':')).sort().join('|');
    return sig(a) === sig(b);
}

/**
 * Two copies of the stored gear ({playerId: {items, seenAt}}) as one: per player the one seen last. Round 8 (B.6):
 * each Torn tab wrote its own whole copy, so a tab that loaded before a fight wiped the gear that fight saved.
 * @param {number} [clearedAt] - a Clear on either site (ms): gear seen before it is left out
 */
export function mergeGear(a, b, clearedAt = 0) {
    const out = {};
    for (const src of [a, b]) {
        for (const [id, rec] of Object.entries(src || {})) {
            if (!rec || !Array.isArray(rec.items) || (Number(rec.seenAt) || 0) < clearedAt) continue;
            if (!out[id] || (Number(out[id].seenAt) || 0) < (Number(rec.seenAt) || 0)) out[id] = rec;
        }
    }
    return out;
}

/** The pieces the sim reads of a set of items: the weapons and armour with a number, the best weapon, the armour sets' names. */
function gearParts(items) {
    const list = items || [];
    const weapons = list.filter((i) => WEAPON_SLOTS.includes(String(i.slot)) && i.dmg > 0);
    const armours = list.filter((i) => ARMOUR_SLOTS.includes(String(i.slot)) && i.armour > 0);
    const best = weapons.reduce((a, w) => (!a || w.dmg > a.dmg ? w : a), null);
    return { weapons, armours, best, sets: [...new Set(armours.map((a) => a.name.split(' ')[0]))] };
}

/** What the sim uses from a set of items: {dmg, acc, armour, dmgBonus, text}. */
export function gearSummary(items) {
    const { weapons, armours, best, sets } = gearParts(items);
    if (!weapons.length && !armours.length) return null;
    const dmgBonus = best ? best.bonuses.filter((b) => DAMAGE_BONUSES.test(b.title) && !/deadeye/i.test(b.title)).reduce((a, b) => a + b.value, 0) : 0;
    const armour = armours.length ? armours.reduce((a, x) => a + x.armour, 0) / Math.max(armours.length, 5) : DEFAULT_GEAR.armour;
    const words = [];
    if (best) words.push(best.name + (best.bonuses.length ? ' · ' + best.bonuses.map((b) => b.title + ' ' + b.value + '%').join(', ') : ''));
    if (sets.length) words.push(sets.join('/') + ' armour');
    return { dmg: best ? best.dmg : DEFAULT_GEAR.dmg, acc: best ? best.acc : DEFAULT_GEAR.acc, armour, dmgBonus, text: words.join(' · ') };
}

/** /v2/user/equipment's pieces as the sim's items (every weapon in a weapon slot, every armour piece in an armour slot). */
function equipmentItems(equipment) {
    const list = (equipment && equipment.equipment) || [];
    return list.map((e) => ({
        slot: e.type === 'Weapon' || e.sub_type === 'Primary' || e.sub_type === 'Secondary' || e.sub_type === 'Melee' ? '1' : e.type === 'Armor' || e.type === 'Defensive' ? '4' : String(e.slot || ''),
        name: e.name || '',
        dmg: numOr(e.stats && e.stats.damage),
        acc: numOr(e.stats && e.stats.accuracy, 50),
        armour: numOr(e.stats && (e.stats.armor ?? e.stats.armour)),
        bonuses: (e.bonuses || []).map((b) => ({ title: String(b.title || ''), value: numOr(b.value) })),
    }));
}

/** Your own gear from /v2/user/equipment. */
export function myGear(equipment) {
    return gearSummary(equipmentItems(equipment)) || DEFAULT_GEAR;
}

/* ------------------------------------------------ round 8: the loadout on the fight card (torn-eye.html §5, his pick B) */

const GEAR_SLOT_WORDS = { 1: 'Primary', 2: 'Secondary', 3: 'Melee', 5: 'Temporary' };

/**
 * The fight card's two lists from the stored items: weapons (primary, secondary, melee, temporary) and armour (head
 * to foot), each piece with its own numbers. A number Torn did not give is null (shown empty, never made up).
 * @returns {{weapons: {name, sub, dmg, acc}[], armour: {name, sub, armour}[]}}
 */
export function gearRows(items) {
    const list = items || [];
    const by = (order) => order.flatMap((s) => list.filter((i) => String(i.slot) === s));
    const bonus = (i) => (i.bonuses || []).filter((b) => b && b.title).map((b) => b.title + (b.value ? ' ' + b.value + '%' : '')).join(', ');
    const num = (v) => (Number(v) > 0 ? Number(v) : null);
    return {
        weapons: by([...WEAPON_SLOTS, TEMP_SLOT]).map((i) => ({ name: i.name, sub: [GEAR_SLOT_WORDS[i.slot], bonus(i)].filter(Boolean).join(' · '), dmg: i.slot === TEMP_SLOT ? null : num(i.dmg), acc: i.slot === TEMP_SLOT ? null : num(i.acc) })),
        armour: by(['6', '4', '7', '9', '8']).map((i) => ({ name: i.name, sub: bonus(i), armour: num(i.armour) })),
    };
}

/** "The fight counts their best weapon (68.2 damage, 57.4 accuracy, +24%) and their armour on average (45.3)." */
export function gearCountedText(items) {
    const g = gearSummary(items);
    if (!g) return '';
    const list = items || [];
    const one = (v) => (Math.round(v * 10) / 10).toFixed(1);
    const hasWeapon = list.some((i) => WEAPON_SLOTS.includes(String(i.slot)) && i.dmg > 0);
    const hasArmour = list.some((i) => ARMOUR_SLOTS.includes(String(i.slot)) && i.armour > 0);
    const weapon = hasWeapon ? 'their best weapon (' + one(g.dmg) + ' damage, ' + one(g.acc) + ' accuracy' + (g.dmgBonus ? ', +' + g.dmgBonus + '%' : '') + ')' : 'a usual weapon (none was seen)';
    const armour = hasArmour ? 'their armour on average (' + one(g.armour) + ')' : 'a usual armour (no armour value was seen)';
    return 'The fight counts ' + weapon + ' and ' + armour + '.';
}

/* ------------------------------------- round 9: your loadouts against their gear (companion.html §2, his pick B) */

/*
 * Torn's API has no saved loadouts, only what you wear now (/v2/user/equipment). Torn's items page names the loadout
 * worn ("Loadout #2"). So a loadout is learned when it is worn with that page open: its number from the page, its
 * gear from the API, kept per number with the time. What is kept is what the fight reads (gearSummary's four numbers)
 * and two names for the card. Nothing here asks or clicks anything.
 */

/** The highest loadout number kept [check live: how many loadouts Torn has was not read]. */
export const LOADOUT_MAX_N = 20;

/** Rows on the fight card (292 px wide, the training panel under it): the best, the one on you and two more. */
export const LOADOUT_ROWS = 4;

/**
 * What you wear (/v2/user/equipment) as a loadout: the gear the fight reads, its main weapon and its armour's name.
 * @returns {{gear: {dmg, acc, armour, dmgBonus}, weapon: string, armour: string}|null} null: never read, or nothing worn
 */
export function loadoutOf(equipment) {
    const items = equipmentItems(equipment);
    const g = gearSummary(items);
    if (!g) return null;
    const { best, sets } = gearParts(items);
    return { gear: { dmg: g.dmg, acc: g.acc, armour: g.armour, dmgBonus: g.dmgBonus }, weapon: best ? best.name : '', armour: sets.join('/') };
}

/** Is this the same loadout as far as the card and the fight can tell (the same names and the same four numbers)? */
export function sameLoadout(a, b) {
    const sig = (x) => (x && x.gear ? [x.weapon || '', x.armour || '', x.gear.dmg, x.gear.acc, x.gear.armour, x.gear.dmgBonus || 0].join('|') : null);
    const s = sig(a);
    return s !== null && s === sig(b);
}

function loadoutNumber(n) {
    const v = Number(n);
    return Number.isInteger(v) && v >= 1 && v <= LOADOUT_MAX_N ? v : null;
}

/** The kept loadouts ({n: {n, at, gear, weapon, armour}}) as a list by number; a record that is not one is left out. */
export function loadoutList(stored) {
    const out = [];
    for (const rec of Object.values(stored && typeof stored === 'object' ? stored : {})) {
        const n = rec && loadoutNumber(rec.n);
        const g = rec && rec.gear;
        if (!n || !g || !Number.isFinite(g.dmg) || !Number.isFinite(g.acc) || !Number.isFinite(g.armour)) continue;
        out.push({ n, at: Number(rec.at) || 0, gear: { dmg: g.dmg, acc: g.acc, armour: g.armour, dmgBonus: Number(g.dmgBonus) || 0 }, weapon: String(rec.weapon || ''), armour: String(rec.armour || '') });
    }
    return out.sort((a, b) => a.n - b.n);
}

/**
 * A reading of the loadout worn, kept under its number: it replaces what that number held (you changed the loadout),
 * and no other number is touched. `loadout` null (nothing is worn under that number now): the number is forgotten.
 * @param {object|null} stored - what is kept now, read just before the write (another tab may have written)
 * @returns {object} the new {n: record}
 */
export function withLoadout(stored, n, loadout, at) {
    const out = Object.fromEntries(loadoutList(stored).map((l) => [l.n, l]));
    const num = loadoutNumber(n);
    if (!num) return out;
    if (loadout && loadout.gear) out[num] = { n: num, at, gear: loadout.gear, weapon: loadout.weapon || '', armour: loadout.armour || '' };
    else delete out[num];
    return out;
}

/**
 * The rows of "Your loadouts against it", best first: every loadout kept and the one on you, each with the fight
 * card's own forecast against their seen gear. The one on you is the kept loadout that is this gear (its number is
 * then known), else a row without a number. At most `max` rows: the best, the one on you, then the next best.
 * @param {object} o
 * @param {object|null} o.worn - loadoutOf(what you wear now); null when it was never read
 * @param {object|null} o.stored - the kept loadouts
 * @param {function} o.fight - (gear, isWorn) => {pWin, keep}
 * @returns {{rows: {n, weapon, armour, pWin, keep, best, worn, seenAt}[], known: number, more: number}|null}
 *   known: how many loadouts there are to compare; more: how many of them are not shown. null: none is known.
 */
export function loadoutRows({ worn = null, stored = null, fight, max = LOADOUT_ROWS }) {
    const kept = loadoutList(stored);
    const on = worn && worn.gear ? worn : null;
    // Two kept loadouts with the same gear: the one read last is the one on you.
    const mine = on ? kept.filter((l) => sameLoadout(l, on)).sort((a, b) => b.at - a.at)[0] || null : null;
    const all = kept.map((l) => ({ n: l.n, weapon: l.weapon, armour: l.armour, gear: l === mine ? on.gear : l.gear, worn: l === mine, seenAt: l === mine ? null : l.at }));
    if (on && !mine) all.push({ n: null, weapon: on.weapon || '', armour: on.armour || '', gear: on.gear, worn: true, seenAt: null });
    if (!all.length) return null;
    for (const r of all) {
        const f = fight(r.gear, r.worn) || {};
        r.pWin = Number.isFinite(f.pWin) ? f.pWin : 0;
        r.keep = Number.isFinite(f.keep) ? f.keep : null;
    }
    // Best first: the win chance, then HP kept; a tie goes to the one on you (nothing to change), then the lower number.
    all.sort((a, b) => b.pWin - a.pWin || (b.keep ?? -1) - (a.keep ?? -1) || Number(b.worn) - Number(a.worn) || (a.n ?? 99) - (b.n ?? 99));
    if (all.length > 1) all[0].best = true;
    const shown = [];
    for (const r of all) if (r.best || r.worn) shown.push(r);
    for (const r of all) if (shown.length < max && !shown.includes(r)) shown.push(r);
    const rows = all.filter((r) => shown.includes(r)).map((r) => ({ n: r.n, weapon: r.weapon, armour: r.armour, pWin: r.pWin, keep: r.keep, best: Boolean(r.best), worn: r.worn, seenAt: r.seenAt }));
    return { rows, known: all.length, more: all.length - rows.length };
}

/*
 * When your gear is read on Torn's items page (pure; eye-service.js makes the read). The box that names the loadout
 * (#loadoutsRoot) is looked at once a second; its text is the mark of what you wear. Your gear is read from the API
 * once that text has stood still for LOADOUT_SETTLE_MS (a switch on Torn's own menu has gone through by then), and only
 * for a text not read yet: opening the items page costs one call, standing on it none. A text that changed while you
 * stood on the page (you switched, or changed a piece) is read once more LOADOUT_CONFIRM_MS later, in case Torn's
 * answer still held the gear from before. A text that never stands still is never read.
 */

/** [calibrate] The box must say the same for this long before your gear is read under its number. */
export const LOADOUT_SETTLE_MS = 3000;
/** [calibrate] After a change seen on the page: the second read, this long after the first. */
export const LOADOUT_CONFIRM_MS = 40 * 1000;
/** A read that failed is tried again after this long. */
export const LOADOUT_RETRY_MS = 60 * 1000;

/**
 * One look at the box.
 * @param {object|null} run - what the last look left
 * @param {{n: number, sig: string}|null} seen - the number and the text read now (null: no box, or no number in it)
 * @returns {{run: object, read: boolean}} read: ask the API for your gear now
 */
export function loadoutLook(run, seen, now) {
    const r = run || { n: null, sig: null, since: 0, readSig: null, confirmAt: 0, tryAt: 0, reads: 0 };
    const n = seen ? loadoutNumber(seen.n) : null;
    if (!n) return { run: { ...r, n: null, sig: null }, read: false };
    const sig = String(seen.sig || n);
    if (sig !== r.sig) return { run: { ...r, n, sig, since: now }, read: false };
    if (now - r.since < LOADOUT_SETTLE_MS || now < r.tryAt) return { run: r, read: false };
    return { run: r, read: r.readSig !== r.sig || (r.confirmAt > 0 && now >= r.confirmAt) };
}

/**
 * The read came back.
 * @param {object} run - the run now
 * @param {string} sig - the text the read was made for
 * @param {boolean} ok - Torn answered
 * @returns {{run: object, keep: boolean}} keep: the box still says what it said (the answer is that loadout's)
 */
export function loadoutAnswer(run, sig, ok, now) {
    if (!ok) return { run: { ...run, tryAt: now + LOADOUT_RETRY_MS }, keep: false };
    // The box moved on while Torn answered (another switch): the look that follows reads it again.
    if (run.sig !== sig) return { run, keep: false };
    const first = run.readSig !== sig;
    // The page's first read needs no second one; a change seen on the page does.
    return { run: { ...run, readSig: sig, reads: run.reads + 1, confirmAt: first && run.reads > 0 ? now + LOADOUT_CONFIRM_MS : 0 }, keep: true };
}
