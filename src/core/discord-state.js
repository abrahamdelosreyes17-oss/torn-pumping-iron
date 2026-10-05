/*
 * What Settings › Discord pings says about the service, in words, and what the problem report carries about it.
 * Pure: it reads the stored record (K.worker) as the sync answer and the last test ping left it.
 *
 * A friend "did not receive an alert from the discord bot": Discord refused the bot's DM (his DMs were off), the
 * tag said Working, the test ping said "Your Worker answered 502." and his report held `discord: true`. So: the
 * tag never says Working when the bot is known not to reach you, every state says what to do, and the report
 * says which state it is. An older service tells less (no `delivery`, no `tornRead`): then only what the test
 * ping showed is said.
 */

/** Turning the bot's DMs on, in Discord. */
export const DM_STEPS = ['In Discord, open the server the bot is in.', 'Click the server name, then Privacy Settings.', 'Turn Direct Messages on.'];

const DS_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "10:48 UTC", with the day when it is not today. */
export function discordWhen(ms, now = Date.now()) {
    if (!(ms > 0)) return 'never';
    const d = new Date(ms);
    const clock = d.toISOString().slice(11, 16) + ' UTC';
    return d.toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10) ? clock : d.getUTCDate() + ' ' + DS_MONTHS[d.getUTCMonth()] + ' ' + clock;
}

/** Is this record a connected service (logged in with Discord, or your own service set up)? */
const dsConnected = (w) => Boolean(w && w.base && w.secret && (w.discordName || w.connectedAt));

/** Torn refused the service's key: pings are paused until a new key is sent. (A record of 1.5.3 or older has only the text.) */
const dsPaused = (w) => w.paused === true || (w.paused === undefined && /paused pings/.test(String(w.lastError || '')));

/** The last sync did not get through (a record of 1.5.3 or older: any other error text). */
function dsSyncFail(w) {
    if (w.syncFail && w.syncFail.text) return w.syncFail;
    return w.paused === undefined && w.lastError && !dsPaused(w) ? { at: null, text: String(w.lastError) } : null;
}

/**
 * The state of a connected service.
 * @param {object} w - the stored record
 * @returns {{key: string, tone: 'ok'|'bad'|'off', tag: string, title: string|null, text: string|null, steps: string[], notes: string[]}|null}
 *   key: paused | waiting | dm_refused | test_failed | no_route | torn | sync | ok. Null when nothing is connected.
 */
