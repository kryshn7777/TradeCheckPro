/* ABYSSAL TETHER 3D — sceneDetailKit.js
 * Procedural low-poly geometry for the scene-dressing scatter (render/sceneDetail.js): bones and skull fragments, rubble and
 * stone chips, broken planks / crates / barrels, rusted tools, chain lengths, rope ends, tattered banners and tags, cobwebs,
 * roots and sinew, dust-crusted stalactites, candle stubs, a bedroll, a satchel, paper, fungus.
 *
 * Pure data, no three.js and no DOM (Node-testable): every template is a run of vertices in ONE set of shared typed arrays
 * (position, normal, vertex colour, uv into the props atlas, fx = [sway, phase, glow]) plus a Uint16 index list. The view copies
 * a template into its merged draw buffer, transformed by the item's matrix (sceneDetail.js repack).
 *
 * Template space: Y up, 1 unit = 1 m. Things that lie on the ground sit on y = 0; things that hang (chains, rope, banners, roots,
 * stalactites, tags) are attached at y = 0 and extend DOWN; wall-mounted cards face +Z. Vertex colours are LINEAR albedo (the
 * atlas texture is a grain that multiplies them); `fx.x` is the sway amplitude in metres at that vertex (0 = rigid), `fx.z` an
 * emissive gain (candle flames, fungus caps).
 *
 * Budgets: every template <= 300 triangles, the whole kit < 4 k, < 20 k vertices.
 */

export const TAU = Math.PI * 2;

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer mixer: hash32(a, b, c, d) → uint32. */
export function hash32(a, b = 0, c = 0, d = 0) {
  let h = (0x811c9dc5 ^ (a | 0)) >>> 0;
  h = Math.imul(h ^ ((b | 0) + 0x9e3779b9), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ ((c | 0) + 0x7f4a7c15), 0xc2b2ae35);
  h ^= h >>> 16;
  h = Math.imul(h ^ ((d | 0) + 0x165667b1), 0x27d4eb2d);
  h ^= h >>> 15;
  return h >>> 0;
}

export function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}

// -----------------------------------------------------------------------------
// Atlas layout (the view paints the pixels; the kit only needs the cell rectangles)
// -----------------------------------------------------------------------------
/** Props atlas: 4 x 4 cells. */
export const P = { GRAIN: 0, WOOD: 1, BONE: 2, RUST: 3, ROPE: 4, CLOTH: 5, BANNER: 6, WEB: 7, PAPER: 8, TAG: 9, FIBRE: 10, WAX: 11, CAP: 12, RAG: 13, WOOD2: 14, FLAME: 15 };
/** Decal atlas: 4 x 2 cells. */
export const D = { RUST: 0, SLIME: 1, STREAK: 2, MINERAL: 3, MOSS: 4, TALLY: 5, GLOW: 6, SOOT: 7 };

const PAD = 0.006;
export function propCell(i) {
  const c = i & 3;
  const r = i >> 2;
  return [c / 4 + PAD, 1 - (r + 1) / 4 + PAD, (c + 1) / 4 - PAD, 1 - r / 4 - PAD];
}
export function decalCell(i) {
  const c = i & 3;
  const r = i >> 2;
  return [c / 4 + PAD, 1 - (r + 1) / 2 + PAD, (c + 1) / 4 - PAD, 1 - r / 2 - PAD];
}

// -----------------------------------------------------------------------------
// Palette (linear albedo)
// -----------------------------------------------------------------------------
const STONE = [0.16, 0.15, 0.135];
const STONE_D = [0.1, 0.095, 0.09];
const BONE = [0.4, 0.35, 0.27];
const BONE_D = [0.27, 0.22, 0.16];
const WOOD = [0.14, 0.095, 0.06];
const WOOD_D = [0.07, 0.05, 0.036];
const IRON = [0.07, 0.068, 0.07];
const RUSTC = [0.19, 0.085, 0.04];
const ROPEC = [0.3, 0.23, 0.14];
const CLOTH_R = [0.2, 0.06, 0.045];
const CLOTH_T = [0.07, 0.1, 0.105];
const CLOTH_C = [0.2, 0.17, 0.12];
const WAXC = [0.52, 0.47, 0.36];
const ROOTC = [0.07, 0.05, 0.035];
const SINEWC = [0.19, 0.088, 0.072];
const FUNGC = [0.07, 0.2, 0.18];
const PAPERC = [0.5, 0.45, 0.36];
const SALT = [0.4, 0.385, 0.34];
const BLACK = [0.012, 0.012, 0.012];

// -----------------------------------------------------------------------------
// Mesh builder
// -----------------------------------------------------------------------------
class MB {
  constructor(seed) {
    this.P = [];
    this.N = [];
    this.C = [];
    this.T = [];
    this.F = [];
    this.I = [];
    this.rng = mulberry32(seed);
    this.R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    this.t = [0, 0, 0];
    this.sway = null; // (x, y, z) → amplitude (m), evaluated in template space after the current transform
    this.vphase = 0;
    this.glow = 0;
  }

  /** Current transform: translate, then Ry · Rx · Rz, uniform scale s. */
  xf(tx = 0, ty = 0, tz = 0, ry = 0, rx = 0, rz = 0, s = 1) {
    const cy = Math.cos(ry);
    const sy = Math.sin(ry);
    const cx = Math.cos(rx);
    const sx = Math.sin(rx);
    const cz = Math.cos(rz);
    const sz = Math.sin(rz);
    // Rx · Rz
    const a = [cz, -sz, 0, cx * sz, cx * cz, -sx, sx * sz, sx * cz, cx];
    // Ry · (Rx Rz)
    this.R = [
      (cy * a[0] + sy * a[6]) * s, (cy * a[1] + sy * a[7]) * s, (cy * a[2] + sy * a[8]) * s,
      a[3] * s, a[4] * s, a[5] * s,
      (-sy * a[0] + cy * a[6]) * s, (-sy * a[1] + cy * a[7]) * s, (-sy * a[2] + cy * a[8]) * s,
    ];
    this.t = [tx, ty, tz];
    return this;
  }

  reset() {
    this.R = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    this.t = [0, 0, 0];
    return this;
  }

  vary(col, k = 0.14) {
    const f = 1 + (this.rng() - 0.5) * 2 * k;
    return [col[0] * f, col[1] * f, col[2] * f];
  }

