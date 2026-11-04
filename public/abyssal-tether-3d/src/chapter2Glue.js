/* ABYSSAL TETHER 3D — chapter2Glue.js
 * What game.js needs of CHAPTER II · LAMPHOLD, in one lazily loaded module (game.js `modules.chapter2Glue`; Chapter I never loads it): the director (sim/lampholdDirector.js)
 * built for a run, the views that draw its world (render/lampField.js the town's lamps, render/mereView.js the hook's water and throats, render/usherView.js the Ushers
 * and their torches), and the glue between the director's events and the game (waking lamps become the checkpoint, the chapter card, the arena's death, the end).
 *
 *   const c2 = new Chapter2Glue(game)
 *   c2.build(level, objectives, bus, diff, attract)   once per _buildWorld (a run's objects): the director (not in the attract flight) and the views (once per level)
 *   c2.step(dt, player)                               in the fixed step, after Physics3D / Objectives3D
 *   c2.update(dt)                                     once per frame, in _updateViews
 *   c2.onStart() / c2.onRespawn()                     a new run / a respawn at the checkpoint
 *   c2.dispose()
 * The views live on `game._c2views` keyed by the level object, so a restart does not rebuild them.
 */
import { LampholdDirector } from './sim/lampholdDirector.js';
import { LampField } from './render/lampField.js';
import { MereView } from './render/mereView.js';
import { UsherView } from './render/usherView.js';
import { CHAPTER2_TEXT } from './data/chapter2-text.js';
import { CHAPTER2_BEATS, CHAPTER2_DEPTH } from './data/chapter2-data.js';
import { CommsDirector, DIRECTOR_EVENTS, commsLine } from './sim/comms3d.js';

const MAX_STATES = 8;

/** Chapter II's radio (the story writer's six lines, data/chapter2-text.js radio) on the shipped radio director: where each is said (section = the beat's index). */
export function radioScript() {
  const R = Object.fromEntries(CHAPTER2_TEXT.radio.map((r) => [r.id, r]));
  const L = (id, section, when, o) => commsLine(id, R[id].speaker, R[id].text, Object.assign({ section, when }, o));
  // the section of a line is the index of its beat in the chapter (the beat table's order is the level's section order)
  const at = (id) => Math.max(0, CHAPTER2_BEATS.findIndex((b) => b.id === R[id].beat));
  return [
    L('c2-open', at('c2-open'), { enter: true, after: 2.5 }, { prio: 3, glitch: 'none', beat: 'the lamps carry the signal' }),
    L('c2-bell', at('c2-bell'), { ev: 'c2:answer', match: { stage: 2 } }, { prio: 3, beat: 'it answered' }),
    L('c2-rule', at('c2-rule'), { chain: 'c2-bell', gap: 1.0 }, { prio: 3 }),
    L('c2-bars', at('c2-bars'), { enter: true, after: 3 }, { prio: 2, beat: 'the bars drop' }),
    L('c2-orderly', at('c2-orderly'), { ev: 'c2:phase', match: { phase: 'A' } }, { prio: 3 }),
  ];
}

export class Chapter2Glue {
  constructor(game) {
    this.game = game;
    this.level = null;
    this.director = null;
    this._offs = [];
    this._states = Array.from({ length: MAX_STATES }, () => ({ id: '', head: false, x: 0, y: 0, z: 0, yaw: 0, clip: 'Idle', t: 0, stretch: 1, ring: null, sphere: { x: 0, y: 0, z: 0, r: 0, stage: 'listen' }, _sph: false, visible: false }));
    this._list = [];
    this._hasSphere = false;
    this._buzzT = 0;
    this.stats = { buzz: 0 };
  }

  build(level, objectives, bus, diff, attract) {
    const g = this.game;
    this.level = level;
    this._ensureViews(level);
    if (attract) return;
    this.director = new LampholdDirector({
      level,
      objectives,
      bus,
      diff,
      text: CHAPTER2_TEXT,
      kill: (cause) => {
        if (g.physics && g.player && g.player.alive) g.physics.kill(g.player, g.tethers, cause === 'usher' ? 'usher' : cause, 0);
      },
      victory: () => {
        if (g.state === 'playing' && g.victoryT < 0) g._beginVictory();
      },
    });
    const on = (type, fn) => {
      const off = g.bus.on(type, fn);
      this._offs.push(off);
    };
    this._radio(on);
    const v = g._c2views;
    on('lamp:snuff', (e) => this._onSnuff(e));
    on('lamp:all', () => v && v.lamp && v.lamp.snuffAll());
    on('c2:lamp', (e) => this._onLamp(e));
    on('hook:card', () => this._onCard());
    on('c2:name', (e) => {
      if (e && g._toast) g._toast(`${e.text} · ${e.count} of ${e.of} found`, 4);
      if (g._hapticBoth) g._hapticBoth(0.25, 160);
    });
    on('hook:arrive', () => g._hapticBoth && g._hapticBoth(0.35, 240));
    on('usher:whip', (e) => {
      if (e && e.lethal !== false) g._hapticBoth && g._hapticBoth(0.5, 120);
    });
    on('c2:crash', () => g._hapticBoth && g._hapticBoth(0.4, 140));
    on('evening:stroke', () => g._hapticBoth && g._hapticBoth(0.3, 220));
  }

