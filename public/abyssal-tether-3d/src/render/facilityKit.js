/* THE LANTERN — render/facilityKit.js
 * THE COLLAR kit (plans/COLLAR_KIT.md): the clean surface station bolted onto the Underspire's mouth, the four HOIST DRONES and the
 * CRADLE that lower Elias Wren 60 m down the S1 chimney to the Threshold in the opening film. Art only: no Light objects, no game state.
 *
 *   FACILITY                    the constants the film codes against (all metres, world space unless said; documented inline)
 *   buildDrone({ lod, index })  one hoist drone (THREE.Group), ~1.22 m across the duct rims, nose toward local -Z
 *       .rotors[4]                Groups at the duct centres; each spins about its local Y (children: .blades, .blur)
 *       .clamp                    the clamp head Group under the winch; .clamp.jaws[2] open about X (setClamp)
 *       .lights.beam              the work-light cone: an ADDITIVE MESH (not a light), hidden until setBeam(k > 0)
 *       .lights.status            the LED pips (nav lights, the spine status bar, the scanner bar): one vertex-coloured MeshBasic
 *       .scan                     the height-scan fan: a thin additive sheet from the nose scanner, hidden until setScan(k > 0)
 *       .clampPoint               {x,y,z} local: where the cradle's lift-ring bar sits when clamped (drone.position = ringWorld - clampPoint)
 *       setClamp(k) setLights(k) setBeam(k) setScan(k, sweep) setStatus(hex) update(dt, state) dispose()
 *   buildCradle()               the open rescue cage (THREE.Group); origin = the top of the floor grating (the player's feet)
 *       .anchors[4]               {x,y,z} local: the lift rings' top bars (the drones' clamp points)
 *       .screen  .screenSetText(text)   the console's status screen (MeshBasic + a 256 x 128 CanvasTexture, redrawn on a call)
 *       .spool  .gate             animatable nodes (spool turns about local X, gate swings about Y from its hinge)
 *       setLights(k) setGate(k) update(dt, state) dispose()
 *   buildCollar()               { group, dronePads, cageAnchor, irisCenter, irisLeaves, lights, setIris(k), setLights(k), update, dispose }
 *
 * Geometry is merged per material and vertex-coloured (the repo pattern: pickupsView.js, knockerView.js): the lit pieces share one
 * MeshStandardMaterial per builder (vertex colours + a per-vertex roughness / metalness attribute `aRM`, patched with the shared look:
 * patchMaterial({ lit, grade })). NO texture on any lit material (the Quest's 16-sampler limit); LEDs and screens are MeshBasic; the beam,
 * the scan fan and the rotor blur are additive / translucent MeshBasic. Everything is deterministic (seeded hash noise for the grime, no
 * Math.random) and the per-frame helpers (update, setIris, setClamp, setLights, ...) allocate nothing.
 */
import * as THREE from 'three';
import { patchMaterial } from './materials.js';

const PI = Math.PI;
const TAU = PI * 2;

// ---------------------------------------------------------------------------------------------------------------------------------
// The contract constants
// ---------------------------------------------------------------------------------------------------------------------------------

export const FACILITY = Object.freeze({
  shaftHalf: 11, // the S1 chimney's inner half width (x, z in -11..11)
  collarY: 60, // the shaft mouth: the top of the chimney's stone (level-data-3d s1-wall y1)
  stoneCapY: 60.08, // the carved stone rim course laid on the mouth (square hole +-10.95, out to stoneOuter)
  stoneOuter: 16.4,
  irisRadius: 16.0, // the iris aperture (covers the 22 m square: its half diagonal is 15.56 m)
  irisLeafRadius: 16.6, // a leaf's length from the centre when closed (its outer end tucks under the collar ring)
  irisTravel: 16.4, // how far each leaf slides out along its bisector at setIris(1): no leaf is inside r 16 then
  irisLeaves: 12,
  irisBottomY: 60.12,
  irisTopY: 60.3, // the closed iris' top: the cradle's skids rest on it
  deckY: 60.45, // the launch deck's top
  ringOuter: 17.2, // the raised collar ring at the aperture lip (r 16 .. 17.2, top deckY + 0.25)
  hallRadius: 34, // the hangar's 20-sided wall
  hallHeight: 20, // deck to ceiling
  gantryRadius: 18.5,
  gantryY: 69.45, // the gantry ring girder's bottom chord (its LED strip faces down)
  catwalkY: 66.45,
  controlFloorY: 67.45, // the control hall's floor (north, z -34 .. -29)
  thresholdY: 0, // where the cradle lands (the Threshold ledge's top)
  descent: Object.freeze({ x: -4, z: 8.5 }), // the descent column: straight over the Threshold spawn (-4, 0.4, 8.5)
  cradle: Object.freeze({
    floor: 1.6, // the grating's side (m)
    skid: 0.12, // skids under the grating: the cradle origin is skid m above whatever it rests on
    rail: 1.05, // waist rail height above the grating
    eye: 1.65, // the player's eye above the grating
    top: 2.35, // the spreader X's height
    anchorXZ: 1.1, // the lift rings at (+-1.1, anchorY, +-1.1)
    anchorY: 2.51, // the rings' top bars (the drones' clamp points)
  }),
  drone: Object.freeze({
    span: 1.22, // across the duct rims
    clampY: -0.375, // local y of the clamp point (the ring bar sits here when the jaws close)
    dockY: 0.5, // a docked drone's centre above its pad's deck
    rotorRps: 9, // visual rotor speed at spin 1 (rev / s); above 0.55 of it the blades swap to the blur disc
  }),
});

// roughness / metalness pairs (the `aRM` attribute)
const RM = {
  composite: [0.62, 0.0],
  carbon: [0.5, 0.1],
  metal: [0.42, 0.55],
  steel: [0.36, 0.7],
  rubber: [0.88, 0.0],
  paint: [0.7, 0.0],
  stone: [0.82, 0.0],
  glass: [0.2, 0.0],
};

const COL = {
  white: 0xb9bab4,
  whiteDim: 0x9fa09a,
  grey: 0x8e8f8a,
  carbon: 0x2b2d30,
  gun: 0x4a4e53,
  steel: 0x7a7d80,
  deck: 0x3a3c3d,
  deckB: 0x323435,
  yellow: 0xb8902a,
  black: 0x1c1c1c,
  orange: 0xa8552a,
  stencil: 0x151617,
  paintW: 0xa9aaa4,
  stone: 0x1f1e1c,
  stoneB: 0x181715,
  rope: 0x8a8378,
  rubber: 0x141515,
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Seeded noise (grime in the vertex colours)
// ---------------------------------------------------------------------------------------------------------------------------------

function hash3(x, y, z, s) {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f) ^ Math.imul(s | 0, 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
function vnoise(x, y, z, s) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fy = y - iy;
  const fz = z - iz;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const uz = fz * fz * (3 - 2 * fz);
  let r = 0;
  for (let c = 0; c < 8; c++) {
    const dx = c & 1;
    const dy = (c >> 1) & 1;
    const dz = (c >> 2) & 1;
    const w = (dx ? ux : 1 - ux) * (dy ? uy : 1 - uy) * (dz ? uz : 1 - uz);
    r += w * hash3(ix + dx, iy + dy, iz + dz, s);
  }
  return r;
}
/** Multiplier 0.4..1 for a vertex: blotchy dirt, vertical streaks, and darker undersides (a cheap cavity term). */
function grime(x, y, z, ny, seed, g, s) {
  const n1 = vnoise(x * 1.3 * s, y * 1.3 * s, z * 1.3 * s, seed);
  const n2 = vnoise(x * 5.1 * s + 17.3, y * 5.1 * s, z * 5.1 * s, seed ^ 0x9e37);
  const st = vnoise(x * 7 * s, y * 0.4 * s, z * 7 * s, seed ^ 0x51ed);
  const d = 0.22 * n1 + 0.14 * n2 + 0.2 * Math.max(0, st - 0.5) + 0.16 * Math.max(0, -ny);
  return Math.max(0.4, 1 - g * d);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The merger: parts -> one indexed, vertex-coloured BufferGeometry (+ aRM)
// ---------------------------------------------------------------------------------------------------------------------------------

const _bv = new THREE.Vector3();
const _bn = new THREE.Vector3();
const _bm3 = new THREE.Matrix3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _gn = new THREE.Vector3();

/** A matrix from a position, Euler XYZ rotation and a scale (uniform number or [sx, sy, sz]). Build time only. */
export function T(x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz));
  const sc = Array.isArray(s) ? new THREE.Vector3(s[0], s[1], s[2]) : new THREE.Vector3(s, s, s);
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, sc);
}
const mul = (a, b) => new THREE.Matrix4().multiplyMatrices(a, b);
const I4 = new THREE.Matrix4();

