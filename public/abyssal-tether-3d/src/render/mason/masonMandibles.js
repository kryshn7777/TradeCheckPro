/* ABYSSAL TETHER 3D — render/mason/masonMandibles.js
 * Big mandibles for the Mason (and, smaller, the skitterlings): two crescent pincers that hang from the corners of the mouth, bow out to the
 * sides and curl down and inward under the mouth like a pair of forceps, and swing open and snap shut, so a creature that is coming for you has
 * jaws. (The first versions were modelled bowing INWARD, so they crossed over the face in an X; the shape drawn by the owner is a "( )" frame
 * around the mouth.)
 *
 *   - mandibleGeometry(): ONE indexed BufferGeometry per mandible, built from code (no asset), in the head's frame (x right, y up, z back: the
 *     face looks down -z): a tube along a crescent centre line, thick at the root (a bulge), tapering to a point, a ten-sided section, plus a
 *     row of serrations on the inner edge. ~550 triangles, vertex colours dark bone at the root to pale bone at the tip with faint growth
 *     rings, so no texture.
 *   - mandibleOpen(snap, t, seed, prev): the opening angle (rad) as a pure function of the clip graph's snapshot: it idles slightly open and
 *     clicks while it listens, spreads as it hunts, flares wide through the attack's wind-up, SNAPS shut on the strike (the tips meet),
 *     and eases back open through the recoil.
 *   - Mandibles: the two meshes, mounted on the view's root and following the head (neck) bone's world matrix so they follow the head fit and
 *     the crown's aim (the rig's bones are not in the scene graph); shown with the full LOD only.
 */
import * as THREE from 'three';

export const MANDIBLE = {
  length: 6.0, // m at kit scale: big pincers on the sides of a ~7 m crown (the first, 4.6 m, were small; 9 m tusks were far too big)
  baseRadius: 0.55,
  sides: 10,
  rings: 24,
  teeth: 6, // serrations along the inner edge
  // where the roots sit, at the CORNERS of the mouth (the maw is +-1.55 wide), in the neck bone's frame at kit scale (x right, y up, z back: the
  // face looks down -z). Tuned against renders.
  root: { x: 1.9, y: -0.7, z: -2.0 },
  yaw: 0, // rest offset (rad) added to the opening angle
  swing: 0.5, // rad of swing about the forward axis per rad of "opening": a hanging crescent swings out when it opens and in when it snaps shut
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Cubic Bezier through P0..P3 (arrays of 3): point at t. */
function bez(P, t, out) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  for (let k = 0; k < 3; k++) out[k] = a * P[0][k] + b * P[1][k] + c * P[2][k] + d * P[3][k];
  return out;
}

/**
 * The right-hand mandible in the head's frame (the root at the origin; x right, y up, z back, so forward is -z): it leaves the mouth corner
 * going out (+x), bows to the side, falls (-y) and curls back in (-x) and forward (-z) so the point ends under the mouth, in front of the chin;
 * the left one is this mirrored (scale.x = -1). Returns { geometry, tip, triangles }.
 */
