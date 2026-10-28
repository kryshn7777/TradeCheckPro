/* ABYSSAL TETHER 3D — threat3d.js
 * ThreatSystem3D — one continuous 0..1 "dread" value that the rest of the
 * game feels rather than reads: it drives the heartbeat, breathing, vignette-free
 * VR effects (fog pulse, particle density, audio filtering) and haptics. Never
 * displayed numerically. Port of the 2D threat.js to metres / 3D.
 *
 * Inputs each frame:
 *   creature   proximity (exponential falloff: ~6 m → 1, ~56 m → ~0.05) shaped by
 *              its state (BURST / ATTACK up, RECOVERING / DORMANT down); zero when
 *              the creature is inactive (sandbox) or missing
 *   sighting   a modest swell while the distant crossing is happening
 *   falling    free-fall speed relative to the difficulty's lethal impact speed
 *              (not while a tether holds you)
 *   burst      a spike whenever the creature surges (decays over ~1 s)
 *   nearMiss   a spike when a lunge misses (creature.nearMiss pulse)
 *   stillness  a small creeping term for standing still / stalling in place while
 *              it can kill you
 * Components combine with a probabilistic OR (1 − Π(1 − cᵢ)) so several moderate
 * sources add up without ever exceeding 1. The output is smoothed with a fast
 * attack (~3/s) and a slow release (~0.6/s).
 *
 * DOM-free and three.js-free (Node-testable).
 */

import { U } from './config3d.js';

export const THREAT_TUNING = {
  attackRate: 3.0, // 1/s — how fast `value` rises toward `raw`
  releaseRate: 0.6, // 1/s — how slowly it decays
  nearDist: 6, // creature distance (m) that counts as "on top of you"
  falloff: 17, // exponential falloff length (m): 56 m → ~0.05
  fallStart: 0.45, // falling term starts at this fraction of lethal impact speed
  burstDecay: 1.4, // 1/s
  stillSpeed: 1.0, // m/s — below this the player counts as still
  stillStart: 1.5, // seconds still before the stillness term begins
  stillFull: 6,
  stillMax: 0.22,
  heartMin: 60,
  heartMax: 160,
  heartRate: 1.6, // 1/s smoothing for bpm
  pulseDecay: 7, // 1/s beatPulse envelope decay
};
const TUNE = THREAT_TUNING;

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

export class ThreatSystem3D {
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
    this.beat = 0; // 0..1 phase within the current beat
    this.beatPulse = 0; // 1 on a beat, decaying
    this.beatThisFrame = false; // true on the frame a beat starts (audio / haptics)
    this.stillTime = 0;
    this._lastState = null;
  }

  /**
   * @param {number} dt
   * @param {{player?:Player3D, creature?:Creature3D, tethers?:TetherSystem, diff?:object}} inputs
   * @returns {ThreatSystem3D} this (value, raw, heartRate, beat, beatPulse, beatThisFrame, components)
   */
  update(dt, inputs) {
    if (!(dt > 0)) return this;
    if (dt > 0.1) dt = 0.1;
    const o = inputs || {};
    const player = o.player || null;
    const creature = o.creature || null;
    const tethers = o.tethers || null;
    const diff = o.diff || null;
    const c = this.components;
    const alive = !!player && player.alive !== false;
    const creatureOn = !!creature && creature.active !== false && !(diff && diff.creature && diff.creature.enabled === false);

    // ---- creature proximity × state ---------------------------------------------
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

    // ---- burst spike ----------------------------------------------------------------
    const state = creatureOn ? creature.state : null;
    if (state === 'BURST' && this._lastState !== 'BURST') c.burst = 1;
    else c.burst = Math.max(0, c.burst - TUNE.burstDecay * dt);
    if (state === 'BURST') c.burst = Math.max(c.burst, 0.6);
    this._lastState = state;
    if (!creatureOn) c.burst = 0;

    // ---- near miss -----------------------------------------------------------------
    c.nearMiss = creatureOn && typeof creature.nearMiss === 'number' ? U.clamp(creature.nearMiss, 0, 1) : 0;
    // LEVEL_FUN_PLAN P5: hidden in a Masons' rest no attack can start: no burst / near-miss spikes, the threat eases
    const hidden = creatureOn && creature.refuge === 1;
    if (hidden) {
      c.burst = 0;
      c.nearMiss = 0;
      c.creature *= 0.6;
    }

    // ---- falling (descent is -Y) --------------------------------------------------------
    let fall = 0;
    const held = tethers ? tethers.attached === true : player && player.tethered === true;
    if (alive && !player.grounded && !held) {
      const lethal = diff && diff.lethalImpact > 0 ? diff.lethalImpact : 17;
      const ratio = -(player.vy || 0) / lethal;
      fall = U.smoothstep(TUNE.fallStart, 1.0, ratio) * (diff && diff.impactsLethal === false ? 0.45 : 0.9);
    }
    c.falling = fall;

    // ---- stillness / stalling (only while it can actually kill you) -------------------
    const speed = player ? Math.hypot(player.vx || 0, player.vy || 0, player.vz || 0) : 0;
    if (alive && speed < TUNE.stillSpeed) this.stillTime += dt;
    else this.stillTime = 0;
    const lethalNow = creatureOn && creature.lethal === true && creature.inPlay !== false;
    const stall = creatureOn && typeof creature.stallTime === 'number' ? creature.stallTime * 0.8 : 0;
    c.stillness = lethalNow && !hidden ? U.smoothstep(TUNE.stillStart, TUNE.stillFull, Math.max(this.stillTime, stall)) * TUNE.stillMax : 0;

    // ---- combine (probabilistic OR) ------------------------------------------------------
    let keep = 1;
    keep *= 1 - c.creature;
    keep *= 1 - c.falling;
    keep *= 1 - c.burst * 0.35;
    keep *= 1 - c.nearMiss * 0.55;
    keep *= 1 - c.stillness;
    this.raw = alive ? U.clamp(1 - keep, 0, 1) : 0;

    // ---- smoothing: fast attack, slow release ----------------------------------------------
    const rate = this.raw > this.value ? TUNE.attackRate : TUNE.releaseRate;
    this.value = U.clamp(U.damp(this.value, this.raw, rate, dt), 0, 1);
    if (this.value < 1e-4) this.value = 0;

    // ---- heartbeat -----------------------------------------------------------------------
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
    return this;
  }
}

ThreatSystem3D.TUNING = THREAT_TUNING;
