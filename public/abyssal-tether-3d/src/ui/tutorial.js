/* ABYSSAL TETHER 3D — tutorial.js
 * WP-UX: the first-run hints. The level already briefs the trigger and the swing (data/level-data-3d.js hints); these four
 * are the things a new player does not discover alone, each one short, shown only when it is relevant and only until it has
 * been learned:
 *
 *   fire   no tether fired after 14 s of the first run          done on rope:fire
 *   reel   hanging on a rope for 2.5 s and never reeled         done when the reel input is used (|reel| > 0.4)
 *   grip   a hand near a chalk-studded hold, never grabbed      done on climb:grab
 *   bag    a bag item was picked up, or health is low           done on bag:apply
 *   knocker  a knocker was picked up, or one is carried in S3+    done on knocker:throw (THE KNOCKER, sim/knocker3d.js)
 *
 * TUTORIAL v2 (plans/TUTORIAL_ASSIST.md) appends six one-time hints, each queued by the event that makes it relevant and shown at
 * the next quiet moment inside its window (WINDOW s; the dark and the fuel wait as long as they stay true):
 *
 *   sight  the first 'creature:notice' (sim/masonSight.js)             done on 'lantern:hood' {on:true} or 'chase:lost'
 *   chain  'flow:link' {n:2} (sim/flow3d.js)                           done on 'flow:end' {n >= 3}
 *   guide  hanging on a line > 2 s with settings.releaseGuide on       done on 'grapple:release' {reason:'input'} once shown
 *          (render/releaseGuide.js; the rope's own release: physics3d.js, not climb3d's 'climb:release')
 *   rest   'nook:enter' (sim/objectives3d.js, a Masons' rest)          done the moment it is shown (once ever)
 *   nv     'nv:dark' (game.js, the first time the shaft is too dark)   done on 'nv:on' (sim/nightVision3d.js)
 *   jet    'jetpack:can' (sim/jetpack3d.js, the first fuel can)         done on 'jetpack:ignite'
 *
 * Danger keeps every hint away: moving fast, a Mason chase on (game.chase.arc.chasing), a Holdfast hand locked on yours.
 * A learned step never returns (persisted in Storage 'tutorial', so it survives restarts); an unlearned one is shown at
 * most twice, at least 25 s apart, never over a level hint, a menu, a death, or while the player is fighting the rope for
 * their life (fast). settings.tutorialHints = false silences all of it. Pure logic over (game, bus, ui): Node-testable with
 * fakes. No allocation per frame.
 */
import { Storage } from '../sim/config3d.js';

