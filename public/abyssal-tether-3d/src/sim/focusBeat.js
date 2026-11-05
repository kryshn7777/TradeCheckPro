/* THE LANTERN (ABYSSAL TETHER 3D) — sim/focusBeat.js
 * PUZZLE FOCUS, the camera half (docs/abyssal-tether-3d/plans/PUZZLE_FOCUS.md): one short, eased "glance" toward a puzzle.
 *
 *   IDLE -> TURN (TURN_T s: smoothstep of the shortest yaw arc and the pitch, never linear, never roll)
 *        -> HOLD (HOLD_T s: the view follows the target, damped, while the line plays)
 *        -> RELEASE (RELEASE_T s: nothing is driven any more, the glow fades; the player keeps the new look: no snap back) -> IDLE
 *
 * Pure, DOM-free, three.js-free, no allocation per update. Per frame the caller passes the CURRENT look (yaw = the rig's world yaw,
 * pitch = the desktop camera's pitch), the eye, the target and whether it is safe; the beat writes `dYaw` / `dPitch` (the look delta
 * to apply now, radians) and remembers the look it asked for. A look that differs from it next frame is the player's own input (mouse,
 * arrow keys, touch drag, a snap turn): the pan is cancelled at once and never resumes (the line and the cues carry on). An unsafe
 * frame cancels the pan the same way. `xr` (a headset) never pans: `pan` is forced off and dYaw / dPitch stay 0 for the whole beat;
 * the gaze guide (`lookTarget`, `glow`) is all a headset gets.
 * Conventions (three.js): yaw 0 looks down -Z, forward = (-sin yaw, -cos yaw) in XZ; pitch > 0 looks up.
 */

export const TURN_T = 0.8;
export const HOLD_T = 1.5;
export const RELEASE_T = 0.35;
/** Already looking within this angle of the target (rad, 12 degrees): no pan, just the line and the cues. */
export const LOOK_SKIP = (12 * Math.PI) / 180;
/** The pan never asks for more pitch than this (rad): inside the desktop look's own limit (1.48), so it is never clamped. */
export const PITCH_MAX = 1.2;
/** How fast HOLD keeps the view on a moving target (1 / s). */
const FOLLOW_RATE = 9;
/** A look this far (rad) from the one the beat set last frame is the player's own input. */
const INPUT_EPS = 2e-4;

export const IDLE = 0;
export const TURN = 1;
export const HOLD = 2;
export const RELEASE = 3;
export const STATE_NAMES = Object.freeze(['IDLE', 'TURN', 'HOLD', 'RELEASE']);

const TAU = Math.PI * 2;
/** Wraps an angle to (-pi, pi]. */
export function wrapAngle(a) {
  if (a > -Math.PI && a <= Math.PI) return a;
  let x = a - TAU * Math.floor((a + Math.PI) / TAU); // (no %: V8's float modulo boxes)
  if (x <= -Math.PI) x += TAU;
  else if (x > Math.PI) x -= TAU;
  return x;
}

/** smoothstep on [0, 1] (zero velocity at both ends). */
export function smooth01(u) {
  const t = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return t * t * (3 - 2 * t);
}

/** World yaw that looks from (ex, ez) toward (tx, tz) (yaw 0 looks down -Z). */
export function yawTo(ex, ez, tx, tz) {
  return Math.atan2(-(tx - ex), -(tz - ez));
}

/** Pitch that looks from the eye up / down to the target (rad, > 0 up), clamped to +-PITCH_MAX. */
export function pitchTo(ex, ey, ez, tx, ty, tz) {
  const dx = tx - ex;
  const dz = tz - ez;
  const p = Math.atan2(ty - ey, Math.sqrt(dx * dx + dz * dz)); // (not Math.hypot: it allocates in V8)
  return p > PITCH_MAX ? PITCH_MAX : p < -PITCH_MAX ? -PITCH_MAX : p;
}

