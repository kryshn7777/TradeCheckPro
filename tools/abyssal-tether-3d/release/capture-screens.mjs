#!/usr/bin/env node
/* ABYSSAL TETHER 3D: store screenshots and key-art renders from the REAL game (no mock-ups, nothing painted in).
 *   npm run capture:at3d-store [-- --only shots|vr|keyart] [--out docs/abyssal-tether-3d/store] [--scale 1]
 *
 * Headless Chromium (software WebGL) plays the real game through the debug API: it warps to a section, places the
 * player and the look direction, attaches real tethers to real anchors, lets the simulation run until the scene is
 * what the recipe wants (the creature in view, ropes taut, ...), freezes it and saves the canvas with the DOM UI
 * hidden. Re-run after the visuals change (fog, environment, creature, arms): the recipes follow the level data.
 *
 * Outputs (all PNG):
 *   screenshots/shot-01..10.png     1920 x 1080 desktop renders of the descent (no HUD, no text, VRC.Quest.Asset.5)
 *   screenshots/vr-01..03.png       1920 x 1080 single-eye crops of the mock headset view: gauntlets, tethers, lantern
 *   screenshots/hero-2880x1600.png  2880 x 1600 hero render
 *   keyart/*.png                    raw renders at each cover aspect ratio, input of tools/.../make-art.py
 * The stereo shots use the e2e mock WebXR with a 16:9-per-eye projection; they are what a Quest eye sees, rendered
 * on a desktop GPU-less Chromium, so no Quest-only post effects are in them (there are none).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, newPage, sleep, until, XR_MOCK_PATH } from './lib/browser.mjs';
import { createStaticServer } from './lib/server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const OUT = path.resolve(REPO, arg('--out', 'docs/abyssal-tether-3d/store'));
const ONLY = arg('--only', 'all');
const RECIPE = arg('--recipe', null); // capture a single desktop shot (a fresh process per shot keeps memory bounded)
const ROOT = path.resolve(arg('--root', path.join(REPO, 'public', 'abyssal-tether-3d')));
const SHOTS = path.join(OUT, 'screenshots');
const KEYART = path.join(OUT, 'keyart');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(KEYART, { recursive: true });

/**
 * A recipe: where the camera is and what the scene is doing.
 *   section  warp target (checkpoint of that section)
 *   at       optional [dx,dy,dz] offset from the checkpoint, or absolute [x,y,z] with abs:true
 *   yaw,pitch  look (radians; yaw 0 looks down -Z)
 *   ropes    attach the two nearest anchors (reach in metres) before stepping
 *   run      seconds of simulation to run before the capture (creature, fx, ropes settle)
 *   creature  step in 0.25 s chunks until the creature is within [min,max] m of the player (or give up)
 *   settings  settings applied before the scene (e.g. { bloodWriting: true }); every recipe starts from bloodWriting off
 *   url      extra query for the page (THE DRESSER's recipes: '&dresser=always'; the page otherwise runs ?hunt=always, which leaves
 *            the Dresser out)
 *   hang     an anchor id: the player hangs 3.5 m under that ring on the right-hand rope
 *   dresser  { dist, measure } THE DRESSER put on a wall about `dist` m away that sees the whole of you, facing you (debug
 *            dresser.place); measure: it starts measuring your ring (the chalk outline, the line); the look turns to its chest
 *            (lookMix 0..1 toward the outline instead)
 */
