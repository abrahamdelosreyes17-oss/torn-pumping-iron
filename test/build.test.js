/*
 * The released file: header fixed where Tampermonkey needs it fixed, and the
 * bundle parses. `npm run check` builds before testing, so this reads the
 * file that would ship.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const bundle = await readFile(new URL('../torn-pumping-iron.user.js', import.meta.url), 'utf8').catch(() => '');

test('the release file exists and parses', { skip: !bundle && 'run npm run build first' }, () => {
    assert.doesNotThrow(() => new vm.Script(bundle));
});

test('@name and @namespace never change; @version follows package.json', { skip: !bundle }, () => {
    const header = bundle.slice(0, bundle.indexOf('// ==/UserScript=='));
    assert.match(header, /^\/\/ @name {9}Torn Pumping Iron$/m);
    assert.match(header, /^\/\/ @namespace {4}torn-pumping-iron$/m);
    assert.match(header, new RegExp('^// @version {6}' + pkg.version.replace(/\./g, '\\.') + '$', 'm'));
    assert.match(header, /@updateURL +https:\/\/raw\.githubusercontent\.com\/abrahamdelosreyes17-oss\/torn-pumping-iron\/main\/torn-pumping-iron\.user\.js/);
    assert.match(header, /@noframes/);
});

test('the script may reach only the hosts it names', { skip: !bundle }, () => {
    const connects = [...bundle.matchAll(/^\/\/ @connect +(\S+)$/gm)].map((m) => m[1]).sort();
    assert.deepEqual(connects, ['api.torn.com', 'ffscouter.com', 'weav3r.dev', 'workers.dev', 'www.tornstats.com']);
});

test('boots under stub GM functions and records where it ran', { skip: !bundle }, () => {
    const store = {};
    const attrs = {};
    const ctx = {
        GM_getValue: (k, d) => (k in store ? store[k] : d),
        GM_setValue: (k, v) => {
            store[k] = v;
        },
        location: { href: 'https://www.torn.com/gym.php' },
        document: { documentElement: { setAttribute: (k, v) => (attrs[k] = v) } },
        setTimeout,
        clearTimeout,
        console,
        URL,
        URLSearchParams,
    };
    vm.createContext(ctx);
    new vm.Script(bundle).runInContext(ctx);
    const last = JSON.parse(store['pumpingIron.v1.lastBoot']);
    assert.equal(last.where, 'gym');
    assert.equal(last.version, pkg.version);
});
