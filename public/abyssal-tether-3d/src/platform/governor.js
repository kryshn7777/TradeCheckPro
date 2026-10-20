/* ABYSSAL TETHER 3D — governor.js
 * XR frame-time governor (RELEASE §14.2, VRC.Quest.Performance.1): keeps the headset at its 72 Hz target by lowering
 * render cost in steps when frames are missed, and recovering when there is sustained headroom.
 *
 * Levels (GOVERNOR_STEPS[level]); level 0 is the best picture, higher = cheaper:
 *   0  foveation 0.5   scale 1.0   fx 'quest'      (the Quest tier fx.js uses in XR by default)
 *   1  foveation 1.0   scale 1.0   fx 'quest'
 *   2  foveation 1.0   scale 0.9   fx 'quest'
 *   3  foveation 1.0   scale 0.8   fx 'low'        (fog cards, dust and debris streams thinned: settings.reducedEffects tier)
 *   4  foveation 1.0   scale 0.7   fx 'low'        (last resort)
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
 *   frame rate  session.updateTargetFrameRate(72) when supportedFrameRates lists it
 * Desktop keeps ui/perfDiag.js (adaptive pixel ratio); this governor acts only inside an XR session.
 *
 * Decision rules (all in seconds of frame time, so a 90 Hz headset works too):
 *   degrade  >= MISS_RATIO of the last WINDOW frames took longer than MISS_FACTOR x the target frame time
 *            (and at least MIN_MISSES of them), at most one step per DEGRADE_COOLDOWN
 *   recover  RECOVER_AFTER seconds with no miss and p95 <= HEADROOM x target, one step at a time; every
 *            recover that is undone by a degrade within FLAPPING seconds doubles RECOVER_AFTER (to MAX_RECOVER_AFTER)
 *   ignored  frames longer than HITCH_MS (loading, a suspended page, a system dialog) and frames while the game
 *            is not 'playing' / 'menu' / 'dead' (paused, victory)
 * sample() allocates nothing.
 */

export const GOVERNOR_STEPS = Object.freeze([
  Object.freeze({ level: 0, foveation: 0.5, scale: 1.0, fx: 'quest' }),
  Object.freeze({ level: 1, foveation: 1.0, scale: 1.0, fx: 'quest' }),
  Object.freeze({ level: 2, foveation: 1.0, scale: 0.9, fx: 'quest' }),
  Object.freeze({ level: 3, foveation: 1.0, scale: 0.8, fx: 'low' }),
  Object.freeze({ level: 4, foveation: 1.0, scale: 0.7, fx: 'low' }),
]);
export const REDUCED_FLOOR = 3;

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

export class QualityGovernor {
  /**
   * @param {object} game     Game3D (reads renderer.renderer.xr, settings, state, xrActive; emits bus 'quality:level')
   * @param {object} [o]
   * @param {number} [o.targetHz=72]
   * @param {string} [o.mode='auto']   'auto' | 'off' | 'pin'
   * @param {number} [o.level=0]       starting / pinned level
   */
  constructor(game, { targetHz = 72, mode = 'auto', level = 0 } = {}) {
    this.game = game;
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

  /** XR session started: begin governing, request the frame rate, apply the current level. */
  onSessionStart(session) {
    this.active = this.mode !== 'off';
    this._reset();
    if (this.level < this.floorLevel) this.level = this.floorLevel;
    this._apply(true);
    this._requestFrameRate(session);
    this._pendingScale = true; // viewport scale needs a frame to be applied
  }

  onSessionEnd() {
    this.active = false;
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

  _requestFrameRate(session) {
    if (!session || this._rateRequested === session) return;
    this._rateRequested = session;
    try {
      const rates = session.supportedFrameRates;
      if (rates && typeof session.updateTargetFrameRate === 'function') {
        let want = 0;
        for (let i = 0; i < rates.length; i++) if (Math.abs(rates[i] - this.targetHz) < 0.5) want = rates[i];
        if (want) {
          const p = session.updateTargetFrameRate(want);
          if (p && typeof p.catch === 'function') p.catch(() => {});
          this.stats.requestedHz = want;
        }
      }
    } catch {
      /* optional */
    }
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
    if (st !== 'playing' && st !== 'menu' && st !== 'dead') {
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
      stats: Object.assign({}, this.stats),
      history: this.history.slice(-8),
    };
  }
}
