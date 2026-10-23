/* ABYSSAL TETHER 3D — governor.js
 * XR frame-time governor (RELEASE §14.2, VRC.Quest.Performance.1): keeps the headset at its 72 Hz target by lowering
 * render cost in steps when frames are missed, and recovering when there is sustained headroom.
 *
 * Levels (GOVERNOR_STEPS[level]); level 0 is the best picture, higher = cheaper:
 *   0  foveation 0.5   scale 1.0   fx 'quest'      (the Quest tier fx.js uses in XR by default)
 *   1  foveation 1.0   scale 1.0   fx 'quest'
 *   2  foveation 1.0   scale 0.9   fx 'quest'
 *   3  foveation 1.0   scale 0.8   fx 'quest'
 *   4  foveation 1.0   scale 0.7   fx 'quest'      (last resort)
 *
 * The governor only trades RESOLUTION (foveation, viewport scale) for frame time. It never touches the picture itself: the fog,
 * the god rays, the dust, the lantern shadow and the surface detail are the same at every level. (They used to be thinned at
 * level 3, which took the whole atmosphere away a few seconds after the start on a headset that misses frames.) Only the player's
 * own settings.reducedEffects lowers the effects.
 *
 * Quality tiers and settings (the semantics fx.js / atmosphere.js / debris.js already implement):
 *   - settings.reducedEffects === true  -> the player asked for minimal effects: the governor never goes below
 *     level REDUCED_FLOOR (3) and the fx tier is 'low' from the start (fx.js: tier 0).
 *   - otherwise the governor writes settings.fxQuality ('quest' | 'low'), which fx.js reads as a forced tier, in
 *     memory only (it deletes the key again on recovery; loadSettings ignores unknown keys).
 *   - ?gov=off disables it, ?gov=N pins level N (QA), ?gov=auto is the default.
 *
 * Where each lever is available:
 *   foveation   renderer.xr.setFoveation(v)                     every XR session
 *   scale       XRView.requestViewportScale(s) (WebXR viewport scaling), applied through the current XRFrame;
 *               where the runtime lacks it the step is recorded but only the other levers act
 *   frame rate  session.updateTargetFrameRate(72 | 90) when supportedFrameRates lists it. settings.frameRate '72' (default) | '90' | 'auto':
 *               '90' asks for 90 Hz when the session supports it (else 72); 'auto' starts at 90 Hz when supported and falls back to 72
 *               for the rest of the session on the first sustained overrun (before any picture step: 72 Hz at full quality beats 90 Hz
 *               at a lower level). The frame-time targets of the miss / recover rules follow the applied rate. Changing the setting
 *               mid-session (bus 'settings:changed', or setFrameRate()) re-requests the rate. UX hook: settings.frameRate (config3d.js,
 *               UX_LIMITS.frameRates).
 * Desktop keeps ui/perfDiag.js (adaptive pixel ratio); this governor acts only inside an XR session.
 *
 * Decision rules (all in seconds of frame time, so a 90 Hz headset works too):
 *   degrade  >= MISS_RATIO of the last WINDOW frames took longer than MISS_FACTOR x the target frame time
 *            (and at least MIN_MISSES of them), at most one step per DEGRADE_COOLDOWN
 *   recover  RECOVER_AFTER seconds with no miss and p95 <= HEADROOM x target, one step at a time; every
 *            recover that is undone by a degrade within FLAPPING seconds doubles RECOVER_AFTER (to MAX_RECOVER_AFTER)
 *   warm-up  no frame counts for WARMUP seconds after a session start and after play begins or resumes (menu / pause / death -> playing),
 *            nor while the level is still being dressed: the load spikes of a start (shader programs, texture and lightmap uploads, the
 *            dressing job) are not the steady cost of the picture, and a step taken for them took the god rays and the fog away
 *            seconds after the start, for 10+ s of recovery
 *   ignored  frames longer than HITCH_MS (loading, a suspended page, a system dialog) and frames while the game
 *            is not 'playing' / 'dead' (the menu, paused, victory: the menu is a still room, a step taken there only blurred the picture seconds after opening it)
 * sample() allocates nothing.
 */

