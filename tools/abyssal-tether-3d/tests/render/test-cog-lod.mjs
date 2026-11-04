// The colossal cog wheels have levels of detail (render/levelView.js gearGeometry / cogLodFor / _updateCogs / _makeCogMesh), Node, no GPU.
// They were ONE flat 24-tooth plate at every distance ("LODs are very poor for gears"):
//   - three geometries: near (32 teeth, bevelled, rim flange, hub with boss and eight bolts), mid (the original, unchanged), far (a silhouette);
//   - the triangle counts step down, the three have the same outline (unit radius), the same attributes (so one instanced material fits all);
//   - a cog picks its level by how many radii away its rim is; the low tier never picks the near one;
//   - the per-frame update sends each instance to the right mesh, fills the counts and hides the empty meshes (a draw call only for what is used);
//   - the level cache knows all three meshes.
//   node test-cog-lod.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register as reg } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GAME = path.resolve(HERE, '../../../../public/abyssal-tether-3d');
const VENDOR = pathToFileURL(path.join(GAME, 'vendor/three/')).href;
reg(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR}three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR}addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const THREE = await import('three');
const { gearGeometry, cogLodFor, LevelView } = await import(pathToFileURL(path.join(GAME, 'src/render/levelView.js')).href);

let n = 0;
const ok = (c, msg) => {
  assert.ok(c, msg);
  n++;
  console.log('PASS ' + msg);
};
const tris = (g) => g.attributes.position.count / 3;

// 1. The three geometries.
{
  const near = gearGeometry(32, 5, 0);
  const mid = gearGeometry();
  const far = gearGeometry(10, 3, 2);
  ok(tris(mid) > 600 && tris(mid) < 1000, `mid: the original plate, ${tris(mid)} triangles (unchanged)`);
  ok(tris(near) > 2500 && tris(near) < 6000 && tris(near) > tris(mid) * 3, `near: ${tris(near)} triangles (bevelled, flange, boss, bolts)`);
  ok(tris(far) < 300 && tris(far) < tris(mid) / 2.5, `far: ${tris(far)} triangles, a silhouette`);
  ok(tris(far) < tris(mid) && tris(mid) < tris(near), 'the counts step down with distance');
  for (const [name, g] of [['near', near], ['mid', mid], ['far', far]]) {
    const a = Object.keys(g.attributes).sort().join(',');
    ok(a === 'color,normal,position,uv' && !g.index, `${name}: non-indexed position / normal / uv / colour (one instanced material fits every level)`);
    g.computeBoundingBox();
    const bb = g.boundingBox;
    const R = Math.max(bb.max.x, bb.max.y, -bb.min.x, -bb.min.y);
    ok(R > 0.98 && R < 1.03, `${name}: unit radius (${R.toFixed(3)}): the levels swap without a size pop`);
    ok(bb.min.z > -0.001 && bb.max.z > 0.035 && bb.max.z < 0.1, `${name}: back face at z = 0, ${bb.max.z.toFixed(3)} deep (axis +z)`);
  }
  // the near cog is a better cog: more outline points, a raised rim and hub parts in front of the plate
  const front = (g) => {
    let m = 0;
    for (let i = 0; i < g.attributes.position.count; i++) m = Math.max(m, g.attributes.position.getZ(i));
    return m;
  };
  ok(front(near) > front(mid) + 0.005, `near: the hub, boss and bolts stand out of the plate (${front(near).toFixed(3)} vs ${front(mid).toFixed(3)})`);
  // all normals unit length, all colours in range
  let bad = 0;
  for (const g of [near, mid, far]) {
    for (let i = 0; i < g.attributes.normal.count; i += 7) {
      const l = Math.hypot(g.attributes.normal.getX(i), g.attributes.normal.getY(i), g.attributes.normal.getZ(i));
      if (Math.abs(l - 1) > 1e-3) bad++;
      const c = g.attributes.color.getX(i);
      if (!(c > 0 && c <= 1)) bad++;
    }
  }
  ok(bad === 0, 'normals are unit length and the AO colours are in range on every level');
}

