/* ABYSSAL TETHER 3D — input/touchInput.js
 * WP-TOUCH: the phone / tablet touch layer. A third device for the InputManager next to XRInput and DesktopInput: it
 * owns the pointer listeners and the on-screen controls, mutates raw state, and the InputManager's desktop frame
 * (_updateDesktop) merges that state into the same `intent` the keyboard and mouse build, so the rope, climb, reel
 * and bag paths are the existing desktop ones. VR is untouched: the layer never exists while a session is presenting.
 *
 *   left half of the view    floating stick (base appears under the thumb)  → move / swing / climb direction
 *   right half of the view   drag to look (+ optional gyroscope)
 *   ROPE R / ROPE L (or ROPE + L/R chip)   that hand's tether (hold, or tap to latch); a drag from the button looks
 *   REEL / LET OUT           hold: reel every attached tether in / out        (Space / Shift)
 *   JUMP                     jump, hop off a hold                              (Space edge)
 *   GRIP                     hold: cling to marked surfaces and edges, stick climbs (F + WASD)
 *   BAG                      row of the four items with counts; tap one to apply it, X stops applying (1-4 / X)
 *   II                       pause (Esc)
 *
 * Pointer events only (touch / pen; the mouse keeps the desktop path), all handled on `window` in the capture phase and
 * keyed by pointerId, so any number of fingers work. Taps on menus, links and form controls are never taken.
 * The DOM is built lazily on the first activation; the pure rules are in touchLogic.js.
 */
import { ButtonMachine, LAYOUT, TOUCH_TUNING, bagCountsKey, followStick, gyroLook, lookDelta, placeButton, stickVector, touchModeOn, touchSettings, zoneForX } from './touchLogic.js';
import { isCoarsePrimary, isIOS, isQuestBrowser } from '../platform/deviceProfile.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
// 24x24 line icons, stroke = currentColor. Distinct silhouettes so the buttons never rely on colour.
const ICON = {
  fireR: '<path d="M12 3l7 9-7 9-7-9z" fill="currentColor" fill-opacity=".35"/>',
  fireL: '<circle cx="12" cy="12" r="7.5" fill="currentColor" fill-opacity=".2"/><circle cx="12" cy="12" r="2.2"/>',
  jump: '<path d="M12 4l7 9h-4.5v7h-5v-7H5z" fill="currentColor" fill-opacity=".25"/>',
  grip: '<path d="M8 20v-8M12 20V6M16 20v-8M5 14v-2M19 14v-2M5 14c0 4 3 6 7 6s7-2 7-6" fill="none"/>',
  reel: '<path d="M12 21V8M6 13l6-6 6 6M5 3.5h14"/>',
  out: '<path d="M12 3v13M6 11l6 6 6-6M5 20.5h14"/>',
  bag: '<path d="M6 9h12l1.5 11h-15zM9 9V7a3 3 0 016 0v2M9 14h6"/>',
  pause: '<path d="M8 5v14M16 5v14" stroke-width="3.2"/>',
  x: '<path d="M6 6l12 12M18 6L6 18" stroke-width="2.6"/>',
  fs: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  // bag items: aid kit (cross in a box), bandage (slanted pad), adrenaline (syringe), battery (cell + bolt)
  i0: '<rect x="4" y="7" width="16" height="12" rx="2"/><path d="M12 10v6M9 13h6M9 7V5h6v2"/>',
  i1: '<rect x="3" y="9" width="18" height="6" rx="3" transform="rotate(-35 12 12)"/><path d="M10 10.5l3.5 3M12.5 8.5l3.5 3" stroke-width="1.4"/>',
  i2: '<path d="M4 20l6-6M9 9l6 6M11 7l6 6 3-3-6-6zM17 3l4 4M5 15l4 4"/>',
  i3: '<rect x="7" y="5" width="10" height="16" rx="2"/><path d="M10 3h4v2h-4zM13 9l-3 4h4l-3 4" stroke-width="1.6"/>',
};
const LABEL = { fireR: 'ROPE R', fireL: 'ROPE L', fire: 'ROPE', jump: 'JUMP', grip: 'GRIP', reel: 'REEL', out: 'LET OUT', bag: 'BAG', pause: '', fs: '' };
const NAME = { fireR: 'Right rope', fireL: 'Left rope', fire: 'Rope', jump: 'Jump', grip: 'Grip and cling', reel: 'Reel in', out: 'Let rope out', bag: 'Bag', pause: 'Pause' };
const ITEM_SHORT = ['AID', 'BAND', 'ADREN', 'BATT'];
const ITEM_NAME = ['First aid kit', 'Bandage', 'Adrenaline shot', 'Lantern battery'];

