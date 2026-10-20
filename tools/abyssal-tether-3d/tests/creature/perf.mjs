// Creature3D.update cost per call (µs) on a scripted descent of the stub shaft.
//   node perf.mjs [--root DIR]
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
const times = new Float64Array(72 * 240); let ti = 0;
for (let i = 0; i < 72 * 240; i++) {
  timer -= dt;
  if (timer <= 0) { timer = 4 + rand() * 3; tx = U.clamp(tx + (rand() - 0.5) * 16, -12, 12); tz = U.clamp(tz + (rand() - 0.5) * 16, -12, 12); ty = Math.max(-550, ty - 8 - rand() * 6); }
  const ox = player.x, oy = player.y, oz = player.z;
  player.x += (tx - player.x) * Math.min(1, dt * 1.5); player.y += (ty - player.y) * Math.min(1, dt * 1.5); player.z += (tz - player.z) * Math.min(1, dt * 1.5);
  player.vx = (player.x - ox) / dt; player.vy = (player.y - oy) / dt; player.vz = (player.z - oz) / dt;
  const t0 = performance.now();
  c.update(dt, player, i * dt);
  times[ti++] = performance.now() - t0;
  c.caughtPlayer = false;
}
const s = Array.from(times.slice(500)).sort((a, b) => a - b);
console.log('µs p50', (s[s.length >> 1] * 1000).toFixed(1), 'p99', (s[Math.floor(s.length * 0.99)] * 1000).toFixed(1), 'max ms', s[s.length - 1].toFixed(2), 'mean µs', (s.reduce((a, b) => a + b, 0) / s.length * 1000).toFixed(1));
