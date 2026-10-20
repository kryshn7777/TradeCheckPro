// Node tests for platform/governor.js: the XR frame-time governor steps down under missed frames, recovers with
// hysteresis and back-off, ignores hitches / pauses, honours reducedEffects, applies foveation / fx tier / viewport
// scale / target frame rate, and allocates nothing per frame.
// Run: node tools/abyssal-tether-3d/tests/release/test-governor.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';

const { QualityGovernor, GOVERNOR_STEPS, REDUCED_FLOOR } = await import(srcUrl('platform/governor.js'));
const { EventBus } = await import(srcUrl('sim/config3d.js'));

let pass = 0;
let fail = 0;
const ok = (c, m) => {
  if (c) pass++;
  else {
    fail++;
    console.log('FAIL:', m);
  }
};

function fakeGame(over = {}) {
  const fov = [];
  const scales = [];
  const rates = [];
  const views = [{ requestViewportScale: (s) => scales.push(s) }, { requestViewportScale: (s) => scales.push(s) }];
  const game = {
    state: 'playing',
    settings: {},
    bus: new EventBus(),
    renderer: { renderer: { xr: { setFoveation: (v) => fov.push(v), getReferenceSpace: () => ({}) } } },
    ...over,
  };
  const session = { supportedFrameRates: [72, 90, 120], updateTargetFrameRate: async (r) => void rates.push(r) };
  const frame = { getViewerPose: () => ({ views }) };
  return { game, fov, scales, rates, session, frame };
}
const T = 1 / 72;
function run(g, gov, seconds, dt, frame) {
  const n = Math.round(seconds / dt);
  for (let i = 0; i < n; i++) gov.sample(dt, frame);
}

