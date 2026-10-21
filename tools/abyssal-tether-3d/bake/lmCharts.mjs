/* ABYSSAL TETHER 3D — lmCharts.mjs
 * Lightmap chart generation for the baker: which faces of the static solid boxes are visible (exposed to air that the
 * player can reach), their cropped rectangles, adaptive texel density under a texel budget, and the atlas packing.
 * Deterministic, Node only.
 */

import { LM_FACE, LM_FACES, LM_PAGE, isCoreSolid } from '../../../public/abyssal-tether-3d/src/render/lightmapFormat.js';
import { BoxGrid } from './lmTrace.mjs';

export const CHART_CFG = {
  min: [-114, -564, -164],
  size: [198, 626, 216],
  cell: 6,
  probe: 0.5, // exposure sampling step on a face (m)
  lift: 0.05, // sample point offset along the normal (m)
  flood: 2, // flood-fill voxel (m)
  gutter: 2, // atlas padding (texels)
  // texel size (m) by distance to the route: ≤ near → fine, ≥ far → coarse
  fine: 0.25,
  coarse: 1.0,
  near: 5,
  far: 70,
  maxDim: 1016, // texels per chart edge (page minus gutters)
  maxAspect: 6, // largest texel aspect ratio when a chart edge is capped by maxDim
  budget: 4000000, // texels (with gutters) over the whole level
  visCell: 1.0, // visibility mask cell (m)
  eyeRays: 3000,
  eyeJitter: 4,
  eyeMaxDist: 150,
};

/** Small deterministic PRNG (mulberry32). */
export function lmRng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fibonacci sphere directions. */
export function fib(n) {
  const out = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const r = Math.sqrt(1 - y * y);
    out.push([Math.cos(ga * i) * r, y, Math.sin(ga * i) * r]);
  }
  return out;
}

