/* ABYSSAL TETHER 3D — swingLag.js
 * Camera lag while swinging: the view trails the body a little when it is moving fast on a tether, like a spring arm, then settles
 * when the swing ends. Pure maths (no three.js, no DOM): game.js adds the returned offset to the rig position every frame.
 *
 * The target offset is opposite to the velocity, `tau` seconds of travel long, only on a rope and only once the body is really
 * moving (a smoothstep between LAG_FROM and LAG_FULL m/s), clamped to a maximum length; the offset follows it with a short
 * exponential ease (RATE per second), so it builds over about a tenth of a second and never pops. In a headset the same lag is
 * capped to a small fraction (`xr`): positional lag the player did not make is the one thing that makes a VR view uncomfortable,
 * so there it is a hint of weight, not a trailing camera; the setting (0..1, Settings > Comfort) scales both.
 */

export const LAG_FROM = 2.5; // m/s: below this no lag
export const LAG_FULL = 7; // m/s: the full lag from here
export const RATE = 9; // 1/s: how fast the offset follows its target
export const TAU = 0.05; // s of travel the desktop view trails by at strength 1
export const CAP = 0.45; // m: longest desktop offset at strength 1
export const XR_SCALE = 0.22; // the headset gets this fraction of both (about 10 cm at most, at strength 1)
export const UP_MIN = -0.12; // m: never lag the eyes more than this far below the body (a rising swing must not dip into the floor)

function smoothstep(a, b, x) {
  const t = x <= a ? 0 : x >= b ? 1 : (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

/**
 * The offset the camera is easing toward. Writes {x,y,z} into `out` (metres, world axes) and returns it.
 * @param {number} vx @param {number} vy @param {number} vz body velocity (m/s)
 * @param {boolean} active  playing, alive and on a tether
 * @param {number} strength the setting, 0..1
 * @param {boolean} xr      in a headset
 */
export function swingLagTarget(vx, vy, vz, active, strength, xr, out) {
  out.x = 0;
  out.y = 0;
  out.z = 0;
  const k = strength > 0 ? Math.min(1, strength) : 0;
  if (!active || k < 0.001) return out;
  const speed = Math.hypot(vx, vy, vz);
  const f = smoothstep(LAG_FROM, LAG_FULL, speed);
  if (f <= 0) return out;
  const scale = xr ? XR_SCALE : 1;
  const tau = TAU * k * scale * f;
  let x = -vx * tau;
  let y = -vy * tau * 0.6; // less vertical: the floor is close and the stomach is sensitive to it
  let z = -vz * tau;
  const cap = CAP * k * scale;
  const len = Math.hypot(x, y, z);
  if (len > cap) {
    const c = cap / len;
    x *= c;
    y *= c;
    z *= c;
  }
  out.x = x;
  out.y = Math.max(UP_MIN * scale, y);
  out.z = z;
  return out;
}

/** Eases `off` toward `target` over `dt` seconds (in place) and returns it. */
export function stepSwingLag(off, target, dt) {
  const a = 1 - Math.exp(-RATE * Math.max(0, Math.min(dt, 0.1)));
  off.x += (target.x - off.x) * a;
  off.y += (target.y - off.y) * a;
  off.z += (target.z - off.z) * a;
  return off;
}
