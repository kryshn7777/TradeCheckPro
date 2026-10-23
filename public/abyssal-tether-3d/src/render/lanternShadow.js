/* ABYSSAL TETHER 3D — lanternShadow.js
 * Real-time shadows from the carried lantern (WP-SHADOWS), `renderer.lanternShadow`. No three.js shadow maps (no castShadow, no
 * program-key changes, no extra lights): one cone-shaped depth map from the lantern, shared by BOTH eyes (a world-space
 * frustum, one pass per frame at most), sampled by the lantern term of the lit-surface shaders (materials.js: atLanternShadow).
 *
 *   STATIC map   level solids within ~14 m of the lantern (one instanced box proxy, ONE draw call) + a few small decor chunks
 *                (budgeted), rendered into a cached depth target and re-rendered only when the lantern has moved / turned past a
 *                threshold (lanternShadowLogic.staticNeedsRefresh) and at most every minInterval s (36 Hz on quest). The receivers
 *                use the matrix the map was made with, so a stale map is exactly consistent, just a few cm behind the lantern.
 *   DYNAMIC map  small (512^2 quest): creature (rig LOD1 even when LOD0 is shown), player body, hands / launchers, the ropes,
 *                dropped / thrown bag items, supplies, crumbling ledges; every frame (every 2nd at governor level 2).
 *   The receivers multiply the two visibilities and the lantern's direct light only (baked lightmaps / GI / pooled lamps are
 *   untouched). Back faces are rendered into the static map (no acne on lit faces), the dynamic map is double sided with a
 *   polygon offset; receivers add a normal offset + a slope-scaled bias and 4 (static) / 2 (dynamic) hardware-compare taps.
 *
 * Budget: quest = 1024 static + 512 dynamic, <= 24 caster calls; high = 2048 + 1024; low = off (the contact blobs remain).
 * reducedEffects (when the tier is not already low) and governor level 2 halve the rate and the maps, level >= 3 switches it off.
 * The passes are counted in renderer.info (Renderer3D.render() resets the counters once per frame and turns autoReset off), so
 * renderer.stats and the game's perf counters include the shadow pass honestly.
 *
 * API (documented, no UI hook): renderer.lanternShadow.setEnabled(bool) · .setTier('low'|'quest'|'high'|null) · .tier · .enabled
 *   (effective) · .stats {calls, tris, staticCalls, staticTris, dynCalls, dynTris, staticRefreshes, dynRenders, casters, ...}
 *   · .attach(material) (receive the shadow) · .addCaster(object3D, 'dynamic'|'static') (flag another module's meshes).
 * Casters are discovered from the game object (hands, body, creature, rope, props); meshes can opt in with addCaster(), and
 * userData.noShadowCast / userData.noShadowRecv opt a mesh / material out.
 */

import * as THREE from 'three';
import { LSHADOW, attachLanternShadow } from './materials.js';
import { clusterGeometries } from './lanternShadowProxy.js';
import { coneFit, dynamicDue, makeStaticCache, markStaticRefreshed, shadowPlan, shadowTierName, smoothAxis, staticNeedsRefresh } from './lanternShadowLogic.js';

export const SHADOW_LAYER_STATIC = 5; // layers 1 and 2 belong to the XR eye cameras (three's WebXRManager)
export const SHADOW_LAYER_DYNAMIC = 6;

const PROXY_MAX = { quest: 640, high: 1400 }; // static box proxies (12 triangles each)
const DECOR_TRI_BUDGET = { quest: 6000, high: 40000 }; // triangles of flagged decor chunks in the static pass
const DECOR_CHUNK_MAX = { quest: 4500, high: 16000 }; // a single decor chunk bigger than this never casts
const DECOR_CHUNK_COUNT = { quest: 1, high: 12 }; // draw calls the decor chunks may add to a static pass (the proxy is 1 more)
const DECOR_NAME = /^decor_(stone|metal|rock|flesh)_/;
const REPACK_MOVE = 2.5; // m the lantern may drift from the proxy pack centre before the proxies are re-chosen
const REPACK_EVERY = 0.4; // s: at least this often (solids switching on / off)
const DISCOVER_EVERY = 0.5; // s
const PROXY_CELL = { hand: 0.016, body: 0.04, creature: 0.14 }; // weld cell (m) of the low-poly dynamic casters
const AXIS_RATE = 7; // 1/s: the cone axis follows the head's forward direction

const _bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
const _v = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _back = new THREE.Vector3();
const _fit = {};

