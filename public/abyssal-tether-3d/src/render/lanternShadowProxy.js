/* ABYSSAL TETHER 3D — lanternShadowProxy.js
 * Low-poly stand-ins for the dynamic lantern-shadow casters (hands + launchers, body, creature): the depth-only dynamic pass drew
 * the full 27 k-triangle hand/launcher meshes, 9 k of body and 25 k of creature LOD1 into a 512^2 map where a texel is 1-4 cm.
 * `clusterGeometries` welds every vertex of one or more (skinned) geometries into a grid of `cell`-metre cells (centroid position,
 * the skin weights of the vertex nearest to it) and drops the collapsed triangles: ~10-15 times fewer triangles, same skeleton,
 * same silhouette to within a cell. Pure BufferGeometry maths (three only for the result), run once per mesh when it is discovered.
 */
import * as THREE from 'three';

const K = 8192;

/**
 * @param {THREE.BufferGeometry[]} geos  geometries sharing one local space (and, when skinned, one skeleton)
 * @param {number} cell  grid cell size in metres (geometry local units)
 * @returns {THREE.BufferGeometry|null}
 */
export function clusterGeometries(geos, cell) {
  const inv = 1 / Math.max(1e-4, cell);
  const skinned = geos.every((g) => g.attributes.skinIndex && g.attributes.skinWeight);
  const cellOf = new Map();
  const sum = []; // x,y,z,count per cluster (flat)
  const maps = [];
  for (const g of geos) {
    const pos = g.attributes.position;
    const map = new Int32Array(pos.count);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const key = ((Math.floor(x * inv) + 4096) * K + (Math.floor(y * inv) + 4096)) * K + (Math.floor(z * inv) + 4096);
      let c = cellOf.get(key);
      if (c === undefined) {
        c = sum.length / 4;
        cellOf.set(key, c);
        sum.push(0, 0, 0, 0);
      }
      sum[c * 4] += x;
      sum[c * 4 + 1] += y;
      sum[c * 4 + 2] += z;
      sum[c * 4 + 3]++;
      map[i] = c;
    }
    maps.push(map);
  }
  const n = sum.length / 4;
  if (n < 4 || n > 200000) return null;
  const px = new Float32Array(n * 3);
  const best = new Float32Array(n).fill(Infinity);
  const repG = new Int32Array(n);
  const repV = new Int32Array(n);
  for (let c = 0; c < n; c++) {
    px[c * 3] = sum[c * 4] / sum[c * 4 + 3];
    px[c * 3 + 1] = sum[c * 4 + 1] / sum[c * 4 + 3];
    px[c * 3 + 2] = sum[c * 4 + 2] / sum[c * 4 + 3];
  }
  for (let gi = 0; gi < geos.length; gi++) {
    const pos = geos[gi].attributes.position;
    const map = maps[gi];
    for (let i = 0; i < pos.count; i++) {
      const c = map[i];
      const dx = pos.getX(i) - px[c * 3], dy = pos.getY(i) - px[c * 3 + 1], dz = pos.getZ(i) - px[c * 3 + 2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < best[c]) {
        best[c] = d;
        repG[c] = gi;
        repV[c] = i;
      }
    }
  }
  const idx = [];
  const seen = new Set();
  for (let gi = 0; gi < geos.length; gi++) {
    const g = geos[gi];
    const map = maps[gi];
    const ix = g.index;
    const tc = (ix ? ix.count : g.attributes.position.count) / 3;
    for (let t = 0; t < tc; t++) {
      const a = map[ix ? ix.getX(t * 3) : t * 3];
      const b = map[ix ? ix.getX(t * 3 + 1) : t * 3 + 1];
      const c = map[ix ? ix.getX(t * 3 + 2) : t * 3 + 2];
      if (a === b || b === c || a === c) continue;
      const lo = Math.min(a, b, c), hi = Math.max(a, b, c), mid = a + b + c - lo - hi;
      const key = (lo * n + mid) * n + hi;
      if (seen.has(key)) continue;
      seen.add(key);
      idx.push(a, b, c);
    }
  }
  if (idx.length < 12) return null;
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(px, 3));
  if (skinned) {
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let c = 0; c < n; c++) {
      const g = geos[repG[c]];
      const v = repV[c];
      for (let k = 0; k < 4; k++) {
        si[c * 4 + k] = g.attributes.skinIndex.getComponent(v, k);
        sw[c * 4 + k] = g.attributes.skinWeight.getComponent(v, k);
      }
    }
    out.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    out.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  }
  out.setIndex(new THREE.BufferAttribute(n > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), 1));
  out.computeBoundingSphere();
  return out;
}
