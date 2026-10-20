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
 *  - Decor + environment dressing: per SECTION (the culling band), ONE merged
 *    static mesh per material (stone/metal/rock/flesh/glow/shaft); small dressing
 *    (kit parts, rings, beads) in a finer 32 m detail tier drawn only within
 *    46 m. A chunk draws only in the head's section and its two neighbours (the
 *    floors between sections hide the rest), then by fog distance + frustum.
 *    Plaque text planes are separate, distance culled.
 *  - Environment dressing (Dresser): the Lanternwright architecture and the
 *    growth planned over the collision boxes at load (piers, courses with
 *    phosphor inlays, lancet arcades, archivolts, crowns and kerbs on every
 *    walkable edge, corbel tables and atlas figures, hanging rib vaults,
 *    roots / burls / corner cords deeper down) + the Blender kit
 *    (assets/models/env/ch1_env_kit.glb, tools/abyssal-tether-3d/build_env_kit.py).
 *    Planned a few ms per frame (a generator, top section first) so no frame
 *    stalls; no extra draw calls beyond the per-section chunks.
 *  - Colossal silhouettes: one merged mesh (fog-capped), authored
 *    'far-structure' decor plus a sparse procedural ring beyond the walls.
 *  - Glows of environment lights, the Still Lamp and distant lit windows:
 *    one Points draw.
 *  - The chamber gate (portcullis): its own mesh (+1 call near the finale).
 *    Raised into the wall above the chamber mouth during play; drops when the
 *    Game closes it (game.gateClosed) and snaps open again on restart.
 *  - Instanced/points objects with nothing to draw are hidden (three otherwise
 *    still binds their program and uniforms per eye before skipping the draw).
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PALETTE } from './materials.js';

/** Math.hypot is ~20× slower than sqrt in V8 and allocates; hot paths use this. */
function hyp(x, y, z = 0) {
  return Math.sqrt(x * x + y * y + z * z);
}


const BAND_H = 64; // metres per decor culling band (levels without sections)
const DETAIL_BAND_H = 32; // finer bands for small dressing (kit parts, arcades, rings) ...
const DETAIL_DIST = 38; // ... drawn only this close: past it the fog has them (≈ 70 % fogged)
const VIEW_MARGIN = 6; // metres beyond fog far still drawn
const GLYPH_MAX_DIST = 110;
const MOUNT_MAX_DIST = 42; // physical anchor meshes beyond this are sub-pixel / fogged: glyphs carry them
const PLAQUE_DIST = 26;
const GATE_ACCEL = 120; // m/s²: the portcullis falls 7.5 m in ~0.35 s
const GATE_LIP = 0.5; // metres of the raised gate (spiked lip) left showing below the opening
const DECOR_MAT = { stone: 'decorStone', metal: 'decorMetal', rock: 'decorRock', flesh: 'decorFlesh', glow: 'decorGlow', shaft: 'lightShaft' };

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
    /** Vertex colour per lit list (the section grade); glow / shaft carry their own colours. */
    this.tint = { stone: [1, 1, 1], metal: [1, 1, 1], rock: [1, 1, 1], flesh: [1, 1, 1] };
  }
  _push(list, geo, matrix) {
    if (matrix) geo.applyMatrix4(matrix);
    const t = this.tint[list];
    if (t && !geo.attributes.color) {
      const n = geo.attributes.position.count;
      const c = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        c[i * 3] = t[0];
        c[i * 3 + 1] = t[1];
        c[i * 3 + 2] = t[2];
      }
      geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    }
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
  shaft(cx, cy, cz, rTop, rBot, h, color, k, phase = 0) {
    let g = new THREE.CylinderGeometry(rTop, rBot, h, 12, 4, true);
    g = nonIndexed(g);
    g.translate(cx, cy, cz);
    keepAttrs(g, ['position', 'normal']);
    const p = g.attributes.position;
    const col = new Float32Array(p.count * 3);
    _c.set(color);
    for (let i = 0; i < p.count; i++) {
      const t = (p.getY(i) - (cy - h / 2)) / h; // 0 bottom → 1 top
      // dust streaks: the beam is brighter along a few radial bands (angle noise)
      const ang = Math.atan2(p.getZ(i) - cz, p.getX(i) - cx);
      const streak = 0.62 + 0.38 * Math.sin(ang * 3 + phase) * Math.sin(ang * 5 - phase * 1.7 + t * 2);
      const a = k * (0.15 + 0.85 * t * t) * streak;
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
    // for the lower ~20 m (where anchors hang and the lantern reaches); above
    // that a cheap crossed-bar silhouette carries it up into the fog.
    const pitch = item && isFinite(item.link) && item.link > 0.05 ? item.link : Math.max(0.1, sx * 1.15);
    const total = Math.max(1, Math.round(sy / pitch));
    const n = Math.min(total, 24);
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
    // A pointed (two-centred) arch: moulded piers with capitals, a ring of
    // voussoirs with a keystone, an outer hood moulding.
    const pw = Math.max(0.6, sx * 0.12);
    const span = Math.max(1, sx - pw);
    const rise = Math.min(span * 0.85, Math.max(0.5, sy - pw * 1.5 - 1));
    const spring = sy / 2 - rise - pw * 0.6;
    const pierH = spring + sy / 2;
    if (pierH > 0.05) {
      for (const s of [-1, 1]) {
        const x = (s * (sx - pw)) / 2;
        P.box('stone', x, -sy / 2 + pierH / 2, 0, pw, pierH, sz);
        // engaged shaft on the pier's face and a capital block at the springing
        P.cyl('stone', x, -sy / 2 + pierH / 2, sz / 2, pw * 0.22, pw * 0.22, pierH, 6);
        P.box('stone', x, spring - pw * 0.12, 0, pw * 1.25, pw * 0.25, sz * 1.15);
        P.box('stone', x, -sy / 2 + pw * 0.2, 0, pw * 1.2, pw * 0.4, sz * 1.1);
      }
    }
    const pts = pointedArch(span, rise, 5);
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[i + 1];
      const am = Math.atan2(y1 - y0, x1 - x0);
      const segLen = Math.hypot(x1 - x0, y1 - y0) * 1.04;
      P.box('stone', (x0 + x1) / 2, spring + (y0 + y1) / 2, 0, segLen, pw, sz, 0, 0, am);
      // hood moulding riding the outer edge
      const ox = -Math.sin(am) * pw * 0.62;
      const oy = Math.cos(am) * pw * 0.62;
      P.box('stone', (x0 + x1) / 2 + ox, spring + (y0 + y1) / 2 + oy, sz * 0.12, segLen * 1.02, pw * 0.22, sz * 1.24, 0, 0, am);
    }
    // keystone at the point
    P.box('stone', 0, spring + rise + pw * 0.1, 0, pw * 0.8, pw * 1.3, sz * 1.2);
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
    // three nested shells: a bright core inside a wide faint skirt, so the beam has a soft falloff, not an edge
    const R = Math.max(sx, sz);
    const ph = (item.x || 0) * 0.37 + (item.y || 0) * 0.11;
    for (const [sc, kk, d] of [
      [1, 0.45, 0],
      [0.62, 0.7, 1.3],
      [0.34, 1.0, 2.1],
    ]) {
      P.shaft(0, 0, 0, R * 0.22 * sc, R * 0.8 * sc, sy, col, 0.075 * kk, ph + d);
    }
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

/**
 * Iron bars filling a thin box (the chamber gate). size = [x,y,z], thin = index of the thin axis.
 * spikes: iron points under the vertical bars (the portcullis's lip).
 */
function gateBars(P, size, thin, spikes = false) {
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
    if (spikes && barAxis === 1) {
      c[1] = -size[1] / 2 - 0.11;
      P.geo('metal', new THREE.ConeGeometry(0.055, 0.22, 4), _m4b.makeRotationX(Math.PI).setPosition(c[0], c[1], c[2]));
    }
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
      // a colossal pointed gate: two piers, a pointed ring, a crowning cornice
      const t = Math.min(d, w * 0.35);
      const pw = w * 0.16;
      const span = w - pw;
      const rise = span * 0.95;
      const spring = h / 2 - rise - h * 0.06;
      for (const sx of [-1, 1]) P.geo(list, new THREE.BoxGeometry(pw, spring + h / 2, t), mat.makeTranslation((sx * (w - pw)) / 2, (spring - h / 2) / 2, 0));
      const pts = pointedArch(span, rise, 6);
      for (let i = 0; i + 1 < pts.length; i++) {
        const [x0, y0] = pts[i];
        const [x1, y1] = pts[i + 1];
        const l = Math.hypot(x1 - x0, y1 - y0) + pw * 0.4;
        mat.makeRotationZ(Math.atan2(y1 - y0, x1 - x0)).setPosition((x0 + x1) / 2, spring + (y0 + y1) / 2, 0);
        P.geo(list, new THREE.BoxGeometry(l, pw * 0.8, t * 0.9), mat);
      }
      P.geo(list, new THREE.BoxGeometry(w * 1.1, h * 0.06, t * 1.1), mat.makeTranslation(0, h / 2 - h * 0.03, 0));
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
// Environment dressing — the Lanternwright architecture and the growth wrapped
// round the collision boxes. Purely visual (nothing here collides) and planned
// from the level's own boxes at load time, so it follows any layout:
//  - interior wall faces: engaged piers (pilasters) on a per-section rhythm with
//    bases / capitals / pendant corbels from the Blender kit, string courses
//    (every other one with a phosphor inlay), corner shafts, blind lancet
//    arcades, pointed archivolts over openings, sinew roots hanging from the
//    courses and burls (denser with depth)
//  - slabs (ledges, landings, spans, floors): carved crown mouldings on every
//    exposed edge (the rims of the descent's holes included), beads under thick
//    ones, corbels or hooded atlas figures where a ledge meets a wall
//  - iron beams that meet a wall: riveted knee braces
// Rules that keep it honest: no carving within DR.anchorClear of an anchor and
// no props / growth within DR.propClear (route anchors are never hidden or
// crowded); nothing penetrates a solid other than
// its host; anything deeper than DR.shallowD stays out of the player space
// above walkable tops (so a body pressed to a wall never swallows the camera);
// wall-hugging pieces (piers, courses, roots) are at most DR.shallowD deep.
// Geometry merges into the decor bands (same materials): no extra draw calls.
// =============================================================================

/**
 * Per-section grade (index = section): stone tint (linear multiplier),
 * growth density 0..1, phosphor inlay strength 0..1, course and pier rhythm (m),
 * blind arcades. Pale and ordered near the top; deeper, soot, rust and the
 * growth take the work over and the phosphor dies ("below this mark no lamps").
 */
const GRADE = [
  { stone: [1.12, 1.08, 1.0], growth: 0.0, inlay: 1.0, course: 8, pier: 7.3, arcade: true, saints: 3, gears: 0 }, // S1 Threshold
  { stone: [1.06, 1.04, 1.0], growth: 0.08, inlay: 0.9, course: 8, pier: 7.5, arcade: true, saints: 3, gears: 2 }, // S2 Long Swing
  { stone: [1.0, 0.98, 0.92], growth: 0.2, inlay: 0.8, course: 8, pier: 7.5, arcade: true, saints: 3, gears: 1 }, // S3 Broken Gallery
  { stone: [0.94, 0.97, 0.99], growth: 0.32, inlay: 0.75, course: 10, pier: 9, arcade: true, saints: 2, gears: 3, giant: 1.7, giantEvery: 3 }, // S4 Listening Vault
  { stone: [0.9, 0.8, 0.72], growth: 0.65, inlay: 0.35, course: 6, pier: 6, arcade: false, saints: 0, gears: 2 }, // S5 Gullet Stair
  { stone: [0.86, 0.82, 0.77], growth: 0.75, inlay: 0.3, course: 8, pier: 7.3, arcade: true, saints: 2, gears: 3, giant: 1.3, giantEvery: 3 }, // S6 Two Descents
  { stone: [0.84, 0.86, 0.88], growth: 0.85, inlay: 0.5, course: 12, pier: 10, arcade: true, saints: 10, gears: 2, giant: 2.3, giantEvery: 2 }, // S7 Hollow Nave
  { stone: [0.78, 0.68, 0.62], growth: 1.0, inlay: 0.0, course: 7, pier: 6.6, arcade: false, saints: 4, gears: 1, giant: 1.6, giantEvery: 3 }, // S8 Last Throat
];
/** Colossal turning cogs per section (S1..S8): the machine shows through the masonry from the second section down. */
/** Organ-pipe banks per section (S1..S8). */
const ORGAN = [0, 1, 2, 3, 2, 2, 3, 2];
const COG = [0, 2, 2, 3, 2, 3, 4, 3];
const WET_RAMP = [0.1, 0.15, 0.3, 0.2, 0.5, 0.6, 0.4, 0.7];
const COG_MAX = 48;
const DR = {
  wallMinH: 4.5, // solids taller than this are walls; lower ones are slabs
  anchorClear: 1.3, // no carving within this of an anchor ...
  propClear: 2.6, // ... and no props, figures or growth within this (anchors are never crowded)
  koH: 2.6, // player space above walkable tops ...
  koPad: 0.45, // ... and this far past their edges
  shallowD: 0.4, // pieces at most this deep may hug walls inside the player space
  interiorRay: 260, // a face is interior when rays from it hit another solid within this
  inlayK: 0.55, // phosphor inlay (ledge lips, kerbs) emissive strength (× grade.inlay): a faint edge, never a neon line
  rootK: 0.03, // hanging roots per metre of course (× growth)
  rootsPerFace: 3,
  burlsPerFace: 2,
  lancetsPerFace: 14,
  iconsPerFace: 2, // saints / gears per wall face (and GRADE caps per section)
  trunksPerFace: 3, // sinew trunks down a wall face (× growth)
  nearWall: 90, // arcades / growth only on faces whose opposite wall is nearer than this (far walls are fog)
};
const ROOTS = [
  ['ch1_env_root_c', 10, 1.8],
  ['ch1_env_root_b', 7.5, 1.8],
  ['ch1_env_root_a', 5, 1.4],
];
const FLESH_TINT = [1, 1, 1]; // the growth's grade lives on decorFlesh (dark, matte bruise-brown; no gore)
const INLAY_COL = new THREE.Color(0x4f8f84); // old phosphor: pale verdigris (anchors are warm white, shape-coded)

// Profiles: [d (out of the face), h (up), ao]. Extruded along the face.
const PROF_COURSE = [
  [0, 0, 0.6], [0.1, 0, 0.9], [0.12, -0.03, 1], [0.26, -0.07, 1], [0.26, -0.16, 1], [0.21, -0.2, 0.85],
  [0.17, -0.28, 0.8], [0.07, -0.36, 0.7], [0.05, -0.42, 0.6], [0, -0.42, 0.5],
];
// Slab-edge crown: kept shallow (0.15 m) so rays fired from a ledge's lip down
// past it (and the rope) clear it.
const PROF_CROWN = [
  [0, 0, 1], [0.04, 0, 1], [0.05, -0.07, 0.95], [0.13, -0.12, 1], [0.15, -0.2, 1], [0.12, -0.27, 0.8],
  [0.06, -0.38, 0.7], [0.03, -0.5, 0.6], [0, -0.5, 0.5],
];
const PROF_BEAD = [[0, 0.26, 0.6], [0.07, 0.23, 0.85], [0.11, 0.13, 1], [0.08, 0.03, 0.8], [0, 0, 0.6]];
// Pier plan [x, d, ao]: a shallow pilaster with a roll moulding down its front.
const PROF_PIER = [
  [-0.5, 0, 0.55], [0.5, 0, 0.55], [0.5, 0.14, 0.9], [0.38, 0.22, 1], [0.15, 0.22, 0.85], [0.14, 0.2, 0.8],
  [0.099, 0.299, 1], [0, 0.34, 1], [-0.099, 0.299, 1], [-0.14, 0.2, 0.8], [-0.15, 0.22, 0.85], [-0.38, 0.22, 1],
  [-0.5, 0.14, 0.9],
];
// Far walls (the Vault's): a plain chamfered pier, cheap at 100+ m in the fog.
const PROF_PIER_FAR = [[-0.5, 0, 0.55], [0.5, 0, 0.55], [0.5, 0.2, 0.9], [0.3, 0.34, 1], [-0.3, 0.34, 1], [-0.5, 0.2, 0.9]];
const PROF_PIER_BIG = [[-1.5, 0, 0.55], [1.5, 0, 0.55], [1.5, 0.7, 0.9], [1, 1.2, 1], [-1, 1.2, 1], [-1.5, 0.7, 0.9]];
const PROF_SHAFT = Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2;
  return [Math.sin(a) * 0.24, 0.22 + Math.cos(a) * 0.24, Math.cos(a) > -0.5 ? 0.95 : 0.6];
});
/**
 * Plan [x, d, ao] of a colossal engaged column of radius R: a fluted circle
 * whose centre stands 0.45 R out of the wall (the rest is sunk in it).
 */
function columnPlan(R, n = 14, flute = 0.06) {
  const c = 0.45 * R;
  const t0 = Math.acos(-c / R);
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = -t0 + (2 * t0 * i) / n;
    const r = R * (i % 2 ? 1 - flute : 1);
    pts.push([r * Math.sin(t), Math.max(0, c + r * Math.cos(t)), 0.6 + 0.4 * Math.max(0, Math.cos(t))]);
  }
  return pts;
}
const PROF_ANNULET = [[-0.55, 0, 0.6], [0.55, 0, 0.6], [0.55, 0.22, 0.9], [0.4, 0.38, 1], [-0.4, 0.38, 1], [-0.55, 0.22, 0.9]];

