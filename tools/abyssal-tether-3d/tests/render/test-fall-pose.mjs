// The body's FALLING ANIMATION (render/fallPose.js, render/bodyView.js), Node, no GPU.
// Reported from play, with the body seen from above circled: "Make a falling animation to the body". In free fall the body hung as when
// standing (the legs looped the Fall clip, nothing else moved; on the desktop the virtual hands stayed at the corners of the view). Now:
//   - fallAmount: a weight 0..1 from the downward speed (5 .. 20 m/s), not on the ground, not in a hop, not on a line or a hold;
//   - handOffset: the desktop virtual hands go up and out and flutter, mirrored left / right, nothing at weight 0;
//   - FallPose: the weight eases in and out, the clock runs while it is on, the desktop sockets get the flail offset and are put back EXACTLY when
//     it is gone, VR hands (the real controllers) are left alone, a dead / roped / grounded player has none, a missing world does not throw;
//   - BodyView: the legs trail up and back, the Fall clip kicks faster, the chest is buffeted, the pack and the pouches are lifted and flapped;
//     the game creates the pose and updates it before the hands and the body read it.
//   node test-fall-pose.mjs
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
const { FALL_POSE, fallAmount, flutter, handOffset, FallPose } = await import(pathToFileURL(path.join(GAME, 'src/render/fallPose.js')).href);

let n = 0;
const ok = (c, msg) => {
  assert.ok(c, msg);
  n++;
  console.log('PASS ' + msg);
};

// 1. fallAmount.
{
  ok(fallAmount(-30, 1, true, false) === 0, 'on the ground: no pose');
  ok(fallAmount(-30, 1, false, true) === 0, 'on a line or a hold: no pose (the hanging pose takes over)');
  ok(fallAmount(-30, 0.1, false, false) === 0, 'in the air for 0.1 s: a hop, no pose');
  ok(fallAmount(4, 1, false, false) === 0 && fallAmount(-3, 1, false, false) === 0, 'rising or falling slowly: no pose');
  const mid = fallAmount(-12.5, 1, false, false);
  ok(mid > 0.4 && mid < 0.6, `at 12.5 m/s down it is half (${mid.toFixed(2)})`);
  ok(fallAmount(-20, 1, false, false) === 1 && fallAmount(-38, 1, false, false) === 1, 'from 20 m/s it is complete');
  let mono = true;
  let prev = 0;
  for (let v = 0; v < 40; v += 0.5) {
    const a = fallAmount(-v, 1, false, false);
    if (a < prev - 1e-12) mono = false;
    prev = a;
  }
  ok(mono, 'it only grows with the speed (smooth)');
}

// 2. flutter and handOffset.
{
  let max = 0;
  for (let t = 0; t < 20; t += 0.013) for (let s = 0; s < 14; s++) max = Math.max(max, Math.abs(flutter(t, s, 1.8)));
  ok(max <= 1.0001 && max > 0.7, `the turbulence stays within -1..1 (peak ${max.toFixed(2)})`);
  ok(flutter(1.234, 5, 1) === flutter(1.234, 5, 1) && flutter(1.234, 5, 1) !== flutter(1.234, 6, 1), 'it is deterministic and differs per part');
  const o = { x: 9, y: 9, z: 9, roll: 9 };
  handOffset(1, 3, 0, o);
  ok(o.x === 0 && o.y === 0 && o.z === 0 && o.roll === 0 || (Math.abs(o.x) + Math.abs(o.y) + Math.abs(o.z) + Math.abs(o.roll) < 1e-12), 'weight 0: no offset');
  const R = handOffset(1, 3, 1, { x: 0, y: 0, z: 0, roll: 0 });
  const Lh = handOffset(-1, 3, 1, { x: 0, y: 0, z: 0, roll: 0 });
  ok(R.x > 0 && Lh.x < 0, 'the right hand goes out to the right and the left to the left');
  let up = 0;
  for (let t = 0; t < 4; t += 0.05) up += handOffset(1, t, 1, { x: 0, y: 0, z: 0, roll: 0 }).y;
  ok(up / 80 > FALL_POSE.hand.y * 0.8, `the hands go up (mean ${(up / 80).toFixed(2)} m)`);
  const half = handOffset(1, 2, 0.5, { x: 0, y: 0, z: 0, roll: 0 });
  const full = handOffset(1, 2, 1, { x: 0, y: 0, z: 0, roll: 0 });
  ok(Math.abs(half.y * 2 - full.y) < 1e-9 && Math.abs(half.x * 2 - full.x) < 1e-9, 'the offset scales with the weight');
}

