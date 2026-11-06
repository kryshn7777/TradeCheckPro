// ASSIST PACK input (plans/TUTORIAL_ASSIST.md, input/assistLatch.js + input/inputManager.js, Node):
//   the pure grip toggle: one squeeze grabs, the next lets go (released edge), a squeeze with nothing in reach drops after 0.35 s, a hold
//          ending without us drops it, a blocked squeeze (the bag, the hood, a menu) toggles nothing
//   the real InputManager in a (mock) headset with gripMode 'toggle': grab latched through a released grip, the second squeeze lets go
//          and says 'input:gripRelease' {hand} while climb3d holds on; 'hold' mode unchanged
//   the REAL Holdfast3D + Physics3D: a hand locked by the Holdfast is freed by the toggle release ('holdfast:outpull', no cost, the hand
//          lives) as game.js wires it (bus 'input:gripRelease' -> holdfast.assistPull); a hold-mode release still does not free it in VR
//   the desktop: F once clings, once more lets go
//   the rope latch: desktop mouse and VR trigger: tap = fire and stay (held), tap = let go; a miss / break unlatches (the next tap fires);
//          a press over a panel clicks and latches nothing; touch keeps its own touchRopeMode; off = hold as before
//   node test-assist.mjs [--root DIR]
import './register.mjs';
import fs from 'node:fs';
import { srcUrl, SRC_DIR } from '../../verify/root.mjs';
const THREE = await import('three');
globalThis.self = globalThis;
const { EventBus, SETTINGS_DEFAULTS, DIFFICULTY, CONFIG } = await import(srcUrl('sim/config3d.js'));
const { InputManager } = await import(srcUrl('input/inputManager.js'));
const A = await import(srcUrl('input/assistLatch.js'));
const { Level3D } = await import(srcUrl('sim/level3d.js'));
const { LEVEL_DATA_3D } = await import(srcUrl('data/level-data-3d.js'));
const { TetherSystem, Physics3D, Player3D } = await import(srcUrl('sim/physics3d.js'));
const { Holdfast3D } = await import(srcUrl('sim/holdfast3d.js'));

let fails = 0;
const ok = (c, msg) => {
  console.log((c ? 'PASS ' : 'FAIL ') + msg);
  if (!c) fails++;
};
const F = 1 / 72;

