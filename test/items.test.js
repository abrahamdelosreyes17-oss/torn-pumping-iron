/*
 * Items and what to buy (round 4 §D): every candy, the candy the plan picks,
 * cooldown cuts, NPC shops, the console, refills to the maximum, job points.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { ITEMS, CANDY_IDS, boostersThatFit, boosterHours, isCandy, itemName, EDVD, MUNSTER, LOLLIPOP, BOX_CHOC, CANDY_KISSES, PIXIE_STICKS, CUPCAKE, GAME_CONSOLE, POINTS, XANAX, ECSTASY } from '../src/core/items.js';
import { bestCandy, candyCandidates, candyPrices, candyCount, candyWords } from '../src/core/candy.js';
import { parsePerks } from '../src/core/perks.js';
import { itemsInfoFrom, npcPricesFrom, candyShopsFrom, marketPricesFrom, npcListing, fillCheapest, linkFor, whereText, livePrices, SOURCE_NPC } from '../src/core/market.js';
import { shopUrl } from '../src/sources/route.js';
import { companyJob, jobHappyOf, freeEdvdPerDayOf, spendJobPoints, worksAt, COMPANY_TYPES } from '../src/core/jobs.js';

/* Every candy (docs/research-events-perks.md, checked against the items dump) */

test('every candy with its id and happy; each is +30 min of booster cooldown', () => {
    const want = { 310: 25, 210: 25, 209: 25, 35: 25, 37: 25, 38: 25, 39: 25, 36: 35, 527: 50, 1312: 50, 528: 75, 634: 75, 529: 100, 556: 100, 151: 150, 586: 150, 587: 150, 1039: 150, 1028: 250 };
    assert.equal(CANDY_IDS.length, Object.keys(want).length);
    for (const [id, happy] of Object.entries(want)) {
        const it = ITEMS[id];
        assert.ok(it, 'item ' + id);
        assert.equal(it.happy, happy, it.name);
        assert.equal(it.boosterH, 0.5, it.name);
        assert.equal(it.category, 'Candy');
        assert.ok(isCandy(Number(id)));
    }
    assert.deepEqual(CANDY_IDS.map((id) => ITEMS[id].happy), [...CANDY_IDS.map((id) => ITEMS[id].happy)].sort((a, b) => a - b), 'fewest happy first');
    assert.equal(ITEMS[GAME_CONSOLE].name, 'Game Console');
    assert.equal(itemName(1039), 'Humbugs');
    assert.equal(itemName(LOLLIPOP), 'Lollipop');
});

test('cooldown cuts: Grocery 3★ −10%, Restaurant 10★ −25%, Self Control −50% shorten candy and cans, never EDVD', () => {
    assert.equal(boostersThatFit(LOLLIPOP), 49, '24 h: 49');
    assert.equal(boostersThatFit(LOLLIPOP, 24, 0, 0.9), 54, 'Grocery 3★: 27 min each');
    assert.equal(boostersThatFit(LOLLIPOP, 24, 0, 0.5), 97, 'the book: 15 min each');
    assert.equal(boostersThatFit(LOLLIPOP, 48, 0, 1), 97, 'faction Voracity: a 48 h cap');
    assert.equal(boostersThatFit(EDVD, 24, 0, 0.5), 5, 'EDVD is not a consumable');
    assert.equal(boosterHours(MUNSTER, 0.75), 1.5, 'cans: 2 h × 0.75');
    const p = parsePerks({ job: ['+ 10% consumable cool down reduction'], book: ['Decreases all consumable cooldowns by 50% for 31 days'], faction: ['+ Adds 24 hours of maximum booster cooldown', '+ Increase happy gain from candy by 50%'] });
    assert.ok(Math.abs(p.consumableCdMult - 0.45) < 1e-9, 'cuts multiply');
    assert.equal(p.boosterCapExtraH, 24);
    assert.equal(p.candyMult, 1.5);
    assert.equal(parsePerks({ job: ['25% consumable cooldown reduction'] }).consumableCdMult, 0.75, "the /torn/companies wording");
});

/* The candy the plan picks */

const MARKET = { [LOLLIPOP]: 400, [BOX_CHOC]: 320, 36: 26000, [CANDY_KISSES]: 32000, 528: 50000, 529: 100000, 556: 99000, [PIXIE_STICKS]: 264000, 586: 261000, [CUPCAKE]: 2088000, 1312: 166000 };

