/* ABYSSAL TETHER 3D — levelCache.js
 * The dressed level cached in IndexedDB (docs/abyssal-tether-3d/plans/LOADING_OPTIMIZATION.md). The LevelView's procedural build merges
 * the decor and then runs the dressing job (the Dresser's plan, the kit placements, the buried-face culling, the section packs) for
 * seconds of main-thread time on a Quest, a little per frame. Its result is deterministic: the same code, level data, kit / props GLBs,
 * variant, URL flags and detail tier always give the same buffers. So once a run has dressed the whole level, every merged chunk (its
 * attribute arrays, the LodSet records of the section packs), the decals, the cogs, the decor colliders and the stats are written here;
 * the next boot with the same inputs restores them in place of the merge + dressing job (no job, no dressing hitches, every section and
 * every collider there from the first frame of the menu).
 *
 * Correctness first:
 *  - the key is a SHA-256 over every source file of the build (the static import closure of levelView.js, level3d.js and the level data,
 *    three.js included, read back from the HTTP / service-worker cache), the kit and props GLB bytes, the variant, the page's query string
 *    and the cache schema; the detail tier (the kit's rich level on or off) and the level's layout signature are checked at restore. Any
 *    change of any of them (an app update that touches the level) is a miss: the procedural build runs and re-saves;
 *  - a snapshot is only written by a session whose build had the kit and props from the start (the deterministic order) and whose
 *    dressing job finished without an error, and only if every new object under the view's root is one it knows how to restore;
 *  - the meta record (the manifest) is deleted first and written last: an interrupted save leaves no entry, never a partial one;
 *  - any failure (no IndexedDB, private mode, quota, a short read, a size mismatch) is a miss: the old synchronous path runs.
 * Memory: one entry per variant; the arrays restored are the geometry the procedural build would have allocated (no second copy is
 * kept); a save copies 1 MB slices, one per frame. `?levelcache=0` (or `?loadopt=0`) turns it off.
 */
import * as THREE from 'three';
import { LOADOPT } from './levelBuildFast.js';

const SCHEMA = 1;
const DB_NAME = 'at3d-level-cache';
const DB_VERSION = 1;
const SLICE = 1 << 20; // bytes per stored slice: one put (one structured clone) per frame while saving
const READ_BATCH = 8; // slices per read request
const ROOTS = ['./levelView.js', '../sim/level3d.js', '../data/level-data-3d.js'];
const CTORS = { Float32Array, Int16Array, Uint16Array, Uint32Array, Int32Array, Uint8Array, Int8Array, Float64Array };

