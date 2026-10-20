// Surface-following / body / limb invariants + per-update cost on a careful Normal descent
// (report: distances, link-length error, planted limbs, NaNs).
//   node invariants.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
import { makeShaftData } from './stubShaft.mjs';
import { PROFILES } from './pacing.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { DIFFICULTY, EventBus, U } = await import(srcUrl('sim/config3d.js'));
const { Creature3D, SEG, CREATURE_TUNING: T } = await import(srcUrl('sim/creature3d.js'));

const lv = new Level3D(makeShaftData(), 'normal');
const bus = new EventBus();
const c = new Creature3D(lv, DIFFICULTY.normal, bus, { seed: 11 });
const scratch = [];
function surfDist(x, y, z, structuralOnly) {
  const r = 30;
  const list = lv.querySolids(x - r, y - r, z - r, x + r, y + r, z + r, scratch);
  let best = Infinity;
  for (const s of list) {
    if (s.active === false) continue;
    if (structuralOnly && !(s.kind === 'wall' || s.kind === 'pillar')) continue;
    const cx = U.clamp(x, s.minX, s.maxX), cy = U.clamp(y, s.minY, s.maxY), cz = U.clamp(z, s.minZ, s.maxZ);
    const d = Math.hypot(x - cx, y - cy, z - cz);
    const inside = d === 0;
    best = Math.min(best, inside ? -1 : d);
  }
  return best;
}
// Simple descending player: moves down 10 m every 4 s along random lateral spots.
const rand = U.rng(5);
const player = { x: 0, y: -232, z: 0, vx: 0, vy: 0, vz: 0, alive: true };
c.reset(player);
let tx = 0, ty = -232, tz = 0, timer = 0;
const dt = 1 / 72;
const stats = { crawlSamples: 0, crawlDist: [], segInside: 0, segSamples: 0, spacingErr: 0, planted: 0, limbSamples: 0, overReach: 0, nan: 0, swingSamples: 0 };
let cost = 0, n = 0, maxCost = 0;
for (let i = 0; i < 72 * 240; i++) {
  timer -= dt;
  if (timer <= 0) { timer = 4 + rand() * 3; tx = U.clamp(tx + (rand() - 0.5) * 16, -12, 12); tz = U.clamp(tz + (rand() - 0.5) * 16, -12, 12); ty = Math.max(-550, ty - 8 - rand() * 6); }
  const ox = player.x, oy = player.y, oz = player.z;
  player.x += (tx - player.x) * Math.min(1, dt * 1.5); player.y += (ty - player.y) * Math.min(1, dt * 1.5); player.z += (tz - player.z) * Math.min(1, dt * 1.5);
  player.vx = (player.x - ox) / dt; player.vy = (player.y - oy) / dt; player.vz = (player.z - oz) / dt;
  const t0 = process.hrtime.bigint();
  c.update(dt, player, i * dt);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  if (i > 200) { cost += ms; n++; if (ms > maxCost) { maxCost = ms; globalThis.maxInfo = `frame ${i} state ${c.state} inPlay ${c.inPlay} d ${c.distance.toFixed(1)} y ${c.y.toFixed(1)} py ${player.y.toFixed(1)}`; }  }
  if (c.caughtPlayer) { c.caughtPlayer = false; }
  if (!c.inPlay) continue;
  const B = c.body;
  for (const v of B.spine) if (!isFinite(v)) stats.nan++;
  const swing = 1 - U.smoothstep(T.swingNear, T.swingFar, c.distance);
  if ((c.state === 'APPROACHING' || c.state === 'PURSUING' || c.state === 'RECOVERING') && swing < 0.05 && !c.creeping) {
    stats.crawlSamples++;
    stats.crawlDist.push(surfDist(c.x, c.y, c.z, true));
  }
  for (let s = 1; s < SEG; s++) {
    const d = surfDist(B.spine[s * 3], B.spine[s * 3 + 1], B.spine[s * 3 + 2], false);
    stats.segSamples++;
    if (d < 0) stats.segInside++;
    const l = Math.hypot(B.spine[s * 3] - B.spine[s * 3 - 3], B.spine[s * 3 + 1] - B.spine[s * 3 - 2], B.spine[s * 3 + 2] - B.spine[s * 3 - 1]);
    const want = T.spacing * 0.5 * (B.scale[s] + B.scale[s - 1]);
    if (s > 1) { const e = Math.abs(l - want) / want; stats.errs = stats.errs || []; stats.errs.push(e); stats.spacingErr = Math.max(stats.spacingErr, e); }
  }
  for (const L of B.limbs) {
    stats.limbSamples++;
    if (L.planted) {
      stats.planted++;
      const dd = Math.hypot(L.foot.x - L.hip.x, L.foot.y - L.hip.y, L.foot.z - L.hip.z);
      if (dd > L.reach * 1.25) stats.overReach++;
      // signed distance of the planted hook to the nearest solid surface (negative = bitten in)
      const list = lv.querySolids(L.foot.x - 2, L.foot.y - 2, L.foot.z - 2, L.foot.x + 2, L.foot.y + 2, L.foot.z + 2, scratch);
      let best = Infinity;
      for (const s of list) {
        const inside = L.foot.x > s.minX && L.foot.x < s.maxX && L.foot.y > s.minY && L.foot.y < s.maxY && L.foot.z > s.minZ && L.foot.z < s.maxZ;
        let d;
        if (inside) d = -Math.min(L.foot.x - s.minX, s.maxX - L.foot.x, L.foot.y - s.minY, s.maxY - L.foot.y, L.foot.z - s.minZ, s.maxZ - L.foot.z);
        else d = Math.hypot(L.foot.x - U.clamp(L.foot.x, s.minX, s.maxX), L.foot.y - U.clamp(L.foot.y, s.minY, s.maxY), L.foot.z - U.clamp(L.foot.z, s.minZ, s.maxZ));
        if (Math.abs(d) < Math.abs(best)) best = d;
      }
      stats.footD = stats.footD || [];
      stats.footD.push(best); stats.reachR = stats.reachR || []; stats.reachR.push(dd / L.reach);
    }
  }
}
const cd = stats.crawlDist.sort((a, b) => a - b);
const q = (p) => cd[Math.floor(p * (cd.length - 1))];
console.log('crawling head distance to wall/pillar surface (hug target', T.hug, 'm): p10', q(0.1).toFixed(2), 'median', q(0.5).toFixed(2), 'p90', q(0.9).toFixed(2), 'samples', cd.length);
console.log('spine points inside a solid:', (100 * stats.segInside / stats.segSamples).toFixed(2) + '%');
const es = stats.errs.sort((a,b)=>a-b); console.log('link-length error (segments 2..19): p50', (100*es[es.length>>1]).toFixed(1)+'%', 'p99', (100*es[Math.floor(es.length*0.99)]).toFixed(1)+'%', 'max', (100 * stats.spacingErr).toFixed(1) + '%');
console.log('limbs planted:', (100 * stats.planted / stats.limbSamples).toFixed(1) + '%', 'planted beyond 1.25×reach:', stats.overReach);
const rr = stats.reachR.sort((a,b)=>a-b); console.log('planted foot-hip / reach: p50', rr[rr.length>>1].toFixed(2), 'p95', rr[Math.floor(rr.length*0.95)].toFixed(2), 'p99', rr[Math.floor(rr.length*0.99)].toFixed(2)); const fd = stats.footD.sort((a,b)=>a-b); console.log('planted hook distance to nearest surface (m): p1', fd[Math.floor(fd.length*0.01)].toFixed(3), 'p50', fd[fd.length>>1].toFixed(3), 'p99', fd[Math.floor(fd.length*0.99)].toFixed(3), 'beyond 0.3 m:', (100*fd.filter(v=>v>0.3).length/fd.length).toFixed(2)+'%'); console.log('NaN values:', stats.nan);
console.log(globalThis.maxInfo); console.log(`update cost: mean ${(cost / n * 1000).toFixed(1)} µs, max ${(maxCost).toFixed(3)} ms`);
console.log('stats', c.stats);
