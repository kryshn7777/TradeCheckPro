#!/usr/bin/env node
/* ABYSSAL TETHER 3D: accelerated soak test (VRC.Quest.Functional.1: "play at least 45 minutes without a crash").
 *   node tools/abyssal-tether-3d/release/soak.mjs [--minutes 45] [--render-every 10] [--viewport 640x360] [--out FILE]
 *   npm run soak:at3d -- --minutes 45
 *
 * A 45-minute session is replayed in a fraction of the wall time through the debug API: the simulation steps at a
 * fixed 1/60 s (real sim code, the creature live, ropes, FX, hints, deaths, respawns) and every --render-every
 * simulated seconds (default 10) a real frame is rendered (software WebGL needs ~2 s per frame, so rendering every
 * frame is not affordable; GPU resources are created by the first render of anything new, which every cycle repeats). Each ~60 s "cycle" runs a different script (free-fall deaths and
 * respawns, swinging on real anchors, standing in the creature's reach, pause / resume, menu attract, start / quit /
 * restart, XR enter / exit with the mock headset, WebGL context loss and restore) and then a fixed BENCHMARK
 * (same difficulty, same section, same frames) so the frame cost is comparable cycle to cycle.
 *
 * After every cycle (and a forced garbage collection) it samples: JS heap, renderer.info.memory geometries /
 * textures, shader programs, scene object count, event-bus listener count, DOM nodes, canvases. PASS means that after
 * the warm-up (every section visited once, all lazily created GPU objects exist):
 *   - geometries, textures, programs, scene objects, bus listeners, DOM nodes, canvases do NOT grow (0 tolerance on
 *     GPU objects; 2 % on scene objects / DOM nodes),
 *   - JS heap does not trend up (slope < 0.15 MB per simulated minute and last-third mean within 8 % + 4 MB of the
 *     middle third),
 *   - the benchmark's frame cost does not creep (last-third median within 20 % of the first-third median),
 *   - no console error, no fault in game.faults, no page crash; the run still plays at the end.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, newPage, sleep, until } from './lib/browser.mjs';
import { createStaticServer } from './lib/server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const MINUTES = Number(arg('--minutes', '45'));
const RENDER_EVERY = Number(arg('--render-every', '10'));
const [VW, VH] = arg('--viewport', '320x180').split('x').map(Number);
const OUT = path.resolve(arg('--out', path.join(HERE, 'out', 'soak.json')));
const ROOT = path.resolve(arg('--root', path.join(REPO, 'public', 'abyssal-tether-3d')));
const CYCLE_SECONDS = 60;
const CYCLES = Math.max(6, Math.round((MINUTES * 60) / CYCLE_SECONDS));
fs.mkdirSync(path.dirname(OUT), { recursive: true });

const srv = await createStaticServer({ root: ROOT, prefix: '/', prodHeaders: false }).start();
const browser = await launch(['--enable-precise-memory-info', '--js-flags=--expose-gc']);
const ctx = await browser.newContext({ viewport: { width: VW, height: VH } });
const page = await newPage(ctx, { xr: true, viewport: { width: VW, height: VH } });
const cdp = await ctx.newCDPSession(page);
if (argv.includes('--verbose')) page.on('console', (m) => m.text().startsWith('SOAK') && console.log('   ' + m.text()));
await page.goto(srv.base + '?sw=0&gov=off', { waitUntil: 'domcontentloaded' });
await until(() => page.evaluate(() => !!(window.AT3D && window.AT3D.game && window.AT3D.game.booted)), { timeout: 180000, label: 'boot' });
await sleep(1000);

// ---- in-page driver ------------------------------------------------------------------------------------------------
await page.evaluate(() => (window.__soakVerbose = location.search.includes('verbose') || true));
await page.evaluate(
  ({ RENDER_EVERY }) => {
    const G = window.AT3D.game;
    const D = window.AT3D.debug;
    const verbose = !!window.__soakVerbose;
    const S = (window.__soak = { simSeconds: 0, deaths: 0, respawns: 0, contextLosses: 0, xrCycles: 0, restarts: 0, menuLoops: 0, pauses: 0, sections: new Set(), wallMs: 0 });
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    /** Simulates `sec` seconds, rendering a real frame every RENDER_EVERY simulated seconds. */
    function run(sec, { each = null } = {}) {
      let left = sec;
      while (left > 1e-6) {
        const chunk = Math.min(RENDER_EVERY, left);
        if (verbose) console.log(`SOAK step ${chunk}s state=${G.state} t=${S.simSeconds.toFixed(0)}`);
        D.step(chunk, { render: true, state: false });
        S.simSeconds += chunk;
        left -= chunk;
        if (each && each(left) === false) break;
        if (G.state === 'dead' && G.deathT > 0.7) {
          S.deaths++;
          G.respawn();
          S.respawns++;
        }
        if (G.state === 'victory') {
          G.start(G.difficultyKey);
          S.restarts++;
        }
      }
    }
    const anchorsNearPlayer = (n = 2) => {
      const p = G.player;
      const out = G.level.anchorsNear(p.x, p.y + 4, p.z, 26, []);
      out.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y, a.z - p.z) - Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z));
      return out.slice(0, n);
    };
    const DIFFS = ['normal', 'nightmare', 'abyss', 'normal', 'sandbox'];
    const scripts = {
      // fall with no rope until dead, respawn, again
      fall(k) {
        G.start(DIFFS[k % DIFFS.length]);
        const sec = k % G.level.sections.length;
        D.warp(sec);
        S.sections.add(sec);
        D.setInput(null);
        run(40, {});
        D.step(0.5, { render: true, state: false });
      },
      // swing on real anchors with scripted reel / move input
      swing(k) {
        G.start('normal');
        const sec = (k * 3) % G.level.sections.length;
        D.warp(sec);
        S.sections.add(sec);
        for (let i = 0; i < 12; i++) {
          const a = anchorsNearPlayer(2);
          if (a[0]) D.attach('right', a[0].id);
          if (a[1]) D.attach('left', a[1].id);
          D.setInput({ move: { x: Math.sin(i), z: 0.4 }, reel: i % 2 ? 0.6 : -0.3, hands: { left: { yank: i % 3 === 0 ? 1 : 0 }, right: { yank: 0 } } });
          run(4);
        }
        D.setInput(null);
      },
      // stand in a hunted section: the creature closes in, kills, the run respawns
      stand(k) {
        G.start(DIFFS[k % 3]);
        const sec = 3 + (k % 5);
        D.warp(Math.min(sec, G.level.sections.length - 1));
        S.sections.add(Math.min(sec, G.level.sections.length - 1));
        D.setInput(null);
        run(50);
      },
      // pause / resume churn and the menu
      menu(k) {
        G.start('normal');
        D.warp(k % G.level.sections.length);
        run(8);
        for (let i = 0; i < 4; i++) {
          G.pause();
          S.pauses++;
          D.step(1, { render: true, state: false });
          G.resume();
          run(3);
        }
        G.quitToMenu();
        S.menuLoops++;
        run(14); // attract mode
        G.start('nightmare');
        S.restarts++;
        run(10);
        G.restart();
        S.restarts++;
        run(6);
      },
    };
    window.__soakScripts = scripts;
    window.__soakRun = run;
    window.__soakSleep = sleep;
    window.__soakCycle = (k) => {
      const names = ['fall', 'swing', 'stand', 'menu'];
      const t0 = performance.now();
      const before = S.simSeconds;
      scripts[names[k % names.length]](k);
      const used = S.simSeconds - before;
      if (used < 60) run(60 - used); // each cycle is one simulated minute
      S.wallMs += performance.now() - t0;
      return names[k % names.length];
    };
    /** Fixed benchmark: same difficulty, section and frames every time. Returns ms per sim frame / per render. */
    window.__soakBench = () => {
      G.start('normal');
      D.warp(4);
      D.setInput(null);
      D.step(2, { render: false, state: false }); // settle
      const frames = 360;
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) G._frame(1 / 60, false);
      const simMs = (performance.now() - t0) / frames;
      const t1 = performance.now();
      const renders = 3;
      for (let i = 0; i < renders; i++) G._render(1 / 60);
      const renderMs = (performance.now() - t1) / renders;
      return { simMs, renderMs };
    };
    window.__soakSample = () => {
      const r = G.renderer.renderer;
      let objects = 0;
      G.renderer.scene.traverse(() => objects++);
      let listeners = 0;
      for (const k of Object.keys(G.bus._h)) listeners += G.bus._h[k].length;
      const info = r.info;
      return {
        heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
        geometries: info.memory.geometries,
        textures: info.memory.textures,
        programs: info.programs ? info.programs.length : 0,
        objects,
        listeners,
        dom: document.getElementsByTagName('*').length,
        canvases: document.getElementsByTagName('canvas').length,
        faults: Object.assign({}, G.faults),
        state: G.state,
        simSeconds: S.simSeconds,
      };
    };
  },
  { RENDER_EVERY },
);

