/* ABYSSAL TETHER — audio.js
 * Fully procedural Web Audio soundscape — no samples, no recordings. Every
 * sound is synthesised at runtime from oscillators and three noise buffers
 * generated once at unlock:
 *   - ambient: shaft wind (stereo, gusting), a whistle through the masonry,
 *     sub rumble, a per-section tonal pad, random structural creaks, drips and
 *     settling ticks;
 *   - player: breathing (rate/intensity from exertion + threat), tether fire /
 *     attach / miss / release / jolt, rope creak from tension, fragile-anchor
 *     grinding, reel ratchet, footsteps, landings, wall hits, falling roar,
 *     death / respawn / victory stingers;
 *   - creature (spatialised from game.creature.audio): grinding scrape bed,
 *     close scrape layer, low resonance drone, "listening" chitter, plus
 *     one-shot limb clicks, calls, bursts, attacks, retreats and sightings;
 *   - psychological: heartbeat (threat.heartRate / threat.beat) and a dread
 *     rumble swelling with threat.
 *
 * Graph:
 *   ambient ─┐
 *   player ──┼─► muffle (lowpass; closes on death) ─┐
 *   creature ┤        ▲                             ├─► master (volume) ─► compressor ─► soft clip ─► out
 *   psych ───┘   space (feedback-delay "room")      │
 *   ui, stinger ────────────────────────────────────┘
 * Voices and continuous layers feed the space through send gains; its size,
 * feedback and level follow the current section (deeper = bigger, darker).
 *
 * Robustness: `enabled` is false and every method is a no-op without Web
 * Audio. unlock() is idempotent and gesture-safe (also plays a 1-sample
 * silent buffer for iOS). All parameter changes are ramped (setTargetAtTime),
 * one-shots are capped and rate limited, finished nodes are disconnected, and
 * nothing in here throws into the game.
 */
