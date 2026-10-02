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
 * Cases: gym, plain, profile, plan, startup (default: these five), friend, noscript (Torn's page alone).
 * startup (round 7): opening the webpage on what an earlier visit left, then a click on its Torn Eye tab, at 1× and 4×.
 * plan (round 7): Create plan and Re-plan for 12 months on the webpage, at 1× and at 4× whatever CPU says.
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

/**
 * Round 7 (R7.3b): making a 12-month plan on the webpage. The time is until the plan shows; a freeze is the longest
 * task up to the end of the what-ifs that follow it; the memory is what is alive (cleaned up before each reading).
 * A tab left in the background needs a real window, so that one is docs/sims/round7/plan-hidden.mjs (within 1.5×).
 */
export const PLAN_TARGETS = {
    1: { wallMs: 2000, worstMs: 50 },
    4: { wallMs: 8000, worstMs: 200 },
    liveMB: 30,
};

/**
 * Round 7: opening the webpage (a returning player: the realistic store, a saved 12-month plan, 300 stored targets)
 * and its Torn Eye tab. Measured before the fix (docs/sims/round7/startup.mjs): usable in 0.16–0.21 s (0.58–0.65 s at
 * 4×) in 1.3.0 and round 7 alike; the Torn Eye click froze the page 0.37–0.43 s (1.9 s at 4×) while every stored
 * target's fight was simulated inside the draw. After: 0.05 s (0.27 s at 4×).
 *   usableMs: open → the first page with your numbers · planMs: → the whole saved plan read
 *   eyeRowsMs: the click on Torn Eye → its rows · eyeWorstMs: the longest freeze in the 3 s after the click
 */
export const STARTUP_TARGETS = {
    1: { usableMs: 500, planMs: 700, eyeRowsMs: 150, eyeWorstMs: 150 },
    4: { usableMs: 1200, planMs: 1800, eyeRowsMs: 500, eyeWorstMs: 400 },
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
const browser = await chromium.launch({ channel: process.env.PWCHANNEL || 'msedge', args: ['--enable-precise-memory-info'] });

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
    await p.waitForTimeout(6000);
    // ...then a Torn page for 12 s (its reads: the watch list, the feed), as 1.2.3's warm-up did.
    const appGm = await p.evaluate(() => JSON.stringify(_store));
    await p.addInitScript({ content: 'window.__piSeedRaw = ' + JSON.stringify(appGm) + ';' });
    await p.goto(BASE + PAGES[page]);
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
            calls: Object.entries((window.__calls || []).reduce((a, c) => ((a[c.replace(/\/\d{4,}/g, '/N')] = (a[c.replace(/\/\d{4,}/g, '/N')] || 0) + 1), a), {})).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => k + ' ' + n),
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
        calls: info.calls,
        // Which keys this tab wrote in the steady window.
        gmWrites: Object.entries(info.setKeys || {}).map(([k, n]) => [k.replace(P, ''), n - ((setsAt.keys || {})[k] || 0)]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => k + ' ' + n),
        loadTop: load.top,
        steadyTop: steady.top,
        errors: errors.concat(info.lastError ? [info.lastError.where + ': ' + info.lastError.message] : []),
    };
    return row;
}

/** The webpage's Plan tab on the realistic store (the owner), its first read in. */
async function planPage() {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.route(/torn\.com/, (r) => r.abort());
    await ctx.addInitScript({ content: 'window.__piSeedRaw = ' + JSON.stringify(JSON.stringify(store.gm)) + ';' });
    await ctx.addInitScript(longtaskInit);
    const p = await ctx.newPage();
    const errors = [];
    p.on('pageerror', (e) => errors.push(String(e)));
    await p.goto(BASE + 'pi=app&' + PAGES.plain + '#plan');
    await p.waitForFunction(() => window.__pi && window.__pi.model() && window.__pi.model().ready, null, { timeout: 30000 });
    await p.waitForTimeout(2500);
    return { ctx, p, errors, cdp: await ctx.newCDPSession(p) };
}

