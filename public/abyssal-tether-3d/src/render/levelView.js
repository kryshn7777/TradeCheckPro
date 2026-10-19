/* ABYSSAL TETHER 3D — levelView.js
 * Draws the level: solids, hazards, anchors (+ per-hand target highlights),
 * decor, the gate and the Still Lamp, far colossal silhouettes and the glows
 * of environment lights.
 *
 * Draw-call strategy (Quest: ≤150 calls for BOTH eyes):
 *  - Solids: one InstancedMesh per material bucket (rock / masonry / metal /
 *    grate), re-packed with only the solids within fog distance of the head
 *    whenever the head moves 1.5 m: ≤ 4 calls per eye for all static geometry.
 *  - Crumbling ledges: one dynamic InstancedMesh (shake, hide when fallen).
 *  - Hazards: one InstancedMesh per kind (rebar bars / spikes / saw blades),
 *    re-packed per frame with the elements near the head.
 *  - Anchors: one InstancedMesh of mounts per shape (ring / hook / fragile /
 *    stub, phosphor inlays, near only) + one InstancedMesh of billboard glyphs
 *    (all three glyph shapes in one geometry, picked per instance in the
 *    vertex shader).
 *  - Decor: per 64 m band, ONE merged static mesh per material (stone/metal/
 *    rock/flesh/glow/shaft), distance + frustum culled. Plaque text planes are separate, distance culled.
 *  - Colossal silhouettes: one merged mesh (fog-capped), authored
 *    'far-structure' decor plus a sparse procedural ring beyond the walls.
 *  - Glows of environment lights, the Still Lamp and distant lit windows:
 *    one Points draw.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from './materials.js';

/** Math.hypot is ~20× slower than sqrt in V8 and allocates; hot paths use this. */
function hyp(x, y, z = 0) {
  return Math.sqrt(x * x + y * y + z * z);
}


const BAND_H = 64; // metres per decor culling band
const VIEW_MARGIN = 6; // metres beyond fog far still drawn
const GLYPH_MAX_DIST = 110;
const MOUNT_MAX_DIST = 42; // physical anchor meshes beyond this are sub-pixel / fogged: glyphs carry them
const PLAQUE_DIST = 26;

const BUCKET_OF = {
  wall: 'rock',
  stone: 'masonry',
  pillar: 'masonry',
  metal: 'metal',
  bridge: 'metal',
  grate: 'grate',
  crumble: 'crumble',
};
const SOLID_BUCKETS = ['rock', 'masonry', 'metal', 'grate'];

const ANCHOR_SHAPE = { ring: 0, hook: 1, fragile: 2 };
const SHAPE_STUB = 3;
const HAZ_SHAPE = { rebar: 0, spikes: 1, blades: 2 };

const _m4 = new THREE.Matrix4();
const _m4b = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _box = new THREE.Box3();
const _up = new THREE.Vector3(0, 1, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);
const _zero = { x: 0, y: 0, z: 0 };