/** Angle (rad) between the view (yaw, pitch) and the direction eye -> target. */
export function viewAngleTo(yaw, pitch, ex, ey, ez, tx, ty, tz) {
  const cp = Math.cos(pitch);
  const fx = -Math.sin(yaw) * cp;
  const fy = Math.sin(pitch);
  const fz = -Math.cos(yaw) * cp;
  const dx = tx - ex;
  const dy = ty - ey;
  const dz = tz - ez;
  const l = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (l < 1e-6) return 0;
  const c = (fx * dx + fy * dy + fz * dz) / l;
  return Math.acos(c > 1 ? 1 : c < -1 ? -1 : c);
}

export class FocusBeat {
  constructor() {
    /** The point the beat guides attention to (the gaze guide: the glow, the lantern's lean via the 'focus:look' event). */
    this.lookTarget = { x: 0.5, y: 0.5, z: 0.5, on: false };
    // the number fields start as doubles (a stable field shape: storing a frame's double never boxes)
    this.t = this.dYaw = this.dPitch = this.glow = this._y0 = this._p0 = this._setY = this._setP = this._hold = 0.5;
    this.reset();
  }

  /** Nothing running (a new run, a death, a pause into the menu). */
  reset() {
    this.state = IDLE;
    this.t = 0;
    this.pan = false; // this beat drives the desktop look
    this.cancelled = ''; // why a pan stopped early: 'input' | 'unsafe' | ''
    this.skipped = ''; // why the beat never panned: 'xr' | 'mode' | 'looking' | 'unsafe' | 'occluded' | ''
    this.dYaw = 0;
    this.dPitch = 0;
    this.glow = 0; // 0..1: the gaze guide's strength (fades in over TURN, out over RELEASE)
    this.count = 0; // beats started (debug)
    this.panned = 0; // beats that turned the view (debug)
    this._y0 = 0;
    this._p0 = 0;
    this._setY = 0;
    this._setP = 0;
    this._hold = HOLD_T;
    this.lookTarget.on = false;
  }

  get active() {
    return this.state !== IDLE;
  }

  get stateName() {
    return STATE_NAMES[this.state];
  }

  /**
   * Starts a beat toward (tx, ty, tz). o: { yaw, pitch, ex, ey, ez (the current look and eye), pan (the platform and the setting
   * allow a pan and it is safe now), xr, hold (s, optional: a longer line holds longer, never shorter than HOLD_T) }.
   * Returns true when it will pan.
   */
  start(tx, ty, tz, o) {
    this.state = TURN;
    this.t = 0;
    this.count++;
    this.cancelled = '';
    this.skipped = '';
    this.dYaw = 0;
    this.dPitch = 0;
    const lt = this.lookTarget;
    lt.x = tx;
    lt.y = ty;
    lt.z = tz;
    lt.on = true;
    this._hold = o && o.hold > HOLD_T ? Math.min(4, o.hold) : HOLD_T;
    const yaw = o ? +o.yaw || 0 : 0;
    const pitch = o ? +o.pitch || 0 : 0;
    this._y0 = yaw;
    this._p0 = pitch;
    this._setY = yaw;
    this._setP = pitch;
    let pan = !!(o && o.pan);
    if (o && o.xr) {
      pan = false;
      this.skipped = 'xr';
    } else if (!pan) this.skipped = (o && o.why) || 'mode';
    else if (viewAngleTo(yaw, pitch, o.ex, o.ey, o.ez, tx, ty, tz) < LOOK_SKIP) {
      pan = false;
      this.skipped = 'looking';
    }
    this.pan = pan;
    if (pan) this.panned++;
    return pan;
  }

  /** Stops the pan now (the beat's cues carry on). */
  cancelPan(why) {
    if (!this.pan) return;
    this.pan = false;
    this.cancelled = why || 'input';
    this.dYaw = 0;
    this.dPitch = 0;
  }

  /** Ends the beat at once (a death, a restart, the setting turned off). */
  stop() {
    this.state = IDLE;
    this.pan = false;
    this.dYaw = 0;
    this.dPitch = 0;
    this.glow = 0;
    this.lookTarget.on = false;
  }

