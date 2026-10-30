/* ABYSSAL TETHER 3D — levelBuildFast.js
 * Faster, bit-identical versions of the level view's costliest build steps (docs/abyssal-tether-3d/plans/LOADING_OPTIMIZATION.md).
 * Each returns null when its fast path does not apply; the caller then runs its original code.
 *
 *  - cullBuriedFast: levelView.cullBuried (drop the dressing triangles whose outward side lies inside a permanent solid) reading the
 *    plain float arrays directly and testing each triangle against the few solids near the WHOLE geometry (one spatial query per
 *    geometry instead of one per triangle). Same arithmetic in the same order (centroid sums, Math.hypot, the strict margin test), so
 *    the same triangles are kept: a solid that strictly contains a test point (margin 0.02 m) overlaps the geometry's box grown by the
 *    0.04 m offset, so it is among the candidates.
 */
import * as THREE from 'three';

/**
 * ?loadopt=0: every loading optimisation off (the original code paths: A/B shots, bug hunts). LOADOPT.on can also be flipped at run time
 * (the geometry hash comparison builds the same level both ways in one page).
 */
export const LOADOPT = { on: !(typeof location !== 'undefined' && /[?&]loadopt=0\b/.test(location.search || '')) };

const _cand = [];
const _q = [];
const MAX_CAND = 48; // more candidates than this (a geometry spanning a whole room): the per-triangle query of the original is faster

function plainFloat3(a) {
  return a && !a.isInterleavedBufferAttribute && !a.normalized && a.itemSize === 3 && a.array instanceof Float32Array;
}

/**
 * @returns {{geo: THREE.BufferGeometry, removed: number}|null} null: not applicable (the caller's generic loop runs)
 */
export function cullBuriedFast(geo, level, p, n, tris, kinds, o, m) {
  if (!LOADOPT.on || !plainFloat3(p) || !plainFloat3(n) || tris <= 0) return null;
  for (const name of Object.keys(geo.attributes)) if (geo.attributes[name].isInterleavedBufferAttribute) return null;
  const P = p.array;
  const N = n.array;
  const nv = tris * 3;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i < nv; i++) {
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
    if (z < z0) z0 = z;
    if (z > z1) z1 = z;
  }
  if (!(x1 >= x0 && y1 >= y0 && z1 >= z0)) return null; // NaN positions: the original handles them
  const res = level.querySolidsStatic(x0 - o, y0 - o, z0 - o, x1 + o, y1 + o, z1 + o, _q);
  let nc = 0;
  for (let i = 0; i < res.length; i++) {
    const s = res[i];
    if (s.active === false || !kinds.has(s.kind)) continue;
    _cand[nc++] = s;
  }
  _cand.length = nc;
  if (nc > MAX_CAND) return null;
  if (nc === 0) return { geo, removed: 0 }; // nothing near: no triangle can be buried
  const keep = new Uint8Array(tris);
  let kept = 0;
  for (let t = 0; t < tris; t++) {
    const a = t * 9;
    // the original's arithmetic, in its order: (getX(a) + getX(a + 1) + getX(a + 2)) / 3 ...
    const cx = (P[a] + P[a + 3] + P[a + 6]) / 3;
    const cy = (P[a + 1] + P[a + 4] + P[a + 7]) / 3;
    const cz = (P[a + 2] + P[a + 5] + P[a + 8]) / 3;
    let nx = N[a] + N[a + 3] + N[a + 6];
    let ny = N[a + 1] + N[a + 4] + N[a + 7];
    let nz = N[a + 2] + N[a + 5] + N[a + 8];
    const nl = Math.hypot(nx, ny, nz);
    let buried = false;
    if (nl > 1e-6) {
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const x = cx + nx * o;
      const y = cy + ny * o;
      const z = cz + nz * o;
      for (let i = 0; i < nc; i++) {
        const s = _cand[i];
        if (x > s.minX + m && x < s.maxX - m && y > s.minY + m && y < s.maxY - m && z > s.minZ + m && z < s.maxZ - m) {
          buried = true;
          break;
        }
      }
    }
    if (!buried) {
      keep[t] = 1;
      kept++;
    }
  }
  _cand.length = 0;
  if (kept === tris) return { geo, removed: 0 };
  const out = new THREE.BufferGeometry();
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.attributes[name];
    const src = a.array;
    const per = 3 * a.itemSize;
    const arr = new src.constructor(kept * per);
    let w = 0;
    let t = 0;
    // copy runs of kept triangles at once
    while (t < tris) {
      if (!keep[t]) {
        t++;
        continue;
      }
      let e = t + 1;
      while (e < tris && keep[e]) e++;
      arr.set(src.subarray(t * per, e * per), w);
      w += (e - t) * per;
      t = e;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  geo.dispose();
  return { geo: out, removed: tris - kept };
}

