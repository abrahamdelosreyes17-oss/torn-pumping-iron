/*
 * Round 4: Auto mode (income from networth history, the Full key rule, the
 * budget it affords, event switches), the unlock-gym goal, and Log in with
 * Discord on the userscript side.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { incomeFrom, autoState, effectiveSettings, effectivePickBy, affordLine, eventToPlan, eventSwitch, eventSwitchHeads, stackLeadMs, unlockEnergyLeft, unlockDays, incomeBreakdown, autoWaitLine } from '../src/core/auto.js';
import { recommend, PICK_BY } from '../src/core/recommend.js';
import { moneyOf } from '../src/api/torn.js';
import { unlockEnergyAfter } from '../src/core/gyms.js';
import { gmSet, gmGet, gmDel } from '../src/platform/gm.js';
import { getPlan, DEFAULT_PLAN } from '../src/platform/store.js';

const DAY = 86400e3;
const T = Date.UTC(2026, 8, 29, 12);

test('income: networth growth a day over the window, plus what the gym spent meanwhile', () => {
    const snaps = [
        { at: T - 30 * DAY, networth: 10e9, cash: 800e6 },
        { at: T - 7 * DAY, networth: 10.5e9, cash: 850e6 },
        { at: T, networth: 11e9, cash: 900e6 },
    ];
    const i = incomeFrom(snaps, { spentPerDay: 2e6 });
    assert.equal(Math.round(i.days), 30);
    assert.equal(Math.round(i.growthPerDay), Math.round(1e9 / 30));
    assert.equal(Math.round(i.perDay), Math.round(1e9 / 30 + 2e6));
    assert.equal(Math.round(i.cashPerDay), Math.round(100e6 / 30));
    // Too little history (under 3 days) says nothing rather than guess.
    assert.equal(incomeFrom([{ at: T - DAY, networth: 1 }, { at: T, networth: 2 }]), null);
    assert.equal(incomeFrom([]), null);
    // A shorter span still counts once it's 3+ days (the 30-day point missing).
    assert.equal(Math.round(incomeFrom([snaps[1], snaps[2]]).days), 7);
});

test('Auto needs the Full key (owner): without it, a warning and the manual budget', () => {
    const plan = { pickBy: 'auto' };
    const settings = { horizonDays: 30, budget: 150e6 };
    const income = { perDay: 4e6, days: 30 };
    const noKey = autoState({ plan, settings, hasFullKey: false, income });
    assert.equal(noKey.needsKey, true);
    assert.equal(noKey.ready, false);
    assert.equal(effectiveSettings(settings, noKey).budget, 150e6, 'the budget you set, until the key is in');
    assert.equal(effectivePickBy('auto', noKey), 'most');
    assert.match(autoWaitLine(noKey), /Full key/);
    const ok = autoState({ plan, settings, hasFullKey: true, income });
    assert.equal(ok.ready, true);
    assert.equal(effectiveSettings(settings, ok).budget, 4e6 * 30, 'what the income affords over the horizon');
    assert.equal(effectivePickBy('auto', ok), 'auto');
    assert.match(affordLine(ok, 3e6), /You can afford this with your income: about \$4(\.0)?M a day comes in, this plan costs \$3(\.0)?M a day/);
    // Networth falling: nothing that costs money.
    const poor = autoState({ plan, settings, hasFullKey: true, income: { perDay: -1e6, days: 30 } });
    assert.equal(poor.budget, 0);
    assert.match(affordLine(poor, 0), /hasn’t grown/);
    // Waiting for the first read.
    const waiting = autoState({ plan, settings, hasFullKey: true, income: null });
    assert.equal(waiting.waiting, true);
    // A manual plan: Auto is off, no warning.
    const manual = autoState({ plan: { pickBy: 'most' }, settings, hasFullKey: false, income });
    assert.equal(manual.on, false);
    assert.equal(manual.needsKey, false);
});

test('the Plan dropdown lists Auto first; old saved plans move to Auto once, a picked manual plan stays', () => {
    assert.equal(Object.keys(PICK_BY)[0], 'auto');
    assert.equal(DEFAULT_PLAN.pickBy, 'auto');
    gmSet('plan', { strategy: 'steady', pickBy: 'most' });
    assert.equal(getPlan().pickBy, 'auto', 'a 1.1 default moves to Auto');
    gmSet('plan', { strategy: 'steady', pickBy: 'most', pickByPicked: true });
    assert.equal(getPlan().pickBy, 'most', 'chosen on purpose: kept');
    gmSet('plan', { strategy: 'steady', pickBy: 'most', autoMigrated: true });
    assert.equal(getPlan().pickBy, 'most', 'moved once already, then set back: kept');
    gmDel('plan');
});

test('Auto picks the most stats inside the income budget; the unlock goal picks the most energy through the gym', () => {
    const results = {
        steady: { id: 'steady', gained: 100, cost: 10e6, energyTrained: 30000 },
        chocoJump: { id: 'chocoJump', gained: 130, cost: 60e6, energyTrained: 22000 },
        steadyMax: { id: 'steadyMax', gained: 140, cost: 400e6, energyTrained: 45000 },
    };
    assert.equal(recommend(results, { budget: 90e6, pickBy: 'auto' }).recommended, 'chocoJump');
    assert.equal(recommend(results, { budget: 20e6, pickBy: 'auto' }).recommended, 'steady');
    const u = recommend(results, { budget: 90e6, pickBy: 'auto', goal: 'unlock' });
    assert.equal(u.recommended, 'steady', 'more energy through the gym inside the budget');
    assert.match(u.reasons.join(' '), /next gym opens soonest/);
    assert.equal(recommend(results, { budget: Infinity, pickBy: 'max', goal: 'unlock' }).recommended, 'steadyMax');
});

test('unlock goal: energy left from your top gym, less the progress read on the gym page; days per plan', () => {
    const e = unlockEnergyAfter(5) + unlockEnergyAfter(6);
    assert.equal(unlockEnergyLeft([1, 2, 3, 4, 5], 7), e);
    assert.equal(unlockEnergyLeft([1, 2, 3, 4, 5], 7, { nextId: 6, energy: 1000 }), e - 1000);
    assert.equal(unlockEnergyLeft([1, 2, 3, 4, 5, 6, 7], 7), 0, 'already open');
    assert.equal(unlockEnergyLeft([1, 2, 3], 27), null, 'specialist gyms open by ratio, not energy');
    assert.equal(unlockDays({ energyTrained: 30000 }, 10000, 30), 10);
    assert.equal(unlockDays({ energyTrained: 0 }, 10000, 30), null);
});

test('events: Auto switches for World Diabetes Day only when the event plan wins clearly, in time to stack', () => {
    const now = T;
    const ev = { id: 'diabetes', name: 'World Diabetes Day', candyMult: 3, start: now + 3 * DAY, end: now + 5 * DAY, active: false };
    const e = eventToPlan([ev], now);
    assert.ok(e && e.plans.includes('chocoJump'));
    assert.equal(eventToPlan([{ ...ev, start: now + 20 * DAY, end: now + 22 * DAY }], now), null, 'too far ahead');
    const normal = { steady: { id: 'steady', gained: 1000, cost: 4e6 } };
    const win = { chocoJump: { id: 'chocoJump', gained: 1300, cost: 6e6 }, dailyChoco: { id: 'dailyChoco', gained: 1050, cost: 2e6 } };
    const sw = eventSwitch({ event: e, eventCompare: win, normalCompare: normal, budgetPerDay: 5e6, now });
    assert.equal(sw.id, 'chocoJump');
    assert.equal(sw.from, ev.start - stackLeadMs('chocoJump'), 'starts early enough to stack 4 Xanax');
    assert.equal(sw.active, false);
    assert.equal(eventSwitch({ event: e, eventCompare: win, normalCompare: normal, budgetPerDay: 5e6, now: sw.from + 1 }).active, true);
    assert.match(eventSwitchHeads(sw, now).sub, /stacking skips natural energy/);
    // Over budget, or not clearly better: no switch.
    assert.equal(eventSwitch({ event: e, eventCompare: win, normalCompare: normal, budgetPerDay: 1e6, now }), null);
    assert.equal(eventSwitch({ event: e, eventCompare: { chocoJump: { id: 'chocoJump', gained: 1050, cost: 1e6 } }, normalCompare: normal, budgetPerDay: 5e6, now }), null);
});

test('money log: the amount an entry carries, and a breakdown by line that leaves unclear titles out', () => {
    assert.equal(moneyOf({ money: 5000 }), 5000);
    assert.equal(moneyOf({ total_value: 12, cost: 3 }), 12);
    assert.equal(moneyOf({ item: 206 }), 0);
    const b = incomeBreakdown(
        [
            { at: T - 10 * DAY, title: 'Bazaar sell', money: 10e6 },
            { at: T - 2 * DAY, title: 'Bazaar sell', money: 20e6 },
            { at: T - 3 * DAY, title: 'Item market buy', money: 5e6 },
            { at: T - 4 * DAY, title: 'Something odd', money: 99e6 },
        ],
        T,
    );
    assert.equal(Math.round(b.days), 10);
    assert.deepEqual(b.lines.map((l) => [l.title, l.dir]), [['Bazaar sell', 'in'], ['Item market buy', 'out']]);
    assert.equal(Math.round(b.inPerDay), 3e6);
    assert.equal(incomeBreakdown([], T), null);
    // Read over 30 days: one sale 2 days ago is spread over the 30.
    assert.equal(Math.round(incomeBreakdown([{ at: T - 2 * DAY, title: 'Bazaar sell', money: 30e6 }], T, 30).inPerDay), 1e6);
});

test('Log in with Discord: opens Discord, waits, then sends the plan and the main key; a non-member is told why', async () => {
    const calls = [];
    let status = 'open';
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        calls.push({ url, init });
        const path = new URL(url).pathname;
        const body = path === '/login/start' ? { ok: true, id: 'a'.repeat(48), url: 'https://svc.workers.dev/login?id=' + 'a'.repeat(48), expiresAt: 0 } : path === '/login/status' ? { ok: true, state: status, name: 'NoChance17' } : { ok: true, ready: true, linked: true, bot: true, acks: [] };
        return { ok: true, status: 200, json: async () => body };
    };
    try {
        gmDel('worker');
        gmSet('apiKey', 'MainTornKey12345');
        const { loginDiscord, keyTag } = await import('../src/discord.js');
        const opened = [];
        let n = 0;
        const r = await loginDiscord(null, { base: 'https://svc.workers.dev', open: (u) => opened.push(u), sleep: async () => { if (++n === 2) status = 'done'; } });
        assert.equal(r.ok, true);
        assert.match(r.text, /Connected as NoChance17/);
        assert.equal(opened.length, 1);
        const put = calls.find((c) => c.init.method === 'PUT');
        assert.ok(put, 'the plan goes at once');
        assert.equal(JSON.parse(put.init.body).tornKey, 'MainTornKey12345', 'owner: the service uses the main key');
        const w = gmGet('worker', null);
        assert.equal(w.discordName, 'NoChance17');
        assert.equal(w.login, null);
        assert.equal(w.keyTag, keyTag('MainTornKey12345'));
        // Not in the server.
        gmDel('worker');
        status = 'not_member';
        const r2 = await loginDiscord(null, { base: 'https://svc.workers.dev', open: () => {}, sleep: async () => {} });
        assert.equal(r2.ok, false);
        assert.match(r2.text, /not in the Pumping Iron Discord server/);
        assert.equal(gmGet('worker', null).login, null);
    } finally {
        globalThis.fetch = realFetch;
        gmDel('worker');
        gmDel('apiKey');
    }
});

test('the plan sync carries Torn Eye’s war and watch lists when they change, and a new main key once', async () => {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init = {}) => {
        calls.push({ url, init });
        return { ok: true, status: 200, json: async () => ({ ok: true, ready: true, linked: true, bot: true, acks: [] }) };
    };
    try {
        const d = await import('../src/discord.js');
        gmSet('apiKey', 'NewMainKey123456');
        gmSet('worker', { base: 'https://svc.workers.dev', secret: 'd'.repeat(64), discordName: 'NoChance17', keyTag: d.keyTag('OldMainKey123456'), lastSync: 0 });
        d.setEyeForSync({ war: { factionId: 9, members: [{ id: 1, name: 'A', level: 20, band: 'stomp', win: 99, keep: 80 }] }, watch: [{ id: 2, name: 'B', level: 30, band: 'good', win: 90, keep: 50, tag: 'mug' }] });
        const m = { ready: true, steps: [{ at: Date.now() + 60000, kind: 'xanax', label: 'Xanax #1', trains: {} }] };
        assert.equal(d.maybeSyncPlan(m, Date.now()), true);
        await new Promise((r) => setTimeout(r, 10));
        const body = JSON.parse(calls[0].init.body);
        assert.equal(body.tornKey, 'NewMainKey123456', 'the changed key goes once');
        assert.equal(body.war.factionId, 9);
        assert.equal(body.watch[0].tag, 'mug');
        // Same lists, same key, a minute later: neither goes again.
        const w = gmGet('worker', null);
        gmSet('worker', { ...w, lastSync: 0, lastSig: null });
        d.maybeSyncPlan(m, Date.now() + 61000);
        await new Promise((r) => setTimeout(r, 10));
        const body2 = JSON.parse(calls[1].init.body);
        assert.equal(body2.tornKey, undefined);
        assert.equal(body2.war, undefined);
    } finally {
        globalThis.fetch = realFetch;
        gmDel('worker');
        gmDel('apiKey');
    }
});

test('war days: the day plan never trains below the energy kept for a war (Settings › Keep for war days)', async () => {
    const { dayTimeline } = await import('../src/core/plan.js');
    const { BUILDS } = await import('../src/core/builds.js');
    const now = Date.UTC(2026, 8, 29, 10, 0);
    const state = { at: now, energy: { current: 150, maximum: 150, increment: 5, interval: 600, fullTime: 0 }, happy: { current: 5000, maximum: 5000, increment: 5, interval: 900, fullTime: 0 }, cooldowns: { drug: 0, booster: 0, medical: 0 }, drugCd: 0, boosterCd: 0, refillUsed: true, stats: { str: 1e6, spd: 1e6, def: 1e6, dex: 1e6 }, gymId: 1, specialRefills: 0 };
    const ctx = { shares: BUILDS.balanced.shares, unlocked: [1], perks: { str: 1, spd: 1, def: 1, dex: 1 }, keep: [], active: 1 };
    const free = dayTimeline({ state, now, strategy: 'steady', ctx, until: now + 3600e3 });
    const kept = dayTimeline({ state, now, strategy: 'steady', ctx: { ...ctx, keepEnergy: 100 }, until: now + 3600e3 });
    const e0 = free.reduce((a, s) => a + (s.energy || 0), 0);
    const e1 = kept.reduce((a, s) => a + (s.energy || 0), 0);
    assert.ok(e1 <= e0 - 100 + 5, 'about 100 energy fewer trained (' + e0 + ' → ' + e1 + ')');
    assert.ok(kept.some((s) => /keeps 100 energy for the war/.test(s.note || '')));
});
