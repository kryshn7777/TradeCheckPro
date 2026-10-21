// Node tests for the surface-detail work (WP-GFX-QUEST-MAT):
//  - the shader patch finds the three.js chunk anchors (hq path on: packed-height normal, parallax, detail, crevices, grade)
//    and the compiled-in strings reference only uniforms that exist (LOOK / per-material)
//  - the texture manifest: every referenced file exists, every .ktx2 is a KTX2 container, hero sets are 2048, the shipped
//    KTX2 download stays <= 41 MB, the decal atlas lists its 8 cells
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 'three' is vendored (no node_modules): resolve the bare specifiers the way the page's import map does
const VENDOR = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/vendor/three/')).href;
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR}/three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR}/addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
const THREE = await import('three');
const { LOOK, patchMaterial } = await import('../../../../public/abyssal-tether-3d/src/render/materials.js');
const TEX = path.resolve(HERE, '../../../../public/abyssal-tether-3d/assets/textures');
let n = 0;
const ok = (name, fn) => {
  fn();
  n++;
  console.log('  ok', name);
};

ok('hq shader patch: parallax, detail, packed height, crevices, grade', () => {
  const tex = new THREE.Texture();
  const mat = new THREE.MeshStandardMaterial({ map: tex, normalMap: tex, aoMap: tex, roughnessMap: tex, metalnessMap: tex });
  patchMaterial(mat, { uv: 'box', macro: tex, lit: true, hq: true, grade: true });
  assert.equal(mat.userData.hq, true, 'hq path on (normal_fragment_maps anchor found in this three.js build)');
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  mat.onBeforeCompile(shader);
  const fs_ = shader.fragmentShader;
  for (const s of ['atPUv', 'textureGrad( normalMap', 'uHeightM', 'uDetailMap', 'uParallaxK', 'atMossV', 'uGradeK', 'getTangentFrame( - vViewPosition']) assert.ok(fs_.includes(s), `fragment shader has ${s}`);
  assert.ok(!/#include <normal_fragment_maps>/.test(fs_), 'the stock normal chunk was replaced');
  for (const u of ['uDetailMap', 'uDetailScale', 'uDetailAmt', 'uHeightM', 'uTexScale', 'uMacroMap']) assert.ok(u in shader.uniforms, `uniform ${u} bound`);
  for (const u of ['uDetailK', 'uParallaxK', 'uCrevK', 'uGradeK', 'uGradeTint']) assert.ok(u in shader.uniforms && u in LOOK, `LOOK uniform ${u} bound`);
});

ok('non-hq materials are untouched by the surface chunks', () => {
  const mat = new THREE.MeshStandardMaterial({});
  patchMaterial(mat, { uv: 'metric', lit: true });
  const shader = { uniforms: {}, vertexShader: THREE.ShaderLib.physical.vertexShader, fragmentShader: THREE.ShaderLib.physical.fragmentShader };
  mat.onBeforeCompile(shader);
  assert.ok(!shader.fragmentShader.includes('atPUv') && !shader.fragmentShader.includes('uGradeK'));
});

const manifest = JSON.parse(fs.readFileSync(path.join(TEX, 'manifest.json'), 'utf8'));
ok('manifest: files exist, KTX2 containers, sizes', () => {
  let ktx = 0;
  for (const [name, e] of Object.entries(manifest)) {
    for (const k of ['albedo', 'normal', 'orm']) if (e[k]) assert.ok(fs.existsSync(path.join(TEX, e[k])), `${name}.${k} (${e[k]}) exists`);
    if (!e.ktx2) continue;
    for (const [k, f] of Object.entries(e.ktx2)) {
      if (typeof f !== 'string') continue;
      const buf = fs.readFileSync(path.join(TEX, f));
      ktx += buf.length;
      assert.equal(buf.subarray(1, 7).toString('latin1'), 'KTX 20', `${f} is a KTX2 file`);
      assert.equal(buf.readUInt32LE(40) > 1, true, `${f} has a mip chain`); // levelCount at byte 40
      void k;
    }
  }
  assert.ok(ktx <= 41e6, `KTX2 download ${(ktx / 1e6).toFixed(1)} MB <= 41 MB`);
  assert.ok(ktx > 20e6, 'KTX2 sets present');
  for (const hero of ['rock', 'masonry', 'metal']) assert.equal(manifest[hero].size, 2048, `${hero} is a 2048 set`);
  for (const hero of ['rock', 'masonry', 'metal']) assert.ok(manifest[hero].heightM > 0 && manifest[hero].ktx2.normalHeightInB, `${hero}: packed height range recorded`);
});

ok('manifest: decal atlas has its 8 cells', () => {
  const d = manifest.decals;
  assert.ok(d && d.names.length === 8 && Object.keys(d.layout).length === 8);
  assert.deepEqual(d.names, ['crackA', 'crackB', 'grime', 'moss', 'blood', 'burn', 'scratch', 'impact']);
});

console.log(`surface: ${n} checks passed`);
