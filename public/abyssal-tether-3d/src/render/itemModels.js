/* THE LANTERN (ABYSSAL TETHER 3D) — itemModels.js
 * The hand-sized props the expedition left behind, as procedural merged geometry (vertex colours only, no texture, no sampler):
 *
 *   buildFirstAid(tilt)   an old field medical case: chipped cream enamel over dark iron, a faded red cross on both faces, a dark
 *                         steel rim round the seam, riveted corner caps, a leather strap handle on two brackets, two brass latches
 *                         thrown open and the lid sprung ajar at the top, a fold of gauze showing in the gap and hanging over the edge.
 *                         Upright: handle +Y, the lid (front) face +Z. ~0.31 x 0.25 x 0.13 m.
 *   buildBandage(tilt)    a field dressing: a folded linen pad (a folded top layer), half still in its torn kraft-paper wrapper, bound
 *                         with twine both ways, a dried blood stain soaking one corner, two long linen tails trailing out of one end
 *                         and lying in loose curves on the ground, frayed at the tips, a safety pin through one. Lies flat (thin in Y).
 *                         Flat and long, never a drum: it cannot be read as a roll.
 *   buildGrenade(tilt)    the expedition soldiers' fused iron fragmentation grenade: a ribbed (segmented) cast-iron egg with a smooth
 *                         waist band, rust, a tarnished brass fuse cap and collar, a steel lever down the +X flank, a split pin and a
 *                         pull ring on +Z with a short frayed cord. Upright: fuse +Y.
 *   buildSidearm(tilt)    an old service revolver seen in profile: a dark blued-steel frame worn bright at the edges, a fluted
 *                         cylinder, barrel with ejector housing and a front sight, hammer, trigger guard, a walnut bird's-head grip with
 *                         a butt cap and a lanyard ring, rust in the corners. Profile in XY (muzzle +X), thin in Z.
 *
 * Every builder returns the pickups template format (render/pickupsView.js): { pos, nor, col: Float32Array, idx: Uint16Array, verts }
 * in metres, origin at the prop centre, tilted by `tilt` rad about +X (the floating pickups lean toward the viewer; dropped props
 * pass 0). One merged geometry per kind (one draw call in the shared pickups / dropped-props meshes). Deterministic: every bit of wear
 * comes from a coordinate hash, never Math.random. Each kind stays under ITEM_MODEL_CAPS.verts so 48 pickups fit a Uint16 index.
 *
 * MODEL_REST[name] = { h, euler, body } describes the prop lying on a floor (render/droppedProps.js): `euler` [x, y, z] is the lying
 * rotation of the untilted model, `h` the height of its centre above the surface in that pose, `body` the restitution / friction / spin
 * decay per impact. Wiring a new kind is one line in each table (see docs/abyssal-tether-3d/plans/ITEM_MODELS.md).
 */

import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';

export const ITEM_MODEL_CAPS = Object.freeze({ verts: 1300, tris: 1500 });

export const MODEL_REST = Object.freeze({
  // on its back, the lid face up (the cross shows to the lantern)
  FIRST_AID: Object.freeze({ h: 0.0574, euler: Object.freeze([-Math.PI / 2, 0, 0]), body: Object.freeze({ e: 0.26, mu: 0.7, spin: 0.55 }) }),
  // as modelled: flat on the ground, tails out (cloth: hardly bounces, slides little)
  BANDAGE: Object.freeze({ h: 0.0224, euler: Object.freeze([0, 0, 0]), body: Object.freeze({ e: 0.06, mu: 0.45, spin: 0.3 }) }),
  // on its side, the lever up
  GRENADE: Object.freeze({ h: 0.029, euler: Object.freeze([0, 0, Math.PI / 2]), body: Object.freeze({ e: 0.3, mu: 0.75, spin: 0.6 }) }),
  // on its side, the right-hand face (+Z) up
  SIDEARM: Object.freeze({ h: 0.0205, euler: Object.freeze([-Math.PI / 2, 0, 0]), body: Object.freeze({ e: 0.22, mu: 0.6, spin: 0.5 }) }),
});

/** The lying rotation of a MODEL_REST entry as a quaternion (built once by the caller). */
export function restQuaternion(name) {
  const r = MODEL_REST[name];
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(r.euler[0], r.euler[1], r.euler[2]));
}

// ---------------------------------------------------------------------------------------------
// Deterministic wear: an integer hash of the quantised coordinate, and a smooth value noise on it
// ---------------------------------------------------------------------------------------------

