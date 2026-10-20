/* ABYSSAL TETHER 3D — renderer3d.js
 * Renderer3D (contract §5): WebGL/WebXR renderer, scene, head camera in a rig,
 * per-section fog + ambient themes (blended across section boundaries), the
 * carried lantern, a capped pool of environment PointLights, and the level,
 * rope and FX views.
 *
 * Quest budget notes:
 *  - a FIXED number of PointLights (lantern + ENV_LIGHTS) always exists, so
 *    shader programs never recompile as lights come and go; unused ones sit at
 *    intensity 0. Everything else that glows is emissive/additive.
 *  - no shadows, no post-processing; ACES tone mapping in-shader
 *  - radial (distance) fog so turning the head never changes what fog hides
 *  - foveation 1, renderer.setAnimationLoop is owned by the Game
 *
 * API (contract §5 + extras):
 *   new Renderer3D(container, settings) → .renderer .scene .camera .rig
 *   setLanternParent(object3D, offset?, {bulb}?)  XR: left grip/socket; desktop: camera (default)
 *   buildLevel(level, textures?)         textures: undefined → assets/textures/manifest.json,
 *                                        a URL, a parsed manifest, loaded sets, a Promise, or false
 *   update(dt, game) · render() · resize()
 *   applyTextures(textures) → Promise    precompile()  headPosition(out)  themeAt(y, out)
 *   .fx.burst(kind, x, y, z, opts)       kind: 'sparks' | 'puff' | 'chips' | 'debris'
 *   .stats {calls, triangles, points, programs, frameMs}   (after render())
 *   .lighting                       reflections (envProbe.js) + baked GI (lighting.js) + wet glint; see lighting.js
 *   setQualityTier('low'|'quest'|'high'|null) · .qualityTier        lighting/detail tier (null = automatic: ?fx=, settings,
 *                                   reducedEffects, XR); uniforms and distances only, never a recompile
 *   .governor.update(frameMs) · .governor.level · .governor.on(fn)  frame-time hook (mirrors platform/governor.js when
 *                                   the Game runs one, otherwise steps by itself)
 *   applyLookTo(material, {env})    shared reflection for another module's MeshStandardMaterial
 *   lightingReady: Promise<boolean>  the baked GI volume loaded and valid for the level
 *   envKit: Promise<boolean>              the environment kit (dressing parts, far colossi) loaded and applied
 * Reads from game: level, player (rx/ry/rz), tethers.hands, threat.value, diff
 * (aimRange, fragileTime, crumbleTime), fade, flash, state, input.handPose(h),
 * bus (FX + glyph pulses), settings.reducedEffects.
 * Render order: glyphs 20, light glows 15, highlights 60, fade sphere 900 —
 * VR UI panels that must show over the death fade should use > 900 with
 * depthTest false; XR hand launchers draw after those at 960 (depth-tested
 * against the world only, see handsView.HANDS_RENDER_ORDER_XR).
 */

import * as THREE from 'three';
import { KEY_DIR, LOOK, MaterialLibrary, PALETTE, installRadialFog, loadTextureManifest } from './materials.js';
import { LevelView } from './levelView.js';
import { RopeView } from './ropeView.js';
import { FX } from './fx.js';
import { Lighting } from './lighting.js';
import { RenderGovernor } from './renderGovernor.js';

/** Math.hypot is ~20× slower than sqrt in V8 and allocates; hot paths use this. */
function hyp(x, y, z = 0) {
  return Math.sqrt(x * x + y * y + z * z);
}


