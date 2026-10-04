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

// Session 10: Tampermonkey runs a script that has a @grant inside `with (sandbox)`, where every global the code names
// is looked up through the sandbox on each use (the owner's recalibration: 13 to 15 s in his browser for 1 to 2 s of
// work; docs/sims/round9/sandbox-bench.mjs). The build hands the language's own globals in as parameters: one lookup each.
test('inside a Tampermonkey-like scope the language’s globals are looked up once, not on every use', { skip: !bundle }, () => {
    const store = {};
    const seen = {};
    const base = {
        GM_getValue: (k, d) => (k in store ? store[k] : d),
        GM_setValue: (k, v) => {
            store[k] = v;
        },
        location: { href: 'https://www.torn.com/gym.php' },
        document: { documentElement: { setAttribute: () => {} } },
        setTimeout,
        clearTimeout,
        console,
        URL,
        URLSearchParams,
    };
    const ctx = vm.createContext({ base, seen, bundle });
    new vm.Script(
        'const sandbox = new Proxy(base, { has: () => true, get: (t, k) => { if (typeof k === "string") seen[k] = (seen[k] || 0) + 1; return k === Symbol.unscopables ? undefined : k in t ? t[k] : globalThis[k]; } });' +
            'new Function("sandbox", "with (sandbox) {" + bundle + String.fromCharCode(10) + "}")(sandbox);',
    ).runInContext(ctx);
    assert.equal(JSON.parse(store['pumpingIron.v1.lastBoot']).where, 'gym', 'it boots inside the scope');
    for (const name of ['Math', 'Number', 'Object', 'Array', 'JSON', 'Date', 'Set', 'Map', 'Promise', 'String', 'Boolean', 'Error', 'Infinity', 'NaN']) assert.equal(seen[name], 1, name + ' was looked up through the sandbox ' + seen[name] + ' times while starting');
    assert.equal(seen.undefined, undefined, '`undefined` is never looked up through the sandbox');
});