function ihash(ix, iy, iz) {
  let h = (Math.imul(ix | 0, 0x27d4eb2d) ^ Math.imul(iy | 0, 0x165667b1) ^ Math.imul(iz | 0, 0x9e3779b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
/** Value noise 0..1 at (x, y, z) * f (f = cells per metre), trilinear with a smoothstep. */
function vnoise(x, y, z, f) {
  const X = x * f;
  const Y = y * f;
  const Z = z * f;
  const ix = Math.floor(X);
  const iy = Math.floor(Y);
  const iz = Math.floor(Z);
  const s = (t) => t * t * (3 - 2 * t);
  const fx = s(X - ix);
  const fy = s(Y - iy);
  const fz = s(Z - iz);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => ihash(ix + dx, iy + dy, iz + dz);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy),
    l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  );
}
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const col = (hex) => new THREE.Color(hex);
const _c = new THREE.Color();
/** c = mix(c, hex colour, k) */
const mixTo = (c, other, k) => c.lerp(other, Math.min(1, Math.max(0, k)));

// ---------------------------------------------------------------------------------------------
// Merge: parts { geo, pos, rot, scale, pre (Matrix4 applied after the part's own TRS), color, paint(c, x, y, z, nx, ny, nz), crease }
// ---------------------------------------------------------------------------------------------

function mergeModel(parts, tilt = 0, size = 1) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const tm = new THREE.Matrix4().makeRotationX(tilt);
  const tn = new THREE.Matrix3().getNormalMatrix(tm);
  const v = new THREE.Vector3();
  const pos = [];
  const nor = [];
  const colr = [];
  const idx = [];
  const c = new THREE.Color();
  for (const p of parts) {
    let g = p.geo;
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    e.set(p.rot ? p.rot[0] : 0, p.rot ? p.rot[1] : 0, p.rot ? p.rot[2] : 0);
    q.setFromEuler(e);
    const s = p.scale || [1, 1, 1];
    m.compose(v.set(p.pos ? p.pos[0] : 0, p.pos ? p.pos[1] : 0, p.pos ? p.pos[2] : 0), q, new THREE.Vector3(s[0], s[1], s[2]));
    if (p.pre) m.premultiply(p.pre);
    g.applyMatrix4(m);
    // crease the normals (hard edges stay hard, curved surfaces smooth), then weld; done 100x up because the crease hash is 1 cm
    g.scale(100, 100, 100);
    const cg = toCreasedNormals(g, p.crease != null ? p.crease : 0.9);
    if (cg !== g) g.dispose();
    const wg = mergeVertices(cg, 1e-3);
    cg.dispose();
    wg.scale(0.01, 0.01, 0.01);
    g = wg;
    const pa = g.attributes.position;
    const na = g.attributes.normal;
    const base = pos.length / 3;
    for (let i = 0; i < pa.count; i++) {
      const x = pa.getX(i);
      const y = pa.getY(i);
      const z = pa.getZ(i);
      c.copy(p.color);
      if (p.paint) p.paint(c, x, y, z, na.getX(i), na.getY(i), na.getZ(i));
      v.set(x, y, z).applyMatrix4(tm);
      pos.push(v.x * size, v.y * size, v.z * size);
      v.set(na.getX(i), na.getY(i), na.getZ(i)).applyMatrix3(tn).normalize();
      nor.push(v.x, v.y, v.z);
      colr.push(c.r, c.g, c.b);
    }
    const ia = g.index;
    for (let i = 0; i < ia.count; i++) idx.push(base + ia.getX(i));
    g.dispose();
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), col: new Float32Array(colr), idx: new Uint16Array(idx), verts: pos.length / 3 };
}

// ---------------------------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------------------------

const box = (w, h, d, sx = 1, sy = 1, sz = 1) => new THREE.BoxGeometry(w, h, d, sx, sy, sz);
const cyl = (r0, r1, h, seg = 10, open = false) => new THREE.CylinderGeometry(r0, r1, h, seg, 1, open);
const sph = (r, ws = 6, hs = 4) => new THREE.SphereGeometry(r, ws, hs);

/** A box with rounded edges and corners (radius r), subdivided (sx, sy, sz) so the paint has vertices inside its faces. */
function roundBox(w, h, d, r, sx, sy, sz) {
  const g = new THREE.BoxGeometry(w, h, d, sx, sy, sz);
  const p = g.attributes.position;
  const hx = w / 2 - r;
  const hy = h / 2 - r;
  const hz = d / 2 - r;
  const v = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    c.set(Math.max(-hx, Math.min(hx, v.x)), Math.max(-hy, Math.min(hy, v.y)), Math.max(-hz, Math.min(hz, v.z)));
    v.sub(c);
    const l = v.length();
    if (l > 1e-9) v.multiplyScalar(r / l);
    v.add(c);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

/** A slab with rounded corners and bevelled edges, centred, exactly w x h x d (outline in XY, thickness along Z). */
function roundSlab(w, h, d, r, bevel, curveSeg = 2) {
  const s = new THREE.Shape();
  const hw = w / 2 - bevel;
  const hh = h / 2 - bevel;
  const rr = Math.max(0.0005, r - bevel);
  s.moveTo(-hw + rr, -hh);
  s.lineTo(hw - rr, -hh);
  s.quadraticCurveTo(hw, -hh, hw, -hh + rr);
  s.lineTo(hw, hh - rr);
  s.quadraticCurveTo(hw, hh, hw - rr, hh);
  s.lineTo(-hw + rr, hh);
  s.quadraticCurveTo(-hw, hh, -hw, hh - rr);
  s.lineTo(-hw, -hh + rr);
  s.quadraticCurveTo(-hw, -hh, -hw + rr, -hh);
  const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.0005, d - 2 * bevel), bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments: curveSeg });
  g.computeBoundingBox();
  const b = g.boundingBox;
  g.translate(-(b.min.x + b.max.x) / 2, -(b.min.y + b.max.y) / 2, -(b.min.z + b.max.z) / 2);
  g.scale(w / (b.max.x - b.min.x), h / (b.max.y - b.min.y), d / (b.max.z - b.min.z));
  return g;
}

