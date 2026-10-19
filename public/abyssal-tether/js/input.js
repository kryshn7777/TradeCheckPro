/* ABYSSAL TETHER — input.js
 * AT.InputManager: unifies mouse, keyboard, gamepad and multi-touch into one
 * per-frame `intent` object (CONTRACT §6 / §15). Touch is first-class:
 *   - a floating left joystick (move / reel, flick up to jump),
 *   - direct touch grappling (touch an anchor to fire; hold to stay attached;
 *     a second finger chains to a new anchor without dropping the first),
 *   - an optional floating right aim stick (preview at 25 %, fire at 80 %),
 *   - optional toggle grappling (tap to attach / tap again to release).
 *
 * Model: DOM events only mutate raw state (held keys, tracked pointers, edge
 * flags, a small queue of grapple transitions). `update(dt)` rebuilds
 * `intent` from that state and is idempotent within a frame; `endFrame()`
 * clears edges and consumes exactly one queued grapple transition, so a press
 * and a release that land inside the same frame are delivered on consecutive
 * frames instead of cancelling each other out.
 *
 * All screen coordinates are CSS pixels relative to the canvas' top-left.
 */
(function (AT) {
  'use strict';

  const U = AT.util;

  // ---------------------------------------------------------------------------
  // Tunables. Copied onto each instance as `input.tuning` so the game (or a
  // settings screen) can adjust them live without editing this file.
  // ---------------------------------------------------------------------------
  const TUNING = {
    // Touch zones as fractions of the canvas size (CONTRACT §6).
    leftZoneMaxX: 0.42,
    rightZoneMinX: 0.58,
    zoneMinY: 0.22,
    // Portrait (H > W) override for zoneMinY. The contract value (0.22) makes the
    // left zone a third of a portrait screen, so anchors drawn there cannot be
    // touched directly; ~0.5 keeps thumbs at the bottom and frees the upper half.
    portraitZoneMinY: 0.5, // portrait: keep the upper half free for grappling anchors
    // Floating sticks.
    stickRadiusFrac: 0.11, // × min(W, H)
    stickRadiusMin: 44,
    stickRadiusMax: 84,
    stickDeadzone: 0.15, // radial, fraction of radius
    stickFollow: 1.15, // finger may stray this far (× radius) before the base is dragged along
    axisSnapDeg: 10, // output within this angle of an axis snaps onto it (no accidental reel while running)
    flickJumpY: -0.65, // left-stick Y crossing that counts as an upward flick → jumpPressed
    flickRearmY: -0.35, // stick must come back below this before another flick can jump
    aimPreview: 0.25, // aim stick: direction shown (target highlight) beyond this
    aimFire: 0.8, // aim stick: fires at this deflection
    aimRearm: 0.5, // aim stick: pulled back under this, a new push past aimFire chains
    screenMargin: 8, // keep stick bases this far inside the safe area
    // Mouse.
    compatMouseGuardMs: 800, // ignore mouse-typed pointer events this long after touch
    mouseReclaimPx: 3, // mouse must move this far to take aim back from keys / pad
    // Keyboard.
    diagonalGraceS: 0.07, // releasing a diagonal: wait this long for the 2nd key before snapping to cardinal
    // Gamepad.
    padDeadzone: 0.2,
    padAimDeadzone: 0.35,
    padTrigger: 0.35,
    // Haptics.
    hapticMinGapMs: 45,
  };

  // Grapple transition kinds (queued) and aim kinds.
  const T_PRESS = 1;
  const T_RELEASE = 2;
  const T_TAP = 3;
  const AIM_LIVE = 0; // use whatever aim is current when the frame is built
  const AIM_SCREEN = 1;
  const AIM_DIR = 2;
  const QUEUE_CAP = 8;

  // Pointer roles.
  const R_NONE = 0; // tracked but ignored until lifted (began in a menu, cancelled …)
  const R_STICK = 1;
  const R_AIM = 2;
  const R_GRAPPLE = 3;

  // e.key fallbacks for the rare browser / virtual keyboard that leaves e.code empty.
  const KEY_TO_CODE = {
    ' ': 'Space',
    Spacebar: 'Space',
    Escape: 'Escape',
    Esc: 'Escape',
    Enter: 'Enter',
    ArrowUp: 'ArrowUp',
    ArrowDown: 'ArrowDown',
    ArrowLeft: 'ArrowLeft',
    ArrowRight: 'ArrowRight',
    Up: 'ArrowUp',
    Down: 'ArrowDown',
    Left: 'ArrowLeft',
    Right: 'ArrowRight',
    a: 'KeyA',
    d: 'KeyD',
    w: 'KeyW',
    s: 'KeyS',
    p: 'KeyP',
    r: 'KeyR',
  };
  const GAME_KEYS = {
    KeyA: 1,
    KeyD: 1,
    KeyW: 1,
    KeyS: 1,
    Space: 1,
    ArrowUp: 1,
    ArrowDown: 1,
    ArrowLeft: 1,
    ArrowRight: 1,
    Escape: 1,
    KeyP: 1,
    KeyR: 1,
    Enter: 1,
    NumpadEnter: 1,
  };
  // Keys whose browser default (scroll / activate focused button) must not
  // fire during gameplay. Never Escape (fullscreen exit) or modifier combos.
  const PREVENT_IN_GAME = { Space: 1, ArrowUp: 1, ArrowDown: 1, ArrowLeft: 1, ArrowRight: 1 };
  const MODIFIER_CODES = {
    ShiftLeft: 1,
    ShiftRight: 1,
    ControlLeft: 1,
    ControlRight: 1,
    AltLeft: 1,
    AltRight: 1,
    MetaLeft: 1,
    MetaRight: 1,
    OSLeft: 1,
    OSRight: 1,
    CapsLock: 1,
    Fn: 1,
  };
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

  // Deferred "menu" key edges (bit mask).
  const E_PAUSE = 1;
  const E_RESTART = 2;
  const E_CONFIRM = 4; // confirm + respawn

  // Standard-mapping gamepad buttons.
  const PB_A = 0;
  const PB_X = 2;
  const PB_RB = 5;
  const PB_RT = 7;
  const PB_BACK = 8;
  const PB_START = 9;
  const PB_UP = 12;
  const PB_DOWN = 13;
  const PB_LEFT = 14;
  const PB_RIGHT = 15;

  const SQRT1_2 = Math.SQRT1_2;

  function nowMs() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  /** 0 = not a control, 1 = button-like control (Space/Enter activate it), 2 = text entry. */
  function controlKind(el) {
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

  function codeOf(e) {
    if (e.code && e.code !== 'Unidentified') return e.code;
    const k = e.key;
    if (!k) return '';
    return KEY_TO_CODE[k] || KEY_TO_CODE[k.toLowerCase()] || '';
  }

  function hapticMs(v) {
    const n = Number(v);
    return isFinite(n) ? U.clamp(Math.round(n), 0, 400) : 0;
  }

  function makeStick() {
    return {
      active: false,
      id: -1,
      radius: 60,
      cx: 0, // logical centre (where output is measured from; may sit outside the drawable area)
      cy: 0,
      fx: 0, // finger position
      fy: 0,
      rawX: 0, // finger offset / radius, clamped to the unit circle
      rawY: 0,
      mag: 0,
      // left stick
      jumpReady: true,
      // aim stick
      toggle: false,
      armed: false,
      rearm: false,
      hasDir: false,
      dirX: 0,
      dirY: -1,
    };
  }

  function makeOverlayStick(withAim) {
    const o = { active: false, baseX: 0, baseY: 0, knobX: 0, knobY: 0, radius: 60, ghostX: 0, ghostY: 0, valueX: 0, valueY: 0 };
    if (withAim) {
      o.fireRatio = 0;
      o.armed = false;
      o.previewing = false;
      o.dirX = 0;
      o.dirY = 0;
    } else {
      o.jumpFlash = 0;
    }
    return o;
  }

  // ===========================================================================
  // InputManager
  // ===========================================================================
  class InputManager {
    /**
     * @param {HTMLCanvasElement} canvas  gameplay canvas (pointer input target)
     * @param {object} settings           LIVE settings object (read at use time)
     * @param {AT.EventBus} [bus]
     */
    constructor(canvas, settings, bus) {
      this.canvas = canvas || null;
      this.settings = settings || Object.assign({}, AT.SETTINGS_DEFAULTS);
      this.bus = bus || null;
      this.tuning = Object.assign({}, TUNING);

      /** Per-frame intent (CONTRACT §6). Rebuilt by update(); same object every frame. */
      this.intent = {
        moveX: 0,
        moveY: 0,
        jumpPressed: false,
        aim: null,
        grapplePressed: false,
        grappleHeld: false,
        grappleReleased: false,
        grappleTap: false,
        pausePressed: false,
        restartPressed: false,
        confirmPressed: false,
        respawnPressed: false,
        anyPressed: false,
      };
      // Reused aim objects (intent.aim points at one of them, or null).
      this._aimScreen = { mode: 'screen', sx: 0, sy: 0, touch: false };
      this._aimDir = { mode: 'dir', dx: 0, dy: -1 };

      /** 'mouse' | 'touch' | 'keyboard' | 'gamepad' — the most recently used device. */
      this.lastSource = 'mouse';
      /** Mouse position in canvas CSS px; `inside` = over the canvas (not over DOM UI). */
      this.mouse = { x: 0, y: 0, inside: false };
      this.mouseSeen = false;
      this.gameplayActive = true;
      this.attached = false;
      /** Safe-area insets in CSS px (auto-probed from env(), or set via setSafeArea). */
      this.safeArea = { top: 0, right: 0, bottom: 0, left: 0 };
      this._safeOverride = false;
      this._touchUIOverride = null;

      // Edge flags (set by events, cleared by endFrame).
      this._edges = { jump: false, pause: false, restart: false, confirm: false, any: false };
      // Menu-type key edges are resolved in update() so we can see whether another
      // handler (e.g. the UI's menu navigation) already consumed the key.
      this._pendingKeys = [];
      for (let i = 0; i < 8; i++) this._pendingKeys.push({ ev: null, mask: 0, menu: false, ctl: 0, pre: false, mine: false });
      this._pendingKeyCount = 0;

      // Grapple transition ring buffer.
      this._q = [];
      for (let i = 0; i < QUEUE_CAP; i++) {
        this._q.push({ type: 0, aimKind: AIM_LIVE, sx: 0, sy: 0, touch: false, dx: 0, dy: 0, heldAfter: false });
      }
      this._qHead = 0;
      this._qLen = 0;

      // Keyboard state.
      this._keys = Object.create(null); // code → bool (physically down)
      this._hLast = ''; // last pressed of KeyA/KeyD
      this._vLast = ''; // last pressed of KeyW/KeyS
      this._keyGrapple = false; // Space currently counts as a grapple hold
      this._keyAimX = 0; // 8-way keyboard aim (unit), persists
      this._keyAimY = -1;
      this._arrowGrace = 0;
      this._aimMode = 'key'; // 'mouse' | 'key' | 'pad' | 'touch' — who owns non-touch aim
      this._mouseAnchorX = 0; // mouse position when keys/pad took the aim
      this._mouseAnchorY = 0;

      // Mouse state.
      this._mouseBtn = false; // LMB physically down (on the canvas)
      this._mouseGrapple = false; // LMB counts as a grapple hold
      this._mouseId = -1;
      this._lastTouchMs = -1e9;

      // Touch / pen pointers.
      this._pointers = new Map();
      this._pool = [];
      this._seq = 0;
      this.leftStick = makeStick();
      this.aimStick = makeStick();
      this._jumpFlash = 0;

      // Gamepad state.
      this._padCount = 0;
      this._padIndex = -1;
      this._padPrev = new Uint8Array(17);
      this._padBlock = true; // first poll (and after blur): adopt current buttons without edges
      this._padGrapple = false;
      this._padMoveX = 0;
      this._padMoveY = 0;
      this._padAimX = 0;
      this._padAimY = -1;
      this._padRef = null;
      this._padActivity = false;

      // Layout cache.
      this._w = 0;
      this._h = 0;
      this._left = 0;
      this._top = 0;
      this._layoutDirty = true;
      this._probe = null;
      this._coarseMql = null;
      this._activated = false; // a user gesture happened (vibrate is blocked before that)
      this._hapticLastAt = -1e9;
      this._hapticBusyUntil = -1e9;
      this._hapticLastMs = 0;

      // Touch overlay (reused object, see getTouchOverlay()).
      this._overlay = {
        visible: false,
        mode: 'direct',
        screenW: 0,
        screenH: 0,
        leftStick: makeOverlayStick(false),
        aimStick: null,
        grappleTouches: [],
        // Extra (not in the contract): where touches spawn sticks, for zone hints / primer art.
        zones: { leftMaxX: 0, rightMinX: 0, minY: 0 },
      };
      this._overlayAim = makeOverlayStick(true);
      this._touchPool = [];
      for (let i = 0; i < 10; i++) this._touchPool.push({ x: 0, y: 0, id: 0 });

      this._bindHandlers();
    }

    // -------------------------------------------------------------------------
    // Lifecycle
    // -------------------------------------------------------------------------

    /** Starts listening to DOM input. Idempotent. */
    attach() {
      if (this.attached || typeof window === 'undefined') return;
      this.attached = true;
      const c = this.canvas;
      const h = this._h_;
      const nonPassive = { passive: false };
      if (c && c.addEventListener) {
        c.addEventListener('pointerdown', h.pointerdown, nonPassive);
        c.addEventListener('pointerenter', h.pointerenter);
        c.addEventListener('pointerleave', h.pointerleave);
        c.addEventListener('contextmenu', h.prevent);
        c.addEventListener('dblclick', h.prevent);
        c.addEventListener('selectstart', h.prevent);
        // iOS: stop callouts, magnifier, double-tap zoom and synthetic clicks
        // even on WebViews that ignore touch-action.
        c.addEventListener('touchstart', h.touchPrevent, nonPassive);
        c.addEventListener('touchmove', h.touchPrevent, nonPassive);
        c.addEventListener('touchend', h.touchPrevent, nonPassive);
      }
      // Moves / lifts are routed by pointerId at window level so they are seen
      // even when capture is lost or the finger slides over DOM UI.
      window.addEventListener('pointermove', h.pointermove, nonPassive);
      window.addEventListener('pointerup', h.pointerup, nonPassive);
      window.addEventListener('pointercancel', h.pointercancel);
      window.addEventListener('pointerout', h.pointerout);
      window.addEventListener('keydown', h.keydown);
      window.addEventListener('keyup', h.keyup);
      window.addEventListener('blur', h.blur);
      window.addEventListener('pagehide', h.blur);
      window.addEventListener('resize', h.resize);
      window.addEventListener('orientationchange', h.orientation);
      window.addEventListener('gamepadconnected', h.padconnect);
      window.addEventListener('gamepaddisconnected', h.paddisconnect);
      if (window.visualViewport) window.visualViewport.addEventListener('resize', h.resize);
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', h.visibility);

      }

      try {
        if (window.matchMedia) {
          this._coarseMql = window.matchMedia('(pointer: coarse)');
          const fine = window.matchMedia('(any-pointer: fine)');
          // Phones / tablets without a mouse start in touch mode so the camera
          // and HUD come up touch-sized before the first tap.
          if (this._coarseMql.matches && !fine.matches) {
            this.lastSource = 'touch';
            this._aimMode = 'touch';
          }
        }
      } catch {
        this._coarseMql = null;
      }
      // Pads already connected before load only announce themselves after a button press,
      // but some browsers list them immediately.
      if (this._listPads()) this._padCount = Math.max(this._padCount, 1);
      this._createProbe();
      this._layoutDirty = true;
      this._refreshLayout();
    }

    /** Stops listening and releases everything. Idempotent. */
    detach() {
      if (!this.attached) return;
      this.releaseAll(false);
      this.attached = false;
      const c = this.canvas;
      const h = this._h_;
      if (c && c.removeEventListener) {
        c.removeEventListener('pointerdown', h.pointerdown);
        c.removeEventListener('pointerenter', h.pointerenter);
        c.removeEventListener('pointerleave', h.pointerleave);
        c.removeEventListener('contextmenu', h.prevent);
        c.removeEventListener('dblclick', h.prevent);
        c.removeEventListener('selectstart', h.prevent);
        c.removeEventListener('touchstart', h.touchPrevent);
        c.removeEventListener('touchmove', h.touchPrevent);
        c.removeEventListener('touchend', h.touchPrevent);
      }
      window.removeEventListener('pointermove', h.pointermove);
      window.removeEventListener('pointerup', h.pointerup);
      window.removeEventListener('pointercancel', h.pointercancel);
      window.removeEventListener('pointerout', h.pointerout);
      window.removeEventListener('keydown', h.keydown);
      window.removeEventListener('keyup', h.keyup);
      window.removeEventListener('blur', h.blur);
      window.removeEventListener('pagehide', h.blur);
      window.removeEventListener('resize', h.resize);
      window.removeEventListener('orientationchange', h.orientation);
      window.removeEventListener('gamepadconnected', h.padconnect);
      window.removeEventListener('gamepaddisconnected', h.paddisconnect);
      if (window.visualViewport) window.visualViewport.removeEventListener('resize', h.resize);
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', h.visibility);

      }
      if (this._probe && this._probe.parentNode) this._probe.parentNode.removeChild(this._probe);
      this._probe = null;
      this._clearEdges();
      this._pendingKeyCount = 0;
    }

    // -------------------------------------------------------------------------
    // Per-frame API
    // -------------------------------------------------------------------------

    /**
     * Rebuilds `intent` from the current raw state. Call once per frame before
     * the game reads `intent`; calling it again in the same frame is harmless
     * (edges persist until endFrame()).
     * @param {number} dt frame delta (s)
     * @returns {object} intent
     */
    update(dt) {
      const step = isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
      if (this._layoutDirty) this._refreshLayout();
      this._pollGamepad();
      if (this._arrowGrace > 0) {
        this._arrowGrace -= step;
        if (this._arrowGrace <= 0) {
          this._arrowGrace = 0;
          this._recomputeKeyAim();
        }
      }
      if (this._jumpFlash > 0) this._jumpFlash = Math.max(0, this._jumpFlash - step * 4);
      this._flushKeyEdges();

      const I = this.intent;
      const E = this._edges;
      const active = this.gameplayActive;
      const s = this.settings || AT.SETTINGS_DEFAULTS;

      // ---- movement: keyboard + gamepad + left stick, summed and clamped --------
      let mx = 0;
      let my = 0;
      if (active) {
        const k = this._keys;
        if (k.KeyA && k.KeyD) mx = this._hLast === 'KeyD' ? 1 : -1;
        else if (k.KeyA) mx = -1;
        else if (k.KeyD) mx = 1;
        if (k.KeyW && k.KeyS) my = this._vLast === 'KeyS' ? 1 : -1;
        else if (k.KeyW) my = -1;
        else if (k.KeyS) my = 1;
        mx += this._padMoveX;
        my += this._padMoveY;
        const st = this.leftStick;
        if (st.active) {
          this._shapeStick(st.rawX, st.rawY, this.tuning.stickDeadzone, s.sensitivity, this._shapeOut);
          mx += this._shapeOut.x;
          my += this._shapeOut.y;
        }
      }
      I.moveX = U.clamp(mx, -1, 1);
      I.moveY = U.clamp(my, -1, 1);

      // ---- grapple: one queued transition per frame -----------------------------
      const head = active && this._qLen > 0 ? this._q[this._qHead] : null;
      I.grapplePressed = !!head && head.type === T_PRESS;
      I.grappleReleased = !!head && head.type === T_RELEASE;
      I.grappleTap = !!head && head.type === T_TAP;
      I.grappleHeld = active && (head ? head.heldAfter : this._holdCount() > 0);

      // ---- aim -------------------------------------------------------------------
      I.aim = active ? this._resolveAim(head) : null;

      // ---- edges -------------------------------------------------------------------
      I.jumpPressed = active && E.jump;
      I.pausePressed = E.pause;
      I.restartPressed = E.restart;
      I.confirmPressed = E.confirm;
      I.respawnPressed = E.confirm;
      I.anyPressed = E.any;
      return I;
    }

    /** Clears edge flags and consumes the grapple transition delivered this frame. */
    endFrame() {
      this._clearEdges();
      if (this._qLen > 0) {
        this._qHead = (this._qHead + 1) % QUEUE_CAP;
        this._qLen--;
      }
    }

    // -------------------------------------------------------------------------
    // Public helpers
    // -------------------------------------------------------------------------

    /** Show on-screen touch controls now? (settings.touchControls: 'always' | 'never' | 'auto'). */
    get touchUI() {
      if (this._touchUIOverride !== null) return this._touchUIOverride;
      const mode = this.settings && this.settings.touchControls;
      if (mode === 'always') return true;
      if (mode === 'never') return false;
      return this.lastSource === 'touch' || !!(this._coarseMql && this._coarseMql.matches);
    }
    /** Force (true/false) or un-force (null) the touch UI flag — for tests / debug. */
    set touchUI(v) {
      this._touchUIOverride = v === null || v === undefined ? null : !!v;
    }

    /**
     * Gameplay vs menus. While false, canvas pointers are tracked but never
     * become sticks or grapples (a finger that started in a menu stays inert
     * until lifted), and move / aim / grapple intent is neutral. Menu edges
     * (pause, restart, confirm, respawn, any) are still reported.
     * @param {boolean} active
     */
    setGameplayActive(active) {
      const on = !!active;
      if (on === this.gameplayActive) return;
      this.gameplayActive = on;
      // Fingers that are down right now never carry over between menus and play.
      this._neutraliseTouches();
      this._qHead = 0;
      this._qLen = 0;
      if (!on) this._edges.jump = false;
    }

    /**
     * Overrides the auto-probed safe-area insets (CSS px). Pass null to go back
     * to probing env(safe-area-inset-*).
     */
    setSafeArea(insets) {
      if (!insets) {
        this._safeOverride = false;
        this._layoutDirty = true;
        return;
      }
      this._safeOverride = true;
      const sa = this.safeArea;
      sa.top = Math.max(0, +insets.top || 0);
      sa.right = Math.max(0, +insets.right || 0);
      sa.bottom = Math.max(0, +insets.bottom || 0);
      sa.left = Math.max(0, +insets.left || 0);
    }

    /**
     * Releases every held input (keys, mouse button, sticks, fingers, pad).
     * Used on blur / visibilitychange / pagehide / detach so nothing sticks.
     * @param {boolean} [emitRelease=true] queue a grappleReleased if a grapple was held
     */
    releaseAll(emitRelease) {
      const wasHeld = this._holdCount() > 0;
      this._keys = Object.create(null);
      this._hLast = '';
      this._vLast = '';
      this._keyGrapple = false;
      this._arrowGrace = 0;
      this._mouseBtn = false;
      this._mouseGrapple = false;
      this._mouseId = -1;
      this.mouse.inside = false;
      this._padGrapple = false;
      this._padMoveX = 0;
      this._padMoveY = 0;
      this._padBlock = true; // buttons still physically held must not re-fire on return
      this._neutraliseTouches();
      this._qHead = 0;
      this._qLen = 0;
      this._edges.jump = false;
      if (wasHeld && emitRelease !== false) this._push(T_RELEASE, AIM_LIVE, 0, 0, false);
    }

    /**
     * Everything the renderer needs to draw the touch controls (CSS px).
     * Returns the same object every call — read it, don't keep it.
     */
    getTouchOverlay() {
      if (this._layoutDirty) this._refreshLayout();
      const o = this._overlay;
      const s = this.settings || AT.SETTINGS_DEFAULTS;
      const T = this.tuning;
      const W = this._w;
      const H = this._h;
      const sa = this.safeArea;
      const R = this._stickRadius();
      const stickMode = s.touchAimMode === 'stick';
      o.visible = this.touchUI && this.gameplayActive;
      o.mode = stickMode ? 'stick' : 'direct';
      o.screenW = W;
      o.screenH = H;
      o.zones.leftMaxX = W * T.leftZoneMaxX;
      o.zones.rightMinX = stickMode ? W * T.rightZoneMinX : W;
      o.zones.minY = this._zoneTop();

      // Ghost spots: bottom corners inside the safe area, roughly under the thumbs.
      const gap = Math.max(18, R * 0.5);
      const ghostLX = sa.left + gap + R;
      const ghostRX = W - sa.right - gap - R;
      const ghostY = H - sa.bottom - gap - R;

      const L = o.leftStick;
      const ls = this.leftStick;
      L.ghostX = ghostLX;
      L.ghostY = ghostY;
      L.jumpFlash = this._jumpFlash;
      this._fillOverlayStick(L, ls, ghostLX, ghostY, R);
      if (ls.active) {
        this._shapeStick(ls.rawX, ls.rawY, T.stickDeadzone, s.sensitivity, this._shapeOut);
        L.valueX = this._shapeOut.x;
        L.valueY = this._shapeOut.y;
      } else {
        L.valueX = 0;
        L.valueY = 0;
      }

      if (stickMode || this.aimStick.active) {
        const A = this._overlayAim;
        const as = this.aimStick;
        A.ghostX = ghostRX;
        A.ghostY = ghostY;
        this._fillOverlayStick(A, as, ghostRX, ghostY, R);
        A.fireRatio = as.active ? U.clamp(as.mag / T.aimFire, 0, 1) : 0;
        A.armed = as.active && as.armed;
        A.previewing = as.active && (as.hasDir || as.armed);
        A.dirX = A.previewing ? as.dirX : 0;
        A.dirY = A.previewing ? as.dirY : 0;
        A.valueX = as.active ? as.rawX : 0;
        A.valueY = as.active ? as.rawY : 0;
        o.aimStick = A;
      } else {
        o.aimStick = null;
      }

      const list = o.grappleTouches;
      list.length = 0;
      for (const rec of this._pointers.values()) {
        if (rec.role !== R_GRAPPLE || list.length >= this._touchPool.length) continue;
        const t = this._touchPool[list.length];
        t.x = rec.x;
        t.y = rec.y;
        t.id = rec.id;
        list.push(t);
      }
      return o;
    }

    /**
     * Haptic pulse: navigator.vibrate on phones, rumble on gamepads (when the
     * pad is the active device). No-op when unsupported or settings.haptics is
     * false. Rate-limited: a weaker pulse never interrupts a stronger one.
     * @param {number|number[]} pattern ms, or [on, off, on, …] ms
     * @returns {boolean} whether a pulse was issued
     */
    haptic(pattern) {
      const s = this.settings;
      if (!s || s.haptics === false || typeof navigator === 'undefined') return false;
      let total = 0;
      let clean;
      if (Array.isArray(pattern)) {
        clean = [];
        for (let i = 0; i < pattern.length && i < 10; i++) {
          const v = hapticMs(pattern[i]);
          clean.push(v);
          if (i % 2 === 0) total += v;
        }
      } else {
        clean = hapticMs(pattern);
        total = clean;
      }
      if (total <= 0) return false;
      const t = nowMs();
      if (t < this._hapticBusyUntil && total <= this._hapticLastMs) return false;
      if (t - this._hapticLastAt < this.tuning.hapticMinGapMs && total <= this._hapticLastMs) return false;

      let ok = false;
      if (this.lastSource === 'gamepad') {
        ok = this._rumble(total);
      } else if (this._activated && typeof navigator.vibrate === 'function') {
        try {
          ok = navigator.vibrate(clean) !== false;
        } catch {
          ok = false;
        }
      }
      if (ok) {
        this._hapticLastAt = t;
        this._hapticLastMs = total;
        this._hapticBusyUntil = t + (Array.isArray(clean) ? clean.reduce((a, b) => a + b, 0) : total);
      }
      return ok;
    }

    // -------------------------------------------------------------------------
    // Internals: handlers
    // -------------------------------------------------------------------------

    _bindHandlers() {
      this._shapeOut = { x: 0, y: 0 };
      this._h_ = {
        pointerdown: (e) => this._onPointerDown(e),
        pointermove: (e) => this._onPointerMove(e),
        pointerup: (e) => this._onPointerEnd(e, false),
        pointercancel: (e) => this._onPointerEnd(e, true),
        pointerenter: (e) => {
          if (this._isMouse(e)) this.mouse.inside = true;
        },
        pointerleave: (e) => {
          if (this._isMouse(e)) this.mouse.inside = false;
        },
        pointerout: (e) => {
          // Leaving the browser window entirely (no related target).
          if (!e.relatedTarget && (e.pointerType || 'mouse') === 'mouse') this.mouse.inside = false;
        },
        prevent: (e) => {
          if (e.cancelable) e.preventDefault();
        },
        touchPrevent: (e) => {
          if (e.cancelable) e.preventDefault();
        },
        keydown: (e) => this._onKeyDown(e),
        keyup: (e) => this._onKeyUp(e),
        blur: () => this.releaseAll(true),
        visibility: () => {
          if (typeof document !== 'undefined' && document.visibilityState === 'hidden') this.releaseAll(true);
        },
        resize: () => {
          this._layoutDirty = true;
        },
        orientation: () => {
          // The layout is about to change under the fingers: drop sticks and
          // grapple touches (lifting them later does nothing) rather than
          // leave a stick pointing somewhere stale.
          this._layoutDirty = true;
          const held = this._holdCount() > 0;
          this._neutraliseTouches();
          if (held && this._holdCount() === 0) this._push(T_RELEASE, AIM_LIVE, 0, 0, false);
        },
        padconnect: () => {
          this._padCount++;
          this._padBlock = true;
        },
        paddisconnect: () => {
          this._padCount = Math.max(0, this._padCount - 1);
          this._padLost();
        },
      };
    }

    /** True for a genuine mouse pointer event (not a touch-compat event). */
    _isMouse(e) {
      const type = e.pointerType || 'mouse';
      if (type !== 'mouse') return false;
      // Compatibility mouse events synthesised from touches must never steal the aim back.
      if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return false;
      return nowMs() - this._lastTouchMs > this.tuning.compatMouseGuardMs;
    }

    _localX(e) {
      return e.clientX - this._left;
    }
    _localY(e) {
      return e.clientY - this._top;
    }

    _onPointerDown(e) {
      this._activated = true;
      this._edges.any = true;
      const type = e.pointerType || 'mouse';
      if (type === 'mouse') {
        if (this._isMouse(e)) this._onMouseButtons(e, true);
        return;
      }
      // ---- touch / pen ----
      if (e.cancelable) e.preventDefault(); // no compat mouse events, no focus / selection
      this._lastTouchMs = nowMs();
      this._setSource('touch');
      this._refreshLayout(); // pointerdown is rare: always measure fresh
      const x = this._localX(e);
      const y = this._localY(e);
      const old = this._pointers.get(e.pointerId);
      if (old) this._endPointer(old, old.x, old.y); // missed lift for a reused id
      const rec = this._allocPointer(e.pointerId, x, y);
      try {
        if (this.canvas && this.canvas.setPointerCapture) this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // pointer already gone — the window-level listeners still see its lift
      }
      if (!this.gameplayActive) {
        rec.role = R_NONE;
        return;
      }
      const s = this.settings || AT.SETTINGS_DEFAULTS;
      this._aimMode = 'touch';
      if (!this.leftStick.active && this._inLeftZone(x, y)) {
        rec.role = R_STICK;
        this._startStick(this.leftStick, rec, x, y);
        this.leftStick.jumpReady = true;
      } else if (s.touchAimMode === 'stick' && !this.aimStick.active && this._inRightZone(x, y)) {
        rec.role = R_AIM;
        this._startStick(this.aimStick, rec, x, y);
        this.aimStick.toggle = s.touchGrappleMode === 'toggle';
        this.aimStick.armed = false;
        this.aimStick.rearm = false;
        this.aimStick.hasDir = false;
      } else {
        // Direct grapple touch: aim at the finger. The newest finger always
        // drives the aim and re-targets (chain) while older ones keep the hold.
        rec.role = R_GRAPPLE;
        rec.seq = ++this._seq;
        rec.toggle = s.touchGrappleMode === 'toggle';
        if (rec.toggle) {
          this._push(T_TAP, AIM_SCREEN, x, y, true);
        } else {
          rec.live = true;
          this._push(T_PRESS, AIM_SCREEN, x, y, true);
        }
      }
    }

    _onPointerMove(e) {
      const type = e.pointerType || 'mouse';
      if (type === 'mouse') {
        if (!this._isMouse(e)) return;
        this._onMouseMove(e);
        this._onMouseButtons(e, false); // chorded button changes arrive as moves
        return;
      }
      const rec = this._pointers.get(e.pointerId);
      if (!rec) return;
      this._lastTouchMs = nowMs();
      rec.x = this._localX(e);
      rec.y = this._localY(e);
      if (rec.role === R_STICK) this._moveLeftStick(rec.x, rec.y);
      else if (rec.role === R_AIM) this._moveAimStick(rec.x, rec.y);
    }

    _onPointerEnd(e, cancelled) {
      const type = e.pointerType || 'mouse';
      if (type === 'mouse') {
        if (cancelled) {
          this._mouseButtonUp();
        } else if (this._isMouse(e)) {
          this._onMouseMove(e);
          this._onMouseButtons(e, false);
        } else if (this._mouseBtn && !(e.buttons & 1)) {
          this._mouseButtonUp();
        }
        return;
      }
      const rec = this._pointers.get(e.pointerId);
      if (!rec) return;
      if (cancelled) {
        this._endPointer(rec, rec.x, rec.y);
      } else {
        this._lastTouchMs = nowMs();
        this._endPointer(rec, this._localX(e), this._localY(e));
      }
    }

    // ---- mouse ------------------------------------------------------------------

    _onMouseMove(e) {
      if (this._layoutDirty) this._refreshLayout();
      const x = this._localX(e);
      const y = this._localY(e);
      const moved = !this.mouseSeen || x !== this.mouse.x || y !== this.mouse.y;
      this.mouse.x = x;
      this.mouse.y = y;
      this.mouse.inside = e.target === this.canvas && x >= 0 && y >= 0 && x <= this._w && y <= this._h;
      this.mouseSeen = true;
      if (!moved) return;
      if (this._aimMode === 'mouse') {
        this._setSource('mouse');
        return;
      }
      // Keys / pad / touch own the aim: take it back only on a deliberate move.
      const d = Math.abs(x - this._mouseAnchorX) + Math.abs(y - this._mouseAnchorY);
      if (this._aimMode === 'touch' || d >= this.tuning.mouseReclaimPx) {
        this._aimMode = 'mouse';
        this._setSource('mouse');
      }
    }

    /** Syncs the LMB from `e.buttons` (handles pointerdown/up and chorded moves). */
    _onMouseButtons(e, isDown) {
      const lmb = isDown ? e.button === 0 || (e.buttons & 1) === 1 : (e.buttons & 1) === 1;
      if (isDown) {
        this._onMouseMove(e);
        if (e.button === 1 && e.cancelable) e.preventDefault(); // middle-click autoscroll
        this._aimMode = 'mouse';
        this._setSource('mouse');
      }
      if (lmb && !this._mouseBtn) {
        if (!isDown && e.target !== this.canvas) return; // a chord that began on DOM UI
        this._mouseBtn = true;
        this._mouseId = e.pointerId;
        try {
          if (this.canvas && this.canvas.setPointerCapture) this.canvas.setPointerCapture(e.pointerId);
        } catch {
          // ignore
        }
        if (this.gameplayActive) {
          this._mouseGrapple = true;
          this._push(T_PRESS, AIM_SCREEN, this.mouse.x, this.mouse.y, false);
        }
      } else if (!lmb && this._mouseBtn) {
        this._mouseButtonUp();
      }
    }

    _mouseButtonUp() {
      this._mouseBtn = false;
      this._mouseId = -1;
      if (this._mouseGrapple) {
        this._mouseGrapple = false;
        if (this._holdCount() === 0) this._push(T_RELEASE, AIM_SCREEN, this.mouse.x, this.mouse.y, false);
      }
    }

    // ---- keyboard ---------------------------------------------------------------

    _onKeyDown(e) {
      const code = codeOf(e);
      if (!code) return;
      const ctl = controlKind(e.target);
      if (ctl === 2) return; // typing in a text field
      if (e.ctrlKey || e.metaKey || e.altKey) return; // browser / OS shortcuts stay untouched
      if (!GAME_KEYS[code]) {
        if (!e.repeat && !MODIFIER_CODES[code]) {
          this._edges.any = true;
          this._activated = true;
        }
        return;
      }
      const active = this.gameplayActive;
      const pre = e.defaultPrevented; // consumed by a listener that ran before us
      let mine = false;
      // During play, Space / arrows must not scroll or activate a focused button.
      // In menus, a focused control keeps its native keyboard behaviour.
      if (PREVENT_IN_GAME[code] && e.cancelable && (active || !ctl)) {
        e.preventDefault();
        mine = true;
      }
      if (e.repeat) return;
      this._activated = true;
      this._edges.any = true;
      this._keys[code] = true;
      this._setSource('keyboard');

      switch (code) {
        case 'KeyA':
        case 'KeyD':
          this._hLast = code;
          break;
        case 'KeyW':
          this._vLast = code;
          if (active) this._edges.jump = true; // W = jump when grounded (physics decides)
          break;
        case 'KeyS':
          this._vLast = code;
          break;
        case 'Space':
          if (active) {
            this._keyGrapple = true;
            this._push(T_PRESS, AIM_LIVE, 0, 0, false);
          }
          this._queueKeyEdge(e, E_CONFIRM, active, ctl, pre, mine);
          break;
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight':
          if (active) {
            this._arrowGrace = 0;
            this._recomputeKeyAim();
            this._takeAim('key');
          }
          break;
        case 'Escape':
        case 'KeyP':
          this._queueKeyEdge(e, E_PAUSE, active, ctl, pre, mine);
          break;
        case 'KeyR':
          this._queueKeyEdge(e, E_RESTART, active, ctl, pre, mine);
          break;
        case 'Enter':
        case 'NumpadEnter':
          this._queueKeyEdge(e, E_CONFIRM, active, ctl, pre, mine);
          break;
        default:
          break;
      }
    }

    _onKeyUp(e) {
      const code = codeOf(e);
      if (!code) return;
      // Always clear state, whatever the modifiers or focus, so keys never stick.
      if (code === 'MetaLeft' || code === 'MetaRight' || code === 'OSLeft' || code === 'OSRight') {
        // macOS swallows keyups of keys released while ⌘ is down.
        const held = this._keyGrapple;
        this._keys = Object.create(null);
        this._hLast = '';
        this._vLast = '';
        if (held) this._keyGrappleUp();
        return;
      }
      if (!this._keys[code]) return;
      this._keys[code] = false;
      if (this.gameplayActive && PREVENT_IN_GAME[code] && e.cancelable) e.preventDefault();
      switch (code) {
        case 'KeyA':
          if (this._hLast === code) this._hLast = this._keys.KeyD ? 'KeyD' : '';
          break;
        case 'KeyD':
          if (this._hLast === code) this._hLast = this._keys.KeyA ? 'KeyA' : '';
          break;
        case 'KeyW':
          if (this._vLast === code) this._vLast = this._keys.KeyS ? 'KeyS' : '';
          break;
        case 'KeyS':
          if (this._vLast === code) this._vLast = this._keys.KeyW ? 'KeyW' : '';
          break;
        case 'Space':
          this._keyGrappleUp();
          break;
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          // Releasing a diagonal: the two keys rarely come up on the same frame.
          // Hold the diagonal briefly so it doesn't collapse onto one axis.
          const diag = this._keyAimX !== 0 && this._keyAimY !== 0;
          const k = this._keys;
          const remaining = (k.ArrowUp ? 1 : 0) + (k.ArrowDown ? 1 : 0) + (k.ArrowLeft ? 1 : 0) + (k.ArrowRight ? 1 : 0);
          if (diag && remaining === 1) this._arrowGrace = this.tuning.diagonalGraceS;
          else if (remaining > 0) this._recomputeKeyAim();
          break;
        }
        default:
          break;
      }
    }

    _keyGrappleUp() {
      if (!this._keyGrapple) return;
      this._keyGrapple = false;
      if (this._holdCount() === 0) this._push(T_RELEASE, AIM_LIVE, 0, 0, false);
    }

    /** 8-way aim from the held arrows; keeps the previous direction when none are held. */
    _recomputeKeyAim() {
      const k = this._keys;
      const dx = (k.ArrowRight ? 1 : 0) - (k.ArrowLeft ? 1 : 0);
      const dy = (k.ArrowDown ? 1 : 0) - (k.ArrowUp ? 1 : 0);
      if (dx === 0 && dy === 0) return;
      const n = dx !== 0 && dy !== 0 ? SQRT1_2 : 1;
      this._keyAimX = dx * n;
      this._keyAimY = dy * n;
    }

    _takeAim(mode) {
      if (this._aimMode !== mode) {
        this._mouseAnchorX = this.mouse.x;
        this._mouseAnchorY = this.mouse.y;
      }
      this._aimMode = mode;
    }

    /**
     * Pause / restart / confirm edges are resolved in update(): if a menu
     * handler (e.g. the UI's Esc = back, Enter on a focused button) already
     * consumed the key with preventDefault(), the game must not see it twice.
     */
    _queueKeyEdge(e, mask, active, ctl, pre, mine) {
      if (this._pendingKeyCount >= this._pendingKeys.length) {
        this._applyKeyEdge(mask, active, ctl); // overflow: apply without the consumed-check
        return;
      }
      const p = this._pendingKeys[this._pendingKeyCount++];
      p.ev = e;
      p.mask = mask;
      p.menu = !active;
      p.ctl = ctl;
      p.pre = !!pre;
      p.mine = !!mine; // our own preventDefault (Space / arrows) is not "consumed elsewhere"
    }

    _flushKeyEdges() {
      for (let i = 0; i < this._pendingKeyCount; i++) {
        const p = this._pendingKeys[i];
        // Only menus can consume keys; in gameplay every edge goes through.
        const consumed = p.menu && (p.pre || (!p.mine && !!p.ev && p.ev.defaultPrevented));
        if (!consumed) this._applyKeyEdge(p.mask, !p.menu, p.ctl);
        p.ev = null;
      }
      this._pendingKeyCount = 0;
    }

    _applyKeyEdge(mask, active, ctl) {
      if (mask & E_PAUSE) this._edges.pause = true;
      if (mask & E_RESTART) this._edges.restart = true;
      // Enter / Space on a focused menu button activates that button natively;
      // reporting confirm/respawn as well would double-trigger it.
      if (mask & E_CONFIRM && !(ctl === 1 && !active)) this._edges.confirm = true;
    }

    // ---- touch: sticks ----------------------------------------------------------

    /** Top edge (CSS px) of both stick zones for the current orientation. */
    _zoneTop() {
      const T = this.tuning;
      return this._h * (this._h > this._w ? T.portraitZoneMinY : T.zoneMinY);
    }
    _inLeftZone(x, y) {
      return x < this._w * this.tuning.leftZoneMaxX && y > this._zoneTop();
    }
    _inRightZone(x, y) {
      return x > this._w * this.tuning.rightZoneMinX && y > this._zoneTop();
    }

    _stickRadius() {
      const T = this.tuning;
      const m = Math.min(this._w || 0, this._h || 0);
      return U.clamp(m * T.stickRadiusFrac, T.stickRadiusMin, T.stickRadiusMax);
    }

    _startStick(st, rec, x, y) {
      st.active = true;
      st.id = rec.id;
      st.radius = this._stickRadius(); // fixed for this touch (no jumps on resize)
      st.cx = x;
      st.cy = y;
      st.fx = x;
      st.fy = y;
      st.rawX = 0;
      st.rawY = 0;
      st.mag = 0;
    }

    /** Shared stick kinematics: finger → raw unit-circle offset, base follows a runaway finger. */
    _trackStick(st, x, y) {
      st.fx = x;
      st.fy = y;
      const R = st.radius;
      let dx = x - st.cx;
      let dy = y - st.cy;
      let d = Math.hypot(dx, dy);
      const maxD = R * this.tuning.stickFollow;
      if (d > maxD) {
        // Drag the base along so reversing direction responds immediately.
        const k = (d - maxD) / d;
        st.cx += dx * k;
        st.cy += dy * k;
        dx = x - st.cx;
        dy = y - st.cy;
        d = maxD;
      }
      const m = Math.min(d / R, 1);
      st.mag = m;
      if (d > 1e-6) {
        st.rawX = (dx / d) * m;
        st.rawY = (dy / d) * m;
      } else {
        st.rawX = 0;
        st.rawY = 0;
      }
    }

    _moveLeftStick(x, y) {
      const st = this.leftStick;
      if (!st.active) return;
      this._trackStick(st, x, y);
      // Upward flick → jump (once per flick; re-armed when the stick comes back down).
      if (st.jumpReady && st.rawY <= this.tuning.flickJumpY) {
        st.jumpReady = false;
        if (this.gameplayActive) {
          this._edges.jump = true;
          this._jumpFlash = 1;
        }
      } else if (!st.jumpReady && st.rawY > this.tuning.flickRearmY) {
        st.jumpReady = true;
      }
    }

    _moveAimStick(x, y) {
      const st = this.aimStick;
      if (!st.active) return;
      const T = this.tuning;
      this._trackStick(st, x, y);
      const m = st.mag;
      if (m >= T.aimPreview) {
        st.dirX = st.rawX / m;
        st.dirY = st.rawY / m;
        st.hasDir = true;
      } else if (!st.armed) {
        st.hasDir = false;
      }
      if (st.armed && !st.rearm && m < T.aimRearm) st.rearm = true;
      if (m >= T.aimFire && (!st.armed || st.rearm)) {
        const chain = st.armed;
        st.armed = true;
        st.rearm = false;
        if (st.toggle) {
          this._push(T_TAP, AIM_DIR, st.dirX, st.dirY, false);
        } else {
          if (!chain) st.live = true;
          this._push(T_PRESS, AIM_DIR, st.dirX, st.dirY, false);
        }
      }
    }

    /**
     * Radial dead-zone + sensitivity response curve + axis snap.
     * sensitivity 0.5..2: higher = less travel to full output, steeper curve.
     */
    _shapeStick(rx, ry, deadzone, sensitivity, out) {
      out.x = 0;
      out.y = 0;
      const m = Math.hypot(rx, ry);
      if (m <= deadzone || m < 1e-6) return out;
      const sens = U.clamp(+sensitivity || 1, 0.5, 2);
      const sat = U.clamp(0.95 - 0.1 * (sens - 1), 0.8, 1); // deflection that gives full output
      const t = U.clamp((m - deadzone) / Math.max(sat - deadzone, 0.05), 0, 1);
      const gamma = U.clamp(1.25 * Math.pow(sens, -0.75), 0.6, 2.2);
      const v = Math.pow(t, gamma);
      let ux = rx / m;
      let uy = ry / m;
      const snap = Math.tan(this.tuning.axisSnapDeg * U.DEG);
      if (Math.abs(uy) < Math.abs(ux) * snap) {
        ux = ux > 0 ? 1 : -1;
        uy = 0;
      } else if (Math.abs(ux) < Math.abs(uy) * snap) {
        ux = 0;
        uy = uy > 0 ? 1 : -1;
      }
      out.x = ux * v;
      out.y = uy * v;
      return out;
    }

    _fillOverlayStick(o, st, ghostX, ghostY, R) {
      if (!st.active) {
        o.active = false;
        o.radius = R;
        o.baseX = ghostX;
        o.baseY = ghostY;
        o.knobX = ghostX;
        o.knobY = ghostY;
        return;
      }
      // Draw the base fully on screen (inside the safe area) even when the
      // logical centre sits nearer the edge; the knob keeps the true offset.
      const sa = this.safeArea;
      const m = this.tuning.screenMargin;
      const r = st.radius;
      const minX = sa.left + r + m;
      const maxX = this._w - sa.right - r - m;
      const minY = sa.top + r + m;
      const maxY = this._h - sa.bottom - r - m;
      o.active = true;
      o.radius = r;
      o.baseX = maxX > minX ? U.clamp(st.cx, minX, maxX) : this._w / 2;
      o.baseY = maxY > minY ? U.clamp(st.cy, minY, maxY) : this._h / 2;
      o.knobX = o.baseX + st.rawX * r;
      o.knobY = o.baseY + st.rawY * r;
    }

    // ---- touch: pointer records -------------------------------------------------

    _allocPointer(id, x, y) {
      const rec = this._pool.pop() || { id: 0, x: 0, y: 0, role: R_NONE, seq: 0, toggle: false, live: false };
      rec.id = id;
      rec.x = x;
      rec.y = y;
      rec.role = R_NONE;
      rec.seq = 0;
      rec.toggle = false;
      rec.live = false;
      this._pointers.set(id, rec);
      return rec;
    }

    _endPointer(rec, x, y) {
      rec.x = x;
      rec.y = y;
      this._pointers.delete(rec.id);
      switch (rec.role) {
        case R_STICK:
          if (this.leftStick.id === rec.id) this._resetStick(this.leftStick);
          break;
        case R_AIM: {
          const st = this.aimStick;
          if (st.id === rec.id) {
            const wasLive = st.live;
            const dx = st.dirX;
            const dy = st.dirY;
            this._resetStick(st);
            if (wasLive && this._holdCount() === 0) this._push(T_RELEASE, AIM_DIR, dx, dy, false);
          }
          break;
        }
        case R_GRAPPLE:
          if (rec.live) {
            rec.live = false;
            // Lifting an older finger while a newer one is down keeps the hold.
            if (this._holdCount() === 0) this._push(T_RELEASE, AIM_SCREEN, x, y, true);
          }
          break;
        default:
          break;
      }
      rec.role = R_NONE;
      this._pool.push(rec);
    }

    _resetStick(st) {
      st.active = false;
      st.id = -1;
      st.rawX = 0;
      st.rawY = 0;
      st.mag = 0;
      st.armed = false;
      st.rearm = false;
      st.hasDir = false;
      st.live = false;
      st.jumpReady = true;
    }

    /** Every current touch becomes inert until lifted (no transitions are queued). */
    _neutraliseTouches() {
      for (const rec of this._pointers.values()) {
        rec.role = R_NONE;
        rec.live = false;
      }
      this._resetStick(this.leftStick);
      this._resetStick(this.aimStick);
    }

    // ---- grapple aggregation ----------------------------------------------------

    /** Number of live grapple holds across all devices. */
    _holdCount() {
      let n = 0;
      if (this._mouseGrapple) n++;
      if (this._keyGrapple) n++;
      if (this._padGrapple) n++;
      if (this.aimStick.active && this.aimStick.live) n++;
      for (const rec of this._pointers.values()) {
        if (rec.role === R_GRAPPLE && rec.live) n++;
      }
      return n;
    }

    /** Queues a grapple transition (only while gameplay is active). */
    _push(type, aimKind, a, b, touch) {
      if (!this.gameplayActive) return;
      if (this._qLen >= QUEUE_CAP) {
        // Pathological backlog (nobody is calling endFrame): drop the oldest.
        this._qHead = (this._qHead + 1) % QUEUE_CAP;
        this._qLen--;
      }
      const q = this._q[(this._qHead + this._qLen) % QUEUE_CAP];
      this._qLen++;
      q.type = type;
      q.aimKind = aimKind;
      q.touch = !!touch;
      if (aimKind === AIM_DIR) {
        q.dx = a;
        q.dy = b;
      } else {
        q.sx = a;
        q.sy = b;
      }
      q.heldAfter = type === T_RELEASE ? false : this._holdCount() > 0;
    }

    /** Aim for this frame: queued transition's point → active finger → aim stick → device. */
    _resolveAim(head) {
      if (head && head.aimKind === AIM_SCREEN) return this._setScreenAim(head.sx, head.sy, head.touch);
      if (head && head.aimKind === AIM_DIR) return this._setDirAim(head.dx, head.dy);

      // Newest live direct-touch finger drives the aim.
      let best = null;
      for (const rec of this._pointers.values()) {
        if (rec.role === R_GRAPPLE && (!best || rec.seq > best.seq)) best = rec;
      }
      if (best) return this._setScreenAim(best.x, best.y, true);

      const as = this.aimStick;
      if (as.active && (as.hasDir || as.armed)) return this._setDirAim(as.dirX, as.dirY);

      switch (this._aimMode) {
        case 'mouse':
          return this.mouseSeen ? this._setScreenAim(this.mouse.x, this.mouse.y, false) : null;
        case 'key':
          return this._setDirAim(this._keyAimX, this._keyAimY);
        case 'pad':
          return this._setDirAim(this._padAimX, this._padAimY);
        default:
          return null; // touch with no finger on an aim: no highlight
      }
    }

    _setScreenAim(x, y, touch) {
      const a = this._aimScreen;
      a.sx = x;
      a.sy = y;
      a.touch = !!touch;
      return a;
    }

    _setDirAim(dx, dy) {
      const a = this._aimDir;
      a.dx = dx;
      a.dy = dy;
      return a;
    }

    // ---- gamepad ----------------------------------------------------------------

    _listPads() {
      if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
      try {
        const pads = navigator.getGamepads();
        if (!pads) return null;
        for (let i = 0; i < pads.length; i++) {
          if (pads[i] && pads[i].connected !== false) return pads[i];
        }
      } catch {
        return null;
      }
      return null;
    }

    _pollGamepad() {
      if (this._padCount <= 0) return;
      const pad = this._listPads();
      if (!pad) {
        this._padLost();
        return;
      }
      this._padRef = pad;
      this._padIndex = pad.index;
      const T = this.tuning;
      const E = this._edges;
      const block = this._padBlock;
      this._padBlock = false;
      const active = this.gameplayActive;
      this._padActivity = false;

      // Buttons → edges (A = jump / confirm, Start = pause, Back = restart).
      if (this._padEdge(pad, PB_A, block)) {
        E.any = true;
        E.confirm = true;
        if (active) E.jump = true;
      }
      if (this._padEdge(pad, PB_START, block)) {
        E.any = true;
        E.pause = true;
      }
      if (this._padEdge(pad, PB_BACK, block)) {
        E.any = true;
        E.restart = true;
      }
      for (let i = 1; i < 17; i++) {
        if (i === PB_START || i === PB_BACK || i === PB_RT || i === PB_RB || i === PB_X) continue;
        if (this._padEdge(pad, i, block)) E.any = true;
      }
      // Grapple (RT / RB / X): hold semantics; a second button while held chains.
      const fresh = this._padEdge(pad, PB_RT, block) | this._padEdge(pad, PB_RB, block) | this._padEdge(pad, PB_X, block);
      const prev = this._padPrev;
      const held = prev[PB_RT] || prev[PB_RB] || prev[PB_X];
      if (fresh) {
        E.any = true;
        if (active) {
          this._padGrapple = true;
          this._push(T_PRESS, AIM_LIVE, 0, 0, false);
        }
      } else if (!held && this._padGrapple) {
        this._padGrapple = false;
        if (this._holdCount() === 0) this._push(T_RELEASE, AIM_LIVE, 0, 0, false);
      }

      // Left stick (+ d-pad) → move / reel.
      const ax = pad.axes || [];
      let lx = +ax[0] || 0;
      let ly = +ax[1] || 0;
      const lm = Math.hypot(lx, ly);
      if (lm > 1) {
        lx /= lm;
        ly /= lm;
      }
      const sens = this.settings ? this.settings.sensitivity : 1;
      const shaped = this._shapeStick(lx, ly, T.padDeadzone, sens, this._shapeOut);
      const mx = shaped.x + this._padPressed(pad, PB_RIGHT) - this._padPressed(pad, PB_LEFT);
      const my = shaped.y + this._padPressed(pad, PB_DOWN) - this._padPressed(pad, PB_UP);
      this._padMoveX = U.clamp(mx, -1, 1);
      this._padMoveY = U.clamp(my, -1, 1);
      if (mx !== 0 || my !== 0) this._padActivity = true;

      // Right stick → aim direction (persists when the stick recentres).
      const rx = +ax[2] || 0;
      const ry = +ax[3] || 0;
      const rm = Math.hypot(rx, ry);
      if (rm > T.padAimDeadzone) {
        this._padAimX = rx / rm;
        this._padAimY = ry / rm;
        if (active) this._takeAim('pad');
        this._padActivity = true;
      }
      if (this._padActivity) {
        this._activated = true;
        this._setSource('gamepad');
      }
    }

    /** 1 if standard-mapping button i is down (RT uses an analogue threshold), else 0. */
    _padPressed(pad, i) {
      const btn = pad.buttons ? pad.buttons[i] : null;
      if (btn == null) return 0;
      if (typeof btn === 'number') return btn > 0.5 ? 1 : 0;
      if (i === PB_RT) return btn.pressed || (+btn.value || 0) > this.tuning.padTrigger ? 1 : 0;
      return btn.pressed ? 1 : 0;
    }

    /** Updates the remembered state of button i; true on a fresh press (never while `block`). */
    _padEdge(pad, i, block) {
      const now = this._padPressed(pad, i);
      const was = this._padPrev[i];
      this._padPrev[i] = now;
      if (now && !was && !block) {
        this._padActivity = true;
        return true;
      }
      return false;
    }

    _padLost() {
      this._padRef = null;
      this._padIndex = -1;
      this._padMoveX = 0;
      this._padMoveY = 0;
      this._padPrev.fill(0);
      this._padBlock = true;
      if (this._padGrapple) {
        this._padGrapple = false;
        if (this._holdCount() === 0) this._push(T_RELEASE, AIM_LIVE, 0, 0, false);
      }
      if (this._aimMode === 'pad') this._aimMode = this.lastSource === 'touch' ? 'touch' : 'key';
    }

    _rumble(ms) {
      const pad = this._padRef;
      const act = pad && pad.vibrationActuator;
      if (!act || typeof act.playEffect !== 'function') return false;
      try {
        const strength = U.clamp(ms / 40, 0.25, 1);
        const p = act.playEffect('dual-rumble', {
          startDelay: 0,
          duration: ms,
          weakMagnitude: strength,
          strongMagnitude: strength * 0.6,
        });
        if (p && typeof p.catch === 'function') p.catch(() => {});
        return true;
      } catch {
        return false;
      }
    }

    // ---- misc -------------------------------------------------------------------

    _setSource(src) {
      this.lastSource = src;
    }

    _clearEdges() {
      const E = this._edges;
      E.jump = false;
      E.pause = false;
      E.restart = false;
      E.confirm = false;
      E.any = false;
    }

    _refreshLayout() {
      this._layoutDirty = false;
      const c = this.canvas;
      if (c && typeof c.getBoundingClientRect === 'function') {
        const r = c.getBoundingClientRect();
        this._left = r.left;
        this._top = r.top;
        this._w = r.width || c.clientWidth || 0;
        this._h = r.height || c.clientHeight || 0;
      } else if (typeof window !== 'undefined') {
        this._left = 0;
        this._top = 0;
        this._w = window.innerWidth || 0;
        this._h = window.innerHeight || 0;
      }
      if (!this._safeOverride) this._readProbe();
    }

    /** Hidden element whose padding is env(safe-area-inset-*) — read via computed style. */
    _createProbe() {
      if (this._probe || typeof document === 'undefined' || !document.body) return;
      try {
        const el = document.createElement('div');
        el.setAttribute('aria-hidden', 'true');
        el.style.cssText =
          'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
          'padding-top:env(safe-area-inset-top,0px);padding-right:env(safe-area-inset-right,0px);' +
          'padding-bottom:env(safe-area-inset-bottom,0px);padding-left:env(safe-area-inset-left,0px);';
        document.body.appendChild(el);
        this._probe = el;
      } catch {
        this._probe = null;
      }
    }

    _readProbe() {
      const el = this._probe;
      if (!el || typeof getComputedStyle !== 'function') return;
      try {
        const cs = getComputedStyle(el);
        const sa = this.safeArea;
        sa.top = parseFloat(cs.paddingTop) || 0;
        sa.right = parseFloat(cs.paddingRight) || 0;
        sa.bottom = parseFloat(cs.paddingBottom) || 0;
        sa.left = parseFloat(cs.paddingLeft) || 0;
      } catch {
        // keep previous insets
      }
    }
  }

  InputManager.TUNING = TUNING;
  AT.InputManager = InputManager;
})((window.AT = window.AT || {}));
