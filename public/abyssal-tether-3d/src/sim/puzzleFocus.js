/* THE LANTERN (ABYSSAL TETHER 3D) — sim/puzzleFocus.js
 * PUZZLE FOCUS, the trigger half (docs/abyssal-tether-3d/plans/PUZZLE_FOCUS.md): WHEN a puzzle deserves a focus beat and WHICH line is said.
 *
 *   const pf = new PuzzleFocus({ seed })
 *   pf.build(objectives, level, extras)   once per run's objects: the puzzle list per section (objective fixtures + places worth a look)
 *   pf.reset(run)                         a new run: every step available again (a death does NOT reset: the ratchet)
 *   const trig = pf.update(dt, ctx)       once a frame: null, or the beat to start now { puzzle, step, line, x, y, z, glance }
 *
 * Steps (data/puzzle-focus-text.js): `first` (first sight: within the type's `see` m with a clear line of sight, or within NEAR_R m),
 * `nudge` (NUDGE_AFTER s after the first beat, still pending, the player in its section), `hint` (the 20 s highlight of
 * sim/objectiveHint.js has just come on for this objective). Each step at most once per puzzle per run. Rules:
 *   - a global COOLDOWN s between two beats, and never while the caller says busy (a beat already running, an opening / story line
 *     on air) or not playing;
 *   - the camera GLANCE (sim/focusBeat.js) at most once per puzzle per run, again only when the puzzle is still pending and REPAN s
 *     have passed since its last glance (a death in the same section does not repeat it sooner); a beat without a glance is the line
 *     and the cues only. Never a glance at a fixture that is occluded AND out of reach (REACH m);
 *   - the per-frame work is the pending puzzles of the current section and the next one (the neighbour below), cached at build();
 *     the line-of-sight ray (level.segmentBlocked) runs at most every LOS_EVERY s, for the nearest candidate only. No allocation.
 * The line: the type's variants for the step whose speaker the signal allows (an uplink voice needs UPLINK_MIN), picked by a
 * deterministic hash of (seed, puzzle, step, run), an uplink variant weighted by the signal (the deeper, the likelier Elias or Vesper).
 * Pure: DOM-free, three.js-free, no Math.random.
 */
import { PUZZLE_TYPES, UPLINK_MIN } from '../data/puzzle-focus-text.js';

export const COOLDOWN = 25;
export const NUDGE_AFTER = 40;
export const REPAN = 120;
export const NEAR_R = 6;
export const REACH = 30;
export const LOS_EVERY = 0.25;
/** Clearance at the target end of the sight ray (a ring bolted into a wall, a bell hanging under a grating's lip). */
const LOS_CLEAR = 0.9;
const LOCAL = { ELIAS: true, VESPER: true };

/** `?focus=off|cues|auto` (tests, captures; the e2e and the bots pass focus=off). '' = the setting decides. */
export function focusUrlMode(search) {
  const m = /[?&]focus=(off|cues|auto)\b/.exec(String(search || ''));
  return m ? m[1] : '';
}

/** The effective mode: the URL, else the setting ('auto' | 'cues' | 'off'); Reduced effects never turns the view ('cues'). */
export function focusMode(setting, url, reduced) {
  const m = url || (setting === 'off' || setting === 'cues' ? setting : 'auto');
  if (m === 'auto' && reduced) return 'cues';
  return m;
}

/** Which puzzle type an objective fixture is (by chapter, kind and id). '' = not a puzzle we guide to. */
export function puzzleTypeOf(f, chapter) {
  if (!f) return '';
  const id = String(f.id || '');
  if (chapter === 2) {
    if (id.indexOf('door-c2-2') === 0) return 'knocker';
    if (id.indexOf('bell-c2-9') === 0) return 'peal';
    if (id.indexOf('clap-c2-12') === 0) return 'clapper';
    if (id === 'bell-c2-12-pawl') return 'pawl';
    if (id === 'lever-c2-12') return 'lever';
    return '';
  }
  switch (f.kind) {
    case 'bell':
      return 'bell';
    case 'haul':
      return 'haul';
    case 'winch':
      return 'winch';
    case 'lamp':
      return 'lamp';
    case 'breach':
      return 'breach';
    case 'hook':
      return 'fork';
    case 'survive':
      return 'survive';
    default:
      return '';
  }
}