/** A soft cushion: a superellipsoid (exponent ex across X/Z, ey through Y; < 1 = boxier) with half extents a, b, c; `lump` bumps it. */
function cushion(a, b, c, ex = 0.35, ey = 0.6, ws = 14, hs = 8, lump = 0, seed = 0) {
  const g = new THREE.SphereGeometry(1, ws, hs);
  const p = g.attributes.position;
  const sp = (t, k) => Math.sign(t) * Math.pow(Math.abs(t), k);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const n = lump ? 1 + lump * (vnoise(x + seed, y, z, 2.2) - 0.5) : 1;
    p.setXYZ(i, sp(x, ex) * a * n, sp(y, ey) * b * n, sp(z, ex) * c * n);
  }
  g.computeVertexNormals();
  return g;
}

/**
 * A ribbon along a smooth curve through `pts` ([x, y, z] list): a flat strip `width` wide and `thick` thick, the width lying
 * horizontal across the path. `wf(t)` scales the width along it (0..1). Closed with end caps.
 */
function ribbon(pts, width, thick, n = 12, wf = null) {
  const curve = new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(p[0], p[1], p[2])), false, 'centripetal');
  const P = curve.getSpacedPoints(n - 1);
  const pos = [];
  const idx = [];
  const t = new THREE.Vector3();
  const side = new THREE.Vector3();
  const up = new THREE.Vector3();
  const Y = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < n; i++) {
    const a = P[Math.max(0, i - 1)];
    const b = P[Math.min(n - 1, i + 1)];
    t.subVectors(b, a).normalize();
    side.crossVectors(t, Y);
    if (side.lengthSq() < 1e-8) side.set(0, 0, 1);
    side.normalize();
    up.crossVectors(side, t).normalize();
    const w = (width * (wf ? wf(i / (n - 1)) : 1)) / 2;
    const h = thick / 2;
    const p = P[i];
    // ring: top-left, top-right, bottom-right, bottom-left
    for (const [sw, sh] of [
      [-1, 1],
      [1, 1],
      [1, -1],
      [-1, -1],
    ])
      pos.push(p.x + side.x * w * sw + up.x * h * sh, p.y + side.y * w * sw + up.y * h * sh, p.z + side.z * w * sw + up.z * h * sh);
  }
  for (let i = 0; i < n - 1; i++) {
    const r0 = i * 4;
    const r1 = r0 + 4;
    for (let k = 0; k < 4; k++) {
      const k1 = (k + 1) % 4;
      idx.push(r0 + k, r1 + k, r0 + k1, r0 + k1, r1 + k, r1 + k1);
    }
  }
  const last = (n - 1) * 4;
  idx.push(0, 1, 2, 0, 2, 3, last, last + 2, last + 1, last, last + 3, last + 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  // the winding above faces inward on one side for some paths: make every face point away from the strip's centre line
  const pa = g.attributes.position;
  const ix = g.index.array;
  const ctr = new THREE.Vector3();
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const fn = new THREE.Vector3();
  for (let f = 0; f < ix.length; f += 3) {
    va.fromBufferAttribute(pa, ix[f]);
    vb.fromBufferAttribute(pa, ix[f + 1]);
    vc.fromBufferAttribute(pa, ix[f + 2]);
    const ring = Math.floor(ix[f] / 4);
    ctr.copy(P[Math.min(n - 1, ring)]);
    fn.subVectors(vb, va).cross(vc.clone().sub(va));
    const mid = va.clone().add(vb).add(vc).multiplyScalar(1 / 3).sub(ctr);
    const capFace = f >= (n - 1) * 24;
    if (capFace) {
      // end caps: outward along the path
      const dir = ring === 0 ? P[0].clone().sub(P[1]) : P[n - 1].clone().sub(P[n - 2]);
      if (fn.dot(dir) < 0) [ix[f + 1], ix[f + 2]] = [ix[f + 2], ix[f + 1]];
    } else if (fn.dot(mid) < 0) [ix[f + 1], ix[f + 2]] = [ix[f + 2], ix[f + 1]];
  }
  g.index.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

/** A partial torus (a strap, a ring, a guard): radius R, tube r, arc rad, in the XY plane. */
const torus = (R, r, rs, ts, arc = Math.PI * 2) => new THREE.TorusGeometry(R, r, rs, ts, arc);

// ---------------------------------------------------------------------------------------------
// FIRST AID: the field medical case
// ---------------------------------------------------------------------------------------------

export function buildFirstAid(tilt = 0, size = 1) {
  const W = 0.3;
  const H = 0.2;
  const ENAMEL = col(0x9a937c);
  const IRON = col(0x34312c);
  const RIM = col(0x3e3c37);
  const RED = col(0x6e1d16);
  const BRASS = col(0x7a6438);
  const LEATHER = col(0x3f2a1a);
  const GAUZE = col(0xd8d1bc);
  const STAIN = col(0x5c2a1c);
  const hw = W / 2;
  const hh = H / 2;
  // the enamel: chips to the iron at the edges and corners, grime toward the bottom, a soft mottle all over
  const enamel = (c, x, y, z) => {
    const edge = Math.max(Math.abs(x) / hw, Math.abs(y) / hh);
    const chip = vnoise(x, y, z, 55);
    if (edge > 0.86 && chip > 0.55 - (edge - 0.86) * 3) mixTo(c, IRON, 0.9);
    else if (chip > 0.74) mixTo(c, IRON, 0.6);
    c.multiplyScalar(0.7 + 0.3 * vnoise(x + 3, y, z, 18));
    mixTo(c, _c.set(0x3e3527), smooth(-0.0, -0.1, y) * 0.6 + smooth(0.6, 0.85, vnoise(x, y + 9, z, 12)) * 0.4); // grime: low down and in smears
  };
  const steel = (c, x, y, z) => {
    c.multiplyScalar(0.75 + 0.5 * vnoise(x, y, z, 70));
    if (vnoise(x + 7, y, z, 40) > 0.66) mixTo(c, _c.set(0x5e3620), 0.6); // rust
  };
  const paintRed = (c, x, y, z) => {
    const n = vnoise(x, y + 5, z, 60);
    if (n > 0.6) mixTo(c, ENAMEL, 0.65); // the paint worn off to the enamel
    c.multiplyScalar(0.72 + 0.3 * vnoise(x, y, z, 25));
  };
  // the lid (front, +Z) is hinged on its bottom edge and sprung open at the top
  const HINGE_Y = -hh + 0.006;
  const HINGE_Z = 0.018;
  const OPEN = 0.15;
  const lid = new THREE.Matrix4()
    .makeTranslation(0, HINGE_Y, HINGE_Z)
    .multiply(new THREE.Matrix4().makeRotationX(OPEN))
    .multiply(new THREE.Matrix4().makeTranslation(0, -HINGE_Y, -HINGE_Z));
  const parts = [];
  // body (back half) and lid (front half): rounded, bevelled enamel shells
  parts.push({ geo: roundBox(W, H, 0.068, 0.008, 7, 5, 1), pos: [0, 0, -0.021], color: ENAMEL, paint: enamel, crease: 0.9 });
  parts.push({ geo: roundBox(W - 0.004, H - 0.004, 0.034, 0.008, 7, 5, 1), pos: [0, 0, 0.037], pre: lid, color: ENAMEL, paint: enamel, crease: 0.9 });
  // the steel rim round the body's mouth: a dark line round the case
  parts.push({ geo: roundSlab(W + 0.006, H + 0.006, 0.012, 0.024, 0.002, 2), pos: [0, 0, 0.009], color: RIM, paint: steel, crease: 0.7 });
  // the gauze in the gap at the top (a folded wad and a loose fold hanging over the lid's edge)
  parts.push({ geo: cushion(0.11, 0.012, 0.012, 0.45, 0.7, 8, 5, 0.25, 1), pos: [-0.02, hh - 0.012, 0.02], color: GAUZE, paint: (c, x, y, z) => c.multiplyScalar(0.85 + 0.2 * vnoise(x, y, z, 50)), crease: 1.4 });
  parts.push({
    geo: ribbon(
      [
        [0.05, hh - 0.018, 0.018],
        [0.056, hh + 0.004, 0.03],
        [0.062, hh + 0.001, 0.05],
        [0.064, hh - 0.02, 0.064],
        [0.066, hh - 0.055, 0.072],
      ],
      0.032,
      0.003,
      9,
      (t) => 1 - 0.25 * t,
    ),
    color: GAUZE,
    paint: (c, x, y, z) => {
      c.multiplyScalar(0.85 + 0.2 * vnoise(x, y, z, 60));
      mixTo(c, STAIN, smooth(0.06, 0.0, Math.hypot(x - 0.068, y - (hh - 0.06), z - 0.072)) * 0.8);
    },
    crease: 1.2,
  });
  // the faded red cross on the lid's face and on the back
  const LZ = 0.054 + 0.0012;
  for (const [z, pre] of [
    [LZ, lid],
    [-0.055 - 0.0012, null],
  ]) {
    // three pieces that do not overlap (no z-fight in the middle), each with a few vertices for the wear
    parts.push({ geo: box(0.044, 0.13, 0.0024, 1, 3, 1), pos: [0, 0, z], pre, color: RED, paint: paintRed });
    for (const sx of [-1, 1]) parts.push({ geo: box(0.043, 0.044, 0.0024), pos: [sx * 0.0435, 0, z], pre, color: RED, paint: paintRed });
  }
  // riveted steel corner caps: four on the lid's face, four on the back
  const CAP = 0.032;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const x = sx * (hw - CAP / 2 + 0.003);
      const y = sy * (hh - CAP / 2 + 0.003);
      parts.push({ geo: box(CAP, CAP, 0.014), pos: [x, y, 0.05], pre: lid, color: RIM, paint: steel });
      parts.push({ geo: sph(0.0042, 5, 2), pos: [x - sx * 0.005, y - sy * 0.005, 0.057], scale: [1, 1, 0.55], pre: lid, color: BRASS, paint: steel, crease: 1.4 });
      parts.push({ geo: box(CAP, CAP, 0.014), pos: [x, y, -0.05], color: RIM, paint: steel });
    }
  }
  // two brass latches on the top face over the seam, thrown open (the hasps stand up off the lid)
  for (const sx of [-1, 1]) {
    const x = sx * 0.088;
    parts.push({ geo: box(0.024, 0.006, 0.026), pos: [x, hh + 0.002, -0.002], color: BRASS, paint: steel });
    parts.push({ geo: box(0.018, 0.004, 0.03), pos: [x, hh + 0.012, 0.014], rot: [-0.75, 0, 0], color: BRASS, paint: steel });
  }
  // the leather strap handle on two steel brackets
  const strap = torus(0.052, 0.0075, 4, 10, Math.PI);
  parts.push({ geo: strap, pos: [0, hh + 0.008, -0.012], scale: [1, 0.7, 1.7], color: LEATHER, paint: (c, x, y, z) => c.multiplyScalar(0.7 + 0.5 * vnoise(x, y, z, 80)), crease: 1.3 });
  for (const sx of [-1, 1]) parts.push({ geo: box(0.02, 0.012, 0.03), pos: [sx * 0.052, hh + 0.005, -0.012], color: RIM, paint: steel });
  // the hinge knuckles along the bottom seam
  parts.push({ geo: cyl(0.0045, 0.0045, 0.2, 6), pos: [0, HINGE_Y - 0.006, HINGE_Z - 0.004], rot: [0, 0, Math.PI / 2], color: RIM, paint: steel, crease: 1.2 });
  return mergeModel(parts, tilt, size);
}

