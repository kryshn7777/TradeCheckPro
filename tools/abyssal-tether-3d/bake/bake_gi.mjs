#!/usr/bin/env node
/* ABYSSAL TETHER 3D — bake_gi.mjs
 * Bakes the static lighting of Chapter I into a low-resolution 3D data texture (no Blender, deterministic, ~1 min):
 *
 *   node tools/abyssal-tether-3d/bake/bake_gi.mjs [--out public/abyssal-tether-3d/assets/lighting/gi_ch1.bin] [--verify]
 *
 * Input: the real level solids and lights (src/data/level-data-3d.js through Level3D, variant 'normal'; crumbling ledges
 * are left out, they fall). Per voxel (112 × 256 × 124, ≈1.75 m × 2.45 m × 1.75 m over the whole descent):
 *   A  ambient occlusion        24 fixed sphere rays (≤ 7 m) against the solid boxes, relative to a flat wall, then
 *                                scaled per section so the section's mean near-surface visibility stays ≈ 0.88 (the
 *                                hemisphere ambient the environment art was graded with keeps its overall level; corners,
 *                                undersides and crevices darken, open faces do not)
 *   B  shaft-key visibility     5 rays toward the key light (KEY_DIR) up to 90 m (blocked regions keep 35 % of it: the
 *                                key is a slanted cold fill, not a sun)
 *   R  static bounce light      every level light (one-bounce, soft, shadow rays) + the light shafts' cool fill,
 *                                sqrt-encoded irradiance (render/giFormat.js)
 *   G  warmth                   share of the bounce that came from warm (flame) lights vs cool (shaft) ones; the
 *                                renderer tints it with the section theme colours
 * Only STATIC contributions are baked. The lantern and the two pooled environment lamps stay dynamic and add their own
 * direct light; the baked bounce is the soft indirect part (≈ 0.34 × the lamp's direct level), so a lamp is not counted
 * twice, and the renderer multiplies the bounce by the lamps' current flicker.
 * Voxels inside solids are pushed out (filled from open neighbours) so trilinear sampling at a surface never darkens.
 *
 * Output: header + zlib(delta-filtered RGBA8), see src/render/giFormat.js (< 2 MB).
 */

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { Level3D } from '../../../public/abyssal-tether-3d/src/sim/level3d.js';
import { LEVEL_DATA_3D } from '../../../public/abyssal-tether-3d/src/data/level-data-3d.js';
import { GI_HEADER_BYTES, levelGiHash, readHeader, undelta, delta, voxelIndex, writeHeader } from '../../../public/abyssal-tether-3d/src/render/giFormat.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const DEFAULT_OUT = path.join(ROOT, 'public/abyssal-tether-3d/assets/lighting/gi_ch1.bin');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
export const BAKE = {
  min: [-114, -564, -164],
  size: [198, 626, 216],
  dims: [112, 256, 124], // x, y, z
  aoRays: 24,
  aoRange: 7,
  aoRelief: 0.38, // mean occlusion of an open flat wall (subtracted)
  aoGain: 1.9,
  aoStrength: 0.9,
  aoTarget: 0.93,
  aoFloor: 0.22, // tight gaps keep a little ambient (the lantern and bounce still reach them)
  keyRange: 90,
  keyFloor: 0.35, // the shaft key is a slanted fill, not a sun: blocked regions keep this much of it
  skyRange: 120,
  bounce: 0.34, // × the lamp's direct level
  coarse: [4, 2, 4], // key / sky visibility lattice stride in voxels
  cell: 8, // acceleration grid cell (m)
};
const KEY_DIR = norm([-0.45, 1, 0.3]); // render/materials.js KEY_DIR

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / l, v[1] / l, v[2] / l];
}
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

// ---------------------------------------------------------------------------
// Solids: grid + ray queries
// ---------------------------------------------------------------------------
class SolidGrid {
  constructor(solids, min, size, cell) {
    this.boxes = solids;
    this.cell = cell;
    this.min = min;
    this.n = [Math.ceil(size[0] / cell) + 2, Math.ceil(size[1] / cell) + 2, Math.ceil(size[2] / cell) + 2];
    this.cells = new Map();
    this.stamp = new Int32Array(solids.length);
    this.stampN = 0;
    for (let i = 0; i < solids.length; i++) {
      const b = solids[i];
      const [x0, y0, z0] = this.ci(b.minX, b.minY, b.minZ);
      const [x1, y1, z1] = this.ci(b.maxX, b.maxY, b.maxZ);
      for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this._cell(x, y, z, true).push(i);
    }
  }

