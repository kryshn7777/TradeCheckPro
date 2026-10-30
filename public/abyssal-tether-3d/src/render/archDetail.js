/* ABYSSAL TETHER 3D — archDetail.js
 * Architecture detail pass (MESH_DETAIL_AND_OPTIMIZATION.md §6): small, deterministic geometry builders for the level kit the player
 * touches and reads at arm's length, all merged into the existing decor lists / section packs (no new draw call, no new material,
 * texture or light, nothing per frame). Every piece is render-only: no collider, anchor, level data, kit plan or bake input changes
 * (the dressing's kit plan and decor colliders are untouched; new pieces use their own seeded RNG streams so the rest of the
 * dressing's random picks stay identical).
 *
 * Geometry convention (as levelView.js): non-indexed triangles with position / normal / color (baked AO, multiplied by the section
 * grade by the caller) — the caller adds metric UVs. Flat-shaded hard surfaces: a chamfer catches a thin highlight on its lit
 * side, which is what reads as "machined / dressed" in the headset where a sharp box edge reads as a CG primitive.
 */
import * as THREE from 'three';

/** Raw triangle soup with per-vertex normal and grey AO colour. */
export class Soup {
  constructor() {
    this.p = [];
    this.n = [];
    this.c = [];
  }

  /** One triangle; wound so its face normal points along (nx, ny, nz); per-vertex normals (smooth) when `vn` is given. */
  tri(a, b, c, nx, ny, nz, ao = [1, 1, 1], vn = null) {
    const e1x = b[0] - a[0];
    const e1y = b[1] - a[1];
    const e1z = b[2] - a[2];
    const e2x = c[0] - a[0];
    const e2y = c[1] - a[1];
    const e2z = c[2] - a[2];
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    const flip = cx * nx + cy * ny + cz * nz < 0;
    const v = flip ? [a, c, b] : [a, b, c];
    const k = flip ? [0, 2, 1] : [0, 1, 2];
    for (let i = 0; i < 3; i++) {
      this.p.push(v[i][0], v[i][1], v[i][2]);
      if (vn) this.n.push(vn[k[i]][0], vn[k[i]][1], vn[k[i]][2]);
      else this.n.push(nx, ny, nz);
      const g = ao[k[i]];
      this.c.push(g, g, g);
    }
    return this;
  }

  quad(a, b, c, d, nx, ny, nz, ao = [1, 1, 1, 1]) {
    this.tri(a, b, c, nx, ny, nz, [ao[0], ao[1], ao[2]]);
    this.tri(a, c, d, nx, ny, nz, [ao[0], ao[2], ao[3]]);
    return this;
  }

  get empty() {
    return this.p.length === 0;
  }

  get tris() {
    return this.p.length / 9;
  }

