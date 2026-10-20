/* ABYSSAL TETHER 3D — lmTrace.mjs
 * Ray tracing against the level's axis-aligned boxes for the lightmap baker: a uniform grid in CSR layout (typed arrays,
 * shared between worker threads), 3D-DDA traversal with per-ray mailboxing. Pure functions, no allocation per ray.
 */

export class BoxGrid {
  /**
   * @param {Float64Array} boxes  6 floats per box: minX minY minZ maxX maxY maxZ
   * @param {number[]} min        grid origin
   * @param {number[]} size       grid size
   * @param {number} cell         cell size (m)
   * @param {object} [shared]     { start, items } typed arrays from a previous grid (worker side)
   */
  constructor(boxes, min, size, cell, shared) {
    this.boxes = boxes;
    this.nb = boxes.length / 6;
    this.min = min;
    this.cell = cell;
    this.inv = 1 / cell;
    this.nx = Math.ceil(size[0] / cell) + 2;
    this.ny = Math.ceil(size[1] / cell) + 2;
    this.nz = Math.ceil(size[2] / cell) + 2;
    this.mail = new Int32Array(this.nb);
    this.stamp = 0;
    if (shared) {
      this.start = shared.start;
      this.items = shared.items;
    } else {
      this._build();
    }
  }

  _range(lo, hi, axis) {
    const n = axis === 0 ? this.nx : axis === 1 ? this.ny : this.nz;
    const a = Math.max(0, Math.min(n - 1, Math.floor((lo - this.min[axis]) * this.inv) + 1));
    const b = Math.max(0, Math.min(n - 1, Math.floor((hi - this.min[axis]) * this.inv) + 1));
    return [a, b];
  }