function num(v, fb) {
  return typeof v === 'number' && isFinite(v) ? v : fb;
}
function hashStr(s) {
  const str = String(s == null ? '' : s);
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function makeRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =============================================================================
// Geometry helpers (all parts are non-indexed so they merge freely)
// =============================================================================

function nonIndexed(geo) {
  if (!geo.index) return geo;
  const g = geo.toNonIndexed();
  geo.dispose();
  return g;
}

/** Keeps only the named attributes. */
function keepAttrs(geo, names) {
  for (const k of Object.keys(geo.attributes)) if (!names.includes(k)) geo.deleteAttribute(k);
  geo.morphAttributes = {};
  geo.clearGroups();
  return geo;
}

/** Per-triangle dominant-axis planar UVs in metres (+ offset). */
function boxUV(geo, ou = 0, ov = 0) {
  const p = geo.attributes.position.array;
  const n = p.length / 3;
  const uv = new Float32Array(n * 2);
  for (let t = 0; t < n; t += 3) {
    const ax = p[t * 3];
    const ay = p[t * 3 + 1];
    const az = p[t * 3 + 2];
    const e1x = p[t * 3 + 3] - ax;
    const e1y = p[t * 3 + 4] - ay;
    const e1z = p[t * 3 + 5] - az;
    const e2x = p[t * 3 + 6] - ax;
    const e2y = p[t * 3 + 7] - ay;
    const e2z = p[t * 3 + 8] - az;
    const nx = Math.abs(e1y * e2z - e1z * e2y);
    const ny = Math.abs(e1z * e2x - e1x * e2z);
    const nz = Math.abs(e1x * e2y - e1y * e2x);
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      const x = p[i * 3];
      const y = p[i * 3 + 1];
      const z = p[i * 3 + 2];
      let u;
      let v;
      if (nx >= ny && nx >= nz) {
        u = z;
        v = y;
      } else if (ny >= nz) {
        u = x;
        v = z;
      } else {
        u = x;
        v = y;
      }
      uv[i * 2] = u + ou;
      uv[i * 2 + 1] = v + ov;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Scales a geometry's native uv to metres. */
function scaleUV(geo, su, sv) {
  const uv = geo.attributes.uv;
  if (!uv) return geo;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return geo;
}

/** Collects decor parts per material while an item is being built (item-local coords). */
class Parts {
  constructor() {
    this.lists = { stone: [], metal: [], rock: [], flesh: [], glow: [], shaft: [] };
    this.rng = Math.random;
  }
  _push(list, geo, matrix) {
    if (matrix) geo.applyMatrix4(matrix);
    this.lists[list].push(geo);
    return geo;
  }
  /** Axis-aligned (then rotated) box, metric UVs. */
  box(list, cx, cy, cz, w, h, d, rx = 0, ry = 0, rz = 0) {
    let g = new THREE.BoxGeometry(Math.max(w, 0.01), Math.max(h, 0.01), Math.max(d, 0.01));
    g = nonIndexed(g);
    boxUV(g, this.rng() * 4, this.rng() * 4);
    if (rx || ry || rz) g.applyMatrix4(_m4.makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
    g.translate(cx, cy, cz);
    return this._push(list, keepAttrs(g, ['position', 'normal', 'uv']));
  }
  /** Cylinder along an axis ('x'|'y'|'z'); uv in metres. */
  cyl(list, cx, cy, cz, rTop, rBot, h, seg = 8, axis = 'y', open = false) {
    let g = new THREE.CylinderGeometry(Math.max(rTop, 0.001), Math.max(rBot, 0.001), Math.max(h, 0.01), seg, 1, open);
    scaleUV(g, Math.PI * (rTop + rBot), h);
    g = nonIndexed(g);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    else if (axis === 'z') g.rotateX(Math.PI / 2);
    g.translate(cx, cy, cz);
    return this._push(list, keepAttrs(g, ['position', 'normal', 'uv']));
  }
  /** Torus (optionally an arc), in the XY plane by default. */
  torus(list, R, r, radial, tubular, arc, matrix) {
    let g = new THREE.TorusGeometry(R, r, radial, tubular, arc);
    scaleUV(g, 2 * Math.PI * R, 2 * Math.PI * r);
    g = nonIndexed(g);
    return this._push(list, keepAttrs(g, ['position', 'normal', 'uv']), matrix);
  }
  /** Any geometry, box-projected metric UVs. */
  geo(list, geo, matrix) {
    let g = nonIndexed(geo);
    if (matrix) g.applyMatrix4(matrix);
    if (!g.attributes.normal) g.computeVertexNormals();
    boxUV(g, this.rng() * 4, this.rng() * 4);
    return this._push(list, keepAttrs(g, ['position', 'normal', 'uv']));
  }
  /** Small emissive solid (unlit, vertex colour). */
  glow(cx, cy, cz, r, color, k = 1, shape = 'oct') {
    let g = shape === 'box' ? new THREE.BoxGeometry(r * 2, r * 2, r * 2) : new THREE.OctahedronGeometry(r, 0);
    g = nonIndexed(g);
    g.translate(cx, cy, cz);
    keepAttrs(g, ['position']);
    const col = new Float32Array(g.attributes.position.count * 3);
    _c.set(color);
    for (let i = 0; i < col.length; i += 3) {
      col[i] = _c.r * k;
      col[i + 1] = _c.g * k;
      col[i + 2] = _c.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return this._push('glow', g);
  }
  /** Thin emissive line (box) between two points. */
  glowLine(x0, y0, z0, x1, y1, z1, w, color, k = 1) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const len = hyp(dx, dy, dz) || 0.01;
    let g = nonIndexed(new THREE.BoxGeometry(w, len, w * 0.6));
    _v1.set(dx, dy, dz).normalize();
    _q.setFromUnitVectors(_up, _v1);
    g.applyMatrix4(_m4.makeRotationFromQuaternion(_q));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    keepAttrs(g, ['position']);
    const col = new Float32Array(g.attributes.position.count * 3);
    _c.set(color);
    for (let i = 0; i < col.length; i += 3) {
      col[i] = _c.r * k;
      col[i + 1] = _c.g * k;
      col[i + 2] = _c.b * k;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return this._push('glow', g);
  }
  /** Additive volumetric shaft: open cylinder, bright core at the top fading downward and outward. */
  shaft(cx, cy, cz, rTop, rBot, h, color, k) {
    let g = new THREE.CylinderGeometry(rTop, rBot, h, 12, 4, true);
    g = nonIndexed(g);
    g.translate(cx, cy, cz);
    keepAttrs(g, ['position', 'normal']);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    _c.set(color);
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) - (cy - h / 2)) / h; // 0 bottom → 1 top
      const a = k * (0.15 + 0.85 * t * t);
      col[i * 3] = _c.r * a;
      col[i * 3 + 1] = _c.g * a;
      col[i * 3 + 2] = _c.b * a;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return this._push('shaft', g);
  }
  /** Sagging tube between two points (cables). */
  cable(list, x0, y0, z0, x1, y1, z1, sag, r) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push(new THREE.Vector3(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - Math.sin(Math.PI * t) * sag, z0 + (z1 - z0) * t));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    let g = new THREE.TubeGeometry(curve, 12, r, 4, false);
    scaleUV(g, hyp(x1 - x0, y1 - y0, z1 - z0), 2 * Math.PI * r);
    g = nonIndexed(g);
    return this._push(list, keepAttrs(g, ['position', 'normal', 'uv']));
  }
}

// =============================================================================
// Decor builders (item-local: centre at origin, size sx × sy × sz, local X = width)
// =============================================================================

const DECOR = {
  chain(P, sx, sy, sz, item) {
    // Giant chain hanging with its lower end at the bottom of the box. Real links
    // for the lower ~45 m (where anchors hang and the lantern reaches); above
    // that a cheap crossed-bar silhouette carries it up into the fog.
    const pitch = item && isFinite(item.link) && item.link > 0.05 ? item.link : Math.max(0.1, sx * 1.15);
    const total = Math.max(1, Math.round(sy / pitch));
    const n = Math.min(total, 50);
    const R = pitch * 0.64;
    const tube = Math.max(0.02, pitch * 0.12);
    const m = new THREE.Matrix4();
    const rot = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    for (let i = 0; i < n; i++) {
      const y = -sy / 2 + pitch * (i + 0.5);
      // torus lies in XY: squash X so the link is long along Y, alternate links turned 90°
      _m4.makeScale(0.6, 1, 1);
      if (i % 2) _m4.premultiply(rot);
      _m4.premultiply(m.makeTranslation(0, y, 0));
      P.torus('metal', R, tube, 3, 6, Math.PI * 2, _m4);
    }
    const top = -sy / 2 + pitch * n;
    if (top < sy / 2 - 0.1) {
      const h = sy / 2 - top;
      P.box('metal', 0, top + h / 2, 0, R * 1.2, h, tube * 2);
      P.box('metal', 0, top + h / 2, 0, tube * 2, h, R * 1.2);
    }
  },
  arch(P, sx, sy, sz) {
    const pw = Math.max(0.6, sx * 0.12);
    const R = Math.max(0.5, (sx - pw) / 2);
    const spring = sy / 2 - R - pw * 0.5;
    const pierH = spring + sy / 2;
    if (pierH > 0.05) {
      P.box('stone', -(sx / 2 - pw / 2), -sy / 2 + pierH / 2, 0, pw, pierH, sz);
      P.box('stone', sx / 2 - pw / 2, -sy / 2 + pierH / 2, 0, pw, pierH, sz);
    }
    const N = 11;
    for (let i = 0; i < N; i++) {
      const a0 = (i / N) * Math.PI;
      const a1 = ((i + 1) / N) * Math.PI;
      const am = (a0 + a1) / 2;
      const segLen = R * (a1 - a0) * 1.02;
      const key = i === (N - 1) / 2 ? 1.25 : 1;
      P.box('stone', Math.cos(am) * R, spring + Math.sin(am) * R, 0, pw * key, segLen, sz * (key > 1 ? 1.1 : 1), 0, 0, am);
    }
  },
  statue(P, sx, sy, sz) {
    // A Lanternwright: hooded, robed, one arm raising a lantern, the other on a staff.
    const H = sy;
    const W = sx;
    const D = Math.max(sz, W * 0.6);
    const base = -H / 2;
    const plinthH = H * 0.1;
    P.box('stone', 0, base + plinthH / 2, 0, W * 0.95, plinthH, D * 0.95);
    const robeH = H * 0.52;
    P.cyl('stone', 0, base + plinthH + robeH / 2, 0, W * 0.2, W * 0.38, robeH, 7);
    const chestH = H * 0.14;
    const chestY = base + plinthH + robeH + chestH / 2;
    P.cyl('stone', 0, chestY, 0, W * 0.2, W * 0.22, chestH, 7);
    const hoodH = H * 0.16;
    const hood = P.cyl('stone', 0, 0, 0, W * 0.04, W * 0.17, hoodH, 6);
    hood.rotateX(0.22);
    hood.translate(0, chestY + chestH / 2 + hoodH * 0.42, W * 0.03);
    // Arm raised forward holding the lantern.
    const armLen = H * 0.24;
    const arm = P.box('stone', 0, armLen / 2, 0, W * 0.09, armLen, W * 0.09);
    arm.rotateX(-1.0);
    arm.rotateZ(-0.35);
    arm.translate(W * 0.2, chestY + chestH * 0.25, 0);
    const lx = W * 0.2 + Math.sin(0.35) * armLen * 0.55;
    const ly = chestY + chestH * 0.25 + Math.cos(1.0) * armLen;
    const lz = Math.sin(1.0) * armLen * 0.95;
    P.box('metal', lx, ly - W * 0.07, lz, W * 0.12, W * 0.14, W * 0.12);
    P.glow(lx, ly - W * 0.07, lz, W * 0.05, PALETTE.amber, 0.9);
    // Staff in the other hand.
    P.cyl('metal', -W * 0.3, base + plinthH + H * 0.4, W * 0.08, W * 0.025, W * 0.025, H * 0.8, 5);
  },
  machinery(P, sx, sy, sz) {
    P.box('metal', 0, 0, -sz * 0.25, sx * 0.9, sy * 0.9, sz * 0.5);
    const gr = Math.min(sx, sy) * 0.36;
    const gz = sz * 0.12;
    P.cyl('metal', -sx * 0.12, sy * 0.05, gz, gr * 0.86, gr * 0.86, sz * 0.18, 16, 'z');
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      P.box('metal', -sx * 0.12 + Math.cos(a) * gr * 0.95, sy * 0.05 + Math.sin(a) * gr * 0.95, gz, gr * 0.16, gr * 0.2, sz * 0.18, 0, 0, a);
    }
    P.cyl('metal', -sx * 0.12, sy * 0.05, gz, gr * 0.16, gr * 0.16, sz * 0.4, 8, 'z');
    const g2 = gr * 0.45;
    P.cyl('metal', sx * 0.28, -sy * 0.22, gz, g2, g2, sz * 0.16, 12, 'z');
    P.cyl('metal', sx * 0.3, 0, gz + sz * 0.08, sx * 0.03, sx * 0.03, sy * 0.9, 6);
  },
  cage(P, sx, sy) {
    const r = sx * 0.45;
    const ch = sy * 0.62;
    const cy = -sy / 2 + ch / 2;
    P.cyl('metal', 0, cy + ch / 2 + r * 0.2, 0, r * 0.15, r * 1.02, r * 0.4, 8);
    P.cyl('metal', 0, cy - ch / 2, 0, r, r * 0.92, r * 0.12, 8);
    const bars = 10;
    for (let i = 0; i < bars; i++) {
      const a = (i / bars) * Math.PI * 2;
      P.box('metal', Math.cos(a) * r * 0.97, cy, Math.sin(a) * r * 0.97, r * 0.06, ch, r * 0.06);
    }
    P.cyl('metal', 0, cy + ch * 0.1, 0, r * 0.98, r * 0.98, r * 0.06, 10, 'y', true);
    const top = cy + ch / 2 + r * 0.4;
    if (sy / 2 > top) P.cyl('metal', 0, (top + sy / 2) / 2, 0, r * 0.05, r * 0.05, sy / 2 - top, 5);
  },
  lamp(P, sx, sy, sz, item) {
    const s = Math.max(0.15, Math.min(sx, sy));
    const lit = !item || item.lit !== false;
    P.box('metal', 0, s * 0.35, -sz / 2 + s * 0.25, s * 0.12, s * 0.12, s * 0.5);
    P.box('metal', 0, s * 0.42, 0, s * 0.5, s * 0.08, s * 0.5);
    P.box('metal', 0, -s * 0.42, 0, s * 0.42, s * 0.08, s * 0.42);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      P.box('metal', Math.cos(a) * s * 0.2, 0, Math.sin(a) * s * 0.2, s * 0.04, s * 0.8, s * 0.04);
    }
    if (lit) P.glow(0, 0, 0, s * 0.14, PALETTE.amber, 1);
    else P.box('metal', 0, 0, 0, s * 0.16, s * 0.3, s * 0.16);
  },
  pipe(P, sx, sy, sz) {
    const axis = sy >= sx && sy >= sz ? 'y' : sx >= sz ? 'x' : 'z';
    const len = axis === 'y' ? sy : axis === 'x' ? sx : sz;
    const r = (axis === 'y' ? Math.min(sx, sz) : axis === 'x' ? Math.min(sy, sz) : Math.min(sx, sy)) / 2;
    P.cyl('metal', 0, 0, 0, r * 0.82, r * 0.82, len, 10, axis);
    const n = Math.max(1, Math.floor(len / 3.2));
    for (let i = 0; i <= n; i++) {
      const t = -len / 2 + (len * i) / n;
      const fl = Math.max(0.05, r * 0.25);
      if (axis === 'y') P.cyl('metal', 0, t, 0, r, r, fl, 10, 'y');
      else if (axis === 'x') P.cyl('metal', t, 0, 0, r, r, fl, 10, 'x');
      else P.cyl('metal', 0, 0, t, r, r, fl, 10, 'z');
    }
  },
  girder(P, sx, sy, sz) {
    // I-beam along the longest axis.
    if (sy >= sx && sy >= sz) {
      const w = Math.min(sx, sz);
      P.box('metal', 0, 0, 0, w * 0.18, sy, w);
      P.box('metal', -w / 2 + w * 0.06, 0, 0, w * 0.12, sy, w);
      P.box('metal', w / 2 - w * 0.06, 0, 0, w * 0.12, sy, w);
      return;
    }
    const alongX = sx >= sz;
    const L = alongX ? sx : sz;
    const W = alongX ? sz : sx;
    const H = sy;
    const fl = Math.max(0.04, H * 0.12);
    const make = (cx, cy, l, h, w) => (alongX ? P.box('metal', cx, cy, 0, l, h, w) : P.box('metal', 0, cy, cx, w, h, l));
    make(0, 0, L, H, W * 0.16);
    make(0, H / 2 - fl / 2, L, fl, W);
    make(0, -H / 2 + fl / 2, L, fl, W);
    const ribs = Math.max(1, Math.floor(L / 1.6));
    for (let i = 1; i < ribs; i++) make(-L / 2 + (L * i) / ribs, 0, fl * 0.6, H - fl * 2, W * 0.9);
  },
  cables(P, sx, sy, sz) {
    const n = 3;
    for (let i = 0; i < n; i++) {
      const z = (i - (n - 1) / 2) * Math.max(0.2, sz / n);
      const sag = sy * (0.55 + 0.4 * ((i * 0.37) % 1));
      P.cable('metal', -sx / 2, sy / 2, z, sx / 2, sy / 2 - sy * 0.08 * i, z, sag, Math.max(0.025, Math.min(0.09, sx * 0.004)));
    }
  },
  ribs(P, sx, sy, sz) {
    const n = Math.max(2, Math.round(sz / 2.4));
    const R = sx / 2;
    for (let i = 0; i < n; i++) {
      const z = n === 1 ? 0 : -sz / 2 + (sz * i) / (n - 1);
      _m4.makeScale(1, sy / Math.max(R, 0.01), 1);
      _m4.premultiply(new THREE.Matrix4().makeTranslation(0, -sy / 2, z));
      P.torus('flesh', R, Math.max(0.08, R * 0.06), 6, 16, Math.PI, _m4);
    }
    P.box('flesh', 0, sy / 2 - Math.max(0.1, R * 0.05), 0, Math.max(0.2, R * 0.09), Math.max(0.2, R * 0.09), sz);
  },
  pillar(P, sx, sy, sz) {
    const r = Math.min(sx, sz) / 2;
    const capH = Math.min(sy * 0.08, r * 0.9);
    P.cyl('stone', 0, 0, 0, r * 0.78, r * 0.82, sy - capH * 2, 8);
    P.box('stone', 0, sy / 2 - capH / 2, 0, r * 2, capH, r * 2);
    P.box('stone', 0, -sy / 2 + capH / 2, 0, r * 2, capH, r * 2);
  },
  tower(P, sx, sy, sz) {
    // An inverted tower hanging into the dark: wide at the top, tapering to a spire.
    const g = new THREE.CylinderGeometry(sx / 2, sx * 0.18, sy * 0.8, 6, 1);
    g.translate(0, sy * 0.1, 0);
    P.geo('stone', g);
    P.cyl('stone', 0, -sy * 0.4, 0, sx * 0.18, 0.05, sy * 0.2, 6);
    P.box('stone', 0, sy / 2 - sy * 0.04, 0, sx * 1.1, sy * 0.08, sz * 1.1);
  },
  cliff(P, sx, sy, sz) {
    const g = new THREE.IcosahedronGeometry(0.5, 1);
    const p = g.attributes.position;
    const rng = P.rng;
    for (let i = 0; i < p.count; i++) {
      const k = 0.8 + rng() * 0.4;
      p.setXYZ(i, p.getX(i) * sx * k, p.getY(i) * sy * k, p.getZ(i) * sz * k);
    }
    P.geo('rock', g);
  },
  'broken-bridge'(P, sx, sy, sz) {
    const deckH = Math.max(0.15, Math.min(sy * 0.4, 0.5));
    const top = sy / 2 - deckH / 2;
    let x = -sx / 2;
    const rng = P.rng;
    while (x < sx / 2 - 0.4) {
      const l = Math.min(sx / 2 - x, 0.8 + rng() * 2.2);
      const drop = x > sx * 0.15 ? (x - sx * 0.15) * 0.15 : 0;
      P.box('metal', x + l / 2, top - drop, 0, l * 0.96, deckH, sz * (0.85 + rng() * 0.15), 0, 0, -drop * 0.05);
      x += l + (x > 0 ? rng() * 0.4 : 0.05);
    }
    for (let px = -sx / 2 + 0.3; px < sx * 0.2; px += 1.6) {
      P.box('metal', px, top + 0.55, sz / 2 - 0.05, 0.06, 1.1, 0.06);
      P.box('metal', px, top + 0.55, -sz / 2 + 0.05, 0.06, 1.1, 0.06);
    }
    P.box('metal', -sx / 2 + sx * 0.36, top + 1.05, sz / 2 - 0.05, sx * 0.72, 0.05, 0.05);
  },
  glyphs(P, sx, sy, sz) {
    const rng = P.rng;
    const z = sz / 2 + 0.01;
    const n = Math.max(3, Math.round(sx / 0.6));
    const gw = sx / n;
    for (let i = 0; i < n; i++) {
      const cx = -sx / 2 + gw * (i + 0.5);
      const h = sy * 0.7;
      const strokes = 2 + Math.floor(rng() * 3);
      for (let s = 0; s < strokes; s++) {
        const x0 = cx + (rng() - 0.5) * gw * 0.6;
        const y0 = (rng() - 0.5) * h;
        const x1 = cx + (rng() - 0.5) * gw * 0.6;
        const y1 = (rng() - 0.5) * h;
        P.glowLine(x0, y0, z, x1, y1, z, Math.max(0.02, gw * 0.06), PALETTE.verd, 0.75);
      }
    }
  },
  'shaft-light'(P, sx, sy, sz, item) {
    const col = typeof item.color === 'string' || typeof item.color === 'number' ? item.color : PALETTE.cyan;
    P.shaft(0, 0, 0, Math.max(sx, sz) * 0.3, Math.max(sx, sz) * 0.55, sy, col, 0.09);
  },
  debris(P, sx, sy, sz) {
    const rng = P.rng;
    const n = 6 + Math.floor(rng() * 6);
    for (let i = 0; i < n; i++) {
      const s = 0.2 + rng() * 0.6;
      P.box('stone', (rng() - 0.5) * sx, -sy / 2 + s * 0.4 * sy, (rng() - 0.5) * sz, s * sx * 0.3, s * sy * 0.5, s * sz * 0.3, rng(), rng() * 3, rng());
    }
  },
  gear(P, sx, sy, sz) {
    const r = Math.min(sx, sy) / 2;
    P.cyl('metal', 0, 0, 0, r * 0.85, r * 0.85, sz, 18, 'z');
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      P.box('metal', Math.cos(a) * r * 0.92, Math.sin(a) * r * 0.92, 0, r * 0.15, r * 0.18, sz, 0, 0, a);
    }
    P.cyl('metal', 0, 0, 0, r * 0.18, r * 0.18, sz * 1.6, 8, 'z');
  },
  bones(P, sx, sy, sz) {
    const rng = P.rng;
    for (let i = 0; i < 5; i++) {
      P.cyl('stone', (rng() - 0.5) * sx * 0.7, -sy / 2 + 0.06, (rng() - 0.5) * sz * 0.7, 0.035, 0.03, Math.max(0.3, sx * 0.4), 5, rng() > 0.5 ? 'x' : 'z');
    }
  },
};
DECOR['still-lamp'] = (P, sx, sy) => {
  // The Still Lamp: a tall cage of pale iron around a flame that does not move.
  const H = Math.max(1.2, sy);
  const R = Math.max(0.3, sx * 0.5);
  const base = -sy / 2;
  P.box('metal', 0, base + H * 0.04, 0, R * 2.3, H * 0.08, R * 2.3);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    P.box('metal', Math.cos(a) * R * 0.92, base + H * 0.5, Math.sin(a) * R * 0.92, H * 0.022, H * 0.86, H * 0.022);
  }
  P.cyl('metal', 0, base + H * 0.95, 0, R * 0.12, R * 1.25, H * 0.14, 8);
  P.cyl('metal', 0, base + H * 0.1, 0, R * 1.1, R * 1.25, H * 0.06, 8);
  P.cyl('metal', 0, base + H * 4.2, 0, H * 0.018, H * 0.018, H * 6.4, 5);
  P.glow(0, base + H * 0.46, 0, R * 0.32, PALETTE.still, 1);
  P.glow(0, base + H * 0.6, 0, R * 0.18, PALETTE.still, 1);
};
DECOR.grate = (P, sx, sy, sz) => {
  const size = [sx, sy, sz];
  const thin = size.indexOf(Math.min(sx, sy, sz));
  gateBars(P, size, thin);
};
DECOR['far-structure'] = (P, sx, sy, sz, item) => farShape(P, 'stone', (item && item.variant) || 'tower', sx, sy, sz);
DECOR.column = DECOR.pillar;
DECOR.cable = DECOR.cables;
DECOR.lightshaft = DECOR['shaft-light'];
DECOR.beam = DECOR['shaft-light'];
DECOR['light-shaft'] = DECOR['shaft-light'];
DECOR.brokenBridge = DECOR['broken-bridge'];
DECOR.rubble = DECOR.debris;
DECOR.gears = DECOR.gear;
DECOR.ribcage = DECOR.ribs;
DECOR.lantern = DECOR.lamp;
DECOR.rock = DECOR.cliff;
DECOR.boulder = DECOR.cliff;