  /** Appends another soup through a column-major 4x4 (rigid + uniform-ish scale: normals by the 3x3, renormalised). */
  add(s, m) {
    const e = m ? m.elements : null;
    for (let i = 0; i < s.p.length; i += 3) {
      const x = s.p[i];
      const y = s.p[i + 1];
      const z = s.p[i + 2];
      const nx = s.n[i];
      const ny = s.n[i + 1];
      const nz = s.n[i + 2];
      if (e) {
        this.p.push(e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]);
        let ax = e[0] * nx + e[4] * ny + e[8] * nz;
        let ay = e[1] * nx + e[5] * ny + e[9] * nz;
        let az = e[2] * nx + e[6] * ny + e[10] * nz;
        const l = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
        ax /= l;
        ay /= l;
        az /= l;
        this.n.push(ax, ay, az);
      } else {
        this.p.push(x, y, z);
        this.n.push(nx, ny, nz);
      }
      this.c.push(s.c[i], s.c[i + 1], s.c[i + 2]);
    }
    return this;
  }

  /** Multiplies the AO colour by an rgb tint (the section grade). */
  tint(t) {
    if (!t) return this;
    for (let i = 0; i < this.c.length; i += 3) {
      this.c[i] *= t[0];
      this.c[i + 1] *= t[1];
      this.c[i + 2] *= t[2];
    }
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

/**
 * Chamfered box (44 triangles): centre (cx, cy, cz), size w × h × d, every edge cut at 45° by `c` metres. `ao(x, y, z)` (local,
 * relative to the centre) gives the per-vertex AO; default 1. `skip` = bit mask of main faces left out (+x −x +y −y +z −z: 1 2 4
 * 8 16 32), e.g. the face against a wall.
 */
export function chamferBox(S, cx, cy, cz, w, h, d, c, ao = null, skip = 0) {
  const hx = w / 2;
  const hy = h / 2;
  const hz = d / 2;
  c = Math.max(0.001, Math.min(c, hx * 0.45, hy * 0.45, hz * 0.45));
  const A = (x, y, z) => (ao ? ao(x, y, z) : 1);
  // corner points: P[axis] for corner (sx, sy, sz) = the corner pulled in by c along the other two axes
  const pt = (sx, sy, sz, ax) => [
    cx + sx * (ax === 0 ? hx : hx - c),
    cy + sy * (ax === 1 ? hy : hy - c),
    cz + sz * (ax === 2 ? hz : hz - c),
  ];
  const ag = (p) => A(p[0] - cx, p[1] - cy, p[2] - cz);
  const Q = (a, b, cc, dd, nx, ny, nz) => S.quad(a, b, cc, dd, nx, ny, nz, [ag(a), ag(b), ag(cc), ag(dd)]);
  // main faces
  for (const s of [1, -1]) {
    if (!(skip & (s > 0 ? 1 : 2))) Q(pt(s, -1, -1, 0), pt(s, 1, -1, 0), pt(s, 1, 1, 0), pt(s, -1, 1, 0), s, 0, 0);
    if (!(skip & (s > 0 ? 4 : 8))) Q(pt(-1, s, -1, 1), pt(1, s, -1, 1), pt(1, s, 1, 1), pt(-1, s, 1, 1), 0, s, 0);
    if (!(skip & (s > 0 ? 16 : 32))) Q(pt(-1, -1, s, 2), pt(1, -1, s, 2), pt(1, 1, s, 2), pt(-1, 1, s, 2), 0, 0, s);
  }
  // edge chamfers
  const r2 = Math.SQRT1_2;
  for (const sa of [1, -1]) {
    for (const sb of [1, -1]) {
      // along z (between x and y faces)
      Q(pt(sa, sb, -1, 0), pt(sa, sb, 1, 0), pt(sa, sb, 1, 1), pt(sa, sb, -1, 1), sa * r2, sb * r2, 0);
      // along y (between x and z faces)
      Q(pt(sa, -1, sb, 0), pt(sa, 1, sb, 0), pt(sa, 1, sb, 2), pt(sa, -1, sb, 2), sa * r2, 0, sb * r2);
      // along x (between y and z faces)
      Q(pt(-1, sa, sb, 1), pt(1, sa, sb, 1), pt(1, sa, sb, 2), pt(-1, sa, sb, 2), 0, sa * r2, sb * r2);
    }
  }
  // corner triangles
  const r3 = 1 / Math.sqrt(3);
  for (const sx of [1, -1]) for (const sy of [1, -1]) for (const sz of [1, -1]) {
    const a = pt(sx, sy, sz, 0);
    const b = pt(sx, sy, sz, 1);
    const d = pt(sx, sy, sz, 2);
    S.tri(a, b, d, sx * r3, sy * r3, sz * r3, [ag(a), ag(b), ag(d)]);
  }
  return S;
}

/**
 * A domed rivet / bolt head standing on a plane: base centre `o`, outward normal `n` (unit), radius r, height h, `sides` facets
 * (smooth normals: reads round at arm's length). `ao` darkens the foot. 2 * sides triangles (a ring and the cap).
 */
export function rivet(S, o, n, r, h, sides = 6, ao = 0.7, hex = false) {
  // a frame on the plane
  const ax = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let ux = ax[1] * n[2] - ax[2] * n[1];
  let uy = ax[2] * n[0] - ax[0] * n[2];
  let uz = ax[0] * n[1] - ax[1] * n[0];
  const ul = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const vx = n[1] * uz - n[2] * uy;
  const vy = n[2] * ux - n[0] * uz;
  const vz = n[0] * uy - n[1] * ux;
  const ring = (rr, hh) => {
    const out = [];
    for (let i = 0; i < sides; i++) {
      const a = ((i + 0.5) / sides) * Math.PI * 2;
      const ca = Math.cos(a) * rr;
      const sa = Math.sin(a) * rr;
      out.push([o[0] + ux * ca + vx * sa + n[0] * hh, o[1] + uy * ca + vy * sa + n[1] * hh, o[2] + uz * ca + vz * sa + n[2] * hh]);
    }
    return out;
  };
  const nr = (i, up) => {
    const a = ((i + 0.5) / sides) * Math.PI * 2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const k = Math.sqrt(1 - up * up);
    return [(ux * ca + vx * sa) * k + n[0] * up, (uy * ca + vy * sa) * k + n[1] * up, (uz * ca + vz * sa) * k + n[2] * up];
  };
  const base = ring(r, 0);
  const mid = ring(r * (hex ? 1 : 0.72), h * (hex ? 0.75 : 0.7));
  const top = [o[0] + n[0] * h, o[1] + n[1] * h, o[2] + n[2] * h];
  for (let i = 0; i < sides; i++) {
    const j = (i + 1) % sides;
    const fn = nr(i + 0.5, hex ? 0 : 0.35);
    // the side band (smooth for a dome, flat facets for a hex nut)
    const vn1 = hex ? null : [nr(i, 0.3), nr(j, 0.3), nr(j, 0.55)];
    S.tri(base[i], base[j], mid[j], fn[0], fn[1], fn[2], [ao, ao, 1], vn1);
    S.tri(base[i], mid[j], mid[i], fn[0], fn[1], fn[2], [ao, 1, 1], hex ? null : [nr(i, 0.3), nr(j, 0.55), nr(i, 0.55)]);
    // the cap
    const cn = hex ? [n] : [nr(i, 0.55), nr(j, 0.55), n];
    if (hex) S.tri(mid[i], mid[j], top, n[0], n[1], n[2], [1, 1, 1]);
    else S.tri(mid[i], mid[j], top, n[0], n[1], n[2], [1, 1, 1], cn);
  }
  return S;
}

/** Octagonal (or `sides`) prism bar along +Y from y0 to y1 at (x, z), radius r, flat-shaded facets, open ends (they are buried). */
export function prismY(S, x, z, y0, y1, r, sides = 8, ao0 = 1, ao1 = 1, phase = 0.5) {
  for (let i = 0; i < sides; i++) {
    const a0 = ((i + phase) / sides) * Math.PI * 2;
    const a1 = ((i + 1 + phase) / sides) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const p00 = [x + Math.cos(a0) * r, y0, z + Math.sin(a0) * r];
    const p01 = [x + Math.cos(a1) * r, y0, z + Math.sin(a1) * r];
    const p10 = [x + Math.cos(a0) * r, y1, z + Math.sin(a0) * r];
    const p11 = [x + Math.cos(a1) * r, y1, z + Math.sin(a1) * r];
    S.quad(p00, p01, p11, p10, Math.cos(am), 0, Math.sin(am), [ao0, ao0, ao1, ao1]);
  }
  return S;
}

/** Cone (spike) along −Y from a base at y0 to the point at y0 − h, `sides` facets. */
export function spikeDown(S, x, z, y0, r, h, sides = 8) {
  const tip = [x, y0 - h, z];
  const k = r / Math.sqrt(r * r + h * h);
  for (let i = 0; i < sides; i++) {
    const a0 = (i / sides) * Math.PI * 2;
    const a1 = ((i + 1) / sides) * Math.PI * 2;
    const am = (a0 + a1) / 2;
    const ny = -k;
    const nh = Math.sqrt(1 - k * k);
    S.tri([x + Math.cos(a0) * r, y0, z + Math.sin(a0) * r], [x + Math.cos(a1) * r, y0, z + Math.sin(a1) * r], tip, Math.cos(am) * nh, ny, Math.sin(am) * nh, [0.85, 0.85, 1.05]);
  }
  return S;
}

// -----------------------------------------------------------------------------
// Plaques: a carved frame with corner bosses round the plain text slab
// -----------------------------------------------------------------------------

/**
 * The frame of a carved plaque (item-local: centre at the origin, front +Z, the slab is lw × sy × ld at z −0.02 and the text plane
 * lw·0.95 × sy·0.86 floats at z = ld/2 + 0.012). Four chamfered rails just outside the text, proud of the slab, and a pyramid boss on
 * a block at each corner; the rails' feet are darker (contact AO). Returns a Soup (~350 triangles).
 */
export function plaqueFrameSoup(lw, sy, ld) {
  const S = new Soup();
  const zf = ld / 2 - 0.02; // the slab's front face
  const fw = Math.min(0.1, Math.max(0.055, Math.min(lw, sy) * 0.13));
  const ix = lw * 0.475 + 0.01;
  const iy = sy * 0.43 + 0.01;
  const ox = Math.max(lw / 2 + fw * 0.55, ix + fw);
  const oy = Math.max(sy / 2 + fw * 0.55, iy + fw);
  const z0 = zf - 0.03;
  const z1 = zf + 0.046;
  const zc = (z0 + z1) / 2;
  const dz = z1 - z0;
  const c = Math.min(0.016, fw * 0.22);
  const ao = (x, y, z) => 0.6 + 0.4 * Math.min(1, Math.max(0, (z + dz / 2) / dz));
  // top / bottom rails run the full width; the side rails fit between them
  for (const s of [1, -1]) {
    chamferBox(S, 0, s * (iy + oy) / 2, zc, ox * 2, oy - iy, dz, c, ao, 32);
    chamferBox(S, s * (ix + ox) / 2, 0, zc, ox - ix, iy * 2 + 0.002, dz * 0.86, c, ao, 32);
  }
  // corner bosses: a raised block with a four-sided pyramid (a carved stud)
  const bw = Math.min(fw * 1.25, 0.12);
  const bz1 = z1 + 0.018;
  for (const sx of [1, -1]) {
    for (const sy2 of [1, -1]) {
      const cx = sx * (ix + ox) / 2;
      const cy = sy2 * (iy + oy) / 2;
      chamferBox(S, cx, cy, (z0 + bz1) / 2, bw, bw, bz1 - z0, c * 0.9, ao, 32 | 16);
      const h = bw * 0.5 - c * 0.9;
      const tip = [cx, cy, bz1 + bw * 0.22];
      const q = [
        [cx - h, cy - h, bz1],
        [cx + h, cy - h, bz1],
        [cx + h, cy + h, bz1],
        [cx - h, cy + h, bz1],
      ];
      const pn = (a, b) => {
        const mx = (a[0] + b[0]) / 2 - cx;
        const my = (a[1] + b[1]) / 2 - cy;
        const l = Math.hypot(mx, my, bw * 0.22) || 1;
        return [mx / l, my / l, (bw * 0.22) / l + 0.6];
      };
      for (let i = 0; i < 4; i++) {
        const a = q[i];
        const b = q[(i + 1) % 4];
        const nn = pn(a, b);
        S.tri(a, b, tip, nn[0], nn[1], nn[2], [0.85, 0.85, 1.08]);
      }
    }
  }
  return S;
}

// -----------------------------------------------------------------------------
// The chamber gate (THE FITTING): forged octagonal bars, riveted cross straps, real spikes
// -----------------------------------------------------------------------------

/**
 * Gate bars filling a thin box (item-local, centred; size = [x, y, z], thin = index of the thin axis), the detailed version of
 * levelView's gateBars (same bar count and spacing, same cross straps): vertical bars as octagonal prisms, the straps chamfered with
 * a rivet where each bar passes, eight-sided spikes under the bars. Only the layout with vertical bars (the chamber gate) is
 * handled here; returns null otherwise (the caller keeps the plain bars).
 */
export function gateSoup(size, thin, spikes = false) {
  const axes = [0, 1, 2].filter((a) => a !== thin);
  const barAxis = thin !== 1 ? 1 : size[axes[0]] >= size[axes[1]] ? axes[1] : axes[0];
  if (barAxis !== 1) return null;
  const spreadAxis = axes.find((a) => a !== barAxis);
  const S = new Soup();
  const n = Math.max(2, Math.round(size[spreadAxis] / 0.32));
  const H = size[1];
  const half = size[spreadAxis] / 2;
  const T = size[thin];
  const P = (s, y, t) => {
    const p = [0, 0, 0];
    p[spreadAxis] = s;
    p[1] = y;
    p[thin] = t;
    return p;
  };
  const bars = [];
  for (let i = 0; i <= n; i++) bars.push(-half + (size[spreadAxis] * i) / n);
  // vertical bars: octagonal, a touch thicker than the old 7 cm square (same silhouette weight), darker toward the floor
  for (const s of bars) {
    const x = spreadAxis === 0 ? s : 0;
    const z = spreadAxis === 2 ? s : 0;
    prismY(S, x, z, -H / 2, H / 2, 0.04, 8, 0.72, 1);
    if (spikes) spikeDown(S, x, z, -H / 2, 0.05, 0.24, 8);
  }
  // cross straps (as gateBars: at -1, -1/3, 1/3, 1 of the height): chamfered, with a rivet each side of every bar crossing
  for (const k of [-1, -0.33, 0.33, 1]) {
    const y = (k * H) / 2;
    const big = Math.abs(k) === 1;
    const sh = big ? 0.18 : 0.08;
    const st = Math.max(0.1, T * (big ? 1 : 0.6));
    const d = [0, 0, 0];
    d[spreadAxis] = size[spreadAxis];
    d[1] = sh;
    d[thin] = st;
    chamferBox(S, 0, y, 0, d[0], d[1], d[2], big ? 0.025 : 0.014);
    for (const s of bars) {
      for (const f of [1, -1]) {
        const nrm = [0, 0, 0];
        nrm[thin] = f;
        rivet(S, P(s, y, (f * st) / 2), nrm, big ? 0.03 : 0.022, big ? 0.02 : 0.014, 6, 0.65);
      }
    }
  }
  return S;
}

// -----------------------------------------------------------------------------
// Iron: rivet rows for girders and the walkway edge plates, bolted pipe flanges, cable clamps
// -----------------------------------------------------------------------------

/** A row of rivets on a plane from a to b (world or item-local), every `step` m, normal n. */
export function rivetRow(S, a, b, n, step, r = 0.016, h = 0.011, sides = 6) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const k = Math.max(1, Math.round(L / step));
  for (let i = 0; i <= k; i++) {
    const t = k ? i / k : 0.5;
    rivet(S, [a[0] + dx * t, a[1] + dy * t, a[2] + dz * t], n, r, h, sides, 0.68);
  }
  return S;
}

