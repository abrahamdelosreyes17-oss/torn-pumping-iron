/*
 * Marks and overlay on saved Torn pages (test/fixtures), in a real browser,
 * with the built script and canned API answers (harness-live.html):
 *   - the gym page shows the strip, the outline, the panel and Fill N;
 *     Fill types N into Torn's box, makes no request, never clicks TRAIN;
 *   - the specialist stop ("Stop at 18 trains … Balboas") caps Fill;
 *   - items, bazaar, Item Market and points market outline the chosen thing;
 *   - the panel shows its step in the bar, opens the webpage, Alt+` collapses
 *     and expands it, a drag stays on screen and is remembered;
 *   - a hidden tab asks nothing; nothing loads from torn.com.
 *
 *   npm run build
 *   PWPATH=<dir>/node_modules/playwright-core SHOTS=<dir> node test/torn-check.mjs
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
// PORT=… when another check already serves 8783 (another worktree's run).
const PORT = Number(process.env.PORT) || 8783;

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

async function open(query, { wait = 4500, seed = null, width = 1280 } = {}) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    // What an earlier page stored (the next Torn page finds it): harness-live.html starts its store from it.
    if (seed) await page.addInitScript((s) => { window.__piSeed = s; }, seed);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    let tornHits = 0;
    await page.route(/torn\.com/, (r) => {
        tornHits++;
        r.abort();
    });
    await page.goto('http://127.0.0.1:' + PORT + '/test/harness-live.html?key=1&at=2026-09-29T10:48:00Z&wait=100000&plan=1&follow=steady&' + query);
    // SLOW=2 on a busy machine (other checks running): the page's first read and plan take longer than usual.
    await page.waitForTimeout(wait * (Number(process.env.SLOW) || 1));
    return { page, errors, tornHits: () => tornHits };
}

const text = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.replace(/\s+/g, ' ').trim()), sel);

/* Gym page: the friend right after Xanax #2 (275 energy) at Gun Shop. */
{
    const { page, errors, tornHits } = await open('page=gym&fixture=gym-friend&energy=275&build=balanced');
    const strip = (await text(page, '.pi-strip'))[0] || '';
    ok(strip.includes('Train DEX × 27 here') && strip.includes('Gun Shop · Balanced'), 'gym: strip says what to train here, the gym and the build (' + strip + ')');
    const stripState = await page.evaluate(() => { const s = document.querySelector('.pi-strip'); return s.getAttribute('data-pi-state') + ':' + s.classList.contains('pi-c-green'); });
    ok(stripState === 'right:true', 'gym: state A, the right gym: a green strip (' + stripState + ')');
    ok(/Force Training in [\d,]+ E/.test(strip), 'gym: next gym from the page\'s 80% (' + strip + ')');
    const on = await page.evaluate(() => [...document.querySelectorAll('li.pi-on')].map((li) => li.className.match(/(strength|speed|defense|dexterity)/)[1]));
    ok(on.length === 1 && on[0] === 'dexterity', 'gym: DEX outlined, and only DEX (' + on + ')');
    const mark = await page.evaluate(() => { const m = document.querySelector('li.pi-on .pi-statmark'); const t = document.querySelector('li.pi-on .pi-panel .pi-tab'); return m ? { cls: m.className, tab: t && t.textContent, color: getComputedStyle(m).borderTopColor, tabAbove: t ? t.getBoundingClientRect().top < m.getBoundingClientRect().top : null } : null; });
    ok(mark && /pi-c-green/.test(mark.cls) && /pi-glow/.test(mark.cls) && mark.color === 'rgb(63, 191, 90)', 'gym: the stat to train is outlined green with a glow (' + JSON.stringify(mark) + ')');
    ok(mark && /^Train this · 27 trains · about \+[\d,]+$/.test(mark.tab) && mark.tabAbove === false, 'gym: its tab "TRAIN THIS · 27 trains · about +…", inside the box, over nothing of Torn\'s (' + JSON.stringify(mark) + ')');
    const panel = (await text(page, 'li.pi-on .pi-panel'))[0] || '';
    ok(/27 trains/.test(panel) && /all your energy/.test(panel) && /Fill 27/.test(panel), 'gym: panel "27 trains · all your energy · Fill 27" (' + panel + ')');
    const fillBg = await page.evaluate(() => getComputedStyle(document.querySelector('li.pi-on .pi-fill')).backgroundColor);
    ok(fillBg === 'rgb(63, 191, 90)', 'gym: Fill is green (' + fillBg + ')');
    const corners = await text(page, '.pi-corner');
    ok(corners.includes('skip · over target') && corners.includes('tomorrow'), 'gym: the other stats get a small dark tag (' + corners.join(' | ') + ')');
    const here = await page.evaluate(() => [...document.querySelectorAll('[data-pi-gym]')].map((b) => b.getAttribute('data-pi-gym') + ':' + b.querySelector('[class*="gymIcon___"]').className.match(/gym-(\d+)/)[1] + ':' + getComputedStyle(b).outlineColor));
    ok(here.length === 1 && here[0] === 'right:18:rgb(63, 191, 90)', 'gym: Gun Shop, the gym you\'re in, a steady green outline (' + here + ')');
    const glows = await page.evaluate(() => ({ glow: document.querySelectorAll('.pi-glow').length, pulse: document.querySelectorAll('.pi-pulse').length }));
    ok(glows.glow === 1 && glows.pulse === 0, 'gym: one thing glows, nothing pulses (' + JSON.stringify(glows) + ')');
    const font = await page.evaluate(() => getComputedStyle(document.querySelector('.pi-strip b')).fontFamily);
    ok(/Segoe UI/.test(font), 'gym: our marks in Segoe UI / system-ui (' + font + ')');
    await page.evaluate(() => {
        window.__trainClicks = 0;
        for (const b of document.querySelectorAll('button[aria-label^="Train "]')) b.addEventListener('click', () => window.__trainClicks++);
        window.__callsBefore = window.__calls.length;
        window.__inputEvents = 0;
        document.querySelector('li[class*="dexterity___"] input').addEventListener('input', () => window.__inputEvents++);
    });
    await page.locator('li.pi-on .pi-fill').click();
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({ v: document.querySelector('li[class*="dexterity___"] input').value, train: window.__trainClicks, calls: window.__calls.length - window.__callsBefore, events: window.__inputEvents }));
    ok(after.v === '27', 'gym: Fill typed 27 into Torn\'s box (' + after.v + ')');
    ok(after.events >= 1, 'gym: an input event told React about it');
    ok(after.train === 0, 'gym: TRAIN was never clicked');
    ok(after.calls === 0, 'gym: Fill made no request');
    const pill = await page.evaluate(() => document.getElementById('pi-overlay').shadowRoot.querySelector('.head').textContent);
    ok(/Train DEX × 27/.test(pill), 'gym: the panel bar says "Train DEX × 27" (' + pill + ')');
    const stored = await page.evaluate(() => ({ u: JSON.parse(_store['pumpingIron.v1.unlockedGyms'] || 'null'), p: JSON.parse(_store['pumpingIron.v1.gymProgress'] || 'null') }));
    ok(stored.u && stored.u.length === 18 && stored.p && stored.p.nextId === 19 && stored.p.energy === Math.round(36610 * 0.8), 'gym: unlocked gyms and progress read from the page');
    // Torn shows 10 DEX trains (the box's value and the sidebar bar move): the page moves on at once, no API read needed.
    await page.evaluate(() => {
        const v = document.querySelector('li[class*="dexterity___"] [class*="propertyValue___"]');
        v.textContent = '83,230.00';
        document.querySelector('#barEnergy [class*="bar-value___"]').textContent = '175/150';
    });
    await page.waitForTimeout(500);
    const moved = (await text(page, 'li.pi-on .pi-panel'))[0] || '';
    ok(/17 trains left/.test(moved) && /Fill 17/.test(moved), 'gym: after 10 trains the panel says 17 left, Fill 17 (' + moved + ')');
    const sess = await page.evaluate(() => JSON.parse(_store['pumpingIron.v1.gymSession'] || 'null'));
    ok(sess && sess.parts && sess.parts.length === 1 && sess.spent.dex === 100, 'gym: the session snapshot counts the 100 energy spent on DEX (' + JSON.stringify(sess && sess.spent) + ')');
    ok(errors.length === 0, 'gym: no page errors ' + JSON.stringify(errors));
    ok(tornHits() === 0, 'gym: nothing loaded from torn.com');
    await page.screenshot({ path: resolve(shots, 'torn-gym-friend.png'), fullPage: true });
    await page.close();
}

