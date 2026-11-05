/* THE LANTERN — catch3d.js
 * THE CATCH: a hit-stop on a lifesaving rope bite. When the line bites while the body was falling at >= CATCH.ratio of the
 * lethal impact speed, the world holds for CATCH.hold seconds at CATCH.scale of real time, then eases back to 1 over
 * CATCH.ease seconds (smoothstep). Pure (no three.js, no DOM, no clock but the dt it is stepped with, no allocation).
 *
 *   const cm = new CatchMoment();
 *   cm.onJolt(speed, vyBefore, lethalImpact, enabled) -> true when the catch fired (sets the envelope, count++)
 *   cm.step(realDt)                                   -> the sim time scale for this frame (the envelope's mean over the frame)
 *   cm.count, cm.active, cm.reset()
 *
 * The game multiplies the run's dt by step(): physics, the creature and the run clock slow together (fair to speedruns: the
 * clock loses exactly what the world lost). Views, the head and haptics keep real time: in VR the head stays 1:1, the world
 * just pauses. lostTime() = what one whole envelope takes out of the sim clock.
 */

export const CATCH = Object.freeze({
  ratio: 0.75, // fires at >= 75 % of the lethal impact speed (downward speed before the bite)
  hold: 0.1, // s of real time held at `scale`
  scale: 0.25, // sim time scale during the hold
  ease: 0.2, // s of real time easing back to 1 (smoothstep)
});

/** Integral of the time scale over the envelope's real time [0, t] (closed form: smoothstep integrates exactly). */
function scaleIntegral(t) {
  const H = CATCH.hold;
  const E = CATCH.ease;
  const s0 = CATCH.scale;
  if (t <= 0) return 0;
  if (t <= H) return s0 * t;
  const u = Math.min(1, (t - H) / E);
  // smoothstep S(u) = 3u² - 2u³, ∫0..u S = u³ - u⁴/2
  const easeInt = E * (s0 * u + (1 - s0) * (u * u * u - 0.5 * u * u * u * u));
  const after = t > H + E ? t - H - E : 0;
  return s0 * H + easeInt + after;
}

export class CatchMoment {
  constructor() {
    this.count = 0;
    this.t = -1; // real seconds into the envelope; < 0 = idle
    this.lastSpeed = 0;
  }

  reset() {
    this.count = 0;
    this.t = -1;
    this.lastSpeed = 0;
  }

  /** True while the envelope runs. */
  get active() {
    return this.t >= 0;
  }

  /**
   * A rope jolt (bus 'rope:jolt'). Fires when enabled, the jolt is real (speed > 0) and the body was falling at >=
   * CATCH.ratio x lethal before the bite. A jolt during a running envelope does not restart it (no stacking).
   * @returns {boolean} the catch fired
   */
  onJolt(speed, vyBefore, lethal, enabled) {
    if (enabled === false) return false;
    const L = typeof lethal === 'number' && lethal > 0 ? lethal : 17;
    const fall = typeof vyBefore === 'number' && isFinite(vyBefore) ? -vyBefore : 0;
    if (!(speed > 0) || fall < CATCH.ratio * L) return false;
    if (this.t >= 0) return false;
    this.t = 0;
    this.count++;
    this.lastSpeed = fall;
    return true;
  }

  /** Advances the envelope by `realDt`; returns the mean sim time scale over this frame (1 when idle). */
  step(realDt) {
    if (this.t < 0) return 1;
    const dt = realDt > 0 ? realDt : 0;
    if (dt === 0) return this.t < CATCH.hold ? CATCH.scale : 1;
    const t0 = this.t;
    const t1 = t0 + dt;
    const k = (scaleIntegral(t1) - scaleIntegral(t0)) / dt;
    this.t = t1 >= CATCH.hold + CATCH.ease ? -1 : t1;
    return k;
  }

  /** Seconds of sim time one whole envelope takes away (0.15 s with the shipped numbers). */
  static lostTime() {
    const T = CATCH.hold + CATCH.ease;
    return T - scaleIntegral(T);
  }
}