function makeDepthMaterial(side, factor, units) {
  const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.BasicDepthPacking });
  m.side = side;
  m.colorWrite = false;
  m.polygonOffset = true;
  m.polygonOffsetFactor = factor;
  m.polygonOffsetUnits = units;
  m.userData.noShadowRecv = true;
  m.userData.noLook = true;
  m.name = side === THREE.BackSide ? 'LanternShadowStatic' : 'LanternShadowDynamic';
  return m;
}

function makeTarget(size) {
  const depth = new THREE.DepthTexture(size, size, THREE.UnsignedIntType);
  depth.compareFunction = THREE.LessEqualCompare; // hardware compare: sampler2DShadow, bilinear = free 2x2 PCF
  depth.minFilter = THREE.LinearFilter;
  depth.magFilter = THREE.LinearFilter;
  depth.name = 'lanternShadowDepth';
  const rt = new THREE.WebGLRenderTarget(size, size, {
    format: THREE.RedFormat, // the colour attachment only exists because a framebuffer needs one: R8, writes masked
    type: THREE.UnsignedByteType,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
    depthBuffer: true,
    stencilBuffer: false,
    depthTexture: depth,
  });
  rt.texture.name = 'lanternShadowColor';
  return rt;
}

function triCount(geo) {
  if (!geo) return 0;
  return geo.index ? geo.index.count / 3 : geo.attributes.position ? geo.attributes.position.count / 3 : 0;
}

function shadowCamera() {
  const c = new THREE.PerspectiveCamera();
  c.matrixAutoUpdate = false;
  c.matrixWorldAutoUpdate = false;
  c.name = 'LanternShadowCamera';
  return c;
}

