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
import { readZip } from '../src/core/zip.js';

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
    // &noplan=1: start with no saved plan (Create plan is clicked by the check itself).
    const base = 'http://127.0.0.1:8782/test/harness-live.html?pi=app&key=1&at=2026-09-29T10:48:00Z&wait=100000' + (/noplan=1/.test(query || '') ? '' : '&plan=1&follow=steady');
    await page.goto(base + (query || ''));
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
    home: ['Auto mode needs a Full key · Add it in Settings', 'Today', 'Take Xanax #1, then train', 'Refill · 30 points', 'Buy today', 'Heads-up', 'Pick your build type', "You vs Baldr's, STR high", 'Next 7 days', 'This week'],
    plan: ['Auto (from your income)', 'Auto mode needs a Full key', 'month plan ·', 'Re-plan', 'New plan…', 'Recommended', 'Steady training', 'Per $1M', 'Other plans', 'Why it isn’t the pick', 'Where your energy comes from', 'Natural energy', 'Build', 'High stat', "Hank's", 'pick yours', 'Ignorance Is Bliss', 'what-if'],
    buy: ['Buy for', 'Your list', 'Xanax', 'Iron_Monk', 'Points market', 'Deals', '7-day prices', 'You hold', 'TornW3B'],
    progress: ['Total stats against the plan', 'Each stat', 'Gained against plan', 'Receipts', 'Energy trained', '$ per 1,000 stats', 'What if you’d done another plan', 'the comparison appears after two days', 'Last trains', 'This week', 'Budget', 'Force Training'],
    eye: ['Targets', 'War', 'Watched', 'Ready now', 'Order: respect › HP kept › win', 'How sure', 'FFScouter', 'Gear seen', 'Your side'],
    settings: ['Torn API key', 'How this key is used', 'Full key (Auto mode)', 'Keep for war days', 'Discord pings', 'Log in with Discord', 'FFScouter', 'data policy', 'TornStats', 'On Torn’s pages', 'Report a problem', 'Download report (.zip)', 'Developer', 'Export as .zip', 'Your data', 'Diagnostics', 'of 85'],
};

const { page, errors, tornHits } = await openApp('');
for (const [tab, want] of Object.entries(TABS)) {
    if (only.length && !only.includes(tab)) continue;
    await checkTab(page, tab, errors, want);
}

