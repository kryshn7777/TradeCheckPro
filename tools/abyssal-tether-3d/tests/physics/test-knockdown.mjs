// MASON_STRIKES.md (Node): the Knockdown state machine (sim/knockdown.js) and PlayerHits (sim/playerHits.js): phases, the k curve,
// the moveMul ramp, events, cancel / abort, staggers, no knockdown while gripping / airborne, the edge-safe knockback on a real ledge
// (the stub shaft), the control lock through the step intent (no stuck input, no buffered jump), immunity, resets on game events.
//   node test-knockdown.mjs [--root DIR]
import v8 from 'node:v8';
import vm from 'node:vm';
import { srcUrl } from '../../verify/root.mjs';
import { makeShaftData } from '../creature/stubShaft.mjs';
const { Knockdown, KNOCK, KNOCK_TOTAL } = await import(srcUrl('sim/knockdown.js'));
const { PlayerHits, HITS } = await import(srcUrl('sim/playerHits.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Health3D } = await import(srcUrl('sim/health3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = 1 / 60;
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;

function bus() {
  const b = new EventBus();
  const ev = [];
  for (const e of ['player:down', 'player:rise', 'player:up', 'player:hit']) b.on(e, (p) => ev.push({ type: e, p }));
  b.ev = ev;
  return b;
}

// ---- 1. the full knockdown: phases, k, moveMul, events -----------------------------------------------------------------------
{
  const b = bus();
  const k = new Knockdown(b);
  ok(k.phase === 'none' && k.k === 0 && k.moveMul === 1 && !k.active, 'standing: phase none, k 0, moveMul 1');
  const down = k.start(1, true);
  ok(down && k.phase === 'down' && k.active && k.moveMul === 0 && near(k.dur, 1.1) && b.ev[0].type === 'player:down' && near(b.ev[0].p.dur, 1.1), 'start(1, floorOk): down for 1.1 s, moveMul 0, player:down {dur 1.1}');
  ok(near(KNOCK_TOTAL, 3.5) && near(KNOCK.rise, 2.4), 'a knockdown is 1.1 s down + 2.4 s rise = 3.5 s');
  let t = 0;
  let mono = true;
  let prevK = -1;
  let k025 = 0;
  let maxMulDown = 0;
  while (k.phase === 'down') {
    k.update(DT);
    t += DT;
    if (k.phase === 'down') {
      if (k.k < prevK - 1e-9) mono = false;
      prevK = k.k;
      maxMulDown = Math.max(maxMulDown, k.moveMul);
      if (Math.abs(t - 0.25) < DT / 2 + 1e-9) k025 = k.k;
    }
  }
  ok(mono && k025 > 0.99 && maxMulDown === 0, `down: k eases to 1 within 0.25 s (k(0.25) = ${k025.toFixed(3)}), monotone, moveMul 0 throughout`);
  ok(Math.abs(t - 1.1) < DT + 1e-9 && k.phase === 'rise' && b.ev.some((e) => e.type === 'player:rise' && near(e.p.dur, 2.4)), `rise after ${t.toFixed(3)} s, player:rise {dur 2.4}`);
  const kStart = k.k;
  const mul0 = k.moveMul;
  let monoK = true;
  let monoM = true;
  let pk = k.k;
  let pm = k.moveMul;
  let tr = 0;
  let kMid = 0;
  while (k.phase === 'rise') {
    k.update(DT);
    tr += DT;
    if (k.k > pk + 1e-9) monoK = false;
    if (k.moveMul < pm - 1e-9) monoM = false;
    pk = k.k;
    pm = k.moveMul;
    if (Math.abs(tr - 1.2) < DT / 2 + 1e-9) kMid = k.k;
  }
  ok(kStart > 0.99 && near(mul0, 0.35) && monoK && monoM, `rise: k ${kStart.toFixed(2)} -> 0 (monotone), moveMul 0.35 -> 1 (monotone)`);
  ok(kMid > 0.35 && kMid < 0.65, `the get-up is slow (smoothstep): k at mid-rise ${kMid.toFixed(2)}`);
  ok(k.phase === 'none' && k.k === 0 && k.moveMul === 1 && b.ev[b.ev.length - 1].type === 'player:up', `standing after ${(t + tr).toFixed(2)} s, player:up`);
  ok(b.ev.filter((e) => e.type === 'player:down').length === 1 && b.ev.filter((e) => e.type === 'player:up').length === 1, 'one down, one rise, one up');
}

// ---- 2. staggers ---------------------------------------------------------------------------------------------------------------
{
  const b = bus();
  const k = new Knockdown(b);
  ok(k.start(1, false) === false && k.phase === 'none' && near(k.stagger, 0.6) && near(k.moveMul, KNOCK.staggerFrom), 'a Mason hit without a floor: a 0.6 s stagger, no fall (phase none, k 0)');
  let t = 0;
  while (k.stagger > 0) {
    k.update(DT);
    t += DT;
  }
  ok(Math.abs(t - 0.6) < DT + 1e-9 && k.moveMul === 1 && k.k === 0 && b.ev.length === 0, `the stagger ends after ${t.toFixed(2)} s, control back, no down / rise / up events`);
  k.start(0.3, true);
  ok(near(k.stagger, 0.35) && k.phase === 'none', 'a bite: a 0.35 s stumble, never a fall even on a floor');
  k.update(0.5);
  k.start(1, true);
  k.start(0.3, true);
  ok(k.phase === 'down' && k.moveMul === 0, 'a bite while down does not change the knockdown');
}

// ---- 3. cancel / abort -----------------------------------------------------------------------------------------------------------
{
  const b = bus();
  const k = new Knockdown(b);
  k.start(1, true);
  k.update(0.5);
  k.cancel();
  ok(k.phase === 'none' && k.k === 0 && k.moveMul === 1 && k.stagger === 0 && b.ev[b.ev.length - 1].type === 'player:up', 'cancel: standing at once, moveMul 1, player:up');
  k.start(1, true);
  k.update(0.6);
  const kk = k.k;
  k.abort();
  ok(k.phase === 'rise' && near(k.dur, KNOCK.abortRise) && near(k.k, kk), 'abort: a fast 0.4 s rise from where it was (no snap of k)');
  for (let i = 0; i < 30; i++) k.update(DT);
  ok(k.phase === 'none' && k.moveMul === 1, 'abort: standing within 0.5 s');
  const n = b.ev.length;
  k.cancel();
  ok(b.ev.length === n, 'cancel while standing: no event');
}

// ---- 4. PlayerHits: damage, floor, knockback, immunity, resets --------------------------------------------------------------------
const L = new Level3D(makeShaftData(), 'normal');
// the s6 ledge against the -X wall: top y -344, x -16 .. -12.8, z -7.5 .. -0.5
const LEDGE_TOP = -344;
function mkPlayer(x, z) {
  return { x, y: LEDGE_TOP + 0.38, z, vx: 0, vy: 0, vz: 0, radius: 0.38, alive: true, grounded: true, climbing: false };
}
function mkCtx(b) {
  const h = new Health3D(DIFFICULTY.normal, b);
  const ctx = { health: h, level: L, gripping: false, god: false, killed: null, kill: (c) => (ctx.killed = c) };
  return ctx;
}
{
  const b = bus();
  const H = new PlayerHits(b);
  const ctx = mkCtx(b);
  const p = mkPlayer(-14.4, -4);
  ok(H.floorOk(p, L, false), 'floorOk on the ledge (grounded, a floor under the body)');
  ok(!H.floorOk(Object.assign({}, p, { grounded: false }), L, false) && !H.floorOk(Object.assign({}, p, { climbing: true }), L, false) && !H.floorOk(p, L, true), 'not floorOk while airborne, climbing or gripping');
  // the Mason strikes from the wall side: the blow pushes +X (toward the lip at -12.8)
  const r = H.mason({ x: -20, y: LEDGE_TOP + 3, z: -4 }, p, ctx);
  const hit = b.ev.find((e) => e.type === 'player:hit');
  ok(r === 'hit' && near(ctx.health.hp, 0.7) && ctx.killed === null && H.knock.phase === 'down', 'a Mason hit at full hp: hp 0.70, knocked down, no kill');
  ok(hit && hit.p.source === 'mason' && near(hit.p.amount, 0.3) && near(hit.p.hp, 0.7) && hit.p.down === true && near(hit.p.dx, 1, 1e-3) && near(hit.p.dz, 0, 1e-3) && hit.p.x === -20, 'player:hit {source mason, amount 0.3, hp 0.7, attacker x y z, dx dz unit, down true}');
  const x0 = p.x;
  for (let i = 0; i < 60; i++) H.update(DT, p, L);
  ok(p.x > x0 + 0.7 && p.x - x0 <= HITS.knockbackMax + 1e-9, `knockback ${(p.x - x0).toFixed(2)} m along the blow (<= 1.5 m)`);
  ok(H.immune && near(H.immuneT, KNOCK_TOTAL + 1 - 1, 0.02), `immune for the knockdown + 1.0 s (${(H.immuneT + 1).toFixed(2)} s from the hit)`);
  const r2 = H.mason({ x: -20, y: LEDGE_TOP + 3, z: -4 }, p, ctx);
  ok(r2 === 'immune' && near(ctx.health.hp, 0.7), 'a second hit while immune does nothing');
  // through the step intent: moveMul 0 while down, a jump dropped, the raw input comes back unscaled at the end
  const si = { move: { x: 1, z: 0 }, reel: 1, jumpPressed: true };
  H.knock.update(0); // (still down)
  const drop = H.applyIntent(si);
  ok(drop && si.move.x === 0 && si.reel === 0 && si.jumpPressed === false, 'down: the step intent move 0, reel 0, the jump dropped (not buffered)');
  for (let i = 0; i < 60 * 4; i++) H.update(DT, p, L);
  const si2 = { move: { x: 1, z: -1 }, reel: 1, jumpPressed: true };
  const drop2 = H.applyIntent(si2);
  ok(H.knock.phase === 'none' && !drop2 && si2.move.x === 1 && si2.move.z === -1 && si2.reel === 1 && si2.jumpPressed === true, 'after player:up the raw input passes untouched (no stuck input, the jump works)');
  ok(!H.immune, 'immunity over 1.0 s after standing');
}
{
  // the edge: standing 0.5 m from the lip, a blow toward it never pushes the body over
  const b = bus();
  const H = new PlayerHits(b);
  const ctx = mkCtx(b);
  const p = mkPlayer(-13.4, -4);
  H.mason({ x: -20, y: LEDGE_TOP + 3, z: -4 }, p, ctx);
  for (let i = 0; i < 60; i++) H.update(DT, p, L);
  ok(H.knock.phase === 'down' && p.x + 0.38 <= -12.8 + 1e-6, `edge-safe: from 0.6 m off the lip the knockback stops at x ${p.x.toFixed(2)} (the body's edge ${(p.x + 0.38).toFixed(2)} <= the lip -12.80)`);
  // into the wall: the slices stop at the wall
  const p2 = mkPlayer(-15.5, -4);
  H.reset();
  H.mason({ x: -5, y: LEDGE_TOP + 3, z: -4 }, p2, ctx);
  for (let i = 0; i < 60; i++) H.update(DT, p2, L);
  ok(p2.x - 0.38 >= -16 - 1e-6, `toward the wall: stops at the wall (x ${p2.x.toFixed(2)})`);
}
{
  // gripping / airborne: a stagger, nothing released, nothing pushed
  const b = bus();
  const H = new PlayerHits(b);
  const ctx = mkCtx(b);
  const p = Object.assign(mkPlayer(-14.4, -4), { grounded: false, y: LEDGE_TOP + 5 });
  const x0 = p.x;
  H.mason({ x: -20, y: LEDGE_TOP + 6, z: -4 }, p, ctx);
  const ev = b.ev.find((e) => e.type === 'player:hit');
  for (let i = 0; i < 30; i++) H.update(DT, p, L);
  ok(H.knock.phase === 'none' && near(H.knock.stagger, 0.6 - 0.5, 0.02) && ev.p.down === false && p.x === x0 && near(ctx.health.hp, 0.7), 'in the air: 30 % and a 0.6 s stagger (down false), no knockback');
  ok(near(H.immuneT + 0.5, 0.6 + 1.0, 0.02), 'a stagger: immune for the stagger + 1.0 s');
  const H2 = new PlayerHits(b);
  const ctx2 = mkCtx(b);
  ctx2.gripping = true;
  const p2 = mkPlayer(-14.4, -4);
  H2.mason({ x: -20, y: LEDGE_TOP + 3, z: -4 }, p2, ctx2);
  ok(H2.knock.phase === 'none' && H2.knock.stagger > 0, 'gripping on a floor: still only a stagger (the holds are kept)');
  const si = { move: { x: 1, z: 0 }, reel: 1, jumpPressed: true };
  H2.applyIntent(si);
  ok(si.reel === 1 && si.move.x > 0.39 && si.move.x < 0.41 && si.jumpPressed === false, 'a stagger: the reel kept, the walk at 0.4, no jump for its first part');
  // the knockdown aborts into the fast rise when the body leaves the floor
  const H3 = new PlayerHits(b);
  const ctx3 = mkCtx(b);
  const p3 = mkPlayer(-14.4, -4);
  H3.mason({ x: -20, y: LEDGE_TOP + 3, z: -4 }, p3, ctx3);
  H3.update(0.3, p3, L);
  p3.climbing = true;
  H3.update(DT, p3, L);
  let n = 0;
  while (H3.knock.active && n < 60) {
    H3.update(DT, p3, L);
    n++;
  }
  ok(!H3.knock.active && n <= 26, `climbing mid-knockdown: the fast get-up (${((n + 1) / 60).toFixed(2)} s), never stuck down`);
}
{
  // a death and the game events reset it
  const b = bus();
  const H = new PlayerHits(b);
  const ctx = mkCtx(b);
  const p = mkPlayer(-14.4, -4);
  H.mason({ x: -20, y: LEDGE_TOP + 3, z: -4 }, p, ctx);
  b.emit('game:respawn', {});
  ok(!H.knock.active && !H.immune && H.moveMul === 1, 'game:respawn: standing, not immune');
  H.mason({ x: -20, y: LEDGE_TOP + 3, z: -4 }, p, ctx);
  b.emit('game:menu', {});
  ok(!H.knock.active && !H.immune, 'game:menu: standing, not immune');
  H.mason({ x: -20, y: LEDGE_TOP + 3, z: -4 }, p, ctx);
  p.alive = false;
  H.update(DT, p, L);
  ok(!H.knock.active, 'a dead player is never down');
  // god mode: nothing
  const H2 = new PlayerHits(b);
  const ctx2 = mkCtx(b);
  ctx2.health.god = true;
  const p2 = mkPlayer(-14.4, -4);
  ok(H2.mason({ x: -20, y: LEDGE_TOP + 3, z: -4 }, p2, ctx2) === '' && !H2.knock.active && ctx2.health.hp === 1, 'god mode: no damage, no knockdown');
}

// ---- 5. allocation: update / applyIntent never allocate ---------------------------------------------------------------------------
{
  const H = new PlayerHits(null);
  const ctx = mkCtx(null);
  const p = mkPlayer(-14.4, -4);
  H.mason({ x: -20, y: LEDGE_TOP + 3, z: -4 }, p, ctx);
  const si = { move: { x: 1, z: 0 }, reel: 1, jumpPressed: false };
  for (let i = 0; i < 2000; i++) {
    H.update(DT, p, L);
    H.applyIntent(si);
  }
  let g = 0;
  v8.setFlagsFromString('--expose-gc');
  const gc = global.gc || vm.runInNewContext('gc');
  {
    gc();
    const m0 = process.memoryUsage().heapUsed;
    H.mason({ x: -20, y: LEDGE_TOP + 3, z: -4 }, p, ctx);
    for (let i = 0; i < 20000; i++) {
      H.update(DT, p, L);
      H.applyIntent(si);
    }
    gc();
    g = process.memoryUsage().heapUsed - m0;
  }
  ok(g < 64 * 1024, `20000 frames of update + applyIntent: heap ${(g / 1024).toFixed(1)} KB`);
}

console.log(fails ? `${fails} FAILED` : 'ALL KNOCKDOWN CHECKS PASS');
process.exitCode = fails ? 1 : 0;
