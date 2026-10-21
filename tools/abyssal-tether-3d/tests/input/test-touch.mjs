// Node unit tests for WP-TOUCH: the pure touch rules (joystick vector / dead zone / curve, floating base, look delta
// scaling, gyro mapping, button hold + latch state machine, handedness mirror, layout sizes, mode decision, settings
// sanitising, device profile) and the InputManager integration (stick -> move / climb, drag -> look, buttons -> ropes,
// reel, jump, grip, bag, pause; the layer is off in XR).
// Run: node tools/abyssal-tether-3d/tests/input/test-touch.mjs [--root DIR]
import './register.mjs';
import { srcUrl } from '../../verify/root.mjs';

const THREE = await import('three');
const L = await import(srcUrl('input/touchLogic.js'));
const P = await import(srcUrl('platform/deviceProfile.js'));
const { InputManager } = await import(srcUrl('input/inputManager.js'));
const { EventBus, SETTINGS_DEFAULTS, UX_LIMITS, sanitizeUxSettings, sanitizeTouchSettings } = await import(srcUrl('sim/config3d.js'));

let pass = 0;
let fail = 0;
function ok(cond, msg) {
  if (cond) pass++;
  else {
    fail++;
    console.log('FAIL:', msg);
  }
}
function near(a, b, eps, msg) {
  ok(Math.abs(a - b) <= (eps ?? 1e-6), `${msg} (got ${a}, want ${b})`);
}

// ---------------------------------------------------------------- joystick
{
  const R = 60;
  let v = L.stickVector(0, 0, R);
  ok(v.x === 0 && v.y === 0 && v.mag === 0, 'centre = zero');
  v = L.stickVector(3, -3, R);
  ok(v.x === 0 && v.y === 0, 'inside the dead zone = exactly zero');
  v = L.stickVector(0, -R, R);
  near(v.y, 1, 1e-9, 'full push up (screen dy < 0) = +1 forward');
  near(v.x, 0, 1e-9, 'full push up has no x');
  v = L.stickVector(R * 3, 0, R);
  near(v.x, 1, 1e-9, 'beyond the radius is clamped to 1');
  v = L.stickVector(-R, 0, R);
  near(v.x, -1, 1e-9, 'left = -1');
  v = L.stickVector(0, R, R);
  near(v.y, -1, 1e-9, 'push down = backward');
  const dz = L.TOUCH_TUNING.deadZone;
  const lo = L.stickVector(R * (dz + 0.001), 0, R);
  ok(lo.mag < 0.01, 'just outside the dead zone starts near zero (rescaled)');
  let prev = -1;
  let mono = true;
  for (let i = 0; i <= 20; i++) {
    const m = L.stickVector((R * i) / 20, 0, R).mag;
    if (m < prev - 1e-12) mono = false;
    prev = m;
  }
  ok(mono, 'magnitude is monotonic in the push');
  const half = L.stickVector(R * 0.5, 0, R).mag;
  const lin = (0.5 - dz) / (1 - dz);
  ok(half < lin, 'the curve gives finer control near the centre than linear');
  const d = L.stickVector(R * 0.6, -R * 0.6, R);
  near(Math.atan2(d.y, d.x), Math.PI / 4, 1e-9, 'diagonal keeps its direction');
  ok(Math.hypot(d.x, d.y) <= 1 + 1e-9, 'never exceeds 1');
  ok(L.stickVector(NaN, undefined, R).mag === 0, 'NaN input is zero');
  // floating base follows a drifting thumb
  const base = { x: 100, y: 100 };
  L.followStick(base, 130, 100, 60);
  ok(base.x === 100 && base.y === 100, 'inside the ring the base stays');
  L.followStick(base, 220, 100, 60);
  near(base.x, 160, 1e-9, 'past the ring the base follows to keep the thumb on the ring');
}