/* Round 7 (D.4): a session trained on the gym page. Torn's page shows it at once (the stat box, the sidebar bars) and
   its API answers the new state: the panel moves to the next step within a few seconds (it waited for the next 30 s
   read: 7 to 26 s), with one state read and no click of ours. */
{
    const { page, errors } = await open('page=gym&fixture=gym-friend&energy=275&build=balanced', { wait: 9000 });
    const reads = () => page.evaluate(() => window.__calls.filter((c) => /\/v2\/user$/.test(c.split('?')[0])).length);
    const r0 = await reads();
    const t0 = Date.now();
    await page.evaluate(() => {
        document.querySelector('li[class*="dexterity___"] [class*="propertyValue___"]').textContent = '84,150.00';
        document.querySelector('#barEnergy [class*="bar-value___"]').textContent = '5/150';
        document.querySelector('#barHappy [class*="bar-value___"]').textContent = '4,965/5,025';
        window.__userPatch = (b) => { b.bars.energy.current = 5; b.bars.happy.current = 4965; b.battlestats.dexterity.value = 84150; b.battlestats.total = 409650; return b; };
    });
    let ms = null;
    for (let i = 0; i < 80 && ms === null; i++) {
        await page.waitForTimeout(100);
        const next = await page.evaluate(() => { const m = window.__pi.model(); return m && m.next ? { kind: m.next.kind, energy: m.strip.energy.current, trains: JSON.stringify(m.next.trains) } : null; });
        if (next && next.energy === 5) ms = Date.now() - t0;
    }
    ok(ms !== null && ms < 5000, 'roll-over: after a session the panel moves to the next step in ' + (ms === null ? 'more than 8 s' : (ms / 1000).toFixed(1) + ' s') + ' (was 7 to 26 s: the next 30 s read)');
    ok((await reads()) - r0 === 1, 'roll-over: with one state read (' + ((await reads()) - r0) + ')');
    const head = await page.evaluate(() => document.getElementById('pi-overlay').shadowRoot.querySelector('.head').textContent);
    ok(!/Train DEX × 27/.test(head) && !/Session done/.test(head) && /\d:\d\d/.test(head), 'roll-over: the panel bar shows the next step and its countdown, not "Session done" (' + head.replace(/\s+/g, ' ').trim() + ')');
    const card = await page.evaluate(() => document.getElementById('pi-overlay').shadowRoot.textContent.replace(/\s+/g, ' '));
    ok(/Session done\. Next: /.test(card), 'roll-over: the panel says the session is done and what is next (' + (card.match(/Session done\. Next: [^·]{0,60}/) || [''])[0] + ')');
    // A regeneration tick (energy +5, happy +5) is not an action: no read is asked for.
    const r1 = await reads();
    await page.evaluate(() => {
        document.querySelector('#barEnergy [class*="bar-value___"]').textContent = '10/150';
        document.querySelector('#barHappy [class*="bar-value___"]').textContent = '4,970/5,025';
    });
    await page.waitForTimeout(3500);
    ok((await reads()) - r1 === 0, 'roll-over: a regeneration tick asks for nothing');
    ok(errors.length === 0, 'roll-over: no page errors ' + JSON.stringify(errors));
    await page.close();
}

