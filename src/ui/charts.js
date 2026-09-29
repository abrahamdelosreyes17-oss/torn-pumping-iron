/*
 * Small SVG charts for the webpage (the round-3 mockups' shapes, r3.js),
 * built with dom.js: text goes in through textContent, never markup.
 */

import { h } from './dom.js';

/** 1234567 → "1.2M", 45000 → "45k". */
export function chartNum(v) {
    const a = Math.abs(v);
    if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e8 ? 0 : 1) + 'M';
    if (a >= 1e3) return Math.round(v / 1e3) + 'k';
    return String(Math.round(v));
}

function svgBox(w, hgt, label) {
    return h('svg', { class: 'ch num', viewBox: '0 0 ' + w + ' ' + hgt, role: 'img', 'aria-label': label || '' });
}

function txt(svg, x, y, s, attrs = {}) {
    svg.appendChild(h('text', { x: Number(x).toFixed(1), y: Number(y).toFixed(1), ...attrs, text: s }));
}

/**
 * Lines over the same x steps, labelled at their ends.
 * @param {object[]} series - [{name, color, width, dash, values (nulls skipped), label, labelColor}]
 * @param {object} o - {w, h, left, right, yMin, yMax, n, xLabels:[[i, text]], grid:[values], today (index), label}
 */
export function lineChart(series, o = {}) {
    const W = o.w || 600;
    const H = o.h || 180;
    const L = o.left ?? 44;
    const R = o.right ?? 90;
    const T = 8;
    const B = 20;
    const svg = svgBox(W, H, o.label);
    const n = Math.max(1, ...series.map((s) => s.values.length));
    const all = series.flatMap((s) => s.values.filter((v) => v !== null && Number.isFinite(v)));
    if (!all.length) return svg;
    const yMin = o.yMin ?? Math.min(0, ...all);
    const yMax = o.yMax ?? Math.max(...all) * 1.05;
    const x = (i) => L + (i / Math.max(1, (o.n || n) - 1)) * (W - L - R);
    const y = (v) => T + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - T - B);
    for (const g of o.grid || []) {
        svg.appendChild(h('line', { class: 'grid', x1: L, x2: W - R, y1: y(g).toFixed(1), y2: y(g).toFixed(1) }));
        txt(svg, L - 6, y(g) + 4, chartNum(g), { 'text-anchor': 'end' });
    }
    svg.appendChild(h('line', { class: 'ax', x1: L, x2: W - R, y1: H - B, y2: H - B }));
    for (const [i, s] of o.xLabels || []) txt(svg, x(i), H - 4, s, { 'text-anchor': i === 0 ? 'start' : i >= (o.n || n) - 1 ? 'end' : 'middle' });
    if (o.today !== undefined && o.today !== null) {
        svg.appendChild(h('line', { x1: x(o.today).toFixed(1), x2: x(o.today).toFixed(1), y1: T, y2: H - B, stroke: 'var(--line2)', 'stroke-dasharray': '3 3' }));
        txt(svg, x(o.today) + 4, T + 10, 'today');
    }
    const ends = [];
    for (const s of series) {
        const pts = s.values.map((v, i) => (v === null || !Number.isFinite(v) ? null : x(i).toFixed(1) + ',' + y(v).toFixed(1))).filter(Boolean);
        if (!pts.length) continue;
        svg.appendChild(h('polyline', { points: pts.join(' '), fill: 'none', stroke: s.color, 'stroke-width': s.width || 1.5, 'stroke-dasharray': s.dash || null, 'stroke-linejoin': 'round' }));
        let last = -1;
        s.values.forEach((v, i) => {
            if (v !== null && Number.isFinite(v)) last = i;
        });
        if (s.label !== false && last >= 0) ends.push({ y: y(s.values[last]), x: x(last), s });
    }
    // Direct labels at the line ends, nudged apart.
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) if (ends[i].y - ends[i - 1].y < 13) ends[i].y = ends[i - 1].y + 13;
    for (const e of ends) txt(svg, e.x + 6, e.y + 4, e.s.label || e.s.name, { style: 'fill:' + (e.s.labelColor || e.s.color) + ';font-weight:' + ((e.s.width || 1.5) > 2 ? 'bold' : 'normal') });
    return svg;
}

/**
 * Stacked bars, one per day.
 * @param {{c:string, v:number}[][]} days
 * @param {string[]} labels
 * @param {object} o - {w, h, max, top:[text per bar], label}
 */
export function stackBars(days, labels, o = {}) {
    const W = o.w || 600;
    const H = o.h || 90;
    const B = 16;
    const TOP = o.top ? 16 : 4;
    const svg = svgBox(W, H, o.label);
    const max = o.max || Math.max(1, ...days.map((d) => d.reduce((a, b) => a + b.v, 0)));
    const bw = W / Math.max(1, days.length);
    days.forEach((d, i) => {
        let yy = H - B;
        for (const p of d) {
            const hh = (Math.max(0, p.v) / max) * (H - B - TOP);
            yy -= hh;
            svg.appendChild(h('rect', { x: (i * bw + bw * 0.3).toFixed(1), y: yy.toFixed(1), width: (bw * 0.4).toFixed(1), height: hh.toFixed(1), fill: p.c, rx: 1 }));
        }
        txt(svg, i * bw + bw / 2, H - 3, labels[i] || '', { 'text-anchor': 'middle' });
        if (o.top && o.top[i]) txt(svg, i * bw + bw / 2, yy - 4, o.top[i], { 'text-anchor': 'middle', style: 'fill:var(--muted)' });
    });
    return svg;
}