/** FNV-1a over a string (the same as comms3d.js hashStr). */
function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}
function mix(a, b) {
  let h = (a ^ Math.imul(b + 0x9e3779b9, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * The variant of a step: deterministic for (seed, puzzle id, step, run). Variants whose speaker the signal does not carry are left out;
 * an uplink one weighs `signal`, a local one 1. Returns the variant or null (no variant: the beat is cues only).
 */
export function pickVariant(list, signal, seed, key, run) {
  if (!list || !list.length) return null;
  let total = 0;
  for (let i = 0; i < list.length; i++) total += weightOf(list[i], signal);
  if (!(total > 0)) return null;
  const u = (mix(mix(seed >>> 0, hashStr(key)), run | 0) / 4294967296) * total;
  let acc = 0;
  for (let i = 0; i < list.length; i++) {
    const w = weightOf(list[i], signal);
    if (w <= 0) continue;
    acc += w;
    if (u < acc) return list[i];
  }
  for (let i = list.length - 1; i >= 0; i--) if (weightOf(list[i], signal) > 0) return list[i];
  return null;
}
function weightOf(v, signal) {
  if (LOCAL[v.speaker]) return 1;
  return signal >= UPLINK_MIN ? signal : 0;
}

/** Puzzle record (built once per run's objects). */
function makePuzzle(id, type, section, sectionId, obj) {
  return {
    id,
    type,
    def: PUZZLE_TYPES[type],
    section,
    sectionId,
    obj, // the objective index (-1: a place worth a look)
    fx: [], // fixture indices (objective puzzles)
    ref: null, // a live {x, y, z} (an anchor / a nook centre / a Name / a seal top) when not a fixture list
    name: '', // a Name's id (Chapter II)
    lureFx: -1, // the lure: the keystone fixture it serves (pending while that stands)
    x: 0, // the target this frame
    y: 0,
    z: 0,
    // the ratchet (per run)
    firstAt: -1,
    nudged: false,
    hinted: false,
    glancedAt: -1,
    vis: false, // the last line-of-sight answer
    visAt: -1e9,
  };
}

export class PuzzleFocus {
  constructor(opts) {
    const o = opts || {};
    this.seed = (o.seed | 0) >>> 0 || 0x7f0c;
    this.puzzles = [];
    this.bySection = []; // section index -> puzzles
    this.objectives = null;
    this.level = null;
    this.chapter = 1;
    this.trig = { puzzle: null, step: '', line: null, x: 0, y: 0, z: 0, glance: false, occluded: false, quiet: false };
    this._pendingHint = -1;
    this.reset(0);
  }

  /** A new run: every step of every puzzle available again, the cooldown clear. */
  reset(run) {
    this.run = run | 0;
    this.clock = 0;
    this.lastBeat = -1e9;
    this._losT = 0;
    this._hintWas = false;
    this._hintSec = -1;
    this._pendingHint = -1;
    this.beats = 0;
    for (const p of this.puzzles) {
      p.firstAt = -1;
      p.nudged = false;
      p.hinted = false;
      p.glancedAt = -1;
      p.vis = false;
      p.visAt = -1e9;
    }
  }

  /**
   * The puzzle list of a run's objects. objectives: Objectives3D (objectives, fixtures, nooks, seals, fixtureDone). level: Level3D
   * (sections, byId, segmentBlocked, data.c2). extras (optional): { chapter }. Returns the number of puzzles.
   */
  build(objectives, level, extras) {
    this.objectives = objectives || null;
    this.level = level || null;
    const ch = (extras && extras.chapter) || (level && level.data && level.data.c2 ? 2 : 1);
    this.chapter = ch;
    this.puzzles.length = 0;
    this.bySection.length = 0;
    const O = objectives;
    const secs = (level && level.sections) || [];
    const sid = (i) => (secs[i] ? secs[i].id : '');
    const secOfY = (y) => (level && typeof level.sectionIndexAt === 'function' ? level.sectionIndexAt(y) : 0);
    const add = (p) => {
      this.puzzles.push(p);
      (this.bySection[p.section] || (this.bySection[p.section] = [])).push(p);
    };
    if (O && O.objectives) {
      for (const o of O.objectives) {
        let type = '';
        for (const fi of o.fx) {
          type = puzzleTypeOf(O.fixtures[fi], ch);
          if (type) break;
        }
        if (!type || !PUZZLE_TYPES[type]) continue;
        const p = makePuzzle(`obj:${o.id}`, type, o.section, sid(o.section), o.index);
        for (const fi of o.fx) p.fx.push(fi);
        if (type === 'survive' && O.seals && O.seals[o.seal]) p.ref = O.seals[o.seal]; // the iris: the seal's top centre
        add(p);
      }
      for (const n of O.nooks || []) {
        const lure = n.lure === true;
        const p = makePuzzle(`nook:${n.id}`, lure ? 'lure' : 'rest', n.section, sid(n.section), -1);
        p.ref = { x: n.cx, y: n.cy, z: n.cz };
        p.lureFx = lure ? n.fixture : -1;
        add(p);
      }
    }
    if (ch === 2 && level) {
      const byId = level.byId || {};
      for (const [aid, type] of [['c2-1-ring0', 'swing'], ['c2-3-ring0', 'swing'], ['c2-2-lift-ring', 'lift']]) {
        const a = byId[aid];
        if (!a || a.x === undefined) continue;
        const si = secOfY(a.y);
        const p = makePuzzle(`anchor:${aid}`, type, si, sid(si), -1);
        p.ref = a; // a mover's anchor: its x, y, z move with it
        add(p);
      }
      const names = (level.data && level.data.c2 && level.data.c2.names) || [];
      for (const n of names) {
        const si = secOfY(n.y);
        const p = makePuzzle(`name:${n.id}`, 'name', si, sid(si), -1);
        p.ref = n;
        p.name = n.id;
        add(p);
      }
    }
    return this.puzzles.length;
  }

  /** Is the puzzle still something to do? (ctx.names: the Names found, a Set; Chapter II) */
  pending(p, names) {
    const O = this.objectives;
    if (p.obj >= 0) {
      if (!O || O.done[p.obj]) return false;
      for (let k = 0; k < p.fx.length; k++) {
        const fi = p.fx[k];
        if (!O.fixtureDone(fi) && !O.fixtures[fi].hidden) return true;
      }
      return false;
    }
    if (p.lureFx >= 0) return !!O && !O.fixtureDone(p.lureFx);
    if (p.name) return !(names && names.has(p.name));
    return true;
  }

  /** The puzzle's target now (the nearest pending fixture to the eye; a live ref). Returns the squared distance. */
  _aim(p, ex, ey, ez) {
    const O = this.objectives;
    if (p.ref) {
      p.x = p.ref.x;
      p.y = p.ref.y;
      p.z = p.ref.z;
    } else {
      let best = Infinity;
      for (let k = 0; k < p.fx.length; k++) {
        const fi = p.fx[k];
        if (O.fixtureDone(fi)) continue;
        const f = O.fixtures[fi];
        if (f.hidden) continue;
        const a = f.anchor && f.kind !== 'breach' ? f.anchor : f; // a ring on a mover moves: read it live
        const dx = a.x - ex;
        const dy = a.y - ey;
        const dz = a.z - ez;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < best) {
          best = d2;
          p.x = a.x;
          p.y = a.y;
          p.z = a.z;
        }
      }
      if (best === Infinity) return Infinity;
    }
    const dx = p.x - ex;
    const dy = p.y - ey;
    const dz = p.z - ez;
    return dx * dx + dy * dy + dz * dz;
  }

  /** The puzzle's target now (p.x, p.y, p.z); false when nothing of it is left to point at. (A boolean: no double crosses the call.) */
  aim(p, ex, ey, ez) {
    return this._aim(p, ex, ey, ez) !== Infinity;
  }

  _visible(p, ex, ey, ez) {
    const L = this.level;
    if (!L || typeof L.segmentBlocked !== 'function') return true;
    return !L.segmentBlocked(ex, ey, ez, p.x, p.y, p.z, LOS_CLEAR);
  }

  /**
   * One frame. ctx: { playing, busy (a beat running / a story line on air: wait), section, ex, ey, ez (the eye), signal (0..1, the
   * radio's), hintOn (the 20 s highlight is on), names (Chapter II: the Set of Names found) }. Returns this.trig (filled) or null.
   */
  update(dt, ctx) {
    const d = dt > 0 ? (dt > 0.25 ? 0.25 : dt) : 0;
    if (!ctx || !ctx.playing) {
      this._hintWas = false;
      return null;
    }
    this.clock += d;
    this._losT -= d;
    const sec = ctx.section | 0;
    // the 20 s highlight's rising edge (in this section)
    const hintEdge = !!ctx.hintOn && !(this._hintWas && this._hintSec === sec);
    this._hintWas = !!ctx.hintOn;
    this._hintSec = sec;
    if (ctx.busy || this.clock - this.lastBeat < COOLDOWN) {
      if (hintEdge) this._pendingHint = sec; // the hint step waits for the cooldown (it stays due while the highlight is on)
      return null;
    }
    const ex = ctx.ex;
    const ey = ctx.ey;
    const ez = ctx.ez;
    // 1. the hint escalation: the first pending objective of this section (the one sim/objectiveHint.js marks)
    if ((hintEdge || (ctx.hintOn && this._pendingHint === sec)) && this._hintStep(sec, ex, ey, ez, ctx)) return this.trig;
    // 2. the nudge: still pending NUDGE_AFTER s after its first beat, the player in its section
    const here = this.bySection[sec];
    if (here) {
      for (let i = 0; i < here.length; i++) {
        const p = here[i];
        if (p.obj < 0 || p.nudged || p.firstAt < 0 || this.clock - p.firstAt < NUDGE_AFTER) continue;
        if (!this.pending(p, ctx.names)) continue;
        p.nudged = true;
        if (this._aim(p, ex, ey, ez) === Infinity) continue;
        return this._fire(p, 'nudge', ctx, ex, ey, ez);
      }
    }
    // 3. first sight: the nearest pending, unseen puzzle of this section and the next one within its range; a sight ray every LOS_EVERY s
    let best = null;
    let bestD2 = Infinity;
    for (let s = sec; s <= sec + 1; s++) {
      const list = this.bySection[s];
      if (!list) continue;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        if (p.firstAt >= 0 || !p.def || !p.def.first) continue;
        if (!this.pending(p, ctx.names)) continue;
        const d2 = this._aim(p, ex, ey, ez);
        const see = p.def.see || 15;
        if (d2 > see * see) continue;
        if (d2 < bestD2) {
          bestD2 = d2;
          best = p;
        }
      }
    }
    if (!best) return null;
    if (bestD2 <= NEAR_R * NEAR_R) return this._fire(best, 'first', ctx, ex, ey, ez);
    if (this._losT > 0) return null;
    this._losT = LOS_EVERY;
    best.vis = this._visible(best, ex, ey, ez);
    best.visAt = this.clock;
    if (!best.vis) return null;
    return this._fire(best, 'first', ctx, ex, ey, ez);
  }

  _hintStep(sec, ex, ey, ez, ctx) {
    const O = this.objectives;
    if (!O) return false;
    let obj = -1;
    for (let i = 0; i < O.objectives.length; i++) {
      const o = O.objectives[i];
      if (o.section === sec && !O.done[o.index] && !(O.sealOpen && O.sealOpen[o.seal])) {
        obj = o.index;
        break;
      }
    }
    this._pendingHint = -1;
    const here = this.bySection[sec];
    if (obj < 0 || !here) return false;
    for (let i = 0; i < here.length; i++) {
      const p = here[i];
      if (p.obj !== obj) continue;
      if (p.hinted || !this.pending(p, ctx.names)) return false;
      p.hinted = true;
      if (p.firstAt < 0) p.firstAt = this.clock; // the hint is its first beat then (no first-sight line after it)
      if (this._aim(p, ex, ey, ez) === Infinity) return false;
      this._fire(p, 'hint', ctx, ex, ey, ez);
      return true;
    }
    return false;
  }

  _fire(p, step, ctx, ex, ey, ez) {
    if (step === 'first') p.firstAt = this.clock;
    const t = this.trig;
    t.puzzle = p;
    t.step = step;
    t.x = p.x;
    t.y = p.y;
    t.z = p.z;
    const quiet = !!(p.def.quiet && p.def.quiet.indexOf(p.sectionId) >= 0);
    t.quiet = quiet;
    t.line = quiet ? null : pickVariant(p.def[step], ctx.signal == null ? 1 : ctx.signal, this.seed, `${p.id}#${step}`, this.run);
    // the glance: once per puzzle, again only if still pending REPAN s later; never at a fixture occluded and out of reach
    let glance = p.glancedAt < 0 || this.clock - p.glancedAt >= REPAN;
    t.occluded = false;
    if (glance) {
      const dx = p.x - ex;
      const dy = p.y - ey;
      const dz = p.z - ez;
      const far = dx * dx + dy * dy + dz * dz > REACH * REACH;
      if (far) {
        if (this.clock - p.visAt > LOS_EVERY) {
          p.vis = this._visible(p, ex, ey, ez);
          p.visAt = this.clock;
        }
        if (!p.vis) {
          glance = false;
          t.occluded = true;
        }
      }
    }
    t.glance = glance;
    this.lastBeat = this.clock;
    this.beats++;
    return t;
  }

  /** The caller started the beat and it panned: the glance ratchet. */
  noteGlance(p) {
    if (p) p.glancedAt = this.clock;
  }
}
