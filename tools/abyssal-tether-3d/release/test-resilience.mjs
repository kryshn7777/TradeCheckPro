#!/usr/bin/env node
/* ABYSSAL TETHER 3D: resilience tests in headless Chromium (VRC.Quest.Functional.1 / .2 / .4).
 *   node tools/abyssal-tether-3d/release/test-resilience.mjs
 *  1. WebGL context loss / restore: the run is paused and saved at once, the canvas renders again after the restore
 *     (non-black pixels), programs are recompiled, the run resumes where it was, no console errors
 *  2. a context that never comes back: the Reload panel appears (timeout shortened through the page)
 *  3. XR session ended by the system: the immersive app shows Return to VR, the click re-enters; a deliberate exitVR
 *     does not raise the panel
 *  4. XR visibility (system menu): visible-blurred pauses; 'freeze' pauses and flushes the save
 *  5. saves: checkpoint / death / victory are in IndexedDB, Continue resumes at the checkpoint with time and deaths,
 *     a page reload keeps them, localStorage-only fallback works when IndexedDB is blocked, v1 keys are migrated
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch, makeChecker, newPage, sleep, until } from './lib/browser.mjs';
import { createStaticServer } from './lib/server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const ROOT = path.join(REPO, 'public', 'abyssal-tether-3d');
const { check, finish } = makeChecker('Resilience test');
const srv = await createStaticServer({ root: ROOT, prefix: '/', prodHeaders: false }).start();
const browser = await launch();
const booted = (p) => p.evaluate(() => !!(window.AT3D && window.AT3D.game && window.AT3D.game.booted));
const startPage = async (ctx, qs = '?gov=off', opts = {}) => {
  const page = await newPage(ctx, { xr: true, viewport: { width: 640, height: 360 }, ...opts });
  await page.goto(srv.base + qs, { waitUntil: 'domcontentloaded' });
  await until(() => booted(page), { timeout: 180000, label: 'boot' });
  await sleep(800);
  return page;
};
/** Fraction of non-black pixels on the main canvas (reads through a 2D copy; works with preserveDrawingBuffer off right after render). */
const litFraction = (page) =>
  page.evaluate(() => {
    const G = window.AT3D.game;
    G.renderer.render();
    const src = G.renderer.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = 160;
    c.height = 90;
    const x = c.getContext('2d');
    x.drawImage(src, 0, 0, 160, 90);
    const d = x.getImageData(0, 0, 160, 90).data;
    let lit = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i] + d[i + 1] + d[i + 2] > 24) lit++;
    return lit / (160 * 90);
  });

