// Health and fall damage checks (Node): the damage curve per difficulty, the hit cooldown, regeneration,
// events, difficulty scaling, determinism, the heartbeat, and the Physics3D integration on the real level
// (drops from known heights, hazards, the lethal speed still killing).
//   node unit.mjs [--root DIR]   (prints PASS/FAIL per check, exit 1 on a failure)
import { srcUrl } from '../../verify/root.mjs';
const { CONFIG, DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Health3D, fallDamage, wallDamage, heartRate, dropSpeed, dropHeight } = await import(srcUrl('sim/health3d.js'));
const { Player3D, TetherSystem, Physics3D } = await import(srcUrl('sim/physics3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const H = CONFIG.health;
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const mk = (key = 'normal') => {
  const bus = new EventBus();
  const ev = [];
  for (const t of ['health:damage', 'health:low', 'health:recover']) bus.on(t, (p) => ev.push([t, p]));
  return { h: new Health3D(DIFFICULTY[key], bus), bus, ev };
};
const ticks = (h, secs, dt = 1 / 240) => {
  const n = Math.round(secs / dt);
  for (let i = 0; i < n; i++) h.step(dt);
};

// 1. The damage curve per difficulty: zero at / below the threshold, convex and monotonic, 1 at the lethal speed.
{
  let good = true;
  const rows = [];
  for (const k of Object.keys(DIFFICULTY)) {
    const d = DIFFICULTY[k];
    const t = d.health.fallThreshold;
    const L = d.lethalImpact;
    if (fallDamage(t * L, L, t) !== 0 || fallDamage(t * L * 0.5, L, t) !== 0 || fallDamage(0, L, t) !== 0) good = false;
    if (fallDamage(L, L, t) !== 1 || fallDamage(L * 1.7, L, t) !== 1) good = false;
    let prev = 0;
    let prevSlope = 0;
    for (let s = t * L; s <= L; s += L / 200) {
      const v = fallDamage(s, L, t);
      const slope = v - prev;
      if (v < prev - 1e-12 || slope < prevSlope - 1e-9) good = false; // monotonic and convex
      prev = v;
      prevSlope = slope;
    }
    rows.push(`${k}: ${[2, 4, 6, 8, 10].map((m) => `${m} m ${(fallDamage(dropSpeed(m), L, t) * 100).toFixed(0)}`).join(', ')}`);
  }
  ok(good, 'fall damage: 0 up to the threshold, convex + monotonic, 1 at the lethal speed (' + rows.join(' | ') + ')');
  const t = DIFFICULTY.normal.health.fallThreshold;
  const L = DIFFICULTY.normal.lethalImpact;
  ok(t > 0.3 && t < 0.4 && near(fallDamage(0.675 * L, L, t), 0.25, 1e-9), 'normal curve: threshold ~35 % of lethal, a 67.5 % landing costs 25 hp');
  ok(dropSpeed(0) === 0 && near(dropHeight(dropSpeed(7)), 7, 1e-9), 'drop height <-> speed helpers agree');
}
// 2. Wall impacts: gentler than floor impacts, capped, zero below half the lethal speed.
{
  const L = 17;
  let gentler = true;
  for (let s = 0; s <= 40; s += 0.5) if (wallDamage(s, L) > fallDamage(s, L, 0.35) + 1e-12 && s < L) gentler = false;
  ok(gentler && wallDamage(0.49 * L, L) === 0 && wallDamage(L, L) > 0.3 && wallDamage(L, L) < 0.6 && wallDamage(100, L) <= H.wallCap, 'wall damage: below the floor curve, 0 under 50 %, capped (' + wallDamage(L, L).toFixed(2) + ' at lethal, ' + wallDamage(100, L).toFixed(2) + ' max)');
}
// 3. Landing events, low / recover hysteresis.
{
  const { h, ev } = mk();
  h.landing(dropSpeed(5));
  const d = ev.find((e) => e[0] === 'health:damage');
  ok(d && d[1].cause === 'fall' && d[1].amount > 0.2 && d[1].amount < 0.3 && near(d[1].hp, 1 - d[1].amount) && !d[1].lethal && d[1].speed > 10, 'landing emits health:damage {amount, hp, cause fall, speed}');
  ok(!h.low && !ev.some((e) => e[0] === 'health:low'), 'no low state at 75 hp');
  ticks(h, 0.5);
  h.landing(dropSpeed(6)); // -> ~37 hp
  const dead = h.landing(dropSpeed(6)); // within cooldown: same landing, no extra
  ok(!dead && !h.low, 'second landing inside the cooldown adds nothing');
  ticks(h, 1);
  const before = h.hp;
  h.landing(dropSpeed(3));
  ok(h.hp < before && h.hp <= H.lowEnter && h.low && ev.filter((e) => e[0] === 'health:low').length === 1, 'crossing 35 hp emits health:low once (hp ' + (h.hp * 100).toFixed(0) + ')');
  ticks(h, 6.2 + 0.05); // regen starts after the delay
  ok(h.hp > before - 0.1 && h.low === (h.hp < H.lowExit), 'hysteresis: still low below 50 hp');
  ticks(h, 20);
  ok(!h.low && h.hp === 1 && ev.filter((e) => e[0] === 'health:recover').length === 2 && ev[ev.length - 1][1].full === true, 'regen to full: health:recover at 50 hp and at full');
}
// 4. Cooldown: one landing counted once; a bigger second hit pays only the excess; after the window it adds up.
{
  const { h } = mk();
  h.landing(dropSpeed(5)); // ~26
  const a = 1 - h.hp;
  h.landing(dropSpeed(5)); // same again inside the window
  ok(near(1 - h.hp, a), 'same landing twice in 0.35 s: damage once');
  h.landing(dropSpeed(7)); // bigger: pays the difference
  const b = fallDamage(dropSpeed(7), 17, 0.35);
  ok(near(1 - h.hp, b, 1e-9), 'a bigger hit in the window pays the excess only (total = the larger hit)');
  ticks(h, H.hitCooldown + 0.01);
  const hp0 = h.hp;
  h.landing(dropSpeed(5));
  ok(near(hp0 - h.hp, a, 1e-9), 'after the cooldown the next landing counts in full');
}
// 5. Regeneration: delay, rate, damage resets the delay; Nightmare slower, Abyss slower still; Sandbox takes no fall damage.
{
  const regenTime = (key) => {
    const { h } = mk(key);
    h.damage(0.5, 'fall', 10);
    ticks(h, h.regenDelay - 0.05);
    const still = h.hp === 0.5;
    ticks(h, 0.1 + 1);
    return { still, gained: h.hp - 0.5, rate: h.regenRate, delay: h.regenDelay };
  };
  const n = regenTime('normal');
  const m = regenTime('nightmare');
  const a = regenTime('abyss');
  ok(n.still && m.still && a.still, 'no regeneration during the delay');
  ok(near(n.gained, n.rate * 1.05, 1e-3) && n.delay === 6 && n.rate === 0.05, 'normal: 6 s calm, then 5 hp/s');
  ok(n.rate > m.rate && m.rate > a.rate && n.delay < m.delay && m.delay < a.delay, 'regen scales with difficulty: slower and later on Nightmare and Abyss');
  const { h } = mk();
  h.damage(0.5, 'fall', 10);
  ticks(h, 5);
  h.damage(0.05, 'fall', 8);
  ticks(h, 5);
  ok(h.hp === 0.45, 'damage restarts the calm period');
}
// 6. Difficulty scaling of the damage itself: lower lethal speed + lower threshold -> more damage for the same fall.
{
  const at = (k, m) => fallDamage(dropSpeed(m), DIFFICULTY[k].lethalImpact, DIFFICULTY[k].health.fallThreshold);
  ok(at('normal', 6) < at('nightmare', 6) && at('nightmare', 6) < at('abyss', 6) && at('normal', 2) <= at('abyss', 2), 'the same drop hurts more on Nightmare and Abyss');
  const { h } = mk('sandbox');
  ok(h.landing(30) === false && h.wallHit(30) === false && h.hp === 1, 'sandbox: no fall or wall damage');
  ok(h.hazardHit() === true, 'sandbox: hazards stay deadly');
  const ab = mk('abyss').h;
  ok(ab.hazardHit() === true && ab.hp === 0, 'abyss: a hazard is death (damage 1)');
  const nm = mk('nightmare').h;
  const no = mk('normal').h;
  no.hazardHit();
  nm.hazardHit();
  ok(near(no.hp, 0.4) && near(nm.hp, 0.25), 'hazard damage: 60 hp Normal, 75 hp Nightmare');
}
// 7. Hazards: heavy damage, a cooldown, then death on the repeat (or when hp runs out).
{
  const { h, ev } = mk();
  ok(h.hazardHit() === false && near(h.hp, 0.4) && ev[0][1].cause === 'hazard', 'hazard: 60 hp, alive');
  ticks(h, 0.5);
  ok(h.hazardHit() === false && near(h.hp, 0.4), 'hazard: ignored inside its 1.2 s cooldown');
  ticks(h, 0.8);
  ok(h.hazardHit() === true && h.hp === 0, 'hazard repeat after the cooldown: dead');
  const g = mk().h;
  g.god = true;
  ok(g.hazardHit() === false && g.landing(30) === false && g.hp === 1, 'god: no damage');
}
// 8. Death flag, reset, lethal speed, determinism, snapshot.
{
  const { h } = mk();
  ok(h.landing(17) === true && h.hp === 0 && h.lastDamage.cause === 'fall', 'the lethal speed kills from full health');
  const m2 = mk('nightmare').h;
  ok(m2.landing(15.5) === true, 'nightmare lethal speed kills');
  h.die();
  ok(h.dead && h.heartbeatRate === 0, 'dead: heartbeat 0 (flatline)');
  ticks(h, 30);
  ok(h.hp === 0 && h.dead, 'the dead do not regenerate');
  h.reset();
  ok(h.hp === 1 && !h.dead && !h.low && h.totalDamage === 0 && h.heartbeatRate === H.bpmCalm, 'reset: full health, flags and statistics cleared');
  const run = () => {
    const x = mk('nightmare').h;
    const out = [];
    const rng = [4, 9, 2, 7, 11, 5, 3, 8];
    for (let i = 0; i < 8; i++) {
      ticks(x, 2.3 + i * 0.7);
      x.landing(rng[i] + 1.5);
      out.push(x.snapshot().join(','));
    }
    return out.join('|');
  };
  ok(run() === run(), 'deterministic: the same inputs give identical states');
  const s = mk().h;
  s.damage(0.3, 'fall', 9);
  ticks(s, 1);
  const snap = s.snapshot();
  const hp = s.hp;
  s.damage(0.4, 'fall', 9);
  ticks(s, 3);
  s.restore(snap);
  ok(s.hp === hp && s.hits === 1 && s.sinceHurt === snap[5], 'snapshot / restore round-trips');
}
// 9. Heartbeat: 60 bpm calm -> ~140 near zero, monotonic in hp; adrenaline after a hit.
{
  let mono = true;
  let prev = 0;
  for (let hp = 1; hp >= 0; hp -= 0.01) {
    const r = heartRate(hp);
    if (r < prev - 1e-9) mono = false;
    prev = r;
  }
  ok(heartRate(1) === 60 && heartRate(0) === 140 && mono && heartRate(0.35) > 85 && heartRate(0.35) < 115, `heartbeat 60 -> 140 bpm (35 hp: ${heartRate(0.35).toFixed(0)} bpm)`);
  const { h } = mk();
  h.damage(0.05, 'fall', 7);
  ok(h.heartbeatRate > 68, 'a hit raises the heart rate (adrenaline): ' + h.heartbeatRate.toFixed(0) + ' bpm');
  ticks(h, 6);
  ok(h.heartbeatRate < 61.5, 'and it settles again');
}

// 10. Physics3D integration on the real level: drops from known heights onto the spawn ledge.
{
  const drop = (key, metres, opts = {}) => {
    const diff = DIFFICULTY[key];
    const level = new Level3D(undefined, diff.levelVariant);
    const bus = new EventBus();
    const events = [];
    for (const t of ['health:damage', 'player:death', 'player:land']) bus.on(t, (p) => events.push([t, p]));
    const tethers = new TetherSystem(level, diff, bus, {});
    const physics = new Physics3D(level, diff, bus);
    const sp = level.spawn;
    const p = new Player3D(sp.x, sp.y, sp.z);
    for (let i = 0; i < 480; i++) physics.step(p, tethers, {}, CONFIG.PHYSICS_DT); // settle on the ledge
    const restY = p.y;
    if (opts.settleOnly) return { p, physics, events, restY };
    p.y = restY + metres;
    p.prevY = p.y;
    for (let i = 0; i < 480 * 2 && p.alive; i++) {
      physics.step(p, tethers, {}, CONFIG.PHYSICS_DT);
      if (p.grounded && i > 20) break;
    }
    return { p, physics, events, restY };
  };
  const s0 = drop('normal', 0, { settleOnly: true });
  ok(s0.p.alive && s0.p.grounded && s0.physics.health.hp === 1 && s0.events.every((e) => e[0] !== 'health:damage'), 'standing on the spawn ledge: no damage');
  const table = [];
  let prev = 1;
  let mono = true;
  for (const m of [0.5, 1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const r = drop('normal', m);
    const hp = r.physics.health.hp;
    table.push(`${m} m ${((1 - hp) * 100).toFixed(0)}`);
    if (hp > prev + 1e-12) mono = false;
    prev = hp;
    if (!r.p.alive) mono = false;
  }
  ok(mono && table.length === 10, 'normal drops (hp lost): ' + table.join(', '));
  const small = drop('normal', 0.5);
  const mid = drop('normal', 5);
  const big = drop('normal', 8);
  ok(small.physics.health.hp === 1 && mid.physics.health.hp < 0.8 && mid.physics.health.hp > 0.6 && big.physics.health.hp < 0.45 && big.p.alive, 'a hop is free, 5 m costs ~25 hp, 8 m costs ~60 hp');
  const dead = drop('normal', 14);
  const deathEv = dead.events.find((e) => e[0] === 'player:death');
  ok(!dead.p.alive && deathEv && deathEv[1].cause === 'impact' && dead.physics.health.dead && dead.physics.health.hp === 0, 'a 14 m fall still kills (cause impact)');
  const nmDead = drop('nightmare', 11);
  ok(!nmDead.p.alive, 'nightmare: an 11 m fall (lethal at 15.5 m/s) kills');
  const sand = drop('sandbox', 20);
  ok(sand.p.alive && sand.physics.health.hp === 1, 'sandbox: a 20 m fall is survivable');
  // Cumulative: three 6 m drops with no calm period between them kill.
  const diff = DIFFICULTY.normal;
  const level = new Level3D(undefined, 'normal');
  const bus = new EventBus();
  const tethers = new TetherSystem(level, diff, bus, {});
  const physics = new Physics3D(level, diff, bus);
  const sp = level.spawn;
  const p = new Player3D(sp.x, sp.y, sp.z);
  for (let i = 0; i < 480; i++) physics.step(p, tethers, {}, CONFIG.PHYSICS_DT);
  const restY = p.y;
  let drops = 0;
  while (p.alive && drops < 6) {
    p.y = restY + 6;
    p.prevY = p.y;
    p.grounded = false;
    for (let i = 0; i < 960 && p.alive; i++) {
      physics.step(p, tethers, {}, CONFIG.PHYSICS_DT);
      if (p.grounded && i > 20) break;
    }
    for (let i = 0; i < 120 && p.alive; i++) physics.step(p, tethers, {}, CONFIG.PHYSICS_DT);
    drops++;
  }
  ok(!p.alive && drops >= 2 && drops <= 4 && p.deathCause === 'impact', `damage accumulates: dead after ${drops} drops of 6 m`);
}
// 11. Hazards through Physics3D: heavy damage, then death on the repeat; creature kill flags the death.
{
  const diff = DIFFICULTY.normal;
  const level = new Level3D(undefined, 'normal');
  const hz = level.hazards.find((z) => z.active !== false);
  const bus = new EventBus();
  const tethers = new TetherSystem(level, diff, bus, {});
  const physics = new Physics3D(level, diff, bus);
  const p = new Player3D((hz.minX + hz.maxX) / 2, (hz.minY + hz.maxY) / 2, (hz.minZ + hz.maxZ) / 2);
  p.vy = 0;
  const hold = (n) => {
    for (let i = 0; i < n && p.alive; i++) {
      p.x = (hz.minX + hz.maxX) / 2;
      p.y = (hz.minY + hz.maxY) / 2;
      p.z = (hz.minZ + hz.maxZ) / 2;
      p.vx = p.vy = p.vz = 0;
      physics.step(p, tethers, {}, CONFIG.PHYSICS_DT);
    }
  };
  hold(10);
  ok(p.alive && near(physics.health.hp, 0.4), `a hazard (${hz.kind}) costs 60 hp and the player lives`);
  hold(240 * 0.5);
  ok(p.alive && near(physics.health.hp, 0.4), 'standing in it does not hit again inside 1.2 s');
  hold(240 * 1.0);
  ok(!p.alive && p.deathCause === 'hazard', 'the repeat after the cooldown is a hazard death');
  const l2 = new Level3D(undefined, 'normal');
  const ph2 = new Physics3D(l2, diff, new EventBus());
  const p2 = new Player3D(0, 0, 0);
  ph2.kill(p2, null, 'creature');
  ok(!p2.alive && ph2.health.dead && ph2.health.heartbeatRate === 0, 'a creature kill flatlines the health model');
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
