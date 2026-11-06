/* THE LANTERN (ABYSSAL TETHER 3D) — itemGaze.js
 * ITEM CARDS (docs/abyssal-tether-3d/plans/ITEM_CARDS.md): which collectible lying in the world the player is LOOKING at, so its name
 * card can stand over it (render/itemCardView.js). Pure: no three.js, no DOM, no Math.random, no allocation per frame.
 *
 *   const gz = new ItemGaze(opts?)
 *   gz.update(dt, ctx, list, count, occluded?) -> gz.target   once a frame
 *     ctx   { ex, ey, ez, fx, fy, fz, busy }   the eye and the (unit or not) view forward; busy = dead / a menu / applying an item /
 *                                              a cinematic / the victory: nothing shows (the card hides at once)
 *     list  candidates [0, count): { x, y, z, kind, id }  (any object with those fields; read only)
 *     occluded(ex, ey, ez, x, y, z) -> bool    optional line-of-sight test (game: level.raycast); asked for at most two candidates
 *   gz.target  { on, kind, id, x, y, z, dist, ref }   the shown item (on=false: none); `ref` is the candidate object itself
 *   gz.reset()
 *
 * Picking: within RANGE (6 m) and a CONE (11 degrees, widened by the item's own angular radius close up); the score is the angle over the
 * cone plus a distance weight (the nearer of two items on the same line wins). HYSTERESIS: the item shown keeps a wider cone (x1.35) and a
 * score bonus, so two neighbours never flicker. DWELL: a new item must stay the best for 0.2 s before it shows (or replaces the shown
 * one); GRACE: the shown item stays 0.3 s after the look leaves it. An item that leaves the list (collected) hides at once.
 */

export const GAZE = Object.freeze({
  range: 6, // m
  coneDeg: 11, // half-angle
  itemRadius: 0.16, // m: the prop's own size, widens the cone close up
  distWeight: 0.35, // score per (dist / range)
  holdCone: 1.35, // the shown item's cone multiplier
  holdBonus: 0.3, // subtracted from the shown item's score
  dwell: 0.2, // s
  grace: 0.3, // s
  minDist: 0.25, // m: closer than this (inside the body) does not count
  occlusionMargin: 0.3, // m short of the item a hit still counts as the item's own ledge
});

const DEG = Math.PI / 180;

export class ItemGaze {
  constructor(opts = {}) {
    this.range = opts.range > 0 ? opts.range : GAZE.range;
    this.cone = (opts.coneDeg > 0 ? opts.coneDeg : GAZE.coneDeg) * DEG;
    this.dwell = opts.dwell >= 0 ? opts.dwell : GAZE.dwell;
    this.grace = opts.grace >= 0 ? opts.grace : GAZE.grace;
    this.target = { on: false, kind: -1, id: null, x: 0, y: 0, z: 0, dist: 0, ref: null };
    this.pending = null; // candidate object waiting out the dwell
    this.pendingT = 0;
    this.lostT = 0; // s the shown item has not been the pick
    this.stats = { shows: 0, switches: 0, hides: 0, occluded: 0 };
  }

  reset() {
    this._hide();
    this.pending = null;
    this.pendingT = 0;
    this.lostT = 0;
  }

  _hide() {
    const T = this.target;
    if (T.on) this.stats.hides++;
    T.on = false;
    T.kind = -1;
    T.id = null;
    T.ref = null;
  }

  _show(c, dist) {
    const T = this.target;
    if (T.on) this.stats.switches++;
    else this.stats.shows++;
    T.on = true;
    T.kind = c.kind;
    T.id = c.id;
    T.ref = c;
    T.x = c.x;
    T.y = c.y;
    T.z = c.z;
    T.dist = dist;
    this.lostT = 0;
  }

  /** The score of a candidate (lower is better), or Infinity outside the range / cone. Writes the distance to this._d. */
  _score(c, ex, ey, ez, fx, fy, fz, shown) {
    const dx = c.x - ex;
    const dy = c.y - ey;
    const dz = c.z - ez;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this._d = d;
    if (!(d <= this.range) || d < GAZE.minDist) return Infinity;
    let cosA = (dx * fx + dy * fy + dz * fz) / d;
    if (cosA > 1) cosA = 1;
    else if (cosA < -1) cosA = -1;
    const ang = Math.acos(cosA);
    const cone = (this.cone + Math.atan(GAZE.itemRadius / d)) * (shown ? GAZE.holdCone : 1);
    if (ang > cone) return Infinity;
    return ang / cone + GAZE.distWeight * (d / this.range) - (shown ? GAZE.holdBonus : 0);
  }

