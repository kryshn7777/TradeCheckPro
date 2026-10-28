// The Mason as the key (LEVEL_FUN_PLAN P5, item 3), the real Creature3D on the real level, seeded, at a fixed 60 Hz (Node).
// The player waits in the S5 lure niche behind the keystone; the Mason comes down the Gullet and lunges (a stall lunge, a
// creep, or, shot from the niche, an annoyed lunge); the lunge stops at the stone / the niche's mouth and breaks the
// keystone (Objectives3D.onStrike on the bus): the S5 plug drops. The player is never hit there. Plus the safety rules:
// a strike never hits through an active solid (the keystone, or any wall), the creature senses you through the keystone
// (its attack starts), skitterlings never break it, a strike that hit the player never counts, and Sandbox (no creature)
// leaves it standing (the haul fallback: tests/objectives/mason.mjs).
//   node lure.mjs [seeds=200] [--root DIR]
import { srcUrl, positional } from '../../verify/root.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { Objectives3D } = await import(srcUrl('sim/objectives3d.js'));
const { Creature3D, CREATURE_TUNING } = await import(srcUrl('sim/creature3d.js'));
const { DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const SEEDS = +(positional(process.argv.slice(2))[0] || 200);
const DT = 1 / 60;
const LIMIT = 40; // s: the plan's window for the break
const VARIANTS = ['normal', 'nightmare', 'abyss'];

/**
 * One run. mode 'stall': the player is in the niche from the start, still. 'annoy': the player paces on the last step until
 * the Mason is within 28 m, then steps into the niche and shoots it (the aim ray through its body).
 */
function run(v, seed, mode, diff) {
  const L = new Level3D(undefined, v);
  const bus = new EventBus();
  const D = diff || DIFFICULTY[v];
  const O = new Objectives3D(L, D, bus);
  O.markDoneThrough(4); // S1-S4 open: the run is in S5
  O.reapply();
  const c = new Creature3D(L, D, bus, { seed });
  const step6 = L.byId['s5-step6'];
  const nook = { x: -20.3, z: -1.4 };
  const p = { x: mode === 'annoy' ? -18.5 : nook.x, y: step6.maxY + 0.38, z: mode === 'annoy' ? 3 : nook.z, vx: 0, vy: 0, vz: 0, alive: true, grounded: true, groundSolid: step6, radius: 0.38 };
  let t = 0;
  let broke = -1;
  let breakReason = '';
  let lastReason = '';
  let hits = 0;
  let strikes = 0;
  let inNiche = mode !== 'annoy';
  let shotT = -1;
  const stops = {};
  bus.on('creature:strike', (e) => {
    if (e.skit) return;
    strikes++;
    lastReason = e.reason;
    stops[e.stop || 'air'] = (stops[e.stop || 'air'] || 0) + 1;
  });
  bus.on('breach:break', () => {
    if (broke < 0) {
      broke = t;
      breakReason = c.burstReason; // (Objectives3D hears the strike first: the reason of the lunge that broke it)
    }
  });
  c.reset(p);
  for (let f = 0; f < LIMIT * 60; f++) {
    t += DT;
    if (!inNiche) {
      p.z = 3 + Math.sin(t * 1.4) * 2.6; // pacing along the step (the stall clock keeps resetting)
      p.vz = Math.cos(t * 1.4) * 3.6;
      if (c.inPlay && c.distance < 28) {
        inNiche = true;
        p.x = nook.x;
        p.z = nook.z;
        p.vz = 0;
      }
    }
    for (let k = 0; k < 4; k++) O.step(DT / 4, p, null, null, t);
    c.setRefuge(O.refugeKind, O.refugeBlock);
    if (mode === 'annoy' && inNiche && c.annoyCount === 0 && O.refugeKind === 2 && t - shotT >= 0.5) {
      // the player shoots at it from the niche (the hand at head height) until a shot passes through its body
      const sp = c.body.spine;
      const oy = p.y + 1.2;
      const dx = sp[9] - p.x;
      const dy = sp[10] - oy;
      const dz = sp[11] - p.z;
      const l = Math.hypot(dx, dy, dz);
      bus.emit('rope:shot', { hand: 'right', ox: p.x, oy, oz: p.z, dx: dx / l, dy: dy / l, dz: dz / l, range: 27 });
      shotT = t;
    }
    c.update(DT, p, t);
    if (c.caughtPlayer) {
      c.caughtPlayer = false;
      hits++;
    }
    if (broke >= 0) break;
  }
  return { broke, breakReason, hits, strikes, stops, open: O.isOpen('seal-s5'), annoyed: c.annoyCount, stone: L.byId['key-s5-stone'].active, ring: L.byId['key-s5-ring'].hidden, lastReason };
}

// 1. The stall path: a still player in the niche; >= 95 % of the seeds break the keystone within 40 s, nobody is hit.
for (const v of VARIANTS) {
  let broken = 0;
  let hits = 0;
  let strikes = 0;
  let consistent = true;
  const times = [];
  const stops = {};
  for (let s = 1; s <= SEEDS; s++) {
    const r = run(v, s * 7919, 'stall');
    hits += r.hits;
    strikes += r.strikes;
    for (const [k, n] of Object.entries(r.stops)) stops[k] = (stops[k] || 0) + n;
    if (r.broke >= 0) {
      broken++;
      times.push(r.broke);
      if (!r.open || r.stone || !r.ring) consistent = false;
    }
  }
  times.sort((a, b) => a - b);
  const med = times[times.length >> 1];
  const p90 = times[Math.floor(times.length * 0.9)];
  ok(broken >= SEEDS * 0.95, `${v} stall path: the keystone breaks within ${LIMIT} s in ${broken}/${SEEDS} seeds (median ${med.toFixed(1)} s, p90 ${p90.toFixed(1)} s, from the Mason's first entry 80 m up)`);
  ok(hits === 0, `${v} stall path: the player in the niche is never hit (${strikes} lunges: ${JSON.stringify(stops)})`);
  ok(consistent, `${v}: broken = the S5 seal open, the stone inactive, its ring gone`);
}

// 2. The annoy path: a player that arrives as the Mason comes (no stall time banked) and shoots it from the niche.
for (const v of VARIANTS) {
  const n = Math.max(20, SEEDS >> 2);
  let broken = 0;
  let hits = 0;
  let byAnnoy = 0;
  let annoyed = 0;
  for (let s = 1; s <= n; s++) {
    const r = run(v, 0xa11 + s * 104729, 'annoy');
    hits += r.hits;
    if (r.annoyed) annoyed++;
    if (r.broke >= 0) broken++;
    if (r.breakReason === 'annoyed') byAnnoy++;
  }
  ok(broken >= n * 0.95 && hits === 0 && annoyed >= n * 0.9 && (v !== 'normal' || byAnnoy >= n * 0.5), `${v} annoy path: shot from the niche (annoyed ${annoyed}/${n}), broken in ${broken}/${n}, ${byAnnoy} by the annoyed lunge itself (the rest by a stall / creep lunge first), no hit`);
}

// 3. Determinism: the same seed, the same break.
{
  const a = run('nightmare', 1234, 'stall');
  const b = run('nightmare', 1234, 'stall');
  ok(a.broke === b.broke && a.breakReason === b.breakReason && a.strikes === b.strikes, `the same seed gives the same break (${a.broke.toFixed(2)} s, ${a.breakReason})`);
}

// 4. Sandbox (the creature disabled): nothing breaks it; it stands until hauled (tests/objectives/mason.mjs).
{
  const sandbox = Object.assign({}, DIFFICULTY.normal, { creature: Object.assign({}, DIFFICULTY.normal.creature, { enabled: false }) });
  const r = run('normal', 99, 'stall', sandbox);
  ok(r.broke < 0 && r.strikes === 0 && !r.open && r.stone, 'Sandbox (no creature): the keystone stands; only the haul fallback breaks it');
}

// 5. The safety rules on a mini level: a strike never hits through an active solid; the keystone does not hide you from it.
{
  const data = {
    spawn: { x: 0, y: 0, z: 0 },
    sections: [{ id: 'a', yTop: 50, yBottom: -50, creature: { mode: 'hunt', lethal: true } }],
    solids: [
      { id: 'floor', minX: -30, maxX: 30, minY: -11, maxY: -10, minZ: -30, maxZ: 30, kind: 'wall' },
      { id: 'pillar', minX: 1, maxX: 1.6, minY: -10, maxY: 5, minZ: -2, maxZ: 2, kind: 'pillar' },
      { id: 'stone', minX: 1, maxX: 1.6, minY: -10, maxY: 5, minZ: 6, maxZ: 10, kind: 'breach', fixture: 'stone' },
    ],
    anchors: [],
  };
  const L = new Level3D(data, 'normal');
  const bus = new EventBus();
  const strikes = [];
  bus.on('creature:strike', (e) => strikes.push(e));
  const c = new Creature3D(L, DIFFICULTY.normal, bus, { seed: 7 });
  const strikeAt = (cx, cz, px, pz) => {
    const p = { x: px, y: 0, z: pz, vx: 0, vy: 0, vz: 0, alive: true };
    c.reset(p);
    c.x = cx;
    c.y = 0;
    c.z = cz;
    c.lethal = true;
    c.grace = 0;
    c.burstReason = 'contact';
    c.caughtPlayer = false;
    c._strike(p);
    return { hit: c.caughtPlayer, e: strikes[strikes.length - 1] };
  };
  const open = strikeAt(-1, 0, 2.5, 0.5); // wait: the pillar is at x 1..1.6: from -1 to 2.5 the line crosses it
  const clear = strikeAt(-1, 3.5, 2.2, 4.2); // z 3.5..4.2: between the pillar and the stone: nothing in the way
  ok(!open.hit && open.e.stop === 'pillar' && open.e.x < 1, `a strike through a pillar never hits (stop ${open.e.stop}, the lunge ends at x ${open.e.x.toFixed(2)})`);
  ok(clear.hit && clear.e.hit, 'the same strike in the open hits');
  L.byId.stone.active = true;
  const stone = strikeAt(-1, 8, 2.5, 8);
  ok(!stone.hit && stone.e.stop === 'stone', `nor through the keystone (stop ${stone.e.stop})`);
  // its sense of you ignores the keystone (kind 'breach'): an attack starts and the stone takes it; a pillar hides you
  c.x = -1;
  c.y = 0;
  c.z = 8;
  const seesThroughStone = !c._losBlocked({ x: 3, y: 0, z: 8 });
  c.z = 0;
  const pillarHides = c._losBlocked({ x: 3, y: 0, z: 0 });
  ok(seesThroughStone && pillarHides, 'the attack line of sight skips the keystone (it starts the attack), not a pillar');
  // a refuge forces a miss even point-blank; its block stops the lunge
  const p = { x: 3, y: 0, z: 4, vx: 0, vy: 0, vz: 0, alive: true };
  c.reset(p);
  c.x = 0;
  c.y = 0;
  c.z = 4;
  c.lethal = true;
  c.grace = 0;
  c.setRefuge(2, { minX: 2, maxX: 4, minY: -10, maxY: 2, minZ: 3, maxZ: 5 });
  c._strike(p);
  const e = strikes[strikes.length - 1];
  ok(!c.caughtPlayer && e.stop === 'rest' && e.refuge === 2 && e.x <= 2 - 0.79, `in the lure no strike hits; the lunge stops at the rest's mouth (x ${e.x.toFixed(2)}, refuge ${e.refuge})`);
  c.setRefuge(0, null);
}

// 6. What counts as a blow on the keystone (Objectives3D.onStrike): a Mason lunge that stopped at it, at its lure's mouth with
//    the player in the lure, or that ended within r of it; never a skitterling's, never one that hit the player.
{
  const L = new Level3D(undefined, 'normal');
  const O = new Objectives3D(L, DIFFICULTY.normal, null);
  const k = O.fixtures[O.fixtureIndex('key-s5')];
  const cases = [
    [{ x: 0, y: -150, z: 0, hit: false, stop: 'key-s5-stone' }, true, 'stopped at the stone'],
    [{ x: k.x + 1, y: k.y + 1, z: k.z, hit: false, stop: '' }, true, 'ended within r of it'],
    [{ x: k.x, y: k.y + 6, z: k.z, hit: false, stop: 'rest' }, false, "at a rest's mouth, the player not in the lure"],
    [{ x: k.x, y: k.y, z: k.z, hit: false, stop: 'key-s5-stone', skit: true }, false, "a skitterling's"],
    [{ x: k.x, y: k.y, z: k.z, hit: true, stop: '' }, false, 'one that hit the player'],
    [{ x: k.x + 6, y: k.y, z: k.z, hit: false, stop: 's5-wall-w' }, false, 'one that stopped at a wall 6 m away'],
  ];
  let good = true;
  for (const [e, want, name] of cases) {
    O.reset();
    const got = O.onStrike(e);
    if (got !== want || O.isDone('obj-s5') !== want) {
      good = false;
      console.log(`      ${name}: got ${got}`);
    }
  }
  O.reset();
  O.refugeIndex = O.nookIndex('nook-s5'); // the player in the lure
  const viaRest = O.onStrike({ x: k.x, y: k.y + 6, z: k.z, hit: false, stop: 'rest' });
  ok(good && viaRest && O.isDone('obj-s5'), `onStrike: ${cases.map((c) => `${c[2]} ${c[1] ? 'counts' : 'does not'}`).join(', ')}; at the lure's mouth with the player in it counts`);
}

console.log(`      (tuning: killRadius x strikeMul ${(DIFFICULTY.normal.creature.killRadius * CREATURE_TUNING.strikeMul).toFixed(2)} m reach)`);
console.log(fails ? `${fails} FAILED` : 'ALL LURE CHECKS PASS');
process.exitCode = fails ? 1 : 0;
