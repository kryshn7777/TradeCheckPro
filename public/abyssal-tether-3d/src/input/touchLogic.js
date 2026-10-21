/* ABYSSAL TETHER 3D — input/touchLogic.js
 * WP-TOUCH: the pure rules behind the phone / tablet touch layer (no DOM, no three.js: unit-tested in Node,
 * used by input/touchInput.js). Settings keys live in sim/config3d.js (touch*; sanitizeTouchSettings).
 *
 *   stickVector       thumb offset (px) → move vector: radial dead zone, rescaled, response curve, y up
 *   followStick       floating base: the base follows a thumb that drifts past the ring
 *   zoneForX          which half of the screen a touch belongs to (stick vs look), honouring the mirror
 *   lookDelta         drag pixels → rig yaw / camera pitch (radians), sensitivity + invert-Y
 *   gyroLook          device rotation rate (deg/s) + screen angle → yaw / pitch (radians), sensitivity + invert-Y
 *   ButtonMachine     hold / latch state of one on-screen button over several pointers
 *   LAYOUT / placeButton   button sizes and corner offsets in units, mirrored with the handedness setting
 *   touchModeOn       auto / on / off decision
 *   bagCountsKey      cheap change key for the bag radial
 */
import { SETTINGS_DEFAULTS } from '../sim/config3d.js';

export const TOUCH_TUNING = {
  stickRadius: 62, // px of thumb travel for full deflection (× the button scale)
  deadZone: 0.14, // radial, fraction of the radius
  curve: 1.55, // response exponent after the dead zone is removed (fine control near the centre)
  radPerPx: 0.0042, // × touchLookSens: a 500 px swipe turns ~2 rad at 1.0
  slopPx: 1.5, // movement under this per event is jitter, not a look
  maxLookPx: 160, // one event can never turn the view more than this many px worth (a lost-capture jump)
  gyroDegToRad: Math.PI / 180,
  gyroGain: 1.0, // × touchLookSens
  idleFadeS: 3, // seconds without a touch before the layer fades to low opacity
  minButton: 56, // px: the smallest on-screen button at scale 1
};

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const fin = (v, d) => (typeof v === 'number' && isFinite(v) ? v : d);

/**
 * Thumb offset from the stick base (dx right, dy DOWN in screen px) → { x, y, mag }: x right, y UP (forward), |v| ≤ 1.
 * Inside the dead zone the vector is exactly 0; outside it the magnitude is rescaled to start at 0 and shaped by `curve`.
 */
export function stickVector(dx, dy, radius, deadZone = TOUCH_TUNING.deadZone, curve = TOUCH_TUNING.curve, out) {
  const o = out || { x: 0, y: 0, mag: 0 };
  const r = Math.max(1, fin(radius, TOUCH_TUNING.stickRadius));
  const px = fin(dx, 0);
  const py = fin(dy, 0);
  const d = Math.hypot(px, py);
  const raw = clamp(d / r, 0, 1);
  const dz = clamp(deadZone, 0, 0.9);
  if (d < 1e-6 || raw <= dz) {
    o.x = 0;
    o.y = 0;
    o.mag = 0;
    return o;
  }
  const m = Math.pow((raw - dz) / (1 - dz), curve);
  o.x = (px / d) * m;
  o.y = (-py / d) * m;
  o.mag = m;
  return o;
}

/** Floating base: when the thumb is further than `radius` from the base, the base is dragged along. Mutates and returns `base`. */
export function followStick(base, px, py, radius) {
  const dx = px - base.x;
  const dy = py - base.y;
  const d = Math.hypot(dx, dy);
  if (d > radius && d > 0) {
    const k = (d - radius) / d;
    base.x += dx * k;
    base.y += dy * k;
  }
  return base;
}

/** 'stick' for the movement half of the screen, 'look' for the other (mirror swaps the halves). */
export function zoneForX(x, width, mirror) {
  const left = fin(x, 0) < fin(width, 0) * 0.5;
  return left !== !!mirror ? 'stick' : 'look';
}

