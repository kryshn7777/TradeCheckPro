#!/usr/bin/env node
// Parses a .glb (no dependencies): node names, triangle counts per mesh, materials, textures, attributes,
// extensions, and an instanced-triangle total per root. Usage: node check_glb.mjs file.glb [--json]
import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: check_glb.mjs file.glb [--json]');
  process.exit(2);
}
const buf = fs.readFileSync(file);
if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB');
const len = buf.readUInt32LE(8);
let off = 12;
let json = null;
let bin = null;
while (off < len) {
  const cl = buf.readUInt32LE(off);
  const ct = buf.readUInt32LE(off + 4);
  const data = buf.subarray(off + 8, off + 8 + cl);
  if (ct === 0x4e4f534a) json = JSON.parse(data.toString('utf8'));
  else if (ct === 0x004e4942) bin = data;
  off += 8 + cl;
}
const out = { file, bytes: buf.length, extensionsUsed: json.extensionsUsed || [], extensionsRequired: json.extensionsRequired || [] };
const meshTris = json.meshes.map((m) => {
  let tris = 0;
  const attrs = new Set();
  let verts = 0;
  const mats = new Set();
  for (const p of m.primitives) {
    const idx = p.indices !== undefined ? json.accessors[p.indices].count : json.accessors[p.attributes.POSITION].count;
    tris += Math.floor(idx / 3);
    verts += json.accessors[p.attributes.POSITION].count;
    Object.keys(p.attributes).forEach((a) => attrs.add(a));
    if (p.material !== undefined) mats.add(json.materials[p.material].name);
  }
  return { name: m.name, tris, verts, attrs: [...attrs], materials: [...mats], primitives: m.primitives.length };
});
out.meshes = meshTris.length;
out.materials = (json.materials || []).map((m) => ({
  name: m.name,
  baseColorTexture: !!(m.pbrMetallicRoughness && m.pbrMetallicRoughness.baseColorTexture),
  metallicRoughnessTexture: !!(m.pbrMetallicRoughness && m.pbrMetallicRoughness.metallicRoughnessTexture),
  normalTexture: !!m.normalTexture,
  occlusionTexture: !!m.occlusionTexture,
  emissiveFactor: m.emissiveFactor,
  extensions: Object.keys(m.extensions || {}),
  doubleSided: !!m.doubleSided,
  alphaMode: m.alphaMode || 'OPAQUE',
}));
out.images = (json.images || []).map((im) => {
  const bv = json.bufferViews[im.bufferView];
  return { name: im.name, mime: im.mimeType, bytes: bv ? bv.byteLength : 0 };
});
// instanced triangles: walk the node tree
const nodes = json.nodes || [];
const named = [];
function walk(i, depth, root) {
  const n = nodes[i];
  let t = 0;
  if (n.mesh !== undefined) t += meshTris[n.mesh].tris;
  for (const c of n.children || []) t += walk(c, depth + 1, root);
  if (depth === 0 || (n.name && /^Mason_(Head|Segment_\d|Tail|Frond_\d|Pit|PitMembrane|LimbUpper|LimbLower|Hook)/.test(n.name) && depth <= 1)) {
    named.push({ name: n.name, tris: t, mesh: n.mesh !== undefined ? meshTris[n.mesh].name : null, extras: n.extras ? Object.keys(n.extras) : [] });
  }
  return t;
}
const scene = json.scenes[json.scene || 0];
let total = 0;
for (const r of scene.nodes) total += walk(r, 0, r);
out.sceneTriangles = total;
out.topLevel = named.slice(0, 80);
out.meshTable = meshTris.slice(0, 60);
if (process.argv.includes('--json')) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`${file}  ${(buf.length / 1e6).toFixed(2)} MB  meshes ${out.meshes}  scene triangles (instanced) ${total}`);
  console.log('extensions', out.extensionsUsed.join(', ') || '-');
  console.log('materials:');
  for (const m of out.materials) console.log('  ', JSON.stringify(m));
  console.log('images:');
  for (const m of out.images) console.log('  ', JSON.stringify(m));
  console.log('top-level nodes:');
  for (const t of out.topLevel) console.log('  ', t.name.padEnd(28), String(t.tris).padStart(7), 'tris', t.mesh || '');
  console.log('meshes:');
  for (const m of out.meshTable) console.log('  ', m.name.padEnd(28), String(m.tris).padStart(7), 'tris', String(m.verts).padStart(7), 'verts', m.attrs.join(','), '|', m.materials.join(','));
}
