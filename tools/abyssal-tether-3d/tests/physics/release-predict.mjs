// The release guide, "if I let go now" (sim/releasePredict.js, render/releaseGuide.js) and the desktop speed FOV kick (render/speedFov.js).
//   - a free ballistic path matches Physics3D.step of the same body (with the real TetherSystem.release boost) within 0.3 m at 1 s;
//   - a wall in the path stops the arc at the wall, with the wall's normal; a floor ahead gives an upward normal;
//   - the lethal flag follows diff.lethalImpact (a long drop is red, a short hop is not; Sandbox never kills);
//   - the other hand on a line: not predicted; the result object is reused (no allocation in a loop);
//   - speedFov: monotonic in speed, bounded by 7 degrees, zero in XR / with Reduced effects / off, eases in ~0.3 s and out ~0.5 s;
//   - settings defaults.
//   node release-predict.mjs [--root DIR]
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { register as reg } from 'node:module';
import { srcUrl, GAME_ROOT } from '../../verify/root.mjs';
const { CONFIG, DIFFICULTY, EventBus, SETTINGS_DEFAULTS } = await import(srcUrl('sim/config3d.js'));
const { Player3D, TetherSystem, Physics3D } = await import(srcUrl('sim/physics3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { predictRelease, createReleaseOut, RELEASE_PREDICT, RELEASE_MAX_POINTS } = await import(srcUrl('sim/releasePredict.js'));
const SF = await import(srcUrl('render/speedFov.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const diff = DIFFICULTY.normal;
const dt = CONFIG.PHYSICS_DT;

/** A real level, the body put far out of the shaft (nothing to hit) unless boxes are added. */
const setup = () => {
  const level = new Level3D(undefined, 'normal');
  const bus = new EventBus();
  const tethers = new TetherSystem(level, diff, bus, {});
  const physics = new Physics3D(level, diff, bus);
  const sp = level.spawn;
  const p = new Player3D(sp.x + 400, sp.y, sp.z + 400);
  return { level, tethers, physics, p };
};
/** Point of the predicted path at time t (linear between the points). */
const at = (out, t) => {
  const f = t / RELEASE_PREDICT.dt;
  const i = Math.min(out.n - 2, Math.floor(f));
  const u = f - i;
  const P = out.points;
  return [0, 1, 2].map((k) => P[i * 3 + k] + (P[(i + 1) * 3 + k] - P[i * 3 + k]) * u);
};

// 1. free flight, below the boost speed: the prediction against 240 Hz Physics3D.step
{
  const { level, tethers, physics, p } = setup();
  p.vx = 5;
  p.vy = 4;
  p.vz = -3;
  const out = createReleaseOut();
  predictRelease(p, false, level, diff, out);
  ok(out.n === RELEASE_MAX_POINTS && !out.hit && !out.boosted, `open air: the full ${RELEASE_PREDICT.horizon} s path (${out.n} points), no hit, no boost below ${CONFIG.rope.releaseBoostMinSpeed} m/s`);
  for (let i = 0; i < 240; i++) physics.step(p, tethers, {}, dt);
  const q = at(out, 1);
  const e = Math.hypot(q[0] - p.x, q[1] - p.y, q[2] - p.z);
  ok(e < 0.3, `free flight: predicted vs Physics3D.step at 1 s differ by ${e.toFixed(3)} m (< 0.3)`);
}

// 2. a real swing on a line, released through TetherSystem.release (the x1.04 boost above 8 m/s)
{
  const { level, tethers, physics, p } = setup();
  const anchor = { x: p.x + 6, y: p.y + 8, z: p.z, kind: 'surface' };
  tethers.attach(p, 'right', anchor);
  p.vx = 0;
  p.vy = -2;
  p.vz = 9;
  for (let i = 0; i < 120; i++) physics.step(p, tethers, {}, dt);
  const sp = p.speed;
  const out = createReleaseOut();
  predictRelease(p, false, level, diff, out);
  tethers.release(p, 'right', 'input');
  ok(sp > 8 && out.boosted, `swinging at ${sp.toFixed(1)} m/s the prediction includes the release boost`);
  const v0 = Math.hypot(p.vx, p.vy, p.vz);
  ok(Math.abs(v0 / sp - CONFIG.rope.releaseBoost) < 1e-9, `TetherSystem.release applied x${CONFIG.rope.releaseBoost}`);
  for (let i = 0; i < 240; i++) physics.step(p, tethers, {}, dt);
  const q = at(out, 1);
  const e = Math.hypot(q[0] - p.x, q[1] - p.y, q[2] - p.z);
  ok(e < 0.3, `after a real release: predicted vs simulated at 1 s differ by ${e.toFixed(3)} m (< 0.3)`);
}

// 3. a wall in the path stops the arc at the wall
{
  const { level, p } = setup();
  const wx = p.x + 6;
  level.addDecorColliders([[wx, p.y - 30, p.z - 10, wx + 1, p.y + 10, p.z + 10]]);
  p.vx = 12;
  p.vy = 2;
  p.vz = 0;
  const out = createReleaseOut();
  predictRelease(p, false, level, diff, out);
  const last = out.points[(out.n - 1) * 3];
  let maxX = -Infinity;
  for (let i = 0; i < out.n; i++) maxX = Math.max(maxX, out.points[i * 3]);
  ok(!!out.hit && Math.abs(out.hit.x - wx) < 0.05 && out.hit.nx === -1 && out.hit.ny === 0, `the arc meets the wall at x ${out.hit && out.hit.x.toFixed(2)} (wall face ${wx.toFixed(2)}), normal (-1, 0, 0)`);
  ok(maxX <= wx - CONFIG.player.radius + 0.05 && Math.abs(last - (wx - CONFIG.player.radius)) < 0.1, `no point past the wall: the path ends one body radius before it (${(wx - last).toFixed(2)} m)`);
  ok(out.n < 12 && out.hit.t > 0.3 && out.hit.t < 0.6, `the path is cut short (${out.n} points, impact in ${out.hit.t.toFixed(2)} s)`);
  ok(out.impactSpeed > 10 && out.impactSpeed < 14, `the wall impact is the normal speed (${out.impactSpeed.toFixed(1)} m/s)`);
}

// 4. lethal flag: a long fall onto a floor is red, a short hop is not, Sandbox never kills
{
  const { level, p } = setup();
  const floor = p.y - 40;
  level.addDecorColliders([[p.x - 30, floor - 1, p.z - 30, p.x + 30, floor, p.z + 30]]);
  p.vx = 6;
  p.vy = -6;
  p.vz = 0;
  const out = createReleaseOut();
  predictRelease(p, false, level, diff, out);
  ok(!!out.hit && out.hit.ny === 1 && Math.abs(out.hit.y - floor) < 0.05, `a floor below: hit on its top face (y ${out.hit && out.hit.y.toFixed(2)})`);
  ok(out.lethal && out.impactSpeed >= diff.lethalImpact, `40 m down: impact ${out.impactSpeed.toFixed(1)} m/s >= ${diff.lethalImpact}: lethal`);
  predictRelease(p, false, level, DIFFICULTY.sandbox || Object.assign({}, diff, { impactsLethal: false }), out);
  ok(!out.lethal, 'the same fall with impacts not lethal (Sandbox): not lethal');
  const { level: l2, p: p2 } = setup();
  l2.addDecorColliders([[p2.x - 30, p2.y - 3, p2.z - 30, p2.x + 30, p2.y - 2, p2.z + 30]]);
  p2.vx = 5;
  p2.vy = 1;
  predictRelease(p2, false, l2, diff, out);
  ok(!!out.hit && !out.lethal && out.impactSpeed < diff.lethalImpact * 0.6, `a 2 m drop: impact ${out.impactSpeed.toFixed(1)} m/s, not lethal`);
}

// 5. the other hand keeps a line: not predicted; no allocation in a loop
{
  const { level, p } = setup();
  p.vx = 10;
  const out = createReleaseOut();
  predictRelease(p, true, level, diff, out);
  ok(out.n === 0 && out.reason === 'other' && !out.hit, 'the other hand on a line: nothing predicted (reason "other")');
  const pts = out.points;
  const hitObj = out._hit;
  // a stub level with a wall at x = p.x + 5.5 whose raycast allocates nothing (Level3D.raycast's own cost is the level's, not the guide's)
  const wall = { minX: p.x + 5.5, minY: -1e4, minZ: -1e4, maxX: p.x + 6.5, maxY: 1e4, maxZ: 1e4, active: true };
  const stub = {
    raycast(ox, oy, oz, dx, dy, dz, maxDist, r) {
      const dl = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (!(dx > 0) || dl < 1e-9) return null;
      const t = ((wall.minX - ox) / dx) * dl;
      if (t < 0 || t > maxDist) return null;
      r.t = t;
      r.solid = wall;
      r.x = wall.minX;
      r.y = oy + (dy / dl) * t;
      r.z = oz + (dz / dl) * t;
      return r;
    },
  };
  // a fresh instance of the module for the measure: the shared one has met the real Level3D, a stub and two difficulty shapes above,
  // and a call site that polymorphic can sit in a baseline tier that boxes doubles (an engine artefact the game, one level and one
  // difficulty per run, never sees)
  const fresh = (await import(srcUrl('sim/releasePredict.js') + '?alloc')).predictRelease;
  // the steady state: the best of a few rounds (the first rounds include the JIT's own allocations, and without --expose-gc a
  // collection can land inside a round)
  let grown = Infinity;
  for (let round = 0; round < 4; round++) {
    if (globalThis.gc) globalThis.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < 20000; i++) {
      p.vy = (i % 7) - 3;
      fresh(p, false, stub, diff, out);
    }
    const g = process.memoryUsage().heapUsed - before;
    if (g >= 0 && g < grown) grown = g;
  }
  ok(!!out.hit && out.points === pts && out.hit === hitObj, 'the same points array and hit object are reused across calls');
  ok(grown < 256 << 10, `20000 predictions grow the heap by ${(grown / 1024).toFixed(0)} KB (< 256 KB: no per-call allocation in predictRelease)`);
}

// 6. speedFov
{
  let prev = -1;
  let mono = true;
  let max = 0;
  for (let v = 0; v <= 60; v += 0.5) {
    const k = SF.speedFovTarget(v, true, false, false, true);
    if (k < prev - 1e-12) mono = false;
    prev = k;
    max = Math.max(max, k);
  }
  ok(mono, 'speedFov: monotonic in speed');
  ok(max <= SF.SPEED_FOV.maxDeg + 1e-9 && max === 7 && SF.speedFovTarget(25, true, false, false) === 7, `bounded: at most ${SF.SPEED_FOV.maxDeg} degrees, full at 25 m/s`);
  ok(SF.speedFovTarget(8, true, false, false) === 0, 'no kick at a walking / slow swing speed');
  ok(SF.speedFovTarget(30, true, true, false) === 0, 'zero in XR');
  ok(SF.speedFovTarget(30, true, false, true) === 0, 'zero with Reduced effects');
  ok(SF.speedFovTarget(30, true, false, false, false) === 0, 'zero with the setting off');
  ok(SF.speedFovTarget(30, false, false, false) === 0, 'zero when not on a rope / in a fall');
  let k = 0;
  for (let i = 0; i < Math.round(0.3 * 72); i++) k = SF.stepSpeedFov(k, 7, 1 / 72);
  ok(k > 7 * 0.93 && k <= 7, `eases in over ~0.3 s (${k.toFixed(2)} of 7 after 0.3 s)`);
  for (let i = 0; i < Math.round(0.5 * 72); i++) k = SF.stepSpeedFov(k, 0, 1 / 72);
  ok(k < 7 * 0.07 && k >= 0, `eases out over ~0.5 s (${k.toFixed(2)} left after 0.5 s)`);
  let kk = 7;
  for (let i = 0; i < 300; i++) kk = SF.stepSpeedFov(kk, 0, 1 / 72);
  ok(kk === 0, 'settles to exactly 0');
}

// 7. the view (render/releaseGuide.js): one instanced mesh, dots + ring, the colours, the hide conditions
{
  const VENDOR = pathToFileURL(path.join(GAME_ROOT, 'vendor/three/')).href;
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
  const { ReleaseGuide, RELEASE_GUIDE } = await import(srcUrl('render/releaseGuide.js'));
  const { level, tethers, p } = setup();
  const floor = p.y - 28;
  level.addDecorColliders([[p.x - 40, floor - 1, p.z - 40, p.x + 40, floor, p.z + 40]]);
  tethers.attach(p, 'right', { x: p.x, y: p.y + 10, z: p.z, kind: 'surface' });
  p.vx = 9;
  p.vy = 1;
  p.rx = p.x;
  p.ry = p.y;
  p.rz = p.z;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0, 5, 60);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
  camera.position.set(p.x, p.y + 0.5, p.z);
  scene.add(camera);
  const settings = { releaseGuide: true };
  const objectives = { squallNow: { k: 0, rise: 0 } };
  const game = { player: p, tethers, level, diff, settings, objectives, state: 'playing', renderer: { scene, camera, qualityTier: 'quest' }, governor: null };
  const g = new ReleaseGuide(scene);
  const meshes = scene.children.filter((c) => c.isInstancedMesh);
  ok(meshes.length === 1 && meshes[0] === g.mesh && g.mesh.instanceMatrix.count === RELEASE_GUIDE.dots + 1, `one instanced mesh of ${RELEASE_GUIDE.dots} dots + 1 ring (one draw call)`);
  for (let i = 0; i < 20; i++) g.update(1 / 72, game);
  ok(g.mesh.visible && g.stats.ring && g.stats.dots >= 12 && g.mesh.count === RELEASE_GUIDE.dots + 1, `on a line at 9 m/s: shown, ${g.stats.dots} dots and the ring`);
  ok(g.stats.lethal && g.mesh.instanceColor.getX(RELEASE_GUIDE.dots) > 0.9 && g.mesh.instanceColor.getY(RELEASE_GUIDE.dots) < 0.2, 'a 28 m drop ahead: the ring is red');
  const picks = g.stats.picks;
  for (let i = 0; i < 7; i++) g.update(1 / 72, game);
  ok(g.stats.picks - picks <= 1, `re-predicted every ${RELEASE_GUIDE.repick} s, not every frame (${g.stats.picks - picks} in 7 frames)`);
  const hide = (what, fn, undo) => {
    fn();
    for (let i = 0; i < 60; i++) g.update(1 / 72, game);
    ok(!g.mesh.visible, `hidden: ${what}`);
    undo();
    for (let i = 0; i < 60; i++) g.update(1 / 72, game);
  };
  hide('the setting off', () => (settings.releaseGuide = false), () => (settings.releaseGuide = true));
  hide('a squall gathering', () => (objectives.squallNow.rise = 0.5), () => (objectives.squallNow.rise = 0));
  hide('slower than 4 m/s', () => ((p.vx = 2), (p.vy = 0)), () => ((p.vx = 9), (p.vy = 1)));
  hide('the other hand on a line too (not predicted)', () => tethers.attach(p, 'left', { x: p.x + 2, y: p.y + 10, z: p.z, kind: 'surface' }), () => tethers.hands.left.rope.detach());
  hide('the low tier with the governor at level 2', () => ((game.renderer.qualityTier = 'low'), (game.governor = { level: 2 })), () => ((game.renderer.qualityTier = 'quest'), (game.governor = null)));
  hide('not on a line', () => tethers.hands.right.rope.detach(), () => tethers.attach(p, 'right', { x: p.x, y: p.y + 10, z: p.z, kind: 'surface' }));
  ok(g.mesh.visible, 'shown again once the conditions are back');
  // a short hop is amber
  p.y = floor + 3;
  p.ry = p.y;
  camera.position.set(p.x, p.y + 0.5, p.z);
  p.vy = 0;
  p.vx = 6;
  for (let i = 0; i < 20; i++) g.update(1 / 72, game);
  const c = g.mesh.instanceColor;
  ok(g.stats.ring && !g.stats.lethal && c.getY(RELEASE_GUIDE.dots) > 0.5, 'a 3 m drop ahead: the ring is amber');
  g.dispose();
  ok(!scene.children.includes(g.mesh), 'dispose removes it from the scene');
}

ok(SETTINGS_DEFAULTS.releaseGuide === true && SETTINGS_DEFAULTS.speedFov === true, 'settings defaults: releaseGuide and speedFov on');
console.log(fails ? `\n${fails} FAILED` : '\nALL RELEASE GUIDE CHECKS PASS');
process.exit(fails ? 1 : 0);