const CSS = `
html.touch-on,html.touch-on body{touch-action:none;overscroll-behavior:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
html.touch-on #stage,html.touch-on #stage canvas{touch-action:none}
html.touch-on .at3d-ui .capture,html.touch-on .at3d-ui .btn-pause,html.touch-on .at3d-ui .crosshair{display:none!important}
html.touch-on .at3d-ui .panel-body,html.touch-on .at3d-ui .menu-wrap,html.touch-on .at3d-ui .death-wrap,html.touch-on .at3d-ui .screen{touch-action:pan-y}
html.touch-on .at3d-ui input[type=range]{touch-action:pan-y;min-height:44px}
html.touch-on .at3d-ui .seg button,html.touch-on .at3d-ui .btn,html.touch-on .at3d-ui [data-action]{min-height:48px}
html.touch-on .at3d-ui .seg button{min-width:52px}
html.touch-on .at3d-ui .hud{font-size:13px;top:max(8px,env(safe-area-inset-top,0px));left:max(10px,env(safe-area-inset-left,0px));right:max(10px,env(safe-area-inset-right,0px))}
html.touch-on .at3d-ui .hud-ecg,html.touch-on .at3d-ui .hud-bag{width:7.6em}
html.touch-on .at3d-ui .hint{bottom:calc(env(safe-area-inset-bottom,0px) + 12px);max-width:min(28em,calc(100% - 28em))}
html.touch-on .at3d-ui .captions{bottom:calc(env(safe-area-inset-bottom,0px) + 4.5em)}
@media (max-height:520px){html.touch-on .at3d-ui .hud-gauge{display:none}html.touch-on .at3d-ui .hud-bag{display:none}}
.tc-root{position:fixed;inset:0;z-index:11;pointer-events:none;touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;font:600 11px/1.1 system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;letter-spacing:.06em;color:#e8dcc0}
.tc-root[hidden]{display:none}
.tc-root *{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
.tc-play{position:absolute;inset:0;opacity:1;transition:opacity .5s}
.tc-root.is-idle .tc-play{opacity:.38}
.tc-play[hidden],.tc-chrome[hidden]{display:none}
.tc-chrome{position:absolute;inset:0}
.tc-btn{position:absolute;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:0;margin:0;border:2px solid rgba(232,220,192,.5);border-radius:50%;color:#e8dcc0;background:rgba(10,12,13,.46);pointer-events:auto;touch-action:none;font:inherit;text-transform:uppercase;cursor:pointer;-webkit-appearance:none;appearance:none;transition:background .08s,transform .08s,border-color .08s}
.tc-btn[hidden]{display:none}
.tc-btn svg{width:42%;height:42%;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round;fill:none;pointer-events:none}
.tc-btn span{pointer-events:none;font-size:10px;max-width:96%;text-align:center;white-space:nowrap}
.tc-btn.is-down,.tc-btn[aria-pressed=true]{background:rgba(232,220,192,.34);border-color:#f2e6c9;transform:scale(.94)}
.tc-btn[data-tc=fireR],.tc-btn[data-tc=fire][data-sel=right]{border-color:rgba(240,180,104,.85);color:#f0b468;border-radius:50% 50% 50% 50%/46% 46% 54% 54%}
.tc-btn[data-tc=fireL],.tc-btn[data-tc=fire][data-sel=left]{border-color:rgba(143,193,180,.9);color:#9fd0c3}
.tc-btn[data-tc=pause],.tc-btn[data-tc=fs]{border-radius:14px}
.tc-btn[data-tc=jump],.tc-btn[data-tc=bag],.tc-btn[data-tc=grip]{border-radius:22%}
.tc-btn[data-tc=reel],.tc-btn[data-tc=out]{border-radius:30% 30% 50% 50%}
.tc-btn[data-tc=out]{border-radius:50% 50% 30% 30%}
.tc-badge{position:absolute;top:-6px;right:-6px;min-width:22px;height:22px;padding:0 5px;border-radius:11px;background:#e0a050;color:#0a0b0c;font:700 12px/22px system-ui,sans-serif;text-align:center;pointer-events:none}
.tc-chip{position:absolute;width:56px;height:36px;border-radius:18px}
.tc-chip svg{display:none}
.tc-chip span{font-size:13px}
.tc-bag{position:absolute;display:flex;gap:8px;padding:8px;border-radius:16px;background:rgba(8,9,10,.78);border:1px solid rgba(232,220,192,.3);pointer-events:auto;touch-action:none}
.tc-bag[hidden]{display:none}
.tc-item{position:relative;width:64px;height:68px;border-radius:12px;border-width:2px;gap:1px}
.tc-item svg{width:30px;height:30px}
.tc-item b{position:absolute;top:2px;right:6px;font:700 15px/1 system-ui,sans-serif;color:#f0b468}
.tc-item.is-empty{opacity:.35}
.tc-item.is-sel{border-color:#f2e6c9}
.tc-stick{position:absolute;width:0;height:0;pointer-events:none;display:none}
.tc-stick.is-on{display:block}
.tc-ring{position:absolute;left:-62px;top:-62px;width:124px;height:124px;border-radius:50%;border:2px solid rgba(232,220,192,.45);background:rgba(10,12,13,.28)}
.tc-ring::before,.tc-ring::after{content:'';position:absolute;background:rgba(232,220,192,.28)}
.tc-ring::before{left:50%;top:10px;bottom:10px;width:1px}
.tc-ring::after{top:50%;left:10px;right:10px;height:1px}
.tc-knob{position:absolute;left:-26px;top:-26px;width:52px;height:52px;border-radius:50%;background:rgba(232,220,192,.5);border:2px solid #f2e6c9}
.tc-hint,.tc-rotate,.tc-a2hs{position:absolute;pointer-events:auto;padding:10px 14px;border-radius:10px;background:rgba(8,9,10,.86);border:1px solid rgba(232,220,192,.3);font:500 14px/1.4 system-ui,sans-serif;letter-spacing:0;text-transform:none;text-align:center;touch-action:none}
.tc-rotate{left:50%;top:50%;transform:translate(-50%,-50%);max-width:min(22em,86vw);z-index:2}
.tc-rotate svg{display:block;margin:0 auto 6px;width:44px;height:44px;stroke:#e8dcc0;stroke-width:1.8;fill:none}
.tc-a2hs{left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 10px);max-width:min(30em,90vw)}
.tc-root[data-portrait=true] .tc-play .tc-btn{transform-origin:center}
`;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}
function svgIcon(key, extra) {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.setAttribute('focusable', 'false');
  s.innerHTML = ICON[key] + (extra || ''); // constants above only
  return s;
}
function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}
function storeGet(k) {
  try {
    return window.localStorage.getItem(k);
  } catch {
    return null;
  }
}
function storeSet(k, v) {
  try {
    window.localStorage.setItem(k, v);
  } catch {
    /* private mode */
  }
}

