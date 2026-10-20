#!/usr/bin/env node
/* ABYSSAL TETHER 3D: one-page release sanity run (headless Chromium, mock WebXR, ONE browser, ONE page).
 *   flock /tmp/at3d-browser.lock node tools/abyssal-tether-3d/release/sanity.mjs
 * Immersive boot (first XR frame + content behind the loading scene), a short accelerated run with a stable-memory
 * check, WebGL context loss / restore, XR session end -> Return to VR, saves (IndexedDB + Continue). ~3-6 minutes
 * on software WebGL. The long soak (soak.mjs) and the other browser suites are separate and optional.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, makeChecker, newPage, sleep, until } from './lib/browser.mjs';
import { createStaticServer } from './lib/server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..', 'public', 'abyssal-tether-3d');
const { check, finish } = makeChecker('Sanity');
const srv = await createStaticServer({ root: ROOT, prefix: '/', prodHeaders: false }).start();
const browser = await launch();
let code = 1;
try {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 180 } });
  const page = await newPage(ctx, { xr: true, viewport: { width: 320, height: 180 } });
  const ev = (f, a) => page.evaluate(f, a);
  await page.goto(srv.base + '?autovr=1&gov=off&watchdog=off&sw=0', { waitUntil: 'commit' });
  await until(() => ev(() => !!(window.AT3D && window.AT3D.game && window.AT3D.game.bootTimes.firstXRFrame)), { timeout: 120000, label: 'first XR frame' });
  const first = await ev(() => ({ t: window.AT3D.game.bootTimes.firstXRFrame, booted: window.AT3D.game.booted, frames: window.__xr.frames }));
  check('immersive launch: first head-tracked frame is the loading scene (< 4 s unthrottled, software GL)', first.t < 4000 && !first.booted, `${first.t} ms`);
  await until(() => ev(() => window.AT3D.game.booted), { timeout: 240000, label: 'content' });
  const boot = await ev(() => ({ times: window.AT3D.game.bootTimes, ui: window.AT3D.debug.state().ui, xr: window.AT3D.game.xrActive, loading: !!window.AT3D.game.renderer.scene.getObjectByName('LoadingScene'), faults: window.AT3D.debug.state().faults, standIns: window.AT3D.debug.state().standIns }));
  check('content loads behind it and the menu is up in VR; loading scene removed', boot.ui === 'menu' && boot.xr && !boot.loading && boot.times.content > boot.times.firstXRFrame, boot.times);
  check('no faults / stand-ins', !Object.keys(boot.faults).length && !Object.values(boot.standIns).some(Boolean), { faults: boot.faults, standIns: boot.standIns });

  // short accelerated loop, stable memory
  const sample = () => ev(() => { const r = window.AT3D.game.renderer.renderer.info; let o = 0; window.AT3D.game.renderer.scene.traverse(() => o++); let l = 0; const h = window.AT3D.game.bus._h; for (const k of Object.keys(h)) l += h[k].length; return { geo: r.memory.geometries, tex: r.memory.textures, prog: r.programs.length, obj: o, lst: l }; });
  const loop = () => ev(() => { const G = window.AT3D.game, D = window.AT3D.debug; for (const [diff, sec] of [['normal', 1], ['normal', 3], ['normal', 5]]) { G.start(diff); D.warp(sec); for (let i = 0; i < 3; i++) { D.step(7, { render: true, state: false }); if (G.state === 'dead' && G.deathT > 0.7) G.respawn(); } } G.quitToMenu(); G.start('normal'); D.step(3, { render: true, state: false }); });
  await loop(); // warm-up: every lazily created GPU object exists after this
  const a = await sample();
  await loop();
  await loop();
  const b = await sample();
  check('60+ simulated seconds x3: renderer.info geometries / textures / programs / scene objects / bus listeners do not grow', JSON.stringify(a) === JSON.stringify(b), { before: a, after: b });

  // context loss
  await ev(() => { window.AT3D.game.start('normal'); window.AT3D.debug.warp(2); window.AT3D.debug.step(2, { render: true, state: false }); });
  const pre = await ev(() => ({ y: Math.round(window.AT3D.game.player.y), t: Math.round(window.AT3D.game.time) }));
  await ev(() => window.AT3D.debug.loseContext());
  await until(() => ev(() => window.AT3D.game.contextLost === true), { timeout: 30000, label: 'lost' });
  const lost = await ev(() => ({ st: window.AT3D.game.state, panel: !!document.getElementById('at3d-panel-gl') }));
  check('context loss pauses the run and shows the notice', lost.st === 'paused' && lost.panel, lost);
  await ev(() => window.AT3D.debug.restoreContext());
  await until(() => ev(() => window.AT3D.game.contextLost === false), { timeout: 120000, label: 'restored' });
  await sleep(500);
  const post = await ev(() => ({ st: window.AT3D.game.state, y: Math.round(window.AT3D.game.player.y), t: Math.round(window.AT3D.game.time), panel: !!document.getElementById('at3d-panel-gl') }));
  check('after the restore the run is intact (same place and clock), notice gone', post.y === pre.y && post.t === pre.t && !post.panel, { pre, post });
  await ev(() => { window.AT3D.game.resume(); window.AT3D.debug.step(2, { render: true, state: false }); });
  check('the run resumes and renders after a restore', await ev(() => window.AT3D.game.state === 'playing' && window.AT3D.game.renderer.renderer.info.render.calls > 0));

  // saves
  await ev(() => { const G = window.AT3D.game; G.start('normal'); window.AT3D.debug.warp(3); G.bus.emit('checkpoint', { index: G.checkpoint.index }); return G.save.flush(); });
  await sleep(500);
  const cont = await ev(() => window.AT3D.game.save.continueInfo());
  check('a checkpoint is saved and continuable', cont && cont.section === 3 && cont.difficulty === 'normal', cont);
  check('IndexedDB holds the profile', await ev(() => new Promise((res) => { const rq = indexedDB.open('abyssalTether3d'); rq.onsuccess = () => { const g = rq.result.transaction('profile').objectStore('profile').get('profile'); g.onsuccess = () => res(!!(g.result && g.result.schema === 2 && g.result.run)); g.onerror = () => res(false); }; rq.onerror = () => res(false); })));

  // XR session ended by the system
  await ev(() => window.__xr.session.end());
  await until(() => ev(() => !window.AT3D.game.xrActive), { timeout: 30000, label: 'xr ended' });
  const panel = await until(() => ev(() => !!document.querySelector('#at3d-panel-xr button')), { timeout: 15000, label: 'return panel' }).catch(() => false);
  check('system-ended XR session: Return to VR panel in the immersive app, run paused', !!panel && (await ev(() => window.AT3D.game.state === 'paused')));
  await page.click('#at3d-panel-xr button');
  await until(() => ev(() => window.AT3D.game.xrActive), { timeout: 60000, label: 're-enter' });
  check('Return to VR re-enters the session', true);
  check('no console errors', page.errors.length === 0, page.errors.slice(0, 5));
  await ctx.close();
  code = finish();
} catch (err) {
  console.error('sanity crashed:', err);
  check('sanity ran to the end', false, String((err && err.message) || err));
  finish();
} finally {
  await browser.close().catch(() => {});
  await srv.stop();
}
process.exit(code);
