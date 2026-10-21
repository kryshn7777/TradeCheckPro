/* ABYSSAL TETHER 3D — tutorial.js
 * WP-UX: the first-run hints. The level already briefs the trigger and the swing (data/level-data-3d.js hints); these four
 * are the things a new player does not discover alone, each one short, shown only when it is relevant and only until it has
 * been learned:
 *
 *   fire   no tether fired after 14 s of the first run          done on rope:fire
 *   reel   hanging on a rope for 2.5 s and never reeled         done when the reel input is used (|reel| > 0.4)
 *   grip   a hand near a chalk-studded hold, never grabbed      done on climb:grab
 *   bag    a bag item was picked up, or health is low           done on bag:apply
 *
 * A learned step never returns (persisted in Storage 'tutorial', so it survives restarts); an unlearned one is shown at
 * most twice, at least 25 s apart, never over a level hint, a menu, a death, or while the player is fighting the rope for
 * their life (fast). settings.tutorialHints = false silences all of it. Pure logic over (game, bus, ui): Node-testable with
 * fakes. No allocation per frame.
 */
import { Storage } from '../sim/config3d.js';

export const STEPS = Object.freeze([
  Object.freeze({
    id: 'fire',
    text: 'Pull the [Trigger] to fire your tether at a glowing ring.',
    desktop: 'Hold the [Left mouse button] to fire your tether at a glowing ring.',
    touch: 'Hold [ROPE R] or [ROPE L] to fire that hand’s tether at a glowing ring.',
    seconds: 6,
  }),
  Object.freeze({
    id: 'reel',
    text: 'Push the [Right stick] up to reel in, down to let rope out.',
    desktop: 'Hold [Space] to reel in, [Shift] to let rope out.',
    touch: 'Hold [REEL] to reel in, [LET OUT] to let rope out.',
    seconds: 6,
  }),
  Object.freeze({
    id: 'grip',
    text: 'Squeeze the [Grip] on chalk marks to climb. Move your hand to pull.',
    desktop: 'Hold [F] near chalk marks to cling, then [W][A][S][D] to climb.',
    touch: 'Hold [GRIP] near chalk marks to cling, then use the stick to climb.',
    seconds: 7,
  }),
  Object.freeze({
    id: 'bag',
    text: 'Reach to your right hip and squeeze the [Grip] to open your bag.',
    desktop: 'Press [1] to [4] to use a bag item.',
    touch: 'Tap [BAG], then an item to use it.',
    seconds: 7,
  }),
]);

const MAX_SHOWS = 2;
const GAP = 25; // s between two tutorial hints
const FIRE_AFTER = 14; // s of run time with no tether fired
const HANG_AFTER = 2.5; // s attached before the reel hint
const HOVER_AFTER = 0.6; // s near a hold before the grip hint
const CHECK = 0.25; // s between condition checks

export class Tutorial {
  /**
   * @param {object} game Game3D (bus, settings, state, time, tethers, physics.climb, health, intent, sectionIndex)
   * @param {{current: any, showHint: Function, vrMode?: boolean, _hint?: object}} ui
   */
  constructor(game, ui) {
    this.game = game;
    this.ui = ui;
    this.data = this._load();
    this.clock = 0;
    this._acc = 0;
    this._lastShown = -1e9;
    this._attachedFor = 0;
    this._hoverFor = 0;
    this._bagPending = -1; // clock time at which to show the bag hint (after a pickup)
    this._pending = null; // the step shown now (to mark learned if the player does it while it is up)
    this._offs = [];
  }

  _load() {
    const d = Storage.get('tutorial', null);
    const out = { done: {}, shown: {} };
    if (d && typeof d === 'object') {
      if (d.done && typeof d.done === 'object') for (const s of STEPS) if (d.done[s.id] === true) out.done[s.id] = true;
      if (d.shown && typeof d.shown === 'object') for (const s of STEPS) if (typeof d.shown[s.id] === 'number') out.shown[s.id] = d.shown[s.id] | 0;
    }
    return out;
  }

  _save() {
    Storage.set('tutorial', this.data);
  }

  /** Marks a step learned (persisted). */
  learn(id) {
    if (this.data.done[id]) return;
    this.data.done[id] = true;
    this._save();
    if (this._pending && this._pending.id === id) {
      this._pending = null;
      if (this.ui && typeof this.ui.hideHint === 'function' && this.ui._hint && this.ui._hint.tutorial) this.ui.hideHint();
    }
  }

  /** Forgets everything learned (Settings > Reset hints). */
  reset() {
    this.data = { done: {}, shown: {} };
    this._save();
  }

