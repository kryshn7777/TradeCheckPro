/* THE LANTERN (ABYSSAL TETHER 3D) — render/hitFeedback.js
 * HIT FEEDBACK (docs/abyssal-tether-3d/plans/HIT_FEEDBACK.md): the pure curves of what a hit looks like. No three.js, no DOM, no
 * allocation (every function writes plain numbers into an object the caller owns); Node-tested by tests/ux/hit-feedback.mjs.
 *
 *   punchEnv(t)                       0..1: the red punch over time since it started (80 ms smoothstep attack, 0.7 s quadratic decay)
 *   punchPeak(source, gentle, calm)   the rim alpha of a hit's punch (Mason 0.58; a skitterling 0.35 x that; gentle / reduced halve it)
 *   Punch                             the one-shot: hit(peak, now) starts it (never twice within MIN_GAP: <= 2 pulses / s), step(dt), value
 *   knockK(K)                         0..1 from the SIM's `game.knock` (null / 'none' / not finite = standing)
 *   rollSide(dx, dz, yaw, fb)         -1..1: which way the view rolls (away from the attacker; straight on = the fallback side)
 *   hitCam(k, side, o, out)           { drop (m), roll (rad) } for knock weight k: desktop 1.62 m -> 0.30 m eye, <= 10 deg roll;
 *                                     VR: no roll ever, <= 0.12 m and none when calm / comfort / gentle; gentle desktop: none
 *   stumble(t)                        0..1: the short skitterling stumble bump (0.45 s)
 *   heldVig(k)                        0..1: the held red-black vignette while down
 *   knockMuffle(K) / timerMuffle(t)   0..1: how closed the world's low-pass is
 *   LocalKnock                        the STAND-IN for the SIM's Knockdown (used only while `game.knock` is missing or idle): the
 *                                     contract's phases and timings (0.25 s fall, 1.1 s down, 2.4 s ease-out rise)
 */

import { VIEW } from '../sim/config3d.js';

const DEG = Math.PI / 180;

export const HIT = Object.freeze({
  attack: 0.08, // s: the punch's rise
  decay: 0.7, // s: ... and its fall (zero at attack + decay)
  peak: 0.58, // rim alpha of a Mason punch
  skitMul: 0.35, // a skitterling's punch, of the Mason's
  calmMul: 0.5, // Reduced effects or 'gentle': the punch halved
  minGap: 0.5, // s: a new punch starts at most this often (<= 2 pulses / s: never a strobe)
  eyeDown: 0.3, // m above the feet: the desktop eye when flat on the ground
  rollMax: 10 * DEG, // rad: the desktop roll away from the attacker
  vrMax: 0.12, // m: the most the VR rig ever moves (down), never rotated
  stumbleDur: 0.45, // s: a skitterling bite's stumble
  stumbleDrop: 0.12, // m (desktop)
  stumbleRoll: 2.5 * DEG, // rad (desktop)
  fall: 0.25, // s: the stand-in knock's fall to the ground
  down: 1.1, // s: ... the whole down phase (the contract)
  rise: 2.4, // s: ... the slow rise (the contract)
  vig: 0.85, // the held vignette's strength flat on the ground
  dizzyHz: 0.3, // the slow sway of the held rim (never with Reduced effects / gentle)
  dizzyAmp: 0.04, // NDC
  muffleHold: 0.4, // s: a Mason hit without a knock: the world muffled this long ...
  muffleTail: 1.6, // ... then open again by this time
  tick: 1.2, // s: the '-30%' tick on the ECG screen
  bodyDrop: 0.45, // m: VR: the body's neck target lowers this much flat on the ground (the IK crouches the body)
});

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);
const sstep = (u) => {
  const x = clamp01(u);
  return x * x * (3 - 2 * x);
};

/** 0..1: the punch `t` seconds after it started (0 before, 0 from attack + decay on). */
export function punchEnv(t) {
  if (!(t >= 0)) return 0;
  if (t < HIT.attack) return sstep(t / HIT.attack);
  const u = (t - HIT.attack) / HIT.decay;
  if (u >= 1) return 0;
  return (1 - u) * (1 - u);
}

/** The rim alpha of a punch. `calm` = Reduced effects; gentle or calm halve it (not both: one comfort halving). */
export function punchPeak(source, gentle, calm) {
  const p = HIT.peak * (source === 'skitter' ? HIT.skitMul : 1);
  return gentle || calm ? p * HIT.calmMul : p;
}

/** The one-shot punch. Allocation-free; `value` is the alpha to draw now. */
export class Punch {
  constructor() {
    this.t = 1e9; // s since the current punch started
    this.peak = 0;
    this.value = 0;
    this.starts = 0; // punches started (tests: never more than 2 per second)
  }
  /** A hit: a new punch, unless one started less than HIT.minGap ago (then only its peak may rise). */
  hit(peak) {
    if (!(peak > 0)) return false;
    if (this.t < HIT.minGap) {
      if (peak > this.peak) this.peak = peak;
      return false;
    }
    this.t = 0;
    this.peak = peak;
    this.starts++;
    this.value = 0;
    return true;
  }
  step(dt) {
    if (dt > 0) this.t += dt;
    this.value = this.peak * punchEnv(this.t);
    return this.value;
  }
  reset() {
    this.t = 1e9;
    this.peak = 0;
    this.value = 0;
  }
}

/** 0..1 knock weight of the SIM's `game.knock` (or the stand-in); null / 'none' / NaN = standing. */
export function knockK(K) {
  if (!K || K.phase === 'none' || !K.phase) return 0;
  const k = K.k;
  return k > 0 ? (k < 1 ? k : 1) : 0;
}

