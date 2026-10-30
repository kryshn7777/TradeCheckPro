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
 *   .contactShadows                 dynamic blob shadows (contactShadows.js): 1 draw call, <= 24 quads, hidden outside a run
 *   .droppedProps                   thrown / dropped bag items with weight (droppedProps.js); .spawn(kind, x,y,z, vx,vy,vz);
 *                                   bus 'prop:impact' {kind,x,y,z,speed,surface} is the impact-sound hook
 *   .lighting                       reflections (envProbe.js) + baked GI (lighting.js) + wet glint; see lighting.js
 *   .lanternShadow                  real-time shadow of the carried lantern (lanternShadow.js): cached static depth map + small
 *                                   dynamic one, sampled by the lantern term only; tiers low off / quest 1024 / high 2048, reduced
 *                                   by the governor (level 2) and off at level 3. API: setEnabled(bool) · setTier('low'|'quest'|'high'|null)
 *                                   · stats; the passes are counted in .stats (render() resets renderer.info once per frame)
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
import { KEY_DIR, LOOK, MaterialLibrary, PALETTE, configureTextureLoading, installRadialFog, loadTextureManifest } from './materials.js';
import { LevelView, glowTexture } from './levelView.js';
import { RopeView } from './ropeView.js';
import { FX } from './fx.js';
import { Lighting } from './lighting.js';
import { RenderGovernor } from './renderGovernor.js';
import { createGLTFLoader, setKTX2Renderer } from './glbLoad.js';
import { ContactShadows } from './contactShadows.js';
import { DroppedProps } from './droppedProps.js';
import { LanternShadow } from './lanternShadow.js';
import { maxPixelRatio } from '../platform/deviceProfile.js';
import { LevelCache } from './levelCache.js'; // LOADING_OPTIMIZATION.md: the dressed level cached in IndexedDB
import { depthDarknessAt, foldDarkness } from '../sim/nightVision3d.js';

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
const FOG_THICKNESS = 2; // the haze is twice as thick: the distance fog closes in at half the range (the volumetric fog doubles in atmosphere.js)
const FOG_WARM_DESAT = 0.65; // how much of a warm fog's colour is drawn out (0 = none): S5 / S8 read as an orange wash at full saturation
const NV_FOG = new THREE.Color(0.014, 0.095, 0.035); // the haze through the night vision goggles (render/nightVisionView.js tints the picture)
const FOG_LUM_FLOOR = 0.013; // minimum linear luminance of the haze (≈ sRGB 30/255) so no section is pure black
const LANTERN_CANDELA = 6.5;
const LANTERN_RANGE = 30;
const LANTERN_DECAY = 1.6; // gentler than physical so the lantern still grazes walls 10–20 m away
const DEFAULT_TEXTURE_MANIFEST = 'assets/textures/manifest.json';
/** The Underspire environment kit (tools/abyssal-tether-3d/build_env_kit.py), relative to this module. */
const ENV_KIT_URL = new URL('../../assets/models/env/ch1_env_kit.glb', import.meta.url).href;
/** The near-field props v2 (tools/abyssal-tether-3d/build_props_v2.py): giant chain links, the Lanternwright statue, the scene-detail heroes. */
const PROPS_URL = new URL('../../assets/models/env/ch1_props_v2.glb', import.meta.url).href;
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

