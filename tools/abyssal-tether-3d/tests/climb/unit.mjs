// Grip climbing checks (Node, WP-CLIMB): the real Level3D / Physics3D with sim/climb3d.js.
//  - the authored climb zones (counts, mounting, queries), the VR hand-delta pull (1:1 within a lag), the throw on release,
//    alternating hands, the stretch release, collision safety (no tunnelling, no damage), the pull velocity cap,
//    grip stamina (drain hanging / moving / two hands / wet, slip at zero, lockout and resume level, refill on the ground,
//    difficulty scaling), the desktop cling (climb, traverse, hop, drop), grabbing while tethered, the yank suppression,
//    determinism, and that a run without any climb intent is untouched.
//   node unit.mjs [--root DIR]   (prints PASS/FAIL per check, exit 1 on a failure)
import { srcUrl } from '../../verify/root.mjs';
const { CONFIG, DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Player3D, TetherSystem, Physics3D } = await import(srcUrl('sim/physics3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { Climb3D } = await import(srcUrl('sim/climb3d.js'));
const K = CONFIG.climb;
const DT = CONFIG.PHYSICS_DT;
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const near = (a, b, e) => Math.abs(a - b) <= e;

function blankClimb() {
  const hand = () => ({ ok: false, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
  return { vr: false, grab: { left: false, right: false }, fwd: 0, side: 0, rx: 1, rz: 0, fx: 0, fz: -1, hands: { left: hand(), right: hand() } };
}

/** A world: level + physics + tethers + a player at (x, y, z). */
function world(x, y, z, diffKey = 'normal', variant = 'normal') {
  const bus = new EventBus();
  const ev = [];
  for (const t of ['climb:grab', 'climb:release', 'climb:scrape', 'climb:strain', 'climb:slip', 'climb:hop', 'health:damage', 'player:land', 'player:wallhit']) bus.on(t, (p) => ev.push([t, p]));
  const level = new Level3D(undefined, variant);
  const diff = DIFFICULTY[diffKey];
  const th = new TetherSystem(level, diff, bus, {});
  const ph = new Physics3D(level, diff, bus);
  const p = new Player3D(x, y, z);
  p.rx = x;
  p.ry = y;
  p.rz = z;
  const it = { move: { x: 0, z: 0 }, reel: 0, jumpPressed: false, brake: false, hands: { left: { yank: 0 }, right: { yank: 0 } }, climb: blankClimb() };
  return { bus, ev, level, diff, th, ph, p, it, c: it.climb, cl: ph.climb };
}

/** One 80 Hz frame: probe, then the physics steps (like Game3D._stepPhysics). */
const FPS = 80; // 3 physics steps per frame, exactly
function frame(w, fdt = 3 * DT) {
  w.cl.probe(w.p, w.c);
  let acc = fdt;
  while (acc >= DT - 1e-9) {
    w.ph.step(w.p, w.th, w.it, DT);
    w.it.jumpPressed = false;
    acc -= DT;
    if (!w.p.alive) break;
  }
}
const frames = (w, n, fdt) => {
  for (let i = 0; i < n; i++) frame(w, fdt);
};
const setHand = (w, h, rx, ry, rz, grab = true) => {
  const b = w.c.hands[h];
  w.c.vr = true;
  b.ok = true;
  b.rx = rx;
  b.ry = ry;
  b.rz = rz;
  w.c.grab[h] = grab;
};
const count = (w, type, pred) => w.ev.filter((e) => e[0] === type && (!pred || pred(e[1]))).length;

// ---- 1. The authored zones ------------------------------------------------------------------------------------------------
{
  const L = new Level3D(undefined, 'normal');
  const per = L.sections.map(() => 0);
  for (const z of L.climb) per[z.section]++;
  ok(L.climb.length >= 12 && per.every((n) => n >= 1 && n <= 4), `Chapter I has ${L.climb.length} climb zones, 1-4 in every section (${per.join(' ')})`);
  ok(L.climb.every((z) => z.maxY - z.minY <= 14 && Number.isFinite(z.face)), 'every zone is at most 14 m tall and has a face coordinate');
  const out = [];
  const z = L.climb.find((q) => q.id === 'c-s1-west');
  L.climbNear(z.minX + 0.1, z.minY + 1, 0, 0.2, out);
  ok(out.includes(z), 'level.climbNear finds a zone from a point beside it');
  L.climbNear(0, 20, 0, 0.5, out);
  ok(out.length === 0, 'and nothing in open air');
  ok(['nightmare', 'abyss'].every((v) => new Level3D(undefined, v).climb.length === L.climb.length), 'all variants carry the same zones');
}

// ---- 2. VR hand-delta pull ---------------------------------------------------------------------------------------------
// On the S1 sill (top y = -5) beside the west wall (x = -11): the hand reaches the wall at chest height, grips, and is pulled down.
function sillWorld(diffKey) {
  const w = world(-10.6, -4.62, -6, diffKey);
  frames(w, 20); // settle on the floor
  return w;
}
{
  const w = sillWorld();
  ok(w.p.grounded && near(w.p.y, -4.62, 0.02), 'test body stands on the sill');
  setHand(w, 'right', -0.45, 0.6, 0, false);
  frame(w);
  ok(w.cl.hands.right.hover && w.cl.hands.right.hoverIn && w.cl.suppressYank('right'), 'a hand beside a zone hovers in reach and its grip is a grab (no rope yank)');
  setHand(w, 'left', 0.9, 0.3, 0.4, false); // far from the wall
  frame(w);
  ok(!w.cl.hands.left.hoverIn && !w.cl.suppressYank('left'), 'a hand away from every zone keeps the yank');
  setHand(w, 'right', -0.45, 0.6, 0, true);
  frame(w);
  ok(w.cl.holding && w.cl.hands.right.gripping && w.cl.mode === 1 && count(w, 'climb:grab') === 1, 'grip with a hand in reach takes the hold (climb:grab)');
  const y0 = w.p.y;
  // pull: the real hand moves DOWN 0.5 m over 0.5 s (rel.y 0.6 -> 0.1) -> the body goes UP 0.5 m
  for (let i = 0; i < 36; i++) {
    setHand(w, 'right', -0.45, 0.6 - (0.5 * (i + 1)) / 36, 0, true);
    frame(w);
  }
  const rise = w.p.y - y0;
  ok(near(rise, 0.5, 0.1), `hand-delta: pulling the hand down 0.50 m lifts the body ${rise.toFixed(3)} m`);
  ok(w.p.climbing === true && w.health === undefined && w.ph.health.hp === 1, 'no damage while the grip drives the body');
  // keep still a moment: the body is where the hand wants it, no drift
  frames(w, 30);
  const y1 = w.p.y;
  frames(w, 30);
  ok(near(w.p.y, y1, 0.005) && Math.abs(w.p.vy) < 0.1, 'holding still: the body stays on the hold (no drift, no sag)');
  // let go: the pull velocity is inherited
  for (let i = 0; i < 24; i++) {
    setHand(w, 'right', -0.45, 0.1 - (0.5 * (i + 1)) / 24, 0, true);
    frame(w);
  }
  const vUp = w.p.vy;
  setHand(w, 'right', -0.45, -0.4, 0, false);
  frame(w);
  ok(!w.cl.holding && count(w, 'climb:release', (e) => e.reason === 'input' && e.last) === 1, 'letting go ends the hold (climb:release input)');
  ok(w.p.vy > 0.8 * vUp && w.p.vy < 1.6 * vUp + 0.3 && w.p.vy > 0.6, `release inherits the pull velocity (vy ${w.p.vy.toFixed(2)} from a ${vUp.toFixed(2)} m/s pull)`);
}
// A fast pull is a launch, capped.
{
  const w = sillWorld();
  setHand(w, 'right', -0.45, 0.9, 0, true);
  frame(w);
  for (let i = 0; i < 12; i++) {
    setHand(w, 'right', -0.45, 0.9 - ((i + 1) * 0.12), 0, true); // 0.12 m / frame = 8.6 m/s of hand speed
    frame(w);
  }
  const v = w.p.vy;
  setHand(w, 'right', -0.45, -0.6, 0, false);
  frame(w);
  ok(w.p.vy <= K.throwMax + 1e-6 && w.p.vy > 4, `a quick pull launches the body (vy ${w.p.vy.toFixed(2)} <= ${K.throwMax}; pulling at ${v.toFixed(1)})`);
  ok(w.ph.health.hp === 1, 'a launch off the wall does no damage by itself');
}
// Two hands alternate: one lets go and the other takes over without a throw.
{
  const w = sillWorld();
  setHand(w, 'right', -0.45, 0.6, 0.15, true);
  setHand(w, 'left', -0.45, 0.2, -0.15, true);
  frames(w, 3);
  ok(w.cl.gripCount === 2, 'both hands can hold on');
  setHand(w, 'right', -0.45, 0.6, 0.15, false);
  frame(w);
  ok(w.cl.holding && w.cl.hands.left.gripping && !w.cl.hands.right.gripping && count(w, 'climb:release', (e) => e.last === false) === 1, 'one hand lets go, the other keeps the body (no throw)');
  const y = w.p.y;
  // right reaches higher and takes a new hold; left lets go
  setHand(w, 'right', -0.45, 0.9, 0.15, true);
  frames(w, 3);
  setHand(w, 'left', -0.45, 0.2, -0.15, false);
  frame(w);
  ok(w.cl.holding && w.cl.hands.right.gripping && w.p.y >= y - 0.05, 'hands alternate: hold, release, regrip higher');
}
// The hand ripped from the wall.
{
  const w = sillWorld();
  setHand(w, 'right', -0.45, 0.6, 0, true);
  frames(w, 2);
  setHand(w, 'right', -0.45, 0.6 + 1.3, 0, true); // hand jumps 1.3 m: more than the body can follow
  frame(w);
  ok(!w.cl.holding && count(w, 'climb:release', (e) => e.reason === 'stretch') === 1, 'a hand pulled further than maxStretch from its hold lets go (stretch)');
}
// Collision safety.
{
  const w = sillWorld();
  setHand(w, 'right', -0.45, 0.6, 0, true);
  frames(w, 2);
  let minX = 1e9;
  for (let i = 0; i < 120; i++) {
    setHand(w, 'right', 0.15, 0.6, 0, true); // the hold is now 0.6 m INTO the wall: the body is pushed against it
    frame(w);
    minX = Math.min(minX, w.p.x);
  }
  ok(minX > -11 + CONFIG.player.radius - 0.02, `pressed into the wall the body stays outside it (min x ${minX.toFixed(3)} vs wall ${(-11 + CONFIG.player.radius).toFixed(3)})`);
  ok(w.ph.health.hp === 1 && count(w, 'health:damage') === 0 && Number.isFinite(w.p.x), 'and takes no damage');
  const w2 = sillWorld();
  setHand(w2, 'right', -0.45, 0.6, 0, true);
  frames(w2, 2);
  for (let i = 0; i < 40; i++) {
    setHand(w2, 'right', -0.45, 0.6 - 0.02 * (i + 1) * 0.9, 0.0, true); // tries to drive the body UP into the ceiling-less shaft
    frame(w2);
  }
  ok(Math.abs(w2.p.vx) < 1 && Math.abs(w2.p.vz) < 1, 'pulling along the wall leaves no sideways drift');
}

// ---- 3. Stamina ----------------------------------------------------------------------------------------------------------
// Mid-air on the S2 east wall (x = 11, y -30): hold with one hand, then with two.
function airWorld(diffKey, y = -30) {
  const w = world(10.6, y, 4, diffKey);
  return w;
}
function holdOnEast(w, hands = ['right']) {
  for (const h of hands) setHand(w, h, 0.4, 0.5, 0, true);
  w.cl.probe(w.p, w.c);
  frame(w);
}
{
  const w = airWorld('normal');
  holdOnEast(w);
  ok(w.cl.holding && !w.p.grounded, 'hanging from the S2 east wall in mid-air');
  for (let i = 0; i < FPS * 10; i++) frame(w);
  const lost = 1 - w.cl.stamina;
  ok(near(lost, K.hangDrain * 10, 0.012), `hanging drains ${K.hangDrain}/s one-handed (lost ${lost.toFixed(3)} in 10 s)`);
  ok(near(w.p.y, -30, 0.05), 'and the body does not sag');
  const w2 = airWorld('normal');
  holdOnEast(w2, ['left', 'right']);
  for (let i = 0; i < FPS * 10; i++) frame(w2);
  ok(near(1 - w2.cl.stamina, K.hangDrain * K.twoHand * 10, 0.012), `two hands share the load (x${K.twoHand}: lost ${(1 - w2.cl.stamina).toFixed(3)})`);
  const w3 = airWorld('abyss');
  holdOnEast(w3);
  for (let i = 0; i < FPS * 10; i++) frame(w3);
  ok(near(1 - w3.cl.stamina, K.hangDrain * DIFFICULTY.abyss.climb.drainMul * 10, 0.015), 'Abyss drains faster than Normal (difficulty scaling)');
  const wet = world(-3.6, -180, 1.5); // S5 east sinew zone (wet), mid-air
  setHand(wet, 'right', 0.4, 0.5, 0, true);
  frame(wet);
  frames(wet, FPS * 5);
  ok(wet.cl.holding && wet.cl.wet && near(1 - wet.cl.stamina, K.hangDrain * K.wetMul * 5, 0.012), `a wet zone drains x${K.wetMul} (lost ${(1 - wet.cl.stamina).toFixed(3)} in 5 s)`);
}
// Climbing costs more than hanging.
{
  const w = airWorld('normal', -30);
  holdOnEast(w);
  for (let i = 0; i < FPS * 4; i++) {
    setHand(w, 'right', 0.4, 0.5 - 0.0194 * (i + 1), 0, true); // 1.4 m/s
    frame(w);
  }
  const lost = 1 - w.cl.stamina;
  ok(lost > K.hangDrain * 4 * 1.4 && lost < (K.hangDrain + K.moveDrain * 1.1) * 4, `moving drains more than hanging (lost ${lost.toFixed(3)} in 4 s at ~1.4 m/s)`);
}
// Empty: slip, lockout, resume level, refill on the ground.
{
  const w = airWorld('normal', -22.6); // 12 m above the hall floor (y -35): a fall is survivable damage-wise? (we only look at the grip)
  holdOnEast(w);
  w.cl.stamina = 0.02;
  frames(w, FPS * 2);
  ok(!w.cl.holding && w.cl.exhausted && count(w, 'climb:slip') === 1 && count(w, 'climb:release', (e) => e.reason === 'slip') === 1, 'at zero the hands slip (climb:slip, release slip)');
  ok(count(w, 'climb:strain') >= 1, 'a strain warning came before the slip');
  setHand(w, 'right', 0.4, 0.5, 0, true);
  frame(w);
  ok(!w.cl.holding && !w.cl.canGrip, 'cannot grip again straight away (lockout / exhausted)');
  // fall to the floor and recover
  w.p.y = -34.6;
  w.p.vy = 0;
  w.p.x = 5;
  w.c.grab.right = false;
  frames(w, FPS * 2);
  ok(w.p.grounded && w.cl.stamina > 0.5, `on solid ground the grip refills (stamina ${w.cl.stamina.toFixed(2)} after 2 s)`);
  frames(w, FPS * 2);
  ok(w.cl.stamina >= 0.99 && !w.cl.exhausted && w.cl.canGrip, 'and is full again in ~3 s');
  ok(near(K.regenGround, 0.4, 1e-9) && K.resumeAt > K.minStart && K.warnAt > K.resumeAt - 0.01, 'tuning order: minStart < resumeAt <= warnAt');
}
// warn level
{
  const w = airWorld('normal');
  holdOnEast(w);
  w.cl.stamina = K.warnAt * 0.5;
  frames(w, 5);
  ok(w.cl.warn > 0.4 && w.cl.warn < 0.6, `warn is 0..1 below ${K.warnAt} stamina (${w.cl.warn.toFixed(2)} at half of it)`);
}

// ---- 4. Desktop cling ------------------------------------------------------------------------------------------------------
{
  const w = world(10.56, -30, 4);
  w.c.vr = false;
  w.c.rx = 0;
  w.c.rz = -1; // looking west... view right = -z? (forward = (-1,0,0): right = (0,0,-1)... irrelevant to the climb)
  w.c.fx = -1;
  w.c.fz = 0;
  w.c.grab.left = w.c.grab.right = true;
  w.cl.probe(w.p, w.c);
  ok(w.cl.hands.left.hoverIn && w.cl.suppressYank('left'), 'desktop: F near a zone is a cling, not a yank');
  frame(w);
  ok(w.cl.holding && w.cl.mode === 2 && count(w, 'climb:grab') === 1, 'desktop: F takes the hold');
  frames(w, FPS / 2);
  ok(near(w.p.y, -30, 0.1) && near(w.p.x, 11 - K.deskHold, 0.06), `clinging holds against gravity at ${K.deskHold} m off the wall (y ${w.p.y.toFixed(2)}, x ${w.p.x.toFixed(2)})`);
  w.c.fwd = 1;
  const y0 = w.p.y;
  frames(w, FPS * 2);
  ok(near(w.p.y - y0, K.deskUp * 2, 0.35), `W climbs at ${K.deskUp} m/s (${(w.p.y - y0).toFixed(2)} m in 2 s)`);
  w.c.fwd = -1;
  const y1 = w.p.y;
  frames(w, FPS * 2);
  ok(w.p.y < y1 - 1.5, 'S climbs down');
  w.c.fwd = 0;
  w.c.side = 1;
  const z0 = w.p.z;
  frames(w, FPS * 2);
  ok(Math.abs(w.p.z - z0) > 0.8 && near(w.p.x, 11 - K.deskHold, 0.08), 'A / D traverse along the wall');
  w.c.side = 0;
  w.it.jumpPressed = true;
  frame(w);
  ok(!w.cl.holding && w.p.vy > 5 && w.p.vx < -2 && count(w, 'climb:hop') === 1, `Space hops off: up ${w.p.vy.toFixed(1)} and away from the wall (vx ${w.p.vx.toFixed(1)})`);
  frames(w, FPS / 2);
  w.c.grab.left = w.c.grab.right = false;
  frame(w);
  ok(!w.cl.holding, 'and F is needed again to take another hold');
}
{
  // a climb stops at the top of a zone, and letting go of F drops
  const w = world(10.56, -22.9, 4);
  w.c.grab.left = w.c.grab.right = true;
  w.c.fwd = 1;
  frames(w, FPS * 3);
  ok(w.cl.holding && w.p.y < -21.8 + 0.25, `climbing stops at the top of the zone (y ${w.p.y.toFixed(2)} vs top -21.8)`);
  w.c.grab.left = w.c.grab.right = false;
  w.c.fwd = 0;
  frames(w, FPS / 2);
  ok(!w.cl.holding && w.p.vy < -2, 'letting go of F drops the player');
}

// ---- 5. Works with the rope -------------------------------------------------------------------------------------------------
{
  const w = world(10.6, -30, 4);
  const anchor = w.level.anchors.find((a) => a.id === 's2-b1') || w.level.anchors[0];
  w.th.attach(w.p, 'left', anchor);
  holdOnEast(w);
  ok(w.th.hands.left.rope.attached && w.cl.holding, 'a rope can be attached and a hand can hold');
  const y0 = w.p.y;
  frames(w, FPS * 2);
  ok(w.th.hands.left.rope.attached && near(w.p.y, y0, 0.15) && w.cl.holding, 'the grip holds the body while tethered (the line does not tear it away)');
  setHand(w, 'right', 0.4, 0.5, 0, false);
  frame(w);
  ok(!w.cl.holding && w.th.hands.left.rope.attached, 'letting go leaves the line: it catches the body as usual');
}

// ---- 6. Determinism, dead players, no climb intent -----------------------------------------------------------------------------
{
  const run = () => {
    const w = sillWorld();
    setHand(w, 'right', -0.45, 0.6, 0, true);
    for (let i = 0; i < 90; i++) {
      setHand(w, 'right', -0.45, 0.6 - 0.006 * i, 0.001 * i, i < 70);
      frame(w);
    }
    return [w.p.x, w.p.y, w.p.z, w.p.vx, w.p.vy, w.p.vz, w.cl.stamina];
  };
  const a = run();
  const b = run();
  ok(a.every((v, i) => v === b[i]) && a.every(Number.isFinite), 'determinism: the same hand path gives bit-identical results');
}
{
  const w = sillWorld();
  const it = { move: { x: 0, z: 0 }, reel: 0, jumpPressed: false, brake: false, hands: { left: { yank: 0 }, right: { yank: 0 } } };
  for (let i = 0; i < 240; i++) w.ph.step(w.p, w.th, it, DT);
  ok(!w.cl.holding && !w.p.climbing && w.p.grounded && w.ph.health.hp === 1, 'a physics intent without a climb part (the route bot) is untouched');
  const w2 = world(0, 100, 0);
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < 20000; i++) {
    w2.p.y = 100;
    w2.p.vy = 0;
    w2.ph.step(w2.p, w2.th, it, DT);
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(ms < 400, `20000 idle steps with the climb model: ${ms.toFixed(0)} ms`);
}
{
  const w = sillWorld();
  setHand(w, 'right', -0.45, 0.6, 0, true);
  frames(w, 3);
  w.ph.kill(w.p, w.th, 'test');
  ok(!w.cl.holding && !w.p.alive, 'death lets go');
  const c2 = new Climb3D(w.level, DIFFICULTY.normal, null);
  c2.stamina = 0.5;
  const s = c2.snapshot();
  c2.stamina = 0.1;
  c2.restore(s);
  ok(c2.stamina === 0.5, 'snapshot / restore round-trips the stamina');
}

console.log(fails ? `\n${fails} CHECK(S) FAILED` : '\nclimb: all checks passed');
process.exitCode = fails ? 1 : 0;
