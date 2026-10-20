/* ABYSSAL TETHER 3D — level3d.js
 * Level3D builds a playable, variant-filtered copy of LEVEL_DATA_3D and
 * answers the spatial questions the simulation asks every physics step:
 * "which solids / hazards / anchors are near this box?", "is this line of
 * sight blocked?", "what does this laser hit?".
 *
 * The level is a tall shaft, so objects are bucketed by Y (1D buckets are
 * simple and fast). Every query writes into a caller-owned scratch array and
 * allocates nothing; a per-query stamp de-duplicates objects that span
 * several buckets.
 *
 * Built objects are fresh copies, so several Level3D instances (one per run /
 * difficulty) never share mutable state such as crumbled ledges or broken
 * anchors. Pure ES module: no three.js, no DOM (Node-testable).
 *
 * Coordinates: metres, +Y up. Boxes are {minX,minY,minZ,maxX,maxY,maxZ}.
 * Sections are ordered top → bottom (yTop > yBottom).
 */

import { U } from './config3d.js';
import { LEVEL_DATA_3D } from '../data/level-data-3d.js';

/** Vertical bucket size (m). */
const BUCKET = 8;
/** Boxes are shrunk by this much for line-of-sight tests so grazing an edge never blocks. */
const LOS_INSET = 0.05;
const VARIANTS = ['normal', 'nightmare', 'abyss'];

/** Is a raw data object present in this variant (`omitIn` / `onlyIn` lists)? */
export function inVariant(o, variant) {
  if (!o) return false;
  if (Array.isArray(o.onlyIn) && o.onlyIn.length > 0 && o.onlyIn.indexOf(variant) < 0) return false;
  if (Array.isArray(o.omitIn) && o.omitIn.indexOf(variant) >= 0) return false;
  return true;
}

function num(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

/**
 * Accepts either min/max form {minX,minY,minZ,maxX,maxY,maxZ} or centre+size
 * form {x,y,z, sx,sy,sz} (also {cx,cy,cz} / {w,h,d}). Returns a normalised box
 * (min ≤ max on every axis) or null when the data is unusable.
 */
function readBox(o) {
  let minX;
  let minY;
  let minZ;
  let maxX;
  let maxY;
  let maxZ;
  if (typeof o.minX === 'number') {
    minX = o.minX;
    minY = o.minY;
    minZ = o.minZ;
    maxX = o.maxX;
    maxY = o.maxY;
    maxZ = o.maxZ;
  } else {
    const cx = num(o.cx, num(o.x, 0));
    const cy = num(o.cy, num(o.y, 0));
    const cz = num(o.cz, num(o.z, 0));
    const sx = num(o.sx, num(o.w, 1));
    const sy = num(o.sy, num(o.h, 1));
    const sz = num(o.sz, num(o.d, 1));
    minX = cx - sx / 2;
    maxX = cx + sx / 2;
    minY = cy - sy / 2;
    maxY = cy + sy / 2;
    minZ = cz - sz / 2;
    maxZ = cz + sz / 2;
  }
  const vals = [minX, minY, minZ, maxX, maxY, maxZ];
  for (let i = 0; i < 6; i++) if (typeof vals[i] !== 'number' || !isFinite(vals[i])) return null;
  return {
    minX: Math.min(minX, maxX),
    minY: Math.min(minY, maxY),
    minZ: Math.min(minZ, maxZ),
    maxX: Math.max(minX, maxX),
    maxY: Math.max(minY, maxY),
    maxZ: Math.max(minZ, maxZ),
  };
}

function normalOf(n) {
  if (!n) return { x: 0, y: -1, z: 0 };
  const x = num(n.x, 0);
  const y = num(n.y, 0);
  const z = num(n.z, 0);
  const l = Math.hypot(x, y, z);
  return l > 1e-6 ? { x: x / l, y: y / l, z: z / l } : { x: 0, y: -1, z: 0 };
}

/**
 * A Y-bucketed index. Each item occupies every bucket its [lo, hi] span
 * touches; a per-query stamp de-duplicates without allocating.
 */
class YIndex {
  constructor(items, loOf, hiOf) {
    this.items = items;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < items.length; i++) {
      lo = Math.min(lo, loOf(items[i]));
      hi = Math.max(hi, hiOf(items[i]));
    }
    if (!isFinite(lo)) {
      lo = 0;
      hi = 0;
    }
    this.base = Math.floor(lo / BUCKET);
    this.count = Math.floor(hi / BUCKET) - this.base + 1;
    this.buckets = new Array(this.count);
    for (let b = 0; b < this.count; b++) this.buckets[b] = [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      it._stamp = 0;
      const b0 = this.bucketOf(loOf(it));
      const b1 = this.bucketOf(hiOf(it));
      for (let b = b0; b <= b1; b++) this.buckets[b].push(it);
    }
    this.stamp = 0;
  }

  /** Clamped bucket index for a y coordinate. */
  bucketOf(y) {
    const b = Math.floor(y / BUCKET) - this.base;
    return b < 0 ? 0 : b >= this.count ? this.count - 1 : b;
  }

  /** Starts a new query; returns the stamp used to de-duplicate. */
  nextStamp() {
    this.stamp = (this.stamp + 1) | 0;
    if (this.stamp === 0) {
      for (let i = 0; i < this.items.length; i++) this.items[i]._stamp = 0;
      this.stamp = 1;
    }
    return this.stamp;
  }
}

