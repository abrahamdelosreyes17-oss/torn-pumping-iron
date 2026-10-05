/*
 * Settings › Back up and restore (round 9, the owner's pick 5B, mockups/round9/companion.html §5): one file to carry
 * to another browser or keep before a reinstall. The API keys go in only with the tick, and the file's name then says
 * so. A restore shows what the file holds and asks before it replaces anything. Nothing is sent by this page.
 */

import { h } from '../dom.js';
import { readBackup, backupDay } from '../../core/backup.js';

/** The card's own state (a chosen file is not part of the page's `ui`: it is compared on every redraw). */
const backupCardState = { withKeys: false, picked: null, status: '', error: '', busy: false };

function saveBackupFile(name, text) {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = h('a', { href: url, download: name, style: 'display:none' });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
    }, 10000);
}

const backupClock = (ms) => backupDay(ms) + ', ' + new Date(ms).toISOString().slice(11, 16) + ' TCT';

/** The Settings card. */
export function backupSection(m, ctx) {
    const b = ctx.backup;
    if (!b) return null;
    const st = backupCardState;
    const say = (o) => {
        Object.assign(st, { status: '', error: '' }, o);
        ctx.rerender();
    };
    const download = async () => {
        if (st.busy) return;
        st.busy = true;
        try {
            const f = await b.make(st.withKeys);
            saveBackupFile(f.name, f.text);
            say({ busy: false, withKeys: false, status: 'Saved ' + f.name + ' to your downloads.' + (f.hasKeys ? ' Your API keys are in it: keep it to yourself.' : '') });
        } catch (error) {
            say({ busy: false, error: 'The backup could not be made: ' + String((error && error.message) || error) });
        }
    };
    const file = h('input', { type: 'file', accept: '.json,application/json', style: 'display:none', 'aria-label': 'Backup file' });
    file.addEventListener('change', () => {
        const f = (file.files || [])[0];
        file.value = '';
        if (!f) return;
        f.text()
            .then((text) => {
                const r = readBackup(text);
                say(r.ok ? { picked: { ...r, name: f.name } } : { picked: null, error: r.error });
            })
            .catch(() => say({ picked: null, error: 'That file could not be read.' }));
    });
    const restore = async () => {
        if (st.busy || !st.picked) return;
        st.busy = true;
        const day = st.picked.day;
        try {
            await b.restore(st.picked.backup);
            say({ busy: false, picked: null, status: 'Restored the backup of ' + day + '. Reloading…' });
            b.reload();
        } catch (error) {
            say({ busy: false, error: 'The restore stopped: ' + String((error && error.message) || error) });
        }
    };
    const last = b.lastAt();
    const picked = st.picked;
    return h('div', { class: 'sec', 'data-card': 'backup' }, [
        h('div', {}, [h('h3', { text: 'Back up and restore' }), null]),
        h('div', { class: 'secbody' }, [
            h('p', { text: 'One file with what Pumping Iron has saved in this browser. Load it in another browser, or after a reinstall.' }),
            h('div', { class: 'row', style: 'flex-wrap:wrap' }, [
                h('button', { class: 'btn primary', type: 'button', disabled: st.busy, onclick: download, text: 'Download backup' }),
                h('button', { class: 'btn', type: 'button', disabled: st.busy, onclick: () => file.click(), text: 'Restore from a file…' }),
                file,
            ]),
            h('label', { class: 'check' }, [
                h('input', { type: 'checkbox', checked: st.withKeys, onchange: (e) => say({ withKeys: e.target.checked, status: st.status }) }),
                h('span', {}, ['Put my API keys in the file ', h('span', { style: 'color:var(--warn)', text: '· anyone with the file can use them' })]),
            ]),
            picked
                ? h('div', { class: 'warnb', role: 'alert' }, [
                      h('b', { text: 'Replace what this browser has with the backup of ' + picked.day + '?' }),
                      h('p', { text: picked.name + (picked.version ? ' · made by ' + picked.version : '') + ' · holds ' + (picked.parts.length ? picked.parts.join(', ') : 'nothing') + '.' + (picked.hasKeys ? '' : ' Your keys here stay as they are.') + ' The Discord login is never changed.' }),
                      h('div', { class: 'acts' }, [
                          h('button', { class: 'btn primary sm', type: 'button', disabled: st.busy || !picked.parts.length, onclick: restore, text: 'Replace with this backup' }),
                          h('button', { class: 'btn sm', type: 'button', disabled: st.busy, onclick: () => say({ picked: null }), text: 'Cancel' }),
                      ]),
                  ])
                : null,
            st.error ? h('p', { class: 'bad', role: 'alert', style: 'color:var(--bad)', text: st.error }) : null,
            st.status ? h('p', { class: 'muted', role: 'status', text: st.status }) : null,
            h('dl', { class: 'facts' }, [
                h('dt', { text: 'In the file' }),
                h('dd', { text: 'Settings · your build and plan · progress history · the Torn Eye list · what the gym learned · your ticks on the Ledger' }),
                h('dt', { text: 'Never' }),
                h('dd', { text: 'The Discord login · the money log (read again from Torn) · the gear Torn Eye saw (Torn’s pages keep it)' }),
                h('dt', { text: 'Last backup' }),
                h('dd', { class: 'num', text: last ? backupClock(last) : 'never' }),
            ]),
        ]),
    ]);
}