/** Iron bars filling a thin box (the chamber gate). size = [x,y,z], thin = index of the thin axis. */
function gateBars(P, size, thin) {
  const axes = [0, 1, 2].filter((a) => a !== thin);
  const barAxis = thin !== 1 ? 1 : size[axes[0]] >= size[axes[1]] ? axes[1] : axes[0];
  const spreadAxis = axes.find((a) => a !== barAxis);
  const n = Math.max(2, Math.round(size[spreadAxis] / 0.32));
  const dims = (a, len, w) => {
    const d = [w, w, w];
    d[a] = len;
    return d;
  };
  for (let i = 0; i <= n; i++) {
    const c = [0, 0, 0];
    c[spreadAxis] = -size[spreadAxis] / 2 + (size[spreadAxis] * i) / n;
    const d = dims(barAxis, size[barAxis], 0.07);
    P.box('metal', c[0], c[1], c[2], d[0], d[1], d[2]);
  }
  for (const k of [-1, -0.33, 0.33, 1]) {
    const c = [0, 0, 0];
    c[barAxis] = (k * size[barAxis]) / 2;
    const d = dims(spreadAxis, size[spreadAxis], Math.abs(k) === 1 ? 0.18 : 0.08);
    d[thin] = Math.max(0.1, size[thin] * (Math.abs(k) === 1 ? 1 : 0.6));
    P.box('metal', c[0], c[1], c[2], d[0], d[1], d[2]);
  }
}

/** Colossal silhouettes (variant: tower | spire | statue | bridge | arch), centred, local size w × h × d. */
function farShape(P, list, variant, w, h, d) {
  const mat = new THREE.Matrix4();
  switch (variant) {
    case 'spire': {
      // a downward needle: broad collar at the top, tapering to a point far below
      P.geo(list, new THREE.CylinderGeometry(w / 2, 0.05, h * 0.82, 6, 1), mat.makeTranslation(0, -h * 0.09, 0));
      P.geo(list, new THREE.CylinderGeometry(w * 0.2, w / 2, h * 0.18, 6, 1), mat.makeTranslation(0, h * 0.41, 0));
      for (let i = 1; i <= 3; i++) {
        const y = h / 2 - h * 0.18 - i * h * 0.12;
        const r = (w / 2) * (1 - (h / 2 - h * 0.18 - y) / (h * 0.82)) + w * 0.08;
        P.geo(list, new THREE.CylinderGeometry(r, r, Math.max(0.3, h * 0.012), 6, 1), mat.makeTranslation(0, y, 0));
      }
      break;
    }
    case 'statue': {
      P.geo(list, new THREE.CylinderGeometry(w * 0.2, w * 0.42, h * 0.62, 7, 1), mat.makeTranslation(0, -h * 0.19, 0));
      P.geo(list, new THREE.CylinderGeometry(w * 0.22, w * 0.24, h * 0.16, 7, 1), mat.makeTranslation(0, h * 0.2, 0));
      P.geo(list, new THREE.ConeGeometry(w * 0.2, h * 0.2, 6, 1), mat.makeTranslation(0, h * 0.38, d * 0.05));
      P.geo(list, new THREE.BoxGeometry(w * 0.1, h * 0.3, w * 0.1), mat.makeRotationX(-0.9).setPosition(w * 0.24, h * 0.3, d * 0.2));
      P.geo(list, new THREE.BoxGeometry(w * 0.14, w * 0.18, w * 0.14), mat.makeTranslation(w * 0.26, h * 0.42, d * 0.42));
      break;
    }
    case 'bridge': {
      P.geo(list, new THREE.BoxGeometry(w, h * 0.35, d), mat.makeTranslation(0, h * 0.32, 0));
      const n = Math.max(2, Math.round(w / 30));
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + (w * (i + 0.5)) / n;
        P.geo(list, new THREE.CylinderGeometry(0.5, 0.5, h * 3, 5, 1), mat.makeTranslation(x, -h * 1.2, 0));
      }
      break;
    }
    case 'arch': {
      DECOR.arch(P, w, h, d);
      if (list !== 'stone') {
        const moved = P.lists.stone.splice(0);
        P.lists[list].push(...moved);
      }
      break;
    }
    default: {
      // inverted tower: wide crown, tapering downward into a spire
      P.geo(list, new THREE.CylinderGeometry(w / 2, w * 0.12, h * 0.85, 6, 1), mat.makeTranslation(0, -h * 0.075, 0));
      P.geo(list, new THREE.BoxGeometry(w * 1.2, h * 0.08, d * 1.2), mat.makeTranslation(0, h * 0.42, 0));
      P.geo(list, new THREE.CylinderGeometry(w * 0.12, 0.05, h * 0.15, 6, 1), mat.makeTranslation(0, -h * 0.42, 0));
    }
  }
}

const PLAQUE_TYPES = new Set(['sign', 'plaque', 'inscription', 'tablet']);

// =============================================================================
// Shape-select geometries (anchors, glyphs, hazards)
// =============================================================================

/** Merges {geo, shape, split, glow} parts into one geometry with aShape/aSplit/aGlow. */
function shapeGeometry(parts, withNormals) {
  const geos = [];
  for (const p of parts) {
    let g = nonIndexed(p.geo);
    if (withNormals && !g.attributes.normal) g.computeVertexNormals();
    keepAttrs(g, withNormals ? ['position', 'normal'] : ['position']);
    const n = g.attributes.position.count;
    const sh = new Float32Array(n).fill(p.shape);
    const sp = new Float32Array(n);
    const gl = new Float32Array(n);
    const pl = new Float32Array(n).fill(p.plate || 0);
    const pos = g.attributes.position;
    for (let i = 0; i < n; i++) {
      sp[i] = typeof p.split === 'function' ? p.split(pos.getX(i), pos.getY(i), pos.getZ(i)) : p.split || 0;
      gl[i] = typeof p.glow === 'function' ? p.glow(pos.getX(i), pos.getY(i), pos.getZ(i)) : p.glow || 0;
    }
    g.setAttribute('aShape', new THREE.BufferAttribute(sh, 1));
    g.setAttribute('aSplit', new THREE.BufferAttribute(sp, 1));
    g.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
    g.setAttribute('aPlate', new THREE.BufferAttribute(pl, 1));
    geos.push(g);
  }
  const out = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return out;
}

/** Flat quad strip line in the XY plane (glyph strokes). */
function lineQuad(x0, y0, x1, y1, w) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const l = hyp(dx, dy) || 1;
  const ux = dx / l;
  const uy = dy / l;
  // extend by w/2 so corners close
  const ax = x0 - ux * w * 0.5;
  const ay = y0 - uy * w * 0.5;
  const bx = x1 + ux * w * 0.5;
  const by = y1 + uy * w * 0.5;
  const nx = -uy * w * 0.5;
  const ny = ux * w * 0.5;
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.BufferAttribute(
      new Float32Array([ax + nx, ay + ny, 0, ax - nx, ay - ny, 0, bx - nx, by - ny, 0, ax + nx, ay + ny, 0, bx - nx, by - ny, 0, bx + nx, by + ny, 0]),
      3,
    ),
  );
  return g;
}

function polyLines(points, w, closed) {
  const out = [];
  const n = points.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    out.push(lineQuad(a[0], a[1], b[0], b[1], w));
  }
  return out;
}

function buildGlyphGeometry() {
  const parts = [];
  const W = 0.2;
  // 0 ring: circle outline + centre dot
  parts.push({ geo: new THREE.RingGeometry(0.78, 1, 28), shape: 0, glow: 0 });
  parts.push({ geo: new THREE.CircleGeometry(0.22, 10), shape: 0, glow: 0 });
  // 1 hook: downward triangle outline + vertical bar
  for (const g of polyLines(
    [
      [-1, 0.72],
      [1, 0.72],
      [0, -1],
    ],
    W,
    true,
  ))
    parts.push({ geo: g, shape: 1 });
  parts.push({ geo: lineQuad(0, 0.32, 0, -0.32, W * 0.9), shape: 1 });
  // 2 fragile: diamond outline in two halves + the crack
  const top = [0, 1.12];
  const right = [1, 0];
  const bottom = [0, -1.12];
  const left = [-1, 0];
  for (const g of polyLines([top, right, bottom], W, false)) parts.push({ geo: g, shape: 2, split: 1 });
  for (const g of polyLines([bottom, left, top], W, false)) parts.push({ geo: g, shape: 2, split: -1 });
  for (const g of polyLines(
    [
      [-0.1, 0.85],
      [0.18, 0.15],
      [-0.16, -0.2],
      [0.06, -0.85],
    ],
    W * 0.7,
    false,
  ))
    parts.push({ geo: g, shape: 2, split: 0 });
  return shapeGeometry(parts, false);
}