// Round 6: the Plan page's buttons, really clicked. No plan → Create plan (3 months) → Recalibrate → New plan 12 months
// through the replace confirm. Nothing is worked out until a click.
{
    const o = await openApp('&noplan=1&who=owner&build=hank');
    const sr = () => "document.getElementById('pi-app').shadowRoot";
    const text = () => o.page.evaluate(`${sr()}.textContent`);
    const click = (label) => o.page.evaluate((l) => {
        const b = [...document.getElementById('pi-app').shadowRoot.querySelectorAll('button')].find((x) => x.textContent.trim() === l && !x.disabled);
        if (!b) return false;
        b.click();
        return true;
    }, label);
    const waitText = async (re, ms = 30000) => {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) {
            if (re.test(await text())) return true;
            await o.page.waitForTimeout(250);
        }
        return false;
    };
    await o.page.evaluate(() => (location.hash = 'home'));
    ok(await waitText(/Create your plan/), 'buttons: Home asks for a plan when there is none');
    await o.page.evaluate(() => (location.hash = 'plan'));
    ok(await waitText(/No plan yet/), 'buttons: Plan says "No plan yet" with the lengths and Create plan');
    const stored0 = await o.page.evaluate(() => _store['pumpingIron.v1.planNow'] || null);
    ok(stored0 === null, 'buttons: nothing worked out before a click');
    ok(await click('3 months'), 'buttons: pick 3 months');
    // Round 7 (R7.3b): the click shows the run at once, its bar and Cancel (null: no such button to click).
    const clickRun = (label) => o.page.evaluate(async (l) => {
        const root = document.getElementById('pi-app').shadowRoot;
        const b = [...root.querySelectorAll('button')].find((x) => x.textContent.trim() === l && !x.disabled);
        if (!b) return null;
        b.click();
        await new Promise((r) => setTimeout(r, 60));
        return Boolean(root.querySelector('[data-plan-bar]')) && [...root.querySelectorAll('button')].some((x) => x.textContent.trim() === 'Cancel');
    }, label);
    const run1 = await clickRun('Create plan');
    ok(run1 !== null, 'buttons: Create plan clicked');
    ok(run1 === true, 'buttons: the run shows its bar and Cancel');
    ok(await waitText(/3-month plan · /), 'buttons: the 3-month plan is made and shown');
    ok(await waitText(/you are here/), 'buttons: its months, with "you are here"');
    const pn = await o.page.evaluate(() => JSON.parse(_store['pumpingIron.v1.planNow'] || 'null'));
    ok(pn && pn.months === 3 && pn.days >= 89 && pn.days <= 92, 'buttons: saved for 3 months (' + (pn && pn.days) + ' days)');
    const shotA = resolve(shots, 'app-plan-card.png');
    await o.page.screenshot({ path: shotA, fullPage: true });
    console.log('     shot ' + shotA);
    const run2 = await clickRun('Re-plan');
    ok(run2 !== null, 'buttons: Re-plan clicked');
    ok(run2 === true, 'buttons: the re-plan shows its bar and Cancel');
    ok(await waitText(/re-planned /), 'buttons: re-planned (same end)');
    const pn2 = await o.page.evaluate(() => JSON.parse(_store['pumpingIron.v1.planNow'] || 'null'));
    ok(pn2 && pn2.end === pn.end && pn2.rev !== pn.rev && pn2.recalibratedAt, 'buttons: the end date stays, the plan is re-worked');
    ok(await click('New plan…'), 'buttons: New plan… opens the lengths');
    ok(await click('12 months'), 'buttons: pick 12 months');
    ok(await click('Create plan'), 'buttons: Create plan (replacing) asks first');
    ok(await waitText(/Replace your 3-month plan\?/, 3000), 'buttons: "Replace your 3-month plan?"');
    ok(await click('Replace it'), 'buttons: Replace it');
    ok(await waitText(/12-month plan · /), 'buttons: the 12-month plan replaces it');
    const pn3 = await o.page.evaluate(() => JSON.parse(_store['pumpingIron.v1.planNow'] || 'null'));
    ok(pn3 && pn3.months === 12 && pn3.days >= 365, 'buttons: saved for a year');
    ok(o.errors.length === 0, 'buttons: no page errors ' + JSON.stringify(o.errors.slice(0, 2)));
    await o.page.close();
}