// ---------------------------------------------------------------------------------------------
// BANDAGE: the field dressing (a folded linen pad, kraft wrapper, twine, two long trailing tails)
// ---------------------------------------------------------------------------------------------

export function buildBandage(tilt = 0, size = 1) {
  const LINEN = col(0xcbc1a6);
  const GAUZE = col(0xddd4bd);
  const PAPER = col(0x6e5638);
  const TWINE = col(0x5e4a2c);
  const BLOOD = col(0x4a100a);
  const PIN = col(0x9a978e);
  const PX = -0.04; // pad centre
  const A = 0.064;
  const B = 0.019;
  const C = 0.046;
  const GROUND = -(B + 0.0026); // the lowest point of the bound pad (the wraps): the tails lie on this plane
  // the stain: dried blood soaked into the pad's top toward the +X,+Z corner and down into the tails, ragged
  const SX = PX + 0.05;
  const SZ = 0.008;
  const stain = (c, x, y, z, k = 1) => {
    const d = Math.hypot(x - SX, (y - B) * 0.5, z - SZ);
    const s = smooth(0.06, 0.02, d + (vnoise(x, y, z, 70) - 0.5) * 0.03);
    mixTo(c, BLOOD, s * 0.92 * k);
    mixTo(c, _c.set(0x6e4a2c), smooth(0.085, 0.06, d) * (1 - s) * 0.5 * k); // the yellowed rim of the stain
  };
  const linen = (c, x, y, z) => {
    // the weave: faint cross-hatch, a soft mottle, dirt underneath
    c.multiplyScalar(0.84 + 0.1 * Math.sin(x * 900) * Math.sin(z * 900) + 0.16 * (vnoise(x, y, z, 45) - 0.5));
    mixTo(c, _c.set(0x4d4234), smooth(-0.004, -B, y) * 0.45);
    stain(c, x, y, z);
  };
  const paper = (c, x, y, z) => {
    c.multiplyScalar(0.75 + 0.35 * vnoise(x, y, z, 30));
    if (vnoise(x + 2, y, z, 22) > 0.6) mixTo(c, _c.set(0x3a2c1c), 0.55); // water marks
  };
  const twine = (c, x, y, z) => c.multiplyScalar(0.7 + 0.5 * ihash(Math.round(x * 900), Math.round(y * 900), Math.round(z * 900)));
  const parts = [];
  // the pad (a fat folded dressing) and its folded top layer
  parts.push({ geo: cushion(A, B, C, 0.55, 0.8, 14, 8, 0.2, 0), pos: [PX, 0, 0], color: LINEN, paint: linen, crease: 1.4 });
  parts.push({ geo: cushion(A * 0.86, 0.006, C * 0.84, 0.6, 0.9, 10, 6, 0.25, 4), pos: [PX + 0.008, B - 0.0032, -0.003], rot: [0, 0.09, 0], color: LINEN, paint: linen, crease: 1.4 });
  // the kraft wrapper still on the -X third, torn across in a ragged line (vertices past the tear are folded back under it)
  {
    const g = cushion(A + 0.002, B + 0.002, C + 0.002, 0.55, 0.8, 14, 8, 0.2, 0);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const tear = -0.022 + 0.014 * (vnoise(0, 0, z, 90) - 0.5) + 0.007 * Math.sin(z * 150);
      if (x > tear) p.setX(i, tear - 0.0005);
    }
    g.computeVertexNormals();
    parts.push({ geo: g, pos: [PX, 0, 0], color: PAPER, paint: paper, crease: 1.1 });
  }
  // twine round the wrapper, the knot on top
  parts.push({ geo: cushion(0.0022, B + 0.0034, C + 0.003, 0.3, 0.6, 6, 7, 0, 0), pos: [PX - 0.042, 0, 0], color: TWINE, paint: twine, crease: 1.4 });
  parts.push({ geo: sph(0.0045, 6, 4), pos: [PX - 0.042, B + 0.004, -0.008], color: TWINE, paint: twine, crease: 1.4 });
  // two turns of the bandage strip across the pad, on the diagonal (the tails come out from under the second)
  for (const [dx, ry] of [
    [0.004, 0.32],
    [0.034, -0.26],
  ])
    parts.push({ geo: cushion(0.0085, B + 0.0026, C + 0.0026, 0.3, 0.7, 8, 7, 0.15, 7), pos: [PX + dx, 0, 0], rot: [0, ry, 0], color: GAUZE, paint: linen, crease: 1.3 });
  // the two tails: out of the pad's +X end, down to the ground, lying in loose crumpled curves, frayed at the tips
  const G = GROUND + 0.0013;
  const tailA = [
    [PX + A - 0.01, 0.006, 0.012],
    [PX + A + 0.012, -0.004, 0.02],
    [PX + A + 0.03, G, 0.03],
    [0.06, G + 0.005, 0.042],
    [0.08, G, 0.046],
    [0.1, G + 0.004, 0.038],
    [0.12, G, 0.024],
    [0.142, G + 0.003, 0.01],
    [0.165, G, 0.004],
  ];
  const tailB = [
    [PX + A - 0.01, 0.004, -0.016],
    [PX + A + 0.01, -0.006, -0.026],
    [PX + A + 0.026, G, -0.038],
    [0.05, G + 0.004, -0.05],
    [0.07, G, -0.06],
    [0.09, G + 0.003, -0.058],
    [0.108, G, -0.046],
  ];
  // crumples: the strip narrows where it folds over itself (at the raised points), frays at the tip
  const crumple = (bumps) => (t) => {
    let w = t < 0.86 ? 1 : 1 - (t - 0.86) * 3;
    for (const b of bumps) w *= 1 - 0.32 * Math.exp(-(((t - b) / 0.035) ** 2));
    return w;
  };
  const tailPaint = (c, x, y, z) => {
    c.multiplyScalar(0.8 + 0.22 * vnoise(x, y, z, 55));
    mixTo(c, _c.set(0x463c2e), smooth(0.08, 0.17, Math.hypot(x, z)) * 0.55); // dragged through the dirt toward the tips
    stain(c, x, y, z, 0.8);
  };
  parts.push({ geo: ribbon(tailA, 0.024, 0.0026, 19, crumple([0.4, 0.64, 0.86])), color: GAUZE, paint: tailPaint, crease: 1.2 });
  parts.push({ geo: ribbon(tailB, 0.021, 0.0026, 16, crumple([0.5, 0.78])), color: GAUZE, paint: tailPaint, crease: 1.2 });
  // loose threads at the frayed tips
  for (const [x, z, ry] of [
    [0.174, 0.0, 0.4],
    [0.172, 0.008, 0.05],
    [0.114, -0.04, -0.7],
    [0.113, -0.047, -0.3],
  ])
    parts.push({ geo: box(0.016, 0.0012, 0.0012), pos: [x, G - 0.0001, z], rot: [0, ry, 0], color: GAUZE, paint: tailPaint });
  // the safety pin through tail A, lying along it
  parts.push({ geo: torus(0.0095, 0.0011, 3, 12), pos: [0.083, G + 0.003, 0.046], rot: [Math.PI / 2, 0, -0.1], scale: [1.9, 0.55, 1], color: PIN, crease: 1.3 });
  parts.push({ geo: box(0.0075, 0.0034, 0.0075), pos: [0.065, G + 0.003, 0.047], rot: [0, -0.1, 0], color: PIN });
  return mergeModel(parts, tilt, size);
}

