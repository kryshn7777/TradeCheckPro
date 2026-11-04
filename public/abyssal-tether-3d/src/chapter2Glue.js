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

const MAX_STATES = 8;

export class Chapter2Glue {
  constructor(game) {
    this.game = game;
    this.level = null;
    this.director = null;
    this._offs = [];
    this._states = Array.from({ length: MAX_STATES }, () => ({ id: '', head: false, x: 0, y: 0, z: 0, yaw: 0, clip: 'Idle', t: 0, stretch: 1, ring: null, sphere: { x: 0, y: 0, z: 0, r: 0, stage: 'listen' }, _sph: false, visible: false }));
    this._list = [];
    this._hasSphere = false;
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
      views.lamp.build({ shaft: 26, yTop: 0, yBottom: -1250, count: 2600, stalls: Q.stalls || [], clusters: Q.clusters || [] });
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
    if (p && si >= 9) snuffY = p.y + (si >= 11 ? 40 : 90);
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
  }

  dispose() {
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
