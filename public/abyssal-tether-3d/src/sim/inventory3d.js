/* ABYSSAL TETHER 3D — inventory3d.js
 * The player's bag: four consumables, the channelled "apply" action, the adrenaline speed boost and the lantern
 * charge. Pure and deterministic: no three.js, no DOM, no Math.random, no clock other than the dt it is stepped
 * with, no allocation after construction (the same module runs in Node for the tests).
 *
 *   slot  item        cap  apply   effect
 *   0     FIRST_AID    1   5.0 s   +100 hp (full)
 *   1     BANDAGE      5   1.5 s   +20 hp
 *   2     ADRENALINE   2   0.6 s   +10 hp and the movement speed x2 for 10 s (run / air speed caps, accelerations,
 *                                  reel and pump speed; gravity and fall damage are unchanged)
 *   3     BATTERY      3   1.0 s   +50 % lantern charge
 *   4     KNOCKER      3   thrown  not applied: a clockwork rattle thrown with G / pulled from the bag and thrown in VR
 *                                  (sim/knocker3d.js). It is not a numbered slot (ITEM_COUNT stays 4: keys 1-4, the
 *                                  radial, the icon cells); take() removes one when it is thrown. A respawn KEEPS the
 *                                  knocker count (like the jetpack's fuel: a knocker thrown is gone), a new run resets it.
 *   5     GRENADE      3   thrown  SOLDIER_WEAPONS.md: a fused iron grenade off a dead soldier (sim/weapons3d.js), thrown like the
 *                                  knocker. Not applied; a respawn keeps the count (a thrown one is gone).
 *   6     SIDEARM     12   fired   the old service revolver: the count is its ROUNDS (found with 6). Fired, not applied; kept
 *                                  through a respawn like the grenades.
 * Old count arrays (5 kinds, before the weapons) migrate: migrateCounts pads them with zeros (importCounts / restore).
 *
 * Applying is a channel. It starts with use() and completes after `dur` seconds, when the item is consumed and its
 * effect lands. It is CANCELLED, and the item is kept, when the player takes damage (health.hits changes), dies, the
 * run stops being live, or cancel() is called (X on the desktop / VR). It may be done while running or swinging; it
 * does not need both hands free (keeping it simple and fair). Only one channel at a time. Heals are refused at full
 * health, a battery at a full lantern, an adrenaline shot while one is still working (nothing is wasted).
 *
 * Lantern charge 0..1 drains CONFIG.bag.lanternDrain per second while the run is live. The lantern never goes dark:
 * lanternLevel(charge) maps the charge to a light factor 1 .. lanternFloor (0.25), starting to fall below lanternDimFrom.
 *
 * Checkpoints: the Game takes snapshot() when a new checkpoint is reached and restore() on a respawn (counts,
 * selection and charge return to the checkpoint's; effects and a channel in progress do not survive); reset() on a
 * new run.
 *
 * Bus events: 'bag:change' {kind,count}, 'bag:apply' {kind,dur}, 'bag:cancel' {kind,reason}, 'bag:done' {kind},
 * 'bag:refuse' {kind,reason}, 'bag:effect' {kind,on}, 'lantern:low' {charge}, 'lantern:empty' {}.
 * Read-only for presentation: counts, selected, applying {active,kind,t,dur}, adrenaline {active,t,dur},
 * speedMul, lanternCharge, lanternFactor, lanternLow.
 */

import { CONFIG, U } from './config3d.js';

const B = CONFIG.bag;

/** Slot order = the number keys 1..4 = the order of the icons. */
export const ITEM = Object.freeze({ FIRST_AID: 0, BANDAGE: 1, ADRENALINE: 2, BATTERY: 3, KNOCKER: 4, GRENADE: 5, SIDEARM: 6 });
/** The four APPLIED consumables (number keys, radial slots, icon cells). */
export const ITEM_COUNT = 4;
/** Every kind the bag counts: the four consumables + the knocker + the soldiers' grenade and revolver rounds. counts.length === BAG_KINDS. */
export const BAG_KINDS = 7;
export const ITEM_KEYS = Object.freeze(['FIRST_AID', 'BANDAGE', 'ADRENALINE', 'BATTERY', 'KNOCKER', 'GRENADE', 'SIDEARM']);
export const ITEM_NAMES = Object.freeze(['First aid kit', 'Bandage', 'Adrenaline shot', 'Lantern battery', 'Knocker', 'Grenade', 'Service revolver']);
export const ITEM_SHORT = Object.freeze(['AID KIT', 'BANDAGE', 'ADRENALINE', 'BATTERY', 'KNOCKER', 'GRENADE', 'REVOLVER']);
/** The kinds a respawn keeps as the death left them (thrown / fired: gone; picked up: kept): the knocker and the weapons. */
const KEPT = [ITEM.KNOCKER, ITEM.GRENADE, ITEM.SIDEARM];

