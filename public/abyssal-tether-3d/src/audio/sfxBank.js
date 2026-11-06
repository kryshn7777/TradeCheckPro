/* THE LANTERN (ABYSSAL TETHER 3D) — sfxBank.js
 * The designed sound effects: every recipe below is ONE event's sound, named for what makes it, built in layers
 * (transient + body + tail) with numbers, scaled by the event's data (k = 0..1) and varied deterministically
 * (sfxDesign.js: 'cycle' round robin, 'alt' left / right, 'hash' of the event's data, 'fixed'). Pure data + small routing
 * functions: no WebAudio, no three.js, no DOM, no Math.random (Node-testable; captions.js reads SFX_CAPTIONS from here).
 * The design document with every table: docs/abyssal-tether-3d/plans/SFX_DESIGN.md.
 *
 * Recipe fields (see sfxDesign.compileRecipe):
 *   bus 'player'|'ui'|'stinger'|'ambient'|'creature'|'psych'   prio 0 texture .. 3 danger (higher steals lower at the voice cap)
 *   gap   min seconds between two plays          level  out gain (number or [atK0, atK1])     send  reverb send
 *   space 'head' | 'hand' (panned to the hand) | 'world' (HRTF at the payload's x,y,z; distance, air, occlusion, sound delay)
 *   floor (world) keep at least this loud however far     maxInst  live copies allowed (0 = only the global cap)
 *   vary  { rule, n variants, pitch / level / time spread }  layers  the synthesis:
 *     t:'tone'  w wave, f → f2 (sweep tc sw), a attack, h hold, d decay tc, g peak, lfo [rate, depth] tremolo
 *     t:'noise' src white|pink|brown, rate, ft bandpass|lowpass|highpass, f → f2, q, a h d g, lfo
 *     t:'modal' f, r partial ratios, m amps, dk decay multipliers (× d)            (struck metal / bone / glass)
 *     t:'ticks' n ticks over span seconds, band f..f2, q, d per tick, falloff      (grit, gravel, rattles, droplets)
 *   any number may be [atK0, atK1]; minK / maxK gate a layer by intensity (e.g. debris only on hard landings).
 */
import { hashPos, hashStr, VAR } from './sfxDesign.js';
import { SECTION_BEDS, sectionOfY } from './dsp3d.js';
import { KNOCKER_RECIPES, KNOCKER_ROUTES } from './knockerSfx.js'; // THE KNOCKER (sim/knocker3d.js): its recipes + routes

// ===========================================================================
// Surfaces (feet, hook, landing, props)
// ===========================================================================
export const SURF = Object.freeze({ STONE: 0, METAL: 1, GRATE: 2, WET: 3, DEBRIS: 4 });
export const SURF_NAMES = Object.freeze(['stone', 'metal', 'grate', 'wet', 'debris']);
const DEBRIS_FROM = 3; // sections from here down are littered with the remains: some floor patches are bone and gravel
const DEBRIS_P = 0.12;

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

/**
 * The surface at a point: the solid's kind first (metal girders / bridges, the seal grates, crumbling ledges and the
 * breach rubble), else stone that is wet on a hashed share of 2.2 m patches (the section's wetness), or bone-and-gravel
 * debris on 12 % of the patches from section 4 down. Deterministic: the same patch always sounds the same.
 */
export function surfaceAt(kind, section, x, y, z) {
  if (kind === 'metal' || kind === 'bridge' || kind === 'iron') return SURF.METAL;
  if (kind === 'grate') return SURF.GRATE;
  if (kind === 'crumble' || kind === 'breach' || kind === 'debris' || kind === 'bones') return SURF.DEBRIS;
  const si = section >= 0 ? section : y === y ? sectionOfY(y) : 0;
  const bed = SECTION_BEDS[si < 0 ? 0 : si >= SECTION_BEDS.length ? SECTION_BEDS.length - 1 : si];
  const h = hashPos(x, y, z, 2.2);
  const roll = (h & 0xffff) / 65536;
  if (bed && bed.wetness > 0.05 && roll < bed.wetness * 0.85) return SURF.WET;
  if (si >= DEBRIS_FROM && ((h >>> 16) & 0xffff) / 65536 < DEBRIS_P) return SURF.DEBRIS;
  return SURF.STONE;
}

// ===========================================================================
// Shared layer fragments (frozen; spread into recipes)
// ===========================================================================
const THUMP = (f, f2, g, d) => ({ t: 'tone', w: 'sine', f, f2, sw: 0.035, a: 0.002, d, g });
const IRON = [1, 2.32, 3.86, 5.41]; // struck iron (inharmonic)
const IRON_M = [0.5, 0.3, 0.2, 0.12];
const IRON_DK = [1, 0.64, 0.45, 0.31];
const BELL = [1, 2.76, 5.4, 8.93];
const BELL_M = [1, 0.45, 0.22, 0.08];
const BAR = [1, 2.76, 5.4]; // a free bar (grate)
const BONE = [1, 2.9, 4.7]; // a dry bone / ceramic knock
const GLASS = [1, 2.71, 5.12, 7.9];