/* Round 6: the plan is made on a click and saved; the next Torn page follows it and works nothing out. */
{
    const first = await open('page=gym&fixture=gym-friend&energy=275&build=balanced', { wait: 6000 });
    const store = await first.page.evaluate(() => ({ ..._store }));
    await first.page.close();
    const saved = JSON.parse(store['pumpingIron.v1.planNow'] || 'null');
    ok(saved && saved.rev && saved.slim && saved.slim.steady, 'plan: Create plan saved the small part Torn pages follow (' + (saved ? Object.keys(saved.slim).length + ' plans' : 'none') + ')');
    ok(!store['pumpingIron.v1.compareCache'] && !store['pumpingIron.v1.compareBusy'], 'plan: no background comparison kept or run');
    const { page, errors } = await open('page=items&fixture=items&energy=275&build=balanced', { seed: store, wait: 4000 });
    const after = await page.evaluate(() => ({ pn: JSON.parse(_store['pumpingIron.v1.planNow'] || 'null'), ready: Boolean(window.__pi && window.__pi.model() && window.__pi.model().compare), ladder: window.__pi.model().ladder, busy: window.__pi.model().planBusy }));
    ok(after.ready, 'plan: the next page follows the saved plan at once');
    ok(after.pn && after.pn.rev === saved.rev && !after.busy, 'plan: the next page did not work a plan out');
    ok(after.ladder === null, 'plan: Torn pages skip what only the webpage shows (the energy ladder)');
    ok(errors.length === 0, 'plan: no page errors ' + JSON.stringify(errors));
    await page.close();
}

