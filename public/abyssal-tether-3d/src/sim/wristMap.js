/**
 * ABYSSAL TETHER 3D - the wrist computer's MAP switch (pure: no three.js, no DOM, no Math.random).
 *
 * "A 3D map of the full map, and a dot where the user is currently at, and the place where it started and the place where he is going to go.
 * Like a 3D hologram in his watch, like he can access it whenever he can."
 *
 * The watch is on the RIGHT wrist (the lantern hangs from the left hand). The hologram opens
 *   - VR: when you RAISE the wrist to look at it: the right hand 20-50 cm from the head, below the eye line, inside a cone about the gaze, held
 *     there for 0.35 s (so a hand passing the face does not trigger it), with the right gun holstered (a gun drawn up to aim is not a look at
 *     the watch). It folds away 0.25 s after the wrist leaves the cone.
 *   - desktop / touch: the M key (a latch: M again closes it). Not while a menu is up or you are dead.
 *   - pinned: the latch also works in VR (a thumb on nothing: the debug API and the settings 'map always on' use it).
 *
 * `k` eases 0..1 (the hologram's bloom); `on` is the target. The view reads `k`.
 */

export const MAP = Object.freeze({
  dwell: 0.35, // s the wrist must be raised before it opens
  leave: 0.25, // s outside the cone before it folds
  near: 0.18, // m: closer than this to the head is not "looking at it" (a hand at the face)
  far: 0.52, // m
  below: [-0.5, 0.0], // hand y minus head y (m): below the eye line
  cone: 0.76, // the dot of the gaze and the direction to the hand must be at least this (about 40 degrees)
  rate: 7, // 1 / s: the bloom's ease
});

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * Is the wrist raised to look at? head: {x,y,z,fx,fy,fz} (fx.. the unit gaze); hand: {x,y,z}.
 * The direction from the head to the hand must lie within ~40 deg of the gaze (dot >= 0.76) and 10-60 deg below the horizon of the gaze.
 */
export function wristRaised(head, hand) {
  if (!head || !hand) return false;
  const dx = hand.x - head.x;
  const dy = hand.y - head.y;
  const dz = hand.z - head.z;
  const d = Math.hypot(dx, dy, dz);
  if (!(d >= MAP.near && d <= MAP.far)) return false;
  if (!(dy >= MAP.below[0] && dy <= MAP.below[1])) return false;
  const dot = (dx * head.fx + dy * head.fy + dz * head.fz) / d;
  return dot >= MAP.cone;
}

export class WristMap {
  constructor() {
    this.on = false; // the target
    this.k = 0; // the bloom 0..1
    this.pinned = false; // the M latch
    this._in = 0; // s the wrist has been raised
    this._out = 0; // s it has been away
    this.gesture = false; // the wrist is up right now (read by tests / the view for a hint)
  }

  /** Back to nothing (a new run, a menu). */
  reset() {
    this.on = false;
    this.k = 0;
    this.pinned = false;
    this._in = 0;
    this._out = 0;
    this.gesture = false;
  }

  /** The latch (M). */
  toggle() {
    this.pinned = !this.pinned;
    return this.pinned;
  }

  /**
   * @param {number} dt
   * @param {{live:boolean, xr:boolean, head?:object, hand?:object, handOk?:boolean, gunOut?:boolean}} c
   *   live: playing and alive and no menu; xr: a headset; gunOut: the right rope gun is out of its holster
   */
  update(dt, c) {
    dt = dt > 0 ? Math.min(dt, 0.25) : 0;
    if (!c || !c.live) {
      this.on = false;
      this.pinned = false;
      this._in = this._out = 0;
      this.gesture = false;
    } else {
      let up = false;
      if (c.xr && c.handOk !== false && !c.gunOut) up = wristRaised(c.head, c.hand);
      this.gesture = up;
      if (up) {
        this._in += dt;
        this._out = 0;
      } else {
        this._out += dt;
        this._in = 0;
      }
      let want = this.on;
      if (!this.on && this._in >= MAP.dwell) want = true;
      else if (this.on && this._out >= MAP.leave && !this.pinned) want = false;
      this.on = want || this.pinned;
    }
    const target = this.on ? 1 : 0;
    const e = 1 - Math.exp(-MAP.rate * dt);
    this.k += (target - this.k) * e;
    if (Math.abs(this.k - target) < 0.002) this.k = target;
    this.k = clamp01(this.k);
  }
}
