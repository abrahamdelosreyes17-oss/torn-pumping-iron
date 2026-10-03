/*
 * The owner's reports of 2026-09-29 (HANDOFF next-steps 7–13): the booster cooldown planned for (simulator,
 * day plan, strip, 48 h look-ahead), candy as a pool that uses what you hold first, Sally's Sweet Shop and the
 * daily city-shop allowance, real gains, sessions in "Last trains", your own Xanax cooldowns, the candy
 * disclaimer and steadiness, and the "why this mix" line.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { simulateStrategy } from '../src/core/strategies.js';
import { dayTimeline, itemsNeeded, targetShares } from '../src/core/plan.js';
import { buildModel, compareStrategies, playerContext, buildOf, heldBoosters, whenWords } from '../src/core/model.js';
import { normalizeState, tornDayStart, DAY, HOUR, MIN } from '../src/core/bars.js';
import { unlockedGyms } from '../src/core/gyms.js';
import { BUILDS } from '../src/core/builds.js';
import { XANAX, ECSTASY, EDVD, POINTS, LOLLIPOP, CHOC_KISSES, CANDY_KISSES, BOX_CHOC, BAG_BON_BONS, CUPCAKE, MUNSTER, RED_COW, TAURINE, SAMPLE_PRICES, boosterHours } from '../src/core/items.js';
import { fillFromPool, fillWords, heldWords, tierWords, bestCandy, CANDY_SWITCH_PCT } from '../src/core/candy.js';
import { needList, npcListing, allowanceLeft, shopsAllowed, toggleShop, CITY_DAILY_ALLOWANCE, SALLYS } from '../src/core/market.js';
import { gainOver, realGains, sessionsOf } from '../src/core/gains.js';
import { xanaxCdSample, xanaxCdOf, addXanaxCd } from '../src/core/drugcd.js';
import { whyMix } from '../src/core/gympage.js';
import { boosterWords } from '../src/ui/app/common.js';
import { StateFeed } from '../src/feed/state.js';

const T0 = Date.UTC(2026, 8, 29, 10, 48);
const OWNER = [35.4e6, 4.06e6, 82.4e6, 20.5e6];
const FRIEND = [118400, 110900, 96200, 82700];
const SETTINGS = { horizonDays: 30, budget: 150e6 };

function player({ stats = OWNER, happy = 5025, energy = 20, drug = 0, booster = 0, gym = 24, at = T0, refill = false } = {}) {
    return normalizeState({
        bars: { energy: { current: energy, maximum: 150, increment: 5, interval: 600, tick_time: 120 }, happy: { current: happy, maximum: happy, increment: 5, interval: 900, tick_time: 300 } },
        cooldowns: { drug, booster },
        refills: { energy: refill, special_count: 0 },
        battlestats: { strength: { value: stats[0] }, speed: { value: stats[1] }, defense: { value: stats[2] }, dexterity: { value: stats[3] } },
        gym: { id: gym },
    }, at);
}

const CTX = { shares: BUILDS.hank.shares, unlocked: unlockedGyms(24), active: 24, candyId: LOLLIPOP, candyCount: 49 };
const boostItems = (s) => (s.items || []).filter((it) => it.id !== XANAX && it.id !== ECSTASY && it.id !== POINTS);
const candyOf = (s) => boostItems(s).reduce((a, it) => a + it.qty, 0);

/* 1. The booster cooldown */

