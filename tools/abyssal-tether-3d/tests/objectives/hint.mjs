// "After 20 seconds, if the player has not found the trigger that opens the grating, highlight the trigger" (sim/objectiveHint.js).
//   node hint.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';
const H = await import(srcUrl('sim/objectiveHint.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Objectives3D } = await import(srcUrl('sim/objectives3d.js'));
let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const run = (h, O, p, sec, playing, secs, dt = 0.25) => {
  for (let t = 0; t < secs - 1e-9; t += dt) h.update(dt, O, p, sec, playing);
};
// a stub objective: one bell
const stub = () => ({
  objectives: [{ index: 0, section: 0, seal: 0, fx: [0] }],
  fixtures: [{ x: 10, y: -2, z: 4, k: 1 }],
  done: [0],
  sealOpen: [0],
  count: [0],
  fxN: [0],
  fxDone: [0],
  fixtureDone(i) {
    return this.fxDone[i] === 1;
  },
});
const far = { x: -8, y: 0, z: 0 };

{
  const h = new H.ObjectiveHint();
  const O = stub();
  run(h, O, far, 0, true, 19);
  ok(!h.on, 'no hint before 20 s');
  run(h, O, far, 0, true, 2);
  ok(h.on && h.count === 1 && h.targets[0].x === 10 && h.targets[0].kind === 'bell', 'at 20 s the bell is marked');
  O.fxN[0] = 1;
  h.update(0.25, O, far, 0, true);
  ok(!h.on, 'progress hides the hint and restarts the clock');
  run(h, O, far, 0, true, 21);
  ok(h.on, 'it comes back after another 20 s without progress');
  O.fxDone[0] = 1;
  O.done[0] = 1;
  O.sealOpen[0] = 1;
  h.update(0.25, O, far, 0, true);
  ok(!h.on, 'the seal open: no hint');
}
{
  const h = new H.ObjectiveHint();
  const O = stub();
  run(h, O, far, 0, true, 15);
  run(h, O, far, 0, false, 40);
  ok(!h.on, 'dead / paused: the clock does not run');
  run(h, O, far, 0, true, 6);
  ok(h.on, '15 + 6 s of play: shown (a pause in between did not count)');
  const h2 = new H.ObjectiveHint();
  run(h2, O, far, 1, true, 40);
  ok(!h2.on, 'a section without an objective: nothing');
  const h3 = new H.ObjectiveHint();
  run(h3, O, far, 0, true, 15);
  run(h3, O, far, 1, true, 5);
  run(h3, O, far, 0, true, 10);
  ok(!h3.on, 'leaving the section restarts the clock');
}
{
  const h = new H.ObjectiveHint();
  const O = stub();
  const near = { x: 10, y: -2, z: 6 }; // 2 m from the bell
  run(h, O, near, 0, true, 60);
  ok(!h.on, 'standing at the trigger: found, no hint');
  run(h, O, far, 0, true, 21);
  ok(h.on, 'walking away from it for 20 s: shown');
}
// the real level: every section with a seal gets a target 20 s in
{
  const L = new Level3D(LEVEL_DATA_3D, DIFFICULTY.normal.levelVariant);
  const O = new Objectives3D(L, DIFFICULTY.normal, new EventBus());
  let n = 0;
  const bad = [];
  for (let si = 0; si < 8; si++) {
    const obj = O.objectives.find((o) => o.section === si);
    if (!obj) continue;
    const h = new H.ObjectiveHint();
    const cp = L.sections[si].checkpoint;
    run(h, O, { x: cp.x, y: cp.y + 200, z: cp.z }, si, true, 21); // far away from every trigger
    if (h.on && h.count >= 1 && isFinite(h.targets[0].x) && isFinite(h.targets[0].y)) n++;
    else bad.push(si);
  }
  ok(n >= 6 && bad.length === 0, `the real level: ${n} sections show their trigger(s) at 21 s (none missing: ${bad.join(',') || 'ok'})`);
}
console.log(fails ? `${fails} FAILED` : 'all passed');
process.exit(fails ? 1 : 0);
