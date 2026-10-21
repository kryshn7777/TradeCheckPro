/* ABYSSAL TETHER 3D — climbEdges.js
 * Procedural grip candidates (WP-CLIMB, "any exposed edge is a handhold"): derives, once at level load, the exposed edges of
 * every solid box and indexes them in a spatial hash so Level3D.edgeNear() stays a handful of array reads (no allocation per
 * query). Pure, deterministic (no Math.random, fixed iteration order), no three.js, no DOM.
 *
 * A box edge is a hold when it is CONVEX and open: the three probe points just beside it (outside either adjacent face, and the
 * diagonal) lie in no other solid, so top lips, vertical corners of blocks and pillars, window / arch jambs, the lips of ledge
 * undersides, brackets, beams and protruding stones all qualify, while a flat wall face never does. Edges buried in a
 * neighbour, or on a crumbling solid (it breaks), are dropped; so is every stretch within HAZARD_CLEAR of a hazard volume
 * (the 0.6 m rule the authored zones obey). Collinear pieces of the same edge merge. Each hold is a degenerate zone box (the
 * segment) so sim/climb3d.js can treat it like a zone: closest point = the hold.
 *
 * Edge zone fields (on top of the zone shape: minX..maxZ, kind, wet, section):
 *   edge: true, ea 0|1|2 (axis the segment runs along), lip (a standable top edge: mantle assist), mx, mz (horizontal unit
 *   direction onto the ledge, lips only), ux, uy, uz (unit outward bisector), src (the solid it belongs to), len.
 */

const LO = ['minX', 'minY', 'minZ'];
const HI = ['maxX', 'maxY', 'maxZ'];
const PROBE = 0.04; // m: how far beside the edge the open-space probes sit
const MIN_LEN = 0.3; // m: shorter pieces are not holds
export const HAZARD_CLEAR = 0.6; // m: no edge hold within this of a hazard volume
const GAP = 0.02; // m: pieces closer than this merge
const MANTLE_DEPTH = 0.4; // m of floor a lip must have behind it to be standable
const CELL0 = 2; // m: spatial hash cell

function inside(o, x, y, z) {
  return x > o.minX && x < o.maxX && y > o.minY && y < o.maxY && z > o.minZ && z < o.maxZ;
}

/** Is the point inside any solid of `list` (whose spans on axis a contain it - the caller's probe is exact)? */
function inAny(list, x, y, z, skip) {
  for (let i = 0; i < list.length; i++) {
    const o = list[i];
    if (o !== skip && inside(o, x, y, z)) return true;
  }
  return false;
}

/** Removes [lo, hi] from a list of [a, b] pairs (flat array), returning a new flat array. */
function subtract(iv, lo, hi) {
  const out = [];
  for (let i = 0; i < iv.length; i += 2) {
    const a = iv[i];
    const b = iv[i + 1];
    if (hi <= a || lo >= b) {
      out.push(a, b);
      continue;
    }
    if (lo > a) out.push(a, lo);
    if (hi < b) out.push(hi, b);
  }
  return out;
}

/**
 * @param {Level3D} level   uses level.solids, level.hazards, level.querySolids, level.sectionIndexAt
 * @returns {{edges: object[], grid: object}}
 */
