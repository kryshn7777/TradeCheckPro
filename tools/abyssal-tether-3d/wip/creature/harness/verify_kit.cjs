#!/usr/bin/env node
// Serves the game folder + the harness page, opens mason_kit.glb in headless Chromium (SwiftShader, three r170
// with an importmap) and screenshots: the raw modules, and the kit assembled by the real CreatureView.
//   node verify_kit.cjs [--kit path/to/mason_kit.glb] [--out dir] [--modes modules,head,body,far]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { loadPlaywright, CHROMIUM_ARGS } = require('../../../e2e/playwright.cjs');

const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const ROOT = path.resolve(__dirname, '../../../../../public/abyssal-tether-3d');
const KIT = path.resolve(opt('--kit', path.join(ROOT, 'assets/models/mason_kit.glb')));
const OUT = path.resolve(opt('--out', path.join(__dirname, 'out')));
const MODES = opt('--modes', 'modules,head,body,far').split(',');
fs.mkdirSync(OUT, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg', '.css': 'text/css' };

const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  let f;
  if (u === '/__kit.glb') f = KIT;
  else if (u === '/__harness.html') f = path.join(__dirname, 'kit_view.html');
  else f = path.join(ROOT, u);
  if (!f.startsWith(ROOT) && f !== KIT && !f.startsWith(__dirname)) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); return res.end('nf'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(d);
  });
});

(async () => {
  const { chromium } = loadPlaywright();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  const results = {};
  for (const mode of MODES) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const msgs = [];
    page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') msgs.push(m.type() + ': ' + m.text()); });
    page.on('pageerror', (e) => msgs.push('pageerror: ' + e.message));
    await page.goto(`http://127.0.0.1:${port}/__harness.html?kit=/__kit.glb&mode=${mode}`);
    await page.waitForFunction(() => window.__done === true, null, { timeout: 180000 });
    const out = await page.evaluate(() => window.__out);
    out.console = msgs;
    await page.screenshot({ path: path.join(OUT, `kit_${mode}.png`) });
    results[mode] = out;
    console.log(mode, JSON.stringify({ ok: out.ok, errors: out.errors, drawCalls: out.drawCalls, tris: out.viewTriangles, missing: out.view && out.view.missing, optional: out.view && out.view.optional, ignored: out.view && out.view.ignored && out.view.ignored.length, console: msgs.slice(0, 5) }));
    await page.close();
  }
  await browser.close();
  server.close();
  fs.writeFileSync(path.join(OUT, 'verify_kit.json'), JSON.stringify(results, null, 2));
  const bad = Object.values(results).some((r) => !r.ok || (r.errors && r.errors.length));
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
