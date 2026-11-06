/* THE LANTERN (ABYSSAL TETHER 3D) — chaseGlue.js
 * THE CHASE ARC (docs/abyssal-tether-3d/plans/CHASE_ARC.md): what game.js needs to give a Mason chase its release, in one module.
 *
 *   const cg = new ChaseGlue(game)   once (game.js _setupChase, with the bus): `game.chase`; `game.chase.arc` is the ChaseArc
 *   cg.update(dt)                    once a frame (game.js _updateViews), any state: the arc only runs while playing
 *
 * The arc (sim/chaseArc.js) listens to the bus and says chase:start / chase:lost. Here: while it chases, a heartbeat `chase:pulse` {k, d}
 * every PULSE.slow s far off down to PULSE.fast s when the Mason is near (capped), slower and softer in the settle window (it has lost
 * you, it does not know yet); the sounds are audio/chaseSfx.js (registered once the audio exists). On chase:lost: the toast
 * 'LOST IT · 14.2 s · closest 3.1 m · 1 knocker' (chaseToast) and the score ducked for DUCK s (Music3D.duck through audio._music), so the
 * exhale lands in a quiet room. No vignette: the only screen vignette is the low-health one (render/healthFx.js), not a comfort-safe
 * hook. No allocation per frame (the pulse payload is reused).
 */
import { ChaseArc, CHASE_STATE } from './sim/chaseArc.js';
import { registerChaseSfx } from './audio/chaseSfx.js';

export const PULSE = Object.freeze({
  slow: 0.9, // s between beats at `farD` m or more
  fast: 0.5, // s between beats at `nearD` m or less (the cap: never faster)
  nearD: 4,
  farD: 24,
  settle: 1.15, // s between beats in the settle window
  settleK: 0.3,
});
export const DUCK = 4; // s of no score after the release
export const TOAST_S = 3;

const r1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** The toast text: 'LOST IT · 14.2 s · closest 3.1 m · 1 knocker · 2 near misses' (the counts only when > 0; no locale formatting). */
export function chaseToast(e) {
  const p = e || {};
  let s = `LOST IT · ${r1(Math.max(0, +p.duration || 0))} s`;
  if (typeof p.closest === 'number' && isFinite(p.closest) && p.closest < 1e8) s += ` · closest ${r1(p.closest)} m`;
  const k = p.knockers | 0;
  if (k > 0) s += ` · ${plural(k, 'knocker', 'knockers')}`;
  const n = p.nearMisses | 0;
  if (n > 0) s += ` · ${plural(n, 'near miss', 'near misses')}`;
  return s;
}

/** The beat interval at the Mason's distance d (m): fast near, slow far, linear between, capped at both ends. */
export function pulseInterval(d) {
  if (!(d < PULSE.farD)) return PULSE.slow;
  if (d <= PULSE.nearD) return PULSE.fast;
  return PULSE.fast + ((PULSE.slow - PULSE.fast) * (d - PULSE.nearD)) / (PULSE.farD - PULSE.nearD);
}

export class ChaseGlue {
  constructor(game) {
    this.game = game;
    const bus = game && game.bus;
    this.arc = new ChaseArc(bus);
    this.beatT = 0;
    this.pulses = 0;
    this.toasts = 0;
    this.ducks = 0;
    this.lastToast = '';
    this._pulse = { k: 0, d: 0 };
    this._sfx = false;
    this._forced = false; // a debug start: the watchdog leaves it alone until it is lost
    if (bus && typeof bus.on === 'function') {
      bus.on('chase:start', () => {
        this.beatT = pulseInterval(this._dist()); // chase:start plays the first beat itself (the route)
      });
      bus.on('chase:lost', (e) => this._release(e));
      bus.on('player:death', () => (this._forced = false));
    }
  }

  /** The Mason's sight read-out (sim/masonSight.js via Creature3D.sight), or null. */
  _sight() {
    const c = this.game && this.game.creature;
    return c && c.sight ? c.sight : null;
  }

  _dist() {
    const s = this._sight();
    return s && typeof s.nearDist === 'number' ? s.nearDist : 1e9;
  }

  _release(e) {
    const g = this.game;
    const text = chaseToast(e);
    this._forced = false;
    this.lastToast = text;
    this.toasts++;
    if (g && typeof g._toast === 'function') g._toast(text, TOAST_S);
    const m = g && g.audio && g.audio._music;
    if (m && typeof m.duck === 'function') {
      m.duck(DUCK);
      this.ducks++;
    }
  }

  update(dt) {
    const g = this.game;
    if (!g) return;
    if (!this._sfx && g.audio) this._sfx = registerChaseSfx(g.audio) || g.audio.registerSfx === undefined;
    const p = g.player;
    const playing = g.state === 'playing' && !!p && p.alive !== false && !(g.victoryT >= 0);
    if (!playing) return; // paused / menu / dead: the clock stops (a death ends the chase on the bus)
    const arc = this.arc;
    const d = this._dist();
    // a watchdog: the Mason left play / was reset without a sight-off (a section warp): its chase is over
    if (arc.state === CHASE_STATE.CHASING && !this._forced) {
      const s = this._sight();
      if (!s || (!s.chasing && !s.noticing)) arc.onSightOff('blocked');
    }
    arc.update(dt, d);
    if (arc.state === CHASE_STATE.CHASING || (arc.state === CHASE_STATE.SETTLE && arc.started)) {
      this.beatT -= dt;
      if (this.beatT <= 0) {
        const settle = arc.state === CHASE_STATE.SETTLE;
        const P = this._pulse;
        P.d = d;
        P.k = settle ? PULSE.settleK : 1 - (pulseInterval(d) - PULSE.fast) / (PULSE.slow - PULSE.fast);
        this.beatT = settle ? PULSE.settle : pulseInterval(d);
        this.pulses++;
        if (g.bus) g.bus.emit('chase:pulse', P);
      }
    }
  }

  /** window.AT3D.debug.chase.start(dist): a chase on now (as a commit at dist m), kept until lost() / a death. */
  debugStart(dist) {
    this._forced = true;
    return this.arc.forceStart(dist);
  }

  /** window.AT3D.debug.chase.lost(): the release now (skips the 3 s settle). True when chase:lost went out. */
  debugLost() {
    const ok = this.arc.forceLost();
    this._forced = false;
    return ok;
  }

  /** window.AT3D.debug.chase.state() */
  debugState() {
    return Object.assign(this.arc.debugState(), { pulses: this.pulses, toasts: this.toasts, ducks: this.ducks, lastToast: this.lastToast, sfx: !!this._sfx });
  }
}