export class Level3D {
  /**
   * @param {object} [data]    level description (defaults to LEVEL_DATA_3D)
   * @param {string} [variant] 'normal' | 'nightmare' | 'abyss' (Sandbox uses 'normal')
   */
  constructor(data = LEVEL_DATA_3D, variant = 'normal') {
    const d = data || {};
    this.data = d;
    this.variant = VARIANTS.indexOf(variant) >= 0 ? variant : 'normal';
    const v = this.variant;
    this.name = d.name || 'Abyssal Tether';

    // ---- sections (top → bottom) ------------------------------------------------
    const rawSections = (Array.isArray(d.sections) ? d.sections : []).slice().sort((a, b) => num(b.yTop, 0) - num(a.yTop, 0));
    this.sections = rawSections.map((s, index) => this._buildSection(s, index, v));
    if (this.sections.length === 0) {
      this.sections.push(this._buildSection({ yTop: 50, yBottom: -50 }, 0, v));
    }

    // ---- objects (ids derive from the raw index so they are stable across variants)
    this.solids = this._build(d.solids, 'sol', (o, id) => {
      const b = readBox(o);
      if (!b) return null;
      return Object.assign(b, {
        id,
        kind: o.kind || 'stone',
        section: this.sectionIndexAt((b.minY + b.maxY) / 2),
        active: true,
        load: 0,
        life: num(o.life, 1),
        fallen: false,
        tag: o.tag || null,
      });
    });
    this.hazards = this._build(d.hazards, 'haz', (o, id) => {
      const b = readBox(o);
      if (!b) return null;
      return Object.assign(b, {
        id,
        kind: o.kind || 'rebar',
        section: this.sectionIndexAt((b.minY + b.maxY) / 2),
        active: true,
        tag: o.tag || null,
        normal: o.normal ? normalOf(o.normal) : null,
      });
    });
    this.anchors = this._build(d.anchors, 'anc', (o, id) => ({
      id,
      x: num(o.x, 0),
      y: num(o.y, 0),
      z: num(o.z, 0),
      kind: o.kind === 'hook' || o.kind === 'fragile' ? o.kind : 'ring',
      normal: normalOf(o.normal),
      mount: o.mount === 'chain' ? 'chain' : 'solid', // 'chain' = hangs from a giant chain (decor)
      section: this.sectionIndexAt(num(o.y, 0)),
      tag: o.tag || 'route',
      broken: false,
      load: 0,
      life: num(o.life, 1),
    }));
    this.decor = this._build(d.decor, 'dec', (o, id) => {
      const built = Object.assign({}, o);
      delete built.omitIn;
      delete built.onlyIn;
      built.id = id;
      built.type = o.type || 'unknown';
      built.x = num(o.x, 0);
      built.y = num(o.y, 0);
      built.z = num(o.z, 0);
      built.sx = num(o.sx, 1);
      built.sy = num(o.sy, 1);
      built.sz = num(o.sz, 1);
      built.yaw = num(o.yaw, 0);
      built.section = this.sectionIndexAt(built.y);
      return built;
    });
    this.lights = this._build(d.lights, 'lit', (o, id) => ({
      id,
      x: num(o.x, 0),
      y: num(o.y, 0),
      z: num(o.z, 0),
      color: o.color || '#e0a050',
      intensity: num(o.intensity, 1),
      range: num(o.range, 12),
      flicker: num(o.flicker, 0),
      section: this.sectionIndexAt(num(o.y, 0)),
    }));

    // ---- spawn / goal / gate / bounds -----------------------------------------
    const cp0 = this.sections[0].checkpoint;
    const sp = d.spawn || cp0;
    this.spawn = { x: num(sp.x, cp0.x), y: num(sp.y, cp0.y), z: num(sp.z, cp0.z), yaw: num(sp.yaw, cp0.yaw) };
    const last = this.sections[this.sections.length - 1];
    this.goal = (d.goal && readBox(d.goal)) || { minX: -5, maxX: 5, minY: last.yBottom, maxY: last.yBottom + 4, minZ: -5, maxZ: 5 };
    this.gate = (d.gate && readBox(d.gate)) || null;
    this.stillLamp = d.stillLamp ? { x: num(d.stillLamp.x, 0), y: num(d.stillLamp.y, 0), z: num(d.stillLamp.z, 0) } : null;

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const s of this.solids) {
      minX = Math.min(minX, s.minX);
      maxX = Math.max(maxX, s.maxX);
      minZ = Math.min(minZ, s.minZ);
      maxZ = Math.max(maxZ, s.maxZ);
    }
    if (!isFinite(minX)) {
      minX = -50;
      maxX = 50;
      minZ = -50;
      maxZ = 50;
    }
    this.bounds = {
      minX,
      maxX,
      minY: Math.min(last.yBottom, this.goal.minY),
      maxY: this.sections[0].yTop,
      minZ,
      maxZ,
    };

