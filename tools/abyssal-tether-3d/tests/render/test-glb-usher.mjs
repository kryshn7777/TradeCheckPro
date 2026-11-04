// THE USHER (tools/abyssal-tether-3d/build_usher.py -> assets/models/usher.glb), Node: the shipped GLB is what the builder promises.
//   A headless man in a suit whose throat goes on: one skinned mesh, one skeleton (body + a 14-bone throat + a ring bone), four clips,
//   six flat materials, a triangle budget, a size that reads (a 1.95 m man with a 3.7 m throat), the throat's skin weights.
//   node test-glb-usher.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';
import { readGLB, MODELS_DIR } from './glbRead.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/vendor/three/')).href;
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR}/three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR}/addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
await MeshoptDecoder.ready;

let n = 0;
const ok = (c, msg) => {
  assert.ok(c, msg);
  n++;
  console.log('PASS ' + msg);
};

const g = await readGLB(path.join(MODELS_DIR, 'usher.glb'));
const js = g.js;
ok(g.meshopt && (js.extensionsRequired || []).includes('EXT_meshopt_compression'), 'compressed with EXT_meshopt_compression (the game\'s vendored decoder reads it)');
ok(g.size < 600 * 1024, `small: ${(g.size / 1024).toFixed(0)} KB`);
ok(js.meshes.length === 1 && js.skins.length === 1, 'one mesh, one skin');

// triangles and vertices
let tris = 0;
for (const p of js.meshes[0].primitives) tris += js.accessors[p.indices].count / 3;
let verts = 0;
for (const p of js.meshes[0].primitives) verts += js.accessors[p.attributes.POSITION].count;
ok(tris > 15000 && tris <= 32000, `${tris} triangles (budget 32 k for a hero villain)`);
ok(js.meshes[0].primitives.length === 6 && js.materials.length === 6, 'six materials (suit, shirt, skin, vein, shoe, glow), one draw each');
const names = js.materials.map((m) => m.name.replace('Usher_', '')).sort().join(',');
ok(names === 'glow,shirt,shoe,skin,suit,vein', `materials: ${names}`);
const glow = js.materials.find((m) => m.name === 'Usher_glow');
ok(glow.emissiveFactor && glow.emissiveFactor.some((c) => c > 0.5), 'the ring\'s membrane is emissive (the only light he has)');

// the skeleton
const joints = js.skins[0].joints.map((i) => js.nodes[i].name);
const need = ['Root', 'Pelvis', 'Spine1', 'Spine2', 'Spine3', 'Maw'];
for (const s of ['L', 'R']) need.push(`Clavicle_${s}`, `UpperArm_${s}`, `Forearm_${s}`, `Hand_${s}`, `Thigh_${s}`, `Shin_${s}`, `Foot_${s}`);
for (let i = 1; i <= 14; i++) need.push('Neck' + String(i).padStart(2, '0'));
ok(need.every((b) => joints.includes(b)), `the skeleton has every bone of the contract (${joints.length} joints: body, 14 throat bones, the ring)`);
ok(joints.length === need.length, 'and nothing else');
// the throat chain is parented in order
const byName = Object.fromEntries(js.nodes.map((nd, i) => [nd.name, i]));
const parentOf = {};
js.nodes.forEach((nd, i) => (nd.children || []).forEach((c) => (parentOf[c] = i)));
let chain = true;
for (let i = 2; i <= 14; i++) if (js.nodes[parentOf[byName['Neck' + String(i).padStart(2, '0')]]].name !== 'Neck' + String(i - 1).padStart(2, '0')) chain = false;
ok(chain && js.nodes[parentOf[byName.Maw]].name === 'Neck14' && js.nodes[parentOf[byName.Neck01]].name === 'Spine3', 'the throat is one chain from Spine3 to the ring (Maw under Neck14)');

