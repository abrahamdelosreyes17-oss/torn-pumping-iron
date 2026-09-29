/*
 * The built userscript in a real browser against canned data
 * (test/harness-live.html): every webpage tab renders, no text under 11px,
 * no sideways overflow at 1280 px, every control on top (clickable), and a
 * screenshot of each tab. torn.com is blocked: nothing may load from it.
 *
 *   npm run build
 *   PWPATH=<dir>/node_modules/playwright-core SHOTS=<dir> node test/ux-check.mjs
 *
 * Uses the installed Microsoft Edge (PWCHANNEL=msedge) unless told otherwise.
 */
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { readFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PWPATH || 'playwright-core');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.SHOTS || tmpdir();
const only = process.argv.slice(2);

const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    try {
        const body = await readFile(root + path);
        res.writeHead(200, { 'content-type': types[path.slice(path.lastIndexOf('.'))] || 'application/octet-stream' });
        res.end(body);
    } catch {
        res.writeHead(404);
        res.end();
    }
}).listen(8782);

const browser = await chromium.launch({ channel: process.env.PWCHANNEL || 'msedge' });
let failures = 0;
const ok = (cond, msg) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + msg);
    if (!cond) failures++;
};

/** Measures inside the app's shadow root. */
async function measure(page) {
    return page.evaluate(() => {
        const host = document.getElementById('pi-app');
        const sr = host && host.shadowRoot;
        if (!sr) return { missing: true };
        const small = [];
        const covered = [];
        for (const el of sr.querySelectorAll('*')) {
            const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            if (!own || !el.getClientRects().length) continue;
            const size = parseFloat(getComputedStyle(el).fontSize);
            // SVG text is scaled by its viewBox: measure what shows.
            if (el instanceof SVGElement) {
                const r = el.getBoundingClientRect();
                if (r.height && r.height < 9.5) small.push('svg ' + el.tagName + ' ' + r.height.toFixed(1) + 'px "' + el.textContent.trim().slice(0, 16) + '"');
                continue;
            }
            if (size < 11) small.push(el.tagName.toLowerCase() + '.' + el.className + ' ' + size + 'px "' + el.textContent.trim().slice(0, 20) + '"');
        }
        for (const el of sr.querySelectorAll('button, a, input, summary, [role="button"], tr.click')) {
            const r = el.getBoundingClientRect();
            if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) continue;
            const hit = sr.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) covered.push((el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 20));
        }
        const app = sr.querySelector('.app');
        return {
            scrollW: document.documentElement.scrollWidth,
            hostScrollW: host.scrollWidth,
            hostW: host.clientWidth,
            small,
            covered,
            text: (sr.querySelector('.pi-root') || sr).innerText.replace(/\s+/g, ' '),
            appH: app ? app.getBoundingClientRect().height : 0,
        };
    });
}

async function openApp(query) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    let tornHits = 0;
    await page.route(/torn\.com/, (r) => {
        tornHits++;
        r.abort();
    });
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.goto('http://127.0.0.1:8782/test/harness-live.html?pi=app&key=1&at=2026-09-29T10:48:00Z&wait=100000' + (query || ''));
    await page.waitForFunction(() => {
        const sr = document.getElementById('pi-app') && document.getElementById('pi-app').shadowRoot;
        return sr && sr.querySelector('.strip');
    }, null, { timeout: 15000 });
    return { page, errors, tornHits: () => tornHits };
}

async function checkTab(page, tab, errors, want) {
    await page.evaluate((t) => {
        location.hash = t;
    }, tab);
    await page.waitForTimeout(tab === 'buy' ? 1500 : 500);
    const m = await measure(page);
    ok(!m.missing, tab + ': app mounted');
    ok(m.scrollW <= 1280 && m.hostScrollW <= m.hostW, tab + ': no sideways overflow (' + m.scrollW + ', host ' + m.hostScrollW + '/' + m.hostW + ')');
    ok(m.small.length === 0, tab + ': no text under 11px ' + JSON.stringify(m.small.slice(0, 4)));
    ok(m.covered.length === 0, tab + ': every control on top ' + JSON.stringify(m.covered.slice(0, 4)));
    for (const w of want) ok(m.text.toLowerCase().includes(w.toLowerCase()), tab + ': shows "' + w + '"');
    ok(errors.length === 0, tab + ': no page errors ' + JSON.stringify(errors.slice(0, 2)));
    const shot = resolve(shots, 'app-' + tab + '.png');
    await page.screenshot({ path: shot, fullPage: true });
    console.log('     shot ' + shot);
    return m;
}

