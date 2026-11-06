/* ABYSSAL TETHER 3D — render/mason/masonStinger.js
 * A big sharp stinger on the tail of the Mason (and, smaller, the skitterlings), like a hornet's but far larger: a swollen venom bulb at the root,
 * banded like a hornet's abdomen (amber on near-black), then a long needle that curves up over the back and ends in a point.
 *
 *   - stingerGeometry(): one indexed BufferGeometry from code (no asset): a tube along a bezier, radius = a bulb that tapers to a needle, ten
 *     sides, ~540 triangles, vertex colours only. The tip radius is under 1 cm at kit scale: a spike, not a rod.
 *   - Stinger: the mesh, mounted on the view's root and driven from the LAST spine bone's world matrix (the rig's bones are not in the scene
 *     graph, so a child of a bone is never drawn), shown at full detail only. The tail bone's frame is (right, up, back), so the needle runs
 *     along +z (away from the head) and curls toward +y (up, off the wall the creature clings to).
 */
import * as THREE from 'three';

export const STINGER = {
  length: 10.0, // m at kit scale (the tail bone is scaled ~0.4-0.6 by the taper, so ~4-6 m in the world)
  baseRadius: 0.78,
  sides: 10,
  rings: 26,
  forward: -0.35, // m: pushed back into the last block so the root is hidden inside it
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

function bez(P, t, out) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  for (let k = 0; k < 3; k++) out[k] = a * P[0][k] + b * P[1][k] + c * P[2][k] + d * P[3][k];
  return out;
}

/** Returns { geometry, tip, triangles, radiusAt(t) }. */
export function stingerGeometry(opts = {}) {
  const L = opts.length || STINGER.length;
  const R0 = opts.baseRadius || STINGER.baseRadius;
  const sides = opts.sides || STINGER.sides;
  const rings = opts.rings || STINGER.rings;
  // out along +z (back, away from the head), curling up (+y) toward the point
  const P = [
    [0, 0, 0],
    [0, 0.02 * L, 0.4 * L],
    [0, 0.1 * L, 0.8 * L],
    [0, 0.36 * L, 1.0 * L],
  ];
  // the radius: a venom bulb just off the root, then a long taper to a needle
  const radiusAt = (t) => R0 * (0.78 + 0.5 * Math.exp(-(((t - 0.1) / 0.11) ** 2))) * Math.pow(1 - t, 1.25) + 0.004;
  const pos = [];
  const nrm = [];
  const col = [];
  const idx = [];
  const p = [0, 0, 0];
  const q = [0, 0, 0];
  const centres = [];
  const tans = [];
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
    centres.push([p[0], p[1], p[2] + STINGER.forward * (1 - t)]);
    tans.push([tx / tl, ty / tl, tz / tl]);
  }
  // parallel-transport frames
  let ux = 1;
  let uy = 0;
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
    frames.push([ux, uy, uz, ty * uz - tz * uy, tz * ux - tx * uz, tx * uy - ty * ux]);
  }
  const black = [0.035, 0.028, 0.022];
  const amber = [0.62, 0.34, 0.04];
  const tipc = [0.86, 0.62, 0.26];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const [cx, cy, cz] = centres[i];
    const f = frames[i];
    const r = radiusAt(t);
    // hornet stripes over the bulb (amber / black, soft-edged), then a dark needle that warms to a pale amber point
    const stripe = t < 0.5 ? smooth(0.35, 0.65, 0.5 + 0.5 * Math.sin(t * 46)) : 0;
    const needle = smooth(0.45, 0.98, t);
    for (let s = 0; s < sides; s++) {
      const a = (s / sides) * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const nx = f[0] * ca + f[3] * sa;
      const ny = f[1] * ca + f[4] * sa;
      const nz = f[2] * ca + f[5] * sa;
      pos.push(cx + nx * r, cy + ny * r, cz + nz * r);
      nrm.push(nx, ny, nz);
      const k1 = stripe * (1 - needle);
      const base = [black[0] + (amber[0] - black[0]) * k1, black[1] + (amber[1] - black[1]) * k1, black[2] + (amber[2] - black[2]) * k1];
      col.push(base[0] + (tipc[0] - base[0]) * needle * needle, base[1] + (tipc[1] - base[1]) * needle * needle, base[2] + (tipc[2] - base[2]) * needle * needle);
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
  // the root cap
  const rc = pos.length / 3;
  pos.push(centres[0][0], centres[0][1], centres[0][2]);
  nrm.push(-tans[0][0], -tans[0][1], -tans[0][2]);
  col.push(black[0], black[1], black[2]);
  for (let s = 0; s < sides; s++) idx.push(rc, s, (s + 1) % sides);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geometry.setIndex(idx);
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  const tip = centres[rings];
  return { geometry, tip: [tip[0], tip[1], tip[2]], triangles: idx.length / 3, radiusAt };
}

export class Stinger {
  /** @param {{variant?: boolean}} [opts] */
  constructor(opts = {}) {
    const built = stingerGeometry({ length: STINGER.length * (opts.variant ? 0.8 : 1) });
    this.geometry = built.geometry;
    this.triangles = built.triangles;
    this.tip = built.tip;
    this.material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.25 });
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'Stinger';
    this.mesh.frustumCulled = false; // it rides a posed bone whose bounds the mesh does not know
    this.group = new THREE.Group();
    this.group.name = 'StingerMount';
    this.group.add(this.mesh);
  }

  /** Mounts on `parent` (the view root) with a driven matrix; see the file header for why not on the bone. */
  mount(parent) {
    if (this.group.parent !== parent) parent.add(this.group);
    this.group.matrixAutoUpdate = false;
    return this;
  }

  /** Puts the stinger where the last spine bone is (`world` = its world matrix; `rootWorld` = the mount's, if it is not the identity). */
  follow(world, rootWorld) {
    const m = this.group.matrix;
    if (rootWorld) m.copy(rootWorld).invert().multiply(world);
    else m.copy(world);
    this.group.matrixWorldNeedsUpdate = true;
    return this;
  }

  update(show) {
    this.group.visible = !!show;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    if (this.group.parent) this.group.parent.remove(this.group);
  }
}
