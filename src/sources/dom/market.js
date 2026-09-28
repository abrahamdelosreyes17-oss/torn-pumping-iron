/*
 * Reading the items page, bazaars, the Item Market and the points market
 * the user is viewing (docs/research-dom.md §2–5). Read only.
 */

function pageMoney(text) {
    const v = Number(String(text || '').replace(/[^\d]/g, ''));
    return Number.isFinite(v) && v > 0 ? v : null;
}

function pageVisible(el) {
    return Boolean(el && el.getClientRects && el.getClientRects().length);
}

/** Item rows on item.php in the list that's showing: [{itemId, el}]. */
export function readItemRows(doc = document) {
    const lists = [...doc.querySelectorAll('ul.items-cont')];
    const shown = lists.filter((ul) => ul.getAttribute('aria-expanded') === 'true' || (ul.style && ul.style.display === 'block')) || [];
    const out = [];
    for (const ul of shown.length ? shown : lists.filter(pageVisible)) {
        for (const li of ul.querySelectorAll(':scope > li[data-item]')) out.push({ itemId: Number(li.getAttribute('data-item')), el: li, qty: Number(li.getAttribute('data-qty')) || null });
    }
    return out;
}

/** Bazaar cards: [{itemId, price, qty, el}] (item id from the image path). */
export function readBazaarCards(doc = document) {
    const out = [];
    for (const d of doc.querySelectorAll('[class*="itemDescription___"]')) {
        const img = d.querySelector('img[src*="/images/items/"]');
        const m = img && String(img.getAttribute('src')).match(/\/images\/items\/(\d+)\//);
        if (!m) continue;
        const amount = d.querySelector('[class*="amount___"]');
        out.push({ itemId: Number(m[1]), price: pageMoney((d.querySelector('[class*="price___"]') || {}).textContent), qty: amount ? pageMoney(amount.textContent) : null, el: d.closest('[class*="item___"]') || d, blocked: Boolean(d.querySelector('[class*="isBlockedForBuying___"]')) });
    }
    return out;
}

/** Item Market seller rows for the item in view: [{price, qty, el}]. */
export function readItemMarketRows(doc = document) {
    const out = [];
    for (const row of doc.querySelectorAll('[class*="rowWrapper___"] [class*="sellerRow___"]')) {
        const price = pageMoney((row.querySelector('[class*="price___"]') || {}).textContent);
        if (!price) continue;
        out.push({ price, qty: pageMoney((row.querySelector('[class*="available___"]') || {}).textContent), el: row.closest('[class*="rowWrapper___"]') || row });
    }
    return out;
}

/** Points market lots: [{listingId, price, qty, el}]; your own (remove) lots are skipped. */
export function readPointsRows(doc = document) {
    const out = [];
    for (const li of doc.querySelectorAll('ul.users-point-sell > li')) {
        const ex = li.querySelector('.expander[href]');
        const href = ex ? ex.getAttribute('href') : '';
        if (!/ajax_action=buy/.test(href)) continue;
        const id = (href.match(/[?&]ID=(\d+)/) || [])[1] || null;
        const cell = (sel) => {
            const c = li.querySelector(sel);
            if (!c) return '';
            const clone = c.cloneNode(true);
            for (const w of clone.querySelectorAll('.wai')) w.remove();
            return clone.textContent;
        };
        out.push({ listingId: id, price: pageMoney(cell('.cost-each')), qty: pageMoney(cell('.points')), el: li });
    }
    return out;
}
