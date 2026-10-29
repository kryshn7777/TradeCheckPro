// ABYSSAL TETHER 3D - GPU texture compression of the shipped GLBs (KHR_texture_basisu / KTX2 UASTC).
//
// The GLBs used to carry 2048 JPEG / WebP images. A browser decodes those to RGBA8 (4 bytes / texel, +33 % mips): ~22 MB per map, ~230 MB
// for hands + body + Mason (more than the whole level budget; Quest tab memory pressure). This tool replaces every image with a KTX2
// (Basis Universal, UASTC + zstd or ETC1S, full mip chain) that the vendored KTX2Loader transcodes to ASTC 4x4 on Quest (1 byte / texel, so a
// 2048 map = 5.6 MB with mips, a 1024 map = 1.4 MB), BC7 on desktop, ETC2 / RGBA8 as the last resort.
//
//   player_arms  albedo / normal / ORM 2048 (close up), emissive 1024     ~18 MB resident
//   player_body  albedo / normal / ORM 1024                               ~4 MB
//   mason_*      albedo / normal 1024 (ORM stays 512)                     ~6 MB (the LOD1 shares the atlas)
//
// Geometry, skins, clips, extras and the custom vertex attributes pass through unchanged (the document is decoded and re-written with
// the same lossless EXT_meshopt_compression settings as compress_glbs.mjs). Images that are already KTX2 are skipped, so re-running
// is a no-op; tiny images (edge <= 256 texels, the ECG screen) are left as they are. KHR_texture_basisu is declared REQUIRED: the
// loader must have a KTX2Loader (src/render/glbLoad.js attaches one).
//
// One-time tool install (not shipped, not in package.json):
//   GLTF_TOOLS: npm i meshoptimizer@0.22.0 @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions
//   KTX2_TOOLS: npm i ktx2-encoder@0.6.0 sharp                                   (same as encode_ktx2.mjs)
// Run:
//   GLTF_TOOLS=<dir> KTX2_TOOLS=<dir> node tools/abyssal-tether-3d/compress_glb_textures.mjs [--dir D] [--out D] [--only a,b]
// Afterwards: npm run at3d:sw (precache list + hashes). The pre-KTX2 originals are in git history.

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
const repo = path.resolve(here, '..', '..');
const dir = path.resolve(opt('dir', path.join(repo, 'public', 'abyssal-tether-3d', 'assets', 'models')));
const outDir = path.resolve(opt('out', dir));
const gltfTools = process.env.GLTF_TOOLS || opt('gltf-tools');
const ktxTools = process.env.KTX2_TOOLS || opt('ktx2-tools');
if (!gltfTools || !ktxTools) {
  console.error('usage: GLTF_TOOLS=<dir> KTX2_TOOLS=<dir> node compress_glb_textures.mjs [--dir D] [--out D] [--only a,b]');
  process.exit(2);
}
// max edge (texels) per file and role
const PLAN = {
  player_arms: { albedo: 2048, normal: 2048, orm: 2048, emissive: 1024 },
  player_body: { albedo: 1024, normal: 1024, orm: 1024, emissive: 1024, etc1s: ['albedo', 'emissive'] },
  mason_rig: { albedo: 1024, normal: 1024, orm: 512, emissive: 512, etc1s: ['albedo', 'emissive'] },
  mason_kit: { albedo: 1024, normal: 1024, orm: 512, emissive: 512, etc1s: ['albedo', 'emissive'] },
  mason_hero: { albedo: 1024, normal: 1024, orm: 512, emissive: 512, etc1s: ['albedo', 'emissive'] },
  // THE HOLDFAST (build_holdfast.py): baked at 2048, shipped at 1024 (normal / ORM UASTC, ORM B = the vein mask; albedo ETC1S): ~2 MB
  holdfast: { albedo: 1024, normal: 1024, orm: 1024, emissive: 512, etc1s: ['albedo'] },
  // THE DRESSER v2 (build_dresser.py): baked at 2048, shipped at 1024 (normal / ORM UASTC, ORM B = the eye-slit glow mask; albedo ETC1S)
  dresser: { albedo: 1024, normal: 1024, orm: 1024, emissive: 512, etc1s: ['albedo'] },
};
// etc1s: roles encoded as ETC1S (about 5x smaller downloads, same 1 byte / texel on the GPU); everything else is UASTC (clean normals,
// the close-up hands)
const only = opt('only', Object.keys(PLAN).join(',')).split(',').map((s) => s.trim()).filter(Boolean);
const MIN_EDGE = 256; // smaller images (the ECG screen) stay PNG: 0.1 MB resident