  update(dt, ctx, list, count, occluded) {
    const T = this.target;
    const step = dt > 0 && dt < 1 ? dt : 0;
    if (!ctx || ctx.busy || !list) {
      this.reset();
      return T;
    }
    const ex = ctx.ex;
    const ey = ctx.ey;
    const ez = ctx.ez;
    let fx = ctx.fx;
    let fy = ctx.fy;
    let fz = ctx.fz;
    const fl = Math.sqrt(fx * fx + fy * fy + fz * fz);
    if (!(fl > 1e-6)) {
      this.reset();
      return T;
    }
    fx /= fl;
    fy /= fl;
    fz /= fl;
    const n = count < list.length ? count : list.length;
    // one pass: the best and the second best (so an occluded best can fall back once); is the shown item still in the list?
    let b1 = null;
    let s1 = Infinity;
    let d1 = 0;
    let b2 = null;
    let s2 = Infinity;
    let d2 = 0;
    let present = false;
    for (let i = 0; i < n; i++) {
      const c = list[i];
      if (!c) continue;
      const shown = T.on && c.id === T.id && c.kind === T.kind;
      if (shown) present = true;
      const s = this._score(c, ex, ey, ez, fx, fy, fz, shown);
      if (s === Infinity) continue;
      if (s < s1) {
        b2 = b1;
        s2 = s1;
        d2 = d1;
        b1 = c;
        s1 = s;
        d1 = this._d;
      } else if (s < s2) {
        b2 = c;
        s2 = s;
        d2 = this._d;
      }
    }
    if (T.on && !present) this._hide(); // collected / gone: no grace for a thing that is not there
    let pick = b1;
    let pd = d1;
    if (pick && typeof occluded === 'function' && occluded(ex, ey, ez, pick.x, pick.y, pick.z)) {
      this.stats.occluded++;
      pick = b2;
      pd = d2;
      if (pick && occluded(ex, ey, ez, pick.x, pick.y, pick.z)) pick = null;
    }
    const isShown = pick && T.on && pick.id === T.id && pick.kind === T.kind;
    if (isShown) {
      // still looking at it: refresh its place (an item never moves today, but a debug spawn or a respawn may) and forget any pending one
      T.x = pick.x;
      T.y = pick.y;
      T.z = pick.z;
      T.dist = pd;
      this.lostT = 0;
      this.pending = null;
      this.pendingT = 0;
      return T;
    }
    // a different pick (or none): it must hold for the dwell; the shown one waits out the grace
    if (pick) {
      if (this.pending === pick) this.pendingT += step;
      else {
        this.pending = pick;
        this.pendingT = step;
      }
      if (this.pendingT >= this.dwell - 1e-9) {
        this._show(pick, pd);
        this.pending = null;
        this.pendingT = 0;
        return T;
      }
    } else {
      this.pending = null;
      this.pendingT = 0;
    }
    if (T.on) {
      this.lostT += step;
      if (this.lostT >= this.grace - 1e-9) this._hide(); // (another item dwelling replaces it at the end of its own dwell instead)
    }
    return T;
  }
}

/**
 * A line-of-sight test from a level with `raycast(ox, oy, oz, dx, dy, dz, maxDist, out)` (sim/level3d.js): true when a solid stands
 * between the eye and the item (a hit more than `occlusionMargin` short of it). Returns a function that reuses one hit object.
 */
export function levelOccluder(getLevel) {
  const out = { t: 0, solid: null, x: 0, y: 0, z: 0 };
  return (ex, ey, ez, x, y, z) => {
    const lv = getLevel();
    if (!lv || typeof lv.raycast !== 'function') return false;
    const ty = y + 0.08; // the prop's top, not the stone it lies on
    const dx = x - ex;
    const dy = ty - ey;
    const dz = z - ez;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < 0.5) return false;
    const hit = lv.raycast(ex, ey, ez, dx, dy, dz, d, out);
    return !!(hit && hit.t < d - GAZE.occlusionMargin);
  };
}
