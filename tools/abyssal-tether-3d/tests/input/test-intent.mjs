// Node unit tests: InputManager intent mapping (desktop handlers called directly; XR via a mock WebXRManager).
// Run: node tools/abyssal-tether-3d/tests/input/test-intent.mjs [--root DIR]
import './register.mjs';
import { srcUrl } from '../../verify/root.mjs';

const THREE = await import('three');
const { InputManager, makeIntent, yawOfMatrix } = await import(srcUrl('input/inputManager.js'));
const { readSource, makeXRHand, buttonValue, tetherDown } = await import(srcUrl('input/xrInput.js'));
const { HandsView, buildLauncherGeometry } = await import(srcUrl('render/handsView.js'));
const { EventBus, SETTINGS_DEFAULTS, CONFIG } = await import(srcUrl('sim/config3d.js'));

let pass = 0, fail = 0;
function ok(cond, msg) { if (cond) pass++; else { fail++; console.log('FAIL:', msg); } }
function near(a, b, eps, msg) { ok(Math.abs(a - b) <= (eps ?? 1e-6), `${msg} (got ${a}, want ${b})`); }

// ---------------------------------------------------------------- mocks
class MockXR extends THREE.EventDispatcher {
  constructor() { super(); this.isPresenting = false; this.c = []; this.g = []; this.session = null; this.refType = 'local-floor';
    this.cameraXR = new THREE.ArrayCamera(); this.cameraXR.cameras = []; this.ref = null; }
  getController(i) { if (!this.c[i]) { const o = new THREE.Group(); o.matrixAutoUpdate = false; o.visible = false; this.c[i] = o; } return this.c[i]; }
  getControllerGrip(i) { if (!this.g[i]) { const o = new THREE.Group(); o.matrixAutoUpdate = false; o.visible = false; this.g[i] = o; } return this.g[i]; }
  getCamera() { return this.cameraXR; }
  getSession() { return this.session; }
  getReferenceSpace() { return this.ref; }
  setReferenceSpaceType(t) { this.refType = t; }
  async setSession(s) { this.session = s; this.ref = new EventTarget(); this.isPresenting = true;
    this.cameraXR.cameras = [new THREE.PerspectiveCamera(), new THREE.PerspectiveCamera()];
    this.dispatchEvent({ type: 'sessionstart' }); }
  endSession() { this.isPresenting = false; for (let i = 0; i < this.c.length; i++) if (this.c[i]._src) { this.c[i].dispatchEvent({ type: 'disconnected', data: this.c[i]._src }); this.c[i]._src = null; }
    this.session = null; this.dispatchEvent({ type: 'sessionend' }); }
  connect(i, src) { this.getController(i)._src = src; this.getController(i).dispatchEvent({ type: 'connected', data: src }); }
  pose(i, pos, quat) { // sets ray+grip local matrices (grip = ray here, tilted later in a dedicated test)
    for (const o of [this.getController(i), this.getControllerGrip(i)]) { o.matrix.compose(pos, quat || new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)); o.visible = true; o.matrixWorldNeedsUpdate = true; } }
  head(pos, quat) { this.cameraXR.matrix.compose(pos, quat || new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)); }
}
function btn(v) { return { value: v, pressed: v > 0.5, touched: v > 0 }; }
function makeSource(handedness, opts = {}) {
  const pulses = [];
  return { handedness, targetRayMode: 'tracked-pointer', hand: opts.hand ? {} : null, profiles: ['meta-quest-touch-plus'],
    gamepad: opts.noGamepad ? null : { mapping: 'xr-standard', buttons: [btn(0), btn(0), btn(0), btn(0), btn(0), btn(0)], axes: [0, 0, 0, 0],
      hapticActuators: [{ pulse(i, ms) { pulses.push([i, ms]); return Promise.resolve(true); } }] }, pulses };
}
class FakeTarget extends EventTarget { constructor() { super(); this.pointerLockElement = null; this.visibilityState = 'visible'; } hasFocus() { return true; } exitPointerLock() { this.pointerLockElement = null; } }

function setup(settingsOver) {
  const scene = new THREE.Scene();
  const rig = new THREE.Group(); scene.add(rig);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400); rig.add(camera);
  const xr = new MockXR();
  const renderer = { xr, domElement: null };
  const win = new FakeTarget(); const doc = new FakeTarget();
  const canvas = new FakeTarget(); canvas.requestPointerLock = () => { doc.pointerLockElement = canvas; doc.dispatchEvent(new Event('pointerlockchange')); };
  canvas.tagName = 'CANVAS';
  const bus = new EventBus(); const events = [];
  for (const t of ['input:mode', 'xr:start', 'xr:end', 'xr:visibility', 'input:recenter', 'input:release']) bus.on(t, (p) => events.push([t, p]));
  const settings = Object.assign({}, SETTINGS_DEFAULTS, settingsOver || {});
  const im = new InputManager({ renderer, camera, rig, canvas, settings, bus, env: { window: win, document: doc } });
  return { scene, rig, camera, xr, im, win, doc, canvas, bus, events, settings };
}
const frame = (im, dt = 1 / 72) => { const I = im.update(dt); const snap = JSON.parse(JSON.stringify(I)); im.endFrame(); return snap; };