  vert(x, y, z, nx, ny, nz, col, u, v) {
    const R = this.R;
    const t = this.t;
    const X = R[0] * x + R[1] * y + R[2] * z + t[0];
    const Y = R[3] * x + R[4] * y + R[5] * z + t[1];
    const Z = R[6] * x + R[7] * y + R[8] * z + t[2];
    let NX = R[0] * nx + R[1] * ny + R[2] * nz;
    let NY = R[3] * nx + R[4] * ny + R[5] * nz;
    let NZ = R[6] * nx + R[7] * ny + R[8] * nz;
    const l = Math.hypot(NX, NY, NZ) || 1;
    NX /= l;
    NY /= l;
    NZ /= l;
    this.P.push(X, Y, Z);
    this.N.push(NX, NY, NZ);
    this.C.push(col[0], col[1], col[2]);
    this.T.push(u, v);
    this.F.push(this.sway ? this.sway(X, Y, Z) : 0, this.vphase, this.glow);
    return this.P.length / 3 - 1;
  }

  /** Flat convex polygon (3 or 4 points, CCW seen from the normal side). uv: per-point [0..1,0..1] mapped into the cell rect. */
  face(pts, col, cell, uvs, outwardFrom) {
    let p = pts;
    let u = uvs;
    const a = p[0];
    const b = p[1];
    const c = p[2];
    let nx = (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]);
    let ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    let nz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    const l = Math.hypot(nx, ny, nz);
    if (l < 1e-12) return;
    nx /= l;
    ny /= l;
    nz /= l;
    if (outwardFrom) {
      const mx = (a[0] + b[0] + c[0]) / 3 - outwardFrom[0];
      const my = (a[1] + b[1] + c[1]) / 3 - outwardFrom[1];
      const mz = (a[2] + b[2] + c[2]) / 3 - outwardFrom[2];
      if (nx * mx + ny * my + nz * mz < 0) {
        p = p.slice().reverse();
        u = u ? u.slice().reverse() : u;
        nx = -nx;
        ny = -ny;
        nz = -nz;
      }
    }
    const rect = propCell(cell);
    const n = p.length;
    const base = this.P.length / 3;
    for (let i = 0; i < n; i++) {
      const uv = u ? u[i] : n === 4 ? QUV[i] : TUV[i];
      this.vert(p[i][0], p[i][1], p[i][2], nx, ny, nz, Array.isArray(col[0]) ? col[i] : col, rect[0] + (rect[2] - rect[0]) * uv[0], rect[1] + (rect[3] - rect[1]) * uv[1]);
    }
    for (let i = 1; i < n - 1; i++) this.I.push(base, base + i, base + i + 1);
  }

  /** Hexahedron from 8 corners (bit order x + 2y + 4z), each face flat. */
  hexa(c, col, cell) {
    const FACES = [[1, 3, 7, 5], [0, 4, 6, 2], [2, 6, 7, 3], [0, 1, 5, 4], [4, 5, 7, 6], [0, 2, 3, 1]];
    for (const f of FACES) {
      const pts = [c[f[0]], c[f[1]], c[f[2]], c[f[3]]];
      const e0 = Math.hypot(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1], pts[1][2] - pts[0][2]);
      const e1 = Math.hypot(pts[3][0] - pts[0][0], pts[3][1] - pts[0][1], pts[3][2] - pts[0][2]);
      this.face(pts, this.vary(col, 0.1), cell, e0 >= e1 ? null : [[0, 0], [0, 1], [1, 1], [1, 0]]);
    }
  }

  /** Axis-aligned box (centre, size), optional taper of the top (scale of x/z at +y) and corner jitter (m). */
  box(cx, cy, cz, sx, sy, sz, col, cell, o = {}) {
    const c = [];
    const tp = o.taper != null ? o.taper : 1;
    const j = o.jitter || 0;
    for (let i = 0; i < 8; i++) {
      const bx = i & 1 ? 0.5 : -0.5;
      const by = i & 2 ? 0.5 : -0.5;
      const bz = i & 4 ? 0.5 : -0.5;
      const k = by > 0 ? tp : 1;
      c.push([cx + bx * sx * k + (j ? (this.rng() - 0.5) * j : 0), cy + by * sy + (j ? (this.rng() - 0.5) * j : 0), cz + bz * sz * k + (j ? (this.rng() - 0.5) * j : 0)]);
    }
    this.hexa(c, col, cell);
  }

  /** Tube along a polyline. radii: number or per-point. Smooth normals, optional end caps, optional closed loop (repeat the first point last). */
  tube(path, radii, sides, col0, col1, cell, o = {}) {
    const n = path.length;
    const rect = propCell(cell);
    const T = [];
    for (let i = 0; i < n; i++) {
      const a = path[Math.max(0, i - 1)];
      const b = path[Math.min(n - 1, i + 1)];
      let tx = b[0] - a[0];
      let ty = b[1] - a[1];
      let tz = b[2] - a[2];
      if (o.closed && (i === 0 || i === n - 1)) {
        const p0 = path[1];
        const pe = path[n - 2];
        tx = p0[0] - pe[0];
        ty = p0[1] - pe[1];
        tz = p0[2] - pe[2];
      }
      const l = Math.hypot(tx, ty, tz) || 1;
      T.push([tx / l, ty / l, tz / l]);
    }
    // parallel transport
    let N = Math.abs(T[0][1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const frames = [];
    for (let i = 0; i < n; i++) {
      const t = T[i];
      const d = N[0] * t[0] + N[1] * t[1] + N[2] * t[2];
      let nx = N[0] - t[0] * d;
      let ny = N[1] - t[1] * d;
      let nz = N[2] - t[2] * d;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l;
      ny /= l;
      nz /= l;
      N = [nx, ny, nz];
      // B = t × N
      frames.push([N, [t[1] * nz - t[2] * ny, t[2] * nx - t[0] * nz, t[0] * ny - t[1] * nx]]);
    }
    const base = this.P.length / 3;
    const ring = sides + 1;
    for (let i = 0; i < n; i++) {
      const r = Array.isArray(radii) ? radii[i] : radii;
      const [Nn, Bn] = frames[i];
      const f = n > 1 ? i / (n - 1) : 0;
      const col = [col0[0] + (col1[0] - col0[0]) * f, col0[1] + (col1[1] - col0[1]) * f, col0[2] + (col1[2] - col0[2]) * f];
      const cj = this.vary(col, 0.06);
      for (let j = 0; j <= sides; j++) {
        const a = (j / sides) * TAU;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const dx = Nn[0] * ca + Bn[0] * sa;
        const dy = Nn[1] * ca + Bn[1] * sa;
        const dz = Nn[2] * ca + Bn[2] * sa;
        this.vert(path[i][0] + dx * r, path[i][1] + dy * r, path[i][2] + dz * r, dx, dy, dz, cj, rect[0] + (rect[2] - rect[0]) * f, rect[1] + (rect[3] - rect[1]) * (j / sides));
      }
    }
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < sides; j++) {
        const a = base + i * ring + j;
        const b = a + 1;
        const d = a + ring;
        const c = d + 1;
        this.I.push(a, b, c, a, c, d);
      }
    }
    const cap = (i, sign) => {
      const t = T[i];
      const r = Array.isArray(radii) ? radii[i] : radii;
      if (!(r > 0.0005)) return;
      const [Nn, Bn] = frames[i];
      const f = n > 1 ? i / (n - 1) : 0;
      const col = [col0[0] + (col1[0] - col0[0]) * f, col0[1] + (col1[1] - col0[1]) * f, col0[2] + (col1[2] - col0[2]) * f];
      const c0 = this.vert(path[i][0], path[i][1], path[i][2], t[0] * sign, t[1] * sign, t[2] * sign, col, 0.5 * (rect[0] + rect[2]), 0.5 * (rect[1] + rect[3]));
      const first = this.P.length / 3;
      for (let j = 0; j <= sides; j++) {
        const a = (j / sides) * TAU;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        this.vert(path[i][0] + (Nn[0] * ca + Bn[0] * sa) * r, path[i][1] + (Nn[1] * ca + Bn[1] * sa) * r, path[i][2] + (Nn[2] * ca + Bn[2] * sa) * r, t[0] * sign, t[1] * sign, t[2] * sign, col, 0.5 * (rect[0] + rect[2]), 0.5 * (rect[1] + rect[3]));
      }
      for (let j = 0; j < sides; j++) {
        if (sign > 0) this.I.push(c0, first + j, first + j + 1);
        else this.I.push(c0, first + j + 1, first + j);
      }
    };
    if (o.capEnd) cap(n - 1, 1);
    if (o.capStart) cap(0, -1);
  }

  /** Jittered icosphere with flat faces. detail 0 = 20 triangles, 1 = 80. paint(cx, cy, cz) may return a colour override. */
  blob(cx, cy, cz, rx, ry, rz, detail, jit, col, cell, paint) {
    const t = (1 + Math.sqrt(5)) / 2;
    let V = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((v) => {
      const l = Math.hypot(v[0], v[1], v[2]);
      return [v[0] / l, v[1] / l, v[2] / l];
    });
    let Fc = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
    for (let d = 0; d < detail; d++) {
      const cache = new Map();
      const mid = (a, b) => {
        const k = a < b ? a * 1000 + b : b * 1000 + a;
        let m = cache.get(k);
        if (m === undefined) {
          const p = [(V[a][0] + V[b][0]) / 2, (V[a][1] + V[b][1]) / 2, (V[a][2] + V[b][2]) / 2];
          const l = Math.hypot(p[0], p[1], p[2]);
          V.push([p[0] / l, p[1] / l, p[2] / l]);
          m = V.length - 1;
          cache.set(k, m);
        }
        return m;
      };
      const nf = [];
      for (const [a, b, c] of Fc) {
        const ab = mid(a, b);
        const bc = mid(b, c);
        const ca = mid(c, a);
        nf.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      Fc = nf;
      V = V.slice();
    }
    const jf = V.map(() => 1 + (this.rng() - 0.5) * 2 * jit);
    const pt = (i) => [cx + V[i][0] * rx * jf[i], cy + V[i][1] * ry * jf[i], cz + V[i][2] * rz * jf[i]];
    for (const f of Fc) {
      const p = [pt(f[0]), pt(f[1]), pt(f[2])];
      const mx = (p[0][0] + p[1][0] + p[2][0]) / 3;
      const my = (p[0][1] + p[1][1] + p[2][1]) / 3;
      const mz = (p[0][2] + p[1][2] + p[2][2]) / 3;
      const pc = paint ? paint((mx - cx) / rx, (my - cy) / ry, (mz - cz) / rz) : null;
      // planar uv from the dominant axis of the face centre direction
      const ax = Math.abs(mx - cx);
      const ay = Math.abs(my - cy);
      const az = Math.abs(mz - cz);
      const uvs = p.map((q) => {
        const x = (q[0] - cx) / rx;
        const y = (q[1] - cy) / ry;
        const z = (q[2] - cz) / rz;
        return ax > ay && ax > az ? [0.5 + 0.5 * z, 0.5 + 0.5 * y] : ay > az ? [0.5 + 0.5 * x, 0.5 + 0.5 * z] : [0.5 + 0.5 * x, 0.5 + 0.5 * y];
      });
      this.face(p, pc || this.vary(col, 0.12), cell, uvs, [cx, cy, cz]);
    }
  }

  /** Cone / stalactite: base ring at y0, apex at y1 (below y0 for a stalactite). */
  cone(cx, y0, cz, r, y1, sides, col0, col1, cell, o = {}) {
    const segs = o.segs || 2;
    const rings = [];
    for (let k = 0; k <= segs; k++) {
      const f = k / segs;
      const rr = r * (1 - f) * (k === segs ? 0 : 1) + (o.bulge ? Math.sin(f * Math.PI) * r * o.bulge : 0);
      const ox = (this.rng() - 0.5) * (o.kink || 0) * f;
      const oz = (this.rng() - 0.5) * (o.kink || 0) * f;
      rings.push({ y: y0 + (y1 - y0) * f, r: Math.max(0, rr), ox, oz, f });
    }
    for (let k = 0; k < segs; k++) {
      const A = rings[k];
      const B = rings[k + 1];
      for (let j = 0; j < sides; j++) {
        const a0 = (j / sides) * TAU + 0.3;
        const a1 = ((j + 1) / sides) * TAU + 0.3;
        const p00 = [cx + A.ox + Math.cos(a0) * A.r, A.y, cz + A.oz + Math.sin(a0) * A.r];
        const p01 = [cx + A.ox + Math.cos(a1) * A.r, A.y, cz + A.oz + Math.sin(a1) * A.r];
        const p10 = [cx + B.ox + Math.cos(a0) * B.r, B.y, cz + B.oz + Math.sin(a0) * B.r];
        const p11 = [cx + B.ox + Math.cos(a1) * B.r, B.y, cz + B.oz + Math.sin(a1) * B.r];
        const ca = [col0[0] + (col1[0] - col0[0]) * A.f, col0[1] + (col1[1] - col0[1]) * A.f, col0[2] + (col1[2] - col0[2]) * A.f];
        const cb = [col0[0] + (col1[0] - col0[0]) * B.f, col0[1] + (col1[1] - col0[1]) * B.f, col0[2] + (col1[2] - col0[2]) * B.f];
        const centre = [cx + A.ox * 0.5, (A.y + B.y) / 2, cz + A.oz * 0.5];
        if (B.r < 1e-5) this.face([p00, p01, p10], [ca, ca, cb], cell, [[0.2, 0.2], [0.8, 0.2], [0.5, 0.9]], centre);
        else this.face([p00, p01, p11, p10], [ca, ca, cb, cb], cell, null, centre);
      }
    }
  }

  /** Extruded polygon (points in the XZ plane), from y0 to y1. */
  extrude(poly, y0, y1, col, cell) {
    const n = poly.length;
    let cx = 0;
    let cz = 0;
    for (const p of poly) {
      cx += p[0] / n;
      cz += p[1] / n;
    }
    const centre = [cx, (y0 + y1) / 2, cz];
    const uvOf = (p) => [clamp01(0.5 + (p[0] - cx) * 0.7), clamp01(0.5 + (p[1] - cz) * 0.7)];
    const top = poly.map((p) => [p[0], y1, p[1]]);
    const bot = poly.map((p) => [p[0], y0, p[1]]);
    this.face(top, this.vary(col, 0.08), cell, poly.map(uvOf), centre);
    this.face(bot, this.vary(col, 0.08), cell, poly.map(uvOf), centre);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      this.face([bot[i], bot[j], top[j], top[i]], this.vary(col, 0.08), cell, [[0, 0], [1, 0], [1, 0.3], [0, 0.3]], centre);
    }
  }

  /** A w x h grid card (XY plane, normal +Z). top: hangs from y = 0 downward, else stands on y = 0. bend: z billow (m). */
  card(w, h, nx, ny, cell, col, o = {}) {
    const rect = propCell(cell);
    const base = this.P.length / 3;
    const y0 = o.top ? -h : 0;
    const bend = o.bend || 0;
    const cell2 = o.rect || [0, 0, 1, 1];
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const fx = i / nx;
        const fy = j / ny;
        const z = bend ? bend * Math.sin(fx * Math.PI) * (0.25 + 0.75 * (1 - fy)) * (o.top ? 1 : 0.6) : 0;
        const x = (fx - 0.5) * w;
        const y = y0 + fy * h;
        const uu = cell2[0] + (cell2[2] - cell2[0]) * fx;
        const vv = cell2[1] + (cell2[3] - cell2[1]) * fy;
        this.vert(x, y, z, 0, 0, 1, Array.isArray(col[0]) ? col[0] : col, rect[0] + (rect[2] - rect[0]) * uu, rect[1] + (rect[3] - rect[1]) * vv);
      }
    }
    const row = nx + 1;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = base + j * row + i;
        this.I.push(a, a + 1, a + row + 1, a, a + row + 1, a + row);
      }
    }
  }
}

