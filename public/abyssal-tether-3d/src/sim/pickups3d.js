/* ABYSSAL TETHER 3D — pickups3d.js
 * The supplies lying in the Underspire. level-data-3d.js authors CANDIDATE spots (`supplies`, 6-10 per section:
 * ledges, alcoves and a few risky-but-rewarding perches, each with a weight per item kind); a seeded per-run picker
 * (pickSupplies) fills about a third of them with items by rarity. Pure and deterministic: no three.js, no DOM,
 * no Math.random (U.rng(seed)), no allocation per frame.
 *
 * Selection (pickSupplies):
 *   1. per section k = round(n/3 + jitter) spots (2 .. ceil(n/2)), drawn without replacement, risky spots a little
 *      less likely, avoiding two spots of a section closer than CONFIG.bag.supplySpacing when possible;
 *   2. the kind of each by its spot weights (bandage and battery common, adrenaline uncommon, first aid rare),
 *      at most one first aid and one adrenaline per section and CONFIG.bag.maxFirstAid per run;
 *   3. FAIRNESS: at least one battery in every group of three sections and at least one healing item (bandage or
 *      first aid) in each half of the descent. A missing one converts a spot that is not itself the only one of
 *      its kind in its group, or adds one more spot.
 *
 * Collecting: the body centre within CONFIG.bag.pickupRadius (0.9 m) collects (walk or swing through); in VR a hand
 * within handRadius (0.35 m) with the grip pressed collects as well. An item the bag has no room for stays where
 * it is ('pickup:full' once per approach). Checkpoint snapshots return items collected after the checkpoint on a
 * respawn.
 *
 * Bus events: 'pickup:collect' {kind,x,y,z,id,hand}, 'pickup:full' {kind}.
 */

import { CONFIG, U } from './config3d.js';
import { ITEM, ITEM_COUNT } from './inventory3d.js';

const B = CONFIG.bag;
const TIER_PICK = { ledge: 1, alcove: 1, risk: 0.7 };

/**
 * Chooses the supplies of one run.
 * @param {Array<{x,y,z,section,tier,w:number[]}>} spots authored candidates
 * @param {number} seed
 * @param {{sections?:number, fraction?:number}} [opts]
 * @returns {Array<{spot:number, kind:number}>} sorted from the top of the descent to the bottom
 */