// ---------------------------------------------------------------- pure helpers
{
  ok(buttonValue(null) === 0 && buttonValue({ value: 0, pressed: true }) === 1 && buttonValue({ value: 0.4, pressed: false }) === 0.4, 'buttonValue');
  const st = makeXRHand('right'); const T = { triggerOn: 0.55, triggerOff: 0.35, buttonOn: 0.5 };
  const src = makeSource('right');
  src.gamepad.buttons[0] = btn(0.5); readSource(st, src, false, T); ok(!st.triggerDown, 'trigger below on-threshold');
  src.gamepad.buttons[0] = btn(0.6); readSource(st, src, false, T); ok(st.triggerDown, 'trigger pressed at 0.6');
  src.gamepad.buttons[0] = btn(0.4); readSource(st, src, false, T); ok(st.triggerDown, 'hysteresis keeps it held at 0.4');
  src.gamepad.buttons[0] = btn(0.3); readSource(st, src, false, T); ok(!st.triggerDown, 'released below 0.35');
  src.gamepad.axes = [0, 0, 0.5, -0.7]; readSource(st, src, false, T); ok(st.stickX === 0.5 && st.stickY === -0.7, 'xr-standard stick on axes 2/3');
  src.gamepad.buttons[4] = btn(1); src.gamepad.buttons[5] = btn(1); readSource(st, src, false, T); ok(st.primary && st.secondary, 'A/B buttons');
  const hsrc = makeSource('left', { hand: true, noGamepad: true }); const hs = makeXRHand('left');
  readSource(hs, hsrc, true, T); ok(hs.kind === 'hand' && tetherDown(hs), 'pinch (select) = trigger on tracked hands');
  readSource(hs, hsrc, false, T); ok(!tetherDown(hs), 'pinch released');
  const csel = makeXRHand('right'); readSource(csel, makeSource('right'), true, T); ok(!tetherDown(csel), 'controllers ignore stray select state (trigger only)');
  const m = new THREE.Matrix4().makeRotationY(0.7); near(yawOfMatrix(m.elements), 0.7, 1e-9, 'yawOfMatrix');
  const m2 = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(-Math.PI / 2 + 1e-5, 0.4, 0, 'YXZ')); near(yawOfMatrix(m2.elements), 0.4, 1e-3, 'yaw looking straight down');
  const I = makeIntent(); ok(I.hands.left.aim === null && I.ui.ray === null && I.move.x === 0, 'makeIntent shape');
}

