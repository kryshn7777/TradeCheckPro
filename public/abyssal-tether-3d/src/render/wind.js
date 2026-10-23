/* ABYSSAL TETHER 3D — wind.js
 * The shaft's draught as three pure functions of time, shared by everything that moves in it so the sway of the props
 * (sceneDetail.js) and the wisps of ash that visibly ride the gusts (windGusts.js) always agree:
 *   windAngle(t)   heading of the draught in the XZ plane (radians): a slow turn, never still
 *   windGust(t)    0..~1.3 strength: a breathing base + short pulses (the sway amplitude scale)
 *   windSquall(t)  0..1 now and then the air really pushes: a few seconds of strong, sideways-sweeping wind
 */

/** Heading of the draught in the XZ plane (radians) at time t (seconds). */
export function windAngle(t) {
  return 0.6 + 0.9 * Math.sin(t * 0.037) + 0.4 * Math.sin(t * 0.011 + 1.3);
}

/** Strength of the draught at time t: breathing base + short pulses, 0..~1.3 (no squall). */
export function windGust(t) {
  return 0.55 + 0.45 * Math.sin(t * 0.21) * Math.sin(t * 0.067 + 1.0) + 0.25 * Math.max(0, Math.sin(t * 0.9 + Math.sin(t * 0.13) * 3));
}

/** A squall: 0 most of the time, rising to 1 for a few seconds every half minute or so. */
export function windSquall(t) {
  const s = Math.sin(t * 0.31) * Math.sin(t * 0.113 + 2.0);
  return s > 0 ? s * s : 0;
}