class Mesher {
  constructor(seed = 1) {
    this.P = [];
    this.N = [];
    this.C = [];
    this.R = [];
    this.I = [];
    this.seed = seed >>> 0;
  }
  get count() {
    return this.P.length / 3;
  }
  get tris() {
    return this.I.length / 3;
  }
  _o(o) {
    const c = o && o.c != null ? o.c : COL.white;
    return { col: c instanceof THREE.Color ? c : new THREE.Color(c), rm: (o && o.rm) || RM.composite, g: o && o.g != null ? o.g : 1, gs: (o && o.gs) || 1, k: o && o.k != null ? o.k : 1 };
  }
  _push(x, y, z, nx, ny, nz, o) {
    const f = o.g > 0 ? grime(x, y, z, ny, this.seed, o.g, o.gs) * o.k : o.k;
    this.P.push(x, y, z);
    this.N.push(nx, ny, nz);
    this.C.push(o.col.r * f, o.col.g * f, o.col.b * f);
    this.R.push(o.rm[0], o.rm[1]);
  }
  /** A flat polygon (local points, any order is fine when `face` = an outward hint in local space). */
  poly(M, pts, opts, face) {
    const o = opts && opts.col ? opts : this._o(opts);
    const m = M || I4;
    // Newell normal in local space
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    let order = pts;
    if (face && nx * face[0] + ny * face[1] + nz * face[2] < 0) {
      order = pts.slice().reverse();
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    _bm3.getNormalMatrix(m);
    _bn.set(nx, ny, nz).applyMatrix3(_bm3).normalize();
    const base = this.count;
    for (const p of order) {
      _bv.set(p[0], p[1], p[2]).applyMatrix4(m);
      this._push(_bv.x, _bv.y, _bv.z, _bn.x, _bn.y, _bn.z, o);
    }
    for (let i = 1; i < order.length - 1; i++) this.I.push(base, base + i, base + i + 1);
  }
  /** A convex solid given as faces in local space: each face is turned outward from the solid's centroid. */
  convex(M, polys, opts) {
    const o = this._o(opts);
    let cx = 0;
    let cy = 0;
    let cz = 0;
    let n = 0;
    for (const f of polys)
      for (const p of f) {
        cx += p[0];
        cy += p[1];
        cz += p[2];
        n++;
      }
    cx /= n;
    cy /= n;
    cz /= n;
    for (const f of polys) {
      let fx = 0;
      let fy = 0;
      let fz = 0;
      for (const p of f) {
        fx += p[0];
        fy += p[1];
        fz += p[2];
      }
      this.poly(M, f, o, [fx / f.length - cx, fy / f.length - cy, fz / f.length - cz]);
    }
  }
  /** Hexahedron from two quads (a: 4 points, b: 4 points, same winding), e.g. tapered bars, twisted blades. */
  hexa(M, a, b, opts) {
    const polys = [a, b];
    for (let i = 0; i < 4; i++) polys.push([a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i]]);
    this.convex(M, polys, opts);
  }
  box(M, w, h, d, opts) {
    const x = w / 2;
    const y = h / 2;
    const z = d / 2;
    this.hexa(M, [[-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z]], [[-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z]], opts);
  }
  /** A box tapered along Y: bottom w0 x d0, top w1 x d1. */
  tbox(M, w0, d0, w1, d1, h, opts) {
    const y = h / 2;
    this.hexa(M, [[-w0 / 2, -y, -d0 / 2], [w0 / 2, -y, -d0 / 2], [w0 / 2, -y, d0 / 2], [-w0 / 2, -y, d0 / 2]], [[-w1 / 2, y, -d1 / 2], [w1 / 2, y, -d1 / 2], [w1 / 2, y, d1 / 2], [-w1 / 2, y, d1 / 2]], opts);
  }
  /** A chamfered box (44 triangles): crisp, machined. */
  cbox(M, w, h, d, c, opts) {
    const H = [w / 2, h / 2, d / 2];
    c = Math.min(c, H[0] * 0.9, H[1] * 0.9, H[2] * 0.9);
    const polys = [];
    for (let a = 0; a < 3; a++)
      for (const s of [-1, 1]) {
        const u = (a + 1) % 3;
        const v = (a + 2) % 3;
        const pts = [];
        for (const [su, sv] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
          const p = [0, 0, 0];
          p[a] = s * H[a];
          p[u] = su * (H[u] - c);
          p[v] = sv * (H[v] - c);
          pts.push(p);
        }
        polys.push(pts);
      }
    for (let t = 0; t < 3; t++) {
      const a = (t + 1) % 3;
      const b = (t + 2) % 3;
      for (const sa of [-1, 1])
        for (const sb of [-1, 1]) {
          const q = [];
          for (const st of [-1, 1]) {
            const p1 = [0, 0, 0];
            p1[t] = st * (H[t] - c);
            p1[a] = sa * H[a];
            p1[b] = sb * (H[b] - c);
            const p2 = [0, 0, 0];
            p2[t] = st * (H[t] - c);
            p2[a] = sa * (H[a] - c);
            p2[b] = sb * H[b];
            q.push(p1, p2);
          }
          polys.push([q[0], q[1], q[3], q[2]]);
        }
    }
    for (const sx of [-1, 1])
      for (const sy of [-1, 1])
        for (const sz of [-1, 1])
          polys.push([
            [sx * H[0], sy * (H[1] - c), sz * (H[2] - c)],
            [sx * (H[0] - c), sy * H[1], sz * (H[2] - c)],
            [sx * (H[0] - c), sy * (H[1] - c), sz * H[2]],
          ]);
    this.convex(M, polys, opts);
  }
  /** Any three.js geometry (indexed or not), transformed. */
  geo(M, g, opts) {
    const o = this._o(opts);
    const m = M || I4;
    _bm3.getNormalMatrix(m);
    const pa = g.attributes.position;
    if (!g.attributes.normal) g.computeVertexNormals();
    const na = g.attributes.normal;
    const base = this.count;
    for (let i = 0; i < pa.count; i++) {
      _bv.fromBufferAttribute(pa, i).applyMatrix4(m);
      _bn.fromBufferAttribute(na, i).applyMatrix3(_bm3).normalize();
      this._push(_bv.x, _bv.y, _bv.z, _bn.x, _bn.y, _bn.z, o);
    }
    if (g.index) for (let i = 0; i < g.index.count; i++) this.I.push(base + g.index.getX(i));
    else for (let i = 0; i < pa.count; i++) this.I.push(base + i);
    g.dispose();
  }
  cyl(M, rt, rb, h, seg, opts, open = false) {
    this.geo(M, new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), opts);
  }
  /**
   * A profile swept round local Y: `prof` = [[r, y], ...] counter-clockwise in the (r, y) plane (so faces point out), `closed` joins the
   * last point to the first. Crisp along the profile (flat per profile edge), smooth round the sweep. a0..a1 limits the arc.
   */
  sweep(M, prof, seg, opts, closed = true, a0 = 0, a1 = TAU) {
    const o = this._o(opts);
    const m = M || I4;
    _bm3.getNormalMatrix(m);
    const ne = closed ? prof.length : prof.length - 1;
    for (let j = 0; j < ne; j++) {
      const p = prof[j];
      const q = prof[(j + 1) % prof.length];
      let er = q[1] - p[1];
      let ey = -(q[0] - p[0]);
      const el = Math.hypot(er, ey) || 1;
      er /= el;
      ey /= el;
      const base = this.count;
      for (let s = 0; s <= seg; s++) {
        const a = a0 + ((a1 - a0) * s) / seg;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        for (const pt of [p, q]) {
          _bv.set(pt[0] * ca, pt[1], pt[0] * sa).applyMatrix4(m);
          _bn.set(er * ca, ey, er * sa).applyMatrix3(_bm3).normalize();
          this._push(_bv.x, _bv.y, _bv.z, _bn.x, _bn.y, _bn.z, o);
        }
      }
      // winding: decide once per strip from the geometric normal of its first quad
      const i0 = base;
      const P = this.P;
      _e1.set(P[(i0 + 1) * 3] - P[i0 * 3], P[(i0 + 1) * 3 + 1] - P[i0 * 3 + 1], P[(i0 + 1) * 3 + 2] - P[i0 * 3 + 2]);
      _e2.set(P[(i0 + 2) * 3] - P[i0 * 3], P[(i0 + 2) * 3 + 1] - P[i0 * 3 + 1], P[(i0 + 2) * 3 + 2] - P[i0 * 3 + 2]);
      _gn.crossVectors(_e1, _e2);
      const flip = _gn.x * this.N[i0 * 3] + _gn.y * this.N[i0 * 3 + 1] + _gn.z * this.N[i0 * 3 + 2] < 0;
      for (let s = 0; s < seg; s++) {
        const a = base + s * 2;
        const b = a + 1;
        const c = a + 2;
        const d = a + 3;
        if (flip) this.I.push(a, c, b, b, c, d);
        else this.I.push(a, b, c, b, d, c);
      }
    }
  }
  /** A flat annulus sector in the local XZ plane at height y, facing up (or down). */
  ann(M, r0, r1, a0, a1, y, seg, opts, up = true) {
    const o = this._o(opts);
    for (let s = 0; s < seg; s++) {
      const b0 = a0 + ((a1 - a0) * s) / seg;
      const b1 = a0 + ((a1 - a0) * (s + 1)) / seg;
      this.poly(
        M,
        [
          [r0 * Math.cos(b0), y, r0 * Math.sin(b0)],
          [r1 * Math.cos(b0), y, r1 * Math.sin(b0)],
          [r1 * Math.cos(b1), y, r1 * Math.sin(b1)],
          [r0 * Math.cos(b1), y, r0 * Math.sin(b1)],
        ],
        o,
        [0, up ? 1 : -1, 0],
      );
    }
  }
  /** Painted 3x5 pixel-font stencil in the local XY plane (facing +Z), centred on the origin; px = pixel size. */
  stencil(M, text, px, opts) {
    const o = this._o(Object.assign({ g: 0.5, rm: RM.paint }, opts));
    const w = text.length * 4 - 1;
    const x0 = (-w * px) / 2;
    const y0 = (-5 * px) / 2;
    for (let ci = 0; ci < text.length; ci++) {
      const gl = FONT[text[ci]] || FONT[' '];
      for (let r = 0; r < 5; r++) {
        const row = gl[r];
        let c = 0;
        while (c < 3) {
          if (row[c] !== '#') {
            c++;
            continue;
          }
          let e = c;
          while (e < 3 && row[e] === '#') e++;
          const xa = x0 + (ci * 4 + c) * px;
          const xb = x0 + (ci * 4 + e) * px;
          const ya = y0 + (4 - r) * px;
          const yb = ya + px;
          this.poly(M, [[xa, ya, 0], [xb, ya, 0], [xb, yb, 0], [xa, yb, 0]], o, [0, 0, 1]);
          c = e;
        }
      }
    }
  }
  /** 45-degree hazard stripes on a band in the local XY plane (facing +Z): x 0..len, y 0..h, pitch p. */
  stripes(M, len, h, p, opts) {
    const y = this._o(Object.assign({ c: COL.yellow, rm: RM.paint, g: 1.2 }, opts));
    const k = this._o(Object.assign({}, opts, { c: COL.black, rm: RM.paint, g: 0.6 }));
    this.poly(M, [[0, 0, -0.0005], [len, 0, -0.0005], [len, h, -0.0005], [0, h, -0.0005]], k, [0, 0, 1]);
    for (let x = -h; x < len; x += p) {
      const a = Math.max(0, x);
      const b = Math.min(len, x + p / 2);
      if (b <= a) continue;
      // parallelogram clipped to the band: bottom a..b, top shifted by h (clamped)
      const ta = Math.min(len, a + h);
      const tb = Math.min(len, b + h);
      if (ta >= tb) continue;
      this.poly(M, [[a, 0, 0], [b, 0, 0], [tb, h, 0], [ta, h, 0]], y, [0, 0, 1]);
    }
  }
  toGeometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.N, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.C, 3));
    g.setAttribute('aRM', new THREE.Float32BufferAttribute(this.R, 2));
    g.setIndex(this.count > 65535 ? new THREE.Uint32BufferAttribute(this.I, 1) : new THREE.Uint16BufferAttribute(this.I, 1));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    return g;
  }
}

// the stencil font (3 x 5, rows top to bottom)
const FONT = {
  ' ': ['...', '...', '...', '...', '...'],
  '-': ['...', '...', '###', '...', '...'],
  '.': ['...', '...', '...', '...', '.#.'],
  '/': ['..#', '..#', '.#.', '#..', '#..'],
  A: ['.#.', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['.##', '#..', '#..', '#..', '.##'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  F: ['###', '#..', '##.', '#..', '#..'],
  G: ['.##', '#..', '#.#', '#.#', '.##'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  I: ['###', '.#.', '.#.', '.#.', '###'],
  J: ['..#', '..#', '..#', '#.#', '.#.'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  M: ['#.#', '###', '###', '#.#', '#.#'],
  N: ['##.', '#.#', '#.#', '#.#', '#.#'],
  O: ['.#.', '#.#', '#.#', '#.#', '.#.'],
  P: ['##.', '#.#', '##.', '#..', '#..'],
  Q: ['.#.', '#.#', '#.#', '##.', '.##'],
  R: ['##.', '#.#', '##.', '#.#', '#.#'],
  S: ['.##', '#..', '.#.', '..#', '##.'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  W: ['#.#', '#.#', '###', '###', '#.#'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  0: ['###', '#.#', '#.#', '#.#', '###'],
  1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['##.', '..#', '.#.', '#..', '###'],
  3: ['##.', '..#', '.#.', '..#', '##.'],
  4: ['#.#', '#.#', '###', '..#', '..#'],
  5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'],
  7: ['###', '..#', '.#.', '.#.', '.#.'],
  8: ['###', '#.#', '###', '#.#', '###'],
  9: ['###', '#.#', '###', '..#', '##.'],
};

// ---------------------------------------------------------------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------------------------------------------------------------

/** The lit kit material: vertex colours, per-vertex roughness / metalness (aRM), the shared look. No texture. */
function makeLit(name) {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 1, envMapIntensity: 0.6 });
  mat.name = name;
  patchMaterial(mat, { lit: true, grade: true, wetK: 0 });
  const base = mat.onBeforeCompile;
  const baseKey = String(mat.customProgramCacheKey());
  mat.onBeforeCompile = (shader, renderer) => {
    base(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aRM;\nvarying vec2 vFkRM;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vFkRM = aRM;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFkRM;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n  roughnessFactor *= vFkRM.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n  metalnessFactor *= vFkRM.y;');
  };
  mat.customProgramCacheKey = () => baseKey + '|fk-rm';
  return mat;
}
/** LEDs / screens: unlit vertex colours, scaled by .color (setLights). */
function makeGlow(name) {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.name = name;
  mat.userData.base = 1.6;
  mat.color.setScalar(mat.userData.base);
  return mat;
}
/** Additive light volumes (beam cone, scan fan): vertex colours carry the falloff, opacity the intensity. */
function makeAdd(name, opacity) {
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false, opacity });
  mat.name = name;
  mat.userData.base = opacity;
  return mat;
}
function makeTint(name, color, opacity) {
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, vertexColors: true, side: THREE.DoubleSide });
  mat.name = name;
  return mat;
}

function meshOf(m, mat, name) {
  const mesh = new THREE.Mesh(m.toGeometry(), mat);
  mesh.name = name;
  mesh.userData.tris = m.tris;
  return mesh;
}

/** Triangles and draw calls under a node (visible meshes only unless all). */
export function kitStats(root, all = false) {
  let tris = 0;
  let calls = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (!all) {
      let p = o;
      while (p) {
        if (!p.visible) return;
        p = p.parent;
      }
    }
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
    calls++;
  });
  return { tris, calls };
}