// ---------------------------------------------------------------- desktop
{
  const { im, rig, camera, canvas, doc } = setup();
  ok(im.mode === 'desktop' && !im.xrActive, 'starts in desktop mode');
  let I = frame(im);
  ok(I.hands.left.aim && I.hands.right.aim, 'desktop aims exist');
  near(I.hands.right.aim.dz, -1, 1e-9, 'desktop aim = view centre (−Z)');
  ok(I.turnRate === 0, 'desktop turnRate 0');
  // WASD relative to yaw
  im.desktop.onKeyDown({ code: 'KeyW', target: null, preventDefault() {} });
  I = frame(im); near(I.move.z, -1, 1e-9, 'W = forward (−Z)'); near(I.move.x, 0, 1e-9, 'W no x');
  rig.rotation.y = Math.PI / 2;
  I = frame(im); near(I.move.x, -1, 1e-9, 'W with yaw 90° = −X'); near(I.move.z, 0, 1e-9, 'W yaw 90 z');
  rig.rotation.y = 0;
  im.desktop.onKeyDown({ code: 'KeyD', target: null, preventDefault() {} });
  I = frame(im); near(Math.hypot(I.move.x, I.move.z), 1, 1e-9, 'diagonal normalised'); ok(I.move.x > 0 && I.move.z < 0, 'W+D = forward-right');
  im.desktop.onKeyUp({ code: 'KeyW' }); im.desktop.onKeyUp({ code: 'KeyD' });
  // Space: jump edge + reel in; Shift reel out; C brake; F yank
  im.desktop.onKeyDown({ code: 'Space', target: null, preventDefault() {} });
  I = frame(im); ok(I.jumpPressed && I.reel === 1, 'Space = jump edge + reel in');
  I = frame(im); ok(!I.jumpPressed && I.reel === 1, 'jump is an edge, reel held');
  im.desktop.onKeyDown({ code: 'Space', repeat: true, target: null, preventDefault() {} });
  I = frame(im); ok(!I.jumpPressed, 'key repeat does not re-jump');
  im.desktop.onKeyUp({ code: 'Space' });
  im.desktop.onKeyDown({ code: 'ShiftLeft', target: null }); im.desktop.onKeyDown({ code: 'KeyC', target: null }); im.desktop.onKeyDown({ code: 'KeyF', target: null });
  I = frame(im); ok(I.reel === -1 && I.brake && I.hands.left.yank === 1 && I.hands.right.yank === 1, 'Shift reel out, C brake, F yank both');
  im.desktop.onKeyUp({ code: 'ShiftLeft' }); im.desktop.onKeyUp({ code: 'KeyC' }); im.desktop.onKeyUp({ code: 'KeyF' });
  im.desktop.onKeyDown({ code: 'KeyR', target: null }); im.desktop.onKeyDown({ code: 'Enter', target: null });
  I = frame(im); ok(I.restartPressed && I.confirmPressed, 'R restart, Enter confirm');
  im.desktop.onKeyUp({ code: 'KeyR' }); im.desktop.onKeyUp({ code: 'Enter' });
  // Enter on a focused button does not double as confirm
  im.desktop.onKeyDown({ code: 'Enter', target: { tagName: 'BUTTON', getAttribute() { return null; } } });
  I = frame(im); ok(!I.confirmPressed, 'Enter on a DOM button is left to the button');
  im.desktop.onKeyUp({ code: 'Enter' });
  // First click captures the pointer, does not fire
  im.desktop.onMouseDown({ button: 0, target: canvas, preventDefault() {} });
  ok(im.pointerLocked, 'click on the view locks the pointer');
  I = frame(im); ok(!I.hands.right.pressed && !I.hands.right.held, 'locking click does not fire');
  // LMB = right, RMB = left
  im.desktop.onMouseDown({ button: 0, target: canvas, preventDefault() {} });
  I = frame(im); ok(I.hands.right.pressed && I.hands.right.held && !I.hands.left.held, 'LMB = right tether press');
  I = frame(im); ok(!I.hands.right.pressed && I.hands.right.held, 'held without edge');
  im.desktop.onMouseDown({ button: 2, target: canvas, preventDefault() {} });
  I = frame(im); ok(I.hands.left.pressed && I.hands.left.held && I.hands.right.held, 'RMB = left tether while right held');
  im.desktop.onMouseUp({ button: 0 });
  I = frame(im); ok(I.hands.right.released && !I.hands.right.held && I.hands.left.held, 'release right only');
  im.desktop.onMouseUp({ button: 2 });
  I = frame(im); ok(I.hands.left.released, 'release left');
  // press + release inside one frame → press now, release next frame
  im.desktop.onMouseDown({ button: 0, target: canvas, preventDefault() {} }); im.desktop.onMouseUp({ button: 0 });
  I = frame(im); ok(I.hands.right.pressed && I.hands.right.held && !I.hands.right.released, 'fast click: press frame');
  I = frame(im); ok(I.hands.right.released && !I.hands.right.held && !I.hands.right.pressed, 'fast click: release next frame');
  // update() idempotent within a frame
  im.desktop.onMouseDown({ button: 0, target: canvas, preventDefault() {} });
  const a1 = im.update(1 / 72).hands.right.pressed; const a2 = im.update(1 / 72).hands.right.pressed; im.endFrame();
  ok(a1 && a2, 'update() twice in a frame keeps the edge');
  // pointer-lock warp: Chrome reports the cursor's jump to the view centre as one big movement right after locking
  { const d = im.desktop; rig.rotation.y = 0; camera.rotation.x = 0;
    d._lockedAt = performance.now(); d._lockWarp = true; d.locked = true;
    d.onMouseMove({ movementX: -389, movementY: -375 }); frame(im);
    ok(rig.rotation.y === 0 && camera.rotation.x === 0, 'lock warp movement is not a look');
    d._lockedAt = performance.now() - 3000; d._lockWarp = true;
    d.onMouseMove({ movementX: -300, movementY: 200 }); frame(im);
    ok(rig.rotation.y === 0 && camera.rotation.x === 0, 'late lock warp (first big move after locking) is not a look');
    d._lockedAt = -1e9; d._lockWarp = false; }
  // mouse look
  const sens = 1.5; im.settings.mouseSensitivity = sens; rig.rotation.y = 0; camera.rotation.x = 0;
  im.desktop.onMouseMove({ movementX: 100, movementY: 50 });
  I = frame(im); near(rig.rotation.y, -100 * 0.0022 * sens, 1e-9, 'mouse X → rig yaw'); near(camera.rotation.x, -50 * 0.0022 * sens, 1e-9, 'mouse Y → camera pitch');
  near(I.hands.right.aim.dy, Math.sin(-50 * 0.0022 * sens), 1e-6, 'aim follows pitch');
  im.desktop.onMouseMove({ movementX: 0, movementY: -100000 });
  im.desktop.onMouseMove({ movementX: 0, movementY: -300 }); im.desktop.onMouseMove({ movementX: 0, movementY: -300 }); im.desktop.onMouseMove({ movementX: 0, movementY: -300 });
  I = frame(im); ok(camera.rotation.x <= 1.48 + 1e-9, 'pitch clamped');
  // handPose desktop: near the camera, bottom-right for the right hand
  rig.position.set(5, -20, 3); rig.rotation.y = 0; camera.rotation.x = 0;
  const hp = im.handPose('right'); ok(hp.x > 5 && hp.y < -20 && hp.z < 3 && Math.hypot(hp.x - 5, hp.y + 20, hp.z - 3) < 0.8, `desktop right hand near camera bottom-right (${hp.x.toFixed(2)},${hp.y.toFixed(2)},${hp.z.toFixed(2)})`);
  const hl = im.handPose('left'); ok(hl.x < 5, 'desktop left hand on the left');
  // blur releases a held tether
  ok(im._ht.right.game, 'right still held before blur');
  im.desktop.onBlur();
  I = frame(im); ok(I.hands.right.released && !I.hands.right.held, 'blur → release');
  im.desktop.onMouseDown({ button: 0, target: canvas, preventDefault() {} });
  I = frame(im); ok(I.hands.right.pressed, 'click after blur fires again (desktop is not re-blocked)');
  // pointer lock lost by the user (Esc) → one pause press
  doc.pointerLockElement = null; im.desktop._blurAt = -1e9; doc.dispatchEvent(new Event('pointerlockchange'));
  I = frame(im); ok(I.pausePressed, 'pointer lock loss during play = pause');
  ok(!I.hands.right.held, 'lock loss releases mouse tethers');
  im.desktop.onKeyDown({ code: 'Escape', target: null }); im.desktop.onKeyUp({ code: 'Escape' });
  I = frame(im); ok(!I.pausePressed, 'Esc right after lock loss is not a second pause');
  // UI mode (desktop): no lock re-request side effects, Q press in UI does not fire, stays blocked after UI ends
  im.setUIMode(true);
  im.desktop.onKeyDown({ code: 'KeyQ', target: null });
  I = frame(im); ok(!I.hands.left.pressed && !I.hands.left.held, 'Q in UI mode does not fire');
  im.setUIMode(false);
  I = frame(im); ok(!I.hands.left.held, 'still blocked after UI closes');
  im.desktop.onKeyUp({ code: 'KeyQ' });
  im.desktop.onKeyDown({ code: 'KeyQ', target: null });
  I = frame(im); ok(I.hands.left.pressed, 'fresh Q press after UI fires left tether');
  im.desktop.onKeyUp({ code: 'KeyQ' }); frame(im);
  // Esc in UI mode → pause + back
  im.setUIMode(true); im.desktop._lockPauseAt = -1e9;
  im.desktop.onKeyDown({ code: 'Escape', target: null }); I = frame(im); ok(I.pausePressed && I.backPressed, 'Esc in UI = pause + back');
  im.desktop.onKeyUp({ code: 'Escape' }); im.setUIMode(false);
  // override
  im.setOverride({ move: { x: 0.5 }, hands: { left: { pressed: true } } });
  I = frame(im); ok(I.move.x === 0.5 && I.hands.left.pressed, 'debug override merges'); im.setOverride(null);
  // haptics on desktop: no-op
  ok(im.haptic('right', 1, 50) === false, 'desktop haptic is a no-op');
  im.dispose();
}


