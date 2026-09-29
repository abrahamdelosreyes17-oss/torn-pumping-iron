/*
 * Marks on Torn's own pages (DESIGN §5): an outline and a small label on
 * the thing the plan uses, a one-line strip on the gym page, and Fill N,
 * which types into Torn's reps box on your click. Labels never take the
 * pointer (trading's pattern), so Torn's buttons are never covered.
 * Everything we add carries the class `pi-mark` and can be removed at once.
 */

import { h } from '../dom.js';
import { fillTrains } from '../../sources/dom/gym.js';

export const MARK_CSS = `
.pi-mark, .pi-mark * { box-sizing: border-box; font-family: Arial, Helvetica, sans-serif; }
.pi-strip { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 7px 10px; margin: 0 0 10px; background: #1b1e21; border: 1px solid #3a4046; border-radius: 6px; font-size: 12px; line-height: 1.4; color: #e3e5e8; }
.pi-strip b { color: #fff; }
.pi-strip .pi-sep { color: #6c737a; }
.pi-strip .pi-hint { color: #e8a33d; font-weight: bold; }
.pi-plate { width: 18px; height: 18px; border-radius: 50%; background: #efebe2; display: inline-grid; place-items: center; box-shadow: inset 0 0 0 3px #efebe2, inset 0 0 0 4px #2a2d31; flex: none; }
.pi-plate i { width: 4px; height: 4px; border-radius: 50%; background: #15171a; }
.pi-on { box-shadow: 0 0 0 2px #efebe2 !important; border-radius: 5px; position: relative; }
.pi-panel { display: flex; align-items: center; gap: 10px; padding: 7px 10px; margin: 6px 0; background: #1b1e21; border-radius: 5px; font-size: 12px; color: #e3e5e8; }
.pi-panel b { color: #fff; font-size: 13px; }
.pi-fill { white-space: nowrap; height: 26px; padding: 0 12px; border-radius: 13px; background: #efebe2; color: #15171a; font: bold 12px Arial, sans-serif; border: 0; cursor: pointer; margin-left: auto; }
.pi-fill:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.pi-grey { color: #8a9096; font-size: 12px; margin: 4px 0; }
.pi-warn { display: flex; align-items: center; gap: 10px; padding: 7px 10px; margin: 6px 0; background: #2a1f10; border-left: 3px solid #e8a33d; border-radius: 0 5px 5px 0; font-size: 12px; color: #ffd79a; }
.pi-warn b { color: #ffe3b3; }
.pi-outlined { box-shadow: inset 0 0 0 2px #efebe2 !important; position: relative; }
.pi-dim { opacity: .45; }
.pi-strip .pi-part { color: #939aa1; white-space: nowrap; }
.pi-strip .pi-part.pi-cur { color: #fff; font-weight: bold; }
.pi-strip .pi-part.pi-done { color: #9bdc8a; }
.pi-strip .pi-done-all { color: #9bdc8a; font-weight: bold; }
.pi-label { position: absolute; top: -9px; left: 10px; right: auto; height: 18px; line-height: 18px; padding: 0 8px; border-radius: 9px; background: #efebe2; color: #15171a; font: bold 11px Arial, sans-serif; pointer-events: none; z-index: 2; white-space: nowrap; }
`;

/** Our page CSS, once per page (torn.com: no outside fonts). */
export function ensureMarkCss(doc = document) {
    if (doc.getElementById('pi-mark-css')) return;
    const st = doc.createElement('style');
    st.id = 'pi-mark-css';
    st.textContent = MARK_CSS;
    (doc.head || doc.documentElement).appendChild(st);
}

/** Remove every mark we drew inside `scope`. */
export function clearMarks(scope = document) {
    for (const el of scope.querySelectorAll('.pi-mark')) el.remove();
    for (const el of scope.querySelectorAll('.pi-on, .pi-outlined, .pi-dim')) el.classList.remove('pi-on', 'pi-outlined', 'pi-dim');
}

function plate() {
    return h('span', { class: 'pi-plate' }, [h('i')]);
}

