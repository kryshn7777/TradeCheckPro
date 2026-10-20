/* ABYSSAL TETHER 3D — bodyView.js
 * The player's own body (first-person safe, NO head): a skinned adventurer-climber avatar from
 * assets/models/player_body.glb (tools/abyssal-tether-3d/build_body.py): jacket, harness, belt + pouches, backpack, knee
 * pads, boots, sleeved upper arms that end in a cuff overlapping the arms' elbow cut.
 *
 *   new BodyView(game)        game: { renderer.scene/camera, settings, player, tethers, handsView, xrActive, state }
 *   .update(dt, game)         once per frame AFTER the rig follows the player (Game3D._updateViews)
 *   .ready                    the GLB arrived and the skeleton is set up (a failed load = no body, the game plays on)
 *   .root                     THREE.Group in the scene (feet position, yaw, uniform scale)
 *   .stats                    { tris, bones, calls, clip, weights }
 *   .dispose()
 *
 * GLB (glTF y-up, the body faces -Z, origin = the floor between the feet; 22 bones):
 *   Root > Pelvis > Spine1 > Spine2 > { Neck, Clavicle_L/R > UpperArm_L/R > Forearm_L/R (stub), Pack }
 *   Pelvis > { Thigh_X > Shin_X > Foot_X > Toe_X, Pouch_X }.   Clips: Idle_Stand, Run, Hang_Swing, Fall (loops), Land (once).
 *
 * How it follows the sim (all procedural layers run after the clip mixer, no per-frame allocation):
 *   * root = the collision sphere's bottom (the feet), yaw = a lagged torso yaw (XR: slow follow so looking around does not
 *     spin the legs; desktop/moving: toward the movement direction), uniform scale from the player's measured stature.
 *   * neck base = the head pivot (head pose, ~0.11 m below/behind the eyes) minus 0.10 m: the pelvis is placed under it
 *     (leans toward it), the two spine bones are 2-bone-IK'd to it, so the body follows the real head height (XR crouch
 *     lowers the pelvis) and nothing ever sits in the camera near plane.
 *   * arms: 2-bone IK shoulder -> elbow -> the forearm stub's tip, which is pushed ~4 cm inside the arms' sleeve opening
 *     (HandsView.getElbowAnchor / getWristSocket); the elbow is placed on the side of the forearm axis (it bends naturally).
 *   * legs: clips by state (grounded speed -> Run/Idle blend, airborne -> Fall, roped airborne -> Hang_Swing, landing -> Land);
 *     while grounded the feet are IK-planted at the clip's foot positions (so a lowered pelvis bends the knees); hanging tilts
 *     the pelvis so the legs trail opposite to the velocity and lean along the rope.
 *   * the pack and the pouches get a damped spring from the body's acceleration.
 */

import * as THREE from 'three';
import { CONFIG } from '../sim/config3d.js';
import { buildGearEnvironment } from './handsView.js';
import { loadGLB } from './glbLoad.js';

const BODY_URL = new URL('../../assets/models/player_body.glb', import.meta.url).href;

const T = {
  upper: 0.3, // rest bone lengths are read from the skeleton; these are only fallbacks
  stub: 0.1,
  sleeveInset: 0.04, // the stub tip sits this far inside the arms' sleeve opening (m)
  neckDrop: 0.17, // neck base below the eyes (m)
  neckBack: 0.11, // ... and behind them (m), 0.20 when looking down (the head hangs forward of the neck)
  neckBackDown: 0.21,
  armStretch: 1.35,
  torsoLimitXr: 0.65, // rad: the torso may lag the head yaw by this much before it is dragged along
  torsoLimitDesk: 0.5,
  followXr: 2.2, // rad/s the torso catches up past the limit
  followDesk: 5,
  idleRecentre: 0.6, // rad/s drift back toward the head while standing still
  runRef: 3.2, // m/s the Run clip's strides match
  landMin: 3.0, // m/s fall speed that triggers the Land clip
  fade: 11, // clip weight fade rate (1/s)
  ikFade: 12,
  stand: 1.62, // standEye
  // Looking down pushes the feet this far forward (along the torso heading) while the neck stays under the camera: the body
  // leans back a little, so the chest, belt, thighs, knees and boots are inside the view (the desktop camera is a narrow
  // 70-degree window; a real person sees them with peripheral vision).
  shiftDesk: 0.28,
  shiftXr: 0.16,
  light: 0.5, // x the direct (lantern) light on the body: it is lit like the hands, not blown out
  env: 1.1, // image based light (the hands' lit-room reflection)
};

