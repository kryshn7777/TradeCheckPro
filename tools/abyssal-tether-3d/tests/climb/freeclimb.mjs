// FREE CLIMB, Node (reported from play): "the user can climb freely at any point, he can grab any object, any surface he wants" and
// "shoot rope with one hand and then grab that rope and then try to go up ... climbing with the own rope".
//   - SURFACE HOLDS (CONFIG.climb.surface): a palm within reach of any solid's surface hovers and grabs (VR); the hand snaps onto the face;
//     pulling the hand down climbs the wall; the drain is surfaceMul x; a hand with a line out does not (its grip is the yank); a hand in a
//     solid, an inactive (fallen) solid and the switch off do not;
//   - ROPE HOLDS: a line out on one hand can be gripped by the other (the line from its anchor to that hand); drawing the hand down along it
//     pulls the body up; the line takes in the slack behind the climber (letting go leaves it taut: you stay where you climbed to); the drain is
//     ropeMul x; a hand cannot grip its own line, a haul ring's line is not a hold, and the grip lets go when the line comes off.
//   node freeclimb.mjs [--root DIR]   (prints PASS/FAIL per check, exit 1 on a failure)
import { srcUrl } from '../../verify/root.mjs';
const { CONFIG, DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Player3D, TetherSystem, Physics3D } = await import(srcUrl('sim/physics3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const K = CONFIG.climb;
const DT = CONFIG.PHYSICS_DT;
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};

const box = (id, x0, x1, y0, y1, z0, z1, kind = 'stone') => ({ id, minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z0, maxZ: z1, kind });
const DATA = {
  name: 'free-climb-test',
  solids: [box('floor', -30, 30, -1, 0, -30, 30), box('wall', -30, 30, -1, 60, -31, -30, 'wall'), box('ceil', -8, 8, 40, 41, -8, 8), box('block', 4, 8, 0, 20, -2, 2)],
  anchors: [],
  climb: [],
};
function blankClimb() {
  const hand = () => ({ ok: false, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
  return { vr: true, grab: { left: false, right: false }, fwd: 0, side: 0, rx: 1, rz: 0, fx: 0, fz: -1, hands: { left: hand(), right: hand() } };
}
function world(x, y, z) {
  const bus = new EventBus();
  const ev = [];
  for (const t of ['climb:grab', 'climb:release', 'climb:slip']) bus.on(t, (p) => ev.push([t, p]));
  const level = new Level3D(DATA, 'normal', { freeAttach: true });
  const diff = DIFFICULTY.normal;
  const th = new TetherSystem(level, diff, bus, {});
  const ph = new Physics3D(level, diff, bus);
  const p = new Player3D(x, y, z);
  p.rx = x;
  p.ry = y;
  p.rz = z;
  p.grounded = false;
  const it = { move: { x: 0, z: 0 }, reel: 0, jumpPressed: false, brake: false, hands: { left: { yank: 0 }, right: { yank: 0 } }, climb: blankClimb() };
  return { bus, ev, level, th, ph, p, it, c: it.climb, cl: ph.climb };
}
function frame(w, fdt = 3 * DT) {
  w.cl.tethers = w.th;
  w.cl.probe(w.p, w.c);
  let acc = fdt;
  while (acc >= DT - 1e-9) {
    w.ph.step(w.p, w.th, w.it, DT);
    acc -= DT;
    if (!w.p.alive) break;
  }
}
const frames = (w, n) => {
  for (let i = 0; i < n; i++) frame(w);
};
const setHand = (w, h, rx, ry, rz, grab) => {
  const b = w.c.hands[h];
  b.ok = true;
  b.rx = rx;
  b.ry = ry;
  b.rz = rz;
  w.c.grab[h] = grab;
};
const anchorAbove = (w, y = 39.9) => w.th.attach(w.p, 'left', { id: 'a', x: w.p.x, y, z: w.p.z, kind: 'ring', normal: { x: 0, y: -1, z: 0 } });

// 1. Surface holds.
{
  // the block's west face is x = 4: the body hangs at x = 3.6, the right palm 0.1 m from the face
  const w = world(3.5, 8, 0);
  setHand(w, 'right', 0.4, 0.3, 0, false);
  frame(w);
  const r = w.cl.hands.right;
  ok(r.hover && r.hoverIn && r.hzone && r.hzone.surface === true, 'a palm 0.1 m off a plain wall hovers and can grab (a surface hold)');
  ok(Math.abs(r.hx - 4) < 1e-6, 'the hold is the nearest point of the face (x = 4)');
  setHand(w, 'right', 0.4, 0.3, 0, true);
  frames(w, 4);
  ok(r.gripping && r.zone.surface === true && Math.abs(r.ax - 4) < 1e-6, 'the grip takes the surface, the hand snapped onto the face');
  ok(w.ev.some((e) => e[0] === 'climb:grab' && e[1].hand === 'right'), 'climb:grab is emitted');
  const y0 = w.p.y;
  // draw the hand down 0.6 m along the wall: the body goes UP by as much (hand-delta locomotion)
  for (let i = 0; i < 30; i++) {
    setHand(w, 'right', 0.4, 0.3 - 0.02 * (i + 1), 0, true);
    frame(w);
  }
  ok(w.p.y - y0 > 0.4, `drawing the hand down the wall climbs it (y ${y0.toFixed(2)} -> ${w.p.y.toFixed(2)})`);
  ok(w.cl.holding && r.zone.surface === true, 'the body is held by the surface hold the whole way');
  // the drain rate
  const a = world(3.5, 8, 0);
  setHand(a, 'right', 0.4, 0.3, 0, true);
  frames(a, 4);
  const s0 = a.cl.stamina;
  frames(a, 80);
  const dSurf = s0 - a.cl.stamina;
  ok(dSurf > 0 && a.cl.hands.right.gripping, `hanging on a surface drains the grip (${(dSurf * 100).toFixed(2)} % in 1 s)`);
  const base = K.hangDrain * K.surfaceMul * (DIFFICULTY.normal.climb && DIFFICULTY.normal.climb.drainMul ? DIFFICULTY.normal.climb.drainMul : 1) * (80 * 3 * DT);
  ok(Math.abs(dSurf - base) < base * 0.25, `... at surfaceMul x the hanging rate (${(base * 100).toFixed(2)} % expected)`);
  // a hand with a line out keeps its grip for the yank
  const b = world(3.5, 8, 0);
  b.th.attach(b.p, 'right', { id: 'a', x: 3.5, y: 39.9, z: 0, kind: 'ring', normal: { x: 0, y: -1, z: 0 } });
  setHand(b, 'right', 0.4, 0.3, 0, true);
  frames(b, 6);
  ok(!b.cl.hands.right.gripping && !b.cl.hands.right.hover, 'a hand with a line out does not take a surface hold (its grip is the yank)');
  // switch off
  const sv = K.surface;
  K.surface = false;
  const c = world(3.5, 8, 0);
  setHand(c, 'right', 0.4, 0.3, 0, true);
  frames(c, 6);
  ok(!c.cl.hands.right.gripping, 'CONFIG.climb.surface = false: no surface holds');
  K.surface = sv;
  // a fallen ledge is not a hold
  DATA.solids.push(box('crumb', -6, -2, 4, 5, -2, 2, 'crumble'));
  const d = world(-4, 3.2, 0);
  const crumb = d.level.solids.find((s) => s.id === 'crumb');
  setHand(d, 'right', 0, 0.7, 0, true); // palm at y 3.9: 0.1 m under the ledge's underside (y = 4)
  frame(d);
  const had = d.cl.hands.right.hover;
  crumb.active = false;
  frame(d);
  ok(had && !d.cl.hands.right.hover, 'a solid that has fallen (inactive) is no longer a hold');
  DATA.solids.pop();
  // open air: nothing
  const e = world(0, 20, 0);
  setHand(e, 'left', -0.3, 0.2, 0, true);
  frames(e, 4);
  ok(!e.cl.hands.left.gripping && !e.cl.hands.left.hover, 'open air is no hold');
}

// 2. Rope holds.
{
  const w = world(0, 20, 0);
  anchorAbove(w);
  const lr = w.th.hands.left.rope;
  // the left hand (the launcher) is at the body's left; the line runs from the anchor (0, 39.9, 0) to it
  setHand(w, 'left', -0.3, 0.1, 0.1, false);
  setHand(w, 'right', 0.3, 0.1, 0.1, false);
  // the right palm is 0.3 m from the line's end... put it ON the line: the line goes from (0,39.9,0) to (-0.3, 20.1, 0.1)
  setHand(w, 'right', -0.29, 0.6, 0.1, false); // (-0.29, 20.6, 0.1): on the line
  frame(w);
  const r = w.cl.hands.right;
  ok(r.hover && r.hzone && r.hzone.rope === true && r.hzone.ropeOf === 'left', 'the right palm on the left hand\'s line hovers it (a rope hold)');
  ok(!w.cl.hands.left.hover, 'the left hand cannot grip its own line (it holds the launcher; the grip is its yank)');
  setHand(w, 'right', -0.29, 0.6, 0.1, true);
  frames(w, 4);
  ok(r.gripping && r.zone.rope === true, 'gripping on the line takes the rope hold');
  const y0 = w.p.y;
  const len0 = lr.length;
  for (let i = 0; i < 40; i++) {
    setHand(w, 'right', -0.29, 0.6 - 0.02 * (i + 1), 0.1, true); // draw the hand down 0.8 m
    frame(w);
  }
  ok(w.p.y - y0 > 0.5, `drawing the hand down the line pulls the body up it (y ${y0.toFixed(2)} -> ${w.p.y.toFixed(2)})`);
  ok(lr.length < len0 - 0.4, `the line takes in the slack as you climb (${len0.toFixed(2)} -> ${lr.length.toFixed(2)} m)`);
  ok(lr.length >= lr.d - 0.05, 'it is never loose below you: the length stays at the distance to the anchor');
  // let go: the body stays up (the line is taut at that length), no free fall
  const yRel = w.p.y;
  setHand(w, 'right', -0.29, -0.2, 0.1, false);
  frames(w, 40);
  ok(!r.gripping && w.p.y > yRel - 0.8, `let go: you hang on the line where you climbed to (y ${yRel.toFixed(2)} -> ${w.p.y.toFixed(2)}, no long drop)`);
  // the drain
  const a = world(0, 20, 0);
  anchorAbove(a);
  setHand(a, 'left', -0.3, 0.1, 0.1, false);
  setHand(a, 'right', -0.29, 0.6, 0.1, true);
  frames(a, 4);
  const s0 = a.cl.stamina;
  frames(a, 80);
  const dRope = s0 - a.cl.stamina;
  const base = K.hangDrain * K.ropeMul * (80 * 3 * DT);
  ok(a.cl.hands.right.gripping && Math.abs(dRope - base) < base * 0.3, `hanging on your own line drains at ropeMul x (${(dRope * 100).toFixed(2)} % in 1 s, ${(base * 100).toFixed(2)} % expected)`);
  // the line comes off: the grip lets go
  const b = world(0, 20, 0);
  anchorAbove(b);
  setHand(b, 'left', -0.3, 0.1, 0.1, false);
  setHand(b, 'right', -0.29, 0.6, 0.1, true);
  frames(b, 4);
  const holding = b.cl.hands.right.gripping;
  b.th.release(b.p, 'left', 'input');
  frames(b, 3);
  ok(holding && !b.cl.hands.right.gripping && b.ev.some((e) => e[0] === 'climb:release' && e[1].reason === 'zone'), 'the line comes off: the grip lets go (reason zone)');
  // a haul ring's line is not a hold
  const c = world(0, 20, 0);
  anchorAbove(c);
  c.th.hands.left.rope.anchor.haul = true;
  setHand(c, 'left', -0.3, 0.1, 0.1, false);
  setHand(c, 'right', -0.29, 0.6, 0.1, true);
  frames(c, 4);
  ok(!c.cl.hands.right.gripping, 'a haul ring\'s line is not a hold');
  // far from the line: nothing
  const d = world(0, 20, 0);
  anchorAbove(d);
  setHand(d, 'left', -0.3, 0.1, 0.1, false);
  setHand(d, 'right', 0.6, 0.6, 0.1, true);
  frames(d, 4);
  ok(!d.cl.hands.right.gripping, 'a palm 0.9 m from the line grips nothing');
  // two lines: each hand can climb the other's
  const e = world(0, 20, 0);
  e.th.attach(e.p, 'left', { id: 'a', x: -0.3, y: 39.9, z: 0.1, kind: 'ring', normal: { x: 0, y: -1, z: 0 } });
  setHand(e, 'left', -0.3, 0.1, 0.1, true);
  frames(e, 3);
  ok(!e.cl.hands.left.gripping, 'a hand with a line out and the grip squeezed does not take a hold (it yanks)');
}

// 3. The physics hook.
{
  const w = world(0, 20, 0);
  anchorAbove(w);
  const lr = w.th.hands.left.rope;
  lr.length = 15; // slack: the body is 19.9 m from the anchor... make it a long line
  ok(!w.cl.ropeHeld('left') && !w.cl.ropeHeld('right'), 'ropeHeld is false with nothing gripped');
}

console.log(fails ? `FAILED: ${fails}` : 'ALL FREE CLIMB CHECKS PASS');
process.exit(fails ? 1 : 0);
