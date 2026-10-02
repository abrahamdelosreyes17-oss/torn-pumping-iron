/*
 * Round 7's baseline table (see test/support/baseline-lib.mjs).
 *   node test/baseline.mjs           the table now, and what moved against the stored one
 *   node test/baseline.mjs --write   store it (test/baseline/round7.json, round7.md): only when the change is meant
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { runBaseline, readStored, stringify, markdown, diffBaseline, BASELINE_FILE } from './support/baseline-lib.mjs';

const write = process.argv.includes('--write');
const stored = readStored();
const now = await runBaseline();
console.log(markdown(now));
if (stored) {
    const moved = diffBaseline(stored.numbers, now.numbers);
    console.log(moved.length ? 'Moved against the stored table (' + moved.length + '):\n  ' + moved.join('\n  ') : 'Numbers: the same as the stored table.');
    const t = [];
    for (const [pid, lens] of Object.entries(now.time)) for (const [len, ms] of Object.entries(lens)) t.push(pid + ' ' + len + ' mo: ' + ((stored.time[pid] || {})[len] ?? '—') + ' → ' + ms + ' ms');
    console.log('Time (stored → now, this machine): ' + t.join(' · '));
} else console.log('No stored table yet: run with --write.');
if (write) {
    mkdirSync(dirname(BASELINE_FILE), { recursive: true });
    writeFileSync(BASELINE_FILE, stringify(now));
    writeFileSync(BASELINE_FILE.replace(/\.json$/, '.md'), '# Round 7 baseline\n\nWritten by `node test/baseline.mjs --write`. Sample prices, 2026-10-01 12:00 Torn time, bars full, no cooldowns.\n\n' + markdown(now) + '\n');
    console.log('Stored: ' + BASELINE_FILE);
}
