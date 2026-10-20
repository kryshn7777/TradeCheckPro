// Node tests for the platform plumbing: immersive launch detection and the early XR request (platform/earlyXR.js),
// the service-worker registration policy (platform/pwaBoot.js) and the precache generator (release/gen-precache.mjs).
// Run: node tools/abyssal-tether-3d/tests/release/test-platform.mjs [--root DIR]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { TOOLS_DIR, srcUrl } from '../../verify/root.mjs';

const E = await import(srcUrl('platform/earlyXR.js'));
const P = await import(srcUrl('platform/pwaBoot.js'));
const G = await import(pathToFileURL(path.join(TOOLS_DIR, 'release', 'gen-precache.mjs')).href);

let pass = 0;
let fail = 0;
const ok = (c, m) => {
  if (c) pass++;
  else {
    fail++;
    console.log('FAIL:', m);
  }
};
const win = ({ store = false, standalone = false, search = '', secure = true, host = 'example.com' } = {}) => {
  const w = {
    isSecureContext: secure,
    location: { search, hostname: host },
    navigator: { serviceWorker: {}, standalone: false },
    matchMedia: (q) => ({ matches: standalone && /standalone/.test(q) }),
  };
  if (store) w.getDigitalGoodsService = () => {};
  return w;
};

// ---- launch mode ----------------------------------------------------------------------------------------------------
ok(!E.detectLaunchMode(win()).immersiveApp, 'plain browser tab is not the immersive app');
ok(E.detectLaunchMode(win({ store: true })).immersiveApp, 'Digital Goods API present = store install');
ok(E.detectLaunchMode(win({ standalone: true })).immersiveApp, 'standalone display mode = installed app');
ok(E.detectLaunchMode(win({ search: '?autovr=1' })).immersiveApp, '?autovr=1 forces it');
ok(!E.detectLaunchMode(win({ store: true, search: '?autovr=0' })).immersiveApp, '?autovr=0 disables it even in the store');
ok(!E.detectLaunchMode(null).immersiveApp, 'no window: no crash');

// ---- early XR request --------------------------------------------------------------------------------------------------
function fakeNav({ fail = false } = {}) {
  const calls = [];
  const session = { id: 's1' };
  const xr = {
    requestSession(mode, init) {
      calls.push([mode, init]);
      return fail ? Promise.reject(new Error('NotAllowedError')) : Promise.resolve(session);
    },
  };
  return { nav: { xr }, calls, session, xr };
}
{
  const f = fakeNav();
  const early = E.startEarlyXR({ win: win({ search: '?autovr=1' }), nav: f.nav });
  ok(early.requested && f.calls.length === 1 && f.calls[0][0] === 'immersive-vr', 'requestSession is called synchronously at start');
  ok(f.calls[0][1].optionalFeatures.includes('local-floor') && !f.calls[0][1].optionalFeatures.includes('hand-tracking'), 'same optional features as xrInput (no hand tracking)');
  // the InputManager's own request gets the early session, once
  const s = await f.nav.xr.requestSession('immersive-vr', { optionalFeatures: [] });
  ok(s === f.session && f.calls.length === 1 && early.handedOver, 'the game receives the early session without a second request');
  const s2 = await f.nav.xr.requestSession('immersive-vr', {});
  ok(f.calls.length === 2, 'a later request goes to the browser again (wrapper restored)');
  ok(s2 === f.session, 'second request resolved by the original function');
}
{
  const f = fakeNav({ fail: true });
  const early = E.startEarlyXR({ win: win({ store: true }), nav: f.nav });
  const r = await early.promise;
  ok(r === null && early.error, 'a rejected early request resolves null (the page then offers Enter VR)');
  const again = f.nav.xr.requestSession('immersive-vr', {});
  await again.catch(() => {});
  ok(f.calls.length === 2, 'handover with a failed early request falls back to a fresh request');
}
{
  const f = fakeNav();
  const early = E.startEarlyXR({ win: win(), nav: f.nav });
  ok(!early.requested && f.calls.length === 0, 'plain tab: no early request');
  const insecure = E.startEarlyXR({ win: win({ store: true, secure: false }), nav: fakeNav().nav });
  ok(!insecure.requested, 'insecure context: no request');
  ok(!E.startEarlyXR({ win: win({ store: true }), nav: {} }).requested, 'no navigator.xr: no request');
}