export class TouchInput {
  /**
   * @param {InputManager} im receives _handPhysical(), _edge(), _bagEdge(); read for xrActive / uiMode / game / settings
   * @param {HTMLCanvasElement|null} canvas
   * @param {object} [env] { window, document } overrides (tests)
   */
  constructor(im, canvas, env) {
    const e = env || {};
    this.im = im;
    this.canvas = canvas || null;
    this.win = e.window !== undefined ? e.window : typeof window !== 'undefined' ? window : null;
    this.doc = e.document !== undefined ? e.document : typeof document !== 'undefined' ? document : null;
    this.enabled = false; // the layer is on (setting + device + not presenting)
    this.visible = false; // the controls are showing and taking touches (a run is live)
    this.touchSeen = false;
    this.coarse = isCoarsePrimary();
    this.quest = isQuestBrowser();
    this.root = null;
    this.els = Object.create(null);
    this.stick = { x: 0, y: 0, mag: 0 }; // y up; zero unless a thumb is on the stick
    this._stickId = -1;
    this._base = { x: 0, y: 0 };
    this._lookId = -1;
    this._drags = new Map(); // pointerId → { x, y } for look drags (view drag + look buttons)
    this._ptrBtn = new Map(); // pointerId → button id
    this._lookYaw = 0;
    this._lookPitch = 0;
    this._btn = {
      fireL: new ButtonMachine('hold'),
      fireR: new ButtonMachine('hold'),
      fire: new ButtonMachine('hold'),
      grip: new ButtonMachine('hold'),
      reel: new ButtonMachine('hold'),
      out: new ButtonMachine('hold'),
    };
    this.sel = 'right'; // hand of the single ROPE button
    this._fireHand = 'right'; // the hand the single button fired with while held
    this._bagOpen = false;
    this._bagT = 0;
    this._bagKey = -1;
    this._idle = 0;
    this._lastKey = '';
    this._countAcc = 0;
    this._wl = null;
    this._wlWant = false;
    this._gyro = { on: false, attached: false, rate: null, angle: 0, last: 0 };
    this._tmpS = { x: 0, y: 0, mag: 0 };
    this._tmpL = { yaw: 0, pitch: 0 };
    this._mqPortrait = null;
    this._attached = false;
    this._h = {
      down: (ev) => this.onDown(ev),
      move: (ev) => this.onMove(ev),
      up: (ev) => this.onUp(ev),
      ctx: (ev) => this._swallow(ev),
      gesture: (ev) => this._swallow(ev),
      motion: (ev) => this.onMotion(ev),
      vis: () => this._onVisibility(),
      resize: () => this._syncPortrait(),
    };
    this.attach();
  }

  // ---------------------------------------------------------------------------
  // Settings / activation
  // ---------------------------------------------------------------------------

  get settings() {
    const src = this.im && this.im.settings;
    if (!this._cs || this._csSrc !== src) {
      this._cs = touchSettings(src);
      this._csSrc = src;
    }
    return this._cs;
  }

  /** True while the on-screen controls own the frame (read by the InputManager). */
  get active() {
    return this.enabled && this.visible;
  }

  /** The rope button state for a hand (merged with the mouse / keys in DesktopInput.handDown). */
  fireDown(hand) {
    if (!this.visible) return false;
    const b = this._btn;
    if (this.settings.launcher === 'toggle') return b.fire.held && this._fireHand === hand;
    return (hand === 'left' ? b.fireL : b.fireR).held;
  }

  get gripHeld() {
    return this.visible && this._btn.grip.held;
  }

  /** -1 (let out) .. 1 (reel in). */
  get reel() {
    return this.visible ? (this._btn.reel.held ? 1 : 0) - (this._btn.out.held ? 1 : 0) : 0;
  }

  /** Radians to add to the rig yaw / camera pitch since the last call (drag + gyro). */
  consumeLook(out) {
    out.yaw = this._lookYaw;
    out.pitch = this._lookPitch;
    this._lookYaw = 0;
    this._lookPitch = 0;
    return out;
  }

