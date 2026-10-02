/*
 * Reading Torn's gym page (the one the user is viewing). React with hashed
 * class names, so everything matches by prefix ([class*="strength___"]).
 * Selectors: docs/research-dom.md §1. Nothing here clicks; `fillTrains`
 * only types a number into Torn's box, on the user's click.
 */

const STAT_OF_CLASS = [
    ['strength', 'str'],
    ['speed', 'spd'],
    ['defense', 'def'],
    ['dexterity', 'dex'],
];

export function gymRoot(doc = document) {
    return doc.getElementById('gymroot');
}

/** The page is still loading (skeleton) or not a gym page. */
export function gymLoading(root) {
    return !root || Boolean(root.querySelector('[class*="skeletonWrapper___"]')) || !root.querySelector('ul[class*="properties___"]');
}

function gymNum(text) {
    const v = Number(String(text || '').replace(/[^\d.]/g, ''));
    return Number.isFinite(v) ? v : null;
}

/**
 * The four stat boxes.
 * @returns {{stat, li, value, energyPerTrain, input, button, locked}[]}
 */
export function readStatBoxes(root) {
    const out = [];
    const list = root && root.querySelector('ul[class*="properties___"]');
    if (!list) return out;
    for (const li of list.children) {
        const cls = String(li.className || '');
        const hit = STAT_OF_CLASS.find(([word]) => cls.includes(word + '___'));
        if (!hit) continue;
        const desc = li.querySelector('[class*="description___"]');
        const m = desc && String(desc.textContent || '').match(/(\d+)\s*energy per train/i);
        out.push({
            stat: hit[1],
            li,
            value: gymNum((li.querySelector('[class*="propertyValue___"]') || {}).textContent),
            energyPerTrain: m ? Number(m[1]) : null,
            input: li.querySelector('[class*="inputWrapper___"] input') || li.querySelector('input'),
            button: li.querySelector('button[aria-label^="Train "]'),
            locked: /locked___/.test(cls),
            content: li.querySelector('[class*="propertyContent___"]') || li,
        });
    }
    return out;
}

/**
 * The gym list: id (from the icon's gym-N class), state and progress.
 * @returns {{id, state, percent}[]}
 */
export function readGymButtons(root) {
    const out = [];
    for (const b of (root && root.querySelectorAll('[class*="gymButton___"]')) || []) {
        const icon = b.querySelector('[class*="gymIcon___"]');
        // Live Torn (checked 2026-09-29) hashes this class too: "gym-1___Ij5f9"; older pages had a plain "gym-1".
        const m = icon && String(icon.className).match(/(?:^|\s)gym-(\d+)(?:___[\w-]*)?(?=\s|$)/);
        if (!m) continue;
        const cls = String(b.className);
        // A button with no state class (live Torn: just "gymButton___…") is a gym you can use.
        const state = /selected___/.test(cls) ? 'selected' : /inProgress___/.test(cls) ? 'inProgress' : /lockedPurchased___/.test(cls) ? 'lockedPurchased' : /locked___/.test(cls) ? 'locked' : 'active';
        const pct = b.querySelector('[class*="percentage___"]');
        // "Premier Fitness. Membership cost - $10. Energy usage - 5 per train." → the gym's name.
        const label = b.getAttribute('aria-label') || '';
        out.push({ id: Number(m[1]), state, percent: pct ? gymNum(pct.textContent) : null, name: label ? label.split('.')[0].trim() : null, el: b });
    }
    return out;
}

/**
 * Torn's sidebar energy bar ("150/150"): it moves the moment a train lands,
 * before our next API read. Null when the page doesn't show it.
 * @returns {{current:number, max:number}|null}
 */
export function readEnergyBar(doc = document) {
    const bar = doc.getElementById('barEnergy') || doc.querySelector('[class*="bar___"][class*="energy___"]');
    const v = bar && bar.querySelector('[class*="bar-value___"]');
    const m = v && String(v.textContent || '').replace(/,/g, '').match(/(\d+)\s*\/\s*(\d+)/);
    return m ? { current: Number(m[1]), max: Number(m[2]) } : null;
}

/**
 * Torn's sidebar happy bar ("4,965/5,025"), like the energy bar [check live: the selector follows the energy bar's].
 * @returns {{current:number, max:number}|null}
 */
export function readHappyBar(doc = document) {
    const bar = doc.getElementById('barHappy') || doc.querySelector('[class*="bar___"][class*="happy___"]');
    const v = bar && bar.querySelector('[class*="bar-value___"]');
    const m = v && String(v.textContent || '').replace(/,/g, '').match(/(\d+)\s*\/\s*(\d+)/);
    return m ? { current: Number(m[1]), max: Number(m[2]) } : null;
}

/**
 * Did the player do something between two looks at the sidebar bars (round 7, D.4)? Energy that dropped (trained),
 * or rose by more than a regeneration tick (a Xanax, a refill, a can); happy that moved by more than a tick's worth
 * (trains use it, boosters add it). Natural regeneration alone is not an action.
 * @param {{energy, happy}} a - {current} each, or null
 * @param {{energy, happy}} b
 */
export function barsActed(a, b) {
    const num = (x) => (x && Number.isFinite(x.current) ? x.current : null);
    const e0 = num(a && a.energy);
    const e1 = num(b && b.energy);
    const h0 = num(a && a.happy);
    const h1 = num(b && b.happy);
    if (e0 !== null && e1 !== null && (e1 < e0 || e1 - e0 > 10)) return true;
    return h0 !== null && h1 !== null && Math.abs(h1 - h0) > 10;
}

/** Unlocked gym ids (usable now), the gym you're in, and the one being unlocked. */
export function gymListSummary(buttons) {
    const unlocked = buttons.filter((b) => b.state === 'active' || b.state === 'selected').map((b) => b.id);
    const selected = buttons.find((b) => b.state === 'selected');
    const inProgress = buttons.find((b) => b.state === 'inProgress');
    return { unlocked, selectedId: selected ? selected.id : null, inProgress: inProgress ? { id: inProgress.id, percent: inProgress.percent } : null };
}

/**
 * Type a number into Torn's trains box, the way a person would: React
 * ignores a plain `.value =`, so the native setter plus an input event.
 * Never submits and never clicks TRAIN.
 */
export function fillTrains(input, n) {
    if (!input || input.disabled) return false;
    const proto = Object.getPrototypeOf(input);
    const desc = Object.getOwnPropertyDescriptor(proto, 'value') || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    if (desc && desc.set) desc.set.call(input, String(n));
    else input.value = String(n);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
}
