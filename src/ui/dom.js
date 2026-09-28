/*
 * Building DOM without innerHTML for anything that came from Torn, a third
 * party or the user: text goes in through textContent, always.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TAGS = new Set(['svg', 'polyline', 'line', 'rect', 'text', 'g', 'circle', 'path']);

/**
 * h('div', {class: 'x', onclick: fn, text: 'hi'}, [children])
 * Attributes: class, text, style (string), on<event> (function), dataset
 * via 'data-*', aria-*, and anything else set as an attribute.
 */
export function h(tag, attrs = {}, children = []) {
    const svg = SVG_TAGS.has(tag);
    const el = svg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v === null || v === undefined || v === false) continue;
        if (k === 'text') el.textContent = String(v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (k === 'value' && !svg) el.value = v;
        else if (k === 'checked' && !svg) el.checked = Boolean(v);
        else el.setAttribute(k === 'className' ? 'class' : k, v === true ? '' : String(v));
    }
    for (const c of [].concat(children)) {
        if (c === null || c === undefined || c === false) continue;
        el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
    }
    return el;
}

/** A text span with a class. */
export function t(cls, text) {
    return h('span', { class: cls, text });
}

/** Replace a node's children. */
export function fill(el, children) {
    while (el.firstChild) el.removeChild(el.firstChild);
    for (const c of [].concat(children)) if (c) el.appendChild(c);
    return el;
}

/** A polyline sparkline in a w×h box from values (nulls skipped). */
export function sparkline(values, { w = 76, h: ht = 18, color = '#efebe2', cls = 'spark', pad = 2 } = {}) {
    const v = (values || []).map((x) => (Number.isFinite(x) ? x : null));
    const nums = v.filter((x) => x !== null);
    const svg = h('svg', { class: cls, viewBox: '0 0 ' + w + ' ' + ht, 'aria-hidden': 'true' });
    if (nums.length < 2) return svg;
    const lo = Math.min(...nums);
    const hi = Math.max(...nums);
    const pts = [];
    v.forEach((y, i) => {
        if (y === null) return;
        const x = v.length === 1 ? 0 : (i / (v.length - 1)) * w;
        const yy = hi === lo ? ht / 2 : ht - pad - ((y - lo) / (hi - lo)) * (ht - 2 * pad);
        pts.push(x.toFixed(1) + ',' + yy.toFixed(1));
    });
    svg.appendChild(h('polyline', { fill: 'none', stroke: color, 'stroke-width': '1.5', points: pts.join(' ') }));
    return svg;
}
