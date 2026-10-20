/* ABYSSAL TETHER 3D — dsp3d.js
 * Pure, DOM-free and Web-Audio-free helpers shared by the audio modules (ambience3d, music3d, ropeFx3d,
 * movement3d, creatureSync3d), so the maths can be unit-tested in Node:
 *   - seeded random numbers (deterministic scores and impulse responses),
 *   - the per-section ambience table (S1-S8) and the section reverb spec sized from the shaft,
 *   - IRBuilder: an incremental generator of a stereo room impulse response (spread over control ticks, no hitch),
 *   - the rope friction / haptic curves,
 *   - the footstep surface classifier.
 */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export function smooth(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}
export const lerp = (a, b, t) => a + (b - a) * t;

/** Small seeded generator (mulberry32). Returns () => [0,1). */
export function rng32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ===========================================================================
// Section ambience (S1-S8). Complements SECTION_SOUND in audio3d.js (wind, pad, rumble, room).
//   open  authored openness 0..1 (the live value follows level.raycast when a level is available)
//   wet   reverb wet level at openness 0.5
//   wetness  surface wetness 0..1 (footsteps: puddles; drips)
//   drone {tone, metal, organ, hum, lp, form, beat, lvl}: the low room-tone bank (see Ambience.build)
//   ev    average events per minute: drip, deep (cistern plonk), groan (machinery), iron, chain, slurp, sinew
//   scale overall event density (the Vault is "too quiet")
//   shaft [width, depth, height] in metres (reverb size when the level section is unavailable)
// ===========================================================================
export const SECTION_BEDS = [
  // 1 The Threshold: airy, a thin bell of iron, dripping.
  { open: 0.55, wet: 0.22, wetness: 0.1, drone: { tone: 0.5, metal: 0.25, organ: 0, hum: 0, lp: 520, form: 260, beat: 0.35, lvl: 0.7 }, ev: { drip: 10, deep: 1, groan: 1.5, iron: 3, chain: 0, slurp: 0, sinew: 0 }, scale: 1, shaft: [22, 22, 48] },
  // 2 The Long Swing: huge drop, chains swaying in the wind.
  { open: 0.85, wet: 0.3, wetness: 0.15, drone: { tone: 0.55, metal: 0.3, organ: 0, hum: 0.1, lp: 480, form: 230, beat: 0.5, lvl: 0.8 }, ev: { drip: 5, deep: 1, groan: 3, iron: 3, chain: 5, slurp: 0, sinew: 0 }, scale: 1, shaft: [45, 22, 50] },
  // 3 Broken Gallery: failing stonework.
  { open: 0.6, wet: 0.3, wetness: 0.3, drone: { tone: 0.5, metal: 0.2, organ: 0.05, hum: 0, lp: 430, form: 210, beat: 0.6, lvl: 0.8 }, ev: { drip: 7, deep: 1.5, groan: 2, iron: 3, chain: 1, slurp: 0, sinew: 0 }, scale: 1, shaft: [45, 22, 40] },
  // 4 The Listening Vault: vast and too quiet; a held breath of a room.
  { open: 0.9, wet: 0.42, wetness: 0.2, drone: { tone: 0.35, metal: 0.15, organ: 0.2, hum: 0, lp: 360, form: 190, beat: 0.25, lvl: 0.55 }, ev: { drip: 8, deep: 3, groan: 1, iron: 1, chain: 0, slurp: 0.2, sinew: 0 }, scale: 0.6, shaft: [45, 22, 52] },
  // 5 The Gullet Stair: narrow, organic.
  { open: 0.25, wet: 0.3, wetness: 0.5, drone: { tone: 0.35, metal: 0.05, organ: 0.55, hum: 0, lp: 330, form: 180, beat: 0.9, lvl: 0.9 }, ev: { drip: 6, deep: 1, groan: 2, iron: 2, chain: 0, slurp: 5, sinew: 4 }, scale: 1, shaft: [18, 18, 54] },
  // 6 The Two Descents: machinery over wet stone.
  { open: 0.6, wet: 0.34, wetness: 0.6, drone: { tone: 0.4, metal: 0.2, organ: 0.35, hum: 0.55, lp: 300, form: 170, beat: 0.7, lvl: 0.9 }, ev: { drip: 6, deep: 1, groan: 5, iron: 4, chain: 2, slurp: 4, sinew: 4 }, scale: 1, shaft: [44, 22, 80] },
  // 7 The Hollow Nave: a cathedral void; the walls sing.
  { open: 1.0, wet: 0.46, wetness: 0.4, drone: { tone: 0.45, metal: 0.3, organ: 0.6, hum: 0.2, lp: 280, form: 150, beat: 0.45, lvl: 1.0 }, ev: { drip: 2, deep: 3, groan: 4, iron: 2, chain: 3, slurp: 3, sinew: 4 }, scale: 1, shaft: [80, 80, 136] },
  // 8 The Last Throat: lowest, wettest, the most alive.
  { open: 0.35, wet: 0.36, wetness: 0.7, drone: { tone: 0.3, metal: 0.1, organ: 0.8, hum: 0.25, lp: 250, form: 140, beat: 1.2, lvl: 1.0 }, ev: { drip: 3, deep: 1, groan: 4, iron: 3, chain: 0, slurp: 8, sinew: 7 }, scale: 1, shaft: [40, 40, 142] },
];