const RECIPES = [
  { id: 'shot-01', section: 0, yaw: 0.0, pitch: -0.05, run: 0.6, note: 'the threshold: the first view' },
  { id: 'shot-02', section: 0, at: [0, -3, -2], yaw: 0.25, pitch: -0.42, run: 0.5, note: 'looking down the shaft' },
  { id: 'shot-03', section: 1, yaw: -0.5, pitch: -0.12, ropes: 28, run: 1.6, note: 'a long swing, two tethers taut' },
  { id: 'shot-04', section: 2, yaw: 0.3, pitch: -0.1, run: 0.6, note: 'the broken gallery' },
  { id: 'shot-05', section: 3, yaw: 0.9, pitch: -0.05, run: 6, creature: [10, 120], note: 'the listening vault: something answered' },
  { id: 'shot-06', section: 4, yaw: 0.0, pitch: -0.1, ropes: 24, run: 2, creature: [8, 70], note: 'the gullet stair' },
  { id: 'shot-07', section: 5, yaw: -0.4, pitch: -0.2, run: 0.6, note: 'two descents' },
  { id: 'shot-08', section: 6, yaw: 0.2, pitch: -0.15, ropes: 30, run: 1.5, note: 'the hollow nave: nothing to stand on' },
  { id: 'shot-09', section: 7, yaw: 0.4, pitch: -0.1, run: 0.6, note: 'the last throat' },
  { id: 'shot-low', section: 3, yaw: 0.2, pitch: -0.1, run: 3.4, hp: 0.2, note: 'low health: the scary line (not a store shot; --recipe shot-low only)', only: true },
  { id: 'shot-10', section: 2, at: [0, -6, 3], yaw: -0.8, pitch: 0.1, run: 0.6, note: 'looking back up the shaft' },
  // Settings › Display › Blood writing (opt-in): Hob's writing in the Long Stair's rest, under its lamp (bw-s6-hob)
  { id: 'shot-blood', section: 5, at: [-31.5, -241.6, -8.6], abs: true, yaw: 0, pitch: -0.06, run: 0.6, settings: { bloodWriting: true }, note: 'blood writing (not a store shot; --recipe shot-blood only)', only: true },
  // THE DRESSER (docs/abyssal-tether-3d/plans/DRESSER.md): on a wall of the Two Descents at ~12 m; the chalk outline of you while it
  // measures your ring; the chalk line it puts in your head while it hunts you (not store shots; --recipe <id> only)
  { id: 'shot-dresser', section: 5, url: '&dresser=always', yaw: 0, pitch: 0, run: 0.8, dresser: { dist: 12 }, note: 'the Dresser on a wall at ~12 m', only: true },
  { id: 'shot-dresser-measure', section: 5, url: '&dresser=always', hang: 's6-sa2', yaw: 0, pitch: 0, run: 2.2, dresser: { dist: 11, measure: true }, lookMix: 0.85, note: 'measuring: the chalk outline of you', only: true },
  { id: 'shot-chalk', section: 5, url: '&dresser=always', hang: 's6-sa2', yaw: 0, pitch: 0, run: 2.6, dresser: { dist: 11, measure: true }, note: 'the chalk line while it measures you', only: true },
];
const KEYART_RECIPES = [{ id: 'vista-a', section: 6, yaw: 0.2, pitch: -0.18, ropes: 30, run: 1.5 }];
// rendered at the final cover sizes (make-art.py crops / resizes from these)
const KEYART_SIZES = [
  ['16x9', 2560, 1440],
  ['hero', 3000, 900],
  ['square', 1440, 1440],
  ['portrait', 1008, 1440],
];

const srv = await createStaticServer({ root: ROOT, prefix: '/', prodHeaders: false }).start();
const browser = await launch();

async function newGamePage(w, h, { xr = false, extra = '' } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  const page = await newPage(ctx, { viewport: { width: w, height: h }, xr: false });
  page.on('crash', () => {
    console.error('PAGE CRASHED (out of memory?): lower the viewport or free memory, then re-run');
    process.exit(2);
  });
  if (xr) {
    await page.addInitScript({ path: XR_MOCK_PATH });
    await page.addInitScript(wideProjection, { fovY: 78 });
  }
  await page.addInitScript(() => {
    const css = document.createElement('style');
    css.textContent = '#ui-root,.at3d-ui,#boot,#at-fatal,#at3d-gpu-banner,[id^=at3d-panel]{display:none!important}';
    document.addEventListener('DOMContentLoaded', () => document.head.appendChild(css));
  });
  await page.goto(srv.base + '?sw=0&gov=off&perfdiag=off&watchdog=off&hunt=always' + extra, { waitUntil: 'domcontentloaded' });
  await until(() => page.evaluate(() => !!(window.AT3D && window.AT3D.game && window.AT3D.game.booted)), { timeout: 240000, label: 'boot' });
  await sleep(2500); // textures, env kit, creature kit, gear GLB finish loading
  return { ctx, page };
}

/** Runs inside the page (init script): makes the mock headset's per-eye projection match the viewport aspect. */
function wideProjection({ fovY }) {
  const patch = () => {
    const xr = navigator.xr;
    if (!xr || xr.__wide) return;
    xr.__wide = true;
    const orig = xr.requestSession.bind(xr);
    xr.requestSession = async (mode, init) => {
      const session = await orig(mode, init);
      const raf = session.requestAnimationFrame.bind(session);
      session.requestAnimationFrame = (cb) =>
        raf((t, frame) => {
          const gp = frame.getViewerPose.bind(frame);
          frame.getViewerPose = (rs) => {
            const pose = gp(rs);
            const layer = session.renderState.baseLayer;
            const eyeAspect = layer ? layer.framebufferWidth / 2 / layer.framebufferHeight : 16 / 9;
            const f = 1 / Math.tan((fovY * Math.PI) / 360);
            const near = 0.05;
            const far = 400;
            const nf = 1 / (near - far);
            const m = new Float32Array([f / eyeAspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]);
            for (const v of pose.views) v.projectionMatrix = m;
            return pose;
          };
          cb(t, frame);
        });
      return session;
    };
  };
  patch();
}

