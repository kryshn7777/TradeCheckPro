// Heap allocation per Creature3D.update (sampling heap profiler; the sim must not allocate per frame).
//   node allocprof.mjs [--root DIR]
import inspector from 'node:inspector/promises';
import { srcUrl } from '../../verify/root.mjs';
import { makeShaftData } from './stubShaft.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { DIFFICULTY, EventBus, U } = await import(srcUrl('sim/config3d.js'));
const { Creature3D } = await import(srcUrl('sim/creature3d.js'));
const lv = new Level3D(makeShaftData(), 'normal');
const c = new Creature3D(lv, DIFFICULTY.normal, new EventBus(), { seed: 11 });
const rand = U.rng(5);
const player = { x: 0, y: -232, z: 0, vx: 0, vy: 0, vz: 0, alive: true };
c.reset(player);
let tx = 0, ty = -232, tz = 0, timer = 0;
const dt = 1 / 72;
function step(i) {
  timer -= dt;
  if (timer <= 0) { timer = 4 + rand() * 3; tx = U.clamp(tx + (rand() - 0.5) * 16, -12, 12); tz = U.clamp(tz + (rand() - 0.5) * 16, -12, 12); ty = Math.max(-550, ty - 8 - rand() * 6); }
  const ox = player.x, oy = player.y, oz = player.z;
  player.x += (tx - player.x) * Math.min(1, dt * 1.5); player.y += (ty - player.y) * Math.min(1, dt * 1.5); player.z += (tz - player.z) * Math.min(1, dt * 1.5);
  player.vx = (player.x - ox) / dt; player.vy = (player.y - oy) / dt; player.vz = (player.z - oz) / dt;
  c.update(dt, player, i * dt);
  c.caughtPlayer = false;
}
for (let i = 0; i < 3000; i++) step(i); // warm-up
const session = new inspector.Session();
session.connect();
await session.post('HeapProfiler.startSampling', { samplingInterval: 512, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
for (let i = 3000; i < 13000; i++) step(i);
const { profile } = await session.post('HeapProfiler.stopSampling');
const agg = {};
let total = 0;
(function walk(node, path) {
  const fn = (node.callFrame.functionName || '(anon)') + ':' + node.callFrame.url.split('/').pop() + ':' + node.callFrame.lineNumber;
  if (node.selfSize) { agg[fn] = (agg[fn] || 0) + node.selfSize; total += node.selfSize; }
  for (const ch of node.children || []) walk(ch, path);
})(profile.head, '');
console.log('total sampled', (total / 1024).toFixed(0), 'KB over 10000 updates =', (total / 10000).toFixed(0), 'B/update');
console.log(Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => (v / 1024).toFixed(1) + 'KB ' + k).join('\n'));