// ---------------------------------------------------------------- zones, look
{
  ok(L.zoneForX(100, 800, false) === 'stick' && L.zoneForX(700, 800, false) === 'look', 'left half = stick, right half = look');
  ok(L.zoneForX(100, 800, true) === 'look' && L.zoneForX(700, 800, true) === 'stick', 'mirror swaps the halves');
  const r = L.lookDelta(100, 0, 1, false);
  near(r.yaw, -100 * L.TOUCH_TUNING.radPerPx, 1e-12, 'drag right turns right (yaw falls)');
  near(r.pitch, 0, 1e-12, 'no pitch');
  near(L.lookDelta(0, 50, 1, false).pitch, -50 * L.TOUCH_TUNING.radPerPx, 1e-12, 'drag down looks down');
  near(L.lookDelta(0, 50, 1, true).pitch, 50 * L.TOUCH_TUNING.radPerPx, 1e-12, 'invert-Y flips it');
  near(L.lookDelta(40, 0, 2, false).yaw / L.lookDelta(40, 0, 1, false).yaw, 2, 1e-9, 'sensitivity scales linearly');
  const j = L.lookDelta(0.5, 0.5, 1, false);
  ok(j.yaw === 0 && j.pitch === 0, 'sub-pixel jitter is dropped');
  const big = L.lookDelta(5000, 0, 1, false);
  near(big.yaw, -L.TOUCH_TUNING.maxLookPx * L.TOUCH_TUNING.radPerPx, 1e-12, 'one event is capped (lost-capture jump)');
  ok(Number.isFinite(L.lookDelta(NaN, Infinity, NaN).yaw), 'non-finite input stays finite');
  // gyro
  const dt = 0.01;
  const k = Math.PI / 180;
  let g = L.gyroLook({ beta: 0, gamma: 90 }, 0, dt, 1, false);
  near(g.yaw, 90 * k * dt, 1e-12, 'portrait: gamma is yaw');
  g = L.gyroLook({ beta: 90, gamma: 0 }, 0, dt, 1, false);
  near(g.pitch, 90 * k * dt, 1e-12, 'portrait: beta is pitch');
  g = L.gyroLook({ beta: 90, gamma: 30 }, 90, dt, 1, false);
  near(g.yaw, 90 * k * dt, 1e-12, 'landscape 90: beta is yaw');
  near(g.pitch, -30 * k * dt, 1e-12, 'landscape 90: gamma is -pitch');
  const g2 = L.gyroLook({ beta: 90, gamma: 30 }, 270, dt, 1, false);
  near(g2.yaw, -g.yaw, 1e-12, 'landscape 270 mirrors yaw');
  near(g2.pitch, -g.pitch, 1e-12, 'landscape 270 mirrors pitch');
  near(L.gyroLook({ beta: 0, gamma: 30 }, 90, dt, 1, true).pitch, 30 * k * dt, 1e-12, 'gyro invert-Y');
  near(L.gyroLook({ beta: 10, gamma: 0 }, 90, 5, 1, false).yaw, 10 * k * 0.1, 1e-12, 'a stalled event cannot integrate more than 0.1 s');
  ok(L.gyroLook(null, 90, dt, 1, false).yaw === 0, 'no rotation rate = no look');
  near(L.gyroLook({ beta: 10, gamma: 0 }, 90, dt, 2, false).yaw / L.gyroLook({ beta: 10, gamma: 0 }, 90, dt, 1, false).yaw, 2, 1e-9, 'gyro sensitivity scales');
}