export const GOVERNOR_STEPS = Object.freeze([
  Object.freeze({ level: 0, tier: 'quest', foveation: 0.5, scale: 1.0, fx: 'quest' }),
  Object.freeze({ level: 1, tier: 'quest', foveation: 1.0, scale: 1.0, fx: 'quest' }),
  Object.freeze({ level: 2, tier: 'quest', foveation: 1.0, scale: 0.9, fx: 'quest' }),
  Object.freeze({ level: 3, tier: 'quest', foveation: 1.0, scale: 0.8, fx: 'quest' }),
  Object.freeze({ level: 4, tier: 'quest', foveation: 1.0, scale: 0.7, fx: 'quest' }),
]);
export const REDUCED_FLOOR = 3;
/** Frame rates the game asks the headset for (Quest 3: 72 default, 90 optional). */
export const FRAME_RATES = Object.freeze([72, 90]);
/** The setting values (config3d.js UX_LIMITS.frameRates): strings, like the other enum settings. */
export const FRAME_RATE_MODES = Object.freeze(['72', '90', 'auto']);

/** Normalises a settings value (72 / '72' / 90 / 'auto' / garbage) to '72' | '90' | 'auto'. Pure. */
export function normalizeFrameRateMode(v) {
  if (v === 'auto') return 'auto';
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return n === 90 ? '90' : '72';
}

/**
 * The rate to request for a mode given the rates the session lists. Pure.
 * @returns {number} 0 when the session lists none of ours (leave the runtime default)
 */
export function pickFrameRate(mode, supported, fellBack = false) {
  const list = supported ? Array.from(supported) : [];
  const has = (hz) => list.some((r) => Math.abs(r - hz) < 0.5);
  const want90 = (mode === '90' || (mode === 'auto' && !fellBack)) && has(90);
  if (want90) return 90;
  return has(72) ? 72 : 0;
}

const WINDOW = 72; // frames in the sliding window (1 s at 72 Hz)
const MISS_FACTOR = 1.3;
const MISS_RATIO = 0.18;
const MIN_MISSES = 6;
const DEGRADE_COOLDOWN = 1.5;
const RECOVER_AFTER = 10;
const MAX_RECOVER_AFTER = 160;
const FLAPPING = 25;
const HEADROOM = 1.08;
const HITCH_MS = 250;
const WARMUP = 5; // seconds: see the header (option `warmup`, 0 turns it off)

export class QualityGovernor {
  /**
   * @param {object} game     Game3D (reads renderer.renderer.xr, settings, state, xrActive; emits bus 'quality:level')
   * @param {object} [o]
   * @param {number} [o.targetHz=72]
   * @param {string} [o.mode='auto']   'auto' | 'off' | 'pin'
   * @param {number} [o.level=0]       starting / pinned level
   */
  constructor(game, { targetHz = 72, mode = 'auto', level = 0, warmup = WARMUP } = {}) {
    this.game = game;
    this.warmup = Math.max(0, +warmup || 0);
    this._graceUntil = 0; // governor clock time until which frames do not count
    this._lastState = null;
    this.targetHz = targetHz;
    this.target = 1 / targetHz;
    this.mode = mode;
    this.level = Math.max(0, Math.min(GOVERNOR_STEPS.length - 1, level | 0));
    this.pinned = mode === 'pin';
    this.active = false;
    this.history = []; // [{ t, from, to, why }] (bounded)
    this.stats = { frames: 0, misses: 0, degrades: 0, recovers: 0, hitches: 0, p95: 0, avgMs: 0 };

    this._ring = new Float32Array(WINDOW);
    this._sorted = new Float32Array(WINDOW);
    this._n = 0;
    this._head = 0;
    this._missCount = 0;
    this._clock = 0;
    this._lastDegrade = -1e9;
    this._stableSince = 0; // last miss, level change, hitch or pause: recovery needs RECOVER_AFTER s of calm after it
    this._recoveredAt = -1e9;
    this._recoverAfter = RECOVER_AFTER;
    this._appliedFov = NaN;
    this._appliedScale = NaN;
    this._appliedFx = null;
    this._frameForScale = null;
    this._pendingScale = false;
    this._rateRequested = false;
    this._stepListeners = [];
    this._rateMode = normalizeFrameRateMode(game && game.settings ? game.settings.frameRate : '72'); // '72' | '90' | 'auto'
    this._rateHz = targetHz; // the rate the frame-time rules currently assume
    this._rateFellBack = false; // 'auto' gave up on 90 Hz this session
    this._session = null;
    if (game && game.bus && typeof game.bus.on === 'function') {
      game.bus.on('settings:changed', (e) => {
        const st = e && e.settings ? e.settings : game.settings;
        if (st && st.frameRate !== undefined) this.setFrameRate(st.frameRate);
      });
    }
  }