export function pickSupplies(spots, seed, opts = {}) {
  const rng = U.rng(seed >>> 0);
  const n = spots.length;
  let nSec = opts.sections || 0;
  for (let i = 0; i < n; i++) if (spots[i].section + 1 > nSec) nSec = spots[i].section + 1;
  const fraction = opts.fraction > 0 ? opts.fraction : B.supplyFraction;
  const chosen = []; // {spot, kind}
  const taken = new Uint8Array(n);
  const bySection = [];
  for (let s = 0; s < nSec; s++) bySection.push([]);
  for (let i = 0; i < n; i++) bySection[spots[i].section].push(i);

  const weightedIndex = (weights, total) => {
    let r = rng() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  };
  const near = (a, b, d) => {
    const dx = spots[a].x - spots[b].x;
    const dy = spots[a].y - spots[b].y;
    const dz = spots[a].z - spots[b].z;
    return dx * dx + dy * dy + dz * dz < d * d;
  };

  let firstAids = 0;
  for (let s = 0; s < nSec; s++) {
    const cand = bySection[s];
    if (!cand.length) continue;
    const want = U.clamp(Math.round(cand.length * fraction + (rng() - 0.5) * 0.9), Math.min(2, cand.length), Math.ceil(cand.length / 2));
    const picked = [];
    for (let k = 0; k < want; k++) {
      // Weighted draw without replacement, skipping spots too close to one already chosen when another is free.
      const pool = [];
      const pw = [];
      let total = 0;
      for (let i = 0; i < cand.length; i++) {
        const si = cand[i];
        if (taken[si]) continue;
        let close = false;
        for (let j = 0; j < picked.length; j++) if (near(si, picked[j], B.supplySpacing)) close = true;
        if (close) continue;
        const w = TIER_PICK[spots[si].tier] || 1;
        pool.push(si);
        pw.push(w);
        total += w;
      }
      if (!pool.length) break;
      const si = pool[weightedIndex(pw, total)];
      taken[si] = 1;
      picked.push(si);
    }
    let sectionFirstAid = 0;
    let sectionAdrenaline = 0;
    for (let j = 0; j < picked.length; j++) {
      const w = spots[picked[j]].w;
      const ws = [0, 0, 0, 0];
      let total = 0;
      for (let kd = 0; kd < ITEM_COUNT; kd++) {
        let v = w[kd] > 0 ? w[kd] : 0;
        if (kd === ITEM.FIRST_AID && (sectionFirstAid >= 1 || firstAids >= B.maxFirstAid)) v = 0;
        if (kd === ITEM.ADRENALINE && sectionAdrenaline >= 1) v = 0;
        ws[kd] = v;
        total += v;
      }
      if (total <= 0) ws[ITEM.BANDAGE] = total = 1;
      const kind = weightedIndex(ws, total);
      if (kind === ITEM.FIRST_AID) {
        sectionFirstAid++;
        firstAids++;
      } else if (kind === ITEM.ADRENALINE) sectionAdrenaline++;
      chosen.push({ spot: picked[j], kind });
    }
  }

  // ---- fairness -----------------------------------------------------------------------------
  const group3 = (s) => Math.floor(s / 3);
  const half = (s) => (s < Math.ceil(nSec / 2) ? 0 : 1);
  const heals = (c) => c.kind === ITEM.BANDAGE || c.kind === ITEM.FIRST_AID;
  const inBatteryGroup = (c, g) => group3(spots[c.spot].section) === g;
  const inHealHalf = (c, h) => half(spots[c.spot].section) === h;
  const countIn = (pred) => {
    let k = 0;
    for (let i = 0; i < chosen.length; i++) if (pred(chosen[i])) k++;
    return k;
  };
  // Sole holder of a guarantee? (converting it would break that guarantee)
  const soleBattery = (c) => c.kind === ITEM.BATTERY && countIn((o) => o.kind === ITEM.BATTERY && inBatteryGroup(o, group3(spots[c.spot].section))) <= 1;
  const soleHeal = (c) => heals(c) && countIn((o) => heals(o) && inHealHalf(o, half(spots[c.spot].section))) <= 1;
  const ensure = (inGroup, has, kind) => {
    if (countIn((c) => inGroup(c) && has(c)) > 0) return;
    const eligible = [];
    for (let i = 0; i < chosen.length; i++) {
      const c = chosen[i];
      if (inGroup(c) && !soleBattery(c) && !soleHeal(c) && c.kind !== ITEM.FIRST_AID) eligible.push(i);
    }
    if (eligible.length) {
      chosen[eligible[Math.floor(rng() * eligible.length)]].kind = kind;
      return;
    }
    // Nothing to convert: add one more spot in the group.
    const free = [];
    for (let i = 0; i < n; i++) if (!taken[i] && inGroup({ spot: i })) free.push(i);
    if (!free.length) return;
    const far = free.filter((i) => !chosen.some((c) => near(i, c.spot, B.supplySpacing)));
    const list = far.length ? far : free;
    const si = list[Math.floor(rng() * list.length)];
    taken[si] = 1;
    chosen.push({ spot: si, kind });
  };
  const groups = Math.ceil(nSec / 3);
  for (let g = 0; g < groups; g++) ensure((c) => inBatteryGroup(c, g), (c) => c.kind === ITEM.BATTERY, ITEM.BATTERY);
  for (let h = 0; h < 2; h++) ensure((c) => inHealHalf(c, h), heals, ITEM.BANDAGE);

  chosen.sort((a, b) => spots[b.spot].y - spots[a.spot].y);
  return chosen;
}

/** Does a pick satisfy the fairness rules? Returns a list of problems (empty = fair). For tests and tools. */
export function checkFairness(spots, picks, nSec) {
  const problems = [];
  const groups = Math.ceil(nSec / 3);
  for (let g = 0; g < groups; g++) {
    if (!picks.some((c) => c.kind === ITEM.BATTERY && Math.floor(spots[c.spot].section / 3) === g)) problems.push(`no battery in sections ${g * 3 + 1}-${Math.min(nSec, g * 3 + 3)}`);
  }
  const h0 = Math.ceil(nSec / 2);
  if (!picks.some((c) => (c.kind === ITEM.BANDAGE || c.kind === ITEM.FIRST_AID) && spots[c.spot].section < h0)) problems.push('no healing item in the first half');
  if (!picks.some((c) => (c.kind === ITEM.BANDAGE || c.kind === ITEM.FIRST_AID) && spots[c.spot].section >= h0)) problems.push('no healing item in the second half');
  return problems;
}

export class Pickups3D {
  /**
   * @param {Level3D} level  data.supplies holds the candidate spots
   * @param {EventBus|null} bus
   */
  constructor(level, bus) {
    this.level = level;
    this.bus = bus || null;
    this.spots = [];
    this.items = []; // {id, spot, x,y,z, kind, section, taken, takenAt, blocked, phase}
    this.time = 0;
    this.version = 0; // bumps whenever items appear / are taken / return (the view re-syncs)
    this.seed = 0;
    this._cp = new Uint8Array(0);
    this.setLevel(level);
  }

