// The Mason's mandibles (render/mason/masonMandibles.js), Node, no GPU: the geometry is a closed, tapering, serrated horn within a
// small triangle budget; the opening angle follows the creature's state (idles slightly open, clicks while listening, flares through the
// wind-up, snaps shut crossing its tips on the strike, reopens through the recoil); the spring never overshoots wildly; no allocation per frame.
// The geometry is a pair of crescents that hang from the corners of the mouth and curl in under it (the shape the owner drew), not tusks over the face.
//   node test-mandibles.mjs
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register as reg } from 'node:module';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/vendor/three/')).href;
const SRC = pathToFileURL(path.resolve(HERE, '../../../../public/abyssal-tether-3d/src/')).href;
reg(
  'data:text/javascript,' +
    encodeURIComponent(`export async function resolve(s, c, next) {
  if (s === 'three') return { url: '${VENDOR}/three.module.min.js', shortCircuit: true };
  if (s.startsWith('three/addons/')) return { url: '${VENDOR}/addons/' + s.slice(13), shortCircuit: true };
  return next(s, c);
}`),
);
globalThis.self = globalThis;
const THREE = await import('three');
const { MANDIBLE, Mandibles, mandibleGeometry, mandibleOpen } = await import(`${SRC}/render/mason/masonMandibles.js`);

let n = 0;
const ok = (c, msg) => {
  assert.ok(c, msg);
  n++;
  console.log('PASS ' + msg);
};