// ---------------------------------------------------------------- button state machine
{
  const b = new L.ButtonMachine('hold');
  ok(b.down(1) === 'press' && b.held, 'hold: first pointer presses');
  ok(b.down(2) === null && b.held, 'hold: a second finger does not re-press');
  ok(b.down(1) === null, 'hold: the same pointer twice is ignored');
  ok(b.up(1) === null && b.held, 'hold: still held while another finger is down');
  ok(b.up(2) === 'release' && !b.held, 'hold: last finger up releases');
  ok(b.up(9) === null, 'hold: unknown pointer up is ignored');
  b.down(3);
  ok(b.releaseAll() === 'release' && !b.held && b.pointers.size === 0, 'releaseAll releases and clears');
  ok(b.releaseAll() === null, 'releaseAll when idle is a no-op');
  const l = new L.ButtonMachine('latch');
  ok(l.down(1) === 'press' && l.held, 'latch: tap attaches');
  ok(l.up(1) === null && l.held, 'latch: lifting the finger keeps it attached');
  ok(l.down(2) === 'release' && !l.held, 'latch: next tap lets go');
  l.up(2);
  l.down(3);
  ok(l.setMode('hold') === 'release' && !l.held, 'switching mode releases');
  ok(new L.ButtonMachine('bogus').mode === 'hold', 'unknown mode falls back to hold');
}

// ---------------------------------------------------------------- layout, mirror, mode, settings
{
  for (const scale of [0.9, 1, 1.5]) {
    for (const def of L.LAYOUT) ok(L.placeButton(def, scale, false).size >= 56 - 1e-9, `${def.id} >= 56 px at scale ${scale}`);
  }
  ok(L.placeButton({ id: 'x', side: 'r', x: 1, y: 1, s: 0.5 }, 0.1, false).size >= 56, 'size has a floor of 56 px even for a tiny def and scale');
  for (const def of L.LAYOUT) {
    const a = L.placeButton(def, 1.2, false);
    const m = L.placeButton(def, 1.2, true);
    ok(a.side !== m.side && a.x === m.x && a.y === m.y && a.size === m.size, `${def.id} mirrors to the other edge unchanged`);
    ok(L.placeButton(def, 1.2, true).side === (def.side === 'r' ? 'left' : 'right'), `${def.id} mirrored side`);
  }
  near(L.placeButton(L.LAYOUT[0], 1, false).size / L.placeButton(L.LAYOUT[0], 1.5, false).size, 1 / 1.5, 1e-9, 'scale scales the size');
  ok(L.touchModeOn('auto', { coarse: true }) && !L.touchModeOn('auto', { coarse: false }), 'auto follows a coarse pointer');
  ok(L.touchModeOn('auto', { touchSeen: true }), 'auto turns on at the first touch on a hybrid');
  ok(L.touchModeOn('on', {}) && !L.touchModeOn('off', { coarse: true }), 'on / off win');
  ok(!L.touchModeOn('on', { xrPresenting: true }) && !L.touchModeOn('auto', { coarse: true, quest: true }), 'never while presenting or on a Quest');
  const s = Object.assign({}, SETTINGS_DEFAULTS, { touchControls: 'maybe', touchLookSens: 99, touchScale: 0.1, touchLauncher: 'x', touchRopeMode: 5, touchInvertY: 'yes', touchGyro: 1, touchMirror: null });
  sanitizeTouchSettings(s);
  ok(s.touchControls === 'auto' && s.touchLauncher === 'two' && s.touchRopeMode === 'hold', 'bad enums fall back');
  ok(s.touchLookSens === 3 && s.touchScale === 0.9, 'numbers are clamped');
  ok(s.touchInvertY === false && s.touchGyro === false && s.touchMirror === false, 'booleans are strict');
  const n = sanitizeUxSettings({ touchLookSens: NaN, touchScale: 'big' });
  ok(n.touchLookSens === SETTINGS_DEFAULTS.touchLookSens && n.touchScale === SETTINGS_DEFAULTS.touchScale, 'sanitizeUxSettings covers the touch keys (NaN / wrong types)');
  const ts = L.touchSettings({ touchLauncher: 'toggle', touchRopeMode: 'latch', touchMirror: true, haptics: false });
  ok(ts.launcher === 'toggle' && ts.rope === 'latch' && ts.mirror && !ts.haptics, 'touchSettings reads the keys');
  ok(L.touchSettings(null).mode === 'auto' && L.touchSettings(null).scale === 1, 'touchSettings defaults');
  ok(UX_LIMITS.touchScale[0] * 64 >= 56, 'smallest scale keeps the base button >= 56 px');
  ok(L.bagCountsKey([1, 2, 3, 4]) !== L.bagCountsKey([1, 2, 3, 5]) && L.bagCountsKey(null) === 0, 'bagCountsKey changes with the counts');
}