  /** The chapter's own radio director replaces Chapter I's as `game.comms` for the run (Chapter I's stays inert and is put back on dispose). */
  _radio(on) {
    const g = this.game;
    if (!g.comms) return; // comms off (?comms=off): nothing to replace
    try {
      const cm1 = g._comms1 || g.comms;
      const cm = new CommsDirector({ seed: 0x7a31, script: radioScript() });
      cm.onStart = (tx) => g.bus.emit('comms:line', tx);
      cm.onEnd = (tx) => g.bus.emit('comms:end', tx);
      cm.voice = cm1.voice;
      for (const type of [...DIRECTOR_EVENTS, 'c2:answer', 'c2:phase']) on(type, (p) => g._try('comms', () => cm.onEvent(type, p)));
      g._comms1 = cm1;
      g.comms = cm;
    } catch (err) {
      g._fault('comms2', err);
    }
  }

  _ensureViews(level) {
    const g = this.game;
    const r = g.renderer;
    if (!r || !r.scene) return;
    if (g._c2views && g._c2views.level === level) return;
    this._disposeViews();
    const c2 = (level.data && level.data.c2) || {};
    const Q = c2.snuffing || { stalls: [], clusters: [] };
    const views = { level, lamp: null, mere: null, usher: null };
    try {
      views.lamp = new LampField(r.scene);
      // the wall lamps: 2,600 over layout 1's 1,250 m, the same density over the chapter's depth
      views.lamp.build({ shaft: 26, yTop: 0, yBottom: -CHAPTER2_DEPTH, count: Math.round((2600 * CHAPTER2_DEPTH) / 1250), stalls: Q.stalls || [], clusters: Q.clusters || [] });
      views.lamp.onPuff = (x, y, z) => {
        if (r.fx && typeof r.fx.burst === 'function') r.fx.burst('puff', x, y, z, { color: 0x1a1612 });
      };
    } catch (err) {
      g._fault('lampField', err);
    }
    try {
      if (c2.hook) {
        views.mere = new MereView(r.scene);
        views.mere.build(c2.hook);
      }
    } catch (err) {
      g._fault('mereView', err);
    }
    try {
      views.usher = new UsherView(r);
      views.usher.load().then((ok) => {
        if (ok && typeof g._precompile === 'function') g._precompile();
      });
    } catch (err) {
      g._fault('usherView', err);
    }
    g._c2views = views;
  }

  _disposeViews() {
    const g = this.game;
    const v = g._c2views;
    if (!v) return;
    for (const k of ['lamp', 'mere', 'usher']) {
      try {
        if (v[k] && typeof v[k].dispose === 'function') v[k].dispose();
      } catch {
        /* already gone */
      }
    }
    g._c2views = null;
  }

