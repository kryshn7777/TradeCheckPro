// Node tests for the levels of detail of the environment kit (render/levelView.js LodSet, cullBuried) and the kit file itself (no GPU):
//   - ch1_env_kit.glb: every detailed part has a rich (_lod0), a medium and (where it saves anything) a far (_lod2) level, triangle counts
//     fall level by level, the bounds agree (the far level never loses a silhouette), nothing else changed shape;
//   - LodSet: the level per distance, the hysteresis, the missing levels, hidden beyond the limits, one index of exactly the chosen ranges,
//     appending keeps the earlier records, the throttle;
//   - cullBuried: a face pressed into a solid goes, the others stay.
//   node test-kit-lod.mjs [--root DIR]
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register as reg } from 'node:module';
import { readGLB } from './glbRead.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, '../../../../public/abyssal-tether-3d');
const VENDOR = pathToFileURL(path.join(GAME, 'vendor/three/')).href;
reg(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR}three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const THREE = await import('three');
const { LodSet, cullBuried } = await import(pathToFileURL(path.join(GAME, 'src/render/levelView.js')).href);

let n = 0;
const ok = async (name, fn) => {
  await fn();
  n++;
  console.log('  ok ' + name);
};

// -- the kit file ----------------------------------------------------------------------------------------------------------------------
const g = await readGLB(path.join(GAME, 'assets/models/env/ch1_env_kit.glb'));
const parts = new Map(); // name -> { tris, min, max }
g.js.nodes.forEach((node) => {
  if (node.mesh === undefined) return;
  const prim = g.js.meshes[node.mesh].primitives[0];
  const a = g.js.accessors[prim.attributes.POSITION];
  parts.set((node.name || '').replace(/^ch1_env_/, ''), { tris: g.js.accessors[prim.indices].count / 3, min: a.min, max: a.max });
});
await ok('every part with a _lod0 has the medium level, and most have a far level', () => {
  const lod0 = [...parts.keys()].filter((k) => k.endsWith('_lod0')).map((k) => k.slice(0, -5));
  assert.ok(lod0.length >= 20, 'rich levels: ' + lod0.length);
  let far = 0;
  for (const p of lod0) {
    assert.ok(parts.has(p), p + ' medium level');
    if (parts.has(p + '_lod2')) far++;
  }
  assert.ok(far >= lod0.length - 4, 'far levels: ' + far + ' of ' + lod0.length);
});
await ok('triangles fall level by level (rich > medium > far) and the far level is at most 80 % of the medium one', () => {
  let rich = 0;
  let med = 0;
  let far = 0;
  for (const [k, v] of parts) {
    if (!k.endsWith('_lod0')) continue;
    const p = k.slice(0, -5);
    const m = parts.get(p);
    assert.ok(v.tris > m.tris, `${p}: rich ${v.tris} > medium ${m.tris}`);
    rich += v.tris;
    med += m.tris;
    const f = parts.get(p + '_lod2');
    if (f) {
      assert.ok(f.tris < m.tris * 0.8 + 1, `${p}: far ${f.tris} < 80 % of medium ${m.tris}`);
      far += f.tris;
    }
  }
  console.log(`      (rich ${rich}, medium ${med}, far ${far} triangles over the parts that have all three)`);
});
await ok('the levels of a part have the same bounds (no silhouette lost): within 12 % of the medium level on every axis longer than 0.5 m', () => {
  for (const [k, v] of parts) {
    const m = /_lod[02]$/.test(k) ? parts.get(k.replace(/_lod[02]$/, '')) : null;
    if (!m) continue;
    for (let a = 0; a < 3; a++) {
      const ext = m.max[a] - m.min[a];
      if (ext < 0.5) continue;
      assert.ok(Math.abs(v.max[a] - v.min[a] - ext) <= 0.12 * ext, `${k} axis ${a}: ${(v.max[a] - v.min[a]).toFixed(2)} vs ${ext.toFixed(2)}`);
    }
  }
});

// -- LodSet ---------------------------------------------------------------------------------------------------------------------------
function tri(n, x = 0) {
  // n triangles in the non-indexed layout of the dressing: position, normal, colour, uv
  const p = new Float32Array(n * 9);
  for (let i = 0; i < n * 9; i += 3) {
    p[i] = x + (i % 7) * 0.01;
    p[i + 1] = (i % 5) * 0.01;
    p[i + 2] = (i % 3) * 0.01;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
  const nrm = new Float32Array(n * 9);
  for (let i = 2; i < n * 9; i += 3) nrm[i] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 9).fill(0.5), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 6), 2));
  return geo;
}
const rec = (x, tris = [30, 20, 8], maxD = Infinity) => ({ isLodRec: true, geos: tris.map((t) => (t ? tri(t, x) : null)), x, y: 0, z: 0, r: 0.5, maxD });
const drawn = (set) => set.rg.drawRange.count / 3;