// Real PointLights for level.lights (plus the lantern). Every lit fragment pays
// for every slot (three unrolls NUM_POINT_LIGHTS), and the descent has ≤ 2 env
// lights in reach in 97.5 % of frames; the rest still read via lightGlows/emissive.
const ENV_LIGHTS = 2;
const ENV_REASSIGN = 0.25; // seconds between nearest-light re-evaluations
const ENV_GAIN = 1.6; // level.lights: candela = intensity × max(6, 0.06·range²) × gain (reaches ~range)
const THEME_BLEND = 9; // metres either side of a section boundary
const AMBIENT_SCALE = 3.0; // theme.ambient → hemisphere intensity
const KEY_SCALE = 6.8; // theme.ambient → shaft key light intensity (tops read as moonlit lines, walls keep their dark)
const FOG_GAIN = 1.3; // section fog colours are lifted a little: haze reads as faint light, not black
const FOG_LUM_FLOOR = 0.013; // minimum linear luminance of the haze (≈ sRGB 30/255) so no section is pure black
const LANTERN_CANDELA = 6.5;
const LANTERN_RANGE = 30;
const LANTERN_DECAY = 1.6; // gentler than physical so the lantern still grazes walls 10–20 m away
const DEFAULT_TEXTURE_MANIFEST = 'assets/textures/manifest.json';
/** The Underspire environment kit (tools/abyssal-tether-3d/build_env_kit.py), relative to this module. */
const ENV_KIT_URL = new URL('../../assets/models/env/ch1_env_kit.glb', import.meta.url).href;
const SKY_RADIUS = 330; // sky dome: inside camera.far (400), beyond every section's fog far (fully fogged)
const DESKTOP_FOV = 70; // WebXR overwrites camera.fov with the headset's; resize() restores this
// Material slots + uniform holders scanned by precompile() for textures to upload early.
const TEX_SLOTS = ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'bumpMap', 'lightMap', 'specularMap'];

/** Adds every texture `mat` samples (slots, ShaderMaterial uniforms, uniform objects in userData) to `out`. */
function collectTextures(mat, out) {
  if (!mat) return;
  for (let i = 0; i < TEX_SLOTS.length; i++) {
    const t = mat[TEX_SLOTS[i]];
    if (t && t.isTexture) out.add(t);
  }
  const scan = (U) => {
    if (!U || typeof U !== 'object' || U.isTexture) return;
    for (const k of Object.keys(U)) {
      const v = U[k] && U[k].value;
      if (v && v.isTexture) out.add(v);
    }
  };
  scan(mat.uniforms);
  const ud = mat.userData;
  if (ud) for (const k of Object.keys(ud)) scan(ud[k]);
}

const DEFAULT_THEME = {
  fog: '#1c2125',
  light: '#6fa3b5',
  accent: '#e0a050',
  fogNear: 3,
  fogFar: 60,
  ambient: 0.35,
  wet: 0.2,
  rim: 0.5,
};
// Per-section look (Chapter I, by section index; the art bible's wetness ramp: dry ash at the top,
// soaked in the Last Throat) and the strength of the haze rim light on carved relief.
const SECTION_WET = [0.1, 0.15, 0.3, 0.2, 0.5, 0.6, 0.4, 0.7];
const SECTION_RIM = [0.7, 0.7, 0.65, 0.8, 0.6, 0.6, 0.8, 0.55];

const _tmpC = new THREE.Color();

function num(v, fb) {
  return typeof v === 'number' && isFinite(v) ? v : fb;
}
function colorOf(v, fb) {
  const c = new THREE.Color();
  try {
    if (v instanceof THREE.Color) return c.copy(v);
    if (typeof v === 'number' || typeof v === 'string') return c.set(v);
  } catch {
    /* fall through */
  }
  return c.set(fb);
}

export class Renderer3D {
  /**
   * @param {HTMLElement} container  element the canvas is appended to
   * @param {object} [settings]       live settings (reducedEffects read if present)
   */
  constructor(container, settings) {
    this.container = container || (typeof document !== 'undefined' ? document.body : null);
    this.settings = settings || {};
    installRadialFog();

    const r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.25;
    r.shadowMap.enabled = false;
    r.xr.enabled = true;
    try {
      r.xr.setFoveation(1);
    } catch {
      /* older runtimes */
    }
    r.domElement.classList.add('at3d-canvas');
    if (this.container) this.container.appendChild(r.domElement);
    this.renderer = r;

    this.scene = new THREE.Scene();
    this.scene.name = 'AbyssalTether3D';
    this.fogColor = new THREE.Color(DEFAULT_THEME.fog);
    this.scene.fog = new THREE.Fog(this.fogColor.clone(), DEFAULT_THEME.fogNear, DEFAULT_THEME.fogFar);
    this.scene.background = this.fogColor.clone();

    this.baseFov = DESKTOP_FOV;
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 16 / 9, 0.05, 400);
    this.camera.name = 'HeadCamera';
    this.rig = new THREE.Group();
    this.rig.name = 'PlayerRig';
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    // Sky dome: fully fogged, so it shows the graded fog colour (materials.js
    // installRadialFog) — darker looking down into the abyss, a little light
    // above — and fogged geometry dissolves into it seamlessly at any pitch.
    this.sky = null;

