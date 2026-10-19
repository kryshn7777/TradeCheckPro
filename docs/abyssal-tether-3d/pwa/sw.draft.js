/* ABYSSAL TETHER 3D: service worker DRAFT (not live).
 *
 * Status: proposal for the Meta Horizon Store build (see ../RELEASE.md, "Service worker and
 * offline strategy"). Nothing registers this file today. To ship it:
 *   1. node gen-precache.mjs --root <deployed game dir> --template sw.draft.js \
 *        --out <deployed game dir>/sw.js --version <semver+build>
 *      (writes the precache list between the @@PRECACHE markers below into a NEW file; it
 *      never edits this draft or the game sources),
 *   2. register it from src/main.js (see pwa-boot.draft.js),
 *   3. serve sw.js with "Cache-Control: no-cache" (see _headers.draft).
 *
 * Strategy (one versioned, atomic build per cache):
 *   - core  : precached at install time. App shell, all code, Chapter 1 assets. Install fails
 *             (and is retried next launch) unless every core file downloads, so a player never
 *             runs half of one build and half of another.
 *   - lazy  : listed with a revision but NOT downloaded at install. Cache-first at runtime,
 *             filled on first use or warmed on request (WARM message), e.g. a chapter pack the
 *             player just unlocked. Unchanged lazy files are carried over between versions.
 *   - Files whose revision did not change are copied from the previous version's cache
 *     instead of being downloaded again (cheap updates even when assets grow to 100+ MB).
 *     Every downloaded file is checked against its SHA-256 revision, so a half-finished deploy
 *     or a stale CDN copy fails the install (retried later) instead of poisoning the cache.
 *   - Navigations inside the scope are served from the cached app shell (fast cold start,
 *     helps VRC.Quest.Performance.3, works offline). A new build reaches the player on the
 *     launch after it was downloaded, or immediately via SKIP_WAITING from the main menu.
 *   - Cross-origin requests, non-GET requests, Range requests and anything outside the scope
 *     are never touched (Meta billing, payment dialogs and platform calls go straight through).
 *
 * Only `self.*` globals are used so the repo's ESLint browser config accepts this file.
 */

const PRECACHE = /* @@PRECACHE_START@@ */ {
  version: 'dev',
  shell: 'index.html',
  core: [{ url: 'index.html', rev: 'dev' }],
  lazy: [],
} /* @@PRECACHE_END@@ */;

const SCOPE = new URL(self.registration.scope);
const abs = (rel) => new URL(rel, SCOPE).href;

// Cache names carry the scope path so a staging build (e.g. /beta/) and the production build on
// the same origin never delete each other's caches when they activate.
const PREFIX = `at3d${SCOPE.pathname}:`;
const CORE_CACHE = `${PREFIX}core-${PRECACHE.version}`;
const LAZY_CACHE = `${PREFIX}lazy-${PRECACHE.version}`;
const REVS_KEY = '__at3d_revs__.json'; // per-cache {url: rev} map, stored inside the cache itself
const INSTALL_CONCURRENCY = 6;

