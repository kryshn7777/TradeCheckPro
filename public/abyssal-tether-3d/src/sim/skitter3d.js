/* ABYSSAL TETHER 3D — skitter3d.js (WP-SKITTER)
 * SkitterGroup — the Ossuary Column's little kin: up to MAX_ALIVE "skitterlings", each one a Creature3D with
 * `variant: 'skitterling'` (0.45 scale, exactly 1.5x the Mason's pursuit / crawl / burst speeds, a 1.5x shorter wind-up and a
 * shorter reach, a hit that costs health instead of ending the run — see CREATURE_VARIANTS in creature3d.js).
 *
 * Spawns are data-driven: a section's `creature.skitter = { normal, nightmare, abyss }` (level-data-3d.js; S6 1, S7 1-2, S8 1-2).
 * Deterministic (per-slot seeds from the run seed). A slot enters play through the same _enterPlay as the Mason: >= 28 m ABOVE
 * the player with a grace period, so it never starts inside the checkpoint / safe radius (SAFE_RADIUS is asserted on entry).
 * DOM-free, three.js-free. The route bots / verify tools do not instantiate it (game.js owns the group), so the pass/fail
 * pacing of the Mason is unchanged.
 */
import { Creature3D, CREATURE_VARIANTS } from './creature3d.js';

export const SKITTER = {
  maxAlive: 2,
  safeRadius: 26, // m: a skitterling never begins closer than this to the player / the checkpoint they are standing at
  extraOffset: 16, // slot 1 spawns this much higher than slot 0 (they arrive one after the other)
  lethalOnly: true, // only in lethal creature sections (S5 'stalk' and up) and only where the data asks for it
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
  return n > 0 ? Math.min(SKITTER.maxAlive, n | 0) : 0;
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
    this.hits = 0;
    this.spawned = 0;
    this.minSpawnDistance = Infinity;
    this._tuneKey = null;
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
    this.pendingDamage = 0;
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

  /** The player's section changed (or a warp / respawn put them somewhere): bring slots in or out per the data. */
  setSection(index, player) {
    if (!this.enabled) return;
    const lv = this.level;
    const sec = lv && lv.sections ? lv.sections[index] : null;
    const prev = this.sectionIndex;
    this.sectionIndex = index;
    const want = skitterCount(sec, this._tuneKey);
    for (let i = 0; i < this.slots.length; i++) {
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
    for (let i = 0; i < this.slots.length; i++) {
      const c = this.slots[i];
      if (!c.on) continue;
      c.update(dt, player, time);
      if (c.hitPlayer) {
        c.hitPlayer = false;
        this.pendingDamage += skitterDamage(this._tuneKey);
        this.hits++;
      }
    }
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
