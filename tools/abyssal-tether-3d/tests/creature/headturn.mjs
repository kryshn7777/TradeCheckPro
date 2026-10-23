// Head turning of the Mason (Node): the crown's facing and dorsal up must turn continuously. They used to flip (the up by up to 150 degrees in
// one frame where the clinging normal is nearly along the facing: a corner of two surfaces), which made the head and the neck snap.
//   - on the real level, the Mason hunting in four sections (3 seeds, a still and a moving player, 60 s each): the facing never turns faster
//     than the cap, the up never faster than the cap plus the facing's own turn (teleports / relocations, > 9 m in a frame, are excluded);
//   - computeFrames (render/mason/masonPose.js): the spine frames hold their roll when the normal is along the spine, and follow it once it is
//     well defined again, with no jump.
//   node headturn.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Creature3D, SEG } = await import(srcUrl('sim/creature3d.js'));
const { computeFrames } = await import(srcUrl('render/mason/masonPose.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const ang = (a, b) => (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;

{
  let maxF = 0;
  let maxU = 0;
  let frames = 0;
  let teleports = 0;
  for (const sec of [2, 3, 4, 5]) {
    for (const seed of [1, 2, 3]) {
      for (const moving of [false, true]) {
        const L = new Level3D(LEVEL_DATA_3D, DIFFICULTY.normal.levelVariant);
        const c = new Creature3D(L, DIFFICULTY.normal, new EventBus(), { seed });
        const cp = L.sections[sec].checkpoint;
        const p = { x: cp.x, y: cp.y, z: cp.z, vx: 0, vy: 0, vz: 0, alive: true, grounded: true };
        c.reset(p);
        c.setSection(sec, L.sections[sec], p);
        let pf = null;
        let pu = null;
        let pp = null;
        for (let i = 0; i < 60 * 60; i++) {
          const t = i / 60;
          if (moving) {
            p.x = cp.x + Math.sin(t * 0.7) * 6;
            p.z = cp.z + Math.cos(t * 0.5) * 6;
            p.y = cp.y - ((0.4 * t) % 30);
          }
          c.update(1 / 60, p, t);
          if (c.caughtPlayer) {
            c.reset(p);
            c.setSection(sec, L.sections[sec], p);
            pf = null;
            continue;
          }
          const h = c.body.head;
          if (!c.inPlay || !c.body.visible) {
            pf = null;
            continue;
          }
          const f = [h.fx, h.fy, h.fz];
          const u = [h.ux, h.uy, h.uz];
          const pos = [h.x, h.y, h.z];
          if (pf) {
            if (Math.hypot(pos[0] - pp[0], pos[1] - pp[1], pos[2] - pp[2]) > 9) teleports++;
            else {
              frames++;
              maxF = Math.max(maxF, ang(pf, f) * 60);
              maxU = Math.max(maxU, ang(pu, u) * 60);
            }
          }
          pf = f;
          pu = u;
          pp = pos;
        }
      }
    }
  }
  console.log(`      (${frames} frames, ${teleports} relocations skipped; max facing ${maxF.toFixed(0)} deg/s, max up ${maxU.toFixed(0)} deg/s)`);
  ok(frames > 20000, `the Mason is in play for most of the run (${frames} frames)`);
  ok(maxF <= 285, `the facing never turns faster than 285 deg/s (max ${maxF.toFixed(0)})`);
  ok(maxU <= 450, `the dorsal up never turns faster than 450 deg/s, the facing's own turn included (max ${maxU.toFixed(0)}; it was up to 9000)`);
}

{
  // spine frames: a straight spine along +X; the normal swings from +Y through along-the-spine (+X) to -Y... the roll must not jump
  const B = { spine: new Float32Array(SEG * 3), up: new Float32Array(SEG * 3), head: { x: 0, y: 0, z: 0, fx: 1, fy: 0, fz: 0, ux: 0, uy: 1, uz: 0 } };
  for (let i = 0; i < SEG; i++) {
    B.spine[i * 3] = -i * 1.5;
  }
  const F = new Float32Array(SEG * 12);
  const setUp = (x, y, z) => {
    for (let i = 0; i < SEG; i++) {
      B.up[i * 3] = x;
      B.up[i * 3 + 1] = y;
      B.up[i * 3 + 2] = z;
    }
  };
  setUp(0, 1, 0);
  computeFrames(B, SEG, F, 1 / 60, true);
  let prev = [F[18 + 6], F[18 + 7], F[18 + 8]]; // segment 1 (index 1 -> offset 12): up
  prev = [F[12 + 6], F[12 + 7], F[12 + 8]];
  let worst = 0;
  // the normal rotates from +Y to +X (along the spine) and on to -Y, over 60 steps, with a tiny sideways part so it never degenerates exactly
  for (let k = 1; k <= 60; k++) {
    const a = (k / 60) * Math.PI;
    setUp(Math.sin(a), Math.cos(a), 1e-3);
    computeFrames(B, SEG, F, 1 / 60);
    const u = [F[12 + 6], F[12 + 7], F[12 + 8]];
    worst = Math.max(worst, ang(prev, u));
    prev = u;
  }
  ok(worst < 8, `a normal swinging through the spine's own direction: the frame's up turns at most ${worst.toFixed(1)} deg per frame (the cap is ${((7 * 180) / Math.PI / 60).toFixed(1)}; it flipped by 174 before)`);
  // orthonormal at the end
  const f = [F[12 + 3], F[12 + 4], F[12 + 5]];
  const u = [F[12 + 6], F[12 + 7], F[12 + 8]];
  const r = [F[12 + 9], F[12 + 10], F[12 + 11]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  ok(Math.abs(dot(f, u)) < 1e-4 && Math.abs(dot(f, r)) < 1e-4 && Math.abs(dot(u, r)) < 1e-4 && Math.abs(dot(u, u) - 1) < 1e-4, 'the frames stay orthonormal');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL HEAD TURN CHECKS PASS');
process.exitCode = fails ? 1 : 0;