/** Signed area of a 2D polygon (first two components). */
function area2(pts) {
  let a = 0;
  for (let i = 0, n = pts.length; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

/**
 * Extrudes a closed profile into a non-indexed geometry with flat normals,
 * per-vertex AO (colour) and end caps. Item-local frame: x along the face, y up,
 * z out of the face. mode 'u': profile [d, h, ao], extruded along x from 0 to len.
 * mode 'y': profile [x, d, ao] (plan), extruded along y from 0 to len.
 */
function extrudeProfile(profile, len, mode, caps = true) {
  const n = profile.length;
  const ccw = area2(profile) > 0;
  const pos = [];
  const nrm = [];
  const col = [];
  const P3 = (p, t) => (mode === 'u' ? [t, p[1], p[0]] : [p[0], t, p[1]]);
  const N3 = (a, b) => (mode === 'u' ? [0, b, a] : [a, 0, b]); // 2D (a,b) in profile coords → 3D
  const push = (v, nn, ao) => {
    pos.push(v[0], v[1], v[2]);
    nrm.push(nn[0], nn[1], nn[2]);
    col.push(ao, ao, ao);
  };
  for (let i = 0; i < n; i++) {
    const p = profile[i];
    const q = profile[(i + 1) % n];
    const da = q[0] - p[0];
    const db = q[1] - p[1];
    const l = Math.sqrt(da * da + db * db);
    if (l < 1e-6) continue;
    // outward edge normal of the 2D polygon
    const on = ccw ? [db / l, -da / l] : [-db / l, da / l];
    const nn = N3(on[0], on[1]);
    const A = P3(p, 0);
    const B = P3(q, 0);
    const C = P3(q, len);
    const D = P3(p, len);
    // wind so the triangle faces along nn
    const ex = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
    const fx = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const cx = ex[1] * fx[2] - ex[2] * fx[1];
    const cy = ex[2] * fx[0] - ex[0] * fx[2];
    const cz = ex[0] * fx[1] - ex[1] * fx[0];
    const flip = cx * nn[0] + cy * nn[1] + cz * nn[2] < 0;
    const t1 = flip ? [A, C, B] : [A, B, C];
    const t2 = flip ? [A, D, C] : [A, C, D];
    const aoOf = (v) => (v === A || v === D ? p[2] : q[2]);
    for (const v of t1) push(v, nn, aoOf(v));
    for (const v of t2) push(v, nn, aoOf(v));
  }
  if (caps) {
    const contour = profile.map((p) => new THREE.Vector2(p[0], p[1]));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    for (const [end, sgn] of [
      [0, -1],
      [len, 1],
    ]) {
      const nn = mode === 'u' ? [sgn, 0, 0] : [0, sgn, 0];
      for (const t of tris) {
        const a = P3(profile[t[0]], end);
        const b = P3(profile[t[1]], end);
        const c = P3(profile[t[2]], end);
        const ex = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
        const fx = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        const d = (ex[1] * fx[2] - ex[2] * fx[1]) * nn[0] + (ex[2] * fx[0] - ex[0] * fx[2]) * nn[1] + (ex[0] * fx[1] - ex[1] * fx[0]) * nn[2];
        const tri = d < 0 ? [a, c, b] : [a, b, c];
        const idx = d < 0 ? [t[0], t[2], t[1]] : [t[0], t[1], t[2]];
        for (let k = 0; k < 3; k++) push(tri[k], nn, profile[idx[k]][2] * 0.9);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return g;
}

/**
 * The flat inner field of a lancet (item-local, facing +z at depth z): a jamb
 * rectangle under a pointed head, coloured dark (ao) so it reads as a recess.
 */
function archPanel(w, jamb, rise, y0, z, ao, n) {
  const pts = pointedArch(w, Math.max(0.2, rise), Math.max(2, (n - 1) >> 1));
  const pos = [];
  const tri = (a, b, c) => pos.push(a[0], a[1], z, b[0], b[1], z, c[0], c[1], z);
  const yj = y0 + jamb;
  tri([-w / 2, y0], [w / 2, y0], [w / 2, yj]);
  tri([-w / 2, y0], [w / 2, yj], [-w / 2, yj]);
  const apex = [0, yj];
  for (let i = 0; i + 1 < pts.length; i++) tri(apex, [pts[i + 1][0], yj + pts[i + 1][1]], [pts[i][0], yj + pts[i][1]]);
  const n3 = pos.length / 3;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nr = new Float32Array(n3 * 3);
  for (let i = 0; i < n3; i++) nr[i * 3 + 2] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nr, 3));
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n3 * 3).fill(ao), 3));
  return g;
}

/** A horizontal quad facing +y (item-local) over x∈[x0,x1], z∈[z0,z1] at height y; colour = ao. */
function flatStrip(x0, x1, z0, z1, y, ao) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y, z0, x0, y, z1, x1, y, z1, x0, y, z0, x1, y, z1, x1, y, z0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(18).fill(ao), 3));
  return g;
}

/** A flat quad facing +z (item-local), centred at (cx, cy, cz): a phosphor inlay strip (position + colour). */
function glowQuad(cx, cy, cz, w, h) {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([x0, y0, cz, x1, y0, cz, x1, y1, cz, x0, y0, cz, x1, y1, cz, x0, y1, cz], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(18).fill(1), 3));
  return g;
}


/**
 * A colossal cog, unit radius, axis +z (back face at z = 0, 0.04 thick, hub to 0.065): trapezoid
 * teeth, a rim, six spokes and a hub boss. Non-indexed position / normal / uv
 * (metres at an 8 m reference radius) / AO colour, for one InstancedMesh.
 */
export function gearGeometry(teeth = 24, spokes = 5) {
  const sh = new THREE.Shape();
  const da = (Math.PI * 2) / teeth;
  const R_ROOT = 0.9;
  for (let i = 0; i < teeth; i++) {
    const a = i * da;
    for (const [k, r] of [
      [0.04, R_ROOT],
      [0.2, 1],
      [0.46, 1],
      [0.62, R_ROOT],
    ]) {
      const t = a + k * da;
      const x = Math.cos(t) * r;
      const y = Math.sin(t) * r;
      if (i === 0 && k === 0.04) sh.moveTo(x, y);
      else sh.lineTo(x, y);
    }
  }
  sh.closePath();
  const sa = (Math.PI * 2) / spokes;
  const gap = 0.1;
  for (let i = 0; i < spokes; i++) {
    const hole = new THREE.Path();
    const a0 = i * sa + gap;
    const a1 = (i + 1) * sa - gap;
    const n = 5;
    for (let k = 0; k <= n; k++) {
      const t = a0 + ((a1 - a0) * k) / n;
      const x = Math.cos(t) * 0.76;
      const y = Math.sin(t) * 0.76;
      if (k === 0) hole.moveTo(x, y);
      else hole.lineTo(x, y);
    }
    for (let k = n; k >= 0; k--) {
      const t = a0 + ((a1 - a0) * k) / n;
      hole.lineTo(Math.cos(t) * 0.3, Math.sin(t) * 0.3);
    }
    hole.closePath();
    sh.holes.push(hole);
  }
  let body = new THREE.ExtrudeGeometry(sh, { depth: 0.04, bevelEnabled: false, curveSegments: 1 });
  body = nonIndexed(body);
  keepAttrs(body, ['position', 'normal']);
  let hub = new THREE.CylinderGeometry(0.2, 0.2, 0.025, 10, 1);
  hub.rotateX(Math.PI / 2);
  hub.translate(0, 0, 0.0525);
  hub = nonIndexed(hub);
  keepAttrs(hub, ['position', 'normal']);
  for (const g of [body, hub]) {
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = Math.abs(g.attributes.normal.getZ(i)) > 0.9 ? 1 : 0.62;
      col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = g === hub ? v * 0.9 : v;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const uv = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      uv[i * 2] = g.attributes.position.getX(i) * 8;
      uv[i * 2 + 1] = g.attributes.position.getY(i) * 8;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  const merged = mergeGeometries([body, hub], false);
  body.dispose();
  hub.dispose();
  return merged;
}

function streakGeo(w, L, aoTop, aoBot) {
  const wb = w * 0.18;
  const g = new THREE.BufferGeometry();
  const z = 0.022;
  g.setAttribute('position', new THREE.Float32BufferAttribute([-wb, -L, z, wb, -L, z, w / 2, 0, z, -wb, -L, z, w / 2, 0, z, -w / 2, 0, z], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  const t = aoTop;
  const b = aoBot;
  g.setAttribute('color', new THREE.Float32BufferAttribute([b, b, b, b, b, b, t, t, t, b, b, b, t, t, t, t, t, t], 3));
  return g;
}

/**
 * Flat world-space decal geometry facing +y (floor inlays): rings, spokes and
 * rectangles as triangles, ao colour. `glow` omits the normal (MeshBasic list).
 */
class FlatBuilder {
  constructor(y) {
    this.y = y;
    this.p = [];
    this.c = [];
  }

  tri(a, b, c, col) {
    const cr = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]); // 2D (x, z) cross, y-up when > 0
    const t = cr > 0 ? [a, b, c] : [a, c, b];
    for (const v of t) {
      this.p.push(v[0], this.y, v[1]);
      this.c.push(col[0], col[1], col[2]);
    }
  }

  quad(a, b, c, d, col) {
    this.tri(a, b, c, col);
    this.tri(a, c, d, col);
  }

  ring(cx, cz, r0, r1, segs, col, a0 = 0, a1 = Math.PI * 2) {
    for (let i = 0; i < segs; i++) {
      const t0 = a0 + ((a1 - a0) * i) / segs;
      const t1 = a0 + ((a1 - a0) * (i + 1)) / segs;
      const c0 = Math.cos(t0);
      const s0 = Math.sin(t0);
      const c1 = Math.cos(t1);
      const s1 = Math.sin(t1);
      this.quad([cx + c0 * r0, cz + s0 * r0], [cx + c0 * r1, cz + s0 * r1], [cx + c1 * r1, cz + s1 * r1], [cx + c1 * r0, cz + s1 * r0], col);
    }
    return this;
  }

  /** A strip of width w from radius r0 to r1 along angle a. */
  spoke(cx, cz, a, r0, r1, w, col) {
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const px = -dz * w * 0.5;
    const pz = dx * w * 0.5;
    this.quad([cx + dx * r0 + px, cz + dz * r0 + pz], [cx + dx * r1 + px, cz + dz * r1 + pz], [cx + dx * r1 - px, cz + dz * r1 - pz], [cx + dx * r0 - px, cz + dz * r0 - pz], col);
    return this;
  }

  rect(x0, z0, x1, z1, col) {
    this.quad([x0, z0], [x1, z0], [x1, z1], [x0, z1], col);
    return this;
  }

  /** A rectangular frame line of width w, inset d from [x0,x1]×[z0,z1]. */
  frame(x0, z0, x1, z1, d, w, col) {
    const a = x0 + d;
    const b = x1 - d;
    const c = z0 + d;
    const e = z1 - d;
    this.rect(a, c, b, c + w, col).rect(a, e - w, b, e, col).rect(a, c + w, a + w, e - w, col).rect(b - w, c + w, b, e - w, col);
    return this;
  }

  get empty() {
    return this.p.length === 0;
  }

  geometry(withNormal) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    if (withNormal) {
      const n = new Float32Array(this.p.length);
      for (let i = 1; i < n.length; i += 3) n[i] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return g;
  }
}

// Unit box faces for TriBuilder: four corners (x, y, z in ±1) then the normal;
// order +x −x +y −y +z −z (bits 1 2 4 8 16 32), corners counter-clockwise from outside.
const BOX_FACES = [
  [1, -1, 1, 1, -1, -1, 1, 1, -1, 1, 1, 1, 1, 0, 0],
  [-1, -1, -1, -1, -1, 1, -1, 1, 1, -1, 1, -1, -1, 0, 0],
  [-1, 1, 1, 1, 1, 1, 1, 1, -1, -1, 1, -1, 0, 1, 0],
  [-1, -1, -1, 1, -1, -1, 1, -1, 1, -1, -1, 1, 0, -1, 0],
  [-1, -1, 1, 1, -1, 1, 1, 1, 1, -1, 1, 1, 0, 0, 1],
  [1, -1, -1, -1, -1, -1, -1, 1, -1, 1, 1, -1, 0, 0, -1],
];
const BOX_TRI = [0, 1, 2, 0, 2, 3];

/**
 * Collects flat-shaded boxes as raw triangles (position / normal / AO colour)
 * and makes ONE geometry: no per-box BufferGeometry, no merge (dressing is
 * planned at load, a few ms per frame — this keeps it light).
 */
class TriBuilder {
  constructor() {
    this.p = [];
    this.n = [];
    this.c = [];
  }

  /**
   * Box centred at (cx, cy, cz), size w × h × d, rotated rz about z. faces:
   * bit mask of +x −x +y −y +z −z (1 2 4 8 16 32); default all but −z (the back).
   */
  box(cx, cy, cz, w, h, d, ao = 1, rz = 0, faces = 31) {
    const cr = Math.cos(rz);
    const sr = Math.sin(rz);
    const hx = w / 2;
    const hy = h / 2;
    const hz = d / 2;
    const p = this.p;
    const n = this.n;
    const c = this.c;
    for (let f = 0; f < 6; f++) {
      if (!(faces & (1 << f))) continue;
      const q = BOX_FACES[f];
      // the face normal (rotated about z)
      const nx = q[12] * cr - q[13] * sr;
      const ny = q[12] * sr + q[13] * cr;
      const nz = q[14];
      for (let k = 0; k < 6; k++) {
        const v = BOX_TRI[k];
        const x = q[v * 3] * hx;
        const y = q[v * 3 + 1] * hy;
        p.push(cx + x * cr - y * sr, cy + x * sr + y * cr, cz + q[v * 3 + 2] * hz);
        n.push(nx, ny, nz);
        c.push(ao, ao, ao);
      }
    }
    return this;
  }

  /** Appends a geometry's position / normal / colour arrays. */
  add(geo) {
    for (const [dst, src] of [
      [this.p, geo.attributes.position.array],
      [this.n, geo.attributes.normal.array],
      [this.c, geo.attributes.color.array],
    ]) {
      for (let i = 0; i < src.length; i++) dst.push(src[i]);
    }
    geo.dispose();
    return this;
  }

  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    return g;
  }
}

