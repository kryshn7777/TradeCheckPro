// The Mason's body axes while it chases a player who stays close and moves back and forth (Node): the facing, the block tangents and the block ups
// must not whip about. Scenario (sections 5 and 6, 8 seeds, 45 s): the player swings +-3 m to and fro at 0.6-1.3 Hz in a small volume while it hunts.
// Per frame (relocations / teleports, > 9 m in a frame, excluded):
//   head   = the turn rate of the facing (deg/s);
//   tan    = the turn rate of each block's tangent, blocks 3..17;
//   up     = the turn rate of each block's up.
// Reported: p95 and max of each, and the share of frames above 150 deg/s.
//   node twist.mjs [--print]
import { srcUrl } from '../../verify/root.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Creature3D, SEG, CREATURE_TUNING } = await import(srcUrl('sim/creature3d.js'));
if (process.env.TUNE) Object.assign(CREATURE_TUNING, JSON.parse(process.env.TUNE)); // experiments: TUNE='{"bodyTurn":1e9}'
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const PRINT = process.argv.includes('--print');
const head = [];
const tan = [];
const upr = [];
const ang = (a, b) => (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;
const nrm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
for (const sec of [5, 6]) {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const L = new Level3D(LEVEL_DATA_3D, DIFFICULTY.normal.levelVariant);
    const c = new Creature3D(L, DIFFICULTY.normal, new EventBus(), { seed });
    const cp = L.sections[sec].checkpoint;
    const p = { x: cp.x, y: cp.y, z: cp.z, vx: 0, vy: 0, vz: 0, alive: true, grounded: true };
    c.reset(p);
    c.setSection(sec, L.sections[sec], p);
    c.lethal = false; // it hunts and presses in, but never strikes: the player stays in the small volume
    let prev = null;
    for (let i = 0; i < 45 * 60; i++) {
      const t = i / 60;
      const nx = cp.x + Math.sin(t * 1.3) * 3 + Math.sin(t * 0.6) * 2;
      const nz = cp.z + Math.cos(t * 0.9) * 3;
      p.vx = (nx - p.x) * 60;
      p.vz = (nz - p.z) * 60;
      p.vy = 0;
      p.x = nx;
      p.z = nz;
      p.y = cp.y - 4 - Math.sin(t * 0.4) * 1.5;
      c.update(1 / 60, p, t);
      if (!c.inPlay || !c.body.visible || c.distance > 16) {
        prev = null;
        continue;
      }
      const sp = c.body.spine;
      const up = c.body.up;
      const cur = { h: [c.hx, c.hy, c.hz], hp: [sp[0], sp[1], sp[2]], tan: [], up: [] };
      for (let k = 3; k < SEG - 2; k++) {
        cur.tan.push(nrm([sp[(k + 1) * 3] - sp[(k - 1) * 3], sp[(k + 1) * 3 + 1] - sp[(k - 1) * 3 + 1], sp[(k + 1) * 3 + 2] - sp[(k - 1) * 3 + 2]]));
        cur.up.push([up[k * 3], up[k * 3 + 1], up[k * 3 + 2]]);
      }
      if (prev && Math.hypot(cur.hp[0] - prev.hp[0], cur.hp[1] - prev.hp[1], cur.hp[2] - prev.hp[2]) < 9) {
        head.push(ang(prev.h, cur.h) * 60);
        for (let k = 0; k < cur.tan.length; k++) {
          tan.push(ang(prev.tan[k], cur.tan[k]) * 60);
          upr.push(ang(prev.up[k], cur.up[k]) * 60);
        }
      }
      prev = cur;
    }
  }
}
const pct = (a, q) => {
  const s = Float64Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] || 0;
};
const share = (a, lim) => a.filter((v) => v > lim).length / Math.max(1, a.length);
const rep = (n, a) => `${n} p99 ${pct(a, 0.99).toFixed(0)}  p95 ${pct(a, 0.95).toFixed(0)} deg/s  max ${a.reduce((m, v) => (v > m ? v : m), 0).toFixed(0)}  >150: ${(share(a, 150) * 100).toFixed(2)} %`;
console.log(`frames ${head.length}`);
console.log(rep('head', head));
console.log(rep('tan ', tan));
console.log(rep('up  ', upr));
ok(head.length > 2000, 'enough chase frames near the player');
if (!PRINT) {
  // before the lock: facing >150 deg/s in 3.4 % of frames, block tangents >150 deg/s in 2.1 % with spikes to 6000 deg/s
  ok(pct(head, 0.99) < 200, `the facing turns calmly (p99 ${pct(head, 0.99).toFixed(0)} deg/s)`);
  ok(pct(tan, 0.99) < 200, `block tangents turn calmly (p99 ${pct(tan, 0.99).toFixed(0)} deg/s)`);
  ok(pct(upr, 0.99) < 175, `block ups are locked (p99 ${pct(upr, 0.99).toFixed(0)} deg/s, the cap is 172)`);
  ok(share(tan, 150) < 0.018, `under 1.8 % of block-frames twist faster than 150 deg/s (${(share(tan, 150) * 100).toFixed(2)} %)`);
  ok(tan.reduce((m, v) => (v > m ? v : m), 0) < 3000, 'no block tangent spikes past 3000 deg/s');
}
console.log(fails ? `FAILED: ${fails}` : 'ALL TWIST CHECKS PASS');
process.exit(fails ? 1 : 0);