export function levelCacheEnabled() {
  return (
    LOADOPT.on &&
    !(typeof location !== 'undefined' && /[?&]levelcache=0\b/.test(location.search || '')) &&
    typeof indexedDB !== 'undefined' &&
    typeof fetch === 'function' &&
    typeof crypto !== 'undefined' &&
    !!crypto.subtle
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// Key
// ---------------------------------------------------------------------------------------------------------------------------------------
/** Static import / re-export specifiers of an ES module source (not dynamic import()). */
export function staticImports(text) {
  const out = [];
  const re = /^[ \t]*(?:import|export)\b[^;'"`]*?\bfrom[ \t]*(['"])([^'"\n]+)\1|^[ \t]*import[ \t]*(['"])([^'"\n]+)\3/gm;
  let m;
  while ((m = re.exec(text))) out.push(m[2] || m[4]);
  return out;
}

function importMapOf() {
  try {
    const el = typeof document !== 'undefined' && document.querySelector('script[type="importmap"]');
    const j = el ? JSON.parse(el.textContent) : null;
    return (j && j.imports) || {};
  } catch {
    return {};
  }
}

/** Resolves a specifier like the page does (relative, absolute, or through the import map). */
export function resolveSpec(spec, from, map, base) {
  if (/^(\.{0,2}\/|https?:)/.test(spec)) return new URL(spec, from).href;
  if (map[spec]) return new URL(map[spec], base).href;
  for (const k of Object.keys(map)) if (k.endsWith('/') && spec.startsWith(k)) return new URL(map[k] + spec.slice(k.length), base).href;
  return null;
}

async function bytesOf(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`level cache: ${url} ${res.status}`);
  return res.arrayBuffer();
}

/** url -> source bytes of every module the level build imports statically (a fetch failure rejects: no key, no cache). */
async function closure(roots) {
  const map = importMapOf();
  const base = typeof document !== 'undefined' ? document.baseURI : roots[0];
  const out = new Map();
  let frontier = roots.slice();
  while (frontier.length) {
    const todo = [...new Set(frontier)].filter((u) => !out.has(u));
    frontier = [];
    const bufs = await Promise.all(todo.map(bytesOf));
    todo.forEach((u, i) => {
      out.set(u, bufs[i]);
      for (const spec of staticImports(new TextDecoder().decode(bufs[i]))) {
        const r = resolveSpec(spec, u, map, base);
        if (!r) throw new Error('level cache: unresolved import ' + spec);
        if (!out.has(r)) frontier.push(r);
      }
    });
  }
  return out;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha = async (buf) => hex(await crypto.subtle.digest('SHA-256', buf));

/** The key of everything that shapes the dressed level (but the detail tier and the layout, checked at restore). */
export async function baseKey(variant, glbUrls) {
  const files = await closure(ROOTS.map((r) => new URL(r, import.meta.url).href));
  const origin = typeof location !== 'undefined' ? location.origin : '';
  const search = typeof location !== 'undefined' ? location.search || '' : '';
  const lines = [`schema ${SCHEMA}`, `variant ${variant}`, `search ${search.replace(/[?&]loadprof=1\b/, '')}`];
  for (const url of [...files.keys()].sort()) lines.push(`${url.replace(origin, '')} ${await sha(files.get(url))}`);
  for (const url of glbUrls) lines.push(`${String(url).replace(origin, '')} ${await sha(await bytesOf(url))}`);
  return sha(new TextEncoder().encode(lines.join('\n')));
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------------------------------------------------------------------------
let _db = null;
function openDB() {
  if (_db) return _db;
  _db = new Promise((resolve, reject) => {
    const rq = indexedDB.open(DB_NAME, DB_VERSION);
    rq.onupgradeneeded = () => {
      const db = rq.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      if (!db.objectStoreNames.contains('data')) db.createObjectStore('data');
    };
    rq.onsuccess = () => resolve(rq.result);
    rq.onerror = () => reject(rq.error);
    rq.onblocked = () => reject(new Error('level cache: blocked'));
  });
  _db.catch(() => (_db = null));
  return _db;
}

function req(store, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(store, mode);
        let out;
        const r = fn(tx.objectStore(store));
        if (r) r.onsuccess = () => (out = r.result);
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('level cache: aborted'));
      }),
  );
}

const range = (variant, a, b) => IDBKeyRange.bound([variant, a], [variant, b]);

// ---------------------------------------------------------------------------------------------------------------------------------------
// Snapshot <-> LevelView
// ---------------------------------------------------------------------------------------------------------------------------------------
const REC_SKIP = new Set(['geos', 'cur', 'w', '_culled']);

/** The material list key of a chunk (pack|sec|k, lod|band|k[|slab], band|k[|slab]). */
function kOfKey(key) {
  const p = String(key).split('|');
  return p[0] === 'pack' || p[0] === 'lod' ? p[2] : p[1];
}

/**
 * The manifest + the arrays of a fully dressed LevelView, or null (with the reason in .why) when it holds something the restore would not
 * rebuild. `env`: { materialFor(k) } (the view's own material choice per list).
 */
