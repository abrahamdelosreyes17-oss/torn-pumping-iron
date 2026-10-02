/*
 * Settings › Report a problem (round 7; Torn Trading's "Report a problem"
 * in Pumping Iron's own Settings look): say what happened and what you
 * expected, add screenshots, see what goes in the zip before anything is
 * made, then download one file to send. Nothing is sent by this page.
 */

import { h } from '../dom.js';
import { makeZip } from '../../core/zip.js';
import { logAsText } from '../../core/errlog.js';
import { reportFiles, reportIncludes } from '../../core/report.js';
import { exportFiles } from '../../core/learndata.js';

/**
 * What you typed and attached lives here, not in the page's `ui` (that one is
 * compared on every redraw; screenshots are megabytes).
 */
const reportFormState = { happened: '', expected: '', shots: [], showLog: false, status: '', lastZip: null };

const reportStamp = (ms) => new Date(ms).toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', '-');

function saveReportZip(zip) {
    const url = URL.createObjectURL(new Blob([zip.data], { type: 'application/zip' }));
    const a = h('a', { href: url, download: zip.name, style: 'display:none' });
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
    }, 10000);
}

/** The zip's files from what the page holds now (also used by the browser check). */
export function buildReport(ctx, now = Date.now()) {
    const r = ctx.report.data();
    const learning = exportFiles({ samples: r.learn.samples, fights: r.learn.fights, gymLog: r.learn.gymLog, learned: r.learn.learned, version: r.state.version, now });
    return reportFiles({ happened: reportFormState.happened, expected: reportFormState.expected, shots: reportFormState.shots, log: r.log, state: r.state, player: r.player, saved: r.saved, learning, moneyFields: r.moneyFields, statsHistory: r.statsHistory, env: r.env, now });
}

function downloadReport(ctx) {
    const now = Date.now();
    reportFormState.lastZip = { data: makeZip(buildReport(ctx, now), now), name: 'pumping-iron-report-' + reportStamp(now) + '.zip' };
    saveReportZip(reportFormState.lastZip);
    // One file, then a clean form: the words, the screenshots and the log go, so the next report starts empty.
    for (const s of reportFormState.shots) URL.revokeObjectURL(s.url);
    reportFormState.happened = '';
    reportFormState.expected = '';
    reportFormState.shots = [];
    ctx.report.clearLog();
    reportFormState.status = 'Saved ' + reportFormState.lastZip.name + ' to your downloads. Send that file: nothing was sent by this page. The form and the log are cleared for your next report.';
    ctx.rerender();
}

/** The Settings card. */
export function reportSection(m, ctx) {
    if (!ctx.report) return null;
    const r = ctx.report.data();
    const errors = r.log.filter((e) => e.kind === 'error').length;
    const happened = h('textarea', { class: 'inp ta', rows: '4', 'aria-label': 'What happened', placeholder: 'For example: I pressed Re-plan for 12 months, the bar stopped at "month 5" and nothing changed.' });
    happened.value = reportFormState.happened;
    happened.addEventListener('input', () => (reportFormState.happened = happened.value));
    const expected = h('textarea', { class: 'inp ta', rows: '2', 'aria-label': 'What you expected', placeholder: 'For example: the new plan in a few seconds.' });
    expected.value = reportFormState.expected;
    expected.addEventListener('input', () => (reportFormState.expected = expected.value));
    const file = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none' });
    file.addEventListener('change', () => {
        const files = [...(file.files || [])];
        file.value = '';
        Promise.all(files.map((f) => f.arrayBuffer().then((b) => ({ name: f.name, data: new Uint8Array(b), url: URL.createObjectURL(f) })))).then((got) => {
            reportFormState.shots.push(...got);
            ctx.rerender();
        });
    });
    const shots = reportFormState.shots.map((s, i) =>
        h('span', { class: 'shot' }, [
            h('img', { src: s.url, alt: s.name }),
            h('button', { type: 'button', class: 'x', 'aria-label': 'Remove ' + s.name, onclick: () => { URL.revokeObjectURL(s.url); reportFormState.shots.splice(i, 1); ctx.rerender(); }, text: '×' }),
        ]),
    );
    const includes = reportIncludes({ shots: reportFormState.shots.length, log: r.log, player: r.player, saved: r.saved, gymLog: r.learn.gymLog.length, moneyTypes: (r.moneyFields || []).length });
    const state = h('span', { class: 'state ' + (errors ? 'bad' : 'off') }, [h('i'), errors ? errors + (errors === 1 ? ' error logged' : ' errors logged') : 'Nothing logged as an error']);
    return h('div', { class: 'sec' }, [
        h('div', {}, [h('h3', { text: 'Report a problem' }), state]),
        h('div', { class: 'secbody' }, [
            h('p', { text: 'Found a bug, or something slow? Say what happened, add screenshots, and download one .zip to send. It also holds the problem log (what failed, what you clicked just before, how long each plan took) and your stats, gym log and saved plan, so the cause is found without guessing. Nothing is sent anywhere by this page.' }),
            h('label', { class: 'field' }, [h('span', { class: 'lab', text: 'What happened?' }), happened]),
            h('label', { class: 'field' }, [h('span', { class: 'lab', text: 'What did you expect?' }), expected]),
            h('div', { class: 'row', style: 'flex-wrap:wrap' }, [h('button', { class: 'btn sm', type: 'button', onclick: () => file.click(), text: 'Add screenshots' }), h('span', { class: 'muted', style: 'font-size:12px', text: 'Win + Shift + S takes one; save it, then add it here.' }), file]),
            shots.length ? h('div', { class: 'shots' }, shots) : null,
            h('div', {}, [h('span', { class: 'lab', text: 'What goes in the zip' }), h('ul', { class: 'incl' }, includes.map((x) => h('li', { text: x })))]),
            h('div', { class: 'row', style: 'flex-wrap:wrap' }, [
                h('button', { class: 'btn primary', type: 'button', onclick: () => downloadReport(ctx), text: 'Download report (.zip)' }),
                reportFormState.lastZip ? h('button', { class: 'btn sm ghost', type: 'button', onclick: () => saveReportZip(reportFormState.lastZip), text: 'Download it again' }) : null,
                h('button', { class: 'btn sm ghost', type: 'button', 'aria-expanded': String(reportFormState.showLog), onclick: () => { reportFormState.showLog = !reportFormState.showLog; ctx.rerender(); }, text: reportFormState.showLog ? 'Hide the log' : 'Show the log' }),
                h('button', { class: 'btn sm ghost', type: 'button', title: 'Start the log again (after sending a report)', onclick: () => { ctx.report.clearLog(); reportFormState.status = 'Log cleared.'; ctx.rerender(); }, text: 'Clear the log' }),
            ]),
            reportFormState.status ? h('span', { class: 'msg ok', role: 'status', text: reportFormState.status }) : null,
            reportFormState.showLog ? h('pre', { class: 'logbox num', text: logAsText(r.log.slice(-40)).trim() || 'Nothing logged yet.' }) : null,
            h('details', { class: 'dis' }, [h('summary', { text: 'What is and isn’t in the file' }), h('p', { text: 'In it: what you wrote, your screenshots, the problem log, your stats (the four numbers), happy and energy maximum, gym and gyms unlocked, build, the perk lines Torn lists for you, your saved plan in short, the last plan runs with their time, your stats history, your trains from Torn’s log, and your money log by type with the names of its fields. Not in it: any API key, your player id or name, other players’ ids or names, any money log amount.' })]),
        ]),
    ]);
}

/** For tests: the form's state. */
export const reportForm = reportFormState;