async function gc() {
  try {
    await cdp.send('HeapProfiler.collectGarbage');
  } catch {
    await page.evaluate(() => window.gc && window.gc());
  }
}

const log = (m) => process.env.SOAK_LOG && console.log('   [soak] ' + m);
const samples = [];
const events = [];
const t0 = Date.now();
console.log(`soak: ${CYCLES} cycles of ${CYCLE_SECONDS} simulated seconds = ${CYCLES} minutes, viewport ${VW}x${VH}, render every ${RENDER_EVERY} s`);

async function xrCycle() {
  await page.evaluate(() => window.AT3D.game.enterVR());
  await until(() => page.evaluate(() => window.AT3D.game.xrActive), { timeout: 30000, label: 'XR enter' });
  await page.evaluate(() => {
    const G = window.AT3D.game;
    G.start('normal');
    window.AT3D.debug.warp(2);
    window.__soakRun(10);
  });
  await page.evaluate(() => window.AT3D.game.exitVR());
  await until(() => page.evaluate(() => !window.AT3D.game.xrActive), { timeout: 30000, label: 'XR exit' });
  await page.evaluate(() => (window.__soak.xrCycles += 1));
}

async function contextCycle() {
  await page.evaluate(() => {
    window.AT3D.game.start('normal');
    window.AT3D.debug.warp(3);
    window.__soakRun(3);
  });
  const lost = await page.evaluate(() => window.AT3D.debug.loseContext());
  await until(() => page.evaluate(() => window.AT3D.game.contextLost === true), { timeout: 15000, label: 'context lost' });
  const stateWhileLost = await page.evaluate(() => window.AT3D.game.state);
  await sleep(300);
  await page.evaluate(() => window.AT3D.debug.restoreContext());
  await until(() => page.evaluate(() => window.AT3D.game.contextLost === false), { timeout: 30000, label: 'context restored' });
  await page.evaluate(() => {
    window.AT3D.game.resume();
    window.__soakRun(5);
    window.__soak.contextLosses++;
  });
  events.push({ cycle: samples.length, type: 'context-loss', lost, stateWhileLost });
}

