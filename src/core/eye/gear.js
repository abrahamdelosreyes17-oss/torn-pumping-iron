/*
 * Gear (ENGINE-SPEC §11): the defender's items from the attack page's
 * `attackData` answer (read-only, when Torn shows them), and your own from
 * /user/equipment. Reduced to what the fight sim uses: best weapon damage
 * and accuracy, damage bonuses, average armour.
 */

import { DEFAULT_GEAR } from './fight.js';

const WEAPON_SLOTS = ['1', '2', '3'];
const ARMOUR_SLOTS = ['4', '6', '7', '8', '9'];
const DAMAGE_BONUSES = /^(Powerful|Specialist|Empower|Deadeye)$/i;

function numOr(v, d = 0) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
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
    return {
        defenderId: numOr(du.userID, null),
        defenderName: du.playername || null,
        level: numOr(du.level, null),
        maxLife: numOr(du.maxlife ?? (db.usersLife && db.usersLife.defender && db.usersLife.defender.maxLife), null),
        attackerId: db.attackerUser ? numOr(db.attackerUser.userID, null) : null,
        status: db.attackStatus || null,
        visible: real.length > 0 || db.showEnemyItems === true,
        items: real,
    };
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
