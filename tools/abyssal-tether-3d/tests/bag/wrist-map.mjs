// The WRIST COMPUTER's MAP (sim/wristMap.js, render/wristComputer.js, game.js wiring), Node, no GPU.
// Asked for: "a 3D render scene of the full map, and a dot where the user is currently at, and the place where it started and the place where he's
// going to go. Like a 3D hologram in his watch, like he can access it whenever he can." Checks:
//   - wristRaised: the right hand 18-52 cm from the head, below the eye line, inside ~40 deg of the gaze; a hand at the face, a hand out to the side
//     (aiming), a hand overhead, a hand at the hip are not "looking at the watch";
//   - WristMap: opens after 0.35 s of the wrist raised (a hand passing the face does not), folds 0.25 s after it leaves, blooms smoothly, the M latch
//     opens it anywhere and keeps it open, a drawn right gun suppresses the gesture, nothing opens when not live (menu / dead) and a menu closes it;
//   - mapGeometry on the REAL level: 12 edges per solid, every vertex inside the 0.34 m display box centred on the origin, the START above the GOAL
//     (the descent goes down), the section boundary ticks, the player's dot where the player is;
//   - WristComputer: builds without a canvas, hidden when closed, the hologram shows when the bloom is up, 'you' follows the player, the trail grows only every
//     4 m and is cleared by reset(), at most 5 drawables, dispose empties the scene;
//   - the wiring: M plumbed through the input, the update before the physics, the view built once the level exists.
//   node wrist-map.mjs [--root DIR]
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
const { WristMap, wristRaised, MAP } = await import(srcUrl('sim/wristMap.js'));
const { mapGeometry, WristComputer, HOLO } = await import(srcUrl('render/wristComputer.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const head = { x: 0, y: 1.6, z: 0, fx: 0, fy: 0, fz: -1 };
const norm = (v) => {
  const l = Math.hypot(v.fx, v.fy, v.fz);
  return Object.assign(v, { fx: v.fx / l, fy: v.fy / l, fz: v.fz / l });
};
const look = norm({ x: 0, y: 1.6, z: 0, fx: 0, fy: -0.25, fz: -1 }); // glancing down a little
// ---- the gesture ----
ok(wristRaised(look, { x: 0.1, y: 1.38, z: -0.34 }), 'raised: the wrist ~35 cm out, a little below the eyes, in front of the gaze');
ok(!wristRaised(look, { x: 0.05, y: 1.58, z: -0.08 }), 'not raised: a hand at the face (< 18 cm)');
ok(!wristRaised(look, { x: 0.7, y: 1.3, z: -0.1 }), 'not raised: a hand out to the side, 70 cm (aiming a gun, pointing)');
ok(!wristRaised(look, { x: 0.1, y: 1.95, z: -0.3 }), 'not raised: a hand above the eye line');
ok(!wristRaised(look, { x: 0.2, y: 1.0, z: 0.1 }), 'not raised: a hand at the hip / behind');
ok(!wristRaised(look, { x: -0.45, y: 1.4, z: -0.08 }), 'not raised: a hand beside the head, outside the gaze cone');
ok(!wristRaised(null, { x: 0, y: 0, z: 0 }) && !wristRaised(look, null), 'not raised: missing data');
// ---- the switch ----
const up = { x: 0.1, y: 1.38, z: -0.34 };
const away = { x: 0.2, y: 1.0, z: 0.1 };
const step = (m, secs, c, dt = 1 / 72) => {
  for (let t = 0; t < secs - 1e-9; t += dt) m.update(dt, c);
};
{
  const m = new WristMap();
  const c = { live: true, xr: true, head: look, hand: up, handOk: true, gunOut: false };
  step(m, 0.2, c);
  ok(!m.on && m.k < 0.05, 'switch: 0.2 s of the wrist raised is a hand passing: nothing');
  step(m, 0.3, c);
  ok(m.on && m.k > 0.3, 'switch: after 0.35 s raised it opens and blooms');
  step(m, 1, c);
  ok(m.k > 0.98, 'switch: fully bloomed');
  c.hand = away;
  step(m, 0.15, c);
  ok(m.on, 'switch: a flick away for 0.15 s does not close it');
  step(m, 0.3, c);
  ok(!m.on, 'switch: 0.25 s away folds it');
  step(m, 1.5, c);
  ok(m.k < 0.01, 'switch: and the bloom is gone');
  // a wrist that comes up and goes away again before the dwell
  c.hand = up;
  step(m, 0.3, c);
  c.hand = away;
  step(m, 0.2, c);
  c.hand = up;
  step(m, 0.3, c);
  ok(!m.on, 'switch: the dwell restarts when the wrist leaves (0.3 + 0.3 s with a gap is not 0.35 s)');
}
{
  const m = new WristMap();
  const c = { live: true, xr: true, head: look, hand: up, handOk: true, gunOut: true };
  step(m, 1, c);
  ok(!m.on, 'gun: with the right gun drawn the raised wrist does nothing (it is an aim)');
  c.gunOut = false;
  c.handOk = false;
  step(m, 1, c);
  ok(!m.on, 'tracking: a hand that is not tracked does nothing');
  c.handOk = true;
  c.xr = false;
  step(m, 1, c);
  ok(!m.on, 'desktop: no gesture (the hands are not tracked); M only');
}
{
  const m = new WristMap();
  const c = { live: true, xr: false, head: null, hand: null, handOk: false, gunOut: false };
  m.toggle();
  step(m, 0.8, c);
  ok(m.on && m.k > 0.95, 'M: the latch opens it anywhere');
  step(m, 3, c);
  ok(m.on, 'M: ... and keeps it open');
  m.toggle();
  step(m, 1, c);
  ok(!m.on && m.k < 0.01, 'M: again closes it');
  m.toggle();
  step(m, 0.5, c);
  c.live = false;
  step(m, 0.1, c);
  ok(!m.on && !m.pinned, 'a menu / death / pause closes it and drops the latch');
  m.update(0, { live: true, xr: true, head: look, hand: up });
  m.update(NaN, c);
  ok(Number.isFinite(m.k), 'dt of 0 / NaN is safe');
}

// ---- the geometry on the real level ----
const level = new Level3D(LEVEL_DATA_3D);
const geo = mapGeometry(level);
{
  ok(geo.count === level.solids.length * 12, `geometry: 12 edges per solid (${geo.count} for ${level.solids.length} solids)`);
  ok(Math.abs(geo.size.y - HOLO.height) < 1e-9, `geometry: the tower is ${HOLO.height} m tall on the display (${geo.size.y.toFixed(3)})`);
  let bad = 0;
  const hx = geo.size.x / 2 + 1e-6;
  const hy = geo.size.y / 2 + 1e-6;
  const hz = geo.size.z / 2 + 1e-6;
  for (let i = 0; i < geo.seg.length; i += 3) if (Math.abs(geo.seg[i]) > hx || Math.abs(geo.seg[i + 1]) > hy || Math.abs(geo.seg[i + 2]) > hz) bad++;
  ok(bad === 0, 'geometry: every edge lies inside the box about the origin (centred)');
  ok(geo.start.y > geo.goal.y + geo.size.y * 0.8, `geometry: the START (${geo.start.y.toFixed(3)}) is at the top, the GOAL (${geo.goal.y.toFixed(3)}) at the bottom`);
  ok(geo.ticks.length === level.sections.length && geo.ticks.every((t, i) => i === 0 || t < geo.ticks[i - 1]), 'geometry: one boundary tick per section, going down');
  const you = geo.toDisplay(level.spawn.x, level.spawn.y, level.spawn.z, { x: 0, y: 0, z: 0 });
  ok(Math.abs(you.x - geo.start.x) < 1e-9 && Math.abs(you.y - geo.start.y) < 1e-9, 'geometry: you at the spawn = the START marker');
  const kinds = new Set(geo.kind);
  ok(kinds.size >= 3, `geometry: ${kinds.size} kinds of edge (wall, stone, bridge / crumble ...) for the colours`);
  const g2 = mapGeometry(level);
  ok(Buffer.compare(Buffer.from(geo.seg.buffer, geo.seg.byteOffset, geo.seg.byteLength), Buffer.from(g2.seg.buffer, g2.seg.byteOffset, g2.seg.byteLength)) === 0, 'geometry: deterministic');
}

// ---- the view ----
{
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera();
  scene.add(cam);
  const player = { x: 0, y: 0, z: 0, rx: -4, ry: 0.4, rz: 8.5, alive: true };
  const wm = new WristMap();
  const game = { renderer: { scene, camera: cam }, level, player, jet: { fuel: 0.5, burning: false }, wristMap: wm, xrActive: false, state: 'playing', sectionIndex: 0, handsView: null };
  const v = new WristComputer(game);
  v.update(0.016, game);
  ok(v.root.visible === false && v.stats.open === false, 'view: closed = hidden (the face costs one call, the hologram none)');
  ok(v.stats.segments === level.solids.length * 12, 'view: the level was baked on the first update');
  wm.toggle();
  for (let i = 0; i < 90; i++) {
    wm.update(1 / 72, { live: true, xr: false });
    v.update(1 / 72, game);
  }
  ok(v.root.visible && v.stats.open && v.root.parent === cam, 'view: open on the desktop: the hologram rides the camera');
  const m = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  v.markers.getMatrixAt(2, m);
  pos.setFromMatrixPosition(m);
  const want = geo.toDisplay(player.rx, player.ry, player.rz, { x: 0, y: 0, z: 0 });
  ok(Math.hypot(pos.x - want.x, pos.y - want.y, pos.z - want.z) < 1e-6, "view: the 'you' marker is where the player is");
  v.markers.getMatrixAt(0, m);
  pos.setFromMatrixPosition(m);
  ok(Math.hypot(pos.x - geo.start.x, pos.y - geo.start.y, pos.z - geo.start.z) < 1e-6, 'view: the START marker is at the spawn');
  v.markers.getMatrixAt(1, m);
  pos.setFromMatrixPosition(m);
  ok(Math.hypot(pos.x - geo.goal.x, pos.y - geo.goal.y, pos.z - geo.goal.z) < 1e-6, 'view: the GOAL marker is at the gate');
  // move the player down the shaft: the dot moves, the trail grows only every 4 m
  const n0 = v._trailN;
  player.ry -= 2;
  v.update(0.016, game);
  ok(v._trailN === n0, 'view: 2 m of travel adds no trail point');
  player.ry -= 3;
  v.update(0.016, game);
  ok(v._trailN === n0 + 1, 'view: 5 m adds one');
  for (let i = 0; i < 20; i++) {
    player.ry -= 5;
    v.update(0.016, game);
  }
  ok(v._trailN === n0 + 21, `view: the trail follows the descent (${v._trailN} points)`);
  v.markers.getMatrixAt(2, m);
  pos.setFromMatrixPosition(m);
  ok(pos.y < want.y - 0.05, 'view: the dot went down the tower');
  v.reset();
  ok(v._trailN === 0 && v.trail.geometry.drawRange.count === 0, 'view: reset() clears the trail');
  let draws = 0;
  scene.traverse((o) => {
    if (o.isMesh || o.isLine || o.isPoints || o.isLineSegments) draws++; // (the camera is in the scene: its children count once)
  });
  ok(draws <= 6, `view: ${draws} drawables (edges, markers, ring, trail, face)`);
  wm.reset();
  for (let i = 0; i < 90; i++) {
    wm.update(1 / 72, { live: true, xr: false });
    v.update(1 / 72, game);
  }
  ok(!v.root.visible, 'view: closed again when the map closes');
  v.dispose();
  ok(scene.children.filter((c) => c !== cam).length === 0 && cam.children.length === 0, 'view: dispose empties the scene and the camera');
}

// ---- the wiring ----
{
  const game = fs.readFileSync(path.join(SRC_DIR, 'game.js'), 'utf8');
  ok(game.includes('this._updateWristMap(dt, intent, true);') && game.includes('wm.update(dt, { live:'), 'game: the wrist map steps once per run frame');
  ok(game.includes('new WristComputer(this)') && game.includes('this.wristComputer.update(dt, this)'), 'game: the view is built once the level exists and updated with the others');
  ok(game.includes('intent.mapPressed') && game.includes('wm.toggle()') && game.includes('this.wristMap.reset()') && game.includes('this.wristComputer.reset()'), 'game: M toggles; a new run clears the latch and the trail');
  ok(fs.readFileSync(path.join(SRC_DIR, 'input/desktopInput.js'), 'utf8').includes("case 'KeyM':") && fs.readFileSync(path.join(SRC_DIR, 'input/inputManager.js'), 'utf8').includes('I.mapPressed = E.map'), 'input: M reaches the intent');
  ok(MAP.dwell === 0.35 && MAP.leave === 0.25, 'the dwell and leave times are as documented');
}
console.log(fails ? `\n${fails} FAILED` : '\nALL WRIST MAP CHECKS PASS');
process.exitCode = fails ? 1 : 0;