// ---------------------------------------------------------------- desktop: pointer-lock failures
{
  const { im, canvas, doc } = setup();
  canvas.requestPointerLock = () => { doc.dispatchEvent(new Event('pointerlockerror')); return Promise.reject(new Error('denied')); };
  im.setUIMode(true); im.setUIMode(false); // re-lock request outside a gesture fails
  await new Promise((r) => setTimeout(r, 150));
  ok(!im.desktop.lockFailed, 'a lock failure not caused by a click does not switch to unlocked play');
  im.desktop.onMouseDown({ button: 0, target: canvas, preventDefault() {} });
  let I = frame(im); ok(!I.hands.right.pressed, 'first failed-lock click does not fire');
  await new Promise((r) => setTimeout(r, 150));
  im.desktop.onMouseUp({ button: 0 });
  im.desktop.onMouseDown({ button: 0, target: canvas, preventDefault() {} });
  I = frame(im); ok(!I.hands.right.pressed && im.desktop.lockFailed, 'second failure (event + promise counted once each) → unlocked play enabled');
  im.desktop.onMouseUp({ button: 0 });
  im.desktop.onMouseDown({ button: 0, target: canvas, preventDefault() {} });
  I = frame(im); ok(I.hands.right.pressed, 'unlocked play: clicks fire tethers');
  im.desktop.onMouseUp({ button: 0 }); frame(im);
  canvas.requestPointerLock = () => { doc.pointerLockElement = canvas; doc.dispatchEvent(new Event('pointerlockchange')); };
  im.desktop.onMouseDown({ button: 0, target: canvas, preventDefault() {} });
  ok(im.pointerLocked && !im.desktop.lockFailed, 'a later successful lock restores normal locked play');
  im.dispose();
}