// ---------------------------------------------------------------- device profile
{
  near(P.pixelRatioCap(3, true), 1.5, 1e-9, 'touch devices cap the pixel ratio at 1.5');
  near(P.pixelRatioCap(3, false), 2, 1e-9, 'desktops cap at 2');
  near(P.pixelRatioCap(1, true), 1, 1e-9, 'a 1x screen stays 1');
  near(P.pixelRatioCap(NaN, true), 1, 1e-9, 'bad ratio = 1');
  ok(P.defaultTier() === 'high', 'Node (no window) = desktop default tier');
  ok(P.headroomStep({ touch: true, tier: 'low', fps: 60, ratio: 1.5, cap: 1.5, good: 8 }), 'headroom: a phone at 60 fps for 8 windows steps up');
  ok(!P.headroomStep({ touch: true, tier: 'low', fps: 60, ratio: 1.0, cap: 1.5, good: 8 }), 'headroom: not while the adaptive ratio is below its cap');
  ok(!P.headroomStep({ touch: false, tier: 'low', fps: 60, ratio: 2, cap: 2, good: 9 }) && !P.headroomStep({ touch: true, tier: 'quest', fps: 60, ratio: 1.5, cap: 1.5, good: 9 }), 'headroom: desktops and non-low tiers never');
  P.bumpDefaultTier('quest');
  ok(P.defaultTier() === 'quest', 'bumpDefaultTier raises the default');
}

// ---------------------------------------------------------------- InputManager integration
class FakeTarget extends EventTarget {
  constructor() {
    super();
    this.pointerLockElement = null;
    this.visibilityState = 'visible';
    this.innerWidth = 800;
    this.innerHeight = 400;
  }
  hasFocus() {
    return true;
  }
  exitPointerLock() {}
}
function setup(over) {
  const rig = new THREE.Group();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
  rig.add(camera);
  const xr = new THREE.EventDispatcher();
  xr.isPresenting = false;
  xr.enabled = true;
  const win = new FakeTarget();
  const doc = new FakeTarget();
  const canvas = new FakeTarget();
  canvas.tagName = 'CANVAS';
  const bus = new EventBus();
  const settings = Object.assign({}, SETTINGS_DEFAULTS, { touchControls: 'off' }, over || {});
  const game = { state: 'playing', bag: { counts: new Int8Array([2, 3, 0, 1]), selected: 1 }, applySettings() {} };
  const im = new InputManager({ renderer: { xr, domElement: null }, camera, rig, canvas, settings, bus, game, env: { window: win, document: doc } });
  // Turn the layer on without a DOM (the controls' elements are not needed for the state machine).
  const t = im.touch;
  t.refresh = () => {};
  t.enabled = true;
  return { im, t, rig, camera, game, settings, win };
}
const frame = (im, dt = 1 / 60) => {
  const I = im.update(dt);
  const snap = JSON.parse(JSON.stringify(I));
  im.endFrame();
  return snap;
};
const down = (t, id, x, y) => t.onDown({ pointerType: 'touch', pointerId: id, clientX: x, clientY: y, target: null, cancelable: false, preventDefault() {} });
const move = (t, id, x, y) => t.onMove({ pointerType: 'touch', pointerId: id, clientX: x, clientY: y, cancelable: false, preventDefault() {} });
const up = (t, id) => t.onUp({ pointerType: 'touch', pointerId: id, type: 'pointerup' });
const btnDown = (t, name, id) => t._buttonDown(name, { pointerId: id, clientX: 0, clientY: 0 });