function boxPointDist(b0, b1, p) {
  const dx = p[0] < b0[0] ? b0[0] - p[0] : p[0] > b1[0] ? p[0] - b1[0] : 0;
  const dy = p[1] < b0[1] ? b0[1] - p[1] : p[1] > b1[1] ? p[1] - b1[1] : 0;
  const dz = p[2] < b0[2] ? b0[2] - p[2] : p[2] > b1[2] ? p[2] - b1[2] : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/** Route points the player passes near (spawn, checkpoints, anchors, lamps): texel density is highest there. */
export function routePoints(level) {
  const pts = [];
  const add = (o) => {
    if (o && isFinite(o.x) && isFinite(o.y)) pts.push([o.x, o.y, isFinite(o.z) ? o.z : 0]);
  };
  add(level.spawn);
  for (const s of level.sections || []) add(s.checkpoint);
  for (const a of level.anchors || []) add(a);
  for (const l of level.lights || []) add(l);
  return pts;
}

/**
 * @param {Level3D} level
 * @param {object[]} rawSolids  LEVEL_DATA_3D.solids (omitIn / onlyIn flags)
 */
export function buildCharts(level, rawSolids, opts = {}) {
  const cfg = Object.assign({}, CHART_CFG, opts);
  const rawById = new Map((rawSolids || []).map((s) => [s.id, s]));
  const solids = level.solids.filter((s) => isCoreSolid(s, rawById));
  const boxes = new Float64Array(solids.length * 6);
  solids.forEach((s, i) => boxes.set([s.minX, s.minY, s.minZ, s.maxX, s.maxY, s.maxZ], i * 6));
  const grid = new BoxGrid(boxes, cfg.min, cfg.size, cfg.cell);

  // ---- reachable air (flood fill from the route points) -------------------------------------------------------------
  const fv = cfg.flood;
  const dims = [Math.ceil(cfg.size[0] / fv), Math.ceil(cfg.size[1] / fv), Math.ceil(cfg.size[2] / fv)];
  const nV = dims[0] * dims[1] * dims[2];
  const reach = new Uint8Array(nV);
  const vidx = (x, y, z) => (y * dims[2] + z) * dims[0] + x;
  const vOf = (p) => [Math.floor((p[0] - cfg.min[0]) / fv), Math.floor((p[1] - cfg.min[1]) / fv), Math.floor((p[2] - cfg.min[2]) / fv)];
  const free = (x, y, z) => !grid.inside(cfg.min[0] + (x + 0.5) * fv, cfg.min[1] + (y + 0.5) * fv, cfg.min[2] + (z + 0.5) * fv);
  const stack = new Int32Array(nV);
  let sp = 0;
  const route = routePoints(level);
  for (const p of route) {
    const [x, y, z] = vOf(p);
    if (x < 0 || y < 0 || z < 0 || x >= dims[0] || y >= dims[1] || z >= dims[2]) continue;
    const i = vidx(x, y, z);
    if (!reach[i] && free(x, y, z)) {
      reach[i] = 1;
      stack[sp++] = i;
    }
  }
  const NB = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  while (sp > 0) {
    const i = stack[--sp];
    const x = i % dims[0];
    const z = Math.floor(i / dims[0]) % dims[2];
    const y = Math.floor(i / (dims[0] * dims[2]));
    for (const [a, b, c] of NB) {
      const X = x + a;
      const Y = y + b;
      const Z = z + c;
      if (X < 0 || Y < 0 || Z < 0 || X >= dims[0] || Y >= dims[1] || Z >= dims[2]) continue;
      const j = vidx(X, Y, Z);
      if (reach[j] || !free(X, Y, Z)) continue;
      reach[j] = 1;
      stack[sp++] = j;
    }
  }
  const reachedAt = (x, y, z) => {
    const X = Math.floor((x - cfg.min[0]) / fv);
    const Y = Math.floor((y - cfg.min[1]) / fv);
    const Z = Math.floor((z - cfg.min[2]) / fv);
    if (X < 0 || Y < 0 || Z < 0 || X >= dims[0] || Y >= dims[1] || Z >= dims[2]) return false;
    return reach[vidx(X, Y, Z)] === 1;
  };

  // ---- what the player can actually see: rays from eye points along the route ---------------------------------------
  // Eyes: every route point, jittered copies of the anchors and the midpoints between neighbouring anchors (the swing
  // paths). A face cell is "seen" when any eye ray lands on it; the chart is the bounding rectangle of the seen cells.
  const vc = cfg.visCell;
  const seen = solids.map((s) => {
    const arr = [];
    for (let f = 0; f < LM_FACES; f++) {
      const [a, , sa, ta] = LM_FACE[f];
      const mnA = [s.minX, s.minY, s.minZ];
      const mxA = [s.maxX, s.maxY, s.maxZ];
      arr.push({ cs: Math.max(1, Math.ceil((mxA[sa] - mnA[sa]) / vc)), ct: Math.max(1, Math.ceil((mxA[ta] - mnA[ta]) / vc)), m: null, a });
      arr[f].m = new Uint8Array(arr[f].cs * arr[f].ct);
    }
    return arr;
  });
  const rng = lmRng(0x51ed);
  const eyes = [];
  const addEye = (p) => {
    if (!grid.inside(p[0], p[1], p[2])) eyes.push(p);
  };
  for (const p of route) addEye(p);
  const anchors = (level.anchors || []).filter((a) => isFinite(a.x));
  for (const a of anchors) {
    for (let k = 0; k < cfg.eyeJitter; k++) addEye([a.x + (rng() - 0.5) * 9, a.y + (rng() - 0.5) * 9, (a.z || 0) + (rng() - 0.5) * 9]);
    const near = anchors
      .filter((b) => b !== a)
      .map((b) => [b, Math.hypot(b.x - a.x, b.y - a.y, (b.z || 0) - (a.z || 0))])
      .sort((p, q) => p[1] - q[1])
      .slice(0, 3);
    for (const [b] of near) addEye([(a.x + b.x) / 2, (a.y + b.y) / 2, ((a.z || 0) + (b.z || 0)) / 2]);
  }
  const dirs = fib(cfg.eyeRays);
  let rays = 0;
  for (const e of eyes) {
    // a random rotation about Y per eye so the rays do not line up
    const rot = rng() * Math.PI * 2;
    const cr = Math.cos(rot);
    const sr = Math.sin(rot);
    for (const d of dirs) {
      const dx = d[0] * cr - d[2] * sr;
      const dz = d[0] * sr + d[2] * cr;
      const t = grid.trace(e[0], e[1], e[2], dx, d[1], dz, cfg.eyeMaxDist);
      rays++;
      if (t === Infinity) continue;
      const bi = grid.hitBox;
      const ax = grid.hitAxis;
      const f = ax * 2 + (grid.hitSign > 0 ? 0 : 1);
      const rec = seen[bi][f];
      const [, , sa, ta] = LM_FACE[f];
      const hp = [e[0] + dx * t, e[1] + d[1] * t, e[2] + dz * t];
      const o = bi * 6;
      const ci = Math.min(rec.cs - 1, Math.max(0, Math.floor((hp[sa] - boxes[o + sa]) / vc)));
      const cj = Math.min(rec.ct - 1, Math.max(0, Math.floor((hp[ta] - boxes[o + ta]) / vc)));
      rec.m[cj * rec.cs + ci] = 1;
    }
  }
  const isSeen = (si, f, sv, tv) => {
    const rec = seen[si][f];
    const s = solids[si];
    const mnA = [s.minX, s.minY, s.minZ];
    const [, , sa, ta] = LM_FACE[f];
    const ci = Math.min(rec.cs - 1, Math.max(0, Math.floor((sv - mnA[sa]) / vc)));
    const cj = Math.min(rec.ct - 1, Math.max(0, Math.floor((tv - mnA[ta]) / vc)));
    for (let dj = -1; dj <= 1; dj++) {
      const j = cj + dj;
      if (j < 0 || j >= rec.ct) continue;
      for (let di = -1; di <= 1; di++) {
        const i = ci + di;
        if (i < 0 || i >= rec.cs) continue;
        if (rec.m[j * rec.cs + i]) return true;
      }
    }
    return false;
  };

  // ---- exposed rectangles ---------------------------------------------------------------------------------------
  const charts = [];
  let exposedArea = 0;
  let faceArea = 0;
  for (let si = 0; si < solids.length; si++) {
    const s = solids[si];
    const mn = [s.minX, s.minY, s.minZ];
    const mx = [s.maxX, s.maxY, s.maxZ];
    for (let f = 0; f < LM_FACES; f++) {
      const [a, sign, sa, ta] = LM_FACE[f];
      const p = sign > 0 ? mx[a] : mn[a];
      const sLen = mx[sa] - mn[sa];
      const tLen = mx[ta] - mn[ta];
      if (sLen < 0.05 || tLen < 0.05) continue;
      faceArea += sLen * tLen;
      const ns = Math.max(1, Math.ceil(sLen / cfg.probe));
      const nt = Math.max(1, Math.ceil(tLen / cfg.probe));
      let s0 = Infinity;
      let s1 = -Infinity;
      let t0 = Infinity;
      let t1 = -Infinity;
      let hits = 0;
      const q = [0, 0, 0];
      for (let j = 0; j < nt; j++) {
        const tv = mn[ta] + ((j + 0.5) / nt) * tLen;
        for (let i = 0; i < ns; i++) {
          const sv = mn[sa] + ((i + 0.5) / ns) * sLen;
          q[a] = p + sign * cfg.lift;
          q[sa] = sv;
          q[ta] = tv;
          if (grid.inside(q[0], q[1], q[2])) continue;
          if (!isSeen(si, f, sv, tv)) continue;
          let ok = false;
          for (const d of [0.6, 1.3]) {
            const o = [q[0], q[1], q[2]];
            o[a] = p + sign * d;
            if (!grid.inside(o[0], o[1], o[2]) && reachedAt(o[0], o[1], o[2])) {
              ok = true;
              break;
            }
          }
          if (!ok) continue;
          hits++;
          if (sv < s0) s0 = sv;
          if (sv > s1) s1 = sv;
          if (tv < t0) t0 = tv;
          if (tv > t1) t1 = tv;
        }
      }
      if (!hits) continue;
      // extend by half a probe cell (the samples are cell centres) and clamp to the face
      const hs = sLen / ns / 2;
      const ht = tLen / nt / 2;
      s0 = Math.max(mn[sa], s0 - hs);
      s1 = Math.min(mx[sa], s1 + hs);
      t0 = Math.max(mn[ta], t0 - ht);
      t1 = Math.min(mx[ta], t1 + ht);
      exposedArea += (s1 - s0) * (t1 - t0);
      // distance to the route decides the texel size
      const b0 = [0, 0, 0];
      const b1 = [0, 0, 0];
      b0[a] = b1[a] = p;
      b0[sa] = s0;
      b1[sa] = s1;
      b0[ta] = t0;
      b1[ta] = t1;
      let dmin = Infinity;
      for (const r of route) dmin = Math.min(dmin, boxPointDist(b0, b1, r));
      charts.push({ solid: si, id: s.id, face: f, a, sa, ta, p, s0, s1, t0, t1, section: Math.max(0, s.section | 0), dRoute: dmin, kind: s.kind });
    }
  }
  return { cfg, solids, boxes, grid, charts, route, stats: { faceArea, exposedArea, eyes: eyes.length, rays, charts: charts.length, reachVoxels: reach.reduce((a, b) => a + b, 0), voxels: nV } };
}

/** Texel size (m) of a chart before the budget scale. */
export function texelSizeOf(c, cfg) {
  const t = Math.min(1, Math.max(0, (c.dRoute - cfg.near) / (cfg.far - cfg.near)));
  return cfg.fine + (cfg.coarse - cfg.fine) * Math.sqrt(t);
}

/** Texel dimensions (w, h) of a chart at scale k (k multiplies the texel size). */
export function chartDims(c, cfg, k) {
  const ts = texelSizeOf(c, cfg) * k;
  let w = Math.max(2, Math.ceil((c.s1 - c.s0) / ts));
  let h = Math.max(2, Math.ceil((c.t1 - c.t0) / ts));
  // a long edge is capped; the other edge then may not be finer than maxAspect × (the capped texel size)
  if (w > cfg.maxDim) w = cfg.maxDim;
  if (h > cfg.maxDim) h = cfg.maxDim;
  const tsW = (c.s1 - c.s0) / w;
  const tsH = (c.t1 - c.t0) / h;
  if (tsW > tsH * cfg.maxAspect) h = Math.max(2, Math.min(cfg.maxDim, Math.ceil((c.t1 - c.t0) / (tsW / cfg.maxAspect))));
  if (tsH > tsW * cfg.maxAspect) w = Math.max(2, Math.min(cfg.maxDim, Math.ceil((c.s1 - c.s0) / (tsH / cfg.maxAspect))));
  return [w, h];
}

/** Finds the scale k so that the charts fit the texel budget (gutters included); applies w/h/base to the charts. */
export function fitBudget(charts, cfg) {
  const total = (k) => {
    let n = 0;
    for (const c of charts) {
      const [w, h] = chartDims(c, cfg, k);
      n += (w + 2 * cfg.gutter) * (h + 2 * cfg.gutter);
    }
    return n;
  };
  let lo = 0.25;
  let hi = 8;
  if (total(lo) <= cfg.budget) hi = lo;
  else {
    for (let i = 0; i < 40; i++) {
      const mid = Math.sqrt(lo * hi);
      if (total(mid) > cfg.budget) lo = mid;
      else hi = mid;
    }
  }
  const k = hi;
  let base = 0;
  for (const c of charts) {
    const [w, h] = chartDims(c, cfg, k);
    c.w = w;
    c.h = h;
    c.base = base;
    base += w * h;
  }
  return { k, texels: base, withGutters: total(k) };
}

/**
 * Packs all charts into pages (MaxRects, best short side fit, largest first). Sets c.page (global page index), c.px, c.py
 * (top-left of the chart content, gutters excluded). Returns { pages: [{ sections: number[], used }] }. Pages are not
 * split per section: the per-section packing wasted ~45 % of the memory on this level (charts are big).
 */
export function packPages(charts, cfg) {
  const [PW, PH] = LM_PAGE;
  const g = cfg.gutter;
  const list = charts.slice().sort((p, q) => q.w * q.h - p.w * p.h || p.base - q.base);
  const pages = [];
  const newPage = () => {
    pages.push({ sections: [], used: 0, free: [{ x: 0, y: 0, w: PW, h: PH }] });
    return pages.length - 1;
  };
  const place = (pg, cw, ch) => {
    let best = null;
    let bs = Infinity;
    let bl = Infinity;
    for (const r of pg.free) {
      if (cw <= r.w && ch <= r.h) {
        const sh = Math.min(r.w - cw, r.h - ch);
        const lg = Math.max(r.w - cw, r.h - ch);
        if (sh < bs || (sh === bs && lg < bl)) {
          best = r;
          bs = sh;
          bl = lg;
        }
      }
    }
    if (!best) return null;
    const px = best.x;
    const py = best.y;
    const used = { x: px, y: py, w: cw, h: ch };
    const next = [];
    for (const r of pg.free) {
      if (used.x >= r.x + r.w || used.x + used.w <= r.x || used.y >= r.y + r.h || used.y + used.h <= r.y) {
        next.push(r);
        continue;
      }
      if (used.x > r.x) next.push({ x: r.x, y: r.y, w: used.x - r.x, h: r.h });
      if (used.x + used.w < r.x + r.w) next.push({ x: used.x + used.w, y: r.y, w: r.x + r.w - used.x - used.w, h: r.h });
      if (used.y > r.y) next.push({ x: r.x, y: r.y, w: r.w, h: used.y - r.y });
      if (used.y + used.h < r.y + r.h) next.push({ x: r.x, y: used.y + used.h, w: r.w, h: r.y + r.h - used.y - used.h });
    }
    // drop free rectangles contained in another
    pg.free = next.filter((a, i) => !next.some((b, j) => i !== j && a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h && (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || j < i)));
    return [px, py];
  };
  for (const c of list) {
    const cw = c.w + 2 * g;
    const ch = c.h + 2 * g;
    if (cw > PW || ch > PH) throw new Error(`chart ${c.id}/${c.face} ${c.w}x${c.h} does not fit a page`);
    let at = null;
    let pi = 0;
    for (; pi < pages.length; pi++) {
      at = place(pages[pi], cw, ch);
      if (at) break;
    }
    if (!at) {
      pi = newPage();
      at = place(pages[pi], cw, ch);
    }
    c.page = pi;
    c.px = at[0] + g;
    c.py = at[1] + g;
    pages[pi].used += cw * ch;
    if (!pages[pi].sections.includes(c.section)) pages[pi].sections.push(c.section);
  }
  return { pages: pages.map((p) => ({ sections: p.sections.sort((a, b) => a - b), used: p.used })) };
}