/* Gym page: the owner on Hank's, 1,000 energy at Gym 3000; the session's part is SPD at The Edge (SPD is the stat under its share). */
{
    const { page, errors } = await open('page=gym&fixture=gym-owner&who=owner&build=hank');
    const next = await page.evaluate(() => {
        const b = document.querySelector('[data-pi-gym="go"]');
        const ring = b && b.querySelector('.pi-ring.pi-pulse');
        return b ? { icon: b.querySelector('[class*="gymIcon___"]').className, label: ring && ring.title, outline: getComputedStyle(b).outlineColor, anim: ring && getComputedStyle(ring, '::after').animationName } : null;
    });
    ok(next && /gym-23/.test(next.icon) && /^Next: The Edge · SPD × \d+$/.test(next.label) && next.outline === 'rgb(63, 191, 90)', 'gym (Hank\'s): state B, The Edge\'s button is green and pulses (' + JSON.stringify(next) + ')');
    ok(next && next.anim === 'pi-pulse', 'gym (Hank\'s): the pulse runs (Animations on) (' + (next && next.anim) + ')');
    const wrong = await page.evaluate(() => { const b = document.querySelector('[data-pi-gym="wrong"]'); return b ? b.querySelector('[class*="gymIcon___"]').className.match(/gym-(\d+)/)[1] + ':' + getComputedStyle(b).outlineColor + ':' + b.querySelectorAll('.pi-pulse').length : null; });
    ok(wrong === '27:rgb(255, 107, 94):0', 'gym (Hank\'s): Gym 3000, where you are, a steady red outline (' + wrong + ')');
    const dim = await page.evaluate(() => document.querySelectorAll('li.pi-dim, .pi-dim').length);
    ok(dim === 0, 'gym (Hank\'s): Torn\'s stat boxes are never greyed (round 6) (' + dim + ')');
    const hint = (await text(page, '.pi-strip'))[0] || '';
    ok(/Wrong gym/.test(hint) && /you’re in Gym 3000 \(no SPD\) · switch to The Edge \(SPD [\d.]+\)/.test(hint), 'gym (Hank\'s): the strip says "Wrong gym · you\'re in Gym 3000 · switch to The Edge" (' + hint + ')');
    // Another script changing the gym page (not Torn's values): no redraw.
    const same = await page.evaluate(async () => {
        const strip = document.querySelector('.pi-strip');
        const root = document.getElementById('gymroot');
        for (let i = 0; i < 5; i++) {
            const x = document.createElement('div');
            x.className = 'tt-extra';
            root.appendChild(x);
            await new Promise((r) => setTimeout(r, 60));
        }
        await new Promise((r) => setTimeout(r, 400));
        return document.querySelector('.pi-strip') === strip;
    });
    ok(same, 'gym (Hank\'s): changes that are not Torn\'s values (another script) redraw nothing');
    const fills = await page.evaluate(() => document.querySelectorAll('.pi-fill:not(:disabled)').length);
    ok(fills === 0, 'gym (Hank\'s): no Fill to press in a gym the part isn\'t in');
    const clicks = await page.evaluate(() => document.querySelectorAll('.gymButton___3OFdI.selected___2PmTc').length && document.querySelector('.gymButton___3OFdI.selected___2PmTc [class*="gym-27"]') !== null);
    ok(clicks, 'gym (Hank\'s): we never switched gyms (Gym 3000 is still the one selected)');
    const card = await page.evaluate(() => document.getElementById('pi-overlay').shadowRoot.textContent.replace(/\s+/g, ' '));
    ok(/Wrong gym/.test(card) && /Switch to The Edge/.test(card), 'gym (Hank\'s): the panel says "Switch to The Edge" (' + card.slice(0, 120) + ')');
    ok(errors.length === 0, 'gym (Hank\'s): no page errors ' + JSON.stringify(errors));
    await page.screenshot({ path: resolve(shots, 'torn-gym-owner.png'), fullPage: true });
    // Settings › Animations off: the pulse is held still.
    await page.evaluate(() => {
        window.GM_setValue('pumpingIron.v1.settings', JSON.stringify({ motion: false }));
        // This tab's own write fires no change event here (Tampermonkey's are remote only): redraw as Settings' tab would.
        window.__pi.refresh();
    });
    await page.waitForTimeout(1500);
    const still = await page.evaluate(() => { const r = document.querySelector('[data-pi-gym="go"] .pi-ring'); return r ? r.classList.contains('pi-still') + ':' + getComputedStyle(r, '::after').animationName + ':' + getComputedStyle(r, '::after').opacity : null; });
    ok(still === 'true:none:0.7', 'gym (Hank\'s): Animations off, the pulse held still (' + still + ')');
    await page.close();
}