(function (AT) {
  'use strict';

  const U = AT.util;

  // ===========================================================================
  // Tuning
  // ===========================================================================
  const MAX_VOICES = 24; // simultaneous one-shot voices (voices fading out after a steal excluded)
  const VOICE_POOL = 34; // voice records (cap + headroom for voices still fading out)
  const CONTROL_DT = 1 / 30; // continuous-layer parameter update interval (s)
  const LOOKAHEAD = 0.005; // one-shots start this far after "now" (s)
  const GATE_HOLD = 3; // a continuous layer silent this long is disconnected from its sources (s)

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
  function randSign() {
    return Math.random() < 0.5 ? -1 : 1;
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
    }
  }

  // ===========================================================================
  // AudioManager
  // ===========================================================================
  class AudioManager {
    /**
     * @param {AT.EventBus} bus  game event bus (sound triggers)
     * @param {object} settings  live settings object (reads .volume)
     */
    constructor(bus, settings) {
      this.bus = bus || null;
      this.settings = settings || AT.SETTINGS_DEFAULTS || {};
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

      // Listener (world units): the player while playing, otherwise the camera centre.
      this._lx = 0;
      this._ly = 0;
      this._lhw = 400;
      this._sp = { d: 0, pan: 0, gain: 0, cutoff: 0, send: 0 }; // spatial scratch

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
      this._prevRope = 0;
      this._prevAttached = false;
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
     * heartbeat / breathing. Reads game.state, player, grapple, creature.audio,
     * threat, camera, level, sectionIndex.
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

    _onVisibility(doc) {
      const ctx = this.ctx;
      if (!ctx || this._offline) return;
      try {
        if (doc.hidden) {
          if (ctx.state === 'running') {
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
      if (typeof console !== 'undefined') console.warn(`[AT] audio ${where} failed`, err);
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
      // Shared spatial chain: in → distance low-pass → pan → distance gain → bus (+ space send).
      this.crIn = this._gainNode(1);
      const lp = this._filter('lowpass', 1200, 0);
      const pan = this._makePanner(0);
      const g = this._gainNode(0);
      const send = this._gainNode(0);
      this.crIn.connect(lp);
      lp.connect(pan);
      pan.connect(g);
      g.connect(this.busCreature);
      g.connect(send);
      send.connect(this.spaceIn);
      this.kCrLP = this._knob(lp.frequency, 1200, 10, 0.02);
      this.kCrPan = this._panKnob(pan, 0);
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
      const running = this._live();

      // Follow the live settings object (volume slider) without needing an event.
      const vol = U.clamp(num(this.settings && this.settings.volume, this._polledVolume), 0, 1);
      if (vol !== this._polledVolume) {
        this._polledVolume = vol;
        this.setVolume(vol);
      }

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
      const G = game && game.grapple ? game.grapple : null;
      const TH = game && game.threat ? game.threat : null;
      const cam = game && game.camera ? game.camera : null;
      const level = game && game.level ? game.level : null;
      const hidden = !!(game && game.hidePlayer);
      const playing = state === 'playing';
      const victory = state === 'victory' || this._victory;
      if (state === 'dead') this._dead = true;
      else if (playing && P && P.alive !== false) this._dead = false;
      const dead = this._dead;
      const c = this._clock;

      // ---- listener --------------------------------------------------------
      if (P && !hidden && state !== 'menu') {
        this._lx = num(P.rx, num(P.x, this._lx));
        this._ly = num(P.ry, num(P.y, this._ly));
      } else if (cam) {
        this._lx = num(cam.x, this._lx);
        this._ly = num(cam.y, this._ly);
      }
      this._lhw = Math.max(260, num(cam && cam.viewW, 800) * 0.5);

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
      const body = !!P && !hidden && (playing || state === 'victory') && P.alive !== false;
      const speed = body ? num(P.speed, Math.hypot(num(P.vx, 0), num(P.vy, 0))) : 0;
      const vx = body ? num(P.vx, 0) : 0;
      const vy = body ? num(P.vy, 0) : 0;
      this._exertion = Math.max(0, this._exertion - dtc * 0.06);
      if (body && playing) {
        this._exertion = Math.min(1, this._exertion + dtc * 0.07 * U.smoothstep(250, 900, speed));
        if (P.grounded && Math.abs(vx) > 200) this._exertion = Math.min(1, this._exertion + dtc * 0.025);
      }

      // ---- ambient bed -----------------------------------------------------
      const speedK = body ? U.smoothstep(200, 1400, speed) : 0;
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
      this.kRumSubG.set(rum * 0.15, now, 0.5); // sub is felt on headphones, inaudible on phones: keep it small
      const root = sec.root;
      const det = victory ? 0 : 0.25 + tv * 2.2; // dissonant beating grows with threat
      this.kPadA.set(root, now, 2);
      this.kPadB.set(root * (victory ? 1.5 : sec.iv) + det, now, victory ? 3 : 1.2);
      this.kPadC.set(root * (victory ? 3 : 2 * sec.iv) + det * 1.7, now, victory ? 3 : 1.2);
      this.kPadG.set(sec.pad * (victory ? 2.2 : 1 + 0.6 * tv), now, 1.5);

      // ---- player continuous layers -----------------------------------------
      const attached = body && (P.grappleState === 'attached' || !!(G && G.attached));
      const tension = attached ? Math.max(0, num(P.tension, 0)) : 0;
      const tN = U.clamp((tension - 900) / 3600, 0, 1);
      const motion = U.smoothstep(30, 420, speed);
      const creak = attached ? (0.22 * U.smoothstep(500, 1700, tension) + 0.78 * tN) * (0.25 + 0.75 * motion) : 0;
      const slip = U.noise1(c * 3.1, 31);
      this.kCreakG.set(creak * 0.9, now, 0.06);
      this.kCreakF.set(16 + 46 * tN + 6 * slip, now, 0.03);
      this.kCreakBP.set(680 + 260 * tN + 60 * slip, now, 0.1);

      let stress = 0;
      if (attached && G && typeof G.anchorStress === 'function') stress = U.clamp(num(G.anchorStress(), 0), 0, 1);
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

      const L = attached ? num(G ? G.ropeLength : P.ropeLength, 0) : 0;
      let reel = 0;
      if (attached && this._prevAttached && dtc > 0) {
        const dl = Math.abs(L - this._prevRope);
        if (dl < 60) reel = dl / dtc; // larger jumps are re-attachments, not reeling
      }
      this._prevRope = L;
      this._prevAttached = attached;
      const reelK = U.clamp(reel / 360, 0, 1);
      this.kReelG.set(reelK > 0.05 ? 0.3 * (0.4 + 0.6 * reelK) : 0, now, 0.03);
      this.kReelF.set(14 + 34 * reelK, now, 0.05);

      const fallK = body && !attached && !P.grounded ? U.smoothstep(380, 1450, vy) : 0;
      const airK = body ? U.smoothstep(500, 1750, speed) * (attached ? 0.4 : 0.75) : 0;
      const roar = Math.max(Math.pow(fallK, 1.3), airK);
      this.kFallG.set(0.36 * roar * (1 + 0.25 * roar * U.noise1(c * 7.3, 37)), now, 0.06);
      this.kFallF.set(450 + 1500 * roar, now, 0.12);

      // Footsteps from distance run on the ground.
      if (body && playing && P.grounded && Math.abs(vx) > 60) {
        this._stride += Math.abs(vx) * dtc;
        if (this._stride > 62) {
          this._stride = 0;
          this._sfxFootstep(U.clamp(Math.abs(vx) / 330, 0.3, 1));
        }
      } else {
        this._stride = 40; // the first step lands soon after starting to run
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
      let d = num(ca.distance, NaN);
      let pan = 0;
      const cx = num(ca.x, NaN);
      const cy = num(ca.y, NaN);
      if (cx === cx && cy === cy) {
        const sp = this._spatial(cx, cy);
        pan = sp.pan;
        if (!(d === d)) d = sp.d;
      }
      if (!(d === d)) d = 3000;
      d = Math.max(0, d);
      const presence = 1 / (1 + Math.pow(d / 520, 1.5));
      const move = U.clamp(num(ca.movement, 0), 0, 1);
      const inten = U.clamp(num(ca.intensity, presence), 0, 1);
      const st = typeof ca.state === 'string' ? ca.state : typeof CR.state === 'string' ? CR.state : '';
      const surge = st === 'BURST' || st === 'ATTACK';
      const stMul = surge ? 1.35 : st === 'RECOVERING' ? 0.7 : st === 'DORMANT' ? 0.35 : 1;

      // Flat-ish curve (it is heard from far away), but fully silent beyond ~6.5k units
      // (creature.js reports distance 99999 while out of play) so the layer gates can close.
      const farCut = U.smoothstep(6500, 4500, d);
      this.kCrG.set(farCut > 0.001 ? Math.pow(presence, 0.45) * farCut : 0, now, 0.15);
      this.kCrLP.set(280 + 11500 * Math.exp(-d / 700), now, 0.15);
      this.kCrPan.set(pan, now, 0.12);
      this.kCrSend.set(0.15 + 0.5 * (1 - presence), now, 0.3);
      this.kScrG.set(0.9 * move * stMul, now, 0.12);
      this.kScrF.set((210 + 300 * move) * (st === 'BURST' ? 1.5 : 1), now, 0.15);
      this.kScrLfo.set(2.2 + 7 * move + 2 * U.noise1(c * 0.9, 41), now, 0.1);
      this.kCloseG.set(0.26 * move * U.smoothstep(950, 160, d) * stMul, now, 0.1);
      this.kDroneG.set(0.22 * U.smoothstep(2300, 220, d) * (0.5 + 0.5 * inten) * stMul, now, 0.4);
      this.kDroneF1.set(surge ? 46 : 40.5, now, 0.5);
      this.kDroneF2.set(surge ? 47.1 : 41.2, now, 0.5);
      this.kListenG.set(st === 'OBSERVING' ? 0.14 * U.smoothstep(2600, 250, d) : 0, now, 0.25);
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

    /** Pan / gain / low-pass / space send for a world point relative to the listener (scratch result). */
    _spatial(x, y, dHint) {
      const S = this._sp;
      let dx = x - this._lx;
      let dy = y - this._ly;
      if (!(dx === dx) || !(dy === dy)) {
        dx = 0;
        dy = -1600;
      }
      let d = Math.hypot(dx, dy);
      const hint = num(dHint, NaN);
      if (hint === hint && !(x === x)) d = hint;
      S.d = d;
      // Lateral offset relative to the view width; mostly-vertical sources stay near centre.
      S.pan = U.clamp(dx / Math.max(this._lhw, Math.abs(dy) * 0.8), -1, 1) * 0.9;
      S.gain = 1 / (1 + Math.pow(d / 520, 1.5));
      S.cutoff = 260 + 12000 * Math.exp(-d / 700);
      S.send = 0.12 + 0.55 * (1 - Math.exp(-d / 900));
      return S;
    }

    _panAt(x) {
      const v = (num(x, this._lx) - this._lx) / this._lhw;
      return U.clamp(v, -1, 1);
    }

    // -------------------------------------------------------------------------
    // One-shot voice management
    // -------------------------------------------------------------------------

    /**
     * Allocates a one-shot voice: out(level) → [lowpass] → [pan] → bus (+ space send).
     * Returns null when audio is not running, the sound is rate limited, or the
     * cap is reached and nothing of lower/equal priority can be stolen.
     */
    _begin(name, prio, minGap, dur, bus, level, pan, send, cutoff) {
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
      const pn = num(pan, 0);
      if (pn > 0.02 || pn < -0.02) {
        const p = this._makePanner(pn);
        tail.connect(p);
        v.nodes.push(p);
        tail = p;
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
      };
      for (const type of Object.keys(map)) {
        const fn = map[type];
        bus.on(type, (payload) => {
          if (!this._built) {
            // Lifecycle flags still matter before the context exists.
            if (type === 'game:pause' || type === 'game:menu') this._pauseFlag = true;
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
      this._prevAttached = false;
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
      this._prevAttached = false;
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

    _onSection(p) {
      const idx = num(p.index, this._secIndex);
      const now = this.ctx.currentTime;
      if ((idx | 0) !== this._secIndex) this._applySection(idx, p.section || null, now, 2.5);
      if (p.first) this._sfxSectionShift();
    }

    _onCheckpoint() {
      this._sfxCheckpoint();
    }

    // ---- player ----------------------------------------------------------------------

    _onFire(p) {
      this._sfxFire(p);
    }

    _onAttach(p) {
      const heavy = U.smoothstep(380, 1250, num(p.speed, 0));
      this._exertion = Math.min(1, this._exertion + 0.03 + 0.08 * heavy);
      this._sfxAttach(p, heavy);
      if (p.chained) this._sfxRelease(0.6);
    }

    _onMiss(p) {
      this._sfxMiss(p);
    }

    _onRelease(p) {
      if (p.reason === 'break' || p.reason === 'death' || p.reason === 'reset') return;
      this._sfxRelease(U.clamp(0.5 + num(p.speed, 0) / 1600, 0.5, 1));
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
      const impact = num(p.impact, 0);
      if (p.hard) this._exertion = Math.min(1, this._exertion + 0.25);
      this._sfxLand(impact, !!p.hard, num(p.x, this._lx));
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
      this._sfxDebris(num(p.x, NaN));
    }

    _onTriggerCall(p) {
      const data = p.data && typeof p.data === 'object' ? p.data : EMPTY;
      let x = num(data.x, NaN);
      let y = num(data.y, NaN);
      if (!(x === x) || !(y === y)) {
        x = this._lx + randSign() * rand(300, 700);
        y = this._ly - rand(1400, 2200);
      }
      this._sfxCall(x, y, U.clamp(num(data.intensity, 0.8), 0.2, 1), true);
    }

    _onCreatureStep(p) {
      this._sfxCreatureStep(p);
    }

    _onCreatureCall(p) {
      this._sfxCall(num(p.x, NaN), num(p.y, NaN), U.clamp(num(p.intensity, 0.7), 0.1, 1), false, num(p.distance, NaN));
    }

    _onCreatureBurst(p) {
      this._sfxBurst(num(p.x, NaN), num(p.y, NaN));
    }

    _onCreatureAttack(p) {
      // A lunge is emitted at wind-up start: land the impact when the strike does.
      // A gate slam (victory) is emitted at the moment of impact.
      let w = 0.03;
      if (!p.gate) {
        w = num(p.windup, NaN);
        if (!(w === w)) {
          const cr = this._game && this._game.creature;
          w = cr && cr.attack ? num(cr.attack.windup, 0.5) : 0.5;
        }
      }
      this._sfxAttack(num(p.x, NaN), num(p.y, NaN), U.clamp(w, 0.03, 0.9), !!p.gate);
    }

    _onCreatureRetreat(p) {
      this._sfxRetreat(num(p.x, NaN), num(p.y, NaN));
    }

    _onCreatureSighting(p) {
      this._sfxSighting(num(p.x, NaN), num(p.y, NaN));
    }

    // -------------------------------------------------------------------------
    // Synthesis recipes — player
    // -------------------------------------------------------------------------

    /** Tether fire: a fast whip-zip (rising band of noise + a short chirp). */
    _sfxFire(p) {
      const v = this._begin('fire', 1, 0.035, 0.24, this.busPlayer, 1.6, this._panAt(p.targetX) * 0.4, 0.05, 0);
      if (!v) return;
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

    /** Attach: struck-iron clank with inharmonic partials; heavier and longer at speed. */
    _sfxAttach(p, heavy) {
      const an = p.anchor || EMPTY;
      const kind = an.kind;
      const delay = U.clamp(num(p.distance, 200) / 7000, 0.012, 0.07); // tether travel time
      const decayK = 1 + heavy * 0.9;
      const dur = delay + 0.04 + PARTIAL_TC[0] * decayK * 7;
      const v = this._begin('attach', 1, 0.03, dur, this.busPlayer, 0.52 + 0.3 * heavy, this._panAt(p.x) * 0.55, 0.1 + 0.12 * heavy, 0);
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
      if (heavy > 0.05) {
        // Weight of the catch: a low thunk.
        const lo = this._vOsc(v, 'sine', 105, t);
        lo.frequency.setTargetAtTime(55, t, 0.05);
        const lg = this._vGain(v, 0);
        this._perc(lg.gain, t, 0.5 * heavy, 0.003, 0.07);
        lo.connect(lg);
        lg.connect(v.out);
      }
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

    /** Miss: a whiff of the tether through air, then the slack line rattling back. */
    _sfxMiss(p) {
      const v = this._begin('miss', 1, 0.08, 0.6, this.busPlayer, 1.4, this._panAt(this._lx + num(p.dirX, 0) * 200) * 0.4, 0.08, 0);
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
    _sfxRelease(strength) {
      const v = this._begin('release', 1, 0.05, 0.25, this.busPlayer, 1.0 * strength, 0, 0.04, 0);
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
      const s = U.smoothstep(650, 1600, num(p.speed, 800));
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
      const pan = this._panAt(p.x) * 0.6;
      const dur = 1.3 + 0.6 * weight;
      const v = this._begin(weight > 1 ? 'crumble' : 'break', 2, 0.1, dur, this.busPlayer, weight > 1 ? 0.75 : 1.0, pan, 0.3, 0);
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

    /** Landing thump ∝ impact; hard landings add weight, grit and a grunt-like breath. */
    _sfxLand(impact, hard, x) {
      if (impact < 140) return;
      const s = U.smoothstep(140, 1150, impact);
      const v = this._begin('land', hard ? 2 : 1, 0.06, hard ? 1.1 : 0.75, this.busPlayer, 0.5 + 0.4 * s, this._panAt(x) * 0.3, 0.06 + 0.12 * s, 0);
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
      const s = U.smoothstep(320, 1200, num(p.impact, 400));
      const side = num(p.nx, 0) > 0 ? -1 : num(p.nx, 0) < 0 ? 1 : 0; // normal points away from the wall
      const v = this._begin('wall', 1, 0.08, 0.45, this.busPlayer, 0.45 + 0.4 * s, side * 0.45, 0.08, 0);
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
      const v = this._begin('grit', 0, 0.05, 0.25, this.busPlayer, 0.18 + 0.25 * stress, this._panAt(this._lx) + rand(-0.2, 0.2), 0.1, 0);
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

    /** Structural creak/groan: a resonant band of noise gliding, excited by slow stick-slip pulses. */
    _sfxCreak() {
      const dur = rand(1.0, 2.6);
      const lvl = rand(0.12, 0.3) * (0.7 + 0.3 * this._sec.creaks / 6);
      const v = this._begin('creak', 0, 0.5, dur + 1.6, this.busAmbient, lvl, rand(-0.85, 0.85), 0.55, 0);
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
      const v = this._begin('drip', 0, 0.1, 0.5, this.busAmbient, rand(0.05, 0.12), rand(-0.9, 0.9), 0.6, 0);
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
      const v = this._begin('settle', 0, 0.2, 0.7, this.busAmbient, rand(0.05, 0.11), rand(-0.8, 0.8), 0.45, 0);
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
    _sfxDebris(x) {
      const pan = x === x ? this._panAt(x) * 0.6 : rand(-0.6, 0.6);
      const v = this._begin('debris', 1, 0.3, 2.6, this.busAmbient, 0.9, pan, 0.3, 0);
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

    /** Limb planting: chitin/iron clicks plus a stone knock. */
    _sfxCreatureStep(p) {
      if (this._countAlive('cstep') >= 4) return;
      const sp = this._spatial(num(p.x, NaN), num(p.y, NaN), num(p.distance, NaN));
      const inten = U.clamp(num(p.intensity, 0.6), 0.1, 1);
      const lvl = 2.2 * sp.gain * (0.4 + 0.6 * inten);
      if (lvl < 0.02) return; // inaudible: do not spend a voice
      const v = this._begin('cstep', 0, 0.04, 0.4, this.busCreature, lvl, sp.pan, sp.send, sp.cutoff);
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
    _sfxCall(x, y, inten, far, dHint) {
      const sp = this._spatial(x, y, dHint);
      const lvl = (0.3 + 0.7 * inten) * Math.max(sp.gain, far ? 0.1 : 0.06);
      const v = this._begin('call', 2, 1.2, 4.2, this.busCreature, lvl, sp.pan, Math.max(sp.send, 0.45), Math.min(sp.cutoff + 400, 7000));
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
    _sfxBurst(x, y) {
      const sp = this._spatial(x, y, NaN);
      const v = this._begin('burst', 2, 0.5, 1.9, this.busCreature, Math.max(sp.gain, 0.05) * 1.4, sp.pan, sp.send, sp.cutoff + 600);
      if (!v) return;
      const t = v.t0;
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

    /** Attack: a wind-up screech-rattle rising into a heavy impact (W = wind-up seconds). */
    _sfxAttack(x, y, W, gate) {
      const sp = this._spatial(x, y, NaN);
      const v = this._begin('attack', 3, 0.3, W + (gate ? 3 : 1.6), this.busCreature, Math.max(sp.gain, 0.25), sp.pan, sp.send * 0.6, Math.max(sp.cutoff, 2500));
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
      // Impact.
      const ti = t + W;
      const lo = this._vOsc(v, 'sine', 70, ti);
      lo.frequency.setTargetAtTime(32, ti, 0.12);
      const lg = this._vGain(v, 0);
      this._perc(lg.gain, ti, 0.8, 0.003, 0.25);
      lo.connect(lg);
      lg.connect(v.out);
      const b = this._vNoise(v, this._brown, ti, 1);
      const lp = this._vFilter(v, 'lowpass', 1400, 0);
      const bg = this._vGain(v, 0);
      this._perc(bg.gain, ti, 0.7, 0.002, 0.18);
      b.connect(lp);
      lp.connect(bg);
      bg.connect(v.out);
      const n = this._vNoise(v, this._white, ti, 1);
      const hp = this._vFilter(v, 'highpass', 3000, 0);
      const ng = this._vGain(v, 0);
      this._perc(ng.gain, ti, 0.25, 0.001, 0.05);
      n.connect(hp);
      hp.connect(ng);
      ng.connect(v.out);
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

    /** Retreat: a scrape receding (closing low-pass, drifting outward) and a low groan sinking away. */
    _sfxRetreat(x, y) {
      const sp = this._spatial(x, y, NaN);
      const D = 3.4;
      const side = sp.pan >= 0 ? 1 : -1;
      const v = this._begin('retreat', 2, 1, D + 1, this.busCreature, Math.max(sp.gain, 0.08), 0, Math.max(sp.send, 0.5), 0);
      if (!v) return;
      const t = v.t0;
      // Recession: a per-voice low-pass that closes and a pan that drifts outward.
      const rec = this._vFilter(v, 'lowpass', Math.max(sp.cutoff, 1200), 0);
      rec.frequency.setValueAtTime(Math.max(sp.cutoff, 1200), t);
      rec.frequency.exponentialRampToValueAtTime(240, t + D);
      const pan = this._makePanner(sp.pan);
      v.nodes.push(pan);
      pan.connect(v.out);
      rec.connect(pan);
      if (pan.pan) {
        pan.pan.setValueAtTime(sp.pan, t);
        pan.pan.linearRampToValueAtTime(U.clamp(sp.pan + side * 0.5, -0.95, 0.95), t + D);
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
    _sfxSighting(x, y) {
      const sp = this._spatial(x, y, NaN);
      const v = this._begin('sighting', 2, 2, 7, this.busCreature, 0.2, U.clamp(sp.pan, -0.6, 0.6), 0.65, 1300);
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

  AT.AudioManager = AudioManager;
})((window.AT = window.AT || {}));
