/* THE LANTERN — input/assistLatch.js
 * ASSIST PACK (plans/TUTORIAL_ASSIST.md): the two state machines that let a player with RSI (or anyone who cannot hold a button for
 * a minute) climb and swing without holding anything down. Pure: no three.js, no DOM, no clock but the dt given, no allocation.
 *
 * GRIP TOGGLE (settings.gripMode 'toggle'; VR grip / desktop F / touch GRIP): one squeeze grabs, the next lets go.
 *   stepGripToggle(s, raw, dt, holding, blocked) -> the grab the climb sees this frame
 *     raw      the physical grip (after the squeeze hysteresis)
 *     holding  the climb holds on with this hand (climb3d hands[h].gripping, last frame)
 *     blocked  the squeeze belongs to something else this frame (the bag at the hip, a knocker in the hand, the hood, a menu):
 *              it toggles nothing; the latched grab stays
 *   - a squeeze while off: latched ON. If nothing is taken within GRIP_TOGGLE.settle s (no hold in reach) it drops again, so a
 *     squeeze in the air never leaves a sticky hand behind;
 *   - a squeeze while on: OFF, and `s.released` is true for that frame: the toggle release. The game turns it into the pull that
 *     frees a Holdfast hand (holdfast3d assistPull: 'holdfast:outpull'), since a pinned hand cannot be let go any other way;
 *   - the hold ending without us (a slip, a hop, a mantle, the stamina, a death): OFF, so the next squeeze grabs again.
 *
 * ROPE LATCH (settings.ropeLatch; VR triggers and the desktop mouse / keys; touch keeps its own touchRopeMode): tap to fire and stay
 *   attached, tap again to let go. ropeLatchRise(s, raw) -> true on a fresh press (the caller flips that hand's tether). The caller
 *   drops the latch when the line ends on its own (a miss, a break, a cut, a cancel).
 */

export const GRIP_TOGGLE = Object.freeze({
  settle: 0.35, // s a latched grab waits for a hold before it lets go again
});

export function makeGripToggle() {
  return { raw: false, on: false, held: false, t: 0, released: false };
}

export function resetGripToggle(s) {
  s.on = false;
  s.held = false;
  s.t = 0;
  s.released = false;
  return s;
}

/** One frame of the grip toggle. Returns the latched grab (see the header). */
export function stepGripToggle(s, raw, dt, holding, blocked) {
  const r = !!raw;
  const rise = r && !s.raw;
  s.raw = r;
  s.released = false;
  if (rise && !blocked) {
    if (s.on) {
      s.on = false;
      s.released = true;
    } else {
      s.on = true;
      s.held = false;
      s.t = 0;
    }
    return s.on;
  }
  if (s.on) {
    if (holding) s.held = true;
    else if (s.held) s.on = false; // the hold ended without us
    else {
      s.t += dt > 0 ? dt : 0;
      if (s.t >= GRIP_TOGGLE.settle) s.on = false; // nothing in reach
    }
  }
  return s.on;
}

export function makeRopeLatch() {
  return { raw: false };
}

/** A fresh press of the rope input (falls and holds are nothing in latch mode). */
export function ropeLatchRise(s, raw) {
  const r = !!raw;
  const rise = r && !s.raw;
  s.raw = r;
  return rise;
}
