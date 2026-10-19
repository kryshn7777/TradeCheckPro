/* ABYSSAL TETHER — config.js
 * Shared tuning constants, difficulty presets, math utilities, the event bus
 * and localStorage persistence. Loaded first by index.html.
 *
 * This file (like level.js / physics.js / creature.js / threat.js) must not
 * touch the DOM at load time so the simulation can be exercised from Node
 * for tooling (`global.window = {}` then load the scripts in order).
 */
(function (AT) {
  'use strict';

  const DEG = Math.PI / 180;

  // ---------------------------------------------------------------------------
  // Core tuning. World units ("u"): y grows downward, 10u = 1 metre of depth.
  // ---------------------------------------------------------------------------
  const CONFIG = {
    UNITS_PER_METER: 10,
    PHYSICS_DT: 1 / 240, // fixed simulation step (s)
    MAX_FRAME_DT: 0.1, // frame delta cap (s) — avoids spiral of death after tab switch
    MAX_STEPS_PER_FRAME: 30,

    player: {
      radius: 14,
      gravity: 1550,
      maxSpeed: 1900, // absolute speed clamp (runaway protection)
      maxFallSpeed: 1500, // terminal velocity when not on a rope
      runAccel: 2600,
      runMaxSpeed: 330,
      groundFriction: 10, // exponential decay rate when no ground input
      overspeedFriction: 2.2, // decay toward runMaxSpeed when landing fast
      airAccel: 760,
      airMaxSpeed: 380, // air control never accelerates beyond this; it never brakes momentum either
      airDrag: 0.04,
      jumpSpeed: 540,
      coyoteTime: 0.1,
      jumpBuffer: 0.12,
      hardLandingSpeed: 760, // >= this → stagger + heavy landing feedback
      staggerTime: 0.35,
      staggerControl: 0.35, // control multiplier while staggered
      groundNormalY: -0.55, // contact normal.y below this counts as standing
      lethalNormalY: -0.3, // only floor-ish impacts can be lethal (walls/ceilings only stagger)
      wallHitFxSpeed: 320,
      fallDeathMargin: 900, // falling this far below the level's bottom = death
    },

    rope: {
      minLength: 46,
      maxLengthBonus: 80, // reel-out cap = difficulty aimRange + this
      reelInSpeed: 320,
      reelOutSpeed: 360,
      pumpAccel: 640, // tangential swing assist from A/D while taut
      reelSpinCap: 1.02, // max per-step tangential speed gain from angular-momentum conservation
      releaseBoost: 1.04,
      releaseBoostMinSpeed: 280,
      fireSpeed: 7000, // visual tether extension speed (attachment itself is immediate)
      missTime: 0.24, // duration of the whiff animation
      grappleBuffer: 0.2, // a held press keeps searching for a target this long
      tautSlack: 1.5,
      joltFxSpeed: 650, // radial speed removed in one step that counts as a hard "catch"
    },

    targeting: {
      mouseAssistRadius: 70, // world units around the cursor that always count as "aimed at"
      stickiness: 0.18, // score bonus that keeps the current highlight from flickering
      losEndClearance: 22, // ignore geometry this close to the anchor when checking line of sight
      minAimDistance: 24, // aim points closer than this to the player fall back to the last aim direction
    },

    camera: {
      minVisibleW: 760,
      minVisibleH: 860,
      minVisibleHTouch: 700,
      followRate: 6.5,
      lookDownBase: 0.13, // fraction of view height — show more below than above
      lookAheadVelY: 0.24,
      lookAheadVelX: 0.14,
      maxLookDown: 300,
      maxLookUp: 110,
      maxLookX: 160,
    },
  };

  // ---------------------------------------------------------------------------
  // Difficulty presets. `levelVariant` selects which level objects exist
  // (objects may carry `omitIn: [...]` / `onlyIn: [...]` variant lists).
  // ---------------------------------------------------------------------------
  const DIFFICULTY = {
    normal: {
      key: 'normal',
      label: 'Normal',
      blurb: 'The intended descent. Generous aim assist, recovery anchors, a patient predator.',
      levelVariant: 'normal',
      aimRange: 560,
      aimConeDeg: 42,
      touchAssistRadius: 120,
      lethalImpact: 1150,
      impactsLethal: true,
      fragileTime: 1.5,
      crumbleTime: 0.9,
      checkpoints: 'all', // 'all' | 'alternate' | 'none'
      recordTimes: true,
      creature: { enabled: true, speed: 1.0, aggression: 1.0, staminaDrain: 1.0, staminaRegen: 1.0, killRadius: 64 },
    },
    nightmare: {
      key: 'nightmare',
      label: 'Nightmare',
      blurb: 'Faster hunter, tighter aim, fewer recovery anchors, nastier geometry.',
      levelVariant: 'nightmare',
      aimRange: 520,
      aimConeDeg: 28,
      touchAssistRadius: 92,
      lethalImpact: 1060,
      impactsLethal: true,
      fragileTime: 1.05,
      crumbleTime: 0.65,
      checkpoints: 'alternate',
      recordTimes: true,
      creature: { enabled: true, speed: 1.18, aggression: 1.3, staminaDrain: 0.9, staminaRegen: 1.25, killRadius: 72 },
    },
    abyss: {
      key: 'abyss',
      label: 'Abyss',
      blurb: 'For speedrunners. Minimal assist, almost no recovery, no checkpoints.',
      levelVariant: 'abyss',
      aimRange: 495,
      aimConeDeg: 20,
      touchAssistRadius: 72,
      lethalImpact: 990,
      impactsLethal: true,
      fragileTime: 0.8,
      crumbleTime: 0.5,
      checkpoints: 'none',
      recordTimes: true,
      creature: { enabled: true, speed: 1.34, aggression: 1.6, staminaDrain: 0.8, staminaRegen: 1.5, killRadius: 78 },
    },
    sandbox: {
      key: 'sandbox',
      label: 'Sandbox',
      blurb: 'No predator, no lethal falls. Practise the tether at your own pace.',
      levelVariant: 'normal',
      aimRange: 560,
      aimConeDeg: 42,
      touchAssistRadius: 120,
      lethalImpact: 1150,
      impactsLethal: false,
      fragileTime: 1.5,
      crumbleTime: 0.9,
      checkpoints: 'all',
      recordTimes: false,
      creature: { enabled: false, speed: 0, aggression: 0, staminaDrain: 1, staminaRegen: 1, killRadius: 0 },
    },
  };
  for (const key of Object.keys(DIFFICULTY)) {
    DIFFICULTY[key].aimCone = DIFFICULTY[key].aimConeDeg * DEG;
  }
  const DIFFICULTY_ORDER = ['normal', 'nightmare', 'abyss'];

  // ---------------------------------------------------------------------------
  // Settings (persisted).
  // ---------------------------------------------------------------------------
  const SETTINGS_DEFAULTS = {
    volume: 0.8, // master 0..1
    sensitivity: 1.0, // 0.5..2 — virtual sticks, keyboard/gamepad aim
    aimAssist: 1.0, // 0.6..1.4 — scales aim cone + touch assist radius
    reducedEffects: false, // fewer particles, no distortion, lower render scale
    reducedShake: false,
    highContrast: false, // bold, shape-coded grapple indicators
    haptics: true, // navigator.vibrate on supported devices
    touchAimMode: 'direct', // 'direct' (touch the anchor) | 'stick' (right aim stick)
    touchGrappleMode: 'hold', // 'hold' (lift to release) | 'toggle' (tap to attach, tap to release)
    touchControls: 'auto', // 'auto' | 'always' | 'never'
    lastDifficulty: 'normal',
  };

  // ---------------------------------------------------------------------------
  // Math utilities.
  // ---------------------------------------------------------------------------
  const util = {
    DEG,
    TAU: Math.PI * 2,
    clamp(v, lo, hi) {
      return v < lo ? lo : v > hi ? hi : v;
    },
    lerp(a, b, t) {
      return a + (b - a) * t;
    },
    invLerp(a, b, v) {
      return a === b ? 0 : (v - a) / (b - a);
    },
    smoothstep(a, b, v) {
      const t = util.clamp(util.invLerp(a, b, v), 0, 1);
      return t * t * (3 - 2 * t);
    },
    /** Frame-rate independent exponential approach. */
    damp(current, target, rate, dt) {
      return target + (current - target) * Math.exp(-rate * dt);
    },
    approach(current, target, maxDelta) {
      if (current < target) return Math.min(current + maxDelta, target);
      return Math.max(current - maxDelta, target);
    },
    sign(v) {
      return v > 0 ? 1 : v < 0 ? -1 : 0;
    },
    dist(ax, ay, bx, by) {
      return Math.hypot(bx - ax, by - ay);
    },
    dist2(ax, ay, bx, by) {
      const dx = bx - ax;
      const dy = by - ay;
      return dx * dx + dy * dy;
    },
    /** Unsigned angle between two vectors (radians, 0..PI). */
    angleBetween(ax, ay, bx, by) {
      const la = Math.hypot(ax, ay);
      const lb = Math.hypot(bx, by);
      if (la < 1e-9 || lb < 1e-9) return Math.PI;
      return Math.acos(util.clamp((ax * bx + ay * by) / (la * lb), -1, 1));
    },
    rectsOverlap(a, b) {
      return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
    },
    pointInRect(px, py, r) {
      return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
    },
    /** Does a circle overlap an axis-aligned rect? */
    circleRect(cx, cy, cr, r) {
      const qx = util.clamp(cx, r.x, r.x + r.w);
      const qy = util.clamp(cy, r.y, r.y + r.h);
      return util.dist2(cx, cy, qx, qy) < cr * cr;
    },
    /**
     * Liang–Barsky segment vs axis-aligned rect. `inset` shrinks the rect so
     * grazing an edge does not count. Returns entry t (0..1) or -1.
     */
    segmentRect(x0, y0, x1, y1, r, inset) {
      const pad = inset || 0;
      const rx0 = r.x + pad;
      const ry0 = r.y + pad;
      const rx1 = r.x + r.w - pad;
      const ry1 = r.y + r.h - pad;
      if (rx1 <= rx0 || ry1 <= ry0) return -1;
      const dx = x1 - x0;
      const dy = y1 - y0;
      let t0 = 0;
      let t1 = 1;
      const p = [-dx, dx, -dy, dy];
      const q = [x0 - rx0, rx1 - x0, y0 - ry0, ry1 - y0];
      for (let i = 0; i < 4; i++) {
        if (Math.abs(p[i]) < 1e-12) {
          if (q[i] < 0) return -1;
        } else {
          const t = q[i] / p[i];
          if (p[i] < 0) {
            if (t > t1) return -1;
            if (t > t0) t0 = t;
          } else {
            if (t < t0) return -1;
            if (t < t1) t1 = t;
          }
        }
      }
      return t0;
    },
    /** Deterministic PRNG (mulberry32). */
    rng(seed) {
      let s = seed >>> 0;
      return function () {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      };
    },
    /** Cheap integer hash → [0,1). */
    hash(n) {
      let x = Math.imul((n | 0) ^ 0x9e3779b9, 0x85ebca6b);
      x ^= x >>> 13;
      x = Math.imul(x, 0xc2b2ae35);
      x ^= x >>> 16;
      return (x >>> 0) / 4294967296;
    },
    /** Smooth 1D value noise in [-1, 1]. */
    noise1(x, seed) {
      const s = (seed | 0) * 1013;
      const i = Math.floor(x);
      const f = x - i;
      const u = f * f * (3 - 2 * f);
      const a = util.hash(i + s) * 2 - 1;
      const b = util.hash(i + 1 + s) * 2 - 1;
      return a + (b - a) * u;
    },
    formatTime(seconds) {
      if (seconds == null || !isFinite(seconds)) return '--:--.--';
      const s = Math.max(0, seconds);
      const m = Math.floor(s / 60);
      const sec = s - m * 60;
      return `${m}:${sec < 10 ? '0' : ''}${sec.toFixed(2)}`;
    },
    depthMeters(y) {
      return Math.max(0, Math.round(y / CONFIG.UNITS_PER_METER));
    },
  };

  // ---------------------------------------------------------------------------
  // Event bus — decouples simulation from audio / particles / camera / UI.
  // ---------------------------------------------------------------------------
  class EventBus {
    constructor() {
      this._handlers = Object.create(null);
    }
    on(type, fn) {
      (this._handlers[type] || (this._handlers[type] = [])).push(fn);
      return () => this.off(type, fn);
    }
    off(type, fn) {
      const list = this._handlers[type];
      if (!list) return;
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }
    emit(type, payload) {
      const list = this._handlers[type];
      if (!list || list.length === 0) return;
      for (const fn of list.slice()) {
        try {
          fn(payload || {}, type);
        } catch (err) {
          // A broken listener (e.g. audio) must never take the simulation down.
          if (typeof console !== 'undefined') console.error(`[AT] listener for "${type}" failed`, err);
        }
      }
    }
    clear() {
      this._handlers = Object.create(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Persistence (localStorage, defensive — private mode / disabled storage
  // must never break the game).
  // ---------------------------------------------------------------------------
  const PREFIX = 'abyssalTether.v1.';
  function storage() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) return null;
      return window.localStorage;
    } catch {
      return null;
    }
  }
  const Storage = {
    get(key, fallback) {
      const ls = storage();
      if (!ls) return fallback;
      try {
        const raw = ls.getItem(PREFIX + key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      const ls = storage();
      if (!ls) return false;
      try {
        ls.setItem(PREFIX + key, JSON.stringify(value));
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
      out.volume = util.clamp(out.volume, 0, 1);
      out.sensitivity = util.clamp(out.sensitivity, 0.5, 2);
      out.aimAssist = util.clamp(out.aimAssist, 0.6, 1.4);
      if (!DIFFICULTY[out.lastDifficulty]) out.lastDifficulty = 'normal';
      return out;
    },
    saveSettings(settings) {
      return Storage.set('settings', settings);
    },
    /** Best completion time in seconds, or null. */
    getBest(diffKey) {
      const v = Storage.get(`best.${diffKey}`, null);
      return typeof v === 'number' && isFinite(v) && v > 0 ? v : null;
    },
    /** Records a completion; returns { best, previous, isNew }. */
    submitTime(diffKey, seconds) {
      const previous = Storage.getBest(diffKey);
      const isNew = previous == null || seconds < previous;
      if (isNew) Storage.set(`best.${diffKey}`, seconds);
      const stats = Storage.getStats(diffKey);
      stats.completions += 1;
      Storage.set(`stats.${diffKey}`, stats);
      return { best: isNew ? seconds : previous, previous, isNew };
    },
    getStats(diffKey) {
      const s = Storage.get(`stats.${diffKey}`, null);
      return {
        runs: (s && s.runs) || 0,
        completions: (s && s.completions) || 0,
        deepest: (s && s.deepest) || 0, // metres
        leastDeaths: s && typeof s.leastDeaths === 'number' ? s.leastDeaths : null,
      };
    },
    recordRunStart(diffKey) {
      const stats = Storage.getStats(diffKey);
      stats.runs += 1;
      Storage.set(`stats.${diffKey}`, stats);
    },
    /** Keeps the deepest point reached (metres). Returns the stored deepest. */
    recordDepth(diffKey, meters) {
      const stats = Storage.getStats(diffKey);
      if (meters > stats.deepest) {
        stats.deepest = meters;
        Storage.set(`stats.${diffKey}`, stats);
      }
      return stats.deepest;
    },
    recordDeaths(diffKey, deaths) {
      const stats = Storage.getStats(diffKey);
      if (stats.leastDeaths == null || deaths < stats.leastDeaths) {
        stats.leastDeaths = deaths;
        Storage.set(`stats.${diffKey}`, stats);
      }
    },
  };

  AT.CONFIG = CONFIG;
  AT.DIFFICULTY = DIFFICULTY;
  AT.DIFFICULTY_ORDER = DIFFICULTY_ORDER;
  AT.SETTINGS_DEFAULTS = SETTINGS_DEFAULTS;
  AT.util = util;
  AT.EventBus = EventBus;
  AT.Storage = Storage;
})((window.AT = window.AT || {}));