  /** Re-evaluates whether the layer is on (setting changed, session started / ended, first touch seen). */
  refresh() {
    const st = this.settings;
    const want = !!this.doc && touchModeOn(st.mode, { coarse: this.coarse, touchSeen: this.touchSeen, quest: this.quest, xrPresenting: this.im.xrActive });
    if (want === this.enabled) {
      this._syncGyro();
      return this.enabled;
    }
    this.enabled = want;
    if (this.doc && this.doc.documentElement) this.doc.documentElement.classList.toggle('touch-on', want);
    if (want) this._build();
    else {
      this.visible = false;
      if (this.els.play) this.els.play.hidden = true;
      this.clear();
      this._wake(false);
    }
    if (this.root) this.root.hidden = !want;
    this._lastKey = '';
    this._syncGyro();
    this._syncPortrait();
    return want;
  }

  /** InputManager.applySettings hook (inside the click that changed a setting: iOS wants the permission prompt there). */
  applySettings() {
    this._cs = null; // re-read the (mutated in place) settings
    this.refresh();
    this._layout();
    this._syncGyro(true);
  }

  // ---------------------------------------------------------------------------
  // Listeners
  // ---------------------------------------------------------------------------

  attach() {
    if (this._attached || !this.win || !this.win.addEventListener) return;
    this._attached = true;
    const w = this.win;
    const h = this._h;
    w.addEventListener('pointerdown', h.down, { capture: true, passive: false });
    w.addEventListener('pointermove', h.move, { capture: true, passive: false });
    w.addEventListener('pointerup', h.up, true);
    w.addEventListener('pointercancel', h.up, true);
    w.addEventListener('contextmenu', h.ctx, true);
    w.addEventListener('gesturestart', h.gesture, { passive: false });
    w.addEventListener('gesturechange', h.gesture, { passive: false });
    w.addEventListener('resize', h.resize);
    if (this.doc) this.doc.addEventListener('visibilitychange', h.vis);
  }

  detach() {
    if (!this._attached) return;
    this._attached = false;
    const w = this.win;
    const h = this._h;
    w.removeEventListener('pointerdown', h.down, true);
    w.removeEventListener('pointermove', h.move, true);
    w.removeEventListener('pointerup', h.up, true);
    w.removeEventListener('pointercancel', h.up, true);
    w.removeEventListener('contextmenu', h.ctx, true);
    w.removeEventListener('gesturestart', h.gesture);
    w.removeEventListener('gesturechange', h.gesture);
    w.removeEventListener('resize', h.resize);
    if (this.doc) this.doc.removeEventListener('visibilitychange', h.vis);
    this._detachGyro();
    this._wake(false);
    this.clear();
    if (this.root && this.root.parentNode) this.root.parentNode.removeChild(this.root);
    if (this.doc && this.doc.documentElement) this.doc.documentElement.classList.remove('touch-on');
  }

  _swallow(ev) {
    if (this.enabled && ev.cancelable) ev.preventDefault();
  }

  /** Releases every finger, button and the stick (blur, pause, session start, layer off). */
  clear() {
    this._stickId = -1;
    this._lookId = -1;
    this._drags.clear();
    this._ptrBtn.clear();
    this.stick.x = this.stick.y = this.stick.mag = 0;
    this._lookYaw = this._lookPitch = 0;
    for (const k of Object.keys(this._btn)) this._btn[k].releaseAll();
    if (this.els.stick) this.els.stick.classList.remove('is-on');
    this._syncHands();
    this._setBag(false);
    this._paintPressed();
  }

  // ---------------------------------------------------------------------------
  // Pointers
  // ---------------------------------------------------------------------------

  _isTouchLike(ev) {
    return ev.pointerType === 'touch' || ev.pointerType === 'pen';
  }

  onDown(ev) {
    if (!this._isTouchLike(ev)) return;
    if (!this.enabled) {
      // A hybrid laptop: the first real touch turns the layer on (the tap itself still reaches the page).
      if (!this.touchSeen && !this.im.xrActive && this.settings.mode === 'auto') {
        this.touchSeen = true;
        this.refresh();
      }
      return;
    }
    this._idle = 0;
    const t = ev.target;
    const btnEl = t && t.closest ? t.closest('[data-tc]') : null;
    if (btnEl && this.root && this.root.contains(btnEl)) {
      if (ev.cancelable) ev.preventDefault();
      this._buttonDown(btnEl.dataset.tc, ev);
      return;
    }
    if (!this.visible) return;
    // Anything that is a menu, link or form control keeps its own tap.
    if (t && t.closest && t.closest('.screen, a, input, select, textarea, [data-action], [role=button], .tc-root')) return;
    const zone = zoneForX(ev.clientX, this.win.innerWidth || 1, this.settings.mirror);
    if (ev.cancelable) ev.preventDefault();
    this._setBag(false);
    if (zone === 'stick' && this._stickId < 0) {
      this._stickId = ev.pointerId;
      this._base.x = ev.clientX;
      this._base.y = ev.clientY;
      this._placeStick(true);
      this._moveStick(ev.clientX, ev.clientY);
    } else if (zone === 'look' && this._lookId < 0) {
      this._lookId = ev.pointerId;
      this._drags.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    }
  }

  onMove(ev) {
    if (!this._isTouchLike(ev) || !this.enabled) return;
    const id = ev.pointerId;
    if (id === this._stickId) {
      if (ev.cancelable) ev.preventDefault();
      this._moveStick(ev.clientX, ev.clientY);
      this._idle = 0;
      return;
    }
    const d = this._drags.get(id);
    if (d) {
      if (ev.cancelable) ev.preventDefault();
      const st = this.settings;
      const r = lookDelta(ev.clientX - d.x, ev.clientY - d.y, st.sens, st.invertY, this._tmpL);
      d.x = ev.clientX;
      d.y = ev.clientY;
      if (this.visible) {
        this._lookYaw += r.yaw;
        this._lookPitch += r.pitch;
      }
      this._idle = 0;
    }
  }