/** Reverb spec for a section (level section object or just the index): rt60, early-reflection taps, damping. */
export function reverbSpec(index, section, reduced) {
  const i = clamp(index | 0, 0, SECTION_BEDS.length - 1);
  const bed = SECTION_BEDS[i];
  let W = bed.shaft[0];
  let D = bed.shaft[1];
  let H = bed.shaft[2];
  const sh = section && section.shaft;
  if (sh && isFinite(sh.maxX - sh.minX) && isFinite(sh.maxZ - sh.minZ)) {
    W = Math.max(4, sh.maxX - sh.minX);
    D = Math.max(4, sh.maxZ - sh.minZ);
    if (isFinite(section.yTop - section.yBottom)) H = Math.max(6, section.yTop - section.yBottom);
  }
  const charLen = Math.cbrt(W * D * Math.min(H, 45));
  const rt = clamp(0.12 * Math.pow(charLen, 0.9), 0.9, 4.6);
  const capLen = reduced ? 1.5 : 3.4;
  const len = clamp(rt * 0.85, 0.7, capLen);
  // First reflections off the nearest walls for a listener a little off-centre (seconds, gains).
  const taps = [];
  const c = 343;
  const dists = [W * 0.38, W * 0.62, D * 0.45, D * 0.55, Math.min(H, 30) * 0.5, W * 0.9, D * 0.9];
  for (let k = 0; k < dists.length; k++) taps.push([(2 * dists[k]) / c, (0.55 / (1 + k * 0.45)) * (k % 2 ? -1 : 1)]);
  const damp = clamp(0.25 + 0.55 * bed.wet + 0.15 * bed.wetness, 0, 1);
  return { index: i, rt, len, taps, damp, seed: 9173 + i * 101, size: charLen };
}

/**
 * Incremental stereo impulse-response generator. step(n) renders up to n samples per channel (call it from
 * control ticks so no frame pays for the whole buffer); done when `finished`. Decorrelated noise per channel with a
 * one-pole low-pass that darkens over time (high frequencies die first), a density build-up, and the early taps.
 */
export class IRBuilder {
  constructor(sampleRate, spec) {
    this.sr = sampleRate;
    this.spec = spec;
    this.len = Math.max(256, Math.floor(spec.len * sampleRate));
    this.L = new Float32Array(this.len);
    this.R = new Float32Array(this.len);
    this.i = 0;
    this.finished = false;
    this._sl = (spec.seed * 2654435761) >>> 0 || 1;
    this._sr = (spec.seed * 40503 + 977) >>> 0 || 7;
    this._yl = 0;
    this._yr = 0;
    this._decay = Math.exp(-6.9078 / (spec.rt * sampleRate));
    this._env = 1;
    this._bd = Math.exp(-1 / ((0.018 + 0.012 * spec.rt) * sampleRate));
    this._build = 1;
    this._ad = Math.exp(-1 / (spec.rt * 0.5 * sampleRate));
    this._aEx = 1;
    this._a1 = lerp(0.2, 0.05, spec.damp);
    this._a0 = 0.7;
    this._fadeStart = Math.floor(this.len * 0.82);
    const pre = Math.floor(Math.min(0.03, spec.taps[0][0] * 0.5) * sampleRate);
    this._pre = pre;
    // Early reflections (different per ear: the right ear gets them a hair later and a touch softer).
    for (let k = 0; k < spec.taps.length; k++) {
      const n = Math.floor(spec.taps[k][0] * sampleRate) + pre;
      if (n < this.len - 8) {
        this.L[n] += spec.taps[k][1];
        this.R[n + 3 + (k % 3)] += spec.taps[k][1] * 0.85;
      }
    }
  }

  step(budget) {
    if (this.finished) return true;
    const n = Math.min(budget | 0, this.len - this.i);
    const L = this.L;
    const R = this.R;
    let i = this.i;
    let sl = this._sl;
    let sr = this._sr;
    let yl = this._yl;
    let yr = this._yr;
    let env = this._env;
    let bld = this._build;
    let aex = this._aEx;
    const dec = this._decay;
    const bd = this._bd;
    const ad = this._ad;
    const a1 = this._a1;
    const a0 = this._a0 - a1;
    const pre = this._pre;
    const fs = this._fadeStart;
    const tail = this.len - fs;
    for (let k = 0; k < n; k++, i++) {
      sl ^= sl << 13;
      sl ^= sl >>> 17;
      sl ^= sl << 5;
      sr ^= sr << 13;
      sr ^= sr >>> 17;
      sr ^= sr << 5;
      const nl = (sl >>> 0) / 2147483648 - 1;
      const nr = (sr >>> 0) / 2147483648 - 1;
      const a = a1 + a0 * aex;
      yl += a * (nl - yl);
      yr += a * (nr - yr);
      if (i >= pre) {
        let g = env * (1 - bld);
        if (i > fs) g *= 0.5 + 0.5 * Math.cos(((i - fs) / tail) * Math.PI);
        L[i] += yl * g;
        R[i] += yr * g;
        env *= dec;
        bld *= bd;
      }
      aex *= ad;
    }
    this.i = i;
    this._sl = sl;
    this._sr = sr;
    this._yl = yl;
    this._yr = yr;
    this._env = env;
    this._build = bld;
    this._aEx = aex;
    if (i >= this.len) this._finish();
    return this.finished;
  }

