/*
 * Reading player rows on the pages Torn Eye marks (docs/research-dom.md
 * §6–8): profiles, the mini-profile popup, faction member lists and ranked
 * war lists. Read only.
 */

function idFromHref(a) {
    const m = a && String(a.getAttribute('href') || '').match(/XID=(\d+)/i);
    return m ? Number(m[1]) : null;
}

/** Level on a profile page (three digit boxes, TornTools' reading). */
export function profileLevel(doc = document) {
    const box = doc.querySelector('.box-info .box-value');
    if (!box) return null;
    const d = (cls) => Number((box.querySelector('.' + cls + ' .digit') || {}).textContent) || 0;
    const v = d('digit-r') * 100 + d('digit-m') * 10 + d('digit-l');
    return v > 0 ? v : null;
}

export function profileAnchor(doc = document) {
    return doc.querySelector('.content-title');
}

/** Faction member list rows: [{id, level, status, el, cell}] (fallen players skipped). */
export function readFactionRows(doc = document) {
    const out = [];
    for (const li of doc.querySelectorAll('.members-list .table-body > li.table-row')) {
        if (li.querySelector('[id*="icon77___"]')) continue;
        const a = li.querySelector('[class*="honorWrap___"] a[href*="XID="]') || li.querySelector('a[href*="profiles.php?XID="]');
        const id = idFromHref(a);
        if (!id) continue;
        out.push({ id, level: Number((li.querySelector('.lvl') || {}).textContent) || null, status: String((li.querySelector('.status') || {}).textContent || '').trim(), el: li, cell: li.querySelector('.member') || li, name: a.getAttribute('aria-label') ? a.getAttribute('aria-label').replace(/^View profile of /, '') : null });
    }
    return out;
}

/** Ranked-war rows on one side: [{id, level, status, el, cell}]. */
export function readWarRows(doc = document, side = 'enemy') {
    const out = [];
    for (const li of doc.querySelectorAll('#faction_war_list_id ul.members-list > li.' + side)) {
        const a = li.querySelector('.member a[href*="XID="]');
        const id = idFromHref(a);
        if (!id) continue;
        out.push({ id, level: Number((li.querySelector('.level') || {}).textContent) || null, status: String((li.querySelector('.status') || {}).textContent || '').trim(), el: li, cell: li.querySelector('.member') || li, name: a.getAttribute('aria-label') ? a.getAttribute('aria-label').replace(/^View profile of /, '') : null });
    }
    return out;
}

/** The enemy faction's id on a ranked-war list. */
export function enemyFactionId(doc = document) {
    const a = doc.querySelector('#faction_war_list_id .enemy-faction a[href*="factions.php?step=profile&ID="], #faction_war_list_id li.enemy a[href*="step=profile"]');
    const m = a && String(a.getAttribute('href')).match(/ID=(\d+)/);
    return m ? Number(m[1]) : null;
}

/**
 * Your faction's chain as Torn's sidebar shows it: the count over the next bonus ("247/250") and the timer ("03:42")
 * [check live: the selectors follow the energy bar's, #barChain or the bar classed chain]. Read only: two texts are
 * looked at. null when the page shows no chain bar.
 * @returns {{value: string, time: string}|null}
 */
export function readChainBar(doc = document) {
    const bar = doc.getElementById('barChain') || doc.querySelector('[class*="bar___"][class*="chain"]') || doc.querySelector('[class*="chain-bar___"]');
    const v = bar && bar.querySelector('[class*="bar-value___"]');
    if (!v) return null;
    const t = bar.querySelector('[class*="bar-timeleft___"]');
    return { value: String(v.textContent || '').trim(), time: t ? String(t.textContent || '').trim() : '' };
}

/**
 * The loadout you wear, as Torn's items page names it: the text of #loadoutsRoot begins "Loadout #2", then the worn
 * gear's slots [check live: that is all that was read of its markup (2026-10-05); nothing else of it is relied on].
 * Read only: one text is looked at. Torn's own "Loadouts" button in that box is never clicked, its menu never opened.
 * `sig` is the box's text as one line, only to notice that it changed (another loadout, another piece).
 * null whenever the text does not begin that way (no box, other words, a number that is no loadout's).
 * @returns {{n: number, sig: string}|null}
 */
export function readLoadout(doc = document) {
    const root = doc.getElementById('loadoutsRoot');
    if (!root) return null;
    const text = String(root.textContent || '').replace(/\s+/g, ' ').trim();
    const m = text.match(/^Loadout ?# ?(\d{1,2})(?!\d)/i);
    if (!m || !(Number(m[1]) >= 1)) return null;
    return { n: Number(m[1]), sig: text.slice(0, 600) };
}

/** The player the mini-profile popup is showing. */
export function miniProfileId(doc = document) {
    const root = doc.getElementById('profile-mini-root');
    if (!root) return null;
    return idFromHref(root.querySelector('a[href*="XID="]'));
}

/** Where the attack page's own layout is, to sit beside it. */
export function attackRoot(doc = document) {
    return doc.getElementById('attack-root') || doc.querySelector('[class*="playersModelWrap___"]');
}