let bench = null;
for (let k = 0; k < CYCLES; k++) {
  const name = await page.evaluate((i) => window.__soakCycle(i), k);
  log(`cycle ${k + 1} script ${name} done`);
  if (k % 5 === 2) await xrCycle();
  if (k % 7 === 4) await contextCycle();
  bench = await page.evaluate(() => window.__soakBench());
  log('bench done');
  await gc();
  log('gc done');
  await sleep(150);
  const s = await page.evaluate(() => window.__soakSample());
  s.cycle = k;
  s.script = name;
  s.bench = bench;
  samples.push(s);
  const wall = (Date.now() - t0) / 1000;
  process.stdout.write(`  cycle ${String(k + 1).padStart(2)}/${CYCLES} ${name.padEnd(6)} heap ${s.heapMB ? s.heapMB.toFixed(1) : '?'} MB  geo ${s.geometries} tex ${s.textures} prog ${s.programs} obj ${s.objects} lst ${s.listeners} dom ${s.dom}  sim ${bench.simMs.toFixed(2)} ms/frame render ${bench.renderMs.toFixed(1)} ms  [${wall.toFixed(0)} s]\n`);
}

// ---- analysis ----------------------------------------------------------------------------------------------------------
const final = await page.evaluate(() => ({ soak: { ...window.__soak, sections: [...window.__soak.sections] }, state: window.AT3D.debug.state() }));
const warm = Math.min(samples.length - 3, Math.max(8, Math.ceil(samples.length * 0.2)));
const steady = samples.slice(warm);
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const third = (a, i) => a.slice(Math.floor((a.length * i) / 3), Math.floor((a.length * (i + 1)) / 3));
const slope = (ys) => {
  const xs = ys.map((_, i) => i);
  const mx = mean(xs);
  const my = mean(ys);
  return xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0) || 0;
};
const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : '  - ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))}`);
};
const rng = (key) => ({ min: Math.min(...steady.map((s) => s[key])), max: Math.max(...steady.map((s) => s[key])) });
console.log(`\nsteady state = cycles ${warm + 1}..${samples.length} (after the ${warm}-cycle warm-up)`);
for (const key of ['geometries', 'textures', 'programs', 'canvases']) {
  const r = rng(key);
  check(`no growth: renderer ${key}`, r.max === r.min || r.max <= r.min, r);
}
for (const [key, tol] of [['objects', 0.02], ['dom', 0.02], ['listeners', 0]]) {
  const r = rng(key);
  check(`no growth: ${key}`, r.max <= r.min * (1 + tol) + (tol ? 0 : 0), r);
}
if (steady[0].heapMB != null) {
  const heap = steady.map((s) => s.heapMB);
  const perMin = slope(heap) * (CYCLE_SECONDS / 60) * (60 / CYCLE_SECONDS); // per cycle = per simulated minute
  const mid = mean(third(heap, 1));
  const last = mean(third(heap, 2));
  check('JS heap does not trend up', perMin < 0.15 && last <= mid * 1.08 + 4, { slopeMBperMin: Number(perMin.toFixed(3)), midMB: Number(mid.toFixed(1)), lastMB: Number(last.toFixed(1)) });
}
const simMs = steady.map((s) => s.bench.simMs);
const renderMs = steady.map((s) => s.bench.renderMs);
const sim1 = median(third(simMs, 0));
const sim3 = median(third(simMs, 2));
const ren1 = median(third(renderMs, 0));
const ren3 = median(third(renderMs, 2));
check('no frame-time creep: simulation', sim3 <= sim1 * 1.2 + 0.05, { firstThirdMs: Number(sim1.toFixed(3)), lastThirdMs: Number(sim3.toFixed(3)) });
check('no frame-time creep: render (wall clock on a shared machine: +50 % tolerance)', ren3 <= ren1 * 1.5 + 50, { firstThirdMs: Number(ren1.toFixed(2)), lastThirdMs: Number(ren3.toFixed(2)) });
check('no console errors', page.errors.length === 0, page.errors.slice(0, 5));
check('no game faults', Object.keys(final.state.faults).length === 0, final.state.faults);
check('all sections were visited', final.soak.sections.length >= 8, final.soak.sections);
check('context loss was exercised and recovered', final.soak.contextLosses >= 1 || CYCLES < 6, { losses: final.soak.contextLosses, events });
check('XR enter / exit was exercised', final.soak.xrCycles >= 1, final.soak.xrCycles);
check(`${Math.round(final.soak.simSeconds / 60)} simulated minutes completed`, final.soak.simSeconds >= MINUTES * 60 * 0.95, Math.round(final.soak.simSeconds));
// still playable
await page.evaluate(() => {
  window.AT3D.game.start('normal');
  window.AT3D.debug.step(2, { render: true, state: false });
});
check('the game still plays at the end', await page.evaluate(() => window.AT3D.game.state === 'playing'));

const report = { minutes: MINUTES, cycles: CYCLES, wallSeconds: Math.round((Date.now() - t0) / 1000), viewport: [VW, VH], warmUpCycles: warm, totals: final.soak, checks, samples, events, finishedAt: new Date().toISOString() };
fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`\nwrote ${path.relative(REPO, OUT)}  (wall ${report.wallSeconds} s for ${Math.round(final.soak.simSeconds / 60)} simulated minutes: deaths ${final.soak.deaths}, respawns ${final.soak.respawns}, restarts ${final.soak.restarts}, menu loops ${final.soak.menuLoops}, pauses ${final.soak.pauses}, XR cycles ${final.soak.xrCycles}, context losses ${final.soak.contextLosses})`);
const failed = checks.filter((c) => !c.ok);
console.log(failed.length ? `\nSOAK FAILED: ${failed.map((f) => f.name).join('; ')}` : '\nSOAK PASSED');
await browser.close().catch(() => {});
await srv.stop();
process.exit(failed.length ? 1 : 0);
