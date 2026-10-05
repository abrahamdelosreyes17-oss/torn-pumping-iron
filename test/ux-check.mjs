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
// PORT=… when another check already serves 8782 (another worktree's run).
const PORT = Number(process.env.UXPORT || process.env.PORT) || 8782;

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
}).listen(PORT);

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
    const base = 'http://127.0.0.1:' + PORT + '/test/harness-live.html?pi=app&key=1&at=2026-09-29T10:48:00Z&wait=100000' + (/noplan=1/.test(query || '') ? '' : '&plan=1&follow=steady');
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
    plan: ['Auto (from your books)', 'Auto mode needs a Full key', 'month plan ·', 'Recalibrate', 'New plan…', 'Recommended', 'The best plan for each stretch', 'Whole plan', 'Per $1M', 'One plan the whole way', 'against the path · click a row to follow it', 'Where your energy comes from', 'Natural energy', 'Build', 'High stat', "Hank's", 'pick yours', 'Ignorance Is Bliss', 'what-if'],
    buy: ['Buy for', 'Your list', 'Xanax', 'Iron_Monk', 'Points market', 'Deals', '7-day prices', 'You hold', 'TornW3B'],
    progress: ['Total stats against the plan', 'Each stat', 'Gained against plan', 'Receipts', 'Energy trained', '$ per 1,000 stats', 'What if you’d done another plan', 'the comparison appears after two days', 'Last trains', 'This week', 'Budget', 'Force Training'],
    eye: ['Targets', 'War', 'Watched', 'Ready now', 'Order: band › respect › HP kept › win', 'How sure', 'FFScouter', 'Gear seen', 'Your side'],
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
    const run2 = await clickRun('Recalibrate');
    ok(run2 !== null, 'buttons: Recalibrate clicked');
    ok(run2 === true, 'buttons: the recalibrate shows its bar and Cancel');
    ok(await waitText(/recalibrated /), 'buttons: recalibrated (same end)');
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
    ok(/Choco jump the whole way (gains less than the path|is over your budget|is not the path)/.test(m.text), 'plan: picking the choco jump warns');
    // The warning offers to keep the recommended plan (whichever it is: the refill check can change it).
    const keep = page.locator('#pi-app .warnb button', { hasText: /^Keep / });
    ok((await keep.count()) === 1, 'plan: the warning offers to keep the recommended plan (' + (await keep.count() ? await keep.first().textContent() : 'none') + ')');
    const stored = await page.evaluate(() => JSON.parse(_store['pumpingIron.v1.plan'] || 'null'));
    ok(!stored || stored.strategy !== 'chocoJump', 'plan: nothing saved before a choice');
    await keep.first().click();
    await page.waitForTimeout(300);
    m = await measure(page);
    ok(!/the whole way (gains less than the path|is over your budget|is not the path)/.test(m.text), 'plan: keeping your plan closes the warning');
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
    ok(/\n {2}Discord pings: not connected\n/.test(zip['report.txt']) && JSON.parse(zip['state.json']).discord.connected === false && JSON.parse(zip['state.json']).discord.ticks.nerve.on === true, 'report: Discord pings said, not connected (with the ping ticks)');
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
    // The one order (the owner, 2026-10-03): band first (Stomp, Good, Fair), then the most respect.
    const order = await o.page.evaluate(() => [...document.getElementById('pi-app').shadowRoot.querySelectorAll('.tbl tbody tr.click')].map((tr) => ({ band: ['Stomp', 'Good', 'Fair'].indexOf(tr.cells[0].textContent.trim()), resp: Number(tr.cells[3].textContent) })));
    ok(order.every((r, i) => i === 0 || r.band > order[i - 1].band || (r.band === order[i - 1].band && r.resp <= order[i - 1].resp)), 'eye: band first, then most respect (' + order.slice(0, 5).map((r) => r.band + ':' + r.resp).join(',') + ')');
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
    // Round 8 (his pick A): a click on a column head sorts by it, again flips it; the order line is the way back.
    {
        const sr = () => o.page.evaluate(() => { const r = document.getElementById('pi-app').shadowRoot; return { keep: [...r.querySelectorAll('.tbl tbody tr.click')].map((tr) => parseInt(tr.cells[4].textContent.replace('~', ''), 10)), rule: r.querySelector('.eye-rule').textContent.replace(/\s+/g, ' ').trim(), heads: [...r.querySelectorAll('.tbl thead .sortb')].map((b) => b.textContent.trim()), on: [...r.querySelectorAll('.tbl thead .sortb.on')].map((b) => b.textContent.trim() + (b.classList.contains('up') ? ' up' : '')), hit: [...r.querySelectorAll('.tbl tbody td[data-col="hit"]')].map((td) => td.textContent) }; });
        const d0 = await sr();
        ok(JSON.stringify(d0.heads) === JSON.stringify(['Band', 'Lvl', 'Respect', 'HP kept', 'Win', 'Status', 'Last hit']) && d0.on.length === 0 && /^Order: band › respect › HP kept › win$/.test(d0.rule), 'eye sort: seven column heads to click, the default order named in the bar (' + d0.heads + ' · ' + d0.rule + ')');
        ok(d0.hit.length > 0 && d0.hit.every((x) => x === '—' || /^(today|\d+ d ago)$/.test(x)), 'eye sort: the Last hit column (' + d0.hit.slice(0, 3) + ')');
        await o.page.locator('#pi-app .tbl thead .sortb[data-sort="keep"]').click();
        await o.page.waitForTimeout(300);
        const d1 = await sr();
        ok(/^Sorted by HP kept, most first\s?Default order$/.test(d1.rule) && d1.on.join() === 'HP kept' && d1.keep.every((k, i) => i === 0 || k <= d1.keep[i - 1]), 'eye sort: a click on HP kept sorts by it, most first, and the bar says so (' + d1.rule + ' · ' + d1.keep.slice(0, 6) + ')');
        await o.page.locator('#pi-app .tbl thead .sortb[data-sort="keep"]').click();
        await o.page.waitForTimeout(300);
        const d2 = await sr();
        ok(/^Sorted by HP kept, least first/.test(d2.rule) && d2.on.join() === 'HP kept up' && d2.keep.every((k, i) => i === 0 || k >= d2.keep[i - 1]), 'eye sort: the same head again flips it (' + d2.keep.slice(0, 6) + ')');
        const m2 = await measure(o.page);
        ok(m2.scrollW <= 1280 && m2.hostScrollW <= m2.hostW && m2.small.length === 0 && m2.covered.length === 0, 'eye sort: sorted, the bar and the table still fit (' + JSON.stringify({ scrollW: m2.scrollW, host: m2.hostScrollW + '/' + m2.hostW, small: m2.small.slice(0, 3), covered: m2.covered.slice(0, 3) }) + ')');
        await o.page.screenshot({ path: resolve(shots, 'app-eye-sorted.png'), fullPage: true });
        await o.page.locator('#pi-app .eye-rule button[data-act="default-order"]').click();
        await o.page.waitForTimeout(300);
        const d3 = await sr();
        ok(/^Order: band › respect › HP kept › win$/.test(d3.rule) && d3.on.length === 0 && JSON.stringify(d3.keep) === JSON.stringify(d0.keep), 'eye sort: Default order goes back');
    }
    // Round 8 (his pick A): the list as it shows is handed over for the attack page's Next button, in its own order
    // (written when it changes, at most every 5 s).
    await o.page.waitForTimeout(5500);
    const handed = await o.page.evaluate(() => { const v = window.GM_getValue('pumpingIron.v1.eyeNext', null); const t = typeof v === 'string' ? JSON.parse(v) : v; const drawn = [...document.getElementById('pi-app').shadowRoot.querySelectorAll('.tbl tbody tr.click')].map((tr) => tr.cells[1].textContent.trim()); return t ? { mode: t.mode, names: t.rows.map((r) => r[1]), where: t.rows.map((r) => r[6]), drawn, fresh: Date.now() - t.at < 60000 } : null; });
    ok(handed && handed.mode === 'targets' && JSON.stringify(handed.names) === JSON.stringify(handed.drawn) && handed.fresh && handed.where.every((x) => x === 'ok' || x === '?'), 'eye next: the Targets list is handed over for the attack page, in its order (' + JSON.stringify(handed) + ')');
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

