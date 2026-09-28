/*
 * Measures the mockups (M1) in a real browser: no sideways scroll at 1280 px,
 * no text under 11px, a one-line note on top naming the DESIGN.md section.
 *
 *   PWPATH=<dir>/node_modules/playwright-core node test/mockup-check.mjs [files...]
 *
 * Uses the installed Microsoft Edge (channel msedge) when no Playwright
 * browser is downloaded. Screenshots go to $SHOTS (default: the OS temp dir).
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
const files = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ['L-plan', 'M-buy', 'N-progress', 'O-torn-eye', 'P-settings', 'Q-overlay', 'R-eye-on-torn'].map((f) => 'mockups/' + f + '.html');

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
}).listen(8781);

const browser = await chromium.launch({ channel: process.env.PWCHANNEL || 'msedge' });
let failures = 0;
const ok = (cond, msg) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + msg);
    if (!cond) failures++;
};

for (const f of files) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    // Google Fonts is the only outside request a mockup makes; don't wait on it.
    await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await page.goto('http://127.0.0.1:8781/' + f);
    const m = await page.evaluate(() => {
        const small = [];
        for (const el of document.querySelectorAll('body *')) {
            const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
            if (!own || !el.getClientRects().length) continue;
            const size = parseFloat(getComputedStyle(el).fontSize);
            if (size < 11) small.push(el.tagName.toLowerCase() + '.' + el.className + ' ' + size + 'px "' + el.textContent.trim().slice(0, 24) + '"');
        }
        const note = document.querySelector('.note');
        return {
            scrollW: document.documentElement.scrollWidth,
            clientW: document.documentElement.clientWidth,
            frames: [...document.querySelectorAll('.frame')].map((fr) => fr.scrollWidth - fr.clientWidth),
            small,
            note: note ? note.textContent : '',
            height: document.documentElement.scrollHeight,
        };
    });
    ok(m.scrollW <= m.clientW && m.frames.every((d) => d <= 0), f + ': no sideways scroll (page ' + m.scrollW + '/' + m.clientW + ', frames ' + JSON.stringify(m.frames) + ')');
    ok(m.small.length === 0, f + ': no text under 11px ' + JSON.stringify(m.small.slice(0, 4)));
    ok(/DESIGN\.md §\d/.test(m.note), f + ': note names its DESIGN.md section');
    ok(errors.length === 0, f + ': no script errors ' + JSON.stringify(errors));
    const shot = resolve(shots, f.replace(/[\\/]/g, '_') + '.png');
    await page.screenshot({ path: shot, fullPage: true });
    console.log('     shot ' + shot + ' (' + m.height + ' px tall)');
    await page.close();
}

await browser.close();
server.close();
process.exit(failures ? 1 : 0);
