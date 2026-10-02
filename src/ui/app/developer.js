/*
 * Settings › Developer (mockups/round3/X-settings.html, Y-developer.html).
 * Everyone: export the learning data as a .zip (names and ids left out) so
 * a friend can send theirs. The developer key (owner and Claude) unlocks
 * the rest: import a friend's export, what the app learned in plain words
 * and charts, the simulation check, and the raw details. The key is checked
 * against a SHA-256 in this (public) script, so it only hides views; it
 * never unlocks data or actions.
 */

import { h, t } from '../dom.js';
import { keyInputAttrs, keyMask } from '../mask.js';
import { STATS, STAT_LABEL, gainPerTrain } from '../../core/gain.js';
import { fmtInt, fmtPct } from '../../core/format.js';
import { learnGym, learnFights, describeGym, describeFights } from '../../core/learn.js';
import { exportFiles, importFiles } from '../../core/learndata.js';
import { makeZip, readZip } from '../../core/zip.js';
import { scatter, lineChart, bars } from '../charts.js';
import { sectionHead, meta, STAT_COLOR, MONTH_NAMES } from './common.js';

/** SHA-256 of the developer key (the key itself lives only on the owner's laptop). */
export const DEV_KEY_SHA256 = '867b596b74aed64f484c60611ac2b3cc03c7ceb45230a140e4be5a8330d660e2';

export async function sha256Hex(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function checkDevKey(text) {
    return (await sha256Hex(String(text || '').trim())) === DEV_KEY_SHA256;
}

function dateShort(t0) {
    const d = new Date(t0);
    return d.getUTCDate() + ' ' + MONTH_NAMES[d.getUTCMonth()];
}

/** Download bytes as a file from our own page (never on torn.com). */
function download(bytes, name) {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
    const a = h('a', { href: url, download: name, style: 'display:none' });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
    }, 1000);
}

function exportZip(ctx) {
    const d = ctx.dev.data();
    const files = exportFiles({ samples: d.samples, fights: d.fights, gymLog: d.gymLog, learned: d.learned, version: d.version, now: Date.now() });
    download(makeZip(files), 'learning-' + new Date().toISOString().slice(0, 10) + '.zip');
}

/** The Settings card (locked: export for everyone, unlock for the owner). */
export function developerSection(m, ctx) {
    if (!ctx.dev) return null;
    const d = ctx.dev.data();
    const unlocked = ctx.dev.unlocked();
    const keyIn = h('input', { ...keyInputAttrs(), class: 'inp' + (keyInputAttrs().type === 'text' ? ' masked' : ''), placeholder: 'Developer key', 'aria-label': 'Developer key', style: 'width:220px' });
    keyMask(keyIn, 'masked');
    const msg = h('span', { class: 'msg' });
    const unlock = async () => {
        msg.textContent = 'Checking…';
        const ok = await checkDevKey(keyIn.value);
        keyIn.value = '';
        if (ok) {
            ctx.dev.setUnlocked(true);
            ctx.ui.devPage = true;
            ctx.rerender();
        } else {
            msg.className = 'msg bad';
            msg.textContent = 'That isn’t the developer key.';
        }
    };
    keyIn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') unlock();
    });
    return h('div', { class: 'sec' }, [
        h('div', {}, [h('h3', { text: 'Developer' }), h('span', { class: 'state ' + (unlocked ? 'ok' : 'off') }, [h('i'), unlocked ? 'Unlocked' : 'Locked'])]),
        h('div', { class: 'secbody' }, [
            h('div', { class: 'row', style: 'flex-wrap:wrap' }, [
                h('span', {}, [h('b', { class: 'white', text: 'Learning data' }), h('span', { class: 'muted', text: ' · what Pumping Iron learned from your trains (' + fmtInt(d.samples.length) + ' sessions) and fights (' + fmtInt(d.fights.length) + '). Names and ids are left out.' })]),
                h('span', { class: 'grow' }),
                h('button', { class: 'btn sm', type: 'button', onclick: () => exportZip(ctx), text: 'Export as .zip' }),
            ]),
            unlocked
                ? h('div', { class: 'row' }, [h('button', { class: 'btn sm primary', type: 'button', onclick: () => { ctx.ui.devPage = true; ctx.rerender(); }, text: 'Open the Developer page' }), h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { ctx.dev.setUnlocked(false); ctx.rerender(); }, text: 'Lock' })])
                : h('div', { class: 'row', style: 'flex-wrap:wrap' }, [keyIn, h('button', { class: 'btn sm', type: 'button', onclick: unlock, text: 'Unlock' }), h('span', { class: 'muted', style: 'font-size:12px', text: 'For the owner only: what it learned (graphs, plain words), import a friend’s export, and the raw details.' }), msg]),
        ]),
    ]);
}