const reqG = createRequire(path.join(path.resolve(gltfTools), 'node_modules', 'x.js'));
const reqK = createRequire(path.join(path.resolve(ktxTools), 'node_modules', 'x.js'));
const impG = (p) => import(pathToFileURL(reqG.resolve(p)).href);
const { NodeIO } = await impG('@gltf-transform/core');
const { EXTMeshoptCompression, KHRTextureBasisu, ALL_EXTENSIONS } = await impG('@gltf-transform/extensions');
const { MeshoptEncoder, MeshoptDecoder } = await impG('meshoptimizer');
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
const { encodeToKTX2 } = await import(pathToFileURL(path.join(path.resolve(ktxTools), 'node_modules', 'ktx2-encoder', 'dist', 'node', 'index.js')).href);
const sharp = reqK('sharp');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const imageDecoder = async (buf) => {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

async function encode(input, { srgb, size, uastc = true }) {
  let png = input;
  const meta = await sharp(input).metadata();
  const edge = Math.max(meta.width, meta.height);
  if (edge > size) png = await sharp(input).resize(size, size, { kernel: 'lanczos3', fit: 'fill' }).png().toBuffer();
  else png = await sharp(input).png().toBuffer();
  return encodeToKTX2(new Uint8Array(png), {
    isUASTC: uastc,
    generateMipmap: true,
    imageDecoder,
    enableDebug: false,
    isKTX2File: true,
    isYFlip: false, // glTF UVs have their origin top-left: rows are stored top first
    isPerceptual: srgb,
    isSetKTX2SRGBTransferFunc: srgb,
    needSupercompression: uastc, // zstd on UASTC
    uastcLDRQualityLevel: 2,
    enableRDO: uastc,
    rdoQualityLevel: srgb ? 1.5 : 0.8,
    qualityLevel: 150, // ETC1S
    compressionLevel: 3,
  });
}

fs.mkdirSync(outDir, { recursive: true });
let before = 0;
let after = 0;
for (const name of only) {
  const src = path.join(dir, name + '.glb');
  if (!PLAN[name] || !fs.existsSync(src)) {
    console.log(`  ${name}: unknown / missing, skipped`);
    continue;
  }
  const raw = fs.readFileSync(src);
  const doc = await io.readBinary(raw);
  // role of every texture: sRGB colour (albedo / emissive) or linear data (normal / ORM)
  const role = new Map();
  for (const m of doc.getRoot().listMaterials()) {
    const set = (t, r) => t && !role.has(t) && role.set(t, r);
    set(m.getBaseColorTexture(), 'albedo');
    set(m.getEmissiveTexture(), 'emissive');
    set(m.getNormalTexture(), 'normal');
    set(m.getMetallicRoughnessTexture(), 'orm');
    set(m.getOcclusionTexture(), 'orm');
  }
  let changed = 0;
  for (const t of doc.getRoot().listTextures()) {
    const img = t.getImage();
    if (!img || t.getMimeType() === 'image/ktx2' || Math.max(...t.getSize()) <= MIN_EDGE) continue;
    const r = role.get(t) || 'albedo';
    const size = PLAN[name][r];
    const t0 = Date.now();
    const ktx = await encode(Buffer.from(img), { srgb: r === 'albedo' || r === 'emissive', size, uastc: !(PLAN[name].etc1s || []).includes(r) });
    t.setImage(ktx).setMimeType('image/ktx2');
    changed++;
    console.log(`    ${t.getName().padEnd(22)} ${r.padEnd(8)} <=${size}  ${(img.length / 1e6).toFixed(2)} MB -> ${(ktx.length / 1e6).toFixed(2)} MB  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  if (!changed) {
    console.log(`  ${name}: nothing to convert`);
    before += raw.length;
    after += raw.length;
    continue;
  }
  doc.createExtension(KHRTextureBasisu).setRequired(true);
  // drop the now unused WebP declaration
  for (const e of doc.getRoot().listExtensionsUsed()) if (e.extensionName === 'EXT_texture_webp' && !doc.getRoot().listTextures().some((t) => t.getMimeType() === 'image/webp')) e.dispose();
  if (!doc.getRoot().listExtensionsUsed().some((e) => e instanceof EXTMeshoptCompression)) throw new Error(name + ': expected a meshopt-compressed GLB (run compress_glbs.mjs first)');
  const bytes = await io.writeBinary(doc);
  fs.writeFileSync(path.join(outDir, name + '.glb'), bytes);
  before += raw.length;
  after += bytes.length;
  console.log(`  ${name.padEnd(12)} ${(raw.length / 1e6).toFixed(2)} MB -> ${(bytes.length / 1e6).toFixed(2)} MB`);
}
console.log(`total ${(before / 1e6).toFixed(2)} MB -> ${(after / 1e6).toFixed(2)} MB`);
