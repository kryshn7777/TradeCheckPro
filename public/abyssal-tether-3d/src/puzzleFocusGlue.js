/* THE LANTERN (ABYSSAL TETHER 3D) — puzzleFocusGlue.js
 * PUZZLE FOCUS (docs/abyssal-tether-3d/plans/PUZZLE_FOCUS.md): what game.js needs to guide attention to a puzzle, in one module.
 * The owner: "during every puzzle I need the camera to be focused there with a dialogue from player or from mic, suggesting the
 * player to check it out."
 *
 *   const pf = new PuzzleFocusGlue(game)   once (game.js constructor): `game.puzzleFocus`; `game.focusBeat` is its FocusBeat
 *   pf.update(dt)                          once a frame (game.js _updateViews), any state: it stops itself outside a run
 *
 * Per frame: the trigger logic (sim/puzzleFocus.js) says when a puzzle gets a beat and which line; the line goes to the radio director
 * (`game.comms.focus(line)`, sim/comms3d.js: one transmission at a time, never in danger); the beat (sim/focusBeat.js) turns the
 * DESKTOP / touch view toward the fixture (eased, cancelled by any look input, only when safe) through Game._setLook. In a HEADSET the
 * view is never turned and the rig never moves: the gaze guide instead: a soft pulsing glow on the fixture (render/objectiveHintView.js,
 * the 20 s hint's look), the bus event `focus:look` { x, y, z, t } for the lantern's lean (render owners read it, or
 * `game.focusBeat.lookTarget`), and `focus:ping` { x, y, z } (audio/focusPing.js: a spatial tick-tick at the fixture). The subtitle
 * panel is the radio's own (head-locked). Settings › Rope › Puzzle focus: 'auto' (default) | 'cues' (never turns the view) | 'off';
 * `?focus=off|cues` overrides it; Reduced effects behaves as 'cues'.
 * No allocation per frame (the trigger's object, the beat and the glow's target are reused).
 */
import { FocusBeat, HOLD_T, RELEASE } from './sim/focusBeat.js';
import { PuzzleFocus, focusUrlMode, focusMode } from './sim/puzzleFocus.js';
import { PUZZLE_FOCUS_LINES } from './data/puzzle-focus-text.js';
import { commsLine, holdTime, FOCUS_PRIO } from './sim/comms3d.js';
import { ObjectiveHintView } from './render/objectiveHintView.js';
import { registerFocusPing } from './audio/focusPing.js';

/** A fall faster than this (m/s down) is no time to turn the view. */
const FALL_VY = -8;
/** Swinging faster than this (m/s) on a rope: no pan. */
const SWING_SPEED = 7;
const LOG_MAX = 16;

export class PuzzleFocusGlue {
  constructor(game) {
    this.game = game;
    this.trigger = new PuzzleFocus({ seed: 0x5a17 });
    this.beat = new FocusBeat();
    this.lines = new Map();
    for (const v of PUZZLE_FOCUS_LINES) this.lines.set(v.id, commsLine(v.id, v.speaker, v.text, { when: { focus: v.type, step: v.step }, prio: FOCUS_PRIO, ttl: 7, beat: 'puzzle focus' }));
    this._O = null;
    this._level = null;
    this._run = 0;
    this._view = null;
    this._hint = { on: false, count: 0, targets: [{ x: 0, y: 0, z: 0, kind: '', on: false }] };
    this._ctx = { playing: false, busy: false, section: 0, ex: 0, ey: 0, ez: 0, signal: 1, hintOn: false, names: null };
    this._inp = { yaw: 0, pitch: 0, ex: 0, ey: 0, ez: 0, tx: 0, ty: 0, tz: 0, safe: false, xr: false };
    this._startO = { yaw: 0, pitch: 0, ex: 0, ey: 0, ez: 0, pan: false, xr: false, hold: HOLD_T, why: '' };
    this._look = { x: 0, y: 0, z: 0, t: 0, id: '', type: '', step: '' };
    this._ping = { x: 0, y: 0, z: 0, key: 0 };
    this._puzzle = null; // the puzzle of the beat running
    this._pinged = false;
    this.mode = 'auto';
    this.log = [];
    this.stats = { beats: 0, panned: 0, lines: 0, cancelled: 0 };
    this._sfx = false;
    this._url = '';
    try {
      this._url = typeof location !== 'undefined' ? focusUrlMode(location.search) : '';
    } catch {
      this._url = '';
    }
    const bus = game && game.bus;
    if (bus && typeof bus.on === 'function') {
      const fresh = () => {
        this._run++;
        this.trigger.reset(this._run);
        this._stop();
      };
      bus.on('game:start', fresh);
      bus.on('game:restart', fresh);
      bus.on('game:menu', () => this._stop());
      bus.on('player:death', () => this._stop()); // a death keeps the ratchet (no reset): the beat just ends
    }
  }

