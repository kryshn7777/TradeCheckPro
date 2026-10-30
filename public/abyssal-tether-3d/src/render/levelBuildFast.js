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

/** ?loadopt=0: every loading optimisation off (the original code paths: A/B shots, geometry hash comparisons, bug hunts). */
export const LOADOPT_ON = !(typeof location !== 'undefined' && /[?&]loadopt=0\b/.test(location.search || ''));

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
  if (!LOADOPT_ON || !plainFloat3(p) || !plainFloat3(n) || tris <= 0) return null;
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
