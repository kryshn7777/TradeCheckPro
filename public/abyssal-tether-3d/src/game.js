/* ABYSSAL TETHER 3D — game.js
 * Game3D: the integrator for the WebXR / desktop build. It owns the
 * renderer.setAnimationLoop loop (required for XR) and the state machine
 *
 *   menu (attract) → playing ⇄ paused → dead → respawn / restart → victory
 *
 * builds a run from a difficulty preset, steps the fixed-rate physics with
 * render interpolation, moves the player rig (XR: the room follows the body;
 * desktop: the camera sits at the body's eyes), tracks sections /
 * checkpoints / hints / triggers / the goal, routes bus events into feedback
 * (haptics, flash and fade — never camera shake, which is poison in VR) and
 * exposes the window.AT3D debug API used by automated tests.
 *
 * Robustness: the core (level + physics) is required. Every other subsystem
 * is loaded with a dynamic import and constructed inside try/catch; a module
 * that fails to load, construct or keeps throwing is replaced by a stand-in
 * (null objects, a minimal three.js renderer, a minimal desktop input), so a
 * broken teammate module never blocks play.
 *
 * Performance: no allocation in the per-frame path (scratch objects are
 * reused, closures are only created for rare calls).
 */

import * as THREE from 'three';
import { CONFIG, DIFFICULTY, SETTINGS_DEFAULTS, U, EventBus, Storage, eyeAboveBody, sanitizeHeightSettings, sanitizeUxSettings } from './sim/config3d.js';
import { makeSnapState, snapTurnStep, SNAP_FULL_RATE } from './ui/uxLogic.js';
import { Player3D, TetherSystem, Physics3D, HANDS } from './sim/physics3d.js';
import { Inventory3D, ITEM, ITEM_NAMES, lanternLevel as lanternLevelOf } from './sim/inventory3d.js';
import { Pickups3D } from './sim/pickups3d.js';
import { ropeHaptic } from './audio/dsp3d.js';
import { maxPixelRatio } from './platform/deviceProfile.js';

const C = CONFIG;

// -----------------------------------------------------------------------------
// Tuning (seconds / metres unless noted)
// -----------------------------------------------------------------------------
const DEATH_PANEL_DELAY = 0.6; // death → death panel (and earliest respawn input)
const VICTORY_DELAY = 2.8; // goal reached → victory panel (the gate slam plays out)
const HINT_DEFAULT_SECONDS = 6;
const HINT_GAP = 3.2; // a hint stays at least this long before a queued one replaces it
const HINT_QUEUE_MAX = 3;
const ATTRACT_SPEED = 3.2; // menu camera descent (m/s)
const ATTRACT_FADE_OUT = 1.6;
const ATTRACT_FADE_IN = 2.0;
const ATTRACT_EYE = eyeAboveBody(); // attract camera height above the path: a standing person's eyes (1.62 m above the feet)
const ATTRACT_STEP = 1; // attract path sample spacing (m of descent)
const ATTRACT_CLEAR = 0.7; // free radius the attract camera keeps around itself
const ATTRACT_MAX_SLIDE = 0.8; // max sideways drift per metre of descent
const DEATH_FADE_MAX = 0.9; // VR: near-black around the head
const PAUSE_FADE = 0.45; // dim the world behind the pause panel (VR readability)
const VICTORY_FADE = 0.4;
const RESPAWN_FADE = 0.95;
const START_FADE = 1;
const RESTART_FADE = 0.7;
const FADE_IN_RATE = 1.5; // fade units per second when clearing
// The head is free of the body (XR: lean / step in the room) and sits 1.24 m above the sphere centre (1:1 height), so
// it can meet an overhang the body passes under. Within HEAD_CLEAR of a solid the view starts to fade, black by
// HEAD_BLACK: the near plane is 0.05 m and each eye sits 0.032 m off the head centre, so geometry within ~0.09 m of
// the head can cut the near plane. A wall never opens onto the void outside the level or the predator behind it.
// The head-clearance audit (tools/abyssal-tether-3d/verify/headclear.mjs) keeps every route ≥ 0.25 m clear of it.
const HEAD_CLEAR = 0.2;
const HEAD_BLACK = 0.1;
const HEAD_FADE_IN = 10; // fade units per second while entering geometry
const HEAD_FADE_OUT = 4;
const XR_BLUR_GRACE = 3; // ignore window blur this long after an XR session starts (Quest focus juggling)
const XR_RECENTRE_FRAMES = 3; // wait for a few posed XR frames before reading the head pose
const TENSION_HAPTIC_PERIOD = 0.12;
const CREATURE_HAPTIC_RANGE = 30;
const FAULT_LOG_LIMIT = 3;
const RENDER_FAULT_SWAP = 20; // consecutive renderer failures before the fallback renderer takes over
const FATAL_FRAME_ERRORS = 90;
const MAX_DEBUG_STEP_FRAMES = 60 * 600;
const BOOT_ASSET_TIMEOUT = 4000; // ms to wait for the texture manifest before building the level view

const KIT_URL = new URL('../assets/models/mason_kit.glb', import.meta.url).href;
const RIG_URL = new URL('../assets/models/mason_rig.glb', import.meta.url).href;
// the small hunters keep the ORIGINAL Mason model (the big one was redesigned): their own glb, loaded after the Mason's
const SKITTER_RIG_URL = new URL('../assets/models/skitter_rig.glb', import.meta.url).href;
const CREATURE_LOD = { low: 11, quest: 16, high: 38 }; // creature LOD0 -> LOD1 switch distance (m) per render tier (hysteresis 5 m in the view)
const TEXTURE_MANIFEST_URL = new URL('../assets/textures/manifest.json', import.meta.url).href;

/** Optional subsystem modules (dynamic imports; a missing/broken file → stand-in). */
const MODULES = {
  level: './sim/level3d.js',
  levelData: './data/level-data-3d.js',
  creature: './sim/creature3d.js',
  skitter: './sim/skitter3d.js',
  threat: './sim/threat3d.js',
  renderer: './render/renderer3d.js',
  creatureView: './render/creatureView.js',
  masonRigView: './render/masonRigView.js',
  handsView: './render/handsView.js',
  healthFx: './render/healthFx.js',
  bodyView: './render/bodyView.js',
  pickupsView: './render/pickupsView.js',
  bagFx: './render/bagFx.js',
  climbView: './render/climbView.js',
  sceneDetail: './render/sceneDetail.js',
  input: './input/inputManager.js',
  ui: './ui/ui3d.js',
  audio: './audio/audio3d.js',
  gltf: 'three/addons/loaders/GLTFLoader.js',
  glbLoad: './render/glbLoad.js', // KTX2 loader for the KHR_texture_basisu GLB textures (attachKTX2)
  // WP-RELEASE: platform + meta modules (every one optional; the game plays without them)
  loadingScene: './platform/loadingScene.js',
  resilience: './platform/resilience.js',
  governor: './platform/governor.js',
  entitlement: './platform/entitlement.js',
  save: './meta/save.js',
};
/** Loaded before the first head-tracked frame (bootMinimal); everything else loads behind the loading scene. */
const EARLY_MODULES = ['renderer', 'input', 'loadingScene', 'resilience', 'governor', 'save'];
const LATE_MODULES = Object.keys(MODULES).filter((n) => !EARLY_MODULES.includes(n));
const SAVE_WAIT_MS = 1500; // bootContent waits at most this long for the saved profile
/** Lets queued tasks (XR frame callbacks, input) run between heavy boot steps. */
const yieldToFrames = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Short, original death lines per cause (round-robin by death count). */
const DEATH_MESSAGES = {
  impact: ['The floor came up faster than the line.', 'Stone keeps no promises.', 'Too far. Too fast.', 'The Underspire caught you. Badly.'],
  hazard: ['The old ironwork was still sharp.', 'The Lanternwrights left their edges keen.', 'Rust and teeth.'],
  fall: ['The dark took all of you.', 'Down past where the light can follow.', 'No line. No floor.'],
  creature: ['It found you.', 'The walls closed their hand.', 'It was never far. Only patient.', 'The structure learned your shape.'],
};

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------
function finiteOr(v, fallback) {
  return typeof v === 'number' && isFinite(v) ? v : fallback;
}

/** Milliseconds since the navigation started (boot timing: VRC.Quest.Performance.3 counts from the launch). */
function nowSinceNav() {
  return typeof performance !== 'undefined' ? Math.round(performance.now()) : 0;
}

/** Save stand-in until meta/save.js is loaded (or when it cannot load): Continue is simply not offered. */
function nullSaveStandIn() {
  return { isNull: true, ready: false, continueInfo: () => null, flush: () => Promise.resolve(false) };
}

function nowMs() {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function blankHand() {
  return { aim: null, pressed: false, held: false, released: false, yank: 0 };
}

/** The grip-climbing part of an intent (sim/climb3d.js): grab per hand, desktop climb axes + view axes, palm points. */
function blankClimb() {
  const hand = () => ({ ok: false, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 });
  return { vr: false, grab: { left: false, right: false }, fwd: 0, side: 0, rx: 1, rz: 0, fx: 0, fz: -1, hands: { left: hand(), right: hand() } };
}

/** An intent in the contract §2 shape with everything idle. */
export function blankIntent() {
  return {
    move: { x: 0, z: 0 },
    reel: 0,
    jumpPressed: false,
    brake: false,
    turnRate: 0,
    hands: { left: blankHand(), right: blankHand() },
    pausePressed: false,
    restartPressed: false,
    confirmPressed: false,
    backPressed: false,
    ui: { ray: null, click: false },
    bag: { slot: -1, use: false, cycle: 0, cancel: false, vr: null },
    climb: blankClimb(),
  };
}

const EDGE_KEYS = ['jumpPressed', 'pausePressed', 'restartPressed', 'confirmPressed', 'backPressed'];

/**
 * A view of the main bus for per-run objects (creature, tethers, physics):
 * emits go to the shared bus, but subscriptions made through it are
 * remembered so the whole scope detaches when the run objects are replaced.
 */
function scopedBus(bus) {
  const offs = [];
  const scope = Object.create(bus);
  scope.on = function (type, fn) {
    const off = bus.on(type, fn);
    offs.push(off);
    return off;
  };
  scope.clear = function () {
    scope.dispose();
  };
  scope.dispose = function () {
    for (let i = 0; i < offs.length; i++) offs[i]();
    offs.length = 0;
  };
  return scope;
}

/** `?skitter=off` disables the skitterlings (sim and views). */
function skitterOff() {
  try {
    return typeof location !== 'undefined' && /[?&]skitter=off/.test(location.search || '');
  } catch {
    return false;
  }
}

/** Copy of a difficulty preset whose creature never enters play (menu attract). */
function inactiveDiff(diff) {
  return Object.assign({}, diff, { creature: Object.assign({}, diff.creature, { enabled: false }) });
}

/** Yaw (rotation about +Y, three.js convention: 0 looks down −Z) of a quaternion's forward axis. */
const _fwd = new THREE.Vector3();
function yawOfQuaternion(q) {
  _fwd.set(0, 0, -1).applyQuaternion(q);
  if (Math.abs(_fwd.x) < 1e-6 && Math.abs(_fwd.z) < 1e-6) return 0;
  return Math.atan2(-_fwd.x, -_fwd.z);
}

// -----------------------------------------------------------------------------
// Null objects — stand-ins for optional subsystems that failed.
// -----------------------------------------------------------------------------
function nullAudio() {
  return { isNull: true, enabled: false, unlock() {}, setVolume() {}, setPaused() {}, update() {}, stopAll() {} };
}

function nullThreat() {
  return { isNull: true, value: 0, raw: 0, heartRate: 60, beat: 0, beatPulse: 0, reset() {}, update() {} };
}

function nullCreature() {
  const far = -1e6;
  return {
    isNull: true,
    state: 'DORMANT',
    stamina: 1,
    x: 0,
    y: far,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    distance: 1e9,
    active: false,
    lethal: false,
    caughtPlayer: false,
    sighting: null,
    nearMiss: 0,
    listening: false,
    audio: { x: 0, y: far, z: 0, distance: 1e9, intensity: 0, movement: 0, state: 'DORMANT' },
    body: null,
    reset() {},
    setSection() {},
    onRespawn() {},
    onVictory() {},
    update() {},
  };
}

function nullUI() {
  return {
    isNull: true,
    current: null,
    init() {},
    show(name) {
      this.current = name || null;
    },
    update() {},
  };
}

// =============================================================================
// FallbackRenderer3D — a deliberately plain three.js view used only when
// Renderer3D is missing or keeps failing, so the game stays playable. It
// implements the Renderer3D surface (contract §5) with a handful of draw
// calls: one InstancedMesh per object class, two rope lines, target markers,
// a creature stand-in and the death-fade sphere.
// =============================================================================
const FB_KIND_COLORS = {
  wall: 0x2a3034,
  stone: 0x3b4246,
  metal: 0x4a4440,
  bridge: 0x544a3e,
  crumble: 0x5a4632,
  grate: 0x3d4744,
  pillar: 0x343a3d,
};

export class FallbackRenderer3D {
  constructor(container, settings) {
    this.isFallback = true;
    this.settings = settings || {};
    this.container = container;
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer = renderer;
    renderer.setPixelRatio(maxPixelRatio());
    renderer.xr.enabled = true;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.domElement.className = 'game-canvas';
    container.appendChild(renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x07090a);
    this.scene.fog = new THREE.Fog(0x07090a, 5, 70);
    this.baseFov = 70; // desktop fov; resize() restores it after an XR session
    this.camera = new THREE.PerspectiveCamera(this.baseFov, 1, 0.05, 400);
    this.rig = new THREE.Group();
    this.rig.name = 'rig';
    this.rig.add(this.camera);
    this.scene.add(this.rig);

    this.hemi = new THREE.HemisphereLight(0x9fb4bd, 0x2a221a, 1.4);
    this.scene.add(this.hemi);
    this.lantern = new THREE.PointLight(0xffb066, 30, 30, 1.6);
    this.lantern.position.set(-0.25, 0.1, 0.1);
    this.camera.add(this.lantern);

    // Ropes: one segment per hand.
    const rg = new THREE.BufferGeometry();
    this._ropePos = new Float32Array(12);
    rg.setAttribute('position', new THREE.BufferAttribute(this._ropePos, 3));
    this.ropes = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xe8dcc0 }));
    this.ropes.frustumCulled = false;
    this.scene.add(this.ropes);

    // Target markers (left = cool torus, right = warm octahedron: shape + colour).
    this.targets = {
      left: new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.06, 6, 20), new THREE.MeshBasicMaterial({ color: 0x6fd0c0, fog: false })),
      right: new THREE.Mesh(new THREE.OctahedronGeometry(0.5), new THREE.MeshBasicMaterial({ color: 0xffb060, wireframe: true, fog: false })),
    };
    this.scene.add(this.targets.left, this.targets.right);

    this.creatureMesh = new THREE.Mesh(new THREE.SphereGeometry(1.6, 12, 8), new THREE.MeshStandardMaterial({ color: 0x1c1f20, emissive: 0x3a6b62, emissiveIntensity: 0.5 }));
    this.creatureMesh.visible = false;
    this.scene.add(this.creatureMesh);

    // Death / pause fade: a black sphere around the head (works in XR).
    this.fadeMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.3, 16, 12),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0, side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false }),
    );
    this.fadeMesh.renderOrder = 9999;
    this.fadeMesh.visible = false;
    this.camera.add(this.fadeMesh);

    this.levelGroup = null;
    this._solids = null;
    this._anchors = null;
    this._solidState = null;
    this._anchorState = null;
    this._m = new THREE.Matrix4();
    this._q = new THREE.Quaternion();
    this._s = new THREE.Vector3();
    this._p = new THREE.Vector3();
    this._fog = new THREE.Color();
    this._tmpColor = new THREE.Color();
    this._hand = { x: 0, y: 0, z: 0 };
    this._sectionIndex = -1;
    this.resize();
  }

  setLanternParent(obj) {
    if (!obj || this.lantern.parent === obj) return;
    obj.add(this.lantern);
  }

  buildLevel(level) {
    if (this.levelGroup) {
      this.scene.remove(this.levelGroup);
      this.levelGroup.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }
    const g = new THREE.Group();
    g.name = 'fallback-level';
    this.levelGroup = g;
    this.level = level;
    const solids = level.solids || [];
    const box = new THREE.BoxGeometry(1, 1, 1);
    const sm = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ roughness: 0.92, metalness: 0.05 }), Math.max(1, solids.length));
    sm.count = solids.length;
    for (let i = 0; i < solids.length; i++) {
      this._setBox(sm, i, solids[i], true);
      sm.setColorAt(i, this._tmpColor.set(FB_KIND_COLORS[solids[i].kind] || 0x3b4246));
    }
    if (sm.instanceColor) sm.instanceColor.needsUpdate = true;
    sm.frustumCulled = false;
    g.add(sm);
    this._solids = sm;
    this._solidState = new Uint8Array(solids.length).fill(1);

    const hz = level.hazards || [];
    if (hz.length) {
      const hm = new THREE.InstancedMesh(box, new THREE.MeshStandardMaterial({ color: 0x7a3b22, roughness: 0.6, metalness: 0.4 }), hz.length);
      for (let i = 0; i < hz.length; i++) this._setBox(hm, i, hz[i], true);
      hm.frustumCulled = false;
      g.add(hm);
    }

    const an = level.anchors || [];
    const am = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.28), new THREE.MeshBasicMaterial({ fog: false }), Math.max(1, an.length));
    am.count = an.length;
    for (let i = 0; i < an.length; i++) {
      const a = an[i];
      this._m.makeTranslation(a.x, a.y, a.z);
      am.setMatrixAt(i, this._m);
      am.setColorAt(i, this._tmpColor.set(a.kind === 'fragile' ? 0xc9a46a : a.kind === 'hook' ? 0xd8ccb0 : 0xe8dcc0));
    }
    if (am.instanceColor) am.instanceColor.needsUpdate = true;
    am.frustumCulled = false;
    g.add(am);
    this._anchors = am;
    this._anchorState = new Uint8Array(an.length).fill(1);
    this.scene.add(g);
    this._sectionIndex = -1;
  }

  _setBox(mesh, i, b, visible) {
    if (visible) {
      this._p.set((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, (b.minZ + b.maxZ) / 2);
      this._s.set(Math.max(0.01, b.maxX - b.minX), Math.max(0.01, b.maxY - b.minY), Math.max(0.01, b.maxZ - b.minZ));
    } else {
      this._p.set(0, -1e5, 0);
      this._s.set(0.001, 0.001, 0.001);
    }
    this._q.identity();
    this._m.compose(this._p, this._q, this._s);
    mesh.setMatrixAt(i, this._m);
  }

  update(dt, game) {
    const level = game.level;
    if (level && level !== this.level) this.buildLevel(level);
    if (!level) return;
    // Section fog.
    const si = game.sectionIndex | 0;
    if (si !== this._sectionIndex && level.sections[si]) {
      this._sectionIndex = si;
      const th = level.sections[si].theme || {};
      try {
        this._fog.set(th.fog || 0x101416);
      } catch {
        this._fog.set(0x101416);
      }
      this.scene.fog.color.copy(this._fog);
      this.scene.background.copy(this._fog).multiplyScalar(0.5);
      this.scene.fog.near = finiteOr(th.fogNear, 5);
      this.scene.fog.far = finiteOr(th.fogFar, 70);
    }
    // Crumbled ledges / broken anchors.
    const solids = level.solids;
    let dirty = false;
    for (let i = 0; i < solids.length && i < this._solidState.length; i++) {
      const on = solids[i].active !== false ? 1 : 0;
      if (on !== this._solidState[i]) {
        this._solidState[i] = on;
        this._setBox(this._solids, i, solids[i], on === 1);
        dirty = true;
      }
    }
    if (dirty) this._solids.instanceMatrix.needsUpdate = true;
    const an = level.anchors;
    dirty = false;
    for (let i = 0; i < an.length && i < this._anchorState.length; i++) {
      const on = an[i].broken ? 0 : 1;
      if (on !== this._anchorState[i]) {
        this._anchorState[i] = on;
        this._m.makeTranslation(an[i].x, on ? an[i].y : -1e5, an[i].z);
        this._anchors.setMatrixAt(i, this._m);
        dirty = true;
      }
    }
    if (dirty) this._anchors.instanceMatrix.needsUpdate = true;

    // Ropes + targets.
    const pos = this._ropePos;
    const tethers = game.tethers;
    const p = game.player;
    for (let k = 0; k < 2; k++) {
      const h = HANDS[k];
      const st = tethers ? tethers.hands[h] : null;
      const anchor = st ? st.rope.anchor : null;
      const o = k * 6;
      if (anchor && p && p.alive && !game.hidePlayer) {
        const hp = game.handOrigin(h, this._hand);
        pos[o] = hp.x;
        pos[o + 1] = hp.y;
        pos[o + 2] = hp.z;
        pos[o + 3] = anchor.x;
        pos[o + 4] = anchor.y;
        pos[o + 5] = anchor.z;
      } else {
        for (let j = 0; j < 6; j++) pos[o + j] = 0;
      }
      const tm = this.targets[h];
      const tgt = st && !anchor ? st.target : null;
      tm.visible = !!tgt && !game.hidePlayer;
      if (tgt) {
        tm.position.set(tgt.x, tgt.y, tgt.z);
        tm.rotation.y += dt * 2;
      }
    }
    this.ropes.geometry.attributes.position.needsUpdate = true;

    const c = game.creature;
    const show = !!(c && c.active && isFinite(c.x) && isFinite(c.y) && isFinite(c.z));
    this.creatureMesh.visible = show && !game.creatureView;
    if (show) this.creatureMesh.position.set(c.x, c.y, c.z);

    const fade = U.clamp(finiteOr(game.fade, 0) + finiteOr(game.flash, 0) * 0.25, 0, 1);
    this.fadeMesh.visible = fade > 0.003;
    this.fadeMesh.material.opacity = fade;
    this.lantern.intensity = 30 * (0.92 + 0.08 * Math.sin(finiteOr(game.realTime, 0) * 23.0));
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }

  resize() {
    const el = this.container;
    const w = Math.max(1, (el && el.clientWidth) || window.innerWidth || 800);
    const h = Math.max(1, (el && el.clientHeight) || window.innerHeight || 600);
    // An XR session leaves its own fov/zoom on the user camera (WebXRManager.updateUserCamera).
    this.camera.fov = this.baseFov;
    this.camera.zoom = 1;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (!this.renderer.xr.isPresenting) this.renderer.setSize(w, h, true);
  }
}