test('owner’s case: Candy + Xanax with 31h 40m on the booster cooldown: no candy today, Xanax as steady, the boost when it has room', () => {
    const booster = 31 * 3600 + 40 * 60;
    const state = player({ booster });
    const steps = dayTimeline({ state, now: T0, strategy: 'candyXanax', ctx: CTX });
    const today = steps.filter((s) => s.at < tornDayStart(T0) + DAY);
    assert.ok(!today.some((s) => candyOf(s) > 0), 'no candy step today: ' + today.map((s) => s.label).join(' | '));
    const x = today.filter((s) => s.kind === 'xanax');
    assert.ok(x.length >= 1);
    assert.match(x[0].note, /booster cooldown is full; candy fits again at/);
    // The cooldown gets under the 24 h cap at T0 + 7h 40m: the next Xanax after that carries the candy it has room for.
    const ahead = dayTimeline({ state, now: T0, strategy: 'candyXanax', ctx: CTX, until: T0 + 48 * HOUR });
    const boost = ahead.find((s) => s.kind === 'boost');
    assert.ok(boost, 'a candy boost in the look-ahead');
    const under = T0 + booster * 1000 - 24 * HOUR;
    assert.ok(boost.at >= under, 'not before the cooldown is under the cap');
    const cdLeftH = (T0 + booster * 1000 - boost.at) / HOUR;
    const fits = Math.floor((24 - cdLeftH) / 0.5 + 1e-9) + 1;
    assert.equal(candyOf(boost), Math.min(49, fits), 'what fits then, never 49 over the cap');
    if (fits < 49) assert.match(boost.note, /room for \d+ of 49/);
});

test('owner, 2026-10-03: "Candy × 22" with 13h 05m on the booster cooldown: the note says the cooldown, the cap and why 22', () => {
    const booster = 13 * 3600 + 5 * 60;
    const steps = dayTimeline({ state: player({ booster }), now: T0, strategy: 'candyXanax', ctx: CTX, until: T0 + 48 * HOUR });
    const boost = steps.find((s) => s.kind === 'boost');
    assert.ok(boost, 'a candy boost: ' + steps.map((s) => s.kind).join());
    const leftMin = Math.ceil((T0 + booster * 1000 - boost.at) / 60000);
    const fits = Math.floor((24 * 60 - leftMin) / 30 + 1e-9) + 1;
    assert.equal(candyOf(boost), fits, 'the room left under the 24 h cap, 30 min a candy (the last one may go over it)');
    assert.ok(fits < 49);
    const m = boost.note.match(/booster cooldown (\d+)h (\d\d)m of 24h: room for (\d+) of 49 \(30 min each\)/);
    assert.ok(m, boost.note);
    assert.equal(Number(m[1]) * 60 + Number(m[2]), leftMin, 'the cooldown as it is when the candy is eaten');
    assert.equal(Number(m[3]), fits);
    // His numbers: 13 h on the cooldown leaves 11 h = 22 candy.
    assert.equal(Math.floor((24 * 60 - 13 * 60 - 5) / 30 + 1e-9) + 1, 22);
});