// ===========================================================================
// The recipes
// ===========================================================================
export const RECIPES = {
  // ---- footsteps (k = run speed 0.3..1; 'cycle' over 6 variants; the route alternates the feet left / right) ------------
  'step.stone': {
    bus: 'player', prio: 0, gap: 0.09, level: [0.22, 0.4], send: 0.06, maxInst: 2, vary: { rule: 'cycle', n: 6, pitch: 0.06, level: 0.12, time: 0.15 },
    note: 'heel thud + body + toe tick + grit scuff at a run',
    layers: [
      { t: 'noise', src: 'brown', rate: 1.2, ft: 'bandpass', f: 230, q: 1, a: 0.002, d: 0.03, g: 0.8 },
      THUMP(110, 62, [0.2, 0.4], 0.04),
      { t: 'noise', src: 'white', ft: 'bandpass', f: 3100, q: 1.2, at: 0.012, a: 0.002, d: 0.02, g: 0.16 },
      { t: 'ticks', src: 'white', f: 2600, f2: 5200, q: 3, n: [1, 3], span: 0.05, at: 0.025, d: 0.006, g: 0.1, minK: 0.55 },
    ],
  },
  'step.metal': {
    bus: 'player', prio: 0, gap: 0.09, level: [0.2, 0.36], send: 0.14, maxInst: 2, vary: { rule: 'cycle', n: 6, pitch: 0.07, level: 0.1 },
    note: 'a hollow girder tonk: rubber sole, the beam ringing, a bright tick',
    layers: [
      { t: 'noise', src: 'brown', ft: 'lowpass', f: 320, q: 0, d: 0.025, g: 0.5 },
      { t: 'modal', f: 210, r: [1, 2.43, 3.9], m: [0.6, 0.22, 0.1], dk: [1, 0.8, 0.6], d: [0.06, 0.09], g: 1 },
      { t: 'noise', src: 'white', ft: 'bandpass', f: 4200, q: 12, d: 0.035, g: 0.3 },
    ],
  },
  'step.grate': {
    bus: 'player', prio: 0, gap: 0.09, level: [0.2, 0.36], send: 0.12, maxInst: 2, vary: { rule: 'cycle', n: 6, pitch: 0.05, level: 0.1, time: 0.2 },
    note: 'a grid of bars rattling in its frame',
    layers: [
      { t: 'noise', src: 'brown', ft: 'bandpass', f: 260, q: 1, d: 0.03, g: 0.6 },
      { t: 'modal', f: 520, r: BAR, m: [0.25, 0.16, 0.08], dk: [1, 0.7, 0.5], d: 0.05, g: 1 },
      { t: 'ticks', src: 'white', f: 1800, f2: 4200, q: 6, n: [3, 5], span: 0.07, at: 0.01, d: 0.006, g: 0.22, falloff: 0.5 },
    ],
  },
  'step.wet': {
    bus: 'player', prio: 0, gap: 0.09, level: [0.22, 0.38], send: 0.2, maxInst: 2, vary: { rule: 'cycle', n: 6, pitch: 0.08, level: 0.12, time: 0.2 },
    note: 'a shallow puddle: the splash opening up, one bloop, droplets falling back',
    layers: [
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 380, f2: 1400, sw: 0.05, q: 3, a: 0.004, d: 0.06, g: 0.7 },
      { t: 'tone', w: 'sine', f: 600, f2: 1700, sw: 0.014, at: 0.03, a: 0.002, d: 0.03, g: 0.25 },
      { t: 'noise', src: 'brown', ft: 'lowpass', f: 260, q: 0, d: 0.04, g: 0.5 },
      { t: 'ticks', src: 'white', f: 1200, f2: 3000, q: 5, n: [2, 4], span: 0.12, at: 0.05, d: 0.01, g: 0.14, falloff: 0.5 },
    ],
  },
  'step.debris': {
    bus: 'player', prio: 0, gap: 0.09, level: [0.22, 0.38], send: 0.08, maxInst: 2, vary: { rule: 'cycle', n: 6, pitch: 0.06, level: 0.12, time: 0.2 },
    note: 'gravel crunching under the sole, a bone knocked aside',
    layers: [
      { t: 'noise', src: 'brown', ft: 'bandpass', f: 240, q: 1, d: 0.03, g: 0.55 },
      { t: 'ticks', src: 'white', f: 1600, f2: 5200, q: 4, n: [4, 7], span: 0.06, d: 0.005, g: 0.3, falloff: 0.3 },
      { t: 'modal', f: 1450, r: BONE, m: [0.14, 0.06, 0.03], dk: [1, 0.6, 0.4], at: 0.02, d: 0.03, g: 1 },
    ],
  },

  // ---- landings (k = how close to lethal 0.12..1; prio 2: the body hitting the floor always reads) -------------------------
  'land.stone': {
    bus: 'player', prio: 2, gap: 0.06, level: [0.42, 0.74], send: [0.06, 0.18], vary: { rule: 'cycle', n: 4, pitch: 0.04, level: 0.06 },
    note: 'body thump + floor slap + grit; hard: a grunt and debris',
    layers: [
      THUMP(90, 42, [0.3, 0.75], [0.06, 0.16]),
      { t: 'noise', src: 'brown', ft: 'lowpass', f: [300, 1200], q: 0, d: [0.05, 0.11], g: [0.35, 0.7] },
      { t: 'noise', src: 'white', ft: 'bandpass', f: 2500, q: 0.8, d: 0.03, g: [0.08, 0.18] },
      { t: 'ticks', src: 'white', f: 1200, f2: 3600, q: 4, n: [3, 8], span: [0.15, 0.35], at: 0.04, d: 0.01, g: 0.22, falloff: 0.5, minK: 0.4 },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 560, q: 4, at: 0.03, a: 0.02, h: 0.08, d: 0.05, g: 0.55, minK: 0.55 },
      { t: 'tone', w: 'triangle', f: 115, f2: 84, sw: 0.06, at: 0.03, a: 0.02, h: 0.06, d: 0.05, g: 0.07, minK: 0.55 },
    ],
  },
  'land.metal': {
    bus: 'player', prio: 2, gap: 0.06, level: [0.42, 0.74], send: [0.12, 0.25], vary: { rule: 'cycle', n: 4, pitch: 0.05, level: 0.06 },
    note: 'body thump + the girder booming under you',
    layers: [
      THUMP(90, 42, [0.3, 0.7], [0.06, 0.15]),
      { t: 'noise', src: 'brown', ft: 'lowpass', f: [300, 900], q: 0, d: [0.04, 0.09], g: [0.3, 0.6] },
      { t: 'modal', f: [175, 140], r: IRON, m: IRON_M, dk: IRON_DK, d: [0.12, 0.24], g: [0.5, 0.9] },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 560, q: 4, at: 0.03, a: 0.02, h: 0.08, d: 0.05, g: 0.5, minK: 0.55 },
    ],
  },
  'land.grate': {
    bus: 'player', prio: 2, gap: 0.06, level: [0.42, 0.74], send: [0.1, 0.22], vary: { rule: 'cycle', n: 4, pitch: 0.05, level: 0.06 },
    note: 'the grate bouncing in its frame, bars chattering',
    layers: [
      THUMP(95, 45, [0.3, 0.7], [0.06, 0.14]),
      { t: 'modal', f: [480, 400], r: BAR, m: [0.35, 0.2, 0.1], dk: [1, 0.7, 0.5], d: [0.08, 0.14], g: 1 },
      { t: 'ticks', src: 'white', f: 1500, f2: 4200, q: 6, n: [5, 12], span: [0.15, 0.4], at: 0.02, d: 0.008, g: 0.3, falloff: 0.7 },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 560, q: 4, at: 0.03, a: 0.02, h: 0.08, d: 0.05, g: 0.5, minK: 0.55 },
    ],
  },
  'land.wet': {
    bus: 'player', prio: 2, gap: 0.06, level: [0.42, 0.74], send: [0.15, 0.3], vary: { rule: 'cycle', n: 4, pitch: 0.05, level: 0.06, time: 0.2 },
    note: 'thump into a puddle: a splash sheet, droplets raining back',
    layers: [
      THUMP(85, 42, [0.3, 0.7], [0.06, 0.15]),
      { t: 'noise', src: 'white', ft: 'highpass', f: 1700, q: 0, a: 0.012, h: 0.03, d: [0.06, 0.12], g: [0.2, 0.4] },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 420, f2: 1300, sw: 0.06, q: 2, d: 0.08, g: 0.45 },
      { t: 'ticks', src: 'white', f: 900, f2: 2600, q: 5, n: [3, 9], span: [0.2, 0.45], at: 0.06, d: 0.012, g: 0.25, falloff: 0.5 },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 560, q: 4, at: 0.03, a: 0.02, h: 0.08, d: 0.05, g: 0.5, minK: 0.55 },
    ],
  },
  'land.debris': {
    bus: 'player', prio: 2, gap: 0.06, level: [0.42, 0.74], send: [0.08, 0.2], vary: { rule: 'cycle', n: 4, pitch: 0.05, level: 0.06, time: 0.2 },
    note: 'thump into gravel and bones: a crunch spray, bones knocked loose',
    layers: [
      THUMP(90, 42, [0.3, 0.72], [0.06, 0.15]),
      { t: 'noise', src: 'brown', ft: 'lowpass', f: [300, 1000], q: 0, d: [0.05, 0.1], g: [0.3, 0.6] },
      { t: 'ticks', src: 'white', f: 1400, f2: 5200, q: 4, n: [6, 14], span: [0.12, 0.4], d: 0.006, g: 0.3, falloff: 0.5 },
      { t: 'modal', f: 1250, r: BONE, m: [0.2, 0.08, 0.04], dk: [1, 0.6, 0.4], at: 0.05, d: 0.035, g: 1 },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 560, q: 4, at: 0.03, a: 0.02, h: 0.08, d: 0.05, g: 0.5, minK: 0.55 },
    ],
  },

  // ---- the hook biting (grapple:attach; k = arrival speed; WORLD at the anchor, kept ≥ 0.6: it is the "you are caught" cue) --
  'hook.stone': {
    bus: 'player', prio: 2, gap: 0.03, level: [0.5, 0.8], send: 0.1, space: 'world', floor: 0.6, vary: { rule: 'hash', n: 6, pitch: 0.05, level: 0.08 },
    note: 'tip transient + chisel thunk + grit spray + the hook ringing + the line taking the load',
    layers: [
      { t: 'noise', src: 'white', ft: 'highpass', f: 2600, q: 0, a: 0.001, d: 0.012, g: 0.35 },
      THUMP(118, 58, 0.55, 0.07),
      { t: 'ticks', src: 'white', f: 1400, f2: 4800, q: 4, n: [3, 6], span: 0.12, at: 0.015, d: 0.007, g: 0.25, falloff: 0.6 },
      { t: 'modal', f: [480, 400], r: IRON, m: [0.18, 0.1, 0.06, 0.03], dk: IRON_DK, d: 0.08, g: 1 },
      { t: 'noise', src: 'brown', rate: 1.1, ft: 'bandpass', f: 330, f2: 190, sw: 0.15, q: 5, at: 0.02, a: 0.05, h: 0.12, d: 0.1, g: [0.2, 0.4] },
    ],
  },
  'hook.metal': {
    bus: 'player', prio: 2, gap: 0.03, level: [0.5, 0.74], send: [0.12, 0.24], space: 'world', floor: 0.6, vary: { rule: 'hash', n: 6, pitch: 0.04, level: 0.06 },
    note: 'a struck-iron clang (inharmonic partials, longer at speed) + tick + thunk + line creak',
    layers: [
      { t: 'modal', f: [455, 355], r: IRON, m: IRON_M, dk: IRON_DK, d: [0.11, 0.2], g: 1 },
      { t: 'noise', src: 'white', ft: 'highpass', f: 3000, q: 0, a: 0.001, d: 0.012, g: 0.3 },
      THUMP(118, 58, 0.4, 0.07),
      { t: 'noise', src: 'brown', rate: 1.1, ft: 'bandpass', f: 330, f2: 190, sw: 0.15, q: 5, at: 0.02, a: 0.05, h: 0.12, d: 0.1, g: [0.2, 0.4] },
    ],
  },
  'hook.grate': {
    bus: 'player', prio: 2, gap: 0.03, level: [0.5, 0.8], send: 0.14, space: 'world', floor: 0.6, vary: { rule: 'hash', n: 6, pitch: 0.05, level: 0.08, time: 0.2 },
    note: 'the hook catching a bar: a bar note and the whole grid rattling',
    layers: [
      { t: 'modal', f: 610, r: BAR, m: [0.4, 0.22, 0.1], dk: [1, 0.7, 0.5], d: [0.08, 0.14], g: 1 },
      { t: 'ticks', src: 'white', f: 1600, f2: 4400, q: 6, n: [5, 9], span: [0.18, 0.3], at: 0.01, d: 0.007, g: 0.28, falloff: 0.6 },
      THUMP(118, 58, 0.4, 0.06),
      { t: 'noise', src: 'brown', rate: 1.1, ft: 'bandpass', f: 330, f2: 190, sw: 0.15, q: 5, at: 0.02, a: 0.05, h: 0.12, d: 0.1, g: [0.2, 0.4] },
    ],
  },
  'hook.wet': {
    bus: 'player', prio: 2, gap: 0.03, level: [0.5, 0.8], send: 0.18, space: 'world', floor: 0.6, vary: { rule: 'hash', n: 6, pitch: 0.05, level: 0.08 },
    note: 'the bite into slick stone: a wet slap over the thunk, a drip shaken loose',
    layers: [
      { t: 'noise', src: 'white', ft: 'highpass', f: 2400, q: 0, a: 0.001, d: 0.012, g: 0.3 },
      THUMP(112, 56, 0.55, 0.07),
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 900, f2: 2400, sw: 0.04, q: 2, a: 0.003, d: 0.05, g: 0.35 },
      { t: 'ticks', src: 'white', f: 1000, f2: 2800, q: 6, n: [2, 4], span: 0.25, at: 0.05, d: 0.012, g: 0.18, falloff: 0.4 },
      { t: 'noise', src: 'brown', rate: 1.1, ft: 'bandpass', f: 330, f2: 190, sw: 0.15, q: 5, at: 0.02, a: 0.05, h: 0.12, d: 0.1, g: [0.2, 0.4] },
    ],
  },
  'hook.debris': {
    bus: 'player', prio: 2, gap: 0.03, level: [0.55, 0.85], send: 0.16, space: 'world', floor: 0.6, vary: { rule: 'hash', n: 6, pitch: 0.05, level: 0.08, time: 0.2 },
    note: 'the hook in crumbling stone (a frayed hold): a soft bite and grit pouring: this hold will not last',
    layers: [
      THUMP(105, 52, 0.45, 0.07),
      { t: 'noise', src: 'brown', rate: 1.3, ft: 'bandpass', f: 760, q: 1.4, a: 0.004, d: 0.09, g: 0.45 },
      { t: 'ticks', src: 'white', f: 900, f2: 4200, q: 3.5, n: [8, 14], span: 0.6, at: 0.03, d: 0.012, g: 0.3, falloff: 0.7 },
      { t: 'noise', src: 'brown', rate: 1.1, ft: 'bandpass', f: 300, f2: 170, sw: 0.15, q: 5, at: 0.02, a: 0.05, h: 0.12, d: 0.1, g: [0.2, 0.35] },
    ],
  },
  'hook.ring': {
    bus: 'player', prio: 2, gap: 0.03, level: [0.5, 0.74], send: [0.12, 0.24], space: 'world', floor: 0.6, vary: { rule: 'hash', n: 6, pitch: 0.04, level: 0.06 },
    note: 'a forged ring: heavy iron, longer ring, a link rattle when it hangs from a chain',
    layers: [
      { t: 'modal', f: [400, 312], r: IRON, m: IRON_M, dk: IRON_DK, d: [0.13, 0.24], g: 1 },
      { t: 'noise', src: 'white', ft: 'highpass', f: 2600, q: 0, a: 0.001, d: 0.012, g: 0.3 },
      THUMP(118, 58, 0.5, 0.07),
      { t: 'ticks', src: 'white', f: 2400, f2: 5200, q: 8, n: [2, 5], span: 0.2, at: 0.06, d: 0.01, g: 0.2, falloff: 0.5 },
      { t: 'noise', src: 'brown', rate: 1.1, ft: 'bandpass', f: 330, f2: 190, sw: 0.15, q: 5, at: 0.02, a: 0.05, h: 0.12, d: 0.1, g: [0.2, 0.4] },
    ],
  },

  // ---- the shot that finds nothing / falls off -------------------------------------------------------------------------------
  'miss.short': {
    bus: 'player', prio: 1, gap: 0.08, level: 1.2, send: 0.08, space: 'hand', vary: { rule: 'cycle', n: 4, pitch: 0.05, level: 0.06 },
    note: 'the line running out into nothing, whipping back, the reel spring rattling it home',
    layers: [
      { t: 'noise', src: 'white', ft: 'bandpass', f: 2600, f2: 500, sw: 0.08, q: 1.2, a: 0.02, h: 0.05, d: 0.05, g: 0.3 },
      { t: 'tone', w: 'triangle', f: 900, f2: 300, sw: 0.05, at: 0.12, a: 0.003, d: 0.03, g: 0.08 },
      { t: 'ticks', src: 'white', f: 2400, f2: 4200, q: 6, n: 5, span: 0.2, at: 0.13, d: 0.008, g: 0.35, falloff: 0.6 },
    ],
  },
  'miss.fall': {
    bus: 'player', prio: 1, gap: 0.08, level: 0.7, send: 0.2, space: 'world', floor: 0.35, vary: { rule: 'hash', n: 6, pitch: 0.06, level: 0.08, time: 0.25 },
    note: 'the hook skates off the face: a short iron clack and bounces falling away',
    layers: [
      { t: 'modal', f: 700, r: IRON, m: [0.4, 0.22, 0.12, 0.06], dk: [1, 0.6, 0.4, 0.3], d: 0.04, g: 1 },
      { t: 'ticks', src: 'white', f: 1800, f2: 4200, q: 7, n: 6, span: 0.4, at: 0.06, d: 0.012, g: 0.3, falloff: 0.75 },
      { t: 'noise', src: 'white', ft: 'highpass', f: 3000, q: 0, a: 0.001, d: 0.01, g: 0.25 },
    ],
  },

  // ---- the rope under load (rope:jolt k = speed 12..26 m/s; grapple:break) ----------------------------------------------------
  'rope.jolt': {
    bus: 'player', prio: 2, gap: 0.12, level: [0.45, 0.8], send: 0.1, vary: { rule: 'cycle', n: 4, pitch: 0.05, level: 0.06 },
    note: 'fibre creak (pulsed band noise) + thwack + thump; past half tension the line twangs; at the top it sings',
    layers: [
      { t: 'noise', src: 'brown', ft: 'bandpass', f: 640, q: 8, a: 0.012, h: 0.06, d: 0.08, g: [0.6, 0.9], lfo: [[48, 70], 0.9] },
      { t: 'noise', src: 'brown', ft: 'bandpass', f: 1500, q: 10, a: 0.012, h: 0.05, d: 0.07, g: 0.4, lfo: [[48, 70], 0.9] },
      { t: 'noise', src: 'white', ft: 'lowpass', f: 1800, q: 0, d: 0.03, g: [0.3, 0.5] },
      THUMP(72, 44, [0.35, 0.6], 0.07),
      { t: 'tone', w: 'triangle', f: [180, 260], f2: [140, 200], sw: 0.2, a: 0.003, d: [0.15, 0.3], g: 0.2, minK: 0.45 },
      { t: 'modal', f: [380, 520], r: [1, 2.01, 3.03], m: [0.12, 0.06, 0.03], dk: [1, 0.7, 0.5], d: 0.18, g: 1, minK: 0.6 },
    ],
  },
  'rope.snap': {
    bus: 'player', prio: 3, gap: 0.1, level: 0.8, send: 0.3, space: 'world', floor: 0.7, vary: { rule: 'hash', n: 4, pitch: 0.04, level: 0.05, time: 0.2 },
    note: 'the anchor gives: fibre crack, the line whipping back through the air, the thud, stone chips falling away',
    layers: [
      { t: 'noise', src: 'white', ft: 'highpass', f: 1800, q: 0, a: 0.001, d: 0.015, g: 0.6 },
      { t: 'tone', w: 'triangle', f: 1400, f2: 120, sw: 0.06, a: 0.002, d: 0.08, g: 0.22 },
      { t: 'noise', src: 'white', ft: 'bandpass', f: 3200, f2: 600, sw: 0.1, q: 1.5, a: 0.005, h: 0.06, d: 0.06, g: 0.3 },
      THUMP(90, 40, 0.5, 0.09),
      { t: 'ticks', src: 'white', f: 900, f2: 4200, q: 3.5, n: 14, span: 1.2, at: 0.05, d: 0.014, g: 0.4, falloff: 0.6 },
      { t: 'noise', src: 'brown', ft: 'lowpass', f: 600, q: 0, at: 0.02, a: 0.01, d: 0.2, g: 0.4 },
    ],
  },
  'rope.cut': {
    bus: 'player', prio: 3, gap: 0.1, level: 0.8, send: 0.25, space: 'world', floor: 0.7, vary: { rule: 'cycle', n: 4, pitch: 0.04 },
    note: 'the line sawn through: strands parting one by one, then the whip-back',
    layers: [
      { t: 'ticks', src: 'white', f: 2000, f2: 5200, q: 5, n: 7, span: 0.16, d: 0.006, g: 0.4, falloff: -0.4 },
      { t: 'noise', src: 'white', ft: 'highpass', f: 2000, q: 0, at: 0.17, a: 0.001, d: 0.015, g: 0.55 },
      { t: 'tone', w: 'triangle', f: 1200, f2: 110, sw: 0.07, at: 0.17, a: 0.002, d: 0.09, g: 0.22 },
      { t: 'noise', src: 'white', ft: 'bandpass', f: 3000, f2: 600, sw: 0.1, q: 1.5, at: 0.17, a: 0.005, h: 0.06, d: 0.06, g: 0.3 },
    ],
  },
  'launcher.dry': {
    bus: 'player', prio: 1, gap: 0.25, level: 0.45, space: 'hand', vary: { rule: 'cycle', n: 3, pitch: 0.04 },
    note: 'the trigger pulled while the launcher recharges: a hollow pawl click, a spring buzz, no shot',
    layers: [
      { t: 'noise', src: 'white', ft: 'bandpass', f: 2800, q: 5, a: 0.001, d: 0.006, g: 0.5 },
      { t: 'modal', f: 1900, r: [1, 2.3], m: [0.12, 0.05], dk: [1, 0.6], d: 0.02, g: 1 },
      { t: 'noise', src: 'white', ft: 'bandpass', f: 1500, q: 3, at: 0.07, a: 0.001, d: 0.008, g: 0.3 },
      { t: 'tone', w: 'sawtooth', f: 160, f2: 120, sw: 0.05, at: 0.012, a: 0.003, d: 0.03, g: 0.04 },
    ],
  },

  // ---- hand holds (climb:grab; by the hold's kind; panned to the hand; 'hash' of the hold position) ---------------------------
  'hold.stone': {
    bus: 'player', prio: 1, gap: 0.06, level: 0.5, send: 0.1, space: 'hand', vary: { rule: 'hash', n: 6, pitch: 0.06, level: 0.1 },
    note: 'a leather palm slapping masonry, a pinch of grit',
    layers: [
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 1400, q: 0.9, a: 0.002, d: 0.02, g: 0.45 },
      THUMP(130, 70, 0.35, 0.035),
      { t: 'ticks', src: 'white', f: 2200, f2: 5000, q: 4, n: [2, 3], span: 0.05, at: 0.01, d: 0.005, g: 0.15 },
    ],
  },
  'hold.ledge': {
    bus: 'player', prio: 1, gap: 0.06, level: 0.55, send: 0.1, space: 'hand', vary: { rule: 'hash', n: 6, pitch: 0.05, level: 0.1 },
    note: 'fingers hooking a ledge lip: a heavier slap, the weight coming on, grit',
    layers: [
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 1200, q: 0.9, a: 0.002, d: 0.025, g: 0.45 },
      THUMP(110, 55, 0.45, 0.05),
      { t: 'ticks', src: 'white', f: 1800, f2: 4600, q: 4, n: 4, span: 0.09, at: 0.015, d: 0.006, g: 0.18, falloff: 0.5 },
    ],
  },
  'hold.chain': {
    bus: 'player', prio: 1, gap: 0.06, level: 0.5, send: 0.12, space: 'hand', vary: { rule: 'hash', n: 6, pitch: 0.05, level: 0.08 },
    note: 'a glove closing on chain: a link clack and the next links answering',
    layers: [
      { t: 'modal', f: 1900, r: [1, 1.47, 2.31], m: [0.25, 0.14, 0.08], dk: [1, 0.7, 0.5], d: 0.05, g: 1 },
      { t: 'noise', src: 'white', ft: 'bandpass', f: 3400, q: 5, d: 0.06, g: 0.3 },
      { t: 'ticks', src: 'white', f: 2600, f2: 5200, q: 8, n: 3, span: 0.1, at: 0.01, d: 0.01, g: 0.25, falloff: 0.6 },
      THUMP(190, 70, 0.3, 0.03),
    ],
  },
  'hold.metal': {
    bus: 'player', prio: 1, gap: 0.06, level: 0.5, send: 0.12, space: 'hand', vary: { rule: 'hash', n: 6, pitch: 0.05, level: 0.08 },
    note: 'a glove on rebar: a dull bar note under the slap',
    layers: [
      { t: 'modal', f: 760, r: [1, 2.4, 4.1], m: [0.3, 0.12, 0.05], dk: [1, 0.7, 0.5], d: 0.06, g: 1 },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 1500, q: 1, a: 0.002, d: 0.02, g: 0.35 },
      THUMP(150, 70, 0.3, 0.03),
    ],
  },
  'hold.sinew': {
    bus: 'player', prio: 1, gap: 0.06, level: 0.8, send: 0.1, space: 'hand', vary: { rule: 'hash', n: 6, pitch: 0.07, level: 0.1, time: 0.2 },
    note: 'a hand sinking into grown sinew: a wet squeeze, the tissue giving, small wet clicks',
    layers: [
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 700, f2: 420, sw: 0.05, q: 2, a: 0.01, h: 0.05, d: 0.06, g: 0.4 },
      { t: 'tone', w: 'sine', f: 240, f2: 160, sw: 0.05, a: 0.008, d: 0.05, g: 0.12 },
      { t: 'ticks', src: 'pink', f: 500, f2: 1100, q: 3, n: 2, span: 0.12, at: 0.04, d: 0.012, g: 0.2 },
    ],
  },
  'hold.wet': {
    bus: 'player', prio: 1, gap: 0.06, level: 0.5, send: 0.14, space: 'hand', vary: { rule: 'hash', n: 6, pitch: 0.06, level: 0.1 },
    note: 'a palm on wet stone: the slap with water in it, a drop flicked off',
    layers: [
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 1100, q: 0.9, a: 0.002, d: 0.025, g: 0.4 },
      THUMP(125, 68, 0.3, 0.035),
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 1800, q: 1.4, at: 0.005, d: 0.04, g: 0.25 },
      { t: 'tone', w: 'sine', f: 900, f2: 1800, sw: 0.012, at: 0.05, a: 0.002, d: 0.02, g: 0.1 },
    ],
  },
  'climb.mantle': {
    bus: 'player', prio: 1, gap: 0.5, level: 0.5, send: 0.08, vary: { rule: 'cycle', n: 3, pitch: 0.04, time: 0.15 },
    note: 'hauling over the lip: jacket dragging on stone, a knee finding the ledge, a strained breath out',
    layers: [
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 1600, f2: 900, sw: 0.2, q: 0.8, a: 0.08, h: 0.2, d: 0.12, g: 0.25 },
      THUMP(100, 50, 0.4, 0.05),
      { t: 'ticks', src: 'white', f: 2000, f2: 4800, q: 4, n: 5, span: 0.35, at: 0.05, d: 0.006, g: 0.12, falloff: 0.4 },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 620, q: 3, at: 0.25, a: 0.04, h: 0.12, d: 0.12, g: 0.35 },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 1250, q: 4, at: 0.25, a: 0.04, h: 0.12, d: 0.1, g: 0.2 },
    ],
  },

  // ---- dropped consumables (prop:impact; k = speed along the normal 0.9..7 m/s; world; ≤ 3 at once) -------------------------
  'prop.case': {
    bus: 'player', prio: 0, gap: 0.05, level: [0.15, 0.5], send: 0.12, space: 'world', maxInst: 3, vary: { rule: 'hash', n: 8, pitch: 0.06, level: 0.1 },
    note: 'the tin first-aid case: a hollow box knock, its latch rattling',
    layers: [
      { t: 'modal', f: 340, r: [1, 1.58, 2.37], m: [0.45, 0.25, 0.12], dk: [1, 0.7, 0.5], d: [0.03, 0.06], g: 1 },
      { t: 'ticks', src: 'white', f: 2600, f2: 4800, q: 7, n: [1, 3], span: 0.06, at: 0.01, d: 0.006, g: 0.2 },
      { t: 'noise', src: 'brown', ft: 'lowpass', f: 500, q: 0, d: 0.02, g: 0.4 },
    ],
  },
  'prop.bandage': {
    bus: 'player', prio: 0, gap: 0.05, level: [0.12, 0.35], send: 0.08, space: 'world', maxInst: 3, vary: { rule: 'hash', n: 8, pitch: 0.08, level: 0.1 },
    note: 'a soft roll of cloth: a padded thud and a breath of fabric',
    layers: [
      { t: 'noise', src: 'brown', ft: 'lowpass', f: 420, q: 0, a: 0.003, d: 0.03, g: 0.7 },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 2200, q: 0.8, at: 0.005, d: 0.03, g: 0.15 },
    ],
  },
  'prop.syringe': {
    bus: 'player', prio: 0, gap: 0.05, level: [0.12, 0.4], send: 0.12, space: 'world', maxInst: 3, vary: { rule: 'hash', n: 8, pitch: 0.07, level: 0.1 },
    note: 'a glass-barrelled injector: a bright glassy tick that rings briefly',
    layers: [
      { t: 'modal', f: 2300, r: GLASS, m: [0.3, 0.16, 0.08, 0.04], dk: [1, 0.6, 0.4, 0.3], d: [0.03, 0.05], g: 1 },
      { t: 'noise', src: 'white', ft: 'highpass', f: 4000, q: 0, d: 0.004, g: 0.3 },
    ],
  },
  'prop.cell': {
    bus: 'player', prio: 0, gap: 0.05, level: [0.15, 0.45], send: 0.12, space: 'world', maxInst: 3, vary: { rule: 'hash', n: 8, pitch: 0.06, level: 0.1 },
    note: 'a spent lantern cell: a dense little metal clink, it rolls a moment',
    layers: [
      { t: 'modal', f: 1250, r: IRON, m: [0.35, 0.2, 0.1, 0.05], dk: [1, 0.6, 0.45, 0.3], d: [0.04, 0.07], g: 1 },
      { t: 'ticks', src: 'white', f: 3000, f2: 5000, q: 9, n: [1, 4], span: 0.25, at: 0.04, d: 0.006, g: 0.12, falloff: 0.6 },
    ],
  },

  // ---- the world ---------------------------------------------------------------------------------------------------------------
  'drip': {
    bus: 'ambient', prio: 0, gap: 0.12, level: 0.32, send: 0.45, space: 'world', maxInst: 2, occlude: false, vary: { rule: 'hash', n: 8, pitch: 0.12, level: 0.15 },
    note: 'one drop into a pool: the bloop rising, its little ring, the splash tick',
    layers: [
      { t: 'tone', w: 'sine', f: 1200, f2: 2600, sw: 0.01, a: 0.001, d: 0.025, g: 0.3 },
      { t: 'tone', w: 'sine', f: 900, at: 0.002, a: 0.002, d: 0.05, g: 0.08 },
      { t: 'noise', src: 'white', ft: 'bandpass', f: 3800, q: 6, d: 0.008, g: 0.1 },
    ],
  },
  'seal.land': {
    bus: 'ambient', prio: 2, gap: 0.5, level: 0.8, send: 0.45, space: 'world', floor: 0.45, vary: { rule: 'hash', n: 4, pitch: 0.03 },
    note: 'a seal plate dropping into its seat: a low boom, iron ringing, grit shaken off the walls',
    layers: [
      THUMP(62, 30, 0.8, 0.18),
      { t: 'noise', src: 'brown', ft: 'lowpass', f: 700, q: 0, d: 0.16, g: 0.6 },
      { t: 'modal', f: 120, r: IRON, m: IRON_M, dk: IRON_DK, d: 0.4, g: 0.6 },
      { t: 'ticks', src: 'white', f: 900, f2: 3600, q: 3, n: 12, span: 1.4, at: 0.15, d: 0.014, g: 0.25, falloff: 0.6 },
    ],
  },

  // ---- the lantern (electric: a cell and a filament) and the goggles -----------------------------------------------------------
  'lantern.low': {
    bus: 'stinger', prio: 2, gap: 1, level: 0.3, send: 0.15, vary: { rule: 'fixed', n: 1 },
    note: 'the filament stutters (buzz chopped at 9 Hz), then two falling pips: the cell is low',
    layers: [
      { t: 'noise', src: 'white', ft: 'bandpass', f: 120, q: 6, a: 0.01, h: 0.35, d: 0.08, g: 0.45, lfo: [9, 1] },
      { t: 'tone', w: 'sine', f: 880, at: 0.45, a: 0.01, h: 0.1, d: 0.04, g: 0.4 },
      { t: 'tone', w: 'sine', f: 660, at: 0.73, a: 0.01, h: 0.1, d: 0.04, g: 0.4 },
    ],
  },
  'lantern.empty': {
    bus: 'stinger', prio: 2, gap: 1, level: 0.32, send: 0.2, vary: { rule: 'fixed', n: 1 },
    note: 'the filament dies: a falling hum, a crackle, the last tick of the element cooling',
    layers: [
      { t: 'tone', w: 'sine', f: 330, f2: 110, sw: 0.35, a: 0.015, h: 0.5, d: 0.2, g: 0.45 },
      { t: 'noise', src: 'white', ft: 'bandpass', f: 120, q: 6, a: 0.01, h: 0.4, d: 0.1, g: 0.35, lfo: [14, 1] },
      { t: 'ticks', src: 'white', f: 2400, f2: 5200, q: 5, n: 6, span: 0.6, at: 0.1, d: 0.005, g: 0.2, falloff: 0.5 },
      { t: 'noise', src: 'white', ft: 'bandpass', f: 3500, q: 4, at: 1.05, a: 0.001, d: 0.006, g: 0.3 },
    ],
  },
  'lantern.flutter': {
    bus: 'player', prio: 0, gap: 0.6, level: [0.12, 0.26], vary: { rule: 'cycle', n: 8, pitch: 0.1, level: 0.15, time: 0.3 },
    note: 'while the cell is low: the filament flickering (a short chopped buzz), faster as it drains',
    layers: [
      { t: 'noise', src: 'white', ft: 'bandpass', f: 120, q: 7, a: 0.004, h: [0.08, 0.2], d: 0.03, g: 0.6, lfo: [[11, 17], 1] },
      { t: 'tone', w: 'sine', f: 240, a: 0.004, h: [0.06, 0.15], d: 0.02, g: 0.12 },
    ],
  },
  'lantern.chain': {
    bus: 'player', prio: 0, gap: 0.25, level: [0.08, 0.2], send: 0.05, maxInst: 1, vary: { rule: 'cycle', n: 6, pitch: 0.06, level: 0.1, time: 0.3 },
    note: 'the lantern swinging on its chain (jump, landing, a heavy catch): a few small links',
    layers: [
      { t: 'ticks', src: 'white', f: 3200, f2: 6400, q: 9, n: [2, 5], span: [0.08, 0.18], d: 0.01, g: 0.4, falloff: 0.5 },
      { t: 'modal', f: 2900, r: [1, 1.53], m: [0.15, 0.06], dk: [1, 0.6], at: 0.02, d: 0.03, g: 1 },
    ],
  },
  'lantern.refill': {
    bus: 'stinger', prio: 2, gap: 0.3, level: 0.4, send: 0.2, vary: { rule: 'fixed', n: 1 },
    note: 'a fresh cell: the contacts snap home, the filament hum rises to full, a warm note',
    layers: [
      { t: 'noise', src: 'white', ft: 'bandpass', f: 2600, q: 4, a: 0.001, d: 0.006, g: 0.5 },
      { t: 'noise', src: 'white', ft: 'bandpass', f: 1800, q: 4, at: 0.06, a: 0.001, d: 0.008, g: 0.35 },
      { t: 'tone', w: 'sine', f: 110, f2: 240, sw: 0.18, at: 0.1, a: 0.12, h: 0.3, d: 0.25, g: 0.25 },
      { t: 'tone', w: 'sine', f: 329.63, at: 0.35, a: 0.012, d: 0.35, g: 0.3 },
      { t: 'tone', w: 'sine', f: 493.88, at: 0.44, a: 0.012, d: 0.35, g: 0.22 },
    ],
  },
  'nv.low': {
    bus: 'ui', prio: 1, gap: 2, level: 0.35, vary: { rule: 'fixed', n: 1 },
    note: 'the goggles\' whine sagging: a thin tone dipping twice',
    layers: [
      { t: 'tone', w: 'sine', f: 6200, f2: 4800, sw: 0.08, a: 0.01, h: 0.08, d: 0.05, g: 0.12 },
      { t: 'tone', w: 'sine', f: 6000, f2: 4400, sw: 0.08, at: 0.28, a: 0.01, h: 0.08, d: 0.05, g: 0.12 },
    ],
  },
  'nv.flat': {
    bus: 'ui', prio: 2, gap: 1, level: 0.4, vary: { rule: 'fixed', n: 1 },
    note: 'the goggles die: the whine collapsing, a relay click',
    layers: [
      { t: 'tone', w: 'sine', f: 6000, f2: 700, sw: 0.15, a: 0.005, h: 0.1, d: 0.12, g: 0.14 },
      { t: 'noise', src: 'white', ft: 'bandpass', f: 2200, q: 4, at: 0.4, a: 0.001, d: 0.006, g: 0.4 },
    ],
  },
  'nv.ready': {
    bus: 'ui', prio: 1, gap: 1, level: 0.3, vary: { rule: 'fixed', n: 1 },
    note: 'the goggles recharged: two rising chirps',
    layers: [
      { t: 'tone', w: 'sine', f: 3000, f2: 4200, sw: 0.03, a: 0.004, d: 0.03, g: 0.18 },
      { t: 'tone', w: 'sine', f: 3600, f2: 5000, sw: 0.03, at: 0.12, a: 0.004, d: 0.04, g: 0.18 },
    ],
  },

  // ---- the bag: picking up (pickup:collect kind 0 kit, 1 bandage, 2 adrenaline, 3 cell) and using (bag:done) ---------------------
  'pickup.kit': {
    bus: 'player', prio: 1, gap: 0.05, level: 0.5, send: 0.3, vary: { rule: 'fixed', n: 1 },
    note: 'the tin case latch clicking + a low rising arpeggio (G)',
    layers: [
      { t: 'noise', src: 'white', ft: 'bandpass', f: 2400, q: 5, a: 0.001, d: 0.006, g: 0.4 },
      { t: 'modal', f: 340, r: [1, 1.58], m: [0.2, 0.1], dk: [1, 0.6], d: 0.04, g: 1 },
      { t: 'tone', w: 'sine', f: 392, at: 0.03, a: 0.006, d: 0.26, g: 0.32 },
      { t: 'tone', w: 'sine', f: 588, at: 0.075, a: 0.006, d: 0.22, g: 0.2 },
      { t: 'tone', w: 'sine', f: 784, at: 0.12, a: 0.006, d: 0.16, g: 0.1 },
    ],
  },
  'pickup.bandage': {
    bus: 'player', prio: 1, gap: 0.05, level: 0.5, send: 0.3, vary: { rule: 'fixed', n: 1 },
    note: 'a cloth roll pocketed (fabric brush) + a soft arpeggio (C)',
    layers: [
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 3200, q: 1.2, a: 0.01, h: 0.04, d: 0.05, g: 0.15 },
      { t: 'tone', w: 'sine', f: 523.25, at: 0.02, a: 0.006, d: 0.26, g: 0.3 },
      { t: 'tone', w: 'sine', f: 784.9, at: 0.065, a: 0.006, d: 0.22, g: 0.18 },
      { t: 'tone', w: 'sine', f: 1051.7, at: 0.11, a: 0.006, d: 0.16, g: 0.09 },
    ],
  },
  'pickup.adrenaline': {
    bus: 'player', prio: 1, gap: 0.05, level: 0.5, send: 0.3, vary: { rule: 'fixed', n: 1 },
    note: 'a glass injector clinks in the pouch + a bright triangle arpeggio (G5)',
    layers: [
      { t: 'modal', f: 2300, r: GLASS, m: [0.2, 0.1, 0.05, 0.02], dk: [1, 0.6, 0.4, 0.3], d: 0.05, g: 1 },
      { t: 'tone', w: 'triangle', f: 784, at: 0.03, a: 0.006, d: 0.26, g: 0.3 },
      { t: 'tone', w: 'triangle', f: 1176, at: 0.075, a: 0.006, d: 0.22, g: 0.18 },
      { t: 'tone', w: 'triangle', f: 1576, at: 0.12, a: 0.006, d: 0.16, g: 0.08 },
    ],
  },
  'pickup.cell': {
    bus: 'player', prio: 1, gap: 0.05, level: 0.5, send: 0.3, vary: { rule: 'fixed', n: 1 },
    note: 'a lantern cell: a metal snap + an arpeggio (A)',
    layers: [
      { t: 'noise', src: 'white', ft: 'bandpass', f: 5200, q: 1.2, a: 0.001, d: 0.012, g: 0.3 },
      { t: 'modal', f: 1250, r: [1, 2.32], m: [0.15, 0.06], dk: [1, 0.6], d: 0.04, g: 1 },
      { t: 'tone', w: 'sine', f: 440, at: 0.02, a: 0.006, d: 0.26, g: 0.32 },
      { t: 'tone', w: 'sine', f: 660, at: 0.065, a: 0.006, d: 0.22, g: 0.2 },
      { t: 'tone', w: 'sine', f: 884, at: 0.11, a: 0.006, d: 0.16, g: 0.1 },
    ],
  },
  'bag.done.kit': {
    bus: 'stinger', prio: 2, gap: 0.05, level: 0.36, send: 0.35, vary: { rule: 'fixed', n: 1 },
    note: 'the kit used: two latches shut, a slow warm G major (relief)',
    layers: [
      { t: 'noise', src: 'white', ft: 'bandpass', f: 2400, q: 5, a: 0.001, d: 0.006, g: 0.4 },
      { t: 'noise', src: 'white', ft: 'bandpass', f: 2100, q: 5, at: 0.07, a: 0.001, d: 0.006, g: 0.35 },
      { t: 'tone', w: 'sine', f: 196, at: 0.12, a: 0.012, d: 0.6, g: 0.4 },
      { t: 'tone', w: 'sine', f: 246.94, at: 0.21, a: 0.012, d: 0.6, g: 0.4 },
      { t: 'tone', w: 'sine', f: 392, at: 0.3, a: 0.012, d: 0.6, g: 0.4 },
    ],
  },
  'bag.done.bandage': {
    bus: 'stinger', prio: 2, gap: 0.05, level: 0.36, send: 0.3, vary: { rule: 'fixed', n: 1 },
    note: 'the bandage tied off: a tape tear, the knot pulled tight, a soft fifth',
    layers: [
      { t: 'noise', src: 'white', ft: 'bandpass', f: 2600, f2: 4200, sw: 0.08, q: 1.5, a: 0.01, h: 0.12, d: 0.03, g: 0.3, lfo: [38, 0.8] },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 900, q: 1.5, at: 0.2, a: 0.02, h: 0.04, d: 0.04, g: 0.3 },
      { t: 'tone', w: 'sine', f: 261.63, at: 0.26, a: 0.012, d: 0.35, g: 0.3 },
      { t: 'tone', w: 'sine', f: 392, at: 0.35, a: 0.012, d: 0.35, g: 0.3 },
    ],
  },
  'bag.done.adrenaline': {
    bus: 'stinger', prio: 2, gap: 0.05, level: 0.36, send: 0.35, vary: { rule: 'fixed', n: 1 },
    note: 'the injector empties: the heart kicks twice, the blood rushing up (a rising band)',
    layers: [
      THUMP(70, 38, 0.8, 0.1),
      { t: 'tone', w: 'sine', f: 70, f2: 38, sw: 0.035, at: 0.2, a: 0.002, d: 0.1, g: 0.55 },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 600, f2: 3200, sw: 0.4, q: 0.6, a: 0.3, h: 0.2, d: 0.3, g: 0.3 },
    ],
  },
  // (bag.done.battery is the lantern refill: lantern.refill)

  // ---- the body: hurt, healed, low, recovered ------------------------------------------------------------------------------------
  'hurt.blunt': {
    bus: 'player', prio: 3, gap: 0.1, level: [0.5, 0.66], send: [0.1, 0.2], vary: { rule: 'cycle', n: 4, pitch: 0.05, level: 0.05 },
    note: 'a fall / wall / rockfall blow: deep body thump + dull crack + the breath knocked out (formant grunt) at higher damage',
    layers: [
      THUMP(78, 32, [0.55, 1], [0.12, 0.26]),
      { t: 'noise', src: 'brown', ft: 'lowpass', f: [220, 720], q: 0, a: 0.003, d: [0.08, 0.18], g: [0.5, 0.9] },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 700, q: 0.9, d: 0.03, g: [0.16, 0.36] },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 540, q: 4, at: 0.04, a: 0.015, h: 0.07, d: 0.06, g: 0.5, minK: 0.3 },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 1150, q: 5, at: 0.04, a: 0.015, h: 0.06, d: 0.05, g: 0.3, minK: 0.3 },
      { t: 'tone', w: 'triangle', f: 120, f2: 82, sw: 0.06, at: 0.04, a: 0.015, h: 0.05, d: 0.05, g: 0.08, minK: 0.3 },
    ],
  },
  'hurt.cut': {
    bus: 'player', prio: 3, gap: 0.1, level: [0.5, 0.78], send: [0.1, 0.2], vary: { rule: 'cycle', n: 4, pitch: 0.05, level: 0.05 },
    note: 'a hazard / bite: a tearing rasp over the body blow, a sharp intake of breath',
    layers: [
      THUMP(80, 36, [0.45, 0.85], [0.1, 0.2]),
      { t: 'noise', src: 'white', ft: 'bandpass', f: 1800, f2: 900, sw: 0.06, q: 1.4, a: 0.003, h: 0.04, d: 0.05, g: [0.25, 0.45], lfo: [60, 0.7] },
      { t: 'noise', src: 'brown', ft: 'lowpass', f: [260, 640], q: 0, d: [0.07, 0.14], g: [0.4, 0.7] },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 2400, f2: 1600, sw: 0.1, q: 3, at: 0.08, a: 0.04, h: 0.05, d: 0.06, g: 0.3, minK: 0.3 },
    ],
  },
  'heal': {
    bus: 'stinger', prio: 1, gap: 0.8, level: 0.22, send: 0.4, vary: { rule: 'fixed', n: 1 },
    note: 'health restored: a long easing breath out and a warm low fifth swelling under it',
    layers: [
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 900, f2: 500, sw: 0.4, q: 1.2, a: 0.15, h: 0.3, d: 0.3, g: 0.35 },
      { t: 'tone', w: 'sine', f: 130.81, a: 0.3, h: 0.4, d: 0.5, g: 0.35 },
      { t: 'tone', w: 'sine', f: 196, at: 0.15, a: 0.3, h: 0.3, d: 0.5, g: 0.25 },
    ],
  },
  'health.low': {
    bus: 'psych', prio: 2, gap: 4, level: 0.4, send: 0.3, vary: { rule: 'fixed', n: 1 },
    note: 'crossing into low health: a cold falling minor second and the blood loud in the ears',
    layers: [
      { t: 'tone', w: 'sine', f: 233.08, f2: 220, sw: 0.6, a: 0.05, h: 0.5, d: 0.4, g: 0.3 },
      { t: 'tone', w: 'sine', f: 246.94, f2: 233.08, sw: 0.6, a: 0.05, h: 0.5, d: 0.4, g: 0.2 },
      { t: 'noise', src: 'brown', ft: 'lowpass', f: 180, q: 0, a: 0.3, h: 0.5, d: 0.5, g: 0.6, lfo: [1.6, 0.8] },
    ],
  },
  'health.recover': {
    bus: 'psych', prio: 1, gap: 3, level: 0.6, send: 0.3, vary: { rule: 'fixed', n: 1 },
    note: 'out of danger: one deep breath in and out',
    layers: [
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 700, f2: 1300, sw: 0.4, q: 1, a: 0.4, h: 0.2, d: 0.15, g: 0.3 },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 1100, f2: 500, sw: 0.5, q: 1, at: 0.9, a: 0.1, h: 0.4, d: 0.3, g: 0.35 },
    ],
  },

  // ---- progress stingers ---------------------------------------------------------------------------------------------------------
  'checkpoint': {
    bus: 'stinger', prio: 1, gap: 1, level: 0.24, send: 0.45, vary: { rule: 'cycle', n: 2, pitch: 0, level: 0 },
    note: 'a low struck bell (G3 + D4 with bell partials) and a breath of relief',
    layers: [
      { t: 'modal', f: 196, r: BELL, m: BELL_M, dk: [1, 0.6, 0.4, 0.25], a: 0.004, d: 0.6, g: 0.45 },
      { t: 'modal', f: 293.66, r: BELL, m: BELL_M, dk: [1, 0.6, 0.4, 0.25], at: 0.12, a: 0.004, d: 0.55, g: 0.28 },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 800, f2: 500, sw: 0.4, q: 1.2, at: 0.2, a: 0.2, h: 0.2, d: 0.3, g: 0.12 },
    ],
  },
  'objective.done': {
    bus: 'stinger', prio: 2, gap: 1, level: 0.42, send: 0.45, vary: { rule: 'fixed', n: 1 },
    note: 'a mechanism unlocks: a heavy bolt clunk, chains paying out, a resolved open fifth',
    layers: [
      THUMP(70, 36, 0.7, 0.12),
      { t: 'modal', f: 160, r: IRON, m: IRON_M, dk: IRON_DK, d: 0.25, g: 0.5 },
      { t: 'ticks', src: 'white', f: 1800, f2: 4000, q: 7, n: 10, span: 0.7, at: 0.12, d: 0.012, g: 0.18, falloff: 0.3 },
      { t: 'tone', w: 'sine', f: 110, at: 0.5, a: 0.15, h: 0.4, d: 0.6, g: 0.3 },
      { t: 'tone', w: 'sine', f: 164.81, at: 0.6, a: 0.15, h: 0.35, d: 0.6, g: 0.22 },
    ],
  },
  'medal.gold': {
    bus: 'ui', prio: 1, gap: 1, level: 0.42, send: 0.3, vary: { rule: 'fixed', n: 1 },
    note: 'a section under par: three bright bell notes rising (A E A)',
    layers: [
      { t: 'modal', f: 440, r: BELL, m: BELL_M, dk: [1, 0.6, 0.4, 0.25], d: 0.35, g: 0.3 },
      { t: 'modal', f: 659.26, r: BELL, m: BELL_M, dk: [1, 0.6, 0.4, 0.25], at: 0.14, d: 0.35, g: 0.28 },
      { t: 'modal', f: 880, r: BELL, m: BELL_M, dk: [1, 0.6, 0.4, 0.25], at: 0.28, d: 0.5, g: 0.3 },
    ],
  },
  'medal.silver': {
    bus: 'ui', prio: 1, gap: 1, level: 0.38, send: 0.3, vary: { rule: 'fixed', n: 1 },
    note: 'two bell notes (A E)',
    layers: [
      { t: 'modal', f: 440, r: BELL, m: BELL_M, dk: [1, 0.6, 0.4, 0.25], d: 0.35, g: 0.3 },
      { t: 'modal', f: 659.26, r: BELL, m: BELL_M, dk: [1, 0.6, 0.4, 0.25], at: 0.14, d: 0.45, g: 0.28 },
    ],
  },
  'medal.brass': {
    bus: 'ui', prio: 1, gap: 1, level: 0.36, send: 0.3, vary: { rule: 'fixed', n: 1 },
    note: 'one warm low bell (A3)',
    layers: [{ t: 'modal', f: 220, r: BELL, m: BELL_M, dk: [1, 0.6, 0.4, 0.25], d: 0.5, g: 0.4 }],
  },

  // ---- the jetpack (refinements layered on the legacy roar / cough) --------------------------------------------------------------
  'jet.flutter': {
    bus: 'player', prio: 2, gap: 0.1, level: 0.4, send: 0.15, maxInst: 1, vary: { rule: 'cycle', n: 4, pitch: 0.05 },
    note: 'combustion chugging inside the roar (low band noise chopped at 22-26 Hz); killed at the cut',
    layers: [
      { t: 'noise', src: 'brown', ft: 'bandpass', f: 180, q: 1.6, a: 0.06, h: 2.4, d: 0.08, g: 0.7, lfo: [24, 0.85] },
      { t: 'noise', src: 'white', ft: 'highpass', f: 5200, q: 0, a: 0.1, h: 2.3, d: 0.08, g: 0.06 },
    ],
  },
  'jet.valve': {
    bus: 'player', prio: 2, gap: 0.2, level: 0.45, send: 0.2, vary: { rule: 'cycle', n: 4, pitch: 0.05 },
    note: 'the cut: the valve clacks shut, the last gas hissing out, the nozzle ticking as it cools',
    layers: [
      { t: 'noise', src: 'white', ft: 'bandpass', f: 2200, q: 4, a: 0.001, d: 0.008, g: 0.45 },
      THUMP(140, 70, 0.3, 0.03),
      { t: 'noise', src: 'white', ft: 'bandpass', f: 4200, f2: 1800, sw: 0.3, q: 0.9, at: 0.01, a: 0.005, d: 0.2, g: 0.25 },
      { t: 'ticks', src: 'white', f: 3600, f2: 6200, q: 10, n: 5, span: 1.4, at: 0.35, d: 0.004, g: 0.14, falloff: 0.5 },
    ],
  },

  // ---- the creatures: proximity / notice cues (no rig clip covers these) -------------------------------------------------------
  'creature.stare': {
    bus: 'creature', prio: 3, gap: 4, level: 0.45, send: 0.4, space: 'world', preset: 'bed', floor: 0.4, vary: { rule: 'fixed', n: 1 },
    note: 'the Mason sees you: a sub swell from nothing, stone plates settling one by one, a held low cluster',
    layers: [
      { t: 'tone', w: 'sine', f: 41, a: 0.8, h: 0.8, d: 0.5, g: 0.6 },
      { t: 'tone', w: 'sine', f: 43.5, a: 0.8, h: 0.8, d: 0.5, g: 0.45 },
      { t: 'ticks', src: 'brown', rate: 1.6, f: 300, f2: 900, q: 3, n: 5, span: 1.4, at: 0.3, d: 0.03, g: 0.5, falloff: -0.3 },
      { t: 'noise', src: 'brown', ft: 'lowpass', f: 240, q: 2, a: 0.6, h: 0.6, d: 0.6, g: 0.35 },
    ],
  },
  'creature.annoyed': {
    bus: 'creature', prio: 3, gap: 1.5, level: 0.7, send: 0.3, space: 'world', floor: 0.5, vary: { rule: 'cycle', n: 4, pitch: 0.06, time: 0.2 },
    note: 'a hook hit its body: a stone clack and an angry chitter burst',
    layers: [
      { t: 'modal', f: 820, r: BONE, m: [0.35, 0.14, 0.06], dk: [1, 0.6, 0.4], d: 0.03, g: 1 },
      { t: 'ticks', src: 'white', f: 1200, f2: 3400, q: 6, n: 16, span: 0.5, at: 0.05, d: 0.006, g: 0.45, falloff: 0.3 },
      { t: 'noise', src: 'brown', ft: 'bandpass', f: 220, q: 2, at: 0.05, a: 0.05, h: 0.2, d: 0.15, g: 0.5, lfo: [31, 0.8] },
    ],
  },
  'holdfast.aware': {
    bus: 'creature', prio: 2, gap: 2, level: 0.45, send: 0.35, space: 'world', floor: 0.3, vary: { rule: 'hash', n: 4, pitch: 0.05, time: 0.2 },
    note: 'the wall notices you: stone shifting in its bed, two wet knuckle settles',
    layers: [
      { t: 'noise', src: 'brown', ft: 'bandpass', f: 260, f2: 180, sw: 0.3, q: 2, a: 0.1, h: 0.3, d: 0.2, g: 0.5 },
      { t: 'modal', f: 1100, r: BONE, m: [0.25, 0.1, 0.05], dk: [1, 0.6, 0.4], at: 0.35, d: 0.025, g: 1 },
      { t: 'modal', f: 980, r: BONE, m: [0.22, 0.08, 0.04], dk: [1, 0.6, 0.4], at: 0.62, d: 0.025, g: 1 },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 600, q: 3, at: 0.35, a: 0.01, d: 0.06, g: 0.2 },
    ],
  },
  'holdfast.outpull': {
    bus: 'creature', prio: 3, gap: 1, level: 0.75, send: 0.3, space: 'world', floor: 0.55, vary: { rule: 'cycle', n: 3, pitch: 0.04 },
    note: 'the rope out-pulls the wall: stone fingers torn open (a cracking rip), the line twanging free',
    layers: [
      { t: 'noise', src: 'brown', ft: 'bandpass', f: 500, f2: 1400, sw: 0.12, q: 1.5, a: 0.01, h: 0.15, d: 0.08, g: 0.6, lfo: [40, 0.7] },
      { t: 'ticks', src: 'white', f: 1200, f2: 4200, q: 4, n: 10, span: 0.4, d: 0.008, g: 0.35, falloff: 0.5 },
      { t: 'tone', w: 'triangle', f: 240, f2: 180, sw: 0.2, at: 0.18, a: 0.003, d: 0.2, g: 0.18 },
      THUMP(80, 40, 0.5, 0.08),
    ],
  },
  'dresser.appear': {
    bus: 'creature', prio: 2, gap: 3, level: 0.4, send: 0.5, space: 'world', preset: 'bed', floor: 0.25, vary: { rule: 'fixed', n: 1 },
    note: 'the Dresser arrives, far off: three measured chalk taps and a breath of cloth',
    layers: [
      { t: 'modal', f: 1700, r: BONE, m: [0.3, 0.1, 0.04], dk: [1, 0.6, 0.4], d: 0.02, g: 1 },
      { t: 'modal', f: 1700, r: BONE, m: [0.3, 0.1, 0.04], dk: [1, 0.6, 0.4], at: 0.42, d: 0.02, g: 1 },
      { t: 'modal', f: 1700, r: BONE, m: [0.3, 0.1, 0.04], dk: [1, 0.6, 0.4], at: 0.84, d: 0.02, g: 1 },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 2600, q: 0.8, at: 1.0, a: 0.15, h: 0.1, d: 0.15, g: 0.12 },
    ],
  },

  // ---- the menus (ui:click {kind}, ui:move) ---------------------------------------------------------------------------------------
  'ui.move': {
    bus: 'ui', prio: 0, gap: 0.03, level: 0.22, vary: { rule: 'cycle', n: 2, pitch: 0.03, level: 0 },
    note: 'focus moves: a tiny glass tick',
    layers: [
      { t: 'tone', w: 'sine', f: 2300, a: 0.001, d: 0.008, g: 0.25 },
      { t: 'noise', src: 'white', ft: 'highpass', f: 6000, q: 0, a: 0.001, d: 0.003, g: 0.06 },
    ],
  },
  'ui.select': {
    bus: 'ui', prio: 1, gap: 0.03, level: 0.45, vary: { rule: 'fixed', n: 1 },
    note: 'confirm: a mechanical click, then two notes up a fifth',
    layers: [
      { t: 'noise', src: 'white', ft: 'bandpass', f: 3500, q: 2, a: 0.001, d: 0.004, g: 0.2 },
      { t: 'tone', w: 'triangle', f: 880, a: 0.002, d: 0.03, g: 0.3 },
      { t: 'tone', w: 'sine', f: 1320, at: 0.04, a: 0.002, d: 0.06, g: 0.25 },
    ],
  },
  'ui.back': {
    bus: 'ui', prio: 1, gap: 0.03, level: 0.4, vary: { rule: 'fixed', n: 1 },
    note: 'back: the same two notes falling',
    layers: [
      { t: 'noise', src: 'white', ft: 'bandpass', f: 3000, q: 2, a: 0.001, d: 0.004, g: 0.18 },
      { t: 'tone', w: 'sine', f: 1320, a: 0.002, d: 0.03, g: 0.25 },
      { t: 'tone', w: 'triangle', f: 880, at: 0.045, a: 0.002, d: 0.05, g: 0.28 },
    ],
  },
  'ui.toggle': {
    bus: 'ui', prio: 1, gap: 0.03, level: 0.6, vary: { rule: 'alt', n: 2, pitch: 0.06, level: 0 },
    note: 'a tab / switch: a two-part latch (on and off alternate a whole tone)',
    layers: [
      { t: 'noise', src: 'white', ft: 'bandpass', f: 2400, q: 4, a: 0.001, d: 0.005, g: 0.35 },
      { t: 'noise', src: 'white', ft: 'bandpass', f: 1700, q: 4, at: 0.028, a: 0.001, d: 0.005, g: 0.25 },
      { t: 'tone', w: 'sine', f: 600, a: 0.002, d: 0.02, g: 0.1 },
    ],
  },
  'ui.slide': {
    bus: 'ui', prio: 0, gap: 0.025, level: 0.2, vary: { rule: 'cycle', n: 8, pitch: 0.1, level: 0 },
    note: 'a slider step: a detent tick that walks up and down a little scale',
    layers: [{ t: 'tone', w: 'sine', f: 1800, a: 0.001, d: 0.005, g: 0.25 }],
  },
  'ui.start': {
    bus: 'ui', prio: 2, gap: 0.3, level: 0.5, send: 0.3, vary: { rule: 'fixed', n: 1 },
    note: 'starting a run: the lantern wick taking (a soft whump) under a low open fifth',
    layers: [
      { t: 'noise', src: 'brown', ft: 'lowpass', f: 400, q: 0, a: 0.01, d: 0.2, g: 0.5 },
      { t: 'noise', src: 'pink', ft: 'bandpass', f: 1200, f2: 600, sw: 0.1, q: 1, a: 0.01, d: 0.08, g: 0.2 },
      { t: 'tone', w: 'sine', f: 110, a: 0.02, h: 0.1, d: 0.3, g: 0.4 },
      { t: 'tone', w: 'sine', f: 165, at: 0.05, a: 0.02, h: 0.1, d: 0.3, g: 0.3 },
    ],
  },
  'ui.error': {
    bus: 'ui', prio: 1, gap: 0.2, level: 0.35, vary: { rule: 'fixed', n: 1 },
    note: 'refused: two low buzzes falling a minor third',
    layers: [
      { t: 'tone', w: 'square', f: 180, a: 0.002, h: 0.04, d: 0.03, g: 0.12 },
      { t: 'tone', w: 'square', f: 151, at: 0.09, a: 0.002, h: 0.05, d: 0.04, g: 0.12 },
    ],
  },
  ...KNOCKER_RECIPES,
};