// ---------------------------------------------------------------- game hooks + HandsView in Node
{
  const { im, rig, camera, canvas, scene } = setup();
  im.setLook(1.2, 0.4); ok(Math.abs(rig.rotation.y - 1.2) < 1e-9 && Math.abs(camera.rotation.x - 0.4) < 1e-9, 'setLook(yaw, pitch) on desktop');
  im.setLook(0, 9); ok(Math.abs(camera.rotation.x - 1.48) < 1e-9, 'setLook clamps pitch');
  const s2 = Object.assign({}, SETTINGS_DEFAULTS, { mouseSensitivity: 2 }); im.applySettings(s2); ok(im.settings === s2, 'applySettings adopts a replaced settings object');
  im.desktop.locked = true; im.desktop.onMouseDown({ button: 0, target: canvas, preventDefault() {} }); frame(im);
  im.releaseAll(); let I = frame(im); ok(I.hands.right.released && !I.hands.right.held, 'releaseAll() releases held tethers');
  // HandsView builds and updates headless (no WebGL needed) and allocates no new objects per frame.
  const r3 = { scene, camera, rig, parents: [], setLanternParent(o, off) { this.parents.push([o.name || o.type, off ? off.y : null]); } };
  const hv = new HandsView(r3, im);
  ok(im.handSocket('left').children.includes(hv.launcher('left')) && im.handSocket('right').children.includes(hv.launcher('right')), 'launchers hang on the input sockets');
  ok(hv.lantern.parent === im.handSocket('left') && hv.lanternSocket.parent === hv.lantern, 'lantern + light socket on the left hand');
  const wm = hv.wristMount('left'); ok(wm.parent === im.handSocket('left') && Math.abs(wm.position.y - 0.03) < 1e-9, 'wristMount(left) rides the left socket above the bracer');
  const level = { raycast(ox, oy, oz, dx, dy, dz, maxDist, out) { const r = out || {}; r.t = 10; r.x = ox + dx * 10; r.y = oy + dy * 10; r.z = oz + dz * 10; return r; } };
  const target = { id: 'a', x: 0, y: 2, z: -12, kind: 'ring' };
  const game = { state: 'playing', level, diff: { aimRange: 32 }, player: { alive: true }, tethers: { hands: { left: { target: null, rope: { anchor: null } }, right: { target, rope: { anchor: null } } }, anchorStress: () => 0 } };
  for (let i = 0; i < 10; i++) { im.update(1 / 72); hv.update(1 / 72, game); im.endFrame(); }
  ok(r3.parents.length === 1 && r3.parents[0][0] === 'PerspectiveCamera', 'desktop: lantern light on the camera');
  ok(hv.batch.n >= 2 && hv.batch.mesh.visible, `fx batch has quads (laser + reticle + dot): ${hv.batch.n}`);
  let finite = true; for (let i = 0; i < hv.batch.n * 12; i++) if (!isFinite(hv.batch.pos[i])) finite = false; ok(finite, 'fx vertices finite');
  game.tethers.hands.right.rope.anchor = target; game.tethers.hands.right.rope.tension = 30;
  for (let i = 0; i < 3; i++) hv.update(1 / 72, game);
  ok(hv.materials.right.userData.glow.uGlowA.value > 1.3, 'attached hand glows with tension');
  game.state = 'menu'; hv.update(1 / 72, game); ok(!hv.launcher('left').visible && hv.batch.n === 0, 'desktop menu hides hands and fx');
  const g = buildLauncherGeometry('left', { x: 0, y: 0.03, z: -0.17 }); const tris = g.index.count / 3;
  ok(tris < 2500, `launcher triangles ${tris}`);
  ok(g.attributes.glow && g.attributes.color, 'launcher has colour + glow attributes');
  hv.dispose(); im.dispose();
}


// ---------------------------------------------------------------- desktop: game-state gating
{
  const { im, canvas, bus } = setup();
  const game = { state: 'menu' }; im.game = game;
  im.desktop.onMouseDown({ button: 0, target: canvas, preventDefault() {} });
  ok(!im.pointerLocked, 'menu: a background click does not capture the mouse (even with UI mode off)');
  game.state = 'playing'; im.setUIMode(true); im.setUIMode(false);
  ok(im.pointerLocked, 'setUIMode(false) while playing re-captures the mouse');
  game.state = 'paused'; im.desktop.locked = false;
  im.desktop.onMouseDown({ button: 0, target: canvas, preventDefault() {} });
  ok(!im.pointerLocked, 'paused: clicks do not capture');
  game.state = 'dead'; im.desktop.locked = true;
  im.desktop.onMouseDown({ button: 0, target: canvas, preventDefault() {} });
  const I = frame(im); ok(I.hands.right.pressed, 'dead: a click is a hand press (game respawns on it)');
  im.desktop.onMouseUp({ button: 0 }); frame(im);
  im.game = null; bus.emit('game:state', { state: 'menu', previous: 'playing' }); im.desktop.locked = false;
  im.desktop.onMouseDown({ button: 0, target: canvas, preventDefault() {} });
  ok(!im.pointerLocked, 'bus game:state fallback gates capture too');
  im.dispose();
}

