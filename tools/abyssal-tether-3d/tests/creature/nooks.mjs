// The Masons' rests (LEVEL_FUN_PLAN P5, item 10) with the real Creature3D on the real level, seeded, at a fixed 60 Hz (Node).
// A player paces near a rest while the Mason hunts, hides in it once the Mason is within 30 m (or after 20 s), and stays
// there, still. While the rest's budget lasts (25 / 15 / 8 s): no attack starts, nothing hits, the stall clock is frozen
// (hiding does not refresh it), the head never enters the rest's path-blocking box, the Mason holds and listens. After the
// budget it behaves as it does today: the still player is caught. Also: the skitterlings never bite in a rest, the threat
// eases (no burst / near-miss / stillness spikes), and the same seed gives the same run.
//   node nooks.mjs [seeds=24] [--root DIR]
import { srcUrl, positional } from '../../verify/root.mjs';
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { Objectives3D } = await import(srcUrl('sim/objectives3d.js'));
const { Creature3D, CREATURE_TUNING, boxSurface } = await import(srcUrl('sim/creature3d.js'));
const { SkitterGroup } = await import(srcUrl('sim/skitter3d.js'));
const { ThreatSystem3D } = await import(srcUrl('sim/threat3d.js'));
const { DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const SEEDS = +(positional(process.argv.slice(2))[0] || 24);
const DT = 1 / 60;
const VARIANTS = ['normal', 'nightmare', 'abyss'];

/** One run: the player paces, hides in `nookId` when the Mason is within 30 m (or at 20 s), then stays still. */
function run(v, nookId, seed, opts = {}) {
  const L = new Level3D(undefined, v);
  const bus = new EventBus();
  const O = new Objectives3D(L, DIFFICULTY[v], bus);
  const n = O.nooks[O.nookIndex(nookId)];
  O.markDoneThrough(n.section);
  O.reapply();
  const c = new Creature3D(L, DIFFICULTY[v], bus, { seed });
  const g = opts.skitters ? new SkitterGroup(L, DIFFICULTY[v], bus, { seed }) : null;
  const ev = { attacksIn: 0, strikesIn: 0, warn: -1, spent: -1 };
  let hiding = false;
  bus.on('creature:attack', (e) => {
    if (O.refugeIndex >= 0 && !e.skit) ev.attacksIn++;
  });
  bus.on('creature:strike', (e) => {
    if (O.refugeIndex >= 0 && !e.skit) ev.strikesIn++;
  });
  bus.on('nook:warn', () => (ev.warn = t));
  bus.on('nook:spent', () => (ev.spent = t));
  const ground = L.querySolids(n.minX, n.minY - 0.5, n.minZ, n.maxX, n.minY, n.maxZ, []).find((s) => s.maxY <= n.minY + 0.05);
  const home = { x: (n.minX + n.maxX) / 2, z: (n.minZ + n.maxZ) / 2 };
  const out = { x: home.x + 3, z: home.z + 5 };
  const p = { x: out.x, y: n.minY + 0.38, z: out.z, vx: 0, vy: 0, vz: 0, alive: true, grounded: true, groundSolid: ground, radius: 0.38 };
  c.reset(p);
  if (g) g.setSection(n.section, p);
  let t = 0;
  let hideT = -1;
  let caught = -1;
  let caughtIn = 0;
  let bites = 0;
  let bitesIn = 0;
  let stall0 = -1;
  let frozen = true;
  let listen = 0;
  let inFrames = 0;
  let minBlock = Infinity;
  const surf = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
  let hash = 0x811c9dc5;
  for (let f = 0; f < 75 * 60; f++) {
    t += DT;
    if (!hiding && (t >= 20 || (c.inPlay && c.distance < 30))) {
      hiding = true;
      hideT = t;
      p.x = home.x;
      p.z = home.z;
    }
    if (!hiding) {
      p.x = out.x + Math.sin(t * 1.3) * 3; // pacing: the stall clock keeps resetting
      p.vx = Math.cos(t * 1.3) * 3.9;
    } else p.vx = 0;
    for (let k = 0; k < 4; k++) O.step(DT / 4, p, null, null, t);
    c.setRefuge(O.refugeKind, O.refugeBlock);
    if (g) g.setRefuge(O.refugeKind, O.refugeBlock);
    c.update(DT, p, t);
    if (g) {
      g.update(DT, p, t);
      if (g.takeDamage() > 0) {
        bites++;
        if (O.refugeIndex >= 0) bitesIn++;
      }
    }
    hash = Math.imul(hash ^ Math.round(c.x * 1000), 16777619) >>> 0;
    if (O.refugeIndex >= 0) {
      inFrames++;
      if (stall0 < 0) stall0 = c.stallTime;
      else if (c.stallTime !== stall0) frozen = false;
      if (c.state === 'OBSERVING') listen++;
      minBlock = Math.min(minBlock, boxSurface(n.block, c.x, c.y, c.z, surf));
    }
    if (c.caughtPlayer) {
      c.caughtPlayer = false;
      if (O.refugeIndex >= 0) caughtIn++;
      else if (hiding && caught < 0) caught = t;
    }
    if (caught >= 0) break;
  }
  return { n, ev, hideT, caught, caughtIn, bites, bitesIn, frozen, listen: inFrames ? listen / inFrames : 0, inFrames, minBlock, hash, lethal: c.lethal };
}

// 1. Hidden in a rest, the Mason never starts an attack and never hits; the stall clock is frozen; its head keeps out of the
//    rest's block; it holds and listens. After the budget it catches the still player as it would today.
for (const nookId of ['nook-s6', 'nook-s4']) {
  for (const v of VARIANTS) {
    if (nookId === 'nook-s4' && v === 'normal') continue; // S4 on Normal is the sighting (non-lethal): no hunt to hide from
    let attacks = 0;
    let strikes = 0;
    let hitsIn = 0;
    let frozen = 0;
    let listen = 0;
    let minBlock = Infinity;
    let caught = 0;
    let warned = 0;
    const after = [];
    let budget = 0;
    for (let s = 1; s <= SEEDS; s++) {
      const r = run(v, nookId, 0x51ed + s * 7919);
      budget = r.n.budget;
      attacks += r.ev.attacksIn;
      strikes += r.ev.strikesIn;
      hitsIn += r.caughtIn;
      if (r.frozen) frozen++;
      listen += r.listen;
      minBlock = Math.min(minBlock, r.minBlock);
      if (r.ev.warn > 0 && Math.abs(r.ev.spent - r.ev.warn - 5) < 0.05) warned++;
      if (r.caught > 0) {
        caught++;
        after.push(r.caught - r.hideT - budget);
      }
    }
    after.sort((a, b) => a - b);
    const med = after.length ? after[after.length >> 1] : NaN;
    ok(attacks === 0 && hitsIn === 0, `${v} ${nookId}: in the rest (budget ${budget} s) no attack starts (${attacks}) and nothing hits (${hitsIn}) over ${SEEDS} seeds (strikes of attacks begun outside: ${strikes}, none landed)`);
    ok(frozen === SEEDS, `${v} ${nookId}: the stall clock is frozen while hidden (${frozen}/${SEEDS})`);
    ok(minBlock >= CREATURE_TUNING.minClear - 0.05, `${v} ${nookId}: the head keeps out of the rest's block (closest ${minBlock.toFixed(2)} m from it, minClear ${CREATURE_TUNING.minClear})`);
    ok(listen / SEEDS > 0.1, `${v} ${nookId}: it holds at the opening and listens (${((100 * listen) / SEEDS).toFixed(0)} % of the hidden frames OBSERVING)`);
    ok(warned === SEEDS, `${v} ${nookId}: nook:warn 5 s before the budget ends, nook:spent at its end (${warned}/${SEEDS})`);
    ok(caught >= SEEDS * 0.9 && med < 25, `${v} ${nookId}: after the budget it behaves as today: the still player caught in ${caught}/${SEEDS} runs, median ${med.toFixed(1)} s after the budget ran out`);
  }
}

// 2. The skitterlings (S6 has one on every difficulty, two on Nightmare / Abyss from below): no bite in a rest.
{
  let bites = 0;
  let runs = 0;
  for (const v of VARIANTS) {
    for (let s = 1; s <= Math.max(4, SEEDS >> 2); s++) {
      const r = run(v, 'nook-s6', 0xb17e + s, { skitters: true });
      runs++;
      bites += r.bitesIn;
    }
  }
  ok(bites === 0, `skitterlings: no bite lands in a rest (${runs} runs, all difficulties)`);
}

// 3. Determinism: the same seed, the same run.
{
  const a = run('nightmare', 'nook-s6', 4242);
  const b = run('nightmare', 'nook-s6', 4242);
  ok(a.hash === b.hash && a.caught === b.caught && a.hideT === b.hideT, `the same seed gives the same run (hash ${a.hash.toString(16)}, caught at ${a.caught.toFixed(2)} s)`);
}

// 4. The threat eases in a rest: no burst / near-miss spikes, no stillness pressure.
{
  const T = new ThreatSystem3D(new EventBus());
  const creature = { active: true, state: 'BURST', distance: 8, lethal: true, inPlay: true, nearMiss: 1, stallTime: 20, refuge: 1 };
  const player = { alive: true, grounded: true, vx: 0, vy: 0, vz: 0 };
  const ctx = { player, creature, tethers: null, diff: DIFFICULTY.nightmare };
  for (let i = 0; i < 120; i++) T.update(DT, ctx);
  const hidden = { burst: T.components.burst, nearMiss: T.components.nearMiss, still: T.components.stillness, v: T.value };
  creature.refuge = 0;
  const T2 = new ThreatSystem3D(new EventBus());
  for (let i = 0; i < 120; i++) T2.update(DT, ctx);
  ok(hidden.burst === 0 && hidden.nearMiss === 0 && hidden.still === 0 && hidden.v < T2.value, `threat in a rest: no burst / near-miss / stillness (${hidden.v.toFixed(2)} vs ${T2.value.toFixed(2)} outside)`);
}

console.log(fails ? `${fails} FAILED` : 'ALL NOOK CHECKS PASS');
process.exitCode = fails ? 1 : 0;