const QUV = [[0, 0], [1, 0], [1, 1], [0, 1]];
const TUV = [[0, 0], [1, 0], [0.5, 1]];

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
/** Sway amplitude profile for something hanging from y = 0 down to y = -len. */
const hang = (len, amp) => (x, y) => amp * Math.pow(clamp01(-y / len), 1.7);

// -----------------------------------------------------------------------------
// Templates
// -----------------------------------------------------------------------------
const DEFS = [];
/** def(name, category, build(b) , meta) */
function def(name, cat, build, meta = {}) {
  DEFS.push({ name, cat, build, meta });
}

// ---- bones -------------------------------------------------------------------------------------------------------------
function femur(b, broken) {
  const L = broken ? 0.16 : 0.22;
  b.tube([[-L, 0.02, 0], [-L * 0.3, 0.024, 0.004], [L * 0.4, 0.022, -0.003], [L, 0.02, 0]], [0.011, 0.0085, 0.009, 0.012], 5, BONE, BONE, P.BONE, { capEnd: !broken, capStart: false });
  b.blob(-L - 0.004, 0.024, 0.006, 0.02, 0.019, 0.018, 0, 0.18, BONE, P.BONE);
  if (!broken) b.blob(L + 0.004, 0.024, -0.006, 0.019, 0.018, 0.017, 0, 0.18, BONE, P.BONE);
  else b.cone(L, 0.034, 0, 0.012, 0.0, 4, BONE_D, BONE_D, P.BONE, { segs: 1 }); // jagged broken end
}
def('femur', 'bone', (b) => femur(b, false));
def('femurBroken', 'bone', (b) => femur(b, true));
def('rib', 'bone', (b) => {
  const pts = [];
  const r = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 5) * 2.2 - 0.2;
    pts.push([Math.cos(a) * 0.16, 0.012 + Math.sin(a) * 0.1 * (i > 0 ? 1 : 0.3), Math.sin(a * 1.3) * 0.02]);
    r.push(0.0085 - i * 0.0009);
  }
  b.tube(pts, r, 4, BONE, BONE_D, P.BONE, { capStart: true });
});
def('skull', 'bone', (b) => {
  const paint = (x, y, z) => {
    if (z > 0.4 && y > -0.35 && y < 0.35 && Math.abs(x) > 0.18 && Math.abs(x) < 0.7) return BLACK; // eye sockets
    if (z > 0.62 && y < -0.15 && y > -0.6 && Math.abs(x) < 0.16) return BLACK; // nose
    return null;
  };
  b.blob(0, 0.07, 0, 0.075, 0.07, 0.085, 1, 0.06, BONE, P.BONE, paint);
  b.box(0, 0.032, 0.062, 0.08, 0.026, 0.05, BONE_D, P.BONE, { taper: 0.8, jitter: 0.006 }); // upper jaw
  b.box(0, 0.012, 0.05, 0.07, 0.016, 0.07, BONE_D, P.BONE, { taper: 0.9 }); // lower jaw
});
def('jaw', 'bone', (b) => {
  b.tube([[-0.04, 0.012, 0.05], [-0.045, 0.01, -0.01], [0, 0.01, -0.045], [0.045, 0.01, -0.01], [0.04, 0.012, 0.05]], 0.0075, 4, BONE, BONE, P.BONE, { capStart: true, capEnd: true });
});
def('vert', 'bone', (b) => {
  b.blob(0, 0.022, 0, 0.026, 0.02, 0.024, 0, 0.12, BONE, P.BONE);
  b.tube([[0, 0.03, 0], [0, 0.05, -0.03]], 0.007, 4, BONE, BONE, P.BONE, { capEnd: true });
  b.tube([[-0.02, 0.025, 0], [-0.05, 0.02, 0.01]], 0.006, 4, BONE, BONE_D, P.BONE, { capEnd: true });
  b.tube([[0.02, 0.025, 0], [0.05, 0.02, 0.01]], 0.006, 4, BONE, BONE_D, P.BONE, { capEnd: true });
});
def('hand', 'bone', (b) => {
  for (let i = 0; i < 4; i++) {
    const a = -0.5 + i * 0.33;
    b.tube([[0, 0.008, 0], [Math.sin(a) * 0.05, 0.007, Math.cos(a) * 0.05], [Math.sin(a) * 0.085, 0.006, Math.cos(a) * 0.085]], [0.0045, 0.0038, 0.0028], 3, BONE, BONE_D, P.BONE, { capEnd: true });
  }
  b.blob(0, 0.01, -0.01, 0.022, 0.009, 0.02, 0, 0.1, BONE, P.BONE);
});