  _build() {
    const { nx, ny, nz, boxes, nb } = this;
    const count = new Uint32Array(nx * ny * nz + 1);
    const each = (fn) => {
      for (let i = 0; i < nb; i++) {
        const o = i * 6;
        const [x0, x1] = this._range(boxes[o], boxes[o + 3], 0);
        const [y0, y1] = this._range(boxes[o + 1], boxes[o + 4], 1);
        const [z0, z1] = this._range(boxes[o + 2], boxes[o + 5], 2);
        for (let z = z0; z <= z1; z++) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) fn((y * nz + z) * nx + x, i);
      }
    };
    each((c) => count[c + 1]++);
    for (let i = 0; i < count.length - 1; i++) count[i + 1] += count[i];
    const fill = count.slice(0, count.length - 1);
    const items = new Uint32Array(count[count.length - 1]);
    each((c, i) => {
      items[fill[c]++] = i;
    });
    this.start = count;
    this.items = items;
  }

  /** Typed arrays that fully describe the grid (for SharedArrayBuffer hand-over). */
  exportShared() {
    return { start: this.start, items: this.items };
  }

  /** Is the point strictly inside a box (≥ `eps` from its surface)? */
  inside(x, y, z, eps = 0) {
    const cx = Math.floor((x - this.min[0]) * this.inv) + 1;
    const cy = Math.floor((y - this.min[1]) * this.inv) + 1;
    const cz = Math.floor((z - this.min[2]) * this.inv) + 1;
    if (cx < 0 || cy < 0 || cz < 0 || cx >= this.nx || cy >= this.ny || cz >= this.nz) return false;
    const c = (cy * this.nz + cz) * this.nx + cx;
    const B = this.boxes;
    for (let k = this.start[c]; k < this.start[c + 1]; k++) {
      const o = this.items[k] * 6;
      if (x > B[o] + eps && x < B[o + 3] - eps && y > B[o + 1] + eps && y < B[o + 4] - eps && z > B[o + 2] + eps && z < B[o + 5] - eps) return true;
    }
    return false;
  }

  /**
   * First hit along (o + t·d), 0 < t ≤ maxT. Returns the distance (Infinity = none) and leaves the box index and the hit
   * axis/sign in this.hitBox / this.hitAxis / this.hitSign. `d` must be a unit vector.
   */
  trace(ox, oy, oz, dx, dy, dz, maxT) {
    const B = this.boxes;
    const cs = this.cell;
    const mn = this.min;
    const { nx, ny, nz } = this;
    let cx = Math.floor((ox - mn[0]) * this.inv) + 1;
    let cy = Math.floor((oy - mn[1]) * this.inv) + 1;
    let cz = Math.floor((oz - mn[2]) * this.inv) + 1;
    const sx = dx > 0 ? 1 : -1;
    const sy = dy > 0 ? 1 : -1;
    const sz = dz > 0 ? 1 : -1;
    const tdx = dx !== 0 ? Math.abs(cs / dx) : Infinity;
    const tdy = dy !== 0 ? Math.abs(cs / dy) : Infinity;
    const tdz = dz !== 0 ? Math.abs(cs / dz) : Infinity;
    let tmx = dx !== 0 ? (mn[0] + (cx - 1 + (dx > 0 ? 1 : 0)) * cs - ox) / dx : Infinity;
    let tmy = dy !== 0 ? (mn[1] + (cy - 1 + (dy > 0 ? 1 : 0)) * cs - oy) / dy : Infinity;
    let tmz = dz !== 0 ? (mn[2] + (cz - 1 + (dz > 0 ? 1 : 0)) * cs - oz) / dz : Infinity;
    let best = Infinity;
    let bi = -1;
    let bax = 0;
    const st = ++this.stamp;
    const mail = this.mail;
    const idx = 1 / (dx !== 0 ? dx : 1e-30);
    const idy = 1 / (dy !== 0 ? dy : 1e-30);
    const idz = 1 / (dz !== 0 ? dz : 1e-30);
    for (let guard = 0; guard < 2048; guard++) {
      if (cx < 0 || cy < 0 || cz < 0 || cx >= nx || cy >= ny || cz >= nz) break;
      const c = (cy * nz + cz) * nx + cx;
      for (let k = this.start[c], e = this.start[c + 1]; k < e; k++) {
        const id = this.items[k];
        if (mail[id] === st) continue;
        mail[id] = st;
        const o = id * 6;
        let t0 = 0;
        let t1 = best < maxT ? best : maxT;
        let ax = 0;
        let a = (B[o] - ox) * idx;
        let b = (B[o + 3] - ox) * idx;
        let lo = a < b ? a : b;
        let hi = a < b ? b : a;
        if (dx === 0 && (ox <= B[o] || ox >= B[o + 3])) continue;
        if (lo > t0) {
          t0 = lo;
          ax = 0;
        }
        if (hi < t1) t1 = hi;
        if (t0 > t1) continue;
        a = (B[o + 1] - oy) * idy;
        b = (B[o + 4] - oy) * idy;
        lo = a < b ? a : b;
        hi = a < b ? b : a;
        if (dy === 0 && (oy <= B[o + 1] || oy >= B[o + 4])) continue;
        if (lo > t0) {
          t0 = lo;
          ax = 1;
        }
        if (hi < t1) t1 = hi;
        if (t0 > t1) continue;
        a = (B[o + 2] - oz) * idz;
        b = (B[o + 5] - oz) * idz;
        lo = a < b ? a : b;
        hi = a < b ? b : a;
        if (dz === 0 && (oz <= B[o + 2] || oz >= B[o + 5])) continue;
        if (lo > t0) {
          t0 = lo;
          ax = 2;
        }
        if (hi < t1) t1 = hi;
        if (t0 > t1) continue;
        if (t0 > 1e-4 && t0 < best) {
          best = t0;
          bi = id;
          bax = ax;
        }
      }
      const tExit = tmx < tmy ? (tmx < tmz ? tmx : tmz) : tmy < tmz ? tmy : tmz;
      if (best <= tExit || tExit > maxT) break;
      if (tmx <= tmy && tmx <= tmz) {
        cx += sx;
        tmx += tdx;
      } else if (tmy <= tmz) {
        cy += sy;
        tmy += tdy;
      } else {
        cz += sz;
        tmz += tdz;
      }
    }
    if (best <= maxT && bi >= 0) {
      this.hitBox = bi;
      this.hitAxis = bax;
      this.hitSign = (bax === 0 ? dx : bax === 1 ? dy : dz) > 0 ? -1 : 1; // normal of the face that was entered
      return best;
    }
    this.hitBox = -1;
    return Infinity;
  }

  /** Is the segment o → o + d·maxT free of boxes? */
  clear(ox, oy, oz, dx, dy, dz, maxT) {
    return this.trace(ox, oy, oz, dx, dy, dz, maxT) === Infinity;
  }
}