// Round 8 (his pick A): war mode by itself. Your faction is in a ranked war: the Torn Eye tab opens on War with the
// enemy picked, asks "Termed war / med-out deal?" on top of the list, and the answer sets the ticks.
if (!only.length || only.includes('war')) {
    const o = await openApp('&ffs=1&who=owner&war=new&chain=247/250/222&echain=96/100/58');
    await o.page.evaluate(() => (location.hash = 'eye'));
    await o.page.waitForTimeout(6000);
    const read = () => o.page.evaluate(() => {
        const r = document.getElementById('pi-app').shadowRoot;
        const tx = (s) => { const e = r.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
        return {
            mode: tx('.modes button[aria-pressed="true"]'),
            vs: tx('.ctl .sel'),
            head: tx('.lead .sh'),
            ask: tx('.lead .ask'),
            answ: tx('.lead .answ'),
            rows: [...r.querySelectorAll('.lead .tbl tbody tr')].map((tr) => tr.cells[1].textContent.trim() + ':' + tr.getAttribute('data-state') + (tr.classList.contains('whatif') ? ':grey' : '') + ':' + tr.cells[6].textContent.replace(/\s+/g, ' ').trim()),
            ticks: [...r.querySelectorAll('.ticks .tk')].map((b) => b.textContent.trim() + (b.getAttribute('aria-pressed') === 'true' ? ' on' : ' off') + (b.classList.contains('set') ? ' ring' : '')),
            order: tx('.ctl [data-war-order]'),
            hidden: tx('[data-war-hidden]'),
        };
    });
    const a = await read();
    ok(a.mode === 'War' && /^vs Rival Syndicate \[7777\] · ranked war$/.test(a.vs || ''), 'war mode by itself: the Torn Eye tab opens on War with the enemy picked (' + a.mode + ' · ' + a.vs + ')');
    ok(/^War · Rival Syndicate\s?War mode turned itself on at \d\d:\d\d, when your faction’s ranked war began/.test(a.head || ''), 'war mode by itself: the card says when it turned itself on (' + a.head + ')');
    ok(/^Termed war \/ med-out deal\?\s?You hit, they med out, you hit again\. Your answer sets this war’s filters\. Asked once per war\.\s?Yes\s?No$/.test(a.ask || '') && a.answ === null, 'termed question: asked in a card on top of the list (' + a.ask + ')');
    ok(a.rows.length === 4 && a.ticks.join() === 'Hide under 50% off,Hide hospital off,Hide traveling off' && /^Not answered yet: the list is as it is today/.test(a.hidden || ''), 'termed question: until answered the list is as it is today (' + a.rows.length + ' rows · ' + a.hidden + ')');
    const m0 = await measure(o.page);
    ok(m0.scrollW <= 1280 && m0.hostScrollW <= m0.hostW && m0.small.length === 0 && m0.covered.length === 0, 'termed question: the card fits, no small text, its buttons on top (' + JSON.stringify({ small: m0.small.slice(0, 3), covered: m0.covered.slice(0, 3) }) + ')');
    await o.page.screenshot({ path: resolve(shots, 'app-eye-war-ask.png'), fullPage: true });
    // Yes: termed. Hospital rows stay in place, greyed, "back soon"; the away are hidden.
    await o.page.locator('#pi-app .ask button[data-termed="yes"]').click();
    await o.page.waitForTimeout(400);
    const y = await read();
    ok(y.ask === null && /^Termed war · hospital rows stay in the list\s?Change$/.test(y.answ || ''), 'termed Yes: the card folds to one line with Change (' + y.answ + ')');
    ok(y.ticks.join() === 'Hide under 50% off,Hide hospital off ring,Hide traveling on ring' && /^Stomp, then respect · hospital keeps its place$/.test(y.order || ''), 'termed Yes: the ticks it set carry a ring, the order says hospital keeps its place (' + y.ticks + ' · ' + y.order + ')');
    ok(y.rows.length === 3 && y.rows.filter((r) => /:hospital:grey:Hospital · \d+:\d\d · back soon$/.test(r)).length === 2 && !y.rows.some((r) => /Flyer/.test(r)), 'termed Yes: hospital rows stay, greyed, "back soon"; the traveller is hidden (' + y.rows.join(' | ') + ')');
    ok(/^Hidden by your answer: 1 away\. Hospital rows stay: they med out\.$/.test(y.hidden || ''), 'termed Yes: what the answer hides, said under the list (' + y.hidden + ')');
    await o.page.screenshot({ path: resolve(shots, 'app-eye-war-yes.png'), fullPage: true });
    // Change asks again; No: a real war, hospital rows hidden.
    await o.page.locator('#pi-app .answ button[data-termed="change"]').click();
    await o.page.waitForTimeout(400);
    ok(/^Termed war \/ med-out deal\?/.test((await read()).ask || ''), 'termed question: Change asks again');
    await o.page.locator('#pi-app .ask button[data-termed="no"]').click();
    await o.page.waitForTimeout(400);
    const n = await read();
    ok(/^Real war · hospital rows hidden\s?Change$/.test(n.answ || '') && n.ticks.join() === 'Hide under 50% off,Hide hospital on ring,Hide traveling on ring' && n.rows.length === 1 && /^Rival:okay/.test(n.rows[0]), 'termed No: a real war, only who you can hit now (' + n.answ + ' · ' + n.rows.join(' | ') + ')');
    ok(/^Hidden by your answer: 2 in hospital \(next out in \d+:\d\d\) · 1 away\.$/.test(n.hidden || '') && /^ready first, then out of hospital soonest$/.test(n.order || ''), 'termed No: what it hides, and the order (' + n.hidden + ')');
    const m1 = await measure(o.page);
    ok(m1.scrollW <= 1280 && m1.small.length === 0 && m1.covered.length === 0 && /Next out of hospital/.test(m1.text), 'termed No: the page still fits; "Next out of hospital" stays in the side pane');
    await o.page.screenshot({ path: resolve(shots, 'app-eye-war-no.png'), fullPage: true });
    // The war list as it shows now is what the attack page's Next button walks ("Next enemy"): written within 5 s.
    await o.page.waitForTimeout(5500);
    const handedWar = await o.page.evaluate(() => { const v = window.GM_getValue('pumpingIron.v1.eyeNext', null); const t = typeof v === 'string' ? JSON.parse(v) : v; return t ? { mode: t.mode, rows: t.rows.map((r) => r[1] + ':' + r[6]) } : null; });
    ok(handedWar && handedWar.mode === 'war' && handedWar.rows.join() === 'Rival:ok', 'eye next: in war mode the war list is handed over, as the answer left it (' + JSON.stringify(handedWar) + ')');
    // A view you pick stays: Targets is not switched back to War by the next look at your wars.
    await o.page.locator('#pi-app .modes button', { hasText: 'Targets' }).click();
    await o.page.waitForTimeout(4500);
    ok((await read()).mode === 'Targets', 'war mode by itself: a view you pick stays');
    // Chain mode carries the chain counter (round 8): your chain from your bars, the enemy's read while you are at war.
    const counter = () => o.page.evaluate(() => { const c = document.getElementById('pi-app').shadowRoot.querySelector('[data-chain-mode] .chainc'); return c ? { text: c.textContent.replace(/\s+/g, ' ').trim(), low: [...c.querySelectorAll('.time')].map((t) => t.classList.contains('low')) } : null; });
    ok((await counter()) === null, 'chain mode off: no counter in its card');
    await o.page.locator('#pi-app [data-chain-mode] button', { hasText: 'Chain mode' }).click();
    await o.page.waitForTimeout(3500);
    const cc = await counter();
    ok(cc && /^Your faction\s?3:\d\d\s?247\s?3 hits to the 250 bonus\s?Rival Syndicate\s?0:\d\d\s?96\s?4 hits to the 100 bonus$/.test(cc.text) && JSON.stringify(cc.low) === '[false,true]', 'chain mode on: the chain counter in its card, both chains, the low timer amber (' + JSON.stringify(cc) + ')');
    const mc = await measure(o.page);
    ok(mc.scrollW <= 1280 && mc.small.length === 0 && mc.covered.length === 0 && /on since \d\d:\d\d · stacking/.test(mc.text), 'chain mode on: the card fits its pane (' + JSON.stringify({ small: mc.small.slice(0, 3), covered: mc.covered.slice(0, 3) }) + ')');
    const asked = await o.page.evaluate(() => window.__calls.filter((x) => /faction\/7777\/chain/.test(x)).length);
    ok(asked >= 1 && asked <= 3, 'chain mode on: the enemy’s chain is read, about every 30 s (' + asked + ' in the first seconds)');
    await o.page.screenshot({ path: resolve(shots, 'app-eye-chain-mode.png'), fullPage: true });
    ok(o.errors.length === 0, 'war mode: no page errors ' + JSON.stringify(o.errors.slice(0, 2)));
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

// Auto mode: without a Full key the top bar says so on every page; with one, the plan runs on your books (R7.5).
if (!only.length || only.includes('auto')) {
    const o = await openApp('&full=1&who=owner');
    await o.page.evaluate(() => (location.hash = 'plan'));
    // The money log is read 5 s after the page opens; then Create plan (round 6: a plan is made on a click, from your income).
    await o.page.waitForTimeout(7000);
    await o.page.evaluate(() => window.__pi.createPlan({ months: 1 }));
    await o.page.waitForTimeout(1500);
    const m = await measure(o.page);
    ok(!/Auto mode needs a Full key · Add it/.test(m.text), 'auto: no header warning with a Full key');
    ok(/a day from your books/.test(m.text) && /This plan costs/.test(m.text), 'auto: the plan runs on your books (' + (m.text.match(/[^.]*from your books[^.]*/) || [''])[0].slice(0, 120) + ')');
    ok(/Coming in \(your books, \d+ days\): Company employee pay/.test(m.text), 'auto: where the money comes from, by Torn’s log type');
    ok(/\$3\.8M a day from your books/.test(m.text) && !/\$[67]\d(\.\d)?M a day from your/.test(m.text), 'auto: $4M of pay less the upkeep a day; the $2B gift and the $2B banked are not income (' + (m.text.match(/\$[\d.]+[MB] a day from your books/) || [''])[0] + ')');
    ok(o.errors.length === 0, 'auto: no page errors ' + JSON.stringify(o.errors.slice(0, 2)));
    await o.page.screenshot({ path: resolve(shots, 'app-auto.png'), fullPage: true });
    // Round 8: Plan's money block (the owner's pick P1): six figures from your books, in the accountant's words.
    const figs = await o.page.evaluate(() => [...document.getElementById('pi-app').shadowRoot.querySelectorAll('[data-money] .figc')].map((f) => ({ id: f.dataset.fig, label: f.querySelector('.lab').textContent, value: f.querySelector('b').textContent, sub: f.querySelector('small').textContent, w: Math.round(f.getBoundingClientRect().width), clipped: f.scrollWidth > f.clientWidth + 1 })));
    ok(figs.map((f) => f.id).join() === 'free,in,habit,restricted,oneoffs,plan', 'money: six figures in a row (' + figs.map((f) => f.label).join(' | ') + ')');
    ok(figs.length === 6 && figs.every((f) => !f.clipped), 'money: no figure is cut off ' + JSON.stringify(figs.filter((f) => f.clipped)));
    ok(figs.length === 6 && /^Total free cash$/.test(figs[0].label) && /^Non-recurring, not counted$/.test(figs[4].label) && /lines?$/.test(figs[4].value), 'money: free cash and the non-recurring lines (' + (figs[0] || {}).value + ', ' + (figs[4] || {}).value + ' ' + (figs[4] || {}).sub + ')');
    ok(figs.length === 6 && /fits: lasts all \d+ days|runs out on day \d+/.test(figs[5].sub), 'money: the plan is checked against your free cash (' + (figs[5] || {}).sub + ')');
    // The budget choice opens at Create plan.
    await o.page.evaluate(() => [...document.getElementById('pi-app').shadowRoot.querySelectorAll('button')].find((b) => /^New plan/.test(b.textContent)).click());
    await o.page.waitForTimeout(300);
    const buds = await o.page.evaluate(() => [...document.getElementById('pi-app').shadowRoot.querySelectorAll('[data-budgets] .bud')].map((b) => b.textContent));
    ok(buds.length === 4 && /^Your habit/.test(buds[0]) && /^Stretch/.test(buds[1]) && /^All your free cash/.test(buds[2]) && /^No limit/.test(buds[3]) && buds.filter((x) => /Recommended/.test(x)).length === 1, 'money: the budget choice at Create plan, one recommended (' + buds.map((x) => x.slice(0, 26)).join(' | ') + ')');
    await o.page.screenshot({ path: resolve(shots, 'app-plan-money.png'), fullPage: true });
    // Round 8: the Ledger tab (option A, adjusted): the statement, what you own, by account, every line.
    await o.page.evaluate(() => (location.hash = 'ledger'));
    await o.page.waitForTimeout(600);
    const lg = await measure(o.page);
    for (const words of ['How your income was worked out', 'Recurring income', 'Committed costs', 'Disposable income', 'What you chose to spend it on', 'Uncontrollable gains and losses', 'Non-recurring', 'Transfers between your own accounts', 'Change in cash by the books', 'What you own', 'Total free cash', 'Restricted cash', 'By account', 'Every line', 'Download CSV', 'The account table', 'Export log', 'A plan may spend']) ok(lg.text.includes(words), 'ledger: says "' + words + '"');
    // Session 12 (the accountant's Q21): an item bought and sold again is one line, "Trading", sales less purchases.
    const trading = await o.page.evaluate(() => [...document.getElementById('pi-app').shadowRoot.querySelectorAll('[data-ledger-trading]')].map((td) => td.parentElement.textContent));
    ok(trading.length === 1 && /Trading items bought and sold again · sold \$50,500,000 less bought \$50,000,000/.test(trading[0]) && /\$500,000/.test(trading[0]), 'ledger: Trading is one line, sales less purchases (' + trading.join(' | ') + ')');
    ok(!/Item shop sell 4210|Bazaar buy 1225/.test(lg.text.slice(0, lg.text.indexOf('By account'))), 'ledger: the statement does not list a traded item by log type');
    ok(lg.small.length === 0, 'ledger: no text under 11px ' + JSON.stringify(lg.small.slice(0, 3)));
    ok(lg.hostScrollW <= lg.hostW + 1, 'ledger: no sideways scroll (' + lg.hostScrollW + ' in ' + lg.hostW + ')');
    ok(o.errors.length === 0, 'ledger: no page errors ' + JSON.stringify(o.errors.slice(0, 2)));
    await o.page.screenshot({ path: resolve(shots, 'app-ledger.png'), fullPage: true });
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

// Settings › Discord pings (a friend: "I did not receive an alert from the discord bot", and all he saw was "Your
// Worker answered 502."): the state in words with what to do, never "Working" while the bot can't reach you, and
// the ping ticks (closed until opened; stacking moves them and says so; a hand change during it stays).
if (!only.length || only.includes('discord')) {
    const discordOf = (page) => page.evaluate(() => {
        const sr = document.getElementById('pi-app').shadowRoot;
        const sec = [...sr.querySelectorAll('.sec')].find((s) => (s.querySelector('h3') || {}).textContent === 'Discord pings');
        if (!sec) return null;
        const ticks = {};
        for (const l of sec.querySelectorAll('details.pings [data-ping]')) ticks[l.getAttribute('data-ping')] = { on: l.querySelector('input').checked, why: (l.querySelector('.why') || {}).textContent || null };
        const box = sec.querySelector('[data-discord]');
        const det = sec.querySelector('details.pings');
        return {
            tag: (sec.querySelector('.state') || {}).textContent || '',
            state: box ? box.getAttribute('data-discord') : null,
            title: box ? box.querySelector('b').textContent : null,
            steps: [...sec.querySelectorAll('ol.steps-list li')].map((li) => li.textContent),
            msgs: [...sec.querySelectorAll('.msg')].map((x) => x.textContent).filter(Boolean),
            ticks,
            open: Boolean(det && det.open),
            summary: det ? det.querySelector('summary').textContent : null,
            text: sec.innerText.replace(/\s+/g, ' '),
        };
    });
    const toSettings = async (page) => {
        await page.evaluate(() => (location.hash = 'settings'));
        await page.waitForTimeout(500);
    };
    const press = async (page, text) => {
        await page.locator('#pi-app button', { hasText: text }).first().click();
        await page.waitForTimeout(400);
    };
    const bodies = (page) => page.evaluate(() => window.__workerBodies);
    // Discord refuses the bot's DM.
    {
        const o = await openApp('&discord=refused');
        await toSettings(o.page);
        let d = await discordOf(o.page);
        ok(d && d.tag === 'Not reaching you' && d.state === 'dm_refused' && d.title === 'Discord refuses the bot’s DMs', 'discord, DMs refused: the tag says "Not reaching you", not "Working" (' + JSON.stringify(d && [d.tag, d.state, d.title]) + ')');
        ok(d && d.steps.join(' | ') === 'In Discord, open the server the bot is in. | Click the server name, then Privacy Settings. | Turn Direct Messages on. | Then press Send a test ping here.', 'discord, DMs refused: the steps that fix it (' + (d && d.steps.join(' | ')) + ')');
        ok(d && /Last refused 10:38 UTC/.test(d.text) && d.open === false && d.summary === 'Which pings the bot sends · 1 off', 'discord, DMs refused: since when, and the ticks are closed until opened (' + (d && d.summary) + ')');
        const m = await measure(o.page);
        ok(m.scrollW <= 1280 && m.hostScrollW <= m.hostW && m.small.length === 0 && m.covered.length === 0, 'discord, DMs refused: no overflow, no small text, every control on top ' + JSON.stringify([m.scrollW, m.small.slice(0, 3), m.covered.slice(0, 3)]));
        await o.page.screenshot({ path: resolve(shots, 'app-settings-discord-refused.png'), fullPage: true });
        await press(o.page, 'Send a test ping');
        d = await discordOf(o.page);
        ok(d && d.msgs.includes('Discord refused the bot’s DM. What to do is above.') && !/answered \d+/.test(d.text), 'discord, DMs refused: the test ping says why (' + (d && d.msgs.join(' | ')) + ')');
        // Direct Messages turned on in Discord: the test ping arrives and the tag follows at once.
        await o.page.evaluate(() => (window.__dmFixed = true));
        await press(o.page, 'Send a test ping');
        d = await discordOf(o.page);
        ok(d && d.tag === 'Working' && d.state === null && d.steps.length === 0 && d.msgs.includes('Sent. Check your Discord DMs.'), 'discord, DMs back on: the test ping arrives and the tag says Working (' + JSON.stringify(d && [d.tag, d.msgs]) + ')');
        ok(o.errors.length === 0, 'discord, DMs refused: no page errors ' + JSON.stringify(o.errors.slice(0, 2)));
        await o.page.close();
    }
    // The ticks.
    {
        const o = await openApp('&discord=ok');
        await toSettings(o.page);
        await o.page.locator('#pi-app summary', { hasText: 'Which pings the bot sends' }).click();
        await o.page.waitForTimeout(300);
        let d = await discordOf(o.page);
        const kinds = Object.keys((d && d.ticks) || {});
        ok(d && d.tag === 'Working' && d.open && kinds.length === 13 && kinds.filter((k) => !d.ticks[k].on).join() === 'chain' && kinds.every((k) => !d.ticks[k].why), 'ticks: every ping listed, all on but "Chain about to drop" (' + kinds.join(' ') + ')');
        for (const w of ['Cooldowns', 'Bars', 'Your plan', 'Players and prices', 'Nerve full · about a minute before, once', 'the latest change wins']) ok(d && d.text.toLowerCase().includes(w.toLowerCase()), 'ticks: shows "' + w + '"');
        const m = await measure(o.page);
        ok(m.scrollW <= 1280 && m.hostScrollW <= m.hostW && m.small.length === 0 && m.covered.length === 0, 'ticks: no overflow, no small text, every control on top ' + JSON.stringify([m.scrollW, m.small.slice(0, 3), m.covered.slice(0, 3)]));
        await o.page.screenshot({ path: resolve(shots, 'app-settings-discord-ticks.png'), fullPage: true });
        await o.page.locator('#pi-app [data-ping="booster"] input').click();
        await o.page.waitForTimeout(600);
        d = await discordOf(o.page);
        ok(d && d.open && d.ticks.booster.on === false && d.summary === 'Which pings the bot sends · 2 off', 'ticks: one unticked stays open and is counted (' + (d && d.summary) + ')');
        await o.page.waitForFunction(() => window.__workerBodies.some((b) => b.body && b.body.rules && b.body.rules.booster === false), null, { timeout: 9000 }).catch(() => {});
        let sent = (await bodies(o.page)).filter((b) => b.path === '/plan' && b.body && b.body.rules).pop();
        ok(sent && sent.body.rules.booster === false && sent.body.rules.energy === true && sent.body.rulesAt.booster > 0, 'ticks: the change goes to the service within seconds (' + JSON.stringify(sent && [sent.body.rules.booster, sent.body.rulesAt]) + ')');
        // Stacking for a chain turns the energy and training ticks off by itself, and says so.
        await o.page.evaluate(() => (location.hash = 'home'));
        await o.page.waitForTimeout(500);
        await press(o.page, 'I’m stacking');
        await toSettings(o.page);
        d = await discordOf(o.page);
        ok(d && ['energy', 'refill', 'jump'].every((k) => d.ticks[k].on === false && d.ticks[k].why === 'off while you are stacking · back on Resume') && d.ticks.drug.on && !d.ticks.drug.why, 'ticks, stacking: energy, refill and jump are off and say why (' + JSON.stringify(d && d.ticks.energy) + ')');
        const ms = await measure(o.page);
        ok(ms.scrollW <= 1280 && ms.hostScrollW <= ms.hostW && ms.small.length === 0, 'ticks, stacking: no overflow, no small text ' + JSON.stringify([ms.scrollW, ms.small.slice(0, 3)]));
        await o.page.screenshot({ path: resolve(shots, 'app-settings-discord-stacking.png'), fullPage: true });
        // Ticked back on by hand while stacking: it stays, and the service is told to keep it.
        await o.page.waitForTimeout(5200);
        await o.page.locator('#pi-app [data-ping="energy"] input').click();
        await o.page.waitForTimeout(800);
        d = await discordOf(o.page);
        sent = (await bodies(o.page)).filter((b) => b.path === '/plan' && b.body && b.body.plan && b.body.plan.chain).pop();
        ok(d && d.ticks.energy.on && !d.ticks.energy.why && d.ticks.refill.on === false, 'ticks, stacking: one ticked back on by hand stays on (' + JSON.stringify(d && d.ticks.energy) + ')');
        ok(sent && JSON.stringify(sent.body.plan.chain.keep) === '["energy"]' && sent.body.rules.energy === true, 'ticks, stacking: the service is told to keep it (' + JSON.stringify(sent && sent.body.plan.chain) + ')');
        ok(o.errors.length === 0, 'ticks: no page errors ' + JSON.stringify(o.errors.slice(0, 2)));
        await o.page.close();
    }
    // The service in use before this release: it does not say where pings go, and a failed test ping is a bare 502.
    {
        const o = await openApp('&discord=old');
        await toSettings(o.page);
        await o.page.locator('#pi-app summary', { hasText: 'Which pings the bot sends' }).click();
        await o.page.waitForTimeout(300);
        let d = await discordOf(o.page);
        ok(d && d.tag === 'Working' && d.ticks.nerve && d.ticks.nerve.why === 'the service is older · no nerve pings yet' && Object.values(d.ticks).filter((x) => x.why).length === 1, 'older service: nothing looks broken; the nerve tick says the service is older (' + JSON.stringify(d && [d.tag, d.ticks.nerve]) + ')');
        await press(o.page, 'Send a test ping');
        d = await discordOf(o.page);
        ok(d && d.tag === 'Not reaching you' && d.state === 'test_failed' && d.msgs.includes('The test ping did not arrive. What to try is above.') && !/answered 502/.test(d.text), 'older service: a failed test ping says what to try, not "answered 502" (' + JSON.stringify(d && [d.tag, d.msgs]) + ')');
        ok(d && d.steps.length === 5 && /^Then press Disconnect here and Log in with Discord again/.test(d.steps[3]) && d.steps[4] === 'Then press Send a test ping.', 'older service: the steps end with Disconnect and Log in with Discord again (' + (d && d.steps.slice(3).join(' | ')) + ')');
        const m = await measure(o.page);
        ok(m.scrollW <= 1280 && m.hostScrollW <= m.hostW && m.small.length === 0 && m.covered.length === 0, 'older service: no overflow, no small text, every control on top ' + JSON.stringify([m.scrollW, m.small.slice(0, 3), m.covered.slice(0, 3)]));
        await o.page.screenshot({ path: resolve(shots, 'app-settings-discord-old.png'), fullPage: true });
        // The report says it (his held only "discord: true"): the state, the failed test ping, the line in the log.
        const [dl] = await Promise.all([o.page.waitForEvent('download'), o.page.locator('#pi-app button', { hasText: 'Download report (.zip)' }).click()]);
        const zip = readZip(new Uint8Array(await readFile(await dl.path()))).files;
        const short = (zip['report.txt'].match(/ {2}Discord pings: [^\n]*/) || [''])[0];
        ok(/Discord pings: Not reaching you \(test_failed\) · logged in with Discord · last sync [\d-]+ [\d:]+ UTC · an older service: it does not say where pings go · last test ping failed \(unknown\) · ticked off: chain/.test(short), 'report: IN SHORT says the Discord state (' + short.trim() + ')');
        const sd = JSON.parse(zip['state.json']).discord;
        ok(sd && sd.connected && sd.state === 'test_failed' && sd.delivery === null && sd.serviceTells === false && sd.lastTest && sd.lastTest.http === 502 && sd.ticks.nerve.on === true && sd.keySent === true, 'report: state.json carries the Discord state (' + JSON.stringify(sd && { state: sd.state, lastTest: sd.lastTest && sd.lastTest.reason, tells: sd.serviceTells, keySent: sd.keySent }) + ')');
        ok(/ERROR \[[^\]]*\] Discord test ping failed: unknown - Your Worker answered 502\. \[http 502\]/.test(zip['problem-log.txt']), 'report: the failed test ping is in the problem log (' + (zip['problem-log.txt'].match(/[^\n]*Discord test ping[^\n]*/) || [''])[0].slice(20) + ')');
        const whole = Object.values(zip).join(' ');
        ok(['harness0secret', 'DiscordFriend77', '112233445566778899', 'workers.dev'].every((x) => !whole.includes(x)), 'report: no secret, Discord name, Discord id or service address in any file');
        ok(o.errors.length === 0, 'older service: no page errors ' + JSON.stringify(o.errors.slice(0, 2)));
        await o.page.close();
    }
}

// Overdosed (the owner, 2026-10-03): Torn answers happy 0, energy 0 and a day of drug cooldown. Home says
// "Overdosed · fly to Switzerland" with no training steps (it said "Train DEX × 6"); the strip says it too.
if (!only.length || only.includes('overdose')) {
    const o = await openApp('&energy=0&happy=0&drug=86400');
    await o.page.waitForTimeout(800);
    const m = await measure(o.page);
    ok(/Overdosed · fly to Switzerland/.test(m.text) && /No training steps until rehab is done/.test(m.text), 'overdose: Home says "Overdosed · fly to Switzerland", no training steps');
    ok(!/Train (STR|DEF|SPD|DEX) ×|Take Xanax #|Open the gym/.test(m.text), 'overdose: no training step anywhere on Home (' + (m.text.match(/(Train (STR|DEF|SPD|DEX) ×|Take Xanax #|Open the gym)[^\n]{0,30}/) || [''])[0] + ')');
    const od = await o.page.evaluate(() => {
        const sr = document.getElementById('pi-app').shadowRoot;
        return { box: Boolean(sr.querySelector('.stackbox[data-overdose="on"]')), strip: (sr.querySelector('.strip [data-overdose="on"]') || {}).textContent || '', btn: [...sr.querySelectorAll('.stackbox .btn')].map((b) => b.textContent), stored: JSON.parse(_store['pumpingIron.v1.overdose'] || 'null') };
    });
    ok(od.box && /Overdosed · fly to Switzerland/.test(od.strip), 'overdose: the strip\'s Drug cell says it too (' + od.strip.slice(0, 80) + ')');
    ok(od.btn.join('|') === 'Open Travel|Rehab done · recalibrate', 'overdose: Open Travel and "Rehab done · recalibrate" (' + od.btn.join('|') + ')');
    ok(od.stored && od.stored.until > od.stored.at, 'overdose: stored under the key Torn\'s pages read (' + JSON.stringify(od.stored) + ')');
    // Round 8 (pick B): flying to Switzerland is the one thing to do, so the rail's point is the plate with the ring.
    const odRing = await o.page.evaluate(() => { const sr = document.getElementById('pi-app').shadowRoot; return { rings: sr.querySelectorAll('.ring').length, onNode: Boolean(sr.querySelector('.rail > li.now > .node > .pl.ring')), rows: sr.querySelector('.rail').children.length }; });
    ok(odRing.rings === 1 && odRing.onNode && odRing.rows === 1, 'overdose: one ring, on the rail\'s point, the box alone on the rail (' + JSON.stringify(odRing) + ')');
    ok(m.scrollW <= 1280 && m.small.length === 0 && m.covered.length === 0, 'overdose: no overflow, no small text, every control on top');
    ok(o.errors.length === 0, 'overdose: no page errors ' + JSON.stringify(o.errors.slice(0, 2)));
    await o.page.screenshot({ path: resolve(shots, 'app-home-overdose.png'), fullPage: true });
    await o.page.close();
}

/*
 * Round 8, the owner's pick B (mockups/round8/steps-panel.html): Today is one rail, the step of the moment a box on it
 * with its actions under each other, and the plate ring (his pick 1D) on the one action to do now. One ring on the
 * page, none on a countdown; opacity and transform only; drawn still under "reduce motion" and with Animations off.
 */
const railOf = (page) => page.evaluate(() => {
    const sr = document.getElementById('pi-app').shadowRoot;
    const rail = sr.querySelector('.lead .rail');
    if (!rail) return null;
    const ring = sr.querySelector('.pl.ring');
    const after = ring ? getComputedStyle(ring, '::after') : null;
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
    return {
        state: rail.getAttribute('data-rail'), rows: rail.children.length, tables: sr.querySelectorAll('.lead table').length, bands: sr.querySelectorAll('.nowb').length,
        rings: sr.querySelectorAll('.ring').length, ringIn: ring ? (ring.closest('.subr li.now') ? 'sub' : ring.closest('.rail > li.now > .node') ? 'node' : 'other') : null,
        anim: after && after.animationName, opacity: after && after.opacity, transform: after && after.transform, still: sr.querySelector('.pi-root').classList.contains('still'),
        subs: [...sr.querySelectorAll('.subr li')].map((li) => (li.classList.contains('done') ? '✓ ' : li.classList.contains('now') ? '● ' : '○ ') + txt(li)), ticks: sr.querySelectorAll('.subr li.done svg.tick').length,
        nb: txt(sr.querySelector('.nb')), side: txt(sr.querySelector('.nb .side')), when: txt(sr.querySelector('.rail > li.now > .t')),
        btns: [...sr.querySelectorAll('.nb .btn')].map((b) => b.textContent + (b.classList.contains('primary') ? '*' : '')),
        later: [...rail.querySelectorAll(':scope > li:not(.now):not(.done)')].map(txt),
    };
});
if (!only.length || only.includes('rail')) {
    // Nothing due (the Xanax is 3:50 away): said in words, with the countdown; nothing rings.
    {
        const o = await openApp('');
        await o.page.waitForTimeout(600);
        const r = await railOf(o.page);
        ok(r && r.state === 'wait' && r.tables === 0 && r.bands === 0 && r.rows >= 2, 'rail: Today is one rail, no band and no table (' + JSON.stringify(r && { state: r.state, rows: r.rows, tables: r.tables, bands: r.bands }) + ')');
        ok(r && /^Nothing due now ?Next at \d\d:\d\d: take Xanax #1, then train (STR|DEF|SPD|DEX) × \d+ · .+ · \+[\d,]+ · \d+ energy/.test(r.nb) && /^\d+:\d\d ?next at \d\d:\d\d$/.test(r.side), 'rail, nothing due: "Nothing due now · Next at …" with the countdown (' + (r && r.nb.slice(0, 130)) + ')');
        ok(r && r.rings === 0 && r.btns.length === 0 && r.subs.length === 0, 'rail, nothing due: a countdown never rings; no buttons (' + JSON.stringify(r && { rings: r.rings, btns: r.btns }) + ')');
        ok(r && r.later.length >= 1 && r.later.every((x) => /in \d/.test(x)), 'rail: the later steps hang on the same line, each with when it comes (' + (r && r.later[0]) + ')');
        await o.page.close();
    }
    // A step due (the Xanax cooldown is over): its two actions, the ring on the one to do now, Items first.
    {
        const o = await openApp('&drug=0');
        await o.page.waitForTimeout(600);
        const r = await railOf(o.page);
        ok(r && r.state === 'due' && r.when === 'now' && /NOW/.test(r.side), 'rail, a step due: the step of the moment is a box on the rail, "now" (' + JSON.stringify(r && { state: r.state, when: r.when, side: r.side }) + ')');
        ok(r && r.subs.length === 2 && /^● Take Xanax #1 ?Step 1 of 2 · \+250 energy$/.test(r.subs[0]) && /^○ Train (STR|DEF|SPD|DEX) × \d+ · .+ · about \+[\d,]+ · \d+ energy$/.test(r.subs[1]), 'rail, a step due: "Take Xanax #1, then train …" is its two actions (' + (r && r.subs.join(' | ')) + ')');
        ok(r && r.rings === 1 && r.ringIn === 'sub' && r.anim === 'pi-ring', 'rail, a step due: one ring on the page, on the action to do now (' + JSON.stringify(r && { rings: r.rings, ringIn: r.ringIn, anim: r.anim }) + ')');
        ok(r && r.btns.join('|') === 'Items*|Open the gym', 'rail, a step due: the first button follows the action of the moment (' + (r && r.btns.join('|')) + ')');
        const m = await measure(o.page);
        ok(m.scrollW <= 1280 && m.small.length === 0 && m.covered.length === 0, 'rail, a step due: no overflow, no small text, every control on top ' + JSON.stringify([m.scrollW, m.small.slice(0, 3), m.covered.slice(0, 3)]));
        await o.page.screenshot({ path: resolve(shots, 'app-home-due.png'), fullPage: true });
        // The PC's "reduce motion": nothing moves, the ring stays drawn around the plate.
        await o.page.emulateMedia({ reducedMotion: 'reduce' });
        await o.page.waitForTimeout(150);
        const red = await railOf(o.page);
        ok(red && red.anim === 'none' && red.opacity === '0.55' && /matrix\(1\.7, 0, 0, 1\.7/.test(red.transform), 'rail, reduce motion: the ring is drawn still (' + JSON.stringify(red && [red.anim, red.opacity, red.transform]) + ')');
        await o.page.emulateMedia({ reducedMotion: 'no-preference' });
        // Settings › Animations off: the same.
        await o.page.evaluate(() => {
            window.GM_setValue('pumpingIron.v1.settings', JSON.stringify({ motion: false }));
            window.__pi.refresh();
        });
        await o.page.waitForTimeout(1200);
        const off = await railOf(o.page);
        ok(off && off.still && off.rings === 1 && off.anim === 'none' && off.opacity === '0.55', 'rail, Animations off: the ring is drawn still (' + JSON.stringify(off && [off.still, off.rings, off.anim, off.opacity]) + ')');
        await o.page.screenshot({ path: resolve(shots, 'app-home-due-still.png'), fullPage: true });
        ok(o.errors.length === 0, 'rail, a step due: no page errors ' + JSON.stringify(o.errors.slice(0, 2)));
        await o.page.close();
    }
    // A jump mid-way: the 5 EDVD are in (happy 17,525 of 5,025), the Ecstasy is the action of the moment.
    {
        const o = await openApp('&energy=1000&happy=17525&drug=0');
        // Once the harness has made its plan and followed steady: follow the EDVD jump, as picking its row on Plan does.
        await o.page.waitForFunction(() => Boolean(_store['pumpingIron.v1.planNow']), null, { timeout: 30000 });
        await o.page.waitForTimeout(400);
        await o.page.evaluate(() => window.__pi.followStrategy('edvdJump'));
        await o.page.waitForTimeout(1200);
        const r = await railOf(o.page);
        ok(r && r.state === 'due' && r.subs[0] === '✓ EDVD × 5 · happy 17,525' && /^● Take the Ecstasy ?Step 2 of \d · doubles your happy: 17,525 → 35,050$/.test(r.subs[1]) && r.ticks === 1, 'rail, a jump mid-way: the eaten EDVD keep their name and are ticked, the Ecstasy is the action of the moment (' + (r && r.subs.slice(0, 2).join(' | ')) + ')');
        ok(r && /^○ Train it all/.test(r.subs[2] || ''), 'rail, a jump mid-way: training stays small until its turn (' + (r && r.subs[2]) + ')');
        ok(r && r.rings === 1 && r.ringIn === 'sub', 'rail, a jump mid-way: one ring, on the Ecstasy (' + JSON.stringify(r && { rings: r.rings, ringIn: r.ringIn }) + ')');
        ok(r && /^\d+:\d\d ?until \d\d:\d\d, when happy resets/.test(r.side) && !/NOW/.test(r.side), 'rail, a jump mid-way: the countdown to the tick that resets the happy (' + (r && r.side) + ')');
        ok(r && r.btns.join('|') === 'Items*|Open the gym', 'rail, a jump mid-way: Items first while the drug is next (' + (r && r.btns.join('|')) + ')');
        const m = await measure(o.page);
        ok(m.scrollW <= 1280 && m.small.length === 0 && m.covered.length === 0, 'rail, a jump mid-way: no overflow, no small text, every control on top ' + JSON.stringify([m.scrollW, m.small.slice(0, 3), m.covered.slice(0, 3)]));
        ok(o.errors.length === 0, 'rail, a jump mid-way: no page errors ' + JSON.stringify(o.errors.slice(0, 2)));
        await o.page.screenshot({ path: resolve(shots, 'app-home-jump.png'), fullPage: true });
        await o.page.close();
    }
    // Stacking for a chain: the rail holds the box alone; nothing rings.
    {
        const o = await openApp('');
        await o.page.locator('#pi-app button', { hasText: 'I’m stacking' }).click();
        await o.page.waitForTimeout(600);
        const r = await railOf(o.page);
        ok(r && r.rows === 1 && r.rings === 0 && /Stacking for a chain/.test(r.nb) && r.btns.join('|') === 'Resume and recalibrate*', 'rail, stacking: the box alone on the rail, nothing rings (' + JSON.stringify(r && { rows: r.rows, rings: r.rings, btns: r.btns }) + ')');
        const m = await measure(o.page);
        ok(m.scrollW <= 1280 && m.small.length === 0 && m.covered.length === 0, 'rail, stacking: no overflow, no small text, every control on top');
        await o.page.screenshot({ path: resolve(shots, 'app-home-stacking.png'), fullPage: true });
        await o.page.close();
    }
}

// Flying (the owner's live page, 2026-10-03): Home says so, with no training step to do now.
if (!only.length || only.includes('flying')) {
    const o = await openApp('&energy=60&fly=43');
    await o.page.waitForTimeout(800);
    const m = await measure(o.page);
    const fr = await railOf(o.page);
    ok(fr && fr.rows === 1 && fr.rings === 0 && /^\d\d:\d\d$/.test(fr.when || ''), 'flying: the rail holds the box alone at the time you are back, nothing rings (' + JSON.stringify(fr && { rows: fr.rows, rings: fr.rings, when: fr.when }) + ')');
    ok(/Flying · back in Torn at \d\d:\d\d/.test(m.text) && /No training until you are back in Torn/.test(m.text) && /First when you land:/.test(m.text), 'flying: Home says "Flying · back in Torn at HH:MM" and what comes first when you land');
    ok(!/Open the gym/.test(m.text), 'flying: no "Open the gym" on Home');
    ok(m.scrollW <= 1280 && m.small.length === 0 && m.covered.length === 0, 'flying: no overflow, no small text, every control on top');
    ok(o.errors.length === 0, 'flying: no page errors ' + JSON.stringify(o.errors.slice(0, 2)));
    await o.page.screenshot({ path: resolve(shots, 'app-home-flying.png'), fullPage: true });
    await o.page.close();
}

// No key: the page opens on Settings with the ToS table open.
{
    const p2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await p2.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
    await p2.goto('http://127.0.0.1:' + PORT + '/test/harness-live.html?pi=app&wait=100000');
    await p2.waitForTimeout(1500);
    const m = await measure(p2);
    ok(m.text.includes('No key yet') && m.text.includes('Data storage'), 'no key: Settings with the ToS table');
    await p2.screenshot({ path: resolve(shots, 'app-nokey.png'), fullPage: true });
    await p2.close();
}

// Round 9 (the owner's pick 4B): the tab's title. Plain "Pumping Iron" until the last ten minutes before the next step,
// then its countdown, then "Now". (On Torn's pages we never touch the title: test/r12-tab-title.test.js.)
{
    // The harness's Xanax cooldown ends about 3 minutes from its clock: inside the last ten minutes.
    const soon = await openApp('');
    await soon.page.waitForTimeout(1500);
    const t1 = await soon.page.title();
    ok(/^\d:\d\d · Xanax #1 · Pumping Iron$/.test(t1), 'tab title, a step in under ten minutes: its countdown and the step (' + t1 + ')');
    await soon.page.close();
    const due = await openApp('&drug=0');
    await due.page.waitForTimeout(1500);
    const t2 = await due.page.title();
    ok(t2 === 'Now · Xanax #1 · Pumping Iron', 'tab title, a step due: "Now" and the step (' + t2 + ')');
    // Stacking for a chain: no step to do, the plain title.
    await due.page.evaluate(() => {
        window.GM_setValue('pumpingIron.v1.stackingChain', JSON.stringify({ since: Date.now() }));
        window.__pi.refresh();
    });
    await due.page.waitForTimeout(1500);
    const t3 = await due.page.title();
    ok(t3 === 'Pumping Iron', 'tab title, stacking: plain (' + t3 + ')');
    await due.page.close();
}

// Round 9 (the owner's pick 5B): Settings › Back up and restore. One file; the keys only with the tick; never the
// Discord login; a restore says what the file holds, asks, replaces, and leaves the keys and the login alone.
{
    const { page, errors } = await openApp('');
    const setGm = (k, v) => page.evaluate(([key, val]) => { window.GM_setValue('pumpingIron.v1.' + key, JSON.stringify(val)); window.__pi.refresh(); }, [k, v]);
    const getGm = (k) => page.evaluate((key) => { const v = _store['pumpingIron.v1.' + key]; return v === undefined ? null : JSON.parse(v); }, k);
    await setGm('settings', { timeFormat: 'local', oneOffs: { 77: true } });
    await setGm('worker', { base: 'https://worker.example', secret: 'DISCORD-LOGIN-SECRET' });
    await page.evaluate(() => { location.hash = 'settings'; });
    await page.waitForTimeout(600);
    let m = await measure(page);
    ok(['Back up and restore', 'Download backup', 'Restore from a file…', 'Put my API keys in the file', 'anyone with the file can use them', 'In the file', 'Last backup', 'never'].every((w) => m.text.includes(w)), 'backup: the card, with what is in the file and what never is');
    const keys = await page.evaluate(() => Object.entries(_store).filter(([k]) => /Key$/.test(k)).map(([, v]) => String(JSON.parse(v))).filter((v) => v && v.length >= 8));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('#pi-app button', { hasText: 'Download backup' }).click()]);
    const text = String(await readFile(await dl.path()));
    const file = JSON.parse(text);
    ok(/^pumping-iron-backup-\d{8}-\d{4}\.json$/.test(dl.suggestedFilename()), 'backup: the file is named ' + dl.suggestedFilename());
    ok(file.app === 'torn-pumping-iron' && file.gm.settings.timeFormat === 'local' && file.gm.settings.oneOffs['77'] === true && file.gm.plan && file.savedPlan && file.savedPlan.rev > 0 && file.savedPlan.days > 0, 'backup: the settings, the ticks on the Ledger, the build and the whole saved plan are in it (' + Object.keys(file.gm).join(',') + ' | ' + Object.keys(file.page).join(',') + ' | ' + (file.savedPlan ? Object.keys(file.savedPlan).slice(0, 8).join(',') : 'no saved plan') + ')');
    ok(keys.length > 0 && keys.every((k) => !text.includes(k)) && !text.includes('DISCORD-LOGIN-SECRET') && !text.includes('worker.example') && !('keys' in file), 'backup: no API key and no Discord login in the file (' + keys.length + ' keys checked)');
    await page.waitForTimeout(300);
    m = await measure(page);
    ok(m.text.includes('Saved pumping-iron-backup-') && !/Last backup\s*never/.test(m.text), 'backup: saved, and "Last backup" says when');
    // With the tick: the keys go in, the name says so, the tick goes off again.
    await page.locator('#pi-app label.check', { hasText: 'Put my API keys in the file' }).locator('input').check();
    const [dl2] = await Promise.all([page.waitForEvent('download'), page.locator('#pi-app button', { hasText: 'Download backup' }).click()]);
    const text2 = String(await readFile(await dl2.path()));
    ok(/-WITH-KEYS\.json$/.test(dl2.suggestedFilename()) && keys.some((k) => text2.includes(k)) && !text2.includes('DISCORD-LOGIN-SECRET'), 'backup with the tick: the keys are in, the name says so, the Discord login still is not (' + dl2.suggestedFilename() + ')');
    await page.waitForTimeout(300);
    const ticked = await page.evaluate(() => document.getElementById('pi-app').shadowRoot.querySelector('[data-card="backup"] input[type="checkbox"]').checked);
    ok(!ticked, 'backup with the tick: the tick is off again for the next one');
    // A file that is not ours is refused, and nothing changes.
    await page.locator('#pi-app input[aria-label="Backup file"]').setInputFiles({ name: 'other.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"something else"}') });
    await page.waitForTimeout(300);
    m = await measure(page);
    ok(m.text.includes('That file is not a Pumping Iron backup.') && !m.text.includes('Replace what this browser has'), 'restore: a file that is not ours is refused');
    // What changed since the backup: the time format, a ledger tick; the keys and the login must survive the restore.
    await setGm('settings', { timeFormat: 'torn', oneOffs: {} });
    const keyBefore = await getGm('apiKey');
    await page.locator('#pi-app input[aria-label="Backup file"]').setInputFiles({ name: dl.suggestedFilename(), mimeType: 'application/json', buffer: Buffer.from(text) });
    await page.waitForTimeout(400);
    m = await measure(page);
    ok(/Replace what this browser has with the backup of \w{3} \d+ \w{3}\?/.test(m.text) && m.text.includes('settings, your build and plan') && m.text.includes('Your keys here stay as they are.'), 'restore: it says the backup’s day and what it holds, and asks first');
    ok((await getGm('settings')).timeFormat === 'torn', 'restore: nothing is replaced before you say so');
    await page.screenshot({ path: resolve(shots, 'app-settings-backup.png'), fullPage: true });
    await page.locator('#pi-app button', { hasText: 'Replace with this backup' }).click();
    await page.waitForFunction(() => /Restored the backup of/.test(document.getElementById('pi-app').shadowRoot.textContent), null, { timeout: 8000 });
    const after = await page.evaluate(() => { const g = (k) => { const v = _store['pumpingIron.v1.' + k]; return v === undefined ? null : JSON.parse(v); }; return { settings: g('settings'), apiKey: g('apiKey'), worker: g('worker') }; });
    ok(after.settings.timeFormat === 'local' && after.settings.oneOffs['77'] === true, 'restore: the settings and the ledger ticks are the backup’s (' + JSON.stringify(after.settings).slice(0, 80) + ')');
    ok(after.apiKey === keyBefore && after.worker && after.worker.secret === 'DISCORD-LOGIN-SECRET', 'restore: the keys here and the Discord login are untouched');
    ok(errors.length === 0, 'backup: no page errors ' + JSON.stringify(errors.slice(0, 2)));
    await page.close();
}

await browser.close();
server.close();
console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
process.exit(failures ? 1 : 0);
