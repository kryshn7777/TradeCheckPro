// ROPE HAND PULL + LAUNCHER COOLDOWN, Node (reported from play):
//   "when the user shoots the rope and pulls his arm back, the rope extends, but I need him to go forward, like the rope is pulling him"
//   "you cannot continuously shoot the rope ... it will need some sort of cooldown before you can use the rope again, shown on your wrist"
//
//   - RopePull (sim/ropePull.js): the hand drawn back from the anchor is a reel speed (deadzone, gain, cap, smoothing); a hand resting, pushed
//     forward, or without a line is not; a new line starts a fresh stroke;
//   - Physics3D.step: `intent.hands[h].pull` reels the line in (the body is pulled toward the anchor); a haul ring ignores it; the yank wins;
//   - TetherSystem cooldown (settings.ropeCooldown): the second shot of a hand is refused until the recharge is over, the other hand is
//     independent, a press in the last moments is queued, `charge()` / `rope:dry` feed the wrist bar, a dead player starts charged, and a
//     system built with plain settings (the tools, the other tests) has no cooldown at all.
//   node ropehand.mjs [--root DIR]   (prints PASS/FAIL per check, exit 1 on a failure)
import { srcUrl } from '../../verify/root.mjs';
const { CONFIG, DIFFICULTY, EventBus, SETTINGS_DEFAULTS } = await import(srcUrl('sim/config3d.js'));
const { Player3D, TetherSystem, Physics3D } = await import(srcUrl('sim/physics3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { RopePull } = await import(srcUrl('sim/ropePull.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = CONFIG.PHYSICS_DT;
const K = CONFIG.rope.handPull;
const box = (id, x0, x1, y0, y1, z0, z1, kind = 'stone') => ({ id, minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z0, maxZ: z1, kind });
const DATA = {
  name: 'rope-hand-test',
  solids: [box('floor', -30, 30, -1, 0, -30, 30), box('wall', -30, 30, -1, 40, -31, -30, 'wall'), box('ceil', -6, 6, 12, 13, -6, 6)],
  anchors: [],
};

function rig(settings, diffOver) {
  const level = new Level3D(DATA, 'normal', { freeAttach: true });
  const diff = Object.assign({}, DIFFICULTY.normal, diffOver || {});
  const bus = new EventBus();
  const ev = [];
  for (const n of ['rope:fire', 'rope:dry', 'grapple:attach', 'grapple:miss', 'grapple:release']) bus.on(n, (e) => ev.push([n, e]));
  const tethers = new TetherSystem(level, diff, bus, settings || {});
  const physics = new Physics3D(level, diff, bus);
  const p = new Player3D(0, 5, 0);
  p.grounded = false;
  return { level, diff, bus, ev, tethers, physics, p };
}
const aimUp = { ox: 0, oy: 6.5, oz: 0, dx: 0, dy: 1, dz: 0 };
const aimMiss = { ox: 0, oy: 6.5, oz: 0, dx: 1, dy: 0, dz: 0 };
function frame(r, intent, dt = 1 / 60) {
  r.tethers.updateTargets(r.p, intent);
  r.tethers.handleInput(r.p, intent, dt);
  const n = Math.round(dt / DT);
  for (let i = 0; i < n; i++) r.physics.step(r.p, r.tethers, intent, DT);
}
const shots = (r) => r.ev.filter((e) => e[0] === 'rope:fire').length;

// 1. RopePull.
{
  const rp = new RopePull();
  const dt = 1 / 72;
  // the anchor is straight above the body: n (anchor -> body) = (0, -1, 0); a hand drawn back is a hand moving DOWN and behind: s = r . n
  let s = 0;
  let last = 0;
  ok(rp.step(0, true, 0, 0.3, 0.2, 0, -1, 0, dt) === 0, 'the first sample of a stroke is no pull');
  for (let i = 0; i < 40; i++) {
    s += 1.2 * dt; // 1.2 m/s away from the anchor
    last = rp.step(0, true, 0, 0.3 - s, 0.2, 0, -1, 0, dt);
  }
  const want = (1.2 - K.deadzone) * K.gain;
  ok(Math.abs(last - want) < 0.08, `a hand drawn back at 1.2 m/s reels at (1.2 - ${K.deadzone}) x ${K.gain} = ${want.toFixed(2)} m/s (${last.toFixed(2)})`);
  for (let i = 0; i < 60; i++) last = rp.step(0, true, 0, 0.3 - s, 0.2, 0, -1, 0, dt);
  ok(last === 0, 'a hand that stops pulls no more (the reel stops with the stroke)');
  for (let i = 0; i < 40; i++) {
    s -= 1.2 * dt; // pushed forward again
    last = rp.step(0, true, 0, 0.3 - s, 0.2, 0, -1, 0, dt);
  }
  ok(last === 0, 'pushing the hand forward again pays no line out (a ratchet: pull, reset, pull)');
  let fast = 0;
  for (let i = 0; i < 40; i++) {
    s += 9 * dt;
    fast = rp.step(0, true, 0, 0.3 - s, 0.2, 0, -1, 0, dt);
  }
  ok(fast === K.max, `a violent stroke is capped at ${K.max} m/s`);
  const slow = new RopePull();
  let ss = 0;
  let sl = 0;
  slow.step(1, true, 0, 0, 0, 0, -1, 0, dt);
  for (let i = 0; i < 80; i++) {
    ss += 0.2 * dt;
    sl = slow.step(1, true, 0, -ss, 0, 0, -1, 0, dt);
  }
  ok(sl === 0, `a hand drifting back at 0.2 m/s (under the ${K.deadzone} m/s deadzone) is not a pull`);
  ok(rp.step(0, false, 0, 0, 0, 0, -1, 0, dt) === 0 && Number.isNaN(rp.prev[0]), 'no line / no hand pose: nothing, and the next stroke starts fresh');
  ok(rp.step(0, true, 0, -5, 0, 0, -1, 0, dt) === 0, 'after that the first sample is again no pull (no jump from a stale position)');
  ok(rp.step(1, true, 0, 0, 0, 0, -1, 0, 0) === 0, 'dt 0 is safe');
  rp.reset();
  ok(Number.isNaN(rp.prev[0]) && rp.pull[0] === 0 && rp.rate[1] === 0, 'reset clears both hands');
}

// 2. Physics3D.step: the pull reels the line in.
{
  const mk = () => {
    const r = rig({});
    r.p.y = 5;
    r.tethers.attach(r.p, 'left', { id: 'a', x: 0, y: 11.9, z: 0, kind: 'ring', normal: { x: 0, y: -1, z: 0 } });
    return r;
  };
  const r0 = mk();
  for (let i = 0; i < 30; i++) frame(r0, { hands: { left: { pull: 0 } } });
  const rope0 = r0.tethers.hands.left.rope;
  const r1 = mk();
  const rope1 = r1.tethers.hands.left.rope;
  const len0 = rope1.length;
  for (let i = 0; i < 30; i++) frame(r1, { hands: { left: { pull: 4 } } });
  ok(rope1.length < len0 - 1.5, `a 4 m/s hand pull shortens the line (${len0.toFixed(2)} -> ${rope1.length.toFixed(2)} m in 0.5 s)`);
  ok(r1.p.y > r0.p.y + 1, `... and pulls the body toward the anchor (y ${r0.p.y.toFixed(2)} without the pull, ${r1.p.y.toFixed(2)} with)`);
  ok(rope0.length > len0 - 0.05, 'without a pull the line keeps its length');
  const r2 = mk();
  r2.tethers.hands.left.rope.anchor.haul = true;
  const l2 = r2.tethers.hands.left.rope.length;
  for (let i = 0; i < 30; i++) frame(r2, { hands: { left: { pull: 6 } } });
  ok(r2.tethers.hands.left.rope.length > l2 - 0.05, 'a haul ring ignores the hand pull (hauling never moves you)');
  const r3 = mk();
  for (let i = 0; i < 30; i++) frame(r3, { hands: { left: { pull: 0.005 } } });
  ok(r3.tethers.hands.left.rope.length > len0 - 0.05, 'a pull under 0.01 m/s is noise');
  const r4 = mk();
  const rr = r4.tethers.hands.left.rope;
  for (let i = 0; i < 30; i++) frame(r4, { hands: { left: { pull: 1, yank: 1 } } });
  ok(len0 - rr.length > 3, 'the grip yank (17 m/s) still wins over a gentle pull');
  const r5 = mk();
  for (let i = 0; i < 6; i++) frame(r5, { hands: { right: { pull: 5 } } });
  ok(Math.abs(r5.tethers.hands.left.rope.length - len0) < 0.3, 'a pull on the other hand does not reel a line on this one');
}

// 3. Cooldown.
{
  const cd = 1.5;
  const r = rig({ ropeCooldown: cd });
  const press = (hand, aim, extra) => ({ hands: { [hand]: Object.assign({ aim, pressed: true, held: true }, extra) } });
  const hold = (hand, aim) => ({ hands: { [hand]: { aim, held: true } } });
  const rel = (hand) => ({ hands: { [hand]: { held: false, released: true } } });
  ok(r.tethers.cooldownTime() === cd && r.tethers.charge('left') === 1 && r.tethers.charge('right') === 1, `settings.ropeCooldown = ${cd}: both launchers start charged`);
  frame(r, press('left', aimUp));
  ok(shots(r) === 1 && r.tethers.hands.left.cool > 1.4, 'the first pull fires and starts the recharge');
  for (let i = 0; i < 30; i++) frame(r, hold('left', aimUp));
  ok(r.tethers.hands.left.rope.attached, 'the line holds while the trigger is held (the cooldown is about the next shot)');
  const c1 = r.tethers.charge('left');
  ok(c1 > 0.3 && c1 < 0.6, `after 0.5 s the bar is a third full (${c1.toFixed(2)})`);
  frame(r, rel('left'));
  frame(r, press('left', aimUp));
  ok(shots(r) === 1 && r.ev.some((e) => e[0] === 'rope:dry' && e[1].hand === 'left' && e[1].left > 0.9), 'a second pull while recharging is refused (rope:dry carries the time left)');
  ok(!r.tethers.hands.left.rope.attached && !r.tethers.hands.left.flying, 'nothing was shot');
  frame(r, press('right', aimUp));
  ok(shots(r) === 2, 'the other hand has its own launcher');
  frame(r, rel('right'));
  for (let i = 0; i < 70; i++) frame(r, {});
  ok(r.tethers.charge('left') === 1 && r.tethers.hands.left.cool === 0, 'after the recharge the launcher is ready again (charge 1)');
  frame(r, press('left', aimUp));
  ok(shots(r) === 3, 'and it fires');
  frame(r, rel('left'));
  // a whiff costs the shot too
  const w = rig({ ropeCooldown: cd });
  frame(w, press('left', aimMiss));
  ok(w.ev.some((e) => e[0] === 'grapple:miss') && w.tethers.hands.left.cool > 1.4, 'a shot that finds nothing also starts the recharge');
  // the queue: a press in the last 0.25 s, trigger still held, fires when the launcher is ready
  const q = rig({ ropeCooldown: cd });
  frame(q, press('left', aimMiss));
  frame(q, rel('left'));
  for (let i = 0; i < 80; i++) frame(q, {});
  const left = q.tethers.hands.left.cool;
  ok(left > 0.1 && left < 0.25, `(${left.toFixed(2)} s of recharge left)`);
  const n0 = shots(q);
  frame(q, press('left', aimMiss));
  ok(shots(q) === n0 && q.tethers.hands.left.queued, 'a pull in the last quarter second is queued, not lost');
  for (let i = 0; i < 20; i++) frame(q, hold('left', aimMiss));
  ok(shots(q) === n0 + 1, 'and fires when the recharge ends (trigger still held)');
  const q2 = rig({ ropeCooldown: cd });
  frame(q2, press('left', aimMiss));
  frame(q2, rel('left'));
  for (let i = 0; i < 40; i++) frame(q2, {});
  frame(q2, press('left', aimMiss));
  ok(!q2.tethers.hands.left.queued, 'a pull early in the recharge is not queued');
  const q3 = rig({ ropeCooldown: cd });
  frame(q3, press('left', aimMiss));
  frame(q3, rel('left'));
  for (let i = 0; i < 80; i++) frame(q3, {});
  const m0 = shots(q3);
  frame(q3, press('left', aimMiss));
  frame(q3, rel('left'));
  for (let i = 0; i < 20; i++) frame(q3, {});
  ok(shots(q3) === m0, 'a queued pull whose trigger was let go does not fire');
  // death starts a life charged
  const d = rig({ ropeCooldown: cd });
  frame(d, press('left', aimMiss));
  d.p.alive = false;
  frame(d, {});
  ok(d.tethers.hands.left.cool === 0, 'a dead player: the launchers are charged for the next life');
}

// 4. No cooldown by default, and the setting.
{
  const r = rig({});
  ok(r.tethers.cooldownTime() === 0 && r.tethers.charge('left') === 1, 'a system built with plain settings (the tools, the other tests) has no cooldown');
  let n = 0;
  for (let i = 0; i < 6; i++) {
    frame(r, { hands: { left: { aim: aimMiss, pressed: true, held: true } } });
    frame(r, { hands: { left: { held: false, released: true } } });
    n = shots(r);
  }
  ok(n === 6, 'six pulls in a row all fire');
  ok(SETTINGS_DEFAULTS.ropeCooldown === 1.5, 'the game default is a 1.5 s recharge');
  ok(rig({ ropeCooldown: 99 }).tethers.cooldownTime() === 6 && rig({ ropeCooldown: -3 }).tethers.cooldownTime() === 0 && rig({ ropeCooldown: 'x' }).tethers.cooldownTime() === 0, 'the setting is clamped to 0..6 s and junk is no cooldown');
  const f = rig({ ropeCooldown: 1.5 });
  f.tethers.fire(f.p, 'left', aimMiss);
  f.tethers.fire(f.p, 'left', aimMiss);
  ok(shots(f) === 2 && f.tethers.hands.left.cool === 0, 'fire() itself (the debug API, the bots) is not gated: only the player trigger is');
}

console.log(fails ? `FAILED: ${fails}` : 'ALL ROPE HAND CHECKS PASS');
process.exit(fails ? 1 : 0);
