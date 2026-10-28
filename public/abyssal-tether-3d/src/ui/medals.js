/* ABYSSAL TETHER 3D — medals.js
 * LEVEL_FUN_PLAN item 12 (P6, the medals UI): what the section-records screen, the section-end line and the victory splits
 * show, from the schema-3 save (meta/save.js `byDiff[d].sections[id] = { best, medal }`), the generated par
 * (data/par-3d.js) and the medal thresholds (sim/splits3d.js: gold within 1.0 x par, silver 1.4 x, brass 2.0 x; par = the
 * bot's time on the section's main line from its checkpoint, deaths included in the player's split).
 *
 * Pure (no DOM, no three.js), no allocation per frame (the UI calls these when a screen opens or a split arrives).
 * ui/ui3d.js draws the rows twice: the DOM table (desktop / the Quest's 2D page) and the VR panel (one canvas texture: no
 * new draw call).
 */
import { SPLIT_MEDALS } from '../sim/splits3d.js';

export const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
/** Display names of the medals (the save keeps the ids; the owner's thresholds name the third one brass). */
export const MEDAL_LABEL = Object.freeze({ gold: 'Gold', silver: 'Silver', brass: 'Brass' });
/** Medal colours (a word always goes with the colour: colour-safe). */
export const MEDAL_COLOR = Object.freeze({ gold: '#e6c15a', silver: '#c9ced3', brass: '#c08a4e' });

/** A split as m:ss.d (tenths: what a section split needs; the run clock keeps hundredths). */
export function fmtSplit(t) {
  if (!(typeof t === 'number' && isFinite(t) && t >= 0)) return '—';
  const d = Math.round(t * 10);
  const m = Math.floor(d / 600);
  const s = (d - m * 600) / 10;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

/** The times a section's medals need against `par` s: [{ medal, factor, time }] best first (null without a par). */
export function medalTimes(par) {
  if (!(par > 0)) return null;
  return SPLIT_MEDALS.map(([medal, factor]) => ({ medal, factor, time: Math.floor(par * factor * 10 + 1e-6) / 10 }));
}

/** The next medal to chase with a best of `best` s: { medal, time, cut } (cut = s to take off), or null (gold, or no par). */
export function nextMedal(best, par) {
  const times = medalTimes(par);
  if (!times) return null;
  let next = null;
  for (let i = times.length - 1; i >= 0; i--) {
    const m = times[i];
    if (!(best > 0) || best > par * m.factor + 1e-9) {
      next = m;
      break;
    }
  }
  if (!next) return null;
  return { medal: next.medal, time: next.time, cut: best > 0 ? Math.max(0.1, Math.ceil((best - par * next.factor) * 10 - 1e-6) / 10) : null };
}

/**
 * The records table of one difficulty: one row per section, top to bottom.
 * @param {{id:string, name?:string}[]} sections  the level's sections (or ids)
 * @param {object} records  save.sectionRecords(diff): { <id>: { best, medal } }
 * @param {object|null} par  PAR_3D[diff]: { <id>: seconds } (null: Sandbox, no medals)
 * @returns {{index:number, id:string, numeral:string, name:string, best:number|null, medal:string|null, par:number|null, next:object|null}[]}
 */
export function recordRows(sections, records, par) {
  const rec = records && typeof records === 'object' ? records : {};
  const list = Array.isArray(sections) ? sections : [];
  return list.map((s, i) => {
    const id = typeof s === 'string' ? s : s && s.id ? s.id : `s${i + 1}`;
    const r = rec[id] || null;
    const best = r && typeof r.best === 'number' && isFinite(r.best) && r.best > 0 ? r.best : null;
    const medal = r && MEDAL_LABEL[r.medal] ? r.medal : null;
    const p = par && par[id] > 0 ? par[id] : null;
    return {
      index: i,
      id,
      numeral: ROMAN[i] || String(i + 1),
      name: (s && typeof s === 'object' && s.name) || `Section ${i + 1}`,
      best,
      medal,
      par: p,
      next: p ? nextMedal(best, p) : null,
    };
  });
}

/** Medal counts of a records table: { gold, silver, brass, played, of }. */
export function medalTally(rows) {
  const out = { gold: 0, silver: 0, brass: 0, played: 0, of: rows ? rows.length : 0 };
  for (const r of rows || []) {
    if (r.best != null) out.played++;
    if (r.medal && out[r.medal] !== undefined) out[r.medal]++;
  }
  return out;
}

/** The tally as one short line ("3 gold · 1 silver · 5 of 8 played"; "" when nothing was played). */
export function tallyLine(t) {
  if (!t || !t.played) return '';
  const bits = [];
  for (const [m] of SPLIT_MEDALS) if (t[m]) bits.push(`${t[m]} ${MEDAL_LABEL[m].toLowerCase()}`);
  bits.push(`${t.played} of ${t.of} played`);
  return bits.join(' · ');
}

/** The section-end line: "I · 1:12.4 · SILVER" (no medal: "I · 1:12.4"; a new best adds " · NEW BEST"). */
export function splitLine(index, time, medal, isNew) {
  const n = ROMAN[index] || String((index | 0) + 1);
  let s = `${n} · ${fmtSplit(time)}`;
  if (medal && MEDAL_LABEL[medal]) s += ` · ${MEDAL_LABEL[medal].toUpperCase()}`;
  if (isNew) s += ' · NEW BEST';
  return s;
}

/** The "target" cell of a records row: "Gold ≤ 0:14.0" (or "—" without a par, "Gold" when it is held). */
export function targetText(row) {
  if (!row || !row.par) return '—';
  if (!row.next) return 'All medals';
  return `${MEDAL_LABEL[row.next.medal]} ≤ ${fmtSplit(row.next.time)}`;
}
