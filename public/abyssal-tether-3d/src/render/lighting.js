/* ABYSSAL TETHER 3D — lighting.js
 * The lighting look of the world, owned by Renderer3D (`renderer.lighting`):
 *
 *  - reflections: one procedural environment probe (envProbe.js; PMREM, cross-faded between sections) shared by every
 *    standard material; metal reflects strongly, wet stone through the shared wetness uniform, dry stone weakly;
 *  - baked GI: the static bounce light + ambient occlusion + shaft-key visibility volume
 *    (assets/lighting/gi_ch1.bin from tools/abyssal-tether-3d/bake/bake_gi.mjs), sampled once per fragment by the
 *    lit-surface shader patch (materials.js);
 *  - the wet film glint of the lantern (uniform-driven lobe in the same patch);
 *  - quality tiers `low | quest | high` (same names as fx.js: ?fx=, settings.fxQuality, settings.reducedEffects,
 *    XR → quest, otherwise high) that only change uniforms and distances at run time, so no program ever recompiles;
 *    the probe resolution is chosen when the probe is created (a Quest browser starts at `quest`);
 *  - `applyLookTo(material)`: gives any other module's standard material the shared reflection with a sensible
 *    intensity (the renderer also does it automatically for every unclaimed standard material in precompile()).
 *
 * Tier table (what a tier changes):
 *   low    reflections off (fetch branch-skipped), no baked GI sample, no wet glint, far detail ×0.55   (≈ stock cost)
 *   quest  reflections ×1 (probe 64 px, 2 fetches), baked GI (1 trilinear fetch), wet glint, far detail ×1
 *   high   reflections ×1.1 (probe 128 px), baked GI, wet glint, far detail ×1.35
 * Governor steps (platform/governor.js level, or renderer.governor.update(frameMs) when no platform governor exists):
 *   level ≥ 2  wet glint off, far detail ×0.85      level ≥ 3  `low` tier (the platform governor also switches fx to low)
 */

import * as THREE from 'three';
import { LOOK } from './materials.js';
import { EnvProbe, DEFAULT_ENV_SPEC } from './envProbe.js';
import { GI_HEADER_BYTES, levelGiHash, readHeader, undelta } from './giFormat.js';
import { RenderGovernor } from './renderGovernor.js';

const TIER_ALIAS = { low: 'low', reduced: 'low', quest: 'quest', xr: 'quest', medium: 'quest', high: 'high', desktop: 'high' };
export const QUALITY_TIERS = Object.freeze({
  low: Object.freeze({ name: 'low', env: 0, envSize: 32, gi: false, coat: 0, detail: 0.55 }),
  quest: Object.freeze({ name: 'quest', env: 1, envSize: 64, gi: true, coat: 1, detail: 1 }),
  high: Object.freeze({ name: 'high', env: 1.1, envSize: 128, gi: true, coat: 1, detail: 1.35 }),
});
export const GI_URL = new URL('../../assets/lighting/gi_ch1.bin', import.meta.url).href;

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

function isQuestBrowser() {
  try {
    return typeof navigator !== 'undefined' && /OculusBrowser|Quest/i.test(navigator.userAgent || '');
  } catch {
    return false;
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
    this.tier = urlTier() || (isQuestBrowser() ? 'quest' : 'high');
    if (this.settings.reducedEffects) this.tier = 'low';
    this.cfg = QUALITY_TIERS[this.tier];
    this.govLevel = 0;
    this.probe = null;
    this._pendingMaterials = new Set();
    this.stats = { tier: this.tier, envSize: 0, envBuilds: 0, envBlits: 0, giLoaded: false, giBytes: 0, giMs: 0, giState: 'none', swept: 0 };
    this._gi = null; // { tex, meta }
    this._giPromise = null;
    this._level = null;
    this._sections = 0;
    this._sweepAt = 0;
    this._lastObjects = -1;
    this._pumpAt = 0;
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
    this._specs = themes.map((t, i) => ({
      light: t.light.clone(),
      accent: t.accent.clone(),
      fog: t.fog.clone(),
      ambient: t.ambient,
      lamps: Math.max(2, lamps[i] + 1),
    }));
    this._sections = this._specs.length;
    if (this.probe) {
      this.probe.setSections(this._specs);
      this.probe.ensure(0);
    }
    this._refreshGI();
  }

  // ---------------------------------------------------------------------------
  // Baked GI
  // ---------------------------------------------------------------------------
  /** Loads the baked volume (once). Resolves true when it is usable for the current level. */
  loadGI(url = GI_URL) {
    if (this._giPromise) return this._giPromise;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    this._giPromise = (async () => {
      if (typeof fetch !== 'function' || typeof DecompressionStream !== 'function') {
        this.stats.giState = 'unsupported';
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
      return this._refreshGI();
    })().catch((err) => {
      this.stats.giState = 'error';
      if (typeof console !== 'undefined') console.warn('[AT3D] baked lighting unavailable, stock ambient', err);
      return false;
    });
    return this._giPromise;
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
    if (!n) n = s && s.reducedEffects ? 'low' : tierName(s && s.fxQuality) || (game && game.xrActive ? 'quest' : isQuestBrowser() ? 'quest' : 'high');
    if (s && s.reducedEffects && !this.pinned) n = 'low';
    let gl = 0;
    const gov = game && game.governor;
    if (gov && typeof gov.level === 'number' && gov.active !== false) gl = gov.level;
    else gl = this.r3d.governor ? this.r3d.governor.level : 0;
    if (gl >= 3 && !this.pinned) n = 'low';
    this.govLevel = gl;
    return n;
  }

  /** Effective numbers after the governor steps. */
  _effective() {
    const c = this.cfg;
    const gl = this.govLevel;
    return {
      env: c.env * (gl >= 2 ? 0.9 : 1),
      gi: c.gi,
      coat: gl >= 2 ? 0 : c.coat,
      detail: c.detail * (gl >= 2 ? 0.85 : 1),
    };
  }

  _applyUniforms(force) {
    const e = this._effective();
    const probeOk = !!this.probe;
    LOOK.uEnvK.value.x = probeOk ? e.env : 0;
    LOOK.uGIK.value.x = e.gi && LOOK.uGI.value ? 1 : 0;
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
      this.stats.envBuilds = p.builds;
      this.stats.envBlits = p.blits;
    }

    // baked GI colours: the theme's light for the cool fill, flame for the warm one (dips with the lamps)
    LOOK.uGICool.value.copy(th.light).multiplyScalar(0.85);
    _c.copy(FLAME).lerp(th.accent, 0.25);
    LOOK.uGIWarm.value.copy(_c).multiplyScalar(0.6 + 0.4 * lampFlick);
    LOOK.uGIK.value.z = 1.0;

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
    root.traverse((o) => {
      const m = o.material;
      if (!m || o.isPoints || o.isSprite) return;
      if (Array.isArray(m)) {
        for (const mm of m) if (this._unclaimed(mm)) (this.applyLookTo(mm), n++);
      } else if (this._unclaimed(m)) {
        this.applyLookTo(m);
        n++;
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
  }
}

export { DEFAULT_ENV_SPEC, RenderGovernor };
