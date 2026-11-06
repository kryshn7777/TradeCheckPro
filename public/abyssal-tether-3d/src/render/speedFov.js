/* THE LANTERN (ABYSSAL TETHER 3D) — render/speedFov.js
 * Desktop speed FOV kick: the field of view widens a little at speed (on a rope or in a fall), so a fast swing reads as fast on a
 * flat screen. Never in a headset (the headset owns its projection, and a changing FOV there is a comfort hazard), never with
 * Reduced effects, off with settings.speedFov === false. Pure maths: game.js (_applySpeedFov) adds the result to the base fov.
 *
 *   speedFovTarget(speed, active, xr, reduced, enabled) -> degrees 0..SPEED_FOV.maxDeg: a smoothstep from `from` to `full` m/s
 *   stepSpeedFov(cur, target, dt) -> the eased value: in over ~0.3 s, out over ~0.5 s (exponential, 95 % within those times)
 */

export const SPEED_FOV = {
  maxDeg: 7, // degrees added at full speed
  from: 12, // m/s: below this no kick
  full: 25, // m/s: the full kick from here
  inTime: 0.3, // s to ease in (95 %)
  outTime: 0.5, // s to ease out (95 %)
};

function smoothstep(a, b, x) {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

/**
 * The kick (degrees) the fov eases toward.
 * @param {number} speed    body speed, m/s
 * @param {boolean} active  playing, alive, and on a rope or in a fall
 * @param {boolean} xr      in a headset: always 0
 * @param {boolean} reduced settings.reducedEffects: always 0
 * @param {boolean} [enabled=true] settings.speedFov
 */
export function speedFovTarget(speed, active, xr, reduced, enabled = true) {
  if (!active || xr || reduced || enabled === false || !(speed > 0)) return 0;
  return SPEED_FOV.maxDeg * smoothstep(SPEED_FOV.from, SPEED_FOV.full, speed);
}

/** One frame of easing from `cur` toward `target` (degrees) over `dt` seconds. */
export function stepSpeedFov(cur, target, dt) {
  if (!(dt > 0)) return cur;
  const tau = (target > cur ? SPEED_FOV.inTime : SPEED_FOV.outTime) / 3; // exp(-3) = 5 % left at the stated time
  const next = target + (cur - target) * Math.exp(-dt / tau);
  return Math.abs(next - target) < 1e-3 ? target : next;
}