/**
 * Gained against plan, each day, as % of plan (100 = on plan).
 * @param {(number|null)[]} pct
 * @param {string[]} labels
 * @param {object} o - {w, h, partial (index of today)}
 */
export function planBars(pct, labels, o = {}) {
    const W = o.w || 600;
    const H = o.h || 110;
    const B = 16;
    const T = 10;
    const svg = svgBox(W, H, o.label);
    const max = 140;
    const y = (v) => T + (1 - Math.min(Math.max(v, 0), max) / max) * (H - T - B);
    svg.appendChild(h('line', { class: 'grid', x1: 0, x2: W, y1: y(100).toFixed(1), y2: y(100).toFixed(1) }));
    txt(svg, W, y(100) - 3, 'plan', { 'text-anchor': 'end' });
    const bw = W / Math.max(1, pct.length);
    pct.forEach((v, i) => {
        if (v === null || !Number.isFinite(v)) return;
        const c = i === o.partial ? 'var(--line2)' : v >= 95 ? 'var(--good)' : v >= 75 ? 'var(--spd)' : 'var(--bad)';
        svg.appendChild(h('rect', { x: (i * bw + bw * 0.2).toFixed(1), y: y(v).toFixed(1), width: (bw * 0.6).toFixed(1), height: Math.max(0, H - B - y(v)).toFixed(1), fill: c, rx: 1 }));
    });
    labels.forEach((l, i) => {
        if (l) txt(svg, i * bw + bw / 2, H - 3, l, { 'text-anchor': 'middle' });
    });
    return svg;
}

/**
 * Predicted (x) against actual (y) with the 1:1 line.
 * @param {{x:number, y:number, c:string}[]} pts
 * @param {object} o - {w, h, max, min, grid, xl, yl}
 */
export function scatter(pts, o = {}) {
    const W = o.w || 480;
    const H = o.h || 240;
    const L = 46;
    const B = 22;
    const T = 8;
    const R = 10;
    const svg = svgBox(W, H, o.label);
    if (!pts.length) return svg;
    const mx = o.max || Math.max(...pts.flatMap((p) => [p.x, p.y])) * 1.05;
    const mn = o.min ?? 0;
    const x = (v) => L + ((v - mn) / (mx - mn || 1)) * (W - L - R);
    const y = (v) => T + (1 - (v - mn) / (mx - mn || 1)) * (H - T - B);
    svg.appendChild(h('line', { class: 'ax', x1: L, x2: W - R, y1: H - B, y2: H - B }));
    svg.appendChild(h('line', { x1: x(mn).toFixed(1), y1: y(mn).toFixed(1), x2: x(mx).toFixed(1), y2: y(mx).toFixed(1), stroke: 'var(--line2)', 'stroke-dasharray': '4 4' }));
    txt(svg, x(mx) - 4, y(mx) + 14, 'perfect', { 'text-anchor': 'end' });
    for (const g of o.grid || []) {
        txt(svg, L - 6, y(g) + 4, o.fmt ? o.fmt(g) : chartNum(g), { 'text-anchor': 'end' });
        txt(svg, x(g), H - 6, o.fmt ? o.fmt(g) : chartNum(g), { 'text-anchor': 'middle' });
    }
    for (const p of pts) svg.appendChild(h('circle', { cx: x(p.x).toFixed(1), cy: y(p.y).toFixed(1), r: 3.2, fill: p.c, 'fill-opacity': 0.85 }));
    if (o.xl) txt(svg, W - R, H - 6, o.xl, { 'text-anchor': 'end', style: 'fill:var(--muted)' });
    if (o.yl) txt(svg, L + 4, T + 10, o.yl, { style: 'fill:var(--muted)' });
    return svg;
}

/**
 * Plain bars with labels on a 0..max scale; `ref` draws a chalk tick (what it said).
 * @param {{v:number, c:string, label:string, top?:string, ref?:number}[]} list
 */
export function bars(list, o = {}) {
    const W = o.w || 480;
    const H = o.h || 160;
    const B = 18;
    const T = 14;
    const svg = svgBox(W, H, o.label);
    const max = o.max || 100;
    const bw = W / Math.max(1, list.length);
    const y = (v) => T + (1 - Math.min(v, max) / max) * (H - T - B);
    list.forEach((b, i) => {
        svg.appendChild(h('rect', { x: (i * bw + bw * 0.25).toFixed(1), y: y(b.v).toFixed(1), width: (bw * 0.5).toFixed(1), height: Math.max(0, H - B - y(b.v)).toFixed(1), fill: b.c, rx: 1 }));
        if (b.ref !== undefined) svg.appendChild(h('line', { x1: (i * bw + bw * 0.15).toFixed(1), x2: (i * bw + bw * 0.85).toFixed(1), y1: y(b.ref).toFixed(1), y2: y(b.ref).toFixed(1), stroke: 'var(--chalk)', 'stroke-width': 2 }));
        txt(svg, i * bw + bw / 2, H - 4, b.label, { 'text-anchor': 'middle' });
        if (b.top) txt(svg, i * bw + bw / 2, y(Math.max(b.v, b.ref ?? 0)) - 6, b.top, { 'text-anchor': 'middle', style: 'fill:var(--muted)' });
    });
    return svg;
}