const _nm = new THREE.Matrix3();

/**
 * levelView._kitGeo (one placement of a kit part: clone, through the placement matrix, mirrored fix, tint, metric UVs) on plain arrays:
 * three's Vector3.applyMatrix4 / applyMatrix3 + normalize arithmetic in the same order, so every float32 written is the same. Returns
 * null unless the part is the plain non-indexed position / normal / colour (float32) geometry parseEnvKit makes.
 */
export function kitGeoFast(part, it, lst, tintColors, worldUV) {
  if (!LOADOPT.on) return null;
  const src = part && part.geo;
  if (!src || src.index || src.groups.length || Object.keys(src.morphAttributes).length) return null;
  const keys = Object.keys(src.attributes);
  if (keys.length !== 3 || keys[0] !== 'position' || keys[1] !== 'normal' || keys[2] !== 'color') return null;
  const P0 = src.attributes.position;
  const N0 = src.attributes.normal;
  const C0 = src.attributes.color;
  if (!plainFloat3(P0) || !plainFloat3(N0) || !plainFloat3(C0) || N0.count !== P0.count || C0.count !== P0.count) return null;
  const m = it.m;
  const e = m.elements;
  const n = P0.count;
  const ps = P0.array;
  const ns = N0.array;
  const P = new Float32Array(n * 3);
  const N = new Float32Array(n * 3);
  const C = new Float32Array(C0.array);
  for (let i = 0; i < n * 3; i += 3) {
    const x = ps[i], y = ps[i + 1], z = ps[i + 2];
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    P[i] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    P[i + 1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    P[i + 2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
  }
  const r = _nm.getNormalMatrix(m).elements;
  for (let i = 0; i < n * 3; i += 3) {
    const x = ns[i], y = ns[i + 1], z = ns[i + 2];
    let vx = r[0] * x + r[3] * y + r[6] * z;
    let vy = r[1] * x + r[4] * y + r[7] * z;
    let vz = r[2] * x + r[5] * y + r[8] * z;
    const s = 1 / (Math.sqrt(vx * vx + vy * vy + vz * vz) || 1);
    vx *= s;
    vy *= s;
    vz *= s;
    N[i] = vx;
    N[i + 1] = vy;
    N[i + 2] = vz;
  }
  // mirrored placements (negative determinant) would turn the part inside out: swap each triangle's 2nd and 3rd vertex
  if (m.determinant() < 0) {
    for (const A of [P, N, C]) {
      for (let v = 0; v + 2 < n; v += 3) {
        const a = (v + 1) * 3;
        const b = (v + 2) * 3;
        const x = A[a], y = A[a + 1], z = A[a + 2];
        A[a] = A[b];
        A[a + 1] = A[b + 1];
        A[a + 2] = A[b + 2];
        A[b] = x;
        A[b + 1] = y;
        A[b + 2] = z;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.name = src.name;
  const attr = (arr, a0) => {
    const a = new THREE.BufferAttribute(arr, 3);
    a.name = a0.name;
    a.usage = a0.usage;
    a.gpuType = a0.gpuType;
    return a;
  };
  g.setAttribute('position', attr(P, P0));
  g.setAttribute('normal', attr(N, N0));
  g.setAttribute('color', attr(C, C0));
  g.drawRange.start = src.drawRange.start;
  g.drawRange.count = src.drawRange.count;
  g.userData = src.userData;
  if (src.boundingBox !== null) g.computeBoundingBox(); // clone + applyMatrix4 recompute both from the moved positions
  if (src.boundingSphere !== null) g.computeBoundingSphere();
  tintColors(g, it.tint[0], it.tint[1], it.tint[2]);
  if (lst === 'glow') g.deleteAttribute('normal');
  else worldUV(g);
  return g;
}

/** Plain dressing geometries already culled (and packed) by precullStep: levelView._packBands does not cull them again. */
export const CULLED = new WeakSet();

/**
 * The dressing job's section-pack merge was one step of up to a few hundred ms (Quest: a long frame). Before it runs, the buried-face
 * culling of its geometries (most of its cost) is done here, ONE geometry or kit record per call, so the job's clock is checked between
 * them. Exactly what _packBands would do to each (packGeo then cullBuried for a plain geometry, cullBuried then packGeo per level for a kit
 * record, a record whose medium level vanished dropped), in the same order, so the pack it then merges is the same; every geometry is
 * also compacted (LodSet.add's 16-bit normals / colours, element-wise: the same bytes; _packBands takes a CULLED one as it is).
 * Returns true when it did a piece of work (more may remain), false when the item has nothing (left) to cull: the caller merges it.
 * @param {Array} item  a job.merge entry: [null, null, Map(band -> { [material]: list })] for a section pack (others are not culled here)
 * @param {object} H  levelView's own { cullBuried, packGeo, compactVertices, buried (BURIED_ON) }
 * @param {object} lv  the LevelView (its level and stats)
 */
export function precullStep(item, H, lv) {
  const level = lv && lv.level;
  if (!LOADOPT.on || !H.buried || !level || typeof level.querySolidsStatic !== 'function' || item[0] !== null || !(item[2] instanceof Map)) return false;
  const stats = lv.stats;
  let q = item._pre;
  if (!q) {
    q = item._pre = { lists: [], li: 0, i: 0 };
    for (const lists of item[2].values()) for (const k of Object.keys(lists)) if (Array.isArray(lists[k]) && lists[k].length) q.lists.push(lists[k]);
  }
  while (q.li < q.lists.length) {
    const list = q.lists[q.li];
    if (q.i >= list.length) {
      q.li++;
      q.i = 0;
      continue;
    }
    const g0 = list[q.i];
    if (g0 && g0.isLodRec) {
      if (g0._culled) {
        q.i++;
        continue;
      }
      g0.geos = g0.geos.map((g) => {
        if (!g) return null;
        const c = H.cullBuried(g, level);
        stats.buriedCulled = (stats.buriedCulled || 0) + c.removed;
        return c.geo.attributes.position.count ? H.packGeo(c.geo) : null;
      });
      if (!g0.geos[1]) {
        for (const g of g0.geos) if (g) g.dispose();
        list.splice(q.i, 1); // _packBands would drop it (buried whole): the rest keep their order
        return true;
      }
      for (const g of g0.geos) if (g) H.compactVertices(g);
      g0._culled = true;
      q.i++;
      return true;
    }
    if (!g0 || CULLED.has(g0)) {
      q.i++;
      continue;
    }
    let g = H.packGeo(g0);
    const c = H.cullBuried(g, level);
    stats.buriedCulled = (stats.buriedCulled || 0) + c.removed;
    if (c.geo !== g) g.dispose();
    g = c.geo;
    // compacted now too (LodSet.add would compact the merged cell: element-wise, so compacting the parts first gives the same bytes;
    // every plain geometry of the pack goes through here, so the cell merge sees one layout)
    H.compactVertices(g);
    CULLED.add(g);
    list[q.i++] = g;
    return true;
  }
  return false;
}

/**
 * The dressing job's per-frame budget (ms), from the main-thread time the rest of the last frame took (game._frameWorkMs: the loop
 * without the dressing): what is left of FRAME_TARGET, within [min, max] (playing: 1-6 ms, was a fixed 2; menu / loading: 2-10 ms, was 8).
 * Without a measurement (or ?loadopt=0) the fixed 2 / 8 of before.
 */
const FRAME_TARGET = 10; // ms of main-thread work per frame at 72 Hz (13.9 ms) that leaves the compositor its margin
export function dressBudgetMs(game) {
  const playing = !!(game && game.state === 'playing');
  const fixed = playing ? 2 : 8;
  if (!LOADOPT.on || !game || !(game._frameWorkMs >= 0)) return fixed;
  const lo = playing ? 1 : 2;
  const hi = playing ? 6 : 10;
  const left = FRAME_TARGET - game._frameWorkMs;
  return left < lo ? lo : left > hi ? hi : left;
}