  onUp(ev) {
    if (!this._isTouchLike(ev)) return;
    const id = ev.pointerId;
    if (id === this._stickId) {
      this._stickId = -1;
      this.stick.x = this.stick.y = this.stick.mag = 0;
      if (this.els.stick) this.els.stick.classList.remove('is-on');
    }
    if (id === this._lookId) this._lookId = -1;
    this._drags.delete(id);
    const b = this._ptrBtn.get(id);
    if (b) {
      this._ptrBtn.delete(id);
      this._buttonUp(b, id, ev.type === 'pointerup');
    }
    if (ev.type === 'pointerup' && this.enabled && this.settings.gyro) this._syncGyro(true);
  }

  _moveStick(x, y) {
    const R = TOUCH_TUNING.stickRadius * this.settings.scale;
    followStick(this._base, x, y, R);
    stickVector(x - this._base.x, y - this._base.y, R, undefined, undefined, this.stick);
    this._placeStick(false, x, y);
  }

  _placeStick(show, x, y) {
    const s = this.els.stick;
    if (!s) return;
    if (show) s.classList.add('is-on');
    s.style.transform = `translate(${this._base.x}px,${this._base.y}px)`;
    const R = TOUCH_TUNING.stickRadius * this.settings.scale;
    const kx = x === undefined ? 0 : Math.max(-R, Math.min(R, x - this._base.x));
    const ky = y === undefined ? 0 : Math.max(-R, Math.min(R, y - this._base.y));
    if (this.els.knob) this.els.knob.style.transform = `translate(${kx}px,${ky}px)`;
  }

  // ---------------------------------------------------------------------------
  // Buttons
  // ---------------------------------------------------------------------------

  _tick(ms) {
    const nav = this.win && this.win.navigator;
    if (this.settings.haptics && nav && typeof nav.vibrate === 'function') {
      try {
        nav.vibrate(ms || 10);
      } catch {
        /* not allowed */
      }
    }
  }

  _buttonDown(id, ev) {
    const pid = ev.pointerId;
    if (this._ptrBtn.has(pid)) return;
    this._ptrBtn.set(pid, id);
    const im = this.im;
    const def = LAYOUT.find((d) => d.id === id);
    if (def && def.look) this._drags.set(pid, { x: ev.clientX, y: ev.clientY });
    if (id !== 'bag' && !id.startsWith('bag')) this._setBag(false);
    switch (id) {
      case 'fireL':
      case 'fireR':
      case 'fire': {
        if (id === 'fire') this._fireHand = this.sel;
        const m = this._btn[id];
        m.setMode(this.settings.rope);
        const r = m.down(pid);
        if (r) this._tick(14);
        im._edge('any');
        this._syncHands();
        break;
      }
      case 'sel':
        if (!this._btn.fire.held) {
          this.sel = this.sel === 'right' ? 'left' : 'right';
          this._tick(8);
          this._lastKey = '';
        }
        break;
      case 'grip':
      case 'reel':
      case 'out':
        this._btn[id].down(pid);
        this._tick(10);
        im._edge('any');
        break;
      case 'jump':
        im._edge('any');
        im._edge('jump');
        this._tick(12);
        break;
      case 'pause':
        this._tick(10);
        im._edge('pause');
        break;
      case 'bag':
        this._setBag(!this._bagOpen);
        this._tick(8);
        break;
      case 'bagX':
        im._bagEdge('cancel');
        this._setBag(false);
        this._tick(8);
        break;
      case 'fs':
        this._tick(8); // the request itself runs on pointerup (touch user activation)
        break;
      case 'rotate':
        this._dismissRotate();
        break;
      case 'a2hs':
        storeSet('at3d.touch.a2hs', '1');
        if (this.els.a2hs) this.els.a2hs.hidden = true;
        break;
      default:
        if (id.startsWith('bag')) {
          const n = id.charCodeAt(3) - 48;
          const bag = im.game && im.game.bag;
          if (n >= 0 && n < 4 && bag && bag.counts && bag.counts[n] > 0) {
            im._edge('any');
            im._bagEdge('slot', n);
            this._tick(16);
            this._setBag(false);
          } else this._tick(4);
        }
        break;
    }
    this._paintPressed();
  }

  _buttonUp(id, pid, completed) {
    if (id === 'fs' && completed) this._fullscreen();
    const m = this._btn[id];
    if (m) {
      m.up(pid);
      if (id === 'fireL' || id === 'fireR' || id === 'fire') this._syncHands();
    }
    this._paintPressed();
  }

  _syncHands() {
    const d = this.im && this.im.desktop;
    if (!d) return;
    d._syncHand('left');
    d._syncHand('right');
  }

  _paintPressed() {
    const E = this.els;
    for (const k of Object.keys(this._btn)) {
      const b = E[k];
      if (b) b.setAttribute('aria-pressed', String(this._btn[k].held));
    }
    if (E.bag) E.bag.setAttribute('aria-pressed', String(this._bagOpen));
  }

