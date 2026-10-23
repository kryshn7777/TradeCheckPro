// ABYSSAL TETHER 3D - decor_part_boxes.mjs
// Derives the collision boxes of the environment kit parts that stand out into the shaft (corbels, stair fragments, buttresses,
// pipes, ...) from the built kit and writes them to src/data/decor-parts-3d.js. Run after build_env_kit.py:
//
//   node tools/abyssal-tether-3d/bake/decor_part_boxes.mjs [--glb <ch1_env_kit.glb>] [--out <decor-parts-3d.js>]
//
// A part is cut into slices along its longer side (x or y); each slice becomes one axis-aligned box around the triangles whose
// centre lies in it (so a stair flight collides as its steps, a battered buttress as its taper, not as one big block), then
// the box is pulled in a few centimetres so the player never bumps into air. The lean (Quest) kit is the source: the rich
// kit's parts are the same shapes at a higher triangle count, and the sim must not depend on which kit a device loaded.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', 'public', 'abyssal-tether-3d');
const arg = (k, d) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const GLB = arg('--glb', path.join(ROOT, 'assets', 'models', 'env', 'ch1_env_kit.glb'));
const OUT = arg('--out', path.join(ROOT, 'src', 'data', 'decor-parts-3d.js'));

/** Parts that collide: those that project into the open (the flush wall relief, the cogs and the roots / growths do not). */
export const COLLIDE = [
  'corbel',
  'corbel_figure',
  'corbel_hero',
  'capital',
  'base',
  'boss',
  'bracket',
  'saint',
  'stair_fragment',
  'buttress_lo',
  'buttress_cap',
  'column_cluster',
  'pipe_run',
  'arch_fragment',
  'geartrain',
  'lantern',
];
const INSET = 0.035; // metres pulled in from every side but the wall side
const MIN_SIDE = 0.07; // boxes thinner than this after the inset are dropped (clamps, rivets, finials)
const SLICE = 0.45; // target slice length (m)
const MAX_SLICES = 8;

function readGLB(file) {
  const b = fs.readFileSync(file);
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jl).toString('utf8'));
  const binOff = 20 + jl + 8;
  if ((j.extensionsUsed || []).includes('EXT_meshopt_compression')) throw new Error('compressed kit: build it with build_env_kit.py (uncompressed) first');
  const bin = b.subarray(binOff);
  const view = (a) => {
    const bv = j.bufferViews[a.bufferView];
    return { off: (bv.byteOffset || 0) + (a.byteOffset || 0), stride: bv.byteStride || 0 };
  };
  const pos = (i) => {
    const a = j.accessors[i];
    const { off } = view(a);
    const out = new Float32Array(a.count * 3);
    for (let k = 0; k < a.count * 3; k++) out[k] = bin.readFloatLE(off + k * 4);
    return out;
  };
  const idx = (i) => {
    const a = j.accessors[i];
    const { off } = view(a);
    const n = a.count;
    const out = new Uint32Array(n);
    for (let k = 0; k < n; k++) out[k] = a.componentType === 5125 ? bin.readUInt32LE(off + k * 4) : bin.readUInt16LE(off + k * 2);
    return out;
  };
  return { j, pos, idx };
}

