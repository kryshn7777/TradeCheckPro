/* ABYSSAL TETHER 3D — resilience.js (VRC.Quest.Functional.1 / .2 / .4)
 * Keeps a run alive through the things a headset does to a web page:
 *
 *  1. WebGL context loss / restore.  three.js re-creates every GPU object by itself after 'webglcontextrestored'
 *     (new property maps, programs and buffers are rebuilt on next use). What it cannot do is protect the run:
 *     frames render nothing while the context is gone. So: the moment the context is lost the run is PAUSED (the
 *     pause menu is up, nothing advances, no death behind a black screen), the save is flushed, and a notice
 *     shows; on restore every shader program is compiled again behind the pause panel (no hitch on resume), the
 *     frame clock is reset, and the player resumes from the pause menu exactly where they were. If the context
 *     does not come back within RESTORE_TIMEOUT_MS a 'Reload' panel is offered; the checkpoint is saved, so
 *     Continue brings the run back.
 *  2. XR session end / reconnect.  When the OS or the browser ends the immersive session while the app is open
 *     (not through our own exitVR), the run is already paused by Game3D._onXREnd; in an installed immersive app
 *     (no 2D page to fall back on) a 'Return to VR' panel is shown. Its button is a real DOM click, i.e. a valid
 *     user activation for requestSession. The play session resumes in the pause menu.
 *  3. Focus / visibility.  Game3D already pauses on visibilitychange / blur / pagehide / XR visibility. Here:
 *     the 'freeze' event (page frozen by the browser), 'pageshow' from the back/forward cache, and a watchdog that
 *     pauses if frames stop arriving while the page claims to be visible (a stuck compositor).
 *
 * Debug / test hooks (window.AT3D.debug.platform): loseContext(), restoreContext() use WEBGL_lose_context.
 * Events on the game bus: 'gl:lost', 'gl:restored', 'gl:failed', 'xr:ended-unexpected', 'app:resumed'.
 */

export const RESTORE_TIMEOUT_MS = 8000;
const WATCHDOG_MS = 4000;

function el(tag, css, text) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (text) e.textContent = text;
  return e;
}

const PANEL_CSS =
  'position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:24px;' +
  'background:rgba(8,10,11,0.88);color:#e8dcc0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center;';
const BTN_CSS =
  'min-width:160px;min-height:48px;margin-top:18px;padding:10px 22px;border:1px solid #e0a050;background:#1b1f20;' +
  'color:#e8dcc0;font:inherit;cursor:pointer;border-radius:4px;';

export class Resilience {
  constructor(game, { immersiveApp = false } = {}) {
    this.game = game;
    this.immersiveApp = immersiveApp;
    this.contextLost = false;
    this.lostAt = 0;
    this.lostCount = 0;
    this.restoredCount = 0;
    this.pausedByUs = false;
    this.exitRequested = false;
    this._panel = null;
    this._timer = 0;
    this._wdTimer = 0;
    this._lastFrameAt = 0;
    this._canvas = null;
    this._offs = [];
    this._loseExt = null;
  }

  install() {
    const g = this.game;
    const r = g.renderer && g.renderer.renderer;
    const canvas = r && r.domElement;
    if (canvas) {
      this._canvas = canvas;
      const lost = (e) => this._onLost(e);
      const restored = () => this._onRestored();
      // capture + not passive: we also want to see the event three.js sees (it calls preventDefault itself, but a
      // stand-in renderer might not: without preventDefault the browser never restores the context)
      canvas.addEventListener('webglcontextlost', lost, false);
      canvas.addEventListener('webglcontextrestored', restored, false);
      this._offs.push(() => {
        canvas.removeEventListener('webglcontextlost', lost, false);
        canvas.removeEventListener('webglcontextrestored', restored, false);
      });
    }
    if (typeof document !== 'undefined') {
      const freeze = () => this._pauseRun('freeze');
      const pageshow = (e) => {
        if (e && e.persisted) {
          g._lastTs = null;
          g.bus.emit('app:resumed', { from: 'bfcache' });
        }
      };
      document.addEventListener('freeze', freeze);
      window.addEventListener('pageshow', pageshow);
      this._offs.push(() => {
        document.removeEventListener('freeze', freeze);
        window.removeEventListener('pageshow', pageshow);
      });
    }
    // XR: unexpected end -> Return to VR (installed immersive app)
    this._offs.push(
      g.bus.on('game:xr', (e) => {
        if (e.active) {
          this.exitRequested = false;
          this._hidePanel('xr');
        } else this._onXRClosed();
      }),
    );
    // frame watchdog (visible page, XR or not, but no frames)
    this._wdTimer = setInterval(() => this._watchdog(), WATCHDOG_MS);
    return this;
  }

  /** Called by Game3D.exitVR() so a deliberate exit does not raise the reconnect panel. */
  markExitRequested() {
    this.exitRequested = true;
  }

  /** Per-frame heartbeat (Game3D._loop). */
  heartbeat(nowMs) {
    this._lastFrameAt = nowMs;
  }