test('candidates: a candy another beats on happy and price is dropped', () => {
    const c = candyCandidates(candyPrices(MARKET)).map((x) => x.id);
    assert.ok(c.includes(BOX_CHOC) && !c.includes(LOLLIPOP), 'the cheaper 25-happy one stays');
    assert.ok(!c.includes(1312), 'Chocolate Egg: 50 happy for more than Candy Kisses');
    assert.ok(!c.includes(529) && c.includes(556), 'Reindeer Droppings: same happy, cheaper');
    assert.ok(!c.includes(PIXIE_STICKS) && c.includes(586), 'Jawbreaker: 150 for less');
    assert.deepEqual(candyPrices({}, { [LOLLIPOP]: { price: 25, shop: "Sally's Sweet Shop" } })[LOLLIPOP], { id: LOLLIPOP, price: 25, source: 'npc', shop: "Sally's Sweet Shop" });
    assert.equal(candyPrices({ [LOLLIPOP]: 20 }, { [LOLLIPOP]: { price: 25, shop: 'x' } })[LOLLIPOP].source, 'market', 'the cheaper side wins');
});

test('bestCandy: most stats in the budget, most per $, or no budget; named with its count', () => {
    // Proxy scores (no evaluate): happy added, over 30 boosts.
    const most = bestCandy({ prices: MARKET, budget: 30 * 49 * 30000, boosts: 30 });
    assert.equal(most.id, 36, 'the biggest happy the budget buys (Big Box at $26k)');
    assert.equal(most.count, 49);
    assert.equal(candyWords(most), 'Big Box of Chocolate Bars × 49');
    assert.equal(bestCandy({ prices: MARKET, budget: 1e6, boosts: 30 }).id, BOX_CHOC, 'a small budget: the cheapest');
    assert.equal(bestCandy({ prices: MARKET, pickBy: 'max', budget: 1 }).id, CUPCAKE, 'no budget: the most happy');
    assert.equal(bestCandy({ prices: MARKET, pickBy: 'value', budget: Infinity }).id, BOX_CHOC, 'value: the most happy per $');
    assert.equal(bestCandy({ prices: MARKET, budget: 1 }).id, BOX_CHOC, 'nothing fits: the cheapest');
    assert.equal(bestCandy({ prices: {} }), null, 'no price known: no pick');
    assert.equal(bestCandy({ prices: MARKET, capH: 24, cdCuts: 0.5 }).count, 97, 'cooldown cuts fit more');
    assert.equal(bestCandy({ prices: MARKET, count: 10 }).count, 10, 'a fixed count');
    assert.equal(candyCount({ capH: 48 }), 97);
    // A ticked shop's Lollipop at $25 beats every market 25-happy candy.
    const npc = bestCandy({ prices: MARKET, npc: { [LOLLIPOP]: { price: 25, shop: "Sally's Sweet Shop" } }, budget: 1e6, boosts: 30 });
    assert.equal(npc.id, LOLLIPOP);
    assert.equal(npc.source, 'npc');
    assert.equal(npc.shop, "Sally's Sweet Shop");
});

test('bestCandy with the engine: evaluate() gives the whole plan’s stats and cost; the budget is the plan’s', () => {
    const plan = (id, n) => ({ gained: 1000 + ITEMS[id].happy * n, cost: 100e6 + MARKET[id] * n * 30 });
    const pick = bestCandy({ prices: MARKET, budget: 150e6, evaluate: plan });
    assert.equal(pick.id, CANDY_KISSES, 'Candy Kisses: 1,470 × $32k = $47M on a $100M plan fits $150M; Tootsie Rolls ($74M) don’t');
    assert.ok(pick.cost <= 150e6);
    assert.ok(pick.options.every((o) => typeof o.gained === 'number'));
    // Per $1M of the whole plan: Candy Kisses 3,450 for $147M beats Box of Chocolate Bars 2,225 for $100.5M.
    assert.equal(bestCandy({ prices: MARKET, budget: 150e6, evaluate: plan, pickBy: 'value' }).id, CANDY_KISSES);
    const cheapPlan = (id, n) => ({ gained: 100000 + ITEMS[id].happy * n, cost: 100e6 + MARKET[id] * n * 30 });
    assert.equal(bestCandy({ prices: MARKET, budget: 150e6, evaluate: cheapPlan, pickBy: 'value' }).id, BOX_CHOC, 'when candy adds little, the cheapest is the best value');
});

/* City (NPC) shops */

