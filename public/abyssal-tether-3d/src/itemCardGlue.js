/* THE LANTERN (ABYSSAL TETHER 3D) — itemCardGlue.js
 * ITEM CARDS (docs/abyssal-tether-3d/plans/ITEM_CARDS.md): what game.js needs to stand a name card over the collectible the player looks
 * at, in one module (the puzzleFocusGlue.js pattern). The owner: "if the user starts looking at an object that is down, there must be like
 * some sort of name ... a text that says bandage in a unique card."
 *
 *   const ic = new ItemCardGlue(game)   once (Game._setupItemCards): `game.itemCards`
 *   ic.update(dt)                       once a frame (Game._updateViews), any state: it hides itself outside a run
 *
 * Per frame: the candidates (the run's supplies, sim/pickups3d.js `items` not taken, and the jetpack's fuel cans, sim/jetpack3d.js `cans`)
 * are copied into a fixed pool; the eye and the view forward come from the renderer's rig + camera (the headset pose in XR: nothing here
 * ever writes the camera); sim/itemGaze.js picks the item (cone, range, hysteresis, dwell, grace, the level's raycast for line of sight);
 * data/itemCards.js says what the card reads (the hint follows the platform: VR / desktop / touch, and says so when the bag is full);
 * render/itemCardView.js draws it (one mesh, built on first use). Nothing while dead, in a menu, applying an item, in the opening film,
 * the death scene or the victory. Setting `itemCards` (default on, Settings › Access); `?itemcards=off` overrides it.
 * No allocation per frame (the pool, the context and the eye are reused; the card's canvas is redrawn on a content change only).
 */
import { ItemGaze, levelOccluder } from './sim/itemGaze.js';
import { cardFor, cardHint, FUEL_CARD } from './data/itemCards.js';
import { ItemCardView } from './render/itemCardView.js';

const POOL = 96;
const PLATFORMS = ['desktop', 'vr', 'touch'];

/** `?itemcards=off` (also 0 / false / no) turns the cards off whatever the setting says. */
export function itemCardsUrlOff(search) {
  return /[?&]itemcards=(off|0|false|no)\b/i.test(String(search || ''));
}

/** On? The setting (anything but false is on) and the URL switch. */
export function itemCardsOn(setting, urlOff) {
  return setting !== false && !urlOff;
}

export class ItemCardGlue {
  constructor(game) {
    this.game = game;
    this.gaze = new ItemGaze();
    this.pool = [];
    for (let i = 0; i < POOL; i++) this.pool.push({ x: 0, y: 0, z: 0, kind: -1, id: null });
    this.count = 0;
    this.view = null;
    this.enabled = true;
    this._ctx = { ex: 0, ey: 0, ez: 0, fx: 0, fy: 0, fz: -1, busy: true };
    this._eye = { x: 0, y: 0, z: 0 };
    this._occ = levelOccluder(() => this.game && this.game.level);
    this._key = -1;
    this._name = '';
    this._hint = '';
    this._cardObj = null;
    this._urlOff = false;
    try {
      this._urlOff = typeof location !== 'undefined' && itemCardsUrlOff(location.search);
    } catch {
      this._urlOff = false;
    }
    const bus = game && game.bus;
    if (bus && typeof bus.on === 'function') {
      const fresh = () => this.gaze.reset();
      bus.on('game:start', fresh);
      bus.on('game:restart', fresh);
      bus.on('game:menu', fresh);
      bus.on('player:death', fresh);
    }
  }

  /** Nothing to show now? (dead / not playing / a cinematic / applying an item) */
  _busy() {
    const g = this.game;
    const p = g.player;
    if (!p || p.alive === false || g.state !== 'playing' || g.victoryT >= 0) return true;
    if (g.opening || (g.deathScene && g.deathScene.active)) return true;
    const bag = g.bag;
    return !!(bag && bag.applying && bag.applying.active);
  }

