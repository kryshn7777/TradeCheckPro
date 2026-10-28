/* ABYSSAL TETHER 3D — objectives3d.js
 * Objectives3D: the section seals and the objectives that open them (docs/abyssal-tether-3d/plans/LEVEL_FUN_PLAN.md §2,
 * phase P1 "seal the shaft"). Every section S1-S7 is left through its seal: iron grating across the section's choke plane
 * (level data `seals`, solids with a `seal` field that Level3D keeps in `level.sealSolids`). Closed, a seal is a floor and
 * blocks every hook line (its solids are active); its objective opens it (the solids go inactive for collision, line of
 * sight and raycasts) and it stays open for the rest of the run: deaths, respawns, checkpoints and the Nightmare
 * alternate respawns never close a seal again; only a new run does (reset()).
 *
 * P1 has one verb, `hook`: a fixture names a ring of the route (`anchorId`); a rope of either hand biting it (and held
 * `hold` s) completes the fixture, `need` completed fixtures of an objective complete it and open its seal.
 *
 * Stepped once per fixed physics step right after Physics3D.step (game.js _stepPhysics, verify/sim.mjs Sim.frame), so the
 * game, the bot and a replay agree. DOM-free, no three.js, no allocation per step (state lives in typed arrays). Events:
 *   objective:progress { id, verb, k, of, x, y, z }      a fixture is done (the ring of a hook fixture)
 *   objective:done     { id, section, verb, sealId, time }
 *   seal:open          { id, section, x, y, z }          (the centre of the seal's top face)
 *   seal:land          { id, x, y, z }                   the player stands on a closed seal (once per approach)
 *
 * Rules (§2.4): reset() = a new run, every seal closed; markDoneThrough(i) = Continue / warp / Sandbox: the objectives of
 * the sections above section i are done, silently; reapply() after every level.reset() (seal solids are not touched by
 * it; the call keeps the contract); openAll() = the menu's attract camera flies through the shaft.
 */

// No imports: game.js loads this with its core sim modules, while the level (level3d.js + the data) is loaded later.
/** Same rule as level3d.js inVariant (`omitIn` / `onlyIn` lists). */
function inVariant(o, variant) {
  if (Array.isArray(o.onlyIn) && o.onlyIn.length > 0 && o.onlyIn.indexOf(variant) < 0) return false;
  return !(Array.isArray(o.omitIn) && o.omitIn.indexOf(variant) >= 0);
}

const SEAL_LAND_CLEAR = 4; // m above a seal's top before a new landing on it is announced again

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

export class Objectives3D {
  /**
   * @param {Level3D} level
   * @param {object} [diff]  DIFFICULTY preset (`key` picks the `by[key]` overrides of an objective)
   * @param {EventBus} [bus]
   */
  constructor(level, diff, bus) {
    this.level = level || null;
    this.diff = diff || {};
    this.bus = bus || null;
    const d = (level && level.data) || {};
    const v = (level && level.variant) || 'normal';
    const key = this.diff.key || v;
    const byId = (level && level.byId) || Object.create(null);
    const sections = (level && level.sections) || [];
    const secIndex = (id) => {
      for (let i = 0; i < sections.length; i++) if (sections[i].id === id) return i;
      return -1;
    };
    const live = (list) => (Array.isArray(list) ? list.filter((o) => o && typeof o.id === 'string' && inVariant(o, v)) : []);

    // ---- seals ------------------------------------------------------------------------------------------------
    /** @type {{id:string, index:number, section:number, open:string, solids:object[], top:number, bottom:number, x:number, y:number, z:number, minX:number, maxX:number, minZ:number, maxZ:number}[]} */
    this.seals = [];
    const sealOf = Object.create(null);
    this._sealOfSolid = new Map();
    for (const raw of live(d.seals)) {
      const solids = (Array.isArray(raw.ids) ? raw.ids : []).map((id) => byId[id]).filter((s) => s && s.seal === raw.id);
      if (!solids.length) continue;
      let minX = Infinity;
      let maxX = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;
      let top = -Infinity;
      let bottom = Infinity;
      for (const s of solids) {
        minX = Math.min(minX, s.minX);
        maxX = Math.max(maxX, s.maxX);
        minZ = Math.min(minZ, s.minZ);
        maxZ = Math.max(maxZ, s.maxZ);
        top = Math.max(top, s.maxY);
        bottom = Math.min(bottom, s.minY);
      }
      const si = secIndex(raw.section);
      const seal = {
        id: raw.id,
        index: this.seals.length,
        section: si >= 0 ? si : level.sectionIndexAt(top),
        open: typeof raw.open === 'string' ? raw.open : 'slide',
        solids,
        top,
        bottom,
        minX,
        maxX,
        minZ,
        maxZ,
        x: (minX + maxX) / 2,
        y: top,
        z: (minZ + maxZ) / 2,
      };
      sealOf[raw.id] = seal;
      for (const s of solids) this._sealOfSolid.set(s, seal.index);
      this.seals.push(seal);
    }

    // ---- objectives and their fixtures -------------------------------------------------------------------------
    const fixtures = Object.create(null);
    for (const f of live(d.fixtures)) fixtures[f.id] = f;
    /** @type {{id:string, index:number, verb:string, section:number, seal:number, need:number, fx:number[]}[]} */
    this.objectives = [];
    /** Flat fixture list: { obj, kind, anchor, hold }. */
    this.fixtures = [];
    for (const raw of live(d.objectives)) {
      const o = Object.assign({}, raw, raw.by && raw.by[key] ? raw.by[key] : null);
      const seal = sealOf[o.sealId];
      if (!seal) continue;
      const index = this.objectives.length;
      const fx = [];
      for (const fid of Array.isArray(o.ids) ? o.ids : []) {
        const f = fixtures[fid];
        if (!f || f.kind !== 'hook') continue; // P1: the hook verb only
        const anchor = byId[f.anchorId];
        if (!anchor || anchor.x === undefined || anchor.minX !== undefined) continue;
        fx.push(this.fixtures.length);
        this.fixtures.push({ id: f.id, obj: index, kind: 'hook', anchor, hold: Math.max(0, num(f.hold, 0)) });
      }
      if (!fx.length) continue;
      const si = secIndex(o.section);
      this.objectives.push({
        id: o.id,
        index,
        verb: o.verb || 'hook',
        section: si >= 0 ? si : seal.section,
        seal: seal.index,
        need: Math.max(1, Math.min(fx.length, Math.round(num(o.need, 1)))),
        fx,
      });
    }

    // ---- state (typed arrays) ----------------------------------------------------------------------------------
    const nO = this.objectives.length;
    const nF = this.fixtures.length;
    const nS = this.seals.length;
    this.done = new Uint8Array(nO);
    this.count = new Uint8Array(nO);
    this.fxDone = new Uint8Array(nF);
    this.fxT = new Float32Array(nF);
    this.sealOpen = new Uint8Array(nS);
    /** 1 = the seal was opened by its objective in play (the view animates it); 0 = opened silently (warp, Continue, menu). */
    this.sealLoud = new Uint8Array(nS);
    this._landSeal = -1;
    this._snapLen = nO * 2 + nF * 2 + nS + 1;
    this.reset();
  }

