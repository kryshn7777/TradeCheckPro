// WP-AUDIO: renders the real soundscape in headless Chromium with an OfflineAudioContext (no output device needed) and
// reports peak / RMS per scenario segment, NaN / clipping counts, voice counts and the render-time ratio.
//   node tools/abyssal-tether-3d/tests/audio/run-offline.cjs [--root DIR] [--seconds 70] [--reduced]
// Run under `flock /tmp/at3d-browser.lock`. Exit 1 on NaN, clipping above 0.99 or a console error.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { loadPlaywright, CHROMIUM_ARGS } = require('../../e2e/playwright.cjs');

const { chromium } = loadPlaywright();
const argv = process.argv.slice(2);
const argVal = (k, d) => (argv.indexOf(k) >= 0 ? argv[argv.indexOf(k) + 1] : d);
const SECONDS = Number(argVal('--seconds', 70));
const REDUCED = argv.includes('--reduced');
const BASELINE = argv.includes('--baseline'); // modules off: the pre-WP-AUDIO layers only (loudness comparison)
const TYPES = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.html': 'text/html', '.json': 'application/json' };
let GAME = null;
const PAGE = '<!doctype html><meta charset=utf-8><title>audio offline</title><body>offline</body>';
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(req.url.split('?')[0]);
  if (u === '/' || u === '/index.html') {
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(PAGE);
    return;
  }
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
  const result = await page.evaluate(async ({ SECONDS, REDUCED, BASELINE }) => {
    const cfg = await import('/game/src/sim/config3d.js');
    const { Level3D } = await import('/game/src/sim/level3d.js');
    const { AudioManager3D } = await import('/game/src/audio/audio3d.js');
    const level = new Level3D(undefined, 'normal');
    const sr = 48000;
    const ctx = new OfflineAudioContext(2, Math.ceil(sr * SECONDS), sr);
    const bus = new cfg.EventBus();
    const settings = Object.assign({}, cfg.SETTINGS_DEFAULTS, { volume: 1, reducedEffects: REDUCED });
    const audio = new AudioManager3D(bus, settings);
    audio._attachContext(ctx);
    if (BASELINE) for (const m of audio._mods) m.broken = true;
    const el = new Float64Array(16);
    el[0] = el[5] = el[10] = el[15] = 1;
    el[13] = 1.6;
    const rope = () => ({ anchor: null, attached: false, length: 8, tension: 0, slipSpeed: 0 });
    const g = {
      state: 'menu', sectionIndex: 0, diff: { lethalImpact: 17 }, level, settings,
      renderer: { camera: { matrixWorld: { elements: el } } },
      input: { handPose: (h, o) => Object.assign(o, { x: h === 'left' ? -0.3 : 0.3, y: 1.2, z: -0.4 }) },
      player: { x: 0, y: 1, z: 0, rx: 0, ry: 1, rz: 0, vx: 0, vy: 0, vz: 0, grounded: true, alive: true, tension: 0, groundSolid: { kind: 'stone' } },
      tethers: { hands: { left: { rope: rope() }, right: { rope: rope() } }, anchorStress: () => 0 },
      threat: { value: 0, heartRate: 60, beat: 0 },
      health: { hurt: 0, hp: 1, heartbeatRate: 60 },
      creature: { active: true, state: 'DISTANT', listening: false, distance: 120, x: 10, y: 60, z: 5, inPlay: true,
        audio: { x: 10, y: 60, z: 5, distance: 120, intensity: 0.2, movement: 0.3, state: 'DISTANT' },
        body: { head: { x: 10, y: 60, z: 5 }, jitter: 0, listen: 0, spine: new Float32Array(60) }, attack: { windup: 0.6 } },
    };
    const secOf = (t) => Math.min(7, Math.max(0, Math.floor((t - 36) / 3)));
    const emit = (t, p) => bus.emit(t, p || {});
    let lastSec = -1;
    const log = { voices: [], peakVoices: 0, hrtf: 0 };
    const script = (t) => {
      const P = g.player;
      const C = g.creature;
      if (t >= 0.3 && g.state === 'menu') { g.state = 'playing'; emit('game:start'); }
      // walking 2-6 s
      P.vx = t > 2 && t < 6 ? 4 : 0;
      // rope 6-12 s
      const L = g.tethers.hands.left.rope;
      if (t >= 6 && t < 12) {
        if (!L.anchor) { L.anchor = {}; L.attached = true; emit('rope:fire', { hand: 'left', target: true, dur: 0.2, x: 3, y: 5, z: -4 }); emit('grapple:attach', { hand: 'left', speed: 9, x: 3, y: 5, z: -4 }); }
        L.tension = (2.5 + 2.2 * Math.sin(t)) * cfg.CONFIG.player.gravity;
        L.slipSpeed = t > 8 ? Math.min(8, (t - 8) * 2.5) : 0;
        L.length += L.slipSpeed * 0.1;
        if (L.slipSpeed > 0.6) emit('rope:slip', { hand: 'left', intensity: Math.min(1, L.slipSpeed / 8), speed: L.slipSpeed, load: L.tension / cfg.CONFIG.player.gravity });
      } else if (L.anchor) { L.anchor = null; L.attached = false; L.slipSpeed = 0; L.tension = 0; emit('grapple:release', { hand: 'left', speed: 3 }); }
      if (Math.abs(t - 12.5) < 0.05) { emit('player:jump'); }
      if (Math.abs(t - 13.5) < 0.05) { emit('player:land', { impact: 14, hard: true, lethalRatio: 0.8 }); emit('health:damage', { amount: 0.35 }); }
      if (Math.abs(t - 15) < 0.05) emit('player:wallhit', { impact: 12 });
      // falling 14.5-16
      P.vy = t > 14.2 && t < 16 ? -26 : 0;
      P.grounded = !(t > 14.2 && t < 16);
      // threat ramp 16-30
      g.threat.value = t < 16 ? 0.05 : t < 30 ? Math.min(0.9, 0.05 + (t - 16) * 0.06) : t < 36 ? 0.3 : 0.05;
      if (t >= 16 && t < 36) { C.state = 'PURSUING'; C.distance = C.audio.distance = Math.max(8, 70 - (t - 16) * 3.5); C.audio.y = 2 + C.distance * 0.3; C.audio.x = 8; C.audio.z = 3; C.y = C.audio.y; C.audio.movement = 0.7; C.body.head = { x: 8, y: C.audio.y, z: 3 }; }
      if (t >= 20 && t < 23) { C.state = 'OBSERVING'; C.listening = true; C.body.listen = 1; } else if (t >= 23) { C.listening = false; C.body.listen = 0; }
      if (Math.abs(t - 17) < 0.05) emit('creature:call', { x: 8, y: 30, z: 3, intensity: 0.8, distance: 40 });
      if (Math.abs(t - 18.5) < 0.05) { emit('creature:clip', { name: 'roar_display', event: 'start' }); emit('creature:clip', { name: 'rear_windup', event: 'start' }); }
      if (t >= 17 && t < 20 && Math.round(t * 10) % 7 === 0) emit('creature:step', { x: 8, y: C.audio.y, z: 3, intensity: 0.7, distance: C.distance });
      if (Math.abs(t - 21) < 0.05) emit('creature:clip', { name: 'listen', event: 'pulse' });
      if (Math.abs(t - 24) < 0.05) emit('creature:burst', { x: 8, y: 8, z: 3, distance: 10, reason: 'heard', snap: 0.3 });
      if (Math.abs(t - 25) < 0.05) emit('creature:attack', { x: 8, y: 8, z: 3, windup: 0.6, distance: 10, cause: 'stall' });
      if (Math.abs(t - 25.7) < 0.05) emit('creature:strike', { x: 2, y: 2, z: 1, hit: false, distance: 3 });
      if (Math.abs(t - 26.5) < 0.05) { emit('creature:clip', { name: 'recoil', event: 'start' }); emit('creature:clip', { name: 'linger_breathe', event: 'inhale' }); }
      if (Math.abs(t - 31) < 0.05) emit('creature:sighting', { x: 40, y: 20, z: 3, duration: 8 });
      if (Math.abs(t - 33) < 0.05) { emit('game:goal'); emit('creature:attack', { gate: true, x: 8, y: 8, z: 3 }); }
      if (t >= 36) { const s = secOf(t); P.vy = -8; P.grounded = false; if (s !== lastSec) { lastSec = s; g.sectionIndex = s; emit('section:enter', { index: s, first: true, section: level.sections[s] }); } }
      if (t >= 36 && t < 60) { g.threat.value = 0.15; C.state = 'DISTANT'; C.distance = C.audio.distance = 120; }
      if (Math.abs(t - 60) < 0.05) { g.state = 'victory'; emit('game:victory'); }
    };
    const dt = 0.1;
    const t0 = performance.now();
    const steps = Math.floor(SECONDS / dt) - 1;
    const stepsDone = [];
    for (let k = 1; k <= steps; k++) {
      const tk = k * dt;
      ctx.suspend(tk).then(() => {
        try { script(tk); audio.update(dt, g); } catch (e) { stepsDone.push('ERR ' + e.message); }
        log.peakVoices = Math.max(log.peakVoices, audio.activeVoices);
        log.hrtf = Math.max(log.hrtf, audio.hrtfVoices);
        if (k % 10 === 0) log.voices.push(audio.activeVoices);
        ctx.resume();
      });
    }
    const buf = await ctx.startRendering();
    const wall = (performance.now() - t0) / 1000;
    const L = buf.getChannelData(0);
    const R = buf.getChannelData(1);
    let peak = 0, nan = 0, over = 0, sumsq = 0;
    const secs = [];
    for (let s = 0; s < SECONDS; s++) {
      let p = 0, q = 0;
      for (let i = s * sr; i < Math.min((s + 1) * sr, L.length); i++) {
        const a = L[i], b = R[i];
        if (!(a === a) || !(b === b)) { nan++; continue; }
        const m = Math.max(Math.abs(a), Math.abs(b));
        if (m > p) p = m;
        q += a * a + b * b;
        if (m > 0.99) over++;
      }
      sumsq += q;
      peak = Math.max(peak, p);
      secs.push({ s, peak: +p.toFixed(3), rms: +Math.sqrt(q / (2 * sr)).toFixed(4) });
    }
    return { seconds: SECONDS, wall, ratio: wall / SECONDS, peak, rms: Math.sqrt(sumsq / (2 * L.length)), nan, over, secs, log, state: audio.debugState(), errors: stepsDone };
  }, { SECONDS, REDUCED, BASELINE });
  await browser.close();
  server.close();
  const seg = (a, b) => { const x = result.secs.filter((e) => e.s >= a && e.s < b); return `peak ${Math.max(...x.map((e) => e.peak)).toFixed(3)} rms ${(Math.sqrt(x.reduce((s, e) => s + e.rms * e.rms, 0) / x.length)).toFixed(4)}`; };
  console.log(`offline render ${result.seconds}s${REDUCED ? ' (reduced tier)' : ''}${BASELINE ? ' (BASELINE: modules off)' : ''}: wall ${result.wall.toFixed(1)} s (${result.ratio.toFixed(2)}x realtime)`);
  console.log(`  overall peak ${result.peak.toFixed(3)} rms ${result.rms.toFixed(4)} NaN ${result.nan} samples>0.99: ${result.over}`);
  for (const [n, a, b] of [['0-6 calm S1 + steps', 0, 6], ['6-12 rope friction', 6, 12], ['12-16 jump/land/hurt/fall', 12, 16], ['16-30 hunt (clips, listen hush)', 16, 30], ['30-36 sighting/gate', 30, 36], ['36-60 sections 1-8', 36, 60], ['60-70 victory', 60, 70]]) if (a < result.seconds) console.log(`  ${n.padEnd(34)} ${seg(a, Math.min(b, result.seconds))}`);
  console.log(`  voices: peak ${result.log.peakVoices} (cap ${result.state.caps.voices}), HRTF peak ${result.log.hrtf}; modules broken: ${result.state.broken}; music notes ${result.state.music.notes}, ambient events ${result.state.ambience.events}`);
  const bad = errors.filter((e) => !/AudioContext was not allowed|autoplay/i.test(e));
  if (bad.length || result.errors.length) console.log('  console/errors:', bad.concat(result.errors).slice(0, 8));
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'out', BASELINE ? 'offline-baseline.json' : REDUCED ? 'offline-reduced.json' : 'offline.json'), JSON.stringify({ ...result, secs: result.secs }, null, 1));
  const fail = result.nan > 0 || result.over > 0 || bad.length > 0 || result.errors.length > 0 || result.state.broken > 0;
  console.log(fail ? 'FAIL' : 'PASS');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