/** Bolt heads round a pipe flange: centre o, pipe axis 'x' | 'y' | 'z', bolt circle radius R, flange face offset ±f along the axis. */
export function flangeBolts(S, o, axis, R, f, count = 8, r = 0.022) {
  const ai = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const u = (ai + 1) % 3;
  const v = (ai + 2) % 3;
  for (const s of [1, -1]) {
    for (let i = 0; i < count; i++) {
      const a = ((i + 0.5) / count) * Math.PI * 2;
      const p = [o[0], o[1], o[2]];
      p[u] += Math.cos(a) * R;
      p[v] += Math.sin(a) * R;
      p[ai] += s * f;
      const n = [0, 0, 0];
      n[ai] = s;
      rivet(S, p, n, r, r * 0.8, 6, 0.6, true);
    }
  }
  return S;
}

// -----------------------------------------------------------------------------
// Ledges: dressed quoins on the free vertical corners of the stone slabs
// -----------------------------------------------------------------------------

/**
 * Quoins (world space) on a slab's free vertical corner at (cx, cz); (sx, sz) = the corner's outward signs; the slab's walking
 * surface is at yTop and it is H tall. Alternating long / short chamfered blocks, 2-3 cm proud of both faces, each course a little
 * different (hand-cut), with a joint gap between courses; the top block stops just under the walking surface (feet, kerb strips and
 * the floor's parallax are untouched). The faces buried in the slab are left out. ~40 triangles a block, H / 0.5 blocks.
 */
