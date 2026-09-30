/*
 * Perf check (round 6): what Pumping Iron costs a Torn tab, under conditions
 * close to the owner's (docs/research-lag-measured.md), never on torn.com:
 *   - a realistic store (test/perf/seed.mjs: ~800 KB of GM data, 3,000 players
 *     in IndexedDB), left by an earlier page (a 15 s warm-up page first);
 *   - Tampermonkey-like storage (harness &gm=tm: a copy on every read, every
 *     write sent to the other tabs);
 *   - three tabs sharing one thread (two hidden Torn pages open first);
 *   - a Torn-like page that keeps changing (&churn=1);
 *   - 4× CPU slowdown (a slow laptop).
 * Each case profiles the page load (0–10 s) and the steady state (12–32 s).
 *
 *   npm run build
 *   PWPATH=<dir>/node_modules/playwright-core node test/perf-check.mjs [case ...]
 *
 * Cases: gym, plain, profile (default: all three), friend, noscript (Torn's page alone).
 * CPU=1 runs without the slowdown. PERF_OUT=<file> appends each result as a JSON line.
 * Exits 1 when a target is missed (REPORT_ONLY=1: always 0).
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { readFile, appendFile } from 'node:fs/promises';
import { realisticStore } from './perf/seed.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PWPATH || 'playwright-core');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..').split('\\').join('/');

/** What a Torn tab may cost at 4× CPU (round 6's bar; a stock Torn page alone is ~250 ms busy per 10 s here). */
export const TARGETS = {
    loadScriptMs: 350, // script time in the first 10 s (the 1 MB script's own parse is ~150 ms of it)
    loadWorstMs: 200, // the longest task in the first 10 s
    steadyScriptPer10s: 60, // script time per 10 s once loaded
    gmKB: 30, // Tampermonkey's store (handed to every page before the script starts)
    gmWritesPer10s: 2, // GM writes per 10 s once loaded (each goes to every tab)
};

const P = 'pumpingIron.v1.';
const PORT = 8796;
const LOAD_S = 10;
const STEADY_FROM_S = 12;
const STEADY_S = 20;
const CPU = Number(process.env.CPU || 4);
const BASE = `http://127.0.0.1:${PORT}/test/harness-live.html?key=1&at=2026-09-29T10:48:00Z&wait=100000&`;
const PAGES = {
    gym: 'page=gym&fixture=gym-owner&who=owner&build=hank&full=1&ffs=1',
    friend: 'page=gym&fixture=gym-friend&energy=275&build=balanced&ffs=1',
    plain: 'who=owner&build=hank&full=1&ffs=1',
    profile: 'page=profile&fixture=profile&who=owner&build=hank&full=1&ffs=1',
};
const CASES = {
    gym: { page: 'gym' },
    plain: { page: 'plain' },
    profile: { page: 'profile' },
    friend: { page: 'friend' },
    noscript: { page: 'gym', noscript: true },
};

const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    if (path === '/blank.html') {
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('<!doctype html><title>blank</title>');
        return;
    }
    try {
        const body = await readFile(root + path);
        res.writeHead(200, { 'content-type': types[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream' });
        res.end(body);
    } catch {
        res.writeHead(404);
        res.end();
    }
}).listen(PORT);
const browser = await chromium.launch({ channel: process.env.PWCHANNEL || 'msedge' });

const store = realisticStore({ receiptsDays: 1 });
const eyeRaw = JSON.stringify(store.eye);

function longtaskInit() {
    window.__long = [];
    try {
        new PerformanceObserver((l) => {
            for (const e of l.getEntries()) window.__long.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) });
        }).observe({ type: 'longtask', buffered: true });
    } catch {}
}

