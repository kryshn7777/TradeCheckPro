// The distance fog is for what is FAR (render/materials.js installRadialFog / fogFactor, godRays.js rayFog, renderer3d FOG_START_FRAC), Node, no GPU:
//   - the curve is a smoothstep: nothing at the start, a quarter of the way in barely hazed, only the far end fully fogged (the old
//     1 - u^2.5 was 43 % fogged a fifth of the way in and 82 % halfway);
//   - the shader chunk every material shares and the god-ray copy use that same curve; the old expression is gone;
//   - with the section data, mid-range masonry stays clear in every section.
//   node test-fog.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register as reg } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/vendor/three/')).href;
const SRC = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/src/')).href;
const SRCDIR = path.resolve(HERE, '../../../../public/abyssal-tether-3d/src');
reg(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR}/three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR}/addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const THREE = await import('three');
const { fogFactor, FOG_START_FRAC, installRadialFog } = await import(`${SRC}/render/materials.js`);
const { Level3D } = await import(`${SRC}/sim/level3d.js`);

let n = 0;
const ok = (c, msg) => {
  assert.ok(c, msg);
  n++;
  console.log('PASS ' + msg);
};
const old = (d, near, far) => {
  const t = Math.min(1, Math.max(0, (d - near) / (far - near)));
  const u = 1 - t;
  return 1 - u * u * Math.sqrt(u);
};

// 1. The curve.
{
  const near = 20;
  const far = 60;
  const at = (t) => fogFactor(near + t * (far - near), near, far);
  ok(at(0) === 0 && at(1) === 1, 'no fog at the start, exactly full fog at the far limit (distance culling there stays invisible)');
  ok(at(0.2) < 0.12 && at(0.5) > 0.45 && at(0.5) < 0.55, `a fifth of the way in ${(at(0.2) * 100).toFixed(0)} % fogged (was ${(old(near + 8, near, far) * 100).toFixed(0)} %), halfway ${(at(0.5) * 100).toFixed(0)} % (was ${(old(40, near, far) * 100).toFixed(0)} %)`);
  let mono = true;
  let prev = -1;
  for (let t = 0; t <= 1.0001; t += 0.01) {
    const v = at(Math.min(1, t));
    if (v < prev - 1e-12) mono = false;
    prev = v;
  }
  ok(mono, 'the curve rises monotonically');
  ok(at(0.3) < old(near + 12, near, far) * 0.4, 'at every mid distance it is far lighter than the old curve');
}
// 2. The shader chunks.
{
  installRadialFog();
  const chunk = THREE.ShaderChunk.fog_pars_fragment;
  ok(chunk.includes('return t * t * ( 3.0 - 2.0 * t );') && !chunk.includes('sqrt( u )'), 'the shared fog chunk (every lit material) uses the smoothstep');
  const rays = fs.readFileSync(path.join(SRCDIR, 'render/godRays.js'), 'utf8');
  ok(rays.includes('return t * t * ( 3.0 - 2.0 * t );') && !rays.includes('sqrt( u )'), 'the god-ray shader copy uses the same curve');
  const mat = fs.readFileSync(path.join(SRCDIR, 'render/materials.js'), 'utf8');
  ok(!/1\.0 - u \* u \* sqrt\( u \)/.test(mat), 'the old front-loaded expression is gone from materials.js');
}
// 3. The section data: the fog starts at FOG_START_FRAC of the far distance (or the section's own near, whichever is later).
{
  const FOG_THICKNESS = 2; // renderer3d.js
  const L = new Level3D(undefined, 'normal');
  ok(FOG_START_FRAC >= 0.3 && FOG_START_FRAC <= 0.5, `the fog starts at ${(FOG_START_FRAC * 100).toFixed(0)} % of its far distance`);
  let worst = 1;
  L.sections.forEach((s, i) => {
    const t = s.theme;
    const far = Math.max(8, t.fogFar / FOG_THICKNESS);
    const near = Math.max(2, t.fogNear / FOG_THICKNESS, far * FOG_START_FRAC);
    const oldNear = Math.max(2, t.fogNear / FOG_THICKNESS);
    // fog on a wall 15 m away: new against the old
    const f15 = fogFactor(15, near, far);
    const o15 = old(15, oldNear, Math.max(oldNear + 4, far));
    worst = Math.min(worst, o15 - f15);
    ok(f15 <= 0.08 && f15 < o15 || o15 === 0, `S${i + 1}: a wall 15 m away is ${(f15 * 100).toFixed(0)} % fogged (was ${(o15 * 100).toFixed(0)} %); the fog runs ${near.toFixed(0)}..${far.toFixed(0)} m`);
  });
  ok(worst >= 0, 'in no section is anything within 15 m foggier than before');
}
console.log(`\n${n} checks passed`);