// scratch (module level: no allocation in update)
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
const _H = new THREE.Vector3();
const _Nt = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();
const _S = new THREE.Vector3();
const _E = new THREE.Vector3();
const _W = new THREE.Vector3();
const _A = new THREE.Vector3();
const _Tt = new THREE.Vector3();
const _Eb = new THREE.Vector3();
const _mid = new THREE.Vector3();
const _bfwd = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _M2 = new THREE.Matrix4();
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
const _qc = new THREE.Quaternion();
const _qh = new THREE.Quaternion();
const _down = new THREE.Vector3(0, -1, 0);
const _Y = new THREE.Vector3(0, 1, 0);

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const sstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const wrapPi = (a) => {
  a %= Math.PI * 2;
  if (a > Math.PI) a -= Math.PI * 2;
  else if (a < -Math.PI) a += Math.PI * 2;
  return a;
};

function worldQuat(o, out) {
  _m.extractRotation(o.matrixWorld);
  return out.setFromRotationMatrix(_m);
}

export class BodyView {
  constructor(game) {
    this.game = game;
    this.ready = false;
    this.failed = false;
    this.root = new THREE.Group();
    this.root.name = 'AT3D-body';
    this.root.visible = false;
    this.stats = { tris: 0, bones: 0, calls: 0, clip: '', weights: {} };
    this.bones = {};
    this.rest = {};
    this.mixer = null;
    this.actions = {};
    this.w = { Idle_Stand: 1, Run: 0, Hang_Swing: 0, Fall: 0, Land: 0 };
    this.mesh = null;
    this._disposed = false;
    this._shown = false;
    this._yaw = 0;
    this._stillT = 0;
    this._ikW = 1;
    this._hangW = 0;
    this._airT = 0;
    this._wasAir = false;
    this._airVy = 0;
    this._landT = -1;
    this._runDir = 1;
    this._stature = 0;
    this._k = 1;
    this._shift = 0;
    this._fill = 0;
    this._lastX = 0;
    this._lastZ = 0;
    this._pvx = 0;
    this._pvz = 0;
    this._pvy = 0;
    // pack / pouch springs: [angle x, angle z, velocity x, velocity z]
    this._spr = { pack: [0, 0, 0, 0], pouchL: [0, 0, 0, 0], pouchR: [0, 0, 0, 0] };
    this._fk = {};
    this._footP = [new THREE.Vector3(), new THREE.Vector3()];
    this._footQ = [new THREE.Quaternion(), new THREE.Quaternion()];
    this._ropeDir = new THREE.Vector3();
    this._acc = new THREE.Vector3();
    this.loading = this._load();
  }

  _load() {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return Promise.resolve(false);
    return loadGLB(BODY_URL)
      .then((gltf) => {
        this._setup(gltf);
        return true;
      })
      .catch((err) => {
        this.failed = true;
        this.error = err;
        if (typeof console !== 'undefined') console.warn('[AT3D] body model unavailable, no player body', err);
        return false;
      });
  }

