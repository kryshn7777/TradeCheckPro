/* ABYSSAL TETHER 3D — browser test of FREE ATTACH (the hook bites any surface; the traversal rings are retired).
 *
 *   node tools/abyssal-tether-3d/e2e/free-attach.cjs [--root DIR] [--out DIR] [--port N]
 *
 * Boots the REAL game (desktop, headless Chromium with software WebGL), starts Normal from the DOM menu with a real click and, in S1:
 *   1. checks the level is the free-attach level (no t1 / t2 rings; only the anchors that do something remain) and the boot is clean,
 *   2. aims the view at the north wall: the right hand's target is a surface point ('surf-right') on that wall,
 *   3. fires the right tether (the real mouse button): the hook flies and the line attaches to a baked surface point,
 *   4. aims at the ceiling / a lip / the floor and fires again (the left tether), then swings on the surface holds for a few
 *      seconds with W: finite, alive, within the rope,
 *   5. loads `?freeattach=off` and checks the ring-only level is back (t1 present, the wall is not a target).
 * Screenshots go to <out>/shots/free-*.png. Zero console errors is a check. Exit code 1 when anything failed.
 */
const fs = require('fs');
const http = require('http');
const path = require('path');
const { loadPlaywright, CHROMIUM_ARGS } = require('./playwright.cjs');
const { chromium } = loadPlaywright();

const args = process.argv.slice(2);
const optVal = (name, d) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const OUT = path.resolve(optVal('--out', path.join(__dirname, 'out')));
const SHOTS = path.join(OUT, 'shots');
const GAME_DIR = path.resolve(optVal('--root', path.join(__dirname, '..', '..', '..', 'public', 'abyssal-tether-3d')));
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail !== undefined ? '  — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail)) : ''}`);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.glb': 'model/gltf-binary', '.bin': 'application/octet-stream', '.png': 'image/png', '.jpg': 'image/jpeg', '.ktx2': 'image/ktx2', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.ogg': 'audio/ogg', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };
function startServer(root) {
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
        res.writeHead(404);
        return res.end('not found');
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store' });
      fs.createReadStream(file).pipe(res);
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(optVal('--port', 0)), '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function openGame(browser, base, query, errors) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(180000);
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push('[pageerror] ' + (e.stack || e.message)));
  await page.goto(`${base}/index.html?${query}`);
  await page.waitForFunction(() => window.AT3D && window.AT3D.game && window.AT3D.game.booted, null, { timeout: 180000 });
  await page.evaluate(() => localStorage.clear());
  await page.click('[data-action="difficulty"]');
  await page.waitForSelector('.screen[data-screen="difficulty"]:not([hidden])');
  await page.click('[data-action="start-diff"][data-diff="normal"]');
  await page.waitForFunction(() => window.AT3D.game.state === 'playing');
  await page.evaluate(() => window.AT3D.debug.freeze(true));
  await page.evaluate(() => window.AT3D.debug.step(0.4, { state: false }));
  return { ctx, page };
}
const state = (page) => page.evaluate(() => window.AT3D.debug.state());
const step = (page, s, o) => page.evaluate(([s, o]) => window.AT3D.debug.step(s, o), [s, o || null]);
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, name + '.png'), timeout: 240000 });
/** Point the view at a world point (presentation only). */
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
      g._setLook(Math.atan2(-dx, -dz), Math.max(-1.4, Math.min(1.4, Math.atan2(dy, Math.hypot(dx, dz)))));
    },
    [x, y, z],
  );
const targetOf = (page, hand) =>
  page.evaluate((h) => {
    const t = window.AT3D.game.tethers.hands[h].target;
    return t ? { id: t.id, free: !!t.free, kind: t.kind, x: t.x, y: t.y, z: t.z, edge: !!t.edge, solid: t.solid ? t.solid.id : null } : null;
  }, hand);
const anchorOf = (page, hand) =>
  page.evaluate((h) => {
    const t = window.AT3D.game.tethers.hands[h];
    const a = t.rope.anchor;
    return a ? { id: a.id, free: !!a.free, x: a.x, y: a.y, z: a.z, length: t.rope.length } : null;
  }, hand);

