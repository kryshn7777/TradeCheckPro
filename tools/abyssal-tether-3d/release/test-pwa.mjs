#!/usr/bin/env node
/* ABYSSAL TETHER 3D: PWA test in headless Chromium.   node tools/abyssal-tether-3d/release/test-pwa.mjs [--dist DIR] [--root-host] [--quick]
 *
 * Works on a scratch copy of the game (default: this checkout's public/abyssal-tether-3d, registered with ?sw=1
 * because the dev channel does not register the worker on localhost; or a built release game with --dist) and proves:
 *
 *  1. install      the service worker installs and precaches the whole core list (every file, version cache)
 *  2. offline      server STOPPED, reload (and a deep link): the game boots to the menu, zero failed requests,
 *                  every same-origin request the game made is in the precache list (nothing needed is excluded),
 *                  a run starts and plays offline, and the VR mock enters
 *  3. update       a new build is deployed: it downloads only the changed file, 'update ready' is signalled,
 *                  apply() activates it, the page then runs the new build and the old cache is gone
 *  4. bad deploy   sw.js lists a revision the server does not serve (half-finished upload) and a file that 404s:
 *                  the install is rejected, the player stays on the previous build; a repaired deploy then updates
 *  5. paths        the same build at a sub-path (/TradeCheckPro/abyssal-tether-3d/) AND at the host root (/)
 *  6. purge        ?sw=0 unregisters the worker and deletes its caches
 *
 * --root-host: also runs steps 1-2 at the host root (the default does the sub-path first, then the root).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate } from './gen-precache.mjs';
import { launch, makeChecker, newPage, sleep, until } from './lib/browser.mjs';
import { createStaticServer } from './lib/server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const argv = process.argv.slice(2);
const arg = (n, d) => {
  const i = argv.indexOf(n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const DIST = arg('--dist', null);
const QUICK = argv.includes('--quick');
const ONLY = (arg('--only', '') || '').split(',').filter(Boolean); // install,update,purge,policy
const want = (n) => (ONLY.length ? ONLY.includes(n) : n === 'install' || !QUICK);
const SRC = DIST ? path.resolve(DIST) : path.join(REPO, 'public', 'abyssal-tether-3d');
const QS = DIST ? '' : '?sw=1';
const TEMPLATE = path.join(HERE, 'sw.template.js');
const SUB = '/TradeCheckPro/abyssal-tether-3d/';

const { check, finish } = makeChecker('PWA test');
const tmpRoot = fs.mkdtempSync(path.join(process.env.AT3D_TMP || os.tmpdir(), 'at3d-pwa-'));
const cleanup = () => fs.rmSync(tmpRoot, { recursive: true, force: true });
process.on('exit', cleanup);

function copyGame(dest) {
  fs.cpSync(SRC, dest, { recursive: true, filter: (p) => !p.endsWith(`${path.sep}sw.js`) });
}
async function deploy(dir, version) {
  return generate({ root: dir, template: TEMPLATE, out: path.join(dir, 'sw.js'), version });
}
const pageEval = (page, fn, arg_) => page.evaluate(fn, arg_);

async function waitBooted(page, timeout = 120000) {
  await until(() => page.evaluate(() => !!(window.AT3D && window.AT3D.game && window.AT3D.game.booted)), { timeout, label: 'game booted' });
}
async function waitUpdatesApi(page) {
  await until(() => page.evaluate(() => !!(window.AT3D.game.updates && window.AT3D.game.updates.registered)), { timeout: 30000, label: 'update controller' });
}
async function swState(page) {
  return page.evaluate(async () => {
    const regs = await navigator.serviceWorker.getRegistrations();
    const reg = regs[0] || null;
    const names = await caches.keys();
    const out = { regs: regs.length, controller: !!navigator.serviceWorker.controller, active: !!(reg && reg.active), waiting: !!(reg && reg.waiting), installing: !!(reg && reg.installing), caches: {} };
    for (const n of names) {
      const c = await caches.open(n);
      out.caches[n] = (await c.keys()).length;
    }
    return out;
  });
}
async function swVersion(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        const ctl = navigator.serviceWorker.controller;
        if (!ctl) return resolve(null);
        const ch = new MessageChannel();
        const t = setTimeout(() => resolve(null), 2000);
        ch.port1.onmessage = (e) => {
          clearTimeout(t);
          resolve(e.data && e.data.version);
        };
        ctl.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
      }),
  );
}

// ------------------------------------------------------------------------------------------------------------
// scenarios
// ------------------------------------------------------------------------------------------------------------
async function scenarioInstallOffline(label, prefix, browser) {
  const dir = path.join(tmpRoot, `site-${label}`);
  copyGame(dir);
  const d1 = await deploy(dir, '9.0.0+{hash}');
  const core = new Set(d1.core.map((e) => e.url));
  const srv = await createStaticServer({ root: dir, prefix }).start();
  const ctx = await browser.newContext();
  const page = await newPage(ctx, { xr: true });
  const failed = [];
  page.on('requestfailed', (r) => failed.push(r.url() + ' ' + (r.failure() && r.failure().errorText)));

  // 1. install ------------------------------------------------------------------------------------------------
  await page.goto(srv.base + QS);
  await waitBooted(page);
  await until(async () => (await swState(page)).active, { timeout: 60000, label: 'sw active' });
  const st = await until(
    async () => {
      const s = await swState(page);
      const key = Object.keys(s.caches).find((n) => n.includes(':core-'));
      return key && s.caches[key] >= core.size + 1 ? s : null;
    },
    { timeout: 60000, label: 'core cache complete' },
  );
  const coreKey = Object.keys(st.caches).find((n) => n.includes(':core-'));
  check(`[${label}] service worker installs and precaches every core file`, st.caches[coreKey] === core.size + 1, `${st.caches[coreKey] - 1}/${core.size} files in ${coreKey}`);
  const scopeOk = await page.evaluate(() => navigator.serviceWorker.getRegistrations().then((r) => r[0].scope));
  check(`[${label}] scope follows the hosting path`, scopeOk === srv.base, scopeOk);
  await until(async () => (await swState(page)).controller, { timeout: 15000, label: 'sw controls the page' });
  check(`[${label}] the active worker reports its version`, (await swVersion(page)) === d1.version, d1.version);
  const manifestOk = await page.evaluate(async () => {
    const link = document.querySelector('link[rel=manifest]');
    const r = await fetch(link.href);
    const m = await r.json();
    return { ok: r.ok, type: r.headers.get('content-type'), start: new URL(m.start_url, link.href).href, scope: new URL(m.scope, link.href).href, icons: m.icons.length };
  });
  check(`[${label}] manifest resolves relative to the page (start_url inside scope)`, manifestOk.ok && manifestOk.start.startsWith(manifestOk.scope) && manifestOk.scope === srv.base, manifestOk);

  // 2. offline -------------------------------------------------------------------------------------------------
  await srv.stop();
  const requests = new Set();
  page.on('request', (r) => {
    if (!/^https?:/.test(r.url())) return; // blob: / data: URLs are in-page
    const u = new URL(r.url());
    if (u.origin === srv.origin) requests.add(u.pathname);
  });
  failed.length = 0;
  page.errors.length = 0;
  await page.goto(srv.base + QS + (QS ? '&' : '?') + 'offline=1');
  await waitBooted(page);
  const dbg = await page.evaluate(() => ({ ui: window.AT3D.debug.state().ui, standIns: window.AT3D.debug.state().standIns, faults: window.AT3D.debug.state().faults }));
  check(`[${label}] offline reload (server stopped) boots to the main menu`, dbg.ui === 'menu', dbg);
  check(`[${label}] offline: no stand-in modules, no faults, no console errors`, !Object.values(dbg.standIns).some(Boolean) && Object.keys(dbg.faults).length === 0 && page.errors.length === 0, { standIns: dbg.standIns, faults: dbg.faults, errors: page.errors.slice(0, 3) });
  // play a little: the creature kit, arms, textures, audio all load by now
  await page.evaluate(() => {
    window.AT3D.game.start('normal');
    window.AT3D.debug.step(2);
  });
  await sleep(1500);
  await page.evaluate(() => window.AT3D.game.enterVR());
  await until(() => page.evaluate(() => window.AT3D.game.xrActive), { timeout: 20000, label: 'XR active offline' });
  await sleep(1500);
  const base = srv.base;
  const notInCache = [...requests].filter((p) => {
    const rel = decodeURIComponent(p).slice(new URL(base).pathname.length);
    if (rel === '' || rel === 'sw.js') return false;
    return !core.has(rel);
  });
  check(`[${label}] offline: no request failed`, failed.length === 0, failed.slice(0, 5));
  check(`[${label}] offline: every request the game made is in the precache list (nothing needed excluded)`, notInCache.length === 0, notInCache.slice(0, 10));
  check(`[${label}] offline: a run starts and VR enters`, await page.evaluate(() => window.AT3D.debug.state().state === 'playing' && window.AT3D.game.xrActive));
  // deep link: any navigation inside the scope gets the app shell
  const deep = await ctx.newPage();
  const resp = await deep.goto(srv.base + 'some/deep/link' + QS, { waitUntil: 'domcontentloaded' }).catch((e) => ({ err: e.message }));
  const title = await deep.title().catch(() => '');
  check(`[${label}] offline deep link inside the scope serves the app shell`, !resp.err && /Abyssal Tether/.test(title), title || (resp && resp.err));
  await deep.close();
  await ctx.close();
  return { dir, d1, prefix };
}

async function scenarioUpdate(browser) {
  const dir = path.join(tmpRoot, 'site-update');
  copyGame(dir);
  const d1 = await deploy(dir, '9.1.0+{hash}');
  const srv = await createStaticServer({ root: dir, prefix: SUB }).start();
  const ctx = await browser.newContext();
  const page = await newPage(ctx, { xr: true });
  await page.goto(srv.base + QS);
  await waitBooted(page);
  await until(async () => (await swState(page)).controller, { timeout: 60000, label: 'sw controlling' });
  await until(async () => (await swVersion(page)) === d1.version, { timeout: 30000, label: 'v1 active' });

  // ---- deploy v2: one file changes -------------------------------------------------------------------------------
  const marker = `/* at3d-test-v2 ${Date.now()} */`;
  fs.appendFileSync(path.join(dir, 'style.css'), `\n${marker}\n`);
  const d2 = await deploy(dir, '9.2.0+{hash}');
  const changed = d2.core.filter((e) => d1.core.find((o) => o.url === e.url)?.rev !== e.rev).map((e) => e.url);
  srv.clearHits();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitBooted(page);
  await waitUpdatesApi(page);
  const ready = await until(() => page.evaluate(() => !!(window.AT3D.game.updates && window.AT3D.game.updates.ready)), { timeout: 60000, label: 'update ready' }).catch(() => false);
  check('[update] a new build downloads in the background and "update ready" is signalled', !!ready, { changed });
  const fetched = [...new Set(srv.state.hits.filter((h) => h.method === 'GET').map((h) => h.path.slice(SUB.length)))];
  const heavy = fetched.filter((f) => /\.(glb|jpg|png|js|json)$/.test(f) && !['sw.js'].includes(f) && !/^icons\//.test(f) && f !== 'manifest.webmanifest');
  check('[update] only the changed file was downloaded again (unchanged files copied from the previous cache)', heavy.length === 0 && fetched.includes('style.css'), { changed, fetched });
  check('[update] the old build keeps running until the player applies it', (await swVersion(page)) === d1.version, await swVersion(page));
  const st = await swState(page);
  check('[update] both builds are cached while the update waits', Object.keys(st.caches).filter((n) => n.includes(':core-')).length === 2, Object.keys(st.caches));
  // apply (only from the menu / outside XR)
  const applied = await page.evaluate(() => window.AT3D.game.updates.apply());
  check('[update] apply() activates the waiting build', applied === true);
  await sleep(1500);
  await waitBooted(page);
  await until(async () => (await swVersion(page)) === d2.version, { timeout: 30000, label: 'v2 active' });
  await waitUpdatesApi(page);
  const css = await page.evaluate(() => fetch('style.css').then((r) => r.text()));
  const st2 = await swState(page);
  check('[update] after apply the page runs the new build and the old cache is deleted', css.includes(marker) && Object.keys(st2.caches).filter((n) => n.includes(':core-')).length === 1, { caches: Object.keys(st2.caches) });

  // ---- deploy v3: half-finished (sw.js lists the new css, but the server still serves the old one) ------------------
  const goodCss = fs.readFileSync(path.join(dir, 'style.css'), 'utf8');
  fs.appendFileSync(path.join(dir, 'style.css'), '\n/* at3d-test-v3 */\n');
  const d3 = await deploy(dir, '9.3.0+{hash}');
  fs.writeFileSync(path.join(dir, 'style.css'), goodCss); // the upload of style.css "has not landed"
  await page.evaluate(() => window.AT3D.game.updates.check());
  await sleep(4000);
  const bad = await page.evaluate(async () => {
    const r = (await navigator.serviceWorker.getRegistrations())[0];
    return { waiting: !!r.waiting, installing: !!r.installing, ready: !!window.AT3D.game.updates.ready };
  });
  check('[bad deploy] a half-finished upload (hash mismatch) is rejected: nothing waits, no update is offered', !bad.waiting && !bad.ready, bad);
  check('[bad deploy] the player stays on the previous, working build', (await swVersion(page)) === d2.version);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 90000 });
  await waitBooted(page);
  check('[bad deploy] the game still boots from the previous build', await page.evaluate(() => window.AT3D.debug.state().ui === 'menu'));
  await waitUpdatesApi(page);

  // 404 on a precached file
  fs.appendFileSync(path.join(dir, 'style.css'), '\n/* at3d-test-v3 */\n');
  const d3b = await deploy(dir, '9.3.1+{hash}');
  srv.state.blocked.add(SUB + 'assets/textures/rock_albedo.jpg');
  await page.evaluate(() => window.AT3D.game.updates.check());
  await sleep(4000);
  const bad2 = await page.evaluate(async () => {
    const r = (await navigator.serviceWorker.getRegistrations())[0];
    return { waiting: !!r.waiting, ready: !!window.AT3D.game.updates.ready };
  });
  check('[bad deploy] a missing / failing file also rejects the install', !bad2.waiting && !bad2.ready, bad2);
  const names = (await swState(page)).caches;
  check('[bad deploy] a failed install leaves no half-built cache behind', !Object.keys(names).some((n) => n.includes(d3.version) || n.includes(d3b.version)), Object.keys(names));

  // repaired deploy: the next check succeeds
  srv.state.blocked.clear();
  await page.evaluate(() => window.AT3D.game.updates.check());
  const fixed = await until(() => page.evaluate(() => !!window.AT3D.game.updates.ready), { timeout: 60000, label: 'repaired update ready' }).catch(() => false);
  check('[bad deploy] once the deploy is repaired the update goes through', !!fixed);
  await ctx.close();
  await srv.stop();
}

async function scenarioPurge(browser) {
  const dir = path.join(tmpRoot, 'site-purge');
  copyGame(dir);
  await deploy(dir, '9.4.0+{hash}');
  const srv = await createStaticServer({ root: dir, prefix: SUB }).start();
  const ctx = await browser.newContext();
  const page = await newPage(ctx, { xr: true });
  await page.goto(srv.base + QS);
  await waitBooted(page);
  await until(async () => (await swState(page)).active, { timeout: 60000, label: 'sw active' });
  await page.goto(srv.base + '?sw=0');
  await waitBooted(page);
  const gone = await until(async () => (await swState(page)).regs === 0, { timeout: 15000, label: 'purged' }).catch(() => false);
  const s = await swState(page);
  check('[purge] ?sw=0 unregisters the worker and deletes its caches', !!gone && Object.keys(s.caches).length === 0, s);
  await ctx.close();
  await srv.stop();
}

async function scenarioDevPolicy(browser) {
  // dev channel on localhost without ?sw=1 must NOT register (a stale worker must never serve old code to a developer)
  if (DIST) return;
  const dir = path.join(tmpRoot, 'site-dev');
  copyGame(dir);
  await deploy(dir, '9.5.0+{hash}');
  const srv = await createStaticServer({ root: dir, prefix: SUB }).start();
  const ctx = await browser.newContext();
  const page = await newPage(ctx, { xr: true });
  await page.goto(srv.base);
  await waitBooted(page);
  await sleep(2500);
  const s = await swState(page);
  check('[policy] dev channel on localhost does not register the worker without ?sw=1', s.regs === 0, s);
  await ctx.close();
  await srv.stop();
}

// ------------------------------------------------------------------------------------------------------------
const browser = await launch();
let code = 1;
try {
  console.log(`PWA test on ${DIST ? 'built game ' + DIST : 'source tree'} (scratch: ${tmpRoot})`);
  if (want('install')) {
    await scenarioInstallOffline('subpath', SUB, browser);
    await scenarioInstallOffline('root', '/', browser);
  }
  if (want('update')) await scenarioUpdate(browser);
  if (want('purge')) await scenarioPurge(browser);
  if (want('policy')) await scenarioDevPolicy(browser);
  code = finish();
} catch (err) {
  console.error('PWA test crashed:', err);
  check('PWA test ran to the end', false, String((err && err.message) || err));
  finish();
  code = 1;
} finally {
  await browser.close().catch(() => {});
}
process.exit(code);
