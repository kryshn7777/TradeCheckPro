// Node tests for the architecture detail pass (render/archDetail.js, MESH_DETAIL_AND_OPTIMIZATION.md §6), no GPU:
//   - every builder emits clean triangle soups (finite, non-degenerate, wound to their normals), deterministic for a seed;
//   - the plaque frame never covers the text plane; quoins never rise above the walking surface nor stand more than 3.5 cm proud;
//   - the gate keeps the plain gate's bar layout (count, spacing, straps), spikes under the bars; the door leaf stays inside the
//     doorway, behind the jambs' front;
//   - decalRGB writes one quad (6 vertices) with its rgb tint and alpha.
//   node test-arch-detail.mjs
import assert from 'node:assert/strict';
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
const A = await import(pathToFileURL(path.join(GAME, 'src/render/archDetail.js')).href);

let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log('  ok ' + name);
};
const rngOf = (seed) => {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
};
/** finite, non-degenerate, each triangle's winding agrees with its (mean) stored normal */
function clean(S, label) {
  assert.ok(S.p.length > 0 && S.p.length % 9 === 0 && S.n.length === S.p.length && S.c.length === S.p.length, `${label}: layout`);
  for (const v of [...S.p, ...S.n, ...S.c]) assert.ok(Number.isFinite(v), `${label}: finite`);
  const p = S.p;
  const nn = S.n;
  for (let t = 0; t < p.length; t += 9) {
    const e1 = [p[t + 3] - p[t], p[t + 4] - p[t + 1], p[t + 5] - p[t + 2]];
    const e2 = [p[t + 6] - p[t], p[t + 7] - p[t + 1], p[t + 8] - p[t + 2]];
    const c = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const area = Math.hypot(c[0], c[1], c[2]);
    assert.ok(area > 1e-10, `${label}: degenerate triangle ${t / 9}`);
    const m = [nn[t] + nn[t + 3] + nn[t + 6], nn[t + 1] + nn[t + 4] + nn[t + 7], nn[t + 2] + nn[t + 5] + nn[t + 8]];
    assert.ok(c[0] * m[0] + c[1] * m[1] + c[2] * m[2] > 0, `${label}: triangle ${t / 9} wound against its normal`);
  }
}
const bounds = (S) => {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < S.p.length; i += 3) for (let k = 0; k < 3; k++) {
    lo[k] = Math.min(lo[k], S.p[i + k]);
    hi[k] = Math.max(hi[k], S.p[i + k]);
  }
  return { lo, hi };
};