/**
 * Drag pixels (dx right, dy down) → { yaw, pitch } radians to ADD to the rig yaw / camera pitch. A finger dragged right
 * turns right (yaw falls), dragged down looks down; invertY flips the vertical. Jitter below slopPx is dropped and a
 * single event is capped (a lost pointer capture must not spin the view).
 */
export function lookDelta(dx, dy, sens, invertY, out) {
  const o = out || { yaw: 0, pitch: 0 };
  const s = clamp(fin(sens, 1), 0.1, 5) * TOUCH_TUNING.radPerPx;
  let x = fin(dx, 0);
  let y = fin(dy, 0);
  if (Math.hypot(x, y) < TOUCH_TUNING.slopPx) x = y = 0;
  const cap = TOUCH_TUNING.maxLookPx;
  x = clamp(x, -cap, cap);
  y = clamp(y, -cap, cap);
  o.yaw = -x * s;
  o.pitch = -y * s * (invertY ? -1 : 1);
  return o;
}

/**
 * Gyroscope look from DeviceMotionEvent.rotationRate (alpha about the screen normal, beta about the device x axis,
 * gamma about the device y axis, deg/s) and the screen angle (screen.orientation.angle: 0 portrait, 90 / 270 landscape,
 * 180 upside down). Holding the phone like a window: turning left raises the yaw, tilting the top away looks up.
 * Returns radians for this step.
 */
export function gyroLook(rate, angle, dt, sens, invertY, out) {
  const o = out || { yaw: 0, pitch: 0 };
  const b = fin(rate && rate.beta, 0);
  const g = fin(rate && rate.gamma, 0);
  const a = (((Math.round(fin(angle, 0) / 90) * 90) % 360) + 360) % 360;
  let yawRate;
  let pitchRate;
  if (a === 90) {
    yawRate = b;
    pitchRate = -g;
  } else if (a === 270) {
    yawRate = -b;
    pitchRate = g;
  } else if (a === 180) {
    yawRate = -g;
    pitchRate = -b;
  } else {
    yawRate = g;
    pitchRate = b;
  }
  const k = TOUCH_TUNING.gyroDegToRad * clamp(fin(dt, 0), 0, 0.1) * clamp(fin(sens, 1), 0.1, 5) * TOUCH_TUNING.gyroGain;
  o.yaw = yawRate * k;
  o.pitch = pitchRate * k * (invertY ? -1 : 1);
  return o;
}

/**
 * One on-screen button. 'hold': held while any pointer is down on it. 'latch': a press toggles it, releases do nothing.
 * down(id) / up(id) return 'press' | 'release' | null (the transition of `held`).
 */
export class ButtonMachine {
  constructor(mode) {
    this.mode = mode === 'latch' ? 'latch' : 'hold';
    this.pointers = new Set();
    this.held = false;
  }

  setMode(mode) {
    const m = mode === 'latch' ? 'latch' : 'hold';
    if (m === this.mode) return null;
    this.mode = m;
    return this.releaseAll();
  }

  down(id) {
    if (this.pointers.has(id)) return null;
    const first = this.pointers.size === 0;
    this.pointers.add(id);
    if (this.mode === 'latch') {
      if (!first) return null;
      this.held = !this.held;
      return this.held ? 'press' : 'release';
    }
    if (!this.held) {
      this.held = true;
      return 'press';
    }
    return null;
  }

  up(id) {
    if (!this.pointers.delete(id)) return null;
    if (this.mode === 'hold' && this.pointers.size === 0 && this.held) {
      this.held = false;
      return 'release';
    }
    return null;
  }

  releaseAll() {
    this.pointers.clear();
    if (this.held) {
      this.held = false;
      return 'release';
    }
    return null;
  }
}

/**
 * Button layout in units (u = 64 px × touchScale). side: the screen edge the button hugs by default ('r' = the look side,
 * 'l' = the stick side); x / y = the gap from that edge / the bottom in u; s = the size in u. `look`: a drag that starts on
 * the button also looks (hold fire and aim at once). `top`: measured from the top instead of the bottom.
 */
