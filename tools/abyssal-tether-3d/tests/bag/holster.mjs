// The rope guns' holsters (sim/holster3d.js) and the 20 % slower ground walk with a gun out (Player3D.walkMul).
//   node holster.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
const Hm = await import(srcUrl('sim/holster3d.js'));
const { EventBus, CONFIG, DIFFICULTY } = await import(srcUrl('sim/config3d.js'));
const { Player3D, TetherSystem, Physics3D } = await import(srcUrl('sim/physics3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const DT = 1 / 72;
const mkIntent = () => ({ hands: { left: { pressed: false, held: false, released: false, aim: null }, right: { pressed: false, held: false, released: false, aim: null } } });
const mk = () => {
  const bus = new EventBus();
  const ev = [];
  bus.on('holster:draw', (p) => ev.push('draw:' + p.hand));
  bus.on('holster:stow', (p) => ev.push('stow:' + p.hand));
  return { h: new Hm.Holster3D(bus), ev };
};
const ctx = { live: true, grounded: true, busy: [false, false] };
const run = (h, secs, intent, c = ctx) => {
  for (let t = 0; t < secs - 1e-9; t += DT) {
    h.step(DT, intent, c);
    intent.hands.left.pressed = intent.hands.right.pressed = false;
  }
};

{
  const { h } = mk();
  ok(!h.out[0] && !h.out[1] && h.k[0] === 0 && h.walkMul === 1, 'a run starts with both guns holstered and the usual walk');
}
{
  // a press draws that hand's gun; the shot goes when the gun is out, never before, and is not lost
  const { h, ev } = mk();
  const it = mkIntent();
  it.hands.right.pressed = true;
  it.hands.right.held = true;
  h.step(DT, it, ctx);
  ok(it.hands.right.pressed === false, 'the press that draws is held back');
  ok(h.out[1] && !h.out[0] && ev.join() === 'draw:right', 'only the pressed hand draws');
  let fired = -1;
  let t = 0;
  while (t < 0.5) {
    h.step(DT, it, ctx);
    t += DT;
    if (it.hands.right.pressed) {
      fired = t;
      break;
    }
  }
  ok(fired > 0.1 && fired < 0.2, 'then fires at the end of the draw (' + fired.toFixed(3) + ' s, draw time ' + Hm.HOLSTER.drawTime + ')');
  ok(h.k[1] === 1 && h.walkMul === Hm.HOLSTER.walkMul, 'drawn: k = 1 and the walk is 0.8');
}
{
  // released before the gun is out: it is drawn, but no shot
  const { h } = mk();
  const it = mkIntent();
  it.hands.left.pressed = true;
  it.hands.left.held = true;
  h.step(DT, it, ctx);
  it.hands.left.held = false;
  let shot = false;
  for (let i = 0; i < 40; i++) {
    h.step(DT, it, ctx);
    if (it.hands.left.pressed) shot = true;
  }
  ok(!shot && h.out[0] && h.k[0] === 1, 'a tap released during the draw draws without firing');
}
{
  // auto-stow: only while standing about with nothing on the line
  const { h, ev } = mk();
  const it = mkIntent();
  h.toggle();
  ok(h.out[0] && h.out[1], 'toggle draws both');
  run(h, Hm.HOLSTER.autoAfter - 0.3, it);
  ok(h.out[0], 'not stowed before the timeout');
  run(h, 0.5, it);
  ok(!h.out[0] && !h.out[1] && ev.filter((e) => e.startsWith('stow')).length === 2, 'both go back after ' + Hm.HOLSTER.autoAfter + ' s idle on the ground');
  run(h, Hm.HOLSTER.stowTime + 0.05, it);
  ok(h.k[0] === 0 && h.walkMul === 1, 'fully stowed: the usual walk again');
  // airborne / a line out / a held trigger keep it out
  h.toggle();
  run(h, 10, it, { live: true, grounded: false, busy: [false, false] });
  ok(h.out[0], 'in the air a gun is never put away');
  run(h, 10, it, { live: true, grounded: true, busy: [true, true] });
  ok(h.out[0], 'with a line out it stays out');
  it.hands.left.held = true;
  it.hands.right.held = true;
  run(h, 10, it);
  ok(h.out[0] && h.out[1], 'a held trigger keeps it out');
}
{
  // toggle: any gun out stows both; reset puts them away; disabled = always out, usual walk
  const { h } = mk();
  const it = mkIntent();
  it.hands.right.pressed = true;
  h.step(DT, it, ctx);
  h.toggle();
  ok(!h.out[0] && !h.out[1], 'toggle with one gun out stows both');
  h.toggle();
  h.reset();
  ok(!h.out[0] && !h.out[1] && h.k[0] === 0, 'reset (a respawn) puts both away');
  h.setEnabled(false);
  h.step(DT, it, ctx);
  ok(h.out[0] && h.out[1] && h.k[0] === 1 && h.walkMul === 1, 'disabled (?holster=off): both out, the usual walk');
  it.hands.left.pressed = true;
  h.step(DT, it, ctx);
  ok(it.hands.left.pressed === true, 'disabled: presses pass straight through');
}
{
  // not live (paused / dead): the press is not touched
  const { h } = mk();
  const it = mkIntent();
  it.hands.left.pressed = true;
  h.step(DT, it, { live: false, grounded: true, busy: [false, false] });
  ok(it.hands.left.pressed === true && !h.out[0], 'not live: nothing happens');
}
{
  // physics: the ground walk is 0.8 with a gun out and exactly the old speed holstered; the air and the reel are untouched
  const level = new Level3D(undefined, 'normal');
  const settle = (walkMul) => {
    const p = new Player3D(-4, 0.4, 8.5);
    const bus = new EventBus();
    const phys = new Physics3D(level, DIFFICULTY.normal, bus);
    const tethers = new TetherSystem(level, DIFFICULTY.normal, bus, {});
    for (let i = 0; i < 100; i++) phys.step(p, tethers, {}, CONFIG.PHYSICS_DT); // settle onto the floor
    p.walkMul = walkMul;
    const intent = { move: { x: -1, z: 0 } };
    let best = 0;
    for (let i = 0; i < 360; i++) {
      phys.step(p, tethers, intent, CONFIG.PHYSICS_DT);
      if (p.grounded) best = Math.max(best, Math.hypot(p.vx, p.vz));
    }
    return best;
  };
  const v1 = settle(1);
  const v8 = settle(0.8);
  ok(v1 > 1 && Math.abs(v1 - CONFIG.player.runMaxSpeed) < 0.15, 'holstered: the walk reaches runMaxSpeed (' + v1.toFixed(2) + ' of ' + CONFIG.player.runMaxSpeed + ')');
  ok(Math.abs(v8 / v1 - 0.8) < 0.02, 'with a gun out the walk is 80 % of it (' + v8.toFixed(2) + ' / ' + v1.toFixed(2) + ' = ' + (v8 / v1).toFixed(3) + ')');
  const pDef = new Player3D(0, 0, 0);
  ok(pDef.walkMul === 1, 'a fresh player has walkMul 1 (the verify harness never sets it)');
}
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