/** Places the game per recipe and leaves it frozen with a clean frame ready to capture. */
async function setScene(page, r) {
  return page.evaluate(async (rec) => {
    const G = window.AT3D.game;
    const D = window.AT3D.debug;
    D.freeze(false);
    G.start('normal');
    D.godMode(true);
    G.applySettings(Object.assign({ bloodWriting: false }, rec.settings || {}));
    D.warp(rec.section);
    const p = G.player;
    if (rec.at) {
      const [dx, dy, dz] = rec.at;
      if (rec.abs) D.teleport(dx, dy, dz);
      else D.teleport(p.x + dx, p.y + dy, p.z + dz);
    }
    G.fade = 0;
    G.flash = 0;
    G._setLook(rec.yaw, rec.pitch);
    D.step(0.4, { render: false, state: false });
    if (rec.hang) {
      const a = G.level.anchors.find((x) => x.id === rec.hang);
      if (a) {
        D.teleport(a.x, a.y - 3.5, a.z);
        D.attach('right', a.id);
        D.step(1.5, { render: false, state: false });
      }
    }
    if (rec.dresser && D.dresser) {
      // the wall spot nearest the wanted distance from which it sees the whole of you
      const dr = G.dresser;
      let best = null;
      for (let k = 0; k < 64 * 3 && dr && !dr.isNull; k++) {
        const az = ((k % 64) / 64) * Math.PI * 2;
        const dy = [1.5, 5, -3][Math.floor(k / 64)];
        const r = D.dresser.place({ az, dy });
        if (!r) continue;
        dr._measureDist(p);
        // a three-quarter view of it (not straight down its length): the angle between its up and the line to you
        const vx = p.x - (r.x + r.nx * 2);
        const vy = p.y - (r.y + r.ny * 2);
        const vz = p.z - (r.z + r.nz * 2);
        const cosA = (vx * r.nx + vy * r.ny + vz * r.nz) / (Math.hypot(vx, vy, vz) || 1);
        const sc = -Math.abs(dr.distance - rec.dresser.dist) + (dr._seesWhole(p) ? 10 : 0) - Math.max(0, cosA - 0.6) * 12;
        if (!best || sc > best.sc) best = { az, dy, sc };
      }
      if (best) D.dresser.place({ az: best.az, dy: best.dy });
      if (rec.dresser.measure) D.dresser.measure();
    }
    if (rec.ropes) {
      const out = G.level.anchorsNear(p.x, p.y + 4, p.z, rec.ropes, []);
      out.sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y, a.z - p.z) - Math.hypot(b.x - p.x, b.y - p.y, b.z - p.z));
      if (out[0]) D.attach('right', out[0].id);
      if (out[1]) D.attach('left', out[1].id);
    }
    let left = rec.run;
    let seen = false;
    while (left > 0) {
      if (rec.hp != null) D.health(rec.hp); // low health: the scary line, the heartbeat vignette
      D.step(0.25, { render: false, state: false });
      left -= 0.25;
      if (rec.creature && G.creature && !G.creature.isNull) {
        const d = G.creature.distance;
        if (d >= rec.creature[0] && d <= rec.creature[1]) {
          seen = true;
          if (left < 3) break;
        }
      }
    }
    G.fade = 0;
    G.flash = 0;
    G._setLook(rec.yaw, rec.pitch);
    const dbody = rec.dresser && G.dresser && !G.dresser.isNull ? G.dresser.body : null;
    if (dbody && dbody.visible) {
      // look at its chest (or, lookMix, toward the chalk outline beside you)
      let tx = dbody.x + dbody.ux * 1.9;
      let ty = dbody.y + dbody.uy * 1.9;
      let tz = dbody.z + dbody.uz * 1.9;
      const mix = rec.lookMix || 0;
      if (mix > 0 && dbody.outline.on) {
        tx += (dbody.outline.x - tx) * mix;
        ty += (dbody.outline.y + 0.3 - ty) * mix;
        tz += (dbody.outline.z - tz) * mix;
      }
      const ex = p.x;
      const ey = p.y + 1.24;
      const ez = p.z;
      G._setLook(Math.atan2(-(tx - ex), -(tz - ez)), Math.atan2(ty - ey, Math.hypot(tx - ex, tz - ez)));
    }
    D.step(0.05, { render: true, state: false });
    G.fade = 0;
    D.freeze(true);
    return { creature: rec.creature ? { seen, distance: G.creature && G.creature.distance } : null, state: G.state, y: Math.round(p.y) };
  }, r);
}

