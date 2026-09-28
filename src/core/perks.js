/*
 * Parse `/v2/user/perks` into what the gym maths needs. Pure.
 *
 * Every perk line is its own multiplier (1 + p): faction steadfast,
 * education courses, property, company, books, enhancers. Lines we don't
 * understand are kept in `unknown` for Settings › Diagnostics, never guessed.
 * String forms come from the API (research-api-shapes.md §2), TornTools'
 * company table and Torn's item effects (research-gym.md).
 */

import { STATS } from './gain.js';

const STAT_WORD = { strength: 'str', speed: 'spd', defense: 'def', defence: 'def', dexterity: 'dex', str: 'str', spd: 'spd', def: 'def', dex: 'dex' };

// "+ 20% strength gym gains", "10% dexterity gym gains"
const RE_STAT = /([+-]?\s*\d+(?:\.\d+)?)\s*%\s+(?:to\s+)?(strength|speed|defen[sc]e|dexterity|str|spd|def|dex)\s+gym\s+gains?/i;
// "+ 2% gym gains", "3% gym gains", "+1% to all gym gains"
const RE_ALL = /([+-]?\s*\d+(?:\.\d+)?)\s*%\s+(?:to\s+)?(?:all\s+)?gym\s+gains?/i;
// "Increases speed gym gains by 15%", "Incr. Str gym gains by 30% (31 days)."
const RE_BOOK_STAT = /(?:increases?|incr\.)\s+(strength|speed|defen[sc]e|dexterity|str|spd|def|dex)\s+gym\s+gains?\s+by\s+(\d+(?:\.\d+)?)\s*%/i;
// "Increases all gym gains by 20% for 31 days"
const RE_BOOK_ALL = /(?:increases?|incr\.)\s+(?:all\s+)?gym\s+gains?\s+by\s+(\d+(?:\.\d+)?)\s*%/i;
// Ignorance Is Bliss (item 770): "Happiness can regenerate above maximum for 31 days."
const RE_BLISS = /happiness\s+can\s+regenerate\s+above\s+maximum/i;
// Music Store "Well Tuned": "30% gym experience" (unlock thresholds ÷ 1.3)
const RE_GYM_XP = /(\d+(?:\.\d+)?)\s*%\s+gym\s+experience/i;
// "Goal Oriented": "50% happy loss reduction in gym"
const RE_HAPPY_LOSS = /(\d+(?:\.\d+)?)\s*%\s+happy\s+loss\s+reduction/i;
// "31 days", "(12 days)" - how long a book lasts
const RE_DAYS = /(\d+)\s*days?/i;

const num = (s) => Number(String(s).replace(/\s+/g, ''));

/**
 * @param {object} perks - the `perks` object of /v2/user/perks: {faction:[], job:[], property:[], education:[], enhancer:[], book:[], stock:[], merit:[]}
 * @returns {{mult:{str,spd,def,dex}, lines:object[], bliss:boolean, blissDays:number|null, gymExpMult:number, happyLossMult:number, books:object[], unknown:string[]}}
 */
export function parsePerks(perks) {
    const mult = { str: 1, spd: 1, def: 1, dex: 1 };
    const lines = [];
    const books = [];
    const unknown = [];
    let bliss = false;
    let blissDays = null;
    let gymExpMult = 1;
    let happyLossMult = 1;

    const src = perks && typeof perks === 'object' ? perks : {};
    for (const [source, list] of Object.entries(src)) {
        if (!Array.isArray(list)) continue;
        for (const raw of list) {
            const text = String(raw || '').trim();
            if (!text) continue;
            let m;
            if (RE_BLISS.test(text)) {
                bliss = true;
                const d = text.match(RE_DAYS);
                blissDays = d ? Number(d[1]) : null;
                books.push({ kind: 'bliss', text });
                continue;
            }
            if ((m = text.match(RE_GYM_XP))) {
                gymExpMult *= 1 + num(m[1]) / 100;
                continue;
            }
            if ((m = text.match(RE_HAPPY_LOSS))) {
                happyLossMult *= Math.max(0, 1 - num(m[1]) / 100);
                continue;
            }
            let stat = null;
            let pct = null;
            if ((m = text.match(RE_BOOK_STAT))) {
                stat = STAT_WORD[m[1].toLowerCase()];
                pct = num(m[2]);
            } else if ((m = text.match(RE_STAT))) {
                stat = STAT_WORD[m[2].toLowerCase()];
                pct = num(m[1]);
            } else if ((m = text.match(RE_BOOK_ALL)) || (m = text.match(RE_ALL))) {
                pct = num(m[1]);
            }
            if (pct === null || !Number.isFinite(pct)) {
                // Only gym-looking lines are worth a diagnostics line.
                if (/gym|happi|energy/i.test(text)) unknown.push(source + ': ' + text);
                continue;
            }
            const f = 1 + pct / 100;
            for (const k of stat ? [stat] : STATS) mult[k] *= f;
            lines.push({ source, stat: stat || 'all', pct, text });
            if (source === 'book') {
                const d = text.match(RE_DAYS);
                books.push({ kind: stat ? 'stat' : 'all', stat, pct, days: d ? Number(d[1]) : null, text });
            }
        }
    }
    return { mult, lines, bliss, blissDays, gymExpMult, happyLossMult, books, unknown };
}

/** No perks at all (the default before the API answers). */
export function noPerks() {
    return parsePerks({});
}