/**
 * Draw the gym page marks from planGymPage() output.
 * @param {Element} root - #gymroot
 * @param {object} plan - planGymPage(model, page)
 * @param {object[]} boxes - readStatBoxes(root)
 * @param {function} rereadBox - (stat) => the box as it is now (React may have replaced the input)
 * @param {{id, el}[]} [buttons] - readGymButtons(root): the next part's gym gets an outline
 */
export function drawGymMarks(root, plan, boxes, rereadBox, buttons = []) {
    clearMarks(root);
    const list = root.querySelector('ul[class*="properties___"]');
    if (!list) return;
    const sep = (text) => h('span', { class: 'pi-sep', text });
    const strip = h('div', { class: 'pi-mark pi-strip' }, [plate()]);
    strip.appendChild(h('b', { text: plan.strip[0] || '' }));
    // The session, part by part: ticks on the ones done, the current one bright.
    if (plan.parts && plan.parts.length) {
        strip.appendChild(sep('·'));
        plan.parts.forEach((p, i) => {
            if (i) strip.appendChild(sep('→'));
            const words = p.gymName + ': ' + p.stat.toUpperCase() + ' × ' + p.trains + (p.state === 'current' && p.done > 0 ? ' (' + p.left + ' left)' : '');
            strip.appendChild(h('span', { class: 'pi-part' + (p.state === 'done' ? ' pi-done' : p.state === 'current' ? ' pi-cur' : ''), text: (p.state === 'done' ? '✓ ' : '') + words }));
        });
    }
    if (plan.done) {
        strip.appendChild(sep('·'));
        strip.appendChild(h('span', { class: 'pi-done-all', text: 'Session done' }));
    }
    for (const p of plan.strip.slice(1)) {
        strip.appendChild(sep('·'));
        strip.appendChild(h('span', { text: p }));
    }
    if (plan.switchHint) {
        strip.appendChild(sep('·'));
        strip.appendChild(h('span', { class: 'pi-hint', text: plan.switchHint }));
    }
    list.parentNode.insertBefore(strip, list);
    // The next part is in another gym: outline that gym's button (the user switches; we never do).
    if (plan.nextGym) {
        const b = buttons.find((x) => x.id === plan.nextGym.id);
        if (b && b.el) outline(b.el, plan.nextGym.label);
        // Its button isn't on the page (Torn shows one group of gyms at a time): the strip says which group to open.
        else strip.appendChild(h('span', { class: 'pi-hint', text: ' · open ' + plan.nextGym.group.replace(/^a /, 'the ') + 's to find it' }));
    }
    if (plan.hereGym) {
        const b = buttons.find((x) => x.id === plan.hereGym.id);
        if (b && b.el) outline(b.el, plan.hereGym.label);
    }
    for (const box of boxes) {
        const p = plan.perStat[box.stat];
        if (!p) continue;
        if (p.kind === 'train') {
            const n = p.fill !== undefined ? p.fill : p.trains;
            box.li.classList.add('pi-on');
            box.li.appendChild(h('span', { class: 'pi-mark pi-label', text: 'Train this' }));
            const fill = h('button', {
                class: 'pi-fill',
                type: 'button',
                text: 'Fill ' + n,
                disabled: n <= 0,
                onclick: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const now = rereadBox(box.stat) || box;
                    fillTrains(now.input, n);
                },
            });
            const panel = p.warn ? h('div', { class: 'pi-mark pi-warn' }, [h('span', {}, [h('b', { text: p.warn.split('. ')[0] + '.' }), ' ' + p.warn.split('. ').slice(1).join('. ')]), fill]) : h('div', { class: 'pi-mark pi-panel' }, [h('b', { text: p.text }), h('span', { text: p.sub }), fill]);
            box.content.insertBefore(panel, box.content.firstChild);
        } else {
            // Waiting on another gym's part: the whole box greys out.
            if (p.kind === 'grey') box.li.classList.add('pi-dim');
            box.content.insertBefore(h('div', { class: 'pi-mark pi-grey', text: p.text }), box.content.firstChild);
        }
    }
}

/** Outline one element with a label (items, bazaar cards, market rows, points lots). */
export function outline(el, label) {
    if (!el) return;
    el.classList.add('pi-outlined');
    el.appendChild(h('span', { class: 'pi-mark pi-label', text: label }));
}