  /** Reads ?gov= . Pure (Node-testable). */
  static modeFromSearch(search) {
    let v = null;
    try {
      v = new URLSearchParams(search || '').get('gov');
    } catch {
      /* ignore */
    }
    if (v === 'off' || v === '0') return { mode: 'off', level: 0 };
    if (v != null && /^[0-4]$/.test(v)) return { mode: 'pin', level: Number(v) };
    return { mode: 'auto', level: 0 };
  }

  get step() {
    return GOVERNOR_STEPS[this.level];
  }

  /** Lowest level the governor may take (reduced effects pins the fx tier to 'low'). */
  get floorLevel() {
    return this._reduced() ? REDUCED_FLOOR : 0;
  }

  _reduced() {
    const s = this.game && this.game.settings;
    return !!(s && s.reducedEffects);
  }

  _xr() {
    const r = this.game && this.game.renderer && this.game.renderer.renderer;
    return r && r.xr ? r.xr : null;
  }

  /**
   * Plug-in API for the render quality tiers (WP-GFX):
   *   game.governor.onFrame(frameMs)            feed one frame time in milliseconds (the game loop already calls
   *                                             sample(dt, frame) in XR; call this instead when you own the timing)
   *   game.governor.onStep(fn) -> unsubscribe   fn(tier, foveation, scale, level, why) on every level change;
   *                                             tier is 'quest' | 'low' (the render tier names fx.js / renderer use)
   * When the renderer has setQualityTier(tier) it is called on every change too, in addition to settings.fxQuality.
   */
  onFrame(frameMs) {
    return this.sample(frameMs / 1000, null);
  }

  onStep(fn) {
    if (typeof fn !== 'function') return () => {};
    this._stepListeners.push(fn);
    return () => {
      const i = this._stepListeners.indexOf(fn);
      if (i >= 0) this._stepListeners.splice(i, 1);
    };
  }

  /** XR session started: begin governing, request the frame rate, apply the current level. */
  onSessionStart(session) {
    this.active = this.mode !== 'off';
    this._reset();
    this._graceUntil = this._clock + this.warmup;
    this._lastState = null;
    if (this.level < this.floorLevel) this.level = this.floorLevel;
    this._apply(true);
    this._requestFrameRate(session);
    this._pendingScale = true; // viewport scale needs a frame to be applied
  }

  onSessionEnd() {
    this.active = false;
    this._session = null;
    this._rateRequested = false;
    this._rateFellBack = false; // a new session tries 90 Hz again in 'auto'
    this._reset();
    // Back on the desktop path: no foveation / fx override stays behind.
    this._appliedFov = NaN;
    this._appliedScale = NaN;
    this._clearFx();
  }

  _reset() {
    this._n = 0;
    this._head = 0;
    this._missCount = 0;
    this._stableSince = this._clock;
  }

  /**
   * Sets the frame-rate mode ('72' | '90' | 'auto', also 72 / 90 numbers) and, in a session, asks the runtime for it. A change of
   * mode clears the 'auto' fallback. Returns the rate now requested (0 = none requested).
   */
  setFrameRate(mode) {
    const m = normalizeFrameRateMode(mode);
    if (m !== this._rateMode) this._rateFellBack = false;
    this._rateMode = m;
    if (this._session) {
      this._rateRequested = false;
      return this._requestFrameRate(this._session);
    }
    return 0;
  }

  get frameRateMode() {
    return this._rateMode;
  }

  _requestFrameRate(session) {
    if (!session || this._rateRequested === session) return 0;
    this._session = session;
    this._rateRequested = session;
    const s = this.game && this.game.settings;
    if (s && s.frameRate !== undefined) this._rateMode = normalizeFrameRateMode(s.frameRate);
    let want = 0;
    try {
      want = pickFrameRate(this._rateMode, session.supportedFrameRates, this._rateFellBack);
      if (want && typeof session.updateTargetFrameRate === 'function') {
        const p = session.updateTargetFrameRate(want);
        if (p && typeof p.catch === 'function') p.catch(() => {});
        this.stats.requestedHz = want;
      } else if (!want) {
        want = 0;
      }
    } catch {
      /* optional */
    }
    // the miss / recover rules measure against the rate the headset was asked for (72 if it was not asked for anything)
    this._setTargetHz(want || 72);
    return want;
  }