  /**
   * One frame. inp: { yaw, pitch (the look NOW, after the player's input), ex, ey, ez (the eye), tx, ty, tz (the target now: it may move),
   * safe (no fall, no fast swing, no hold transition, no attack wind-up, playing), xr }. Writes dYaw / dPitch (apply them to the look
   * this frame), glow, state. Returns this.
   */
  update(dt, inp) {
    // (the math is written out inline: a double passed to or returned from a call that is not inlined boxes in V8, i.e. allocates)
    this.dYaw = 0;
    this.dPitch = 0;
    if (this.state === IDLE) {
      this.glow = 0;
      return this;
    }
    const d = dt > 0 ? (dt > 0.1 ? 0.1 : dt) : 0;
    const lt = this.lookTarget;
    if (inp.tx === inp.tx) {
      lt.x = inp.tx;
      lt.y = inp.ty;
      lt.z = inp.tz;
    }
    if (this.pan) {
      let w = inp.yaw - this._setY;
      if (w > Math.PI || w <= -Math.PI) w -= TAU * Math.floor((w + Math.PI) / TAU);
      const dp = inp.pitch - this._setP;
      if (inp.xr) this.cancelPan('xr');
      else if (w > INPUT_EPS || w < -INPUT_EPS || dp > INPUT_EPS || dp < -INPUT_EPS) this.cancelPan('input');
      else if (!inp.safe) this.cancelPan('unsafe');
    }
    this.t += d;
    // the target's bearing and elevation from the eye now (yawTo / pitchTo), every frame of a beat (cheap; no variable assigned on one
    // branch only: a mixed phi is tagged in TurboFan and boxes a double each frame)
    const dx = lt.x - inp.ex;
    const dz = lt.z - inp.ez;
    const ay = Math.atan2(-dx, -dz);
    const ap0 = Math.atan2(lt.y - inp.ey, Math.sqrt(dx * dx + dz * dz));
    const ap = Math.max(-PITCH_MAX, Math.min(PITCH_MAX, ap0)); // (not a ternary on the constant: that phi is tagged and boxes)
    if (this.state === TURN) {
      const u = this.t / TURN_T;
      const uc = u >= 1 ? 1 : u;
      const s = uc * uc * (3 - 2 * uc); // smoothstep
      this.glow = s;
      if (this.pan) {
        let w = ay - this._y0; // the shortest arc from where the turn began
        if (w > Math.PI || w <= -Math.PI) w -= TAU * Math.floor((w + Math.PI) / TAU);
        let dyw = this._y0 + w * s - inp.yaw;
        if (dyw > Math.PI || dyw <= -Math.PI) dyw -= TAU * Math.floor((dyw + Math.PI) / TAU);
        this.dYaw = dyw;
        this.dPitch = this._p0 + (ap - this._p0) * s - inp.pitch;
      }
      if (u >= 1) {
        this.state = HOLD;
        this.t = 0;
      }
    } else if (this.state === HOLD) {
      this.glow = 1;
      if (this.pan) {
        const k = 1 - Math.exp(-FOLLOW_RATE * d);
        let w = ay - inp.yaw;
        if (w > Math.PI || w <= -Math.PI) w -= TAU * Math.floor((w + Math.PI) / TAU);
        this.dYaw = w * k;
        this.dPitch = (ap - inp.pitch) * k;
      }
      if (this.t >= this._hold) {
        this.state = RELEASE;
        this.t = 0;
        this.pan = false; // released: the look is the player's again (no snap back)
      }
    } else if (this.state === RELEASE) {
      const v = this.t >= RELEASE_T ? 1 : this.t / RELEASE_T;
      this.glow = 1 - v * v * (3 - 2 * v);
      if (this.t >= RELEASE_T) {
        this.state = IDLE;
        this.glow = 0;
        lt.on = false;
      }
    }
    this._setY = inp.yaw + this.dYaw;
    this._setP = inp.pitch + this.dPitch;
    return this;
  }
}
