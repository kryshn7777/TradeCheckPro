/* ABYSSAL TETHER 3D — browser end-to-end test (desktop + mock WebXR), reusable.
 *
 *   node tools/abyssal-tether-3d/e2e/e2e.cjs [--root DIR] [--out DIR] [--port N]
 *                                            [--skip-xr] [--skip-descent] [--hesitate S] [--headed]
 *   (npm run e2e:at3d -- …)
 *
 * Playwright: a local install (npm i -D playwright) or the global one
 * (NODE_PATH=$(npm root -g), which this script also tries by itself); Chromium must be
 * installed for it (npx playwright install chromium).
 *
 * 1. Serves the game folder (this checkout's public/abyssal-tether-3d, or --root) from
 *    an in-process static server on 127.0.0.1 (a free port unless --port).
 * 2. Desktop: boots the real game (zero console errors, no stand-ins), starts
 *    Normal from the DOM menu with a real click, checks the start fade, then
 *    tethers in S1 with the REAL mouse / keyboard (arrow keys aim, LMB = right
 *    tether, W swings, release on the sill).
 * 3. Plays the WHOLE descent continuously (no warps): the harness bot's verified
 *    routes (../verify/routes.mjs + bot.mjs, loaded into the page as /__e2e/*)
 *    drive AT3D.debug.setInput / AT3D.debug.step with the creature LIVE; deaths
 *    respawn at the checkpoint and retry that section. Records deaths/causes,
 *    time, victory. Screenshots: menu, S1 start, swing, S4 sighting, creature
 *    close in S5/S7, death, victory.
 * 4. Victory panel + best time persisted across a reload; creature close-ups
 *    (stalling in S5 / S7); the same descent again at human pacing (S seconds,
 *    default 5, standing and looking around on every landing; 0 skips it).
 * 5. Mock XR (page/xr-mock.js): Enter VR by clicking the DOM button → trigger
 *    tether → swing (left stick) → release → B pause → B resume; VR panel
 *    screenshots; stereo draw calls / triangles in 3 sections.
 * Prints a PASS/FAIL table and writes <out>/e2e-result.json (screenshots in
 * <out>/shots/); exit code 1 when anything failed.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { pathToFileURL } = require('url');
const { loadPlaywright, CHROMIUM_ARGS } = require('./playwright.cjs');

const { chromium } = loadPlaywright();

const HERE = __dirname;
const VERIFY_DIR = path.join(HERE, '..', 'verify');
const PAGE_DIR = path.join(HERE, 'page');
const XR_MOCK = path.join(PAGE_DIR, 'xr-mock.js');
const args = process.argv.slice(2);
const opt = (name) => args.includes(name);
const optVal = (name, d) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const OUT = path.resolve(optVal('--out', path.join(HERE, 'out')));
const SHOTS = path.join(OUT, 'shots');
let GAME_DIR = null; // resolved in main() by ../verify/root.mjs (this checkout, or --root / AT3D_ROOT)
fs.mkdirSync(SHOTS, { recursive: true });

const BUDGET = { calls: 150, triangles: 350000 };
const results = [];
const notes = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: detail === undefined ? '' : typeof detail === 'string' ? detail : JSON.stringify(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
}
const log = (...a) => console.log('     ', ...a);

// -----------------------------------------------------------------------------
// Server
// -----------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ktx2': 'image/ktx2',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webmanifest': 'application/manifest+json',
};

/** Static, no-cache file server for the game folder (in-process; no http-server needed). */
function startServer(root, port) {
  const server = http.createServer((req, res) => {
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      res.writeHead(400);
      return res.end();
    }
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, path.normalize(rel));
    if (file !== root && !file.startsWith(root + path.sep)) {
      res.writeHead(403);
      return res.end();
    }
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        return res.end('not found: ' + rel);
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store' });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

// -----------------------------------------------------------------------------
// Page helpers
// -----------------------------------------------------------------------------
async function newPage(browser, { xr = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  const errors = [];
  const warnings = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
    else if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + (e.stack || e.message)));
  if (xr) await page.addInitScript({ path: XR_MOCK });
  // The level bot + its routes + the in-page runner, served under /__e2e/.
  await ctx.route('**/__e2e/*', (route) => {
    const name = new URL(route.request().url()).pathname.split('/').pop();
    let body;
    if (name === 'bot.mjs') body = fs.readFileSync(path.join(VERIFY_DIR, 'bot.mjs'), 'utf8').replace("from './sim.mjs'", "from '/__e2e/sim-shim.mjs'");
    else if (name === 'routes.mjs') body = fs.readFileSync(path.join(VERIFY_DIR, 'routes.mjs'), 'utf8');
    else if (name === 'runner.mjs' || name === 'sim-shim.mjs') body = fs.readFileSync(path.join(PAGE_DIR, name), 'utf8');
    else return route.fulfill({ status: 404, body: 'nope' });
    return route.fulfill({ status: 200, contentType: 'text/javascript', body });
  });
  return { ctx, page, errors, warnings };
}

