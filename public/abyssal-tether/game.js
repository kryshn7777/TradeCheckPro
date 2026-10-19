/* ABYSSAL TETHER — game.js
 * The integrator. AT.Game owns the requestAnimationFrame loop and the game
 * state machine (menu attract → playing ⇄ paused → dead → respawn / restart →
 * victory). It builds a run from a difficulty preset, steps the fixed-rate
 * physics with render interpolation, routes bus events into feedback (camera
 * shake, screen flash, haptics), tracks sections / checkpoints / hints /
 * triggers / the goal, keeps the canvas sized (DPR cap + dynamic resolution)
 * and exposes the AT.debug API used by automated tests.
 *
 * Robustness: the core (level, physics, camera, input) is required; every
 * optional subsystem (audio, particles, threat, creature, renderer, UI) is
 * guarded — if one fails to construct, or keeps throwing at runtime, the game
 * keeps running without it (null objects / a minimal fallback renderer).
 *
 * The bootstrap at the bottom creates AT.game once the DOM is ready and shows
 * a readable error overlay if the game cannot start.
 */
(function (AT) {
  'use strict';

  const U = AT.util;
  const C = AT.CONFIG;

  // ---------------------------------------------------------------------------
  // Tuning (seconds unless noted).
  // ---------------------------------------------------------------------------
  const DEATH_SCREEN_DELAY = 0.45; // death → death screen (and earliest key respawn)
  const VICTORY_DELAY = 2.6; // goal reached → victory screen (gate slam plays out)
  const SLAM_SHAKE_DELAY = 0.3; // creature:attack (wind-up) → gate impact shake
  const HINT_DEFAULT_SECONDS = 5.5;
  const HINT_GAP = 3; // minimum time a hint stays before a queued one replaces it
  const HINT_QUEUE_MAX = 3;
  const ATTRACT_SPEED = 34; // menu camera descent (u/s)
  const ATTRACT_FADE_OUT = 1.4;
  const ATTRACT_FADE_IN = 1.8;
  const DEATH_FADE_MAX = 0.62;
  const RESPAWN_FADE = 0.85;
  const RESTART_FADE = 0.55;
  const CREATURE_HAPTIC_RANGE = 650; // creature lunge closer than this buzzes the phone
  const FAULT_LOG_LIMIT = 3; // console errors logged per failing subsystem
  const RENDER_FAULT_SWAP = 20; // consecutive renderer failures before the fallback takes over
  const FATAL_FRAME_ERRORS = 90; // consecutive failed frames before giving up with an overlay
  const MAX_DEBUG_STEP_FRAMES = 60 * 600;

  /** Dynamic resolution: lower the backing-store scale when frames are slow. */
  const DYN_RES = {
    slowFrame: 0.024, // EMA frame time above this counts as slow (~41 fps)
    fastFrame: 0.0185, // below this counts as fast (~54 fps)
    slowHold: 2, // seconds of sustained slowness before stepping down
    fastHold: 8, // seconds of sustained speed before stepping back up (doubles on flip-flop)
    step: 0.1,
    min: 0.6,
    max: 1,
  };

  /** Short, original death lines per cause (picked round-robin by death count). */
  const DEATH_MESSAGES = {
    impact: [
      'The floor came up faster than the line.',
      'Stone keeps no promises.',
      'Too far. Too fast.',
      'The Underspire caught you. Badly.',
    ],
    hazard: ['The old ironwork was still sharp.', 'The Lanternwrights left their edges keen.', 'Rust and teeth.'],
    fall: ['The dark took all of you.', 'Down past where the light can follow.', 'No line. No floor.'],
    creature: [
      'It found you.',
      'The walls closed their hand.',
      'It was never far. Only patient.',
      'The structure learned your shape.',
    ],
  };

  const EDGE_KEYS = [
    'jumpPressed',
    'grapplePressed',
    'grappleReleased',
    'grappleTap',
    'pausePressed',
    'restartPressed',
    'confirmPressed',
    'respawnPressed',
    'anyPressed',
  ];

  function nowMs() {
    return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
  }

  function finiteOr(v, fallback) {
    return typeof v === 'number' && isFinite(v) ? v : fallback;
  }

  function blankIntent() {
    return {
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
  }

  /**
   * A view of the main bus for per-run objects (creature, grapple, physics):
   * emits and handlers go to the shared bus, but every subscription made
   * through it is remembered so the whole scope can be detached when the run
   * objects are replaced (no listener leaks across restarts).
   */
  function scopedBus(bus) {
    const offs = [];
    const scope = Object.create(bus);
    scope.on = function (type, fn) {
      const off = bus.on(type, fn);
      offs.push(off);
      return off;
    };
    scope.clear = function () {
      scope.dispose();
    };
    scope.dispose = function () {
      for (let i = 0; i < offs.length; i++) offs[i]();
      offs.length = 0;
    };
    return scope;
  }

  /** Copy of a difficulty preset whose creature never enters play (menu attract). */
  function inactiveDiff(diff) {
    return Object.assign({}, diff, { creature: Object.assign({}, diff.creature, { enabled: false }) });
  }

  // ---------------------------------------------------------------------------
  // Null objects — stand-ins for optional subsystems that failed to load.
  // ---------------------------------------------------------------------------
  function nullAudio() {
    return { enabled: false, isNull: true, unlock() {}, setVolume() {}, setPaused() {}, update() {}, stopAll() {} };
  }

  function nullParticles() {
    return { isNull: true, reset() {}, update() {}, render() {}, burst() {} };
  }

  function nullThreat() {
    return {
      isNull: true,
      value: 0,
      raw: 0,
      components: { creature: 0, falling: 0, burst: 0, stillness: 0 },
      heartRate: 60,
      beat: 0,
      beatPulse: 0,
      reset() {},
      update() {},
    };
  }

  function nullCreature() {
    const far = -1e6;
    return {
      isNull: true,
      state: 'DORMANT',
      stamina: 1,
      x: 0,
      y: far,
      vx: 0,
      vy: 0,
      distance: 1e9,
      active: false,
      lethal: false,
      caughtPlayer: false,
      sighting: null,
      audio: { x: 0, y: far, distance: 1e9, intensity: 0, movement: 0, state: 'DORMANT' },
      reset() {},
      setSection() {},
      onRespawn() {},
      onVictory() {},
      update() {},
      render() {},
      renderFar() {},
      renderGlow() {},
    };
  }

  function nullUI() {
    return {
      isNull: true,
      current: null,
      init() {},
      show(name) {
        this.current = name;
      },
      updateHUD() {},
      showHint() {},
      hideHint() {},
      showSectionTitle() {},
      showToast() {},
      showDeath() {
        this.current = 'death';
      },
      showVictory() {
        this.current = 'victory';
      },
      refreshMenu() {},
      setTouchMode() {},
    };
  }

  // ---------------------------------------------------------------------------
  // FallbackRenderer — flat, minimal drawing used only when AT.Renderer is
  // unavailable or keeps failing, so the game stays playable.
  // ---------------------------------------------------------------------------
  class FallbackRenderer {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      if (!this.ctx) throw new Error('Canvas 2D is not available in this browser.');
      this.isFallback = true;
      this.w = 1;
      this.h = 1;
      this.dpr = 1;
      this._solids = [];
      this._hazards = [];
      this._anchors = [];
    }

    resize(cssW, cssH, dpr) {
      this.w = cssW;
      this.h = cssH;
      this.dpr = dpr;
      this.canvas.width = Math.max(1, Math.round(cssW * dpr));
      this.canvas.height = Math.max(1, Math.round(cssH * dpr));
    }

    render(game) {
      const ctx = this.ctx;
      const cv = this.canvas;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0e1113';
      ctx.fillRect(0, 0, cv.width, cv.height);
      const cam = game.camera;
      const lvl = game.level;
      if (!cam || !lvl || !(cam.scale > 0)) return;
      const k = cam.scale * this.dpr;
      ctx.setTransform(k, 0, 0, k, (this.w / 2 - cam.x * cam.scale) * this.dpr, (this.h / 2 - cam.y * cam.scale) * this.dpr);
      const hw = this.w / 2 / cam.scale + 40;
      const hh = this.h / 2 / cam.scale + 40;
      const x0 = cam.x - hw;
      const x1 = cam.x + hw;
      const y0 = cam.y - hh;
      const y1 = cam.y + hh;

      const solids = lvl.querySolids(x0, y0, x1, y1, this._solids);
      for (let i = 0; i < solids.length; i++) {
        const s = solids[i];
        if (s.active === false) continue;
        ctx.fillStyle = s.kind === 'wall' ? '#22282c' : s.kind === 'crumble' ? '#4a3a2c' : '#3a4146';
        ctx.fillRect(s.x, s.y, s.w, s.h);
      }
      const hazards = lvl.queryHazards(x0, y0, x1, y1, this._hazards);
      ctx.fillStyle = '#7a3b22';
      for (let i = 0; i < hazards.length; i++) {
        const h = hazards[i];
        if (h.active !== false) ctx.fillRect(h.x, h.y, h.w, h.h);
      }

      const g = game.grapple;
      const anchors = lvl.anchorsNear(cam.x, cam.y, Math.max(hw, hh), this._anchors);
      ctx.lineWidth = 3;
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i];
        ctx.strokeStyle = a.broken ? '#4d4a44' : a.kind === 'fragile' ? '#c9a46a' : '#e8dcc0';
        ctx.beginPath();
        ctx.arc(a.x, a.y, a.kind === 'hook' ? 7 : 9, 0, Math.PI * 2);
        ctx.stroke();
      }
      const p = game.player;
      if (g && g.target && !g.anchor) {
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(g.target.x, g.target.y, 16, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (p && g && g.anchor && p.alive) {
        ctx.strokeStyle = '#d8c8a0';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p.rx, p.ry);
        ctx.lineTo(g.anchor.x, g.anchor.y);
        ctx.stroke();
      }
      if (p && p.alive && !game.hidePlayer) {
        ctx.fillStyle = '#e0a050';
        ctx.beginPath();
        ctx.arc(p.rx, p.ry, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      const c = game.creature;
      if (c && c.active && isFinite(c.x) && isFinite(c.y)) {
        ctx.fillStyle = '#b8f0e0';
        ctx.beginPath();
        ctx.arc(c.x, c.y, 26, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (game.deathFade > 0) {
        ctx.globalAlpha = U.clamp(game.deathFade, 0, 1);
        ctx.fillStyle = '#000000';
        ctx.fillRect(0, 0, cv.width, cv.height);
      }
      if (game.flash > 0) {
        ctx.globalAlpha = U.clamp(game.flash, 0, 1) * 0.6;
        ctx.fillStyle = '#e8dcc0';
        ctx.fillRect(0, 0, cv.width, cv.height);
      }
      ctx.globalAlpha = 1;
    }
  }

  // ===========================================================================
  // Game
  // ===========================================================================
  class Game {
    /** @param {HTMLCanvasElement} canvas the single gameplay canvas */
    constructor(canvas) {
      this.canvas = canvas;

      // ---- public fields other modules may read (CONTRACT §14) ---------------
      this.state = 'menu';
      this.difficultyKey = 'normal';
      this.diff = AT.DIFFICULTY.normal;
      this.settings = null;
      this.bus = null;
      this.level = null;
      this.player = null;
      this.grapple = null;
      this.physics = null;
      this.camera = null;
      this.input = null;
      this.creature = null;
      this.threat = null;
      this.particles = null;
      this.audio = null;
      this.renderer = null;
      this.ui = null;
      this.time = 0;
      this.realTime = 0;
      this.deaths = 0;
      this.sectionIndex = 0;
      this.aimWorld = null;
      this.flash = 0;
      this.deathFade = 0;
      this.victoryT = -1;
      this.isTouch = false;
      this.deepest = 0;

      // ---- extra read-only fields ----------------------------------------------
      this.hidePlayer = true; // renderer hides the player (menu attract)
      this.aimMode = null; // 'point' | 'dir' | null — how aimWorld was derived
      this.alpha = 0; // physics interpolation factor of the current frame
      this.checkpoint = { x: 0, y: 0, index: 0 };
      this.fps = 60;
      this.renderScale = 1; // dynamic-resolution multiplier on the DPR (0.6..1)
      this.dpr = 1; // effective backing-store pixels per CSS px
      this.cssW = 0;
      this.cssH = 0;
      this.booted = false;

      // ---- private state ------------------------------------------------------
      this._raf = null;
      this._rafId = 0;
      this._lastTs = null;
      this._loopFn = (ts) => this.loop(ts);
      this._acc = 0;
      this._pendingJump = false;
      this._stepIntent = { moveX: 0, moveY: 0, jumpPressed: false };
      this._aimPoint = { mode: 'point', x: 0, y: 0, touch: false };
      this._aimDir = { mode: 'dir', dx: 0, dy: 1 };
      this._aimWorldObj = { x: 0, y: 0 };
      this._screenTmp = { x: 0, y: 0 };
      this._threatCtx = { player: null, creature: null, grapple: null, diff: null, level: null };
      this._runBus = null;
      this._runClock = 0;
      this._creatureSection = -1;
      this._seen = [];
      this._hintList = [];
      this._triggerList = [];
      this._hintCursor = 0;
      this._triggerCursor = 0;
      this._hintQueue = [];
      this._hintCooldown = 0;
      this._deathT = 0;
      this._deathShown = false;
      this._deathCause = null;
      this._slamT = 0;
      this._attract = { y: 0, t: 0, fading: 0 };
      this._lastSource = null;
      this._endState = null;
      this._endUi = undefined;
      this._needsResize = true;
      this._sized = { w: -1, h: -1, dpr: -1 };
      this._frameAvg = 1 / 60;
      this._slowT = 0;
      this._fastT = 0;
      this._fastHold = DYN_RES.fastHold;
      this._lastUpscaleAt = -1e9;
      this._faults = Object.create(null);
      this._renderFaults = 0;
      this._frameErrors = 0;
      this._godMode = false;
      this._frozen = false;
      this._override = null;
      this._ovIntent = blankIntent();
      this._blank = blankIntent();
      this._uiFallback = false;
    }

    // =========================================================================
    // Boot
    // =========================================================================

    /**
     * Creates every subsystem, the menu attract scene and starts the loop.
     * Throws only if a core module (level / physics / camera / input) fails.
     */
    boot() {
      if (this.booted) return;
      const S = AT.Storage;
      this.settings = S.loadSettings();
      this._applyMotionPreference();
      this.bus = new AT.EventBus();

      // Core (required).
      this.camera = new AT.Camera();
      this.camera.shakeScale = this.settings.reducedShake ? 0.25 : 1;
      this.input = new AT.InputManager(this.canvas, this.settings, this.bus);
      this.input.attach();
      this.isTouch = this._detectTouch();
      this._lastSource = this.input.lastSource;

      // Optional subsystems: a failure here must never prevent play.
      this.audio = this._optional('audio', () => new AT.AudioManager(this.bus, this.settings), nullAudio);
      this.particles = this._optional('particles', () => new AT.ParticleSystem(this.bus, this.settings), nullParticles);
      this.threat = this._optional('threat', () => new AT.ThreatSystem(), nullThreat);
      this.renderer = this._optional('renderer', () => new AT.Renderer(this.canvas), () => new FallbackRenderer(this.canvas));

      this._wireBus();
      this._enterAttract(); // level / player / grapple / creature exist before the UI looks at them

      // UI last: it may read any game field during init.
      try {
        this.ui = new AT.UI(this);
        this.ui.init();
      } catch (err) {
        this._fault('ui', err);
        this.ui = nullUI();
      }
      this._uiFallback = !!this.ui.isNull;

      this._bindWindow();
      this._setState('menu', true); // sync input gameplay flag + body state attribute
      this._applySettingsSideEffects(null);
      this._resize();
      this._try('ui', () => this.ui.setTouchMode(this.isTouch));
      this._try('ui', () => this.ui.show('menu'));
      this._try('ui', () => this.ui.refreshMenu());
      this._try('audio', () => this.audio.setPaused(true));
      this.booted = true;
      this._startLoop();
    }

    _optional(name, factory, fallback) {
      try {
        const obj = factory();
        if (!obj) throw new Error(`${name} factory returned nothing`);
        return obj;
      } catch (err) {
        this._fault(name, err);
        return fallback();
      }
    }

    /** First run only: honour the OS "reduce motion" preference. */
    _applyMotionPreference() {
      try {
        if (AT.Storage.get('settings', null) !== null) return;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          this.settings.reducedShake = true;
        }
      } catch {
        /* matchMedia unavailable */
      }
    }

    _detectTouch() {
      try {
        if (this.input && this.input.lastSource === 'touch') return true;
        return !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      } catch {
        return false;
      }
    }

    _bindWindow() {
      const flag = () => {
        this._needsResize = true;
      };
      window.addEventListener('resize', flag);
      window.addEventListener('orientationchange', () => {
        // iOS reports the new size a little after the event.
        flag();
        setTimeout(flag, 250);
        setTimeout(flag, 650);
      });
      if (typeof ResizeObserver === 'function') {
        try {
          this._resizeObserver = new ResizeObserver(flag);
          this._resizeObserver.observe(this.canvas);
        } catch {
          /* window resize events still cover us */
        }
      }
      document.addEventListener('fullscreenchange', flag);
      document.addEventListener('webkitfullscreenchange', flag);
      document.addEventListener('visibilitychange', () => this._onVisibility());
      window.addEventListener('blur', () => {
        if (this.state === 'playing') this.pause();
      });
      window.addEventListener('pagehide', () => {
        if (this.state === 'playing') this.pause();
      });
      // Audio may only start from a user gesture (iOS). unlock() is idempotent and
      // cheap, so keep listening: it also recovers an 'interrupted' context.
      const unlock = () => this._unlockAudio();
      const opts = { capture: true, passive: true };
      window.addEventListener('pointerdown', unlock, opts);
      window.addEventListener('touchend', unlock, opts);
      window.addEventListener('keydown', unlock, opts);
    }

    _onVisibility() {
      if (document.hidden) {
        if (this.state === 'playing') this.pause();
        this._try('audio', () => this.audio.setPaused(true));
      } else {
        this._lastTs = null; // no giant dt after returning
        this._needsResize = true;
        const quiet = this.state === 'paused' || this.state === 'menu';
        this._try('audio', () => this.audio.setPaused(quiet));
      }
    }

    _unlockAudio() {
      if (!this.audio) return;
      try {
        this.audio.unlock();
      } catch (err) {
        this._fault('audio', err);
      }
    }

    _wireBus() {
      const bus = this.bus;
      bus.on('player:death', (e) => this._onPlayerDeath(e));
      bus.on('rope:jolt', (e) => {
        if (!this._inRun()) return;
        const k = U.clamp((finiteOr(e.speed, 700) - C.rope.joltFxSpeed) / 900, 0, 1);
        this._shake(3 + 4 * k, 0.18);
        this._haptic(15);
      });
      bus.on('player:land', (e) => {
        if (!this._inRun() || !e.hard) return;
        const r = U.clamp(finiteOr(e.lethalRatio, 0.7), 0, 1);
        this._shake(6 + 8 * r, 0.32);
        this._haptic(25);
      });
      bus.on('grapple:attach', () => {
        if (this._inRun()) this._haptic(10);
      });
      bus.on('creature:attack', (e) => {
        if (!this._inRun()) return;
        if (this.victoryT >= 0) {
          // Gate slam. creature.js emits it on impact ({gate:true}); an emitter that
          // signals the wind-up instead gets the shake slightly delayed.
          this._slamT = e && e.gate ? 1e-6 : SLAM_SHAKE_DELAY;
          return;
        }
        const p = this.player;
        if (p && p.alive && U.dist(finiteOr(e.x, 1e9), finiteOr(e.y, 1e9), p.x, p.y) < CREATURE_HAPTIC_RANGE) {
          this._haptic(20);
        }
      });
      bus.on('trigger:rumble', (e) => {
        if (!this._inRun()) return;
        const d = (e && e.data) || {};
        const k = U.clamp(finiteOr(d.intensity, 0.6), 0, 1.5);
        this._shake(5 + 9 * k, U.clamp(finiteOr(d.duration, 1.1), 0.2, 3));
        this._haptic(30);
      });
    }

    // =========================================================================
    // Run lifecycle
    // =========================================================================

    /**
     * Starts a fresh run (call from the click handler: unlocks audio).
     * @param {string} diffKey 'normal' | 'nightmare' | 'abyss' | 'sandbox'
     */
    start(diffKey) {
      const S = AT.Storage;
      const fallbackKey = AT.DIFFICULTY[this.settings.lastDifficulty] ? this.settings.lastDifficulty : 'normal';
      const key = AT.DIFFICULTY[diffKey] ? diffKey : fallbackKey;
      this._unlockAudio();
      const fromMenu = this.state === 'menu';
      if (this._runActive()) this._recordDepth();
      try {
        this.difficultyKey = key;
        this.diff = AT.DIFFICULTY[key];
        this._buildWorld(this.diff, false);
      } catch (err) {
        this._fault('start', err);
        showFatal(err);
        return false;
      }
      const lvl = this.level;
      const p = this.player;
      this.hidePlayer = false;
      this.time = 0;
      this._runClock = 0;
      this.deaths = 0;
      this.victoryT = -1;
      this.flash = 0;
      this.deathFade = fromMenu ? 1 : RESTART_FADE;
      this.deepest = p.y;
      this.sectionIndex = lvl.sectionIndexAt(p.y);
      this.checkpoint = { x: p.x, y: p.y, index: this.sectionIndex };
      this._creatureSection = -1;
      this._deathT = 0;
      this._deathShown = false;
      this._slamT = 0;
      this._acc = 0;
      this._pendingJump = false;
      this._resetProgress();

      this._try('threat', () => this.threat.reset());
      this._try('particles', () => this.particles.reset());
      this._try('creature', () => this.creature.reset(p));
      this.camera.snapTo(p.x, p.y);

      this.settings.lastDifficulty = key;
      S.saveSettings(this.settings);
      S.recordRunStart(key);

      this._setState('playing');
      this._try('ui', () => this.ui.hideHint());
      this._try('ui', () => this.ui.show(null));
      this._try('audio', () => this.audio.setPaused(false));
      this.bus.emit('game:start', { difficulty: key });
      this._enterSection(this.sectionIndex, 'initial');
      return true;
    }

    /** Instant restart of the current difficulty from the top. */
    restart() {
      const key = AT.DIFFICULTY[this.difficultyKey] ? this.difficultyKey : 'normal';
      this.bus.emit('game:restart', {});
      return this.start(key);
    }

    /**
     * Respawns at the current checkpoint (from the death screen or the pause
     * menu). With checkpoints 'none' (Abyss) this restarts the run.
     */
    respawn() {
      if (this.state !== 'dead' && this.state !== 'paused') return false;
      if (this.victoryT >= 0 || !this.player) return false;
      if (!this.diff || this.diff.checkpoints === 'none') return this.restart();
      const cp = this.checkpoint;
      const p = this.player;
      this.level.reset();
      p.reset(cp.x, cp.y);
      this.grapple.reset();
      this._acc = 0;
      this._pendingJump = false;
      this._deathT = 0;
      this._deathShown = false;
      const idx = this.level.sectionIndexAt(cp.y);
      if (idx !== this.sectionIndex) this._enterSection(idx, 'respawn');
      else if (idx !== this._creatureSection) this._setCreatureSection(idx);
      this._try('creature', () => this.creature.onRespawn(p));
      this._try('threat', () => this.threat.reset());
      this.camera.snapTo(cp.x, cp.y);
      this.flash = 0;
      this.deathFade = Math.max(this.deathFade, RESPAWN_FADE);
      this._setState('playing');
      this._try('ui', () => this.ui.show(null));
      this._try('audio', () => this.audio.setPaused(false));
      this.bus.emit('game:respawn', { x: cp.x, y: cp.y });
      return true;
    }

    /** Pauses a run in progress (Esc / P / pause button / focus loss). */
    pause() {
      if (this.state !== 'playing') return false;
      this._setState('paused');
      this._try('audio', () => this.audio.setPaused(true));
      this._try('ui', () => this.ui.show('pause'));
      this.bus.emit('game:pause', {});
      return true;
    }

    /** Resumes a paused run. */
    resume() {
      if (this.state !== 'paused') return false;
      this._setState('playing');
      this._try('audio', () => this.audio.setPaused(false));
      this._try('ui', () => this.ui.show(null));
      this.bus.emit('game:resume', {});
      return true;
    }

    /** Abandons the run and returns to the main menu (attract mode). */
    quitToMenu() {
      if (this._runActive()) this._recordDepth();
      try {
        this._enterAttract();
      } catch (err) {
        this._fault('menu', err);
      }
      this._try('ui', () => this.ui.hideHint());
      this._try('ui', () => this.ui.show('menu'));
      this._try('ui', () => this.ui.refreshMenu());
      this._try('audio', () => this.audio.setPaused(true));
      this.bus.emit('game:menu', {});
      return true;
    }

    /**
     * Sandbox only: teleport to the checkpoint of section i (resumes if paused).
     * @param {number} i section index
     */
    warpToSection(i) {
      if (this.difficultyKey !== 'sandbox') return false;
      return this._warp(i);
    }

    _warp(i) {
      if (!this.level || !this.player) return false;
      if (this.state !== 'playing' && this.state !== 'paused' && this.state !== 'dead') return false;
      const lvl = this.level;
      const idx = U.clamp(i | 0, 0, Math.max(0, lvl.sections.length - 1));
      const cp = lvl.checkpointFor(idx, 'all');
      const p = this.player;
      p.reset(cp.x, cp.y);
      this.grapple.reset();
      this._acc = 0;
      this._pendingJump = false;
      this._deathT = 0;
      this._deathShown = false;
      this.checkpoint = { x: cp.x, y: cp.y, index: idx };
      if (cp.y > this.deepest) this.deepest = cp.y;
      this._skipProgressAbove(cp.y);
      this._enterSection(idx, 'warp');
      this._try('creature', () => this.creature.onRespawn(p));
      this._try('threat', () => this.threat.reset());
      this.camera.snapTo(cp.x, cp.y);
      this.deathFade = Math.max(this.deathFade, RESTART_FADE);
      this._setState('playing');
      this._try('ui', () => this.ui.show(null));
      this._try('audio', () => this.audio.setPaused(false));
      return true;
    }

    /**
     * Merges a partial settings object into the live settings, persists it and
     * propagates side effects; emits settings:changed.
     * @param {object} partial
     */
    applySettings(partial) {
      const s = this.settings;
      if (!s) return null;
      if (!partial || typeof partial !== 'object') return s;
      const D = AT.SETTINGS_DEFAULTS;
      const before = { reducedEffects: s.reducedEffects, touchControls: s.touchControls };
      for (const k of Object.keys(partial)) {
        const v = partial[k];
        if (k in D) {
          if (typeof v === typeof D[k] && (typeof v !== 'number' || isFinite(v))) s[k] = v;
        } else if (typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && isFinite(v))) {
          s[k] = v; // UI-only extras (e.g. a HUD toggle) ride along in memory
        }
      }
      s.volume = U.clamp(finiteOr(s.volume, D.volume), 0, 1);
      s.sensitivity = U.clamp(finiteOr(s.sensitivity, D.sensitivity), 0.5, 2);
      s.aimAssist = U.clamp(finiteOr(s.aimAssist, D.aimAssist), 0.6, 1.4);
      if (s.touchAimMode !== 'direct' && s.touchAimMode !== 'stick') s.touchAimMode = D.touchAimMode;
      if (s.touchGrappleMode !== 'hold' && s.touchGrappleMode !== 'toggle') s.touchGrappleMode = D.touchGrappleMode;
      if (s.touchControls !== 'auto' && s.touchControls !== 'always' && s.touchControls !== 'never') {
        s.touchControls = D.touchControls;
      }
      if (!AT.DIFFICULTY[s.lastDifficulty]) s.lastDifficulty = 'normal';
      AT.Storage.saveSettings(s);
      this._applySettingsSideEffects(before);
      this.bus.emit('settings:changed', { settings: s });
      return s;
    }

    _applySettingsSideEffects(before) {
      const s = this.settings;
      this._try('audio', () => this.audio.setVolume(s.volume));
      if (this.camera) this.camera.shakeScale = s.reducedShake ? 0.25 : 1;
      if (before && before.reducedEffects !== s.reducedEffects) this._resize();
      if (before && before.touchControls !== s.touchControls) this._try('ui', () => this.ui.setTouchMode(this.isTouch));
      const body = document.body;
      if (body) {
        body.classList.toggle('high-contrast', !!s.highContrast);
        body.classList.toggle('reduced-effects', !!s.reducedEffects);
      }
    }

    /** Enters / leaves fullscreen (with webkit fallback); tries a landscape lock on phones. */
    toggleFullscreen() {
      const doc = document;
      const el = doc.documentElement;
      try {
        if (doc.fullscreenElement || doc.webkitFullscreenElement) {
          const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
          if (exit) {
            const r = exit.call(doc);
            if (r && typeof r.catch === 'function') r.catch(() => {});
          }
          return false;
        }
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        if (!req) return false;
        const lock = () => {
          try {
            const o = typeof screen !== 'undefined' ? screen.orientation : null;
            if (o && typeof o.lock === 'function' && this._detectTouch()) {
              const lp = o.lock('landscape');
              if (lp && typeof lp.catch === 'function') lp.catch(() => {});
            }
          } catch {
            /* orientation lock unsupported */
          }
        };
        const r = req.call(el);
        if (r && typeof r.then === 'function') r.then(lock, () => {});
        else lock();
        this._needsResize = true;
        return true;
      } catch (err) {
        this._fault('fullscreen', err);
        return false;
      }
    }

    // =========================================================================
    // World construction
    // =========================================================================

    /** (Re)builds the per-run objects for a difficulty. Reuses the level when the variant matches. */
    _buildWorld(diff, attract) {
      const variant = diff.levelVariant || 'normal';
      const data = AT.LEVEL_DATA;
      if (this.level && this.level.variant === variant && this.level.data === data) this.level.reset();
      else this.level = new AT.Level(data, variant);
      const lvl = this.level;
      const spawn = lvl.spawn || { x: 0, y: 0 };
      if (this.player) this.player.reset(spawn.x, spawn.y);
      else this.player = new AT.Player(spawn.x, spawn.y);

      // Per-run objects get a scoped bus so their subscriptions die with them.
      if (this._runBus) this._runBus.dispose();
      const old = this.creature;
      if (old && typeof old.destroy === 'function') this._try('creature', () => old.destroy());
      this._runBus = scopedBus(this.bus);
      this.grapple = new AT.GrappleSystem(lvl, diff, this._runBus, this.settings);
      this.physics = new AT.Physics(lvl, diff, this._runBus);
      this._guardKill(this.physics);
      const cdiff = attract ? inactiveDiff(diff) : diff;
      try {
        this.creature = new AT.Creature(lvl, cdiff, this._runBus);
      } catch (err) {
        this._fault('creature', err);
        this.creature = nullCreature();
      }
      const tc = this._threatCtx;
      tc.player = this.player;
      tc.creature = this.creature;
      tc.grapple = this.grapple;
      tc.diff = diff;
      tc.level = lvl;
    }

    /**
     * Wraps physics.kill so god mode and the victory sequence can veto deaths
     * before any player:death event is emitted (physics.js is not modified).
     */
    _guardKill(physics) {
      const game = this;
      const original = physics.kill;
      physics.kill = function (player, grapple, cause, impact) {
        if (game._godMode || game.victoryT >= 0 || game.state !== 'playing') return;
        original.call(this, player, grapple, cause, impact);
      };
    }

    /** Menu background: the level of the last difficulty, camera drifting down the shaft. */
    _enterAttract() {
      const key = AT.DIFFICULTY[this.settings.lastDifficulty] ? this.settings.lastDifficulty : 'normal';
      this.difficultyKey = key;
      this.diff = AT.DIFFICULTY[key];
      this._buildWorld(this.diff, true);
      this._try('creature', () => this.creature.reset(this.player));
      this._try('threat', () => this.threat.reset());
      this.hidePlayer = true;
      this.time = 0;
      this._runClock = 0;
      this.deaths = 0;
      this.victoryT = -1;
      this.flash = 0;
      this.deathFade = 0;
      this.aimWorld = null;
      this.aimMode = null;
      this._override = null;
      this._slamT = 0;
      const lvl = this.level;
      const a = this._attract;
      a.t = 0;
      a.y = lvl.spawn ? lvl.spawn.y : lvl.bounds.y0;
      a.fading = 0;
      this.sectionIndex = lvl.sectionIndexAt(a.y);
      this.deepest = a.y;
      this.camera.snapTo(lvl.width / 2, a.y);
      this._setState('menu');
    }

    _resetProgress() {
      const lvl = this.level;
      const n = lvl.sections.length;
      this._seen.length = n;
      for (let i = 0; i < n; i++) this._seen[i] = false;
      const hints = this._hintList;
      const triggers = this._triggerList;
      hints.length = 0;
      triggers.length = 0;
      for (let i = 0; i < n; i++) {
        const sec = lvl.sections[i];
        const hl = sec.hints || [];
        for (let j = 0; j < hl.length; j++) {
          if (hl[j] && isFinite(hl[j].y)) hints.push({ y: hl[j].y, hint: hl[j], section: i });
        }
        const tl = sec.triggers || [];
        for (let j = 0; j < tl.length; j++) {
          if (tl[j] && isFinite(tl[j].y)) triggers.push({ y: tl[j].y, trigger: tl[j], section: i });
        }
      }
      hints.sort((a, b) => a.y - b.y);
      triggers.sort((a, b) => a.y - b.y);
      this._hintCursor = 0;
      this._triggerCursor = 0;
      this._hintQueue.length = 0;
      this._hintCooldown = 0;
    }

    /** Marks hints / triggers above y as already fired (warps / teleports never spam them). */
    _skipProgressAbove(y) {
      while (this._hintCursor < this._hintList.length && this._hintList[this._hintCursor].y <= y) this._hintCursor++;
      while (this._triggerCursor < this._triggerList.length && this._triggerList[this._triggerCursor].y <= y) {
        this._triggerCursor++;
      }
      this._hintQueue.length = 0;
    }

    // =========================================================================
    // Main loop
    // =========================================================================

    _startLoop() {
      this._raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (fn) => setTimeout(() => fn(nowMs()), 16);
      this._lastTs = null;
      this._rafId = this._raf.call(window, this._loopFn);
    }

    _stopLoop() {
      if (this._rafId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this._rafId);
      this._rafId = 0;
      this._raf = null;
    }

    /**
     * requestAnimationFrame callback: one frame of input → simulation → render.
     * @param {number} ts DOMHighResTimeStamp
     */
    loop(ts) {
      if (!this._raf) return;
      this._rafId = this._raf.call(window, this._loopFn);
      const now = typeof ts === 'number' && isFinite(ts) ? ts : nowMs();
      let realDt = this._lastTs === null ? 1 / 60 : (now - this._lastTs) / 1000;
      this._lastTs = now;
      if (!(realDt >= 0)) realDt = 0;
      this._samplePerformance(realDt);
      const dt = Math.min(realDt, C.MAX_FRAME_DT);
      try {
        if (this._frozen) {
          // Debug "manual stepping": draw, but only AT.debug.step advances the simulation.
          this.realTime += dt;
          if (this._needsResize) this._resize();
          this._render();
        } else {
          this._frame(dt, true);
        }
        this._frameErrors = 0;
      } catch (err) {
        this._frameErrors++;
        this._fault('frame', err);
        if (this._frameErrors >= FATAL_FRAME_ERRORS) {
          this._stopLoop();
          showFatal(err);
        }
      }
    }

    /** One frame. `doRender` is false for headless debug stepping. */
    _frame(dt, doRender) {
      this.realTime += dt;
      if (this._needsResize) this._resize();
      try {
        const input = this.input;
        input.update(dt);
        const intent = this._override ? this._fillOverrideIntent() : input.intent || this._blank;
        this._syncInputSource();
        // If the UI changed state or screen since the last frame (e.g. its own
        // Esc / Enter handling), the same key's edge must not act a second time.
        const external = this.state !== this._endState || this._uiScreen() !== this._endUi;
        if (!external) this._handleGlobalEdges(intent);
        switch (this.state) {
          case 'playing':
          case 'dead':
            this._updateRun(dt, intent);
            break;
          case 'paused':
            this._updatePaused(dt);
            break;
          case 'victory':
            this._updateVictoryScene(dt);
            break;
          default:
            this._updateAttract(dt);
        }
        this._updateFeedback(dt);
        this._updateAudio(dt);
        if (doRender) this._render();
        this._updateHud(dt);
      } finally {
        this._endFrame();
      }
    }

    _endFrame() {
      try {
        this.input.endFrame();
      } catch (err) {
        this._fault('input', err);
      }
      const o = this._override;
      if (o) {
        for (let i = 0; i < EDGE_KEYS.length; i++) o[EDGE_KEYS[i]] = false;
      }
      this._endState = this.state;
      this._endUi = this._uiScreen();
    }

    _uiScreen() {
      return this.ui ? this.ui.current : null;
    }

    _handleGlobalEdges(intent) {
      const s = this.state;
      if (intent.pausePressed) {
        if (s === 'playing') {
          this.pause();
          return;
        }
        if (s === 'paused' && this._uiScreen() === 'pause') {
          this.resume();
          return;
        }
      }
      if (intent.restartPressed && (s === 'playing' || s === 'dead' || s === 'victory' || s === 'paused')) {
        this.restart();
        return;
      }
      if (s === 'dead' && this._deathT >= DEATH_SCREEN_DELAY && (intent.confirmPressed || intent.respawnPressed)) {
        this.respawn();
        return;
      }
      if (this._uiFallback) {
        // No DOM menus: any confirm / grapple press starts or continues.
        const go = intent.confirmPressed || intent.grapplePressed || intent.grappleTap;
        if (s === 'menu' && go) this.start(this.settings.lastDifficulty);
        else if (s === 'victory' && go && this.victoryT > VICTORY_DELAY + 0.8) this.restart();
      }
    }

    _syncInputSource() {
      const src = this.input.lastSource;
      if (src === this._lastSource) return;
      this._lastSource = src;
      const touch = src === 'touch';
      if (touch === this.isTouch) return;
      this.isTouch = touch;
      this._needsResize = true; // camera uses a smaller visible height on touch
      try {
        this.ui.setTouchMode(touch);
      } catch (err) {
        this._fault('ui', err);
      }
    }

    // ---- per-state updates ------------------------------------------------------

    _updateRun(dt, intent) {
      const p = this.player;
      const g = this.grapple;
      if (this.state === 'playing' && p.alive) {
        const aim = this._resolveAim(intent.aim);
        g.updateTarget(p, aim);
        g.handleInput(p, intent, aim, dt);
        this._stepPhysics(dt, intent);
      } else {
        this.aimWorld = null;
        this.aimMode = null;
        if (g.target) g.updateTarget(p, null); // clears the highlight
        this._acc = 0;
        this._pendingJump = false;
        this.alpha = 0;
        p.prevX = p.x;
        p.prevY = p.y;
      }
      // Render interpolation between the last two physics states.
      p.rx = p.prevX + (p.x - p.prevX) * this.alpha;
      p.ry = p.prevY + (p.y - p.prevY) * this.alpha;

      this._runClock += dt;
      if (this.victoryT < 0) this.time += dt; // counts while playing or dead

      this._updateCreature(dt);
      this._updateThreat(dt);
      this._updateParticles(dt);
      this.camera.follow(p, dt, this.level);
      this.camera.update(dt);

      if (this.state === 'playing' && p.alive) this._updateProgress(dt);
      if (this.state === 'dead') this._updateDeath(dt);
      if (this.state === 'playing' && this.victoryT >= 0) {
        this.victoryT += dt;
        if (this.victoryT >= VICTORY_DELAY) this._finishVictory();
      }
    }

    /**
     * Fixed-step accumulator. jumpPressed is delivered to exactly one physics
     * step (kept pending if this frame was too short to run a step).
     */
    _stepPhysics(dt, intent) {
      const PDT = C.PHYSICS_DT;
      const p = this.player;
      const g = this.grapple;
      const si = this._stepIntent;
      if (intent.jumpPressed) this._pendingJump = true;
      si.moveX = finiteOr(intent.moveX, 0);
      si.moveY = finiteOr(intent.moveY, 0);
      this._acc += dt;
      let steps = 0;
      while (this._acc >= PDT - 1e-9) {
        if (steps >= C.MAX_STEPS_PER_FRAME) {
          this._acc = 0; // drop the backlog rather than spiral
          break;
        }
        si.jumpPressed = this._pendingJump;
        this._pendingJump = false;
        this.physics.step(p, g, si, PDT);
        this._acc -= PDT;
        steps++;
        if (!p.alive || this.state !== 'playing') {
          this._acc = 0;
          break;
        }
      }
      if (this._acc < 0) this._acc = 0;
      this.alpha = p.alive ? U.clamp(this._acc / PDT, 0, 1) : 0;
    }

    /** Converts the input aim to WORLD space for GrappleSystem and the renderer (no allocation). */
    _resolveAim(aim) {
      if (!aim) {
        this.aimWorld = null;
        this.aimMode = null;
        return null;
      }
      const w = this._aimWorldObj;
      if (aim.mode === 'screen' || aim.mode === 'point') {
        let x;
        let y;
        if (aim.mode === 'screen') {
          const s = this.camera.screenToWorld(finiteOr(aim.sx, 0), finiteOr(aim.sy, 0), this._screenTmp);
          x = s.x;
          y = s.y;
        } else {
          x = aim.x;
          y = aim.y;
        }
        if (!isFinite(x) || !isFinite(y)) {
          this.aimWorld = null;
          this.aimMode = null;
          return null;
        }
        const o = this._aimPoint;
        o.x = x;
        o.y = y;
        o.touch = !!aim.touch;
        w.x = x;
        w.y = y;
        this.aimWorld = w;
        this.aimMode = 'point';
        return o;
      }
      if (aim.mode === 'dir') {
        const dx = finiteOr(aim.dx, 0);
        const dy = finiteOr(aim.dy, 0);
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) {
          this.aimWorld = null;
          this.aimMode = null;
          return null;
        }
        const o = this._aimDir;
        o.dx = dx;
        o.dy = dy;
        // A world point along the direction, so the renderer can draw a cue.
        const reach = (this.diff ? this.diff.aimRange : 500) * 0.55;
        w.x = this.player.x + (dx / len) * reach;
        w.y = this.player.y + (dy / len) * reach;
        this.aimWorld = w;
        this.aimMode = 'dir';
        return o;
      }
      this.aimWorld = null;
      this.aimMode = null;
      return null;
    }

    _updateProgress(dt) {
      const p = this.player;
      const lvl = this.level;
      if (p.y > this.deepest) this.deepest = p.y;
      const idx = lvl.sectionIndexAt(p.y);
      if (idx !== this.sectionIndex) this._enterSection(idx, 'progress');

      const hl = this._hintList;
      while (this._hintCursor < hl.length && hl[this._hintCursor].y <= p.y) {
        this._queueHint(hl[this._hintCursor].hint);
        this._hintCursor++;
      }
      const tl = this._triggerList;
      while (this._triggerCursor < tl.length && tl[this._triggerCursor].y <= p.y) {
        const entry = tl[this._triggerCursor];
        this._triggerCursor++;
        this._fireTrigger(entry);
      }
      this._updateHints(dt);

      if (this.victoryT < 0 && lvl.inGoal(p.x, p.y)) this._beginVictory();
      if (this._godMode && p.y > lvl.bounds.y1 + C.player.fallDeathMargin * 0.8) {
        // God mode never dies: fell out of the world → back to the checkpoint.
        const cp = this.checkpoint;
        p.reset(cp.x, cp.y);
        this.grapple.reset();
        this.camera.snapTo(cp.x, cp.y);
      }
    }

    /**
     * Section bookkeeping. mode: 'progress' (crossed a boundary while playing),
     * 'initial' (run start), 'respawn', 'warp'.
     */
    _enterSection(idx, mode) {
      const lvl = this.level;
      const sec = lvl.sections[idx];
      if (!sec) return;
      this.sectionIndex = idx;
      const first = !this._seen[idx];
      this._seen[idx] = true;
      this.bus.emit('section:enter', { index: idx, section: sec, first });
      // The creature follows the deepest section reached; respawns / warps
      // re-apply the section the player is actually in.
      if (mode === 'progress' ? idx > this._creatureSection : idx !== this._creatureSection) {
        this._setCreatureSection(idx);
      }
      if (first) this._try('ui', () => this.ui.showSectionTitle(sec.name, sec.subtitle));
      if (mode === 'progress' || mode === 'initial') {
        const cp = lvl.checkpointFor(idx, (this.diff && this.diff.checkpoints) || 'all');
        if (cp && cp.index > this.checkpoint.index) {
          this.checkpoint = { x: cp.x, y: cp.y, index: cp.index };
          this._try('ui', () => this.ui.showToast('Checkpoint', 2.2));
          this.bus.emit('checkpoint', { index: cp.index, x: cp.x, y: cp.y });
        }
      }
    }

    _setCreatureSection(idx) {
      this._creatureSection = idx;
      const sec = this.level.sections[idx];
      this._try('creature', () => this.creature.setSection(idx, sec, this.player));
    }

    _queueHint(hint) {
      const q = this._hintQueue;
      if (q.length >= HINT_QUEUE_MAX) q.shift();
      q.push(hint);
    }

    _updateHints(dt) {
      if (this._hintCooldown > 0) this._hintCooldown -= dt;
      if (this._hintCooldown > 0 || this._hintQueue.length === 0) return;
      const h = this._hintQueue.shift();
      const text = this._hintText(h);
      const secs = finiteOr(h.duration, HINT_DEFAULT_SECONDS);
      if (text) this._try('ui', () => this.ui.showHint(text, secs));
      this._hintCooldown = Math.min(secs, HINT_GAP);
    }

    /** Touch / keyboard / default wording for the current control scheme. */
    _hintText(h) {
      if (this.isTouch && h.touch) return h.touch;
      if (!this.isTouch && h.keyboard && this.input && this.input.lastSource === 'keyboard') return h.keyboard;
      return h.text || h.touch || h.keyboard || '';
    }

    _fireTrigger(entry) {
      const t = entry.trigger;
      const payload = { name: t.name, data: t.data || {}, section: entry.section, x: this.player.x, y: t.y };
      this.bus.emit('trigger', payload);
      if (t.name) this.bus.emit('trigger:' + t.name, payload);
    }

    _beginVictory() {
      this.victoryT = 0; // timer stops; deaths are vetoed from here on
      this._hintQueue.length = 0;
      this._try('ui', () => this.ui.hideHint());
      this._try('creature', () => this.creature.onVictory(this.level.gate));
    }

    _finishVictory() {
      const S = AT.Storage;
      const key = this.difficultyKey;
      const time = this.time;
      let res = { best: null, previous: null, isNew: false };
      const deepestMeters = U.depthMeters(this.deepest);
      try {
        if (this.diff.recordTimes) {
          res = S.submitTime(key, time);
          S.recordDeaths(key, this.deaths);
        }
        S.recordDepth(key, deepestMeters);
      } catch (err) {
        this._fault('storage', err);
      }
      this._setState('victory');
      this._haptic([20, 60, 20]);
      this._try('ui', () =>
        this.ui.showVictory({
          time,
          best: res.best,
          previous: res.previous,
          isNew: !!res.isNew,
          deaths: this.deaths,
          deepestMeters,
          difficultyKey: key,
          label: this.diff.label,
        }),
      );
      this.bus.emit('game:victory', { time, deaths: this.deaths });
    }

    _onPlayerDeath(e) {
      if (this.state !== 'playing') return;
      const cause = (e && e.cause) || 'impact';
      this.deaths++;
      this._deathCause = cause;
      this._deathT = 0;
      this._deathShown = false;
      this._acc = 0;
      this._pendingJump = false;
      this._setState('dead');
      this.flash = cause === 'creature' ? 1 : 0.8;
      if (cause === 'creature') this._shake(18, 0.6);
      else if (cause === 'impact') {
        const over = U.clamp((finiteOr(e.impact, 0) - this.diff.lethalImpact) / 600, 0, 1);
        this._shake(10 + 8 * over, 0.45);
      } else if (cause === 'hazard') this._shake(8, 0.35);
      this._haptic([35, 45, 90]);
      this._try('ui', () => this.ui.hideHint());
      this._recordDepth();
    }

    _updateDeath(dt) {
      this._deathT += dt;
      if (this._deathShown || this._deathT < DEATH_SCREEN_DELAY) return;
      this._deathShown = true;
      const cause = this._deathCause || 'impact';
      const pool = DEATH_MESSAGES[cause] || DEATH_MESSAGES.impact;
      const info = {
        cause,
        deaths: this.deaths,
        canRespawn: this.diff.checkpoints !== 'none',
        depthMeters: U.depthMeters(this.player.y),
        time: this.time,
        message: pool[(this.deaths - 1) % pool.length],
      };
      this._try('ui', () => this.ui.showDeath(info));
    }

    _updatePaused(dt) {
      // Frozen scene; ambient particles keep drifting gently.
      this._updateParticles(dt * 0.3);
    }

    _updateVictoryScene(dt) {
      this.victoryT += dt;
      this._runClock += dt;
      this._updateCreature(dt);
      this._updateThreat(dt);
      this._updateParticles(dt);
      this.camera.follow(this.player, dt, this.level);
      this.camera.update(dt);
    }

    _updateAttract(dt) {
      const lvl = this.level;
      const a = this._attract;
      a.t += dt;
      const top = lvl.spawn ? lvl.spawn.y : lvl.bounds.y0;
      const bottom = Math.max(top + 1, lvl.bounds.y1 - 400);
      if (a.fading >= 0) a.y += ATTRACT_SPEED * dt;
      if (a.fading === 0 && a.y >= bottom) a.fading = 1;
      if (a.fading === 1) {
        // Fade to black near the bottom, then start over at the top.
        this.deathFade = Math.min(1, this.deathFade + dt / ATTRACT_FADE_OUT);
        if (this.deathFade >= 1) {
          a.y = top;
          a.fading = -1;
        }
      } else if (a.fading === -1) {
        this.deathFade = Math.max(0, this.deathFade - dt / ATTRACT_FADE_IN);
        if (this.deathFade <= 0) a.fading = 0;
      }
      const x = lvl.width / 2 + Math.sin(a.t * 0.07) * Math.min(120, lvl.width * 0.08);
      this.camera.snapTo(x, a.y);
      this.camera.update(dt);
      // The hidden player rides the view centre (lantern light / audio listener).
      const p = this.player;
      p.x = p.prevX = p.rx = x;
      p.y = p.prevY = p.ry = a.y;
      p.vx = 0;
      p.vy = 0;
      this.sectionIndex = lvl.sectionIndexAt(a.y);
      this._updateParticles(dt);
    }

    _updateCreature(dt) {
      const c = this.creature;
      try {
        c.update(dt, this.player, this._runClock);
        if (c.caughtPlayer) {
          c.caughtPlayer = false;
          if (this.player.alive && this.state === 'playing') this.physics.kill(this.player, this.grapple, 'creature');
        }
      } catch (err) {
        this._fault('creature', err);
      }
    }

    _updateThreat(dt) {
      try {
        this.threat.update(dt, this._threatCtx);
      } catch (err) {
        this._fault('threat', err);
      }
    }

    _updateParticles(dt) {
      try {
        this.particles.update(dt, this.camera, finiteOr(this.threat.value, 0), this.level);
      } catch (err) {
        this._fault('particles', err);
      }
    }

    _updateAudio(dt) {
      try {
        this.audio.update(dt, this);
      } catch (err) {
        this._fault('audio', err);
      }
    }

    _updateHud(dt) {
      try {
        this.ui.updateHUD(this, dt);
      } catch (err) {
        this._fault('ui', err);
      }
    }

    _updateFeedback(dt) {
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.4);
      if (this.state === 'dead') this.deathFade = U.approach(this.deathFade, DEATH_FADE_MAX, dt * 1.4);
      else if (this.state !== 'menu' && this.deathFade > 0) this.deathFade = Math.max(0, this.deathFade - dt * 2.2);
      if (this._slamT > 0) {
        this._slamT -= dt;
        if (this._slamT <= 0) {
          this._shake(16, 0.8);
          this._haptic([30, 40, 70]);
        }
      }
    }

    _render() {
      const r = this.renderer;
      if (!r) return;
      try {
        r.render(this, this.alpha);
        this._renderFaults = 0;
      } catch (err) {
        this._fault('renderer', err);
        this._renderFaults++;
        if (this._renderFaults >= RENDER_FAULT_SWAP && !r.isFallback) {
          console.error('[AT] renderer keeps failing; switching to the fallback renderer');
          try {
            this.renderer = new FallbackRenderer(this.canvas);
            this._sized.w = -1; // force a resize of the new renderer
            this._resize();
          } catch (err2) {
            this._fault('renderer', err2);
          }
          this._renderFaults = 0;
        }
      }
    }

    // ---- feedback helpers -----------------------------------------------------------

    _inRun() {
      return this.state === 'playing' || this.state === 'dead';
    }

    _runActive() {
      return this.state === 'playing' || this.state === 'dead' || this.state === 'paused';
    }

    _shake(amount, duration) {
      try {
        this.camera.shake(amount, duration);
      } catch (err) {
        this._fault('camera', err);
      }
    }

    _haptic(pattern) {
      try {
        if (this.input && typeof this.input.haptic === 'function') this.input.haptic(pattern);
      } catch (err) {
        this._fault('input', err);
      }
    }

    _recordDepth() {
      try {
        AT.Storage.recordDepth(this.difficultyKey, U.depthMeters(this.deepest));
      } catch (err) {
        this._fault('storage', err);
      }
    }

    _setState(s, force) {
      if (this.state === s && !force) return;
      this.state = s;
      try {
        if (this.input) this.input.setGameplayActive(s === 'playing');
      } catch (err) {
        this._fault('input', err);
      }
      const body = typeof document !== 'undefined' ? document.body : null;
      if (body) {
        body.classList.toggle('playing', s === 'playing');
        body.setAttribute('data-game-state', s);
      }
    }

    /** Runs fn, logging (rate-limited) instead of throwing. For rare calls only (allocates a closure). */
    _try(name, fn) {
      try {
        return fn();
      } catch (err) {
        this._fault(name, err);
        return undefined;
      }
    }

    _fault(name, err) {
      const n = (this._faults[name] || 0) + 1;
      this._faults[name] = n;
      if (n <= FAULT_LOG_LIMIT && typeof console !== 'undefined') {
        console.error(`[AT] ${name} failed${n === FAULT_LOG_LIMIT ? ' (further errors muted)' : ''}`, err);
      }
    }

    // =========================================================================
    // Canvas sizing & dynamic resolution
    // =========================================================================

    _resize() {
      this._needsResize = false;
      const canvas = this.canvas;
      let w = 0;
      let h = 0;
      try {
        const r = canvas.getBoundingClientRect();
        w = r.width;
        h = r.height;
      } catch {
        /* detached canvas */
      }
      const vw = window.innerWidth || w || 800;
      const vh = window.innerHeight || h || 600;
      if (!(w > 0)) w = vw;
      if (!(h > 0)) h = vh;
      // A full-viewport game: never larger than the viewport (also guards a
      // canvas without CSS sizing from growing with its own backing store).
      w = Math.max(1, Math.min(w, vw));
      h = Math.max(1, Math.min(h, vh));
      const device = window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
      const base = Math.min(device, this.settings && this.settings.reducedEffects ? 1.25 : 2);
      const dpr = Math.max(0.5, base * this.renderScale);
      this.cssW = w;
      this.cssH = h;
      this.dpr = dpr;
      this.camera.resize(w, h, dpr, this.isTouch);

      const sz = this._sized;
      if (Math.abs(sz.w - w) < 0.5 && Math.abs(sz.h - h) < 0.5 && Math.abs(sz.dpr - dpr) < 1e-3) return;
      sz.w = w;
      sz.h = h;
      sz.dpr = dpr;
      try {
        if (this.renderer) this.renderer.resize(w, h, dpr);
      } catch (err) {
        this._fault('renderer', err);
      }
      // Backing store = CSS size × dpr, whatever the renderer did.
      const bw = Math.max(1, Math.round(w * dpr));
      const bh = Math.max(1, Math.round(h * dpr));
      if (Math.abs(canvas.width - bw) > 2 || Math.abs(canvas.height - bh) > 2) {
        canvas.width = bw;
        canvas.height = bh;
      }
    }

    _samplePerformance(realDt) {
      if (!(realDt > 0) || realDt > 0.25) return; // tab switches / hitches are not "slow frames"
      this._frameAvg += (realDt - this._frameAvg) * 0.1;
      this.fps = 1 / this._frameAvg;
      if (this.state !== 'playing') {
        this._slowT = 0;
        this._fastT = 0;
        return;
      }
      if (this._frameAvg > DYN_RES.slowFrame) {
        this._fastT = 0;
        this._slowT += realDt;
        if (this._slowT >= DYN_RES.slowHold) {
          this._slowT = 0;
          if (this.renderScale > DYN_RES.min + 1e-6) {
            // Flip-flopping right after an upscale? Wait longer before trying again.
            if (this.realTime - this._lastUpscaleAt < 6) this._fastHold = Math.min(this._fastHold * 2, 64);
            this.renderScale = Math.max(DYN_RES.min, Math.round((this.renderScale - DYN_RES.step) * 100) / 100);
            this._needsResize = true;
          }
        }
      } else if (this._frameAvg < DYN_RES.fastFrame) {
        this._slowT = 0;
        this._fastT += realDt;
        if (this._fastT >= this._fastHold && this.renderScale < DYN_RES.max) {
          this._fastT = 0;
          this.renderScale = Math.min(DYN_RES.max, Math.round((this.renderScale + DYN_RES.step) * 100) / 100);
          this._lastUpscaleAt = this.realTime;
          this._needsResize = true;
        }
      } else {
        this._slowT = Math.max(0, this._slowT - realDt);
      }
    }

    // =========================================================================
    // Debug / test API (installed on AT.debug)
    // =========================================================================

    _fillOverrideIntent() {
      const o = this._override;
      const it = this._ovIntent;
      it.moveX = U.clamp(finiteOr(o.moveX, 0), -1, 1);
      it.moveY = U.clamp(finiteOr(o.moveY, 0), -1, 1);
      it.aim = o.aim || null;
      it.grappleHeld = !!o.grappleHeld;
      for (let i = 0; i < EDGE_KEYS.length; i++) it[EDGE_KEYS[i]] = !!o[EDGE_KEYS[i]];
      return it;
    }

    /**
     * Overrides the InputManager intent while non-null. Continuous fields
     * (moveX/moveY/aim/grappleHeld) persist; edge fields (…Pressed, grappleTap,
     * grappleReleased) apply to one frame only. grapplePressed implies
     * grappleHeld and grappleReleased implies !grappleHeld unless given.
     * aim may be {mode:'point',x,y} (world), {mode:'screen',sx,sy} or {mode:'dir',dx,dy}.
     */
    debugSetInput(partial) {
      if (partial == null) {
        this._override = null;
        return null;
      }
      const o = Object.assign({}, partial);
      if (o.grapplePressed && !('grappleHeld' in o)) o.grappleHeld = true;
      if (o.grappleReleased && !('grappleHeld' in o)) o.grappleHeld = false;
      this._override = o;
      return o;
    }

    /** Advances the simulation deterministically at a fixed 1/60 s frame, then renders once. */
    debugStep(seconds) {
      const s = finiteOr(Number(seconds), 0);
      const n = U.clamp(Math.round(s * 60), 1, MAX_DEBUG_STEP_FRAMES);
      for (let i = 0; i < n; i++) this._frame(1 / 60, false);
      this._render();
      return this.debugState();
    }

    debugTeleport(x, y) {
      const p = this.player;
      if (!p || !isFinite(x) || !isFinite(y)) return false;
      if (this.grapple && this.grapple.anchor) this.grapple.release(p, 'reset');
      p.x = p.prevX = p.rx = +x;
      p.y = p.prevY = p.ry = +y;
      p.vx = 0;
      p.vy = 0;
      p.grounded = false;
      p.fallPeak = 0;
      this._acc = 0;
      this._skipProgressAbove(p.y - 1);
      this.camera.snapTo(p.x, p.y);
      return true;
    }

    debugAttach(anchorId) {
      const lvl = this.level;
      const p = this.player;
      const g = this.grapple;
      if (!lvl || !p || !g || !p.alive) return false;
      let an = lvl.byId ? lvl.byId[anchorId] : null;
      if (!an || !lvl.anchors.includes(an)) an = lvl.anchors.find((a) => String(a.id) === String(anchorId)) || null;
      if (!an || an.broken) return false;
      g.attach(p, an, !!g.anchor);
      return true;
    }

    /** JSON-friendly snapshot of the game for tests. */
    debugState() {
      const r = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : v);
      const p = this.player;
      const g = this.grapple;
      const c = this.creature;
      const sec = this.level ? this.level.sections[this.sectionIndex] : null;
      return {
        state: this.state,
        difficulty: this.difficultyKey,
        time: r(this.time),
        deaths: this.deaths,
        section: this.sectionIndex,
        sectionName: sec ? sec.name : null,
        player: p
          ? {
              x: r(p.x),
              y: r(p.y),
              vx: r(p.vx),
              vy: r(p.vy),
              alive: p.alive,
              grounded: p.grounded,
              grappleState: p.grappleState,
              ropeLength: r(p.ropeLength),
              anchor: g && g.anchor ? g.anchor.id : null,
              target: g && g.target ? g.target.id : null,
            }
          : null,
        creature: c
          ? {
              state: c.state,
              stamina: r(c.stamina),
              distance: r(c.distance),
              x: r(c.x),
              y: r(c.y),
              active: !!c.active,
              lethal: !!c.lethal,
            }
          : null,
        threat: this.threat ? r(this.threat.value) : 0,
        fps: r(this.fps),
        renderScale: this.renderScale,
        dpr: r(this.dpr),
        checkpoint: Object.assign({}, this.checkpoint),
        deepest: r(this.deepest),
        victoryT: r(this.victoryT),
        ui: this._uiScreen(),
        isTouch: this.isTouch,
        godMode: this._godMode,
        frozen: this._frozen,
        faults: Object.assign({}, this._faults),
      };
    }
  }

  // ===========================================================================
  // Fatal error overlay (inline styles: works even if style.css failed).
  // ===========================================================================
  function showFatal(err) {
    try {
      if (typeof console !== 'undefined') console.error('[AT] fatal', err);
      if (typeof document === 'undefined' || !document.body) return;
      let box = document.getElementById('at-fatal');
      if (!box) {
        box = document.createElement('div');
        box.id = 'at-fatal';
        box.setAttribute('role', 'alert');
        box.style.cssText =
          'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
          'padding:24px;background:rgba(8,10,11,0.94);color:#e8dcc0;font:16px/1.5 system-ui,-apple-system,' +
          'Segoe UI,Roboto,sans-serif;text-align:center;';
        document.body.appendChild(box);
      }
      box.textContent = '';
      const panel = document.createElement('div');
      panel.style.cssText = 'max-width:560px;';
      const title = document.createElement('h1');
      title.textContent = 'The descent could not begin.';
      title.style.cssText = 'font:600 22px/1.3 Georgia,serif;letter-spacing:0.06em;margin:0 0 12px;color:#e0a050;';
      const msg = document.createElement('p');
      msg.textContent = (err && err.message) || String(err || 'Unknown error');
      msg.style.cssText = 'margin:0 0 12px;opacity:0.9;word-break:break-word;';
      const help = document.createElement('p');
      help.textContent = 'Try reloading the page. A current browser with Canvas 2D support is required.';
      help.style.cssText = 'margin:0 0 18px;opacity:0.7;font-size:14px;';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Reload';
      btn.style.cssText =
        'min-width:120px;min-height:44px;padding:8px 20px;border:1px solid #e0a050;background:transparent;' +
        'color:#e8dcc0;font:inherit;cursor:pointer;';
      btn.addEventListener('click', () => window.location.reload());
      panel.appendChild(title);
      panel.appendChild(msg);
      panel.appendChild(help);
      panel.appendChild(btn);
      box.appendChild(panel);
    } catch {
      /* nothing more we can do */
    }
  }

  // ===========================================================================
  // Debug API + bootstrap
  // ===========================================================================
  function installDebug(game) {
    AT.debug = {
      game,
      /** @returns {object} JSON summary of the game */
      state: () => game.debugState(),
      /** Moves the player (releasing the tether). */
      teleport: (x, y) => game.debugTeleport(x, y),
      /** Overrides the input intent while non-null (see Game#debugSetInput). */
      setInput: (partial) => game.debugSetInput(partial),
      /** Advances the simulation by `seconds` at a fixed 1/60 s frame. */
      step: (seconds) => game.debugStep(seconds),
      /** Forces an attachment to the anchor with this id. */
      attach: (anchorId) => game.debugAttach(anchorId),
      /** Ignore deaths while on. */
      godMode: (on) => {
        game._godMode = on === undefined ? true : !!on;
        return game._godMode;
      },
      /** Teleports to the checkpoint of a section (any difficulty). */
      warp: (i) => game._warp(i),
      /** Extra: while frozen, RAF only renders; only step() advances the simulation. */
      freeze: (on) => {
        game._frozen = on === undefined ? true : !!on;
        return game._frozen;
      },
    };
    return AT.debug;
  }

  function bootstrap() {
    let game = null;
    try {
      const canvas = document.getElementById('game-canvas');
      if (!canvas) throw new Error('Missing <canvas id="game-canvas"> in index.html.');
      game = new Game(canvas);
      AT.game = game;
      installDebug(game);
      game.boot();
    } catch (err) {
      if (game) game._stopLoop();
      showFatal(err);
    }
  }

  AT.Game = Game;
  AT.FallbackRenderer = FallbackRenderer;
  AT.showFatal = showFatal;

  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
    else bootstrap();
  }
})((window.AT = window.AT || {}));