    // ---- spatial indices --------------------------------------------------------
    this._solidIndex = new YIndex(this.solids, (s) => s.minY, (s) => s.maxY);
    this._hazardIndex = new YIndex(this.hazards, (s) => s.minY, (s) => s.maxY);
    this._anchorIndex = new YIndex(this.anchors, (a) => a.y, (a) => a.y);
    this._losScratch = [];
    this._rayScratch = [];

    this.byId = Object.create(null);
    for (const list of [this.solids, this.hazards, this.anchors, this.decor]) {
      for (const o of list) this.byId[o.id] = o;
    }
  }

  _buildSection(s, index, v) {
    const cp = s.checkpoint || {};
    const th = s.theme || {};
    const yTop = num(s.yTop, 0);
    const yBottom = num(s.yBottom, yTop - 50);
    return {
      index,
      id: s.id || `s${index + 1}`,
      name: s.name || `Section ${index + 1}`,
      subtitle: s.subtitle || '',
      yTop,
      yBottom,
      checkpoint: { x: num(cp.x, 0), y: num(cp.y, yTop), z: num(cp.z, 0), yaw: num(cp.yaw, 0) },
      theme: Object.assign({ fog: '#20262b', light: '#6fa3b5', accent: '#e0a050', fogNear: 6, fogFar: 70, ambient: 0.3 }, th),
      creature: Object.assign({ mode: 'dormant', lethal: false, speedMul: 1, burstRate: 0, spawnOffsetY: 120 }, s.creature),
      shaft: s.shaft ? Object.assign({}, s.shaft) : null,
      hints: (Array.isArray(s.hints) ? s.hints.filter((h) => inVariant(h, v)) : [])
        .map((h) => {
          const o = Object.assign({}, h);
          delete o.omitIn;
          delete o.onlyIn;
          return o;
        })
        .sort((a, b) => b.y - a.y),
      triggers: (Array.isArray(s.triggers) ? s.triggers.filter((t) => inVariant(t, v)) : [])
        .map((t) => {
          const o = Object.assign({}, t, { data: Object.assign({}, t.data) });
          delete o.omitIn;
          delete o.onlyIn;
          return o;
        })
        .sort((a, b) => b.y - a.y),
    };
  }

  /** Filters a raw list by variant and maps each survivor through `make`. */
  _build(list, prefix, make) {
    const out = [];
    if (!Array.isArray(list)) return out;
    const seen = Object.create(null);
    for (let i = 0; i < list.length; i++) {
      const o = list[i];
      if (!inVariant(o, this.variant)) continue;
      let id = typeof o.id === 'string' && o.id ? o.id : `${prefix}${i}`;
      if (seen[id]) id = `${id}#${i}`; // never hand out duplicate ids
      seen[id] = true;
      const built = make(o, id);
      if (built) out.push(built);
    }
    return out;
  }

  // ===========================================================================
  // Queries — all write into a caller-owned `out` array (cleared first).
  // ===========================================================================

  /** Solids whose AABB overlaps the box (includes inactive ones; callers check `.active !== false`). */
  querySolids(minX, minY, minZ, maxX, maxY, maxZ, out) {
    return this._queryBoxes(this._solidIndex, minX, minY, minZ, maxX, maxY, maxZ, out);
  }

  /** Hazards whose AABB overlaps the box. */
  queryHazards(minX, minY, minZ, maxX, maxY, maxZ, out) {
    return this._queryBoxes(this._hazardIndex, minX, minY, minZ, maxX, maxY, maxZ, out);
  }

  _queryBoxes(index, minX, minY, minZ, maxX, maxY, maxZ, out) {
    // Indexed writes + one length at the end: `out.length = 0` up front drops V8's
    // backing store, so every non-empty query regrew it (per-frame allocation).
    let n = 0;
    const stamp = index.nextStamp();
    const b0 = index.bucketOf(minY);
    const b1 = index.bucketOf(maxY);
    for (let b = b0; b <= b1; b++) {
      const bucket = index.buckets[b];
      for (let i = 0; i < bucket.length; i++) {
        const s = bucket[i];
        if (s._stamp === stamp) continue;
        s._stamp = stamp;
        if (s.minX > maxX || s.maxX < minX || s.minY > maxY || s.maxY < minY || s.minZ > maxZ || s.maxZ < minZ) continue;
        out[n++] = s;
      }
    }
    out.length = n;
    return out;
  }

  /** Anchors inside the bounding box of the sphere (x, y, z, r) — a superset; callers do the exact distance. */
  anchorsNear(x, y, z, r, out) {
    let n = 0; // indexed writes: see _queryBoxes
    const index = this._anchorIndex;
    const b0 = index.bucketOf(y - r);
    const b1 = index.bucketOf(y + r);
    // Point items live in exactly one bucket: no de-duplication needed.
    for (let b = b0; b <= b1; b++) {
      const bucket = index.buckets[b];
      for (let i = 0; i < bucket.length; i++) {
        const a = bucket[i];
        if (a.x < x - r || a.x > x + r || a.y < y - r || a.y > y + r || a.z < z - r || a.z > z + r) continue;
        out[n++] = a;
      }
    }
    out.length = n;
    return out;
  }

  /**
   * Line of sight: does any ACTIVE solid block the segment p0 → p1? The last
   * `endClearance` metres before p1 are ignored (an anchor bolted into a
   * ceiling is still reachable) and boxes are inset by 5 cm so grazing an
   * edge does not count.
   */
  segmentBlocked(x0, y0, z0, x1, y1, z1, endClearance) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    const clear = endClearance > 0 ? endClearance : 0;
    if (len <= clear) return false;
    const k = (len - clear) / len;
    const ex = x0 + dx * k;
    const ey = y0 + dy * k;
    const ez = z0 + dz * k;
    const list = this.querySolids(
      Math.min(x0, ex), Math.min(y0, ey), Math.min(z0, ez),
      Math.max(x0, ex), Math.max(y0, ey), Math.max(z0, ez),
      this._losScratch,
    );
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.active === false) continue;
      if (U.segmentBox(x0, y0, z0, ex, ey, ez, s, LOS_INSET) >= 0) return true;
    }
    return false;
  }

  /**
   * Nearest ACTIVE solid hit by the ray o + t·d (d need not be unit; t is in
   * metres along the normalised direction), up to maxDist. Returns
   * {t, solid, x, y, z} or null. Pass `out` to reuse a result object.
   */
  raycast(ox, oy, oz, dx, dy, dz, maxDist, out) {
    const dl = Math.hypot(dx, dy, dz);
    if (dl < 1e-9 || !(maxDist > 0)) return null;
    const ux = dx / dl;
    const uy = dy / dl;
    const uz = dz / dl;
    const ex = ox + ux * maxDist;
    const ey = oy + uy * maxDist;
    const ez = oz + uz * maxDist;
    const list = this.querySolids(
      Math.min(ox, ex), Math.min(oy, ey), Math.min(oz, ez),
      Math.max(ox, ex), Math.max(oy, ey), Math.max(oz, ez),
      this._rayScratch,
    );
    let bestT = Infinity;
    let best = null;
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.active === false) continue;
      const t = U.segmentBox(ox, oy, oz, ex, ey, ez, s, 0);
      if (t >= 0 && t < bestT) {
        bestT = t;
        best = s;
      }
    }
    if (!best) return null;
    const t = bestT * maxDist;
    const r = out || {};
    r.t = t;
    r.solid = best;
    r.x = ox + ux * t;
    r.y = oy + uy * t;
    r.z = oz + uz * t;
    return r;
  }

  /** Index of the section containing y (clamped to 0..n-1). */
  sectionIndexAt(y) {
    const list = this.sections;
    const n = list.length;
    if (n === 0) return 0;
    if (!(y < list[0].yBottom)) return 0; // also catches NaN and anything above the top
    for (let i = 1; i < n; i++) {
      if (y >= list[i].yBottom) return i;
    }
    return n - 1;
  }

  /** The section object containing y. */
  sectionAt(y) {
    return this.sections[this.sectionIndexAt(y)];
  }

  /** Inner faces of the shaft around height y: {minX,maxX,minZ,maxZ} (null if the section has none). */
  shaftAt(y) {
    return this.sectionAt(y).shaft;
  }

  /**
   * Respawn point for a death in section `sectionIndex` under a checkpoint mode:
   * 'all' → that section's checkpoint; 'alternate' → the latest section with an
   * even index ≤ sectionIndex; 'none' → spawn (index 0).
   * @returns {{x:number, y:number, z:number, yaw:number, index:number}}
   */
  checkpointFor(sectionIndex, mode) {
    const n = this.sections.length;
    let i = U.clamp(sectionIndex | 0, 0, n - 1);
    if (mode === 'none') i = 0;
    else if (mode === 'alternate') i -= i % 2;
    if (i === 0) return { x: this.spawn.x, y: this.spawn.y, z: this.spawn.z, yaw: this.spawn.yaw, index: 0 };
    const cp = this.sections[i].checkpoint;
    return { x: cp.x, y: cp.y, z: cp.z, yaw: cp.yaw, index: i };
  }

  /** Is the point inside the Still Lamp chamber's goal box? */
  inGoal(x, y, z) {
    const g = this.goal;
    return !!g && x >= g.minX && x <= g.maxX && y >= g.minY && y <= g.maxY && z >= g.minZ && z <= g.maxZ;
  }

  /** Restores crumbled ledges and broken fragile anchors for a fresh attempt. */
  reset() {
    for (let i = 0; i < this.solids.length; i++) {
      const s = this.solids[i];
      s.active = true;
      s.load = 0;
      s.fallen = false;
    }
    for (let i = 0; i < this.hazards.length; i++) this.hazards[i].active = true;
    for (let i = 0; i < this.anchors.length; i++) {
      const a = this.anchors[i];
      a.broken = false;
      a.load = 0;
    }
  }
}

Level3D.BUCKET = BUCKET;
Level3D.inVariant = inVariant;