test('the day plan never plans more candy than the cooldown holds, across the 48 h look-ahead', () => {
    const state = player({ booster: 3 * 3600 });
    const steps = dayTimeline({ state, now: T0, strategy: 'candyXanax', ctx: CTX, until: T0 + 48 * HOUR });
    let free = T0 + 3 * HOUR;
    for (const s of steps.filter((x) => candyOf(x) > 0)) {
        const cdH = Math.max(0, free - s.at) / HOUR;
        assert.ok(cdH < 24, 'each boost starts under the cap (' + cdH.toFixed(2) + ' h)');
        assert.ok(candyOf(s) <= Math.floor((24 - cdH) / 0.5 + 1e-9) + 1);
        free = Math.max(free, s.at) + candyOf(s) * 0.5 * HOUR;
    }
    // Two Torn days: each has its refill, and the Xanax count starts again at #1.
    assert.ok(steps.filter((s) => s.kind === 'refill').length >= 2);
    assert.ok(steps.some((s) => s.at >= tornDayStart(T0) + DAY && /#1\b/.test(s.label)));
});

test('simulator: candy boosts respect the cap (≤ 48 a day plus the one overshoot) and start from the live cooldown', () => {
    const o = { stats: { str: 118400, spd: 0, def: 0, dex: 0 }, target: 'str', gyms: { str: { dots: 6.5, energy: 10 } }, happyMax: 5025, prices: SAMPLE_PRICES, candyId: LOLLIPOP, candyCount: 49, days: 30 };
    for (const id of ['candyXanax', 'dailyChoco']) {
        const r = simulateStrategy(id, o);
        const hours = r.used[LOLLIPOP] * boosterHours(LOLLIPOP);
        assert.ok(hours <= 30 * 24 + 24 + 0.5, id + ': ' + r.used[LOLLIPOP] + ' candy = ' + hours + ' h of cooldown in 30 days');
        assert.ok(r.used[LOLLIPOP] < 49 * 30, id + ' no longer a full 49 every day');
        const late = simulateStrategy(id, { ...o, boosterCdMin: 31 * 60 + 40 });
        assert.ok(late.used[LOLLIPOP] < r.used[LOLLIPOP], id + ': a full cooldown at the start costs candy');
    }
});

test('jumps wait until their whole boost fits: an EDVD jump with 20 h on the cooldown', () => {
    const state = player({ stats: FRIEND, gym: 18, booster: 20 * 3600, drug: 0 });
    const steps = dayTimeline({ state, now: T0, strategy: 'edvdJump', ctx: { shares: BUILDS.balanced.shares, unlocked: unlockedGyms(18), active: 18 } });
    const jump = steps.find((s) => s.kind === 'jump');
    // 5 EDVD (30 h) need the cooldown at 0 under a 24 h cap: 20 h from now, not after the 4 Xanax (21 h).
    assert.ok(jump.at >= T0 + 20 * HOUR);
    assert.equal(jump.items.find((it) => it.id === EDVD).qty, 5);
    assert.match(jump.note, /no other boosters before it/);
    const soon = dayTimeline({ state: player({ stats: FRIEND, gym: 18, booster: 30 * 3600 }), now: T0, strategy: 'edvdJump', ctx: { shares: BUILDS.balanced.shares, unlocked: unlockedGyms(18), active: 18 } }).find((s) => s.kind === 'jump');
    assert.ok(soon.at >= T0 + 30 * HOUR, 'the jump waits past the 4-Xanax stack (28 h) for the cooldown');
    assert.match(soon.note, /waits for room under the 24 h booster cap/);
});

test('model: the strip says when the next boost is, heads-up says no candy today, the look-ahead goes to the bot', () => {
    const state = player({ booster: 31 * 3600 + 40 * 60 });
    const pc = playerContext(state, {}, { unlockedKnown: unlockedGyms(24) });
    const plan = { strategy: 'candyXanax', build: 'hank:str', buildPicked: true };
    const compare = compareStrategies({ state, pc, shares: targetShares(plan, pc.stats, buildOf(plan.build).shares), settings: SETTINGS, prices: {} });
    const m = buildModel({ state, plan, settings: SETTINGS, compare, pc, now: T0 });
    assert.ok(m.strip.booster.next, 'a next booster step');
    assert.match(boosterWords(m.strip.booster, T0), /^Next candy boost in \d+h/);
    assert.equal(m.strip.booster.underCapIn, (31 * 60 + 40 - 24 * 60) * 60e3);
    assert.ok(m.heads.some((x) => /^No candy today · booster cooldown 31h 40m/.test(x.text)), JSON.stringify(m.heads.map((x) => x.text)));
    assert.ok(m.later.length > 0 && m.later.every((s) => s.at >= tornDayStart(T0) + DAY));
    assert.ok(m.upcoming.length > m.steps.length);
    assert.equal(whenWords(tornDayStart(T0) + DAY + 6 * HOUR + 15 * MIN, T0), 'tomorrow 06:15');
});

test('the strip line: next booster step, else "Used · room again in …", else not used', () => {
    assert.equal(boosterWords({ left: 0, next: null }, T0), 'Not used by this plan');
    assert.equal(boosterWords({ left: 31 * HOUR, underCapIn: 7 * HOUR + 40 * MIN, next: null }, T0), 'Used · room again in 7h 40m');
    assert.equal(boosterWords({ left: 3 * HOUR, next: { at: T0 + 90 * MIN, kind: 'jump' } }, T0), 'Next jump in 1h 30m');
});

/* 2. Candy is a pool: what you hold first */

test('owner’s example: need 49, hold 29 Chocolate Kisses + 20 Lollipops → buy 0, and the step says so', () => {
    const held = { [CHOC_KISSES]: 29, [LOLLIPOP]: 20 };
    const f = fillFromPool(49, LOLLIPOP, held);
    assert.equal(f.buy, 0);
    assert.equal(f.held, 49);
    assert.equal(f.value, 49 * 25);
    assert.equal(fillWords(f, LOLLIPOP), 'Candy × 49: your 29 Chocolate Kisses + your 20 Lollipop');
    assert.equal(heldWords(f), 'from your items: 29 Chocolate Kisses + 20 Lollipop · buy 0');
    assert.equal(fillWords(fillFromPool(49, LOLLIPOP, { [LOLLIPOP]: 30 }), LOLLIPOP), 'Lollipop × 49 (30 yours, buy 19)');
    assert.equal(fillWords(fillFromPool(49, LOLLIPOP, { [CHOC_KISSES]: 10 }), LOLLIPOP), 'Candy × 49: your 10 Chocolate Kisses + 39 Lollipop');
    const steps = dayTimeline({ state: player({ drug: 0 }), now: T0, strategy: 'candyXanax', ctx: { ...CTX, held } });
    const boost = steps.find((s) => s.kind === 'boost');
    assert.match(boost.label, /^Candy × 49: your 29 Chocolate Kisses \+ your 20 Lollipop \+ Xanax/);
    assert.match(boost.note, /buy 0/);
    const need = needList(itemsNeeded([boost]), { ...held, [XANAX]: 5 });
    assert.ok(need.every((n) => n.buy === 0), JSON.stringify(need));
});

test('mixed tiers: held candy with more happy goes first and counts its happy; less happy stays unless the pick is its tier', () => {
    const f = fillFromPool(49, LOLLIPOP, { [CANDY_KISSES]: 10, [CUPCAKE]: 2 });
    assert.deepEqual(f.alloc.map((a) => [a.id, a.qty, a.held]), [[CUPCAKE, 2, 2], [CANDY_KISSES, 10, 10], [LOLLIPOP, 37, 0]]);
    assert.equal(f.value, 2 * 250 + 10 * 50 + 37 * 25);
    const g = fillFromPool(49, CANDY_KISSES, { [LOLLIPOP]: 40 });
    assert.equal(g.held, 0, 'a +25 candy is not used for a +50 pick');
    // Energy drinks pool by energy.
    const c = fillFromPool(3, RED_COW, { [TAURINE]: 1, [MUNSTER]: 5 });
    assert.deepEqual(c.alloc.map((a) => [a.id, a.qty]), [[TAURINE, 1], [RED_COW, 2]]);
});

test('Buy never lists what you hold: spare held candy covers the days after the next boost', () => {
    const need = needList({ [LOLLIPOP]: 98 }, { [CHOC_KISSES]: 60, [LOLLIPOP]: 10 });
    const row = need.find((n) => n.id === LOLLIPOP);
    assert.equal(row.buy, 28);
    assert.deepEqual(row.fromPool, [{ id: CHOC_KISSES, name: 'Chocolate Kisses', qty: 60 }]);
    // Held Xanax only covers Xanax.
    assert.equal(needList({ [XANAX]: 3 }, { [CHOC_KISSES]: 60 })[0].buy, 3);
});

test('the simulator counts held candy as free (cost) and uses it first', () => {
    const o = { stats: { str: 118400, spd: 0, def: 0, dex: 0 }, target: 'str', gyms: { str: { dots: 6.5, energy: 10 } }, happyMax: 5025, prices: { ...SAMPLE_PRICES, [LOLLIPOP]: 10000 }, candyId: LOLLIPOP, candyCount: 49, days: 3 };
    const bare = simulateStrategy('candyXanax', o);
    const held = simulateStrategy('candyXanax', { ...o, held: { [CHOC_KISSES]: 49 } });
    assert.equal(bare.cost - held.cost, 49 * 10000);
    assert.equal(held.used.held[CHOC_KISSES], 49);
    assert.equal(held.used[CHOC_KISSES], 49);
    assert.equal(heldBoosters({ [CHOC_KISSES]: 3, [XANAX]: 4, cash: 5, points: 9 })[CHOC_KISSES], 3);
    assert.equal(heldBoosters({ [XANAX]: 4 })[XANAX], undefined, 'drugs aren’t pooled');
});

/* 3. Sally's Sweet Shop and the allowance */

test('Sally’s is on by default, the tick switches it off; the allowance caps the shop row', () => {
    assert.deepEqual(shopsAllowed({}), [SALLYS]);
    const off = toggleShop({}, SALLYS);
    assert.deepEqual(shopsAllowed(off), []);
    assert.deepEqual(shopsAllowed(toggleShop(off, SALLYS)), [SALLYS]);
    const npc = { price: 25, shop: SALLYS };
    assert.equal(npcListing(npc, 49, 100).qty, 49);
    assert.equal(npcListing(npc, 49, 30).qty, 30, 'only what is left today');
    assert.equal(npcListing(npc, 49, 0), null);
    assert.equal(npcListing(npc, 400, null).qty, CITY_DAILY_ALLOWANCE);
});

test('allowance left from cityitemsbought: now less the day’s start; a new Torn day starts at 100', () => {
    const day = tornDayStart(T0);
    assert.equal(allowanceLeft({ day, start: 1200, now: 1270 }, T0), 30);
    assert.equal(allowanceLeft({ day, start: 1200, now: 1400 }, T0), 0);
    assert.equal(allowanceLeft({ day: day - DAY, start: 1200, now: 1270 }, T0), 100);
    assert.equal(allowanceLeft({ day, start: null, now: 1270 }, T0), null);
});

test('the feed reads cityitemsbought now, and once a day at the day’s start (Torn’s daily snapshot)', async () => {
    const store = new Map();
    const calls = [];
    const client = {
        get: async (path, params = {}) => {
            calls.push([path, params]);
            if (path === 'v2/user/personalstats') return { personalstats: [{ name: 'cityitemsbought', value: params.timestamp ? 1200 : 1249 }] };
            return {};
        },
    };
    const feed = new StateFeed({ client, store: { get: (k, f) => (store.has(k) ? store.get(k) : f), set: (k, v) => store.set(k, v) }, tabId: 't', now: () => T0 });
    const st = await feed.refreshStaticOnce();
    assert.deepEqual({ ...st.cityShop, at: 0 }, { day: tornDayStart(T0), start: 1200, now: 1249, at: 0 });
    const ps = calls.filter(([p, q]) => p === 'v2/user/personalstats' && q.stat === 'cityitemsbought');
    assert.equal(ps.length, 2);
    assert.equal(ps[1][1].timestamp, Math.floor(tornDayStart(T0) / 1000) - 1);
    assert.equal(ps[0][1].timestamp, undefined);
});

/* 4. Real gains */

test('real gains: today from yesterday’s last read (or the day’s first), 7 and 30 days', () => {
    const d = tornDayStart(T0);
    const hist = { [d - DAY]: { str: 100, spd: 0, def: 0, dex: 50 }, [d]: { str: 400, spd: 0, def: 0, dex: 60, open: { str: 110, spd: 0, def: 0, dex: 50 } } };
    const g = realGains(hist, { str: 400, spd: 0, def: 0, dex: 60 }, T0);
    assert.equal(g.today.total, 310);
    assert.deepEqual(g.today.perStat, { str: 300, spd: 0, def: 0, dex: 10 });
    const first = gainOver({ [d]: { str: 400, dex: 60, open: { str: 110, dex: 50 } } }, { str: 400, spd: 0, def: 0, dex: 60 }, T0, 1);
    assert.equal(first.total, 300, 'from the day’s opening read');
    assert.equal(gainOver({ [d]: { str: 400 } }, { str: 400 }, T0, 1), null, 'no opening read and no yesterday: unknown');
    assert.equal(g.week.total, 310, 'yesterday has no opening read: the week counts from its end');
    assert.equal(g.week.days, 1);
});

test('Last trains: a session’s reads in one row (the owner’s 15 trains = +305,123)', () => {
    const t = T0;
    const samples = [
        { at: t, stat: 'str', trains: 10, predicted: 169900, actual: 169900, gym: 'The Edge' },
        { at: t + 60e3, stat: 'dex', trains: 1, predicted: 27115, actual: 27115, gym: 'Balboas Gym' },
        { at: t + 90e3, stat: 'dex', trains: 4, predicted: 108108, actual: 108108, gym: 'Balboas Gym' },
        { at: t - 3 * HOUR, stat: 'str', trains: 5, predicted: 1, actual: 1, gym: 'The Edge' },
    ];
    const s = sessionsOf(samples);
    assert.equal(s.length, 2);
    assert.equal(s[0].actual, 305123);
    assert.deepEqual(s[0].trains, { str: 10, dex: 5 });
    assert.deepEqual(s[0].gyms, ['The Edge', 'Balboas Gym']);
    assert.equal(s[0].reads, 3);
});

/* 5. Xanax cooldowns */

test('your Xanax cooldowns: recorded from Torn’s drug cooldown, the median plans later ones', () => {
    const prev = player({ drug: 0 });
    const next = { ...player({ drug: 0, at: T0 + 30e3 }), drugCd: 6 * 3600 + 50 * 60 };
    const s = xanaxCdSample(prev, next, { drugTaken: true }, { items: [{ id: XANAX, qty: 1 }] });
    assert.equal(s.min, 410);
    assert.equal(xanaxCdSample(prev, { ...next, drugCd: 210 * 60 }, { drugTaken: true }, null), null, 'an Ecstasy (≈ 3.5 h) isn’t a Xanax');
    assert.equal(xanaxCdSample(prev, next, { drugTaken: true }, { items: [{ id: ECSTASY, qty: 1 }] }), null);
    assert.equal(xanaxCdOf([]).min, 420, '7 h until there are three');
    let list = [];
    for (const min of [370, 410, 455]) list = addXanaxCd(list, { at: T0, min });
    assert.deepEqual(xanaxCdOf(list), { min: 410, n: 3, lo: 370, hi: 455, own: true });
    const steps = dayTimeline({ state: player({ drug: 0 }), now: T0, strategy: 'steady', ctx: { ...CTX, xanaxCdMin: 410 } });
    const x = steps.filter((st) => st.kind === 'xanax');
    assert.equal(x[1].at - x[0].at, 410 * MIN);
});

/* 6. The candy disclaimer and steadiness */

test('candy disclaimer: the same happy as the others in its tier', () => {
    assert.match(tierWords(LOLLIPOP), /^any \+25 candy works the same \(Lollipop, /);
    assert.equal(tierWords(XANAX), '');
    const steps = dayTimeline({ state: player({ drug: 0 }), now: T0, strategy: 'candyXanax', ctx: CTX });
    assert.match(steps.find((s) => s.kind === 'boost').note, /any \+25 candy works the same/);
});

test('the day’s candy stays unless another is at least 10% cheaper for the whole boost', () => {
    const base = { prices: { [LOLLIPOP]: 400, [BAG_BON_BONS]: 380 }, count: 49 };
    assert.equal(bestCandy(base).id, BAG_BON_BONS, 'cheapest without a pick');
    assert.equal(bestCandy({ ...base, prefer: LOLLIPOP }).id, LOLLIPOP, '5% cheaper: keep today’s');
    assert.equal(bestCandy({ ...base, prices: { [LOLLIPOP]: 400, [BAG_BON_BONS]: 400 * (1 - CANDY_SWITCH_PCT / 100) - 1 }, prefer: LOLLIPOP }).id, BAG_BON_BONS, 'over 10% cheaper: switch');
    assert.equal(bestCandy({ ...base, prices: { [LOLLIPOP]: 400, [CANDY_KISSES]: 420 }, prefer: LOLLIPOP }).id, CANDY_KISSES, 'more happy wins');
});

/* 7. Why this mix */

test('why this mix: a two-stat session says how much more it moves you toward the build than one stat', () => {
    const m = {
        steps: [{ parts: [{ stat: 'str', gymName: 'The Edge', energy: 100, gain: 170000 }, { stat: 'dex', gymName: 'Balboas Gym', energy: 50, gain: 135000 }] }],
        pc: { stats: { str: 35.4e6, spd: 4.06e6, def: 82.4e6, dex: 20.5e6 } },
        shares: { str: 0.45, spd: 0.1, def: 0.2, dex: 0.25 },
        build: { base: 'hank', name: 'Hank’s, STR high' },
    };
    const w = whyMix(m);
    assert.ok(w && w.pct > 0.5);
    assert.match(w.text, /^STR \+ DEX this session: \+\d+(\.\d)?% toward Hank['’]s vs STR only$/);
    assert.equal(w.mix, 305000);
    assert.equal(w.one, 255000);
    // A stat already at its share: its trains count nothing toward the build.
    assert.equal(whyMix({ ...m, shares: { str: 0.45, spd: 0.1, def: 0.35, dex: 0.1 } }), null);
    assert.equal(whyMix({ ...m, steps: [{ parts: [m.steps[0].parts[0]] }] }), null, 'one stat: the one-stat line instead');
});

/* The review's findings (2026-09-29): one refill and one boost a Torn day; no refill trains a held Xanax. */

test('look-ahead: a boost after midnight belongs to the new day; one refill a Torn day; the refill comes before a held Xanax', () => {
    for (const [strategy, drugH, h0] of [['candyXanax', 7.9, 16], ['dailyChoco', 7.9, 9], ['candyXanax', 5, 20], ['dailyChoco', 3, 21]]) {
        const now = Date.UTC(2026, 8, 29, h0, 17);
        const steps = dayTimeline({ state: player({ drug: Math.round(drugH * 3600), at: now }), now, strategy, ctx: CTX, until: now + 48 * HOUR });
        const per = {};
        for (const s of steps) {
            const d = tornDayStart(s.at);
            per[d] = per[d] || { refill: 0, boost: 0 };
            if (s.kind === 'refill') per[d].refill++;
            if (s.kind === 'boost') per[d].boost++;
        }
        for (const [d, c] of Object.entries(per)) {
            assert.ok(c.refill <= 1, strategy + ' ' + new Date(Number(d)).toISOString() + ': ' + c.refill + ' refills');
            assert.ok(c.boost <= 1, strategy + ': ' + c.boost + ' boosts');
        }
        const hold = steps.find((s) => s.kind === 'hold');
        if (hold) {
            const boost = steps.find((s) => s.kind === 'boost' && s.at > hold.at);
            assert.ok(!steps.some((s) => s.kind === 'refill' && s.at > hold.at && s.at < boost.at), 'no refill while a Xanax is held');
        }
    }
});

test('simulator: one refill a day even when the candy boost comes later in the day', () => {
    const o = { stats: { str: 118400, spd: 0, def: 0, dex: 0 }, target: 'str', gyms: { str: { dots: 6.5, energy: 10 } }, happyMax: 5025, prices: SAMPLE_PRICES, candyId: LOLLIPOP, days: 30 };
    for (const candyCount of [49, 10]) for (const xanaxCdMin of [360, 420]) {
        const r = simulateStrategy('dailyChoco', { ...o, candyCount, xanaxCdMin, boosterCdMin: 1900 });
        assert.ok(r.used[POINTS] <= 30 * 30, 'at most 30 refills in 30 days (' + r.used[POINTS] / 30 + ')');
    }
});

test('Buy over a week: what you hold is taken off once (100 held, 48 a day → buy 236)', async () => {
    const { needsForWindow } = await import('../src/ui/app/buy.js');
    const m = { now: T0, steps: [{ at: T0 + HOUR, kind: 'boost', items: [{ id: LOLLIPOP, qty: 48 }] }], ahead: null };
    const compare = { candyXanax: { used: { [LOLLIPOP]: 48 * 30, held: { [LOLLIPOP]: 100 } }, candy: { id: LOLLIPOP } } };
    const need = needsForWindow(m, compare, { strategy: 'candyXanax' }, 'week', 30);
    assert.equal(needList(need, { [LOLLIPOP]: 100 })[0].buy, 7 * 48 - 100);
    // Held Chocolate Kisses: the days after count as the pick, the pool takes the held ones off.
    const m2 = { now: T0, steps: [{ at: T0 + HOUR, kind: 'boost', items: [{ id: CHOC_KISSES, qty: 48 }] }], ahead: null };
    const c2 = { candyXanax: { used: { [CHOC_KISSES]: 60, [LOLLIPOP]: 48 * 30 - 60, held: { [CHOC_KISSES]: 60 } }, candy: { id: LOLLIPOP } } };
    const rows = needList(needsForWindow(m2, c2, { strategy: 'candyXanax' }, 'week', 30), { [CHOC_KISSES]: 60 });
    assert.equal(rows.find((r) => r.id === CHOC_KISSES).buy, 0, 'never buy the candy you hold');
    assert.equal(rows.find((r) => r.id === LOLLIPOP).buy, 6 * 48 - 12);
});
