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
    const dim = await page.evaluate(() => document.querySelectorAll('li.pi-dim').length);
    ok(dim === 4, 'gym (Hank\'s): the four stat boxes are greyed while the part is in another gym (' + dim + ')');
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
    ok(labels.includes('Take 25 · $1,128,000') && labels.some((l) => /^Take 65 · /.test(l)), 'points: 25 + 65 from the two lots (' + labels.join(' | ') + ')');
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
    const mini = (await text(page, '#profile-mini-root .pi-chip'))[0] || '';
    ok(/^(Stomp|Good|Tough|Can't win)/.test(mini), 'eye: mini-profile chip (' + mini + ')');
    ok(errors.length === 0, 'eye: no page errors ' + JSON.stringify(errors));
    ok(tornHits() === 0, 'eye: nothing loaded from torn.com');
    await page.screenshot({ path: resolve(shots, 'torn-eye-profile.png'), fullPage: true });
    await page.close();
}
{
    const { page, errors } = await open('page=faction&ID=7777&fixture=faction&ffs=1&who=owner', { wait: 6500 });
    // Shown order (CSS order on Torn's rows; the DOM itself is untouched).
    const order = await page.evaluate(() => [...document.querySelectorAll('#faction_war_list_id li.enemy')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((li) => li.querySelector('.member a[href*="XID"]').getAttribute('aria-label').replace('View profile of ', '')));
    const domOrder = await page.evaluate(() => [...document.querySelectorAll('#faction_war_list_id li.enemy .member a[href*="XID"]')].map((a) => a.getAttribute('aria-label').replace('View profile of ', '')));
    ok(JSON.stringify(domOrder) === JSON.stringify(['Flyer', 'Mira_Vex', 'Rival', 'Brix']), "war: Torn's rows are not moved in the page");
    ok(JSON.stringify(order) === JSON.stringify(['Rival', 'Brix', 'Mira_Vex', 'Flyer']), 'war: Okay first, then Hospital by time out, then Traveling (' + order + ')');
    const sum = (await text(page, '.pi-warsum'))[0] || '';
    ok(/1 attackable now/.test(sum) && /0:4\d until the next one is out/.test(sum) && /1 traveling/.test(sum), 'war: summary line (' + sum + ')');
    const chips = await page.evaluate(() => document.querySelectorAll('#faction_war_list_id li.enemy .pi-chip').length);
    ok(chips === 4, 'war: a chip on every enemy row (' + chips + ')');
    const yours = await page.evaluate(() => document.querySelectorAll('#faction_war_list_id li.your .pi-chip').length);
    ok(yours === 0, 'war: your own side is left alone');
    const memberChips = await page.evaluate(() => document.querySelectorAll('.members-list .table-body .pi-chip').length);
    ok(memberChips === 2, 'faction list: chips on members, not the fallen one (' + memberChips + ')');
    const calls = await page.evaluate(() => window.__calls.filter((c) => c.includes('/faction/7777/members')).length);
    ok(calls >= 1 && calls <= 2, 'war: the enemy faction read at most every 10 s (' + calls + ' in ~6 s)');
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
