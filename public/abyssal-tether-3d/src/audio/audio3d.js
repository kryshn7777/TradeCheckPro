/* ABYSSAL TETHER 3D — audio3d.js
 * AudioManager3D: the 2D game's fully procedural Web Audio soundscape
 * (public/abyssal-tether/js/audio.js), ported to an ES module and to a true
 * 3D world in metres. No samples, no recordings: every sound is synthesised
 * at runtime from oscillators and three noise buffers generated at unlock.
 *   - ambient: shaft wind (stereo, gusting), a whistle through the masonry,
 *     sub rumble, a per-section tonal pad, structural creaks / drips /
 *     settling ticks placed at random points in the space around the head;
 *   - player (head-locked): breathing, tether fire / miss / release / jolt,
 *     rope creak from tension (both hands), fragile-anchor grinding, reel
 *     ratchet, footsteps, landings, wall hits, falling roar, stingers;
 *   - anchors / debris (world-space): the hook biting the anchor, fragile
 *     anchors breaking, crumbling ledges, debris trigger falls;
 *   - creature (world-space, HRTF): grinding scrape bed, close scrape layer,
 *     low resonance drone, "listening" chitter, plus one-shot limb clicks,
 *     calls, bursts, attacks, retreats and sightings;
 *   - psychological: heartbeat (threat.heartRate / threat.beat) and a dread
 *     rumble swelling with threat.
 *
 * Spatialisation: world-space sources use PannerNode (panningModel 'HRTF',
 * distanceModel 'inverse'); the AudioContext listener follows the camera's
 * world pose every frame (positionX/Y/Z + forward/up AudioParams, with the
 * legacy setPosition/setOrientation fallback). Position params are switched
 * to k-rate so Chrome keeps the cheap per-quantum HRTF path. HRTF voices are
 * capped (MAX_HRTF); beyond the cap a voice falls back to equal-power panning.
 *
 * Graph:
 *   ambient ─┐
 *   player ──┼─► muffle (lowpass; closes on death) ─┐
 *   creature ┤        ▲                             ├─► master (volume) ─► compressor ─► soft clip ─► out
 *   psych ───┘   space (feedback-delay "room")      │
 *   ui, stinger ────────────────────────────────────┘
 *
 * Robustness: `enabled` is false and every method is a no-op without Web
 * Audio. unlock() is idempotent and gesture-safe (also on XR session start
 * and on the first XR select/squeeze). All parameter changes are ramped,
 * one-shots are capped and rate limited, finished nodes are disconnected,
 * and nothing in here throws into the game.
 *
 * Public API (contract §7): new AudioManager3D(bus, settings); unlock();
 * setVolume(v); setPaused(b); update(dt, game); stopAll(). Extras: enabled,
 * activeVoices, peakVoices, hrtfVoices; _attachContext(ctx) (tests).
 */
import { CONFIG, SETTINGS_DEFAULTS, U as CU } from '../sim/config3d.js';

// Maths helpers (config3d's U plus the 1D value noise the 2D util provided).
const U = {
  clamp: CU.clamp,
  smoothstep: CU.smoothstep,
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
    const a = U.hash(i + s) * 2 - 1;
    const b = U.hash(i + 1 + s) * 2 - 1;
    return a + (b - a) * u;
  },
};

// ===========================================================================
// Tuning
// ===========================================================================
const MAX_VOICES = 24; // simultaneous one-shot voices (voices fading out after a steal excluded)
const VOICE_POOL = 34; // voice records (cap + headroom for voices still fading out)
const CONTROL_DT = 1 / 30; // continuous-layer parameter update interval (s)
const LOOKAHEAD = 0.005; // one-shots start this far after "now" (s)
const GATE_HOLD = 3; // a continuous layer silent this long is disconnected from its sources (s)
const MAX_HRTF = 10; // one-shot voices allowed an HRTF panner at once (the rest use equal-power)
const HRTF_AMBIENT = 5; // ambient decoration only takes an HRTF panner while fewer than this are busy

// Spatial tuning (metres). The 2D game's distance curves (pixels) were mapped
// to the 3D scale (≈ 20 px per metre for distances, ≈ 60 px/s per m/s for
// speeds, ≈ 115 px/s² per m/s² for rope tension) so the mix keeps its pacing.
//   inverse model: gain = ref / (ref + rolloff · (max(d, ref) − ref))
// 'near' (ref 12, rolloff 1) reproduces the 2D one-shot presence curve
// 1 / (1 + (d / 26)^1.5); 'bed' (rolloff 0.25) reproduces the flatter
// presence^0.45 used for the creature's continuous layers (heard from far away).
const PANNER = {
  near: { ref: 12, rolloff: 1, max: 10000 },
  bed: { ref: 12, rolloff: 0.25, max: 10000 },
  ambient: { ref: 8, rolloff: 0.6, max: 10000 },
  flat: { ref: 1, rolloff: 0, max: 10000 }, // direction only (sightings at the edge of hearing)
};
const PRESENCE_D = 26; // 2D: 520 px → metres (half-loudness distance of creature sounds)
const AIR_D = 35; // distance low-pass e-folding distance (2D: 700 px)
const SEND_D = 45; // reverb send growth distance (2D: 900 px)
const CREATURE_FAR = [150, 220]; // creature bed fully silent beyond this (m)
const SPEED_K = 1 / 60; // 2D px/s → m/s for loudness thresholds
const TENSION_K = 1 / 115; // 2D tension (px/s²) → 3D (m/s²)
const STRIDE = 1.5; // metres per footstep
const HAND_PAN = { left: -0.35, right: 0.35 };
const FIRE_SPEED = CONFIG.rope.fireSpeed || 220; // tether travel speed (m/s): delay before the hook bites

const BUS_LEVEL = { ambient: 0.85, player: 1, creature: 1, psych: 1, ui: 0.5, stinger: 1 };
const DUCKED = { ambient: 0.45, stinger: 0.5 }; // kept while paused / in menus (other gameplay buses → 0)

// Inharmonic partials for struck iron (ratios, amplitudes, decay time-constants).
const PARTIALS = [1, 2.32, 3.86, 5.41];
const PARTIAL_AMP = [0.5, 0.3, 0.2, 0.12];
const PARTIAL_TC = [0.11, 0.07, 0.05, 0.034];

// Bell-ish ratios for distant resonant tones / chimes.
const BELL = [1, 2.76, 5.4, 8.93];
const BELL_AMP = [1, 0.45, 0.22, 0.08];

// Per-section ambience. Deeper sections are lower, darker and more reverberant.
//   wind: wind band centre (Hz)   windLvl: wind gain     whistle/wFreq: masonry whistle
//   rumble: sub rumble gain       root/iv: tonal pad root (Hz) and interval ratio, pad: pad gain
//   space: wet level   fb: feedback (≤0.75)   size: delay-time multiplier
//   creaks/drips: average events per minute
const SECTION_SOUND = [
  // 1 The Threshold — airy, close, dripping.
  { wind: 560, windLvl: 0.2, whistle: 0.05, wFreq: 1180, rumble: 0.1, root: 65.41, iv: 1.5, pad: 0.03, space: 0.2, fb: 0.4, size: 0.9, creaks: 3, drips: 12 },
  // 2 The Long Swing — open drop, more wind.
  { wind: 480, windLvl: 0.26, whistle: 0.07, wFreq: 990, rumble: 0.12, root: 61.74, iv: 1.5, pad: 0.03, space: 0.26, fb: 0.48, size: 1.1, creaks: 4, drips: 9 },
  // 3 Broken Gallery — failing stonework, frequent groans.
  { wind: 420, windLvl: 0.22, whistle: 0.05, wFreq: 880, rumble: 0.15, root: 58.27, iv: 1.335, pad: 0.03, space: 0.28, fb: 0.52, size: 1.15, creaks: 8, drips: 7 },
  // 4 The Listening Vault — vast and too quiet; long echoes.
  { wind: 340, windLvl: 0.12, whistle: 0.03, wFreq: 770, rumble: 0.13, root: 55.0, iv: 1.414, pad: 0.035, space: 0.42, fb: 0.68, size: 1.6, creaks: 4, drips: 14 },
  // 5 The Gullet Stair — narrower, lower, organic.
  { wind: 300, windLvl: 0.2, whistle: 0.04, wFreq: 690, rumble: 0.22, root: 51.91, iv: 1.414, pad: 0.035, space: 0.3, fb: 0.56, size: 1.0, creaks: 7, drips: 8 },
  // 6 The Two Descents.
  { wind: 280, windLvl: 0.24, whistle: 0.05, wFreq: 640, rumble: 0.24, root: 49.0, iv: 1.26, pad: 0.035, space: 0.33, fb: 0.6, size: 1.25, creaks: 6, drips: 6 },
  // 7 The Hollow Nave — huge open void, strong gusts.
  { wind: 240, windLvl: 0.28, whistle: 0.08, wFreq: 560, rumble: 0.24, root: 46.25, iv: 1.414, pad: 0.04, space: 0.44, fb: 0.7, size: 1.8, creaks: 5, drips: 4 },
  // 8 The Last Throat — lowest, loudest rumble, a grinding minor second.
  { wind: 210, windLvl: 0.28, whistle: 0.04, wFreq: 500, rumble: 0.3, root: 43.65, iv: 1.0595, pad: 0.04, space: 0.34, fb: 0.62, size: 1.3, creaks: 9, drips: 3 },
];

// Creature cry formants: [start Hz, peak Hz, end Hz, Q, gain].
const FORMANTS = [
  [420, 720, 480, 7, 1],
  [950, 1250, 820, 9, 0.6],
  [2500, 2850, 2300, 11, 0.3],
];
const VICTORY_DRONE = [55, 82.41, 110]; // A1, E2, A2 — root, fifth, octave
const VICTORY_CHIMES = [440, 659.26, 554.37, 880, 739.99];
const VICTORY_TIMES = [0.4, 1.6, 2.9, 4.4, 6.2];
const CHECKPOINT_BELL = [196, 293.66];

const SPACE_DELAYS = [0.083, 0.127, 0.191]; // base delay times of the 3-line feedback network (s)
const SPACE_PANS = [-0.7, 0.1, 0.7];

const EMPTY = Object.freeze({});
function noop() {}

// ===========================================================================
// Small helpers
// ===========================================================================
function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}
function rand(a, b) {
  return a + Math.random() * (b - a);
}

/**
 * Switches an AudioParam to block-rate (128-sample) automation where supported.
 * Chrome otherwise recomputes biquad coefficients for every sample while a
 * frequency is being automated (measured ≈2× the cost of a static filter). The
 * sweeps here are slow, so block rate is inaudible. Gains stay a-rate so
 * envelopes remain click-free.
 */
function kRate(param) {
  try {
    if (param && 'automationRate' in param) param.automationRate = 'k-rate';
  } catch {
    // unsupported for this param — fine
  }
  return param;
}

/** Generates a mono noise buffer. Brown/pink are de-trended so the loop seam does not click. */
function makeNoise(ctx, seconds, kind) {
  const sr = ctx.sampleRate;
  const len = Math.max(256, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(1, len, sr);
  const d = buf.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let last = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === 'pink') {
      // Paul Kellet's economy pink filter.
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = b0 + b1 + b2 + w * 0.1848;
    } else if (kind === 'brown') {
      last = (last + 0.02 * w) / 1.02;
      d[i] = last;
    } else {
      d[i] = w;
    }
  }
  if (kind !== 'white') {
    // Remove drift between the ends (seamless loop) and the DC offset.
    const drift = d[len - 1] - d[0];
    let mean = 0;
    for (let i = 0; i < len; i++) {
      d[i] -= (drift * i) / (len - 1);
      mean += d[i];
    }
    mean /= len;
    for (let i = 0; i < len; i++) d[i] -= mean;
  }
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const a = d[i] < 0 ? -d[i] : d[i];
    if (a > peak) peak = a;
  }
  const k = peak > 0 ? 0.95 / peak : 1;
  for (let i = 0; i < len; i++) d[i] *= k;
  return buf;
}

/** Transparent below 0.7, smoothly saturating to a hard ceiling of ~0.92. */
function makeSoftClip() {
  const n = 2048;
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    const ax = Math.abs(x);
    const y = ax < 0.7 ? ax : 0.7 + 0.28 * Math.tanh((ax - 0.7) / 0.28);
    c[i] = x < 0 ? -y : y;
  }
  return c;
}

// ===========================================================================
// Knob — a smoothed AudioParam target that skips redundant automation events.
// ===========================================================================
class Knob {
  constructor(param, value, eps, rel) {
    this.param = param;
    this.last = value;
    this.eps = eps;
    this.rel = rel || 0;
    try {
      param.value = value;
    } catch {
      // some implementations reject out-of-range values; keep the default
    }
  }
  /** Ramps toward v (time-constant tc) when it differs meaningfully from the last target. */
  set(v, now, tc) {
    if (typeof v !== 'number' || !isFinite(v)) return;
    const d = v - this.last;
    const tol = this.eps + (this.last < 0 ? -this.last : this.last) * this.rel;
    if ((d < 0 ? -d : d) <= tol) return;
    this.force(v, now, tc);
  }
  force(v, now, tc) {
    if (typeof v !== 'number' || !isFinite(v)) return;
    this.last = v;
    try {
      this.param.setTargetAtTime(v, now, tc > 0.001 ? tc : 0.001);
    } catch {
      // context closed — ignore
    }
  }
}

/** Knob-compatible pan control for the PannerNode fallback (no StereoPannerNode). */
class PanKnob {
  constructor(mgr, node, value) {
    this.mgr = mgr;
    this.node = node;
    this.last = value;
    mgr._setPan(node, value, 0, 0);
  }
  set(v, now, tc) {
    if (typeof v !== 'number' || !isFinite(v) || Math.abs(v - this.last) < 0.01) return;
    this.force(v, now, tc);
  }
  force(v, now, tc) {
    if (typeof v !== 'number' || !isFinite(v)) return;
    this.last = v;
    this.mgr._setPan(this.node, v, now, tc);
  }
}

/** One-shot voice record (pooled). */
class Voice {
  constructor() {
    this.nodes = [];
    this.sources = [];
    this.alive = false;
    this.dying = false;
    this.name = '';
    this.priority = 0;
    this.t0 = 0;
    this.end = 0;
    this.out = null;
    this.hrtf = false; // holds one of the MAX_HRTF panners
    this.panner = null; // world-space PannerNode (spatial voices)
  }
}

// ===========================================================================
// AudioManager3D
// ===========================================================================
export class AudioManager3D {
  /**
   * @param {EventBus} bus  game event bus (sound triggers)
   * @param {object} settings  live settings object (reads .volume)
   */
  constructor(bus, settings) {
    this.bus = bus || null;
    this.settings = settings || SETTINGS_DEFAULTS || {};
    const W = typeof window !== 'undefined' ? window : null;
    this._Ctor = W ? W.AudioContext || W.webkitAudioContext || null : null;
    /** False when Web Audio is unavailable — every method is then a no-op. */
    this.enabled = !!this._Ctor;
    this.ctx = null;
    this._game = null; // last game passed to update() (read-only lookups from event handlers)

    this._built = false;
    this._offline = false;
    this._volume = U.clamp(num(this.settings.volume, 0.8), 0, 1);
    this._polledVolume = this._volume; // last settings.volume seen (so direct setVolume() calls are not overridden)
    this._pauseFlag = false;
    this._dead = false;
    this._victory = false;
    this._hushUntil = 0;
    this._autoSuspended = false;
    this._warned = Object.create(null);
    this._silentBuf = null;
    this._silencePlayed = false;

    this._voices = [];
    for (let i = 0; i < VOICE_POOL; i++) this._voices.push(new Voice());
    this._lastPlay = Object.create(null);
    this._peakVoices = 0;
    this._knobs = [];
    this._gates = [];

    // Listener (world metres): the camera's world pose (head in XR), else the player.
    this._lx = 0;
    this._ly = 0;
    this._lz = 0;
    this._lfx = 0; // forward
    this._lfy = 0;
    this._lfz = -1;
    this._lux = 0; // up
    this._luy = 1;
    this._luz = 0;
    this._listenerSet = false;
    this._lastL = new Float64Array(9).fill(NaN); // last values written to the listener
    this._sp = { d: 0, gain: 0, cutoff: 0, send: 0, ok: false, x: 0, y: 0, z: 0 }; // spatial scratch
    this._pos = { x: 0, y: 0, z: 0 }; // position scratch for one-shots
    this._hrtfCount = 0;
    this._peakHrtf = 0;
    this._lastFireAt = -10;
    this._strikeSeen = false; // the creature reports lunge contacts (creature:strike)
    this._xrHooked = null; // the WebXRManager whose session events are wired to unlock()
    this._prevLen = { left: 0, right: 0 };
    this._prevAtt = { left: false, right: false };

    // Clocks / state for the continuous layers.
    this._clock = 0;
    this._ctlAcc = CONTROL_DT;
    this._state = 'menu';
    this._secIndex = -1;
    this._sec = SECTION_SOUND[0];
    this._spaceFb = 0.4; // current section's room feedback / wet level (applied in _mixBuses)
    this._spaceLevel = 0.2;
    this._tv = 0; // threat value seen by the last control tick
    this._exertion = 0.1;
    this._breathT = 0.5;
    this._breathOn = false;
    this._breathRate = 14;
    this._breathLevel = 0;
    this._heartLevel = 0;
    this._prevBeat = -1;
    this._beatClock = 0;
    this._lastBeatAt = -10;
    this._stride = 0;
    this._creakT = rand(2, 6);
    this._dripT = rand(1, 4);
    this._tickT = rand(3, 9);
    this._gritT = 0;

    if (!this.enabled) return;
    this._subscribe();
    this._bindDom(W);
  }