/** Anchor mounts, one light geometry per shape: [ring, hook, fragile, stub]. Local +Z = mount normal. */
function buildMountGeometries() {
  const plate = (parts, shape, s = 1) => {
    const g = new THREE.BoxGeometry(0.22 * s, 0.22 * s, 0.05);
    g.translate(0, 0, -0.2);
    parts.push({ geo: g, shape, glow: 0, plate: 1 });
    for (let i = 0; i < 4; i++) {
      const b = new THREE.CylinderGeometry(0.018, 0.018, 0.03, 4, 1);
      b.rotateX(Math.PI / 2);
      b.translate((i % 2 ? 0.075 : -0.075) * s, (i < 2 ? 0.075 : -0.075) * s, -0.17);
      parts.push({ geo: b, shape, glow: 0, plate: 1 });
    }
  };
  /** Chain-mounted anchors: no wall plate; a shackle bar up to the chain's last link (local +Y = up). */
  const shackle = (parts, shape, y0, z = 0) => {
    const b = new THREE.CylinderGeometry(0.02, 0.02, 0.32 - y0, 5, 1);
    b.translate(0, (0.32 + y0) / 2, z);
    parts.push({ geo: b, shape, glow: 0, plate: 2 });
    const eye = new THREE.TorusGeometry(0.045, 0.014, 4, 8);
    eye.rotateY(Math.PI / 2);
    eye.translate(0, 0.33, z);
    parts.push({ geo: eye, shape, glow: 0, plate: 2 });
  };
  const out = [];
  // 0 ring: heavy eye-bolt with a ring facing out
  {
    const parts = [];
    plate(parts, 0);
    const bolt = new THREE.CylinderGeometry(0.024, 0.024, 0.2, 5, 1);
    bolt.rotateX(Math.PI / 2);
    bolt.translate(0, 0.13, -0.1);
    parts.push({ geo: bolt, shape: 0, glow: 0, plate: 1 });
    shackle(parts, 0, 0.15);
    parts.push({ geo: new THREE.TorusGeometry(0.135, 0.028, 5, 14), shape: 0, glow: 0.6 });
    out.push(shapeGeometry(parts, true));
  }
  // 1 hook: bolt + J hook curling outward
  {
    const parts = [];
    plate(parts, 1);
    const bolt = new THREE.CylinderGeometry(0.026, 0.026, 0.2, 5, 1);
    bolt.rotateX(Math.PI / 2);
    bolt.translate(0, 0.08, -0.1);
    parts.push({ geo: bolt, shape: 1, glow: 0, plate: 1 });
    shackle(parts, 1, 0.07, -0.02);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.08, -0.02),
      new THREE.Vector3(0, 0.02, 0),
      new THREE.Vector3(0, -0.1, 0.0),
      new THREE.Vector3(0, -0.18, 0.07),
      new THREE.Vector3(0, -0.13, 0.15),
      new THREE.Vector3(0, -0.04, 0.16),
    ]);
    parts.push({ geo: new THREE.TubeGeometry(curve, 10, 0.03, 5, false), shape: 1, glow: 0.6 });
    out.push(shapeGeometry(parts, true));
  }
  // 2 fragile: corroded plate + stub + cracked diamond knob in two halves (they part under load)
  {
    const parts = [];
    plate(parts, 2, 1.1);
    const stub = new THREE.CylinderGeometry(0.03, 0.036, 0.16, 5, 1);
    stub.rotateX(Math.PI / 2);
    stub.translate(0, 0, -0.1);
    parts.push({ geo: stub, shape: 2, glow: 0, plate: 1 });
    shackle(parts, 2, 0.15);
    const knob = nonIndexed(new THREE.OctahedronGeometry(0.13, 0));
    knob.scale(0.9, 1.25, 0.65);
    const pos = knob.attributes.position;
    const half = (sign) => {
      const arr = [];
      for (let t = 0; t < pos.count; t += 3) {
        const cx = (pos.getX(t) + pos.getX(t + 1) + pos.getX(t + 2)) / 3;
        if ((cx >= 0 ? 1 : -1) !== sign) continue;
        for (let k = 0; k < 3; k++) arr.push(pos.getX(t + k), pos.getY(t + k), pos.getZ(t + k));
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(arr), 3));
      g.computeVertexNormals();
      return g;
    };
    parts.push({ geo: half(1), shape: 2, split: 1, glow: 0.6 });
    parts.push({ geo: half(-1), shape: 2, split: -1, glow: 0.6 });
    knob.dispose();
    out.push(shapeGeometry(parts, true));
  }
  // 3 broken stub
  {
    const parts = [];
    plate(parts, SHAPE_STUB);
    const stub = new THREE.CylinderGeometry(0.022, 0.03, 0.09, 5, 1);
    stub.rotateX(Math.PI / 2);
    stub.translate(0.01, -0.01, -0.13);
    parts.push({ geo: stub, shape: SHAPE_STUB, glow: 0, plate: 1 });
    shackle(parts, SHAPE_STUB, 0.12);
    out.push(shapeGeometry(parts, true));
  }
  return out;
}

/** Hazard element geometries, one per kind: [rebar bar, spike, saw blade]. Unit size, base at the origin, along +Y. */
function buildHazardGeometries() {
  const out = [];
  // 0 rebar: unit bar along +Y from 0..1 (r=1); the jagged tip glows dull red
  {
    const bar = new THREE.CylinderGeometry(0.8, 1, 1, 5, 1);
    bar.translate(0, 0.5, 0);
    out.push(shapeGeometry([{ geo: bar, shape: 0, glow: (x, y) => (y > 0.8 ? 0.8 : 0) }], true));
  }
  // 1 spike: cone 0..1
  {
    const cone = new THREE.ConeGeometry(1, 1, 5, 1);
    cone.translate(0, 0.5, 0);
    out.push(shapeGeometry([{ geo: cone, shape: 1, glow: (x, y) => (y > 0.7 ? 0.9 : 0) }], true));
  }
  // 2 saw blade: toothed disc in XZ (normal +Y), radius 1, thickness 1 (scaled)
  {
    const parts = [];
    const disc = new THREE.CylinderGeometry(0.86, 0.86, 1, 16, 1);
    parts.push({ geo: disc, shape: 2, glow: (x, y, z) => (hyp(x, z) > 0.8 ? 0.55 : 0) });
    const teeth = 14;
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      const t = new THREE.ConeGeometry(0.13, 0.28, 3, 1);
      t.rotateZ(-Math.PI / 2);
      t.translate(0.97, 0, 0);
      t.rotateY(-a);
      parts.push({ geo: t, shape: 2, glow: 0.7 });
    }
    parts.push({ geo: new THREE.CylinderGeometry(0.18, 0.18, 1.6, 6, 1), shape: 2, glow: 0 });
    out.push(shapeGeometry(parts, true));
  }
  return out;
}

/** Per-hand highlight overlays (XY plane, unit-ish radius). */
function buildHighlightGeometry(hand) {
  const geos = [];
  const W = 0.13;
  if (hand === 'left') {
    // Round: four arcs ("ring + brackets") and an inward tick on the LEFT.
    for (let i = 0; i < 4; i++) {
      const a0 = (i * Math.PI) / 2 + 0.32;
      geos.push(new THREE.RingGeometry(1.32, 1.32 + W, 10, 1, a0, Math.PI / 2 - 0.64));
    }
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-2.0, 0.22, 0, -2.0, -0.22, 0, -1.6, 0, 0]), 3));
    geos.push(tri);
  } else {
    // Square: four corner brackets and an inward tick on the RIGHT.
    const s = 1.38;
    const L = 0.58;
    for (const [sx, sy] of [
      [1, 1],
      [-1, 1],
      [-1, -1],
      [1, -1],
    ]) {
      geos.push(lineQuad(sx * s, sy * s, sx * (s - L), sy * s, W));
      geos.push(lineQuad(sx * s, sy * s, sx * s, sy * (s - L), W));
    }
    const tri = new THREE.BufferGeometry();
    tri.setAttribute('position', new THREE.BufferAttribute(new Float32Array([2.0, -0.22, 0, 2.0, 0.22, 0, 1.6, 0, 0]), 3));
    geos.push(tri);
  }
  const norm = geos.map((g) => keepAttrs(nonIndexed(g), ['position']));
  const out = mergeGeometries(norm, false);
  for (const g of norm) g.dispose();
  return out;
}

/** Radial glow sprite for Points. */
function glowTexture(size = 64) {
  let c = null;
  if (typeof document !== 'undefined') {
    c = document.createElement('canvas');
    c.width = size;
    c.height = size;
  }
  if (!c) return null;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Points material with a per-point size attribute and fade-to-black fog (additive). */
function glowPointsMaterial(tex, size, fogCap) {
  const mat = new THREE.PointsMaterial({
    size,
    map: tex,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    sizeAttenuation: true,
    toneMapped: false,
  });
  const cap = { value: fogCap };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFogCap = cap;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSize;')
      .replace('gl_PointSize = size;', 'gl_PointSize = size * aSize;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFogCap;')
      .replace(
        '#include <fog_fragment>',
        '#ifdef USE_FOG\n  gl_FragColor.rgb *= 1.0 - min( atFogFactor( vFogDepth ), uFogCap );\n#endif',
      );
  };
  mat.customProgramCacheKey = () => 'at3d-glowpoints';
  return mat;
}

