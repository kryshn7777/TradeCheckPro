/* THE LANTERN (ABYSSAL TETHER 3D) — masonAttackGlue.js
 * MASON SNAKE ATTACK (docs/abyssal-tether-3d/plans/MASON_SNAKE_ATTACK.md): what game.js needs to show and voice the Mason's snake
 * attack, in one module.
 *
 *   const mg = new MasonAttackGlue(game)   once (game.js _setupMasonAttack, with the bus): `game.masonAttack`
 *   mg.update(dt)                          once a frame (game.js _updateViews), before the creature view
 *
 * Each frame: the attack phase (render/mason/attackPhase.js: the new sim's fields when present, else derived from the old ones), the
 * cobra's envelopes (render/mason/snakePose.js) handed to the creature view (`view.snake`: the rig and the kit both bend their front
 * blocks with it), the red glow's flare (`lightFlare`, read by Renderer3D._syncCreatureLight) and the sounds on the bus:
 *   mason:attack {phase, x, y, z, k}   on each phase change (dash, rise, stare, lock, strike, recoil, halt = the dash ends) and
 *                                      'hit' when a strike lands (creature:strike hit) — audio/masonAttackSfx.js + the captions
 *   mason:rattle {k, x, y, z}          a grain of the stone rattle every 0.34 -> 0.13 s while it is coiled (k = the tension)
 * at the coiled head (the pose's head point, else the sim's). No allocation per frame (two reused payloads), deterministic.
 */
import { AttackPhase } from './render/mason/attackPhase.js';
import { SnakePose } from './render/mason/snakePose.js';
import { registerMasonAttackSfx } from './audio/masonAttackSfx.js';

export const RATTLE = Object.freeze({ slow: 0.34, fast: 0.13, minCoil: 0.35 });

const fin = (v) => typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;

export class MasonAttackGlue {
  constructor(game) {
    this.game = game;
    this.phase = new AttackPhase();
    this.pose = new SnakePose();
    this.lightFlare = 0;
    this.rattles = 0;
    this.events = 0;
    this._rattleT = 0;
    this._sfx = false;
    this._ev = { phase: 'idle', x: 0, y: 0, z: 0, k: 0 };
    this._rt = { k: 0, x: 0, y: 0, z: 0 };
    this._aim = { x: 0, y: 0, z: 0, head: false };
    this._stareSaid = false; // one 'stare' event per approach (the stare after a recoil is silent: the recoil said it)
    this._view = null;
    const bus = game && game.bus;
    if (bus && typeof bus.on === 'function') {
      bus.on('creature:phase', (p) => this.phase.onPhaseEvent(p));
      bus.on('creature:strike', (p) => {
        if (p && p.hit && !p.skit) this._emit('hit', 1, p.x, p.y, p.z);
      });
    }
  }

  /** The point the head (and the sounds) are at: the coiled head when the pose has one, else the sim's head. */
  _head(out) {
    const P = this.pose;
    if (P.active && P.headOk) {
      out.x = P.headX;
      out.y = P.headY;
      out.z = P.headZ;
      return true;
    }
    const c = this.game && this.game.creature;
    const h = c && c.body && c.body.head;
    if (!h || !fin(h.x) || !fin(h.y) || !fin(h.z)) return false;
    out.x = h.x;
    out.y = h.y;
    out.z = h.z;
    return true;
  }

  _emit(phase, k, x, y, z) {
    const bus = this.game && this.game.bus;
    if (!bus) return;
    const e = this._ev;
    e.phase = phase;
    e.k = k;
    if (fin(x) && fin(y) && fin(z)) {
      e.x = x;
      e.y = y;
      e.z = z;
    } else if (!this._head(e)) return;
    this.events++;
    bus.emit('mason:attack', e);
  }

