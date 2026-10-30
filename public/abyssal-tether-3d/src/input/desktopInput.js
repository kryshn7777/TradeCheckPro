/* ABYSSAL TETHER 3D — desktopInput.js
 * Mouse + keyboard for desktop play and testing. DOM events only mutate raw
 * state here and forward tether-button transitions / edges to the
 * InputManager, which builds the frame's intent.
 *
 *   Click the view          → pointer lock (that click never fires a tether)
 *   Mouse (locked)          → look: rig yaw + camera pitch (settings.mouseSensitivity)
 *   LMB / RMB               → RIGHT / LEFT tether (both aim along the view centre)
 *   E / Q                   → right / left tether (keyboard-only alternative)
 *   Arrow keys              → look (keyboard-only alternative)
 *   W A S D                 → move / swing / air control
 *   Space                   → jump · reel in while tethered (held)
 *   Shift                   → reel out          C → brake          F → yank both ropes
 *   Esc / P                 → pause             R → restart         Enter → confirm
 *   1 2 3 4                 → bag: apply first aid kit / bandage / adrenaline / battery (quick use)
 *   mouse wheel             → bag: select the previous / next item      G → apply the selected item
 *   X                       → bag: stop applying (taking damage stops it too)
 *
 * Losing pointer lock during play (the browser's own Esc handling) counts as
 * one pause press. Window blur / tab hide release every key and button.
 * Pointer lock can be emulated in tests by calling the on* handlers directly
 * and setting `locked`.
 */

const TEXT_INPUT_TYPES = {
  text: 1,
  search: 1,
  email: 1,
  url: 1,
  tel: 1,
  password: 1,
  number: 1,
  date: 1,
  'datetime-local': 1,
  month: 1,
  time: 1,
  week: 1,
};
const CONTROL_ROLES = { button: 1, slider: 1, checkbox: 1, switch: 1, radio: 1, menuitem: 1, tab: 1, option: 1, link: 1 };

/** 0 = not a control, 1 = button-like (Space/Enter activate it), 2 = text entry. */
export function controlKind(el) {
  if (!el || typeof el !== 'object' || !el.tagName) return 0;
  if (typeof document !== 'undefined' && (el === document.body || el === document.documentElement)) return 0;
  if (el.isContentEditable) return 2;
  const tag = el.tagName;
  if (tag === 'TEXTAREA') return 2;
  if (tag === 'INPUT') return TEXT_INPUT_TYPES[String(el.type || 'text').toLowerCase()] ? 2 : 1;
  if (tag === 'SELECT' || tag === 'BUTTON' || tag === 'SUMMARY') return 1;
  if (tag === 'A' && el.hasAttribute && el.hasAttribute('href')) return 1;
  const role = el.getAttribute ? el.getAttribute('role') : null;
  return role && CONTROL_ROLES[role] ? 1 : 0;
}

// e.key fallbacks for the rare browser / virtual keyboard that leaves e.code empty.
const KEY_TO_CODE = {
  ' ': 'Space',
  Spacebar: 'Space',
  Escape: 'Escape',
  Esc: 'Escape',
  Enter: 'Enter',
  Shift: 'ShiftLeft',
  ArrowUp: 'ArrowUp',
  ArrowDown: 'ArrowDown',
  ArrowLeft: 'ArrowLeft',
  ArrowRight: 'ArrowRight',
  w: 'KeyW',
  a: 'KeyA',
  s: 'KeyS',
  d: 'KeyD',
  q: 'KeyQ',
  e: 'KeyE',
  c: 'KeyC',
  f: 'KeyF',
  p: 'KeyP',
  r: 'KeyR',
  n: 'KeyN',
  h: 'KeyH',
  g: 'KeyG',
  x: 'KeyX',
  1: 'Digit1',
  2: 'Digit2',
  3: 'Digit3',
  4: 'Digit4',
};