const ITEMS_API = [
    { id: 310, value: { market_price: 399, shops: [{ country: 'Torn', shop: "Sally's Sweet Shop", buy_price: 25, sell_price: 12 }] } },
    { id: 210, value: { market_price: 332, shops: [{ country: 'Torn', shop: "Sally's Sweet Shop", buy_price: 150, sell_price: 75 }] } },
    { id: 36, value: { market_price: 26377, shops: [{ country: 'Japan', shop: 'Sweet Shop', buy_price: 5000, sell_price: null }] } },
    { id: 104, value: { market_price: 170, shops: [] } },
];

test('Torn item data: market prices and the city shops that sell candy; a shop counts only when ticked', () => {
    const info = itemsInfoFrom(ITEMS_API);
    assert.deepEqual(info[310], { market: 399, shops: [{ shop: "Sally's Sweet Shop", buy: 25 }] });
    assert.deepEqual(info[36].shops, [], 'abroad needs a flight: not a city shop');
    assert.equal(marketPricesFrom(info)[104], 170);
    assert.deepEqual(candyShopsFrom(info), ["Sally's Sweet Shop"]);
    assert.deepEqual(npcPricesFrom(info, []), {}, 'default: no shop');
    assert.deepEqual(npcPricesFrom(info, ["Sally's Sweet Shop"])[310], { price: 25, shop: "Sally's Sweet Shop" });
});

test('an NPC row links to the exact shop page and fills as many as needed', () => {
    const l = npcListing({ price: 25, shop: "Sally's Sweet Shop" }, 49);
    const f = fillCheapest([{ source: 'itemmarket', price: 400, qty: 100 }, l], 49, LOLLIPOP);
    assert.equal(f.rows.length, 1);
    assert.equal(f.rows[0].source, SOURCE_NPC);
    assert.equal(f.total, 49 * 25);
    assert.equal(f.rows[0].link, 'https://www.torn.com/shops.php?step=candy');
    assert.equal(whereText(f.rows[0]), "Sally's Sweet Shop");
    assert.equal(linkFor({ source: SOURCE_NPC, shop: 'Pharmacy' }, 1), 'https://www.torn.com/shops.php?step=pharmacy');
    assert.equal(shopUrl('Somewhere new'), 'https://www.torn.com/city.php');
    assert.equal(npcListing(null, 5), null);
});

test('candy prices count a boost’s 50 from the cheapest up', () => {
    const rows = { [LOLLIPOP]: { listings: [{ price: 300, qty: 10 }, { price: 500, qty: 100 }] }, [XANAX]: { listings: [{ price: 800000, qty: 10 }, { price: 900000, qty: 10 }] } };
    const p = livePrices(rows);
    assert.equal(p[LOLLIPOP], (10 * 300 + 40 * 500) / 50);
    assert.equal(p[XANAX], 800000);
});

/* Job and job points */

test('the job: company type, stars, job points; the happy its points buy', () => {
    const job = { type: 'company', id: 99, type_id: 14, name: 'Sugar Rush Inc', rating: 10, position: 'Employee', days_in_company: 40 };
    const pts = { jobs: { army: 0 }, companies: [{ company: { id: 14, name: 'Sweet Shop' }, points: 65 }] };
    const cj = companyJob(job, pts);
    assert.deepEqual(cj, { typeId: 14, type: 'Sweet Shop', stars: 10, name: 'Sugar Rush Inc', days: 40, jp: 65 });
    const jh = jobHappyOf(cj);
    assert.deepEqual(jh.specials[0], { jp: 30, happy: 4500 }, 'best happy per point first');
    assert.equal(jh.jpPerDay, 10);
    assert.deepEqual(spendJobPoints(jh, 65), { happy: 2 * 4500 + 5 * 50, jp: 65 });
    assert.equal(jobHappyOf(companyJob({ ...job, rating: 4 }, pts)).specials.length, 1, '4★: only the 1★ special');
    assert.equal(jobHappyOf(companyJob({ ...job, type_id: 6 })), null, 'a Gun Shop gives no happy');
    assert.equal(companyJob({ type: 'job', name: 'Army' }), null, 'a city job');
    assert.equal(companyJob(null), null);
    assert.equal(COMPANY_TYPES[10], 'Adult Novelties');
    assert.equal(freeEdvdPerDayOf(companyJob({ ...job, type_id: 10, rating: 10 })), 0.5, 'Voyeur: 20 JP → 1 EDVD at 10 JP a day');
    assert.equal(freeEdvdPerDayOf(companyJob({ ...job, type_id: 10, rating: 2 })), 0);
    assert.ok(worksAt(companyJob({ ...job, type_id: 9, rating: 5 }), 'Toy Shop', 5));
});

void POINTS;
void ECSTASY;
