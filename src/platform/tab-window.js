/*
 * A request window every tab shares, without tabs losing each other's writes.
 *
 * The old shared window was one stored array: each tab read it, pushed its
 * request and wrote it back. Tampermonkey hands each tab its own copy of a
 * value and syncs changes asynchronously, so two tabs taking a slot at about
 * the same time each wrote back an array without the other's timestamp - and
 * the shared count ran low exactly when the most tabs were busy.
 *
 * Now each tab writes ONLY its own timestamps, under its own key, and a small
 * registry lists the tabs. Reading adds every live tab's list together. A
 * registry write can still race, but only on a tab's first slot (or after a
 * cleanup), and a tab missing from the registry puts itself back on its next
 * slot - so at worst one tab's calls go uncounted until its next call.
 */

/** A tab whose newest slot is older than this is gone; its key is deleted. */
export const TAB_WINDOW_STALE_MS = 2 * 60 * 1000;

/**
 * @param {string} name - storage key prefix, e.g. 'apiWindow'
 * @param {string} tabId
 * @param {object} store - {get(key, fallback), set(key, value), del(key)}
 * @param {function} [now]
 * @param {object} [o]
 * @param {number} [o.batchMs] - round 6: a burst's first slot is written at once, the rest together this long after
 *   (every GM write reaches every open Torn tab; a watch-list sweep took two writes per request). 0: every slot.
 */
export function tabWindow(name, tabId, store, now = () => Date.now(), { batchMs = 0 } = {}) {
    const regKey = name + '.tabs';
    const ownKey = name + '.' + tabId;
    let own = [];
    let lastWrite = -Infinity;
    let pending = null;
    const writeOwn = () => {
        lastWrite = now();
        store.set(ownKey, own.filter((x) => lastWrite - x < 60000));
    };

    const registry = () => {
        const r = store.get(regKey, null);
        return r && typeof r === 'object' && !Array.isArray(r) ? r : {};
    };

    return {
        /** Every live tab's timestamps of the last minute, oldest first. */
        load() {
            const t = now();
            const out = [];
            for (const id of Object.keys(registry())) {
                const list = id === tabId ? own : store.get(name + '.' + id, []);
                if (!Array.isArray(list)) continue;
                for (const x of list) if (Number.isFinite(x) && t - x < 60000) out.push(x);
            }
            // This tab before it is registered (its first slot is being taken).
            if (!Object.prototype.hasOwnProperty.call(registry(), tabId)) {
                for (const x of own) if (t - x < 60000) out.push(x);
            }
            return out.sort((a, b) => a - b);
        },

        /** Record one slot taken by this tab. */
        add(at) {
            const t = now();
            own = own.filter((x) => t - x < 60000);
            own.push(at);
            if (!batchMs || t - lastWrite >= batchMs) writeOwn();
            else if (!pending) {
                pending = setTimeout(() => {
                    pending = null;
                    writeOwn();
                }, batchMs - (t - lastWrite));
            }

            const reg = registry();
            let changed = false;
            if (!reg[tabId] || t - reg[tabId] > TAB_WINDOW_STALE_MS / 4) {
                reg[tabId] = t;
                changed = true;
            }
            for (const [id, seen] of Object.entries(reg)) {
                if (id !== tabId && !(t - seen <= TAB_WINDOW_STALE_MS)) {
                    delete reg[id];
                    store.del(name + '.' + id);
                    changed = true;
                }
            }
            if (changed) store.set(regKey, reg);
        },
    };
}