// ---- stone -------------------------------------------------------------------------------------------------------------
const chip = (r, seedShift) => (b) => {
  for (let i = 0; i < seedShift; i++) b.rng();
  b.blob(0, r * 0.45, 0, r, r * 0.62, r * 0.9, 0, 0.3, b.vary(STONE, 0.3), P.GRAIN);
};
def('chipA', 'stone', chip(0.05, 1));
def('chipB', 'stone', chip(0.085, 4));
def('chipC', 'stone', chip(0.13, 9));
def('slabA', 'stone', (b) => b.box(0, 0.02, 0, 0.34, 0.04, 0.22, STONE, P.GRAIN, { taper: 0.85, jitter: 0.035 }));
def('slabB', 'stone', (b) => b.box(0, 0.03, 0, 0.2, 0.06, 0.26, STONE_D, P.GRAIN, { taper: 0.7, jitter: 0.04 }));
def('block', 'stone', (b) => b.blob(0, 0.1, 0, 0.19, 0.12, 0.16, 1, 0.22, STONE, P.GRAIN));

// ---- wood --------------------------------------------------------------------------------------------------------------
def('plankA', 'wood', (b) => b.extrude([[-0.45, -0.06], [0.38, -0.06], [0.46, -0.02], [0.4, 0.015], [0.47, 0.06], [-0.45, 0.06]], 0, 0.024, WOOD, P.WOOD));
def('plankB', 'wood', (b) => b.extrude([[-0.28, -0.05], [0.25, -0.05], [0.3, 0.0], [0.22, 0.05], [-0.28, 0.05]], 0, 0.02, WOOD_D, P.WOOD2));
def('plankC', 'wood', (b) => b.extrude([[-0.7, -0.07], [0.6, -0.07], [0.72, -0.03], [0.62, 0.0], [0.7, 0.07], [-0.7, 0.07]], 0, 0.028, WOOD, P.WOOD));
def('crateSmash', 'wood', (b) => {
  b.box(0, 0.01, 0, 0.5, 0.02, 0.5, WOOD_D, P.WOOD2, { jitter: 0.01 });
  for (let i = 0; i < 3; i++) b.box(-0.25 + 0.01, 0.15, -0.16 + i * 0.16, 0.018, 0.12, 0.13, WOOD, P.WOOD); // one side, slats missing
  b.box(0.0, 0.14, 0.25, 0.5, 0.02, 0.13, WOOD, P.WOOD); // front board
  b.box(0.22, 0.04, 0.0, 0.04, 0.04, 0.5, WOOD_D, P.WOOD2); // corner brace
  b.xf(0.36, 0.015, -0.3, 0.8, 0, 0.1);
  b.box(0, 0, 0, 0.42, 0.02, 0.1, WOOD, P.WOOD, { jitter: 0.008 }); // loose slat
});
def('crateBroken', 'wood', (b) => {
  b.box(0, 0.01, 0, 0.44, 0.02, 0.44, WOOD_D, P.WOOD2);
  for (const [x, z] of [[-0.2, -0.2], [0.2, -0.2], [-0.2, 0.2], [0.2, 0.2]]) b.box(x, 0.22, z, 0.04, 0.42, 0.04, WOOD_D, P.WOOD2);
  for (let k = 0; k < 3; k++) b.box(0, 0.08 + k * 0.14, 0.215, 0.4, 0.045, 0.014, k === 1 ? WOOD_D : WOOD, P.WOOD, { jitter: 0.004 });
  for (let k = 0; k < 2; k++) b.box(-0.215, 0.08 + k * 0.17, 0, 0.014, 0.05, 0.38, WOOD, P.WOOD);
});
def('barrel', 'wood', (b) => {
  const N = 10;
  for (let i = 0; i < N; i++) {
    if (i === 3 || i === 4 || i === 8) continue; // missing staves
    const a = (i / N) * TAU;
    const out = i === 5 ? 0.12 : 0;
    const pts = [];
    for (let k = 0; k <= 2; k++) {
      const y = k * 0.17 + 0.0;
      const r = 0.205 + Math.sin((k / 2) * Math.PI) * 0.03 + (k === 2 ? out : 0);
      pts.push([Math.cos(a) * r, y + (i === 6 ? -0.1 : 0) * (k === 2 ? 1 : 0), Math.sin(a) * r]);
    }
    b.tube(pts, [0.04, 0.045, 0.04], 3, WOOD, WOOD_D, P.WOOD, { capEnd: true });
  }
  const hoop = [];
  for (let i = 0; i <= 10; i++) hoop.push([Math.cos((i / 10) * TAU) * 0.235, 0.09, Math.sin((i / 10) * TAU) * 0.235]);
  b.tube(hoop, 0.009, 3, IRON, RUSTC, P.RUST, { closed: true });
  b.blob(0, 0.005, 0, 0.19, 0.01, 0.19, 0, 0.05, WOOD_D, P.WOOD2); // base disc
});

