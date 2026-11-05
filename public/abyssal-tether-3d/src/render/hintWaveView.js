/* THE LANTERN (ABYSSAL TETHER 3D) — hintWaveView.js
 * Draws THE GOLDEN MARK's blip wave (sim/hintWave.js): it costs no draw call and no texture: it writes the shared PING uniforms
 * that every lit surface program reads (render/materials.js PING / PING_FRAG), so the wave washes over the walls, ledges, floors and
 * props it passes in both eyes alike. Idle = uPingK.y 0 (the shader skips the chunk on one uniform branch).
 * Also the pulse of the mark itself while a wave leaves it (`originGlow`, read by render/objectiveHintView.js).
 */
import { PING } from './materials.js';
import { STRENGTH_CAP } from '../sim/hintWave.js';

/** Linear emissive radiance of the band at strength 1 (tuned on the S1 / deep captures; the grade and the tone mapper follow). */
export const PING_GAIN = 1.25;
/** Ripple frequency of the wake (rad / m: rings about 4 m apart). */
export const PING_RIPPLE = 1.6;

/**
 * Writes the wave into the shared uniforms. Allocation-free.
 * @param {object|null} w HintWave.wave (or null: idle)
 * @param {number} [gain] PING_GAIN
 */
export function applyPing(w, gain = PING_GAIN) {
  const P = PING.uPing.value;
  const K = PING.uPingK.value;
  if (!w || !w.active || !(w.strength > 0)) {
    K.y = 0;
    return 0;
  }
  const s = Math.min(STRENGTH_CAP, w.strength) * gain;
  P.set(w.x, w.y, w.z, w.radius);
  K.set(Math.max(0.3, w.thickness), s, 7, PING_RIPPLE);
  return s;
}

/** 0..1: how much the mark itself flares while its wave leaves (a soft swell over the first second, never a flash). */
export function originGlow(w) {
  if (!w || !w.active) return 0;
  const a = w.age;
  const up = a < 0.35 ? a / 0.35 : 1;
  return up * Math.exp(-Math.max(0, a - 0.35) * 1.4) * (w.fade > 0 ? w.fade : 0);
}