/** World-metric box-projected UVs (per-triangle dominant axis), like the solids' shader projection. */
function worldUV(geo) {
  const p = geo.attributes.position.array;
  const n = p.length / 3;
  const uv = new Float32Array(n * 2);
  for (let t = 0; t < n; t += 3) {
    const e1x = p[t * 3 + 3] - p[t * 3];
    const e1y = p[t * 3 + 4] - p[t * 3 + 1];
    const e1z = p[t * 3 + 5] - p[t * 3 + 2];
    const e2x = p[t * 3 + 6] - p[t * 3];
    const e2y = p[t * 3 + 7] - p[t * 3 + 1];
    const e2z = p[t * 3 + 8] - p[t * 3 + 2];
    const nx = Math.abs(e1y * e2z - e1z * e2y);
    const ny = Math.abs(e1z * e2x - e1x * e2z);
    const nz = Math.abs(e1x * e2y - e1y * e2x);
    const ax = nx >= ny && nx >= nz ? 0 : ny >= nz ? 1 : 2;
    for (let k = 0; k < 3; k++) {
      const i = t + k;
      const x = p[i * 3];
      const y = p[i * 3 + 1];
      const z = p[i * 3 + 2];
      uv[i * 2] = ax === 0 ? z : x;
      uv[i * 2 + 1] = ax === 1 ? z : y;
    }
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Multiplies the colour attribute by an rgb tint (in place). */
function tintColors(geo, r, g, b) {
  const c = geo.attributes.color.array;
  for (let i = 0; i < c.length; i += 3) {
    c[i] *= r;
    c[i + 1] *= g;
    c[i + 2] *= b;
  }
  return geo;
}

/** Face frame: origin + U (along) / Y (up) / N (out) as a Matrix4 (item-local x,y,z → world). */
function faceMatrix(out, ox, oy, oz, N, uScale = 1, yScale = 1, nScale = 1) {
  // U = Y × N
  const ux = N.z;
  const uz = -N.x;
  out.set(
    ux * uScale, 0, N.x * nScale, ox,
    0, yScale, N.y * nScale, oy,
    uz * uScale, 0, N.z * nScale, oz,
    0, 0, 0, 1,
  );
  return out;
}

/**
 * Space queries for the planner: solids, the player space above walkable tops,
 * anchors and wall-mounted decor, as AABB obstacles.
 */
class DressSpace {
  constructor(level) {
    this.level = level;
    const solids = (Array.isArray(level.solids) ? level.solids : []).filter((s) => s && isFinite(s.minX) && isFinite(s.maxY));
    this.solids = solids;
    this.ko = [];
    for (const s of solids) {
      if (s.maxY - s.minY > DR.wallMinH && s.kind !== 'stone') continue;
      this.ko.push({ minX: s.minX - DR.koPad, minY: s.maxY, minZ: s.minZ - DR.koPad, maxX: s.maxX + DR.koPad, maxY: s.maxY + DR.koH, maxZ: s.maxZ + DR.koPad, src: s });
    }
    this.anchors = (Array.isArray(level.anchors) ? level.anchors : []).filter((a) => a && isFinite(a.x));
    this._ab = { minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0, a: null };
    this.decor = [];
    const WALLISH = new Set(['plaque', 'sign', 'inscription', 'tablet', 'glyphs', 'lamp', 'lantern', 'statue', 'arch', 'ribs', 'ribcage', 'machinery', 'pipe', 'cage', 'girder', 'still-lamp', 'grate', 'bones', 'gear', 'gears']);
    for (const d of Array.isArray(level.decor) ? level.decor : []) {
      if (!d || !isFinite(d.x) || !WALLISH.has(String(d.type || '').toLowerCase())) continue;
      const hx = num(d.sx, 1) / 2 + 0.05;
      const hy = num(d.sy, 1) / 2 + 0.05;
      const hz = num(d.sz, 1) / 2 + 0.05;
      this.decor.push({ minX: d.x - hx, minY: d.y - hy, minZ: num(d.z, 0) - hz, maxX: d.x + hx, maxY: d.y + hy, maxZ: num(d.z, 0) + hz });
    }
    this._q = [];
  }

  /** Active solid containing the point (shrunk by eps)? */
  inSolid(x, y, z, eps = 0.02) {
    const res = this.level.querySolids(x - eps, y - eps, z - eps, x + eps, y + eps, z + eps, this._q) || this._q;
    for (const s of res) {
      if (s.active === false) continue;
      if (x > s.minX + eps && x < s.maxX - eps && y > s.minY + eps && y < s.maxY - eps && z > s.minZ + eps && z < s.maxZ - eps) return s;
    }
    return null;
  }

  /** Obstacles overlapping the box; hosts (Set) are ignored; deep pieces also respect the player space. */
  _each(b, hosts, deep, fn, clear = DR.anchorClear) {
    const e = 0.03;
    const res = this.level.querySolids(b.minX + e, b.minY + e, b.minZ + e, b.maxX - e, b.maxY - e, b.maxZ - e, this._q) || this._q;
    for (const s of res) {
      if (hosts && hosts.has(s)) continue;
      if (s.maxX <= b.minX + e || s.minX >= b.maxX - e || s.maxY <= b.minY + e || s.minY >= b.maxY - e || s.maxZ <= b.minZ + e || s.minZ >= b.maxZ - e) continue;
      if (fn(s)) return true;
    }
    const ab = this._ab;
    for (const a of this.anchors) {
      ab.minX = a.x - clear;
      ab.maxX = a.x + clear;
      ab.minY = a.y - clear;
      ab.maxY = a.y + clear + (a.mount === 'chain' ? 0.6 : 0);
      ab.minZ = a.z - clear;
      ab.maxZ = a.z + clear;
      ab.a = a;
      if (ab.maxX <= b.minX || ab.minX >= b.maxX || ab.maxY <= b.minY || ab.minY >= b.maxY || ab.maxZ <= b.minZ || ab.minZ >= b.maxZ) continue;
      if (fn(ab)) return true;
    }
    const lists = deep ? [this.decor, this.ko] : [this.decor];
    for (const list of lists) {
      for (const o of list) {
        if (o.src && hosts && hosts.has(o.src) && deep !== 'all') continue;
        if (o.maxX <= b.minX || o.minX >= b.maxX || o.maxY <= b.minY || o.minY >= b.maxY || o.maxZ <= b.minZ || o.minZ >= b.maxZ) continue;
        if (fn(o)) return true;
      }
    }
    return false;
  }

  blocked(b, hosts, deep, clear) {
    return this._each(b, hosts, deep, () => true, clear);
  }

  /** Free sub-intervals of [t0, t1] along axis ('x'|'y'|'z') for a run with cross-section box b. */
  cut(b, axis, t0, t1, hosts, deep, minLen, clear) {
    const lo = axis === 'x' ? 'minX' : axis === 'y' ? 'minY' : 'minZ';
    const hi = axis === 'x' ? 'maxX' : axis === 'y' ? 'maxY' : 'maxZ';
    const q = Object.assign({}, b);
    q[lo] = t0;
    q[hi] = t1;
    let free = [[t0, t1]];
    this._each(q, hosts, deep, (o) => {
      const a = o[lo];
      const c = o[hi];
      const next = [];
      for (const [s, e] of free) {
        if (c <= s || a >= e) next.push([s, e]);
        else {
          if (a > s) next.push([s, a]);
          if (c < e) next.push([c, e]);
        }
      }
      free = next;
      return free.length === 0;
    }, clear);
    return free.filter(([s, e]) => e - s >= minLen);
  }
}

/** World AABB of an item-local box [x0,x1]×[y0,y1]×[z0,z1] placed by a face frame (axis-aligned faces only). */
function frameBox(F, x0, x1, y0, y1, z0, z1) {
  // U = Y × N (horizontal), N horizontal or vertical not supported here (walls only)
  const ux = F.N.z;
  const uz = -F.N.x;
  const xs = [F.o.x + ux * x0 + F.N.x * z0, F.o.x + ux * x1 + F.N.x * z0, F.o.x + ux * x0 + F.N.x * z1, F.o.x + ux * x1 + F.N.x * z1];
  const zs = [F.o.z + uz * x0 + F.N.z * z0, F.o.z + uz * x1 + F.N.z * z0, F.o.z + uz * x0 + F.N.z * z1, F.o.z + uz * x1 + F.N.z * z1];
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: F.o.y + y0, maxY: F.o.y + y1, minZ: Math.min(...zs), maxZ: Math.max(...zs) };
}

/**
 * Plans and emits the dressing. `emit(geoWorld, list)` receives world-space
 * geometry (position, normal, color; uv added) for a decor list ('stone' |
 * 'metal' | 'flesh' | 'glow'); `plan(part, matrix, tint, list)` records a kit
 * instance (drawn when the kit is available).
 */
class Dresser {
  constructor(level, emit, plan) {
    this.level = level;
    this.S = new DressSpace(level);
    this.emit = emit;
    this.plan = plan;
    this.secs = Array.isArray(level.sections) ? level.sections : [];
    this.marks = { organ: [], door: [] }; // world positions of notable dressing (tools / tests)
    this.gears = []; // colossal turning cogs: { m (Matrix4, unit-radius → world), spin (rad/s), phase, tint, sec }
    this.stats = { faces: 0, piers: 0, courses: 0, crowns: 0, corbels: 0, roots: 0, arches: 0, braces: 0, burls: 0, lancets: 0, cords: 0 };
    this._m = new THREE.Matrix4();
  }

  /** Section wetness (0..1) at world height y, as the renderer's ramp. */
  _wet(y) {
    return WET_RAMP[Math.max(0, Math.min(WET_RAMP.length - 1, this.level.sectionIndexAt ? this.level.sectionIndexAt(y) | 0 : 0))];
  }

  grade(y) {
    let i = 0;
    if (typeof this.level.sectionIndexAt === 'function') {
      try {
        i = this.level.sectionIndexAt(y);
      } catch {
        i = 0;
      }
    }
    return GRADE[Math.max(0, Math.min(GRADE.length - 1, i | 0))];
  }

  sectionTop(y) {
    const s = typeof this.level.sectionAt === 'function' ? this.level.sectionAt(y) : null;
    return s && isFinite(s.yTop) ? s.yTop : 0;
  }

  /** Item-local geometry → world through the face frame, tinted, into a decor list. */
  put(F, geo, x, y, list, tint, extra, detail = false) {
    faceMatrix(this._m, F.o.x + F.N.z * x, F.o.y + y, F.o.z - F.N.x * x, F.N);
    if (extra) this._m.multiply(extra);
    geo.applyMatrix4(this._m);
    const t = tint || [1, 1, 1];
    tintColors(geo, t[0], t[1], t[2]);
    if (list !== 'glow') worldUV(geo);
    else geo.deleteAttribute('normal');
    this._count(this._cat || list, F.o.y + y, geo.attributes.position.count / 3);
    this.emit(geo, list, detail);
  }

  /** Triangle accounting per section and category (stats.tris[section][category]). */
  _count(cat, y, n) {
    const T = this.stats.tris || (this.stats.tris = {});
    const k = `s${(typeof this.level.sectionIndexAt === 'function' ? this.level.sectionIndexAt(y) : 0) + 1}`;
    const row = T[k] || (T[k] = {});
    row[cat] = (row[cat] || 0) + Math.round(n);
  }

  /**
   * Records a kit part at face coords (x along, y up) with optional extra local
   * transform. big: a large piece (saint, gear) drawn with its section to the
   * fog, not in the near detail tier.
   */
  kit(F, part, x, y, tint, list, sx = 1, sy = 1, sz = 1, extra, big = false) {
    this._count(part.replace('ch1_env_', 'kit:'), F.o.y + y, 1);
    const m = new THREE.Matrix4();
    faceMatrix(m, F.o.x + F.N.z * x, F.o.y + y, F.o.z - F.N.x * x, F.N, sx, sy, sz);
    if (extra) m.multiply(extra);
    this.plan(part, m, tint, list, big);
  }

  /** Plans everything at once (tests / tools). */
  run() {
    const it = this.steps();
    while (!it.next().done) {
      // plan on
    }
    return this.stats;
  }

  /**
   * The plan as a generator, one wall face / slab / ceiling per step, top of
   * the descent first. Yields the section index of the item about to be
   * planned (−1 while surveying): everything above that section is final.
   */
  *steps() {
    const faces = [];
    const slabs = [];
    for (const s of this.S.solids) {
      if (s.kind === 'crumble') continue;
      const H = s.maxY - s.minY;
      if (H > DR.wallMinH) {
        for (const f of this._wallFaces(s)) faces.push(f);
        yield -1;
      } else slabs.push(s);
    }
    this.stats.faces = faces.length;
    this._openings(faces);
    this._crossings();
    yield -1;
    const items = [];
    for (const F of faces) items.push([F.o.y + F.H, 0, F]);
    for (const s of slabs) items.push([s.maxY, 1, s], [s.minY, 2, s]);
    items.sort((a, b) => b[0] - a[0]);
    const secOf = (y) => (typeof this.level.sectionIndexAt === 'function' ? this.level.sectionIndexAt(y) | 0 : 0);
    for (const [y, kind, o] of items) {
      const sec = secOf(y);
      yield sec;
      if (kind === 0) yield* this._dressWall(o, sec);
      else if (kind === 1) {
        this._dressSlab(o);
        this._inlay(o);
      }
      else this._ceiling(o);
    }
  }

  // ---------------------------------------------------------------------------
  // Walls
  // ---------------------------------------------------------------------------
  /** Interior, exposed vertical faces of a wall solid as face frames. */
  _wallFaces(s) {
    const out = [];
    const sides = [
      { N: { x: 1, y: 0, z: 0 }, c: s.maxX, a0: s.minZ, a1: s.maxZ, ax: 'z' },
      { N: { x: -1, y: 0, z: 0 }, c: s.minX, a0: s.minZ, a1: s.maxZ, ax: 'z' },
      { N: { x: 0, y: 0, z: 1 }, c: s.maxZ, a0: s.minX, a1: s.maxX, ax: 'x' },
      { N: { x: 0, y: 0, z: -1 }, c: s.minZ, a0: s.minX, a1: s.maxX, ax: 'x' },
    ];
    const S = this.S;
    for (const sd of sides) {
      const L = sd.a1 - sd.a0;
      if (L < 2.5) continue;
      // face-local u runs along U = Y × N; pick the origin so u ∈ [0, L]
      const ux = sd.N.z;
      const uz = -sd.N.x;
      const o = { x: 0, y: s.minY, z: 0 };
      if (sd.ax === 'x') {
        o.z = sd.c;
        o.x = ux > 0 ? sd.a0 : sd.a1;
      } else {
        o.x = sd.c;
        o.z = uz > 0 ? sd.a0 : sd.a1;
      }
      const F = { s, N: sd.N, o, L, H: s.maxY - s.minY };
      const pt = (u, y, d) => ({ x: o.x + ux * u + sd.N.x * d, y: o.y + y, z: o.z + uz * u + sd.N.z * d });
      // exposure along u (majority over heights) and interior rays
      const nu = Math.max(2, Math.floor(L));
      const du = L / nu;
      const hs = [0.2, 0.5, 0.8].map((k) => F.H * k);
      const exposed = [];
      const dists = [];
      let rays = 0;
      for (let i = 0; i <= nu; i++) {
        const u = Math.min(L - 0.3, Math.max(0.3, du * i));
        let free = 0;
        for (const h of hs) {
          const p = pt(u, h, 0.25);
          if (S.inSolid(p.x, p.y, p.z)) continue;
          free++;
          if (i % 3 === 1 && rays < 12) {
            rays++;
            const r = this.level.raycast(p.x, p.y, p.z, sd.N.x, 0, sd.N.z, DR.interiorRay);
            if (r) dists.push(r.t);
          }
        }
        exposed.push(free >= 2);
      }
      if (!rays || dists.length * 3 < rays) continue;
      dists.sort((a, b) => a - b);
      F.across = dists[dists.length >> 1];
      F.spans = [];
      for (let i = 0; i <= nu; i++) {
        if (!exposed[i]) continue;
        let j = i;
        while (j + 1 <= nu && exposed[j + 1]) j++;
        const a = i === 0 ? 0 : du * (i - 0.5);
        const b = j === nu ? L : du * (j + 0.5);
        if (b - a > 1.5) F.spans.push([a, b]);
        i = j;
      }
      if (F.spans.length) out.push(F);
    }
    return out;
  }

  /** A wall face, as generator steps (one per course / pier run): `sec` is yielded back. */
  *_dressWall(F, sec) {
    const S = this.S;
    const hosts = new Set([F.s]);
    const s = F.s;
    const midY = (s.minY + s.maxY) / 2;
    const rng = makeRng(hashStr(`${s.id}|${F.N.x},${F.N.z}`));
    // --- string courses ---------------------------------------------------
    const courses = [];
    for (const sec of this.secs) {
      if (!sec || !isFinite(sec.yTop) || !isFinite(sec.yBottom)) continue;
      if (sec.yBottom > s.maxY || sec.yTop < s.minY) continue;
      const g = GRADE[Math.max(0, Math.min(GRADE.length - 1, sec.index != null ? sec.index : this.secs.indexOf(sec)))];
      for (let yc = sec.yTop - g.course; yc > sec.yBottom + 0.5; yc -= g.course) {
        if (yc > s.minY + 1.5 && yc < s.maxY - 1.2) courses.push(yc);
      }
    }
    courses.sort((a, b) => b - a);
    const near = F.across <= DR.nearWall;
    F.budget = { organs: 1, roots: DR.rootsPerFace, burls: DR.burlsPerFace, lancets: DR.lancetsPerFace, icons: DR.iconsPerFace, trunks: DR.trunksPerFace };
    for (const yc of courses) {
      yield sec;
      const g = this.grade(yc);
      for (const [a, b] of F.spans) {
        const box = frameBox(F, a, b, yc - s.minY - 0.45, yc - s.minY + 0.02, 0, 0.3);
        const axis = Math.abs(F.N.x) > 0.5 ? 'z' : 'x';
        const lo = axis === 'x' ? box.minX : box.minZ;
        const hi = axis === 'x' ? box.maxX : box.maxZ;
        const segs = S.cut(box, axis, lo, hi, hosts, false, 0.8);
        // decay: deeper down, the growth has pried whole runs of the course away
        if (g.growth > 0.4) {
          const drng = makeRng(hashStr(`${s.id}c${yc.toFixed(1)}`));
          for (let i = segs.length - 1; i >= 0; i--) {
            const [w0, w1] = segs[i];
            if (w1 - w0 < 5 || drng() > g.growth * 0.6) continue;
            const c = w0 + 1 + drng() * (w1 - w0 - 2);
            const gap = 0.8 + drng() * 2.2 * g.growth;
            const parts = [];
            if (c - gap / 2 - w0 > 0.8) parts.push([w0, c - gap / 2]);
            if (w1 - (c + gap / 2) > 0.8) parts.push([c + gap / 2, w1]);
            segs.splice(i, 1, ...parts);
          }
        }
        for (const [w0, w1] of segs) {
          // back to face-local u
          const u0 = this._uOf(F, axis, w0, w1)[0];
          const u1 = this._uOf(F, axis, w0, w1)[1];
          const len = u1 - u0;
          const geo = extrudeProfile(PROF_COURSE, len, 'u');
          this._cat = 'course';
          this.put(F, geo, u0, yc - s.minY, 'stone', g.stone);
          this.stats.courses++;
          // water stains run down from the course (wear obeys gravity): darker, tapering, in front of the wall only
          const nSt = Math.floor((len / 3) * (0.5 + 0.8 * this._wet(yc)) + rng() * 0.9);
          this._cat = 'stain';
          for (let k = 0; k < nSt; k++) {
            const su = u0 + 0.4 + rng() * Math.max(0.1, len - 0.8);
            const sL = 1.2 + rng() * (2.5 + 5 * this._wet(yc));
            if (yc - s.minY - 0.42 - sL < 0.5) continue;
            this.put(F, streakGeo(0.12 + rng() * 0.3, sL, 0.42, 0.78), su, yc - s.minY - 0.42, 'stone', g.stone);
          }
          // growth: roots hanging from the course, burls
          this._cat = null;
          if (g.growth > 0 && near) this._roots(F, u0, u1, yc - s.minY - 0.42, g, rng, hosts);
        }
      }
    }
    // --- piers ----------------------------------------------------------------
    const g0 = this.grade(midY);
    for (const [a, b] of F.spans) {
      const len = b - a;
      const n = Math.max(1, Math.round(len / g0.pier));
      const pierU = [];
      for (let j = 1; j < n; j++) pierU.push(a + (len * j) / n);
      if (n === 1 && len > 4) pierU.push(a + len / 2);
      const gp = hashStr(s.id) & 1;
      for (let pi = 0; pi < pierU.length; pi++) {
        yield sec;
        const u = pierU[pi];
        this._pier(F, u, hosts, near ? courses : null);
        // every few piers a colossal engaged column swallows the pilaster (big sections)
        if (g0.giant && (pi + gp) % g0.giantEvery === 0 && len > 14) this._column(F, u, hosts, courses, g0.giant);
      }
      // corner shafts / sinew cords at span ends that meet another wall
      if (Math.abs(F.N.z) > 0.5) {
        for (const [u, side] of [
          [a, 1],
          [b, -1],
        ]) {
          const p = this._facePt(F, u - side * 0.4, F.H * 0.5, 0.4);
          const w = S.inSolid(p[0], p[1], p[2]);
          if (!w) continue; // a free end (opening / edge), not a corner
          // the exact corner: the perpendicular wall's face nearest this span end
          const ax = Math.abs(F.N.x) > 0.5 ? 'z' : 'x';
          const c0 = this._uAt(F, ax, ax === 'x' ? w.minX : w.minZ);
          const c1 = this._uAt(F, ax, ax === 'x' ? w.maxX : w.maxZ);
          const uc = Math.abs(c0 - u) < Math.abs(c1 - u) ? c0 : c1;
          if (Math.abs(uc - u) > 1.2) continue;
          this._corner(F, uc + side * 0.32, hosts);
        }
      }
      // blind lancet arcades between piers, one tier per section band
      if (pierU.length && near) this._arcades(F, [a, ...pierU, b], courses, hosts, rng);
      // deeper down, sinew trunks have forced their way down the open walls
      const gt = this.grade(midY);
      if (gt.growth > 0.3 && near) {
        const bays = [a, ...pierU, b];
        let nt = Math.floor(gt.growth * 1.6 * (len / 30) + rng() * 0.8);
        for (let k = 0; k < 6 && nt > 0 && F.budget.trunks > 0; k++) {
          const j = Math.floor(rng() * (bays.length - 1));
          const u = (bays[j] + bays[j + 1]) / 2 + (rng() - 0.5) * 1.5;
          yield sec;
          if (this._trunk(F, u, hosts, gt, rng)) {
            nt--;
            F.budget.trunks--;
          }
        }
      }
      // burls
      const gm = this.grade(midY);
      if (gm.growth > 0.45 && near) {
        const nb = Math.floor(len * F.H * gm.growth * 0.004 + rng());
        for (let i = 0; i < nb && F.budget.burls > 0; i++) {
          const u = a + 1.2 + rng() * Math.max(0.1, len - 2.4);
          const y = 1.5 + rng() * Math.max(0.1, F.H - 3);
          const box = frameBox(F, u - 2.4, u + 2.4, y - 2.4, y + 2.4, 0, 0.4);
          if (S.blocked(box, hosts, false, DR.propClear)) continue;
          const sc = 0.6 + rng() * 0.6;
          this.kit(F, 'ch1_env_growth', u, y, FLESH_TINT, 'flesh', sc, sc, 1, _m4b.makeRotationZ(rng() * 6.28));
          this.stats.burls++;
          F.budget.burls--;
        }
      }
    }
    if (!near) this._farWall(F, hosts, rng);
    this._cogs(F, hosts, rng);
  }


  /**
   * Colossal turning cogs sunk half into a far-ish wall: the order's machine
   * showing through the masonry. A big wheel (r 6–15 m) with a smaller one meshing
   * into it, drawn by one InstancedMesh that LevelView turns slowly. Only on tall,
   * wide wall faces away from the route (across ≥ 18 m), clear of every anchor,
   * prop and the player space; they stand ≤ 1 m off the wall.
   */
  _cogs(F, hosts, rng) {
    const S = this.S;
    if (F.across < 18 || F.H < 22) return;
    const used = this._cogUsed || (this._cogUsed = {});
    for (let tries = 0; tries < 10; tries++) {
      const [a, b] = F.spans[Math.floor(rng() * F.spans.length)];
      const r = 6 + rng() * 8;
      if (b - a < r * 2 + 5 || F.H < r * 2 + 6) continue;
      const u = a + r + 2 + rng() * (b - a - 2 * r - 4);
      const y = r + 3 + rng() * (F.H - 2 * r - 6);
      const sec = typeof this.level.sectionIndexAt === 'function' ? this.level.sectionIndexAt(F.o.y + y) | 0 : 0;
      if ((used[sec] || 0) >= (COG[sec] || 0)) continue;
      const st = this.secs[sec] && this.secs[sec].theme;
      if (F.across > 0.75 * ((st && st.fogFar) || 80)) continue; // beyond the haze: nobody would see it
      const g = this.grade(F.o.y + y);
      if (S.blocked(frameBox(F, u - r - 0.5, u + r + 0.5, y - r - 0.5, y + r + 0.5, 0, 3.5), hosts, true, DR.propClear * 1.5)) continue; // nothing (ledge, beam, anchor) within 3.5 m in front
      const wp = (cx, cy) => [F.o.x + F.N.z * cx, F.o.y + cy, F.o.z - F.N.x * cx];
      const clash = (cx, cy, rr, skip) => {
        const p = wp(cx, cy);
        return this.gears.some((o) => o !== skip && Math.hypot(o.cx - p[0], o.cy - p[1], o.cz - p[2]) < o.r + rr + 0.4);
      };
      if (clash(u, y, r + 0.3, null)) continue;
      const dir = rng() < 0.5 ? -1 : 1;
      const spin = (dir * 0.9) / r;
      const push = (cx, cy, rr, sp, phase) => {
        const m = new THREE.Matrix4();
        faceMatrix(m, F.o.x + F.N.z * cx + F.N.x * 0.12, F.o.y + cy, F.o.z - F.N.x * cx + F.N.z * 0.12, F.N, rr, rr, Math.min(rr, 3));
        const p = wp(cx, cy);
        const o = { m, spin: sp, phase, tint: g.stone, sec, r: rr, cx: p[0], cy: p[1], cz: p[2] };
        this.gears.push(o);
        this._count('cog', F.o.y + cy, 800);
        return o;
      };
      const parent = push(u, y, r, spin, rng() * 6.28);
      // a smaller wheel meshing into it (centres r + r2 − a tooth apart), at a free angle
      const r2 = r * (0.42 + rng() * 0.2);
      for (let k = 0; k < 6; k++) {
        const ang = rng() * 6.283;
        const d = r + r2 - 0.1 * r2;
        const u2 = u + Math.cos(ang) * d;
        const y2 = y + Math.sin(ang) * d;
        if (u2 - r2 < a + 1 || u2 + r2 > b - 1 || y2 - r2 < 2 || y2 + r2 > F.H - 2) continue;
        if (S.blocked(frameBox(F, u2 - r2 - 0.4, u2 + r2 + 0.4, y2 - r2 - 0.4, y2 + r2 + 0.4, 0, 3.5), hosts, true, DR.propClear * 1.5) || clash(u2, y2, r2, parent)) continue;
        push(u2, y2, r2, -spin * (r / r2), rng() * 6.28);
        break;
      }
      used[sec] = (used[sec] || 0) + 1;
      this.stats.cogs = (this.stats.cogs || 0) + 1;
    }
  }


  /**
   * Colossal order on a far wall (the Vault's 190 m back wall, seen across the void
   * as haze): great piers every ~18 m and tiers of giant lancets, some holding a dim
   * pane of old light. Stands ≤ 1.3 m off the wall; only where nothing near is solid.
   */
  _farWall(F, hosts, rng) {
    if (F.L < 40 || F.H < 30) return;
    const S = this.S;
    const s = F.s;
    const g = this.grade((s.minY + s.maxY) / 2);
    const tiers = Math.max(1, Math.min(2, Math.floor(F.H / 34)));
    for (const [a, b] of F.spans) {
      const len = b - a;
      const n = Math.max(2, Math.round(len / 18));
      const bay = len / n;
      this._cat = 'farpier';
      for (let j = 1; j < n; j++) {
        const u = a + bay * j;
        const box = frameBox(F, u - 2, u + 2, 0, F.H, 0, 1.5);
        for (const [y0, y1] of S.cut(box, 'y', s.minY, s.maxY, hosts, false, 12)) this._vertical(F, PROF_PIER_BIG, u, y0, y1, 'stone', g.stone);
      }
      for (let t = 0; t < tiers; t++) {
        const jamb = 14 + rng() * 4;
        const y0 = (F.H * (t + 0.5)) / tiers - (jamb + 7) / 2;
        if (y0 < 1 || y0 + jamb + 8 > F.H - 1) continue;
        for (let j = 0; j < n; j++) {
          const cx = a + bay * (j + 0.5);
          const w = bay - 5;
          const rise = w * 0.85;
          if (rng() < 0.3 || S.blocked(frameBox(F, cx - w / 2 - 1, cx + w / 2 + 1, y0, y0 + jamb + rise, 0, 1.5), hosts, false, 6)) continue;
          this._cat = 'farlancet';
          this._lancet(F, cx, y0, w, jamb, rise, 0.7, 0.9, g.stone, 'stone', true, false);
          if (rng() < 0.45) {
            const k = 0.1 + rng() * 0.14;
            this._cat = 'pane';
            this.put(F, archPanel(w - 1.4, jamb, rise - 0.7, y0, 0.2, 1, 9), cx, 0, 'glow', [k * 0.55, k, k * 0.95]);
          }
        }
      }
      this._cat = null;
    }
    this.stats.farWalls = (this.stats.farWalls || 0) + 1;
  }

  /** World along-axis coordinate → face-local u. */
  _uAt(F, axis, w) {
    const sgn = axis === 'x' ? F.N.z : -F.N.x;
    return (w - (axis === 'x' ? F.o.x : F.o.z)) * sgn;
  }

  /** World (along-axis) interval → face-local u interval. */
  _uOf(F, axis, w0, w1) {
    const sgn = axis === 'x' ? F.N.z : -F.N.x; // U component along the axis
    const o = axis === 'x' ? F.o.x : F.o.z;
    const a = (w0 - o) * sgn;
    const b = (w1 - o) * sgn;
    return a < b ? [a, b] : [b, a];
  }

  _pier(F, u, hosts, courses) {
    const S = this.S;
    const s = F.s;
    const box = frameBox(F, u - 0.52, u + 0.52, 0, F.H, 0, 0.36);
    const segs = S.cut(box, 'y', s.minY, s.maxY, hosts, false, 2.2);
    for (const [y0, y1] of segs) {
      const g = this.grade((y0 + y1) / 2);
      this._cat = 'pier';
      this._vertical(F, courses ? PROF_PIER : PROF_PIER_FAR, u, y0, y1, 'stone', g.stone);
      this._cat = 'annulet';
      this.stats.piers++;
      // annulets where courses cross (rhythm) — every course
      for (let ci = 0; courses && ci < courses.length; ci += 2) {
        const yc = courses[ci];
        if (yc - 0.6 < y0 || yc + 0.2 > y1) continue;
        const an = extrudeProfile(PROF_ANNULET, 0.3, 'y');
        this.put(F, an, u, yc - s.minY - 0.36, 'stone', g.stone, null, true);
      }
      // ends: base on a floor, capital under a ceiling, pendant corbel when hanging
      const below = S.inSolid(...this._facePt(F, u, y0 - s.minY - 0.1, 0.2));
      const above = S.inSolid(...this._facePt(F, u, y1 - s.minY + 0.1, 0.2));
      this._cat = null;
      if (!courses) continue; // far walls: the fog keeps their small carving
      if (below && g.growth < 0.8 && !S.blocked(frameBox(F, u - 0.72, u + 0.72, y0 - s.minY + 0.02, y0 - s.minY + 0.75, 0, 0.42), hosts, false, DR.propClear)) {
        this.kit(F, 'ch1_env_base', u, y0 - s.minY, g.stone, 'stone', 1, 1, 0.5);
      }
      if (above) {
        const deep = !S.blocked(frameBox(F, u - 0.78, u + 0.78, y1 - s.minY - 1.3, y1 - s.minY, 0, 0.86), hosts, true, DR.propClear);
        if (deep) this.kit(F, 'ch1_env_capital', u, y1 - s.minY, g.stone, 'stone');
        else if (!S.blocked(frameBox(F, u - 0.78, u + 0.78, y1 - s.minY - 1.3, y1 - s.minY, 0, 0.42), hosts, false, DR.propClear)) this.kit(F, 'ch1_env_capital', u, y1 - s.minY, g.stone, 'stone', 1, 1, 0.48);
      }
    }
  }

  /**
   * A colossal engaged column (radius R, 1.45 R deep) up the wall at face u,
   * in the free stretches only (never in the player space or near an anchor),
   * with a drum ring at every course, a plinth on a floor and a capital under
   * a ceiling: the giant order that makes a 40 m wall read as one building.
   */
  _column(F, u, hosts, courses, R) {
    const S = this.S;
    const s = F.s;
    const D = 1.45 * R;
    const box = frameBox(F, u - R - 0.15, u + R + 0.15, 0, F.H, 0, D + 0.1);
    const segs = S.cut(box, 'y', s.minY, s.maxY, hosts, true, 8, DR.propClear);
    if (!segs.length) return;
    const plan = columnPlan(R);
    const ring = columnPlan(R * 1.13, 14, 0);
    const cap = columnPlan(R * 1.3, 10, 0);
    for (const [y0, y1] of segs) {
      const g = this.grade((y0 + y1) / 2);
      this._cat = 'column';
      this._vertical(F, plan, u, y0, y1, 'stone', g.stone);
      const D2 = 1.45 * R * 1.13 + 0.05;
      for (const yc of courses || []) {
        if (yc - 0.9 < y0 || yc + 0.3 > y1) continue;
        if (S.blocked(frameBox(F, u - R * 1.15, u + R * 1.15, yc - s.minY - 0.75, yc - s.minY + 0.05, 0, D2), hosts, true, DR.propClear)) continue;
        this.put(F, extrudeProfile(ring, 0.7, 'y'), u, yc - s.minY - 0.72, 'stone', g.stone);
      }
      const D3 = 1.45 * R * 1.3 + 0.05;
      const below = S.inSolid(...this._facePt(F, u, y0 - s.minY - 0.1, 0.3));
      const above = S.inSolid(...this._facePt(F, u, y1 - s.minY + 0.1, 0.3));
      if (below && !S.blocked(frameBox(F, u - R * 1.32, u + R * 1.32, y0 - s.minY, y0 - s.minY + 1.4, 0, D3), hosts, true, DR.propClear)) {
        this.put(F, extrudeProfile(cap, 1.3, 'y'), u, y0 - s.minY, 'stone', g.stone);
      }
      if (above && !S.blocked(frameBox(F, u - R * 1.32, u + R * 1.32, y1 - s.minY - 1.6, y1 - s.minY, 0, D3), hosts, true, DR.propClear)) {
        this.put(F, extrudeProfile(cap, 1.0, 'y'), u, y1 - s.minY - 1.0, 'stone', g.stone);
        this.put(F, extrudeProfile(ring, 0.5, 'y'), u, y1 - s.minY - 1.5, 'stone', g.stone);
      }
      this._cat = null;
      this.stats.columns = (this.stats.columns || 0) + 1;
    }
  }

  /** A vertical extrusion from world y0 to y1 at face u, cut into ≤ 24 m pieces (one per culling band). */
  _vertical(F, prof, u, y0, y1, list, tint) {
    const n = Math.max(1, Math.ceil((y1 - y0) / 24));
    for (let i = 0; i < n; i++) {
      const a = y0 + ((y1 - y0) * i) / n;
      const b = y0 + ((y1 - y0) * (i + 1)) / n;
      this.put(F, extrudeProfile(prof, b - a, 'y', i === 0 || i === n - 1), u, a - F.s.minY, list, tint);
    }
  }

  _facePt(F, u, y, d) {
    return [F.o.x + F.N.z * u + F.N.x * d, F.o.y + y, F.o.z - F.N.x * u + F.N.z * d];
  }

  /** A round shaft (upper sections) or a sinew cord (deep) down an internal corner. */
  _corner(F, u, hosts) {
    const S = this.S;
    const s = F.s;
    const box = frameBox(F, u - 0.27, u + 0.27, 0, F.H, 0, 0.5);
    const segs = S.cut(box, 'y', s.minY, s.maxY, hosts, false, 2.5);
    for (const [y0, y1] of segs) {
      const g = this.grade((y0 + y1) / 2);
      this._cat = 'corner';
      if (g.growth < 0.5) this._vertical(F, PROF_SHAFT, u, y0, y1, 'stone', g.stone);
      if (g.growth > 0.15) {
        // a sinew cord twisting down the corner, in ≤ 24 m pieces (one per culling band)
        const rng = makeRng(hashStr(`${s.id}cord${u.toFixed(1)}${y0.toFixed(0)}`));
        const r = 0.05 + 0.13 * g.growth;
        const pieces = Math.max(1, Math.ceil((y1 - y0) / 24));
        for (let k = 0; k < pieces; k++) {
          const a = y0 + ((y1 - y0) * k) / pieces;
          const h = (y1 - y0) / pieces;
          const n = Math.max(4, Math.round(h / 1.7));
          const pts = [];
          const ph = rng() * 6;
          for (let i = 0; i <= n; i++) {
            const t = i / n;
            const yy = a + h * (1 - t);
            pts.push(new THREE.Vector3(Math.sin(yy * 0.9 + ph) * 0.12, h * (1 - t), 0.22 + Math.cos(yy * 0.7) * 0.06));
          }
          let geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n, r, 5, false);
          geo = nonIndexed(geo);
          keepAttrs(geo, ['position', 'normal']);
          geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(0.85), 3));
          this.put(F, geo, u, a - s.minY, 'flesh', FLESH_TINT);
        }
        this.stats.cords++;
      }
      this._cat = null;
    }
  }

  /**
   * A sinew trunk forced down the open wall at face u: a thick, lumpy cord
   * wandering from the top of the free stretch to its foot, half sunk in the
   * masonry (over courses and piers alike), with thinner tendrils clinging
   * sideways. Only where the wall is clear of the player space and anchors.
   * Returns true when built.
   */
  _trunk(F, u, hosts, g, rng) {
    const S = this.S;
    const s = F.s;
    const r0 = 0.16 + 0.26 * g.growth * (0.7 + rng() * 0.5);
    const box = frameBox(F, u - 1.6, u + 1.6, 0, F.H, 0, r0 * 2 + 0.1);
    const segs = S.cut(box, 'y', s.minY, s.maxY, hosts, true, 9, DR.propClear);
    if (!segs.length) return false;
    // the longest free stretch, at most 40 m (one or two culling bands)
    segs.sort((p, q) => q[1] - q[0] - (p[1] - p[0]));
    const [y0, yEnd] = segs[0];
    const y1 = Math.min(yEnd, y0 + 40);
    const H = y1 - y0;
    const pieces = Math.max(1, Math.ceil(H / 24));
    const ph = rng() * 6.283;
    const wob = 0.6 + rng() * 0.6;
    this._cat = 'trunk';
    for (let k = 0; k < pieces; k++) {
      const a = y1 - (H * k) / pieces; // top of the piece (world)
      const h = H / pieces;
      const n = Math.max(5, Math.round(h / 1.4));
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const yy = a - (h * i) / n;
        const t = (y1 - yy) / H; // 0 top → 1 foot
        pts.push(new THREE.Vector3(Math.sin(yy * 0.13 + ph) * wob + Math.sin(yy * 0.41 + ph * 2) * 0.25, yy - a, r0 * (0.75 + 0.15 * Math.sin(yy * 0.9)) * (1 - 0.3 * t)));
      }
      let geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), n + (n >> 1), 1, 5, false);
      // lumpy, tapering radius: displace each ring about its centre line
      const pos = geo.attributes.position;
      const ring = 6; // radialSegments + 1
      for (let i = 0; i < pos.count; i++) {
        const seg = Math.floor(i / ring);
        const tt = seg / (n + (n >> 1));
        const yy = a - h * tt;
        const t = (y1 - yy) / H;
        const c = new THREE.Vector3();
        new THREE.CatmullRomCurve3(pts).getPoint(tt, c);
        const rr = r0 * (1 - 0.55 * t) * (1 + 0.35 * Math.max(0, Math.sin(yy * 1.7 + ph)) ** 4);
        _v1.fromBufferAttribute(pos, i).sub(c).multiplyScalar(rr).add(c);
        pos.setXYZ(i, _v1.x, _v1.y, _v1.z);
      }
      geo = nonIndexed(geo);
      keepAttrs(geo, ['position']);
      geo.computeVertexNormals();
      geo.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count * 3).fill(0.82), 3));
      this.put(F, geo, u, a - s.minY, 'flesh', FLESH_TINT);
    }
    // tendrils spreading sideways from the trunk, clinging to the stone
    const nTen = 2 + Math.floor(rng() * 3);
    for (let i = 0; i < nTen; i++) {
      const yy = y1 - H * (0.15 + 0.7 * rng());
      const side = rng() < 0.5 ? -1 : 1;
      const L = 1.8 + rng() * 2.6;
      const pts = [];
      for (let j = 0; j <= 6; j++) {
        const t = j / 6;
        pts.push(new THREE.Vector3(Math.sin(yy * 0.13 + ph) * wob + side * L * t, -L * 0.45 * t * t + Math.sin(t * 4 + i) * 0.15, r0 * 0.6 * (1 - t) + 0.06));
      }
      let tg = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 8, r0 * 0.28, 4, false);
      tg = nonIndexed(tg);
      keepAttrs(tg, ['position', 'normal']);
      tg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(tg.attributes.position.count * 3).fill(0.75), 3));
      const tb = frameBox(F, u + Math.min(0, side * L) - 0.3, u + Math.max(0, side * L) + 0.3, yy - s.minY - L * 0.5, yy - s.minY + 0.3, 0, 0.4);
      if (S.blocked(tb, hosts, false, DR.propClear)) {
        tg.dispose();
        continue;
      }
      this.put(F, tg, u, yy - s.minY, 'flesh', FLESH_TINT);
    }
    this._cat = null;
    this.stats.trunks = (this.stats.trunks || 0) + 1;
    return true;
  }

  _roots(F, u0, u1, yTop, g, rng, hosts) {
    const S = this.S;
    const len = u1 - u0;
    let n = Math.floor(len * DR.rootK * g.growth + rng() * g.growth);
    while (n-- > 0 && F.budget.roots > 0) {
      const u = u0 + 1 + rng() * Math.max(0.1, len - 2);
      // a random length (long ones are rarer: they cost the most), else shorter if the wall below is busy
      const r0 = rng();
      const tries = r0 < 0.25 * g.growth ? 0 : r0 < 0.6 ? 1 : 2;
      for (const [part, L, w] of ROOTS.slice(tries)) {
        const sc = 0.8 + rng() * 0.5;
        const box = frameBox(F, u - w * sc, u + w * sc, yTop - L, yTop, 0, 0.4);
        if (box.minY < F.s.minY + 0.3 || S.blocked(box, hosts, false, DR.propClear)) continue;
        this.kit(F, part, u, yTop, FLESH_TINT, 'flesh', sc, 1, 1.2);
        this.stats.roots++;
        F.budget.roots--;
        break;
      }
    }
  }

  /**
   * The bays between consecutive piers, tier by tier: now and then a niche
   * saint or a sunk iron gear (budgeted per section), else blind lancet
   * arcades (pointed arch mouldings on the wall) on every other tier.
   */
  _arcades(F, us, courses, hosts, rng) {
    const S = this.S;
    const s = F.s;
    const parity = hashStr(s.id) & 1;
    for (let ci = 0; ci + 1 < courses.length; ci++) {
      const yTop = courses[ci] - 0.5; // under the course
      const yBot = courses[ci + 1] + 0.1;
      const g = this.grade((yTop + yBot) / 2);
      const H = yTop - yBot;
      const lancets = g.arcade && !((ci + parity) % 2) && H >= 4 && H <= 16; // every other tier: rhythm, and triangles
      for (let j = 0; j + 1 < us.length; j++) {
        const a = us[j] + (j === 0 ? 0.3 : 0.62);
        const b = us[j + 1] - (j + 1 === us.length - 1 ? 0.3 : 0.62);
        const W = b - a;
        if (W < 2.2) continue;
        if (this._icon(F, a, b, yBot, yTop, g, hosts, rng)) continue;
        if (this._organ(F, a, b, yBot, yTop, g, hosts, rng)) continue;
        if (!lancets) continue;
        const m = Math.max(1, Math.round(W / 3.2));
        const w = W / m;
        for (let k = 0; k < m; k++) {
          const cx = a + w * (k + 0.5);
          const lw = w - 0.36;
          const rise = Math.min(lw * 0.85, H * 0.45);
          const jamb = H - rise - 0.3;
          if (jamb < 1) continue;
          const box = frameBox(F, cx - lw / 2 - 0.15, cx + lw / 2 + 0.15, yBot - s.minY, yTop - s.minY, 0, 0.2);
          if (F.budget.lancets <= 0 || S.blocked(box, hosts, false)) continue;
          this._cat = 'lancet';
          this._lancet(F, cx, yBot - s.minY, lw, jamb, rise, 0.16, 0.13, g.stone, 'stone', true, false);
          // some of the blind lancets still hold a dim pane of old light: lit windows receding down the wall
          if (g.inlay > 0.2 && rng() < 0.3 * g.inlay + 0.1) {
            const k = (0.1 + rng() * 0.16) * Math.min(1, g.inlay + 0.2);
            const warm = rng() < 0.18;
            this._cat = 'pane';
            this.put(F, archPanel(lw - 0.16, jamb, rise - 0.08, yBot - s.minY, 0.04, 1, 9), cx, 0, 'glow', warm ? [k * 1.15, k * 0.85, k * 0.45] : [k * 0.55, k * 1.0, k * 0.95]);
          }
          this._cat = null;
          this.stats.lancets++;
          F.budget.lancets--;
        }
      }
    }
  }

  /**
   * A niche saint (the hooded Lanternwrights who built the descent, lamps
   * dead in their hands) or a colossal iron gear sunk in the masonry, filling
   * the bay [a, b] × [yBot, yTop] (world y). Budgeted per face and per section
   * (GRADE saints / gears), deterministic; never in the player space or near
   * an anchor. Returns true when one was placed.
   */
  _icon(F, a, b, yBot, yTop, g, hosts, rng) {
    if (F.budget.icons <= 0) return false;
    const sec = typeof this.level.sectionIndexAt === 'function' ? this.level.sectionIndexAt((yBot + yTop) / 2) | 0 : 0;
    const used = this._icons || (this._icons = {});
    const u = used[sec] || (used[sec] = { saints: 0, gears: 0 });
    const W = b - a;
    const H = yTop - yBot;
    const roll = rng();
    const wantSaint = u.saints < g.saints;
    const wantGear = u.gears < g.gears;
    if ((!wantSaint && !wantGear) || roll > 0.42) return false;
    const S = this.S;
    const s = F.s;
    const cx = (a + b) / 2;
    const y0 = yBot - s.minY;
    // gears where the order's machine shows through (they alternate with saints when both are wanted)
    const gearFirst = wantGear && (!wantSaint || (u.gears + u.saints + sec) % 2 === 1);
    for (const kind of gearFirst ? ['gear', 'saint'] : ['saint', 'gear']) {
      if (kind === 'saint' && wantSaint) {
        const sc = Math.min((H - 0.2) / 1.28, (W - 0.4) / 0.42, 13);
        if (sc < 3.4) continue;
        const sz = sc * 0.72; // a shallow relief: 0.26 × 0.72 × scale deep
        const box = frameBox(F, cx - 0.21 * sc, cx + 0.21 * sc, y0, y0 + 1.28 * sc, 0, 0.26 * sz);
        if (S.blocked(box, hosts, true, DR.propClear)) continue;
        this.kit(F, 'ch1_env_saint', cx, y0, g.stone, 'stone', sc, sc, sz, null, true);
        u.saints++;
        this.stats.saints = (this.stats.saints || 0) + 1;
        F.budget.icons--;
        return true;
      }
      if (kind === 'gear' && wantGear) {
        const r = Math.min(H / 2 - 0.3, W / 2 - 0.2, 6.5);
        if (r < 1.6) continue;
        const sz = Math.min(r * 0.55, 2); // ≤ 0.6 m deep
        const yc = y0 + H / 2;
        const box = frameBox(F, cx - r, cx + r, yc - r, yc + r, 0, 0.3 * sz);
        if (S.blocked(box, hosts, true, DR.propClear)) continue;
        this.kit(F, 'ch1_env_gear', cx, yc, [0.95, 0.9, 0.86], 'metal', r, r, sz, new THREE.Matrix4().makeRotationZ(rng() * 6.283), true);
        u.gears++;
        this.stats.gears = (this.stats.gears || 0) + 1;
        F.budget.icons--;
        return true;
      }
    }
    return false;
  }


  /**
   * A bank of iron organ pipes on a shelf in the bay [a, b] × [yBot, yTop] (world
   * y): the order's machine speaks through the masonry. Pointed rank (tallest in
   * the middle), collars, dark mouths, a backing board. Budgeted per face and
   * section; never in the player space or near an anchor. True when placed.
   */
  _organ(F, a, b, yBot, yTop, g, hosts, rng) {
    if (F.budget.organs <= 0) return false;
    const sec = typeof this.level.sectionIndexAt === 'function' ? this.level.sectionIndexAt((yBot + yTop) / 2) | 0 : 0;
    const used = this._organUsed || (this._organUsed = {});
    if ((used[sec] || 0) >= (ORGAN[sec] || 0) || rng() > 0.5) return false;
    const W = b - a;
    const H = yTop - yBot;
    if (W < 3 || H < 6) return false;
    const n = Math.min(11, Math.floor((W - 0.6) / 0.62));
    if (n < 4) return false;
    const S = this.S;
    const s = F.s;
    const y0 = yBot - s.minY;
    const hMax = Math.min(H - 1.6, 11);
    const base = y0 + 1.0;
    if (S.blocked(frameBox(F, a, b, y0, y0 + 1 + hMax + 0.4, 0, 1.0), hosts, true, DR.propClear)) return false;
    const cx = (a + b) / 2;
    const pitch = (W - 0.5) / n;
    const T = new TriBuilder();
    // shelf (a corbelled ledge) and the backing board
    T.box(cx, y0 + 0.5, 0.45, W - 0.2, 0.2, 0.9, 0.7, 0, 63 & ~32);
    T.box(cx, y0 + 0.2, 0.3, W - 0.6, 0.45, 0.6, 0.6, 0, 63 & ~32);
    T.box(cx, base + hMax * 0.5 + 0.2, 0.09, W - 0.2, hMax + 0.4, 0.18, 0.5, 0, 63 & ~32);
    const metal = new TriBuilder();
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const h = hMax * (0.42 + 0.58 * Math.sin(Math.PI * t) ** 0.8);
      const r = Math.max(0.1, Math.min(0.27, 0.07 + 0.016 * h));
      const px = a + 0.25 + pitch * (i + 0.5);
      const cyl = new THREE.CylinderGeometry(r, r * 1.04, h, 9, 1, true);
      cyl.translate(px, base + h / 2, 0.4);
      let g2 = nonIndexed(cyl);
      keepAttrs(g2, ['position', 'normal']);
      const cn = g2.attributes.position.count;
      g2.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(cn * 3).fill(0.9), 3));
      metal.add(g2);
      for (const k of [0.34, 0.7]) metal.box(px, base + h * k, 0.4, r * 2.5, 0.09, r * 2.5, 0.8, 0, 31);
      metal.box(px, base + h * 0.17, 0.4 + r, r * 1.5, r * 0.8, 0.05, 0.22, 0, 16); // the mouth
    }
    this._cat = 'organ';
    this.put(F, T.geometry(), 0, 0, 'stone', g.stone);
    this.put(F, metal.geometry(), 0, 0, 'metal', g.stone);
    this._cat = null;
    used[sec] = (used[sec] || 0) + 1;
    this.marks.organ.push([F.o.x + F.N.z * cx, F.o.y + y0 + 3, F.o.z - F.N.x * cx, F.N.x, F.N.z]);
    F.budget.organs--;
    this.stats.organs = (this.stats.organs || 0) + 1;
    return true;
  }

  /** One pointed lancet moulding: two jambs + a two-centred arch (item-local boxes). */
  _lancet(F, cx, y0, w, jamb, rise, bw, bd, tint, list = 'stone', frame = true, detail = false) {
    const B = new TriBuilder();
    if (frame) {
      // jambs (front, sides; no back, no ends) and a sill
      B.box(-w / 2, y0 + jamb / 2, bd / 2, bw, jamb, bd, 0.85, 0, 4 | 8 | 16 | 1 | 2);
      B.box(w / 2, y0 + jamb / 2, bd / 2, bw, jamb, bd, 0.85, 0, 4 | 8 | 16 | 1 | 2);
      B.box(0, y0 - bw * 0.3, bd * 0.6, w + bw * 1.6, bw * 0.6, bd * 1.2, 0.8);
    }
    const pts = pointedArch(w, rise, frame ? 4 : 6);
    if (frame) B.add(archPanel(w - bw, jamb, rise - bw * 0.5, y0, 0.015, 0.32, pts.length));
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, ya] = pts[i];
      const [x1, yb] = pts[i + 1];
      const l = Math.hypot(x1 - x0, yb - ya) + bw * 0.5;
      B.box((x0 + x1) / 2, y0 + jamb + (ya + yb) / 2, bd / 2, l, bw, bd, 0.9, Math.atan2(yb - ya, x1 - x0), 4 | 8 | 16);
    }
    this.put(F, B.geometry(), cx, 0, list, tint, null, detail);
  }

  // ---------------------------------------------------------------------------
  // Openings: pointed archivolts over lintels (window / doorway frames)
  // ---------------------------------------------------------------------------
  _openings(faces) {
    const S = this.S;
    // group faces by plane
    const planes = new Map();
    for (const F of faces) {
      const key = `${F.N.x},${F.N.z},${(Math.abs(F.N.x) > 0.5 ? F.o.x : F.o.z).toFixed(2)}`;
      if (!planes.has(key)) planes.set(key, []);
      planes.get(key).push(F);
    }
    const along = (F) => {
      const ax = Math.abs(F.N.x) > 0.5 ? 'z' : 'x';
      const s = F.s;
      return ax === 'x' ? [s.minX, s.maxX] : [s.minZ, s.maxZ];
    };
    for (const list of planes.values()) {
      for (const C of list) {
        // C is a lintel when coplanar walls flank the gap below it
        const [c0, c1] = along(C);
        const sC = C.s;
        const left = list.find((F) => F !== C && Math.abs(along(F)[1] - c0) < 0.05 && F.s.minY < sC.minY - 2 && F.s.maxY >= sC.minY);
        const right = list.find((F) => F !== C && Math.abs(along(F)[0] - c1) < 0.05 && F.s.minY < sC.minY - 2 && F.s.maxY >= sC.minY);
        if (!left || !right) continue;
        const sill = list.find((F) => F !== C && Math.abs(along(F)[0] - c0) < 0.05 && Math.abs(along(F)[1] - c1) < 0.05 && F.s.maxY < sC.minY);
        const yb = sill ? sill.s.maxY : Math.max(left.s.minY, right.s.minY);
        const W = c1 - c0;
        const H = sC.minY - yb;
        if (W < 3 || H < 3) continue;
        // frame in C's face coordinates: u range of the opening
        const axis = Math.abs(C.N.x) > 0.5 ? 'z' : 'x';
        const [u0, u1] = this._uOf(C, axis, c0, c1);
        const g = this.grade(sC.minY);
        const ySpring = 0; // C's local y origin is its bottom face, the lintel
        // archivolt orders stepping out round the opening; rise limited by the wall above
        const maxRise = Math.min(W * 0.62, sC.maxY - sC.minY - 1.2);
        if (maxRise < 1.2) continue;
        let made = 0;
        for (let k = 0; k < 3; k++) {
          const ww = W + 0.9 + k * 1.1;
          const rise = Math.min(maxRise - k * 0.5, ww * 0.6);
          if (rise < 1) break;
          const mid = (u0 + u1) / 2;
          const ring = pointedArch(ww, rise, 6);
          let hit = false;
          for (let i = 0; i + 1 < ring.length && !hit; i++) {
            const [xa, ya] = ring[i];
            const [xb, yc] = ring[i + 1];
            const bx = frameBox(C, mid + Math.min(xa, xb) - 0.3, mid + Math.max(xa, xb) + 0.3, ySpring + Math.max(0.1, Math.min(ya, yc) - 0.3), ySpring + Math.max(ya, yc) + 0.3, 0, 0.5);
            hit = S.blocked(bx, new Set([sC]), false);
          }
          if (hit) break;
          this._lancet(C, (u0 + u1) / 2, ySpring, ww, 0, rise, 0.42 - k * 0.08, 0.32 + k * 0.08, g.stone, 'stone', false);
          made++;
        }
        // jambs: tall roll mouldings down both sides of the opening, on the flanking walls
        if (made) {
          for (const [F, edge, wallDir] of [
            [left, c0, -1],
            [right, c1, 1],
          ]) {
            const ax = Math.abs(F.N.x) > 0.5 ? 'z' : 'x';
            const ue = this._uAt(F, ax, edge);
            const away = this._uAt(F, ax, edge + wallDir) > ue ? 1 : -1; // toward the wall beside the opening
            const box = frameBox(F, Math.min(ue, ue + away * 1.0), Math.max(ue, ue + away * 1.0), yb - F.s.minY, sC.minY - F.s.minY, 0, 0.5);
            const segs = S.cut(box, 'y', yb, sC.minY, new Set([F.s]), false, 1.5);
            for (const [y0, y1] of segs) this._vertical(F, PROF_PIER, ue + away * 0.52, y0, y1, 'stone', g.stone);
          }
          this.stats.arches++;
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Hanging vaults: the Lanternwrights built downward, so their vaults hang —
  // pointed ribs drop from every broad ceiling between bossed nodes; and over an
  // open chimney, crossing arches high up in the haze.
  // ---------------------------------------------------------------------------
  /** World-space geometry built in a local frame (matrix m) → tinted, metric UVs, into a list. */
  putWorld(geo, m, list, tint, detail = false) {
    geo.applyMatrix4(m);
    const t = tint || [1, 1, 1];
    tintColors(geo, t[0], t[1], t[2]);
    worldUV(geo);
    geo.computeBoundingBox();
    this._count(this._cat || list, (geo.boundingBox.min.y + geo.boundingBox.max.y) / 2, geo.attributes.position.count / 3);
    this.emit(geo, list, detail);
  }

  /**
   * A pointed rib in the vertical plane through (ax, az) → (bx, bz). down: the
   * rib hangs from height y (ends at y, point at y − rise); up: an arch springing
   * at y (ends at y, apex at y + rise). Nothing is emitted when any part of it
   * is blocked (no broken ribs). Returns true when built.
   */
  _rib(ax, az, bx, bz, y, rise, dir, hosts, tint, w = 0.36, h = 0.42) {
    const S = this.S;
    const dx = bx - ax;
    const dz = bz - az;
    const L = Math.sqrt(dx * dx + dz * dz);
    if (L < 2) return false;
    const ux = dx / L;
    const uz = dz / L;
    const mx = (ax + bx) / 2;
    const mz = (az + bz) / 2;
    const pts = pointedArch(L, rise, dir < 0 ? 2 : 4);
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, r0] = pts[i];
      const [x1, r1] = pts[i + 1];
      const ya = y + dir * r0;
      const yb = y + dir * r1;
      const box = {
        minX: Math.min(mx + ux * x0, mx + ux * x1) - w,
        maxX: Math.max(mx + ux * x0, mx + ux * x1) + w,
        minY: Math.min(ya, yb) - (dir < 0 ? h : 0.05),
        maxY: Math.max(ya, yb) + (dir < 0 ? 0.05 : h),
        minZ: Math.min(mz + uz * x0, mz + uz * x1) - w,
        maxZ: Math.max(mz + uz * x0, mz + uz * x1) + w,
      };
      if (S.blocked(box, hosts, false, DR.propClear)) return false;
    }
    const B = new TriBuilder();
    for (let i = 0; i + 1 < pts.length; i++) {
      const [x0, r0] = pts[i];
      const [x1, r1] = pts[i + 1];
      const l = Math.hypot(x1 - x0, r1 - r0) + w * 0.6;
      const off = dir < 0 ? -h / 2 : h / 2;
      // a hanging rib's top hides in the ceiling, a standing arch's bottom is seen: keep both, drop the ends
      B.box((x0 + x1) / 2, dir * (r0 + r1) / 2 + off, 0, l, h, w, 0.85, Math.atan2(dir * (r1 - r0), x1 - x0), 4 | 8 | 16 | 32);
    }
    const geo = B.geometry();
    // local x along the rib, y up, z across: X = (ux,0,uz), Z = X × Y = (−uz,0,ux)
    const m = new THREE.Matrix4().set(ux, 0, -uz, mx, 0, 1, 0, y, uz, 0, ux, mz, 0, 0, 0, 1);
    this.putWorld(geo, m, 'stone', tint);
    return true;
  }

  /** Hanging pointed ribs under a broad ceiling slab, bossed where they meet. */
  _ceiling(s) {
    if (s.kind === 'metal' || s.kind === 'bridge' || s.kind === 'grate') return;
    const S = this.S;
    const X = s.maxX - s.minX;
    const Z = s.maxZ - s.minZ;
    if (X < 8 || Z < 8 || X * Z < 100) return;
    // over a void: free under the centre and 6 m down
    const cx = (s.minX + s.maxX) / 2;
    const cz = (s.minZ + s.maxZ) / 2;
    if (S.inSolid(cx, s.minY - 0.3, cz) || S.inSolid(cx, s.minY - 6, cz)) return;
    const g = this.grade(s.minY);
    const sp = Math.max(X, Z) > 90 ? 20 : 12;
    const nx = Math.max(1, Math.round((X - 3) / sp));
    const nz = Math.max(1, Math.round((Z - 3) / sp));
    const xs = Array.from({ length: nx + 1 }, (_, i) => s.minX + 1.5 + ((X - 3) * i) / nx);
    const zs = Array.from({ length: nz + 1 }, (_, i) => s.minZ + 1.5 + ((Z - 3) * i) / nz);
    const hosts = new Set([s]);
    const deg = new Map();
    const y = s.minY;
    let n = 0;
    this._cat = 'vault';
    // anchors hung under this ceiling are fired at from below at shallow angles:
    // there the ribs stay shallow (a coffer, not a vault) so they never cut a sight line
    const hung = S.anchors.some((a) => a.y < y && a.y > y - 1 && a.x > s.minX && a.x < s.maxX && a.z > s.minZ && a.z < s.maxZ);
    const maxSag = hung ? 0.6 : 2.6;
    const rib = (ax, az, bx, bz) => {
      if (n >= 32) return;
      const L = Math.hypot(bx - ax, bz - az);
      if (this._rib(ax, az, bx, bz, y, Math.min(maxSag, L * 0.24), -1, hosts, g.stone)) {
        n++;
        for (const k of [`${ax},${az}`, `${bx},${bz}`]) deg.set(k, (deg.get(k) || 0) + 1);
      }
    };
    for (const z of zs) for (let i = 0; i < nx; i++) rib(xs[i], z, xs[i + 1], z);
    for (const x of xs) for (let j = 0; j < nz; j++) rib(x, zs[j], x, zs[j + 1]);
    this._cat = null;
    this.stats.ribs = (this.stats.ribs || 0) + n;
    // bosses where three or more ribs meet (kit part: top at y = 0), a few per ceiling
    let bosses = 0;
    for (const [k, d] of deg) {
      if (d < 3 || bosses >= 4) continue;
      bosses++;
      const [bx, bz] = k.split(',').map(Number);
      const box = { minX: bx - 0.7, maxX: bx + 0.7, minY: y - 1.2, maxY: y, minZ: bz - 0.7, maxZ: bz + 0.7 };
      if (S.blocked(box, hosts, false, DR.propClear)) continue;
      this.plan('ch1_env_boss', new THREE.Matrix4().makeTranslation(bx, y, bz), g.stone, 'stone');
      this._count('kit:boss', y, 1);
    }
  }

  /**
   * Crossing arches high over an open chimney (a section whose top 10 m is
   * clear of solids and anchors): two pointed arches between opposite walls,
   * crossing at a boss, dissolving into the haze above the spawn.
   */
  _crossings() {
    const S = this.S;
    for (const sec of this.secs) {
      const sh = sec && sec.shaft;
      if (!sh || !isFinite(sec.yTop)) continue;
      const y1 = sec.yTop;
      const y0 = y1 - 10;
      const area = { minX: sh.minX, maxX: sh.maxX, minY: y0, maxY: y1 + 6, minZ: sh.minZ, maxZ: sh.maxZ };
      if (S.blocked(area, null, false, 6)) continue;
      // the arches spring from the shaft walls: those may be touched
      const walls = new Set();
      S._each({ minX: sh.minX - 1, maxX: sh.maxX + 1, minY: y0, maxY: y1 + 10, minZ: sh.minZ - 1, maxZ: sh.maxZ + 1 }, null, false, (o) => {
        if (o.kind) walls.add(o);
        return false;
      });
      const g = this.grade(y0);
      const cx = (sh.minX + sh.maxX) / 2;
      const cz = (sh.minZ + sh.maxZ) / 2;
      const spring = y0;
      const rx = (sh.maxX - sh.minX) * 0.42;
      const rz = (sh.maxZ - sh.minZ) * 0.42;
      this._cat = 'crossing';
      const a = this._rib(sh.minX + 0.05, cz, sh.maxX - 0.05, cz, spring, Math.min(9, rx), 1, walls, g.stone, 0.7, 0.9);
      const b = this._rib(cx, sh.minZ + 0.05, cx, sh.maxZ - 0.05, spring, Math.min(9, rz), 1, walls, g.stone, 0.7, 0.9);
      this._cat = null;
      if (a && b) this.plan('ch1_env_boss', new THREE.Matrix4().makeTranslation(cx, spring + Math.min(9, rx) + 0.9, cz).multiply(_m4b.makeScale(1.6, 1.6, 1.6)), g.stone, 'stone');
      if (a || b) this.stats.crossings = (this.stats.crossings || 0) + (a ? 1 : 0) + (b ? 1 : 0);
    }
  }



  // ---------------------------------------------------------------------------
  // Iron beams and decks: edge flanges and stiffener plates down the sides, plate
  // seams and rivet lines flush on top (nothing above the walking surface)
  // ---------------------------------------------------------------------------
  _dressIron(s) {
    const S = this.S;
    const X = s.maxX - s.minX;
    const Z = s.maxZ - s.minZ;
    const H = s.maxY - s.minY;
    if (H > 2.2 || Math.max(X, Z) < 3) return;
    const alongX = X >= Z;
    const L = alongX ? X : Z;
    const W = alongX ? Z : X;
    const g = this.grade(s.maxY);
    const hosts = new Set([s]);
    const axis = alongX ? 'x' : 'z';
    const c0 = alongX ? s.minX : s.minZ;
    const cMid = c0 + L / 2;
    const cx = (s.minX + s.maxX) / 2;
    const cz = (s.minZ + s.maxZ) / 2;
    const ux = alongX ? 1 : 0;
    const uz = alongX ? 0 : 1;
    const m = new THREE.Matrix4().set(ux, 0, -uz, cx, 0, 1, 0, s.maxY, uz, 0, ux, cz, 0, 0, 0, 1);
    const box = { minX: s.minX - 0.3, maxX: s.maxX + 0.3, minY: s.minY, maxY: s.maxY - 0.04, minZ: s.minZ - 0.3, maxZ: s.maxZ + 0.3 };
    const segs = S.cut(box, axis, c0, c0 + L, hosts, false, 1.3, DR.anchorClear);
    this._cat = 'iron';
    for (const [t0, t1] of segs) {
      const len = t1 - t0 - 0.1;
      const mid = (t0 + t1) / 2 - cMid;
      const B = new TriBuilder();
      for (const side of [-1, 1]) {
        B.box(mid, -0.21, side * (W / 2 + 0.05), len, 0.3, 0.1, 0.78, 0, side > 0 ? 63 & ~32 : 63 & ~16);
        B.box(mid, -0.07, side * (W / 2 + 0.03), len, 0.07, 0.14, 0.95, 0, side > 0 ? 63 & ~32 : 63 & ~16);
      }
      const n = Math.max(1, Math.round(len / 1.7));
      if (H >= 0.55) {
        for (let i = 0; i <= n; i++) {
          const x = mid - len / 2 + (len * i) / n;
          for (const side of [-1, 1]) B.box(x, -0.28 - (H - 0.55) / 2, side * (W / 2 + 0.07), 0.12, Math.min(H - 0.3, 1.4), 0.1, 0.68, 0, side > 0 ? 63 & ~32 : 63 & ~16);
        }
      }
      this.putWorld(B.geometry(), m, 'metal', g.stone);
      this.stats.irons = (this.stats.irons || 0) + 1;
    }
    this._cat = null;
    // seams across and rivet lines along the walking surface (flush strips)
    const y = s.maxY + 0.012;
    const F = new FlatBuilder(y);
    const dark = [0.32, 0.32, 0.32];
    const rl = [1.3, 1.3, 1.3];
    const step = W > 3 ? 2.4 : 1.8;
    const ns = Math.floor(L / step);
    for (let i = 1; i < ns; i++) {
      const t = c0 + (L * i) / ns;
      if (alongX) F.rect(t - 0.045, s.minZ + 0.12, t + 0.045, s.maxZ - 0.12, dark);
      else F.rect(s.minX + 0.12, t - 0.045, s.maxX - 0.12, t + 0.045, dark);
    }
    for (const sd of [0.16, W - 0.2]) {
      if (alongX) F.rect(s.minX + 0.1, s.minZ + sd, s.maxX - 0.1, s.minZ + sd + 0.04, rl);
      else F.rect(s.minX + sd, s.minZ + 0.1, s.minX + sd + 0.04, s.maxZ - 0.1, rl);
    }
    if (!F.empty) {
      const geo = F.geometry(true);
      tintColors(geo, g.stone[0], g.stone[1], g.stone[2]);
      worldUV(geo);
      this._count('iron-top', s.maxY, geo.attributes.position.count / 3);
      this.emit(geo, 'metal', false);
    }
  }

  // ---------------------------------------------------------------------------
  // Floor inlays: carved bands and a great rosette cut flush into the big floors
  // (nothing rises above the walking surface: collision and sight lines untouched)
  // ---------------------------------------------------------------------------
  _inlay(s) {
    if (s.kind !== 'stone') return;
    const X = s.maxX - s.minX;
    const Z = s.maxZ - s.minZ;
    if (X < 7 || Z < 7 || s.maxY - s.minY < 1.5) return;
    const g = this.grade(s.maxY);
    const rng = makeRng(hashStr(`inlay${s.id}`));
    const y = s.maxY + 0.014;
    const cx = (s.minX + s.maxX) / 2;
    const cz = (s.minZ + s.maxZ) / 2;
    const dark = [0.5, 0.5, 0.5];
    const lt = [1.12, 1.12, 1.12];
    const B = new FlatBuilder(y);
    // carved frame lines parallel to the edge: a wide dark course and a fine pale one
    B.frame(s.minX, s.minZ, s.maxX, s.maxZ, 0.62, 0.2, dark);
    B.frame(s.minX, s.minZ, s.maxX, s.maxZ, 0.98, 0.07, lt);
    const glow = new FlatBuilder(y + 0.004);
    const k = DR.inlayK * 0.5 * g.inlay;
    const gcol = [INLAY_COL.r * k, INLAY_COL.g * k, INLAY_COL.b * k];
    const R = Math.min(X, Z) * 0.5 - 1.6;
    if (R >= 3) {
      const r = Math.min(R, 7.5);
      B.ring(cx, cz, r - 0.28, r, 56, dark);
      B.ring(cx, cz, r * 0.72, r * 0.72 + 0.12, 44, lt);
      B.ring(cx, cz, r * 0.46 - 0.22, r * 0.46, 36, dark);
      const sp = 8 + Math.floor(rng() * 3) * 2;
      const a0 = rng() * Math.PI;
      for (let i = 0; i < sp; i++) {
        const a = a0 + (i * Math.PI * 2) / sp;
        B.spoke(cx, cz, a, r * 0.46, r * 0.72, 0.16, dark);
        B.spoke(cx, cz, a + Math.PI / sp, r * 0.72, r, 0.1, lt);
      }
      if (g.inlay > 0.05) glow.ring(cx, cz, r * 0.72 - 0.16, r * 0.72 - 0.1, 44, gcol);
    }
    for (const [b, withN, list] of [
      [B, true, 'stone'],
      [glow, false, 'glow'],
    ]) {
      if (b.empty) continue;
      const geo = b.geometry(withN);
      if (list === 'stone') {
        tintColors(geo, g.stone[0], g.stone[1], g.stone[2]);
        worldUV(geo);
      }
      this._count(list === 'glow' ? 'inlay-glow' : 'inlay', s.maxY, geo.attributes.position.count / 3);
      this.emit(geo, list, false);
    }
    this.stats.inlays = (this.stats.inlays || 0) + 1;
  }

  // ---------------------------------------------------------------------------
  // Slabs: crown mouldings, beads, corbels / atlas figures, iron braces
  // ---------------------------------------------------------------------------
  _dressSlab(s) {
    const S = this.S;
    const hosts = new Set([s]);
    const H = s.maxY - s.minY;
    const g = this.grade(s.maxY);
    const rng = makeRng(hashStr(`slab${s.id}`));
    const metal = s.kind === 'metal' || s.kind === 'bridge' || s.kind === 'grate';
    if (metal && s.kind !== 'grate') this._dressIron(s);
    const sides = [
      { N: { x: 1, y: 0, z: 0 }, c: s.maxX, a0: s.minZ, a1: s.maxZ, ax: 'z' },
      { N: { x: -1, y: 0, z: 0 }, c: s.minX, a0: s.minZ, a1: s.maxZ, ax: 'z' },
      { N: { x: 0, y: 0, z: 1 }, c: s.maxZ, a0: s.minX, a1: s.maxX, ax: 'x' },
      { N: { x: 0, y: 0, z: -1 }, c: s.minZ, a0: s.minX, a1: s.maxX, ax: 'x' },
    ];
    for (const sd of sides) {
      const L = sd.a1 - sd.a0;
      if (L < 0.8) continue;
      const ux = sd.N.z;
      const uz = -sd.N.x;
      const o = { x: 0, y: s.minY, z: 0 };
      if (sd.ax === 'x') {
        o.z = sd.c;
        o.x = ux > 0 ? sd.a0 : sd.a1;
      } else {
        o.x = sd.c;
        o.z = uz > 0 ? sd.a0 : sd.a1;
      }
      const F = { s, N: sd.N, o, L, H };
      // exposure along the edge: free just outside at mid height → crown; inside a wall → corbels
      const nu = Math.max(2, Math.round(L / 0.5));
      const state = [];
      let wall = null;
      for (let i = 0; i <= nu; i++) {
        const u = Math.min(L - 0.1, Math.max(0.1, (L * i) / nu));
        const p = this._facePt(F, u, H * 0.5, 0.15);
        const w = S.inSolid(p[0], p[1], p[2]);
        state.push(w ? (w.maxY - w.minY > DR.wallMinH ? 2 : 1) : 0);
        if (w && w.maxY - w.minY > DR.wallMinH) wall = w;
      }
      const spans = (want) => {
        const out = [];
        let st = -1;
        for (let i = 0; i <= nu; i++) {
          const on = state[i] === want;
          if (on && st < 0) st = i;
          if ((!on || i === nu) && st >= 0) {
            const e = on ? i : i - 1;
            const a = st === 0 ? 0 : (L * (st - 0.5)) / nu;
            const b = e === nu ? L : (L * (e + 0.5)) / nu;
            if (b - a > 0.6) out.push([a, b]);
            st = -1;
          }
        }
        return out;
      };
      if (!metal) {
        for (const [a, b] of spans(0)) {
          // crown moulding just under the walking surface
          const box = frameBox(F, a, b, H - 0.52, H - 0.02, 0, 0.24);
          const axis = sd.ax;
          const lo = axis === 'x' ? box.minX : box.minZ;
          const hi = axis === 'x' ? box.maxX : box.maxZ;
          for (const [w0, w1] of S.cut(box, axis, lo, hi, hosts, false, 0.6)) {
            // stopped short of the slab's free corners: a player at the corner fires down past it
            const cw0 = w0 > lo + 0.01 ? w0 : w0 + 0.45;
            const cw1 = w1 < hi - 0.01 ? w1 : w1 - 0.45;
            if (cw1 - cw0 < 0.6) continue;
            const [u0, u1] = this._uOf(F, axis, cw0, cw1);
            this._cat = 'crown';
            this.put(F, extrudeProfile(PROF_CROWN, u1 - u0, 'u'), u0, H - 0.06, 'stone', g.stone);
            this.stats.crowns++;
            if (g.inlay > 0.05 && u1 - u0 > 1.2) {
              // the ledge's lip is outlined by a phosphor channel: walkable edges read in the dark
              const k = DR.inlayK * 0.7 * g.inlay;
              this.put(F, glowQuad((u1 - u0) / 2, -0.16, 0.152, u1 - u0 - 0.3, 0.035), u0, H - 0.06, 'glow', [INLAY_COL.r * k, INLAY_COL.g * k, INLAY_COL.b * k]);
            }
            if (u1 - u0 > 1.2) {
              // dressed border on the walking surface (flush, no depth): kerb stones + a lamp line
              this._cat = 'border';
              this.put(F, flatStrip(0, u1 - u0, -0.5, -0.02, 0.012, 0.62), u0, H, 'stone', g.stone);
              if (g.inlay > 0.05) {
                const k = DR.inlayK * 0.55 * g.inlay;
                this.put(F, flatStrip(0.25, u1 - u0 - 0.25, -0.3, -0.26, 0.016, 1), u0, H, 'glow', [INLAY_COL.r * k, INLAY_COL.g * k, INLAY_COL.b * k]);
              }
              this._cat = null;
            }
            if (H >= 2) {
              const bb = frameBox(F, u0, u1, 0, 0.3, 0, 0.12);
              for (const [v0, v1] of S.cut(bb, axis, axis === 'x' ? bb.minX : bb.minZ, axis === 'x' ? bb.maxX : bb.maxZ, hosts, false, 0.6)) {
                const [b0, b1] = this._uOf(F, axis, v0, v1);
                this._cat = 'bead';
                this.put(F, extrudeProfile(PROF_BEAD, b1 - b0, 'u'), b0, 0, 'stone', g.stone, null, true);
                this._cat = null;
              }
            }
            // sinew creeping over the lip of deep ledges
            if (g.growth > 0.4 && u1 - u0 > 3 && rng() < g.growth * 0.5) {
              const u = u0 + 1 + rng() * (u1 - u0 - 2);
              const bx = frameBox(F, u - 1.4, u + 1.4, -5, 0, 0, 0.4);
              if (!S.blocked(bx, hosts, false, DR.propClear)) {
                this.kit(F, 'ch1_env_root_a', u, 0, FLESH_TINT, 'flesh', 0.9, 1, 1.1);
                this.stats.roots++;
              }
            }
          }
        }
      }
      // where the slab meets a wall: corbels (stone) or knee braces (iron) under it
      if (wall) {
        for (const [a, b] of spans(2)) {
          // the wall face is this side's plane; corbels face back into the slab (−N)
          const N = { x: -sd.N.x, y: 0, z: -sd.N.z };
          const W = { s: wall, N, o: null };
          // frame origin: same point on the plane; u along Y × N
          const wx = N.z;
          const wz = -N.x;
          const pa = { x: o.x + ux * a, z: o.z + uz * a };
          const pb = { x: o.x + ux * b, z: o.z + uz * b };
          // pick the end with the smaller along-coordinate in W's frame as origin
          const da = pa.x * wx + pa.z * wz;
          const db = pb.x * wx + pb.z * wz;
          const p0 = da < db ? pa : pb;
          W.o = { x: p0.x, y: s.minY, z: p0.z };
          const span = Math.abs(db - da);
          const hostsW = new Set([s, wall]);
          if (metal) {
            if (H > 1.6 || span > 2.5) continue; // beams only
            // one brace under the beam's centre line
            const u = span / 2;
            const sc = Math.max(0.6, Math.min(1.2, span / 0.9));
            const box = frameBox(W, u - 0.25, u + 0.25, -1.75, 0, 0, 1.7);
            if (S.blocked(box, hostsW, true, DR.propClear)) continue;
            this.kit(W, 'ch1_env_bracket', u, 0, [1, 1, 1], 'metal', sc, 1, 1);
            this.stats.braces++;
            continue;
          }
          // a doorway (2.6 m: the human measure the rest of the building is read against) where this ledge meets the wall
          if (g.arcade && span >= 7 && H >= 1.5 && rng() < 0.6) {
            const du = span * (0.3 + 0.4 * rng());
            const dw = 1.5;
            const dh = 2.7;
            const dbox = frameBox(W, du - dw / 2 - 0.25, du + dw / 2 + 0.25, H, H + dh + 0.3, 0, 0.35);
            if (!S.blocked(dbox, hostsW, true, DR.propClear)) {
              this._cat = 'door';
              this._lancet(W, du, H, dw, dh - 1.0, 1.0, 0.2, 0.2, g.stone, 'stone', true, false);
              this._cat = null;
              this.stats.doors = (this.stats.doors || 0) + 1;
              this.marks.door.push([W.o.x + wx * du, s.maxY + 1.3, W.o.z + wz * du, N.x, N.z]);
            }
          }
          // a corbel table under ledges; under whole floors a sparser one
          const floor = (s.maxX - s.minX) * (s.maxZ - s.minZ) > 150;
          const step = floor ? 6.5 : H >= 2.5 ? 3.4 : 3.0;
          const n = Math.floor((span - 0.8) / step);
          if (n < 1) continue;
          const off = (span - n * step) / 2 + step / 2;
          let figs = 0;
          for (let i = 0; i < n; i++) {
            const u = off + i * step;
            const fig = !floor && span >= 6 && i % 3 === 1 && g.growth < 0.5 && figs < 2;
            if (fig) figs++;
            const part = fig ? 'ch1_env_corbel_figure' : 'ch1_env_corbel';
            const h = fig ? 2.1 : 1.1;
            const d = fig ? 0.86 : 0.8;
            const box = frameBox(W, u - 0.5, u + 0.5, -h, 0, 0, d);
            if (S.blocked(box, hostsW, true, DR.propClear)) {
              // try the plain corbel instead of the figure
              if (!fig || S.blocked(frameBox(W, u - 0.4, u + 0.4, -1.1, 0, 0, 0.8), hostsW, true, DR.propClear)) continue;
              this.kit(W, 'ch1_env_corbel', u, 0, g.stone, 'stone');
              this.stats.corbels++;
              continue;
            }
            this.kit(W, part, u, 0, g.stone, 'stone');
            this.stats.corbels++;
          }
        }
      }
    }
  }
}

/** Pointed (two-centred) arch points from (−w/2, 0) over (0, rise) to (w/2, 0). */
function pointedArch(w, rise, n) {
  const half = w / 2;
  const c = (rise * rise - half * half) / (2 * half);
  const R = half + c;
  const aA = Math.acos(Math.max(-1, Math.min(1, -c / R)));
  const left = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI - ((Math.PI - aA) * i) / n;
    left.push([c + R * Math.cos(a), R * Math.sin(a)]);
  }
  const right = left.slice(0, -1).reverse().map(([x, y]) => [-x, y]);
  return left.concat(right);
}