  /** The eye and the view forward: the rig + the camera's local pose turned by the rig's yaw (no stale matrixWorld). */
  _readEye(c) {
    const g = this.game;
    const r = g.renderer;
    if (!r || !r.rig || !r.camera) return false;
    const rp = r.rig.position;
    const cp = r.camera.position;
    const yaw = r.rig.rotation.y;
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    c.ex = rp.x + cp.x * cy + cp.z * sy;
    c.ey = rp.y + cp.y;
    c.ez = rp.z - cp.x * sy + cp.z * cy;
    const q = r.camera.quaternion;
    // the camera's local forward: q · (0, 0, -1)
    const lx = -2 * (q.x * q.z + q.w * q.y);
    const ly = -2 * (q.y * q.z - q.w * q.x);
    const lz = -(1 - 2 * (q.x * q.x + q.y * q.y));
    c.fx = lx * cy + lz * sy;
    c.fy = ly;
    c.fz = -lx * sy + lz * cy;
    return true;
  }

  _fill() {
    const g = this.game;
    const P = this.pool;
    let n = 0;
    const pk = g.pickups;
    if (pk && pk.items) {
      const it = pk.items;
      for (let i = 0; i < it.length && n < POOL; i++) {
        const s = it[i];
        if (s.taken) continue;
        const o = P[n++];
        o.x = s.x;
        o.y = s.y;
        o.z = s.z;
        o.kind = s.kind;
        o.id = s.id;
      }
    }
    const jet = g.jet;
    if (jet && jet.enabled !== false && jet.cans) {
      const cs = jet.cans;
      for (let i = 0; i < cs.length && n < POOL; i++) {
        const s = cs[i];
        if (s.taken) continue;
        const o = P[n++];
        o.x = s.x;
        o.y = s.y;
        o.z = s.z;
        o.kind = FUEL_CARD;
        o.id = s.id;
      }
    }
    this.count = n;
    return n;
  }

  _platform() {
    const g = this.game;
    if (g.xrActive) return 1;
    const ti = g.input && g.input.touch;
    return ti && ti.active ? 2 : 0;
  }

  _full(kind) {
    const g = this.game;
    if (kind === FUEL_CARD) return !!(g.jet && g.jet.fuel >= 0.999);
    const bag = g.bag;
    return !!(bag && typeof bag.canAdd === 'function' && kind >= 0 && kind < (bag.counts ? bag.counts.length : 0) && !bag.canAdd(kind));
  }

  update(dt) {
    const g = this.game;
    const st = g.settings || {};
    this.enabled = itemCardsOn(st.itemCards, this._urlOff);
    const c = this._ctx;
    const haveEye = this._readEye(c);
    c.busy = !this.enabled || !haveEye || this._busy();
    const n = c.busy ? 0 : this._fill();
    const T = this.gaze.update(dt, c, this.pool, n, this._occ);
    if (T.on) {
      const plat = this._platform();
      const full = this._full(T.kind) ? 1 : 0;
      const key = (T.kind + 1) * 8 + plat * 2 + full;
      if (key !== this._key) {
        this._key = key;
        const card = cardFor(T.kind);
        this._name = card.name;
        this._hint = cardHint(card, PLATFORMS[plat], !!full);
        this._cardObj = card;
      }
    }
    if (!this.view) {
      if (!T.on || !g.renderer || !g.renderer.scene) return;
      this.view = new ItemCardView(g.renderer.scene);
    }
    if (this._cardObj) this.view.setCard(this._cardObj, this._hint, this._key);
    const e = this._eye;
    e.x = c.ex;
    e.y = c.ey;
    e.z = c.ez;
    this.view.update(dt, T, e, !!st.reducedEffects);
  }

  /** window.AT3D.debug.itemCard(): the target, the card's content, the view. */
  debugState() {
    const T = this.gaze.target;
    const v = this.view;
    return {
      enabled: this.enabled,
      urlOff: this._urlOff,
      candidates: this.count,
      target: T.on ? { kind: T.kind, id: T.id, x: T.x, y: T.y, z: T.z, dist: Math.round(T.dist * 100) / 100 } : null,
      pending: this.gaze.pending ? { kind: this.gaze.pending.kind, id: this.gaze.pending.id, t: Math.round(this.gaze.pendingT * 100) / 100 } : null,
      name: T.on ? this._name : null,
      hint: T.on ? this._hint : null,
      view: v ? { visible: v.stats.visible, alpha: Math.round(v.stats.alpha * 100) / 100, width: Math.round(v.stats.width * 1000) / 1000, redraws: v.stats.redraws, key: v.stats.key } : null,
      stats: Object.assign({}, this.gaze.stats),
    };
  }

  dispose() {
    if (this.view) this.view.dispose();
    this.view = null;
  }
}
