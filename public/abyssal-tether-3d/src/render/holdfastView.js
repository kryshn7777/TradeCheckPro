/* ABYSSAL TETHER 3D — holdfastView.js
 * THE HOLDFAST's view (sim/holdfast3d.js): the hand in the wall, from assets/models/holdfast.glb (tools/abyssal-tether-3d/
 * build_holdfast.py: a ~2.3 k triangle skinned hand + forearm + its masonry socket, LOD1 ~0.6 k, a static 'dormant' copy, one
 * baked atlas, ten clips authored in code).
 *
 *   - Loaded lazily in the background (load(); game.js calls it once a run starts); nothing is drawn until it arrives, and a
 *     failure leaves the sim running without a view (the patch is still marked by the missing chalk: render/climbView.js).
 *   - At most HOLDFAST_VIEW.maxLive (2) LIVE rigs (the skinned mesh, one draw call per eye: LOD0 near, LOD1 beyond lodNear),
 *     given to the sites that are awake (or within liveRange of the camera), the held one first. Every other site within
 *     showRange is ONE shared static 'dormant' look: an InstancedMesh of the fist in its socket (one call for all of them).
 *   - Posing: an AnimationMixer per live rig plays the clips (the base clip by state, crossfaded: idle, stir, reach / close scrubbed
 *     by the sim's `close`, pull, release, retract, dead, answer; squeeze additive on the beats); then the IK puts the palm on the
 *     sim's target (the held hand) with the forearm through the socket's mouth (blended by state), the 'out' slide, a tremble, the
 *     heartbeat swell. A left hand held = the rig mirrored (a left hand closes on it).
 *   - Material: the GLB's (albedo, normal, ORM: R = AO, G = roughness, B = the vein mask), vertex-colour AO, metalness forced to 0;
 *     a small shader patch darkens the veins on the heartbeat and keeps the skin wet.
 * Budget (Quest): a live rig LOD0 <= 2.6 k triangles (5.2 k stereo), the dormant look ~2.3 k per site in view, <= 2 calls per rig.
 */
import * as THREE from 'three';
import { HOLDFAST_TUNING } from '../sim/holdfast3d.js';

export const HOLDFAST_URL = new URL('../../assets/models/holdfast.glb', import.meta.url).href;

export const HOLDFAST_VIEW = {
  maxLive: 2,
  liveRange: 7, // m (camera to the site): a dormant site this close gets a live rig (the swap is invisible: the same pose)
  lodNear: { low: 2.5, quest: 3.5, high: 7 }, // m: LOD0 within, LOD1 beyond
  showRange: 55, // m: dormant sites farther than this are not drawn (the fog has them)
  forearm: 0.36, // m, the forearm bone (elbow -> wrist)
  reachMax: 0.33, // m: how far the wrist may leave the socket's mouth
  palmOff: 0.055, // m: wrist -> the palm's centre
  clasp: 0.032, // m: the palm sits this far behind the held hand (between it and the wall)
  dormantWristZ: -0.04, // m: the wrist in the dormant fist (inside the wall)
};
const V = HOLDFAST_VIEW;
const CLIP_NAMES = ['idle', 'stir', 'reach', 'close', 'squeeze', 'pull', 'release', 'retract', 'dead', 'answer'];
const BASE = ['idle', 'stir', 'reach', 'close', 'pull', 'release', 'retract', 'dead', 'answer'];
const FINGERS = ['index', 'middle', 'ring', 'pinky', 'thumb'];

// scratch (no allocation per frame)
const _q0 = new THREE.Quaternion();
const _q1 = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v0 = new THREE.Vector3();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m0 = new THREE.Matrix4();
const _m1 = new THREE.Matrix4();
const _F = new THREE.Vector3();
const _N = new THREE.Vector3();
const _S = new THREE.Vector3();
const _A = new THREE.Vector3();
const _W = new THREE.Vector3();
const _T = new THREE.Vector3();
const _Rh = new THREE.Quaternion();
const _Rf = new THREE.Quaternion();
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

