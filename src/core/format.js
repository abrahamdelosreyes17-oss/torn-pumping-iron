/*
 * Number words the way the pages show them. Pure.
 */

/** 1234567 → "1,234,567" */
export function fmtInt(n) {
    const v = Math.round(Number(n) || 0);
    return (v < 0 ? '−' : '') + Math.abs(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Signed: "+1,420", "−300" */
export function fmtSigned(n) {
    const v = Math.round(Number(n) || 0);
    return (v >= 0 ? '+' : '') + fmtInt(v);
}

/** Short stats: 994142 → "994k", 1124595 → "1.12M", 119410643 → "119M", 8723 → "8,723" */
export function fmtShort(n) {
    const v = Math.abs(Number(n) || 0);
    const sign = Number(n) < 0 ? '−' : '';
    if (v >= 1e9) return sign + trim(v / 1e9, v >= 1e10 ? 1 : 2) + 'B';
    if (v >= 1e6) return sign + trim(v / 1e6, v >= 1e8 ? 0 : v >= 1e7 ? 1 : 2) + 'M';
    if (v >= 1e5) return sign + Math.round(v / 1e3) + 'k';
    return sign + fmtInt(v);
}

function trim(x, dp) {
    return x.toFixed(dp).replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
}

/** Money: "$826,500" under $1M, "$6.62M", "$126M", "$1.2B" */
export function fmtMoney(n) {
    const v = Number(n) || 0;
    if (Math.abs(v) < 1e6) return (v < 0 ? '−$' : '$') + fmtInt(Math.abs(v));
    const s = fmtShort(Math.abs(v));
    return (v < 0 ? '−$' : '$') + s;
}

/** "+13%", "−40%" */
export function fmtPct(p, dp = 0) {
    const v = Number(p) || 0;
    return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(dp) + '%';
}