// ===========================================================================
// Lookups (no string building per event)
// ===========================================================================
const STEP = ['step.stone', 'step.metal', 'step.grate', 'step.wet', 'step.debris'];
const LAND = ['land.stone', 'land.metal', 'land.grate', 'land.wet', 'land.debris'];
const HOOK = ['hook.stone', 'hook.metal', 'hook.grate', 'hook.wet', 'hook.debris'];
const PROP = ['prop.case', 'prop.bandage', 'prop.syringe', 'prop.cell'];
const PICK = ['pickup.kit', 'pickup.bandage', 'pickup.adrenaline', 'pickup.cell'];
const DONE = ['bag.done.kit', 'bag.done.bandage', 'bag.done.adrenaline', 'lantern.refill'];
const HOLD = { masonry: 'hold.stone', ledge: 'hold.ledge', chain: 'hold.chain', rebar: 'hold.metal', sinew: 'hold.sinew' };
const MEDAL = { gold: 'medal.gold', silver: 'medal.silver', brass: 'medal.brass' };
/** ui:click kinds (ui3d.js passes the button's data-action; 'back' / 'move' / 'slide' / 'error' directly). */
export const UI_KIND = Object.freeze({
  move: 'ui.move',
  back: 'ui.back',
  slide: 'ui.slide',
  error: 'ui.error',
  start: 'ui.start',
  'start-diff': 'ui.start',
  'continue-run': 'ui.start',
  'next-chapter': 'ui.start',
  sandbox: 'ui.start',
  tab: 'ui.toggle',
  'rec-tab': 'ui.toggle',
  difficulty: 'ui.toggle',
  'set-chapter': 'ui.toggle',
  toggle: 'ui.toggle',
});

