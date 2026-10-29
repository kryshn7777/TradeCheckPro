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
 *   frames   pumps the boards' and the blood's lazy atlases this many frames before the capture (they draw a cell per frame)
 *   url      extra query for the page (THE DRESSER's recipes: '&dresser=always'; the page otherwise runs ?hunt=always, which leaves
 *            the Dresser out, and &comms=off, which leaves the Expedition radio / restore out: a recipe with '&comms=on' keeps them)
 *   comms    EXPEDITION (sim/comms3d.js): { say, glitch, at, dur, t } puts a script line on air (a glitch of that kind at `at` s)
 *            and runs `t` s into it; { die, count, t } ends this life (cause `die`) as restore `count` and runs `t` s into the
 *            CONTINUITY overlay
 *   fade     the head fade kept for the capture (0 otherwise; the restore overlay is drawn over the death fade)
 *   hang     an anchor id: the player hangs 3.5 m under that ring on the right-hand rope
 *   dresser  { dist, measure, orbit } THE DRESSER put on a wall about `dist` m away that sees the whole of you, facing you (debug
 *            dresser.place); measure: it starts measuring your ring (the chalk outline, the line); orbit (m): at the end the camera
 *            moves that far from its chest, 50-70 degrees off its up, into open air; the look turns to its chest (lookMix 0..1
 *            toward the outline instead)
 *   holdfast { site, state, dist, dy, target: [u, v, n], onT } THE HOLDFAST (sim/holdfast3d.js): the body `dist` m out from a site's
 *            patch (dy above its centre) and held there, the site forced into `state` (DORMANT, AWARE, GRIP, CLOSE, RUINED,
 *            ANSWER) with its palm going to `target` (metres in the site frame: along the wall, up, out of it); the look turns to it
 *            (url '&holdfast=on': the page runs ?hunt=always, which leaves it out). `--only holdfast` renders the mock-headset
 *            shot of it closed round the real gauntlet (vr-holdfast-closed)
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
  // DARK_STORY_BIBLE (not store shots; --recipe <id> only): a board with its correction (bd-s8-fed, the first step's ledge), a
  // second-pass blood writing by the Long Stair's second shelf (bw-s6-white, with the fresh measure beside it), and the chamber's
  // back wall (the figure cut to your measure, IT FITS NOW) from between the statues
  { id: 'shot-board', section: 7, at: [0.4, -469.6, 17.6], abs: true, yaw: Math.PI, pitch: 0.34, run: 0.4, frames: 20, note: 'a board: ~WE FED IT.~ NO. WE WERE FED.', only: true },
  { id: 'shot-blood2', section: 5, at: [-31.4, -229.6, 8.2], abs: true, yaw: Math.PI / 2, pitch: 0.22, run: 0.4, frames: 20, settings: { bloodWriting: true }, note: 'second-pass blood: THE WHITE ONE WAITS...', only: true },
  { id: 'shot-chamber', section: 7, at: [-3.2, -555.6, 20.6], abs: true, yaw: Math.PI, pitch: 0.26, run: 0.3, frames: 20, settings: { bloodWriting: true }, note: 'the chamber: the figure and IT FITS NOW', only: true },
  { id: 'shot-figure', section: 7, at: [-3.7, -555.6, 23.9], abs: true, yaw: Math.PI - 0.32, pitch: 0.12, run: 0.3, frames: 20, note: 'the chamber: the figure cut to your measure, close', only: true },
  // THE DRESSER (docs/abyssal-tether-3d/plans/DRESSER.md): on a wall of the Two Descents at ~12 m; the chalk outline of you while it
  // measures your ring; the chalk line it puts in your head while it hunts you (not store shots; --recipe <id> only)
  { id: 'shot-dresser', section: 5, url: '&dresser=always', yaw: 0, pitch: 0, run: 0.8, dresser: { dist: 12, orbit: 12 }, note: 'the Dresser on a wall at ~12 m (a three-quarter view from the shaft)', only: true },
  { id: 'shot-dresser-measure', section: 5, url: '&dresser=always', hang: 's6-sa2', yaw: 0, pitch: 0, run: 2.2, dresser: { dist: 11, measure: true }, lookMix: 0.85, note: 'measuring: the chalk outline of you', only: true },
  { id: 'shot-chalk', section: 5, url: '&dresser=always', hang: 's6-sa2', yaw: 0, pitch: 0, run: 2.6, dresser: { dist: 11, measure: true }, note: 'the chalk line while it measures you', only: true },
  // THE HOLDFAST (docs/abyssal-tether-3d/plans/CREATURE_PACING.md): the S2 patch as you climb to it (dormant: the studs are knuckles),
  // reaching for your hand, torn out (not store shots; --recipe <id> only; the mock-headset shots: --only holdfast)
  { id: 'shot-holdfast-dormant', section: 1, url: '&holdfast=on', yaw: 0, pitch: 0, run: 0.6, holdfast: { site: 'hf-s2-east', state: 'DORMANT', dist: 1.0, dy: -0.6 }, note: 'the patch: no chalk, wet knuckles in torn masonry', only: true },
  { id: 'shot-holdfast-reach', section: 1, url: '&holdfast=on', yaw: 0, pitch: 0, run: 1.0, holdfast: { site: 'hf-s2-east', state: 'GRIP', onT: 0.45, dist: 0.85, dy: -0.5, target: [0.05, 0.08, 0.12] }, note: 'it opens toward your hand', only: true },
  { id: 'shot-holdfast-ruined', section: 1, url: '&holdfast=on', yaw: 0, pitch: 0, run: 1.4, holdfast: { site: 'hf-s2-east', state: 'RUINED', dist: 0.9, dy: -0.55 }, note: 'torn out of the wall, the fingers broken', only: true },
  // MESH_DETAIL_AND_OPTIMIZATION (props v2) close-ups, not store shots (--recipe <id>; '&props=0&propshi=0' in the url shows the old meshes):
  // the Threshold's Lanternwright statue from 4 m, a giant chain at arm's length, a seeded scene-detail ledge (seed 7) at the feet
  { id: 'prop-statue', section: 0, url: '&seed=7', at: [-1.3, 0.4, 6.6], abs: true, yaw: -2.37, pitch: 0.38, run: 0.4, note: 'props v2: the Lanternwright statue (S1)', only: true },
  { id: 'prop-chain', section: 0, url: '&seed=7', at: [0.6, 0.4, -1], abs: true, yaw: 1.57, pitch: 0.05, run: 0.4, note: 'props v2: a giant chain at arm\'s length (S1)', only: true },
  { id: 'prop-ledge', section: 4, url: '&seed=7', yaw: 0.6, pitch: -0.55, run: 0.4, note: 'props v2: scene-detail props on the S5 ledge (seed 7)', only: true },
  // EXPEDITION (docs/abyssal-tether-3d/plans/COMMS.md): the radio subtitle at the Threshold, a glitched line in the Last Throat, the
  // CONTINUITY restore (not store shots; --recipe <id> only)
  { id: 'shot-comms', section: 0, url: '&comms=on', yaw: 0.0, pitch: -0.05, run: 0.6, comms: { say: 's1-open-3', t: 1.6 }, note: 'a radio line at the Threshold', only: true },
  { id: 'shot-comms-deep', section: 7, url: '&comms=on', yaw: 0.4, pitch: -0.1, run: 0.6, comms: { say: 's8-enter', glitch: 'static', at: 1.4, dur: 0.6, t: 1.6 }, note: 'a glitched line deep down (one bar)', only: true },
  { id: 'shot-restore', section: 4, url: '&comms=on', yaw: 0.0, pitch: -0.1, run: 0.6, comms: { die: 'creature', count: 3, t: 4.9 }, fade: 0.9, note: 'the CONTINUITY restore overlay', only: true },
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
  const comms = /[?&]comms=/.test(extra) ? '' : '&comms=off'; // the Expedition radio stays out of the store shots
  await page.goto(srv.base + '?sw=0&gov=off&perfdiag=off&watchdog=off&hunt=always' + comms + extra, { waitUntil: 'domcontentloaded' });
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
    // THE HOLDFAST: wait for its GLB, stand the body off the patch (held there: the S2 patch is 5 m up a wall), force the state
    let hfSite = null;
    const hfFront = () => (rec.holdfast ? D.holdfast.front({ site: rec.holdfast.site, dist: rec.holdfast.dist == null ? 0.9 : rec.holdfast.dist, dy: rec.holdfast.dy == null ? -0.45 : rec.holdfast.dy }) : null);
    if (rec.holdfast && D.holdfast && G.holdfastView) {
      const hv = G.holdfastView;
      if (!hv.ready && !hv.loading && !hv.failed) hv.load(() => G._holdfastLoader());
      for (let k = 0; k < 1200 && !hv.ready && !hv.failed; k++) await new Promise((res) => setTimeout(res, 100));
      const lv = G.renderer && G.renderer.levelView;
      if (lv && typeof lv.finishDressing === 'function') lv.finishDressing(); // the walls round the patch (built 2 ms a frame otherwise)
      hfSite = hfFront();
      const q = rec.holdfast;
      if (hfSite && q.state) {
        const t = q.target || [0, 0, 0.1];
        const ux = hfSite.nz;
        const uz = -hfSite.nx; // u = up x n (walls)
        D.holdfast.force(q.site, { state: q.state, hand: 'right', tx: hfSite.x + ux * t[0] + hfSite.nx * t[2], ty: hfSite.y + t[1], tz: hfSite.z + uz * t[0] + hfSite.nz * t[2], onT: q.onT });
      }
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
      if (hfSite) hfFront();
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
    if (rec.comms && D.comms) {
      const c = rec.comms;
      if (c.die) D.comms.die(c.die, c.count || 1);
      else if (c.say) D.comms.say(c.say, { glitch: c.glitch, at: c.at, dur: c.dur });
      D.step(c.t || 1.5, { render: false, state: false });
      G._setLook(rec.yaw, rec.pitch);
    }
    const dbody = rec.dresser && G.dresser && !G.dresser.isNull ? G.dresser.body : null;
    if (dbody && dbody.visible && rec.dresser.orbit) {
      // the camera `orbit` m from its chest at 50-70 degrees off its up (a three-quarter view of a figure standing sideways on its
      // wall), along its facing or across it: the first such spot in open air with a clear view of it
      const b = dbody;
      const cx = b.x + b.ux * 1.8;
      const cy = b.y + b.uy * 1.8;
      const cz = b.z + b.uz * 1.8;
      const sx = b.uy * b.fz - b.uz * b.fy;
      const sy = b.uz * b.fx - b.ux * b.fz;
      const sz = b.ux * b.fy - b.uy * b.fx;
      const dirs = [
        [b.fx, b.fy, b.fz],
        [-b.fx, -b.fy, -b.fz],
        [sx, sy, sz],
        [-sx, -sy, -sz],
      ];
      const R = rec.dresser.orbit;
      let spot = null;
      const tmp = [];
      for (const a of [1.05, 0.9, 1.2]) {
        for (const d of dirs) {
          if (spot) break;
          const ex = cx + (b.ux * Math.cos(a) + d[0] * Math.sin(a)) * R;
          const ey = cy + (b.uy * Math.cos(a) + d[1] * Math.sin(a)) * R;
          const ez = cz + (b.uz * Math.cos(a) + d[2] * Math.sin(a)) * R;
          const inside = G.level.querySolids(ex - 0.6, ey - 1.6, ez - 0.6, ex + 0.6, ey + 0.4, ez + 0.6, tmp).some((q) => q.active !== false && ex > q.minX && ex < q.maxX && ey > q.minY && ey < q.maxY && ez > q.minZ && ez < q.maxZ);
          if (!inside && !G.level.segmentBlocked(ex, ey, ez, cx, cy, cz, 0.5)) spot = [ex, ey, ez];
        }
      }
      if (spot) D.teleport(spot[0], spot[1] - 1.24, spot[2]);
      b.lx = p.x;
      b.ly = p.y + 0.9;
      b.lz = p.z;
    }
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
    if (hfSite) {
      // look at the patch (a little above its centre when something reaches out of it)
      hfFront();
      const ex = p.x;
      const ey = p.y + 1.24;
      const ez = p.z;
      const tx = hfSite.x + hfSite.nx * 0.08;
      const ty = hfSite.y + 0.02;
      const tz = hfSite.z + hfSite.nz * 0.08;
      G._setLook(Math.atan2(-(tx - ex), -(tz - ez)), Math.atan2(ty - ey, Math.hypot(tx - ex, tz - ez)));
      for (let i = 0; i < 8; i++) G._render(1 / 60); // the level's pack LODs re-pick every 3rd frame after a teleport
    }
    if (rec.frames) {
      // the boards and the blood are drawn a cell per frame near the head: pump their atlases here (no GL frames in between)
      D.step(0.05, { render: true, state: false }); // applies the settings (the blood's), places the head
      const lv = G.renderer.levelView;
      const cam = G.renderer.camera;
      const eye = cam.getWorldPosition(cam.position.clone());
      for (let i = 0; i < rec.frames; i++) {
        lv._boards.update(eye, lv._detailScale);
        lv._blood.update(eye, lv._detailScale);
      }
    }
    D.step(0.05, { render: true, state: false });
    G.fade = rec.fade || 0;
    D.freeze(true);
    return { creature: rec.creature ? { seen, distance: G.creature && G.creature.distance } : null, state: G.state, y: Math.round(p.y) };
  }, r);
}