/** Busy and script time from a CPU profile, and the heaviest functions (inclusive, in the script). */
function analyse(profile) {
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const parent = new Map();
    for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
    const dt = new Map();
    for (let i = 0; i < profile.samples.length; i++) dt.set(profile.samples[i], (dt.get(profile.samples[i]) || 0) + (profile.timeDeltas[i] || 0));
    const incl = new Map();
    let total = 0;
    let idle = 0;
    let script = 0;
    for (const [id, us] of dt) {
        total += us;
        const n = byId.get(id);
        if (n.callFrame.functionName === '(idle)') {
            idle += us;
            continue;
        }
        const seen = new Set();
        let p = id;
        let inScript = false;
        while (p !== undefined) {
            const pn = byId.get(p);
            if (pn.callFrame.url.includes('user.js')) {
                inScript = true;
                const k = (pn.callFrame.functionName || '(anon)') + ':' + (pn.callFrame.lineNumber + 1);
                if (!seen.has(k)) {
                    seen.add(k);
                    incl.set(k, (incl.get(k) || 0) + us);
                }
            }
            p = parent.get(p);
        }
        if (inScript) script += us;
    }
    const top = [...incl.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, us]) => k + ' ' + Math.round(us / 1000));
    return { busyMs: Math.round((total - idle) / 1000), scriptMs: Math.round(script / 1000), top };
}

async function profiler(page) {
    const cdp = await page.context().newCDPSession(page);
    if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU });
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
    return { start: () => cdp.send('Profiler.start'), stop: async () => (await cdp.send('Profiler.stop')).profile };
}

async function seedIdb(ctx) {
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${PORT}/blank.html`);
    await p.evaluate((raw) => new Promise((ok, fail) => {
        const r = indexedDB.open('pumpingIron', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => {
            const tx = r.result.transaction('kv', 'readwrite');
            tx.objectStore('kv').put(JSON.parse(raw), 'eye');
            tx.oncomplete = () => {
                r.result.close();
                ok();
            };
            tx.onerror = () => fail(tx.error);
        };
        r.onerror = () => fail(r.error);
    }), eyeRaw);
    await p.close();
}

/** Copy the whole IndexedDB database a page left (every store, every key) so the next context starts from it. */
async function dumpIdb(page) {
    return page.evaluate(() => new Promise((ok) => {
        const r = indexedDB.open('pumpingIron');
        r.onerror = () => ok(null);
        r.onsuccess = () => {
            const db = r.result;
            const names = [...db.objectStoreNames];
            const out = { version: db.version, stores: {} };
            if (!names.length) {
                db.close();
                ok(JSON.stringify(out));
                return;
            }
            const tx = db.transaction(names, 'readonly');
            for (const n of names) {
                out.stores[n] = [];
                const cur = tx.objectStore(n).openCursor();
                cur.onsuccess = () => {
                    const c = cur.result;
                    if (!c) return;
                    out.stores[n].push([c.key, c.value]);
                    c.continue();
                };
            }
            tx.oncomplete = () => {
                db.close();
                ok(JSON.stringify(out));
            };
        };
    }));
}

async function restoreIdb(ctx, raw) {
    const p = await ctx.newPage();
    await p.goto(`http://127.0.0.1:${PORT}/blank.html`);
    await p.evaluate((raw) => new Promise((ok, fail) => {
        const d = JSON.parse(raw);
        const r = indexedDB.open('pumpingIron', d.version || 1);
        r.onupgradeneeded = () => {
            for (const n of Object.keys(d.stores)) if (!r.result.objectStoreNames.contains(n)) r.result.createObjectStore(n);
        };
        r.onsuccess = () => {
            const names = Object.keys(d.stores);
            if (!names.length) {
                r.result.close();
                ok();
                return;
            }
            const tx = r.result.transaction(names, 'readwrite');
            for (const n of names) for (const [k, v] of d.stores[n]) tx.objectStore(n).put(v, k);
            tx.oncomplete = () => {
                r.result.close();
                ok();
            };
            tx.onerror = () => fail(tx.error);
        };
        r.onerror = () => fail(r.error);
    }), raw);
    await p.close();
}

/**
 * The store an earlier page leaves: the realistic store, one page loaded on
 * it for 15 s (with a saved plan made first when this build has one).
 */