/** One Create plan or Re-plan: until the plan shows, until the what-ifs are in, and the freezes over the whole of it. */
function timePlan(p, fn, arg) {
    return p.evaluate(
        async ({ fn, arg }) => {
            const t0 = performance.now();
            let shown = null;
            let error = null;
            try {
                const out = await window.__pi[fn](arg);
                shown = performance.now();
                if (!out) error = 'no plan came back';
                await window.__pi.extras();
            } catch (e) {
                error = String((e && e.message) || e);
            }
            const end = performance.now();
            // The observer reports a long task just after it ends.
            await new Promise((r) => setTimeout(r, 300));
            const L = (window.__long || []).filter((x) => x.at + x.ms >= t0 && x.at <= end);
            return { wallMs: Math.round((shown || end) - t0), allMs: Math.round(end - t0), worstMs: L.reduce((a, x) => Math.max(a, x.ms), 0), frozenMs: L.reduce((a, x) => a + x.ms, 0), freezes: L.length, error };
        },
        { fn, arg },
    );
}

async function runPlan() {
    const runs = [];
    for (const cpu of [1, 4]) {
        const { ctx, p, errors, cdp } = await planPage();
        if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
        const create = await timePlan(p, 'createPlan', { months: 12 });
        await p.waitForTimeout(2500);
        const replan = await timePlan(p, 'recalibratePlan', {});
        await ctx.close();
        runs.push({ cpu, create, replan, errors: errors.concat([create.error, replan.error].filter(Boolean)) });
    }
    // Memory on its own page, at 1×: cleaning up before each reading slows the run, so it isn't timed.
    const { ctx, p, cdp } = await planPage();
    await cdp.send('HeapProfiler.enable');
    const live = async () => {
        await cdp.send('HeapProfiler.collectGarbage');
        return p.evaluate(() => performance.memory.usedJSHeapSize / 1048576);
    };
    const idle = await live();
    let peak = idle;
    for (const [fn, arg] of [['createPlan', { months: 12 }], ['recalibratePlan', {}]]) {
        await p.evaluate(({ fn, arg }) => {
            window.__done = false;
            window.__pi[fn](arg).then(() => window.__pi.extras()).then(() => (window.__done = true), () => (window.__done = true));
        }, { fn, arg });
        while (!(await p.evaluate(() => window.__done))) {
            peak = Math.max(peak, await live());
            await p.waitForTimeout(150);
        }
    }
    await ctx.close();
    const mb = (x) => Math.round(x * 10) / 10;
    return { case: 'plan', at: new Date().toISOString(), runs, idleMB: mb(idle), liveMB: mb(peak) };
}

