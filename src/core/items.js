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
export const CHOC_KISSES = 210;
export const SWEET_HEARTS = 209;
export const BOX_CHOC = 35;
export const BAG_BON_BONS = 37;
export const BOX_BON_BONS = 38;
export const MINTS = 39;
export const BIG_BOX_CHOC = 36;
export const CANDY_KISSES = 527;
export const CHOC_EGG = 1312;
export const TOOTSIE = 528;
export const EYEBALLS = 634;
export const TRUFFLES = 529;
export const REINDEER = 556;
export const PIXIE_STICKS = 151;
export const JAWBREAKER = 586;
export const SHERBET = 587;
export const HUMBUGS = 1039;
export const CUPCAKE = 1028;
/** The Game Console (type Special): "Converts 1, 3 or 5 energy into happiness" (the console jump). */
export const GAME_CONSOLE = 104;
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
    // Every candy: "Increases happiness by N and booster cooldown by 30 minutes." (checked against the items dump, 2026-09-29).
    [LOLLIPOP]: candy(LOLLIPOP, 'Lollipop', 25),
    [CHOC_KISSES]: candy(CHOC_KISSES, 'Bag of Chocolate Kisses', 25, 'Chocolate Kisses'),
    [SWEET_HEARTS]: candy(SWEET_HEARTS, 'Box of Sweet Hearts', 25, 'Sweet Hearts'),
    [BOX_CHOC]: candy(BOX_CHOC, 'Box of Chocolate Bars', 25),
    [BAG_BON_BONS]: candy(BAG_BON_BONS, 'Bag of Bon Bons', 25),
    [BOX_BON_BONS]: candy(BOX_BON_BONS, 'Box of Bon Bons', 25),
    [MINTS]: candy(MINTS, 'Box of Extra Strong Mints', 25, 'Extra Strong Mints'),
    [BIG_BOX_CHOC]: candy(BIG_BOX_CHOC, 'Big Box of Chocolate Bars', 35),
    [CANDY_KISSES]: candy(CANDY_KISSES, 'Bag of Candy Kisses', 50, 'Candy Kisses'),
    [CHOC_EGG]: candy(CHOC_EGG, 'Chocolate Egg', 50),
    [TOOTSIE]: candy(TOOTSIE, 'Bag of Tootsie Rolls', 75, 'Tootsie Rolls'),
    [EYEBALLS]: candy(EYEBALLS, 'Bag of Bloody Eyeballs', 75, 'Bloody Eyeballs'),
    [TRUFFLES]: candy(TRUFFLES, 'Bag of Chocolate Truffles', 100, 'Chocolate Truffles'),
    [REINDEER]: candy(REINDEER, 'Bag of Reindeer Droppings', 100, 'Reindeer Droppings'),
    [PIXIE_STICKS]: candy(PIXIE_STICKS, 'Pixie Sticks', 150),
    [JAWBREAKER]: candy(JAWBREAKER, 'Jawbreaker', 150),
    [SHERBET]: candy(SHERBET, 'Bag of Sherbet', 150, 'Sherbet'),
    [HUMBUGS]: candy(HUMBUGS, 'Bag of Humbugs', 150, 'Humbugs'),
    [CUPCAKE]: candy(CUPCAKE, 'Birthday Cupcake', 250),
    [GAME_CONSOLE]: { id: GAME_CONSOLE, name: 'Game Console', kind: 'special', category: 'Special' },
    [MUNSTER]: { id: MUNSTER, name: 'Can of Munster', kind: 'booster', category: 'Energy Drink', energy: 20, boosterH: 2 },
    [RED_COW]: { id: RED_COW, name: 'Can of Red Cow', kind: 'booster', category: 'Energy Drink', energy: 25, boosterH: 2 },
    [TAURINE]: { id: TAURINE, name: 'Can of Taurine Elite', kind: 'booster', category: 'Energy Drink', energy: 30, boosterH: 2 },
};

function candy(id, name, happy, short = null) {
    return { id, name, ...(short ? { short } : {}), kind: 'booster', category: 'Candy', happy, boosterH: 0.5 };
}

/** Every candy, fewest happy first (the plan picks one of them: core/candy.js). */
export const CANDY_IDS = Object.values(ITEMS)
    .filter((it) => it.category === 'Candy')
    .sort((a, b) => a.happy - b.happy || a.id - b.id)
    .map((it) => it.id);

export function isCandy(id) {
    const it = ITEMS[id];
    return Boolean(it && it.category === 'Candy');
}

/** Sample prices (docs/sims) used until live prices arrive, and in tests. */
export const SAMPLE_PRICES = {
    [XANAX]: 830000,
    [ECSTASY]: 55000,
    [EDVD]: 3700000,
    [CANDY_KISSES]: 32000,
    [FHC]: 12400000,
    [POINTS]: 45000,
    // The items dump's market value (2024); Torn's own market price replaces it once /torn/items answers.
    [GAME_CONSOLE]: 170,
};

export function itemName(id) {
    if (id === POINTS) return 'Points';
    const it = ITEMS[id];
    return it ? it.short || it.name : 'Item ' + id;
}

/**
 * The consumable cooldown cuts (Grocery 3★ −10%, Restaurant 10★ −25%, the book
 * Self Control Is For Losers −50%: docs/research-events-perks.md §2) shorten
 * the booster cooldown of candy, energy drinks and alcohol, not EDVD or FHC.
 */
export function isConsumable(id) {
    const it = ITEMS[id];
    return Boolean(it && (it.category === 'Candy' || it.category === 'Energy Drink'));
}

/** Booster cooldown one use adds, hours, after the consumable cuts (`cdMult`, e.g. 0.9 × 0.75). */
export function boosterHours(itemId, cdMult = 1) {
    const it = ITEMS[itemId];
    if (!it || !(it.boosterH > 0)) return 0;
    return it.boosterH * (isConsumable(itemId) ? Math.max(0.05, cdMult || 1) : 1);
}

/** Candy that fills the booster cap: how many of an item fit under `capH` from `cdH` already used. */
export function boostersThatFit(itemId, capH = BOOSTER_CAP_H, cdH = 0, cdMult = 1) {
    const each = boosterHours(itemId, cdMult);
    if (!(each > 0)) return 0;
    // An item can be used while the cooldown is below the cap, and the cooldown
    // ticks down between uses, so the last one overshoots it: 5 EDVD or 49 candy
    // on an empty 24 h cooldown (research-gym.md).
    if (cdH >= capH) return 0;
    return Math.floor((capH - cdH) / each + 1e-9) + 1;
}