async function snap(page, file, w, h, { grab = false, fade = 0 } = {}) {
  await sleep(700); // a few frozen frames so fx and the lantern settle
  if (grab) {
    // desktop: read the canvas in the same task as a render (a WebGL canvas without preserveDrawingBuffer can show
    // black to a page screenshot taken between frames)
    const b64 = await page.evaluate((fd) => {
      const G = window.AT3D.game;
      G.fade = fd;
      G.flash = 0;
      G._render(1 / 60);
      const c = G.renderer.renderer.domElement;
      if (c.width !== window.innerWidth) throw new Error(`canvas is ${c.width}x${c.height}, expected ${window.innerWidth}x${window.innerHeight}`);
      return c.toDataURL('image/png').split(',')[1];
    }, fade || 0);
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
      await snap(page, path.join(SHOTS, `${r.id}.png`), 1920, 1080, { grab: true, fade: r.fade || 0 });
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
  if (ONLY === 'holdfast') {
    // THE HOLDFAST closed round the real gauntlet at arm's length, in the mock headset (the stereo canvas; crop an eye)
    console.log('the Holdfast in the mock headset 3840x1080');
    const { ctx, page } = await newGamePage(3840, 1080, { xr: true, extra: '&holdfast=on' });
    await page.evaluate(() => window.AT3D.game.enterVR());
    await until(() => page.evaluate(() => window.AT3D.game.xrActive), { timeout: 30000, label: 'XR' });
    await sleep(2000);
    for (const r of [
      { id: 'vr-holdfast-closed', state: 'CLOSE', run: 1.6, hold: [0.03, 0.06, 0.07] },
      { id: 'vr-holdfast-grip', state: 'GRIP', onT: 0.42, run: 1.0, hold: [0.03, 0.06, 0.07] },
    ]) {
      const info = await page.evaluate(async (rec) => {
        const G = window.AT3D.game;
        const D = window.AT3D.debug;
        const X = window.__xr;
        D.freeze(false);
        G.start('normal');
        D.godMode(true);
        G.applySettings({ bloodWriting: false });
        const hv = G.holdfastView;
        if (hv && !hv.ready && !hv.loading && !hv.failed) hv.load(() => G._holdfastLoader());
        for (let k = 0; k < 1200 && hv && !hv.ready && !hv.failed; k++) await new Promise((res) => setTimeout(res, 100));
        const lv = G.renderer && G.renderer.levelView;
        if (lv && typeof lv.finishDressing === 'function') lv.finishDressing();
        const site = 'hf-s2-east';
        const s = G.holdfast.sites.find((q) => q.id === site);
        D.warp(s.section);
        Object.assign(X.head, { x: 0, y: 1.62, z: 0, yaw: 0 });
        Object.assign(X.ctrl.right, { x: 0.06, y: 1.4, z: -0.44, pitch: -0.35, yaw: 0.25 });
        Object.assign(X.ctrl.left, { x: -0.3, y: 0.9, z: -0.1, pitch: -1.2, yaw: 0 });
        const hx = s.x + s.nz * rec.hold[0] + s.nx * rec.hold[2];
        const hy = s.y + rec.hold[1];
        const hz = s.z - s.nx * rec.hold[0] + s.nz * rec.hold[2];
        const v = { x: 0, y: 0, z: 0 };
        const sock = () => {
          const o = G.input.handSocket('right');
          const w = o.getWorldPosition(o.position.clone());
          v.x = w.x;
          v.y = w.y;
          v.z = w.z;
        };
        D.holdfast.front({ site, dist: 0.5, dy: -0.4 });
        G._setLook(Math.atan2(s.nx, s.nz), 0);
        // the body moved until the right palm is on the patch (held there: the patch is 5 m up the wall)
        const place = () => {
          for (let k = 0; k < 3; k++) {
            D.step(0.05, { render: false, state: false });
            sock();
            const p = G.player;
            D.teleport(p.x + (hx - v.x), p.y + (hy - v.y), p.z + (hz - v.z));
          }
          D.step(0.02, { render: false, state: false });
          sock();
        };
        place();
        D.holdfast.force(site, { state: rec.state, hand: 'right', tx: v.x, ty: v.y, tz: v.z, onT: rec.onT });
        let left = rec.run;
        while (left > 0) {
          D.step(0.2, { render: false, state: false });
          place();
          left -= 0.2;
        }
        D.step(0.05, { render: true, state: false });
        for (let i = 0; i < 8; i++) G._render(1 / 60); // the level's pack LODs re-pick every 3rd frame after a teleport
        D.freeze(true);
        return { err: +Math.hypot(v.x - hx, v.y - hy, v.z - hz).toFixed(3), view: G.holdfastView ? { live: G.holdfastView.info.live, lod: G.holdfastView.info.lod.slice(), tris: G.holdfastView.info.triangles } : null };
      }, r);
      console.log('  ', r.id, JSON.stringify(info));
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
