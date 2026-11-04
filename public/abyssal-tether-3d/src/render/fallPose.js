/* ABYSSAL TETHER 3D — render/fallPose.js
 * The falling animation of the player's body.
 *
 * Reported from play (a screenshot of the body seen from above, circled): "Make a falling animation to the body". In free fall the body hung
 * under the head exactly as when standing: the legs ran the looping Fall clip, but the torso stayed upright, the pack and pouches (springs driven
 * by acceleration: none at constant speed) hung still, and on the desktop the two virtual hands stayed at the corners of the view.
 *
 * `fallAmount` turns the fall into a weight 0..1 (downward speed, in the air for a moment, not hanging on a line or a hold); FallPose eases it and
 *   - on the desktop flails the two virtual hands: up, out and fluttering, rolling, harder the faster the fall (VR hands are the real controllers:
 *     they are left alone);
 *   - exposes `w` (the weight) and `t` (a clock) for BodyView, which tilts the pelvis so the legs trail up and back, kicks the Fall clip faster,
 *     buffets the chest, and lifts and flaps the pack and the pouches in the airstream (BodyView.update / _secondary).
 * Pure functions are Node-testable; no per-frame allocation.
 */

export const FALL_POSE = {
  vMin: 5, // m/s of downward speed where the pose begins
  vFull: 20, // ... and is complete
  airMin: 0.25, // s in the air before it can begin (a hop is not a fall)
  rise: 7, // 1/s: how fast the pose comes in
  fade: 4, // 1/s: how fast it goes out (a catch / a landing)
  kick: 1.1, // extra Fall clip speed at full weight (x 2.1)
  legTrail: 0.55, // how far the legs are swung toward trailing up and back (blend of the direction)
  chestShake: 0.07, // rad of buffeting on the chest at full weight
  packLift: 0.4, // rad the pack and pouches are lifted by the airstream
  hand: { x: 0.07, y: 0.17, z: 0.06, roll: 0.4, flap: 0.04 }, // desktop virtual hands: out, up, forward, roll (rad), flutter (m)
};

/** 0..1: how much of the free-fall pose applies. `roped`: a line out or a hold in use (the hanging pose takes over). */
export function fallAmount(vy, airTime, grounded, roped, o = FALL_POSE) {
  if (grounded || roped || !(airTime > o.airMin)) return 0;
  const down = -vy;
  if (!(down > o.vMin)) return 0;
  const u = Math.min(1, (down - o.vMin) / (o.vFull - o.vMin));
  return u * u * (3 - 2 * u);
}

/** Deterministic turbulence in -1..1 (a few incommensurate sines): `seed` separates the parts, `rate` scales the frequency with the speed. */
export function flutter(t, seed, rate = 1) {
  const s = seed * 1.7;
  return (Math.sin((t * 9.1 + s) * rate) * 0.55 + Math.sin((t * 14.3 + s * 2.3) * rate) * 0.3 + Math.sin((t * 23.7 + s * 0.7) * rate) * 0.15) / 1.0;
}

/**
 * The offset of a desktop virtual hand in camera space for a fall weight `w` at clock `t`: out to the side, up, a little forward, rolling, with
 * flutter. `side` is -1 for the left hand, 1 for the right. Written into `out` { x, y, z, roll }.
 */
export function handOffset(side, t, w, out, o = FALL_POSE) {
  const h = o.hand;
  const f1 = flutter(t, 1 + (side > 0 ? 0 : 3), 1);
  const f2 = flutter(t, 2 + (side > 0 ? 0 : 5), 1.2);
  out.x = side * h.x * w + f1 * h.flap * w;
  out.y = h.y * w + f2 * h.flap * 1.4 * w;
  out.z = h.z * w + f1 * h.flap * 0.5 * w;
  out.roll = -side * h.roll * w + f2 * 0.18 * w;
  return out;
}

export class FallPose {
  /** @param {object} game  Game3D: player, tethers, climb, input (sockets + tuning), xrActive */
  constructor(game) {
    this.game = game;
    this.w = 0; // the eased weight
    this.t = 0; // clock (s), runs while the pose is on
    this.airT = 0;
    this._off = { x: 0, y: 0, z: 0, roll: 0 };
    this._applied = false;
    this.stats = { w: 0, flail: false };
  }

  /** Once per frame before the views (BodyView reads `w` and `t`). */
  update(dt) {
    const g = this.game;
    const p = g && g.player;
    if (!p || !(dt >= 0)) return;
    dt = Math.min(dt, 0.1);
    if (p.grounded || !p.alive) this.airT = 0;
    else this.airT += dt;
    const th = g.tethers;
    const cl = g.climb;
    const roped = !!((th && th.hands && (th.hands.left.rope.attached || th.hands.right.rope.attached)) || (cl && cl.holding));
    const want = p.alive ? fallAmount(p.vy, this.airT, !!p.grounded, roped) : 0;
    const k = want > this.w ? FALL_POSE.rise : FALL_POSE.fade;
    this.w += (want - this.w) * Math.min(1, dt * k);
    if (this.w < 0.002 && want === 0) this.w = 0;
    if (this.w > 0) this.t += dt * (1 + 0.8 * this.w);
    this.stats.w = this.w;
    this._applyHands();
  }

  /** Desktop only: the virtual hands (input sockets) get the flail offset, and are put back exactly when it is gone. */
  _applyHands() {
    const g = this.game;
    const inp = g && g.input;
    if (!inp || !inp.sockets || !inp.tuning || !inp.tuning.desktopHand || g.xrActive || inp.mode === 'xr') {
      this._applied = false;
      this.stats.flail = false;
      return;
    }
    if (this.w <= 0 && !this._applied) return;
    const base = inp.tuning.desktopHand;
    const o = this._off;
    for (const h of ['left', 'right']) {
      const s = inp.sockets[h];
      if (!s || !s.parent) continue;
      const side = h === 'left' ? -1 : 1;
      handOffset(side, this.t, this.w, o);
      s.position.set(side * base.x + o.x, base.y + o.y, base.z + o.z);
      // the roll is about the hand's own forward axis, on top of the resting aim (inp._deskQuat)
      const dq = inp._deskQuat && inp._deskQuat[h];
      if (dq) {
        s.quaternion.copy(dq);
        s.rotateZ(o.roll);
      }
    }
    this._applied = this.w > 0;
    this.stats.flail = this._applied;
  }
}
