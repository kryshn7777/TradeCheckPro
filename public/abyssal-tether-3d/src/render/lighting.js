/* ABYSSAL TETHER 3D — lighting.js
 * The lighting look of the world, owned by Renderer3D (`renderer.lighting`):
 *
 *  - reflections: one procedural environment probe (envProbe.js; PMREM, cross-faded between sections) shared by every
 *    standard material; metal reflects strongly, wet stone through the shared wetness uniform, dry stone weakly;
 *  - baked LIGHTMAPS (the Quest look): global illumination baked per face of every static solid box
 *    (assets/lighting/lm_ch1_*, tools/abyssal-tether-3d/bake/bake_lightmaps.mjs): ambient occlusion, soft lamp and
 *    shaft-key shadows, colour bleeding, bounces. One texture-array fetch per lightmapped fragment replaces the
 *    hemisphere ambient, the shaft key, the volume and the two pooled lamps for the solids; the lantern still adds
 *    its own light. Lamp design: the flickering flame lamps' DIRECT light sits in the lightmap's alpha channel and is
 *    multiplied at run time by the section's lamp tint and the lamps' current flicker (RGB holds everything steady,
 *    including the lamps' bounces), so the baked pools still breathe; the pooled PointLights (decay 2, the lantern is
 *    1.6) are switched off on lightmapped surfaces in the shader, so nothing is counted twice. They stay on for decor,
 *    creature, hands, body and pickups;
 *  - baked GI volume: the static bounce light + ambient occlusion + shaft-key visibility volume
 *    (assets/lighting/gi_ch1.bin from tools/abyssal-tether-3d/bake/bake_gi.mjs), sampled once per fragment by the
 *    lit-surface shader patch (materials.js). Lights everything that is not lightmapped (decor, creature, hands, body,
 *    pickups, crumbling ledges, variant-specific pieces) and the whole level in the `low` tier;
 *  - the wet film glint of the lantern (uniform-driven lobe in the same patch);
 *  - quality tiers `low | quest | high` (same names as fx.js: ?fx=, settings.fxQuality, settings.reducedEffects,
 *    XR → quest, otherwise high) that only change uniforms and distances at run time, so no program ever recompiles;
 *    the probe resolution is chosen when the probe is created (a Quest browser starts at `quest`);
 *  - `applyLookTo(material)`: gives any other module's standard material the shared reflection with a sensible
 *    intensity (the renderer also does it automatically for every unclaimed standard material in precompile()).
 *
 * Tier table (what a tier changes):
 *   low    reflections off (fetch branch-skipped), no baked GI sample, no wet glint, far detail ×0.55, no lightmaps when
 *          pinned (?fx=low / setQualityTier('low')); reducedEffects and the governor's low step KEEP the lightmaps
 *          (one fetch, no volume fetch: they cost no more than the volume they replace)                (≈ stock cost)
 *   quest  reflections ×1 (probe 128 px, 2 fetches), lightmaps (1 array fetch) + volume for the rest, wet glint, far detail ×1
 *   high   reflections ×1.1 (probe 256 px), lightmaps + volume, wet glint, far detail ×1.35
 * Governor steps (platform/governor.js level, or renderer.governor.update(frameMs) when no platform governor exists):
 *   level ≥ 2  wet glint off, far detail ×0.85      level ≥ 3  `low` tier (the platform governor also switches fx to low)
 */

import * as THREE from 'three';
import { LOOK } from './materials.js';
import { EnvProbe, DEFAULT_ENV_SPEC } from './envProbe.js';
import { GI_HEADER_BYTES, levelGiHash, readHeader, undelta } from './giFormat.js';
import { LM_INDEX_NAME, buildChartTable, levelLmHash, lmUndelta, readLmHeader, LM_HEADER_BYTES } from './lightmapFormat.js';
import { RenderGovernor } from './renderGovernor.js';
import { defaultTier } from '../platform/deviceProfile.js';

