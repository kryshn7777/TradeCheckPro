/* THE LANTERN (ABYSSAL TETHER 3D) — ui/trialCard.js
 * SECTION TRIALS (docs/abyssal-tether-3d/plans/SECTION_TRIALS.md): what the Records screen's Practise column and the trial
 * result card say. Pure (no DOM, no three.js); ui/ui3d.js draws it twice: the DOM (the death screen in trial mode, a column of
 * the records table) and the VR panel (the same canvas: no new draw call). Called when a screen opens, never per frame.
 */
import { U } from '../sim/config3d.js';
import { MEDAL_LABEL, ROMAN, fmtSplit, medalTimes } from './medals.js';
import { loadTrials } from '../meta/trials.js';

const RECORD_DIFFS = ['normal', 'nightmare', 'abyss']; // Sandbox reaches everything by warping: it unlocks nothing here

/**
 * Per records row: may it be practised (reached: the first section, a section with a split or a trial time on this difficulty,
 * or one whose top is above the deepest point reached on any timed difficulty), and its trial best.
 * @param {object[]} rows      ui/medals.js recordRows
 * @param {object[]} sections  the level's sections ({ yTop }), or null
 * @param {object} save        game.save (records(diff) -> { deepest }), or null
 * @param {string} diff
 * @param {number} chapter
 * @param {object} [storage]   meta/trials.js storage (default localStorage)
 * @returns {{ reached:boolean, best:number|null, untouched:boolean }[]}
 */
export function trialRows(rows, sections, save, diff, chapter = 1, storage = null) {
  const trials = loadTrials(chapter, diff, storage);
  let deepest = 0;
  for (const d of RECORD_DIFFS) {
    try {
      const r = save && typeof save.records === 'function' ? save.records(d) : null;
      if (r && typeof r.deepest === 'number' && r.deepest > deepest) deepest = r.deepest;
    } catch {
      /* no records */
    }
  }
  return (rows || []).map((r, i) => {
    const t = trials[r.id] || null;
    const s = sections && sections[i];
    const top = s && typeof s.yTop === 'number' ? U.depthMeters(s.yTop) : Infinity;
    return { reached: i === 0 || r.best != null || !!t || deepest + 1 >= top, best: t && t.best ? t.best : null, untouched: !!(t && t.untouched) };
  });
}

/**
 * The trial card's lines from game.trial (meta/trials.js newTrial + trialGlue's result).
 * @returns {{ kicker:string, title:string, line1:string, line2:string, tone:'new'|'ahead'|'behind'|'fail'|'plain', medal:string|null }}
 */
export function trialCard(tr, sectionName = '') {
  const t = tr || {};
  const r = t.result || {};
  const n = ROMAN[t.idx | 0] || String((t.idx | 0) + 1);
  const kicker = `Section trial · ${n}${sectionName ? ` · ${sectionName}` : ''}`;
  const par = r.par > 0 ? r.par : null;
  if (!t.done || t.failed || !(r.time > 0)) {
    const at = r.at > 0 ? r.at : t.t > 0 ? t.t : 0;
    return {
      kicker,
      title: at > 0 ? `Fell at ${fmtSplit(at)}` : 'Fell',
      line1: r.best > 0 ? `Trial best ${fmtSplit(r.best)}` : par ? `Par ${fmtSplit(par)}` : 'No trial time yet',
      line2: `Attempt ${Math.max(1, t.attempt | 0)} · again from the checkpoint`,
      tone: 'fail',
      medal: null,
    };
  }
  const medal = r.medal && MEDAL_LABEL[r.medal] ? r.medal : null;
  let line1;
  if (medal) line1 = `${MEDAL_LABEL[medal]}${par ? ` · par ${fmtSplit(par)}` : ''}`;
  else if (par) {
    const brass = medalTimes(par);
    line1 = `No medal · brass ≤ ${fmtSplit(brass[brass.length - 1].time)}`;
  } else line1 = 'No par on this difficulty';
  const bits = [];
  if (r.deltaText) bits.push(r.deltaText);
  if (r.isNew) bits.push(r.deltaText ? 'NEW BEST' : 'FIRST TIME');
  if (r.untouched) bits.push('UNTOUCHED');
  if (!r.isNew && r.best > 0) bits.push(`best ${fmtSplit(r.best)}`);
  const tone = r.isNew && r.deltaText ? 'new' : r.delta != null ? (r.delta < 0 ? 'ahead' : 'behind') : 'plain';
  return { kicker, title: fmtSplit(r.time), line1, line2: bits.join(' · ') || `Attempt ${Math.max(1, t.attempt | 0)}`, tone, medal };
}
