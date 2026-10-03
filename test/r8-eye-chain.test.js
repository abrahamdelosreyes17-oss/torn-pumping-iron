/*
 * Round 8, Torn Eye §1 (mockups/round8/torn-eye.html, the owner's pick B): the war row's tag (band, HP kept, where
 * they are), the summary on top ("4 ready · next out in 12m · 2 away"), and the chain counter: its own card above the
 * training panel with, per chain, the count, the time left on the 5:00 timer (amber under a minute) and the hits to
 * the next bonus; two thin lines in a narrow margin. Wired into chain mode: the counter shows while it is on.
 * A chain nothing was read about says "Not read yet": never a made-up figure.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, cleanText } from './support/fake-dom.mjs';

installFakeDom();
const { CHAIN_BONUSES, CHAIN_FRESH_MS, chainNext, chainClock, chainFromApi, chainFromBar, chainSide, chainBonusText, sharedChain } = await import('../src/core/eye/chain.js');
const { eyeRowTag, eyeSummary, eyeWarSummaryText, eyeSummaryTag, eyeHm, eyeTickOut, eyeChainCard, eyeChainTick, EYE_CSS } = await import('../src/ui/eye/eye-ui.js');
const { normalizeState } = await import('../src/core/bars.js');
const { chainModeCard, chainCounter } = await import('../src/ui/app/eye-tab.js');
const { attackPanelView } = await import('../src/torn-page.js');
const { dockUnder } = await import('../src/ui/overlay.js');

const NOW = Date.parse('2026-10-03T14:38:00Z');

test('the next bonus and the hits to it', () => {
    assert.deepEqual(chainNext(247), { at: 250, hits: 3 });
    assert.deepEqual(chainNext(96), { at: 100, hits: 4 });
    assert.deepEqual(chainNext(250), { at: 500, hits: 250 }, 'on a bonus: the next one');
    assert.deepEqual(chainNext(0), { at: 10, hits: 10 });
    assert.deepEqual(chainNext(247, 250), { at: 250, hits: 3 }, "Torn's own next mark, when it is above the count");
    assert.deepEqual(chainNext(260, 250), { at: 500, hits: 240 }, 'a mark at or under the count is not used');
    assert.equal(chainNext(CHAIN_BONUSES[CHAIN_BONUSES.length - 1]), null, 'past the last bonus');
    assert.equal(chainClock(222), '3:42');
    assert.equal(chainClock(48), '0:48');
    assert.equal(chainClock(0), '0:00');
    assert.equal(chainClock(3900), '1:05:00');
});

test("a chain from Torn's API, and from the sidebar's bar", () => {
    const api = chainFromApi({ id: 1, current: 247, max: 250, timeout: 222, modifier: 1.5, cooldown: 0, start: 1, end: 2 }, NOW);
    assert.deepEqual(api, { current: 247, max: 250, until: NOW + 222000, cooldownUntil: 0, at: NOW });
    assert.equal(chainFromApi(null, NOW), null);
    assert.equal(chainFromApi({ current: 250, max: 250, timeout: 0, cooldown: Math.floor(NOW / 1000) + 600 }, NOW).cooldownUntil, (Math.floor(NOW / 1000) + 600) * 1000);
    assert.deepEqual(chainFromBar('247/250', '03:42', NOW), { current: 247, max: 250, until: NOW + 222000, cooldownUntil: 0, at: NOW });
    assert.deepEqual(chainFromBar('0/10', '00:00', NOW), { current: 0, max: 10, until: 0, cooldownUntil: 0, at: NOW });
    assert.equal(chainFromBar('1,250/2,500', '04:59', NOW).current, 1250);
    assert.equal(chainFromBar('', '', NOW), null, 'no bar on the page');
    // The timer never shows over 5:00: a longer clock is the cooldown after a chain.
    const cool = chainFromBar('250/500', '45:12', NOW);
    assert.equal(cool.until, 0);
    assert.equal(cool.cooldownUntil, NOW + 2712000);
    // Your bars carry your faction's chain (the state read).
    assert.deepEqual(normalizeState({ bars: { chain: { current: 12, max: 25, timeout: 100, cooldown: 0 } } }, NOW).chain, { current: 12, max: 25, until: NOW + 100000, cooldownUntil: 0, at: NOW });
    assert.equal(normalizeState({ bars: { chain: null } }, NOW).chain, null);
});

test('one side of the counter: running, amber under a minute, off, cooldown, not read', () => {
    const on = chainSide(chainFromBar('247/250', '03:42', NOW), NOW);
    assert.deepEqual(on, { state: 'on', count: 247, leftS: 222, low: false, pct: 74, next: { at: 250, hits: 3 }, until: NOW + 222000 });
    assert.equal(chainBonusText(on), '3 hits to the 250 bonus');
    const low = chainSide(chainFromApi({ current: 96, max: 100, timeout: 48 }, NOW), NOW);
    assert.equal(low.low, true);
    assert.equal(low.pct, 16);
    assert.equal(chainBonusText(low), '4 hits to the 100 bonus');
    assert.equal(chainBonusText(chainSide(chainFromBar('249/250', '01:00', NOW), NOW)), '1 hit to the 250 bonus');
    assert.equal(chainBonusText(chainSide(chainFromBar('999/1000', '01:00', NOW), NOW)), '1 hit to the 1,000 bonus');
    // The same read 4 minutes on: the timer ran out, no chain.
    const off = chainSide(chainFromBar('247/250', '03:42', NOW), NOW + 240000);
    assert.equal(off.state, 'off');
    assert.equal(chainBonusText(off), 'No chain running');
    assert.equal(chainSide(chainFromBar('0/10', '00:00', NOW), NOW).state, 'off');
    const cool = chainSide(chainFromBar('250/500', '45:12', NOW), NOW);
    assert.equal(cool.state, 'cooldown');
    assert.equal(cool.leftS, 2712);
    assert.equal(chainBonusText(cool), 'On cooldown');
    const none = chainSide(null, NOW);
    assert.deepEqual([none.state, none.count], ['unknown', null]);
    assert.equal(chainBonusText(none), 'Not read yet');
    // The enemy's chain as shared by the Torn Eye tab: believed for two minutes.
    const rec = { at: NOW, fid: 8124, name: 'Iron Legion', current: 96, max: 100, until: NOW + 48000, cooldownUntil: 0 };
    assert.equal(sharedChain(rec, NOW + 60000), rec);
    assert.equal(sharedChain(rec, NOW + CHAIN_FRESH_MS), null);
    assert.equal(sharedChain(null, NOW), null);
});

const viewOf = (o = {}) => ({ id: 3, name: 'Iron_Monk', level: 94, band: 'good', respect: 4.29, forecast: { pWin: 0.79, keep: 0.7 }, est: { source: 'ffscouter', ageDays: 5 }, ...o });
const NOWS = Math.floor(NOW / 1000);

test('a war row: the band, HP kept, then where they are', () => {
    assert.equal(eyeHm(12 * 60), '12m');
    assert.equal(eyeHm(77 * 60), '1h 17m');
    const ready = eyeRowTag(viewOf({ band: 'stomp', forecast: { pWin: 0.99, keep: 0.99 } }), { mode: 'full', state: 'okay', glow: true, where: true });
    assert.equal(cleanText(ready.textContent), 'Stomp99% HPOkay');
    assert.ok(ready.classList.contains('pi-glow') && !ready.classList.contains('pi-out'));
    assert.ok(ready.byClass('pi-st')[0].classList.contains('pi-ok'));
    const hosp = eyeRowTag(viewOf(), { mode: 'full', state: 'hospital', outInS: 724, outAt: NOWS + 724, where: true });
    assert.equal(cleanText(hosp.textContent), 'Good70% HPHospital 13m');
    assert.ok(hosp.classList.contains('pi-out') && !hosp.classList.contains('pi-dimmed') && !hosp.classList.contains('pi-glow'), 'not ready: the band and the number fade, the tag stays');
    assert.ok(hosp.byClass('pi-st')[0].classList.contains('pi-wait'));
    assert.equal(cleanText(eyeRowTag(viewOf(), { mode: 'full', state: 'hospital', where: true }).textContent), 'Good70% HPHospital', 'no clock on the row: no time made up');
    assert.equal(cleanText(eyeRowTag(viewOf({ band: 'fair', forecast: { pWin: 0.76, keep: 0.69 } }), { mode: 'full', state: 'abroad', where: true }).textContent), 'Fair69% HPAbroad');
    assert.equal(cleanText(eyeRowTag(viewOf(), { mode: 'full', state: 'traveling', where: true }).textContent), 'Good70% HPTraveling');
    assert.equal(cleanText(eyeRowTag(viewOf(), { mode: 'full', state: 'early', where: true }).textContent), 'Good70% HPOut early');
    assert.ok(eyeRowTag(viewOf(), { mode: 'full', state: 'abroad', where: true }).byClass('pi-st')[0].classList.contains('pi-away'));
    // Narrower: the edge carries the band; the narrowest: HP kept for a ready row, where the others are.
    assert.equal(cleanText(eyeRowTag(viewOf(), { mode: 'short', state: 'hospital', outInS: 4620, outAt: NOWS + 4620, where: true }).textContent), '70%Hosp 1h 17m');
    assert.equal(cleanText(eyeRowTag(viewOf(), { mode: 'short', state: 'traveling', where: true }).textContent), '70%Flying');
    assert.equal(cleanText(eyeRowTag(viewOf(), { mode: 'tiny', state: 'okay', where: true }).textContent), '70% HP');
    assert.equal(cleanText(eyeRowTag(viewOf(), { mode: 'tiny', state: 'hospital', outInS: 4620, outAt: NOWS + 4620, where: true }).textContent), '1h 17m');
    // The other two numbers are not lost: the tag's label carries them (and its hover card).
    assert.match(hosp.getAttribute('aria-label'), /^Good · HP kept 70% · Hospital 13m · Respect 4\.29 · Win 79%$/);
    // A faction list's row keeps the three numbers (only the war row changed).
    assert.equal(cleanText(eyeRowTag(viewOf(), { mode: 'full' }).textContent), 'Good4.2970% HP79%');
});

test('the war row clock moves on by itself, in the tag’s own words', () => {
    const hosp = eyeRowTag(viewOf(), { mode: 'full', state: 'hospital', outInS: 724, outAt: NOWS + 724, where: true });
    assert.equal(eyeTickOut(hosp, NOWS + 120), 1);
    assert.equal(cleanText(hosp.textContent), 'Good70% HPHospital 11m');
    assert.equal(eyeTickOut(hosp, NOWS + 123), 0, 'the same minute: nothing written');
});

test('the summary on top: "4 ready · next out in 12m · 2 away"', () => {
    const rows = [{ state: 'okay' }, { state: 'okay' }, { state: 'okay' }, { state: 'early' }, { state: 'hospital', until: NOWS + 720 }, { state: 'hospital', until: NOWS + 4620 }, { state: 'traveling' }, { state: 'abroad' }];
    const s = eyeSummary(rows, NOWS);
    assert.equal(s.away, 2);
    assert.equal(eyeWarSummaryText(s), '4 ready (1 out early) · next out in 12m · 2 away');
    assert.equal(eyeWarSummaryText(eyeSummary([{ state: 'okay' }], NOWS)), '1 ready · 0 away');
    assert.equal(eyeWarSummaryText(eyeSummary([{ state: 'hospital', until: 0 }], NOWS)), '0 ready · 1 in hospital · 0 away');
    const tag = eyeSummaryTag(s, { war: true, fromFfs: true });
    assert.equal(cleanText(tag.textContent), '4 ready (1 out early) · next out in 12m · 2 away · stats: FFScouter');
    assert.equal(tag.byAttr('data-pi-out-fmt', 'hm').length, 1, 'its clock ticks too');
    // A faction list's summary is as it was.
    assert.equal(cleanText(eyeSummaryTag(s).textContent), '4 ready (1 out early) · 1 out in 0:12 · 1 traveling');
});

const mine = { who: 'Your faction', short: 'You', side: chainSide(chainFromBar('247/250', '03:42', NOW), NOW) };
const theirs = { who: 'Iron Legion', short: 'Them', side: chainSide(chainFromApi({ current: 96, max: 100, timeout: 48 }, NOW), NOW), hint: 'open War on the Torn Eye tab' };

test('the chain counter: a card with both chains', () => {
    const card = eyeChainCard([mine, theirs]);
    assert.equal(card.id, 'pi-chaincard');
    assert.equal(card.getAttribute('data-pi-form'), 'card');
    assert.equal(cleanText(card.textContent), 'Chainstime left of 5:00Your faction3:422473 hits to the 250 bonusIron Legion0:48964 hits to the 100 bonus');
    const sides = card.byClass('pi-cside');
    assert.deepEqual(sides.map((s) => s.getAttribute('data-pi-chain')), ['on', 'on']);
    assert.ok(!sides[0].byClass('pi-ctime')[0].classList.contains('pi-low'));
    assert.ok(sides[1].byClass('pi-ctime')[0].classList.contains('pi-low'), 'amber under 1:00');
    assert.deepEqual(sides.map((s) => s.querySelector('.pi-ctm i').getAttribute('style')), ['width:74%', 'width:16%']);
    // The enemy's chain not read: it says so, with where to read it. No figure.
    const unread = eyeChainCard([mine, { ...theirs, who: 'Enemy faction', side: chainSide(null, NOW) }]);
    assert.match(cleanText(unread.textContent), /Enemy faction——Not read yet · open War on the Torn Eye tab$/);
    // Only your chain (chain mode, no war).
    assert.equal(cleanText(eyeChainCard([{ ...mine, side: chainSide(chainFromBar('0/10', '00:00', NOW), NOW) }]).textContent), 'Chaintime left of 5:00Your faction—0No chain running');
});

test('the chain counter in a narrow margin: one thin line a chain', () => {
    const lines = eyeChainCard([mine, theirs], { lines: true });
    assert.equal(lines.getAttribute('data-pi-form'), 'lines');
    assert.deepEqual(lines.children.map((l) => cleanText(l.textContent)), ['You 247 · 3:42 · 3 to 250', 'Them 96 · 0:48 · 4 to 100']);
    assert.equal(lines.children[1].getAttribute('style'), '--b:#e8a33d', 'the low chain’s line is amber');
    assert.equal(cleanText(eyeChainCard([{ ...theirs, side: chainSide(null, NOW) }], { lines: true }).textContent), 'Them · not read');
    assert.equal(cleanText(eyeChainCard([{ ...mine, side: chainSide(chainFromBar('0/10', '00:00', NOW), NOW) }], { lines: true }).textContent), 'You 0 · no chain');
});

test('the counter’s clocks move on each second; a chain that ran out is counted', () => {
    const card = eyeChainCard([mine, theirs]);
    assert.equal(eyeChainTick(card, NOW + 10000), 0);
    const sides = card.byClass('pi-cside');
    assert.equal(sides[0].byClass('pi-ctime')[0].textContent, '3:32');
    assert.equal(sides[0].querySelector('.pi-ctm i').style.width, '71%');
    assert.equal(sides[1].byClass('pi-ctime')[0].textContent, '0:38');
    // 3 minutes on: yours is under a minute (amber), theirs ran out.
    assert.equal(eyeChainTick(card, NOW + 180000), 1);
    assert.ok(sides[0].byClass('pi-ctime')[0].classList.contains('pi-low'));
    assert.equal(sides[1].byClass('pi-ctime')[0].textContent, '0:00');
    assert.equal(eyeChainTick(null, NOW), 0);
    assert.match(EYE_CSS, /\.pi-chain \.pi-low \{ color: #e8a33d; \}/);
});

test('chain mode on the Torn Eye tab carries the counter while it is on', () => {
    const model = { ready: true, pc: { stats: {} }, state: {} };
    const chains = { mine: chainFromApi({ current: 247, max: 250, timeout: 222 }, Date.now()), enemy: { fid: 8124, name: 'Iron Legion', raw: null } };
    const ctx = { settings: { timeFormat: 'torn' }, eye: { chains: () => chains } };
    const off = chainModeCard(model, ctx);
    assert.equal(off.byAttr('data-chain-counter').length, 0, 'off: no counter');
    const on = chainModeCard({ ...model, stacking: { since: Date.parse('2026-10-03T14:02:00Z') } }, ctx);
    const counter = on.byAttr('data-chain-counter')[0];
    assert.match(cleanText(counter.textContent), /^Your faction3:4[12]2473 hits to the 250 bonusIron Legion——Not read yet$/);
    assert.deepEqual(counter.byAttr('data-chain').map((n) => n.getAttribute('data-chain')), ['on', 'unknown']);
    assert.ok(on.textContent.indexOf('Your faction') < on.textContent.indexOf('Your energy is kept for the chain'), 'the counter sits over the words');
    // Not at war: your chain alone; nothing read at all: it says so.
    assert.equal(cleanText(chainCounter({ mine: null, enemy: null }, NOW).textContent), 'Your faction——Not read yet');
    assert.equal(chainCounter(null, NOW).byAttr('data-chain').length, 1);
});

test('the attack page: the panel’s line says Training, never Next', () => {
    const v = { tone: 'chalk', label: 'Now', pillNow: 'Now', pillText: 'Train DEX × 17', cardStep: 'Train DEX × 17' };
    assert.deepEqual(attackPanelView(v, 'attack'), { tone: 'chalk', label: 'Now', pillText: 'Training: DEX × 17 · after this fight', cardStep: 'Train DEX × 17' });
    const later = attackPanelView({ label: 'Next', cdAt: 5, pillText: 'Train SPD × 100', cardStep: 'Session done. Next: Train SPD × 100' }, 'attack');
    assert.deepEqual(later, { label: 'Training', cdAt: 5, pillText: 'Training: SPD × 100', cardStep: 'Session done. Then: Train SPD × 100' });
    assert.equal(attackPanelView(v, 'gym'), v, 'every other page is as it was');
    const stack = { tone: 'amber', label: 'Stacking', pillText: 'Stacking for a chain · training paused' };
    assert.deepEqual(attackPanelView(stack, 'attack'), stack);
    assert.equal(attackPanelView({ off: true }, 'attack').off, true);
    assert.equal(typeof dockUnder, 'function');
});
