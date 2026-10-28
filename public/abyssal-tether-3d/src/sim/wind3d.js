/* ABYSSAL TETHER 3D — wind3d.js
 * The shaft's draught as pure functions of time, shared by the sim and the view so what pushes the body and what the eye
 * sees always agree (LEVEL_FUN_PLAN item 9, P6: the plan moved these out of render/wind.js, which re-exports them):
 *   windAngle(t)   heading of the draught in the XZ plane (radians): a slow turn, never still
 *   windGust(t)    0..~1.3 strength: a breathing base + short pulses (the sway amplitude scale of the props)
 *   windSquall(t)  0..1 now and then the air really pushes (the ambient look only: no body is pushed by it)
 * and the gameplay squalls (sim/objectives3d.js, level data `squalls`): a schedule { period, on, lead, phase } like the
 * rockfall lanes, a function of the run clock (so the bots' look-ahead, a re-run and a replay agree):
 *   squallU(q, t)        where squall q is in its cycle at clock t: 0..period (it blows for u < on)
 *   squallK(q, u)        0..1 strength at u: sin² over the `on` window (it rises and falls smoothly: never a jolt)
 *   squallRise(q, u)     0..1 during the `lead` s before it blows (the telegraph: the gust gathering), else 0
 * DOM-free, three.js-free, no imports, no allocation.
 */

/** Heading of the draught in the XZ plane (radians) at time t (seconds). */
export function windAngle(t) {
  return 0.6 + 0.9 * Math.sin(t * 0.037) + 0.4 * Math.sin(t * 0.011 + 1.3);
}

/** Strength of the draught at time t: breathing base + short pulses, 0..~1.3 (no squall). */
export function windGust(t) {
  return 0.55 + 0.45 * Math.sin(t * 0.21) * Math.sin(t * 0.067 + 1.0) + 0.25 * Math.max(0, Math.sin(t * 0.9 + Math.sin(t * 0.13) * 3));
}

/** A squall of the look: 0 most of the time, rising to 1 for a few seconds every half minute or so. */
export function windSquall(t) {
  const s = Math.sin(t * 0.31) * Math.sin(t * 0.113 + 2.0);
  return s > 0 ? s * s : 0;
}

/** Where squall `q` ({ period, phase }) is in its cycle at clock t: 0..period (it blows while u < q.on). */
export function squallU(q, t) {
  const c = t / q.period + q.phase;
  return (c - Math.floor(c)) * q.period;
}

/** The cycle (gust) number of squall `q` at clock t. */
export function squallCycle(q, t) {
  return Math.floor(t / q.period + q.phase);
}

/** 0..1 strength of squall `q` at cycle position u: sin² over its `on` window, 0 outside it. */
export function squallK(q, u) {
  if (!(u >= 0 && u < q.on)) return 0;
  const s = Math.sin((Math.PI * u) / q.on);
  return s * s;
}

/** 0..1 during the `lead` s before the squall blows (the telegraph), 0 otherwise. */
export function squallRise(q, u) {
  const w = q.period - q.lead;
  return q.lead > 0 && u >= w ? (u - w) / q.lead : 0;
}