{
  const { im, t, rig, game } = setup();
  let I = frame(im);
  ok(t.visible, 'a playing run shows the layer');
  // stick: left half, push up 60 px -> forward, relative to yaw
  down(t, 1, 100, 300);
  move(t, 1, 100, 240);
  I = frame(im);
  ok(I.move.z < -0.9 && Math.abs(I.move.x) < 1e-6, 'stick up = move forward (-Z)');
  rig.rotation.y = Math.PI / 2;
  I = frame(im);
  ok(I.move.x < -0.9, 'stick forward follows the view yaw');
  rig.rotation.y = 0;
  move(t, 1, 160, 300);
  I = frame(im);
  ok(I.move.x > 0.9, 'stick right = move right');
  // keyboard + stick on a hybrid: both feed the vector, still <= 1
  im.desktop.onKeyDown({ code: 'KeyW', target: null, preventDefault() {} });
  I = frame(im);
  ok(Math.hypot(I.move.x, I.move.z) <= 1 + 1e-9 && I.move.z < 0, 'keyboard and stick combine, normalised');
  im.desktop.onKeyUp({ code: 'KeyW' });
  up(t, 1);
  I = frame(im);
  ok(I.move.x === 0 && I.move.z === 0, 'lifting the thumb stops the move');

  // look: right half drag
  const yaw0 = rig.rotation.y;
  const pitch0 = im.camera.rotation.x;
  down(t, 2, 600, 200);
  move(t, 2, 700, 160);
  frame(im);
  ok(rig.rotation.y < yaw0 - 0.3, 'drag right turns the view right');
  ok(im.camera.rotation.x > pitch0 + 0.1, 'drag up looks up');
  const y1 = rig.rotation.y;
  frame(im);
  near(rig.rotation.y, y1, 1e-12, 'look is consumed once');
  // second finger in the same (look) zone is ignored; stick finger independent
  down(t, 3, 650, 200);
  ok(!t._drags.has(3), 'a second finger in the look half does not steal the look');
  up(t, 2);
  up(t, 3);
  // multi-touch: stick + look + button at once
  down(t, 10, 120, 300);
  move(t, 10, 120, 250);
  down(t, 11, 600, 200);
  btnDown(t, 'fireR', 12);
  move(t, 11, 640, 200);
  I = frame(im);
  ok(I.move.z < 0 && I.hands.right.held && rig.rotation.y < y1, 'stick + look + fire work together');
  up(t, 10);
  up(t, 11);
  up(t, 12);

  // ropes
  I = frame(im);
  ok(!I.hands.right.held, 'no rope held after the fingers lift');
  btnDown(t, 'fireR', 20);
  I = frame(im);
  ok(I.hands.right.pressed && I.hands.right.held && !I.hands.left.held, 'ROPE R fires the right tether only');
  btnDown(t, 'fireL', 21);
  I = frame(im);
  ok(I.hands.left.held && I.hands.right.held, 'both ropes at once');
  up(t, 20);
  I = frame(im);
  ok(I.hands.right.released && !I.hands.right.held && I.hands.left.held, 'releasing ROPE R lets go of the right tether only');
  up(t, 21);
  frame(im);

  // reel / let out
  btnDown(t, 'reel', 30);
  I = frame(im);
  ok(I.reel === 1, 'REEL = reel in');
  btnDown(t, 'out', 31);
  I = frame(im);
  ok(I.reel === 0, 'REEL + LET OUT cancel');
  up(t, 30);
  I = frame(im);
  ok(I.reel === -1, 'LET OUT = reel out');
  up(t, 31);
  I = frame(im);
  ok(I.reel === 0, 'reel released');

  // jump
  btnDown(t, 'jump', 40);
  I = frame(im);
  ok(I.jumpPressed, 'JUMP is a jump edge');
  up(t, 40);
  I = frame(im);
  ok(!I.jumpPressed, 'JUMP is only an edge');

  // grip: cling path + stick climbs
  btnDown(t, 'grip', 50);
  down(t, 51, 100, 300);
  move(t, 51, 100, 240);
  I = frame(im);
  ok(I.climb.grab.left && I.climb.grab.right && !I.climb.vr, 'GRIP = the desktop F cling path');
  ok(I.climb.fwd > 0.9 && Math.abs(I.climb.side) < 1e-6, 'the stick climbs while clinging (fwd)');
  ok(I.hands.left.yank === 1, 'GRIP also yanks ropes like F');
  move(t, 51, 160, 300);
  I = frame(im);
  ok(I.climb.side > 0.9, 'the stick traverses (side)');
  up(t, 50);
  up(t, 51);
  I = frame(im);
  ok(!I.climb.grab.left && I.climb.fwd === 0, 'letting go of GRIP stops the cling');

  // bag
  btnDown(t, 'bag', 60);
  ok(t._bagOpen === true, 'BAG opens the item row');
  up(t, 60);
  btnDown(t, 'bag1', 61);
  I = frame(im);
  ok(I.bag.slot === 1 && !t._bagOpen, 'tapping an item uses that slot and closes the row');
  t._bagOpen = true;
  btnDown(t, 'bag2', 62); // count 0: nothing is sent
  I = frame(im);
  ok(I.bag.slot === -1, 'an empty item sends nothing');
  btnDown(t, 'bagX', 63);
  I = frame(im);
  ok(I.bag.cancel, 'X stops applying');

  // pause
  btnDown(t, 'pause', 70);
  I = frame(im);
  ok(I.pausePressed, 'pause button = pause edge');

  // a paused game hides the layer and releases everything
  btnDown(t, 'fireL', 80);
  I = frame(im);
  ok(I.hands.left.held, 'left rope held');
  game.state = 'paused';
  I = frame(im);
  ok(!t.visible && !I.hands.left.held && I.hands.left.released, 'leaving the run releases ropes and hides the layer');
  down(t, 81, 100, 300);
  ok(t._stickId < 0, 'no stick while paused');
  game.state = 'playing';
  im.dispose();
}