export const LAYOUT = [
  { id: 'fireR', side: 'r', x: 0.3, y: 0.3, s: 1.3, look: true, hand: 'right' },
  { id: 'fireL', side: 'r', x: 1.85, y: 0.3, s: 1.1, look: true, hand: 'left' },
  { id: 'fire', side: 'r', x: 0.3, y: 0.3, s: 1.3, look: true, hand: 'sel' }, // 'toggle' launcher mode: one button + chip
  { id: 'jump', side: 'r', x: 0.3, y: 1.75, s: 1.0 },
  { id: 'grip', side: 'r', x: 1.7, y: 1.7, s: 1.0, look: true },
  { id: 'bag', side: 'r', x: 1.7, y: 3.0, s: 1.0 },
  { id: 'reel', side: 'l', x: 0.3, y: 2.6, s: 1.0 },
  { id: 'out', side: 'l', x: 0.3, y: 1.4, s: 1.0 },
  { id: 'pause', side: 'r', x: 0.3, y: 0.3, s: 0.875, top: true },
];

export const BASE_UNIT = 64;

/**
 * Where a layout entry sits for a scale and handedness: { side: 'left' | 'right', x, y, size, top } in px (x from that side's
 * edge, y from the bottom — or from the top when `top`). Mirroring swaps every side; sizes never drop below 56 px. `viewH`
 * (the viewport height) shrinks the unit on a short landscape screen so the right-hand column (4 units tall) still fits.
 */
export function placeButton(def, scale, mirror, viewH) {
  let u = BASE_UNIT * clamp(fin(scale, 1), 0.9, 1.5);
  if (viewH > 0) u = Math.min(u, Math.max(TOUCH_TUNING.minButton, (viewH - 30) / 4));
  const side = (def.side === 'r') !== !!mirror ? 'right' : 'left';
  return { side, x: def.x * u, y: def.y * u, size: Math.max(TOUCH_TUNING.minButton, def.s * u), top: !!def.top };
}

/** Screen rectangles { x0, y0, x1, y1 } of every button for a viewport (no safe-area insets); the layout tests check them. */
export function layoutRects(w, h, scale, mirror, launcher) {
  const out = {};
  for (const def of LAYOUT) {
    if (launcher === 'toggle' ? def.id === 'fireR' || def.id === 'fireL' : def.id === 'fire') continue;
    const p = placeButton(def, scale, mirror, h);
    const x0 = p.side === 'left' ? p.x : w - p.x - p.size;
    const y0 = p.top ? p.y : h - p.y - p.size;
    out[def.id] = { x0, y0, x1: x0 + p.size, y1: y0 + p.size };
  }
  return out;
}

/** Whether the touch layer is wanted: 'on' / 'off' win; 'auto' follows a coarse primary pointer or a touch seen on a hybrid. */
export function touchModeOn(setting, env) {
  const e = env || {};
  if (e.quest || e.xrPresenting) return false;
  if (setting === 'off') return false;
  if (setting === 'on') return true;
  return !!(e.coarse || e.touchSeen);
}

/** The settings with their defaults filled in (the touch layer reads these live every frame). */
export function touchSettings(s) {
  const D = SETTINGS_DEFAULTS;
  const o = s || {};
  return {
    mode: o.touchControls || D.touchControls,
    sens: fin(o.touchLookSens, D.touchLookSens),
    invertY: o.touchInvertY === true,
    gyro: o.touchGyro === true,
    scale: clamp(fin(o.touchScale, D.touchScale), 0.9, 1.5),
    mirror: o.touchMirror === true,
    launcher: o.touchLauncher === 'toggle' ? 'toggle' : 'two',
    rope: o.touchRopeMode === 'latch' ? 'latch' : 'hold',
    haptics: o.haptics !== false,
    colorSafe: o.colorSafe === true,
  };
}

/** Change key for the bag row: the four counts plus the selection (the DOM is only rewritten when it changes). */
export function bagCountsKey(counts) {
  let k = 0;
  for (let i = 0; i < 4; i++) k = k * 32 + clamp((counts && counts[i]) | 0, 0, 31);
  return k;
}