export function snapshotOf(lv, level, env) {
  const fail = (why) => ({ fail: why });
  if (!lv._chunkByKey || !lv._startSet) return fail('no build');
  const keyOf = new Map();
  for (const [key, ch] of lv._chunkByKey) keyOf.set(ch, key);
  const arrays = [];
  const arr = (a) => {
    arrays.push(a);
    return arrays.length - 1;
  };
  const attrs = (g) => {
    const out = [];
    for (const name of Object.keys(g.attributes)) {
      const a = g.attributes[name];
      const ctor = a.array && a.array.constructor && a.array.constructor.name;
      if (a.isInterleavedBufferAttribute || !CTORS[ctor] || (a.array.length !== a.count * a.itemSize)) return null;
      out.push({ name, a: arr(a.array), ctor, itemSize: a.itemSize, normalized: !!a.normalized, f16: !!a.isFloat16BufferAttribute, usage: a.usage });
    }
    return out;
  };
  const chunks = [];
  const objs = new Set();
  for (const ch of lv._chunks) {
    const key = keyOf.get(ch);
    if (key === undefined) return fail('unkeyed chunk ' + (ch.obj && ch.obj.name));
    const k = kOfKey(key);
    const mesh = ch.obj;
    if (!mesh || !mesh.isMesh || mesh.isInstancedMesh || mesh.material !== env.materialFor(k)) return fail('chunk ' + key);
    objs.add(mesh);
    const c = { key, k, name: mesh.name, band: ch.band, kind: ch.kind, maxDist: ch.maxDist, renderOrder: mesh.renderOrder, fresh: !!ch.fresh };
    if (ch.lod) {
      const set = ch.lod;
      if (!set.soup || !set.rg || set.rg.attributes.position !== set.soup.attributes.position) return fail('lod ' + key);
      c.attrs = attrs(set.soup);
      c.recs = set.recs.map((r) => {
        const o = {};
        for (const f of Object.keys(r)) if (!REC_SKIP.has(f)) o[f] = r[f];
        return o;
      });
    } else {
      const g = mesh.geometry;
      if (g.index || g.groups.length || Object.keys(g.morphAttributes).length) return fail('geometry ' + key);
      c.attrs = attrs(g);
    }
    if (!c.attrs) return fail('attributes ' + key);
    chunks.push(c);
  }
  let decals = null;
  if (lv._decals) {
    objs.add(lv._decals.mesh);
    if (lv._decals.count > 0) {
      decals = { count: lv._decals.count, attrs: attrs(lv._decals.mesh.geometry) };
      if (!decals.attrs) return fail('decals');
    }
  }
  if (lv._cogs) objs.add(lv._cogs.mesh);
  // every object under the root that the dressing added must be one of the above (a new kind of output: no snapshot, it would be lost)
  for (const o of lv.root.children) {
    if (lv._startSet.has(o) || objs.has(o)) continue;
    if (o.userData && o.userData.group !== undefined) continue; // the boards / blood atlases, built lazily near the head (not cached)
    return fail('unknown object ' + (o.name || o.type));
  }
  const cogs = lv._cogs ? lv._cogs.items.map((c) => ({ m: Array.from(c.m.elements), spin: c.spin, phase: c.phase, tint: c.tint, r: c.r })) : [];
  const colliders = (level.decorSolids || []).map((s) => [s.minX, s.minY, s.minZ, s.maxX, s.maxY, s.maxZ]);
  let stats;
  try {
    stats = structuredClone(lv.stats);
  } catch {
    return fail('stats');
  }
  return {
    manifest: {
      schema: SCHEMA,
      sig: lv._sig,
      detail: lv._buildDetail,
      dressStart: lv._dressStartChunks,
      chunks,
      decals,
      cogs,
      colliders,
      stats,
      arrays: arrays.map((a) => ({ ctor: a.constructor.name, length: a.length, bytes: a.byteLength })),
    },
    arrays,
  };
}

/** The tier-dependent part of the result (the kit's / props' rich levels are built only on detail scales >= 0.7: setKit, _propRec). */
export function detailOf(lv) {
  return `lodNear=${!!lv._lodNear}|ds07=${lv._detailScale >= 0.7}`;
}

function makeAttr(d, arrays) {
  const src = arrays[d.a];
  let a;
  if (d.f16) {
    a = new THREE.Float16BufferAttribute(new Uint16Array(0), d.itemSize, d.normalized);
    a.array = src;
    a.count = src.length / d.itemSize;
  } else a = new THREE.BufferAttribute(src, d.itemSize, d.normalized);
  if (d.usage !== undefined) a.setUsage(d.usage);
  return a;
}

function makeGeometry(list, arrays) {
  const g = new THREE.BufferGeometry();
  for (const d of list) g.setAttribute(d.name, makeAttr(d, arrays));
  return g;
}

