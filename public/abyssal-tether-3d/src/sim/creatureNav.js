/* ABYSSAL TETHER 3D — creatureNav.js
 * SurfaceNav — the navigation mesh of the Mason and the skitterlings: they move ON the level's masonry, never through open air.
 *
 * The level is axis-aligned boxes. Every face of every crawlable box (`structural(solid)`: walls, pillars, large blocks) is cut into
 * cells of about `cell` metres; each cell whose centre, pushed out `hug` metres along the face normal, is clear of every other solid
 * becomes a NODE (the place the head rides when it crawls there). Two nodes are LINKED when they are within `link` metres and a
 * head-wide corridor between them is free of solids; that one rule covers a flat wall (neighbouring cells), a convex edge (wall to
 * ceiling round a ledge), a concave corner (wall to floor) and a hop across a slit. A* over the links gives the path to the node
 * nearest the player (`goalNear`), and `waypoint` string-pulls it for the head to follow.
 *
 * Pure and deterministic (no random, fixed iteration order), no three.js, no DOM. Queries (`nearest`, `goalNear`, `findPath`,
 * `waypoint`) allocate nothing after the first call. The mesh is built once per (level data, variant) and cached (`surfaceNavFor`),
 * from the level's own solids only: kit dressing colliders and seals come and go at run time and are the head's `_keepClear` business.
 * The mesh is SHARED by every Level3D built from the same data, so the runtime queries that look at live state (`goalNear`'s line of sight,
 * `waypoint`'s corridor) take the caller's level.
 */
import { U } from './config3d.js';

const OFF = 512; // hash offset so negative cell coordinates stay positive
const MAX_NODES = 60000;
const MIN_REGION = 150; // nodes: a connected piece of masonry smaller than this is left out of the mesh

