/* ABYSSAL TETHER 3D — xrInput.js
 * WebXR side of the input layer: session lifecycle (support probe, request,
 * reference space, end), the controller slots three.js tracks for us, and a
 * per-hand snapshot of every Quest Touch / Touch Plus control read through
 * the xr-standard gamepad mapping:
 *
 *   buttons[0] trigger   buttons[1] grip (squeeze)   buttons[3] stick click
 *   buttons[4] A / X     buttons[5] B / Y            axes[2], axes[3] thumbstick
 *
 * Hand tracking is optional: an XRHand input source has no usable trigger, so
 * its primary action (pinch → 'selectstart' / 'selectend') stands in for it.
 *
 * Poses are not copied here: three.js updates each slot's target-ray and grip
 * Groups (rig-local matrices) at the start of every XR frame, before the
 * animation callback runs. The InputManager composes them with the rig.
 * The pure helpers (buttonValue, readSource, makeXRHand) have no three.js or
 * DOM dependency so they can be unit-tested in Node.
 */

const HANDS = ['left', 'right'];

export const XR_SLOT_COUNT = 4; // two controllers + room for hands / extra sources
export const XR_OPTIONAL_FEATURES = ['local-floor', 'bounded-floor', 'hand-tracking'];

/** xr-standard button indices. */
export const XRB = { TRIGGER: 0, GRIP: 1, TOUCHPAD: 2, STICK: 3, PRIMARY: 4, SECONDARY: 5 };

/** Analogue value of a GamepadButton (0..1); digital buttons report 1 when pressed. */
export function buttonValue(b) {
  if (b == null) return 0;
  if (typeof b === 'number') return isFinite(b) ? b : 0;
  const v = typeof b.value === 'number' && isFinite(b.value) ? b.value : 0;
  return v > 0 ? v : b.pressed ? 1 : 0;
}

function axis(v) {
  return typeof v === 'number' && isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
}

/** Per-hand raw controller state (plain data). */
export function makeXRHand(hand) {
  return {
    hand,
    connected: false,
    kind: 'none', // 'controller' | 'hand' | 'pointer' | 'none'
    slot: -1,
    source: null,
    trigger: 0,
    triggerDown: false, // trigger with hysteresis
    select: false, // primary action from select events (pinch on tracked hands)
    grip: 0,
    stickX: 0,
    stickY: 0,
    stickClick: false,
    primary: false, // A (right) / X (left)
    secondary: false, // B (right) / Y (left)
    rayTracked: false,
    gripTracked: false,
  };
}

/**
 * Reads one XRInputSource into a hand record. Pure (testable in Node).
 * @param {object} st      record from makeXRHand (mutated)
 * @param {object} source  XRInputSource or null
 * @param {boolean} select select-event state of that source
 * @param {object} tuning  { triggerOn, triggerOff, buttonOn }
 */
export function readSource(st, source, select, tuning) {
  const gp = source && source.gamepad ? source.gamepad : null;
  st.kind = !source ? 'none' : source.hand ? 'hand' : gp ? 'controller' : 'pointer';
  st.select = !!select && !!source;
  const b = gp && gp.buttons ? gp.buttons : null;
  if (b && b.length) {
    st.trigger = buttonValue(b[XRB.TRIGGER]);
    st.triggerDown = st.triggerDown ? st.trigger > tuning.triggerOff : st.trigger >= tuning.triggerOn;
    st.grip = buttonValue(b[XRB.GRIP]);
    st.stickClick = buttonValue(b[XRB.STICK]) >= tuning.buttonOn;
    st.primary = buttonValue(b[XRB.PRIMARY]) >= tuning.buttonOn;
    st.secondary = buttonValue(b[XRB.SECONDARY]) >= tuning.buttonOn;
  } else {
    st.trigger = 0;
    st.triggerDown = false;
    st.grip = 0;
    st.stickClick = false;
    st.primary = false;
    st.secondary = false;
  }
  const ax = gp && gp.axes ? gp.axes : null;
  let sx = 0;
  let sy = 0;
  if (ax && ax.length >= 4) {
    sx = axis(ax[2]);
    sy = axis(ax[3]);
    // Non-standard runtimes sometimes report a lone stick on axes 0/1.
    if (gp.mapping !== 'xr-standard' && sx === 0 && sy === 0) {
      sx = axis(ax[0]);
      sy = axis(ax[1]);
    }
  } else if (ax && ax.length >= 2) {
    sx = axis(ax[0]);
    sy = axis(ax[1]);
  }
  st.stickX = sx;
  st.stickY = sy;
  return st;
}

/** Physical "tether" button of a hand: the trigger, or a pinch for tracked hands / pointers. */
export function tetherDown(st) {
  if (st.kind === 'controller') return st.triggerDown;
  return st.triggerDown || st.select;
}

function hasFeature(list, name) {
  if (!list) return null; // unknown (older browsers do not expose enabledFeatures)
  try {
    return Array.prototype.indexOf.call(list, name) >= 0;
  } catch {
    return null;
  }
}

