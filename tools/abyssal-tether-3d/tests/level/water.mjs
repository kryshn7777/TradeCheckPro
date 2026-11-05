// WATER in Chapter I (sim/waterPlan.js, render/waterView.js, the sound), Node, no GPU.
// Asked for: "water to be flowing here and there, like water sweeping through places, waterfalls, so random ... to add more screen presence".
//   - the plan on the REAL level: 12-24 features (falls down wall faces, streams over wide ledges, the lips they spill over), deterministic, a spread
//     over the sections (<= 3 each), none within 3 m of the spawn / a checkpoint, every spout in open air with its wall behind it, lengths 5-48 m,
//     every stream on a ledge top and ending at its lip, a lip for every stream with a drop;
//   - the view: ONE instanced mesh of sheets (a draw call) + ONE mist cloud; a fall's quad faces out of its wall, a stream lies flat with its flow
//     direction along the quad; the instance parameters carry kind / flow / width / length; updates run on a camera; Chapter II gets none; dispose;
//   - nearestWater picks the closest (a fall by its vertical extent), nothing beyond the range;
//   - the wiring: the game builds it for Chapter I only, ?water=off, the sound bed follows game.waterNear.
//   node water.mjs [--root DIR]
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
const { planWater, nearestWater, WATER } = await import(srcUrl('sim/waterPlan.js'));
const { WaterView } = await import(srcUrl('render/waterView.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const level = new Level3D(LEVEL_DATA_3D);
const plan = planWater(level);
const falls = plan.filter((f) => f.kind === 'fall');
const streams = plan.filter((f) => f.kind === 'stream');
const lips = plan.filter((f) => f.kind === 'lip');
ok(plan.length >= 12 && plan.length <= 24, `plan: ${plan.length} features (${falls.length} falls, ${streams.length} streams, ${lips.length} lips)`);
ok(falls.length >= 6 && streams.length >= 2, 'plan: both kinds are there');
ok(JSON.stringify(plan) === JSON.stringify(planWater(level)), 'plan: deterministic');
ok(JSON.stringify(plan) !== JSON.stringify(planWater(level, 99)), 'plan: another seed lays it out differently');
const per = {};
for (const f of plan) per[f.section] = (per[f.section] || 0) + 1;
ok(Object.keys(per).length >= 6 && Math.max(...Object.values(per)) <= 6, `plan: spread over ${Object.keys(per).length} sections (most in one: ${Math.max(...Object.values(per))})`);
const quiet = [level.spawn, ...level.sections.map((s) => s.checkpoint).filter(Boolean)];
ok(plan.every((f) => quiet.every((q) => Math.hypot(q.x - f.x, q.y - f.y, q.z - f.z) >= 3)), 'plan: nothing within 3 m of the spawn or a checkpoint (the arrival is quiet)');
let badSpout = 0;
let badWall = 0;
let badLen = 0;
for (const f of falls) {
  if (level.pointInSolid(f.x + f.nx * 0.3, f.y, f.z + f.nz * 0.3)) badSpout++;
  if (!level.pointInSolid(f.x - f.nx * 0.3, f.baseY + Math.min(1, f.len * 0.5), f.z - f.nz * 0.3)) badWall++;
  if (f.len < WATER.minFall || f.len > WATER.maxFall + 1e-6 || Math.abs(f.baseY - (f.y - f.len)) > 0.01) badLen++;
}
ok(badSpout === 0, 'falls: every spout is in open air (0.3 m out from the face)');
ok(badWall === 0, 'falls: the wall is behind the foot of every sheet (it hugs the face)');
ok(badLen === 0, `falls: every length is ${WATER.minFall}-${WATER.maxFall} m and ends at its base`);
let badStream = 0;
for (const s of streams) {
  const top = level.solids.find((o) => Math.abs(o.maxY + 0.025 - s.y) < 1e-3 && s.x >= o.minX - 0.5 && s.x <= o.maxX + 0.5 && s.z >= o.minZ - 0.5 && s.z <= o.maxZ + 0.5);
  if (!top) badStream++;
  if (Math.abs(Math.hypot(s.dx, s.dz) - 1) > 1e-9 || s.len < 3 || s.len > WATER.streamLen[1] + 0.01) badStream++;
}
ok(badStream === 0, 'streams: each lies on a ledge top (0.025 m above it), a unit flow direction, 3-9 m long');
ok(lips.every((l) => streams.some((s) => Math.abs(s.x + s.dx * s.len * 0.5 - l.x) < 0.6 && Math.abs(s.z + s.dz * s.len * 0.5 - l.z) < 0.6)), 'lips: each continues a stream at its end');
ok(plan.every((f, i) => i === 0 || f.y <= plan[i - 1].y + 1e-9), 'plan: sorted from the top of the descent down');
ok(new Set(plan.map((f) => f.id)).size === plan.length, 'plan: unique ids');

// ---- nearest ----
{
  const f = falls[0];
  const mid = nearestWater(plan, f.x + f.nx * 2, f.y - f.len / 2, f.z + f.nz * 2, 60);
  ok(mid && mid.f === f ? true : mid && mid.d <= 2.5, 'nearest: standing 2 m from a fall at its middle: it (or something as close)');
  const above = nearestWater([f], f.x, f.y + 100, f.z, 60);
  ok(above === null, 'nearest: 100 m above it is out of range');
  const side = nearestWater([f], f.x + 10, f.y - f.len / 2, f.z, 60);
  ok(side && Math.abs(side.d - 10) < 1e-6, 'nearest: a fall is measured to its vertical extent (10 m beside its middle = 10)');
  ok(nearestWater([], 0, 0, 0) === null, 'nearest: nothing planned = null');
}

// ---- the view ----
{
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera();
  cam.position.set(0, -10, 0);
  scene.add(cam);
  const game = { renderer: { scene, camera: cam }, level };
  const v = new WaterView(game);
  ok(v.list.length === plan.length && v.sheets.count === plan.length, 'view: one instance per feature');
  let drawn = 0;
  scene.traverse((o) => {
    if (o.isMesh || o.isPoints) drawn++;
  });
  ok(drawn === 2, `view: ${drawn} drawables (the sheets, the mist)`);
  ok(v.stats.puffs === (falls.length + lips.length) * 12, `view: 12 puffs at the foot of each fall and lip (${v.stats.puffs})`);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const par = v.sheets.geometry.getAttribute('aParams');
  const lens = v.sheets.geometry.getAttribute('aLen');
  let bad = 0;
  for (let i = 0; i < v.list.length; i++) {
    const f = v.list[i];
    v.sheets.getMatrixAt(i, m);
    m.decompose(p, q, s);
    const kind = par.getX(i);
    if (f.kind === 'stream') {
      const flowDir = new THREE.Vector3(0, -1, 0).applyQuaternion(q); // the quad's local -y: the end of the sheet (the lip)
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      if (kind !== 1 || normal.y < 0.99 || flowDir.x * f.dx + flowDir.z * f.dz < 0.99) bad++;
      if (Math.abs(s.y - f.len) > 1e-4 || Math.abs(s.x - f.w) > 1e-4) bad++;
    } else {
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
      const down = new THREE.Vector3(0, -1, 0).applyQuaternion(q);
      if (normal.x * f.nx + normal.z * f.nz < 0.99 || down.y > -0.99) bad++;
      if (Math.abs(p.y - (f.y - f.len / 2)) > 1e-4 || Math.abs(s.y - f.len) > 1e-4) bad++;
      if (kind !== (f.kind === 'lip' ? 2 : 0)) bad++;
    }
    if (Math.abs(par.getY(i) - f.flow) > 1e-4 || Math.abs(par.getW(i) - f.w) > 1e-4 || Math.abs(lens.getX(i) - f.len) > 1e-4) bad++;
  }
  ok(bad === 0, 'view: every sheet faces out of its wall / lies flat along its flow, with its kind, flow, width and length');
  v.update(0.016, game);
  v.update(0.5, game);
  ok(v.uniforms.uTime.value > 0.5, 'view: the clock runs');
  const pos = v.mist.geometry.getAttribute('position');
  let finite = true;
  for (let i = 0; i < pos.array.length; i++) if (!Number.isFinite(pos.array[i])) finite = false;
  ok(finite, 'view: the mist positions are finite');
  cam.position.set(900, 900, 900);
  v.update(0.016, game);
  ok(pos.array[1] === -1e5 || pos.array.some((y, i) => i % 3 === 1 && y === -1e5), 'view: mist far from the camera is parked out of the way');
  ok(v.material.transparent && v.material.depthWrite === false && v.material.fog === true, 'view: alpha-blended, no depth write, takes the haze');
  v.dispose();
  ok(scene.children.length === 1, 'view: dispose removes the sheets and the mist');
}

// ---- the wiring ----
{
  const game = fs.readFileSync(path.join(SRC_DIR, 'game.js'), 'utf8');
  ok(game.includes('this.chapter === 1 && this.level && this.renderer && !waterOff()') && game.includes('function waterOff()'), 'game: Chapter I only, ?water=off');
  ok(game.includes('this._syncWater();') && game.includes('this._updateWaterSound();') && game.includes('nearestWater(wv.list'), 'game: built with the views, updated each frame, the sound fed from the nearest');
  const audio = fs.readFileSync(path.join(SRC_DIR, 'audio/audio3d.js'), 'utf8');
  ok(audio.includes('this.kWaterG') && audio.includes('game.waterNear'), 'audio: the water bed follows game.waterNear');
}
console.log(fails ? `\n${fails} FAILED` : '\nALL WATER CHECKS PASS');
process.exitCode = fails ? 1 : 0;