  /** Number of one-shot voices currently sounding (excluding ones fading after a steal). */
  get activeVoices() {
    let n = 0;
    for (let i = 0; i < this._voices.length; i++) {
      const v = this._voices[i];
      if (v.alive && !v.dying) n++;
    }
    return n;
  }

  /** Highest simultaneous one-shot count seen (tests / diagnostics). */
  get peakVoices() {
    return this._peakVoices;
  }

  /** One-shot voices currently holding an HRTF panner. */
  get hrtfVoices() {
    return this._hrtfCount;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Creates (first call) and resumes the AudioContext. Call from a user
   * gesture; safe to call any number of times. Returns true when audio is usable.
   */
  unlock() {
    if (!this.enabled) return false;
    try {
      if (!this.ctx) {
        let ctx = null;
        try {
          ctx = new this._Ctor({ latencyHint: 'interactive' });
        } catch {
          ctx = new this._Ctor(); // older WebKit rejects the options bag
        }
        this.ctx = ctx;
        this._build(ctx);
        const onState = () => this._onStateChange();
        if (typeof ctx.addEventListener === 'function') ctx.addEventListener('statechange', onState);
        else ctx.onstatechange = onState;
      }
      const ctx = this.ctx;
      if (ctx.state === 'closed') return false;
      if (ctx.state !== 'running') {
        this._resume();
        this._playSilence(); // iOS: a buffer started inside the gesture unlocks output
      } else if (!this._silencePlayed) {
        this._playSilence(); // once, even if the context already reports 'running'
      }
      return true;
    } catch (err) {
      this._warn('unlock', err);
      if (!this._built) {
        // Graph construction failed: release the context and stay silent for good.
        if (this.ctx) {
          try {
            const p = this.ctx.close();
            if (p && typeof p.catch === 'function') p.catch(noop);
          } catch {
            // ignore
          }
        }
        this.enabled = false;
        this.ctx = null;
      }
      return false;
    }
  }

  /** Master volume 0..1 (perceptual curve). */
  setVolume(v) {
    if (!this.enabled) return;
    this._volume = U.clamp(num(v, this._volume), 0, 1);
    if (!this._built) return;
    this.kMaster.force(this._masterTarget(), this.ctx.currentTime, 0.05);
  }

  /** Ducks gameplay buses (keeps a quiet ambient bed) while paused or in menus. */
  setPaused(paused) {
    if (!this.enabled) return;
    this._pauseFlag = !!paused;
    if (!this._built) return;
    this._hushUntil = 0;
    this._mixBuses(this.ctx.currentTime, this._state);
  }

  /**
   * Per-frame: drives continuous layers from game state and schedules the
   * heartbeat / breathing, and moves the listener to the camera's world pose.
   * Reads game.state, player, tethers (hands.left/right.rope, anchorStress),
   * creature (active, state, audio{x,y,z,distance,intensity,movement,state}),
   * threat (value, heartRate, beat), renderer.camera, level, sectionIndex,
   * diff.lethalImpact, input.xrActive, renderer.renderer.xr (unlock on session start).
   */
  update(dt, game) {
    if (!this.enabled || !this._built) return;
    try {
      this._update(dt, game);
    } catch (err) {
      this._warn('update', err);
    }
  }

  /** Cleanly silences everything now: one-shots fade and stop, layers dip and then follow update() again. */
  stopAll() {
    if (!this.enabled || !this._built) return;
    try {
      const now = this.ctx.currentTime;
      this._killAll(now, 0.012);
      this._hushUntil = now + 0.3;
      this._victory = false;
      for (const k of [this.kAmbient, this.kPlayer, this.kCreature, this.kPsych, this.kStinger]) k.force(0, now, 0.015);
      this._mixSpace(now, true, 0.015);
      this._silenceEnvelopes(now);
    } catch (err) {
      this._warn('stopAll', err);
    }
  }

  // -------------------------------------------------------------------------
  // Context lifecycle
  // -------------------------------------------------------------------------

  _bindDom(W) {
    if (!W || typeof W.addEventListener !== 'function') return;
    // Unlock on the first gesture anywhere (menu ambience) and recover after
    // iOS interruptions. Cheap: returns immediately once running.
    const onGesture = () => {
      if (!this.ctx || this.ctx.state !== 'running') this.unlock();
    };
    const opts = { capture: true, passive: true };
    for (const type of ['pointerdown', 'pointerup', 'touchend', 'mousedown', 'keydown', 'click']) {
      try {
        W.addEventListener(type, onGesture, opts);
      } catch {
        // ignore
      }
    }
    const doc = W.document;
    if (doc && typeof doc.addEventListener === 'function') {
      doc.addEventListener('visibilitychange', () => this._onVisibility(doc));
    }
  }

  /**
   * Unlock on XR session start, and on the first select / squeeze inside the
   * session (a user activation even when the page itself got no gesture).
   * Called from update() once the renderer's WebXRManager is reachable.
   */
  _hookXR(game) {
    const r = game && game.renderer ? game.renderer.renderer || game.renderer : null;
    const xr = r && r.xr;
    if (!xr || xr === this._xrHooked || typeof xr.addEventListener !== 'function') return;
    this._xrHooked = xr;
    const onSession = () => {
      this.unlock();
      let session = null;
      try {
        session = typeof xr.getSession === 'function' ? xr.getSession() : null;
      } catch {
        session = null;
      }
      if (!session || typeof session.addEventListener !== 'function') return;
      const onAct = () => {
        if (!this.ctx || this.ctx.state !== 'running') this.unlock();
      };
      for (const type of ['selectstart', 'squeezestart', 'select']) {
        try {
          session.addEventListener(type, onAct);
        } catch {
          // ignore
        }
      }
    };
    try {
      xr.addEventListener('sessionstart', onSession);
      if (xr.isPresenting) onSession();
    } catch (err) {
      this._warn('xr', err);
    }
  }

  _xrPresenting() {
    const g = this._game;
    if (!g) return false;
    if (g.input && g.input.xrActive) return true;
    const r = g.renderer ? g.renderer.renderer || g.renderer : null;
    return !!(r && r.xr && r.xr.isPresenting);
  }

  _onVisibility(doc) {
    const ctx = this.ctx;
    if (!ctx || this._offline) return;
    try {
      if (doc.hidden) {
        // Never suspend under an immersive session (some browsers report the 2D page hidden).
        if (ctx.state === 'running' && !this._xrPresenting()) {
          this._autoSuspended = true;
          const p = ctx.suspend();
          if (p && typeof p.catch === 'function') p.catch(noop);
        }
      } else if (this._autoSuspended) {
        this._autoSuspended = false;
        this._resume();
      }
    } catch (err) {
      this._warn('visibility', err);
    }
  }

  _onStateChange() {
    const ctx = this.ctx;
    if (!ctx || this._autoSuspended) return;
    // 'interrupted' (iOS calls/Siri) or an unexpected suspend: try to come back.
    // If this needs a gesture it fails quietly and the gesture listener retries.
    if (ctx.state === 'interrupted' || ctx.state === 'suspended') {
      const doc = typeof document !== 'undefined' ? document : null;
      if (!doc || !doc.hidden) this._resume();
    }
  }

  _resume() {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed' || ctx.state === 'running') return;
    try {
      const p = ctx.resume();
      if (p && typeof p.catch === 'function') p.catch(noop);
    } catch {
      // needs a gesture — retried by the gesture listener
    }
  }

  _playSilence() {
    this._silencePlayed = true;
    try {
      const ctx = this.ctx;
      if (!this._silentBuf) this._silentBuf = ctx.createBuffer(1, 1, 22050);
      const s = ctx.createBufferSource();
      s.buffer = this._silentBuf;
      s.connect(ctx.destination);
      s.onended = () => {
        try {
          s.disconnect();
        } catch {
          // already disconnected
        }
      };
      s.start(0);
    } catch {
      // harmless
    }
  }

  /** Test hook: builds the graph on a provided (e.g. Offline) context. */
  _attachContext(ctx) {
    if (this.ctx) return;
    this.enabled = true;
    this._offline = typeof ctx.startRendering === 'function';
    this._build(ctx);
  }

  _warn(where, err) {
    if (this._warned[where]) return;
    this._warned[where] = true;
    if (typeof console !== 'undefined') console.warn(`[AT3D] audio ${where} failed`, err);
  }

  _live() {
    const c = this.ctx;
    return !!c && this._built && (c.state === 'running' || this._offline);
  }

  _masterTarget() {
    return this._volume * this._volume;
  }

  // -------------------------------------------------------------------------
  // Graph construction (once, at unlock)
  // -------------------------------------------------------------------------

  _build(ctx) {
    this.ctx = ctx;
    const now = ctx.currentTime;
    this._nyq = ctx.sampleRate * 0.45;
    this._white = makeNoise(ctx, 2.0, 'white');
    this._pink = makeNoise(ctx, 3.0, 'pink');
    this._brown = makeNoise(ctx, 4.0, 'brown');
    this._loops = [];

    // Output stage.
    this.master = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -18;
    this.comp.knee.value = 10;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.22;
    this.clip = ctx.createWaveShaper();
    this.clip.curve = makeSoftClip();
    this.clip.oversample = 'none';
    this.master.connect(this.comp);
    this.comp.connect(this.clip);
    this.clip.connect(ctx.destination);
    this.kMaster = this._knob(this.master.gain, 0, 0.0005);

    this.muffle = this._filter('lowpass', this._nyq, 0);
    this.muffle.connect(this.master);
    this.kMuffle = this._knob(this.muffle.frequency, this._nyq, 5, 0.01);

    this.busAmbient = this._bus(this.muffle);
    this.busPlayer = this._bus(this.muffle);
    this.busCreature = this._bus(this.muffle);
    this.busPsych = this._bus(this.muffle);
    this.busUi = this._bus(this.master);
    this.busStinger = this._bus(this.master);
    this.kAmbient = this._knob(this.busAmbient.gain, 0, 0.002);
    this.kPlayer = this._knob(this.busPlayer.gain, 0, 0.002);
    this.kCreature = this._knob(this.busCreature.gain, 0, 0.002);
    this.kPsych = this._knob(this.busPsych.gain, 0, 0.002);
    this.kUi = this._knob(this.busUi.gain, BUS_LEVEL.ui, 0.002);
    this.kStinger = this._knob(this.busStinger.gain, 0, 0.002);

    this._buildSpace();
    this._buildAmbient();
    this._buildPlayer();
    this._buildPsych();
    this._buildCreature();

    for (let i = 0; i < this._loops.length; i++) {
      const s = this._loops[i];
      if (s.buffer) s.start(now, Math.random() * (s.buffer.duration - 0.05));
      else s.start(now);
    }
    this._built = true;
    this._applySection(0, null, now, 0.05);
    this._mixBuses(now, this._state);
    this.kMaster.force(this._masterTarget(), now, 0.25); // gentle fade-in once running
  }

  _knob(param, value, eps, rel) {
    const k = new Knob(param, value, eps, rel);
    this._knobs.push(k);
    return k;
  }

  _panKnob(node, value) {
    const k = node.pan ? new Knob(node.pan, value, 0.01, 0) : new PanKnob(this, node, value);
    this._knobs.push(k);
    return k;
  }

  /**
   * Source edges of a continuous layer. While the layer is silent for GATE_HOLD
   * seconds the edges are disconnected so the browser stops rendering its
   * oscillators/filters (a large saving on phones); they reconnect, at zero
   * gain, the moment the layer is needed again.
   */
  _gate(...edges) {
    for (let i = 0; i < edges.length; i++) edges[i][0].connect(edges[i][1]);
    const g = { edges, on: true, quiet: 0, broken: false };
    this._gates.push(g);
    return g;
  }

  _driveGate(g, active, dt) {
    if (g.broken) return;
    if (active) {
      g.quiet = 0;
      if (!g.on) {
        g.on = true;
        for (let i = 0; i < g.edges.length; i++) {
          try {
            g.edges[i][0].connect(g.edges[i][1]);
          } catch {
            // ignore
          }
        }
      }
      return;
    }
    if (!g.on) return;
    g.quiet += dt;
    if (g.quiet < GATE_HOLD) return;
    try {
      for (let i = 0; i < g.edges.length; i++) g.edges[i][0].disconnect(g.edges[i][1]);
      g.on = false;
    } catch {
      // No selective disconnect (very old engines): reconnect and stop gating this layer.
      g.broken = true;
      for (let i = 0; i < g.edges.length; i++) {
        try {
          g.edges[i][0].connect(g.edges[i][1]);
        } catch {
          // ignore
        }
      }
    }
  }

  _bus(dest) {
    const g = this.ctx.createGain();
    g.connect(dest);
    return g;
  }

  _filter(type, freq, q) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = Math.min(freq, this._nyq);
    f.Q.value = q;
    kRate(f.frequency);
    kRate(f.Q);
    return f;
  }

  _gainNode(value) {
    const g = this.ctx.createGain();
    g.gain.value = value;
    return g;
  }

