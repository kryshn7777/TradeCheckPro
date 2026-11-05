// THE CATCH (sim/catch3d.js), Node: the hit-stop on a lifesaving rope bite.
//   - the envelope (hold 0.1 s at x0.25, smoothstep back over 0.2 s) integrates to the expected lost time at any frame rate;
//   - a jolt under 75 % of the lethal speed does nothing; disabled = scale 1; no stacking during an envelope; reset;
//   - the real physics: a straight fall caught by a line emits rope:jolt with the vy BEFORE the bite (Physics3D), and that vy
//     fires the catch on a near-lethal fall and not on a short one.
//   node catch.mjs [--root DIR]   (PASS/FAIL per check, exit 1 on a failure)
import { srcUrl } from '../../verify/root.mjs';
const { CONFIG, DIFFICULTY, EventBus } = await import(srcUrl('sim/config3d.js'));
const { Player3D, TetherSystem, Physics3D } = await import(srcUrl('sim/physics3d.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { CatchMoment, CATCH } = await import(srcUrl('sim/catch3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const near = (a, b, e = 1e-6) => Math.abs(a - b) <= e;
const L = 17;

// 1. the envelope integrates to the lost time
{
  const expected = CATCH.hold * (1 - CATCH.scale) + CATCH.ease * (1 - CATCH.scale) * 0.5; // smoothstep averages 1/2
  ok(near(CatchMoment.lostTime(), expected) && near(expected, 0.15), `one envelope loses ${expected.toFixed(3)} s of sim time (0.15)`);
  for (const fps of [60, 72, 90, 37]) {
    const cm = new CatchMoment();
    ok(cm.onJolt(15, -0.8 * L, L, true) === true && cm.count === 1, `fps ${fps}: a 80 % lethal fall fires`);
    const dt = 1 / fps;
    let real = 0;
    let sim = 0;
    let minS = 1;
    for (let i = 0; i < fps; i++) {
      const s = cm.step(dt);
      if (s < minS) minS = s;
      real += dt;
      sim += s * dt;
    }
    ok(near(real - sim, expected, 1e-9), `fps ${fps}: 1 s of frames lose ${(real - sim).toFixed(4)} s (exact)`);
    ok(near(minS, CATCH.scale, 1e-9) && !cm.active && cm.step(dt) === 1, `fps ${fps}: held at x${CATCH.scale}, then back to 1 and idle`);
  }
  // inside a frame larger than the whole envelope the mean is still exact
  const cm = new CatchMoment();
  cm.onJolt(15, -16, L, true);
  ok(near(cm.step(1) * 1, 1 - expected), 'a 1 s frame: mean scale = 1 - lost');
}

// 2. thresholds, disabled, stacking, reset
{
  const cm = new CatchMoment();
  ok(cm.onJolt(15, -0.7 * L, L, true) === false && cm.step(1 / 60) === 1 && cm.count === 0, 'a 70 % lethal fall: nothing');
  ok(cm.onJolt(15, +20, L, true) === false, 'rising (vy > 0): nothing');
  ok(cm.onJolt(0, -16, L, true) === false, 'no jolt speed: nothing');
  ok(cm.onJolt(15, -16, L, false) === false && cm.step(1 / 60) === 1, 'disabled: nothing, scale 1');
  ok(cm.onJolt(15, -0.75 * 14.5, 14.5, true) === true, 'exactly 75 % of the Abyss lethal speed fires');
  cm.step(0.05);
  ok(cm.onJolt(15, -16, 14.5, true) === false && cm.count === 1, 'a second jolt inside the envelope does not restart it');
  cm.reset();
  ok(cm.count === 0 && !cm.active && cm.step(1 / 60) === 1, 'reset: idle, count 0');
}

// 3. the real physics: rope:jolt carries the vy before the bite
{
  const box = (id, x0, x1, y0, y1, z0, z1, kind = 'stone') => ({ id, minX: x0, maxX: x1, minY: y0, maxY: y1, minZ: z0, maxZ: z1, kind });
  const run = (drop) => {
    const DATA = { name: 'catch-test', solids: [box('floor', -30, 30, -200, -199, -30, 30)], anchors: [{ id: 'a', x: 0, y: 0, z: 0, kind: 'stone' }] };
    const level = new Level3D(DATA, 'normal', {});
    const diff = DIFFICULTY.normal;
    const bus = new EventBus();
    const jolts = [];
    bus.on('rope:jolt', (e) => jolts.push(e));
    const tethers = new TetherSystem(level, diff, bus, {});
    const physics = new Physics3D(level, diff, bus);
    const p = new Player3D(0, -1, 0);
    p.grounded = false;
    const an = level.anchors.find((a) => a.id === 'a') || DATA.anchors[0];
    tethers.attach(p, 'right', an);
    tethers.hands.right.rope.length = 1 + drop; // slack: the body falls `drop` m before the line bites
    const intent = { move: { x: 0, z: 0 }, hands: {} };
    for (let i = 0; i < 600 && !jolts.length; i++) physics.step(p, tethers, intent, CONFIG.PHYSICS_DT);
    return { jolt: jolts[0], diff };
  };
  const big = run(14);
  const small = run(2);
  ok(big.jolt && typeof big.jolt.vy === 'number', `rope:jolt carries vy (${big.jolt ? big.jolt.vy.toFixed(2) : '-'} m/s after a 14 m slack fall)`);
  const cm = new CatchMoment();
  ok(big.jolt && cm.onJolt(big.jolt.speed, big.jolt.vy, big.diff.lethalImpact, true), 'the 14 m slack fall caught by the line fires the catch');
  ok(!small.jolt || !new CatchMoment().onJolt(small.jolt.speed, small.jolt.vy, small.diff.lethalImpact, true), 'a 2 m slack fall does not');
}

console.log(fails ? `${fails} FAILED` : 'ALL PASS');
process.exitCode = fails ? 1 : 0;