/** In the page before anything else (the startup case): when the page first showed what, in ms since it opened. */
function startupInit() {
    const T = (window.__st = { marks: {}, long: [] });
    const mark = (k) => {
        if (T.marks[k] === undefined) T.marks[k] = Math.round(performance.now());
    };
    try {
        new PerformanceObserver((l) => {
            for (const e of l.getEntries()) T.long.push({ at: Math.round(e.startTime), ms: Math.round(e.duration) });
        }).observe({ type: 'longtask', buffered: true });
    } catch {}
    const frame = () => {
        const host = document.getElementById('pi-app');
        const r = host && host.shadowRoot ? host.shadowRoot.querySelector('.pi-root') : null;
        if (r) {
            const main = r.querySelector('.body .main');
            if (main && main.childNodes.length && !r.querySelector('.empty')) mark('usable');
            const m = window.__pi && window.__pi.model && window.__pi.model();
            if (m && m.ready && m.saved && m.saved.whole) mark('plan');
            if (T.eyeAt && r.querySelectorAll('table.tbl tbody tr').length > 3) mark('eyeRows');
        }
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
}

async function runStartup() {
    // What an earlier visit left: the realistic store, a 12-month plan made on the webpage.
    const seedScript = (gmRaw) => ({ content: 'window.__ffsEst = ' + JSON.stringify(store.ffsEst) + ';window.__piSeedRaw = ' + JSON.stringify(gmRaw) + ';' });
    const wctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await wctx.route(/torn\.com|googleapis|gstatic/, (r) => r.abort());
    await seedIdb(wctx);
    await wctx.addInitScript(seedScript(JSON.stringify(store.gm)));
    const w = await wctx.newPage();
    await w.goto(BASE + 'pi=app&' + PAGES.plain + '&gm=tm');
    await w.waitForFunction(() => window.__pi && window.__pi.model() && window.__pi.model().ready, null, { timeout: 30000 });
    await w.waitForTimeout(2000);
    await w.evaluate(async () => {
        await window.__pi.createPlan({ months: 12 });
        if (window.__pi.extras) await window.__pi.extras();
    });
    await w.waitForTimeout(4000);
    const gm = await w.evaluate(() => ({ ..._store }));
    const idb = await dumpIdb(w);
    await wctx.close();
    for (const k of ['leader', 'compareBusy', 'lastError', 'lastBoot']) delete gm[P + k];
    const runs = [];
    for (const cpu of [1, 4]) {
        const tries = [];
        for (let i = 0; i < 3; i++) {
            const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
            await ctx.route(/torn\.com|googleapis|gstatic/, (r) => r.abort());
            await restoreIdb(ctx, idb);
            await ctx.addInitScript(seedScript(JSON.stringify(gm)));
            await ctx.addInitScript(startupInit);
            const p = await ctx.newPage();
            const errors = [];
            p.on('pageerror', (e) => errors.push(String(e)));
            const cdp = await ctx.newCDPSession(p);
            if (cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
            // Four hours after the visit before (the stored state is old: the page shows it, then reads).
            await p.goto(BASE.replace('10:48:00Z', '14:48:00Z') + 'pi=app&' + PAGES.plain + '&gm=tm');
            await p.waitForTimeout(6000);
            await p.evaluate(() => {
                const T = window.__st;
                const tab = [...document.getElementById('pi-app').shadowRoot.querySelectorAll('a.tab')].find((a) => a.textContent.includes('Torn Eye'));
                T.eyeAt = performance.now();
                tab.click();
            });
            await p.waitForTimeout(3300);
            const r = await p.evaluate(() => {
                const T = window.__st;
                const after = T.long.filter((x) => x.at + x.ms >= T.eyeAt && x.at < T.eyeAt + 3000);
                return { usableMs: T.marks.usable ?? null, planMs: T.marks.plan ?? null, eyeRowsMs: T.marks.eyeRows === undefined ? null : Math.round(T.marks.eyeRows - T.eyeAt), eyeWorstMs: after.reduce((a, x) => Math.max(a, x.ms), 0), rows: document.getElementById('pi-app').shadowRoot.querySelectorAll('table.tbl tbody tr').length };
            });
            await ctx.close();
            tries.push({ ...r, errors });
        }
        const med = (k) => (tries.some((t) => t[k] === null) ? null : median(tries.map((t) => t[k])));
        runs.push({ cpu, usableMs: med('usableMs'), planMs: med('planMs'), eyeRowsMs: med('eyeRowsMs'), eyeWorstMs: med('eyeWorstMs'), rows: tries[0].rows, errors: tries.flatMap((t) => t.errors) });
    }
    return { case: 'startup', at: new Date().toISOString(), runs };
}

const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ['gym', 'plain', 'profile', 'plan', 'startup'];
// RUNS=3: each case three times, the median of each number (one run varies by ±80 ms at 4×).
const RUNS = Math.max(1, Number(process.env.RUNS || 1));
const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
async function runMedian(name) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) runs.push(await runCase(name));
    if (RUNS === 1) return runs[0];
    const out = { ...runs[0], runs: RUNS };
    for (const k of ['loadScriptMs', 'loadBusyMs', 'loadLongTasks', 'loadLongMs', 'loadWorstMs', 'steadyScriptPer10s', 'steadyBusyPer10s', 'steadyLongMs', 'gmKB', 'gmKeys', 'gmWritesPer10s', 'gmWriteKBPer10s']) out[k] = median(runs.map((r) => r[k]));
    out.errors = runs.flatMap((r) => r.errors);
    out.ready = runs.every((r) => r.ready);
    return out;
}
const rows = [];
let planRow = null;
let startupRow = null;
for (const name of wanted) {
    if (name === 'startup') {
        startupRow = await runStartup();
        if (process.env.PERF_OUT) await appendFile(process.env.PERF_OUT, JSON.stringify(startupRow) + '\n');
        console.log('\nstartup (the webpage, realistic store, a saved 12-month plan, 300 stored targets; median of 3)');
        for (const r of startupRow.runs) console.log(`  ${r.cpu}× usable ${r.usableMs} ms · whole plan ${r.planMs} ms · Torn Eye click → rows ${r.eyeRowsMs} ms (${r.rows} rows), longest freeze after it ${r.eyeWorstMs} ms`);
        continue;
    }
    if (name === 'plan') {
        planRow = await runPlan();
        if (process.env.PERF_OUT) await appendFile(process.env.PERF_OUT, JSON.stringify(planRow) + '\n');
        console.log('\nplan (12 months, the webpage, realistic store)');
        const line = (r) => `${r.wallMs} ms until the plan shows · ${r.allMs} ms with the what-ifs · frozen ${r.frozenMs} ms in ${r.freezes}, longest ${r.worstMs} ms${r.error ? ' · ERROR ' + r.error : ''}`;
        for (const r of planRow.runs) {
            console.log(`  ${r.cpu}× Create plan: ${line(r.create)}`);
            console.log(`  ${r.cpu}× Re-plan:     ${line(r.replan)}`);
        }
        console.log(`  memory alive: idle ${planRow.idleMB} MB · peak ${planRow.liveMB} MB`);
        continue;
    }
    if (!CASES[name]) {
        console.log('unknown case ' + name);
        continue;
    }
    const row = await runMedian(name);
    rows.push(row);
    if (process.env.PERF_OUT) await appendFile(process.env.PERF_OUT, JSON.stringify(row) + '\n');
    console.log(`\n${name} (${CPU}× CPU, realistic store, Tampermonkey-like, 3 tabs, changing page)${row.planMade === null ? '' : ' · saved plan made: ' + row.planMade}`);
    console.log(`  load:   script ${row.loadScriptMs} ms · busy ${row.loadBusyMs} ms · long tasks ${row.loadLongTasks} / ${row.loadLongMs} ms, worst ${row.loadWorstMs} ms`);
    console.log(`  steady: script ${row.steadyScriptPer10s} ms/10 s · busy ${row.steadyBusyPer10s} ms/10 s · long tasks ${row.steadyLongMs} ms/20 s`);
    console.log(`  GM:     ${row.gmKB} KB in ${row.gmKeys} keys · ${row.gmWritesPer10s} writes/10 s (${row.gmWriteKBPer10s} KB) · biggest ${row.gmTop.slice(0, 5).join(', ')}`);
    console.log(`  writes in 20 s: ${row.gmWrites.join(', ') || 'none'}`);
    console.log(`  requests (whole run): ${row.calls.join(', ') || 'none'}`);
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
if (planRow) {
    console.log('\nTargets for the plan (12 months):');
    const check = (ok, words) => {
        if (!ok) missed++;
        console.log(`  ${ok ? 'PASS' : 'MISS'} plan ${words}`);
    };
    for (const r of planRow.runs) {
        const t = PLAN_TARGETS[r.cpu];
        for (const [label, x] of [['Create plan', r.create], ['Re-plan', r.replan]]) {
            check(x.wallMs <= t.wallMs, `${r.cpu}× ${label} ${x.wallMs} ms (target ≤ ${t.wallMs})`);
            check(x.worstMs <= t.worstMs, `${r.cpu}× ${label} longest freeze ${x.worstMs} ms (target ≤ ${t.worstMs})`);
        }
        if (r.errors.length) check(false, `${r.cpu}× errors: ${r.errors.join(' | ')}`);
    }
    check(planRow.liveMB <= PLAN_TARGETS.liveMB, `memory alive ${planRow.liveMB} MB (target ≤ ${PLAN_TARGETS.liveMB})`);
}
if (startupRow) {
    console.log('\nTargets for startup (the webpage and its Torn Eye tab):');
    for (const r of startupRow.runs) {
        for (const [k, limit] of Object.entries(STARTUP_TARGETS[r.cpu])) {
            const ok = r[k] !== null && r[k] <= limit;
            if (!ok) missed++;
            console.log(`  ${ok ? 'PASS' : 'MISS'} startup ${r.cpu}× ${k} ${r[k]} (target ≤ ${limit})`);
        }
        if (r.errors.length) {
            missed++;
            console.log(`  MISS startup ${r.cpu}× errors: ${[...new Set(r.errors)].join(' | ')}`);
        }
    }
}
console.log(missed ? `\n${missed} target(s) missed` : '\nALL TARGETS MET');
process.exit(missed && !process.env.REPORT_ONLY ? 1 : 0);