// ---------------------------------------------------------------------------------------------
// GRENADE: the fused iron fragmentation grenade
// ---------------------------------------------------------------------------------------------

export function buildGrenade(tilt = 0, size = 1) {
  const IRON = col(0x3a3732);
  const RUST = col(0x6a3a20);
  const BRASS = col(0x8a6a32);
  const STEEL = col(0x5a5852);
  const CORD = col(0x6d5a3c);
  const Y0 = -0.046;
  const Y1 = 0.04;
  const R = 0.0305;
  // the egg: radius along the height, ribbed in 5 rows with a smooth waist band
  const prof = [];
  const egg = (t) => R * Math.pow(Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, t)))), 0.62) * (1 - 0.1 * t);
  prof.push(new THREE.Vector2(0.0001, Y0));
  const rows = [0.04, 0.2, 0.36, 0.52, 0.68, 0.84, 0.97];
  for (let r = 0; r < rows.length - 1; r++) {
    const a = rows[r];
    const b = rows[r + 1];
    const g = r === 2 ? 1 : 0.86; // row 2 is the waist band: no groove in it
    prof.push(new THREE.Vector2(egg(a) * 0.86, Y0 + a * (Y1 - Y0)));
    prof.push(new THREE.Vector2(egg(a + 0.03) * g, Y0 + (a + 0.03) * (Y1 - Y0)));
    prof.push(new THREE.Vector2(egg(b - 0.03) * g, Y0 + (b - 0.03) * (Y1 - Y0)));
  }
  prof.push(new THREE.Vector2(egg(0.97) * 0.86, Y0 + 0.97 * (Y1 - Y0)));
  prof.push(new THREE.Vector2(0.0001, Y1));
  const body = new THREE.LatheGeometry(prof, 24);
  {
    // the columns: 8 grooves round it (every third vertex), not across the waist band
    const p = body.attributes.position;
    const bandLo = Y0 + 0.36 * (Y1 - Y0);
    const bandHi = Y0 + 0.52 * (Y1 - Y0);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      if (y > bandLo + 0.001 && y < bandHi - 0.001) continue;
      const ang = Math.atan2(z, x);
      const k = Math.round(((ang + Math.PI) / (Math.PI * 2)) * 24);
      if (k % 3 === 0) {
        p.setX(i, x * 0.88);
        p.setZ(i, z * 0.88);
      }
    }
    body.computeVertexNormals();
  }
  const iron = (c, x, y, z) => {
    const rr = Math.hypot(x, z);
    c.multiplyScalar(0.7 + 0.45 * vnoise(x, y, z, 60) + (rr < egg(0.5) * 0.9 ? -0.25 : 0.05)); // grooves darker
    mixTo(c, RUST, smooth(0.5, 0.75, vnoise(x + 1, y, z, 45)) * 0.8);
  };
  const brass = (c, x, y, z) => {
    c.multiplyScalar(0.75 + 0.4 * vnoise(x, y, z, 90));
    mixTo(c, _c.set(0x3c4a32), smooth(0.6, 0.8, vnoise(x + 4, y, z, 70)) * 0.55); // verdigris
  };
  const steel = (c, x, y, z) => {
    c.multiplyScalar(0.75 + 0.4 * vnoise(x, y, z, 80));
    mixTo(c, RUST, smooth(0.55, 0.8, vnoise(x + 9, y, z, 50)) * 0.7);
  };
  const parts = [];
  parts.push({ geo: body, color: IRON, paint: iron, crease: 1.25 });
  // the base plug
  parts.push({ geo: cyl(0.011, 0.012, 0.006, 10), pos: [0, Y0 - 0.001, 0], color: IRON, paint: steel });
  parts.push({ geo: box(0.016, 0.002, 0.003), pos: [0, Y0 - 0.0045, 0], color: col(0x1e1c1a) });
  // the fuse: a steel collar, a brass cap, the striker head
  parts.push({ geo: cyl(0.0125, 0.014, 0.008, 12), pos: [0, Y1 + 0.002, 0], color: STEEL, paint: steel });
  parts.push({ geo: cyl(0.0105, 0.0115, 0.012, 12), pos: [0, Y1 + 0.012, 0], color: BRASS, paint: brass });
  parts.push({ geo: cyl(0.006, 0.0075, 0.006, 8), pos: [0, Y1 + 0.021, 0], color: BRASS, paint: brass });
  // the lever down the +X flank: from the fuse head out and down, hugging the body
  const lev = [];
  for (let i = 0; i <= 7; i++) {
    const t = i / 7;
    const y = Y1 + 0.019 - t * 0.072;
    const tt = (y - Y0) / (Y1 - Y0);
    const r = i === 0 ? 0.008 : Math.max(egg(Math.min(0.97, tt)), 0.014) + 0.0045;
    lev.push([r, y, 0]);
  }
  parts.push({ geo: ribbon(lev, 0.011, 0.0022, 12), rot: [0, 0, 0], color: STEEL, paint: steel, crease: 1.0 });
  // the split pin through the fuse head and the pull ring on +Z, a short frayed cord tied to it
  parts.push({ geo: cyl(0.0012, 0.0012, 0.03, 4), pos: [0, Y1 + 0.016, 0.009], rot: [Math.PI / 2, 0, 0], color: STEEL });
  parts.push({ geo: torus(0.0115, 0.0016, 4, 14), pos: [0.0, Y1 + 0.011, 0.034], rot: [0, 0, 0.25], color: STEEL, paint: steel, crease: 1.3 });
  parts.push({
    geo: ribbon(
      [
        [0.0, Y1 + 0.0, 0.036],
        [0.004, Y1 - 0.012, 0.04],
        [0.0, Y1 - 0.026, 0.042],
        [-0.004, Y1 - 0.036, 0.041],
      ],
      0.0032,
      0.0028,
      6,
      (t) => (t < 0.8 ? 1 : 1.6),
    ),
    color: CORD,
    paint: (c, x, y, z) => c.multiplyScalar(0.7 + 0.5 * vnoise(x, y, z, 120)),
    crease: 1.3,
  });
  return mergeModel(parts, tilt, size);
}