  attach() {
    const bus = this.game && this.game.bus;
    if (!bus || typeof bus.on !== 'function') return;
    const on = (type, fn) => {
      const off = bus.on(type, fn);
      if (typeof off === 'function') this._offs.push(off);
    };
    on('rope:fire', (e) => {
      if (e && e.target !== null && e.target !== undefined) this.learn('fire'); // a shot at a target, not a miss into nothing
    });
    on('grapple:attach', () => this.learn('fire'));
    on('climb:grab', () => this.learn('grip'));
    on('bag:apply', () => this.learn('bag'));
    on('pickup:collect', () => {
      if (!this.data.done.bag) this._bagPending = this.clock + 1.6;
    });
    on('game:start', () => this._newRun());
    on('game:restart', () => this._newRun());
    on('game:respawn', () => {
      this._attachedFor = 0;
      this._hoverFor = 0;
    });
  }

  detach() {
    for (const off of this._offs) off();
    this._offs.length = 0;
  }

  _newRun() {
    this._attachedFor = 0;
    this._hoverFor = 0;
    this._bagPending = -1;
    this._lastShown = this.clock - GAP + 8; // a first hint no sooner than 8 s into a run
  }

  /** True when a hint may appear right now. */
  _quiet(g) {
    const ui = this.ui;
    if (!ui || ui.current !== null) return false;
    if (g.state !== 'playing' || !g.player || g.player.alive === false || g.victoryT >= 0) return false;
    if (ui._hint && ui._hint.on) return false; // a level hint (or ours) is up
    if (this.clock - this._lastShown < GAP) return false;
    return true;
  }

  _show(step) {
    const n = this.data.shown[step.id] | 0;
    if (n >= MAX_SHOWS) return false;
    this.data.shown[step.id] = n + 1;
    this._save();
    this._lastShown = this.clock;
    this._pending = step;
    this.ui.showHint({ text: step.text, desktop: step.desktop, touch: step.touch }, step.seconds);
    if (this.ui._hint) this.ui._hint.tutorial = true;
    return true;
  }

  /** Per frame (game state is read at 4 Hz). */
  update(dt) {
    const g = this.game;
    if (!g || !g.settings) return;
    this.clock += dt;
    if (this._pending && this.ui._hint && !this.ui._hint.on) this._pending = null;
    this._acc += dt;
    if (this._acc < CHECK) return;
    const step = this._acc;
    this._acc = 0;
    if (g.settings.tutorialHints === false) return;
    const d = this.data.done;
    if (g.state !== 'playing') {
      this._attachedFor = 0;
      this._hoverFor = 0;
      return;
    }
    // ---- learn from what the player does (even while no hint is up) ----
    const it = g.intent;
    if (!d.reel && it && typeof it.reel === 'number' && Math.abs(it.reel) > 0.4) this.learn('reel');
    // ---- accumulate the conditions ----
    const t = g.tethers;
    this._attachedFor = t && t.attached ? this._attachedFor + step : 0;
    const cl = g.physics && g.physics.climb;
    let hover = false;
    if (cl && cl.hands) hover = !!(cl.hands.left && (cl.hands.left.hoverIn || cl.hands.left.hover)) || !!(cl.hands.right && (cl.hands.right.hoverIn || cl.hands.right.hover));
    this._hoverFor = hover && !(cl && cl.holding) ? this._hoverFor + step : 0;
    if (!this._quiet(g)) return;
    // ---- pick the most relevant step ----
    const p = g.player;
    const fast = p && Math.hypot(p.vx || 0, p.vy || 0, p.vz || 0) > 12;
    if (fast) return; // nobody reads a hint mid-swing
    if (!d.grip && this._hoverFor >= HOVER_AFTER) {
      this._show(STEPS[2]);
    } else if (!d.bag && this._bagPending >= 0 && this.clock >= this._bagPending) {
      this._bagPending = -1;
      this._show(STEPS[3]);
    } else if (!d.bag && g.health && g.health.hp < 0.45 && g.bag && g.bag.counts && (g.bag.counts[0] > 0 || g.bag.counts[1] > 0)) {
      this._show(STEPS[3]);
    } else if (!d.reel && this._attachedFor >= HANG_AFTER && (g.time || 0) > 20) {
      this._show(STEPS[1]);
    } else if (!d.fire && (g.time || 0) >= FIRE_AFTER && g.sectionIndex === 0 && !(t && t.attached)) {
      this._show(STEPS[0]);
    }
  }
}
