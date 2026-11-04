/* ABYSSAL TETHER 3D — sim/ropePull.js
 * Hand pull on a rope (VR): shoot a line, then DRAW THE HAND BACK and the line reels in by that stroke: the body is pulled toward the anchor.
 *
 * Reported from play: "when the user shoots the rope and pulls his arm back, the rope extends, but I need him to go forward, like the rope is
 * pulling him". The drawn line runs from the hand to the anchor, so drawing the hand back only made it look longer; the sim's line length is
 * the winch (Rope3D.reel), driven by the right stick or the grip. This makes the hand a winch too.
 *
 * Per hand with a line out: s = how far the hand is behind the body along the line (m) = (hand - body) . n, n the unit vector anchor -> body.
 * Drawing the hand back raises s; its smoothed rate beyond a deadzone, times a gain, is the reel speed (`intent.hands[h].pull`, m/s) that
 * Physics3D.step feeds to Rope3D.reel(). Pushing the hand forward never pays line out (the stick does that). Pure: no three.js, no DOM,
 * no allocation after construction; the Game calls it once per frame with the hand poses relative to the body.
 */
import { CONFIG } from './config3d.js';

const K = CONFIG.rope.handPull;

export class RopePull {
  constructor() {
    this.prev = [NaN, NaN]; // last s per hand (NaN = no line / no hand: the next sample starts a stroke)
    this.rate = [0, 0]; // smoothed retraction rate (m/s, signed)
    this.pull = [0, 0]; // the reel speed to apply (m/s, >= 0)
  }

  reset() {
    this.prev[0] = this.prev[1] = NaN;
    this.rate[0] = this.rate[1] = 0;
    this.pull[0] = this.pull[1] = 0;
  }

  /**
   * @param {number} i      0 left, 1 right
   * @param {boolean} on    a line is out on this hand, the hand pose is valid, VR, and the hand is not holding a climb hold
   * @param {number} rx,ry,rz  the hand relative to the body (m)
   * @param {number} nx,ny,nz  unit vector anchor -> body
   * @param {number} dt     frame time (s)
   * @returns {number} the reel speed (m/s)
   */
  step(i, on, rx, ry, rz, nx, ny, nz, dt) {
    if (!on || !(dt > 0)) {
      this.prev[i] = NaN;
      this.rate[i] = 0;
      return (this.pull[i] = 0);
    }
    const s = rx * nx + ry * ny + rz * nz;
    const prev = this.prev[i];
    this.prev[i] = s;
    if (prev !== prev) return (this.pull[i] = 0); // the first sample of a stroke
    const raw = (s - prev) / dt;
    const a = Math.min(1, dt / K.smooth);
    this.rate[i] += (raw - this.rate[i]) * a;
    const over = this.rate[i] - K.deadzone;
    this.pull[i] = over > 0 ? Math.min(K.max, over * K.gain) : 0;
    return this.pull[i];
  }
}
