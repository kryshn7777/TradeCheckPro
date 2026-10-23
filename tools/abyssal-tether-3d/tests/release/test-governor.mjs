// Node tests for platform/governor.js: the XR frame-time governor steps down under missed frames, recovers with
// hysteresis and back-off, ignores hitches / pauses, honours reducedEffects, applies foveation / fx tier / viewport
// scale / target frame rate, and allocates nothing per frame.
// Run: node tools/abyssal-tether-3d/tests/release/test-governor.mjs [--root DIR]
import { srcUrl } from '../../verify/root.mjs';

const { QualityGovernor, GOVERNOR_STEPS, REDUCED_FLOOR, normalizeFrameRateMode, pickFrameRate } = await import(srcUrl('platform/governor.js'));
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
  const gov = new QualityGovernor(f.game, { warmup: 0 });
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
  const gov = new QualityGovernor(f.game, { warmup: 0 });
  gov.onSessionStart(f.session);
  run(f.game, gov, 60, T, f.frame);
  ok(gov.level === 0 && gov.stats.degrades === 0, 'a healthy 72 fps never changes the level');
}
// degrade: sustained misses step down, one level per cooldown, down to the floor, never below
{
  const f = fakeGame();
  const gov = new QualityGovernor(f.game, { warmup: 0 });
  const changes = [];
  f.game.bus.on('quality:level', (e) => changes.push(e.level));
  gov.onSessionStart(f.session);
  run(f.game, gov, 1.5, T, f.frame); // fill the window
  run(f.game, gov, 12, 1 / 40, f.frame); // 25 ms frames: every frame a miss
  ok(gov.level === GOVERNOR_STEPS.length - 1, `degrades to the last level (got ${gov.level})`);
  ok(changes.join(',') === '1,2,3,4', `one step at a time: ${changes.join(',')}`);
  ok(f.game.settings.fxQuality === 'quest', 'every level keeps the quest fx tier: the governor trades resolution, never fog or god rays');
  ok(f.fov[f.fov.length - 1] === 1, 'high foveation at the cheap levels');
  gov.sample(T, f.frame);
  ok(f.scales[f.scales.length - 1] === 0.7, 'scale 0.7 at the last level');
  run(f.game, gov, 5, 1 / 30, f.frame);
  ok(gov.level === GOVERNOR_STEPS.length - 1, 'never goes below the last level');
}
// a couple of dropped frames do not trigger it
{
  const f = fakeGame();
  const gov = new QualityGovernor(f.game, { warmup: 0 });
  gov.onSessionStart(f.session);
  for (let i = 0; i < 400; i++) gov.sample(i % 90 === 0 ? 2 * T : T, f.frame);
  ok(gov.level === 0, 'isolated drops (1 in 90) are tolerated');
}
// hitches (loading, system dialog) and non-playing states are ignored
{
  const f = fakeGame();
  const gov = new QualityGovernor(f.game, { warmup: 0 });
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
  const gov = new QualityGovernor(f.game, { warmup: 0 });
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
  const gov = new QualityGovernor(f.game, { warmup: 0 });
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
  const gov = new QualityGovernor(f.game, { warmup: 0 });
  gov.onSessionStart(f.session);
  gov.setLevel(3, 'test');
  ok(f.game.settings.fxQuality === 'quest', 'the fx tier stays quest at level 3');
  gov.onSessionEnd();
  ok(f.game.settings.fxQuality === undefined && !gov.active, 'session end removes the fx override');
}
// plug-in API: onFrame / onStep / renderer.setQualityTier
{
  const f = fakeGame();
  const tiers = [];
  f.game.renderer.setQualityTier = (t) => tiers.push(t);
  const gov = new QualityGovernor(f.game, { warmup: 0 });
  const calls = [];
  const off = gov.onStep((tier, fov, scale, level, why) => calls.push([tier, fov, scale, level, why]));
  gov.onSessionStart(f.session);
  for (let i = 0; i < 72 * 14; i++) gov.onFrame(i < 80 ? 13.9 : 25);
  ok(calls.length >= 3 && calls[0][3] === 1 && calls[0][4] === 'degrade', 'onStep fires on every level change');
  ok(calls.every((c) => c[0] === 'quest') && tiers.length >= 3 && tiers.every((t) => t === 'quest'), 'the tier reaching onStep and renderer.setQualityTier is always quest');
  off();
  const n = calls.length;
  gov.setLevel(0, 'test');
  ok(calls.length === n, 'unsubscribe works');
}