/**
 * -1..1: the roll of the view, away from the attacker. (dx, dz) = attacker -> player (unit, horizontal); yaw = the view's yaw
 * (three.js: forward (-sin, -cos), right (cos, -sin)). Pushed to the right, the head falls right: a negative camera z rotation.
 * Straight on (or behind) the push has no side: `fb` (+1 / -1) picks one, at 0.6.
 */
export function rollSide(dx, dz, yaw, fb) {
  const f = fb < 0 ? -1 : 1;
  if (!(dx === dx && dz === dz && yaw === yaw)) return 0.6 * f;
  const s = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  if (s > -0.2 && s < 0.2) return 0.6 * f;
  const v = -1.6 * s;
  return v > 1 ? 1 : v < -1 ? -1 : v;
}

/**
 * The view offset for knock weight `k` (0 standing .. 1 flat) and roll side. `o` { xr, gentle, calm, comfort }; `out` { drop, roll }
 * (drop: metres the eye goes down; roll: rad on the desktop camera's z). A headset is never rotated.
 */
export function hitCam(k, side, o, out) {
  const kk = clamp01(k);
  if (o.xr) {
    out.roll = 0;
    out.drop = o.gentle || o.calm || o.comfort ? 0 : HIT.vrMax * kk;
    return out;
  }
  if (o.gentle) {
    out.drop = 0;
    out.roll = 0;
    return out;
  }
  const s = side > 1 ? 1 : side < -1 ? -1 : side || 0;
  out.drop = (VIEW.standEye - HIT.eyeDown) * kk;
  out.roll = HIT.rollMax * kk * s * (o.calm ? 0.5 : 1);
  return out;
}

/** 0..1 the stumble bump `t` s after a bite: down quick (30 %), back up slower. */
export function stumble(t) {
  if (!(t >= 0) || t >= HIT.stumbleDur) return 0;
  const u = t / HIT.stumbleDur;
  return u < 0.3 ? sstep(u / 0.3) : 1 - sstep((u - 0.3) / 0.7);
}

/** 0..1 the held red-black vignette for knock weight k (full a little before flat; fades out over the rise with k). */
export function heldVig(k) {
  const v = clamp01(k) * 1.4;
  return HIT.vig * (v < 1 ? v : 1);
}

/** 0..1 world muffle from the knock: closed while down, opening over the rise (ease-out). */
export function knockMuffle(K) {
  if (!K || !K.phase || K.phase === 'none') return 0;
  if (K.phase === 'down') return 1;
  if (K.phase === 'rise') {
    const u = K.dur > 0 ? clamp01(K.t / K.dur) : 1;
    const r = 1 - u;
    return 0.8 * r * Math.sqrt(r);
  }
  return 0;
}

/** 0..1 world muffle `t` s after a Mason hit that brought no knock. */
export function timerMuffle(t) {
  if (!(t >= 0)) return 0;
  if (t < HIT.muffleHold) return 1;
  return 1 - sstep((t - HIT.muffleHold) / (HIT.muffleTail - HIT.muffleHold));
}

/**
 * THE STAND-IN KNOCK (until the SIM's sim/knockdown.js is in the build; used only while `game.knock` is missing or idle). Mirrors
 * the contract: phase 'none' | 'down' | 'rise', t (s in the phase), dur (the phase's length), k (0 standing .. 1 flat: eases down in
 * 0.25 s, holds, rises with an ease-out), moveMul, active; emits player:down / player:rise / player:up { local: true }.
 */
export class LocalKnock {
  constructor(bus) {
    this.bus = bus || null;
    this.phase = 'none';
    this.t = 0;
    this.dur = 0;
    this.k = 0;
    this.moveMul = 1;
    this.active = false;
    this.local = true;
    this._down = HIT.down;
    this._rise = HIT.rise;
    this._ev = { dur: 0, local: true };
    this._up = { local: true };
  }
  start(down, rise) {
    this._down = down > 0 ? down : HIT.down;
    this._rise = rise > 0 ? rise : HIT.rise;
    if (this.phase === 'down') return; // already down: the hold is not extended (no stacking)
    this.phase = 'down';
    this.t = 0;
    this.dur = this._down;
    this.active = true;
    this.moveMul = 0;
    this._emit('player:down', this._down);
  }
  step(dt) {
    if (this.phase === 'none') {
      this.k = 0;
      return;
    }
    if (dt > 0) this.t += dt;
    if (this.phase === 'down') {
      const u = clamp01(this.t / HIT.fall);
      this.k = 1 - (1 - u) * (1 - u) * (1 - u);
      this.moveMul = 0;
      if (this.t >= this.dur) {
        this.phase = 'rise';
        this.t -= this.dur;
        this.dur = this._rise;
        this._emit('player:rise', this._rise);
      }
    }
    if (this.phase === 'rise') {
      const u = clamp01(this.t / this.dur);
      this.k = (1 - u) * (1 - u);
      this.moveMul = u * u;
      if (this.t >= this.dur) this.reset(true);
    }
  }
  _emit(type, dur) {
    if (!this.bus || typeof this.bus.emit !== 'function') return;
    this._ev.dur = dur;
    this.bus.emit(type, this._ev);
  }
  reset(up) {
    const was = this.phase !== 'none';
    this.phase = 'none';
    this.t = 0;
    this.dur = 0;
    this.k = 0;
    this.moveMul = 1;
    this.active = false;
    if (up && was && this.bus && typeof this.bus.emit === 'function') this.bus.emit('player:up', this._up);
  }
}