// A worse pick warns, and nothing is saved until you choose.
if (!only.length || only.includes('plan')) {
    await page.evaluate(() => (location.hash = 'plan'));
    await page.waitForTimeout(400);
    await page.locator('#pi-app tr.click', { hasText: 'Choco jump' }).click();
    await page.waitForTimeout(300);
    let m = await measure(page);
    ok(m.text.includes("A choco jump isn't worth it for you"), 'plan: picking the choco jump warns');
    // The warning offers to keep the recommended plan (whichever it is: the refill check can change it).
    const keep = page.locator('#pi-app .warnb button', { hasText: /^Keep / });
    ok((await keep.count()) === 1, 'plan: the warning offers to keep the recommended plan (' + (await keep.count() ? await keep.first().textContent() : 'none') + ')');
    const stored = await page.evaluate(() => JSON.parse(_store['pumpingIron.v1.plan'] || 'null'));
    ok(!stored || stored.strategy !== 'chocoJump', 'plan: nothing saved before a choice');
    await keep.first().click();
    await page.waitForTimeout(300);
    m = await measure(page);
    ok(!m.text.includes("isn't worth it"), 'plan: keeping the recommended plan closes the warning');
    // Build type is yours: pick DEF as the high stat, then Hank's.
    await page.locator('#pi-app .seg[aria-label="High stat"] button', { hasText: 'DEF' }).click();
    await page.waitForTimeout(300);
    let plan = await page.evaluate(() => JSON.parse(_store['pumpingIron.v1.plan']));
    ok(plan.build === 'baldr:def' && plan.buildPicked === true, 'build: DEF as the high stat is saved (' + plan.build + ')');
    await page.locator('#pi-app .bl .r', { hasText: "Hank's" }).first().click();
    await page.waitForTimeout(300);
    plan = await page.evaluate(() => JSON.parse(_store['pumpingIron.v1.plan']));
    ok(plan.build === 'hank:def', "build: Hank's with DEF high picked (" + plan.build + ')');
    m = await measure(page);
    ok(m.text.includes("Hank's ✓") && m.text.includes('what the plan trains toward'), 'build: marked as yours');
    // The Plan dropdown: Max gains, no budget (saved, and the recommendation follows).
    await page.locator('#pi-app details.plansel summary').click();
    await page.waitForTimeout(200);
    await page.locator('#pi-app .plansel .opt', { hasText: 'Max gains, no budget' }).click();
    await page.waitForTimeout(400);
    plan = await page.evaluate(() => JSON.parse(_store['pumpingIron.v1.plan']));
    m = await measure(page);
    ok(plan.pickBy === 'max' && m.text.includes('Max gains, no budget') && m.text.includes('Steady + FHC, max'), 'plan: Max gains picks Steady + FHC (' + plan.pickBy + ')');
    ok(m.covered.length === 0, 'plan: nothing covered with the dropdown closed ' + JSON.stringify(m.covered.slice(0, 3)));
    await page.locator('#pi-app details.plansel summary').click();
    await page.waitForTimeout(200);
    await page.locator('#pi-app .plansel .opt', { hasText: 'Most stats in my budget' }).click();
    await page.waitForTimeout(300);
    // Buy's type ticks filter the list.
    await page.evaluate(() => (location.hash = 'buy'));
    await page.waitForTimeout(600);
    await page.locator('#pi-app .tk', { hasText: 'Points' }).click();
    await page.waitForTimeout(400);
    m = await measure(page);
    const settings1 = await page.evaluate(() => JSON.parse(_store['pumpingIron.v1.settings'] || '{}'));
    ok(Array.isArray(settings1.buyTypes) && !settings1.buyTypes.includes('points') && !/Points × \d/.test(m.text), 'buy: the Points tick hides points');
    await page.locator('#pi-app .tk', { hasText: 'Points' }).click();
    await page.waitForTimeout(300);
    // Developer: a wrong key is refused; the export is there for everyone.
    await page.evaluate(() => (location.hash = 'settings'));
    await page.waitForTimeout(500);
    await page.locator('#pi-app input[aria-label="Developer key"]').fill('not-the-key');
    await page.locator('#pi-app button', { hasText: 'Unlock' }).click();
    await page.waitForTimeout(400);
    m = await measure(page);
    ok(m.text.includes('That isn’t the developer key') && !m.text.includes('What it learned'), 'developer: a wrong key is refused');
    // Round 7 (R7.0b): Report a problem: the form, what goes in the zip shown first, the log on a click, one .zip downloaded.
    ok(/report a problem/i.test(m.text) && /what goes in the zip/i.test(m.text) && m.text.includes('The problem log:'), 'report: the section says what the zip will hold');
    await page.locator('#pi-app textarea[aria-label="What happened"]').fill('The bar stopped at month 5.');
    await page.locator('#pi-app button', { hasText: 'Show the log' }).click();
    await page.waitForTimeout(300);
    m = await measure(page);
    ok(/did\s+\[app plan\] Create plan pressed|Create plan \d+ months? \(\d+ days\) took/.test(m.text), 'report: the log shows the plan runs and clicks (' + (m.text.match(/note\s+\[app[^\]]*\][^·]{0,60}/) || [''])[0] + ')');
    const still = await page.evaluate(() => document.getElementById('pi-app').shadowRoot.querySelector('textarea[aria-label="What happened"]').value);
    ok(still === 'The bar stopped at month 5.', 'report: what you typed survives a redraw');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#pi-app button', { hasText: 'Download report (.zip)' }).click()]);
    const zipPath = await dl.path();
    const zip = readZip(new Uint8Array(await readFile(zipPath))).files;
    ok(/^pumping-iron-report-\d{8}-\d{4}\.zip$/.test(dl.suggestedFilename()), 'report: the file is named ' + dl.suggestedFilename());
    ok(['report.txt', 'problem-log.txt', 'player.json', 'plan.json', 'state.json', 'stats-history.json', 'money-log-fields.json', 'learning/gym-log.json'].every((n) => n in zip), 'report: the zip holds its files (' + Object.keys(zip).length + ')');
    ok(zip['report.txt'].includes('The bar stopped at month 5.') && /stats STR [\d,]+/.test(zip['report.txt']), 'report: your words and your stats are in report.txt');
    const keys = await page.evaluate(() => Object.entries(_store).filter(([k]) => /Key$/.test(k)).map(([, v]) => String(JSON.parse(v))).filter((v) => v && v.length >= 8));
    const all = Object.values(zip).join(' ');
    ok(keys.length > 0 && keys.every((k) => !all.includes(k)), 'report: no API key in any file (' + keys.length + ' keys checked)');
    const player = JSON.parse(zip['player.json']);
    ok(player && player.stats && player.stats.str > 0 && player.happyMax > 0 && Array.isArray(player.perks.lines), 'report: player.json has the stat split, happy maximum and perks');
    await page.waitForTimeout(300);
    m = await measure(page);
    const cleared = await page.evaluate(() => document.getElementById('pi-app').shadowRoot.querySelector('textarea[aria-label="What happened"]').value);
    ok(m.text.includes('Saved pumping-iron-report-') && cleared === '', 'report: saved, and the form is clean for the next one');
    // One layout (the owner: "i dont need 2 layouts, just one, compact is fine"): no density switch anywhere.
    const switches = await page.evaluate(() => /Comfortable/.test(document.getElementById('pi-app').shadowRoot.textContent));
    ok(!switches, 'one layout: no Compact/Comfortable switch');
}