export function codeOf(e) {
  if (e.code && e.code !== 'Unidentified') return e.code;
  const k = e.key;
  if (!k) return '';
  return KEY_TO_CODE[k] || KEY_TO_CODE[k.toLowerCase()] || '';
}

/** Keys whose browser default (page scroll, focus move) must not happen during play. */
const PREVENT_IN_GAME = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };

/** Keys the game reacts to (anything else is ignored entirely). */
const BAG_SLOT_KEYS = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3 };
const GAME_KEYS = {
  Digit1: 1,
  Digit2: 1,
  Digit3: 1,
  Digit4: 1,
  Numpad1: 1,
  Numpad2: 1,
  Numpad3: 1,
  Numpad4: 1,
  KeyG: 1,
  KeyX: 1,
  KeyW: 1,
  KeyA: 1,
  KeyS: 1,
  KeyD: 1,
  KeyQ: 1,
  KeyE: 1,
  KeyC: 1,
  KeyF: 1,
  KeyN: 1,
  KeyH: 1,
  KeyP: 1,
  KeyR: 1,
  Space: 1,
  ShiftLeft: 1,
  ShiftRight: 1,
  ArrowUp: 1,
  ArrowDown: 1,
  ArrowLeft: 1,
  ArrowRight: 1,
  Escape: 1,
  Enter: 1,
  NumpadEnter: 1,
};

const LOCK_PAUSE_DEDUPE_MS = 350; // Esc keydown + pointer-lock loss arriving together = one pause
const LOCK_SETTLE_MS = 120; // movement reported right after the lock engages is the cursor warp, not a look
const BLUR_GRACE_MS = 400; // lock lost because the window lost focus is not a pause press

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

export class DesktopInput {
  /**
   * @param {InputManager} im   receives _handPhysical(), _edge(), _desktopLockChanged()
   * @param {HTMLCanvasElement|null} canvas  the element to lock the pointer to
   * @param {object} [env] { window, document } overrides (tests)
   */
  constructor(im, canvas, env) {
    const e = env || {};
    this.im = im;
    this.canvas = canvas || null;
    this.win = e.window !== undefined ? e.window : typeof window !== 'undefined' ? window : null;
    this.doc = e.document !== undefined ? e.document : typeof document !== 'undefined' ? document : null;
    this.keys = Object.create(null);
    this.mouse = { left: false, right: false }; // per HAND: RMB → left, LMB → right
    this.keyHand = { left: false, right: false }; // Q / E
    this.lookX = 0; // accumulated pointer movement (px) since the last consume
    this.lookY = 0;
    this.locked = false;
    this.lockFailed = false; // pointer lock keeps failing for clicks (embedded frame / policy): play unlocked
    this._clickFails = 0;
    this._clickLockAt = -1e9;
    this._lastFailAt = -1e9;
    this.lockSupported = !!(this.canvas && typeof this.canvas.requestPointerLock === 'function');
    this._selfUnlock = false;
    this._lockPauseAt = -1e9;
    this._escPauseAt = -1e9;
    this._blurAt = -1e9;
    this._lockedAt = -1e9;
    this._lockWarp = false;
    this._attached = false;
    this._h = {
      keydown: (ev) => this.onKeyDown(ev),
      keyup: (ev) => this.onKeyUp(ev),
      mousedown: (ev) => this.onMouseDown(ev),
      mouseup: (ev) => this.onMouseUp(ev),
      mousemove: (ev) => this.onMouseMove(ev),
      wheel: (ev) => this.onWheel(ev),
      contextmenu: (ev) => this.onContextMenu(ev),
      lockchange: () => this.onLockChange(),
      lockerror: () => this.onLockError(),
      blur: () => this.onBlur(),
      visibility: () => this.onVisibility(),
    };
    this.attach();
  }