  _setup(gltf) {
    if (this._disposed) return;
    const scene = gltf.scene;
    let mesh = null;
    scene.traverse((o) => {
      if (o.isSkinnedMesh && !mesh) mesh = o;
    });
    if (!mesh) throw new Error('player_body.glb has no skinned mesh');
    const bones = {};
    for (const b of mesh.skeleton.bones) bones[b.name] = b;
    for (const n of ['Root', 'Pelvis', 'Spine1', 'Spine2', 'Neck', 'Thigh_L', 'Thigh_R', 'Shin_L', 'Shin_R', 'Foot_L', 'Foot_R', 'UpperArm_L', 'UpperArm_R', 'Forearm_L', 'Forearm_R']) {
      if (!bones[n]) throw new Error(`player_body.glb: bone ${n} missing`);
    }
    this.bones = bones;
    this.mesh = mesh;
    mesh.frustumCulled = false; // bind-pose bounds are wrong for a posed skin
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    this._lightU = { value: T.light };
    const hvEnv = this.game.handsView && this.game.handsView._gearEnv;
    let env = hvEnv || null;
    if (!env) {
      try {
        const r = this.game.renderer && this.game.renderer.renderer;
        if (r && typeof r.getContext === 'function') {
          env = buildGearEnvironment(r);
          this._ownEnv = env;
        }
      } catch {
        env = null;
      }
    }
    for (const m of mats) {
      m.side = THREE.FrontSide;
      const u = this._lightU;
      m.onBeforeCompile = (shader) => {
        shader.uniforms.uBodyLight = u;
        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', '#include <common>\nuniform float uBodyLight;')
          .replace('#include <lights_fragment_end>', '#include <lights_fragment_end>\n\treflectedLight.directDiffuse *= uBodyLight;\n\treflectedLight.directSpecular *= uBodyLight;');
      };
      m.customProgramCacheKey = () => 'at3d-body-light';
      if (env) {
        m.envMap = env.texture;
        m.envMapIntensity = T.env;
      }
      m.needsUpdate = true;
    }
    // rest data
    scene.updateMatrixWorld(true);
    const rest = {};
    for (const n of Object.keys(bones)) {
      const b = bones[n];
      rest[n] = { q: b.quaternion.clone(), p: b.position.clone(), s: b.scale.clone(), wq: worldQuat(b, new THREE.Quaternion()) };
    }
    const axisOf = (n, child) => {
      // the bone's axis in its own frame: toward its child (rest)
      return bones[child].position.clone().normalize();
    };
    const ax = {
      Spine1: axisOf('Spine1', 'Spine2'),
      Spine2: axisOf('Spine2', 'Neck'),
    };
    for (const s of ['L', 'R']) {
      ax[`Thigh_${s}`] = axisOf(`Thigh_${s}`, `Shin_${s}`);
      ax[`Shin_${s}`] = axisOf(`Shin_${s}`, `Foot_${s}`);
      ax[`UpperArm_${s}`] = axisOf(`UpperArm_${s}`, `Forearm_${s}`);
      // the stub continues the upper arm's direction: its axis in its own frame from the world rest direction
      const d = new THREE.Vector3().setFromMatrixPosition(bones[`Forearm_${s}`].matrixWorld).sub(_v.setFromMatrixPosition(bones[`UpperArm_${s}`].matrixWorld)).normalize();
      ax[`Forearm_${s}`] = d.applyQuaternion(rest[`Forearm_${s}`].wq.clone().invert());
    }
    this.axis = ax;
    this.len = {
      spine1: bones.Spine2.position.length(),
      spine2: bones.Neck.position.length(),
      thigh: bones.Shin_R.position.length(),
      shin: bones.Foot_R.position.length(),
      upper: bones.Forearm_R.position.length() || T.upper,
      stub: T.stub,
      spineOff: bones.Spine1.position.clone(), // in the pelvis frame
      ankle: bones.Foot_R.matrixWorld.elements[13] || 0.095,
    };
    this.rest = rest;
    this.root.add(scene);
    // clips
    this.mixer = new THREE.AnimationMixer(scene);
    for (const clip of gltf.animations) {
      const a = this.mixer.clipAction(clip);
      a.enabled = true;
      a.setEffectiveWeight(0);
      if (clip.name === 'Land') {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      } else {
        a.setLoop(THREE.LoopRepeat, Infinity);
      }
      a.play();
      this.actions[clip.name] = a;
    }
    if (this.actions.Idle_Stand) this.actions.Idle_Stand.setEffectiveWeight(1);
    for (const s of ['L', 'R']) {
      this._fk[`Thigh_${s}`] = new THREE.Quaternion();
      this._fk[`Shin_${s}`] = new THREE.Quaternion();
      this._fk[`Foot_${s}`] = new THREE.Quaternion();
    }
    let tris = 0;
    const g = mesh.geometry;
    tris = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
    this.stats.tris = tris;
    this.stats.bones = mesh.skeleton.bones.length;
    this.stats.calls = 1;
    const sc = this.game.renderer && this.game.renderer.scene;
    if (sc) sc.add(this.root);
    this.ready = true;
    // compile the program now (still on the menu / the loading frames), not on the first frame it is seen
    try {
      const r = this.game.renderer;
      this.root.visible = true;
      if (r && r.renderer && typeof r.renderer.compile === 'function') r.renderer.compile(this.root, r.camera, sc);
    } catch {
      /* compiled lazily on first draw */
    }
    this.root.visible = false;
  }

  dispose() {
    this._disposed = true;
    if (this.root.parent) this.root.parent.remove(this.root);
    if (this._ownEnv && this._ownEnv.dispose) this._ownEnv.dispose();
    if (this.mesh) {
      this.mesh.geometry.dispose();
      const mats = Array.isArray(this.mesh.material) ? this.mesh.material : [this.mesh.material];
      for (const m of mats) {
        for (const k of ['map', 'normalMap', 'aoMap', 'roughnessMap', 'metalnessMap']) if (m[k]) m[k].dispose();
        m.dispose();
      }
    }
  }

  _shouldShow(game) {
    const s = game.settings;
    if (s && s.showBody === false) return false;
    const st = game.state;
    if (st !== 'playing' && st !== 'paused' && st !== 'dead' && st !== 'victory') return false;
    return !!game.player;
  }

