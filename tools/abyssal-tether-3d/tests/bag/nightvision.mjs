// The night vision goggles and the dark that is made on purpose (sim/nightVision3d.js).
//   node nightvision.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
const N = await import(srcUrl('sim/nightVision3d.js'));
const { EventBus } = await import(srcUrl('sim/config3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const mk = () => {
  const bus = new EventBus();
  const ev = [];
  for (const t of ['nv:on', 'nv:off', 'nv:refuse', 'nv:low', 'nv:flat', 'nv:ready']) bus.on(t, (p) => ev.push([t, p]));
  return { nv: new N.NightVision3D(bus), ev };
};
const run = (nv, secs, live = true, dt = 1 / 72) => {
  for (let t = 0; t < secs - 1e-9; t += dt) nv.update(dt, live);
};
const names = (ev) => ev.map((e) => e[0]).join(',');

{
  const { nv, ev } = mk();
  ok(!nv.on && nv.charge === 1 && nv.k === 0, 'starts off with a full cell');
  ok(nv.toggle() === true && nv.on, 'toggle turns it on');
  run(nv, 0.1);
  ok(nv.k > 0 && nv.k < 1, 'the tubes warm up over the ramp, not at once');
  run(nv, 0.5);
  ok(nv.k === 1 && nv.level === 1, 'fully warm: k = level = 1 while the cell is healthy');
  run(nv, 30);
  ok(Math.abs(nv.charge - (1 - 30.6 * N.NV.drain)) < 0.01, 'the cell drains while on (~2 minutes of use)');
  nv.toggle();
  ok(!nv.on && names(ev) === 'nv:on,nv:off', 'toggle off emits nv:off');
  run(nv, 0.4);
  ok(nv.k === 0, 'the picture spools down');
  const c0 = nv.charge;
  run(nv, 20);
  ok(nv.charge > c0 && nv.charge < c0 + 20 * N.NV.recharge * 1.01, 'the cell trickles back while off');
}
{
  const { nv, ev } = mk();
  nv.toggle();
  run(nv, 130);
  ok(!nv.on && nv.flat && nv.charge < N.NV.minOn, 'a flat cell switches the goggles off');
  ok(names(ev) === 'nv:on,nv:low,nv:off,nv:flat', 'events: on, low (once), off, flat (' + names(ev) + ')');
  ok(nv.toggle() === false && ev[ev.length - 1][0] === 'nv:refuse', 'a flat cell refuses to start');
  run(nv, N.NV.minOn / N.NV.recharge + 1);
  ok(!nv.flat && ev[ev.length - 1][0] === 'nv:ready', 'back above minOn the cell is ready again');
  ok(nv.toggle() === true, 'and they start');
}
{
  const { nv } = mk();
  nv.toggle();
  run(nv, 1);
  nv.update(1 / 72, false);
  ok(!nv.on, 'not live (a pause, a death): the goggles drop');
  const c = nv.charge;
  run(nv, 5, false);
  ok(nv.charge === c, 'nothing drains or charges while not live');
}
{
  const { nv } = mk();
  nv.toggle();
  run(nv, 60);
  nv.snapshot();
  run(nv, 30);
  nv.restore();
  ok(Math.abs(nv.charge - (1 - 60 * N.NV.drain)) < 0.02 && !nv.on, 'a checkpoint keeps the charge; a respawn puts the goggles down');
}
{
  // the low-charge stutter is bounded
  const { nv } = mk();
  nv.charge = 0.14;
  nv.toggle();
  run(nv, 0.6);
  let lo = 1;
  for (let i = 0; i < 72 * 2; i++) {
    nv.update(1 / 72, true);
    if (nv.level < lo) lo = nv.level;
  }
  ok(nv.on && lo >= 0.5 && lo < 1, 'a nearly flat cell stutters but never below ~55 % (' + lo.toFixed(2) + ')');
}
{
  // depth darkness: monotone, 0 at the surface, tables as long as the level has sections
  const secs = LEVEL_DATA_3D.sections.length;
  ok(N.DEPTH_DARK.length >= secs && N.DEPTH_LANTERN.length >= secs, 'the tables cover every section (' + secs + ')');
  let mono = true;
  for (let i = 1; i < N.DEPTH_DARK.length; i++) if (N.DEPTH_DARK[i] < N.DEPTH_DARK[i - 1] || N.DEPTH_LANTERN[i] > N.DEPTH_LANTERN[i - 1]) mono = false;
  ok(mono && N.DEPTH_DARK[0] === 0 && N.DEPTH_LANTERN[0] === 1, 'darker and a weaker lantern with every section, the first untouched');
  ok(N.DEPTH_DARK[N.DEPTH_DARK.length - 1] <= 0.7 && N.DEPTH_LANTERN[N.DEPTH_LANTERN.length - 1] >= 0.4, 'bounded: the bottom is dark, not black, and the lantern never dies of depth alone');
  ok(Math.abs(N.depthDarknessAt(2.5) - (N.DEPTH_DARK[2] + N.DEPTH_DARK[3]) / 2) < 1e-9, 'a fractional section interpolates');
  ok(N.depthDarknessAt(-3) === 0 && N.depthDarknessAt(99) === N.DEPTH_DARK[N.DEPTH_DARK.length - 1], 'clamped outside the table');
  ok(N.lanternFadeAt(0) === 1 && N.lanternFadeAt(99) === N.DEPTH_LANTERN[N.DEPTH_LANTERN.length - 1], 'lantern fade clamps');
  ok(Math.abs(N.foldDarkness(0.3, 0.6) - 0.72) < 1e-9 && N.foldDarkness(0.5, 0) === 0.5 && N.foldDarkness(0, 0.4) === 0.4 && N.foldDarkness(2, 2) === 1, 'folding: neither lightens the other, bounded at 1');
  ok(N.foldDarkness(0.3, N.DEPTH_DARK[7]) < 0.8, 'Normal at the bottom is below the Abyss darkness (0.85)');
}
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