function disposeTree(root) {
  const seen = new Set();
  root.traverse((o) => {
    if (o.geometry && !seen.has(o.geometry)) {
      seen.add(o.geometry);
      o.geometry.dispose();
    }
    const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
    for (const m of mats) {
      if (seen.has(m)) continue;
      seen.add(m);
      if (m.map) m.map.dispose();
      m.dispose();
    }
  });
  if (root.parent) root.parent.remove(root);
}

const _tc = new THREE.Color();

// ---------------------------------------------------------------------------------------------------------------------------------
// HOIST DRONE
// ---------------------------------------------------------------------------------------------------------------------------------

const DUCT_PROFILE = [
  [0.165, -0.045],
  [0.178, -0.05],
  [0.192, -0.043],
  [0.197, 0.018],
  [0.206, 0.04],
  [0.192, 0.053],
  [0.17, 0.047],
  [0.163, 0.03],
];
const DUCT_PROFILE_LO = [
  [0.165, -0.048],
  [0.196, -0.044],
  [0.204, 0.045],
  [0.165, 0.045],
];
const DUCTS = [
  [-0.42, -0.42],
  [0.42, -0.42],
  [0.42, 0.42],
  [-0.42, 0.42],
]; // front-left, front-right, rear-right, rear-left (nose -Z)

/**
 * One HOIST DRONE. opts.lod 0 (<= 4 k tris) / 1 (<= 900 tris); opts.index 0..3 gives the serial HD-42-0n and its own grime.
 * @returns {THREE.Group}
 */