ok(tornHits() === 0, 'nothing loaded from torn.com');

// Torn Eye tab with FFScouter: targets load by themselves, judged by our fight model; only players you beat are kept.
{
    const o = await openApp('&ffs=1&who=owner');
    await o.page.evaluate(() => (location.hash = 'eye'));
    await o.page.waitForTimeout(500);
    await o.page.waitForTimeout(2500);
    const m = await checkTab(o.page, 'eye', o.errors, ['Targets', 'Stomp', 'Attack', 'win and HP kept from your stats']);
    const rows = await o.page.evaluate(() => document.getElementById('pi-app').shadowRoot.querySelectorAll('.tbl tbody tr').length);
    ok(rows >= 5, 'eye: targets load by themselves the first time (' + rows + ')');
    ok(/\d+ players? left out \(you’d keep under 50% HP\)/.test(m.text), 'eye: targets under 50% HP kept dropped before they’re stored');
    ok(!/Hide can.t win|Most respect|Refresh|Stomp only|Keep over 50% HP/.test(m.text), 'eye: no Sort, Level, Refresh or Show ticks on Targets (round 7)');
    ok(rows <= 20, 'eye: 20 rows a page at most, only those drawn (' + rows + ')');
    const bands = await o.page.evaluate(() => [...document.getElementById('pi-app').shadowRoot.querySelectorAll('.tbl tbody tr.click')].map((tr) => tr.cells[0].textContent.trim()));
    ok(bands.every((b) => b === 'Stomp' || b === 'Good' || b === 'Fair'), 'eye: every target is Stomp, Good or Fair (' + bands.join(',') + ')');
    const order = await o.page.evaluate(() => [...document.getElementById('pi-app').shadowRoot.querySelectorAll('.tbl tbody tr.click')].map((tr) => Number(tr.cells[3].textContent)));
    ok(order.every((r, i) => i === 0 || r <= order[i - 1]), 'eye: most respect first (' + order.slice(0, 5).join(',') + ')');
    ok(/Statuses: \d+ of \d+ checked · this page first|Statuses: all \d+ checked/.test(m.text), 'eye: the statuses progress line');
    // A row opens its details (both fair fights, the estimate's age and source), and closes again.
    await o.page.locator('#pi-app .tbl tbody tr.click').first().click();
    await o.page.waitForTimeout(300);
    const det = await measure(o.page);
    ok(/as strong as you \(our estimate\) · .*by FFScouter’s list/.test(det.text) && !/fair fight/i.test(det.text), 'eye: row details in plain words (how strong, ours and FFScouter’s)');
    await o.page.locator('#pi-app .tbl tbody tr.click').first().click();
    await o.page.waitForTimeout(300);
    // ☆ on the first row: it shows on Watched (checked below).
    await o.page.locator('#pi-app .tbl tbody button[data-act="star"]').first().click();
    await o.page.waitForTimeout(300);
    // Round 7: no Chain view; the Stomp chip shows only Stomp, in the same order.
    ok((await o.page.locator('#pi-app .modes button', { hasText: 'Chain' }).count()) === 0, 'eye: Chain is gone (it was the same list as Targets)');
    await o.page.locator('#pi-app .eye-chip', { hasText: 'Stomp' }).click();
    await o.page.waitForTimeout(400);
    const stomp = await o.page.evaluate(() => [...document.getElementById('pi-app').shadowRoot.querySelectorAll('.tbl tbody tr.click')].map((tr) => ({ band: tr.cells[0].textContent.trim(), resp: Number(tr.cells[3].textContent) })));
    ok(stomp.every((r) => r.band === 'Stomp'), 'eye: the Stomp chip (' + stomp.map((r) => r.band).join(',') + ')');
    ok(stomp.every((r, i) => i === 0 || r.resp <= stomp[i - 1].resp), 'eye: most respect first inside a band');
    await o.page.locator('#pi-app .eye-chip', { hasText: 'All' }).click();
    await o.page.waitForTimeout(300);
    // War: watch a faction; everyone listed, attackable first.
    await o.page.locator('#pi-app .modes button', { hasText: 'War' }).click();
    await o.page.waitForTimeout(300);
    await o.page.locator('#pi-app input[placeholder="faction id"]').fill('7777');
    await o.page.locator('#pi-app button[data-act="war-watch"]').click();
    await o.page.waitForTimeout(3000);
    const war = await measure(o.page);
    ok(/attack now/.test(war.text) && /Next out of hospital/.test(war.text), 'eye war: members listed with who to hit now');
    ok(/→ Mexico|← from|In /.test(war.text), 'eye war: travellers shown with where they fly');
    ok(/Hospital · out \d\d:\d\d TCT \(\d+:\d\d\)/.test(war.text), 'eye war: hospital out-time in Torn time with a countdown');
    await o.page.screenshot({ path: resolve(shots, 'app-eye-war.png'), fullPage: true });
    // Typing survives the 10 s war read (a forced redraw used to wipe it).
    await o.page.locator('#pi-app input[placeholder="faction id"]').fill('88');
    await o.page.locator('#pi-app input[placeholder="faction id"]').press('End');
    await o.page.keyboard.type('8');
    await o.page.waitForTimeout(12000);
    const kept = await o.page.evaluate(() => { const sr = document.getElementById('pi-app').shadowRoot; const el = sr.querySelector('input[placeholder="faction id"]'); return { value: el.value, focused: sr.activeElement === el }; });
    ok(kept.value === '888' && kept.focused, 'typing survives a background redraw (' + JSON.stringify(kept) + ')');
    // Watched: the player starred on Targets, with a reason box and Remove.
    await o.page.locator('#pi-app .modes button', { hasText: 'Watched' }).click();
    await o.page.waitForTimeout(400);
    const watched = await measure(o.page);
    ok(/Remove/.test(watched.text) && /no reason/.test(watched.text), 'eye watched: the starred player listed with a reason and Remove');
    await o.page.close();
}

