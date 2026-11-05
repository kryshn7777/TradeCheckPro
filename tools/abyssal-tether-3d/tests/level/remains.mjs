// REMAINS in Chapter I (sim/remainsPlan.js, render/remainsView.js): skeletons and old blood.
// Asked for: "this game is going to be definitely R-rated. I need bloodstains here and there. A lot of skeletons. I need them here and there."
//   - the plan on the REAL level: 30-45 skeletons of at least 7 kinds, 100-170 stains, more of both deeper (S8 >> S1), deterministic, nothing within 4 m of
//     the spawn / a checkpoint, nothing within 1.2 m of an anchor, every skeleton on a ledge top (a hanging one under a ledge with a clear drop, a slumped one
//     with its back 0.3-0.6 m from a wall face), every floor stain on a ledge top, every wall stain on a face with its normal out of it;
//   - the view (synthetic model + atlas): one instanced mesh per kind in use, unknown kinds fall back to a pose that exists, only the ones within the
//     tier's range are in the buffers (Quest 28 m, desktop 70 m), the blood in ONE instanced mesh with the cell uvs, floor decals flat and wall decals
//     upright, a hanging one hangs from its hook, nothing when the assets are missing, dispose;
//   - the wiring: Chapter I only, ?remains=off, the assets load once a run is under way.
//   node remains.mjs [--root DIR]
import fs from 'node:fs';
import path from 'node:path';
import { register } from 'node:module';
import { srcUrl, SRC_DIR, VENDOR_THREE_URL } from '../../verify/root.mjs';
register(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR_THREE_URL}three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR_THREE_URL}addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const THREE = await import('three');
const { planRemains, REMAINS, faceNormal } = await import(srcUrl('sim/remainsPlan.js'));
const { RemainsView, RANGE } = await import(srcUrl('render/remainsView.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const level = new Level3D(LEVEL_DATA_3D);
const plan = planRemains(level);
const { skeletons: sk, stains: st } = plan;
ok(sk.length >= 30 && sk.length <= 45, `plan: ${sk.length} skeletons ("a lot")`);
ok(st.length >= 100 && st.length <= 170, `plan: ${st.length} bloodstains ("here and there")`);
ok(new Set(sk.map((s) => s.kind)).size >= 7, `plan: ${new Set(sk.map((s) => s.kind)).size} kinds of remains: ${[...new Set(sk.map((s) => s.kind))].join(', ')}`);
ok(sk.every((s) => REMAINS.KINDS.includes(s.kind)), 'plan: every kind is one the model knows');
ok(JSON.stringify(plan) === JSON.stringify(planRemains(level)), 'plan: deterministic');
ok(JSON.stringify(plan) !== JSON.stringify(planRemains(level, 77)), 'plan: another seed lays it out differently');
const per = (arr) => level.sections.map((_, i) => arr.filter((s) => s.section === i).length);
const ps = per(sk);
ok(ps[7] >= ps[0] + 3 && ps.slice(4).reduce((a, b) => a + b, 0) > ps.slice(0, 4).reduce((a, b) => a + b, 0), `plan: more of them the deeper you go (${ps.join(' ')})`);
const pb = per(st);
ok(pb[7] > pb[0] && pb.every((n) => n > 0), `plan: blood in every section, more of it deeper (${pb.join(' ')})`);
const quiet = [level.spawn, ...level.sections.map((s) => s.checkpoint).filter(Boolean)];
const all = [...sk, ...st];
ok(all.every((f) => quiet.every((q) => Math.hypot(q.x - f.x, q.y - f.y, q.z - f.z) >= REMAINS.quiet - 1e-6)), `plan: nothing within ${REMAINS.quiet} m of the spawn or a checkpoint`);
ok(all.every((f) => level.anchors.every((a) => Math.hypot(a.x - f.x, a.y - f.y, a.z - f.z) >= REMAINS.anchorClear - 1e-6)), `plan: nothing within ${REMAINS.anchorClear} m of an anchor (no grapple target hidden under a heap)`);
const onTop = (x, y, z) => level.solids.some((s) => Math.abs(s.maxY - y) < 0.03 && x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ);
ok(sk.filter((s) => s.kind !== 'hanging').every((s) => onTop(s.x, s.y, s.z)), 'skeletons: every one lies on a ledge top');
const hang = sk.filter((s) => s.kind === 'hanging');
ok(hang.every((s) => s.hook != null && level.solids.some((o) => Math.abs(o.minY - s.hook) < 0.03 && s.x >= o.minX && s.x <= o.maxX && s.z >= o.minZ && s.z <= o.maxZ) && !level.raycast(s.x, s.hook - 0.05, s.z, 0, -1, 0, 3.8, {})), `skeletons: ${hang.length} hang from the underside of a ledge with a clear 3.8 m below`);
let slumpedBad = 0;
const slumped = sk.filter((s) => s.kind === 'slumped');
for (const s of slumped) {
  // its back is to a wall: behind it (the opposite of its facing) a wall face lies 0.3-0.6 m off
  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  const r = level.raycast(s.x, s.y + 0.9, s.z, -fx, 0, -fz, 1.2, {});
  if (!r || r.t < 0.25 || r.t > 0.6) slumpedBad++;
}
ok(slumpedBad === 0, `skeletons: the ${slumped.length} slumped ones sit with their backs 0.25-0.6 m from a wall`);
const floorSt = st.filter((s) => s.ny > 0.5);
const wallSt = st.filter((s) => s.ny === 0);
ok(floorSt.length > 60 && wallSt.length >= 20, `blood: ${floorSt.length} on the floors, ${wallSt.length} on the walls`);
ok(floorSt.every((s) => onTop(s.x, s.y - 0.013, s.z) || onTop(s.x, s.y - 0.014, s.z)), 'blood: every floor stain lies on a ledge top (1.3 cm up)');
let wallBad = 0;
for (const s of wallSt) {
  const near = level.solids.find((o) => {
    if (s.x < o.minX - 0.05 || s.x > o.maxX + 0.05 || s.y < o.minY - 0.05 || s.y > o.maxY + 0.05 || s.z < o.minZ - 0.05 || s.z > o.maxZ + 0.05) return false;
    const n = faceNormal(o, s.x, s.y, s.z);
    return n[0] === s.nx && n[2] === s.nz;
  });
  if (!near) wallBad++;
}
ok(wallBad === 0, 'blood: every wall stain lies on a solid face with its normal out of it');
ok(st.every((s) => s.size >= 0.4 && s.size <= 3 && s.variant >= 0 && s.variant < REMAINS.variants), 'blood: sizes 0.4-3 m, variants in range');

// ---- the view ----
const mkGltf = (names) => {
  const scene = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true });
  for (const n of names) {
    // (the real model: floor poses stand on y = 0; Bones_Hanging hangs BELOW its origin, the hook)
    const g = new THREE.BoxGeometry(0.6, n === 'Bones_Hanging' ? 3.3 : 0.4, 1.7);
    g.translate(0, n === 'Bones_Hanging' ? -1.65 : 0.2, 0);
    const c = new Float32Array(g.getAttribute('position').count * 3).fill(0.8);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    const m = new THREE.Mesh(g, mat);
    m.name = n;
    scene.add(m);
  }
  return { scene };
};
const cells = [];
const names = ['spray_arterial', 'spray_wide', 'splatter_impact', 'spatter_fine', 'pool_large', 'pool_small', 'puddle_core', 'drag_long', 'drag_short', 'handprint_l', 'handprint_r', 'streak_a', 'streak_b', 'drips_a', 'drips_b', 'drag_curve'];
names.forEach((n, i) => {
  const c = i % 4;
  const r = Math.floor(i / 4);
  cells.push({ index: i, name: n, rect: [c * 256, r * 256, 256, 256], uv: [c * 0.25, 0.75 - r * 0.25, (c + 1) * 0.25, 1 - r * 0.25], world_size_m: [1.2, 1.2] });
});
const atlasTex = () => new THREE.DataTexture(new Uint8Array(16).fill(255), 2, 2, THREE.RGBAFormat);
{
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera();
  scene.add(cam);
  const game = { renderer: { scene, camera: cam, qualityTier: 'quest' }, level };
  const v = new RemainsView(game);
  ok(v.stats.skeletons === sk.length && v.stats.stains === st.length, 'view: the plan is made at once');
  v.update(0.016, game);
  let drawn = 0;
  scene.traverse((o) => {
    if (o.isMesh) drawn++;
  });
  ok(drawn === 0, 'view: nothing is drawn until the assets arrive');
  v.buildFromGLTF(mkGltf(['Bones_LyingA', 'Bones_LyingB', 'Bones_SittingWall', 'Bones_Hanging', 'Bones_Ribcage']));
  const kinds = new Set(sk.map((s) => s.kind));
  ok(v.byKind.size >= 3 && v.byKind.size <= kinds.size + 2, `view: one instanced mesh per model mesh in use (${v.byKind.size} for ${kinds.size} kinds); kinds with no pose in the model fall back to one that exists`);
  const tot = [...v.byKind.values()].reduce((a, k) => a + k.items.length, 0);
  ok(tot === sk.length, 'view: every planned skeleton is in exactly one instanced mesh');
  v.setAtlas(atlasTex(), { cells });
  ok(v.stainMesh && v.stainMesh.count === 0, 'view: the blood is ONE instanced mesh');
  // stand next to the first skeleton
  const a = sk.find((s) => s.kind !== 'hanging');
  cam.position.set(a.x + 3, a.y + 1.6, a.z);
  v.update(0.016, game);
  const near = sk.filter((s) => Math.hypot(s.x - cam.position.x, s.y - cam.position.y, s.z - cam.position.z) <= RANGE.quest).length;
  ok(v.stats.shown === near && near >= 1, `view: Quest range ${RANGE.quest} m: ${v.stats.shown} of ${sk.length} skeletons in the buffers`);
  const nearSt = st.filter((s) => Math.hypot(s.x - cam.position.x, s.y - cam.position.y, s.z - cam.position.z) <= 45).length;
  ok(v.stats.stainsShown === nearSt && nearSt >= 1, `view: ${v.stats.stainsShown} of ${st.length} stains within 45 m`);
  game.renderer.qualityTier = 'high';
  v._last.set(1e9, 1e9, 1e9);
  v.update(0.016, game);
  const nearHigh = sk.filter((s) => Math.hypot(s.x - cam.position.x, s.y - cam.position.y, s.z - cam.position.z) <= RANGE.high).length;
  ok(v.stats.shown === nearHigh && nearHigh >= near, `view: desktop range ${RANGE.high} m: ${v.stats.shown} skeletons`);
  cam.position.set(900, 900, 900);
  v._last.set(1e9, 1e9, 1e9);
  v.update(0.016, game);
  ok(v.stats.shown === 0 && v.stats.stainsShown === 0, 'view: far from everything: nothing in the buffers');
  // the matrices: a hanging one hangs from its hook; the blood stands off the surface the right way
  const h = v.plan.skeletons.find((s) => s.kind === 'hanging');
  if (h) {
    const k = v.byKind.get('Bones_Hanging');
    const idx = k.items.indexOf(h);
    const mm = new THREE.Matrix4().fromArray(k.mats, idx * 16);
    const p = new THREE.Vector3().setFromMatrixPosition(mm);
    ok(Math.abs(p.y - h.hook) < 1e-4, 'view: a hanging skeleton\'s origin (the hook) is put at the underside of its ledge');
  }
  const wi = st.findIndex((s) => s.ny === 0);
  const wm = new THREE.Matrix4().fromArray(v._stainMats, wi * 16);
  const q = new THREE.Quaternion();
  wm.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
  const upv = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  ok(n.x * st[wi].nx + n.z * st[wi].nz > 0.99 && upv.y > 0.97, 'view: a wall decal faces out of its wall and keeps its top up (the runs go DOWN)');
  const fi = st.findIndex((s) => s.ny > 0.5);
  const fm = new THREE.Matrix4().fromArray(v._stainMats, fi * 16);
  fm.decompose(new THREE.Vector3(), q, new THREE.Vector3());
  ok(new THREE.Vector3(0, 0, 1).applyQuaternion(q).y > 0.99, 'view: a floor decal lies flat');
  // the atlas cells chosen: floors take the pools and drags, walls the sprays / splatters / handprints / runs
  const fc = v._stainCell[fi].name;
  const wc = v._stainCell[wi].name;
  ok(/pool|puddle|drag/.test(fc) && !/pool|puddle|drag/.test(wc), `view: a floor stain uses '${fc}', a wall stain '${wc}'`);
  v.dispose();
  ok(scene.children.filter((c) => c !== cam).length === 0, 'view: dispose removes everything');
}
{
  // missing atlas / model: whichever is there still shows; a model with no meshes throws and the blood is unaffected
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera();
  scene.add(cam);
  const game = { renderer: { scene, camera: cam, qualityTier: 'quest' }, level };
  const v = new RemainsView(game);
  let threw = false;
  try {
    v.buildFromGLTF({ scene: new THREE.Group() });
  } catch {
    threw = true;
  }
  ok(threw && v.byKind.size === 0, 'view: a model with no meshes is refused (the blood can still load)');
  v.setAtlas(atlasTex(), { cells });
  cam.position.set(sk[0].x, sk[0].y + 1.5, sk[0].z);
  v.update(0.016, game);
  ok(v.stats.shown === 0 && v.stats.stainsShown > 0, 'view: the blood alone still shows');
  v.dispose();
}

// ---- wiring ----
{
  const game = fs.readFileSync(path.join(SRC_DIR, 'game.js'), 'utf8');
  ok(game.includes('this.chapter === 1 && this.level && this.renderer && !remainsOff()') && game.includes('function remainsOff()'), 'game: Chapter I only, ?remains=off');
  ok(game.includes('rv.load(() => this._holdfastLoader())') && game.includes("this.state === 'playing'"), 'game: the assets load in the background once a run is under way');
  ok(game.includes('this._precompile()') && game.includes('_rvCompiled'), 'game: the programs are compiled when the assets arrive');
}
console.log(fails ? `\n${fails} FAILED` : '\nALL REMAINS CHECKS PASS');
process.exitCode = fails ? 1 : 0;
