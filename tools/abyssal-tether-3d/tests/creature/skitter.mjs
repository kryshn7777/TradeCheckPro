// WP-SKITTER unit checks (Node): the skitterling variant's config (exactly 1.5x speeds, smaller, shorter wind-up), spawn data in the
// real Chapter I level, determinism, safe spawn distance, tagged events, the damage path and the Mason's own trigger link.
//   node skitter.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Creature3D, CREATURE_VARIANTS } = await import(srcUrl('sim/creature3d.js'));
const { SkitterGroup, SKITTER, skitterCount, skitterDamage } = await import(srcUrl('sim/skitter3d.js'));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'PASS ' : 'FAIL ') + msg); if (!c) fails++; };
const KEYS = ['normal', 'nightmare', 'abyss'];
const player = (x, y, z) => ({ x, y, z, vx: 0, vy: 0, vz: 0, alive: true, grounded: true });
const lvl = (k) => new Level3D(LEVEL_DATA_3D, DIFFICULTY[k].levelVariant);

// 1. Config: scale, exact 1.5x speeds, wind-up, reach, per mode x difficulty.
{
  let worst = 0;
  let okAll = true;
  for (const k of KEYS) {
    const L = lvl(k);
    for (const si of [5, 6, 7]) {
      const big = new Creature3D(L, DIFFICULTY[k], null, { seed: 7 });
      const sm = new Creature3D(L, DIFFICULTY[k], null, { seed: 7, variant: 'skitterling' });
      const p = player(0, L.sections[si].yTop - 5, 0);
      big.setSection(si, L.sections[si], p);
      sm.setSection(si, L.sections[si], p);
      for (const f of ['approach', 'pursue', 'burst', 'windupAdv', 'creep']) {
        const r = sm.k[f] / big.k[f];
        worst = Math.max(worst, Math.abs(r - 1.5));
        if (Math.abs(r - 1.5) > 1e-9) okAll = false;
      }
      if (Math.abs(sm.k.windup / big.k.windup - 1 / 1.5) > 1e-9 || sm.k.menace !== big.k.menace || sm.k.snap !== big.k.snap) okAll = false;
    }
  }
  ok(okAll, `variant speeds = exactly 1.5x the Mason's (approach/pursue/burst/windupAdv/creep) on 3 difficulties x S6-S8 (worst error ${worst.toExponential(1)}); wind-up /1.5; menace + snap unchanged`);
  const L = lvl('normal');
  const big = new Creature3D(L, DIFFICULTY.normal, null, { seed: 1 });
  const sm = new Creature3D(L, DIFFICULTY.normal, null, { seed: 1, variant: 'skitterling' });
  ok(CREATURE_VARIANTS.skitterling.scale === 0.45 && sm.body.size === 0.45 && big.body.size === 1, 'body.size 0.45 vs 1');
  ok(Math.abs(sm.bodyLength / big.bodyLength - 0.45) < 1e-9 && sm.body.limbs[0].reach < big.body.limbs[0].reach * 0.5, `body ${sm.bodyLength.toFixed(1)} m vs ${big.bodyLength.toFixed(1)} m, limbs scaled`);
  ok(sm.cfg.killRadius < big.cfg.killRadius && sm.cfg.killRadius >= 0.8, `reach: kill radius ${sm.cfg.killRadius.toFixed(2)} vs ${big.cfg.killRadius.toFixed(2)} m`);
}

// 2. Spawn data: deeper Chapter I sections only, bounded, monotone in difficulty.
{
  const L = lvl('normal');
  let early = 0;
  for (let i = 0; i < 5; i++) for (const k of KEYS) early += skitterCount(L.sections[i], k);
  const c = (i) => KEYS.map((k) => skitterCount(L.sections[i], k));
  const mono = [5, 6, 7].every((i) => c(i)[0] <= c(i)[1] && c(i)[1] <= c(i)[2]);
  ok(early === 0 && c(5).every((n) => n === 1) && c(6)[0] >= 1 && c(7)[0] >= 1 && [5, 6, 7].every((i) => c(i).every((n) => n <= SKITTER.maxAlive)) && mono,
    `spawn data: none in S1-S5; S6 [${c(5)}], S7 [${c(6)}], S8 [${c(7)}] (normal, nightmare, abyss)`);
  ok(skitterDamage('normal') < skitterDamage('nightmare') && skitterDamage('nightmare') < skitterDamage('abyss') && skitterDamage('abyss') < 0.6, `hit costs ${KEYS.map((k) => skitterDamage(k)).join(' / ')} of full health`);
  const sb = new SkitterGroup(lvl('sandbox'), DIFFICULTY.sandbox, new EventBus(), { seed: 1 });
  ok(!sb.enabled && sb.aliveCount === 0, 'sandbox: group disabled');
}