// Taking turns: Torn Trading seen → the webpage says Paused, keeps the plan moving, asks nothing; back by itself.
{
    const o = await openApp('');
    await o.page.evaluate(() => window.GM_setValue('pumpingIron.v1.tradingSeenAt', JSON.stringify(Date.now())));
    await o.page.waitForTimeout(6000);
    const n1 = await o.page.evaluate(() => window.__calls.length);
    const m = await measure(o.page);
    ok(/Paused: Torn Trading is running/.test(m.text) && /plan as of \d\d:\d\d/.test(m.text), 'paused: the warning on top, plan as of the last read');
    ok(/Paused · last read/.test(m.text), 'paused: the top bar says Paused');
    ok(/Xanax #\d/.test(m.text), 'paused: the plan still shows');
    await o.page.screenshot({ path: resolve(shots, 'app-paused.png'), fullPage: true });
    await o.page.waitForTimeout(5000);
    const n2 = await o.page.evaluate(() => window.__calls.length);
    ok(n2 === n1, 'paused: no request (' + (n2 - n1) + ')');
    await o.page.evaluate(() => window.GM_setValue('pumpingIron.v1.tradingSeenAt', JSON.stringify(Date.now() - 121000)));
    await o.page.waitForTimeout(6000);
    const back = await measure(o.page);
    ok(!/Paused: Torn Trading/.test(back.text), 'paused: back by itself');
    ok(o.errors.length === 0, 'paused: no page errors ' + JSON.stringify(o.errors));
    await o.page.close();
}

// Auto mode: without a Full key the top bar says so on every page; with one, the plan runs on your income.
{
    const o = await openApp('&full=1&who=owner');
    await o.page.evaluate(() => (location.hash = 'plan'));
    // The money log is read 5 s after the page opens; then Create plan (round 6: a plan is made on a click, from your income).
    await o.page.waitForTimeout(7000);
    await o.page.evaluate(() => window.__pi.createPlan({ months: 1 }));
    await o.page.waitForTimeout(1500);
    const m = await measure(o.page);
    ok(!/Auto mode needs a Full key · Add it/.test(m.text), 'auto: no header warning with a Full key');
    ok(/a day from your income/.test(m.text) && /You can afford this with your income/.test(m.text), 'auto: the plan runs on your income (' + (m.text.match(/[^.]*from your income[^.]*/) || [''])[0].slice(0, 120) + ')');
    ok(/Bazaar sell/.test(m.text), 'auto: where the income comes from (money log)');
    ok(/of it certain/.test(m.text), 'auto: the certain income (bank, dividends, rent) is counted (R6.4)');
    ok(o.errors.length === 0, 'auto: no page errors ' + JSON.stringify(o.errors.slice(0, 2)));
    await o.page.screenshot({ path: resolve(shots, 'app-auto.png'), fullPage: true });
    // Settings › Discord: one button, the old form under Advanced.
    await o.page.evaluate(() => (location.hash = 'settings'));
    await o.page.waitForTimeout(600);
    const st = await measure(o.page);
    ok(/Log in with Discord/.test(st.text) && !/Service address/i.test(st.text), 'discord: one button, no setup form');
    ok(/Connected · Full/.test(st.text), 'full key: shown as connected');
    await o.page.locator('#pi-app button', { hasText: 'Advanced: your own service' }).click();
    await o.page.waitForTimeout(300);
    ok(/Service address/i.test((await measure(o.page)).text), 'discord: Advanced opens the own-service form');
    // Trains on the phone (the gym log, Full key): read by the leader ~20 s after the page opens, shown in Last trains.
    await o.page.waitForFunction(() => Boolean(_store['pumpingIron.v1.gymLog'] && JSON.parse(_store['pumpingIron.v1.gymLog']).lines.length), null, { timeout: 30000 }).catch(() => {});
    await o.page.evaluate(() => (location.hash = 'progress'));
    await o.page.waitForTimeout(800);
    const pr = await measure(o.page);
    const row = (pr.text.match(/DEX × 15[^\n]*/) || [''])[0];
    ok(/DEX × 15/.test(pr.text) && /Torn log/.test(pr.text), 'gym log: the phone session shows in Last trains, marked Torn log (' + row.slice(0, 90) + ')');
    ok(/\+870/.test(pr.text), 'gym log: what Torn logged it gained (+870)');
    ok(o.errors.length === 0, 'gym log: no page errors ' + JSON.stringify(o.errors.slice(0, 2)));
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