  _setBag(open) {
    const v = !!open && this.visible;
    if (v === this._bagOpen) return;
    this._bagOpen = v;
    this._bagT = 0;
    if (this.els.bagPanel) this.els.bagPanel.hidden = !v;
    if (v) this._countAcc = 1;
    this._paintPressed();
  }

  // ---------------------------------------------------------------------------
  // Per frame (called by InputManager._updateDesktop)
  // ---------------------------------------------------------------------------

  update(dt) {
    this.refresh();
    if (!this.enabled) {
      if (this.visible) this.visible = false;
      return;
    }
    const im = this.im;
    const gs = im._liveState ? im._liveState() : null;
    const playing = (gs == null || gs === 'playing') && !im.uiMode && !im.xrActive;
    if (playing !== this.visible) {
      this.visible = playing;
      if (!playing) this.clear();
      if (this.els.play) this.els.play.hidden = !playing;
      this._wake(playing);
      this._syncGyro();
    }
    if (this.els.chrome) {
      const menu = !playing;
      if (this.els.fs) this.els.fs.hidden = !(menu && this._fsAvailable());
      if (this.els.a2hs) this.els.a2hs.hidden = !(menu && gs === 'menu' && isIOS() && !this._standalone() && !storeGet('at3d.touch.a2hs'));
    }
    if (!this.visible) return;
    this._layoutIfChanged();
    this._idle += dt;
    if (this.root) this.root.classList.toggle('is-idle', this._idle > TOUCH_TUNING.idleFadeS && this._stickId < 0 && this._drags.size === 0 && this._ptrBtn.size === 0 && !this._bagOpen);
    if (this._bagOpen) {
      this._bagT += dt;
      if (this._bagT > 7) this._setBag(false);
    }
    this._countAcc += dt;
    if (this._countAcc > 0.25) {
      this._countAcc = 0;
      this._paintBag();
    }
  }

  _layoutKey() {
    const s = this.settings;
    return `${s.scale}|${s.mirror}|${s.launcher}|${s.rope}|${this.sel}|${s.colorSafe}`;
  }

  _layoutIfChanged() {
    const k = this._layoutKey();
    if (k !== this._lastKey) this._layout();
  }

  _paintBag() {
    const bag = this.im.game && this.im.game.bag;
    if (!bag || !bag.counts) return;
    const key = bagCountsKey(bag.counts) * 4 + (bag.selected | 0);
    if (key === this._bagKey) return;
    this._bagKey = key;
    let total = 0;
    for (let i = 0; i < 4; i++) {
      const n = bag.counts[i] | 0;
      total += n;
      const it = this.els['bag' + i];
      if (!it) continue;
      it.classList.toggle('is-empty', n <= 0);
      it.classList.toggle('is-sel', i === (bag.selected | 0));
      it.querySelector('b').textContent = String(n);
      it.setAttribute('aria-label', `${ITEM_NAME[i]}, ${n}`);
    }
    if (this.els.badge) {
      this.els.badge.textContent = String(total);
      this.els.badge.hidden = total <= 0;
    }
  }

  // ---------------------------------------------------------------------------
  // DOM
  // ---------------------------------------------------------------------------

  _build() {
    if (this.root || !this.doc) return;
    const d = this.doc;
    if (!d.getElementById('at3d-touch-style')) {
      const st = d.createElement('style');
      st.id = 'at3d-touch-style';
      st.textContent = CSS;
      (d.head || d.documentElement).appendChild(st);
    }
    const root = el('div', 'tc-root');
    root.setAttribute('aria-label', 'Touch controls');
    root.hidden = true;
    const play = el('div', 'tc-play');
    play.hidden = true;
    const chrome = el('div', 'tc-chrome');
    root.append(play, chrome);

    const stick = el('div', 'tc-stick');
    const ring = el('div', 'tc-ring');
    const knob = el('div', 'tc-knob');
    stick.append(ring, knob);
    play.appendChild(stick);

    const mk = (id, parent, iconKey, label, extra) => {
      const b = el('button', 'tc-btn');
      b.type = 'button';
      b.dataset.tc = id;
      b.setAttribute('aria-label', NAME[id] || label || id);
      b.setAttribute('aria-pressed', 'false');
      b.appendChild(svgIcon(iconKey || id));
      if (label) b.appendChild(el('span', null, label));
      if (extra) b.appendChild(extra);
      parent.appendChild(b);
      this.els[id] = b;
      return b;
    };
    mk('fireR', play, 'fireR', LABEL.fireR);
    mk('fireL', play, 'fireL', LABEL.fireL);
    mk('fire', play, 'fireR', LABEL.fire);
    const chip = mk('sel', play, 'fireR', 'R');
    chip.classList.add('tc-chip');
    chip.removeAttribute('aria-pressed');
    chip.setAttribute('aria-label', 'Switch rope hand');
    mk('jump', play, 'jump', LABEL.jump);
    mk('grip', play, 'grip', LABEL.grip);
    mk('reel', play, 'reel', LABEL.reel);
    mk('out', play, 'out', LABEL.out);
    const badge = el('i', 'tc-badge', '0');
    badge.hidden = true;
    mk('bag', play, 'bag', LABEL.bag, badge);
    this.els.badge = badge;
    mk('pause', play, 'pause', '');

    const panel = el('div', 'tc-bag');
    panel.hidden = true;
    for (let i = 0; i < 4; i++) {
      const it = el('button', 'tc-btn tc-item');
      it.type = 'button';
      it.dataset.tc = 'bag' + i;
      it.appendChild(svgIcon('i' + i));
      it.appendChild(el('span', null, ITEM_SHORT[i]));
      it.appendChild(el('b', null, '0'));
      panel.appendChild(it);
      this.els['bag' + i] = it;
    }
    const x = el('button', 'tc-btn tc-item');
    x.type = 'button';
    x.dataset.tc = 'bagX';
    x.setAttribute('aria-label', 'Stop applying');
    x.appendChild(svgIcon('x'));
    x.appendChild(el('span', null, 'STOP'));
    panel.appendChild(x);
    play.appendChild(panel);
    this.els.bagPanel = panel;

    const fs = el('button', 'tc-btn');
    fs.type = 'button';
    fs.dataset.tc = 'fs';
    fs.setAttribute('aria-label', 'Fullscreen');
    fs.appendChild(svgIcon('fs'));
    fs.hidden = true;
    chrome.appendChild(fs);
    this.els.fs = fs;

    const rot = el('div', 'tc-rotate');
    rot.dataset.tc = 'rotate';
    rot.hidden = true;
    rot.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="3" width="10" height="18" rx="2"/><path d="M19.5 9.5a8 8 0 00-3-4M20 3.5v3h-3"/></svg>';
    rot.appendChild(el('div', null, 'Turn your phone sideways for the best view. Tap to dismiss.'));
    chrome.appendChild(rot);
    this.els.rotate = rot;

    const a2 = el('div', 'tc-a2hs');
    a2.dataset.tc = 'a2hs';
    a2.hidden = true;
    a2.textContent = 'For full screen: tap Share, then Add to Home Screen. Tap to hide.';
    chrome.appendChild(a2);
    this.els.a2hs = a2;

    Object.assign(this.els, { root, play, chrome, stick, knob });
    this.root = root;
    d.body.appendChild(root);
    this._layout();
  }