// =============================================================================
// XRInput — owns the controller slots and the session lifecycle.
// =============================================================================
export class XRInput {
  /**
   * @param {THREE.WebGLRenderer} renderer (renderer.xr is the WebXRManager)
   * @param {THREE.Object3D|null} rig  the controller Groups are parented here
   * @param {object} tuning shared INPUT_TUNING
   */
  constructor(renderer, rig, tuning) {
    this.renderer = renderer || null;
    this.xr = renderer && renderer.xr ? renderer.xr : null;
    this.rig = rig || null;
    this.tuning = tuning;
    this.slots = [];
    this.hands = { left: makeXRHand('left'), right: makeXRHand('right') };
    this.session = null;
    this.visibility = 'visible';
    this.refSpaceType = 'local-floor';
    this.entering = false;
    this.lastError = null;
    // Callbacks wired by the InputManager.
    this.onStart = null;
    this.onEnd = null;
    this.onVisibility = null;
    this.onReset = null;

    this._refSpace = null;
    this._onSessionStart = () => this._sessionStarted();
    this._onSessionEnd = () => this._sessionEnded();
    this._onVisibilityChange = () => {
      const s = this.session;
      this.visibility = s && s.visibilityState ? s.visibilityState : 'visible';
      if (this.onVisibility) this.onVisibility(this.visibility);
    };
    this._onRefReset = () => {
      if (this.onReset) this.onReset();
    };

    if (this.xr && typeof this.xr.getController === 'function') {
      for (let i = 0; i < XR_SLOT_COUNT; i++) this._makeSlot(i);
      if (typeof this.xr.addEventListener === 'function') {
        this.xr.addEventListener('sessionstart', this._onSessionStart);
        this.xr.addEventListener('sessionend', this._onSessionEnd);
      }
    }
  }

  _makeSlot(index) {
    const ray = this.xr.getController(index);
    const grip = typeof this.xr.getControllerGrip === 'function' ? this.xr.getControllerGrip(index) : null;
    const slot = { index, ray, grip, source: null, select: false };
    ray.name = `xr-ray-${index}`;
    if (grip) grip.name = `xr-grip-${index}`;
    ray.addEventListener('connected', (e) => {
      slot.source = e && e.data ? e.data : null;
      slot.select = false;
    });
    ray.addEventListener('disconnected', () => {
      slot.source = null;
      slot.select = false;
    });
    ray.addEventListener('selectstart', () => {
      slot.select = true;
    });
    ray.addEventListener('selectend', () => {
      slot.select = false;
    });
    if (this.rig) {
      this.rig.add(ray);
      if (grip) this.rig.add(grip);
    }
    this.slots.push(slot);
  }

  get presenting() {
    return !!(this.xr && this.xr.isPresenting && this.session);
  }

  // ---------------------------------------------------------------------------
  // Session lifecycle
  // ---------------------------------------------------------------------------

  /** Resolves true when an immersive-vr session can be requested here. */
  static isSupported() {
    try {
      if (typeof navigator === 'undefined' || !navigator.xr || typeof navigator.xr.isSessionSupported !== 'function') {
        return Promise.resolve(false);
      }
      if (typeof window !== 'undefined' && window.isSecureContext === false) return Promise.resolve(false);
      return Promise.resolve(navigator.xr.isSessionSupported('immersive-vr')).then(
        (ok) => !!ok,
        () => false,
      );
    } catch {
      return Promise.resolve(false);
    }
  }

  /**
   * Requests and starts an immersive-vr session. requestSession() is called
   * synchronously (before any await) so the caller's user gesture still
   * counts. Resolves to the session; rejects with the browser's error.
   */
  enter() {
    if (this.session) return Promise.resolve(this.session);
    if (this.entering) return Promise.reject(new Error('An XR session request is already pending'));
    const nx = typeof navigator !== 'undefined' ? navigator.xr : null;
    if (!this.xr) return Promise.reject(new Error('The renderer has no WebXR manager'));
    if (!nx || typeof nx.requestSession !== 'function') return Promise.reject(new Error('WebXR is not available in this browser'));
    this.entering = true;
    this.lastError = null;
    let request;
    try {
      request = nx.requestSession('immersive-vr', { optionalFeatures: XR_OPTIONAL_FEATURES.slice() });
    } catch (err) {
      this.entering = false;
      this.lastError = err;
      return Promise.reject(err);
    }
    return Promise.resolve(request)
      .then((session) => this._start(session))
      .then(
        (session) => {
          this.entering = false;
          return session;
        },
        (err) => {
          this.entering = false;
          this.lastError = err;
          throw err;
        },
      );
  }