// ---- 1. the pure grip toggle ---------------------------------------------------------------------------------------------------
{
  const s = A.makeGripToggle();
  const step = (raw, holding, blocked = false) => A.stepGripToggle(s, raw, F, holding, blocked);
  ok(step(true, false) === true && !s.released, 'a squeeze grabs');
  ok(step(true, true) === true && step(false, true) === true && step(false, true) === true, 'the grab stays latched with the grip released (holding on)');
  ok(step(true, true) === false && s.released === true, 'the next squeeze lets go: the released edge');
  ok(step(true, false) === false && !s.released, 'the edge lasts one frame; holding the squeeze does nothing more');
  step(false, false);
  // nothing in reach: drops after GRIP_TOGGLE.settle
  step(true, false);
  let n = 0;
  while (s.on && n < 200) {
    step(false, false);
    n++;
  }
  ok(Math.abs(n * F - A.GRIP_TOGGLE.settle) <= F + 1e-9 && !s.released, `a squeeze with nothing in reach lets go by itself after ${(n * F).toFixed(3)} s (no sticky hand)`);
  // a hold that ends without us (a slip / hop / mantle): off, next squeeze grabs again
  step(true, false);
  step(false, true);
  step(false, true);
  ok(s.on && s.held, 'held');
  ok(step(false, false) === false && !s.released, 'the hold ending without us (a slip) drops the latch, with no release edge');
  ok(step(true, false) === true, 'so the next squeeze grabs again');
  step(false, true);
  // a blocked squeeze (bag / hood / menu) toggles nothing
  ok(step(true, true, true) === true && !s.released, 'a squeeze that belongs to the bag / hood / a menu toggles nothing');
  step(false, true);
  ok(step(true, true) === false && s.released, 'and a real one after it still lets go');
  A.resetGripToggle(s);
  ok(!s.on && !s.held && !s.released, 'reset');
  const r = A.makeRopeLatch();
  ok(A.ropeLatchRise(r, true) && !A.ropeLatchRise(r, true) && !A.ropeLatchRise(r, false) && A.ropeLatchRise(r, true), 'rope latch: only a fresh press is a rise');
  const src = fs.readFileSync(SRC_DIR + '/input/assistLatch.js', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const body = src.slice(src.indexOf('export function stepGripToggle'));
  ok(!/Math\.random/.test(src) && !/from 'three'/.test(src) && !/new |\[\]/.test(body.slice(0, body.indexOf('export function makeRopeLatch'))), 'assistLatch.js: pure, deterministic, no allocation in the steps');
}

// ---- the mock headset (as creature/hood.mjs) --------------------------------------------------------------------------------------
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
      this.c[i] = o;
    }
    return this.c[i];
  }
  getControllerGrip(i) {
    if (!this.g[i]) {
      const o = new THREE.Group();
      o.matrixAutoUpdate = false;
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
  setReferenceSpaceType() {}
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
  pose(i, pos) {
    for (const o of [this.getController(i), this.getControllerGrip(i)]) {
      o.matrix.compose(pos, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      o.visible = true;
      o.matrixWorldNeedsUpdate = true;
    }
  }
  head(pos) {
    this.cameraXR.matrix.compose(pos, new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
  }
}
const btn = (v) => ({ value: v, pressed: v > 0.5, touched: v > 0 });
function makeSource(handedness) {
  return {
    handedness,
    targetRayMode: 'tracked-pointer',
    hand: null,
    profiles: ['meta-quest-touch-plus'],
    gamepad: { mapping: 'xr-standard', buttons: [btn(0), btn(0), btn(0), btn(0), btn(0), btn(0)], axes: [0, 0, 0, 0], hapticActuators: [{ pulse: () => Promise.resolve(true) }] },
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
function setupInput(extra) {
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  scene.add(rig);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 400);
  rig.add(camera);
  const xr = new MockXR();
  const canvas = new FakeTarget();
  canvas.tagName = 'CANVAS';
  canvas.requestPointerLock = () => {};
  const lanternGroup = new THREE.Group();
  scene.add(lanternGroup);
  lanternGroup.position.set(-0.2, 1.1, -0.3);
  const climb = { hands: { left: { gripping: false }, right: { gripping: false } } };
  const game = { state: 'playing', renderer: { lanternGroup }, physics: { climb }, bag: null, knocker: null };
  const settings = Object.assign({}, SETTINGS_DEFAULTS, extra || {});
  const bus = new EventBus();
  const im = new InputManager({ renderer: { xr, domElement: null }, camera, rig, canvas, settings, bus, game, env: { window: new FakeTarget(), document: new FakeTarget() } });
  return { im, xr, rig, climb, game, settings, bus };
}
const frame = (im) => {
  const I = im.update(F);
  const o = { grabL: I.climb.grab.left, grabR: I.climb.grab.right, pR: I.hands.right.pressed, hR: I.hands.right.held, rR: I.hands.right.released, click: I.ui.click, hood: I.hood };
  im.endFrame();
  return o;
};
async function headset(extra) {
  const S = setupInput(extra);
  const sess = new EventTarget();
  sess.visibilityState = 'visible';
  sess.end = () => Promise.resolve();
  await S.xr.setSession(sess);
  S.L = makeSource('left');
  S.R = makeSource('right');
  S.xr.connect(0, S.R);
  S.xr.connect(1, S.L);
  S.xr.head(new THREE.Vector3(0, 1.6, 0));
  S.xr.pose(0, new THREE.Vector3(0.3, 1.2, -0.4)); // the right hand well away from the lantern and the hip
  S.xr.pose(1, new THREE.Vector3(-0.3, 1.2, -0.4));
  frame(S.im);
  return S;
}

// ---- 2. the real InputManager: grip toggle in a headset ----------------------------------------------------------------------------
{
  const S = await headset({ gripMode: 'toggle' });
  const rel = [];
  S.bus.on('input:gripRelease', (e) => rel.push(e.hand));
  S.R.gamepad.buttons[1] = btn(1);
  let I = frame(S.im);
  ok(I.grabR, 'VR toggle: a squeeze grabs');
  S.climb.hands.right.gripping = true; // climb3d took the hold
  S.R.gamepad.buttons[1] = btn(0);
  for (let i = 0; i < 60; i++) I = frame(S.im);
  ok(I.grabR && rel.length === 0, 'VR toggle: the grip let go of, the hand still holds on (a whole second, no squeezing)');
  S.R.gamepad.buttons[1] = btn(1);
  I = frame(S.im);
  ok(!I.grabR && rel.length === 1 && rel[0] === 'right', "VR toggle: the next squeeze lets go and says 'input:gripRelease' {hand:'right'}");
  S.climb.hands.right.gripping = false;
  for (let i = 0; i < 10; i++) I = frame(S.im);
  ok(!I.grabR, 'VR toggle: keeping that squeeze held does not grab again');
  S.R.gamepad.buttons[1] = btn(0);
  frame(S.im);
  // a squeeze with nothing in reach
  S.R.gamepad.buttons[1] = btn(1);
  I = frame(S.im);
  S.R.gamepad.buttons[1] = btn(0);
  for (let i = 0; i < 40; i++) I = frame(S.im);
  ok(!I.grabR && rel.length === 1, 'VR toggle: a squeeze in the air lets go by itself (nothing taken)');
  // a menu: the squeeze is the panel's
  S.im.setUIMode(true);
  S.R.gamepad.buttons[1] = btn(1);
  I = frame(S.im);
  ok(!I.grabR, 'VR toggle: no grab over a panel');
  S.R.gamepad.buttons[1] = btn(0);
  frame(S.im);
  S.im.setUIMode(false);
  // the left hand toggles on its own
  S.L.gamepad.buttons[1] = btn(1);
  I = frame(S.im);
  ok(I.grabL && !I.grabR, 'VR toggle: each hand has its own latch');
  S.L.gamepad.buttons[1] = btn(0);
  S.im.dispose();
}
{
  const S = await headset({ gripMode: 'hold' });
  S.R.gamepad.buttons[1] = btn(1);
  let I = frame(S.im);
  ok(I.grabR, 'VR hold (default): a squeeze grabs');
  S.climb.hands.right.gripping = true;
  S.R.gamepad.buttons[1] = btn(0);
  I = frame(S.im);
  ok(!I.grabR, 'VR hold (default): letting go of the grip lets go (unchanged)');
  S.im.dispose();
}

// ---- 3. the REAL Holdfast: the toggle release frees a locked hand -------------------------------------------------------------------
function blankClimb() {
  const hand = () => ({ ok: false, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
  return { vr: false, grab: { left: false, right: false }, fwd: 0, side: 0, rx: 1, rz: 0, fx: 0, fz: -1, hands: { left: hand(), right: hand() } };
}
function hfWorld(vr = true) {
  const D = DIFFICULTY.normal;
  const L = new Level3D(LEVEL_DATA_3D, D.levelVariant);
  const bus = new EventBus();
  const ts = new TetherSystem(L, D, bus, {});
  const ph = new Physics3D(L, D, bus);
  const g = new Holdfast3D(L, D, bus, { climb: ph.climb, tethers: ts });
  const s = g.sites.find((x) => x.id === 'hf-s2-east');
  const dy = vr ? -0.45 : 0;
  const p = new Player3D(s.x + s.nx * 0.55, s.y + dy, s.z + s.nz * 0.55);
  p.rx = p.x;
  p.ry = p.y;
  p.rz = p.z;
  const it = { move: { x: 0, z: 0 }, reel: 0, jumpPressed: false, brake: false, hands: { left: { yank: 0 }, right: { yank: 0 } }, climb: blankClimb() };
  const w = { bus, ts, ph, g, s, p, it, c: it.climb, cl: ph.climb, ev: [], t: 0, tog: A.makeGripToggle(), raw: false, toggle: true };
  for (const type of ['holdfast:close', 'holdfast:outpull', 'holdfast:tear', 'holdfast:crush', 'holdfast:release']) bus.on(type, (e) => w.ev.push({ type, hand: e.hand, reason: e.reason, assist: !!e.assist }));
  // game.js: bus 'input:gripRelease' -> holdfast.assistPull(hand)
  bus.on('input:gripRelease', (e) => g.assistPull(e.hand));
  const b = w.c.hands.right;
  w.c.vr = vr;
  b.ok = true;
  b.rx = s.x + s.nx * 0.12 - p.x;
  b.ry = s.y - p.y;
  b.rz = s.z + s.nz * 0.12 - p.z;
  w.frame = () => {
    // the input: the raw grip through the toggle (as InputManager), or straight (hold mode)
    if (w.toggle) {
      w.c.grab.right = A.stepGripToggle(w.tog, w.raw, F, w.cl.hands.right.gripping, false);
      if (w.tog.released) bus.emit('input:gripRelease', { hand: 'right' });
    } else w.c.grab.right = w.raw;
    w.cl.probe(w.p, w.c);
    let acc = F;
    while (acc >= CONFIG.PHYSICS_DT - 1e-9) {
      w.ph.step(w.p, w.ts, w.it, CONFIG.PHYSICS_DT);
      acc -= CONFIG.PHYSICS_DT;
    }
    w.p.rx = w.p.x;
    w.p.ry = w.p.y;
    w.p.rz = w.p.z;
    w.g.setHp(w.ph.health.hp);
    w.g.setHands(w.c.vr, w.c.hands.left, w.c.hands.right);
    w.g.setInput(false, false, w.c.grab.left, w.c.grab.right, false);
    w.g.update(F, w.p);
    const d = w.g.takeDamage();
    if (d > 0) w.ph.health.damage(d, 'holdfast', 0);
    w.t += F;
  };
  w.run = (secs) => {
    for (let i = 0; i < Math.round(secs / F); i++) w.frame();
  };
  return w;
}
{
  const w = hfWorld(true);
  w.raw = true;
  w.frame();
  w.raw = false; // one squeeze, then the hand rests
  w.run(1.0);
  const closed = w.ev.some((e) => e.type === 'holdfast:close');
  ok(closed && w.cl.pinned && w.cl.hands.right.gripping, 'REAL Holdfast: one toggle squeeze on the patch, the grip released: it closes on the hand (locked)');
  w.raw = true; // the second squeeze
  w.frame();
  const out = w.ev.find((e) => e.type === 'holdfast:outpull');
  const relE = w.ev.find((e) => e.type === 'holdfast:release');
  ok(out && out.assist && relE && relE.reason === 'outpull', "REAL Holdfast: the toggle release is the pull: 'holdfast:outpull' (assist), released for 'outpull'");
  w.raw = false;
  w.run(0.3);
  ok(!w.cl.hands.right.gripping && !w.cl.pinned && w.ph.health.hp === 1 && !w.ev.some((e) => e.type === 'holdfast:tear' || e.type === 'holdfast:crush'), 'the hand is free, no cost (no tear, no crush, full health)');
  ok(w.s.state !== 'RUINED', 'the out-pulled Holdfast hand lives (retracts)');
}
{
  // hold mode in VR: letting go of the grip does not free a locked hand (only a real arm pull / the rope / a shot does)
  const w = hfWorld(true);
  w.toggle = false;
  w.raw = true;
  w.run(1.0);
  ok(w.cl.pinned, 'hold mode: locked');
  w.raw = false;
  w.run(0.3);
  ok(w.cl.pinned && !w.ev.some((e) => e.type === 'holdfast:outpull'), 'hold mode in VR: letting go of the grip does not free it (unchanged)');
  ok(w.g.assistPull('left') === false, 'assistPull on the other hand frees nothing');
}

// ---- 4. desktop F toggle --------------------------------------------------------------------------------------------------------
{
  const S = setupInput({ gripMode: 'toggle' });
  const rel = [];
  S.bus.on('input:gripRelease', (e) => rel.push(e.hand));
  S.im.desktop.onKeyDown({ code: 'KeyF', target: null, preventDefault() {} });
  let I = frame(S.im);
  ok(I.grabL && I.grabR, 'desktop toggle: F clings');
  S.im.desktop.onKeyUp({ code: 'KeyF' });
  S.climb.hands.right.gripping = true;
  for (let i = 0; i < 30; i++) I = frame(S.im);
  ok(I.grabR, 'desktop toggle: still clinging with F released');
  S.im.desktop.onKeyDown({ code: 'KeyF', target: null, preventDefault() {} });
  I = frame(S.im);
  ok(!I.grabR && !I.grabL && rel.length === 2, "desktop toggle: F again lets go (and says 'input:gripRelease' for the held hand)");
  S.im.desktop.onKeyUp({ code: 'KeyF' });
  S.im.dispose();
}

// ---- 5. the rope latch -------------------------------------------------------------------------------------------------------------
{
  const S = setupInput({ ropeLatch: true });
  const im = S.im;
  im._handPhysical('right', true, 'desktop');
  let I = frame(im);
  ok(I.pR && I.hR, 'desktop latch: a click fires (pressed, held)');
  im._handPhysical('right', false, 'desktop');
  for (let i = 0; i < 30; i++) I = frame(im);
  ok(I.hR && !I.rR, 'desktop latch: the button released, the tether stays held');
  im._handPhysical('right', true, 'desktop');
  I = frame(im);
  ok(!I.hR && I.rR, 'desktop latch: the next click lets go');
  im._handPhysical('right', false, 'desktop');
  frame(im);
  // a miss unlatches: the next tap fires again
  im._handPhysical('right', true, 'desktop');
  I = frame(im);
  im._handPhysical('right', false, 'desktop');
  S.bus.emit('grapple:miss', { hand: 'right' });
  I = frame(im);
  ok(!I.hR && I.rR, "desktop latch: a miss ('grapple:miss') unlatches");
  im._handPhysical('right', true, 'desktop');
  I = frame(im);
  ok(I.pR && I.hR, 'desktop latch: so the next tap fires (not a let-go)');
  im._handPhysical('right', false, 'desktop');
  S.bus.emit('grapple:release', { hand: 'right', reason: 'input' });
  I = frame(im);
  ok(I.hR, "desktop latch: our own let-go event ('grapple:release' reason input) does not unlatch");
  S.bus.emit('grapple:break', { hand: 'right' });
  I = frame(im);
  ok(!I.hR, 'desktop latch: a broken line unlatches');
  // over a panel: a click is the panel's
  im.setUIMode(true);
  im._handPhysical('right', true, 'desktop');
  I = frame(im);
  ok(!I.hR && !I.pR, 'desktop latch: over a panel a click latches nothing');
  im._handPhysical('right', false, 'desktop');
  im.setUIMode(false);
  frame(im);
  // touch keeps its own latch (touchRopeMode)
  im._handPhysical('left', true, 'touch');
  I = im.update(F);
  const tl = I.hands.left.held;
  im.endFrame();
  im._handPhysical('left', false, 'touch');
  I = im.update(F);
  ok(tl && !I.hands.left.held, 'touch source: unaffected by ropeLatch (hold as before; touchRopeMode is its setting)');
  im.endFrame();
  // off: hold as before
  S.settings.ropeLatch = false;
  im._handPhysical('right', true, 'desktop');
  I = frame(im);
  im._handPhysical('right', false, 'desktop');
  const I2 = frame(im);
  ok(I.hR && !I2.hR && I2.rR, 'ropeLatch off: hold to stay attached, release to let go (unchanged)');
  im.dispose();
}
{
  // VR trigger latch, with a panel click
  const S = await headset({ ropeLatch: true });
  S.R.gamepad.buttons[0] = btn(1);
  let I = frame(S.im);
  ok(I.pR && I.hR, 'VR latch: a trigger pull fires');
  S.R.gamepad.buttons[0] = btn(0);
  for (let i = 0; i < 20; i++) I = frame(S.im);
  ok(I.hR, 'VR latch: trigger released, still attached');
  S.R.gamepad.buttons[0] = btn(1);
  I = frame(S.im);
  ok(!I.hR && I.rR, 'VR latch: the next pull lets go');
  S.R.gamepad.buttons[0] = btn(0);
  frame(S.im);
  S.im.setUIMode(true);
  S.R.gamepad.buttons[0] = btn(1);
  I = frame(S.im);
  ok(I.click && !I.hR, 'VR latch: over a panel the pull is a click, no tether');
  S.R.gamepad.buttons[0] = btn(0);
  frame(S.im);
  S.im.setUIMode(false);
  S.R.gamepad.buttons[0] = btn(1);
  I = frame(S.im);
  ok(I.pR && I.hR, 'VR latch: back in play the next pull fires');
  // the hood's left stick click is untouched: a quick tap toggles, a held click brakes
  S.L.gamepad.buttons[3] = btn(1);
  const o1 = S.im.update(F);
  const brake = o1.brake;
  S.im.endFrame();
  S.L.gamepad.buttons[3] = btn(0);
  const o2 = S.im.update(F);
  ok(brake && o2.hoodToggle, 'VR: the left stick click still brakes while held and a quick tap is the hood toggle');
  S.im.endFrame();
  S.im.dispose();
}

// ---- 6. the wiring --------------------------------------------------------------------------------------------------------------
{
  const g = fs.readFileSync(SRC_DIR + '/game.js', 'utf8');
  ok(/bus\.on\('input:gripRelease'[\s\S]{0,200}this\.holdfast\.assistPull\(e\.hand\)/.test(g), "game.js: 'input:gripRelease' -> holdfast.assistPull(hand)");
  const u = fs.readFileSync(SRC_DIR + '/ui/ui3d.js', 'utf8');
  ok(/key: 'gripMode', tab: 'assist'/.test(u) && /key: 'ropeLatch', tab: 'assist'/.test(u) && /id: 'assist', label: 'Assist'/.test(u), 'ui3d: the Assist settings page with its two rows');
}

// ---- 7. the settings: defaults, sanitize, round trip; the VR Assist page ---------------------------------------------------------
{
  const { sanitizeUxSettings, Storage } = await import(srcUrl('sim/config3d.js'));
  ok(SETTINGS_DEFAULTS.gripMode === 'hold' && SETTINGS_DEFAULTS.ropeLatch === false && !('masonMercy' in SETTINGS_DEFAULTS), 'defaults: grip hold, rope latch off');
  const a = sanitizeUxSettings({ gripMode: 'sticky', ropeLatch: 'yes' });
  ok(a.gripMode === 'hold' && a.ropeLatch === false, 'sanitize: an unknown grip mode / a non-true latch fall back');
  const b = sanitizeUxSettings({ gripMode: 'toggle', ropeLatch: true });
  ok(b.gripMode === 'toggle' && b.ropeLatch === true, 'sanitize keeps the real values');
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => void mem.set(k, String(v)), removeItem: (k) => void mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  Storage.saveSettings(Object.assign({}, SETTINGS_DEFAULTS, { gripMode: 'toggle', ropeLatch: true }));
  const back = Storage.loadSettings();
  ok(back.gripMode === 'toggle' && back.ropeLatch === true, 'settings round trip through Storage');

  const { UI3D } = await import(srcUrl('ui/ui3d.js'));
  const texts = [];
  const st = { font: '10px sans-serif' };
  const ctx = new Proxy(st, {
    get(t, k) {
      if (k === 'measureText') return (x) => ({ width: String(x).length * (parseFloat(/(\d+(?:\.\d+)?)px/.exec(t.font)?.[1] || 10) * 0.56) });
      if (k === 'fillText') return (x, px, py) => texts.push({ s: String(x), y: py, font: t.font });
      if (k === 'createLinearGradient' || k === 'createRadialGradient') return () => ({ addColorStop() {} });
      if (k in t) return t[k];
      return () => {};
    },
    set(t, k, v) {
      t[k] = v;
      return true;
    },
  });
  const L = new Level3D(LEVEL_DATA_3D, 'normal');
  const game = { bus: new EventBus(), level: L, settings: Object.assign({}, SETTINGS_DEFAULTS), difficultyKey: 'normal', diff: DIFFICULTY.normal, save: { sectionRecords: () => ({}), continueInfo: () => null }, state: 'playing', time: 0, deaths: 0 };
  const ui = new UI3D(game);
  ui._xr = true;
  ui._vrSetPage = 0;
  const tabs = [];
  ui._regions.length = 0;
  ui._vrTab = 0;
  ui._paintSettings(ctx);
  for (const r of ui._regions) if (r.act === 'tab') tabs.push(r);
  ui._vrTab = tabs.length - 1;
  ui._regions.length = 0;
  texts.length = 0;
  ui._paintSettings(ctx);
  const R = ui._regions.slice();
  const px = (f) => parseFloat(/(\d+(?:\.\d+)?)px/.exec(f)?.[1] || 0);
  ok(tabs.length === 6 && tabs.every((r) => r.x + r.w <= 1024), 'VR Settings: six tabs (the new Assist last) fit the panel');
  ok(R.some((r) => r.act === 'set' && r.key === 'gripMode') && R.some((r) => r.act === 'set' && r.key === 'ropeLatch'), 'VR Settings › Assist: Grip (Hold / Toggle) and Rope latch (On / Off)');
  ok(texts.some((t) => /Grip toggle/.test(t.s)) && texts.some((t) => /Rope latch: tap/.test(t.s)), 'VR Settings › Assist: a short explanation line per row');
  ok(R.every((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= 1024 && r.y + r.h <= 768) && texts.every((t) => t.y > 0 && t.y <= 768) && texts.every((t) => px(t.font) >= 28), 'VR Settings › Assist: inside the panel, every glyph >= 28 px');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL PASS');
process.exit(fails ? 1 : 0);