const warm = {};
async function warmStore(page) {
    if (warm[page]) return warm[page];
    const ctx = await browser.newContext();
    await ctx.route(/torn\.com/, (r) => r.abort());
    await seedIdb(ctx);
    await ctx.addInitScript({ content: 'window.__piSeedRaw = ' + JSON.stringify(JSON.stringify(store.gm)) + ';' });
    const p = await ctx.newPage();
    // Round 6: the webpage is where a plan is made (Create plan), and where the older history and webpage-only data
    // move out of GM; the warm-up opens it like a player who updated, made a plan, then went back to Torn.
    await p.goto(BASE + 'pi=app&' + PAGES[page]);
    await p.waitForTimeout(3000);
    const made = await p.evaluate(async () => (window.__pi && window.__pi.createPlan ? Boolean(await window.__pi.createPlan({ months: 12 })) : null));
    await p.waitForTimeout(12000);
    const gm = await p.evaluate(() => ({ ..._store }));
    const idb = await dumpIdb(p);
    await ctx.close();
    for (const k of ['leader', 'compareBusy', 'lastError']) delete gm[P + k];
    return (warm[page] = { raw: JSON.stringify(gm), idb, made });
}

async function runCase(name) {
    const c = CASES[name];
    const seed = await warmStore(c.page);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route(/torn\.com/, (r) => r.abort());
    if (seed.idb) await restoreIdb(ctx, seed.idb);
    await ctx.addInitScript({ content: 'window.__piSeedRaw = ' + JSON.stringify(seed.raw) + ';' });
    await ctx.addInitScript(longtaskInit);
    const q = (page, extra = '') => BASE + PAGES[page] + '&gm=tm&churn=1' + (c.noscript ? '&noscript=1' : '') + extra;
    // Two hidden Torn pages open first, all three on one thread (window.open), the worst case: their work is on the
    // same thread, so the measured page's profile includes it.
    const B = await ctx.newPage();
    await profiler(B);
    await B.goto(q('plain', '&hidden=1'));
    const [C] = await Promise.all([ctx.waitForEvent('page'), B.evaluate(() => { window.open('about:blank', '_blank'); })]);
    await profiler(C);
    await C.goto(q('profile', '&hidden=1'));
    await B.waitForTimeout(4000);
    const [A] = await Promise.all([ctx.waitForEvent('page'), B.evaluate(() => { window.open('about:blank', '_blank'); })]);
    const errors = [];
    A.on('pageerror', (e) => errors.push(String(e)));
    const pa = await profiler(A);
    await pa.start();
    const t0 = Date.now();
    await A.goto(q(c.page));
    await A.waitForTimeout(Math.max(0, LOAD_S * 1000 - (Date.now() - t0)));
    const load = analyse(await pa.stop());
    await A.waitForTimeout(Math.max(0, STEADY_FROM_S * 1000 - (Date.now() - t0)));
    const setsAt = await A.evaluate(() => ({ sets: window.__tm.sets, chars: window.__tm.setChars, keys: { ...window.__tm.setKeys } }));
    await pa.start();
    await A.waitForTimeout(STEADY_S * 1000);
    const steady = analyse(await pa.stop());
    const info = await A.evaluate(({ LOAD_S, STEADY_FROM_S, STEADY_S, P }) => {
        const L = window.__long || [];
        const inWin = (a, b) => L.filter((x) => x.at >= a * 1000 && x.at < b * 1000);
        const sum = (l) => l.reduce((a, x) => a + x.ms, 0);
        const load = inWin(0, LOAD_S);
        const steady = inWin(STEADY_FROM_S, STEADY_FROM_S + STEADY_S);
        const st = typeof _store !== 'undefined' ? _store : {};
        const sizes = Object.entries(st).map(([k, v]) => [k.replace(P, ''), String(v).length]).sort((a, b) => b[1] - a[1]);
        let lastError = null;
        try {
            lastError = JSON.parse(st[P + 'lastError'] || 'null');
        } catch {}
        return {
            ready: Boolean(window.__pi && window.__pi.model() && window.__pi.model().ready),
            load: { n: load.length, total: sum(load), worst: load.reduce((a, x) => Math.max(a, x.ms), 0) },
            steady: { n: steady.length, total: sum(steady), worst: steady.reduce((a, x) => Math.max(a, x.ms), 0) },
            gmChars: sizes.reduce((a, [, n]) => a + n, 0),
            gmKeys: sizes.length,
            gmTop: sizes.slice(0, 8).map(([k, n]) => k + ' ' + Math.round(n / 1000) + 'K'),
            sets: window.__tm.sets,
            setChars: window.__tm.setChars,
            setKeys: window.__tm.setKeys,
            lastError,
        };
    }, { LOAD_S, STEADY_FROM_S, STEADY_S, P });
    await ctx.close();
    const per10 = (ms) => Math.round((ms * 10) / STEADY_S);
    const row = {
        case: name,
        cpu: CPU,
        at: new Date().toISOString(),
        planMade: seed.made,
        ready: info.ready,
        loadScriptMs: load.scriptMs,
        loadBusyMs: load.busyMs,
        loadLongTasks: info.load.n,
        loadLongMs: info.load.total,
        loadWorstMs: info.load.worst,
        steadyScriptPer10s: per10(steady.scriptMs),
        steadyBusyPer10s: per10(steady.busyMs),
        steadyLongMs: info.steady.total,
        gmKB: Math.round(info.gmChars / 1000),
        gmKeys: info.gmKeys,
        gmWritesPer10s: Math.round(((info.sets - setsAt.sets) * 10 * 10) / STEADY_S) / 10,
        gmWriteKBPer10s: Math.round(((info.setChars - setsAt.chars) * 10) / STEADY_S / 100) / 10,
        gmTop: info.gmTop,
        // Which keys this tab wrote in the steady window.
        gmWrites: Object.entries(info.setKeys || {}).map(([k, n]) => [k.replace(P, ''), n - ((setsAt.keys || {})[k] || 0)]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + ' ' + n),
        loadTop: load.top,
        steadyTop: steady.top,
        errors: errors.concat(info.lastError ? [info.lastError.where + ': ' + info.lastError.message] : []),
    };
    return row;
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ['gym', 'plain', 'profile'];
const rows = [];
for (const name of wanted) {
    if (!CASES[name]) {
        console.log('unknown case ' + name);
        continue;
    }
    const row = await runCase(name);
    rows.push(row);
    if (process.env.PERF_OUT) await appendFile(process.env.PERF_OUT, JSON.stringify(row) + '\n');
    console.log(`\n${name} (${CPU}× CPU, realistic store, Tampermonkey-like, 3 tabs, changing page)${row.planMade === null ? '' : ' · saved plan made: ' + row.planMade}`);
    console.log(`  load:   script ${row.loadScriptMs} ms · busy ${row.loadBusyMs} ms · long tasks ${row.loadLongTasks} / ${row.loadLongMs} ms, worst ${row.loadWorstMs} ms`);
    console.log(`  steady: script ${row.steadyScriptPer10s} ms/10 s · busy ${row.steadyBusyPer10s} ms/10 s · long tasks ${row.steadyLongMs} ms/20 s`);
    console.log(`  GM:     ${row.gmKB} KB in ${row.gmKeys} keys · ${row.gmWritesPer10s} writes/10 s (${row.gmWriteKBPer10s} KB) · biggest ${row.gmTop.slice(0, 5).join(', ')}`);
    console.log(`  writes in 20 s: ${row.gmWrites.join(', ') || 'none'}`);
    console.log(`  load top:   ${row.loadTop.slice(0, 6).join(' · ')}`);
    console.log(`  steady top: ${row.steadyTop.slice(0, 6).join(' · ')}`);
    if (row.errors.length) console.log('  errors: ' + row.errors.join(' | '));
}
await browser.close();
server.close();

let missed = 0;
if (CPU === 4) {
    console.log('\nTargets at 4× CPU:');
    for (const row of rows.filter((r) => r.case !== 'noscript')) {
        for (const [k, limit] of Object.entries(TARGETS)) {
            const v = row[k];
            const ok = v <= limit;
            if (!ok) missed++;
            console.log(`  ${ok ? 'PASS' : 'MISS'} ${row.case} ${k} ${v} (target ≤ ${limit})`);
        }
        if (!row.ready) {
            missed++;
            console.log(`  MISS ${row.case} the page never had a model`);
        }
        if (row.errors.length) {
            missed++;
            console.log(`  MISS ${row.case} errors on the page`);
        }
    }
}
console.log(missed ? `\n${missed} target(s) missed` : '\nALL TARGETS MET');
process.exit(missed && !process.env.REPORT_ONLY ? 1 : 0);