/**
 * Restores a snapshot into a LevelView whose build has done everything but the decor merge and the dressing job (levelView.build calls
 * it there). All or nothing: the meshes are made first, then added in the order the procedural build created them (the decor chunks,
 * the cogs and decal meshes, the dressing chunks). Returns false (nothing changed) when it does not fit. `env`: { LodSet, materialFor(k) }.
 */
export function restoreSnapshot(lv, level, snap, env) {
  const M = snap.manifest;
  const arrays = snap.arrays;
  if (!M || M.schema !== SCHEMA || M.sig !== lv._sig || M.detail !== detailOf(lv) || !Array.isArray(M.chunks) || !M.chunks.length) return false;
  if (M.arrays.length !== arrays.length) return false;
  for (let i = 0; i < arrays.length; i++) {
    const a = arrays[i];
    if (!a || a.constructor.name !== M.arrays[i].ctor || a.length !== M.arrays[i].length) return false;
  }
  const made = [];
  for (const c of M.chunks) {
    const material = env.materialFor(c.k);
    if (!material) return false;
    let geo;
    let set = null;
    if (c.recs) {
      const soup = makeGeometry(c.attrs, arrays);
      set = new env.LodSet();
      set.recs = c.recs.map((r) => Object.assign({}, r, { geos: null, cur: -1 }));
      set.soup = soup;
      const rg = new THREE.BufferGeometry();
      for (const name of Object.keys(soup.attributes)) rg.setAttribute(name, soup.attributes[name]);
      set.index = new THREE.BufferAttribute(new Uint32Array(soup.attributes.position.count), 1);
      set.index.setUsage(THREE.DynamicDrawUsage);
      rg.setIndex(set.index);
      rg.setDrawRange(0, 0);
      set.rg = rg;
      set._hx = Infinity;
      geo = rg;
    } else geo = makeGeometry(c.attrs, arrays);
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    const mesh = new THREE.Mesh(geo, material);
    mesh.name = c.name;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = c.renderOrder;
    made.push({ c, mesh, set });
  }
  // commit (undone if anything throws: the caller then builds procedurally)
  if (!lv._chunkByKey) lv._chunkByKey = new Map();
  const nChunks = lv._chunks.length;
  const kids = new Set(lv.root.children);
  const add = ({ c, mesh, set }) => {
    lv._addChunk(mesh, c.maxDist, c.band, c.kind);
    const ch = lv._chunks[lv._chunks.length - 1];
    if (set) ch.lod = set;
    if (c.fresh || c.kind === 'pack') ch.fresh = true; // a new pack is evaluated on its first visible frame (as _packBands sets it)
    lv._chunkByKey.set(c.key, ch);
  };
  try {
    const n0 = Math.max(0, Math.min(made.length, M.dressStart | 0));
    for (let i = 0; i < n0; i++) add(made[i]);
    if (typeof level.clearDecorColliders === 'function') level.clearDecorColliders();
    lv._kitPlan = [];
    lv._makeCogMesh();
    lv._makeDecalMesh();
    for (let i = n0; i < made.length; i++) add(made[i]);
    if (M.decals && lv._decals) {
      const g = makeGeometry(M.decals.attrs, arrays);
      lv._decals.mesh.geometry.dispose();
      lv._decals.mesh.geometry = g;
      lv._decals.count = M.decals.count;
    }
    lv._buildCogs(M.cogs.map((c) => Object.assign({}, c, { m: new THREE.Matrix4().fromArray(c.m) })));
    if (M.colliders.length && typeof level.addDecorColliders === 'function') level.addDecorColliders(M.colliders);
    Object.assign(lv.stats, M.stats);
  } catch (err) {
    for (const o of lv.root.children.slice()) if (!kids.has(o)) lv.root.remove(o);
    lv._chunks.length = nChunks;
    for (const c of M.chunks) lv._chunkByKey.delete(c.key);
    lv._cogs = null;
    lv._decals = null;
    if (typeof level.clearDecorColliders === 'function') level.clearDecorColliders();
    throw err;
  }
  lv._dressJob = null;
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------------------------
// The cache
// ---------------------------------------------------------------------------------------------------------------------------------------
export class LevelCache {
  /** @param {string[]} glbUrls  the GLBs the dressed level is made of (environment kit, props) */
  constructor(glbUrls) {
    this.glbUrls = glbUrls || [];
    this.on = levelCacheEnabled();
    this._pre = new Map(); // variant -> Promise<{ base, snap|null }>
    this._ready = new Map(); // variant -> { base, snap|null } once read
    this._abandon = new Set(); // variants whose read is no longer wanted (a level was built meanwhile): dropped on arrival
    this._save = null; // the save in progress
    this.info = { hit: false, miss: '', saved: false, error: '', readMs: 0, bytes: 0 };
  }

  /** Starts computing the key of `variant` and reading its entry (resolves to the snapshot or null; never rejects). */
  prefetch(variant) {
    if (!this.on) return Promise.resolve(null);
    if (this._pre.has(variant)) return this._pre.get(variant);
    const t0 = performance.now();
    const p = (async () => {
      const base = await baseKey(variant, this.glbUrls);
      let snap = null;
      const meta = await req('meta', 'readonly', (s) => s.get(variant));
      const have = !!(meta && meta.base === base && meta.manifest && meta.manifest.schema === SCHEMA);
      if (have && !this._abandon.has(variant)) {
        const parts = meta.parts | 0;
        const asm = new Assembler(meta.manifest.arrays);
        for (let i = 0; i < parts; i += READ_BATCH) {
          if (this._abandon.has(variant)) throw new Error('level cache: read abandoned (the level was built meanwhile)');
          const got = await req('data', 'readonly', (s) => s.getAll(range(variant, i, Math.min(parts, i + READ_BATCH) - 1)));
          if (!got || got.length !== Math.min(READ_BATCH, parts - i)) throw new Error('level cache: short read');
          for (const buf of got) asm.push(buf);
        }
        snap = { manifest: meta.manifest, arrays: asm.done() };
        this.info.bytes = meta.bytes;
      } else if (!have) this.info.miss = meta ? 'stale' : 'empty';
      this.info.readMs = Math.round(performance.now() - t0);
      if (this._abandon.has(variant)) snap = null; // too late for the build (it went procedural): never hold the arrays
      const r = { base, snap, saved: have ? meta.manifest.detail : null }; // saved: the detail tier of the valid entry already stored
      this._ready.set(variant, r);
      return snap;
    })().catch((err) => {
      this.info.error = String((err && err.message) || err);
      this._ready.set(variant, { base: null, snap: null });
      return null;
    });
    this._pre.set(variant, p);
    return p;
  }

  /** The snapshot for this level if it was read (and is dropped from here: restored once). */
  take(level) {
    if (!this.on || !level) return null;
    const r = this._ready.get(level.variant || 'normal');
    const snap = r && r.snap ? r.snap : null;
    // restored once (the arrays now belong to the view, or are garbage if it declines); other variants' reads are never used now
    for (const x of this._ready.values()) x.snap = null;
    for (const v of this._pre.keys()) if (!this._ready.has(v)) this._abandon.add(v);
    return snap;
  }

  /** Records whether the restore was used (LevelView.build). */
  noteRestore(ok, why) {
    this.info.hit = !!ok;
    if (!ok && why) this.info.miss = why;
  }

  /**
   * Called every frame (Renderer3D.update). Once the procedural dressing of a level built with the kit and props is complete, writes its
   * snapshot, one slice per call. Nothing to do: returns at once.
   */
  tick(lv) {
    if (!this.on) return;
    const sv = this._save;
    if (sv) {
      if (sv.busy) return;
      if (sv.lv !== lv || lv.level !== sv.level) {
        this._save = { done: true }; // rebuilt meanwhile: drop it (the next complete dressing saves)
        return;
      }
      this._step(sv);
      return;
    }
    if (!lv || !lv.level || this._triedFor === lv.level || lv.dressing || lv._restored || !lv._dressedWithAssets) return;
    const variant = lv.level.variant || 'normal';
    const ready = this._ready.get(variant);
    if (!ready) {
      // a level of another variant (a difficulty change at Start): its key only, then it is saved for the next boot of that variant
      if (!this._pre.has(variant)) {
        this._abandon.add(variant);
        this.prefetch(variant);
      }
      return;
    }
    if (!ready.base) return; // no key: nothing to save under
    this._triedFor = lv.level; // one attempt per built level
    if (ready.saved === lv._buildDetail) return; // this very entry is stored already
    if (lv.stats && lv.stats.dress && lv.stats.dress.error) return;
    const snap = snapshotOf(lv, lv.level, lv._cacheEnv());
    if (!snap || snap.fail) {
      this.info.error = 'not saved: ' + ((snap && snap.fail) || 'no snapshot');
      return;
    }
    const { slices, bytes } = slicesOf(snap.arrays);
    this._save = { lv, level: lv.level, variant, base: ready.base, manifest: snap.manifest, slices, i: 0, phase: 'clear', busy: false, bytes };
  }

  _step(sv) {
    const fail = (err) => {
      this.info.error = 'save: ' + String((err && err.message) || err);
      this._save = { done: true };
    };
    if (sv.done) return;
    sv.busy = true;
    let p;
    if (sv.phase === 'clear') {
      // the old entry goes first (its meta, then its data): an interrupted save leaves nothing to read
      p = req('meta', 'readwrite', (s) => s.delete(sv.variant))
        .then(() => req('data', 'readwrite', (s) => s.delete(range(sv.variant, 0, Infinity))))
        .then(() => (sv.phase = 'data'));
    } else if (sv.phase === 'data') {
      const i = sv.i;
      const u8 = sv.slices[i];
      const copy = u8.slice().buffer; // a slice of its own (a view would clone the whole buffer)
      p = req('data', 'readwrite', (s) => s.put(copy, [sv.variant, i])).then(() => {
        sv.slices[i] = null;
        if (++sv.i >= sv.slices.length) sv.phase = 'meta';
      });
    } else if (sv.phase === 'meta') {
      p = req('meta', 'readwrite', (s) => s.put({ base: sv.base, manifest: sv.manifest, parts: sv.slices.length, bytes: sv.bytes, at: Date.now() }, sv.variant)).then(() => {
        this.info.saved = true;
        this._save = { done: true };
      });
    }
    p.then(
      () => (sv.busy = false),
      (err) => fail(err),
    );
  }
}

/** The arrays as byte slices of at most SLICE bytes (views into them: the save copies one at a time); empty arrays have none. */
export function slicesOf(arrays, size = SLICE) {
  const slices = [];
  let bytes = 0;
  for (const a of arrays) {
    const u8 = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    for (let o = 0; o < u8.length; o += size) slices.push(u8.subarray(o, Math.min(u8.length, o + size)));
    bytes += a.byteLength;
  }
  return { slices, bytes };
}

/** Rebuilds a manifest's arrays from its slices as they are read (one allocation per array, each slice copied once and dropped). */
export class Assembler {
  constructor(specs) {
    this.specs = specs;
    this.out = specs.map((sp) => {
      const Ctor = CTORS[sp.ctor];
      if (!Ctor || sp.bytes !== sp.length * Ctor.BYTES_PER_ELEMENT) throw new Error('level cache: array ' + sp.ctor);
      return new Ctor(sp.length);
    });
    this.ai = 0;
    this.off = 0;
    this._skip();
  }

  _skip() {
    while (this.ai < this.specs.length && this.specs[this.ai].bytes === 0) this.ai++; // empty arrays have no slice
  }

  push(buf) {
    const b = new Uint8Array(buf);
    const sp = this.specs[this.ai];
    if (!sp) throw new Error('level cache: extra slice');
    const t = this.out[this.ai];
    if (this.off + b.length > sp.bytes) throw new Error('level cache: slice size');
    new Uint8Array(t.buffer, t.byteOffset, t.byteLength).set(b, this.off);
    this.off += b.length;
    if (this.off === sp.bytes) {
      this.ai++;
      this.off = 0;
      this._skip();
    }
  }

  done() {
    if (this.ai !== this.specs.length || this.off !== 0) throw new Error('level cache: slice count');
    return this.out;
  }
}