export function quoinSoup(S, rng, cx, cz, sx, sz, yTop, H, grade = null) {
  const n = Math.max(1, Math.round(H / 0.5));
  const ch = H / n;
  let y1 = yTop - 0.006;
  for (let k = 0; k < n; k++) {
    const hgt = (k === 0 ? ch - 0.006 : ch) - 0.018;
    const y0 = y1 - hgt;
    const longX = (k & 1) === 0;
    const la = 0.38 + rng() * 0.08;
    const sa = 0.22 + rng() * 0.06;
    const ex = longX ? la : sa;
    const ez = longX ? sa : la;
    const px = 0.02 + rng() * 0.012;
    const pz = 0.02 + rng() * 0.012;
    // the block's box: from (corner - ext) to (corner + proud) along each axis
    const xa = cx - sx * ex;
    const xb = cx + sx * px;
    const za = cz - sz * ez;
    const zb = cz + sz * pz;
    const val = 0.86 + rng() * 0.2; // per-block value (dressed stone is never one grey)
    const ao = (x, y) => val * (0.72 + 0.28 * Math.min(1, Math.max(0, (y + hgt / 2) / hgt)));
    const skip = (sx > 0 ? 2 : 1) | (sz > 0 ? 32 : 16);
    chamferBox(S, (xa + xb) / 2, (y0 + y1) / 2, (za + zb) / 2, Math.abs(xb - xa), hgt, Math.abs(zb - za), 0.022 + rng() * 0.01, ao, skip);
    y1 = y0 - 0.018;
  }
  if (grade) S.tint(grade);
  return S;
}

