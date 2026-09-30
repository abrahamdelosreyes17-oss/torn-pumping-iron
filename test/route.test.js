import test from 'node:test';
import assert from 'node:assert/strict';

import {
    detectPage,
    profileIdOf,
    attackTargetOf,
    bazaarOwnerId,
    factionIdOf,
    itemMarketItemOf,
    isAppPageUrl,
    APP_PAGE_URL,
    bazaarUrl,
    itemMarketUrl,
    attackUrl,
    PAGE_GYM,
    PAGE_ITEMS,
    PAGE_ITEM_MARKET,
    PAGE_BAZAAR,
    PAGE_POINTS,
    PAGE_PROFILE,
    PAGE_FACTION,
    PAGE_ATTACK,
    PAGE_OTHER,
} from '../src/sources/route.js';
import { decideLeader, LEADER_STALE_MS, LEADER_RENEW_MS } from '../src/core/leader.js';

test('each Torn page is recognised by its own address', () => {
    const cases = [
        ['https://www.torn.com/gym.php', PAGE_GYM],
        ['https://www.torn.com/item.php#drugs-items', PAGE_ITEMS],
        ['https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=206', PAGE_ITEM_MARKET],
        ['https://www.torn.com/bazaar.php?userId=123#/', PAGE_BAZAAR],
        ['https://www.torn.com/pmarket.php', PAGE_POINTS],
        ['https://www.torn.com/profiles.php?XID=4', PAGE_PROFILE],
        ['https://www.torn.com/factions.php?step=profile&ID=9', PAGE_FACTION],
        ['https://www.torn.com/loader.php?sid=attack&user2ID=77', PAGE_ATTACK],
        ['https://www.torn.com/page.php?sid=attack&user2ID=77', PAGE_ATTACK],
        ['https://www.torn.com/page.php?sid=attackData', PAGE_OTHER],
        ['https://www.torn.com/index.php', PAGE_OTHER],
        ['', PAGE_OTHER],
        [null, PAGE_OTHER],
    ];
    for (const [href, want] of cases) assert.equal(detectPage(href), want, String(href));
});

test('the harness stands in for a page only off torn.com', () => {
    assert.equal(detectPage('http://127.0.0.1:8785/test/harness.html?page=gym'), PAGE_GYM);
    assert.equal(detectPage('https://www.torn.com/index.php?page=gym'), PAGE_OTHER);
    assert.equal(detectPage('http://127.0.0.1:8785/test/harness.html?page=nonsense'), PAGE_OTHER);
});

test('ids come from the page address, any spelling', () => {
    assert.equal(profileIdOf('https://www.torn.com/profiles.php?XID=2345'), '2345');
    assert.equal(profileIdOf('https://www.torn.com/profiles.php?xid=2345'), '2345');
    assert.equal(profileIdOf('https://www.torn.com/gym.php?XID=2345'), null);
    assert.equal(attackTargetOf('https://www.torn.com/loader.php?sid=attack&user2ID=77'), '77');
    assert.equal(bazaarOwnerId('https://www.torn.com/bazaar.php?userid=5#/'), '5');
    assert.equal(bazaarOwnerId('https://www.torn.com/bazaar.php#/'), null);
    assert.equal(factionIdOf('https://www.torn.com/factions.php?step=profile&ID=9'), '9');
    assert.equal(itemMarketItemOf('https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=206'), '206');
    assert.equal(profileIdOf('https://www.torn.com/profiles.php?XID=12x'), null);
});

test('the webpage is the GitHub Pages address, or the harness marker off torn.com', () => {
    assert.equal(isAppPageUrl(APP_PAGE_URL), true);
    assert.equal(isAppPageUrl(APP_PAGE_URL + '#plan'), true);
    assert.equal(isAppPageUrl('http://127.0.0.1:8785/test/harness.html?pi=app'), true);
    assert.equal(isAppPageUrl('https://www.torn.com/index.php?pi=app'), false);
    assert.equal(isAppPageUrl('https://abrahamdelosreyes17-oss.github.io/other/app.html'), false);
});

test('links go to the exact Torn page', () => {
    assert.equal(bazaarUrl(1234567), 'https://www.torn.com/bazaar.php?userId=1234567#/');
    assert.equal(itemMarketUrl(206), 'https://www.torn.com/page.php?sid=ItemMarket#/market/view=search&itemID=206');
    assert.equal(attackUrl(77), 'https://www.torn.com/page.php?sid=attack&user2ID=77');
});

test('only one visible tab leads, and a hidden leader steps down', () => {
    const now = 100_000;
    let d = decideLeader(null, 'A', { now, visible: true });
    assert.deepEqual([d.lead, d.confirmed], [true, false]);
    const record = d.write;
    d = decideLeader(record, 'B', { now: now + 1000, visible: true });
    assert.equal(d.lead, false);
    d = decideLeader(record, 'A', { now: now + 5000, visible: true });
    assert.deepEqual([d.lead, d.confirmed], [true, true]);
    assert.equal(d.write, null, 'round 6: the claim is not rewritten on every check (each GM write reaches every tab)');
    d = decideLeader(record, 'A', { now: now + LEADER_RENEW_MS, visible: true });
    assert.deepEqual(d.write, { id: 'A', ts: now + LEADER_RENEW_MS }, 'renewed every 10 s');
    d = decideLeader(record, 'A', { now: now + 6000, visible: false });
    assert.deepEqual(d.write, { id: null, ts: 0 });
    d = decideLeader({ id: 'A', ts: now }, 'B', { now: now + LEADER_STALE_MS + 1, visible: true });
    assert.equal(d.lead, true);
    d = decideLeader(null, 'C', { now, visible: false });
    assert.equal(d.lead, false);
});
