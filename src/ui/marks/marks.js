/*
 * Marks on Torn's own pages (DESIGN §5; round 7's one look, overlays.html):
 * an opaque near-black tag with our plate mark, a 5 px coloured edge, a 1 px
 * border and, on the one thing to do now, a soft glow in its colour (green
 * to train, red wrong or not yet, amber paused or overdosed, chalk "take
 * this"). At most one thing glows on a page. On the gym page: the strip (one
 * line before the stat boxes), the stat to train outlined with its tab, the
 * gym you're in (steady green or red), the gym to go to (the only pulse for
 * gyms), and Fill N, which types into Torn's reps box on your click. Our
 * things never take the pointer except our own buttons, never sit on Torn's
 * content, and carry the class `pi-mark` so they go at once.
 */

import { h } from '../dom.js';
import { fillTrains } from '../../sources/dom/gym.js';

export const MARK_CSS = `
.pi-mark, .pi-mark * { box-sizing: border-box; font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; }
.pi-c-green { --b: #3fbf5a; } .pi-c-red { --b: #ff6b5e; } .pi-c-amber { --b: #e8a33d; } .pi-c-chalk { --b: #efebe2; } .pi-c-grey { --b: #6c737a; } .pi-c-plain { --b: #6c737a; }
.pi-tag { display: flex; align-items: center; gap: 10px; min-height: 32px; padding: 0 12px 0 0; border-radius: 6px; background: #101214; border: 1px solid color-mix(in srgb, var(--b, #efebe2) 55%, transparent); box-shadow: 0 2px 8px rgba(0,0,0,.4); color: #f2f3f5; font-size: 13px; line-height: 1.35; overflow: hidden; }
.pi-tag > .pi-edge { align-self: stretch; width: 5px; flex: none; background: var(--b, #efebe2); }
.pi-glow { box-shadow: 0 0 0 3px color-mix(in srgb, var(--b) 14%, transparent), 0 0 16px color-mix(in srgb, var(--b) 24%, transparent), 0 2px 8px rgba(0,0,0,.4) !important; }
.pi-plate { width: 16px; height: 16px; border-radius: 50%; background: #efebe2; display: inline-grid; place-items: center; box-shadow: inset 0 0 0 3px #efebe2, inset 0 0 0 4.5px #15171a; flex: none; }
.pi-plate i { width: 4px; height: 4px; border-radius: 50%; background: #15171a; }
.pi-strip { flex-wrap: wrap; row-gap: 2px; padding-top: 5px; padding-bottom: 5px; margin: 0 0 10px; }
.pi-strip b { color: #fff; font-weight: 700; }
.pi-strip .pi-sep { width: 1px; align-self: stretch; margin: 2px 0; background: #2f3439; flex: none; }
.pi-strip .pi-src { color: #9aa1a8; font-size: 11px; }
.pi-strip .pi-hint { color: #e8a33d; font-weight: 700; }
.pi-strip .pi-part { color: #939aa1; white-space: nowrap; }
.pi-strip .pi-part.pi-cur { color: #fff; font-weight: 700; }
.pi-strip .pi-part.pi-done { color: #9bdc8a; }
.pi-strip .pi-arrow { color: #6c737a; }
.pi-strip a.pi-link { color: #101214; background: var(--b); border-radius: 5px; padding: 2px 10px; font-weight: 700; font-size: 12px; text-decoration: none; white-space: nowrap; }
.pi-strip a.pi-link:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.pi-rel { position: relative; }
.pi-statmark { position: absolute; inset: -3px; border: 2px solid var(--b); border-radius: 6px; pointer-events: none; z-index: 1; }
.pi-statmark.pi-dashed { border-style: dashed; }
.pi-tab { height: 22px; padding: 0 9px; border-radius: 4px; background: var(--b); color: #101214; font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; flex: none; }
.pi-tab::before { content: ''; width: 10px; height: 10px; border-radius: 50%; box-shadow: inset 0 0 0 2px #101214; flex: none; }
.pi-pulse::after { content: ''; position: absolute; inset: -2px; border-radius: 7px; box-shadow: 0 0 0 2px color-mix(in srgb, var(--b) 80%, transparent), 0 0 22px color-mix(in srgb, var(--b) 80%, transparent); opacity: 0; animation: pi-pulse 1.4s ease-in-out infinite; pointer-events: none; }
.pi-pulse.pi-still::after { animation: none; opacity: .7; }
@keyframes pi-pulse { 50% { opacity: 1; } }
@media (prefers-reduced-motion: reduce) { .pi-pulse::after { animation: none; opacity: .7; } }
.pi-gymmark { outline: 2px solid var(--b) !important; outline-offset: 1px; position: relative; }
.pi-ring { position: absolute; inset: -2px; border-radius: 6px; pointer-events: none; }
.pi-panel { min-height: 32px; margin: 6px 0; font-size: 12px; }
.pi-panel b { color: #fff; font-size: 13px; }
.pi-panel .pi-sub { color: #c5cad0; }
.pi-fill { white-space: nowrap; height: 24px; padding: 0 12px; border-radius: 5px; border: 1px solid #3fbf5a; background: #3fbf5a; color: #101214; font: 700 12px 'Segoe UI', system-ui, sans-serif; cursor: pointer; margin-left: auto; flex: none; }
.pi-fill:disabled { background: #24282c; color: #6c737a; border-color: #3a4046; cursor: default; }
.pi-fill:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.pi-warn { --b: #e8a33d; }
.pi-warn b { color: #ffe3b3; }
.pi-corner { display: inline-flex; align-items: center; height: 22px; padding: 0 8px; margin: 4px 0; border-radius: 4px; background: #101214; border: 1px solid #3a4046; color: #c5cad0; font-size: 11px; white-space: nowrap; }
.pi-outlined { box-shadow: inset 0 0 0 2px #efebe2 !important; position: relative; }
.pi-outlined.pi-glow { box-shadow: inset 0 0 0 2px #efebe2, 0 0 0 3px rgba(239,235,226,.15), 0 0 16px rgba(239,235,226,.22) !important; }
.pi-label { position: absolute; top: -11px; left: 10px; height: 20px; padding: 0 8px 0 6px; border-radius: 5px; background: #efebe2; color: #15171a; font: 700 11px 'Segoe UI', system-ui, sans-serif; letter-spacing: .4px; text-transform: uppercase; pointer-events: none; z-index: 2; white-space: nowrap; display: inline-flex; align-items: center; gap: 5px; }
.pi-label::before { content: ''; width: 9px; height: 9px; border-radius: 50%; box-shadow: inset 0 0 0 2px #15171a; flex: none; }
`;