/**
 * One decal quad into a Dresser decal buffer `D` ({ p, n, uv, c }): centre, in-plane axes A (right) / B (up), normal N, half sizes,
 * rotation th, the atlas cell rect [u0, v0, du, dv], alpha and an rgb tint (the stock quads carry a grey one).
 */
export function decalRGB(D, cx, cy, cz, A, B, N, hw, hh, th, cell, alpha, rgb) {
  const cs = Math.cos(th);
  const sn = Math.sin(th);
  const ax = A[0] * cs + B[0] * sn;
  const ay = A[1] * cs + B[1] * sn;
  const az = A[2] * cs + B[2] * sn;
  const bx = -A[0] * sn + B[0] * cs;
  const by = -A[1] * sn + B[1] * cs;
  const bz = -A[2] * sn + B[2] * cs;
  const [u0, v0, du, dv] = cell;
  const cr = [
    [-1, -1, u0, v0],
    [1, -1, u0 + du, v0],
    [1, 1, u0 + du, v0 + dv],
    [-1, 1, u0, v0 + dv],
  ];
  for (const k of [0, 1, 2, 0, 2, 3]) {
    const [qx, qy, u, v] = cr[k];
    D.p.push(cx + ax * hw * qx + bx * hh * qy, cy + ay * hw * qx + by * hh * qy, cz + az * hw * qx + bz * hh * qy);
    D.n.push(N[0], N[1], N[2]);
    D.uv.push(u, v);
    D.c.push(rgb[0], rgb[1], rgb[2], alpha);
  }
}

