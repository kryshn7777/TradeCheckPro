// Node tests for the loading optimisations (docs/abyssal-tether-3d/plans/LOADING_OPTIMIZATION.md), no GPU:
//   - cullBuried's fast path (render/levelBuildFast.js) keeps exactly the triangles the original per-triangle query kept, on random
//     geometry pressed into / lying on / floating off the real level's solids (bit-identical arrays);
//   - kitGeoFast gives the same float32 arrays as three's clone + applyMatrix4 + mirror fix of the original _kitGeo (random, mirrored and
//     scaled placements);
//   - precullStep: a kit record whose medium level is buried whole is dropped, a plain geometry is packed + culled once and marked;
//   - the dressing budget follows the measured frame work within its bounds (the fixed 2 / 8 ms without a measurement or ?loadopt=0);
//   - the level cache: the import parser finds the whole static closure of the build on the real tree (every file exists), the key's
//     inputs; slices -> arrays round trip (empty arrays, odd sizes) and a short / extra slice is an error, not a wrong level.
//   node test-loading.mjs [--root DIR]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register as reg } from 'node:module';

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
const src = (f) => pathToFileURL(path.join(GAME, 'src', f)).href;
const { cullBuried } = await import(src('render/levelView.js'));
const F = await import(src('render/levelBuildFast.js'));
const LC = await import(src('render/levelCache.js'));
const { Level3D } = await import(src('sim/level3d.js'));

let n = 0;
const ok = async (name, fn) => {
  await fn();
  n++;
  console.log('  ok ' + name);
};

let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

