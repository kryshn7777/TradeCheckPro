/* ABYSSAL TETHER 3D — main.js
 * Bootstrap. Order matters for the installed immersive PWA (RELEASE §8, VRC.Quest.Performance.3):
 *
 *   1. platform/earlyXR.js is the only thing imported statically: when this launch is the installed immersive app
 *      (Store install, standalone display mode, or ?autovr=1) it calls navigator.xr.requestSession() RIGHT HERE,
 *      before game.js is even parsed (the app-icon tap is the user activation).
 *   2. game.js loads, Game3D.bootMinimal() builds the renderer + input + the loading scene and starts the loop.
 *   3. the early session is handed to the InputManager (game.enterVR) -> head-tracked frames of the loading scene.
 *   4. Game3D.bootContent() loads the heavy content behind it; the menu appears in VR when it is done.
 * A desktop or Quest Browser tab skips step 3 and keeps the DOM loader + the Enter VR button.
 *
 * The window.AT3D debug API (contract §8) is installed before boot so tests can poll it; a boot failure becomes a
 * readable overlay instead of a black page.
 */
import { startEarlyXR } from './platform/earlyXR.js';

const early = startEarlyXR();
const T_START = typeof performance !== 'undefined' ? performance.now() : 0;

const $ = (id) => document.getElementById(id);

function setBootMessage(text) {
  const el = $('boot-msg');
  if (el) el.textContent = text;
}

function hideBoot() {
  const el = $('boot');
  if (!el) return;
  el.classList.add('is-done');
  // Remove after the fade so it never intercepts input.
  setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 700);
}

/** Used when game.js itself cannot load (showFatal lives there). */
function plainFatal(err) {
  setBootMessage('The descent could not begin: ' + ((err && err.message) || String(err)));
  const actions = $('boot-actions');
  const b = $('boot-enter-vr');
  if (actions && b) {
    b.textContent = 'Reload';
    b.onclick = () => window.location.reload();
    const flat = $('boot-flat');
    if (flat) flat.hidden = true;
    actions.hidden = false;
  }
}

/** The installed app could not start the session itself: offer it as a real click (a valid user activation). */
function offerEnterVR(game) {
  const actions = $('boot-actions');
  const enter = $('boot-enter-vr');
  const flat = $('boot-flat');
  if (!actions || !enter || !flat) return Promise.resolve('flat');
  actions.hidden = false;
  setBootMessage('Ready.');
  return new Promise((resolve) => {
    enter.onclick = async () => {
      enter.disabled = true;
      const ok = await game.enterVR();
      enter.disabled = false;
      if (ok) resolve('vr');
    };
    flat.onclick = () => resolve('flat');
    enter.focus({ preventScroll: true });
  });
}

async function bootstrap() {
  let game = null;
  let mod = null;
  try {
    mod = await import('./game.js');
  } catch (err) {
    plainFatal(err);
    return;
  }
  const { Game3D, showFatal } = mod;
  try {
    game = new Game3D({
      container: $('stage'),
      uiRoot: $('ui-root'),
      immersiveApp: early.mode.immersiveApp,
    });
    window.AT3D = {
      game,
      debug: game.debugApi(),
      early: { mode: early.mode, requested: early.requested, startedAt: early.startedAt, t0: T_START },
    };
  } catch (err) {
    showFatal(err);
    return;
  }
  setBootMessage('Lowering the lantern…');
  try {
    await game.bootMinimal();
    // Immersive launch: enter VR now, in parallel with the heavy content (never awaited before bootContent).
    let vrPromise = null;
    if (early.requested) {
      vrPromise = early.promise.then(async (session) => (session ? game.enterVR() : false));
    }
    await game.bootContent();
    document.body.classList.remove('is-loading');
    let inVR = false;
    if (vrPromise) inVR = !!(await vrPromise);
    if (early.mode.immersiveApp && !inVR && !game.xrActive && (await game.isVRSupported())) {
      await offerEnterVR(game); // the 2D page of an installed app: a real button is the only way in
    }
    hideBoot();
    startPlatformServices(game);
  } catch (err) {
    try {
      game._stopLoop();
    } catch {
      /* never started */
    }
    showFatal(err);
  }
}

/** After the menu is up: service worker, persistent storage, desktop perf safety net. All optional. */
function startPlatformServices(game) {
  // Desktop perf safety net (GPU warning, adaptive resolution, ?perf overlay); optional.
  import('./ui/perfDiag.js')
    .then((m) => m.installPerfDiag(game))
    .catch(() => {});
  import('./platform/pwaBoot.js')
    .then(async (pwa) => {
      pwa.requestPersistentStorage().then((persisted) => (game.persisted = persisted));
      const updates = await pwa.registerServiceWorker({
        isXRActive: () => game.xrActive,
        onUpdateReady: (u) => game.bus.emit('app:update-ready', { apply: () => u.apply() }),
      });
      game.updates = updates;
      game.bus.emit('app:pwa', { policy: updates.policy, registered: updates.registered });
    })
    .catch(() => {});
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
else bootstrap();
