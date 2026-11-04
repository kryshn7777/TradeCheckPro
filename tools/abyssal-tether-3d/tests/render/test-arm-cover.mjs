// "Show body" off = gloves only (render/handsGear.js splitArmCover / HandGear.setCoverVisible, render/handsView.js update), Node, no GPU:
//   - the arm mesh of the shipped player_arms.glb is two pieces: the leather glove and the waxed-canvas sleeve (the "arm cover") that runs up
//     from the wrist; the split reorders the index buffer to [glove, sleeve] without losing or changing a triangle;
//   - hiding the cover is a draw-range change (the glove stays, the sleeve goes), showing it restores the whole mesh; both sides;
//   - a one-piece mesh is left alone; the view reads settings.showBody every frame.
//   node test-arm-cover.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';
import { readGLB, MODELS_DIR } from './glbRead.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/vendor/three/')).href;
const SRC = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/src/')).href;
const SRCDIR = path.resolve(HERE, '../../../../public/abyssal-tether-3d/src');
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
const { splitArmCover, HandGear } = await import(`${SRC}/render/handsGear.js`);

let n = 0;
const ok = (c, msg) => {
  assert.ok(c, msg);
  n++;
  console.log('PASS ' + msg);
};

const loadArms = async () => {
  const g = await readGLB(path.join(MODELS_DIR, 'player_arms.glb'));
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.pluginCallbacks.unshift(() => ({ name: 'noTex', loadTexture: () => Promise.resolve(null) })); // Node has no image decoding
  return new Promise((res, rej) => loader.parse(g.buf.buffer.slice(g.buf.byteOffset, g.buf.byteOffset + g.buf.byteLength), '', res, rej));
};
const triKeys = (geo) => {
  const idx = geo.index.array;
  const keys = [];
  for (let t = 0; t < idx.length; t += 3) keys.push([idx[t], idx[t + 1], idx[t + 2]].sort((a, b) => a - b).join(','));
  return keys.sort();
};

// 1. The shipped arms.
{
  const gltf = await loadArms();
  for (const side of ['L', 'R']) {
    const mesh = gltf.scene.getObjectByName(`Arm_${side}_Mesh`);
    ok(!!mesh && mesh.isSkinnedMesh, `Arm_${side}_Mesh is the skinned arm mesh`);
    const geo = mesh.geometry;
    const before = triKeys(geo);
    const cover = splitArmCover(geo);
    ok(!!cover && cover.total === before.length * 3 && cover.glove > 0 && cover.glove < cover.total, `${side}: two pieces (${cover.glove / 3} glove triangles, ${(cover.total - cover.glove) / 3} sleeve triangles)`);
    ok(cover.glove / 3 > 1500 && (cover.total - cover.glove) / 3 > 300 && (cover.total - cover.glove) / 3 < 1200, `${side}: the glove is the big piece, the sleeve a few hundred triangles`);
    const after = triKeys(geo);
    ok(after.length === before.length && after.every((k, i) => k === before[i]), `${side}: no triangle was lost or changed by the reorder`);
    // the glove is first: its triangles reach the fingertips (the far end along the arm), the sleeve ones the elbow end
    const pos = geo.attributes.position;
    const idx = geo.index.array;
    const zMax = (a, b) => {
      let m = -1e9;
      for (let i = a; i < b; i++) m = Math.max(m, pos.getZ(idx[i]));
      return m;
    };
    const zMin = (a, b) => {
      let m = 1e9;
      for (let i = a; i < b; i++) m = Math.min(m, pos.getZ(idx[i]));
      return m;
    };
    ok(zMin(0, cover.glove) < zMin(cover.glove, cover.total) - 0.1 && zMax(cover.glove, cover.total) > zMax(0, cover.glove) + 0.1, `${side}: the sleeve runs on past the glove toward the elbow (the glove holds the fingertips)`);
  }
}

// 2. Hiding / showing: a draw range.
{
  const gltf = await loadArms();
  const mesh = gltf.scene.getObjectByName('Arm_L_Mesh');
  const cover = splitArmCover(mesh.geometry);
  const fake = { _cover: cover, _coverShown: true, armMesh: mesh };
  const total = mesh.geometry.index.count;
  HandGear.prototype.setCoverVisible.call(fake, false);
  ok(mesh.geometry.drawRange.start === 0 && mesh.geometry.drawRange.count === cover.glove && fake._coverShown === false, 'hidden: only the glove triangles are drawn');
  HandGear.prototype.setCoverVisible.call(fake, false);
  ok(mesh.geometry.drawRange.count === cover.glove, 'hiding twice changes nothing');
  HandGear.prototype.setCoverVisible.call(fake, true);
  ok(mesh.geometry.drawRange.count === cover.total && cover.total === total, 'shown: the whole mesh again');
  const none = { _cover: null, _coverShown: true, armMesh: mesh };
  mesh.geometry.setDrawRange(0, Infinity);
  HandGear.prototype.setCoverVisible.call(none, false);
  ok(mesh.geometry.drawRange.count === Infinity, 'a mesh that is one piece is left alone');
}

// 3. A one-piece mesh, and UV seams (duplicated vertices) do not split a piece.
{
  const geo = new THREE.BufferGeometry();
  // a quad made of two triangles whose shared edge is duplicated (a UV seam): still one piece
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0], 3));
  geo.setIndex([0, 1, 2, 3, 4, 5]);
  ok(splitArmCover(geo) === null, 'a seam (duplicated vertices at one position) is welded: one piece');
  // plus a far-away piece: two pieces, the bigger first
  const g2 = new THREE.BufferGeometry();
  g2.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 5, 5, 5, 6, 5, 5, 6, 6, 5], 3));
  g2.setIndex([6, 7, 8, 0, 1, 2, 3, 4, 5]);
  const c = splitArmCover(g2);
  ok(c && c.glove === 6 && c.total === 9 && g2.index.array[6] === 6, 'the bigger piece is first, the small one last');
}

// 4. The view drives it from the setting.
{
  const src = fs.readFileSync(path.join(SRCDIR, 'render/handsView.js'), 'utf8');
  ok(/game\.settings\.showBody === false/.test(src) && /gear\[h\]\.setCoverVisible\(showCover\)/.test(src), 'handsView reads settings.showBody every frame and sets the cover of both hands');
}

console.log(`\n${n} checks passed`);
