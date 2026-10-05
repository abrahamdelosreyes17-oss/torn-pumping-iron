/*
 * Marks and overlay on saved Torn pages (test/fixtures), in a real browser,
 * with the built script and canned API answers (harness-live.html):
 *   - Torn's layout is untouched: each page with the script lays out exactly
 *     as without it (noscript=1), nothing of ours inside Torn's containers;
 *   - the gym page: rings and pills on our own layer over Torn's boxes, the
 *     strip's words and Fill N in the panel; Fill types N into Torn's box,
 *     makes no request, never clicks TRAIN;
 *   - the specialist stop ("Stop at 18 trains … Balboas") caps Fill;
 *   - items, bazaar, Item Market and points market ring the chosen thing;
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
// The panel's text (its shadow root).
const panelText = (page) => page.evaluate(() => document.getElementById('pi-overlay').shadowRoot.querySelector('.wrap').textContent.replace(/\s+/g, ' '));

/* Torn's gym page, roughly (the fixtures carry no Torn CSS): the four stat boxes in a row, the gym tiles in a grid. */
const GYM_CSS = 'body{background:#191919;color:#ddd;font:12px Arial,sans-serif} #out{display:none} #sidebarroot{width:976px;margin:0 auto} .content-wrapper{width:784px;margin:0 auto} [class*="notification___"]{background:#2a2a2a;padding:6px 10px;margin:8px 0;border-radius:5px} ul[class*="properties___"]{display:flex;gap:10px;list-style:none;padding:0;margin:12px 0} ul[class*="properties___"]>li{flex:1;background:#333;border-radius:5px;padding:14px 10px 10px;min-height:150px} [class*="propertyTitle___"] h3{margin:0 0 4px;font-size:14px} [class*="propertyValue___"]{font-size:16px;color:#fff} [class*="inputWrapper___"] input{width:60px} [class*="gymList___"]>div{display:flex;flex-wrap:wrap;gap:6px} [class*="gymButton___"]{width:44px;height:44px;background:#444;border:1px solid #555;border-radius:4px;position:relative;padding:0} [class*="gymButton___"][class*="selected___"]{background:#5a5a5a}';
async function gymLayout(page) {
    await page.evaluate((css) => {
        const st = document.createElement('style');
        st.id = 'torn-gym-layout';
        st.textContent = css;
        document.head.appendChild(st);
        dispatchEvent(new Event('resize'));
    }, GYM_CSS);
    await page.waitForTimeout(300);
}

/*
 * Round 7 (the owner): our marks are an overlay. Torn's layout with the script and without it (the harness's
 * noscript=1) must be the same: every element of Torn's page (ours left out) with the same rect within 0.5 px, the same
 * classes and inline styles, the page no wider; and nothing of ours inside Torn's containers.
 */
const TORN_BOXES = ['#gymroot', '.content-wrapper', '#sidebarroot', '#faction_war_list_id', '.members-list', '#profile-mini-root', '#item-market-root'];
const tornShape = (page) => page.evaluate((boxes) => {
    const ours = (el) => {
        for (let e = el; e && e.nodeType === 1; e = e.parentElement) if ((e.id && e.id.startsWith('pi-')) || [...e.classList].some((c) => c.startsWith('pi-'))) return true;
        return false;
    };
    const items = [];
    for (const el of document.body.querySelectorAll('*')) {
        if (ours(el) || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
        const r = el.getBoundingClientRect();
        items.push({ tag: el.tagName, id: el.id, cls: el.getAttribute('class') || '', style: el.getAttribute('style') || '', data: [...el.attributes].filter((a) => a.name.startsWith('data-pi')).map((a) => a.name).join(), r: [r.left, r.top, r.width, r.height] });
    }
    let inside = 0;
    for (const sel of boxes) for (const c of document.querySelectorAll(sel)) for (const el of c.querySelectorAll('*')) if (ours(el) || [...el.attributes].some((a) => a.name.startsWith('data-pi'))) inside++;
    return { items, inside, scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth };
}, TORN_BOXES);
function shapeDiff(a, b) {
    if (a.items.length !== b.items.length) return 'element count ' + a.items.length + ' vs ' + b.items.length + ' without the script';
    for (let i = 0; i < a.items.length; i++) {
        const x = a.items[i];
        const y = b.items[i];
        const what = x.tag + (x.id ? '#' + x.id : '') + (x.cls ? '.' + x.cls.split(' ')[0] : '');
        if (x.tag !== y.tag || x.cls !== y.cls) return what + ': class "' + x.cls + '" vs "' + y.cls + '"';
        if (x.style !== y.style) return what + ': style "' + x.style + '" vs "' + y.style + '"';
        if (x.data) return what + ': our attribute ' + x.data;
        const d = x.r.map((v, k) => Math.abs(v - y.r[k]));
        if (d.some((v) => v > 0.5)) return what + ': rect ' + x.r.map((v) => v.toFixed(1)) + ' vs ' + y.r.map((v) => v.toFixed(1));
    }
    if (a.scrollW !== b.scrollW || a.clientW !== b.clientW) return 'page width ' + a.scrollW + '/' + a.clientW + ' vs ' + b.scrollW + '/' + b.clientW;
    return null;
}
/** Compare this page with the same page and query without our script; `prep` lays both out the same way. */
async function layoutUntouched(name, page, query, { width = 1280, prep = null, seed = null } = {}) {
    const mine = await tornShape(page);
    const bare = await open(query + '&noscript=1', { width, wait: 800, seed });
    if (prep) await prep(bare.page);
    const theirs = await tornShape(bare.page);
    await bare.page.close();
    const diff = shapeDiff(mine, theirs);
    ok(diff === null && mine.items.length > 20, name + ': Torn’s layout untouched (' + mine.items.length + ' elements within 0.5 px, same classes and styles' + (diff ? '; ' + diff : '') + ')');
    ok(mine.inside === 0, name + ': nothing of ours inside Torn’s containers (' + mine.inside + ')');
}
/** Our marks' rings and pills, with the rect of each. */
const layerMarks = (page) => page.evaluate(() => [...document.querySelectorAll('#pi-marks-layer > *')].map((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return { cls: e.className, text: e.textContent.replace(/\s+/g, ' ').trim(), title: e.title, stat: e.getAttribute('data-pi-stat'), gym: e.getAttribute('data-pi-gym'), gymId: e.getAttribute('data-pi-gym-id'), kind: e.getAttribute('data-pi-kind'), shown: s.display !== 'none', pe: s.pointerEvents, color: s.borderTopColor, style: s.borderTopStyle, tt: s.textTransform, bg: s.backgroundColor, font: s.fontFamily, r: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height } }; }));
const statRect = (page, stat) => page.evaluate((k) => { const li = document.querySelector('li[class*="' + k + '___"]'); const r = li.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; }, stat);
const near = (a, b, d = 1) => Math.abs(a - b) <= d;
/** Pills whose words don't fit (cut with "…"). */
const clippedPills = (page) => page.evaluate(() => [...document.querySelectorAll('#pi-marks-layer .pi-pill > span')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.textContent));

/* Gym page: the friend right after Xanax #2 (275 energy) at Gun Shop. */
{
    const { page, errors, tornHits } = await open('page=gym&fixture=gym-friend&energy=275&build=balanced');
    // Torn's own layout first: the same page without our script lays out exactly the same (nothing of ours inside it).
    await gymLayout(page);
    await page.waitForTimeout(200);
    await layoutUntouched('gym (friend)', page, 'page=gym&fixture=gym-friend&energy=275&build=balanced', { prep: gymLayout });
    // The strip's words are the panel's now (state A, the right gym: green).
    const card = await panelText(page);
    const tone = await page.evaluate(() => document.getElementById('pi-overlay').shadowRoot.querySelector('.wrap').getAttribute('data-tone'));
    ok(/Train DEX × 27/.test(card) && /Gun Shop/.test(card) && tone === 'green', 'gym: state A, the right gym: the panel says what to train here, green (' + tone + ': ' + card.slice(0, 160) + ')');
    ok(/Next gym: Force Training in [\d,]+ E/.test(card), 'gym: next gym from the page\'s 80%, in the panel (' + (card.match(/Next gym: [^·]{0,40}/) || [''])[0] + ')');
    ok(/all your energy/.test(card), 'gym: the box\'s line ("all your energy") is in the panel');
    const marks = await layerMarks(page);
    const rings = marks.filter((x) => /pi-ring/.test(x.cls) && x.stat);
    const dex = await statRect(page, 'dexterity');
    const ring = rings[0];
    ok(rings.length === 1 && ring.stat === 'dex', 'gym: DEX ringed, and only DEX (' + rings.map((x) => x.stat) + ')');
    ok(ring && /pi-c-green/.test(ring.cls) && /pi-glow/.test(ring.cls) && ring.color === 'rgb(63, 191, 90)', 'gym: the stat to train has a green ring with a glow (' + JSON.stringify(ring && { cls: ring.cls, color: ring.color }) + ')');
    ok(ring && near(ring.r.left, dex.left - 3) && near(ring.r.top, dex.top - 3) && near(ring.r.width, dex.width + 6) && near(ring.r.height, dex.height + 6), 'gym: the ring is over the box, 3 px out (ring ' + JSON.stringify(ring && ring.r) + ', box ' + JSON.stringify(dex) + ')');
    const tab = marks.find((x) => /pi-pill/.test(x.cls) && x.stat === 'dex');
    ok(tab && tab.text === 'Train this · 27 trains' && /about \+[\d,]+/.test(tab.title) && tab.tt === 'uppercase' && tab.bg === 'rgb(63, 191, 90)', 'gym: its pill "TRAIN THIS · 27 TRAINS", green, the full words on hover (' + JSON.stringify(tab && { text: tab.text, title: tab.title, bg: tab.bg }) + ')');
    ok(tab && near((tab.r.top + tab.r.bottom) / 2, dex.top - 3, 1.5) && tab.r.left >= dex.left && tab.r.right <= dex.right && near((tab.r.left + tab.r.right) / 2, (dex.left + dex.right) / 2, 1.5), 'gym: the pill straddles the box\'s top border, centred (' + JSON.stringify(tab && tab.r) + ')');
    ok(marks.every((x) => x.pe === 'none'), 'gym: nothing of ours takes the pointer');
    const hit = await page.evaluate((r) => { const e = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2); return e ? (e.closest('#pi-marks-layer') ? 'ours' : e.tagName) : null; }, tab.r);
    ok(hit && hit !== 'ours', 'gym: a click on the pill reaches Torn\'s page under it (' + hit + ')');
    const tags = marks.filter((x) => /pi-pill/.test(x.cls) && x.stat && x.stat !== 'dex').map((x) => x.text);
    ok(tags.includes('skip · over target') && tags.includes('tomorrow'), 'gym: the other stats get a small dark pill on their top border (' + tags.join(' | ') + ')');
    const here = marks.filter((x) => x.gym).map((x) => x.gym + ':' + x.gymId + ':' + x.color);
    ok(here.length === 1 && here[0] === 'right:18:rgb(63, 191, 90)', 'gym: Gun Shop, the gym you\'re in, a steady green ring (' + here + ')');
    const tile = await page.evaluate(() => { const r = document.querySelector('[aria-label="Gym 18"]').getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width }; });
    const gr = marks.find((x) => x.gym);
    ok(gr && near(gr.r.left, tile.left - 2) && near(gr.r.top, tile.top - 2) && near(gr.r.width, tile.width + 4), 'gym: its ring over the tile (' + JSON.stringify(gr && gr.r) + ', tile ' + JSON.stringify(tile) + ')');
    const glows = await page.evaluate(() => ({ glow: document.querySelectorAll('.pi-glow').length, pulse: document.querySelectorAll('.pi-pulse').length }));
    ok(glows.glow === 1 && glows.pulse === 0, 'gym: one thing glows, nothing pulses (' + JSON.stringify(glows) + ')');
    ok(tab && /Segoe UI/.test(tab.font), 'gym: our marks in Segoe UI / system-ui (' + (tab && tab.font) + ')');
    const fillBtn = await page.evaluate(() => { const b = document.getElementById('pi-overlay').shadowRoot.querySelector('.cta.fill'); const w = document.getElementById('pi-overlay').shadowRoot.querySelector('.cta.web'); return b ? { text: b.textContent, disabled: b.disabled, bg: getComputedStyle(b).backgroundColor, web: w && w.textContent } : null; });
    ok(fillBtn && fillBtn.text === 'Fill 27' && !fillBtn.disabled && fillBtn.bg === 'rgb(63, 191, 90)' && fillBtn.web === 'Pumping Iron ↗', 'gym: the panel has a green "Fill 27" beside "Pumping Iron ↗" (' + JSON.stringify(fillBtn) + ')');
    // Torn's page moves (a longer message above the boxes): the ring follows, nothing of ours pushes anything.
    await page.evaluate(() => {
        const n = document.querySelector('[class*="notificationText___"]');
        n.textContent = '';
        for (let i = 0; i < 4; i++) { const p = document.createElement('p'); p.textContent = 'You used 10 energy training your dexterity.'; n.appendChild(p); }
    });
    await page.waitForTimeout(400);
    const dex2 = await statRect(page, 'dexterity');
    const ring2 = (await layerMarks(page)).find((x) => /pi-ring/.test(x.cls) && x.stat === 'dex');
    ok(dex2.top > dex.top + 20 && ring2 && near(ring2.r.top, dex2.top - 3), 'gym: Torn\'s page moved down ' + Math.round(dex2.top - dex.top) + ' px: the ring followed (' + Math.round(ring2 && ring2.r.top) + ' vs ' + Math.round(dex2.top - 3) + ')');
    await page.screenshot({ path: resolve(shots, 'torn-gym-friend-layer.png') });
    await page.evaluate(() => {
        window.__trainClicks = 0;
        for (const b of document.querySelectorAll('button[aria-label^="Train "]')) b.addEventListener('click', () => window.__trainClicks++);
        window.__callsBefore = window.__calls.length;
        window.__inputEvents = 0;
        document.querySelector('li[class*="dexterity___"] input').addEventListener('input', () => window.__inputEvents++);
    });
    // At 1280 px the free space beside Torn's page holds only the one-tag panel: a click on it opens it for a look.
    const folded = await page.evaluate(() => document.getElementById('pi-overlay').shadowRoot.querySelector('.wrap').classList.contains('collapsed'));
    if (folded) {
        await page.locator('#pi-overlay .head').click();
        await page.waitForTimeout(200);
    }
    ok(await page.locator('#pi-overlay .cta.fill').isVisible(), 'gym: Fill 27 is one click away in the panel (' + (folded ? 'the folded tag opened for a look' : 'open') + ')');
    await page.locator('#pi-overlay .cta.fill').click();
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
    const moved = ((await layerMarks(page)).find((x) => /pi-pill/.test(x.cls) && x.stat === 'dex') || {}).text || '';
    const movedFill = await page.evaluate(() => (document.getElementById('pi-overlay').shadowRoot.querySelector('.cta.fill') || {}).textContent);
    ok(moved === 'Train this · 17 left' && movedFill === 'Fill 17', 'gym: after 10 trains the pill says 17 left, the panel Fill 17 (' + moved + ' · ' + movedFill + ')');
    // Never clipped: the pill's words fit the box (the owner: "TAKE THE XANAX FIRST · TH…").
    ok((await clippedPills(page)).length === 0, 'gym: no pill is cut short (' + (await clippedPills(page)).join(' | ') + ')');
    const sess = await page.evaluate(() => JSON.parse(_store['pumpingIron.v1.gymSession'] || 'null'));
    ok(sess && sess.parts && sess.parts.length === 1 && sess.spent.dex === 100, 'gym: the session snapshot counts the 100 energy spent on DEX (' + JSON.stringify(sess && sess.spent) + ')');
    // Round 9 (the owner's pick 3B): a box the session leaves alone says what a train gives here, or the gym of yours
    // that gives more, on its bottom border. Still quiet: no ring on it, nothing on the stat being trained.
    {
        const marks = await layerMarks(page);
        const gains = marks.filter((x) => x.kind === 'gain');
        const box = async (k) => statRect(page, { str: 'strength', def: 'defense', spd: 'speed', dex: 'dexterity' }[k]);
        let onBottom = gains.length > 0;
        for (const g of gains) { const r = await box(g.stat); if (Math.abs((g.r.top + g.r.bottom) / 2 - (r.bottom + 3)) > 1.5 || g.r.left < r.left || g.r.right > r.right) onBottom = false; }
        ok(gains.length === 3 && gains.every((g) => /^[+][0-9,]+ a train$|^(Better|Trained) at .+$/.test(g.text)) && !gains.some((g) => g.stat === 'dex'), 'gym, the other three boxes: what a train gives here, or the better gym (' + gains.map((g) => g.stat + ': ' + g.text).join(' | ') + ')');
        ok(onBottom && gains.every((g) => g.pe === 'none'), 'gym, the other three boxes: the line sits on the box’s bottom border, inside its width, and never takes the pointer');
        ok(!marks.some((x) => /pi-ring/.test(x.cls) && x.stat && x.stat !== 'dex'), 'gym, the other three boxes: no outline, only the session’s stat is ringed');
        const better = gains.filter((g) => /^Better at /.test(g.text));
        const notes = await page.evaluate(() => [...document.getElementById('pi-overlay').shadowRoot.querySelectorAll('.note')].map((n) => n.textContent));
        ok(better.every((g) => notes.some((n) => new RegExp('^' + g.stat.toUpperCase() + ' · better at .+ dots · about [+][0-9,]+ .+ here, [+][0-9,]+ there$').test(n))), 'gym, a better gym for a stat outside the session: the panel says where and both gains (' + notes.filter((n) => /better at/.test(n)).join(' | ') + ')');
    }
    ok(errors.length === 0, 'gym: no page errors ' + JSON.stringify(errors));
    ok(tornHits() === 0, 'gym: nothing loaded from torn.com');
    await page.screenshot({ path: resolve(shots, 'torn-gym-friend.png'), fullPage: true });
    await page.close();
}