  _layout() {
    if (!this.root) return;
    const st = this.settings;
    this._lastKey = this._layoutKey();
    const E = this.els;
    const two = st.launcher === 'two';
    const place = (id, defId) => {
      const b = E[id];
      if (!b) return;
      const def = LAYOUT.find((d) => d.id === (defId || id));
      const p = placeButton(def, st.scale, st.mirror);
      const s = b.style;
      s.width = s.height = `${p.size}px`;
      s.left = s.right = s.top = s.bottom = 'auto';
      s[p.side] = `calc(${Math.round(p.x)}px + env(safe-area-inset-${p.side}, 0px))`;
      if (p.top) s.top = `calc(${Math.round(p.y)}px + env(safe-area-inset-top, 0px))`;
      else s.bottom = `calc(${Math.round(p.y)}px + env(safe-area-inset-bottom, 0px))`;
    };
    for (const id of ['fireR', 'fireL', 'fire', 'jump', 'grip', 'reel', 'out', 'bag', 'pause']) place(id);
    E.fireR.hidden = !two;
    E.fireL.hidden = !two;
    E.fire.hidden = two;
    E.sel.hidden = two;
    E.fire.dataset.sel = this.sel;
    E.fire.querySelector('svg').innerHTML = ICON[this.sel === 'left' ? 'fireL' : 'fireR'];
    E.fire.querySelector('span').textContent = this.sel === 'left' ? 'ROPE L' : 'ROPE R';
    E.sel.querySelector('span').textContent = this.sel === 'left' ? 'L' : 'R';
    // the L / R chip sits just above the single rope button
    const fp = placeButton(LAYOUT.find((d) => d.id === 'fire'), st.scale, st.mirror);
    const cs = E.sel.style;
    cs.left = cs.right = cs.top = 'auto';
    cs[fp.side] = `calc(${Math.round(fp.x + (fp.size - 56) / 2)}px + env(safe-area-inset-${fp.side}, 0px))`;
    cs.bottom = `calc(${Math.round(fp.y + fp.size + 8)}px + env(safe-area-inset-bottom, 0px))`;
    // the bag row opens beside the bag button, toward the middle of the screen
    const bp = placeButton(LAYOUT.find((d) => d.id === 'bag'), st.scale, st.mirror);
    const ps = E.bagPanel.style;
    ps.left = ps.right = ps.top = 'auto';
    ps[bp.side] = `calc(${Math.round(bp.x + bp.size + 10)}px + env(safe-area-inset-${bp.side}, 0px))`;
    ps.bottom = `calc(${Math.round(bp.y)}px + env(safe-area-inset-bottom, 0px))`;
    // fullscreen button: top corner on the stick side (clear of the pause button on the other side)
    const fs = E.fs.style;
    fs.width = fs.height = '48px';
    fs.left = fs.right = 'auto';
    fs[st.mirror ? 'right' : 'left'] = 'calc(12px + env(safe-area-inset-' + (st.mirror ? 'right' : 'left') + ', 0px))';
    fs.bottom = 'calc(12px + env(safe-area-inset-bottom, 0px))';
    for (const k of ['fireR', 'fireL', 'fire']) this._btn[k].setMode(st.rope);
    this._bagKey = -1;
    this._paintPressed();
  }

  // ---------------------------------------------------------------------------
  // Rotate hint, fullscreen, wake lock
  // ---------------------------------------------------------------------------