/** Text plaque canvas (original inscriptions, phosphor-filled carving). */
function plaqueTexture(text, aspect) {
  if (typeof document === 'undefined') return null;
  const W = 1024;
  const H = Math.max(128, Math.min(1024, Math.round(W / Math.max(0.5, aspect))));
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  const lines = String(text || '').split('\n').slice(0, 6);
  const font = (px) => `600 ${Math.round(px)}px Georgia, 'Times New Roman', serif`;
  // Largest font size whose word-wrapped lines fit inside the plate.
  let fs = H * 0.42;
  let wrapped = [];
  for (let iter = 0; iter < 24; iter++) {
    ctx.font = font(fs);
    wrapped = [];
    for (const line of lines) {
      let cur = '';
      for (const w of line.split(/\s+/)) {
        const t = cur ? cur + ' ' + w : w;
        if (ctx.measureText(t).width > W * 0.88 && cur) {
          wrapped.push(cur);
          cur = w;
        } else cur = t;
      }
      if (cur) wrapped.push(cur);
    }
    const widest = Math.max(...wrapped.map((l) => ctx.measureText(l).width), 1);
    if (wrapped.length * fs * 1.25 <= H * 0.8 && widest <= W * 0.9) break;
    fs *= 0.9;
  }
  const n = Math.max(1, wrapped.length);
  ctx.font = font(fs);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#e8dcc0';
  ctx.shadowColor = 'rgba(184,240,224,0.6)';
  ctx.shadowBlur = fs * 0.25;
  for (let i = 0; i < n; i++) ctx.fillText(wrapped[i] || '', W / 2, H / 2 + (i - (n - 1) / 2) * fs * 1.25);
  // border rule
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(232,220,192,0.45)';
  ctx.lineWidth = 4;
  ctx.strokeRect(14, 14, W - 28, H - 28);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

// =============================================================================
// LevelView
// =============================================================================

export class LevelView {
  /**
   * @param {THREE.Scene} scene
   * @param {MaterialLibrary} materials
   */
  constructor(scene, materials) {
    this.scene = scene;
    this.mats = materials;
    this.root = new THREE.Group();
    this.root.name = 'LevelView';
    scene.add(this.root);
    this.level = null;
    this.time = 0;
    this.stats = { solids: 0, anchors: 0, hazards: 0, decor: 0, decorSkipped: 0, skippedTypes: [] };
    this._chunks = []; // { obj, box }
    this._plaques = []; // { mesh, pos }
    this._unitBox = new THREE.BoxGeometry(1, 1, 1);
    this._glyphGeo = buildGlyphGeometry();
    this._mountGeos = buildMountGeometries();
    this._hazGeos = buildHazardGeometries();
    this._shared = new Set([this._unitBox, this._glyphGeo, ...this._hazGeos, ...this._mountGeos]);
    this._glowTex = glowTexture(64);
    this.highlights = {
      left: this._makeHighlight('left', PALETTE.handLeft),
      right: this._makeHighlight('right', PALETTE.handRight),
    };
    this._attachPulse = new Map(); // anchor → time of attach
    this.fx = null; // optional FX (set by Renderer3D): grit trickles from loaded crumbling ledges
  }

  _makeHighlight(hand, color) {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
      toneMapped: false,
    });
    const mesh = new THREE.Mesh(buildHighlightGeometry(hand), mat);
    mesh.name = `TargetHighlight_${hand}`;
    mesh.renderOrder = 60;
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.matrixAutoUpdate = false;
    this.scene.add(mesh);
    return { mesh, mat, shown: 0, anchor: null, spin: hand === 'left' ? 1 : -1 };
  }

  clear() {
    for (const c of this.root.children.slice()) {
      this.root.remove(c);
      c.traverse((o) => {
        if (o.geometry && !this._shared.has(o.geometry)) o.geometry.dispose();
        if (o.userData.ownMaterial && o.material) {
          if (o.material.map && o.material.map !== this._glowTex) o.material.map.dispose();
          o.material.dispose();
        }
      });
    }
    this._chunks.length = 0;
    this._plaques.length = 0;
    this.level = null;
  }

  // ---------------------------------------------------------------------------
  // Build
  // ---------------------------------------------------------------------------
  build(level) {
    // Same layout again (a fresh Level3D for a restart): re-bind the live
    // objects instead of rebuilding geometry — no hitch on restart.
    if (level && this.level && this._sig && this._sig === LevelView.signature(level) && this._rebind(level)) return;
    this.clear();
    this.stats = { solids: 0, anchors: 0, hazards: 0, decor: 0, decorSkipped: 0, skippedTypes: [] };
    this.level = level;
    this._sig = level ? LevelView.signature(level) : null;
    if (!level) return;
    const b = level.bounds || { minX: -20, maxX: 20, minY: -600, maxY: 20, minZ: -20, maxZ: 20 };
    this._topY = num(b.maxY, 20);
    this._buildSolids(level);
    this._buildHazards(level);
    this._buildAnchors(level);
    this._buildDecor(level);
    this._buildColossal(level, b);
    this._buildLightGlows(level);
  }

  /** Layout identity: variant + object ids (fresh Level3D copies of the same data match). */
  static signature(level) {
    const ids = (list) => (Array.isArray(list) ? list.map((o) => (o && o.id != null ? o.id : '?')).join(',') : '');
    return [level.variant || '', ids(level.solids), ids(level.hazards), ids(level.anchors), ids(level.decor), Array.isArray(level.lights) ? level.lights.length : 0].join('|');
  }

  /** Points every live-state reference at the new level's objects (same ids). */
  _rebind(level) {
    const byId = new Map();
    for (const list of [level.solids, level.hazards, level.anchors]) for (const o of list || []) byId.set(o.id, o);
    const map = (o) => byId.get(o.id) || null;
    try {
      for (const set of this._solidSets || []) set.list = set.list.map(map);
      this._crumbles = (this._crumbles || []).map(map);
      for (const e of this._hazElems || []) e.haz = map(e.haz);
      this._anchors = (this._anchors || []).map(map);
    } catch {
      return false;
    }
    const ok =
      (this._solidSets || []).every((s) => s.list.every(Boolean)) &&
      this._crumbles.every(Boolean) &&
      (this._hazElems || []).every((e) => e.haz) &&
      this._anchors.every(Boolean);
    if (!ok) return false;
    this.level = level;
    this._attachPulse.clear();
    if (this._packAt) this._packAt.set(1e9, 1e9, 1e9);
    return true;
  }

  _band(y) {
    return Math.max(0, Math.floor((this._topY - y) / BAND_H));
  }

  _addChunk(obj) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3();
    if (obj.isInstancedMesh) {
      obj.computeBoundingBox();
      obj.computeBoundingSphere();
      box.copy(obj.boundingBox);
    } else {
      box.setFromObject(obj);
    }
    this._chunks.push({ obj, box });
    this.root.add(obj);
  }

  _buildSolids(level) {
    const solids = Array.isArray(level.solids) ? level.solids : [];
    const lists = {};
    this._crumbles = [];
    for (const s of solids) {
      if (!s || !isFinite(s.minX) || !isFinite(s.maxY)) continue;
      const bucket = BUCKET_OF[s.kind] || 'masonry';
      if (bucket === 'crumble') {
        this._crumbles.push(s);
        continue;
      }
      (lists[bucket] || (lists[bucket] = [])).push(s);
    }
    // One InstancedMesh per material bucket, re-packed with the solids near the
    // head whenever the head moves a little: ≤ 4 draw calls per eye for all
    // static geometry, no per-frame uploads while standing still.
    this._solidSets = [];
    for (const bucket of SOLID_BUCKETS) {
      const list = lists[bucket];
      if (!list || !list.length) continue;
      const mesh = new THREE.InstancedMesh(this._unitBox, this.mats.get(bucket), list.length);
      mesh.name = `solids_${bucket}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.setColorAt(0, _c.setRGB(1, 1, 1));
      const tints = new Float32Array(list.length * 3);
      for (let i = 0; i < list.length; i++) {
        this._solidTint(list[i], _c);
        tints[i * 3] = _c.r;
        tints[i * 3 + 1] = _c.g;
        tints[i * 3 + 2] = _c.b;
      }
      this.root.add(mesh);
      this._solidSets.push({ mesh, list, tints });
      this.stats.solids += list.length;
    }
    this._packAt = new THREE.Vector3(1e9, 1e9, 1e9);
    this._packDist = 0;
    this._packStamp = 0;
    // Crumbling ledges: one dynamic mesh (few instances, re-packed per frame).
    const nC = Math.max(1, this._crumbles.length);
    this._crumbleMesh = new THREE.InstancedMesh(this._unitBox, this.mats.get('crumble'), nC);
    this._crumbleMesh.name = 'solids_crumble';
    this._crumbleMesh.count = 0;
    this._crumbleMesh.frustumCulled = false;
    this._crumbleMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this._crumbles.length; i++) {
      this._solidTint(this._crumbles[i], _c);
      this._crumbleMesh.setColorAt(i, _c);
    }
    if (this._crumbleMesh.instanceColor) this._crumbleMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.root.add(this._crumbleMesh);
    this.stats.solids += this._crumbles.length;
  }

  /** Re-packs the static solids within `vd` of the head (only when needed). */
  _packSolids(head, vd, force) {
    const moved = this._packAt.distanceToSquared(head) > 1.5 * 1.5;
    const fogChanged = Math.abs(vd - this._packDist) > 3;
    this._packStamp++;
    // Generic `active` toggles are rare: pick them up at least every ~0.5 s.
    if (!force && !moved && !fogChanged && this._packStamp % 36 !== 0) return;
    this._packAt.copy(head);
    this._packDist = vd;
    // Pack a little wider than the view so small moves never reveal a hole.
    const r = vd + 4;
    for (const set of this._solidSets) {
      const { mesh, list, tints } = set;
      let n = 0;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.active === false) continue;
        const dx = Math.max(s.minX - head.x, 0, head.x - s.maxX);
        const dy = Math.max(s.minY - head.y, 0, head.y - s.maxY);
        const dz = Math.max(s.minZ - head.z, 0, head.z - s.maxZ);
        if (dx * dx + dy * dy + dz * dz > r * r) continue;
        mesh.setMatrixAt(n, this._solidMatrix(s, 0, 0, 0, _m4));
        _c.setRGB(tints[i * 3], tints[i * 3 + 1], tints[i * 3 + 2]);
        mesh.setColorAt(n, _c);
        n++;
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  }

  _solidMatrix(s, ox, oy, oz, out) {
    _v1.set((s.minX + s.maxX) / 2 + ox, (s.minY + s.maxY) / 2 + oy, (s.minZ + s.maxZ) / 2 + oz);
    _s.set(Math.max(0.01, s.maxX - s.minX), Math.max(0.01, s.maxY - s.minY), Math.max(0.01, s.maxZ - s.minZ));
    _q.identity();
    return out.compose(_v1, _q, _s);
  }

  _solidTint(s, out) {
    const r = makeRng(hashStr(s.id != null ? s.id : `${s.minX},${s.minY},${s.minZ}`));
    const k = 0.84 + r() * 0.26;
    switch (s.kind) {
      case 'pillar':
        out.setRGB(0.86 * k, 0.84 * k, 0.8 * k);
        break;
      case 'bridge':
        out.setRGB(1.12 * k, 0.9 * k, 0.76 * k);
        break;
      case 'metal':
        out.setRGB(0.95 * k, 0.96 * k, 1.0 * k);
        break;
      case 'wall':
        out.setRGB(k, k * (0.97 + r() * 0.04), k * (0.93 + r() * 0.06));
        break;
      default:
        out.setRGB(k, k, k);
    }
    return out;
  }

  _buildHazards(level) {
    const hz = Array.isArray(level.hazards) ? level.hazards : [];
    const elems = []; // { haz, shape, matrix, blade: {axis, cx,cy,cz, r, t} }
    const scratch = [];
    for (const h of hz) {
      if (!h || !isFinite(h.minX)) continue;
      const shape = HAZ_SHAPE[h.kind] != null ? HAZ_SHAPE[h.kind] : 0;
      const size = [h.maxX - h.minX, h.maxY - h.minY, h.maxZ - h.minZ];
      const minv = [h.minX, h.minY, h.minZ];
      const maxv = [h.maxX, h.maxY, h.maxZ];
      // Thin axis = the smallest extent; base side = the face touching a solid.
      let axis = 1;
      if (size[0] < size[axis]) axis = 0;
      if (size[2] < size[axis]) axis = 2;
      if (h.kind === 'spikes' && size[1] <= Math.max(size[0], size[2])) axis = 1;
      let dir = 1;
      if (typeof level.querySolids === 'function') {
        const probe = (side) => {
          const lo = minv.slice();
          const hi = maxv.slice();
          if (side < 0) {
            hi[axis] = minv[axis];
            lo[axis] = minv[axis] - 0.25;
          } else {
            lo[axis] = maxv[axis];
            hi[axis] = maxv[axis] + 0.25;
          }
          scratch.length = 0;
          const res = level.querySolids(lo[0], lo[1], lo[2], hi[0], hi[1], hi[2], scratch) || scratch;
          for (const s of res) {
            if (s.maxX < lo[0] || s.minX > hi[0] || s.maxY < lo[1] || s.minY > hi[1] || s.maxZ < lo[2] || s.minZ > hi[2]) continue;
            return true;
          }
          return false;
        };
        const below = probe(-1);
        const above = probe(1);
        if (!below && above) dir = -1;
      }
      const a1 = (axis + 1) % 3;
      const a2 = (axis + 2) % 3;
      const rng = makeRng(hashStr(h.id != null ? h.id : `${h.minX},${h.minY}`));
      const ax = new THREE.Vector3();
      ax.setComponent(axis, dir);
      const baseCoord = dir > 0 ? minv[axis] : maxv[axis];
      const depth = size[axis];
      if (shape === 2) {
        // Saw blades: discs facing along the thin axis, spaced along the longer of the others.
        const along = size[a1] >= size[a2] ? a1 : a2;
        const other = along === a1 ? a2 : a1;
        const r = Math.max(0.2, Math.min(size[other], size[along]) / 2) * 0.92;
        const n = Math.max(1, Math.floor(size[along] / (r * 2.2)));
        for (let i = 0; i < n; i++) {
          const c = new THREE.Vector3();
          c.setComponent(axis, (minv[axis] + maxv[axis]) / 2);
          c.setComponent(other, (minv[other] + maxv[other]) / 2);
          c.setComponent(along, minv[along] + (size[along] * (i + 0.5)) / n);
          const q = new THREE.Quaternion().setFromUnitVectors(_up, ax);
          elems.push({ haz: h, shape, pos: c, q, scale: new THREE.Vector3(r, Math.max(0.025, Math.min(0.05, depth * 0.4)), r), blade: true, spin: rng() * 6 });
        }
      } else {
        const spacing = shape === 1 ? 0.32 : 0.45;
        const n1 = Math.max(1, Math.round(size[a1] / spacing));
        const n2 = Math.max(1, Math.round(size[a2] / spacing));
        const cap = 160;
        const stepK = n1 * n2 > cap ? Math.sqrt((n1 * n2) / cap) : 1;
        const m1 = Math.max(1, Math.floor(n1 / stepK));
        const m2 = Math.max(1, Math.floor(n2 / stepK));
        for (let i = 0; i < m1; i++) {
          for (let j = 0; j < m2; j++) {
            if (shape === 0 && rng() < 0.25) continue;
            const p = new THREE.Vector3();
            p.setComponent(axis, baseCoord);
            p.setComponent(a1, minv[a1] + (size[a1] * (i + 0.2 + rng() * 0.6)) / m1);
            p.setComponent(a2, minv[a2] + (size[a2] * (j + 0.2 + rng() * 0.6)) / m2);
            const tilt = shape === 0 ? 0.45 : 0.12;
            _v2.copy(ax);
            _v2.setComponent(a1, _v2.getComponent(a1) + (rng() - 0.5) * tilt * 2);
            _v2.setComponent(a2, _v2.getComponent(a2) + (rng() - 0.5) * tilt * 2);
            _v2.normalize();
            const q = new THREE.Quaternion().setFromUnitVectors(_up, _v2);
            const len = depth * (shape === 0 ? 0.6 + rng() * 0.55 : 0.75 + rng() * 0.3);
            const r = shape === 0 ? 0.03 : 0.06 + rng() * 0.05;
            elems.push({ haz: h, shape, pos: p, q, scale: new THREE.Vector3(r, Math.max(0.1, len), r) });
          }
        }
      }
    }
    this._hazElems = elems;
    // One InstancedMesh per hazard kind, re-packed per frame with the elements near the head.
    this._hazSets = [];
    for (let k = 0; k < this._hazGeos.length; k++) {
      const mine = elems.filter((e) => e.shape === k);
      if (!mine.length) continue;
      const geo = this._hazGeos[k].clone();
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(mine.length * 4), 4);
      for (let i = 0; i < mine.length; i++) attr.setXYZW(i, k, 0, 0.55, 0);
      geo.setAttribute('iShape', attr);
      const mesh = new THREE.InstancedMesh(geo, this.mats.get('hazard'), mine.length);
      mesh.name = `hazards_${['rebar', 'spikes', 'blades'][k]}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < mine.length; i++) mesh.setColorAt(i, _c.setRGB(0.95, 0.72, 0.6));
      this.root.add(mesh);
      this._hazSets.push({ mesh, elems: mine });
    }
    this.stats.hazards = hz.length;
  }

  _buildAnchors(level) {
    const anchors = Array.isArray(level.anchors) ? level.anchors.filter((a) => a && isFinite(a.x)) : [];
    this._anchors = anchors;
    const n = Math.max(1, anchors.length);
    // Mounts: one InstancedMesh per shape, re-packed per frame with the anchors near the head.
    this._mountMeshes = [];
    for (let k = 0; k < this._mountGeos.length; k++) {
      const geo = this._mountGeos[k].clone();
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
      attr.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('iShape', attr);
      const mesh = new THREE.InstancedMesh(geo, this.mats.get('mount'), n);
      mesh.name = `anchorMounts_${['ring', 'hook', 'fragile', 'stub'][k]}`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.setColorAt(0, _c.setRGB(1, 1, 1));
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      this._mountMeshes.push({ mesh, attr, n: 0 });
      if (anchors.length) this.root.add(mesh);
    }
    this._anchorBase = []; // per-anchor { pos, q, normal, shape }
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const shape = ANCHOR_SHAPE[a.kind] != null ? ANCHOR_SHAPE[a.kind] : 0;
      const chain = a.mount === 'chain';
      let nrm;
      let q;
      if (chain) {
        // Hanging from a giant chain: upright, local +Y = up, facing a stable pseudo-random heading.
        const yaw = (hashStr(a.id) % 628) / 100;
        q = new THREE.Quaternion().setFromAxisAngle(_up, yaw);
        nrm = new THREE.Vector3(0, 0, 0); // glyphs/highlights sit on the anchor itself
      } else {
        nrm = a.normal && isFinite(a.normal.x) ? new THREE.Vector3(a.normal.x, a.normal.y, a.normal.z) : new THREE.Vector3(0, 0, 1);
        if (nrm.lengthSq() < 1e-6) nrm.set(0, 0, 1);
        nrm.normalize();
        // local +Z = mount normal, local +Y = world up projected (or world Z on ceilings/floors)
        const upRef = Math.abs(nrm.y) > 0.9 ? new THREE.Vector3(0, 0, nrm.y > 0 ? -1 : 1) : _up.clone();
        const xAxis = new THREE.Vector3().crossVectors(upRef, nrm).normalize();
        const yAxis = new THREE.Vector3().crossVectors(nrm, xAxis).normalize();
        q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(xAxis, yAxis, nrm));
      }
      this._anchorBase.push({ pos: new THREE.Vector3(a.x, a.y, a.z), q, normal: nrm, shape, chain: chain ? 1 : 0 });
    }

    // Glyph billboards (re-packed per frame: only anchors in view distance).
    const gg = this._glyphGeo.clone();
    const gShape = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    gShape.setUsage(THREE.DynamicDrawUsage);
    gg.setAttribute('iShape', gShape);
    const glyphs = new THREE.InstancedMesh(gg, this.mats.get('glyph'), n);
    glyphs.name = 'anchorGlyphs';
    glyphs.count = 0;
    glyphs.frustumCulled = false;
    glyphs.renderOrder = 20;
    glyphs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    glyphs.setColorAt(0, _c.setRGB(1, 1, 1));
    glyphs.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this._glyphs = glyphs;
    this._glyphShape = gShape;
    if (anchors.length) this.root.add(glyphs);
    this.stats.anchors = anchors.length;
  }

  _buildDecor(level) {
    const decor = Array.isArray(level.decor) ? level.decor : [];
    const bands = new Map(); // band → per-material geometry lists
    const skipped = new Set();
    let count = 0;
    const getBand = (y) => {
      const bi = this._band(y);
      if (!bands.has(bi)) bands.set(bi, { stone: [], metal: [], rock: [], flesh: [], glow: [], shaft: [] });
      return bands.get(bi);
    };
    const P = new Parts();
    const itemM = new THREE.Matrix4();
    /** Build in item-local space (front = +Z), rotate by rotY, move into the band of y. */
    const tris = (this.stats.decorTris = {});
    let curType = '';
    const addItem = (x, y, z, rotY, buildFn) => {
      for (const k of Object.keys(P.lists)) P.lists[k] = [];
      buildFn();
      let t = 0;
      for (const k of Object.keys(P.lists)) for (const g of P.lists[k]) t += g.attributes.position.count / 3;
      tris[curType] = (tris[curType] || 0) + t;
      itemM.makeRotationY(rotY || 0);
      itemM.setPosition(x, y, z);
      const band = getBand(y);
      for (const k of Object.keys(P.lists)) {
        for (const g of P.lists[k]) {
          g.applyMatrix4(itemM);
          band[k].push(g);
        }
      }
    };
    this._farItems = [];
    let haveStill = false;
    let haveGrate = false;
    for (const d of decor) {
      if (!d || !isFinite(d.x) || !isFinite(d.y)) continue;
      const type = String(d.type || '').toLowerCase();
      curType = type;
      // Level data: sx/sy/sz are the WORLD bounding box; yaw = facing (yaw 0 faces −Z).
      // Item-local frame: front = +Z, so rotate by yaw + π; local width/depth from the box.
      const wx = Math.max(0.05, num(d.sx, num(d.w, num(d.size, 1))));
      const sy = Math.max(0.05, num(d.sy, num(d.h, num(d.size, 1))));
      const wz = Math.max(0.05, num(d.sz, num(d.d, num(d.size, 1))));
      const yaw = num(d.yaw, 0);
      const c = Math.abs(Math.cos(yaw));
      const sn = Math.abs(Math.sin(yaw));
      const lw = c * wx + sn * wz;
      const ld = sn * wx + c * wz;
      const rotY = yaw + Math.PI;
      const z = num(d.z, 0);
      P.rng = makeRng(hashStr(d.id != null ? d.id : `${type}${d.x},${d.y}`));
      if (PLAQUE_TYPES.has(type)) {
        addItem(d.x, d.y, z, rotY, () => P.box('stone', 0, 0, -0.02, lw, sy, ld));
        this._addPlaque(d, lw, sy, ld, rotY);
        count++;
        continue;
      }
      if (type === 'cables' || type === 'cable') {
        const x2 = num(d.x2, NaN);
        if (isFinite(x2)) {
          const y2 = num(d.y2, d.y);
          const z2 = num(d.z2, z);
          const len = hyp(x2 - d.x, y2 - d.y, z2 - z);
          addItem(d.x, d.y, z, 0, () => {
            for (let i = 0; i < 3; i++) {
              const o = (i - 1) * 0.35;
              P.cable('metal', 0, o * 0.4, o, x2 - d.x, y2 - d.y + o * 0.4, z2 - z + o, len * (0.06 + i * 0.015), 0.045);
            }
          });
          count++;
          continue;
        }
      }
      if (type === 'far-structure' && !d.inside) {
        this._farItems.push({ x: d.x, y: d.y, z, w: lw, h: sy, d: ld, rotY, variant: d.variant || 'tower' });
        count++;
        continue;
      }
      if (type === 'still-lamp') {
        haveStill = true;
        this._stillLamp = new THREE.Vector3(d.x, d.y - sy / 2 + sy * 0.5, z);
      }
      if (type === 'grate') haveGrate = true;
      const fn = DECOR[type] || DECOR[d.type];
      if (!fn) {
        skipped.add(type);
        this.stats.decorSkipped++;
        continue;
      }
      addItem(d.x, d.y, z, rotY, () => fn(P, lw, sy, ld, d));
      count++;
    }
    // Gate bars from level.gate when the data has no 'grate' decor for it.
    const gate = level.gate;
    if (!haveGrate && gate && isFinite(gate.minX)) {
      const sz3 = [gate.maxX - gate.minX, gate.maxY - gate.minY, gate.maxZ - gate.minZ];
      const thin = sz3.indexOf(Math.min(...sz3));
      if (sz3[thin] <= 1.5) {
        addItem((gate.minX + gate.maxX) / 2, (gate.minY + gate.maxY) / 2, (gate.minZ + gate.maxZ) / 2, 0, () => gateBars(P, sz3, thin));
      }
    }
    // The Still Lamp from level.stillLamp / the goal when the data has no 'still-lamp' decor.
    if (!haveStill) {
      const sl = level.stillLamp;
      const goal = level.goal;
      let x = NaN;
      let y = NaN;
      let zz = NaN;
      if (sl && isFinite(sl.x)) {
        x = sl.x;
        y = sl.y;
        zz = num(sl.z, 0);
      } else if (goal && isFinite(goal.minX)) {
        x = (goal.minX + goal.maxX) / 2;
        y = goal.minY + 1.2;
        zz = (goal.minZ + goal.maxZ) / 2;
      }
      if (isFinite(x)) {
        this._stillLamp = new THREE.Vector3(x, y, zz);
        addItem(x, y, zz, 0, () => DECOR['still-lamp'](P, 1.2, 2.4, 1.2));
      }
    }
    // Merge per band per material.
    const matOf = { stone: 'decorStone', metal: 'decorMetal', rock: 'decorRock', flesh: 'decorFlesh', glow: 'decorGlow', shaft: 'lightShaft' };
    for (const [bi, lists] of bands) {
      for (const k of Object.keys(lists)) {
        const list = lists[k];
        if (!list.length) continue;
        let merged = null;
        try {
          merged = mergeGeometries(list, false);
        } catch {
          merged = null;
        }
        for (const g of list) g.dispose();
        if (!merged) continue;
        merged.computeBoundingSphere();
        const mesh = new THREE.Mesh(merged, this.mats.get(matOf[k]) || this.mats.get('decorStone'));
        mesh.name = `decor_${k}_${bi}`;
        mesh.matrixAutoUpdate = false;
        if (k === 'shaft') mesh.renderOrder = 10;
        this._addChunk(mesh);
      }
    }
    this.stats.decor = count;
    this.stats.skippedTypes = [...skipped];
  }

  _addPlaque(d, lw, sy, ld, rotY) {
    const text = d.text || d.label || d.title || '';
    if (!text) return;
    const tex = plaqueTexture(text, lw / sy);
    if (!tex) return;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(lw * 0.95, sy * 0.86), mat);
    mesh.userData.ownMaterial = true;
    mesh.name = `plaque_${d.id || ''}`;
    mesh.rotation.y = rotY;
    _v1.set(0, 0, ld / 2 + 0.012).applyAxisAngle(_up, rotY);
    mesh.position.set(d.x + _v1.x, d.y + _v1.y, num(d.z, 0) + _v1.z);
    mesh.renderOrder = 5;
    mesh.visible = false;
    this.root.add(mesh);
    this._plaques.push({ mesh, pos: mesh.position.clone() });
  }

  _buildColossal(level, b) {
    // A sparse procedural ring of colossal silhouettes just beyond the SHAFT's
    // walls at each height (level.shaftAt(y)), never overlapping level solids
    // (so nothing grows through the Vault or the walls). Seen through windows
    // and openings; the authored 'far-structure' decor is added after.
    const rng = makeRng(hashStr('colossal') ^ hashStr(level.seed || 'abyss'));
    const top = num(b.maxY, 20) + 40;
    const bottom = num(b.minY, -600) - 60;
    const P = new Parts();
    P.rng = rng;
    const windows = [];
    const winCol = [];
    const warm = new THREE.Color(PALETTE.amber);
    const cool = new THREE.Color(PALETTE.glow);
    const mat = new THREE.Matrix4();
    const box = new THREE.Box3();
    const tmpBox = new THREE.Box3();
    const scratch = [];
    const shaftAt = (y) => {
      let sh = null;
      if (typeof level.shaftAt === 'function') {
        try {
          sh = level.shaftAt(Math.min(num(b.maxY, 0), Math.max(num(b.minY, -600), y)));
        } catch {
          sh = null;
        }
      }
      return sh && isFinite(sh.minX) ? sh : { minX: num(b.minX, -20), maxX: num(b.maxX, 20), minZ: num(b.minZ, -20), maxZ: num(b.maxZ, 20) };
    };
    /** Keeps the geometry built since `start` unless it overlaps a solid; returns kept. */
    const accept = (start) => {
      const list = P.lists.stone;
      box.makeEmpty();
      for (let i = start; i < list.length; i++) {
        list[i].computeBoundingBox();
        box.union(list[i].boundingBox);
      }
      let hit = false;
      if (typeof level.querySolids === 'function' && !box.isEmpty()) {
        tmpBox.copy(box).expandByScalar(4);
        scratch.length = 0;
        const res = level.querySolids(tmpBox.min.x, tmpBox.min.y, tmpBox.min.z, tmpBox.max.x, tmpBox.max.y, tmpBox.max.z, scratch) || scratch;
        for (const s of res) {
          if (s.maxX < tmpBox.min.x || s.minX > tmpBox.max.x || s.maxY < tmpBox.min.y || s.minY > tmpBox.max.y || s.maxZ < tmpBox.min.z || s.minZ > tmpBox.max.z) continue;
          hit = true;
          break;
        }
      }
      if (hit) for (const g of list.splice(start)) g.dispose();
      return !hit;
    };
    for (let y = top; y > bottom; y -= 60 + rng() * 30) {
      const sh = shaftAt(y);
      const cx = (sh.minX + sh.maxX) / 2;
      const cz = (sh.minZ + sh.maxZ) / 2;
      const R0 = hyp((sh.maxX - sh.minX) / 2, (sh.maxZ - sh.minZ) / 2) + 18;
      const n = 3 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const ang = rng() * Math.PI * 2;
        const dist = R0 + 20 + rng() * 120;
        const x = cx + Math.cos(ang) * dist;
        const z = cz + Math.sin(ang) * dist;
        const kind = rng();
        const w = 8 + rng() * 20;
        const h = 60 + rng() * 120;
        const start = P.lists.stone.length;
        const myWin = [];
        if (kind < 0.55) {
          // inverted tower: wide crown above, tapering downward into a spire
          const g = new THREE.CylinderGeometry(w / 2, w * 0.12, h, 6, 1);
          mat.makeRotationY(rng() * Math.PI);
          mat.setPosition(x, y - h / 2, z);
          P.geo('stone', g, mat);
          const crown = new THREE.BoxGeometry(w * 1.25, w * 0.35, w * 1.25);
          mat.setPosition(x, y + w * 0.1, z);
          P.geo('stone', crown, mat);
          const nw = 6 + Math.floor(rng() * 10);
          for (let k = 0; k < nw; k++) {
            if (rng() < 0.45) continue;
            const t = rng() * 0.7;
            const rr = (w / 2) * (1 - t * 0.85) + 0.3;
            const a = rng() * Math.PI * 2;
            const c = rng() < 0.8 ? warm : cool;
            const kk = 0.25 + rng() * 0.45;
            myWin.push([x + Math.cos(a) * rr, y - t * h, z + Math.sin(a) * rr, c.r * kk, c.g * kk, c.b * kk]);
          }
        } else if (kind < 0.75) {
          // pillar / buttress rising out of sight
          mat.makeRotationY(rng() * Math.PI);
          mat.setPosition(x, y - h * 0.5, z);
          P.geo('stone', new THREE.BoxGeometry(w * 0.6, h * 1.6, w * 0.6), mat);
        } else if (kind < 0.88) {
          // colossal chain hanging from nowhere
          mat.makeRotationY(rng() * Math.PI);
          mat.setPosition(x, y - h * 0.3, z);
          P.geo('stone', new THREE.BoxGeometry(1.4, h * 1.4, 0.7), mat);
          for (let k = 0; k < 6; k++) {
            mat.setPosition(x, y - h * 0.3 - h * 0.7 + (k / 5) * h * 1.4, z);
            P.geo('stone', new THREE.BoxGeometry(2.6, 2.2, 2.6), mat);
          }
        } else {
          // statue of a Lanternwright, the size of a cathedral
          const sz = 30 + rng() * 40;
          mat.makeRotationY(rng() * Math.PI);
          mat.setPosition(x, y - sz / 2, z);
          P.geo('stone', new THREE.CylinderGeometry(sz * 0.15, sz * 0.3, sz, 7), mat);
          mat.setPosition(x, y + sz * 0.1, z);
          P.geo('stone', new THREE.ConeGeometry(sz * 0.14, sz * 0.25, 6), mat);
          myWin.push([x + sz * 0.2, y + sz * 0.05, z, warm.r * 0.9, warm.g * 0.9, warm.b * 0.9]);
        }
        if (accept(start)) {
          for (const wv of myWin) {
            windows.push(wv[0], wv[1], wv[2]);
            winCol.push(wv[3], wv[4], wv[5]);
          }
        }
      }
      // A span crossing the void beyond the walls (seen through openings).
      if (rng() < 0.5) {
        const a0 = rng() * Math.PI * 2;
        const span = 100 + rng() * 120;
        const d0 = R0 + 50 + rng() * 60;
        const start = P.lists.stone.length;
        mat.makeRotationY(a0 + Math.PI / 2);
        mat.setPosition(cx + Math.cos(a0) * d0, y - 20 - rng() * 30, cz + Math.sin(a0) * d0);
        P.geo('stone', new THREE.BoxGeometry(span, 3 + rng() * 4, 5 + rng() * 6), mat);
        accept(start);
      }
    }
    // Authored far structures (level decor 'far-structure'), same silhouette material.
    for (const f of this._farItems || []) {
      const start = P.lists.stone.length;
      farShape(P, 'stone', f.variant, f.w, f.h, f.d);
      mat.makeRotationY(f.rotY);
      mat.setPosition(f.x, f.y, f.z);
      for (let i = start; i < P.lists.stone.length; i++) P.lists.stone[i].applyMatrix4(mat);
      if (f.variant === 'tower' || f.variant === 'statue') {
        windows.push(f.x + f.w * 0.1, f.y + f.h * 0.3, f.z);
        winCol.push(warm.r * 0.7, warm.g * 0.7, warm.b * 0.7);
      }
    }
    const list = P.lists.stone;
    if (list.length) {
      const merged = mergeGeometries(list, false);
      for (const g of list) g.dispose();
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.mats.get('colossal'));
      mesh.name = 'colossal';
      mesh.matrixAutoUpdate = false;
      mesh.renderOrder = -5;
      this.root.add(mesh);
      this._colossal = mesh;
    }
    // Distant lit windows join the light-glow Points (one draw call for every glow).
    const sizes = [];
    for (let i = 0; i < windows.length / 3; i++) sizes.push(0.6 + rng() * 1.1);
    this._windowData = { pos: windows, col: winCol, size: sizes };
  }

  _buildLightGlows(level) {
    const lights = Array.isArray(level.lights) ? level.lights.filter((l) => l && isFinite(l.x)) : [];
    const extra = this._stillLamp ? 1 : 0;
    const win = this._windowData || { pos: [], col: [], size: [] };
    const nWin = win.size.length;
    const n = lights.length + extra + nWin;
    this._lightGlow = null;
    if (!n) return;
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    const size = new Float32Array(n);
    this._glowBase = new Float32Array(n * 3);
    this._glowFlicker = [];
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      pos[i * 3] = l.x;
      pos[i * 3 + 1] = l.y;
      pos[i * 3 + 2] = num(l.z, 0);
      _c.set(l.color != null ? l.color : PALETTE.amber);
      const k = THREE.MathUtils.clamp(0.45 + num(l.intensity, 1) * 0.3, 0.3, 1.1);
      this._glowBase[i * 3] = _c.r * k;
      this._glowBase[i * 3 + 1] = _c.g * k;
      this._glowBase[i * 3 + 2] = _c.b * k;
      size[i] = THREE.MathUtils.clamp(0.8 + num(l.range, 10) * 0.08, 0.8, 5);
      if (l.flicker) this._glowFlicker.push({ i, amt: typeof l.flicker === 'number' ? l.flicker : 0.5, seed: i * 1.37 });
    }
    let o = lights.length;
    if (extra) {
      pos[o * 3] = this._stillLamp.x;
      pos[o * 3 + 1] = this._stillLamp.y;
      pos[o * 3 + 2] = this._stillLamp.z;
      _c.set(PALETTE.still);
      this._glowBase[o * 3] = _c.r;
      this._glowBase[o * 3 + 1] = _c.g;
      this._glowBase[o * 3 + 2] = _c.b;
      size[o] = 5;
      o++;
    }
    for (let i = 0; i < nWin; i++, o++) {
      pos[o * 3] = win.pos[i * 3];
      pos[o * 3 + 1] = win.pos[i * 3 + 1];
      pos[o * 3 + 2] = win.pos[i * 3 + 2];
      this._glowBase[o * 3] = win.col[i * 3];
      this._glowBase[o * 3 + 1] = win.col[i * 3 + 1];
      this._glowBase[o * 3 + 2] = win.col[i * 3 + 2];
      size[o] = win.size[i] * 1.2;
    }
    col.set(this._glowBase);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const ca = new THREE.BufferAttribute(col, 3);
    ca.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('color', ca);
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    g.computeBoundingSphere();
    const pts = new THREE.Points(g, glowPointsMaterial(this._glowTex, 2.2, 0.72));
    pts.userData.ownMaterial = true;
    pts.name = 'lightGlows';
    pts.renderOrder = 15;
    pts.frustumCulled = false;
    this.root.add(pts);
    this._lightGlow = pts;
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------
  /**
   * @param {number} dt
   * @param {object} game  Game3D (reads level, player, tethers, diff, time)
   * @param {THREE.Vector3} head  world head position
   * @param {number} viewDist  current fog far (metres) for distance culling
   * @param {object} [fogInfo]  { color: THREE.Color } for the colossal tint
   */
  update(dt, game, head, viewDist, fogInfo) {
    if (!this.level) return;
    this.time += dt;
    const t = this.time;
    // Chunk culling by fog distance.
    const vd = viewDist + VIEW_MARGIN;
    for (let i = 0; i < this._chunks.length; i++) {
      const ch = this._chunks[i];
      ch.obj.visible = ch.box.distanceToPoint(head) < vd;
    }
    for (let i = 0; i < this._plaques.length; i++) {
      const p = this._plaques[i];
      p.mesh.visible = p.pos.distanceTo(head) < PLAQUE_DIST;
    }
    if (fogInfo && fogInfo.color && this._colossal) {
      // Silhouettes: well darker than the haze; the capped fog (stronger with
      // distance) layers near giants over far ones.
      this._colossal.material.color.copy(fogInfo.color).multiplyScalar(0.22);
    }
    this._updateSolidStates(game, head, vd);
    this._updateHazards(dt, head, vd);
    this._updateAnchors(game, head, t);
    this._updateHighlights(game, head, t);
    this._updateGlows(t);
  }

  _updateSolidStates(game, head, vd) {
    if (this._solidSets) this._packSolids(head, vd, false);
    // Crumbling ledges: shake with load, vanish when fallen.
    const list = this._crumbles;
    const mesh = this._crumbleMesh;
    if (!list || !list.length) return;
    const diff = game && game.diff;
    const crumbleTime = diff && diff.crumbleTime ? diff.crumbleTime : 0.9;
    let n = 0;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.active === false || s.fallen) continue;
      _box.min.set(s.minX, s.minY, s.minZ);
      _box.max.set(s.maxX, s.maxY, s.maxZ);
      if (_box.distanceToPoint(head) > vd) continue;
      const k = Math.min(1, (s.load || 0) / (crumbleTime * (s.life || 1)));
      const amp = k > 0 ? 0.012 + k * k * 0.05 : 0;
      if (k > 0 && this.fx && Math.random() < 0.25 + k * 0.5) {
        const rx = s.minX + Math.random() * (s.maxX - s.minX);
        const rz = s.minZ + Math.random() * (s.maxZ - s.minZ);
        this.fx.burst(Math.random() < 0.5 ? 'chips' : 'puff', rx, s.minY - 0.05, rz, { count: 1, spread: 0.05 });
      }
      const ph = i * 3.1;
      this._solidMatrix(s, Math.sin(this.time * 61 + ph) * amp, Math.sin(this.time * 47 + ph) * amp * 0.6, Math.cos(this.time * 53 + ph) * amp, _m4);
      mesh.setMatrixAt(n, _m4);
      this._solidTint(s, _c);
      if (k > 0) _c.multiplyScalar(1 + k * 0.25);
      mesh.setColorAt(n, _c);
      n++;
    }
    mesh.count = n;
    if (n) {
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.needsUpdate = true;
    }
  }

  _updateHazards(dt, head, vd) {
    const sets = this._hazSets;
    if (!sets || !sets.length) return;
    const r2 = (vd + 2) * (vd + 2);
    for (let k = 0; k < sets.length; k++) {
      const { mesh, elems } = sets[k];
      let n = 0;
      for (let i = 0; i < elems.length; i++) {
        const e = elems[i];
        if (e.haz.active === false || e.pos.distanceToSquared(head) > r2) continue;
        if (e.blade) {
          // saw blades turn slowly
          e.spin += dt * 2.2;
          _q.setFromAxisAngle(_up, e.spin);
          _q.premultiply(e.q);
          _m4.compose(e.pos, _q, e.scale);
        } else _m4.compose(e.pos, e.q, e.scale);
        mesh.setMatrixAt(n++, _m4);
      }
      mesh.count = n;
      if (n) mesh.instanceMatrix.needsUpdate = true;
    }
  }

  _anchorStress(a, diff) {
    if (a.kind !== 'fragile') return 0;
    const ft = diff && diff.fragileTime ? diff.fragileTime : 1.5;
    return THREE.MathUtils.clamp((a.load || 0) / (ft * (a.life || 1)), 0, 1);
  }

  _updateAnchors(game, head, t) {
    const anchors = this._anchors;
    if (!anchors || !anchors.length) return;
    const tethers = game && game.tethers;
    const hands = tethers && tethers.hands;
    const attL = hands && hands.left && hands.left.rope ? hands.left.rope.anchor : null;
    const attR = hands && hands.right && hands.right.rope ? hands.right.rope.anchor : null;
    const tgtL = hands && hands.left ? hands.left.target : null;
    const tgtR = hands && hands.right ? hands.right.target : null;
    const pl = game && game.player;
    const alive = !pl || pl.alive !== false;
    const range = (game && game.diff && game.diff.aimRange) || 32;
    const px = pl ? num(pl.rx, num(pl.x, head.x)) : head.x;
    const py = pl ? num(pl.ry, num(pl.y, head.y)) : head.y;
    const pz = pl ? num(pl.rz, num(pl.z, head.z)) : head.z;
    const mm = this._mountMeshes;
    for (let k = 0; k < mm.length; k++) mm[k].n = 0;
    const glyphs = this._glyphs;
    const gS = this._glyphShape;
    let g = 0;
    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const base = this._anchorBase[i];
      const dh = hyp(a.x - head.x, a.y - head.y, a.z - head.z);
      if (dh > GLYPH_MAX_DIST) continue;
      const stress = this._anchorStress(a, game && game.diff);
      const attached = a === attL || a === attR;
      const targeted = a === tgtL || a === tgtR;
      const dp = hyp(a.x - px, a.y - py, a.z - pz);
      const inRange = alive && dp <= range;
      let level = inRange ? 0.85 : 0.3;
      if (targeted) level = 1.05;
      if (attached) level = 1.35;
      let pulse = 0;
      const pulseT = this._attachPulse.get(a);
      if (pulseT != null) {
        const pt = t - pulseT;
        if (pt < 0.5) pulse = 1 - pt / 0.5;
        else this._attachPulse.delete(a);
      }
      // Physical mount (near only).
      if (dh <= MOUNT_MAX_DIST) {
        const shape = a.broken ? SHAPE_STUB : base.shape;
        const slot = mm[shape];
        const j = slot.n++;
        _v1.copy(base.pos);
        if (!a.broken && (stress > 0.01 || (a.load || 0) > 0)) {
          const amp = 0.006 + stress * stress * 0.03;
          _v1.x += Math.sin(t * 63 + i) * amp;
          _v1.y += Math.cos(t * 47 + i) * amp;
          _v1.z += Math.sin(t * 71 + i * 2) * amp;
        }
        _s.set(1, 1, 1);
        slot.mesh.setMatrixAt(j, _m4.compose(_v1, base.q, _s));
        slot.attr.setXYZW(j, shape, stress, a.broken ? 0 : level + pulse * 0.8, base.chain);
        if (a.kind === 'fragile') slot.mesh.setColorAt(j, _c.setRGB(0.95, 0.66, 0.56));
        else slot.mesh.setColorAt(j, _c.setRGB(0.78, 0.74, 0.7));
      }
      // Glyph billboard (far readability; fades out up close where the mount reads).
      if (a.broken || dh < 0.4) continue;
      const near = THREE.MathUtils.smoothstep(dh, 1.4, 3.6);
      let bright = (inRange ? 0.95 : 0.34) * near;
      if (targeted) bright = Math.max(bright, 1.0 * near);
      if (attached) bright = 0.75 * near;
      bright += pulse * 0.6;
      if (bright < 0.02) continue;
      _v1.set(a.x + base.normal.x * 0.22, a.y + base.normal.y * 0.22, a.z + base.normal.z * 0.22);
      if (stress > 0) {
        _v1.x += Math.sin(t * 63 + i) * stress * 0.03;
        _v1.y += Math.cos(t * 47 + i) * stress * 0.03;
      }
      const scale = 0.17 * (1 + Math.max(0, dh - 3) * 0.05) * (1 + pulse * 0.5) * (1 + Math.sin(t * 2 + i * 1.7) * 0.03);
      this._billboard(_v1, head, scale, _m4);
      glyphs.setMatrixAt(g, _m4);
      if (a.kind === 'fragile') _c.setRGB(1.0 * bright, (0.86 - stress * 0.3) * bright, (0.7 - stress * 0.4) * bright);
      else _c.setRGB(0.91 * bright, 0.86 * bright, 0.75 * bright);
      glyphs.setColorAt(g, _c);
      gS.setXYZW(g, base.shape, stress, 0, 0);
      g++;
    }
    for (let k = 0; k < mm.length; k++) {
      const slot = mm[k];
      slot.mesh.count = slot.n;
      if (slot.n) {
        slot.mesh.instanceMatrix.needsUpdate = true;
        slot.mesh.instanceColor.needsUpdate = true;
        slot.attr.needsUpdate = true;
      }
    }
    glyphs.count = g;
    if (g) {
      glyphs.instanceMatrix.needsUpdate = true;
      glyphs.instanceColor.needsUpdate = true;
      gS.needsUpdate = true;
    }
  }

  /** Spherical billboard at p facing the head (world up kept unless looking straight up/down). */
  _billboard(p, head, scale, out) {
    _v2.subVectors(head, p);
    const len = _v2.length() || 1;
    _v2.multiplyScalar(1 / len); // forward (toward head)
    _v3.copy(_up);
    if (Math.abs(_v2.y) > 0.96) _v3.copy(_zAxis);
    const right = _s.crossVectors(_v3, _v2).normalize();
    _v3.crossVectors(_v2, right);
    const e = out.elements;
    e[0] = right.x * scale;
    e[1] = right.y * scale;
    e[2] = right.z * scale;
    e[3] = 0;
    e[4] = _v3.x * scale;
    e[5] = _v3.y * scale;
    e[6] = _v3.z * scale;
    e[7] = 0;
    e[8] = _v2.x * scale;
    e[9] = _v2.y * scale;
    e[10] = _v2.z * scale;
    e[11] = 0;
    e[12] = p.x;
    e[13] = p.y;
    e[14] = p.z;
    e[15] = 1;
    return out;
  }

  _updateHighlights(game, head, t) {
    const tethers = game && game.tethers;
    const hands = tethers && tethers.hands;
    const playing = !game || !game.state || game.state === 'playing';
    const pl = game && game.player;
    const alive = !pl || pl.alive !== false;
    for (const h of ['left', 'right']) {
      const hl = this.highlights[h];
      const st = hands ? hands[h] : null;
      const attached = st && st.rope ? st.rope.anchor : null;
      const target = st ? st.target : null;
      const anchor = attached || target;
      const want = playing && alive && anchor && !anchor.broken ? 1 : 0;
      hl.shown = want ? Math.min(1, hl.shown + 0.25) : Math.max(0, hl.shown - 0.2);
      if (want) hl.anchor = anchor;
      if (hl.shown <= 0 || !hl.anchor) {
        hl.mesh.visible = false;
        continue;
      }
      const a = hl.anchor;
      const n = a.mount === 'chain' || !a.normal ? _zero : a.normal;
      _v1.set(a.x + (n.x || 0) * 0.24, a.y + (n.y || 0) * 0.24, a.z + (n.z || 0) * 0.24);
      const d = _v1.distanceTo(head);
      const locked = !!attached;
      const base = 0.24 * (1 + Math.max(0, d - 2.5) * 0.06);
      const pulse = locked ? 0.78 : 1 + Math.sin(t * 6.5) * 0.06;
      const ease = 0.6 + 0.4 * hl.shown;
      this._billboard(_v1, head, base * pulse * ease, _m4);
      // spin about the view axis (left turns, right stays square but breathes)
      if (!locked && h === 'left') {
        _m4.multiply(_m4b.makeRotationZ(t * 1.4 * hl.spin));
      }
      hl.mesh.matrix.copy(_m4);
      hl.mesh.matrixWorld.copy(_m4);
      hl.mat.opacity = (locked ? 0.5 : 0.95) * hl.shown;
      hl.mesh.visible = true;
    }
  }

  _updateGlows(t) {
    const pts = this._lightGlow;
    if (!pts || !this._glowFlicker.length) return;
    const col = pts.geometry.attributes.color;
    const base = this._glowBase;
    for (let k = 0; k < this._glowFlicker.length; k++) {
      const f = this._glowFlicker[k];
      const i = f.i;
      const w = 1 - f.amt * 0.5 * (0.5 + 0.5 * Math.sin(t * 9.1 + f.seed) * Math.sin(t * 3.7 + f.seed * 2.3));
      col.array[i * 3] = base[i * 3] * w;
      col.array[i * 3 + 1] = base[i * 3 + 1] * w;
      col.array[i * 3 + 2] = base[i * 3 + 2] * w;
    }
    col.needsUpdate = true;
  }

  /** Brief scale pulse on an anchor's glyph (called on grapple:attach). */
  pulseAnchor(anchor) {
    if (anchor) this._attachPulse.set(anchor, this.time);
  }

  dispose() {
    this.clear();
    this.scene.remove(this.root);
    for (const h of ['left', 'right']) {
      const hl = this.highlights[h];
      this.scene.remove(hl.mesh);
      hl.mesh.geometry.dispose();
      hl.mat.dispose();
    }
    this._unitBox.dispose();
    this._glyphGeo.dispose();
    for (const g of this._mountGeos) g.dispose();
    for (const g of this._hazGeos) g.dispose();
    if (this._glowTex) this._glowTex.dispose();
  }
}