/* The owner's 1.4.1 report (2026-10-03): no energy for one train, the Xanax is next. It drew a dark block inside
   Torn's stat box ("TAKE THE XANAX FIRST · TH…", clipped) with a green outline. Now: a dashed grey ring and a dark
   pill on our layer, Fill waiting in the panel, Torn's box as it is without the script. */
{
    const q = 'page=gym&fixture=gym-friend&energy=5&drug=0&build=balanced';
    const { page, errors } = await open(q);
    await gymLayout(page);
    await page.waitForTimeout(200);
    await layoutUntouched('gym (no energy)', page, q, { prep: gymLayout });
    const marks = await layerMarks(page);
    const ring = marks.find((x) => /pi-ring/.test(x.cls) && x.stat);
    ok(ring && ring.kind === 'noenergy' && /pi-c-grey/.test(ring.cls) && ring.style === 'dashed' && !/pi-glow|pi-c-green/.test(ring.cls), 'gym (no energy): the stat to train has a dashed grey ring, not green (' + JSON.stringify(ring && { stat: ring.stat, kind: ring.kind, cls: ring.cls, style: ring.style }) + ')');
    const tab = marks.find((x) => /pi-pill/.test(x.cls) && x.stat === (ring && ring.stat));
    const box = ring ? await statRect(page, { str: 'strength', def: 'defense', spd: 'speed', dex: 'dexterity' }[ring.stat]) : null;
    ok((await clippedPills(page)).length === 0, 'gym (no energy): no pill is cut short (' + (await clippedPills(page)).join(' | ') + ')');
    ok(tab && tab.text === 'Take the Xanax first' && /then DEX × 25/.test(tab.title) && /pi-dark/.test(tab.cls) && box && tab.r.left >= box.left && tab.r.right <= box.right, 'gym (no energy): its pill says "Take the Xanax first", dark, inside the box\'s width (' + JSON.stringify(tab && { text: tab.text, cls: tab.cls, r: tab.r }) + ')');
    const glows = await page.evaluate(() => document.querySelectorAll('.pi-glow, .pi-c-green.pi-ring[data-pi-stat]').length);
    ok(glows === 0, 'gym (no energy): no stat glows green (' + glows + ')');
    const fillBtn = await page.evaluate(() => { const b = document.getElementById('pi-overlay').shadowRoot.querySelector('.cta.fill'); return b ? { text: b.textContent, disabled: b.disabled, title: b.title } : null; });
    ok(fillBtn && fillBtn.disabled && fillBtn.title === 'Take the Xanax first', 'gym (no energy): the panel\'s Fill waits (' + JSON.stringify(fillBtn) + ')');
    const card = await panelText(page);
    ok(/Take the Xanax first/.test(card) && !/Train (STR|DEF|SPD|DEX) × \d+(?! after)/.test(card.split('then')[0]), 'gym (no energy): the panel says "Take the Xanax first", never "Train" with nothing left (' + card.slice(0, 160) + ')');
    ok(errors.length === 0, 'gym (no energy): no page errors ' + JSON.stringify(errors));
    await page.screenshot({ path: resolve(shots, 'torn-gym-no-energy.png') });
    await page.close();
}

/* Overdosed (the owner, 2026-10-03): one stored state. The gym page: no train mark on any stat, the panel says
   "Overdosed · fly to Switzerland" with Open Travel, nothing of ours inside Torn's page; the same key the webpage reads. */
{
    const q = 'page=gym&fixture=gym-friend&energy=0&happy=0&drug=86400&build=balanced';
    const { page, errors } = await open(q);
    await gymLayout(page);
    await page.waitForTimeout(200);
    await layoutUntouched('gym (overdose)', page, q, { prep: gymLayout });
    const marks = await layerMarks(page);
    ok(marks.filter((x) => x.stat).length === 0, 'gym (overdose): no train mark on any stat (' + marks.filter((x) => x.stat).map((x) => x.stat + ':' + x.text) + ')');
    const card = await panelText(page);
    const tone = await page.evaluate(() => document.getElementById('pi-overlay').shadowRoot.querySelector('.wrap').getAttribute('data-tone'));
    ok(/Overdosed · fly to Switzerland/.test(card) && /Fly to Switzerland/.test(card) && /Open Travel/.test(card) && tone === 'amber', 'gym (overdose): the panel says "Overdosed · fly to Switzerland", amber, with Open Travel (' + tone + ': ' + card.slice(0, 140) + ')');
    ok(!/Train (STR|DEF|SPD|DEX) ×|Fill \d/.test(card), 'gym (overdose): no "Train" and no Fill in the panel');
    const stored = await page.evaluate(() => JSON.parse(_store['pumpingIron.v1.overdose'] || 'null'));
    ok(stored && stored.until - stored.at > 20 * 3600e3, 'gym (overdose): stored under the one key the webpage reads (' + JSON.stringify(stored) + ')');
    ok(errors.length === 0, 'gym (overdose): no page errors ' + JSON.stringify(errors));
    await page.screenshot({ path: resolve(shots, 'torn-gym-overdose.png') });
    await page.close();
}

/* Flying (the owner's live page, 2026-10-03): Torn's travel answer says 43 minutes of flight left. No train mark on
   any stat, the panel says when he is back and never "Train", nothing of ours inside Torn's page. */
{
    const q = 'page=gym&fixture=gym-friend&energy=60&fly=43&build=balanced';
    const { page, errors } = await open(q);
    await gymLayout(page);
    await page.waitForTimeout(200);
    await layoutUntouched('gym (flying)', page, q, { prep: gymLayout });
    const marks = await layerMarks(page);
    ok(marks.filter((x) => x.stat).length === 0, 'gym (flying): no train mark on any stat (' + marks.filter((x) => x.stat).map((x) => x.stat + ':' + x.text) + ')');
    const card = await panelText(page);
    const tone = await page.evaluate(() => document.getElementById('pi-overlay').shadowRoot.querySelector('.wrap').getAttribute('data-tone'));
    ok(/Flying · back in Torn at \d\d:\d\d/.test(card) && /The gym is closed while you travel/.test(card) && tone === 'amber', 'gym (flying): the panel says "Flying · back in Torn at HH:MM", amber (' + tone + ': ' + card.slice(0, 140) + ')');
    ok(!/Train (STR|DEF|SPD|DEX) ×|Fill \d/.test(card), 'gym (flying): no "Train" and no Fill in the panel');
    ok(errors.length === 0, 'gym (flying): no page errors ' + JSON.stringify(errors));
    await page.screenshot({ path: resolve(shots, 'torn-gym-flying.png') });
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
    ok(/Session done/.test(card) && /Next at \d\d:\d\d: /.test(card), 'roll-over: the panel says the session is done and what is next (' + (card.match(/Session done.{0,70}/) || [''])[0] + ')');
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
    await gymLayout(page);
    await page.waitForTimeout(200);
    await layoutUntouched('gym (Hank\'s)', page, 'page=gym&fixture=gym-owner&who=owner&build=hank', { prep: gymLayout });
    const gymRing = (k) => page.evaluate((kind) => {
        const r = document.querySelector('#pi-marks-layer [data-pi-gym="' + kind + '"]');
        if (!r) return null;
        const tile = document.querySelector('[class*="gymIcon___"][class*="gym-' + r.getAttribute('data-pi-gym-id') + '"]').closest('[class*="gymButton___"]').getBoundingClientRect();
        const rr = r.getBoundingClientRect();
        return { id: r.getAttribute('data-pi-gym-id'), label: r.title, color: getComputedStyle(r).borderTopColor, pulse: r.classList.contains('pi-pulse'), anim: getComputedStyle(r, '::after').animationName, over: Math.abs(rr.left - (tile.left - 2)) <= 1 && Math.abs(rr.top - (tile.top - 2)) <= 1 && Math.abs(rr.width - (tile.width + 4)) <= 1 };
    }, k);
    const next = await gymRing('go');
    ok(next && next.id === '23' && /^Next: The Edge · SPD × \d+$/.test(next.label) && next.color === 'rgb(63, 191, 90)' && next.pulse && next.over, 'gym (Hank\'s): state B, a green pulsing ring over The Edge\'s tile (' + JSON.stringify(next) + ')');
    ok(next && next.anim === 'pi-pulse', 'gym (Hank\'s): the pulse runs (Animations on) (' + (next && next.anim) + ')');
    const wrong = await gymRing('wrong');
    ok(wrong && wrong.id === '27' && wrong.color === 'rgb(255, 107, 94)' && !wrong.pulse && wrong.over, 'gym (Hank\'s): Gym 3000, where you are, a steady red ring over its tile (' + JSON.stringify(wrong) + ')');
    const boxRings = await page.evaluate(() => [...document.querySelectorAll('#pi-marks-layer .pi-ring[data-pi-stat]')].map((r) => r.getAttribute('data-pi-stat') + ':' + r.getAttribute('data-pi-kind')));
    ok(boxRings.every((x) => !/:train$/.test(x)), 'gym (Hank\'s): no green "train" ring on a box in the wrong gym (' + boxRings + ')');
    const dim = await page.evaluate(() => document.querySelectorAll('li.pi-dim, .pi-dim').length);
    ok(dim === 0, 'gym (Hank\'s): Torn\'s stat boxes are never greyed (round 6) (' + dim + ')');
    const card = await panelText(page);
    ok(/Wrong gym/.test(card) && /Switch to The Edge/.test(card) && /You’re in Gym 3000 \(no SPD\) · switch to The Edge \(SPD [\d.]+\)/.test(card), 'gym (Hank\'s): the panel says "Wrong gym · Switch to The Edge · You\'re in Gym 3000 (no SPD) · switch to The Edge" (' + card.slice(0, 220) + ')');
    // Another script changing the gym page (not Torn's values): no redraw.
    const same = await page.evaluate(async () => {
        const ring = document.querySelector('#pi-marks-layer [data-pi-gym="go"]');
        const root = document.getElementById('gymroot');
        for (let i = 0; i < 5; i++) {
            const x = document.createElement('div');
            x.className = 'tt-extra';
            root.appendChild(x);
            await new Promise((r) => setTimeout(r, 60));
        }
        await new Promise((r) => setTimeout(r, 400));
        return document.querySelector('#pi-marks-layer [data-pi-gym="go"]') === ring;
    });
    ok(same, 'gym (Hank\'s): changes that are not Torn\'s values (another script) redraw nothing');
    const fills = await page.evaluate(() => document.getElementById('pi-overlay').shadowRoot.querySelectorAll('.cta.fill:not(:disabled)').length + document.querySelectorAll('.pi-fill').length);
    ok(fills === 0, 'gym (Hank\'s): no Fill to press in a gym the part isn\'t in');
    const clicks = await page.evaluate(() => document.querySelectorAll('.gymButton___3OFdI.selected___2PmTc').length && document.querySelector('.gymButton___3OFdI.selected___2PmTc [class*="gym-27"]') !== null);
    ok(clicks, 'gym (Hank\'s): we never switched gyms (Gym 3000 is still the one selected)');
    ok(errors.length === 0, 'gym (Hank\'s): no page errors ' + JSON.stringify(errors));
    await page.screenshot({ path: resolve(shots, 'torn-gym-owner.png'), fullPage: true });
    // Settings › Animations off: the pulse is held still.
    await page.evaluate(() => {
        window.GM_setValue('pumpingIron.v1.settings', JSON.stringify({ motion: false }));
        // This tab's own write fires no change event here (Tampermonkey's are remote only): redraw as Settings' tab would.
        window.__pi.refresh();
    });
    await page.waitForTimeout(1500);
    const still = await page.evaluate(() => { const r = document.querySelector('#pi-marks-layer [data-pi-gym="go"]'); return r ? r.classList.contains('pi-still') + ':' + getComputedStyle(r, '::after').animationName + ':' + getComputedStyle(r, '::after').opacity : null; });
    ok(still === 'true:none:0.7', 'gym (Hank\'s): Animations off, the pulse held still (' + still + ')');
    await page.close();
}

