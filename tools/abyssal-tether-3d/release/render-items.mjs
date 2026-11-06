#!/usr/bin/env node
/* THE LANTERN: look at the item models (src/render/itemModels.js) in the REAL game, on the level's stone, under the lantern, in the dark look.
 *
 *   flock /tmp/at3d-browser.lock node tools/abyssal-tether-3d/release/render-items.mjs [--section 0] [--w 960 --h 600] [--out DIR]
 *
 * Boots the game headless (software WebGL), starts a run in god mode, warps to the section, freezes it, then lays the four models
 * (first aid case, field dressing, grenade, revolver) on the floor in their lying poses (MODEL_REST) a step in front of the player, drops
 * a real first aid kit and a real bandage through render/droppedProps.js (they fall and settle into their lying pose) and spawns the two
 * as real floating pickups (render/pickupsView.js). Shots: each model at ~0.7 m, the row at ~2 m from the player's eye, the pickups.
 * The camera is moved for the shot only (the lantern stays in the player's hand where the game put it).
 * Output: DIR/items-*.png and DIR/items-contact.png (default tools/abyssal-tether-3d/release/out, git-ignored).
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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
const W = +arg('--w', 960);
const H = +arg('--h', 600);
const SECTION = +arg('--section', 0);
const OUT = path.resolve(REPO, arg('--out', 'tools/abyssal-tether-3d/release/out'));
const ROOT = path.resolve(REPO, arg('--root', 'public/abyssal-tether-3d'));
fs.mkdirSync(OUT, { recursive: true });

const srv = await createStaticServer({ root: ROOT, prefix: '/', prodHeaders: false }).start();
const browser = await launch();
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const page = await newPage(ctx, { viewport: { width: W, height: H } });
page.on('crash', () => {
  console.error('PAGE CRASHED');
  process.exit(2);
});
await page.addInitScript(() => {
  const css = document.createElement('style');
  css.textContent = '#ui-root,.at3d-ui,#boot,#at-fatal,#at3d-gpu-banner,[id^=at3d-panel]{display:none!important}';
  document.addEventListener('DOMContentLoaded', () => document.head.appendChild(css));
});
const t0 = Date.now();
await page.goto(srv.base + '?sw=0&gov=off&perfdiag=off&watchdog=off&comms=off&hunt=off&hints=off&roaches=off', { waitUntil: 'domcontentloaded' });
await until(() => page.evaluate(() => !!(window.AT3D && window.AT3D.game && window.AT3D.game.booted)), { timeout: 400000, label: 'boot' });
await sleep(2500);
console.log(`booted in ${((Date.now() - t0) / 1000).toFixed(0)} s`);

// set the scene: a run, god mode, the section, the props on the floor in front of the player
const info = await page.evaluate(
  async ({ section }) => {
    const G = window.AT3D.game;
    const D = window.AT3D.debug;
    const THREE = await import('three');
    const IM = await import(new URL('src/render/itemModels.js', location.href).href);
    const { ITEM } = await import(new URL('src/sim/inventory3d.js', location.href).href);
    D.freeze(false);
    G.start('normal');
    D.godMode(true);
    if (section > 0) D.warp(section);
    D.step(1.0, { render: false, state: false });
    const p = G.player;
    // face along the longest clear floor direction (8 headings: the one whose floor stays level for 2.5 m)
    const tmp = [];
    const floorAt = (x, z, y0) => {
      let top = -1e9;
      for (const s of G.level.querySolids(x - 0.02, y0 - 1.5, z - 0.02, x + 0.02, y0 + 0.4, z + 0.02, tmp)) {
        if (s.active === false) continue;
        if (x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ && s.maxY <= y0 + 0.4 && s.maxY > top) top = s.maxY;
      }
      return top;
    };
    const fy = floorAt(p.x, p.z, p.y);
    let best = null;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      const fx = Math.sin(a);
      const fz = Math.cos(a);
      let sc = 0;
      for (let d = 0.4; d <= 2.6; d += 0.2) {
        for (const l of [-0.6, 0, 0.6]) {
          const y = floorAt(p.x + fx * d - fz * l, p.z + fz * d + fx * l, fy);
          if (Math.abs(y - fy) < 0.02) sc++;
        }
      }
      if (!best || sc > best.sc) best = { a, fx, fz, sc };
    }
    const { fx, fz } = best;
    const rx = -fz; // the right of the heading
    const rz = fx;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.12 });
    const names = ['FIRST_AID', 'BANDAGE', 'GRENADE', 'SIDEARM'];
    const builders = [IM.buildFirstAid, IM.buildBandage, IM.buildGrenade, IM.buildSidearm];
    const placed = [];
    const yaw = Math.atan2(fx, fz);
    const offs = [-0.5, -0.14, 0.17, 0.46];
    for (let i = 0; i < 4; i++) {
      const t = builders[i](0);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(t.pos, 3));
      g.setAttribute('normal', new THREE.BufferAttribute(t.nor, 3));
      g.setAttribute('color', new THREE.BufferAttribute(t.col, 3));
      g.setIndex(new THREE.BufferAttribute(t.idx, 1));
      const m = new THREE.Mesh(g, mat);
      const R = IM.MODEL_REST[names[i]];
      const x = p.x + fx * 1.15 + rx * offs[i];
      const z = p.z + fz * 1.15 + rz * offs[i];
      const y = floorAt(x, z, fy) + R.h;
      m.position.set(x, y, z);
      // yaw first (in world), then the lying pose: the model's +X runs across the view
      m.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw + Math.PI / 2 + [0.25, -0.5, 0.6, -0.2][i]).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(...R.euler)));
      m.name = 'itemPreview' + names[i];
      G.renderer.scene.add(m);
      placed.push({ name: names[i], x, y, z, tris: t.idx.length / 3, verts: t.verts });
    }
    // the real dropped props (render/droppedProps.js): dropped from 40 cm, they settle into their lying pose
    const dp = G.renderer.droppedProps;
    dp.spawn(ITEM.FIRST_AID, p.x + fx * 1.9 - rx * 0.35, fy + 0.4, p.z + fz * 1.9 - rz * 0.35, 0, 0, 0, 2);
    dp.spawn(ITEM.BANDAGE, p.x + fx * 1.9 + rx * 0.3, fy + 0.4, p.z + fz * 1.9 + rz * 0.3, 0, 0, 0, 2);
    // the real floating pickups
    G.pickups.spawnAt(ITEM.FIRST_AID, p.x + fx * 2.6 - rx * 0.45, fy + 0.45, p.z + fz * 2.6 - rz * 0.45);
    G.pickups.spawnAt(ITEM.BANDAGE, p.x + fx * 2.6 + rx * 0.45, fy + 0.45, p.z + fz * 2.6 + rz * 0.45);
    G.fade = 0;
    G.flash = 0;
    G._setLook(yaw + Math.PI, -0.75);
    // let the drops land and rest (the run itself frozen around it)
    for (let i = 0; i < 180; i++) dp.update(1 / 60, G);
    D.freeze(true);
    window.__items = { placed, f: [fx, fz], r: [rx, rz], p: [p.x, fy, p.z], yaw };
    return { placed, floor: fy, heading: best, drops: dp.items.filter((it) => it.active).map((it) => ({ kind: it.kind, y: +(it.y - fy).toFixed(4), rested: it.rested })) };
  },
  { section: SECTION },
);
console.log(JSON.stringify(info));

/** One frame, the camera at `eye` looking at `at` (world), read back. */
async function shot(eye, at, warm = 2) {
  const b64 = await page.evaluate(
    async ({ eye, at, warm }) => {
      const G = window.AT3D.game;
      const THREE = await import('three');
      const r = G.renderer;
      const cam = r.camera;
      let png = null;
      for (let i = 0; i <= warm; i++) {
        G._frame(1 / 60, false);
        r.update(1 / 60, G);
        const par = cam.parent;
        const w = new THREE.Vector3(eye[0], eye[1], eye[2]);
        if (par) {
          par.updateMatrixWorld(true);
          par.worldToLocal(w);
        }
        cam.position.copy(w);
        cam.updateMatrixWorld(true);
        cam.lookAt(at[0], at[1], at[2]);
        cam.updateMatrixWorld(true);
        // the shot is about the props: the hands, the launchers and the aim marks (camera / rig children) are hidden for it
        const hid = [];
        const hide = (o) => {
          let light = false;
          if (o) o.traverse((k) => (light = light || !!k.isLight || k === r.lanternGroup));
          if (o && o !== cam && o.visible && !light) {
            o.visible = false;
            hid.push(o);
          }
        };
        for (const c of cam.children) hide(c);
        if (par) for (const c of par.children) hide(c);
        const hv = G.handsView;
        if (hv && hv.root) hide(hv.root);
        r.render();
        for (const o of hid) o.visible = true;
        if (i === warm) png = r.renderer.domElement.toDataURL('image/png').split(',')[1];
      }
      return png;
    },
    { eye, at, warm },
  );
  return Buffer.from(b64, 'base64');
}