export class LanternShadow {
  /** @param {object} r3d Renderer3D (.renderer .scene .camera .lantern .lighting .governor .settings .levelView) */
  constructor(r3d) {
    this.r3d = r3d;
    this._apiOn = true;
    this._tierOverride = null;
    this.plan = shadowPlan('low');
    this.k = 0; // strength 0..1 (eased: no pop when the tier / governor switches it)
    this._rtS = null;
    this._rtD = null;
    this._sizeS = 0;
    this._sizeD = 0;
    this._camS = shadowCamera();
    this._camD = shadowCamera();
    this._camS.layers.set(SHADOW_LAYER_STATIC);
    this._camD.layers.set(SHADOW_LAYER_DYNAMIC);
    this._matS = new THREE.Matrix4(); // world -> static map (uv, depth 0..1) the cached map was made with
    this._matD = new THREE.Matrix4();
    this._cache = makeStaticCache();
    this._axis = { x: 0, y: 0, z: -1 };
    this._axisInit = false;
    this._pose = { x: 0, y: 0, z: 0, ax: 0, ay: 0, az: -1 };
    this._stamp = 1; // bumped when the static casters change (pack / decor selection / level)
    this._frame = 0;
    this._time = 0;
    this._dt = 1 / 72;
    this._offT = 0;
    this._readyS = false;
    this._readyD = false;
    this._discoverT = 0;
    this._dynObjs = []; // every object flagged as a dynamic caster (count only; the layer does the selecting)
    this._lod = []; // { show: Mesh[] } meshes drawn only in the dynamic pass (the creature's LOD1 while LOD0 is the visible one)
    this._proxies = new Map(); // key -> { sig, meshes: Mesh[] (proxies), vis: () => bool } low-poly dynamic casters (see lanternShadowProxy.js)
    this._decorOn = new Set();
    this._decorTris = new WeakMap();
    this._decorKey = 0;
    this._level = null;
    this._boxes = null; // Float32Array(6N) solid AABBs
    this._refs = null; // solid objects (active flag)
    this._candIdx = null;
    this._candKey = null;
    this._cand = [];
    this._packAt = new THREE.Vector3(1e9, 1e9, 1e9);
    this._packT = -1e9;
    this._packHash = -1;
    this._packN = 0;
    this._matStatic = makeDepthMaterial(THREE.BackSide, 1.2, 1);
    this._matDyn = makeDepthMaterial(THREE.DoubleSide, 2, 4);
    this._proxy = null;
    // A shadow sampler must NEVER be left without a real depth texture: a null value makes three bind its never-uploaded empty
    // texture, and WebGL then fails every draw of every program that has the sampler ("texture format and sampler type mismatch").
    // So the uniforms hold a tiny initialised dummy target until the real maps exist (and after they are freed / a context restore).
    this._dummy = null;
    this._ctxLost = false;
    const cv = r3d.renderer && r3d.renderer.domElement;
    if (cv && typeof cv.addEventListener === 'function') {
      this._onLost = () => {
        this._ctxLost = true;
        this._readyS = this._readyD = false;
        this._cache.valid = false;
      };
      this._onRestored = () => {
        this._ctxLost = false;
        this._readyS = this._readyD = false;
        this._cache.valid = false;
        this._dummy = null; // re-created (its GL objects went with the old context)
        this._rtS = this._rtD = null;
        this._sizeS = this._sizeD = 0;
        this._useDummy();
      };
      cv.addEventListener('webglcontextlost', this._onLost);
      cv.addEventListener('webglcontextrestored', this._onRestored);
    }
    this._useDummy();
    this.stats = {
      tier: 'low', enabled: false, strength: 0, calls: 0, tris: 0, staticCalls: 0, staticTris: 0, dynCalls: 0, dynTris: 0,
      staticRefreshes: 0, dynRenders: 0, casters: 0, proxies: 0, decorChunks: 0, decorTris: 0, mapStatic: 0, mapDyn: 0, packs: 0,
    };
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  /** Master switch of the feature (default on; the tier / governor still decide). */
  setEnabled(on) {
    this._apiOn = on !== false;
    return this._apiOn;
  }

  /** Pins the shadow tier ('low' = off | 'quest' | 'high'); null follows the lighting tier. */
  setTier(name) {
    this._tierOverride = name == null ? null : shadowTierName(name);
    return this.tier;
  }

  get tier() {
    return this._tierOverride || this.r3d.lighting.tier;
  }

  /** Effective this frame (tier, governor, API switch) and not yet faded out. */
  get enabled() {
    return this.plan.enabled && this.k > 0.01;
  }

  /** Receive the shadow: another module's MeshStandardMaterial (the renderer's sweep does this for every lit material it finds). */
  attach(material) {
    return attachLanternShadow(material);
  }

  /** Flags `object` (and its descendants) as a shadow caster: 'dynamic' (default; rendered every frame) or 'static' (cached). */
  addCaster(object, kind = 'dynamic') {
    if (!object) return object;
    const layer = kind === 'static' ? SHADOW_LAYER_STATIC : SHADOW_LAYER_DYNAMIC;
    object.traverse((o) => {
      if ((o.isMesh || o.isInstancedMesh) && !o.userData.noShadowCast) {
        o.layers.enable(layer);
        if (layer === SHADOW_LAYER_DYNAMIC && !o.userData.lsDyn) {
          o.userData.lsDyn = true;
          this._dynObjs.push(o);
        }
      }
    });
    return object;
  }

  /**
   * Dynamic casters drawn as welded low-poly stand-ins (hands + launchers, body, creature LOD1): the depth pass only needs the
   * silhouette at the map's 1-4 cm texel. Sources are grouped by (parent, skeleton, local transform) so each group is ONE call.
   * The sources themselves are NOT flagged as casters. Falls back to addCaster for anything that cannot be welded.
   * @param {string} key  stable slot name (a changed source list rebuilds the slot)
   * @param {THREE.Mesh[]} sources
   * @param {number} cell  weld cell (m)
   * @param {() => boolean} vis  whether the stand-ins are drawn this frame
   */
  addProxyCaster(key, sources, cell, vis) {
    const list = (sources || []).filter((m) => m && m.isMesh && !m.userData.noShadowCast);
    const sig = list.map((m) => m.uuid).join(',');
    const old = this._proxies.get(key);
    if (old && old.sig === sig) return;
    if (old) this._dropProxy(old);
    if (!list.length) return;
    const groups = new Map();
    const rest = [];
    for (const m of list) {
      if (m.isInstancedMesh || !m.parent || !m.geometry || !m.geometry.attributes.position || (m.isSkinnedMesh && !m.skeleton)) {
        rest.push(m);
        continue;
      }
      m.updateMatrix();
      const k = `${m.parent.uuid}|${m.isSkinnedMesh ? m.skeleton.uuid + m.bindMode + m.bindMatrix.elements.join(',') : ''}|${m.matrix.elements.join(',')}`;
      let g = groups.get(k);
      if (!g) groups.set(k, (g = []));
      g.push(m);
    }
    const rec = { sig, meshes: [], vis: vis || (() => true), src: list };
    for (const g of groups.values()) {
      const geo = clusterGeometries(g.map((m) => m.geometry), cell);
      if (!geo) {
        rest.push(...g);
        continue;
      }
      const s0 = g[0];
      const proxy = s0.isSkinnedMesh ? new THREE.SkinnedMesh(geo, this._matDyn) : new THREE.Mesh(geo, this._matDyn);
      if (s0.isSkinnedMesh) {
        proxy.bindMode = s0.bindMode;
        proxy.bind(s0.skeleton, s0.bindMatrix);
      }
      proxy.name = 'lsProxy';
      proxy.matrixAutoUpdate = false;
      proxy.matrix.copy(s0.matrix);
      proxy.frustumCulled = false;
      proxy.layers.set(SHADOW_LAYER_DYNAMIC); // never drawn by the head camera
      proxy.userData.noShadowRecv = true;
      proxy.userData.lsDyn = true;
      s0.parent.add(proxy);
      rec.meshes.push(proxy);
      this._dynObjs.push(proxy);
    }
    for (const m of rest) this.addCaster(m);
    this._proxies.set(key, rec);
  }

  _dropProxy(rec) {
    for (const p of rec.meshes) {
      if (p.parent) p.parent.remove(p);
      if (p.geometry) p.geometry.dispose();
      const i = this._dynObjs.indexOf(p);
      if (i >= 0) this._dynObjs.splice(i, 1);
    }
    rec.meshes.length = 0;
  }

  // ---------------------------------------------------------------------------
  // Level
  // ---------------------------------------------------------------------------
  /** Hands the level's solids to the static proxy (call after levelView.build). */
  setLevel(level) {
    this._level = level || null;
    this._boxes = null;
    this._refs = null;
    const sets = this.r3d.levelView && this.r3d.levelView._solidSets;
    if (!sets) return;
    let n = 0;
    for (const s of sets) n += s.list.length;
    const boxes = new Float32Array(n * 6);
    const refs = new Array(n);
    let i = 0;
    for (const set of sets) {
      if (set.mesh && set.mesh.name === 'solids_grate') continue; // see-through: never casts
      for (const s of set.list) {
        if (!s) continue;
        boxes[i * 6] = s.minX;
        boxes[i * 6 + 1] = s.minY;
        boxes[i * 6 + 2] = s.minZ;
        boxes[i * 6 + 3] = s.maxX;
        boxes[i * 6 + 4] = s.maxY;
        boxes[i * 6 + 5] = s.maxZ;
        refs[i] = s;
        i++;
      }
    }
    this._boxes = boxes.subarray(0, i * 6);
    this._refs = refs;
    this._refs.length = i;
    this._candIdx = new Int32Array(i);
    this._candKey = new Float32Array(i);
    this._packAt.set(1e9, 1e9, 1e9);
    this._packHash = -1;
    this._stamp++;
  }

  _ensureProxy() {
    if (this._proxy) return this._proxy;
    const max = Math.max(PROXY_MAX.quest, PROXY_MAX.high);
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), this._matStatic, max);
    mesh.name = 'LanternShadowProxy';
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.count = 0;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.layers.set(SHADOW_LAYER_STATIC); // never drawn by the head camera
    mesh.userData.noShadowRecv = true;
    mesh.userData.noLook = true;
    this.r3d.scene.add(mesh);
    this._proxy = mesh;
    return mesh;
  }

  // ---------------------------------------------------------------------------
  // Per frame: plan, strength, caster discovery (cheap; the passes are in render())
  // ---------------------------------------------------------------------------
  update(dt, game) {
    const r3d = this.r3d;
    this._dt = dt > 0 ? dt : this._dt;
    this._time += this._dt;
    if (!this._readyS || !this._readyD) this._useDummy();
    const gov = 0; // the frame governor trades resolution only; the shadow keeps its tier
    const settings = (game && game.settings) || r3d.settings || {};
    const plan = shadowPlan(this.tier, { govLevel: gov, reduced: !!settings.reducedEffects, enabled: this._apiOn });
    this.plan = plan;
    const want = plan.enabled && !!this._level ? 1 : 0;
    this.k += (want - this.k) * Math.min(1, this._dt * (want ? 5 : 8));
    if (want === 0 && this.k < 0.004) {
      this.k = 0;
      this._offT += this._dt;
      if (this._offT > 6) this._freeTargets(); // off for a while: give the memory back
    } else this._offT = 0;
    if (plan.enabled && !this._warmed) this.warm(); // compile the depth programs on the menu, not mid-run
    if (plan.enabled && game) {
      this._discoverT -= this._dt;
      if (this._discoverT <= 0) {
        this._discoverT = DISCOVER_EVERY;
        this._discover(game);
      }
    }
    const st = this.stats;
    st.tier = plan.tier;
    st.enabled = plan.enabled;
    st.strength = this.k;
  }

  _discover(game) {
    const hv = game.handsView;
    if (hv && hv.gear) {
      for (const h of ['left', 'right']) {
        const g = hv.gear[h];
        if (g && g.meshes) this.addProxyCaster('hand-' + h, g.meshes, PROXY_CELL.hand, () => g.meshes.some((m) => m.visible));
      }
    }
    const bv = game.bodyView;
    if (bv && bv.mesh) this.addProxyCaster('body', [bv.mesh], PROXY_CELL.body, () => bv.mesh.visible);
    const rv = this.r3d.ropeView;
    if (rv && rv.strands) {
      if (rv.strands.left && rv.strands.left.mesh) this.addCaster(rv.strands.left.mesh);
      if (rv.strands.right && rv.strands.right.mesh) this.addCaster(rv.strands.right.mesh);
    }
    const dp = this.r3d.droppedProps;
    if (dp && dp.mesh) this.addCaster(dp.mesh);
    const pv = game.pickupsView;
    if (pv && pv.props) this.addCaster(pv.props);
    const lv = this.r3d.levelView;
    if (lv && lv._crumbleMesh) this.addCaster(lv._crumbleMesh);
    const sd = game.sceneDetail; // the scene-detail props (bones, crates, rubble; ~5 k triangles, 1 call); its decals / puddles are flat and never cast
    if (sd && sd.propsMesh) this.addCaster(sd.propsMesh);
    const cv = game.creatureView;
    // the creature: LOD1 casts even while LOD0 is the one drawn (rig: meshes[lod]; kit fallback: lods[i].meshes)
    const lods = cv ? (cv.isRig && cv.meshes ? cv.meshes : Array.isArray(cv.lods) ? cv.lods.map((l) => l.meshes) : null) : null;
    if (lods && lods[0] && cv._lsDone !== lods[0]) {
      cv._lsDone = lods[0];
      this._lod.length = 0; // a replaced creature view (kit -> rig) drops the old entry
      const lod1 = lods[1] && lods[1] !== lods[0] ? lods[1] : lods[0];
      this.addProxyCaster('creature', lod1, PROXY_CELL.creature, () => !!(cv.root && cv.root.visible));
      const rec = this._proxies.get('creature');
      if (!rec || !rec.meshes.length) {
        // nothing could be welded (kit creature): the old behaviour, LOD1 stands in for LOD0 inside this pass only
        for (const m of lod1) this.addCaster(m);
        if (lod1 !== lods[0]) this._lod.push({ view: cv, show: lod1, was: false });
      }
    }
    this.stats.casters = this._dynObjs.length;
  }

  // ---------------------------------------------------------------------------
  // Static proxies: the solids near the lantern as one instanced box mesh
  // ---------------------------------------------------------------------------
  _pack(px, py, pz, R, cap, force) {
    const boxes = this._boxes;
    if (!boxes || !boxes.length) {
      if (this._proxy) this._proxy.count = 0;
      return false;
    }
    const moved = this._packAt.distanceToSquared(_v.set(px, py, pz)) > REPACK_MOVE * REPACK_MOVE;
    if (!force && !moved && this._time - this._packT < REPACK_EVERY) return false;
    this._packT = this._time;
    this._packAt.set(px, py, pz);
    const mesh = this._ensureProxy();
    const refs = this._refs;
    const idx = this._candIdx;
    const key = this._candKey;
    const rr = (R + 3) * (R + 3);
    let m = 0;
    for (let i = 0, n = refs.length; i < n; i++) {
      if (refs[i].active === false) continue;
      const o = i * 6;
      const dx = Math.max(boxes[o] - px, 0, px - boxes[o + 3]);
      const dy = Math.max(boxes[o + 1] - py, 0, py - boxes[o + 4]);
      const dz = Math.max(boxes[o + 2] - pz, 0, pz - boxes[o + 5]);
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > rr) continue;
      idx[m] = i;
      key[m] = d2;
      m++;
    }
    let take = m;
    let list = null;
    if (m > cap) {
      // the nearest `cap` (a rare path: the sort allocates nothing we keep)
      const c = this._cand;
      c.length = m;
      for (let i = 0; i < m; i++) c[i] = i;
      c.sort((a, b) => key[a] - key[b]);
      take = cap;
      list = c;
    }
    const arr = mesh.instanceMatrix.array;
    let hash = take;
    for (let j = 0; j < take; j++) {
      const i = list ? idx[list[j]] : idx[j];
      const o = i * 6;
      const q = j * 16;
      const sx = Math.max(0.01, boxes[o + 3] - boxes[o]);
      const sy = Math.max(0.01, boxes[o + 4] - boxes[o + 1]);
      const sz = Math.max(0.01, boxes[o + 5] - boxes[o + 2]);
      arr[q] = sx;
      arr[q + 1] = 0;
      arr[q + 2] = 0;
      arr[q + 3] = 0;
      arr[q + 4] = 0;
      arr[q + 5] = sy;
      arr[q + 6] = 0;
      arr[q + 7] = 0;
      arr[q + 8] = 0;
      arr[q + 9] = 0;
      arr[q + 10] = sz;
      arr[q + 11] = 0;
      arr[q + 12] = boxes[o] + sx * 0.5;
      arr[q + 13] = boxes[o + 1] + sy * 0.5;
      arr[q + 14] = boxes[o + 2] + sz * 0.5;
      arr[q + 15] = 1;
      hash = (hash * 31 + i) | 0;
    }
    this.stats.packs++;
    this.stats.proxies = take;
    if (hash === this._packHash && take === this._packN) return false; // same casters: the cached map stays valid
    this._packHash = hash;
    this._packN = take;
    mesh.count = take;
    mesh.instanceMatrix.needsUpdate = true;
    this._stamp++;
    return true;
  }

  /** Small decor chunks near the lantern join the static pass (budgeted by triangles); returns true when the set changed. */
  _selectDecor(px, py, pz, R, tierKey) {
    const lv = this.r3d.levelView;
    const chunks = lv && lv._chunks;
    if (!chunks) return false;
    const budget = DECOR_TRI_BUDGET[tierKey] || 0;
    const maxOne = DECOR_CHUNK_MAX[tierKey] || 0;
    const maxN = DECOR_CHUNK_COUNT[tierKey] || 0;
    let sum = 0;
    let n = 0;
    let key = 17;
    const on = this._decorOn;
    const next = [];
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const o = c.obj;
      if (!o.visible || !DECOR_NAME.test(o.name)) continue;
      let t = this._decorTris.get(o.geometry);
      if (t === undefined) {
        t = triCount(o.geometry);
        this._decorTris.set(o.geometry, t);
      }
      if (t > maxOne || sum + t > budget || n >= maxN) continue;
      if (c.box.distanceToPoint(_v.set(px, py, pz)) > R) continue;
      sum += t;
      n++;
      next.push(o);
      key = (key * 31 + i) | 0;
    }
    if (key === this._decorKey && n === on.size) return false;
    this._decorKey = key;
    for (const o of on) o.layers.disable(SHADOW_LAYER_STATIC);
    on.clear();
    for (const o of next) {
      o.layers.enable(SHADOW_LAYER_STATIC);
      on.add(o);
    }
    this.stats.decorChunks = n;
    this.stats.decorTris = sum;
    this._stamp++;
    return true;
  }

  // ---------------------------------------------------------------------------
  // Render targets
  // ---------------------------------------------------------------------------
  /** Points both shadow samplers at the initialised dummy depth texture (strength stays 0 until the real maps exist). */
  _useDummy() {
    const r = this.r3d.renderer;
    if (!r || typeof r.initRenderTarget !== 'function') return;
    try {
      if (!this._dummy) this._dummy = makeTarget(4);
      r.initRenderTarget(this._dummy); // a no-op once its GL objects exist
      if (!this._readyS) LSHADOW.uLSMapS.value = this._dummy.depthTexture;
      if (!this._readyD) LSHADOW.uLSMapD.value = this._dummy.depthTexture;
    } catch {
      /* no dummy: the receivers keep strength 0 and three binds its own empty texture (only a risk on an old GPU) */
    }
  }

  _ensureTargets(sizeS, sizeD) {
    if (sizeS !== this._sizeS || !this._rtS) {
      if (this._rtS) this._rtS.dispose();
      this._rtS = makeTarget(sizeS);
      this._sizeS = sizeS;
      this._readyS = false;
      this._cache.valid = false;
      this._useDummy();
    }
    if (sizeD !== this._sizeD || !this._rtD) {
      if (this._rtD) this._rtD.dispose();
      this._rtD = makeTarget(sizeD);
      this._sizeD = sizeD;
      this._readyD = false;
      this._useDummy();
    }
  }

  _freeTargets() {
    if (this._rtS) this._rtS.dispose();
    if (this._rtD) this._rtD.dispose();
    this._rtS = this._rtD = null;
    this._sizeS = this._sizeD = 0;
    this._readyS = this._readyD = false;
    this._cache.valid = false;
    LSHADOW.uLSK.value.x = 0;
    this._useDummy();
    if (this._proxy) this._proxy.count = 0;
    this._packHash = -1;
    for (const o of this._decorOn) o.layers.disable(SHADOW_LAYER_STATIC);
    this._decorOn.clear();
    this._decorKey = 0;
  }

  /** Aims a shadow camera: apex p, unit axis a, square cone (fit), writes the world -> map matrix into `outM`. */
  _aim(cam, px, py, pz, ax, ay, az, fit, outM) {
    _back.set(-ax, -ay, -az);
    if (Math.abs(ay) > 0.96) _up.set(1, 0, 0);
    else _up.set(0, 1, 0);
    _right.crossVectors(_up, _back).normalize();
    _up.crossVectors(_back, _right).normalize();
    cam.matrixWorld.makeBasis(_right, _up, _back).setPosition(px, py, pz);
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    const n = fit.near;
    const t = fit.tanHalf * n;
    cam.near = n;
    cam.far = fit.far;
    cam.projectionMatrix.makePerspective(-t, t, t, -t, n, fit.far);
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    outM.copy(_bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
  }

  // ---------------------------------------------------------------------------
  // The passes
  // ---------------------------------------------------------------------------
  _pass(rt, cam, mat) {
    const r = this.r3d.renderer;
    const scene = this.r3d.scene;
    const info = r.info.render;
    const c0 = info.calls;
    const t0 = info.triangles;
    const prevRT = r.getRenderTarget();
    const prevXr = r.xr.enabled;
    const prevAuto = r.autoClear;
    const prevBg = scene.background;
    const prevFog = scene.fog;
    const prevOv = scene.overrideMaterial;
    const prevMw = scene.matrixWorldAutoUpdate;
    r.xr.enabled = false; // an XR session would otherwise swap in the eye cameras (three.js: a render target pass needs xr off)
    r.autoClear = true;
    scene.background = null;
    scene.fog = null;
    scene.overrideMaterial = mat;
    scene.matrixWorldAutoUpdate = false; // updated once for the three renders of this frame
    try {
      r.setRenderTarget(rt);
      r.render(scene, cam);
    } finally {
      scene.matrixWorldAutoUpdate = prevMw;
      scene.overrideMaterial = prevOv;
      scene.fog = prevFog;
      scene.background = prevBg;
      r.autoClear = prevAuto;
      r.xr.enabled = prevXr;
      r.setRenderTarget(prevRT);
    }
    this._lastCalls = info.calls - c0;
    this._lastTris = info.triangles - t0;
  }

  /** Both passes for this frame (called by Renderer3D.render() before the main render). */
  render() {
    const st = this.stats;
    st.calls = st.tris = st.staticCalls = st.staticTris = st.dynCalls = st.dynTris = 0;
    const plan = this.plan;
    const u = LSHADOW.uLSK.value;
    if (!plan.enabled || !this._level || this.k < 0.004) {
      u.x = 0;
      return;
    }
    const r3d = this.r3d;
    const lantern = r3d.lantern;
    if (!lantern) {
      u.x = 0;
      return;
    }
    const tierKey = plan.tier === 'high' ? 'high' : 'quest';
    this._ensureTargets(plan.staticSize, plan.dynSize);
    r3d.scene.updateMatrixWorld();
    lantern.updateWorldMatrix(true, false);
    lantern.getWorldPosition(_v);
    const px = _v.x;
    const py = _v.y;
    const pz = _v.z;
    r3d.camera.getWorldDirection(_v);
    if (!this._axisInit) {
      this._axis.x = _v.x;
      this._axis.y = _v.y;
      this._axis.z = _v.z;
      this._axisInit = true;
    } else smoothAxis(this._axis, _v.x, _v.y, _v.z, 1 - Math.exp(-AXIS_RATE * this._dt));
    const A = this._axis;
    const pose = this._pose;
    pose.x = px;
    pose.y = py;
    pose.z = pz;
    pose.ax = A.x;
    pose.ay = A.y;
    pose.az = A.z;

    // ---- static map ----
    this._pack(px, py, pz, plan.radius, PROXY_MAX[tierKey], false);
    const cache = this._cache;
    if (staticNeedsRefresh(cache, pose, plan, this._time, this._stamp)) {
      this._selectDecor(px, py, pz, plan.radius, tierKey);
      // a decor change bumps the stamp: the refresh below uses the current one
      coneFit(plan.fovDeg, plan.staticSize, plan.radius, _fit);
      this._aim(this._camS, px, py, pz, A.x, A.y, A.z, _fit, this._matS);
      this._pass(this._rtS, this._camS, this._matStatic);
      markStaticRefreshed(cache, pose, plan, this._time, this._stamp);
      st.staticCalls = this._lastCalls;
      st.staticTris = this._lastTris;
      st.staticRefreshes++;
      st.mapStatic = plan.staticSize;
      cache.texel = _fit.texel;
      cache.fadeFar = _fit.fadeFar;
      LSHADOW.uLSMapS.value = this._rtS.depthTexture;
      LSHADOW.uLSMS.value.copy(this._matS);
      this._readyS = true;
    }

    // ---- dynamic map ----
    if (dynamicDue(this._frame, plan) || !this._readyD) {
      coneFit(plan.fovDeg, plan.dynSize, plan.radius, _fit);
      this._aim(this._camD, px, py, pz, A.x, A.y, A.z, _fit, this._matD);
      // the creature's LOD1 stands in for LOD0 inside this pass only
      const swapped = this._lod;
      let any = false;
      for (let i = 0; i < swapped.length; i++) {
        const e = swapped[i];
        e.was = e.show.length ? e.show[0].visible : false;
        if (e.view.root && e.view.root.visible) {
          for (const m of e.show) m.visible = true;
          any = true;
        }
      }
      for (const rec of this._proxies.values()) {
        const on = rec.vis();
        for (const p of rec.meshes) p.visible = on;
      }
      this._pass(this._rtD, this._camD, this._matDyn);
      if (any) for (let i = 0; i < swapped.length; i++) for (const m of swapped[i].show) m.visible = swapped[i].was;
      st.dynCalls = this._lastCalls;
      st.dynTris = this._lastTris;
      st.dynRenders++;
      st.mapDyn = plan.dynSize;
      this._dynTexel = _fit.texel;
      LSHADOW.uLSMapD.value = this._rtD.depthTexture;
      LSHADOW.uLSMD.value.copy(this._matD);
      this._readyD = true;
    }

    u.x = this._readyS && this._readyD ? this.k : 0;
    u.y = cache.texel || 0.003;
    u.z = this._dynTexel || 0.006;
    u.w = plan.radius;
    st.calls = st.staticCalls + st.dynCalls;
    st.tris = st.staticTris + st.dynTris;
    this._frame++;
  }

  // ---------------------------------------------------------------------------
  // Startup
  // ---------------------------------------------------------------------------
  /** Compiles the depth programs (plain, instanced, skinned) with the target format in place, so no hitch on first sight. */
  warm() {
    const r3d = this.r3d;
    if (this._warmed || !this.plan.enabled) return;
    this._warmed = true;
    try {
      const r = r3d.renderer;
      const sc = new THREE.Scene();
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const parts = [];
      for (const mat of [this._matStatic, this._matDyn]) {
        parts.push(new THREE.Mesh(geo, mat));
        parts.push(new THREE.InstancedMesh(geo, mat, 1));
        const g2 = geo.clone();
        const n = g2.attributes.position.count;
        g2.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
        const w = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) w[i * 4] = 1;
        g2.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
        const sm = new THREE.SkinnedMesh(g2, mat);
        const bone = new THREE.Bone();
        sm.add(bone);
        sm.bind(new THREE.Skeleton([bone]));
        parts.push(sm);
      }
      for (const p of parts) sc.add(p);
      this._ensureTargets(this.plan.staticSize, this.plan.dynSize);
      const prevRT = r.getRenderTarget();
      const prevXr = r.xr.enabled;
      r.xr.enabled = false;
      r.setRenderTarget(this._rtS);
      r.compile(sc, this._camS);
      r.setRenderTarget(prevRT);
      r.xr.enabled = prevXr;
      for (const p of parts) {
        if (p.skeleton) p.skeleton.dispose();
        if (p.isInstancedMesh) p.dispose();
      }
    } catch {
      /* the programs compile on first use instead */
    }
  }

  dispose() {
    this._freeTargets();
    if (this._proxy) {
      if (this._proxy.parent) this._proxy.parent.remove(this._proxy);
      this._proxy.geometry.dispose();
      this._proxy.dispose();
      this._proxy = null;
    }
    const cv = this.r3d.renderer && this.r3d.renderer.domElement;
    if (cv && this._onLost) {
      cv.removeEventListener('webglcontextlost', this._onLost);
      cv.removeEventListener('webglcontextrestored', this._onRestored);
    }
    LSHADOW.uLSK.value.x = 0;
    LSHADOW.uLSMapS.value = LSHADOW.uLSMapD.value = null;
    if (this._dummy) this._dummy.dispose();
    this._dummy = null;
    this._matStatic.dispose();
    this._matDyn.dispose();
  }
}