export function discordView(w, now = Date.now()) {
    if (!dsConnected(w)) return null;
    const own = !w.discordName;
    const out = (key, tone, tag, title = null, text = null, steps = [], notes = []) => ({ key, tone, tag, title, text, steps, notes });
    if (dsPaused(w)) return out('paused', 'bad', 'Paused', 'Pings are paused', String(w.pauseText || w.lastError || 'Torn refused the key on the service.') + (own ? '' : ' Save a working Torn key above; it goes to the service by itself.'));
    const d = w.delivery || null;
    const tf = w.testFail || null;
    const again = 'Then press Send a test ping here.';
    // The service says so (or, an older one: the last test ping did).
    if (d ? d.reason === 'dm_refused' : tf && tf.reason === 'dm_refused') {
        const at = d && d.dmRefusedAt ? ' Last refused ' + discordWhen(d.dmRefusedAt * 1000, now) + '.' : '';
        return out('dm_refused', 'bad', 'Not reaching you', 'Discord refuses the bot’s DMs', 'No ping can reach you until Direct Messages from the server are on.' + at, [...DM_STEPS, again]);
    }
    if (d ? d.reason === 'no_route' : tf && tf.reason === 'no_route') {
        return out('no_route', 'bad', 'Not reaching you', 'Nothing to deliver through', own ? 'Your service has no channel webhook and no linked Discord account. Press Edit and save a webhook, or get a link code for the bot.' : 'The service has no Discord account linked for this browser. Press Disconnect, then Log in with Discord again.');
    }
    // An older service answers a failed test with a bare 502: it does not say why. A refused DM is the usual cause,
    // and that service then tries no DM for 6 hours, the test ping included; a new login starts afresh.
    if (!d && tf && tf.reason === 'unknown') {
        const steps = own ? [...DM_STEPS, 'Check the channel webhook saved on your service, if you use one.', 'Then press Send a test ping here (after a refused DM the bot waits 6 hours; Forget and Connect again ends the wait).'] : [...DM_STEPS, 'Then press Disconnect here and Log in with Discord again (after a refused DM the bot waits 6 hours; a new login ends the wait).', 'Then press Send a test ping.'];
        return out('test_failed', 'bad', 'Not reaching you', 'The test ping did not arrive', 'Most likely Discord refuses the bot’s DMs: Direct Messages from the server are off.', steps);
    }
    const sf = dsSyncFail(w);
    if (!w.ready) {
        // Never synced: nothing known yet. A failed first sync says why.
        return out('waiting', 'bad', own ? 'Needs the webhook and key' : 'Not pinging yet', null, sf ? 'The first sync did not get through (' + sf.text.replace(/\.$/, '') + '). It tries again within a minute.' : own ? 'Your service needs a Torn key and a webhook (or a linked Discord account) before it pings.' : 'Waiting for the first sync (open Home once).');
    }
    const tr = w.tornRead || null;
    if (tr && tr.ok === false) {
        const fix = Number(tr.code) === 16 ? (own ? ' Paste a Limited Torn key for your service.' : ' Save a Limited Torn key above; it goes to the service by itself.') : ' Nothing to do here: pings start again by themselves when Torn answers.';
        return out('torn', 'bad', 'Not reading Torn', 'The service can’t read your Torn timers', String(tr.error || 'Torn answers it with an error.') + (tr.since ? ' Since ' + discordWhen(tr.since * 1000, now) + '.' : '') + fix);
    }
    if (sf) return out('sync', 'bad', 'Last sync failed', 'The last sync did not get through', sf.text.replace(/\.$/, '') + '. It tries again within a minute; pings still come from the plan sent before.');
    const notes = [];
    const steps = [];
    if (d && d.via === 'channel' && d.dmRefusedAt) {
        notes.push('Discord refuses the bot’s DMs, so pings go to your channel (no buttons there). For DMs:');
        steps.push(...DM_STEPS, again);
    }
    if (tr && tr.ok && tr.travel === false) notes.push('The key on the service can’t read travel, so the Landed ping does not come.');
    return out('ok', 'ok', 'Working', null, null, steps, notes);
}

/** What a test ping that went out says. */
export function testSentWords(r, own = false) {
    if (r && r.via === 'hook') return r.dmRefused ? 'Sent to your channel. Discord refused the bot’s DM.' : 'Sent. Check your channel.';
    return own ? 'Sent. Check Discord.' : 'Sent. Check your Discord DMs.';
}

/**
 * Why a test ping failed, from the service's answer.
 * @param {{http: number|null, reason: string|null, message: string}} e
 * @returns {{reason: string, text: string}} reason: dm_refused | no_route | discord_error | unknown (a bare 502) | forgotten | error
 */
export function testFailOf(e) {
    const http = Number(e && e.http) || null;
    const message = String((e && e.message) || e || 'failed');
    const known = e && ['dm_refused', 'no_route', 'discord_error'].includes(e.reason) ? e.reason : null;
    if (known === 'dm_refused') return { reason: known, text: 'Discord refused the bot’s DM. What to do is above.' };
    if (known) return { reason: known, text: message };
    // An older service: no reason, and no words of its own ("Your Worker answered 502.").
    if (http === 502 && /answered 502/.test(message)) return { reason: 'unknown', text: 'The test ping did not arrive. What to try is above.' };
    if (http === 403) return { reason: 'forgotten', text: message };
    return { reason: 'error', text: message };
}

const dsIso = (ms) => (ms > 0 ? new Date(ms).toISOString() : null);

/**
 * The Discord state for the problem report (state.json). Never the secret, the login id, the Discord id, the
 * Discord name or the service's address.
 * @param {object|null} raw - the stored record, connected or not
 * @param {object} [o] - {now, defaultBase, ticks: pingTicks()}
 */
