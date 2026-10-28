/* ABYSSAL TETHER 3D — objectives3d.js
 * Objectives3D: the section seals and the objectives that open them (docs/abyssal-tether-3d/plans/LEVEL_FUN_PLAN.md §2,
 * phases P1 "seal the shaft" and P3 "first verbs"). Every section S1-S7 is left through its seal: iron grating across the
 * section's choke plane (level data `seals`, solids with a `seal` field that Level3D keeps in `level.sealSolids`). Closed,
 * a seal is a floor and blocks every hook line (its solids are active); its objective opens it (the solids go inactive for
 * collision, line of sight and raycasts) and it stays open for the rest of the run: deaths, respawns, checkpoints and the
 * Nightmare alternate respawns never close a seal again; only a new run does (reset()).
 *
 * An objective is done when `need` of its fixtures are done. A fixture is one thing a verb acts on (level data `fixtures`,
 * `by[difficulty]` overrides like an objective's):
 *   hook  `anchorId`: a rope of either hand biting that ring, held `hold` s (P1; S3, S5-S7)
 *   bell  `x, y, z, r, minSpeed`: the body strikes the bell (centre within r + body radius, closing speed >= minSpeed).
 *         The bell is solid to the body: it bounces off it (the closing part of its velocity reflected, BELL_E), so a
 *         strike is the player's own swing, never a push. Every strike (cooldown BELL_GAP) is a `bell:ring`, loud enough
 *         for the Mason (S1).
 *   haul  `anchorId, time, notches`: a hand on that ring hauling (its grip yank > 0.5, or reeling in > 0.5) for `time` s,
 *         in `notches` ratchet steps. The ring carries `haul: true`: Physics3D.step does not reel the player toward it
 *         (comfort: hauling never moves you). A notch is kept when you let go (a pull between notches slips back to the
 *         last one) and every notch is loud (`noise`, the strength of a bell strike) (S2; the S5 fallback in P5).
 *   lamp  `x, y, z, r, time, charge`: the lantern probe (setProbe: the lantern hand in XR, the view ray on a screen, the
 *         bots' probe) within r of the wick for `time` s relights it and costs `charge` of the lantern. It never blocks:
 *         with less charge left the relight takes twice as long and empties the lantern, which never goes dark (S4).
 *   winch `anchorId, time, notches` (P4): a ring riding a turning gear (a moving anchor, sim/movers3d.js). While a rope of
 *         either hand bites it, the gear hauls the winch: `time` s of it in `notches` ratchet steps (a line let go, or pulled
 *         off as the ring turns into the gear's housing, keeps the notches done). The ring can only be hooked on the
 *         half-turn it is out of the wall; it comes round every period, so a missed timing is a wait, never a lock (S3).
 * Every verb is a ratchet: fixtures done (lamps lit, the bell struck) and haul / winch notches survive a death, a respawn
 * and a Continue (serialize / load), so a retry never repeats more than one notch.
 *
 * P4 "machines" also owns two closed-form functions of the run clock (`clock`, advanced by dt in step(), part of the
 * snapshot, so the bots' look-ahead rewinds them):
 *   movers  (Movers3D) every carried anchor posed at the clock after each step, i.e. before the next physics step;
 *   lanes   rockfall lanes (level data `lanes`: a box and a schedule { period, on, lead, phase }, `damage`, per difficulty
 *           in `by`): `lead` s before each drop `lane:warn` (the dust and rumble cue), then for `on` s the stones fall: a
 *           body inside the box takes `damage` (once per drop, through Physics3D's health: cause 'rockfall'; never more
 *           than that, and only lethal when the hp left is lower). Not hazards of the level (no climb edge, dressing or
 *           supply rule moves for them). Events only within `hear` m.
 * A seal never opens under your feet (P4): an objective done while the player stands on (or hops just above) its own
 * closed grating opens it as soon as they are off it (a rope, a ledge), so the S3 winch hooked from the grating itself is
 * a safe fallback.
 *
 * Stepped once per fixed physics step right after Physics3D.step (game.js _stepPhysics, verify/sim.mjs Sim.frame), so the
 * game, the bot and a replay agree. DOM-free, no three.js, no allocation per step (state lives in typed arrays). Events:
 *   objective:progress { id, fixture, verb, k, of, x, y, z, noise }  a fixture done (hook ring / bell / lamp: k of need)
 *                                                                    or a haul / winch notch (k of notches, noise > 0)
 *   objective:done     { id, section, verb, sealId, time }
 *   seal:open          { id, section, x, y, z }          (the centre of the seal's top face)
 *   seal:land          { id, x, y, z }                   the player stands on a closed seal (once per approach)
 *   bell:ring          { id, x, y, z, speed, strength }  every strike of a bell (strength: a noise for the Mason)
 *   lane:warn          { id, x, y, z, lead }             a rockfall lane will drop in `lead` s (x, z: its centre; y: its top)
 *   lane:on / lane:off { id, x, y, z, dur } / { id }     the stones fall for `dur` s / stop
 *   lane:hit           { id, x, y, z, amount }           a falling stone struck the player
 *
 * Rules (§2.4): reset() = a new run, every seal closed; markDoneThrough(i) = Continue / warp / Sandbox: the objectives of
 * the sections above section i are done, silently; reapply() after every level.reset() (seal solids are not touched by
 * it; the call keeps the contract); openAll() = the menu's attract camera flies through the shaft.
 */