  _osc(type, freq) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    this._loops.push(o);
    return o;
  }

  _loop(buf, rate) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.playbackRate.value = rate;
    this._loops.push(s);
    return s;
  }

  _makePanner(pan) {
    const ctx = this.ctx;
    if (typeof ctx.createStereoPanner === 'function') {
      const p = ctx.createStereoPanner();
      p.pan.value = U.clamp(pan, -1, 1);
      kRate(p.pan);
      return p;
    }
    // Fallback for old WebKit: equal-power PannerNode on a unit circle in front of the listener.
    const p = ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'linear';
    p.refDistance = 1;
    p.maxDistance = 10000;
    p.rolloffFactor = 0;
    this._setPan(p, pan, 0, 0);
    return p;
  }

  _setPan(node, pan, now, tc) {
    const v = U.clamp(num(pan, 0), -1, 1);
    try {
      if (node.pan) {
        if (tc > 0) node.pan.setTargetAtTime(v, now, tc);
        else node.pan.value = v;
        return;
      }
      const a = v * Math.PI * 0.5;
      const x = Math.sin(a);
      const z = -Math.cos(a);
      if (node.positionX && tc > 0) {
        node.positionX.setTargetAtTime(x, now, tc);
        node.positionZ.setTargetAtTime(z, now, tc);
      } else if (typeof node.setPosition === 'function') {
        node.setPosition(x, 0, z);
      }
    } catch {
      // ignore
    }
  }

  /**
   * World-space panner: HRTF (when `hrtf`) or equal-power, inverse distance
   * model with a preset from PANNER. Position params are k-rate (cheap path).
   */
  _makeSpatialPanner(preset, x, y, z, hrtf) {
    const ctx = this.ctx;
    const P = PANNER[preset] || PANNER.near;
    const p = ctx.createPanner();
    try {
      p.panningModel = hrtf ? 'HRTF' : 'equalpower';
    } catch {
      // older engines: keep the default model
    }
    p.distanceModel = 'inverse';
    p.refDistance = P.ref;
    p.rolloffFactor = P.rolloff;
    p.maxDistance = P.max;
    p.coneInnerAngle = 360;
    p.coneOuterAngle = 360;
    p.coneOuterGain = 1;
    if (p.positionX) {
      kRate(p.positionX);
      kRate(p.positionY);
      kRate(p.positionZ);
    }
    if (p.orientationX) {
      kRate(p.orientationX);
      kRate(p.orientationY);
      kRate(p.orientationZ);
    }
    this._setPannerPos(p, x, y, z, 0, 0);
    return p;
  }

  /** Moves a PannerNode (ramped with time-constant tc when tc > 0). */
  _setPannerPos(p, x, y, z, now, tc) {
    if (!(x === x) || !(y === y) || !(z === z)) return;
    try {
      if (p.positionX) {
        if (tc > 0) {
          p.positionX.setTargetAtTime(x, now, tc);
          p.positionY.setTargetAtTime(y, now, tc);
          p.positionZ.setTargetAtTime(z, now, tc);
        } else {
          p.positionX.value = x;
          p.positionY.value = y;
          p.positionZ.value = z;
        }
      } else if (typeof p.setPosition === 'function') {
        p.setPosition(x, y, z);
      }
    } catch {
      // ignore
    }
  }

  /** Inverse-model gain of a PANNER preset at distance d (for level floors). */
  _pannerGain(preset, d) {
    const P = PANNER[preset] || PANNER.near;
    if (P.rolloff <= 0) return 1;
    return P.ref / (P.ref + P.rolloff * (Math.max(d, P.ref) - P.ref));
  }

  /** Cheap "room": three delay lines in a ring with self-feedback, low-passed in the loop. */
  _buildSpace() {
    this.spaceIn = this._gainNode(1);
    const pre = this._filter('lowpass', 3400, 0);
    this.spaceIn.connect(pre);
    this.spaceOut = this._gainNode(0);
    this.spaceOut.connect(this.muffle);
    this.kSpaceOut = this._knob(this.spaceOut.gain, 0, 0.002);
    const delays = [];
    const filters = [];
    const nexts = [];
    this.kSpaceDelay = [];
    this.kSpaceSelf = [];
    this.kSpaceNext = [];
    for (let i = 0; i < 3; i++) {
      const d = this.ctx.createDelay(1.0);
      d.delayTime.value = SPACE_DELAYS[i];
      kRate(d.delayTime);
      const f = this._filter('lowpass', 2600 - i * 450, 0);
      const self = this._gainNode(0);
      const next = this._gainNode(0);
      const pan = this._makePanner(SPACE_PANS[i]);
      pre.connect(d);
      d.connect(f);
      f.connect(self);
      self.connect(d);
      f.connect(pan);
      pan.connect(this.spaceOut);
      delays.push(d);
      filters.push(f);
      this.kSpaceDelay.push(this._knob(d.delayTime, SPACE_DELAYS[i], 0.002, 0.01));
      this.kSpaceSelf.push(this._knob(self.gain, 0, 0.005));
      this.kSpaceNext.push(this._knob(next.gain, 0, 0.005));
      nexts.push(next);
    }
    // Ring: each line also feeds the next one, so echoes thicken as they decay.
    for (let i = 0; i < 3; i++) {
      filters[i].connect(nexts[i]);
      nexts[i].connect(delays[(i + 1) % 3]);
    }
  }

  _buildAmbient() {
    const amb = this.busAmbient;
    const pinkA = this._loop(this._pink, 1);
    const pinkB = this._loop(this._pink, 0.93);
    const whiteA = this._loop(this._white, 1);
    const brownA = this._loop(this._brown, 1);
    this._pinkA = pinkA;
    this._whiteA = whiteA;
    this._brownA = brownA;

    // Stereo shaft wind: two decorrelated band-passed pink noises.
    const wl = this._filter('bandpass', 500, 0.8);
    const wr = this._filter('bandpass', 560, 0.8);
    const gl = this._gainNode(0);
    const gr = this._gainNode(0);
    const pl = this._makePanner(-0.65);
    const pr = this._makePanner(0.65);
    pinkA.connect(wl);
    wl.connect(gl);
    gl.connect(pl);
    pl.connect(amb);
    pinkB.connect(wr);
    wr.connect(gr);
    gr.connect(pr);
    pr.connect(amb);
    this.kWindGL = this._knob(gl.gain, 0, 0.002);
    this.kWindGR = this._knob(gr.gain, 0, 0.002);
    this.kWindFL = this._knob(wl.frequency, 500, 2, 0.01);
    this.kWindFR = this._knob(wr.frequency, 560, 2, 0.01);

    // Whistle through the masonry: very narrow band of white noise, drifting.
    const wh = this._filter('bandpass', 1100, 16);
    const whg = this._gainNode(0);
    const whp = this._makePanner(0);
    const whs = this._gainNode(0.6);
    whiteA.connect(wh);
    wh.connect(whg);
    whg.connect(whp);
    whp.connect(amb);
    whp.connect(whs);
    whs.connect(this.spaceIn);
    this.kWhG = this._knob(whg.gain, 0, 0.002);
    this.kWhF = this._knob(wh.frequency, 1100, 3, 0.01);
    this.kWhPan = this._panKnob(whp, 0);

    // Distant rumble: low-passed brown noise + a sub sine.
    const rl = this._filter('lowpass', 120, 0);
    const rg = this._gainNode(0);
    brownA.connect(rl);
    rl.connect(rg);
    rg.connect(amb);
    const sub = this._osc('sine', 36);
    const sg = this._gainNode(0);
    sub.connect(sg);
    sg.connect(amb);
    this.kRumG = this._knob(rg.gain, 0, 0.002);
    this.kRumSubG = this._knob(sg.gain, 0, 0.002);

    // Section tonal pad: root (triangle — audible harmonics on small speakers) + interval + air.
    const pa = this._osc('triangle', 65.41);
    const pb = this._osc('sine', 98.1);
    const pc = this._osc('sine', 196.2);
    const pcg = this._gainNode(0.35);
    const plp = this._filter('lowpass', 700, 0);
    const pg = this._gainNode(0);
    const ps = this._gainNode(0.5);
    pa.connect(plp);
    pb.connect(plp);
    pc.connect(pcg);
    pcg.connect(plp);
    plp.connect(pg);
    pg.connect(amb);
    pg.connect(ps);
    ps.connect(this.spaceIn);
    this.kPadA = this._knob(pa.frequency, 65.41, 0.05, 0.002);
    this.kPadB = this._knob(pb.frequency, 98.1, 0.05, 0.002);
    this.kPadC = this._knob(pc.frequency, 196.2, 0.05, 0.002);
    this.kPadG = this._knob(pg.gain, 0, 0.001);
  }

  _buildPlayer() {
    const pl = this.busPlayer;
    const brownB = this._loop(this._brown, 1.07);
    const whiteB = this._loop(this._white, 0.97);
    this._brownB = brownB;
    this._whiteB = whiteB;

    // Rope creak: stick-slip modelled as a low sawtooth pulse train exciting two resonances.
    const co = this._osc('sawtooth', 30);
    const c1 = this._filter('bandpass', 720, 9);
    const c2 = this._filter('bandpass', 1650, 12);
    const c2g = this._gainNode(0.5);
    const cg = this._gainNode(0);
    this.gCreak = this._gate([co, c1], [co, c2]);
    c2.connect(c2g);
    c1.connect(cg);
    c2g.connect(cg);
    cg.connect(pl);
    this.kCreakG = this._knob(cg.gain, 0, 0.003);
    this.kCreakF = this._knob(co.frequency, 30, 0.3, 0.01);
    this.kCreakBP = this._knob(c1.frequency, 720, 4, 0.01);

    // Fragile anchor stress: grinding brown noise, amplitude-modulated by a sawtooth.
    const sbp = this._filter('bandpass', 420, 2.5);
    const sam = this._gainNode(0.5);
    const slfo = this._osc('sawtooth', 14);
    const slg = this._gainNode(0.45);
    const sg = this._gainNode(0);
    this.gStress = this._gate([brownB, sbp], [slfo, slg]);
    sbp.connect(sam);
    slg.connect(sam.gain);
    sam.connect(sg);
    sg.connect(pl);
    this.kStressG = this._knob(sg.gain, 0, 0.003);
    this.kStressLfo = this._knob(slfo.frequency, 14, 0.3, 0.01);
    this.kStressBP = this._knob(sbp.frequency, 420, 4, 0.01);

    // Reel ratchet: square pulse train through a bright resonance.
    const ro = this._osc('square', 24);
    const rbp = this._filter('bandpass', 2600, 5);
    const rg = this._gainNode(0);
    this.gReel = this._gate([ro, rbp]);
    rbp.connect(rg);
    rg.connect(pl);
    this.kReelG = this._knob(rg.gain, 0, 0.003);
    this.kReelF = this._knob(ro.frequency, 24, 0.5, 0.01);

    // Falling wind roar / speed rush.
    const fbp = this._filter('bandpass', 700, 0.7);
    const flp = this._filter('lowpass', 4200, 0);
    const fg = this._gainNode(0);
    this.gFall = this._gate([whiteB, fbp]);
    fbp.connect(flp);
    flp.connect(fg);
    fg.connect(pl);
    this.kFallG = this._knob(fg.gain, 0, 0.003);
    this.kFallF = this._knob(fbp.frequency, 700, 5, 0.01);

    // Breathing: pink noise through a moving band; envelopes scheduled per breath.
    const bbp = this._filter('bandpass', 1200, 0.9);
    const bg = this._gainNode(0);
    this.gBreath = this._gate([this._pinkA, bbp]);
    bbp.connect(bg);
    bg.connect(pl);
    this.breathBP = bbp;
    this.breathGain = bg;
  }

  _buildPsych() {
    const ps = this.busPsych;
    // Heartbeat: a pitched-down sine thump plus a low noise body; envelopes per beat.
    const ho = this._osc('sine', 50);
    const hg = this._gainNode(0);
    hg.connect(ps);
    const hlp = this._filter('lowpass', 220, 0);
    const hng = this._gainNode(0);
    this.gHeart = this._gate([ho, hg], [this._brownB, hlp]);
    hlp.connect(hng);
    hng.connect(ps);
    this.heartOsc = ho;
    this.heartGain = hg;
    this.heartNoiseGain = hng;

    // Dread rumble swelling with threat.
    const rlp = this._filter('lowpass', 80, 0);
    const rg = this._gainNode(0);
    const sub = this._osc('sine', 31);
    const subg = this._gainNode(0.2);
    this.gDread = this._gate([this._brownA, rlp], [sub, subg]);
    subg.connect(rlp);
    rlp.connect(rg);
    rg.connect(ps);
    this.kPsyG = this._knob(rg.gain, 0, 0.002);
  }

  _buildCreature() {
    // Shared spatial chain: in → air low-pass → HRTF panner at the creature (world
    // space, flat 'bed' distance curve) → state gain → bus (+ space send).
    this.crIn = this._gainNode(1);
    const lp = this._filter('lowpass', 1200, 0);
    const pan = this._makeSpatialPanner('bed', 0, -400, 0, true);
    const g = this._gainNode(0);
    const send = this._gainNode(0);
    this.crIn.connect(lp);
    lp.connect(pan);
    pan.connect(g);
    g.connect(this.busCreature);
    g.connect(send);
    send.connect(this.spaceIn);
    this.crPanner = pan;
    this._crPos = { x: NaN, y: NaN, z: NaN, set: false };
    this.kCrLP = this._knob(lp.frequency, 1200, 10, 0.02);
    this.kCrG = this._knob(g.gain, 0, 0.002);
    this.kCrSend = this._knob(send.gain, 0, 0.005);

    // Distant movement: grinding scrape bed (brown noise, AM by an irregular sawtooth).
    const brownC = this._loop(this._brown, 0.83);
    const sbp = this._filter('bandpass', 260, 1.6);
    const sam = this._gainNode(0.5);
    const slfo = this._osc('sawtooth', 4);
    const slg = this._gainNode(0.45);
    const sg = this._gainNode(0);
    this.gScrape = this._gate([brownC, sbp], [slfo, slg]);
    sbp.connect(sam);
    slg.connect(sam.gain);
    sam.connect(sg);
    sg.connect(this.crIn);
    this.kScrG = this._knob(sg.gain, 0, 0.002);
    this.kScrF = this._knob(sbp.frequency, 260, 3, 0.01);
    this.kScrLfo = this._knob(slfo.frequency, 4, 0.1, 0.01);

    // Closer movement: brighter scraping/creaking of plates (same AM so it moves together).
    const cbp = this._filter('bandpass', 1700, 2.2);
    const cam = this._gainNode(0.5);
    const cg = this._gainNode(0);
    this.gClose = this._gate([this._whiteB, cbp]);
    cbp.connect(cam);
    slg.connect(cam.gain);
    cam.connect(cg);
    cg.connect(this.crIn);
    this.kCloseG = this._knob(cg.gain, 0, 0.002);

    // Low resonance: two detuned sawtooths through a low-pass (beats slowly).
    const d1 = this._osc('sawtooth', 40.5);
    const d2 = this._osc('sawtooth', 41.2);
    const dlp = this._filter('lowpass', 190, 4);
    const dg = this._gainNode(0);
    this.gDrone = this._gate([d1, dlp], [d2, dlp]);
    dlp.connect(dg);
    dg.connect(this.crIn);
    this.kDroneG = this._knob(dg.gain, 0, 0.002);
    this.kDroneF1 = this._knob(d1.frequency, 40.5, 0.1, 0.005);
    this.kDroneF2 = this._knob(d2.frequency, 41.2, 0.1, 0.005);

    // "Listening": a faint high chitter while the sensory crown is extended (OBSERVING).
    const lbp = this._filter('bandpass', 3300, 9);
    const lam = this._gainNode(0.5);
    const llfo = this._osc('square', 13);
    const llg = this._gainNode(0.5);
    const lg = this._gainNode(0);
    this.gListen = this._gate([this._whiteA, lbp], [llfo, llg]);
    lbp.connect(lam);
    llg.connect(lam.gain);
    lam.connect(lg);
    lg.connect(this.crIn);
    this.kListenG = this._knob(lg.gain, 0, 0.002);
    this.kListenF = this._knob(llfo.frequency, 13, 0.3, 0.01);
  }

  // -------------------------------------------------------------------------
  // Per-frame update
  // -------------------------------------------------------------------------

  _update(dtIn, game) {
    const ctx = this.ctx;
    if (ctx.state === 'closed') return;
    const dt = U.clamp(num(dtIn, 0), 0, 0.25);
    this._clock += dt;
    const now = ctx.currentTime;
    const state = game && typeof game.state === 'string' ? game.state : 'menu';
    this._state = state;
    this._game = game || null;
    this._hookXR(game);
    const running = this._live();

    // Follow the live settings object (volume slider) without needing an event.
    const vol = U.clamp(num(this.settings && this.settings.volume, this._polledVolume), 0, 1);
    if (vol !== this._polledVolume) {
      this._polledVolume = vol;
      this.setVolume(vol);
    }

    // The listener tracks the head every frame: HRTF needs a fresh orientation.
    this._followListener(game);

    this._ctlAcc += dt;
    if (this._ctlAcc >= CONTROL_DT) {
      const dtc = Math.min(this._ctlAcc, 0.25);
      this._ctlAcc = 0;
      this._control(dtc, now, game, state);
    }

    if (running) {
      this._scheduleHeart(dt, now, game);
      this._scheduleBreath(dt, now);
    }
  }

  /**
   * Listener = the rendering camera's world pose (the head in XR: three.js
   * writes the XR head pose into the user camera when it renders). Falls back
   * to the player's body when no camera is reachable.
   */
  _followListener(game) {
    const R = game && game.renderer ? game.renderer : null;
    const cam = R && R.camera && R.camera.matrixWorld ? R.camera : game && game.camera && game.camera.matrixWorld ? game.camera : null;
    let ok = false;
    if (cam) {
      const m = cam.matrixWorld.elements;
      const x = m[12];
      const y = m[13];
      const z = m[14];
      const fx = -m[8];
      const fy = -m[9];
      const fz = -m[10];
      const ux = m[4];
      const uy = m[5];
      const uz = m[6];
      const fl = Math.hypot(fx, fy, fz);
      const ul = Math.hypot(ux, uy, uz);
      if (x === x && y === y && z === z && fl > 1e-6 && ul > 1e-6 && isFinite(fl + ul)) {
        this._lx = x;
        this._ly = y;
        this._lz = z;
        this._lfx = fx / fl;
        this._lfy = fy / fl;
        this._lfz = fz / fl;
        this._lux = ux / ul;
        this._luy = uy / ul;
        this._luz = uz / ul;
        ok = true;
      }
    }
    if (!ok) {
      const P = game && game.player ? game.player : null;
      if (P) {
        this._lx = num(P.rx, num(P.x, this._lx));
        this._ly = num(P.ry, num(P.y, this._ly));
        this._lz = num(P.rz, num(P.z, this._lz));
      }
    }
    this._applyListener();
  }

  /** Writes the listener pose (only the params that changed). */
  _applyListener() {
    const L = this.ctx && this.ctx.listener;
    if (!L) return;
    const vals = this._lv || (this._lv = new Float64Array(9));
    vals[0] = this._lx;
    vals[1] = this._ly;
    vals[2] = this._lz;
    vals[3] = this._lfx;
    vals[4] = this._lfy;
    vals[5] = this._lfz;
    vals[6] = this._lux;
    vals[7] = this._luy;
    vals[8] = this._luz;
    const last = this._lastL;
    let changed = false;
    for (let i = 0; i < 9; i++) {
      const d = vals[i] - last[i];
      if (!(d > -1e-4 && d < 1e-4)) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    try {
      if (L.positionX) {
        if (!this._listenerSet) {
          this._listenerSet = true;
          const ps = [L.positionX, L.positionY, L.positionZ, L.forwardX, L.forwardY, L.forwardZ, L.upX, L.upY, L.upZ];
          for (let i = 0; i < ps.length; i++) kRate(ps[i]);
          this._lParams = ps;
        }
        const ps = this._lParams;
        for (let i = 0; i < 9; i++) {
          const d = vals[i] - last[i];
          if (!(d > -1e-4 && d < 1e-4)) ps[i].value = vals[i];
        }
      } else {
        if (typeof L.setPosition === 'function') L.setPosition(vals[0], vals[1], vals[2]);
        if (typeof L.setOrientation === 'function') L.setOrientation(vals[3], vals[4], vals[5], vals[6], vals[7], vals[8]);
      }
      for (let i = 0; i < 9; i++) last[i] = vals[i];
    } catch (err) {
      this._warn('listener', err);
    }
  }

  _mixBuses(now, state) {
    const ducked = this._pauseFlag || state === 'paused' || state === 'menu';
    const hushed = now < this._hushUntil;
    const dead = this._dead || state === 'dead';
    const tc = 0.15;
    this.kAmbient.set(hushed ? 0 : BUS_LEVEL.ambient * (ducked ? DUCKED.ambient : 1), now, tc);
    this.kPlayer.set(hushed || ducked ? 0 : BUS_LEVEL.player, now, tc);
    this.kCreature.set(hushed || ducked ? 0 : BUS_LEVEL.creature, now, tc);
    this.kPsych.set(hushed || ducked || dead ? 0 : BUS_LEVEL.psych, now, dead ? 0.08 : tc);
    this.kStinger.set(hushed ? 0 : BUS_LEVEL.stinger * (ducked ? DUCKED.stinger : 1), now, tc);
    this.kUi.set(BUS_LEVEL.ui, now, tc);
    this._mixSpace(now, hushed, 1.5);
  }

  _control(dtc, now, game, state) {
    const P = game && game.player ? game.player : null;
    const T = game && game.tethers ? game.tethers : null;
    const TH = game && game.threat ? game.threat : null;
    const level = game && game.level ? game.level : null;
    const playing = state === 'playing';
    const victory = state === 'victory' || this._victory;
    if (state === 'dead') this._dead = true;
    else if (playing && P && P.alive !== false) this._dead = false;
    const dead = this._dead;
    const c = this._clock;
    const lethal = Math.max(5, num(game && game.diff && game.diff.lethalImpact, 17));

    this._mixBuses(now, state);
    this.kMuffle.set(dead ? 480 : this._nyq, now, dead ? 0.12 : 0.6);

    // ---- section ---------------------------------------------------------
    let si = this._secIndex;
    if (state !== 'menu' && game && typeof game.sectionIndex === 'number') si = game.sectionIndex;
    else if (level && typeof level.sectionIndexAt === 'function') si = level.sectionIndexAt(this._ly);
    si = num(si, 0) | 0;
    if (si !== this._secIndex) {
      const sec = level && level.sections ? level.sections[si] : null;
      this._applySection(si, sec, now, 2.5);
    }
    const sec = this._sec;

    // ---- threat / exertion ------------------------------------------------
    const tv = TH && (playing || dead) ? U.clamp(num(TH.value, 0), 0, 1) : 0;
    this._tv = tv;
    const body = !!P && (playing || state === 'victory') && P.alive !== false;
    const vx = body ? num(P.vx, 0) : 0;
    const vy = body ? num(P.vy, 0) : 0;
    const vz = body ? num(P.vz, 0) : 0;
    const speed = Math.hypot(vx, vy, vz);
    const hspeed = Math.hypot(vx, vz);
    this._exertion = Math.max(0, this._exertion - dtc * 0.06);
    if (body && playing) {
      this._exertion = Math.min(1, this._exertion + dtc * 0.07 * U.smoothstep(250 * SPEED_K, 900 * SPEED_K, speed));
      if (P.grounded && hspeed > 200 * SPEED_K) this._exertion = Math.min(1, this._exertion + dtc * 0.025);
    }

    // ---- ambient bed -----------------------------------------------------
    const speedK = body ? U.smoothstep(200 * SPEED_K, 1400 * SPEED_K, speed) : 0;
    const gustL = 0.55 + 0.45 * U.noise1(c * 0.17, 3);
    const gustR = 0.55 + 0.45 * U.noise1(c * 0.15 + 40, 5);
    const windLvl = sec.windLvl * (1 + 0.8 * speedK) * (1 + 0.25 * tv);
    this.kWindGL.set(windLvl * gustL, now, 0.35);
    this.kWindGR.set(windLvl * gustR, now, 0.35);
    this.kWindFL.set(sec.wind * (0.8 + 0.45 * gustL + 0.6 * speedK), now, 0.4);
    this.kWindFR.set(sec.wind * (0.85 + 0.45 * gustR + 0.6 * speedK), now, 0.4);
    const wh = U.noise1(c * 0.06, 11);
    this.kWhG.set(wh > 0 ? sec.whistle * wh * wh * 1.8 : 0, now, 0.5);
    this.kWhF.set(sec.wFreq * (1 + 0.12 * U.noise1(c * 0.05, 17)), now, 0.6);
    this.kWhPan.set(U.noise1(c * 0.03, 23) * 0.75, now, 0.5);
    const rum = sec.rumble * (0.75 + 0.25 * U.noise1(c * 0.11, 29));
    this.kRumG.set(rum, now, 0.5);
    this.kRumSubG.set(rum * 0.15, now, 0.5); // sub is felt on headphones; keep it small
    const root = sec.root;
    const det = victory ? 0 : 0.25 + tv * 2.2; // dissonant beating grows with threat
    this.kPadA.set(root, now, 2);
    this.kPadB.set(root * (victory ? 1.5 : sec.iv) + det, now, victory ? 3 : 1.2);
    this.kPadC.set(root * (victory ? 3 : 2 * sec.iv) + det * 1.7, now, victory ? 3 : 1.2);
    this.kPadG.set(sec.pad * (victory ? 2.2 : 1 + 0.6 * tv), now, 1.5);

    // ---- player continuous layers (both hands) ------------------------------
    let attached = false;
    let stress = 0;
    let reel = 0;
    const hands = body && T && T.hands ? T.hands : null;
    for (let i = 0; i < 2; i++) {
      const h = i === 0 ? 'left' : 'right';
      const st = hands ? hands[h] : null;
      const rope = st ? st.rope : null;
      const att = !!(rope && rope.anchor);
      if (att) {
        attached = true;
        const len = num(rope.length, 0);
        if (this._prevAtt[h] && dtc > 0) {
          const dl = Math.abs(len - this._prevLen[h]);
          if (dl < 1.5) reel += dl / dtc; // larger jumps are re-attachments, not reeling
        }
        this._prevLen[h] = len;
        if (typeof T.anchorStress === 'function') stress = Math.max(stress, U.clamp(num(T.anchorStress(h), 0), 0, 1));
      }
      this._prevAtt[h] = att;
    }
    const tension = attached ? Math.max(0, num(P.tension, 0)) : 0;
    const tN = U.clamp((tension - 900 * TENSION_K) / (3600 * TENSION_K), 0, 1);
    const motion = U.smoothstep(30 * SPEED_K, 420 * SPEED_K, speed);
    const creak = attached ? (0.22 * U.smoothstep(500 * TENSION_K, 1700 * TENSION_K, tension) + 0.78 * tN) * (0.25 + 0.75 * motion) : 0;
    const slip = U.noise1(c * 3.1, 31);
    this.kCreakG.set(creak * 0.9, now, 0.06);
    this.kCreakF.set(16 + 46 * tN + 6 * slip, now, 0.03);
    this.kCreakBP.set(680 + 260 * tN + 60 * slip, now, 0.1);

    this.kStressG.set(stress > 0.02 ? 0.15 + 0.9 * Math.pow(stress, 1.6) : 0, now, 0.05);
    this.kStressLfo.set(9 + 22 * stress, now, 0.1);
    this.kStressBP.set(300 + 400 * stress, now, 0.1);
    if (stress > 0.4) {
      this._gritT -= dtc;
      if (this._gritT <= 0) {
        this._gritT = rand(0.06, 0.3) * (1.4 - stress);
        this._sfxGrit(stress);
      }
    }

    const reelK = U.clamp(reel / 9.5, 0, 1); // 9.5 m/s = full reel-in speed
    this.kReelG.set(reelK > 0.05 ? 0.3 * (0.4 + 0.6 * reelK) : 0, now, 0.03);
    this.kReelF.set(14 + 34 * reelK, now, 0.05);

    // Falling roar (free fall toward lethal speed) / speed rush, relative to this difficulty's lethal impact.
    const fallK = body && !attached && !P.grounded ? U.smoothstep(0.33 * lethal, 1.26 * lethal, -vy) : 0;
    const airK = body ? U.smoothstep(0.43 * lethal, 1.52 * lethal, speed) * (attached ? 0.4 : 0.75) : 0;
    const roar = Math.max(Math.pow(fallK, 1.3), airK);
    this.kFallG.set(0.36 * roar * (1 + 0.25 * roar * U.noise1(c * 7.3, 37)), now, 0.06);
    this.kFallF.set(450 + 1500 * roar, now, 0.12);

    // Footsteps from distance run on the ground.
    if (body && playing && P.grounded && hspeed > 1) {
      this._stride += hspeed * dtc;
      if (this._stride > STRIDE) {
        this._stride = 0;
        this._sfxFootstep(U.clamp(hspeed / 5.5, 0.3, 1));
      }
    } else {
      this._stride = STRIDE * 0.65; // the first step lands soon after starting to run
    }

    // Breathing parameters (scheduled per breath in _scheduleBreath).
    this._breathOn = body;
    const bi = U.clamp(0.1 + 0.6 * this._exertion + 0.65 * tv, 0, 1);
    this._breathRate = Math.min(58, 13 + 24 * this._exertion + 30 * tv);
    this._breathLevel = 0.04 + 0.17 * Math.pow(bi, 1.3);

    // ---- psychological ------------------------------------------------------
    const psyOn = playing && !dead && !victory;
    this._heartLevel = psyOn ? U.smoothstep(0.2, 0.9, tv) : 0;
    this.kPsyG.set(psyOn ? 0.28 * Math.pow(U.smoothstep(0.12, 1, tv), 1.3) : 0, now, 0.6);

    // ---- creature -------------------------------------------------------------
    this._controlCreature(now, game, state);

    // ---- ambient events ---------------------------------------------------------
    if (now >= this._hushUntil) {
      this._creakT -= dtc;
      if (this._creakT <= 0) {
        this._creakT = (rand(0.5, 1.6) * 60) / Math.max(0.5, sec.creaks * (1 + 0.8 * tv));
        this._sfxCreak();
      }
      this._dripT -= dtc;
      if (this._dripT <= 0) {
        this._dripT = (rand(0.4, 1.7) * 60) / Math.max(0.5, sec.drips);
        this._sfxDrip();
      }
      this._tickT -= dtc;
      if (this._tickT <= 0) {
        this._tickT = rand(4, 14) / (1 + tv);
        this._sfxSettle();
      }
    }

    // Disconnect silent layers' sources (CPU), reconnect when needed.
    const Q = 0.001;
    this._driveGate(this.gCreak, this.kCreakG.last > Q, dtc);
    this._driveGate(this.gStress, this.kStressG.last > Q, dtc);
    this._driveGate(this.gReel, this.kReelG.last > Q, dtc);
    this._driveGate(this.gFall, this.kFallG.last > Q, dtc);
    this._driveGate(this.gBreath, this._breathOn, dtc);
    this._driveGate(this.gHeart, this._heartLevel > 0, dtc);
    this._driveGate(this.gDread, this.kPsyG.last > Q, dtc);
    this._driveGate(this.gScrape, this.kScrG.last > Q && this.kCrG.last > Q, dtc);
    this._driveGate(this.gClose, this.kCloseG.last > Q && this.kCrG.last > Q, dtc);
    this._driveGate(this.gDrone, this.kDroneG.last > Q && this.kCrG.last > Q, dtc);
    this._driveGate(this.gListen, this.kListenG.last > Q && this.kCrG.last > Q, dtc);

    // Housekeeping: free finished voices even when no new sounds are requested.
    this._sweep(now);
  }

  _controlCreature(now, game, state) {
    const CR = game && game.creature ? game.creature : null;
    const ca = CR && CR.active !== false && CR.audio && state !== 'menu' ? CR.audio : null;
    if (!ca) {
      this.kCrG.set(0, now, 0.3);
      this.kScrG.set(0, now, 0.3);
      this.kCloseG.set(0, now, 0.3);
      this.kDroneG.set(0, now, 0.5);
      this.kListenG.set(0, now, 0.3);
      return;
    }
    const c = this._clock;
    const sp = this._spatial(num(ca.x, NaN), num(ca.y, NaN), num(ca.z, NaN), num(ca.distance, NaN));
    const d = sp.d;
    // The panner sits at the creature (or straight above the head when no position is reported).
    const pp = this._crPos;
    const px = sp.ok ? sp.x : this._lx;
    const py = sp.ok ? sp.y : this._ly + d;
    const pz = sp.ok ? sp.z : this._lz;
    if (!pp.set || Math.abs(px - pp.x) + Math.abs(py - pp.y) + Math.abs(pz - pp.z) > 0.01) {
      this._setPannerPos(this.crPanner, px, py, pz, now, pp.set ? 0.05 : 0);
      pp.x = px;
      pp.y = py;
      pp.z = pz;
      pp.set = true;
    }
    const presence = sp.gain;
    const move = U.clamp(num(ca.movement, 0), 0, 1);
    const inten = U.clamp(num(ca.intensity, presence), 0, 1);
    const st = typeof ca.state === 'string' ? ca.state : typeof CR.state === 'string' ? CR.state : '';
    const surge = st === 'BURST' || st === 'ATTACK';
    const stMul = surge ? 1.35 : st === 'RECOVERING' ? 0.7 : st === 'DORMANT' ? 0.35 : 1;

    // The HRTF panner's flat 'bed' curve does the distance attenuation (2D: presence^0.45);
    // fully silent far away (an inactive creature may report a huge distance) so the gates close.
    const farCut = U.smoothstep(CREATURE_FAR[1], CREATURE_FAR[0], d);
    this.kCrG.set(farCut > 0.001 ? farCut : 0, now, 0.15);
    this.kCrLP.set(280 + 11500 * Math.exp(-d / AIR_D), now, 0.15);
    this.kCrSend.set(0.15 + 0.5 * (1 - presence), now, 0.3);
    this.kScrG.set(0.9 * move * stMul, now, 0.12);
    this.kScrF.set((210 + 300 * move) * (st === 'BURST' ? 1.5 : 1), now, 0.15);
    this.kScrLfo.set(2.2 + 7 * move + 2 * U.noise1(c * 0.9, 41), now, 0.1);
    this.kCloseG.set(0.26 * move * U.smoothstep(47, 8, d) * stMul, now, 0.1);
    this.kDroneG.set(0.22 * U.smoothstep(115, 11, d) * (0.5 + 0.5 * inten) * stMul, now, 0.4);
    this.kDroneF1.set(surge ? 46 : 40.5, now, 0.5);
    this.kDroneF2.set(surge ? 47.1 : 41.2, now, 0.5);
    this.kListenG.set(st === 'OBSERVING' ? 0.14 * U.smoothstep(130, 12, d) : 0, now, 0.25);
    this.kListenF.set(11 + 5 * U.noise1(c * 0.7, 43), now, 0.1);
  }

  _applySection(index, section, now, tc) {
    const i = U.clamp(num(index, 0) | 0, 0, SECTION_SOUND.length - 1);
    this._secIndex = num(index, 0) | 0;
    this._sec = SECTION_SOUND[i];
    const s = this._sec;
    const theme = section && section.theme ? section.theme : null;
    const dark = theme ? U.clamp(num(theme.darkness, 0), 0, 1) : 0;
    this._spaceFb = Math.min(0.75, s.fb + 0.05 * dark);
    this._spaceLevel = s.space * (1 + 0.15 * dark);
    for (let k = 0; k < 3; k++) this.kSpaceDelay[k].set(SPACE_DELAYS[k] * s.size, now, tc * 1.5);
    this._mixSpace(now, false, tc);
  }

  /** Room feedback + wet level. While hushed the loop is opened so no old tail survives stopAll(). */
  _mixSpace(now, hushed, tc) {
    const fb = hushed ? 0 : this._spaceFb;
    const t = hushed ? 0.015 : tc;
    for (let k = 0; k < 3; k++) {
      this.kSpaceSelf[k].set(fb * 0.45, now, t);
      this.kSpaceNext[k].set(fb * 0.55, now, t);
    }
    this.kSpaceOut.set(hushed ? 0 : this._spaceLevel, now, t);
  }

  // -------------------------------------------------------------------------
  // Heartbeat & breathing (scheduled on persistent nodes)
  // -------------------------------------------------------------------------

  _scheduleHeart(dt, now, game) {
    const lvl = this._heartLevel;
    const TH = game && game.threat ? game.threat : null;
    const rate = U.clamp(num(TH && TH.heartRate, 60 + 100 * this._tv), 40, 190);
    const period = 60 / rate;
    let fire = false;
    const beat = TH ? num(TH.beat, NaN) : NaN;
    this._beatClock += dt;
    if (beat === beat) {
      if (beat < this._prevBeat - 0.5) fire = true; // phase wrapped → new beat
      this._prevBeat = beat;
      if (this._beatClock > period * 1.6) fire = true; // threat phase stalled: keep our own time
    } else if (this._beatClock >= period) {
      fire = true;
    }
    if (!fire) return;
    this._beatClock = 0;
    if (lvl < 0.01 || now - this._lastBeatAt < 0.22) return;
    const t = now + 0.02;
    this._lastBeatAt = t;
    const gap = U.clamp(period * 0.32, 0.16, 0.3);
    const g = this.heartGain.gain;
    const gn = this.heartNoiseGain.gain;
    const f = this.heartOsc.frequency;
    try {
      g.cancelScheduledValues(t);
      gn.cancelScheduledValues(t);
      f.cancelScheduledValues(t);
      const peak = 0.34 * lvl;
      // lub
      f.setValueAtTime(64, t);
      f.setTargetAtTime(44, t, 0.05);
      g.setTargetAtTime(peak, t, 0.006);
      g.setTargetAtTime(0, t + 0.04, 0.05);
      gn.setTargetAtTime(peak, t, 0.008);
      gn.setTargetAtTime(0, t + 0.035, 0.04);
      // dub (softer, a touch higher)
      const t2 = t + gap;
      f.setValueAtTime(70, t2);
      f.setTargetAtTime(50, t2, 0.04);
      g.setTargetAtTime(peak * 0.62, t2, 0.006);
      g.setTargetAtTime(0, t2 + 0.03, 0.045);
      gn.setTargetAtTime(peak * 0.6, t2, 0.008);
      gn.setTargetAtTime(0, t2 + 0.03, 0.035);
    } catch (err) {
      this._warn('heart', err);
    }
  }

  _scheduleBreath(dt, now) {
    if (!this._breathOn || this._dead) return;
    this._breathT -= dt;
    if (this._breathT > 0) return;
    const ragged = this._tv > 0.5 ? 0.18 : 0.08;
    const period = (60 / this._breathRate) * (1 + rand(-ragged, ragged));
    this._breathT = period;
    const lvl = this._breathLevel * rand(0.85, 1.1);
    const t = now + 0.02;
    const inDur = period * 0.36;
    const gap = period * 0.06;
    const exDur = period * 0.46;
    const g = this.breathGain.gain;
    const f = this.breathBP.frequency;
    try {
      g.cancelScheduledValues(t);
      f.cancelScheduledValues(t);
      // inhale: thinner, higher band
      f.setTargetAtTime(1500 + 500 * this._tv, t, 0.05);
      g.setTargetAtTime(lvl * 0.7, t, inDur * 0.3);
      g.setTargetAtTime(0, t + inDur * 0.7, inDur * 0.16);
      // exhale: fuller, falling band
      const te = t + inDur + gap;
      f.setTargetAtTime(1000, te - 0.03, 0.03);
      f.setTargetAtTime(650, te, exDur * 0.5);
      g.setTargetAtTime(lvl, te, exDur * 0.18);
      g.setTargetAtTime(0, te + exDur * 0.45, exDur * 0.22);
    } catch (err) {
      this._warn('breath', err);
    }
  }

  _silenceEnvelopes(now) {
    const params = [this.heartGain.gain, this.heartNoiseGain.gain, this.breathGain.gain];
    for (let i = 0; i < params.length; i++) {
      try {
        params[i].cancelScheduledValues(now);
        params[i].setTargetAtTime(0, now, 0.03);
      } catch {
        // ignore
      }
    }
  }

  // -------------------------------------------------------------------------
  // Spatialisation
  // -------------------------------------------------------------------------

  /**
   * Distance / loudness / air low-pass / space send for a world point relative
   * to the listener (scratch result; `ok` false when the point is not finite,
   * then `dHint` or 80 m is used as the distance).
   */
  _spatial(x, y, z, dHint) {
    const S = this._sp;
    const ok = x === x && y === y && z === z && isFinite(x + y + z);
    let d;
    if (ok) {
      d = Math.hypot(x - this._lx, y - this._ly, z - this._lz);
      S.x = x;
      S.y = y;
      S.z = z;
    } else {
      const hint = num(dHint, NaN);
      d = hint === hint ? Math.max(0, hint) : 80;
    }
    S.ok = ok;
    S.d = d;
    S.gain = 1 / (1 + Math.pow(d / PRESENCE_D, 1.5)); // the 2D presence curve (in metres)
    S.cutoff = 260 + 12000 * Math.exp(-d / AIR_D);
    S.send = 0.12 + 0.55 * (1 - Math.exp(-d / SEND_D));
    return S;
  }

  /** Level multiplier that keeps a spatial one-shot at least `floor` loud after the panner's attenuation. */
  _floor(preset, d, floor) {
    const g = this._pannerGain(preset, d);
    return g > 0 && floor > g ? floor / g : 1;
  }

  /** A random point in the space around the listener (ambient decoration) → this._pos. */
  _around(minD, maxD, ySpread) {
    const a = Math.random() * Math.PI * 2;
    const r = rand(minD, maxD);
    const q = this._pos;
    q.x = this._lx + Math.cos(a) * r;
    q.z = this._lz + Math.sin(a) * r;
    q.y = this._ly + rand(-ySpread, ySpread);
    return q;
  }

  /** Point helper → this._pos (null when not finite). */
  _at(x, y, z) {
    if (!(x === x && y === y && z === z) || !isFinite(x + y + z)) return null;
    const q = this._pos;
    q.x = x;
    q.y = y;
    q.z = z;
    return q;
  }

  // -------------------------------------------------------------------------
  // One-shot voice management
  // -------------------------------------------------------------------------

  /**
   * Allocates a one-shot voice: out(level) → [lowpass] → [world panner | stereo pan] → bus (+ space send).
   * `pos` ({x,y,z} world metres) places the voice in the world with a PannerNode
   * (HRTF while fewer than MAX_HRTF are busy — HRTF_AMBIENT for `ambient`
   * decoration — else equal-power) using the PANNER `preset`; without `pos`
   * the voice is head-locked and `pan` (−1..1) applies.
   * Returns null when audio is not running, the sound is rate limited, or the
   * cap is reached and nothing of lower/equal priority can be stolen.
   */
  _begin(name, prio, minGap, dur, bus, level, pan, send, cutoff, pos, preset, ambient) {
    if (!this._live()) return null;
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const last = this._lastPlay[name];
    if (minGap > 0 && last !== undefined && now - last < minGap && now >= last) return null;
    this._sweep(now);
    const v = this._alloc(prio, now);
    if (!v) return null;
    this._lastPlay[name] = now;
    v.alive = true;
    v.dying = false;
    v.name = name;
    v.priority = prio;
    v.t0 = now + LOOKAHEAD;
    v.end = now + LOOKAHEAD + dur;
    const out = ctx.createGain();
    out.gain.value = U.clamp(num(level, 0), 0, 4);
    v.nodes.push(out);
    v.out = out;
    let tail = out;
    if (cutoff > 0) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = U.clamp(cutoff, 60, this._nyq);
      lp.Q.value = 0;
      kRate(lp.frequency);
      kRate(lp.Q);
      tail.connect(lp);
      v.nodes.push(lp);
      tail = lp;
    }
    v.panner = null;
    if (pos) {
      const hrtf = this._hrtfCount < (ambient ? HRTF_AMBIENT : MAX_HRTF);
      const p = this._makeSpatialPanner(preset || 'near', pos.x, pos.y, pos.z, hrtf);
      if (hrtf) {
        v.hrtf = true;
        this._hrtfCount++;
        if (this._hrtfCount > this._peakHrtf) this._peakHrtf = this._hrtfCount;
      }
      tail.connect(p);
      v.nodes.push(p);
      v.panner = p;
      tail = p;
    } else {
      const pn = num(pan, 0);
      if (pn > 0.02 || pn < -0.02) {
        const p = this._makePanner(pn);
        tail.connect(p);
        v.nodes.push(p);
        tail = p;
      }
    }
    tail.connect(bus);
    if (send > 0.005) {
      const s = ctx.createGain();
      s.gain.value = Math.min(1, send);
      tail.connect(s);
      s.connect(this.spaceIn);
      v.nodes.push(s);
    }
    const n = this.activeVoices;
    if (n > this._peakVoices) this._peakVoices = n;
    return v;
  }

  _alloc(prio, now) {
    let free = null;
    let active = 0;
    let victim = null;
    const list = this._voices;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (!v.alive) {
        if (!free) free = v;
        continue;
      }
      if (v.dying) continue;
      active++;
      if (!victim || v.priority < victim.priority || (v.priority === victim.priority && v.t0 < victim.t0)) victim = v;
    }
    if (active >= MAX_VOICES) {
      if (!victim || victim.priority > prio) return null;
      this._kill(victim, now, 0.012);
    }
    return free; // null if every record is busy (cap + fading headroom exhausted)
  }

  _countAlive(name) {
    let n = 0;
    for (let i = 0; i < this._voices.length; i++) {
      const v = this._voices[i];
      if (v.alive && !v.dying && v.name === name) n++;
    }
    return n;
  }

  /** Schedules every source of the voice to stop at v.end (sources are started when created). */
  _commit(v) {
    for (let i = 0; i < v.sources.length; i++) {
      try {
        v.sources[i].stop(v.end);
      } catch {
        // ignore
      }
    }
  }

  _kill(v, now, fade) {
    if (!v.alive || v.dying) return;
    v.dying = true;
    try {
      v.out.gain.cancelScheduledValues(now);
      v.out.gain.setTargetAtTime(0, now, fade);
    } catch {
      // ignore
    }
    const stopAt = now + fade * 7;
    for (let i = 0; i < v.sources.length; i++) {
      try {
        v.sources[i].stop(stopAt);
      } catch {
        // already stopping earlier — fine
      }
    }
    v.end = Math.min(v.end, stopAt + 0.02);
  }

  /** Fades out every one-shot; `keepUi` spares UI clicks (the button that caused a start/menu). */
  _killAll(now, fade, keepUi) {
    for (let i = 0; i < this._voices.length; i++) {
      const v = this._voices[i];
      if (keepUi && v.name === 'click') continue;
      this._kill(v, now, fade);
    }
  }

  _sweep(now) {
    const list = this._voices;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      if (v.alive && now >= v.end) this._release(v);
    }
  }

  _release(v) {
    for (let i = 0; i < v.nodes.length; i++) {
      try {
        v.nodes[i].disconnect();
      } catch {
        // ignore
      }
    }
    v.nodes.length = 0;
    v.sources.length = 0;
    v.out = null;
    v.panner = null;
    if (v.hrtf) {
      v.hrtf = false;
      this._hrtfCount = Math.max(0, this._hrtfCount - 1);
    }
    v.alive = false;
    v.dying = false;
    v.name = '';
  }

  // ---- node factories for voices ----------------------------------------------

  _vOsc(v, type, freq, t) {
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.value = Math.min(freq, this._nyq);
    o.frequency.setValueAtTime(Math.min(freq, this._nyq), t);
    o.start(t);
    v.nodes.push(o);
    v.sources.push(o);
    return o;
  }

  _vNoise(v, buf, t, rate) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    if (rate && rate !== 1) s.playbackRate.value = rate;
    s.start(t, Math.random() * (buf.duration - 0.05));
    v.nodes.push(s);
    v.sources.push(s);
    return s;
  }

  _vFilter(v, type, freq, q) {
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = U.clamp(freq, 20, this._nyq);
    f.Q.value = q;
    kRate(f.frequency);
    kRate(f.Q);
    v.nodes.push(f);
    return f;
  }

  _vGain(v, value) {
    const g = this.ctx.createGain();
    g.gain.value = value || 0;
    v.nodes.push(g);
    return g;
  }

  /** Percussive envelope: 0 → peak over `atk`, then exponential decay (time-constant tc). */
  _perc(param, t, peak, atk, tc) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + atk);
    param.setTargetAtTime(0, t + atk, tc);
  }

  /** Swell: 0 → peak over `atk`, hold, then exponential release. */
  _swell(param, t, peak, atk, hold, tc) {
    param.setValueAtTime(0, t);
    param.linearRampToValueAtTime(peak, t + atk);
    param.setTargetAtTime(0, t + atk + hold, tc);
  }

  /** A single fast click on an already-scheduled gain (events must be added in time order). */
  _tick(param, t, peak, tc) {
    param.setTargetAtTime(peak, t, 0.0007);
    param.setTargetAtTime(0, t + 0.003, tc);
  }

  /** Noise → band-pass → gain with a train of `count` ticks spread over `span` seconds. */
  _tickTrain(v, t, count, span, peak, fLo, fHi, q, tc, falloff) {
    const n = this._vNoise(v, this._white, t, 1);
    const bp = this._vFilter(v, 'bandpass', fHi, q);
    const g = this._vGain(v, 0);
    n.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    let tt = t;
    const step = span / Math.max(1, count);
    for (let i = 0; i < count; i++) {
      const k = count > 1 ? i / (count - 1) : 0;
      bp.frequency.setValueAtTime(U.clamp(rand(fLo, fHi) * (1 - falloff * 0.5 * k), 60, this._nyq), tt);
      this._tick(g.gain, tt, peak * (1 - falloff * k) * rand(0.6, 1), tc);
      tt += step * rand(0.4, 1.6);
    }
    return tt;
  }

  // -------------------------------------------------------------------------
  // Event wiring
  // -------------------------------------------------------------------------

  _subscribe() {
    const bus = this.bus;
    if (!bus || typeof bus.on !== 'function') return;
    const map = {
      'grapple:fire': this._onFire,
      'grapple:attach': this._onAttach,
      'grapple:miss': this._onMiss,
      'grapple:release': this._onRelease,
      'grapple:break': this._onBreak,
      'rope:jolt': this._onJolt,
      'platform:crumble': this._onCrumble,
      'player:jump': this._onJump,
      'player:land': this._onLand,
      'player:wallhit': this._onWallHit,
      'player:death': this._onDeath,
      'section:enter': this._onSection,
      checkpoint: this._onCheckpoint,
      'trigger:rumble': this._onRumble,
      'trigger:debris': this._onDebris,
      'trigger:call': this._onTriggerCall,
      'creature:step': this._onCreatureStep,
      'creature:call': this._onCreatureCall,
      'creature:burst': this._onCreatureBurst,
      'creature:attack': this._onCreatureAttack,
      'creature:strike': this._onCreatureStrike,
      'creature:retreat': this._onCreatureRetreat,
      'creature:sighting': this._onCreatureSighting,
      'game:start': this._onGameStart,
      'game:restart': this._onGameStart,
      'game:pause': this._onGamePause,
      'game:resume': this._onGameResume,
      'game:menu': this._onGameMenu,
      'game:respawn': this._onGameRespawn,
      'game:victory': this._onGameVictory,
      'ui:click': this._onUiClick,
      'settings:changed': this._onSettings,
      'xr:start': this._onXRStart,
      'xr:sessionstart': this._onXRStart,
    };
    for (const type of Object.keys(map)) {
      const fn = map[type];
      bus.on(type, (payload) => {
        if (!this._built) {
          // Lifecycle flags still matter before the context exists.
          if (type === 'xr:start' || type === 'xr:sessionstart') this.unlock();
          else if (type === 'game:pause' || type === 'game:menu') this._pauseFlag = true;
          else if (type === 'game:resume' || type === 'game:start' || type === 'game:restart') this._pauseFlag = false;
          else if (type === 'settings:changed' && payload && payload.settings && typeof payload.settings === 'object') {
            this.settings = payload.settings;
            this._volume = this._polledVolume = U.clamp(num(this.settings.volume, this._volume), 0, 1);
          }
          return;
        }
        try {
          fn.call(this, payload && typeof payload === 'object' ? payload : EMPTY);
        } catch (err) {
          this._warn(type, err);
        }
      });
    }
  }

  // ---- lifecycle -----------------------------------------------------------------

  _onGameStart() {
    const now = this.ctx.currentTime;
    this._pauseFlag = false;
    this._dead = false;
    this._victory = false;
    this._hushUntil = 0;
    this._killAll(now, 0.05, true);
    this.kMuffle.force(this._nyq, now, 0.05);
    this._exertion = 0.1;
    this._breathT = 0.8;
    this._beatClock = 0;
    this._prevAtt.left = this._prevAtt.right = false;
    this._state = 'playing';
    this._mixBuses(now, 'playing');
  }

  _onGamePause() {
    this._pauseFlag = true;
    this._mixBuses(this.ctx.currentTime, 'paused');
  }

  _onGameResume() {
    this._pauseFlag = false;
    this._hushUntil = 0;
    this._mixBuses(this.ctx.currentTime, 'playing');
  }

  _onGameMenu() {
    const now = this.ctx.currentTime;
    this._pauseFlag = true;
    this._dead = false;
    this._victory = false;
    this._killAll(now, 0.08, true);
    this.kMuffle.force(this._nyq, now, 0.3);
    this._silenceEnvelopes(now);
    this._mixBuses(now, 'menu');
  }

  _onGameRespawn() {
    const now = this.ctx.currentTime;
    this._dead = false;
    this._pauseFlag = false;
    this._hushUntil = 0;
    this.kMuffle.force(this._nyq, now, 0.45);
    this._exertion = Math.max(this._exertion, 0.4); // shaken: heavier breathing for a while
    this._breathT = 0.4;
    this._prevAtt.left = this._prevAtt.right = false;
    this._sfxRespawn();
  }

  _onGameVictory() {
    this._victory = true;
    this._sfxVictory();
  }

  _onSettings(p) {
    if (p.settings && typeof p.settings === 'object') this.settings = p.settings;
    this._polledVolume = U.clamp(num(this.settings.volume, this._volume), 0, 1);
    this.setVolume(this._polledVolume);
  }

  _onUiClick() {
    this._sfxClick();
  }

  _onXRStart() {
    this.unlock();
  }

  _onSection(p) {
    const idx = num(p.index, this._secIndex);
    const now = this.ctx.currentTime;
    if ((idx | 0) !== this._secIndex) this._applySection(idx, p.section || null, now, 2.5);
    if (p.first) this._sfxSectionShift();
  }

  _onCheckpoint() {
    this._sfxCheckpoint();
  }

  // ---- player (payloads carry z and hand; speeds in m/s, distances in metres) ----------

  _onFire(p) {
    this._sfxFire(p);
  }

  _onAttach(p) {
    const heavy = U.smoothstep(380 * SPEED_K, 1250 * SPEED_K, num(p.speed, 0));
    this._exertion = Math.min(1, this._exertion + 0.03 + 0.08 * heavy);
    const now = this.ctx.currentTime;
    // Attachment is immediate in 3D (no separate fire event): the zip leaves the hand,
    // the hook bites the anchor out in the world after the line's travel time.
    if (now - this._lastFireAt > 0.08) this._sfxFire(p);
    const delay = U.clamp(num(p.distance, 10) / FIRE_SPEED, 0.012, 0.15);
    this._sfxCatch(p, heavy, delay);
    this._sfxAttach(p, heavy, delay);
    if (p.previous || p.chained) this._sfxRelease(0.6, p.hand);
  }

  _onMiss(p) {
    this._sfxMiss(p);
  }

  _onRelease(p) {
    if (p.reason === 'break' || p.reason === 'death' || p.reason === 'reset') return;
    this._sfxRelease(U.clamp(0.5 + num(p.speed, 0) / (1600 * SPEED_K), 0.5, 1), p.hand);
  }

  _onBreak(p) {
    this._exertion = Math.min(1, this._exertion + 0.15);
    this._sfxBreak(p, 1);
  }

  _onCrumble(p) {
    this._sfxBreak(p, 1.6);
  }

  _onJolt(p) {
    this._exertion = Math.min(1, this._exertion + 0.12);
    this._sfxJolt(p);
  }

  _onJump() {
    this._exertion = Math.min(1, this._exertion + 0.05);
    this._sfxJump();
  }

  _onLand(p) {
    if (p.hard) this._exertion = Math.min(1, this._exertion + 0.25);
    // Loudness from how close the landing came to lethal (payload lethalRatio), else from the impact speed.
    let ratio = num(p.lethalRatio, NaN);
    if (!(ratio === ratio)) {
      const lethal = Math.max(5, num(this._game && this._game.diff && this._game.diff.lethalImpact, 17));
      ratio = num(p.impact, 0) / lethal;
    }
    this._sfxLand(ratio, !!p.hard);
  }

  _onWallHit(p) {
    this._exertion = Math.min(1, this._exertion + 0.06);
    this._sfxWall(p);
  }

  _onDeath(p) {
    const now = this.ctx.currentTime;
    this._dead = true;
    this.kMuffle.force(480, now, 0.12);
    this._silenceEnvelopes(now);
    this._sfxDeath(p.cause);
  }

  // ---- triggers / creature ------------------------------------------------------------

  _onRumble() {
    this._sfxRumble();
  }

  _onDebris(p) {
    const data = p.data && typeof p.data === 'object' ? p.data : EMPTY;
    let pos = this._at(num(data.x, NaN), num(data.y, NaN), num(data.z, NaN));
    if (!pos) pos = this._at(num(p.x, NaN), num(data.y, num(p.y, NaN)), num(p.z, NaN));
    if (!pos) {
      // Somewhere above, raining past.
      pos = this._around(3, 9, 0);
      pos.y = this._ly + rand(6, 14);
    }
    this._sfxDebris(pos);
  }

  _onTriggerCall(p) {
    // Once the creature is hunting, Creature3D answers the trigger itself with a
    // creature:call from its REAL position: a made-up point far above would send
    // the ear the wrong way (and rate-limit the true call into silence).
    const cr = this._game && this._game.creature;
    if (cr && cr.active !== false && cr.inPlay) return;
    const data = p.data && typeof p.data === 'object' ? p.data : EMPTY;
    let x = num(data.x, NaN);
    let y = num(data.y, NaN);
    let z = num(data.z, NaN);
    if (!(x === x) || !(y === y) || !(z === z)) {
      // Far above, off to one side (2D: 1400–2200 px up, 300–700 px aside).
      const a = Math.random() * Math.PI * 2;
      const r = rand(15, 35);
      x = this._lx + Math.cos(a) * r;
      z = this._lz + Math.sin(a) * r;
      y = this._ly + rand(70, 110);
    }
    this._sfxCall(x, y, z, U.clamp(num(data.intensity, 0.8), 0.2, 1), true, NaN);
  }

  _onCreatureStep(p) {
    this._sfxCreatureStep(p);
  }

  _onCreatureCall(p) {
    this._sfxCall(num(p.x, NaN), num(p.y, NaN), num(p.z, NaN), U.clamp(num(p.intensity, 0.7), 0.1, 1), false, num(p.distance, NaN));
  }

  /**
   * A surge. Bursts that start because it HEARD you or lost patience ('heard' /
   * 'stall') open with the crown snapping toward you (creature3d holds 0.15–0.45 s
   * before surging): a distinct crown-snap / click-rattle at its position, then
   * the surge once the hold is over. `commit` (a real lunge) pushes harder.
   */
  _onCreatureBurst(p) {
    const x = num(p.x, NaN);
    const y = num(p.y, NaN);
    const z = num(p.z, NaN);
    const d = num(p.distance, NaN);
    let hold = 0;
    if (p.reason === 'heard' || p.reason === 'stall') {
      const cr = this._game && this._game.creature;
      hold = U.clamp(num(p.snap, num(cr && cr.k && cr.k.snap, 0.3)), 0.1, 0.6);
      this._sfxCrownSnap(x, y, z, d, hold, p.reason === 'stall');
    }
    this._sfxBurst(x, y, z, d, hold, !!p.commit);
  }

  _onCreatureAttack(p) {
    // A lunge is emitted at wind-up start. The 3D creature reports the contact itself
    // (creature:strike, with the true strike point and hit / near miss): then the
    // impact belongs to the strike. Without strike events (or before the first one
    // from a creature that does not tag `cause`) the impact is scheduled at the end
    // of the wind-up, as in the 2D game. A gate slam (victory) is the impact itself.
    const strikeFollows = !p.gate && (this._strikeSeen || typeof p.cause === 'string');
    let w = 0.03;
    if (!p.gate) {
      w = num(p.windup, NaN);
      if (!(w === w)) {
        const cr = this._game && this._game.creature;
        w = cr && cr.attack ? num(cr.attack.windup, 0.5) : 0.5;
      }
    }
    this._sfxAttack(num(p.x, NaN), num(p.y, NaN), num(p.z, NaN), U.clamp(w, 0.03, 0.9), !!p.gate, !strikeFollows);
  }

  /**
   * The lunge lands. Always a heavy impact at the strike point; a miss
   * (hit false) adds the crown scraping off the masonry and the air tearing
   * past the head — the near miss you are meant to survive.
   */
  _onCreatureStrike(p) {
    this._strikeSeen = true;
    const x = num(p.x, NaN);
    const y = num(p.y, NaN);
    const z = num(p.z, NaN);
    const d = num(p.distance, NaN);
    this._sfxStrike(x, y, z, d, !!p.hit);
    if (!p.hit) this._sfxNearMiss(x, y, z, d);
  }

  _onCreatureRetreat(p) {
    this._sfxRetreat(num(p.x, NaN), num(p.y, NaN), num(p.z, NaN));
  }

  _onCreatureSighting(p) {
    this._sfxSighting(num(p.x, NaN), num(p.y, NaN), num(p.z, NaN));
  }

  // -------------------------------------------------------------------------
  // Synthesis recipes — player
  // -------------------------------------------------------------------------

  /** Tether fire: a fast whip-zip (rising band of noise + a short chirp). */
  _sfxFire(p) {
    const v = this._begin('fire', 1, 0.035, 0.24, this.busPlayer, 1.6, HAND_PAN[p.hand] || 0, 0.05, 0);
    if (!v) return;
    this._lastFireAt = v.t0;
    const t = v.t0;
    const n = this._vNoise(v, this._white, t, 1);
    const bp = this._vFilter(v, 'bandpass', 900, 2.2);
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(Math.min(4600, this._nyq), t + 0.085);
    const g = this._vGain(v, 0);
    this._perc(g.gain, t, 1.0, 0.004, 0.035);
    n.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    const o = this._vOsc(v, 'triangle', 1300, t);
    o.frequency.exponentialRampToValueAtTime(3400, t + 0.07);
    const og = this._vGain(v, 0);
    this._perc(og.gain, t, 0.12, 0.003, 0.03);
    o.connect(og);
    og.connect(v.out);
    this._commit(v);
  }

  /**
   * Attach: struck-iron clank with inharmonic partials, placed AT THE ANCHOR in
   * the world (HRTF); heavier and longer at speed. Kept at least ~0.6 of its
   * close level however far the anchor is — it is the "you are caught" cue.
   */
  _sfxAttach(p, heavy, delay) {
    const an = p.anchor || EMPTY;
    const kind = an.kind;
    const decayK = 1 + heavy * 0.9;
    const dur = delay + 0.04 + PARTIAL_TC[0] * decayK * 7;
    const pos = this._at(num(p.x, num(an.x, NaN)), num(p.y, num(an.y, NaN)), num(p.z, num(an.z, NaN)));
    const sp = pos ? this._spatial(pos.x, pos.y, pos.z, NaN) : null;
    const lift = sp ? this._floor('near', sp.d, 0.6) : 1;
    const v = this._begin('attach', 1, 0.03, dur, this.busPlayer, (0.52 + 0.3 * heavy) * lift, HAND_PAN[p.hand] || 0, 0.1 + 0.12 * heavy, 0, pos, 'near');
    if (!v) return;
    const t = v.t0 + delay;
    const base = (kind === 'hook' ? 340 : kind === 'fragile' ? 560 : 455) * (1 - 0.22 * heavy) * rand(0.95, 1.05);
    for (let i = 0; i < PARTIALS.length; i++) {
      const o = this._vOsc(v, 'sine', base * PARTIALS[i] * rand(0.995, 1.005), t);
      const g = this._vGain(v, 0);
      this._perc(g.gain, t, PARTIAL_AMP[i], 0.0015, PARTIAL_TC[i] * decayK);
      o.connect(g);
      g.connect(v.out);
    }
    // Transient "tick" of the hook biting.
    const n = this._vNoise(v, this._white, t, 1);
    const hp = this._vFilter(v, 'highpass', 2600, 0);
    const ng = this._vGain(v, 0);
    this._perc(ng.gain, t, 0.3, 0.001, 0.012);
    n.connect(hp);
    hp.connect(ng);
    ng.connect(v.out);
    if (kind === 'fragile') {
      // Crumbly grit: the anchor is not sound.
      const b = this._vNoise(v, this._brown, t, 1.3);
      const bp = this._vFilter(v, 'bandpass', 760, 1.4);
      const bg = this._vGain(v, 0);
      this._perc(bg.gain, t, 0.45, 0.004, 0.09);
      b.connect(bp);
      bp.connect(bg);
      bg.connect(v.out);
    }
    this._commit(v);
  }

  /** Catch: the weight of the body arriving on the line — a low thunk in the hand (head-locked). */
  _sfxCatch(p, heavy, delay) {
    if (heavy <= 0.05) return;
    const v = this._begin('catch', 1, 0.05, delay + 0.6, this.busPlayer, 1, HAND_PAN[p.hand] || 0, 0.06, 0);
    if (!v) return;
    const t = v.t0 + delay;
    const lo = this._vOsc(v, 'sine', 105, t);
    lo.frequency.setTargetAtTime(55, t, 0.05);
    const lg = this._vGain(v, 0);
    this._perc(lg.gain, t, 0.5 * heavy, 0.003, 0.07);
    lo.connect(lg);
    lg.connect(v.out);
    this._commit(v);
  }

  /** Miss: a whiff of the tether through air, then the slack line rattling back. */
  _sfxMiss(p) {
    const v = this._begin('miss', 1, 0.08, 0.6, this.busPlayer, 1.4, HAND_PAN[p.hand] || 0, 0.08, 0);
    if (!v) return;
    const t = v.t0;
    const n = this._vNoise(v, this._white, t, 1);
    const bp = this._vFilter(v, 'bandpass', 2600, 1.2);
    bp.frequency.setValueAtTime(2600, t);
    bp.frequency.exponentialRampToValueAtTime(500, t + 0.22);
    const g = this._vGain(v, 0);
    this._swell(g.gain, t, 0.3, 0.02, 0.05, 0.05);
    n.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    this._tickTrain(v, t + 0.13, 5, 0.2, 0.35, 2400, 4200, 6, 0.008, 0.6);
    this._commit(v);
  }

  /** Release: a soft snap of the line going slack. */
  _sfxRelease(strength, hand) {
    const v = this._begin('release', 1, 0.05, 0.25, this.busPlayer, 1.0 * strength, (HAND_PAN[hand] || 0) * 0.8, 0.04, 0);
    if (!v) return;
    const t = v.t0;
    const n = this._vNoise(v, this._white, t, 1);
    const bp = this._vFilter(v, 'bandpass', 1700, 1.5);
    const g = this._vGain(v, 0);
    this._perc(g.gain, t, 0.45, 0.002, 0.025);
    n.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    const o = this._vOsc(v, 'sine', 150, t);
    o.frequency.setTargetAtTime(90, t, 0.03);
    const og = this._vGain(v, 0);
    this._perc(og.gain, t, 0.3, 0.003, 0.035);
    o.connect(og);
    og.connect(v.out);
    this._commit(v);
  }

  /** Rope jolt: the line straining hard (creak burst + thwack + thump). */
  _sfxJolt(p) {
    const s = U.smoothstep(12, 26, num(p.speed, 14)); // radial speed removed (m/s); 12 = CONFIG.rope.joltFxSpeed
    const v = this._begin('jolt', 2, 0.12, 0.6, this.busPlayer, 0.45 + 0.35 * s, 0, 0.1, 0);
    if (!v) return;
    const t = v.t0;
    const o = this._vOsc(v, 'sawtooth', 52, t);
    o.frequency.setTargetAtTime(30, t, 0.12);
    const b1 = this._vFilter(v, 'bandpass', 640, 9);
    const b2 = this._vFilter(v, 'bandpass', 1500, 12);
    const cg = this._vGain(v, 0);
    this._swell(cg.gain, t, 1.2, 0.012, 0.06, 0.08);
    o.connect(b1);
    o.connect(b2);
    b1.connect(cg);
    b2.connect(cg);
    cg.connect(v.out);
    const n = this._vNoise(v, this._white, t, 1);
    const lp = this._vFilter(v, 'lowpass', 1800, 0);
    const ng = this._vGain(v, 0);
    this._perc(ng.gain, t, 0.3 + 0.2 * s, 0.002, 0.03);
    n.connect(lp);
    lp.connect(ng);
    ng.connect(v.out);
    const lo = this._vOsc(v, 'sine', 72, t);
    lo.frequency.setTargetAtTime(44, t, 0.06);
    const lg = this._vGain(v, 0);
    this._perc(lg.gain, t, 0.35 + 0.25 * s, 0.003, 0.07);
    lo.connect(lg);
    lg.connect(v.out);
    this._commit(v);
  }

  /** Fragile anchor: a crack plus a scatter of falling chips; crumble = heavier/longer. */
  _sfxBreak(p, weight) {
    const dur = 1.3 + 0.6 * weight;
    const pos = this._at(num(p.x, NaN), num(p.y, NaN), num(p.z, NaN));
    const sp = pos ? this._spatial(pos.x, pos.y, pos.z, NaN) : null;
    const lift = sp ? this._floor('near', sp.d, 0.55) : 1;
    const v = this._begin(weight > 1 ? 'crumble' : 'break', 2, 0.1, dur, this.busPlayer, (weight > 1 ? 0.75 : 1.0) * lift, 0, 0.3, 0, pos, 'near');
    if (!v) return;
    const t = v.t0;
    // Crack.
    const n = this._vNoise(v, this._white, t, 1);
    const hp = this._vFilter(v, 'highpass', 1200, 0);
    const ng = this._vGain(v, 0);
    this._perc(ng.gain, t, 0.6 / weight, 0.001, 0.02);
    n.connect(hp);
    hp.connect(ng);
    ng.connect(v.out);
    // Stone body.
    const b = this._vNoise(v, this._brown, t, 1);
    const bp = this._vFilter(v, 'bandpass', 380 / weight, 1);
    const bg = this._vGain(v, 0);
    this._swell(bg.gain, t, 0.7, 0.01, 0.06 * weight, 0.12 * weight);
    b.connect(bp);
    bp.connect(bg);
    bg.connect(v.out);
    // Debris falling away (pitch and level drop as it falls into the dark).
    this._tickTrain(v, t + 0.06, Math.round(8 * weight), 0.75 * weight, 0.4, 900, 3800, 4, 0.012, 0.8);
    // Settling rumble.
    const r = this._vNoise(v, this._brown, t, 0.8);
    const rl = this._vFilter(v, 'lowpass', 260, 0);
    const rg = this._vGain(v, 0);
    this._swell(rg.gain, t + 0.05, 0.35 * weight, 0.15, 0.2 * weight, 0.25);
    r.connect(rl);
    rl.connect(rg);
    rg.connect(v.out);
    this._commit(v);
  }

  _sfxJump() {
    const v = this._begin('jump', 1, 0.08, 0.3, this.busPlayer, 1.8, 0, 0, 0);
    if (!v) return;
    const t = v.t0;
    const n = this._vNoise(v, this._white, t, 1);
    const bp = this._vFilter(v, 'bandpass', 900, 0.9);
    const g = this._vGain(v, 0);
    this._perc(g.gain, t, 0.3, 0.003, 0.03);
    n.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    // Exertion "hup".
    const h = this._vNoise(v, this._pink, t, 1);
    const hb = this._vFilter(v, 'bandpass', 700, 2);
    const hg = this._vGain(v, 0);
    this._swell(hg.gain, t + 0.01, 0.35, 0.015, 0.03, 0.04);
    h.connect(hb);
    hb.connect(hg);
    hg.connect(v.out);
    this._commit(v);
  }

  _sfxFootstep(intensity) {
    const v = this._begin('step', 0, 0.09, 0.2, this.busPlayer, 0.34 * intensity, rand(-0.08, 0.08), 0, 0);
    if (!v) return;
    const t = v.t0;
    const b = this._vNoise(v, this._brown, t, 1.2);
    const bp = this._vFilter(v, 'bandpass', rand(200, 260), 1);
    const g = this._vGain(v, 0);
    this._perc(g.gain, t, 0.8, 0.002, 0.03);
    b.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    const n = this._vNoise(v, this._white, t, 1);
    const hp = this._vFilter(v, 'bandpass', rand(2600, 3600), 1);
    const ng = this._vGain(v, 0);
    this._perc(ng.gain, t, 0.15, 0.002, 0.02);
    n.connect(hp);
    hp.connect(ng);
    ng.connect(v.out);
    this._commit(v);
  }

  /** Landing thump ∝ how close the impact came to lethal; hard landings add weight, grit and a grunt-like breath. */
  _sfxLand(ratio, hard) {
    if (!(ratio >= 0.12)) return;
    const s = U.smoothstep(0.12, 1, ratio);
    const v = this._begin('land', hard ? 2 : 1, 0.06, hard ? 1.1 : 0.75, this.busPlayer, 0.5 + 0.4 * s, 0, 0.06 + 0.12 * s, 0);
    if (!v) return;
    const t = v.t0;
    const o = this._vOsc(v, 'sine', 90, t);
    o.frequency.setTargetAtTime(42, t, 0.04);
    const og = this._vGain(v, 0);
    this._perc(og.gain, t, 0.3 + 0.6 * s, 0.003, 0.06 + 0.1 * s);
    o.connect(og);
    og.connect(v.out);
    const b = this._vNoise(v, this._brown, t, 1);
    const lp = this._vFilter(v, 'lowpass', 300 + 900 * s, 0);
    const bg = this._vGain(v, 0);
    this._perc(bg.gain, t, 0.3 + 0.6 * s, 0.002, 0.05 + 0.06 * s);
    b.connect(lp);
    lp.connect(bg);
    bg.connect(v.out);
    const n = this._vNoise(v, this._white, t, 1);
    const bp = this._vFilter(v, 'bandpass', 2500, 0.8);
    const ng = this._vGain(v, 0);
    this._perc(ng.gain, t, 0.08 + 0.1 * s, 0.002, 0.03);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(v.out);
    if (hard) {
      // Grunt-like breath: pink noise through two vocal-ish formants, plus a little voicing.
      const h = this._vNoise(v, this._pink, t, 1);
      const sum = this._vGain(v, 1);
      const f1 = this._vFilter(v, 'bandpass', 520, 4);
      const f2 = this._vFilter(v, 'bandpass', 1150, 5);
      const hg = this._vGain(v, 0);
      const vo = this._vOsc(v, 'sawtooth', 115, t);
      vo.frequency.setTargetAtTime(84, t + 0.03, 0.06);
      const vg = this._vGain(v, 0.12);
      h.connect(sum);
      vo.connect(vg);
      vg.connect(sum);
      sum.connect(f1);
      sum.connect(f2);
      f1.connect(hg);
      f2.connect(hg);
      hg.connect(v.out);
      this._swell(hg.gain, t + 0.03, 0.9, 0.02, 0.08, 0.05);
      this._tickTrain(v, t + 0.05, 3, 0.25, 0.25, 1200, 3200, 4, 0.01, 0.5);
    }
    this._commit(v);
  }

  _sfxWall(p) {
    const s = U.smoothstep(4, 17, num(p.impact, 6));
    const v = this._begin('wall', 1, 0.08, 0.45, this.busPlayer, 0.45 + 0.4 * s, rand(-0.3, 0.3), 0.08, 0);
    if (!v) return;
    const t = v.t0;
    const o = this._vOsc(v, 'sine', 125, t);
    o.frequency.setTargetAtTime(70, t, 0.035);
    const og = this._vGain(v, 0);
    this._perc(og.gain, t, 0.5 + 0.4 * s, 0.003, 0.05);
    o.connect(og);
    og.connect(v.out);
    const b = this._vNoise(v, this._brown, t, 1.1);
    const lp = this._vFilter(v, 'lowpass', 650, 0);
    const bg = this._vGain(v, 0);
    this._perc(bg.gain, t, 0.5, 0.002, 0.05);
    b.connect(lp);
    lp.connect(bg);
    bg.connect(v.out);
    const n = this._vNoise(v, this._white, t, 1);
    const bp = this._vFilter(v, 'bandpass', 1800, 1);
    const ng = this._vGain(v, 0);
    this._swell(ng.gain, t, 0.12, 0.01, 0.03, 0.05);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(v.out);
    this._commit(v);
  }

  /** Small debris/grit crackles while a fragile anchor is failing. */
  _sfxGrit(stress) {
    const v = this._begin('grit', 0, 0.05, 0.25, this.busPlayer, 0.18 + 0.25 * stress, rand(-0.25, 0.25), 0.1, 0);
    if (!v) return;
    this._tickTrain(v, v.t0, 2 + Math.floor(Math.random() * 3), 0.12, 0.5, 1500, 4800, 5, 0.008, 0.4);
    this._commit(v);
  }

  // -------------------------------------------------------------------------
  // Synthesis recipes — stingers / UI
  // -------------------------------------------------------------------------

  /** Death: deep, muffled boom and a falling tone; the mix itself is muffled by kMuffle. */
  _sfxDeath(cause) {
    const v = this._begin('death', 3, 0.5, 3.6, this.busStinger, 0.75, 0, 0.25, 900);
    if (!v) return;
    const t = v.t0;
    const o = this._vOsc(v, 'sine', 58, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.2);
    const og = this._vGain(v, 0);
    this._perc(og.gain, t, 0.85, 0.01, 0.45);
    o.connect(og);
    og.connect(v.out);
    const b = this._vNoise(v, this._brown, t, 1);
    const lp = this._vFilter(v, 'lowpass', 260, 0);
    const bg = this._vGain(v, 0);
    this._perc(bg.gain, t, 0.6, 0.005, 0.3);
    b.connect(lp);
    lp.connect(bg);
    bg.connect(v.out);
    const tri = this._vOsc(v, 'triangle', 220, t + 0.2);
    tri.frequency.exponentialRampToValueAtTime(110, t + 2.2);
    const tg = this._vGain(v, 0);
    this._swell(tg.gain, t + 0.2, 0.1, 0.3, 0.4, 0.45);
    tri.connect(tg);
    tg.connect(v.out);
    if (cause === 'creature') {
      // The structure closing: a crunch and an iron rattle.
      const n = this._vNoise(v, this._white, t, 0.8);
      const bp = this._vFilter(v, 'bandpass', 900, 0.7);
      const ng = this._vGain(v, 0);
      this._perc(ng.gain, t, 0.55, 0.003, 0.09);
      n.connect(bp);
      bp.connect(ng);
      ng.connect(v.out);
      const r = this._vOsc(v, 'sawtooth', 32, t);
      const rb = this._vFilter(v, 'bandpass', 2200, 5);
      const rg = this._vGain(v, 0);
      this._perc(rg.gain, t, 0.5, 0.005, 0.12);
      r.connect(rb);
      rb.connect(rg);
      rg.connect(v.out);
    }
    this._commit(v);
  }

  _sfxRespawn() {
    const v = this._begin('respawn', 3, 0.5, 2.6, this.busStinger, 0.5, 0, 0.35, 0);
    if (!v) return;
    const t = v.t0;
    const n = this._vNoise(v, this._pink, t, 1);
    const bp = this._vFilter(v, 'bandpass', 600, 0.7);
    bp.frequency.setValueAtTime(380, t);
    bp.frequency.exponentialRampToValueAtTime(900, t + 0.7);
    const ng = this._vGain(v, 0);
    this._swell(ng.gain, t, 0.22, 0.55, 0.05, 0.3);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(v.out);
    const a = this._vOsc(v, 'sine', 110, t);
    const b = this._vOsc(v, 'sine', 164.8, t);
    const sg = this._vGain(v, 0);
    this._swell(sg.gain, t, 0.12, 0.5, 0.1, 0.4);
    a.connect(sg);
    b.connect(sg);
    sg.connect(v.out);
    this._commit(v);
  }

  /** Victory: a resolving low drone (root-fifth-octave) under a few slow bell-like chimes. */
  _sfxVictory() {
    const v = this._begin('victory', 3, 3, 14, this.busStinger, 0.33, 0, 0.45, 0);
    if (!v) return;
    const t = v.t0;
    const lp = this._vFilter(v, 'lowpass', 650, 0);
    const dg = this._vGain(v, 0);
    this._swell(dg.gain, t, 0.35, 2.5, 3.5, 1.3);
    lp.connect(dg);
    dg.connect(v.out);
    for (let i = 0; i < VICTORY_DRONE.length; i++) {
      const o = this._vOsc(v, i === 0 ? 'triangle' : 'sine', VICTORY_DRONE[i], t);
      o.connect(lp);
    }
    for (let i = 0; i < VICTORY_CHIMES.length; i++) {
      const tc = t + VICTORY_TIMES[i];
      const g = this._vGain(v, 0);
      this._perc(g.gain, tc, 0.12, 0.004, 1.1);
      g.connect(v.out);
      for (let k = 0; k < 2; k++) {
        const o = this._vOsc(v, 'sine', VICTORY_CHIMES[i] * BELL[k], tc);
        if (k === 0) {
          o.connect(g);
        } else {
          const pg = this._vGain(v, BELL_AMP[1]);
          o.connect(pg);
          pg.connect(g);
        }
      }
    }
    this._commit(v);
  }

  _sfxClick() {
    const v = this._begin('click', 1, 0.03, 0.08, this.busUi, 0.5, 0, 0, 0);
    if (!v) return;
    const t = v.t0;
    const o = this._vOsc(v, 'sine', 1500, t);
    o.frequency.setTargetAtTime(1100, t, 0.01);
    const g = this._vGain(v, 0);
    this._perc(g.gain, t, 0.3, 0.001, 0.01);
    o.connect(g);
    g.connect(v.out);
    const n = this._vNoise(v, this._white, t, 1);
    const hp = this._vFilter(v, 'highpass', 4000, 0);
    const ng = this._vGain(v, 0);
    this._perc(ng.gain, t, 0.12, 0.001, 0.004);
    n.connect(hp);
    hp.connect(ng);
    ng.connect(v.out);
    this._commit(v);
  }

  /** Checkpoint: a soft low bell — a moment of relief. */
  _sfxCheckpoint() {
    const v = this._begin('checkpoint', 1, 1, 4, this.busStinger, 0.22, 0, 0.4, 0);
    if (!v) return;
    const t = v.t0;
    for (let i = 0; i < CHECKPOINT_BELL.length; i++) {
      const o = this._vOsc(v, 'sine', CHECKPOINT_BELL[i], t + i * 0.12);
      const g = this._vGain(v, 0);
      this._perc(g.gain, t + i * 0.12, i === 0 ? 0.4 : 0.25, 0.01, 0.55);
      o.connect(g);
      g.connect(v.out);
    }
    this._commit(v);
  }

  /** Entering a new section for the first time: a slow, quiet tonal swell in that section's key. */
  _sfxSectionShift() {
    const sec = this._sec;
    const v = this._begin('section', 1, 2, 7, this.busAmbient, 0.1, 0, 0.5, 800);
    if (!v) return;
    const t = v.t0;
    const g = this._vGain(v, 0);
    this._swell(g.gain, t, 0.35, 1.6, 0.5, 0.8);
    g.connect(v.out);
    const a = this._vOsc(v, 'sine', sec.root * 2, t);
    const b = this._vOsc(v, 'sine', sec.root * 2 * sec.iv, t);
    const c = this._vOsc(v, 'triangle', sec.root * 4, t);
    const cg = this._vGain(v, 0.3);
    a.connect(g);
    b.connect(g);
    c.connect(cg);
    cg.connect(g);
    this._commit(v);
  }

  // -------------------------------------------------------------------------
  // Synthesis recipes — ambient events
  // -------------------------------------------------------------------------

  /** Ambient decoration keeps most of its 2D loudness: only half of the panner's distance loss (in dB). */
  _ambientLift(pos) {
    const d = Math.hypot(pos.x - this._lx, pos.y - this._ly, pos.z - this._lz);
    return 1 / Math.sqrt(Math.max(0.05, this._pannerGain('ambient', d)));
  }

  /** Structural creak/groan: a resonant band of noise gliding, excited by slow stick-slip pulses. */
  _sfxCreak() {
    const dur = rand(1.0, 2.6);
    const lvl = rand(0.12, 0.3) * (0.7 + 0.3 * this._sec.creaks / 6);
    const pos = this._around(8, 30, 15); // somewhere in the masonry around you
    const v = this._begin('creak', 0, 0.5, dur + 1.6, this.busAmbient, lvl * this._ambientLift(pos), 0, 0.55, 0, pos, 'ambient', true);
    if (!v) return;
    const t = v.t0;
    const f1 = rand(140, 480);
    const f2 = f1 * rand(0.7, 1.35);
    const bp = this._vFilter(v, 'bandpass', f1, rand(14, 22));
    bp.frequency.setValueAtTime(f1, t);
    bp.frequency.linearRampToValueAtTime(f2, t + dur);
    const g = this._vGain(v, 0);
    this._swell(g.gain, t, 1, dur * 0.3, dur * 0.45, 0.25);
    bp.connect(g);
    g.connect(v.out);
    const b = this._vNoise(v, this._brown, t, 1);
    const bg = this._vGain(v, 1.4);
    b.connect(bg);
    bg.connect(bp);
    const o = this._vOsc(v, 'sawtooth', rand(9, 18), t);
    o.frequency.linearRampToValueAtTime(rand(14, 28), t + dur);
    const og = this._vGain(v, 0.5);
    o.connect(og);
    og.connect(bp);
    this._commit(v);
  }

  /** Drip: a tiny rising "plip" far away in the stone. */
  _sfxDrip() {
    const pos = this._around(4, 20, 8);
    const v = this._begin('drip', 0, 0.1, 0.5, this.busAmbient, rand(0.05, 0.12) * this._ambientLift(pos), 0, 0.6, 0, pos, 'ambient', true);
    if (!v) return;
    const t = v.t0;
    const f = rand(700, 1300);
    const o = this._vOsc(v, 'sine', f, t);
    o.frequency.setTargetAtTime(f * 1.9, t, 0.012);
    const g = this._vGain(v, 0);
    this._perc(g.gain, t, 0.8, 0.002, 0.03);
    o.connect(g);
    g.connect(v.out);
    this._commit(v);
  }

  /** Settling debris: a few tiny distant ticks. */
  _sfxSettle() {
    const pos = this._around(6, 25, 12);
    const v = this._begin('settle', 0, 0.2, 0.7, this.busAmbient, rand(0.05, 0.11) * this._ambientLift(pos), 0, 0.45, 0, pos, 'ambient', true);
    if (!v) return;
    this._tickTrain(v, v.t0, 1 + Math.floor(Math.random() * 3), 0.3, 0.6, 2800, 5200, 5, 0.01, 0.4);
    this._commit(v);
  }

  /** Level trigger: a deep structural rumble with debris trickling down. */
  _sfxRumble() {
    const v = this._begin('rumble', 2, 1, 6, this.busAmbient, 0.7, rand(-0.25, 0.25), 0.35, 0);
    if (!v) return;
    const t = v.t0;
    const b = this._vNoise(v, this._brown, t, 1);
    const lp = this._vFilter(v, 'lowpass', 140, 0);
    lp.frequency.setValueAtTime(140, t);
    lp.frequency.linearRampToValueAtTime(380, t + 0.9);
    lp.frequency.setTargetAtTime(120, t + 1.2, 0.8);
    const g = this._vGain(v, 0);
    this._swell(g.gain, t, 0.9, 0.8, 0.6, 0.8);
    b.connect(lp);
    lp.connect(g);
    g.connect(v.out);
    const o = this._vOsc(v, 'sine', 31, t);
    const og = this._vGain(v, 0);
    this._swell(og.gain, t, 0.4, 0.8, 0.6, 0.8);
    o.connect(og);
    og.connect(v.out);
    this._tickTrain(v, t + 0.6, 10, 2.6, 0.25, 900, 3600, 3, 0.015, 0.7);
    this._commit(v);
  }

  /** Level trigger: debris raining past. */
  _sfxDebris(pos) {
    const sp = this._spatial(pos.x, pos.y, pos.z, NaN);
    const v = this._begin('debris', 1, 0.3, 2.6, this.busAmbient, 0.9 * this._floor('near', sp.d, 0.5), 0, 0.3, 0, pos, 'near');
    if (!v) return;
    const t = v.t0;
    this._tickTrain(v, t, 16, 1.7, 0.45, 700, 4200, 3.5, 0.014, 0.6);
    const n = this._vNoise(v, this._white, t, 1);
    const hp = this._vFilter(v, 'highpass', 2500, 0);
    const g = this._vGain(v, 0);
    this._swell(g.gain, t, 0.05, 0.3, 0.8, 0.3);
    n.connect(hp);
    hp.connect(g);
    g.connect(v.out);
    this._commit(v);
  }

  // -------------------------------------------------------------------------
  // Synthesis recipes — creature (spatialised)
  // -------------------------------------------------------------------------

  /** Creature one-shot level: the panner does the distance loss when positioned (keep `floor`), else the 2D curve. */
  _cMul(sp, floor) {
    return sp.ok ? this._floor('near', sp.d, floor) : Math.max(sp.gain, floor);
  }

  _cPos(sp) {
    return sp.ok ? sp : null;
  }

  /** Limb planting: chitin/iron clicks plus a stone knock. */
  _sfxCreatureStep(p) {
    if (this._countAlive('cstep') >= 4) return;
    const sp = this._spatial(num(p.x, NaN), num(p.y, NaN), num(p.z, NaN), num(p.distance, NaN));
    const inten = U.clamp(num(p.intensity, 0.6), 0.1, 1);
    const base = 2.2 * (0.4 + 0.6 * inten);
    if (base * sp.gain < 0.02) return; // inaudible: do not spend a voice
    const v = this._begin('cstep', 0, 0.04, 0.4, this.busCreature, base * this._cMul(sp, 0), 0, sp.send, sp.cutoff, this._cPos(sp), 'near');
    if (!v) return;
    const t = v.t0;
    this._tickTrain(v, t, 2 + Math.floor(Math.random() * 2), 0.06, 0.6, 2300, 4200, 7, 0.007, 0.3);
    const o = this._vOsc(v, 'sine', rand(140, 210), t);
    o.frequency.setTargetAtTime(rand(85, 110), t, 0.03);
    const og = this._vGain(v, 0);
    this._perc(og.gain, t, 0.5 * inten, 0.002, 0.04);
    o.connect(og);
    og.connect(v.out);
    const b = this._vNoise(v, this._brown, t, 1);
    const bp = this._vFilter(v, 'bandpass', rand(320, 520), 1.8);
    const bg = this._vGain(v, 0);
    this._perc(bg.gain, t, 0.7 * inten, 0.002, 0.05);
    b.connect(bp);
    bp.connect(bg);
    bg.connect(v.out);
    this._commit(v);
  }

  /**
   * The cry: two detuned sawtooths gliding up then sagging, through three
   * moving formant resonances, with breath noise and an inharmonic metallic
   * partner — more like the building groaning a word than any animal.
   */
  _sfxCall(x, y, z, inten, far, dHint) {
    const sp = this._spatial(x, y, z, dHint);
    const lvl = (0.3 + 0.7 * inten) * this._cMul(sp, far ? 0.1 : 0.06);
    const v = this._begin('call', 2, 1.2, 4.2, this.busCreature, lvl, 0, Math.max(sp.send, 0.45), Math.min(sp.cutoff + 400, 7000), this._cPos(sp), 'near');
    if (!v) return;
    const t = v.t0;
    const f0 = rand(92, 128);
    const exc = this._vGain(v, 1);
    const o1 = this._vOsc(v, 'sawtooth', f0, t);
    const o2 = this._vOsc(v, 'sawtooth', f0 * 1.007, t);
    this._glide(o1.frequency, t, f0);
    this._glide(o2.frequency, t, f0 * 1.007);
    const lfo = this._vOsc(v, 'sine', 5.3, t);
    const lg = this._vGain(v, 0);
    lg.gain.setValueAtTime(0, t);
    lg.gain.linearRampToValueAtTime(f0 * 0.02, t + 1.2);
    lfo.connect(lg);
    lg.connect(o1.frequency);
    lg.connect(o2.frequency);
    o1.connect(exc);
    o2.connect(exc);
    const br = this._vNoise(v, this._pink, t, 1);
    const bg = this._vGain(v, 0.3);
    br.connect(bg);
    bg.connect(exc);
    const env = this._vGain(v, 0);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(1, t + 0.35);
    env.gain.setTargetAtTime(0.7, t + 0.9, 0.4);
    env.gain.setTargetAtTime(0, t + 2.1, 0.3);
    env.connect(v.out);
    for (let i = 0; i < FORMANTS.length; i++) {
      const f = FORMANTS[i];
      const bp = this._vFilter(v, 'bandpass', f[0], f[3]);
      bp.frequency.setValueAtTime(f[0], t);
      bp.frequency.linearRampToValueAtTime(f[1], t + 0.9);
      bp.frequency.linearRampToValueAtTime(f[2], t + 2.6);
      const fg = this._vGain(v, f[4]);
      exc.connect(bp);
      bp.connect(fg);
      fg.connect(env);
    }
    // Metallic partner tone (inharmonic) riding the same contour.
    const m = this._vOsc(v, 'sine', f0 * 3.17, t);
    this._glide(m.frequency, t, f0 * 3.17);
    const mg = this._vGain(v, 0.05);
    m.connect(mg);
    mg.connect(env);
    this._commit(v);
  }

  _glide(param, t, f) {
    param.setValueAtTime(f, t);
    param.linearRampToValueAtTime(f * 1.55, t + 0.9);
    param.exponentialRampToValueAtTime(f * 0.68, t + 2.7);
  }

  /** Burst: a rising surge of grinding noise, a heavy push-off and a flurry of limb clicks. */
  _sfxBurst(x, y, z, dHint, hold, commit) {
    const sp = this._spatial(x, y, z, dHint);
    const delay = hold > 0 ? hold : 0;
    const lvl = this._cMul(sp, 0.05) * 1.4 * (commit ? 1.15 : 1);
    const v = this._begin('burst', 2, 0.5, 1.9 + delay, this.busCreature, lvl, 0, sp.send, sp.cutoff + 600, this._cPos(sp), 'near');
    if (!v) return;
    const t = v.t0 + delay; // the surge starts when the crown-snap hold ends
    const n = this._vNoise(v, this._pink, t, 1);
    const bp = this._vFilter(v, 'bandpass', 200, 1.5);
    bp.frequency.setValueAtTime(200, t);
    bp.frequency.exponentialRampToValueAtTime(1400, t + 0.7);
    const g = this._vGain(v, 0);
    this._swell(g.gain, t, 0.7, 0.5, 0.1, 0.2);
    n.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    const o = this._vOsc(v, 'sine', 60, t);
    o.frequency.setTargetAtTime(38, t, 0.1);
    const og = this._vGain(v, 0);
    this._perc(og.gain, t, 0.6, 0.004, 0.15);
    o.connect(og);
    og.connect(v.out);
    this._tickTrain(v, t + 0.1, 6, 0.6, 0.5, 2400, 4200, 6, 0.007, 0.2);
    this._commit(v);
  }

  /**
   * Attack: a wind-up screech-rattle rising over W seconds, into a heavy impact
   * when `impact` (no strike event will follow) or for a gate slam.
   */
  _sfxAttack(x, y, z, W, gate, impact) {
    const sp = this._spatial(x, y, z, NaN);
    const hit = impact || gate;
    const v = this._begin('attack', 3, 0.3, W + (gate ? 3 : hit ? 1.6 : 0.5), this.busCreature, this._cMul(sp, 0.25), 0, sp.send * 0.6, Math.max(sp.cutoff, 2500), this._cPos(sp), 'near');
    if (!v) return;
    const t = v.t0;
    // Screech: two sawtooths sweeping up through bright resonances.
    const s1 = this._vOsc(v, 'sawtooth', 280, t);
    const s2 = this._vOsc(v, 'sawtooth', 297, t);
    s1.frequency.exponentialRampToValueAtTime(950, t + W);
    s2.frequency.exponentialRampToValueAtTime(1010, t + W);
    const b1 = this._vFilter(v, 'bandpass', 1800, 4);
    const b2 = this._vFilter(v, 'bandpass', 3100, 6);
    const sg = this._vGain(v, 0);
    sg.gain.setValueAtTime(0, t);
    sg.gain.linearRampToValueAtTime(0.35, t + W);
    sg.gain.setTargetAtTime(0, t + W, 0.05);
    s1.connect(b1);
    s2.connect(b1);
    s1.connect(b2);
    b1.connect(sg);
    b2.connect(sg);
    sg.connect(v.out);
    // Rattle: an accelerating iron chatter.
    const r = this._vOsc(v, 'sawtooth', 22, t);
    r.frequency.linearRampToValueAtTime(48, t + W);
    const rb = this._vFilter(v, 'bandpass', 2400, 3);
    const rg = this._vGain(v, 0);
    rg.gain.setValueAtTime(0, t);
    rg.gain.linearRampToValueAtTime(0.6, t + W);
    rg.gain.setTargetAtTime(0, t + W, 0.06);
    r.connect(rb);
    rb.connect(rg);
    rg.connect(v.out);
    const ti = t + W;
    if (hit) this._impactLayers(v, ti, 1);
    if (gate) {
      // The sanctuary's iron grating takes the blow: a long, low, inharmonic clang.
      const base = rand(118, 132);
      for (let i = 0; i < PARTIALS.length; i++) {
        const o = this._vOsc(v, 'sine', base * PARTIALS[i], ti);
        const g = this._vGain(v, 0);
        this._perc(g.gain, ti, PARTIAL_AMP[i] * 0.9, 0.002, PARTIAL_TC[i] * 3.6);
        o.connect(g);
        g.connect(v.out);
      }
    }
    this._commit(v);
  }

  /** Heavy impact (shared by attack / strike): low thud, stone body, bright crack. */
  _impactLayers(v, ti, k) {
    const lo = this._vOsc(v, 'sine', 70, ti);
    lo.frequency.setTargetAtTime(32, ti, 0.12);
    const lg = this._vGain(v, 0);
    this._perc(lg.gain, ti, 0.8 * k, 0.003, 0.25);
    lo.connect(lg);
    lg.connect(v.out);
    const b = this._vNoise(v, this._brown, ti, 1);
    const lp = this._vFilter(v, 'lowpass', 1400, 0);
    const bg = this._vGain(v, 0);
    this._perc(bg.gain, ti, 0.7 * k, 0.002, 0.18);
    b.connect(lp);
    lp.connect(bg);
    bg.connect(v.out);
    const n = this._vNoise(v, this._white, ti, 1);
    const hp = this._vFilter(v, 'highpass', 3000, 0);
    const ng = this._vGain(v, 0);
    this._perc(ng.gain, ti, 0.25 * k, 0.001, 0.05);
    n.connect(hp);
    hp.connect(ng);
    ng.connect(v.out);
  }

  /**
   * Strike (creature:strike): the lunge's contact at the true strike point — a
   * heavy impact; on a miss also the crown scraping off the masonry (grinding
   * stone, amplitude-modulated, dragging down in pitch) and a spray of grit.
   */
  _sfxStrike(x, y, z, dHint, hit) {
    const sp = this._spatial(x, y, z, dHint);
    const v = this._begin('strike', 3, 0.2, hit ? 1.2 : 1.8, this.busCreature, this._cMul(sp, 0.3), 0, sp.send * 0.6, Math.max(sp.cutoff, 2500), this._cPos(sp), 'near');
    if (!v) return;
    const t = v.t0;
    this._impactLayers(v, t, hit ? 1 : 0.9);
    if (hit) {
      this._commit(v);
      return;
    }
    const b = this._vNoise(v, this._brown, t, 1.2);
    const bp = this._vFilter(v, 'bandpass', 560, 1.8);
    bp.frequency.setValueAtTime(560, t + 0.03);
    bp.frequency.exponentialRampToValueAtTime(240, t + 0.75);
    const am = this._vGain(v, 0.5);
    const lfo = this._vOsc(v, 'sawtooth', 11, t);
    lfo.frequency.linearRampToValueAtTime(4, t + 0.75);
    const lfg = this._vGain(v, 0.45);
    lfo.connect(lfg);
    lfg.connect(am.gain);
    const g = this._vGain(v, 0);
    this._swell(g.gain, t + 0.03, 0.75, 0.04, 0.35, 0.2);
    b.connect(bp);
    bp.connect(am);
    am.connect(g);
    g.connect(v.out);
    this._tickTrain(v, t + 0.06, 7, 0.55, 0.4, 1200, 4200, 4, 0.012, 0.7);
    this._commit(v);
  }

  /**
   * Crown snap ('heard' / 'stall' bursts): the crown flares toward you before the
   * surge — a sharp crack, a fast click-rattle of plates locking open that
   * accelerates through the hold, and a rising narrow "inhale" through the pits.
   * Placed at the creature; kept clearly audible (it is the warning beat).
   */
  _sfxCrownSnap(x, y, z, dHint, hold, stall) {
    const sp = this._spatial(x, y, z, dHint);
    const v = this._begin('snap', 3, 0.3, hold + 0.9, this.busCreature, this._cMul(sp, 0.3) * (stall ? 1.1 : 1), 0, Math.max(sp.send, 0.3), Math.max(sp.cutoff, 3200), this._cPos(sp), 'near');
    if (!v) return;
    const t = v.t0;
    // Crack.
    const n = this._vNoise(v, this._white, t, 1);
    const hp = this._vFilter(v, 'highpass', 2800, 0);
    const ng = this._vGain(v, 0);
    this._perc(ng.gain, t, 0.55, 0.001, 0.014);
    n.connect(hp);
    hp.connect(ng);
    ng.connect(v.out);
    // Low knock of the crown's mass.
    const o = this._vOsc(v, 'sine', 150, t);
    o.frequency.setTargetAtTime(72, t, 0.03);
    const og = this._vGain(v, 0);
    this._perc(og.gain, t, 0.45, 0.002, 0.05);
    o.connect(og);
    og.connect(v.out);
    // Click-rattle through the hold (accelerating, brightening).
    const n2 = this._vNoise(v, this._white, t, 1);
    const cbp = this._vFilter(v, 'bandpass', 3600, 9);
    const cg = this._vGain(v, 0);
    n2.connect(cbp);
    cbp.connect(cg);
    cg.connect(v.out);
    const clicks = Math.max(4, Math.round(hold * 26));
    let tt = t + 0.02;
    for (let i = 0; i < clicks; i++) {
      const k = i / (clicks - 1);
      cbp.frequency.setValueAtTime(U.clamp(rand(2800, 4200) * (0.85 + 0.35 * k), 60, this._nyq), tt);
      this._tick(cg.gain, tt, (0.35 + 0.4 * k) * rand(0.7, 1), 0.006);
      tt += (hold / clicks) * (1.35 - 0.7 * k) * rand(0.8, 1.2);
    }
    // Rising "inhale" through the pits, peaking as the surge begins.
    const p = this._vNoise(v, this._pink, t, 1);
    const ibp = this._vFilter(v, 'bandpass', 900, 8);
    ibp.frequency.setValueAtTime(900, t);
    ibp.frequency.exponentialRampToValueAtTime(3200, t + hold);
    const ig = this._vGain(v, 0);
    ig.gain.setValueAtTime(0, t);
    ig.gain.linearRampToValueAtTime(0.5, t + hold);
    ig.gain.setTargetAtTime(0, t + hold, 0.06);
    p.connect(ibp);
    ibp.connect(ig);
    ig.connect(v.out);
    this._commit(v);
  }

  /**
   * Near miss: a heavy body tearing the air within metres of the head — a
   * falling band of noise (doppler-ish), a low pressure thump and grit, placed
   * at the strike point so the head can tell which side it came from.
   */
  _sfxNearMiss(x, y, z, dHint) {
    const sp = this._spatial(x, y, z, dHint);
    const close = U.smoothstep(12, 2, num(dHint, sp.d));
    const v = this._begin('nearmiss', 3, 0.4, 1.2, this.busCreature, (0.55 + 0.45 * close) * this._cMul(sp, 0.35), 0, 0.2, 0, this._cPos(sp), 'near');
    if (!v) return;
    const t = v.t0;
    const n = this._vNoise(v, this._pink, t, 1);
    const bp = this._vFilter(v, 'bandpass', 2400, 1.1);
    bp.frequency.setValueAtTime(2400, t);
    bp.frequency.exponentialRampToValueAtTime(320, t + 0.42);
    const g = this._vGain(v, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.9, t + 0.12);
    g.gain.setTargetAtTime(0, t + 0.16, 0.09);
    n.connect(bp);
    bp.connect(g);
    g.connect(v.out);
    const lo = this._vOsc(v, 'sine', 64, t + 0.1);
    lo.frequency.setTargetAtTime(36, t + 0.1, 0.08);
    const lg = this._vGain(v, 0);
    this._perc(lg.gain, t + 0.1, 0.6, 0.006, 0.12);
    lo.connect(lg);
    lg.connect(v.out);
    this._tickTrain(v, t + 0.14, 4, 0.3, 0.35, 1600, 4200, 5, 0.01, 0.5);
    this._commit(v);
  }

  /** Retreat: a scrape receding (closing low-pass, drifting outward) and a low groan sinking away. */
  _sfxRetreat(x, y, z) {
    const sp = this._spatial(x, y, z, NaN);
    const D = 3.4;
    const v = this._begin('retreat', 2, 1, D + 1, this.busCreature, this._cMul(sp, 0.08), 0, Math.max(sp.send, 0.5), 0, this._cPos(sp), 'near');
    if (!v) return;
    const t = v.t0;
    // Recession: a per-voice low-pass that closes while the source itself drifts away
    // from the head (further out along the line to it, and up into the dark).
    const rec = this._vFilter(v, 'lowpass', Math.max(sp.cutoff, 1200), 0);
    rec.frequency.setValueAtTime(Math.max(sp.cutoff, 1200), t);
    rec.frequency.exponentialRampToValueAtTime(240, t + D);
    rec.connect(v.out);
    const pn = v.panner;
    if (pn && pn.positionX && sp.ok) {
      const dx = sp.x - this._lx;
      const dy = sp.y - this._ly;
      const dz = sp.z - this._lz;
      const dl = Math.hypot(dx, dy, dz) || 1;
      try {
        pn.positionX.setValueAtTime(sp.x, t);
        pn.positionY.setValueAtTime(sp.y, t);
        pn.positionZ.setValueAtTime(sp.z, t);
        pn.positionX.linearRampToValueAtTime(sp.x + (dx / dl) * 30, t + D);
        pn.positionY.linearRampToValueAtTime(sp.y + (dy / dl) * 30 + 8, t + D);
        pn.positionZ.linearRampToValueAtTime(sp.z + (dz / dl) * 30, t + D);
      } catch {
        // ignore
      }
    }
    const n = this._vNoise(v, this._pink, t, 1);
    const bp = this._vFilter(v, 'bandpass', 700, 2);
    bp.frequency.setValueAtTime(700, t);
    bp.frequency.exponentialRampToValueAtTime(260, t + D);
    const am = this._vGain(v, 0.5);
    const lfo = this._vOsc(v, 'sawtooth', 6, t);
    lfo.frequency.linearRampToValueAtTime(2.5, t + D);
    const lfg = this._vGain(v, 0.45);
    lfo.connect(lfg);
    lfg.connect(am.gain);
    const g = this._vGain(v, 0);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.6, t + 0.3);
    g.gain.linearRampToValueAtTime(0, t + D);
    n.connect(bp);
    bp.connect(am);
    am.connect(g);
    g.connect(rec);
    const o = this._vOsc(v, 'sawtooth', 62, t);
    o.frequency.exponentialRampToValueAtTime(41, t + D);
    const olp = this._vFilter(v, 'lowpass', 300, 2);
    const og = this._vGain(v, 0);
    og.gain.setValueAtTime(0, t);
    og.gain.linearRampToValueAtTime(0.35, t + 0.6);
    og.gain.linearRampToValueAtTime(0, t + D);
    o.connect(olp);
    olp.connect(og);
    og.connect(rec);
    this._commit(v);
  }

  /** Sighting: one distant resonant tone, bell-like and heavily reverberant. */
  _sfxSighting(x, y, z) {
    const sp = this._spatial(x, y, z, NaN);
    // Direction only (no distance loss): one resonant tone at the edge of hearing, from where it is.
    const v = this._begin('sighting', 2, 2, 7, this.busCreature, 0.2, 0, 0.65, 1300, sp.ok ? sp : null, 'flat');
    if (!v) return;
    const t = v.t0;
    const f = rand(68, 78);
    const g = this._vGain(v, 0);
    this._swell(g.gain, t, 0.5, 1.2, 0.4, 1.0);
    g.connect(v.out);
    for (let i = 0; i < BELL.length; i++) {
      const o = this._vOsc(v, 'sine', f * BELL[i], t);
      const pg = this._vGain(v, BELL_AMP[i]);
      o.connect(pg);
      pg.connect(g);
    }
    const n = this._vNoise(v, this._pink, t, 1);
    const bp = this._vFilter(v, 'bandpass', f * BELL[1], 20);
    const ng = this._vGain(v, 0.5);
    n.connect(bp);
    bp.connect(ng);
    ng.connect(g);
    this._commit(v);
  }
}
