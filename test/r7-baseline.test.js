/*
 * Round 7, R7.0: the baseline table holds still (ROUND7-PLAN §2.1). Every
 * plan for the three reference players, through the real Create plan, must
 * give the stored numbers. A change that is meant: `node test/baseline.mjs`
 * shows what moved, `--write` stores it, and the before/after goes into the
 * handoff. A change that isn't meant stops here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { runBaseline, readStored, diffBaseline } from './support/baseline-lib.mjs';

test('the baseline table: every plan for the three reference players gives the stored numbers', async () => {
    const stored = readStored();
    assert.ok(stored, 'test/baseline/round7.json is missing: node test/baseline.mjs --write');
    const now = await runBaseline({ timed: false });
    const moved = diffBaseline(stored.numbers, now.numbers);
    assert.equal(moved.length, 0, 'the baseline moved (node test/baseline.mjs shows the table; --write only when the change is meant):\n  ' + moved.slice(0, 40).join('\n  '));
});