  /** Number of objectives done. */
  get doneCount() {
    let n = 0;
    for (let i = 0; i < this.done.length; i++) n += this.done[i];
    return n;
  }

  /** The done flags, one per objective (index = objectives[i].index). */
  get doneMask() {
    return this.done;
  }

  /** A new run: every seal closed, all progress 0. */
  reset() {
    this.done.fill(0);
    this.count.fill(0);
    this.fxDone.fill(0);
    this.fxT.fill(0);
    this.sealOpen.fill(0);
    this.sealLoud.fill(0);
    this._landSeal = -1;
    this._sync();
  }

  /** After every level.reset(): the solids of open seals inactive, the closed ones active (and the ring cues). */
  reapply() {
    this._sync();
  }

  /** Continue / warp / Sandbox: every objective of a section above section `i` is done (silently, no events). */
  markDoneThrough(i) {
    const n = i | 0;
    for (const o of this.objectives) if (o.section < n) this._complete(o, false);
    this._sync();
  }

  /** Every seal open (the menu's attract camera, tools). */
  openAll() {
    for (const o of this.objectives) this._complete(o, false);
    for (let i = 0; i < this.sealOpen.length; i++) this.sealOpen[i] = 1;
    this._sync();
  }

  isOpen(sealId) {
    for (const s of this.seals) if (s.id === sealId) return this.sealOpen[s.index] === 1;
    return false;
  }

  isDone(objId) {
    for (const o of this.objectives) if (o.id === objId) return this.done[o.index] === 1;
    return false;
  }

  /** 0..1 progress of an objective (fixtures done / need). */
  progressOf(objId) {
    for (const o of this.objectives) if (o.id === objId) return this.done[o.index] ? 1 : Math.min(1, this.count[o.index] / o.need);
    return 0;
  }

  /** The objective that opens seal index `si` (or null). */
  objectiveOfSeal(si) {
    for (const o of this.objectives) if (o.seal === si) return o;
    return null;
  }

  /**
   * One fixed step, right after Physics3D.step: the hook verb (a rope of either hand bitten into a fixture's ring, held
   * `hold` s) and the seal-landing cue. `t` = the run clock (event payloads only).
   */
  step(dt, player, tethers, t) {
    const F = this.fixtures;
    if (F.length) {
      const hands = tethers && tethers.hands;
      const L = hands && hands.left && hands.left.rope ? hands.left.rope.anchor : null;
      const R = hands && hands.right && hands.right.rope ? hands.right.rope.anchor : null;
      if (L || R) {
        for (let i = 0; i < F.length; i++) {
          if (this.fxDone[i]) continue;
          const f = F[i];
          if (this.done[f.obj]) continue;
          if (f.anchor === L || f.anchor === R) {
            this.fxT[i] += dt;
            if (this.fxT[i] >= f.hold) this._fixtureDone(i, t);
          } else this.fxT[i] = 0;
        }
      } else {
        for (let i = 0; i < F.length; i++) this.fxT[i] = 0;
      }
    }
    if (player && this.seals.length) this._land(player);
  }

