/* ABYSSAL TETHER 3D — skitter3d.js (WP-SKITTER)
 * SkitterGroup — the Ossuary Column's little kin: up to MAX_ALIVE "skitterlings", each one a Creature3D with
 * `variant: 'skitterling'` (0.45 scale, exactly 4.5x the Mason's pursuit / crawl / burst speeds, a 1.5x shorter wind-up and a
 * shorter reach, a hit that costs health instead of ending the run — see CREATURE_VARIANTS in creature3d.js).
 *
 * Spawns are data-driven: a section's `creature.skitter = { normal, nightmare, abyss }` (level-data-3d.js; S6 1, S7 1-2, S8 1-2); on
 * Nightmare / Abyss one more comes up from BELOW at a random time (SKITTER.below, slot 2).
 * Deterministic (per-slot seeds from the run seed). A slot enters play through the same _enterPlay as the Mason: >= 28 m ABOVE
 * the player with a grace period, so it never starts inside the checkpoint / safe radius (SAFE_RADIUS is asserted on entry).
 * DOM-free, three.js-free. The route bots / verify tools do not instantiate it (game.js owns the group), so the pass/fail
 * pacing of the Mason is unchanged.
 */
import { Creature3D, CREATURE_VARIANTS } from './creature3d.js';

export const SKITTER = {
  maxAlive: 3, // slots: dataSlots from the section data (above the player) + the one that comes up from below
  dataSlots: 2,
  safeRadius: 26, // m: a skitterling never begins closer than this to the player / the checkpoint they are standing at
  hurtCooldown: 1.5, // s after a hit during which further skitterling hits do nothing (a bite is an event, not a drain)
  extraOffset: 16, // slot 1 spawns this much higher than slot 0 (they arrive one after the other)
  lethalOnly: true, // only in lethal creature sections (S5 'stalk' and up) and only where the data asks for it
  // The extra one (Nightmare and Abyss, in the sections that have skitterlings at all): it enters play at a random moment, on a random wall,
  // a random distance BELOW the player, and hunts upward. delay: seconds after the player enters the section (or respawns); offset: metres
  // below the player (>= safeRadius), the hunt's own rubber band keeps it from falling hopelessly behind.
  below: { difficulties: { nightmare: true, abyss: true }, delay: [5, 16], delayBy: { abyss: [3, 9] }, offset: [32, 48] },
  // A bite also costs grip (the fraction of grip stamina it takes, climb3d.bite): hanging, a bite is a fall risk, not only lost health.
  gripBite: { normal: 0.2, nightmare: 0.3, abyss: 0.4 },
};

