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

/** What the sim uses from a set of items: {dmg, acc, armour, dmgBonus, text}. */
export function gearSummary(items) {
    const list = items || [];
    const weapons = list.filter((i) => WEAPON_SLOTS.includes(String(i.slot)) && i.dmg > 0);
    const armours = list.filter((i) => ARMOUR_SLOTS.includes(String(i.slot)) && i.armour > 0);
    if (!weapons.length && !armours.length) return null;
    const best = weapons.reduce((a, w) => (!a || w.dmg > a.dmg ? w : a), null);
    const dmgBonus = best ? best.bonuses.filter((b) => DAMAGE_BONUSES.test(b.title) && !/deadeye/i.test(b.title)).reduce((a, b) => a + b.value, 0) : 0;
    const armour = armours.length ? armours.reduce((a, x) => a + x.armour, 0) / Math.max(armours.length, 5) : DEFAULT_GEAR.armour;
    const words = [];
    if (best) words.push(best.name + (best.bonuses.length ? ' · ' + best.bonuses.map((b) => b.title + ' ' + b.value + '%').join(', ') : ''));
    const sets = [...new Set(armours.map((a) => a.name.split(' ')[0]))];
    if (sets.length) words.push(sets.join('/') + ' armour');
    return { dmg: best ? best.dmg : DEFAULT_GEAR.dmg, acc: best ? best.acc : DEFAULT_GEAR.acc, armour, dmgBonus, text: words.join(' · ') };
}

/** Your own gear from /v2/user/equipment. */
export function myGear(equipment) {
    const list = (equipment && equipment.equipment) || [];
    const items = list.map((e) => ({
        slot: e.type === 'Weapon' || e.sub_type === 'Primary' || e.sub_type === 'Secondary' || e.sub_type === 'Melee' ? '1' : e.type === 'Armor' || e.type === 'Defensive' ? '4' : String(e.slot || ''),
        name: e.name || '',
        dmg: numOr(e.stats && e.stats.damage),
        acc: numOr(e.stats && e.stats.accuracy, 50),
        armour: numOr(e.stats && (e.stats.armor ?? e.stats.armour)),
        bonuses: (e.bonuses || []).map((b) => ({ title: String(b.title || ''), value: numOr(b.value) })),
    }));
    return gearSummary(items) || DEFAULT_GEAR;
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