export function mandibleGeometry(opts = {}) {
  const L = opts.length || MANDIBLE.length;
  const R0 = opts.baseRadius || MANDIBLE.baseRadius;
  const sides = opts.sides || MANDIBLE.sides;
  const rings = opts.rings || MANDIBLE.rings;
  const nTeeth = opts.teeth == null ? MANDIBLE.teeth : opts.teeth;
  // the centre line, a crescent seen head-on as one side of a "( )" around the mouth: out from the corner of the mouth, bowed out to the side
  // (about a quarter of its length), then down (about 0.6 L below the root) and curling in so the point ends below the mouth, a little in front
  // of it. Seen face-on the whole curve is in the picture (it is not edge-on), and it frames the maw
  const P = [
    [0, 0, 0],
    [0.34 * L, 0.02 * L, -0.06 * L],
    [0.4 * L, -0.45 * L, -0.12 * L],
    [-0.18 * L, -0.62 * L, -0.3 * L],
  ];
  const pos = [];
  const col = [];
  const nrm = [];
  const idx = [];
  const p = [0, 0, 0];
  const q = [0, 0, 0];
  const centres = [];
  const tans = [];
  const rads = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    bez(P, t, p);
    bez(P, Math.min(1, t + 0.01), q);
    let tx = q[0] - p[0];
    let ty = q[1] - p[1];
    let tz = q[2] - p[2];
    if (t >= 0.99) {
      bez(P, t - 0.01, q);
      tx = p[0] - q[0];
      ty = p[1] - q[1];
      tz = p[2] - q[2];
    }
    const tl = Math.hypot(tx, ty, tz) || 1;
    tx /= tl;
    ty /= tl;
    tz /= tl;
    centres.push([p[0], p[1], p[2]]);
    tans.push([tx, ty, tz]);
    // a muscular bulge just off the root, then a long taper to a point
    const bulge = 1 + 0.32 * Math.exp(-(((t - 0.1) / 0.1) ** 2));
    rads.push(R0 * bulge * Math.pow(1 - t, 0.85) + 0.012);
  }
  // parallel-transport frames so the section does not twist along the hook
  let ux = 0;
  let uy = 1;
  let uz = 0;
  const frames = [];
  for (let i = 0; i <= rings; i++) {
    const [tx, ty, tz] = tans[i];
    const d = ux * tx + uy * ty + uz * tz;
    ux -= tx * d;
    uy -= ty * d;
    uz -= tz * d;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul;
    uy /= ul;
    uz /= ul;
    // right = t x u
    frames.push([ux, uy, uz, ty * uz - tz * uy, tz * ux - tx * uz, tx * uy - ty * ux]);
  }
  const root = [0.2, 0.16, 0.12]; // dark, stained bone at the root
  const tipc = [0.66, 0.6, 0.5]; // pale bone
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const [cx, cy, cz] = centres[i];
    const f = frames[i];
    const r = rads[i];
    const k = smooth(0.1, 0.85, t);
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      // a slightly flattened (taller than wide) section: the horn is a blade, not a rod
      const nx = f[0] * sa * 1.0 + f[3] * ca * 0.82;
      const ny = f[1] * sa * 1.0 + f[4] * ca * 0.82;
      const nz = f[2] * sa * 1.0 + f[5] * ca * 0.82;
      pos.push(cx + nx * r, cy + ny * r, cz + nz * r);
      const nl = Math.hypot(f[0] * sa + f[3] * ca, f[1] * sa + f[4] * ca, f[2] * sa + f[5] * ca) || 1;
      nrm.push((f[0] * sa + f[3] * ca) / nl, (f[1] * sa + f[4] * ca) / nl, (f[2] * sa + f[5] * ca) / nl);
      // faint growth rings along the length (bone grows in layers): a slow +-7 % banding, a little stronger on the underside
      const ring = 1 + 0.07 * Math.sin(t * L * 3.4) * (0.7 + 0.3 * Math.sin(a));
      col.push((root[0] + (tipc[0] - root[0]) * k) * ring, (root[1] + (tipc[1] - root[1]) * k) * ring, (root[2] + (tipc[2] - root[2]) * k) * ring);
    }
  }
  for (let i = 0; i < rings; i++) {
    for (let s = 0; s < sides; s++) {
      const a = i * sides + s;
      const b = i * sides + ((s + 1) % sides);
      const c = (i + 1) * sides + s;
      const d = (i + 1) * sides + ((s + 1) % sides);
      idx.push(a, c, b, b, c, d);
    }
  }
  // the root cap (a fan, so the horn is closed where it meets the head)
  const rc = pos.length / 3;
  pos.push(centres[0][0], centres[0][1], centres[0][2]);
  nrm.push(-tans[0][0], -tans[0][1], -tans[0][2]);
  col.push(root[0], root[1], root[2]);
  for (let s = 0; s < sides; s++) idx.push(rc, s, (s + 1) % sides);
  // teeth along the INNER edge (the side facing the mouth and the other horn: -x), pointing forward and inward
  for (let k = 0; k < nTeeth; k++) {
    const t = 0.3 + (0.58 * k) / Math.max(1, nTeeth - 1);
    const i = Math.round(t * rings);
    const [cx, cy, cz] = centres[i];
    const [tx, ty, tz] = tans[i];
    const f = frames[i];
    // inward = the section's -right direction projected to be mostly -x
    let ix = -f[3];
    let iy = -f[4];
    let iz = -f[5];
    if (ix > 0) {
      ix = -ix;
      iy = -iy;
      iz = -iz;
    }
    const r = rads[i];
    const h = (0.5 + 0.35 * (1 - t)) * r * 2.2; // serrations: taller near the root, small toward the tip
    const w = r * 0.5;
    const base = pos.length / 3;
    // a four-sided spike: base square across (up, tangent) at the inner surface, tip forward and inward
    const bx = cx + ix * r * 0.9;
    const by = cy + iy * r * 0.9;
    const bz = cz + iz * r * 0.9;
    const tipx = bx + ix * h * 0.55 + tx * h * 0.9;
    const tipy = by + iy * h * 0.55 + ty * h * 0.9;
    const tipz = bz + iz * h * 0.55 + tz * h * 0.9;
    const corners = [
      [bx + f[0] * w, by + f[1] * w, bz + f[2] * w],
      [bx + tx * w * 1.6, by + ty * w * 1.6, bz + tz * w * 1.6],
      [bx - f[0] * w, by - f[1] * w, bz - f[2] * w],
      [bx - tx * w * 0.6, by - ty * w * 0.6, bz - tz * w * 0.6],
    ];
    for (const c of corners) {
      pos.push(c[0], c[1], c[2]);
      nrm.push(ix, iy, iz);
      col.push(0.5, 0.46, 0.4);
    }
    pos.push(tipx, tipy, tipz);
    nrm.push(ix * 0.5 + tx * 0.5, iy * 0.5 + ty * 0.5, iz * 0.5 + tz * 0.5);
    col.push(0.78, 0.74, 0.66);
    for (let c = 0; c < 4; c++) idx.push(base + c, base + 4, base + ((c + 1) % 4));
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geometry.setIndex(idx);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  const tip = centres[rings];
  return { geometry, tip: [tip[0], tip[1], tip[2]], triangles: idx.length / 3 };
}