  // ---- events -----------------------------------------------------------------------------------------------------------------
  _onSnuff(e) {
    const v = this.game._c2views;
    const Q = this.director && this.director.Q;
    if (!v || !v.lamp || !Q || !e) return;
    if (e.kind === 'round') {
      let best = -1;
      let bd = 5;
      Q.clusters.forEach((c, i) => {
        const d = Math.hypot(c.x - e.x, c.y - e.y, c.z - e.z);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      if (best >= 0) v.lamp.snuffCluster(best);
    } else {
      Q.stalls.forEach((s, i) => {
        if (Math.hypot(s.x - e.x, s.y - e.y, s.z - e.z) <= (e.r || 3) + 3) v.lamp.snuffStall(i);
      });
    }
  }

  /** A waking lamp of the arena (L2-17, L2-18, L2-19): it is the checkpoint now. */
  _onLamp(e) {
    const g = this.game;
    if (!e || g.state !== 'playing') return;
    const idx = g.level.sectionIndexAt(e.y);
    g.checkpoint = { x: e.x, y: e.y, z: e.z, yaw: e.yaw || 0, index: idx };
    g.bus.emit('checkpoint', { index: idx, x: e.x, y: e.y, z: e.z });
    if (g._toast) g._toast(`Lamp ${e.id} · ${e.label}`, 2.4);
  }

  /** The chapter card of the hook: III · THE MERE, and its one line. */
  _onCard() {
    const g = this.game;
    const c = CHAPTER2_TEXT.hook.chapterCard;
    if (g.ui && typeof g.ui.showSectionTitle === 'function') g.ui.showSectionTitle(c.title, c.line.replace('\n', ' '), -1, '', c.numeral);
  }

  // ---- per step / frame ------------------------------------------------------------------------------------------------------------
  step(dt, p) {
    if (this.director) this.director.step(dt, p);
  }

  onStart() {
    const v = this.game._c2views;
    if (v && v.lamp) v.lamp.relight();
    if (this.director) this.director.reset(null);
  }

  onRespawn() {
    const g = this.game;
    const v = g._c2views;
    if (v && v.lamp) v.lamp.relight();
    if (this.director) this.director.reset(this.director.lampFor(g.checkpoint));
  }

  update(dt) {
    const g = this.game;
    const v = g._c2views;
    const d = this.director;
    if (!v || v.level !== this.level) return;
    const p = g.player;
    // the Evening's front: from the Winding Floor on, the lamps far above you are out (the town is being put to bed from the top)
    let snuffY = 1e9;
    const si = g.sectionIndex;
    // the Evening creeps down from the top once the bell has been answered (the Tolling Gallery on), close behind you in the exam and the Throat
    const ids = this._beatIds || (this._beatIds = CHAPTER2_BEATS.map((b) => b.id));
    const tolled = ids.indexOf('c2-9');
    const exam = ids.indexOf('c2-12');
    if (p && tolled >= 0 && si >= tolled) snuffY = p.y + (exam >= 0 && si >= exam ? 40 : 90);
    if (d && d.evening) snuffY = -1e9;
    if (v.lamp) v.lamp.update(dt, { snuffY, time: g.time });
    if (v.mere && d) v.mere.update(dt, d.hook, d.chainY());
    if (v.usher && d) {
      const list = this._list;
      list.length = 0;
      let n = 0;
      for (const e of d.ushers) {
        if (n >= MAX_STATES) break;
        const u = e.usher;
        const st = this._states[n++];
        st.id = e.id;
        st.head = e.head;
        st.collar = e.head; // the sim's position of the Head Usher is his collar, 2.9 m over his feet
        if (u.state === 'OFF') {
          st.visible = false;
          st.sphere = null;
          st.x = st.y = st.z = 0;
        } else {
          const pos = u.pos;
          const an = u.anim;
          st.x = pos.x;
          st.y = pos.y;
          st.z = pos.z;
          st.yaw = u.yaw || 0;
          st.clip = an.clip;
          st.t = an.t;
          st.stretch = u.stretch || 1;
          st.visible = true;
          const sp = u.sphere;
          if (sp) {
            const o = st._sphereObj || (st._sphereObj = { x: 0, y: 0, z: 0, r: 0, stage: 'listen' });
            o.x = sp.x;
            o.y = sp.y;
            o.z = sp.z;
            o.r = sp.r;
            o.stage = sp.stage;
            st.sphere = o;
          } else st.sphere = null;
        }
        list.push(st);
      }
      v.usher.setStates(list);
      v.usher.update(dt, g.renderer && g.renderer.camera);
    }
    if (d) this._buzz(dt);
  }

  /**
   * THE ROPE TELEGRAPH (CHAPTER_II_DIRECTION 3.4): the hand whose rope is anchored in or near an Usher's torch sphere buzzes, from LISTEN on and rising through COIL: the player always has the
   * sphere, the hum and the hand. 10 Hz, only while a rope is out.
   */
  _buzz(dt) {
    const g = this.game;
    this._buzzT -= dt;
    if (this._buzzT > 0 || !g.tethers || g.state !== 'playing') return;
    this._buzzT = 0.1;
    for (const hand of ['left', 'right']) {
      const rope = g.tethers.hands[hand] && g.tethers.hands[hand].rope;
      if (!rope || !rope.attached || !rope.anchor) continue;
      const a = rope.anchor;
      let k = 0;
      for (const e of this.director.ushers) if (e.usher.state !== 'OFF') k = Math.max(k, e.usher.telegraph(a.x, a.y, a.z));
      if (k > 0.05) {
        this.stats.buzz++;
        if (g._haptic) g._haptic(hand, 0.15 + 0.7 * k, 90);
      }
    }
  }

  dispose() {
    const g = this.game;
    if (g._comms1) {
      g.comms = g._comms1;
      g._comms1 = null;
    }
    for (const off of this._offs.splice(0)) {
      try {
        off();
      } catch {
        /* ignore */
      }
    }
    if (this.director) {
      this.director.destroy();
      this.director = null;
    }
  }
}
