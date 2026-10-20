/* ABYSSAL TETHER 3D — earlyXR.js
 * Immersive-PWA launch (RELEASE §8, VRC.Quest.Performance.3).
 *
 * An installed immersive WebXR PWA has no 2D page: the app icon tap is the user activation, and the
 * page must ask for the XR session right after load and show head-tracked frames within 4 s. This module
 * is imported first by main.js, BEFORE game.js and the renderer are even parsed, so the request goes out
 * as early as possible, in parallel with the module downloads:
 *
 *   const early = startEarlyXR();           // requestSession() called synchronously here
 *   ...bootMinimal()...                      // renderer + input + loading scene
 *   game.enterVR()                           // InputManager.enter() calls navigator.xr.requestSession():
 *                                            // the wrapper installed here hands it the early session
 *
 * Nothing here needs three.js or the DOM beyond navigator / window (Node-testable with fakes).
 */
import { XR_OPTIONAL_FEATURES } from '../input/xrInput.js';

/**
 * How the app was launched.
 *  store       Digital Goods API present: the Store-installed PWA (Meta's pipeline uses this as its signal)
 *  standalone  display-mode standalone / fullscreen (installed PWA, TWA)
 *  forced      ?autovr=1 / ?autovr=0 (tests, kiosk)
 */
export function detectLaunchMode(win = typeof window !== 'undefined' ? window : null) {
  const out = { store: false, standalone: false, forced: null, immersiveApp: false };
  if (!win) return out;
  try {
    out.store = 'getDigitalGoodsService' in win;
  } catch {
    /* ignore */
  }
  try {
    const mm = typeof win.matchMedia === 'function' ? win.matchMedia.bind(win) : null;
    out.standalone = !!(mm && (mm('(display-mode: standalone)').matches || mm('(display-mode: fullscreen)').matches)) || !!(win.navigator && win.navigator.standalone);
  } catch {
    /* ignore */
  }
  try {
    const v = new URLSearchParams(win.location && win.location.search ? win.location.search : '').get('autovr');
    if (v === '1' || v === 'true') out.forced = true;
    else if (v === '0' || v === 'false') out.forced = false;
  } catch {
    /* ignore */
  }
  out.immersiveApp = out.forced === null ? out.store || out.standalone : out.forced;
  return out;
}

/**
 * Requests the immersive session at once when this launch looks like the installed immersive app (or is forced).
 * @returns {{mode:object, requested:boolean, startedAt:number, promise:Promise<object|null>|null, session:object|null,
 *            error:any, handedOver:boolean, restore:Function}}
 */
export function startEarlyXR({ win = typeof window !== 'undefined' ? window : null, nav = typeof navigator !== 'undefined' ? navigator : null } = {}) {
  const mode = detectLaunchMode(win);
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const early = { mode, requested: false, startedAt: now(), promise: null, session: null, error: null, handedOver: false, restore: () => {} };
  const xr = nav && nav.xr;
  if (!mode.immersiveApp || !xr || typeof xr.requestSession !== 'function') return early;
  if (win && win.isSecureContext === false) return early;

  const original = xr.requestSession;
  let request;
  try {
    request = original.call(xr, 'immersive-vr', { optionalFeatures: XR_OPTIONAL_FEATURES.slice() });
  } catch (err) {
    early.error = err;
    return early;
  }
  early.requested = true;
  early.promise = Promise.resolve(request).then(
    (session) => {
      early.session = session;
      early.sessionAt = now();
      return session;
    },
    (err) => {
      early.error = err;
      return null;
    },
  );

  // The InputManager asks for the session itself (xrInput.enter): give it ours, once.
  const wrapped = function requestSession(m, init) {
    if (!early.handedOver && m === 'immersive-vr') {
      early.handedOver = true;
      early.restore();
      return early.promise.then((session) => (session && !isEnded(session) ? session : original.call(xr, m, init)));
    }
    return original.call(xr, m, init);
  };
  const ownBefore = Object.prototype.hasOwnProperty.call(xr, 'requestSession');
  early.restore = () => {
    if (xr.requestSession !== wrapped) return;
    try {
      if (ownBefore) xr.requestSession = original;
      else delete xr.requestSession;
    } catch {
      /* leave the wrapper: it passes everything else through */
    }
  };
  try {
    xr.requestSession = wrapped;
  } catch {
    /* read-only: the game then requests its own session (needs activation) */
  }
  return early;
}

function isEnded(session) {
  // XRSession has no 'ended' flag; a visibilityState of 'hidden' is not final. Treat only an explicit marker.
  return !!(session && session.__ended);
}
