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
}).listen(8783);

const browser = await chromium.launch({ channel: process.env.PWCHANNEL || 'msedge' });
let failures = 0;
const ok = (cond, msg) => {
    console.log((cond ? 'PASS ' : 'FAIL ') + msg);
    if (!cond) failures++;
};

async function open(query, { wait = 4500, seed = null } = {}) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    // What an earlier page stored (the next Torn page finds it): harness-live.html starts its store from it.
    if (seed) await page.addInitScript((s) => { window.__piSeed = s; }, seed);
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    let tornHits = 0;
    await page.route(/torn\.com/, (r) => {
        tornHits++;
        r.abort();
    });
    await page.goto('http://127.0.0.1:8783/test/harness-live.html?key=1&at=2026-09-29T10:48:00Z&wait=100000&plan=1&follow=steady&' + query);
    await page.waitForTimeout(wait);
    return { page, errors, tornHits: () => tornHits };
}

const text = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.textContent.replace(/\s+/g, ' ').trim()), sel);

/* Gym page: the friend right after Xanax #2 (275 energy) at Gun Shop. */
{
    const { page, errors, tornHits } = await open('page=gym&fixture=gym-friend&energy=275&build=balanced');
    const strip = (await text(page, '.pi-strip'))[0] || '';
    ok(strip.includes('Balanced') && strip.includes('Gun Shop: DEX × 27'), 'gym: strip names the build and the session\'s parts (' + strip + ')');
    const cur = (await text(page, '.pi-strip .pi-part.pi-cur'))[0] || '';
    ok(cur === 'Gun Shop: DEX × 27', 'gym: the current part is the bright one (' + cur + ')');
    ok(/Force Training in [\d,]+ E/.test(strip), 'gym: next gym from the page\'s 80% (' + strip + ')');
    const on = await page.evaluate(() => [...document.querySelectorAll('li.pi-on')].map((li) => li.className.match(/(strength|speed|defense|dexterity)/)[1]));
    ok(on.length === 1 && on[0] === 'dexterity', 'gym: DEX outlined, and only DEX (' + on + ')');
    const panel = (await text(page, 'li.pi-on .pi-panel'))[0] || '';
    ok(/27 trains/.test(panel) && /all your energy/.test(panel) && /Fill 27/.test(panel), 'gym: panel "27 trains · all your energy · Fill 27" (' + panel + ')');
    const greys = await text(page, '.pi-grey');
    ok(greys.some((g) => /over target/.test(g)), 'gym: over-target stats get a grey word (' + greys.join(' | ') + ')');
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
        const b = document.querySelector('.gymButton___3OFdI.pi-outlined');
        return b ? { icon: b.querySelector('[class*="gymIcon___"]').className, label: (b.querySelector('.pi-label') || {}).textContent } : null;
    });
    ok(next && /gym-23/.test(next.icon) && /^Next: The Edge · SPD × \d+$/.test(next.label), 'gym (Hank\'s): The Edge\'s button is outlined with "Next: The Edge · SPD × N" (' + JSON.stringify(next) + ')');
    const dim = await page.evaluate(() => document.querySelectorAll('li.pi-dim, .pi-dim').length);
    ok(dim === 0, 'gym (Hank\'s): Torn\'s stat boxes are never greyed (round 6) (' + dim + ')');
    const hint = await page.evaluate(() => [...document.querySelectorAll('.pi-strip .pi-hint')].map((e) => e.textContent).join(' '));
    ok(/This session trains at The Edge: open it · then SPD × \d+/.test(hint), 'gym (Hank\'s): one line in the strip says where this session trains (' + hint + ')');
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
    const fills = await page.evaluate(() => document.querySelectorAll('.pi-fill').length);
    ok(fills === 0, 'gym (Hank\'s): no Fill in a gym the part isn\'t in');
    const clicks = await page.evaluate(() => document.querySelectorAll('.gymButton___3OFdI.selected___2PmTc').length && document.querySelector('.gymButton___3OFdI.selected___2PmTc [class*="gym-27"]') !== null);
    ok(clicks, 'gym (Hank\'s): we never switched gyms (Gym 3000 is still the one selected)');
    ok(errors.length === 0, 'gym (Hank\'s): no page errors ' + JSON.stringify(errors));
    await page.screenshot({ path: resolve(shots, 'torn-gym-owner.png'), fullPage: true });
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
    const { page, errors } = await open('page=other');
    const q = (sel) => `document.getElementById('pi-overlay').shadowRoot.querySelector('${sel}')`;
    const bar = await page.evaluate(`${q('.head')}.textContent`);
    ok(/3:[45]\d\s*Xanax #1/.test(bar.replace(/\s+/g, ' ')), 'panel: countdown and step in the bar (' + bar + ')');
    const box = await page.evaluate(`(() => { const r = ${q('.head')}.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    ok(Math.abs(box.h - 36) <= 1, 'panel: bar 36 px tall (' + box.h + ')');
    const body = await page.evaluate(`({ shown: getComputedStyle(${q('.body')}).display !== 'none', text: ${q('.body')}.textContent })`);
    ok(body.shown && /Take Xanax #1, then train (STR|SPD|DEF|DEX)/.test(body.text) && /Open Pumping Iron/.test(body.text), 'panel: expanded by default with the step and the link');
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
    ok(errors.length === 0, 'panel: no page errors');
    await page.close();
}

/* Torn Eye (round 7, mockups/round7/overlays.html): the profile card in the free space beside Torn's page (full,
   narrower, smallest, the left side), the mini-profile's last line, war and faction rows untouched with an edge and
   a tag on our own layer, the attack page's fight card (#pi-eyecard). The fixtures carry no Torn CSS: Torn's layout
   (a 182 px sidebar and the 784 px content, 976 px centred) is put in by tornLayout(). */
async function tornLayout(page, shift = 0) {
    await page.evaluate((sh) => {
        let st = document.getElementById('torn-layout');
        if (!st) {
            st = document.createElement('style');
            st.id = 'torn-layout';
            document.head.appendChild(st);
        }
        st.textContent = '#out{display:none} .content-wrapper{box-sizing:border-box;width:784px;margin:0 0 0 calc(50% - 296px + ' + sh + 'px)!important;background:#191919} #sidebarroot{position:absolute;top:40px;left:calc(50% - 488px + ' + sh + 'px);width:182px;height:400px;background:#222}';
        if (!document.getElementById('sidebarroot')) {
            const s = document.createElement('div');
            s.id = 'sidebarroot';
            document.body.prepend(s);
        }
        dispatchEvent(new Event('resize'));
    }, shift);
    await page.waitForTimeout(300);
}
const overlaps = (a, b) => Boolean(a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom);
const rectOf = (page, sel) => page.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }, sel);
const tornRect = async (page) => {
    const c = await rectOf(page, '.content-wrapper');
    const s = await rectOf(page, '#sidebarroot');
    return { left: Math.min(c.left, s.left), right: Math.max(c.right, s.right) };
};
const glows = (page) => page.evaluate(() => document.querySelectorAll('.pi-glow').length);
const panelRect = (page) => page.evaluate(() => { const h = document.getElementById('pi-overlay'); const w = h && h.shadowRoot && h.shadowRoot.querySelector('.wrap'); if (!w) return null; const r = w.getBoundingClientRect(); return r.width ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom } : null; });
{
    const { page, errors, tornHits } = await open('page=profile&XID=605123&fixture=profile&ffs=1&who=owner', { wait: 6000 });
    const card = () => page.evaluate(() => {
        const c = document.querySelector('#pi-eye-layer [data-pi-part="profile"] .pi-card');
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { mode: c.getAttribute('data-pi-mode'), text: c.textContent.replace(/\s+/g, ' ').trim(), left: r.left, right: r.right, top: r.top, bottom: r.bottom, titleTop: document.querySelector('.content-title').getBoundingClientRect().top, font: getComputedStyle(c.querySelector('.pi-band')).fontFamily };
    });
    for (const [w, mode, side, shift] of [[1600, 'full', 'right', 0], [1366, 'mid', 'right', 0], [1280, 'small', 'right', 0], [1440, 'full', 'left', 120]]) {
        await page.setViewportSize({ width: w, height: 900 });
        await tornLayout(page, shift);
        const c = await card();
        const torn = await tornRect(page);
        ok(c && c.mode === mode, 'eye profile ' + w + ' px: the ' + mode + ' card (' + (c && c.mode) + ', free ' + Math.round(side === 'right' ? w - torn.right : torn.left) + ' px)');
        if (!c) continue;
        ok(side === 'right' ? c.left >= torn.right && c.right <= w : c.right <= torn.left && c.left >= 0, 'eye profile ' + w + ' px: in the free space on the ' + side + ', never on Torn’s page (' + Math.round(c.left) + '–' + Math.round(c.right) + ', Torn ' + Math.round(torn.left) + '–' + Math.round(torn.right) + ')');
        ok(Math.abs(c.top - c.titleTop) <= 2, 'eye profile ' + w + ' px: level with the profile title (' + Math.round(c.top) + ' vs ' + Math.round(c.titleTop) + ')');
        ok(/Segoe UI|system-ui/.test(c.font.split(',')[0]), 'eye profile: Segoe UI / system-ui (' + c.font + ')');
        // Docking the panel under #pi-eyecard is the panel's side (src/ui/overlay.js): reported here, not failed.
        const pr = await panelRect(page);
        if (overlaps(c, pr)) console.log('NOTE eye profile ' + w + ' px: the training panel COVERS the card (panel ' + JSON.stringify(pr) + ')');
        if (mode === 'full' && side === 'right') {
            ok(/^Stomp/.test(c.text) && /FFScouter 3 d/.test(c.text) && /Watch/.test(c.text), 'eye profile: full card with the band, the source and Watch (' + c.text + ')');
            const i = [c.text.indexOf('Respect'), c.text.indexOf('HP kept'), c.text.indexOf('Win')];
            ok(i[0] >= 0 && i[0] < i[1] && i[1] < i[2] && /Win\s?100%/.test(c.text), 'eye profile: respect, HP kept, win in that order (' + i + ')');
            ok(!/\bFF\b|fair fight/i.test(c.text), 'eye: never says FF or fair fight');
        }
        if (mode === 'small') {
            ok(/^Stomp\s?Resp/.test(c.text) && !/FFScouter|Watch/.test(c.text), 'eye profile: the smallest card is the band word and the three numbers (' + c.text + ')');
            const box = await page.locator('#pi-eye-layer .pi-card').boundingBox();
            await page.mouse.move(box.x + 20, box.y + 10);
            await page.waitForTimeout(200);
            const hover = (await text(page, '.pi-hovercard'))[0] || '';
            ok(/HP you keep, by their likely build/.test(hover) && /FFScouter/.test(hover), 'eye profile: hovering the smallest card shows the builds and the FFScouter credit');
            const hr = await rectOf(page, '.pi-hovercard');
            ok(hr && hr.left >= torn.right && hr.right <= w, 'eye profile: the hover card fits the free space too, never over Torn’s page (' + JSON.stringify(hr) + ')');
            await page.mouse.move(5, 5);
        }
        await page.screenshot({ path: resolve(shots, 'torn-eye-profile-' + w + '-' + mode + '-' + side + '.png') });
    }
    ok((await glows(page)) <= 1, 'eye profile: at most one thing glows (' + (await glows(page)) + ')');
    // Round 6 (owner): Torn's pages ask only about the player viewed or attacked; a mini-profile shows what is known.
    const mini = await page.evaluate(() => {
        const m = document.querySelector('#profile-mini-root .pi-mini-line');
        if (!m) return null;
        const r = m.getBoundingClientRect();
        const p = document.querySelector('#profile-mini-root .mini-profile-wrapper').getBoundingClientRect();
        return { text: m.textContent.replace(/\s+/g, ' ').trim(), inside: r.left >= p.left - 0.5 && r.right <= p.right + 0.5, last: m.parentNode.lastElementChild === m };
    });
    ok(mini && mini.text.length > 0 && mini.inside && mini.last, 'eye: the mini-profile gets one tag as its last line, inside its width (' + JSON.stringify(mini) + ')');
    const asked = await page.evaluate(() => window.__calls.filter((c) => /\/user\/\d+\/profile/.test(c)).map((c) => c.match(/\/user\/(\d+)\//)[1]));
    ok(asked.every((id) => id === '605123'), 'eye: the only player asked about is the one viewed (' + [...new Set(asked)] + ')');
    ok(errors.length === 0, 'eye: no page errors ' + JSON.stringify(errors));
    ok(tornHits() === 0, 'eye: nothing loaded from torn.com');
    await page.close();
}
{
    // Round 7 (I.1): the rows show what is already known and ask nothing. Known here: Rival, whose profile was opened
    // first (this site's own stored estimate), Flyer, whom the Torn Eye tab's war mode judged a fight you lose, and
    // Brix (in hospital), judged Good.
    const warBands = { at: Date.parse('2026-09-29T10:40:00Z'), fid: 7777, p: { 515151: ['low', 3, null], 605123: ['stomp', 100, 97], 777001: ['good', 92, 81] } };
    const { page, errors } = await open('page=profile&XID=424242&fixture=profile&ffs=1&who=owner', { wait: 8000, seed: { 'pumpingIron.v1.eyeWarBands': JSON.stringify(warBands) } });
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.goto('http://127.0.0.1:8783/test/harness-live.html?key=1&at=2026-09-29T10:48:00Z&wait=100000&plan=1&follow=steady&page=faction&ID=7777&fixture=faction&ffs=1&who=owner');
    await page.waitForTimeout(6500);
    await tornLayout(page);
    // Shown order (CSS order on Torn's rows; the DOM itself is untouched).
    const order = await page.evaluate(() => [...document.querySelectorAll('#faction_war_list_id li.enemy')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((li) => li.querySelector('.member a[href*="XID"]').getAttribute('aria-label').replace('View profile of ', '')));
    const domOrder = await page.evaluate(() => [...document.querySelectorAll('#faction_war_list_id li.enemy .member a[href*="XID"]')].map((a) => a.getAttribute('aria-label').replace('View profile of ', '')));
    ok(JSON.stringify(domOrder) === JSON.stringify(['Flyer', 'Mira_Vex', 'Rival', 'Brix']), "war: Torn's rows are not moved in the page");
    ok(order[0] === 'Rival' && order[3] === 'Flyer', 'war: Okay first, Traveling last, from what the page shows (' + order + ')');
    const inside = await page.evaluate(() => document.querySelectorAll('#faction_war_list_id .pi-mark, .members-list .pi-mark').length + [...document.querySelectorAll('#faction_war_list_id li, .members-list li')].filter((li) => /\bpi-/.test(li.className)).length);
    ok(inside === 0, "war: Torn's rows untouched: nothing of ours inside them or on them (" + inside + ')');
    const tags = () => page.evaluate(() => {
        const out = {};
        for (const li of document.querySelectorAll('#faction_war_list_id li.enemy')) {
            const a = li.querySelector('.member a[href*="XID"]');
            const id = a.getAttribute('href').match(/XID=(\d+)/)[1];
            const name = a.getAttribute('aria-label').replace('View profile of ', '');
            const t = document.querySelector('#pi-eye-layer [data-pi-part="war"] .pi-rowtag[data-pi-player="' + id + '"]');
            const r = li.getBoundingClientRect();
            const tr = t ? t.getBoundingClientRect() : null;
            out[name] = t ? { text: t.textContent.replace(/\s+/g, ' ').trim(), dim: t.classList.contains('pi-dimmed'), level: tr.top >= r.top - 1 && tr.bottom <= r.bottom + 1, glow: t.classList.contains('pi-glow'), left: tr.left } : null;
        }
        return out;
    });
    const t1 = await tags();
    const torn = await tornRect(page);
    ok(t1.Rival && /^(Stomp|Good|Fair|Tough)/.test(t1.Rival.text) && t1.Rival.level && t1.Rival.left >= torn.right, 'war: the estimate stored by an earlier page shows as a tag in the free space, level with its row (' + JSON.stringify(t1.Rival) + ')');
    ok(t1.Flyer === null, 'war: a fight you lose (under half your HP kept) is never shown (' + JSON.stringify(t1.Flyer) + ')');
    ok(t1.Mira_Vex === null, 'war: no tag where nothing is known, never "No data"');
    ok(t1.Brix && t1.Brix.dim && /^Good\s?in hospital$/.test(t1.Brix.text), "war: a hospital row's tag is dimmed (" + JSON.stringify(t1.Brix) + ')');
    ok(t1.Rival && t1.Rival.glow && t1.Brix && !t1.Brix.glow, 'war: the best ready row is the one that glows');
    // Torn's status cell shows the clock: "out in 1:17".
    await page.evaluate(() => {
        const li = [...document.querySelectorAll('#faction_war_list_id li.enemy')].find((x) => /Brix/.test(x.textContent));
        li.querySelector('.status').textContent = 'Hospital 01:17:00';
    });
    await page.waitForTimeout(1600);
    const t2 = await tags();
    ok(t2.Brix && /^Good\s?out in 1:1[67]$/.test(t2.Brix.text), 'war: "out in 1:17" from Torn\'s clock (' + JSON.stringify(t2.Brix) + ')');
    const sum = await page.evaluate(() => { const s = document.querySelector('#pi-eye-layer [data-pi-part="war"] .pi-sum'); return s ? { text: s.textContent.replace(/\s+/g, ' ').trim(), title: s.title, bottom: s.getBoundingClientRect().bottom } : null; });
    const firstRow = await page.evaluate(() => Math.min(...[...document.querySelectorAll('#faction_war_list_id li.enemy')].map((li) => li.getBoundingClientRect().top)));
    ok(sum && /^1 ready · 1 out in 1:1[67] · 1 traveling/.test(sum.text) && /live war mode on Pumping Iron’s Torn Eye tab/.test(sum.title) && sum.bottom <= firstRow, 'war: the summary tag on top (' + JSON.stringify(sum) + ')');
    const edge = await page.evaluate(() => [...document.querySelectorAll('#pi-eye-layer [data-pi-part="war"] .pi-edgebar')].map((e) => Math.round(e.getBoundingClientRect().width)));
    ok(edge.length === 2 && edge.every((w) => w === 4), 'war: a 4 px band edge on our own layer for each tagged row (' + edge + ')');
    const rivalTag = page.locator('#pi-eye-layer .pi-rowtag[data-pi-player="424242"]');
    await rivalTag.scrollIntoViewIfNeeded();
    await page.waitForTimeout(200);
    const rb = await rivalTag.boundingBox();
    await page.mouse.move(rb.x + 10, rb.y + 8);
    await page.waitForTimeout(200);
    const warCard = (await text(page, '.pi-hovercard'))[0] || '';
    ok(/HP you keep, by their likely build|Their exact stats/.test(warCard), 'war: its hover card (' + warCard.slice(0, 80) + ')');
    const wh = await rectOf(page, '.pi-hovercard');
    ok(wh && wh.left >= torn.right, 'war: the hover card stays in the free space (' + JSON.stringify(wh) + ')');
    await page.mouse.move(5, 5);
    const yours = await page.evaluate(() => [...document.querySelectorAll('#faction_war_list_id li.your a[href*="XID"]')].map((a) => a.getAttribute('href').match(/XID=(\d+)/)[1]).filter((id) => document.querySelector('#pi-eye-layer [data-pi-part="war"] [data-pi-player="' + id + '"]')).length);
    ok(yours === 0, 'war: your own side is left alone');
    const memberTags = await page.evaluate(() => document.querySelectorAll('#pi-eye-layer [data-pi-part="faction"] .pi-rowtag').length);
    ok(memberTags === 1, 'faction list: a tag for the member something is known about, none on the others or the fallen one (' + memberTags + ')');
    ok((await glows(page)) <= 1, 'war: at most one thing glows (' + (await glows(page)) + ')');
    await page.screenshot({ path: resolve(shots, 'torn-eye-war.png'), fullPage: true });
    // A narrower window: the tags get shorter, never onto Torn's page.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(400);
    const narrow = await tags();
    const torn2 = await tornRect(page);
    ok(narrow.Rival && narrow.Rival.left >= torn2.right && /%/.test(narrow.Rival.text), 'war 1280 px: the tag stays in the free space (' + JSON.stringify(narrow.Rival) + ')');
    await page.screenshot({ path: resolve(shots, 'torn-eye-war-1280.png'), fullPage: true });
    // Round 6 (owner): no Torn Eye reads for faction or war lists on Torn's pages (the Torn Eye tab does war mode).
    const calls = await page.evaluate(() => window.__calls.filter((c) => /faction|\/profile|get-stats/.test(c)).length);
    ok(calls === 0, 'war: nothing asked on a faction page (' + calls + ')');
    ok(errors.length === 0, 'war: no page errors ' + JSON.stringify(errors));
    await page.close();
}
{
    const { page, errors } = await open('page=attack&user2ID=424242&fixture=attack&ffs=1&who=owner', { wait: 6000 });
    await page.setViewportSize({ width: 1600, height: 900 });
    await tornLayout(page);
    const card = () => page.evaluate(() => { const c = document.getElementById('pi-eyecard'); if (!c) return null; const r = c.getBoundingClientRect(); return { text: c.textContent.replace(/\s+/g, ' ').trim(), mode: c.getAttribute('data-pi-mode'), left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
    const before = await card();
    const torn = await tornRect(page);
    ok(before && /^(Stomp|Good|Fair|Tough)/.test(before.text) && /gear shows once the fight starts/.test(before.text), 'attack: the fight card before Start Fight (' + (before && before.text.slice(0, 140)) + ')');
    const i = before ? [before.text.indexOf('Respect'), before.text.indexOf('HP kept'), before.text.indexOf('Win')] : [];
    ok(before && i[0] >= 0 && i[0] < i[1] && i[1] < i[2], 'attack: respect, HP kept, win in that order');
    ok(before && before.left >= torn.right, 'attack: beside the fight, never on Torn’s page');
    const panel = await panelRect(page);
    ok(!overlaps(before, panel), 'attack 1600 px: the training panel does not cover the fight card (panel ' + JSON.stringify(panel) + ')');
    await page.screenshot({ path: resolve(shots, 'torn-eye-attack-1600.png') });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(400);
    const small = await card();
    ok(small && small.mode === 'small' && small.left >= (await tornRect(page)).right, 'attack 1280 px: the smallest card, still beside Torn’s page (' + JSON.stringify(small) + ')');
    // Docking the panel under #pi-eyecard is the panel's side (src/ui/overlay.js): reported here, not failed.
    const panel2 = await panelRect(page);
    console.log('NOTE attack 1280 px: the training panel ' + (overlaps(small, panel2) ? 'COVERS' : 'does not cover') + ' the fight card (panel ' + JSON.stringify(panel2) + ')');
    await page.screenshot({ path: resolve(shots, 'torn-eye-attack-1280.png') });
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(300);
    await page.evaluate(() => fetch('fixtures/attackData.json?sid=attackData').then((r) => r.json()));
    await page.waitForTimeout(2200); // the cache is written 1.5 s after the last change
    const after = await card();
    ok(after && /saved for next time/.test(after.text) && /AK-47/.test(after.text), 'attack: gear read from attackData and saved (' + (after && after.text.slice(0, 200)) + ')');
    const stored = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('pumpingIron', 1); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readonly'); const g = tx.objectStore('kv').get('eye'); g.onsuccess = () => res(g.result && g.result.gear && Object.keys(g.result.gear)); }; r.onerror = () => res(null); }));
    ok(Array.isArray(stored) && stored.includes('424242'), 'attack: gear kept in IndexedDB for next time');
    ok((await glows(page)) <= 1, 'attack: at most one thing of Torn Eye glows (' + (await glows(page)) + ')');
    ok(errors.length === 0, 'attack: no page errors ' + JSON.stringify(errors));
    await page.screenshot({ path: resolve(shots, 'torn-eye-attack.png') });
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
    ok(/turn off Torn Trading/.test(state.body), 'turns: the panel says how to switch');
    ok(state.marks === 0, 'turns: nothing of ours left on Torn’s page (' + state.marks + ')');
    await page.waitForTimeout(6000);
    const n2 = await page.evaluate(() => window.__calls.length);
    ok(n2 === n1, 'turns: no request while paused (' + (n2 - n1) + ')');
    // Torn Trading turned off: its panel gone and last seen over a minute ago.
    await page.evaluate(() => {
        document.getElementById('ttv2-host').remove();
        window.GM_setValue('pumpingIron.v1.tradingSeenAt', JSON.stringify(Date.now() - 61000));
    });
    await page.waitForTimeout(6000);
    const back = await page.evaluate(() => ({ paused: document.getElementById('pi-overlay').shadowRoot.querySelector('.wrap').classList.contains('paused'), marks: document.querySelectorAll('li.pi-on').length }));
    ok(!back.paused && back.marks === 1, 'turns: back by itself, marks drawn again (' + JSON.stringify(back) + ')');
    ok(errors.length === 0, 'turns: no page errors ' + JSON.stringify(errors));
    await page.screenshot({ path: resolve(shots, 'torn-paused.png') });
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