// the clips
const clips = js.animations.map((a) => a.name).sort().join(',');
ok(clips === 'Idle,Listen,Lunge,Walk', `clips: ${clips}`);
const dur = (nm) => {
  const a = js.animations.find((x) => x.name === nm);
  let m = 0;
  for (const s of a.samplers) m = Math.max(m, g.acc(s.input).at(-1));
  return m;
};
ok(Math.abs(dur('Idle') - 2.0) < 0.1 && Math.abs(dur('Walk') - 1.33) < 0.1 && Math.abs(dur('Lunge') - 1.5) < 0.1, `durations at 24 fps: Idle ${dur('Idle').toFixed(2)} s, Walk ${dur('Walk').toFixed(2)} s, Lunge ${dur('Lunge').toFixed(2)} s`);
const lunge = js.animations.find((a) => a.name === 'Lunge');
const throatTargets = lunge.channels.filter((c) => /^Neck\d\d$/.test(js.nodes[c.target.node].name) && c.target.path === 'rotation').length;
ok(throatTargets === 14, 'the Lunge turns all 14 throat bones');
const mawScale = lunge.channels.some((c) => js.nodes[c.target.node].name === 'Maw' && c.target.path === 'scale');
ok(mawScale, 'and opens the ring (the Maw bone scales)');

// size: the bind-pose bounds, measured the way the game sees them (the loader dequantises; the skeleton's correction is in the inverse binds)
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.pluginCallbacks.unshift(() => ({ name: 'noTex', loadTexture: () => Promise.resolve(null) }));
const gltf = await new Promise((res, rej) => loader.parse(g.buf.buffer.slice(g.buf.byteOffset, g.buf.byteOffset + g.buf.byteLength), '', res, rej));
gltf.scene.updateMatrixWorld(true);
const bb = new THREE.Box3();
const v = new THREE.Vector3();
const sks = [];
let vsum = 0;
gltf.scene.traverse((o) => {
  if (!o.isSkinnedMesh) return;
  sks.push(o);
  o.skeleton.update();
  const p = o.geometry.attributes.position;
  vsum += p.count;
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    o.applyBoneTransform(i, v);
    bb.expandByPoint(v);
  }
});
ok(sks.length === 6 && vsum === verts, `the loader reads the same ${verts} vertices in ${sks.length} skinned meshes (one per material, one shared skeleton)`);
ok(bb.max.y > 3.0 && bb.max.y < 3.8 && bb.min.y > -0.05 && bb.min.y < 0.1, `a man on the floor with a tall throat: ${bb.min.y.toFixed(2)} .. ${bb.max.y.toFixed(2)} m (y up)`);
ok(bb.max.x - bb.min.x < 1.4 && bb.max.z - bb.min.z > 0.9 && bb.max.z - bb.min.z < 1.9, `narrow and deep: ${(bb.max.x - bb.min.x).toFixed(2)} m wide, ${(bb.max.z - bb.min.z).toFixed(2)} m front to back (the ring hangs forward, +z)`);
ok(bb.max.z > 0.5 && bb.min.z < -0.1, 'the ring is in FRONT of him (he faces +z in glTF): the throat coils back over him and comes forward');
// the skin weights: normalised, 4 influences at most; the tip of the throat is owned by its last bones / the ring
let bad = 0;
let maxZ = -1e9;
let owner = '';
for (const sk of sks) {
  const sj = sk.geometry.attributes.skinIndex;
  const sw = sk.geometry.attributes.skinWeight;
  const names = sk.skeleton.bones.map((b) => b.name);
  for (let i = 0; i < sw.count; i++) {
    if (i % 5 === 0) {
      const sum = sw.getX(i) + sw.getY(i) + sw.getZ(i) + sw.getW(i);
      if (Math.abs(sum - 1) > 0.02) bad++;
    }
    v.fromBufferAttribute(sk.geometry.attributes.position, i);
    sk.applyBoneTransform(i, v);
    if (v.z > maxZ) {
      maxZ = v.z;
      owner = names[sj.getX(i)];
    }
  }
}
ok(bad === 0, 'the skin weights are normalised');
ok(/^Neck1[34]$|^Maw$/.test(owner), `the vertex furthest forward (the lip of the ring) is owned by the end of the throat (${owner})`);
console.log(`\n${n} checks passed`);
