// The "harder" pass (Node): loud rope, death memory, per-difficulty section modes, hunger, an earlier skitterling and a faster one from below on
// Abyss, bites that cost grip, reeling under load costing grip, unreliable backup anchors on Abyss.
//   node challenge.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { DIFFICULTY, EventBus, CONFIG } = await import(srcUrl('sim/config3d.js'));
const { Creature3D, CREATURE_TUNING, DIFF_TUNE } = await import(srcUrl('sim/creature3d.js'));
const { SkitterGroup, SKITTER } = await import(srcUrl('sim/skitter3d.js'));
const { Climb3D } = await import(srcUrl('sim/climb3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const T = CREATURE_TUNING;
const mk = (diffKey, sec, seed = 1) => {
  const diff = DIFFICULTY[diffKey];
  const L = new Level3D(LEVEL_DATA_3D, diff.levelVariant);
  const bus = new EventBus();
  const c = new Creature3D(L, diff, bus, { seed });
  const cp = L.sections[sec].checkpoint;
  const p = { x: cp.x, y: cp.y, z: cp.z, vx: 0, vy: 0, vz: 0, alive: true, grounded: true };
  c.reset(p);
  c.setSection(sec, L.sections[sec], p);
  return { L, bus, c, p, diff };
};
const run = (w, secs) => {
  for (let i = 0; i < secs * 60; i++) {
    w.t = (w.t || 0) + 1 / 60;
    w.c.update(1 / 60, w.p, w.t);
    if (w.c.caughtPlayer) {
      w.c.caughtPlayer = false;
    }
  }
};

// 1. loud rope: thresholds fall with the difficulty; a loud event inside a hunt counts, a soft one does not
{
  ok(DIFF_TUNE.normal.noiseJolt > DIFF_TUNE.nightmare.noiseJolt && DIFF_TUNE.nightmare.noiseJolt > DIFF_TUNE.abyss.noiseJolt, 'loud rope: the jolt that gets heard falls with the difficulty');
  const w = mk('nightmare', 5);
  run(w, 8);
  const n0 = w.c.stats.noises;
  w.bus.emit('rope:jolt', { speed: 6 });
  w.bus.emit('rope:slip', { intensity: 0.2 });
  w.bus.emit('player:wallhit', { impact: 3 });
  ok(w.c.stats.noises === n0 && w.c._noiseT <= 0, 'a soft jolt, a light slip and a bump are not heard');
  w.bus.emit('rope:jolt', { speed: DIFF_TUNE.nightmare.noiseJolt + 1 });
  ok(w.c.stats.noises === n0 + 1 && w.c._noiseT > 0.5, 'a hard catch is noise');
  w.bus.emit('rope:slip', { intensity: 0.9 });
  w.bus.emit('player:wallhit', { impact: 12 });
  ok(w.c.stats.noises === n0 + 3, 'a slipping rope and a hard wall hit are noise too');
  // listening: noise breaks the silence
  const l = mk('nightmare', 5, 2);
  run(l, 6);
  l.c._setState('OBSERVING');
  l.c.listening = true;
  l.c.stateTime = 0.5;
  l.c.stateDur = 3;
  l.c.update(1 / 60, l.p, 1);
  l.bus.emit('rope:jolt', { speed: 20 });
  l.c.update(1 / 60, l.p, 1.02);
  ok(!l.c.listening || l.c.state !== 'OBSERVING', 'while it listens, a loud rope gives you away');
}

// 2. death memory: each death brings the next spawn closer (two steps at most), a checkpoint forgets
{
  const w = mk('normal', 5);
  run(w, 5);
  const ds = [];
  for (let k = 0; k < 4; k++) {
    w.c.onRespawn(w.p);
    ds.push(w.c.y - w.p.y);
  }
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  ok(w.c._deathN === T.deathMax, `death memory: capped at ${T.deathMax} steps`);
  ok(ds.every((d) => d >= T.spawnAboveMin - 0.5), 'death memory: never closer than the minimum spawn distance');
  const near = ds[ds.length - 1];
  w.bus.emit('checkpoint', { index: 5 });
  ok(w.c._deathN === 0, 'a checkpoint forgets where you died');
  const farAll = [];
  for (let s = 1; s <= 12; s++) {
    const u = mk('normal', 5, s);
    run(u, 2);
    u.c.onRespawn(u.p);
    farAll.push(u.c.y - u.p.y);
  }
  ok(mean(farAll) < 49, `the first retry already starts closer than the old 40-55 m (mean ${mean(farAll).toFixed(1)} m; last ${near.toFixed(1)} m)`);
}

// 3. per-difficulty section modes: S4 is a staged sighting on Normal, a lethal stalk on Nightmare / Abyss
{
  const r = {};
  for (const k of ['normal', 'nightmare', 'abyss']) {
    const w = mk(k, 3);
    r[k] = { mode: w.c.mode, lethal: w.c.lethal, inPlay: w.c.inPlay };
  }
  ok(r.normal.mode === 'sighting' && !r.normal.lethal && !r.normal.inPlay, 'S4 on Normal: the staged sighting, not lethal');
  ok(['nightmare', 'abyss'].every((k) => r[k].mode === 'stalk' && r[k].lethal && r[k].inPlay), 'S4 on Nightmare / Abyss: a lethal stalk (the hunt is in play)');
  const w = mk('nightmare', 3);
  w.c.onRespawn(w.p);
  ok(w.c.inPlay && w.c.mode === 'stalk', 'S4 on Nightmare: a respawn keeps the hunt');
}

// 4. hunger: a missed strike makes it faster for the rest of the section, a new section forgets it
{
  const w = mk('normal', 5);
  run(w, 3);
  ok(w.c._hunger === 0, 'hunger starts at 0');
  w.c.lethal = true;
  w.c.grace = 0;
  w.p.x += 60; // out of reach: the strike misses
  w.c._strike(w.p);
  ok(Math.abs(w.c._hunger - T.hunger.step) < 1e-9, `a missed strike adds ${T.hunger.step} of speed`);
  for (let i = 0; i < 10; i++) w.c._strike(w.p);
  ok(Math.abs(w.c._hunger - T.hunger.max) < 1e-9, `hunger is capped at ${T.hunger.max}`);
  const h = w.c._hunger;
  w.c.onRespawn(w.p);
  ok(w.c._hunger === h || w.c.sectionIndex !== 5, 'a respawn in the same section keeps what it learned');
  w.c.setSection(6, w.L.sections[6], w.p);
  ok(w.c._hunger === 0, 'the next section starts hungry no more');
}

// 5. the one from below arrives faster on Abyss (the S5 skitterling's data is checked in skitter.mjs)
{
  ok(SKITTER.below.delayBy.abyss[1] < SKITTER.below.delay[1] && SKITTER.below.delayBy.abyss[0] < SKITTER.below.delay[0], `Abyss: the one from below comes in ${SKITTER.below.delayBy.abyss.join('-')} s instead of ${SKITTER.below.delay.join('-')} s`);
}

// 6. bites cost grip: the group reports the grip a bite took, Climb3D.bite applies it
{
  const k = DIFFICULTY.nightmare;
  const L = new Level3D(LEVEL_DATA_3D, k.levelVariant);
  const grp = new SkitterGroup(L, k, new EventBus(), { seed: 3 });
  grp.pendingGrip += SKITTER.gripBite.nightmare;
  ok(grp.takeGripDamage() === SKITTER.gripBite.nightmare && grp.takeGripDamage() === 0, 'a bite reports its grip cost once');
  ok(SKITTER.gripBite.normal < SKITTER.gripBite.nightmare && SKITTER.gripBite.nightmare < SKITTER.gripBite.abyss, 'the grip cost rises with the difficulty');
  const cl = new Climb3D(L, k, new EventBus());
  cl.stamina = 0.8;
  cl.bite(0.3);
  ok(Math.abs(cl.stamina - 0.5) < 1e-9, 'Climb3D.bite takes the grip stamina');
  cl.bite(2);
  ok(cl.stamina === 0, 'and never below zero');
}

// 7. reeling under load costs grip on Nightmare and up
{
  const mkClimb = (k) => new Climb3D(new Level3D(LEVEL_DATA_3D, DIFFICULTY[k].levelVariant), DIFFICULTY[k], new EventBus());
  const air = (cl, reeling, secs) => {
    cl.stamina = 0.6;
    const p = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, grounded: false, _reeling: reeling };
    for (let i = 0; i < secs * 60; i++) cl._stamina(p, 1 / 60, null);
    return cl.stamina;
  };
  const n = mkClimb('normal');
  const nm = mkClimb('nightmare');
  const ab = mkClimb('abyss');
  ok(air(n, true, 5) > 0.6, 'Normal: reeling in the air still lets the hands recover');
  ok(air(nm, false, 5) > 0.6 && air(nm, true, 5) < 0.6, 'Nightmare: the hands recover in the air, but not while reeling a loaded rope');
  ok(air(ab, true, 5) < air(nm, true, 5), 'Abyss: reeling tires them faster');
}

// 8. Abyss: some shortcut / recovery rings are fragile; the route anchors and Normal are untouched
{
  const cnt = (v) => {
    const L = new Level3D(LEVEL_DATA_3D, v);
    return { frag: L.anchors.filter((a) => a.kind === 'fragile' && (a.tag === 'shortcut' || a.tag === 'recovery')).length, route: L.anchors.filter((a) => a.tag === 'route' && a.kind === 'fragile').length };
  };
  const n = cnt('normal');
  const ab = cnt('abyss');
  ok(n.frag === 0 && n.route === 0, 'Normal: no backup line is fragile');
  ok(ab.frag >= 2 && ab.route === 0, `Abyss: ${ab.frag} backup rings are fragile, the route anchors are not`);
  const a = new Level3D(LEVEL_DATA_3D, 'abyss').anchors.map((x) => x.kind).join();
  ok(a === new Level3D(LEVEL_DATA_3D, 'abyss').anchors.map((x) => x.kind).join(), 'the choice is the same every time (seeded by the anchor id)');
}
console.log(fails ? `FAILED: ${fails}` : 'ALL CHALLENGE CHECKS PASS');
process.exit(fails ? 1 : 0);