/**
 * A bag count array of any older length (a save or a checkpoint from before the weapons: 5 kinds) as a BAG_KINDS Int8Array: missing
 * kinds are 0, each count is clamped to its cap, garbage is 0. Writes into `out` when given. Pure.
 */
export function migrateCounts(arr, out) {
  const o = out && out.length === BAG_KINDS ? out : new Int8Array(BAG_KINDS);
  for (let i = 0; i < BAG_KINDS; i++) {
    const v = arr && i < arr.length ? Number(arr[i]) : 0;
    const cap = B.caps[i] | 0;
    o[i] = v > 0 && isFinite(v) ? Math.min(cap, v | 0) : 0;
  }
  return o;
}

/** Light factor of the lantern for a charge: 1 above lanternDimFrom, falling smoothly to lanternFloor at zero. */
export function lanternLevel(charge) {
  const c = U.clamp(charge, 0, 1);
  return B.lanternFloor + (1 - B.lanternFloor) * U.smoothstep(0, B.lanternDimFrom, c);
}

export class Inventory3D {
  /** @param {EventBus|null} bus */
  constructor(bus) {
    this.bus = bus || null;
    this.counts = new Int8Array(BAG_KINDS);
    this.selected = ITEM.BANDAGE;
    this.applying = { active: false, kind: -1, t: 0, dur: 0, hits: 0 };
    this.adrenaline = { active: false, t: 0, dur: B.adrenalineTime };
    this.speedMul = 1;
    this.lanternCharge = 1;
    this.lanternFactor = 1;
    this.lanternLow = false;
    this.lanternEmpty = false;
    this.lastRefusal = '';
    this.stats = { picked: new Int16Array(BAG_KINDS), used: new Int16Array(BAG_KINDS), cancelled: 0 };
    this._cp = { counts: new Int8Array(BAG_KINDS), selected: ITEM.BANDAGE, charge: 1 };
    this.reset();
  }

  /** A new run: an empty bag, a full lantern, nothing happening. */
  reset() {
    this.counts.fill(0);
    this.selected = ITEM.BANDAGE;
    this._clearTransient();
    this.lanternCharge = 1;
    this._lantern();
    this.lanternLow = false;
    this.lanternEmpty = false;
    this.stats.picked.fill(0);
    this.stats.used.fill(0);
    this.stats.cancelled = 0;
    this.snapshot();
  }

  _clearTransient() {
    const a = this.applying;
    a.active = false;
    a.kind = -1;
    a.t = 0;
    a.dur = 0;
    const e = this.adrenaline;
    e.active = false;
    e.t = 0;
    this.speedMul = 1;
    this.lastRefusal = '';
  }

  _lantern() {
    this.lanternFactor = lanternLevel(this.lanternCharge);
  }

  _emit(type, payload) {
    if (this.bus) this.bus.emit(type, payload);
  }

  // ---- bag ---------------------------------------------------------------------------------

  /** Room for one more of this item? */
  canAdd(kind) {
    return kind >= 0 && kind < BAG_KINDS && this.counts[kind] < B.caps[kind];
  }

  /** Puts up to n items in the bag (capped). Returns how many went in. */
  add(kind, n = 1) {
    if (!(kind >= 0 && kind < BAG_KINDS)) return 0;
    const room = B.caps[kind] - this.counts[kind];
    const put = Math.max(0, Math.min(room, n | 0));
    if (put > 0) {
      this.counts[kind] += put;
      this.stats.picked[kind] += put;
      this._emit('bag:change', { kind, count: this.counts[kind] });
    }
    return put;
  }

  /** Sets a kind's count outright (capped; the run's starting knockers): no pickup statistics, one 'bag:change'. */
  seed(kind, n) {
    if (!(kind >= 0 && kind < BAG_KINDS)) return 0;
    this.counts[kind] = Math.max(0, Math.min(B.caps[kind], n | 0));
    this._emit('bag:change', { kind, count: this.counts[kind] });
    return this.counts[kind];
  }

  /** Takes one item out without applying it (a thrown knocker). Returns false when there is none. */
  take(kind) {
    if (!(kind >= 0 && kind < BAG_KINDS) || this.counts[kind] <= 0) return false;
    this.counts[kind]--;
    this.stats.used[kind]++;
    this._emit('bag:change', { kind, count: this.counts[kind] });
    return true;
  }