function hashSeed(seed, slot) {
  let h = (seed ^ Math.imul(slot + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** Skitterlings wanted in `section` on difficulty `diffKey` ('normal' | 'nightmare' | 'abyss'), 0..maxAlive. */
export function skitterCount(section, diffKey) {
  const s = section && section.creature && section.creature.skitter;
  if (!s) return 0;
  const n = typeof s === 'number' ? s : s[diffKey];
  return n > 0 ? Math.min(SKITTER.dataSlots, n | 0) : 0;
}

/** Health fraction a skitterling hit costs on this difficulty key. */
export function skitterDamage(diffKey) {
  const d = CREATURE_VARIANTS.skitterling.hitDamage;
  return d[diffKey] != null ? d[diffKey] : d.normal;
}

export class SkitterGroup {
  /**
   * @param {Level3D} level
   * @param {object} diff  DIFFICULTY[key]
   * @param {EventBus} bus
   * @param {{seed?:number, enabled?:boolean}} [options]
   */
  constructor(level, diff, bus, options) {
    const o = options || {};
    this.level = level;
    this.diff = diff || {};
    this.enabled = o.enabled !== false && !!level && (!diff || !diff.creature || diff.creature.enabled !== false);
    this.seed = (o.seed | 0) >>> 0;
    this.slots = [];
    this.sectionIndex = -1;
    this.pendingDamage = 0;
    this.pendingGrip = 0;
    this._hurt = 0;
    this.hits = 0;
    this.spawned = 0;
    this.minSpawnDistance = Infinity;
    this._tuneKey = null;
    this._belowT = -1; // seconds until the slot-2 skitterling enters from below (-1: none pending)
    this._belowRng = hashSeed(this.seed, 99);
    if (!this.enabled) return;
    for (let i = 0; i < SKITTER.maxAlive; i++) {
      const c = new Creature3D(level, diff, bus, { seed: hashSeed(this.seed, i), variant: 'skitterling' });
      c.active = false;
      c.body.visible = false;
      c.on = false;
      this.slots.push(c);
    }
    this._tuneKey = this.slots[0].tuneKey;
  }

  /** The live creatures (for views / audio): index-stable, `on` marks the ones in play. */
  get creatures() {
    return this.slots;
  }

  get aliveCount() {
    let n = 0;
    for (const c of this.slots) if (c.on) n++;
    return n;
  }

  /** Back to the start of a run (all slots off). */
  reset() {
    this.sectionIndex = -1;
    this._belowT = -1;
    this.pendingDamage = 0;
    this.pendingGrip = 0;
    for (const c of this.slots) this._off(c);
  }

  _off(c) {
    c.on = false;
    c.active = false;
    c.hitPlayer = false;
    c.body.visible = false;
  }

  _on(c, slot, player, sec, index) {
    c.active = true;
    c.on = true;
    c.reset(null); // far, dormant
    const cr = sec && sec.creature ? sec.creature : {};
    // slot 1 comes in higher: the pair is staggered, never abreast
    const over = Object.assign({}, sec, { creature: Object.assign({}, cr, { spawnOffsetY: Math.abs(cr.spawnOffsetY || 100) + slot * SKITTER.extraOffset }) });
    c.setSection(index, over, player);
    if (player) {
      const d = Math.hypot(c.x - player.x, c.y - player.y, c.z - player.z);
      this.minSpawnDistance = Math.min(this.minSpawnDistance, d);
    }
    this.spawned++;
  }

  _belowRand() {
    // mulberry32 on the group's own state: deterministic per run seed, independent of the creatures' streams
    this._belowRng = (this._belowRng + 0x6d2b79f5) >>> 0;
    let t = this._belowRng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  _belowOn() {
    return !!(SKITTER.below.difficulties[this._tuneKey] && this.slots.length > SKITTER.dataSlots);
  }

  /** The extra skitterling enters play 32-48 m below the player, on a random wall (the creature's own seeded choice), hunting upward. */
  _spawnBelow(player, index) {
    const c = this.slots[SKITTER.dataSlots];
    if (!c || c.on || !player) return;
    const lv = this.level;
    const sec = lv && lv.sections ? lv.sections[index] : null;
    const [lo, hi] = SKITTER.below.offset;
    const off = lo + this._belowRand() * (hi - lo);
    c.active = true;
    c.on = true;
    c.reset(null);
    const cr = sec && sec.creature ? sec.creature : {};
    const over = Object.assign({}, sec, { creature: Object.assign({}, cr, { spawnOffsetY: off, spawnBelow: true }) });
    c.setSection(index, over, player);
    const d = Math.hypot(c.x - player.x, c.y - player.y, c.z - player.z);
    this.minSpawnDistance = Math.min(this.minSpawnDistance, d);
    this.spawned++;
    this.belowSpawns = (this.belowSpawns || 0) + 1;
  }

  /** The player's section changed (or a warp / respawn put them somewhere): bring slots in or out per the data. */
  setSection(index, player) {
    if (!this.enabled) return;
    const lv = this.level;
    const sec = lv && lv.sections ? lv.sections[index] : null;
    const prev = this.sectionIndex;
    this.sectionIndex = index;
    const want = skitterCount(sec, this._tuneKey);
    // the one from below: wherever the section has skitterlings at all, on the harder difficulties, at a random moment
    const below = this.slots.length > SKITTER.dataSlots ? this.slots[SKITTER.dataSlots] : null;
    if (below) {
      if (want > 0 && this._belowOn()) {
        if (!below.on && this._belowT < 0) {
          const dl = SKITTER.below.delayBy[this._tuneKey] || SKITTER.below.delay;
          this._belowT = dl[0] + this._belowRand() * (dl[1] - dl[0]);
        }
      } else {
        this._belowT = -1;
        if (below.on) this._off(below);
      }
    }
    for (let i = 0; i < SKITTER.dataSlots && i < this.slots.length; i++) {
      const c = this.slots[i];
      if (i < want) {
        if (!c.on) this._on(c, i, player, sec, index);
      } else if (c.on && index < prev) {
        // climbing back above the data: they go with the hunt state of the Mason (a dormant section sends them away)
        this._off(c);
      } else if (c.on && want === 0) this._off(c);
    }
  }

  /** Debug / QA: put `n` real skitterlings in play above the player whatever the section data says (hunt mode). */
  force(n, player) {
    if (!this.enabled || !player) return 0;
    const index = this.level.sectionIndexAt(player.y);
    const sec = { creature: { mode: 'hunt', lethal: true, speedMul: 1, burstRate: 0, spawnOffsetY: 40 } };
    for (let i = 0; i < this.slots.length; i++) {
      const c = this.slots[i];
      this._off(c);
      if (i < n) this._on(c, i, player, sec, index);
    }
    return this.aliveCount;
  }

  /** Respawn at a checkpoint: every live slot reappears 40-55 m above with grace (Creature3D.onRespawn). */
  onRespawn(player) {
    if (!this.enabled) return;
    const lv = this.level;
    const index = lv && player ? lv.sectionIndexAt(player.y) : this.sectionIndex;
    for (const c of this.slots) this._off(c);
    this.sectionIndex = -1;
    this.setSection(index, player);
  }

  update(dt, player, time) {
    if (!this.enabled) return;
    if (this._hurt > 0) this._hurt -= dt;
    if (this._belowT >= 0) {
      this._belowT -= dt;
      if (this._belowT < 0) {
        if (player && player.alive !== false && this.sectionIndex >= 0) {
          this._belowT = -1;
          this._spawnBelow(player, this.sectionIndex);
        } else this._belowT = 1; // not now (the player is down): try again in a second
      }
    }
    for (let i = 0; i < this.slots.length; i++) {
      const c = this.slots[i];
      if (!c.on) continue;
      c.update(dt, player, time);
      if (c.hitPlayer) {
        c.hitPlayer = false;
        if (this._hurt > 0) continue;
        this._hurt = SKITTER.hurtCooldown;
        this.pendingDamage += skitterDamage(this._tuneKey);
        this.pendingGrip += SKITTER.gripBite[this._tuneKey] || 0;
        this.hits++;
      }
    }
  }

  /** Grip stamina fraction (0..1) the bites took since the last call. */
  takeGripDamage() {
    const g = this.pendingGrip;
    this.pendingGrip = 0;
    return g;
  }

  /** Health fraction (0..1) the skitterlings took off the player since the last call. */
  takeDamage() {
    const d = this.pendingDamage;
    this.pendingDamage = 0;
    return d;
  }

  destroy() {
    for (const c of this.slots) if (typeof c.destroy === 'function') c.destroy();
    this.slots.length = 0;
  }
}
