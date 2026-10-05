/*
 * Back up and restore (round 9, the owner's pick 5B, mockups/round9/companion.html §5): one file with your settings,
 * build and plan, progress history, the Torn Eye list and what the gym learned; your API keys only when you tick it.
 * Never in the file: the Discord login (K.worker), the money log (read again from Torn) and anything a Torn page keeps
 * for itself (the gear Torn Eye saw is in torn.com's own storage, which the webpage cannot read).
 *
 * Pure: the page reads its stores into `read`, and applies the list of writes `restoreOps` gives back.
 */

export const BACKUP_APP = 'torn-pumping-iron';
export const BACKUP_FORMAT = 1;

/** Tampermonkey values in the file, by the card's words. Histories are read whole (the webpage's older part included). */
export const BACKUP_GM = {
    // The Discord ping ticks are settings too (which pings the bot sends); the login is not.
    settings: ['settings', 'pingTicks'],
    plan: ['plan', 'planNow', 'unlockedGyms', 'gymProgress', 'xanaxCds'],
    progress: ['statsHistory', 'dayLog', 'dayTotals', 'receipts'],
    eye: ['myAttacks', 'eyeWatch', 'eyeWarBands', 'eyeWarAsk', 'eyeWarAuto', 'eyeLoadouts'],
    learning: ['calibration', 'learned', 'eyePredictions'],
};
/** The webpage's own data (its IndexedDB). */
export const BACKUP_PAGE = { progress: ['planLine'], eye: ['eyeTargets'], learning: ['learnLog', 'fightLog'] };
/** Only with the tick. */
export const BACKUP_KEYS = ['apiKey', 'fullKey', 'ffsKey', 'tsKey'];
/** Never written to a file and never taken from one, whatever the file says. */
export const BACKUP_NEVER = ['worker', 'moneyLog', 'keyInfo', 'apiKeyDead', 'fullKeyState', 'ffsState', 'leader', 'devUnlocked'];

const BACKUP_GM_ALL = Object.values(BACKUP_GM).flat();
const BACKUP_PAGE_ALL = Object.values(BACKUP_PAGE).flat();

const backupStamp = (ms) => new Date(ms).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

/** The file's name says when keys are inside. */
export function backupFileName(now, withKeys = false) {
    return 'pumping-iron-backup-' + backupStamp(now) + (withKeys ? '-WITH-KEYS' : '') + '.json';
}

const backupHas = (v) => v !== null && v !== undefined && v !== '';

/**
 * @param {object} o
 * @param {{gm:function(string):*, page:function(string):*, key:function(string):string}} o.read - this browser's stores
 * @param {object|null} o.savedPlan - the whole saved plan (platform/plan-store.js)
 * @param {boolean} o.withKeys - the tick "Put my API keys in the file"
 * @returns {object} the file, as an object
 */
export function buildBackup({ read, savedPlan = null, withKeys = false, version = '', now = Date.now() }) {
    const gm = {};
    for (const k of BACKUP_GM_ALL) {
        const v = read.gm(k);
        if (backupHas(v)) gm[k] = v;
    }
    const page = {};
    for (const k of BACKUP_PAGE_ALL) {
        const v = read.page(k);
        if (backupHas(v)) page[k] = v;
    }
    const out = { app: BACKUP_APP, kind: 'backup', format: BACKUP_FORMAT, version, at: now, hasKeys: false, gm, page, savedPlan: savedPlan || null };
    if (withKeys) {
        const keys = {};
        for (const k of BACKUP_KEYS) {
            const v = String(read.key(k) || '').trim();
            if (v) keys[k] = v;
        }
        out.keys = keys;
        out.hasKeys = Object.keys(keys).length > 0;
    }
    return out;
}

/** "Sat 3 Oct" (UTC, as Torn's clock). */
export function backupDay(ms) {
    const d = new Date(ms);
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()] + ' ' + d.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
}

/**
 * Read a file's text: is it one of ours, and what is in it.
 * @returns {{ok:true, backup:object, at:number, day:string, version:string, hasKeys:boolean, parts:string[]}|{ok:false, error:string}}
 */
export function readBackup(text) {
    let b;
    try {
        b = JSON.parse(String(text || ''));
    } catch {
        return { ok: false, error: 'That file is not a Pumping Iron backup (it is not JSON).' };
    }
    if (!b || typeof b !== 'object' || b.app !== BACKUP_APP || b.kind !== 'backup') return { ok: false, error: 'That file is not a Pumping Iron backup.' };
    if (!(Number(b.format) >= 1) || Number(b.format) > BACKUP_FORMAT) return { ok: false, error: 'That backup was made by a newer Pumping Iron (format ' + b.format + '). Update the script first.' };
    if (!Number.isFinite(b.at)) return { ok: false, error: 'That backup has no date: it was not finished.' };
    const gm = b.gm && typeof b.gm === 'object' ? b.gm : {};
    const page = b.page && typeof b.page === 'object' ? b.page : {};
    const inFile = (group) => (BACKUP_GM[group] || []).some((k) => backupHas(gm[k])) || (BACKUP_PAGE[group] || []).some((k) => backupHas(page[k]));
    const parts = [];
    if (inFile('settings')) parts.push('settings');
    if (inFile('plan') || b.savedPlan) parts.push('your build and plan');
    if (inFile('progress')) parts.push('progress history');
    if (inFile('eye')) parts.push('the Torn Eye list');
    if (inFile('learning')) parts.push('what the gym learned');
    const keys = b.keys && typeof b.keys === 'object' ? BACKUP_KEYS.filter((k) => typeof b.keys[k] === 'string' && b.keys[k].trim()) : [];
    if (keys.length) parts.push(keys.length + ' API key' + (keys.length === 1 ? '' : 's'));
    return { ok: true, backup: b, at: b.at, day: backupDay(b.at), version: String(b.version || ''), hasKeys: keys.length > 0, parts };
}

/**
 * The writes a restore makes: everything the backup's kinds hold is replaced (a value the file lacks is removed), and
 * nothing else is touched. Keys are written only when the file has them; the Discord login never.
 * @returns {{gmSet:[string, *][], gmDel:string[], pageSet:[string, *][], keys:[string, string][], savedPlan:object|null}}
 */
export function restoreOps(backup) {
    const gm = backup && backup.gm && typeof backup.gm === 'object' ? backup.gm : {};
    const page = backup && backup.page && typeof backup.page === 'object' ? backup.page : {};
    const ops = { gmSet: [], gmDel: [], pageSet: [], keys: [], savedPlan: (backup && backup.savedPlan) || null };
    for (const k of BACKUP_GM_ALL) {
        if (BACKUP_NEVER.includes(k)) continue;
        if (backupHas(gm[k])) ops.gmSet.push([k, gm[k]]);
        else ops.gmDel.push(k);
    }
    for (const k of BACKUP_PAGE_ALL) if (!BACKUP_NEVER.includes(k)) ops.pageSet.push([k, backupHas(page[k]) ? page[k] : null]);
    const keys = backup && backup.keys && typeof backup.keys === 'object' ? backup.keys : {};
    for (const k of BACKUP_KEYS) if (typeof keys[k] === 'string' && keys[k].trim()) ops.keys.push([k, keys[k].trim()]);
    return ops;
}