  /** Renders everything now (the first section at unlock, tests). */
  all() {
    while (!this.finished) this.step(1 << 16);
    return this;
  }

  _finish() {
    // Unit energy per channel (the convolver is created with normalize = false), and a short fade-in against clicks.
    let eL = 0;
    let eR = 0;
    for (let i = 0; i < this.len; i++) {
      eL += this.L[i] * this.L[i];
      eR += this.R[i] * this.R[i];
    }
    const e = (eL + eR) * 0.5;
    const k = e > 1e-12 ? 1 / Math.sqrt(e) : 1;
    for (let i = 0; i < this.len; i++) {
      this.L[i] *= k;
      this.R[i] *= k;
    }
    this.finished = true;
  }
}

// ===========================================================================
// Rope friction (continuous layer) and its matching haptic buzz
// ===========================================================================
export const ROPE_FX = {
  slipMin: 0.6, // m/s: below this the clutch is holding (CONFIG.rope.slipFxMin)
  slipFull: 8, // m/s: full friction (CONFIG.rope.slipFxSpeed)
  loadMin: 1.2, // load (in g) below which the line is slack-ish
  loadFull: 4.2, // load (g) of the winch limit
};

/**
 * Friction layer targets from the line's pay-out speed (m/s, slip clutch + winch reel-out) and its load (g).
 * Writes {amp 0..1, speed 0..1, load 0..1, hum 0..1} into `out`.
 */
export function ropeLayer(payout, loadG, out) {
  const sp = smooth(ROPE_FX.slipMin * 0.5, ROPE_FX.slipFull, payout);
  const ld = smooth(ROPE_FX.loadMin * 0.4, ROPE_FX.loadFull, loadG);
  out.speed = sp;
  out.load = ld;
  out.amp = sp * (0.35 + 0.65 * ld);
  // A taut line sings: grows with the load, quietly (the hum is a cue, not a layer to listen to).
  out.hum = smooth(1.6, ROPE_FX.loadFull + 0.8, loadG) * 0.8;
  return out;
}

/**
 * Continuous controller buzz while the clutch pays line out (0 when holding). `phase` (seconds) adds a small
 * rasp so successive pulses do not feel like a constant rumble. Shared by the audio layer and game.js.
 */
export function ropeHaptic(slipSpeed, loadG, phase) {
  if (!(slipSpeed > ROPE_FX.slipMin)) return 0;
  const sp = smooth(ROPE_FX.slipMin, ROPE_FX.slipFull, slipSpeed);
  const ld = smooth(ROPE_FX.loadMin * 0.4, ROPE_FX.loadFull, loadG);
  const rasp = 1 + 0.14 * Math.sin((phase || 0) * 47);
  return clamp((0.16 + 0.6 * sp * (0.5 + 0.5 * ld)) * rasp, 0, 0.85);
}

// ===========================================================================
// Footsteps
// ===========================================================================
export const SURFACE = { STONE: 0, IRON: 1, WET: 2, WOOD: 3 };

/** Surface under the feet: the solid's kind (+ the section's wetness) → SURFACE.*. `roll` is a [0,1) random. */
export function surfaceOf(kind, wetness, roll) {
  if (kind === 'metal' || kind === 'grate' || kind === 'bridge') return SURFACE.IRON;
  if (wetness > 0.05 && roll < wetness * 0.85) return SURFACE.WET;
  return SURFACE.STONE;
}

/** Index of the section for a world y when the level is unavailable (the authored y ranges). */
const SECTION_BOTTOMS = [-8, -58, -98, -150, -204, -284, -420, -562];
export function sectionOfY(y) {
  for (let i = 0; i < SECTION_BOTTOMS.length; i++) if (y >= SECTION_BOTTOMS[i]) return i;
  return SECTION_BOTTOMS.length - 1;
}

// ===========================================================================
// Music theory
// ===========================================================================
// The five-note motif, in semitones above the section root (phrygian colour: the flat sixth leaning on the fifth):
//   5 - b6 - 5 - 3(b3) - 1   ("B C B G E" over E)
export const MOTIF = {
  steps: [7, 8, 7, 3, 0],
  dur: [2.1, 1.7, 2.3, 2.1, 4.2], // seconds between note onsets
  vel: [0.8, 0.6, 0.7, 0.85, 1.0],
};
export const PHRYGIAN = [0, 1, 3, 5, 7, 8, 10];

export function semitone(root, st) {
  return root * Math.pow(2, st / 12);
}
