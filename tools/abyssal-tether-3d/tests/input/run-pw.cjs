/* global T, __xr */ // page globals (pw/harness.js, pw/mockxr.js) used inside page.evaluate
// Playwright: desktop pointer-lock flow + mock-WebXR session through the real three.js WebXRManager,
// on a small test scene (pw/harness.js) that uses the game's InputManager / HandsView / TetherSystem.
//   node tools/abyssal-tether-3d/tests/input/run-pw.cjs [--root DIR] [--out DIR]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { loadPlaywright, CHROMIUM_ARGS } = require('../../e2e/playwright.cjs');

const { chromium } = loadPlaywright();
const argv = process.argv.slice(2);
const argOut = argv.indexOf('--out');
let GAME = null; // the game folder: resolved by ../../verify/root.mjs (this checkout, or --root / AT3D_ROOT)
const TEST = path.join(__dirname, 'pw');
const SHOTS = path.join(argOut >= 0 && argv[argOut + 1] ? path.resolve(argv[argOut + 1]) : path.join(__dirname, 'out'), 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let file = null;
  if (u.startsWith('/game/')) file = path.join(GAME, u.slice(6));
  else if (u.startsWith('/test/')) file = path.join(TEST, u.slice(6));
  else if (u === '/' || u === '/index.html') file = path.join(TEST, 'index.html');
  if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end('nf ' + u); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok  ', m); } else { fail++; console.log('  FAIL', m); } };

(async () => {
  GAME = (await import(pathToFileURL(path.join(__dirname, '..', '..', 'verify', 'root.mjs')).href)).resolveGameRoot(argv);
  console.log('game', GAME);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const PORT = server.address().port;
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') consoleErrors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  await page.addInitScript({ path: path.join(TEST, 'mockxr.js') });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForFunction(() => window.T && window.T.frames > 5, null, { timeout: 30000 });
  const frames = async (n) => { const f0 = await page.evaluate(() => T.frames); await page.waitForFunction((f) => T.frames >= f, f0 + n, { timeout: 20000 }); };

  console.log('-- desktop');
  ok(await page.evaluate(() => T.input.mode === 'desktop' && !T.input.xrActive), 'desktop mode at boot');
  ok(await page.evaluate(() => T.r3.lanternParent === 'PerspectiveCamera'), 'desktop lantern on the camera');
  // Look at the front anchor: aim straight at it from the camera.
  await page.evaluate(() => { const a = T.anchors[0]; const dx = a.x, dy = a.y - T.EYE, dz = a.z; T.rig.rotation.y = Math.atan2(-dx, -dz); T.camera.rotation.x = Math.atan2(dy, Math.hypot(dx, dz)); });
  await frames(4);
  ok(await page.evaluate(() => T.targets.right === 'a-front' && T.targets.left === 'a-front'), 'both desktop hands target the anchor at the view centre');
  await page.screenshot({ path: path.join(SHOTS, 'desktop-target.png') });
  // Real click on the canvas → pointer lock request (headless may or may not grant it).
  await page.mouse.click(640, 400);
  await frames(3);
  const locked = await page.evaluate(() => document.pointerLockElement === T.renderer.domElement);
  console.log('     headless pointer lock granted:', locked);
  ok(await page.evaluate(() => !T.attached.right), 'the locking click does not fire a tether');
  if (!locked) await page.evaluate(() => { T.input.desktop.locked = true; }); // emulate the lock
  await page.mouse.down({ button: 'left' });
  await frames(3);
  ok(await page.evaluate(() => T.attached.right === 'a-front'), 'LMB (locked) attaches the RIGHT tether to the target');
  await page.mouse.down({ button: 'right' });
  await frames(3);
  ok(await page.evaluate(() => T.attached.left === null), 'RMB on the same anchor: left hand does not double-attach (other hand owns it)');
  await page.mouse.up({ button: 'right' });
  await page.mouse.up({ button: 'left' });
  await frames(3);
  ok(await page.evaluate(() => !T.attached.right), 'LMB release lets go');
  // mouse look through the handler (pointer-lock movementX emulated)
  const yaw0 = await page.evaluate(() => T.rig.rotation.y);
  await page.evaluate(() => T.input.desktop.onMouseMove({ movementX: 200, movementY: 0 }));
  await frames(2);
  const yaw1 = await page.evaluate(() => T.rig.rotation.y);
  ok(Math.abs((yaw0 - yaw1) - 200 * 0.0022) < 1e-6, `mouse X rotates the rig yaw (${(yaw0 - yaw1).toFixed(4)} rad)`);
  // keyboard
  await page.keyboard.down('KeyW');
  await frames(2);
  const mv = await page.evaluate(() => T.lastIntent.move);
  ok(Math.abs(Math.hypot(mv.x, mv.z) - 1) < 1e-6, 'W gives a unit move vector');
  await page.keyboard.up('KeyW');
  // Hold LMB then blur the window → release
  await page.evaluate(() => T.input.desktop.onMouseMove({ movementX: -200, movementY: 0 }));
  await frames(2);
  await page.mouse.down({ button: 'left' });
  await frames(3);
  ok(await page.evaluate(() => T.attached.right === 'a-front'), 'attached again');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await frames(3);
  ok(await page.evaluate(() => !T.attached.right), 'window blur releases the held tether');
  await page.mouse.up({ button: 'left' });
  // desktop draw-call cost of the hands
  await page.evaluate(() => { T.input.desktop.onMouseMove({ movementX: 0, movementY: 0 }); });
  await frames(2);
  const infoOn = await page.evaluate(() => T.info);
  await page.evaluate(() => T.hands.setVisible(false));
  await frames(3);
  const infoOff = await page.evaluate(() => T.info);
  await page.evaluate(() => T.hands.setVisible(true));
  console.log(`     desktop: total ${infoOn.calls} calls / ${infoOn.triangles} tris; without hands ${infoOff.calls} / ${infoOff.triangles}`);
  ok(infoOn.calls - infoOff.calls <= 4, `hands cost ≤ 4 draw calls on desktop (${infoOn.calls - infoOff.calls})`);

  console.log('-- XR (mock navigator.xr)');
  ok(await page.evaluate(() => T.input.isVRSupported()), 'isVRSupported() true with WebXR present');
  // Menus are up when Enter VR is clicked: UI mode frees the pointer for the DOM.
  await page.evaluate(() => T.input.setUIMode(true));
  await frames(2);
  ok(await page.evaluate(() => document.pointerLockElement === null), 'setUIMode(true) releases pointer lock for the DOM menus');
  await page.click('#vr');
  await page.waitForFunction(() => T.input.xrActive, null, { timeout: 15000 });
  await page.evaluate(() => T.input.setUIMode(false));
  const req = await page.evaluate(() => __xr.requests[0]);
  ok(req && req.mode === 'immersive-vr', 'requestSession immersive-vr');
  ok(req && JSON.stringify(req.init.optionalFeatures) === JSON.stringify(['local-floor', 'bounded-floor']), 'optionalFeatures local-floor, bounded-floor (no hand-tracking)');
  ok(req && req.userActivation !== false, `requestSession called inside the click gesture (userActivation ${req && req.userActivation})`);
  ok(await page.evaluate(() => __xr.refType === 'local-floor' && T.renderer.xr.isPresenting), 'local-floor reference space, presenting');
  ok(await page.evaluate(() => T.vrResult === true && T.input.mode === 'xr'), 'enterVR resolved true, mode xr');
  await page.evaluate(() => __xr.connect());
  await frames(4);
  ok(await page.evaluate(() => !!T.lastIntent.hands.right.aim && !!T.lastIntent.hands.left.aim), 'controller aims tracked through three.js controller Groups');
  ok(await page.evaluate(() => T.r3.lanternParent === 'AT3D-lantern-socket'), 'XR lantern hangs from the left hand socket');
  // aim right controller at the front anchor
  await page.evaluate(() => {
    const T3 = T.THREE; const rig = T.rig; rig.updateMatrixWorld(true);
    const a = T.anchors[0]; const hand = new T3.Vector3(0.22, 1.25, -0.32).applyMatrix4(rig.matrixWorld);
    const dir = new T3.Vector3(a.x, a.y, a.z).sub(hand).normalize();
    const local = dir.clone().applyQuaternion(rig.getWorldQuaternion(new T3.Quaternion()).invert());
    const q = new T3.Quaternion().setFromUnitVectors(new T3.Vector3(0, 0, -1), local);
    __xr.pose('right', [0.22, 1.25, -0.32], [q.x, q.y, q.z, q.w]);
    const b = T.anchors[1]; const handL = new T3.Vector3(-0.22, 1.25, -0.32).applyMatrix4(rig.matrixWorld);
    const dirL = new T3.Vector3(b.x, b.y, b.z).sub(handL).normalize().applyQuaternion(rig.getWorldQuaternion(new T3.Quaternion()).invert());
    const qL = new T3.Quaternion().setFromUnitVectors(new T3.Vector3(0, 0, -1), dirL);
    __xr.pose('left', [-0.22, 1.25, -0.32], [qL.x, qL.y, qL.z, qL.w]);
  });
  await frames(4);
  ok(await page.evaluate(() => T.targets.right === 'a-front' && T.targets.left === 'a-left'), 'each controller targets the anchor it points at');
  await page.screenshot({ path: path.join(SHOTS, 'xr-targets.png') });
  // Point the right controller at bare wall (no anchor in the cone): laser + wall dot, no target.
  const savedRight = await page.evaluate(() => { const s = __xr.sources.right.targetRaySpace; return { p: s.p.slice(), q: s.q.slice() }; });
  await page.evaluate(() => {
    const T3 = T.THREE; T.rig.updateMatrixWorld(true);
    const hand = new T3.Vector3(0.22, 1.25, -0.32).applyMatrix4(T.rig.matrixWorld);
    const dir = new T3.Vector3(7.9, -6, -6).sub(hand).normalize().applyQuaternion(T.rig.getWorldQuaternion(new T3.Quaternion()).invert());
    const q = new T3.Quaternion().setFromUnitVectors(new T3.Vector3(0, 0, -1), dir);
    __xr.pose('right', [0.22, 1.25, -0.32], [q.x, q.y, q.z, q.w]);
  });
  await frames(12);
  ok(await page.evaluate(() => T.targets.right === null && T.hands.fx.right.dot > 0.5), 'aim at bare wall: no target, wall dot shown');
  await page.screenshot({ path: path.join(SHOTS, 'xr-wall-dot.png') });
  await page.evaluate((sv) => __xr.pose('right', sv.p, sv.q), savedRight);
  await frames(4);
  await page.evaluate(() => __xr.press('right', 0, 1));
  await frames(3);
  ok(await page.evaluate(() => T.attached.right === 'a-front'), 'right TRIGGER attaches the right tether');
  ok(await page.evaluate(() => T.log.includes('grapple:attach:right@a-front')), 'grapple:attach event for the right hand');
  await page.evaluate(() => __xr.press('left', 0, 0.8));
  await frames(3);
  ok(await page.evaluate(() => T.attached.left === 'a-left'), 'left TRIGGER attaches the left tether');
  await page.evaluate(() => __xr.press('left', 1, 1));
  await frames(2);
  ok(await page.evaluate(() => T.lastIntent.hands.left.yank === 1 && T.lastIntent.hands.right.yank === 0), 'left GRIP = yank on the left rope only');
  await page.evaluate(() => __xr.press('left', 1, 0));
  await page.evaluate(() => { __xr.stick('left', 0, -1); __xr.stick('right', 0, -1); });
  await frames(2);
  const it = await page.evaluate(() => T.lastIntent);
  ok(Math.abs(Math.hypot(it.move.x, it.move.z) - 1) < 1e-6 && it.reel === 1 && it.turnRate === 0, 'left stick = move, right stick up = reel in');
  const yawA = await page.evaluate(() => T.rig.rotation.y);
  await page.evaluate(() => __xr.stick('right', 1, 0));
  await frames(6);
  const yawB = await page.evaluate(() => T.rig.rotation.y);
  ok(yawB < yawA - 0.01, `right stick X smooth-turns the rig (Δyaw ${(yawB - yawA).toFixed(3)})`);
  await page.evaluate(() => { __xr.stick('left', 0, 0); __xr.stick('right', 0, 0); });
  await frames(2);
  await page.evaluate((y) => { T.rig.rotation.y = y; }, yawA); // undo the turn so the controllers point at their anchors again
  await frames(3);
  // haptics through the real gamepad path
  await page.evaluate(() => T.input.haptic('right', 0.6, 35));
  ok(await page.evaluate(() => __xr.pulses.some((p) => p[0] === 'right' && p[1] === 0.6 && p[2] === 35)), 'haptic → gamepad.hapticActuators[0].pulse(0.6, 35)');
  await page.screenshot({ path: path.join(SHOTS, 'xr-attached.png') });
  const xrInfo = await page.evaluate(() => T.info);
  await page.evaluate(() => T.hands.setVisible(false));
  await frames(3);
  const xrOff = await page.evaluate(() => T.info);
  await page.evaluate(() => T.hands.setVisible(true));
  console.log(`     XR stereo: total ${xrInfo.calls} calls / ${xrInfo.triangles} tris; without hands ${xrOff.calls} / ${xrOff.triangles}`);
  ok(xrInfo.calls - xrOff.calls <= 8, `hands cost ≤ 8 draw calls for both eyes (${xrInfo.calls - xrOff.calls})`);
  // Session blur (system menu) releases everything; returning with triggers held does not re-fire.
  await page.evaluate(() => __xr.session.setVisibility('visible-blurred'));
  await frames(3);
  ok(await page.evaluate(() => !T.attached.left && !T.attached.right), "XR 'visible-blurred' releases both tethers");
  await page.evaluate(() => __xr.session.setVisibility('visible'));
  await frames(3);
  ok(await page.evaluate(() => !T.attached.left && !T.attached.right), 'triggers still held on return do not re-attach');
  await page.evaluate(() => { __xr.press('right', 0, 0); __xr.press('left', 0, 0); });
  await frames(2);
  await page.evaluate(() => __xr.press('right', 0, 1));
  await frames(3);
  ok(await page.evaluate(() => T.attached.right === 'a-front'), 'a fresh trigger pull attaches again');
  // window blur too
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await frames(3);
  ok(await page.evaluate(() => !T.attached.right), 'window blur releases in XR as well');
  await page.evaluate(() => __xr.press('right', 0, 0));
  await frames(2);
  // UI mode: trigger clicks, no tether
  await page.evaluate(() => T.input.setUIMode(true));
  await page.evaluate(() => { T.clicks = 0; T.bus.on('dummy', () => {}); });
  await page.evaluate(() => __xr.press('left', 0, 1));
  await page.waitForFunction(() => T.lastIntent && (T.lastIntent.ui.click || T.sawClick), null, { timeout: 5000 }).catch(() => {});
  await frames(3);
  ok(await page.evaluate(() => !T.attached.left), 'trigger with a panel up does not fire a tether');
  ok(await page.evaluate(() => T.input.uiHand === 'left' && T.lastIntent.ui.ray && Math.abs(T.lastIntent.ui.ray.ox - T.lastIntent.hands.left.aim.ox) < 1e-6), 'UI ray follows the hand that pulled its trigger');
  await page.screenshot({ path: path.join(SHOTS, 'xr-ui-pointer.png') });
  await page.evaluate(() => { T.input.setUIMode(false); __xr.press('left', 0, 0); });
  await frames(2);
  // pinch-only hand source
  await page.evaluate(() => {
    const s = __xr.session; const L = __xr.sources.left; s.removeSources([L]);
    const H = { handedness: 'left', targetRayMode: 'tracked-pointer', targetRaySpace: L.targetRaySpace, gripSpace: L.gripSpace, profiles: ['generic-hand'], hand: new Map(), gamepad: null };
    __xr.sources.hand = H; s.addSources([H]);
  });
  await frames(3);
  await page.evaluate(() => __xr.session.fire(__xr.sources.hand, 'selectstart'));
  await frames(3);
  ok(await page.evaluate(() => T.attached.left === 'a-left'), 'hand tracking: pinch (selectstart) attaches the left tether');
  await page.evaluate(() => __xr.session.fire(__xr.sources.hand, 'selectend'));
  await frames(3);
  ok(await page.evaluate(() => !T.attached.left), 'un-pinch releases');
  // End the session: back to desktop, everything released
  await page.evaluate(() => __xr.press('right', 0, 1));
  await frames(3);
  ok(await page.evaluate(() => T.attached.right === 'a-front'), 'attached before ending the session');
  await page.evaluate(() => T.input.exitVR());
  await page.waitForFunction(() => !T.input.xrActive, null, { timeout: 5000 });
  await frames(3);
  ok(await page.evaluate(() => T.input.mode === 'desktop' && !T.attached.right), 'session end → desktop mode, tether released');
  ok(await page.evaluate(() => T.r3.lanternParent === 'PerspectiveCamera'), 'lantern back on the camera');
  ok(await page.evaluate(() => Math.abs(T.camera.position.y - T.EYE) < 1e-6), 'desktop camera pose restored');
  await page.screenshot({ path: path.join(SHOTS, 'desktop-after-xr.png') });
  const errs = await page.evaluate(() => T.errors);
  ok(errs.length === 0, 'no loop errors ' + (errs.length ? errs.join('\n') : ''));
  const bad = consoleErrors.filter((e) => !/GPU stall|swiftshader|WebGL: INVALID_ENUM|Automatic fallback/i.test(e));
  ok(bad.length === 0, 'no console errors/warnings ' + (bad.length ? '\n' + bad.join('\n') : ''));
  console.log('     log:', (await page.evaluate(() => T.log)).join(' '));
  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