  select(kind) {
    if (kind >= 0 && kind < ITEM_COUNT) this.selected = kind | 0;
    return this.selected;
  }

  /** Next / previous slot (wraps). */
  cycle(dir) {
    const d = dir < 0 ? -1 : 1;
    this.selected = (this.selected + d + ITEM_COUNT) % ITEM_COUNT;
    return this.selected;
  }

  /** Why an item cannot be used right now ('' when it can). */
  refusal(kind, health) {
    if (!(kind >= 0 && kind < ITEM_COUNT)) return kind === ITEM.KNOCKER || kind === ITEM.GRENADE ? 'thrown' : kind === ITEM.SIDEARM ? 'fired' : 'invalid'; // thrown / fired, not applied
    if (this.applying.active) return 'busy';
    if (this.counts[kind] <= 0) return 'empty';
    if (kind === ITEM.FIRST_AID || kind === ITEM.BANDAGE) {
      if (!health || health.dead) return 'dead';
      if (health.hp >= B.fullHp) return 'full';
      if (health.noRecovery) return 'norecovery'; // MASON_SIGHT.md: the chasing Mason is near
    } else if (kind === ITEM.ADRENALINE) {
      if (this.adrenaline.active) return 'active';
    } else if (this.lanternCharge >= 1 - B.batteryRestore * 0.2) {
      return 'full';
    }
    return '';
  }

  /**
   * Starts applying an item (default: the selected one). Returns true when the channel started; otherwise false with
   * the reason in lastRefusal (and a 'bag:refuse' event).
   */
  use(kind = this.selected, health = null) {
    const why = this.refusal(kind, health);
    this.lastRefusal = why;
    if (why) {
      this._emit('bag:refuse', { kind, reason: why });
      return false;
    }
    const a = this.applying;
    a.active = true;
    a.kind = kind;
    a.t = 0;
    a.dur = B.applyTime[kind];
    a.hits = health ? health.hits : 0;
    this.selected = kind;
    this._emit('bag:apply', { kind, dur: a.dur });
    return true;
  }

  /** Stops the channel in progress (the item is kept). Returns true when there was one. */
  cancel(reason = 'cancel') {
    const a = this.applying;
    if (!a.active) return false;
    const kind = a.kind;
    a.active = false;
    a.kind = -1;
    a.t = 0;
    this.stats.cancelled++;
    this._emit('bag:cancel', { kind, reason });
    return true;
  }

  // ---- stepping ----------------------------------------------------------------------------

  /**
   * Advances the channel, the adrenaline timer and the lantern charge.
   * @param {number} dt seconds
   * @param {Health3D|null} health the player's health model (heal target, damage / death detection)
   * @param {boolean} live false while the run is not live (paused, dead, menu): the channel is cancelled and nothing drains
   */
  update(dt, health, live = true) {
    const a = this.applying;
    if (!live) {
      if (a.active) this.cancel('inactive');
      return;
    }
    if (!(dt > 0)) return;

    if (a.active) {
      if (health && health.dead) this.cancel('dead');
      else if (health && health.hits !== a.hits) this.cancel('damage');
      else if (health && health.noRecovery && B.heal[a.kind] > 0 && a.kind !== ITEM.ADRENALINE) this.cancel('norecovery'); // the item is kept
      else {
        a.t += dt;
        if (a.t >= a.dur - 1e-9) this._complete(health);
      }
    }

    const e = this.adrenaline;
    if (e.active) {
      e.t -= dt;
      if (e.t <= 0) {
        e.t = 0;
        e.active = false;
        this.speedMul = 1;
        this._emit('bag:effect', { kind: ITEM.ADRENALINE, on: false });
      }
    }

    // The lantern never goes dark but it does burn down.
    const before = this.lanternCharge;
    if (before > 0) {
      this.lanternCharge = Math.max(0, before - B.lanternDrain * dt);
      this._lantern();
      if (before > B.lanternLow && this.lanternCharge <= B.lanternLow) {
        this.lanternLow = true;
        this._emit('lantern:low', { charge: this.lanternCharge });
      }
      if (this.lanternCharge <= 0 && !this.lanternEmpty) {
        this.lanternEmpty = true;
        this._emit('lantern:empty', {});
      }
    }
  }