  _portrait() {
    const w = this.win;
    return !!w && (w.innerHeight || 0) > (w.innerWidth || 0) * 1.05;
  }

  _syncPortrait() {
    if (!this.root) return;
    const p = this._portrait();
    this.root.dataset.portrait = String(p);
    const r = this.els.rotate;
    if (!r) return;
    if (!p) {
      if (!r.hidden) this._dismissRotate();
      return;
    }
    if (this.enabled && !storeGet('at3d.touch.rotate')) r.hidden = false;
  }

  _dismissRotate() {
    storeSet('at3d.touch.rotate', '1');
    if (this.els.rotate) this.els.rotate.hidden = true;
  }

  _standalone() {
    const w = this.win;
    try {
      return !!(w.navigator.standalone || (w.matchMedia && w.matchMedia('(display-mode: standalone)').matches));
    } catch {
      return false;
    }
  }

  _fsElement() {
    const d = this.doc;
    return d.fullscreenElement || d.webkitFullscreenElement || null;
  }

  _fsAvailable() {
    const d = this.doc;
    const root = d.documentElement;
    const can = !!(d.fullscreenEnabled || d.webkitFullscreenEnabled) && !!(root.requestFullscreen || root.webkitRequestFullscreen);
    return can && !this._fsElement() && !this._standalone();
  }

  _fullscreen() {
    const d = this.doc;
    const root = d.documentElement;
    try {
      const p = root.requestFullscreen ? root.requestFullscreen({ navigationUI: 'hide' }) : root.webkitRequestFullscreen();
      const lock = () => {
        const o = this.win.screen && this.win.screen.orientation;
        if (o && typeof o.lock === 'function') o.lock('landscape').catch(() => {});
      };
      if (p && typeof p.then === 'function') p.then(lock, () => {});
      else lock();
    } catch {
      /* refused */
    }
  }

  async _wake(on) {
    this._wlWant = !!on;
    const nav = this.win && this.win.navigator;
    if (!on) {
      const wl = this._wl;
      this._wl = null;
      try {
        if (wl) await wl.release();
      } catch {
        /* already released */
      }
      return;
    }
    if (this._wl || !nav || !nav.wakeLock || (this.doc && this.doc.visibilityState === 'hidden')) return;
    try {
      const wl = await nav.wakeLock.request('screen');
      if (!this._wlWant) {
        wl.release().catch(() => {});
        return;
      }
      this._wl = wl;
      wl.addEventListener('release', () => {
        if (this._wl === wl) this._wl = null;
      });
    } catch {
      /* battery saver / not allowed */
    }
  }

  _onVisibility() {
    if (this.doc.visibilityState === 'visible' && this._wlWant && !this._wl) this._wake(true);
    if (this.doc.visibilityState === 'hidden') this.clear();
  }

  // ---------------------------------------------------------------------------
  // Gyroscope
  // ---------------------------------------------------------------------------

  _syncGyro(gesture) {
    const want = this.enabled && this.visible && this.settings.gyro;
    const asked = this.enabled && this.settings.gyro;
    const needsAsk = !!(this.win && this.win.DeviceMotionEvent && typeof this.win.DeviceMotionEvent.requestPermission === 'function');
    if (asked && !this._gyro.attached && !this._gyro.pending) {
      if (!needsAsk || gesture) this._attachGyro(); // iOS: the permission prompt needs a user gesture
    }
    if (!asked && this._gyro.attached) this._detachGyro();
    this._gyro.on = want;
  }

  _attachGyro() {
    const w = this.win;
    const DM = w && w.DeviceMotionEvent;
    const go = () => {
      this._gyro.pending = false;
      if (!this.settings.gyro) return;
      w.addEventListener('devicemotion', this._h.motion);
      this._gyro.attached = true;
      this._gyro.last = 0;
    };
    if (DM && typeof DM.requestPermission === 'function') {
      this._gyro.pending = true;
      DM.requestPermission().then(
        (r) => {
          if (r === 'granted') go();
          else this._gyroDenied();
        },
        () => this._gyroDenied(),
      );
    } else go();
  }

  _detachGyro() {
    if (this._gyro.attached && this.win) this.win.removeEventListener('devicemotion', this._h.motion);
    this._gyro.attached = false;
    this._gyro.pending = false;
    this._gyro.on = false;
  }

  _gyroDenied() {
    this._gyro.pending = false;
    const g = this.im.game;
    try {
      if (g && typeof g.applySettings === 'function') g.applySettings({ touchGyro: false });
      if (g && g.ui && typeof g.ui.showToast === 'function') g.ui.showToast('Motion access was refused', 3);
    } catch {
      /* optional */
    }
  }

  onMotion(ev) {
    const g = this._gyro;
    if (!g.on || !ev.rotationRate) return;
    const t = ev.timeStamp || nowMs();
    const dt = g.last ? Math.min(0.1, Math.max(0, (t - g.last) / 1000)) : 0;
    g.last = t;
    if (!dt) return;
    const so = this.win.screen && this.win.screen.orientation;
    const angle = so && typeof so.angle === 'number' ? so.angle : typeof this.win.orientation === 'number' ? this.win.orientation : 0;
    const st = this.settings;
    const r = gyroLook(ev.rotationRate, angle, dt, st.sens, st.invertY, this._tmpL);
    this._lookYaw += r.yaw;
    this._lookPitch += r.pitch;
  }
}