function sectionOf(E) {
  const g = E.host && E.host._game;
  return g && typeof g.sectionIndex === 'number' ? g.sectionIndex | 0 : -1;
}

/** Where a payload is (x,y,z) → o; false when it has no finite position. */
function place(o, p) {
  o.x = num(p.x, NaN);
  o.y = num(p.y, NaN);
  o.z = num(p.z, NaN);
  return o.x === o.x && o.y === o.y && o.z === o.z;
}

/** The surface under the player's feet (footsteps, landings). */
export function surfaceUnder(game) {
  const P = game && game.player;
  if (!P) return SURF.STONE;
  const kind = P.groundSolid && P.groundSolid.kind;
  const si = game && typeof game.sectionIndex === 'number' ? game.sectionIndex | 0 : -1;
  return surfaceAt(kind, si, P.x, P.y, P.z);
}

/** The material a hook bit into: forged rings / hooks, else the solid behind a surface anchor, else the patch. */
export function hookMaterial(anchor, section) {
  const an = anchor || {};
  if (an.kind === 'ring' || an.kind === 'hook') return -1; // forged ring
  if (an.kind === 'fragile') return SURF.DEBRIS;
  const s = an.solid;
  return surfaceAt(s && s.kind, an.section >= 0 ? an.section : section, num(an.x, 0), num(an.y, 0), num(an.z, 0));
}