// -----------------------------------------------------------------------------
// Doorways: an iron-bound door leaf in the blind lancet doorways where a ledge meets its wall
// -----------------------------------------------------------------------------

/**
 * A closed iron door in a pointed doorway (face-local: x along the wall, y up, z out of it; the doorway as levelView's _lancet: clear
 * width w between the jamb centres, jamb height, rise, sill at y0, jambs bw wide). Vertical chamfered plates recessed
 * behind the frame (their tops step up under the arch), three riveted straps, a hasp; darker at the foot. ~650 triangles.
 */
export function doorSoup(S, rng, w, jamb, rise, y0, bw) {
  const half = w / 2 - bw / 2 - 0.01; // the jambs' inner faces (the leaf sits 11 cm behind the jambs' 0.2 m deep front)
  if (half < 0.3) return S;
  // the pointed arch of the opening (two-centred, as pointedArch) over [-half, half]
  const r = Math.max(0.2, rise - bw * 0.5);
  const c = (r * r - half * half) / (2 * half);
  const R = half + c;
  const archY = (x) => Math.sqrt(Math.max(0, R * R - (Math.abs(x) + c) * (Math.abs(x) + c)));
  const n = Math.max(3, Math.round((half * 2) / 0.27));
  const pw = (half * 2) / n;
  const z0 = 0.03;
  const z1 = 0.085;
  const yTop = y0 + jamb;
  const foot = (x, y) => 0.62 + 0.38 * Math.min(1, Math.max(0, (y + 1.2) / 2.4));
  for (let i = 0; i < n; i++) {
    const x = -half + pw * (i + 0.5);
    const top = yTop + archY(Math.abs(x) + pw * 0.5) - 0.05;
    const h = top - (y0 + 0.02);
    const k = 0.9 + rng() * 0.16;
    chamferBox(S, x, y0 + 0.02 + h / 2, (z0 + z1) / 2, pw - 0.012, h, z1 - z0, 0.012, (px, py) => k * foot(px, py + h / 2 + 0.02 - 1.2), 32);
  }
  // straps with a rivet on every plate
  for (const yy of [0.32, 1.0, Math.min(jamb + r * 0.35, 1.68)]) {
    const y = y0 + yy;
    chamferBox(S, 0, y, z1 + 0.012, half * 2 - 0.03, 0.085, 0.024, 0.008, null, 32);
    for (let i = 0; i < n; i++) rivet(S, [-half + pw * (i + 0.5), y, z1 + 0.024], [0, 0, 1], 0.016, 0.011, 6, 0.7);
  }
  // the hasp: a plate and its staple, at hand height by the meeting edge
  chamferBox(S, half * 0.55, y0 + 1.05, z1 + 0.02, 0.09, 0.2, 0.03, 0.01, null, 32);
  rivet(S, [half * 0.55, y0 + 1.05, z1 + 0.035], [0, 0, 1], 0.026, 0.03, 6, 0.6, true);
  return S;
}