// Only the import-free movers module: game.js loads this with its core sim modules, while the level (level3d.js + the data)
// is loaded later.
import { Movers3D } from './movers3d.js';
/** Same rule as level3d.js inVariant (`omitIn` / `onlyIn` lists). */
function inVariant(o, variant) {
  if (Array.isArray(o.onlyIn) && o.onlyIn.length > 0 && o.onlyIn.indexOf(variant) < 0) return false;
  return !(Array.isArray(o.omitIn) && o.omitIn.indexOf(variant) >= 0);
}

const SEAL_LAND_CLEAR = 4; // m above a seal's top before a new landing on it is announced again
/** Bell: restitution of the bounce, the gap between two rings (s), the noise of a strike (as a wall hit at this speed, m/s). */
export const BELL_E = 0.3;
export const BELL_GAP = 0.45;
/** A bell strike / a haul notch is this loud for the Mason (Creature3D._onNoise 'wall': over every difficulty's noiseWall). */
export const VERB_NOISE = 12;
const HAUL_IN = 0.5; // yank or reel-in above this hauls
const KIND = { hook: 0, bell: 1, haul: 2, lamp: 3, winch: 4 };
/** A seal waits while the body stands on it or hangs this close (m) above its top (P4: never open under the feet) ... */
const SEAL_FOOT_CLEAR = 1.6;
/** ... unless a floor lies at most this far (m) under the plate there (a short, harmless drop: it opens at once). */
const SEAL_SAFE_DROP = 3;
/** Lane events are emitted only for a player this close (m) to the lane's box. */
const LANE_HEAR = 30;

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