// session start: foveation of level 0, target frame rate, scale applied through the next frame, fx tier
{
  const f = fakeGame();
  const gov = new QualityGovernor(f.game);
  gov.onSessionStart(f.session);
  ok(f.fov[0] === GOVERNOR_STEPS[0].foveation, 'session start applies level 0 foveation');
  ok(f.game.settings.fxQuality === 'quest', 'level 0 fx tier is quest');
  ok(gov.active, 'active in a session');
  gov.sample(T, f.frame);
  ok(f.scales.length === 2 && f.scales[0] === 1, 'viewport scale requested for both views on the first frame');
  ok(f.rates[0] === 72, 'asks for 72 Hz');
}
// healthy: no change over a minute
{
  const f = fakeGame();
  const gov = new QualityGovernor(f.game);
  gov.onSessionStart(f.session);
  run(f.game, gov, 60, T, f.frame);
  ok(gov.level === 0 && gov.stats.degrades === 0, 'a healthy 72 fps never changes the level');
}
// degrade: sustained misses step down, one level per cooldown, down to the floor, never below
{
  const f = fakeGame();
  const gov = new QualityGovernor(f.game);
  const changes = [];
  f.game.bus.on('quality:level', (e) => changes.push(e.level));
  gov.onSessionStart(f.session);
  run(f.game, gov, 1.5, T, f.frame); // fill the window
  run(f.game, gov, 12, 1 / 40, f.frame); // 25 ms frames: every frame a miss
  ok(gov.level === GOVERNOR_STEPS.length - 1, `degrades to the last level (got ${gov.level})`);
  ok(changes.join(',') === '1,2,3,4', `one step at a time: ${changes.join(',')}`);
  ok(f.game.settings.fxQuality === 'low', 'level 3+ forces the low fx tier');
  ok(f.fov[f.fov.length - 1] === 1, 'high foveation at the cheap levels');
  gov.sample(T, f.frame);
  ok(f.scales[f.scales.length - 1] === 0.7, 'scale 0.7 at the last level');
  run(f.game, gov, 5, 1 / 30, f.frame);
  ok(gov.level === GOVERNOR_STEPS.length - 1, 'never goes below the last level');
}
// a couple of dropped frames do not trigger it
{
  const f = fakeGame();
  const gov = new QualityGovernor(f.game);
  gov.onSessionStart(f.session);
  for (let i = 0; i < 400; i++) gov.sample(i % 90 === 0 ? 2 * T : T, f.frame);
  ok(gov.level === 0, 'isolated drops (1 in 90) are tolerated');
}
// hitches (loading, system dialog) and non-playing states are ignored
{
  const f = fakeGame();
  const gov = new QualityGovernor(f.game);
  gov.onSessionStart(f.session);
  for (let i = 0; i < 300; i++) gov.sample(i % 10 === 0 ? 1.5 : T, f.frame);
  ok(gov.level === 0 && gov.stats.hitches > 0, 'frames over 250 ms are hitches, not load');
  f.game.state = 'paused';
  run(f.game, gov, 10, 1 / 20, f.frame);
  ok(gov.level === 0, 'slow frames while paused do not degrade');
}
// recovery: calm for RECOVER_AFTER, one level at a time; flapping doubles the wait
{
  const f = fakeGame();
  const gov = new QualityGovernor(f.game);
  gov.onSessionStart(f.session);
  gov.setLevel(2, 'test');
  ok(gov.level === 2, 'setLevel');
  run(f.game, gov, 6, T, f.frame);
  ok(gov.level === 2, 'does not recover before the calm period');
  run(f.game, gov, 8, T, f.frame);
  ok(gov.level === 1, `recovers one step after ~10 s calm (level ${gov.level})`);
  run(f.game, gov, 12, T, f.frame);
  ok(gov.level === 0, 'and another');
  // flapping: recover then degrade soon after -> longer wait
  gov.setLevel(1, 'test');
  run(f.game, gov, 11, T, f.frame);
  ok(gov.level === 0, 'recovered to 0');
  run(f.game, gov, 0.5, T, f.frame);
  const before = gov.report().recoverAfter;
  run(f.game, gov, 3, 1 / 35, f.frame);
  ok(gov.level >= 1 && gov.report().recoverAfter > before, `flapping doubles the recover wait (${before} -> ${gov.report().recoverAfter})`);
}
// reducedEffects: floor level 3, fx tier left to fx.js
{
  const f = fakeGame({ settings: { reducedEffects: true } });
  const gov = new QualityGovernor(f.game);
  gov.onSessionStart(f.session);
  ok(gov.level === REDUCED_FLOOR, 'reducedEffects starts at the floor level');
  ok(f.game.settings.fxQuality === undefined, 'reducedEffects: governor does not write fxQuality');
  gov.setLevel(0, 'test');
  ok(gov.level === REDUCED_FLOOR, 'cannot be raised above the reduced floor');
  run(f.game, gov, 40, T, f.frame);
  ok(gov.level === REDUCED_FLOOR, 'never recovers above the floor');
}
// modes: off, pinned, query parsing
{
  ok(QualityGovernor.modeFromSearch('?gov=off').mode === 'off' && QualityGovernor.modeFromSearch('?gov=3').level === 3 && QualityGovernor.modeFromSearch('?x=1').mode === 'auto', 'modeFromSearch');
  const f = fakeGame();
  const off = new QualityGovernor(f.game, { mode: 'off' });
  off.onSessionStart(f.session);
  run(f.game, off, 10, 1 / 20, f.frame);
  ok(!off.active && off.level === 0, 'off: never active');
  const pin = new QualityGovernor(f.game, { mode: 'pin', level: 3 });
  pin.onSessionStart(f.session);
  run(f.game, pin, 10, 1 / 20, f.frame);
  ok(pin.level === 3, 'pinned level stays');
}
// session end clears the override
{
  const f = fakeGame();
  const gov = new QualityGovernor(f.game);
  gov.onSessionStart(f.session);
  gov.setLevel(3, 'test');
  ok(f.game.settings.fxQuality === 'low', 'low fx set');
  gov.onSessionEnd();
  ok(f.game.settings.fxQuality === undefined && !gov.active, 'session end removes the fx override');
}
// no allocation in sample(): the heap does not grow over 2M calls
{
  const f = fakeGame();
  const gov = new QualityGovernor(f.game);
  gov.onSessionStart(f.session);
  if (global.gc) global.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 2_000_000; i++) gov.sample(T, null);
  if (global.gc) global.gc();
  const grown = process.memoryUsage().heapUsed - h0;
  ok(grown < 3_000_000, `sample() does not allocate (heap grew ${grown} bytes)`);
}

console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