// ---- tools -------------------------------------------------------------------------------------------------------------
def('pickaxe', 'tool', (b) => {
  b.tube([[-0.38, 0.016, 0], [0, 0.02, 0], [0.38, 0.016, 0.01]], 0.014, 5, WOOD, WOOD_D, P.WOOD, { capEnd: true, capStart: true });
  b.tube([[0.34, 0.03, -0.1], [0.355, 0.034, -0.04], [0.36, 0.036, 0.05], [0.34, 0.032, 0.1]], [0.003, 0.014, 0.014, 0.003], 4, RUSTC, IRON, P.RUST, { capStart: true });
  b.box(0.355, 0.034, 0, 0.034, 0.04, 0.05, IRON, P.RUST);
});
def('crowbar', 'tool', (b) => {
  b.tube([[-0.3, 0.012, 0], [-0.1, 0.012, 0.004], [0.18, 0.012, 0], [0.27, 0.03, -0.01], [0.3, 0.07, -0.02]], 0.0095, 5, IRON, RUSTC, P.RUST, { capEnd: true, capStart: true });
});
def('hammer', 'tool', (b) => {
  b.tube([[-0.18, 0.014, 0], [0.12, 0.014, 0]], 0.012, 5, WOOD, WOOD_D, P.WOOD, { capEnd: true, capStart: true });
  b.box(0.14, 0.02, 0, 0.04, 0.05, 0.1, IRON, P.RUST);
});
def('shovel', 'tool', (b) => {
  b.tube([[-0.42, 0.014, 0], [0.15, 0.014, 0]], 0.012, 5, WOOD, WOOD_D, P.WOOD, { capEnd: true, capStart: true });
  b.xf(0.3, 0.004, 0, 0, 0, 0);
  b.extrude([[-0.16, -0.075], [0.1, -0.09], [0.2, 0], [0.1, 0.09], [-0.16, 0.075]], 0, 0.012, RUSTC, P.RUST);
  b.reset();
});
def('bucket', 'tool', (b) => {
  const N = 8;
  const top = 0.16;
  const bot = 0.12;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * TAU;
    const a1 = ((i + 1) / N) * TAU;
    const p = [[Math.cos(a0) * bot, 0, Math.sin(a0) * bot], [Math.cos(a1) * bot, 0, Math.sin(a1) * bot], [Math.cos(a1) * top, 0.2, Math.sin(a1) * top], [Math.cos(a0) * top, 0.2, Math.sin(a0) * top]];
    b.face(p, b.vary(RUSTC, 0.2), P.RUST, null, [0, 0.1, 0]);
  }
  b.blob(0, 0.01, 0, 0.12, 0.01, 0.12, 0, 0.04, IRON, P.RUST);
  const arc = [];
  for (let i = 0; i <= 6; i++) arc.push([0, 0.2 + Math.sin((i / 6) * Math.PI) * 0.12, (i / 6 - 0.5) * 0.3]);
  b.tube(arc, 0.004, 3, IRON, IRON, P.RUST, {});
});
def('cup', 'tool', (b) => {
  const N = 6;
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * TAU;
    const a1 = ((i + 1) / N) * TAU;
    b.face([[Math.cos(a0) * 0.03, 0, Math.sin(a0) * 0.03], [Math.cos(a1) * 0.03, 0, Math.sin(a1) * 0.03], [Math.cos(a1) * 0.04, 0.07, Math.sin(a1) * 0.04], [Math.cos(a0) * 0.04, 0.07, Math.sin(a0) * 0.04]], b.vary([0.17, 0.16, 0.15], 0.1), P.RUST, null, [0, 0.03, 0]);
  }
});
def('lantern', 'tool', (b) => {
  // a dead hand lantern: iron frame, cracked glass, no flame
  b.box(0, 0.015, 0, 0.12, 0.03, 0.12, IRON, P.RUST);
  b.box(0, 0.19, 0, 0.1, 0.03, 0.1, IRON, P.RUST, { taper: 0.7 });
  for (const [x, z] of [[-0.05, -0.05], [0.05, -0.05], [-0.05, 0.05], [0.05, 0.05]]) b.box(x, 0.105, z, 0.012, 0.15, 0.012, IRON, P.RUST);
  b.blob(0, 0.1, 0, 0.032, 0.05, 0.032, 0, 0.1, [0.02, 0.025, 0.025], P.GRAIN);
  const arc = [];
  for (let i = 0; i <= 6; i++) arc.push([Math.cos((i / 6) * Math.PI) * 0.05, 0.2 + Math.sin((i / 6) * Math.PI) * 0.06, 0]);
  b.tube(arc, 0.004, 3, IRON, IRON, P.RUST, {});
});

