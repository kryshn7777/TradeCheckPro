/* ABYSSAL TETHER 3D — main.js
 * Bootstrap: creates the Game3D, installs the window.AT3D debug API
 * (contract §8) before boot so tests can poll it, boots, and turns any boot
 * failure into a readable overlay instead of a black page.
 */
import { Game3D, showFatal } from './game.js';

function setBootMessage(text) {
  const el = document.getElementById('boot-msg');
  if (el) el.textContent = text;
}

function hideBoot() {
  const el = document.getElementById('boot');
  if (!el) return;
  el.classList.add('is-done');
  // Remove after the fade so it never intercepts input.
  setTimeout(() => {
    if (el.parentNode) el.parentNode.removeChild(el);
  }, 700);
}

function bootstrap() {
  let game = null;
  try {
    game = new Game3D({
      container: document.getElementById('stage'),
      uiRoot: document.getElementById('ui-root'),
    });
    window.AT3D = { game, debug: game.debugApi() };
  } catch (err) {
    showFatal(err);
    return;
  }
  setBootMessage('Lowering the lantern…');
  game
    .boot()
    .then(() => {
      document.body.classList.remove('is-loading');
      hideBoot();
    })
    .catch((err) => {
      try {
        game._stopLoop();
      } catch {
        /* never started */
      }
      showFatal(err);
    });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
else bootstrap();