  _stop() {
    this.beat.stop();
    this._puzzle = null;
    this._hint.on = false;
  }

  /** The look the desktop has now: the rig's yaw and the camera's pitch. */
  _readLook(out) {
    const r = this.game.renderer;
    out.yaw = r && r.rig ? r.rig.rotation.y : 0;
    out.pitch = r && r.camera && !this.game.xrActive ? r.camera.rotation.x : 0;
  }

  /** The eye: the rig (placed this frame by _updateRig) + the camera's local offset turned by the rig's yaw (no stale matrixWorld). */
  _readEye(out) {
    const g = this.game;
    const r = g.renderer;
    if (r && r.rig && r.camera) {
      const rp = r.rig.position;
      const cp = r.camera.position;
      const yaw = r.rig.rotation.y;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      out.ex = rp.x + cp.x * c + cp.z * s;
      out.ey = rp.y + cp.y;
      out.ez = rp.z - cp.x * s + cp.z * c;
    } else if (g.player) {
      out.ex = g.player.rx;
      out.ey = g.player.ry + 1.24;
      out.ez = g.player.rz;
    }
  }

  /** Safe to turn the view now? (and, for the trigger: playing at all) */
  _safe() {
    const g = this.game;
    const p = g.player;
    if (!p || !p.alive || g.state !== 'playing' || g.victoryT >= 0) return false;
    if (g.catchMoment && g.catchMoment.active) return false;
    if (p.vy < FALL_VY && !p.grounded) return false;
    if (g.tethers && g.tethers.attached && p.speed > SWING_SPEED) return false;
    const cl = g.physics && g.physics.climb;
    if (cl && (cl.mantling || cl.hopLock > 0)) return false;
    return !this._danger();
  }

  /** A creature winding up / bursting / measuring (the same test as the radio's), an Usher coiling or whipping. */
  _danger() {
    const g = this.game;
    const c = g.creature;
    if (c && ((c.attack && c.attack.phase) || c.state === 'BURST' || c.state === 'ATTACK')) return true;
    const dr = g.dresser;
    if (dr && !dr.isNull && dr.measuring) return true;
    const s = g.skitters;
    if (s && s.slots) for (let i = 0; i < s.slots.length; i++) if (s.slots[i].on && s.slots[i].attack && s.slots[i].attack.phase) return true;
    const d2 = g.c2 && g.c2.director;
    if (d2 && d2.ushers) {
      for (let i = 0; i < d2.ushers.length; i++) {
        const st = d2.ushers[i].usher && d2.ushers[i].usher.state;
        if (st === 'COIL' || st === 'WHIP') return true;
      }
    }
    return false;
  }

  update(dt) {
    const g = this.game;
    const st = g.settings || {};
    this.mode = focusMode(st.puzzleFocus, this._url, !!st.reducedEffects);
    const playing = g.state === 'playing' && !!g.player && g.player.alive && g.victoryT < 0;
    if (this.mode === 'off' || !g.objectives || !g.level) {
      if (this.beat.active) this._stop();
      this._drawGlow(dt);
      return;
    }
    if (g.objectives !== this._O || g.level !== this._level) {
      this._O = g.objectives;
      this._level = g.level;
      this.trigger.build(g.objectives, g.level, { chapter: g.c2 ? 2 : 1 });
      this.trigger.reset(this._run);
      this._stop();
    }
    if (!this._sfx && g.audio) this._sfx = registerFocusPing(g.audio) || g.audio.registerSfx === undefined;
    if (!playing && this.beat.active) this._stop();
    const xr = !!g.xrActive;
    const cm = g.comms;
    const safe = playing && this._safe();
    // ---- the trigger ----
    const x = this._ctx;
    x.playing = playing;
    x.busy = this.beat.active || !safe || !!(cm && cm.current && cm.current.prio >= 3);
    x.section = g.sectionIndex | 0;
    this._readEye(x);
    x.signal = cm && typeof cm.signal === 'number' ? cm.signal : 1;
    x.hintOn = !!(g.objectiveHint && g.objectiveHint.on);
    x.names = g.c2 && g.c2.director ? g.c2.director.names : null;
    const trig = this.trigger.update(dt, x);
    if (trig) this._begin(trig, cm, xr, safe);
    // ---- the beat ----
    if (this.beat.active) {
      const inp = this._inp;
      this._readLook(inp);
      inp.ex = x.ex;
      inp.ey = x.ey;
      inp.ez = x.ez;
      const pz = this._puzzle;
      if (pz && this.trigger.aim(pz, x.ex, x.ey, x.ez)) {
        inp.tx = pz.x;
        inp.ty = pz.y;
        inp.tz = pz.z;
      } else inp.tx = inp.ty = inp.tz = NaN;
      inp.safe = safe;
      inp.xr = xr;
      const was = this.beat.pan;
      this.beat.update(dt, inp);
      if (was && !this.beat.pan && this.beat.cancelled) this.stats.cancelled++;
      if ((this.beat.dYaw !== 0 || this.beat.dPitch !== 0) && !xr && typeof g._setLook === 'function') g._setLook(inp.yaw + this.beat.dYaw, inp.pitch + this.beat.dPitch);
      if (!this.beat.active) this._puzzle = null;
    }
    this._drawGlow(dt);
  }