// latch + single launcher with the L/R switch
{
  const { im, t, game } = setup({ touchLauncher: 'toggle', touchRopeMode: 'latch' });
  frame(im);
  t._buttonDown('sel', { pointerId: 1, clientX: 0, clientY: 0 });
  up(t, 1);
  ok(t.sel === 'left', 'the chip switches the rope hand');
  btnDown(t, 'fire', 2);
  let I = frame(im);
  ok(I.hands.left.held && !I.hands.right.held, 'the single ROPE button fires the selected hand');
  up(t, 2);
  I = frame(im);
  ok(I.hands.left.held, 'latch: lifting the finger keeps the rope attached');
  t._buttonDown('sel', { pointerId: 3, clientX: 0, clientY: 0 });
  up(t, 3);
  ok(t.sel === 'left', 'the switch is locked while a rope is held');
  btnDown(t, 'fire', 4);
  I = frame(im);
  ok(!I.hands.left.held && I.hands.left.released, 'latch: the next tap lets go');
  up(t, 4);
  ok(game.state === 'playing', 'game untouched');
  im.dispose();
}

// layer off: the mouse / keyboard path is the whole story; XR never sees touch
{
  const { im, t } = setup();
  t.enabled = false;
  let I = frame(im);
  ok(!t.visible, 'disabled layer is not visible');
  down(t, 1, 100, 300);
  ok(t._stickId < 0, 'a disabled layer takes no touches');
  im.desktop.onKeyDown({ code: 'KeyW', target: null, preventDefault() {} });
  I = frame(im);
  ok(I.move.z < 0, 'keyboard still works with the layer off');
  im.dispose();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
