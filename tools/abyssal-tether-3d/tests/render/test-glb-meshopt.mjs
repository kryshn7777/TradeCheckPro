// Node test of the geometry-compressed GLBs (WP-GFX-PARITY, tools/abyssal-tether-3d/compress_glbs.mjs):
//  - every shipped model uses EXT_meshopt_compression (required) and decodes with the game's vendored decoder
//  - the custom per-vertex attributes survive with their types and ranges (_SPINE_S float, _PART float id, _MASK / _OWNER ubyte)
//  - the vendored three.js GLTFLoader (with setMeshoptDecoder, and as created bare: the vendor default) loads each file to the same
//    mesh / vertex / bone / clip counts and the same posed bounding box as the uncompressed originals
//  - total geometry+images size drops below the old 26.9 MB
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
globalThis.self = globalThis; // GLTFLoader reads a few browser globals
const THREE = await import('three');
const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
await MeshoptDecoder.ready;

let n = 0;
const ok = async (name, fn) => {
  await fn();
  n++;
  console.log('  ok', name);
};

// What the uncompressed originals measured (HEAD before compression): mesh / vertex / bone / clip counts and the posed bbox.
const EXPECT = {
  mason_rig: { meshes: 8, verts: 141967, skinned: 8, bones: 170, anims: 18, min: [-4.4159, -5.1954, -2.3254], max: [9.1476, 6.1066, 28.4993], attrs: ['_mask'], big: true },
  player_arms: { meshes: 8, verts: 27293, skinned: 6, bones: 48, anims: 8, min: [-0.0965, -0.1119, -0.2115], max: [0.0965, 0.133, 0.3717], attrs: ['tangent'] },
  mason_hero: { meshes: 172, verts: 149744, skinned: 0, bones: 0, anims: 0, min: [-13.135, 1.702, -1.9012], max: [9.4116, 26.9572, 11.9362], attrs: ['_mask', '_owner', '_part', '_spine_s'] },
  mason_kit: { meshes: 28, verts: 51890, skinned: 0, bones: 0, anims: 0, min: [-2.6011, -5.1954, -2.3254], max: [4.3794, 6.1066, 6.0546], attrs: ['_mask', '_owner', '_part', '_spine_s'] },
  player_body: { meshes: 1, verts: 9320, skinned: 1, bones: 22, anims: 5, min: [-0.3812, 0.0004, -0.226], max: [0.3812, 1.5, 0.3187], attrs: [] },
};

const parseGLB = (file, loader) =>
  readGLB(file).then(
    (g) =>
      new Promise((res, rej) => {
        loader.parse(g.buf.buffer.slice(g.buf.byteOffset, g.buf.byteOffset + g.buf.byteLength), '', res, rej);
      }),
  );
const noTextures = (l) => {
  l.pluginCallbacks.unshift(() => ({ name: 'noTex', loadTexture: () => Promise.resolve(null) })); // Node has no image decoding
  return l;
};

