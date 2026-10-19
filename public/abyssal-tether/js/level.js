/* ABYSSAL TETHER — level.js
 * AT.Level builds a playable, variant-filtered copy of AT.LEVEL_DATA and
 * answers the spatial questions the simulation asks every physics step:
 * "which solids / hazards / anchors / decor are near this box?" and "is this
 * line of sight blocked?". Objects are bucketed by y (the level is a tall,
 * narrow shaft, so 1D buckets are both simple and fast). All queries write
 * into caller-owned scratch arrays and allocate nothing.
 *
 * Built objects are fresh copies, so several Level instances (one per run /
 * difficulty) never share mutable state such as crumbled platforms or broken
 * anchors. DOM-free: loadable from Node for verification tooling.
 */
(function (AT) {
  'use strict';

  const U = AT.util;

  /** Vertical bucket size in world units (CONTRACT §4.2). */
  const BUCKET = 256;
  /** Rects are shrunk by this much for line-of-sight tests so grazing an edge never blocks. */
  const LOS_INSET = 1;
  /**
   * Parallax factor of each decor layer (exposed as `level.parallax`; data may override
   * via `LEVEL_DATA.parallax`). Decor is converted into these layer spaces once at build
   * time (see `_buildDecor`), so renderers draw it with `camera.applyTransform(ctx, p)`
   * and cull it with `camera.visibleRect(margin, p)` + `decorInRect(…, layer, out)`.
   */
  const DEFAULT_PARALLAX = { far: 0.25, mid: 0.6, near: 1.2 };
  /** Decor layer names (CONTRACT §4.1). Unknown layers fall back to 'mid'. */
  const DECOR_LAYERS = ['far', 'mid', 'near'];

  /** Is a raw data object present in this variant (`omitIn` / `onlyIn` lists)? */
  function inVariant(o, variant) {
    if (!o) return false;
    if (Array.isArray(o.onlyIn) && o.onlyIn.length > 0 && o.onlyIn.indexOf(variant) < 0) return false;
    if (Array.isArray(o.omitIn) && o.omitIn.indexOf(variant) >= 0) return false;
    return true;
  }

  function num(v, fallback) {
    return typeof v === 'number' && isFinite(v) ? v : fallback;
  }

  /**
   * A y-bucketed index of objects. Each object occupies every bucket its
   * [top, bottom] span touches; a per-query stamp de-duplicates objects that
   * span several buckets without allocating.
   */
  class YIndex {
    constructor(items, topOf, bottomOf) {
      this.items = items;
      let minY = Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < items.length; i++) {
        const t = topOf(items[i]);
        const b = bottomOf(items[i]);
        if (t < minY) minY = t;
        if (b > maxY) maxY = b;
      }
      if (!isFinite(minY)) {
        minY = 0;
        maxY = 0;
      }
      this.base = Math.floor(minY / BUCKET);
      this.count = Math.floor(maxY / BUCKET) - this.base + 1;
      this.buckets = new Array(this.count);
      for (let b = 0; b < this.count; b++) this.buckets[b] = [];
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        it._stamp = 0;
        const b0 = this.bucketOf(topOf(it));
        const b1 = this.bucketOf(bottomOf(it));
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
        // Wrapped (after ~2^32 queries): clear every stamp once.
        for (let i = 0; i < this.items.length; i++) this.items[i]._stamp = 0;
        this.stamp = 1;
      }
      return this.stamp;
    }
  }

  class Level {
    /**
     * @param {object} [data]    level description (defaults to AT.LEVEL_DATA)
     * @param {string} [variant] 'normal' | 'nightmare' | 'abyss' (sandbox uses 'normal')
     */
    constructor(data, variant) {
      this.data = data || AT.LEVEL_DATA || {};
      this.variant = variant || 'normal';
      const d = this.data;
      const v = this.variant;

      this.name = d.name || 'Abyssal Tether';
      this.width = num(d.width, 1800);
      this.parallax = Object.assign({}, DEFAULT_PARALLAX, d.parallax || {});
      this.chamber = d.chamber ? Object.assign({}, d.chamber) : null;

      // ---- sections -----------------------------------------------------------
      const rawSections = Array.isArray(d.sections) ? d.sections : [];
      this.sections = rawSections.map((s, index) => ({
        index,
        id: s.id || `s${index + 1}`,
        name: s.name || `Section ${index + 1}`,
        subtitle: s.subtitle || '',
        y0: num(s.y0, 0),
        y1: num(s.y1, 0),
        checkpoint: { x: num(s.checkpoint && s.checkpoint.x, 0), y: num(s.checkpoint && s.checkpoint.y, 0) },
        theme: Object.assign({ fog: '#20262b', light: '#6fa3b5', accent: '#e0a050', fogDensity: 0.5, darkness: 0.5 }, s.theme),
        creature: Object.assign({ mode: 'dormant', lethal: false, speedMul: 1, burstRate: 0, spawnOffsetY: -1200 }, s.creature),
        hints: (Array.isArray(s.hints) ? s.hints.filter((h) => inVariant(h, v)) : [])
          .map((h) => Object.assign({}, h))
          .sort((a, b) => a.y - b.y),
        triggers: (Array.isArray(s.triggers) ? s.triggers.filter((t) => inVariant(t, v)) : [])
          .map((t) => Object.assign({}, t, { data: Object.assign({}, t.data) }))
          .sort((a, b) => a.y - b.y),
      }));
      if (this.sections.length === 0) {
        this.sections.push({
          index: 0, id: 's1', name: 'Section 1', subtitle: '', y0: 0, y1: num(d.bottom, 1000),
          checkpoint: { x: 0, y: 0 }, theme: {}, creature: { mode: 'dormant', lethal: false, speedMul: 1, burstRate: 0, spawnOffsetY: -1200 },
          hints: [], triggers: [],
        });
      }

      const top = this.sections[0].y0;
      const bottom = num(d.bottom, this.sections[this.sections.length - 1].y1);
      this.bounds = { x0: 0, y0: top, x1: this.width, y1: bottom };
      this.spawn = d.spawn ? { x: d.spawn.x, y: d.spawn.y } : { x: this.sections[0].checkpoint.x, y: this.sections[0].checkpoint.y };
      this.goal = d.goal ? Object.assign({}, d.goal) : { x: 0, y: bottom - 100, w: this.width, h: 100 };
      this.gate = d.gate ? Object.assign({}, d.gate) : null;

      // ---- objects (ids derive from the raw index so they are stable across variants)
      this.solids = this._build(d.solids, 'sol', (o, id) => ({
        id,
        x: o.x, y: o.y, w: o.w, h: o.h,
        kind: o.kind || 'stone',
        section: this.sectionIndexAt(o.y + o.h * 0.5),
        active: true,
        load: 0,
        life: num(o.life, 1),
        fallen: false,
        tag: o.tag || null,
      }));
      this.hazards = this._build(d.hazards, 'haz', (o, id) => ({
        id,
        x: o.x, y: o.y, w: o.w, h: o.h,
        kind: o.kind || 'rebar',
        section: this.sectionIndexAt(o.y + o.h * 0.5),
        active: true,
        load: 0,
        life: num(o.life, 1),
        fallen: false,
        tag: o.tag || null,
      }));
      this.anchors = this._build(d.anchors, 'anc', (o, id) => ({
        id,
        x: o.x, y: o.y,
        kind: o.kind || 'ring',
        section: this.sectionIndexAt(o.y),
        tag: o.tag || null,
        broken: false,
        load: 0,
        life: num(o.life, 1),
        active: true,
      }));
      this.decor = this._build(d.decor, 'dec', (o, id) => this._buildDecor(o, id));

      // ---- spatial indices -------------------------------------------------------
      this._solidIndex = new YIndex(this.solids, (s) => s.y, (s) => s.y + s.h);
      this._hazardIndex = new YIndex(this.hazards, (s) => s.y, (s) => s.y + s.h);
      this._anchorIndex = new YIndex(this.anchors, (a) => a.y, (a) => a.y);
      this._decorIndex = {};
      for (const layer of DECOR_LAYERS) {
        const items = this.decor.filter((o) => o.layer === layer);
        this._decorIndex[layer] = new YIndex(items, (o) => o.y, (o) => o.y + o.h);
      }
      this._losScratch = [];

      this.byId = Object.create(null);
      for (const list of [this.solids, this.hazards, this.anchors, this.decor]) {
        for (const o of list) this.byId[o.id] = o;
      }
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

    /**
     * Decor is authored in WORLD space ("where you would see it at parallax 1").
     * Renderers draw a layer with the contract's offset-only parallax
     *   screen = (x − cam.x·p)·scale + W/2,
     * so we convert each item to that layer's space once here: an item is centred
     * on screen exactly when the camera is centred (horizontally on the shaft's
     * middle, vertically on the item). `wx`/`wy` keep the authored world anchor.
     */
    _buildDecor(o, id) {
      const layer = DECOR_LAYERS.indexOf(o.layer) >= 0 ? o.layer : 'mid';
      const w = num(o.w, 40);
      const h = num(o.h, 40);
      const built = Object.assign({}, o);
      delete built.omitIn;
      delete built.onlyIn;
      const p = num(this.parallax[layer], 1);
      const cx = num(o.x, 0) + w * 0.5;
      const cy = num(o.y, 0) + h * 0.5;
      const refX = this.width * 0.5;
      built.id = id;
      built.layer = layer;
      built.w = w;
      built.h = h;
      built.wx = num(o.x, 0);
      built.wy = num(o.y, 0);
      built.parallax = p;
      built.x = cx - refX * (1 - p) - w * 0.5;
      built.y = cy * p - h * 0.5;
      built.seed = num(o.seed, (U.hash(cx * 7 + cy * 13) * 100000) | 0);
      built.section = this.sectionIndexAt(cy);
      return built;
    }

    // =========================================================================
    // Queries — all write into a caller-owned `out` array (cleared first).
    // =========================================================================

    /** Solids whose AABB overlaps the box (includes inactive ones; caller checks `.active !== false`). */
    querySolids(x0, y0, x1, y1, out) {
      return this._queryRects(this._solidIndex, x0, y0, x1, y1, out);
    }

    /** Hazards whose AABB overlaps the box. */
    queryHazards(x0, y0, x1, y1, out) {
      return this._queryRects(this._hazardIndex, x0, y0, x1, y1, out);
    }

    _queryRects(index, x0, y0, x1, y1, out) {
      out.length = 0;
      const stamp = index.nextStamp();
      const b0 = index.bucketOf(y0);
      const b1 = index.bucketOf(y1);
      for (let b = b0; b <= b1; b++) {
        const bucket = index.buckets[b];
        for (let i = 0; i < bucket.length; i++) {
          const s = bucket[i];
          if (s._stamp === stamp) continue;
          s._stamp = stamp;
          if (s.x > x1 || s.x + s.w < x0 || s.y > y1 || s.y + s.h < y0) continue;
          out.push(s);
        }
      }
      return out;
    }

    /** Anchors inside the bounding box of the circle (x, y, r) — a superset; caller does exact distance. */
    anchorsNear(x, y, r, out) {
      out.length = 0;
      const index = this._anchorIndex;
      const b0 = index.bucketOf(y - r);
      const b1 = index.bucketOf(y + r);
      const x0 = x - r;
      const x1 = x + r;
      const y0 = y - r;
      const y1 = y + r;
      // Point items live in exactly one bucket, so no de-duplication is needed.
      for (let b = b0; b <= b1; b++) {
        const bucket = index.buckets[b];
        for (let i = 0; i < bucket.length; i++) {
          const a = bucket[i];
          if (a.x < x0 || a.x > x1 || a.y < y0 || a.y > y1) continue;
          out.push(a);
        }
      }
      return out;
    }

    /** Decor items of one layer overlapping the box (box given in that layer's space). */
    decorInRect(x0, y0, x1, y1, layer, out) {
      const index = this._decorIndex[layer];
      if (!index) {
        out.length = 0;
        return out;
      }
      return this._queryRects(index, x0, y0, x1, y1, out);
    }

    /**
     * Line of sight: does any ACTIVE solid block the segment (x0,y0)→(x1,y1)?
     * The last `endClearance` units before (x1,y1) are ignored (an anchor bolted
     * into a ceiling is still reachable) and rects are inset by 1u so grazing a
     * corner does not count.
     */
    segmentBlocked(x0, y0, x1, y1, endClearance) {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const len = Math.hypot(dx, dy);
      const clear = endClearance > 0 ? endClearance : 0;
      if (len <= clear) return false;
      const k = (len - clear) / len;
      const ex = x0 + dx * k;
      const ey = y0 + dy * k;
      const list = this.querySolids(
        Math.min(x0, ex), Math.min(y0, ey), Math.max(x0, ex), Math.max(y0, ey), this._losScratch,
      );
      for (let i = 0; i < list.length; i++) {
        const s = list[i];
        if (s.active === false) continue;
        if (U.segmentRect(x0, y0, ex, ey, s, LOS_INSET) >= 0) return true;
      }
      return false;
    }

    /** Index of the section containing y (clamped to 0..n-1). */
    sectionIndexAt(y) {
      const list = this.sections;
      const n = list.length;
      if (n === 0) return 0;
      if (!(y >= list[0].y0)) return 0; // also catches NaN
      for (let i = 0; i < n; i++) {
        if (y < list[i].y1) return i;
      }
      return n - 1;
    }

    /** The section object containing y. */
    sectionAt(y) {
      return this.sections[this.sectionIndexAt(y)];
    }

    /**
     * Respawn point for a death in section `sectionIndex` under a checkpoint mode:
     * 'all' → that section's checkpoint; 'alternate' → the latest section with an
     * even index ≤ sectionIndex; 'none' → spawn (index 0).
     * @returns {{x:number, y:number, index:number}}
     */
    checkpointFor(sectionIndex, mode) {
      const n = this.sections.length;
      let i = U.clamp(sectionIndex | 0, 0, n - 1);
      if (mode === 'none') return { x: this.spawn.x, y: this.spawn.y, index: 0 };
      if (mode === 'alternate') i -= i % 2;
      if (i === 0) return { x: this.spawn.x, y: this.spawn.y, index: 0 };
      const cp = this.sections[i].checkpoint;
      return { x: cp.x, y: cp.y, index: i };
    }

    /** Is the point inside the safe chamber's goal rect? */
    inGoal(x, y) {
      const g = this.goal;
      return !!g && x >= g.x && x <= g.x + g.w && y >= g.y && y <= g.y + g.h;
    }

    /** Restores crumbled platforms and broken fragile anchors for a fresh attempt. */
    reset() {
      for (let i = 0; i < this.solids.length; i++) {
        const s = this.solids[i];
        s.active = true;
        s.load = 0;
        s.fallen = false;
      }
      for (let i = 0; i < this.hazards.length; i++) {
        const h = this.hazards[i];
        h.active = true;
        h.load = 0;
        h.fallen = false;
      }
      for (let i = 0; i < this.anchors.length; i++) {
        const a = this.anchors[i];
        a.broken = false;
        a.load = 0;
      }
    }
  }

  Level.BUCKET = BUCKET;
  Level.inVariant = inVariant;
  AT.Level = Level;
})((window.AT = window.AT || {}));
