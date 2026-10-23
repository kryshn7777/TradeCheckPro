/* ABYSSAL TETHER 3D — mason/masonFit.js
 * Keeps the ~8 m crown out of the walls. The sim keeps the head point >= 1 m from masonry, but the crown is 5.8 m wide and 11 m
 * tall at kit scale: this casts four rays (dorsal, ventral, right, left) from the head against the level's structural solids,
 * shrinks the crown to what fits (never below `minScale`) and lifts it off the wall it clings to so the bottom of the portal does
 * not bury itself. Smoothed (shrinks fast, grows slowly), allocation-free. The sim and the level data are not touched.
 */
import { castBox } from './masonLegs.js';
import { clamp } from './masonPose.js';

const EXT = { down: 5.2, up: 6.1, right: 3.2, left: 2.6 }; // v1 crown extents at kit scale (the default when the GLB has no headBounds)

/** Crown extents from the rig's glTF extras (headBounds lo / hi, glTF axes: +x right, +y dorsal); EXT when absent. */
export function headExtents(bounds) {
  if (!bounds || !bounds.lo || !bounds.hi) return EXT;
  return { down: Math.max(0.5, -bounds.lo[1]), up: Math.max(0.5, bounds.hi[1]), right: Math.max(0.5, bounds.hi[0]), left: Math.max(0.5, -bounds.lo[0]) };
}
const MAX_T = 14;

export class HeadFit {
  /** @param {{down:number, up:number, right:number, left:number}} [ext]  crown extents at kit scale (headExtents(meta.headBounds)) */
  constructor(ext) {
    this.ext = ext || EXT;
    this.scale = 0.7;
    this.lift = 0;
    this.clear = new Float32Array(4); // down, up, right, left
    this.solids = [];
    this._init = false;
    this.minScale = 0.34;
    this.maxScale = 0.9;
  }

  reset() {
    this._init = false;
  }

  /**
   * @param {object} level  sim level (querySolids)
   * @param {number} cap  section ceiling for the crown scale
   * Head frame: position (hx,hy,hz), up u, right r.
   */
  update(dt, level, hx, hy, hz, ux, uy, uz, rx, ry, rz, cap) {
    const c = this.clear;
    c[0] = c[1] = c[2] = c[3] = MAX_T;
    if (level && typeof level.querySolids === 'function') {
      const R = MAX_T;
      const list = level.querySolids(hx - R, hy - R, hz - R, hx + R, hy + R, hz + R, this.solids);
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        if (!structural(b) || b.minX < hx && hx < b.maxX && b.minY < hy && hy < b.maxY && b.minZ < hz && hz < b.maxZ) continue; // a box the head point sits inside is not a wall to fit against
        let t = castBox(hx, hy, hz, -ux, -uy, -uz, b, c[0]);
        if (t > 0.05 && t < c[0]) c[0] = t;
        t = castBox(hx, hy, hz, ux, uy, uz, b, c[1]);
        if (t > 0.05 && t < c[1]) c[1] = t;
        t = castBox(hx, hy, hz, rx, ry, rz, b, c[2]);
        if (t > 0.05 && t < c[2]) c[2] = t;
        t = castBox(hx, hy, hz, -rx, -ry, -rz, b, c[3]);
        if (t > 0.05 && t < c[3]) c[3] = t;
      }
    }
    // the shaft's inner faces (the sim clamps the head to them; the faces are not always solids)
    const sh = level && typeof level.shaftAt === 'function' ? level.shaftAt(hy) : null;
    if (sh && hx > sh.minX && hx < sh.maxX && hz > sh.minZ && hz < sh.maxZ) {
      c[0] = Math.min(c[0], shaftExit(sh, hx, hz, -ux, -uz));
      c[1] = Math.min(c[1], shaftExit(sh, hx, hz, ux, uz));
      c[2] = Math.min(c[2], shaftExit(sh, hx, hz, rx, rz));
      c[3] = Math.min(c[3], shaftExit(sh, hx, hz, -rx, -rz));
    }
    const E = this.ext;
    const hsV = (c[0] + c[1] - 0.6) / (E.down + E.up);
    const hsR = (c[2] - 0.3) / E.right;
    const hsL = (c[3] - 0.3) / E.left;
    const target = clamp(Math.min(cap, hsV, hsR, hsL), this.minScale, this.maxScale);
    // lift along the dorsal axis so the portal's lower edge clears the surface it clings to (and the top clears the ceiling)
    let liftT = clamp(E.down * target - c[0] + 0.4, 0, E.down * target);
    const room = c[1] - E.up * target - 0.25;
    if (liftT > room) liftT = Math.max(0, room);
    if (!this._init) {
      this.scale = target;
      this.lift = liftT;
      this._init = true;
      return;
    }
    const kd = dt > 0 ? Math.min(dt, 0.1) : 0;
    this.scale += (target - this.scale) * (1 - Math.exp(-kd * (target < this.scale ? 7 : 1.4)));
    this.lift += (liftT - this.lift) * (1 - Math.exp(-kd * (liftT < this.lift ? 3 : 2)));
  }
}

/** Distance to the shaft's walls along the horizontal part (dx, dz) of a direction (MAX_T when it points straight along the shaft). */
function shaftExit(sh, x, z, dx, dz) {
  let t = MAX_T;
  if (dx > 1e-6) t = Math.min(t, (sh.maxX - x) / dx);
  else if (dx < -1e-6) t = Math.min(t, (sh.minX - x) / dx);
  if (dz > 1e-6) t = Math.min(t, (sh.maxZ - z) / dz);
  else if (dz < -1e-6) t = Math.min(t, (sh.minZ - z) / dz);
  return Math.max(0, t);
}

function structural(b) {
  if (b.active === false || b.kind === 'crumble' || b.kind === 'grate' || b.kind === 'bridge') return false;
  if (b.kind === 'wall' || b.kind === 'pillar') return true;
  const a = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const c = b.maxZ - b.minZ;
  const mid = Math.max(Math.min(a, h), Math.min(Math.max(a, h), c));
  return mid >= 4;
}