// 2. Which level.
{
  ok(cogLodFor(0, 8) === 0 && cogLodFor(20, 8) === 0, 'a cog within ~3.5 radii of its rim is the near one');
  ok(cogLodFor(40, 8) === 1 && cogLodFor(60, 8) === 1, 'out to ~9 radii it is the mid one');
  ok(cogLodFor(100, 8) === 2, 'further it is the far silhouette');
  let mono = true;
  let prev = 0;
  for (let d = -5; d < 200; d += 1) {
    const l = cogLodFor(d, 10);
    if (l < prev) mono = false;
    prev = l;
  }
  ok(mono, 'the level only goes up with distance (no flicker between levels)');
  ok(cogLodFor(0, 8, false) === 1 && cogLodFor(100, 8, false) === 2, 'the low tier never picks the near level');
  ok(cogLodFor(30, 20) === 0 && cogLodFor(30, 2) === 2, 'it is by radii: a big cog stays detailed further out than a small one');
}

// 3. The per-frame update.
{
  const mk = () => {
    const m = new THREE.InstancedMesh(gearGeometry(10, 3, 2), new THREE.MeshBasicMaterial(), 48);
    m.setColorAt(0, new THREE.Color());
    m.count = 0;
    m.visible = false;
    return m;
  };
  const meshes = [mk(), mk(), mk()];
  const item = (x, r) => ({ m: new THREE.Matrix4().makeTranslation(x, 0, 0), spin: 0.2, phase: 0, tint: [1, 1, 1], r, pos: new THREE.Vector3(x, 0, 0) });
  // three cogs: radius 8 at 20 m (rim 11: near), radius 8 at 60 m (rim 51: mid) and radius 4 at 70 m (rim 65: far), the head at the origin
  const fake = { _cogs: { mesh: meshes[1], meshes, items: [item(20, 8), item(60, 8), item(70, 4)] }, _detailScale: 1 };
  const head = new THREE.Vector3(0, 0, 0);
  LevelView.prototype._updateCogs.call(fake, head, 1, 300);
  const counts = meshes.map((m) => m.count).join(',');
  const vis = meshes.map((m) => m.visible).join(',');
  ok(counts === '1,1,1' && vis === 'true,true,true', `each cog goes to its level's mesh (counts ${counts}, visible ${vis})`);
  // the head moves close to the first only: the others fall out of range / the far one disappears at the draw distance
  LevelView.prototype._updateCogs.call(fake, head, 1, 40);
  ok(meshes[0].count === 1 && meshes[1].count === 0 && meshes[2].count === 0 && !meshes[1].visible && !meshes[2].visible, 'a distance limit drops the others; an empty level is hidden (no draw call for it)');
  // the low tier: the near cog is drawn as the mid one
  fake._detailScale = 0.5;
  LevelView.prototype._updateCogs.call(fake, head, 1, 300);
  ok(meshes[0].count === 0 && meshes[1].count >= 1, 'in the low tier the near cog is drawn at the mid level');
  // an old single-mesh cache object (no `meshes`) still works
  const one = { _cogs: { mesh: meshes[1], items: [item(20, 8)] }, _detailScale: 1 };
  LevelView.prototype._updateCogs.call(one, head, 1, 300);
  ok(meshes[1].count === 1 && meshes[1].visible, 'an object with only `mesh` (the mid level) still updates');
}

// 4. The wiring.
{
  const lv = fs.readFileSync(path.join(GAME, 'src/render/levelView.js'), 'utf8');
  ok(/gearGeometry\(32, 5, 0\)/.test(lv) && /gearGeometry\(10, 3, 2\)/.test(lv) && /make\(gearGeometry\(\), 'cogs'\)/.test(lv), '_makeCogMesh builds the three levels (the mid one keeps the name "cogs")');
  ok(/this\._cogs = \{ mesh: mid, meshes: \[near, mid, far\], items: \[\] \}/.test(lv), 'the level keeps `mesh` (mid) and adds `meshes`');
  ok(/const COG_DIST = 80;/.test(lv), 'the cogs are drawn out to 80 m (x the detail scale), as silhouettes beyond ~40 m: no pop at 46 m any more');
  const cache = fs.readFileSync(path.join(GAME, 'src/render/levelCache.js'), 'utf8');
  ok(/for \(const m of lv\._cogs\.meshes \|\| \[lv\._cogs\.mesh\]\) objs\.add\(m\)/.test(cache), 'the level cache knows all three cog meshes (an unknown object would void the snapshot)');
}

console.log(`\n${n} checks passed`);
