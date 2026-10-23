// The Mason is annoyed by grapple shots that pass through its body (Node): 1.5x its speed for 3 s, 6x for the first 0.3 s, at most once per
// 20 s; a shot that misses, or one at a small variant, changes nothing. The sim reads the aim ray from the bus event 'rope:shot'
// (physics3d.fire emits it for every trigger pull).
//   node annoy.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Creature3D, CREATURE_TUNING } = await import(srcUrl('sim/creature3d.js'));
const { Player3D, TetherSystem } = await import(srcUrl('sim/physics3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const A = CREATURE_TUNING.annoy;
ok(A.dur === 3 && A.mul === 1.5 && A.burstDur === 0.3 && A.burstMul === 6 && A.cooldown === 20, 'tuning: 1.5x for 3 s, 6x for 0.3 s, every 20 s');

const SEC = 5;
function make(seed, variant) {
  const L = new Level3D(LEVEL_DATA_3D, DIFFICULTY.normal.levelVariant);
  const bus = new EventBus();
  const events = [];
  bus.on('creature:annoyed', (e) => events.push(e));
  bus.on('creature:call', (e) => e.annoyed && events.push({ call: e }));
  const c = new Creature3D(L, DIFFICULTY.normal, bus, { seed, variant });
  const cp = L.sections[SEC].checkpoint;
  const p = { x: cp.x, y: cp.y, z: cp.z, vx: 0, vy: 0, vz: 0, alive: true, grounded: false };
  c.reset(p);
  c.setSection(SEC, L.sections[SEC], p);
  return { L, bus, c, p, events, t: 0 };
}
function run(w, secs) {
  for (let i = 0; i < Math.round(secs * 60); i++) {
    w.t += 1 / 60;
    w.c.update(1 / 60, w.p, w.t);
    if (w.c.caughtPlayer) w.c.reset(w.p);
  }
}
/** Brings it in range of the hook and returns the ray from the player through spine point k. */
function ray(w, k, off = 0) {
  const sp = w.c.body.spine;
  let dx = sp[k * 3] - w.p.x + off;
  let dy = sp[k * 3 + 1] - w.p.y;
  let dz = sp[k * 3 + 2] - w.p.z;
  const l = Math.hypot(dx, dy, dz);
  return { hand: 'right', ox: w.p.x, oy: w.p.y, oz: w.p.z, dx: dx / l, dy: dy / l, dz: dz / l, range: 32 };
}
function approach(w) {
  for (let i = 0; i < 60 * 40 && !(w.c.inPlay && w.c.distance < 26 && w.c.distance > 8); i++) run(w, 1 / 60);
  w.c.lethal = false; // it hunts but never strikes: the player stays alive while the shots are timed
  return w.c.inPlay && w.c.distance < 28;
}

{
  const w = make(5);
  ok(approach(w), 'the Mason comes into hook range');
  const miss = ray(w, 3);
  miss.dy = -miss.dy;
  miss.dx = -miss.dx;
  miss.dz = -miss.dz; // the other way
  w.bus.emit('rope:shot', miss);
  ok(w.events.length === 0 && !w.c.annoyed, 'a shot away from it changes nothing');
  w.bus.emit('rope:shot', ray(w, 3));
  ok(w.c.annoyed && w.c.annoyCount === 1 && w.events.some((e) => e.dur === 3), 'a shot through the body annoys it (event creature:annoyed, roar call)');
  ok(w.c.annoyMul === 6, 'x6 at the start');
  run(w, 0.35);
  ok(w.c.annoyMul === 1.5, 'x1.5 after 0.3 s');
  run(w, 2.7);
  ok(w.c.annoyMul === 1 && !w.c.annoyed, 'calm again after 3 s');
  const n = w.c.annoyCount;
  w.bus.emit('rope:shot', ray(w, 3));
  ok(w.c.annoyCount === n, 'no second time inside the 20 s cooldown');
  run(w, 17.5);
  w.bus.emit('rope:shot', ray(w, 3));
  ok(w.c.annoyCount === n + 1, 'provoked again once 20 s have passed since the first shot');
}
{
  // speed: the same run with and without the shot (same seed, still player)
  const a = make(11);
  const b = make(11);
  approach(a);
  approach(b);
  run(a, 0.0);
  const path = (w, secs) => {
    let L = 0;
    let px = w.c.x;
    let py = w.c.y;
    let pz = w.c.z;
    for (let i = 0; i < Math.round(secs * 60); i++) {
      w.t += 1 / 60;
      w.c.update(1 / 60, w.p, w.t);
      L += Math.hypot(w.c.x - px, w.c.y - py, w.c.z - pz);
      px = w.c.x;
      py = w.c.y;
      pz = w.c.z;
      if (w.c.caughtPlayer) break;
    }
    return { L, nan: !isFinite(w.c.x + w.c.y + w.c.z) };
  };
  a.bus.emit('rope:shot', ray(a, 3));
  const pa = path(a, 1);
  const pb = path(b, 1);
  ok(!pa.nan && !pb.nan, 'no NaN');
  ok(pa.L > pb.L * 1.4, `it covers more ground while annoyed (${pa.L.toFixed(1)} m against ${pb.L.toFixed(1)} m calm in the first second)`);
}
{
  // the small variants ignore it (they are not linked to the shot, and _onShot refuses)
  const w = make(3, 'skitterling');
  run(w, 8);
  w.c._onShot({ ox: w.p.x, oy: w.p.y, oz: w.p.z, dx: 0, dy: 1, dz: 0, range: 32 });
  ok(w.c.annoyCount === 0, 'a skitterling is not annoyed');
}
{
  // a respawn clears it
  const w = make(5);
  approach(w);
  w.bus.emit('rope:shot', ray(w, 3));
  w.c.onRespawn(w.p);
  ok(!w.c.annoyed && w.c._annoyCd === 0, 'a respawn clears the annoyance and the cooldown');
}
{
  // the real trigger pull: TetherSystem.fire puts the normalised aim ray and the hook range on the bus, found target or not
  const L = new Level3D(LEVEL_DATA_3D, DIFFICULTY.normal.levelVariant);
  const bus = new EventBus();
  const shots = [];
  bus.on('rope:shot', (e) => shots.push(e));
  const ph = new TetherSystem(L, DIFFICULTY.normal, bus, {});
  const pl = new Player3D(-4, 0.4, 8.5);
  ph.fire(pl, 'right', { ox: 1, oy: 2, oz: 3, dx: 0, dy: 0, dz: -5 });
  ok(shots.length === 1 && Math.abs(shots[0].dz + 1) < 1e-9 && shots[0].range === DIFFICULTY.normal.aimRange && shots[0].ox === 1, 'TetherSystem.fire emits rope:shot with the normalised aim ray and the range');
}
console.log(fails ? `FAILED: ${fails}` : 'ALL ANNOY CHECKS PASS');
process.exit(fails ? 1 : 0);
