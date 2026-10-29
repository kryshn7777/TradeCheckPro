// ABYSSAL TETHER 3D - geometry compression of the shipped GLBs (WP-GFX-PARITY): EXT_meshopt_compression + KHR_mesh_quantization.
//
//   mason_rig 7.9 MB, player_arms 5.8, mason_hero 5.6, mason_kit 5.5, player_body 2.1  ->  see the report this prints.
//
// What it does to each file (in place; the uncompressed originals are in git history):
//   1. reorder (meshopt vertex cache / fetch order) for better compression and GPU cache use
//   2. quantize POSITION (14 bit), NORMAL / TANGENT (10 bit), TEXCOORD_n (12 bit), WEIGHTS_n (8 bit) with KHR_mesh_quantization.
//      player_arms and player_body keep float32 POSITION (meshopt still compresses it losslessly; +0.16 MB for both): their shaders
//      (render/gearSurface.js wear maps) read the bind-pose position in METRES, which a quantised, scene-normalised position is not.
//      The custom per-vertex attributes (_SPINE_S float, _PART float id, _MASK ubyte, _OWNER ubyte ...), JOINTS_n and COLOR_n are
//      NOT touched: they are plain data the creature shaders / views read (a 12-bit normalised _SPINE_S or _PART id would corrupt them);
//      meshopt's vertex codec still shrinks them losslessly.
//      Skinned files quantize against one scene-wide volume, so every mesh keeps sharing one skin (the correction goes into the
//      inverse bind matrices); non-skinned kit files quantize per mesh (the correction goes into the node matrix).
//   3. EXT_meshopt_compression (required): vertex + index buffers, animation samplers. Lossless codec, no decoder filters, so any
//      MeshoptDecoder (three's examples/jsm/libs/meshopt_decoder.module.js, vendored under vendor/three/addons/libs/) reads it.
//   Images, materials, skins, animations and extras pass through unchanged.
//
// One-time tool install (not shipped, not in package.json), same pattern as encode_ktx2.mjs:
//   mkdir -p $TOOLS && cd $TOOLS && npm init -y && npm i meshoptimizer@0.22.0 @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions
// Run:
//   GLTF_TOOLS=$TOOLS node tools/abyssal-tether-3d/compress_glbs.mjs [--dir <models dir>] [--out <dir>] [--only a,b] [--force]
// Files that already use EXT_meshopt_compression are skipped (re-running is a no-op) unless --force (then they are re-encoded from
// the decoded geometry: only useful after changing the settings above). Afterwards: npm run at3d:sw (precache list + hashes).

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => {
  const i = args.indexOf('--' + k);
  return i >= 0 ? args[i + 1] : d;
};
const has = (k) => args.includes('--' + k);
const repo = path.resolve(here, '..', '..');
const dir = path.resolve(opt('dir', path.join(repo, 'public', 'abyssal-tether-3d', 'assets', 'models')));
const outDir = path.resolve(opt('out', dir));
const toolsDir = process.env.GLTF_TOOLS || opt('tools');
const FILES = ['mason_rig', 'player_arms', 'mason_hero', 'mason_kit', 'player_body', 'holdfast'];
const only = opt('only', FILES.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (!toolsDir) {
  console.error('usage: GLTF_TOOLS=<dir with node_modules/{meshoptimizer,@gltf-transform/*}> node compress_glbs.mjs [--dir D] [--out D] [--only a,b] [--force]');
  process.exit(2);
}
const nm = path.join(path.resolve(toolsDir), 'node_modules');
const req = createRequire(path.join(nm, 'x.js'));
const imp = (p) => import(pathToFileURL(req.resolve(p)).href);
const { NodeIO } = await imp('@gltf-transform/core');
const { EXTMeshoptCompression, ALL_EXTENSIONS } = await imp('@gltf-transform/extensions');
const { quantize, reorder } = await imp('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder } = await imp('meshoptimizer');
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
// everything except the custom attributes, JOINTS and COLOR (see header)
const QUANT = /^(POSITION|NORMAL|TANGENT|TEXCOORD_\d+|WEIGHTS_\d+)$/;
const QUANT_METRIC = /^(NORMAL|TANGENT|TEXCOORD_\d+|WEIGHTS_\d+)$/; // float32 positions (metres)
const METRIC_POSITIONS = new Set(['player_arms', 'player_body']);

fs.mkdirSync(outDir, { recursive: true });
let before = 0;
let after = 0;
for (const name of only) {
  const src = path.join(dir, name + '.glb');
  if (!fs.existsSync(src)) {
    console.log(`  ${name}: missing, skipped`);
    continue;
  }
  const raw = fs.readFileSync(src);
  const doc = await io.readBinary(raw);
  const used = doc.getRoot().listExtensionsUsed().map((e) => e.extensionName);
  if (used.includes('EXT_meshopt_compression') && !has('force')) {
    console.log(`  ${name}: already meshopt-compressed (${(raw.length / 1e6).toFixed(2)} MB), skipped`);
    before += raw.length;
    after += raw.length;
    continue;
  }
  const skinned = doc.getRoot().listSkins().length > 0;
  const nodes = doc.getRoot().listNodes().length;
  await doc.transform(reorder({ encoder: MeshoptEncoder, target: 'size' }));
  await doc.transform(
    quantize({
      pattern: METRIC_POSITIONS.has(name) ? QUANT_METRIC : QUANT,
      quantizationVolume: skinned ? 'scene' : 'mesh',
      quantizePosition: 14,
      quantizeNormal: 10,
      quantizeTexcoord: 12,
      quantizeWeight: 8,
      normalizeWeights: true,
    }),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
  const bytes = await io.writeBinary(doc);
  fs.writeFileSync(path.join(outDir, name + '.glb'), bytes);
  before += raw.length;
  after += bytes.length;
  console.log(
    `  ${name.padEnd(12)} ${(raw.length / 1e6).toFixed(2)} MB -> ${(bytes.length / 1e6).toFixed(2)} MB  (${skinned ? 'skinned, scene volume' : 'static, mesh volume'}, ${nodes} nodes)`,
  );
}
console.log(`total ${(before / 1e6).toFixed(2)} MB -> ${(after / 1e6).toFixed(2)} MB, saved ${((before - after) / 1e6).toFixed(2)} MB`);