/** Our page CSS, once per page (torn.com: no outside fonts). */
export function ensureMarkCss(doc = document) {
    if (doc.getElementById('pi-mark-css')) return;
    const st = doc.createElement('style');
    st.id = 'pi-mark-css';
    st.textContent = MARK_CSS;
    (doc.head || doc.documentElement).appendChild(st);
}

/** The classes we put on Torn's own elements (taken off with our marks). */
const ON_TORN = ['pi-on', 'pi-wait', 'pi-rel', 'pi-outlined', 'pi-dim', 'pi-glow', 'pi-gymmark', 'pi-c-green', 'pi-c-red', 'pi-c-grey', 'pi-c-chalk', 'pi-c-amber'];

/** Remove every mark we drew inside `scope`. */
export function clearMarks(scope = document) {
    for (const el of scope.querySelectorAll('.pi-mark')) el.remove();
    for (const el of scope.querySelectorAll('.pi-on, .pi-wait, .pi-rel, .pi-outlined, .pi-dim, .pi-gymmark')) el.classList.remove(...ON_TORN);
    for (const el of scope.querySelectorAll('[data-pi-gym]')) el.removeAttribute('data-pi-gym');
}

function plate() {
    return h('span', { class: 'pi-plate' }, [h('i')]);
}

const TONE = { green: 'pi-c-green', red: 'pi-c-red', amber: 'pi-c-amber', chalk: 'pi-c-chalk', plain: 'pi-c-plain' };

/**
 * Draw the gym page marks from planGymPage() output.
 * @param {Element} root - #gymroot
 * @param {object} plan - planGymPage(model, page)
 * @param {object[]} boxes - readStatBoxes(root)
 * @param {function} rereadBox - (stat) => the box as it is now (React may have replaced the input)
 * @param {{id, el}[]} [buttons] - readGymButtons(root): the gym you're in and the gym to go to
 * @param {{motion:boolean}} [opts] - motion false (Settings › Animations off): the pulse is held still
 */