  attach() {
    if (this._attached) return;
    this._attached = true;
    const w = this.win;
    const d = this.doc;
    const h = this._h;
    if (w && w.addEventListener) {
      w.addEventListener('keydown', h.keydown);
      w.addEventListener('keyup', h.keyup);
      w.addEventListener('mousedown', h.mousedown);
      w.addEventListener('mouseup', h.mouseup);
      w.addEventListener('mousemove', h.mousemove);
      w.addEventListener('wheel', h.wheel, { passive: false });
      w.addEventListener('blur', h.blur);
      w.addEventListener('pagehide', h.blur);
    }
    if (this.canvas && this.canvas.addEventListener) this.canvas.addEventListener('contextmenu', h.contextmenu);
    if (d && d.addEventListener) {
      d.addEventListener('pointerlockchange', h.lockchange);
      d.addEventListener('pointerlockerror', h.lockerror);
      d.addEventListener('visibilitychange', h.visibility);
    }
  }

  detach() {
    if (!this._attached) return;
    this._attached = false;
    const w = this.win;
    const d = this.doc;
    const h = this._h;
    if (w && w.removeEventListener) {
      w.removeEventListener('keydown', h.keydown);
      w.removeEventListener('keyup', h.keyup);
      w.removeEventListener('mousedown', h.mousedown);
      w.removeEventListener('mouseup', h.mouseup);
      w.removeEventListener('mousemove', h.mousemove);
      w.removeEventListener('wheel', h.wheel);
      w.removeEventListener('blur', h.blur);
      w.removeEventListener('pagehide', h.blur);
    }
    if (this.canvas && this.canvas.removeEventListener) this.canvas.removeEventListener('contextmenu', h.contextmenu);
    if (d && d.removeEventListener) {
      d.removeEventListener('pointerlockchange', h.lockchange);
      d.removeEventListener('pointerlockerror', h.lockerror);
      d.removeEventListener('visibilitychange', h.visibility);
    }
    this.exitLock();
  }

  // ---------------------------------------------------------------------------
  // State queries (read by the InputManager each frame)
  // ---------------------------------------------------------------------------

  key(code) {
    return this.keys[code] === true;
  }

  handDown(hand) {
    const t = this.im.touch;
    return this.mouse[hand] || this.keyHand[hand] || !!(t && t.fireDown(hand));
  }

  /** Takes the accumulated mouse movement (px) into out {x, y} and zeroes it. */
  consumeLook(out) {
    out.x = this.lookX;
    out.y = this.lookY;
    this.lookX = 0;
    this.lookY = 0;
    return out;
  }

  /** True when mouse buttons may drive tethers right now. */
  get mouseActive() {
    return this.locked || this.lockFailed || !this.lockSupported;
  }