const S = await page.evaluate(() => window.__items);
const [fx, fz] = S.f;
const files = [];
const save = (buf, name, label) => {
  const f = path.join(OUT, `items-${name}.png`);
  fs.writeFileSync(f, buf);
  files.push([f, label]);
  console.log('  ' + path.relative(REPO, f));
};
// each model at ~0.7 m (from the player's side, a little above: the lantern behind the shoulder)
for (const it of S.placed) {
  const eye = [it.x - fx * 0.48, it.y + 0.48, it.z - fz * 0.48];
  const d = Math.hypot(eye[0] - it.x, eye[1] - it.y, eye[2] - it.z);
  save(await shot(eye, [it.x, it.y, it.z]), `${it.name.toLowerCase()}-near`, `${it.name} ${d.toFixed(2)} m`);
}
// the row at ~2 m from the player's eye height
{
  const c = S.placed[1];
  const mid = [(S.placed[0].x + S.placed[3].x) / 2, c.y, (S.placed[0].z + S.placed[3].z) / 2];
  const eye = [S.p[0] - fx * 0.5, S.p[1] + 1.55, S.p[2] - fz * 0.5];
  const d = Math.hypot(eye[0] - mid[0], eye[1] - mid[1], eye[2] - mid[2]);
  save(await shot(eye, mid), 'row-far', `the row ${d.toFixed(2)} m`);
  // the real drops and the floating pickups beyond
  const far = [S.p[0] + fx * 2.2, S.p[1] + 0.2, S.p[2] + fz * 2.2];
  save(await shot([S.p[0], S.p[1] + 1.4, S.p[2]], far), 'drops-pickups', 'drops 1.9 m + pickups 2.6 m');
}

// contact sheet: 3 across
const cols = 3;
const tw = 480;
const th = Math.round((tw * H) / W);
const inputs = [];
const chains = [];
files.forEach(([f, label], i) => {
  inputs.push('-i', f);
  chains.push(`[${i}:v]scale=${tw}:${th},drawtext=text='${label.replace(/[:']/g, ' ')}':x=8:y=h-24:fontsize=16:fontcolor=white:box=1:boxcolor=black@0.55:boxborderw=4[v${i}]`);
});
const layout = files.map((_, i) => `${(i % cols) * tw}_${Math.floor(i / cols) * th}`).join('|');
const sheet = path.join(OUT, 'items-contact.png');
const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...inputs, '-filter_complex', `${chains.join(';')};${files.map((_, i) => `[v${i}]`).join('')}xstack=inputs=${files.length}:layout=${layout}:fill=black`, '-frames:v', '1', sheet], { stdio: 'inherit' });
console.log(r.status === 0 ? `contact sheet: ${path.relative(REPO, sheet)}` : 'ffmpeg failed');
if (page.errors.length) console.log('page errors:', page.errors.slice(0, 5));
await browser.close();
await srv.stop?.();
process.exit(0);