  _land(p) {
    if (this._landSeal >= 0 && (p.y > this.seals[this._landSeal].top + SEAL_LAND_CLEAR || this.sealOpen[this._landSeal])) this._landSeal = -1;
    if (!p.grounded || !p.groundSolid || p.groundSolid.seal === undefined) return;
    const si = this._sealOfSolid.get(p.groundSolid);
    if (si === undefined || si === this._landSeal || this.sealOpen[si]) return;
    this._landSeal = si;
    if (this.bus) this.bus.emit('seal:land', { id: this.seals[si].id, x: p.x, y: p.y, z: p.z });
  }

  _fixtureDone(i, t) {
    const f = this.fixtures[i];
    const o = this.objectives[f.obj];
    this.fxDone[i] = 1;
    this.count[o.index]++;
    const a = f.anchor;
    if (this.bus) this.bus.emit('objective:progress', { id: o.id, verb: o.verb, k: this.count[o.index], of: o.need, x: a.x, y: a.y, z: a.z });
    if (this.count[o.index] >= o.need) {
      this._complete(o, true, t);
      this._sync();
    }
  }

  /** Marks objective `o` done and opens its seal; `loud` emits objective:done and seal:open. */
  _complete(o, loud, t) {
    if (this.done[o.index]) return;
    this.done[o.index] = 1;
    if (this.count[o.index] < o.need) this.count[o.index] = o.need;
    const s = this.seals[o.seal];
    const was = this.sealOpen[s.index];
    this.sealOpen[s.index] = 1;
    if (!was) this.sealLoud[s.index] = loud ? 1 : 0;
    if (this._landSeal === s.index) this._landSeal = -1;
    if (loud && this.bus) {
      this.bus.emit('objective:done', { id: o.id, section: o.section, verb: o.verb, sealId: s.id, time: num(t, 0) });
      if (!was) this.bus.emit('seal:open', { id: s.id, section: s.section, x: s.x, y: s.y, z: s.z });
    }
  }

  /** Seal solids follow the open flags; the rings of undone objectives carry `sealKey` (the view's cue). */
  _sync() {
    for (const s of this.seals) {
      const active = !this.sealOpen[s.index];
      for (let k = 0; k < s.solids.length; k++) s.solids[k].active = active;
    }
    for (let i = 0; i < this.fixtures.length; i++) {
      const f = this.fixtures[i];
      f.anchor.sealKey = this.done[f.obj] || this.fxDone[i] ? 0 : 1;
    }
  }

  // ---- bot look-ahead (verify/bot.mjs): one Float64Array per snapshot --------------------------------------------
  snapshot() {
    const s = new Float64Array(this._snapLen);
    let j = 0;
    for (let i = 0; i < this.done.length; i++) s[j++] = this.done[i];
    for (let i = 0; i < this.count.length; i++) s[j++] = this.count[i];
    for (let i = 0; i < this.fxDone.length; i++) s[j++] = this.fxDone[i];
    for (let i = 0; i < this.fxT.length; i++) s[j++] = this.fxT[i];
    for (let i = 0; i < this.sealOpen.length; i++) s[j++] = this.sealOpen[i];
    s[j] = this._landSeal;
    return s;
  }

  restore(s) {
    if (!s || s.length !== this._snapLen) return false;
    let j = 0;
    for (let i = 0; i < this.done.length; i++) this.done[i] = s[j++];
    for (let i = 0; i < this.count.length; i++) this.count[i] = s[j++];
    for (let i = 0; i < this.fxDone.length; i++) this.fxDone[i] = s[j++];
    for (let i = 0; i < this.fxT.length; i++) this.fxT[i] = s[j++];
    for (let i = 0; i < this.sealOpen.length; i++) this.sealOpen[i] = s[j++];
    this._landSeal = s[j];
    this._sync();
    return true;
  }

  // ---- save (meta/save.js run.objectives): the ids of the objectives done --------------------------------------------
  serialize() {
    const out = [];
    for (const o of this.objectives) if (this.done[o.index]) out.push(o.id);
    return out;
  }

  /** Marks the listed objective ids done (unknown ids are ignored); returns how many were applied. */
  load(ids) {
    if (!Array.isArray(ids)) return 0;
    let n = 0;
    for (const o of this.objectives) {
      if (ids.indexOf(o.id) < 0) continue;
      this._complete(o, false);
      n++;
    }
    this._sync();
    return n;
  }
}