/* The panel's tiles (round 9, pick 1B): the step's items. */
const panelTiles = (page) => page.evaluate(() => {
    const sr = document.getElementById('pi-overlay').shadowRoot;
    const box = sr.querySelector('.tiles');
    if (!box) return { lbl: null, tiles: [], warn: null, later: null, inside: true, buttons: 0 };
    const wr = sr.querySelector('.wrap').getBoundingClientRect();
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    return {
        lbl: txt(box.querySelector('.lbl')),
        tiles: [...box.querySelectorAll('.tile:not(.small)')].map((t) => { const b = t.querySelector('.tb'); return { nm: txt(t.querySelector('.nm')), st: txt(t.querySelector('.st')), hold: txt(t.querySelector('.hold')), low: Boolean(t.querySelector('.hold.lowc')), off: t.classList.contains('off'), tone: [...t.classList].find((c) => c.startsWith('t-')) || '', show: b ? b.tagName + ':' + (b.getAttribute('href') || '') : '', go: Boolean(b && b.classList.contains('go')) }; }),
        warn: txt(box.querySelector('.warn')) || null,
        later: txt(box.querySelector('.tile.small')) || null,
        miss: txt(box.querySelector('[role="status"]')),
        inside: [...box.querySelectorAll('.tile')].every((t) => { const r = t.getBoundingClientRect(); return r.left >= wr.left && r.right <= wr.right + 0.5; }),
        // Nothing of ours uses an item: the only words on a tile's button are "Show".
        buttons: [...box.querySelectorAll('button, a')].filter((b) => txt(b) !== 'Show').length,
    };
});

/* Our listing marks: the pill texts, the shown ones only. */
const listingPills = (page) => page.evaluate(() => [...document.querySelectorAll('#pi-marks-layer .pi-pill[data-pi-listing]')].filter((p) => getComputedStyle(p).display !== 'none').map((p) => p.textContent.replace(/\s+/g, ' ').trim()));