const TIER_ALIAS = { low: 'low', reduced: 'low', quest: 'quest', xr: 'quest', medium: 'quest', high: 'high', desktop: 'high' };
export const QUALITY_TIERS = Object.freeze({
  low: Object.freeze({ name: 'low', env: 0, envSize: 32, gi: false, lm: false, coat: 0, detail: 0.55 }),
  quest: Object.freeze({ name: 'quest', env: 1, envSize: 128, gi: true, lm: true, coat: 1, detail: 0.85 }), // detail: far-detail / mid / neighbour draw distances x0.85 (BUDGET_CH1)
  high: Object.freeze({ name: 'high', env: 1.1, envSize: 256, gi: true, lm: true, coat: 1, detail: 1.35 }),
});
export const GI_URL = new URL('../../assets/lighting/gi_ch1.bin', import.meta.url).href;
export const LM_BASE_URL = new URL('../../assets/lighting/', import.meta.url).href;
/** Lightmap grading defaults: exposure multiplies the baked irradiance, floor adds a little ambient everywhere (so the darkest corners stay readable). */
export const LM_TUNE = { exposure: 1.5, floor: 0.012, lanternGain: 1.05, lanternFalloff: 0.38 };

const FLAME = new THREE.Color(1.0, 0.56, 0.22);
const _c = new THREE.Color();
const _v = new THREE.Vector3();

function num(v, fb) {
  return typeof v === 'number' && isFinite(v) ? v : fb;
}

export function tierName(v) {
  return typeof v === 'string' && TIER_ALIAS[v.toLowerCase()] ? TIER_ALIAS[v.toLowerCase()] : null;
}

function urlTier() {
  try {
    if (typeof location === 'undefined') return null;
    const m = /[?&]fx=([a-z]+)/i.exec(location.search || '');
    return m ? tierName(m[1]) : null;
  } catch {
    return null;
  }
}

export class Lighting {
  /**
   * @param {object} r3d  Renderer3D (reads .renderer, .scene, .materials, .lantern, .envLights, .levelView, .settings)
   */
  constructor(r3d) {
    this.r3d = r3d;
    this.settings = r3d.settings || {};
    this.pinned = null; // a tier name set through setQualityTier()
    this.tier = urlTier() || defaultTier();
    if (this.settings.reducedEffects) this.tier = 'low';
    this.cfg = QUALITY_TIERS[this.tier];
    this.govLevel = 0;
    this.probe = null;
    this._pendingMaterials = new Set();
    this.stats = {
      tier: this.tier, envSize: 0, envBuilds: 0, envBlits: 0, giLoaded: false, giBytes: 0, giMs: 0, giState: 'none', swept: 0,
      lmLoaded: false, lmState: 'none', lmBytes: 0, lmMs: 0, lmPages: 0, lmGpuBytes: 0, lmSolids: 0,
    };
    this.lmTune = Object.assign({}, LM_TUNE); // live grading knobs (exposure, ambient floor)
    this.dark = 0; // 0..1, the difficulty's darkness (setDarkness): dims the baked light
    this._lm = null; // { tex, tab, index }
    this._lmPromise = null;
    this._lmForcedOff = false; // pinned / ?fx= low tier: the old volume only
    this._gi = null; // { tex, meta }
    this._giPromise = null;
    this._level = null;
    this._sections = 0;
    this._sweepAt = 0;
    this._lastObjects = -1;
    this._pumpAt = 0;
    this._lmForcedOff = urlTier() === 'low';
    this._buildProbe(this.cfg.envSize);
    this._applyUniforms(true);
  }

  // ---------------------------------------------------------------------------
  // Probe
  // ---------------------------------------------------------------------------
  _buildProbe(size) {
    const r = this.r3d.renderer;
    try {
      if (this.probe) this.probe.dispose();
      this.probe = new EnvProbe(r, { size });
      this.stats.envSize = size;
      this.r3d.materials.setEnvironment(this.probe.texture);
      for (const m of this._pendingMaterials) this._assignEnv(m);
      if (this._sections) this.probe.setSections(this._specs || []);
    } catch (err) {
      this.probe = null;
      this.cfg = Object.assign({}, this.cfg, { env: 0 });
      if (typeof console !== 'undefined') console.warn('[AT3D] reflection probe unavailable', err);
    }
  }