  /** Releases every key and button (blur, tab hidden, XR start, dispose). */
  clear() {
    this.keys = Object.create(null);
    this.lookX = 0;
    this.lookY = 0;
    for (const hand of ['left', 'right']) {
      this.mouse[hand] = false;
      this.keyHand[hand] = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Pointer lock
  // ---------------------------------------------------------------------------

  /** Requests pointer lock (must run inside a user gesture). Returns true when requested. */
  requestLock() {
    const c = this.canvas;
    if (!c || typeof c.requestPointerLock !== 'function' || this.locked) return false;
    try {
      const p = c.requestPointerLock();
      if (p && typeof p.catch === 'function') {
        // Usually the post-Esc cooldown or no user gesture: the next click retries.
        p.catch(() => this._lockFailure());
      }
      return true;
    } catch {
      return false;
    }
  }

  exitLock() {
    const d = this.doc;
    if (!d || !this.locked || typeof d.exitPointerLock !== 'function') return;
    this._selfUnlock = true;
    try {
      d.exitPointerLock();
    } catch {
      this._selfUnlock = false;
    }
  }

  onLockChange() {
    const d = this.doc;
    const was = this.locked;
    this.locked = !!(d && this.canvas && d.pointerLockElement === this.canvas);
    if (this.locked) {
      this.lockFailed = false;
      this._clickFails = 0;
    }
    if (was && !this.locked) {
      const self = this._selfUnlock;
      this._selfUnlock = false;
      // Mouse buttons cannot be trusted across a lock change.
      this.mouse.left = false;
      this.mouse.right = false;
      this._syncHand('left');
      this._syncHand('right');
      const t = nowMs();
      const focusLost = (d && typeof d.hasFocus === 'function' && !d.hasFocus()) || t - this._blurAt < BLUR_GRACE_MS;
      const pause = !self && !focusLost && t - this._escPauseAt > LOCK_PAUSE_DEDUPE_MS;
      if (pause) this._lockPauseAt = t;
      this.im._desktopLockChanged(false, pause);
    } else if (!was && this.locked) {
      this._selfUnlock = false;
      // Chrome reports the cursor's jump to the locked element's centre as one
      // large movement right after locking (here −389, −375 px): it would swing
      // the view the moment a run starts. Drop movement until the lock settles.
      this._lockedAt = nowMs();
      this._lockWarp = true;
      this.lookX = 0;
      this.lookY = 0;
      this.im._desktopLockChanged(true, false);
    }
  }

  onLockError() {
    this._lockFailure();
  }

  /** Counts failed lock requests made by clicks on the view (the event and the promise both report one). */
  _lockFailure() {
    const t = nowMs();
    if (t - this._lastFailAt < 100) return; // same failure reported twice
    this._lastFailAt = t;
    if (t - this._clickLockAt > 1500) return; // not from a click (e.g. setUIMode outside a gesture)
    this._clickFails++;
    if (this._clickFails >= 2) this.lockFailed = true;
  }

  // ---------------------------------------------------------------------------
  // Keyboard
  // ---------------------------------------------------------------------------

  onKeyDown(e) {
    const code = codeOf(e);
    if (!GAME_KEYS[code]) return;
    const kind = controlKind(e.target);
    if (kind === 2) return; // typing in a text field
    const im = this.im;
    const ui = im.uiMode;
    const xr = im.xrActive;
    // Space / Enter on a focused DOM control activate that control; never double-handle them.
    const ctlKey = kind === 1 && (code === 'Space' || code === 'Enter' || code === 'NumpadEnter');
    if (!ui && !xr && PREVENT_IN_GAME[code] && !ctlKey && e.preventDefault) e.preventDefault();
    const wasDown = this.keys[code] === true;
    this.keys[code] = true;
    if (e.repeat || wasDown) return;
    // The bag keys act on the run only (the Game ignores them elsewhere); they are not a "press any key".
    if (code in BAG_SLOT_KEYS || code === 'KeyG' || code === 'KeyX') {
      if (!ui && !xr) {
        if (code === 'KeyG') im._bagEdge('use');
        else if (code === 'KeyX') im._bagEdge('cancel');
        else im._bagEdge('slot', BAG_SLOT_KEYS[code]);
      }
      return;
    }
    im._edge('any');
    switch (code) {
      case 'Space':
        if (!ctlKey) im._edge('jump');
        break;
      case 'KeyQ':
        this.keyHand.left = true;
        this._syncHand('left');
        break;
      case 'KeyE':
        this.keyHand.right = true;
        this._syncHand('right');
        break;
      case 'Escape':
      case 'KeyP': {
        const t = nowMs();
        if (code === 'Escape' && t - this._lockPauseAt < LOCK_PAUSE_DEDUPE_MS) break; // lock loss already paused
        if (code === 'Escape') this._escPauseAt = t;
        im._edge('pause');
        if (ui) im._edge('back');
        break;
      }
      case 'KeyR':
        im._edge('restart');
        break;
      case 'KeyN':
        if (!ui && !xr) im._edge('nv'); // the night vision goggles
        break;
      case 'KeyH':
        if (!ui && !xr) im._edge('holster'); // stow / draw both rope guns
        break;
      case 'Enter':
      case 'NumpadEnter':
        if (!ctlKey) im._edge('confirm');
        break;
      default:
        break;
    }
  }

  onKeyUp(e) {
    const code = codeOf(e);
    if (!code) return;
    delete this.keys[code];
    if (code === 'ShiftLeft' || code === 'ShiftRight') {
      // Some layouts swallow the second Shift's keyup; both sides release together.
      delete this.keys.ShiftLeft;
      delete this.keys.ShiftRight;
    }
    if (code === 'KeyQ' && this.keyHand.left) {
      this.keyHand.left = false;
      this._syncHand('left');
    } else if (code === 'KeyE' && this.keyHand.right) {
      this.keyHand.right = false;
      this._syncHand('right');
    }
  }

  // ---------------------------------------------------------------------------
  // Mouse
  // ---------------------------------------------------------------------------

  _onCanvas(target) {
    const c = this.canvas;
    if (!c || !target) return false;
    return target === c || (typeof c.contains === 'function' && c.contains(target));
  }

  onMouseDown(e) {
    const im = this.im;
    if (im.xrActive) return;
    // The mouse events a touch generates (compat events) belong to the touch layer.
    if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
    const onView = this.locked || this._onCanvas(e.target);
    if (!onView) return;
    if (im.uiMode || !im._inPlay()) return; // menus are DOM: clicks belong to them
    if (!this.locked && this.lockSupported) {
      this._clickLockAt = nowMs();
      if (!this.lockFailed) {
        // First click on the view only captures the mouse.
        this.requestLock();
        if (e.preventDefault) e.preventDefault();
        return;
      }
      // Lock keeps failing: this click also fires, and we keep asking in the background.
      this.requestLock();
    }
    const hand = e.button === 0 ? 'right' : e.button === 2 ? 'left' : null;
    if (!hand) return;
    if (e.preventDefault) e.preventDefault();
    if (this.mouse[hand]) return;
    this.mouse[hand] = true;
    im._edge('any');
    this._syncHand(hand);
  }

  onMouseUp(e) {
    const hand = e.button === 0 ? 'right' : e.button === 2 ? 'left' : null;
    if (!hand || !this.mouse[hand]) return;
    this.mouse[hand] = false;
    this._syncHand(hand);
  }

  onMouseMove(e) {
    if (!this.locked) return;
    const sinceLock = nowMs() - this._lockedAt;
    if (sinceLock < LOCK_SETTLE_MS) {
      this._lockWarp = false;
      return;
    }
    const mx = Number(e.movementX) || 0;
    const my = Number(e.movementY) || 0;
    if (this._lockWarp) {
      // The warp can also arrive late (a busy main thread delays it past the settle
      // window): the first movement after locking is dropped when it is a big jump.
      this._lockWarp = false;
      if (Math.abs(mx) > 80 || Math.abs(my) > 80) return;
    }
    // Guard against the occasional huge first-event jump some browsers emit after locking.
    if (Math.abs(mx) > 400 || Math.abs(my) > 400) return;
    this.lookX += mx;
    this.lookY += my;
  }

  /** Mouse wheel: previous / next bag item while the view is captured during a run. */
  onWheel(e) {
    const im = this.im;
    if (im.xrActive || im.uiMode || !im._inPlay() || !this.mouseActive) return;
    const d = Number(e.deltaY) || Number(e.deltaX) || 0;
    if (d === 0) return;
    if (e.preventDefault) e.preventDefault();
    im._bagEdge('cycle', d > 0 ? 1 : -1);
  }

  onContextMenu(e) {
    if (e.preventDefault) e.preventDefault();
  }

  // ---------------------------------------------------------------------------
  // Focus
  // ---------------------------------------------------------------------------

  onBlur() {
    this._blurAt = nowMs();
    this.im._releaseAll('blur');
  }

  onVisibility() {
    const d = this.doc;
    if (d && d.visibilityState === 'hidden') {
      this._blurAt = nowMs();
      this.im._releaseAll('hidden');
    }
  }

  _syncHand(hand) {
    this.im._handPhysical(hand, this.handDown(hand), 'desktop');
  }
}
