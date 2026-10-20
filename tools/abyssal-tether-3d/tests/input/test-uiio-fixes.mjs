// Node unit tests for the uiio fixer round: VR-01 (player height: 1:1 scale + calibration), VR-04 (controller
// loss pauses), VR-05 (hold X), VR-09 (turn pivots about the head), BUG-5 (double Enter VR).
// Run: node tools/abyssal-tether-3d/tests/input/test-uiio-fixes.mjs [--root DIR]
import './register.mjs';
import { srcUrl } from '../../verify/root.mjs';

const THREE = await import('three');
const { InputManager } = await import(srcUrl('input/inputManager.js'));
const { XRInput, XR_OPTIONAL_FEATURES } = await import(srcUrl('input/xrInput.js'));
const { EventBus, SETTINGS_DEFAULTS, CONFIG, VIEW, Storage, eyeAboveBody, heightCalibration, sanitizeHeightSettings } = await import(srcUrl('sim/config3d.js'));
const R = CONFIG.player.radius;

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

class MockXR extends THREE.EventDispatcher {
  constructor() {
    super();
    this.isPresenting = false;
    this.c = [];
    this.g = [];
    this.session = null;
    this.cameraXR = new THREE.ArrayCamera();
    this.cameraXR.cameras = [];
    this.ref = null;
  }
  getController(i) {
    if (!this.c[i]) {
      const o = new THREE.Group();
      o.matrixAutoUpdate = false;
      o.visible = false;
      this.c[i] = o;
    }
    return this.c[i];
  }
  getControllerGrip(i) {
    if (!this.g[i]) {
      const o = new THREE.Group();
      o.matrixAutoUpdate = false;
      o.visible = false;
      this.g[i] = o;
    }
    return this.g[i];
  }
  getCamera() {
    return this.cameraXR;
  }
  getSession() {
    return this.session;
  }
  getReferenceSpace() {
    return this.ref;
  }
  setReferenceSpaceType(t) {
    this.refType = t;
  }
  async setSession(s) {
    this.session = s;
    this.ref = new EventTarget();
    this.isPresenting = true;
    this.cameraXR.cameras = [new THREE.PerspectiveCamera(), new THREE.PerspectiveCamera()];
    this.dispatchEvent({ type: 'sessionstart' });
  }
  connect(i, src) {
    this.getController(i)._src = src;
    this.getController(i).dispatchEvent({ type: 'connected', data: src });
  }
  disconnect(i) {
    const src = this.getController(i)._src;
    this.getController(i)._src = null;
    this.getController(i).dispatchEvent({ type: 'disconnected', data: src });
  }
  pose(i, pos) {
    for (const o of [this.getController(i), this.getControllerGrip(i)]) {
      o.matrix.compose(pos, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      o.visible = true;
    }
  }
  head(pos, quat) {
    this.cameraXR.matrix.compose(pos, quat || new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
  }
}
const btn = (v) => ({ value: v, pressed: v > 0.5, touched: v > 0 });
function makeSource(handedness, opts = {}) {
  const pulses = [];
  return {
    handedness,
    targetRayMode: 'tracked-pointer',
    hand: opts.hand ? {} : null,
    gamepad: opts.noGamepad
      ? null
      : {
          mapping: 'xr-standard',
          buttons: [btn(0), btn(0), btn(0), btn(0), btn(0), btn(0)],
          axes: [0, 0, 0, 0],
          hapticActuators: [
            {
              pulse(i, ms) {
                pulses.push([i, ms]);
                return Promise.resolve(true);
              },
            },
          ],
        },
    pulses,
  };
}
class FakeTarget extends EventTarget {
  constructor() {
    super();
    this.pointerLockElement = null;
    this.visibilityState = 'visible';
  }
  hasFocus() {
    return true;
  }
  exitPointerLock() {
    this.pointerLockElement = null;
  }
}
const frame = (im, dt = 1 / 72) => {
  const I = im.update(dt);
  const snap = JSON.parse(JSON.stringify(I));
  im.endFrame();
  return snap;
};

async function xrSetup(headY) {
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  scene.add(rig);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
  rig.add(camera);
  const xr = new MockXR();
  const renderer = { xr, domElement: null };
  const win = new FakeTarget();
  const doc = new FakeTarget();
  const canvas = new FakeTarget();
  const bus = new EventBus();
  const game = { state: 'menu' };
  const settings = Object.assign({}, SETTINGS_DEFAULTS);
  const im = new InputManager({ renderer, camera, rig, canvas, settings, bus, game, env: { window: win, document: doc } });
  const sess = new EventTarget();
  sess.visibilityState = 'visible';
  sess.end = () => Promise.resolve();
  await xr.setSession(sess);
  const L = makeSource('left');
  const R = makeSource('right');
  xr.connect(0, L);
  xr.connect(1, R);
  xr.pose(0, new THREE.Vector3(-0.2, 1.0, -0.3));
  xr.pose(1, new THREE.Vector3(0.2, 1.0, -0.3));
  xr.head(new THREE.Vector3(0, headY, 0));
  frame(im); // session-start recenter (+ height calibration)
  return { scene, rig, camera, xr, im, bus, game, L, R, settings };
}

// ---- VR-01: player height, true 1:1 scale + calibration ------------------------------------
{
  // The head height in the game is the real eye height above the floor, for tall, short and seated players.
  for (const eye of [1.45, 1.65, 1.85, 1.2]) {
    const { im, rig, settings } = await xrSetup(eye);
    near(im.xrEyeHeight, eye, 1e-9, `session start reads the eye height (${eye} m)`);
    near(im.measureEyeHeight(), eye, 1e-9, `measureEyeHeight() = live eye height (${eye} m)`);
    const rp = im.xrRigPosition(0, 10, 0);
    near(rp.y, 10 - R, 1e-9, `${eye} m, Standing: rig = body − radius (the real floor is the ground under the feet)`);
    rig.position.set(rp.x, rp.y, rp.z);
    near(im.headMatrix(new THREE.Matrix4()).elements[13] - (10 - R), eye, 1e-9, `${eye} m, Standing: in-game eye height above the ground = real eye height`);
    // Seated: the calibration press lifts the eyes to the reference standing eye height.
    settings.heightMode = 'seated';
    Object.assign(settings, heightCalibration('seated', im.measureEyeHeight()));
    near(settings.heightMeasured, eye, 1e-3, 'calibration stores the measured eye height');
    const rs = { ...im.xrRigPosition(0, 10, 0) };
    rig.position.set(rs.x, rs.y, rs.z);
    near(im.headMatrix(new THREE.Matrix4()).elements[13] - (10 - R), VIEW.standEye, 2e-3, `${eye} m, Seated: eyes at the standing reference (${VIEW.standEye} m)`);
    // Fine trim: +5 cm, and the limits.
    settings.heightOffset = 0.05;
    near(im.xrRigPosition(0, 10, 0).y - rs.y, 0.05, 1e-9, 'fine offset +5 cm lifts the rig');
    settings.heightOffset = 9;
    near(im.heightTrim(), VIEW.offsetMax, 1e-12, 'fine offset is limited to ±30 cm');
    settings.heightOffset = 0;
    // Standing ignores the seated calibration.
    settings.heightMode = 'standing';
    near(im.xrRigPosition(0, 10, 0).y, 10 - R, 1e-9, 'Standing mode ignores heightCal');
    im.dispose();
  }
  const { im, rig, xr, settings } = await xrSetup(1.2);
  settings.heightMode = 'seated';
  Object.assign(settings, heightCalibration('seated', im.measureEyeHeight()));
  near(settings.heightCal, VIEW.standEye - 1.2, 1e-3, 'seated 1.2 m: heightCal = standEye − 1.2');
  const y0 = im.xrRigPosition(0, 3, 0).y;
  // Recentre (hold Y, respawn, system reset) must not wipe the calibration or move the rig vertically.
  xr.head(new THREE.Vector3(0.2, 0.9, 0.1));
  im.recenter();
  near(im.xrRigPosition(0, 3, 0).y, y0, 1e-12, 'recentre keeps the player-height calibration (rig y unchanged)');
  near(settings.heightCal, VIEW.standEye - 1.2, 1e-3, 'recentre does not touch the stored calibration');
  rig.rotation.y = 1.3;
  near(im.xrRigPosition(0, 3, 0).y, y0, 1e-12, 'turning keeps the rig height');
  rig.rotation.y = 0;
  // Implausible readings are not measurements.
  xr.head(new THREE.Vector3(0, 0.05, 0));
  im.recenter();
  ok(Number.isNaN(im.measureEyeHeight()), 'a 5 cm eye height is not a measurement');
  ok(heightCalibration('seated', 0.05) === null && heightCalibration('seated', NaN) === null, 'heightCalibration rejects implausible readings');
  near(im.xrEyeHeight, 0.9, 1e-9, 'a bad recentre reading keeps the previous eye height');
  // 'local' reference space (no floor): the head at the recentre is a standing eye height above the ground.
  settings.heightMode = 'standing';
  xr.head(new THREE.Vector3(0, 0.1, 0));
  im.xrIn.refSpaceType = 'local';
  im.recenter();
  near(im.xrRigPosition(0, 0, 0).y, -R + VIEW.standEye - 0.1, 1e-9, "'local' space: head at the recentre = standing eye height over the ground");
  im.dispose();
}
{
  // Settings: old saved settings (no height keys) migrate to the defaults; garbage is clamped.
  const store = {};
  globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
  Storage.set('settings', { volume: 0.3, aimAssist: 1.2, dominantHand: 'left', haptics: false, lastDifficulty: 'abyss' });
  let s = Storage.loadSettings();
  ok(s.heightMode === 'standing' && s.heightCal === 0 && s.heightOffset === 0 && s.heightMeasured === 0, 'old saved settings migrate: Standing, no calibration, no trim');
  ok(s.volume === 0.3 && s.dominantHand === 'left' && s.lastDifficulty === 'abyss', 'old keys survive the migration');
  Storage.set('settings', Object.assign({}, s, { heightMode: 'seated', heightCal: 0.42, heightOffset: 0.075, heightMeasured: 1.2 }));
  s = Storage.loadSettings();
  ok(s.heightMode === 'seated' && s.heightCal === 0.42 && s.heightOffset === 0.075 && s.heightMeasured === 1.2, 'height settings round-trip through Storage');
  Storage.set('settings', Object.assign({}, s, { heightMode: 'giant', heightCal: 99, heightOffset: -4, heightMeasured: 12 }));
  s = Storage.loadSettings();
  ok(s.heightMode === 'standing' && s.heightCal === VIEW.calMax && s.heightOffset === -VIEW.offsetMax && s.heightMeasured === 0, 'garbage height settings are clamped / reset');
  near(sanitizeHeightSettings({ heightOffset: 0.0131 }).heightOffset, 0.025, 1e-9, 'fine offset snaps to 2.5 cm steps');
  near(eyeAboveBody(), VIEW.standEye - R, 1e-12, 'desktop eye = standing eye height over the feet (1.62 − radius over the sphere centre)');
  delete globalThis.localStorage;
}

// ---- VR-09: smooth turn pivots about the head ----------------------------------------------
{
  const { im, rig, xr } = await xrSetup(1.6);
  // Player drifted 0.4 m in the room after the recentre.
  xr.head(new THREE.Vector3(0.3, 1.6, -0.27));
  const place = () => {
    const o = im.xrRigPosition(5, 0, -3);
    rig.position.set(o.x, o.y, o.z);
    return im.headMatrix(new THREE.Matrix4()).elements;
  };
  rig.rotation.y = 0.2;
  const before = place().slice();
  let yaw = 0.2;
  for (let i = 0; i < 72; i++) {
    yaw += (Math.PI / 2) / 72; // +90° over a second
    rig.rotation.y = yaw;
    place();
  }
  const after = place();
  near(Math.hypot(after[12] - before[12], after[14] - before[14]), 0, 1e-6, 'a 90° smooth turn leaves the head where it was');
  // A recentre still puts the head back over the body.
  im.recenter();
  const back = place();
  near(back[12], 5, 1e-9, 'recentre after turning: head over body x');
  near(back[14], -3, 1e-9, 'recentre after turning: head over body z');
  im.dispose();
}

// ---- VR-05: hold X to restart --------------------------------------------------------------
{
  const { im, game, L } = await xrSetup(1.6);
  game.state = 'dead';
  L.gamepad.buttons[4] = btn(1);
  let n = 0;
  for (let i = 0; i < 60; i++) if (frame(im).restartPressed) n++; // 0.83 s
  ok(n === 0, 'X held 0.83 s: no restart yet');
  for (let i = 0; i < 20; i++) if (frame(im).restartPressed) n++;
  ok(n === 1, 'X held past 1 s: exactly one restart');
  ok(L.pulses.some((p) => p[0] === 0.5), 'the restart pulses the left controller');
  for (let i = 0; i < 100; i++) if (frame(im).restartPressed) n++;
  ok(n === 1, 'keeping X held does not restart again');
  L.gamepad.buttons[4] = btn(0);
  frame(im);
  game.state = 'playing';
  L.gamepad.buttons[4] = btn(1);
  n = 0;
  for (let i = 0; i < 100; i++) if (frame(im).restartPressed) n++;
  ok(n === 0, 'X held mid-run never restarts');
  L.gamepad.buttons[4] = btn(0);
  frame(im);
  im.dispose();
}

// ---- VR-04: a lost / switched controller pauses the run ----------------------------------
{
  const { im, game, xr } = await xrSetup(1.6);
  game.state = 'playing';
  for (let i = 0; i < 72; i++) ok(!frame(im).pausePressed, 'both controllers: no pause');
  ok(!im.controllersLost, 'controllersLost false with both controllers');
  // Put the controllers down: Quest switches to tracked hands.
  xr.disconnect(0);
  xr.disconnect(1);
  const HL = makeSource('left', { hand: true, noGamepad: true });
  const HR = makeSource('right', { hand: true, noGamepad: true });
  xr.connect(2, HL);
  xr.connect(3, HR);
  xr.pose(2, new THREE.Vector3(-0.2, 1.0, -0.3));
  xr.pose(3, new THREE.Vector3(0.2, 1.0, -0.3));
  let first = -1;
  for (let i = 0; i < 72 && first < 0; i++) if (frame(im).pausePressed) first = i;
  ok(first > 30 && first < 45, `hands instead of controllers: pause after ~0.5 s (frame ${first})`);
  ok(im.controllersLost, 'controllersLost true');
  // The game pauses (UI mode on): no further pause edges that would toggle it back.
  game.state = 'paused';
  im.setUIMode(true);
  let again = 0;
  for (let i = 0; i < 144; i++) if (frame(im).pausePressed) again++;
  ok(again === 0, 'paused: no further pause edges');
  // Controllers back.
  xr.disconnect(2);
  xr.disconnect(3);
  const L2 = makeSource('left');
  const R2 = makeSource('right');
  xr.connect(0, L2);
  xr.connect(1, R2);
  frame(im);
  ok(!im.controllersLost, 'controllers back: controllersLost false');
  im.setUIMode(false);
  game.state = 'playing';
  // One controller drops out (battery): also pauses.
  xr.disconnect(1);
  first = -1;
  for (let i = 0; i < 72 && first < 0; i++) if (frame(im).pausePressed) first = i;
  ok(first > 30 && first < 45, `right controller lost: pause after ~0.5 s (frame ${first})`);
  // System menu blur: the sources read nothing, but that is not a controller loss.
  xr.connect(1, R2);
  frame(im);
  im.dispose();
}

// ---- XR features + BUG-5: a second Enter VR joins the pending request ---------------------
{
  ok(XR_OPTIONAL_FEATURES.indexOf('hand-tracking') < 0, "'hand-tracking' is no longer requested");
  let resolveReq;
  const requests = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      xr: {
        requestSession(mode, init) {
          requests.push(init);
          return new Promise((r) => (resolveReq = r));
        },
      },
    },
  });
  const xr = new MockXR();
  const xin = new XRInput({ xr }, null, {});
  const p1 = xin.enter();
  const p2 = xin.enter();
  ok(p1 === p2, 'second enter() while pending returns the same promise');
  ok(requests.length === 1, 'only one requestSession');
  const sess = new EventTarget();
  sess.visibilityState = 'visible';
  sess.enabledFeatures = ['local-floor'];
  sess.end = () => Promise.resolve();
  resolveReq(sess);
  const [a, b] = await Promise.all([p1, p2]);
  ok(a === sess && b === sess, 'both callers get the session');
  ok(!xin.entering && xin._enterPromise === null, 'pending state cleared');
  ok(JSON.stringify(requests[0].optionalFeatures) === JSON.stringify(['local-floor', 'bounded-floor']), 'optionalFeatures local-floor, bounded-floor');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
