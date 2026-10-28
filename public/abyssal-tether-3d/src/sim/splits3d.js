/* ABYSSAL TETHER 3D — splits3d.js
 * Section splits (LEVEL_FUN_PLAN item 12, phase P2 data): the run time from entering section i to entering section i+1 (the
 * last section: to the goal), deaths and respawns included (the run clock counts while dead). A split is WHOLE only when the
 * section was entered from the one above in this run (or at the start of a run in S1): a Continue or a Sandbox warp into a
 * section, or a jump past a section, makes that section's split partial and it is never recorded. Medals compare a split
 * with the bot's par (src/data/par-3d.js, written by tools/abyssal-tether-3d/verify/verify.mjs --write-par): gold within
 * 1.0 x, silver 1.4 x, brass 2.0 x (the owner's thresholds).
 *
 * DOM-free, no imports, no allocation per frame (enter() runs only when the section changes). game.js drives it from
 * _enterSection / _beginVictory and emits 'split' { index, section, time, par, medal, recorded, difficulty }; meta/save.js
 * keeps the best split and medal per section and difficulty (schema 3).
 */

/** [medal, factor of the par]: the first whose factor x par the split does not exceed. */
export const SPLIT_MEDALS = [
  ['gold', 1.0],
  ['silver', 1.4],
  ['brass', 2.0],
];

/** Rank of a medal (higher is better; none = 0). */
export function medalRank(m) {
  for (let i = 0; i < SPLIT_MEDALS.length; i++) if (SPLIT_MEDALS[i][0] === m) return SPLIT_MEDALS.length - i;
  return 0;
}

/** The medal a split of `time` s earns against `par` s, or null (no par, or slower than the last threshold). */
export function medalFor(time, par) {
  if (!(time > 0) || !(par > 0)) return null;
  for (const [m, k] of SPLIT_MEDALS) if (time <= par * k + 1e-9) return m;
  return null;
}

export class SplitClock {
  /** @param {string[]} ids section ids, top to bottom */
  constructor(ids) {
    this.ids = Array.isArray(ids) ? ids.slice() : [];
    this.reset();
  }

  /** No split running (before a run starts). */
  reset() {
    this.index = -1;
    this.t0 = 0;
    this.whole = false;
    this.done = false; // the last section's split was already taken at the goal
  }

  /** The running split stops counting as whole (a Continue resumed mid-run, a debug teleport). */
  partial() {
    this.whole = false;
  }

  /**
   * game.js _enterSection: the player is now in section `idx` (mode 'initial' | 'progress' | 'respawn' | 'warp') at run time
   * `t`. Returns the finished split { index, id, time } of the section just left, or null.
   */
  enter(idx, mode, t) {
    const i = idx | 0;
    if (mode === 'initial') {
      this._start(i, t, i === 0);
      return null;
    }
    if (mode === 'warp') {
      this._start(i, t, false);
      return null;
    }
    if (i <= this.index) return null; // back up into a section above, or a respawn above (Nightmare): the split runs on
    if (mode === 'progress' && i === this.index + 1) {
      const out = this.whole ? { index: this.index, id: this.ids[this.index] || `s${this.index + 1}`, time: t - this.t0 } : null;
      this._start(i, t, true);
      return out;
    }
    this._start(i, t, false); // skipped a section, or a respawn below: nothing whole to record
    return null;
  }

  /** The goal is reached at run time `t`: the last section's split, or null. */
  goal(t) {
    if (this.done || !this.whole || this.index !== this.ids.length - 1) return null;
    this.done = true;
    return { index: this.index, id: this.ids[this.index], time: t - this.t0 };
  }

  _start(i, t, whole) {
    this.index = i;
    this.t0 = t;
    this.whole = whole;
    this.done = false;
  }
}
