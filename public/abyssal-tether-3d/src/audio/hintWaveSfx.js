/* THE LANTERN (ABYSSAL TETHER 3D) — hintWaveSfx.js
 * The sound of THE GOLDEN MARK's blip wave (sim/hintWave.js): a soft two-layer sonar ping, a pitched glass / wood tick with a short
 * shimmering tail, placed AT the mark (HRTF, distance, air absorption, occlusion: the designed-SFX engine, audio/sfxDesign.js) and
 * played when the wave's front reaches the player (game.js emits `hint:wave:pass` then, so the player hears it arrive from the
 * mark's direction). Registered by game.js through audio.registerSfx / audio.registerSfxRoute (SFX_DESIGN.md §6).
 * Deterministic: a round-robin over four designed variants; no Math.random. Pure data + one routing function.
 */

export const HINT_BLIP_ID = 'hint.blip';
export const HINT_BLIP_EVENT = 'hint:wave:pass';

export const HINT_BLIP_RECIPE = Object.freeze({
  bus: 'stinger',
  prio: 1,
  gap: 2.5, // never two blips closer than this (stage 3 waves are 8 s apart)
  level: [0.3, 0.4], // k = 0 stage 2 .. 1 stage 3
  send: 0.5,
  space: 'world',
  floor: 0.38, // a far mark still reads
  maxInst: 1,
  vary: { rule: 'cycle', n: 4, pitch: 0.025, level: 0.05, time: 0.08 },
  note: 'the golden mark answers: a glass-and-wood tick, one soft sine ping and its shimmer an octave and a fifth above',
  layers: [
    // 1. the tick: a small struck glass bar over a dry wood knock
    { t: 'modal', f: 1568, r: [1, 2.71, 5.12], m: [0.5, 0.18, 0.06], dk: [1, 0.6, 0.35], d: 0.05, g: 0.8 },
    { t: 'noise', src: 'pink', ft: 'bandpass', f: 900, q: 3, a: 0.001, d: 0.012, g: 0.25 },
    // 2. the ping and its shimmer: a sine bloom with a slow tremolo, the octave and the twelfth fading faster
    { t: 'tone', w: 'sine', f: 784, f2: 776, sw: 0.4, a: 0.006, h: 0.03, d: 0.38, g: 0.55, lfo: [5.5, 0.18] },
    { t: 'tone', w: 'sine', f: 1568, at: 0.012, a: 0.01, d: 0.26, g: 0.16, lfo: [7.3, 0.3] },
    { t: 'tone', w: 'sine', f: 2352, at: 0.02, a: 0.015, d: 0.2, g: [0.05, 0.09], lfo: [9.1, 0.35] },
  ],
});

const num = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

/** The route: the blip at the mark (payload x, y, z, stage). */
export function hintBlipRoute(p, E) {
  const o = E.opts();
  o.x = num(p.x, NaN);
  o.y = num(p.y, NaN);
  o.z = num(p.z, NaN);
  if (!(o.x === o.x && o.y === o.y && o.z === o.z)) o.dist = 20;
  E.play(HINT_BLIP_ID, p.stage >= 3 ? 1 : 0, o);
}