await ok('LodSet: rich level close, medium in the middle, far beyond; the draw range is exactly the chosen triangles', () => {
  const set = new LodSet();
  set.add([rec(0), rec(100)]); // one at the head, one 100 m away
  set.update(0, 0, 0, 10, 24, 1, 1000, true);
  assert.deepEqual([...set.stats], [1, 0, 1]);
  assert.equal(drawn(set), 30 + 8);
  assert.equal(set.rg.attributes.normal.normalized, true, 'compact normals');
  assert.ok(set.rg.attributes.color.array instanceof Uint16Array, 'half-float colours');
  set.update(18, 0, 0, 10, 24, 1, 1000, true); // the first one is 17.5 m away now: medium; the second one 82 m
  assert.deepEqual([...set.stats], [0, 1, 1]);
  assert.equal(drawn(set), 20 + 8);
});
await ok('LodSet: the index lists exactly the vertices of the chosen levels', () => {
  const set = new LodSet();
  set.add([rec(0, [3, 2, 1]), rec(50, [3, 2, 1])]);
  set.update(0, 0, 0, 10, 24, 1, 1000, true);
  const a = set.index.array;
  const count = set.rg.drawRange.count;
  assert.equal(count, 9 + 3); // rec 0 rich (3 triangles), rec 1 far (1 triangle)
  const v = [...a.slice(0, count)];
  assert.deepEqual(v.slice(0, 9), [0, 1, 2, 3, 4, 5, 6, 7, 8]); // the rich level of the first record starts the soup
  assert.ok(v.slice(9).every((i, k) => i === v[9] + k), 'a contiguous far range');
  assert.equal(new Set(v).size, v.length, 'no vertex twice');
});
await ok('LodSet: hysteresis (a level is left only 12 % past its limit) and no change means no rewrite', () => {
  const set = new LodSet();
  set.add([rec(0)]);
  set.update(0, 0, 0, 10, 24, 1, 1000, true);
  assert.equal(set.recs[0].cur, 0);
  const flag = () => {
    set.index.needsUpdate = false;
    return set;
  };
  flag();
  set.update(10.2 + 0.5, 0, 0, 10, 24, 1, 1000, true); // d = 10.2, inside 10 * 1.12
  assert.equal(set.recs[0].cur, 0);
  assert.equal(set.index.version, set.index.version);
  set.update(11.7 + 0.5, 0, 0, 10, 24, 1, 1000, true); // d = 11.7 > 11.2: medium
  assert.equal(set.recs[0].cur, 1);
  set.update(9.5 + 0.5, 0, 0, 10, 24, 1, 1000, true); // back at 9.5 m: still medium (needs < 8.8)
  assert.equal(set.recs[0].cur, 1);
  set.update(8.5 + 0.5, 0, 0, 10, 24, 1, 1000, true);
  assert.equal(set.recs[0].cur, 0);
});
await ok('LodSet: a part without a rich / far level uses the nearest one it has', () => {
  const set = new LodSet();
  set.add([rec(0, [0, 20, 8]), rec(0, [30, 20, 0]), rec(0, [0, 20, 0])]);
  set.update(0, 0, 0, 10, 24, 1, 1000, true);
  assert.deepEqual([...set.stats], [1, 2, 0]); // no rich -> medium; rich present
  set.update(100, 0, 0, 10, 24, 1, 1000, true);
  assert.deepEqual([...set.stats], [0, 2, 1]); // far for the one that has it, medium for the others
});
await ok('LodSet: beyond its distance limit or the fog a record is not drawn at all', () => {
  const set = new LodSet();
  set.add([rec(0, [30, 20, 8], 32), rec(0, [30, 20, 8], Infinity)]);
  set.update(0, 0, 0, 10, 24, 1, 1000, true);
  assert.equal(drawn(set), 60);
  set.update(0, 0, 40, 10, 24, 1, 1000, true); // 39.5 m: past the 32 m of the first; the second shows its far level
  assert.equal(drawn(set), 8);
  set.update(0, 0, 40, 10, 24, 1, 20, true); // the fog culls at 20 m: neither
  assert.equal(drawn(set), 0);
  set.update(0, 0, 0, 10, 24, 0.5, 1000, true); // detail scale 0.5: the limit of the first one is 16 m
  assert.equal(drawn(set), 60);
});
await ok('LodSet: appending records keeps the earlier ones (same levels, offsets, draw range)', () => {
  const set = new LodSet();
  set.add([rec(0, [3, 2, 1])]);
  set.update(0, 0, 0, 10, 24, 1, 1000, true);
  const rg1 = set.rg;
  const rg2 = set.add([rec(60, [3, 2, 1])]);
  assert.notEqual(rg1, rg2);
  assert.equal(set.recs.length, 2);
  assert.equal(set.soup.attributes.position.count, 18 + 18);
  set.update(0, 0, 0, 10, 24, 1, 1000, true);
  assert.deepEqual([...set.stats], [1, 0, 1]);
  assert.equal(drawn(set), 3 + 1);
});
await ok('LodSet: the throttle (every 3rd frame, and only after the head moved 15 cm)', () => {
  const set = new LodSet();
  set.add([rec(0)]);
  assert.ok(set.update(0, 0, 0, 10, 24, 1, 1000, false), 'the first call evaluates');
  assert.equal(set.update(0.01, 0, 0, 10, 24, 1, 1000, false), false, 'frame 2: throttled');
  assert.equal(set.update(0.02, 0, 0, 10, 24, 1, 1000, false), false, 'frame 3: the head has not moved 15 cm');
  assert.equal(set.update(30, 0, 0, 10, 24, 1, 1000, false), false, 'frame 4: moved, but throttled');
  assert.equal(set.update(30, 0, 0, 10, 24, 1, 1000, false), false, 'frame 5: throttled');
  assert.equal(set.update(30, 0, 0, 10, 24, 1, 1000, false), true, 'frame 6: evaluates (a level changed)');
});