  /**
   * The section as a room for the reflection probe (envProbe.js): the shaft box (the same one the material shader corrects the
   * parallax against), the real lights of the section (window lights = cool, strong, steady lights against a wall) and the authored
   * light shafts. Empty without a shaft (the probe then draws its generic cathedral).
   */
  _roomSpec(level, sec, i) {
    const sh = sec && sec.shaft;
    if (!sh || !isFinite(sh.minX + sh.maxX + sh.minZ + sh.maxZ + sec.yTop + sec.yBottom)) return {};
    const cx = (sh.minX + sh.maxX) * 0.5;
    const cy = (sec.yTop + sec.yBottom) * 0.5;
    const cz = (sh.minZ + sh.maxZ) * 0.5;
    const hx = Math.max(4, (sh.maxX - sh.minX) * 0.5);
    const hy = Math.max(6, (sec.yTop - sec.yBottom) * 0.5);
    const hz = Math.max(4, (sh.maxZ - sh.minZ) * 0.5);
    const lampList = [];
    for (const l of level.lights || []) {
      if (!l || l.far || (l.section != null ? l.section : level.sectionIndexAt(l.y)) !== i) continue;
      _c.set(l.color);
      const nearWall = Math.min(Math.abs(l.x - sh.minX), Math.abs(l.x - sh.maxX), Math.abs(l.z - sh.minZ), Math.abs(l.z - sh.maxZ)) < 4;
      const win = nearWall && !l.still && (l.flicker || 0) < 0.01 && l.intensity >= 2.4 && l.range >= 40 && _c.b >= _c.r * 1.05;
      lampList.push({ x: l.x, y: l.y, z: l.z, r: _c.r, g: _c.g, b: _c.b, k: l.intensity, range: Math.max(6, l.range), win });
    }
    lampList.sort((a, b) => b.k - a.k);
    const beamList = [];
    for (const d of level.decor || []) {
      if (!d || (d.section != null ? d.section : level.sectionIndexAt(d.y)) !== i || !/^(shaft-light|lightshaft|light-shaft|beam)$/.test(d.type)) continue;
      if (d.x < sh.minX || d.x > sh.maxX || d.z < sh.minZ || d.z > sh.maxZ) continue;
      _c.set(typeof d.color === 'string' || typeof d.color === 'number' ? d.color : '#7fb4c8');
      const top = Math.min(sec.yTop, d.y + d.sy / 2);
      const bot = Math.max(sec.yBottom, d.y - d.sy / 2);
      if (top - bot < 4) continue;
      beamList.push({ x: d.x, y: (top + bot) / 2, z: d.z, h: top - bot, r: Math.max(d.sx, d.sz) * 0.3, cr: _c.r * 0.22, cg: _c.g * 0.22, cb: _c.b * 0.22 });
    }
    return { room: { c: [cx, cy, cz], h: [hx, hy, hz] }, lampList: lampList.slice(0, 14), beamList: beamList.slice(0, 3) };
  }

  /** Per-section environment specs from the level themes + the lights per section. */
  setLevel(level, themes) {
    this._level = level || null;
    const secs = level && Array.isArray(level.sections) ? level.sections : [];
    const lamps = new Array(secs.length).fill(0);
    if (level && Array.isArray(level.lights)) {
      for (const l of level.lights) {
        const si = typeof level.sectionIndexAt === 'function' ? level.sectionIndexAt(l.y) : 0;
        if (si >= 0 && si < lamps.length) lamps[si]++;
      }
    }
    this._specs = themes.map((t, i) => {
      const spec = {
        light: t.light.clone(),
        accent: t.accent.clone(),
        fog: t.fog.clone(),
        ambient: t.ambient,
        lamps: Math.max(2, lamps[i] + 1),
      };
      Object.assign(spec, this._roomSpec(level, secs[i], i));
      return spec;
    });
    this._sections = this._specs.length;
    if (this.probe) {
      this.probe.setSections(this._specs);
      this.probe.ensure(0);
    }
    this._refreshGI();
    this._refreshLM();
  }

