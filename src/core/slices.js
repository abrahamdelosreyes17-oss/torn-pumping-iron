/*
 * Breaks for the page while a plan is worked out (round 7, R7.3b).
 *
 * What was wrong: Create plan and Re-plan waited on a 0 ms timer between
 * slices, 170 times for 12 months. A browser runs a hidden tab's timers
 * once a second at best, so a player who clicked and went back to Torn
 * waited minutes (280 s in Edge, over 400 s in Chrome) for 3 seconds of
 * work, and saw "stuck".
 *
 * Now a break is a message to ourselves (a MessageChannel: the browser does
 * not slow those down in a hidden tab), and only once enough work has been
 * done since the last break; in between, a break costs nothing. The same
 * break carries the run's progress and lets it be cancelled.
 */

/** Work between two breaks: short enough that a click or a scroll never waits long. */
export const SLICE_MS = 30;

/** Thrown at a break when the run was cancelled: nothing is saved, the old plan stays. */
export class PlanCancelled extends Error {
    constructor() {
        super('Cancelled: your plan is unchanged.');
        this.cancelled = true;
    }
}

/**
 * @param {object} o
 * @param {number} [o.everyMs] - work between breaks
 * @param {function} [o.now] - a clock in ms (performance.now)
 * @param {function} [o.cancelled] - () => true to stop the run at the next break
 * @param {function} [o.post] - how to wait one turn of the page (tests); default: a MessageChannel message, else a 0 ms timer
 * @returns {function & {breaks: function, stop: function}} pause(): a promise, already resolved while the slice has time left
 */
export function makePause({ everyMs = SLICE_MS, now = defaultNow, cancelled = null, post = null } = {}) {
    let last = now();
    let breaks = 0;
    let channel = null;
    const waiting = [];
    const viaChannel = () =>
        new Promise((resolve) => {
            if (!channel) {
                channel = new MessageChannel();
                channel.port1.onmessage = () => {
                    const r = waiting.shift();
                    // Under node (tests) an open port keeps the process alive: only while a break is waiting.
                    if (!waiting.length && typeof channel.port1.unref === 'function') channel.port1.unref();
                    if (r) r();
                };
            }
            if (typeof channel.port1.ref === 'function') channel.port1.ref();
            waiting.push(resolve);
            channel.port2.postMessage(0);
        });
    const turn = post || (typeof MessageChannel === 'function' ? viaChannel : () => new Promise((r) => setTimeout(r, 0)));
    const done = Promise.resolve();
    const pause = () => {
        if (cancelled && cancelled()) return Promise.reject(new PlanCancelled());
        if (now() - last < everyMs) return done;
        breaks++;
        return turn().then(() => {
            last = now();
            if (cancelled && cancelled()) throw new PlanCancelled();
        });
    };
    pause.breaks = () => breaks;
    // The page goes away, or the run is over: let the channel go.
    pause.stop = () => {
        if (channel) {
            channel.port1.onmessage = null;
            channel.port1.close();
            channel = null;
        }
    };
    return pause;
}

function defaultNow() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/**
 * Run a generator of work to its end, with a break after each step when one
 * is due. `onStep(value)` sees what each step yielded (progress).
 */
export async function runSliced(gen, pause, onStep = null) {
    let r = gen.next();
    while (!r.done) {
        if (onStep) onStep(r.value);
        await pause();
        r = gen.next();
    }
    return r.value;
}