  // ---------------------------------------------------------------------------------------------
  update(dt, game) {
    if (!this.ready) return;
    const show = this._shouldShow(game);
    if (!show) {
      this.root.visible = false;
      this._shown = false;
      return;
    }
    const p = game.player;
    const r = game.renderer;
    if (!r || !r.camera || !(dt >= 0)) return;
    dt = Math.min(dt, 0.1);
    const cam = r.camera;
    cam.updateWorldMatrix(true, false);
    _H.setFromMatrixPosition(cam.matrixWorld);
    worldQuat(cam, _qh);
    _fwd.set(0, 0, -1).applyQuaternion(_qh);
    _up.set(0, 1, 0).applyQuaternion(_qh);
    let headYaw;
    if (Math.abs(_fwd.y) < 0.9) headYaw = Math.atan2(-_fwd.x, -_fwd.z);
    else if (_fwd.y < 0) headYaw = Math.atan2(-_up.x, -_up.z);
    else headYaw = Math.atan2(_up.x, _up.z);
    const R = CONFIG.player.radius;
    const feetY = p.ry - R;
    const first = !this._shown;
    this._shown = true;
    if (first || Math.abs(p.rx - this._lastX) + Math.abs(p.rz - this._lastZ) > 3) {
      this._yaw = headYaw;
      this._ikW = p.grounded ? 1 : 0;
      this._airT = 0;
      this._wasAir = false;
      this._landT = -1;
      this._pvx = p.vx;
      this._pvz = p.vz;
      this._pvy = p.vy;
      for (const k of Object.keys(this._spr)) this._spr[k].fill(0);
    }
    this._lastX = p.rx;
    this._lastZ = p.rz;
    this.root.visible = true;

    const xr = !!game.xrActive;
    const vx = p.vx;
    const vz = p.vz;
    const speedH = Math.sqrt(vx * vx + vz * vz);

    // ---- stature (uniform scale) ----
    let k = 1;
    if (xr) {
      const eyeH = _H.y - feetY;
      const set = game.settings;
      let st = set && set.heightMeasured > 0 ? set.heightMeasured : 0;
      if (!st) {
        if (p.grounded && Math.abs(p.vy) < 0.6 && eyeH > 1.2 && eyeH < 2.2) {
          this._stature = this._stature > 0 ? Math.max(this._stature - 0.004 * dt, eyeH) : eyeH;
        }
        st = this._stature || T.stand;
      }
      k = clamp(st / T.stand, 0.88, 1.15);
    }
    this._k += (k - this._k) * Math.min(1, dt * 3);
    k = this._k;

    // ---- torso yaw ----
    const limit = xr ? T.torsoLimitXr : T.torsoLimitDesk;
    const follow = xr ? T.followXr : T.followDesk;
    let d = wrapPi(headYaw - this._yaw);
    if (Math.abs(d) > limit) this._yaw = wrapPi(this._yaw + (d - Math.sign(d) * limit) * Math.min(1, dt * follow));
    const moving = p.grounded && speedH > 1.0;
    if (moving) {
      const moveYaw = Math.atan2(-vx, -vz);
      const rel = wrapPi(moveYaw - headYaw);
      let target;
      if (Math.abs(rel) < 1.75) {
        target = headYaw + clamp(rel, -0.9, 0.9);
        this._runDir = 1;
      } else {
        target = headYaw + clamp(wrapPi(rel + (rel > 0 ? -Math.PI : Math.PI)), -0.9, 0.9); // backpedal: legs run backwards
        this._runDir = -1;
      }
      this._yaw = wrapPi(this._yaw + wrapPi(target - this._yaw) * Math.min(1, dt * 9));
      this._stillT = 0;
    } else {
      this._runDir = 1;
      this._stillT += dt;
      if (this._stillT > 0.5) this._yaw = wrapPi(this._yaw + wrapPi(headYaw - this._yaw) * Math.min(1, dt * T.idleRecentre));
    }

    // ---- look-down forward shift ----
    const pitchDown = Math.asin(clamp(-_fwd.y, -1, 1));
    const shT = (xr ? T.shiftXr : T.shiftDesk) * sstep(0.3, 1.1, pitchDown);
    this._shift += (shT - this._shift) * Math.min(1, dt * 9);
    if (first) this._shift = shT;

    // ---- clip selection ----
    if (!p.grounded) {
      this._airT += dt;
      this._airVy = Math.min(this._airVy, p.vy);
    } else {
      if (this._wasAir && this._airVy < -T.landMin && this._airT > 0.2) this._landT = 0;
      this._airT = 0;
      this._airVy = 0;
    }
    const air = !p.grounded && this._airT > 0.08;
    this._wasAir = air;
    const th = game.tethers;
    _ropeAccum(this, th, p, game.climb);
    const ropes = this._ropes;
    const wt = this._wt || (this._wt = { Idle_Stand: 0, Run: 0, Hang_Swing: 0, Fall: 0, Land: 0 });
    wt.Idle_Stand = wt.Run = wt.Hang_Swing = wt.Fall = wt.Land = 0;
    if (air) {
      if (ropes > 0) wt.Hang_Swing = 1;
      else wt.Fall = 1;
    } else {
      const rw = sstep(0.35, 1.9, speedH);
      wt.Run = rw;
      wt.Idle_Stand = 1 - rw;
    }
    if (this._landT >= 0) {
      this._landT += dt;
      const lw = this._landT < 0.5 ? 1 : 1 - sstep(0.5, 0.72, this._landT);
      if (this._landT > 0.75) this._landT = -1;
      const la = this.actions.Land;
      if (la && this._landT >= 0 && this._landT - dt <= 0) la.reset().play();
      for (const n of ['Idle_Stand', 'Run', 'Hang_Swing', 'Fall']) wt[n] *= 1 - lw;
      wt.Land = lw;
    }
    const f = Math.min(1, dt * T.fade);
    for (const n of Object.keys(wt)) {
      this.w[n] += (wt[n] - this.w[n]) * f;
      const a = this.actions[n];
      if (a) a.setEffectiveWeight(this.w[n] < 0.001 ? 0 : this.w[n]);
    }
    if (this.actions.Run) this.actions.Run.setEffectiveTimeScale(clamp(speedH / T.runRef, 0.5, 1.9) * this._runDir);
    this._ikW += ((p.grounded || !air ? 1 : 0) - this._ikW) * Math.min(1, dt * T.ikFade);
    this._hangW += ((air && ropes > 0 ? 1 : 0) - this._hangW) * Math.min(1, dt * 8);
    this.mixer.update(dt);

    // ---- root ----
    const root = this.root;
    _bfwd.set(-Math.sin(this._yaw), 0, -Math.cos(this._yaw));
    root.position.set(p.rx + _bfwd.x * this._shift, feetY, p.rz + _bfwd.z * this._shift);
    root.rotation.set(0, this._yaw, 0);
    root.scale.setScalar(k);
    root.updateMatrixWorld(true);
    _bfwd.set(-Math.sin(this._yaw), 0, -Math.cos(this._yaw));

    const B = this.bones;
    const rs = this.rest;
    // foot targets = the clip's planted feet (before the pelvis moves)
    if (this._ikW > 0.002) {
      const gy = feetY + this.len.ankle * k;
      for (let i = 0; i < 2; i++) {
        const fb = B[i === 0 ? 'Foot_L' : 'Foot_R'];
        this._footP[i].setFromMatrixPosition(fb.matrixWorld);
        if (this._footP[i].y < gy) this._footP[i].y = gy;
        worldQuat(fb, this._footQ[i]);
      }
    }
    // reset the layers the sim drives
    for (const n of ['Spine1', 'Spine2', 'Neck', 'Clavicle_L', 'Clavicle_R', 'UpperArm_L', 'UpperArm_R', 'Forearm_L', 'Forearm_R']) {
      if (!B[n]) continue;
      B[n].quaternion.copy(rs[n].q);
      B[n].scale.copy(rs[n].s);
    }
    const pel = B.Pelvis;
    // hanging: the legs trail opposite to the velocity and lean along the rope
    if (this._hangW > 0.01) {
      _v.copy(_down).multiplyScalar(0.55);
      if (this._ropeDir.lengthSq() > 0.01) _v.addScaledVector(this._ropeDir, 0.45);
      if (speedH > 0.2) {
        const trail = clamp(speedH * 0.075, 0, 0.62) / speedH;
        _v.x -= vx * trail;
        _v.z -= vz * trail;
      }
      _v.normalize();
      _qa.setFromUnitVectors(_down, _v);
      _qb.identity().slerp(_qa, this._hangW);
      worldQuat(pel, _qa);
      _qa.premultiply(_qb);
      worldQuat(pel.parent, _qc).invert();
      pel.quaternion.copy(_qc).multiply(_qa);
    }
    pel.position.copy(rs.Pelvis.p);
    pel.updateMatrixWorld(true);

    // ---- neck base target ----
    const back = T.neckBack + (T.neckBackDown - T.neckBack) * sstep(0.3, 1.1, pitchDown);
    _Nt.set(_H.x + Math.sin(headYaw) * back, _H.y - T.neckDrop - 0.02 * sstep(0.3, 1.1, pitchDown), _H.z + Math.cos(headYaw) * back);
    // pelvis under it
    const Ls = (this.len.spine1 + this.len.spine2) * k;
    _S.set(root.position.x, 0, root.position.z);
    const px = _S.x + (_Nt.x - _S.x) * 0.62;
    const pz = _S.z + (_Nt.z - _S.z) * 0.62;
    const hxz2 = (_Nt.x - px) * (_Nt.x - px) + (_Nt.z - pz) * (_Nt.z - pz);
    let py = _Nt.y - Math.sqrt(Math.max(0.0004, Ls * Ls - hxz2));
    // the legs must reach the planted feet: hip (0.08 below Spine1's head) to ankle <= leg length
    const legL = (this.len.thigh + this.len.shin) * k * 0.985;
    const dxz2 = (px - _S.x) * (px - _S.x) + (pz - _S.z) * (pz - _S.z);
    const reachY = feetY + (this.len.ankle + 0.08) * k + Math.sqrt(Math.max(0.01, legL * legL - dxz2));
    if (this._ikW > 0.5 && py > reachY) py = reachY;
    py = clamp(py, feetY + 0.3 * k, feetY + 1.04 * k);
    // pelvis bone position so that Spine1's head lands on (px, py, pz)
    worldQuat(pel, _qa);
    _v.copy(this.len.spineOff).multiplyScalar(k).applyQuaternion(_qa);
    _v2.set(px, py, pz).sub(_v);
    pel.parent.worldToLocal(_v2);
    pel.position.copy(_v2);
    pel.updateMatrixWorld(true);

    // ---- spine 2-bone IK: Spine1 head -> Neck head ----
    _A.setFromMatrixPosition(B.Spine1.matrixWorld);
    _solve2(_A, _Nt, this.len.spine1 * k, this.len.spine2 * k, _bfwd, _mid, _Tt);
    this._aim(B.Spine1, this.axis.Spine1, _v.subVectors(_mid, _A));
    this._aim(B.Spine2, this.axis.Spine2, _v.subVectors(_Tt, _mid));

    // ---- arms ----
    for (let i = 0; i < 2; i++) this._arm(game, i === 0 ? 'left' : 'right', i === 0 ? 'L' : 'R', k);

    // ---- legs ----
    if (this._ikW > 0.002) for (let i = 0; i < 2; i++) this._leg(i, i === 0 ? 'L' : 'R', k);

    // ---- pack / pouches: damped springs from the body's acceleration ----
    this._secondary(dt, p, B);
    this.root.updateMatrixWorld(true);
    this.stats.clip = air ? (ropes > 0 ? 'Hang_Swing' : 'Fall') : speedH > 0.5 ? 'Run' : 'Idle_Stand';
    this.stats.weights = this.w;
  }

