/*
 * The player's company job and what it does for a gym plan. Pure.
 *
 * Sources: docs/research-events-perks.md §2a (TornTools' table of company
 * specials, built from /torn/companies), the wiki's Company page (1 job
 * point per company star per day, points kept until spent, specials locked
 * 72 h after joining). Shapes: /v2/user/job (Public) answers
 * {job: {type:'company', id, type_id, name, rating, position, days_in_company}}
 * or a city job or null; /v2/user/jobpoints (Minimal) answers
 * {jobpoints: {jobs:{...}, companies:[{company:{id: typeId, name}, points}]}}.
 */

/**
 * Company type ids → names [verify: the ids are the usual /torn/companies
 * numbering; the job-points answer carries the name, which wins when present].
 */
export const COMPANY_TYPES = {
    1: 'Hair Salon',
    2: 'Law Firm',
    3: 'Flower Shop',
    4: 'Car Dealership',
    5: 'Clothing Store',
    6: 'Gun Shop',
    7: 'Game Shop',
    8: 'Candle Shop',
    9: 'Toy Shop',
    10: 'Adult Novelties',
    11: 'Cyber Cafe',
    12: 'Grocery Store',
    13: 'Theater',
    14: 'Sweet Shop',
    15: 'Cruise Line',
    16: 'Television Network',
    18: 'Zoo',
    19: 'Firework Stand',
    20: 'Property Broker',
    21: 'Furniture Store',
    22: 'Gas Station',
    23: 'Music Store',
    24: 'Nightclub',
    25: 'Pub',
    26: 'Gents Strip Club',
    27: 'Restaurant',
    28: 'Oil Rig',
    29: 'Fitness Center',
    30: 'Mechanic Shop',
    31: 'Amusement Park',
    32: 'Lingerie Store',
    33: 'Meat Warehouse',
    34: 'Farm',
    35: 'Software Corporation',
    36: 'Ladies Strip Club',
    37: 'Private Security Firm',
    38: 'Mining Corporation',
    39: 'Detective Agency',
    40: 'Logistics Management',
};

/**
 * Job-point specials that give happy (research-events-perks.md §2a): 1★
 * "50 happiness" for 1 JP at several companies; Sweet Shop 5★ Gluttony
 * 10 JP → 1,000 and 10★ Voracious 30 JP → 4,500.
 */
export const JOB_HAPPY = {
    'Toy Shop': [{ stars: 1, jp: 1, happy: 50 }],
    'Candle Shop': [{ stars: 1, jp: 1, happy: 50 }],
    'Sweet Shop': [
        { stars: 10, jp: 30, happy: 4500 },
        { stars: 5, jp: 10, happy: 1000 },
        { stars: 1, jp: 1, happy: 50 },
    ],
};

/** Adult Novelties 3★ "Voyeur": 20 JP → 1 Erotic DVD. */
export const VOYEUR_JP = 20;

/** Job specials are locked this long after joining a company (wiki). */
export const JOB_LOCK_H = 72;

/**
 * The player's company job in one shape.
 * @param {object|null} job - /user/job's `job`
 * @param {object|null} points - /user/jobpoints' `jobpoints`
 * @returns {null|{typeId:number, type:string, stars:number, name:string, days:number, jp:number}}
 */
export function companyJob(job, points = null) {
    if (!job || job.type !== 'company') return null;
    const typeId = Number(job.type_id) || 0;
    const row = points && Array.isArray(points.companies) ? points.companies.find((c) => c && c.company && Number(c.company.id) === typeId) : null;
    const type = (row && row.company && row.company.name) || COMPANY_TYPES[typeId] || 'Company ' + typeId;
    return { typeId, type, stars: Math.max(0, Math.min(10, Number(job.rating) || 0)), name: job.name || '', days: Number(job.days_in_company) || 0, jp: row ? Number(row.points) || 0 : 0 };
}

/**
 * Happy the job's points buy for the plan: the specials this company and
 * its stars unlock, best happy per point first, 1 JP a star a day.
 * @returns {null|{specials:{jp,happy}[], jpPerDay:number, bank:number, type:string, stars:number}}
 */
export function jobHappyOf(cj) {
    if (!cj || !JOB_HAPPY[cj.type]) return null;
    const specials = JOB_HAPPY[cj.type].filter((s) => cj.stars >= s.stars).map(({ jp, happy }) => ({ jp, happy }));
    if (!specials.length) return null;
    specials.sort((a, b) => b.happy / b.jp - a.happy / a.jp);
    return { specials, jpPerDay: cj.stars, bank: cj.jp, type: cj.type, stars: cj.stars };
}

/** Adult Novelties from 3★: the EDVD the job's points pay for, a day (1 JP a star a day ÷ 20). */
export function freeEdvdPerDayOf(cj) {
    if (!cj || cj.type !== 'Adult Novelties' || cj.stars < 3) return 0;
    return cj.stars / VOYEUR_JP;
}

/** Is the player in this company type with at least these stars? */
export function worksAt(cj, type, stars) {
    return Boolean(cj && cj.type === type && cj.stars >= stars);
}

/** "Sweet Shop special: 30 job points → 4,500 happy" for the step that spends them. */
export function jobHappyWords(jh, jp) {
    if (!jh || !(jp > 0)) return '';
    const best = jh.specials[0];
    return jh.type + ' special (' + jp + ' job point' + (jp === 1 ? '' : 's') + ', ' + (best.jp === 1 ? best.happy + ' happy each' : best.jp + ' → ' + best.happy.toLocaleString('en-US') + ' happy') + ')';
}

/** Happy the banked points buy now, and the points it takes: {happy, jp}. */
export function spendJobPoints(jh, bank) {
    let left = Math.max(0, Math.floor(bank || 0));
    let happy = 0;
    for (const sp of (jh && jh.specials) || []) {
        const n = Math.floor(left / sp.jp);
        happy += n * sp.happy;
        left -= n * sp.jp;
    }
    return { happy, jp: Math.max(0, Math.floor(bank || 0)) - left };
}