  _setTargetHz(hz) {
    if (hz === this._rateHz && this.target === 1 / hz) return;
    this._rateHz = hz;
    this.targetHz = hz;
    this.target = 1 / hz;
    this._reset();
    const r3d = this.game && this.game.renderer;
    if (r3d && r3d.governor && typeof r3d.governor.setTargetHz === 'function') r3d.governor.setTargetHz(hz);
    if (this.game && this.game.bus && typeof this.game.bus.emit === 'function') this.game.bus.emit('quality:rate', { hz, mode: this._rateMode, fellBack: this._rateFellBack });
  }

  /**
   * One call per XR frame (Game3D._loop). dt in seconds (real frame delta), frame = the XRFrame (or null).
   * Returns true when a level change happened.
   */
  sample(dt, frame) {
    if (!this.active) return false;
    this._clock += dt;
    if (this._pendingScale && frame) this._applyScale(frame);
    if (this.pinned) return false;
    const ms = dt * 1000;
    if (!(dt > 0)) return false;
    if (ms > HITCH_MS) {
      this.stats.hitches++;
      this._reset();
      return false;
    }
    const st = this.game.state;
    if (st !== 'playing' && st !== 'dead') {
      this._lastState = st;
      this._reset();
      return false;
    }
    // warm-up: play begins (or resumes) -> the load spikes of the start do not count; nor does a level that is still being dressed
    if (st !== this._lastState) {
      if (st === 'playing' && this._lastState !== null) this._graceUntil = Math.max(this._graceUntil, this._clock + this.warmup);
      this._lastState = st;
    }
    const lv = this.game.renderer && this.game.renderer.levelView;
    if (this._clock < this._graceUntil || (lv && lv.dressing === true)) {
      this.stats.warmupFrames = (this.stats.warmupFrames || 0) + 1;
      this._reset();
      return false;
    }
    // sliding window
    const old = this._n === WINDOW ? this._ring[this._head] : 0;
    if (this._n === WINDOW && old > this.target * MISS_FACTOR) this._missCount--;
    this._ring[this._head] = dt;
    this._head = (this._head + 1) % WINDOW;
    if (this._n < WINDOW) this._n++;
    const miss = dt > this.target * MISS_FACTOR;
    if (miss) {
      this._missCount++;
      this._stableSince = this._clock;
      this.stats.misses++;
    }
    this.stats.frames++;
    this.stats.avgMs += (ms - this.stats.avgMs) * 0.02;
    if (this._n < WINDOW / 2) return false;

    // degrade
    if (this._missCount >= MIN_MISSES && this._missCount / this._n >= MISS_RATIO && this._clock - this._lastDegrade >= DEGRADE_COOLDOWN) {
      if (this._rateMode === 'auto' && this._rateHz === 90 && !this._rateFellBack && this._session) {
        // sustained overrun at 90 Hz: 72 Hz at the current picture first (a steady 72 beats a ragged 90), no picture step yet
        this._rateFellBack = true;
        this._lastDegrade = this._clock;
        this._rateRequested = false;
        this._requestFrameRate(this._session);
        this.stats.rateFallbacks = (this.stats.rateFallbacks || 0) + 1;
        return true;
      }
      if (this.level < GOVERNOR_STEPS.length - 1) {
        // a recover that did not hold: wait longer next time
        if (this._clock - this._recoveredAt < FLAPPING) this._recoverAfter = Math.min(MAX_RECOVER_AFTER, this._recoverAfter * 2);
        this._setLevel(this.level + 1, 'degrade');
        this.stats.degrades++;
        this._lastDegrade = this._clock;
        return true;
      }
      this._lastDegrade = this._clock;
      return false;
    }

    // recover
    if (this.level > this.floorLevel && this._clock - this._stableSince >= this._recoverAfter) {
      const p95 = this._percentile(0.95);
      this.stats.p95 = p95 * 1000;
      if (p95 <= this.target * HEADROOM) {
        this._setLevel(this.level - 1, 'recover');
        this.stats.recovers++;
        this._recoveredAt = this._clock;
        return true;
      }
    }
    return false;
  }