export class Objectives3D {
  /**
   * @param {Level3D} level
   * @param {object} [diff]  DIFFICULTY preset (`key` picks the `by[key]` overrides of an objective / a fixture)
   * @param {EventBus} [bus]
   */
  constructor(level, diff, bus) {
    this.level = level || null;
    this.diff = diff || {};
    this.bus = bus || null;
    /** The lantern a lamp relight spends ({ lanternCharge, spend(amount) }: the bag, sim/inventory3d.js); null = always full. */
    this.lantern = null;
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
    const tuned = (o) => Object.assign({}, o, o.by && o.by[key] ? o.by[key] : null);

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
    for (const f of live(d.fixtures)) fixtures[f.id] = tuned(f);
    /** @type {{id:string, index:number, verb:string, section:number, seal:number, need:number, fx:number[]}[]} */
    this.objectives = [];
    /**
     * Flat fixture list: { id, obj, kind, k (KIND), anchor (hook / haul), x, y, z, hold, r, minSpeed, time, notches, charge }.
     * Bell / lamp positions come from the data, hook / haul ones from their ring.
     */
    this.fixtures = [];
    for (const raw of live(d.objectives)) {
      const o = tuned(raw);
      const seal = sealOf[o.sealId];
      if (!seal) continue;
      const index = this.objectives.length;
      const fx = [];
      for (const fid of Array.isArray(o.ids) ? o.ids : []) {
        const f = fixtures[fid];
        if (!f || !(f.kind in KIND)) continue;
        let anchor = null;
        if (f.kind === 'hook' || f.kind === 'haul' || f.kind === 'winch') {
          anchor = byId[f.anchorId];
          if (!anchor || anchor.x === undefined || anchor.minX !== undefined) continue;
        } else if (!isFinite(f.x) || !isFinite(f.y) || !isFinite(f.z)) continue;
        if (f.kind === 'haul') anchor.haul = true; // Physics3D.step: no reel toward a haul ring
        fx.push(this.fixtures.length);
        this.fixtures.push({
          id: f.id,
          obj: index,
          kind: f.kind,
          k: KIND[f.kind],
          anchor,
          x: anchor ? anchor.x : f.x,
          y: anchor ? anchor.y : f.y,
          z: anchor ? anchor.z : f.z,
          hold: Math.max(0, num(f.hold, 0)),
          r: Math.max(0.1, num(f.r, f.kind === 'bell' ? 0.75 : 0.9)),
          minSpeed: Math.max(0, num(f.minSpeed, 2.5)),
          time: Math.max(0.05, num(f.time, 1.5)),
          notches: Math.max(1, Math.min(16, Math.round(num(f.notches, 1)))),
          charge: Math.max(0, num(f.charge, 0)),
        });
      }
      if (!fx.length) continue;
      const si = secIndex(o.section);
      this.objectives.push({
        id: o.id,
        index,
        verb: o.verb || this.fixtures[fx[0]].kind,
        section: si >= 0 ? si : seal.section,
        seal: seal.index,
        need: Math.max(1, Math.min(fx.length, Math.round(num(o.need, 1)))),
        fx,
      });
    }
    this._hasProbeVerb = this.fixtures.some((f) => f.k === KIND.lamp);

    // ---- P4: movers (the run's knobs) and rockfall lanes ---------------------------------------------------------
    /** Movers3D (sim/movers3d.js) of the level's movers with this difficulty's knobs, or null. */
    this.movers = level && Array.isArray(level.movers) && level.movers.length ? new Movers3D(level, this.diff) : null;
    /** Physics3D of the run (game.js / verify Sim set it): a rockfall lane hurts through its health and kills through it. */
    this.physics = null;
    /** @type {{id:string, index:number, section:number, minX:number, minY:number, minZ:number, maxX:number, maxY:number, maxZ:number, x:number, z:number, period:number, on:number, lead:number, phase:number, damage:number, hear:number}[]} */
    this.lanes = [];
    for (const raw of live(d.lanes)) {
      const o = tuned(raw);
      const b = o.box || o;
      const box = [b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ];
      if (!box.every((x) => typeof x === 'number' && isFinite(x))) continue;
      const period = Math.max(1, num(o.period, 7));
      const on = Math.max(0.1, Math.min(period - 0.5, num(o.on, 1.6)));
      this.lanes.push({
        id: o.id,
        index: this.lanes.length,
        section: secIndex(o.section) >= 0 ? secIndex(o.section) : level ? level.sectionIndexAt(b.maxY) : 0,
        minX: Math.min(b.minX, b.maxX),
        minY: Math.min(b.minY, b.maxY),
        minZ: Math.min(b.minZ, b.maxZ),
        maxX: Math.max(b.minX, b.maxX),
        maxY: Math.max(b.minY, b.maxY),
        maxZ: Math.max(b.minZ, b.maxZ),
        x: (b.minX + b.maxX) / 2,
        z: (b.minZ + b.maxZ) / 2,
        period,
        on,
        lead: Math.max(0, Math.min(period - on, num(o.lead, 1.5))),
        phase: num(o.phase, 0),
        damage: Math.max(0, num(o.damage, 0.3)),
        hear: Math.max(1, num(o.hear, LANE_HEAR)),
      });
    }

    // ---- state (typed arrays) ----------------------------------------------------------------------------------
    const nO = this.objectives.length;
    const nF = this.fixtures.length;
    const nS = this.seals.length;
    const nL = this.lanes.length;
    /** The run clock (s): movers and lanes are functions of it (P4). */
    this.clock = 0;
    /** Per lane: 1 while its stones fall (the view and the bots read it), the drop (cycle) that last struck the player. */
    this.laneOn = new Uint8Array(nL);
    this.laneHit = new Float64Array(nL).fill(-1);
    /** Per seal: its objective is done but the player stands on it (it opens once they are off it, P4). */
    this.sealWait = new Uint8Array(nS);
    this._player = null;
    this._ray = { t: 0, solid: null, x: 0, y: 0, z: 0 }; // raycast result (reused)
    this.done = new Uint8Array(nO);
    this.count = new Uint8Array(nO);
    this.fxDone = new Uint8Array(nF);
    /** Per fixture: hook = time held, haul = time hauled, lamp = time lit, bell = cooldown left. */
    this.fxT = new Float32Array(nF);
    /** Haul notches done (ratchet). */
    this.fxN = new Uint8Array(nF);
    /** Bell strikes for the view: run clock of the last strike and its horizontal direction (unit, away from the body). */
    this.fxHitT = new Float32Array(nF).fill(-1e9);
    this.fxHitX = new Float32Array(nF);
    this.fxHitZ = new Float32Array(nF);
    this.sealOpen = new Uint8Array(nS);
    /** 1 = the seal was opened by its objective in play (the view animates it); 0 = opened silently (warp, Continue, menu). */
    this.sealLoud = new Uint8Array(nS);
    this._landSeal = -1;
    // the lantern probe (setProbe, once per frame)
    this._probeOn = false;
    this._px = 0;
    this._py = 0;
    this._pz = 0;
    this._snapLen = nO * 2 + nF * 6 + nS * 2 + nL + 2;
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

  /** A new run: every seal closed, all progress 0, the run clock (movers, lanes) at 0. */
  reset() {
    this.done.fill(0);
    this.count.fill(0);
    this.fxDone.fill(0);
    this.fxT.fill(0);
    this.fxN.fill(0);
    this.fxHitT.fill(-1e9);
    this.sealOpen.fill(0);
    this.sealLoud.fill(0);
    this.sealWait.fill(0);
    this.laneHit.fill(-1);
    this._landSeal = -1;
    this._probeOn = false;
    this.clock = 0;
    this._pose();
    this._sync();
  }

  /** After every level.reset(): the solids of open seals inactive, the closed ones active (and the ring cues). */
  reapply() {
    // a pull between two notches slips back to the last one, an unfinished relight goes out (the ratchet keeps the rest)
    for (let i = 0; i < this.fixtures.length; i++) this._slip(i);
    this._probeOn = false;
    this._pose();
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
    this.sealWait.fill(0);
    this._sync();
  }

  /** Movers to the clock; each lane's falling flag from the clock (no events: step() emits them). */
  _pose() {
    if (this.movers) this.movers.pose(this.clock);
    for (let i = 0; i < this.lanes.length; i++) this.laneOn[i] = this._laneU(this.lanes[i], this.clock) < this.lanes[i].on ? 1 : 0;
  }

  /** Where lane `L` is in its cycle at clock t: 0..period (the stones fall for u < on). */
  _laneU(L, t) {
    const c = t / L.period + L.phase;
    return (c - Math.floor(c)) * L.period;
  }

  /** The cycle (drop) number of lane `L` at clock t. */
  _laneCycle(L, t) {
    return Math.floor(t / L.period + L.phase);
  }

  /** Index of lane `id` (-1: none in this variant). */
  laneIndex(id) {
    for (let i = 0; i < this.lanes.length; i++) if (this.lanes[i].id === id) return i;
    return -1;
  }

  /**
   * Seconds from the clock until lane `i`'s next drop starts (0 while its stones fall): the bots wait for a long enough
   * gap before crossing it (verify/bot.mjs `wait: { lane }`).
   */
  laneClearFor(i) {
    const L = this.lanes[i];
    if (!L) return Infinity;
    const u = this._laneU(L, this.clock);
    return u < L.on ? 0 : L.period - u;
  }

  /** Seconds from the clock until moving anchor `a` turns into its housing (Infinity: it never hides / no movers). */
  exposedFor(a) {
    return this.movers ? this.movers.exposedFor(a, this.clock) : Infinity;
  }

  isOpen(sealId) {
    for (const s of this.seals) if (s.id === sealId) return this.sealOpen[s.index] === 1;
    return false;
  }

  isDone(objId) {
    for (const o of this.objectives) if (o.id === objId) return this.done[o.index] === 1;
    return false;
  }

  objective(objId) {
    for (const o of this.objectives) if (o.id === objId) return o;
    return null;
  }

  /** Index of fixture `id` in `fixtures` (-1 when absent in this variant). */
  fixtureIndex(id) {
    for (let i = 0; i < this.fixtures.length; i++) if (this.fixtures[i].id === id) return i;
    return -1;
  }

  /** Fixture i is done: its own flag, or its objective is (a warp, a Continue, another line's fixtures). */
  fixtureDone(i) {
    return this.fxDone[i] === 1 || this.done[this.fixtures[i].obj] === 1;
  }

  /**
   * 0..1 progress of an objective: fixtures done / need, a haul counting its notches (the S4 lamps' light follows it:
   * render/lighting.js).
   */
  progressOf(objId) {
    for (const o of this.objectives) {
      if (o.id !== objId) continue;
      if (this.done[o.index]) return 1;
      let part = 0;
      for (const fi of o.fx) {
        const f = this.fixtures[fi];
        if ((f.k === KIND.haul || f.k === KIND.winch) && !this.fxDone[fi]) part = Math.max(part, this.fxN[fi] / f.notches);
      }
      return Math.min(1, (this.count[o.index] + part) / o.need);
    }
    return 0;
  }

  /** The objective that opens seal index `si` (or null). */
  objectiveOfSeal(si) {
    for (const o of this.objectives) if (o.seal === si) return o;
    return null;
  }

  /**
   * The lantern probe for this frame (game.js: the lantern hand in XR, the view ray within 2.5 m on a screen; the bots: from
   * their intent). `on` false: no lamp is being lit.
   */
  setProbe(x, y, z, on) {
    this._probeOn = !!on && isFinite(x) && isFinite(y) && isFinite(z);
    if (!this._probeOn) return;
    this._px = x;
    this._py = y;
    this._pz = z;
  }

  /** True while the level has a lamp to light (game.js computes the probe only then). */
  get wantsProbe() {
    if (!this._hasProbeVerb) return false;
    for (let i = 0; i < this.fixtures.length; i++) if (this.fixtures[i].k === KIND.lamp && !this.fixtureDone(i)) return true;
    return false;
  }

  /**
   * One fixed step, right after Physics3D.step: the run clock (movers posed for the next physics step, the rockfall lanes),
   * the verbs (hook, bell, haul, lamp, winch), the seals waiting for the player to get off them and the seal-landing cue.
   * `intent` = the step intent (hands[h].yank, reel: the haul); `t` = the game's run time (event payloads, the bell's view).
   * The P1 form step(dt, player, tethers, t) still works (no haul input then).
   */
  step(dt, player, tethers, intent, t) {
    if (typeof intent === 'number') {
      t = intent;
      intent = null;
    }
    this._player = player || null;
    const t0 = this.clock;
    this.clock = t0 + dt;
    if (this.movers) this.movers.pose(this.clock);
    if (this.lanes.length) this._stepLanes(t0, this.clock, player, tethers);
    const F = this.fixtures;
    if (F.length) {
      const hands = tethers && tethers.hands;
      const L = hands && hands.left && hands.left.rope ? hands.left.rope.anchor : null;
      const R = hands && hands.right && hands.right.rope ? hands.right.rope.anchor : null;
      const ih = intent && intent.hands;
      const reelIn = intent && intent.reel > HAUL_IN;
      const yankL = !!(ih && ih.left && ih.left.yank > HAUL_IN);
      const yankR = !!(ih && ih.right && ih.right.yank > HAUL_IN);
      for (let i = 0; i < F.length; i++) {
        const f = F[i];
        if (f.k === KIND.bell) {
          // a bell rings for every strike, done or not (and is solid either way)
          if (player && player.alive) this._bell(i, f, player, dt, t);
          continue;
        }
        if (this.fxDone[i] || this.done[f.obj]) continue;
        if (f.k === KIND.hook) {
          if (f.anchor === L || f.anchor === R) {
            this.fxT[i] += dt;
            if (this.fxT[i] >= f.hold) this._fixtureDone(i, t);
          } else this.fxT[i] = 0;
        } else if (f.k === KIND.haul) {
          const on = (f.anchor === L && (yankL || reelIn)) || (f.anchor === R && (yankR || reelIn));
          if (on) this._haul(i, f, dt, t);
          else this._slip(i);
        } else if (f.k === KIND.winch) {
          // the turning gear hauls while a line bites its ring (no input: the machine does the work)
          if (f.anchor === L || f.anchor === R) this._haul(i, f, dt, t);
          else this._slip(i);
        } else if (f.k === KIND.lamp) {
          if (this._probeOn && Math.hypot(this._px - f.x, this._py - f.y, this._pz - f.z) <= f.r) {
            this.fxT[i] += dt;
            const have = this.lantern ? num(this.lantern.lanternCharge, 1) : 1;
            if (this.fxT[i] >= (have + 1e-6 >= f.charge ? f.time : f.time * 2)) this._lampLit(i, f, t);
          } else this.fxT[i] = 0;
        }
      }
    }
    if (player && this.seals.length) {
      for (let s = 0; s < this.sealWait.length; s++) if (this.sealWait[s] && !this._underFoot(this.seals[s], player)) this._openWaiting(s);
      this._land(player);
    }
  }

  /**
   * The rockfall lanes over (t0, t1]: the cue `lead` s before a drop, the drop's start and end (events only within `hear`
   * m of the player), the falling flag, and a stone striking a body inside a falling lane (once per drop).
   */
  _stepLanes(t0, t1, p, tethers) {
    for (let i = 0; i < this.lanes.length; i++) {
      const L = this.lanes[i];
      const u0 = this._laneU(L, t0);
      const u1 = this._laneU(L, t1);
      const k0 = this._laneCycle(L, t0);
      const k1 = this._laneCycle(L, t1);
      const on = u1 < L.on;
      this.laneOn[i] = on ? 1 : 0;
      const hear = this.bus && p && this._laneDist(L, p) <= L.hear;
      if (hear) {
        const warnAt = L.period - L.lead;
        if (L.lead > 0 && k1 === k0 && u0 < warnAt && u1 >= warnAt) this.bus.emit('lane:warn', { id: L.id, x: L.x, y: L.maxY, z: L.z, lead: L.lead });
        if (k1 !== k0) this.bus.emit('lane:on', { id: L.id, x: L.x, y: L.maxY, z: L.z, dur: L.on });
        else if (u0 < L.on && !on) this.bus.emit('lane:off', { id: L.id });
      }
      if (!on || !p || !p.alive || this.laneHit[i] === k1) continue;
      const r = (p.radius || 0.38) * 0.8;
      const cx = p.x < L.minX ? L.minX : p.x > L.maxX ? L.maxX : p.x;
      const cy = p.y < L.minY ? L.minY : p.y > L.maxY ? L.maxY : p.y;
      const cz = p.z < L.minZ ? L.minZ : p.z > L.maxZ ? L.maxZ : p.z;
      const dx = p.x - cx;
      const dy = p.y - cy;
      const dz = p.z - cz;
      if (dx * dx + dy * dy + dz * dz >= r * r) continue;
      this.laneHit[i] = k1;
      if (this.bus) this.bus.emit('lane:hit', { id: L.id, x: p.x, y: p.y, z: p.z, amount: L.damage });
      const ph = this.physics;
      if (!ph || !(L.damage > 0)) continue;
      const health = typeof ph._health === 'function' ? ph._health() : ph.health;
      if (health && health.damage(L.damage, 'rockfall', 0) && typeof ph.kill === 'function') ph.kill(p, tethers, 'rockfall');
    }
  }

  /** Distance from the player to lane L's box (0 inside). */
  _laneDist(L, p) {
    const dx = Math.max(L.minX - p.x, 0, p.x - L.maxX);
    const dy = Math.max(L.minY - p.y, 0, p.y - L.maxY);
    const dz = Math.max(L.minZ - p.z, 0, p.z - L.maxZ);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * Does the player stand on seal s (or hop / hang within SEAL_FOOT_CLEAR above it) over a drop deeper than SEAL_SAFE_DROP
   * (no floor that close under the plate)? Then it does not open yet: a seal never drops you into a fall.
   */
  _underFoot(s, p) {
    if (!p || !p.alive) return false;
    if (p.grounded) {
      if (!p.groundSolid || this._sealOfSolid.get(p.groundSolid) !== s.index) return false;
    } else {
      if (p.x < s.minX - 0.4 || p.x > s.maxX + 0.4 || p.z < s.minZ - 0.4 || p.z > s.maxZ + 0.4) return false;
      if (!(p.y > s.bottom && p.y < s.top + SEAL_FOOT_CLEAR)) return false;
    }
    const L = this.level;
    if (!L || typeof L.raycast !== 'function') return true;
    // the plates themselves are skipped: the ray starts under the seal's bottom face
    return !L.raycast(p.x, s.bottom - 0.02, p.z, 0, -1, 0, SEAL_SAFE_DROP, this._ray);
  }

  /** A seal that waited for the player to get off it opens (loud: it slides away in view). */
  _openWaiting(si) {
    const s = this.seals[si];
    this.sealWait[si] = 0;
    if (this.sealOpen[si]) return;
    this.sealOpen[si] = 1;
    this.sealLoud[si] = 1;
    if (this._landSeal === si) this._landSeal = -1;
    if (this.bus) this.bus.emit('seal:open', { id: s.id, section: s.section, x: s.x, y: s.y, z: s.z });
    this._sync();
  }

  /** The bell: the body bounces off it; a strike at minSpeed or more rings it (and completes it once). */
  _bell(i, f, p, dt, t) {
    if (this.fxT[i] > 0) this.fxT[i] = Math.max(0, this.fxT[i] - dt);
    const dx = p.x - f.x;
    const dy = p.y - f.y;
    const dz = p.z - f.z;
    const reach = f.r + (p.radius || 0.38);
    const d2 = dx * dx + dy * dy + dz * dz;
    if (d2 >= reach * reach || d2 < 1e-10) return;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    const nz = dz / d;
    const vn = p.vx * nx + p.vy * ny + p.vz * nz;
    // out of the bell, then the closing part of the velocity reflected (the player's own swing bounces back)
    p.x = f.x + nx * reach;
    p.y = f.y + ny * reach;
    p.z = f.z + nz * reach;
    if (vn >= 0) return;
    const k = (1 + BELL_E) * vn;
    p.vx -= k * nx;
    p.vy -= k * ny;
    p.vz -= k * nz;
    const speed = -vn;
    if (speed < f.minSpeed || this.fxT[i] > 0) return;
    this.fxT[i] = BELL_GAP;
    this.fxHitT[i] = num(t, 0);
    const hl = Math.hypot(nx, nz) || 1;
    this.fxHitX[i] = -nx / hl;
    this.fxHitZ[i] = -nz / hl;
    if (this.bus) this.bus.emit('bell:ring', { id: f.id, x: f.x, y: f.y, z: f.z, speed, strength: VERB_NOISE });
    if (!this.fxDone[i] && !this.done[f.obj]) this._fixtureDone(i, t);
  }

  /** Hauling fixture i for dt (a haul or a winch): a notch per time / notches (loud), done at the last. */
  _haul(i, f, dt, t) {
    this.fxT[i] += dt;
    const per = f.time / f.notches;
    const n = Math.min(f.notches, Math.floor(this.fxT[i] / per + 1e-6));
    if (n <= this.fxN[i]) return;
    this.fxN[i] = n;
    if (n >= f.notches) {
      this._fixtureDone(i, t, VERB_NOISE);
      return;
    }
    const o = this.objectives[f.obj];
    // (the ring's position now: a winch ring moves)
    const a = f.anchor;
    if (this.bus) this.bus.emit('objective:progress', { id: o.id, fixture: f.id, verb: f.kind, k: n, of: f.notches, x: a ? a.x : f.x, y: a ? a.y : f.y, z: a ? a.z : f.z, noise: VERB_NOISE });
  }

  /** Not hauling / not lighting: a haul or a winch slips back to its last notch, a relight goes out. */
  _slip(i) {
    const f = this.fixtures[i];
    if (f.k === KIND.haul || f.k === KIND.winch) this.fxT[i] = (this.fxN[i] * f.time) / f.notches;
    else if (f.k === KIND.lamp || f.k === KIND.hook) this.fxT[i] = 0;
  }

  _lampLit(i, f, t) {
    const have = this.lantern ? num(this.lantern.lanternCharge, 1) : 1;
    if (this.lantern && typeof this.lantern.spend === 'function') this.lantern.spend(Math.min(have, f.charge));
    this._fixtureDone(i, t);
  }

  _land(p) {
    if (this._landSeal >= 0 && (p.y > this.seals[this._landSeal].top + SEAL_LAND_CLEAR || this.sealOpen[this._landSeal])) this._landSeal = -1;
    if (!p.grounded || !p.groundSolid || p.groundSolid.seal === undefined) return;
    const si = this._sealOfSolid.get(p.groundSolid);
    if (si === undefined || si === this._landSeal || this.sealOpen[si]) return;
    this._landSeal = si;
    if (this.bus) this.bus.emit('seal:land', { id: this.seals[si].id, x: p.x, y: p.y, z: p.z });
  }

  _fixtureDone(i, t, noise) {
    const f = this.fixtures[i];
    const o = this.objectives[f.obj];
    this.fxDone[i] = 1;
    const haul = f.k === KIND.haul || f.k === KIND.winch;
    if (haul) this.fxN[i] = f.notches;
    this.count[o.index]++;
    if (this.bus) {
      const a = f.anchor;
      this.bus.emit('objective:progress', {
        id: o.id,
        fixture: f.id,
        verb: f.kind,
        k: haul ? f.notches : this.count[o.index],
        of: haul ? f.notches : o.need,
        x: a ? a.x : f.x,
        y: a ? a.y : f.y,
        z: a ? a.z : f.z,
        noise: noise || 0,
      });
    }
    if (this.count[o.index] >= o.need) {
      this._complete(o, true, t);
      this._sync();
    } else if (f.anchor) this._sync();
  }

  /**
   * Marks objective `o` done and opens its seal; `loud` emits objective:done and seal:open. Done in play while the player
   * stands on that very seal (P4), the seal waits (sealWait) and opens once they are off it (step()).
   */
  _complete(o, loud, t) {
    if (this.done[o.index]) return;
    this.done[o.index] = 1;
    if (this.count[o.index] < o.need) this.count[o.index] = o.need;
    const s = this.seals[o.seal];
    const was = this.sealOpen[s.index];
    if (loud && !was && this._underFoot(s, this._player)) {
      this.sealWait[s.index] = 1;
      if (this.bus) this.bus.emit('objective:done', { id: o.id, section: o.section, verb: o.verb, sealId: s.id, time: num(t, 0), waits: true });
      return;
    }
    this.sealWait[s.index] = 0;
    this.sealOpen[s.index] = 1;
    if (!was) this.sealLoud[s.index] = loud ? 1 : 0;
    if (this._landSeal === s.index) this._landSeal = -1;
    if (loud && this.bus) {
      this.bus.emit('objective:done', { id: o.id, section: o.section, verb: o.verb, sealId: s.id, time: num(t, 0) });
      if (!was) this.bus.emit('seal:open', { id: s.id, section: s.section, x: s.x, y: s.y, z: s.z });
    }
  }

  /** Seal solids follow the open flags; the rings of undone hook / haul / winch fixtures carry `sealKey` (the view's cue). */
  _sync() {
    for (const s of this.seals) {
      const active = !this.sealOpen[s.index];
      for (let k = 0; k < s.solids.length; k++) s.solids[k].active = active;
    }
    for (let i = 0; i < this.fixtures.length; i++) {
      const f = this.fixtures[i];
      if (f.anchor) f.anchor.sealKey = this.done[f.obj] || this.fxDone[i] ? 0 : 1;
    }
  }

  // ---- bot look-ahead (verify/bot.mjs): one Float64Array per snapshot --------------------------------------------
  snapshot() {
    const s = new Float64Array(this._snapLen);
    let j = 0;
    for (let i = 0; i < this.done.length; i++) s[j++] = this.done[i];
    for (let i = 0; i < this.count.length; i++) s[j++] = this.count[i];
    for (let i = 0; i < this.fxDone.length; i++) {
      s[j++] = this.fxDone[i];
      s[j++] = this.fxT[i];
      s[j++] = this.fxN[i];
      s[j++] = this.fxHitT[i];
      s[j++] = this.fxHitX[i];
      s[j++] = this.fxHitZ[i];
    }
    for (let i = 0; i < this.sealOpen.length; i++) {
      s[j++] = this.sealOpen[i];
      s[j++] = this.sealWait[i];
    }
    for (let i = 0; i < this.laneHit.length; i++) s[j++] = this.laneHit[i];
    s[j++] = this.clock;
    s[j] = this._landSeal;
    return s;
  }

  restore(s) {
    if (!s || s.length !== this._snapLen) return false;
    let j = 0;
    for (let i = 0; i < this.done.length; i++) this.done[i] = s[j++];
    for (let i = 0; i < this.count.length; i++) this.count[i] = s[j++];
    for (let i = 0; i < this.fxDone.length; i++) {
      this.fxDone[i] = s[j++];
      this.fxT[i] = s[j++];
      this.fxN[i] = s[j++];
      this.fxHitT[i] = s[j++];
      this.fxHitX[i] = s[j++];
      this.fxHitZ[i] = s[j++];
    }
    for (let i = 0; i < this.sealOpen.length; i++) {
      this.sealOpen[i] = s[j++];
      this.sealWait[i] = s[j++];
    }
    for (let i = 0; i < this.laneHit.length; i++) this.laneHit[i] = s[j++];
    this.clock = s[j++];
    this._landSeal = s[j];
    this._pose(); // the movers and lanes are functions of the clock: the look-ahead rewinds them with it
    this._sync();
    return true;
  }

  // ---- save (meta/save.js run.objectives) ---------------------------------------------------------------------------
  /**
   * The ratchet as strings: the ids of the objectives done, then for those not done yet the ids of their fixtures done
   * (lamps lit, a bell struck) and `<haul / winch fixture id>#<notches>` for a haul or a winch part-way.
   */
  serialize() {
    const out = [];
    for (const o of this.objectives) if (this.done[o.index]) out.push(o.id);
    for (let i = 0; i < this.fixtures.length; i++) {
      const f = this.fixtures[i];
      if (this.done[f.obj]) continue;
      if (this.fxDone[i]) out.push(f.id);
      else if ((f.k === KIND.haul || f.k === KIND.winch) && this.fxN[i] > 0) out.push(`${f.id}#${this.fxN[i]}`);
    }
    return out;
  }

  /** Applies a serialize() list (unknown entries are ignored, silently: no events); returns how many were applied. */
  load(ids) {
    if (!Array.isArray(ids)) return 0;
    let n = 0;
    for (const o of this.objectives) {
      if (ids.indexOf(o.id) < 0) continue;
      this._complete(o, false);
      n++;
    }
    for (const e of ids) {
      if (typeof e !== 'string') continue;
      const h = e.indexOf('#');
      const i = this.fixtureIndex(h > 0 ? e.slice(0, h) : e);
      if (i < 0) continue;
      const f = this.fixtures[i];
      if (this.done[f.obj] || this.fxDone[i]) continue;
      if (h > 0) {
        const k = Math.round(Number(e.slice(h + 1)));
        if ((f.k !== KIND.haul && f.k !== KIND.winch) || !(k > 0)) continue;
        if (k >= f.notches) this._markFixture(i);
        else {
          this.fxN[i] = Math.max(this.fxN[i], k);
          this.fxT[i] = (this.fxN[i] * f.time) / f.notches;
        }
        n++;
      } else {
        this._markFixture(i);
        n++;
      }
    }
    this._sync();
    return n;
  }

  /** A fixture done without events (load): its objective completes silently when it was the last one needed. */
  _markFixture(i) {
    const f = this.fixtures[i];
    const o = this.objectives[f.obj];
    this.fxDone[i] = 1;
    if (f.k === KIND.haul || f.k === KIND.winch) this.fxN[i] = f.notches;
    this.count[o.index]++;
    if (this.count[o.index] >= o.need) this._complete(o, false);
  }
}