// ---- hanging -----------------------------------------------------------------------------------------------------------
function chainLinks(b, n, o = {}) {
  const pitch = 0.052;
  b.sway = hang(n * pitch, o.amp || 0.035);
  b.box(0, 0.01, 0, 0.05, 0.02, 0.03, IRON, P.RUST); // staple
  for (let i = 0; i < n; i++) {
    const ry = (i & 1) * (Math.PI / 2);
    const loop = [];
    for (let k = 0; k <= 6; k++) {
      const a = (k / 6) * TAU;
      loop.push([Math.cos(a) * 0.012, Math.sin(a) * 0.03, 0]);
    }
    b.xf(0, -0.024 - i * pitch, 0, ry);
    b.tube(loop, 0.0062, 3, i > n - 3 ? RUSTC : IRON, i > n - 3 ? RUSTC : IRON, P.RUST, { closed: true });
  }
  b.reset();
}
def('chain4', 'chain', (b) => chainLinks(b, 4, { amp: 0.03 }), { hang: true });
def('chain7', 'chain', (b) => chainLinks(b, 7, { amp: 0.045 }), { hang: true });
def('ropeHang', 'rope', (b) => {
  b.sway = hang(1.3, 0.07);
  b.blob(0, 0.0, 0, 0.034, 0.03, 0.034, 0, 0.18, ROPEC, P.ROPE); // knot round the beam
  const pts = [];
  const rad = [];
  let x = 0;
  let z = 0;
  for (let i = 0; i <= 7; i++) {
    x += (b.rng() - 0.5) * 0.04;
    z += (b.rng() - 0.5) * 0.04;
    pts.push([x, -0.02 - i * 0.17, z]);
    rad.push(i === 7 ? 0.012 : 0.0155);
  }
  b.tube(pts, rad, 5, ROPEC, [0.2, 0.15, 0.09], P.ROPE, {});
  const e = pts[7];
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU + 0.4;
    b.tube([[e[0], e[1], e[2]], [e[0] + Math.cos(a) * 0.03, e[1] - 0.06, e[2] + Math.sin(a) * 0.03], [e[0] + Math.cos(a) * 0.07, e[1] - 0.1, e[2] + Math.sin(a) * 0.07]], [0.007, 0.004, 0.0015], 3, [0.22, 0.17, 0.1], [0.3, 0.24, 0.15], P.ROPE, {});
  }
}, { hang: true });
def('rootHang', 'root', (b) => {
  b.sway = hang(1.1, 0.05);
  const trunk = [];
  const rad = [];
  let x = 0;
  for (let i = 0; i <= 6; i++) {
    x += (b.rng() - 0.35) * 0.05;
    trunk.push([x, -i * 0.17, (b.rng() - 0.5) * 0.04]);
    rad.push(0.022 * (1 - i / 7.5) + 0.002);
  }
  b.tube(trunk, rad, 4, ROOTC, [0.1, 0.07, 0.05], P.FIBRE, {});
  for (let k = 0; k < 2; k++) {
    const s = trunk[2 + k];
    const dir = k ? 1 : -1;
    b.tube([s, [s[0] + dir * 0.05, s[1] - 0.1, s[2]], [s[0] + dir * 0.1, s[1] - 0.26, s[2] + 0.02], [s[0] + dir * 0.12, s[1] - 0.4, s[2] + 0.03]], [0.009, 0.007, 0.004, 0.0015], 3, ROOTC, ROOTC, P.FIBRE, {});
  }
}, { hang: true });
def('sinewHang', 'sinew', (b) => {
  b.sway = hang(1.0, 0.04);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU;
    const pts = [];
    const rad = [];
    for (let i = 0; i <= 5; i++) {
      const t = i / 5;
      pts.push([Math.cos(a + t * 2.2) * 0.022 * (1 - t * 0.5), -i * 0.19, Math.sin(a + t * 2.2) * 0.022 * (1 - t * 0.5)]);
      rad.push(0.0105 * (1 - t * 0.7) + 0.002);
    }
    b.tube(pts, rad, 4, SINEWC, [0.28, 0.13, 0.1], P.FIBRE, { capEnd: true });
  }
}, { hang: true });
const stal = (r, h, kink, sides = 6) => (b) => {
  b.cone(0, 0.02, 0, r, -h, sides, SALT, [0.15, 0.13, 0.11], P.GRAIN, { segs: 2, kink, bulge: 0.12 });
};
def('stalA', 'stal', stal(0.045, 0.28, 0.02), { hang: true });
def('stalB', 'stal', stal(0.07, 0.5, 0.04, 7), { hang: true });
def('stalC', 'stal', stal(0.035, 0.16, 0.01, 5), { hang: true });
def('stalCluster', 'stal', (b) => {
  for (const [x, z, r, h] of [[0, 0, 0.06, 0.42], [0.09, 0.03, 0.04, 0.22], [-0.07, -0.05, 0.035, 0.3]]) {
    b.xf(x, 0, z);
    b.cone(0, 0.02, 0, r, -h, 6, SALT, [0.15, 0.13, 0.11], P.GRAIN, { segs: 2, kink: 0.03, bulge: 0.1 });
  }
  b.reset();
  b.blob(0.01, 0.01, 0, 0.14, 0.03, 0.1, 0, 0.2, SALT, P.GRAIN); // mineral crust at the root
}, { hang: true });
const banner = (w, h, col, cell) => (b) => {
  b.sway = (x, y) => 0.075 * Math.pow(clamp01(-y / h), 1.3);
  b.tube([[-w / 2 - 0.05, 0, 0.012], [w / 2 + 0.05, 0, 0.012]], 0.011, 5, WOOD_D, WOOD, P.WOOD2, { capEnd: true, capStart: true });
  b.card(w, h, 3, 6, cell, col, { top: true, bend: 0.05 });
};
def('banner', 'cloth', banner(0.7, 1.6, CLOTH_R, P.BANNER), { hang: true, wall: true });
def('bannerTeal', 'cloth', banner(0.55, 1.3, CLOTH_T, P.BANNER), { hang: true, wall: true });
def('bannerShort', 'cloth', banner(0.5, 0.8, CLOTH_C, P.RAG), { hang: true, wall: true });
def('rag', 'cloth', (b) => {
  b.sway = hang(0.5, 0.06);
  b.card(0.22, 0.55, 1, 4, P.RAG, CLOTH_C, { top: true, bend: 0.03 });
}, { hang: true });
def('tag', 'cloth', (b) => {
  b.sway = (x, y) => 0.06 * Math.pow(clamp01(-y / 0.3), 1.2);
  b.tube([[0, 0, 0], [0, -0.1, 0]], 0.003, 3, ROPEC, ROPEC, P.ROPE, {});
  b.xf(0, -0.1, 0);
  b.card(0.1, 0.14, 1, 1, P.TAG, [0.5, 0.45, 0.36], { top: true });
  b.reset();
  b.box(0, 0.006, 0, 0.012, 0.012, 0.012, IRON, P.RUST);
}, { hang: true, wall: true });
const webCorner = (mirror) => (b) => {
  // one sheet across a wall / ceiling corner: the corner point is the origin, the sheet fans out along +x (-x mirrored) and down the diagonal
  b.sway = (x, yy, z) => 0.014 * clamp01(Math.abs(x) * 0.9 - 0.1) * clamp01(z * 2.2) + yy * 0;
  b.xf(mirror ? -0.4 : 0.4, 0, 0, 0, -0.785, 0);
  b.card(0.8, 0.8, 4, 4, P.WEB, [0.55, 0.55, 0.55], { top: true, rect: mirror ? [1, 0, 0, 1] : [0, 0, 1, 1] });
  b.reset();
};
def('webCorner', 'web', webCorner(false), { hang: true, web: true });
def('webCornerR', 'web', webCorner(true), { hang: true, web: true });
def('webStrand', 'web', (b) => {
  b.sway = (x) => 0.02 * Math.sin(Math.PI * clamp01((x + 0.35) / 0.7));
  b.xf(0, -0.15, 0);
  b.card(0.7, 0.3, 3, 2, P.WEB, [0.5, 0.5, 0.5], {});
  b.reset();
}, { hang: true, web: true });