  update(dt) {
    const g = this.game;
    if (!g) return;
    if (!this._sfx && g.audio) this._sfx = registerMasonAttackSfx(g.audio) || g.audio.registerSfx === undefined;
    const c = g.creature;
    const ph = this.phase;
    const playing = g.state === 'playing' && !(g.victoryT >= 0);
    const frozen = !!g._masonFreeze; // captures: the view holds the pose (AT3D.debug.masonPhase(..., {freeze}))
    const step = frozen ? 0 : dt;
    // the aim fallback: the player's eyes (the camera when there is one)
    const A = this._aim;
    const cam = g.renderer && g.renderer.camera;
    const me = cam && cam.matrixWorld && cam.matrixWorld.elements;
    if (me && fin(me[12]) && fin(me[13]) && fin(me[14]) && (me[12] !== 0 || me[13] !== 0 || me[14] !== 0)) {
      A.x = me[12];
      A.y = me[13];
      A.z = me[14];
      A.head = true;
    } else if (g.player) {
      A.x = g.player.x;
      A.y = g.player.y;
      A.z = g.player.z;
      A.head = false;
    }
    if (!playing && !ph.forced) {
      // menus / death / the opening: nothing coils (the cinematic Mason is the view's own)
      ph.update(null, A, step);
    } else ph.update(c, A, step);
    const reduced = !!(g.settings && g.settings.reducedEffects);
    this.pose.update(step, ph, reduced);
    this.lightFlare = this.pose.lightFlare;
    // hand the pose to the view (the rig or the kit; a swap to the other picks it up next frame)
    const v = g.creatureView;
    if (v && !v.isStandIn) {
      if (this._view && this._view !== v) this._view.snake = null;
      v.snake = this.pose;
      this._view = v;
    }
    if (step <= 0) return;
    // ---- the sounds ----
    if (ph.changed) {
      const now = ph.phase;
      const was = ph.prev;
      if (was === 'dash' && now !== 'dash') this._emit('halt', 0.8, NaN, NaN, NaN); // the hard decel scrape into the coil
      if (now === 'stalk' || now === 'idle') this._stareSaid = false;
      if (now === 'stare') {
        if (!this._stareSaid && was !== 'recoil' && was !== 'rise') this._emit('stare', 0.6, NaN, NaN, NaN);
        this._stareSaid = true;
      } else if (now === 'dash' || now === 'rise' || now === 'lock' || now === 'strike' || now === 'recoil') {
        if (now === 'rise') this._stareSaid = true;
        this._emit(now, now === 'strike' ? 1 : now === 'lock' ? 1 : 0.7, NaN, NaN, NaN);
        if (now === 'lock') this._rattleT = 0.6; // the rattle stops dead on the lock (the tick is the deadline)
      }
    }
    const P = this.pose;
    const coiled = (ph.phase === 'rise' || ph.phase === 'stare' || ph.phase === 'recoil') && P.coil > RATTLE.minCoil;
    if (coiled) {
      this._rattleT -= step;
      if (this._rattleT <= 0) {
        const k = P.tension;
        this._rattleT = RATTLE.slow + (RATTLE.fast - RATTLE.slow) * k;
        const r = this._rt;
        if (this._head(r) && g.bus) {
          r.k = k;
          this.rattles++;
          g.bus.emit('mason:rattle', r);
        }
      }
    } else if (this._rattleT < 0.05) this._rattleT = 0.05;
  }

  /** AT3D.debug.masonPhase(phase, u | {u, freeze}): force a phase ('' / 'off' returns to the sim, 'cycle' loops the dance). */
  debugPhase(phase, o) {
    const u = typeof o === 'number' ? o : o && typeof o.u === 'number' ? o.u : -1;
    const ok = this.phase.force(phase, u);
    if (this.game) this.game._masonFreeze = !!(o && typeof o === 'object' && o.freeze);
    if (!this.phase.forced && this.game) this.game._masonFreeze = false;
    return ok;
  }

  debugState() {
    const ph = this.phase;
    const P = this.pose;
    return {
      phase: ph.phase,
      t01: +ph.t01.toFixed(3),
      source: ph.source,
      forced: ph.forced,
      locked: ph.locked,
      aim: [+ph.aimX.toFixed(2), +ph.aimY.toFixed(2), +ph.aimZ.toFixed(2)],
      coil: +P.coil.toFixed(3),
      sway: +P.sway.toFixed(3),
      stretch: +P.stretch.toFixed(3),
      dash: +P.dash.toFixed(3),
      jaw: +P.jaw.toFixed(3),
      eyes: +P.eyes.toFixed(3),
      lightFlare: +P.lightFlare.toFixed(3),
      head: P.headOk ? [+P.headX.toFixed(2), +P.headY.toFixed(2), +P.headZ.toFixed(2)] : null,
      rattles: this.rattles,
      events: this.events,
    };
  }
}