async function snap(page, file, w, h, { grab = false } = {}) {
  await sleep(700); // a few frozen frames so fx and the lantern settle
  if (grab) {
    // desktop: read the canvas in the same task as a render (a WebGL canvas without preserveDrawingBuffer can show
    // black to a page screenshot taken between frames)
    const b64 = await page.evaluate(() => {
      const G = window.AT3D.game;
      G.fade = 0;
      G.flash = 0;
      G._render(1 / 60);
      const c = G.renderer.renderer.domElement;
      if (c.width !== window.innerWidth) throw new Error(`canvas is ${c.width}x${c.height}, expected ${window.innerWidth}x${window.innerHeight}`);
      return c.toDataURL('image/png').split(',')[1];
    });
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
  } else {
    await page.evaluate(() => {
      const G = window.AT3D.game;
      G.fade = 0;
      G.flash = 0;
    });
    await sleep(300);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: w, height: h }, timeout: 600000 }); // software GL: a frame can take minutes at this size
  }
  console.log(`  ${path.relative(REPO, file)}  ${w}x${h}`);
}

try {
  if (ONLY === 'all' || ONLY === 'shots') {
    console.log('desktop screenshots 1920x1080');
    const list = RECIPES.filter((x) => (RECIPE ? x.id === RECIPE : !x.only));
    const { ctx, page } = await newGamePage(1920, 1080, { extra: RECIPE && list[0] && list[0].url ? list[0].url : '' });
    for (const r of list) {
      const info = await setScene(page, r);
      if (info.state !== 'playing') console.log('   note: state', info.state);
      await snap(page, path.join(SHOTS, `${r.id}.png`), 1920, 1080, { grab: true });
    }
    await ctx.close();
  }
  if (ONLY === 'all' || ONLY === 'hero') {
    console.log('hero 2880x1600');
    const hero = await newGamePage(2880, 1600);
    await setScene(hero.page, { section: 6, yaw: 0.2, pitch: -0.16, ropes: 30, run: 1.5 });
    await snap(hero.page, path.join(SHOTS, 'hero-2880x1600.png'), 2880, 1600, { grab: true });
    await hero.ctx.close();
  }
  if (ONLY === 'all' || ONLY === 'vr') {
    console.log('mock-headset eye crops 1920x1080 (stereo canvas 3840x1080)');
    const { ctx, page } = await newGamePage(3840, 1080, { xr: true });
    await page.evaluate(() => window.AT3D.game.enterVR());
    await until(() => page.evaluate(() => window.AT3D.game.xrActive), { timeout: 30000, label: 'XR' });
    await sleep(2000);
    const VR = [
      { id: 'vr-01', section: 0, yaw: 0, pitch: 0, run: 0.6, head: { x: 0, y: 1.62, z: 0, yaw: 0 }, ctrl: { left: [-0.22, 1.2, -0.4], right: [0.22, 1.2, -0.4] } },
      { id: 'vr-02', section: 1, yaw: -0.5, pitch: 0, ropes: 28, run: 1.6, head: { x: 0, y: 1.62, z: 0, yaw: 0 }, ctrl: { left: [-0.3, 1.45, -0.45], right: [0.3, 1.5, -0.5] } },
      { id: 'vr-03', section: 4, yaw: 0, pitch: 0, ropes: 24, run: 2, creature: [8, 70], head: { x: 0, y: 1.62, z: 0, yaw: 0 }, ctrl: { left: [-0.25, 1.1, -0.35], right: [0.3, 1.5, -0.5] } },
    ];
    for (const r of VR) {
      await page.evaluate((v) => {
        const X = window.__xr;
        Object.assign(X.head, v.head);
        for (const h of ['left', 'right']) {
          X.ctrl[h].x = v.ctrl[h][0];
          X.ctrl[h].y = v.ctrl[h][1];
          X.ctrl[h].z = v.ctrl[h][2];
          X.ctrl[h].pitch = -0.5;
          X.ctrl[h].yaw = 0;
        }
      }, r);
      const info = await setScene(page, r);
      await sleep(400);
      void info;
      await snap(page, path.join(SHOTS, `${r.id}.png`), 1920, 1080, { grab: true });
    }
    await ctx.close();
  }
  if (ONLY === 'keyart') {
    for (const [name, w, h] of KEYART_SIZES) {
      console.log(`key art renders ${name} ${w}x${h}`);
      const { ctx, page } = await newGamePage(w, h);
      for (const r of KEYART_RECIPES) {
        await setScene(page, r);
        await snap(page, path.join(KEYART, `${r.id}-${name}.png`), w, h);
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close().catch(() => {});
  await srv.stop();
}
console.log('done');
