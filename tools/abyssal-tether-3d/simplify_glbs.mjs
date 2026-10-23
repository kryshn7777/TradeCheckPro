// ABYSSAL TETHER 3D - mesh simplification of the shipped GLBs that sit in the near field (hands, launchers, arms, body, lantern).
//
// meshoptimizer's simplifier collapses edges onto existing vertices (no new vertices, so skin joints / weights, UVs and tangents stay
// valid) and stops at an error bound: `error` is the largest allowed deviation as a fraction of the mesh radius, so a tight bound
// removes only triangles that do not change the shape (flat areas, over-tessellated fillets) and keeps the silhouette and every
// feature larger than the bound. Each mesh below has its own bound; nothing else in the file is touched (the 2-triangle ECG screen
// quads, the grapple head, ...).
//
//   GLTF_TOOLS=$TOOLS node tools/abyssal-tether-3d/simplify_glbs.mjs [--dir <models dir>] [--out <dir>] [--only a,b] [--scale 1] [--dry]
//   GLTF_TOOLS=$TOOLS node tools/abyssal-tether-3d/compress_glbs.mjs --dir <out> --out <models dir> --force   # then re-encode (meshopt)
//
// --dry prints the table (triangles before / after, the simplifier's own error in metres) without writing. --scale multiplies every
// error bound (0.5 = tighter, 2 = looser). Run `npm run at3d:sw` afterwards (precache hashes). The tool setup is the one of
// compress_glbs.mjs: npm i meshoptimizer@0.22.0 @gltf-transform/core @gltf-transform/extensions @gltf-transform/functions
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf('--' + k);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const has = (k) => argv.includes('--' + k);
const dir = path.resolve(opt('dir', path.join(HERE, '..', '..', 'public', 'abyssal-tether-3d', 'assets', 'models')));
const outDir = path.resolve(opt('out', dir));
const toolsDir = process.env.GLTF_TOOLS || opt('tools');
const SCALE = Number(opt('scale', '1')) || 1;

/** file -> mesh name -> { ratio: target share of triangles, error: bound as a fraction of the mesh radius } */
const PLAN = {
  player_arms: {
    Launcher_L_Mesh: { ratio: 0.5, error: 0.0016 },
    Launcher_R_Mesh: { ratio: 0.5, error: 0.0016 },
    Arm_L_Mesh: { ratio: 0.6, error: 0.0012 },
    'Glove_High_R.003': { ratio: 0.6, error: 0.0012 },
    Lantern_Mesh: { ratio: 0.6, error: 0.0012 },
  },
  player_body: {
    Body_Low: { ratio: 0.6, error: 0.0015 },
  },
};
const only = opt('only', Object.keys(PLAN).join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

if (!toolsDir) {
  console.error('usage: GLTF_TOOLS=<dir with node_modules/{meshoptimizer,@gltf-transform/*}> node simplify_glbs.mjs [--dir D] [--out D] [--only a,b] [--scale N] [--dry]');
  process.exit(2);
}
const nm = path.join(path.resolve(toolsDir), 'node_modules');
const req = createRequire(path.join(nm, 'x.js'));
const imp = (p) => import(pathToFileURL(req.resolve(p)).href);
const { NodeIO } = await imp('@gltf-transform/core');
const { ALL_EXTENSIONS } = await imp('@gltf-transform/extensions');
const { simplifyPrimitive, getPrimitiveVertexCount, VertexCountMethod } = await imp('@gltf-transform/functions');
const { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } = await imp('meshoptimizer');
await MeshoptEncoder.ready;
await MeshoptDecoder.ready;
await MeshoptSimplifier.ready;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const tris = (prim) => getPrimitiveVertexCount(prim, VertexCountMethod.RENDER) / 3;

fs.mkdirSync(outDir, { recursive: true });
let totBefore = 0;
let totAfter = 0;
for (const name of only) {
  const plan = PLAN[name];
  const src = path.join(dir, name + '.glb');
  if (!plan || !fs.existsSync(src)) {
    console.log(`  ${name}: no plan or missing, skipped`);
    continue;
  }
  const doc = await io.readBinary(fs.readFileSync(src));
  console.log(`${name}.glb`);
  for (const mesh of doc.getRoot().listMeshes()) {
    const cfg = plan[mesh.getName()];
    if (!cfg) continue;
    for (const prim of mesh.listPrimitives()) {
      const before = tris(prim);
      if (before < 100) continue; // a quad / a gauge: leave it
      // meshopt's own deviation in metres: the error is relative to the mesh radius
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: cfg.ratio, error: cfg.error * SCALE, lockBorder: false });
      const after = tris(prim);
      totBefore += before;
      totAfter += after;
      console.log(`  ${mesh.getName().padEnd(20)} ${String(Math.round(before)).padStart(6)} -> ${String(Math.round(after)).padStart(6)} tris  (${((1 - after / before) * 100).toFixed(0)} % fewer, bound ${(cfg.error * SCALE * 100).toFixed(2)} % of the radius)`);
    }
  }
  if (has('dry')) continue;
  // write uncompressed: the extension object must go, or the writer would encode with it again (compress_glbs.mjs does that step)
  for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === 'EXT_meshopt_compression') ext.dispose();
  fs.writeFileSync(path.join(outDir, name + '.glb'), await io.writeBinary(doc));
}
console.log(`total ${Math.round(totBefore)} -> ${Math.round(totAfter)} tris (${totBefore ? ((1 - totAfter / totBefore) * 100).toFixed(0) : 0} % fewer)${has('dry') ? ' [dry run, nothing written]' : ''}`);