/**
 * The opening angle of each horn (rad, 0 = hanging straight, positive = swung apart, negative = swung in and crossed under the mouth; the
 * swing about the forward axis is MANDIBLE.swing times this), as a pure function of the clip graph's
 * snapshot `snap` { state, phase, atkT, atkWindup, listening, creeping, jitter, distance, sighting } and the time t (s). `seed` varies the
 * idle twitch between creatures. Eased by the caller (Mandibles.update).
 */
export function mandibleOpen(snap, t, seed = 0) {
  const idle = 0.3 + 0.05 * Math.sin(t * 1.3 + seed * 6.1);
  const click = (a, hz) => a * Math.max(0, Math.sin(t * hz * 6.2832 + seed * 3.7)) ** 3;
  if (!snap) return idle;
  const hunt = smooth(40, 6, snap.distance == null ? 99 : snap.distance); // 0 far .. 1 close: it spreads as it comes
  switch (snap.phase) {
    case 'windup': {
      const e = smooth(0, 1, snap.atkT / Math.max(snap.atkWindup, 0.05));
      return 0.45 + 0.65 * e;
    }
    case 'strike':
      return -0.55; // SNAPS shut: the two tips cross in front of the mouth
    case 'recoil': {
      const e = smooth(0, 0.45, snap.atkT);
      return -0.4 + 0.9 * e;
    }
    default:
  }
  // a surge CHOMPS: the jaws work open and shut as it runs at you
  if (snap.state === 'BURST') return 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(t * 20 + seed * 5));
  if (snap.listening) return 0.26 + click(0.12, 5.2);
  if (snap.creeping) return 0.34 + click(0.1, 3.4);
  if (snap.state === 'PURSUING' || snap.state === 'APPROACHING') {
    // hunting: still jaws far away, working jaws as it comes (a chew about 2.4 Hz when it is on you)
    const chew = 0.5 + 0.5 * Math.sin(t * (1.1 + 1.3 * hunt) * 6.2832 + seed * 4.1);
    const lo = 0.28 + 0.14 * hunt;
    return lo + 0.62 * hunt * chew;
  }
  if (snap.state === 'RECOVERING') return 0.22 + 0.04 * Math.sin(t * 2);
  return idle;
}