// -- section packs (MESH_DETAIL_AND_OPTIMIZATION.md O1): plain records with a box, the neighbour cap, partial rewrites, drawn bounds ----
const plainRec = (x, tris, maxD = Infinity) => ({ isLodRec: true, plain: true, geos: [null, tri(tris, x), null], box: [x - 1, -1, -1, x + 1, 1, 1], x, y: 0, z: 0, r: 1.7, maxD });
await ok('LodSet packs: a plain record is measured to its box and culled by its tier distance, the fog and the neighbour cap', () => {
  const set = new LodSet();
  set.add([plainRec(0, 10), plainRec(30, 12, 26), rec(60, [30, 20, 8])]);
  set.update(0, 0, 0, 10, 24, 1, 1000, true); // box 2: 29 m away (> 26: culled); kit record: 59.5 m (far level)
  assert.equal(drawn(set), 10 + 8);
  set.update(4, 0, 0, 10, 24, 1, 1000, true); // box 2 now 25 m away: drawn
  assert.equal(drawn(set), 10 + 12 + 8);
  set.update(4, 0, 0, 10, 24, 1, 1000, true, 20); // a neighbour pack: nothing beyond 20 m
  assert.equal(drawn(set), 10);
  assert.equal(set.drawnTris, 10);
  const bs = set.rg.boundingSphere;
  assert.ok(bs && Math.abs(bs.center.x) < 1e-6 && bs.radius < 2, 'the bounds are those of what is drawn');
});
await ok('LodSet packs: a change rewrites (and uploads) only the index from the first changed record on', () => {
  const set = new LodSet();
  set.add([plainRec(0, 10), rec(5, [30, 20, 8])]);
  set.update(0, 0, 0, 10, 24, 1, 1000, true);
  const head = [...set.index.array.slice(0, 30)];
  set.update(20, 0, 0, 10, 24, 1, 1000, true); // the kit record goes rich -> medium; the box record stays
  assert.deepEqual([...set.index.array.slice(0, 30)], head, 'the plain record keeps its indices');
  const ranges = set.index.updateRanges;
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].start, 30, 'the upload starts after the unchanged record');
  assert.equal(drawn(set), 10 + 20);
});

// -- cullBuried -----------------------------------------------------------------------------------------------------------------------
await ok('cullBuried: faces pressed into a wall go, the others stay', () => {
  const wall = { minX: -5, maxX: 0, minY: -5, maxY: 5, minZ: -5, maxZ: 5, kind: 'wall', active: true };
  const level = { querySolidsStatic: (x0, y0, z0, x1, y1, z1, out) => ((out.length = 0), out.push(wall), out) };
  const geo = new THREE.BufferGeometry();
  // triangle A faces -x (into the wall), triangle B faces +x (into the air); both sit at x = -1 .. 0.2
  const pos = [-1, 0, 0, -1, 1, 0, -1, 0, 1, 0.2, 0, 0, 0.2, 0, 1, 0.2, 1, 0];
  const nrm = [-1, 0, 0, -1, 0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0];
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  const r = cullBuried(geo, level);
  assert.equal(r.removed, 1);
  assert.equal(r.geo.attributes.position.count, 3);
  assert.equal(r.geo.attributes.normal.getX(0), 1);
  const other = { ...wall, kind: 'crumble' };
  const lv2 = { querySolidsStatic: (a, b, c, d, e, f, out) => ((out.length = 0), out.push(other), out) };
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g2.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  assert.equal(cullBuried(g2, lv2).removed, 0, 'a crumbling ledge can disappear: nothing is hidden by it');
});

console.log(`kit lod: ${n} checks passed`);