function clamp(x, a, b) {
  return x < a ? a : x > b ? b : x;
}

/** Quaternion of the rotation taking the orthonormal basis (f0, n0, s0) onto (f1, n1, s1). */
function basisQuat(f1, n1, s1, f0, n0, s0, out) {
  _m0.makeBasis(f1, n1, s1);
  _m1.makeBasis(f0, n0, s0).transpose();
  _m0.multiply(_m1);
  return out.setFromRotationMatrix(_m0);
}

/** The heartbeat shape of a 0..1 phase (lub at 0, dub at 0.22). */
function beat(ph) {
  const a = Math.exp(-(((ph - 0.04) / 0.045) ** 2));
  const b = 0.6 * Math.exp(-(((ph - 0.26) / 0.05) ** 2));
  return a + b;
}

/** The shared material patch: veins darken on the heartbeat, the skin stays wet. */
function patchMaterial(mat, uniforms) {
  mat.metalness = 0;
  mat.metalnessMap = null;
  mat.vertexColors = true;
  mat.envMapIntensity = 0.55;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uHfPulse = uniforms.uHfPulse;
    shader.uniforms.uHfVein = uniforms.uHfVein;
    shader.uniforms.uHfWet = uniforms.uHfWet;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uHfPulse;\nuniform float uHfVein;\nuniform float uHfWet;')
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
#ifdef USE_ROUGHNESSMAP
  float hfVein = texture2D( roughnessMap, vRoughnessMapUv ).b;
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.42, 0.16, 0.2 ), clamp( hfVein * uHfVein * ( 0.35 + 0.65 * uHfPulse ), 0.0, 0.85 ) );
  roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.62, uHfWet );
#endif`,
      );
  };
  mat.customProgramCacheKey = () => 'at3d-holdfast';
  mat.needsUpdate = true;
  return mat;
}

/** Clones a skinned glTF scene sharing geometry / materials, re-binding the skinned meshes to the cloned bones. */
function cloneRig(source) {
  const clone = source.clone(true);
  const pairs = new Map();
  const walk = (a, b) => {
    pairs.set(a, b);
    for (let i = 0; i < a.children.length; i++) walk(a.children[i], b.children[i]);
  };
  walk(source, clone);
  const back = new Map();
  for (const [a, b] of pairs) back.set(b, a);
  clone.traverse((node) => {
    if (!node.isSkinnedMesh) return;
    const src = back.get(node);
    const bones = src.skeleton.bones.map((b) => pairs.get(b));
    node.skeleton = new THREE.Skeleton(bones, src.skeleton.boneInverses);
    node.bind(node.skeleton, src.bindMatrix);
  });
  return clone;
}