const CORE = new Map(PRECACHE.core.map((e) => [abs(e.url), e.rev]));
const LAZY = new Map(PRECACHE.lazy.map((e) => [abs(e.url), e.rev]));
const SHELL_URL = abs(PRECACHE.shell || 'index.html');

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Abyssal Tether</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#08090a;color:#e8dcc0;
font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px}button{margin-top:16px;padding:10px 18px;
background:#1b1f20;color:#e8dcc0;border:1px solid #3a4244;border-radius:6px;font:inherit}</style></head>
<body><main><h1>Abyssal Tether</h1><p>An internet connection is needed the first time the game starts,
so it can download the descent. After that it plays offline.</p>
<button onclick="location.reload()">Try again</button></main></body></html>`;

// ---------------------------------------------------------------------------
// Install: build this version's core cache, reusing unchanged files.
// ---------------------------------------------------------------------------

self.addEventListener('install', (event) => {
  event.waitUntil(
    installCore().catch(async (err) => {
      // Leave nothing half-built behind; the browser retries the install on a later launch.
      await Promise.all([caches.delete(CORE_CACHE), caches.delete(LAZY_CACHE)]);
      throw err;
    }),
  );
  // No skipWaiting() here: never swap code under a running XR session. The page asks for it
  // (SKIP_WAITING) when it is safe, or the new worker activates on the next cold launch.
});

async function installCore() {
  const target = await caches.open(CORE_CACHE);
  const previous = await previousCaches();
  const revs = {};
  const jobs = [];
  for (const [url, rev] of CORE) jobs.push(() => copyOrFetch(url, rev, target, previous).then(() => (revs[url] = rev)));
  await runLimited(jobs, INSTALL_CONCURRENCY);
  await writeRevs(target, revs);

  // Carry unchanged lazy files forward without touching the network.
  const lazyTarget = await caches.open(LAZY_CACHE);
  const lazyRevs = {};
  for (const [url, rev] of LAZY) {
    const hit = await findPrevious(url, rev, previous);
    if (hit) {
      await lazyTarget.put(url, hit);
      lazyRevs[url] = rev;
    }
  }
  await writeRevs(lazyTarget, lazyRevs);
}

/** Older at3d-* caches with their revision maps, newest first is not required. */
async function previousCaches() {
  const names = (await caches.keys()).filter((n) => n.startsWith(PREFIX) && n !== CORE_CACHE && n !== LAZY_CACHE);
  const out = [];
  for (const name of names) {
    const cache = await caches.open(name);
    out.push({ cache, revs: await readRevs(cache) });
  }
  return out;
}

async function findPrevious(url, rev, previous) {
  for (const p of previous) {
    if (p.revs[url] !== rev) continue;
    const res = await p.cache.match(url);
    if (res) return res;
  }
  return null;
}

async function copyOrFetch(url, rev, target, previous) {
  const old = await findPrevious(url, rev, previous);
  if (old) return target.put(url, old);
  return target.put(url, await fetchVerified(url, rev));
}

/**
 * Downloads one file and checks it is the exact build the list was generated from (first 16 hex
 * chars of its SHA-256 == rev). A half-finished upload or a stale CDN edge would otherwise put
 * the wrong bytes under the right revision and keep them until that file changes again; here
 * the install fails instead and is retried on a later launch.
 */
async function fetchVerified(url, rev) {
  // cache: 'reload' bypasses the HTTP cache so a stale browser copy cannot sneak into a build.
  const res = await fetch(new Request(url, { cache: 'reload', credentials: 'same-origin' }));
  if (!res.ok || res.type !== 'basic') throw new Error(`precache failed ${res.status} ${url}`);
  const digest = await crypto.subtle.digest('SHA-256', await res.clone().arrayBuffer());
  const hex = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.slice(0, rev.length) !== rev) throw new Error(`precache integrity mismatch ${url}`);
  return res;
}

async function readRevs(cache) {
  try {
    const res = await cache.match(abs(REVS_KEY));
    return res ? await res.json() : {};
  } catch {
    return {};
  }
}

function writeRevs(cache, revs) {
  return cache.put(abs(REVS_KEY), new Response(JSON.stringify(revs), { headers: { 'Content-Type': 'application/json' } }));
}

/** Runs jobs `limit` at a time. After the first failure no new job starts, and the error is
 * thrown only once every in-flight job has settled, so cleanup never races a late cache.put(). */
async function runLimited(jobs, limit) {
  let i = 0;
  let failure = null;
  const worker = async () => {
    while (i < jobs.length && !failure) {
      const job = jobs[i++];
      try {
        await job();
      } catch (err) {
        failure = failure || err;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, jobs.length) }, worker));
  if (failure) throw failure;
}

// ---------------------------------------------------------------------------
// Activate: drop caches from other versions. (No navigation preload: the shell is cache-first,
// so a preload request would be wasted bandwidth on every launch.)
// ---------------------------------------------------------------------------

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([CORE_CACHE, LAZY_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith(PREFIX) && !keep.has(n)).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

// ---------------------------------------------------------------------------
// Fetch routing.
// ---------------------------------------------------------------------------

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // payments, platform calls: untouched
  if (req.headers.has('range')) return; // media range requests: let the browser handle them
  const url = new URL(req.url);
  if (url.origin !== SCOPE.origin || !url.href.startsWith(SCOPE.href)) return; // outside our scope
  if (url.pathname.endsWith('/sw.js')) return;

  if (req.mode === 'navigate') {
    event.respondWith(handleNavigation(req));
    return;
  }
  const key = url.origin + url.pathname; // precache keys ignore the query string (?v=, cache busters)
  if (CORE.has(key)) {
    event.respondWith(cacheFirst(CORE_CACHE, key, req));
    return;
  }
  if (LAZY.has(key)) {
    event.respondWith(lazyCacheFirst(key, req));
    return;
  }
  // Unknown same-origin file (not part of this build): network, then any cached copy.
  event.respondWith(fetch(req).catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || Response.error())));
});

async function handleNavigation(req) {
  // App shell first: same build as the cached code, instant even with no network.
  // Every navigation inside the scope gets the shell, so keep other HTML pages (privacy
  // policy, support) OUTSIDE the game's scope.
  const shell = await caches.match(SHELL_URL, { cacheName: CORE_CACHE });
  if (shell) return shell;
  // Shell missing (cache evicted): network, then the offline notice (VRC.Quest.Functional.7).
  try {
    return await fetch(req);
  } catch {
    return new Response(OFFLINE_HTML, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
}

async function cacheFirst(cacheName, key, req) {
  const hit = await caches.match(key, { cacheName });
  if (hit) return hit;
  // Core cache missing an entry (evicted, or worker still installing): go to the network.
  return fetch(req);
}

async function lazyCacheFirst(key, req) {
  const cache = await caches.open(LAZY_CACHE);
  const hit = await cache.match(key);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok && res.type === 'basic') {
    await cache.put(key, res.clone());
    await markLazy(cache, [key]);
  }
  return res;
}

let lazyRevsQueue = Promise.resolve();
function markLazy(cache, keys) {
  // Serialise read-modify-write of the revision map.
  lazyRevsQueue = lazyRevsQueue.then(async () => {
    const revs = await readRevs(cache);
    for (const k of keys) revs[k] = LAZY.get(k);
    await writeRevs(cache, revs);
  });
  return lazyRevsQueue;
}

// ---------------------------------------------------------------------------
// Messages from the page (see pwa-boot.draft.js).
// ---------------------------------------------------------------------------

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  const reply = (data) => event.ports && event.ports[0] && event.ports[0].postMessage(data);
  if (msg.type === 'GET_VERSION') {
    reply({ version: PRECACHE.version });
  } else if (msg.type === 'SKIP_WAITING') {
    // Sent only from the main menu / outside an XR session.
    self.skipWaiting();
  } else if (msg.type === 'WARM' && Array.isArray(msg.urls)) {
    // Prefetch lazy files (e.g. a chapter pack after the full game is unlocked).
    event.waitUntil(warm(msg.urls).then(reply, (err) => reply({ error: String(err) })));
  }
});

async function warm(relUrls) {
  const cache = await caches.open(LAZY_CACHE);
  const done = [];
  for (const rel of relUrls) {
    const key = abs(rel);
    if (!LAZY.has(key) || (await cache.match(key))) continue;
    try {
      await cache.put(key, await fetchVerified(key, LAZY.get(key)));
      done.push(key);
    } catch {
      /* skip this file; it will be fetched on first use instead */
    }
  }
  if (done.length) await markLazy(cache, done);
  return { warmed: done.length };
}
