/*
 * What the gym page marks say, worked out purely (DESIGN §5): which stat to
 * train in the gym you're in and how many trains, a stop before a train
 * would lose a specialist gym, a grey word for the other stats, and whether
 * a better unlocked gym exists. The UI only draws this.
 */

import { STATS, STAT_LABEL, totalOf } from './gain.js';
import { splitSession } from './builds.js';
import { gymById, bestGymFor } from './gyms.js';
import { fmtInt, fmtSigned } from './format.js';

/**
 * @param {object} m - buildModel() output
 * @param {object} page - {selectedId, boxes: [{stat, locked, energyPerTrain}]}
 * @returns {{strip: string[], switchHint: string|null, perStat: object, pill: string|null}}
 */
export function planGymPage(m, page = {}) {
    const table = m.pc.table;
    const selectedId = Number(page.selectedId || m.state.gymId);
    const gym = gymById(selectedId, table);
    const stats = m.pc.stats;
    const energy = m.strip.energy.current;
    const happy = m.strip.happy.current;
    const perStat = {};
    const out = { strip: [], switchHint: null, perStat, pill: null, gym };
    if (!gym) return out;

    const here = splitSession({ stats, shares: m.shares, energy, happy, unlocked: [selectedId], perks: m.pc.perks.mult, keep: m.keep, table, active: selectedId, happyLossMult: m.pc.perks.happyLossMult });
    const best = splitSession({ stats, shares: m.shares, energy: Math.max(energy, 100), happy, unlocked: m.pc.unlocked, perks: m.pc.perks.mult, keep: m.keep, table, active: selectedId, happyLossMult: m.pc.perks.happyLossMult });
    const total = totalOf(stats);
    const behind = STATS.reduce((a, k) => (m.shares[k] - stats[k] / total > m.shares[a] - stats[a] / total ? k : a), 'str');
    const tomorrow = (m.projection && m.projection[1]) || {};
    const boxes = new Map((page.boxes || []).map((b) => [b.stat, b]));

    for (const k of STATS) {
        const p = here.perStat[k];
        const box = boxes.get(k);
        const locked = (box && box.locked) || !(gym.dots[k] > 0);
        const share = stats[k] / total;
        if (p.trains > 0 || p.stopAt !== null) {
            const n = p.trains;
            const allEnergy = n * gym.energy > energy - gym.energy;
            perStat[k] = {
                kind: 'train',
                trains: n,
                gain: Math.round(p.gain),
                text: fmtInt(n) + ' train' + (n === 1 ? '' : 's'),
                sub: (allEnergy ? 'all your energy' : fmtInt(n * gym.energy) + ' energy') + ' · about ' + fmtSigned(p.gain),
                warn: p.stopAt !== null ? 'Stop at ' + p.stopAt + ' trains. More puts you under the rule for ' + p.stopReason + ' and you lose it.' : null,
            };
        } else if (locked) {
            perStat[k] = { kind: 'none', text: 'Not trained here' };
        } else if (share > m.shares[k] + 0.005) {
            perStat[k] = { kind: 'skip', text: 'Skip · ' + (share * 100).toFixed(0) + '% of total, over target' };
        } else if (tomorrow[k] > 0) {
            perStat[k] = { kind: 'next', text: 'Next · starts tomorrow' };
        } else {
            perStat[k] = { kind: 'skip', text: 'Skip · others are further behind' };
        }
    }

    // A better unlocked gym for the stat the plan trains first?
    const first = best.order[0];
    if (first) {
        const b = bestGymFor(first, stats, m.pc.unlocked, { table, active: selectedId });
        if (b && b.id !== selectedId && (!(gym.dots[first] > 0) || b.dots[first] > gym.dots[first])) {
            out.switchHint = 'Switch to ' + b.name + ' for ' + STAT_LABEL[first] + ' (' + b.dots[first] + (gym.dots[first] > 0 ? ' vs ' + gym.dots[first] : '') + ')';
        }
    }

    out.strip.push(m.build.name);
    out.strip.push(STAT_LABEL[behind] + ' is furthest behind');
    if (m.nextGym && m.nextGym.gym) {
        const ng = m.nextGym.gym;
        out.strip.push(ng.name + (m.nextGym.known ? ' in ' + fmtInt(m.nextGym.energyLeft) + ' E' : ' next') + ', ' + STAT_LABEL[behind] + ' ' + ng.dots[behind] + ' there');
    }
    const trainable = STATS.filter((k) => perStat[k].kind === 'train' && perStat[k].trains > 0);
    out.pill = trainable.length ? 'Train ' + trainable.map((k) => STAT_LABEL[k] + ' × ' + perStat[k].trains).join(' · ') : out.switchHint ? out.switchHint : energy < gym.energy ? 'Energy ' + energy + ' · wait for the next step' : null;
    return out;
}