// Surface-detail levers per quality tier (materials.js LOOK.uParallaxK / uDetailK / uCrevK): parallax offset on near faces,
// the shared detail normal, crack grime / moss. Quest: one parallax tap within 8 m, detail normal within 16 m.
const SURFACE_TIERS = {
  low: { parallax: 1, parMax: 5, parFade: 2, steps: 0, stepMax: 0, stepFade: 1, parScale: 1, detail: 0.5, dNear: 2.5, dFar: 7, crev: 0.6, near: 0, bevel: 0, bevelFar: 14, pud: 0.5 },
  quest: { parallax: 1, parMax: 8, parFade: 3, steps: 6, stepMax: 3, stepFade: 1.2, parScale: 1, detail: 0.9, dNear: 5, dFar: 16, crev: 1, near: 1, bevel: 1, bevelFar: 30, pud: 1 },
  high: { parallax: 1, parMax: 13, parFade: 5, steps: 10, stepMax: 5, stepFade: 1.8, parScale: 1.1, detail: 1, dNear: 8, dFar: 26, crev: 1, near: 1, bevel: 1.15, bevelFar: 44, pud: 1 },
};
// Parallax-corrected probe box: the shaft box is inflated a little so the far window overhead and the lancets ring stay beyond the walls.
const PROBE_BOX_GROW = 1.0;
const PROBE_BOX_EASE = 3; // 1/s: the box eases between sections (the theme blend band is ~18 m wide)
// WebXR framebuffer scale per tier (1 = the runtime's recommended size). Must be set before the session starts; the platform
// governor (platform/governor.js) then lowers the viewport from this allocation through its own scale steps. Quest 1.15 -> 1.0
// (perf pass: 1.15 shaded 1.32x the pixels of every lit, parallax / detail-normal fragment and of every blended layer; never measured
// at 72 Hz on a headset). Settings > Display > Render scale (x0.7..1.3) still raises it per player, e.g. 115 % for the old picture.
const XR_RENDER_SCALE = { low: 1.0, quest: 1.0, high: 1.2 };
// Foveation by governor level when the platform governor is absent (it sets 0.5 / 1 itself).
const XR_FOVEATION = [0.5, 0.66, 0.66, 1, 1];
// Highest foveation level any caller may set per tier. Quest Browser maps 0..1 onto low / medium / high; the high level is a
// visible blur at the periphery on a 4K-class LCD panel, so the quest and high tiers cap at medium (0.66). Only the `low`
// (emergency) tier may use full foveation. The platform governor / game call xr.setFoveation(1) directly: wrapped in the constructor.
const XR_FOVEATION_CAP = { low: 1, quest: 0.66, high: 0.5 };
// Near plane (m). The head-clearance fade (game.js HEAD_BLACK 0.1 m, eyes 0.032 m off the head centre) keeps solids beyond
// ~0.1 m, so 0.08 never cuts the view; it doubles the depth resolution of the old 0.05 (24-bit depth, far 400).
const CAMERA_NEAR = 0.08;
// Cap of the lit surfaces' black-point lift (linear, before the tone mapper; the ACES curve has a slope of ~0.45 there).
const BLACK_LIFT_MAX = 0.004;
/**
 * The look of the whole game, one preset (`?look=classic` or settings.look = 'classic' brings the previous picture back):
 * horror = a lower exposure, a steeper contrast curve, drained colour, cold crushed shadows with sickly warm lights, a vignette
 * and fine film grain (all in the lit materials' grade, no post pass), and a lower black lift (the pits go darker).
 */