// ---- ground ------------------------------------------------------------------------------------------------------------
def('ropeCoil', 'rope', (b) => {
  for (let layer = 0; layer < 2; layer++) {
    const loop = [];
    for (let k = 0; k <= 8; k++) {
      const a = (k / 8) * TAU;
      loop.push([Math.cos(a) * (0.13 - layer * 0.012), 0.014 + layer * 0.022, Math.sin(a) * (0.12 - layer * 0.012)]);
    }
    b.tube(loop, 0.0125, 4, ROPEC, [0.24, 0.18, 0.11], P.ROPE, { closed: true });
  }
  b.tube([[0.12, 0.014, 0.03], [0.2, 0.012, 0.08], [0.27, 0.01, 0.07]], [0.0125, 0.011, 0.007], 4, ROPEC, [0.24, 0.18, 0.11], P.ROPE, { capEnd: true });
});
def('bedroll', 'camp', (b) => {
  b.box(0, 0.025, 0, 0.62, 0.05, 0.34, CLOTH_C, P.CLOTH, { taper: 0.92, jitter: 0.012 });
  b.tube([[-0.28, 0.07, 0.12], [-0.28, 0.07, -0.12]], 0.065, 8, [0.22, 0.14, 0.09], [0.22, 0.14, 0.09], P.CLOTH, { capEnd: true, capStart: true });
  b.tube([[-0.28, 0.1, 0.17], [-0.28, 0.1, -0.17]], 0.007, 3, ROPEC, ROPEC, P.ROPE, {});
});
def('satchel', 'camp', (b) => {
  b.box(0, 0.09, 0, 0.3, 0.17, 0.12, [0.17, 0.11, 0.07], P.CLOTH, { taper: 0.94, jitter: 0.012 });
  b.xf(0, 0.17, -0.052, 0, 0.16, 0);
  b.box(0, -0.01, 0.0, 0.3, 0.012, 0.12, [0.13, 0.085, 0.055], P.CLOTH);
  b.reset();
  b.tube([[-0.15, 0.1, 0.0], [-0.1, 0.22, 0.12], [0.12, 0.2, 0.2], [0.17, 0.09, 0.03]], 0.008, 4, ROPEC, ROPEC, P.ROPE, {});
});
const candleAt = (b, x, z, h, lit, ph) => {
  b.xf(x, 0, z);
  b.tube([[0, 0, 0], [0, h, 0]], 0.0125, 6, WAXC, [0.62, 0.57, 0.45], P.WAX, { capEnd: true });
  b.box(0.012, h * 0.7, 0, 0.008, h * 0.3, 0.006, WAXC, P.WAX);
  if (lit) {
    b.glow = 4;
    b.vphase = ph;
    b.sway = (xx, yy) => 0.004 * clamp01((yy - h) / 0.03);
    b.xf(x, h, z, 0);
    b.card(0.02, 0.04, 1, 1, P.FLAME, [1.2, 0.62, 0.22], {});
    b.xf(x, h, z, 1.5708);
    b.card(0.02, 0.04, 1, 1, P.FLAME, [1.2, 0.62, 0.22], {});
    b.glow = 0;
    b.sway = null;
    b.vphase = 0;
  }
  b.reset();
};
def('candle', 'candle', (b) => {
  b.blob(0, 0.004, 0, 0.032, 0.006, 0.03, 0, 0.18, WAXC, P.WAX);
  candleAt(b, 0, 0, 0.07, false, 0);
});
def('candleLit', 'candle', (b) => {
  b.blob(0, 0.004, 0, 0.034, 0.006, 0.03, 0, 0.18, WAXC, P.WAX);
  candleAt(b, 0, 0, 0.075, true, 0);
}, { lit: true });
def('candleCluster', 'candle', (b) => {
  b.blob(0, 0.004, 0, 0.12, 0.008, 0.1, 0, 0.2, WAXC, P.WAX);
  candleAt(b, -0.045, 0.01, 0.09, false, 0);
  candleAt(b, 0.04, -0.03, 0.05, true, 1.7);
  candleAt(b, 0.03, 0.05, 0.035, false, 0);
}, { lit: true });
def('waxPool', 'candle', (b) => {
  b.blob(0, 0.003, 0, 0.09, 0.006, 0.07, 0, 0.3, WAXC, P.WAX);
  b.blob(0.07, 0.003, 0.04, 0.035, 0.005, 0.03, 0, 0.3, WAXC, P.WAX);
});
def('fungus', 'fungus', (b) => {
  for (const [x, z, h, r] of [[0, 0, 0.08, 0.045], [0.07, 0.03, 0.05, 0.03], [-0.05, 0.05, 0.06, 0.035]]) {
    b.tube([[x, 0, z], [x + 0.004, h, z - 0.003]], 0.006, 4, [0.3, 0.3, 0.26], [0.3, 0.3, 0.26], P.CAP, { capStart: false });
    b.glow = 0.55;
    b.sway = (xx, yy) => 0.003 * clamp01(yy / h);
    b.blob(x + 0.004, h, z - 0.003, r, r * 0.45, r, 0, 0.1, FUNGC, P.CAP, (xx, yy) => (yy < -0.1 ? [0.2, 0.22, 0.2] : null));
    b.glow = 0;
    b.sway = null;
  }
});
const flat = (w, h, cell, col, curl) => (b) => {
  b.xf(0, 0.004, 0, 0, -Math.PI / 2, 0);
  b.card(w, h, curl ? 3 : 1, curl ? 3 : 1, cell, col, { bend: curl ? -0.025 : 0 });
  b.reset();
};
def('paperA', 'paper', flat(0.2, 0.28, P.PAPER, PAPERC, false));
def('paperB', 'paper', flat(0.15, 0.2, P.PAPER, [0.42, 0.38, 0.3], true));
def('paperCurl', 'paper', flat(0.18, 0.24, P.PAPER, [0.46, 0.42, 0.33], true));
def('ragFloor', 'cloth', flat(0.34, 0.26, P.RAG, CLOTH_C, true));