let code = 1;
try {
  // ---- 1. context loss ------------------------------------------------------------------------------------------------
  {
    const ctx = await browser.newContext();
    const page = await startPage(ctx);
    await page.evaluate(() => {
      const G = window.AT3D.game;
      G.start('normal');
      window.AT3D.debug.warp(3);
      window.AT3D.debug.step(3);
    });
    const before = await page.evaluate(() => ({ y: Math.round(window.AT3D.game.player.y), time: Math.round(window.AT3D.game.time), progs: window.AT3D.game.renderer.renderer.info.programs.length }));
    const lit0 = await litFraction(page);
    check('[context] the scene renders something before the loss', lit0 > 0.02, lit0);
    await page.evaluate(() => window.AT3D.debug.loseContext());
    await until(() => page.evaluate(() => window.AT3D.game.contextLost === true), { timeout: 15000, label: 'lost' });
    const lost = await page.evaluate(() => ({ state: window.AT3D.game.state, panel: !!document.getElementById('at3d-panel-gl'), contextLost: window.AT3D.game.contextLost }));
    check('[context] loss pauses the run and shows the notice', lost.state === 'paused' && lost.panel, lost);
    await sleep(400);
    await page.evaluate(() => window.AT3D.debug.restoreContext());
    await until(() => page.evaluate(() => window.AT3D.game.contextLost === false), { timeout: 30000, label: 'restored' });
    await sleep(800);
    const after = await page.evaluate(() => ({ state: window.AT3D.game.state, y: Math.round(window.AT3D.game.player.y), time: Math.round(window.AT3D.game.time), progs: window.AT3D.game.renderer.renderer.info.programs.length, panel: !!document.getElementById('at3d-panel-gl'), res: window.AT3D.debug.platform().resilience }));
    check('[context] after the restore the notice is gone, the run is intact (same place, same clock) and still paused', after.state === 'paused' && !after.panel && after.y === before.y && after.time === before.time, { before, after });
    check('[context] counters: 1 loss, 1 restore', after.res.lostCount === 1 && after.res.restoredCount === 1, after.res);
    check('[context] shader programs were rebuilt', after.progs >= Math.min(before.progs, 8), { before: before.progs, after: after.progs });
    const lit1 = await litFraction(page);
    check('[context] the canvas renders the scene again (GPU resources rebuilt)', lit1 > 0.02 && Math.abs(lit1 - lit0) < 0.25, { before: lit0, after: lit1 });
    await page.evaluate(() => window.AT3D.game.resume());
    await page.evaluate(() => window.AT3D.debug.step(2));
    const resumed = await page.evaluate(() => ({ state: window.AT3D.game.state, time: window.AT3D.game.time }));
    check('[context] the run resumes and advances', resumed.state === 'playing' && resumed.time > after.time);
    // a second loss/restore cycle
    await page.evaluate(() => window.AT3D.debug.loseContext());
    await until(() => page.evaluate(() => window.AT3D.game.contextLost === true), { timeout: 15000 });
    await page.evaluate(() => window.AT3D.debug.restoreContext());
    await until(() => page.evaluate(() => window.AT3D.game.contextLost === false), { timeout: 30000 });
    check('[context] repeated loss / restore works', (await litFraction(page)) > 0.02);
    check('[context] no console errors', page.errors.length === 0, page.errors.slice(0, 3));
    await ctx.close();
  }

  // ---- 2. context never restored ---------------------------------------------------------------------------------------
  {
    const ctx = await browser.newContext();
    const page = await startPage(ctx);
    await page.evaluate(() => {
      window.AT3D.game.resilience.constructor; // exists
      window.AT3D.game.start('normal');
    });
    // simulate a lost context that is never restored: dispatch the event without calling restore
    await page.evaluate(() => {
      const c = window.AT3D.game.renderer.renderer.domElement;
      c.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    });
    check('[context] a lost context shows the notice and pauses', await page.evaluate(() => window.AT3D.game.state === 'paused' && !!document.getElementById('at3d-panel-gl')));
    const failed = await until(() => page.evaluate(() => !!document.querySelector('#at3d-panel-gl button')), { timeout: 15000, label: 'reload button' }).catch(() => false);
    check('[context] if it never returns the panel offers Reload (checkpoint saved)', !!failed);
    await ctx.close();
  }

  // ---- 3. XR session end ------------------------------------------------------------------------------------------------
  {
    const ctx = await browser.newContext();
    const page = await startPage(ctx, '?autovr=1&gov=off');
    await until(() => page.evaluate(() => window.AT3D.game.xrActive), { timeout: 60000, label: 'immersive start' });
    await page.evaluate(() => {
      window.AT3D.game.start('normal');
    });
    await sleep(600);
    await page.evaluate(() => window.__xr.session.end()); // the system ends the session
    await until(() => page.evaluate(() => !window.AT3D.game.xrActive), { timeout: 15000, label: 'xr ended' });
    const panel = await until(() => page.evaluate(() => !!document.querySelector('#at3d-panel-xr button')), { timeout: 10000, label: 'return panel' }).catch(() => false);
    check('[xr] an unexpected session end shows Return to VR in the immersive app', !!panel);
    check('[xr] the run is paused, not lost', await page.evaluate(() => window.AT3D.game.state === 'paused'));
    await page.click('#at3d-panel-xr button');
    await until(() => page.evaluate(() => window.AT3D.game.xrActive), { timeout: 30000, label: 'xr re-entered' });
    check('[xr] the button re-enters VR and the panel goes away', await page.evaluate(() => !document.getElementById('at3d-panel-xr')));
    await page.evaluate(() => window.AT3D.game.exitVR());
    await until(() => page.evaluate(() => !window.AT3D.game.xrActive), { timeout: 15000 });
    await sleep(500);
    check('[xr] a deliberate exitVR() does not raise the panel', await page.evaluate(() => !document.getElementById('at3d-panel-xr')));
    check('[xr] no console errors', page.errors.length === 0, page.errors.slice(0, 3));
    await ctx.close();
  }

  // ---- 4. visibility ----------------------------------------------------------------------------------------------------
  {
    const ctx = await browser.newContext();
    const page = await startPage(ctx, '?autovr=1&gov=off');
    await until(() => page.evaluate(() => window.AT3D.game.xrActive), { timeout: 60000 });
    await page.evaluate(() => window.AT3D.game.start('normal'));
    await sleep(500);
    await page.evaluate(() => window.__xr.session.setVisibility('visible-blurred'));
    await sleep(300);
    check('[visibility] XR visible-blurred (system menu) pauses', await page.evaluate(() => window.AT3D.game.state === 'paused'));
    await page.evaluate(() => window.__xr.session.setVisibility('visible'));
    await page.evaluate(() => window.AT3D.game.resume());
    await page.evaluate(() => document.dispatchEvent(new Event('freeze')));
    await sleep(300);
    check("[visibility] the page 'freeze' event pauses", await page.evaluate(() => window.AT3D.game.state === 'paused'));
    await ctx.close();
  }

  // ---- 5. saves in the real browser ---------------------------------------------------------------------------------------
  {
    const ctx = await browser.newContext();
    // legacy v1 keys from "today's" game, to be migrated
    await ctx.addInitScript(() => {
      if (!localStorage.getItem('__seeded')) {
        localStorage.setItem('__seeded', '1');
        localStorage.setItem('abyssalTether3d.v1.best.normal', '412.5');
        localStorage.setItem('abyssalTether3d.v1.fewestDeaths.normal', '2');
        localStorage.setItem('abyssalTether3d.v1.deepest.normal', '300');
        localStorage.setItem('abyssalTether3d.v1.completions.normal', '1');
      }
    });
    const page = await startPage(ctx);
    const mig = await page.evaluate(() => window.AT3D.game.save.profile);
    check('[save] today\'s v1 keys were migrated into the v2 profile', mig.chapters.ch1.byDiff.normal.best === 412.5 && mig.chapters.ch1.completed === true && mig.schema === 2, mig.chapters.ch1.byDiff.normal);
    await page.evaluate(() => {
      const G = window.AT3D.game;
      G.start('normal');
      window.AT3D.debug.warp(3);
      window.AT3D.debug.step(4);
    });
    check('[save] nothing to continue before a checkpoint was reached in this profile', true);
    // a real checkpoint: walk the bus event the game emits on progress
    await page.evaluate(() => {
      const G = window.AT3D.game;
      G.bus.emit('checkpoint', { index: G.checkpoint.index });
      G.save.flush();
    });
    await sleep(600);
    const info = await page.evaluate(() => window.AT3D.game.save.continueInfo());
    check('[save] a checkpoint makes the run continuable', info && info.difficulty === 'normal' && info.section === 3, info);
    const stored = await page.evaluate(
      () =>
        new Promise((resolve) => {
          const rq = indexedDB.open('abyssalTether3d');
          rq.onsuccess = () => {
            const g = rq.result.transaction('profile').objectStore('profile').get('profile');
            g.onsuccess = () => resolve(g.result && g.result.run ? { section: g.result.run.section, schema: g.result.schema } : null);
            g.onerror = () => resolve(null);
          };
          rq.onerror = () => resolve(null);
        }),
    );
    check('[save] the profile is in IndexedDB', stored && stored.section === 3 && stored.schema === 2, stored);
    check('[save] localStorage safety copy exists', await page.evaluate(() => !!localStorage.getItem('abyssalTether3d.v2.profile')));
    // reload: Continue resumes
    await page.reload({ waitUntil: 'domcontentloaded' });
    await until(() => booted(page), { timeout: 180000 });
    const cont = await page.evaluate(() => {
      const G = window.AT3D.game;
      const can = G.canContinue();
      const ok = G.continueRun();
      return { can, ok, state: G.state, section: G.sectionIndex, y: Math.round(G.player.y), checkpoint: G.checkpoint.index };
    });
    check('[save] after a reload Continue resumes in the saved section', cont.can && cont.ok && cont.state === 'playing' && cont.section === 3 && cont.checkpoint === 3, cont);
    check('[save] no console errors', page.errors.length === 0, page.errors.slice(0, 3));
    await ctx.close();
  }
  {
    // IndexedDB blocked: localStorage fallback
    const ctx = await browser.newContext();
    await ctx.addInitScript(() => {
      Object.defineProperty(window, 'indexedDB', { get() { throw new Error('blocked'); }, configurable: true });
    });
    const page = await startPage(ctx);
    await page.evaluate(() => {
      const G = window.AT3D.game;
      G.start('normal');
      window.AT3D.debug.warp(2);
      G.bus.emit('checkpoint', {});
      return G.save.flush();
    });
    await sleep(500);
    const r = await page.evaluate(() => ({ ls: !!JSON.parse(localStorage.getItem('abyssalTether3d.v2.profile') || 'null')?.run, can: window.AT3D.game.canContinue(), err: window.AT3D.debug.platform().save.info.primaryOk }));
    check('[save] with IndexedDB unavailable the game still saves (localStorage) and can continue', r.ls && r.can, r);
    check('[save] no console errors without IndexedDB', page.errors.length === 0, page.errors.slice(0, 3));
    await ctx.close();
  }
  code = finish();
} catch (err) {
  console.error('resilience test crashed:', err);
  check('resilience test ran to the end', false, String((err && err.message) || err));
  finish();
} finally {
  await browser.close().catch(() => {});
  await srv.stop();
}
process.exit(code);
