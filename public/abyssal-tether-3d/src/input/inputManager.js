/* ABYSSAL TETHER 3D — inputManager.js
 * Builds one `intent` per frame (CONTRACT §2) from either a WebXR session
 * (Quest Touch / Touch Plus controllers via the xr-standard gamepad mapping;
 * optional hand tracking where a pinch is the trigger) or the desktop
 * (pointer-locked mouse look + keyboard).
 *
 * Quest:  trigger = that hand's tether (hold to stay attached)
 *         grip on a tethered hand = yank that rope
 *         left stick = move / swing / air control, relative to HEAD yaw
 *         right stick X = smooth turn (no snap), right stick Y = reel (up = in)
 *         A = jump (+ confirm)   B = pause (+ back while a panel is up)
 *         X = restart while paused / dead (never mid-run)    hold Y = recenter
 *         left stick click = brake
 * Desktop: see desktopInput.js (LMB right tether, RMB left tether, WASD, …).
 *
 * Frame model (as in the 2D game): device events and per-frame polls mutate
 * raw state and OR edge flags; update(dt) builds `intent` from that state and
 * is idempotent within a frame; endFrame() clears the edges. A tether button
 * pressed and released inside one frame is delivered as a press this frame
 * and a release the next, so a quick tap is never lost.
 *
 * Trigger ownership: a press made while a VR panel is up (setUIMode(true))
 * clicks the panel and never reaches the tethers, even after the panel
 * closes, until that trigger is physically released. A tether that was
 * already held when a panel opened stays held. Window blur, tab hide, XR
 * 'visible-blurred' / 'hidden' and session start/end release everything; a
 * trigger still held when input returns must be pressed again.
 *
 * Poses: three.js updates the controller Groups (children of the rig) and
 * the XR head camera at the start of each XR frame. Everything here composes
 * them with the rig's CURRENT transform, so handPose() called after the Game
 * moved the rig (e.g. by the rope view) is exact for this frame.
 */

import { Group, Matrix4, Quaternion, Vector3 } from 'three';
import { U } from '../sim/config3d.js';
import { XRInput, tetherDown } from './xrInput.js';
import { DesktopInput } from './desktopInput.js';

export const HANDS = ['left', 'right'];

/** Rig below the body centre in XR (CONTRACT §8: rig = player − (0, 1.1, 0)). */
export const XR_RIG_DROP = 1.1;

export const INPUT_TUNING = {
  // --- XR controls ----------------------------------------------------------
  triggerOn: 0.55, // trigger counts as pressed at this value …
  triggerOff: 0.35, // … and released below this one (hysteresis)
  buttonOn: 0.5,
  stickDeadzone: 0.16, // radial, left stick (move)
  turnDeadzone: 0.18,
  reelDeadzone: 0.22,
  rightStickAxisLockDeg: 28, // right stick within this of an axis → pure turn / pure reel
  turnRate: 2.6, // rad/s at full deflection, × settings.turnSpeed
  turnExponent: 1.6, // response curve: fine control near the centre
  gripDeadzone: 0.25, // a resting finger on the grip is not a yank
  recenterHoldS: 0.8, // hold Y this long to recenter
  // --- desktop ---------------------------------------------------------------
  mouseRadPerPx: 0.0022, // × settings.mouseSensitivity
  keyLookRate: 1.9, // rad/s arrow-key look, × settings.mouseSensitivity
  pitchLimit: 1.48,
  desktopHand: { x: 0.2, y: -0.2, z: -0.48 }, // virtual right hand in camera space (left mirrors x)
  desktopScale: 0.72, // virtual launchers are drawn a little smaller than life on a flat screen
  desktopConverge: 16, // virtual launchers point at the view centre this far ahead (m)
  // --- hands -----------------------------------------------------------------
  muzzle: { x: 0, y: 0.03, z: -0.17 }, // launcher muzzle in the hand-socket frame = rope origin
  xrFallbackHand: { x: 0.2, y: -0.4, z: -0.22 }, // head-relative stand-in while a controller is lost
  localSpaceEyeHeight: 1.6, // assumed eye height when only a 'local' reference space is granted
  // --- haptics ---------------------------------------------------------------
  hapticMaxMs: 2000,
};

const DEG = Math.PI / 180;

function makeRay() {
  return { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: -1 };
}

function makePose() {
  return { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1 };
}

function makeHandIntent() {
  return { aim: null, pressed: false, held: false, released: false, yank: 0 };
}

/** A fresh intent object (CONTRACT §2) plus a few documented extras. */
export function makeIntent() {
  return {
    move: { x: 0, z: 0 },
    reel: 0,
    jumpPressed: false,
    brake: false,
    turnRate: 0,
    hands: { left: makeHandIntent(), right: makeHandIntent() },
    pausePressed: false,
    restartPressed: false,
    confirmPressed: false,
    backPressed: false,
    ui: { ray: null, click: false },
    // extras (not in the contract; harmless to ignore)
    anyPressed: false,
    source: 'desktop',
  };
}