  _percentile(q) {
    const n = this._n;
    const s = this._sorted;
    for (let i = 0; i < n; i++) s[i] = this._ring[i];
    // insertion sort over <= 72 floats: no allocation
    for (let i = 1; i < n; i++) {
      const v = s[i];
      let j = i - 1;
      while (j >= 0 && s[j] > v) {
        s[j + 1] = s[j];
        j--;
      }
      s[j + 1] = v;
    }
    return s[Math.min(n - 1, Math.floor(q * n))];
  }

  /** Forces a level (QA, tests, settings). */
  setLevel(level, why = 'manual') {
    level = Math.max(this.floorLevel, Math.min(GOVERNOR_STEPS.length - 1, level | 0));
    if (level !== this.level) this._setLevel(level, why);
    return this.level;
  }

  _setLevel(level, why) {
    const from = this.level;
    this.level = level;
    if (this.history.length >= 64) this.history.shift();
    this.history.push({ t: Math.round(this._clock * 100) / 100, from, to: level, why });
    this._reset();
    this._apply(false);
    this._pendingScale = true;
    const g = this.game;
    if (g && g.bus) g.bus.emit('quality:level', { level, from, why, step: GOVERNOR_STEPS[level] });
    const st = GOVERNOR_STEPS[level];
    const r3d = g && g.renderer;
    if (r3d && typeof r3d.setQualityTier === 'function') {
      try {
        r3d.setQualityTier(st.tier);
      } catch {
        /* optional hook */
      }
    }
    for (const fn of this._stepListeners.slice()) {
      try {
        fn(st.tier, st.foveation, st.scale, level, why);
      } catch {
        /* a listener must not break the governor */
      }
    }
  }

  /** Applies foveation + fx tier of the current level (cheap; scale waits for a frame). */
  _apply() {
    const step = this.step;
    const xr = this._xr();
    if (xr && typeof xr.setFoveation === 'function' && step.foveation !== this._appliedFov) {
      try {
        xr.setFoveation(step.foveation);
        this._appliedFov = step.foveation;
      } catch {
        /* layer without foveation */
      }
    }
    const s = this.game && this.game.settings;
    if (s) {
      if (this._reduced()) {
        this._appliedFx = 'reduced'; // the player's own choice already forces fx tier 0 in fx.js
      } else if (step.fx !== this._appliedFx) {
        s.fxQuality = step.fx; // fx.js TIER_NAMES: 'low' -> 0, 'quest' -> 1
        this._appliedFx = step.fx;
      }
    }
  }

  _clearFx() {
    const s = this.game && this.game.settings;
    if (s && this._appliedFx && this._appliedFx !== 'reduced' && s.fxQuality === this._appliedFx) delete s.fxQuality;
    this._appliedFx = null;
  }

  /** Viewport scale through WebXR viewport scaling, using the current frame's views. */
  _applyScale(frame) {
    this._pendingScale = false;
    const step = this.step;
    if (step.scale === this._appliedScale) return;
    try {
      const xr = this._xr();
      const space = xr && typeof xr.getReferenceSpace === 'function' ? xr.getReferenceSpace() : null;
      const pose = space && frame && typeof frame.getViewerPose === 'function' ? frame.getViewerPose(space) : null;
      let applied = false;
      if (pose && pose.views) {
        for (let i = 0; i < pose.views.length; i++) {
          const v = pose.views[i];
          if (v && typeof v.requestViewportScale === 'function') {
            v.requestViewportScale(step.scale);
            applied = true;
          }
        }
      }
      this._appliedScale = step.scale;
      this.scaleSupported = applied || this.scaleSupported === true;
    } catch {
      this._appliedScale = step.scale;
    }
  }

  /** Snapshot for the debug API / overlay. */
  report() {
    const st = this.step;
    return {
      mode: this.mode,
      active: this.active,
      level: this.level,
      foveation: st.foveation,
      scale: st.scale,
      scaleSupported: !!this.scaleSupported,
      fx: this._reduced() ? 'reduced' : st.fx,
      missRatio: this._n ? this._missCount / this._n : 0,
      recoverAfter: this._recoverAfter,
      frameRate: { mode: this._rateMode, hz: this._rateHz, fellBack: this._rateFellBack, supported: this._session ? Array.from(this._session.supportedFrameRates || []) : [] },
      stats: Object.assign({}, this.stats),
      history: this.history.slice(-8),
    };
  }
}