  _begin(trig, cm, xr, safe) {
    const g = this.game;
    const line = trig.line ? this.lines.get(trig.line.id) : null;
    const said = !!(line && cm && typeof cm.focus === 'function' && cm.focus(line));
    const o = this._startO;
    this._readLook(o);
    o.ex = this._ctx.ex;
    o.ey = this._ctx.ey;
    o.ez = this._ctx.ez;
    o.xr = xr;
    o.pan = this.mode === 'auto' && !xr && safe && trig.glance;
    o.why = this.mode !== 'auto' ? 'mode' : trig.occluded ? 'occluded' : !trig.glance ? 'ratchet' : !safe ? 'unsafe' : '';
    o.hold = line ? holdTime(line.text) : HOLD_T;
    const panned = this.beat.start(trig.x, trig.y, trig.z, o);
    if (panned) this.trigger.noteGlance(trig.puzzle);
    this._puzzle = trig.puzzle;
    this.stats.beats++;
    if (panned) this.stats.panned++;
    if (said) this.stats.lines++;
    const L = this._look;
    L.x = trig.x;
    L.y = trig.y;
    L.z = trig.z;
    L.t = o.hold + 0.8;
    L.id = trig.puzzle.id;
    L.type = trig.puzzle.type;
    L.step = trig.step;
    const P = this._ping;
    P.x = trig.x;
    P.y = trig.y;
    P.z = trig.z;
    P.key = (trig.puzzle.section + 1) * 131 + trig.puzzle.type.length;
    if (g.bus) {
      g.bus.emit('focus:look', L);
      g.bus.emit('focus:ping', P);
    }
    if (this.log.length >= LOG_MAX) this.log.shift();
    this.log.push({ id: trig.puzzle.id, type: trig.puzzle.type, step: trig.step, line: line ? line.id : null, said, panned, why: this.beat.skipped, t: Math.round(this.trigger.clock * 100) / 100 });
  }

  /** The gaze guide's glow (all platforms): the 20 s hint's quad, one target, while the beat runs. */
  _drawGlow(dt) {
    const g = this.game;
    const h = this._hint;
    const b = this.beat;
    h.on = b.active && b.state !== RELEASE && b.lookTarget.on;
    h.count = h.on ? 1 : 0;
    const t = h.targets[0];
    t.on = h.on;
    t.x = b.lookTarget.x;
    t.y = b.lookTarget.y;
    t.z = b.lookTarget.z;
    if (!this._view) {
      if (!h.on || !g.renderer || !g.renderer.scene) return;
      try {
        this._view = new ObjectiveHintView(g.renderer.scene);
        this._view.mesh.name = 'focusGlow';
      } catch {
        this._view = null;
        return;
      }
    }
    this._view.update(dt, h, !!(g.settings && g.settings.reducedEffects));
  }

  /** window.AT3D.debug.focus.state(): the beat, the mode, the last beats. */
  debugState() {
    const b = this.beat;
    return {
      mode: this.mode,
      state: b.stateName,
      pan: b.pan,
      cancelled: b.cancelled,
      skipped: b.skipped,
      glow: Math.round(b.glow * 100) / 100,
      target: b.lookTarget.on ? { x: b.lookTarget.x, y: b.lookTarget.y, z: b.lookTarget.z } : null,
      puzzle: this._puzzle ? this._puzzle.id : null,
      stats: Object.assign({}, this.stats),
      log: this.log.slice(),
    };
  }

  /** window.AT3D.debug.focus.puzzles(): the puzzles of the run and their ratchet. */
  debugPuzzles() {
    return this.trigger.puzzles.map((p) => ({ id: p.id, type: p.type, section: p.section, firstAt: p.firstAt, nudged: p.nudged, hinted: p.hinted, glancedAt: p.glancedAt }));
  }

  /** window.AT3D.debug.focus.ready(): clears the cooldown (tests: the next frame may fire). */
  debugReady() {
    this.trigger.lastBeat = -1e9;
    return true;
  }
}