  ci(x, y, z) {
    const c = this.cell;
    return [Math.floor((x - this.min[0]) / c) + 1, Math.floor((y - this.min[1]) / c) + 1, Math.floor((z - this.min[2]) / c) + 1];
  }

  _key(x, y, z) {
    return (y * this.n[2] + z) * this.n[0] + x;
  }

  _cell(x, y, z, create) {
    const k = this._key(x, y, z);
    let a = this.cells.get(k);
    if (!a && create) {
      a = [];
      this.cells.set(k, a);
    }
    return a;
  }

  /** Is the point inside a solid? */
  inside(x, y, z) {
    const [cx, cy, cz] = this.ci(x, y, z);
    const a = this.cells.get(this._key(cx, cy, cz));
    if (!a) return false;
    for (let i = 0; i < a.length; i++) {
      const b = this.boxes[a[i]];
      if (x > b.minX && x < b.maxX && y > b.minY && y < b.maxY && z > b.minZ && z < b.maxZ) return true;
    }
    return false;
  }

  /** Boxes within `r` of the point (deduplicated); `out` is reused. */
  near(x, y, z, r, out) {
    out.length = 0;
    const [x0, y0, z0] = this.ci(x - r, y - r, z - r);
    const [x1, y1, z1] = this.ci(x + r, y + r, z + r);
    const st = ++this.stampN;
    const r2 = r * r;
    for (let cz = z0; cz <= z1; cz++)
      for (let cy = y0; cy <= y1; cy++)
        for (let cx = x0; cx <= x1; cx++) {
          const a = this.cells.get(this._key(cx, cy, cz));
          if (!a) continue;
          for (let i = 0; i < a.length; i++) {
            const id = a[i];
            if (this.stamp[id] === st) continue;
            this.stamp[id] = st;
            const b = this.boxes[id];
            const dx = x < b.minX ? b.minX - x : x > b.maxX ? x - b.maxX : 0;
            const dy = y < b.minY ? b.minY - y : y > b.maxY ? y - b.maxY : 0;
            const dz = z < b.minZ ? b.minZ - z : z > b.maxZ ? z - b.maxZ : 0;
            if (dx * dx + dy * dy + dz * dz <= r2) out.push(b);
          }
        }
    return out;
  }

  /** Distance to the first box along the ray (3D DDA over the cell grid), Infinity if none within maxT. */
  hit(ox, oy, oz, dx, dy, dz, maxT) {
    const c = this.cell;
    const mn = this.min;
    let cx = Math.floor((ox - mn[0]) / c) + 1;
    let cy = Math.floor((oy - mn[1]) / c) + 1;
    let cz = Math.floor((oz - mn[2]) / c) + 1;
    const sx = dx > 0 ? 1 : -1;
    const sy = dy > 0 ? 1 : -1;
    const sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(c / dx) : Infinity;
    const tdy = dy !== 0 ? Math.abs(c / dy) : Infinity;
    const tdz = dz !== 0 ? Math.abs(c / dz) : Infinity;
    const nx = mn[0] + (cx - 1 + (dx > 0 ? 1 : 0)) * c;
    const ny = mn[1] + (cy - 1 + (dy > 0 ? 1 : 0)) * c;
    const nz = mn[2] + (cz - 1 + (dz > 0 ? 1 : 0)) * c;
    let tmx = dx !== 0 ? (nx - ox) / dx : Infinity;
    let tmy = dy !== 0 ? (ny - oy) / dy : Infinity;
    let tmz = dz !== 0 ? (nz - oz) / dz : Infinity;
    let best = Infinity;
    const st = ++this.stampN;
    const N = this.n;
    for (let guard = 0; guard < 4096; guard++) {
      if (cx < 0 || cy < 0 || cz < 0 || cx >= N[0] || cy >= N[1] || cz >= N[2]) break;
      const a = this.cells.get(this._key(cx, cy, cz));
      if (a) {
        for (let i = 0; i < a.length; i++) {
          const id = a[i];
          if (this.stamp[id] === st) continue;
          this.stamp[id] = st;
          const t = slab(this.boxes[id], ox, oy, oz, dx, dy, dz);
          if (t < best) best = t;
        }
      }
      const tExit = Math.min(tmx, tmy, tmz);
      if (best <= tExit || tExit > maxT) break;
      if (tmx <= tmy && tmx <= tmz) {
        cx += sx;
        tmx += tdx;
      } else if (tmy <= tmz) {
        cy += sy;
        tmy += tdy;
      } else {
        cz += sz;
        tmz += tdz;
      }
    }
    return best <= maxT ? best : Infinity;
  }
}