const MAT = () =>
  new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.5,
    metalness: 0.3,
    flatShading: false,
  });

export class Mandibles {
  /**
   * @param {{size?:number, seed?:number, variant?:boolean}} [opts]  size: the creature's scale (the horns scale with the head bone anyway; this
   *   only shortens the skitterling's, which carry smaller ones)
   */
  constructor(opts = {}) {
    this.seed = opts.seed || 0;
    const built = mandibleGeometry({ length: MANDIBLE.length * (opts.variant ? 0.8 : 1), baseRadius: MANDIBLE.baseRadius * (opts.variant ? 0.8 : 1) });
    this.geometry = built.geometry;
    this.triangles = built.triangles * 2;
    this.tip = built.tip;
    this.material = MAT();
    this.group = new THREE.Group();
    this.group.name = 'Mandibles';
    this.pivots = [];
    this.meshes = [];
    this.open = MANDIBLE.yaw + 0.3;
    this.vel = 0;
    for (const s of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(s * MANDIBLE.root.x, MANDIBLE.root.y, MANDIBLE.root.z);
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.name = s > 0 ? 'MandibleR' : 'MandibleL';
      mesh.frustumCulled = false; // it rides a skinned head whose bounds the mesh does not know
      mesh.scale.x = s; // the left one is the mirror
      pivot.add(mesh);
      this.group.add(pivot);
      this.pivots.push(pivot);
      this.meshes.push(mesh);
    }
    this.sign = [1, -1];
    this._apply(this.open);
  }

  /**
   * Mounts the horns on `parent` (the view's root). The rig's bones are DETACHED from the scene (their matrices are composed by hand and
   * only the skinned meshes are in the scene graph), so a child of a bone would never be drawn: the group's matrix is driven by follow().
   */
  mount(parent) {
    if (this.group.parent !== parent) parent.add(this.group);
    this.group.matrixAutoUpdate = false;
    return this;
  }

  /**
   * Puts the horns where a bone is: `world` = that bone's world matrix; `rootWorld` (optional) = the matrix of the parent they were mounted
   * on (the bone matrices are world-space, the group is relative to its parent).
   */
  follow(world, rootWorld) {
    const m = this.group.matrix;
    if (rootWorld) m.copy(rootWorld).invert().multiply(world);
    else m.copy(world);
    this.group.matrixWorldNeedsUpdate = true;
    return this;
  }

  _apply(a) {
    // the crescents hang from the mouth corners: opening swings the points out about the forward axis (+z on the right horn: a vector
    // pointing down turns toward +x), the left horn the other way
    for (let i = 0; i < 2; i++) this.pivots[i].rotation.set(0, 0, this.sign[i] * a * MANDIBLE.swing);
  }

  /**
   * @param {number} dt
   * @param {object} snap  the clip graph's snapshot
   * @param {number} t     view time (s)
   * @param {boolean} show full LOD only
   */
  update(dt, snap, t, show) {
    this.group.visible = !!show;
    if (!show || !(dt > 0)) return;
    const want = mandibleOpen(snap, t, this.seed);
    // a damped spring; the snap shut is much stiffer than the slow spread
    const closing = want < this.open - 0.05 && snap && snap.phase === 'strike';
    const w0 = closing ? 55 : 11;
    const z = closing ? 0.9 : 0.75;
    const n = Math.max(1, Math.ceil(dt / 0.008));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.vel += (w0 * w0 * (want - this.open) - 2 * z * w0 * this.vel) * h;
      this.open += this.vel * h;
    }
    this.open = clamp(this.open, -0.7, 1.3);
    this._apply(this.open);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
