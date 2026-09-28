/*
 * A small key-value store in the page's own IndexedDB, for data only ONE page
 * needs. Tampermonkey hands every stored GM value to the script before it
 * starts, on every page it runs on - so the Torn Ledger's rows (which only
 * Torn Bids reads, and which grow with every trade) slowed every Torn page
 * they were never shown on. Here they cost Torn pages nothing.
 *
 * Every call rejects where IndexedDB is missing or refused (some private
 * windows); the caller then keeps the GM store.
 */

const IDB_NAME = 'pumpingIron';
const IDB_STORE = 'kv';

let idbOpening = null;

function idbOpen() {
    if (!idbOpening) {
        idbOpening = new Promise((resolve, reject) => {
            if (typeof indexedDB === 'undefined' || !indexedDB) {
                reject(new Error('No IndexedDB.'));
                return;
            }
            const req = indexedDB.open(IDB_NAME, 1);
            req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('IndexedDB refused.'));
            req.onblocked = () => reject(new Error('IndexedDB blocked.'));
        });
        // A failed open is tried again next time rather than remembered.
        idbOpening.catch(() => {
            idbOpening = null;
        });
    }
    return idbOpening;
}

function idbRun(mode, fn) {
    return idbOpen().then(
        (db) =>
            new Promise((resolve, reject) => {
                const tx = db.transaction(IDB_STORE, mode);
                const req = fn(tx.objectStore(IDB_STORE));
                tx.oncomplete = () => resolve(req ? req.result : undefined);
                tx.onerror = () => reject(tx.error || new Error('IndexedDB error.'));
                tx.onabort = () => reject(tx.error || new Error('IndexedDB aborted.'));
            }),
    );
}

/** @returns {Promise<any|null>} */
export function idbGet(key) {
    return idbRun('readonly', (s) => s.get(key)).then((v) => (v === undefined ? null : v));
}

export function idbSet(key, value) {
    return idbRun('readwrite', (s) => s.put(value, key));
}

export function idbDel(key) {
    return idbRun('readwrite', (s) => s.delete(key));
}