// WP-GFX-PARITY frame rate option: '72' (default) | '90' | 'auto', pure helpers + the governor
{
  ok(normalizeFrameRateMode(undefined) === '72' && normalizeFrameRateMode(72) === '72' && normalizeFrameRateMode('x') === '72', 'frame rate mode defaults to 72');
  ok(normalizeFrameRateMode(90) === '90' && normalizeFrameRateMode('90') === '90' && normalizeFrameRateMode('auto') === 'auto', 'frame rate mode accepts 90 / auto');
  ok(pickFrameRate('72', [72, 90, 120]) === 72, 'mode 72 asks 72');
  ok(pickFrameRate('90', [72, 90, 120]) === 90, 'mode 90 asks 90 when listed');
  ok(pickFrameRate('90', [72, 120]) === 72, 'mode 90 falls back to 72 when 90 is not listed');
  ok(pickFrameRate('auto', [72, 90]) === 90 && pickFrameRate('auto', [72, 90], true) === 72, 'auto asks 90, 72 after the fallback');
  ok(pickFrameRate('90', [120]) === 0 && pickFrameRate('72', undefined) === 0, 'no listed rate of ours: nothing requested');
  // default keeps 72
  let f = fakeGame();
  let gov = new QualityGovernor(f.game, { warmup: 0 });
  gov.onSessionStart(f.session);
  ok(f.rates.length === 1 && f.rates[0] === 72 && gov.targetHz === 72, 'default setting requests 72 Hz');
  // 90
  f = fakeGame({ settings: { frameRate: '90' } });
  gov = new QualityGovernor(f.game, { warmup: 0 });
  gov.onSessionStart(f.session);
  ok(f.rates[0] === 90 && Math.abs(gov.target - 1 / 90) < 1e-9, "'90' requests 90 Hz and the frame-time target follows");
  // a healthy 90 Hz headset is not degraded (the miss rule is relative to 90 Hz, not 72)
  run(f.game, gov, 30, 1 / 90, f.frame);
  ok(gov.level === 0 && gov.stats.degrades === 0, 'steady 90 fps is healthy at the 90 Hz target');
  // 60 fps (16.7 ms) at a 90 Hz target is a sustained overrun: in '90' mode the picture steps down (the same frames are fine at 72 Hz: 13.9 ms budget x 1.3)
  run(f.game, gov, 8, 1 / 60, f.frame);
  ok(gov.level >= 1, "'90' mode degrades the picture when frames take 16.7 ms");
  // auto: 90 first, then 72 (no picture step) on the first sustained overrun
  f = fakeGame({ settings: { frameRate: 'auto' } });
  gov = new QualityGovernor(f.game, { warmup: 0 });
  const events = [];
  f.game.bus.on('quality:rate', (e) => events.push(e.hz));
  gov.onSessionStart(f.session);
  ok(f.rates[0] === 90, "'auto' starts at 90 Hz");
  run(f.game, gov, 1.2, 1 / 90, f.frame);
  run(f.game, gov, 3, 1 / 60, f.frame); // 16.7 ms frames: every frame misses an 11.1 ms budget
  ok(f.rates.join() === '90,72', `'auto' falls back to 72 Hz on a sustained overrun (requests ${f.rates.join()})`);
  ok(gov.level === 0 || gov.stats.degrades <= 1, 'the fallback comes before (or with at most one) picture step');
  ok(Math.abs(gov.target - 1 / 72) < 1e-9 && events.includes(72), 'the target follows the fallback and bus quality:rate fires');
  // the fallback sticks for the session; a new session tries 90 again
  run(f.game, gov, 20, 1 / 72, f.frame);
  ok(f.rates.join() === '90,72', 'no flapping back to 90 inside the session');
  gov.onSessionEnd();
  gov.onSessionStart(f.session);
  ok(f.rates[f.rates.length - 1] === 90, 'a new session in auto tries 90 Hz again');
  // changing the setting mid-session re-requests
  f = fakeGame();
  gov = new QualityGovernor(f.game, { warmup: 0 });
  gov.onSessionStart(f.session);
  f.game.settings.frameRate = '90';
  f.game.bus.emit('settings:changed', { settings: f.game.settings });
  ok(f.rates.join() === '72,90' && gov.frameRateMode === '90', 'settings:changed re-requests the new rate');
  ok(gov.report().frameRate.hz === 90, 'report() shows the frame rate');
}
// no allocation in sample(): the heap does not grow over 2M calls
{
  const f = fakeGame();
  const gov = new QualityGovernor(f.game, { warmup: 0 });
  gov.onSessionStart(f.session);
  if (global.gc) global.gc();
  const h0 = process.memoryUsage().heapUsed;
  for (let i = 0; i < 2_000_000; i++) gov.sample(T, null);
  if (global.gc) global.gc();
  const grown = process.memoryUsage().heapUsed - h0;
  ok(grown < 3_000_000, `sample() does not allocate (heap grew ${grown} bytes)`);
}

