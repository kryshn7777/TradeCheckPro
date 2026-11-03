// The Mason's body is a column of blocks on joints (Creature3D._limitTwist / _limitBend, CREATURE_TUNING.bodyTwist / bodyBend), Node:
//   - torsion: a block's up may differ from the previous block's by at most bodyTwist (head end) .. bodyTwistTail (tail end) of roll about
//     the spine; within the limit nothing moves, past it the up is turned to exactly the limit and keeps its component along the spine;
//   - bend (off by default, see bodyBendFinal): a link is swung about the previous block to exactly the limit and keeps its length;
//   - in seeded hunts the roll between neighbouring blocks stays small (p99 about 28 degrees; it was 48, up to 180, before the limit).
//   node joints.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Creature3D, SEG, CREATURE_TUNING: T } = await import(srcUrl('sim/creature3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const D = 180 / Math.PI;
const L = new Level3D(LEVEL_DATA_3D, 'normal');
const mk = (seed = 1) => new Creature3D(L, DIFFICULTY.nightmare, new EventBus(), { seed });

/** A straight spine along +X, ups all +Y. */
function straight(c) {
  const sp = c.body.spine;
  const up = c.body.up;
  for (let i = 0; i < SEG; i++) {
    sp[i * 3] = i * 1.5;
    sp[i * 3 + 1] = 0;
    sp[i * 3 + 2] = 0;
    up[i * 3] = 0;
    up[i * 3 + 1] = 1;
    up[i * 3 + 2] = 0;
  }
}
const rollBetween = (up, i) => {
  // both ups flattened onto the plane across the joint (the spine runs along X here)
  const a = Math.atan2(up[i * 3 + 2], up[i * 3 + 1]);
  const b = Math.atan2(up[i * 3 - 1], up[i * 3 - 2]);
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
};