  _watchdog() {
    const g = this.game;
    if (typeof document === 'undefined' || document.hidden || this.contextLost || !g._running || g._override || g._frozen) return;
    if (g.xrActive && g._xrSession && g._xrSession.visibilityState !== 'visible') return;
    if (!this._lastFrameAt) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - this._lastFrameAt > WATCHDOG_MS * 2 && g.state === 'playing') {
      // frames stopped arriving while the run is live: pause, so nothing can happen unseen
      this._pauseRun('stalled');
    }
  }

  _pauseRun(why) {
    const g = this.game;
    if (g.state === 'playing') {
      g.pause();
      this.pausedByUs = true;
    }
    try {
      g.save && g.save.flush && g.save.flush({ sync: true });
    } catch {
      /* ignore */
    }
    g.bus.emit('app:paused', { why });
  }

  // ---- WebGL context ----------------------------------------------------------------------------------------------
  _onLost(e) {
    if (e && typeof e.preventDefault === 'function') e.preventDefault(); // required for the browser to restore it
    const g = this.game;
    this.contextLost = true;
    this.lostAt = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.lostCount++;
    g.contextLost = true;
    this._pauseRun('gl-lost');
    g.bus.emit('gl:lost', { count: this.lostCount });
    this._showPanel('gl', 'The graphics were interrupted.', 'Restoring the dark. Your run is paused and saved.', null);
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      if (!this.contextLost) return;
      g.bus.emit('gl:failed', {});
      this._showPanel('gl', 'The graphics could not be restored.', 'Your checkpoint is saved. Reload to continue the descent.', 'Reload', () => window.location.reload());
    }, RESTORE_TIMEOUT_MS);
  }

  _onRestored() {
    const g = this.game;
    clearTimeout(this._timer);
    this.contextLost = false;
    this.restoredCount++;
    g.contextLost = false;
    g._lastTs = null; // no giant dt after the gap
    g._acc = 0;
    // three.js has already re-initialised its GL state. Compile every program again NOW, behind the pause panel,
    // and let the textures re-upload on the first rendered frames (precompile also calls initTexture).
    try {
      g._precompile();
    } catch (err) {
      g._fault && g._fault('renderer', err);
    }
    this._hidePanel('gl');
    g.bus.emit('gl:restored', { count: this.restoredCount, lostForMs: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - this.lostAt) });
    g._toast && g._toast('Graphics restored.', 2.5);
  }

  // ---- XR session end -----------------------------------------------------------------------------------------------
  _onXRClosed() {
    const g = this.game;
    if (this.exitRequested) {
      this.exitRequested = false;
      return;
    }
    g.bus.emit('xr:ended-unexpected', {});
    if (!this.immersiveApp) return; // a browser tab / desktop still has its own Enter VR button
    this._showPanel('xr', 'The headset session ended.', 'Your run is paused. Put the headset back on and return to the descent.', 'Return to VR', async () => {
      this._hidePanel('xr');
      const ok = await g.enterVR();
      if (!ok) this._showPanel('xr', 'VR could not start.', 'Check that the headset is on and try again.', 'Return to VR', () => this._retryVR());
    });
  }

  _retryVR() {
    this._onXRClosed();
  }

  // ---- panel ----------------------------------------------------------------------------------------------------
  _showPanel(kind, title, text, buttonLabel, onButton) {
    if (typeof document === 'undefined' || !document.body) return;
    this._hidePanel(kind === 'gl' ? 'gl' : 'xr');
    const box = el('div', PANEL_CSS);
    box.id = `at3d-panel-${kind}`;
    box.setAttribute('role', 'alert');
    const inner = el('div', 'max-width:520px;');
    inner.appendChild(el('h1', 'font:600 22px/1.3 Georgia,serif;letter-spacing:0.06em;margin:0 0 10px;color:#e0a050;', title));
    inner.appendChild(el('p', 'margin:0;opacity:0.85;', text));
    if (buttonLabel) {
      const b = el('button', BTN_CSS, buttonLabel);
      b.type = 'button';
      b.addEventListener('click', () => onButton && onButton());
      inner.appendChild(b);
    }
    box.appendChild(inner);
    document.body.appendChild(box);
    this._panel = this._panel || {};
    this._panel[kind] = box;
  }

  _hidePanel(kind) {
    const p = this._panel && this._panel[kind];
    if (p && p.parentNode) p.parentNode.removeChild(p);
    if (this._panel) this._panel[kind] = null;
  }

  // ---- debug (tests) -----------------------------------------------------------------------------------------------
  _ext() {
    if (this._loseExt) return this._loseExt;
    const gl = this.game.renderer && this.game.renderer.renderer && this.game.renderer.renderer.getContext();
    this._loseExt = (gl && gl.getExtension('WEBGL_lose_context')) || null;
    return this._loseExt;
  }
  loseContext() {
    const x = this._ext();
    if (!x) return false;
    x.loseContext();
    return true;
  }
  restoreContext() {
    const x = this._ext();
    if (!x) return false;
    x.restoreContext();
    return true;
  }

  report() {
    return { contextLost: this.contextLost, lostCount: this.lostCount, restoredCount: this.restoredCount, immersiveApp: this.immersiveApp };
  }

  dispose() {
    for (const off of this._offs.splice(0)) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    clearTimeout(this._timer);
    clearInterval(this._wdTimer);
    this._hidePanel('gl');
    this._hidePanel('xr');
  }
}