(async () => {
  const { server, base } = await startServer(GAME_DIR);
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  try {
    // ---- the free-attach level ----------------------------------------------------------------------------------------
    const errors = [];
    const { ctx, page } = await openGame(browser, base, 'comms=off&intro=off&hints=off&hitstop=off&knocker=off', errors);
    const lv = await page.evaluate(() => {
      const L = window.AT3D.game.level;
      return { free: L.freeAttach, anchors: L.anchors.length, retired: L.retiredAnchors.length, t1: !!L.byId.t1, cw: !!L.byId['s2-cw'], spawn: L.spawn };
    });
    check('the game builds the free-attach level (no tutorial ring; the objective ring stays)', lv.free === true && lv.t1 === false && lv.cw === true && lv.retired > 40, lv);
    let s = await state(page);
    check('boots into a run with no console errors and no subsystem faults', errors.length === 0 && Object.keys(s.faults).length === 0, { errors: errors.slice(0, 3), faults: s.faults });

    // the north wall of S1: z = -11 (inner face)
    await lookAt(page, -4, 2.2, -11);
    await step(page, 1 / 30, { state: false });
    const t0 = await targetOf(page, 'right');
    check('aimed at the north wall the right hand targets a surface point on it', t0 && t0.free && t0.id === 'surf-right' && t0.solid === 's1-wall-n' && Math.abs(t0.z - -10.96) < 0.1, t0);
    await shot(page, 'free-1-target');

    // fire with the real mouse (pointer lock first: the first click never fires)
    await page.mouse.move(640, 360);
    await page.mouse.click(640, 360);
    await step(page, 0.1, { state: false });
    // hold the button while the hook flies (a 19 m shot is in the air for ~0.25 s; letting go would cancel it)
    let a = null;
    await page.mouse.down({ button: 'left' });
    for (let k = 0; k < 40 && !a; k++) {
      await step(page, 1 / 60, { state: false });
      a = await anchorOf(page, 'right');
    }
    check('LMB (real mouse) fires the right tether onto the wall: a baked surface point, not the highlight', a && a.free && /^surf\d+$/.test(a.id) && Math.abs(a.z - -10.96) < 0.1, a);
    await step(page, 0.3, { state: false });
    await shot(page, 'free-2-attached');

    // swing: W walks off the threshold on the rope; the other hand takes a ceiling / floor hold
    await page.keyboard.down('KeyW');
    let finite = true;
    let alive = true;
    let worst = 0;
    for (let i = 0; i < 180; i++) {
      s = await step(page, 1 / 60, { render: false });
      const p = s.player;
      finite = finite && [p.x, p.y, p.z].every(Number.isFinite);
      alive = alive && s.player.alive !== false && !s.health.dead;
      const an = await anchorOf(page, 'right');
      if (an) worst = Math.max(worst, Math.hypot(p.x - an.x, p.y - an.y, p.z - an.z) - an.length);
    }
    await page.keyboard.up('KeyW');
    check('a few seconds hanging and swinging on a surface hold: finite, alive, within the rope', finite && alive && worst < 1, { worst: +worst.toFixed(2), player: s.player });
    await shot(page, 'free-3-swing');

    // let go, look up and hook the left hand to whatever is overhead / far
    await page.mouse.up({ button: 'left' });
    await step(page, 0.3, { state: false });
    s = await state(page);
    const pl = s.player;
    await lookAt(page, pl.x, pl.y + 6, pl.z - 2);
    await step(page, 1 / 30, { state: false });
    const tl = await targetOf(page, 'left');
    check('looking up, the left hand targets a surface (or nothing within reach), never a ring that is not there', tl === null || (tl.free && tl.id === 'surf-left'), tl);

    // ---- the zero-error gate over the whole run -----------------------------------------------------------------------
    check('zero console errors over the whole free-attach run', errors.length === 0, errors.slice(0, 5));
    await ctx.close();

    // ---- ?freeattach=off: the ring-only level ----------------------------------------------------------------------------
    const errors2 = [];
    const g2 = await openGame(browser, base, 'comms=off&intro=off&hints=off&freeattach=off&hitstop=off&knocker=off', errors2);
    const lv2 = await g2.page.evaluate(() => {
      const L = window.AT3D.game.level;
      return { free: L.freeAttach, anchors: L.anchors.length, t1: !!L.byId.t1 };
    });
    check('?freeattach=off brings back the ring-only level (all 80 anchors, the tutorial ring)', lv2.free === false && lv2.anchors === 80 && lv2.t1 === true, lv2);
    await lookAt(g2.page, -4, 2.2, -11);
    await step(g2.page, 1 / 30, { state: false });
    const t2 = await targetOf(g2.page, 'right');
    check('and the bare north wall is not a target there', t2 === null || !t2.free, t2);
    check('no console errors on the ring-only level either', errors2.length === 0, errors2.slice(0, 3));
    await g2.ctx.close();
  } catch (e) {
    check('free-attach browser test ran to the end', false, String((e && e.stack) || e));
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(failed.length ? `\n${failed.length} FAILED` : '\nALL FREE ATTACH BROWSER CHECKS PASS');
  fs.writeFileSync(path.join(OUT, 'free-attach-result.json'), JSON.stringify({ results }, null, 2));
  process.exit(failed.length ? 1 : 0);
})();
