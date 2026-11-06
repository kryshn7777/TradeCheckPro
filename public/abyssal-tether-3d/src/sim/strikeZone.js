/* THE LANTERN — sim/strikeZone.js
 * The Mason's dodgeable strike (plans/MASON_STRIKES.md): the per-difficulty numbers and the pure geometry. Creature3D locks a strike
 * point at the start of the wind-up; at the impact the lunge sweeps from the head toward it, and it connects only with a player
 * within `radius` of that swept segment. Standing (or hanging) still is a hit; moving off the line during the wind-up is a miss.
 * Pure, allocation-free, Node-safe.
 */

import { STRIKE_DAMAGE } from './config3d.js';

/**
 * Per difficulty (unknown keys use normal). The snake (plans/MASON_STRIKES.md): rise -> lock -> strike -> recoil -> stare.
 *   riseFirst  s: the first rise into the coil (the crown rears and tracks you)
 *   riseAgain  s: a re-rise from the coil before each later strike (the telegraph of a repeat strike)
 *   lock       s: the aim frozen on the point where you stand, before the lunge leaves (the dodge deadline)
 *   strike     s: the straight lunge to the locked point (the hit test is at its end)
 *   recoil     s: the snap back into the coil
 *   radius     m around the swept segment head -> locked point that the lunge connects within
 *   standOff   m: the distance it holds from you in the coil (it does not run through you): -0.4 / +0.6 m, always outside the
 *              knocker's decoyOverride (5 / 6 / 7 m: a knocker can draw it out of its stare) and inside its lunge reach (7.66 / 8.14 / 8.46 m)
 *   lead       s of the player's velocity added to the locked point (capped at leadMax m)
 *   cadence    [lo, hi] s from one strike's rise to the next (always inside [3, 5], the owner's rule)
 */
export const STRIKE_TUNE = {
  // the dodge: moving at the lock at walk speed with a gun out (4.4 m/s) carries you (lock + strike) x 4.4 = 2.20 / 2.02 / 1.89 m
  // > radius 2.0 / 1.85 / 1.75 m (at 5.5 m/s 2.75 / 2.53 / 2.37 m). No lead: a lead would eat into exactly that margin.
  normal: { riseFirst: 0.8, riseAgain: 0.5, lock: 0.3, strike: 0.2, recoil: 0.5, radius: 2.0, standOff: 5.6, lead: 0, cadence: [3.6, 5.0] },
  nightmare: { riseFirst: 0.7, riseAgain: 0.45, lock: 0.28, strike: 0.18, recoil: 0.5, radius: 1.85, standOff: 6.6, lead: 0, cadence: [3.3, 4.6] },
  abyss: { riseFirst: 0.6, riseAgain: 0.4, lock: 0.27, strike: 0.16, recoil: 0.45, radius: 1.75, standOff: 7.6, lead: 0, cadence: [3.0, 4.2] },
};

export const STRIKE_COMMON = Object.freeze({
  leadMax: 0.5, // m: the most the locked point leads the player by
  cadenceMin: 3, // s: the owner's bounds, never left whatever the table says
  cadenceMax: 5,
  afterHit: 5.0, // s from a connect to the next rise at the soonest (the knockdown's 3.5 s + 1.5 s)
  minHitGap: 3, // s: never two Mason hits closer than this, whatever the state
  engagePad: 4, // m past the engage radius that still counts as engaged (no stamina drain: the cadence paces it)
  leave: 2.5, // m past the lunge's reach: out of it, it leaves the coil and stalks again
  dashNear: 12, // m: within this it dashes even without sight
  dashMax: 2.5, // s: the longest dash
  dashCooldown: 4, // s between two dashes
  immunity: 1.0, // s of immunity after the player stands up again (sim/playerHits.js)
});

export { STRIKE_DAMAGE };

/** The tuning row for a difficulty key. */
export function strikeTune(key) {
  return STRIKE_TUNE[key] || STRIKE_TUNE.normal;
}

/** A cadence interval for a row from a uniform draw u in [0, 1), clamped to the owner's [3, 5]. */
export function cadenceInterval(row, u) {
  const lo = Math.max(STRIKE_COMMON.cadenceMin, row.cadence[0]);
  const hi = Math.min(STRIKE_COMMON.cadenceMax, Math.max(lo, row.cadence[1]));
  const v = lo + (hi - lo) * (u >= 0 && u < 1 ? u : 0.5);
  return v < STRIKE_COMMON.cadenceMin ? STRIKE_COMMON.cadenceMin : v > STRIKE_COMMON.cadenceMax ? STRIKE_COMMON.cadenceMax : v;
}

/** Distance from point P to the segment A-B (3D). */
export function segDist(px, py, pz, ax, ay, az, bx, by, bz) {
  const ux = bx - ax;
  const uy = by - ay;
  const uz = bz - az;
  const uu = ux * ux + uy * uy + uz * uz;
  let t = uu > 1e-9 ? ((px - ax) * ux + (py - ay) * uy + (pz - az) * uz) / uu : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const dx = px - (ax + ux * t);
  const dy = py - (ay + uy * t);
  const dz = pz - (az + uz * t);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