// 3. FallPose with a fake game.
{
  const cam = new THREE.Object3D();
  const sockets = { left: new THREE.Group(), right: new THREE.Group() };
  const base = { x: 0.2, y: -0.2, z: -0.48 };
  const deskQ = { left: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, 0.2, 0)), right: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.1, -0.2, 0)) };
  const put = () => {
    for (const h of ['left', 'right']) {
      cam.add(sockets[h]);
      sockets[h].position.set(h === 'left' ? -base.x : base.x, base.y, base.z);
      sockets[h].quaternion.copy(deskQ[h]);
    }
  };
  put();
  const player = { vy: 0, grounded: true, alive: true };
  const th = { hands: { left: { rope: { attached: false } }, right: { rope: { attached: false } } } };
  const game = { player, tethers: th, climb: { holding: false }, input: { sockets, tuning: { desktopHand: base }, _deskQuat: deskQ, mode: 'desktop' }, xrActive: false };
  const fp = new FallPose(game);
  for (let i = 0; i < 30; i++) fp.update(1 / 60);
  ok(fp.w === 0 && sockets.right.position.x === base.x, 'standing: no weight, the sockets untouched');
  player.vy = -30;
  player.grounded = false;
  for (let i = 0; i < 12; i++) fp.update(1 / 60); // 0.2 s: in the air 0.2 s < airMin
  ok(fp.w === 0, 'just left the ground: no pose yet');
  for (let i = 0; i < 20; i++) fp.update(1 / 60);
  ok(fp.w > 0.3 && fp.w < 1, `it eases in (${fp.w.toFixed(2)} after 0.53 s)`);
  for (let i = 0; i < 60; i++) fp.update(1 / 60);
  ok(fp.w > 0.97, `and is complete after a second (${fp.w.toFixed(3)})`);
  const t0 = fp.t;
  fp.update(1 / 60);
  ok(fp.t > t0, 'the clock runs while the pose is on');
  ok(Math.abs(sockets.right.position.x - base.x) > 0.05 && sockets.right.position.y > base.y + 0.1 && sockets.left.position.x < -base.x - 0.05, 'the desktop hands flail: out and up');
  ok(!sockets.right.quaternion.equals(deskQ.right), 'and roll');
  ok(fp.stats.flail === true, 'stats.flail');
  // the fall stops: it fades out and the sockets are exactly where they were
  player.vy = 0;
  player.grounded = true;
  for (let i = 0; i < 240; i++) fp.update(1 / 60);
  ok(fp.w === 0, 'on the ground the weight goes to exactly 0');
  ok(sockets.right.position.x === base.x && sockets.right.position.y === base.y && sockets.right.position.z === base.z && sockets.left.position.x === -base.x, 'the sockets are put back to the resting position exactly');
  ok(sockets.right.quaternion.angleTo(deskQ.right) < 1e-6 && sockets.left.quaternion.angleTo(deskQ.left) < 1e-6, '... and the resting aim');
  // roped / dead / holding
  player.grounded = false;
  player.vy = -30;
  th.hands.left.rope.attached = true;
  for (let i = 0; i < 120; i++) fp.update(1 / 60);
  ok(fp.w === 0, 'a line out: no free-fall pose');
  th.hands.left.rope.attached = false;
  game.climb.holding = true;
  for (let i = 0; i < 120; i++) fp.update(1 / 60);
  ok(fp.w === 0, 'a hold: none');
  game.climb.holding = false;
  for (let i = 0; i < 120; i++) fp.update(1 / 60);
  ok(fp.w > 0.9, 'let go: it comes back');
  player.alive = false;
  for (let i = 0; i < 240; i++) fp.update(1 / 60);
  ok(fp.w === 0, 'a dead player: none');
  player.alive = true;
  // XR: the controllers are the hands
  game.xrActive = true;
  const before = sockets.right.position.clone();
  for (let i = 0; i < 120; i++) fp.update(1 / 60);
  ok(fp.w > 0.9 && sockets.right.position.equals(before), 'in VR the weight runs (the body uses it) but the hands are left alone');
  // no world
  const empty = new FallPose({ player: null });
  empty.update(1 / 60);
  ok(empty.w === 0, 'no world yet: no throw');
}

// 4. The wiring.
{
  const bv = fs.readFileSync(path.join(GAME, 'src/render/bodyView.js'), 'utf8');
  ok(/import \{ FALL_POSE, flutter \} from '\.\/fallPose\.js'/.test(bv), 'the body view imports the pose');
  ok(/const fw = fp && air && ropes === 0 \? fp\.w : 0/.test(bv), 'it reads the weight only in the air without a line or a hold');
  ok(/this\.actions\.Fall\.setEffectiveTimeScale\(1 \+ FALL_POSE\.kick \* fw\)/.test(bv), 'the Fall clip kicks faster with the weight');
  ok(/free fall: the legs trail up and back/.test(bv) && /FALL_POSE\.legTrail \* fw/.test(bv), 'the pelvis tilts so the legs trail up and back');
  ok(/free fall: the airstream buffets the chest/.test(bv) && /FALL_POSE\.chestShake \* fw/.test(bv), 'the chest is buffeted before the arms are solved');
  ok(/FALL_POSE\.packLift/.test(bv) && /drive\(this\._spr\.pack, 0\.012, 0\.01, 90, 7, 0\.22, this\._ex\[0\], this\._ex\[1\]\)/.test(bv), 'the pack and the pouches are lifted and flapped');
  const g = fs.readFileSync(path.join(GAME, 'src/game.js'), 'utf8');
  ok(/this\.fallPose = new FallPose\(this\)/.test(g), 'the game creates the pose');
  const iU = g.indexOf('this.fallPose.update(dt)');
  const iH = g.indexOf("this._updateObjectiveHint(dt);\n    } catch (err) {\n      this._fault('objectiveHint'");
  ok(iU > 0 && iH > iU, 'and updates it first in the views, before the hands and the body read it');
}
console.log(`\n${n} checks passed`);