export function discordReport(raw, { now = Date.now(), defaultBase = null, ticks = null } = {}) {
    const w = raw && raw.base && raw.secret ? raw : null;
    const hide = [w && w.secret, w && w.login && w.login.id, w && w.discordId, w && w.discordName, w && w.base].filter((x) => x && String(x).length >= 3).map(String);
    const clean = (text) => {
        if (text === null || text === undefined) return null;
        let s = String(text);
        for (const x of hide) s = s.split(x).join('[hidden]');
        return s.slice(0, 300);
    };
    const tickList = ticks ? Object.fromEntries(Object.entries(ticks).map(([k, t]) => [k, { on: t.on, byHand: t.hand, ...(t.mode ? { movedBy: t.mode } : {}) }])) : null;
    if (!w) return { connected: false, ticks: tickList };
    const view = discordView(w, now);
    const d = w.delivery || null;
    const tr = w.tornRead || null;
    const sf = view ? dsSyncFail(w) : null;
    return {
        connected: Boolean(view),
        state: view ? view.key : w.login ? 'logging in' : 'not connected',
        tag: view ? view.tag : null,
        via: w.discordName ? 'Discord login' : w.connectedAt ? 'own service set up by hand' : null,
        service: defaultBase && w.base === defaultBase ? 'the Pumping Iron service' : 'another service (own)',
        login: w.login ? { since: dsIso(w.login.at) } : null,
        connectedAt: dsIso(w.connectedAt),
        lastSync: dsIso(w.lastSync),
        lastAnswer: dsIso(w.answerAt),
        lastError: clean(w.lastError),
        syncFail: sf ? { since: dsIso(sf.at), text: clean(sf.text) } : null,
        paused: view ? dsPaused(w) : null,
        ready: Boolean(w.ready),
        linked: Boolean(w.linked),
        bot: Boolean(w.bot),
        keySent: w.discordName ? Boolean(w.keyTag) : null,
        // What the service said in its last answer; null when it is an older one that does not say.
        serviceTells: Boolean(d || tr || w.kinds),
        delivery: d ? { ok: Boolean(d.ok), via: d.via || null, reason: d.reason || null, dmRefused: Boolean(d.dmRefusedAt), dmRefusedAt: dsIso((Number(d.dmRefusedAt) || 0) * 1000), webhook: Boolean(d.webhook) } : null,
        tornRead: tr ? { ok: tr.ok === undefined ? null : tr.ok, lastGood: dsIso((Number(tr.at) || 0) * 1000), travel: tr.travel !== false, failingSince: dsIso((Number(tr.since) || 0) * 1000), code: tr.code === undefined ? null : tr.code, error: clean(tr.error) } : null,
        lastTest: w.testFail ? { ok: false, at: dsIso(w.testFail.at), reason: w.testFail.reason, http: w.testFail.http || null, text: clean(w.testFail.text) } : w.testOkAt ? { ok: true, at: dsIso(w.testOkAt), via: w.testVia || null } : null,
        knowsNerve: w.kinds ? Object.prototype.hasOwnProperty.call(w.kinds, 'nerve') : null,
        ticks: tickList,
    };
}

/** One line for the report's IN SHORT block. */
export function discordShort(rep) {
    if (!rep || !rep.connected) return rep && rep.state === 'logging in' ? 'a login is under way (not connected yet)' : 'not connected';
    const off = rep.ticks ? Object.entries(rep.ticks).filter(([, t]) => !t.on).map(([k]) => k) : [];
    const parts = [rep.tag + ' (' + rep.state + ')', rep.via === 'Discord login' ? 'logged in with Discord' : 'own service', 'last sync ' + (rep.lastSync ? rep.lastSync.slice(0, 16).replace('T', ' ') + ' UTC' : 'never')];
    if (rep.delivery) parts.push(rep.delivery.dmRefused ? 'DMs refused since ' + String(rep.delivery.dmRefusedAt).slice(0, 16).replace('T', ' ') + ' UTC' + (rep.delivery.webhook ? ', a webhook is saved' : ', no webhook') : 'pings go by ' + (rep.delivery.via || 'nothing'));
    else parts.push('an older service: it does not say where pings go');
    if (rep.tornRead && rep.tornRead.ok === false) parts.push('the service’s Torn read is failing (' + (rep.tornRead.code === null ? '?' : rep.tornRead.code) + ')');
    if (rep.lastTest && !rep.lastTest.ok) parts.push('last test ping failed (' + rep.lastTest.reason + ')');
    if (off.length) parts.push('ticked off: ' + off.join(', '));
    return parts.join(' · ');
}
