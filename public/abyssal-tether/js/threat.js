/* ABYSSAL TETHER — threat.js
 * AT.ThreatSystem — one continuous 0..1 "dread" value that the rest of the
 * game feels rather than reads: it drives the heartbeat, breathing, vignette,
 * particles and distortion. Never displayed numerically.
 *
 * Inputs each frame:
 *   creature   proximity (exponential falloff: ~150u → 1, ~1400u → ~0) shaped by
 *              its state (BURST / ATTACK up, RECOVERING / DORMANT down); zero when
 *              the creature is inactive (sandbox) or missing
 *   sighting   a modest swell while the distant silhouette is crossing
 *   falling    free-fall speed relative to the difficulty's lethal impact speed
 *   burst      a spike whenever the creature surges (decays over ~1 s)
 *   nearMiss   a spike when a lunge misses (creature.nearMiss pulse)
 *   stillness  a small creeping term for standing still while it can kill you
 * Components are combined with a probabilistic OR (1 − Π(1 − cᵢ)) so several
 * moderate sources add up without ever exceeding 1. The output is smoothed
 * with a fast attack (~3/s) and a slow release (~0.6/s).
 *
 * DOM-free; loadable in Node.
 */
(function (AT) {
  'use strict';

  const U = AT.util;

  const TUNE = {
    attackRate: 3.0, // 1/s — how fast `value` rises toward `raw`
    releaseRate: 0.6, // 1/s — how slowly it decays
    nearDist: 150, // creature distance that counts as "on top of you"
    falloff: 420, // exponential falloff length (u): 1400u → ~0.05
    fallStart: 0.45, // falling term starts at this fraction of lethal impact speed
    burstDecay: 1.4, // 1/s
    stillStart: 1.5, // seconds still before the stillness term begins
    stillFull: 6,
    stillMax: 0.22,
    heartMin: 60,
    heartMax: 160,
    heartRate: 1.6, // 1/s smoothing for bpm
    pulseDecay: 7, // 1/s beatPulse envelope decay
  };

  /** State shaping: [multiplier, floor] applied to the proximity term. */
  const STATE_SHAPE = {
    DORMANT: [0.15, 0],
    DISTANT: [0.4, 0],
    OBSERVING: [0.9, 0.08],
    APPROACHING: [1.0, 0],
    PURSUING: [1.12, 0.05],
    BURST: [1.35, 0.25],
    ATTACK: [1.5, 0.85],
    RECOVERING: [0.5, 0],
  };

  class ThreatSystem {
    constructor() {
      this.components = { creature: 0, falling: 0, burst: 0, stillness: 0, nearMiss: 0 };
      this.reset();
    }

    /** Clears everything (new run / respawn). */
    reset() {
      this.value = 0;
      this.raw = 0;
      const c = this.components;
      c.creature = 0;
      c.falling = 0;
      c.burst = 0;
      c.stillness = 0;
      c.nearMiss = 0;
      this.heartRate = TUNE.heartMin;
      this.beat = 0;
      this.beatPulse = 0;
      this.beatThisFrame = false; // true on the frame a beat starts (audio may use it)
      this.stillTime = 0;
      this._lastState = null;
    }

    /**
     * @param {number} dt
     * @param {{player?:AT.Player, creature?:AT.Creature, grapple?:AT.GrappleSystem, diff?:object, level?:AT.Level}} inputs
     */
    update(dt, inputs) {
      if (!(dt > 0)) return;
      if (dt > 0.1) dt = 0.1;
      const o = inputs || {};
      const player = o.player || null;
      const creature = o.creature || null;
      const diff = o.diff || null;
      const c = this.components;
      const alive = !!player && player.alive !== false;
      const creatureOn = !!creature && creature.active !== false && !(diff && diff.creature && diff.creature.enabled === false);

      // ---- creature proximity × state ---------------------------------------
      let cv = 0;
      if (creatureOn && alive) {
        const d = typeof creature.distance === 'number' && isFinite(creature.distance) ? creature.distance : 1e9;
        const prox = Math.exp(-Math.max(0, d - TUNE.nearDist) / TUNE.falloff);
        const shape = STATE_SHAPE[creature.state] || STATE_SHAPE.APPROACHING;
        cv = Math.max(prox * shape[0], shape[1] * Math.min(1, prox * 2));
        if (creature.lethal === false && !creature.sighting) cv *= 0.6;
        if (creature.sighting) {
          // The far crossing: unsettling, not panicking.
          const s = creature.sighting;
          const k = s.duration > 0 ? U.clamp(s.t / s.duration, 0, 1) : 0;
          cv = Math.max(cv, 0.32 * U.smoothstep(0, 0.2, k) * (1 - U.smoothstep(0.8, 1, k)));
        }
      }
      c.creature = U.clamp(cv, 0, 1);

      // ---- burst spike ------------------------------------------------------------
      const state = creatureOn ? creature.state : null;
      if (state === 'BURST' && this._lastState !== 'BURST') c.burst = 1;
      else c.burst = Math.max(0, c.burst - TUNE.burstDecay * dt);
      if (state === 'BURST') c.burst = Math.max(c.burst, 0.6);
      this._lastState = state;
      if (!creatureOn) c.burst = 0;

      // ---- near miss -----------------------------------------------------------------
      c.nearMiss = creatureOn && typeof creature.nearMiss === 'number' ? U.clamp(creature.nearMiss, 0, 1) : 0;

      // ---- falling ---------------------------------------------------------------------
      let fall = 0;
      if (alive && !player.grounded && player.grappleState !== 'attached') {
        const lethal = diff && diff.lethalImpact > 0 ? diff.lethalImpact : 1150;
        const ratio = (player.vy || 0) / lethal;
        fall = U.smoothstep(TUNE.fallStart, 1.0, ratio) * (diff && diff.impactsLethal === false ? 0.45 : 0.9);
      }
      c.falling = fall;

      // ---- stillness (only while it can actually kill you) ------------------------------
      const speed = player ? Math.hypot(player.vx || 0, player.vy || 0) : 0;
      if (alive && speed < 45) this.stillTime += dt;
      else this.stillTime = 0;
      const lethalNow = creatureOn && creature.lethal === true && creature.inPlay !== false;
      c.stillness = lethalNow ? U.smoothstep(TUNE.stillStart, TUNE.stillFull, this.stillTime) * TUNE.stillMax : 0;

      // ---- combine (probabilistic OR) ----------------------------------------------------
      let keep = 1;
      keep *= 1 - c.creature;
      keep *= 1 - c.falling;
      keep *= 1 - c.burst * 0.35;
      keep *= 1 - c.nearMiss * 0.55;
      keep *= 1 - c.stillness;
      this.raw = alive ? U.clamp(1 - keep, 0, 1) : 0;

      // ---- smoothing: fast attack, slow release ------------------------------------------
      const rate = this.raw > this.value ? TUNE.attackRate : TUNE.releaseRate;
      this.value = U.clamp(U.damp(this.value, this.raw, rate, dt), 0, 1);
      if (this.value < 1e-4) this.value = 0;

      // ---- heartbeat ---------------------------------------------------------------------
      const bpmTarget = TUNE.heartMin + (TUNE.heartMax - TUNE.heartMin) * this.value;
      this.heartRate = U.damp(this.heartRate, bpmTarget, TUNE.heartRate, dt);
      this.beat += (dt * this.heartRate) / 60;
      this.beatThisFrame = false;
      if (this.beat >= 1) {
        this.beat -= Math.floor(this.beat);
        this.beatPulse = 1;
        this.beatThisFrame = true;
      } else {
        this.beatPulse = Math.max(0, this.beatPulse * Math.exp(-TUNE.pulseDecay * dt));
      }
    }
  }

  ThreatSystem.TUNING = TUNE;
  AT.ThreatSystem = ThreatSystem;
})((window.AT = window.AT || {}));
