/* ABYSSAL TETHER 3D — config3d.js
 * Tuning (metres, seconds; three.js convention: +Y is up, the descent goes
 * toward -Y), difficulty presets, small vector/maths helpers, an event bus
 * and localStorage persistence. Pure ES module, no three.js dependency, so
 * the simulation runs unchanged in Node for tooling.
 */

const DEG = Math.PI / 180;

export const CONFIG = {
  PHYSICS_DT: 1 / 240,
  MAX_FRAME_DT: 0.1,
  MAX_STEPS_PER_FRAME: 30,

  player: {
    radius: 0.38, // collision sphere around the chest
    eyeHeight: 0.5, // head above the body centre when not in XR
    gravity: 13.5, // a touch heavier than Earth: snappier swings
    maxSpeed: 48,
    maxFallSpeed: 38,
    runAccel: 40,
    runMaxSpeed: 5.5,
    groundFriction: 9,
    overspeedFriction: 2.2,
    brakeFactor: 2.4,
    airAccel: 7,
    airMaxSpeed: 7.5,
    airDrag: 0.03,
    jumpSpeed: 5.6,
    coyoteTime: 0.1,
    jumpBuffer: 0.12,
    hardLandingSpeed: 10.5,
    staggerTime: 0.35,
    staggerControl: 0.35,
    groundNormalY: 0.55, // contact normal.y above this = standing
    lethalNormalY: 0.3, // only floor-ish impacts can kill
    wallHitFxSpeed: 4,
    fallDeathMargin: 60,
  },

  rope: {
    minLength: 1.2,
    maxLengthBonus: 4,
    reelInSpeed: 9.5,
    reelOutSpeed: 11,
    yankSpeed: 17, // grip on a tethered hand: hard pull
    pumpAccel: 9.5,
    reelSpinCap: 1.02,
    releaseBoost: 1.04,
    releaseBoostMinSpeed: 8,
    fireSpeed: 220, // visual tether extension (m/s); attachment itself is immediate
    missTime: 0.24,
    grappleBuffer: 0.2,
    tautSlack: 0.04,
    joltFxSpeed: 12,
  },

  targeting: {
    stickiness: 0.18,
    losEndClearance: 0.6,
    minAimLength: 1e-3,
  },
};

export const DIFFICULTY = {
  normal: {
    key: 'normal',
    label: 'Normal',
    blurb: 'The intended descent. Generous aim assist, recovery anchors, a patient predator.',
    levelVariant: 'normal',
    aimRange: 32,
    aimConeDeg: 12,
    rayAssist: 2.4, // metres from the aim ray that still count as "aimed at"
    lethalImpact: 17,
    impactsLethal: true,
    fragileTime: 1.5,
    crumbleTime: 0.9,
    checkpoints: 'all',
    recordTimes: true,
    creature: { enabled: true, speed: 1.0, aggression: 1.0, staminaDrain: 1.0, staminaRegen: 1.0, killRadius: 2.6 },
  },
  nightmare: {
    key: 'nightmare',
    label: 'Nightmare',
    blurb: 'Faster hunter, tighter aim, fewer recovery anchors, nastier geometry.',
    levelVariant: 'nightmare',
    aimRange: 29,
    aimConeDeg: 8,
    rayAssist: 1.8,
    lethalImpact: 15.5,
    impactsLethal: true,
    fragileTime: 1.05,
    crumbleTime: 0.65,
    checkpoints: 'alternate',
    recordTimes: true,
    creature: { enabled: true, speed: 1.18, aggression: 1.3, staminaDrain: 0.9, staminaRegen: 1.25, killRadius: 2.9 },
  },
  abyss: {
    key: 'abyss',
    label: 'Abyss',
    blurb: 'For speedrunners. Minimal assist, almost no recovery, no checkpoints.',
    levelVariant: 'abyss',
    aimRange: 27,
    aimConeDeg: 6,
    rayAssist: 1.3,
    lethalImpact: 14.5,
    impactsLethal: true,
    fragileTime: 0.8,
    crumbleTime: 0.5,
    checkpoints: 'none',
    recordTimes: true,
    creature: { enabled: true, speed: 1.34, aggression: 1.6, staminaDrain: 0.8, staminaRegen: 1.5, killRadius: 3.1 },
  },
  sandbox: {
    key: 'sandbox',
    label: 'Sandbox',
    blurb: 'No predator, no lethal falls. Practise the tethers at your own pace.',
    levelVariant: 'normal',
    aimRange: 32,
    aimConeDeg: 12,
    rayAssist: 2.4,
    lethalImpact: 17,
    impactsLethal: false,
    fragileTime: 1.5,
    crumbleTime: 0.9,
    checkpoints: 'all',
    recordTimes: false,
    creature: { enabled: false, speed: 0, aggression: 0, staminaDrain: 1, staminaRegen: 1, killRadius: 0 },
  },
};
for (const key of Object.keys(DIFFICULTY)) DIFFICULTY[key].aimCone = DIFFICULTY[key].aimConeDeg * DEG;
export const DIFFICULTY_ORDER = ['normal', 'nightmare', 'abyss'];

export const SETTINGS_DEFAULTS = {
  volume: 0.8,
  aimAssist: 1.0, // 0.6..1.4 scales cone + ray assist
  turnSpeed: 1.0, // smooth-turn rate multiplier (0.5..2)
  mouseSensitivity: 1.0, // desktop look (0.3..3)
  dominantHand: 'right',
  haptics: true,
  lastDifficulty: 'normal',
};

