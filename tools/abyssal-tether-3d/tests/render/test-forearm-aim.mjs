// The arm model's forearm swings about the wrist to the solved elbow (HandsView.aimForearm), the hand keeps the controller's orientation.
// Uses the real rest pose of Forearm_L / Hand_L from assets/models/player_arms.glb (translation / rotation read from the glTF JSON).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register as reg } from 'node:module';
import assert from 'node:assert/strict';
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
const { HandsView } = await import(`${SRC}/render/handsView.js`);
const glb = fs.readFileSync(path.join(HERE, '..', '..', '..', '..', 'public', 'abyssal-tether-3d', 'assets', 'models', 'player_arms.glb'));
const js = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)));
const node = (n) => js.nodes.find((x) => x.name === n);
let n = 0;
const ok = (c, m) => {
  assert.ok(c, m);
  console.log('PASS ' + m);
  n++;
};

function rig(side) {
  const root = new THREE.Group();
  const arm = new THREE.Group();
  root.add(arm);
  const f = node('Forearm_' + side);
  const h = node('Hand_' + side);
  const fo = new THREE.Bone();
  fo.name = 'Forearm_' + side;
  fo.position.fromArray(f.translation);
  fo.quaternion.fromArray(f.rotation);
  const hd = new THREE.Bone();
  hd.name = 'Hand_' + side;
  hd.position.fromArray(h.translation);
  hd.quaternion.fromArray(h.rotation);
  fo.add(hd);
  arm.add(fo);
  root.updateMatrixWorld(true);
  return { root, fo, hd };
}
const L = rig('L');
const view = Object.create(HandsView.prototype);
view._gearXr = true;
view.gear = { left: { root: L.root, forearm: L.fo, wrist: L.hd } };
// the controller is pitched and rolled: the whole arm root carries it
L.root.position.set(0.3, 1.2, -0.4);
L.root.quaternion.setFromEuler(new THREE.Euler(0.5, 0.3, 0.7));
L.root.updateMatrixWorld(true);
const w0 = new THREE.Vector3().setFromMatrixPosition(L.hd.matrixWorld);
const hq0 = new THREE.Quaternion();
L.hd.getWorldQuaternion(hq0);
const e0 = new THREE.Vector3().setFromMatrixPosition(L.fo.matrixWorld);

const dir = new THREE.Vector3(0.2, -0.9, 0.35).normalize();
ok(view.aimForearm('left', dir, Math.PI, 1 / 72), 'aimForearm applies in XR');
const w1 = new THREE.Vector3().setFromMatrixPosition(L.hd.matrixWorld);
const hq1 = new THREE.Quaternion();
L.hd.getWorldQuaternion(hq1);
const e1 = new THREE.Vector3().setFromMatrixPosition(L.fo.matrixWorld);
ok(w1.distanceTo(w0) < 1e-5, 'the wrist does not move');
ok(Math.abs(hq1.dot(hq0)) > 0.999999, 'the hand keeps the controller\'s orientation');
const got = e1.clone().sub(w1).normalize();
ok(got.angleTo(dir) < 0.02, `the sleeve end points at the elbow direction (${((got.angleTo(dir) * 180) / Math.PI).toFixed(2)} deg off after smoothing start)`);
ok(Math.abs(e1.distanceTo(w1) - L.hd.position.length()) < 1e-4, 'the forearm keeps its length');
ok(e1.distanceTo(e0) > 0.05, 'the elbow end really moved');
// the swing is capped
const back = new THREE.Vector3().subVectors(e0, w0).normalize();
const view2 = Object.create(HandsView.prototype);
view2._gearXr = true;
const L2 = rig('L');
L2.root.position.copy(L.root.position);
L2.root.quaternion.copy(L.root.quaternion);
L2.root.updateMatrixWorld(true);
view2.gear = { left: { root: L2.root, forearm: L2.fo, wrist: L2.hd } };
view2.aimForearm('left', back.clone().negate(), 0.5, 1 / 72); // the opposite way
const w2 = new THREE.Vector3().setFromMatrixPosition(L2.hd.matrixWorld);
const e2 = new THREE.Vector3().setFromMatrixPosition(L2.fo.matrixWorld);
ok(e2.clone().sub(w2).normalize().angleTo(back) <= 0.5 + 0.02, 'the swing is capped at maxBend');
// not in XR: untouched
const view3 = Object.create(HandsView.prototype);
view3._gearXr = false;
view3.gear = view.gear;
ok(view3.aimForearm('left', dir) === false, 'nothing happens off XR');
// smoothing: the second call moves toward a new direction, not all the way
const dir2 = new THREE.Vector3(-0.6, -0.3, 0.7).normalize();
view.aimForearm('left', dir2, Math.PI, 1 / 72);
const e3 = new THREE.Vector3().setFromMatrixPosition(L.fo.matrixWorld).sub(new THREE.Vector3().setFromMatrixPosition(L.hd.matrixWorld)).normalize();
ok(e3.angleTo(dir2) > 0.05 && e3.angleTo(dir) < dir.angleTo(dir2), 'the aim is smoothed toward a new direction');
console.log(`forearm aim: ${n} checks passed`);