function makeTrigger() {
  return {
    phys: false, // physical button state as last seen
    game: false, // gameplay "held" (what the tether sees)
    blocked: false, // physically held, but the press belongs to the UI / predates a release-all
    reblock: false, // XR: on the next poll, a still-held trigger becomes blocked
    pressEdge: false,
    releaseEdge: false,
    pendingRelease: false, // released in the same frame it was pressed → deliver next frame
  };
}

function makeButton() {
  return { prev: false, down: false, blocked: false };
}

/** Polls a button; returns true on a press edge. Blocked buttons need a physical release first. */
function pollButton(b, raw) {
  if (b.blocked) {
    if (!raw) b.blocked = false;
    b.prev = raw;
    b.down = false;
    return false;
  }
  const edge = raw && !b.prev;
  b.prev = raw;
  b.down = raw;
  return edge;
}

/** Deadzone + rescale + response curve for one axis. */
function shapeAxis(v, dz, exp) {
  const a = Math.abs(v);
  if (a <= dz) return 0;
  const t = Math.min(1, (a - dz) / (1 - dz));
  return Math.sign(v) * (exp === 1 ? t : Math.pow(t, exp));
}

/** Heading (rotation about +Y) of a rotation matrix, YXZ convention (robust looking straight up/down). */
export function yawOfMatrix(te) {
  if (Math.abs(te[9]) < 0.9999) return Math.atan2(te[8], te[10]);
  return Math.atan2(-te[2], te[0]);
}