/** Ray-box entry distance (Infinity when missed or the origin is inside: treated by callers). */
function slab(b, ox, oy, oz, dx, dy, dz) {
  let t0 = 0;
  let t1 = Infinity;
  if (dx !== 0) {
    const a = (b.minX - ox) / dx;
    const c = (b.maxX - ox) / dx;
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
  } else if (ox < b.minX || ox > b.maxX) return Infinity;
  if (dy !== 0) {
    const a = (b.minY - oy) / dy;
    const c = (b.maxY - oy) / dy;
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
  } else if (oy < b.minY || oy > b.maxY) return Infinity;
  if (dz !== 0) {
    const a = (b.minZ - oz) / dz;
    const c = (b.maxZ - oz) / dz;
    t0 = Math.max(t0, Math.min(a, c));
    t1 = Math.min(t1, Math.max(a, c));
  } else if (oz < b.minZ || oz > b.maxZ) return Infinity;
  return t0 <= t1 ? t0 : Infinity;
}

function fibonacciSphere(n) {
  const out = [];
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const r = Math.sqrt(1 - y * y);
    out.push([Math.cos(ga * i) * r, y, Math.sin(ga * i) * r]);
  }
  return out;
}

function isWarm(color) {
  const c = parseInt(String(color || '#e0a050').replace('#', ''), 16);
  const r = (c >> 16) & 255;
  const b = c & 255;
  return r > b * 1.12;
}

