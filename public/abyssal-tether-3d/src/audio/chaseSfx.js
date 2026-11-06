/* THE LANTERN — audio/chaseSfx.js
 * THE CHASE ARC (plans/CHASE_ARC.md): the two designed sounds of a Mason chase, in the sfxBank.js format (SFX_DESIGN.md §c.1):
 *
 *   chase.pulse    'chase:start', 'chase:pulse' {k}   the heartbeat in your ears: a low lub-dub thud (a sine kick with a body of brown
 *                                                     noise, the dub a little lower and softer) and the blood rushing behind it;
 *                                                     k 0..1 = how near the Mason is (louder, a touch brighter). Head-locked.
 *   chase.exhale   'chase:lost' {duration}            the release: a long, shaky breath out (two bands of pink noise falling, a slow
 *                                                     tremor on them, a chest of brown noise) and a quiet falling tone under it; k grows
 *                                                     with the chase's length (a long chase, a heavier breath). Head-locked.
 *
 * Both are 'fixed' (one designed sound each, no variation: the heartbeat must read as the same heart). registerChaseSfx(audio) adds the
 * recipes and the three routes through the engine's extension points (audio3d.js registerSfx / registerSfxRoute); without the engine
 * (no audio, a test double) it does nothing. Pure data + small routes: Node-importable, no Math.random, the engine's reused opts().
 */

export const CHASE_PULSE_ID = 'chase.pulse';
export const CHASE_EXHALE_ID = 'chase.exhale';

export const CHASE_PULSE_RECIPE = Object.freeze({
  bus: 'psych',
  prio: 1,
  gap: 0.3,
  level: Object.freeze([0.3, 0.5]),
  send: 0.08,
  space: 'head',
  maxInst: 2,
  vary: Object.freeze({ rule: 'fixed', n: 1 }),
  note: 'the chase heartbeat: a low lub-dub thud in the ears, the blood rushing behind it (louder as the Mason nears)',
  layers: Object.freeze([
    // lub
    Object.freeze({ t: 'tone', w: 'sine', f: 64, f2: 41, sw: 0.03, a: 0.004, d: 0.09, g: 1 }),
    Object.freeze({ t: 'noise', src: 'brown', ft: 'lowpass', f: Object.freeze([120, 170]), q: 0, a: 0.005, d: 0.06, g: 0.55 }),
    // dub (0.22 s later, lower and softer)
    Object.freeze({ t: 'tone', w: 'sine', f: 56, f2: 37, sw: 0.03, at: 0.22, a: 0.004, d: 0.08, g: 0.7 }),
    Object.freeze({ t: 'noise', src: 'brown', ft: 'lowpass', f: Object.freeze([110, 150]), q: 0, at: 0.22, a: 0.005, d: 0.05, g: 0.35 }),
    // the blood in the ears: a soft low band swelling through the beat
    Object.freeze({ t: 'noise', src: 'pink', ft: 'bandpass', f: Object.freeze([260, 380]), q: 1.2, a: 0.06, h: 0.12, d: 0.12, g: Object.freeze([0.08, 0.16]) }),
  ]),
});

export const CHASE_EXHALE_RECIPE = Object.freeze({
  bus: 'psych',
  prio: 2,
  gap: 3,
  level: Object.freeze([0.34, 0.46]),
  send: 0.22,
  space: 'head',
  maxInst: 1,
  vary: Object.freeze({ rule: 'fixed', n: 1 }),
  note: 'the release after a chase: a long shaky breath out, two falling bands with a tremor, a chest under them, a quiet falling tone',
  layers: Object.freeze([
    // the breath: a mouth band falling, shaking (slow tremor)
    Object.freeze({ t: 'noise', src: 'pink', ft: 'bandpass', f: 1150, f2: 520, sw: 0.9, q: 1.1, a: 0.18, h: Object.freeze([0.7, 1.0]), d: 0.42, g: 0.5, lfo: Object.freeze([7.5, 0.45]) }),
    // the hiss on top, falling with it, a faster flutter
    Object.freeze({ t: 'noise', src: 'pink', ft: 'bandpass', f: 2500, f2: 1300, sw: 0.8, q: 2, at: 0.05, a: 0.2, h: 0.6, d: 0.35, g: 0.18, lfo: Object.freeze([11, 0.35]) }),
    // the chest emptying
    Object.freeze({ t: 'noise', src: 'brown', ft: 'lowpass', f: 300, f2: 180, sw: 1, q: 0, a: 0.22, h: 0.6, d: 0.45, g: 0.32 }),
    // the falling band under it all: relief, not triumph
    Object.freeze({ t: 'tone', w: 'sine', f: 98, f2: 73.4, sw: 1.2, at: 0.1, a: 0.4, h: 0.5, d: 0.7, g: 0.12 }),
  ]),
});

const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** chase:start / chase:pulse: the heartbeat (k from the payload, a start beats at 0.6). */
export function chasePulseRoute(p, E) {
  const o = E.opts();
  E.play(CHASE_PULSE_ID, clamp01(num(p && p.k, 0.6)), o);
}

/** chase:lost: the exhale; k = 0.3 + the chase's length / 30 s (a long chase, a heavier breath). */
export function chaseExhaleRoute(p, E) {
  const o = E.opts();
  E.play(CHASE_EXHALE_ID, clamp01(0.3 + num(p && p.duration, 0) / 30), o);
}

/** Adds the recipes and the routes to the game's audio (once). Returns true when the engine took them. */
export function registerChaseSfx(audio) {
  if (!audio || typeof audio.registerSfx !== 'function' || typeof audio.registerSfxRoute !== 'function') return false;
  const a = audio.registerSfx(CHASE_PULSE_ID, CHASE_PULSE_RECIPE);
  const b = audio.registerSfx(CHASE_EXHALE_ID, CHASE_EXHALE_RECIPE);
  if (!a || !b) return false;
  audio.registerSfxRoute('chase:start', chasePulseRoute);
  audio.registerSfxRoute('chase:pulse', chasePulseRoute);
  audio.registerSfxRoute('chase:lost', chaseExhaleRoute);
  return true;
}