function partBoxes(P, I) {
  const tris = [];
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < I.length; t += 3) {
    const v = [I[t], I[t + 1], I[t + 2]].map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    tris.push(v);
    for (const p of v) for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], p[a]);
      hi[a] = Math.max(hi[a], p[a]);
    }
  }
  const ext = [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]];
  const axis = ext[1] >= ext[0] ? 1 : 0;
  const n = Math.max(1, Math.min(MAX_SLICES, Math.round(ext[axis] / SLICE)));
  const slices = Array.from({ length: n }, () => ({ lo: [Infinity, Infinity, Infinity], hi: [-Infinity, -Infinity, -Infinity], n: 0 }));
  for (const v of tris) {
    const c = (v[0][axis] + v[1][axis] + v[2][axis]) / 3;
    const s = slices[Math.max(0, Math.min(n - 1, Math.floor(((c - lo[axis]) / ext[axis]) * n)))];
    s.n++;
    for (const p of v) for (let a = 0; a < 3; a++) {
      s.lo[a] = Math.min(s.lo[a], p[a]);
      s.hi[a] = Math.max(s.hi[a], p[a]);
    }
  }
  let boxes = slices.filter((s) => s.n > 0).map((s) => ({ lo: s.lo.slice(), hi: s.hi.slice() }));
  // merge neighbours only when the merged box is hardly bigger than the two together (overlap counted once)
  const vol = (b) => Math.max(0, b.hi[0] - b.lo[0]) * Math.max(0, b.hi[1] - b.lo[1]) * Math.max(0, b.hi[2] - b.lo[2]);
  const inter = (a, b) => vol({ lo: a.lo.map((x, k) => Math.max(x, b.lo[k])), hi: a.hi.map((x, k) => Math.min(x, b.hi[k])) });
  for (let i = 0; i + 1 < boxes.length; ) {
    const a = boxes[i];
    const b = boxes[i + 1];
    const u = { lo: a.lo.map((x, k) => Math.min(x, b.lo[k])), hi: a.hi.map((x, k) => Math.max(x, b.hi[k])) };
    if (vol(u) <= 1.05 * (vol(a) + vol(b) - inter(a, b))) boxes.splice(i, 2, u);
    else i++;
  }
  // inset: the wall side (z at the wall plane) stays flush, every other side is pulled in
  boxes = boxes
    .map((b) => {
      const lo = b.lo.slice();
      const hi = b.hi.slice();
      for (let a = 0; a < 3; a++) {
        if (a === 2 && lo[2] <= 0.06) lo[2] = Math.min(lo[2], 0);
        else lo[a] += INSET;
        hi[a] -= INSET;
      }
      return { lo, hi };
    })
    .filter((b) => b.hi[0] - b.lo[0] >= MIN_SIDE && b.hi[1] - b.lo[1] >= MIN_SIDE && b.hi[2] - b.lo[2] >= MIN_SIDE);
  return boxes;
}

function main() {
  const { j, pos, idx } = readGLB(GLB);
  const parts = {};
  for (const node of j.nodes) {
    if (node.mesh === undefined) continue;
    const name = (node.name || '').replace(/^ch1_env_/, '');
    if (!COLLIDE.includes(name)) continue;
    const prim = j.meshes[node.mesh].primitives[0];
    const boxes = partBoxes(pos(prim.attributes.POSITION), idx(prim.indices));
    parts[name] = boxes.map((b) => [...b.lo, ...b.hi].map((v) => Math.round(v * 1000) / 1000));
  }
  const missing = COLLIDE.filter((p) => !parts[p]);
  if (missing.length) throw new Error('parts missing from the kit: ' + missing.join(', '));
  const rows = Object.entries(parts)
    .map(([k, v]) => `  ${k}: ${JSON.stringify(v)},`)
    .join('\n');
  const text = `/* ABYSSAL TETHER 3D - decor-parts-3d.js (generated by tools/abyssal-tether-3d/bake/decor_part_boxes.mjs from the kit; do not edit)
 * Collision boxes of the environment kit parts that project into the open, in the kit's own space (three.js, metres):
 * [minX, minY, minZ, maxX, maxY, maxZ] per box, a compound per part. sim/decorColliders.js places them where the view
 * dressed the part. ${Object.values(parts).reduce((n, v) => n + v.length, 0)} boxes over ${Object.keys(parts).length} parts.
 */
export const DECOR_PARTS = {
${rows}
};
`;
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, text);
  console.log('wrote', OUT);
  for (const [k, v] of Object.entries(parts)) console.log(' ', k.padEnd(16), v.length, 'boxes');
}

main();