/** Kit parts from the env GLB: name → { geo (non-indexed position/normal/color), list }. */
function parseEnvKit(gltf) {
  const out = new Map();
  const root = gltf && (gltf.scene || (gltf.scenes && gltf.scenes[0]));
  if (!root) return out;
  root.updateMatrixWorld(true);
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    const name = o.name || (o.parent && o.parent.name) || '';
    if (!/^ch1_env_/.test(name)) return;
    let g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    g = nonIndexed(g);
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 3).fill(1);
    const src = g.attributes.color;
    if (src) {
      for (let i = 0; i < n; i++) {
        col[i * 3] = src.getX(i);
        col[i * 3 + 1] = src.getY(i);
        col[i * 3 + 2] = src.getZ(i);
      }
    }
    keepAttrs(g, ['position', 'normal']);
    if (!g.attributes.normal) g.computeVertexNormals();
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const mname = (o.material && o.material.name) || 'stone';
    const list = /metal|iron/.test(mname) ? 'metal' : /flesh|sinew/.test(mname) ? 'flesh' : 'stone';
    out.set(name, { geo: g, list, tris: n / 3 });
  });
  return out;
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
    this.gate = null; // the chamber portcullis (see _buildGate)
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
    if (this._chunkByKey) this._chunkByKey.clear();
    this._kitPlan = null;
    this._dressJob = null;
    this._cogs = null;
    this._colossal = null;
    this._lightGlow = null;
    this.gate = null;
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
    const bands = this._buildDecor(level);
    this._mergeBands(bands, false);
    this._buildDressing(level);
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

  /**
   * Culling band of height y: the SECTION holding it (the shaft is a stack of
   * rooms whose floors hide all but the neighbouring ones), or 64 m bands for
   * a level without sections.
   */
  _band(y) {
    const lv = this.level;
    if (lv && Array.isArray(lv.sections) && lv.sections.length && typeof lv.sectionIndexAt === 'function') return lv.sectionIndexAt(y) | 0;
    return Math.max(0, Math.floor((this._topY - y) / BAND_H));
  }

  _addChunk(obj, maxDist = Infinity, band = -1) {
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3();
    if (obj.isInstancedMesh) {
      obj.computeBoundingBox();
      obj.computeBoundingSphere();
      box.copy(obj.boundingBox);
    } else {
      box.setFromObject(obj);
    }
    this._chunks.push({ obj, box, maxDist, band });
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
    // Tints depend only on the id (stable across restarts / _rebind): computed once.
    this._crumbleTints = new Float32Array(nC * 3);
    for (let i = 0; i < this._crumbles.length; i++) {
      this._solidTint(this._crumbles[i], _c);
      this._crumbleMesh.setColorAt(i, _c);
      this._crumbleTints[i * 3] = _c.r;
      this._crumbleTints[i * 3 + 1] = _c.g;
      this._crumbleTints[i * 3 + 2] = _c.b;
    }
    if (this._crumbleMesh.instanceColor) this._crumbleMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this._crumbleMesh.visible = false;
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
      mesh.visible = n > 0;
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
    this._solidTintBase(s, r, k, out);
    if (s.kind !== 'metal' && s.kind !== 'bridge' && s.kind !== 'grate') {
      // the section grade (pale and ordered above; soot, rust and dark below), a little softer than on carving
      const g = this._grade((s.minY + s.maxY) / 2).stone;
      out.setRGB(out.r * (0.35 + 0.65 * g[0]), out.g * (0.35 + 0.65 * g[1]), out.b * (0.35 + 0.65 * g[2]));
    }
    return out;
  }

  _solidTintBase(s, r, k, out) {
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
    const getBand = (y) => this._bandLists(bands, y);
    const P = new Parts();
    const itemM = new THREE.Matrix4();
    /** Build in item-local space (front = +Z), rotate by rotY, move into the band of y. */
    const tris = (this.stats.decorTris = {});
    let curType = '';
    const addItem = (x, y, z, rotY, buildFn) => {
      for (const k of Object.keys(P.lists)) P.lists[k] = [];
      const g = this._grade(y);
      P.tint.stone = g.stone;
      P.tint.rock = g.stone;
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
      if (type === 'grate' && !this.gate) {
        // The chamber gate: its own mesh so it can drop on victory.
        haveGrate = true;
        const size = [lw, sy, ld];
        this._buildGate(P, d.x, d.y, z, rotY, size, size.indexOf(Math.min(lw, sy, ld)));
        count++;
        continue;
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
        this._buildGate(P, (gate.minX + gate.maxX) / 2, (gate.minY + gate.maxY) / 2, (gate.minZ + gate.maxZ) / 2, 0, sz3, thin);
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
    this.stats.decor = count;
    this.stats.skippedTypes = [...skipped];
    return bands;
  }

  /** The decor lists of the band holding y (created on demand); detail → the finer, nearer tier. */
  _bandLists(bands, y, detail = false) {
    const bi = detail ? `d${this._band(y)}_${Math.max(0, Math.floor((this._topY - y) / DETAIL_BAND_H))}` : this._band(y);
    if (!bands.has(bi)) bands.set(bi, { stone: [], metal: [], rock: [], flesh: [], glow: [], shaft: [] });
    return bands.get(bi);
  }

  _grade(y) {
    let i = 0;
    const lv = this.level;
    if (lv && typeof lv.sectionIndexAt === 'function') {
      try {
        i = lv.sectionIndexAt(y) | 0;
      } catch {
        i = 0;
      }
    }
    return GRADE[Math.max(0, Math.min(GRADE.length - 1, i))];
  }

  /**
   * Starts the dressing job: the Dresser plans the level section by section (a
   * generator) and update() pumps it a few milliseconds per frame (more while
   * not playing), so neither the boot nor a variant change stalls a frame —
   * in a headset that matters. Each finished section is merged into its decor
   * chunks at once, top first (the spawn dresses first). Kit parts (Blender
   * GLB) are recorded and drawn as their section is flushed once the kit is
   * there (setKit). finishDressing() runs the job to the end synchronously.
   */
  _buildDressing(level) {
    this._kitPlan = [];
    this.stats.dressTris = { procedural: 0, kit: 0, detail: 0 };
    const tris = this.stats.dressTris;
    const job = { bands: new Map(), it: null, sec: -1, merge: [] };
    this._makeCogMesh();
    const emit = (geo, list, detail) => {
      geo.computeBoundingBox();
      const y = (geo.boundingBox.min.y + geo.boundingBox.max.y) / 2;
      this._bandLists(job.bands, y, detail)[list].push(geo);
      const n = geo.attributes.position.count / 3;
      tris.procedural += n;
      if (detail) tris.detail += n;
    };
    const plan = (part, m, tint, list, big = false) => {
      const y = m.elements[13];
      this._kitPlan.push({ part, m, tint, list, big, sec: this._band(y), drawn: false });
    };
    try {
      const D = new Dresser(level, emit, plan);
      this.stats.dress = D.stats;
      job.D = D;
      job.it = D.steps();
      this._dressJob = job;
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[AT3D] environment dressing failed', err);
      this.stats.dress = { error: String(err && err.message) };
      this._dressJob = null;
    }
  }


  /**
   * One InstancedMesh for every colossal cog (turned and distance-culled in
   * update). Created empty at build so Renderer3D.precompile() compiles its
   * (instanced) program on the menu; the dressing plan fills it in later.
   */
  _makeCogMesh() {
    const mesh = new THREE.InstancedMesh(gearGeometry(), this.mats.get('decorMetal'), COG_MAX);
    mesh.name = 'cogs';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.setColorAt(0, _c.setRGB(1, 1, 1));
    mesh.count = 0;
    mesh.visible = false;
    this.root.add(mesh);
    this._cogs = { mesh, items: [] };
  }

  _buildCogs(list) {
    const C = this._cogs;
    if (!C || !list || !list.length) return;
    C.items = list.slice(0, COG_MAX).map((c) => ({ m: c.m, spin: c.spin, phase: c.phase, tint: c.tint, r: c.r, pos: new THREE.Vector3().setFromMatrixPosition(c.m) }));
    this.stats.cogTris = C.items.length * 800;
  }

  _updateCogs(head, t, vd) {
    const C = this._cogs;
    if (!C) return;
    const mesh = C.mesh;
    let n = 0;
    for (let i = 0; i < C.items.length; i++) {
      const c = C.items[i];
      if (c.pos.distanceTo(head) - c.r * 1.1 > vd) continue;
      _m4.makeRotationZ(c.phase + c.spin * t);
      _m4b.multiplyMatrices(c.m, _m4);
      mesh.setMatrixAt(n, _m4b);
      mesh.setColorAt(n, _c.setRGB(c.tint[0], c.tint[1], c.tint[2]));
      n++;
    }
    mesh.count = n;
    mesh.visible = n > 0;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  /** Advances the dressing job for about `ms` milliseconds. */
  _pumpDressing(ms) {
    const job = this._dressJob;
    if (!job) return;
    const now = typeof performance !== 'undefined' ? () => performance.now() : () => Date.now();
    const t0 = now();
    try {
      do {
        // merges queued by a flush go first, one band per step (each is a big copy)
        if (job.merge.length) {
          const [bi, k, list] = job.merge.shift();
          const lists = { stone: [], metal: [], rock: [], flesh: [], glow: [], shaft: [] };
          lists[k] = list;
          this._mergeBands(new Map([[bi, lists]]), true);
          continue;
        }
        if (job.finished) {
          this._dressJob = null;
          return;
        }
        const r = job.it.next();
        if (r.done) {
          this._flushDressing(Infinity);
          this._buildCogs(job.D && job.D.gears);
          job.finished = true;
          continue;
        }
        if (r.value > job.sec) {
          if (job.sec >= 0) this._flushDressing(r.value - 1);
          job.sec = r.value;
        }
      } while (now() - t0 < ms);
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[AT3D] environment dressing failed', err);
      if (this.stats.dress) this.stats.dress.error = String(err && err.message);
      this._dressJob = null;
    }
  }

  /** Runs the dressing job to the end now (tests, tools, a renderer precompile). */
  finishDressing() {
    while (this._dressJob) this._pumpDressing(Infinity);
  }

  /** Draws the kit parts of every pending band of the sections ≤ maxSec and queues them for merging. */
  _flushDressing(maxSec) {
    const job = this._dressJob;
    if (!job) return;
    if (this._kit) this._emitKitPlan(job.bands, maxSec);
    for (const [bi, lists] of job.bands) {
      const sec = typeof bi === 'number' ? bi : parseInt(String(bi).slice(1), 10);
      if (sec > maxSec) continue;
      for (const k of Object.keys(lists)) if (lists[k].length) job.merge.push([bi, k, lists[k]]);
      job.bands.delete(bi);
    }
  }

  /** Instantiates the planned kit parts into band lists (world space, graded, metric UVs). */
  _emitKitPlan(bands, maxSec = Infinity) {
    const kit = this._kit;
    if (!kit || !this._kitPlan) return;
    let t = 0;
    const missing = new Set(this.stats.kitMissing || []);
    const byPart = this.stats.kitTris || (this.stats.kitTris = {});
    for (const it of this._kitPlan) {
      if (it.drawn || it.sec > maxSec) continue;
      it.drawn = true;
      const part = kit.get(it.part);
      if (!part) {
        missing.add(it.part);
        continue;
      }
      const g = part.geo.clone();
      g.applyMatrix4(it.m);
      // mirrored placements (negative determinant) would turn the part inside out
      if (it.m.determinant() < 0) {
        const p = g.attributes.position;
        const n = g.attributes.normal;
        const c = g.attributes.color;
        for (let i = 0; i < p.count; i += 3) {
          for (const a of [p, n, c]) {
            const x = a.getX(i + 1), y = a.getY(i + 1), z = a.getZ(i + 1);
            a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2));
            a.setXYZ(i + 2, x, y, z);
          }
        }
      }
      tintColors(g, it.tint[0], it.tint[1], it.tint[2]);
      worldUV(g);
      byPart[it.part] = (byPart[it.part] || 0) + part.tris;
      const T = this.stats.dress && this.stats.dress.tris;
      if (T) {
        const k = `s${this._band(it.m.elements[13]) + 1}`;
        const row = T[k] || (T[k] = {});
        const c = it.part.replace('ch1_env_', 'kit:');
        row[c + '_tris'] = (row[c + '_tris'] || 0) + part.tris;
      }
      g.computeBoundingBox();
      const y = (g.boundingBox.min.y + g.boundingBox.max.y) / 2;
      this._bandLists(bands, y, !it.big)[it.list || part.list].push(g);
      t += g.attributes.position.count / 3;
    }
    if (this.stats.dressTris) this.stats.dressTris.kit += t;
    this.stats.kitMissing = [...missing];
  }

  /**
   * Merges band lists into one mesh per band per material (the decor chunks,
   * distance-culled in update). append: merge into the existing chunk of the
   * same band / material instead of adding a second draw.
   */
  _mergeBands(bands, append) {
    if (!this._chunkByKey) this._chunkByKey = new Map();
    for (const [bi, lists] of bands) {
      for (const k of Object.keys(lists)) {
        const list = lists[k];
        if (!list.length) continue;
        const key = `${bi}|${k}`;
        const prev = append ? this._chunkByKey.get(key) : null;
        let merged = null;
        try {
          merged = mergeGeometries(prev ? [prev.obj.geometry, ...list] : list, false);
        } catch {
          merged = null;
        }
        for (const g of list) g.dispose();
        lists[k] = [];
        if (!merged) continue;
        merged.computeBoundingSphere();
        merged.computeBoundingBox();
        if (prev) {
          prev.obj.geometry.dispose();
          prev.obj.geometry = merged;
          prev.box.copy(merged.boundingBox);
          continue;
        }
        const mesh = new THREE.Mesh(merged, this.mats.get(DECOR_MAT[k]) || this.mats.get('decorStone'));
        mesh.name = `decor_${k}_${bi}`;
        mesh.matrixAutoUpdate = false;
        if (k === 'shaft') mesh.renderOrder = 10;
        const detail = String(bi).startsWith('d');
        this._addChunk(mesh, detail ? DETAIL_DIST : Infinity, detail ? parseInt(String(bi).slice(1), 10) : bi);
        this._chunkByKey.set(key, this._chunks[this._chunks.length - 1]);
      }
    }
  }

  /**
   * The environment kit (ch1_env_kit.glb, parsed by GLTFLoader) arrived: draw
   * the planned kit parts into the decor chunks and rebuild the far
   * silhouettes with the kit's colossi. Safe to call before or after build().
   */
  setKit(gltf) {
    if (this._kit || !gltf) return false;
    try {
      this._kit = parseEnvKit(gltf);
    } catch (err) {
      if (typeof console !== 'undefined') console.warn('[AT3D] environment kit unreadable', err);
      this._kit = null;
      return false;
    }
    if (!this._kit.size) {
      this._kit = null;
      return false;
    }
    if (!this.level) return true;
    // parts of the sections already flushed now; the running job draws the rest
    const job = this._dressJob;
    const bands = new Map();
    this._emitKitPlan(bands, job ? job.sec - 1 : Infinity);
    this._mergeBands(bands, true);
    this._rebuildFar();
    return true;
  }

  /** Rebuilds the far silhouettes (and the window glows that ride on them). */
  _rebuildFar() {
    const level = this.level;
    if (!level) return;
    for (const o of [this._colossal, this._lightGlow]) {
      if (!o) continue;
      this.root.remove(o);
      o.geometry.dispose();
      if (o.userData.ownMaterial && o.material) o.material.dispose();
    }
    this._colossal = null;
    this._lightGlow = null;
    const b = level.bounds || { minX: -20, maxX: 20, minY: -600, maxY: 20, minZ: -20, maxZ: 20 };
    this._buildColossal(level, b);
    this._buildLightGlows(level);
  }

  /**
   * The chamber's portcullis, built at (cx, cy, cz) (closed position = the gate
   * box) as its own object. It starts raised into the wall above the opening with
   * a short spiked lip showing (only when its bars are vertical), and _updateGate
   * drops it when the Game closes the gate.
   */
  _buildGate(P, cx, cy, cz, rotY, size, thin) {
    for (const k of Object.keys(P.lists)) P.lists[k] = [];
    // A little thinner than the gate box: the raised bars sit inside the wall
    // and must not share (z-fight) its faces.
    const sz = size.slice();
    sz[thin] *= 0.88;
    const raise = thin !== 1 ? Math.max(0, size[1] - GATE_LIP) : 0;
    gateBars(P, sz, thin, raise > 0);
    const group = new THREE.Group();
    group.name = 'chamberGate';
    _m4.makeRotationY(rotY || 0);
    const bb = new THREE.Box3();
    let tris = 0;
    for (const k of Object.keys(P.lists)) {
      const list = P.lists[k];
      if (!list.length) continue;
      let merged = null;
      try {
        merged = mergeGeometries(list, false);
      } catch {
        merged = null;
      }
      for (const g of list) g.dispose();
      P.lists[k] = [];
      if (!merged) continue;
      merged.applyMatrix4(_m4);
      merged.computeBoundingSphere();
      merged.computeBoundingBox();
      bb.union(merged.boundingBox);
      tris += merged.attributes.position.count / 3;
      const mesh = new THREE.Mesh(merged, this.mats.get(DECOR_MAT[k]) || this.mats.get('decorMetal'));
      mesh.name = `gate_${k}`;
      group.add(mesh);
    }
    if (!group.children.length) return;
    if (this.stats.decorTris) this.stats.decorTris.grate = (this.stats.decorTris.grate || 0) + tris;
    this.gate = group;
    this._gateBaseY = cy;
    this._gateRaise = raise;
    this._gateY = raise;
    this._gateV = 0;
    this._gateCenter = new THREE.Vector3(cx, cy + raise / 2, cz);
    this._gateRadius = hyp(size[0], size[1] + raise, size[2]) / 2;
    // Where the bars meet the floor (world, closed): sparks run along the wider axis.
    const alongX = bb.max.x - bb.min.x >= bb.max.z - bb.min.z;
    this._gateFoot = { x: cx, y: cy - size[1] / 2, z: cz, w: alongX ? bb.max.x - bb.min.x : bb.max.z - bb.min.z, alongX };
    group.position.set(cx, cy + raise, cz);
    this.root.add(group);
  }

  /** Drops the gate (accelerating) when game.gateClosed; opens it at once otherwise. */
  _updateGate(dt, game, head, vd) {
    const g = this.gate;
    if (!g) return;
    const want = game && game.gateClosed ? 0 : this._gateRaise;
    if (want < this._gateY) {
      this._gateV += GATE_ACCEL * dt;
      this._gateY = Math.max(want, this._gateY - this._gateV * dt);
      if (this._gateY <= want && this.fx) {
        // Iron hits stone: sparks along the foot and a dust skirt.
        const f = this._gateFoot;
        for (let i = 0; i < 5; i++) {
          const k = ((i + 0.5) / 5 - 0.5) * f.w;
          this.fx.burst('sparks', f.x + (f.alongX ? k : 0), f.y + 0.05, f.z + (f.alongX ? 0 : k), { count: 4 });
        }
        this.fx.burst('puff', f.x, f.y + 0.1, f.z, { count: 10, spread: f.w * 0.4, ground: true });
      }
    } else {
      this._gateY = want;
      this._gateV = 0;
    }
    g.position.y = this._gateBaseY + this._gateY;
    g.visible = this._gateCenter.distanceTo(head) < vd + this._gateRadius;
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
    const kit = this._kit;
    /** Pushes a kit silhouette (scaled, turned, placed) into the stone list; false without the kit. */
    const kitPart = (name, x, y, z, sx, sy, sz, rot) => {
      const part = kit && kit.get(name);
      if (!part) return false;
      const g = part.geo.clone();
      mat.makeRotationY(rot || 0);
      mat.scale(_s.set(sx, sy, sz));
      mat.setPosition(x, y, z);
      g.applyMatrix4(mat);
      worldUV(g);
      P.lists.stone.push(g);
      return true;
    };
    for (let y = top; y > bottom; y -= 60 + rng() * 30) {
      const sh = shaftAt(y);
      const cx = (sh.minX + sh.maxX) / 2;
      const cz = (sh.minZ + sh.maxZ) / 2;
      const R0 = hyp((sh.maxX - sh.minX) / 2, (sh.maxZ - sh.minZ) / 2) + 18;
      const n = 2 + Math.floor(rng() * 3);
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
          const rot = rng() * Math.PI;
          if (!kitPart('ch1_env_far_spire', x, y + w * 0.1, z, w / 0.4, h, w / 0.4, rot)) {
            const g = new THREE.CylinderGeometry(w / 2, w * 0.12, h, 6, 1);
            mat.makeRotationY(rot);
            mat.setPosition(x, y - h / 2, z);
            P.geo('stone', g, mat);
            const crown = new THREE.BoxGeometry(w * 1.25, w * 0.35, w * 1.25);
            mat.setPosition(x, y + w * 0.1, z);
            P.geo('stone', crown, mat);
          }
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
          // colossal column rising out of sight (its broken top lost in the dark above)
          const rot = rng() * Math.PI;
          if (!kitPart('ch1_env_far_column', x, y - h * 1.3, z, w / 0.22, h * 1.9, w / 0.22, rot)) {
            mat.makeRotationY(rot);
            mat.setPosition(x, y - h * 0.5, z);
            P.geo('stone', new THREE.BoxGeometry(w * 0.6, h * 1.6, w * 0.6), mat);
          }
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
          // statue of a Lanternwright, the size of a cathedral, facing the shaft
          const sz = 40 + rng() * 50;
          const rot = Math.atan2(cx - x, cz - z);
          if (kitPart('ch1_env_far_colossus', x, y - sz * 0.6, z, sz, sz, sz, rot)) {
            // its lantern (local 0.12, 0.56, 0.28) burns
            const lx = 0.12 * sz;
            const lz = 0.28 * sz;
            myWin.push([x + Math.cos(rot) * lx + Math.sin(rot) * lz, y - sz * 0.6 + 0.56 * sz, z - Math.sin(rot) * lx + Math.cos(rot) * lz, warm.r, warm.g, warm.b]);
          } else {
            mat.makeRotationY(rng() * Math.PI);
            mat.setPosition(x, y - sz / 2, z);
            P.geo('stone', new THREE.CylinderGeometry(sz * 0.15, sz * 0.3, sz, 7), mat);
            mat.setPosition(x, y + sz * 0.1, z);
            P.geo('stone', new THREE.ConeGeometry(sz * 0.14, sz * 0.25, 6), mat);
            myWin.push([x + sz * 0.2, y + sz * 0.05, z, warm.r * 0.9, warm.g * 0.9, warm.b * 0.9]);
          }
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
        const yy = y - 20 - rng() * 30;
        const dd = 5 + rng() * 6;
        if (!kitPart('ch1_env_far_arcade', cx + Math.cos(a0) * d0, yy, cz + Math.sin(a0) * d0, span, span * 0.28, dd / 0.1, -a0 + Math.PI / 2)) {
          mat.makeRotationY(a0 + Math.PI / 2);
          mat.setPosition(cx + Math.cos(a0) * d0, yy, cz + Math.sin(a0) * d0);
          P.geo('stone', new THREE.BoxGeometry(span, 3 + rng() * 4, dd), mat);
        }
        accept(start);
      }
    }
    // Authored far structures (level decor 'far-structure'), same silhouette material.
    for (const f of this._farItems || []) {
      const start = P.lists.stone.length;
      if (f.variant === 'statue' || f.variant === 'arch') {
        const sh = shaftAt(f.y);
        f.rotY = Math.atan2((sh.minX + sh.maxX) / 2 - f.x, (sh.minZ + sh.maxZ) / 2 - f.z);
      }
      const kitName = { statue: 'ch1_env_far_colossus', spire: 'ch1_env_far_spire', tower: 'ch1_env_far_spire', bridge: 'ch1_env_far_arcade' }[f.variant];
      const sc = {
        statue: [f.w / 0.4, f.h, f.d / 0.5, f.y - f.h / 2],
        spire: [f.w / 0.43, f.h, f.d / 0.43, f.y + f.h / 2],
        tower: [f.w / 0.43, f.h, f.d / 0.43, f.y + f.h / 2],
        bridge: [f.w, f.h * 2.5, f.d / 0.1, f.y + f.h / 2],
      }[f.variant];
      if (kitName && sc && kitPart(kitName, f.x, sc[3], f.z, sc[0], sc[1], sc[2], f.rotY)) {
        if (f.variant === 'statue') {
          const lx = 0.12 * sc[0];
          const lz = 0.28 * sc[2];
          windows.push(f.x + Math.cos(f.rotY) * lx + Math.sin(f.rotY) * lz, sc[3] + 0.56 * f.h, f.z - Math.sin(f.rotY) * lx + Math.cos(f.rotY) * lz);
          winCol.push(warm.r, warm.g, warm.b);
        }
        continue;
      }
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
    if (this._dressJob) this._pumpDressing(game && game.state === 'playing' ? 2 : 8);
    this.time += dt;
    const t = this.time;
    // Chunk culling: the head's band (section) and its neighbours only (the
    // floors between sections hide the rest), then by fog distance.
    const vd = viewDist + VIEW_MARGIN;
    const hb = this._band(head.y);
    for (let i = 0; i < this._chunks.length; i++) {
      const ch = this._chunks[i];
      const near = ch.band < 0 || (ch.band >= hb - 1 && ch.band <= hb + 1);
      ch.obj.visible = near && ch.box.distanceToPoint(head) < (ch.maxDist < vd ? ch.maxDist : vd);
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
    this._updateCogs(head, t, vd);
    this._updateSolidStates(game, head, vd);
    this._updateGate(dt, game, head, vd);
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
      const tint = this._crumbleTints;
      const kk = k > 0 ? 1 + k * 0.25 : 1;
      _c.setRGB(tint[i * 3] * kk, tint[i * 3 + 1] * kk, tint[i * 3 + 2] * kk);
      mesh.setColorAt(n, _c);
      n++;
    }
    mesh.count = n;
    mesh.visible = n > 0;
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
      mesh.visible = n > 0;
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
      slot.mesh.visible = slot.n > 0;
      if (slot.n) {
        slot.mesh.instanceMatrix.needsUpdate = true;
        slot.mesh.instanceColor.needsUpdate = true;
        slot.attr.needsUpdate = true;
      }
    }
    glyphs.count = g;
    glyphs.visible = g > 0;
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