// warm-up: the load spikes of a start do not count (they took the god rays and the fog away a couple of seconds after the start)
{
  const f = fakeGame({ state: 'playing' });
  const gov = new QualityGovernor(f.game); // default warm-up
  gov.onSessionStart(f.session);
  run(f.game, gov, 4.5, 1 / 40, f.frame); // 25 ms frames for 4.5 s: all misses, all inside the warm-up
  ok(gov.level === 0 && gov.stats.degrades === 0 && gov.stats.misses === 0, 'a slow first 4.5 s of a session does not degrade (warm-up)');
  run(f.game, gov, 3, 1 / 40, f.frame);
  ok(gov.level >= 1, 'the same frames after the warm-up do degrade (the governor still works)');
}
// the menu is never judged: slow frames there change nothing
{
  const f = fakeGame({ state: 'menu' });
  const gov = new QualityGovernor(f.game, { warmup: 0 });
  gov.onSessionStart(f.session);
  run(f.game, gov, 20, 1 / 20, f.frame);
  ok(gov.level === 0 && gov.stats.frames === 0, 'a slow menu does not degrade');
}
{
  const f = fakeGame({ state: 'menu' });
  const gov = new QualityGovernor(f.game);
  gov.onSessionStart(f.session);
  run(f.game, gov, 6, T, f.frame); // healthy, warm-up over
  f.game.state = 'playing'; // the player presses Start
  run(f.game, gov, 4.5, 1 / 40, f.frame); // the level starts: load spikes
  ok(gov.level === 0, 'play starting re-arms the warm-up: a slow first 4.5 s of play does not degrade');
  run(f.game, gov, 3, 1 / 40, f.frame);
  ok(gov.level >= 1, 'a start-of-play warm-up ends too');
  f.game.state = 'paused';
  gov.sample(T, f.frame);
  f.game.state = 'playing'; // resume
  const l = gov.level;
  run(f.game, gov, 4.5, 1 / 40, f.frame);
  ok(gov.level === l, 'resuming from a pause re-arms it as well');
}
{
  const f = fakeGame();
  f.game.renderer.levelView = { dressing: true };
  const gov = new QualityGovernor(f.game, { warmup: 0 });
  gov.onSessionStart(f.session);
  run(f.game, gov, 8, 1 / 40, f.frame);
  ok(gov.level === 0 && gov.stats.degrades === 0, 'frames while the level is still being dressed do not count');
  f.game.renderer.levelView.dressing = false;
  run(f.game, gov, 3, 1 / 40, f.frame);
  ok(gov.level >= 1, 'once dressed, slow frames degrade');
}

console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