const LOOK_PRESETS = {
  horror: { exposure: 1.0, contrast: 0.16, sat: -0.14, lift: 0.5, grain: 0.04, vignette: 0.4, tone: 1.0 },
  classic: { exposure: 1.25, contrast: 0, sat: 0, lift: 1, grain: 0, vignette: 0, tone: 0 },
};
function lookPreset(settings) {
  let n = settings && typeof settings.look === 'string' ? settings.look : 'horror';
  try {
    const m = /[?&]look=([a-z]+)/i.exec((typeof location !== 'undefined' && location.search) || '');
    if (m) n = m[1].toLowerCase();
  } catch {
    /* no location */
  }
  return LOOK_PRESETS[n] || LOOK_PRESETS.horror;
}

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
    r.setPixelRatio(maxPixelRatio());
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    this.look = lookPreset(this.settings);
    r.toneMappingExposure = this.look.exposure;
    r.shadowMap.enabled = false; // three.js' own shadow maps stay off: the lantern shadow is custom (lanternShadow.js)
    r.info.autoReset = false; // render() resets it once per frame so the shadow passes and the main pass add up in stats
    r.xr.enabled = true;
    try {
      // cap every foveation request at the tier's level (see XR_FOVEATION_CAP); `this` is not built yet: read the tier lazily
      const setFov = r.xr.setFoveation.bind(r.xr);
      r.xr.setFoveation = (v) => {
        const tier = this.lighting ? this.lighting.tier : 'quest';
        const cap = XR_FOVEATION_CAP[tier] != null ? XR_FOVEATION_CAP[tier] : 0.66;
        return setFov(Math.min(num(v, 0.5), cap));
      };
      r.xr.setFoveation(0.5);
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
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 16 / 9, CAMERA_NEAR, 400);
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
    // Fake bloom on the lantern (no post pass): one additive sprite with a soft skirt and a gentle anamorphic streak. It is
    // drawn over whatever is in front of it (depthTest off), so it blooms across the glass and the fingers like a real flare.
    this.lanternFlare = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTexture(128), color: 0xffb46a, transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, fog: false, toneMapped: false, opacity: 0.0 }),
    );
    this.lanternFlare.name = 'LanternFlare';
    this.lanternFlare.scale.set(0.42, 0.42, 1);
    this.lanternFlare.renderOrder = 70;
    this.lanternFlare.material.userData.noLook = true;
    this.lanternFlare.visible = false; // the fake bloom is OFF (owner's call); the sprite stays so the API and the dispose path are unchanged
    this.lanternGroup.add(this.lanternFlare);
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
    configureTextureLoading({ renderer: r }); // KTX2 (GPU-compressed) texture sets need the renderer's compressed-format support
    setKTX2Renderer(r); // ... and so do the KHR_texture_basisu textures of the shipped GLBs (hands, body, Mason)
    this._game = null;
    this._bus = null;
    this._lampFlick = 1;
    this.governor = new RenderGovernor(this);
    this.lighting = new Lighting(this);
    this.xrRenderScale = XR_RENDER_SCALE[this.lighting.tier] || 1;
    this._applyXRRenderScale();
    // the next session starts with the tier's scale again (a degraded tier during this one never reaches the swapchain)
    if (r.xr.addEventListener) r.xr.addEventListener('sessionend', () => this._applyXRRenderScale());
    this.governor.on((ev) => this._applyXRFoveation(ev.level));
    this.lightingReady = Promise.resolve(false);
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 24, 12), this.materials.get('sky'));
    this.sky.name = 'SkyDome';
    this.sky.renderOrder = -1000;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
    this.levelView = new LevelView(this.scene, this.materials);
    // LOADING_OPTIMIZATION.md: the dressed level (decor merge + dressing job) from IndexedDB when its inputs did not change (levelCache.js)
    this.levelCache = new LevelCache([ENV_KIT_URL, PROPS_URL]);
    if (this.levelCache.on) this.levelView.cache = this.levelCache;
    this.envKit = this._loadEnvKit();
    this.props = this._loadProps();
    this.ropeView = new RopeView(this.scene);
    this.fx = new FX(this.scene, this.camera);
    this.levelView.fx = this.fx;
    // WP-GFX-PARITY: contact shadows (one instanced batch: body, hands, creature feet, supplies, rope end, dropped items) and the
    // dropped / thrown bag items with weight (one dynamic mesh, hidden while nothing is in flight)
    this.contactShadows = new ContactShadows(this.scene);
    this.droppedProps = new DroppedProps(this.scene);
    // WP-SHADOWS: the lantern's real-time shadow (cached static depth + small dynamic depth; quest 1024 / high 2048 / low off)
    this.lanternShadow = new LanternShadow(this);

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
    this._dark = 0;
    this.depthF = 0; // the fractional section index at the head (sim/nightVision3d.js: the depth darkness and the lantern's fade read it)
    this.deepDark = 1; // 0..1 scale of the darkness the depth adds (Settings; ?deepdark=)
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
  /**
   * Loads the props v2 GLB (meshopt, no textures) and hands it to the LevelView (chains / statues as levels of detail; the procedural
   * builders draw them if it fails: setProps(null)); the scene detail picks its hero templates up from `_propsGltf`.
   */
  _loadProps() {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return Promise.resolve(false);
    const fail = () => {
      this.levelView.setProps(null);
      return false;
    };
    return createGLTFLoader()
      .then((loader) => new Promise((resolve) => loader.load(PROPS_URL, (gltf) => resolve(gltf), undefined, () => resolve(null))))
      .then((gltf) => {
        if (!gltf) return fail();
        this._propsGltf = gltf;
        return this.levelView.setProps(gltf);
      })
      .catch((err) => {
        if (typeof console !== 'undefined') console.warn('[AT3D] props v2 unavailable, procedural props only', err);
        return fail();
      });
  }

  _loadEnvKit() {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return Promise.resolve(false);
    return createGLTFLoader()
      .then(
        (loader) =>
          new Promise((resolve) => {
            loader.load(
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
    this.lanternShadow.setLevel(level);
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
      e.light.intensity = e.src.candela * e.level * f * (1 - 0.6 * this._dark); // the level's lamps burn lower on the dark difficulties
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

    // The darkness: the difficulty's (Nightmare / Abyss) folded with the depth's (the descent is dark on purpose: every section adds
    // some, sim/nightVision3d.js; not on the menu's drifting background), eased in, then applied to the theme target below and to
    // the baked light / the lamps. The night vision goggles take it off again for the picture they show (k = their power-up ramp).
    this.depthF = tgt.ia + (tgt.ib - tgt.ia) * tgt.w;
    const nvK = THREE.MathUtils.clamp(num(game && game.nv && game.nv.k, 0), 0, 1);
    const inRun = !!game && !game.hidePlayer;
    const wantDark = foldDarkness(num(game && game.diff && game.diff.darkness, 0), inRun ? depthDarknessAt(this.depthF) * this.deepDark : 0);
    this._dark += (wantDark - this._dark) * (this._themeInit ? 1 - Math.exp(-1.5 * d) : 1);
    const dark = this._dark * (1 - 0.92 * nvK);
    this.lighting.setDarkness(dark);
    this.lighting.setNightVision(nvK);
    if (dark > 0.001) {
      tgt.ambient *= 1 - 0.95 * dark; // hemisphere + key + everything that reads the theme's ambient
      tgt.fog.multiplyScalar(1 - 0.85 * dark);
      tgt.light.multiplyScalar(1 - 0.5 * dark);
    }
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
    // The warm sections' fog (S5 / S6 / S8: brown, amber) is the whole backdrop and the far wall of every view, and it moves with the head:
    // at full saturation it read as an orange screen stuck to the camera. Pull warm hues toward their own grey (luminance kept);
    // the blue / green fogs (r <= b) are untouched.
    const lum0 = fog.color.r * 0.2126 + fog.color.g * 0.7152 + fog.color.b * 0.0722;
    const warm = THREE.MathUtils.clamp(((fog.color.r - fog.color.b) / Math.max(fog.color.r, 1e-4)) * 1.6, 0, 1);
    const keep = 1 - FOG_WARM_DESAT * warm;
    fog.color.setRGB(lum0 + (fog.color.r - lum0) * keep, lum0 + (fog.color.g - lum0) * keep, lum0 + (fog.color.b - lum0) * keep);
    const lum = fog.color.r * 0.2126 + fog.color.g * 0.7152 + fog.color.b * 0.0722;
    const lumFloor = FOG_LUM_FLOOR * (1 - 0.95 * dark); // the haze may go darker than the floor of the other difficulties
    if (lum < lumFloor) fog.color.multiplyScalar(lumFloor / Math.max(lum, 1e-4));
    fog.color.multiplyScalar(1 - tk * 0.22);
    if (nvK > 0.001) fog.color.lerp(NV_FOG, 0.85 * nvK); // through the goggles the haze is a pale phosphor green
    fog.near =Math.max(0.5, (th.fogNear * (1 - tk * 0.3)) / FOG_THICKNESS);
    fog.far = Math.max(fog.near + 4, (th.fogFar * (1 - tk * 0.18)) / FOG_THICKNESS);
    this.scene.background.copy(fog.color);
    if (this.sky) this.sky.position.copy(head);

    // Ambient: hemisphere from the theme light (sky) over a dark ground.
    _tmpC.copy(th.light);
    const grey = (_tmpC.r + _tmpC.g + _tmpC.b) / 3;
    this.hemi.color.setRGB(grey, grey, grey).lerp(_tmpC, 0.7);
    this.hemi.groundColor.copy(th.fog).multiplyScalar(0.9).lerp(th.accent, 0.06);
    this.hemi.intensity = Math.max(0, th.ambient) * AMBIENT_SCALE * this.tune.ambient * (1 - tk * 0.25) * (1 + 2.4 * nvK);
    // Key from above: the theme light, desaturated a little (a pale shaft of the
    // surface's daylight), weaker with the threat.
    this.key.color.setRGB(grey, grey, grey).lerp(_tmpC, 0.55);
    this.key.intensity = Math.max(0, th.ambient) * this.keyScale * this.tune.key * (1 - tk * 0.35) * (1 + 1.6 * nvK);

    // Shared look of every lit surface: wet stone, and the haze reflected at grazing angles.
    LOOK.uTime.value = this.time;
    LOOK.uWet.value = th.wet;
    LOOK.uRim.value = th.rim * this.tune.rim * (1 - tk * 0.3);
    LOOK.uRimColor.value.copy(fog.color).multiplyScalar(1.5);
    this._driveSurfaceLook(th, tk);
    this._driveProbeBox(d, head);

    // Lantern flicker (a living flame, never a strobe).
    const t = this.time;
    const flick =
      1 + 0.05 * Math.sin(t * 11.3) * Math.sin(t * 2.9 + 0.7) + 0.035 * Math.sin(t * 23.7 + Math.sin(t * 1.3) * 2) - (Math.sin(t * 0.61) > 0.992 ? 0.18 : 0);
    const dead = game && game.player && game.player.alive === false;
    this.lantern.intensity = this.lanternBase * flick * (dead ? 0.35 : 1);
    this.lanternFlare.material.opacity = 0.26 * flick * (dead ? 0.3 : 1);
    this.lantern.position.set(Math.sin(t * 7.1) * 0.006, Math.sin(t * 5.3) * 0.006, 0);
    _tmpC.setHex(PALETTE.lantern);
    this.lantern.color.copy(_tmpC).lerp(th.accent, 0.08);

    this._updateEnvLights(d, head);
    this._game = game || this._game;
    this.lighting.update(d, game, th, tgt, this._lampFlick);
    this._fogInfo.near = fog.near;
    // Settings › Display › Blood writing (off by default): built / removed live; a fresh build compiles and uploads now
    const gs = this._game && this._game.settings;
    if (gs && this.levelView.setBlood(gs.bloodWriting === true)) this.precompile();
    this.levelView.update(d, game, head, fog.far, this._fogInfo);
    if (this.levelCache.on) this.levelCache.tick(this.levelView); // a finished procedural dressing: saved, a slice per frame
    this.ropeView.update(d, game, head);
    this.fx.godRays.materials = this.materials;
    this.fx.godRays.setQuality(this.lighting.tier, 0, this.settings && this.settings.reducedEffects);
    this.fx.update(d, game, head, this.threat);
    this.droppedProps.update(d, game);
    this.contactShadows.update(d, game, head, this);
    this.lanternShadow.update(d, game);

    // Pulse the glyph of an anchor the moment a tether bites.
    if (game && game.bus && game.bus !== this._bus) this._bindBus(game.bus);
  }

  _bindBus(bus) {
    if (this._busOff) this._busOff();
    this._bus = bus;
    this._busOff = typeof bus.on === 'function' ? bus.on('grapple:attach', (e) => this.levelView.pulseAnchor(e && e.anchor)) : null;
    this.droppedProps.bind(bus, () => this._game);
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
    const r = this.lighting.setTier(name, opts);
    // The framebuffer scale is read once, when a session starts (a change mid-session resets the swapchain, or is ignored with a
    // warning): a tier step made by the governor while presenting must not rewrite the value the NEXT session will start with.
    if (!this.renderer.xr.isPresenting) this.setXRRenderScale(XR_RENDER_SCALE[this.lighting.tier] || this.xrRenderScale);
    return r;
  }

  /**
   * WebXR framebuffer scale (1 = the runtime's recommended resolution): 1.0 on the quest tier, 1.2 high, 1.0 low. three.js only
   * reads it when a session starts, so a change made while presenting waits for the next session; the platform governor
   * lowers the *viewport* inside this allocation (levels 2-4 = 0.9 / 0.8 / 0.7 of it) when frames are missed.
   */
  setXRRenderScale(f) {
    this.xrRenderScale = THREE.MathUtils.clamp(num(f, this.xrRenderScale || 1), 0.6, 1.5);
    this._applyXRRenderScale();
    return this.xrRenderScale;
  }

  _applyXRRenderScale() {
    const xr = this.renderer.xr;
    if (!xr || typeof xr.setFramebufferScaleFactor !== 'function' || xr.isPresenting) return;
    try {
      xr.setFramebufferScaleFactor(this.xrRenderScale);
    } catch {
      /* older runtimes */
    }
  }

  /** Foveation follows the governor level when there is no platform governor driving it (desktop / tests / QA). */
  _applyXRFoveation(level) {
    const xr = this.renderer.xr;
    if (!xr || !xr.isPresenting || this.governor.mode === 'platform' || typeof xr.setFoveation !== 'function') return;
    try {
      xr.setFoveation(XR_FOVEATION[Math.max(0, Math.min(XR_FOVEATION.length - 1, level | 0))]);
    } catch {
      /* layer without foveation */
    }
  }

  /** Per frame: the tier / governor levers of the surface shader (parallax, detail normal, crevices) and the section grade. */
  _driveSurfaceLook(th, tk) {
    const P = SURFACE_TIERS[this.lighting.tier] || SURFACE_TIERS.quest;
    const lvl = 0; // the frame governor trades resolution only (platform/governor.js): the surface look follows the tier alone
    const par = lvl >= 3 ? 0 : P.parallax;
    LOOK.uParallaxK.value.set(par, P.parMax, P.parFade, P.parScale);
    LOOK.uParallaxS.value.set(lvl >= 2 ? 0 : P.steps, P.stepMax, P.stepFade, 0);
    LOOK.uDetailK.value.set(P.detail * (lvl >= 3 ? 0.6 : 1), lvl >= 2 ? P.dNear * 0.7 : P.dNear, lvl >= 2 ? P.dFar * 0.7 : P.dFar, lvl >= 2 ? 0 : P.near);
    LOOK.uCrevK.value.set(0.55 * P.crev, 0.55 * P.crev, 0.7 * P.crev, 0);
    // edge bevel (box solids) and standing water: tier levers; the governor drops the bevel first at level 2 (pure ALU)
    LOOK.uBevelK.value.set(lvl >= 2 ? 0 : P.bevel, 0.035, lvl >= 1 ? P.bevelFar * 0.7 : P.bevelFar, 0);
    LOOK.uPudK.value.x = (lvl >= 3 ? 0.5 : 1) * P.pud;
    // Grade: a little contrast, the sections' warmth/cold in the highlights, slight desaturation, more with depth.
    const a = th.accent;
    const m = Math.max(a.r, a.g, a.b, 1e-3);
    LOOK.uGradeTint.value.setRGB(1 + (a.r / m - 1) * 0.1, 1 + (a.g / m - 1) * 0.1, 1 + (a.b / m - 1) * 0.1);
    const lk = this.look;
    LOOK.uGradeK.value.set(1.1 + 0.06 * tk + lk.contrast, 0.94 - 0.1 * tk + lk.sat, 0.22, 0);
    const lowFx = this.lighting.tier === 'low' || (this.settings && this.settings.reducedEffects);
    LOOK.uHorrorK.value.set(lowFx ? 0 : lk.grain, lk.vignette, lk.tone, (this.time || 0) % 100);
    // LCD black point: a Quest 3 panel never reaches OLED black, so crushed pits read as a hole in the picture, not as depth. The
    // darkest lit surfaces keep a trace (a third of the haze colour, so it follows the section's mood), never more than ~sRGB 8/255.
    const fc = this.scene.fog.color;
    const fl = Math.max(fc.r * 0.2126 + fc.g * 0.7152 + fc.b * 0.0722, 1e-4);
    const lift = Math.min(0.3, (BLACK_LIFT_MAX * this.look.lift) / fl);
    LOOK.uBlack.value.setRGB(fc.r * lift, fc.g * lift, fc.b * lift);
  }

  /**
   * Parallax-corrected reflections: the shared probe box follows the head's section (its shaft: inner faces x/z, section y range),
   * eased in time so the section change never pops. No shaft (a chamber without walls) = no correction for that section.
   */
  _driveProbeBox(dt, head) {
    const lv = this.level;
    const C = LOOK.uProbeC.value;
    const H = LOOK.uProbeH.value;
    let want = false;
    if (lv && typeof lv.sectionAt === 'function') {
      const sec = lv.sectionAt(head.y);
      const sh = sec && sec.shaft;
      if (sh && isFinite(sh.minX) && isFinite(sh.maxX) && isFinite(sh.minZ) && isFinite(sh.maxZ) && isFinite(sec.yTop) && isFinite(sec.yBottom)) {
        const cx = (sh.minX + sh.maxX) * 0.5;
        const cy = (sec.yTop + sec.yBottom) * 0.5;
        const cz = (sh.minZ + sh.maxZ) * 0.5;
        const hx = Math.max(4, (sh.maxX - sh.minX) * 0.5) * PROBE_BOX_GROW;
        const hy = Math.max(6, (sec.yTop - sec.yBottom) * 0.5) * PROBE_BOX_GROW;
        const hz = Math.max(4, (sh.maxZ - sh.minZ) * 0.5) * PROBE_BOX_GROW;
        const k = C.w > 0.5 ? 1 - Math.exp(-PROBE_BOX_EASE * dt) : 1;
        C.x += (cx - C.x) * k;
        C.y += (cy - C.y) * k;
        C.z += (cz - C.z) * k;
        H.x += (hx - H.x) * k;
        H.y += (hy - H.y) * k;
        H.z += (hz - H.z) * k;
        want = true;
      }
    }
    C.w = want ? 1 : 0;
  }

  /**
   * What the XR path uses, for QA / the debug API: the canvas was created with antialias (three.js then allocates the XR layer with 4
   * MSAA samples; the desktop canvas keeps the browser's default MSAA, no extra pass), the framebuffer scale the next session starts
   * with (tier scale x settings.renderScale), the foveation cap of the tier (the platform governor's requests are clamped to it, only
   * while a session is presenting) and whether a session is presenting now. Nothing here touches the desktop path.
   */
  xrSettings() {
    const r = this.renderer;
    let attrs = null;
    try {
      attrs = r.getContext().getContextAttributes();
    } catch {
      attrs = null;
    }
    const tier = this.lighting.tier;
    return {
      presenting: !!(r.xr && r.xr.isPresenting),
      antialias: !!(attrs && attrs.antialias),
      msaaSamplesXR: attrs && attrs.antialias ? 4 : 0,
      framebufferScale: this.xrRenderScale,
      foveationCap: XR_FOVEATION_CAP[tier] != null ? XR_FOVEATION_CAP[tier] : 0.66,
      tier,
    };
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
    const info = r.info;
    info.reset(); // autoReset is off: one reset per frame, the lantern-shadow passes and the main render add up
    const ls = this.lanternShadow;
    let shCalls = 0;
    if (ls && this.level) {
      try {
        ls.render();
        shCalls = ls.stats.calls;
      } catch (err) {
        ls.setEnabled(false); // a failing shadow pass must never take the frame down
        if (typeof console !== 'undefined') console.warn('[AT3D] lantern shadow disabled', err);
      }
    }
    r.render(this.scene, this.camera);
    this.stats.shadowCalls = shCalls;
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
    r.setPixelRatio(maxPixelRatio());
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
    this.contactShadows.dispose();
    this.lanternShadow.dispose();
    this.droppedProps.dispose();
    this.fx.dispose();
    this.ropeView.dispose();
    this.levelView.dispose();
    this.materials.dispose();
    this.lanternBulb.geometry.dispose();
    if (this.lanternFlare.material.map) this.lanternFlare.material.map.dispose();
    this.lanternFlare.material.dispose();
    this.lanternBulb.material.dispose();
    if (this.sky) this.sky.geometry.dispose();
    this.renderer.setAnimationLoop(null);
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
  }
}