// ---------------------------------------------------------------------------------------------
// SIDEARM: the old service revolver, in profile
// ---------------------------------------------------------------------------------------------

export function buildSidearm(tilt = 0, size = 1) {
  const BLUED = col(0x2b2d30);
  const WORN = col(0x6b6d6e);
  const RUST = col(0x6a3820);
  const WOOD = col(0x5a361e);
  const BORE = col(0x0c0c0c);
  const steel = (c, x, y, z, nx, ny, nz) => {
    // worn bright where the faces turn (the edges catch the holster), rust in patches
    const side = Math.abs(nz);
    mixTo(c, WORN, (1 - side) * 0.35 * vnoise(x, y, z, 50) + 0.08);
    c.multiplyScalar(0.8 + 0.35 * vnoise(x + 3, y, z, 90));
    mixTo(c, RUST, smooth(0.6, 0.82, vnoise(x, y + 2, z, 45)) * 0.75);
  };
  const wood = (c, x, y, z) => {
    // grain along the grip's length (down and back), darker in the chequered middle, worn lighter at the front strap
    const u = x * 0.45 - y * 0.9;
    c.multiplyScalar(0.75 + 0.18 * Math.sin(u * 380 + vnoise(x, y, z, 60) * 6) + 0.12 * vnoise(x, y, z, 30));
    mixTo(c, _c.set(0x86603a), smooth(0.5, 0.9, vnoise(x + 5, y, z, 40)) * 0.4);
  };
  const BY = 0.013; // barrel axis (the top chamber)
  const parts = [];
  // the cylinder: fluted, 6 flutes
  {
    const g = cyl(0.0205, 0.0205, 0.04, 18);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const z = p.getZ(i);
      const r = Math.hypot(x, z);
      if (r < 0.018) continue;
      const k = Math.round(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 18);
      if (k % 3 === 0) {
        p.setX(i, x * 0.82);
        p.setZ(i, z * 0.82);
      }
    }
    g.computeVertexNormals();
    parts.push({ geo: g, pos: [0.0, 0, 0], rot: [0, 0, Math.PI / 2], color: BLUED, paint: steel, crease: 0.9 });
    // the chamber mouths on its front face
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2 + Math.PI / 2;
      parts.push({ geo: cyl(0.0042, 0.0042, 0.002, 6), pos: [0.0205, Math.sin(a) * 0.0128, Math.cos(a) * 0.0128], rot: [0, 0, Math.PI / 2], color: BORE });
    }
  }
  // the barrel, its muzzle, the front sight, the ejector rod housing under it
  parts.push({ geo: cyl(0.0082, 0.0082, 0.122, 12), pos: [0.083, BY, 0], rot: [0, 0, Math.PI / 2], color: BLUED, paint: steel, crease: 0.9 });
  parts.push({ geo: cyl(0.0088, 0.0088, 0.006, 12), pos: [0.142, BY, 0], rot: [0, 0, Math.PI / 2], color: BLUED, paint: steel, crease: 0.9 });
  parts.push({ geo: cyl(0.0042, 0.0042, 0.002, 6), pos: [0.1452, BY, 0], rot: [0, 0, Math.PI / 2], color: BORE });
  parts.push({ geo: box(0.01, 0.006, 0.003), pos: [0.137, BY + 0.0105, 0], color: BLUED, paint: steel });
  parts.push({ geo: cyl(0.0042, 0.0042, 0.07, 8), pos: [0.058, BY - 0.0115, 0], rot: [0, 0, Math.PI / 2], color: BLUED, paint: steel, crease: 0.9 });
  parts.push({ geo: box(0.07, 0.006, 0.004), pos: [0.058, BY - 0.0065, 0], color: BLUED, paint: steel });
  // the frame: the forward lug, the top strap over the cylinder, the recoil shield and the lower frame
  parts.push({ geo: box(0.016, 0.034, 0.015), pos: [0.028, 0.002, 0], color: BLUED, paint: steel });
  parts.push({ geo: box(0.066, 0.006, 0.014), pos: [0.0, 0.024, 0], color: BLUED, paint: steel });
  parts.push({ geo: box(0.022, 0.048, 0.02), pos: [-0.031, 0.002, 0], color: BLUED, paint: steel });
  parts.push({ geo: box(0.062, 0.008, 0.014), pos: [-0.002, -0.0225, 0], color: BLUED, paint: steel });
  parts.push({ geo: box(0.028, 0.004, 0.003), pos: [-0.012, 0.0275, 0], color: BLUED, paint: steel }); // the rear sight groove
  // the hammer, cocked back a little, with its spur
  parts.push({ geo: box(0.01, 0.026, 0.007), pos: [-0.045, 0.026, 0], rot: [0, 0, 0.45], color: BLUED, paint: steel });
  parts.push({ geo: box(0.014, 0.005, 0.009), pos: [-0.054, 0.039, 0], rot: [0, 0, 0.25], color: BLUED, paint: steel });
  // the trigger guard and the trigger
  parts.push({ geo: torus(0.0155, 0.0024, 4, 9, Math.PI * 1.05), pos: [-0.012, -0.027, 0], rot: [0, 0, Math.PI * 0.97], color: BLUED, paint: steel, crease: 1.2 });
  parts.push({ geo: box(0.0042, 0.019, 0.004), pos: [-0.013, -0.033, 0], rot: [0, 0, 0.3], color: BLUED, paint: steel });
  // the walnut bird's-head grip: an extruded outline down and back from the frame
  {
    const s = new THREE.Shape();
    s.moveTo(-0.022, -0.026);
    s.bezierCurveTo(-0.03, -0.045, -0.04, -0.07, -0.046, -0.088);
    s.quadraticCurveTo(-0.05, -0.1, -0.063, -0.1);
    s.lineTo(-0.074, -0.098);
    s.quadraticCurveTo(-0.082, -0.093, -0.078, -0.08);
    s.bezierCurveTo(-0.068, -0.058, -0.06, -0.036, -0.06, -0.016);
    s.lineTo(-0.042, -0.018);
    s.lineTo(-0.022, -0.026);
    const g = new THREE.ExtrudeGeometry(s, { depth: 0.02, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.0025, bevelSegments: 1, curveSegments: 4 });
    g.translate(0, 0, -0.01);
    parts.push({ geo: g, color: WOOD, paint: wood, crease: 0.75 });
  }
  // the steel back strap and butt cap, the grip screw, the lanyard ring
  parts.push({ geo: box(0.006, 0.07, 0.016), pos: [-0.066, -0.052, 0], rot: [0, 0, 0.38], color: BLUED, paint: steel });
  parts.push({ geo: box(0.024, 0.006, 0.022), pos: [-0.066, -0.1, 0], rot: [0, 0, 0.18], color: BLUED, paint: steel });
  parts.push({ geo: sph(0.0034, 6, 3), pos: [-0.048, -0.055, 0.0135], scale: [1, 1, 0.5], color: WORN });
  parts.push({ geo: sph(0.0034, 6, 3), pos: [-0.048, -0.055, -0.0135], scale: [1, 1, 0.5], color: WORN });
  parts.push({ geo: torus(0.008, 0.0014, 4, 10), pos: [-0.07, -0.111, 0], rot: [0, 0, 0.18], color: WORN, paint: steel, crease: 1.3 });
  // re-centred so the prop spins about its middle (x: -0.078..0.145, y: -0.12..0.045)
  for (const p of parts) {
    if (!p.pos) p.pos = [0, 0, 0];
  }
  const shift = new THREE.Matrix4().makeTranslation(-0.033, 0.035, 0);
  for (const p of parts) p.pre = p.pre ? p.pre.clone().premultiply(shift) : shift;
  return mergeModel(parts, tilt, size);
}