/** One live rig: a cloned skinned hand with its mixer and the bone handles the IK needs. */
class LiveRig {
  constructor(view, scene) {
    this.view = view;
    this.root = new THREE.Group();
    this.root.name = 'HoldfastRig';
    this.root.matrixAutoUpdate = false;
    this.root.visible = false;
    this.model = cloneRig(view.template);
    this.root.add(this.model);
    scene.add(this.root);
    this.site = null;
    this.mirror = false;
    this.lod0 = null;
    this.lod1 = null;
    this.bones = Object.create(null);
    this.model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isSkinnedMesh) {
        o.frustumCulled = false; // the bones move it far from its bind box; one small hand
        if (/LOD1/.test(o.name)) this.lod1 = o;
        else if (/LOD0/.test(o.name)) this.lod0 = o;
      }
      if (o.isMesh && !o.isSkinnedMesh) o.visible = false; // the static dormant copy lives in the instanced look
    });
    if (!this.lod0 || !this.bones.forearm || !this.bones.hand || !this.bones.socket) throw new Error('holdfast.glb: missing meshes / bones');
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = Object.create(null);
    this.w = Object.create(null); // current base weights (crossfaded)
    for (const name of CLIP_NAMES) {
      const clip = view.clips[name];
      if (!clip) continue;
      const a = this.mixer.clipAction(clip);
      if (name === 'squeeze') a.blendMode = THREE.AdditiveAnimationBlendMode;
      a.play();
      a.paused = true;
      a.weight = 0;
      this.actions[name] = a;
      this.w[name] = 0;
    }
    this.w.idle = 1;
    this.t = 0;
    this.lod = 0;
    // the rest pose in the rig frame (the model root has the identity): the forearm and hand rest frames, the socket frame
    this.model.updateMatrixWorld(true);
    this.restFore = this.bones.forearm.getWorldQuaternion(new THREE.Quaternion());
    this.restHand = this.bones.hand.getWorldQuaternion(new THREE.Quaternion());
    this.sockInvQ = this.bones.socket.getWorldQuaternion(new THREE.Quaternion()).invert();
    this.sockInvM = this.bones.socket.matrixWorld.clone().invert();
    // finger bones with their local flex axis (the bones roll so their local X is the flex axis)
    this.fingerBones = [];
    for (const f of FINGERS) for (let k = 1; k <= 4; k++) if (this.bones[`${f}_${k}`]) this.fingerBones.push(this.bones[`${f}_${k}`]);
    this._ikFore = { q: new THREE.Quaternion(), p: new THREE.Vector3() };
    this._ikHand = new THREE.Quaternion();
  }

  dispose() {
    this.mixer.stopAllAction();
    if (this.root.parent) this.root.parent.remove(this.root);
  }

  /** Places the rig on its site (the site frame: u = v x n, v up, n out of the wall; mirrored for a left hand). */
  place(s, mirror) {
    this.site = s;
    this.mirror = !!mirror;
    _v0.set(s.vy * s.nz - s.vz * s.ny, s.vz * s.nx - s.vx * s.nz, s.vx * s.ny - s.vy * s.nx); // u' = v x n
    _v1.set(s.vx, s.vy, s.vz);
    _v2.set(s.nx, s.ny, s.nz);
    if (this.mirror) _v0.negate();
    this.root.matrix.makeBasis(_v0, _v1, _v2);
    this.root.matrix.setPosition(s.x, s.y, s.z);
    this.root.matrixWorldNeedsUpdate = true;
  }

  update(dt, camDist, tier) {
    const s = this.site;
    if (!s) return;
    this.t += dt;
    const st = s.state;
    // ---- 1. base clip weights by state
    const want = this.view._want;
    for (const n of BASE) want[n] = 0;
    let scrub = -1;
    let scrubName = '';
    switch (st) {
      case 'AWARE':
        want.idle = 1 - s.aware * 0.85;
        want.stir = s.aware * 0.85;
        break;
      case 'GRIP':
        want.reach = 1;
        scrubName = 'reach';
        scrub = clamp(s.close / 0.7, 0, 1);
        break;
      case 'CLOSE':
        want.close = 0.72;
        want.pull = 0.28;
        scrubName = 'close';
        scrub = clamp((s.close - 0.15) / 0.85, 0, 1);
        break;
      case 'RELEASE':
      case 'STAGGER':
        want.release = 1;
        break;
      case 'RETRACT':
        want.retract = 1;
        break;
      case 'RUINED':
        want.dead = 1;
        break;
      case 'ANSWER':
        want.answer = 1;
        break;
      default:
        want.idle = 1;
    }
    let sum = 0;
    const k = Math.min(1, dt * 7);
    for (const n of BASE) {
      if (!this.actions[n]) continue;
      this.w[n] += (want[n] - this.w[n]) * k;
      if (this.w[n] < 1e-3) this.w[n] = 0;
      sum += this.w[n];
    }
    for (const n of BASE) {
      const a = this.actions[n];
      if (!a) continue;
      a.weight = sum > 0 ? this.w[n] / sum : 0;
      const dur = a.getClip().duration;
      if (n === scrubName) a.time = scrub * dur;
      else if (n === 'reach') a.time = dur;
      else if (n === 'close') a.time = 0;
      else if (n === 'release' || n === 'retract') a.time = Math.min(dur, st === 'STAGGER' ? s.t * 1.6 : s.t);
      else if (n === 'dead') a.time = Math.min(dur, s.t);
      else a.time = (this.t * (n === 'stir' ? 1 + 0.5 * s.aware : 1)) % dur;
    }
    const sq = this.actions.squeeze;
    if (sq) {
      sq.weight = st === 'CLOSE' ? s.squeeze : 0;
      sq.time = 0.143;
    }
    this.mixer.update(0);
    // ---- 2. the IK: the palm on the target, the forearm through the mouth (blended by state)
    let ik = 0;
    if (st === 'GRIP') ik = 0.85 * clamp(s.t / HOLDFAST_TUNING.closeDelay, 0, 1);
    else if (st === 'CLOSE' || st === 'RUINED' || st === 'ANSWER') ik = 1;
    else if (st === 'RELEASE') ik = 1 - 0.6 * clamp(s.t / HOLDFAST_TUNING.releaseTime, 0, 1);
    else if (st === 'STAGGER') ik = 0.5 * (1 - clamp(s.t / 0.6, 0, 1));
    this._ik = this._ik === undefined ? ik : this._ik + (ik - this._ik) * Math.min(1, dt * 6);
    const fore = this.bones.forearm;
    if (this._ik > 0.002) {
      this._solve(st);
      // blend the mixer's forearm (local) with the IK's
      _q0.copy(this._ikFore.q);
      fore.quaternion.slerp(_q0, this._ik);
      fore.position.lerp(this._ikFore.p, this._ik);
      this.bones.hand.quaternion.slerp(this._ikHand, this._ik);
    }
    // ---- 3. the slide out of / into the wall (the sim's `out`), along the socket's normal in the rig frame
    if (Math.abs(s.out) > 1e-4) {
      _v0.set(0, 0, s.out * (1 - this._ik)).applyQuaternion(this.sockInvQ);
      fore.position.add(_v0);
    }
    // ---- 4. tremble (fingers) and the heartbeat swell (the hand)
    const tr = s.tremble;
    if (tr > 0.01) {
      for (let i = 0; i < this.fingerBones.length; i++) {
        const b = this.fingerBones[i];
        const a = tr * 0.06 * Math.sin(this.t * (37 + i * 3.1) + i * 1.7);
        _q1.setFromAxisAngle(X, a);
        b.quaternion.multiply(_q1);
      }
    }
    const hb = beat(s.pulse);
    const sw = st === 'RUINED' ? 1 : 1 + (st === 'CLOSE' ? 0.022 : 0.01) * hb;
    this.bones.hand.scale.setScalar(sw);
    // ---- 5. LOD
    const near = V.lodNear[tier] || V.lodNear.quest;
    const want0 = camDist < (this.lod === 0 ? near + 0.6 : near);
    this.lod = want0 ? 0 : 1;
    this.lod0.visible = want0;
    if (this.lod1) this.lod1.visible = !want0;
    this.root.visible = true;
  }

  /** The IK targets (rig-local) per state -> this._ikFore (forearm local quaternion + position), this._ikHand (hand local). */
  _solve(st) {
    const s = this.site;
    // 1. where the palm goes and how it faces
    if (st === 'RUINED') {
      _T.set(0.01, -0.21, 0.1);
      _F.set(0.08, -1, 0.28).normalize();
      _N.set(0, 0.25, -1);
    } else if (st === 'ANSWER') {
      _T.set(0, -0.02, 0.25);
      _F.set(0, 0.12, 1).normalize();
      _N.set(0, 1, 0);
    } else {
      this._localTarget(s.tx, s.ty, s.tz, _T);
      _T.z = clamp(_T.z, 0.03, 0.32);
      // fingers: up the wall, leaning toward where the hand is from the socket
      _F.set(_T.x, _T.y + 0.1, 0);
      if (_F.lengthSq() < 0.0016) _F.set(0, 1, 0);
      _F.normalize();
      _F.z = -0.16;
      _F.normalize();
      _N.set(0, 0, 1);
      _T.z = Math.max(0.025, _T.z - V.clasp);
    }
    _N.addScaledVector(_F, -_N.dot(_F)).normalize();
    _S.crossVectors(_F, _N);
    // the hand's world (rig) rotation: rest (fingers +Z, palm -Y, thumb +X) -> (F, N, S)
    _v0.set(0, 0, 1);
    _v1.set(0, -1, 0);
    _v2.crossVectors(_v0, _v1);
    basisQuat(_F, _N, _S, _v0, _v1, _v2, _Rh);
    // 2. the wrist, clamped to the forearm's reach out of the mouth
    _W.copy(_T).addScaledVector(_F, -V.palmOff);
    const d = _W.length();
    if (d > V.reachMax) _W.multiplyScalar(V.reachMax / d);
    if (_W.z < 0.012) _W.z = 0.012;
    // 3. the forearm through the mouth (0, 0, 0): its axis A, its thumb side the hand's
    _A.copy(_W);
    if (_A.lengthSq() < 1e-4) _A.set(0, 0, 1);
    _A.normalize();
    _v0.copy(_S).addScaledVector(_A, -_S.dot(_A));
    if (_v0.lengthSq() < 1e-6) _v0.set(1, 0, 0);
    _v0.normalize();
    _v1.crossVectors(_A, _v0); // A x side = the forearm's back
    // rest forearm: axis +Z, side +X, back = Z x X = +Y
    basisQuat(_A, _v0, _v1, Z, X, Y, _Rf);
    // world quaternions = R * rest; local = parent^-1 * world
    _q0.copy(_Rf).multiply(this.restFore); // forearm world (rig)
    this._ikFore.q.copy(this.sockInvQ).multiply(_q0);
    // the elbow (the bone's head) = W - A * L, into the socket bone's space
    _v2.copy(_W).addScaledVector(_A, -V.forearm);
    this._ikFore.p.copy(_v2).applyMatrix4(this.sockInvM);
    // the hand: local = foreWorld^-1 * (Rh * restHand)
    _q1.copy(_Rh).multiply(this.restHand);
    _q2.copy(_q0).invert().multiply(_q1);
    this._ikHand.copy(_q2);
  }

  _localTarget(x, y, z, out) {
    const s = this.site;
    const dx = x - s.x;
    const dy = y - s.y;
    const dz = z - s.z;
    const ux = s.vy * s.nz - s.vz * s.ny;
    const uy = s.vz * s.nx - s.vx * s.nz;
    const uz = s.vx * s.ny - s.vy * s.nx;
    const lx = dx * ux + dy * uy + dz * uz;
    // mirrored rigs: the root flips x, so the local target flips too
    return out.set(this.mirror ? -lx : lx, dx * s.vx + dy * s.vy + dz * s.vz, dx * s.nx + dy * s.ny + dz * s.nz);
  }
}