// 3. Entry: never starts within the safe radius of the player / checkpoint, grace period, only in S6-S8.
{
  let minD = Infinity;
  let good = true;
  for (const k of KEYS) {
    const L = lvl(k);
    for (let si = 0; si < L.sections.length; si++) {
      const g = new SkitterGroup(L, DIFFICULTY[k], new EventBus(), { seed: 11 + si });
      const cp = L.sections[si].checkpoint;
      const p = player(cp.x, cp.y, cp.z);
      g.setSection(si, p);
      const want = skitterCount(L.sections[si], k);
      if (g.aliveCount !== want) { good = false; console.log('  count', k, si, g.aliveCount, want); }
      for (const c of g.slots) {
        if (!c.on) continue;
        const d = Math.hypot(c.x - p.x, c.y - p.y, c.z - p.z);
        minD = Math.min(minD, d);
        if (d < SKITTER.safeRadius || c.grace <= 0) { good = false; console.log('  bad', k, si, d, c.grace, c.body.visible); }
      }
    }
  }
  ok(good && minD >= SKITTER.safeRadius, `entry: alive count matches the data, min start distance ${minD.toFixed(1)} m >= ${SKITTER.safeRadius} m, grace > 0 (they start 80+ m up, out of sight)`);
}

// 4. Determinism + events + damage path (a stationary player in S7 on Nightmare).
const sim = (seed, secs) => {
  const k = 'nightmare';
  const L = lvl(k);
  const bus = new EventBus();
  const ev = [];
  for (const t of ['creature:state', 'creature:burst', 'creature:attack', 'creature:retreat', 'creature:sighting', 'creature:step', 'creature:call', 'creature:strike']) bus.on(t, (p) => ev.push([t, p]));
  const g = new SkitterGroup(L, DIFFICULTY[k], bus, { seed });
  const cp = L.sections[6].checkpoint;
  const p = player(cp.x, cp.y, cp.z);
  g.setSection(6, p);
  let dmg = 0;
  for (let i = 0; i < secs * 60; i++) { g.update(1 / 60, p, i / 60); dmg += g.takeDamage(); }
  return { g, ev, dmg, sig: g.slots.map((c) => [c.x, c.y, c.z, c.state, c.stats.attacks].join(',')).join('|') };
};
{
  const a = sim(5, 90);
  const b = sim(5, 90);
  const c = sim(6, 90);
  ok(a.sig === b.sig && a.ev.length === b.ev.length && a.dmg === b.dmg, `deterministic: same seed -> same positions/states/events/damage (${a.ev.length} events)`);
  ok(a.sig !== c.sig, 'different seed -> different run');
  ok(a.ev.length > 0 && a.ev.every((e) => e[1].skit === true) && !a.ev.some((e) => e[0] === 'creature:sighting' || e[0] === 'creature:call'), 'events: all tagged skit:true, no sightings / calls');
  ok(a.g.aliveCount === 2 && a.g.slots.every((x) => !x.caughtPlayer), 'two alive on Nightmare S7; a skitterling never sets caughtPlayer (no instant kill)');
  ok(a.g.hits >= 1 && Math.abs(a.dmg - a.g.hits * skitterDamage('nightmare')) < 1e-9, `damage path: ${a.g.hits} hit(s) on a stationary player in 90 s = ${a.dmg.toFixed(2)} of full health`);
}

// 5. The Mason keeps its trigger link while skitterlings share the bus.
{
  const L = lvl('normal');
  const bus = new EventBus();
  const mason = new Creature3D(L, DIFFICULTY.normal, bus, { seed: 3 });
  const g = new SkitterGroup(L, DIFFICULTY.normal, bus, { seed: 3 });
  const p = player(0, -165, 0);
  mason.reset(p);
  g.reset();
  const trig = L.sections[3].triggers[0];
  bus.emit('trigger:sighting', { name: 'sighting', data: trig.data, x: p.x, y: trig.y, z: p.z });
  for (let i = 0; i < 120; i++) mason.update(1 / 60, p, i / 60);
  ok(!!mason.sighting || mason.sightingDone || mason.body.visible, 'Mason still answers the sighting trigger with skitterlings present');
}
console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exit(fails ? 1 : 0);
