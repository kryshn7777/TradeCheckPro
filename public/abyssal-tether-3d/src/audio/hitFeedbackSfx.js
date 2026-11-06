/* THE LANTERN (ABYSSAL TETHER 3D) — audio/hitFeedbackSfx.js
 * HIT FEEDBACK (plans/HIT_FEEDBACK.md): the designed sounds of being hit, through the SFX engine's extension points (audio3d.js
 * registerSfx / registerSfxRoute, SFX_DESIGN.md §6). Pure data + routes: deterministic ('fixed' variation, no random calls),
 * allocation-free (the engine's reused opts()). Node-importable.
 *
 *   'hit.ring'   the tinnitus after a blow: a sine pair (3.3 kHz + 4.1 kHz) with a partial 3 Hz off the first (a slow beating wobble)
 *                under a 0.7 Hz tremolo; 8 ms attack, ~2.5 s decay at k = 1 (a Mason hit), shorter and quieter at low k (a skitterling
 *                bite 0.3, the 'gentle' Mason 0.55). On the UI bus: head-locked and NOT behind the world muffle it rings over.
 *   'hit.thump'  the body blow under it: a 90 -> 45 Hz drop, a brown-noise impact, a 55 Hz tail (player bus: muffled with the world)
 *   'hit.gasp'   the strained breath in as he gets up (player:rise): two noise bands, a breath not a voice
 *
 * Routes: 'hit:ring' { source, k } (hitFeedbackGlue.js emits it on every player:hit, with k from the source and the setting) plays the
 * ring + the thump; 'player:rise' plays the gasp. holdHitMuffle(audio, m) closes the world's existing low-pass ('muffle', the one a
 * death / a big hit already closes) to 1.4 kHz x m for this frame: the smallest public hook on audio3d's hurt-muffle clock, kept here so
 * audio3d.js is not edited (it reads `_hitT` once a frame: cutoff 1400 Hz at >= 1, open at 0).
 * Hearing safety: every recipe peaks <= -12 dBFS before the master chain (tests: offline render), then the engine's compressor,
 * limiter and soft clip; the master / effects volume and a mute apply (the buses).
 */

export const RING_SFX_ID = 'hit.ring';
export const THUMP_SFX_ID = 'hit.thump';
export const GASP_SFX_ID = 'hit.gasp';

export const RING_RECIPE = Object.freeze({
  bus: 'ui',
  prio: 2,
  gap: 0.5,
  level: [0.05, 0.2],
  send: 0,
  space: 'head',
  maxInst: 1,
  vary: Object.freeze({ rule: 'fixed', n: 1, pitch: 0, level: 0, time: 0 }),
  note: 'tinnitus after a blow: a high sine pair ringing with a slow wobble, fading over two seconds',
  layers: Object.freeze([
    // the ring: 3.3 kHz, a slow tremolo (the wobble)
    Object.freeze({ t: 'tone', w: 'sine', f: 3300, a: 0.008, h: [0.05, 0.25], d: [0.16, 0.5], g: 0.5, lfo: Object.freeze([0.7, 0.3]) }),
    // 3 Hz off it: the two beat (a slow, uneasy wobble in the pitch)
    Object.freeze({ t: 'tone', w: 'sine', f: 3303, a: 0.012, h: [0.04, 0.2], d: [0.14, 0.45], g: 0.32 }),
    // the upper partial, dying a little sooner
    Object.freeze({ t: 'tone', w: 'sine', f: 4100, a: 0.008, h: [0.03, 0.15], d: [0.1, 0.36], g: 0.26 }),
  ]),
});

export const THUMP_RECIPE = Object.freeze({
  bus: 'player',
  prio: 2,
  gap: 0.3,
  level: [0.1, 0.3],
  send: 0.04,
  space: 'head',
  maxInst: 1,
  vary: Object.freeze({ rule: 'fixed', n: 1, pitch: 0, level: 0, time: 0 }),
  note: 'the blow landing on the body: a deep drop, a dull impact, a low tail',
  layers: Object.freeze([
    Object.freeze({ t: 'tone', w: 'sine', f: 90, f2: 45, sw: 0.06, a: 0.004, d: 0.16, g: 0.55 }),
    Object.freeze({ t: 'noise', src: 'brown', ft: 'lowpass', f: 320, q: 0.8, a: 0.003, d: 0.09, g: 0.5 }),
    Object.freeze({ t: 'tone', w: 'sine', f: 55, at: 0.02, a: 0.02, h: 0.04, d: 0.25, g: 0.3 }),
  ]),
});

export const GASP_RECIPE = Object.freeze({
  bus: 'player',
  prio: 1,
  gap: 1,
  level: 0.22,
  send: 0.05,
  space: 'head',
  maxInst: 1,
  vary: Object.freeze({ rule: 'cycle', n: 3, pitch: 0.04, level: 0.08, time: 0.1 }),
  note: 'getting up: a strained breath in through the teeth, then out',
  layers: Object.freeze([
    // the breath in: a hissing band rising
    Object.freeze({ t: 'noise', src: 'pink', ft: 'bandpass', f: 900, f2: 1700, sw: 0.25, q: 2.2, a: 0.12, h: 0.12, d: 0.08, g: 0.5 }),
    // and out, lower and breathier
    Object.freeze({ t: 'noise', src: 'pink', ft: 'bandpass', f: 700, f2: 420, sw: 0.3, q: 1.4, at: 0.42, a: 0.06, h: 0.1, d: 0.22, g: 0.42 }),
  ]),
});

/** Route: 'hit:ring' { source, k }: the ring at k, the thump under it (a Mason's blow full, a bite small). */
export function hitRingRoute(p, E) {
  const k = p && typeof p.k === 'number' && p.k === p.k ? p.k : 1;
  E.play(RING_SFX_ID, k, E.opts());
  E.play(THUMP_SFX_ID, p && p.source === 'skitter' ? 0.25 : 1, E.opts());
}

/** Route: 'player:rise': the breath as he gets up. */
export function hitGaspRoute(p, E) {
  E.play(GASP_SFX_ID, 0.6, E.opts());
}

/** Adds the recipes and the routes to the game's audio (once). Returns true when the engine took them. */
export function registerHitFeedbackSfx(audio) {
  if (!audio || typeof audio.registerSfx !== 'function' || typeof audio.registerSfxRoute !== 'function') return false;
  const a = audio.registerSfx(RING_SFX_ID, RING_RECIPE);
  const b = audio.registerSfx(THUMP_SFX_ID, THUMP_RECIPE);
  const c = audio.registerSfx(GASP_SFX_ID, GASP_RECIPE);
  if (!a || !b || !c) return false;
  audio.registerSfxRoute('hit:ring', hitRingRoute);
  audio.registerSfxRoute('player:rise', hitGaspRoute);
  return true;
}

/**
 * Holds the world muffle at m (0 open .. 1 closed to 1.4 kHz) for this frame (call every frame while it should hold; it eases back by
 * itself when the calls stop). Never opens a muffle someone else closed (a death, the engine's own big-hit ring). Returns true when set.
 */
export function holdHitMuffle(audio, m) {
  if (!audio || !(m > 0)) return false;
  const v = (m < 1 ? m : 1) + 0.02; // the engine counts its clock down by one frame before it reads it
  const cur = typeof audio._hitT === 'number' && audio._hitT === audio._hitT ? audio._hitT : 0;
  if (v > cur) audio._hitT = v;
  return true;
}