// =============================================================================
// FallbackInput — minimal desktop mouse + keyboard (contract §2 mapping) used
// only when InputManager fails. No XR controllers (enterVR is refused).
// =============================================================================
export class FallbackInput {
  constructor({ camera, rig, canvas, settings, game }) {
    this.isFallback = true;
    this.game = game || null;
    this.mode = 'desktop';
    this.xrActive = false;
    this.camera = camera;
    this.rig = rig;
    this.canvas = canvas;
    this.settings = settings || {};
    this.intent = blankIntent();
    this.keys = Object.create(null);
    this.mouse = { left: false, right: false };
    this._edges = { left: 0, right: 0, leftUp: 0, rightUp: 0 };
    this._keyEdges = Object.create(null);
    this._pitch = 0;
    this._uiMode = false;
    this._ray = { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: -1 };
    this._v = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._onKey = (e) => this._key(e, e.type === 'keydown');
    this._onMouseDown = (e) => this._button(e, true);
    this._onMouseUp = (e) => this._button(e, false);
    this._onMove = (e) => this._look(e);
    this._onContext = (e) => e.preventDefault();
    this._onBlur = () => this.releaseAll();
    window.addEventListener('keydown', this._onKey);
    window.addEventListener('keyup', this._onKey);
    window.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    window.addEventListener('mousemove', this._onMove);
    window.addEventListener('blur', this._onBlur);
    if (canvas) canvas.addEventListener('contextmenu', this._onContext);
  }

  _key(e, down) {
    const k = e.code;
    if (down && !this.keys[k]) this._keyEdges[k] = true;
    this.keys[k] = down;
    if (['Space', 'ArrowUp', 'ArrowDown'].indexOf(k) >= 0 && !this._uiMode) e.preventDefault();
  }

  _button(e, down) {
    if (this._uiMode) return;
    const hand = e.button === 0 ? 'right' : e.button === 2 ? 'left' : null;
    if (!hand) return;
    if (down && this.canvas && document.pointerLockElement !== this.canvas && this.canvas.requestPointerLock) {
      try {
        const r = this.canvas.requestPointerLock();
        if (r && typeof r.catch === 'function') r.catch(() => {});
      } catch {
        /* pointer lock unavailable */
      }
    }
    if (down && !this.mouse[hand]) this._edges[hand] = 1;
    if (!down && this.mouse[hand]) this._edges[hand + 'Up'] = 1;
    this.mouse[hand] = down;
  }

  _look(e) {
    if (!this.canvas || document.pointerLockElement !== this.canvas) return;
    const s = 0.0022 * U.clamp(finiteOr(this.settings.mouseSensitivity, 1), 0.3, 3);
    this.rig.rotation.y -= e.movementX * s;
    this._pitch = U.clamp(this._pitch - e.movementY * s, -1.45, 1.45);
    this.camera.rotation.x = this._pitch;
  }

  setLook(yaw, pitch) {
    if (isFinite(yaw)) this.rig.rotation.y = yaw;
    this._pitch = U.clamp(finiteOr(pitch, 0), -1.45, 1.45);
    this.camera.rotation.set(this._pitch, 0, 0);
  }

  setUIMode(on) {
    this._uiMode = !!on;
    if (on) this.releaseAll();
    if (on && document.pointerLockElement && document.exitPointerLock) document.exitPointerLock();
  }

  releaseAll() {
    if (this.mouse.left) this._edges.leftUp = 1;
    if (this.mouse.right) this._edges.rightUp = 1;
    this.mouse.left = false;
    this.mouse.right = false;
    for (const k of Object.keys(this.keys)) this.keys[k] = false;
  }

  update() {
    const it = this.intent;
    const K = this.keys;
    const yaw = this.rig.rotation.y;
    const f = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0);
    const r = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0);
    // Forward (−Z rotated by yaw) and right (+X rotated by yaw).
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    const rx = Math.cos(yaw);
    const rz = -Math.sin(yaw);
    let mx = fx * f + rx * r;
    let mz = fz * f + rz * r;
    const ml = Math.hypot(mx, mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }
    it.move.x = mx;
    it.move.z = mz;
    const g = this.game;
    const tethered = !!(g && g.player && g.player.tethered);
    it.reel = (K.Space && tethered ? 1 : 0) - (K.ShiftLeft || K.ShiftRight ? 1 : 0);
    it.jumpPressed = !!this._keyEdges.Space && !tethered;
    it.brake = !!K.KeyC;
    it.turnRate = 0;
    it.pausePressed = !!(this._keyEdges.Escape || this._keyEdges.KeyP);
    it.restartPressed = !!this._keyEdges.KeyR;
    it.confirmPressed = !!(this._keyEdges.Enter || this._keyEdges.NumpadEnter);
    it.backPressed = !!this._keyEdges.Backspace;
    // Aim ray from the camera centre (both hands).
    this.camera.updateMatrixWorld();
    this.camera.getWorldPosition(this._v);
    const ray = this._ray;
    ray.ox = this._v.x;
    ray.oy = this._v.y;
    ray.oz = this._v.z;
    this.camera.getWorldQuaternion(this._q);
    this._v.set(0, 0, -1).applyQuaternion(this._q);
    ray.dx = this._v.x;
    ray.dy = this._v.y;
    ray.dz = this._v.z;
    for (let k = 0; k < 2; k++) {
      const h = HANDS[k];
      const hi = it.hands[h];
      hi.aim = this._uiMode ? null : ray;
      hi.pressed = this._edges[h] === 1;
      hi.released = this._edges[h + 'Up'] === 1;
      hi.held = this.mouse[h];
      hi.yank = K.KeyF ? 1 : 0;
    }
    it.ui.ray = ray;
    it.ui.click = false;
    return it;
  }

  endFrame() {
    this._edges.left = 0;
    this._edges.right = 0;
    this._edges.leftUp = 0;
    this._edges.rightUp = 0;
    for (const k of Object.keys(this._keyEdges)) this._keyEdges[k] = false;
  }

  haptic() {}

  handPose(hand) {
    this.camera.updateMatrixWorld();
    this._v.set(hand === 'left' ? -0.22 : 0.22, -0.28, -0.35);
    this.camera.localToWorld(this._v);
    this.camera.getWorldQuaternion(this._q);
    return { x: this._v.x, y: this._v.y, z: this._v.z, qx: this._q.x, qy: this._q.y, qz: this._q.z, qw: this._q.w };
  }

  isVRSupported() {
    return Promise.resolve(false);
  }

  enterVR() {
    return Promise.reject(new Error('VR controller input is unavailable (input module failed to load).'));
  }

  exitVR() {}
}

