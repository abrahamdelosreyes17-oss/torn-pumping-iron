/*
 * Round 7 overlays on Torn's pages (mockups/round7/overlays.html): where the
 * profile card, the attack card and the list tags go in the free space
 * beside Torn's page (full / narrower / smallest / the left side / nothing,
 * never on Torn's page), and the three numbers always in the order
 * respect, HP kept, win. The look itself: test/torn-check.mjs.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

class FakeNode {
    constructor(tag, text = null) {
        this.tagName = tag ? tag.toUpperCase() : '#text';
        this.children = [];
        this.attrs = {};
        this.text = text;
        const self = this;
        this.classList = {
            add: (...c) => self.setAttribute('class', [...new Set([...(self.attrs.class || '').split(' ').filter(Boolean), ...c])].join(' ')),
            contains: (c) => (self.attrs.class || '').split(' ').includes(c),
        };
    }
    setAttribute(k, v) {
        this.attrs[k] = String(v);
    }
    getAttribute(k) {
        return this.attrs[k] ?? null;
    }
    set id(v) {
        this.attrs.id = String(v);
    }
    get id() {
        return this.attrs.id || '';
    }
    addEventListener() {}
    appendChild(c) {
        this.children.push(c);
        return c;
    }
    set textContent(v) {
        this.text = String(v);
        this.children = [];
    }
    get textContent() {
        return (this.text || '') + this.children.map((c) => c.textContent).join('');
    }
    find(pred, out = []) {
        if (pred(this)) out.push(this);
        for (const c of this.children) if (c.find) c.find(pred, out);
        return out;
    }
}
globalThis.document = { createElement: (t) => new FakeNode(t), createElementNS: (_, t) => new FakeNode(t), createTextNode: (t) => new FakeNode(null, t) };

const { eyeCardSpot, eyeRowSpot, eyeFigures, eyeShown, eyeHmm, eyeStatusSeconds, eyeSummary, eyeSummaryText, eyeBuildsText, eyeRowTag, eyeProfileCard, eyeFightCard, eyeMiniLine, EYE_FREE, EYE_CSS } = await import('../src/ui/eye/eye-ui.js');

const clean = (s) => s.replace(/\s+/g, ' ').trim();
// Torn's page is 976 px (sidebar + content), centred.
const centred = (vw) => ({ left: (vw - 976) / 2, right: (vw + 976) / 2 });

test('profile card: full from 300 px of free space, narrower from 160, smallest under 160, nothing under 80', () => {
    const big = eyeCardSpot(1920, centred(1920)); // 472 px each side
    assert.equal(big.mode, 'full');
    assert.equal(big.side, 'right');
    assert.equal(big.width, 300);
    assert.equal(big.x, centred(1920).right + 12, 'beside Torn’s page, never on it');
    const s1366 = eyeCardSpot(1366, centred(1366)); // 195 px
    assert.equal(s1366.mode, 'mid');
    assert.equal(s1366.width, 195 - 16);
    const s1280 = eyeCardSpot(1280, centred(1280)); // 152 px
    assert.equal(s1280.mode, 'small');
    assert.equal(s1280.side, 'right');
    assert.equal(s1280.width, 152 - 12);
    assert.ok(s1280.x >= centred(1280).right && s1280.x + s1280.width <= 1280);
    // The edges of each band.
    const at = (free) => eyeCardSpot(976 + 2 * free, centred(976 + 2 * free)).mode;
    assert.equal(at(EYE_FREE.full), 'full');
    assert.equal(at(EYE_FREE.full - 1), 'mid');
    assert.equal(at(EYE_FREE.mid), 'mid');
    assert.equal(at(EYE_FREE.mid - 1), 'small');
    assert.equal(at(EYE_FREE.least - 1), 'none', 'no room: nothing, never a line on Torn’s page');
    for (const vw of [1100, 1200, 1280, 1366, 1440, 1600, 1920, 2560]) {
        const p = centred(vw);
        const s = eyeCardSpot(vw, p);
        if (s.mode === 'none') continue;
        assert.ok(s.x >= p.right || s.x + s.width <= p.left, 'never on Torn’s page at ' + vw);
        assert.ok(s.x >= 0 && s.x + s.width <= vw, 'on screen at ' + vw);
    }
});

test('profile card: under 130 px on the right it uses the left-hand space when that is wider', () => {
    const page = { left: 420, right: 1396 }; // Torn's page pushed right: 420 left, 104 right
    const s = eyeCardSpot(1500, page);
    assert.equal(s.side, 'left');
    assert.equal(s.mode, 'full');
    assert.equal(s.x + s.width, page.left - 12, 'right up to Torn’s page, not over it');
    // 129 px on the right and 140 on the left: left.
    assert.equal(eyeCardSpot(976 + 269, { left: 140, right: 1116 }).side, 'left');
    // 129 on the right, 100 on the left: the right stays (the left isn't wider).
    assert.equal(eyeCardSpot(976 + 229, { left: 100, right: 1076 }).side, 'right');
    // 130 on the right: right, even with more on the left.
    assert.equal(eyeCardSpot(976 + 530, { left: 400, right: 1376 }).side, 'right');
});

test('list tags: band word and numbers, numbers only, HP only, or only the row edges', () => {
    assert.equal(eyeRowSpot(1920, centred(1920)).mode, 'full');
    assert.equal(eyeRowSpot(1366, centred(1366)).mode, 'short');
    assert.equal(eyeRowSpot(1280, centred(1280)).mode, 'short');
    assert.equal(eyeRowSpot(1150, centred(1150)).mode, 'tiny');
    assert.equal(eyeRowSpot(1000, centred(1000)).mode, 'none');
    const s = eyeRowSpot(1280, centred(1280));
    assert.ok(s.x >= centred(1280).right && s.x + s.width <= 1280);
    assert.ok(s.width <= 250);
});

const viewOf = (o = {}) => ({ id: 2518524, name: 'Red_Pike', level: 100, band: 'good', respect: 4.35, forecast: { pWin: 0.78, keep: 0.73, turns: 8, perBuild: { balanced: { pWin: 0.8, keep: 0.74 }, defHeavy: { pWin: 0.75, keep: 0.7 } } }, est: { source: 'ffscouter', ageDays: 5, confidence: 'good' }, source: 'FFScouter 5 d', status: { state: 'Okay', description: 'Okay' }, ...o });

test('the three numbers: respect, HP kept, win, in that order', () => {
    const fs = eyeFigures(viewOf());
    assert.deepEqual(fs.map((x) => x.k), ['respect', 'keep', 'win']);
    assert.deepEqual(fs.map((x) => x.text), ['4.35', '73%', '78%']);
    assert.deepEqual(eyeFigures(viewOf({ respect: null, forecast: { pWin: 0.02, keep: 0 } })).map((x) => x.text), ['—', '—', '2%'], 'no HP kept for a fight you lose');
    assert.deepEqual(eyeFigures(null).map((x) => x.text), ['—', '—', '—']);
    assert.equal(eyeBuildsText(viewOf().forecast), '70–74%');
    assert.equal(eyeBuildsText({ perBuild: { a: { pWin: 1, keep: 0.99 }, b: { pWin: 1, keep: 0.991 } } }), 'all 99%');
});

test('a row tag shows the band word, then respect, HP kept, win; the card and the mini line keep that order', () => {
    const tag = eyeRowTag(viewOf(), { mode: 'full' });
    const t = clean(tag.textContent);
    assert.equal(t, 'Good4.3573% HP78%');
    assert.ok(t.indexOf('Good') < t.indexOf('4.35') && t.indexOf('4.35') < t.indexOf('73%') && t.indexOf('73%') < t.indexOf('78%'), t);
    assert.ok(!/FF|fair fight/i.test(t));
    const short = clean(eyeRowTag(viewOf(), { mode: 'short' }).textContent);
    assert.ok(!/Good/.test(short) && short.indexOf('4.35') < short.indexOf('73%') && short.indexOf('73%') < short.indexOf('78%'), short);
    assert.equal(clean(eyeRowTag(viewOf(), { mode: 'tiny' }).textContent), '73% HP');
    const card = eyeProfileCard(viewOf(), 'full', { id: 2518524, watch: { state: { watching: false }, on: { toggle() {}, tag() {} } } });
    assert.deepEqual(card.find((n) => n.getAttribute('data-pi-fig')).map((n) => n.getAttribute('data-pi-fig')), ['respect', 'keep', 'win']);
    const mid = eyeProfileCard(viewOf(), 'mid', { id: 2518524, watch: { state: { watching: false }, on: { toggle() {}, tag() {} } } });
    assert.deepEqual(mid.find((n) => n.getAttribute('data-pi-fig')).map((n) => n.getAttribute('data-pi-fig')), ['respect', 'keep', 'win']);
    const mini = clean(eyeMiniLine(viewOf(), { id: 2518524 }).textContent);
    assert.ok(mini.indexOf('4.35 resp') < mini.indexOf('73% HP') && mini.indexOf('73% HP') < mini.indexOf('78% win'), mini);
});

test('profile card: full has the source, ★ Watch and the status; smallest only the band and the three numbers', () => {
    const w = { state: { watching: false }, on: { toggle() {}, tag() {} } };
    const full = clean(eyeProfileCard(viewOf(), 'full', { id: 1, watch: w }).textContent);
    assert.match(full, /^GoodRed_Pike \[100\]/);
    assert.match(full, /Respect4\.35HP kept73%Win78%/);
    assert.match(full, /FFScouter 5 d · their likely builds: 70–74%/);
    assert.match(full, /☆ Watch/);
    assert.match(full, /Okay$/);
    const mid = eyeProfileCard(viewOf(), 'mid', { id: 1, watch: w });
    assert.match(clean(mid.textContent), /^Good\[100\]Respect4\.35HP kept73%Win78%FFScouter 5 d☆ Watch$/);
    const small = eyeProfileCard(viewOf(), 'small', { id: 1, watch: w });
    assert.equal(clean(small.textContent), 'GoodResp4.35HP73%Win78%');
    assert.match(small.getAttribute('title'), /FFScouter/, 'the source and builds on hover');
    assert.match(small.getAttribute('title'), /70–74%/);
    assert.equal(small.getAttribute('data-pi-hover'), '1', 'the hover card works on the smallest card');
    const el = eyeProfileCard(viewOf(), 'full', { id: 1, watch: w });
    assert.ok(el.classList.contains('pi-glow'), 'the card is the one thing that glows');
    assert.equal(el.id, 'pi-eyecard', 'the training panel docks under the Torn Eye card, here as on the attack page');
});

test('a hospital row is dimmed with when it is out; the summary counts ready, the next out and travellers', () => {
    const hosp = eyeRowTag(viewOf(), { mode: 'full', state: 'hospital', outInS: 4620 });
    assert.equal(clean(hosp.textContent), 'Goodout in 1:17');
    assert.ok(hosp.classList.contains('pi-dimmed'));
    assert.ok(!hosp.classList.contains('pi-glow'), 'only a ready row glows');
    assert.ok(eyeRowTag(viewOf(), { mode: 'full', glow: true }).classList.contains('pi-glow'));
    assert.equal(eyeHmm(4620), '1:17');
    assert.equal(eyeHmm(48 * 60), '0:48');
    assert.equal(eyeStatusSeconds('Hospital 01:17:00'), 4620);
    assert.equal(eyeStatusSeconds('42:10'), 2530);
    assert.equal(eyeStatusSeconds('Okay'), null);
    const nowS = 1000000;
    const rows = [{ state: 'okay' }, { state: 'early' }, { state: 'hospital', until: nowS + 4620 }, { state: 'hospital', until: nowS + 9000 }];
    const s = eyeSummary(rows, nowS);
    assert.equal(eyeSummaryText(s), '2 ready (1 out early) · 1 out in 1:17 · 0 traveling');
    assert.equal(eyeSummaryText(eyeSummary([{ state: 'okay' }, { state: 'okay' }, { state: 'hospital', until: nowS + 4620 }], nowS)), '2 ready · 1 out in 1:17 · 0 traveling');
    assert.equal(eyeSummaryText(eyeSummary([{ state: 'hospital', until: 0 }, { state: 'traveling' }], nowS)), '0 ready · 1 in hospital · 1 traveling');
});

test('rows: never a band that says nothing, and never under half your HP kept', () => {
    assert.equal(eyeShown(viewOf()), true);
    assert.equal(eyeShown(viewOf({ band: 'none' })), false);
    assert.equal(eyeShown(viewOf({ band: 'low' })), false, 'bands.js’s "Under 50%" is never drawn on a row');
    assert.equal(eyeShown(viewOf({ forecast: { pWin: 0.9, keep: 0.45 } })), false);
    assert.equal(eyeShown(null), false);
});

test('attack page: the fight card is #pi-eyecard, with turns, the gear note and HP kept per likely build', () => {
    const card = eyeFightCard(viewOf(), 'full', { gearVisible: false, gearSaved: false, watch: { watching: false, full: false, toggle() {} } });
    assert.equal(card.id, 'pi-eyecard');
    const t = clean(card.textContent);
    assert.match(t, /^GoodRed_Pike \[100\]Respect4\.35HP kept73%Win78%/);
    assert.match(t, /About 8 turns · their gear shows once the fight starts/);
    assert.match(t, /Balanced74%/);
    assert.match(t, /DEF-heavy70%/);
    assert.match(t, /FFScouter 5 d/);
    const saved = clean(eyeFightCard(viewOf(), 'full', { gearSaved: true }).textContent);
    assert.match(saved, /their gear is saved for next time/);
    const small = clean(eyeFightCard(viewOf(), 'small', {}).textContent);
    assert.equal(small, 'GoodResp4.35HP73%Win78%');
});

test('on torn.com: Segoe UI / system-ui only, no outside fonts', () => {
    assert.match(EYE_CSS, /'Segoe UI', system-ui/);
    assert.doesNotMatch(EYE_CSS, /@import|@font-face|fonts\.googleapis|Arial/);
});