// ---------------------------------------------------------------- XR
{
  const { im, rig, camera, xr, events, settings } = setup();
  camera.position.set(0, 0.5, 0); camera.rotation.set(0.3, 0, 0);
  // fake session start (what enterVR does after requestSession)
  const fakeSession = new EventTarget(); fakeSession.visibilityState = 'visible'; fakeSession.end = () => Promise.resolve();
  await xr.setSession(fakeSession);
  ok(im.xrActive && im.mode === 'xr', 'session start → xr mode');
  ok(events.some((e) => e[0] === 'xr:start'), 'xr:start emitted');
  ok(xr.c.length >= 2 && xr.c[0].parent === rig && xr.g[0].parent === rig, 'controller groups parented to the rig');
  const L = makeSource('left'); const R = makeSource('right');
  // connect in "wrong" slot order to prove handedness mapping
  xr.connect(0, R); xr.connect(1, L);
  rig.position.set(10, -100, 4); rig.rotation.y = 0;
  xr.head(new THREE.Vector3(0.1, 1.6, 0.2));
  xr.pose(0, new THREE.Vector3(0.25, 1.2, -0.3)); xr.pose(1, new THREE.Vector3(-0.25, 1.2, -0.3));
  let I = frame(im);
  ok(I.source === 'xr', 'intent.source xr');
  near(im.recenterOffset.x, 0.1, 1e-9, 'auto-recenter at session start x'); near(im.recenterOffset.z, 0.2, 1e-9, 'auto-recenter z');
  ok(I.hands.right.aim && I.hands.left.aim, 'both aims tracked');
  near(I.hands.right.aim.ox, 10.25, 1e-6, 'right aim origin from slot 0 (handedness) in world x'); near(I.hands.right.aim.oy, -98.8, 1e-6, 'aim origin world y'); near(I.hands.left.aim.ox, 9.75, 1e-6, 'left aim world x');
  near(I.hands.right.aim.dz, -1, 1e-9, 'aim dir −Z');
  // trigger
  R.gamepad.buttons[0] = btn(0.9);
  I = frame(im); ok(I.hands.right.pressed && I.hands.right.held && !I.hands.left.held, 'right trigger = right tether');
  R.gamepad.buttons[0] = btn(0.45);
  I = frame(im); ok(I.hands.right.held && !I.hands.right.released, 'trigger hysteresis keeps hold');
  R.gamepad.buttons[0] = btn(0.1);
  I = frame(im); ok(I.hands.right.released && !I.hands.right.held, 'trigger release');
  // grip → yank
  L.gamepad.buttons[1] = btn(0.2); I = frame(im); ok(I.hands.left.yank === 0, 'light grip rest is not a yank');
  L.gamepad.buttons[1] = btn(1); I = frame(im); ok(I.hands.left.yank === 1 && I.hands.right.yank === 0, 'full grip = yank 1 on that hand');
  L.gamepad.buttons[1] = btn(0);
  // left stick move relative to head yaw
  L.gamepad.axes = [0, 0, 0, -1];
  I = frame(im); near(I.move.z, -1, 1e-9, 'stick up = forward −Z (head yaw 0)'); near(I.move.x, 0, 1e-9, 'no x');
  xr.head(new THREE.Vector3(0.1, 1.6, 0.2), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
  I = frame(im); near(I.move.x, -1, 1e-9, 'head turned 90° left: forward = −X'); near(I.move.z, 0, 1e-9, 'z 0');
  rig.rotation.y = -Math.PI / 2; // rig turned right by 90 → head world yaw 0
  I = frame(im); near(I.move.z, -1, 1e-6, 'rig yaw composes with head yaw');
  rig.rotation.y = 0; xr.head(new THREE.Vector3(0.1, 1.6, 0.2));
  // looking almost straight down: move still uses the heading
  xr.head(new THREE.Vector3(0.1, 1.6, 0.2), new THREE.Quaternion().setFromEuler(new THREE.Euler(-1.5, 0.6, 0, 'YXZ')));
  I = frame(im); near(Math.atan2(-I.move.x, -I.move.z), 0.6, 1e-3, 'heading survives looking down');
  xr.head(new THREE.Vector3(0.1, 1.6, 0.2));
  L.gamepad.axes = [0, 0, 0.1, 0.1]; I = frame(im); ok(I.move.x === 0 && I.move.z === 0, 'deadzone');
  L.gamepad.axes = [0, 0, 0, 0];
  // right stick: turn + reel with axis lock
  R.gamepad.axes = [0, 0, 1, 0];
  I = frame(im); ok(I.turnRate < 0 && I.reel === 0, `stick right = turn right (negative yaw rate) ${I.turnRate}`); near(I.turnRate, -2.6 * settings.turnSpeed, 1e-9, 'full turn rate');
  settings.turnSpeed = 2; I = frame(im); near(I.turnRate, -5.2, 1e-9, 'turnSpeed multiplier'); settings.turnSpeed = 1;
  R.gamepad.axes = [0, 0, 0, -1]; I = frame(im); ok(I.reel === 1 && I.turnRate === 0, 'stick up = reel in, no turn');
  R.gamepad.axes = [0, 0, 0.2, 0.9]; I = frame(im); ok(I.reel < 0 && I.turnRate === 0, 'mostly-down = pure reel out (axis lock)');
  R.gamepad.axes = [0, 0, 0.7, -0.7]; I = frame(im); ok(I.reel > 0 && I.turnRate < 0, 'diagonal = both');
  R.gamepad.axes = [0, 0, 0, 0];
  // A / B / X / Y
  R.gamepad.buttons[4] = btn(1); I = frame(im); ok(I.jumpPressed && I.confirmPressed, 'A = jump + confirm');
  I = frame(im); ok(!I.jumpPressed, 'A edge only'); R.gamepad.buttons[4] = btn(0); frame(im);
  R.gamepad.buttons[5] = btn(1); I = frame(im); ok(I.pausePressed && !I.backPressed, 'B = pause'); R.gamepad.buttons[5] = btn(0); frame(im);
  L.gamepad.buttons[4] = btn(1); I = frame(im); ok(!I.restartPressed, 'X during play does nothing'); L.gamepad.buttons[4] = btn(0); frame(im);
  // X on the death screen (game keeps UI mode off there): driven by game:state on the bus
  const busX = im.bus;
  busX.emit('game:state', { state: 'dead', previous: 'playing' });
  L.gamepad.buttons[4] = btn(1); I = frame(im); ok(!I.restartPressed, 'X tap while dead does not restart (hold needed)');
  { let n = 0; for (let i = 0; i < 80; i++) { I = frame(im); if (I.restartPressed) n++; } ok(n === 1, `X held 1.1 s while dead = one restart (${n})`); }
  L.gamepad.buttons[4] = btn(0); frame(im);
  busX.emit('game:state', { state: 'playing', previous: 'dead' });
  L.gamepad.buttons[4] = btn(1); I = frame(im); ok(!I.restartPressed, 'X while playing does not restart'); L.gamepad.buttons[4] = btn(0); frame(im);
  // UI mode
  im.setUIMode(true);
  busX.emit('game:state', { state: 'paused', previous: 'playing' });
  L.gamepad.buttons[4] = btn(1); { let n = 0; for (let i = 0; i < 80; i++) { I = frame(im); if (I.restartPressed) n++; } ok(n === 1, 'X held while a panel is up = restart'); } L.gamepad.buttons[4] = btn(0); frame(im);
  R.gamepad.buttons[5] = btn(1); I = frame(im); ok(I.pausePressed && I.backPressed, 'B with panel = pause + back'); R.gamepad.buttons[5] = btn(0); frame(im);
  R.gamepad.buttons[4] = btn(1); I = frame(im); ok(!I.jumpPressed && I.confirmPressed, 'A in UI = confirm, no jump'); R.gamepad.buttons[4] = btn(0); frame(im);
  I = frame(im); ok(I.ui.ray && Math.abs(I.ui.ray.ox - 10.25) < 1e-6, 'UI ray from dominant (right) hand');
  L.gamepad.buttons[0] = btn(1);
  I = frame(im); ok(I.ui.click && !I.hands.left.pressed && !I.hands.left.held, 'trigger in UI = click, not tether');
  ok(Math.abs(I.ui.ray.ox - 9.75) < 1e-6, 'UI ray switches to the hand that clicked');
  im.setUIMode(false); busX.emit('game:state', { state: 'playing', previous: 'paused' });
  I = frame(im); ok(!I.hands.left.held && !I.hands.left.pressed, 'UI-owned trigger stays inert after the panel closes');
  L.gamepad.buttons[0] = btn(0); I = frame(im); ok(!I.hands.left.released, 'no gameplay release for a UI press');
  L.gamepad.buttons[0] = btn(1); I = frame(im); ok(I.hands.left.pressed, 'fresh press fires');
  // tether held through a pause panel survives
  im.setUIMode(true); I = frame(im); ok(I.hands.left.held && !I.hands.left.released, 'held tether stays held while a panel is up');
  im.setUIMode(false); I = frame(im); ok(I.hands.left.held && !I.hands.left.pressed, 'and after it closes (no re-fire)');
  // XR visibility blurred → release, then still-held trigger is blocked on return
  fakeSession.visibilityState = 'visible-blurred'; fakeSession.dispatchEvent(new Event('visibilitychange'));
  I = frame(im); ok(I.hands.left.released && !I.hands.left.held, 'visible-blurred releases the held tether');
  ok(!I.hands.right.aim && !I.hands.left.aim, 'no aim while blurred');
  fakeSession.visibilityState = 'visible'; fakeSession.dispatchEvent(new Event('visibilitychange'));
  I = frame(im); ok(!I.hands.left.pressed && !I.hands.left.held, 'trigger still held on return does not re-fire');
  L.gamepad.buttons[0] = btn(0); frame(im); L.gamepad.buttons[0] = btn(1);
  I = frame(im); ok(I.hands.left.pressed, 'after a physical release it fires again');
  L.gamepad.buttons[0] = btn(0); frame(im);
  ok(events.some((e) => e[0] === 'xr:visibility' && e[1].state === 'visible-blurred'), 'xr:visibility emitted');
  // hold Y → recenter
  xr.head(new THREE.Vector3(0.6, 1.5, -0.4));
  L.gamepad.buttons[5] = btn(1);
  for (let i = 0; i < 40; i++) frame(im, 1 / 72);
  ok(Math.abs(im.recenterOffset.x - 0.6) > 0.1, 'not yet recentered after 0.55 s');
  for (let i = 0; i < 25; i++) frame(im, 1 / 72);
  ok(Math.abs(im.recenterOffset.x - 0.6) < 1e-9 && Math.abs(im.recenterOffset.z + 0.4) < 1e-9, 'hold Y 0.9 s → recentered');
  L.gamepad.buttons[5] = btn(0); frame(im);
  // xrRigPosition
  rig.rotation.y = 0; const rp = im.xrRigPosition(0, 0, 0);
  near(rp.x, -0.6, 1e-9, 'rig x offsets the recentred head'); near(rp.z, 0.4, 1e-9, 'rig z'); near(rp.y, -CONFIG.player.radius, 1e-9, 'rig y = body − radius: the real floor is the ground under the feet (1:1, hold Y keeps it)');
  rig.rotation.y = 0.8; const rp2 = im.xrRigPosition(0, 0, 0); rig.position.set(rp2.x, rp2.y, rp2.z);
  const hm = im.headMatrix(new THREE.Matrix4()); near(hm.elements[12], 0, 1e-9, 'head lands over the body x (rotated rig)'); near(hm.elements[14], 0, 1e-9, 'head over body z'); near(hm.elements[13], 1.5 - CONFIG.player.radius, 1e-9, 'a standing head is its real height (1.5 m) above the ground under the body, not a fixed offset');
  rig.rotation.y = 0;
  // ref-space reset → recenter on the next frame
  xr.head(new THREE.Vector3(0, 1.7, 0)); xr.ref.dispatchEvent(new Event('reset')); frame(im); near(im.recenterOffset.x, 0, 1e-9, 'system reset → recenter');
  // haptics
  L.pulses.length = 0; R.pulses.length = 0; im._haptic.left.until = 0; im._haptic.right.until = 0;
  ok(im.haptic('left', 0.7, 40) && L.pulses.length === 1 && L.pulses[0][0] === 0.7 && L.pulses[0][1] === 40, 'haptic pulse(intensity, ms)');
  ok(!im.haptic('left', 0.3, 40), 'weaker pulse during a stronger one is skipped');
  ok(im.haptic('both', 1, 3000) && R.pulses.length === 1 && R.pulses[0][1] === 2000, 'both hands + ms clamp');
  settings.haptics = false; ok(!im.haptic('right', 1, 50), 'settings.haptics=false disables'); settings.haptics = true;
  delete R.gamepad.hapticActuators; ok(!im.haptic('right', 1, 50) || true, 'no actuator → guarded');
  // handPose: socket under the grip aligned with the ray; uses the CURRENT rig transform
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.6);
  xr.getControllerGrip(0).matrix.compose(new THREE.Vector3(0.25, 1.2, -0.3), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
  xr.getController(0).matrix.compose(new THREE.Vector3(0.25, 1.21, -0.36), tilt, new THREE.Vector3(1, 1, 1));
  frame(im);
  rig.position.set(100, 50, -20); // Game moves the rig after input.update()
  const p = im.handPose('right');
  const expect = new THREE.Vector3(0, 0.03, -0.17).applyQuaternion(tilt).add(new THREE.Vector3(100.25, 51.2, -20.3));
  near(p.x, expect.x, 1e-6, 'muzzle x with moved rig'); near(p.y, expect.y, 1e-6, 'muzzle y'); near(p.z, expect.z, 1e-6, 'muzzle z');
  const q = new THREE.Quaternion(p.qx, p.qy, p.qz, p.qw); ok(q.angleTo(tilt) < 1e-6, 'hand orientation = ray orientation');
  // lost controller → head-relative fallback (never NaN)
  xr.getController(1).visible = false; xr.getControllerGrip(1).visible = false;
  I = frame(im); ok(I.hands.left.aim === null, 'untracked hand has no aim');
  const pl = im.handPose('left'); ok(isFinite(pl.x) && isFinite(pl.y) && isFinite(pl.z), 'untracked hand pose falls back near the head');
  // hand tracking: pinch = trigger
  const H = makeSource('left', { hand: true, noGamepad: true }); xr.connect(2, H); xr.pose(2, new THREE.Vector3(-0.2, 1.1, -0.3));
  xr.endSession && 0;
  xr.getController(1).dispatchEvent({ type: 'disconnected', data: L }); xr.c[1]._src = null;
  I = frame(im); ok(I.hands.left.aim && !I.hands.left.held, 'tracked hand takes over the left slot');
  xr.getController(2).dispatchEvent({ type: 'selectstart', data: H });
  I = frame(im); ok(I.hands.left.pressed && I.hands.left.held, 'pinch fires the left tether');
  xr.getController(2).dispatchEvent({ type: 'selectend', data: H });
  I = frame(im); ok(I.hands.left.released, 'un-pinch releases');
  // session end → desktop, camera restored, everything released
  R.gamepad.buttons[0] = btn(1); I = frame(im); ok(I.hands.right.held, 'holding right before session end');
  xr.endSession();
  ok(!im.xrActive && im.mode === 'desktop', 'session end → desktop mode');
  near(camera.position.y, 0.5, 1e-9, 'camera position restored'); near(camera.rotation.x, 0.3, 1e-9, 'camera pitch restored');
  I = frame(im); ok(I.hands.right.released && !I.hands.right.held && I.source === 'desktop', 'session end releases tethers');
  ok(events.some((e) => e[0] === 'xr:end'), 'xr:end emitted');
  im.dispose();
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