export function drawGymMarks(root, plan, boxes, rereadBox, buttons = [], { motion = true } = {}) {
    clearMarks(root);
    const list = root.querySelector('ul[class*="properties___"]');
    if (!list) return;
    const line = plan.line || { tone: 'plain', head: plan.strip[0] || '', text: '', src: null };
    const kind = plan.state ? plan.state.kind : 'idle';
    const still = motion === false ? ' pi-still' : '';
    const sep = () => h('span', { class: 'pi-sep' });
    // The one thing that glows: the stat to train (right, ready), the stat to eat for (pulse), the gym to go to
    // (pulse), or the strip itself when it is all there is (an overdose, stacking for a chain).
    const stripGlows = kind === 'overdose' || kind === 'stacking';
    const strip = h('div', { class: 'pi-mark pi-tag pi-strip ' + (TONE[line.tone] || TONE.plain) + (stripGlows ? ' pi-glow' : ''), 'data-pi-state': kind }, [h('span', { class: 'pi-edge' }), plate(), h('b', { text: line.head })]);
    if (line.text) {
        strip.appendChild(sep());
        strip.appendChild(h('span', { class: 'pi-words', text: line.text }));
    }
    // A session in more than one part (or one already ticked): the parts, the current one bright.
    if (plan.parts && (plan.parts.length > 1 || plan.parts.some((p) => p.state === 'done')) && kind !== 'overdose' && kind !== 'stacking') {
        strip.appendChild(sep());
        plan.parts.forEach((p, i) => {
            if (i) strip.appendChild(h('span', { class: 'pi-arrow', text: '→' }));
            const words = p.gymName + ': ' + p.stat.toUpperCase() + ' × ' + p.trains + (p.state === 'current' && p.done > 0 ? ' (' + p.left + ' left)' : '');
            strip.appendChild(h('span', { class: 'pi-part' + (p.state === 'done' ? ' pi-done' : p.state === 'current' ? ' pi-cur' : ''), text: (p.state === 'done' ? '✓ ' : '') + words }));
        });
    }
    if (line.src) {
        strip.appendChild(sep());
        strip.appendChild(h('span', { class: 'pi-src', text: line.src }));
    }
    if (line.link) strip.appendChild(h('a', { class: 'pi-link', href: line.link.href, text: line.link.text }));
    list.parentNode.insertBefore(strip, list);

    // The gym you're in: a steady outline, green when right, red when wrong (no glow).
    if (plan.hereGym) {
        const b = buttons.find((x) => x.id === plan.hereGym.id);
        if (b && b.el) {
            b.el.classList.add('pi-gymmark', plan.hereGym.wrong ? 'pi-c-red' : 'pi-c-green');
            b.el.setAttribute('data-pi-gym', plan.hereGym.wrong ? 'wrong' : 'right');
        }
    }
    // The gym to go to: green, and it pulses (the only pulse for gyms). The user switches; we never do.
    if (plan.nextGym) {
        const b = buttons.find((x) => x.id === plan.nextGym.id);
        if (b && b.el) {
            b.el.classList.add('pi-gymmark', 'pi-c-green');
            b.el.setAttribute('data-pi-gym', 'go');
            b.el.appendChild(h('span', { class: 'pi-mark pi-ring pi-pulse' + still, title: plan.nextGym.label, 'aria-hidden': 'true' }));
        } else {
            // Its button isn't on the page (Torn shows one group of gyms at a time): the strip says which group to open.
            strip.appendChild(h('span', { class: 'pi-hint', text: 'open ' + plan.nextGym.group.replace(/^a /, 'the ') + 's to find it' }));
        }
    }

    for (const box of boxes) {
        const p = plan.perStat[box.stat];
        if (!p || p.kind === 'off') continue;
        if (p.kind === 'train' || p.kind === 'wait') {
            const wait = p.kind === 'wait';
            const tone = wait ? 'pi-c-grey' : p.mark === 'eat' ? 'pi-c-red' : 'pi-c-green';
            box.li.classList.add(wait ? 'pi-wait' : 'pi-on', 'pi-rel');
            // The mark: steady green to train, a red pulse until the boosters are in, dashed grey in the wrong gym.
            const markCls = 'pi-mark pi-statmark ' + tone + (wait ? ' pi-dashed' : p.mark === 'eat' ? ' pi-pulse' + still : ' pi-glow');
            // The outline is a border just outside the box (pointer-events none); its tab sits in our own row inside
            // the box, never floating over Torn's controls (the owner: nothing of ours covers Torn's page).
            box.li.appendChild(h('span', { class: markCls, 'aria-hidden': 'true' }));
            const n = p.fill !== undefined ? p.fill : p.trains;
            const shown = p.fillN !== undefined && (p.hold || wait) ? p.fillN : n;
            const fill = h('button', {
                class: 'pi-fill',
                type: 'button',
                text: 'Fill ' + shown,
                title: wait ? 'Switch gyms first' : p.hold ? 'Take the boosters and the drug first' : null,
                disabled: wait || p.hold || n <= 0,
                onclick: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const now = rereadBox(box.stat) || box;
                    fillTrains(now.input, n);
                },
            });
            const row = p.warn
                ? h('div', { class: 'pi-mark pi-tag pi-panel pi-warn' }, [h('span', { class: 'pi-edge' }), h('span', {}, [h('b', { text: p.warn.split('. ')[0] + '.' }), ' ' + p.warn.split('. ').slice(1).join('. ')]), fill])
                : h('div', { class: 'pi-mark pi-tag pi-panel ' + tone }, [h('span', { class: 'pi-edge' }), h('span', { class: 'pi-tab', text: p.tab }), wait || p.hold ? h('b', { text: wait ? 'Switch gyms first' : p.text }) : null, p.sub ? h('span', { class: 'pi-sub', text: wait || p.hold ? p.sub : p.sub.replace(/ · about [+−-]?[\d,]+/, '') }) : null, fill]);
            box.content.insertBefore(row, box.content.firstChild);
        } else if (p.tag) {
            // Never dims or covers Torn's boxes (round 6): a small dark tag on its own line, the full words on hover.
            box.content.insertBefore(h('div', { class: 'pi-mark pi-corner', title: p.text, text: p.tag }), box.content.firstChild);
        }
    }
}

/**
 * Outline one element with its chalk tab (items, bazaar cards, market rows, points lots). `glow`: the one thing
 * that glows on the page (the first listing to take).
 */
export function outline(el, label, { glow = false } = {}) {
    if (!el) return;
    el.classList.add('pi-outlined');
    if (glow) el.classList.add('pi-glow');
    el.appendChild(h('span', { class: 'pi-mark pi-label', text: label }));
}
