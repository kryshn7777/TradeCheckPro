/* ABYSSAL TETHER — creature.js
 * AT.Creature — "the Mason": a colossal organism fused with the Underspire's
 * masonry. A long column of stone-and-iron plates hauled along the shaft walls
 * by hooked, girder-like limbs, led by a blunt crown of pale sensory fronds.
 *
 * Three layers live here:
 *   1. Behaviour — a small state machine (DORMANT, DISTANT, OBSERVING,
 *      APPROACHING, PURSUING, BURST, ATTACK, RECOVERING) driven by the current
 *      section's `creature` config and a stamina budget, so pressure arrives in
 *      waves: it comes, it surges, it tires and withdraws, it comes again.
 *      It hunts by sound: go still and it stops to listen (pits glowing), then
 *      creeps in; move while it listens and it hears you.
 *   2. Body simulation — follow-the-leader plated segments, independent limbs
 *      that plant on nearby solids and step when over-stretched (each plant
 *      emits `creature:step` for audio), and a crown of sweeping fronds.
 *   3. Procedural rendering — `render` (world layer), `renderGlow` (sensory
 *      glow only, drawn by the renderer ABOVE its darkness overlay) and
 *      `renderFar` (the distant sighting silhouette, screen space).
 *
 * Simulation is DOM-free and allocation-free per frame (preallocated typed
 * arrays + scratch lists) so it runs in Node for tuning. Only rendering touches
 * a canvas, and only through the `ctx` it is handed.
 *
 * CONTRACT §10 plus documented additions:
 *   renderGlow(ctx, camera, opts)  world space, glow points only (above darkness)
 *   nearMiss   0..1 decaying pulse set when a lunge misses (read by ThreatSystem)
 *   listening  true while it has stopped to listen for the player
 *   stats      counters for tooling { bursts, attacks, hits, nearMisses, retreats, listens }
 *   new AT.Creature(level, diff, bus, { seed })  optional 4th arg for determinism
 */