function rayFromMatrix(te, out) {
  out.ox = te[12];
  out.oy = te[13];
  out.oz = te[14];
  let dx = -te[8];
  let dy = -te[9];
  let dz = -te[10];
  const l = Math.hypot(dx, dy, dz) || 1;
  dx /= l;
  dy /= l;
  dz /= l;
  out.dx = dx;
  out.dy = dy;
  out.dz = dz;
  return out;
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

/** Copies the per-frame debug override (Game debug.setInput) onto the intent. */
function applyOverride(I, o) {
  if (!o || typeof o !== 'object') return;
  if (o.move) {
    if (typeof o.move.x === 'number') I.move.x = o.move.x;
    if (typeof o.move.z === 'number') I.move.z = o.move.z;
  }
  if (typeof o.reel === 'number') I.reel = o.reel;
  if (typeof o.turnRate === 'number') I.turnRate = o.turnRate;
  for (const k of ['jumpPressed', 'brake', 'pausePressed', 'restartPressed', 'confirmPressed', 'backPressed', 'anyPressed']) {
    if (k in o) I[k] = !!o[k];
  }
  if (o.hands) {
    for (const h of HANDS) {
      const src = o.hands[h];
      if (!src) continue;
      const dst = I.hands[h];
      for (const k of ['pressed', 'held', 'released']) if (k in src) dst[k] = !!src[k];
      if (typeof src.yank === 'number') dst.yank = src.yank;
      if ('aim' in src) dst.aim = src.aim;
    }
  }
  if (o.ui) {
    if ('ray' in o.ui) I.ui.ray = o.ui.ray;
    if ('click' in o.ui) I.ui.click = !!o.ui.click;
  }
}

// =============================================================================
// InputManager
// =============================================================================
export class InputManager {
  /**
   * @param {object} opts
   * @param {THREE.WebGLRenderer} opts.renderer  (a Renderer3D is accepted too)
   * @param {THREE.PerspectiveCamera} opts.camera  child of the rig
   * @param {THREE.Object3D} opts.rig     the Group the Game moves; controllers are parented here
   * @param {HTMLCanvasElement} [opts.canvas]  defaults to renderer.domElement
   * @param {object} opts.settings  live settings object (read every frame)
   * @param {EventBus} [opts.bus]
   * @param {object} [opts.tuning]  overrides for INPUT_TUNING
   * @param {object} [opts.env]     { window, document } overrides for tests
   */
  constructor(opts = {}) {
    let renderer = opts.renderer || null;
    this.renderer3d = null;
    if (renderer && !renderer.xr && renderer.renderer && renderer.renderer.xr) {
      this.renderer3d = renderer;
      renderer = renderer.renderer;
    }
    const r3 = this.renderer3d;
    this.renderer = renderer;
    this.camera = opts.camera || (r3 && r3.camera) || null;
    this.rig = opts.rig || (r3 && r3.rig) || (this.camera && this.camera.parent) || null;
    this.canvas = opts.canvas || (renderer && renderer.domElement) || null;
    this.settings = opts.settings || {};
    this.bus = opts.bus || null;
    /** Optional Game3D (read-only: its `state` gates desktop capture and the X restart). */
    this.game = opts.game || null;
    this.tuning = Object.assign({}, INPUT_TUNING, opts.tuning || {});

    this.mode = 'desktop';
    this.uiMode = false;
    this.uiHand = this._dominant();
    /** Rig-local head position captured by the last recenter (XR). */
    this.recenterOffset = { x: 0, y: 0, z: 0 };
    this.lastError = null;

    this.intent = makeIntent();
    this._edges = { jump: false, pause: false, restart: false, confirm: false, back: false, any: false, click: false };
    this._ht = { left: makeTrigger(), right: makeTrigger() };
    this._btn = { a: makeButton(), b: makeButton(), x: makeButton(), y: makeButton(), l3: makeButton() };
    this._aim = { left: makeRay(), right: makeRay() };
    this._uiRay = makeRay();
    this._pose = { left: makePose(), right: makePose() };
    this._head = { x: 0, y: 0, z: 0, qx: 0, qy: 0, qz: 0, qw: 1, yaw: 0 };
    this._rigPos = { x: 0, y: 0, z: 0 };
    this._override = null;
    this._yHold = 0;
    this._recenterLatched = false;
    this._recenterPending = false;
    this._haptic = { left: { until: 0, i: 0 }, right: { until: 0, i: 0 } };
    this._look = { x: 0, y: 0 };
    this._savedCam = null;
    // Game state seen on the bus: X restarts only while paused / dead (never mid-run).
    this._gameState = null;
    this._playerDead = false;
    this._unsub = [];
    if (this.bus && typeof this.bus.on === 'function') {
      const on = (type, fn) => {
        const off = this.bus.on(type, fn);
        if (typeof off === 'function') this._unsub.push(off);
      };
      on('game:state', (p) => {
        this._gameState = p && typeof p.state === 'string' ? p.state : null;
      });
      on('player:death', () => {
        this._playerDead = true;
      });
      for (const t of ['game:start', 'game:restart', 'game:respawn', 'game:menu']) {
        on(t, () => {
          this._playerDead = false;
        });
      }
    }

    // Scratch (no per-frame allocation).
    this._m1 = new Matrix4();
    this._m2 = new Matrix4();
    this._m3 = new Matrix4();
    this._q = new Quaternion();
    this._v = new Vector3();
    this._v2 = new Vector3();
    this._s = new Vector3();
    this._muzzle = new Vector3(this.tuning.muzzle.x, this.tuning.muzzle.y, this.tuning.muzzle.z);

    // Hand sockets: XR → under the hand's grip Group, aligned with its target ray;
    // desktop → virtual hands near the bottom corners of the view. Hand visuals
    // (HandsView) hang their launcher meshes here.
    this.sockets = { left: new Group(), right: new Group() };
    this.sockets.left.name = 'AT3D-hand-left';
    this.sockets.right.name = 'AT3D-hand-right';
    this._deskQuat = { left: new Quaternion(), right: new Quaternion() };
    this._computeDesktopHands();

    this.xrIn = new XRInput(renderer, this.rig, this.tuning);
    this.xrIn.onStart = () => this._onSessionStart();
    this.xrIn.onEnd = () => this._onSessionEnd();
    this.xrIn.onVisibility = (state) => this._onXRVisibility(state);
    this.xrIn.onReset = () => {
      // The system re-aligned the reference space (Quest: hold the Meta button).
      this._recenterPending = true;
    };

    this.desktop = new DesktopInput(this, this.canvas, opts.env);
    this._placeDesktopSockets();
  }

  // ---------------------------------------------------------------------------
  // Public state
  // ---------------------------------------------------------------------------

  /** True while an immersive XR session is presenting. */
  get xrActive() {
    return this.xrIn.presenting;
  }

  /** Current rig yaw (rad). */
  get yaw() {
    return this.rig ? this.rig.rotation.y : this.camera ? this.camera.rotation.y : 0;
  }

  /** Desktop: true while the pointer is locked to the view. */
  get pointerLocked() {
    return this.desktop.locked;
  }

  // ---------------------------------------------------------------------------
  // Per-frame API
  // ---------------------------------------------------------------------------

  /**
   * Rebuilds `intent` for this frame and returns it (the same object every
   * frame — read it, don't keep it). Idempotent until endFrame().
   * @param {number} dt seconds
   */
  update(dt) {
    const step = isFinite(dt) && dt > 0 ? Math.min(dt, 0.25) : 0;
    const xr = this.xrActive;
    if ((xr ? 'xr' : 'desktop') !== this.mode) this._setMode(xr ? 'xr' : 'desktop');
    const I = this.intent;
    I.source = this.mode;
    if (xr) this._updateXR(step);
    else this._updateDesktop(step);

    for (const h of HANDS) {
      const ht = this._ht[h];
      const hi = I.hands[h];
      hi.pressed = ht.pressEdge;
      hi.released = ht.releaseEdge;
      hi.held = ht.game;
    }
    const E = this._edges;
    I.jumpPressed = E.jump && !this.uiMode;
    I.pausePressed = E.pause;
    I.restartPressed = E.restart;
    I.confirmPressed = E.confirm;
    I.backPressed = E.back;
    I.anyPressed = E.any;
    I.ui.click = E.click;
    if (this._override) applyOverride(I, this._override);
    return I;
  }

  /** Clears this frame's edges. Call once at the very end of every frame. */
  endFrame() {
    const E = this._edges;
    E.jump = false;
    E.pause = false;
    E.restart = false;
    E.confirm = false;
    E.back = false;
    E.any = false;
    E.click = false;
    for (const h of HANDS) {
      const ht = this._ht[h];
      ht.pressEdge = false;
      ht.releaseEdge = false;
      if (ht.pendingRelease) {
        ht.pendingRelease = false;
        ht.game = false;
        ht.releaseEdge = true; // delivered next frame
      }
    }
  }

  /**
   * Gameplay vs VR panel. While on, trigger presses click the panel (intent.ui.click)
   * and never fire tethers. Desktop: turning it on frees the mouse for the DOM menus,
   * turning it off re-captures it (works when called from a click handler).
   */
  setUIMode(on) {
    const v = !!on;
    if (v === this.uiMode) return;
    this.uiMode = v;
    if (v) {
      this.uiHand = this._dominant();
      this._edges.jump = false;
      if (!this.xrActive) this.desktop.exitLock();
    } else if (!this.xrActive && this._inPlay()) {
      this.desktop.requestLock();
    }
  }

  /** Replaces the live settings object (if the Game swaps it instead of mutating it). */
  setSettings(settings) {
    if (settings && typeof settings === 'object') this.settings = settings;
  }

  /** Game.applySettings hook: settings are read live every frame; adopt a replaced object. */
  applySettings(settings) {
    this.setSettings(settings);
  }

  /** Releases every held tether / button now (e.g. on pause). Held triggers must be pressed again. */
  releaseAll() {
    this._releaseAll('external');
  }

  /**
   * Faces a world yaw (rig) and, on desktop, a camera pitch. In XR only the rig yaw
   * changes (the head keeps its own pitch).
   */
  setLook(yaw, pitch) {
    if (typeof yaw === 'number' && isFinite(yaw)) {
      if (this.rig) this.rig.rotation.y = yaw;
      else if (this.camera) this.camera.rotation.y = yaw;
    }
    if (!this.xrActive && this.camera) {
      const p = typeof pitch === 'number' && isFinite(pitch) ? pitch : 0;
      const lim = this.tuning.pitchLimit;
      this.camera.rotation.x = U.clamp(p, -lim, lim);
      if (this.rig) {
        this.camera.rotation.y = 0;
        this.camera.rotation.z = 0;
      }
    }
  }

  /** Debug: merge `partial` (intent-shaped) over every built intent; null clears. */
  setOverride(partial) {
    this._override = partial && typeof partial === 'object' ? partial : null;
  }

  /** Desktop: pointer lock (call from a user gesture). */
  lockPointer() {
    return this.desktop.requestLock();
  }

  unlockPointer() {
    this.desktop.exitLock();
  }

  /** Resets the desktop look (pitch 0; rig yaw too when given). */
  resetLook(yaw) {
    if (this.camera) this.camera.rotation.x = 0;
    if (typeof yaw === 'number' && isFinite(yaw)) {
      if (this.rig) this.rig.rotation.y = yaw;
      else if (this.camera) this.camera.rotation.y = yaw;
    }
  }

  // ---------------------------------------------------------------------------
  // XR session
  // ---------------------------------------------------------------------------

  /** Resolves true when immersive VR can be entered here (Quest Browser over HTTPS). */
  isVRSupported() {
    return XRInput.isSupported();
  }

  /**
   * Enters immersive VR. Call directly from a click / select handler (the
   * session request happens synchronously). Resolves true on success, false
   * on failure (reason in `lastError`, also emitted as bus 'xr:error').
   */
  enterVR() {
    let p;
    try {
      p = this.xrIn.enter();
    } catch (err) {
      p = Promise.reject(err);
    }
    return p.then(
      () => true,
      (err) => {
        this.lastError = err || new Error('XR session failed');
        this._emit('xr:error', { message: String((err && err.message) || err) });
        return false;
      },
    );
  }

  /** Ends the XR session (resolves when the request was made). */
  exitVR() {
    return this.xrIn.exit().then(() => true);
  }

  /**
   * Captures the current head position (rig-local) as the body's centre, so
   * xrRigPosition() keeps the head over the body however far the player has
   * drifted in the room. Automatic at session start and after a system
   * recenter; hold Y to do it by hand. Desktop: resets the look pitch.
   */
  recenter() {
    this._recenterPending = false;
    if (!this.xrActive) {
      if (this.camera) this.camera.rotation.x = 0;
      return true;
    }
    const cam = this.xrIn.headCamera();
    if (!cam) {
      this._recenterPending = true;
      return false;
    }
    const e = cam.matrix.elements;
    this.recenterOffset.x = e[12];
    this.recenterOffset.y = e[13];
    this.recenterOffset.z = e[14];
    this._emit('input:recenter', { x: e[12], y: e[13], z: e[14] });
    this.haptic('both', 0.25, 30);
    return true;
  }

  /**
   * XR: where the Game should put the rig so the recentred head point sits
   * over the body (pivoting smooth turns about the head, not the room origin):
   * rig = player − (0, 1.1, 0) − R(rigYaw)·(recenterOffset.x, 0, recenterOffset.z).
   * Before any recenter the offset is 0 and this equals the contract formula.
   */
  xrRigPosition(px, py, pz, out) {
    const o = out || this._rigPos;
    const yaw = this.rig ? this.rig.rotation.y : 0;
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const hx = this.recenterOffset.x;
    const hz = this.recenterOffset.z;
    o.x = px - (hx * c + hz * s);
    o.z = pz - (-hx * s + hz * c);
    o.y = py - XR_RIG_DROP + (this.xrIn.refSpaceType === 'local' ? this.tuning.localSpaceEyeHeight : 0);
    return o;
  }

  // ---------------------------------------------------------------------------
  // Haptics
  // ---------------------------------------------------------------------------

  /**
   * Controller pulse. hand: 'left' | 'right' | 'both'. Ignored on desktop or when
   * settings.haptics is false. A weaker pulse never cuts a stronger one short.
   * @returns {boolean} true when a pulse was sent
   */
  haptic(hand, intensity, ms) {
    const s = this.settings;
    if (s && s.haptics === false) return false;
    if (hand === 'both' || hand == null) {
      const a = this.haptic('left', intensity, ms);
      const b = this.haptic('right', intensity, ms);
      return a || b;
    }
    if (!this.xrActive || (hand !== 'left' && hand !== 'right')) return false;
    const gp = this.xrIn.gamepadFor(hand);
    if (!gp) return false;
    const i = U.clamp(Number(intensity) || 0, 0, 1);
    const d = U.clamp(Math.round(Number(ms) || 0), 1, this.tuning.hapticMaxMs);
    if (i <= 0) return false;
    const t = nowMs();
    const st = this._haptic[hand];
    if (t < st.until && i <= st.i) return false;
    try {
      const act = gp.hapticActuators && gp.hapticActuators.length ? gp.hapticActuators[0] : null;
      if (act && typeof act.pulse === 'function') {
        const p = act.pulse(i, d);
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } else if (gp.vibrationActuator && typeof gp.vibrationActuator.playEffect === 'function') {
        const p = gp.vibrationActuator.playEffect('dual-rumble', { duration: d, strongMagnitude: i, weakMagnitude: i });
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } else {
        return false;
      }
    } catch {
      return false;
    }
    st.until = t + d;
    st.i = i;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Poses
  // ---------------------------------------------------------------------------

  /**
   * World pose of a hand's launcher muzzle — the rope origin — and its
   * orientation (barrel = local −Z). XR: the controller grip aligned with the
   * target ray; desktop: virtual hands near the bottom corners of the view.
   * Returns a shared object per hand unless `out` is given.
   */
  handPose(hand, out) {
    const o = out || this._pose[hand] || this._pose.right;
    const sock = this.sockets[hand] || this.sockets.right;
    const xr = this.xrActive;
    if (xr) this._bindSockets();
    const usable = sock.parent && (xr ? sock.visible && this._handTracked(hand) : !!this.camera);
    if (usable) {
      sock.updateWorldMatrix(true, false);
      this._m1.copy(sock.matrixWorld);
    } else {
      // Head-relative stand-in so a rope still has an origin.
      this._headMatrix(this._m2);
      const f = this.tuning.xrFallbackHand;
      this._m1.makeTranslation(hand === 'left' ? -f.x : f.x, f.y, f.z).premultiply(this._m2);
    }
    this._v.copy(this._muzzle).applyMatrix4(this._m1);
    this._m1.decompose(this._v2, this._q, this._s);
    o.x = this._v.x;
    o.y = this._v.y;
    o.z = this._v.z;
    o.qx = this._q.x;
    o.qy = this._q.y;
    o.qz = this._q.z;
    o.qw = this._q.w;
    return o;
  }

  /** The Object3D a hand's visuals hang from (see handPose). */
  handSocket(hand) {
    return this.sockets[hand] || null;
  }

  /** True when the hand's controller (or tracked hand) currently has a pose. */
  handTracked(hand) {
    return this.xrActive ? this._handTracked(hand) : true;
  }

  /**
   * Current-frame world aim ray of a hand into `out` ({ox,oy,oz,dx,dy,dz}).
   * Desktop: the view centre for both hands. Returns null when untracked.
   */
  aimRay(hand, out) {
    const o = out || makeRay();
    if (this.xrActive) return this._xrAim(hand, o) ? o : null;
    if (!this.camera) return null;
    this.camera.updateWorldMatrix(true, false);
    return rayFromMatrix(this.camera.matrixWorld.elements, o);
  }

  /**
   * Current-frame head pose in world space (XR: this frame's viewer pose;
   * desktop: the camera). Returns a shared object {x,y,z,qx,qy,qz,qw,yaw}.
   */
  headPose() {
    this._headMatrix(this._m3);
    const h = this._head;
    this._m3.decompose(this._v, this._q, this._s);
    h.x = this._v.x;
    h.y = this._v.y;
    h.z = this._v.z;
    h.qx = this._q.x;
    h.qy = this._q.y;
    h.qz = this._q.z;
    h.qw = this._q.w;
    h.yaw = yawOfMatrix(this._m3.elements);
    return h;
  }

  /** Writes the head's world matrix into `out` (Matrix4). */
  headMatrix(out) {
    return this._headMatrix(out || new Matrix4());
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  dispose() {
    for (const off of this._unsub) off();
    this._unsub.length = 0;
    this.desktop.detach();
    this.xrIn.dispose();
    for (const h of HANDS) {
      const s = this.sockets[h];
      if (s.parent) s.parent.remove(s);
    }
  }

  // ===========================================================================
  // Internals
  // ===========================================================================

  /** Game state: the Game's own field when we have it, else the last bus 'game:state'. */
  _liveState() {
    const g = this.game;
    if (g && typeof g.state === 'string') return g.state;
    return this._gameState;
  }

  /** Desktop mouse capture / mouse tethers only while a run is live (or the state is unknown). */
  _inPlay() {
    const s = this._liveState();
    return s == null || s === 'playing' || s === 'dead';
  }

  /** X restarts while paused / dead / on the victory panel — never during a live run. */
  _restartAllowed() {
    const gs = this._liveState();
    if (gs) return gs === 'paused' || gs === 'dead' || gs === 'victory';
    return this.uiMode || this._playerDead;
  }

  _dominant() {
    return this.settings && this.settings.dominantHand === 'left' ? 'left' : 'right';
  }

  _emit(type, payload) {
    if (this.bus && typeof this.bus.emit === 'function') this.bus.emit(type, payload || {});
  }

  _edge(name) {
    if (name in this._edges) this._edges[name] = true;
  }

  /**
   * Physical tether-button transition for a hand (desktop events call this
   * directly; XR calls it from the per-frame poll with the current state).
   */
  _handPhysical(hand, down, source) {
    const ht = this._ht[hand];
    if (!ht) return;
    const d = !!down;
    if (ht.reblock) {
      ht.reblock = false;
      if (d) {
        ht.phys = true;
        ht.blocked = true;
        return;
      }
    }
    if (d === ht.phys) return;
    ht.phys = d;
    if (d) {
      this._edges.any = true;
      if (this.uiMode) {
        ht.blocked = true;
        if (source !== 'desktop') {
          this.uiHand = hand;
          this._edges.click = true;
        }
        return;
      }
      ht.game = true;
      ht.pressEdge = true;
      ht.pendingRelease = false;
    } else {
      if (ht.blocked) {
        ht.blocked = false;
        return;
      }
      if (!ht.game) return;
      if (ht.pressEdge) ht.pendingRelease = true;
      else {
        ht.game = false;
        ht.releaseEdge = true;
      }
    }
  }

  /** Releases every held input (blur, tab hidden, XR blur, mode switch). */
  _releaseAll(reason) {
    const xr = this.mode === 'xr';
    for (const h of HANDS) {
      const ht = this._ht[h];
      if (ht.game) {
        ht.game = false;
        ht.releaseEdge = true;
      }
      ht.pressEdge = false;
      ht.pendingRelease = false;
      ht.phys = false;
      ht.blocked = false;
      ht.reblock = xr;
    }
    for (const k of Object.keys(this._btn)) {
      const b = this._btn[k];
      b.blocked = true; // a button still held on return must be released first
      b.down = false;
    }
    this._edges.jump = false;
    this._yHold = 0;
    this._recenterLatched = false;
    this.desktop.clear();
    this._emit('input:release', { reason: reason || 'release' });
  }

  _desktopLockChanged(locked, pause) {
    if (!locked && pause && !this.uiMode && !this.xrActive) this._edges.pause = true;
  }

  _setMode(mode) {
    const prev = this.mode;
    this.mode = mode;
    const cam = this.camera;
    if (mode === 'xr') {
      if (cam) {
        this._savedCam = this._savedCam || { p: new Vector3(), q: new Quaternion() };
        this._savedCam.p.copy(cam.position);
        this._savedCam.q.copy(cam.quaternion);
      }
      this.desktop.exitLock();
    } else if (prev === 'xr') {
      if (cam && this._savedCam) {
        // three.js leaves the last head pose in the camera; restore the desktop view.
        cam.position.copy(this._savedCam.p);
        cam.quaternion.copy(this._savedCam.q);
        cam.updateMatrixWorld(true);
      }
      this.recenterOffset.x = 0;
      this.recenterOffset.y = 0;
      this.recenterOffset.z = 0;
    }
    this._releaseAll(`mode:${mode}`);
    this._placeDesktopSockets();
    this._emit('input:mode', { mode });
  }

  _onSessionStart() {
    if (this.mode !== 'xr') this._setMode('xr');
    this._recenterPending = true;
    this._emit('xr:start', { refSpace: this.xrIn.refSpaceType });
  }

  _onSessionEnd() {
    if (this.mode !== 'desktop') this._setMode('desktop');
    this._emit('xr:end', {});
  }

  _onXRVisibility(state) {
    if (state !== 'visible') this._releaseAll(`xr-${state}`);
    this._emit('xr:visibility', { state });
  }

  // ---- rig / head -----------------------------------------------------------

  /** Up-to-date rig world matrix (the Game may have moved the rig since the last render). */
  _rigWorld() {
    if (!this.rig) return null;
    this.rig.updateWorldMatrix(true, false);
    return this.rig.matrixWorld;
  }

  _headMatrix(out) {
    const cam = this.xrIn.headCamera();
    if (cam) {
      const rw = this._rigWorld();
      if (rw) out.multiplyMatrices(rw, cam.matrix);
      else out.copy(cam.matrix);
      return out;
    }
    if (this.camera) {
      this.camera.updateWorldMatrix(true, false);
      return out.copy(this.camera.matrixWorld);
    }
    return out.identity();
  }

  // ---- sockets ----------------------------------------------------------------

  _computeDesktopHands() {
    const T = this.tuning;
    const target = new Vector3(0, 0, -T.desktopConverge);
    const up = new Vector3(0, 1, 0);
    const m = new Matrix4();
    for (const h of HANDS) {
      const eye = new Vector3(h === 'left' ? -T.desktopHand.x : T.desktopHand.x, T.desktopHand.y, T.desktopHand.z);
      m.lookAt(eye, target, up);
      this._deskQuat[h].setFromRotationMatrix(m);
    }
  }

  _placeDesktopSockets() {
    if (this.mode === 'xr') {
      this._bindSockets();
      return;
    }
    const T = this.tuning;
    for (const h of HANDS) {
      const s = this.sockets[h];
      if (this.camera) {
        if (s.parent !== this.camera) this.camera.add(s);
        s.position.set(h === 'left' ? -T.desktopHand.x : T.desktopHand.x, T.desktopHand.y, T.desktopHand.z);
        s.quaternion.copy(this._deskQuat[h]);
        s.scale.setScalar(T.desktopScale);
        s.visible = true;
      } else if (s.parent) {
        s.parent.remove(s);
      }
    }
  }

  _handTracked(hand) {
    const st = this.xrIn.hands[hand];
    return st.connected && (st.gripTracked || st.rayTracked);
  }

  /** XR: hang each socket under its hand's grip, aligned so −Z follows the target ray. */
  _bindSockets() {
    for (const h of HANDS) {
      const sock = this.sockets[h];
      const slot = this.xrIn.slot(h);
      const st = this.xrIn.hands[h];
      if (!slot) {
        sock.visible = false;
        continue;
      }
      const useGrip = !!slot.grip && (st.gripTracked || !st.rayTracked);
      const parent = useGrip ? slot.grip : slot.ray;
      if (sock.parent !== parent) parent.add(sock);
      sock.position.set(0, 0, 0);
      sock.scale.setScalar(1);
      if (useGrip && st.rayTracked) {
        this._m1.copy(slot.grip.matrix).invert().multiply(slot.ray.matrix);
        sock.quaternion.setFromRotationMatrix(this._m1);
      } else if (!useGrip) {
        sock.quaternion.identity();
      }
      sock.visible = st.gripTracked || st.rayTracked;
    }
  }

  _xrAim(hand, out) {
    const slot = this.xrIn.slot(hand);
    const st = this.xrIn.hands[hand];
    if (!slot || !st.rayTracked) return false;
    const rw = this._rigWorld();
    if (rw) this._m1.multiplyMatrices(rw, slot.ray.matrix);
    else this._m1.copy(slot.ray.matrix);
    rayFromMatrix(this._m1.elements, out);
    return true;
  }

  // ---- XR frame ---------------------------------------------------------------

  _updateXR(dt) {
    const X = this.xrIn;
    const T = this.tuning;
    const I = this.intent;
    const s = this.settings || {};
    X.poll();
    this._bindSockets();
    if (this._recenterPending) this.recenter();
    const L = X.hands.left;
    const R = X.hands.right;
    // While the session is blurred (system menu) the controls are frozen and unreadable:
    // leave every button state alone so held buttons stay blocked until really released.
    const readable = X.visibility === 'visible';

    // 1. tether buttons (trigger, or pinch on tracked hands)
    if (readable) for (const h of HANDS) this._handPhysical(h, tetherDown(X.hands[h]), 'xr');

    // 2. face buttons
    const B = this._btn;
    if (readable) {
      if (pollButton(B.a, R.primary)) {
        this._edges.any = true;
        this._edges.confirm = true;
        if (!this.uiMode) this._edges.jump = true;
      }
      if (pollButton(B.b, R.secondary)) {
        this._edges.any = true;
        this._edges.pause = true;
        if (this.uiMode) this._edges.back = true;
      }
      if (pollButton(B.x, L.primary)) {
        this._edges.any = true;
        if (this._restartAllowed()) this._edges.restart = true;
      }
      pollButton(B.y, L.secondary);
      pollButton(B.l3, L.stickClick);
    }
    if (B.y.down) {
      this._yHold += dt;
      if (!this._recenterLatched && this._yHold >= T.recenterHoldS) {
        this._recenterLatched = true;
        this.recenter();
      }
    } else {
      this._yHold = 0;
      this._recenterLatched = false;
    }
    I.brake = B.l3.down;

    // 3. left stick → world move relative to head yaw
    this._headMatrix(this._m3);
    const yaw = yawOfMatrix(this._m3.elements);
    let sx = L.stickX;
    let sy = L.stickY;
    const m = Math.hypot(sx, sy);
    if (m <= T.stickDeadzone) {
      sx = 0;
      sy = 0;
    } else {
      const k = Math.min(1, (m - T.stickDeadzone) / (1 - T.stickDeadzone)) / m;
      sx *= k;
      sy *= k;
    }
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    // right = (cos, 0, −sin), forward = (−sin, 0, −cos); stick up is −Y.
    I.move.x = sx * c + sy * sn;
    I.move.z = -sx * sn + sy * c;

    // 4. right stick → smooth turn (X) and reel (Y), each locked near its axis
    let rx = R.stickX;
    let ry = R.stickY;
    const ang = Math.atan2(Math.abs(ry), Math.abs(rx)); // 0 = sideways, π/2 = up/down
    const lock = T.rightStickAxisLockDeg * DEG;
    if (ang < lock) ry = 0;
    else if (ang > Math.PI / 2 - lock) rx = 0;
    const turnMul = U.clamp(typeof s.turnSpeed === 'number' ? s.turnSpeed : 1, 0.25, 3);
    I.turnRate = -shapeAxis(rx, T.turnDeadzone, T.turnExponent) * T.turnRate * turnMul;
    I.reel = shapeAxis(-ry, T.reelDeadzone, 1);

    // 5. grip → yank
    for (const h of HANDS) {
      const g = X.hands[h].grip;
      I.hands[h].yank = g <= T.gripDeadzone ? 0 : Math.min(1, (g - T.gripDeadzone) / (1 - T.gripDeadzone));
    }

    // 6. aim rays (world space, from each controller's target ray)
    for (const h of HANDS) I.hands[h].aim = this._xrAim(h, this._aim[h]) ? this._aim[h] : null;

    // 7. UI pointer: the dominant hand, or whichever hand last pulled its trigger on a panel
    let uh = this.uiHand;
    if (!I.hands[uh].aim) uh = uh === 'left' ? 'right' : 'left';
    const src = I.hands[uh].aim;
    if (src) {
      const r = this._uiRay;
      r.ox = src.ox;
      r.oy = src.oy;
      r.oz = src.oz;
      r.dx = src.dx;
      r.dy = src.dy;
      r.dz = src.dz;
      I.ui.ray = r;
    } else {
      I.ui.ray = null;
    }
  }

  // ---- desktop frame ----------------------------------------------------------

  _applyLook(dYaw, dPitch) {
    const cam = this.camera;
    if (this.rig) this.rig.rotation.y += dYaw;
    else if (cam) {
      cam.rotation.order = 'YXZ';
      cam.rotation.y += dYaw;
    }
    if (cam) {
      const lim = this.tuning.pitchLimit;
      cam.rotation.x = U.clamp(cam.rotation.x + dPitch, -lim, lim);
    }
  }

  _updateDesktop(dt) {
    const D = this.desktop;
    const T = this.tuning;
    const I = this.intent;
    const s = this.settings || {};

    // look (mouse while locked; arrow keys always)
    const look = D.consumeLook(this._look);
    if (!this.uiMode) {
      const sens = U.clamp(typeof s.mouseSensitivity === 'number' ? s.mouseSensitivity : 1, 0.1, 5);
      let dYaw = -look.x * T.mouseRadPerPx * sens;
      let dPitch = -look.y * T.mouseRadPerPx * sens;
      const kx = (D.key('ArrowRight') ? 1 : 0) - (D.key('ArrowLeft') ? 1 : 0);
      const ky = (D.key('ArrowUp') ? 1 : 0) - (D.key('ArrowDown') ? 1 : 0);
      dYaw -= kx * T.keyLookRate * sens * dt;
      dPitch += ky * T.keyLookRate * sens * dt;
      if (dYaw !== 0 || dPitch !== 0) this._applyLook(dYaw, dPitch);
    }

    // move: WASD relative to the view's heading
    this._headMatrix(this._m3);
    const yaw = yawOfMatrix(this._m3.elements);
    let fx = (D.key('KeyD') ? 1 : 0) - (D.key('KeyA') ? 1 : 0);
    let fz = (D.key('KeyW') ? 1 : 0) - (D.key('KeyS') ? 1 : 0);
    const ml = Math.hypot(fx, fz);
    if (ml > 1) {
      fx /= ml;
      fz /= ml;
    }
    const c = Math.cos(yaw);
    const sn = Math.sin(yaw);
    I.move.x = fx * c - fz * sn;
    I.move.z = -fx * sn - fz * c;

    const shift = D.key('ShiftLeft') || D.key('ShiftRight');
    I.reel = (D.key('Space') ? 1 : 0) - (shift ? 1 : 0);
    I.brake = D.key('KeyC');
    I.turnRate = 0;
    const yank = D.key('KeyF') ? 1 : 0;

    // both hands aim along the view centre
    const ok = this.camera ? rayFromMatrix(this._m3.elements, this._aim.right) : null;
    if (ok) {
      const a = this._aim.right;
      const b = this._aim.left;
      b.ox = a.ox;
      b.oy = a.oy;
      b.oz = a.oz;
      b.dx = a.dx;
      b.dy = a.dy;
      b.dz = a.dz;
    }
    for (const h of HANDS) {
      I.hands[h].aim = ok ? this._aim[h] : null;
      I.hands[h].yank = yank;
    }
    I.ui.ray = null;
  }
}