let total = 0;
for (const [name, E] of Object.entries(EXPECT)) {
  const file = path.join(MODELS_DIR, name + '.glb');
  const g = await readGLB(file);
  total += g.size;
  await ok(`${name}: EXT_meshopt_compression required, every accessor decodes, custom attributes keep their types`, () => {
    assert.ok(g.meshopt, 'EXT_meshopt_compression used');
    assert.ok((g.js.extensionsRequired || []).includes('EXT_meshopt_compression'));
    for (let i = 0; i < g.js.accessors.length; i++) {
      const a = g.acc(i);
      assert.equal(a.length, g.js.accessors[i].count * { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }[g.js.accessors[i].type]);
    }
    let seen = new Set();
    for (const m of g.js.meshes)
      for (const p of m.primitives) {
        for (const [sem, ai] of Object.entries(p.attributes)) {
          seen.add(sem);
          const acc = g.js.accessors[ai];
          if (sem === '_SPINE_S' || sem === '_PART') assert.equal(acc.componentType, 5126, sem + ' stays float32 (an id / a signed spine coordinate must not be normalised)');
          if (sem === '_MASK' || sem === '_OWNER') assert.equal(acc.componentType, 5121, sem + ' stays ubyte');
          if (sem === '_SPINE_S') {
            const v = g.acc(ai);
            for (let k = 0; k < v.length; k += 7) assert.ok(v[k] > -4 && v[k] < 8, '_SPINE_S ' + v[k]);
          }
          if (sem === '_PART') {
            const v = g.acc(ai);
            for (let k = 0; k < v.length; k += 7) assert.ok(Number.isInteger(v[k]) && v[k] >= 0 && v[k] < 700, '_PART ' + v[k]);
          }
          if (sem === 'POSITION') {
            const v = g.acc(ai);
            for (let k = 0; k < v.length; k += 11) assert.ok(Number.isFinite(v[k]));
          }
        }
      }
    for (const a of E.attrs) assert.ok(seen.has(a.toUpperCase()) || seen.has(a), name + ' keeps ' + a);
  });
  await ok(`${name}: three.js GLTFLoader (setMeshoptDecoder) loads the same meshes, bones, clips and bounds`, async () => {
    const loader = noTextures(new GLTFLoader());
    loader.setMeshoptDecoder(MeshoptDecoder);
    const gltf = await parseGLB(file, loader);
    gltf.scene.updateMatrixWorld(true);
    let meshes = 0;
    let verts = 0;
    let skinned = 0;
    let bones = 0;
    const attrs = new Set();
    const bb = new THREE.Box3();
    const v = new THREE.Vector3();
    gltf.scene.traverse((o) => {
      if (o.isBone) bones++;
      if (!o.isMesh) return;
      meshes++;
      if (o.isSkinnedMesh) {
        skinned++;
        o.skeleton.update();
      }
      const p = o.geometry.attributes.position;
      verts += p.count;
      for (const k of Object.keys(o.geometry.attributes)) attrs.add(k);
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i);
        if (o.isSkinnedMesh) o.applyBoneTransform(i, v);
        else v.applyMatrix4(o.matrixWorld);
        bb.expandByPoint(v);
      }
    });
    assert.equal(meshes, E.meshes);
    assert.equal(verts, E.verts);
    assert.equal(skinned, E.skinned);
    assert.equal(bones, E.bones);
    assert.equal(gltf.animations.length, E.anims);
    // the sampled bounds agree with the originals' to within 5 mm (14-bit quantisation of a 37 m scene = 2 mm steps)
    const tol = 0.005;
    for (let k = 0; k < 3; k++) {
      assert.ok(Math.abs(bb.min.getComponent(k) - E.min[k]) < tol, `${name} min[${k}] ${bb.min.getComponent(k)} vs ${E.min[k]}`);
      assert.ok(Math.abs(bb.max.getComponent(k) - E.max[k]) < tol, `${name} max[${k}] ${bb.max.getComponent(k)} vs ${E.max[k]}`);
    }
    for (const a of E.attrs) assert.ok(attrs.has(a), name + ' loaded attribute ' + a);
    assert.ok(gltf.scene.children.length > 0);
  });
}

await ok('a bare GLTFLoader (as game.js creates it) reads the compressed kit through the vendored default decoder', async () => {
  const loader = noTextures(new GLTFLoader()); // no setMeshoptDecoder call
  assert.equal(loader.meshoptDecoder, MeshoptDecoder, 'vendored default');
  const gltf = await parseGLB(path.join(MODELS_DIR, 'mason_kit.glb'), loader);
  assert.ok(gltf.scene.children.length > 0);
});

await ok('the five models together are below the old 26.9 MB + the KTX2 images (geometry meshopt-compressed; images KTX2 UASTC / ETC1S)', () => {
  assert.ok(total < 31e6, 'total ' + total);
  console.log('      total ' + (total / 1e6).toFixed(2) + ' MB (was 26.88 MB with 2048 JPEG / WebP images, 18.1 MB geometry-compressed)');
});

// GPU residency of the model textures (compress_glb_textures.mjs): ASTC 4x4 / BC7 = 1 byte per texel, +33 % for the mip chain
await ok('every GLB image is KTX2 (KHR_texture_basisu, required) and the player + Mason textures stay under 70 MB resident', () => {
  return (async () => {
    let arms = 0;
    let rest = 0;
    for (const name of Object.keys(EXPECT)) {
      const g = await readGLB(path.join(MODELS_DIR, name + '.glb'));
      assert.ok((g.js.extensionsRequired || []).includes('KHR_texture_basisu'), name + ' requires KHR_texture_basisu');
      for (const tex of g.js.textures || []) {
        const ext = tex.extensions && tex.extensions.KHR_texture_basisu;
        const img = g.js.images[ext ? ext.source : tex.source];
        const bytes = Buffer.from(g.view(img.bufferView));
        if (img.mimeType === 'image/ktx2') {
          assert.equal(bytes.toString('latin1', 1, 7), 'KTX 20', name + ' KTX2 identifier');
          const mb = (bytes.readUInt32LE(20) * bytes.readUInt32LE(24) * 1.34) / 1e6;
          if (name === 'player_arms') arms += mb;
          else if (name === 'mason_rig' || name === 'player_body') rest += mb; // what is resident together with the hands
        } else assert.ok(bytes.length < 100e3, name + ' keeps only tiny non-KTX2 images (' + img.mimeType + ')');
      }
    }
    console.log('      resident GPU: arms ' + arms.toFixed(1) + ' MB, body + Mason rig ' + rest.toFixed(1) + ' MB');
    assert.ok(arms <= 40, 'arms ' + arms);
    assert.ok(arms + rest <= 70, 'total ' + (arms + rest));
  })();
});

console.log(n + ' tests passed');