// =============================================================================
// Stand-in creature view (when CreatureView or the kit fails): a dark spine of
// instanced blocks along creature.body.spine — one draw call.
// =============================================================================
class StandInCreatureView {
  constructor(scene) {
    this.isStandIn = true;
    this.max = 24;
    this.mesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.4, 1.1, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x2a2c2b, roughness: 0.9, emissive: 0x24463f, emissiveIntensity: 0.3 }),
      this.max,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._q = new THREE.Quaternion();
  }

  update(creature) {
    const b = creature && creature.active ? creature.body : null;
    const spine = b && b.spine;
    if (!spine || !spine.length) {
      this.mesh.count = 0;
      if (creature && creature.active && isFinite(creature.x)) {
        this._p.set(creature.x, creature.y, creature.z);
        this._s.set(2, 2, 2);
        this._m.compose(this._p, this._q.identity(), this._s);
        this.mesh.setMatrixAt(0, this._m);
        this.mesh.count = 1;
        this.mesh.instanceMatrix.needsUpdate = true;
      }
      return;
    }
    const n = Math.min(this.max, Math.floor(spine.length / 3));
    for (let i = 0; i < n; i++) {
      const k = 1 - (i / Math.max(1, n)) * 0.6;
      this._p.set(spine[i * 3], spine[i * 3 + 1], spine[i * 3 + 2]);
      this._s.set(k, k, k);
      this._m.compose(this._p, this._q.identity(), this._s);
      this.mesh.setMatrixAt(i, this._m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// =============================================================================
// Game3D
// =============================================================================
export class Game3D {
  /**
   * @param {object} [options]
   * @param {HTMLElement} [options.container] canvas container (default #stage or body)
   * @param {HTMLElement} [options.uiRoot]    DOM root for the UI module (default #ui-root)
   * @param {object} [options.modules]        test hook: {name: module namespace} overrides
   */
  constructor(options = {}) {
    this.options = options;
    // ---- public fields (contract §8) -------------------------------------------
    this.state = 'menu';
    this.difficultyKey = 'normal';
    this.diff = DIFFICULTY.normal;
    this.settings = null;
    this.bus = null;
    this.level = null;
    this.player = null;
    this.tethers = null;
    this.physics = null;
    this.creature = null;
    this.threat = null;
    this.renderer = null;
    this.input = null;
    this.ui = null;
    this.audio = null;
    this.time = 0;
    this.deaths = 0;
    this.sectionIndex = 0;
    this.deepest = 0; // lowest y reached this run (depth = U.depthMeters(deepest))
    this.flash = 0; // 0..1 brief light flash (big impacts, gate slam)
    this.fade = 0; // 0..1 black fade around the head (death, respawn, menu loop)

    // ---- extra read-only fields for other modules --------------------------------
    this.booted = false;
    this.realTime = 0;
    this.alpha = 0; // physics interpolation factor of the current frame
    this.intent = blankIntent(); // the intent used this frame (UI reads intent.ui)
    this.hidePlayer = true; // menu attract: no body, no hands
    this.xrActive = false;
    this.victoryT = -1;
    this.gateClosed = false;
    this.checkpoint = { x: 0, y: 0, z: 0, yaw: 0, index: -1 };
    this.deathCause = null;
    this.deathT = 0;
    this.creatureView = null;
    this.skitters = null; // WP-SKITTER: SkitterGroup (sim) + skitterViews (rig clones sharing the one GLB)
    this.skitterViews = [];
    this.handsView = null;
    this.healthFx = null; // low-health vignette + ECG texture (render/healthFx.js)
    this.bodyView = null; // the player's own skinned body (render/bodyView.js; async GLB, optional)
    this.bag = null; // the player's bag (sim/inventory3d.js): counts, selected, applying {kind,t,dur}, adrenaline, lanternCharge
    this.pickups = null; // supplies lying in the level (sim/pickups3d.js)
    this.bagFx = null; // icon strip texture for the wrist / HUD + the VR radial (render/bagFx.js)
    this.pickupsView = null; // glowing item props (render/pickupsView.js)
    this.climbView = null; // studs on the climbable surfaces (render/climbView.js)
    this.sceneDetail = null; // seeded render-only scene dressing: bones, rubble, chains, puddles, decals (render/sceneDetail.js)
    this.lastDeath = null; // info handed to the death panel
    this.lastVictory = null; // info handed to the victory panel
    this.textures = null; // resolved texture manifest handed to renderer.buildLevel
    this.kit = null; // parsed mason_kit.glb
    this.container = null;
    this.uiRoot = null;
    this.fps = 72;
    this.perf = { calls: 0, triangles: 0, frameMs: 0, geometries: 0, textures: 0 };
    this.faults = Object.create(null);
    this.modules = Object.create(null); // loaded module namespaces (null when missing)

    // ---- private --------------------------------------------------------------
    this._acc = 0;
    this._pendingJump = false;
    this._lastTs = null;
    this._frameAvg = 1 / 72;
    this._loopFn = (time, frame) => this._loop(time, frame);
    this._running = false;
    this._runBus = null;
    this._runClock = 0;
    this._runCount = 0;
    this._levelVariant = null;
    this._levelBuiltFor = null;
    this._viewReady = false;
    this._ownsHandsView = false;
    this._creatureSection = -1;
    this._seen = [];
    this._hintList = [];
    this._triggerList = [];
    this._hintCursor = 0;
    this._triggerCursor = 0;
    this._hintQueue = [];
    this._hintCooldown = 0;
    this._lastHint = null;
    this._lastHintUntil = 0;
    this._deathShown = false;
    this._attract = { y: 0, t: 0, fading: 0, top: 0, bottom: -100 };
    this._attractPath = null;
    this._endState = null;
    this._endUi = undefined;
    this._consumed = false;
    this._frameErrors = 0;
    this._renderFaults = 0;
    this._godMode = false;
    this._frozen = false;
    this._override = null;
    this._ovIntent = blankIntent();
    this._blank = blankIntent();
    this._stepIntent = { move: { x: 0, z: 0 }, reel: 0, jumpPressed: false, brake: false, hands: { left: { yank: 0 }, right: { yank: 0 } }, climb: blankClimb() };
    this._threatCtx = { player: null, creature: null, tethers: null, diff: null, level: null };
    this._uiFallback = false;
    this._uiMode = null;
    this._hapticT = 0;
    this._bagHapticT = 0;
    this._lantern0 = null; // { renderer, base, range }: the lantern as the renderer made it (WP-BAG dims it with the charge)
    this._handA = { x: 0, y: 0, z: 0, grip: 0, ok: false };
    this._handB = { x: 0, y: 0, z: 0, grip: 0, ok: false };
    this._headLocal = { x: 0, z: 0 }; // XR: head offset in the rig (cancelled at recentre)
    this._recentre = { pending: false, yaw: NaN, frames: 0 };
    this._xrFrames = 0;
    this._xrStartAt = -1e9;
    this._xrSession = null;
    this._hadPointerLock = false;
    this._handTmp = { x: 0, y: 0, z: 0 };
    this._rigTmp = { x: 0, y: 0, z: 0 };
    this._headScratch = [];
    this._headBlock = 0; // 0..1 head-in-geometry darkening (XR)
    this._fadeBase = 0; // this.fade before the head darkening was mixed in (last frame)
    this._fadeOut = -1; // this.fade as _updateFeedback left it (last frame)
    this._dbgAim = { left: { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: -1 }, right: { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: -1 } };
    this._onXRVisibility = () => this._xrVisibilityChanged();

    // ---- WP-RELEASE: boot phases, platform services --------------------------------------------------------------
    this.contentReady = false; // bootContent finished (menu is up)
    this.contextLost = false; // WebGL context currently lost (platform/resilience.js)
    this.save = null; // meta/save.js SaveService (null object when unavailable)
    this.entitlement = null; // platform/entitlement.js (dormant: Chapter I is always playable)
    this.governor = null; // platform/governor.js (XR frame-time governor)
    this.resilience = null; // platform/resilience.js
    this.loading = null; // platform/loadingScene.js while content loads
    this.bootTimes = {}; // ms since navigationStart: minimal, firstFrame, xrStart, firstXRFrame, content
    this._minimal = null;
    this._contentPromise = null;
    this._saveReady = null;
    this._continuing = null;
  }

  // ===========================================================================
  // Boot
  // ===========================================================================

  /**
   * Loads modules, creates every subsystem, the menu attract scene and starts
   * the animation loop. Rejects only if the core (level / WebGL) cannot start.
   * Two phases (RELEASE T1, VRC.Quest.Performance.3): bootMinimal() puts head-tracked frames on screen, bootContent()
   * loads the heavy content behind the loading scene. main.js runs them separately so an immersive launch can
   * enter VR in between; boot() runs both for callers that do not care.
   */
  async boot() {
    if (this.booted) return this;
    await this.bootMinimal();
    return this.bootContent();
  }

  /** Phase 1: renderer + input + XR hooks + loading scene + animation loop. Resolves once frames can be shown. */
  bootMinimal() {
    if (!this._minimal) this._minimal = this._bootMinimal();
    return this._minimal;
  }

  async _bootMinimal() {
    this.settings = Storage.loadSettings();
    this.bus = new EventBus();
    this.container = this.options.container || document.getElementById('stage') || document.body;
    this.uiRoot = this.options.uiRoot || document.getElementById('ui-root') || null;
    this.ui = nullUI(); // placeholder: XR hooks and the loop may run before the real UI exists
    this.save = nullSaveStandIn();

    await this._loadModules(EARLY_MODULES);
    const M = this.modules;

    // Renderer (fallback: a plain three.js view).
    this.renderer = this._optional(
      'renderer',
      () => new M.renderer.Renderer3D(this.container, this.settings),
      () => new FallbackRenderer3D(this.container, this.settings),
      !!(M.renderer && M.renderer.Renderer3D),
    );
    this._setupXRHooks();

    // Input (fallback: minimal desktop mouse + keyboard).
    const canvas = this.renderer.renderer.domElement;
    const inputOpts = { renderer: this.renderer.renderer, camera: this.renderer.camera, rig: this.renderer.rig, canvas, settings: this.settings, bus: this.bus, game: this };
    this.input = this._optional('input', () => new M.input.InputManager(inputOpts), () => new FallbackInput(inputOpts), !!(M.input && M.input.InputManager));
    this._wireBus();

    // Platform services (all optional).
    this.loading = this._optionalOrNull('loadingScene', () => new M.loadingScene.LoadingScene(THREE, this.renderer), !!(M.loadingScene && M.loadingScene.LoadingScene) && !this.renderer.isFallback);
    this.resilience = this._optionalOrNull('resilience', () => new M.resilience.Resilience(this, { immersiveApp: !!this.options.immersiveApp }).install(), !!(M.resilience && M.resilience.Resilience));
    this.governor = this._optionalOrNull(
      'governor',
      () => {
        const q = typeof window !== 'undefined' && window.location ? M.governor.QualityGovernor.modeFromSearch(window.location.search) : { mode: 'auto', level: 0 };
        return new M.governor.QualityGovernor(this, q);
      },
      !!(M.governor && M.governor.QualityGovernor),
    );
    this._saveReady = this._startSave(); // IndexedDB open + migration run beside the module downloads; never rejects

    this._startLoop(); // the loop renders the loading scene until bootContent finishes
    this.bootTimes.minimal = nowSinceNav();
    this.bus.emit('game:boot-minimal', {});
    return this;
  }

  /** Phase 2: level, view, creature kit, audio, UI, menu. Safe to call while an XR session is already running. */
  bootContent() {
    if (this.booted) return Promise.resolve(this);
    if (!this._contentPromise) this._contentPromise = this.bootMinimal().then(() => this._bootContent());
    return this._contentPromise;
  }

  async _bootContent() {
    const progress = async (p, label) => {
      if (this.loading) this.loading.setProgress(p, label);
      await yieldToFrames();
    };
    await this._loadModules(LATE_MODULES);
    const M = this.modules;
    if (!M.level || typeof M.level.Level3D !== 'function') {
      throw new Error('The level module (src/sim/level3d.js or src/data/level-data-3d.js) could not be loaded.');
    }
    await progress(0.25, 'Lowering the lantern');

    this.audio = this._optional('audio', () => new M.audio.AudioManager3D(this.bus, this.settings), nullAudio, !!(M.audio && M.audio.AudioManager3D));
    this.threat = this._optional('threat', () => new M.threat.ThreatSystem3D(this.bus), nullThreat, !!(M.threat && M.threat.ThreatSystem3D));
    await this._saveReadyBounded(); // restored settings (if localStorage was wiped) are in before the UI reads them
    await progress(0.4, 'Lowering the lantern');

    this._enterAttract(); // level / player / tethers / creature exist before the UI looks at them
    await progress(0.55, 'Reading the walls');

    // Texture manifest for the level view (bounded wait), then build it.
    this.textures = await this._loadTextureManifest();
    this._viewReady = true;
    await progress(0.7, 'Reading the walls');
    this._ensureLevelView();
    await progress(0.82, 'Lighting the lamps');

    this._setupHandsView();
    this._setupHealthFx();
    this._setupBodyView();
    this._setupBagViews();
    this._loadCreatureKit(); // async; the creature view attaches when the GLB arrives

    // UI last: it may read any game field during init.
    try {
      if (!M.ui || typeof M.ui.UI3D !== 'function') throw new Error('UI module unavailable');
      this.ui = new M.ui.UI3D(this);
      this.ui.init();
    } catch (err) {
      this._fault('ui', err);
      this.ui = nullUI();
    }
    this._uiFallback = !!this.ui.isNull;
    await progress(0.92, 'Almost there');
    // Every mesh that exists now (level, hands, UI panels, fade sphere): compile its
    // shader programs before the first frame so nothing hitches on first use.
    if (this.loading) {
      this.loading.dispose();
      this.loading = null;
    }
    this._precompile();

    this._startEntitlement();
    this._bindWindow();
    this._setState('menu', true);
    this._try('audio', () => this.audio.setVolume(this.settings.volume));
    this._try('audio', () => this.audio.setPaused(true));
    this._try('ui', () => this.ui.show('menu'));
    this.booted = true;
    this.contentReady = true;
    this.bootTimes.content = nowSinceNav();
    if (this.xrActive) this._resyncXRBindings(); // the session started while the content was loading
    this._startLoop();
    this.bus.emit('game:boot', {});
    return this;
  }

  /** Content that was created after the XR session started: do what _onXRStart does for it. */
  _resyncXRBindings() {
    const hv = this.handsView;
    const input = this.input;
    if (!(hv && hv.manageLantern)) {
      const socket = (hv && hv.lanternSocket) || (input && typeof input.handSocket === 'function' ? input.handSocket('left') : null) || (input && input.lanternSocket) || null;
      if (socket) this._try('renderer', () => this.renderer.setLanternParent && this.renderer.setLanternParent(socket));
    }
    this._uiMode = null;
    this._syncUIMode();
    this._unlockAudio();
  }

  _optionalOrNull(name, factory, available) {
    if (!available) return null;
    try {
      return factory() || null;
    } catch (err) {
      this._fault(name, err);
      return null;
    }
  }

  /** Save service: loads the profile, migrates today's keys, follows the bus. Never rejects. */
  async _startSave() {
    const M = this.modules;
    if (!M.save || typeof M.save.SaveService !== 'function') return null;
    try {
      const svc = new M.save.SaveService(this);
      await svc.init();
      this.save = svc;
      // localStorage wiped but the profile survived (IndexedDB): bring the settings back
      const saved = svc.savedSettings();
      if (saved && Storage.get('settings', null) == null) {
        for (const k of Object.keys(SETTINGS_DEFAULTS)) if (k in saved && typeof saved[k] === typeof SETTINGS_DEFAULTS[k]) this.settings[k] = saved[k];
        if (!DIFFICULTY[this.settings.lastDifficulty]) this.settings.lastDifficulty = 'normal';
        sanitizeHeightSettings(this.settings);
        sanitizeUxSettings(this.settings);
      } else if (!saved) svc.store.recordSettings(this.settings);
      return svc;
    } catch (err) {
      this._fault('save', err);
      return null;
    }
  }

  _saveReadyBounded() {
    if (!this._saveReady) return Promise.resolve(null);
    return Promise.race([this._saveReady, new Promise((resolve) => setTimeout(() => resolve(null), SAVE_WAIT_MS))]);
  }

  /** Entitlement (E06): dormant; reports the state, answers the chapter gate, never blocks anything. */
  _startEntitlement() {
    const M = this.modules;
    if (!M.entitlement || typeof M.entitlement.Entitlement !== 'function') return;
    try {
      this.entitlement = M.entitlement.Entitlement.fromUrl({ bus: this.bus });
      this.entitlement.init().catch((err) => this._fault('entitlement', err));
    } catch (err) {
      this._fault('entitlement', err);
    }
  }

  /** Chapter gate (E06). Chapter I is always playable. */
  isChapterPlayable(n) {
    return this.entitlement ? this.entitlement.isChapterPlayable(n) : Number(n) === 1;
  }

  /** The frame while content is still loading: loading scene only, no simulation. */
  _loadingFrame(dt, frame) {
    void frame;
    try {
      const r = this.renderer;
      const presenting = !!(r.renderer.xr && r.renderer.xr.isPresenting);
      if (presenting && !this.bootTimes.firstXRFrame) {
        this.bootTimes.firstXRFrame = nowSinceNav();
        this.bus.emit('game:first-xr-frame', { ms: this.bootTimes.firstXRFrame });
      } else if (!this.bootTimes.firstFrame) this.bootTimes.firstFrame = nowSinceNav();
      if (this.loading) this.loading.update(dt, presenting);
      r.render();
      this._frameErrors = 0;
    } catch (err) {
      this._frameErrors++;
      this._fault('loading', err);
      if (this._frameErrors >= FATAL_FRAME_ERRORS) {
        this._stopLoop();
        showFatal(err);
      }
    }
  }

  async _loadModules(only) {
    const overrides = this.options.modules || {};
    const names = (only || Object.keys(MODULES)).filter((n) => !(n in this.modules));
    const results = await Promise.all(
      names.map((name) => {
        if (name in overrides) return Promise.resolve(overrides[name]);
        return import(MODULES[name]).catch((err) => {
          this._fault(name, err);
          return null;
        });
      }),
    );
    for (let i = 0; i < names.length; i++) this.modules[names[i]] = results[i] || null;
  }

  /** Constructs an optional subsystem; on failure logs and returns the stand-in. */
  _optional(name, factory, fallback, available) {
    if (available) {
      try {
        const obj = factory();
        if (!obj) throw new Error(`${name} factory returned nothing`);
        return obj;
      } catch (err) {
        this._fault(name, err);
      }
    }
    const fb = fallback();
    if (fb) fb.isStandIn = true;
    return fb;
  }

  _loadTextureManifest() {
    const fetchIt = fetch(TEXTURE_MANIFEST_URL, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : null))
      .then((json) => (json && typeof json === 'object' ? this._resolveManifest(json) : null))
      .catch(() => null);
    const timeout = new Promise((resolve) => setTimeout(() => resolve(null), BOOT_ASSET_TIMEOUT));
    return Promise.race([fetchIt, timeout]);
  }

  /** Manifest with every file entry resolved to an absolute URL (relative to the manifest). */
  _resolveManifest(json) {
    const out = { url: TEXTURE_MANIFEST_URL, base: new URL('./', TEXTURE_MANIFEST_URL).href, sets: Object.create(null), raw: json };
    for (const key of Object.keys(json)) {
      const set = json[key];
      if (!set || typeof set !== 'object' || Array.isArray(set)) continue;
      const r = {};
      for (const k of Object.keys(set)) {
        const v = set[k];
        r[k] = typeof v === 'string' && /\.(jpe?g|png|webp|ktx2|basis)$/i.test(v) ? new URL(v, TEXTURE_MANIFEST_URL).href : v;
      }
      out.sets[key] = r;
    }
    return out;
  }

  _ensureLevelView() {
    if (!this._viewReady || !this.renderer || !this.level || this._levelBuiltFor === this.level) return;
    this._levelBuiltFor = this.level;
    try {
      this.renderer.buildLevel(this.level, this.textures);
    } catch (err) {
      this._fault('renderer', err);
    }
  }

  _setupHandsView() {
    const input = this.input;
    if (input && input.handsView) {
      this.handsView = input.handsView;
      return;
    }
    const M = this.modules;
    if (!M.handsView || typeof M.handsView.HandsView !== 'function' || (input && input.isStandIn)) return;
    try {
      this.handsView = new M.handsView.HandsView(this.renderer, input);
      this._ownsHandsView = true;
    } catch (err) {
      this._fault('handsView', err);
      this.handsView = null;
    }
  }

  /** The low-health vignette (a camera child) and the ECG texture; optional (a failure leaves the game without them). */
  _setupHealthFx() {
    const M = this.modules;
    if (this.healthFx || !M.healthFx || typeof M.healthFx.HealthFx !== 'function' || !this.renderer) return;
    try {
      this.healthFx = new M.healthFx.HealthFx(this);
    } catch (err) {
      this._fault('healthFx', err);
      this.healthFx = null;
    }
  }

  /** The bag's icon strip + VR radial and the pickup props; optional (a failure leaves the game without them). */
  _setupBagViews() {
    const M = this.modules;
    if (!this.renderer) return;
    if (!this.bagFx && M.bagFx && typeof M.bagFx.BagFx === 'function') {
      try {
        this.bagFx = new M.bagFx.BagFx(this);
      } catch (err) {
        this._fault('bagFx', err);
        this.bagFx = null;
      }
    }
    if (!this.climbView && M.climbView && typeof M.climbView.ClimbView === 'function') {
      try {
        this.climbView = new M.climbView.ClimbView(this);
      } catch (err) {
        this._fault('climbView', err);
        this.climbView = null;
      }
    }
    if (!this.sceneDetail && M.sceneDetail && typeof M.sceneDetail.SceneDetail === 'function') {
      try {
        this.sceneDetail = new M.sceneDetail.SceneDetail(this);
      } catch (err) {
        this._fault('sceneDetail', err);
        this.sceneDetail = null;
      }
    }
    if (!this.pickupsView && M.pickupsView && typeof M.pickupsView.PickupsView === 'function') {
      try {
        this.pickupsView = new M.pickupsView.PickupsView(this);
      } catch (err) {
        this._fault('pickupsView', err);
        this.pickupsView = null;
      }
    }
  }

  /** The player's body (jacket, harness, legs, boots; no head). Async GLB; a failure leaves the game without a body. */
  _setupBodyView() {
    const M = this.modules;
    if (this.bodyView || !M.bodyView || typeof M.bodyView.BodyView !== 'function' || !this.renderer) return;
    try {
      this.bodyView = new M.bodyView.BodyView(this);
    } catch (err) {
      this._fault('bodyView', err);
      this.bodyView = null;
    }
  }

  _loadCreatureKit() {
    const M = this.modules;
    const hasView = M.creatureView && typeof M.creatureView.CreatureView === 'function';
    const standIn = () => {
      if (this.creatureView) return;
      try {
        this.creatureView = new StandInCreatureView(this.renderer.scene);
      } catch (err) {
        this._fault('creatureView', err);
      }
    };
    if (!hasView || !M.gltf || typeof M.gltf.GLTFLoader !== 'function') {
      standIn();
      return;
    }
    try {
      const loader = new M.gltf.GLTFLoader();
      if (M.glbLoad && typeof M.glbLoad.attachKTX2 === 'function') M.glbLoad.attachKTX2(loader); // KTX2 textures of the GLB
      loader.load(
        KIT_URL,
        (gltf) => {
          this.kit = gltf;
          try {
            const View = M.creatureView.CreatureView;
            const cv = new View(this.renderer.scene, gltf);
            this.creatureView = cv;
            this._precompile(); // the creature's programs, while still on the menu
            this.bus.emit('assets:kit', { ok: true });
            this._loadMasonRig(cv); // async: the rigged Mason replaces the kit view when it arrives (the kit view stays as the fallback)
            // Masonry / metal / flesh detail for the creature: the level's own texture
            // sets (same manifest key as buildLevel → the renderer's cached load), so
            // nothing is decoded or uploaded twice. Optional; degrades gracefully.
            const r = this.renderer;
            if (typeof cv.setTextures === 'function' && r && typeof r.applyTextures === 'function') {
              Promise.resolve(r.applyTextures(this.textures))
                .then(() => {
                  const sets = r.materials && r.materials.sets;
                  if (sets && this.creatureView === cv) {
                    cv.setTextures(sets);
                    this._precompile(); // textured variants of its materials
                  }
                })
                .catch((err) => this._fault('creatureTextures', err));
            }
          } catch (err) {
            this._fault('creatureView', err);
            standIn();
          }
        },
        undefined,
        (err) => {
          this._fault('creatureKit', err);
          standIn();
        },
      );
    } catch (err) {
      this._fault('creatureKit', err);
      standIn();
    }
  }

  /**
   * WP-CREATURE-RIG: loads the rigged, skinned Mason (mason_rig.glb) and swaps it in for the kit view. Any failure (module, asset,
   * construction, a later update fault) leaves / returns the creature to the kit CreatureView. `?mason=kit` keeps the kit view.
   */
  _loadMasonRig(kitView) {
    const M = this.modules;
    if (!M.masonRigView || typeof M.masonRigView.MasonRigView !== 'function' || !M.gltf || typeof M.gltf.GLTFLoader !== 'function') return;
    try {
      if (typeof location !== 'undefined' && /[?&]mason=kit/.test(location.search || '')) return;
    } catch {
      /* no location */
    }
    try {
      const loader = new M.gltf.GLTFLoader();
      if (M.glbLoad && typeof M.glbLoad.attachKTX2 === 'function') M.glbLoad.attachKTX2(loader); // KTX2 textures of the GLB
      loader.load(
        RIG_URL,
        (gltf) => {
          if (this.creatureView !== kitView) return;
          try {
            const rig = new M.masonRigView.MasonRigView(this.renderer.scene, gltf);
            rig.bindBus(this.bus);
            const dust = this.renderer && this.renderer.fx && this.renderer.fx.creatureDust;
            rig.bindDust(dust);
            this._kitView = kitView;
            if (kitView.root && kitView.root.parent) kitView.root.parent.remove(kitView.root); // its textures are never uploaded while it is out of the scene
            this.creatureView = rig;
            this._precompile(); // both LOD programs + atlases, on the menu
            this.bus.emit('assets:rig', { ok: true });
            this._loadSkitterRig(loader, rig, dust);
          } catch (err) {
            this._fault('masonRigView', err);
          }
        },
        undefined,
        (err) => this._fault('masonRigAsset', err),
      );
    } catch (err) {
      this._fault('masonRigAsset', err);
    }
  }

  /**
   * The small hunters keep the original Mason model (skitter_rig.glb): loaded in the background once the big one is in. A failure
   * leaves the sim running without their views (nothing to see, the kill radius still applies).
   */
  _loadSkitterRig(loader, rig, dust) {
    if (skitterOff()) return;
    try {
      loader.load(
        SKITTER_RIG_URL,
        (gltf) => {
          if (this.creatureView !== rig) return;
          try {
            const clones = this._cloneSkitterScenes(gltf); // before any view takes the meshes out of the glTF scene
            this.skitterViews = this._buildSkitterViews(gltf, clones);
            for (const v of this.skitterViews) v.bindDust(dust);
            this._precompile();
            this.bus.emit('assets:skitterRig', { ok: true });
          } catch (err) {
            this._fault('skitterView', err);
          }
        },
        undefined,
        (err) => this._fault('skitterAsset', err),
      );
    } catch (err) {
      this._fault('skitterAsset', err);
    }
  }

  /**
   * WP-SKITTER: one rig view per skitterling slot, cloned from the loaded skitter_rig.glb (geometry, textures and clips are shared
   * between the clones; each clone has its own skeleton, mixer and a red 'skitter' material set). `?skitter=off` skips them.
   */
  _cloneSkitterScenes(gltf) {
    const M = this.modules;
    if (skitterOff() || !M.masonRigView || typeof M.masonRigView.cloneSkitterScenes !== 'function') return [];
    try {
      return M.masonRigView.cloneSkitterScenes(gltf, 3); // one per skitterling slot (SKITTER.maxAlive: two from the data, one from below)
    } catch (err) {
      this._fault('skitterView', err);
      return [];
    }
  }

  _buildSkitterViews(gltf, clones) {
    if (!clones || !clones.length) return [];
    try {
      return this.modules.masonRigView.makeSkitterViews(this.renderer.scene, gltf, clones);
    } catch (err) {
      this._fault('skitterView', err);
      return [];
    }
  }

  /** The rigged view failed at run time: back to the kit CreatureView. */
  _fallbackToKit(rig) {
    const kit = this._kitView;
    if (this.creatureView !== rig) return;
    try {
      rig.dispose();
    } catch {
      /* already broken */
    }
    this._kitView = null;
    if (kit) {
      if (kit.root && !kit.root.parent && this.renderer && this.renderer.scene) this.renderer.scene.add(kit.root);
      this.creatureView = kit;
    } else this.creatureView = null;
  }

  /** Compiles every shader program the scene can need (Renderer3D.precompile; rare calls only). */
  _precompile() {
    const r = this.renderer;
    if (!r || typeof r.precompile !== 'function') return;
    this._try('renderer', () => r.precompile());
  }

  _bindWindow() {
    window.addEventListener('resize', () => this._resize());
    document.addEventListener('visibilitychange', () => this._onVisibility());
    window.addEventListener('blur', () => {
      if (this.state !== 'playing') return;
      if (this.xrActive || this.realTime - this._xrStartAt < XR_BLUR_GRACE) return; // Quest juggles focus around XR
      this.pause();
    });
    window.addEventListener('pagehide', () => {
      if (this.state === 'playing') this.pause();
    });
    document.addEventListener('pointerlockchange', () => {
      const locked = !!document.pointerLockElement;
      if (!this.input || !this.input.isFallback) return; // InputManager reports lock loss as a pause press
      if (locked) this._hadPointerLock = true;
      else if (this._hadPointerLock && this.state === 'playing' && !this.xrActive) {
        // Esc in pointer lock is swallowed by the browser: losing the lock mid-run pauses.
        this._hadPointerLock = false;
        this.pause();
      }
    });
    const unlock = () => this._unlockAudio();
    const opts = { capture: true, passive: true };
    window.addEventListener('pointerdown', unlock, opts);
    window.addEventListener('keydown', unlock, opts);
    window.addEventListener('touchend', unlock, opts);
  }

  _onVisibility() {
    if (document.hidden) {
      if (this.state === 'playing') this.pause();
      this._try('audio', () => this.audio.setPaused(true));
    } else {
      this._lastTs = null; // no giant dt after returning
      const quiet = this.state === 'paused' || this.state === 'menu';
      this._try('audio', () => this.audio.setPaused(quiet));
      this._resize();
    }
  }

  _unlockAudio() {
    if (!this.audio) return;
    try {
      this.audio.unlock();
    } catch (err) {
      this._fault('audio', err);
    }
  }

  _resize() {
    if (!this.renderer || this.xrActive) return;
    try {
      this.renderer.resize();
    } catch (err) {
      this._fault('renderer', err);
    }
  }

  _wireBus() {
    const bus = this.bus;
    bus.on('player:death', (e) => this._onPlayerDeath(e));
    // The shot is a projectile: a sharp kick when it leaves the nozzle (a whiff is lighter), a thunk when the hook bites.
    bus.on('rope:fire', (e) => {
      if (this._inRun()) this._haptic(e.hand, e.target ? 0.5 : 0.25, e.target ? 32 : 20);
    });
    bus.on('grapple:attach', (e) => {
      if (this._inRun()) this._haptic(e.hand, 0.45, 40);
    });
    bus.on('grapple:miss', (e) => {
      if (this._inRun()) this._haptic(e.hand, e.fell ? 0.2 : 0.12, 25);
    });
    bus.on('grapple:break', (e) => {
      if (!this._inRun()) return;
      this._haptic(e.hand, 0.9, 140);
      this.flash = Math.max(this.flash, 0.12);
    });
    bus.on('rope:jolt', (e) => {
      if (!this._inRun()) return;
      const k = U.clamp((finiteOr(e.speed, 0) - C.rope.joltFxSpeed) / 20, 0, 1);
      this._hapticTethered(0.35 + 0.5 * k, 60);
    });
    // The clutch paying line out: the first bite of a slip (the continuous buzz is in _updateHaptics, same curve as the audio).
    bus.on('rope:slip', (e) => {
      if (this._inRun()) this._haptic(e.hand, ropeHaptic(finiteOr(e.speed, 1), finiteOr(e.load, 2), this.time), 90);
    });
    bus.on('player:land', (e) => {
      if (!this._inRun()) return;
      const r = U.clamp(finiteOr(e.lethalRatio, 0.5), 0, 1);
      if (e.hard) {
        this._hapticBoth(0.5 + 0.5 * r, 90);
        this.flash = Math.max(this.flash, 0.1 * r);
      } else if (r > 0.25) this._hapticBoth(0.15 + 0.3 * r, 40);
    });
    bus.on('player:wallhit', (e) => {
      if (this._inRun()) this._hapticBoth(U.clamp(finiteOr(e.impact, 4) / 20, 0.15, 0.6), 50);
    });
    bus.on('platform:crumble', (e) => {
      if (!this._inRun() || !this.player) return;
      const d = Math.hypot(finiteOr(e.x, 1e9) - this.player.x, finiteOr(e.y, 1e9) - this.player.y, finiteOr(e.z, 1e9) - this.player.z);
      if (d < 8) this._hapticBoth(0.4, 120);
    });
    bus.on('creature:attack', (e) => {
      if (!this._inRun() && this.state !== 'victory') return;
      if (this.victoryT >= 0 || (e && e.gate)) {
        // Gate slam: the whole chamber rings (no camera shake: haptics + flash).
        this._hapticBoth(1, 320);
        this.flash = Math.max(this.flash, 0.55);
        return;
      }
      if (this._creatureNear(e, CREATURE_HAPTIC_RANGE)) this._hapticBoth(e && e.skit ? 0.4 : 0.7, e && e.skit ? 90 : 150);
    });
    bus.on('creature:strike', (e) => {
      if (!this._inRun() || (e && e.hit) || !this._creatureNear(e, 7)) return;
      // A near miss: the strike lands beside you — felt in both hands and a pale flash.
      this._hapticBoth(0.85, 140);
      this.flash = Math.max(this.flash, 0.18);
    });
    bus.on('creature:burst', (e) => {
      if (this._inRun() && this._creatureNear(e, e && e.skit ? 14 : CREATURE_HAPTIC_RANGE)) this._hapticBoth(e && e.skit ? 0.2 : 0.35, 60);
    });
    bus.on('trigger:rumble', (e) => {
      if (!this._inRun()) return;
      const d = (e && e.data) || {};
      const k = U.clamp(finiteOr(d.intensity, 0.6), 0, 1.5);
      this._hapticBoth(0.25 + 0.4 * Math.min(1, k), Math.round(U.clamp(finiteOr(d.duration, 0.6), 0.1, 1.5) * 1000));
      this.flash = Math.max(this.flash, 0.05 * k);
    });
    bus.on('health:damage', (e) => {
      if (!this._inRun()) return;
      const k = U.clamp(finiteOr(e.amount, 0.1) * 2.2, 0, 1);
      this._hapticBoth(0.3 + 0.7 * k, Math.round(70 + 260 * k));
    });
    // Grip climbing (sim/climb3d.js): a click as a hand takes a hold, a scrape of grit while moving over stone, a hard
    // shudder as the strength runs out, the hands slipping.
    bus.on('climb:grab', (e) => {
      if (this._inRun()) this._haptic(e.hand, 0.5, 35);
    });
    bus.on('climb:release', (e) => {
      if (!this._inRun() || !e) return;
      if (e.reason === 'slip') this._hapticBoth(0.9, 240);
      else if (e.reason !== 'death' && e.reason !== 'reset') this._haptic(e.hand, 0.16, 25);
    });
    bus.on('climb:scrape', (e) => {
      if (this._inRun()) this._haptic(e.hand, U.clamp(0.08 + 0.1 * finiteOr(e.speed, 1), 0.08, 0.3), 45);
    });
    bus.on('climb:strain', (e) => {
      if (!this._inRun()) return;
      const k = U.clamp(finiteOr(e.level, 0.3), 0, 1);
      const cl = this.climb;
      for (let i = 0; i < 2; i++) if (!cl || cl.hands[HANDS[i]].gripping) this._haptic(HANDS[i], 0.22 + 0.55 * k, 90);
    });
    bus.on('climb:slip', () => {
      if (this._inRun()) this.flash = Math.max(this.flash, 0.14);
    });
    bus.on('climb:hop', () => {
      if (this._inRun()) this._hapticBoth(0.35, 50);
    });
    bus.on('climb:mantle', () => {
      if (this._inRun()) this._hapticBoth(0.3, 60);
    });
    bus.on('pickup:collect', (e) => {
      if (!this._inRun()) return;
      this._hapticBoth(e && e.hand ? 0.5 : 0.3, 45);
      this._toast(`${ITEM_NAMES[e.kind] || 'Supplies'} taken`, 1.6);
    });
    bus.on('pickup:full', (e) => {
      if (this._inRun()) this._toast(`${ITEM_NAMES[e && e.kind] || 'Bag'}: bag is full`, 1.6);
    });
    bus.on('bag:apply', () => {
      if (this._inRun()) this._hapticBoth(0.2, 40);
      this._bagHapticT = 0;
    });
    bus.on('bag:done', (e) => {
      if (!this._inRun()) return;
      const k = e ? e.kind : -1;
      this._hapticBoth(k === ITEM.ADRENALINE ? 0.9 : 0.55, k === ITEM.ADRENALINE ? 160 : 110);
    });
    bus.on('bag:cancel', (e) => {
      if (this._inRun() && e && e.reason !== 'inactive') this._hapticBoth(0.25, 50);
    });
    bus.on('bag:refuse', (e) => {
      if (!this._inRun() || !e) return;
      const why = { empty: 'None left', full: e.kind === ITEM.BATTERY ? 'Lantern is charged' : 'Nothing to heal', active: 'Already boosted', busy: 'Already applying', dead: '' }[e.reason];
      if (why) this._toast(why, 1.3);
    });
    bus.on('lantern:low', () => {
      if (this._inRun()) this._toast('Lantern running low', 3);
    });
    bus.on('lantern:empty', () => {
      if (this._inRun()) this._toast('The lantern is nearly spent', 3);
    });
    bus.on('checkpoint', () => {
      const h = this.health;
      if (h && this.state === 'playing') h.heal(C.health.checkpointHeal, true); // reaching a checkpoint patches you up
      if (this.state === 'playing') this._snapshotBag(); // ... and a respawn returns to this bag
    });
    bus.on('xr:recenter', () => this.recenter());
  }

  _creatureNear(e, range) {
    const p = this.player;
    if (!p || !e) return false;
    const x = finiteOr(e.x, NaN);
    if (!isFinite(x)) {
      const c = this.creature;
      return !!(c && c.distance < range);
    }
    return Math.hypot(x - p.x, finiteOr(e.y, 1e9) - p.y, finiteOr(e.z, 0) - p.z) < range;
  }

  // ===========================================================================
  // XR session lifecycle
  // ===========================================================================

  _setupXRHooks() {
    const xr = this.renderer && this.renderer.renderer ? this.renderer.renderer.xr : null;
    if (!xr) return;
    try {
      if (typeof xr.setFoveation === 'function') xr.setFoveation(1);
    } catch (err) {
      this._fault('xr', err);
    }
    xr.addEventListener('sessionstart', () => this._onXRStart());
    xr.addEventListener('sessionend', () => this._onXREnd());
  }

  _onXRStart() {
    const xr = this.renderer.renderer.xr;
    this.xrActive = true;
    this._xrFrames = 0;
    this._xrStartAt = this.realTime;
    this._lastTs = null;
    const session = typeof xr.getSession === 'function' ? xr.getSession() : null;
    this._xrSession = session;
    if (session && typeof session.addEventListener === 'function') session.addEventListener('visibilitychange', this._onXRVisibility);
    if (this.governor) this._try('governor', () => this.governor.onSessionStart(session));
    else {
      try {
        xr.setFoveation(1);
      } catch {
        /* not supported by this layer */
      }
    }
    if (!this.bootTimes.xrStart) this.bootTimes.xrStart = nowSinceNav();
    // Recentre the head on the body but keep the user's physical facing: UI3D has
    // already placed any open panel in front of the head in world space, and
    // rotating the room now would swing it away. Facing is set on start / respawn.
    this._requestRecentre(NaN);
    // Lantern on the left hand: HandsView re-parents it itself (glass core of its lantern);
    // otherwise hang it on the left hand socket.
    const input = this.input;
    const hv = this.handsView;
    if (!(hv && hv.manageLantern)) {
      const socket = (hv && hv.lanternSocket) || (input && typeof input.handSocket === 'function' ? input.handSocket('left') : null) || (input && input.lanternSocket) || null;
      if (socket) this._try('renderer', () => this.renderer.setLanternParent && this.renderer.setLanternParent(socket));
    }
    this._reissueHint();
    this._uiMode = null; // re-sync
    this._syncUIMode();
    this._unlockAudio();
    if (document.body) document.body.classList.add('xr-presenting');
    this.bus.emit('game:xr', { active: true, session });
    if (!this.input || this.input.isFallback) this.bus.emit('xr:start', { session }); // InputManager emits its own
  }

  _onXREnd() {
    const r = this.renderer;
    const session = this._xrSession;
    if (session && typeof session.removeEventListener === 'function') session.removeEventListener('visibilitychange', this._onXRVisibility);
    this._xrSession = null;
    this.xrActive = false;
    this._lastTs = null;
    if (this.governor) this._try('governor', () => this.governor.onSessionEnd());
    // Keep the world yaw the head had, then hand the camera back to desktop control.
    const cam = r.camera;
    const worldYaw = r.rig.rotation.y + yawOfQuaternion(cam.quaternion);
    cam.position.set(0, 0, 0);
    cam.quaternion.identity();
    this._headLocal.x = 0;
    this._headLocal.z = 0;
    this._setLook(worldYaw, 0);
    if (!(this.handsView && this.handsView.manageLantern)) this._try('renderer', () => r.setLanternParent && r.setLanternParent(cam));
    this._reissueHint();
    if (this.state === 'playing') this.pause();
    this._uiMode = null;
    this._syncUIMode();
    if (document.body) document.body.classList.remove('xr-presenting');
    this._resize();
    this.bus.emit('game:xr', { active: false });
    if (!this.input || this.input.isFallback) this.bus.emit('xr:end', {});
  }

  _xrVisibilityChanged() {
    const s = this._xrSession;
    if (!s) return;
    if (s.visibilityState !== 'visible') {
      // 'visible-blurred' (system menu / dialog) or 'hidden': pause.
      if (this.state === 'playing') this.pause();
      this._try('input', () => this.input.releaseAll && this.input.releaseAll());
    }
  }

  /** Requests an immersive-vr session (call from a click/trigger handler). */
  async enterVR() {
    this._unlockAudio();
    if (this.xrActive) return true;
    this._xrStartAt = this.realTime; // the browser may blur the page while the session starts
    const input = this.input;
    try {
      if (input && typeof input.enterVR === 'function' && !input.isFallback) {
        // InputManager resolves false on failure (and emits 'xr:error' itself).
        const ok = await input.enterVR();
        if (ok === false) {
          this._fault('xr', input.lastError || new Error('XR session failed'));
          this._toast('VR could not start.', 3);
          return false;
        }
      } else {
        await this._requestXRSession();
      }
      return true;
    } catch (err) {
      this._fault('xr', err);
      this.bus.emit('xr:error', { message: (err && err.message) || String(err) });
      this._toast('VR could not start.', 3);
      return false;
    }
  }

  /** Ends the immersive session (back to desktop). */
  exitVR() {
    if (this.resilience) this.resilience.markExitRequested();
    try {
      if (this.input && typeof this.input.exitVR === 'function' && !this.input.isFallback) return this.input.exitVR();
      const s = this.renderer.renderer.xr.getSession();
      if (s) return s.end();
    } catch (err) {
      this._fault('xr', err);
    }
    return null;
  }

  /** Resolves true when an immersive-vr session can be requested. */
  isVRSupported() {
    try {
      if (this.input && typeof this.input.isVRSupported === 'function' && !this.input.isFallback) return Promise.resolve(this.input.isVRSupported()).catch(() => false);
      if (typeof navigator !== 'undefined' && navigator.xr && navigator.xr.isSessionSupported) {
        return navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
      }
    } catch (err) {
      this._fault('xr', err);
    }
    return Promise.resolve(false);
  }

  /** Game-level fallback when the input module cannot start the session itself. */
  async _requestXRSession() {
    if (typeof navigator === 'undefined' || !navigator.xr) throw new Error('WebXR is not available in this browser.');
    // No 'hand-tracking' (as xrInput.js): the game needs controllers (sticks, grips, A–B).
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor', 'bounded-floor'] });
    const xr = this.renderer.renderer.xr;
    xr.setReferenceSpaceType('local-floor');
    await xr.setSession(session);
  }

  /** XR: makes the current head position the body centre (keeps the facing). */
  recenter() {
    if (!this.xrActive) return false;
    this._requestRecentre(NaN);
    return true;
  }

  _requestRecentre(worldYaw) {
    const r = this._recentre;
    r.pending = true;
    r.yaw = worldYaw;
    r.frames = 0;
  }

  /** Faces a world yaw: desktop sets the look; XR rotates the room around the head. */
  _face(yaw) {
    if (!isFinite(yaw)) return;
    if (this.xrActive) this._requestRecentre(yaw);
    else this._setLook(yaw, 0);
  }

  _setLook(yaw, pitch) {
    const input = this.input;
    if (input && typeof input.setLook === 'function') {
      this._try('input', () => input.setLook(yaw, pitch));
      return;
    }
    if (input && typeof input.resetLook === 'function' && !this.xrActive && !finiteOr(pitch, 0)) {
      this._try('input', () => input.resetLook(yaw));
      return;
    }
    const r = this.renderer;
    if (!r) return;
    if (isFinite(yaw)) r.rig.rotation.y = yaw;
    if (!this.xrActive) r.camera.rotation.set(finiteOr(pitch, 0), 0, 0);
  }

  // ===========================================================================
  // Run lifecycle
  // ===========================================================================

  /**
   * Starts a fresh run (call from a click handler: unlocks audio).
   * @param {string} diffKey 'normal' | 'nightmare' | 'abyss' | 'sandbox'
   */
  start(diffKey) {
    if (!this.booted && !this.level) return false;
    const fallbackKey = DIFFICULTY[this.settings.lastDifficulty] ? this.settings.lastDifficulty : 'normal';
    const key = DIFFICULTY[diffKey] ? diffKey : fallbackKey;
    this._unlockAudio();
    const fromMenu = this.state === 'menu';
    if (this._runActive()) this._recordDepth();
    try {
      this.difficultyKey = key;
      this.diff = DIFFICULTY[key];
      this._buildWorld(this.diff, false);
    } catch (err) {
      this._fault('start', err);
      showFatal(err);
      return false;
    }
    const lvl = this.level;
    const p = this.player;
    this._runCount++;
    this.hidePlayer = false;
    this.time = 0;
    this._runClock = 0;
    this.deaths = 0;
    this.victoryT = -1;
    this.gateClosed = false;
    this.flash = 0;
    this.fade = fromMenu ? START_FADE : Math.max(this.fade, RESTART_FADE);
    this.deepest = p.y;
    this.sectionIndex = lvl.sectionIndexAt(p.y);
    const sp = lvl.spawn;
    this.checkpoint = { x: sp.x, y: sp.y, z: sp.z, yaw: finiteOr(sp.yaw, 0), index: -1 };
    this._creatureSection = -1;
    this.deathT = 0;
    this.deathCause = null;
    this._deathShown = false;
    this._acc = 0;
    this._pendingJump = false;
    this._resetProgress();
    this._resetBag();

    this._try('threat', () => this.threat.reset && this.threat.reset());
    this._try('creature', () => this.creature.reset(p));
    this._try('skitter', () => this.skitters && this.skitters.reset());
    this._face(finiteOr(sp.yaw, 0));

    this.settings.lastDifficulty = key;
    Storage.saveSettings(this.settings);
    this._bumpStat(`runs.${key}`);

    this._setState('playing');
    this._try('ui', () => this.ui.show(null));
    this._try('audio', () => this.audio.setPaused(false));
    this.bus.emit('game:start', { difficulty: key, diff: this.diff });
    this._enterSection(this.sectionIndex, 'initial');
    return true;
  }

  /** Instant restart of the current difficulty from the top. */
  restart() {
    const key = DIFFICULTY[this.difficultyKey] ? this.difficultyKey : 'normal';
    this.bus.emit('game:restart', { difficulty: key });
    return this.start(key);
  }

  /** Is there a saved run to continue (meta/save.js)? The menu shows Continue when this is true. */
  canContinue() {
    return !!(this.save && this.save.continueInfo && this.save.continueInfo());
  }

  /**
   * Continue the saved run: starts the saved difficulty and moves to the saved checkpoint with the saved clock,
   * deaths and depth. Returns false when there is nothing to continue. Call from a click / trigger handler.
   */
  continueRun() {
    const info = this.save && this.save.continueInfo ? this.save.continueInfo() : null;
    if (!info || !DIFFICULTY[info.difficulty] || !this.booted) return false;
    this._continuing = info;
    let ok = false;
    try {
      ok = this.start(info.difficulty);
      if (ok) ok = this._resumeAt(info);
    } finally {
      this._continuing = null;
    }
    if (ok) this.bus.emit('game:continue', { info });
    return ok;
  }

  _resumeAt(info) {
    const lvl = this.level;
    const cp = info.checkpoint;
    const idx = cp.index > 0 ? Math.min(cp.index, lvl.sections.length - 1) : 0;
    if (idx > 0 && !this._warp(idx)) return false;
    this.time = Math.max(0, finiteOr(info.time, 0));
    this.deaths = Math.max(0, finiteOr(info.deaths, 0) | 0);
    const deepest = -finiteOr(info.depthMeters, 0);
    if (deepest < this.deepest) this.deepest = deepest;
    this.fade = Math.max(this.fade, START_FADE);
    return true;
  }

  /**
   * Respawns at the current checkpoint (death panel or pause menu). With
   * checkpoints 'none' (Abyss) this restarts the run.
   */
  respawn() {
    if (this.state !== 'dead' && this.state !== 'paused') return false;
    if (this.victoryT >= 0 || !this.player) return false;
    if (!this.diff || this.diff.checkpoints === 'none') return this.restart();
    const cp = this.checkpoint;
    const p = this.player;
    this.level.reset();
    p.reset(cp.x, cp.y, cp.z);
    if (this.health) this.health.reset(); // a respawn restores full health
    if (this.physics && this.physics.climb) this.physics.climb.reset(); // ... and a fresh grip
    this._restoreBag(); // ... and the bag as it was at the checkpoint (supplies taken since lie there again)
    this.tethers.reset();
    this._acc = 0;
    this._pendingJump = false;
    this.deathT = 0;
    this._deathShown = false;
    const idx = this.level.sectionIndexAt(cp.y);
    if (idx !== this.sectionIndex) this._enterSection(idx, 'respawn');
    else if (idx !== this._creatureSection) this._setCreatureSection(idx);
    this._try('creature', () => this.creature.onRespawn(p));
    this._try('skitter', () => this.skitters && this.skitters.onRespawn(p));
    this._try('threat', () => this.threat.reset && this.threat.reset());
    this._face(cp.yaw);
    this.flash = 0;
    this.fade = Math.max(this.fade, RESPAWN_FADE);
    this._setState('playing');
    this._try('ui', () => this.ui.show(null));
    this._try('audio', () => this.audio.setPaused(false));
    this.bus.emit('game:respawn', { x: cp.x, y: cp.y, z: cp.z, index: cp.index });
    return true;
  }

  /** Pauses a run in progress (B / menu / Esc / focus loss). */
  pause() {
    if (this.state !== 'playing') return false;
    this._setState('paused');
    this._try('audio', () => this.audio.setPaused(true));
    this._try('ui', () => this.ui.show('pause', this._pauseInfo()));
    this.bus.emit('game:pause', {});
    return true;
  }

  /** Resumes a paused run. */
  resume() {
    if (this.state !== 'paused') return false;
    this._acc = 0;
    this._lastTs = null;
    // A pause clears the input's held state (pointer-lock loss, an XR blur), while the
    // tethers still think the button is down: their safety net would drop every
    // attached rope on the first frame. Ropes stay attached until a fresh
    // press / release on that hand (the same rule as debugAttach); a trigger held
    // through a plain pause still lets go on its release edge.
    const t = this.tethers;
    if (t) for (let k = 0; k < 2; k++) t.hands[HANDS[k]].held = false;
    this._setState('playing');
    this._try('audio', () => this.audio.setPaused(false));
    this._try('ui', () => this.ui.show(null));
    this.bus.emit('game:resume', {});
    return true;
  }

  /** Abandons the run and returns to the main menu (attract mode). */
  quitToMenu() {
    if (this._runActive()) this._recordDepth();
    try {
      this._enterAttract();
    } catch (err) {
      this._fault('menu', err);
    }
    this._try('ui', () => this.ui.hideHint && this.ui.hideHint());
    this._try('ui', () => this.ui.show('menu'));
    this._try('audio', () => this.audio.setPaused(true));
    this.bus.emit('game:menu', {});
    return true;
  }

  /** Sandbox only: teleport to the checkpoint of section i (resumes if paused). */
  warpToSection(i) {
    if (this.difficultyKey !== 'sandbox') return false;
    return this._warp(i);
  }

  _warp(i) {
    if (!this.level || !this.player) return false;
    // Not during the victory gate slam: victoryT would keep counting and open the
    // victory screen in the section warped to (respawn() refuses for the same reason).
    if (this.victoryT >= 0) return false;
    if (this.state !== 'playing' && this.state !== 'paused' && this.state !== 'dead') return false;
    const lvl = this.level;
    const idx = U.clamp(i | 0, 0, Math.max(0, lvl.sections.length - 1));
    const cp = lvl.checkpointFor(idx, 'all');
    const p = this.player;
    p.reset(cp.x, cp.y, cp.z);
    if (this.health) this.health.reset();
    if (this.physics && this.physics.climb) this.physics.climb.reset();
    this.tethers.reset();
    this._acc = 0;
    this._pendingJump = false;
    this.deathT = 0;
    this._deathShown = false;
    this.checkpoint = { x: cp.x, y: cp.y, z: cp.z, yaw: finiteOr(cp.yaw, 0), index: finiteOr(cp.index, idx) };
    if (cp.y < this.deepest) this.deepest = cp.y;
    this._skipProgressAbove(cp.y);
    this._lastHint = null;
    this._try('ui', () => this.ui.hideHint && this.ui.hideHint());
    this._enterSection(idx, 'warp');
    this._try('creature', () => this.creature.onRespawn(p));
    this._try('skitter', () => this.skitters && this.skitters.onRespawn(p));
    this._try('threat', () => this.threat.reset && this.threat.reset());
    this._face(cp.yaw);
    this.fade = Math.max(this.fade, RESTART_FADE);
    this._setState('playing');
    this._try('ui', () => this.ui.show(null));
    this._try('audio', () => this.audio.setPaused(false));
    this.bus.emit('game:warp', { index: idx });
    return true;
  }

  /**
   * Merges a partial settings object into the live settings (the same object
   * every module holds), persists it and emits settings:changed.
   */
  applySettings(partial) {
    const s = this.settings;
    if (!s) return null;
    if (!partial || typeof partial !== 'object') return s;
    const D = SETTINGS_DEFAULTS;
    for (const k of Object.keys(partial)) {
      const v = partial[k];
      if (k in D) {
        if (typeof v === typeof D[k] && (typeof v !== 'number' || isFinite(v))) s[k] = v;
      } else if (typeof v === 'boolean' || typeof v === 'string' || (typeof v === 'number' && isFinite(v))) {
        s[k] = v; // UI-only extras ride along in memory
      }
    }
    s.volume = U.clamp(finiteOr(s.volume, D.volume), 0, 1);
    s.aimAssist = U.clamp(finiteOr(s.aimAssist, D.aimAssist), 0.6, 1.4);
    s.turnSpeed = U.clamp(finiteOr(s.turnSpeed, D.turnSpeed), 0.5, 2);
    s.mouseSensitivity = U.clamp(finiteOr(s.mouseSensitivity, D.mouseSensitivity), 0.3, 3);
    if (s.dominantHand !== 'left' && s.dominantHand !== 'right') s.dominantHand = D.dominantHand;
    if (!DIFFICULTY[s.lastDifficulty]) s.lastDifficulty = 'normal';
    sanitizeHeightSettings(s);
    sanitizeUxSettings(s);
    Storage.saveSettings(s);
    this._try('audio', () => this.audio.setVolume(s.volume));
    this._try('input', () => this.input.applySettings && this.input.applySettings(s));
    this.bus.emit('settings:changed', { settings: s });
    return s;
  }

  // ===========================================================================
  // World construction
  // ===========================================================================

  /** (Re)builds the per-run objects for a difficulty. Reuses the level when the variant matches. */
  _buildWorld(diff, attract) {
    const M = this.modules;
    const variant = diff.levelVariant || 'normal';
    if (this.level && this._levelVariant === variant) this.level.reset();
    else {
      const data = M.levelData && M.levelData.LEVEL_DATA_3D ? M.levelData.LEVEL_DATA_3D : undefined;
      this.level = new M.level.Level3D(data, variant);
      this._levelVariant = variant;
    }
    const lvl = this.level;
    const spawn = lvl.spawn || { x: 0, y: 0, z: 0, yaw: 0 };
    if (this.player) this.player.reset(spawn.x, spawn.y, spawn.z);
    else this.player = new Player3D(spawn.x, spawn.y, spawn.z);

    // Per-run objects get a scoped bus so their subscriptions die with them.
    if (this._runBus) this._runBus.dispose();
    const old = this.creature;
    if (old && typeof old.destroy === 'function') this._try('creature', () => old.destroy());
    this._runBus = scopedBus(this.bus);
    this.tethers = new TetherSystem(lvl, diff, this._runBus, this.settings);
    this.physics = new Physics3D(lvl, diff, this._runBus);
    this._guardKill(this.physics);
    const cdiff = attract ? inactiveDiff(diff) : diff;
    const CreatureCls = M.creature && M.creature.Creature3D;
    this.creature = null;
    if (typeof CreatureCls === 'function') {
      try {
        this.creature = new CreatureCls(lvl, cdiff, this._runBus, { seed: (0x9e3779b1 * (this._runCount + 1)) >>> 0 });
      } catch (err) {
        this._fault('creature', err);
      }
    }
    if (!this.creature) this.creature = nullCreature();
    this.skitters = null;
    const SkitterCls = M.skitter && M.skitter.SkitterGroup;
    if (typeof SkitterCls === 'function' && !skitterOff()) {
      try {
        this.skitters = new SkitterCls(lvl, cdiff, this._runBus, { seed: (0x9e3779b1 * (this._runCount + 1)) >>> 0 });
      } catch (err) {
        this._fault('skitter', err);
      }
    }
    const tc = this._threatCtx;
    tc.player = this.player;
    tc.creature = this.creature;
    tc.tethers = this.tethers;
    tc.diff = diff;
    tc.level = lvl;
    // The bag and the supplies of this run (empty / unseeded until start() resets them).
    this.bag = new Inventory3D(this._runBus);
    this.pickups = new Pickups3D(lvl, this._runBus);
    this._ensureLevelView();
  }

  /**
   * Wraps physics.kill so god mode, the victory sequence and non-playing
   * states veto deaths before any player:death event (physics3d.js untouched).
   */
  _guardKill(physics) {
    const game = this;
    const original = physics.kill;
    physics.kill = function (player, tethers, cause, impact) {
      if (game._godMode || game.victoryT >= 0 || game.state !== 'playing') return;
      original.call(this, player, tethers, cause, impact);
    };
  }

  // ---- the bag (sim/inventory3d.js, sim/pickups3d.js) -------------------------------------------------------------

  /** A new run: an empty bag, a full lantern and this run's supplies (seeded from a saved run counter: a new layout each run). */
  _resetBag() {
    if (!this.bag) return;
    this.bag.reset();
    if (this.pickups) {
      const n = (finiteOr(Storage.get('supplyRuns', 0), 0) | 0) + 1;
      Storage.set('supplyRuns', n);
      this.pickups.setLevel(this.level);
      this.pickups.reset((Math.imul(n, 0x9e3779b1) ^ 0x85ebca6b) >>> 0);
      this.pickups.snapshot();
    }
    this.player.speedMul = 1;
  }

  _snapshotBag() {
    if (this.bag) this.bag.snapshot();
    if (this.pickups) this.pickups.snapshot();
  }

  _restoreBag() {
    if (this.bag) this.bag.restore();
    if (this.pickups) this.pickups.restore();
    if (this.player) this.player.speedMul = 1;
  }

  /** Bag input, the apply channel, adrenaline, the lantern charge and the pickups, once per run frame. */
  _updateBag(dt, intent, live) {
    const bag = this.bag;
    const p = this.player;
    if (!bag || !p) return;
    const health = this.health;
    if (live) {
      const ib = intent.bag;
      if (ib) {
        if (ib.cycle) {
          const n = Math.min(4, Math.abs(ib.cycle | 0));
          for (let i = 0; i < n; i++) bag.cycle(ib.cycle > 0 ? 1 : -1);
        }
        if (ib.cancel) bag.cancel('cancel');
        if (ib.slot >= 0 && ib.slot < 4) {
          bag.select(ib.slot);
          bag.use(ib.slot, health);
        } else if (ib.use) bag.use(bag.selected, health);
      }
    }
    bag.update(dt, health, live);
    p.speedMul = bag.speedMul;
    if (live && this.pickups) {
      let a = null;
      let b = null;
      const input = this.input;
      if (this.xrActive && input && typeof input.handPose === 'function' && typeof input.gripValue === 'function') {
        const hp = input.handPose('left');
        const A = this._handA;
        A.x = hp.x;
        A.y = hp.y;
        A.z = hp.z;
        A.grip = input.gripValue('left');
        A.ok = typeof input.handTracked === 'function' ? input.handTracked('left') : true;
        const hq = input.handPose('right');
        const Bh = this._handB;
        Bh.x = hq.x;
        Bh.y = hq.y;
        Bh.z = hq.z;
        Bh.grip = input.gripValue('right');
        Bh.ok = typeof input.handTracked === 'function' ? input.handTracked('right') : true;
        a = A;
        b = Bh;
      }
      this.pickups.update(dt, p, bag, a, b);
    }
    // First aid ratchet: a soft tick in the hands while a long channel runs.
    const ap = bag.applying;
    if (ap.active && ap.dur >= 1.2) {
      this._bagHapticT -= dt;
      if (this._bagHapticT <= 0) {
        this._bagHapticT = 0.28;
        this._hapticBoth(0.1 + 0.12 * (ap.t / ap.dur), 22);
      }
    }
  }

  /** Dims the lantern with its charge through the renderer's public fields (lanternBase, lantern.distance). */
  _updateLantern() {
    const r = this.renderer;
    const bag = this.bag;
    if (!r || !r.lantern) return;
    let L = this._lantern0;
    if (!L || L.renderer !== r) L = this._lantern0 = { renderer: r, base: typeof r.lanternBase === 'number' ? r.lanternBase : NaN, range: finiteOr(r.lantern.distance, 0) };
    const st = this.state;
    const inRun = !!bag && !this.hidePlayer && (st === 'playing' || st === 'paused' || st === 'dead' || st === 'victory');
    let f = inRun ? bag.lanternFactor : 1;
    if (inRun && bag.lanternCharge <= C.bag.lanternLow && st === 'playing') {
      // a low battery stutters (bounded, never a strobe)
      const t = this.realTime;
      f *= 1 - 0.14 * Math.max(0, Math.sin(t * 13.1) * Math.sin(t * 4.3 + 1));
    }
    if (L.base === L.base) r.lanternBase = L.base * f;
    else r.lantern.intensity *= f;
    if (L.range > 0) r.lantern.distance = L.range * (0.6 + 0.4 * f);
  }

  /** Menu background: the level of the last difficulty, the view drifting down the shaft. */
  _enterAttract() {
    const key = DIFFICULTY[this.settings.lastDifficulty] ? this.settings.lastDifficulty : 'normal';
    this.difficultyKey = key;
    this.diff = DIFFICULTY[key];
    this._buildWorld(this.diff, true);
    this._try('creature', () => this.creature.reset(this.player));
    this._try('skitter', () => this.skitters && this.skitters.reset());
    this._try('threat', () => this.threat.reset && this.threat.reset());
    this.hidePlayer = true;
    this.time = 0;
    this._runClock = 0;
    this.deaths = 0;
    this.victoryT = -1;
    this.gateClosed = false;
    this.flash = 0;
    this.fade = Math.max(this.fade, 0.6);
    this._override = null;
    const lvl = this.level;
    const a = this._attract;
    a.t = 0;
    a.top = lvl.spawn ? lvl.spawn.y : lvl.bounds.maxY;
    const lastSec = lvl.sections[lvl.sections.length - 1];
    a.bottom = Math.min(a.top - 10, (lastSec ? lastSec.checkpoint.y : lvl.bounds.minY) + 6);
    a.y = a.top;
    a.fading = -1; // fade in
    if (!this._attractPath || this._attractPath.level !== lvl || this._attractPath.top !== a.top) {
      try {
        this._attractPath = this._buildAttractPath(a.top, a.bottom);
      } catch (err) {
        this._fault('attract', err);
        this._attractPath = null;
      }
    }
    this.sectionIndex = lvl.sectionIndexAt(a.y);
    this.deepest = a.y;
    this._face(finiteOr(lvl.spawn && lvl.spawn.yaw, 0));
    this._setState('menu');
  }

  _resetProgress() {
    const lvl = this.level;
    const n = lvl.sections.length;
    this._seen.length = n;
    for (let i = 0; i < n; i++) this._seen[i] = false;
    const hints = this._hintList;
    const triggers = this._triggerList;
    hints.length = 0;
    triggers.length = 0;
    for (let i = 0; i < n; i++) {
      const sec = lvl.sections[i];
      const hl = sec.hints || [];
      for (let j = 0; j < hl.length; j++) if (hl[j] && isFinite(hl[j].y)) hints.push({ y: hl[j].y, hint: hl[j], section: i });
      const tl = sec.triggers || [];
      for (let j = 0; j < tl.length; j++) if (tl[j] && isFinite(tl[j].y)) triggers.push({ y: tl[j].y, trigger: tl[j], section: i });
    }
    // Descending: the player crosses them top → bottom.
    hints.sort((a, b) => b.y - a.y);
    triggers.sort((a, b) => b.y - a.y);
    this._hintCursor = 0;
    this._triggerCursor = 0;
    this._hintQueue.length = 0;
    this._hintCooldown = 0;
    this._lastHint = null;
  }

  /** Marks hints / triggers above y as already fired (warps / teleports never spam them). */
  _skipProgressAbove(y) {
    while (this._hintCursor < this._hintList.length && this._hintList[this._hintCursor].y >= y) this._hintCursor++;
    while (this._triggerCursor < this._triggerList.length && this._triggerList[this._triggerCursor].y >= y) this._triggerCursor++;
    this._hintQueue.length = 0;
  }

  // ===========================================================================
  // Main loop
  // ===========================================================================

  _startLoop() {
    this._lastTs = null;
    this._running = true;
    this.renderer.renderer.setAnimationLoop(this._loopFn);
  }

  _stopLoop() {
    this._running = false;
    try {
      if (this.renderer) this.renderer.renderer.setAnimationLoop(null);
    } catch {
      /* already gone */
    }
  }

  /** setAnimationLoop callback (rAF on desktop, XRSession frames in VR). */
  _loop(time, frame) {
    if (!this._running) return;
    const now = typeof time === 'number' && isFinite(time) ? time : nowMs();
    let realDt = this._lastTs === null ? 1 / 72 : (now - this._lastTs) / 1000;
    this._lastTs = now;
    if (!(realDt >= 0)) realDt = 0;
    if (realDt > 0 && realDt < 0.25) {
      this._frameAvg += (realDt - this._frameAvg) * 0.1;
      this.fps = 1 / this._frameAvg;
    }
    const dt = Math.min(realDt, C.MAX_FRAME_DT);
    if (this.xrActive) this._xrFrames++;
    if (this.resilience) this.resilience.heartbeat(nowMs());
    if (!this.booted) {
      this._loadingFrame(dt, frame); // content still loading: the loading scene, head-tracked
      return;
    }
    if (this.governor && this.xrActive) this.governor.sample(realDt, frame);
    const rgov = this.renderer && this.renderer.governor;
    if (rgov) {
      // render-side governor (lighting tiers): mirrors platform/governor.js in XR, steps by itself on desktop; 0 = not a measuring state
      const st = this.state;
      rgov.update(st === 'playing' || st === 'dead' ? realDt * 1000 : 0);
    }
    try {
      if (this._frozen) {
        // Debug manual stepping: presentation keeps running (rig, views, UI, render),
        // but only AT3D.debug.step advances the simulation.
        this.realTime += dt;
        this._updateRig();
        this._updateFeedback(dt, true); // head-in-wall darkening only
        this._updateViews(dt);
        this._updateUI(dt);
        this._render(dt);
      } else {
        this._frame(dt, true);
      }
      this._frameErrors = 0;
    } catch (err) {
      this._frameErrors++;
      this._fault('frame', err);
      if (this._frameErrors >= FATAL_FRAME_ERRORS) {
        this._stopLoop();
        showFatal(err);
      }
    }
  }

  /** One frame. `doRender` is false for headless debug stepping. */
  _frame(dt, doRender) {
    this.realTime += dt;
    try {
      const intent = this._readInput(dt);
      this.intent = intent;
      // If a DOM handler (UI click / key) changed the state or screen since the
      // last frame, the same press must not act a second time here.
      const external = this.state !== this._endState || this._uiScreen() !== this._endUi;
      this._consumed = false;
      if (!external) this._handleGlobalEdges(intent);
      const runIntent = this._consumed ? this._blank : intent;
      this._applyTurn(dt, intent);
      switch (this.state) {
        case 'playing':
        case 'dead':
          this._updateRun(dt, runIntent);
          break;
        case 'paused':
          break;
        case 'victory':
          this._updateVictoryScene(dt);
          break;
        default:
          this._updateAttract(dt);
      }
      this._updateRig();
      this._updateFeedback(dt);
      this._updateHaptics(dt);
      this._updateViews(dt);
      this._updateUI(dt);
      if (doRender) this._render(dt);
      this._updateAudio(dt);
    } finally {
      this._endFrame();
    }
  }

  _readInput(dt) {
    let intent = null;
    try {
      intent = this.input.update(dt) || this.input.intent || null;
    } catch (err) {
      this._fault('input', err);
    }
    if (this._override) return this._fillOverrideIntent();
    return intent && intent.hands ? intent : this._blank;
  }

  _endFrame() {
    try {
      this.input.endFrame();
    } catch (err) {
      this._fault('input', err);
    }
    const o = this._override;
    if (o) {
      for (let i = 0; i < EDGE_KEYS.length; i++) o[EDGE_KEYS[i]] = false;
      if (o.hands) {
        for (let k = 0; k < 2; k++) {
          const h = o.hands[HANDS[k]];
          if (h) {
            h.pressed = false;
            h.released = false;
          }
        }
      }
      if (o.ui) o.ui.click = false;
    }
    this._endState = this.state;
    this._endUi = this._uiScreen();
  }

  _uiScreen() {
    return this.ui && this.ui.current !== undefined ? this.ui.current : null;
  }

  _anyHandPressed(intent) {
    const h = intent.hands;
    return !!(h && ((h.left && h.left.pressed) || (h.right && h.right.pressed)));
  }

  _handleGlobalEdges(intent) {
    const s = this.state;
    if (intent.pausePressed) {
      if (s === 'playing') {
        this.pause();
        this._consumed = true;
        return;
      }
      if (s === 'paused' && (this._uiScreen() === 'pause' || this._uiFallback || this.ui.current === undefined)) {
        this.resume();
        this._consumed = true;
        return;
      }
    }
    if (intent.restartPressed && (s === 'playing' || s === 'dead' || s === 'victory' || s === 'paused')) {
      this.restart();
      this._consumed = true;
      return;
    }
    if (s === 'dead' && this.deathT >= DEATH_PANEL_DELAY && (intent.confirmPressed || intent.jumpPressed || this._anyHandPressed(intent))) {
      this.respawn();
      this._consumed = true;
      return;
    }
    if (this._uiFallback) {
      // No menus: any confirm / trigger starts, continues or restarts.
      const go = intent.confirmPressed || this._anyHandPressed(intent) || (intent.ui && intent.ui.click);
      if (s === 'menu' && go) {
        this.start(this.settings.lastDifficulty);
        this._consumed = true;
      } else if (s === 'victory' && go && this.victoryT > VICTORY_DELAY + 0.8) {
        this.restart();
        this._consumed = true;
      } else if (s === 'paused' && (go || intent.backPressed)) {
        this.resume();
        this._consumed = true;
      }
    }
  }

  /** XR smooth turn (no snap, no vignette — user decision). Desktop: 0 (the mouse turns). */
  _applyTurn(dt, intent) {
    let rate = finiteOr(intent.turnRate, 0);
    let step = 0;
    if (this.settings && this.settings.turnMode === 'snap') {
      // WP-UX comfort option: the stick snaps the view by settings.snapAngle, once per push (smooth turning stays the default).
      step = snapTurnStep(this._snapState || (this._snapState = makeSnapState()), rate, SNAP_FULL_RATE * U.clamp(finiteOr(this.settings.turnSpeed, 1), 0.25, 3), this.settings.snapAngle);
      rate = 0;
    }
    if ((rate === 0 && step === 0) || !this.renderer || this.state === 'dead') return;
    // Hanging by a hand in VR: the hold would be dragged round by a turn about the head. Turn your body instead.
    const cl = this.physics ? this.physics.climb : null;
    if (cl && cl.holding && cl.mode === 1) return;
    this.renderer.rig.rotation.y += rate * dt + step;
    if (step !== 0) this.bus.emit('comfort:snap', { dir: step > 0 ? 1 : -1 });
  }

  // ---- per-state updates -------------------------------------------------------

  _updateRun(dt, intent) {
    const p = this.player;
    const t = this.tethers;
    this._updateBag(dt, intent, this.state === 'playing' && p.alive && this.victoryT < 0);
    if (this.state === 'playing' && p.alive) {
      t.updateTargets(p, intent);
      t.handleInput(p, intent, dt);
      this._stepPhysics(dt, intent);
    } else {
      if (t.hands.left.target || t.hands.right.target) {
        t.hands.left.target = null;
        t.hands.right.target = null;
      }
      this._acc = 0;
      this._pendingJump = false;
      this.alpha = 0;
      p.prevX = p.x;
      p.prevY = p.y;
      p.prevZ = p.z;
    }
    // Render interpolation between the last two physics states.
    p.rx = p.prevX + (p.x - p.prevX) * this.alpha;
    p.ry = p.prevY + (p.y - p.prevY) * this.alpha;
    p.rz = p.prevZ + (p.z - p.prevZ) * this.alpha;

    this._runClock += dt;
    if (this.victoryT < 0) this.time += dt; // counts while playing or dead

    this._updateCreature(dt);
    this._updateThreat(dt);

    if (this.state === 'playing' && p.alive) this._updateProgress(dt);
    if (this.state === 'dead') this._updateDeath(dt);
    if (this.state === 'playing' && this.victoryT >= 0) {
      this.victoryT += dt;
      if (this.victoryT >= VICTORY_DELAY) this._finishVictory();
    }
  }

  /** Fixed-step accumulator; jumpPressed reaches exactly one physics step. */
  _stepPhysics(dt, intent) {
    const PDT = C.PHYSICS_DT;
    const p = this.player;
    const si = this._stepIntent;
    if (this.physics.health) this.physics.health.god = this._godMode || this.victoryT >= 0; // no damage in god mode or during the victory sequence
    if (intent.jumpPressed) this._pendingJump = true;
    const mv = intent.move;
    si.move.x = mv ? U.clamp(finiteOr(mv.x, 0), -1, 1) : 0;
    si.move.z = mv ? U.clamp(finiteOr(mv.z, 0), -1, 1) : 0;
    si.reel = U.clamp(finiteOr(intent.reel, 0), -1, 1);
    si.brake = !!intent.brake;
    const ih = intent.hands;
    si.hands.left.yank = ih && ih.left ? U.clamp(finiteOr(ih.left.yank, 0), 0, 1) : 0;
    si.hands.right.yank = ih && ih.right ? U.clamp(finiteOr(ih.right.yank, 0), 0, 1) : 0;
    this._prepareClimb(intent, si);
    this._acc += dt;
    let steps = 0;
    while (this._acc >= PDT - 1e-9) {
      if (steps >= C.MAX_STEPS_PER_FRAME) {
        this._acc = 0; // drop the backlog rather than spiral
        break;
      }
      si.jumpPressed = this._pendingJump;
      this._pendingJump = false;
      this.physics.step(p, this.tethers, si, PDT);
      this._acc -= PDT;
      steps++;
      if (!p.alive || this.state !== 'playing') {
        this._acc = 0;
        break;
      }
    }
    if (this._acc < 0) this._acc = 0;
    this.alpha = p.alive ? U.clamp(this._acc / PDT, 0, 1) : 0;
  }

  /**
   * Grip climbing (sim/climb3d.js), once per frame before the physics steps: copies the climb intent, turns each palm into a
   * point relative to the body (the rig follows the body's render position, so hand - body does not depend on where the body
   * moves this frame), lets the model probe which hands are in reach of a hold, and gives a grip that is a grab to the climb
   * (no rope yank on it; on the desktop Space is the hop, not the reel).
   */
  _prepareClimb(intent, si) {
    const climb = this.physics ? this.physics.climb : null;
    const sc = si.climb;
    const ic = intent.climb;
    if (!climb || !sc) return;
    const p = this.player;
    if (!ic || this.state !== 'playing' || this.victoryT >= 0) {
      sc.vr = false;
      sc.grab.left = false;
      sc.grab.right = false;
      sc.hands.left.ok = false;
      sc.hands.right.ok = false;
      climb.probe(p, null);
      return;
    }
    sc.vr = !!ic.vr && !!this.xrActive;
    sc.fwd = finiteOr(ic.fwd, 0);
    sc.side = finiteOr(ic.side, 0);
    sc.rx = finiteOr(ic.rx, 1);
    sc.rz = finiteOr(ic.rz, 0);
    sc.fx = finiteOr(ic.fx, 0);
    sc.fz = finiteOr(ic.fz, -1);
    for (let k = 0; k < 2; k++) {
      const h = HANDS[k];
      sc.grab[h] = !!ic.grab[h];
      const a = ic.hands[h];
      const b = sc.hands[h];
      b.ok = !!a.ok && isFinite(a.x) && isFinite(a.y) && isFinite(a.z);
      if (b.ok) {
        b.rx = a.x - p.rx;
        b.ry = a.y - p.ry;
        b.rz = a.z - p.rz;
      }
    }
    climb.probe(p, sc);
    for (let k = 0; k < 2; k++) if (climb.suppressYank(HANDS[k])) si.hands[HANDS[k]].yank = 0;
    if (climb.holding && !sc.vr) si.reel = 0;
  }

  _updateProgress(dt) {
    const p = this.player;
    const lvl = this.level;
    if (p.y < this.deepest) this.deepest = p.y;
    const idx = lvl.sectionIndexAt(p.y);
    if (idx !== this.sectionIndex && idx >= 0) this._enterSection(idx, 'progress');

    const hl = this._hintList;
    while (this._hintCursor < hl.length && hl[this._hintCursor].y >= p.y) {
      this._queueHint(hl[this._hintCursor].hint);
      this._hintCursor++;
    }
    const tl = this._triggerList;
    while (this._triggerCursor < tl.length && tl[this._triggerCursor].y >= p.y) {
      const entry = tl[this._triggerCursor];
      this._triggerCursor++;
      this._fireTrigger(entry);
    }
    this._updateHints(dt);

    if (this.victoryT < 0 && lvl.inGoal(p.x, p.y, p.z)) this._beginVictory();
    if (this._godMode && p.y < lvl.bounds.minY - C.player.fallDeathMargin * 0.8) {
      // God mode never dies: fell out of the world → back to the checkpoint.
      const cp = this.checkpoint;
      p.reset(cp.x, cp.y, cp.z);
      this.tethers.reset();
    }
  }

  /** Section bookkeeping. mode: 'progress' | 'initial' | 'respawn' | 'warp'. */
  _enterSection(idx, mode) {
    const lvl = this.level;
    const sec = lvl.sections[idx];
    if (!sec) return;
    this.sectionIndex = idx;
    const first = !this._seen[idx];
    this._seen[idx] = true;
    this.bus.emit('section:enter', { index: idx, section: sec, first, mode });
    // The creature follows the deepest section reached; respawns / warps
    // re-apply the section the player is actually in.
    if (mode === 'progress' ? idx > this._creatureSection : idx !== this._creatureSection) this._setCreatureSection(idx);
    if (mode === 'progress' || mode === 'initial') {
      const cp = lvl.checkpointFor(idx, (this.diff && this.diff.checkpoints) || 'all');
      const cpIndex = cp ? finiteOr(cp.index, lvl.sectionIndexAt(cp.y)) : -1;
      if (cp && cpIndex > this.checkpoint.index) {
        this.checkpoint = { x: cp.x, y: cp.y, z: cp.z, yaw: finiteOr(cp.yaw, 0), index: cpIndex };
        // UI3D toasts "Checkpoint" and audio chimes on this event: only for real progress,
        // never for the run's starting checkpoint.
        if (mode === 'progress') this.bus.emit('checkpoint', { index: cpIndex, x: cp.x, y: cp.y, z: cp.z });
      }
    }
  }

  _setCreatureSection(idx) {
    this._creatureSection = idx;
    const sec = this.level.sections[idx];
    this._try('creature', () => this.creature.setSection(idx, sec, this.player));
    this._try('skitter', () => this.skitters && this.skitters.setSection(idx, this.player));
  }

  _queueHint(hint) {
    const q = this._hintQueue;
    if (q.length >= HINT_QUEUE_MAX) q.shift();
    q.push(hint);
  }

  _updateHints(dt) {
    if (this._hintCooldown > 0) this._hintCooldown -= dt;
    if (this._hintCooldown > 0 || this._hintQueue.length === 0) return;
    const h = this._hintQueue.shift();
    const text = this._hintText(h);
    const secs = finiteOr(h.duration, HINT_DEFAULT_SECONDS);
    if (text) {
      // UI3D listens: it picks the VR / desktop wording from `hint` itself.
      this.bus.emit('hint', { text, seconds: secs, duration: secs, hint: h });
      this._lastHint = h;
      this._lastHintUntil = this.realTime + secs;
    }
    this._hintCooldown = Math.min(secs, HINT_GAP);
  }

  /** Entering / leaving VR mid-hint: show it again in the other wording for the time left. */
  _reissueHint() {
    const h = this._lastHint;
    const left = this._lastHintUntil - this.realTime;
    if (!h || left < 1 || (this.state !== 'playing' && this.state !== 'paused')) return;
    const text = this._hintText(h);
    if (text) this.bus.emit('hint', { text, seconds: left, duration: left, hint: h, reissue: true });
  }

  /** VR wording by default; desktop wording when not presenting. */
  _hintText(h) {
    if (!this.xrActive && h.desktop) return h.desktop;
    return h.text || h.desktop || '';
  }

  _toast(text, seconds) {
    this._try('ui', () => this.ui.showToast && this.ui.showToast(text, seconds));
    this.bus.emit('toast', { text, seconds });
  }

  _fireTrigger(entry) {
    const t = entry.trigger;
    const p = this.player;
    const payload = { name: t.name, data: t.data || {}, section: entry.section, x: p.x, y: t.y, z: p.z };
    this.bus.emit('trigger', payload);
    if (t.name) this.bus.emit('trigger:' + t.name, payload);
  }

  _beginVictory() {
    this.victoryT = 0; // timer stops; deaths are vetoed from here on
    this.gateClosed = true;
    this._hintQueue.length = 0;
    this._lastHint = null;
    this._try('ui', () => this.ui.hideHint && this.ui.hideHint());
    this._try('creature', () => this.creature.onVictory(this.level.gate));
    this.bus.emit('game:goal', { time: this.time });
  }

  _finishVictory() {
    const key = this.difficultyKey;
    const time = this.time;
    let res = { best: null, previous: null, isNew: false };
    const deepestMeters = U.depthMeters(this.deepest);
    try {
      if (this.diff.recordTimes) {
        res = Storage.submitTime(key, time);
        const fewest = Storage.get(`fewestDeaths.${key}`, null);
        if (typeof fewest !== 'number' || this.deaths < fewest) Storage.set(`fewestDeaths.${key}`, this.deaths);
        this._bumpStat(`completions.${key}`);
      } else {
        res.best = Storage.getBest(key);
      }
      Storage.recordDepth(key, deepestMeters);
    } catch (err) {
      this._fault('storage', err);
    }
    this._setState('victory');
    this._hapticBoth(0.6, 200);
    const info = {
      time,
      best: res.best,
      previous: res.previous,
      isNew: !!res.isNew,
      recorded: !!this.diff.recordTimes,
      deaths: this.deaths,
      deepestMeters,
      difficultyKey: key,
      label: this.diff.label,
    };
    this.lastVictory = info;
    this._try('ui', () => this.ui.show('victory', info));
    this.bus.emit('game:victory', info);
  }

  _onPlayerDeath(e) {
    if (this.state !== 'playing') return;
    const cause = (e && e.cause) || 'impact';
    this.deaths++;
    this.deathCause = cause;
    this.deathT = 0;
    this._deathShown = false;
    this._acc = 0;
    this._pendingJump = false;
    this._setState('dead');
    this.flash = cause === 'creature' ? 1 : cause === 'impact' ? 0.7 : 0.5;
    this._hapticBoth(1, cause === 'creature' ? 380 : 240);
    this._hintQueue.length = 0;
    this._lastHint = null;
    this._try('ui', () => this.ui.hideHint && this.ui.hideHint());
    this._recordDepth();
  }

  _updateDeath(dt) {
    this.deathT += dt;
    if (this._deathShown || this.deathT < DEATH_PANEL_DELAY) return;
    this._deathShown = true;
    const cause = this.deathCause || 'impact';
    const pool = DEATH_MESSAGES[cause] || DEATH_MESSAGES.impact;
    const canRespawn = this.diff.checkpoints !== 'none';
    const info = {
      cause,
      deaths: this.deaths,
      canRespawn,
      depthMeters: U.depthMeters(this.player.y),
      deepestMeters: U.depthMeters(this.deepest),
      time: this.time,
      message: pool[(this.deaths - 1) % pool.length],
      difficultyKey: this.difficultyKey,
      label: this.diff.label,
      prompt: this.xrActive
        ? canRespawn
          ? 'A (or point + trigger) to rise again · hold X to restart'
          : 'A (or point + trigger) to begin again'
        : canRespawn
          ? 'Click or Enter to rise again · R to restart'
          : 'Click or Enter to begin again',
    };
    this.lastDeath = info;
    this._try('ui', () => this.ui.show('death', info));
    this.bus.emit('game:deathpanel', info);
  }

  _pauseInfo() {
    const lvl = this.level;
    return {
      difficultyKey: this.difficultyKey,
      label: this.diff ? this.diff.label : '',
      sandbox: this.difficultyKey === 'sandbox',
      canRespawn: !!(this.diff && this.diff.checkpoints !== 'none'),
      sections: lvl ? lvl.sections.map((s) => ({ index: s.index, name: s.name })) : [],
      time: this.time,
      depthMeters: this.player ? U.depthMeters(this.player.y) : 0,
    };
  }

  _updateVictoryScene(dt) {
    this.victoryT += dt;
    this._runClock += dt;
    this._updateCreature(dt);
    this._updateThreat(dt);
  }

  _updateAttract(dt) {
    const lvl = this.level;
    const a = this._attract;
    a.t += dt;
    const p = this.player;
    let x;
    let y;
    let z;
    if (this.xrActive) {
      // In the headset the menu stays put: the user stands on the first ledge,
      // the shaft falling away into fog below (a moving room under a panel reads badly).
      const sp = lvl.spawn;
      x = sp.x;
      y = sp.y;
      z = sp.z;
      if (a.fading !== 0) {
        this.fade = Math.max(0, this.fade - dt / ATTRACT_FADE_IN);
        if (this.fade <= 0) a.fading = 0;
      }
    } else {
      a.y -= ATTRACT_SPEED * dt; // keeps drifting through the fades
      if (a.fading === 0 && a.y <= a.bottom) a.fading = 1;
      if (a.fading === 1) {
        // Fade to black near the bottom, then start over at the top.
        this.fade = Math.min(1, this.fade + dt / ATTRACT_FADE_OUT);
        if (this.fade >= 1) {
          a.y = a.top;
          a.fading = -1;
        }
      } else if (a.fading === -1) {
        this.fade = Math.max(0, this.fade - dt / ATTRACT_FADE_IN);
        if (this.fade <= 0) a.fading = 0;
      }
      y = a.y;
      const c = this._attractPoint(y, this._handTmp);
      x = c.x;
      z = c.z;
      // Slow look-around, gazing down into the shaft.
      const r = this.renderer;
      r.rig.rotation.y = finiteOr(lvl.spawn.yaw, 0) + a.t * 0.06;
      r.camera.rotation.set(-0.42 + Math.sin(a.t * 0.11) * 0.08, 0, 0);
    }
    // The hidden player rides the view (lantern light / audio listener / fog).
    p.x = p.prevX = p.rx = x;
    p.y = p.prevY = p.ry = y;
    p.z = p.prevZ = p.rz = z;
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    this.sectionIndex = lvl.sectionIndexAt(y);
    this._updateCreature(dt);
    this._updateThreat(dt);
  }

  /** Attract camera (x, z) at height y: interpolated along the precomputed clear path. */
  _attractPoint(y, out) {
    const path = this._attractPath;
    if (!path || path.n === 0) {
      out.x = this.level.spawn.x;
      out.z = this.level.spawn.z;
      return out;
    }
    const f = U.clamp((path.top - y) / ATTRACT_STEP, 0, path.n - 1);
    const i = Math.min(path.n - 2, Math.floor(f));
    if (i < 0) {
      out.x = path.xs[0];
      out.z = path.zs[0];
      return out;
    }
    const t = f - i;
    out.x = path.xs[i] + (path.xs[i + 1] - path.xs[i]) * t;
    out.z = path.zs[i] + (path.zs[i + 1] - path.zs[i]) * t;
    return out;
  }

  /**
   * Precomputes the menu camera's descent so it never sits inside geometry:
   * every metre it keeps the previous (x, z) while that is free, otherwise
   * moves to the nearest free spot inside the section's shaft footprint
   * (falling back to the checkpoints' line), then the path is smoothed where
   * the smoothed point is still free. Runs once per level (no per-frame cost).
   */
  _buildAttractPath(top, bottom) {
    const lvl = this.level;
    const n = Math.max(2, Math.floor((top - bottom) / ATTRACT_STEP) + 1);
    const xs = new Float32Array(n);
    const zs = new Float32Array(n);
    const scratch = [];
    const r = ATTRACT_CLEAR;
    const free = (x, y, z) => {
      const cy = y + ATTRACT_EYE;
      const list = lvl.querySolids(x - r, cy - r - 0.5, z - r, x + r, cy + r + 0.5, z + r, scratch);
      for (let k = 0; k < list.length; k++) {
        const b = list[k];
        if (b.active === false) continue;
        // A short capsule: the camera spot and half a metre either side vertically.
        if (U.sphereBox(x, cy, z, r, b) || U.sphereBox(x, cy - 0.5, z, r, b) || U.sphereBox(x, cy + 0.5, z, r, b)) return false;
      }
      return true;
    };
    let px = lvl.spawn.x;
    let pz = lvl.spawn.z;
    for (let i = 0; i < n; i++) {
      const y = top - i * ATTRACT_STEP;
      if (!free(px, y, pz)) {
        const sec = lvl.sections[lvl.sectionIndexAt(y)];
        const sh = sec && sec.shaft;
        let cx = sh ? (sh.minX + sh.maxX) / 2 : sec ? sec.checkpoint.x : px;
        let cz = sh ? (sh.minZ + sh.maxZ) / 2 : sec ? sec.checkpoint.z : pz;
        let best = null;
        let bestD = Infinity;
        // Rings around the previous spot, then around the shaft centre.
        for (let pass = 0; pass < 2 && !best; pass++) {
          const ox = pass === 0 ? px : cx;
          const oz = pass === 0 ? pz : cz;
          for (let rad = 1; rad <= 16 && !best; rad += 1) {
            for (let k = 0; k < 16; k++) {
              const ang = (k / 16) * Math.PI * 2;
              const x = ox + Math.cos(ang) * rad;
              const z = oz + Math.sin(ang) * rad;
              if (sh && (x < sh.minX + 1 || x > sh.maxX - 1 || z < sh.minZ + 1 || z > sh.maxZ - 1)) continue;
              if (!free(x, y, z)) continue;
              const d = Math.hypot(x - px, z - pz);
              if (d < bestD) {
                bestD = d;
                best = { x, z };
              }
            }
          }
        }
        if (best) {
          px = best.x;
          pz = best.z;
        }
      }
      xs[i] = px;
      zs[i] = pz;
    }
    // Limit sideways speed: a point may sit at most ATTRACT_MAX_SLIDE metres (per metre of
    // descent) from its neighbour; pull it toward the neighbour where that is free, so the
    // camera starts sliding aside before an obstacle instead of whipping past it.
    const limit = (i, j) => {
      const dx = xs[i] - xs[j];
      const dz = zs[i] - zs[j];
      const d = Math.hypot(dx, dz);
      const m = ATTRACT_MAX_SLIDE * ATTRACT_STEP;
      if (d <= m) return;
      const nx = xs[j] + (dx / d) * m;
      const nz = zs[j] + (dz / d) * m;
      if (free(nx, top - i * ATTRACT_STEP, nz)) {
        xs[i] = nx;
        zs[i] = nz;
      }
    };
    for (let pass = 0; pass < 3; pass++) {
      for (let i = n - 2; i >= 0; i--) limit(i, i + 1);
      for (let i = 1; i < n; i++) limit(i, i - 1);
    }
    // Smooth (±6 m window), keeping the raw point wherever the smoothed one is blocked.
    const sx = new Float32Array(n);
    const sz = new Float32Array(n);
    const W = 6;
    for (let i = 0; i < n; i++) {
      let ax = 0;
      let az = 0;
      let c = 0;
      for (let j = Math.max(0, i - W); j <= Math.min(n - 1, i + W); j++) {
        ax += xs[j];
        az += zs[j];
        c++;
      }
      ax /= c;
      az /= c;
      const y = top - i * ATTRACT_STEP;
      if (free(ax, y, az)) {
        sx[i] = ax;
        sz[i] = az;
      } else {
        sx[i] = xs[i];
        sz[i] = zs[i];
      }
    }
    return { top, n, xs: sx, zs: sz, level: lvl };
  }

  _updateCreature(dt) {
    const c = this.creature;
    try {
      c.update(dt, this.player, this._runClock);
      if (c.caughtPlayer) {
        c.caughtPlayer = false;
        if (this.player.alive && this.state === 'playing') this.physics.kill(this.player, this.tethers, 'creature');
      }
    } catch (err) {
      this._fault('creature', err);
    }
    this._updateSkitters(dt);
  }

  /** WP-SKITTER: the little hunters step with the Mason; a hit costs health (health3d), and only an empty bar kills. */
  _updateSkitters(dt) {
    const g = this.skitters;
    if (!g || !g.enabled) return;
    try {
      g.update(dt, this.player, this._runClock);
      const dmg = g.takeDamage();
      if (dmg > 0 && this.player.alive && this.state === 'playing' && this.physics && this.physics.health) {
        const h = this.physics.health;
        if (h.damage(dmg, 'skitter', 0)) this.physics.kill(this.player, this.tethers, 'creature');
      }
    } catch (err) {
      this._fault('skitter', err);
    }
  }

  _updateThreat(dt) {
    try {
      this.threat.update(dt, this._threatCtx);
    } catch (err) {
      this._fault('threat', err);
    }
  }

  /**
   * Rig follows the player. XR: 1:1 scale, the real floor is the ground under the body (rig.y = body.y − radius + height lift),
   * see InputManager.xrRigPosition. Desktop: the camera sits at a standing person's eye height (VIEW.standEye above the feet).
   */
  _updateRig() {
    const r = this.renderer;
    if (!r || !this.player) return;
    const rig = r.rig;
    const p = this.player;
    const desktopAttract = this.state === 'menu' && !this.xrActive;
    if (this.xrActive) {
      const input = this.input;
      const rc = this._recentre;
      if (rc.pending && this._xrFrames > XR_RECENTRE_FRAMES) {
        // Face the requested world yaw (rotate the room under the head), then make
        // the head the body centre (InputManager's recenter when it has one).
        const cam = r.camera;
        if (isFinite(rc.yaw)) rig.rotation.y = rc.yaw - yawOfQuaternion(cam.quaternion);
        let done = false;
        if (input && typeof input.recenter === 'function' && typeof input.xrRigPosition === 'function') {
          try {
            done = input.recenter() !== false;
          } catch (err) {
            this._fault('input', err);
          }
        }
        this._headLocal.x = finiteOr(cam.position.x, 0);
        this._headLocal.z = finiteOr(cam.position.z, 0);
        if (done || !input || typeof input.xrRigPosition !== 'function') {
          rc.pending = false;
          this.bus.emit('xr:recentered', { yaw: rig.rotation.y });
        }
      }
      if (input && typeof input.xrRigPosition === 'function') {
        // Single source of truth for the head offset: the InputManager's recenter.
        try {
          const o = input.xrRigPosition(p.rx, p.ry, p.rz, this._rigTmp);
          if (o && isFinite(o.x) && isFinite(o.y) && isFinite(o.z)) {
            rig.position.set(o.x, o.y, o.z);
            return;
          }
        } catch (err) {
          this._fault('input', err);
        }
      }
      const yaw = rig.rotation.y;
      const c = Math.cos(yaw);
      const s = Math.sin(yaw);
      const hx = this._headLocal.x;
      const hz = this._headLocal.z;
      // Head offset in the rig rotated into the world (rotation about +Y).
      rig.position.set(p.rx - (hx * c + hz * s), p.ry - C.player.radius + this._heightTrim(), p.rz - (-hx * s + hz * c));
    } else if (desktopAttract) {
      rig.position.set(p.x, p.y + ATTRACT_EYE, p.z);
    } else {
      rig.position.set(p.rx, p.ry + eyeAboveBody() + this._heightTrim(), p.rz);
    }
  }

  /** The fine player-height trim (m) from the settings (also applies to the desktop camera). */
  _heightTrim() {
    const v = this.settings ? this.settings.heightOffset : 0;
    return typeof v === 'number' && isFinite(v) ? U.clamp(v, -0.3, 0.3) : 0;
  }

  /** Flash / fade lifecycle, then the head-in-wall darkening (`headOnly`: just that — debug freeze). */
  _updateFeedback(dt, headOnly) {
    // Take back last frame's head-in-wall darkening (unless something set the fade since).
    if (this.fade === this._fadeOut) this.fade = this._fadeBase;
    if (!headOnly) {
      if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 2.4);
      const s = this.state;
      if (s === 'dead') this.fade = U.approach(this.fade, DEATH_FADE_MAX, dt * 1.6);
      else if (s === 'paused') this.fade = U.approach(this.fade, PAUSE_FADE, dt * 3);
      else if (s === 'victory') this.fade = U.approach(this.fade, VICTORY_FADE, dt * 0.8);
      else if (s === 'playing' && this.fade > 0) this.fade = Math.max(0, this.fade - dt * FADE_IN_RATE);
      // menu: the attract loop drives the fade
    }
    this._fadeBase = this.fade;
    this._updateHeadBlock(dt);
    if (this._headBlock > this.fade) this.fade = this._headBlock;
    this._fadeOut = this.fade;
  }

  /**
   * Darkens the view while the head is inside (or within HEAD_CLEAR of) level
   * geometry — leaning or stepping into a wall from a ledge in XR, or walking a
   * standing-height desktop camera under a low overhang. Not a comfort vignette:
   * it only hides what the player must never see (the outside of the level).
   */
  _updateHeadBlock(dt) {
    let target = 0;
    const input = this.input;
    if ((this.xrActive || this.state !== 'menu') && this.level && input && typeof input.headPose === 'function') {
      let h = null;
      try {
        h = input.headPose();
      } catch (err) {
        this._fault('input', err);
      }
      if (h && isFinite(h.x) && isFinite(h.y) && isFinite(h.z)) {
        const r = HEAD_CLEAR;
        const L = this.level.querySolids(h.x - r, h.y - r, h.z - r, h.x + r, h.y + r, h.z + r, this._headScratch);
        let d2 = r * r;
        for (let i = 0; i < L.length; i++) {
          const b = L[i];
          if (b.active === false) continue;
          const dx = h.x - U.clamp(h.x, b.minX, b.maxX);
          const dy = h.y - U.clamp(h.y, b.minY, b.maxY);
          const dz = h.z - U.clamp(h.z, b.minZ, b.maxZ);
          const q = dx * dx + dy * dy + dz * dz;
          if (q < d2) d2 = q;
        }
        L.length = 0;
        target = U.clamp((r - Math.sqrt(d2)) / (r - HEAD_BLACK), 0, 1);
      }
    }
    const b = this._headBlock;
    this._headBlock = U.approach(b, target, dt * (target > b ? HEAD_FADE_IN : HEAD_FADE_OUT));
  }

  /** Continuous rope-tension / fragile-anchor haptics, rate limited. */
  _updateHaptics(dt) {
    this._hapticT -= dt;
    if (this._hapticT > 0) return;
    this._hapticT = TENSION_HAPTIC_PERIOD;
    if (this.state !== 'playing' || !this.player || !this.player.alive || !this.settings.haptics) return;
    const g = C.player.gravity;
    for (let k = 0; k < 2; k++) {
      const h = HANDS[k];
      const rope = this.tethers.hands[h].rope;
      if (!rope.attached) continue;
      const norm = U.clamp((rope.tension - 1.6 * g) / (3 * g), 0, 1);
      const stress = this.tethers.anchorStress(h);
      const buzz = ropeHaptic(rope.slipSpeed, rope.tension / g, this.time); // friction buzz while the clutch pays out
      const amt = Math.max(norm > 0 ? 0.06 + 0.45 * norm : 0, stress > 0 ? 0.1 + 0.55 * stress : 0, buzz);
      if (amt > 0) this._haptic(h, amt, Math.round(TENSION_HAPTIC_PERIOD * 1000) + 10);
    }
  }

  _updateViews(dt) {
    const fx = this.healthFx;
    if (fx) {
      try {
        fx.update(dt, this);
      } catch (err) {
        this._fault('healthFx', err);
      }
    }
    if (this.bagFx) {
      try {
        this.bagFx.update(dt, this);
      } catch (err) {
        this._fault('bagFx', err);
      }
    }
    if (this.climbView) {
      try {
        this.climbView.update(dt, this);
      } catch (err) {
        this._fault('climbView', err);
      }
    }
    if (this.sceneDetail) {
      try {
        this.sceneDetail.update(dt, this);
      } catch (err) {
        this._fault('sceneDetail', err);
      }
    }
    if (this.pickupsView) {
      try {
        this.pickupsView.update(dt, this);
      } catch (err) {
        this._fault('pickupsView', err);
      }
    }
    this._updateLantern();
    const cv = this.creatureView;
    if (cv) {
      try {
        // LOD0 (60 k triangles, x2 eyes) only close up on Quest / low: LOD1 (25 k) beyond (BUDGET_CH1); high keeps the long range
        if (cv.opts && !cv.opts.variant) cv.opts.lodDistance = CREATURE_LOD[this.renderer && this.renderer.qualityTier] || CREATURE_LOD.high;
        cv.update(this.creature, dt, this.renderer && this.renderer.camera); // camera drives LOD / far hiding
      } catch (err) {
        this._fault('creatureView', err);
        if (cv.isRig) this._fallbackToKit(cv);
      }
    }
    const sv = this.skitterViews;
    if (sv.length && this.skitters) {
      const cam = this.renderer && this.renderer.camera;
      for (let i = 0; i < sv.length; i++) {
        try {
          sv[i].update(this.skitters.slots[i] || null, dt, cam);
        } catch (err) {
          this._fault('skitterView', err);
          sv[i].root.visible = false;
          sv.splice(i, 1); // a broken view retires; the sim keeps running (no visuals, only sound)
          i--;
        }
      }
    }
    // A HandsView the input manager created is updated by the input manager.
    const hv = this.handsView;
    if (hv && this._ownsHandsView && typeof hv.update === 'function') {
      try {
        hv.update(dt, this);
      } catch (err) {
        this._fault('handsView', err);
      }
    }
    // The body last: it reads the rig, the hands' elbow anchors and the sim state of this frame.
    const bv = this.bodyView;
    if (bv && bv.ready) {
      try {
        bv.update(dt, this);
      } catch (err) {
        this._fault('bodyView', err);
      }
    }
  }

  _updateUI(dt) {
    this._syncUIMode();
    try {
      this.ui.update(dt);
    } catch (err) {
      this._fault('ui', err);
    }
  }

  /**
   * UI mode (triggers click panels instead of firing tethers): menu / pause /
   * victory, and in VR the death panel too (point + trigger at Continue, A
   * respawns, X restarts). On desktop the death screen keeps the pointer locked
   * so a click or Enter respawns. UI3D applies the same rule from its side.
   */
  _syncUIMode() {
    const s = this.state;
    const want = s === 'menu' || s === 'paused' || s === 'victory' || (s === 'dead' && this._deathShown && this.xrActive);
    if (want === this._uiMode) return;
    this._uiMode = want;
    const input = this.input;
    if (input && typeof input.setUIMode === 'function') {
      try {
        input.setUIMode(want);
      } catch (err) {
        this._fault('input', err);
      }
    }
  }

  _updateAudio(dt) {
    try {
      this.audio.update(dt, this);
    } catch (err) {
      this._fault('audio', err);
    }
  }

  _render(dt) {
    const r = this.renderer;
    if (!r) return;
    try {
      r.update(dt, this);
      r.render();
      this._renderFaults = 0;
      const info = r.renderer.info;
      if (info) {
        const pf = this.perf;
        pf.calls = info.render.calls;
        pf.triangles = info.render.triangles;
        pf.geometries = info.memory.geometries;
        pf.textures = info.memory.textures;
        pf.frameMs = this._frameAvg * 1000;
      }
    } catch (err) {
      this._fault('renderer', err);
      this._renderFaults++;
      if (this._renderFaults >= RENDER_FAULT_SWAP && !r.isFallback) this._swapToFallbackRenderer();
    }
  }

  /** The real renderer keeps throwing: move the rig/camera into a fallback view and carry on. */
  _swapToFallbackRenderer() {
    console.error('[AT3D] renderer keeps failing; switching to the fallback renderer');
    try {
      const old = this.renderer;
      const fb = new FallbackRenderer3D(this.container, this.settings);
      // Keep the input bound to the old camera/rig objects: move them into the new scene.
      fb.scene.remove(fb.rig);
      fb.rig = old.rig;
      fb.camera = old.camera;
      fb.camera.add(fb.fadeMesh);
      fb.camera.add(fb.lantern);
      fb.scene.add(fb.rig);
      try {
        old.renderer.setAnimationLoop(null);
        if (old.renderer.domElement && old.renderer.domElement.parentNode) old.renderer.domElement.parentNode.removeChild(old.renderer.domElement);
      } catch {
        /* best effort */
      }
      this.renderer = fb;
      this._levelBuiltFor = null;
      this._ensureLevelView();
      this._setupXRHooks();
      fb.resize();
      this._startLoop();
    } catch (err) {
      this._fault('renderer', err);
    }
    this._renderFaults = 0;
  }

  // ---- helpers -------------------------------------------------------------------

  /** World position a hand's rope starts from (XR grip / desktop virtual hand / body). */
  handOrigin(hand, out) {
    const o = out || { x: 0, y: 0, z: 0 };
    const input = this.input;
    if (input && typeof input.handPose === 'function') {
      try {
        const hp = input.handPose(hand);
        if (hp && isFinite(hp.x) && isFinite(hp.y) && isFinite(hp.z)) {
          o.x = hp.x;
          o.y = hp.y;
          o.z = hp.z;
          return o;
        }
      } catch (err) {
        this._fault('input', err);
      }
    }
    const p = this.player;
    o.x = p ? p.rx : 0;
    o.y = p ? p.ry : 0;
    o.z = p ? p.rz : 0;
    return o;
  }

  /** The renderer's camera / rig / scene (other modules read them through the game). */
  get camera() {
    return this.renderer ? this.renderer.camera : null;
  }

  get rig() {
    return this.renderer ? this.renderer.rig : null;
  }

  /** Lantern charge 0..1 (sim/inventory3d.js; drains while playing, a battery restores 50 %); 1 before a world exists. */
  get lanternCharge() {
    return this.bag ? this.bag.lanternCharge : 1;
  }

  /** The grip-climbing model (sim/climb3d.js: stamina, warn, holding, hands[h].gripping / hover) or null before a world exists. */
  get climb() {
    return this.physics ? this.physics.climb : null;
  }

  /** The player's health model (sim/health3d.js: hp 0..1, low, dead, heartbeatRate) or null before a world exists. */
  get health() {
    return this.physics ? this.physics.health : null;
  }

  get scene() {
    return this.renderer ? this.renderer.scene : null;
  }

  _inRun() {
    return this.state === 'playing' || this.state === 'dead';
  }

  _runActive() {
    return this.state === 'playing' || this.state === 'dead' || this.state === 'paused';
  }

  _haptic(hand, intensity, ms) {
    if (!this.settings || !this.settings.haptics || !this.input || (hand !== 'left' && hand !== 'right')) return;
    try {
      if (typeof this.input.haptic === 'function') this.input.haptic(hand, U.clamp(intensity, 0, 1), ms);
    } catch (err) {
      this._fault('input', err);
    }
  }

  _hapticBoth(intensity, ms) {
    this._haptic('left', intensity, ms);
    this._haptic('right', intensity, ms);
  }

  _hapticTethered(intensity, ms) {
    const t = this.tethers;
    if (!t) return;
    for (let k = 0; k < 2; k++) if (t.hands[HANDS[k]].rope.attached) this._haptic(HANDS[k], intensity, ms);
  }

  _recordDepth() {
    try {
      Storage.recordDepth(this.difficultyKey, U.depthMeters(this.deepest));
    } catch (err) {
      this._fault('storage', err);
    }
  }

  _bumpStat(key) {
    try {
      const v = Storage.get(key, 0);
      Storage.set(key, (typeof v === 'number' && isFinite(v) ? v : 0) + 1);
    } catch (err) {
      this._fault('storage', err);
    }
  }

  _setState(s, force) {
    if (this.state === s && !force) return;
    const prev = this.state;
    this.state = s;
    this._syncUIMode();
    const body = typeof document !== 'undefined' ? document.body : null;
    if (body) {
      body.classList.toggle('playing', s === 'playing');
      body.setAttribute('data-game-state', s);
    }
    if (prev !== s && this.bus) this.bus.emit('game:state', { state: s, previous: prev });
  }

  /** Runs fn, logging (rate limited) instead of throwing. Rare calls only (allocates a closure). */
  _try(name, fn) {
    try {
      return fn();
    } catch (err) {
      this._fault(name, err);
      return undefined;
    }
  }

  _fault(name, err) {
    const n = (this.faults[name] || 0) + 1;
    this.faults[name] = n;
    if (n <= FAULT_LOG_LIMIT && typeof console !== 'undefined') {
      console.error(`[AT3D] ${name} failed${n === FAULT_LOG_LIMIT ? ' (further errors muted)' : ''}`, err);
    }
  }

  // ===========================================================================
  // Debug / test API (window.AT3D.debug)
  // ===========================================================================

  _fillOverrideIntent() {
    const o = this._override;
    const it = this._ovIntent;
    const mv = o.move || {};
    it.move.x = U.clamp(finiteOr(mv.x, 0), -1, 1);
    it.move.z = U.clamp(finiteOr(mv.z, 0), -1, 1);
    it.reel = U.clamp(finiteOr(o.reel, 0), -1, 1);
    it.brake = !!o.brake;
    it.turnRate = finiteOr(o.turnRate, 0);
    for (let i = 0; i < EDGE_KEYS.length; i++) it[EDGE_KEYS[i]] = !!o[EDGE_KEYS[i]];
    for (let k = 0; k < 2; k++) {
      const h = HANDS[k];
      const src = (o.hands && o.hands[h]) || null;
      const dst = it.hands[h];
      dst.aim = src ? this._debugAim(h, src) : null;
      dst.pressed = !!(src && src.pressed);
      dst.held = !!(src && src.held);
      dst.released = !!(src && src.released);
      dst.yank = src ? U.clamp(finiteOr(src.yank, 0), 0, 1) : 0;
    }
    // Grip climbing (desktop style): { grab: true, fwd: -1..1, side: -1..1 } clings to a zone in reach (tests, QA)
    const oc = o.climb || null;
    const ic = it.climb;
    ic.vr = false;
    ic.grab.left = ic.grab.right = !!(oc && oc.grab);
    ic.fwd = oc ? U.clamp(finiteOr(oc.fwd, 0), -1, 1) : 0;
    ic.side = oc ? U.clamp(finiteOr(oc.side, 0), -1, 1) : 0;
    ic.rx = 1;
    ic.rz = 0;
    ic.fx = 0;
    ic.fz = -1;
    const ui = o.ui || {};
    it.ui.ray = ui.ray || null;
    it.ui.click = !!ui.click;
    return it;
  }

  /** Debug aim: an explicit ray, or `aimAt` = anchor id / {x,y,z} (ray from the body). */
  _debugAim(hand, src) {
    if (src.aim) return src.aim;
    const tgt = src.aimAt;
    if (tgt == null || !this.player) return null;
    let x;
    let y;
    let z;
    if (typeof tgt === 'object') {
      x = tgt.x;
      y = tgt.y;
      z = tgt.z;
    } else {
      const an = this._anchorById(tgt);
      if (!an) return null;
      x = an.x;
      y = an.y;
      z = an.z;
    }
    const p = this.player;
    const dx = x - p.x;
    const dy = y - p.y;
    const dz = z - p.z;
    const l = Math.hypot(dx, dy, dz) || 1;
    const a = this._dbgAim[hand];
    a.ox = p.x;
    a.oy = p.y;
    a.oz = p.z;
    a.dx = dx / l;
    a.dy = dy / l;
    a.dz = dz / l;
    return a;
  }

  _anchorById(id) {
    const lvl = this.level;
    if (!lvl) return null;
    const byId = lvl.byId ? lvl.byId[id] : null;
    if (byId && lvl.anchors.indexOf(byId) >= 0) return byId;
    for (let i = 0; i < lvl.anchors.length; i++) if (String(lvl.anchors[i].id) === String(id)) return lvl.anchors[i];
    return null;
  }

  /**
   * Overrides the InputManager intent while non-null (contract §2 shape).
   * Continuous fields persist; edges (…Pressed, hands[h].pressed/released,
   * ui.click) apply to one frame. hands[h].pressed implies held and released
   * implies !held unless given. hands[h].aimAt may be an anchor id or {x,y,z}.
   */
  debugSetInput(partial) {
    if (partial == null) {
      this._override = null;
      return null;
    }
    const o = Object.assign({}, partial);
    if (partial.move) o.move = Object.assign({}, partial.move);
    if (partial.ui) o.ui = Object.assign({}, partial.ui);
    o.hands = {};
    for (let k = 0; k < 2; k++) {
      const h = HANDS[k];
      const src = partial.hands && partial.hands[h];
      if (!src) continue;
      const d = Object.assign({}, src);
      if (d.pressed && !('held' in d)) d.held = true;
      if (d.released && !('held' in d)) d.held = false;
      o.hands[h] = d;
    }
    this._override = o;
    return o;
  }

  /**
   * Advances the simulation deterministically at a fixed 1/60 s frame, then renders once
   * (opts.render === false skips the render; opts.state === false skips the snapshot —
   * for long scripted runs).
   */
  debugStep(seconds, opts) {
    const s = finiteOr(Number(seconds), 0);
    const n = U.clamp(Math.round(s * 60), 1, MAX_DEBUG_STEP_FRAMES);
    for (let i = 0; i < n; i++) this._frame(1 / 60, false);
    if (!opts || opts.render !== false) this._render(1 / 60);
    return opts && opts.state === false ? null : this.debugState();
  }

  debugTeleport(x, y, z) {
    const p = this.player;
    if (!p || !isFinite(x) || !isFinite(y) || !isFinite(z)) return false;
    if (this.tethers) this.tethers.releaseAll(p, 'reset');
    p.x = p.prevX = p.rx = +x;
    p.y = p.prevY = p.ry = +y;
    p.z = p.prevZ = p.rz = +z;
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.grounded = false;
    p.fallPeak = 0;
    this._acc = 0;
    this._skipProgressAbove(p.y + 1);
    return true;
  }

  debugAttach(hand, anchorId) {
    const h = hand === 'left' ? 'left' : 'right';
    const p = this.player;
    const t = this.tethers;
    if (!p || !t || !p.alive) return false;
    const an = this._anchorById(anchorId);
    if (!an || an.broken) return false;
    t.attach(p, h, an);
    t.hands[h].held = false; // stays attached until a press/release cycle on that hand
    return true;
  }

  /** JSON-friendly snapshot of the game for tests. */
  debugState() {
    const r = (v) => (typeof v === 'number' && isFinite(v) ? Math.round(v * 100) / 100 : v);
    const p = this.player;
    const t = this.tethers;
    const c = this.creature;
    const sec = this.level ? this.level.sections[this.sectionIndex] : null;
    const hand = (h) => {
      if (!t) return null;
      const st = t.hands[h];
      return {
        anchor: st.rope.anchor ? st.rope.anchor.id : null,
        length: r(st.rope.length),
        tension: r(st.rope.tension),
        target: st.target ? st.target.id : null,
        held: st.held,
      };
    };
    const rig = this.rig;
    return {
      state: this.state,
      difficulty: this.difficultyKey,
      time: r(this.time),
      deaths: this.deaths,
      section: this.sectionIndex,
      sectionName: sec ? sec.name : null,
      player: p
        ? {
            x: r(p.x),
            y: r(p.y),
            z: r(p.z),
            vx: r(p.vx),
            vy: r(p.vy),
            vz: r(p.vz),
            speed: r(p.speed),
            alive: p.alive,
            grounded: p.grounded,
            tethered: p.tethered,
            deathCause: p.deathCause,
          }
        : null,
      hands: { left: hand('left'), right: hand('right') },
      creature: c ? { state: c.state, stamina: r(c.stamina), distance: r(c.distance), x: r(c.x), y: r(c.y), z: r(c.z), active: !!c.active, lethal: !!c.lethal, isNull: !!c.isNull } : null,
      threat: this.threat ? r(this.threat.value) : 0,
      rig: rig ? { x: r(rig.position.x), y: r(rig.position.y), z: r(rig.position.z), yaw: r(rig.rotation.y) } : null,
      xr: this.xrActive,
      fps: r(this.fps),
      perf: Object.assign({}, this.perf),
      health: this.health ? { hp: r(this.health.hp), low: this.health.low, dead: this.health.dead, bpm: r(this.health.heartbeatRate), damage: r(this.health.totalDamage), hits: this.health.hits } : null,
      bag: this.bag ? this.debugBag() : null,
      climb: this.climb ? { stamina: r(this.climb.stamina), warn: r(this.climb.warn), holding: this.climb.holding, mode: this.climb.mode, exhausted: this.climb.exhausted, left: this.climb.hands.left.gripping, right: this.climb.hands.right.gripping } : null,
      checkpoint: Object.assign({}, this.checkpoint),
      deepest: r(this.deepest),
      depthMeters: U.depthMeters(this.deepest),
      victoryT: r(this.victoryT),
      fade: r(this.fade),
      flash: r(this.flash),
      ui: this._uiScreen(),
      godMode: this._godMode,
      frozen: this._frozen,
      standIns: {
        renderer: !!(this.renderer && this.renderer.isFallback),
        input: !!(this.input && this.input.isFallback),
        ui: !!(this.ui && this.ui.isNull),
        audio: !!(this.audio && this.audio.isNull),
        threat: !!(this.threat && this.threat.isNull),
        creature: !!(c && c.isNull),
        creatureView: !!(this.creatureView && this.creatureView.isStandIn),
        handsView: !this.handsView,
      },
      faults: Object.assign({}, this.faults),
    };
  }

  /** Bag read-out for tests, QA and the debug state. */
  debugBag() {
    const b = this.bag;
    if (!b) return null;
    const r = (v) => Math.round(v * 1000) / 1000;
    const pk = this.pickups;
    return {
      counts: Array.from(b.counts),
      selected: b.selected,
      applying: b.applying.active ? { kind: b.applying.kind, t: r(b.applying.t), dur: b.applying.dur } : null,
      adrenaline: b.adrenaline.active ? { t: r(b.adrenaline.t), dur: b.adrenaline.dur } : null,
      speedMul: b.speedMul,
      lanternCharge: r(b.lanternCharge),
      lanternFactor: r(b.lanternFactor),
      refusal: b.lastRefusal,
      pickups: pk ? { total: pk.items.length, remaining: pk.remaining, seed: pk.seed } : null,
    };
  }

  /** The window.AT3D.debug object (contract §8). */
  debugApi() {
    return {
      // Bag (tests, QA, screenshots): give(kind, n) adds items (kind 0 FIRST_AID .. 3 BATTERY), use(kind) starts applying, cancel(),
      // lantern(charge 0..1), spawn(kind, dx, dy, dz) drops a pickup near the player, pickups() lists the supplies of the run.
      bag: {
        state: () => this.debugBag(),
        give: (kind, n) => (this.bag ? this.bag.add(kind, n === undefined ? 1 : n) : 0),
        use: (kind) => (this.bag ? this.bag.use(kind === undefined ? this.bag.selected : kind, this.health) : false),
        cancel: () => (this.bag ? this.bag.cancel('debug') : false),
        lantern: (c) => {
          if (this.bag && typeof c === 'number') {
            this.bag.lanternCharge = U.clamp(c, 0, 1);
            this.bag.lanternFactor = lanternLevelOf(this.bag.lanternCharge);
          }
          return this.lanternCharge;
        },
        spawn: (kind, dx, dy, dz) => {
          const p = this.player;
          if (!this.pickups || !p) return null;
          const it = this.pickups.spawnAt(kind | 0, p.x + finiteOr(dx, 0), p.y + finiteOr(dy, 0), p.z + finiteOr(dz, -2));
          return { id: it.id, x: it.x, y: it.y, z: it.z };
        },
        pickups: () => (this.pickups ? this.pickups.items.map((i) => ({ id: i.id, kind: i.kind, x: i.x, y: i.y, z: i.z, taken: i.taken, section: i.section })) : []),
      },
      // WP-CREATURE-RIG (tests, QA, screenshots): place({distance, height, yaw, up, state}) puts a synthetic Mason near the player facing
      // them; play(clip) / pose(u, clip) force a clip (pose freezes it at normalised time u); stop() / clear() return to the sim; state() reads the rig.
      creature: {
        place: (o) => {
          const d = this.creatureView && this.creatureView.debug;
          return d ? d.place(Object.assign({ player: this.player, camera: this.renderer && this.renderer.camera }, o || {})) : null;
        },
        play: (name, o) => !!(this.creatureView && this.creatureView.debug && this.creatureView.debug.play(String(name), o)),
        pose: (u, name) => !!(this.creatureView && this.creatureView.debug && this.creatureView.debug.pose(u, name)),
        stop: () => !!(this.creatureView && this.creatureView.debug && this.creatureView.debug.stop()),
        clear: () => !!(this.creatureView && this.creatureView.debug && this.creatureView.debug.clear()),
        set: (patch) => !!(this.creatureView && this.creatureView.debug && this.creatureView.debug.set(patch)),
        state: () => (this.creatureView && this.creatureView.debug ? this.creatureView.debug.state() : { rig: false }),
        // WP-SKITTER: placeSkitter({distance, height, yaw, up, state, count}) puts synthetic skitterlings near the player (screenshots);
        // clearSkitter() returns them to the sim; spawnSkitter(n) puts n REAL sim skitterlings in play above the player; skitter() reads state.
        placeSkitter: (o) => {
          const sv = this.skitterViews;
          const out = [];
          const n = Math.max(1, Math.min(sv.length, (o && o.count) | 0 || 1));
          for (let i = 0; i < n; i++) {
            const oo = Object.assign({ player: this.player, camera: this.renderer && this.renderer.camera }, o || {});
            if (i) oo.yaw = (oo.yaw || 0) + 38 * i;
            if (i) oo.distance = (oo.distance == null ? 4 : oo.distance) + 1.5 * i;
            out.push(sv[i].debug.place(oo));
          }
          return out;
        },
        clearSkitter: () => {
          for (const v of this.skitterViews) v.debug.clear();
          return true;
        },
        spawnSkitter: (n) => {
          const g = this.skitters;
          return g && g.enabled ? g.force(Math.max(1, Math.min(2, n | 0 || 1)), this.player) : 0;
        },
        skitter: () => ({
          enabled: !!(this.skitters && this.skitters.enabled),
          off: skitterOff(),
          views: this.skitterViews.length,
          alive: this.skitters ? this.skitters.aliveCount : 0,
          hits: this.skitters ? this.skitters.hits : 0,
          slots: this.skitters
            ? this.skitters.slots.map((c) => ({ on: c.on, state: c.state, distance: Math.round(c.distance), speed: +c.speed.toFixed(2), visible: c.body.visible }))
            : [],
          views_: this.skitterViews.map((v) => ({ visible: v.root.visible, lod: v._lod, calls: v.info.drawCalls, tris: v.info.triangles })),
        }),
        view: () => (this.creatureView && this.creatureView.isRig ? 'rig' : this.creatureView && this.creatureView.isStandIn ? 'standin' : this.creatureView ? 'kit' : 'none'),
      },
      state: () => this.debugState(),
      teleport: (x, y, z) => this.debugTeleport(x, y, z),
      setInput: (partial) => this.debugSetInput(partial),
      step: (seconds, opts) => this.debugStep(seconds, opts),
      attach: (hand, id) => this.debugAttach(hand, id),
      godMode: (on) => {
        this._godMode = on === undefined ? true : !!on;
        return this._godMode;
      },
      warp: (i) => this._warp(i),
      // Health (tests, QA, screenshots): hp 0..1 sets the health directly (no events); damage(amount) hurts as a hit would.
      health: (hp) => {
        const h = this.health;
        if (h && typeof hp === 'number' && isFinite(hp)) h.setHp(hp);
        return h ? { hp: h.hp, low: h.low, dead: h.dead, bpm: h.heartbeatRate } : null;
      },
      damage: (amount, cause) => {
        const h = this.health;
        if (!h || !(amount > 0)) return false;
        const dead = h.damage(amount, cause || 'fall', 0);
        if (dead) this.physics.kill(this.player, this.tethers, 'impact', 0);
        return dead;
      },
      freeze: (on) => {
        this._frozen = on === undefined ? true : !!on;
        return this._frozen;
      },
      // WP-RELEASE: platform services, for tests and QA (nothing here changes play)
      platform: () => ({
        bootTimes: Object.assign({}, this.bootTimes),
        booted: this.booted,
        contentReady: this.contentReady,
        contextLost: this.contextLost,
        resilience: this.resilience ? this.resilience.report() : null,
        governor: this.governor ? this.governor.report() : null,
        entitlement: this.entitlement ? this.entitlement.info() : null,
        save: this.save && this.save.profile ? { info: this.save.store.info, continue: this.save.continueInfo() } : null,
      }),
      loseContext: () => !!(this.resilience && this.resilience.loseContext()),
      restoreContext: () => !!(this.resilience && this.resilience.restoreContext()),
      governorLevel: (n) => (this.governor ? this.governor.setLevel(n, 'debug') : -1),
      // WP-AUDIO: state() = voices, tier, music / ambience / rope / movement / creature-sync read-outs and the last events;
      // emit(type, payload) fires a bus event (QA: 'creature:clip', 'rope:slip', ...); music(kind) plays a stinger.
      audio: {
        state: () => (this.audio && typeof this.audio.debugState === 'function' ? this.audio.debugState() : null),
        emit: (type, payload) => {
          this.bus.emit(String(type), payload && typeof payload === 'object' ? payload : {});
          return true;
        },
        stinger: (kind) => !!(this.audio && this.audio._music && (this.audio._music.stinger(kind || 'sighting'), true)),
      },
    };
  }
}

// =============================================================================
// Fatal error overlay (inline styles: works even if style.css failed).
// =============================================================================
export function showFatal(err) {
  try {
    if (typeof console !== 'undefined') console.error('[AT3D] fatal', err);
    if (typeof document === 'undefined' || !document.body) return;
    let box = document.getElementById('at-fatal');
    if (!box) {
      box = document.createElement('div');
      box.id = 'at-fatal';
      box.setAttribute('role', 'alert');
      box.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;' +
        'padding:24px;background:rgba(8,10,11,0.95);color:#e8dcc0;font:16px/1.5 system-ui,-apple-system,' +
        'Segoe UI,Roboto,sans-serif;text-align:center;';
      document.body.appendChild(box);
    }
    box.textContent = '';
    const panel = document.createElement('div');
    panel.style.cssText = 'max-width:560px;';
    const title = document.createElement('h1');
    title.textContent = 'The descent could not begin.';
    title.style.cssText = 'font:600 22px/1.3 Georgia,serif;letter-spacing:0.06em;margin:0 0 12px;color:#e0a050;';
    const msg = document.createElement('p');
    msg.textContent = (err && err.message) || String(err || 'Unknown error');
    msg.style.cssText = 'margin:0 0 12px;opacity:0.9;word-break:break-word;';
    const help = document.createElement('p');
    help.textContent = 'Try reloading. A current browser with WebGL 2 is required; VR needs the Meta Quest Browser over HTTPS.';
    help.style.cssText = 'margin:0 0 18px;opacity:0.7;font-size:14px;';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Reload';
    btn.style.cssText = 'min-width:120px;min-height:44px;padding:8px 20px;border:1px solid #e0a050;background:transparent;color:#e8dcc0;font:inherit;cursor:pointer;';
    btn.addEventListener('click', () => window.location.reload());
    panel.append(title, msg, help, btn);
    box.appendChild(panel);
    const boot = document.getElementById('boot');
    if (boot) boot.style.display = 'none';
  } catch {
    /* nothing more we can do */
  }
}
