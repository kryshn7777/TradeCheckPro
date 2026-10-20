#!/usr/bin/env node
/* ABYSSAL TETHER 3D: boot tests in headless Chromium (mock WebXR).   node tools/abyssal-tether-3d/release/test-boot.mjs [--root DIR] [--throttle 4] [--shots DIR]
 *
 * RELEASE T1-T2 / VRC.Quest.Performance.3: an installed immersive PWA must request the XR session right after load
 * and show head-tracked frames within 4 s; the heavy content loads behind a diegetic loading scene.
 *
 *  1. immersive launch (?autovr=1, the stand-in for the store install): the early session request goes out before
 *     game.js is parsed, the first XR frame (loading scene) arrives < 4 s after navigation start with the CPU
 *     throttled (Quest-class), cold (network latency, no cache) and warm; XR frames keep coming while the content
 *     loads; the menu then appears in VR and the loading scene is disposed (no GPU leak)
 *  2. plain browser tab: no early request, the DOM loader and the Enter VR button still work, boot to menu
 *  3. the installed app whose early request is refused: the boot screen offers a real Enter VR button
 *  4. no WebXR at all with ?autovr=1: plain boot, no errors
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, makeChecker, newPage, sleep, until } from './lib/browser.mjs';
import { createStaticServer } from './lib/server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const ROOT = path.resolve(arg('--root', path.join(REPO, 'public', 'abyssal-tether-3d')));
const THROTTLE = Number(arg('--throttle', '4'));
const SHOTS = arg('--shots', null);
const BUDGET_MS = 4000;
const SUB = '/TradeCheckPro/abyssal-tether-3d/';
const { check, finish } = makeChecker('Boot test');
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

async function throttled(ctx, page, rate) {
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  return cdp;
}
const booted = (page) => page.evaluate(() => !!(window.AT3D && window.AT3D.game && window.AT3D.game.booted));

async function immersive(browser, label, { latency = 0, throttle = THROTTLE, warm = false } = {}) {
  const srv = await createStaticServer({ root: ROOT, prefix: SUB, latency, prodHeaders: true }).start();
  const ctx = await browser.newContext();
  try {
    if (warm) {
      // warm the HTTP cache with a first load
      const p0 = await newPage(ctx, { xr: true });
      await p0.goto(srv.base + '?autovr=1');
      await until(() => booted(p0), { timeout: 120000, label: 'warm-up boot' });
      await p0.close();
    }
    const page = await newPage(ctx, { xr: true });
    await throttled(ctx, page, throttle);
    await page.goto(srv.base + '?autovr=1', { waitUntil: 'commit' });
    await until(() => page.evaluate(() => !!(window.AT3D && window.AT3D.game)), { timeout: 60000, label: 'AT3D' });
    // wait for the first XR frame, remember the XR frame counter at that moment
    const first = await until(() => page.evaluate(() => (window.AT3D.game.bootTimes.firstXRFrame ? { t: window.AT3D.game.bootTimes.firstXRFrame, frames: window.__xr.frames, booted: window.AT3D.game.booted } : null)), { timeout: 60000, every: 20, label: 'first XR frame' });
    const reqd = await page.evaluate(() => window.AT3D.early);
    check(`[${label}] immersive launch requests the session before the game is parsed`, reqd.requested === true && reqd.mode.immersiveApp === true, reqd.mode);
    check(`[${label}] first head-tracked frame within ${BUDGET_MS} ms of launch (CPU x${throttle})`, first.t < BUDGET_MS, `${first.t} ms`);
    check(`[${label}] that frame is the loading scene (content not booted yet)`, first.booted === false);
    // screenshot of the loading scene (mock XR draws both eyes side by side into the page canvas)
    if (SHOTS) {
      await sleep(300);
      const stillLoading = await page.evaluate(() => !window.AT3D.game.booted);
      if (stillLoading) await page.screenshot({ path: path.join(SHOTS, `loading-${label}.png`) });
    }
    await until(() => booted(page), { timeout: 180000, label: 'content boot' });
    const info = await page.evaluate(() => ({
      times: window.AT3D.game.bootTimes,
      xrFramesTotal: window.__xr.frames,
      ui: window.AT3D.debug.state().ui,
      xr: window.AT3D.game.xrActive,
      standIns: window.AT3D.debug.state().standIns,
      faults: window.AT3D.debug.state().faults,
      loadingLeft: !!window.AT3D.game.loading,
      sceneHasLoading: !!window.AT3D.game.renderer.scene.getObjectByName('LoadingScene'),
      mem: { g: window.AT3D.game.renderer.renderer.info.memory.geometries, t: window.AT3D.game.renderer.renderer.info.memory.textures },
    }));
    check(`[${label}] XR frames kept coming while the content loaded`, info.xrFramesTotal - first.frames >= 3, { framesAtFirst: first.frames, total: info.xrFramesTotal });
    check(`[${label}] the content finishes behind the loading scene and the menu is up in VR`, info.ui === 'menu' && info.xr === true && info.times.content > info.times.firstXRFrame, info.times);
    check(`[${label}] loading scene removed from the scene`, !info.loadingLeft && !info.sceneHasLoading);
    check(`[${label}] no stand-in modules, no faults, no console errors`, !Object.values(info.standIns).some(Boolean) && Object.keys(info.faults).length === 0 && page.errors.length === 0, { standIns: info.standIns, faults: info.faults, errors: page.errors.slice(0, 3) });
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `menu-vr-${label}.png`) });
    return info;
  } finally {
    await ctx.close();
    await srv.stop();
  }
}

const browser = await launch();
let code = 1;
try {
  await immersive(browser, 'cold', { latency: 40 });
  await immersive(browser, 'warm', { warm: true });

  // 2. plain tab ---------------------------------------------------------------------------------------------------------
  {
    const srv = await createStaticServer({ root: ROOT, prefix: SUB }).start();
    const ctx = await browser.newContext();
    const page = await newPage(ctx, { xr: true });
    await page.goto(srv.base);
    await until(() => booted(page), { timeout: 120000, label: 'plain boot' });
    const r = await page.evaluate(() => ({ early: window.AT3D.early.requested, xr: window.AT3D.game.xrActive, ui: window.AT3D.debug.state().ui, frames: window.__xr.frames, btn: !!document.querySelector('[data-action="enter-vr"]'), boot: !!document.getElementById('boot') }));
    check('[plain tab] no early session request, menu on screen, VR not entered by itself', r.early === false && r.xr === false && r.ui === 'menu' && r.frames === 0, r);
    await sleep(800);
    const btnVisible = await page.evaluate(() => {
      const b = document.querySelector('.menu-actions [data-action="enter-vr"]');
      return !!b && !b.hidden;
    });
    check('[plain tab] the Enter VR button is offered', btnVisible);
    await page.evaluate(() => document.querySelector('.menu-actions [data-action="enter-vr"]').click());
    await until(() => page.evaluate(() => window.AT3D.game.xrActive), { timeout: 30000, label: 'Enter VR click' });
    check('[plain tab] clicking Enter VR starts the session', true);
    check('[plain tab] no console errors', page.errors.length === 0, page.errors.slice(0, 3));
    await ctx.close();
    await srv.stop();
  }

  // 3. installed app, early request refused -> real Enter VR button ------------------------------------------------------------
  {
    const srv = await createStaticServer({ root: ROOT, prefix: SUB }).start();
    const ctx = await browser.newContext();
    const page = await newPage(ctx, { xr: true });
    await page.addInitScript(() => {
      // the first request (the early one, no user activation) is refused, like a missing icon-tap activation
      const orig = navigator.xr.requestSession;
      let n = 0;
      navigator.xr.requestSession = function (m, i) {
        if (n++ === 0) return Promise.reject(Object.assign(new Error('A user activation is required'), { name: 'SecurityError' }));
        return orig.call(this, m, i);
      };
    });
    await page.goto(srv.base + '?autovr=1');
    await until(() => page.evaluate(() => !!(window.AT3D && window.AT3D.game && window.AT3D.game.booted)), { timeout: 120000, label: 'boot' });
    const shown = await until(() => page.evaluate(() => { const a = document.getElementById('boot-actions'); return !!a && !a.hidden; }), { timeout: 30000, label: 'boot Enter VR button' }).catch(() => false);
    check('[refused] the boot screen offers a real Enter VR button', !!shown);
    check('[refused] not in VR yet', await page.evaluate(() => !window.AT3D.game.xrActive));
    await page.click('#boot-enter-vr');
    await until(() => page.evaluate(() => window.AT3D.game.xrActive), { timeout: 30000, label: 'XR after click' });
    check('[refused] the click enters VR', true);
    await sleep(1200);
    check('[refused] boot overlay is dismissed afterwards', await page.evaluate(() => !document.getElementById('boot') || document.getElementById('boot').classList.contains('is-done')));
    await ctx.close();
    await srv.stop();
  }

  // 4. ?autovr=1 without WebXR ----------------------------------------------------------------------------------------------------
  {
    const srv = await createStaticServer({ root: ROOT, prefix: SUB }).start();
    const ctx = await browser.newContext();
    const page = await newPage(ctx, { xr: false });
    await page.goto(srv.base + '?autovr=1');
    await until(() => booted(page), { timeout: 120000, label: 'boot without xr' });
    const r = await page.evaluate(() => ({ requested: window.AT3D.early.requested, ui: window.AT3D.debug.state().ui, boot: !!document.getElementById('boot') && !document.getElementById('boot').classList.contains('is-done') }));
    await sleep(900);
    check('[no WebXR] ?autovr=1 degrades to the plain flow (no request, menu, no overlay stuck)', r.requested === false && r.ui === 'menu', r);
    check('[no WebXR] no console errors', page.errors.length === 0, page.errors.slice(0, 3));
    await ctx.close();
    await srv.stop();
  }
  code = finish();
} catch (err) {
  console.error('boot test crashed:', err);
  check('boot test ran to the end', false, String((err && err.message) || err));
  finish();
} finally {
  await browser.close().catch(() => {});
}
process.exit(code);