  /** Swing-only rotation of `bone` so that its axis (bone frame) points along `dirW` (world). */
  _aim(bone, axisLocal, dirW) {
    if (dirW.lengthSq() < 1e-10) return;
    _v3.copy(dirW).normalize();
    worldQuat(bone, _qa);
    _v4.copy(axisLocal).applyQuaternion(_qa);
    _qb.setFromUnitVectors(_v4, _v3);
    _qa.premultiply(_qb);
    worldQuat(bone.parent, _qc).invert();
    bone.quaternion.copy(_qc).multiply(_qa);
    bone.updateMatrixWorld(true);
  }

  _arm(game, hand, s, k) {
    const B = this.bones;
    const up = B[`UpperArm_${s}`];
    const fo = B[`Forearm_${s}`];
    const hv = game.handsView;
    let ok = false;
    if (hv && typeof hv.getElbowAnchor === 'function') {
      try {
        ok = hv.getElbowAnchor(hand, _E) && hv.getWristSocket(hand, _M2);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      _W.setFromMatrixPosition(_M2);
      _v.subVectors(_E, _W);
      if (_v.lengthSq() < 1e-8) ok = false;
      else _v.normalize();
    }
    if (!ok) {
      // plausible elbow: 0.27 m behind the grip along the controller's back axis
      const inp = game.input;
      if (!inp || typeof inp.handPose !== 'function') return;
      const hp = inp.handPose(hand);
      _qa.set(hp.qx, hp.qy, hp.qz, hp.qw);
      _v.set(0, 0.17, 0.97).applyQuaternion(_qa).normalize();
      _E.set(hp.x, hp.y, hp.z).addScaledVector(_v, 0.3);
    }
    // _v = unit forearm axis from the wrist toward the elbow end (a)
    _S.setFromMatrixPosition(up.matrixWorld);
    _Tt.copy(_E).addScaledVector(_v, -T.sleeveInset); // stub tip, inside the sleeve
    const Lu = this.len.upper * k;
    const Ls = this.len.stub * k;
    const dx = _Tt.x - _S.x;
    const dy = _Tt.y - _S.y;
    const dz = _Tt.z - _S.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-4;
    let sy = 1;
    if (d > (Lu + Ls) * 0.995) sy = Math.min(T.armStretch, (d * 0.995 - Ls) / Lu);
    const Le = Lu * sy;
    const dd = clamp(d, Math.abs(Le - Ls) + 0.012, Le + Ls - 0.0005);
    _A.set(dx / d, dy / d, dz / d); // u
    const a = _v;
    const au = a.x * _A.x + a.y * _A.y + a.z * _A.z;
    // pole: the elbow sits on the side of the forearm's backward axis, biased down and outward
    _v2.set(a.x - _A.x * au, a.y - _A.y * au, a.z - _A.z * au);
    const out = s === 'R' ? 1 : -1;
    _v3.set(0, -1, 0);
    _v3.addScaledVector(_A, -(_v3.dot(_A)));
    _v2.addScaledVector(_v3, 0.45);
    _v4.set(-_bfwd.z, 0, _bfwd.x).multiplyScalar(out); // body right (or left) in the horizontal plane
    _v4.addScaledVector(_A, -(_v4.dot(_A)));
    _v2.addScaledVector(_v4, 0.3);
    if (_v2.lengthSq() < 1e-6) _v2.set(0, -1, 0);
    _v2.normalize();
    const x = (dd * dd + Le * Le - Ls * Ls) / (2 * dd);
    const y = Math.sqrt(Math.max(0, Le * Le - x * x));
    _Eb.copy(_S).addScaledVector(_A, x).addScaledVector(_v2, y);
    // aim the upper arm, stretch it if needed (the stub counter-scales), aim the stub at the (clamped) tip
    _mid.copy(_S).addScaledVector(_A, dd);
    this._aim(up, this.axis[`UpperArm_${s}`], _v3.subVectors(_Eb, _S));
    if (sy > 1.001) {
      up.scale.set(1, sy, 1);
      fo.scale.set(1, 1 / sy, 1);
      up.updateMatrixWorld(true);
    }
    this._aim(fo, this.axis[`Forearm_${s}`], _v3.subVectors(_mid, _Eb));
  }

  _leg(i, s, k) {
    const B = this.bones;
    const th = B[`Thigh_${s}`];
    const sh = B[`Shin_${s}`];
    const ft = B[`Foot_${s}`];
    const w = this._ikW;
    const fk = this._fk;
    fk[`Thigh_${s}`].copy(th.quaternion);
    fk[`Shin_${s}`].copy(sh.quaternion);
    fk[`Foot_${s}`].copy(ft.quaternion);
    _A.setFromMatrixPosition(th.matrixWorld);
    _Tt.copy(this._footP[i]);
    // pole: knees forward (a little outward)
    _v.copy(_bfwd);
    _solve2(_A, _Tt, this.len.thigh * k, this.len.shin * k, _v, _mid, _Eb);
    this._aim(th, this.axis[`Thigh_${s}`], _v2.subVectors(_mid, _A));
    this._aim(sh, this.axis[`Shin_${s}`], _v2.subVectors(_Eb, _mid));
    // foot: keep the clip's world orientation
    worldQuat(ft.parent, _qc).invert();
    ft.quaternion.copy(_qc).multiply(this._footQ[i]);
    if (w < 0.999) {
      for (const [bn, bone] of [[`Thigh_${s}`, th], [`Shin_${s}`, sh], [`Foot_${s}`, ft]]) {
        _qa.copy(bone.quaternion);
        bone.quaternion.copy(fk[bn]).slerp(_qa, w);
      }
    }
    th.updateMatrixWorld(true);
  }

  _secondary(dt, p, B) {
    // acceleration in the body frame
    const inv = dt > 1e-4 ? 1 / dt : 0;
    const ax = (p.vx - this._pvx) * inv;
    const az = (p.vz - this._pvz) * inv;
    const ay = (p.vy - this._pvy) * inv;
    this._pvx = p.vx;
    this._pvz = p.vz;
    this._pvy = p.vy;
    const c = Math.cos(this._yaw);
    const sn = Math.sin(this._yaw);
    // forward = (-sin, -cos); right = (cos, -sin)
    const accF = clamp(ax * -sn + az * -c, -40, 40);
    const accR = clamp(ax * c - az * sn, -40, 40);
    const accU = clamp(ay, -40, 40);
    const drive = (st, kf, kr, stiff, damp, lim) => {
      // st = [ax, az, vx, vz]; angle about the body's X (pitch) and Z (roll)
      const tx = clamp(kf * accF + 0.002 * accU, -lim, lim);
      const tz = clamp(-kr * accR, -lim, lim);
      st[2] += (stiff * (tx - st[0]) - damp * st[2]) * dt;
      st[3] += (stiff * (tz - st[1]) - damp * st[3]) * dt;
      st[0] += st[2] * dt;
      st[1] += st[3] * dt;
    };
    drive(this._spr.pack, 0.012, 0.01, 90, 7, 0.22);
    drive(this._spr.pouchL, 0.02, 0.02, 70, 5, 0.5);
    drive(this._spr.pouchR, 0.02, 0.02, 70, 5, 0.5);
    // fullness: the bag's items fill the pack (a flat empty satchel -> a stuffed one), eased
    const bag = this.game.bag;
    if (bag && bag.counts && B.Pack) {
      let have = 0;
      for (let i = 0; i < bag.counts.length; i++) have += bag.counts[i];
      this._fill += (Math.min(1, have / 6) - this._fill) * Math.min(1, dt * 4);
      B.Pack.scale.setScalar(this.rest.Pack.s.x * (0.93 + 0.1 * this._fill));
    }
    this._swing(B.Pack, this._spr.pack);
    this._swing(B.Pouch_L, this._spr.pouchL);
    this._swing(B.Pouch_R, this._spr.pouchR);
  }

  _swing(bone, st) {
    if (!bone) return;
    // rotation about the body's right axis (pitch) and forward axis (roll), in world space, applied on top of the pose
    _v.set(Math.cos(this._yaw), 0, -Math.sin(this._yaw)); // right
    _v2.set(-Math.sin(this._yaw), 0, -Math.cos(this._yaw)); // forward
    _qa.setFromAxisAngle(_v, st[0]);
    _qb.setFromAxisAngle(_v2, st[1]);
    _qa.multiply(_qb);
    worldQuat(bone, _qb);
    _qb.premultiply(_qa);
    worldQuat(bone.parent, _qc).invert();
    bone.quaternion.copy(_qc).multiply(_qb);
    bone.updateMatrix();
  }
}

/** Counts the attached ropes and the mean unit direction anchor -> player (into view._ropeDir). */
function _ropeAccum(view, th, p, climb) {
  view._ropes = 0;
  view._ropeDir.set(0, 0, 0);
  // WP-CLIMB: a body hanging from a hold on the wall dangles like one on a rope: each gripping hand counts as a line from its
  // hold (the legs trail below it, the pelvis leans along it).
  if (climb && climb.holding) {
    for (const h of ['left', 'right']) {
      const st = climb.hands[h];
      if (!st.gripping) continue;
      view._ropes++;
      _v.set(p.rx - st.ax, p.ry - st.ay, p.rz - st.az);
      const l = _v.length();
      if (l > 0.05) view._ropeDir.addScaledVector(_v, 1 / l);
    }
  }
  if (!th || !th.hands) {
    if (view._ropes > 1) view._ropeDir.multiplyScalar(1 / view._ropes);
    return;
  }
  for (const h of ['left', 'right']) {
    const rope = th.hands[h] && th.hands[h].rope;
    if (!rope || !rope.attached || !rope.anchor) continue;
    view._ropes++;
    _v.set(p.rx - rope.anchor.x, p.ry - rope.anchor.y, p.rz - rope.anchor.z);
    const l = _v.length();
    if (l > 0.05) view._ropeDir.addScaledVector(_v, 1 / l);
  }
  if (view._ropes > 1) view._ropeDir.multiplyScalar(1 / view._ropes);
}

/**
 * Two-bone IK: start A, target T, lengths l1 (A->mid) and l2 (mid->tip). `pole` is the direction the middle joint
 * prefers (any vector). Writes the middle joint into `outMid` and the reachable tip into `outTip`.
 */
function _solve2(A, Tg, l1, l2, pole, outMid, outTip) {
  const dx = Tg.x - A.x;
  const dy = Tg.y - A.y;
  const dz = Tg.z - A.z;
  let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1e-5) {
    outMid.copy(A).addScaledVector(pole, l1);
    outTip.copy(A);
    return;
  }
  const ux = dx / d;
  const uy = dy / d;
  const uz = dz / d;
  d = clamp(d, Math.abs(l1 - l2) + 0.004, l1 + l2 - 0.0008);
  const x = (d * d + l1 * l1 - l2 * l2) / (2 * d);
  const y = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  const pu = pole.x * ux + pole.y * uy + pole.z * uz;
  let px = pole.x - ux * pu;
  let py = pole.y - uy * pu;
  let pz = pole.z - uz * pu;
  let pl = Math.sqrt(px * px + py * py + pz * pz);
  if (pl < 1e-5) {
    // pole parallel to the axis: any perpendicular
    px = -uz;
    py = 0;
    pz = ux;
    pl = Math.sqrt(px * px + pz * pz) || 1;
  }
  px /= pl;
  py /= pl;
  pz /= pl;
  outMid.set(A.x + ux * x + px * y, A.y + uy * x + py * y, A.z + uz * x + pz * y);
  outTip.set(A.x + ux * d, A.y + uy * d, A.z + uz * d);
}
