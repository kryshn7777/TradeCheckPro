// WP-AUDIO: loudness table. Renders each new sound ALONE (and a few existing ones for reference) in an
// OfflineAudioContext in headless Chromium and prints peak / RMS (dBFS) and the spectral centroid, so the mix can be
// balanced without listening gear. Not a pass/fail test except for NaN / digital clipping.
//   flock /tmp/at3d-browser.lock node tools/abyssal-tether-3d/tests/audio/run-solo.cjs [--root DIR]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { loadPlaywright, CHROMIUM_ARGS } = require('../../e2e/playwright.cjs');
const { chromium } = loadPlaywright();
const argv = process.argv.slice(2);
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };
let GAME = null;
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>solo</title>'); return; }
  const file = u.startsWith('/game/') ? path.join(GAME, u.slice(6)) : null;
  if (!file || !fs.existsSync(file)) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});
(async () => {
  GAME = (await import(pathToFileURL(path.join(__dirname, '..', '..', 'verify', 'root.mjs')).href)).resolveGameRoot(argv);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ args: CHROMIUM_ARGS });
  const page = await browser.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const rows = await page.evaluate(async () => {
    const cfg = await import('/game/src/sim/config3d.js');
    const { Level3D } = await import('/game/src/sim/level3d.js');
    const { AudioManager3D } = await import('/game/src/audio/audio3d.js');
    const level = new Level3D(undefined, 'normal');
    const sr = 48000;
    const fft = (x) => { // naive radix-2 magnitude spectrum of a power-of-two window
      const n = x.length; const re = Float64Array.from(x); const im = new Float64Array(n);
      for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; } }
      for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len; for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) { const wr = Math.cos(a * k), wi = Math.sin(a * k); const ur = re[i + k], ui = im[i + k]; const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi, vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr; re[i + k] = ur + vr; im[i + k] = ui + vi; re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi; } }
      const m = new Float64Array(n / 2); for (let i = 0; i < n / 2; i++) m[i] = Math.hypot(re[i], im[i]); return m;
    };
    const mkGame = () => {
      const el = new Float64Array(16); el[0] = el[5] = el[10] = el[15] = 1; el[13] = 1.6;
      const rope = () => ({ anchor: null, attached: false, length: 8, tension: 0, slipSpeed: 0 });
      return { state: 'playing', sectionIndex: 0, diff: { lethalImpact: 17 }, level, settings: Object.assign({}, cfg.SETTINGS_DEFAULTS, { volume: 1 }),
        renderer: { camera: { matrixWorld: { elements: el } } }, input: { handPose: (h, o) => Object.assign(o, { x: h === 'left' ? -0.3 : 0.3, y: 1.2, z: -0.4 }) },
        player: { x: 0, y: 1, z: 0, rx: 0, ry: 1, rz: 0, vx: 0, vy: 0, vz: 0, grounded: true, alive: true, tension: 0, groundSolid: { kind: 'stone' } },
        tethers: { hands: { left: { rope: rope() }, right: { rope: rope() } }, anchorStress: () => 0 },
        threat: { value: 0.3, heartRate: 60, beat: 0 }, health: { hurt: 0, hp: 1, heartbeatRate: 60 },
        creature: { active: true, state: 'APPROACHING', listening: false, distance: 12, x: 8, y: 6, z: 2, inPlay: true, audio: { x: 8, y: 6, z: 2, distance: 12, intensity: 0.6, movement: 0, state: 'APPROACHING' }, body: { head: { x: 8, y: 6, z: 2 }, jitter: 0, listen: 0, spine: new Float32Array(60) }, attack: { windup: 0.6 } } };
    };
    // [name, trigger(audio, game)] : one-shots fire at t = 0.7 s with all beds muted; 'cont' ones run update() for a second.
    const T = {
      'old  footstep (stone)': (a) => a._sfxFootstep(0.8),
      'old  drip': (a) => a._sfxDrip(),
      'old  creak (stone)': (a) => a._sfxCreak(),
      'old  creature call': (a) => a._sfxCall(8, 14, 2, 0.8, false, 20),
      'old  strike (hit)': (a) => a._sfxStrike(2, 2, 1, 4, true),
      'old  sighting tone': (a) => a._sfxSighting(30, 20, 3),
      'new  step stone': (a, g) => { g.player.groundSolid = { kind: 'stone' }; g.sectionIndex = 0; a._mov.footstep(0.8, g); },
      'new  step iron': (a, g) => { g.player.groundSolid = { kind: 'metal' }; a._mov.footstep(0.8, g); },
      'new  step wet': (a, g) => { g.sectionIndex = 7; for (let i = 0; i < 60; i++) { g.player.x = i * 5; a._mov.footstep(0.8, g); if (a._mov.surface === 2) break; } },
      'new  amb drip': (a) => a._amb._drip(),
      'new  amb cistern plonk': (a) => a._amb._deep(),
      'new  amb machinery groan': (a) => a._amb._groan(),
      'new  amb iron creak': (a) => a._amb._iron(),
      'new  amb chain': (a) => a._amb._chain(),
      'new  amb slurp': (a) => a._amb._slurp(),
      'new  amb sinew': (a) => a._amb._sinew(),
      'new  rope slip bite': (a) => a._rope.onSlip({ hand: 'left', intensity: 1 }),
      'new  cs pit click': (a) => a._cs._pitClick({ x: 8, y: 6, z: 2 }),
      'new  cs stone clack': (a) => a._cs._clack({ x: 8, y: 6, z: 2 }, true),
      'new  cs windup grind': (a) => a._cs._windup({ x: 8, y: 6, z: 2 }, 0.65),
      'new  cs strike contact': (a) => a._cs._strike({ x: 8, y: 6, z: 2 }, true),
      'new  cs portal clap': (a) => a._cs._strike({ x: 8, y: 6, z: 2 }, false),
      'new  cs rattle': (a) => a._cs._rattle({ x: 8, y: 6, z: 2 }, false),
      'new  cs roar': (a) => a._cs._roar({ x: 8, y: 6, z: 2 }, 2.5),
      'new  cs breath': (a) => a._cs._breath({ x: 8, y: 6, z: 2 }),
      'new  cs leg tap': (a) => a._cs._tap({ x: 8, y: 6, z: 2 }),
      'new  cs knock': (a) => a._cs._knock({ x: 8, y: 6, z: 2 }),
      'new  music glass note': (a) => { a._music.root = 65.41; a._music._note(261.6 * 1.5, 1, false, 0); },
      'new  music bell note': (a) => { a._music.root = 65.41; a._music._note(261.6 * 1.5, 1, true, 0); },
      'new  stinger sighting': (a) => a._music.stinger('sighting'),
      'new  stinger strike': (a) => a._music.stinger('strike'),
      'new  stinger gate': (a) => a._music.stinger('gate'),
      'cont rope friction (full)': (a, g) => { const L = g.tethers.hands.left.rope; L.anchor = {}; L.attached = true; L.length = 10; L.tension = 4 * cfg.CONFIG.player.gravity; L.slipSpeed = 7; },
      'cont rope taut hum only': (a, g) => { const L = g.tethers.hands.left.rope; L.anchor = {}; L.attached = true; L.length = 10; L.tension = 4 * cfg.CONFIG.player.gravity; L.slipSpeed = 0; },
      'cont air rush (fall 26 m/s)': (a, g) => { g.player.vy = -26; g.player.grounded = false; },
      'cont rustle (running)': (a, g) => { g.player.vx = 5; g.player.grounded = true; },
      'cont bed only (S1, menu->play)': () => {},
    };
    const out = [];
    for (const [name, fn] of Object.entries(T)) {
      const cont = name.startsWith('cont');
      const ctx = new OfflineAudioContext(2, sr * 5, sr);
      const audio = new AudioManager3D(new cfg.EventBus(), Object.assign({}, cfg.SETTINGS_DEFAULTS, { volume: 1 }));
      audio._attachContext(ctx);
      const g = mkGame();
      const err = [];
      const step = (k) => ctx.suspend(k * 0.1).then(() => { try { audio.update(0.1, g); } catch (e) { err.push(e.message); } ctx.resume(); });
      if (cont) {
        for (let k = 1; k <= 6; k++) step(k);
        ctx.suspend(0.7).then(() => { try { fn(audio, g); } catch (e) { err.push(e.message); } ctx.resume(); });
        for (let k = 8; k <= 40; k++) step(k);
      } else {
        // beds stay silent (update() is never called, so every continuous layer is at gain 0): only the buses open
        ctx.suspend(0.1).then(() => { audio._pauseFlag = false; audio._state = 'playing'; audio._mixBuses(ctx.currentTime, 'playing'); audio.kMuffle.force(audio._nyq, ctx.currentTime, 0.01); ctx.resume(); });
        ctx.suspend(0.6).then(() => { try { fn(audio, g); } catch (e) { err.push(name + ': ' + e.message); } ctx.resume(); });
      }
      const buf = await ctx.startRendering();
      const L = buf.getChannelData(0), R = buf.getChannelData(1);
      const a0 = Math.floor(sr * (cont ? 3 : 0.6)), a1 = Math.floor(sr * (cont ? 4.5 : 4.9));
      let peak = 0, sq = 0, nan = 0;
      for (let i = a0; i < a1; i++) { const a = L[i], b = R[i]; if (!(a === a) || !(b === b)) { nan++; continue; } peak = Math.max(peak, Math.abs(a), Math.abs(b)); sq += a * a + b * b; }
      const rms = Math.sqrt(sq / (2 * (a1 - a0)));
      // centroid around the peak
      let pi = a0; let pv = 0; for (let i = a0; i < a1; i++) { const v = Math.abs(L[i]); if (v > pv) { pv = v; pi = i; } }
      const win = new Float64Array(4096); for (let i = 0; i < 4096; i++) win[i] = (L[Math.min(L.length - 1, pi - 512 + i)] || 0) * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / 4095));
      const mag = fft(win); let sw = 0, sm = 0; for (let i = 1; i < mag.length; i++) { sw += mag[i] * i * sr / 4096; sm += mag[i]; }
      out.push({ name, peak, rms, centroid: sm > 0 ? sw / sm : 0, nan, err });
    }
    return out;
  });
  await browser.close(); server.close();
  const db = (v) => (v > 1e-6 ? (20 * Math.log10(v)).toFixed(1) : '-inf');
  let bad = 0;
  console.log('sound'.padEnd(34) + 'peak dBFS  rms dBFS  centroid Hz');
  for (const r of rows) {
    if (r.nan || r.peak > 0.99 || r.err.length) bad++;
    console.log(r.name.padEnd(34) + db(r.peak).padStart(9) + db(r.rms).padStart(10) + String(Math.round(r.centroid)).padStart(12) + (r.nan ? '  NaN!' : '') + (r.err.length ? '  ERR ' + r.err[0] : ''));
  }
  const errs = errors.filter((e) => !/autoplay|not allowed/i.test(e));
  if (errs.length) { console.log('console:', errs.slice(0, 5)); bad++; }
  console.log(bad ? 'FAIL' : 'PASS');
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