/* Items page: the Xanax the next step uses. */
{
    const { page, errors } = await open('page=items&fixture=items');
    await layoutUntouched('items', page, 'page=items&fixture=items');
    const labels = await listingPills(page);
    ok(labels.length >= 1 && /Step 1 of today · Xanax #1/.test(labels[0]), 'items: Xanax ringed with its step (' + labels.join(' | ') + ')');
    const onlyVisible = await page.evaluate(() => {
        const shown = [...document.querySelectorAll('#pi-marks-layer > *')].filter((p) => getComputedStyle(p).display !== 'none');
        const ul = [...document.querySelectorAll('ul.items-cont')].find((u) => u.getAttribute('aria-expanded') === 'true').getBoundingClientRect();
        return shown.length > 0 && shown.every((p) => { const r = p.getBoundingClientRect(); return r.top >= ul.top - 14 && r.bottom <= ul.bottom + 4; });
    });
    ok(onlyVisible, 'items: only the list that shows is marked');
    // Round 9 (pick 1B): on the items page a tile's Show scrolls to Torn's own row; it asks Torn nothing and clicks nothing.
    {
        const wide = await open('page=items&fixture=items', { width: 1900 });
        const before = await panelTiles(wide.page);
        const t0 = before.tiles[0] || {};
        ok(t0.nm === 'Xanax' && /^Drug cooldown · [\d:hm ]+ left$/.test(t0.st) && t0.off && t0.tone === 't-amber' && !t0.go, 'items, the panel’s tile: the drug cooldown still runs, so the tile is greyed with its countdown (' + JSON.stringify(t0) + ')');
        ok(t0.show === 'BUTTON:', 'items, the panel’s tile: Show is a button here, not a link away (' + t0.show + ')');
        const calls = await wide.page.evaluate(() => window.__calls.length);
        const clicked = await wide.page.evaluate(() => {
            let clicks = 0;
            const count = (e) => { if (!e.composedPath().some((n) => n.id === 'pi-overlay')) clicks++; };
            document.addEventListener('click', count, true);
            const row = document.querySelector('ul.items-cont[aria-expanded="true"] li[data-item="206"]');
            let scrolled = 0;
            row.scrollIntoView = () => { scrolled++; };
            document.getElementById('pi-overlay').shadowRoot.querySelector('.tile .tb').click();
            document.removeEventListener('click', count, true);
            return { scrolled, clicks };
        });
        const after = await panelTiles(wide.page);
        ok(clicked.scrolled === 1 && clicked.clicks === 0 && after.miss === '', 'items, Show: Torn’s Xanax row is scrolled to, nothing on Torn’s page is clicked (' + JSON.stringify(clicked) + ')');
        ok((await wide.page.evaluate(() => window.__calls.length)) === calls && wide.tornHits() === 0, 'items, Show: no request, to Torn or to anyone');
        // The row is on another of Torn's tabs: the tile says which, and does nothing else.
        const missed = await wide.page.evaluate(() => {
            for (const li of document.querySelectorAll('ul.items-cont li[data-item="206"]')) li.remove();
            const sr = document.getElementById('pi-overlay').shadowRoot;
            sr.querySelector('.tile .tb').click();
            return sr.querySelector('.tiles [role="status"]').textContent;
        });
        ok(missed === 'Its row isn’t on this tab: open Torn’s Drugs tab.', 'items, Show with the row on another tab: the tile says which tab (' + missed + ')');
        await wide.page.screenshot({ path: resolve(shots, 'torn-items-tiles.png') });
        ok(wide.errors.length === 0, 'items, the panel’s tiles: no page errors ' + JSON.stringify(wide.errors.slice(0, 2)));
        await wide.page.close();
    }
    ok(errors.length === 0, 'items: no page errors');
    await page.close();
}

/* Bazaar, Item Market, points market: the chosen listings. */
{
    const { page, errors } = await open('page=bazaar&userId=1234567&fixture=bazaar', { wait: 6000 });
    await layoutUntouched('bazaar', page, 'page=bazaar&userId=1234567&fixture=bazaar');
    const labels = await listingPills(page);
    ok(labels.some((l) => l === 'Take 3 · $2,479,500'), 'bazaar: Iron_Monk\'s Xanax ringed "Take 3 · $2,479,500" (' + labels.join(' | ') + ')');
    const tab = await page.evaluate(() => {
        const l = document.querySelector('#pi-marks-layer .pi-pill[data-pi-listing]');
        const ring = document.querySelector('#pi-marks-layer .pi-ring.pi-c-chalk');
        const s = getComputedStyle(l);
        const lr = l.getBoundingClientRect();
        const rr = ring.getBoundingClientRect();
        return { tt: s.textTransform, bg: s.backgroundColor, pe: s.pointerEvents, ringPe: getComputedStyle(ring).pointerEvents, ring: getComputedStyle(ring).borderTopColor, glows: document.querySelectorAll('.pi-glow').length, straddle: Math.abs((lr.top + lr.bottom) / 2 - rr.top) <= 1.5 };
    });
    ok(tab.pe === 'none' && tab.ringPe === 'none', 'bazaar: the ring and its pill never take the pointer');
    ok(tab.tt === 'uppercase' && tab.bg === 'rgb(239, 235, 226)' && tab.ring === 'rgb(239, 235, 226)' && tab.glows === 1 && tab.straddle, 'bazaar: a chalk ring and the pill "TAKE 3 · $2,479,500" on its top edge, one thing glows (' + JSON.stringify(tab) + ')');
    await page.screenshot({ path: resolve(shots, 'torn-bazaar.png') });
    ok(errors.length === 0, 'bazaar: no page errors');
    await page.close();
}
{
    const { page } = await open('page=itemmarket&win=week&fixture=itemmarket#/market/view=search&itemID=206', { wait: 6000 });
    const labels = await listingPills(page);
    ok(labels.some((l) => /^Take 3 · \$2,488,500$/.test(l)), 'item market: the $829,500 row ringed (' + labels.join(' | ') + ')');
    await page.close();
}
{
    const { page } = await open('page=points&fixture=pmarket', { wait: 6000 });
    const labels = await listingPills(page);
    // Steady: a refill (30 points) a day for the 3-day window = 90, less the 45 held = 45 to buy.
    ok(labels.includes('Take 25 · $1,128,000') && labels.some((l) => /^Take 20 · /.test(l)), 'points: 25 + 20 from the two lots, the 45 held taken off (' + labels.join(' | ') + ')');
    await page.close();
}

/* The panel on any page: its bar, the body, Alt+` and a drag. */
{
    // 1600 wide: the free space beside Torn's page holds the full panel.
    const { page, errors } = await open('page=other', { width: 1600 });
    const q = (sel) => `document.getElementById('pi-overlay').shadowRoot.querySelector('${sel}')`;
    // Round 8 (the owner's pick B): the Xanax is 3:50 away, so nothing is due. The bar counts down and says so, the
    // card says what is next in words, nothing rings, and the one button is the webpage's.
    const bar = await page.evaluate(`${q('.head')}.textContent`);
    ok(/3:[45]\d\s*Nothing due/.test(bar.replace(/\s+/g, ' ')), 'panel: the countdown and "Nothing due" in the bar (' + bar + ')');
    const box = await page.evaluate(`(() => { const r = ${q('.head')}.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()`);
    ok(Math.abs(box.h - 36) <= 1, 'panel: bar 36 px tall (' + box.h + ')');
    const body = await page.evaluate(`({ shown: getComputedStyle(${q('.body')}).display !== 'none', text: ${q('.body')}.textContent, lbl: ${q('.lbl')}.textContent, step: ${q('.step')}.textContent, sub: ${q('.sub')}.textContent, go: ${q('.cta.go')} && ${q('.cta.go')}.getAttribute('href'), goText: ${q('.cta')}.textContent, ctas: ${q('.body')}.querySelectorAll('.cta').length, rail: ${q('.body')}.querySelectorAll('.prail').length })`);
    ok(body.shown && body.step === 'Nothing due now' && /^Next at \d\d:\d\d$/.test(body.lbl) && /^Next at \d\d:\d\d: take Xanax #1, then train (STR|SPD|DEF|DEX) × \d+ · about \+[\d,]+ · \d+ energy$/.test(body.sub), 'panel: expanded by default; nothing due is said in words, with what is next (' + JSON.stringify([body.lbl, body.step, body.sub]) + ')');
    ok(body.ctas === 1 && body.goText === 'Open Pumping Iron' && body.go === null && body.rail === 0, 'panel: with nothing due the one button is the webpage, and no list of actions (' + JSON.stringify(body) + ')');
    const look = await page.evaluate(`(() => { const w = ${q('.wrap')}; const s = getComputedStyle(w); return { bg: s.backgroundColor, tone: w.getAttribute('data-tone'), font: s.fontFamily, ring: w.getAttribute('data-ring'), plate: ${q('.plate')}.className, anim: getComputedStyle(${q('.plate')}, '::after').animationName, after: getComputedStyle(${q('.plate')}, '::after').content }; })()`);
    ok(look.bg === 'rgb(16, 18, 20)' && /Segoe UI/.test(look.font), 'panel: near-black, Segoe UI (' + JSON.stringify(look) + ')');
    ok(look.tone === '', 'panel: no chalk edge while the step is still ahead (' + look.tone + ')');
    ok(look.ring === '' && look.plate === 'plate' && look.after === 'none', 'panel: a countdown never rings (the plate alone) (' + JSON.stringify(look) + ')');
    // The body's "Pumping Iron ↗" (the bar has a small ↗ too).
    await page.locator('#pi-overlay .cta.open').click();
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
    // Round 8: at 1,200 px the margin (88 px free) holds the smallest tag: it stays beside Torn's page, under its header
    // (it went to the window's corner, over the header, although it fits). At 1,100 px no margin holds a tag: the corner.
    for (const [w, tier, where] of [[1440, 'narrow', 'margin'], [1280, 'compact', 'margin'], [1200, 'mini', 'margin'], [1100, 'mini', 'corner']]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(400);
        const fit = await page.evaluate(`(() => { const w = ${q('.wrap')}; const r = w.getBoundingClientRect(); return { fit: w.getAttribute('data-fit'), folded: w.classList.contains('collapsed'), l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), font: getComputedStyle(w).fontSize }; })()`);
        const pageL = (w - 976) / 2;
        const beside = fit.r <= pageL || fit.l >= pageL + 976;
        const clear = where === 'margin' ? beside && fit.t > 40 : fit.t <= 4 + 1;
        ok(fit.fit === tier && clear && (tier === 'narrow' ? !fit.folded && fit.font === '12px' : fit.folded), 'fit at ' + w + ' px: ' + tier + (where === 'margin' ? ', beside Torn\'s page and under its header' : ', the window\'s corner (no margin holds a tag)') + ', never over Torn\'s page (' + JSON.stringify(fit) + ')');
        await page.screenshot({ path: resolve(shots, 'torn-panel-' + w + '.png') });
    }
    await page.close();
}

/* Round 8, the owner's pick B (mockups/round8/steps-panel.html): a step due now is its actions in order, the one of the
   moment in the bar and in big type, and the header's plate rings (one ring, so it shows when the panel is folded too).
   The ring moves with opacity and transform only; it is drawn still with Settings › Animations off and under the PC's
   "reduce motion". */
{
    // The Xanax cooldown is over: Xanax #1 is due.
    const { page, errors } = await open('page=other&drug=0', { width: 1600 });
    const panel = () => page.evaluate(() => {
        const sr = document.getElementById('pi-overlay').shadowRoot;
        const w = sr.querySelector('.wrap');
        const plate = sr.querySelector('.plate');
        const after = getComputedStyle(plate, '::after');
        const go = sr.querySelector('.cta.go');
        const mid = (() => { if (!go) return null; const r = go.getBoundingClientRect(); const t = document.createRange(); t.selectNodeContents(go); const tr = t.getBoundingClientRect(); return Math.round(Math.abs((tr.top + tr.bottom) / 2 - (r.top + r.bottom) / 2)); })();
        const pr = plate.getBoundingClientRect();
        const wr = w.getBoundingClientRect();
        return {
            head: sr.querySelector('.head').textContent.replace(/\s+/g, ' ').trim(), tone: w.getAttribute('data-tone'), ring: w.getAttribute('data-ring'), plates: sr.querySelectorAll('.plate').length, rings: sr.querySelectorAll('.ring').length,
            anim: after.animationName, opacity: after.opacity, transform: after.transform, still: w.classList.contains('still'), folded: w.classList.contains('collapsed'),
            lbl: (sr.querySelector('.lbl') || {}).textContent, step: (sr.querySelector('.step') || {}).textContent, sub: (sr.querySelector('.sub') || {}).textContent,
            rail: [...sr.querySelectorAll('.prail .pr1')].map((r) => (r.classList.contains('done') ? '✓ ' : r.classList.contains('now') ? '● ' : '○ ') + r.textContent.trim()), ticks: sr.querySelectorAll('.prail .pr1.done svg.tick').length,
            ctas: [...sr.querySelectorAll('.body .cta')].map((c) => c.textContent), go: go && go.getAttribute('href'), mid,
            // The ring at its largest (1.45 ×) stays inside the panel's own box (it is never drawn over Torn's page).
            inside: pr.left - 0.225 * pr.width >= wr.left && pr.top - 0.225 * pr.height >= wr.top,
        };
    });
    const due = await panel();
    ok(/^Now\s?Take Xanax #1/.test(due.head), 'panel, a step due: "Now" and the action of the moment in the bar (' + due.head + ')');
    ok(due.lbl === 'Now' && due.step === 'Take Xanax #1' && /^then train (STR|SPD|DEF|DEX) × \d+ · about \+[\d,]+ · \d+ energy$/.test(due.sub) && due.tone === 'chalk', 'panel, a step due: the action of the moment in big type, what follows on one line, a chalk edge (' + JSON.stringify([due.lbl, due.step, due.sub, due.tone]) + ')');
    ok(due.rail.length === 2 && due.rail[0] === '● Take Xanax #1' && /^○ Train (STR|SPD|DEF|DEX) × \d+$/.test(due.rail[1]), 'panel, a step due: its actions in order, the one to do now marked (' + due.rail.join(' | ') + ')');
    ok(due.ring === '1' && due.plates === 1 && due.rings === 1 && due.anim === 'pi-ring-in' && due.inside, 'panel, a step due: the header\'s plate rings, the panel\'s one ring, inside the panel (' + JSON.stringify({ ring: due.ring, rings: due.rings, anim: due.anim, inside: due.inside }) + ')');
    ok(due.ctas.join('|') === 'Open Items|Pumping Iron ↗' && due.go === 'https://www.torn.com/item.php', 'panel, a step due: the button follows the action of the moment ("Open Items" for the Xanax), the webpage beside it (' + due.ctas.join('|') + ')');
    ok(due.mid !== null && due.mid <= 1, 'panel: the button text is centred (' + due.mid + ' px off)');
    // Round 9 (the owner's pick 1B): the step's items as tiles in the panel, on every Torn page. Reads only: Show is a
    // link to Torn's items page.
    const tiles = await panelTiles(page);
    const t0 = tiles.tiles[0] || {};
    ok(tiles.lbl === 'For this step' && tiles.tiles.length === 1 && t0.nm === 'Xanax' && /^Ready · energy \d+ → \d+$/.test(t0.st) && t0.tone === 't-green' && !t0.off, 'panel tiles, a step due: the Xanax is ready, with the energy it gives (' + JSON.stringify(t0) + ')');
    ok(t0.show === 'A:https://www.torn.com/item.php' && t0.go, 'panel tiles: Show is a link to Torn’s items page, the tile’s one button (' + t0.show + ')');
    ok(/^you hold 1 · the plan takes \d+ before Fri$/.test(t0.hold) && t0.low && /^Buy \d+ more before Friday$/.test(tiles.warn || ''), 'panel tiles, running low: what you hold against the Buy list’s three days, and how many to buy (' + t0.hold + ' | ' + tiles.warn + ')');
    ok(tiles.inside && tiles.buttons === 0, 'panel tiles: inside the panel, and no button of ours that uses an item (' + JSON.stringify([tiles.inside, tiles.buttons]) + ')');
    await page.screenshot({ path: resolve(shots, 'torn-panel-due.png') });
    // Folded to one tag: the ring is still there.
    await page.keyboard.press('Alt+Backquote');
    await page.waitForTimeout(150);
    const folded = await panel();
    ok(folded.folded && folded.rings === 1 && folded.anim === 'pi-ring-in', 'panel, folded: the plate still rings (' + JSON.stringify({ folded: folded.folded, rings: folded.rings, anim: folded.anim }) + ')');
    await page.screenshot({ path: resolve(shots, 'torn-panel-due-folded.png') });
    await page.keyboard.press('Alt+Backquote');
    // The PC's "reduce motion": nothing moves, the ring stays drawn around the plate.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(150);
    const reduced = await panel();
    ok(reduced.anim === 'none' && reduced.opacity === '0.55' && /matrix\(1\.3, 0, 0, 1\.3/.test(reduced.transform), 'panel, reduce motion: the ring is drawn still (' + JSON.stringify([reduced.anim, reduced.opacity, reduced.transform]) + ')');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // Settings › Animations off: the same.
    await page.evaluate(() => {
        window.GM_setValue('pumpingIron.v1.settings', JSON.stringify({ motion: false }));
        window.__pi.refresh();
    });
    await page.waitForTimeout(1500);
    const off = await panel();
    ok(off.still && off.rings === 1 && off.anim === 'none' && off.opacity === '0.55', 'panel, Animations off: the ring is drawn still (' + JSON.stringify([off.still, off.rings, off.anim, off.opacity]) + ')');
    await page.screenshot({ path: resolve(shots, 'torn-panel-due-still.png') });
    ok(errors.length === 0, 'panel, a step due: no page errors ' + JSON.stringify(errors.slice(0, 2)));
    await page.close();
}
{
    // A jump mid-way: the 5 EDVD are in (happy 17,525 of 5,025 on Torn's bar), the Ecstasy is the action of the moment.
    const { page, errors } = await open('page=other&fixture=gym&energy=1000&happy=17525&drug=0', { width: 1600 });
    await page.evaluate(() => window.__pi.followStrategy('edvdJump'));
    // Torn's page centred (the fixture carries no Torn CSS), so the margin holds the full panel.
    await gymLayout(page);
    await page.waitForTimeout(1500);
    const v = await page.evaluate(() => {
        const sr = document.getElementById('pi-overlay').shadowRoot;
        const w = sr.querySelector('.wrap');
        return {
            head: sr.querySelector('.head').textContent.replace(/\s+/g, ' ').trim(), cd: (sr.querySelector('.head .cd') || {}).textContent, tone: w.getAttribute('data-tone'), rings: sr.querySelectorAll('.ring').length,
            lbl: (sr.querySelector('.lbl') || {}).textContent, step: (sr.querySelector('.step') || {}).textContent, sub: (sr.querySelector('.sub') || {}).textContent, warn: (sr.querySelector('.warn') || {}).textContent,
            rail: [...sr.querySelectorAll('.prail .pr1')].map((r) => (r.classList.contains('done') ? '✓ ' : r.classList.contains('now') ? '● ' : '○ ') + r.textContent.trim()), ticks: sr.querySelectorAll('.prail .pr1.done svg.tick').length,
            ctas: [...sr.querySelectorAll('.body .cta')].map((c) => c.textContent),
        };
    });
    ok(/^\d+:\d\d$/.test(v.cd || '') && /Take the Ecstasy/.test(v.head) && !/^Now/.test(v.head), 'panel, a jump mid-way: the bar counts down to the tick and says "Take the Ecstasy" (' + v.head + ')');
    ok(/^Jump · finish before \d\d:\d\d$/.test(v.lbl || '') && v.step === 'Take the Ecstasy' && /^then train it all · about \+[\d,]+ · 1,000 energy$/.test(v.sub || '') && v.tone === 'red', 'panel, a jump mid-way: the Ecstasy in big type, "then train it all", red until it is in (' + JSON.stringify([v.lbl, v.step, v.sub, v.tone]) + ')');
    ok(v.rail[0] === '✓ EDVD × 5' && v.rail[1] === '● Take the Ecstasy' && /^○ Train it all/.test(v.rail[2] || '') && v.ticks === 1, 'panel, a jump mid-way: the eaten EDVD keep their name and are ticked, the Ecstasy is marked (' + v.rail.join(' | ') + ')');
    ok(v.rings === 1 && v.ctas[0] === 'Open Items', 'panel, a jump mid-way: one ring, and "Open Items" first (' + v.rings + ', ' + v.ctas.join('|') + ')');
    ok(/^Strict: /.test(v.warn || ''), 'panel, a jump mid-way: the strict warning (' + v.warn + ')');
    await page.screenshot({ path: resolve(shots, 'torn-panel-jump.png') });
    ok(errors.length === 0, 'panel, a jump mid-way: no page errors ' + JSON.stringify(errors.slice(0, 2)));
    await page.close();
}

// Session 9 (the owner's screenshot): he trained, the bar showed 0 / 150 and the card still said "Train DEX × 6 ·
// 150 energy" until the next read. `bar=0` is Torn's sidebar after the train, `energy=150` the read from before it.
{
    const before = await open('page=other&fixture=gym&energy=150', { width: 1600 });
    const had = await panelText(before.page);
    ok(/Train (STR|SPD|DEF|DEX)/.test(had) && /150 energy/.test(had), 'panel, energy at hand: the train is the step now (' + had.slice(0, 90) + ')');
    await before.page.close();
    const { page, errors } = await open('page=other&fixture=gym&energy=150&bar=0', { width: 1600 });
    const said = await panelText(page);
    ok(!/· 150 energy/.test(said) && /Session done/.test(said) && /Next at \d\d:\d\d: /.test(said), 'panel, the bar at 0 after a train: the card moves to the next step, never the train just done (' + said.slice(0, 120) + ')');
    ok(/0 \/ 150/.test(said), 'panel: the energy shown is the bar’s');
    await page.screenshot({ path: resolve(shots, 'torn-panel-after-train.png') });
    ok(errors.length === 0, 'panel after a train: no page errors ' + JSON.stringify(errors.slice(0, 2)));
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
const panelRect = (page) => page.evaluate(() => { const h = document.getElementById('pi-overlay'); const w = h && h.shadowRoot && h.shadowRoot.querySelector('.wrap'); if (!w) return null; const r = w.getBoundingClientRect(); return r.width ? { left: r.left, right: r.right, top: r.top, bottom: r.bottom, fit: w.getAttribute('data-fit'), docked: w.classList.contains('docked') } : null; });
// Round 7 review: the panel is never over Torn's page (sidebar + content): in a margin, or the smallest tag in the window's top corner.
const panelClear = (pr, torn) => Boolean(pr) && (pr.right <= torn.left + 1 || pr.left >= torn.right - 1 || (pr.fit === 'mini' && pr.top <= 5));
{
    const { page, errors, tornHits } = await open('page=profile&XID=605123&fixture=profile&ffs=1&who=owner', { wait: 6000 });
    const card = () => page.evaluate(() => {
        const c = document.querySelector('#pi-eye-layer [data-pi-part="profile"] .pi-card');
        if (!c) return null;
        const r = c.getBoundingClientRect();
        return { mode: c.getAttribute('data-pi-mode'), text: c.textContent.replace(/\s+/g, ' ').trim(), left: r.left, right: r.right, top: r.top, bottom: r.bottom, titleTop: document.querySelector('.content-title').getBoundingClientRect().top, font: getComputedStyle(c.querySelector('.pi-band')).fontFamily };
    });
    for (const [w, mode, side, shift] of [[1600, 'full', 'right', 0], [1366, 'mid', 'right', 0], [1280, 'small', 'right', 0], [1200, 'small', 'right', 0], [1440, 'full', 'left', 120]]) {
        await page.setViewportSize({ width: w, height: 900 });
        await tornLayout(page, shift);
        const c = await card();
        const torn = await tornRect(page);
        ok(c && c.mode === mode, 'eye profile ' + w + ' px: the ' + mode + ' card (' + (c && c.mode) + ', free ' + Math.round(side === 'right' ? w - torn.right : torn.left) + ' px)');
        if (!c) continue;
        ok(side === 'right' ? c.left >= torn.right && c.right <= w : c.right <= torn.left && c.left >= 0, 'eye profile ' + w + ' px: in the free space on the ' + side + ', never on Torn’s page (' + Math.round(c.left) + '–' + Math.round(c.right) + ', Torn ' + Math.round(torn.left) + '–' + Math.round(torn.right) + ')');
        ok(Math.abs(c.top - c.titleTop) <= 2, 'eye profile ' + w + ' px: level with the profile title (' + Math.round(c.top) + ' vs ' + Math.round(c.titleTop) + ')');
        ok(/Segoe UI|system-ui/.test(c.font.split(',')[0]), 'eye profile: Segoe UI / system-ui (' + c.font + ')');
        // The panel folds under #pi-eyecard when the card took its margin (src/ui/overlay.js dockIfShared; its tick is 1 s).
        await page.waitForTimeout(1300);
        const pr = await panelRect(page);
        ok(!overlaps(c, pr), 'eye profile ' + w + ' px: the training panel never covers the card (panel ' + JSON.stringify(pr) + ')');
        ok(panelClear(pr, torn), 'eye profile ' + w + ' px: the training panel is never over Torn’s page (panel ' + JSON.stringify(pr) + ', Torn ' + Math.round(torn.left) + '–' + Math.round(torn.right) + ')');
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
    // Torn's profile and its mini-profile popup lay out as they do without our script (the last window: 1440, off centre).
    await layoutUntouched('profile + mini-profile', page, 'page=profile&XID=605123&fixture=profile&ffs=1&who=owner', { width: 1440, prep: (p) => tornLayout(p, 120) });
    // Round 6 (owner): Torn's pages ask only about the player viewed or attacked; a mini-profile shows what is known.
    // Round 7 (owner): its tag is on our layer just under the popup, as wide as it, never inside or over it. Torn's popup
    // floats over the page (here: 320 px wide at 400, 300; Torn moves it by its style, which our tag follows).
    const popAt = (top) => page.evaluate((t) => { document.querySelector('#profile-mini-root .mini-profile-wrapper').setAttribute('style', 'position:absolute;left:400px;top:' + t + 'px;width:320px;background:#242424'); }, top);
    await popAt(300);
    await page.waitForTimeout(300);
    const mini = await page.evaluate(() => {
        const m = document.querySelector('#pi-eye-layer [data-pi-part="mini"] .pi-mini-line');
        if (!m) return null;
        const r = m.getBoundingClientRect();
        const p = document.querySelector('#profile-mini-root .mini-profile-wrapper').getBoundingClientRect();
        return { text: m.textContent.replace(/\s+/g, ' ').trim(), width: Math.abs(r.left - p.left) <= 1 && Math.abs(r.right - p.right) <= 1, under: r.top >= p.bottom - 0.5 && r.top - p.bottom <= 8, notInside: !document.querySelector('#profile-mini-root .pi-mark, #profile-mini-root [class*="pi-"]') };
    });
    ok(mini && mini.text.length > 0 && mini.width && mini.under && mini.notInside, 'eye: the mini-profile gets one tag on our layer just under the popup, as wide as it, nothing inside it (' + JSON.stringify(mini) + ')');
    // The popup low in the window: the tag goes above it, still inside the window and never over it.
    const vh = await page.evaluate(() => innerHeight + scrollY);
    await popAt(vh - 200);
    await page.waitForTimeout(300);
    const above = await page.evaluate(() => {
        const r = document.querySelector('#pi-eye-layer [data-pi-part="mini"] .pi-mini-line').getBoundingClientRect();
        const p = document.querySelector('#profile-mini-root .mini-profile-wrapper').getBoundingClientRect();
        return { bottom: Math.round(r.bottom), popTop: Math.round(p.top), top: Math.round(r.top), popBottom: Math.round(p.bottom), vh: innerHeight };
    });
    ok((above.bottom <= above.popTop || above.top >= above.popBottom) && above.top >= 0 && above.bottom <= above.vh, 'eye: a popup low in the window: the tag stays in the window, never over the popup (' + JSON.stringify(above) + ')');
    await page.screenshot({ path: resolve(shots, 'torn-eye-mini.png') });
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
    await page.goto('http://127.0.0.1:' + PORT + '/test/harness-live.html?key=1&at=2026-09-29T10:48:00Z&wait=100000&plan=1&follow=steady&page=faction&ID=7777&fixture=faction&ffs=1&who=owner');
    await page.waitForTimeout(6500);
    await tornLayout(page);
    await layoutUntouched('faction + war list', page, 'page=faction&ID=7777&fixture=faction&ffs=1&who=owner', { width: 1600, prep: (p) => tornLayout(p) });
    // Round 7 (owner): Torn's war list keeps its own order and look (no CSS order, no flex of ours): shown as in the DOM.
    const order = await page.evaluate(() => [...document.querySelectorAll('#faction_war_list_id li.enemy')].sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top).map((li) => li.querySelector('.member a[href*="XID"]').getAttribute('aria-label').replace('View profile of ', '')));
    const domOrder = await page.evaluate(() => [...document.querySelectorAll('#faction_war_list_id li.enemy .member a[href*="XID"]')].map((a) => a.getAttribute('aria-label').replace('View profile of ', '')));
    ok(JSON.stringify(domOrder) === JSON.stringify(['Flyer', 'Mira_Vex', 'Rival', 'Brix']), "war: Torn's rows are not moved in the page");
    ok(JSON.stringify(order) === JSON.stringify(domOrder), 'war: Torn’s rows shown in Torn’s own order, never reordered by us (' + order + ')');
    const styled = await page.evaluate(() => [...document.querySelectorAll('#faction_war_list_id li, #faction_war_list_id ul')].filter((e) => e.style.order || /\bpi-/.test(e.className)).length);
    ok(styled === 0, 'war: no CSS order or class of ours on Torn’s list (' + styled + ')');
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
            out[name] = t ? { text: t.textContent.replace(/\s+/g, ' ').trim(), dim: t.classList.contains('pi-out'), level: tr.top >= r.top - 1 && tr.bottom <= r.bottom + 1, glow: t.classList.contains('pi-glow'), left: tr.left } : null;
        }
        return out;
    });
    const t1 = await tags();
    const torn = await tornRect(page);
    ok(t1.Rival && /^(Stomp|Good|Fair)/.test(t1.Rival.text) && t1.Rival.level && t1.Rival.left >= torn.right, 'war: the estimate stored by an earlier page shows as a tag in the free space, level with its row (' + JSON.stringify(t1.Rival) + ')');
    ok(t1.Flyer === null, 'war: a fight you lose (under half your HP kept) is never shown (' + JSON.stringify(t1.Flyer) + ')');
    ok(t1.Mira_Vex === null, 'war: no tag where nothing is known, never "No data"');
    // Round 8 (his pick B): the war row's tag is the band, HP kept, then where they are.
    ok(t1.Rival && /^(Stomp|Good|Fair)\s?\d+% HP\s?Okay$/.test(t1.Rival.text), 'war: a ready row says the band, HP kept, Okay (' + JSON.stringify(t1.Rival) + ')');
    ok(t1.Brix && t1.Brix.dim && /^Good\s?81% HP\s?Hospital$/.test(t1.Brix.text), "war: a hospital row's tag fades its band and number, and says Hospital (" + JSON.stringify(t1.Brix) + ')');
    ok(t1.Rival && t1.Rival.glow && t1.Brix && !t1.Brix.glow, 'war: the best ready row is the one that glows');
    // Torn's status cell shows the clock: "out in 1:17".
    await page.evaluate(() => {
        const li = [...document.querySelectorAll('#faction_war_list_id li.enemy')].find((x) => /Brix/.test(x.textContent));
        li.querySelector('.status').textContent = 'Hospital 01:17:00';
    });
    await page.waitForTimeout(1600);
    const t2 = await tags();
    ok(t2.Brix && /^Good\s?81% HP\s?Hospital 1h 1[67]m$/.test(t2.Brix.text), 'war: "Hospital 1h 17m" from Torn\'s clock (' + JSON.stringify(t2.Brix) + ')');
    const sum = await page.evaluate(() => { const s = document.querySelector('#pi-eye-layer [data-pi-part="war"] .pi-sum'); return s ? { text: s.textContent.replace(/\s+/g, ' ').trim(), title: s.title, bottom: s.getBoundingClientRect().bottom } : null; });
    const firstRow = await page.evaluate(() => Math.min(...[...document.querySelectorAll('#faction_war_list_id li.enemy')].map((li) => li.getBoundingClientRect().top)));
    ok(sum && /^1 ready · next out in 1h 1[67]m · 1 away/.test(sum.text) && /live war mode on Pumping Iron’s Torn Eye tab/.test(sum.title) && sum.bottom <= firstRow, 'war: the summary tag on top (' + JSON.stringify(sum) + ')');
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
    // Round 7 review (6): the panel and Torn Eye's list tags never share a margin. Torn's page off centre (112 px on the
    // right, 352 on the left, where the panel is): the tags take the right; the panel keeps out of their column.
    const ourTags = () => page.evaluate(() => [...document.querySelectorAll('#pi-eye-layer .pi-rowtag, #pi-eye-layer .pi-sum')].filter((t) => t.style.display !== 'none').map((t) => { const r = t.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }));
    for (const [w, shift] of [[1600, 0], [1280, 0], [1440, 120]]) {
        await page.setViewportSize({ width: w, height: 900 });
        await tornLayout(page, shift);
        await page.waitForTimeout(2300);
        const pr = await panelRect(page);
        const ts = await ourTags();
        const tw = await tornRect(page);
        const hit = ts.filter((t) => pr && t.left < pr.right && pr.left < t.right);
        ok(ts.length > 0 && hit.length === 0 && panelClear(pr, tw) && ts.every((t) => t.left >= tw.right - 1 || t.right <= tw.left + 1), 'war ' + w + ' px' + (shift ? ' (Torn’s page off centre)' : '') + ': the panel never shares a column with Torn Eye’s tags, neither is over Torn’s page (panel ' + JSON.stringify(pr) + ', tags ' + JSON.stringify(ts.slice(0, 2)) + ', Torn ' + Math.round(tw.left) + '–' + Math.round(tw.right) + ')');
    }
    await page.setViewportSize({ width: 1600, height: 900 });
    await tornLayout(page, 0);
    await page.waitForTimeout(1300);
    // Round 7 review (5): the hospital clock ticking in Torn's status cell no longer rebuilds every tag each second.
    await page.evaluate(() => {
        const t = document.querySelector('#pi-eye-layer [data-pi-part="war"] .pi-rowtag[data-pi-player="424242"]');
        if (t) t.__probe = 1;
    });
    for (const clock of ['01:16:58', '01:16:57', '01:16:56']) {
        await page.evaluate((c) => {
            const li = [...document.querySelectorAll('#faction_war_list_id li.enemy')].find((x) => /Brix/.test(x.textContent));
            li.querySelector('.status').textContent = 'Hospital ' + c;
        }, clock);
        await page.waitForTimeout(1050);
    }
    const kept = await page.evaluate(() => { const t = document.querySelector('#pi-eye-layer [data-pi-part="war"] .pi-rowtag[data-pi-player="424242"]'); return Boolean(t && t.__probe); });
    ok(kept, 'war: a ticking hospital clock does not rebuild the tags (focus and hover stay)');
    // Out early: Brix leaves hospital with over an hour left. It stays "out early" (it lasted a second before).
    await page.evaluate(() => {
        const li = [...document.querySelectorAll('#faction_war_list_id li.enemy')].find((x) => /Brix/.test(x.textContent));
        li.querySelector('.status').textContent = 'Okay';
    });
    await page.waitForTimeout(1500);
    const e1 = (await tags()).Brix;
    await page.waitForTimeout(3200);
    const e2 = (await tags()).Brix;
    const sum2 = await page.evaluate(() => { const s = document.querySelector('#pi-eye-layer [data-pi-part="war"] .pi-sum'); return s ? s.textContent.replace(/\s+/g, ' ').trim() : ''; });
    ok(e1 && /Out early/.test(e1.text) && e2 && /Out early/.test(e2.text) && !e2.dim && /\(1 out early\)/.test(sum2), 'war: "out early" stays until the hospital end it left (' + JSON.stringify([e1 && e1.text, e2 && e2.text, sum2]) + ')');
    // Round 6 (owner): no Torn Eye reads for faction or war lists on Torn's pages (the Torn Eye tab does war mode).
    const calls = await page.evaluate(() => window.__calls.filter((c) => /faction|\/profile|get-stats/.test(c)).length);
    ok(calls === 0, 'war: nothing asked on a faction page (' + calls + ')');
    ok(errors.length === 0, 'war: no page errors ' + JSON.stringify(errors));
    await page.close();
}
/* Round 8 (his pick B): the chain counter. On Torn's war page it is its own card above the training panel, in the
   free space: both chains with the count, the time left of 5:00 (amber under a minute) and the hits to the next bonus.
   Yours is Torn's own sidebar bar; the enemy's is what the Torn Eye tab's read left in shared storage. A narrow margin:
   two thin lines. Chain mode: the counter shows on the other Torn pages too, and over the attack page's fight card. */
const chainCard = (page) => page.evaluate(() => {
    const c = document.getElementById('pi-chaincard');
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { form: c.getAttribute('data-pi-form'), text: c.textContent.replace(/\s+/g, ' ').trim(), lines: [...c.querySelectorAll('.pi-cline')].map((l) => l.textContent.replace(/\s+/g, ' ').trim()), low: [...c.querySelectorAll('.pi-ctime, .pi-cline b[data-pi-chain-until]')].map((e) => e.classList.contains('pi-low')), left: r.left, right: r.right, top: r.top, bottom: r.bottom, font: getComputedStyle(c).fontFamily, inTorn: Boolean(c.closest('.content-wrapper, #sidebarroot')), fixed: getComputedStyle(c).position };
});
{
    const T0 = Date.parse('2026-09-29T10:48:00Z');
    const seed = {
        'pumpingIron.v1.eyeWarBands': JSON.stringify({ at: T0 - 480000, fid: 7777, p: { 424242: ['good', 95, 81], 777001: ['good', 92, 81], 777002: ['stomp', 100, 100] } }),
        // The enemy's chain as the Torn Eye tab read it a second ago: 96, 45 s left on its timer.
        'pumpingIron.v1.eyeChain': JSON.stringify({ at: T0 + 1000, fid: 7777, name: 'Rival Syndicate', current: 96, max: 100, until: T0 + 46000, cooldownUntil: 0 }),
    };
    const { page, errors } = await open('page=faction&ID=7777&fixture=faction&ffs=1&who=owner&chain=247/250/222', { wait: 6500, width: 1600, seed });
    await tornLayout(page);
    await page.waitForTimeout(1500);
    const c = await chainCard(page);
    const torn = await tornRect(page);
    const pr = await panelRect(page);
    ok(c && c.form === 'card' && /^Chains\s?time left of 5:00\s?Your faction\s?3:[23]\d\s?247\s?3 hits to the 250 bonus\s?Rival Syndicate\s?0:[0-4]\d\s?96\s?4 hits to the 100 bonus$/.test(c.text), 'chain counter: both chains on the war page, the count, the time left and the hits to the next bonus (' + (c && c.text) + ')');
    ok(c && JSON.stringify(c.low) === '[false,true]', 'chain counter: the timer under 1:00 is amber (' + (c && c.low) + ')');
    ok(c && pr && pr.top >= c.bottom && pr.top - c.bottom <= 12 && Math.abs(pr.left - c.left) <= 1 && Math.abs(pr.right - c.right) <= 1, 'chain counter: its own card above the training panel, the panel right under it (card ' + JSON.stringify(c && { l: c.left, r: c.right, t: c.top, b: c.bottom }) + ', panel ' + JSON.stringify(pr) + ')');
    ok(c && (c.left >= torn.right || c.right <= torn.left) && !c.inTorn && c.fixed === 'fixed' && /Segoe UI|system-ui/.test(c.font.split(',')[0]), 'chain counter: in the free space on our own layer, never on or in Torn’s page (' + Math.round(c && c.left) + '–' + Math.round(c && c.right) + ', Torn ' + Math.round(torn.left) + '–' + Math.round(torn.right) + ')');
    const tagRects = await page.evaluate(() => [...document.querySelectorAll('#pi-eye-layer .pi-rowtag, #pi-eye-layer .pi-sum')].filter((t) => t.style.display !== 'none').map((t) => { const r = t.getBoundingClientRect(); return { left: r.left, right: r.right, text: t.textContent.replace(/\s+/g, ' ').trim() }; }));
    ok(tagRects.length >= 3 && c && tagRects.every((t) => t.right <= c.left || t.left >= c.right), 'chain counter: the row tags keep to the other margin (' + JSON.stringify(tagRects.slice(0, 2)) + ')');
    ok(tagRects.some((t) => /^Good\s?81% HP\s?Okay$/.test(t.text)) && tagRects.some((t) => /^\d ready · /.test(t.text) && / away/.test(t.text)), 'war rows with it: band, HP kept, where they are; the summary on top (' + tagRects.map((t) => t.text).join(' | ') + ')');
    ok((await glows(page)) <= 1, 'chain counter: it never glows; at most the best ready row does (' + (await glows(page)) + ')');
    await page.screenshot({ path: resolve(shots, 'torn-eye-chain-war.png') });
    // A hit: Torn's bar moves, the counter follows within a second or two.
    await page.evaluate(() => { window.__chainHold = true; document.querySelector('#barChain [class*="bar-value___"]').textContent = '248/250'; document.querySelector('#barChain [class*="bar-timeleft___"]').textContent = '05:00'; });
    await page.waitForTimeout(1600);
    const hit = await chainCard(page);
    ok(hit && /Your faction\s?(5:00|4:5\d)\s?248\s?2 hits to the 250 bonus/.test(hit.text), 'chain counter: a hit moves it (Torn’s own bar, read each second) (' + (hit && hit.text.slice(0, 80)) + ')');
    // Far down a long list it is still on screen (the pick's point).
    await page.evaluate(() => { document.body.style.minHeight = '3000px'; scrollTo(0, 900); });
    await page.waitForTimeout(400);
    const down = await chainCard(page);
    ok(down && Math.abs(down.top - c.top) <= 1 && down.bottom <= 900, 'chain counter: always on screen, even far down the list (' + JSON.stringify(down && { t: down.top, b: down.bottom }) + ')');
    await page.evaluate(() => scrollTo(0, 0));
    // A narrow window: two thin lines, still above the panel and off Torn's page.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(2400);
    const n = await chainCard(page);
    const pr2 = await panelRect(page);
    const torn2 = await tornRect(page);
    ok(n && n.form === 'lines' && n.lines.length === 2 && /^You 248 · \d:\d\d · 2 to 250$/.test(n.lines[0]) && /^Them 96 · (\d:\d\d · 4 to 100|no chain)$|^Them 0 · no chain$/.test(n.lines[1]), 'chain counter 1280 px: two thin lines, one a chain (' + JSON.stringify(n && n.lines) + ')');
    ok(n && (n.left >= torn2.right - 1 || n.right <= torn2.left + 1) && pr2 && pr2.top >= n.bottom - 1 && panelClear(pr2, torn2), 'chain counter 1280 px: beside Torn’s page, the panel under it (lines ' + JSON.stringify(n && { l: n.left, r: n.right, b: n.bottom }) + ', panel ' + JSON.stringify(pr2) + ')');
    await page.screenshot({ path: resolve(shots, 'torn-eye-chain-war-1280.png') });
    const calls = await page.evaluate(() => window.__calls.filter((x) => /faction/.test(x)).length);
    ok(calls === 0, 'chain counter: Torn’s war page asks nothing for it (' + calls + ')');
    ok(errors.length === 0, 'chain counter: no page errors ' + JSON.stringify(errors));
    await page.close();
}
{
    // Chain mode (the Torn Eye tab's card, the same state as "I'm stacking"): the counter shows on Torn's other pages too.
    const T0 = Date.parse('2026-09-29T10:48:00Z');
    const stacking = { 'pumpingIron.v1.stackingChain': JSON.stringify({ since: T0 - 600000 }) };
    const g = await open('page=gym&fixture=gym&chain=12/25/200', { wait: 5500, width: 1600, seed: stacking });
    await tornLayout(g.page);
    await g.page.waitForTimeout(1500);
    const c = await chainCard(g.page);
    const pr = await panelRect(g.page);
    const body = await panelText(g.page);
    ok(c && c.form === 'card' && /^Chain\s?time left of 5:00\s?Your faction\s?3:[01]\d\s?12\s?13 hits to the 25 bonus$/.test(c.text), 'chain mode: the chain counter shows on the gym page, your chain alone (' + (c && c.text) + ')');
    ok(c && pr && pr.top >= c.bottom && Math.abs(pr.left - c.left) <= 1 && /Stacking for a chain/.test(body), 'chain mode: the counter above the panel, the panel says Stacking (' + JSON.stringify(pr) + ')');
    ok(g.errors.length === 0, 'chain mode: no page errors ' + JSON.stringify(g.errors));
    await g.page.screenshot({ path: resolve(shots, 'torn-eye-chain-mode-gym.png') });
    await g.page.close();
    // Chain mode off: no counter away from the war page.
    const off = await open('page=gym&fixture=gym&chain=12/25/200', { wait: 5500, width: 1600 });
    await tornLayout(off.page);
    await off.page.waitForTimeout(1300);
    ok((await chainCard(off.page)) === null, 'chain mode off: no chain counter on the gym page');
    await off.page.close();
    // The attack page in chain mode: the counter's line over the fight card, the card under it, the panel under the card.
    const a = await open('page=attack&user2ID=424242&fixture=attack&ffs=1&who=owner&chain=12/25/200', { wait: 6000, width: 1600, seed: stacking });
    await tornLayout(a.page);
    await a.page.waitForTimeout(2400);
    const ac = await chainCard(a.page);
    const fight = await rectOf(a.page, '#pi-eyecard');
    const apr = await panelRect(a.page);
    const at = await tornRect(a.page);
    ok(ac && ac.form === 'lines' && /^You 12 · \d:\d\d · 13 to 25$/.test(ac.lines[0]) && ac.left >= at.right, 'chain mode, attack page: the counter as a thin line beside the fight (' + JSON.stringify(ac && ac.lines) + ')');
    ok(ac && fight && fight.top >= ac.bottom && fight.top - ac.bottom <= 12 && Math.abs(fight.left - ac.left) <= 1 && apr && apr.top >= fight.bottom - 1 && !overlaps(fight, apr), 'chain mode, attack page: the fight card under the counter, the panel under the card (counter b ' + Math.round(ac && ac.bottom) + ', card ' + JSON.stringify(fight && { t: fight.top, b: fight.bottom }) + ', panel ' + JSON.stringify(apr) + ')');
    ok(a.errors.length === 0, 'chain mode, attack page: no page errors ' + JSON.stringify(a.errors));
    await a.page.screenshot({ path: resolve(shots, 'torn-eye-chain-mode-attack.png') });
    await a.page.close();
}
{
    const { page, errors } = await open('page=attack&user2ID=424242&fixture=attack&ffs=1&who=owner', { wait: 6000 });
    await page.setViewportSize({ width: 1600, height: 900 });
    await tornLayout(page);
    const card = () => page.evaluate(() => { const c = document.getElementById('pi-eyecard'); if (!c) return null; const r = c.getBoundingClientRect(); return { text: c.textContent.replace(/\s+/g, ' ').trim(), mode: c.getAttribute('data-pi-mode'), left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
    const before = await card();
    const torn = await tornRect(page);
    ok(before && /^(Stomp|Good|Fair)/.test(before.text) && /What they were wearing\s?Not seen yet · attack once to read it/.test(before.text), 'attack: the fight card before Start Fight, their gear "Not seen yet" (' + (before && before.text.slice(0, 200)) + ')');
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
    // Round 7 review: the dock forced 160 px under a ~100 px card and reached over the fight (52 px at 1200 px).
    for (const w of [1280, 1200]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.waitForTimeout(1400);
        const c = await card();
        const pr = await panelRect(page);
        const t = await tornRect(page);
        ok(c && c.left >= t.right && !overlaps(c, pr), 'attack ' + w + ' px: the card beside Torn’s page, the training panel never over it (card ' + JSON.stringify(c && { l: Math.round(c.left), r: Math.round(c.right), b: Math.round(c.bottom) }) + ', panel ' + JSON.stringify(pr) + ')');
        ok(panelClear(pr, t), 'attack ' + w + ' px: the training panel is never over Torn’s page (panel ' + JSON.stringify(pr) + ', Torn ' + Math.round(t.left) + '–' + Math.round(t.right) + ')');
        await page.screenshot({ path: resolve(shots, 'torn-eye-attack-' + w + '.png') });
    }
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.waitForTimeout(300);
    await page.evaluate(() => fetch('fixtures/attackData.json?sid=attackData').then((r) => r.json()));
    // Round 8 (B.6): their gear is written at once (it waited 1.5 s after the last answer, and leaving the page lost it).
    await page.waitForTimeout(500);
    const stored = await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('pumpingIron', 1); r.onsuccess = () => { const tx = r.result.transaction('kv', 'readonly'); const g = tx.objectStore('kv').get('eye'); g.onsuccess = () => res(g.result && g.result.gear && Object.keys(g.result.gear)); }; r.onerror = () => res(null); }));
    ok(Array.isArray(stored) && stored.includes('424242'), 'attack: their gear is in IndexedDB half a second after Torn’s answer (' + JSON.stringify(stored) + ')');
    await page.waitForTimeout(700);
    // Round 8 (his pick B): every piece with its own numbers, what the fight counts, and the fight again with their gear.
    const after = await card();
    ok(after && /What they were wearing\s?seen just now\s?Weapons\s?Dmg\s?Acc\s?AK-47\s?Primary · Powerful 23%, Deadeye 41%\s?57\.3\s?49\.1/.test(after.text) && /Tear Gas\s?Temporary/.test(after.text) && /Riot Body\s?Impregnable 12%\s?41\.2/.test(after.text), 'attack: what they were wearing, piece by piece (' + (after && after.text.slice(0, 260)) + ')');
    ok(after && /The fight counts their best weapon \(57\.3 damage, 49\.1 accuracy, \+23%\) and their armour on average/.test(after.text) && /With their gear: win \d+% · HP kept ~\d+%/.test(after.text), 'attack: what the fight counts of it, and the amber line with their gear');
    const gearBox = await page.evaluate(() => { const g = document.querySelector('#pi-eyecard .pi-gear'); const c = document.getElementById('pi-eyecard').getBoundingClientRect(); const r = g.getBoundingClientRect(); const cells = [...g.querySelectorAll('.pi-gt > span')].map((s) => s.getBoundingClientRect()); return { inside: r.left >= c.left && r.right <= c.right + 0.5, cellsInside: cells.every((x) => x.right <= c.right + 0.5), cardBottom: c.bottom, vh: innerHeight }; });
    ok(gearBox.inside && gearBox.cellsInside && gearBox.cardBottom <= gearBox.vh, 'attack: the loadout fits the card, the card fits the window (' + JSON.stringify(gearBox) + ')');
    ok((await glows(page)) <= 1, 'attack: at most one thing of Torn Eye glows (' + (await glows(page)) + ')');
    await page.screenshot({ path: resolve(shots, 'torn-eye-attack.png') });
    // The next visit to their attack page (a load of its own): the gear is there before the fight starts.
    await page.reload();
    await page.waitForTimeout(6000 * (Number(process.env.SLOW) || 1));
    await page.setViewportSize({ width: 1600, height: 900 });
    await tornLayout(page);
    const again = await card();
    ok(again && /What they were wearing\s?seen (just now|\d+ min ago)\s?Weapons/.test(again.text) && /AK-47/.test(again.text), 'attack: on the next visit their gear shows before the fight starts (' + (again && again.text.slice(0, 200)) + ')');
    ok(errors.length === 0, 'attack: no page errors ' + JSON.stringify(errors));
    await page.screenshot({ path: resolve(shots, 'torn-eye-attack-seen.png') });
    // No list handed over by the Torn Eye tab yet: the Next row says so, with a plain button to the list.
    const nolist = await page.evaluate(() => { const b = document.querySelector('#pi-eyecard .pi-nextbox'); const a = b && b.querySelector('a'); return b ? { text: b.textContent.replace(/\s+/g, ' ').trim(), alt: a.classList.contains('pi-alt'), href: a.getAttribute('href') } : null; });
    ok(nolist && /^Open the Torn Eye list\s?Your Torn Eye list is not here yet: open it once\.$/.test(nolist.text) && nolist.alt && /app\.html#eye$/.test(nolist.href), 'next: no list handed over yet, said plainly, with a button to the list (' + JSON.stringify(nolist) + ')');
    await page.close();
}

/* Round 9 (his pick B, mockups/round9/companion.html §2): "Your loadouts against it" on the fight card. A loadout is
   learned on Torn's items page: its number from the text of #loadoutsRoot (a stand-in here: "Loadout #2", the worn
   slots and Torn's own "Loadouts" button, which is never clicked), its gear from the API (one /user/equipment call).
   The attack page then lists the loadouts kept, best first, each against their seen gear. */
{
    const it = await open('page=items&fixture=items&ffs=1&who=owner', { wait: 5000 });
    const standIn = (n, slots) => it.page.evaluate(({ n, slots }) => {
        let box = document.getElementById('loadoutsRoot');
        if (!box) {
            box = document.createElement('div');
            box.id = 'loadoutsRoot';
            document.querySelector('.content-wrapper').prepend(box);
            window.__loadoutClicks = 0;
        }
        box.innerHTML = '<div><span>Loadout #' + n + '</span><button type="button" aria-label="Loadouts">v</button></div><ul>' + slots.map((s) => '<li>' + s + '</li>').join('') + '</ul>';
        box.querySelector('button').addEventListener('click', () => { window.__loadoutClicks++; });
        window.__loadoutHtml = box.innerHTML;
    }, { n, slots });
    const eqCalls = () => it.page.evaluate(() => window.__calls.filter((c) => /\/v2\/user\/equipment/.test(c)).length);
    const kept = () => it.page.evaluate(() => JSON.parse(_store['pumpingIron.v1.eyeLoadouts'] || 'null'));
    ok((await eqCalls()) === 0 && (await kept()) === null, 'loadouts: an items page that names no loadout asks nothing and keeps nothing');
    await standIn(2, ['Primary Minigun', 'Secondary', 'Melee']);
    await it.page.waitForTimeout(1500);
    ok((await eqCalls()) === 0, 'loadouts: the box just seen: not read before it stood still');
    await it.page.waitForTimeout(4500);
    const k1 = await kept();
    ok((await eqCalls()) === 1 && k1 && Object.keys(k1).join() === '2' && k1[2].weapon === 'Minigun' && k1[2].gear && k1[2].gear.dmg === 71.2, 'loadouts: the loadout worn is kept under its number, from one read of your gear (' + (await eqCalls()) + ' calls, ' + JSON.stringify(k1) + ')');
    await it.page.waitForTimeout(3000);
    ok((await eqCalls()) === 1, 'loadouts: standing on the items page asks nothing more');
    // You switch on Torn's own menu (the stand-in's text changes): the new number is read in its turn.
    await standIn(3, ['Primary Minigun', 'Secondary', 'Melee Kodachi']);
    await it.page.waitForTimeout(6000);
    const k2 = await kept();
    ok((await eqCalls()) === 2 && k2 && Object.keys(k2).join() === '2,3', 'loadouts: another loadout worn: kept under its own number, the first one stays (' + (await eqCalls()) + ' calls, ' + JSON.stringify(k2 && Object.keys(k2)) + ')');
    const box = await it.page.evaluate(() => ({ clicks: window.__loadoutClicks, same: document.getElementById('loadoutsRoot').innerHTML === window.__loadoutHtml, ours: document.querySelectorAll('#loadoutsRoot [class*="pi-"], #loadoutsRoot [data-pi]').length }));
    ok(box.clicks === 0 && box.same && box.ours === 0, 'loadouts: Torn’s Loadouts button is never clicked, its box is left as it was (' + JSON.stringify(box) + ')');
    ok(it.tornHits() === 0 && it.errors.length === 0, 'loadouts: nothing asked of torn.com, no page errors ' + JSON.stringify(it.errors));
    const store = await it.page.evaluate(() => ({ ..._store }));
    await it.page.close();

    // The attack page next: what the items page kept (2 is the Minigun on you), and two more worn some days ago.
    const at0 = Date.parse('2026-09-29T10:48:00Z');
    const more = { ...k1, 1: { n: 1, at: at0 - 3 * 86400000, gear: { dmg: 76.5, acc: 63.1, armour: 52.4, dmgBonus: 0 }, weapon: 'Kodachi', armour: 'Dune' }, 4: { n: 4, at: at0 - 12 * 86400000, gear: { dmg: 20.3, acc: 40.2, armour: 25, dmgBonus: 0 }, weapon: 'BT MP9', armour: '' } };
    const { page, errors } = await open('page=attack&user2ID=424242&fixture=attack&ffs=1&who=owner', { wait: 6000, width: 1600, seed: { ...store, 'pumpingIron.v1.eyeLoadouts': JSON.stringify(more) } });
    await tornLayout(page);
    const cardText = () => page.evaluate(() => { const c = document.getElementById('pi-eyecard'); return c ? c.textContent.replace(/\s+/g, ' ').trim() : ''; });
    const unseen = await cardText();
    ok(/Not seen yet · attack once to read it/.test(unseen) && !/Your loadouts/.test(unseen), 'loadouts: their gear not seen yet, the card is as before (' + unseen.slice(0, 160) + ')');
    await page.evaluate(() => fetch('fixtures/attackData.json?sid=attackData').then((r) => r.json()));
    await page.waitForTimeout(1500);
    const lo = await page.evaluate(() => {
        const c = document.getElementById('pi-eyecard');
        const b = c && c.querySelector('[data-pi-loadouts]');
        if (!b) return null;
        const cr = c.getBoundingClientRect();
        const cells = [...b.querySelectorAll('.pi-lot > span')];
        const rows = [];
        for (let i = 0; i < cells.length; i += 3) rows.push({ name: cells[i].textContent.replace(/\s+/g, ' ').trim(), nums: cells[i + 1].textContent.trim(), tag: cells[i + 2].textContent.trim() });
        const warn = (c.querySelector('.pi-warnline') || {}).textContent || '';
        return { text: b.textContent.replace(/\s+/g, ' ').trim(), rows, warn, inside: cells.every((x) => { const r = x.getBoundingClientRect(); return r.left >= cr.left && r.right <= cr.right + 0.5; }), after: Boolean(c.querySelector('.pi-warnline').compareDocumentPosition(b) & 4), pressable: b.querySelectorAll('button, a, input, select, [role="button"], [tabindex]').length, cardBottom: cr.bottom, scrolls: c.scrollHeight > c.clientHeight + 1, vh: innerHeight };
    });
    ok(lo && /^Your loadouts against it\s?win · HP kept/.test(lo.text) && lo.rows.length === 3, 'loadouts: the block under their gear, a row per loadout known (' + JSON.stringify(lo && lo.rows) + ')');
    const onYou = lo && lo.rows.find((r) => /on you/.test(r.tag));
    const w = lo && lo.warn.match(/win (\d+)% · HP kept ~(\d+)%/);
    ok(onYou && /^2 · Minigun/.test(onYou.name) && w && onYou.nums === w[1] + '% · ' + w[2] + '%', 'loadouts: the one on you carries its number and the very numbers of "With their gear" (' + JSON.stringify(onYou) + ' / ' + (lo && lo.warn) + ')');
    ok(lo && /best/.test(lo.rows[0].tag) && lo.rows.filter((r) => /best/.test(r.tag)).length === 1 && lo.rows.every((r, i) => i === 0 || parseInt(r.nums, 10) <= parseInt(lo.rows[i - 1].nums, 10)), 'loadouts: best first, one row marked best');
    ok(lo && lo.rows.some((r) => /^1 · Kodachi ?Dune armour · seen 3 d ago$/.test(r.name)) && lo.rows.some((r) => /^4 · BT MP9 ?No armour · seen 12 d ago$/.test(r.name)), 'loadouts: a remembered loadout says its armour and when it was seen');
    ok(lo && /(Change it on Torn’s loadout menu before you start the fight\.|The one on you does best against it\.)$/.test(lo.text), 'loadouts: the line under the rows (' + (lo && lo.text.slice(-70)) + ')');
    ok(lo && lo.after && lo.inside && lo.pressable === 0, 'loadouts: after the amber line, inside the card, nothing in it to press (' + JSON.stringify(lo && { after: lo.after, inside: lo.inside, pressable: lo.pressable }) + ')');
    await page.waitForTimeout(1400);
    const cardR = await rectOf(page, '#pi-eyecard');
    const under = await panelRect(page);
    ok(cardR && cardR.bottom <= 900 && under && under.top >= cardR.bottom - 1 && under.bottom <= 900, 'loadouts: the card still fits the window, the panel’s line on screen under it (card bottom ' + Math.round(cardR && cardR.bottom) + ', panel ' + JSON.stringify(under) + ')');
    ok((await glows(page)) <= 1 && errors.length === 0, 'loadouts: at most one thing glows, no page errors ' + JSON.stringify(errors));
    await page.screenshot({ path: resolve(shots, 'torn-eye-attack-loadouts.png') });
    // Only the one on you is known: its one row, and how the others get here.
    const solo = await open('page=attack&user2ID=424242&fixture=attack&ffs=1&who=owner', { wait: 6000, width: 1600, seed: { ...store, 'pumpingIron.v1.eyeLoadouts': JSON.stringify({}) } });
    await tornLayout(solo.page);
    await solo.page.evaluate(() => fetch('fixtures/attackData.json?sid=attackData').then((r) => r.json()));
    await solo.page.waitForTimeout(1500);
    const one = await solo.page.evaluate(() => { const b = document.querySelector('#pi-eyecard [data-pi-loadouts]'); return b ? b.textContent.replace(/\s+/g, ' ').trim() : null; });
    ok(one && /^Your loadouts against it\s?win · HP kept\s?Minigun\s?No armour\s?\d+% · \d+%\s?on you\s?Your other loadouts show here once you have worn them with Torn’s items page open\.$/.test(one), 'loadouts: only the one on you known: one row, and how the others get here (' + one + ')');
    await solo.page.screenshot({ path: resolve(shots, 'torn-eye-attack-loadouts-one.png') });
    await solo.page.close();
    await page.close();
}

/* Round 8 (his pick A): the Next button, the first row of the fight card. It opens the attack page of the next player
   in your Torn Eye list (handed over by the Torn Eye tab), skipping who is not ready; key N; the panel's line under the
   card says "Training", so "Next" means one thing; once the fight is over the button is the one thing that glows. */
{
    const T0 = Date.parse('2026-09-29T10:48:00Z');
    const table = { at: T0, mode: 'targets', rows: [[605123, 'Pallas', 70, 'stomp', 2.8, 99, 'hosp', T0 + 3600000], [777001, 'Rust_Kestrel26', 87, 'good', 4.23, 72, 'ok', 0], [424242, 'Rival', 64, 'good', 3.9, 81, 'ok', 0]] };
    const { page, errors } = await open('page=attack&user2ID=424242&fixture=attack&ffs=1&who=owner', { wait: 6000, width: 1600, seed: { 'pumpingIron.v1.eyeNext': JSON.stringify(table) } });
    await tornLayout(page);
    await page.waitForTimeout(1300);
    const nb = () => page.evaluate(() => {
        const c = document.getElementById('pi-eyecard');
        const b = c && c.querySelector('.pi-nextbox');
        if (!b) return null;
        const a = b.querySelector('a.pi-nextb');
        const r = a.getBoundingClientRect();
        const cr = c.getBoundingClientRect();
        return { text: b.textContent.replace(/\s+/g, ' ').trim(), href: a.getAttribute('href'), target: a.getAttribute('target'), alt: a.classList.contains('pi-alt'), glow: a.classList.contains('pi-glow'), cardGlow: c.classList.contains('pi-glow'), first: c.querySelector('.pi-bd').firstElementChild === b, inside: r.left >= cr.left && r.right <= cr.right + 0.5, height: Math.round(r.height), bg: getComputedStyle(a).backgroundColor, left: cr.left };
    });
    const n1 = await nb();
    const torn = await tornRect(page);
    ok(n1 && /^Next target\s?N\s?Rust_Kestrel26 \[87\] · Good · 4\.23 · 72% HP\s?skips 1 not ready: 1 in hospital$/.test(n1.text), 'next: "Next target N", who it is and what it skipped (' + (n1 && n1.text) + ')');
    ok(n1 && n1.first && n1.inside && n1.height === 34 && n1.bg === 'rgb(239, 235, 226)' && n1.left >= torn.right, 'next: the first row of the fight card, a chalk button, beside Torn’s page (' + JSON.stringify(n1) + ')');
    ok(n1 && /page\.php\?sid=attack&user2ID=777001$/.test(n1.href) && !n1.target && !n1.alt, 'next: it only opens their attack page, in this tab (' + (n1 && n1.href) + ')');
    ok(n1 && n1.cardGlow && !n1.glow && (await glows(page)) === 1, 'next: before the fight ends the card glows, not the button');
    const line = await panelText(page);
    ok(/Training: /.test(line) && !/Next/.test(line), 'next: the panel’s line under the card says Training, never Next (' + line.slice(0, 80) + ')');
    await page.screenshot({ path: resolve(shots, 'torn-eye-attack-next.png') });
    // The fight is over (their life at 0 in Torn's answer): the button is the one thing that glows.
    const over = JSON.parse(await readFile(resolve(root, 'test/fixtures/attackData.json'), 'utf8'));
    over.DB.usersLife.defender.currentLife = 0;
    await page.route(/fight-over\.json/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(over) }));
    await page.evaluate(() => fetch('fixtures/fight-over.json?sid=attackData').then((r) => r.json()));
    await page.waitForTimeout(900);
    const n2 = await nb();
    ok(n2 && n2.glow && !n2.cardGlow && (await glows(page)) === 1, 'next: the fight over, the Next button is the one thing that glows (' + JSON.stringify(n2 && { glow: n2.glow, card: n2.cardGlow }) + ')');
    // The tallest card (Next, their gear piece by piece, the builds) in a 900 px window: the panel's line still fits under it.
    await page.waitForTimeout(1400);
    const tall = await rectOf(page, '#pi-eyecard');
    const under = await panelRect(page);
    ok(tall && under && under.top >= tall.bottom - 1 && under.bottom <= 900, 'next: the tallest card leaves the panel’s line on screen under it (card bottom ' + Math.round(tall && tall.bottom) + ', panel ' + JSON.stringify(under) + ')');
    await page.screenshot({ path: resolve(shots, 'torn-eye-attack-next-over.png') });
    // Key N: never while typing; else it opens the same page as the button. Torn's Start fight is never pressed by us.
    const asked = [];
    page.on('request', (r) => { if (/sid=attack&user2ID=/.test(r.url())) asked.push(r.url()); });
    await page.evaluate(() => { const i = document.createElement('input'); i.id = 'chatbox'; document.body.appendChild(i); i.focus(); });
    await page.keyboard.press('n');
    await page.waitForTimeout(500);
    ok(asked.length === 0, 'next: N typed into a box does nothing (' + asked.length + ')');
    await page.evaluate(() => { window.__startClicks = 0; document.querySelector('.dialogButtons___nX4Bz button').addEventListener('click', () => window.__startClicks++); document.getElementById('chatbox').blur(); });
    // The page it asks for answers "no content" here, so this page stays to be looked at.
    await page.route(/user2ID=777001/, (r) => r.fulfill({ status: 204, body: '' }));
    await page.keyboard.press('n');
    await page.waitForTimeout(900);
    ok(asked.length === 1 && /user2ID=777001$/.test(asked[0]), 'next: key N opens the next player’s attack page (' + asked.join() + ')');
    const startClicks = await page.evaluate(() => window.__startClicks).catch(() => 0);
    ok(startClicks === 0, 'next: Torn’s Start fight is never pressed by us (' + startClicks + ')');
    ok(errors.length === 0, 'next: no page errors ' + JSON.stringify(errors));
    await page.close();
    // Everyone else is in hospital or away: a plain button to the list.
    const none = { at: T0, mode: 'war', rows: [[605123, 'Pallas', 70, 'stomp', 2.8, 99, 'hosp', T0 + 3600000], [515151, 'Flyer', 40, 'fair', 3.1, 55, 'away', 0], [424242, 'Rival', 64, 'good', 3.9, 81, 'ok', 0]] };
    const b = await open('page=attack&user2ID=424242&fixture=attack&ffs=1&who=owner', { wait: 6000, width: 1600, seed: { 'pumpingIron.v1.eyeNext': JSON.stringify(none) } });
    await tornLayout(b.page);
    const n3 = await b.page.evaluate(() => { const x = document.querySelector('#pi-eyecard .pi-nextbox'); const a = x && x.querySelector('a'); return x ? { text: x.textContent.replace(/\s+/g, ' ').trim(), alt: a.classList.contains('pi-alt'), href: a.getAttribute('href') } : null; });
    ok(n3 && /^Open the Torn Eye list\s?No one else on your list is ready right now\.$/.test(n3.text) && n3.alt && /app\.html#eye$/.test(n3.href), 'next: nobody left ready, a plain button to the Torn Eye list (' + JSON.stringify(n3) + ')');
    // War mode's list with someone ready: "Next enemy".
    ok(b.errors.length === 0, 'next (nobody ready): no page errors ' + JSON.stringify(b.errors));
    await b.page.close();
    const warList = { at: T0, mode: 'war', rows: [[777001, 'Brix', 67, 'good', 7.8, 73, 'ok', 0], [424242, 'Rival', 64, 'good', 7.8, 81, 'ok', 0]] };
    const w = await open('page=attack&user2ID=424242&fixture=attack&ffs=1&who=owner', { wait: 6000, width: 1280, seed: { 'pumpingIron.v1.eyeNext': JSON.stringify(warList) } });
    await tornLayout(w.page);
    await w.page.setViewportSize({ width: 1600, height: 900 });
    await w.page.waitForTimeout(600);
    const n4 = (await text(w.page, '#pi-eyecard .pi-nextbox'))[0] || '';
    ok(/^Next enemy\s?N\s?Brix \[67\] · Good · 7\.80 · 73% HP$/.test(n4), 'next: in war mode the same button walks the war list, "Next enemy" (' + n4 + ')');
    // The smallest card (1280 px): the button alone, still inside the card and beside Torn's page.
    await w.page.setViewportSize({ width: 1280, height: 900 });
    await w.page.waitForTimeout(600);
    const sm = await w.page.evaluate(() => { const c = document.getElementById('pi-eyecard'); const a = c && c.querySelector('a.pi-nextb'); if (!a) return null; const r = a.getBoundingClientRect(); const cr = c.getBoundingClientRect(); return { mode: c.getAttribute('data-pi-mode'), text: a.textContent.replace(/\s+/g, ' ').trim(), inside: r.left >= cr.left && r.right <= cr.right + 0.5, left: cr.left }; });
    ok(sm && sm.mode === 'small' && /^Next\s?N$/.test(sm.text) && sm.inside && sm.left >= (await tornRect(w.page)).right, 'next 1280 px: the smallest card keeps the button (' + JSON.stringify(sm) + ')');
    ok(w.errors.length === 0, 'next (war): no page errors ' + JSON.stringify(w.errors));
    await w.page.close();
}

/* Taking turns: Torn Trading's panel shows up → paused (no calls, no marks, a warning panel); gone a minute → back. */
{
    const { page, errors } = await open('page=gym&fixture=gym-friend&energy=275&build=balanced');
    const marksBefore = await page.evaluate(() => document.querySelectorAll('#pi-marks-layer .pi-ring[data-pi-stat]').length);
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
        return { paused: sh.querySelector('.wrap').classList.contains('paused'), head: sh.querySelector('.head').textContent, body: sh.querySelector('.body').textContent, marks: document.querySelectorAll('#pi-marks-layer > *, .content-wrapper .pi-mark').length };
    });
    ok(state.paused && /Paused · Torn Trading is on/.test(state.head), 'turns: the panel shows the warning sign (' + state.head + ')');
    ok(/Still seen in 1 tab: Gym\./.test(state.body) && /Reload or close it\. Pumping Iron starts again 2 min after the last one\./.test(state.body) && /Last seen\d+ s ago/.test(state.body), 'turns: the amber card says where Torn Trading is still seen, and when (' + state.body + ')');
    ok(state.marks === 0, 'turns: nothing of ours left on Torn’s page (' + state.marks + ')');
    await page.screenshot({ path: resolve(shots, 'torn-paused.png') });
    await page.waitForTimeout(6000);
    const n2 = await page.evaluate(() => window.__calls.length);
    ok(n2 === n1, 'turns: no request while paused (' + (n2 - n1) + ')');
    // The open bug, its cause: Torn Trading turned off in Tampermonkey stays in a tab opened before (its host too),
    // so that tab marks it seen again: last seen over two minutes ago, and paused again within one look (5 s).
    await page.evaluate(() => window.GM_setValue('pumpingIron.v1.tradingSeenAt', JSON.stringify(Date.now() - 121000)));
    await page.waitForTimeout(5500);
    const again = await page.evaluate(() => document.getElementById('pi-overlay').shadowRoot.querySelector('.wrap').classList.contains('paused'));
    ok(again, 'turns (cause): a tab that still has Torn Trading keeps the pause on; the card names it instead of promising a minute');
    // That tab reloaded or closed: its host gone. The card counts down from the last time it was seen.
    await page.evaluate(() => document.getElementById('ttv2-host').remove());
    await page.waitForTimeout(6000);
    const gone = await page.evaluate(() => document.getElementById('pi-overlay').shadowRoot.querySelector('.body').textContent);
    ok(/Torn Trading isn’t seen any more\. Starting again in \d:\d\d\./.test(gone), 'turns: once it is gone the card counts down (' + gone + ')');
    // Last seen over two minutes ago (the grace outlasts a hidden tab's once-a-minute timers).
    await page.evaluate(() => window.GM_setValue('pumpingIron.v1.tradingSeenAt', JSON.stringify(Date.now() - 121000)));
    await page.waitForTimeout(6000);
    const back = await page.evaluate(() => ({ paused: document.getElementById('pi-overlay').shadowRoot.querySelector('.wrap').classList.contains('paused'), marks: document.querySelectorAll('#pi-marks-layer .pi-ring[data-pi-stat]').length }));
    ok(!back.paused && back.marks === 1, 'turns: back by itself, marks drawn again (' + JSON.stringify(back) + ')');
    ok(errors.length === 0, 'turns: no page errors ' + JSON.stringify(errors));
    await page.close();
}