// ===========================================================================
// HOOKS: events the host's legacy handlers forward (AudioManager3D._sfxTake). Return false to let the legacy sound play.
// ===========================================================================
export const HOOKS = {
  'step'(p, E) {
    const g = E.host._game;
    const s = surfaceUnder(g);
    const st = E.state;
    st.foot = st.foot === 1 ? -1 : 1;
    const o = E.opts();
    o.pan = st.foot * 0.1;
    E.play(STEP[s], clamp01(num(p.k, 0.5)), o);
    return true;
  },
  'player:land'(p, E) {
    let ratio = num(p.lethalRatio, NaN);
    if (!(ratio === ratio)) ratio = num(p.impact, 0) / 17;
    if (!(ratio >= 0.12)) return true; // too soft to hear over the steps (as before)
    const k = smooth(0.12, 1, ratio);
    const g = E.host._game;
    const P = g && g.player;
    const s = P ? surfaceAt(P.groundSolid && P.groundSolid.kind, sectionOf(E), num(p.x, P.x), num(p.y, P.y), num(p.z, P.z)) : SURF.STONE;
    E.play(LAND[s], k, null);
    if (k > 0.25) E.play('lantern.chain', k, null);
    return true;
  },
  'grapple:attach'(p, E) {
    const an = p.anchor || {};
    const m = hookMaterial(an, sectionOf(E));
    const o = E.opts();
    if (!place(o, p) && !place(o, an)) o.dist = 8;
    o.key = hashPos(o.x, o.y, o.z, 0.5) ^ hashStr(an.id || '');
    o.hand = p.hand || '';
    const heavy = smooth(380 / 60, 1250 / 60, num(p.speed, 0));
    E.play(m < 0 ? 'hook.ring' : HOOK[m], heavy, o);
    if (heavy > 0.5) E.play('lantern.chain', heavy, null);
    return true;
  },
  'grapple:miss'(p, E) {
    const o = E.opts();
    o.hand = p.hand || '';
    if (p.fell && place(o, p)) {
      o.key = hashPos(o.x, o.y, o.z, 0.5);
      E.play('miss.fall', 0.5, o);
    } else {
      E.play('miss.short', 0.5, o);
    }
    return true;
  },
  'grapple:break'(p, E) {
    const o = E.opts();
    if (!place(o, p)) o.dist = 6;
    o.key = hashPos(o.x, o.y, o.z, 0.5);
    E.play(p.cut ? 'rope.cut' : 'rope.snap', 1, o);
    return true;
  },
  'rope:jolt'(p, E) {
    E.play('rope.jolt', smooth(12, 26, num(p.speed, 14)), null);
    return true;
  },
  'climb:grab'(p, E) {
    const o = E.opts();
    o.hand = p.hand || '';
    o.key = hashPos(num(p.x, 0), num(p.y, 0), num(p.z, 0), 0.25);
    const id = p.wet && (p.kind === 'masonry' || p.kind === 'ledge' || !p.kind) ? 'hold.wet' : HOLD[p.kind] || 'hold.stone';
    E.play(id, 0.5, o);
    return true;
  },
  'pickup:collect'(p, E) {
    const k = num(p.kind, 1) | 0;
    E.play(PICK[k >= 0 && k < 4 ? k : 1], 0.5, null);
    return true;
  },
  'bag:done'(p, E) {
    const k = num(p.kind, 1) | 0;
    E.play(DONE[k >= 0 && k < 4 ? k : 1], 0.5, null);
    return true;
  },
  'lantern:low'(p, E) {
    E.play('lantern.low', 0.5, null);
    return true;
  },
  'lantern:empty'(p, E) {
    E.play('lantern.empty', 0.5, null);
    return true;
  },
  'health:damage'(p, E) {
    const a = clamp01(num(p.amount, 0.1));
    const c = p.cause;
    E.play(c === 'fall' || c === 'wall' || c === 'rockfall' || !c ? 'hurt.blunt' : 'hurt.cut', smooth(0.02, 0.6, a), null);
    return true;
  },
  'checkpoint'(p, E) {
    E.play('checkpoint', 0.5, null);
    return true;
  },
  'ui:click'(p, E) {
    E.play(UI_KIND[p.kind] || 'ui.select', 0.5, null);
    return true;
  },
};