async function boot(page, base) {
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.AT3D && window.AT3D.game && window.AT3D.game.booted, null, { timeout: 180000 });
}
const st = (page) => page.evaluate(() => window.AT3D.debug.state());
const step = (page, s, o) => page.evaluate(([s, o]) => window.AT3D.debug.step(s, o), [s, o || null]);
const setInput = (page, i) => page.evaluate((i) => window.AT3D.debug.setInput(i), i);
const shot = async (page, name) => {
  const f = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: f, timeout: 240000 });
  return f;
};
/** Desktop: point the view at a world point (presentation only; the bot's intent is world-space). */
const lookAt = (page, x, y, z) =>
  page.evaluate(
    ([x, y, z]) => {
      const g = window.AT3D.game;
      const cam = g.renderer.camera;
      g.rig.updateMatrixWorld(true);
      const e = cam.matrixWorld.elements;
      const dx = x - e[12];
      const dy = y - e[13];
      const dz = z - e[14];
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz));
      g._setLook(yaw, Math.max(-1.4, Math.min(1.4, pitch)));
    },
    [x, y, z],
  );
const renderNow = (page) =>
  page.evaluate(() => {
    const g = window.AT3D.game;
    g._updateRig();
    g._updateViews(1 / 60);
    g._render(1 / 60);
  });
const errorsSince = (arr, n) => arr.slice(n);