export const STEPS = Object.freeze([
  Object.freeze({
    id: 'fire',
    text: 'Pull the [Trigger] to fire your tether at any wall, ceiling or ledge.',
    desktop: 'Hold the [Left mouse button] to fire your tether at any wall, ceiling or ledge.',
    touch: 'Hold [ROPE R] or [ROPE L] to fire that hand’s tether at any wall, ceiling or ledge.',
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
  Object.freeze({
    id: 'knocker',
    text: 'Squeeze the [Grip] at your hip and pull up to take a knocker, then throw it. The Mason answers knocks.',
    desktop: 'Hold [G] to aim a knocker, release to throw it. The Mason answers knocks.',
    touch: 'Tap [BAG], then [KNOCK] to throw a knocker. The Mason answers knocks.',
    seconds: 7,
  }),
  // ---- TUTORIAL v2 ----
  Object.freeze({
    id: 'sight',
    text: 'It sees your LIGHT; a hit costs 30% health. Break the line or [Grip] your hand over the lantern.',
    desktop: 'It sees your LIGHT; a hit costs 30% health. Break the line or hold [V] to cover the lantern.',
    touch: 'It sees your LIGHT; a hit costs 30% health. Break the line or hold [HOOD] to cover the lantern.',
    seconds: 6,
  }),
  Object.freeze({
    id: 'chain',
    text: 'Fire the next tether before you land: chains feed your lantern.',
    desktop: 'Fire the next tether before you land: chains feed your lantern.',
    touch: 'Fire the next tether before you land: chains feed your lantern.',
    seconds: 5,
  }),
  Object.freeze({
    id: 'guide',
    text: 'The dotted arc is where you land if you let go. Release the [Trigger] to drop.',
    desktop: 'The dotted arc is where you land if you let go. Release the [Mouse button] to drop.',
    touch: 'The dotted arc is where you land if you let go. Release [ROPE] to drop.',
    seconds: 6,
  }),
  Object.freeze({
    id: 'rest',
    text: 'A Masons’ rest: it cannot strike you here. It will not last.',
    desktop: 'A Masons’ rest: it cannot strike you here. It will not last.',
    touch: 'A Masons’ rest: it cannot strike you here. It will not last.',
    seconds: 6,
    learnOnShow: true,
  }),
  Object.freeze({
    id: 'nv',
    text: 'Too dark for the lantern alone. Tap [Y]: night vision.',
    desktop: 'Too dark for the lantern alone. Press [N]: night vision.',
    touch: 'Too dark for the lantern alone. Tap [NV]: night vision.',
    seconds: 6,
  }),
  Object.freeze({
    id: 'jet',
    text: 'Jetpack fuel. Falling with no rope? Squeeze [Both triggers] to brake the fall.',
    desktop: 'Jetpack fuel. Falling with no rope? Press [J] to brake the fall.',
    touch: 'Jetpack fuel. Falling with no rope? Tap [JUMP] in the air to brake the fall.',
    seconds: 6,
  }),
]);
/** The steps by id (TUTORIAL v2: the new steps are found by id, not by index). */
export const STEP = Object.freeze(Object.fromEntries(STEPS.map((s) => [s.id, s])));
/** TUTORIAL v2: how long (s) an event-queued hint stays relevant (Infinity: as long as its condition holds: the dark, the fuel). */
export const WINDOW = Object.freeze({ sight: 20, chain: 12, rest: 8, nv: Infinity, jet: Infinity });
const QUEUED = Object.freeze(['sight', 'rest', 'jet', 'nv', 'chain']); // the order they win a quiet moment in
const GUIDE_AFTER = 2; // s on one line before the release-guide hint
const KNOCK_AFTER = 40; // s of run time, carrying a knocker from S3 down, before the knocker hint (without a pickup)

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
    this._knockPending = -1; // ... and the knocker hint (after a knocker pickup)
    this._pending = null; // the step shown now (to mark learned if the player does it while it is up)
    this._due = { sight: -1, chain: -1, rest: -1, nv: -1, jet: -1 }; // TUTORIAL v2: clock time each queued hint expires (-1 = none)
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
    on('knocker:throw', () => this.learn('knocker'));
    on('pickup:collect', (e) => {
      if (e && e.kind === 4) {
        if (!this.data.done.knocker) this._knockPending = this.clock + 3.4; // (after the pickup's own toast)
      } else if (!this.data.done.bag) this._bagPending = this.clock + 1.6;
    });
    // ---- TUTORIAL v2: queued by the event that makes each relevant ----
    on('creature:notice', (e) => {
      if (!(e && e.skit)) this._queue('sight');
    });
    on('lantern:hood', (e) => {
      if (e && e.on) this.learn('sight');
    });
    on('chase:lost', () => this.learn('sight'));
    on('flow:link', (e) => {
      if (e && e.n === 2) this._queue('chain');
    });
    on('flow:end', (e) => {
      if (e && e.n >= 3) this.learn('chain');
    });
    on('grapple:release', (e) => {
      if (e && e.reason === 'input' && (this.data.shown.guide | 0) > 0) this.learn('guide');
    });
    on('nook:enter', () => this._queue('rest'));
    on('nv:dark', () => this._queue('nv'));
    on('nv:on', () => this.learn('nv'));
    on('jetpack:can', () => this._queue('jet'));
    on('jetpack:ignite', () => this.learn('jet'));
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

  /** TUTORIAL v2: an event made a hint relevant: it waits for a quiet moment within its window. */
  _queue(id) {
    const g = this.game;
    if (g && g.settings && g.settings.tutorialHints === false) return; // (silenced: nothing waits to speak later)
    if (this.data.done[id] || (this.data.shown[id] | 0) >= MAX_SHOWS) return;
    if (this._due[id] >= this.clock) return; // already waiting
    this._due[id] = this.clock + WINDOW[id];
  }

  /** Moving fast, a chase on, a Holdfast hand locked on yours: no hint now. */
  _danger(g) {
    const p = g.player;
    if (p && Math.hypot(p.vx || 0, p.vy || 0, p.vz || 0) > 12) return true; // nobody reads a hint mid-swing
    const arc = g.chase && g.chase.arc;
    if (arc && arc.chasing) return true;
    const hf = g.holdfast;
    return !!(hf && hf.held);
  }

  _newRun() {
    for (const k of QUEUED) this._due[k] = -1;
    this._attachedFor = 0;
    this._hoverFor = 0;
    this._bagPending = -1;
    this._knockPending = -1;
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
    this._lastShown = this.clock;
    if (step.learnOnShow) this.data.done[step.id] = true; // (before _pending: learning it must not take it straight down)
    this._save();
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
    if (this._danger(g)) return;
    // ---- pick the most relevant step ----
    // TUTORIAL v2: the queued hints first (each is relevant right now, and only for a while)
    const due = this._due;
    for (let k = 0; k < QUEUED.length; k++) {
      const id = QUEUED[k];
      if (due[id] < 0) continue;
      if (d[id] || this.clock > due[id]) {
        due[id] = -1;
        continue;
      }
      due[id] = -1;
      if (this._show(STEP[id])) return;
    }
    if (!d.grip && this._hoverFor >= HOVER_AFTER) {
      this._show(STEPS[2]);
    } else if (!d.bag && this._bagPending >= 0 && this.clock >= this._bagPending) {
      this._bagPending = -1;
      this._show(STEPS[3]);
    } else if (!d.bag && g.health && g.health.hp < 0.45 && g.bag && g.bag.counts && (g.bag.counts[0] > 0 || g.bag.counts[1] > 0)) {
      this._show(STEPS[3]);
    } else if (!d.knocker && this._knockPending >= 0 && this.clock >= this._knockPending) {
      this._knockPending = -1;
      this._show(STEPS[4]);
    } else if (!d.knocker && g.knocker && g.knocker.enabled !== false && g.bag && g.bag.counts && g.bag.counts[4] > 0 && (g.sectionIndex | 0) >= 2 && (g.time || 0) > KNOCK_AFTER) {
      this._show(STEPS[4]);
    } else if (!d.reel && (this.data.shown.reel | 0) < MAX_SHOWS && this._attachedFor >= HANG_AFTER && (g.time || 0) > 20) {
      this._show(STEPS[1]);
    } else if (!d.guide && (d.reel || (this.data.shown.reel | 0) >= MAX_SHOWS) && this._attachedFor >= GUIDE_AFTER && g.settings.releaseGuide !== false && (g.time || 0) > 20 && (this.data.shown.guide | 0) < MAX_SHOWS) {
      this._show(STEP.guide);
    } else if (!d.fire && (g.time || 0) >= FIRE_AFTER && g.sectionIndex === 0 && !(t && t.attached)) {
      this._show(STEPS[0]);
    }
  }
}