// ===========================================================================
// ROUTES: events the engine subscribes to itself (no legacy sound: new, or a layer on top of the legacy one)
// ===========================================================================
export const ROUTES = {
  'ui:move'(p, E) {
    E.play('ui.move', 0.5, null);
  },
  'prop:impact'(p, E) {
    const o = E.opts();
    if (!place(o, p)) return;
    o.key = hashPos(o.x, o.y, o.z, 0.15);
    const k = num(p.kind, 0) | 0;
    E.play(PROP[k >= 0 && k < 4 ? k : 0], smooth(0.9, 7, num(p.speed, 1)), o);
  },
  'detail:drip'(p, E) {
    const o = E.opts();
    if (!place(o, p)) return;
    o.key = hashPos(o.x, o.y, o.z, 0.3);
    E.play('drip', 0.5, o);
  },
  'rope:dry'(p, E) {
    const o = E.opts();
    o.hand = p.hand || '';
    E.play('launcher.dry', 0.5, o);
  },
  'climb:mantle'(p, E) {
    E.play('climb.mantle', 0.5, null);
  },
  'seal:land'(p, E) {
    const o = E.opts();
    if (!place(o, p)) o.dist = 20;
    o.key = hashStr(p.id || '');
    E.play('seal.land', 0.5, o);
  },
  'objective:done'(p, E) {
    E.play('objective.done', 0.5, null);
  },
  'split'(p, E) {
    const id = MEDAL[p.medal];
    if (id && p.recorded !== false) E.play(id, 0.5, null);
  },
  'health:heal'(p, E) {
    E.play('heal', clamp01(num(p.amount, 0.3)), null);
  },
  'health:low'(p, E) {
    E.play('health.low', 0.5, null);
  },
  'health:recover'(p, E) {
    if (p.full) return; // only the moment the danger ends, not topping up to full
    E.play('health.recover', 0.5, null);
  },
  'nv:low'(p, E) {
    E.play('nv.low', 0.5, null);
  },
  'nv:flat'(p, E) {
    E.play('nv.flat', 0.5, null);
  },
  'nv:ready'(p, E) {
    E.play('nv.ready', 0.5, null);
  },
  'player:jump'(p, E) {
    E.play('lantern.chain', 0.4, null);
  },
  'jetpack:ignite'(p, E) {
    stopVoice(E, 'jetV');
    E.state.jetV = E.play('jet.flutter', 0.5, null);
  },
  'jetpack:cut'(p, E) {
    stopVoice(E, 'jetV');
    if (!p || p.reason !== 'fuel') E.play('jet.valve', 0.5, null); // a dry tank coughs instead (legacy)
  },
  'player:death'(p, E) {
    stopVoice(E, 'jetV');
  },
  'creature:stare'(p, E) {
    const o = E.opts();
    if (!place(o, p)) o.dist = num(p.distance, 40);
    E.play('creature.stare', 0.5, o);
  },
  'creature:annoyed'(p, E) {
    const o = E.opts();
    if (!place(o, p)) o.dist = num(p.distance, 20);
    E.play('creature.annoyed', 0.5, o);
  },
  'holdfast:aware'(p, E) {
    const o = E.opts();
    if (!place(o, p)) o.dist = num(p.distance, 6);
    o.key = hashPos(o.x, o.y, o.z, 1);
    E.play('holdfast.aware', 0.5, o);
  },
  'holdfast:outpull'(p, E) {
    const o = E.opts();
    if (!place(o, p)) o.dist = 1.5;
    E.play('holdfast.outpull', 0.5, o);
  },
  'dresser:appear'(p, E) {
    const o = E.opts();
    if (!place(o, p)) o.dist = num(p.distance, 40);
    E.play('dresser.appear', 0.5, o);
  },
  ...KNOCKER_ROUTES,
};