  async _start(session) {
    const floor = hasFeature(session.enabledFeatures, 'local-floor');
    this.refSpaceType = floor === false ? 'local' : 'local-floor';
    this.xr.setReferenceSpaceType(this.refSpaceType);
    try {
      await this.xr.setSession(session);
    } catch (err) {
      if (this.refSpaceType !== 'local-floor') throw await this._abort(session, err);
      // Some runtimes grant the session but not the floor space: fall back to 'local'.
      try {
        this.refSpaceType = 'local';
        this.xr.setReferenceSpaceType('local');
        await this.xr.setSession(session);
      } catch (err2) {
        throw await this._abort(session, err2);
      }
    }
    return session;
  }

  async _abort(session, err) {
    try {
      await session.end();
    } catch {
      /* already ended */
    }
    return err;
  }

  /** Ends the current session (no-op when none). */
  exit() {
    const s = this.session || (this.xr && typeof this.xr.getSession === 'function' ? this.xr.getSession() : null);
    if (!s || typeof s.end !== 'function') return Promise.resolve();
    try {
      return Promise.resolve(s.end()).catch(() => {});
    } catch {
      return Promise.resolve();
    }
  }

  _sessionStarted() {
    const s = typeof this.xr.getSession === 'function' ? this.xr.getSession() : null;
    this.session = s;
    this.visibility = s && s.visibilityState ? s.visibilityState : 'visible';
    if (s && typeof s.addEventListener === 'function') s.addEventListener('visibilitychange', this._onVisibilityChange);
    const ref = typeof this.xr.getReferenceSpace === 'function' ? this.xr.getReferenceSpace() : null;
    this._refSpace = ref;
    if (ref && typeof ref.addEventListener === 'function') ref.addEventListener('reset', this._onRefReset);
    for (const slot of this.slots) slot.select = false;
    if (this.onStart) this.onStart(s);
  }

  _sessionEnded() {
    const s = this.session;
    if (s && typeof s.removeEventListener === 'function') s.removeEventListener('visibilitychange', this._onVisibilityChange);
    if (this._refSpace && typeof this._refSpace.removeEventListener === 'function') {
      this._refSpace.removeEventListener('reset', this._onRefReset);
    }
    this._refSpace = null;
    this.session = null;
    this.visibility = 'visible';
    for (const slot of this.slots) {
      slot.select = false;
      slot.source = null;
    }
    for (const h of HANDS) {
      const st = this.hands[h];
      st.connected = false;
      st.source = null;
      st.slot = -1;
      readSource(st, null, false, this.tuning);
      st.rayTracked = false;
      st.gripTracked = false;
    }
    if (this.onEnd) this.onEnd();
  }

  // ---------------------------------------------------------------------------
  // Per-frame polling
  // ---------------------------------------------------------------------------

  /** Best slot for a hand: matching handedness, a real controller over a tracked hand, tracked over lost. */
  slotFor(hand) {
    let best = null;
    let bestScore = -1;
    for (let i = 0; i < this.slots.length; i++) {
      const s = this.slots[i];
      const src = s.source;
      if (!src || src.handedness !== hand) continue;
      let score = 1;
      if (src.gamepad && !src.hand) score += 2;
      if (s.ray.visible) score += 4;
      if (score > bestScore) {
        best = s;
        bestScore = score;
      }
    }
    return best;
  }

  /** Refreshes both hand records from the live input sources. */
  poll() {
    const blurred = this.visibility !== 'visible';
    for (const h of HANDS) {
      const st = this.hands[h];
      const slot = this.slotFor(h);
      st.slot = slot ? slot.index : -1;
      st.source = slot ? slot.source : null;
      st.connected = !!slot;
      st.rayTracked = !!(slot && slot.ray.visible) && !blurred;
      st.gripTracked = !!(slot && slot.grip && slot.grip.visible) && !blurred;
      // While the session is blurred (system menu) the gamepads are frozen: read nothing.
      readSource(st, blurred ? null : st.source, slot && !blurred ? slot.select : false, this.tuning);
    }
  }

  slot(hand) {
    const i = this.hands[hand].slot;
    return i >= 0 ? this.slots[i] : null;
  }

  /** The XR camera (current-frame head pose in its rig-local .matrix) or null. */
  headCamera() {
    if (!this.presenting || typeof this.xr.getCamera !== 'function') return null;
    const cam = this.xr.getCamera();
    return cam && cam.cameras && cam.cameras.length ? cam : null;
  }

  /** GamepadHapticActuator-ish object for a hand, or null. */
  gamepadFor(hand) {
    const st = this.hands[hand];
    return st.source && st.source.gamepad ? st.source.gamepad : null;
  }

  dispose() {
    if (this.xr && typeof this.xr.removeEventListener === 'function') {
      this.xr.removeEventListener('sessionstart', this._onSessionStart);
      this.xr.removeEventListener('sessionend', this._onSessionEnd);
    }
    for (const slot of this.slots) {
      if (slot.ray.parent) slot.ray.parent.remove(slot.ray);
      if (slot.grip && slot.grip.parent) slot.grip.parent.remove(slot.grip);
    }
  }
}