// -----------------------------------------------------------------------------
// Maths helpers (plain {x,y,z} objects; no allocation in hot paths when `out` is passed)
// -----------------------------------------------------------------------------
export const U = {
  DEG,
  clamp: (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v),
  lerp: (a, b, t) => a + (b - a) * t,
  damp: (cur, target, rate, dt) => target + (cur - target) * Math.exp(-rate * dt),
  approach(cur, target, maxDelta) {
    return cur < target ? Math.min(cur + maxDelta, target) : Math.max(cur - maxDelta, target);
  },
  smoothstep(a, b, v) {
    const t = U.clamp((v - a) / (b - a || 1), 0, 1);
    return t * t * (3 - 2 * t);
  },
  len: (x, y, z) => Math.hypot(x, y, z),
  dist: (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z),
  /** Unsigned angle between two vectors (radians). */
  angle(ax, ay, az, bx, by, bz) {
    const la = Math.hypot(ax, ay, az);
    const lb = Math.hypot(bx, by, bz);
    if (la < 1e-9 || lb < 1e-9) return Math.PI;
    return Math.acos(U.clamp((ax * bx + ay * by + az * bz) / (la * lb), -1, 1));
  },
  /** Box (min/max) overlap with a sphere. */
  sphereBox(cx, cy, cz, r, b) {
    const qx = U.clamp(cx, b.minX, b.maxX);
    const qy = U.clamp(cy, b.minY, b.maxY);
    const qz = U.clamp(cz, b.minZ, b.maxZ);
    const dx = cx - qx;
    const dy = cy - qy;
    const dz = cz - qz;
    return dx * dx + dy * dy + dz * dz < r * r;
  },
  /**
   * Slab test: segment p0→p1 against a box shrunk by `inset`.
   * Returns the entry parameter t in [0,1] or -1.
   */
  segmentBox(x0, y0, z0, x1, y1, z1, b, inset) {
    const pad = inset || 0;
    let t0 = 0;
    let t1 = 1;
    const o = [x0, y0, z0];
    const d = [x1 - x0, y1 - y0, z1 - z0];
    const mn = [b.minX + pad, b.minY + pad, b.minZ + pad];
    const mx = [b.maxX - pad, b.maxY - pad, b.maxZ - pad];
    for (let i = 0; i < 3; i++) {
      if (mx[i] <= mn[i]) return -1;
      if (Math.abs(d[i]) < 1e-12) {
        if (o[i] < mn[i] || o[i] > mx[i]) return -1;
      } else {
        let ta = (mn[i] - o[i]) / d[i];
        let tb = (mx[i] - o[i]) / d[i];
        if (ta > tb) {
          const tmp = ta;
          ta = tb;
          tb = tmp;
        }
        if (ta > t0) t0 = ta;
        if (tb < t1) t1 = tb;
        if (t0 > t1) return -1;
      }
    }
    return t0;
  },
  rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  },
  formatTime(seconds) {
    if (seconds == null || !isFinite(seconds)) return '--:--.--';
    const s = Math.max(0, seconds);
    const m = Math.floor(s / 60);
    const sec = s - m * 60;
    return `${m}:${sec < 10 ? '0' : ''}${sec.toFixed(2)}`;
  },
  /** Depth in metres below the spawn height (y = 0). */
  depthMeters: (y) => Math.max(0, Math.round(-y)),
};

// -----------------------------------------------------------------------------
// Event bus
// -----------------------------------------------------------------------------
export class EventBus {
  constructor() {
    this._h = Object.create(null);
  }
  on(type, fn) {
    (this._h[type] || (this._h[type] = [])).push(fn);
    return () => this.off(type, fn);
  }
  off(type, fn) {
    const list = this._h[type];
    if (!list) return;
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
  emit(type, payload) {
    const list = this._h[type];
    if (!list || !list.length) return;
    for (const fn of list.slice()) {
      try {
        fn(payload || {}, type);
      } catch (err) {
        if (typeof console !== 'undefined') console.error(`[AT3D] listener for "${type}" failed`, err);
      }
    }
  }
  clear() {
    this._h = Object.create(null);
  }
}

// -----------------------------------------------------------------------------
// Persistence (defensive; storage may be unavailable)
// -----------------------------------------------------------------------------
const PREFIX = 'abyssalTether3d.v1.';
function ls() {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
export const Storage = {
  get(key, fallback) {
    const s = ls();
    if (!s) return fallback;
    try {
      const raw = s.getItem(PREFIX + key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    const s = ls();
    if (!s) return false;
    try {
      s.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  loadSettings() {
    const saved = Storage.get('settings', null);
    const out = Object.assign({}, SETTINGS_DEFAULTS);
    if (saved && typeof saved === 'object') {
      for (const k of Object.keys(SETTINGS_DEFAULTS)) {
        if (k in saved && typeof saved[k] === typeof SETTINGS_DEFAULTS[k]) out[k] = saved[k];
      }
    }
    if (!DIFFICULTY[out.lastDifficulty]) out.lastDifficulty = 'normal';
    return out;
  },
  saveSettings: (s) => Storage.set('settings', s),
  getBest(diffKey) {
    const v = Storage.get(`best.${diffKey}`, null);
    return typeof v === 'number' && isFinite(v) && v > 0 ? v : null;
  },
  submitTime(diffKey, seconds) {
    const previous = Storage.getBest(diffKey);
    const isNew = previous == null || seconds < previous;
    if (isNew) Storage.set(`best.${diffKey}`, seconds);
    return { best: isNew ? seconds : previous, previous, isNew };
  },
  recordDepth(diffKey, meters) {
    const cur = Storage.get(`deepest.${diffKey}`, 0);
    if (meters > cur) Storage.set(`deepest.${diffKey}`, meters);
    return Math.max(cur, meters);
  },
};