export class HoldfastView {
  /** @param {object} game  { renderer: { scene, camera, lanternShadow? }, holdfast (sim), qualityTier? } */
  constructor(game) {
    this.game = game;
    this.scene = game && game.renderer ? game.renderer.scene : null;
    this.ready = false;
    this.failed = false;
    this.loading = false;
    this.template = null;
    this.clips = Object.create(null);
    this.rigs = [];
    this.dormant = null;
    this.uniforms = { uHfPulse: { value: 0 }, uHfVein: { value: 0.5 }, uHfWet: { value: 1 } };
    this.info = { drawCalls: 0, triangles: 0, live: 0, dormant: 0, lod: [], trianglesLod0: 0, trianglesLod1: 0, trianglesDormant: 0 };
    this._want = Object.create(null);
    this._slots = [];
    this._cam = new THREE.Vector3();
    this._mat = new THREE.Matrix4();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  /** Starts the background load (idempotent). `loaderFactory()` returns a GLTFLoader (with meshopt + KTX2 attached). */
  load(loaderFactory, url = HOLDFAST_URL) {
    if (this.loading || this.ready || this.failed || typeof loaderFactory !== 'function') return;
    this.loading = true;
    let loader;
    try {
      loader = loaderFactory();
    } catch (err) {
      this.failed = true;
      this.loading = false;
      throw err;
    }
    loader.load(
      url,
      (gltf) => {
        this.loading = false;
        try {
          this.build(gltf);
        } catch (err) {
          this.failed = true;
          if (this.onError) this.onError(err);
        }
      },
      undefined,
      (err) => {
        this.loading = false;
        this.failed = true;
        if (this.onError) this.onError(err);
      },
    );
  }

  /** Builds the rigs and the dormant look from a loaded glTF (also used by the tests with a parsed file). */
  build(gltf) {
    const scene = gltf.scene || (gltf.scenes && gltf.scenes[0]);
    if (!scene) throw new Error('holdfast.glb: no scene');
    for (const c of gltf.animations || []) this.clips[c.name] = c;
    if (this.clips.squeeze) this.clips.squeeze = THREE.AnimationUtils.makeClipAdditive(this.clips.squeeze.clone(), 0);
    let dormantMesh = null;
    let mat = null;
    scene.traverse((o) => {
      if (o.isMesh && !o.isSkinnedMesh && /Dormant/.test(o.name)) dormantMesh = o;
      if (o.isSkinnedMesh && !mat) mat = o.material;
    });
    if (!mat) throw new Error('holdfast.glb: no skinned mesh');
    patchMaterial(mat, this.uniforms);
    const ls = this.game && this.game.renderer && this.game.renderer.lanternShadow;
    if (ls && typeof ls.attach === 'function') ls.attach(mat);
    scene.traverse((o) => {
      if (o.isSkinnedMesh) {
        o.material = mat;
        const tris = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
        if (/LOD1/.test(o.name)) this.info.trianglesLod1 = tris;
        else this.info.trianglesLod0 = tris;
      }
    });
    this.template = scene;
    if (this.scene) for (let i = 0; i < V.maxLive; i++) this.rigs.push(new LiveRig(this, this.scene));
    // the dormant look: one InstancedMesh of the static fist-in-socket (sites in range packed first)
    const sim = this.game && this.game.holdfast;
    const n = Math.max(1, sim && sim.sites ? sim.sites.length : 1);
    if (dormantMesh) {
      const dm = mat.clone();
      patchMaterial(dm, this.uniforms);
      if (ls && typeof ls.attach === 'function') ls.attach(dm);
      this.dormant = new THREE.InstancedMesh(dormantMesh.geometry, dm, n);
      this.dormant.name = 'HoldfastDormant';
      this.dormant.count = 0;
      this.dormant.visible = false;
      const g = dormantMesh.geometry;
      this.info.trianglesDormant = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      if (this.scene) this.scene.add(this.dormant);
    }
    this.ready = true;
  }

  /** The frame of a site as a matrix (no mirror). */
  _siteMatrix(s, out) {
    _v0.set(s.vy * s.nz - s.vz * s.ny, s.vz * s.nx - s.vx * s.nz, s.vx * s.ny - s.vy * s.nx);
    _v1.set(s.vx, s.vy, s.vz);
    _v2.set(s.nx, s.ny, s.nz);
    out.makeBasis(_v0, _v1, _v2);
    out.setPosition(s.x, s.y, s.z);
    return out;
  }

  update(dt, game) {
    const info = this.info;
    info.drawCalls = 0;
    info.triangles = 0;
    info.live = 0;
    info.dormant = 0;
    info.lod.length = 0;
    const sim = game ? game.holdfast : null;
    const st = game ? game.state : '';
    const inRun = !!(game && game.player && !game.hidePlayer && (st === 'playing' || st === 'paused' || st === 'dead' || st === 'victory'));
    if (!this.ready || !sim || !sim.sites || !sim.enabled || !inRun) {
      for (const r of this.rigs) r.root.visible = false;
      if (this.dormant) this.dormant.visible = false;
      return;
    }
    const cam = game.renderer && game.renderer.camera;
    if (cam && typeof cam.getWorldPosition === 'function') cam.getWorldPosition(this._cam);
    else this._cam.set(game.player.x, game.player.y + 1.2, game.player.z);
    const tier = (game.settings && game.settings.qualityTier) || 'quest';
    // the shared uniforms: the heartbeat of the nearest awake site
    let best = null;
    let bd = Infinity;
    const sites = sim.sites;
    // 1. live slots: the held site, then awake ones, then the nearest within liveRange
    const slots = this._slots;
    slots.length = 0;
    for (let i = 0; i < sites.length; i++) {
      const s = sites[i];
      const d = this._cam.distanceTo(_v0.set(s.x, s.y, s.z));
      s._camD = d;
      const awake = s.state !== 'DORMANT';
      if (awake || d < V.liveRange) slots.push(s);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    slots.sort((a, b) => (sim.held === b) - (sim.held === a) || (b.state !== 'DORMANT') - (a.state !== 'DORMANT') || a._camD - b._camD);
    if (slots.length > this.rigs.length) slots.length = this.rigs.length;
    // keep a rig on the site it had (no pose pop)
    const used = this._used || (this._used = []);
    used.length = 0;
    for (const r of this.rigs) {
      if (r.site && slots.includes(r.site)) used.push(r.site);
      else r.site = null;
    }
    for (const s of slots) {
      if (used.includes(s)) continue;
      const r = this.rigs.find((x) => !x.site);
      if (!r) break;
      r.place(s, false);
      r.t = 0;
      used.push(s);
    }
    for (const r of this.rigs) {
      if (!r.site) {
        r.root.visible = false;
        continue;
      }
      const s = r.site;
      // a left hand held: the rig mirrors (decided while the fist is still a fist)
      const mirror = s.hand === 'left' ? true : s.hand === 'right' ? false : r.mirror;
      if (mirror !== r.mirror || r.root.matrixWorldNeedsUpdate) r.place(s, mirror);
      r.update(dt, s._camD, tier);
      info.live++;
      info.drawCalls++;
      info.triangles += r.lod === 0 ? info.trianglesLod0 : info.trianglesLod1;
      info.lod.push(r.lod);
    }
    // 2. the dormant look for every other site in range (dormant state only; a spent / ruined site without a rig shows nothing)
    if (this.dormant) {
      let n = 0;
      for (let i = 0; i < sites.length; i++) {
        const s = sites[i];
        if (s._camD > V.showRange || used.includes(s) || s.state !== 'DORMANT' || s.cd > 0) continue;
        this.dormant.setMatrixAt(n++, this._siteMatrix(s, this._mat));
      }
      if (n !== this.dormant.count || n > 0) {
        this.dormant.count = n;
        this.dormant.instanceMatrix.needsUpdate = true;
        if (n > 0) this.dormant.computeBoundingSphere();
      }
      this.dormant.visible = n > 0;
      if (n > 0) {
        info.drawCalls++;
        info.dormant = n;
        info.triangles += n * info.trianglesDormant;
      }
    }
    // 3. the heartbeat (veins), stronger while it holds you
    const ps = best ? best.pulse : 0;
    const k = best && best.state === 'CLOSE' ? (best.low ? 1 : 0.8) : best && best.state !== 'DORMANT' ? 0.45 : 0.25;
    this.uniforms.uHfPulse.value = beat(ps);
    this.uniforms.uHfVein.value = k;
  }

  dispose() {
    for (const r of this.rigs) r.dispose();
    this.rigs.length = 0;
    if (this.dormant) {
      if (this.dormant.parent) this.dormant.parent.remove(this.dormant);
      this.dormant.dispose();
      this.dormant = null;
    }
    this.ready = false;
  }
}
