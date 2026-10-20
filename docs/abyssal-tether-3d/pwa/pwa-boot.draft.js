/* SUPERSEDED (2026-10-20, WP-RELEASE): adopted as src/platform/pwaBoot.js + earlyXR.js. Kept as design notes. */
/* ABYSSAL TETHER 3D: PWA boot helpers DRAFT (service worker, storage, immersive auto-start).
 *
 * Status: proposal, not wired in. Intended home once adopted: src/platform/pwaBoot.js, called
 * from src/main.js (owned by the game agent). See ../RELEASE.md sections "Immersive launch" and
 * "Service worker and offline strategy" for the reasoning and the VRCs involved.
 *
 * Intended call order in main.js (sketch):
 *
 *   const store = isStoreInstall();                // true only in the Store-installed PWA
 *   const game = new Game3D({...});
 *   await game.bootMinimal();                      // NEW split: renderer + input + in-VR loading panel only
 *   if (store) autoEnterVR(() => game.enterVR());  // ASAP: the icon tap is the user activation
 *   await game.bootContent();                      // textures, GLB, level, audio: AFTER the session started
 *   registerServiceWorker({ onUpdateReady: (apply) => game.ui.offerUpdate(apply) });
 *   requestPersistentStorage();
 */

/** The Digital Goods API only exists in the Store-installed PWA (Meta's own pipeline uses
 * this as the "am I the installed immersive app?" signal). Absent in tabs, desktop, emulator. */
export function isStoreInstall() {
  return typeof window !== 'undefined' && 'getDigitalGoodsService' in window;
}

/**
 * Immersive PWAs open with no 2D page: the app must request the session itself, right away
 * (Meta: "call the requestSession API right after the page is loaded"; the app-icon tap counts
 * as the user activation). Call this as early as the renderer can present, before loading
 * heavy assets, so head-tracked frames appear within 4 s (VRC.Quest.Performance.3).
 * `enter` must start navigator.xr.requestSession('immersive-vr', ...) synchronously-ish:
 * do not await network or asset work before it.
 */
export async function autoEnterVR(enter) {
  const xr = typeof navigator !== 'undefined' ? navigator.xr : null;
  if (!xr || typeof xr.isSessionSupported !== 'function') return false;
  try {
    if (!(await xr.isSessionSupported('immersive-vr'))) return false;
    const ok = await enter();
    return ok !== false;
  } catch {
    return false; // the game shows its own "Enter VR" button as the fallback
  }
}

/**
 * Registers sw.js (generated from sw.draft.js). onUpdateReady(apply) fires when a new build is
 * downloaded and waiting; call apply() ONLY from the main menu or outside an XR session: it
 * reloads the page, which ends any immersive session.
 */
export async function registerServiceWorker({ url = './sw.js', scope = './', onUpdateReady = null } = {}) {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return null;
  let reg;
  try {
    // updateViaCache 'none': the browser always revalidates sw.js itself (pairs with no-cache headers).
    reg = await navigator.serviceWorker.register(url, { scope, type: 'classic', updateViaCache: 'none' });
  } catch {
    return null; // the game works without it (online only)
  }
  const notify = () => {
    if (reg.waiting && navigator.serviceWorker.controller && typeof onUpdateReady === 'function') {
      onUpdateReady(() => applyUpdateNow(reg));
    }
  };
  notify();
  reg.addEventListener('updatefound', () => {
    const sw = reg.installing;
    if (!sw) return;
    sw.addEventListener('statechange', () => {
      if (sw.state === 'installed') notify();
    });
  });
  return reg;
}

/** Activates the waiting worker and reloads once it controls the page. */
export function applyUpdateNow(reg) {
  if (!reg || !reg.waiting) return false;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

/** Asks the browser not to evict our caches/localStorage under storage pressure
 * (protects settings, records and the offline copy: VRC.Quest.Functional.4). */
export async function requestPersistentStorage() {
  try {
    if (!navigator.storage || typeof navigator.storage.persist !== 'function') return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

/** { usageMB, quotaMB, persisted } for the debug overlay / support screen. */
export async function storageReport() {
  try {
    const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate() : {};
    const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const mb = (b) => (typeof b === 'number' ? Math.round((b / 1048576) * 10) / 10 : null);
    return { usageMB: mb(est.usage), quotaMB: mb(est.quota), persisted };
  } catch {
    return { usageMB: null, quotaMB: null, persisted: false };
  }
}

/** Build version reported by the active service worker (shown in Settings > About). */
export function serviceWorkerVersion(timeoutMs = 1500) {
  return new Promise((resolve) => {
    const ctl = typeof navigator !== 'undefined' && navigator.serviceWorker ? navigator.serviceWorker.controller : null;
    if (!ctl) return resolve(null);
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve(null), timeoutMs);
    ch.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data && e.data.version ? e.data.version : null);
    };
    ctl.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
  });
}

/** Prefetches lazy-tier files (e.g. chapter packs once the full game is owned). */
export function warmChapterPack(urls, timeoutMs = 120000) {
  return new Promise((resolve) => {
    const ctl = typeof navigator !== 'undefined' && navigator.serviceWorker ? navigator.serviceWorker.controller : null;
    if (!ctl || !Array.isArray(urls) || !urls.length) return resolve({ warmed: 0 });
    const ch = new MessageChannel();
    const timer = setTimeout(() => resolve({ warmed: 0, timeout: true }), timeoutMs);
    ch.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(e.data || { warmed: 0 });
    };
    ctl.postMessage({ type: 'WARM', urls }, [ch.port2]);
  });
}