// -----------------------------------------------------------------------------
// Kit assembly
// -----------------------------------------------------------------------------
/**
 * Builds every template into shared typed arrays.
 * @returns {{
 *   pos: Float32Array, nrm: Float32Array, col: Float32Array, uv: Float32Array, fx: Float32Array, idx: Uint16Array,
 *   templates: {name:string, cat:string, v0:number, vn:number, i0:number, inn:number, tris:number, radius:number, height:number, hang:boolean, wall:boolean, web:boolean, lit:boolean}[],
 *   index: Object<string, number>, tris: number, verts: number
 * }}
 */
export function buildKit() {
  const templates = [];
  const parts = [];
  let v0 = 0;
  let i0 = 0;
  for (let k = 0; k < DEFS.length; k++) {
    const d = DEFS[k];
    const b = new MB(hash32(hashStr(d.name), 0x5ce9e));
    d.build(b);
    const vn = b.P.length / 3;
    const inn = b.I.length;
    let r = 0;
    let ymin = Infinity;
    let ymax = -Infinity;
    for (let i = 0; i < vn; i++) {
      r = Math.max(r, Math.hypot(b.P[i * 3], b.P[i * 3 + 1], b.P[i * 3 + 2]));
      ymin = Math.min(ymin, b.P[i * 3 + 1]);
      ymax = Math.max(ymax, b.P[i * 3 + 1]);
    }
    templates.push({ name: d.name, cat: d.cat, v0, vn, i0, inn, tris: inn / 3, radius: r, height: Math.max(ymax, 0) - Math.min(ymin, 0), hang: !!d.meta.hang, wall: !!d.meta.wall, web: !!d.meta.web, lit: !!d.meta.lit });
    parts.push(b);
    v0 += vn;
    i0 += inn;
  }
  const pos = new Float32Array(v0 * 3);
  const nrm = new Float32Array(v0 * 3);
  const col = new Float32Array(v0 * 3);
  const uv = new Float32Array(v0 * 2);
  const fx = new Float32Array(v0 * 3);
  const idx = new Uint16Array(i0);
  const index = Object.create(null);
  for (let k = 0; k < parts.length; k++) {
    const t = templates[k];
    const b = parts[k];
    pos.set(b.P, t.v0 * 3);
    nrm.set(b.N, t.v0 * 3);
    col.set(b.C, t.v0 * 3);
    uv.set(b.T, t.v0 * 2);
    fx.set(b.F, t.v0 * 3);
    for (let i = 0; i < b.I.length; i++) idx[t.i0 + i] = b.I[i]; // local indices: the view adds the destination base
    index[t.name] = k;
  }
  return { pos, nrm, col, uv, fx, idx, templates, index, tris: i0 / 3, verts: v0 };
}