/* ------------------------------------------------------------- the page */

/** Simulated sessions from the engine's own formula (the learner's self-check; docs/sims/learn-sim.mjs). */
function simSessions({ stat, S, H = 5000, dots = 7.3, E = 10, n = 30, truth = 1, seed = 7 }) {
    let x = seed;
    const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
    const out = [];
    let s = S;
    for (let i = 0; i < n; i++) {
        const trains = 15 + Math.floor(rnd() * 25);
        let st = s;
        let hh = H;
        let pred = s;
        for (let k = 0; k < trains; k++) {
            st += gainPerTrain(stat, st, hh, dots, E, truth);
            pred += gainPerTrain(stat, pred, hh, dots, E, 1);
            hh = Math.max(0, hh - E * (0.4 + rnd() * 0.2));
        }
        out.push({ at: i, stat, trains, S: s, H, dots, E, perks: 1, predicted: pred - s, actual: st - s });
        s = st;
    }
    return out;
}

/** S1 (the model already right: no change) and S2 (a hidden +4% perk: found), run now in this page. */
function selfCheck() {
    const t0 = performance.now();
    const s1 = learnGym(simSessions({ stat: 'spd', S: 4.06e6 }), { now: 1e9 });
    const s2 = learnGym(simSessions({ stat: 'spd', S: 4.06e6, truth: 1.04, seed: 11 }), { now: 1e9 });
    const ms = performance.now() - t0;
    return [
        { name: 'S1 model already right', ok: !s1.accepted, text: s1.accepted ? 'changed (wrong)' : 'no false change' },
        { name: 'S2 hidden +4% perk', ok: s2.accepted && Math.abs(s2.model.mult.spd - 1.04) < 0.01, text: s2.accepted ? 'found ×' + s2.model.mult.spd.toFixed(3) : 'not found' },
        { name: 'Time', ok: ms < 500, text: Math.round(ms) + ' ms' },
    ];
}

/**
 * Money log fields (round 7, C.0): your money log by Torn's log type, with
 * the names of each type's data fields and which one was read as the amount.
 * Names and counts only, never an amount: the money accounts are written
 * from this, not from guesses. It is also in the report zip, for everyone.
 */
export function moneyFieldsBlock(dev) {
    const mf = dev.moneyFields ? dev.moneyFields() : { at: null, list: [] };
    const head = sectionHead('Money log fields', meta([mf.list.length ? mf.list.length + ' log types · read ' + new Date(mf.at).toISOString().slice(0, 16).replace('T', ' ') + ' UTC · names only, never an amount' : 'names only, never an amount']), null, 'h3');
    if (!mf.list.length) return h('div', {}, [head, h('p', { class: 'muted', style: 'margin:0', text: 'Nothing read yet: the money log needs the Full key (Settings), and is read every 6 hours. A log read before this version has no field names: save the Full key again, or wait for the next read.' })]);
    const amountWords = (a) => Object.entries(a || {}).sort((x, y) => y[1] - x[1]).map(([k, n]) => k + ' × ' + n).join(', ');
    const rows = mf.list.map((r) =>
        h('tr', {}, [
            h('td', {}, [h('b', { class: 'w', text: r.title || '(no title)' }), h('br'), h('small', { class: 'muted', text: r.category || '' })]),
            h('td', { class: 'r', text: r.type === null ? '—' : String(r.type) }),
            h('td', { class: 'r', text: fmtInt(r.lines) }),
            h('td', { class: 'r', text: String(r.days) }),
            h('td', { style: 'white-space:normal', text: r.fields.map((f) => f.name + ' (' + f.is + ')').join(', ') || 'no data fields' }),
            h('td', { class: /none read/.test(amountWords(r.amount)) ? 'c-warn' : '', style: 'white-space:normal', text: amountWords(r.amount) }),
        ]),
    );
    return h('div', {}, [
        head,
        h('table', { class: 'tbl num' }, [h('thead', {}, [h('tr', {}, [h('th', { text: 'Log line' }), h('th', { class: 'r', style: 'width:60px', text: 'Type' }), h('th', { class: 'r', style: 'width:56px', text: 'Lines' }), h('th', { class: 'r', style: 'width:52px', text: 'Days' }), h('th', { text: 'Data fields' }), h('th', { style: 'width:180px', text: 'Read as the amount' })])]), h('tbody', {}, rows)]),
        h('div', { class: 'note2', text: 'A line listed under two of Torn’s categories counts once. “(none read)”: no field of that line was taken as its amount today.' }),
    ]);
}

