#!/usr/bin/env node
// Runs the REAL game once in headless Chromium (software WebGL) and screenshots the creature built from the
// current assets/models/mason_kit.glb in S5 and S7 (the stall close-ups the e2e uses). Fails on console errors,
// subsystem faults, or a stand-in creature view.   node verify_game.cjs [--out dir] [--root game dir]
const fs = require('fs');
const http = require('http');
const path = require('path');
const { loadPlaywright, CHROMIUM_ARGS } = require('../../../e2e/playwright.cjs');

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const ROOT = path.resolve(opt('--root', path.join(__dirname, '../../../../../public/abyssal-tether-3d')));
const OUT = path.resolve(opt('--out', path.join(__dirname, 'out')));
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.ktx2': 'image/ktx2' };

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  fs.stat(file, (e, st) => {
    if (e || !st.isFile()) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'content-length': st.size, 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
});

(async () => {
  const { chromium } = loadPlaywright();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(240000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + (e.stack || e.message)));
  const report = { sections: {}, errors };
  await page.goto(base + '/index.html');
  await page.waitForFunction(() => window.AT3D && window.AT3D.game && window.AT3D.game.booted, null, { timeout: 240000 });
  await page.waitForFunction(() => window.AT3D.game.creatureView && !window.AT3D.game.creatureView.isStandIn, null, { timeout: 180000 }).catch(() => {});
  await page.waitForTimeout(2000);
  const boot = await page.evaluate(() => {
    const g = window.AT3D.game; const cv = g.creatureView;
    return { standIn: !!(cv && cv.isStandIn), info: cv && cv.info ? JSON.parse(JSON.stringify(cv.info)) : null, faults: window.AT3D.debug.state().faults, standIns: window.AT3D.debug.state().standIns };
  });
  report.boot = boot;
  console.log('boot', JSON.stringify({ standIn: boot.standIn, faults: boot.faults, tris: boot.info && boot.info.triangles, draws: boot.info && boot.info.drawCalls, missing: boot.info && boot.info.missing }));
  for (const sec of [{ i: 4, name: 'S5' }, { i: 6, name: 'S7' }]) {
    await page.evaluate(() => {
      const g = window.AT3D.game;
      if (g.state !== 'playing') g.start('normal');
      window.AT3D.debug.freeze(true);
      window.AT3D.debug.godMode(true);
    });
    await page.evaluate((i) => window.AT3D.debug.warp(i), sec.i);
    await page.evaluate(() => window.AT3D.debug.setInput({}));
    const r = await page.evaluate(() => {
      const g = window.AT3D.game; const c = g.creature;
      let t = 0; let best = 1e9;
      for (; t < 45; t += 1 / 60) {
        window.AT3D.debug.step(1 / 60, { render: false, state: false });
        if (c.inPlay && c.distance < best) best = c.distance;
        if (c.inPlay && c.body && c.body.visible && c.distance < 11 && c.state !== 'ATTACK') break;
      }
      const b = c.body;
      return { t: +t.toFixed(1), distance: +c.distance.toFixed(1), state: c.state, crown: b && b.spine ? [b.spine[0], b.spine[1], b.spine[2]] : [c.x, c.y, c.z], mid: b && b.spine ? [b.spine[18], b.spine[19], b.spine[20]] : [c.x, c.y, c.z] };
    });
    const target = [(r.crown[0] * 2 + r.mid[0]) / 3, (r.crown[1] * 2 + r.mid[1]) / 3, (r.crown[2] * 2 + r.mid[2]) / 3];
    await page.evaluate(([x, y, z]) => {
      const g = window.AT3D.game; const cam = g.renderer.camera;
      g.rig.updateMatrixWorld(true);
      const e = cam.matrixWorld.elements;
      const dx = x - e[12]; const dy = y - e[13]; const dz = z - e[14];
      g._setLook(Math.atan2(-dx, -dz), Math.max(-1.4, Math.min(1.4, Math.atan2(dy, Math.hypot(dx, dz)))));
      g._updateRig(); g._updateViews(1 / 60); g._render(1 / 60);
    }, target);
    const f = path.join(OUT, `game_${sec.name}.png`);
    await page.screenshot({ path: f });
    const cvi = await page.evaluate(() => { const cv = window.AT3D.game.creatureView; return cv && cv.info ? { drawCalls: cv.info.drawCalls, triangles: cv.info.triangles, lod: cv._lod } : null; });
    report.sections[sec.name] = { ...r, view: cvi };
    console.log(sec.name, JSON.stringify({ distance: r.distance, state: r.state, view: cvi }), f);
  }
  const st = await page.evaluate(() => ({ faults: window.AT3D.debug.state().faults, standIns: window.AT3D.debug.state().standIns }));
  report.final = st;
  await browser.close();
  server.close();
  fs.writeFileSync(path.join(OUT, 'verify_game.json'), JSON.stringify(report, null, 2));
  const ok = errors.length === 0 && !Object.keys(st.faults || {}).length && !boot.standIn;
  console.log(ok ? 'PASS' : 'FAIL', JSON.stringify({ errors: errors.slice(0, 5), faults: st.faults }));
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
