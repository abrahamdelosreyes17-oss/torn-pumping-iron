/*
 * Round 7 review, finding 5: a war list or target list stored before round 7's deploy still holds Tough and Can't win.
 * Read back, they printed "**undefined**" in /war, sorted first (indexOf -1) and showed as "No data" in /targets.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { estimator, warPages, warGroups, BEATABLE } from '../src/war.js';
import { estimateText } from '../src/cmd-torn.js';

const OLD_WAR_LIST = { factionId: 888, members: [{ id: 1, name: 'Old_Tough', band: 'tough', win: 40, keep: 20 }, { id: 2, name: 'Fresh_Stomp', band: 'stomp', win: 99, keep: 100 }, { id: 3, name: 'Old_Cant', band: 'cant', win: 5, keep: 0 }] };
const players = [
    { id: 2, name: 'Fresh_Stomp', level: 5, state: 'Okay', online: '', until: 0, description: 'Okay' },
    { id: 1, name: 'Old_Tough', level: 5, state: 'Okay', online: '', until: 0, description: 'Okay' },
    { id: 3, name: 'Old_Cant', level: 5, state: 'Okay', online: '', until: 0, description: 'Okay' },
];

test('a stored war list with old band names reads them as under 50%: named, sorted last, never beatable', () => {
    const est = estimator(OLD_WAR_LIST, 888, {});
    assert.equal(est(1).band, 'low');
    assert.equal(est(3).band, 'low');
    assert.equal(est(2).band, 'stomp');
    assert.equal(est(1).win, 40, 'the synced win % stays');
    assert.ok(!BEATABLE.has(est(1).band));
    assert.deepEqual(warGroups(players, est, 0).hit.map((p) => p.name), ['Fresh_Stomp', 'Old_Tough', 'Old_Cant']);
    const page = warPages({ enemyName: 'Red Fist', start: 0 }, players, est, null, 0)[0];
    assert.ok(!page.includes('undefined'), page);
    assert.match(page, /\*\*Under 50%\*\* · Old_Tough/);
    assert.match(page, /1 you can beat out now/);
});

test('/targets and /target: an old band reads as under 50%, not "No data"', () => {
    assert.equal(estimateText({ band: 'tough', win: 40, keep: 20 }), '**Under 50%** (win 40%, keeps 20% life)');
    assert.equal(estimateText({ band: 'cant' }), '**Under 50%**');
    assert.equal(estimateText({ band: 'good', win: 97 }), '**Good** (win 97%)');
    assert.equal(estimateText({ band: 'whatever' }), '**No data**');
});