  // ---------------------------------------------------------------------------
  // Baked GI
  // ---------------------------------------------------------------------------
  /** Loads the baked volume (once). Resolves true when it is usable for the current level. */
  loadGI(url = GI_URL) {
    if (this._giPromise) return this._giPromise;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const lmLoad = this.loadLightmaps(); // the lightmaps load in parallel with the volume, behind the same loader promise
    this._giPromise = (async () => {
      if (typeof fetch !== 'function' || typeof DecompressionStream !== 'function') {
        this.stats.giState = 'unsupported';
        await lmLoad;
        return false;
      }
      const res = await fetch(url);
      if (!res || !res.ok) {
        this.stats.giState = 'missing';
        return false;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const meta = readHeader(buf);
      if (!meta) {
        this.stats.giState = 'bad-header';
        return false;
      }
      const stream = new Blob([buf.subarray(GI_HEADER_BYTES)]).stream().pipeThrough(new DecompressionStream('deflate'));
      const raw = new Uint8Array(await new Response(stream).arrayBuffer());
      if (raw.length !== meta.rawLength) {
        this.stats.giState = 'bad-length';
        return false;
      }
      undelta(raw);
      const tex = new THREE.Data3DTexture(raw, meta.dims[0], meta.dims[2], meta.dims[1]);
      tex.format = THREE.RGBAFormat;
      tex.type = THREE.UnsignedByteType;
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false;
      tex.unpackAlignment = 1;
      tex.colorSpace = THREE.NoColorSpace;
      tex.name = 'at3dGI';
      tex.needsUpdate = true;
      this._gi = { tex, meta };
      this.stats.giBytes = buf.length;
      this.stats.giMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
      await lmLoad;
      return this._refreshGI();
    })().catch((err) => {
      this.stats.giState = 'error';
      if (typeof console !== 'undefined') console.warn('[AT3D] baked lighting unavailable, stock ambient', err);
      return false;
    });
    return this._giPromise;
  }

  // ---------------------------------------------------------------------------
  // Baked lightmaps
  // ---------------------------------------------------------------------------
  /**
   * Loads the lightmap pages (once): index JSON, then every page (zlib + delta) into ONE RGBA8 texture array, plus the
   * chart table the solids' vertex shader reads. Resolves true when usable for the current level.
   */
  loadLightmaps(base = LM_BASE_URL) {
    if (this._lmPromise) return this._lmPromise;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this._lmPromise = (async () => {
      if (typeof fetch !== 'function' || typeof DecompressionStream !== 'function') {
        this.stats.lmState = 'unsupported';
        return false;
      }
      const res = await fetch(base + LM_INDEX_NAME);
      if (!res || !res.ok) {
        this.stats.lmState = 'missing';
        return false;
      }
      const index = await res.json();
      if (!index || index.format !== 'AT3DLM01' || !Array.isArray(index.pages) || !Array.isArray(index.rows)) {
        this.stats.lmState = 'bad-index';
        return false;
      }
      const [W, H] = index.page;
      const layer = W * H * 4;
      const data = new Uint8Array(layer * index.pages.length);
      let bytes = 0;
      await Promise.all(
        index.pages.map(async (pg, i) => {
          const r = await fetch(base + pg.file);
          if (!r || !r.ok) throw new Error('lightmap page missing: ' + pg.file);
          const buf = new Uint8Array(await r.arrayBuffer());
          bytes += buf.length;
          const h = readLmHeader(buf);
          if (!h || h.w !== W || h.h !== H || h.pages !== 1) throw new Error('bad lightmap page ' + pg.file);
          const stream = new Blob([buf.subarray(LM_HEADER_BYTES)]).stream().pipeThrough(new DecompressionStream('deflate'));
          const raw = new Uint8Array(await new Response(stream).arrayBuffer());
          if (raw.length !== h.rawLength) throw new Error('lightmap page length ' + pg.file);
          lmUndelta(raw);
          data.set(raw, i * layer);
        }),
      );
      const tex = new THREE.DataArrayTexture(data, W, H, index.pages.length);
      tex.format = THREE.RGBAFormat;
      tex.type = THREE.UnsignedByteType;
      tex.minFilter = THREE.LinearFilter; // no mips: texels are 0.15-0.7 m, magnified on screen up to ~60 m
      tex.magFilter = THREE.LinearFilter;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.generateMipmaps = false;
      tex.unpackAlignment = 4;
      tex.colorSpace = THREE.NoColorSpace;
      tex.name = 'at3dLightmaps';
      tex.needsUpdate = true;
      const t = buildChartTable(index.rows);
      const tab = new THREE.DataTexture(t.data, t.width, t.height, THREE.RGBAFormat, THREE.FloatType);
      tab.minFilter = tab.magFilter = THREE.NearestFilter;
      tab.generateMipmaps = false;
      tab.colorSpace = THREE.NoColorSpace;
      tab.name = 'at3dLightmapCharts';
      tab.needsUpdate = true;
      this._lm = { tex, tab, index };
      this.stats.lmBytes = bytes;
      this.stats.lmPages = index.pages.length;
      this.stats.lmGpuBytes = data.length;
      this.stats.lmMs = (typeof performance !== 'undefined' ? performance.now() : 0) - t0;
      return this._refreshLM();
    })().catch((err) => {
      this.stats.lmState = 'error';
      if (typeof console !== 'undefined') console.warn('[AT3D] lightmaps unavailable, baked volume only', err);
      return false;
    });
    return this._lmPromise;
  }

  _refreshLM() {
    const g = this._lm;
    if (!g) return false;
    const lv = this._level;
    if (lv && levelLmHash(lv, Object.keys(g.index.solids)) !== g.index.hash) {
      this.stats.lmState = 'stale';
      LOOK.uLM.value = null;
      LOOK.uLMTab.value = null;
      this.stats.lmLoaded = false;
      if (this.r3d.levelView && this.r3d.levelView.setLightmapIndex) this.r3d.levelView.setLightmapIndex(null);
      if (typeof console !== 'undefined') console.warn('[AT3D] lightmaps are stale for this level (re-run tools/abyssal-tether-3d/bake/bake_lightmaps.mjs)');
      return false;
    }
    LOOK.uLM.value = g.tex;
    LOOK.uLMTab.value = g.tab;
    this.stats.lmSolids = this.r3d.levelView && this.r3d.levelView.setLightmapIndex ? this.r3d.levelView.setLightmapIndex(g.index) : 0;
    this.stats.lmLoaded = true;
    this.stats.lmState = 'ok';
    try {
      this.r3d.renderer.initTexture(g.tex); // upload on the menu, not on the first frame that samples it
      this.r3d.renderer.initTexture(g.tab);
    } catch {
      /* uploads lazily */
    }
    this._applyUniforms(true);
    return true;
  }

  /** Live grading of the lightmapped surfaces: exposure (× baked irradiance), floor (irradiance added everywhere), lanternGain / lanternFalloff (the lantern's extra d^-falloff on them). */
  setLightmapTune(t) {
    if (t && isFinite(t.exposure)) this.lmTune.exposure = t.exposure;
    if (t && isFinite(t.floor)) this.lmTune.floor = t.floor;
    if (t && isFinite(t.lanternGain)) this.lmTune.lanternGain = t.lanternGain;
    if (t && isFinite(t.lanternFalloff)) this.lmTune.lanternFalloff = t.lanternFalloff;
    this._applyUniforms(true);
    return this.lmTune;
  }

  _refreshGI() {
    const g = this._gi;
    if (!g) return false;
    if (this._level && levelGiHash(this._level) !== g.meta.hash) {
      this.stats.giState = 'stale';
      LOOK.uGI.value = null;
      this.stats.giLoaded = false;
      if (typeof console !== 'undefined') console.warn('[AT3D] baked lighting is stale for this level (re-run tools/abyssal-tether-3d/bake/bake_gi.mjs)');
      return false;
    }
    const m = g.meta;
    LOOK.uGI.value = g.tex;
    LOOK.uGIMin.value.set(m.min[0], m.min[1], m.min[2]);
    LOOK.uGIInv.value.set(1 / m.size[0], 1 / m.size[1], 1 / m.size[2]);
    this.stats.giLoaded = true;
    this.stats.giState = 'ok';
    try {
      this.r3d.renderer.initTexture(g.tex); // upload on the menu, not on the first frame that samples it
    } catch {
      /* uploads lazily */
    }
    this._applyUniforms(true);
    return true;
  }

  // ---------------------------------------------------------------------------
  // Tiers
  // ---------------------------------------------------------------------------
  /**
   * Pins a tier ('low' | 'quest' | 'high'; null = automatic). A pin that needs another probe resolution rebuilds the
   * probe (a hitch: call it from a menu or a fade) unless opts.live is set, which keeps the current resolution.
   */
  setTier(name, opts = {}) {
    if (name == null) {
      this.pinned = null;
      return this.tier;
    }
    const n = tierName(name);
    if (!n) return this.tier;
    this.pinned = n;
    this._setTier(n, !!opts.live);
    return this.tier;
  }

  _setTier(n, live) {
    if (n === this.tier && this.probe) return;
    this.tier = n;
    this.cfg = QUALITY_TIERS[n];
    this.stats.tier = n;
    if (!live && this.probe && n !== 'low' && this.probe.size !== this.cfg.envSize) {
      this._buildProbe(this.cfg.envSize);
      if (this._specs) this.probe.setSections(this._specs);
      this.r3d.precompile();
    }
    this._applyUniforms(true);
  }

  /** Effective tier for this frame (pin, ?fx=, settings, XR) plus the governor level. */
  _resolve(game) {
    const s = (game && game.settings) || this.settings;
    let n = this.pinned || urlTier();
    if (!n) n = s && s.reducedEffects ? 'low' : tierName(s && s.fxQuality) || (game && game.xrActive ? 'quest' : defaultTier());
    if (s && s.reducedEffects && !this.pinned) n = 'low';
    let gl = 0;
    const gov = game && game.governor;
    if (gov && typeof gov.level === 'number' && gov.active !== false) gl = gov.level;
    else gl = this.r3d.governor ? this.r3d.governor.level : 0;
    this.govLevel = gl; // reported only: the governor changes the resolution, never the tier or the look (see platform/governor.js)
    this._lmForcedOff = (this.pinned || urlTier()) === 'low';
    return n;
  }

  /** The difficulty's darkness 0..1 (renderer3d eases it): the baked irradiance and its ambient floor are dimmed by it. */
  setDarkness(d) {
    const v = Math.max(0, Math.min(1, +d || 0));
    if (Math.abs(v - this.dark) < 0.002) return;
    this.dark = v;
    this._applyUniforms(false);
  }

  /** Effective numbers after the governor steps. */
  _effective() {
    const c = this.cfg;
    return {
      env: c.env,
      gi: c.gi,
      coat: c.coat,
      detail: c.detail,
      // lightmaps are free: only a pinned / ?fx=low tier drops them (reducedEffects and the governor's low step keep them)
      lm: c.lm || !this._lmForcedOff,
    };
  }

  _applyUniforms(force) {
    const e = this._effective();
    const probeOk = !!this.probe;
    LOOK.uEnvK.value.x = probeOk ? e.env : 0;
    LOOK.uEnvK.value.w = probeOk && this.tier === 'high' ? 1 : 0;
    LOOK.uGIK.value.x = e.gi && LOOK.uGI.value ? 1 : 0;
    LOOK.uLMK.value.x = e.lm && LOOK.uLM.value ? 1 : 0;
    LOOK.uLMK.value.y = this.lmTune.exposure * (1 - 0.85 * this.dark);
    LOOK.uLMK.value.w = this.lmTune.floor * (1 - 0.95 * this.dark);
    LOOK.uLMLan.value.set(this.lmTune.lanternGain, this.lmTune.lanternFalloff);
    LOOK.uLanternC.value.w = e.coat * 0.9;
    if (this.r3d.levelView && typeof this.r3d.levelView.setDetailScale === 'function') this.r3d.levelView.setDetailScale(e.detail, force);
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------
  /**
   * @param {number} dt
   * @param {object} game
   * @param {object} th    blended theme (renderer3d._theme) with the section blend indices in `blend`
   * @param {number} lampFlick 0..1 current flicker factor of the pooled lamps (1 = steady)
   */
  update(dt, game, th, blend, lampFlick) {
    const want = this._resolve(game);
    if (want !== this.tier && !this.pinned) this._setTier(want, true);
    else if (this.pinned && want !== this.tier) this._setTier(this.pinned, true);
    this._applyUniforms(false);

    // reflections: the probe follows the section blend (a blit only inside a blend band)
    const p = this.probe;
    if (p && LOOK.uEnvK.value.x > 0) {
      // the section variants are built a few per frame on the menu, one every 8 frames once playing (no hitch)
      if (p.pending && this._pumpAt-- <= 0) {
        p.pump();
        this._pumpAt = game && game.state === 'playing' ? 8 : 0;
      }
      p.select(blend.ia, blend.ib, blend.w);
      LOOK.uSkyUp.value.copy(p.sky.up);
      LOOK.uSkyHz.value.copy(p.sky.hz);
      LOOK.uSkyDn.value.copy(p.sky.dn);
      this.stats.envBuilds = p.builds;
      this.stats.envBlits = p.blits;
    }

    // baked GI colours: the theme's light for the cool fill, flame for the warm one (dips with the lamps)
    LOOK.uGICool.value.copy(th.light).multiplyScalar(0.85);
    _c.copy(FLAME).lerp(th.accent, 0.25);
    LOOK.uGIWarm.value.copy(_c).multiplyScalar(0.6 + 0.4 * lampFlick);
    LOOK.uGIK.value.z = 1.0;

    // lightmaps: the flame lamps' baked direct light breathes with the pooled lamps' flicker, tinted by the section's lamps
    if (this._lm) {
      LOOK.uLMK.value.z = Math.min(1.06, lampFlick * 1.06);
      const secs = this._lm.index.sections;
      const a = secs[blend.ia] || secs[0];
      const b = secs[blend.ib] || a;
      if (a && b) {
        LOOK.uLMLamp.value.setRGB(
          a.lampTint[0] + (b.lampTint[0] - a.lampTint[0]) * blend.w,
          a.lampTint[1] + (b.lampTint[1] - a.lampTint[1]) * blend.w,
          a.lampTint[2] + (b.lampTint[2] - a.lampTint[2]) * blend.w,
        );
      }
    }

    // the lantern, for the wet film glint
    const l = this.r3d.lantern;
    if (l) {
      l.updateWorldMatrix(true, false);
      l.getWorldPosition(_v);
      LOOK.uLanternW.value.copy(_v);
      LOOK.uLanternC.value.x = l.color.r * l.intensity;
      LOOK.uLanternC.value.y = l.color.g * l.intensity;
      LOOK.uLanternC.value.z = l.color.b * l.intensity;
      LOOK.uLanternR.value.set(l.distance || 30, l.decay || 1.6);
    }

    // materials added by other modules after precompile(): picked up when the scene grew
    this._sweepAt -= dt;
    if (this._sweepAt <= 0) {
      this._sweepAt = 1.5;
      const n = this.r3d.scene.children.length;
      if (n !== this._lastObjects) {
        this._lastObjects = n;
        if (this.sweep(this.r3d.scene) > 0) this.r3d.precompile();
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Materials
  // ---------------------------------------------------------------------------
  _assignEnv(mat) {
    if (!this.probe) {
      this._pendingMaterials.add(mat);
      return;
    }
    if (mat.envMap !== this.probe.texture) {
      mat.envMap = this.probe.texture;
      mat.needsUpdate = true;
    }
    this._pendingMaterials.delete(mat);
  }

  /**
   * Gives a standard material the shared reflection probe: `material.envMap` + `envMapIntensity` (default by metalness
   * and roughness: metal ≈ 1, dielectrics ≈ 0.25), no diffuse IBL term (ambient stays the hemisphere + baked GI).
   * Call before the first render of the material or before renderer.precompile() (otherwise it recompiles once).
   * opts.env overrides the intensity. Materials with their own envMap (the arms' gear map) are left alone unless
   * opts.force. Returns the material.
   */
  applyLookTo(mat, opts = {}) {
    if (!mat || !mat.isMeshStandardMaterial) return mat;
    if (mat.envMap && !opts.force && !mat.userData.look) return mat;
    const metal = num(mat.metalness, 0);
    const rough = num(mat.roughness, 0.8);
    const auto = (0.25 + 0.75 * metal) * (1 - 0.45 * rough);
    mat.envMapIntensity = num(opts.env, auto);
    mat.defines = Object.assign({}, mat.defines, { AT_LOOK_ENV: '' });
    mat.userData.look = true;
    this._assignEnv(mat);
    mat.needsUpdate = true;
    return mat;
  }

  /** Applies the look to every unclaimed standard material in `root`; returns how many were changed. */
  sweep(root) {
    let n = 0;
    const ls = this.r3d.lanternShadow; // every lit standard material also receives the lantern's shadow (once)
    root.traverse((o) => {
      const m = o.material;
      if (!m || o.isPoints || o.isSprite) return;
      if (Array.isArray(m)) {
        for (const mm of m) {
          if (this._unclaimed(mm)) (this.applyLookTo(mm), n++);
          if (ls && ls.attach(mm)) n++;
        }
      } else {
        if (this._unclaimed(m)) {
          this.applyLookTo(m);
          n++;
        }
        if (ls && ls.attach(m)) n++;
      }
    });
    this.stats.swept += n;
    return n;
  }

  _unclaimed(m) {
    return !!m && m.isMeshStandardMaterial && !m.envMap && !m.userData.look && !m.userData.noLook && !m.transparent;
  }

  dispose() {
    if (this.probe) this.probe.dispose();
    this.probe = null;
    if (this._gi) this._gi.tex.dispose();
    LOOK.uGI.value = null;
    if (this._lm) {
      this._lm.tex.dispose();
      this._lm.tab.dispose();
    }
    LOOK.uLM.value = null;
    LOOK.uLMTab.value = null;
  }
}

export { DEFAULT_ENV_SPEC, RenderGovernor };