const TABS = {
    home: ['Today', 'Take Xanax #1, then train', 'Refill · 30 points', 'Buy today', 'Heads-up', 'Pick your build type', "against Baldr's, STR high build"],
    plan: ['Recommended', 'Steady training', 'Other plans', 'Choco jump', 'Build', 'High stat', "Hank's", "You vs Baldr's, STR high", 'Pick one'],
    buy: ['Buy for', 'Xanax', 'Iron_Monk', 'Points market', '7-day prices', 'TornW3B'],
    progress: ['Stats', 'Gyms', 'Force Training', 'This week'],
    eye: ['Targets', 'Colours', 'Sources', 'FFScouter', 'Gear seen'],
    settings: ['Torn API key', 'How this key is used', 'FFScouter', 'data policy', 'TornStats', 'Your data', 'Diagnostics'],
};

const { page, errors, tornHits } = await openApp('');
for (const [tab, want] of Object.entries(TABS)) {
    if (only.length && !only.includes(tab)) continue;
    await checkTab(page, tab, errors, want);
}

// A worse pick warns, and nothing is saved until you choose.
if (!only.length || only.includes('plan')) {
    await page.evaluate(() => (location.hash = 'plan'));
    await page.waitForTimeout(400);
    await page.locator('#pi-app tr.click', { hasText: 'Choco jump' }).click();
    await page.waitForTimeout(300);
    let m = await measure(page);
    ok(m.text.includes("A choco jump isn't worth it for you"), 'plan: picking the choco jump warns');
    ok(m.text.includes('Keep steady'), 'plan: the warning offers to keep steady');
    const stored = await page.evaluate(() => JSON.parse(_store['pumpingIron.v1.plan'] || 'null'));
    ok(!stored || stored.strategy === 'steady', 'plan: nothing saved before a choice');
    await page.locator('#pi-app button', { hasText: 'Keep steady' }).click();
    await page.waitForTimeout(300);
    m = await measure(page);
    ok(!m.text.includes("isn't worth it"), 'plan: keeping steady closes the warning');
    // Build type is yours: pick DEF as the high stat, then Hank's.
    await page.locator('#pi-app .seg[aria-label="High stat"] button', { hasText: 'DEF' }).click();
    await page.waitForTimeout(300);
    let plan = await page.evaluate(() => JSON.parse(_store['pumpingIron.v1.plan']));
    ok(plan.build === 'baldr:def' && plan.buildPicked === true, 'build: DEF as the high stat is saved (' + plan.build + ')');
    await page.locator('#pi-app .brow', { hasText: "Hank's" }).first().click();
    await page.waitForTimeout(300);
    plan = await page.evaluate(() => JSON.parse(_store['pumpingIron.v1.plan']));
    ok(plan.build === 'hank:def', "build: Hank's with DEF high picked (" + plan.build + ')');
    const shown = await measure(page);
    ok(shown.text.includes("You vs Hank's, DEF high"), 'build: the plan names it');
    m = await measure(page);
    ok(m.text.toLowerCase().includes('yours') && m.text.includes('the plan trains toward your build'), 'build: marked as yours');
    // The density switch applies app-wide.
    await page.locator('#pi-app .top button', { hasText: 'Comfortable' }).click();
    await page.waitForTimeout(300);
    const comfy = await page.evaluate(() => document.getElementById('pi-app').shadowRoot.querySelector('.app').classList.contains('comfy'));
    ok(comfy, 'density: Comfortable applies');
    await page.locator('#pi-app .top button', { hasText: 'Compact' }).click();
}

ok(tornHits() === 0, 'nothing loaded from torn.com');

// Torn Eye tab with FFScouter: Refresh lists targets ranked by our estimate.
{
    const o = await openApp('&ffs=1&who=owner');
    await o.page.evaluate(() => (location.hash = 'eye'));
    await o.page.waitForTimeout(500);
    await o.page.locator('#pi-app button', { hasText: 'Refresh' }).click();
    await o.page.waitForTimeout(2500);
    const m = await checkTab(o.page, 'eye', o.errors, ['Targets', 'Stomp', 'Attack', 'ranked by our fight estimate']);
    const rows = await o.page.evaluate(() => document.getElementById('pi-app').shadowRoot.querySelectorAll('.tbl tbody tr').length);
    ok(rows >= 5, 'eye: targets listed (' + rows + ')');
    ok(/Hidden: \d+ Can.t win/.test(m.text), "eye: can't-win targets hidden by default");
    await o.page.close();
}

// No key: the page opens on Settings with the ToS table open.
{
    const p2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await p2.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await p2.goto('http://127.0.0.1:8782/test/harness-live.html?pi=app&wait=100000');
    await p2.waitForTimeout(1500);
    const m = await measure(p2);
    ok(m.text.includes('No key yet') && m.text.includes('Data storage'), 'no key: Settings with the ToS table');
    await p2.screenshot({ path: resolve(shots, 'app-nokey.png'), fullPage: true });
    await p2.close();
}

await browser.close();
server.close();
console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
process.exit(failures ? 1 : 0);