  /** Reads the authored spots of a (new) level. */
  setLevel(level) {
    this.level = level;
    const src = level && level.data && Array.isArray(level.data.supplies) ? level.data.supplies : [];
    this.spots = [];
    for (let i = 0; i < src.length; i++) {
      const s = src[i];
      const section = level.sectionIndexAt ? Math.max(0, level.sectionIndexAt(s.y)) : s.section | 0;
      this.spots.push({ id: s.id || `sup-${i}`, x: s.x, y: s.y, z: s.z, section, tier: s.tier || 'ledge', w: s.w || [0, 1, 0, 0] });
    }
    this.items.length = 0;
    this.version++;
  }

  /** A new run: pick the supplies for `seed`. */
  reset(seed) {
    this.seed = seed >>> 0;
    this.time = 0;
    const nSec = this.level && this.level.sections ? this.level.sections.length : 0;
    const picks = pickSupplies(this.spots, this.seed, { sections: nSec });
    this.items.length = 0;
    for (let i = 0; i < picks.length; i++) {
      const sp = this.spots[picks[i].spot];
      this.items.push({
        id: sp.id,
        spot: picks[i].spot,
        x: sp.x,
        y: sp.y,
        z: sp.z,
        kind: picks[i].kind,
        section: sp.section,
        taken: false,
        takenAt: -1e9,
        blocked: false,
        phase: (i * 2.399963) % (Math.PI * 2),
      });
    }
    this._cp = new Uint8Array(this.items.length);
    this.version++;
  }

  /**
   * Collects what the player reaches.
   * @param {number} dt
   * @param {{x,y,z}} p the body centre
   * @param {Inventory3D} inv
   * @param {{x,y,z,grip,ok}|null} [handA] a hand position with its grip value (VR), ok=false when untracked
   * @param {{x,y,z,grip,ok}|null} [handB]
   * @returns {number} items collected this call
   */
  update(dt, p, inv, handA = null, handB = null) {
    this.time += dt;
    const items = this.items;
    let got = 0;
    const R2 = B.pickupRadius * B.pickupRadius;
    const H2 = B.handRadius * B.handRadius;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.taken) continue;
      const dy = it.y - p.y;
      if (dy > 3 || dy < -3) {
        it.blocked = false;
        continue;
      }
      const dx = it.x - p.x;
      const dz = it.z - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      let by = 0; // 0 none, 1 body, 2 hand
      if (d2 < R2) by = 1;
      else if (handA && handA.ok && handA.grip >= B.handGrip && sq3(it, handA) < H2) by = 2;
      else if (handB && handB.ok && handB.grip >= B.handGrip && sq3(it, handB) < H2) by = 2;
      if (!by) {
        if (it.blocked && d2 > (B.pickupRadius + 0.6) * (B.pickupRadius + 0.6)) it.blocked = false;
        continue;
      }
      if (!inv.canAdd(it.kind)) {
        if (!it.blocked) {
          it.blocked = true;
          if (this.bus) this.bus.emit('pickup:full', { kind: it.kind });
        }
        continue;
      }
      inv.add(it.kind, 1);
      it.taken = true;
      it.takenAt = this.time;
      got++;
      this.version++;
      if (this.bus) this.bus.emit('pickup:collect', { kind: it.kind, x: it.x, y: it.y, z: it.z, id: it.id, hand: by === 2 ? 1 : 0 });
    }
    return got;
  }

  /** Remembers which items are taken (a checkpoint). */
  snapshot() {
    const items = this.items;
    if (this._cp.length !== items.length) this._cp = new Uint8Array(items.length);
    for (let i = 0; i < items.length; i++) this._cp[i] = items[i].taken ? 1 : 0;
  }

  /** Puts back what was taken after the last snapshot (a respawn). */
  restore() {
    const items = this.items;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const was = i < this._cp.length ? this._cp[i] === 1 : false;
      if (it.taken && !was) {
        it.taken = false;
        it.takenAt = -1e9;
      }
      it.blocked = false;
    }
    this.version++;
  }

  /** Items still lying around. */
  get remaining() {
    let n = 0;
    for (let i = 0; i < this.items.length; i++) if (!this.items[i].taken) n++;
    return n;
  }

  /** Debug / tests: drops an item of `kind` at a position (appended; it joins the snapshots from the next one). */
  spawnAt(kind, x, y, z) {
    const it = { id: `dbg-${this.items.length}`, spot: -1, x, y, z, kind, section: this.level && this.level.sectionIndexAt ? Math.max(0, this.level.sectionIndexAt(y)) : 0, taken: false, takenAt: -1e9, blocked: false, phase: 0 };
    this.items.push(it);
    this.version++;
    return it;
  }
}

function sq3(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}