/** Unsigned distance from a point to a box (0 inside). */
function boxDist(s, x, y, z) {
  const dx = x < s.minX ? s.minX - x : x > s.maxX ? x - s.maxX : 0;
  const dy = y < s.minY ? s.minY - y : y > s.maxY ? y - s.maxY : 0;
  const dz = z < s.minZ ? s.minZ - z : z > s.maxZ ? z - s.maxZ : 0;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export class SurfaceNav {
  /**
   * @param {Level3D} level
   * @param {{structural:(s:object)=>boolean, hug?:number, clear?:number, cell?:number, link?:number, corridor?:number}} opts
   *   hug: head height above the surface (m); clear: nodes keep this far from every other solid; cell: face cell size (m);
   *   link: longest link (m); corridor: how much each solid is inflated for the free-corridor test of a link (m).
   */
  constructor(level, opts) {
    this.level = level;
    this.hug = opts.hug == null ? 1.45 : opts.hug;
    this.clear = opts.clear == null ? 1.0 : opts.clear;
    this.cell = opts.cell == null ? 3 : opts.cell;
    this.link = opts.link == null ? this.cell * 1.55 : opts.link;
    this.corridor = opts.corridor == null ? 0.6 : opts.corridor;
    this._scratch = [];
    this._build(opts.structural);
    // A* scratch (sized once)
    const n = this.count;
    this._g = new Float32Array(n);
    this._parent = new Int32Array(n);
    this._seen = new Int32Array(n);
    this._closed = new Int32Array(n);
    this._stamp = 0;
    const hc = this.adjTo.length + 64;
    this._heapI = new Int32Array(hc);
    this._heapF = new Float32Array(hc);
    this._heapN = 0;
    this._cand = new Int32Array(24);
    this._candD = new Float32Array(24);
  }

  get ready() {
    return this.count > 0;
  }

  _key(ix, iy, iz) {
    return (ix + OFF) | ((iy + OFF) << 10) | ((iz + OFF) << 20);
  }

  _build(structural) {
    const lv = this.level;
    const solids = lv.solids.filter((s) => s.active !== false && structural(s));
    const b = lv.bounds;
    const margin = 2.5;
    let cell = this.cell;
    let px = [];
    let py = [];
    let pz = [];
    let nx = [];
    let ny = [];
    let nz = [];
    const tmp = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      px = [];
      py = [];
      pz = [];
      nx = [];
      ny = [];
      nz = [];
      for (let si = 0; si < solids.length; si++) {
        const s = solids[si];
        const mn = [s.minX, s.minY, s.minZ];
        const mx = [s.maxX, s.maxY, s.maxZ];
        for (let a = 0; a < 3; a++) {
          const u = (a + 1) % 3;
          const v = (a + 2) % 3;
          const lu = mx[u] - mn[u];
          const lw = mx[v] - mn[v];
          const cu = Math.max(1, Math.ceil(lu / cell - 1e-6));
          const cw = Math.max(1, Math.ceil(lw / cell - 1e-6));
          for (let sign = -1; sign <= 1; sign += 2) {
            const plane = (sign > 0 ? mx[a] : mn[a]) + sign * this.hug;
            for (let i = 0; i < cu; i++) {
              for (let j = 0; j < cw; j++) {
                const p = [0, 0, 0];
                p[a] = plane;
                p[u] = mn[u] + ((i + 0.5) * lu) / cu;
                p[v] = mn[v] + ((j + 0.5) * lw) / cw;
                if (b && (p[0] < b.minX - margin || p[0] > b.maxX + margin || p[2] < b.minZ - margin || p[2] > b.maxZ + margin || p[1] > b.maxY + 40)) continue;
                if (!this._free(p[0], p[1], p[2], tmp)) continue;
                px.push(p[0]);
                py.push(p[1]);
                pz.push(p[2]);
                nx.push(a === 0 ? sign : 0);
                ny.push(a === 1 ? sign : 0);
                nz.push(a === 2 ? sign : 0);
              }
            }
          }
        }
      }
      if (px.length <= MAX_NODES) break;
      cell *= 1.5; // a very large level: coarser cells
      this.link = cell * 1.55;
    }
    this.cell = cell;
    this._setNodes(px, py, pz, nx, ny, nz);
    this._link();
    // islands: a handful of nodes cut off from everything else (a ledge top behind a pillar) are no place to snap to or to hunt from
    const size = new Int32Array(this.regions);
    for (let i = 0; i < this.count; i++) size[this.region[i]]++;
    let drop = 0;
    for (let i = 0; i < this.count; i++) if (size[this.region[i]] < MIN_REGION) drop++;
    if (drop > 0 && drop < this.count) {
      const keep = (i) => size[this.region[i]] >= MIN_REGION;
      const f = (arr, out) => {
        for (let i = 0; i < this.count; i++) if (keep(i)) out.push(arr[i]);
        return out;
      };
      this._setNodes(f(this.px, []), f(this.py, []), f(this.pz, []), f(this.nx, []), f(this.ny, []), f(this.nz, []));
      this._link();
    }
    this.pruned = drop;
  }

  _setNodes(px, py, pz, nx, ny, nz) {
    this.count = px.length;
    this.px = Float32Array.from(px);
    this.py = Float32Array.from(py);
    this.pz = Float32Array.from(pz);
    this.nx = Int8Array.from(nx);
    this.ny = Int8Array.from(ny);
    this.nz = Int8Array.from(nz);
  }

  /** The spatial hash, the links (adjacency in CSR form) and the connected regions of the current nodes. */
  _link() {
    const n = this.count;
    // spatial hash (cell = link)
    const inv = 1 / this.link;
    this._inv = inv;
    const map = new Map();
    for (let i = 0; i < n; i++) {
      const k = this._key(Math.floor(this.px[i] * inv), Math.floor(this.py[i] * inv), Math.floor(this.pz[i] * inv));
      let l = map.get(k);
      if (!l) {
        l = [];
        map.set(k, l);
      }
      l.push(i);
    }
    this._map = map;

    // links
    const adj = new Array(n);
    for (let i = 0; i < n; i++) adj[i] = [];
    const link2 = this.link * this.link;
    for (let i = 0; i < n; i++) {
      const ix = Math.floor(this.px[i] * inv);
      const iy = Math.floor(this.py[i] * inv);
      const iz = Math.floor(this.pz[i] * inv);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            const l = map.get(this._key(ix + dx, iy + dy, iz + dz));
            if (!l) continue;
            for (let q = 0; q < l.length; q++) {
              const j = l[q];
              if (j <= i) continue;
              const ex = this.px[j] - this.px[i];
              const ey = this.py[j] - this.py[i];
              const ez = this.pz[j] - this.pz[i];
              const d2 = ex * ex + ey * ey + ez * ez;
              if (d2 > link2) continue;
              if (!this._corridorFree(this.px[i], this.py[i], this.pz[i], this.px[j], this.py[j], this.pz[j])) continue;
              const d = Math.sqrt(d2);
              adj[i].push(j, d);
              adj[j].push(i, d);
            }
          }
        }
      }
    }
    let m = 0;
    for (let i = 0; i < n; i++) m += adj[i].length >> 1;
    this.adjStart = new Int32Array(n + 1);
    this.adjTo = new Int32Array(m);
    this.adjCost = new Float32Array(m);
    let w = 0;
    for (let i = 0; i < n; i++) {
      this.adjStart[i] = w;
      const a = adj[i];
      for (let k = 0; k < a.length; k += 2) {
        this.adjTo[w] = a[k];
        this.adjCost[w] = a[k + 1];
        w++;
      }
    }
    this.adjStart[n] = w;
    this.links = m / 2;
    // connected regions: a goal is only ever chosen in the head's own region (some deep sections are separate pieces of masonry)
    const comp = new Int32Array(n).fill(-1);
    const stack = new Int32Array(n);
    let regions = 0;
    for (let i = 0; i < n; i++) {
      if (comp[i] >= 0) continue;
      let sp = 0;
      stack[sp++] = i;
      comp[i] = regions;
      while (sp > 0) {
        const c = stack[--sp];
        for (let e = this.adjStart[c]; e < this.adjStart[c + 1]; e++) {
          const j = this.adjTo[e];
          if (comp[j] < 0) {
            comp[j] = regions;
            stack[sp++] = j;
          }
        }
      }
      regions++;
    }
    this.region = comp;
    this.regions = regions;
  }

  /** Is the point at least `clear` from every solid of the level? */
  _free(x, y, z, list) {
    const r = this.clear;
    const lv = this.level;
    lv.querySolidsStatic(x - r, y - r, z - r, x + r, y + r, z + r, list);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.active !== false && boxDist(s, x, y, z) < r) return false;
    }
    return true;
  }

  /** Is the head-wide corridor between two points free of solids (each inflated by `corridor`)? */
  _corridorFree(ax, ay, az, bx, by, bz, level) {
    const c = this.corridor;
    const list = (level || this.level).querySolidsStatic(Math.min(ax, bx) - c, Math.min(ay, by) - c, Math.min(az, bz) - c, Math.max(ax, bx) + c, Math.max(ay, by) + c, Math.max(az, bz) + c, this._scratch);
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      if (s.active === false) continue;
      if (U.segmentBox(ax, ay, az, bx, by, bz, s, -c) >= 0) return false;
    }
    return true;
  }

  /**
   * The node nearest to a point within `maxDist` m (-1 when none). With `visible`, the level's line of sight from the point to the
   * node (the last 0.3 m ignored) breaks ties by preferring nodes the point can see among the nearest few.
   */
  nearest(x, y, z, maxDist, region = -1) {
    const inv = this._inv;
    const ix = Math.floor(x * inv);
    const iy = Math.floor(y * inv);
    const iz = Math.floor(z * inv);
    const rings = Math.max(1, Math.ceil(maxDist * inv));
    let best = -1;
    let bestD = maxDist * maxDist;
    for (let r = 0; r <= rings; r++) {
      // an earlier ring already holds something closer than anything this ring can: stop
      if (best >= 0 && bestD <= ((r - 1) * this.link) * ((r - 1) * this.link)) break;
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dz = -r; dz <= r; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) !== r) continue; // only the shell
            const l = this._map.get(this._key(ix + dx, iy + dy, iz + dz));
            if (!l) continue;
            for (let q = 0; q < l.length; q++) {
              const j = l[q];
              if (region >= 0 && this.region[j] !== region) continue;
              const ex = this.px[j] - x;
              const ey = this.py[j] - y;
              const ez = this.pz[j] - z;
              const d2 = ex * ex + ey * ey + ez * ez;
              if (d2 < bestD) {
                bestD = d2;
                best = j;
              }
            }
          }
        }
      }
    }
    return best;
  }

  /**
   * The node to head for to reach a target hanging in the air at (x, y, z): among the nodes nearest to it, the one with the best
   * view of it (a clear line, then the shortest). -1 when no node lies within `maxDist`.
   */
  goalNear(x, y, z, maxDist, region = -1, level = null) {
    const first = this.nearest(x, y, z, maxDist, region);
    if (first < 0) return -1;
    const d0 = Math.sqrt((this.px[first] - x) ** 2 + (this.py[first] - y) ** 2 + (this.pz[first] - z) ** 2);
    // candidates: every node within 3.5 m of the best distance (a few cells round it), nearest first
    const reach = d0 + 3.5;
    const inv = this._inv;
    const ix = Math.floor(x * inv);
    const iy = Math.floor(y * inv);
    const iz = Math.floor(z * inv);
    const rings = Math.max(1, Math.ceil(reach * inv));
    const cand = this._cand;
    const candD = this._candD;
    let nc = 0;
    for (let dx = -rings; dx <= rings; dx++) {
      for (let dy = -rings; dy <= rings; dy++) {
        for (let dz = -rings; dz <= rings; dz++) {
          const l = this._map.get(this._key(ix + dx, iy + dy, iz + dz));
          if (!l) continue;
          for (let q = 0; q < l.length; q++) {
            const j = l[q];
            if (region >= 0 && this.region[j] !== region) continue;
            const d = Math.sqrt((this.px[j] - x) ** 2 + (this.py[j] - y) ** 2 + (this.pz[j] - z) ** 2);
            if (d > reach) continue;
            // insertion into the (short) sorted candidate list
            let k = nc < cand.length ? nc++ : cand.length;
            if (k === cand.length) {
              if (d >= candD[k - 1]) continue;
              k = cand.length - 1;
            }
            while (k > 0 && candD[k - 1] > d) {
              cand[k] = cand[k - 1];
              candD[k] = candD[k - 1];
              k--;
            }
            cand[k] = j;
            candD[k] = d;
          }
        }
      }
    }
    let best = first;
    let bestCost = Infinity;
    const lv = level || this.level; // the caller's LIVE level: the mesh is shared by every Level3D built from the same data
    for (let k = 0; k < nc; k++) {
      const j = cand[k];
      const blocked = lv.segmentBlocked(this.px[j], this.py[j], this.pz[j], x, y, z, 0.3);
      const cost = candD[k] + (blocked ? 12 : 0);
      if (cost < bestCost) {
        bestCost = cost;
        best = j;
      }
    }
    return best;
  }

  /**
   * A* from node `from` to node `to`. Writes the node indices start..goal into `out` and returns how many (0: unreachable within the
   * expansion budget). A path longer than out.length is cut to its first out.length nodes.
   */
  findPath(from, to, out, budget = 6000) {
    if (from < 0 || to < 0) return 0;
    if (from === to) {
      out[0] = from;
      return 1;
    }
    const stamp = ++this._stamp;
    const g = this._g;
    const parent = this._parent;
    const seen = this._seen;
    const closed = this._closed;
    const hx = this.px[to];
    const hy = this.py[to];
    const hz = this.pz[to];
    const h = (i) => Math.sqrt((this.px[i] - hx) ** 2 + (this.py[i] - hy) ** 2 + (this.pz[i] - hz) ** 2);
    this._heapN = 0;
    g[from] = 0;
    parent[from] = -1;
    seen[from] = stamp;
    this._push(from, h(from));
    let expanded = 0;
    while (this._heapN > 0 && expanded < budget) {
      const cur = this._pop();
      if (closed[cur] === stamp) continue;
      closed[cur] = stamp;
      expanded++;
      if (cur === to) {
        let len = 0;
        for (let i = cur; i >= 0; i = parent[i]) len++;
        const keep = Math.min(len, out.length);
        // walk back from the goal, writing the START-side nodes first
        let i = cur;
        for (let k = len - 1; k >= 0; k--) {
          if (k < keep) out[k] = i;
          i = parent[i];
        }
        return keep;
      }
      for (let e = this.adjStart[cur]; e < this.adjStart[cur + 1]; e++) {
        const nb = this.adjTo[e];
        if (closed[nb] === stamp) continue;
        const ng = g[cur] + this.adjCost[e];
        if (seen[nb] !== stamp || ng < g[nb]) {
          seen[nb] = stamp;
          g[nb] = ng;
          parent[nb] = cur;
          this._push(nb, ng + h(nb));
        }
      }
    }
    return 0;
  }

  _push(i, f) {
    const hi = this._heapI;
    const hf = this._heapF;
    let k = this._heapN++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hf[p] <= f) break;
      hi[k] = hi[p];
      hf[k] = hf[p];
      k = p;
    }
    hi[k] = i;
    hf[k] = f;
  }

  _pop() {
    const hi = this._heapI;
    const hf = this._heapF;
    const top = hi[0];
    const n = --this._heapN;
    if (n > 0) {
      const i = hi[n];
      const f = hf[n];
      let k = 0;
      for (;;) {
        let c = 2 * k + 1;
        if (c >= n) break;
        if (c + 1 < n && hf[c + 1] < hf[c]) c++;
        if (hf[c] >= f) break;
        hi[k] = hi[c];
        hf[k] = hf[c];
        k = c;
      }
      hi[k] = i;
      hf[k] = f;
    }
    return top;
  }

  /**
   * Where the head should aim along `path` (nodes `idx..len-1`) from (x, y, z): the farthest path node within `ahead` metres of path
   * length that the head can reach in a straight, head-wide-free line. Returns the node index in the path (>= idx).
   */
  waypoint(path, len, idx, x, y, z, ahead, level = null) {
    let k = idx;
    let run = 0;
    let best = idx;
    let px = x;
    let py = y;
    let pz = z;
    for (; k < len; k++) {
      const j = path[k];
      run += Math.sqrt((this.px[j] - px) ** 2 + (this.py[j] - py) ** 2 + (this.pz[j] - pz) ** 2);
      px = this.px[j];
      py = this.py[j];
      pz = this.pz[j];
      if (run > ahead && k > idx) break;
      if (k === idx || this._corridorFree(x, y, z, px, py, pz, level)) best = k;
      else if (k > idx + 1) break;
    }
    return best;
  }
}

const CACHE = new WeakMap();

/**
 * The cached navigation mesh of a level: one per (level data, variant) however many Level3D objects are built from it (the tests
 * build hundreds). Returns null for a level without solids.
 */
export function surfaceNavFor(level, opts) {
  if (!level || !Array.isArray(level.solids) || typeof level.querySolidsStatic !== 'function') return null;
  const key = level.data && typeof level.data === 'object' ? level.data : level.solids;
  let byVariant = CACHE.get(key);
  if (!byVariant) {
    byVariant = new Map();
    CACHE.set(key, byVariant);
  }
  const k = `${level.variant || ''}|${level.solids.length}|${opts.hug}|${opts.cell || 3}|${opts.corridor}`;
  let nav = byVariant.get(k);
  if (!nav) {
    nav = new SurfaceNav(level, opts);
    byVariant.set(k, nav);
  }
  return nav.ready ? nav : null;
}
