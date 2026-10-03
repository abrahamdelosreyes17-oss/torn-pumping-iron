/*
 * Round 8, a small fault from the handoff's list: "under about 1,180 px the panel is a corner tag over Torn's
 * header". The cause: a margin beside Torn's page was taken only when it held the one-tag panel (100 px), although
 * the smallest tag is 84 px. From 1,192 to 1,222 px wide (Torn's page 976 px, centred) the margin holds that
 * smallest tag with its usual 12 px on each side, and the tag still went to the window's top corner, over Torn's
 * header. Narrower than that no margin holds a tag: the corner stays (round 7's rule: over the header, never the
 * content).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { spots, pointOf, fitTier, MINI_W, FIT_COMPACT_W, GAP, EDGE, DEFAULT_TOP, CORNER_TOP } from '../src/ui/overlay.js';

const page = (w) => ({ left: (w - 976) / 2, right: (w + 976) / 2 });
const at = (w) => {
    const p = pointOf(null, spots(w, page(w)), 900);
    return { side: p.spot.side, tier: p.spot.tier, width: p.spot.width, x: p.x, y: p.y };
};

test('a margin that holds the smallest tag keeps the panel beside Torn\'s page (it went to the corner, over Torn\'s header)', () => {
    for (const w of [1222, 1210, 1200, 1192]) {
        const free = page(w).left - GAP - EDGE;
        assert.ok(free >= MINI_W && free < FIT_COMPACT_W, w + ' px: the margin has ' + free + ' px free, enough for the smallest tag only');
        const p = at(w);
        assert.equal(p.side, 'left', w + ' px: in the margin, not the corner');
        assert.equal(p.tier, 'mini');
        assert.ok(p.width >= MINI_W, w + ' px: the whole tag fits (' + p.width + ')');
        assert.ok(p.x >= EDGE && p.x + p.width <= page(w).left - GAP, w + ' px: beside Torn\'s page with its usual space (' + p.x + '–' + (p.x + p.width) + ', Torn from ' + page(w).left + ')');
        assert.equal(p.y, DEFAULT_TOP, w + ' px: level with Torn\'s page title, under its header');
    }
});

test('the sizes above it are as they were; with no margin for even the smallest tag it is still the corner', () => {
    assert.deepEqual(at(1224), { side: 'left', tier: 'compact', width: 100, x: 12, y: DEFAULT_TOP });
    assert.deepEqual(at(1280), { side: 'left', tier: 'compact', width: 128, x: 12, y: DEFAULT_TOP });
    for (const w of [1191, 1180, 1100, 1024]) assert.deepEqual(at(w), { side: 'corner', tier: 'mini', width: MINI_W, x: 4, y: CORNER_TOP }, w + ' px');
    // The smallest tag in a margin is the same one tag as in the corner: folded, never opened over Torn's page.
    assert.deepEqual(fitTier(MINI_W), { tier: 'mini', font: 11, step: 14, folded: true });
    // Torn's page off centre: the side that holds a tag takes it, the other is left out.
    assert.deepEqual(spots(1200, { left: 40, right: 1016 }).map((s) => [s.side, s.tier]), [['right', 'compact']]);
    assert.deepEqual(spots(1200, { left: 120, right: 1096 }).map((s) => [s.side, s.tier]), [['left', 'mini']]);
});
