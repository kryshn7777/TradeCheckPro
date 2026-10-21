// ABYSSAL TETHER 3D - KTX2 (Basis Universal) encoder for the baked texture masters.
//
// Reads the lossless masters written by build_textures_hq.py (<set>_albedo.png, <set>_normal_h.png, <set>_orm.png,
// detail_normal.png) and writes GPU-compressed .ktx2 files (full mip chain) into the game's assets/textures folder,
// then records them in manifest.json ("ktx2": {albedo, normal, orm}).
//
//   hero sets (rock, masonry, metal; 2048)   albedo UASTC + zstd, normal UASTC + zstd, ORM UASTC + zstd
//   other sets (1024)                        albedo ETC1S (~8x smaller), normal / ORM UASTC + zstd
//
// UASTC is the quality tier (transcodes to ASTC 4x4 on Quest: 8 bpp on the GPU, normals stay clean); ETC1S is the
// small tier (transcodes to ETC2 / ASTC). Normals are NOT encoded in "normal map mode": the blue channel carries the
// height field (see build_textures_hq.py) and must be preserved as plain data.
//
// One-time tool install (not shipped, not in package.json):
//   mkdir -p $TOOLS && cd $TOOLS && npm init -y && npm i ktx2-encoder@0.6.0 sharp
// Run:
//   KTX2_TOOLS=$TOOLS node tools/abyssal-tether-3d/encode_ktx2.mjs --work <masters dir> [--sets rock,masonry] [--out <dir>]
//
// Equivalent with Khronos' toktx (if you have it): toktx --t2 --encode uastc --uastc_quality 2 --zcmp 19 --genmipmap
//   --assign_oetf srgb out.ktx2 in.png   (use --assign_oetf linear for normal / ORM maps; ETC1S: --encode etc1s --clevel 4 --qlevel 160)

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
const work = opt('work');
const out = opt('out', path.join(here, '..', '..', 'public', 'abyssal-tether-3d', 'assets', 'textures'));
const toolsDir = process.env.KTX2_TOOLS || opt('tools');
if (!work || !toolsDir) {
  console.error('usage: KTX2_TOOLS=<dir with node_modules/ktx2-encoder + sharp> node encode_ktx2.mjs --work <masters> [--sets a,b] [--out dir]');
  process.exit(2);
}
const nm = path.join(path.resolve(toolsDir), 'node_modules');
const { encodeToKTX2 } = await import(pathToFileURL(path.join(nm, 'ktx2-encoder', 'dist', 'node', 'index.js')).href);
const sharp = createRequire(path.join(nm, 'x.js'))('sharp');

const HERO = new Set(['rock', 'masonry', 'metal']);
const ALL = ['rock', 'masonry', 'metal', 'rockFar', 'flesh', 'rubble', 'roots', 'detail', 'decals'];
const sets = opt('sets', ALL.join(',')).split(',').map((s) => s.trim()).filter(Boolean);

const imageDecoder = async (buf) => {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8Array(data), width: info.width, height: info.height };
};

async function enc(src, dst, { uastc, srgb, size = 0, rdo = 1.5 }) {
  const t = Date.now();
  let input = fs.readFileSync(src);
  if (size) input = await sharp(input).resize(size, size, { kernel: 'lanczos3' }).png().toBuffer();
  const bytes = await encodeToKTX2(new Uint8Array(input), {
    isUASTC: uastc,
    generateMipmap: true,
    imageDecoder,
    enableDebug: false,
    isKTX2File: true,
    isYFlip: true, // stored bottom row first: matches the TextureLoader (flipY) convention the shader / box UVs assume
    isPerceptual: srgb,
    isSetKTX2SRGBTransferFunc: srgb,
    needSupercompression: uastc, // zstd on UASTC
    uastcLDRQualityLevel: 2,
    enableRDO: uastc,
    rdoQualityLevel: rdo,
    qualityLevel: 150,
    compressionLevel: 3,
  });
  fs.writeFileSync(dst, bytes);
  console.log(`  ${path.basename(dst).padEnd(24)} ${(bytes.length / 1e6).toFixed(2)} MB  ${((Date.now() - t) / 1000).toFixed(1)} s`);
  return bytes.length;
}

const manPath = path.join(out, 'manifest.json');
const man = JSON.parse(fs.readFileSync(manPath, 'utf8'));
// merge one set into the manifest as it is on disk right now (several encoder processes may run side by side)
const saveEntry = (name, ent) => {
  const cur = JSON.parse(fs.readFileSync(manPath, 'utf8'));
  cur[name] = Object.assign(cur[name] || {}, { ktx2: ent.ktx2 });
  fs.writeFileSync(manPath + '.tmp' + process.pid, JSON.stringify(cur, null, 2) + '\n');
  fs.renameSync(manPath + '.tmp' + process.pid, manPath);
};
let total = 0;
for (const name of sets) {
  console.log(name);
  const hero = HERO.has(name);
  const ent = man[name] || (man[name] = {});
  ent.ktx2 = ent.ktx2 || {};
  if (name === 'detail') {
    total += await enc(path.join(work, 'detail_normal.png'), path.join(out, 'detail_normal.ktx2'), { uastc: true, srgb: false, rdo: 0.8 });
    ent.ktx2.normal = 'detail_normal.ktx2';
    saveEntry(name, ent);
    continue;
  }
  if (name === 'decals') {
    // RGBA atlas: ETC1S with an alpha slice (small), normals UASTC
    total += await enc(path.join(work, 'decals_albedo.png'), path.join(out, 'decals_albedo.ktx2'), { uastc: false, srgb: true });
    total += await enc(path.join(work, 'decals_normal.png'), path.join(out, 'decals_normal.ktx2'), { uastc: true, srgb: false, rdo: 0.8 });
    ent.ktx2 = { albedo: 'decals_albedo.ktx2', normal: 'decals_normal.ktx2' };
    saveEntry(name, ent);
    continue;
  }
  total += await enc(path.join(work, `${name}_albedo.png`), path.join(out, `${name}_albedo.ktx2`), { uastc: hero, srgb: true });
  total += await enc(path.join(work, `${name}_normal_h.png`), path.join(out, `${name}_normal.ktx2`), { uastc: true, srgb: false, rdo: 0.8 });
  // hero ORM is encoded at 1024: AO / roughness / metalness are low-frequency, the 2048 detail rides on albedo + normal
  total += await enc(path.join(work, `${name}_orm.png`), path.join(out, `${name}_orm.ktx2`), { uastc: true, srgb: false, rdo: 0.8, size: hero ? 1024 : 0 });
  ent.ktx2 = { albedo: `${name}_albedo.ktx2`, normal: `${name}_normal.ktx2`, orm: `${name}_orm.ktx2`, normalHeightInB: true };
  saveEntry(name, ent);
}
console.log(`ktx2 total ${(total / 1e6).toFixed(2)} MB`);
