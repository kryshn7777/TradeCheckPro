// The lantern's volumetric CONE is off (render/godRays.js params.lantern = 0), Node, no GPU.
// Reported from play, with a screenshot circled on a brick wall: "Remove this fog sheet". Hiding single meshes / instances in the same frame
// showed the sheet was the lantern cone of the god-ray layer (61 of 145 brightness units of the circled wall); the shafts, the window beams
// and the lantern's glow were not it. With the cone off:
//   - the layer writes no cone instance (one instance fewer in the same draw call: the glow, the window beams and the shafts remain);
//   - the strength can still bring it back (params.lantern > 0: one more instance).
//   node test-lantern-cone.mjs
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
const THREE = await import('three');
const mod = (p) => import(pathToFileURL(path.join(GAME, p)).href);
const { GodRays } = await mod('src/render/godRays.js');
const { Level3D } = await mod('src/sim/level3d.js');

let n = 0;
const ok = (c, msg) => {
  assert.ok(c, msg);
  n++;
  console.log('PASS ' + msg);
};

const U = { uLanternPos: { value: new THREE.Vector3(0, 0, 0) }, uLanternCol: { value: new THREE.Color(1, 0.8, 0.5) } };
const noise = new THREE.Data3DTexture(new Uint8Array(8), 2, 2, 2);
const level = new Level3D();
const g = new GodRays(new THREE.Scene(), U, noise, { mesh: { visible: true } }); // a stand-in halo: its glow is merged into this draw
g.setQuality('quest', 0, false);
const cam = new THREE.PerspectiveCamera();
const head = new THREE.Vector3(0, -125, 0);
const fog = new THREE.Color(0.1, 0.1, 0.1);
const frame = () => g.update(1 / 60, 0, { level }, head, 1, 1, fog, cam);

frame();
ok(g.params.lantern === 0, 'the lantern cone strength is 0 by default');
const off = g.geometry.instanceCount;
ok(g.stats.on && off >= 2, `the layer draws (${off} instances: the lantern glow, the window beams and the shafts)`);
g.params.lantern = 0.16;
frame();
ok(g.geometry.instanceCount === off + 1, `a cone strength > 0 brings back exactly one instance (${g.geometry.instanceCount})`);
g.params.lantern = 0;
frame();
ok(g.geometry.instanceCount === off, 'and 0 takes it away again: no wasted hull drawn at zero strength');
console.log(`\n${n} checks passed`);