export function buildDrone(opts = {}) {
  const lod = opts.lod ? 1 : 0;
  const hi = lod === 0;
  const index = opts.index | 0;
  const seed = 0x5eed + index * 101;
  const hull = new Mesher(seed);
  const glow = new Mesher(seed);
  const D = FACILITY.drone;

  // --- fuselage: graphite lower body, white top shell, spine, nose sensor, battery pack, tail tabs
  if (hi) {
    hull.cbox(T(0, -0.02, 0), 0.36, 0.08, 0.5, 0.025, { c: COL.carbon, rm: RM.carbon });
    hull.cbox(T(0, 0.045, 0.01), 0.32, 0.06, 0.44, 0.022, { c: COL.white, rm: RM.composite, g: 1.2 });
    hull.cbox(T(0, 0.085, 0.03), 0.08, 0.026, 0.3, 0.01, { c: COL.carbon, rm: RM.carbon });
    hull.geo(T(0, -0.01, -0.235, -PI / 2, 0, 0, [1, 0.7, 1]), new THREE.SphereGeometry(0.05, 10, 5, 0, TAU, 0, PI / 2), { c: COL.carbon, rm: [0.3, 0.2] }); // the nose sensor dome
    hull.cbox(T(0, -0.085, 0.03), 0.24, 0.05, 0.28, 0.015, { c: COL.grey, rm: RM.composite });
    hull.box(T(-0.08, 0.035, 0.255), 0.05, 0.03, 0.04, { c: COL.orange, rm: RM.paint });
    hull.box(T(0.08, 0.035, 0.255), 0.05, 0.03, 0.04, { c: COL.orange, rm: RM.paint });
    // vents on the top shell (dark slots)
    for (let i = 0; i < 4; i++) hull.box(T(0, 0.0765, 0.13 + i * 0.022), 0.14, 0.004, 0.008, { c: COL.black, rm: RM.rubber, g: 0 });
    // serials on both flanks + a NO STEP on the shell
    for (const s of [-1, 1]) hull.stencil(T(s * 0.1805, -0.02, 0, 0, (s * PI) / 2, 0), 'HD-42-0' + (index + 1), 0.0062, { c: COL.stencil });
    hull.stencil(T(0, 0.0752, -0.11, -PI / 2, 0, 0), 'NO STEP', 0.005, { c: COL.stencil });
  } else {
    hull.box(T(0, -0.02, 0), 0.36, 0.08, 0.5, { c: COL.carbon, rm: RM.carbon });
    hull.box(T(0, 0.045, 0.01), 0.32, 0.05, 0.44, { c: COL.white, rm: RM.composite });
    hull.box(T(0, -0.085, 0.03), 0.24, 0.05, 0.28, { c: COL.grey, rm: RM.composite });
  }

  // --- arms and ducts
  for (let i = 0; i < 4; i++) {
    const [dx, dz] = DUCTS[i];
    const ry = Math.atan2(dx, dz);
    const L = Math.hypot(dx, dz) - 0.2 - 0.16; // from the body edge to the duct's outer wall (never into the blades' disc)
    // the arm runs along local +Z of its frame, starting at the body (0.16 from the centre)
    const M = mul(T(0, 0, 0, 0, ry, 0), T(0, 0, 0.16 + L / 2, PI / 2, 0, 0));
    if (hi) hull.tbox(M, 0.07, 0.045, 0.05, 0.035, L + 0.02, { c: COL.carbon, rm: RM.carbon });
    else hull.box(M, 0.06, L + 0.02, 0.04, { c: COL.carbon, rm: RM.carbon });
    const DM = T(dx, 0, dz);
    hull.sweep(DM, hi ? DUCT_PROFILE : DUCT_PROFILE_LO, hi ? 18 : 7, { c: COL.white, rm: RM.composite, g: 1.1 });
    if (hi) {
      // a graphite band round the shroud, the motor bell, three stator vanes, the duct's mount boss
      hull.sweep(DM, [[0.198, -0.012], [0.2, 0.004]], 18, { c: COL.carbon, rm: RM.carbon }, false);
      hull.cyl(T(dx, -0.012, dz), 0.034, 0.038, 0.04, 12, { c: COL.gun, rm: RM.metal });
      for (let v = 0; v < 3; v++) {
        const a = ry + PI + (v * TAU) / 3;
        hull.box(mul(T(dx, -0.026, dz, 0, a, 0), T(0, 0, 0.1)), 0.012, 0.026, 0.13, { c: COL.gun, rm: RM.metal });
      }
      hull.cbox(mul(T(dx, 0, dz, 0, ry, 0), T(0, -0.002, -0.2)), 0.06, 0.05, 0.04, 0.01, { c: COL.carbon, rm: RM.carbon });
    } else {
      hull.cyl(T(dx, -0.012, dz), 0.036, 0.036, 0.04, 6, { c: COL.gun, rm: RM.metal }, true);
    }
    // nav pips on the outer side of each duct: port (x < 0) red, starboard green, stern white bands
    const out = ry; // the direction from the body to the duct
    const pip = i < 2 ? (dx < 0 ? 0xff3a2a : 0x3aff7a) : 0xd8ecff;
    glow.box(mul(T(dx, 0.006, dz, 0, out, 0), T(0, 0, 0.203)), hi ? 0.028 : 0.04, 0.014, 0.006, { c: pip, g: 0 });
  }

  // --- winch (drum under the belly, axis X) + cable + the spine status bar + scanner bar + the work light lens
  hull.cyl(T(0, -0.16, 0.03, 0, 0, PI / 2), 0.048, 0.048, 0.15, hi ? 14 : 6, { c: COL.rubber, rm: RM.rubber, g: 0.4 });
  if (hi) {
    for (const s of [-1, 1]) {
      hull.cyl(T(s * 0.082, -0.16, 0.03, 0, 0, PI / 2), 0.062, 0.062, 0.012, 14, { c: COL.gun, rm: RM.metal });
      hull.box(T(s * 0.1, -0.135, 0.03), 0.014, 0.06, 0.06, { c: COL.carbon, rm: RM.carbon });
    }
    hull.cyl(T(0, -0.16, 0.03, 0, 0, PI / 2), 0.02, 0.02, 0.22, 8, { c: COL.steel, rm: RM.steel });
    // the work-light housing (the beam's apex) and the scanner bar under the nose
    hull.cyl(T(0, -0.09, -0.13), 0.034, 0.03, 0.07, 12, { c: COL.carbon, rm: RM.carbon });
    hull.box(T(0, -0.05, -0.262), 0.15, 0.022, 0.024, { c: COL.carbon, rm: RM.carbon });
  }
  hull.cyl(T(0, -0.225, 0.03), 0.0055, 0.0055, 0.11, hi ? 6 : 4, { c: COL.black, rm: RM.steel, g: 0 }); // the cable down to the clamp head
  const statusStart = glow.count;
  glow.box(T(0, 0.0995, 0.0), 0.03, 0.004, hi ? 0.12 : 0.1, { c: 0x5fe0ff, g: 0 });
  const statusEnd = glow.count;
  if (hi) {
    glow.box(T(0, -0.05, -0.2745), 0.12, 0.008, 0.002, { c: 0x3aa8c8, g: 0 }); // the scanner window
    glow.cyl(T(0, -0.1255, -0.13), 0.026, 0.026, 0.002, 12, { c: 0xd8ecff, g: 0 }); // the work light lens
    glow.box(T(0, 0.03, 0.275), 0.06, 0.012, 0.004, { c: 0xd8ecff, g: 0 }); // stern light
  } else {
    glow.cyl(T(0, -0.13, -0.13), 0.026, 0.026, 0.002, 6, { c: 0xd8ecff, g: 0 });
  }

  const mats = { lit: makeLit('facility-drone'), glow: makeGlow('facility-drone-led'), add: makeAdd('facility-drone-beam', 0.3), scan: makeAdd('facility-drone-scan', 0.55), blur: makeTint('facility-drone-blur', 0xffffff, 0.42) };
  const group = new THREE.Group();
  group.name = 'AT3D-hoist-drone';
  group.userData.facility = 'drone';
  const hullMesh = meshOf(hull, mats.lit, 'drone-hull');
  group.add(hullMesh);

  // --- the clamp head (a group at the cable's end) + two jaws hinged about X
  const clamp = new THREE.Group();
  clamp.name = 'clamp';
  clamp.position.set(0, -0.29, 0.03);
  const head = new Mesher(seed ^ 7);
  head.cbox(T(0, 0, 0), 0.12, 0.06, 0.09, hi ? 0.012 : 0.001, { c: COL.yellow, rm: RM.paint, g: 1.3 });
  if (hi) {
    for (const s of [-1, 1]) head.stripes(T(-0.06 * s, -0.03, s * 0.0452, 0, s < 0 ? PI : 0, 0), 0.12, 0.06, 0.03, {});
    head.box(T(0, 0.036, 0), 0.03, 0.012, 0.03, { c: COL.gun, rm: RM.metal }); // the cable socket
    head.cyl(T(0, -0.03, 0, 0, 0, PI / 2), 0.008, 0.008, 0.13, 6, { c: COL.steel, rm: RM.steel }); // the hinge pin
  }
  const headMesh = meshOf(head, mats.lit, 'clamp-head');
  clamp.add(headMesh);
  const jawM = new Mesher(seed ^ 11);
  // the jaw in its hinge frame (hinge at the origin, the jaw on +Z, hooking inward under the ring bar)
  jawM.box(T(0, -0.04, 0.03), 0.07, 0.08, 0.012, { c: COL.gun, rm: RM.metal });
  jawM.box(T(0, -0.076, 0.014), 0.07, 0.012, 0.036, { c: COL.steel, rm: RM.steel });
  if (hi) jawM.box(T(0, -0.069, 0.0), 0.06, 0.004, 0.008, { c: COL.rubber, rm: RM.rubber, g: 0 }); // the pad
  const jawGeo = jawM.toGeometry();
  const jawA = new THREE.Mesh(jawGeo, mats.lit);
  jawA.name = 'jaw-a';
  jawA.position.set(0, -0.03, 0);
  const jawB = new THREE.Mesh(jawGeo, mats.lit);
  jawB.name = 'jaw-b';
  jawB.position.set(0, -0.03, 0);
  jawB.rotation.set(0, PI, 0);
  clamp.add(jawA, jawB);
  clamp.jaws = [jawA, jawB];
  group.add(clamp);

  // --- rotors: blades (lit) and the blur disc (translucent), shared geometry
  const bl = new Mesher(seed ^ 13);
  const nb = hi ? 3 : 2;
  for (let b = 0; b < nb; b++) {
    const a = (b * TAU) / nb;
    const M = T(0, 0, 0, 0, a, 0);
    const r0 = 0.028;
    const r1 = 0.158;
    const p0 = 0.32;
    const p1 = 0.12;
    // a blade section at radius r: the chord (z, half width w) and the thickness (y, half t) pitched by p about the blade axis (x)
    const sec = (r, w, t, p) => {
      const c = Math.cos(p);
      const s = Math.sin(p);
      return [[-t, -w], [-t, w], [t, w], [t, -w]].map(([yy, zz]) => [r, yy * c - zz * s, yy * s + zz * c]);
    };
    if (hi) {
      bl.hexa(M, sec(r0, 0.017, 0.004, p0), sec(r1 - 0.02, 0.013, 0.002, p1), { c: COL.carbon, rm: RM.carbon });
      bl.hexa(M, sec(r1 - 0.02, 0.013, 0.002, p1), sec(r1, 0.011, 0.002, p1), { c: COL.paintW, rm: RM.paint, g: 0.4 });
    } else {
      bl.hexa(M, sec(r0, 0.017, 0.004, p0), sec(r1, 0.012, 0.002, p1), { c: COL.carbon, rm: RM.carbon });
    }
  }
  bl.cyl(T(0, 0.004, 0), 0.02, 0.03, 0.022, hi ? 10 : 6, { c: COL.carbon, rm: RM.carbon });
  const bladeGeo = bl.toGeometry();
  const bm = new Mesher(seed ^ 17);
  const ring = (r0, r1, c) => bm.ann(I4, r0, r1, 0, TAU, 0, hi ? 18 : 8, { c, g: 0 });
  ring(0.03, hi ? 0.135 : 0.158, 0x22252a);
  if (hi) ring(0.135, 0.158, 0x6b6c66);
  const blurGeo = bm.toGeometry();
  const rotors = [];
  for (let i = 0; i < 4; i++) {
    const r = new THREE.Group();
    r.name = 'rotor' + i;
    r.position.set(DUCTS[i][0], 0.012, DUCTS[i][1]);
    r.rotation.y = i * 0.7; // phase
    const blades = new THREE.Mesh(bladeGeo, mats.lit);
    blades.name = 'blades';
    const blur = new THREE.Mesh(blurGeo, mats.blur);
    blur.name = 'blur';
    blur.visible = false;
    blur.renderOrder = 2;
    r.add(blades, blur);
    r.blades = blades;
    r.blur = blur;
    r.userData.dir = i % 2 === 0 ? 1 : -1; // diagonal pairs counter-rotate
    rotors.push(r);
    group.add(r);
  }

  // --- LEDs
  const status = meshOf(glow, mats.glow, 'status');
  group.add(status);

  // --- the beam: two nested open cones from the lens down -Y (vertex colours: bright at the apex, black at the far end)
  const beamM = new Mesher(seed);
  const cone = (len, rad, seg, ci) => {
    const g = new THREE.CylinderGeometry(0.03, rad, len, seg, hi ? 3 : 1, true);
    g.translate(0, -len / 2, 0);
    const pa = g.attributes.position;
    const col = new Float32Array(pa.count * 3);
    for (let i = 0; i < pa.count; i++) {
      const t = Math.min(1, -pa.getY(i) / len);
      const f = Math.pow(1 - t, 1.6) * ci;
      col[i * 3] = 0.62 * f;
      col[i * 3 + 1] = 0.72 * f;
      col[i * 3 + 2] = 0.85 * f;
    }
    const base = beamM.count;
    for (let i = 0; i < pa.count; i++) {
      beamM.P.push(pa.getX(i), pa.getY(i) - 0.13, pa.getZ(i) - 0.13);
      beamM.N.push(0, -1, 0);
      beamM.C.push(col[i * 3], col[i * 3 + 1], col[i * 3 + 2]);
      beamM.R.push(1, 0);
    }
    for (let i = 0; i < g.index.count; i++) beamM.I.push(base + g.index.getX(i));
    g.dispose();
  };
  cone(7, 1.7, hi ? 16 : 8, 0.45);
  cone(6, 0.75, hi ? 12 : 6, 0.8);
  const beam = meshOf(beamM, mats.add, 'beam');
  beam.visible = false;
  beam.renderOrder = 5;
  beam.frustumCulled = false;

  // --- the scan fan: a vertical sheet across X from the scanner bar, fanned +-38 degrees about -Y, with brighter scan lines
  const scanM = new Mesher(seed);
  const NS = hi ? 24 : 12;
  const LEN = 5.5;
  for (let s = 0; s < NS; s++) {
    const a0 = -0.66 + (1.32 * s) / NS;
    const a1 = -0.66 + (1.32 * (s + 1)) / NS;
    const line = s % 4 === 0 ? 1 : 0.35;
    const base = scanM.count;
    const pts = [[0, 0, 0, 1], [Math.sin(a0) * LEN, -Math.cos(a0) * LEN, 0, 0], [Math.sin(a1) * LEN, -Math.cos(a1) * LEN, 0, 0]];
    for (const [x, y, z, f] of pts) {
      scanM.P.push(x, y, z);
      scanM.N.push(0, 0, 1);
      const k = (0.15 + 0.85 * f) * line;
      scanM.C.push(0.2 * k, 0.75 * k, 1.0 * k);
      scanM.R.push(1, 0);
    }
    scanM.I.push(base, base + 1, base + 2);
  }
  const scan = meshOf(scanM, mats.scan, 'scan');
  scan.position.set(0, -0.05, -0.27);
  scan.visible = false;
  scan.renderOrder = 6;
  scan.frustumCulled = false;
  group.add(beam, scan);

  group.rotors = rotors;
  group.clamp = clamp;
  group.lights = { beam, status };
  group.scan = scan;
  group.lod = lod;
  group.index = index;
  group.clampPoint = { x: 0, y: D.clampY, z: 0.03 };
  group.materials = mats;

  let phase = 0;
  let spin = 0;
  group.setClamp = (k) => {
    const a = Math.max(0, Math.min(1, k)) * 1.1;
    jawA.rotation.x = -a;
    jawB.rotation.x = a;
  };
  group.setLights = (k) => {
    const v = Math.max(0, k);
    mats.glow.color.setScalar(mats.glow.userData.base * v);
    status.visible = v > 0.001;
  };
  group.setBeam = (k) => {
    mats.add.opacity = mats.add.userData.base * Math.max(0, k);
    beam.visible = k > 0.001;
  };
  group.setScan = (k, sweep) => {
    mats.scan.opacity = mats.scan.userData.base * Math.max(0, k);
    scan.visible = k > 0.001;
    if (sweep !== undefined) scan.rotation.x = sweep;
  };
  const col = status.geometry.attributes.color;
  group.setStatus = (hex) => {
    _tc.setHex(hex);
    for (let i = statusStart; i < statusEnd; i++) col.setXYZ(i, _tc.r, _tc.g, _tc.b);
    col.needsUpdate = true;
  };
  group.setSpin = (k) => {
    spin = Math.max(0, k);
  };
  /** state (all optional): { spin 0..1, clamp 0..1, lights 0..1, beam 0..1, scan 0..1, sweep rad }. No allocation. */
  group.update = (dt, state) => {
    if (state) {
      if (state.spin !== undefined) spin = Math.max(0, state.spin);
      if (state.clamp !== undefined) group.setClamp(state.clamp);
      if (state.lights !== undefined) group.setLights(state.lights);
      if (state.beam !== undefined) group.setBeam(state.beam);
      if (state.scan !== undefined) group.setScan(state.scan, state.sweep);
    }
    phase = (phase + dt * spin * D.rotorRps * TAU) % TAU;
    const fast = spin > 0.55;
    for (let i = 0; i < 4; i++) {
      const r = rotors[i];
      r.rotation.y = i * 0.7 + phase * r.userData.dir;
      r.blades.visible = !fast;
      r.blur.visible = fast;
    }
  };
  group.dispose = () => disposeTree(group);
  group.setClamp(0);
  return group;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// CRADLE
// ---------------------------------------------------------------------------------------------------------------------------------

const SCREEN_W = 256;
const SCREEN_H = 128;
const FONT_MONO = "'DejaVu Sans Mono', 'Menlo', 'Consolas', 'Liberation Mono', monospace";

function drawScreen(ctx, text) {
  ctx.fillStyle = '#030709';
  ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  // header bar
  ctx.fillStyle = '#0b2a33';
  ctx.fillRect(0, 0, SCREEN_W, 22);
  ctx.fillStyle = '#5fd6f0';
  ctx.font = `bold 13px ${FONT_MONO}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('E-42  HOIST CRADLE', 8, 11);
  ctx.textAlign = 'right';
  ctx.fillText('LINK OK', SCREEN_W - 8, 11);
  // the text: lines split on \n; a line that does not fit is broken at its middots, then shrunk
  const raw = String(text == null ? '' : text).split('\n');
  const lines = [];
  ctx.font = `bold 18px ${FONT_MONO}`;
  for (const l of raw) {
    if (ctx.measureText(l).width > SCREEN_W - 16 && l.includes('·')) for (const p of l.split('·')) lines.push(p.trim());
    else lines.push(l);
  }
  const n = Math.max(1, Math.min(5, lines.length));
  let size = Math.min(22, Math.floor(96 / n) - 2);
  ctx.textAlign = 'left';
  ctx.fillStyle = '#8fefff';
  for (let i = 0; i < n; i++) {
    let s = size;
    ctx.font = `bold ${s}px ${FONT_MONO}`;
    while (ctx.measureText(lines[i]).width > SCREEN_W - 16 && s > 9) {
      s--;
      ctx.font = `bold ${s}px ${FONT_MONO}`;
    }
    ctx.fillText(lines[i], 8, 30 + (96 / n) * (i + 0.5));
  }
  // scan lines
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  for (let y = 0; y < SCREEN_H; y += 3) ctx.fillRect(0, y, SCREEN_W, 1);
}

/** The CRADLE. Origin = the top of the floor grating. @returns {THREE.Group} */
export function buildCradle(opts = {}) {
  const C = FACILITY.cradle;
  const seed = 0xc7ad1e ^ ((opts.seed | 0) * 31);
  const fr = new Mesher(seed);
  const glow = new Mesher(seed);
  const h = C.floor / 2; // 0.8
  const pp = h - 0.025; // post centres

  // --- skids + the perimeter channel + the grating (bearing bars along Z, cross rods along X)
  for (const s of [-1, 1]) fr.box(T(s * 0.55, -0.075, 0), 0.08, 0.09, C.floor + 0.1, { c: COL.carbon, rm: RM.carbon });
  for (const s of [-1, 1]) {
    fr.box(T(0, -0.02, s * (h - 0.02)), C.floor, 0.04, 0.04, { c: COL.gun, rm: RM.metal });
    fr.box(T(s * (h - 0.02), -0.02, 0), 0.04, 0.04, C.floor - 0.08, { c: COL.gun, rm: RM.metal });
  }
  for (let x = -h + 0.06; x <= h - 0.05; x += 0.04) fr.box(T(x, -0.016, 0), 0.006, 0.032, C.floor - 0.08, { c: COL.gun, rm: RM.metal, g: 1.3, gs: 1.4 });
  for (let z = -h + 0.1; z <= h - 0.08; z += 0.1) fr.box(T(0, -0.004, z), C.floor - 0.08, 0.008, 0.008, { c: COL.steel, rm: RM.steel, g: 1.2 });

  // --- kick plates with hazard stripes inside and out (the -Z side too: the gate swings above it)
  for (let side = 0; side < 4; side++) {
    const ry = (side * PI) / 2;
    const M = T(0, 0, 0, 0, ry, 0);
    fr.box(mul(M, T(0, 0.075, h - 0.01)), C.floor - 0.1, 0.15, 0.008, { c: COL.black, rm: RM.paint });
    fr.stripes(mul(M, T((C.floor - 0.1) / 2, 0.0, h - 0.0145, 0, PI, 0)), C.floor - 0.1, 0.15, 0.1, {}); // inside (faces the centre)
    fr.stripes(mul(M, T(-(C.floor - 0.1) / 2, 0.0, h - 0.0055, 0, 0, 0)), C.floor - 0.1, 0.15, 0.1, {});
  }

  // --- corner posts, rails (the -Z side is the gate), the top frame and the spreader X
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    fr.cbox(T(sx * pp, (C.top - 0.1) / 2, sz * pp), 0.05, C.top + 0.1, 0.05, 0.008, { c: COL.carbon, rm: RM.carbon });
    fr.box(T(sx * pp, -0.005, sz * pp), 0.09, 0.01, 0.09, { c: COL.gun, rm: RM.metal }); // base plate
  }
  for (let side = 0; side < 3; side++) {
    // +X, +Z, -X
    const ry = [PI / 2, 0, -PI / 2][side];
    const M = T(0, 0, 0, 0, ry, 0);
    for (const y of [C.rail, 0.55]) fr.cyl(mul(M, T(0, y, pp, 0, 0, PI / 2)), 0.021, 0.021, C.floor - 0.06, 8, { c: y === C.rail ? COL.steel : COL.gun, rm: y === C.rail ? RM.steel : RM.metal, g: 0.8 });
  }
  for (let side = 0; side < 4; side++) fr.box(mul(T(0, 0, 0, 0, (side * PI) / 2, 0), T(0, C.top, pp)), C.floor - 0.02, 0.05, 0.04, { c: COL.carbon, rm: RM.carbon });
  const diag = C.anchorXZ * Math.SQRT2 * 2 + 0.12;
  for (const a of [PI / 4, -PI / 4]) {
    fr.cbox(T(0, C.top + 0.04, 0, 0, a, 0), 0.09, 0.07, diag, 0.012, { c: COL.white, rm: RM.composite, g: 1.2 });
    fr.box(T(0, C.top + 0.0755, 0, 0, a, 0), 0.04, 0.002, diag - 0.4, { c: COL.yellow, rm: RM.paint, g: 0.8 });
  }
  fr.cbox(T(0, C.top + 0.04, 0), 0.22, 0.09, 0.22, 0.02, { c: COL.carbon, rm: RM.carbon }); // the hub
  fr.stencil(T(0, C.top + 0.0875, 0.0, -PI / 2, 0, 0), 'E-42', 0.012, { c: COL.paintW });
  // a ceiling lamp under the hub (glow) so the cage is lit from above in the dark
  glow.box(T(0, C.top - 0.012, 0), 0.16, 0.006, 0.16, { c: 0xd8ecff, g: 0 });
  // lift rings (vertical, axis Z: the drones' jaws come from +-Z and hook under the top bar) on shackle blocks
  const anchors = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const x = sx * C.anchorXZ;
    const z = sz * C.anchorXZ;
    const ringR = 0.058;
    const tube = 0.012;
    const cy = C.anchorY - ringR;
    fr.cbox(T(x, C.top + 0.06, z, 0, PI / 4, 0), 0.08, 0.06, 0.08, 0.012, { c: COL.gun, rm: RM.metal });
    fr.geo(T(x, cy, z), new THREE.TorusGeometry(ringR, tube, 6, 14), { c: COL.orange, rm: RM.paint, g: 1.2 });
    anchors.push({ x, y: C.anchorY, z });
    // a cold pip on each shackle: the clamp targets
    glow.box(T(x + sx * 0.041, C.top + 0.06, z + sz * 0.041, 0, PI / 4, 0), 0.02, 0.012, 0.004, { c: 0x5fe0ff, g: 0 });
  }

  // --- the console on the +X rail near the gate corner: a post, a tilted panel, the screen, a few lit keys, LINE 42
  const cx = pp + 0.02; // on the rail: the panel leans in to ~0.7 m from the centre, at hand height
  const cz = -0.42;
  fr.box(T(cx + 0.04, 0.45, cz), 0.04, 0.9, 0.04, { c: COL.carbon, rm: RM.carbon });
  const PM = mul(T(cx, 1.02, cz, 0, -PI / 2, 0), T(0, 0, 0, -0.6, 0, 0)); // the panel faces -X (into the cage), tipped up
  fr.cbox(PM, 0.3, 0.22, 0.045, 0.01, { c: COL.white, rm: RM.composite, g: 1.1 });
  fr.box(mul(PM, T(0, 0.025, 0.0235)), 0.2, 0.13, 0.003, { c: COL.black, rm: RM.glass, g: 0 }); // the bezel
  fr.stencil(mul(PM, T(0, -0.08, 0.0232)), 'LINE 42', 0.0055, { c: COL.stencil });
  for (let k = 0; k < 4; k++) glow.box(mul(PM, T(-0.105 + k * 0.022, -0.085, 0.024)), 0.012, 0.008, 0.003, { c: k === 3 ? 0xff3a2a : k === 0 ? 0x3aff7a : 0xffb040, g: 0 });
  fr.box(mul(PM, T(0.115, -0.07, 0.03)), 0.03, 0.04, 0.014, { c: COL.yellow, rm: RM.paint }); // the guarded release switch

  // --- the rope spool bracket (static) on the -X rail
  const sxp = -pp - 0.12;
  fr.box(T(-pp - 0.015, 0.8, 0.15), 0.012, 0.42, 0.05, { c: COL.gun, rm: RM.metal }); // the inner cheek plate on the rail
  fr.box(T(sxp - 0.12, 0.8, 0.15), 0.012, 0.42, 0.05, { c: COL.gun, rm: RM.metal }); // the outer cheek plate
  fr.box(T(sxp - 0.06, 1.0, 0.15), 0.13, 0.03, 0.05, { c: COL.gun, rm: RM.metal }); // the bridge over the drum

  const mats = { lit: makeLit('facility-cradle'), glow: makeGlow('facility-cradle-led'), screen: new THREE.MeshBasicMaterial({ color: 0xffffff }) };
  mats.screen.name = 'facility-cradle-screen';
  const group = new THREE.Group();
  group.name = 'AT3D-cradle';
  group.userData.facility = 'cradle';
  group.add(meshOf(fr, mats.lit, 'cradle-frame'));

  // the spool (turns about X): drum + rope wraps + orange flanges + a cold LED ring on its outer flange
  const sp = new Mesher(seed ^ 3);
  const spGlow = new Mesher(seed ^ 3);
  sp.cyl(T(0, 0, 0, 0, 0, PI / 2), 0.1, 0.1, 0.17, 16, { c: COL.rope, rm: RM.rubber, g: 0.7, gs: 3 });
  for (let k = 0; k < 5; k++) sp.cyl(T(-0.068 + k * 0.034, 0, 0, 0, 0, PI / 2), 0.103, 0.103, 0.012, 16, { c: k % 2 ? 0x7a2a22 : COL.rope, rm: RM.rubber, g: 0.6 });
  for (const s of [-1, 1]) sp.cyl(T(s * 0.092, 0, 0, 0, 0, PI / 2), 0.15, 0.15, 0.014, 20, { c: COL.orange, rm: RM.paint, g: 1.1 });
  sp.cyl(T(0, 0, 0, 0, 0, PI / 2), 0.022, 0.022, 0.24, 8, { c: COL.steel, rm: RM.steel });
  spGlow.ann(T(-0.1, 0, 0, 0, 0, PI / 2), 0.118, 0.13, 0, TAU, 0, 20, { c: 0x5fe0ff, g: 0 }, true);
  const spool = new THREE.Group();
  spool.name = 'spool';
  spool.position.set(sxp - 0.0, 0.78, 0.15);
  spool.add(meshOf(sp, mats.lit, 'spool-drum'));
  spool.add(meshOf(spGlow, mats.glow, 'spool-led'));
  group.add(spool);

  // the gate (-Z side): two bars on a hinge at the -X post; opens outward (rotation.y)
  const gt = new Mesher(seed ^ 5);
  const gl = C.floor - 0.08;
  for (const y of [C.rail, 0.55]) gt.cyl(T(gl / 2 + 0.02, y, 0, 0, 0, PI / 2), 0.02, 0.02, gl, 8, { c: y === C.rail ? COL.yellow : COL.gun, rm: y === C.rail ? RM.paint : RM.metal });
  gt.box(T(gl + 0.01, (C.rail + 0.55) / 2, 0), 0.03, C.rail - 0.5, 0.03, { c: COL.gun, rm: RM.metal }); // the latch stile
  gt.box(T(0.02, (C.rail + 0.55) / 2, 0), 0.03, C.rail - 0.45, 0.04, { c: COL.gun, rm: RM.metal }); // the hinge stile
  const gate = new THREE.Group();
  gate.name = 'gate';
  gate.position.set(-pp, 0, -pp);
  gate.add(meshOf(gt, mats.lit, 'gate-bars'));
  group.add(gate);

  group.add(meshOf(glow, mats.glow, 'cradle-led'));

  // the screen: a plane on the panel face with a canvas texture (null in Node / without a document)
  const screenGeo = new THREE.PlaneGeometry(0.18, 0.11);
  const screen = new THREE.Mesh(screenGeo, mats.screen);
  screen.name = 'screen';
  screen.applyMatrix4(mul(PM, T(0, 0.025, 0.0255)));
  group.add(screen);
  const cnv = typeof document !== 'undefined' && document.createElement ? document.createElement('canvas') : null;
  let ctx = null;
  if (cnv) {
    cnv.width = SCREEN_W;
    cnv.height = SCREEN_H;
    ctx = cnv.getContext('2d');
    const tex = new THREE.CanvasTexture(cnv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    mats.screen.map = tex;
  } else {
    mats.screen.color.setHex(0x0b2a33);
  }
  group.screen = screen;
  group.screenText = '';
  group.screenSetText = (text) => {
    group.screenText = String(text == null ? '' : text);
    if (!ctx) return false;
    drawScreen(ctx, group.screenText);
    mats.screen.map.needsUpdate = true;
    return true;
  };
  group.screenSetText(opts.text != null ? opts.text : 'LINE 42 · PAYLOAD 1 · RETURN 0');

  group.anchors = anchors;
  group.spool = spool;
  group.gate = gate;
  group.floorY = 0;
  group.eyeHeight = C.eye;
  group.materials = mats;
  group.setLights = (k) => {
    const v = Math.max(0, k);
    mats.glow.color.setScalar(mats.glow.userData.base * v);
    mats.screen.color.setScalar(mats.screen.map ? Math.min(1, 0.15 + v) : 0.2);
  };
  group.setGate = (k) => {
    gate.rotation.y = Math.max(0, Math.min(1, k)) * 1.45;
  };
  /** state (optional): { spool rad/s (rope paying out), lights 0..1, gate 0..1 }. No allocation. */
  group.update = (dt, state) => {
    if (!state) return;
    if (state.spool !== undefined) spool.rotation.x = (spool.rotation.x + dt * state.spool) % TAU;
    if (state.lights !== undefined) group.setLights(state.lights);
    if (state.gate !== undefined) group.setGate(state.gate);
  };
  group.dispose = () => {
    if (mats.screen.map) mats.screen.map.dispose();
    disposeTree(group);
  };
  return group;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// THE COLLAR
// ---------------------------------------------------------------------------------------------------------------------------------

/** The cradle's bearing on the deck (rad, x-z plane): the launch bay is built round it. */
const DESCENT_A = Math.atan2(FACILITY.descent.z, FACILITY.descent.x);
const PAD_R = 21.6;
const PAD_A = [-33, -11, 11, 33].map((d) => DESCENT_A + (d * PI) / 180);

/**
 * THE COLLAR: the station round the shaft mouth, in world space.
 * @returns {{group: THREE.Group, dronePads: {x:number,y:number,z:number,yaw:number}[], cageAnchor: {x,y,z}, irisCenter: {x,y,z},
 *   irisLeaves: {index:number, angle:number, dirX:number, dirZ:number, offset:number, halfAngle:number, radius:number}[],
 *   lights: object[], setIris: (k:number) => void, setLights: (k:number) => void, update: (dt:number, state?:object) => void,
 *   dispose: () => void, meshes: object, tris: number, drawCalls: number}}
 */
export function buildCollar(opts = {}) {
  const F = FACILITY;
  const seed = 0xc011a5 ^ (opts.seed | 0);
  const sh = new Mesher(seed);
  const glow = new Mesher(seed);
  const scr = new Mesher(seed);
  const glass = new Mesher(seed);
  const Y = F.deckY;
  const RW = F.hallRadius;
  const NS = 20; // hall sides
  const sideA = TAU / NS;

  // ---- the stone mouth: a carved rim course over the chimney's top, from the 22 m square out to r 16.4 (square hole, round rim)
  {
    const N = 64;
    const sq = F.shaftHalf - 0.05;
    const inner = (a) => {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const k = sq / Math.max(Math.abs(c), Math.abs(s));
      return [c * k, s * k];
    };
    for (let i = 0; i < N; i++) {
      const a0 = (i * TAU) / N;
      const a1 = ((i + 1) * TAU) / N;
      const p0 = inner(a0);
      const p1 = inner(a1);
      const ro = F.stoneOuter;
      const blk = { c: i % 3 === 0 ? COL.stoneB : COL.stone, rm: RM.stone, g: 1.4, gs: 0.8 };
      sh.poly(I4, [[p0[0], F.stoneCapY, p0[1]], [ro * Math.cos(a0), F.stoneCapY, ro * Math.sin(a0)], [ro * Math.cos(a1), F.stoneCapY, ro * Math.sin(a1)], [p1[0], F.stoneCapY, p1[1]]], blk, [0, 1, 0]);
      sh.poly(I4, [[p0[0], F.stoneCapY, p0[1]], [p1[0], F.stoneCapY, p1[1]], [p1[0], F.collarY - 0.02, p1[1]], [p0[0], F.collarY - 0.02, p0[1]]], blk, [-Math.cos((a0 + a1) / 2), 0, -Math.sin((a0 + a1) / 2)]);
    }
    // a carved groove ring and glyph blocks on the rim (the old stone has its own marks)
    // (outside the square's corners: its half diagonal is 15.49)
    sh.ann(I4, 15.58, 15.78, 0, TAU, F.stoneCapY + 0.004, 48, { c: 0x0e0d0c, rm: RM.stone, g: 0.5 });
    for (let i = 0; i < 16; i++) {
      const a = ((i + 0.5) * TAU) / 16;
      sh.box(T(16.05 * Math.cos(a), F.stoneCapY, 16.05 * Math.sin(a), 0, -a, 0), 0.3, 0.06, 0.5, { c: COL.stoneB, rm: RM.stone, g: 1.2 });
    }
  }

  // ---- the collar ring at the aperture lip: steel, a hazard band on its top, an LED lip strip, bolts
  sh.sweep(I4, [[F.irisRadius, F.irisTopY + 0.03], [F.ringOuter, F.irisTopY + 0.03], [F.ringOuter, Y + 0.18], [F.ringOuter - 0.15, Y + 0.25], [F.irisRadius + 0.12, Y + 0.25], [F.irisRadius, Y + 0.16]], 72, { c: COL.gun, rm: RM.metal, g: 1.2 });
  {
    const N = 96;
    for (let i = 0; i < N; i++) {
      const a0 = (i * TAU) / N;
      const a1 = ((i + 1) * TAU) / N;
      const r0 = F.irisRadius + 0.25;
      const r1 = F.ringOuter - 0.25;
      const sl = 0.18; // the slant: the outer edge leads the inner one
      sh.poly(I4, [[r0 * Math.cos(a0), Y + 0.252, r0 * Math.sin(a0)], [r1 * Math.cos(a0 + sl / r1), Y + 0.252, r1 * Math.sin(a0 + sl / r1)], [r1 * Math.cos(a1 + sl / r1), Y + 0.252, r1 * Math.sin(a1 + sl / r1)], [r0 * Math.cos(a1), Y + 0.252, r0 * Math.sin(a1)]], { c: i % 2 ? COL.yellow : COL.black, rm: RM.paint, g: 1.4 }, [0, 1, 0]);
    }
    glow.sweep(I4, [[F.irisRadius - 0.005, Y + 0.12], [F.irisRadius - 0.005, Y + 0.15]], 96, { c: 0xd8ecff, g: 0 }, false);
    for (let i = 0; i < 48; i++) {
      const a = (i * TAU) / 48;
      sh.cyl(T(17.0 * Math.cos(a), Y + 0.262, 17.0 * Math.sin(a), 0, 0, 0), 0.03, 0.03, 0.03, 6, { c: COL.steel, rm: RM.steel, g: 0.8 });
    }
  }

  // ---- the deck: plates from the ring to the wall, a painted ring of hazard paint, a yellow lane, big stencils
  {
    const rings = [F.ringOuter, 20.5, 24, 27.5, 31, RW];
    for (let j = 0; j < rings.length - 1; j++)
      for (let i = 0; i < 40; i++) {
        const a0 = (i * TAU) / 40;
        const a1 = ((i + 1) * TAU) / 40;
        const tone = 0.86 + 0.14 * hash3(i, j, 3, seed);
        sh.ann(I4, rings[j], rings[j + 1], a0, a1, Y, 1, { c: (i + j) % 2 ? COL.deck : COL.deckB, rm: [0.72, 0.15], g: 1.3, k: tone });
      }
    // the walkway lanes (dashed yellow) at r 25.2 and the keep-clear ring around the cradle stand
    for (let i = 0; i < 64; i += 2) sh.ann(I4, 25.1, 25.3, (i * TAU) / 64, ((i + 1.2) * TAU) / 64, Y + 0.004, 2, { c: COL.yellow, rm: RM.paint, g: 1.5 });
    sh.stencil(T(0, Y + 0.004, -24.5, -PI / 2, 0, 0), 'E-42', 0.42, { c: COL.paintW, g: 1.6 });
    sh.stencil(T(23.5 * Math.cos(DESCENT_A + PI), Y + 0.004, 23.5 * Math.sin(DESCENT_A + PI), -PI / 2, 0, 0), 'COLLAR', 0.3, { c: COL.paintW, g: 1.6 });
  }

  // ---- the iris (its own mesh: setIris rewrites its positions)
  const ir = new Mesher(seed ^ 0x1515);
  const leafRanges = [];
  const irisLeaves = [];
  {
    const n = F.irisLeaves;
    const hA = PI / n;
    const R = F.irisLeafRadius;
    const gap = 0.018;
    const yb = F.irisBottomY;
    const yt = F.irisTopY;
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) * hA * 2;
      const M = T(0, 0, 0, 0, -a, 0); // local +X = the bisector
      const start = ir.count;
      // the leaf outline in local x-z: apex (offset sides meet), the two sides, the outer arc
      const ax = gap / Math.sin(hA);
      const outline = [[ax, 0]];
      const NA = 6;
      for (let s = 0; s <= NA; s++) {
        const t = -hA + (2 * hA * s) / NA;
        // the arc's end points are pulled onto the side lines offset inward by the gap
        const end = s === 0 || s === NA;
        outline.push([R * Math.cos(t), R * Math.sin(t) - (end ? Math.sign(t) * (gap / Math.cos(hA)) : 0)]);
      }
      const top = outline.map(([x, z]) => [x, yt, z]);
      const bot = outline.map(([x, z]) => [x, yb, z]);
      const polys = [top, bot.slice().reverse()];
      for (let k = 0; k < outline.length; k++) {
        const k2 = (k + 1) % outline.length;
        polys.push([top[k], top[k2], bot[k2], bot[k]]);
      }
      ir.convex(M, polys, { c: 0x3c3f42, rm: [0.55, 0.35], g: 1.4, gs: 0.7 });
      // hazard bands at the apex (concentric across all leaves when closed)
      const band = (x0, x1, c) => {
        const w0 = x0 * Math.tan(hA) - gap / Math.cos(hA) - 0.01;
        const w1 = x1 * Math.tan(hA) - gap / Math.cos(hA) - 0.01;
        if (w1 <= 0) return;
        ir.poly(M, [[x0, yt + 0.003, -Math.max(0, w0)], [x1, yt + 0.003, -w1], [x1, yt + 0.003, w1], [x0, yt + 0.003, Math.max(0, w0)]], { c, rm: RM.paint, g: 1.3 }, [0, 1, 0]);
      };
      for (let b = 0; b < 6; b++) band(0.25 + b * 0.38, 0.25 + (b + 1) * 0.38, b % 2 ? COL.black : COL.yellow);
      // the ribs: one along the bisector, two across; the gasket strips along the sides
      ir.box(mul(M, T(9.6, yt + 0.04, 0)), 12.6, 0.08, 0.14, { c: 0x4a4d50, rm: RM.metal, g: 1.2 });
      for (const x of [7.5, 12.5]) ir.box(mul(M, T(x, yt + 0.03, 0)), 0.14, 0.06, 2 * (x * Math.tan(hA) - 0.25), { c: 0x4a4d50, rm: RM.metal, g: 1.2 });
      for (const s of [-1, 1]) {
        const e0 = 3;
        const e1 = R - 0.6;
        const w = (x) => s * (x * Math.tan(hA) - gap / Math.cos(hA) - 0.04);
        ir.poly(M, [[e0, yt + 0.002, w(e0)], [e1, yt + 0.002, w(e1)], [e1, yt + 0.002, w(e1) - s * 0.06], [e0, yt + 0.002, w(e0) - s * 0.06]], { c: COL.rubber, rm: RM.rubber, g: 0 }, [0, 1, 0]);
      }
      ir.stencil(mul(M, T(14.6, yt + 0.004, 0, -PI / 2, 0, -PI / 2)), String(i + 1), 0.16, { c: COL.paintW, g: 1.4 });
      leafRanges.push([start, ir.count]);
      irisLeaves.push({ index: i, angle: a, dirX: Math.cos(a), dirZ: Math.sin(a), offset: 0, halfAngle: hA, radius: R, gap });
    }
  }

  // ---- the gantry ring: two chords, verticals and diagonals, 8 columns, an LED strip under the bottom chord
  {
    const GR = F.gantryRadius;
    const yb = F.gantryY;
    const yt = yb + 1.3;
    for (const y of [yb, yt]) sh.sweep(I4, [[GR - 0.35, y - 0.2], [GR + 0.35, y - 0.2], [GR + 0.35, y + 0.2], [GR - 0.35, y + 0.2]], 48, { c: COL.carbon, rm: RM.carbon, g: 1.1 });
    const NG = 32;
    for (let i = 0; i < NG; i++) {
      const a = (i * TAU) / NG;
      const a2 = ((i + 1) * TAU) / NG;
      sh.box(T(GR * Math.cos(a), (yb + yt) / 2, GR * Math.sin(a), 0, -a, 0), 0.18, 1.0, 0.18, { c: COL.carbon, rm: RM.carbon });
      // the diagonal from this vertical's foot to the next one's head
      const x0 = GR * Math.cos(a);
      const z0 = GR * Math.sin(a);
      const x1 = GR * Math.cos(a2);
      const z1 = GR * Math.sin(a2);
      const len = Math.hypot(x1 - x0, z1 - z0, yt - yb - 0.4);
      const dir = new THREE.Vector3(x1 - x0, yt - yb - 0.4, z1 - z0).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const m = new THREE.Matrix4().compose(new THREE.Vector3((x0 + x1) / 2, (yb + yt) / 2, (z0 + z1) / 2), q, new THREE.Vector3(1, 1, 1));
      sh.box(m, 0.1, len, 0.1, { c: COL.gun, rm: RM.metal });
    }
    glow.ann(I4, GR - 0.22, GR + 0.22, 0, TAU, yb - 0.205, 64, { c: 0xd8ecff, g: 0 }, false);
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) * TAU) / 8;
      const x = GR * Math.cos(a);
      const z = GR * Math.sin(a);
      sh.cbox(T(x, (Y + yb) / 2, z, 0, -a, 0), 0.5, yb - Y, 0.5, 0.06, { c: COL.white, rm: RM.composite, g: 1.3 });
      sh.box(T(x, Y + 1.0, z, 0, -a, 0), 0.52, 0.3, 0.52, { c: COL.yellow, rm: RM.paint, g: 1.4 }); // the base band
      sh.box(T(x, Y + 0.03, z, 0, -a, 0), 0.9, 0.06, 0.9, { c: COL.gun, rm: RM.metal });
      sh.stencil(mul(T(x, Y + 3.2, z, 0, -a + PI / 2, 0), T(0, 0, 0.252, 0, 0, PI / 2)), 'G' + (i + 1), 0.07, { c: COL.stencil });
    }
  }

  // ---- the hall wall: 20 sides, banded panels with seams, ribs, two hangar doors, an LED strip at +12, cable trays at +3
  const wallPt = (a, y, r = RW) => [r * Math.cos(a), y, r * Math.sin(a)];
  for (let i = 0; i < NS; i++) {
    const a0 = i * sideA;
    const a1 = (i + 1) * sideA;
    const am = (a0 + a1) / 2;
    const inward = [-Math.cos(am), 0, -Math.sin(am)];
    const band = (y0, y1, c, rm, g = 1.2, ra = a0, rb = a1) => sh.poly(I4, [wallPt(ra, y0), wallPt(rb, y0), wallPt(rb, y1), wallPt(ra, y1)], { c, rm, g, gs: 0.6 }, inward);
    const door = i === 0 || i === 10; // east / west hangar doors
    band(Y, Y + 3, COL.carbon, RM.carbon);
    if (door) {
      band(Y + 3, Y + 12, COL.grey, RM.composite);
    } else {
      band(Y + 3, Y + 12, COL.white, RM.composite, 1.3, a0, am - 0.002);
      band(Y + 3, Y + 12, i % 3 ? COL.white : COL.whiteDim, RM.composite, 1.3, am + 0.002, a1);
    }
    band(Y + 12.5, Y + F.hallHeight, COL.grey, RM.composite, 1.1);
    glow.poly(I4, [wallPt(a0, Y + 12.05, RW - 0.05), wallPt(a1, Y + 12.05, RW - 0.05), wallPt(a1, Y + 12.35, RW - 0.05), wallPt(a0, Y + 12.35, RW - 0.05)], { c: 0xb8d4ec, g: 0 }, inward);
    band(Y + 12, Y + 12.5, COL.carbon, RM.carbon, 0.8);
    // the rib at the side's start
    sh.box(T(...wallPt(a0, Y + F.hallHeight / 2, RW - 0.25), 0, -a0, 0), 0.5, F.hallHeight, 0.45, { c: COL.carbon, rm: RM.carbon, g: 1.1 });
    // a stencilled panel number
    if (!door) sh.stencil(mul(T(...wallPt(am, Y + 10.4, RW - 0.02), 0, -am - PI / 2, 0), T(0, 0, 0)), 'W' + String(i + 1).padStart(2, '0'), 0.12, { c: COL.stencil });
    if (door) {
      // the door leaf: proud of the wall, hazard-framed, a vision strip
      const dm = mul(T(...wallPt(am, Y + 4.5, RW - 0.15), 0, -am - PI / 2, 0), I4);
      sh.cbox(dm, 8.5, 9, 0.2, 0.05, { c: COL.whiteDim, rm: RM.composite, g: 1.4 });
      sh.stripes(mul(dm, T(-4.25, -4.5, 0.105)), 8.5, 0.5, 0.6, {});
      for (let k = 0; k < 4; k++) sh.box(mul(dm, T(0, -3 + k * 2.2, 0.11)), 8.3, 0.06, 0.04, { c: COL.gun, rm: RM.metal });
      glow.box(mul(dm, T(-3.6, 1.0, 0.115)), 0.12, 0.6, 0.01, { c: 0xffb040, g: 0 });
    }
    // the cable tray (U section) + a cable bundle
    const tr = RW - 0.6;
    const tm = T(((Math.cos(a0) + Math.cos(a1)) / 2) * tr, Y + 3.2, ((Math.sin(a0) + Math.sin(a1)) / 2) * tr, 0, -am + PI / 2, 0);
    const tl = 2 * tr * Math.sin(sideA / 2);
    sh.box(tm, tl, 0.03, 0.45, { c: COL.gun, rm: RM.metal });
    for (const s of [-1, 1]) sh.box(mul(tm, T(0, 0.08, s * 0.215)), tl, 0.16, 0.02, { c: COL.gun, rm: RM.metal });
    sh.cyl(mul(tm, T(0, 0.07, 0.02, 0, 0, PI / 2)), 0.09, 0.09, tl, 6, { c: COL.rubber, rm: RM.rubber, g: 0.5 });
    // the catwalk at +6: plate, toe board, rails, posts, a bracket
    const cr0 = RW - 1.6;
    const cy = F.catwalkY;
    if (!door && i !== 14 && i !== 15) {
      sh.poly(I4, [wallPt(a0, cy, cr0), wallPt(a0, cy, RW - 0.4), wallPt(a1, cy, RW - 0.4), wallPt(a1, cy, cr0)], { c: COL.deck, rm: RM.metal, g: 1.3 }, [0, 1, 0]);
      sh.poly(I4, [wallPt(a0, cy - 0.1, cr0), wallPt(a1, cy - 0.1, cr0), wallPt(a1, cy, cr0), wallPt(a0, cy, cr0)], { c: COL.gun, rm: RM.metal }, [Math.cos(am), 0, Math.sin(am)]);
      const cm = T(((Math.cos(a0) + Math.cos(a1)) / 2) * cr0, 0, ((Math.sin(a0) + Math.sin(a1)) / 2) * cr0, 0, -am + PI / 2, 0);
      const cl = 2 * cr0 * Math.sin(sideA / 2);
      for (const y of [cy + 1.05, cy + 0.55]) sh.box(mul(cm, T(0, y, 0)), cl, 0.05, 0.05, { c: y > cy + 1 ? COL.yellow : COL.gun, rm: y > cy + 1 ? RM.paint : RM.metal });
      sh.box(mul(cm, T(0, cy + 0.08, 0)), cl, 0.16, 0.012, { c: COL.yellow, rm: RM.paint, g: 1.3 });
      sh.box(T(...wallPt(a0, cy + 0.52, cr0), 0, -a0, 0), 0.05, 1.05, 0.05, { c: COL.gun, rm: RM.metal });
      sh.box(T(...wallPt(a0, cy - 0.6, RW - 0.9), 0, -a0, 0.0), 0.06, 1.0, 0.06, { c: COL.gun, rm: RM.metal });
    }
  }
  // the ceiling: a roof plate, 20 radial I-beams, two ring purlins, a central hoist hub, LED panels
  {
    const yc = Y + F.hallHeight;
    for (let i = 0; i < NS; i++) {
      const a0 = i * sideA;
      const a1 = (i + 1) * sideA;
      sh.poly(I4, [[0, yc, 0], wallPt(a1, yc), wallPt(a0, yc)], { c: 0x2a2c2e, rm: RM.composite, g: 1.2, gs: 0.3 }, [0, -1, 0]);
      const am = a0;
      const bm = mul(T(0, 0, 0, 0, -am, 0), T((RW + 4) / 2, yc - 0.45, 0));
      sh.box(mul(bm, T(0, 0.38, 0)), RW - 4, 0.06, 0.5, { c: COL.carbon, rm: RM.carbon });
      sh.box(bm, RW - 4, 0.8, 0.06, { c: COL.carbon, rm: RM.carbon });
      sh.box(mul(bm, T(0, -0.38, 0)), RW - 4, 0.06, 0.5, { c: COL.carbon, rm: RM.carbon });
      glow.box(mul(T(0, 0, 0, 0, -(a0 + sideA / 2), 0), T(26, yc - 0.15, 0)), 3.2, 0.05, 0.35, { c: 0xc8e0f4, g: 0 });
    }
    for (const r of [12, 24]) {
      for (let i = 0; i < NS; i++) {
        const am = (i + 0.5) * sideA;
        sh.box(T(r * Math.cos(sideA / 2) * Math.cos(am), yc - 0.6, r * Math.cos(sideA / 2) * Math.sin(am), 0, -am + PI / 2, 0), 2 * r * Math.sin(sideA / 2), 0.4, 0.25, { c: COL.gun, rm: RM.metal });
      }
    }
    sh.sweep(I4, [[3.5, yc - 1.4], [4.2, yc - 1.4], [4.2, yc], [3.5, yc]], 24, { c: COL.white, rm: RM.composite, g: 1.2 });
    glow.ann(I4, 2.2, 3.4, 0, TAU, yc - 0.6, 24, { c: 0xd8ecff, g: 0 }, false);
  }

  // ---- the launch bay: four pads with charging cradles round the descent column
  const dronePads = [];
  for (let p = 0; p < 4; p++) {
    const a = PAD_A[p];
    const x = PAD_R * Math.cos(a);
    const z = PAD_R * Math.sin(a);
    const yaw = Math.atan2(x, z); // a docked drone's nose (-Z local) points at the shaft
    const PM = T(x, Y, z, 0, yaw, 0); // pad local: -Z toward the centre
    sh.cbox(mul(PM, T(0, 0.04, 0)), 2.4, 0.08, 2.4, 0.03, { c: COL.deck, rm: [0.7, 0.2], g: 1.5 });
    for (let s = 0; s < 4; s++) sh.stripes(mul(PM, mul(T(0, 0, 0, 0, (s * PI) / 2, 0), T(-1.2, 0.081, 1.2, -PI / 2, 0, 0))), 2.4, 0.16, 0.2, { g: 1.6 });
    sh.ann(PM, 0.62, 0.7, 0, TAU, 0.0815, 24, { c: COL.paintW, rm: RM.paint, g: 1.5 });
    sh.stencil(mul(PM, T(0, 0.082, 0.88, -PI / 2, 0, PI)), 'PAD ' + (p + 1), 0.05, { c: COL.paintW, g: 1.5 });
    // the charging cradle: two uprights outside the ducts, a rear cross bar, contact arms reaching to the arms of the drone
    for (const s of [-1, 1]) {
      sh.cbox(mul(PM, T(s * 0.76, 0.08 + 0.25, 0.15)), 0.08, 0.5, 0.5, 0.015, { c: COL.white, rm: RM.composite, g: 1.3 });
      sh.box(mul(PM, T(s * 0.455, 0.42, 0.0)), 0.61, 0.03, 0.06, { c: COL.steel, rm: RM.steel }); // the contact rail under the body's edge
      glow.box(mul(PM, T(s * 0.802, 0.45, 0.3)), 0.004, 0.03, 0.06, { c: 0xffb040, g: 0 });
    }
    sh.box(mul(PM, T(0, 0.12, 0.42)), 1.6, 0.08, 0.12, { c: COL.carbon, rm: RM.carbon });
    sh.cyl(mul(PM, T(0, 0.12, 2.0, PI / 2, 0, 0)), 0.05, 0.05, 3.1, 6, { c: COL.rubber, rm: RM.rubber, g: 0.4 }); // the charge cable out to the wall tray
    dronePads.push({ x, y: Y + F.drone.dockY, z, yaw });
  }
  // a few cases and a tool cart near the bay (scale)
  for (let k = 0; k < 4; k++) {
    const a = DESCENT_A + (k - 1.5) * 0.12 + PI * 0.02;
    const r = 28.6 + (k % 2) * 0.9;
    const w = 1.1 + 0.3 * (k % 2);
    sh.cbox(T(r * Math.cos(a), Y + 0.35, r * Math.sin(a), 0, -a + 0.2 * k, 0), w, 0.7, 0.7, 0.04, { c: k === 2 ? COL.orange : COL.grey, rm: RM.composite, g: 1.4 });
    sh.box(T(r * Math.cos(a), Y + 0.705, r * Math.sin(a), 0, -a + 0.2 * k, 0), w - 0.1, 0.012, 0.08, { c: COL.black, rm: RM.rubber });
  }

  // ---- the control hall (north, -Z): a raised box room, a sloped window, three desks with screens on, three empty chairs, a cup
  {
    const yf = F.controlFloorY;
    const zf = -29; // the window line
    const zb = -RW + 0.6;
    const xh = 7;
    const hh = 3.6;
    const C0 = { c: COL.white, rm: RM.composite, g: 1.2 };
    sh.box(T(0, yf - 0.25, (zf + zb) / 2 - 0.3), 2 * xh + 0.6, 0.5, zf - zb + 0.6, { c: COL.carbon, rm: RM.carbon }); // the floor slab
    sh.box(T(0, yf + hh + 0.25, (zf + zb) / 2 - 0.3), 2 * xh + 0.6, 0.5, zf - zb + 0.6, { c: COL.carbon, rm: RM.carbon }); // the roof slab
    for (const s of [-1, 1]) sh.box(T(s * (xh + 0.15), yf + hh / 2, (zf + zb) / 2), 0.3, hh, zf - zb, C0);
    sh.poly(I4, [[-xh, yf, zb + 0.01], [xh, yf, zb + 0.01], [xh, yf + hh, zb + 0.01], [-xh, yf + hh, zb + 0.01]], { c: 0x6e706c, rm: RM.composite, g: 1 }, [0, 0, 1]); // the back wall
    sh.poly(I4, [[-xh, yf + 0.01, zb], [xh, yf + 0.01, zb], [xh, yf + 0.01, zf], [-xh, yf + 0.01, zf]], { c: 0x2a2c2d, rm: RM.rubber, g: 1 }, [0, 1, 0]); // the floor
    sh.poly(I4, [[-xh, yf + hh - 0.01, zb], [xh, yf + hh - 0.01, zb], [xh, yf + hh - 0.01, zf], [-xh, yf + hh - 0.01, zf]], { c: 0x4a4c4c, rm: RM.composite, g: 1 }, [0, -1, 0]); // the ceiling
    // the window: a sill, the sloped glass (top leans out), mullions
    const wy0 = yf + 0.12; // floor-to-ceiling, sloped: from the deck you see the desks and the chairs
    const wy1 = yf + hh - 0.15;
    const lean = 0.55;
    sh.box(T(0, yf + 0.06, zf + 0.12), 2 * xh, 0.12, 0.24, C0);
    sh.box(T(0, yf + hh - 0.07, zf + lean + 0.1), 2 * xh, 0.16, 0.3, C0);
    glass.poly(I4, [[-xh, wy0, zf], [xh, wy0, zf], [xh, wy1, zf + lean], [-xh, wy1, zf + lean]], { c: 0xffffff, g: 0 }, [0, 0, 1]);
    for (let k = 0; k <= 6; k++) {
      const x = -xh + (2 * xh * k) / 6;
      const len = Math.hypot(wy1 - wy0, lean);
      sh.box(T(x, (wy0 + wy1) / 2, zf + lean / 2 + 0.04, Math.atan2(lean, wy1 - wy0), 0, 0), 0.1, len, 0.12, { c: COL.carbon, rm: RM.carbon });
    }
    glow.box(T(0, yf + hh - 0.25, zf - 1.8), 9, 0.04, 0.2, { c: 0x6a8aa0, g: 0 }); // a dim ceiling strip
    glow.box(T(0, yf - 0.52, zf - 0.5), 12, 0.04, 0.12, { c: 0xd8ecff, g: 0 }); // under the slab
    // desks + screens + chairs
    const desks = [-4.2, 0, 4.2];
    for (let d = 0; d < 3; d++) {
      const x = desks[d];
      const z = zf - 0.75;
      sh.box(T(x, yf + 0.74, z), 2.6, 0.05, 0.8, { c: 0x3a3c3e, rm: RM.composite });
      sh.box(T(x, yf + 0.37, z - 0.3), 2.5, 0.72, 0.04, { c: COL.carbon, rm: RM.carbon });
      for (const s of [-1, 1]) sh.box(T(x + s * 1.25, yf + 0.37, z), 0.05, 0.72, 0.75, { c: COL.carbon, rm: RM.carbon });
      for (const s of [-0.6, 0.6]) {
        // a monitor on a stand, its face toward the room (+... the room is behind it: the face looks at -Z, the operators' side)
        const mm = T(x + s, yf + 1.08, z + 0.15, 0.12, PI, 0);
        sh.box(mm, 0.95, 0.56, 0.04, { c: 0x1d1f21, rm: RM.carbon });
        sh.box(T(x + s, yf + 0.86, z + 0.2), 0.06, 0.25, 0.04, { c: COL.gun, rm: RM.metal });
        scr.box(mul(mm, T(0, 0, 0.022)), 0.88, 0.49, 0.004, { c: d === 1 && s > 0 ? 0x2a6a8a : 0x184a64, g: 0 });
        // a few "lines" on the screen
        for (let l = 0; l < 5; l++) scr.box(mul(mm, T(-0.12 + 0.05 * ((l * 7 + d) % 3), 0.17 - l * 0.08, 0.025)), 0.5 - 0.08 * ((l + d) % 3), 0.025, 0.002, { c: l === 0 ? 0x8fefff : 0x4fa8c8, g: 0 });
      }
      // a chair: base star, post, seat, back. Pushed back / turned differently at each desk; nobody in them
      const cxp = x + [0.3, -0.2, 0.15][d];
      const czp = z - [1.0, 1.35, 0.95][d];
      const cyaw = [0.25, -0.6, 0.05][d];
      const cm = T(cxp, yf, czp, 0, cyaw, 0);
      for (let k = 0; k < 5; k++) sh.box(mul(cm, mul(T(0, 0.06, 0, 0, (k * TAU) / 5, 0), T(0, 0, 0.18))), 0.05, 0.04, 0.36, { c: COL.gun, rm: RM.metal });
      sh.cyl(mul(cm, T(0, 0.27, 0)), 0.025, 0.03, 0.4, 6, { c: COL.steel, rm: RM.steel });
      sh.cbox(mul(cm, T(0, 0.5, 0)), 0.5, 0.08, 0.48, 0.03, { c: 0x26282a, rm: RM.rubber });
      sh.cbox(mul(cm, T(0, 0.85, -0.25, -0.12, 0, 0)), 0.46, 0.55, 0.06, 0.03, { c: 0x26282a, rm: RM.rubber });
    }
    // the wall of displays on the back wall (seen from the deck through the glass), left on
    for (let k = -1; k <= 1; k++) {
      sh.box(T(k * 2.6, yf + 2.25, zb + 0.06), 2.4, 1.4, 0.08, { c: 0x1d1f21, rm: RM.carbon });
      scr.box(T(k * 2.6, yf + 2.25, zb + 0.105), 2.28, 1.28, 0.004, { c: k === 0 ? 0x1c5470 : 0x143c52, g: 0 });
      for (let l = 0; l < 6; l++) scr.box(T(k * 2.6 - 0.4 + 0.2 * ((l * 5 + k + 3) % 4), yf + 2.75 - l * 0.19, zb + 0.11), 1.2 - 0.2 * ((l + k + 3) % 3), 0.05, 0.002, { c: l === 0 ? 0x8fefff : 0x3f98b8, g: 0 });
    }
    // the shaft schematic on the middle display: the line from the collar down to the Threshold, a dot at the cradle
    scr.box(T(0.7, yf + 2.25, zb + 0.112), 0.03, 1.0, 0.002, { c: 0x8fefff, g: 0 });
    scr.box(T(0.7, yf + 2.6, zb + 0.114), 0.09, 0.09, 0.002, { c: 0xffb040, g: 0 });
    // the cup on the middle desk
    sh.sweep(T(0.9, yf + 0.765, zf - 0.55), [[0.0, 0], [0.04, 0], [0.045, 0.1], [0.04, 0.1], [0.035, 0.008], [0.0, 0.008]], 10, { c: COL.paintW, rm: RM.composite, g: 0.3 }, false);
    sh.box(T(0.95, yf + 0.815, zf - 0.55), 0.012, 0.05, 0.012, { c: COL.paintW, rm: RM.composite, g: 0.3 });
    glow.box(T(-xh + 0.6, yf + 1.6, zf - 0.4), 0.03, 0.2, 0.03, { c: 0xff3a2a, g: 0 }); // a red standby lamp
  }

  // ---- materials, meshes
  const mats = { lit: makeLit('facility-collar'), glow: makeGlow('facility-collar-led'), screens: makeGlow('facility-collar-screens'), glass: makeTint('facility-collar-glass', 0x0e1a20, 0.32) };
  mats.screens.userData.base = 1.25;
  mats.screens.color.setScalar(1.25);
  const group = new THREE.Group();
  group.name = 'AT3D-collar';
  group.userData.facility = 'collar';
  const shell = meshOf(sh, mats.lit, 'collar-shell');
  const iris = meshOf(ir, mats.lit, 'collar-iris');
  const glowMesh = meshOf(glow, mats.glow, 'collar-led');
  const screens = meshOf(scr, mats.screens, 'collar-screens');
  const glassMesh = meshOf(glass, mats.glass, 'collar-glass');
  glassMesh.renderOrder = 3;
  group.add(shell, iris, glowMesh, screens, glassMesh);
  // the iris' bounds cover its whole travel (it is rewritten in place)
  iris.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, F.irisTopY, 0), F.irisLeafRadius + F.irisTravel + 0.5);

  const pos = iris.geometry.attributes.position;
  pos.setUsage(THREE.DynamicDrawUsage);
  const basePos = new Float32Array(pos.array);
  let irisK = -1;
  const setIris = (k) => {
    const kk = Math.max(0, Math.min(1, k));
    if (kk === irisK) return;
    irisK = kk;
    const d = kk * F.irisTravel;
    const arr = pos.array;
    for (let i = 0; i < leafRanges.length; i++) {
      const L = irisLeaves[i];
      L.offset = d;
      const ox = L.dirX * d;
      const oz = L.dirZ * d;
      const e = leafRanges[i][1];
      for (let v = leafRanges[i][0]; v < e; v++) {
        arr[v * 3] = basePos[v * 3] + ox;
        arr[v * 3 + 2] = basePos[v * 3 + 2] + oz;
      }
    }
    pos.needsUpdate = true;
  };
  setIris(opts.iris != null ? opts.iris : 0);

  let lightsK = 1;
  const setLights = (k) => {
    lightsK = Math.max(0, k);
    mats.glow.color.setScalar(mats.glow.userData.base * lightsK);
    glowMesh.visible = lightsK > 0.001;
  };

  const lights = [
    // suggested real lights (descriptors only: the kit makes no Light). k = the share of setLights(k) they should follow.
    { name: 'gantry', type: 'point', x: F.gantryRadius * Math.cos(DESCENT_A), y: F.gantryY - 0.6, z: F.gantryRadius * Math.sin(DESCENT_A), color: 0xd8ecff, intensity: 30, distance: 34, decay: 2, k: 1 },
    { name: 'gantry-n', type: 'point', x: 0, y: F.gantryY - 0.6, z: -F.gantryRadius, color: 0xd8ecff, intensity: 22, distance: 30, decay: 2, k: 1 },
    { name: 'column', type: 'spot', x: F.descent.x, y: Y + F.hallHeight - 1, z: F.descent.z, tx: F.descent.x, ty: Y, tz: F.descent.z, angle: 0.32, penumbra: 0.6, color: 0xcfe4ff, intensity: 260, distance: 40, decay: 2, k: 1 },
    { name: 'control', type: 'point', x: 0, y: F.controlFloorY + 1.4, z: -30.2, color: 0x7fc8ec, intensity: 3, distance: 9, decay: 2, k: 0.2 },
    ...dronePads.map((p, i) => ({ name: 'pad' + (i + 1), type: 'point', x: p.x, y: Y + 0.6, z: p.z, color: 0xffb040, intensity: 1.2, distance: 4, decay: 2, k: 1 })),
    { name: 'fill', type: 'hemi', sky: 0x8aa0b4, ground: 0x101214, intensity: 0.22, k: 1 },
  ];

  const tri = sh.tris + ir.tris + glow.tris + scr.tris + glass.tris;
  return {
    group,
    meshes: { shell, iris, glow: glowMesh, screens, glass: glassMesh },
    materials: mats,
    dronePads,
    cageAnchor: { x: F.descent.x, y: F.irisTopY + F.cradle.skid, z: F.descent.z },
    irisCenter: { x: 0, y: F.irisTopY, z: 0 },
    irisLeaves,
    lights,
    tris: tri,
    drawCalls: 5,
    get irisK() {
      return irisK;
    },
    get lightsK() {
      return lightsK;
    },
    setIris,
    setLights,
    /** state (optional): { iris 0..1, lights 0..1 }. No allocation. */
    update(dt, state) {
      if (!state) return;
      if (state.iris !== undefined) setIris(state.iris);
      if (state.lights !== undefined) setLights(state.lights);
    },
    dispose() {
      disposeTree(group);
    },
  };
}

/** Is the point (x, z) under a leaf of the iris at its current opening? (Pure: tests, and the film's "is the way open" checks.) */
export function irisCovers(leaves, x, z) {
  for (let i = 0; i < leaves.length; i++) {
    const L = leaves[i];
    const px = x - L.dirX * L.offset;
    const pz = z - L.dirZ * L.offset;
    const along = px * L.dirX + pz * L.dirZ;
    if (along <= 0) continue;
    const across = -px * L.dirZ + pz * L.dirX;
    if (Math.abs(across) <= along * Math.tan(L.halfAngle) && px * px + pz * pz <= L.radius * L.radius) return true;
  }
  return false;
}