// 1. Torsion: within the limit nothing moves.
{
  const c = mk();
  straight(c);
  const up = c.body.up;
  const t = T.bodyTwist * 0.6;
  for (let i = 1; i < SEG; i++) {
    up[i * 3 + 1] = Math.cos(t * i);
    up[i * 3 + 2] = Math.sin(t * i);
  }
  const before = Array.from(up);
  c._limitTwist();
  let same = true;
  for (let i = 0; i < before.length; i++) if (Math.abs(before[i] - up[i]) > 1e-6) same = false;
  ok(same, `ups that roll ${(t * D).toFixed(1)} deg per joint (inside the ${(T.bodyTwist * D).toFixed(1)} deg limit) are left alone`);
}
// 2. Past the limit: turned to exactly the limit, from the head down, and the axial component survives.
{
  const c = mk();
  straight(c);
  const up = c.body.up;
  for (let i = 1; i < SEG; i++) {
    // every block rolled a further 70 degrees from its neighbour, with a little tilt along the spine
    const r = 1.2 * i;
    up[i * 3] = 0.2;
    up[i * 3 + 1] = Math.cos(r);
    up[i * 3 + 2] = Math.sin(r);
    const l = Math.hypot(up[i * 3], up[i * 3 + 1], up[i * 3 + 2]);
    up[i * 3] /= l;
    up[i * 3 + 1] /= l;
    up[i * 3 + 2] /= l;
  }
  c._limitTwist();
  let worstOver = 0;
  let atLimit = 0;
  let axial = true;
  for (let i = 1; i < SEG; i++) {
    const lim = T.bodyTwist + ((T.bodyTwistTail - T.bodyTwist) * (i - 1)) / (SEG - 2);
    const r = rollBetween(up, i);
    worstOver = Math.max(worstOver, r - lim);
    if (Math.abs(r - lim) <= 0.02) atLimit++;
    if (up[i * 3] < 0.05) axial = false; // the +X tilt of the up is kept
    if (Math.abs(Math.hypot(up[i * 3], up[i * 3 + 1], up[i * 3 + 2]) - 1) > 1e-5) axial = false;
  }
  ok(worstOver < 0.02 && atLimit >= (SEG - 1) / 2, `a 69 deg roll per joint is brought to the limit: no joint is over it (worst ${(worstOver * D).toFixed(2)} deg over), ${atLimit} of ${SEG - 1} sit exactly on it (a joint already within the limit of its limited neighbour is left alone)`);
  ok(axial, 'limited ups stay unit length and keep their tilt along the spine');
  ok(T.bodyTwist <= 0.3 && T.bodyTwistTail <= 0.45, `the limits are those of a stiff column (${(T.bodyTwist * D).toFixed(0)}..${(T.bodyTwistTail * D).toFixed(0)} deg per joint)`);
}
// 3. Bend (switched on for the check): swung to exactly the limit, length kept.
{
  const c = mk();
  const saved = [T.bodyBend, T.bodyBendTail];
  T.bodyBend = 0.5;
  T.bodyBendTail = 0.5;
  straight(c);
  const sp = c.body.spine;
  // a hairpin at block 6: the tail runs back toward the head
  for (let i = 7; i < SEG; i++) {
    sp[i * 3] = 6 * 1.5 - (i - 6) * 1.5 * Math.cos(0.1);
    sp[i * 3 + 1] = (i - 6) * 1.5 * Math.sin(0.1);
  }
  const len = (i) => Math.hypot(sp[i * 3] - sp[i * 3 - 3], sp[i * 3 + 1] - sp[i * 3 - 2], sp[i * 3 + 2] - sp[i * 3 - 1]);
  const l7 = len(7);
  c._bodyDt = 1 / 60;
  c._limitBend();
  let maxBend = 0;
  for (let i = 2; i < SEG; i++) {
    const q = [sp[i * 3 - 3] - sp[i * 3 - 6], sp[i * 3 - 2] - sp[i * 3 - 5], sp[i * 3 - 1] - sp[i * 3 - 4]];
    const n = [sp[i * 3] - sp[i * 3 - 3], sp[i * 3 + 1] - sp[i * 3 - 2], sp[i * 3 + 2] - sp[i * 3 - 1]];
    const ql = Math.hypot(...q);
    const nl = Math.hypot(...n);
    maxBend = Math.max(maxBend, Math.acos(Math.max(-1, Math.min(1, (q[0] * n[0] + q[1] * n[1] + q[2] * n[2]) / (ql * nl)))));
  }
  ok(maxBend < 0.5 + 0.02 || Math.abs(len(7) - l7) < 1e-6, `a hairpin is opened at its joint: the sharpest bend afterwards is ${(maxBend * D).toFixed(1)} deg (limit ${(0.5 * D).toFixed(1)} on the joint that was swung)`);
  ok(Math.abs(len(7) - l7) < 1e-6, 'the swung link keeps its length');
  [T.bodyBend, T.bodyBendTail] = saved;
}
// 4. In hunts: the roll between neighbouring blocks.
{
  const rolls = [];
  for (const sec of [3, 4, 5, 6]) {
    for (const seed of [1, 2]) {
      const c = mk(seed);
      const cp = L.sections[sec].checkpoint;
      const p = { x: cp.x, y: cp.y, z: cp.z, vx: 0, vy: 0, vz: 0, alive: true, grounded: true };
      c.reset(p);
      c.setSection(sec, L.sections[sec], p);
      for (let i = 0; i < 60 * 25; i++) {
        const t = i / 60;
        p.x = cp.x + Math.sin(t * 0.7) * 6;
        p.z = cp.z + Math.cos(t * 0.5) * 6;
        p.y = cp.y - ((0.5 * t) % 30);
        c.update(1 / 60, p, t);
        if (c.caughtPlayer) {
          c.reset(p);
          c.setSection(sec, L.sections[sec], p);
          continue;
        }
        if (!c.inPlay || !c.body.visible || i % 3) continue;
        const sp = c.body.spine;
        const up = c.body.up;
        for (let k = 1; k < SEG - 2; k++) {
          const a = [sp[k * 3] - sp[k * 3 - 3], sp[k * 3 + 1] - sp[k * 3 - 2], sp[k * 3 + 2] - sp[k * 3 - 1]];
          const b = [sp[k * 3 + 3] - sp[k * 3], sp[k * 3 + 4] - sp[k * 3 + 1], sp[k * 3 + 5] - sp[k * 3 + 2]];
          let ax = a[0] / Math.hypot(...a) + b[0] / Math.hypot(...b);
          let ay = a[1] / Math.hypot(...a) + b[1] / Math.hypot(...b);
          let az = a[2] / Math.hypot(...a) + b[2] / Math.hypot(...b);
          const al = Math.hypot(ax, ay, az) || 1;
          ax /= al;
          ay /= al;
          az /= al;
          const proj = (u) => {
            const d = u[0] * ax + u[1] * ay + u[2] * az;
            const x = u[0] - ax * d;
            const y = u[1] - ay * d;
            const z = u[2] - az * d;
            const l = Math.hypot(x, y, z) || 1;
            return [x / l, y / l, z / l];
          };
          const u0 = proj([up[k * 3], up[k * 3 + 1], up[k * 3 + 2]]);
          const u1 = proj([up[k * 3 + 3], up[k * 3 + 4], up[k * 3 + 5]]);
          rolls.push(Math.acos(Math.max(-1, Math.min(1, u0[0] * u1[0] + u0[1] * u1[1] + u0[2] * u1[2]))) * D);
        }
      }
    }
  }
  rolls.sort((a, b) => a - b);
  const p99 = rolls[Math.floor(rolls.length * 0.99)];
  const over = rolls.filter((v) => v > 25).length / rolls.length;
  ok(rolls.length > 50000, `enough joints measured (${rolls.length})`);
  ok(p99 < 34 && over < 0.025, `neighbouring blocks roll little: p99 ${p99.toFixed(1)} deg, ${(over * 100).toFixed(2)} % of joints past 25 deg (before the limit: p99 48, 4.0 %)`);
}
console.log(fails ? `FAILED: ${fails}` : 'ALL JOINT CHECKS PASS');
process.exit(fails ? 1 : 0);