export function renderDeveloper(m, ctx) {
    const dev = ctx.dev;
    const mine = dev.data();
    const friend = ctx.ui.devImport || null;
    const src = ctx.ui.devSource === 'friend' && friend ? 'friend' : 'mine';
    const now = Date.now();
    // Mine: what the app kept. A friend's export: the learners run on it here (never merged into your model).
    // The learners run once per data set shown (not on every redraw).
    const runOnce = (holder, samples, fights) => holder.learned || (holder.learned = { at: now, gym: learnGym(samples, { now }), fights: learnFights(fights, { now }) });
    const set = src === 'friend' ? { samples: friend.samples, fights: friend.fights, learned: runOnce(friend, friend.samples, friend.fights) } : { samples: mine.samples, fights: mine.fights, learned: mine.learned || runOnce(ctx.ui.devMine || (ctx.ui.devMine = {}), mine.samples, mine.fights) };
    const gym = set.learned.gym;
    const fights = set.learned.fights;

    const fileIn = h('input', { type: 'file', accept: '.zip,application/zip', style: 'display:none' });
    const importMsg = h('span', { class: 'msg' });
    fileIn.addEventListener('change', async () => {
        const f = fileIn.files && fileIn.files[0];
        if (!f) return;
        try {
            const bytes = new Uint8Array(await f.arrayBuffer());
            const data = importFiles(readZip(bytes).files);
            ctx.ui.devImport = { ...data, name: f.name };
            ctx.ui.devSource = 'friend';
            ctx.rerender();
        } catch (e) {
            importMsg.className = 'msg bad';
            importMsg.textContent = String((e && e.message) || e);
        }
    });
    const seg = h('div', { class: 'seg', role: 'group', 'aria-label': 'Data' }, [
        h('button', { type: 'button', 'aria-pressed': String(src === 'mine'), onclick: () => { ctx.ui.devSource = 'mine'; ctx.rerender(); }, text: 'Mine · ' + mine.samples.length + ' sessions · ' + mine.fights.length + ' fights' }),
        friend ? h('button', { type: 'button', 'aria-pressed': String(src === 'friend'), onclick: () => { ctx.ui.devSource = 'friend'; ctx.rerender(); }, text: 'Friend’s export · ' + friend.samples.length + ' sessions' }) : null,
    ]);
    const ctl = [
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { ctx.ui.devPage = false; ctx.rerender(); }, text: '‹ Settings' }),
        h('b', { class: 'white', text: 'Developer' }),
        h('span', { class: 'tag good', text: 'Unlocked' }),
        h('span', { class: 'sep' }),
        t('lab', 'Data'),
        seg,
        h('button', { class: 'btn sm', type: 'button', onclick: () => fileIn.click(), text: 'Import a .zip' }),
        fileIn,
        importMsg,
        h('button', { class: 'btn sm', type: 'button', onclick: () => exportZip(ctx), text: 'Export as .zip' }),
        h('span', { class: 'grow' }),
        h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { dev.setUnlocked(false); ctx.ui.devPage = false; ctx.rerender(); }, text: 'Lock' }),
    ];

    // What it learned, in plain words.
    const lines = [...describeGym(gym), ...describeFights(fights).filter((l) => !(set.fights.every((x) => !Number.isFinite(x.hpKept)) && /\bHP\b/.test(l)))];
    const learned = h('div', { class: 'lead' }, [
        sectionHead('What it learned', meta(['in plain words · each change was kept only because it predicted newer ' + (src === 'friend' ? 'sessions' : 'trains') + ' better'])),
        h('ul', { class: 'heads num' }, lines.map((l) => h('li', { class: /now counts|corrected|found|Kept/i.test(l) ? 'g' : null }, [h('i'), h('div', { text: l })]))),
        gym && gym.reasons && gym.reasons.length ? h('div', { class: 'note2', text: 'Gym: ' + gym.reasons.join(' ') }) : null,
    ]);

    // Each session: what it said (before) and with the learned model, against what you got.
    const mult = gym && gym.accepted ? gym.model.mult : null;
    const pts = [];
    for (const s of set.samples.slice(-200)) {
        if (!(s.predicted > 0) || !(s.actual > 0)) continue;
        pts.push({ x: s.predicted, y: s.actual, c: 'var(--muted)' });
        if (mult) pts.push({ x: s.predicted * (mult[s.stat] || 1), y: s.actual, c: STAT_COLOR[s.stat] || 'var(--chalk)' });
    }
    const scat = h('div', {}, [
        sectionHead('Each session', meta(['what it said vs what you got' + (mult ? ' · grey before, coloured now' : '')]), null, 'h3'),
        pts.length ? scatter(pts, { w: 520, h: 240, xl: 'it said', yl: 'you got', label: 'Predicted against actual gain per session' }) : h('p', { class: 'muted', style: 'margin:0', text: 'No sessions yet: one stat trained between two reads, with no drug, booster or refill in between, makes one.' }),
    ]);

    // Error on newer sessions, over time (from the learning runs).
    const log = dev.log();
    const errRows = log.filter((r) => r.gym && r.gym.heldOut && r.gym.heldOut.current !== null);
    const errChart = h('div', {}, [
        sectionHead('Error on newer sessions', meta(['over time · before vs the learned model']), null, 'h3'),
        errRows.length >= 2
            ? lineChart([{ name: 'before', color: 'var(--muted)', dash: '5 4', values: errRows.map((r) => r.gym.heldOut.current), label: 'before' }, { name: 'now', color: 'var(--chalk)', width: 2.5, values: errRows.map((r) => r.gym.heldOut.learned), label: 'learned' }], { w: 520, h: 160, left: 36, right: 70, xLabels: [[0, dateShort(errRows[0].at)], [errRows.length - 1, dateShort(errRows[errRows.length - 1].at)]], grid: [0, Math.max(...errRows.map((r) => Math.max(r.gym.heldOut.current, r.gym.heldOut.learned || 0)))], label: 'Held-out error over time' })
            : h('p', { class: 'muted', style: 'margin:0', text: 'Shows after two learning runs with enough newer sessions to test on (' + errRows.length + ' so far).' }),
    ]);

    // Torn Eye: when it said you'd win, how often you did.
    const bins = (fights && fights.bins) || [];
    const eye = h('div', {}, [
        sectionHead('Torn Eye', meta(['when it said you’d win, how often you did · bar = what happened, line = what it said']), null, 'h3'),
        bins.some((b) => b.fights)
            ? bars(bins.filter((b) => b.fights).map((b) => ({ v: 100 * b.won, ref: 100 * b.predicted, c: 'var(--good)', label: Math.round(b.from * 100) + '–' + Math.round(b.to * 100) + '%', top: b.fights + ' fights' })), { w: 520, h: 160, max: 100, label: 'Win rate by predicted win chance' })
            : h('p', { class: 'muted', style: 'margin:0', text: 'Needs fights with a prediction before them: Torn Eye saves what it said when you open an attack page. ' + set.fights.length + ' so far. Spotting a 10% error takes about 2,000 fights, so this changes slowly by design.' }),
    ]);

    // Pane: learned values, the self-check, the export, raw.
    const firstAccepted = (pred) => log.find(pred);
    const valRows = [];
    for (const k of STATS) {
        const v = gym && gym.model ? gym.model.mult[k] : 1;
        const when = firstAccepted((r) => r.gym && r.gym.accepted && Math.abs((r.gym.mult || {})[k] - 1) > 1e-6);
        valRows.push(h('tr', {}, [h('td', { text: STAT_LABEL[k] + ' gain ×' }), h('td', { class: 'r', text: (gym && gym.accepted ? v : 1).toFixed(3) }), h('td', { class: 'muted', text: gym && gym.accepted && Math.abs(v - 1) > 1e-6 ? (when ? dateShort(when.at) : 'now') : 'kept' })]));
    }
    valRows.push(h('tr', {}, [h('td', { text: 'Above-50M formula' }), h('td', { class: 'r', text: gym && gym.model ? gym.model.mode : 'log10' }), h('td', { class: 'muted', text: gym && gym.accepted && gym.model.mode !== (gym.current && gym.current.mode) ? 'changed' : 'kept' })]));
    valRows.push(h('tr', {}, [h('td', { text: 'Win odds ×' }), h('td', { class: 'r', text: fights && fights.accepted ? fights.model.winScale.toFixed(2) : '1.00' }), h('td', { class: 'muted', text: fights && fights.winAccepted ? 'changed' : 'kept' })]));
    // HP kept is learned only once fights carry what was really kept (not read yet): no row until then.
    if (set.fights.some((x) => Number.isFinite(x.hpKept))) valRows.push(h('tr', {}, [h('td', { text: 'HP kept ×' }), h('td', { class: 'r', text: fights && fights.accepted ? fights.model.hpScale.toFixed(2) : '1.00' }), h('td', { class: 'muted', text: fights && fights.hpAccepted ? 'changed' : 'kept' })]));
    const noHp = !set.fights.some((x) => Number.isFinite(x.hpKept));

    const checks = ctx.ui.devChecks || null;
    const sizes = dev.sizes();
    const pane = [
        h('div', {}, [sectionHead('Learned values', meta(['and when they changed']), null, 'h3'), h('table', { class: 'tbl num' }, [h('tbody', {}, valRows)])]),
        h('div', {}, [
            sectionHead('Simulation check', meta([checks ? 'run just now' : 'runs here in a moment']), null, 'h3'),
            checks
                ? h('dl', { class: 'facts num' }, checks.flatMap((c) => [h('dt', { text: c.name }), h('dd', { class: c.ok ? 'c-good' : 'c-bad', text: c.text })]))
                : h('button', { class: 'btn sm', type: 'button', onclick: () => { ctx.ui.devChecks = selfCheck(); ctx.rerender(); }, text: 'Run S1 + S2' }),
            h('div', { class: 'note2', text: 'The full suite (S1–S4, fights F1–F3) runs with node --test test/learn.test.js.' }),
        ]),
        h('div', {}, [
            sectionHead('Export', meta(['what the .zip holds']), null, 'h3'),
            h('dl', { class: 'facts num' }, [h('dt', { text: 'gym-samples.json' }), h('dd', { text: mine.samples.length + ' sessions' }), h('dt', { text: 'fights.json' }), h('dd', { text: mine.fights.length + ' fights' }), h('dt', { text: 'model.json' }), h('dd', { text: 'learned values' }), h('dt', { text: 'meta.json' }), h('dd', { text: 'version, date' })]),
            h('div', { class: 'note2', text: 'Names and player ids are left out; stats rounded. Nothing is uploaded: the file downloads to this computer.' }),
        ]),
        h('div', {}, [
            h('details', { class: 'dis' }, [
                h('summary', { text: 'Raw for Claude · accept log, scores, storage' }),
                h('pre', { style: 'white-space:pre-wrap;font-size:11px;color:var(--muted);margin:8px 0 0' }, [
                    log.slice(-12).map((r) => new Date(r.at).toISOString().slice(0, 16) + ' gym ' + (r.gym.candidates || []).map((c) => c.mode + ' ' + (c.error === null ? '—' : c.error.toFixed(2) + '%')).join(' / ') + ' · held-out ' + (r.gym.heldOut.current === null ? '—' : r.gym.heldOut.current.toFixed(2) + '% → ' + r.gym.heldOut.learned.toFixed(2) + '%') + ' · ' + (r.gym.accepted ? 'ACCEPT' : 'keep') + ' · eye ' + (r.fights.accepted ? 'ACCEPT' : 'keep') + ' (' + r.fights.fights + ')').join('\n') || 'no learning runs yet',
                    '\n\nstorage: ' + Object.entries(sizes).map(([k, v]) => k + ' ' + fmtInt(v) + ' B').join(' · '),
                ]),
            ]),
        ]),
    ];
    return { ctl: [ctl], main: [learned, scat, errChart, eye, moneyFieldsBlock(dev)], pane };
}

void fmtPct;
