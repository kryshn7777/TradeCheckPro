/* THE LANTERN (ABYSSAL TETHER 3D) — trialGlue.js
 * SECTION TRIALS (docs/abyssal-tether-3d/plans/SECTION_TRIALS.md): what game.js needs to run a trial, in one module.
 *
 *   game.startTrial(diff, idx)        game.js: sets game.trial (meta/trials.js newTrial), start(diff), _warp(idx)
 *   new TrialGlue(game)               lazily, by startTrial (`game._trials`): listens to health:damage (clears `untouched`)
 *   glue.tick(intent)                 game.js _updateRun after the run clock moved: the trial clock (held at 0 until it arms)
 *   glue.sectionEntered(idx, mode)    game.js _enterSection: the next section entered in 'progress' ends the trial (true)
 *   glue.complete()                   ... and the goal of the last section (game.js _beginVictory)
 *   glue.died(cause)                  game.js _onPlayerDeath: the attempt failed (no restore, no death record)
 *
 * The card: the run freezes in the 'dead' state (so every "rise again" path — Enter, A, a click, the Continue button — and R
 * re-run the trial through game.respawn / game.restart), the UI shows its death screen in TRIAL mode (ui/ui3d.js reads game.trial).
 * Bus: 'trial:start' { idx, id, diff, ch }, 'trial:end' { idx, id, diff, ch, time, failed, medal, delta, isNew, untouched, best }.
 * No allocation per frame in tick().
 */
import { PAR_3D } from './data/par-3d.js';
import { trialTick, trialResult, saveTrialBest, loadTrials } from './meta/trials.js';

/** m: the body counts as moved once this far off its checkpoint (horizontal) / this far below or above it. */
const MOVE_H = 0.3;
const MOVE_V = 1.2;

export class TrialGlue {
  constructor(game) {
    this.game = game;
    this.storage = null; // null: localStorage (a test injects meta/trials.js memoryStorage())
    this.ends = 0;
    const bus = game && game.bus;
    this._off = bus
      ? bus.on('health:damage', () => {
          const tr = game.trial;
          if (tr && !tr.done) tr.untouched = false;
        })
      : null;
  }

  /** Any input this frame, or the body off its checkpoint: the clock arms. */
  moved(intent) {
    const g = this.game;
    if (intent) {
      const m = intent.move;
      if ((m && (m.x !== 0 || m.z !== 0)) || intent.jumpPressed || intent.reel || intent.jetPressed) return true;
      const h = intent.hands;
      if (h && ((h.left && (h.left.pressed || h.left.held)) || (h.right && (h.right.pressed || h.right.held)))) return true;
    }
    const p = g.player;
    const cp = g.checkpoint;
    if (!p || !cp) return false;
    const dx = p.x - cp.x;
    const dz = p.z - cp.z;
    return dx * dx + dz * dz > MOVE_H * MOVE_H || Math.abs(p.y - cp.y) > MOVE_V;
  }

  tick(intent) {
    const g = this.game;
    const tr = g.trial;
    if (!tr || tr.done || g.state !== 'playing') return;
    g.time = trialTick(tr, g.time, tr.armed || this.moved(intent));
  }

  /** game.js _enterSection: true when this entry ended the trial (the caller skips the section's bookkeeping). */
  sectionEntered(idx, mode) {
    const tr = this.game.trial;
    if (!tr || tr.done || mode !== 'progress' || !(idx > tr.idx)) return false;
    this.complete();
    return true;
  }

  _par(tr) {
    if (tr.ch !== 1) return null;
    const p = PAR_3D && PAR_3D[tr.diff];
    return p && p[tr.id] > 0 ? p[tr.id] : null;
  }

  _emit(tr) {
    const r = tr.result || {};
    this.ends++;
    this.game.bus.emit('trial:end', { idx: tr.idx, id: tr.id, diff: tr.diff, ch: tr.ch, time: r.time, failed: tr.failed, medal: r.medal || null, delta: r.delta, isNew: !!r.isNew, untouched: !!r.untouched, best: r.best || null, attempt: tr.attempt });
  }

  /** The section is done: the time, the medal against par, the delta vs the trial best (kept only when faster), the card. */
  complete() {
    const g = this.game;
    const tr = g.trial;
    if (!tr || tr.done) return false;
    tr.done = true;
    const time = tr.armed ? Math.max(0.01, tr.t) : Math.max(0.01, g.time);
    const prev = loadTrials(tr.ch, tr.diff, this.storage)[tr.id];
    const res = trialResult({ time, par: this._par(tr), prevBest: prev ? prev.best : null, untouched: tr.untouched });
    const kept = g._godMode ? null : saveTrialBest(tr.ch, tr.diff, tr.id, time, tr.untouched, this.storage);
    res.best = kept && kept.best ? kept.best : res.isNew ? time : prev ? prev.best : null;
    res.everUntouched = kept ? kept.untouched : !!(prev && prev.untouched);
    tr.t = time;
    tr.result = res;
    // freeze on the card: the 'dead' state without a death (every rise-again input re-runs the trial)
    g.deathT = 1e6;
    g.deathLead = 0;
    g.deathCause = null;
    g._deathShown = true;
    g.restore = null;
    if (typeof g._setState === 'function') g._setState('dead');
    else g.state = 'dead';
    if (g.ui && typeof g.ui.show === 'function') {
      try {
        if (g.ui.hideHint) g.ui.hideHint();
        g.ui.show('death', { trial: true });
      } catch (err) {
        if (g._fault) g._fault('ui', err);
      }
    }
    this._emit(tr);
    return true;
  }

  /** The attempt ended in a death: no time, nothing kept; the death scene plays, then the trial card (the death panel's place). */
  died(cause) {
    const tr = this.game.trial;
    if (!tr || tr.done) return;
    tr.done = true;
    tr.failed = true;
    tr.cause = cause || 'impact';
    const prev = loadTrials(tr.ch, tr.diff, this.storage)[tr.id];
    tr.result = { time: null, par: this._par(tr), medal: null, delta: null, deltaText: null, isNew: false, untouched: false, best: prev ? prev.best : null, at: tr.armed ? tr.t : 0 };
    this._emit(tr);
  }

  dispose() {
    if (this._off) this._off();
    this._off = null;
  }
}