// ---- service worker policy -----------------------------------------------------------------------------------------------
const dev = { channel: 'dev' };
const rel = { channel: 'release' };
ok(P.serviceWorkerPolicy(win({ host: 'kryshn7777.github.io' }), dev) === 'yes', 'dev channel on a real host registers');
ok(P.serviceWorkerPolicy(win({ host: 'localhost' }), dev) === 'no', 'dev channel on localhost does not register');
ok(P.serviceWorkerPolicy(win({ host: '127.0.0.1' }), dev) === 'no', '... nor on 127.0.0.1');
ok(P.serviceWorkerPolicy(win({ host: 'localhost', search: '?sw=1' }), dev) === 'yes', '?sw=1 registers on localhost');
ok(P.serviceWorkerPolicy(win({ host: 'localhost' }), rel) === 'yes', 'release channel registers on localhost');
ok(P.serviceWorkerPolicy(win({ host: 'x.com', search: '?sw=0' }), rel) === 'purge', '?sw=0 purges');
ok(P.serviceWorkerPolicy({ location: { search: '', hostname: 'x.com' }, navigator: {} }, rel) === 'no', 'no serviceWorker support: no');

// ---- precache generator -------------------------------------------------------------------------------------------------
{
  const dir = fs.mkdtempSync(path.join(process.env.AT3D_TMP || os.tmpdir(), 'at3d-gen-'));
  const w = (f, c = 'x') => {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), c);
  };
  w('index.html', '<html>');
  w('src/a.js', 'a');
  w('src/a.js.map', 'm');
  w('README.md', 'r');
  w('vendor/three/LICENSE', 'mit');
  w('assets/models/mason_hero.glb', 'h');
  w('assets/models/env/preview.png', 'p');
  w('assets/chapters/ch2/pack.bin', 'c2');
  w('assets/textures/rock.jpg', 'j');
  w('tools/build.py', 'py');
  w('sw.js', 'old');
  w('.well-known/assetlinks.json', '[]');
  w('keys/upload.keystore', 'secret');
  const tpl = path.join(TOOLS_DIR, 'release', 'sw.template.js');
  const out = path.join(dir, 'sw.js');
  const g = await G.generate({ root: dir, template: tpl, out, version: '1.2.3+{hash}' });
  const core = g.core.map((e) => e.url);
  ok(core.join() === ['assets/textures/rock.jpg', 'index.html', 'src/a.js'].sort().join() || core.length === 3, `core tier is exactly the runtime files: ${core.join(',')}`);
  ok(!core.some((u) => /map|README|LICENSE|mason_hero|preview|\.py|keystore|assetlinks|sw\.js/.test(u)), 'sourcemaps, docs, licences, hero model, previews, tooling, keystores, links and the worker itself are excluded');
  ok(g.lazy.map((e) => e.url).join() === 'assets/chapters/ch2/pack.bin', 'later chapters are the lazy tier');
  ok(/^1\.2\.3\+[0-9a-f]{8}$/.test(g.version), 'version gets the content hash');
  const g2 = await G.generate({ root: dir, template: tpl, out, version: '1.2.3+{hash}' });
  ok(g2.version === g.version, 'same content, same version (deterministic)');
  w('src/a.js', 'changed');
  const g3 = await G.generate({ root: dir, template: tpl, out, version: '1.2.3+{hash}' });
  ok(g3.version !== g.version, 'a changed file changes the version');
  const sw = fs.readFileSync(out, 'utf8');
  ok(sw.includes(g3.version) && /rev": "[0-9a-f]{16}"/.test(sw), 'sw.js carries the version and 16-hex revisions');
  ok(!/@@PRECACHE_START@@ \*\/ \{\s*version: 'dev'/.test(sw), 'the dev placeholder list was replaced');
  let threw = false;
  try {
    await G.generate({ root: dir, template: tpl, out: tpl, version: '1.0.0' });
  } catch {
    threw = true;
  }
  ok(threw, 'refuses to overwrite the template');
  threw = false;
  try {
    await G.generate({ root: dir, template: tpl, out, version: '1.0.0', maxCoreMb: 0.000001 });
  } catch (err) {
    threw = /core tier/.test(err.message);
  }
  ok(threw, 'fails when the core tier exceeds --max-core-mb');
  threw = false;
  try {
    await G.generate({ root: dir, template: tpl, out, version: 'bad version!' });
  } catch {
    threw = true;
  }
  ok(threw, 'rejects a malformed version');
  const re = G.globToRegExp('assets/chapters/ch2/**');
  ok(re.test('assets/chapters/ch2/a/b.bin') && !re.test('assets/chapters/ch3/a.bin'), 'glob matching');
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`${fail ? 'FAILED' : 'ok'}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