(function (AT) {
  'use strict';

  const U = AT.util;
  const TAU = Math.PI * 2;
  const FAR = 99999;

  const S = {
    DORMANT: 'DORMANT',
    DISTANT: 'DISTANT',
    OBSERVING: 'OBSERVING',
    APPROACHING: 'APPROACHING',
    PURSUING: 'PURSUING',
    BURST: 'BURST',
    ATTACK: 'ATTACK',
    RECOVERING: 'RECOVERING',
  };

  // ---------------------------------------------------------------------------
  // Tuning. Speeds are Normal baselines in u/s, scaled at runtime by
  // diff.creature.speed × mode profile × section.speedMul. Verified with the
  // Node pursuit harness (see the creature agent report for the numbers).
  // ---------------------------------------------------------------------------
  const T = {
    segments: 22,
    spacing: 32, // follow-the-leader link length (body ≈ 670u)
    hugInset: 30, // head runs this far off the wall's inner face (slightly fused into it)
    speed: { approach: 268, pursue: 250, creep: 200, burst: 560, recover: 150, observe: 28, distant: 70 },
    steerRate: 3.2, // 1/s — velocity eases toward the desired velocity (no instant turns)
    burstSteerRate: 6.5,
    catchUpStart: 950, // vertical gap beyond which it is surely off-screen → closes faster
    catchUpGain: 1.1, // extra u/s per unit of gap beyond catchUpStart
    catchUpMax: 900,
    maxGap: 2300, // hard rubber band (÷ √aggression); applied off-screen only
    maxModeSpeed: 1.1, // cap on mode profile × section speedMul
    pursueRange: 950, // APPROACHING → PURSUING
    loseRange: 1400, // PURSUING → APPROACHING
    swingNear: 380, // |vertical gap| below which the head leaves the wall for the player
    swingFar: 700,
    burstMin: 320, // bursts only start in this distance window (never point-blank)
    burstMax: 1500,
    burstDurMin: 0.85,
    burstDurMax: 1.25,
    engageMul: 2.5, // attack wind-up starts inside killRadius × this
    strikeMul: 1.6, // the lunge connects only if the player is within killRadius × this
    windup: 0.6, // telegraph (s), shortened by √aggression
    windupMin: 0.35,
    windupCreep: 1.05, // committed advance during the wind-up (× pursue speed)
    strikeTime: 0.14,
    postStrike: 0.4,
    drainPursue: 0.06, // stamina / s while PURSUING (× diff staminaDrain)
    drainBurst: 0.24,
    drainBurstEntry: 0.1,
    drainLunge: 0.18,
    regenRecover: 0.16, // stamina / s while RECOVERING (× diff staminaRegen)
    regenObserve: 0.08,
    recoverTo: 0.62, // RECOVERING ends once stamina is back above this…
    recoverMin: 2.2, // …and at least this long has passed (s)
    observeMin: 0.8,
    observeMax: 1.6,
    listenDelay: 1.0, // player still this long → it stops to listen
    listenDur: 1.5,
    listenCooldown: 9,
    listenRange: 1700,
    stillSpeed: 45, // player speed below which they count as "still"
    moveSpeed: 110, // player speed that counts as "making noise" while it listens
    graceRespawn: 3.5,
    graceSection: 2.5,
    stepInterval: 0.055, // creature:step rate limit (s)
    detailRange: 650, // render: fine detail only within this distance of the player (lantern)
    sightingDuration: 8.5,
  };

  /** Per-mode behaviour profiles (multipliers / bursts per minute). */
  const MODES = {
    dormant: { speed: 0.5, burst: 0, listen: 1, recover: 1, observe: 1 },
    sighting: { speed: 0.5, burst: 0, listen: 1, recover: 1, observe: 1 },
    stalk: { speed: 0.92, burst: 1.6, listen: 1.25, recover: 1.15, observe: 1.25 },
    hunt: { speed: 1.0, burst: 2.6, listen: 1.0, recover: 1.0, observe: 1.0 },
    frenzy: { speed: 1.05, burst: 4.2, listen: 0.8, recover: 0.8, observe: 0.7 },
    escape: { speed: 1.1, burst: 3.4, listen: 0.65, recover: 0.65, observe: 0.55 },
  };
  const LETHAL_MODES = { stalk: true, hunt: true, frenzy: true, escape: true };

  const SECTION_DEFAULTS = { mode: 'dormant', lethal: false, speedMul: 1, burstRate: 0, spawnOffsetY: -1200 };

  /** Sensory-glow level per state (pits brighten when it listens / strikes). */
  const GLOW = {
    DORMANT: 0.1,
    DISTANT: 0.2,
    OBSERVING: 0.95,
    APPROACHING: 0.35,
    PURSUING: 0.45,
    BURST: 0.6,
    ATTACK: 1,
    RECOVERING: 0.1,
  };
  /** How strongly the fronds turn toward the player per state. */
  const FOCUS = {
    DORMANT: 0,
    DISTANT: 0.1,
    OBSERVING: 0.6,
    APPROACHING: 0.15,
    PURSUING: 0.25,
    BURST: 0.4,
    ATTACK: 0.2, // the wind-up FLARES the crown open rather than pointing it
    RECOVERING: 0,
  };
  /** Frond unfurl per state (1 = fully spread). */
  const UNFURL = {
    DORMANT: 0.5,
    DISTANT: 0.8,
    OBSERVING: 1.15,
    APPROACHING: 0.95,
    PURSUING: 0.95,
    BURST: 0.7,
    ATTACK: 1.6,
    RECOVERING: 0.6,
  };
  /** Agitation (audio intensity) per state, before speed is mixed in. */
  const AGITATION = {
    DORMANT: 0.12,
    DISTANT: 0.25,
    OBSERVING: 0.4,
    APPROACHING: 0.55,
    PURSUING: 0.7,
    BURST: 1,
    ATTACK: 1,
    RECOVERING: 0.35,
  };

  // Limb layout: [segment, side, reach, forward bias, weight]. Front limbs are
  // longer, reach further ahead and land harder (louder steps).
  const LIMBS = [
    [1, 1, 225, 0.5, 1],
    [2, -1, 220, 0.45, 1],
    [4, 1, 210, 0.35, 0.9],
    [5, -1, 205, 0.3, 0.9],
    [8, 1, 190, 0.2, 0.8],
    [9, -1, 185, 0.15, 0.8],
    [12, 1, 170, 0.05, 0.7],
    [13, -1, 165, 0, 0.7],
    [17, 1, 145, -0.05, 0.55],
    [18, -1, 140, -0.1, 0.55],
  ];
  const STALKS = 8;
  const PITS = 4;

  // Palette (original): charcoal/slate masonry, oxidised iron, verdigris rim, bone-pale glow.
  const COL = {
    body: '#0d1011',
    plate: '#1b2123',
    plateHi: '#283033',
    ironPlate: '#1f2626',
    seam: '#060708',
    rim: '#4f8178',
    rust: '#7a3b22',
    stone: '#3b3a35',
    rivet: '#5d645f',
    limb: '#0f1213',
    limbHi: '#323b3c',
    stalk: '#46524e',
    stalkPale: '#8c9891',
    tip: '#9fc4b8',
    iron: '#262c2c',
    rebar: '#3e3a35',
    pit: '#030404',
    glow: '#b8f0e0',
    hc: '#e8dcc0',
    farBody: '#07090b',
    farFrond: '#5d7a78',
    farRim: '#6fa3b5',
  };

  function num(v, fallback) {
    return typeof v === 'number' && isFinite(v) ? v : fallback;
  }
  function angleDelta(target, from) {
    return Math.atan2(Math.sin(target - from), Math.cos(target - from));
  }

  // ---------------------------------------------------------------------------
  // Bus wiring. Exactly one set of listeners per bus, dispatching to the most
  // recently constructed creature — the Game builds a new Creature per run on a
  // long-lived bus, so per-instance subscriptions would leak and double-fire.
  // ---------------------------------------------------------------------------
  const busLinks = typeof WeakMap === 'function' ? new WeakMap() : null;
  function linkBus(bus, creature) {
    if (!bus || typeof bus.on !== 'function' || !busLinks) return;
    let link = busLinks.get(bus);
    if (!link) {
      link = { creature: null };
      bus.on('trigger:sighting', (p) => {
        if (link.creature) link.creature._onSightingTrigger(p);
      });
      bus.on('trigger:call', () => {
        if (link.creature) link.creature._onCallTrigger();
      });
      busLinks.set(bus, link);
    }
    link.creature = creature;
  }

  // Lazily built glow sprites (browser only; Node never renders).
  let glowSprite = null;
  let backlightSprite = null;
  function makeRadialSprite(size, stops) {
    if (typeof document === 'undefined' || !document.createElement) return null;
    try {
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const g = c.getContext('2d');
      const h = size / 2;
      const grad = g.createRadialGradient(h, h, 0, h, h, h);
      for (let i = 0; i < stops.length; i++) grad.addColorStop(stops[i][0], stops[i][1]);
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      return c;
    } catch {
      return null;
    }
  }
  function getGlowSprite() {
    if (!glowSprite) {
      glowSprite = makeRadialSprite(64, [
        [0, 'rgba(232,255,246,1)'],
        [0.18, 'rgba(184,240,224,0.85)'],
        [0.45, 'rgba(120,200,180,0.22)'],
        [1, 'rgba(90,160,150,0)'],
      ]);
    }
    return glowSprite;
  }
  function getBacklightSprite() {
    if (!backlightSprite) {
      backlightSprite = makeRadialSprite(128, [
        [0, 'rgba(111,163,181,0.55)'],
        [0.35, 'rgba(80,128,146,0.28)'],
        [1, 'rgba(40,70,84,0)'],
      ]);
    }
    return backlightSprite;
  }

  // ===========================================================================
  // Creature
  // ===========================================================================
  class Creature {
    /**
     * @param {AT.Level} level
     * @param {object} diff      AT.DIFFICULTY[key]
     * @param {AT.EventBus} bus
     * @param {{seed?:number}} [options]  deterministic seed (tooling); random by default
     */
    constructor(level, diff, bus, options) {
      this.level = level;
      this.diff = diff || (AT.DIFFICULTY && AT.DIFFICULTY.normal) || {};
      this.bus = bus || null;
      const cd = this.diff.creature || {};
      this.cfg = {
        enabled: cd.enabled !== false && !!level,
        speed: Math.max(0, num(cd.speed, 1)),
        aggression: Math.max(0.5, num(cd.aggression, 1)),
        staminaDrain: Math.max(0.05, num(cd.staminaDrain, 1)),
        staminaRegen: Math.max(0.05, num(cd.staminaRegen, 1)),
        killRadius: Math.max(16, num(cd.killRadius, 64)),
      };
      /** false in sandbox (diff.creature.enabled === false): never appears, never kills, silent. */
      this.active = this.cfg.enabled;
      this.seed = options && isFinite(options.seed) ? options.seed | 0 : (Math.random() * 1e9) | 0;
      this._rand = U.rng(this.seed);

      // Body (preallocated, reused every frame).
      const n = T.segments;
      this.segX = new Float64Array(n);
      this.segY = new Float64Array(n);
      this.segR = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        // Broad shoulders behind the crown, long taper to a thin tail.
        this.segR[i] = i === 0 ? 38 : U.lerp(46, 11, Math.pow(U.smoothstep(0.1, 1, t), 0.8));
      }
      // Irregular masonry: per-plate size jitter and stone/iron plate types (render only).
      this.segK = new Float64Array(n);
      this.segIron = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        this.segK[i] = 0.86 + this._rand() * 0.28;
        this.segIron[i] = this._rand() < 0.3 ? 1 : 0;
      }
      this.limbs = LIMBS.map((def, i) => ({
        seg: def[0],
        side: def[1],
        reach: def[2],
        fwd: def[3],
        weight: def[4],
        partner: i ^ 1,
        back: i % 2 === 0, // drawn behind the body
        ax: 0, ay: 0, // attach point on the body
        dx: 0, dy: 0, // desired foothold this frame
        nx: 0, ny: 0, // outward normal
        fx: 0, fy: 0, // current foot
        ox: 0, oy: 0, // step start
        tx: 0, ty: 0, // step target
        t: -1, // step progress 0..1, -1 when not stepping
        dur: 0.25,
        planted: false,
        gripTimer: 0,
        sway: this._rand() * TAU,
      }));
      // Crown: fronds (base → control → tip) and glow pits.
      this.stalkLen = new Float64Array(STALKS);
      this.stalkPhase = new Float64Array(STALKS);
      for (let i = 0; i < STALKS; i++) {
        const mid = 1 - Math.abs(i / (STALKS - 1) - 0.5) * 2;
        this.stalkLen[i] = 66 + mid * 44 + this._rand() * 26;
        this.stalkPhase[i] = this._rand() * TAU;
      }
      this.stalkBX = new Float64Array(STALKS);
      this.stalkBY = new Float64Array(STALKS);
      this.stalkMX = new Float64Array(STALKS);
      this.stalkMY = new Float64Array(STALKS);
      this.stalkTX = new Float64Array(STALKS);
      this.stalkTY = new Float64Array(STALKS);
      this.stalkGlow = new Float64Array(STALKS);
      this.pitX = new Float64Array(PITS);
      this.pitY = new Float64Array(PITS);
      this.pitGlow = new Float64Array(PITS);

      this.bbox = { x0: 0, y0: 0, x1: 0, y1: 0 };
      this.audio = { x: 0, y: 0, distance: FAR, intensity: 0, movement: 0, state: S.DORMANT };
      this.attack = { phase: null, t: 0, windup: 0.5, sx: 0, sy: 0, lx: 0, ly: 0, hit: false };
      this._solidScratch = [];
      this._gripScratch = [];
      this._far = { ax: 0, ay: 0, hx: 0, hy: 0, len: 0, th: 0, alpha: 0, look: 0, u: 0, dir: 1, sc: 1, W: 1, H: 1 };
      this._crownX = 0; // crown origin (head, reared back during the wind-up)
      this._crownY = 0;
      this._kx = 0; // scratch knee position (render)
      this._ky = 0;
      this._farGX = new Float64Array(PITS);
      this._farGY = new Float64Array(PITS);

      linkBus(this.bus, this);
      this.reset(null);
    }

    // =========================================================================
    // Lifecycle
    // =========================================================================

    /** Full reset for a new run. Configures itself for the player's section when a player is given. */
    reset(player) {
      this.state = S.DORMANT;
      this.stateTime = 0;
      this.stateDur = 0;
      this.stamina = 1;
      this.x = 0;
      this.y = 0;
      this.vx = 0;
      this.vy = 0;
      this.speed = 0;
      this.hx = 0; // smoothed heading (unit)
      this.hy = 1;
      this.distance = FAR;
      this.lethal = false;
      this.caughtPlayer = false;
      this.sighting = null;
      this.sightingDone = false;
      this.inPlay = false;
      this.victory = null;
      this.nearMiss = 0;
      this.listening = false;
      this.grace = 0;
      this.mode = 'dormant';
      this.profile = MODES.dormant;
      this.sectionIndex = -1;
      this.sectionCfg = Object.assign({}, SECTION_DEFAULTS);
      this.side = this._rand() < 0.5 ? -1 : 1;
      this.wallL = 0;
      this.wallR = 0;
      this._wallScanY = NaN;
      this._wallScanT = 0;
      this.stillTime = 0;
      this._listenedThisStill = false;
      this.playerSpeed = 0;
      this._px = 0;
      this._py = 0;
      this._t = 0;
      this.time = 0;
      this._stepCd = 0;
      this._hitch = 1;
      this._hitchLeft = 0;
      this._hitchTimer = 2 + this._rand() * 3;
      this.burstTimer = 5;
      this.listenCd = 0;
      this.routeTimer = 8 + this._rand() * 8;
      this.callTimer = 14 + this._rand() * 16;
      this._ambTimer = 10 + this._rand() * 10;
      this._ambSteps = 0;
      this._ambStepTimer = 0;
      this._ambCallTimer = 25 + this._rand() * 20;
      this._answerTimer = 0;
      this._farOffsetY = 2600 + this._rand() * 700;
      this._sightTrigger = null;
      this._sightAuto = -1;
      this._glow = 0.1;
      this._unfurl = 0.6;
      this.attack.phase = null;
      this.stats = { bursts: 0, attacks: 0, hits: 0, nearMisses: 0, retreats: 0, listens: 0 };
      this._applyScaling(SECTION_DEFAULTS);
      const lv = this.level;
      const ref = player || (lv && lv.spawn) || { x: 0, y: 0 };
      this._placeFar(ref);
      if (player && lv && lv.sections && lv.sections.length) {
        const i = lv.sectionIndexAt(player.y);
        this.setSection(i, lv.sections[i], player);
      }
      this._updateAudio(player);
    }

    /**
     * Applies a section's `creature` config. Lethal modes bring it into play from
     * above (spawnOffsetY) if it is not already hunting; non-lethal modes keep it
     * far away. Re-applying the current section is harmless.
     */
    setSection(index, section, player) {
      const lv = this.level;
      const sec = section || (lv && lv.sections && lv.sections[index]) || null;
      const c = Object.assign({}, SECTION_DEFAULTS, sec && sec.creature);
      const mode = MODES[c.mode] ? c.mode : 'dormant';
      const prevIndex = this.sectionIndex;
      this.sectionIndex = index;
      if (!this.active) {
        this.mode = mode;
        return;
      }
      if (this.victory) return;
      const lethalMode = LETHAL_MODES[mode] === true;
      // Climbing back above the hunt does not shake it off: keep hunting.
      if (!lethalMode && this.inPlay && index < prevIndex) return;

      this.mode = mode;
      this.profile = MODES[mode];
      this.sectionCfg = c;
      this._applyScaling(c);
      if (lethalMode) {
        this.lethal = c.lethal === true;
        if (!this.inPlay) this._enterPlay(player, c.spawnOffsetY, T.graceSection);
      } else {
        this.lethal = false;
        if (this.inPlay) this._leavePlay();
        this._sightTrigger = null;
        this._sightAuto = -1;
        if (mode === 'sighting' && !this.sightingDone) {
          const trig = sec && Array.isArray(sec.triggers) ? sec.triggers.find((t) => t && t.name === 'sighting') : null;
          this._sightTrigger = trig || null;
          if (!trig) this._sightAuto = 1.5;
          this._setState(S.DISTANT);
        } else {
          this._setState(mode === 'sighting' ? S.DISTANT : S.DORMANT);
        }
        if (player) this._placeFar(player);
      }
    }

    /** Respawn: reposition 1100–1500u above the player, ≥3 s grace, APPROACHING. */
    onRespawn(player) {
      if (!this.active || !player) return;
      this.caughtPlayer = false;
      this.attack.phase = null;
      this.nearMiss = 0;
      this.stillTime = 0;
      this.listening = false;
      if (this.victory) return;
      const lv = this.level;
      const i = lv.sectionIndexAt(player.y);
      const sec = lv.sections[i];
      const mode = sec && sec.creature && MODES[sec.creature.mode] ? sec.creature.mode : 'dormant';
      this.sectionIndex = -1;
      if (LETHAL_MODES[mode]) {
        // Configure for the section without its entry spawn, then place it for the respawn.
        this.inPlay = true;
        this.setSection(i, sec, player);
        this._enterPlay(player, -(1100 + this._rand() * 400), T.graceRespawn);
        this.stamina = 0.9;
      } else {
        this.inPlay = false;
        this.setSection(i, sec, player);
      }
    }

    /**
     * Victory: charge the chamber gate, slam it (cannot kill), then retreat.
     * Works for a horizontal grating (chamber below) or a vertical one (chamber
     * beside it): the slam side is the one facing away from the goal.
     */
    onVictory(gate) {
      if (!this.active) return;
      const lv = this.level;
      const g = gate || (lv && lv.gate) || null;
      const goal = lv && lv.goal ? lv.goal : null;
      let gx = this.x;
      let gy = this.y + 400;
      let ox = 0; // outward normal of the struck face (points away from the chamber)
      let oy = -1;
      if (g) {
        const gcx = g.x + g.w / 2;
        const gcy = g.y + g.h / 2;
        const tx = goal ? goal.x + goal.w / 2 : this._px;
        const ty = goal ? goal.y + goal.h / 2 : this._py;
        const dx = tx - gcx;
        const dy = ty - gcy;
        if (g.h > g.w) {
          ox = dx > 0 ? -1 : 1; // chamber beside the grating
          oy = 0;
          gx = ox < 0 ? g.x : g.x + g.w;
          gy = gcy;
        } else {
          ox = 0; // chamber below (or above) the grating
          oy = dy >= 0 ? -1 : 1;
          gx = gcx;
          gy = oy < 0 ? g.y : g.y + g.h;
        }
      }
      this.lethal = false;
      this.caughtPlayer = false;
      this.grace = 1e9;
      this.listening = false;
      this.attack.phase = null;
      this.victory = { phase: 'charge', t: 0, gx, gy, ox, oy };
      if (!this.inPlay || Math.hypot(this.x - gx, this.y - gy) > 1400) {
        // Bring it in from just out of sight so the slam lands while the camera is still there.
        this.inPlay = true;
        this._scanWalls(gy - 800);
        this.x = U.clamp(gx + ox * 320, this.wallL + T.hugInset, this.wallR - T.hugInset);
        this.y = gy - 900;
        this.vx = 0;
        this.vy = 300;
        this._layBody(0, 1);
      }
      this.stateDur = 1.6;
      this._setState(S.BURST);
      this.stats.bursts++;
      this._emit('creature:burst', { x: this.x, y: this.y, distance: this.distance });
    }

    // =========================================================================
    // Update
    // =========================================================================

    /**
     * Advances behaviour, body, limbs and crown. Call once per frame while playing.
     * @param {number} dt      frame delta (s), capped internally at 0.1
     * @param {AT.Player} player
     * @param {number} [time]  run time (s), kept for reference
     */
    update(dt, player, time) {
      if (!(dt > 0)) return;
      if (dt > 0.1) dt = 0.1;
      this._t += dt;
      if (typeof time === 'number' && isFinite(time)) this.time = time;
      this.nearMiss = Math.max(0, this.nearMiss - dt * 1.1);
      if (!this.active) {
        this._quiet();
        return;
      }
      if (!player) {
        this._updateAudio(null);
        return;
      }
      this._px = player.x;
      this._py = player.y;
      const alive = player.alive !== false;
      const pv = Math.hypot(player.vx || 0, player.vy || 0);
      this.playerSpeed = pv;
      if (alive && pv < T.stillSpeed) this.stillTime += dt;
      else {
        this.stillTime = 0;
        this._listenedThisStill = false;
      }

      // Self-configure if the game has not told us about the section yet.
      const lv = this.level;
      if (!this.victory && lv && lv.sections && lv.sections.length) {
        const si = lv.sectionIndexAt(player.y);
        if (si !== this.sectionIndex) this.setSection(si, lv.sections[si], player);
      }

      this.stateTime += dt;
      this._stepCd -= dt;

      if (this.victory) this._updateVictory(dt, player);
      else if (this.inPlay) this._updateHunt(dt, player);
      else if (this.mode === 'sighting') this._updateSighting(dt, player);
      else this._updateDormant(dt, player);

      this.speed = Math.hypot(this.vx, this.vy);
      if (this.inPlay) {
        this.distance = Math.hypot(player.x - this.x, player.y - this.y);
        this._updateHeading(dt);
        this._updateBody();
        this._updateLimbs(dt, player);
        this._updateCrown(dt);
        this._updateBBox();
      }
      this._updateAudio(player);
    }

    // ---- hunting (stalk / hunt / frenzy / escape) -------------------------------

    _updateHunt(dt, player) {
      const alive = player.alive !== false;
      const dist = Math.hypot(player.x - this.x, player.y - this.y);
      const gapY = player.y - this.y;
      this.distance = dist;
      this.grace = Math.max(0, this.grace - dt);
      this.listenCd -= dt;
      this.burstTimer -= dt;
      this.routeTimer -= dt;
      this.callTimer -= dt;
      this._tickHitch(dt);

      // Hard rubber band: never let it fall hopelessly far behind (it is off-screen there).
      if (gapY > this.maxGap) this._shift(0, gapY - this.maxGap);

      const engage = this.cfg.killRadius * T.engageMul;
      const canAttack = this.lethal && alive && this.grace <= 0;
      const st = this.state;

      if (!alive && (st === S.APPROACHING || st === S.PURSUING || st === S.BURST)) {
        this._enterObserve(2.5, false); // hangs over the fallen, fronds searching
      } else {
        switch (st) {
          case S.APPROACHING:
          case S.PURSUING:
            if (st === S.PURSUING) this._drain(T.drainPursue * dt);
            if (canAttack && dist < engage) this._startAttack();
            else if (this.stamina <= 0) this._setState(S.RECOVERING);
            else if (this._shouldListen(dist, alive)) this._enterObserve(this.listenDur, true);
            else if (this._shouldBurst(dist)) this._startBurst();
            else {
              if (st === S.APPROACHING && dist < T.pursueRange) this._setState(S.PURSUING);
              else if (st === S.PURSUING && dist > T.loseRange) this._setState(S.APPROACHING);
              if (this.routeTimer <= 0) this._maybeChangeRoute(player, gapY);
              if (this.callTimer <= 0) this._ambientCall(dist);
            }
            break;
          case S.BURST:
            this._drain(T.drainBurst * dt);
            if (canAttack && dist < engage) this._startAttack();
            else if (this.stateTime >= this.stateDur || (!canAttack && dist < engage)) {
              if (this.stamina <= 0) this._setState(S.RECOVERING);
              else this._setState(dist < T.pursueRange ? S.PURSUING : S.APPROACHING);
            }
            break;
          case S.OBSERVING:
            this._regen(T.regenObserve * dt);
            if (this.listening && alive && this.playerSpeed > T.moveSpeed && this.stateTime > 0.25) {
              // It heard you move.
              this.listening = false;
              if (this.stamina > 0.3 && dist > T.burstMin * 0.6 && dist < T.burstMax) this._startBurst();
              else this._setState(S.PURSUING);
            } else if (this.stateTime >= this.stateDur) {
              if (!alive) this.stateDur += 1;
              else {
                this.listening = false;
                this._setState(dist < T.pursueRange ? S.PURSUING : S.APPROACHING);
              }
            }
            break;
          case S.ATTACK:
            this._updateAttack(dt, player);
            return; // the attack drives its own movement
          case S.RECOVERING:
            this._regen(T.regenRecover * dt);
            if (this.stateTime >= this.stateDur && this.stamina >= T.recoverTo) {
              const dur = (T.observeMin + this._rand() * (T.observeMax - T.observeMin)) * this.profile.observe;
              this._enterObserve(dur / Math.sqrt(this.cfg.aggression), false);
            }
            break;
          default:
            this._setState(S.APPROACHING);
        }
      }
      if (this.state === S.ATTACK) return; // wind-up starts moving next frame
      this._steerHunt(dt, player, dist, gapY);
    }

    _shouldListen(dist, alive) {
      return (
        alive &&
        this.stillTime >= this.listenDelay &&
        !this._listenedThisStill &&
        this.listenCd <= 0 &&
        dist < T.listenRange &&
        dist > this.cfg.killRadius * T.engageMul * 1.2
      );
    }

    _shouldBurst(dist) {
      return (
        this.burstRate > 0 &&
        this.burstTimer <= 0 &&
        this.stamina > 0.3 &&
        dist > T.burstMin &&
        dist < T.burstMax &&
        this.stillTime < this.listenDelay // a still player is stalked, not charged
      );
    }

    _steerHunt(dt, player, dist, gapY) {
      const spd = this.speedScale;
      this._scanWallsIfNeeded(dt);
      const hugX = this._hugX();
      const swing = 1 - U.smoothstep(T.swingNear, T.swingFar, Math.abs(gapY));
      let tx = U.lerp(hugX, player.x, swing);
      let ty = player.y;
      let speed = 0;
      let rate = T.steerRate;
      const noise = this._noise();
      switch (this.state) {
        case S.APPROACHING:
        case S.PURSUING: {
          const base = this.state === S.PURSUING ? T.speed.pursue : T.speed.approach;
          speed = base * spd * noise * this._hitch;
          if (this.stillTime >= this.listenDelay) {
            // Stalking a silent player: slow, deliberate, steady.
            speed = Math.min(speed, T.speed.creep * spd * (0.88 + 0.18 * noise));
          }
          if (gapY > T.catchUpStart) speed += Math.min(T.catchUpMax, (gapY - T.catchUpStart) * T.catchUpGain);
          if (!this.lethal) {
            // Non-lethal hunting (data-driven): it looms but holds off.
            const hold = this.cfg.killRadius * T.engageMul * 1.6;
            speed *= U.clamp((dist - hold * 0.75) / (hold * 0.25), 0, 1);
          }
          break;
        }
        case S.BURST:
          speed = T.speed.burst * spd * (0.85 + 0.25 * noise);
          if (gapY > T.catchUpStart) speed += Math.min(T.catchUpMax, (gapY - T.catchUpStart) * T.catchUpGain);
          rate = T.burstSteerRate;
          tx = U.lerp(hugX, player.x, Math.max(swing, 0.55));
          break;
        case S.OBSERVING:
          // Hesitates: holds on the wall, sways, drifts a little toward the sound.
          speed = T.speed.observe * spd * (0.5 + noise * 0.5);
          tx = hugX + Math.sin(this._t * 0.7 + this.seed) * 40;
          ty = this.y + U.clamp(gapY, -60, 60);
          rate = 2;
          break;
        case S.RECOVERING: {
          // Withdraws upward, into the dark beside the masonry, slowing as it goes.
          const k = 1 - U.smoothstep(0, Math.max(this.stateDur, 0.5) * 1.2, this.stateTime);
          speed = (T.speed.recover * k + 22) * Math.max(0.6, spd);
          tx = hugX;
          ty = this.y - 420;
          rate = 2.2;
          break;
        }
        default:
          speed = 0;
      }
      this._moveToward(tx, ty, speed, rate, dt);
      this._clampToShaft();
    }

    _hugX() {
      return this.side < 0 ? this.wallL + T.hugInset : this.wallR - T.hugInset;
    }

    _maybeChangeRoute(player, gapY) {
      this.routeTimer = 7 + this._rand() * 9;
      if (Math.abs(gapY) < 500) return; // never while it is reaching for you
      const mid = (this.wallL + this.wallR) * 0.5;
      const playerSide = player.x < mid ? -1 : 1;
      this.side = this._rand() < 0.7 ? playerSide : -playerSide;
    }

    // ---- attack ------------------------------------------------------------------

    _startAttack() {
      const a = this.attack;
      a.phase = 'windup';
      a.t = 0;
      a.hit = false;
      a.windup = U.clamp(T.windup / Math.pow(this.cfg.aggression, 0.55), T.windupMin, T.windup);
      this.stats.attacks++;
      this._setState(S.ATTACK);
      this._emit('creature:attack', { x: this.x, y: this.y });
    }

    _updateAttack(dt, player) {
      const a = this.attack;
      if (!a.phase) {
        this._setState(S.RECOVERING);
        return;
      }
      if (dt <= 0) return;
      a.t += dt;
      if (a.phase === 'windup') {
        // Committed, telegraphed advance while the crown flares. Moving away
        // fast enough during this window turns the lunge into a near miss.
        const speed = T.speed.pursue * this.speedScale * T.windupCreep;
        this._moveToward(player.x, player.y, speed, 6, dt);
        if (a.t >= a.windup) this._strike(player);
      } else if (a.phase === 'strike') {
        const k = Math.min(1, a.t / T.strikeTime);
        const e = 1 - (1 - k) * (1 - k);
        const nx = U.lerp(a.sx, a.lx, e);
        const ny = U.lerp(a.sy, a.ly, e);
        this.vx = (nx - this.x) / dt;
        this.vy = (ny - this.y) / dt;
        this.x = nx;
        this.y = ny;
        if (a.t >= T.strikeTime) {
          a.phase = 'recoil';
          a.t = 0;
        }
      } else {
        this._moveToward(a.sx, a.sy - 70, 260, 4, dt);
        if (a.t >= T.postStrike) {
          a.phase = null;
          this._setState(S.RECOVERING);
        }
      }
    }

    _strike(player) {
      const a = this.attack;
      const dx = player.x - this.x;
      const dy = player.y - this.y;
      const d = Math.hypot(dx, dy) || 1;
      const reach = this.cfg.killRadius * T.strikeMul;
      const hit = this.lethal && player.alive !== false && this.grace <= 0 && d <= reach;
      a.sx = this.x;
      a.sy = this.y;
      if (hit) {
        a.lx = player.x;
        a.ly = player.y;
        this.caughtPlayer = true;
        this.stats.hits++;
      } else {
        const ext = Math.min(d, reach + 40);
        a.lx = this.x + (dx / d) * ext;
        a.ly = this.y + (dy / d) * ext;
        this.nearMiss = d < reach * 2.2 ? 1 : 0.6;
        this.stats.nearMisses++;
      }
      a.hit = hit;
      a.phase = 'strike';
      a.t = 0;
      this._drain(T.drainLunge);
      this._emitStep(a.lx, a.ly, 1, Math.hypot(player.x - a.lx, player.y - a.ly), true);
    }

    // ---- victory -------------------------------------------------------------------

    _updateVictory(dt, player) {
      const v = this.victory;
      v.t += dt;
      this.distance = Math.hypot(player.x - this.x, player.y - this.y);
      if (v.phase === 'charge') {
        const tx = v.gx + v.ox * 26;
        const ty = v.gy + v.oy * 26;
        this._moveToward(tx, ty, 980, 7, dt);
        if (Math.hypot(tx - this.x, ty - this.y) < 50 || v.t > 1.5) {
          v.phase = 'slam';
          v.t = 0;
          this.vx *= -0.25;
          this.vy *= -0.25;
          this._setState(S.ATTACK);
          this._emit('creature:attack', { x: this.x, y: this.y, gate: true });
          this._emitStep(v.gx, v.gy, 1, this.distance, true);
          this.nearMiss = 1;
        }
      } else if (v.phase === 'slam') {
        // Recoil off the grating, crown thrashing.
        const shake = Math.sin(v.t * 20) * 14;
        this._moveToward(v.gx + v.ox * 90 + v.oy * shake, v.gy + v.oy * 90 - v.ox * shake, 160, 5, dt);
        if (v.t > 0.6) {
          v.phase = 'retreat';
          v.t = 0;
          this.stateDur = 3;
          this._setState(S.RECOVERING);
        }
      } else {
        this._scanWallsIfNeeded(dt);
        this._moveToward(this._hugX(), this.y - 400, U.lerp(200, 60, U.clamp(v.t / 4, 0, 1)), 2, dt);
      }
    }

    // ---- dormant / sighting (far away, unseen) --------------------------------------

    _placeFar(ref) {
      const lv = this.level;
      const b = lv && lv.bounds ? lv.bounds : { x0: 0, x1: 1800 };
      this.x = this.side < 0 ? b.x0 - 400 : b.x1 + 400;
      this.y = num(ref && ref.y, 0) + this._farOffsetY;
      this.vx = 0;
      this.vy = 0;
    }

    _updateDormant(dt, player) {
      // Somewhere deep in the structure: only rare, distant sounds.
      this._farOffsetY = U.clamp(this._farOffsetY + U.noise1(this._t * 0.05, this.seed) * 40 * dt, 2200, 3600);
      this._placeFar(player);
      this.distance = Math.hypot(player.x - this.x, player.y - this.y);
      this._ambientSounds(dt);
    }

    _ambientSounds(dt) {
      this._ambTimer -= dt;
      if (this._ambTimer <= 0) {
        this._ambTimer = 13 + this._rand() * 14;
        this._ambSteps = 2 + ((this._rand() * 3) | 0);
        this._ambStepTimer = 0;
      }
      if (this._ambSteps > 0) {
        this._ambStepTimer -= dt;
        if (this._ambStepTimer <= 0) {
          this._ambSteps--;
          this._ambStepTimer = 0.25 + this._rand() * 0.45;
          this._emitStep(this.x + (this._rand() - 0.5) * 300, this.y + (this._rand() - 0.5) * 300, 0.25 + this._rand() * 0.3, this.distance, true);
        }
      }
      this._ambCallTimer -= dt;
      if (this._ambCallTimer <= 0) {
        this._ambCallTimer = 35 + this._rand() * 35;
        if (this._rand() < 0.5) this.side = -this.side; // the next sound comes from elsewhere
        this._emit('creature:call', { x: this.x, y: this.y, distance: this.distance, intensity: 0.3 + this._rand() * 0.2 });
      }
    }

    _updateSighting(dt, player) {
      if (!this.sighting && !this.sightingDone) {
        const trig = this._sightTrigger;
        if (trig) {
          // Fallback in case the trigger event was never delivered.
          if (player.y >= num(trig.y, Infinity) + 160) this._beginSighting(trig.data, player);
        } else if (this._sightAuto > 0) {
          this._sightAuto -= dt;
          if (this._sightAuto <= 0) this._beginSighting(null, player);
        }
      }
      const s = this.sighting;
      if (s) {
        s.t += dt;
        const k = s.t / s.duration;
        const want = k >= 0.4 && k < 0.62 ? S.OBSERVING : S.DISTANT;
        if (this.state !== want) this._setState(want);
        // Audio position: genuinely far (out across the void, deep below the
        // gallery the player stands in), travelling left↔right with the silhouette.
        this.x = s.x + s.dir * (this._crossU(k) - 0.5) * 3000;
        this.y = s.y + 1900;
        this.vx = s.dir * 160;
        this.vy = 0;
        this.distance = Math.hypot(player.x - this.x, player.y - this.y);
        if (s.t >= s.duration) {
          this.sighting = null;
          this.sightingDone = true;
          this._answerTimer = 2.8; // …and something answers.
          this._setState(S.DISTANT);
          this._placeFar(player);
        }
        return;
      }
      if (this._answerTimer > 0) {
        this._answerTimer -= dt;
        if (this._answerTimer <= 0) {
          this._emit('creature:call', { x: this.x, y: this.y, distance: this.distance, intensity: 0.55 });
        }
      }
      this._updateDormant(dt, player);
    }

    /** Crossing progress with a mid-way pause (it stops, turns, "looks"). */
    _crossU(k) {
      if (k < 0.4) return (k / 0.4) * 0.46;
      if (k < 0.62) return 0.46 + ((k - 0.4) / 0.22) * 0.05;
      return 0.51 + ((k - 0.62) / 0.38) * 0.49;
    }

    _beginSighting(data, player) {
      if (!this.active || this.inPlay || this.sighting || this.sightingDone) return;
      const lv = this.level;
      const d = data || {};
      const x = num(d.x, lv && lv.width ? lv.width / 2 : 900);
      const y = num(d.y, num(player && player.y, this._py) + 220);
      const dir = d.dir === -1 || d.dir === 1 ? d.dir : this._rand() < 0.5 ? -1 : 1;
      const duration = Math.max(3, num(d.duration, T.sightingDuration));
      this.sighting = { x, y, t: 0, duration, dir };
      this._setState(S.DISTANT);
      this._emit('creature:sighting', { x, y, duration });
    }

    _onSightingTrigger(payload) {
      const p = payload || {};
      this._beginSighting(p.data, { y: num(p.y, this._py) });
    }

    _onCallTrigger() {
      if (!this.active || this.victory) return;
      this._emit('creature:call', { x: this.x, y: this.y, distance: this.distance, intensity: 0.8 });
    }

    _ambientCall(dist) {
      this.callTimer = 14 + this._rand() * 18;
      if (dist < 500) return; // close up, silence is worse
      this._emit('creature:call', { x: this.x, y: this.y, distance: dist, intensity: 0.5 + this._rand() * 0.3 });
    }

    // ---- state helpers -----------------------------------------------------------

    _setState(to) {
      if (this.state === to) return;
      const from = this.state;
      this.state = to;
      this.stateTime = 0;
      this.audio.state = to;
      if (to === S.RECOVERING) {
        if (!this.victory) this.stateDur = (T.recoverMin * this.profile.recover) / Math.sqrt(this.cfg.aggression);
        this.listening = false;
        this.stats.retreats++;
      }
      this._emit('creature:state', { from, to, x: this.x, y: this.y, distance: this.distance });
      if (to === S.RECOVERING) this._emit('creature:retreat', { x: this.x, y: this.y });
    }

    _enterObserve(dur, listening) {
      this.listening = listening;
      this.stateDur = dur;
      if (listening) {
        this.listenCd = T.listenCooldown;
        this._listenedThisStill = true;
        this.stats.listens++;
      } else if (this._rand() < 0.4) {
        this.side = -this.side; // uncertainty: it changes its route
      }
      if (this.state === S.OBSERVING) this.stateTime = 0;
      else this._setState(S.OBSERVING);
    }

    _startBurst() {
      this.stateDur = (T.burstDurMin + this._rand() * (T.burstDurMax - T.burstDurMin)) * (0.9 + 0.1 * this.cfg.aggression);
      this._drain(T.drainBurstEntry);
      this.burstTimer = Math.max(3, ((0.6 + this._rand() * 0.8) * 60) / Math.max(this.burstRate, 0.01));
      this.stats.bursts++;
      this._setState(S.BURST);
      this._emit('creature:burst', { x: this.x, y: this.y, distance: this.distance });
    }

    _drain(amount) {
      this.stamina = Math.max(0, this.stamina - amount * this.cfg.staminaDrain);
    }

    _regen(amount) {
      this.stamina = Math.min(1, this.stamina + amount * this.cfg.staminaRegen);
    }

    _applyScaling(c) {
      const aggr = this.cfg.aggression;
      const prof = this.profile || MODES.hunt;
      // Aggression adds a little extra drive on top of the raw speed scale.
      const drive = 1 + 0.1 * (aggr - 1);
      // Section speedMul stacks on the mode profile. Speed-ups are applied at half
      // strength and the product is capped (1.1 = the escape baseline) so data
      // tweaks can never make a difficulty unescapable (pursuit sims are very
      // sensitive to this: +15% raw made Abyss uncatchable-proof runs fail).
      const sm = U.clamp(num(c.speedMul, 1), 0.5, 1.6);
      const secEff = sm > 1 ? 1 + (sm - 1) * 0.5 : Math.max(0.75, sm);
      const mEff = Math.min(prof.speed * secEff, Math.max(prof.speed, T.maxModeSpeed));
      this.speedScale = this.cfg.speed * drive * mEff;
      const rate = num(c.burstRate, 0) > 0 ? c.burstRate : prof.burst;
      this.burstRate = rate * aggr;
      this.maxGap = T.maxGap / Math.sqrt(aggr);
      this.listenDelay = T.listenDelay / Math.sqrt(aggr);
      this.listenDur = (T.listenDur * prof.listen) / Math.pow(aggr, 0.7);
    }

    _enterPlay(player, offsetY, grace) {
      const lv = this.level;
      const px = player ? player.x : lv.spawn ? lv.spawn.x : 0;
      const py = player ? player.y : lv.spawn ? lv.spawn.y : 0;
      const off = Math.min(-700, num(offsetY, -1200));
      const y = py + off;
      this._scanWalls(y);
      const mid = (this.wallL + this.wallR) * 0.5;
      const near = px < mid ? -1 : 1;
      this.side = this._rand() < 0.65 ? near : -near;
      this.x = this._hugX();
      this.y = y;
      this.vx = 0;
      this.vy = 160;
      this.hx = 0;
      this.hy = 1;
      this._layBody(0, 1);
      this.inPlay = true;
      this.lethal = this.sectionCfg.lethal === true && LETHAL_MODES[this.mode] === true;
      this.sighting = null;
      this.stamina = 1;
      this.grace = grace;
      this.burstTimer = 4 + this._rand() * 3;
      this.listenCd = 2.5;
      this.attack.phase = null;
      this.listening = false;
      this.stateDur = 0;
      this._setState(S.APPROACHING);
      this._updateCrown(0);
      this._updateBBox();
    }

    _leavePlay() {
      this.inPlay = false;
      this.lethal = false;
      this.attack.phase = null;
      this.listening = false;
    }

    _quiet() {
      const a = this.audio;
      a.intensity = 0;
      a.movement = 0;
      a.distance = FAR;
      a.state = this.state;
      this.distance = FAR;
    }

    // =========================================================================
    // Movement helpers
    // =========================================================================

    /** Steers the head toward (tx, ty) at `speed`, easing velocity at `rate` (1/s). */
    _moveToward(tx, ty, speed, rate, dt) {
      const dx = tx - this.x;
      const dy = ty - this.y;
      const dl = Math.hypot(dx, dy);
      let dvx = 0;
      let dvy = 0;
      if (dl > 0.5 && speed > 0) {
        const s = Math.min(speed, dl * 3); // arrive softly instead of overshooting
        dvx = (dx / dl) * s;
        dvy = (dy / dl) * s;
      }
      const k = 1 - Math.exp(-rate * dt);
      this.vx += (dvx - this.vx) * k;
      this.vy += (dvy - this.vy) * k;
      if (!isFinite(this.vx) || !isFinite(this.vy)) {
        this.vx = 0;
        this.vy = 0;
      }
      this.x += this.vx * dt;
      this.y += this.vy * dt;
    }

    /** Smooth, irregular speed modulation (never constant): ~0.66..1.34. */
    _noise() {
      const t = this._t;
      return 1 + 0.24 * U.noise1(t * 0.6, this.seed) + 0.1 * U.noise1(t * 2.1, this.seed + 17);
    }

    /** Occasional hitches: limbs re-grip and the whole mass pauses for a beat. */
    _tickHitch(dt) {
      if (this._hitchLeft > 0) {
        this._hitchLeft -= dt;
        this._hitch = U.approach(this._hitch, 0.3, dt * 6);
      } else {
        this._hitch = U.approach(this._hitch, 1, dt * 3);
        this._hitchTimer -= dt;
        if (this._hitchTimer <= 0) {
          this._hitchTimer = 2 + this._rand() * 3.5;
          this._hitchLeft = 0.2 + this._rand() * 0.3;
        }
      }
    }

    /** Moves the whole body rigidly (used by the off-screen rubber band). */
    _shift(dx, dy) {
      this.x += dx;
      this.y += dy;
      for (let i = 0; i < T.segments; i++) {
        this.segX[i] += dx;
        this.segY[i] += dy;
      }
      for (let i = 0; i < this.limbs.length; i++) {
        const L = this.limbs[i];
        L.fx += dx;
        L.fy += dy;
        L.ox += dx;
        L.oy += dy;
        L.tx += dx;
        L.ty += dy;
      }
    }

    _clampToShaft() {
      const lo = this.wallL - 40;
      const hi = this.wallR + 40;
      if (this.x < lo) {
        this.x = lo;
        if (this.vx < 0) this.vx = 0;
      } else if (this.x > hi) {
        this.x = hi;
        if (this.vx > 0) this.vx = 0;
      }
    }

    _scanWallsIfNeeded(dt) {
      this._wallScanT -= dt;
      if (this._wallScanT <= 0 || !(Math.abs(this.y - this._wallScanY) < 80)) this._scanWalls(this.y);
    }

    /** Finds the shaft's inner wall faces around depth y (kind 'wall' solids). */
    _scanWalls(y) {
      const lv = this.level;
      const b = lv.bounds;
      const mid = (b.x0 + b.x1) * 0.5;
      let left = b.x0 + 60;
      let right = b.x1 - 60;
      let foundL = false;
      let foundR = false;
      const list = lv.querySolids(b.x0 - 800, y - 180, b.x1 + 800, y + 180, this._solidScratch);
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.kind !== 'wall' || s.active === false) continue;
        if (s.x + s.w * 0.5 < mid) {
          const e = s.x + s.w;
          if (!foundL || e > left) left = e;
          foundL = true;
        } else if (!foundR || s.x < right) {
          right = s.x;
          foundR = true;
        }
      }
      if (right - left < 240) {
        left = b.x0 + 60;
        right = b.x1 - 60;
      }
      this.wallL = left;
      this.wallR = right;
      this._wallScanY = y;
      this._wallScanT = 0.25;
    }

    // =========================================================================
    // Body, limbs, crown
    // =========================================================================

    /** Lays the body out straight behind the head (direction fx,fy = forward). */
    _layBody(fx, fy) {
      const n = T.segments;
      const l = Math.hypot(fx, fy) || 1;
      const ux = fx / l;
      const uy = fy / l;
      for (let i = 0; i < n; i++) {
        const back = i * T.spacing;
        this.segX[i] = this.x - ux * back + Math.sin(i * 0.7 + this.seed) * 6 * (i > 0 ? 1 : 0);
        this.segY[i] = this.y - uy * back;
      }
      for (let i = 0; i < this.limbs.length; i++) {
        const L = this.limbs[i];
        this._limbFrame(L);
        L.fx = L.dx;
        L.fy = L.dy;
        L.t = -1;
        L.planted = false;
        L.gripTimer = this._rand() * 0.1;
      }
    }

    _updateHeading(dt) {
      let tx;
      let ty;
      if (this.speed > 30) {
        tx = this.vx / this.speed;
        ty = this.vy / this.speed;
      } else {
        const dx = this._px - this.x;
        const dy = this._py - this.y;
        const d = Math.hypot(dx, dy) || 1;
        tx = dx / d;
        ty = dy / d;
      }
      const k = 1 - Math.exp(-5 * dt);
      this.hx += (tx - this.hx) * k;
      this.hy += (ty - this.hy) * k;
      const l = Math.hypot(this.hx, this.hy);
      if (l < 1e-4) {
        this.hx = 0;
        this.hy = 1;
      } else {
        this.hx /= l;
        this.hy /= l;
      }
    }

    /** Follow-the-leader: each plate keeps its link length to the one ahead. */
    _updateBody() {
      const sx = this.segX;
      const sy = this.segY;
      const sp = T.spacing;
      const minSp = sp * 0.72;
      sx[0] = this.x;
      sy[0] = this.y;
      for (let i = 1; i < T.segments; i++) {
        let dx = sx[i] - sx[i - 1];
        let dy = sy[i] - sy[i - 1];
        let d = Math.hypot(dx, dy);
        if (d < 1e-6) {
          dx = 0;
          dy = -1;
          d = 1;
        }
        if (d > sp) {
          sx[i] = sx[i - 1] + (dx / d) * sp;
          sy[i] = sy[i - 1] + (dy / d) * sp;
        } else if (d < minSp) {
          sx[i] = sx[i - 1] + (dx / d) * minSp;
          sy[i] = sy[i - 1] + (dy / d) * minSp;
        }
      }
    }

    /** Attach point, outward normal and desired foothold for a limb this frame. */
    _limbFrame(L) {
      const i = L.seg;
      const sx = this.segX;
      const sy = this.segY;
      let fx = sx[i - 1] - sx[i + 1];
      let fy = sy[i - 1] - sy[i + 1];
      const fl = Math.hypot(fx, fy);
      if (fl < 1e-6) {
        fx = this.hx;
        fy = this.hy;
      } else {
        fx /= fl;
        fy /= fl;
      }
      const nx = -fy * L.side;
      const ny = fx * L.side;
      const r = this.segR[i];
      L.nx = nx;
      L.ny = ny;
      L.ax = sx[i] + nx * r * 0.55;
      L.ay = sy[i] + ny * r * 0.55;
      L.dx = L.ax + nx * L.reach * 0.6 + fx * L.reach * L.fwd;
      L.dy = L.ay + ny * L.reach * 0.6 + fy * L.reach * L.fwd;
    }

    _updateLimbs(dt, player) {
      const limbs = this.limbs;
      const sp = this.speed;
      const stepDur = U.clamp(0.3 - sp * 0.00035, 0.1, 0.3);
      let stepping = 0;
      for (let i = 0; i < limbs.length; i++) if (limbs[i].t >= 0) stepping++;
      for (let i = 0; i < limbs.length; i++) {
        const L = limbs[i];
        this._limbFrame(L);
        if (L.t >= 0) {
          L.t += dt / L.dur;
          if (L.t >= 1) {
            L.t = -1;
            L.fx = L.tx;
            L.fy = L.ty;
            L.planted = true;
            stepping--;
            this._emitStep(L.fx, L.fy, U.clamp(0.3 + sp / 700, 0.25, 1) * L.weight, Math.hypot(player.x - L.fx, player.y - L.fy), false);
          } else {
            const e = L.t * L.t * (3 - 2 * L.t);
            const lift = Math.sin(Math.PI * L.t) * 28;
            L.fx = U.lerp(L.ox, L.tx, e) + L.nx * lift;
            L.fy = U.lerp(L.oy, L.ty, e) + L.ny * lift;
          }
          continue;
        }
        const partnerBusy = limbs[L.partner] && limbs[L.partner].t >= 0;
        if (L.planted) {
          const da = Math.hypot(L.fx - L.ax, L.fy - L.ay);
          const dd = Math.hypot(L.fx - L.dx, L.fy - L.dy);
          if (da > L.reach * 1.7) {
            // Torn free (teleport / violent lunge): re-grip without a sound.
            if (this._findGrip(L)) {
              L.fx = L.tx;
              L.fy = L.ty;
            } else {
              L.planted = false;
            }
          } else if ((da > L.reach * 1.02 || dd > L.reach * 0.6) && stepping < 3 && !partnerBusy) {
            if (this._findGrip(L)) {
              this._beginStep(L, stepDur);
              stepping++;
            } else {
              L.planted = false;
            }
          }
        } else {
          // Free limb: reaches and gropes toward structure, swaying.
          const sw = Math.sin(this._t * 2.3 + L.sway) * 22;
          const k = 1 - Math.exp(-7 * dt);
          L.fx += (L.dx + L.nx * sw - L.fx) * k;
          L.fy += (L.dy + L.ny * sw - L.fy) * k;
          L.gripTimer -= dt;
          if (L.gripTimer <= 0) {
            L.gripTimer = 0.15 + this._rand() * 0.2;
            if (stepping < 3 && this._findGrip(L)) {
              this._beginStep(L, stepDur);
              stepping++;
            }
          }
        }
      }
    }

    _beginStep(L, dur) {
      L.ox = L.fx;
      L.oy = L.fy;
      L.t = 0;
      L.dur = dur * (0.85 + this._rand() * 0.3);
      L.planted = false;
    }

    /** Finds a foothold on a nearby active solid (closest to the desired point, within reach). */
    _findGrip(L) {
      const r = L.reach;
      const qx = L.dx;
      const qy = L.dy;
      const q = r * 0.75;
      const list = this.level.querySolids(qx - q, qy - q, qx + q, qy + q, this._gripScratch);
      const r2 = r * r;
      let best = Infinity;
      let bx = 0;
      let by = 0;
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.active === false) continue;
        const cx = U.clamp(qx, s.x, s.x + s.w);
        const cy = U.clamp(qy, s.y, s.y + s.h);
        const d2 = (cx - qx) * (cx - qx) + (cy - qy) * (cy - qy);
        if (d2 >= best) continue;
        const ax = cx - L.ax;
        const ay = cy - L.ay;
        if (ax * ax + ay * ay > r2) continue;
        best = d2;
        bx = cx;
        by = cy;
      }
      if (best === Infinity) return false;
      // Hooks bite a little into the masonry; jitter keeps the gait irregular.
      L.tx = bx + (this._rand() - 0.5) * 16 - L.nx * 6;
      L.ty = by + (this._rand() - 0.5) * 16 - L.ny * 6;
      return true;
    }

    _updateCrown(dt) {
      const st = this.state;
      const x = this.x;
      const y = this.y;
      const t = this._t;
      let glowTarget = GLOW[st] || 0.2;
      if (st === S.ATTACK && this.attack.phase === 'windup') glowTarget = 1;
      const k = dt > 0 ? 1 - Math.exp(-6 * dt) : 1;
      this._glow += (glowTarget - this._glow) * k;
      this._unfurl += ((UNFURL[st] || 0.9) - this._unfurl) * k;
      const focus = FOCUS[st] || 0;
      const ha = Math.atan2(this.hy, this.hx);
      const pa = Math.atan2(this._py - y, this._px - x);
      const r0 = this.segR[0];
      // Wind-up: the crown rears back and trembles before the lunge (telegraph).
      const a = this.attack;
      let rear = 0;
      let tremble = 0;
      if (st === S.ATTACK && a.phase === 'windup') {
        const wk = U.clamp(a.t / Math.max(a.windup, 0.05), 0, 1);
        rear = 30 * Math.sin(wk * Math.PI * 0.5);
        tremble = 0.12 * wk;
      }
      const cx0 = x - this.hx * rear;
      const cy0 = y - this.hy * rear;
      this._crownX = cx0;
      this._crownY = cy0;
      const unf = this._unfurl;
      const listenPulse = this.listening ? 0.75 + 0.25 * Math.sin(t * 3.2) : 1;
      const strobe = st === S.ATTACK ? 0.8 + 0.2 * Math.sin(t * 38) : 1;
      const hx = this.hx;
      const hy = this.hy;
      const nx = -hy;
      const ny = hx;
      for (let i = 0; i < STALKS; i++) {
        const spread = (i / (STALKS - 1)) * 2 - 1;
        // Rooted along the crown's front edge, fanning outward.
        const bx = cx0 + hx * r0 * 0.66 + nx * spread * r0 * 1.12;
        const by = cy0 + hy * r0 * 0.66 + ny * spread * r0 * 1.12;
        const baseA = ha + spread * (0.45 + 0.55 * Math.min(1.6, unf));
        let ang = baseA + 0.42 * Math.sin(t * (0.7 + 0.13 * i) + this.stalkPhase[i]) * (1 - focus);
        ang += angleDelta(pa, ang) * focus * 0.5;
        ang += tremble * Math.sin(t * 47 + i * 2.7);
        const len = this.stalkLen[i] * Math.min(unf, 1.3);
        // Fronds curl outward like an opening crown, and keep slowly writhing.
        const curl = 0.75 * Math.sin(t * 1.3 + this.stalkPhase[i]) * (1 - focus * 0.6) + spread * 0.55;
        this.stalkBX[i] = bx;
        this.stalkBY[i] = by;
        this.stalkMX[i] = bx + Math.cos(ang - curl) * len * 0.6;
        this.stalkMY[i] = by + Math.sin(ang - curl) * len * 0.6;
        this.stalkTX[i] = bx + Math.cos(ang) * len;
        this.stalkTY[i] = by + Math.sin(ang) * len;
        const flick = 0.72 + 0.28 * Math.sin(t * (4.3 + i * 0.9) + this.stalkPhase[i] * 3);
        this.stalkGlow[i] = U.clamp(this._glow * flick * listenPulse * strobe, 0, 1);
      }
      // Listening pits across the crown's face.
      for (let i = 0; i < PITS; i++) {
        const s = (i / (PITS - 1)) * 2 - 1;
        const fwd = r0 * (0.4 - 0.08 * Math.abs(s));
        this.pitX[i] = cx0 + hx * fwd + nx * s * r0 * 0.78;
        this.pitY[i] = cy0 + hy * fwd + ny * s * r0 * 0.78;
        const pulse = 0.65 + 0.35 * Math.sin(t * (2.1 + i * 0.4) + i * 1.7);
        this.pitGlow[i] = U.clamp(this._glow * pulse * listenPulse * strobe * (this.listening ? 1.15 : 0.8), 0, 1);
      }
    }

    _updateBBox() {
      const b = this.bbox;
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (let i = 0; i < T.segments; i++) {
        const r = this.segR[i];
        if (this.segX[i] - r < x0) x0 = this.segX[i] - r;
        if (this.segX[i] + r > x1) x1 = this.segX[i] + r;
        if (this.segY[i] - r < y0) y0 = this.segY[i] - r;
        if (this.segY[i] + r > y1) y1 = this.segY[i] + r;
      }
      for (let i = 0; i < this.limbs.length; i++) {
        const L = this.limbs[i];
        if (L.fx < x0) x0 = L.fx;
        if (L.fx > x1) x1 = L.fx;
        if (L.fy < y0) y0 = L.fy;
        if (L.fy > y1) y1 = L.fy;
      }
      const pad = 110; // fronds, knees, hooks
      b.x0 = x0 - pad;
      b.y0 = y0 - pad;
      b.x1 = x1 + pad;
      b.y1 = y1 + pad;
    }

    // =========================================================================
    // Events & audio
    // =========================================================================

    _emit(type, payload) {
      if (!this.active || !this.bus) return;
      this.bus.emit(type, payload);
    }

    _emitStep(x, y, intensity, distance, force) {
      if (!force && this._stepCd > 0) return;
      this._stepCd = T.stepInterval;
      this._emit('creature:step', { x, y, intensity: U.clamp(intensity, 0, 1), distance });
    }

    _updateAudio(player) {
      const a = this.audio;
      a.state = this.state;
      if (!this.active) {
        this._quiet();
        return;
      }
      a.x = this.x;
      a.y = this.y;
      a.distance = player ? this.distance : FAR;
      // Agitation (not distance-attenuated: the audio engine applies distance itself).
      const mv = this.inPlay ? U.clamp(this.speed / (T.speed.burst * 1.1), 0, 1) : this.sighting ? 0.25 : 0.05;
      a.movement = mv;
      a.intensity = U.clamp((AGITATION[this.state] || 0.2) * (0.75 + 0.25 * mv) + this.nearMiss * 0.2, 0, 1);
    }

    // =========================================================================
    // Rendering (world layer)
    // =========================================================================

    _onScreen(camera, margin) {
      if (!camera) return false;
      const vw = num(camera.viewW, 2000);
      const vh = num(camera.viewH, 2000);
      const cx = num(camera.x, this.x);
      const cy = num(camera.y, this.y);
      const b = this.bbox;
      return !(b.x1 < cx - vw / 2 - margin || b.x0 > cx + vw / 2 + margin || b.y1 < cy - vh / 2 - margin || b.y0 > cy + vh / 2 + margin);
    }

    /**
     * Draws the creature in world space (ctx already carries the parallax-1 world
     * transform). Mostly dark silhouette with rim light — the renderer's darkness
     * overlay hides most of it; `renderGlow` re-adds the sensory points on top.
     * @param {CanvasRenderingContext2D} ctx
     * @param {AT.Camera} camera
     * @param {{time?:number, quality?:'high'|'low', threat?:number, highContrast?:boolean}} [opts]
     */
    render(ctx, camera, opts) {
      if (!this.active || !this.inPlay || !ctx) return;
      if (!this._onScreen(camera, 80)) return;
      const o = opts || {};
      const low = o.quality === 'low';
      const hc = !!o.highContrast;
      const t = num(o.time, this._t);
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 1;
      // Far-side limbs, the plated column, near-side limbs, then the crown.
      for (let i = 0; i < this.limbs.length; i++) {
        const L = this.limbs[i];
        if (L.back && !(low && i >= 6)) this._drawLimb(ctx, L, true, low);
      }
      this._drawBody(ctx, t, low, hc);
      for (let i = 0; i < this.limbs.length; i++) {
        const L = this.limbs[i];
        if (!L.back && !(low && i >= 6)) this._drawLimb(ctx, L, false, low);
      }
      this._drawCrown(ctx, t, low, hc);
      ctx.restore();
    }

    /**
     * Traces a chunky six-sided plate in the frame (tx,ty)=along the body,
     * (nx,ny)=across it. hl = half length, r = half width.
     */
    _platePath(ctx, x, y, tx, ty, nx, ny, hl, r) {
      ctx.beginPath();
      ctx.moveTo(x + tx * hl + nx * r * 0.74, y + ty * hl + ny * r * 0.74);
      ctx.lineTo(x + tx * hl * 0.15 + nx * r, y + ty * hl * 0.15 + ny * r);
      ctx.lineTo(x - tx * hl + nx * r * 0.86, y - ty * hl + ny * r * 0.86);
      ctx.lineTo(x - tx * hl - nx * r * 0.86, y - ty * hl - ny * r * 0.86);
      ctx.lineTo(x + tx * hl * 0.15 - nx * r, y + ty * hl * 0.15 - ny * r);
      ctx.lineTo(x + tx * hl - nx * r * 0.74, y + ty * hl - ny * r * 0.74);
      ctx.closePath();
    }

    _drawBody(ctx, t, low, hc) {
      const n = T.segments;
      const sx = this.segX;
      const sy = this.segY;
      const px = this._px;
      const py = this._py;
      const midX = (this.wallL + this.wallR) * 0.5;
      // Low quality: every other plate, each stretched to close the gap.
      const hl = low ? T.spacing * 1.25 : T.spacing * 0.7;
      ctx.lineCap = 'butt';
      for (let i = n - 1; i >= 1; i--) {
        if (low && (i & 1) === 0) continue;
        // Frame: tangent toward the head; normal flipped so "dorsal" faces the open shaft.
        let tx = sx[i - 1] - sx[i];
        let ty = sy[i - 1] - sy[i];
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        let nx = -ty;
        let ny = tx;
        if (nx * (midX - sx[i]) < 0) {
          nx = -nx;
          ny = -ny;
        }
        const ripple = Math.sin(t * 1.6 - i * 0.55) * 2.2; // slow breathing along the column
        const x = sx[i] + nx * ripple;
        const y = sy[i] + ny * ripple;
        const r = this.segR[i] * this.segK[i];
        const iron = this.segIron[i] === 1;
        const dp = Math.hypot(px - x, py - y);
        const lit = U.clamp(1 - dp / 560, 0, 1);
        const litSide = (px - x) * nx + (py - y) * ny >= 0 ? 1 : -1;
        // Detail LOD: far from the lantern the darkness overlay swallows fine
        // detail anyway, so only the silhouette + rim is drawn there.
        const detail = !low && dp < T.detailRange;

        // Masonry block.
        ctx.fillStyle = COL.body;
        this._platePath(ctx, x, y, tx, ty, nx, ny, hl, r);
        ctx.fill();
        // Dorsal face: dressed stone, or a slab of corroded iron.
        ctx.fillStyle = iron ? COL.ironPlate : (i & 1) === 0 ? COL.plate : COL.plateHi;
        this._platePath(ctx, x + nx * r * 0.2 - tx * 1.5, y + ny * r * 0.2 - ty * 1.5, tx, ty, nx, ny, hl * 0.8, r * 0.62);
        ctx.fill();
        if (detail) {
          // Corroded iron band across the plate's leading edge, riveted.
          const bx = x + tx * hl * 0.55;
          const by = y + ty * hl * 0.55;
          ctx.strokeStyle = COL.iron;
          ctx.lineWidth = Math.max(4, hl * 0.32);
          ctx.beginPath();
          ctx.moveTo(bx + nx * r * 0.82, by + ny * r * 0.82);
          ctx.lineTo(bx - nx * r * 0.82, by - ny * r * 0.82);
          ctx.stroke();
          ctx.fillStyle = COL.rivet;
          for (let k = -1; k <= 1; k++) {
            ctx.beginPath();
            ctx.arc(bx + nx * r * 0.55 * k, by + ny * r * 0.55 * k, r > 22 ? 2.1 : 1.4, 0, TAU);
            ctx.fill();
          }
          // Rust weeping from the band (thin streaks, not markings).
          if (i % 3 === 1) {
            ctx.strokeStyle = COL.rust;
            ctx.globalAlpha = 0.5;
            ctx.lineWidth = 1.6;
            ctx.beginPath();
            ctx.moveTo(bx + nx * r * 0.3, by + ny * r * 0.3);
            ctx.lineTo(bx + nx * r * 0.36 - tx * hl * 0.9, by + ny * r * 0.36 - ty * hl * 0.9);
            ctx.moveTo(bx - nx * r * 0.2, by - ny * r * 0.2);
            ctx.lineTo(bx - nx * r * 0.16 - tx * hl * 0.6, by - ny * r * 0.16 - ty * hl * 0.6);
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
          // Mortar crack across the stone face.
          if (i % 4 === 3) {
            ctx.strokeStyle = COL.seam;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(x + nx * r * 0.7 - tx * hl * 0.5, y + ny * r * 0.7 - ty * hl * 0.5);
            ctx.lineTo(x + nx * r * 0.3 - tx * hl * 0.1, y + ny * r * 0.3 - ty * hl * 0.1);
            ctx.lineTo(x + nx * r * 0.42 + tx * hl * 0.3, y + ny * r * 0.42 + ty * hl * 0.3);
            ctx.stroke();
          }
          // Rebar and broken masonry the thing has grown through.
          if (i % 4 === 2 && r > 16) {
            ctx.strokeStyle = COL.rebar;
            ctx.lineWidth = 2.2;
            ctx.beginPath();
            ctx.moveTo(x + nx * r * 0.7, y + ny * r * 0.7);
            ctx.lineTo(x + nx * (r + 26) - tx * 10, y + ny * (r + 26) - ty * 10);
            ctx.moveTo(x + nx * r * 0.6 - tx * 6, y + ny * r * 0.6 - ty * 6);
            ctx.lineTo(x + nx * (r + 16) - tx * 24, y + ny * (r + 16) - ty * 24);
            ctx.stroke();
          } else if (i % 5 === 0 && r > 16) {
            ctx.fillStyle = COL.stone;
            ctx.beginPath();
            ctx.moveTo(x + nx * r * 0.8 + tx * 8, y + ny * r * 0.8 + ty * 8);
            ctx.lineTo(x + nx * (r + 15) + tx * 4, y + ny * (r + 15) + ty * 4);
            ctx.lineTo(x + nx * (r + 11) - tx * 12, y + ny * (r + 11) - ty * 12);
            ctx.lineTo(x + nx * r * 0.8 - tx * 10, y + ny * r * 0.8 - ty * 10);
            ctx.closePath();
            ctx.fill();
          }
          // Chains caught between its plates, hanging under gravity.
          if (i === 7 || i === 14) this._drawChain(ctx, x - nx * r * 0.7, y - ny * r * 0.7, t + i);
        }
        // Rim light: cold edge on the lantern side, stronger as you get close.
        ctx.strokeStyle = COL.rim;
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.16 + 0.62 * lit;
        ctx.beginPath();
        ctx.moveTo(x + tx * hl + nx * r * 0.74 * litSide, y + ty * hl + ny * r * 0.74 * litSide);
        ctx.lineTo(x + tx * hl * 0.15 + nx * r * litSide, y + ty * hl * 0.15 + ny * r * litSide);
        ctx.lineTo(x - tx * hl + nx * r * 0.86 * litSide, y - ty * hl + ny * r * 0.86 * litSide);
        ctx.stroke();
        ctx.globalAlpha = 1;
        if (hc) {
          ctx.strokeStyle = COL.hc;
          ctx.globalAlpha = 0.3;
          ctx.lineWidth = 1.5;
          this._platePath(ctx, x, y, tx, ty, nx, ny, hl, r);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }
    }

    _drawChain(ctx, x, y, phase) {
      const sway = Math.sin(phase * 0.9) * 0.35;
      const dx = Math.sin(sway);
      const dy = Math.cos(sway);
      ctx.strokeStyle = COL.iron;
      ctx.lineWidth = 2;
      for (let k = 0; k < 6; k++) {
        const cx = x + dx * (k * 9 + 5);
        const cy = y + dy * (k * 9 + 5);
        ctx.beginPath();
        if ((k & 1) === 0) ctx.ellipse(cx, cy, 2.4, 5.2, -sway, 0, TAU);
        else ctx.ellipse(cx, cy, 1.2, 5.2, -sway, 0, TAU);
        ctx.stroke();
      }
    }

    /** 2-bone IK knee for a limb (writes this._kx/_ky). Knee bends away from the body. */
    _knee(L) {
      const l1 = L.reach * 0.52;
      const l2 = L.reach * 0.56;
      let dx = L.fx - L.ax;
      let dy = L.fy - L.ay;
      let d = Math.hypot(dx, dy);
      if (d < 1e-3) {
        dx = L.nx;
        dy = L.ny;
        d = 1e-3;
      }
      const ux = dx / d;
      const uy = dy / d;
      const dc = U.clamp(d, Math.abs(l1 - l2) + 1, l1 + l2 - 1);
      const a = (l1 * l1 - l2 * l2 + dc * dc) / (2 * dc);
      const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
      const bx = L.ax + ux * a;
      const by = L.ay + uy * a;
      // Two candidates; choose the one farther from the body column (spider-like).
      const k1x = bx - uy * h;
      const k1y = by + ux * h;
      const k2x = bx + uy * h;
      const k2y = by - ux * h;
      const s = this.segX[L.seg];
      const t = this.segY[L.seg];
      if ((k1x - s) * (k1x - s) + (k1y - t) * (k1y - t) >= (k2x - s) * (k2x - s) + (k2y - t) * (k2y - t)) {
        this._kx = k1x;
        this._ky = k1y;
      } else {
        this._kx = k2x;
        this._ky = k2y;
      }
    }

    /** A girder bone: dark web, flanges and (high quality) truss bracing. */
    _drawBeam(ctx, x0, y0, x1, y1, w, back, low) {
      ctx.lineCap = 'butt';
      ctx.strokeStyle = back ? COL.body : COL.limb;
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      if (low || back) return;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len;
      const uy = dy / len;
      const ox = -uy * w * 0.36;
      const oy = ux * w * 0.36;
      ctx.strokeStyle = COL.limbHi;
      ctx.lineWidth = 1.3;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(x0 + ox, y0 + oy);
      ctx.lineTo(x1 + ox, y1 + oy);
      ctx.moveTo(x0 - ox, y0 - oy);
      ctx.lineTo(x1 - ox, y1 - oy);
      // Truss zig-zag between the flanges.
      const bays = Math.max(2, Math.floor(len / (w * 1.25)));
      ctx.moveTo(x0 + ox, y0 + oy);
      for (let k = 1; k <= bays; k++) {
        const f = k / bays;
        const sgn = k & 1 ? -1 : 1;
        ctx.lineTo(x0 + dx * f + ox * sgn, y0 + dy * f + oy * sgn);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    _drawLimb(ctx, L, back, low) {
      this._knee(L);
      const kx = this._kx;
      const ky = this._ky;
      const w = L.reach / 215;
      const w1 = (back ? 13 : 19) * w;
      const w2 = (back ? 9.5 : 13.5) * w;
      const far = low || Math.hypot(this._px - kx, this._py - ky) > T.detailRange;
      this._drawBeam(ctx, L.ax, L.ay, kx, ky, w1, back, far);
      this._drawBeam(ctx, kx, ky, L.fx, L.fy, w2, back, far);
      // Heavy knuckle.
      ctx.fillStyle = back ? COL.body : COL.limb;
      ctx.beginPath();
      ctx.arc(kx, ky, w1 * 0.62, 0, TAU);
      ctx.fill();
      // Hook: a thick curl biting back toward the body from the foothold.
      const hx = L.fx - kx;
      const hy = L.fy - ky;
      const hl = Math.hypot(hx, hy) || 1;
      const ux = hx / hl;
      const uy = hy / hl;
      const side = (ux * L.ny - uy * L.nx) >= 0 ? 1 : -1;
      const ex = L.fx + (ux * 12 - uy * 20 * side) * w;
      const ey = L.fy + (uy * 12 + ux * 20 * side) * w;
      ctx.strokeStyle = back ? COL.body : COL.limb;
      ctx.lineCap = 'round';
      ctx.lineWidth = w2 * 0.7;
      ctx.beginPath();
      ctx.moveTo(L.fx - ux * 4, L.fy - uy * 4);
      ctx.quadraticCurveTo(L.fx + ux * 22 * w, L.fy + uy * 22 * w, ex, ey);
      ctx.stroke();
      if (back || far) return;
      ctx.lineWidth = 1.4;
      ctx.strokeStyle = COL.limbHi;
      ctx.beginPath();
      ctx.moveTo(L.fx, L.fy);
      ctx.quadraticCurveTo(L.fx + ux * 22 * w, L.fy + uy * 22 * w, ex, ey);
      ctx.stroke();
      ctx.strokeStyle = COL.rim;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.arc(kx, ky, w1 * 0.62, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = COL.rivet;
      ctx.beginPath();
      ctx.arc(kx, ky, 2.4, 0, TAU);
      ctx.fill();
    }

    /** Traces the crown plate outline (shared by render and the high-contrast glow outline). */
    _crownPath(ctx) {
      const x = this._crownX;
      const y = this._crownY;
      const r = this.segR[0];
      const hx = this.hx;
      const hy = this.hy;
      const nx = -hy;
      const ny = hx;
      ctx.beginPath();
      ctx.moveTo(x - hx * r * 0.85 + nx * r * 0.95, y - hy * r * 0.85 + ny * r * 0.95);
      ctx.lineTo(x + hx * r * 0.2 + nx * r * 1.38, y + hy * r * 0.2 + ny * r * 1.38);
      ctx.lineTo(x + hx * r * 0.62 + nx * r * 1.22, y + hy * r * 0.62 + ny * r * 1.22);
      ctx.lineTo(x + hx * r * 0.76 + nx * r * 0.58, y + hy * r * 0.76 + ny * r * 0.58);
      ctx.lineTo(x + hx * r * 0.62 + nx * r * 0.12, y + hy * r * 0.62 + ny * r * 0.12);
      ctx.lineTo(x + hx * r * 0.76 - nx * r * 0.4, y + hy * r * 0.76 - ny * r * 0.4);
      ctx.lineTo(x + hx * r * 0.62 - nx * r * 1.22, y + hy * r * 0.62 - ny * r * 1.22);
      ctx.lineTo(x + hx * r * 0.2 - nx * r * 1.38, y + hy * r * 0.2 - ny * r * 1.38);
      ctx.lineTo(x - hx * r * 0.85 - nx * r * 0.95, y - hy * r * 0.85 - ny * r * 0.95);
      ctx.closePath();
    }

    _drawCrown(ctx, t, low, hc) {
      const x = this._crownX;
      const y = this._crownY;
      const r = this.segR[0];
      const hx = this.hx;
      const hy = this.hy;
      const nx = -hy;
      const ny = hx;
      // Blunt crenellated crown — a broken capital, not a face.
      ctx.fillStyle = COL.body;
      this._crownPath(ctx);
      ctx.fill();
      if (hc) {
        ctx.strokeStyle = COL.hc;
        ctx.globalAlpha = 0.5;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // Brow slab + iron collar.
      ctx.fillStyle = COL.plateHi;
      this._platePath(ctx, x - hx * r * 0.2, y - hy * r * 0.2, hx, hy, nx, ny, r * 0.42, r * 1.05);
      ctx.fill();
      if (!low) {
        ctx.strokeStyle = COL.iron;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(x - hx * r * 0.7 + nx * r * 0.9, y - hy * r * 0.7 + ny * r * 0.9);
        ctx.lineTo(x - hx * r * 0.7 - nx * r * 0.9, y - hy * r * 0.7 - ny * r * 0.9);
        ctx.stroke();
      }
      ctx.strokeStyle = COL.rim;
      ctx.lineWidth = 2.2;
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      ctx.moveTo(x + hx * r * 0.62 + nx * r * 1.22, y + hy * r * 0.62 + ny * r * 1.22);
      ctx.lineTo(x + hx * r * 0.2 + nx * r * 1.38, y + hy * r * 0.2 + ny * r * 1.38);
      ctx.moveTo(x + hx * r * 0.62 - nx * r * 1.22, y + hy * r * 0.62 - ny * r * 1.22);
      ctx.lineTo(x + hx * r * 0.2 - nx * r * 1.38, y + hy * r * 0.2 - ny * r * 1.38);
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Listening pits drilled across the front face (glow comes from renderGlow).
      ctx.fillStyle = COL.pit;
      for (let i = 0; i < PITS; i++) {
        ctx.beginPath();
        ctx.arc(this.pitX[i], this.pitY[i], 4.6, 0, TAU);
        ctx.fill();
      }
      // Sensory fronds: thick pale stalks tapering to fine barbed tips.
      const count = low ? 5 : STALKS;
      const off = low ? 1 : 0;
      ctx.lineCap = 'round';
      for (let n = 0; n < count; n++) {
        const i = n + off;
        const bx = this.stalkBX[i];
        const by = this.stalkBY[i];
        const mx = this.stalkMX[i];
        const my = this.stalkMY[i];
        const ex = this.stalkTX[i];
        const ey = this.stalkTY[i];
        // Split the quadratic at t = 0.5 so the two halves can taper.
        const cx = 0.25 * bx + 0.5 * mx + 0.25 * ex;
        const cy = 0.25 * by + 0.5 * my + 0.25 * ey;
        ctx.strokeStyle = COL.stalk;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo((bx + mx) * 0.5, (by + my) * 0.5, cx, cy);
        ctx.stroke();
        ctx.strokeStyle = COL.stalkPale;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.quadraticCurveTo((mx + ex) * 0.5, (my + ey) * 0.5, ex, ey);
        ctx.stroke();
        if (!low) {
          // Fine barbs along the outer half (they quiver).
          const dx = ex - cx;
          const dy = ey - cy;
          const dl = Math.hypot(dx, dy) || 1;
          const px = -dy / dl;
          const py = dx / dl;
          const q = Math.sin(t * 9 + i * 2.1) * 2;
          ctx.lineWidth = 1.1;
          ctx.globalAlpha = 0.75;
          ctx.beginPath();
          for (let k = 1; k <= 3; k++) {
            const f = k / 4;
            const ax = cx + dx * f;
            const ay = cy + dy * f;
            const sgn = k & 1 ? 1 : -1;
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax + px * (7 + q) * sgn + (dx / dl) * 4, ay + py * (7 + q) * sgn + (dy / dl) * 4);
          }
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = COL.tip;
        ctx.globalAlpha = 0.35 + 0.5 * this.stalkGlow[i];
        ctx.beginPath();
        ctx.arc(ex, ey, 3.2, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }

    /**
     * ADDITION to CONTRACT §10. World space (same transform as `render`). Draws
     * ONLY the sensory glow (frond tips + listening pits, and the distant
     * sighting's glints) additively, so the renderer can call it AFTER its
     * darkness overlay: the creature is mostly lost in the dark, but its pale
     * sensory points remain — "where is it?".
     */
    renderGlow(ctx, camera, opts) {
      if (!this.active || !ctx) return;
      const o = opts || {};
      const low = o.quality === 'low';
      const sprite = getGlowSprite();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      if (this.sighting && camera) this._drawSightingGlints(ctx, camera, sprite);
      if (this.inPlay && this._onScreen(camera, 60)) {
        const count = low ? 5 : STALKS;
        const off = low ? 1 : 0;
        for (let n = 0; n < count; n++) {
          const i = n + off;
          this._glowAt(ctx, sprite, this.stalkTX[i], this.stalkTY[i], 10 + 18 * this.stalkGlow[i], this.stalkGlow[i]);
        }
        for (let i = 0; i < PITS; i++) {
          this._glowAt(ctx, sprite, this.pitX[i], this.pitY[i], 7 + 14 * this.pitGlow[i], this.pitGlow[i] * 0.9);
        }
        if (o.highContrast) {
          // Accessibility: a bold, shape-coded danger outline (jagged crown) that
          // stays readable above the darkness — not colour alone.
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 0.75;
          ctx.strokeStyle = COL.hc;
          ctx.lineWidth = 3;
          this._crownPath(ctx);
          ctx.stroke();
        }
      }
      ctx.restore();
    }

    _glowAt(ctx, sprite, x, y, radius, alpha) {
      if (alpha <= 0.02) return;
      ctx.globalAlpha = U.clamp(alpha, 0, 1);
      if (sprite) {
        ctx.drawImage(sprite, x - radius, y - radius, radius * 2, radius * 2);
      } else {
        ctx.fillStyle = COL.glow;
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.25, 0, TAU);
        ctx.fill();
      }
    }

    // =========================================================================
    // Rendering (far-layer sighting, SCREEN space)
    // =========================================================================

    /** Computes the sighting silhouette's screen geometry into this._far. */
    _farGeom(camera) {
      const s = this.sighting;
      const f = this._far;
      const lv = this.level;
      const p = lv && lv.parallax && isFinite(lv.parallax.far) ? lv.parallax.far : 0.25;
      const W = num(camera.screenW, 1280);
      const H = num(camera.screenH, 720);
      const sc = num(camera.scale, 1);
      const refX = (lv && lv.width ? lv.width : 1800) * 0.5;
      // Same convention as level decor: authored world point → layer space → screen.
      const lx = s.x - refX * (1 - p);
      const ly = s.y * p;
      f.ax = (lx - num(camera.x, refX) * p) * sc + W / 2;
      f.ay = (ly - num(camera.y, s.y) * p) * sc + H / 2;
      const k = U.clamp(s.t / s.duration, 0, 1);
      f.u = this._crossU(k);
      // Huge: longer than the screen is tall; it never fits in view at once.
      f.len = Math.min(H * 1.5, W * 1.15);
      f.th = f.len * 0.05;
      f.dir = s.dir;
      f.span = W + f.len * 2.2;
      f.hx = f.ax + s.dir * (f.u - 0.5) * f.span;
      f.hy = this._farBodyY(f, f.hx, s.t);
      f.alpha = U.smoothstep(0, 0.12, k) * (1 - U.smoothstep(0.86, 1, k));
      f.look = U.smoothstep(0.38, 0.45, k) * (1 - U.smoothstep(0.6, 0.66, k)); // the pause: it turns toward you
      f.sc = sc;
      f.W = W;
      f.H = H;
      // Glints (screen px) for renderFar + renderGlow: along the crown's front,
      // gathering into a cluster that faces the viewer during the pause.
      for (let i = 0; i < PITS; i++) {
        const v = (i / (PITS - 1)) * 2 - 1;
        const spreadY = f.th * 0.7 * v * (1 - f.look * 0.55);
        this._farGX[i] = f.hx + f.dir * f.th * (0.55 + 0.1 * Math.sin(s.t * 3 + i)) + f.look * f.th * 0.25 * v;
        this._farGY[i] = f.hy + spreadY;
      }
      return f;
    }

    /**
     * Far-layer sighting: a huge dim silhouette hauling itself along a distant
     * span, faintly backlit; mid-way it stops and its crown blooms open toward
     * the player. Called with ctx in SCREEN space (CSS px); parallax placement
     * is computed here from the camera.
     */
    renderFar(ctx, camera, opts) {
      const s = this.sighting;
      if (!this.active || !s || !ctx || !camera) return;
      const o = opts || {};
      const low = o.quality === 'low';
      const f = this._farGeom(camera);
      if (f.alpha <= 0.01) return;
      const t = s.t;
      const dir = f.dir;
      const th = f.th;
      ctx.save();
      ctx.lineJoin = 'round';
      // Faint cold backlight in the distance (what makes it a silhouette).
      const bl = getBacklightSprite();
      if (bl) {
        ctx.globalAlpha = 0.9 * f.alpha;
        ctx.drawImage(bl, f.ax - f.W * 0.6, f.ay - f.H * 0.5, f.W * 1.2, f.H);
      }
      // The distant span it crawls along, and the vault ribs it hooks into above.
      const spanY = f.ay + th * 1.7;
      const ceilY = f.ay - th * 5.5;
      ctx.globalAlpha = 0.75 * f.alpha;
      ctx.fillStyle = COL.farBody;
      ctx.fillRect(f.ax - f.W, spanY, f.W * 2, Math.max(2, th * 0.4));
      ctx.globalAlpha = 0.35 * f.alpha;
      ctx.fillRect(f.ax - f.W, ceilY - th * 0.3, f.W * 2, Math.max(1, th * 0.25));

      const M = low ? 11 : 16;
      const segL = f.len / M;
      const sHead = (f.u - 0.5) * f.span; // head offset along the crossing (px)
      // Limbs (behind the body): planted holds that jump forward a stride at a time.
      ctx.strokeStyle = COL.farBody;
      ctx.globalAlpha = 0.95 * f.alpha;
      const limbs = low ? 4 : 7;
      const stride = segL * 2.6;
      for (let j = 0; j < limbs; j++) {
        const i = 1 + Math.round((j * (M - 3)) / Math.max(1, limbs - 1));
        const sa = sHead - i * segL;
        const bx = f.ax + dir * sa;
        const by = this._farBodyY(f, bx, t);
        const up = j % 2 === 1;
        const P = sa / stride + j * 0.37;
        const kf = Math.floor(P);
        const e = U.smoothstep(0.72, 1, P - kf);
        const fx = f.ax + dir * ((kf + e) * stride - j * 0.37 * stride + segL * 1.3);
        const fy = up ? ceilY : spanY;
        const lift = Math.sin(Math.PI * e) * th * 0.9 * (up ? 1 : -1);
        // Knee bows backward (away from the direction of travel) and outward.
        const kx = (bx + fx) * 0.5 - dir * segL * 0.9;
        const ky = up ? by - th * 3.2 : (by + fy) * 0.5 + th * 0.9;
        const w = Math.max(1.5, th * (0.36 - j * 0.02));
        ctx.lineCap = 'butt';
        ctx.lineWidth = w;
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(kx, ky);
        ctx.lineTo(fx, fy + lift);
        ctx.stroke();
        // Hook.
        ctx.lineCap = 'round';
        ctx.lineWidth = w * 0.6;
        ctx.beginPath();
        ctx.moveTo(fx, fy + lift);
        ctx.lineTo(fx + dir * th * 0.5, fy + lift + (up ? th * 0.6 : -th * 0.6));
        ctx.stroke();
      }
      // Body column: chamfered masonry plates, irregular, with jagged dorsal debris.
      ctx.fillStyle = COL.farBody;
      ctx.globalAlpha = 0.96 * f.alpha;
      for (let i = M - 1; i >= 0; i--) {
        const x = f.hx - dir * i * segL;
        const y = this._farBodyY(f, x, t);
        const x2 = x + dir * segL;
        const y2 = this._farBodyY(f, x2, t);
        let tx = x2 - x;
        let ty = y2 - y;
        const tl = Math.hypot(tx, ty) || 1;
        tx /= tl;
        ty /= tl;
        const tt = i / (M - 1);
        const jag = 0.88 + 0.24 * U.hash(i * 31 + 7);
        const r = th * (i === 0 ? 1.3 : U.lerp(1.35, 0.4, Math.pow(tt, 0.85))) * jag;
        this._platePath(ctx, x, y, tx, ty, -ty, tx, segL * 0.62, r);
        ctx.fill();
        if (i > 0 && i % 3 === 1) {
          // Rebar / broken masonry jutting from its back.
          ctx.beginPath();
          ctx.moveTo(x - tx * segL * 0.3, y - r * 0.8);
          ctx.lineTo(x - dir * segL * 0.15, y - r - th * 0.9);
          ctx.lineTo(x + tx * segL * 0.15, y - r * 0.8);
          ctx.closePath();
          ctx.fill();
        }
      }
      // Backlit rim along the top of the column (one continuous line, not humps).
      if (!low) {
        ctx.strokeStyle = COL.farRim;
        ctx.lineWidth = Math.max(1, th * 0.07);
        ctx.lineCap = 'round';
        for (let i = 0; i < M - 1; i++) {
          const x = f.hx - dir * i * segL;
          const near = 1 - U.clamp(Math.abs(x - f.ax) / (f.W * 0.55), 0, 1);
          if (near <= 0.05) continue;
          const tt = i / (M - 1);
          const r = th * U.lerp(1.35, 0.4, Math.pow(tt, 0.85)) * (0.88 + 0.24 * U.hash(i * 31 + 7));
          const y = this._farBodyY(f, x, t);
          ctx.globalAlpha = 0.4 * near * f.alpha;
          ctx.beginPath();
          ctx.moveTo(x + dir * segL * 0.1, y - r * 0.98);
          ctx.lineTo(x - dir * segL * 0.62, y - r * 0.86);
          ctx.stroke();
        }
      }
      // Crown fronds: swept ahead while it crawls; in the pause they bloom open
      // all around the crown, facing the player.
      ctx.strokeStyle = COL.farFrond;
      ctx.lineCap = 'round';
      const fronds = low ? 5 : 8;
      for (let i = 0; i < fronds; i++) {
        const v = (i / (fronds - 1)) * 2 - 1;
        const fwdA = (dir > 0 ? 0 : Math.PI) + v * 0.75;
        const bloomA = (dir > 0 ? 0 : Math.PI) + v * 2.6;
        const ang = U.lerp(fwdA, bloomA, f.look) + 0.12 * Math.sin(t * 1.9 + i * 1.3);
        const len = th * (1.9 + 0.6 * Math.sin(t * 1.4 + i * 2.1)) * (1 + f.look * 0.35);
        const bx = f.hx + dir * th * 0.7;
        const by = f.hy + v * th * 0.5;
        const ex = bx + Math.cos(ang) * len;
        const ey = by + Math.sin(ang) * len;
        ctx.globalAlpha = (0.5 + 0.35 * f.look) * f.alpha;
        ctx.lineWidth = Math.max(1, th * 0.11);
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.quadraticCurveTo(bx + Math.cos(ang - v * 0.6) * len * 0.6, by + Math.sin(ang - v * 0.6) * len * 0.6, ex, ey);
        ctx.stroke();
      }
      // Faint glints (renderGlow re-draws them above the darkness).
      ctx.fillStyle = COL.glow;
      const gA = (0.3 + 0.6 * f.look) * f.alpha;
      for (let i = 0; i < PITS; i++) {
        ctx.globalAlpha = gA * (0.6 + 0.4 * Math.sin(t * (5 + i) + i * 2));
        ctx.beginPath();
        ctx.arc(this._farGX[i], this._farGY[i], Math.max(1, th * 0.1), 0, TAU);
        ctx.fill();
      }
      ctx.restore();
    }

    _farBodyY(f, x, t) {
      // Gentle undulation as the column hauls itself along.
      return f.ay + Math.sin(x * 0.011 + t * 1.3) * f.th * 0.45;
    }

    /** Sighting glints converted to world space (renderGlow runs in the world transform). */
    _drawSightingGlints(ctx, camera, sprite) {
      const f = this._farGeom(camera);
      if (f.alpha <= 0.01) return;
      const sc = f.sc > 0 ? f.sc : 1;
      const cx = num(camera.x, 0);
      const cy = num(camera.y, 0);
      const t = this.sighting.t;
      const a = (0.25 + 0.65 * f.look) * f.alpha;
      for (let i = 0; i < PITS; i++) {
        const wx = cx + (this._farGX[i] - f.W / 2) / sc;
        const wy = cy + (this._farGY[i] - f.H / 2) / sc;
        const flick = 0.6 + 0.4 * Math.sin(t * (5 + i) + i * 2);
        this._glowAt(ctx, sprite, wx, wy, (4 + 6 * f.look) / Math.max(sc, 0.3), a * flick);
      }
    }
  }

  Creature.STATES = S;
  Creature.TUNING = T;
  Creature.MODES = MODES;
  AT.Creature = Creature;
})((window.AT = window.AT || {}));