    // Ambient fill (per-section).
    this.hemi = new THREE.HemisphereLight(0x6fa3b5, 0x141210, 0.5);
    this.scene.add(this.hemi);
    // Key: the cold light still falling down the shaft from where you came in
    // (per-section colour, no shadows). Every upward face catches it — cornices,
    // ledge crowns, capitals, sills — so the carving reads as lines of light in
    // the haze, and its slant splits pier, buttress and figure sides into lit
    // and shade. Without it the ambient lights all vertical faces alike and
    // relief vanishes into flat grey walls.
    this.key = new THREE.DirectionalLight(0xffffff, 0);
    this.key.name = 'ShaftKey';
    this.key.castShadow = false;
    this.key.position.copy(KEY_DIR); // toward the key (materials.KEY_DIR): from high above, slanted
    this.keyScale = KEY_SCALE;
    /** Look multipliers (debug / grading hooks): ambient fill, shaft key, rim light. */
    this.tune = { ambient: 1, key: 1, rim: 1 };
    this.scene.add(this.key);

    // Lantern: one warm flickering PointLight carried by the player.
    this.lanternGroup = new THREE.Group();
    this.lanternGroup.name = 'Lantern';
    this.lantern = new THREE.PointLight(PALETTE.lantern, LANTERN_CANDELA, LANTERN_RANGE, LANTERN_DECAY);
    this.lantern.castShadow = false;
    this.lanternGroup.add(this.lantern);
    this.lanternBulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.018, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false, fog: false }),
    );
    this.lanternBulb.name = 'LanternBulb';
    this.lanternGroup.add(this.lanternBulb);
    this.lanternBase = LANTERN_CANDELA;
    this.setLanternParent(this.camera);

    // Environment light pool.
    this.envLights = [];
    for (let i = 0; i < ENV_LIGHTS; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.castShadow = false;
      l.name = `EnvLight${i}`;
      this.scene.add(l);
      this.envLights.push({ light: l, src: null, level: 0, want: null });
    }
    this._envTimer = 0;
    this._envScratch = [];

    this.materials = new MaterialLibrary(r);
    this._game = null;
    this._bus = null;
    this._lampFlick = 1;
    this.governor = new RenderGovernor(this);
    this.lighting = new Lighting(this);
    this.lightingReady = Promise.resolve(false);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 24, 12), this.materials.get('sky'));
    this.sky.name = 'SkyDome';
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.levelView = new LevelView(this.scene, this.materials);
    this.envKit = this._loadEnvKit();
    this.ropeView = new RopeView(this.scene);
    this.fx = new FX(this.scene, this.camera);
    this.levelView.fx = this.fx;

    this.level = null;
    this.time = 0;
    this.threat = 0;
    this.themes = [];
    this._head = new THREE.Vector3();
    this._theme = {
      fog: this.fogColor.clone(),
      light: new THREE.Color(DEFAULT_THEME.light),
      accent: new THREE.Color(DEFAULT_THEME.accent),
      fogNear: DEFAULT_THEME.fogNear,
      fogFar: DEFAULT_THEME.fogFar,
      ambient: DEFAULT_THEME.ambient,
      wet: DEFAULT_THEME.wet,
      rim: DEFAULT_THEME.rim,
    };
    this._themeTarget = {
      fog: new THREE.Color(),
      light: new THREE.Color(),
      accent: new THREE.Color(),
      fogNear: 0,
      fogFar: 0,
      ambient: 0,
      wet: 0,
      rim: 0,
      ia: 0,
      ib: 0,
      w: 0,
    };
    this._themeInit = false;
    this._fogInfo = { color: this.scene.fog.color, light: this._theme.light };
    this.stats = { calls: 0, triangles: 0, points: 0, programs: 0, frameMs: 0 };
    this._texCache = new Map(); // manifest URL or object → Promise<sets|null>

    this.resize = this.resize.bind(this);
    if (typeof window !== 'undefined') window.addEventListener('resize', this.resize);
    this.resize();
  }

  // ---------------------------------------------------------------------------
  // Lantern
  // ---------------------------------------------------------------------------
  /**
   * Re-parents the carried lantern. XR: the left controller grip (or a socket
   * object on it); desktop: the camera (default). `offset` is in the parent's
   * local space; defaults keep it just off the hand / low-left of the view.
   * options.bulb: show the small glowing bulb mesh (default: only when not on
   * the camera). Pass false when the parent already draws its own lantern glass.
   */
  setLanternParent(object3D, offset, options) {
    const parent = object3D || this.camera;
    parent.add(this.lanternGroup);
    if (offset && isFinite(offset.x)) this.lanternGroup.position.set(offset.x, offset.y || 0, offset.z || 0);
    else if (parent === this.camera) this.lanternGroup.position.set(-0.3, -0.12, -0.12);
    else this.lanternGroup.position.set(0, 0.05, 0.02);
    const bulb = options && typeof options.bulb === 'boolean' ? options.bulb : parent !== this.camera;
    this.lanternBulb.visible = bulb;
    this._lanternParent = parent;
  }

  /**
   * Loads the environment kit once (GLTFLoader, dynamic import so a missing
   * loader degrades to the procedural dressing only) and hands it to the
   * LevelView, which draws the planned kit parts into its decor chunks.
   */
  _loadEnvKit() {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return Promise.resolve(false);
    return import('three/addons/loaders/GLTFLoader.js')
      .then(
        (M) =>
          new Promise((resolve) => {
            new M.GLTFLoader().load(
              ENV_KIT_URL,
              (gltf) => resolve(gltf),
              undefined,
              () => resolve(null),
            );
          }),
      )
      .then((gltf) => {
        if (!gltf) return false;
        this._envKitGltf = gltf;
        return this.levelView.setKit(gltf);
      })
      .catch((err) => {
        if (typeof console !== 'undefined') console.warn('[AT3D] environment kit unavailable, procedural dressing only', err);
        return false;
      });
  }

  // ---------------------------------------------------------------------------
  // Level
  // ---------------------------------------------------------------------------
  /**
   * @param {Level3D} level
   * @param {*} [textures] one of: undefined/null (load the default manifest),
   *   false (procedural only), a manifest URL, a parsed manifest object, a
   *   Promise of either, or loaded sets { rock|masonry|metal|distant: {map, normalMap, ormMap, tileMeters} }.
   */
  buildLevel(level, textures) {
    this.level = level || null;
    this._parseThemes(level);
    this.lighting.setLevel(level, this.themes);
    this.lightingReady = this.lighting.loadGI();
    this._prepareEnvLights(level);
    this.levelView.build(level);
    this._themeInit = false;
    this.applyTextures(textures);
    this.precompile();
  }

  /**
   * Compiles every program the level can need now (including objects that are
   * hidden until later: plaques, highlights, the fade sphere) and uploads every
   * texture those objects sample (decode + upload + mips happen here, on the
   * menu, not on first sight mid-descent). Call again after adding other
   * modules' meshes or swapping their textures.
   */
  precompile() {
    const hidden = [];
    const textures = new Set();
    this.lighting.sweep(this.scene); // other modules' standard materials get the shared reflection before they compile
    this.scene.traverse((o) => {
      if (!o.visible) {
        hidden.push(o);
        o.visible = true;
      }
      const m = o.material;
      if (!m) return;
      if (Array.isArray(m)) for (let i = 0; i < m.length; i++) collectTextures(m[i], textures);
      else collectTextures(m, textures);
    });
    try {
      this.renderer.compile(this.scene, this.camera);
    } catch {
      /* compile is an optimisation only */
    }
    for (const o of hidden) o.visible = false;
    if (typeof this.renderer.initTexture === 'function') {
      for (const t of textures) {
        if (t.isRenderTargetTexture || !(t.version > 0)) continue; // not loaded yet: uploads on its own later
        try {
          this.renderer.initTexture(t); // no-op when already uploaded at this version
        } catch {
          /* optimisation only */
        }
      }
    }
  }

  /** Applies baked texture sets (see buildLevel for accepted forms). */
  applyTextures(textures) {
    if (textures === false) return Promise.resolve(false);
    const apply = (sets) => {
      if (!sets) return false;
      return this.materials.setTextureSets(sets);
    };
    const isLoadedSets = (o) => o && typeof o === 'object' && Object.keys(o).some((k) => o[k] && o[k].map && o[k].map.isTexture);
    // New sets → upload them (and re-check programs) now, while the menu is up.
    const applyAndUpload = (sets) => {
      const ok = apply(sets);
      if (ok) this.precompile();
      return ok;
    };
    if (isLoadedSets(textures)) return Promise.resolve(applyAndUpload(textures));
    let p;
    if (textures && typeof textures.then === 'function') {
      p = Promise.resolve(textures).then((t) => (isLoadedSets(t) ? t : t ? loadTextureManifest(t) : null));
    } else {
      // A manifest object or URL (default: assets/textures/manifest.json): loaded
      // once per key, re-applied on later builds (restarts never re-upload).
      const key = textures && typeof textures === 'object' ? textures : typeof textures === 'string' ? textures : DEFAULT_TEXTURE_MANIFEST;
      if (!this._texCache.has(key)) this._texCache.set(key, loadTextureManifest(key));
      p = this._texCache.get(key);
    }
    return p.then(applyAndUpload).catch((err) => {
      if (typeof console !== 'undefined') console.warn('[AT3D] texture sets unavailable, using procedural', err);
      return false;
    });
  }

  _parseThemes(level) {
    this.themes = [];
    const secs = level && Array.isArray(level.sections) ? level.sections : [];
    for (let si = 0; si < secs.length; si++) {
      const s = secs[si];
      const th = (s && s.theme) || {};
      this.themes.push({
        wet: num(th.wet, num(SECTION_WET[si], DEFAULT_THEME.wet)),
        rim: num(th.rim, num(SECTION_RIM[si], DEFAULT_THEME.rim)),
        yTop: num(s.yTop, Infinity),
        yBottom: num(s.yBottom, -Infinity),
        fog: colorOf(th.fog, DEFAULT_THEME.fog),
        light: colorOf(th.light, DEFAULT_THEME.light),
        accent: colorOf(th.accent, DEFAULT_THEME.accent),
        fogNear: num(th.fogNear, DEFAULT_THEME.fogNear),
        fogFar: Math.max(8, num(th.fogFar, DEFAULT_THEME.fogFar)),
        ambient: num(th.ambient, DEFAULT_THEME.ambient),
      });
    }
  }

  _sectionIndexAt(y) {
    const lv = this.level;
    if (lv && typeof lv.sectionIndexAt === 'function') {
      try {
        const i = lv.sectionIndexAt(y);
        if (typeof i === 'number' && i >= 0 && i < this.themes.length) return i;
      } catch {
        /* fall back */
      }
    }
    const th = this.themes;
    for (let i = 0; i < th.length; i++) if (y <= th[i].yTop && y > th[i].yBottom) return i;
    if (!th.length) return -1;
    return y > th[0].yTop ? 0 : th.length - 1;
  }

  /** Theme at height y, blended across section boundaries, into `out`. */
  themeAt(y, out) {
    const th = this.themes;
    if (!th.length) {
      out.fog.set(DEFAULT_THEME.fog);
      out.light.set(DEFAULT_THEME.light);
      out.accent.set(DEFAULT_THEME.accent);
      out.fogNear = DEFAULT_THEME.fogNear;
      out.fogFar = DEFAULT_THEME.fogFar;
      out.ambient = DEFAULT_THEME.ambient;
      out.wet = DEFAULT_THEME.wet;
      out.rim = DEFAULT_THEME.rim;
      out.ia = out.ib = 0;
      out.w = 0;
      return out;
    }
    const i = Math.max(0, this._sectionIndexAt(y));
    let a = th[i];
    let b = th[i];
    let ia = i;
    let ib = i;
    let yb = NaN;
    if (i > 0 && isFinite(th[i].yTop) && y > th[i].yTop - THEME_BLEND) {
      a = th[i - 1]; // boundary above: section i-1 over section i
      ia = i - 1;
      yb = th[i].yTop;
    } else if (i < th.length - 1 && isFinite(th[i].yBottom) && y < th[i].yBottom + THEME_BLEND) {
      b = th[i + 1]; // boundary below: section i over section i+1
      ib = i + 1;
      yb = th[i].yBottom;
    }
    let w = 0;
    if (a !== b) {
      // 0 at THEME_BLEND above the boundary (upper theme) → 1 the same distance below
      const tt = THREE.MathUtils.clamp((yb + THEME_BLEND - y) / (2 * THEME_BLEND), 0, 1);
      w = tt * tt * (3 - 2 * tt);
    }
    out.fog.copy(a.fog).lerp(b.fog, w);
    out.light.copy(a.light).lerp(b.light, w);
    out.accent.copy(a.accent).lerp(b.accent, w);
    out.fogNear = THREE.MathUtils.lerp(a.fogNear, b.fogNear, w);
    out.fogFar = THREE.MathUtils.lerp(a.fogFar, b.fogFar, w);
    out.ambient = THREE.MathUtils.lerp(a.ambient, b.ambient, w);
    out.wet = THREE.MathUtils.lerp(a.wet, b.wet, w);
    out.rim = THREE.MathUtils.lerp(a.rim, b.rim, w);
    out.ia = ia; // the two sections whose looks are blended, and the weight of the second (reflection probe)
    out.ib = ib;
    out.w = w;
    return out;
  }

  // ---------------------------------------------------------------------------
  // Environment lights
  // ---------------------------------------------------------------------------
  _prepareEnvLights(level) {
    this._envSources = [];
    const lights = level && Array.isArray(level.lights) ? level.lights : [];
    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      if (!l || !isFinite(l.x) || !isFinite(l.y)) continue;
      this._envSources.push({
        x: l.x,
        y: l.y,
        z: num(l.z, 0),
        color: colorOf(l.color, PALETTE.amber),
        candela: Math.max(0, num(l.intensity, 1)) * Math.max(6, 0.06 * num(l.range, 12) * num(l.range, 12)) * ENV_GAIN,
        range: Math.max(2, num(l.range, 12)),
        flicker: l.flicker ? (typeof l.flicker === 'number' ? l.flicker : 0.5) : 0,
        seed: i * 1.731,
      });
    }
    for (const e of this.envLights) {
      e.src = null;
      e.level = 0;
      e.light.intensity = 0;
    }
    this._envTimer = 0;
  }

  _updateEnvLights(dt, head) {
    const srcs = this._envSources;
    if (!srcs || !srcs.length) return;
    this._envTimer -= dt;
    if (this._envTimer <= 0) {
      this._envTimer = ENV_REASSIGN;
      // best K by distance relative to range (allocation-free selection)
      const best = this._envScratch;
      best.length = 0;
      for (let i = 0; i < srcs.length; i++) {
        const s = srcs[i];
        const d = hyp(s.x - head.x, s.y - head.y, s.z - head.z);
        const score = d - s.range * 0.6;
        if (d > s.range * 1.3 + 8) continue;
        s._score = score;
        if (best.length < ENV_LIGHTS) best.push(s);
        else {
          let worst = 0;
          for (let k = 1; k < best.length; k++) if (best[k]._score > best[worst]._score) worst = k;
          if (score < best[worst]._score) best[worst] = s;
        }
      }
      // keep slots whose source is still wanted; free the rest
      for (const e of this.envLights) e.want = e.src && best.includes(e.src) ? e.src : null;
      for (const s of best) {
        if (this.envLights.some((e) => e.want === s)) continue;
        const free = this.envLights.find((e) => e.want === null && (e.src === null || e.level <= 0.02));
        const fading = free || this.envLights.find((e) => e.want === null);
        if (fading) fading.want = s;
      }
    }
    let flickMin = 1;
    for (let k = 0; k < this.envLights.length; k++) {
      const e = this.envLights[k];
      if (e.src !== e.want) {
        // fade out the old source before switching
        e.level = Math.max(0, e.level - dt * 3);
        if (e.level <= 0) {
          e.src = e.want;
          if (e.src) {
            e.light.position.set(e.src.x, e.src.y, e.src.z);
            e.light.color.copy(e.src.color);
            e.light.distance = e.src.range * 1.5;
          }
        }
      } else if (e.src) e.level = Math.min(1, e.level + dt * 2);
      if (!e.src) {
        e.light.intensity = 0;
        continue;
      }
      let f = 1;
      if (e.src.flicker > 0) {
        const t = this.time + e.src.seed;
        f = 1 - e.src.flicker * 0.45 * (0.5 + 0.5 * Math.sin(t * 9.1) * Math.sin(t * 3.7 + 1.3));
        if (Math.sin(t * 0.73) > 0.985) f *= 0.4;
      }
      e.light.intensity = e.src.candela * e.level * f;
      if (f < flickMin) flickMin = f;
    }
    this._lampFlick += (flickMin - this._lampFlick) * 0.2;
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------
  /** World position of the head (camera) — current rig, last XR pose. */
  headPosition(out) {
    this.rig.updateMatrixWorld(true);
    return this.camera.getWorldPosition(out || this._head);
  }

  /**
   * @param {number} dt
   * @param {object} game Game3D (level, player, tethers, threat, diff, fade, flash, state, input, bus, settings)
   */
  update(dt, game) {
    const d = Math.min(Math.max(num(dt, 0), 0), 0.1);
    this.time += d;
    const head = this.headPosition(this._head);
    const threatSys = game && game.threat;
    const threat = THREE.MathUtils.clamp(num(threatSys && (typeof threatSys === 'number' ? threatSys : threatSys.value), 0), 0, 1);
    this.threat += (threat - this.threat) * (1 - Math.exp(-3 * d));

    // Section theme (blended in space, eased in time; snaps after teleports).
    const tgt = this.themeAt(head.y, this._themeTarget);
    const th = this._theme;
    const jumped = this._lastHead && this._lastHead.distanceToSquared(head) > 20 * 20;
    const k = this._themeInit && !jumped ? 1 - Math.exp(-2.5 * d) : 1;
    this._themeInit = true;
    (this._lastHead || (this._lastHead = new THREE.Vector3())).copy(head);
    th.fog.lerp(tgt.fog, k);
    th.light.lerp(tgt.light, k);
    th.accent.lerp(tgt.accent, k);
    th.fogNear += (tgt.fogNear - th.fogNear) * k;
    th.fogFar += (tgt.fogFar - th.fogFar) * k;
    th.ambient += (tgt.ambient - th.ambient) * k;
    th.wet += (tgt.wet - th.wet) * k;
    th.rim += (tgt.rim - th.rim) * k;

    // Threat tightens and darkens the fog a little (felt, not read).
    const tk = this.threat;
    const fog = this.scene.fog;
    fog.color.copy(th.fog).multiplyScalar(FOG_GAIN);
    const lum = fog.color.r * 0.2126 + fog.color.g * 0.7152 + fog.color.b * 0.0722;
    if (lum < FOG_LUM_FLOOR) fog.color.multiplyScalar(FOG_LUM_FLOOR / Math.max(lum, 1e-4));
    fog.color.multiplyScalar(1 - tk * 0.22);
    fog.near = Math.max(0.5, th.fogNear * (1 - tk * 0.3));
    fog.far = Math.max(fog.near + 4, th.fogFar * (1 - tk * 0.18));
    this.scene.background.copy(fog.color);
    if (this.sky) this.sky.position.copy(head);

    // Ambient: hemisphere from the theme light (sky) over a dark ground.
    _tmpC.copy(th.light);
    const grey = (_tmpC.r + _tmpC.g + _tmpC.b) / 3;
    this.hemi.color.setRGB(grey, grey, grey).lerp(_tmpC, 0.7);
    this.hemi.groundColor.copy(th.fog).multiplyScalar(0.9).lerp(th.accent, 0.06);
    this.hemi.intensity = Math.max(0, th.ambient) * AMBIENT_SCALE * this.tune.ambient * (1 - tk * 0.25);
    // Key from above: the theme light, desaturated a little (a pale shaft of the
    // surface's daylight), weaker with the threat.
    this.key.color.setRGB(grey, grey, grey).lerp(_tmpC, 0.55);
    this.key.intensity = Math.max(0, th.ambient) * this.keyScale * this.tune.key * (1 - tk * 0.35);

    // Shared look of every lit surface: wet stone, and the haze reflected at grazing angles.
    LOOK.uTime.value = this.time;
    LOOK.uWet.value = th.wet;
    LOOK.uRim.value = th.rim * this.tune.rim * (1 - tk * 0.3);
    LOOK.uRimColor.value.copy(fog.color).multiplyScalar(1.5);

    // Lantern flicker (a living flame, never a strobe).
    const t = this.time;
    const flick =
      1 + 0.05 * Math.sin(t * 11.3) * Math.sin(t * 2.9 + 0.7) + 0.035 * Math.sin(t * 23.7 + Math.sin(t * 1.3) * 2) - (Math.sin(t * 0.61) > 0.992 ? 0.18 : 0);
    const dead = game && game.player && game.player.alive === false;
    this.lantern.intensity = this.lanternBase * flick * (dead ? 0.35 : 1);
    this.lantern.position.set(Math.sin(t * 7.1) * 0.006, Math.sin(t * 5.3) * 0.006, 0);
    _tmpC.setHex(PALETTE.lantern);
    this.lantern.color.copy(_tmpC).lerp(th.accent, 0.08);

    this._updateEnvLights(d, head);
    this._game = game || this._game;
    this.lighting.update(d, game, th, tgt, this._lampFlick);
    this._fogInfo.near = fog.near;
    this.levelView.update(d, game, head, fog.far, this._fogInfo);
    this.ropeView.update(d, game, head);
    this.fx.update(d, game, head, this.threat);

    // Pulse the glyph of an anchor the moment a tether bites.
    if (game && game.bus && game.bus !== this._bus) this._bindBus(game.bus);
  }

  _bindBus(bus) {
    if (this._busOff) this._busOff();
    this._bus = bus;
    this._busOff = typeof bus.on === 'function' ? bus.on('grapple:attach', (e) => this.levelView.pulseAnchor(e && e.anchor)) : null;
  }

  // ---------------------------------------------------------------------------
  // Quality + look API
  // ---------------------------------------------------------------------------
  /**
   * Pins the lighting / detail tier ('low' | 'quest' | 'high'); null returns to automatic (?fx=, settings.fxQuality,
   * settings.reducedEffects, XR → quest, else high). opts.live keeps the current reflection-probe resolution (what a
   * governor does); without it a pin that needs another resolution rebuilds the probe (do it behind a fade).
   */
  setQualityTier(name, opts) {
    return this.lighting.setTier(name, opts);
  }

  get qualityTier() {
    return this.lighting.tier;
  }

  /** Shared reflection + wet-stone look for another module's MeshStandardMaterial (see Lighting.applyLookTo). */
  applyLookTo(material, opts) {
    return this.lighting.applyLookTo(material, opts);
  }

  render() {
    const r = this.renderer;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    r.render(this.scene, this.camera);
    const info = r.info;
    this.stats.calls = info.render.calls;
    this.stats.triangles = info.render.triangles;
    this.stats.points = info.render.points;
    this.stats.programs = info.programs ? info.programs.length : 0;
    if (t0) this.stats.frameMs = performance.now() - t0;
  }

  resize() {
    const r = this.renderer;
    if (r.xr && r.xr.isPresenting) return;
    const el = this.container;
    let w = el && el.clientWidth ? el.clientWidth : 0;
    let h = el && el.clientHeight ? el.clientHeight : 0;
    if ((!w || !h) && typeof window !== 'undefined') {
      w = window.innerWidth;
      h = window.innerHeight;
    }
    if (!w || !h) return;
    r.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2));
    r.setSize(w, h);
    // An XR session leaves its own fov/zoom on the user camera (WebXRManager.updateUserCamera).
    this.camera.fov = this.baseFov;
    this.camera.zoom = 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    if (typeof window !== 'undefined') window.removeEventListener('resize', this.resize);
    if (this._busOff) this._busOff();
    this.lighting.dispose();
    this.fx.dispose();
    this.ropeView.dispose();
    this.levelView.dispose();
    this.materials.dispose();
    this.lanternBulb.geometry.dispose();
    this.lanternBulb.material.dispose();
    if (this.sky) this.sky.geometry.dispose();
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
  }
}