  _complete(health) {
    const a = this.applying;
    const kind = a.kind;
    a.active = false;
    a.kind = -1;
    a.t = 0;
    this.counts[kind]--;
    this.stats.used[kind]++;
    const heal = B.heal[kind];
    if (heal > 0 && health) health.heal(heal);
    if (kind === ITEM.ADRENALINE) {
      const e = this.adrenaline;
      e.active = true;
      e.t = B.adrenalineTime;
      e.dur = B.adrenalineTime;
      this.speedMul = B.adrenalineMul;
      this._emit('bag:effect', { kind, on: true });
    } else if (kind === ITEM.BATTERY) {
      this.lanternCharge = Math.min(1, this.lanternCharge + B.batteryRestore);
      this._lantern();
      if (this.lanternCharge > B.lanternLow) this.lanternLow = false;
      if (this.lanternCharge > 0) this.lanternEmpty = false;
    }
    this._emit('bag:done', { kind });
    this._emit('bag:change', { kind, count: this.counts[kind] });
  }

  /**
   * Burns `amount` of lantern charge at once (LEVEL_FUN_PLAN P3: relighting a lamp, sim/objectives3d.js). Never below 0: the
   * lantern still never goes dark (lanternLevel keeps its floor). Returns the charge actually spent.
   */
  spend(amount) {
    const a = typeof amount === 'number' && amount > 0 ? amount : 0;
    const before = this.lanternCharge;
    if (!(a > 0) || !(before > 0)) return 0;
    this.lanternCharge = Math.max(0, before - a);
    this._lantern();
    if (before > B.lanternLow && this.lanternCharge <= B.lanternLow) {
      this.lanternLow = true;
      this._emit('lantern:low', { charge: this.lanternCharge });
    }
    if (this.lanternCharge <= 0 && !this.lanternEmpty) {
      this.lanternEmpty = true;
      this._emit('lantern:empty', {});
    }
    return before - this.lanternCharge;
  }

  /** Adds `k` lantern charge (a swing chain's reward, sim/flow3d.js), clamped to full. Returns the charge actually added. */
  addCharge(k) {
    const before = this.lanternCharge;
    if (!(k > 0)) return 0;
    this.lanternCharge = Math.min(1, before + k);
    this._lantern();
    if (this.lanternCharge > B.lanternLow) this.lanternLow = false;
    if (this.lanternCharge > 0) this.lanternEmpty = false;
    return this.lanternCharge - before;
  }

  // ---- checkpoints ---------------------------------------------------------------------------

  /** Remembers the bag (counts, selection, lantern charge) for a respawn. */
  snapshot() {
    const c = this._cp;
    c.counts.set(this.counts);
    c.selected = this.selected;
    c.charge = this.lanternCharge;
    return c;
  }

  /** Back to the last snapshot: effects and any channel are gone. */
  restore() {
    const c = this._cp;
    // a respawn keeps the knockers and the weapons as the death left them (a thrown one / a fired round is gone)
    const k0 = this.counts[KEPT[0]];
    const k1 = this.counts[KEPT[1]];
    const k2 = this.counts[KEPT[2]];
    this.counts.set(c.counts);
    this.counts[KEPT[0]] = k0;
    this.counts[KEPT[1]] = k1;
    this.counts[KEPT[2]] = k2;
    this.selected = c.selected;
    this.lanternCharge = c.charge;
    this._clearTransient();
    this._lantern();
    this.lanternLow = this.lanternCharge <= B.lanternLow;
    this.lanternEmpty = this.lanternCharge <= 0;
  }

  /** The counts as a plain array (a save). */
  exportCounts() {
    return Array.from(this.counts);
  }

  /** Counts from a save of any older length (migrateCounts): one 'bag:change' per kind that changed. */
  importCounts(arr) {
    const m = migrateCounts(arr);
    for (let i = 0; i < BAG_KINDS; i++) {
      if (this.counts[i] === m[i]) continue;
      this.counts[i] = m[i];
      this._emit('bag:change', { kind: i, count: m[i] });
    }
    return this.counts;
  }

  /** Active effects for the presentation: { adrenaline: {active,t,dur}, speedMul }. The same object every call. */
  get effects() {
    const f = this._fx || (this._fx = { adrenaline: this.adrenaline, speedMul: 1 });
    f.speedMul = this.speedMul;
    return f;
  }

  /** Total of all items in the bag (the knockers included). */
  get total() {
    let n = 0;
    for (let i = 0; i < BAG_KINDS; i++) n += this.counts[i];
    return n;
  }

  /** 0..1 progress of the channel in progress (0 when none). */
  get applyProgress() {
    const a = this.applying;
    return a.active && a.dur > 0 ? Math.min(1, a.t / a.dur) : 0;
  }
}