// -- cullBuried: the original algorithm, verbatim (per-triangle query through the attribute accessors) ------------------------------------
const KINDS = new Set(['wall', 'stone', 'metal', 'pillar']);
function refCull(geo, level) {
  const p = geo.attributes.position;
  const nn = geo.attributes.normal;
  const tris = (p.count / 3) | 0;
  const keep = new Uint8Array(tris);
  let kept = 0;
  const o = 0.04;
  const m = 0.02;
  const q = [];
  for (let t = 0; t < tris; t++) {
    const a = t * 3;
    const cx = (p.getX(a) + p.getX(a + 1) + p.getX(a + 2)) / 3;
    const cy = (p.getY(a) + p.getY(a + 1) + p.getY(a + 2)) / 3;
    const cz = (p.getZ(a) + p.getZ(a + 1) + p.getZ(a + 2)) / 3;
    let nx = nn.getX(a) + nn.getX(a + 1) + nn.getX(a + 2);
    let ny = nn.getY(a) + nn.getY(a + 1) + nn.getY(a + 2);
    let nz = nn.getZ(a) + nn.getZ(a + 1) + nn.getZ(a + 2);
    const nl = Math.hypot(nx, ny, nz);
    let buried = false;
    if (nl > 1e-6) {
      nx /= nl;
      ny /= nl;
      nz /= nl;
      const x = cx + nx * o;
      const y = cy + ny * o;
      const z = cz + nz * o;
      const res = level.querySolidsStatic(x, y, z, x, y, z, q);
      for (let i = 0; i < res.length; i++) {
        const s = res[i];
        if (s.active === false || !KINDS.has(s.kind)) continue;
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
  return { keep, kept };
}

/** A soup of `tris` triangles around point (x, y, z) within `r`, normals random (some pointing into the solid, some out, some zero). */
function soup(x, y, z, r, tris) {
  const P = new Float32Array(tris * 9);
  const N = new Float32Array(tris * 9);
  const C = new Float32Array(tris * 9);
  for (let t = 0; t < tris; t++) {
    const cx = x + (rnd() * 2 - 1) * r, cy = y + (rnd() * 2 - 1) * r, cz = z + (rnd() * 2 - 1) * r;
    const zero = rnd() < 0.03;
    const nx = zero ? 0 : rnd() * 2 - 1, ny = zero ? 0 : rnd() * 2 - 1, nz = zero ? 0 : rnd() * 2 - 1;
    for (let v = 0; v < 3; v++) {
      const i = t * 9 + v * 3;
      P[i] = cx + (rnd() - 0.5) * 0.3;
      P[i + 1] = cy + (rnd() - 0.5) * 0.3;
      P[i + 2] = cz + (rnd() - 0.5) * 0.3;
      N[i] = nx;
      N[i + 1] = ny;
      N[i + 2] = nz;
      C[i] = rnd();
      C[i + 1] = rnd();
      C[i + 2] = rnd();
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(tris * 6).map(() => rnd()), 2));
  return g;
}

const level = new Level3D(undefined, 'normal');
await ok('cullBuried fast path == the original per-triangle query (random soups on the real level, 600 geometries)', () => {
  const solids = level.solids.filter((s) => KINDS.has(s.kind));
  assert.ok(solids.length > 50, 'level solids');
  let removed = 0;
  let total = 0;
  for (let k = 0; k < 600; k++) {
    const s = solids[(rnd() * solids.length) | 0];
    // on a face of the solid (where the dressing presses into the walls), or inside, or just off it
    const face = (rnd() * 6) | 0;
    let x = s.minX + rnd() * (s.maxX - s.minX), y = s.minY + rnd() * (s.maxY - s.minY), z = s.minZ + rnd() * (s.maxZ - s.minZ);
    if (face === 0) x = s.minX;
    else if (face === 1) x = s.maxX;
    else if (face === 2) z = s.minZ;
    else if (face === 3) z = s.maxZ;
    const r = k % 7 === 0 ? 6 : 0.4; // some geometries span a room (many candidates)
    const g = soup(x, y, z, r, 4 + ((rnd() * 60) | 0));
    const ref = refCull(g, level);
    const before = {};
    for (const nm of Object.keys(g.attributes)) before[nm] = g.attributes[nm].array.slice();
    const res = cullBuried(g, level);
    const tris = g.attributes.position.count / 3;
    total += tris;
    removed += res.removed;
    assert.equal(res.removed, tris - ref.kept, 'removed count');
    if (res.removed === 0) {
      assert.equal(res.geo, g, 'nothing buried: the same geometry');
      continue;
    }
    for (const nm of Object.keys(before)) {
      const a = before[nm];
      const per = 3 * g.attributes[nm].itemSize;
      const want = new Float32Array(ref.kept * per);
      let w = 0;
      for (let t = 0; t < tris; t++) if (ref.keep[t]) for (let i = 0; i < per; i++) want[w++] = a[t * per + i];
      assert.deepEqual(new Uint8Array(res.geo.attributes[nm].array.buffer), new Uint8Array(want.buffer), nm + ' bytes');
    }
  }
  assert.ok(removed > 100 && removed < total, `some culled, not all: ${removed} / ${total}`);
});

await ok('cullBuried fast path: interleaved / normalised attributes fall back to the original', () => {
  const g = soup(0, 0, 0, 0.3, 5);
  const ib = new THREE.InterleavedBuffer(new Float32Array(5 * 3 * 3), 3);
  g.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
  assert.equal(F.cullBuriedFast(g, level, g.attributes.position, g.attributes.normal, 5, KINDS, 0.04, 0.02), null);
});

// -- kitGeoFast == the original _kitGeo -----------------------------------------------------------------------------------------------
function tintColors(geo, r, g, b) {
  const c = geo.attributes.color.array;
  for (let i = 0; i < c.length; i += 3) {
    c[i] *= r;
    c[i + 1] *= g;
    c[i + 2] *= b;
  }
  return geo;
}
function worldUV(geo) {
  const p = geo.attributes.position.array;
  const uv = new Float32Array((p.length / 3) * 2);
  for (let i = 0; i < p.length / 3; i++) {
    uv[i * 2] = p[i * 3] + p[i * 3 + 2];
    uv[i * 2 + 1] = p[i * 3 + 1];
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}
function refKitGeo(part, it, lst) {
  const g = part.geo.clone();
  g.applyMatrix4(it.m);
  if (it.m.determinant() < 0) {
    const p = g.attributes.position;
    const nn = g.attributes.normal;
    const c = g.attributes.color;
    for (let i = 0; i < p.count; i += 3) {
      for (const a of [p, nn, c]) {
        const x = a.getX(i + 1), y = a.getY(i + 1), z = a.getZ(i + 1);
        a.setXYZ(i + 1, a.getX(i + 2), a.getY(i + 2), a.getZ(i + 2));
        a.setXYZ(i + 2, x, y, z);
      }
    }
  }
  tintColors(g, it.tint[0], it.tint[1], it.tint[2]);
  if (lst === 'glow') g.deleteAttribute('normal');
  else worldUV(g);
  return g;
}
await ok('kitGeoFast == clone + applyMatrix4 + mirror fix (60 placements: rotated, scaled, mirrored; glow and lit lists)', () => {
  const base = soup(0.2, 0.5, -0.1, 0.8, 40);
  base.deleteAttribute('uv');
  for (let k = 0; k < 60; k++) {
    const part = { geo: base };
    if (k % 3 === 0) base.computeBoundingBox();
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(rnd() * 40 - 20, -rnd() * 500, rnd() * 40 - 20),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 6, rnd() * 6, rnd() * 6)),
      new THREE.Vector3((k % 4 === 1 ? -1 : 1) * (0.5 + rnd()), 0.5 + rnd(), 0.5 + rnd()),
    );
    const it = { m, tint: [0.5 + rnd(), 0.5 + rnd(), 0.5 + rnd()] };
    const lst = k % 5 === 0 ? 'glow' : 'stone';
    const want = refKitGeo(part, it, lst);
    const got = F.kitGeoFast(part, it, lst, tintColors, worldUV);
    assert.ok(got, 'fast path applies');
    assert.deepEqual(Object.keys(got.attributes), Object.keys(want.attributes), 'attribute order');
    for (const nm of Object.keys(want.attributes)) assert.deepEqual(new Uint8Array(got.attributes[nm].array.buffer), new Uint8Array(want.attributes[nm].array.buffer), `${nm} bytes (placement ${k})`);
    assert.equal(!!got.boundingBox, !!want.boundingBox, 'bounding box like the clone');
    if (want.boundingBox) assert.ok(got.boundingBox.equals(want.boundingBox), 'same box');
  }
  F.LOADOPT.on = false;
  assert.equal(F.kitGeoFast({ geo: base }, { m: new THREE.Matrix4(), tint: [1, 1, 1] }, 'stone', tintColors, worldUV), null, '?loadopt=0: the original');
  F.LOADOPT.on = true;
});

// -- precullStep --------------------------------------------------------------------------------------------------------------------
await ok('precullStep: one geometry per call, a record buried whole is dropped, a plain geometry culled once (marked)', () => {
  const wall = { kind: 'wall', minX: -1, maxX: 1, minY: -1, maxY: 1, minZ: -1, maxZ: 1 };
  const lvl = { querySolidsStatic: (a, b, c, d, e, f, out) => ((out.length = 0), out.push(wall), out) };
  const inside = () => {
    const g = soup(0, 0, 0, 0.2, 3);
    g.attributes.normal.array.fill(0);
    for (let i = 0; i < 9; i++) g.attributes.normal.array[i * 3 + 1] = 1; // up, still inside the wall
    return g;
  };
  const outside = () => soup(5, 5, 5, 0.2, 3);
  const rec = { isLodRec: true, geos: [null, inside(), outside()] };
  const keep = { isLodRec: true, geos: [null, outside(), null] };
  const plain = inside();
  const list = [rec, plain, keep];
  const lv = { level: lvl, stats: {} };
  const H = { cullBuried, packGeo: (g) => g, compactVertices: (g) => g, buried: true };
  const item = [null, null, new Map([[0, { stone: list }]])];
  let steps = 0;
  while (F.precullStep(item, H, lv)) steps++;
  assert.equal(steps, 3, 'three pieces of work');
  assert.equal(list.length, 2, 'the record whose medium level was buried is gone');
  assert.equal(list[1], keep, 'order kept');
  assert.ok(F.CULLED.has(list[0]) && list[0].attributes.position.count === 0, 'plain geometry culled and marked');
  assert.ok(keep._culled, 'record marked');
  assert.equal(lv.stats.buriedCulled, 6, 'removed triangles counted');
  assert.equal(F.precullStep([1, 'glow', []], H, lv), false, 'not a section pack: merged as before');
  assert.equal(F.precullStep(item, Object.assign({}, H, { buried: false }), lv), false, '?cull=0: nothing to do');
});

// -- dressing budget ----------------------------------------------------------------------------------------------------------------
await ok('dressing budget: what the frame leaves of 10 ms, 1-6 ms playing / 2-10 ms otherwise; fixed 2 / 8 without a measurement', () => {
  const b = (state, w) => F.dressBudgetMs({ state, _frameWorkMs: w });
  assert.equal(b('playing', 6), 4);
  assert.equal(b('playing', 1), 6);
  assert.equal(b('playing', 12), 1);
  assert.equal(b('menu', 3), 7);
  assert.equal(b('menu', 0), 10);
  assert.equal(b('menu', 30), 2);
  assert.equal(F.dressBudgetMs({ state: 'playing' }), 2);
  assert.equal(F.dressBudgetMs({ state: 'menu' }), 8);
  F.LOADOPT.on = false;
  assert.equal(b('menu', 0), 8);
  F.LOADOPT.on = true;
});

// -- level cache ----------------------------------------------------------------------------------------------------------------------
await ok('level cache key: the import parser walks the whole static closure of the build (every file exists, three.js included)', () => {
  const map = { three: './vendor/three/three.module.min.js', 'three/addons/': './vendor/three/addons/' };
  const base = pathToFileURL(path.join(GAME, 'index.html')).href;
  const seen = new Set();
  const q = ['src/render/levelView.js', 'src/sim/level3d.js', 'src/data/level-data-3d.js'].map((f) => pathToFileURL(path.join(GAME, f)).href);
  while (q.length) {
    const u = q.shift();
    if (seen.has(u)) continue;
    seen.add(u);
    const file = fileURLToPath(u);
    assert.ok(fs.existsSync(file), 'exists: ' + file);
    for (const sp of LC.staticImports(fs.readFileSync(file, 'utf8'))) {
      const r = LC.resolveSpec(sp, u, map, base);
      assert.ok(r, 'resolved: ' + sp);
      q.push(r);
    }
  }
  const rel = [...seen].map((u) => path.relative(GAME, fileURLToPath(u)));
  for (const f of ['src/render/levelView.js', 'src/render/levelBuildFast.js', 'src/render/materials.js', 'src/sim/decorColliders.js', 'src/data/decor-parts-3d.js', 'vendor/three/three.module.min.js', 'vendor/three/addons/utils/BufferGeometryUtils.js'])
    assert.ok(rel.includes(f), 'in the key: ' + f);
  // the index.html import map is the one the parser is given in the browser
  const html = fs.readFileSync(path.join(GAME, 'index.html'), 'utf8');
  const im = JSON.parse(html.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1]).imports;
  assert.deepEqual(im, map, 'import map');
  assert.deepEqual(LC.staticImports("import a from './a.js';\nimport {\n  b,\n  c,\n} from \"../b.js\";\nexport { d } from './d.js';\nimport './e.js';\nconst x = 'import y from \"./no.js\"';\n// import z from './z.js'"), ['./a.js', '../b.js', './d.js', './e.js']); // a commented-out line is not an import
});