// 1. The geometry.
{
  const { geometry, tip, tipDir, triangles } = mandibleGeometry();
  const pos = geometry.getAttribute('position');
  const col = geometry.getAttribute('color');
  const nrm = geometry.getAttribute('normal');
  ok(triangles > 400 && triangles <= 900, `a horn is ${triangles} triangles (two: ${triangles * 2}, well inside a draw call's worth)`);
  ok(pos.count === col.count && pos.count === nrm.count && geometry.index.count === triangles * 3, 'positions, colours, normals and the index agree');
  let finite = true;
  for (let i = 0; i < pos.count * 3; i++) if (!Number.isFinite(pos.array[i]) || !Number.isFinite(nrm.array[i]) || !Number.isFinite(col.array[i])) finite = false;
  let inRange = true;
  for (let i = 0; i < geometry.index.count; i++) if (geometry.index.array[i] >= pos.count) inRange = false;
  ok(finite && inRange, 'every number is finite and every index in range');
  geometry.computeBoundingBox();
  const bb = geometry.boundingBox;
  const Lm = MANDIBLE.length;
  ok(Lm >= 5 && Lm <= 7.5, `big but not huge: ${Lm} m of horn`);
  ok(bb.max.x > Lm * 0.2 && bb.max.x < Lm * 0.5, `it bows out to the side of the mouth (${bb.max.x.toFixed(1)} m)`);
  ok(bb.min.z < -Lm * 0.7 && bb.max.z < Lm * 0.15, `it sweeps FORWARD, the way the face looks (${(-bb.min.z).toFixed(1)} m in front of its root; the face looks down -z)`);
  ok(bb.min.y > -Lm * 0.45 && bb.max.y < Lm * 0.15, `it droops only a little (${bb.min.y.toFixed(1)} m) and never rises over the face (${bb.max.y.toFixed(1)} m): nothing sinks into the wall the creature clings to`);
  // the point looks along the line of sight, toed in by 20-45 degrees so the two points converge in front of the face
  const [tdx, tdy, tdz] = tipDir;
  const toe = (Math.atan2(-tdx, -tdz) * 180) / Math.PI;
  ok(tdz < -0.6 && toe > 20 && toe < 45 && tip[2] < -Lm * 0.7, `the point aims forward (z ${tdz.toFixed(2)}) with ${toe.toFixed(0)} degrees of toe-in, ${(-tip[2]).toFixed(1)} m ahead of its root: it points at whoever the creature faces`);
  // seen head-on the whole tusk is in the picture
  ok(bb.max.x - bb.min.x > 1.5 && bb.max.y - bb.min.y > 1.0, `seen face-on it is a full curve (${(bb.max.x - bb.min.x).toFixed(1)} x ${(bb.max.y - bb.min.y).toFixed(1)} m across, ${(bb.max.z - bb.min.z).toFixed(1)} m deep)`);
  // the two roots sit at the corners of the mouth
  ok(MANDIBLE.root.x >= 1.55 && MANDIBLE.root.x <= 2.4 && MANDIBLE.root.z < 0, `the roots sit just outside the corners of the mouth (x +-${MANDIBLE.root.x})`);
  // taper: the radius near the root is far larger than near the tip
  const sides = MANDIBLE.sides;
  const ringRadius = (i) => {
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (let s = 0; s < sides; s++) {
      cx += pos.getX(i * sides + s) / sides;
      cy += pos.getY(i * sides + s) / sides;
      cz += pos.getZ(i * sides + s) / sides;
    }
    let r = 0;
    for (let s = 0; s < sides; s++) r += Math.hypot(pos.getX(i * sides + s) - cx, pos.getY(i * sides + s) - cy, pos.getZ(i * sides + s) - cz) / sides;
    return r;
  };
  const r1 = ringRadius(2);
  const r2 = ringRadius(MANDIBLE.rings - 1);
  ok(r1 > r2 * 10, `it tapers from ${r1.toFixed(2)} m at the root to ${r2.toFixed(2)} m at the point`);
  // colours: dark at the root, pale at the tip
  const lum = (i) => col.getX(i) * 0.3 + col.getY(i) * 0.59 + col.getZ(i) * 0.11;
  ok(lum(0) < 0.34 && lum((MANDIBLE.rings - 1) * sides) > 0.5 && lum((MANDIBLE.rings - 1) * sides) > lum(0) * 1.4, 'stained at the root, pale ivory toward the tip');
  // teeth: the vertex count beyond the tube + cap carries MANDIBLE.teeth spikes of 5 vertices
  const tube = (MANDIBLE.rings + 1) * sides + 1;
  ok(pos.count - tube === MANDIBLE.teeth * 5, `${MANDIBLE.teeth} teeth along the inner edge`);
  const bare = mandibleGeometry({ teeth: 0 });
  ok(bare.triangles < triangles, 'the teeth are the difference (a bare horn has fewer triangles)');
}
// 2. The opening angle follows the state.
{
  const base = { state: 'DORMANT', phase: null, atkT: 0, atkWindup: 0.75, listening: false, creeping: false, distance: 60 };
  const idle = mandibleOpen(base, 1, 0);
  ok(idle > 0.2 && idle < 0.4, `idle: slightly open (${idle.toFixed(2)} rad)`);
  const near = mandibleOpen({ ...base, state: 'PURSUING', distance: 7 }, 1, 0);
  const far = mandibleOpen({ ...base, state: 'PURSUING', distance: 50 }, 1, 0);
  let nearMean = 0;
  let farMean = 0;
  for (let t = 0; t < 4; t += 0.05) {
    nearMean += mandibleOpen({ ...base, state: 'PURSUING', distance: 7 }, t, 0) / 80;
    farMean += mandibleOpen({ ...base, state: 'PURSUING', distance: 50 }, t, 0) / 80;
  }
  ok(nearMean > farMean + 0.2 && near < 1.1 && far < 0.5, `hunting: it spreads as it comes (mean ${farMean.toFixed(2)} rad at 50 m, ${nearMean.toFixed(2)} at 7 m)`);
  let lo = 9;
  let hi = -9;
  for (let t = 0; t < 3; t += 0.02) {
    const a = mandibleOpen({ ...base, listening: true }, t, 0);
    lo = Math.min(lo, a);
    hi = Math.max(hi, a);
  }
  ok(hi - lo > 0.08, `listening: it clicks (swing ${(hi - lo).toFixed(2)} rad)`);
  const w0 = mandibleOpen({ ...base, phase: 'windup', atkT: 0 }, 0, 0);
  const w1 = mandibleOpen({ ...base, phase: 'windup', atkT: 0.75 }, 0, 0);
  ok(w1 > 1.0 && w1 > w0 + 0.5, `wind-up: flares wide (${w0.toFixed(2)} -> ${w1.toFixed(2)} rad)`);
  const snap = mandibleOpen({ ...base, phase: 'strike', atkT: 0.05 }, 0, 0);
  ok(snap < -0.4, `strike: snaps shut, the tips cross (${snap.toFixed(2)} rad)`);
  const r0 = mandibleOpen({ ...base, phase: 'recoil', atkT: 0 }, 0, 0);
  const r1 = mandibleOpen({ ...base, phase: 'recoil', atkT: 0.45 }, 0, 0);
  ok(r1 > r0 + 0.8, `recoil: reopens (${r0.toFixed(2)} -> ${r1.toFixed(2)} rad)`);
  ok(mandibleOpen({ ...base, state: 'BURST' }, 0, 0) > 0.7, 'a surge runs with the jaws wide');
  ok(Number.isFinite(mandibleOpen(null, 0, 0)), 'no snapshot is fine');
}
// 3. The Mandibles object: the spring, the visibility, the sides.
{
  const m = new Mandibles({ seed: 0.2 });
  ok(m.triangles <= 1800 && m.meshes.length === 2 && m.meshes[0].scale.x === 1 && m.meshes[1].scale.x === -1, `two horns (${m.triangles} triangles), the left the mirror of the right`);
  const root = new THREE.Group();
  m.mount(root);
  ok(m.group.parent === root && m.group.matrixAutoUpdate === false, 'it is mounted on the view root (the rig bones are not in the scene graph) with a driven matrix');
  const neckWorld = new THREE.Matrix4().compose(new THREE.Vector3(3, 4, 5), new THREE.Quaternion().setFromEuler(new THREE.Euler(0.3, 1.1, -0.2)), new THREE.Vector3(0.8, 0.8, 0.8));
  m.follow(neckWorld);
  root.updateMatrixWorld(true);
  const wp = new THREE.Vector3().setFromMatrixPosition(m.group.matrixWorld);
  ok(wp.distanceTo(new THREE.Vector3(3, 4, 5)) < 1e-9 && Math.abs(m.group.matrixWorld.elements[0] - neckWorld.elements[0]) < 1e-12, 'follow() puts the group exactly where the head bone is (position, rotation, scale)');
  root.position.set(10, 0, 0);
  root.updateMatrixWorld(true);
  m.follow(neckWorld, root.matrixWorld);
  root.updateMatrixWorld(true);
  ok(new THREE.Vector3().setFromMatrixPosition(m.group.matrixWorld).distanceTo(new THREE.Vector3(3, 4, 5)) < 1e-9, 'with a root that is not at the origin it still lands on the bone (the bone matrices are world-space)');
  let found = 0;
  root.traverse((o) => {
    if (o.name === 'MandibleR' || o.name === 'MandibleL') found++;
  });
  ok(found === 2, 'both horns are reachable by a scene traversal from the view root (the bug a bone child had: none were)');
  const snap = { state: 'ATTACK', phase: 'windup', atkT: 0, atkWindup: 0.75, listening: false, creeping: false, distance: 5 };
  let maxOpen = 0;
  let maxOvershoot = 0;
  for (let f = 0; f < 90; f++) {
    snap.atkT = Math.min(0.75, f / 60);
    m.update(1 / 60, snap, f / 60, true);
    maxOpen = Math.max(maxOpen, m.open);
    maxOvershoot = Math.max(maxOvershoot, m.open - 1.1);
  }
  ok(maxOpen > 0.9 && maxOpen < 1.3, `through a wind-up it opens to ${maxOpen.toFixed(2)} rad`);
  snap.phase = 'strike';
  snap.atkT = 0;
  let framesToShut = -1;
  for (let f = 0; f < 30; f++) {
    snap.atkT = f / 60;
    m.update(1 / 60, snap, f / 60, true);
    if (m.open < 0 && framesToShut < 0) framesToShut = f;
  }
  ok(framesToShut >= 0 && framesToShut <= 8, `the strike closes the jaws within ${framesToShut} frames (${((framesToShut / 60) * 1000).toFixed(0)} ms)`);
  ok(Math.abs(m.pivots[0].rotation.y + m.open * MANDIBLE.swing) < 1e-9 && Math.abs(m.pivots[1].rotation.y - m.open * MANDIBLE.swing) < 1e-9 && m.pivots[0].rotation.z === 0, 'the two horns swing apart about the vertical by equal and opposite angles (out when open, in and crossed when shut)');
  m.update(1 / 60, snap, 0, false);
  ok(m.group.visible === false, 'hidden when the creature is not at full detail');
  // no allocation per frame (the update only writes numbers)
  const before = process.memoryUsage().heapUsed;
  for (let f = 0; f < 20000; f++) m.update(1 / 60, snap, f / 60, true);
  const grew = (process.memoryUsage().heapUsed - before) / 1e6;
  ok(grew < 8, `20000 frames of update leave the heap alone (${grew.toFixed(1)} MB)`);
}
// The aim: the points toe in toward where the player is.
{
  const m = new Mandibles();
  const root = new THREE.Group();
  m.mount(root);
  const run = (target, secs = 1.5) => {
    m.hold = 0.3;
    m.setTarget(...target);
    for (let i = 0; i < secs * 60; i++) m.update(1 / 60, null, 0, true);
    return [m.aim[0], m.aim[1], m.pivots[0].rotation.y, m.pivots[1].rotation.y];
  };
  const none = run([0, 0, -9]);
  m.setTarget(null);
  for (let i = 0; i < 120; i++) m.update(1 / 60, null, 0, true);
  ok(Math.abs(m.aim[0]) < 1e-3 && Math.abs(m.aim[1]) < 1e-3, 'no target: the tusks keep their modelled toe-in (no aim)');
  const front = run([0, 0, -9]);
  ok(front[0] > 0 && front[0] === front[1] && front[0] <= MANDIBLE.aimMax + 1e-9, `a player straight ahead at 9 m: both points turn in by the same ${front[0].toFixed(2)} rad (at most ${MANDIBLE.aimMax})`);
  const right = run([6, 0, -9]);
  ok(right[0] < front[0] && right[1] > front[1], `a player off to the right: the right tusk turns in less (${right[0].toFixed(2)} vs ${front[0].toFixed(2)}) and the left more (${right[1].toFixed(2)}): both look at him`);
  const behind = run([0, 0, 4]);
  ok(Math.abs(behind[0]) < 1e-3 && Math.abs(behind[1]) < 1e-3, 'a target behind the face leaves the tusks alone');
  const close = run([0, 0, -3]);
  ok(Math.abs(close[0]) < 1e-3, 'a player closer than the points: no aim (they would stab through him; the head turns instead)');
  // eased, no overshoot
  const m2 = new Mandibles();
  m2.hold = 0.3;
  m2.setTarget(0, 0, -9);
  let prev = 0;
  let mono = true;
  for (let i = 0; i < 180; i++) {
    m2.update(1 / 60, null, 0, true);
    if (m2.aim[0] < prev - 1e-12) mono = false;
    prev = m2.aim[0];
  }
  ok(mono && prev <= MANDIBLE.aimMax + 1e-9, 'the aim eases in without overshoot');
}

console.log(`\n${n} checks passed`);