/* Items page: the Xanax the next step uses. */
{
    const { page, errors } = await open('page=items&fixture=items');
    const labels = await text(page, '.pi-outlined .pi-label');
    ok(labels.length >= 1 && /Step 1 of today · Xanax #1/.test(labels[0]), 'items: Xanax outlined with its step (' + labels.join(' | ') + ')');
    const onlyVisible = await page.evaluate(() => [...document.querySelectorAll('.pi-outlined')].every((el) => el.closest('ul').getAttribute('aria-expanded') === 'true'));
    ok(onlyVisible, 'items: only the list that shows is marked');
    ok(errors.length === 0, 'items: no page errors');
    await page.close();
}

/* Bazaar, Item Market, points market: the chosen listings. */
{
    const { page, errors } = await open('page=bazaar&userId=1234567&fixture=bazaar', { wait: 6000 });
    const labels = await text(page, '.pi-outlined .pi-label');
    ok(labels.some((l) => l === 'Take 3 · $2,479,500'), 'bazaar: Iron_Monk\'s Xanax outlined "Take 3 · $2,479,500" (' + labels.join(' | ') + ')');
    const pe = await page.evaluate(() => getComputedStyle(document.querySelector('.pi-label')).pointerEvents);
    ok(pe === 'none', 'bazaar: the label never takes the pointer');
    const tab = await page.evaluate(() => { const l = document.querySelector('.pi-label'); const s = getComputedStyle(l); return { tt: s.textTransform, bg: s.backgroundColor, glows: document.querySelectorAll('.pi-glow').length }; });
    ok(tab.tt === 'uppercase' && tab.bg === 'rgb(239, 235, 226)' && tab.glows === 1, 'bazaar: a chalk tab "TAKE 3 · $2,479,500", one thing glows (' + JSON.stringify(tab) + ')');
    await page.screenshot({ path: resolve(shots, 'torn-bazaar.png') });
    ok(errors.length === 0, 'bazaar: no page errors');
    await page.close();
}
{
    const { page } = await open('page=itemmarket&win=week&fixture=itemmarket#/market/view=search&itemID=206', { wait: 6000 });
    const labels = await text(page, '.pi-outlined .pi-label');
    ok(labels.some((l) => /^Take 3 · \$2,488,500$/.test(l)), 'item market: the $829,500 row outlined (' + labels.join(' | ') + ')');
    await page.close();
}
{
    const { page } = await open('page=points&fixture=pmarket', { wait: 6000 });
    const labels = await text(page, '.pi-outlined .pi-label');
    // Steady: a refill (30 points) a day for the 3-day window = 90, less the 45 held = 45 to buy.
    ok(labels.includes('Take 25 · $1,128,000') && labels.some((l) => /^Take 20 · /.test(l)), 'points: 25 + 20 from the two lots, the 45 held taken off (' + labels.join(' | ') + ')');
    await page.close();
}

/* The panel on any page: its bar, the body, Alt+` and a drag. */
{
    // 1600 wide: the free space beside Torn's page holds the full panel.
    const { page, errors } = await open('page=other', { width: 1600 });
    const q = (sel) => `document.getElementById('pi-overlay').shadowRoot.querySelector('${sel}')`;
    const bar = await page.evaluate(`${q('.head')}.textContent`);
    ok(/3:[45]\d\s*Xanax #1/.test(bar.replace(/\s+/g, ' ')), 'panel: countdown and step in the bar (' + bar + ')');
    const box = await page.evaluate(`(() => { const r = ${q('.head')}.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    ok(Math.abs(box.h - 36) <= 1, 'panel: bar 36 px tall (' + box.h + ')');
    const body = await page.evaluate(`({ shown: getComputedStyle(${q('.body')}).display !== 'none', text: ${q('.body')}.textContent, go: ${q('.cta.go')} && ${q('.cta.go')}.getAttribute('href'), goText: ${q('.cta')}.textContent, ctas: ${q('.body')}.querySelectorAll('.cta').length })`);
    ok(body.shown && /Take Xanax #1, then train (STR|SPD|DEF|DEX)/.test(body.text), 'panel: expanded by default with the step');
    ok(body.ctas === 1 && body.goText === 'Open Items' && body.go === 'https://www.torn.com/item.php', 'panel: one action button, "Open Items" for the Xanax (' + JSON.stringify(body) + ')');
    const look = await page.evaluate(`(() => { const w = ${q('.wrap')}; const s = getComputedStyle(w); return { bg: s.backgroundColor, tone: w.getAttribute('data-tone'), font: s.fontFamily }; })()`);
    ok(look.bg === 'rgb(16, 18, 20)' && /Segoe UI/.test(look.font), 'panel: near-black, Segoe UI (' + JSON.stringify(look) + ')');
    ok(look.tone === '', 'panel: no chalk edge while the step is still ahead (' + look.tone + ')');
    await page.locator('#pi-overlay .open').click();
    const opened = await page.evaluate(() => window.__opened || []);
    ok(opened[0] === 'https://abrahamdelosreyes17-oss.github.io/torn-pumping-iron/app.html', 'panel: Open Pumping Iron opens the webpage in a new tab');
    await page.keyboard.press('Alt+Backquote');
    await page.waitForTimeout(100);
    const collapsed = await page.evaluate(`({ body: getComputedStyle(${q('.body')}).display, saved: _store['pumpingIron.v1.overlayCollapsed'] })`);
    ok(collapsed.body === 'none' && collapsed.saved === 'true', 'Alt+` collapses it to the bar, and it is remembered (' + JSON.stringify(collapsed) + ')');
    await page.mouse.click(box.x + 60, box.y + 18);
    await page.waitForTimeout(100);
    ok((await page.evaluate(`getComputedStyle(${q('.body')}).display`)) !== 'none', 'a click on the collapsed bar expands it');
    await page.keyboard.press('Alt+Backquote');
    await page.keyboard.press('Alt+Backquote');
    ok((await page.evaluate(`getComputedStyle(${q('.body')}).display`)) !== 'none', 'Alt+` again expands it');
    // Drag by the bar far off the bottom-right: it stays on screen and the spot is saved.
    await page.mouse.move(box.x + 60, box.y + 18);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 200, { steps: 5 });
    await page.mouse.move(5000, 5000, { steps: 5 });
    await page.mouse.up();
    const after = await page.evaluate(`(() => { const r = ${q('.wrap')}.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, vw: innerWidth, vh: innerHeight, pos: JSON.parse(_store['pumpingIron.v1.overlayPos'] || 'null') }; })()`);
    ok(after.r <= after.vw && after.y + 36 <= after.vh && after.pos && after.pos.side, 'drag: stays on screen, spot saved (' + JSON.stringify(after) + ')');
    ok(after.x >= 1288 || after.r <= 312, 'drag: still beside Torn\'s page, never over it (' + JSON.stringify(after) + ')');
    ok(errors.length === 0, 'panel: no page errors');
    // Narrower windows: it sizes itself to the free space beside Torn's page instead of going over it (the owner).
    for (const [w, tier] of [[1440, 'narrow'], [1280, 'compact'], [1100, 'mini']]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(400);
        const fit = await page.evaluate(`(() => { const w = ${q('.wrap')}; const r = w.getBoundingClientRect(); return { fit: w.getAttribute('data-fit'), folded: w.classList.contains('collapsed'), l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), font: getComputedStyle(w).fontSize }; })()`);
        const pageL = (w - 976) / 2;
        const clear = fit.r <= pageL || fit.l >= pageL + 976 || (tier === 'mini' && fit.t <= 4 + 1);
        ok(fit.fit === tier && clear && (tier === 'narrow' ? !fit.folded && fit.font === '12px' : fit.folded), 'fit at ' + w + ' px: ' + tier + ', never over Torn\'s page (' + JSON.stringify(fit) + ')');
        await page.screenshot({ path: resolve(shots, 'torn-panel-' + w + '.png') });
    }
    await page.close();
}

/* Torn Eye: a profile chip with its card, the mini-profile, war mode, the attack page. */
{
    const { page, errors, tornHits } = await open('page=profile&XID=605123&fixture=profile&ffs=1&who=owner', { wait: 6000 });
    const chip = (await text(page, '.content-title + .pi-chip'))[0] || '';
    ok(/^Stomp/.test(chip) && /win 100%/.test(chip) && /FFScouter 3 d/.test(chip), 'eye: profile chip after the title (' + chip + ')');
    ok(!/FF|fair fight/i.test(chip), 'eye: never says FF or fair fight');
    const box = await page.locator('.content-title + .pi-chip').boundingBox();
    await page.mouse.move(box.x + 20, box.y + 10);
    await page.waitForTimeout(200);
    const card = (await text(page, '.pi-eyecard'))[0] || '';
    ok(/HP you keep, by their likely build/.test(card) && /FFScouter/.test(card), 'eye: hover card with builds and the FFScouter credit');
    // Round 6 (owner): Torn's pages ask only about the player viewed or attacked; a mini-profile shows what is known.
    const mini = (await text(page, '#profile-mini-root .pi-chip'))[0] || '';
    ok(mini.length > 0, 'eye: mini-profile chip from what is known (' + mini + ')');
    const asked = await page.evaluate(() => window.__calls.filter((c) => /\/user\/\d+\/profile/.test(c)).map((c) => c.match(/\/user\/(\d+)\//)[1]));
    ok(asked.every((id) => id === '605123'), 'eye: the only player asked about is the one viewed (' + [...new Set(asked)] + ')');
    ok(errors.length === 0, 'eye: no page errors ' + JSON.stringify(errors));
    ok(tornHits() === 0, 'eye: nothing loaded from torn.com');
    await page.screenshot({ path: resolve(shots, 'torn-eye-profile.png'), fullPage: true });
    await page.close();
}
{
    // Round 7 (I.1): the rows show what is already known and ask nothing. Known here: Rival, whose profile was opened
    // first (this site's own stored estimate), and Flyer, whom the Torn Eye tab's war mode judged (the shared table).
    const warBands = { at: Date.parse('2026-09-29T10:40:00Z'), fid: 7777, p: { 515151: ['cant', 3, null], 605123: ['stomp', 100, 97] } };
    const { page, errors } = await open('page=profile&XID=424242&fixture=profile&ffs=1&who=owner', { wait: 8000, seed: { 'pumpingIron.v1.eyeWarBands': JSON.stringify(warBands) } });
    await page.goto('http://127.0.0.1:' + PORT + '/test/harness-live.html?key=1&at=2026-09-29T10:48:00Z&wait=100000&plan=1&follow=steady&page=faction&ID=7777&fixture=faction&ffs=1&who=owner');
    await page.waitForTimeout(6500);
    // Shown order (CSS order on Torn's rows; the DOM itself is untouched).
    const order = await page.evaluate(() => [...document.querySelectorAll('#faction_war_list_id li.enemy')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((li) => li.querySelector('.member a[href*="XID"]').getAttribute('aria-label').replace('View profile of ', '')));
    const domOrder = await page.evaluate(() => [...document.querySelectorAll('#faction_war_list_id li.enemy .member a[href*="XID"]')].map((a) => a.getAttribute('aria-label').replace('View profile of ', '')));
    ok(JSON.stringify(domOrder) === JSON.stringify(['Flyer', 'Mira_Vex', 'Rival', 'Brix']), "war: Torn's rows are not moved in the page");
    ok(order[0] === 'Rival' && order[3] === 'Flyer', 'war: Okay first, Traveling last, from what the page shows (' + order + ')');
    const sum = (await text(page, '.pi-warsum'))[0] || '';
    ok(/1 attackable now/.test(sum) && /1 traveling/.test(sum) && /live war mode on Pumping Iron’s Torn Eye tab/.test(sum), 'war: summary line (' + sum + ')');
    const chips = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('#faction_war_list_id li.enemy')].map((li) => [li.querySelector('.member a[href*="XID"]').getAttribute('aria-label').replace('View profile of ', ''), (li.querySelector('.pi-chip') || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim()])));
    ok(/^(Stomp|Good|Tough|Can't win)/.test(chips.Rival), 'war: the estimate stored by an earlier page shows on its row (' + chips.Rival + ')');
    ok(/^Can't win/.test(chips.Flyer), 'war: a player only war mode judged shows its band (' + chips.Flyer + ')');
    ok(chips.Mira_Vex === '' && chips.Brix === '', 'war: no chip where nothing is known, never "No data" (' + JSON.stringify(chips) + ')');
    const flyerChip = page.locator('#faction_war_list_id li.enemy .pi-chip[data-pi-player="515151"]');
    await flyerChip.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const flyer = await flyerChip.boundingBox();
    await page.mouse.move(flyer.x + 10, flyer.y + 8);
    await page.waitForTimeout(200);
    const warCard = (await text(page, '.pi-eyecard'))[0] || '';
    ok(/Win 3%/.test(warCard) && /From war mode on Pumping Iron’s Torn Eye tab, 8 min ago/.test(warCard), 'war: its card says where the band came from (' + warCard + ')');
    await page.mouse.move(5, 5);
    const yours = await page.evaluate(() => document.querySelectorAll('#faction_war_list_id li.your .pi-chip').length);
    ok(yours === 0, 'war: your own side is left alone');
    const memberChips = await page.evaluate(() => document.querySelectorAll('.members-list .table-body .pi-chip').length);
    ok(memberChips === 1, 'faction list: a chip on the member something is known about, none on the others or the fallen one (' + memberChips + ')');
    // Round 6 (owner): no Torn Eye reads for faction or war lists on Torn's pages (the Torn Eye tab does war mode).
    const calls = await page.evaluate(() => window.__calls.filter((c) => /faction|\/profile|get-stats/.test(c)).length);
    ok(calls === 0, 'war: nothing asked on a faction page (' + calls + ')');
    ok(errors.length === 0, 'war: no page errors ' + JSON.stringify(errors));
    await page.screenshot({ path: resolve(shots, 'torn-eye-war.png'), fullPage: true });
    await page.close();
}
{
    const { page, errors } = await open('page=attack&user2ID=424242&fixture=attack&ffs=1&who=owner', { wait: 6000 });
    const panel = () => page.evaluate(() => document.getElementById('pi-attack').shadowRoot.querySelector('.panel').textContent);
    const before = await panel();
    ok(/Torn Eye/.test(before) && /(Stomp|Good|Tough|Can't win)/.test(before) && /isn.t shown yet/.test(before), 'attack: panel before Start Fight (' + before.slice(0, 90) + ')');
    await page.evaluate(() => fetch('fixtures/attackData.json?sid=attackData').then((r) => r.json()));
    await page.waitForTimeout(2200); // the cache is written 1.5 s after the last change
    const after = await panel();
    ok(/saved for next time/.test(after) && /AK-47/.test(after), 'attack: gear read from attackData and saved (' + after.slice(0, 160) + ')');
    const stored = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('pumpingIron', 1); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readonly'); const g = tx.objectStore('kv').get('eye'); g.onsuccess = () => res(g.result && g.result.gear && Object.keys(g.result.gear)); }; r.onerror = () => res(null); }));
    ok(Array.isArray(stored) && stored.includes('424242'), 'attack: gear kept in IndexedDB for next time');
    ok(errors.length === 0, 'attack: no page errors ' + JSON.stringify(errors));
    await page.screenshot({ path: resolve(shots, 'torn-eye-attack.png'), fullPage: true });
    await page.close();
}

/* Taking turns: Torn Trading's panel shows up → paused (no calls, no marks, a warning panel); gone a minute → back. */
{
    const { page, errors } = await open('page=gym&fixture=gym-friend&energy=275&build=balanced');
    const marksBefore = await page.evaluate(() => document.querySelectorAll('li.pi-on').length);
    ok(marksBefore === 1, 'turns: marks drawn before Torn Trading shows up (' + marksBefore + ')');
    // Torn Trading's panel mounts after ours (a stand-in #ttv2-host).
    await page.evaluate(() => {
        const d = document.createElement('div');
        d.id = 'ttv2-host';
        document.body.appendChild(d);
    });
    await page.waitForTimeout(1500);
    const n1 = await page.evaluate(() => window.__calls.length);
    const state = await page.evaluate(() => {
        const sh = document.getElementById('pi-overlay').shadowRoot;
        return { paused: sh.querySelector('.wrap').classList.contains('paused'), head: sh.querySelector('.head').textContent, body: sh.querySelector('.body').textContent, marks: document.querySelectorAll('li.pi-on, .pi-strip, .pi-panel').length };
    });
    ok(state.paused && /Paused · Torn Trading is on/.test(state.head), 'turns: the panel shows the warning sign (' + state.head + ')');
    ok(/Still seen in 1 tab: Gym\./.test(state.body) && /Reload or close it\. Pumping Iron starts again 60 s after the last one\./.test(state.body) && /Last seen\d+ s ago/.test(state.body), 'turns: the amber card says where Torn Trading is still seen, and when (' + state.body + ')');
    ok(state.marks === 0, 'turns: nothing of ours left on Torn’s page (' + state.marks + ')');
    await page.screenshot({ path: resolve(shots, 'torn-paused.png') });
    await page.waitForTimeout(6000);
    const n2 = await page.evaluate(() => window.__calls.length);
    ok(n2 === n1, 'turns: no request while paused (' + (n2 - n1) + ')');
    // The open bug, its cause: Torn Trading turned off in Tampermonkey stays in a tab opened before (its host too),
    // so that tab marks it seen again: last seen over a minute ago, and paused again within one look (5 s).
    await page.evaluate(() => window.GM_setValue('pumpingIron.v1.tradingSeenAt', JSON.stringify(Date.now() - 61000)));
    await page.waitForTimeout(5500);
    const again = await page.evaluate(() => document.getElementById('pi-overlay').shadowRoot.querySelector('.wrap').classList.contains('paused'));
    ok(again, 'turns (cause): a tab that still has Torn Trading keeps the pause on; the card names it instead of promising a minute');
    // That tab reloaded or closed: its host gone. The card counts down from the last time it was seen.
    await page.evaluate(() => document.getElementById('ttv2-host').remove());
    await page.waitForTimeout(6000);
    const gone = await page.evaluate(() => document.getElementById('pi-overlay').shadowRoot.querySelector('.body').textContent);
    ok(/Torn Trading isn’t seen any more\. Starting again in \d:\d\d\./.test(gone), 'turns: once it is gone the card counts down (' + gone + ')');
    // Last seen over a minute ago.
    await page.evaluate(() => window.GM_setValue('pumpingIron.v1.tradingSeenAt', JSON.stringify(Date.now() - 61000)));
    await page.waitForTimeout(6000);
    const back = await page.evaluate(() => ({ paused: document.getElementById('pi-overlay').shadowRoot.querySelector('.wrap').classList.contains('paused'), marks: document.querySelectorAll('li.pi-on').length }));
    ok(!back.paused && back.marks === 1, 'turns: back by itself, marks drawn again (' + JSON.stringify(back) + ')');
    ok(errors.length === 0, 'turns: no page errors ' + JSON.stringify(errors));
    await page.close();
}

/* The attack page: the panel folds to one line directly under Torn Eye's fight card (#pi-eyecard), never on top of it. */
{
    const { page, errors } = await open('page=attack&user2ID=424242&fixture=attack&ffs=1&who=owner', { wait: 5000 });
    // Torn Eye's card (its builder's #pi-eyecard; a stand-in where this build has none).
    await page.evaluate(() => {
        if (document.getElementById('pi-eyecard')) return;
        const d = document.createElement('div');
        d.id = 'pi-eyecard';
        d.style.cssText = 'position:fixed;right:20px;top:90px;width:300px;height:260px;background:#101214;border:1px solid #3a4046;border-radius:10px;z-index:2147482000';
        document.body.appendChild(d);
    });
    await page.waitForTimeout(1600);
    const dock = await page.evaluate(() => {
        const c = document.getElementById('pi-eyecard').getBoundingClientRect();
        const w = document.getElementById('pi-overlay').shadowRoot.querySelector('.wrap');
        const r = w.getBoundingClientRect();
        return { card: { l: Math.round(c.left), b: Math.round(c.bottom), w: Math.round(c.width) }, wrap: { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }, folded: w.classList.contains('collapsed') };
    });
    const overlaps = dock.wrap.t < dock.card.b && dock.wrap.t + dock.wrap.h > dock.card.b - 260;
    ok(dock.folded && dock.wrap.t >= dock.card.b && dock.wrap.t - dock.card.b <= 10 && !overlaps && dock.wrap.l === dock.card.l && dock.wrap.w === dock.card.w, 'attack: the panel folds to one line under the fight card, never over it (' + JSON.stringify(dock) + ')');
    const saved = await page.evaluate(() => _store['pumpingIron.v1.overlayCollapsed'] || null);
    ok(saved !== 'true', 'attack: folding there is not saved as your choice (' + saved + ')');
    // No fight card: the usual panel.
    await page.evaluate(() => document.getElementById('pi-eyecard').remove());
    await page.waitForTimeout(1600);
    const free = await page.evaluate(() => { const w = document.getElementById('pi-overlay').shadowRoot.querySelector('.wrap'); const r = w.getBoundingClientRect(); const c = (document.querySelector('.content-wrapper') || document.body).getBoundingClientRect(); return !w.classList.contains('docked') && (r.right <= c.left + 1 || r.left >= c.right - 1 || (w.getAttribute('data-fit') === 'mini' && r.top <= 5)); });
    ok(free, 'attack: without the card the panel is back to normal');
    ok(errors.length === 0, 'attack dock: no page errors ' + JSON.stringify(errors));
    await page.close();
}

/* A hidden tab asks Torn nothing. */
{
    const { page } = await open('page=gym&fixture=gym-friend&hidden=1', { wait: 5000 });
    const calls = await page.evaluate(() => window.__calls.length);
    ok(calls === 0, 'hidden tab: no requests (' + calls + ')');
    await page.close();
}

await browser.close();
server.close();
console.log(failures ? failures + ' FAILED' : 'ALL PASSED');
process.exit(failures ? 1 : 0);