// -----------------------------------------------------------------------------
// Part A — desktop boot, menu, start, real mouse/keyboard tether in S1
// -----------------------------------------------------------------------------
async function partDesktop(browser, base) {
  console.log('\n=== Desktop: boot, menu, real-input tether in S1 ===');
  const P = await newPage(browser);
  const { page, errors } = P;
  const t0 = Date.now();
  await boot(page, base);
  await page.evaluate(() => localStorage.clear());
  await page.waitForFunction(() => window.AT3D.game.creatureView && !window.AT3D.game.creatureView.isStandIn, null, { timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2500);
  let s = await st(page);
  check('boots to the menu (real modules, no stand-ins)', s.state === 'menu' && !Object.values(s.standIns).some(Boolean), { state: s.state, standIns: s.standIns, bootMs: Date.now() - t0 });
  check('zero console errors during boot', errors.length === 0, errors.slice(0, 5));
  check('no subsystem faults at boot', Object.keys(s.faults).length === 0, s.faults);
  await shot(page, '01-menu');

  // Start Normal with real clicks on the DOM menu (Difficulty → Normal card).
  await page.click('[data-action="difficulty"]');
  await page.waitForSelector('.screen[data-screen="difficulty"]:not([hidden])');
  // Watch every frame from the start click for the game time at which the start fade
  // clears (reading it seconds later would only see game time that kept running).
  await page.evaluate(() => {
    const g = window.AT3D.game;
    const rec = (window.__fadeClear = { first: null, last: null, at: null });
    const poll = () => {
      if (g.state === 'playing') {
        if (!rec.first) rec.first = { time: +g.time.toFixed(3), fade: +g.fade.toFixed(3) };
        if (g.fade > 0.01) rec.last = { time: +g.time.toFixed(3), fade: +g.fade.toFixed(3) };
        else rec.at = { time: +g.time.toFixed(3), fade: +g.fade.toFixed(3) };
      }
      if (!rec.at) requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
  await page.click('[data-action="start-diff"][data-diff="normal"]');
  await page.waitForFunction(() => window.AT3D.game.state === 'playing');
  const fadeTrace = [];
  const tStart = await page.evaluate(() => [window.AT3D.game.realTime, window.AT3D.game.fade]);
  fadeTrace.push([0, tStart[1]]);
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(250);
    const v = await page.evaluate(() => [window.AT3D.game.realTime, window.AT3D.game.fade, window.AT3D.game.fps]);
    fadeTrace.push([+(v[0] - tStart[0]).toFixed(2), +v[1].toFixed(2), +v[2].toFixed(1)]);
  }
  s = await st(page);
  check('real click on the Normal card starts a Normal run', s.state === 'playing' && s.difficulty === 'normal' && s.ui === null, [s.state, s.difficulty, s.ui]);
  // Fade-in after start: 1 → 0 at 1.5/s of GAME time (frames are capped at 0.1 s, so
  // slow headless frames stretch it in wall time).
  const lastF = fadeTrace[fadeTrace.length - 1];
  const fadeOk = fadeTrace.every(([gt, f]) => f <= Math.max(0, 1 - 1.5 * gt) + 0.12);
  check('start fade clears at 1.5/s of game time (fade vs game time)', fadeOk && (lastF[0] < 0.7 || lastF[1] < 0.05), fadeTrace.map((r) => r.slice(0, 2)));
  await page.evaluate(() => window.AT3D.debug.freeze(true));
  // Run time (game.time) starts at 0 on start() and only advances on simulated frames
  // (realTime also ticks on the frozen presentation frames). `first` is the first playing
  // frame, `last` the last one still fading, `at` the first clear one (frames are capped
  // at 0.1 s of game time, so `at` may be up to one such frame past 0.67 s).
  const fadeClear = await page.evaluate(() => window.__fadeClear);
  const fc = fadeClear || {};
  check(
    'start fade (1.0) clears within ~0.7 s of game time',
    !!(fc.first && fc.last && fc.at && fc.first.fade >= 0.8 && fc.last.time <= 0.75 && fc.at.time <= 0.85),
    fadeClear,
  );
  await step(page, 0.3);
  s = await st(page);
  check('player stands at the spawn, fade cleared', s.player.grounded && s.fade < 0.05 && Math.abs(s.player.y - 0.38) < 0.1, [s.player, s.fade]);
  await renderNow(page);
  await shot(page, '02-s1-start');

  // ---- real keyboard aims, real mouse fires --------------------------------
  // Pointer lock: the first click on the view captures the mouse (it never fires).
  await page.mouse.move(640, 360);
  await page.mouse.click(640, 360);
  await step(page, 0.1);
  const locked = await page.evaluate(() => document.pointerLockElement === window.AT3D.game.renderer.renderer.domElement);
  log('pointer lock after the first click:', locked);
  // Closed loop on the REAL arrow keys: tap Up/Down/Left/Right for a frame at a time
  // until the right hand's target highlight is the first ring.
  const look0 = await page.evaluate(() => [window.AT3D.game.rig.rotation.y, window.AT3D.game.renderer.camera.rotation.x]);
  let aimed = false;
  let taps = 0;
  for (let i = 0; i < 160 && !aimed; i++) {
    const want = await page.evaluate(() => {
      const g = window.AT3D.game;
      const a = g.level.byId.t1;
      const cam = g.renderer.camera;
      g.rig.updateMatrixWorld(true);
      const e = cam.matrixWorld.elements;
      const dx = a.x - e[12];
      const dy = a.y - e[13];
      const dz = a.z - e[14];
      const yaw = Math.atan2(-dx, -dz);
      const pitch = Math.atan2(dy, Math.hypot(dx, dz));
      let dyaw = yaw - g.rig.rotation.y;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      return { dyaw, dpitch: pitch - cam.rotation.x };
    });
    const keys = [];
    if (Math.abs(want.dpitch) > 0.03) keys.push(want.dpitch > 0 ? 'ArrowUp' : 'ArrowDown');
    if (Math.abs(want.dyaw) > 0.03) keys.push(want.dyaw > 0 ? 'ArrowLeft' : 'ArrowRight');
    for (const k of keys) await page.keyboard.down(k);
    s = await step(page, 1 / 60, { render: false });
    for (const k of keys) await page.keyboard.up(k);
    taps += keys.length;
    aimed = s.hands.right.target === 't1';
  }
  log('look before aiming (yaw, pitch):', look0.map((v) => +v.toFixed(3)), 'key taps:', taps);
  check('starting the run and locking the pointer do not swing the view (lock warp ignored)', Math.abs(look0[0]) < 1e-3 && Math.abs(look0[1]) < 1e-3, look0);
  s = await step(page, 1 / 60);
  check('arrow keys aim the view at the first ring (right-hand target t1)', s.hands.right.target === 't1', s.hands.right);
  let attached = false;
  for (let k = 0; k < 4 && !attached; k++) {
    await page.mouse.down({ button: 'left' });
    s = await step(page, 2 / 60);
    attached = s.hands.right.anchor === 't1';
    if (!attached) {
      await page.mouse.up({ button: 'left' });
      await step(page, 2 / 60);
    }
  }
  check('LMB (real mouse) fires the right tether onto t1', attached, s.hands);
  // W walks off the Threshold on the rope; the arc swings out over the sill and the
  // mouse button is let go near the top of the forward swing, over the sill.
  await page.keyboard.down('KeyW');
  let swingShot = false;
  let onSill = false;
  let maxSpeed = 0;
  let wDown = true;
  let released = false;
  for (let i = 0; i < 420 && !onSill; i++) {
    s = await step(page, 1 / 60, { render: false });
    const p = s.player;
    maxSpeed = Math.max(maxSpeed, p.speed);
    if (wDown && !p.grounded && p.y < -0.5) {
      await page.keyboard.up('KeyW');
      wDown = false;
    }
    if (!swingShot && p.y < -2 && s.hands.right.anchor === 't1') {
      swingShot = true;
      await page.evaluate(() => {
        const a = window.AT3D.game.level.byId.t1;
        const g = window.AT3D.game;
        g._setLook(Math.atan2(-(a.x - g.player.x), -(a.z - g.player.z)) + 0.35, 0.55);
      });
      await renderNow(page);
      await shot(page, '03-s1-swing-rope');
    }
    if (!released && !wDown && p.z < -5.5 && p.x > -10 && p.x < 2 && p.y > -4.5 && p.vz > -2.5) {
      await page.mouse.up({ button: 'left' });
      released = true;
    }
    if (!p.alive) break;
    onSill = p.grounded && p.y < -4;
  }
  if (wDown) await page.keyboard.up('KeyW');
  if (!released) await page.mouse.up({ button: 'left' });
  s = await step(page, 0.4);
  const ground = await page.evaluate(() => {
    const p = window.AT3D.game.player;
    return p.groundSolid ? p.groundSolid.id : null;
  });
  check('W swings on the rope and the arc lands on the sill', onSill && s.player.alive && ground === 's1-sill', { maxSpeed: +maxSpeed.toFixed(1), ground, player: s.player });
  check('releasing LMB lets go of the tether', s.hands.right.anchor === null && !s.player.tethered, s.hands.right);
  return P;
}

// -----------------------------------------------------------------------------
// Part B — the whole descent, creature live
// -----------------------------------------------------------------------------
async function partDescent(P) {
  console.log('\n=== Desktop: the whole descent (level bot routes, creature LIVE) ===');
  const { page, errors } = P;
  const e0 = errors.length;
  await page.evaluate(async () => {
    const { Runner } = await import('/__e2e/runner.mjs');
    window.__run = new Runner();
    const g = window.AT3D.game;
    const gs = g.player.groundSolid ? g.player.groundSolid.id : null;
    // Continue S1's route from where the hand-played swing left us.
    if (gs === 's1-sill') window.__run.startRoute(0, 2, false);
    else {
      // Anywhere else (the pocket under the gap, a ledge): back to the checkpoint via the pause menu.
      if (gs !== 's1-threshold' && g.state === 'playing') {
        g.pause();
        g.respawn();
      }
      window.__run.startRoute(0, 0, true);
    }
  });
  const wall0 = Date.now();
  const stops = ['sighting', 'close5', 'close7', 'death'];
  let res = null;
  let chunks = 0;
  for (;;) {
    res = await page.evaluate((stops) => window.__run.run(1800, stops), stops);
    chunks++;
    if (res.status === 'running') {
      const sm = await page.evaluate(() => window.__run.summary());
      if (chunks % 3 === 0) log(`t=${sm.time}s route=${sm.route} step=${sm.step} y=${sm.player.y} deaths=${sm.deathsGame}`);
      if (Date.now() - wall0 > 40 * 60 * 1000) {
        res = { status: 'abort', why: 'wall-clock budget' };
        break;
      }
      continue;
    }
    if (res.status === 'stop') {
      const why = res.why;
      log('screenshot moment:', why);
      if (why === 'death') {
        await page.waitForTimeout(1500); // the DOM death panel fades in on wall-clock CSS transitions
        await renderNow(page);
        await shot(page, '07-death');
      } else {
        await page.evaluate(() => {
          const c = window.AT3D.game.creature;
          const b = c.body;
          // Aim at the crown (spine[0..2]) or the creature's position.
          window.__aimC = b && b.spine ? [b.spine[0], b.spine[1], b.spine[2]] : [c.x, c.y, c.z];
        });
        const c = await page.evaluate(() => window.__aimC);
        await lookAt(page, c[0], c[1], c[2]);
        await renderNow(page);
        const name = why === 'sighting' ? '04-s4-sighting' : why === 'close5' ? '05-s5-creature-close' : '06-s7-creature-close';
        await shot(page, name);
        const info = await page.evaluate(() => {
          const g = window.AT3D.game;
          const c = g.creature;
          return { section: g.sectionIndex, state: c.state, distance: +c.distance.toFixed(1), visible: !!(c.body && c.body.visible) };
        });
        log(name, JSON.stringify(info));
      }
      continue;
    }
    break;
  }
  const sm = await page.evaluate(() => window.__run.summary());
  const wall = ((Date.now() - wall0) / 1000).toFixed(0);
  log('descent summary:', JSON.stringify({ state: sm.state, time: sm.time, deaths: sm.deathsGame, routes: sm.routes, tries: sm.tries, relocations: sm.relocations, maxLand: sm.maxLand, wallSeconds: +wall }));
  for (const d of sm.deaths) log('death:', JSON.stringify(d));
  for (const f of sm.failures) log('route lost (not a death):', JSON.stringify(f));
  check('whole descent completed continuously to victory (no warps)', res.status === 'victory', { status: res.status, why: res.why, at: sm.player, route: sm.route });
  const byCause = {};
  for (const d of sm.deaths) byCause[d.cause] = (byCause[d.cause] || 0) + 1;
  check('descent deaths recorded (count + causes)', true, { deaths: sm.deathsGame, byCause, time: sm.time });
  check('no console errors during the descent', errors.length === e0, errorsSince(errors, e0).slice(0, 5));
  const s = await st(page);
  check('no subsystem faults during the descent', Object.keys(s.faults).length === 0, s.faults);
  const stopsDone = await page.evaluate(() => Object.assign({}, window.__run.stopsDone));
  return { sm, res, stopsDone };
}

// -----------------------------------------------------------------------------
// Part C — victory panel, best time persisted across a reload, a death screen
// -----------------------------------------------------------------------------
async function partVictory(P, base, descent) {
  console.log('\n=== Desktop: victory panel + persistence ===');
  const { page, errors } = P;
  if (descent && descent.res.status === 'victory') {
    await page.evaluate(() => window.AT3D.debug.freeze(false));
    await page.waitForTimeout(1500);
    const v = await page.evaluate(() => {
      const g = window.AT3D.game;
      const q = (s) => {
        const el = document.querySelector(s);
        return el ? el.textContent.trim() : null;
      };
      return {
        state: g.state,
        ui: g.ui.current,
        shown: !document.querySelector('.screen[data-screen="victory"]').hidden,
        time: g.time,
        vTime: q('.v-time'),
        vDeaths: q('.v-deaths'),
        stored: localStorage.getItem('abyssalTether3d.v1.best.normal'),
        info: g.lastVictory,
      };
    });
    const fmt = (t) => {
      const m = Math.floor(t / 60);
      const sec = t - m * 60;
      return `${m}:${sec < 10 ? '0' : ''}${sec.toFixed(2)}`;
    };
    check('victory panel shown with the run time', v.state === 'victory' && v.ui === 'victory' && v.shown && v.vTime === fmt(v.time), v);
    check('victory panel deaths match the run', v.vDeaths === String(descent.sm.deathsGame), [v.vDeaths, descent.sm.deathsGame]);
    check('best time stored (Normal)', v.stored !== null && Math.abs(+v.stored - v.time) < 1e-6, [v.stored, v.time]);
    await shot(page, '08-victory');
    await page.reload();
    await page.waitForFunction(() => window.AT3D && window.AT3D.game && window.AT3D.game.booted, null, { timeout: 180000 });
    await page.waitForTimeout(1000);
    const after = await page.evaluate(() => ({
      stored: localStorage.getItem('abyssalTether3d.v1.best.normal'),
      strip: Array.from(document.querySelectorAll('.best-strip dd')).map((d) => d.textContent),
      startSub: document.querySelector('.menu-start-sub').textContent,
    }));
    check('best time persisted across a reload (storage + menu)', after.stored === v.stored && after.strip[0] === fmt(+v.stored) && after.startSub.includes(fmt(+v.stored)), after);
  } else {
    check('victory panel shown with the run time', false, 'descent did not reach victory');
  }
  // A death screen (if the descent never showed one): a deliberate 15 m fall into S2.
  if (!fs.existsSync(path.join(SHOTS, '07-death.png')) || (descent && !descent.sm.deaths.length)) {
    await page.evaluate(() => window.AT3D.game.start('normal'));
    await page.evaluate(() => window.AT3D.debug.freeze(true));
    await step(page, 0.8);
    await page.evaluate(() => window.AT3D.debug.teleport(8, -6.6, -6));
    let s = await step(page, 2.5);
    check('a 15 m fall kills (impact) and shows the death panel', s.state === 'dead' && s.player.deathCause === 'impact' && s.ui === 'death', [s.state, s.player.deathCause, s.ui]);
    await page.waitForTimeout(1500);
    await renderNow(page);
    await shot(page, '07-death');
    await setInput(page, { confirmPressed: true });
    s = await step(page, 2 / 60);
    await setInput(page, null);
    check('Enter after death respawns at the checkpoint', s.state === 'playing' && s.player.alive, [s.state, s.player]);
  }
  check('no console errors (victory / reload / death)', errors.length === 0, errors.slice(0, 5));
}

// -----------------------------------------------------------------------------
// Part C2 — the creature up close (S5 / S7) when the descent never let it near
// -----------------------------------------------------------------------------
async function partCreature(P, stopsDone) {
  console.log('\n=== Desktop: the creature up close (stall in S5 / S7) ===');
  const { page, errors } = P;
  const e0 = errors.length;
  for (const sec of [
    { i: 4, key: 'close5', name: '05-s5-creature-close' },
    { i: 6, key: 'close7', name: '06-s7-creature-close' },
  ]) {
    if (stopsDone && stopsDone[sec.key]) continue;
    await page.evaluate(() => {
      const g = window.AT3D.game;
      if (g.state !== 'playing') g.start('normal');
      window.AT3D.debug.freeze(true);
      window.AT3D.debug.godMode(true); // the lunge may land: no death screen in the way
    });
    await page.evaluate((i) => window.AT3D.debug.warp(i), sec.i);
    await setInput(page, {});
    // Stall at the checkpoint (a VR player looking around): it comes down and presses in.
    const r = await page.evaluate(() => {
      const g = window.AT3D.game;
      const c = g.creature;
      let t = 0;
      let best = 1e9;
      for (; t < 45; t += 1 / 60) {
        window.AT3D.debug.step(1 / 60, { render: false, state: false });
        if (c.inPlay && c.distance < best) best = c.distance;
        if (c.inPlay && c.body && c.body.visible && c.distance < 11 && c.state !== 'ATTACK') break;
      }
      const b = c.body;
      return { t: +t.toFixed(1), distance: +c.distance.toFixed(1), best: +best.toFixed(1), state: c.state, crown: b && b.spine ? [b.spine[0], b.spine[1], b.spine[2]] : [c.x, c.y, c.z], mid: b && b.spine ? [b.spine[18], b.spine[19], b.spine[20]] : [c.x, c.y, c.z] };
    });
    // Frame the crown and the body behind it.
    await lookAt(page, (r.crown[0] * 2 + r.mid[0]) / 3, (r.crown[1] * 2 + r.mid[1]) / 3, (r.crown[2] * 2 + r.mid[2]) / 3);
    await renderNow(page);
    await shot(page, sec.name);
    check(`stalling in ${sec.i === 4 ? 'S5' : 'S7'}: the creature comes within 11 m`, r.distance <= 11.05, r);
  }
  await page.evaluate(() => window.AT3D.debug.godMode(false));
  await setInput(page, null);
  check('no console errors (creature close-ups)', errors.length === e0, errorsSince(errors, e0).slice(0, 5));
}

// -----------------------------------------------------------------------------
// Part C3 — the same descent at human pacing: the player stands and looks around
// for `idle` seconds on every landing (creature fairness under hesitation)
// -----------------------------------------------------------------------------
async function partHumanPacing(P, idle) {
  console.log(`\n=== Desktop: whole descent at human pacing (${idle} s look-around on every landing) ===`);
  const { page, errors } = P;
  const e0 = errors.length;
  await page.evaluate(async (idle) => {
    const g = window.AT3D.game;
    window.AT3D.debug.godMode(false);
    window.AT3D.debug.setInput({});
    g.start('normal');
    window.AT3D.debug.freeze(true);
    window.AT3D.debug.step(0.8, { render: false, state: false });
    const { Runner } = await import('/__e2e/runner.mjs');
    window.__run2 = new Runner({ idle });
    window.__run2.startRoute(0, 0, true);
  }, idle);
  const wall0 = Date.now();
  let res;
  for (;;) {
    res = await page.evaluate(() => window.__run2.run(2400, []));
    if (res.status !== 'running') break;
    if (Date.now() - wall0 > 30 * 60 * 1000) {
      res = { status: 'abort', why: 'wall-clock budget' };
      break;
    }
  }
  const sm = await page.evaluate(() => window.__run2.summary());
  const byCause = {};
  for (const d of sm.deaths) byCause[d.cause] = (byCause[d.cause] || 0) + 1;
  log('human-pacing summary:', JSON.stringify({ state: sm.state, time: sm.time, deaths: sm.deathsGame, byCause, idles: sm.idles, reactions: sm.reactions, tries: sm.tries, creature: sm.creatureStats, wallSeconds: Math.round((Date.now() - wall0) / 1000) }));
  for (const d of sm.deaths) log('death:', JSON.stringify(d));
  for (const f of sm.failures) log('route lost (not a death):', JSON.stringify(f));
  check(`human pacing (${idle} s look-around per landing) reaches victory`, res.status === 'victory', { status: res.status, why: res.why, time: sm.time, deaths: sm.deathsGame, byCause });
  check('no console errors (human-pacing descent)', errors.length === e0, errorsSince(errors, e0).slice(0, 5));
  return sm;
}

// -----------------------------------------------------------------------------
// Part D — mock WebXR
// -----------------------------------------------------------------------------
async function partXR(browser, base) {
  console.log('\n=== Mock WebXR: enter VR, trigger tether, swing, release, B pause/resume, budgets ===');
  const P = await newPage(browser, { xr: true });
  const { page, errors } = P;
  await boot(page, base);
  await page.waitForFunction(() => window.AT3D.game.creatureView && !window.AT3D.game.creatureView.isStandIn, null, { timeout: 120000 }).catch(() => {});
  await page.waitForSelector('[data-action="enter-vr"]:not([hidden])', { timeout: 30000 });
  await page.click('[data-action="enter-vr"]');
  await page.waitForFunction(() => window.AT3D.game.xrActive && window.__xr.frames > 10, null, { timeout: 120000 });
  let s = await st(page);
  check('Enter VR (real click) starts the immersive session', s.xr === true && s.state === 'menu', [s.xr, s.state]);
  await page.waitForTimeout(800);
  await shot(page, '09-vr-menu-panel');
  await page.evaluate(() => window.AT3D.game.ui.show('difficulty'));
  await page.waitForTimeout(1200);
  await shot(page, '10-vr-difficulty-panel');
  // The panel's own canvas at full resolution (what the CanvasTexture shows).
  const png = await page.evaluate(() => {
    const vr = window.AT3D.game.ui._vr;
    return vr && vr.panelC ? vr.panelC.canvas.toDataURL('image/png') : null;
  });
  if (png) fs.writeFileSync(path.join(SHOTS, '10b-vr-difficulty-canvas.png'), Buffer.from(png.split(',')[1], 'base64'));
  const fit = await page.evaluate(() => {
    // Re-measure the card names the way the panel painter does (font fit on this device).
    const c = document.createElement('canvas').getContext('2d');
    const out = {};
    for (const n of ['NORMAL', 'NIGHTMARE', 'ABYSS']) {
      let px = 40;
      const f = (p) => `700 ${p}px Georgia, 'Iowan Old Style', 'Palatino Linotype', 'Noto Serif', 'DejaVu Serif', serif`;
      const w = (p) => {
        c.font = f(p);
        try {
          c.letterSpacing = '0.08em';
        } catch {
          /* */
        }
        return c.measureText(n).width;
      };
      while (px > 26 && w(px) > 268) px -= 2;
      out[n] = { px, w: Math.round(w(px)) };
    }
    return out;
  });
  check('VR difficulty card names fit their cards (≤ 268 px of 312)', Object.values(fit).every((o) => o.w <= 268 || o.px <= 26), fit);
  await page.evaluate(() => window.AT3D.game.ui.show('menu'));

  await page.evaluate(() => window.AT3D.game.start('normal'));
  await page.waitForFunction(() => window.AT3D.game.state === 'playing' && window.AT3D.game.fade < 0.05, null, { timeout: 120000 });
  // Let the recentre settle on real XR frames, then freeze the sim.
  await page.waitForFunction((f) => window.__xr.frames > f, (await page.evaluate(() => window.__xr.frames)) + 8);
  await page.evaluate(() => window.AT3D.debug.freeze(true));
  s = await step(page, 0.3);
  check('XR rig: head over the body (rig = body − 1.1 m, recentred)', Math.abs(s.rig.y - (s.player.y - 1.1)) < 0.05 && s.player.grounded, [s.rig, s.player]);

  // Aim the right controller's ray at t1 (rig-local pose for the mock).
  const aimCtrl = (hand, id) =>
    page.evaluate(
      ([hand, id]) => {
        const g = window.AT3D.game;
        const a = g.level.byId[id];
        const rig = g.rig;
        rig.updateMatrixWorld(true);
        const inv = rig.matrixWorld.clone().invert();
        const v = { x: a.x, y: a.y, z: a.z };
        const e = inv.elements;
        const lx = e[0] * v.x + e[4] * v.y + e[8] * v.z + e[12];
        const ly = e[1] * v.x + e[5] * v.y + e[9] * v.z + e[13];
        const lz = e[2] * v.x + e[6] * v.y + e[10] * v.z + e[14];
        const c = window.__xr.ctrl[hand];
        const dx = lx - c.x;
        const dy = ly - c.y;
        const dz = lz - c.z;
        c.yaw = Math.atan2(-dx, -dz);
        c.pitch = Math.atan2(dy, Math.hypot(dx, dz));
        return [c.yaw, c.pitch];
      },
      [hand, id],
    );
  const xrWait = async (n) => {
    const f0 = await page.evaluate(() => window.__xr.frames);
    await page.waitForFunction((f) => window.__xr.frames >= f, f0 + n, { timeout: 120000 });
  };
  const button = (hand, idx, on) =>
    page.evaluate(
      ([hand, idx, on]) => {
        const src = window.__xr.session.inputSources.find((x) => x.handedness === hand);
        const b = src.gamepad.buttons[idx];
        b.pressed = on;
        b.touched = on;
        b.value = on ? 1 : 0;
      },
      [hand, idx, on],
    );
  const stick = (hand, x, y) =>
    page.evaluate(
      ([hand, x, y]) => {
        const src = window.__xr.session.inputSources.find((s) => s.handedness === hand);
        src.gamepad.axes[2] = x;
        src.gamepad.axes[3] = y;
      },
      [hand, x, y],
    );
  await aimCtrl('right', 't1');
  await xrWait(3);
  s = await step(page, 2 / 60);
  check('XR: right controller ray targets t1', s.hands.right.target === 't1', s.hands.right);
  const h0 = await page.evaluate(() => window.__xr.haptics.length);
  await button('right', 0, true);
  s = await step(page, 2 / 60);
  const hap = await page.evaluate((n) => window.__xr.haptics.slice(n), h0);
  check('XR: trigger fires the tether (attached to t1, haptic pulse)', s.hands.right.anchor === 't1' && hap.some((h) => h[0] === 'right'), [s.hands.right, hap.slice(0, 3)]);
  // Swing: left stick forward (relative to the head) off the Threshold, stick released
  // once airborne, trigger released near the top of the forward swing over the sill.
  await stick('left', 0, -1);
  let maxSpeed = 0;
  let shotTaken = false;
  let stickOn = true;
  let released = false;
  let landed = false;
  for (let i = 0; i < 420 && !landed; i++) {
    s = await step(page, 1 / 60, { render: false });
    const p = s.player;
    maxSpeed = Math.max(maxSpeed, p.speed);
    if (stickOn && !p.grounded && p.y < -0.5) {
      await stick('left', 0, 0);
      stickOn = false;
      check('XR: left stick swings on the rope', s.hands.right.anchor === 't1' && p.speed > 3, { speed: p.speed, y: p.y });
    }
    if (!shotTaken && p.y < -1.5) {
      shotTaken = true;
      await xrWait(2);
      await shot(page, '11-vr-swing-rope');
    }
    if (!released && !stickOn && p.z < -5.5 && p.x > -10 && p.x < 2 && p.y > -4.5 && p.vz > -2.5) {
      await button('right', 0, false);
      released = true;
      s = await step(page, 3 / 60);
      check('XR: releasing the trigger lets go', s.hands.right.anchor === null, s.hands.right);
    }
    if (!p.alive) break;
    landed = p.grounded && p.y < -4;
  }
  if (stickOn) await stick('left', 0, 0);
  if (!released) {
    await button('right', 0, false);
    check('XR: releasing the trigger lets go (over the sill)', false, { player: s.player, maxSpeed });
  }
  s = await step(page, 0.3);
  const gs = await page.evaluate(() => (window.AT3D.game.player.groundSolid ? window.AT3D.game.player.groundSolid.id : null));
  check('XR: the swing lands on the sill (alive, grounded)', s.player.alive && s.player.grounded && gs === 's1-sill', { gs, player: s.player, maxSpeed: +maxSpeed.toFixed(1) });
  // B pauses, B resumes.
  await button('right', 5, true);
  s = await step(page, 2 / 60);
  await button('right', 5, false);
  s = await step(page, 2 / 60);
  check('XR: B pauses (VR pause panel up)', s.state === 'paused' && s.ui === 'pause', [s.state, s.ui]);
  await xrWait(3);
  await shot(page, '12-vr-pause-panel');
  await button('right', 5, true);
  s = await step(page, 2 / 60);
  await button('right', 5, false);
  s = await step(page, 2 / 60);
  check('XR: B again resumes', s.state === 'playing' && s.ui === null, [s.state, s.ui]);

  // Stereo budgets in three representative sections (max over 4 head yaws).
  await page.evaluate(() => window.AT3D.debug.godMode(true));
  const sections = [
    { i: 0, name: 'S1 Threshold' },
    { i: 3, name: 'S4 Listening Vault' },
    { i: 6, name: 'S7 Hollow Nave' },
  ];
  const budget = [];
  for (const sec of sections) {
    await page.evaluate((i) => window.AT3D.debug.warp(i), sec.i);
    await step(page, 0.5);
    let worst = { calls: 0, triangles: 0 };
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      await page.evaluate((y) => (window.__xr.head.yaw = y), yaw);
      await xrWait(3);
      const pf = await page.evaluate(() => Object.assign({}, window.AT3D.game.perf));
      if (pf.calls > worst.calls) worst.calls = pf.calls;
      if (pf.triangles > worst.triangles) worst.triangles = pf.triangles;
    }
    budget.push(Object.assign({ section: sec.name }, worst));
    check(`XR stereo budget ${sec.name}: ≤${BUDGET.calls} calls, ≤${BUDGET.triangles / 1000}k tris`, worst.calls <= BUDGET.calls && worst.triangles <= BUDGET.triangles, worst);
    if (sec.i === 6) await shot(page, '13-vr-s7-nave');
  }
  await page.evaluate(() => (window.__xr.head.yaw = 0.7));
  check('no console errors in XR', errors.length === 0, errors.slice(0, 5));
  s = await st(page);
  check('no subsystem faults in XR', Object.keys(s.faults).length === 0, s.faults);
  return { P, budget };
}

// -----------------------------------------------------------------------------
(async () => {
  const { resolveGameRoot } = await import(pathToFileURL(path.join(VERIFY_DIR, 'root.mjs')).href);
  GAME_DIR = resolveGameRoot(args);
  const { server, base } = await startServer(GAME_DIR, +optVal('--port', 0) || 0);
  console.log('serving', GAME_DIR, 'at', base);
  for (const f of fs.readdirSync(SHOTS)) if (f.endsWith('.png')) fs.unlinkSync(path.join(SHOTS, f));
  const browser = await chromium.launch({ headless: !opt('--headed'), args: CHROMIUM_ARGS });
  const t0 = Date.now();
  try {
    const P = await partDesktop(browser, base);
    let descent = null;
    if (!opt('--skip-descent')) descent = await partDescent(P);
    await partVictory(P, base, descent);
    await partCreature(P, descent ? descent.stopsDone : {});
    const idle = +optVal('--hesitate', 5);
    if (idle > 0 && !opt('--skip-descent')) await partHumanPacing(P, idle);
    await P.ctx.close();
    if (!opt('--skip-xr')) {
      const x = await partXR(browser, base);
      await x.P.ctx.close();
    }
  } catch (err) {
    check('script ran to completion', false, String((err && err.stack) || err).slice(0, 600));
  } finally {
    await browser.close();
    server.close();
  }
  // ---- table -------------------------------------------------------------------
  const w = Math.max(...results.map((r) => r.name.length));
  console.log('\n' + '='.repeat(w + 60));
  console.log(`${'CHECK'.padEnd(w)} | RESULT | DETAIL`);
  console.log('-'.repeat(w + 60));
  for (const r of results) console.log(`${r.name.padEnd(w)} | ${r.ok ? 'PASS  ' : 'FAIL  '} | ${r.detail.length > 160 ? r.detail.slice(0, 157) + '...' : r.detail}`);
  console.log('='.repeat(w + 60));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`${results.length - failed}/${results.length} passed${failed ? `, ${failed} FAILED` : ''}`);
  for (const n of notes) console.log('note:', n);
  fs.writeFileSync(path.join(OUT, 'e2e-result.json'), JSON.stringify({ gameRoot: GAME_DIR, date: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), passed: results.length - failed, failed, results }, null, 1));
  process.exit(failed ? 1 : 0);
})();
