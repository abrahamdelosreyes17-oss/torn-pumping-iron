/*
 * API lanes (owner, 2026-09-29): Pumping Iron has 85 calls a minute to
 * itself; the plan's reads go first, then what's open (Torn Eye, prices, or
 * half each), and a side that isn't in front keeps to its share.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { laneOf, sideOf, focusFrom, laneCap, laneRank, FOCUS_FRESH_MS } from '../src/core/lanes.js';
import { TornApiClient } from '../src/api/client.js';
import { TORN_PER_MINUTE_ALONE } from '../src/core/turns.js';

test('85 calls a minute: Torn Trading is off while Pumping Iron runs', () => {
    assert.equal(TORN_PER_MINUTE_ALONE, 85);
});

test('a call’s lane comes from what it reads', () => {
    assert.equal(laneOf('v2/user'), 'plan');
    assert.equal(laneOf('v2/user/perks'), 'plan');
    assert.equal(laneOf('v2/key/info'), 'plan');
    assert.equal(laneOf('v2/market/206/itemmarket'), 'prices');
    assert.equal(laneOf('v2/market/pointsmarket'), 'prices');
    assert.equal(laneOf('v2/faction/7777/members'), 'war');
    assert.equal(laneOf('v2/faction/wars'), 'war');
    assert.equal(laneOf('v2/user/123/profile'), 'eye');
    assert.equal(laneOf('v2/user/attacks'), 'eye');
    assert.equal(laneOf('v2/torn/calendar'), 'other');
    assert.equal(sideOf('war'), 'eye');
    assert.equal(sideOf('plan'), null);
});

test('what’s open: fresh heartbeats only', () => {
    const now = 1e12;
    const f = focusFrom({ a: { focus: 'eye', war: true, at: now - 1000 }, b: { focus: 'prices', at: now - FOCUS_FRESH_MS - 1 } }, now);
    assert.deepEqual(f, { eye: true, prices: false, war: true });
});

test('shares: the side in front has the whole minute, the other 30%; both open, half each; nothing open, no limits', () => {
    const eye = { eye: true, prices: false };
    assert.equal(laneCap('eye', eye, 85), 85);
    assert.equal(laneCap('war', eye, 85), 85);
    assert.equal(laneCap('prices', eye, 85), 25);
    assert.equal(laneCap('plan', eye, 85), 85);
    assert.equal(laneCap('prices', { eye: true, prices: true }, 85), 42);
    assert.equal(laneCap('eye', { eye: true, prices: true }, 85), 42);
    assert.equal(laneCap('prices', { eye: false, prices: false }, 85), 85);
});

test('order: the plan first, then the war, then the side in front; both open, the side behind on its half next', () => {
    const eye = { eye: true, prices: false };
    const order = ['prices', 'other', 'eye', 'war', 'plan'].sort((a, b) => laneRank(a, eye) - laneRank(b, eye));
    assert.deepEqual(order, ['plan', 'war', 'eye', 'other', 'prices']);
    const both = { eye: true, prices: true };
    assert.ok(laneRank('prices', both, { eye: 10, prices: 2 }) < laneRank('eye', both, { eye: 10, prices: 2 }));
    assert.ok(laneRank('eye', both, { eye: 2, prices: 10 }) < laneRank('prices', both, { eye: 2, prices: 10 }));
});

test('the client runs the queue in lane order (Torn Eye open: a queued price read waits for Torn Eye’s)', async () => {
    const seen = [];
    let release;
    const gate = new Promise((r) => (release = r));
    const fetchImpl = async (url) => {
        const u = new URL(url);
        seen.push(u.pathname);
        // The first call holds the queue so the rest line up behind it.
        if (seen.length === 1) await gate;
        return { ok: true, status: 200, json: async () => ({}) };
    };
    const client = new TornApiClient({ getKey: () => 'K'.repeat(16), fetchImpl, maxRetries: 0, focus: () => ({ eye: true, prices: false, war: false }) });
    const first = client.get('v2/torn/calendar');
    await new Promise((r) => setTimeout(r, 5));
    const p1 = client.get('v2/market/206/itemmarket');
    const p2 = client.get('v2/user/5/profile');
    const p3 = client.get('v2/faction/7777/members');
    const p4 = client.get('v2/user', { selections: 'bars' });
    release();
    await Promise.all([first, p1, p2, p3, p4]);
    assert.deepEqual(seen, ['/v2/torn/calendar', '/v2/user', '/v2/faction/7777/members', '/v2/user/5/profile', '/v2/market/206/itemmarket']);
});

test('a side that isn’t in front waits once it used its share of the minute (shared across tabs)', async () => {
    const now = Date.now();
    const lanes = { prices: Array.from({ length: 25 }, () => now - 1000), eye: [] };
    const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({}) });
    const client = new TornApiClient({ getKey: () => 'K'.repeat(16), fetchImpl, maxRetries: 0, focus: () => ({ eye: true, prices: false }), loadLaneWindow: (side) => lanes[side], addLaneWindow: (side, at) => lanes[side].push(at) });
    let done = false;
    const p = client.get('v2/market/206/itemmarket').then(() => (done = true));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(done, false, 'prices at their 25 of 85 while Torn Eye is in front: waits');
    // Torn Eye's own read still goes.
    await client.get('v2/user/5/profile');
    assert.equal(lanes.eye.length, 1);
    // The window rolls on: the old price reads drop out, and the waiting one goes.
    lanes.prices = [];
    await p;
    assert.equal(done, true);
});

test('live gym page (2026-09-29): hashed "gym-1___Ij5f9" icons and bare "gymButton___" buttons are read', async () => {
    const { readGymButtons, gymListSummary } = await import('../src/sources/dom/gym.js');
    // A stand-in for the page, from the owner's console output (only what the reader touches).
    const btn = (cls, iconCls, label) => {
        const icon = { className: iconCls };
        return { className: cls, getAttribute: (k) => (k === 'aria-label' ? label : null), querySelector: (sel) => (sel.includes('gymIcon___') ? icon : null) };
    };
    const buttons = [
        btn('gymButton___T6tQg', 'gymIcon___D89ig gym-1___Ij5f9', 'Premier Fitness. Membership cost - $10. Energy usage -\n     5 per train. '),
        btn('gymButton___T6tQg selected___aB1', 'gymIcon___D89ig gym-21___Zz9', 'Atlas. Membership cost - $50,000,000. Energy usage - 10 per train.'),
        btn('gymButton___T6tQg locked___q2', 'gymIcon___D89ig gym-27___Qq', 'Gym 3000. Membership cost - $50,000,000.'),
        btn('gymButton___T6tQg', 'gymIcon___D89ig gym-3', 'Woody\'s Workout Club. Membership cost - $250.'),
    ];
    const root = { querySelectorAll: (sel) => (sel.includes('gymButton___') ? buttons : []) };
    const read = readGymButtons(root);
    assert.deepEqual(read.map((b) => [b.id, b.state, b.name]), [
        [1, 'active', 'Premier Fitness'],
        [21, 'selected', 'Atlas'],
        [27, 'locked', 'Gym 3000'],
        [3, 'active', "Woody's Workout Club"],
    ]);
    const sum = gymListSummary(read);
    assert.equal(sum.selectedId, 21);
    assert.ok(sum.unlocked.includes(1) && sum.unlocked.includes(21) && !sum.unlocked.includes(27));
});

test('the Attack button goes to Torn’s current attack page (page.php), and old loader.php links are still recognised', async () => {
    const { attackUrl, detectPage, attackTargetOf, PAGE_ATTACK } = await import('../src/sources/route.js');
    assert.equal(attackUrl(1945385), 'https://www.torn.com/page.php?sid=attack&user2ID=1945385');
    assert.equal(detectPage('https://www.torn.com/page.php?sid=attack&user2ID=1945385'), PAGE_ATTACK);
    assert.equal(attackTargetOf('https://www.torn.com/page.php?sid=attack&user2ID=1945385'), '1945385');
    assert.equal(detectPage('https://www.torn.com/loader.php?sid=attack&user2ID=5'), PAGE_ATTACK);
});

test('the comparison in slices gives the same answer as in one go (the page stays free between plans)', async () => {
    const { compareStrategies, compareStrategiesAsync, playerContext, buildOf } = await import('../src/core/model.js');
    const { targetShares } = await import('../src/core/plan.js');
    const { normalizeState } = await import('../src/core/bars.js');
    const state = normalizeState({ bars: { energy: { current: 20, maximum: 150, increment: 5, interval: 600, tick_time: 120 }, happy: { current: 5000, maximum: 5025, increment: 5, interval: 900, tick_time: 300 } }, cooldowns: { drug: 0, booster: 0 }, refills: { energy: false }, battlestats: { strength: { value: 118400 }, speed: { value: 110900 }, defense: { value: 96200 }, dexterity: { value: 82700 } }, gym: { id: 18 } }, Date.UTC(2026, 8, 29, 12));
    const pc = playerContext(state, {});
    const args = { state, pc, shares: targetShares({ build: 'balanced' }, pc.stats, buildOf('balanced').shares), settings: { horizonDays: 30, budget: 150e6 }, prices: {} };
    let pauses = 0;
    const a = await compareStrategiesAsync(args, { pause: async () => pauses++ });
    const b = compareStrategies(args);
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
    for (const id of Object.keys(b)) assert.equal(Math.round(a[id].gained), Math.round(b[id].gained), id);
    assert.ok(pauses >= Object.keys(b).length, 'a break before each plan (' + pauses + ')');
});