/* The attack page: the panel folds to one line directly under Torn Eye's fight card (#pi-eyecard), never on top of it. */
{
    const { page, errors } = await open('page=attack&user2ID=424242&fixture=attack&ffs=1&who=owner', { wait: 5000 });
    // Torn's page measured (976 px centred) and a window with room beside it: the dock stays in the card's margin.
    await page.setViewportSize({ width: 1600, height: 900 });
    await tornLayout(page);
    await page.waitForTimeout(1300);
    // Torn Eye's card (its builder's #pi-eyecard; a stand-in in the free space where this build has none).
    await page.evaluate(() => {
        if (document.getElementById('pi-eyecard')) return;
        const d = document.createElement('div');
        d.id = 'pi-eyecard';
        d.style.cssText = 'position:fixed;right:12px;top:90px;width:288px;height:260px;background:#101214;border:1px solid #3a4046;border-radius:10px;z-index:2147482000';
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
    // A card over Torn's page itself (a stand-in): the panel never docks there; it takes its own place.
    await page.evaluate(() => {
        const c = document.getElementById('pi-eyecard');
        c.style.cssText = 'position:fixed;left:700px;top:90px;width:300px;height:260px;background:#101214;border:1px solid #3a4046;border-radius:10px;z-index:2147482000';
        c.classList.remove('pi-fixed');
    });
    await page.waitForTimeout(1600);
    const over = await panelRect(page);
    ok(over && !over.docked && panelClear(over, await tornRect(page)), 'attack: a card over Torn’s page is never docked under (panel ' + JSON.stringify(over) + ')');
    // No fight card (and no room for one: Torn's page as wide as the window): the usual panel.
    await page.evaluate(() => {
        document.getElementById('torn-layout').remove();
        dispatchEvent(new Event('resize'));
        document.getElementById('pi-eyecard').remove();
    });
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