console.log('arch detail:');
ok('chamferBox: 44 triangles (40 with two faces skipped), clean, inside its box', () => {
  const S = A.chamferBox(new A.Soup(), 1, 2, 3, 0.6, 0.4, 0.2, 0.03);
  assert.equal(S.tris, 44);
  clean(S, 'chamferBox');
  const b = bounds(S);
  assert.ok(Math.abs(b.lo[0] - 0.7) < 1e-9 && Math.abs(b.hi[1] - 2.2) < 1e-9 && Math.abs(b.hi[2] - 3.1) < 1e-9);
  assert.equal(A.chamferBox(new A.Soup(), 0, 0, 0, 1, 1, 1, 0.1, null, 2 | 32).tris, 40);
});
ok('rivet / flange bolts: clean, standing on their plane', () => {
  const S = A.rivet(new A.Soup(), [0, 0, 0], [0, 0, 1], 0.02, 0.015);
  clean(S, 'rivet');
  const b = bounds(S);
  assert.ok(b.lo[2] > -1e-9 && Math.abs(b.hi[2] - 0.015) < 1e-9);
  const B = A.flangeBolts(new A.Soup(), [0, 5, 0], 'y', 0.36, 0.05, 6, 0.03);
  clean(B, 'bolts');
  assert.equal(B.tris, 2 * 6 * 18);
});
ok('plaque frame: clean, never over the text plane, proud of the slab by under 10 cm (the corner bosses)', () => {
  for (const [lw, sy, ld] of [[2.6, 0.55, 0.15], [1.6, 0.6, 0.15], [3.6, 0.9, 0.15], [2.6, 1.4, 0.2]]) {
    const S = A.plaqueFrameSoup(lw, sy, ld);
    clean(S, 'plaque');
    const zf = ld / 2 - 0.02;
    for (let i = 0; i < S.p.length; i += 9) {
      // a triangle in front of the slab whose centroid lies over the text (lw 0.95 x sy 0.86) would hide letters
      const cx = (S.p[i] + S.p[i + 3] + S.p[i + 6]) / 3;
      const cy = (S.p[i + 1] + S.p[i + 4] + S.p[i + 7]) / 3;
      const cz = (S.p[i + 2] + S.p[i + 5] + S.p[i + 8]) / 3;
      assert.ok(!(cz > zf && Math.abs(cx) < lw * 0.475 && Math.abs(cy) < sy * 0.43), `plaque ${lw}x${sy}: covers the text`);
    }
    assert.ok(bounds(S).hi[2] - zf < 0.1);
  }
});
ok('quoins: clean, deterministic, below the walking surface, at most 3.5 cm proud, within 0.5 m of the corner', () => {
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const S = A.quoinSoup(new A.Soup(), rngOf(7), 10, -4, sx, sz, -20, 3);
    clean(S, 'quoin');
    assert.deepEqual(S.p, A.quoinSoup(new A.Soup(), rngOf(7), 10, -4, sx, sz, -20, 3).p);
    const b = bounds(S);
    assert.ok(b.hi[1] <= -20 - 0.005 + 1e-9 && b.lo[1] >= -23 - 1e-9, 'height');
    const out = (v, c, s) => (v - c) * s; // + = proud of the face
    for (let i = 0; i < S.p.length; i += 3) {
      assert.ok(out(S.p[i], 10, sx) <= 0.035 && out(S.p[i], 10, sx) >= -0.5, 'x extent');
      assert.ok(out(S.p[i + 2], -4, sz) <= 0.035 && out(S.p[i + 2], -4, sz) >= -0.5, 'z extent');
    }
  }
});
ok('gate: the plain gate\'s layout (bar count and spacing), spikes under the bars, clean; horizontal bars fall back', () => {
  const size = [8, 8, 0.44];
  const S = A.gateSoup(size, 2, true);
  clean(S, 'gate');
  const b = bounds(S);
  assert.ok(b.lo[1] < -4 - 0.2 && b.hi[1] <= 4 + 0.1 && Math.abs(b.hi[0] - 4.04) < 0.02);
  // one octagonal prism (8 quads = 16 triangles) + one 8-facet spike per bar: n + 1 bars, n = round(8 / 0.32)
  const bars = Math.round(8 / 0.32) + 1;
  const straps = 4 * 44;
  const rivets = 4 * bars * 2 * 18;
  assert.equal(S.tris, bars * (16 + 8) + straps + rivets);
  assert.equal(A.gateSoup([0.44, 3, 8], 1), null);
});
ok('door leaf: inside the doorway, behind the jambs\' front, on the sill, clean', () => {
  const S = A.doorSoup(new A.Soup(), rngOf(3), 1.5, 1.7, 1.0, 2.0, 0.2);
  clean(S, 'door');
  const b = bounds(S);
  assert.ok(b.lo[0] >= -0.65 && b.hi[0] <= 0.65, 'width');
  assert.ok(b.lo[1] >= 2.0 && b.hi[1] <= 2.0 + 1.7 + 1.0, 'height');
  assert.ok(b.lo[2] >= 0 && b.hi[2] < 0.2, 'depth');
});
ok('decalRGB: one quad, rgb tint and alpha per vertex', () => {
  const D = { p: [], n: [], uv: [], c: [] };
  A.decalRGB(D, 0, 1, 0, [1, 0, 0], [0, 1, 0], [0, 0, 1], 0.5, 0.25, 0, [0.5, 0, 0.25, 0.5], 0.8, [2, 1, 0.5]);
  assert.equal(D.p.length, 18);
  assert.equal(D.uv.length, 12);
  assert.deepEqual(D.c.slice(0, 4), [2, 1, 0.5, 0.8]);
  assert.ok(D.p.every((v, i) => i % 3 !== 2 || v === 0));
});
console.log(`arch detail: ${n} checks passed`);
