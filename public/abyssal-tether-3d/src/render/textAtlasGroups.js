/* ABYSSAL TETHER 3D — textAtlasGroups.js
 * Flat text quads on the level's faces, drawn from canvas atlases that exist only near the player: the carved boards beyond
 * the plaques (render/boardWriting.js, data/board-writing-3d.js) and the opt-in blood writing (render/bloodWriting.js).
 *
 * Entries are grouped (`e.group || e.section`). A group gets its atlas and its ONE merged mesh (one draw call) only while the
 * head is within `buildDist` of one of its quads; the cells are drawn `cellsPerFrame` at a time (no frame hitch), the mesh
 * appears when the atlas is complete and is dropped (geometry, material, atlas freed) beyond `dropDist`. It is drawn only
 * while one of its quads is within `viewDist` (x the view's detail scale). So the whole level's text costs at most the
 * groups around the player (one or two atlases, one or two draw calls), never the shaft's.
 * Nothing here is a level object: no collider, anchor, climb surface, bake, lightmap / GI hash, dressing keep-out or verify
 * count. DOM-free at import (a canvas factory is injected for Node tests).
 */

import * as THREE from 'three';

export function defaultCanvas(w, h) {
  if (typeof document === 'undefined' || !document.createElement) return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

/** Shelf packing in order: cells [x, y, w, h] in an atlas `atlasW` wide; its height is the sum of the shelves (x4). */
export function packCells(sizes, atlasW) {
  const cells = [];
  let x = 0;
  let y = 0;
  let shelf = 0;
  for (const [w, h] of sizes) {
    if (x > 0 && x + w > atlasW) {
      y += shelf;
      x = 0;
      shelf = 0;
    }
    cells.push([x, y, w, h]);
    x += w;
    shelf = Math.max(shelf, h);
  }
  const h = Math.max(4, Math.ceil((y + shelf) / 4) * 4);
  return { cells, w: atlasW, h };
}

/** One non-indexed geometry for the quads of a group (position, normal, uv, colour rgba). */
export function quadsGeometry(list, pack, quad, color, pad = 2) {
  const pos = [];
  const nrm = [];
  const uv = [];
  const col = [];
  list.forEach((e, i) => {
    const q = quad(e);
    const [px, py, pw, ph] = pack.cells[i];
    const u0 = (px + pad) / pack.w;
    const u1 = (px + pw - pad) / pack.w;
    const vt = 1 - (py + pad) / pack.h; // CanvasTexture flipY: the canvas's top row is v = 1
    const vb = 1 - (py + ph - pad) / pack.h;
    const corner = (sr, su) => [0, 1, 2].map((k) => q.c[k] + q.r[k] * q.hw * sr + q.u[k] * q.hh * su);
    const v = [
      [corner(-1, -1), u0, vb],
      [corner(1, -1), u1, vb],
      [corner(1, 1), u1, vt],
      [corner(-1, 1), u0, vt],
    ];
    const c = color ? color(e, i) : [1, 1, 1, 1];
    for (const k of [0, 1, 2, 0, 2, 3]) {
      pos.push(...v[k][0]);
      nrm.push(...q.n);
      uv.push(v[k][1], v[k][2]);
      col.push(c[0], c[1], c[2], c[3]);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
  g.computeBoundingSphere();
  return g;
}

export class TextAtlasGroups {
  /**
   * @param {THREE.Object3D} parent where the meshes go (LevelView.root)
   * @param {object} o
   *   name            mesh name
   *   atlasW          atlas width (px)
   *   cellSize(e)     [w, h] of an entry's cell (px)
   *   drawCell(ctx, e, x, y, w, h, i, list)   draws one entry into its cell (pad already removed)
   *   quad(e)         { c, r, u, n, hw, hh } in world space
   *   color(e, i)     vertex colour rgba (optional)
   *   material(tex)   a new material for a group's atlas
   *   renderOrder, viewDist, buildDist, dropDist, cellsPerFrame, pad, anisotropy
   *   makeCanvas(w, h)   canvas factory (tests); default a DOM canvas, none in Node
   */
  constructor(parent, o) {
    this.parent = parent;
    this.o = Object.assign({ name: 'textAtlas', renderOrder: 3, viewDist: 14, buildDist: 40, dropDist: 80, cellsPerFrame: 1, pad: 2, anisotropy: 4 }, o);
    this.makeCanvas = this.o.makeCanvas || defaultCanvas;
    this.groups = [];
    this._job = null; // the group whose atlas is being drawn
    this.count = 0;
  }

  /** Every built mesh (a group with a finished atlas). */
  get meshes() {
    const out = [];
    for (const g of this.groups) if (g.mesh) out.push(g.mesh);
    return out;
  }

  /** The first built mesh (or null): compatibility with the one-mesh API and the tests. */
  get mesh() {
    for (const g of this.groups) if (g.mesh) return g.mesh;
    return null;
  }

  /** Resident atlas pixels (all groups with a canvas). */
  get residentPixels() {
    let n = 0;
    for (const g of this.groups) if (g.canvas) n += g.pack.w * g.pack.h;
    return n;
  }

  /**
   * Takes the entries (replacing any). Builds the group nearest to `near` ({x, y, z}) at once when given (so a caller can
   * precompile its program), the others lazily in update(). Returns true when the entries can be drawn here (a canvas exists).
   */
  build(entries, near = null) {
    this.dispose();
    const list = (Array.isArray(entries) ? entries : []).filter((e) => e && isFinite(e.x) && isFinite(e.y) && isFinite(e.z) && e.text);
    if (!list.length || !this.parent) return false;
    const probe = this.makeCanvas(4, 4);
    if (!probe || !probe.getContext || !probe.getContext('2d')) return false;
    const byKey = new Map();
    for (const e of list) {
      const k = String(e.group || e.section || 'all');
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(e);
    }
    for (const [key, items] of byKey) {
      const pts = new Float32Array(items.length * 3);
      const box = { minX: Infinity, minY: Infinity, minZ: Infinity, maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity };
      items.forEach((e, i) => {
        pts.set([e.x, e.y, e.z], i * 3);
        box.minX = Math.min(box.minX, e.x);
        box.minY = Math.min(box.minY, e.y);
        box.minZ = Math.min(box.minZ, e.z);
        box.maxX = Math.max(box.maxX, e.x);
        box.maxY = Math.max(box.maxY, e.y);
        box.maxZ = Math.max(box.maxZ, e.z);
      });
      const pack = packCells(items.map((e) => this.o.cellSize(e)), this.o.atlasW);
      this.groups.push({ key, list: items, pts, box, pack, canvas: null, ctx: null, drawn: 0, mesh: null });
    }
    this.count = list.length;
    if (near) {
      let best = null;
      let bd = Infinity;
      for (const g of this.groups) {
        const d = this._boxDist(g, near);
        if (d < bd) {
          bd = d;
          best = g;
        }
      }
      if (best) this._buildNow(best);
    }
    return true;
  }

  _boxDist(g, p) {
    const b = g.box;
    const dx = Math.max(b.minX - p.x, 0, p.x - b.maxX);
    const dy = Math.max(b.minY - p.y, 0, p.y - b.maxY);
    const dz = Math.max(b.minZ - p.z, 0, p.z - b.maxZ);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  _start(g) {
    const c = this.makeCanvas(g.pack.w, g.pack.h);
    const ctx = c && c.getContext ? c.getContext('2d') : null;
    if (!ctx) return false;
    ctx.clearRect(0, 0, g.pack.w, g.pack.h);
    g.canvas = c;
    g.ctx = ctx;
    g.drawn = 0;
    return true;
  }

  /** Draws up to n more cells; finishes the group (texture + mesh) when its atlas is complete. */
  _step(g, n) {
    const P = this.o.pad;
    while (n-- > 0 && g.drawn < g.list.length) {
      const i = g.drawn++;
      const [x, y, w, h] = g.pack.cells[i];
      g.ctx.save();
      this.o.drawCell(g.ctx, g.list[i], x + P, y + P, w - 2 * P, h - 2 * P, i, g.list);
      g.ctx.restore();
    }
    if (g.drawn >= g.list.length) this._finish(g);
  }

  _buildNow(g) {
    if (g.mesh) return;
    if (!g.canvas && !this._start(g)) return;
    this._step(g, g.list.length);
    if (this._job === g) this._job = null;
  }

  _finish(g) {
    const tex = new THREE.CanvasTexture(g.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = this.o.anisotropy;
    const mesh = new THREE.Mesh(quadsGeometry(g.list, g.pack, this.o.quad, this.o.color, this.o.pad), this.o.material(tex));
    mesh.name = this.o.name;
    mesh.userData.ownMaterial = true; // LevelView.clear() would dispose it like the plaques (dispose() gets there first)
    mesh.userData.group = g.key;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = this.o.renderOrder;
    mesh.visible = false;
    this.parent.add(mesh);
    g.mesh = mesh;
    g.ctx = null;
    if (this._job === g) this._job = null;
  }

  _drop(g) {
    if (this._job === g) this._job = null;
    const m = g.mesh;
    g.mesh = null;
    g.canvas = null;
    g.ctx = null;
    g.drawn = 0;
    if (!m) return;
    if (m.parent) m.parent.remove(m);
    m.geometry.dispose();
    if (m.material.map) m.material.map.dispose();
    m.material.dispose();
  }

  /** Removes every mesh and frees their geometry, materials and atlases (the entries are forgotten too). */
  dispose() {
    for (const g of this.groups) this._drop(g);
    this.groups = [];
    this._job = null;
    this.count = 0;
  }

  /** Lazily builds the groups near the head, drops the far ones, shows a mesh while one of its quads is in view range. */
  update(head, scale = 1) {
    if (!this.groups.length || !head) return;
    const o = this.o;
    const s = Math.max(0.5, scale);
    // the atlas being drawn: a few cells this frame
    if (this._job) this._step(this._job, o.cellsPerFrame);
    if (!this._job) {
      let best = null;
      let bd = o.buildDist * Math.max(1, s);
      for (const g of this.groups) {
        if (g.mesh || g.canvas) continue;
        const d = this._boxDist(g, head);
        if (d < bd) {
          bd = d;
          best = g;
        }
      }
      if (best && this._start(best)) {
        this._job = best;
        this._step(best, o.cellsPerFrame);
      }
    }
    const r2 = (o.viewDist * s) ** 2;
    for (const g of this.groups) {
      if (!g.mesh && !g.canvas) continue;
      if (this._boxDist(g, head) > o.dropDist * Math.max(1, s)) {
        this._drop(g);
        continue;
      }
      if (!g.mesh) continue;
      const p = g.pts;
      let on = false;
      for (let i = 0; i < p.length && !on; i += 3) {
        const dx = p[i] - head.x;
        const dy = p[i + 1] - head.y;
        const dz = p[i + 2] - head.z;
        on = dx * dx + dy * dy + dz * dz < r2;
      }
      g.mesh.visible = on;
    }
  }
}