function stopVoice(E, key) {
  const v = E.state[key];
  E.state[key] = null;
  const h = E.host;
  if (v && v.alive && !v.dying && h && h.ctx && typeof h._kill === 'function') h._kill(v, h.ctx.currentTime, 0.05);
}

/**
 * Per-frame logic (called from AudioManager3D._update with the game): the lantern's flicker while the cell is low.
 * Allocation-free; the interval follows the charge and the designed VAR table, never a random draw.
 */
export function updateBank(E, dt, game) {
  const h = E.host;
  const st = E.state;
  const bag = game && game.bag;
  if (!bag || !bag.lanternLow || !(bag.lanternCharge > 0) || h._dead || h._pauseFlag || h._state !== 'playing') {
    st.flutterT = 1.5;
    return;
  }
  st.flutterT = (st.flutterT || 0) - dt;
  if (st.flutterT > 0) return;
  const low = 0.15;
  const f = clamp01(bag.lanternCharge / low); // 1 just under the warning .. 0 empty
  const n = (st.flutterN = ((st.flutterN | 0) + 1) & 7);
  st.flutterT = (1.4 + 7 * f) * (1 + 0.3 * VAR[n]);
  E.play('lantern.flutter', 1 - f, null);
}

// ===========================================================================
// Captions for the newly voiced events (captions.js merges these; same frozen shape as its rules)
// ===========================================================================
const C = (text, kind, sev, group, cd) => Object.freeze({ text, kind, sev, group, cd, ttl: 3.2 });
export const SFX_CAPTIONS = Object.freeze({
  'grapple:miss': C('[Hook clatters, no bite]', 'player', 0, 'sfx-miss', 1.2),
  'lantern:empty': C('[Lantern dies]', 'player', 2, 'lantern', 6),
  'rope:dry': C('[Launcher clicks, still charging]', 'player', 0, 'sfx-dry', 2),
  'objective:done': C('[A mechanism unlocks]', 'world', 1, 'sfx-obj', 2),
  'checkpoint': C('[A low bell: checkpoint]', 'world', 0, 'sfx-check', 4),
  'health:heal': C('[You breathe easier]', 'player', 0, 'sfx-heal', 3),
  'nv:flat': C('[Goggles die]', 'player', 1, 'nv', 2),
  'creature:stare': C('[Something is watching you]', 'creature', 2, 'sfx-stare', 6),
  'creature:annoyed': C('[Angry chittering]', 'creature', 2, 'sfx-annoyed', 3),
  'holdfast:aware': C('[Stone shifts in the wall]', 'creature', 1, 'sfx-hf-aware', 4),
  'holdfast:outpull': C('[Stone fingers torn open]', 'creature', 1, 'sfx-hf-out', 2),
  'dresser:appear': C('[Chalk tapping, far off]', 'creature', 1, 'sfx-dresser', 6),
});
export const SFX_CAPTION_EVENTS = Object.freeze(Object.keys(SFX_CAPTIONS));

/** Every event the designed bank voices (hooked + routed), for the tests and the audit table. */
export const SFX_EVENTS = Object.freeze([...Object.keys(HOOKS), ...Object.keys(ROUTES)]);

/** The bank as SfxEngine takes it. */
/** The routes' small memory, with every field declared up front (stable shape: no allocation when the numbers change). */
function makeState() {
  return { foot: 1, jetV: null, flutterT: 1.5, flutterN: 0 };
}

export const SFX_BANK = Object.freeze({ RECIPES, HOOKS, ROUTES, UPDATE: updateBank, STATE: makeState });

/*
 * Bus contract for the 'roach:*' critters (owned by the critter module; nothing here plays them). Suggested payloads:
 *   'roach:spawn'   { id, x, y, z }                 'roach:skitter' { id, x, y, z, speed }   (speed m/s; k = speed / 3)
 *   'roach:flee'    { id, x, y, z }                 'roach:squash'  { id, x, y, z }
 * To voice them: audio.registerSfx('roach.skitter', recipe) and audio.registerSfxRoute('roach:skitter', (p, E) => {
 *   const o = E.opts(); o.x = p.x; o.y = p.y; o.z = p.z; o.key = p.id | 0; E.play('roach.skitter', p.speed / 3, o); }).
 */