await ok('level cache: slices -> arrays round trip (empty and odd-sized arrays); a missing / extra / oversized slice throws', () => {
  const arrays = [new Float32Array([1, 2, 3.5]), new Int16Array(0), new Uint16Array(1001).map((_, i) => i * 7), new Uint32Array(5).fill(9), new Float32Array(0)];
  const specs = arrays.map((a) => ({ ctor: a.constructor.name, length: a.length, bytes: a.byteLength }));
  const { slices, bytes } = LC.slicesOf(arrays, 64);
  assert.equal(bytes, arrays.reduce((s, a) => s + a.byteLength, 0));
  const asm = new LC.Assembler(specs);
  for (const s of slices) asm.push(s.slice().buffer);
  const out = asm.done();
  out.forEach((a, i) => {
    assert.equal(a.constructor, arrays[i].constructor);
    assert.deepEqual(Array.from(a), Array.from(arrays[i]));
  });
  const short = new LC.Assembler(specs);
  for (const s of slices.slice(0, -1)) short.push(s.slice().buffer);
  assert.throws(() => short.done(), /slice count/);
  const extra = new LC.Assembler(specs);
  for (const s of slices) extra.push(s.slice().buffer);
  assert.throws(() => extra.push(new ArrayBuffer(4)), /extra slice/);
  assert.throws(() => new LC.Assembler(specs).push(new ArrayBuffer(4096)), /slice size/);
  assert.throws(() => new LC.Assembler([{ ctor: 'Float32Array', length: 3, bytes: 13 }]), /array/);
});

console.log(`test-loading: ${n} checks passed`);