export function buildEdges(level) {
  const solids = level.solids;
  const hazards = level.hazards;
  const scratch = [];
  const pt = [0, 0, 0];
  const raw = []; // { key, a, lo, hi, pc, qc, sp, sq, lip, src }
  const e = PROBE;
  for (let si = 0; si < solids.length; si++) {
    const s = solids[si];
    if (s.kind === 'crumble') continue; // it breaks: not a hold
    for (let a = 0; a < 3; a++) {
      const p = (a + 1) % 3;
      const q = (a + 2) % 3;
      const alo = s[LO[a]];
      const ahi = s[HI[a]];
      for (let ip = 0; ip < 2; ip++) {
        for (let iq = 0; iq < 2; iq++) {
          const sp = ip ? 1 : -1;
          const sq = iq ? 1 : -1;
          const pc = ip ? s[HI[p]] : s[LO[p]];
          const qc = iq ? s[HI[q]] : s[LO[q]];
          // the neighbours that matter: boxes touching the segment (inflated)
          const m = 0.1;
          const box = [0, 0, 0, 0, 0, 0];
          box[a] = alo - m;
          box[a + 3] = ahi + m;
          box[p] = pc - m;
          box[p + 3] = pc + m;
          box[q] = qc - m;
          box[q + 3] = qc + m;
          const near = level.querySolids(box[0], box[1], box[2], box[3], box[4], box[5], scratch);
          const cand = [];
          const breaks = [alo, ahi];
          for (let i = 0; i < near.length; i++) {
            const o = near[i];
            if (o === s) continue;
            cand.push(o);
            const ol = o[LO[a]];
            const oh = o[HI[a]];
            if (ol > alo && ol < ahi) breaks.push(ol);
            if (oh > alo && oh < ahi) breaks.push(oh);
          }
          breaks.sort((x, y) => x - y);
          let iv = [];
          for (let bi = 0; bi + 1 < breaks.length; bi++) {
            const b0 = breaks[bi];
            const b1 = breaks[bi + 1];
            if (b1 - b0 < 1e-4) continue;
            const mid = (b0 + b1) / 2;
            let open = true;
            for (let k = 0; k < 3 && open; k++) {
              pt[a] = mid;
              pt[p] = k === 1 ? pc - sp * e : pc + sp * e;
              pt[q] = k === 0 ? qc - sq * e : qc + sq * e;
              if (inAny(cand, pt[0], pt[1], pt[2], s)) open = false;
            }
            if (!open) continue;
            if (iv.length && Math.abs(iv[iv.length - 1] - b0) < 1e-6) iv[iv.length - 1] = b1;
            else iv.push(b0, b1);
          }
          if (!iv.length) continue;
          // keep clear of hazards (all of them: a toggling spike is still there)
          for (let hi = 0; hi < hazards.length; hi++) {
            const h = hazards[hi];
            if (pc < h[LO[p]] - HAZARD_CLEAR || pc > h[HI[p]] + HAZARD_CLEAR) continue;
            if (qc < h[LO[q]] - HAZARD_CLEAR || qc > h[HI[q]] + HAZARD_CLEAR) continue;
            iv = subtract(iv, h[LO[a]] - HAZARD_CLEAR, h[HI[a]] + HAZARD_CLEAR);
            if (!iv.length) break;
          }
          for (let i = 0; i < iv.length; i += 2) {
            const lo = iv[i];
            const hi = iv[i + 1];
            if (hi - lo < MIN_LEN) continue;
            // a standable top lip: the edge of a top face (+y outward on p or q) with floor and headroom behind it
            let lip = false;
            let hAxis = -1;
            let sh = 0;
            if (a !== 1) {
              const yIsP = p === 1;
              const sy = yIsP ? sp : sq;
              hAxis = yIsP ? q : p;
              sh = yIsP ? sq : sp;
              if (sy > 0) {
                const hc = yIsP ? qc : pc;
                const top = yIsP ? pc : qc;
                const mid = (lo + hi) / 2;
                pt[a] = mid;
                pt[hAxis] = hc - sh * MANTLE_DEPTH;
                pt[1] = top - 0.05;
                const floor = inAny(solids, pt[0], pt[1], pt[2], null);
                pt[1] = top + 0.5;
                const h1 = inAny(solids, pt[0], pt[1], pt[2], null);
                pt[1] = top + 1.4;
                const h2 = inAny(solids, pt[0], pt[1], pt[2], null);
                lip = floor && !h1 && !h2;
              }
            }
            raw.push({ a, lo, hi, pc, qc, sp, sq, lip, hAxis, sh, src: s, key: 0 });
          }
        }
      }
    }
  }
  // merge collinear pieces (same line, same outward corner, same lip class)
  raw.sort((u, v) => u.a - v.a || u.pc - v.pc || u.qc - v.qc || u.sp - v.sp || u.sq - v.sq || (u.lip ? 1 : 0) - (v.lip ? 1 : 0) || u.lo - v.lo);
  const merged = [];
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const t = merged.length ? merged[merged.length - 1] : null;
    if (t && t.a === r.a && Math.abs(t.pc - r.pc) < 1e-6 && Math.abs(t.qc - r.qc) < 1e-6 && t.sp === r.sp && t.sq === r.sq && t.lip === r.lip && r.lo <= t.hi + GAP) {
      if (r.hi > t.hi) t.hi = r.hi;
    } else {
      merged.push({ a: r.a, lo: r.lo, hi: r.hi, pc: r.pc, qc: r.qc, sp: r.sp, sq: r.sq, lip: r.lip, hAxis: r.hAxis, sh: r.sh, src: r.src });
    }
  }
  const edges = [];
  const R2 = Math.SQRT1_2;
  for (let i = 0; i < merged.length; i++) {
    const r = merged[i];
    const a = r.a;
    const p = (a + 1) % 3;
    const q = (a + 2) % 3;
    const z = { id: `edg${i}`, kind: r.src.kind === 'metal' ? 'rebar' : 'masonry', edge: true, wet: false, ea: a, ax: -2, lip: r.lip, len: r.hi - r.lo };
    const mn = [0, 0, 0];
    const mx = [0, 0, 0];
    mn[a] = r.lo;
    mx[a] = r.hi;
    mn[p] = mx[p] = r.pc;
    mn[q] = mx[q] = r.qc;
    z.minX = mn[0];
    z.minY = mn[1];
    z.minZ = mn[2];
    z.maxX = mx[0];
    z.maxY = mx[1];
    z.maxZ = mx[2];
    const u = [0, 0, 0];
    u[p] = r.sp * R2;
    u[q] = r.sq * R2;
    z.ux = u[0];
    z.uy = u[1];
    z.uz = u[2];
    z.nx = 0;
    z.ny = 0;
    z.nz = 0;
    z.face = 0;
    z.mx = 0;
    z.mz = 0;
    if (r.lip) {
      if (r.hAxis === 0) z.mx = -r.sh;
      else z.mz = -r.sh;
    }
    z.section = level.sectionIndexAt((z.minY + z.maxY) / 2);
    z.src = r.src;
    z.tag = null;
    z._stamp = 0;
    edges.push(z);
  }
  return { edges, grid: makeGrid(edges) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Spatial hash: uniform cells, an integer key per cell in a Map of arrays; the segment's bounding box fills its cells.
// ---------------------------------------------------------------------------------------------------------------------
function makeGrid(edges) {
  let x0 = Infinity;
  let y0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  let z1 = -Infinity;
  for (let i = 0; i < edges.length; i++) {
    const z = edges[i];
    x0 = Math.min(x0, z.minX);
    y0 = Math.min(y0, z.minY);
    z0 = Math.min(z0, z.minZ);
    x1 = Math.max(x1, z.maxX);
    y1 = Math.max(y1, z.maxY);
    z1 = Math.max(z1, z.maxZ);
  }
  if (!isFinite(x0)) {
    x0 = y0 = z0 = 0;
    x1 = y1 = z1 = 1;
  }
  let cell = CELL0;
  while (Math.max(x1 - x0, y1 - y0, z1 - z0) / cell >= 1000) cell *= 2;
  const g = { cell, inv: 1 / cell, ox: x0, oy: y0, oz: z0, map: new Map(), stamp: 0, count: edges.length, cells: 0 };
  for (let i = 0; i < edges.length; i++) {
    const z = edges[i];
    const ix1 = cellOf(g, z.maxX, g.ox);
    const iy1 = cellOf(g, z.maxY, g.oy);
    const iz1 = cellOf(g, z.maxZ, g.oz);
    for (let ix = cellOf(g, z.minX, g.ox); ix <= ix1; ix++) {
      for (let iy = cellOf(g, z.minY, g.oy); iy <= iy1; iy++) {
        for (let iz = cellOf(g, z.minZ, g.oz); iz <= iz1; iz++) {
          const k = (ix << 20) | (iy << 10) | iz;
          let l = g.map.get(k);
          if (!l) {
            l = [];
            g.map.set(k, l);
          }
          l.push(z);
        }
      }
    }
  }
  g.cells = g.map.size;
  return g;
}

function cellOf(g, v, o) {
  const c = Math.floor((v - o) * g.inv);
  return c < 0 ? 0 : c > 1023 ? 1023 : c;
}

/** Edge holds whose bounding box touches the box of the sphere (x, y, z, r): a superset, exact distance is the caller's. No allocation. */
export function edgeQuery(g, x, y, z, r, out) {
  let n = 0;
  if (g.count === 0) {
    out.length = 0;
    return out;
  }
  g.stamp = (g.stamp + 1) | 0;
  if (g.stamp === 0) g.stamp = 1;
  const stamp = g.stamp;
  const ix1 = cellOf(g, x + r, g.ox);
  const iy1 = cellOf(g, y + r, g.oy);
  const iz1 = cellOf(g, z + r, g.oz);
  const map = g.map;
  for (let ix = cellOf(g, x - r, g.ox); ix <= ix1; ix++) {
    for (let iy = cellOf(g, y - r, g.oy); iy <= iy1; iy++) {
      for (let iz = cellOf(g, z - r, g.oz); iz <= iz1; iz++) {
        const l = map.get((ix << 20) | (iy << 10) | iz);
        if (l === undefined) continue;
        for (let i = 0; i < l.length; i++) {
          const c = l[i];
          if (c._stamp === stamp) continue;
          c._stamp = stamp;
          if (c.minX > x + r || c.maxX < x - r || c.minY > y + r || c.maxY < y - r || c.minZ > z + r || c.maxZ < z - r) continue;
          out[n++] = c;
        }
      }
    }
  }
  out.length = n;
  return out;
}