// ---------------------------------------------------------------------------
// Bake
// ---------------------------------------------------------------------------
export function bake(level, opts = {}) {
  const log = opts.log || (() => {});
  const cfg = Object.assign({}, BAKE, opts.config || {});
  const [DX, DY, DZ] = cfg.dims;
  const vox = [cfg.size[0] / DX, cfg.size[1] / DY, cfg.size[2] / DZ];
  const solids = level.solids.filter((s) => s.kind !== 'crumble');
  const grid = new SolidGrid(solids, cfg.min, cfg.size, cfg.cell);
  const N = DX * DY * DZ;
  const at = (x, y, z) => (y * DZ + z) * DX + x;
  const centre = (ix, iy, iz) => [cfg.min[0] + (ix + 0.5) * vox[0], cfg.min[1] + (iy + 0.5) * vox[1], cfg.min[2] + (iz + 0.5) * vox[2]];
  const secOf = (y) => {
    const i = level.sectionIndexAt(y);
    return Math.max(0, Math.min(level.sections.length - 1, i | 0));
  };
  const t0 = Date.now();

  // ---- occupancy, AO ------------------------------------------------------
  const solid = new Uint8Array(N);
  const nearSurf = new Uint8Array(N);
  const ao = new Float32Array(N).fill(1);
  const dirs = fibonacciSphere(cfg.aoRays);
  const scratch = [];
  const R = cfg.aoRange;
  let nSolid = 0;
  let nNear = 0;
  for (let iy = 0; iy < DY; iy++) {
    for (let iz = 0; iz < DZ; iz++) {
      for (let ix = 0; ix < DX; ix++) {
        const [x, y, z] = centre(ix, iy, iz);
        const i = at(ix, iy, iz);
        if (grid.inside(x, y, z)) {
          solid[i] = 1;
          nSolid++;
          continue;
        }
        const bx = grid.near(x, y, z, R, scratch);
        if (!bx.length) continue;
        nearSurf[i] = 1;
        nNear++;
        let occ = 0;
        for (let k = 0; k < dirs.length; k++) {
          const d = dirs[k];
          let t = Infinity;
          for (let b = 0; b < bx.length; b++) {
            const tt = slab(bx[b], x, y, z, d[0], d[1], d[2]);
            if (tt < t) t = tt;
          }
          if (t < R) occ += 1 - t / R;
        }
        const mean = occ / dirs.length;
        ao[i] = 1 - clamp01((mean - cfg.aoRelief) * cfg.aoGain) * cfg.aoStrength;
      }
    }
  }
  log(`ao: ${nSolid} solid, ${nNear} near-surface of ${N} voxels (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

  // ---- key visibility + sky openness on a coarse lattice ----------------------
  const [SX, SY, SZ] = cfg.coarse;
  const CX = Math.ceil(DX / SX) + 1;
  const CY = Math.ceil(DY / SY) + 1;
  const CZ = Math.ceil(DZ / SZ) + 1;
  const cat = (x, y, z) => (y * CZ + z) * CX + x;
  const keyC = new Float32Array(CX * CY * CZ);
  const skyC = new Float32Array(CX * CY * CZ);
  const valid = new Uint8Array(CX * CY * CZ);
  // key cone: centre + 4 rays at ~7 degrees
  const keyRays = [KEY_DIR];
  {
    const up = Math.abs(KEY_DIR[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const u = norm([KEY_DIR[1] * up[2] - KEY_DIR[2] * up[1], KEY_DIR[2] * up[0] - KEY_DIR[0] * up[2], KEY_DIR[0] * up[1] - KEY_DIR[1] * up[0]]);
    const v = [KEY_DIR[1] * u[2] - KEY_DIR[2] * u[1], KEY_DIR[2] * u[0] - KEY_DIR[0] * u[2], KEY_DIR[0] * u[1] - KEY_DIR[1] * u[0]];
    const e = 0.12;
    for (const [a, b] of [[e, 0], [-e, 0], [0, e], [0, -e]]) keyRays.push(norm([KEY_DIR[0] + u[0] * a + v[0] * b, KEY_DIR[1] + u[1] * a + v[1] * b, KEY_DIR[2] + u[2] * a + v[2] * b]));
  }
  const skyRays = fibonacciSphere(48).filter((d) => d[1] > 0.5).slice(0, 12);
  for (let cy = 0; cy < CY; cy++) {
    for (let cz = 0; cz < CZ; cz++) {
      for (let cx = 0; cx < CX; cx++) {
        const ix = Math.min(DX - 1, cx * SX);
        const iy = Math.min(DY - 1, cy * SY);
        const iz = Math.min(DZ - 1, cz * SZ);
        const [x, y, z] = centre(ix, iy, iz);
        const i = cat(cx, cy, cz);
        if (grid.inside(x, y, z)) continue;
        valid[i] = 1;
        let kv = 0;
        for (const d of keyRays) if (grid.hit(x, y, z, d[0], d[1], d[2], cfg.keyRange) === Infinity) kv++;
        keyC[i] = kv / keyRays.length;
        let sv = 0;
        for (const d of skyRays) if (grid.hit(x, y, z, d[0], d[1], d[2], cfg.skyRange) === Infinity) sv++;
        skyC[i] = sv / skyRays.length;
      }
    }
  }
  // fill invalid lattice nodes from valid neighbours
  for (let pass = 0; pass < 6; pass++) {
    const nv = valid.slice();
    for (let cy = 0; cy < CY; cy++)
      for (let cz = 0; cz < CZ; cz++)
        for (let cx = 0; cx < CX; cx++) {
          const i = cat(cx, cy, cz);
          if (valid[i]) continue;
          let k = 0;
          let s = 0;
          let q = 0;
          for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
            const x = cx + a;
            const y = cy + b;
            const z = cz + c;
            if (x < 0 || y < 0 || z < 0 || x >= CX || y >= CY || z >= CZ) continue;
            const j = cat(x, y, z);
            if (!valid[j]) continue;
            k++;
            s += keyC[j];
            q += skyC[j];
          }
          if (k) {
            keyC[i] = s / k;
            skyC[i] = q / k;
            nv[i] = 1;
          }
        }
    valid.set(nv);
  }
  const trilerp = (arr, fx, fy, fz) => {
    const x = Math.min(CX - 1.001, Math.max(0, fx));
    const y = Math.min(CY - 1.001, Math.max(0, fy));
    const z = Math.min(CZ - 1.001, Math.max(0, fz));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const tx = x - x0;
    const ty = y - y0;
    const tz = z - z0;
    const g = (a, b, c) => arr[cat(x0 + a, y0 + b, z0 + c)];
    const l00 = g(0, 0, 0) * (1 - tx) + g(1, 0, 0) * tx;
    const l10 = g(0, 1, 0) * (1 - tx) + g(1, 1, 0) * tx;
    const l01 = g(0, 0, 1) * (1 - tx) + g(1, 0, 1) * tx;
    const l11 = g(0, 1, 1) * (1 - tx) + g(1, 1, 1) * tx;
    return (l00 * (1 - ty) + l10 * ty) * (1 - tz) + (l01 * (1 - ty) + l11 * ty) * tz;
  };
  const keyVis = new Float32Array(N);
  const skyOpen = new Float32Array(N);
  for (let iy = 0; iy < DY; iy++)
    for (let iz = 0; iz < DZ; iz++)
      for (let ix = 0; ix < DX; ix++) {
        const i = at(ix, iy, iz);
        keyVis[i] = trilerp(keyC, ix / SX, iy / SY, iz / SZ);
        skyOpen[i] = trilerp(skyC, ix / SX, iy / SY, iz / SZ);
      }
  log(`key/sky lattice ${CX}x${CY}x${CZ} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

  // ---- ambient visibility: AO × a mild sky-openness term, normalised per section ---
  const sections = level.sections.length;
  const sum = new Float64Array(sections);
  const cnt = new Float64Array(sections);
  const vis = new Float32Array(N).fill(1);
  for (let iy = 0; iy < DY; iy++) {
    const s = secOf(cfg.min[1] + (iy + 0.5) * vox[1]);
    for (let iz = 0; iz < DZ; iz++)
      for (let ix = 0; ix < DX; ix++) {
        const i = at(ix, iy, iz);
        if (solid[i]) continue;
        const v = ao[i] * (0.72 + 0.28 * Math.sqrt(skyOpen[i]));
        vis[i] = v;
        if (nearSurf[i]) {
          sum[s] += v;
          cnt[s]++;
        }
      }
  }
  const scale = new Float64Array(sections).fill(1);
  for (let s = 0; s < sections; s++) if (cnt[s] > 50) scale[s] = Math.min(1.5, cfg.aoTarget / (sum[s] / cnt[s]));
  log('section mean visibility (before scale): ' + Array.from(sum, (v, s) => (cnt[s] ? (v / cnt[s]).toFixed(2) : '-')).join(' '));
  for (let iy = 0; iy < DY; iy++) {
    const s = secOf(cfg.min[1] + (iy + 0.5) * vox[1]);
    for (let iz = 0; iz < DZ; iz++)
      for (let ix = 0; ix < DX; ix++) {
        const i = at(ix, iy, iz);
        if (!solid[i]) vis[i] = Math.max(cfg.aoFloor, Math.min(1, vis[i] * scale[s]));
      }
  }

  // ---- bounce light: level lights + shaft fills ------------------------------
  const eWarm = new Float32Array(N);
  const eCool = new Float32Array(N);
  const lamps = (level.lights || []).map((l) => ({
    x: l.x,
    y: l.y,
    z: l.z || 0,
    range: Math.max(2, l.range || 12),
    candela: Math.max(0, l.intensity == null ? 1 : l.intensity) * Math.max(6, 0.06 * (l.range || 12) * (l.range || 12)) * 1.6,
    warm: isWarm(l.color),
  }));
  const offs = [[0, 0, 0], [0.9, 0, 0], [-0.9, 0, 0], [0, 0.9, 0], [0, 0, 0.9], [0, 0, -0.9]];
  for (const L of lamps) {
    const reach = L.range * 1.5;
    const i0 = Math.max(0, Math.floor((L.x - reach - cfg.min[0]) / vox[0]));
    const i1 = Math.min(DX - 1, Math.floor((L.x + reach - cfg.min[0]) / vox[0]));
    const j0 = Math.max(0, Math.floor((L.y - reach - cfg.min[1]) / vox[1]));
    const j1 = Math.min(DY - 1, Math.floor((L.y + reach - cfg.min[1]) / vox[1]));
    const k0 = Math.max(0, Math.floor((L.z - reach - cfg.min[2]) / vox[2]));
    const k1 = Math.min(DZ - 1, Math.floor((L.z + reach - cfg.min[2]) / vox[2]));
    for (let iy = j0; iy <= j1; iy++)
      for (let iz = k0; iz <= k1; iz++)
        for (let ix = i0; ix <= i1; ix++) {
          const i = at(ix, iy, iz);
          if (solid[i]) continue;
          const [x, y, z] = centre(ix, iy, iz);
          const dx = L.x - x;
          const dy = L.y - y;
          const dz = L.z - z;
          const d = Math.hypot(dx, dy, dz);
          if (d > reach) continue;
          let seen = 0;
          for (const o of offs) {
            const tx = L.x + o[0] - x;
            const ty = L.y + o[1] - y;
            const tz = L.z + o[2] - z;
            const td = Math.hypot(tx, ty, tz);
            if (td < 0.3) {
              seen++;
              continue;
            }
            if (grid.hit(x, y, z, tx / td, ty / td, tz / td, td - 0.35) === Infinity) seen++;
          }
          const sv = seen / offs.length;
          const w = clamp01(1 - (d / reach) * (d / reach));
          const e = ((cfg.bounce * L.candela) / (d * d + 3)) * w * w * (0.12 + 0.88 * sv);
          if (L.warm) eWarm[i] += e;
          else eCool[i] += e;
        }
  }
  const shafts = level.decor.filter((d) => d.type === 'shaft-light');
  for (const S of shafts) {
    const rad = Math.max(S.sx, S.sz) * 0.5;
    const halfH = S.sy * 0.5;
    const reach = rad + 9;
    const warm = isWarm(S.color);
    const i0 = Math.max(0, Math.floor((S.x - reach - cfg.min[0]) / vox[0]));
    const i1 = Math.min(DX - 1, Math.floor((S.x + reach - cfg.min[0]) / vox[0]));
    const j0 = Math.max(0, Math.floor((S.y - halfH - cfg.min[1]) / vox[1]));
    const j1 = Math.min(DY - 1, Math.floor((S.y + halfH - cfg.min[1]) / vox[1]));
    const k0 = Math.max(0, Math.floor((S.z - reach - cfg.min[2]) / vox[2]));
    const k1 = Math.min(DZ - 1, Math.floor((S.z + reach - cfg.min[2]) / vox[2]));
    for (let iy = j0; iy <= j1; iy++)
      for (let iz = k0; iz <= k1; iz++)
        for (let ix = i0; ix <= i1; ix++) {
          const i = at(ix, iy, iz);
          if (solid[i]) continue;
          const [x, y, z] = centre(ix, iy, iz);
          const dh = Math.hypot(x - S.x, z - S.z);
          const out = Math.max(0, dh - rad);
          const vy = clamp01((halfH - Math.abs(y - S.y)) / 6);
          const f = Math.exp(-out / 3.2) * vy;
          if (f < 0.01) continue;
          // occlusion toward the nearest point of the beam axis
          const ax = S.x;
          const az = S.z;
          const tx = ax - x;
          const tz = az - z;
          const td = Math.hypot(tx, tz);
          const sv = td < 0.5 ? 1 : grid.hit(x, y, z, tx / td, 0, tz / td, td) === Infinity ? 1 : 0.15;
          const e = 0.3 * f * sv;
          if (warm) eWarm[i] += e;
          else eCool[i] += e;
        }
  }
  log(`bounce: ${lamps.length} lights, ${shafts.length} shafts (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

  // ---- push values out of solids (nearest open voxel) -------------------------
  const filled = new Uint8Array(N);
  for (let i = 0; i < N; i++) filled[i] = solid[i] ? 0 : 1;
  for (let pass = 0; pass < 8; pass++) {
    const nf = filled.slice();
    const sA = vis.slice();
    const sB = keyVis.slice();
    const sW = eWarm.slice();
    const sC = eCool.slice();
    for (let iy = 0; iy < DY; iy++)
      for (let iz = 0; iz < DZ; iz++)
        for (let ix = 0; ix < DX; ix++) {
          const i = at(ix, iy, iz);
          if (filled[i]) continue;
          let k = 0;
          let a = 0;
          let b = 0;
          let w = 0;
          let c = 0;
          for (const [ox, oy, oz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
            const x = ix + ox;
            const y = iy + oy;
            const z = iz + oz;
            if (x < 0 || y < 0 || z < 0 || x >= DX || y >= DY || z >= DZ) continue;
            const j = at(x, y, z);
            if (!filled[j]) continue;
            k++;
            a += vis[j];
            b += keyVis[j];
            w += eWarm[j];
            c += eCool[j];
          }
          if (k) {
            sA[i] = a / k;
            sB[i] = b / k;
            sW[i] = w / k;
            sC[i] = c / k;
            nf[i] = 1;
          }
        }
    filled.set(nf);
    vis.set(sA);
    keyVis.set(sB);
    eWarm.set(sW);
    eCool.set(sC);
  }
  // anything still unfilled (deep inside the thick hall walls) stays at neutral values
  for (let i = 0; i < N; i++) {
    if (!filled[i]) {
      vis[i] = 1;
      keyVis[i] = 1;
    }
  }

  // ---- encode ------------------------------------------------------------------
  const raw = new Uint8Array(N * 4);
  for (let iy = 0; iy < DY; iy++)
    for (let iz = 0; iz < DZ; iz++)
      for (let ix = 0; ix < DX; ix++) {
        const i = at(ix, iy, iz);
        const o = voxelIndex(cfg.dims, ix, iy, iz);
        const E = eWarm[i] + eCool[i];
        raw[o] = Math.round(255 * Math.sqrt(clamp01(E / 2)));
        raw[o + 1] = Math.round(255 * (E > 1e-4 ? eWarm[i] / E : 0.5));
        raw[o + 2] = Math.round(255 * clamp01(cfg.keyFloor + (1 - cfg.keyFloor) * keyVis[i]));
        raw[o + 3] = Math.round(255 * clamp01(vis[i]));
      }
  log(`baked in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return { raw, dims: cfg.dims, min: cfg.min, size: cfg.size, hash: levelGiHash(level) };
}

export function packBake(res) {
  const body = zlib.deflateSync(Buffer.from(delta(res.raw)), { level: 9 });
  const out = Buffer.alloc(GI_HEADER_BYTES + body.length);
  writeHeader(new DataView(out.buffer, out.byteOffset, GI_HEADER_BYTES), res);
  body.copy(out, GI_HEADER_BYTES);
  return out;
}

export function unpackBake(buf) {
  const h = readHeader(buf);
  if (!h) throw new Error('not a GI bake');
  const body = zlib.inflateSync(buf.subarray(GI_HEADER_BYTES));
  const raw = new Uint8Array(body.buffer, body.byteOffset, body.length);
  if (raw.length !== h.rawLength) throw new Error('GI bake length mismatch');
  undelta(raw);
  return Object.assign({ raw }, h);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const argOf = (n, d) => {
    const i = args.indexOf(n);
    return i >= 0 && args[i + 1] ? args[i + 1] : d;
  };
  const outFile = path.resolve(argOf('--out', DEFAULT_OUT));
  const level = new Level3D(LEVEL_DATA_3D, 'normal');
  if (args.includes('--verify')) {
    const buf = fs.readFileSync(outFile);
    const u = unpackBake(buf);
    const ok = u.hash === levelGiHash(level);
    console.log(`${outFile}: ${buf.length} bytes, dims ${u.dims.join('x')}, hash ${ok ? 'matches the level' : 'STALE (re-bake)'}`);
    process.exit(ok ? 0 : 1);
  }
  const res = bake(level, { log: (m) => console.log('[bake_gi]', m) });
  const buf = packBake(res);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, buf);
  let h = 0;
  for (const b of buf) h = (Math.imul(h, 31) + b) >>> 0;
  console.log(`[bake_gi] wrote ${outFile} (${(buf.length / 1024).toFixed(0)} KiB, raw ${(res.raw.length / 1048576).toFixed(1)} MiB, checksum ${h.toString(16)})`);
}
