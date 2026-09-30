/*
 * The income that is certain (round 6, R6.4; docs/research-passive-income.md):
 * the city bank investment's profit, money dividends from stocks, and rent
 * from properties you rent out. Pure. It is the floor under Auto's income:
 * a bad month (losses, a 30-day window that missed the bank payout) can't
 * push the plan's money below what is certain to come in, and Auto can plan
 * on the Limited key alone.
 */

import { DAY } from './bars.js';

/** Bank investment and dividend lines in the money log: counted by the floor, not again as "other" income [verify]. */
export const FLOOR_LOG_WORDS = /(matur|invest|dividend|city bank|bank interest)/i;

/** The first dollar amount in a dividend's description ("$50,000,000" → 50000000); null for item dividends. */
export function dividendMoney(description) {
    const m = String(description || '').match(/^\s*\$\s?([\d,]+)/);
    return m ? Number(m[1].replace(/,/g, '')) : null;
}

/**
 * @param {object} o
 * @param {object|null} o.cityBank - /user/money city_bank {amount, profit, duration (days), until (s)}
 * @param {object[]} o.userStocks - /user/stocks [{id, shares, bonus: {increment, frequency}}]
 * @param {object[]} o.tornStocks - /torn/stocks [{id, name, acronym, bonus: {passive, frequency, description}}]
 * @param {object[]} o.properties - /user/properties?filters=ownedByUser (rented ones carry cost_per_day)
 * @param {number|null} o.meId - your player id (only your own properties' rent)
 * @param {number} o.now
 * @returns {{perDay:number, bank:number, dividends:number, rent:number, lines:{what:string, perDay:number, until?:number}[]}}
 */
export function incomeFloor({ cityBank = null, userStocks = [], tornStocks = [], properties = [], meId = null, now }) {
    const lines = [];
    let bank = 0;
    // The investment's own numbers: profit over its term, merits and bank perks included. Once it has ended it pays
    // nothing more until it's renewed.
    if (cityBank && cityBank.profit > 0 && cityBank.duration > 0 && !(cityBank.until && cityBank.until * 1000 < now)) {
        bank = cityBank.profit / cityBank.duration;
        lines.push({ what: 'City bank', perDay: bank, until: cityBank.until ? cityBank.until * 1000 : null });
    }
    let dividends = 0;
    const info = new Map((tornStocks || []).map((s) => [Number(s.id), s]));
    for (const us of userStocks || []) {
        const b = us && us.bonus;
        const s = info.get(Number(us && us.id));
        if (!b || !s || !s.bonus || !(b.increment > 0)) continue;
        // Money dividends only (item ones pay items, not cash): the amount × blocks held ÷ days between payouts.
        const amount = dividendMoney(s.bonus.description);
        const freq = Number(b.frequency) || Number(s.bonus.frequency) || 0;
        if (!(amount > 0) || !(freq > 0)) continue;
        const perDay = (amount * b.increment) / freq;
        dividends += perDay;
        lines.push({ what: (s.acronym || s.name || 'Stock ' + us.id) + ' dividend', perDay });
    }
    let rent = 0;
    for (const p of properties || []) {
        if (!p || p.status !== 'rented' || !(p.cost_per_day > 0) || !(p.rental_period_remaining > 0)) continue;
        if (meId && p.owner && Number(p.owner.id) !== Number(meId)) continue;
        rent += p.cost_per_day;
        lines.push({ what: 'Rent · ' + ((p.property && p.property.name) || 'property'), perDay: p.cost_per_day, until: now + p.rental_period_remaining * DAY });
    }
    return { perDay: bank + dividends + rent, bank, dividends, rent, lines: lines.sort((a, b) => b.perDay - a.perDay) };
}
