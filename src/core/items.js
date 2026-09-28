/*
 * The items a gym plan uses, with their effects (Torn's own item text, from
 * the items dump in docs/reference). Pure data.
 */

export const XANAX = 206;
export const ECSTASY = 197;
export const LSD = 199;
export const EDVD = 366;
export const FHC = 367;
export const LOLLIPOP = 310;
export const BOX_CHOC = 35;
export const BIG_BOX_CHOC = 36;
export const CANDY_KISSES = 527;
export const PIXIE_STICKS = 151;
export const MUNSTER = 530;
export const RED_COW = 532;
export const TAURINE = 533;
export const BOOK_GHOGH = 757;
export const BOOK_BLISS = 770;

/** A points refill costs this many points (research-gym.md: "30 pts/day, was 25"). */
export const REFILL_POINTS = 30;

/** Pseudo item id for points in buy lists (not a Torn item). */
export const POINTS = 'points';

/** [calibrate] Drug cooldowns, minutes (Xanax 6–8 h; Ecstasy ~3.3–4 h). The plan uses the live cooldown once a drug is taken. */
export const XANAX_CD_MIN = 7 * 60;
export const ECSTASY_CD_MIN = 4 * 60;
export const LSD_CD_MIN = 7 * 60;

/** Booster cooldown cap, hours (faction perks raise it up to 48). */
export const BOOSTER_CAP_H = 24;

/**
 * kind: drug | booster (candy, EDVD, FHC, cans)
 * energy: +E; happy: +happy; happyMult: × happy; boosterH: + booster cooldown; toMax: energy to max
 */
export const ITEMS = {
    [XANAX]: { id: XANAX, name: 'Xanax', kind: 'drug', category: 'Drug', energy: 250, happy: 75, cdMin: XANAX_CD_MIN },
    [ECSTASY]: { id: ECSTASY, name: 'Ecstasy', kind: 'drug', category: 'Drug', happyMult: 2, cdMin: ECSTASY_CD_MIN },
    [LSD]: { id: LSD, name: 'LSD', kind: 'drug', category: 'Drug', energy: 50, happy: 350, cdMin: LSD_CD_MIN },
    [EDVD]: { id: EDVD, name: 'Erotic DVD', short: 'EDVD', kind: 'booster', category: 'Booster', happy: 2500, boosterH: 6 },
    [FHC]: { id: FHC, name: 'Feathery Hotel Coupon', short: 'FHC', kind: 'booster', category: 'Booster', toMax: true, happy: 500, boosterH: 6 },
    [LOLLIPOP]: { id: LOLLIPOP, name: 'Lollipop', kind: 'booster', category: 'Candy', happy: 25, boosterH: 0.5 },
    [BOX_CHOC]: { id: BOX_CHOC, name: 'Box of Chocolate Bars', kind: 'booster', category: 'Candy', happy: 25, boosterH: 0.5 },
    [BIG_BOX_CHOC]: { id: BIG_BOX_CHOC, name: 'Big Box of Chocolate Bars', kind: 'booster', category: 'Candy', happy: 35, boosterH: 0.5 },
    [CANDY_KISSES]: { id: CANDY_KISSES, name: 'Bag of Candy Kisses', kind: 'booster', category: 'Candy', happy: 50, boosterH: 0.5 },
    [PIXIE_STICKS]: { id: PIXIE_STICKS, name: 'Pixie Sticks', kind: 'booster', category: 'Candy', happy: 150, boosterH: 0.5 },
    [MUNSTER]: { id: MUNSTER, name: 'Can of Munster', kind: 'booster', category: 'Energy Drink', energy: 20, boosterH: 2 },
    [RED_COW]: { id: RED_COW, name: 'Can of Red Cow', kind: 'booster', category: 'Energy Drink', energy: 25, boosterH: 2 },
    [TAURINE]: { id: TAURINE, name: 'Can of Taurine Elite', kind: 'booster', category: 'Energy Drink', energy: 30, boosterH: 2 },
};

/** Sample prices (docs/sims) used until live prices arrive, and in tests. */
export const SAMPLE_PRICES = {
    [XANAX]: 830000,
    [ECSTASY]: 55000,
    [EDVD]: 3700000,
    [CANDY_KISSES]: 32000,
    [FHC]: 12400000,
    [POINTS]: 45000,
};

export function itemName(id) {
    if (id === POINTS) return 'Points';
    const it = ITEMS[id];
    return it ? it.short || it.name : 'Item ' + id;
}

/** Candy that fills the booster cap: how many of an item fit under `capH` from `cdH` already used. */
export function boostersThatFit(itemId, capH = BOOSTER_CAP_H, cdH = 0) {
    const it = ITEMS[itemId];
    if (!it || !(it.boosterH > 0)) return 0;
    // An item can be used while the cooldown is below the cap, and the cooldown
    // ticks down between uses, so the last one overshoots it: 5 EDVD or 49 candy
    // on an empty 24 h cooldown (research-gym.md).
    if (cdH >= capH) return 0;
    return Math.floor((capH - cdH) / it.boosterH + 1e-9) + 1;
}
