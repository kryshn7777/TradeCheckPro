/* ABYSSAL TETHER 3D — masonRigView.js
 * MasonRigView — the rigged, skinned, animated Mason (assets/models/mason_rig.glb, built by tools/abyssal-tether-3d/build_mason_rig.py)
 * on the simulation's body (Creature3D.body). Same public API as CreatureView (constructor(scene, gltf, options), update(creature, dt,
 * camera), setTextures, info, dispose) plus bindBus(bus) and isRig. game.js loads it asynchronously and keeps the kit CreatureView
 * as the automatic fallback: any error while constructing or updating this view hands the creature back to the kit.
 *
 *   - Skeleton: 170 bones: neck, spine_00..17 (one per sim block), tail_0/1, the crown subtree (crown, portal archivolts, combs,
 *     ventral hinges, gullet rings, 7 pits, 5 stone arms x 2) and 36 legs (10 lead, 26 follower). LOD0 (<= 60 k tris) and LOD1
 *     (<= 25 k) share the skeleton and the two atlases; 4 draw calls per LOD.
 *   - Procedural layers (zero allocation): the spine follows the sim's body (one bone per block, per-bone scale from the link
 *     lengths), the crown aims at the sound with a spring (lag + overshoot), the head is shrunk / lifted to fit the shaft
 *     (HeadFit), lead legs IK to the sim's planted hooks, follower legs walk a metachronal gait whose clock advances with the
 *     distance travelled (MasonLegs), a damped spring chain adds the travelling wave / inertia / load bob / wind-up coil
 *     (BodyMotion), feet landings and the body's wake throw ground dust (CreatureDust, bindDust).
 *   - Clips: AnimationMixer; the clip graph (mason/masonClipGraph.js, pure) maps sim state to weights; the attack clips are
 *     scrubbed by the sim's own timer (phase lock) and the parametric clips by body.listen / lunge / frondOpen / glow.
 *   - Bus: `creature:clip` {name, event, t, x, y, z} at the clip event times (audio sync).
 *
 * Debug (AT3D.debug.creature): view.debug.place / clear / play / pose / state.
 */
import * as THREE from 'three';
import { ADDITIVE_CLIPS, BASE_CLIPS, ClipGraph, PARAM_CLIPS } from './mason/masonClipGraph.js';
import { HeadFit, headExtents } from './mason/masonFit.js';
import { GAIT_MASON, GAIT_SKITTER, MasonLegs } from './mason/masonLegs.js';
import { BodyMotion, MOTION_MASON, MOTION_SKITTER } from './mason/masonMotion.js';
import { sectionWet } from './creatureDust.js';
import { makeMasonUniforms, patchMasonMaterial } from './mason/masonMaterial.js';
import { cloneRigged } from './mason/skitterClone.js';
import { makeSkitterUniforms, patchSkitterMaterial } from './mason/skitterMaterial.js';
import { clamp, computeFrames, mul3, quat3, sectionHeadScale } from './mason/masonPose.js';

const DEFAULTS = {
  lodDistance: 38, // nearest spine point -> camera: beyond this the LOD1 mesh shows
  lodHysteresis: 5,
  hideDistance: 260,
  glowPierce: 0.35,
  sightingFogCap: 0.55,
  variant: '', // 'skitter': a small red clone sharing the Mason's geometry / clips (WP-SKITTER)
  size: 1,
  clipRate: 1, // mixer speed (the skitterling twitches 1.5x faster)
  twitch: 0, // procedural quiver amplitude (fraction of the link length)
  farDistance: 40, // beyond this the pose is refreshed every 2nd frame (CPU LOD; the haze has hidden all but the glow well before 40 m)
  // Beyond the fog's far distance + this margin (m, nearest spine point) only the emissive mesh is drawn: the stone and the crown have
  // no emissive, so there they shade to the pure fog colour and cannot be seen; the glow (uGlowPierce) still shows through the haze.
  // Never during a sighting (the fog cap shows the silhouette on purpose). 0 = off (the skitterlings: their veins glow on every mesh).
  fogHide: 8,
  bodyScale: 0.93, // vertebra scale = link / rest pitch x this (a hair under, so the mortar-flesh joints show)
};
const SEG = 20;
const CLIP_LISTS = [BASE_CLIPS, ADDITIVE_CLIPS];
const LIFT_FALLOFF = [1, 0.6, 0.3, 0.12];
const _v0 = new THREE.Vector3();
const _m3a = new Float64Array(9);
const _m3b = new Float64Array(9);
const _m3c = new Float64Array(9);
const _m3d = new Float64Array(9);
const _m3e = new Float64Array(9);

function len3(x, y, z) {
  return Math.sqrt(x * x + y * y + z * z);
}

export class MasonRigView {
  /**
   * @param {THREE.Object3D} scene
   * @param {object} gltf  GLTFLoader result of mason_rig.glb
   * @param {object} [options]
   */
  constructor(scene, gltf, options) {
    this.opts = Object.assign({}, DEFAULTS, options || {});
    this.isRig = true;
    this.scene = scene || null;
    this.bus = null;
    this.root = new THREE.Group();
    this.root.name = this.opts.variant ? 'SkitterRigView' : 'MasonRigView';
    this.root.visible = false;
    this._time = 0;
    this.info = { rig: true, drawCalls: 0, triangles: 0, trianglesLod1: 0, bones: 0, lod: 0, clips: 0, legsStepping: 0, headScale: 1, fit: [0, 0, 0, 0] };

    const parserJson = gltf && gltf.parser && gltf.parser.json;
    const meta = parserJson && parserJson.extras && parserJson.extras.mason;
    if (!meta || !gltf.scene) throw new Error('mason_rig.glb: missing rig metadata');
    this.meta = meta;
    this.gltf = gltf;
    this._collect(gltf);
    this._buildMaterials();
    this._buildRig(meta);
    this._buildActions(gltf, meta);
    this.graph = new ClipGraph();
    const skit = !!this.opts.variant;
    this.legs = new MasonLegs(this.bones, meta, skit ? GAIT_SKITTER : GAIT_MASON, this.opts.size);
    this.legs.onLand = (x, y, z, side, w, lead) => this._landed(x, y, z, w, lead);
    this.motion = new BodyMotion(SEG, skit ? MOTION_SKITTER : MOTION_MASON);
    this.dust = null;
    this._trailAcc = 0;
    this._smokeAcc = 0;
    this._smokeI = 0;
    this._trailI = 3;
    this._gu = new Float32Array([0, 1, 0]); // the body's up near the shoulders (the dust's surface normal)
    this._gv = new Float32Array(3); // the body's velocity (the dust follows the wake)
    this._wet = 0;
    this._camD = 0;
    this.fit = new HeadFit(headExtents(meta.headBounds));
    // per-frame scratch
    this.F = new Float32Array(SEG * 12);
    this.S = new Float32Array(SEG);
    this._sphere = new THREE.Sphere(new THREE.Vector3(), 30);
    this._lod = 0;
    this._glowOnly = false; // past the haze: only the emissive mesh draws (opts.fogHide)
    this._prevHead = new Float32Array(3);
    this._havePrev = false;
    this._speed = 0;
    this._wasVisible = false;
    this._hug = 3.2 * this.opts.size;
    this._farAcc = 0;
    this._farTick = 0;
    this._focus = { yaw: 0, pitch: 0, vyaw: 0, vpitch: 0, gain: 0 };
    this._forced = null;
    this._dbg = null;
    this._level = null;
    this._lastCreature = null;
    this.debug = this._makeDebug();
    if (this.scene) this.scene.add(this.root);
  }

  bindBus(bus) {
    this.bus = bus || null;
  }

  /** The shared ground-dust pool (fx.creatureDust): footfalls, the wake and strikes feed it. */
  bindDust(dust) {
    this.dust = dust || null;
  }

  /** compat with CreatureView (the atlases are baked into the GLB) */
  setTextures() {}

  // ---------------------------------------------------------------------------------------------------------------
  // construction
  // ---------------------------------------------------------------------------------------------------------------
  _collect(gltf) {
    this.bones = {};
    this.boneList = [];
    this.meshes = [[], []];
    const skinned = [];
    gltf.scene.traverse((o) => {
      if (o.isBone) {
        this.bones[o.userData.name || o.name] = o;
        this.boneList.push(o);
      } else if (o.isSkinnedMesh) skinned.push(o);
    });
    if (!this.boneList.length || !skinned.length) throw new Error('mason_rig.glb: no skeleton');
    for (const m of skinned) {
      let lod = 0;
      for (let p = m; p; p = p.parent) {
        const n = (p.userData && p.userData.name) || p.name || '';
        if (/LOD1/.test(n)) lod = 1;
      }
      this.meshes[lod].push(m);
    }
    if (!this.meshes[0].length) throw new Error('mason_rig.glb: no LOD0 mesh');
    if (!this.meshes[1].length) this.meshes[1] = this.meshes[0];
    if (this.opts.variant) {
      // own red material set (clones: maps / textures stay shared), never a shadow caster (cheap dynamic shadow budget)
      const clones = new Map();
      for (const m of skinned) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        const out = mats.map((mat) => {
          if (!clones.has(mat)) clones.set(mat, mat.clone());
          return clones.get(mat);
        });
        m.material = Array.isArray(m.material) ? out : out[0];
        m.userData.noShadowCast = true;
      }
    }
    this.skeleton = skinned[0].skeleton;
    for (const b of this.boneList) {
      b.matrixAutoUpdate = false;
      b.matrixWorldAutoUpdate = false;
      b.matrixWorld.identity();
    }
    let t0 = 0;
    let t1 = 0;
    for (let l = 0; l < 2; l++) {
      for (const m of this.meshes[l]) {
        m.removeFromParent();
        m.frustumCulled = true;
        m.castShadow = false;
        m.receiveShadow = false;
        m.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 40);
        this.root.add(m);
        const tris = m.geometry.index ? m.geometry.index.count / 3 : 0;
        if (l === 0) t0 += tris;
        else if (this.meshes[1] !== this.meshes[0]) t1 += tris;
      }
    }
    this.info.triangles = t0;
    this.info.trianglesLod1 = t1;
    this.info.drawCalls = this.meshes[0].length;
    this.info.bones = this.boneList.length;
    this._setLod(0, true);
  }

  _buildMaterials() {
    const skit = !!this.opts.variant;
    this.uniforms = skit ? makeSkitterUniforms() : makeMasonUniforms();
    this.uniforms.uGlowPierce.value = this.opts.glowPierce;
    this.materials = [];
    this.emissive = null;
    const seen = new Set();
    for (const l of this.meshes) {
      for (const m of l) {
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        for (const mat of mats) {
          if (!mat || seen.has(mat)) continue;
          seen.add(mat);
          mat.vertexColors = false;
          if (skit) patchSkitterMaterial(mat, this.uniforms);
          else patchMasonMaterial(mat, this.uniforms);
          this.materials.push(mat);
          if (/Emissive/i.test(mat.name)) {
            this.emissive = mat;
            this._emBase = mat.emissiveIntensity || 1;
          }
        }
      }
    }
  }

  _buildRig(meta) {
    const B = this.bones;
    this.spineNames = meta.spine; // neck, spine_00..17, tail_0  (== sim points 0..19)
    this.spine = meta.spine.map((n) => {
      if (!B[n]) throw new Error('mason_rig.glb: missing bone ' + n);
      return B[n];
    });
    this.tail1 = B[meta.tailExtra] || null;
    this.restPos = new Float32Array(SEG * 3);
    for (let i = 0; i < SEG; i++) {
      const b = this.spine[i];
      this.restPos[i * 3] = b.position.x;
      this.restPos[i * 3 + 1] = b.position.y;
      this.restPos[i * 3 + 2] = b.position.z;
    }
    this.neck = this.spine[0];
    this.crown = [];
    const walk = (b) => {
      for (const c of b.children) {
        if (c.isBone) {
          this.crown.push(c);
          walk(c);
        }
      }
    };
    walk(this.neck);
    this.pitDirs = meta.pits;
  }

  _buildActions(gltf, meta) {
    this.mixer = new THREE.AnimationMixer(gltf.scene);
    this.mixer.timeScale = this.opts.clipRate;
    this.act = {};
    this.clipInfo = {};
    for (const clip of gltf.animations || []) {
      const mi = meta.clips && meta.clips[clip.name];
      if (!mi || mi.kind === 'template') continue;
      if ((mi.kind === 'additive' || mi.kind === 'parametric') && !gltf.sharedClips) THREE.AnimationUtils.makeClipAdditive(clip);
      const a = this.mixer.clipAction(clip);
      a.enabled = true;
      if (mi.loop) a.setLoop(THREE.LoopRepeat, Infinity);
      else {
        a.setLoop(THREE.LoopOnce, 1);
        a.clampWhenFinished = true;
      }
      a.setEffectiveWeight(0);
      a.play();
      if (mi.kind === 'parametric' || mi.phase) a.paused = true;
      this.act[clip.name] = a;
      this.clipInfo[clip.name] = {
        name: clip.name,
        kind: mi.kind,
        duration: clip.duration,
        loop: !!mi.loop,
        events: (mi.events || []).map((e) => ({ name: e.name, t: e.u * clip.duration })),
        prevT: -1,
        weight: 0,
        active: false,
        on: false,
      };
      // desynchronise the loops
      if (mi.loop && mi.kind === 'base') a.time = (clip.name.length * 0.37) % clip.duration;
    }
    this.info.clips = Object.keys(this.act).length;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // LOD
  // ---------------------------------------------------------------------------------------------------------------
  _setLod(lod, force) {
    if (!force && lod === this._lod) return;
    this._lod = lod;
    const g = this._glowOnly;
    let calls = 0;
    for (const m of this.meshes[0]) {
      m.visible = (lod === 0 || this.meshes[1] === this.meshes[0]) && (!g || m.material === this.emissive);
      if (m.visible) calls++;
    }
    if (this.meshes[1] !== this.meshes[0]) {
      for (const m of this.meshes[1]) {
        m.visible = lod === 1 && (!g || m.material === this.emissive);
        if (m.visible) calls++;
      }
    }
    this.info.lod = lod;
    this.info.drawCalls = calls;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // per frame
  // ---------------------------------------------------------------------------------------------------------------
  /**
   * @param {Creature3D} creature
   * @param {number} dt
   * @param {THREE.Camera} [camera]
   */
  update(creature, dt, camera) {
    const C = this._dbg ? this._dbg.creature : creature;
    if (this._dbg && dt > 0 && C.speed) advanceSynthetic(C, Math.min(dt, 0.1));
    if (creature) this._lastCreature = creature;
    const B = C && C.body;
    if (!B || !B.visible || C.active === false) {
      this.root.visible = false;
      this._wasVisible = false;
      return;
    }
    dt = dt > 0 ? Math.min(dt, 0.1) : 0;
    this._time += dt;
    const size = B.size || 1;
    const sp = B.spine;
    const o = this.opts;

    // ---- distance / LOD / culling ----
    let camD = 0;
    if (camera) {
      camera.getWorldPosition(_v0);
      camD = 1e9;
      for (let i = 0; i < SEG; i++) {
        const d = len3(_v0.x - sp[i * 3], _v0.y - sp[i * 3 + 1], _v0.z - sp[i * 3 + 2]);
        if (d < camD) camD = d;
      }
      if (camD > o.hideDistance) {
        this.root.visible = false;
        this._wasVisible = false;
        return;
      }
    }
    this._camD = camD;
    this.root.visible = true;
    const lodWant = camD > (this._lod === 1 ? o.lodDistance - o.lodHysteresis : o.lodDistance) ? 1 : 0;
    // past the haze only the glow can be seen (opts.fogHide): the fogged-out stone meshes are not drawn (or skinned)
    const fog = this.scene && this.scene.fog;
    const glowOnly = !!(o.fogHide > 0 && this.emissive && camera && fog && fog.isFog && !C.sighting && camD > fog.far + o.fogHide);
    if (glowOnly !== this._glowOnly) {
      this._glowOnly = glowOnly;
      this._setLod(lodWant, true);
    } else this._setLod(lodWant);
    const lodFar = this._lod === 1;
    if (o.farDistance && camD > o.farDistance) {
      // far skitterlings: the whole pose is refreshed every 2nd frame (the stale pose is drawn in between)
      this._farAcc += dt;
      this._farTick ^= 1;
      if (this._farTick) return;
      dt = this._farAcc;
      this._farAcc = 0;
    } else this._farAcc = 0;

    // ---- teleports / respawns: forget footholds and springs ----
    const hx0 = sp[0];
    const hy0 = sp[1];
    const hz0 = sp[2];
    let jump = !this._wasVisible;
    if (this._havePrev) {
      const dx = hx0 - this._prevHead[0];
      const dy = hy0 - this._prevHead[1];
      const dz = hz0 - this._prevHead[2];
      const d = len3(dx, dy, dz);
      if (d > 9) jump = true;
      if (dt > 0) this._speed += (d / dt - this._speed) * (1 - Math.exp(-dt * 6));
    }
    this._prevHead[0] = hx0;
    this._prevHead[1] = hy0;
    this._prevHead[2] = hz0;
    this._havePrev = true;
    if (jump) {
      this.legs.reset();
      this.motion.reset();
      this.fit.reset();
      const f = this._focus;
      f.yaw = f.pitch = f.vyaw = f.vpitch = f.gain = 0;
      this._speed = 0;
    }
    this._wasVisible = true;

    // ---- sim state -> clip graph ----
    this._snapshot(C, B);
    const g = this.graph.update(dt);
    this._applyClips(dt, g, C);
    this.mixer.update(dt);

    // ---- spine frames, head fit ----
    const F = this.F;
    const S = this.S;
    computeFrames(B, SEG, F, dt, jump);
    // the gait clock: one cycle per stride of distance travelled (the legs and the body's wave share it), frozen while it listens
    const gs = this.graph.out;
    if (!gs.freeze && dt > 0) this.legs.cycle += (this._speed * dt) / this.legs.stride;
    {
      const sn = this.graph.snapshot;
      const wind = sn.phase === 'windup' ? clamp(sn.atkT / Math.max(sn.atkWindup, 0.05), 0, 1) : sn.phase === 'strike' ? -0.5 : 0;
      this.motion.update(dt, F, sp, size, gs.freeze ? 0 : this._speed, this.legs.cycle, this.legs.loadL, this.legs.loadR, wind, B.jitter || 0);
    }
    const level = C.level || this._level;
    if (C.level) this._level = C.level;
    const cap = sectionHeadScale(C);
    this.fit.update(dt, level, F[0], F[1], F[2], F[6], F[7], F[8], F[9], F[10], F[11], cap);
    const hs = this.fit.scale * size;
    const lift = this.fit.lift * size;
    // lift the crown (and the first links) off the wall it clings to
    for (let i = 0; i < LIFT_FALLOFF.length; i++) {
      const k = lift * LIFT_FALLOFF[i];
      F[i * 12] += F[i * 12 + 6] * k;
      F[i * 12 + 1] += F[i * 12 + 7] * k;
      F[i * 12 + 2] += F[i * 12 + 8] * k;
    }
    // per-bone uniform scale from the link lengths (the taper lives in the sim)
    const P0 = this.meta.P0;
    const bs = o.bodyScale / P0;
    S[0] = hs;
    for (let i = 1; i < SEG; i++) {
      const a = len3(sp[i * 3] - sp[i * 3 - 3], sp[i * 3 + 1] - sp[i * 3 - 2], sp[i * 3 + 2] - sp[i * 3 - 1]);
      const b = i < SEG - 1 ? len3(sp[i * 3 + 3] - sp[i * 3], sp[i * 3 + 4] - sp[i * 3 + 1], sp[i * 3 + 5] - sp[i * 3 + 2]) : a;
      S[i] = clamp((a + b) * 0.5 * bs, size < 1 ? 0.08 : 0.4, 1.6);
    }
    if (o.twitch > 0) this._twitch(F, S, o.twitch, B);

    // ---- crown aim (spring) ----
    this._aim(dt, B, F);

    // ---- bones ----
    this._poseSpine(F, S);
    this._poseCrown();
    this._poseLegs(dt, B, F, S, level, g, lodFar);
    if (this.dust) this._wake(dt, C, B, F, size);

    // ---- shading uniforms ----
    if (o.variant) {
      this.uniforms.uSkTime.value = this._time % 1000;
      this.uniforms.uCrawl.value = clamp(0.55 + this._speed / 14 + (B.jitter || 0) * 0.6 + (this.graph.snapshot.listening ? 0.2 : 0), 0.4, 1.5);
    }
    const sighting = !!C.sighting;
    this.uniforms.uFogCap.value = sighting ? o.sightingFogCap : 1;
    this.uniforms.uGlowPierce.value = sighting ? 1 : o.glowPierce;
    if (this.emissive) {
      const glow = clamp(B.glow == null ? 0.3 : B.glow, 0, 1);
      // a living ember: a slow double beat (lub-dub, ~1.5 s), quicker and harder as it closes in
      const rate = 0.65 + 0.5 * clamp(glow, 0, 1);
      const ph = (this._time * rate) % 1;
      const beat = Math.exp(-((ph - 0.08) * (ph - 0.08)) / 0.0018) + 0.6 * Math.exp(-((ph - 0.27) * (ph - 0.27)) / 0.0025);
      this.emissive.emissiveIntensity = this._emBase * (0.12 + 1.05 * glow) * (0.72 + 0.45 * beat);
    }

    // ---- bounds ----
    this._bounds(sp, hs);
    this.info.headScale = hs;
    this.info.legsStepping = this.legs.stats.stepping;
    this.info.fit[0] = this.fit.clear[0];
    this.info.fit[1] = this.fit.clear[1];
    this.info.fit[2] = this.fit.clear[2];
    this.info.fit[3] = this.fit.clear[3];
  }

  /** Nervous quiver (skitterling): a high-frequency sideways shiver and swell per vertebra, travelling down the body. Zero allocation. */
  _twitch(F, S, amp, B) {
    const t = this._time;
    const k = amp * (0.5 + 0.5 * clamp(this._speed / 8 + (B.jitter || 0), 0, 1)) * (B.size || 1);
    for (let i = 0; i < SEG; i++) {
      const q = Math.sin(t * 47 + i * 1.9) * Math.sin(t * 19 + i * 0.7);
      const o = i * 12;
      const sh = q * k * 1.5;
      F[o] += F[o + 9] * sh;
      F[o + 1] += F[o + 10] * sh;
      F[o + 2] += F[o + 11] * sh;
      S[i] *= 1 + 0.045 * Math.sin(t * 61 + i * 2.3);
    }
  }

  _snapshot(C, B) {
    const s = this.graph.snapshot;
    const a = C.attack;
    s.state = C.state || 'DORMANT';
    s.phase = a && s.state === 'ATTACK' ? a.phase : null;
    s.atkT = a ? a.t : 0;
    s.atkWindup = a ? a.windup : 0.75;
    s.hit = !!(a && a.hit);
    s.listening = !!C.listening;
    s.creeping = !!C.creeping;
    s.jitter = B.jitter || 0;
    s.lunge = B.lunge || 0;
    s.frondOpen = B.frondOpen == null ? 0.3 : B.frondOpen;
    s.glow = B.glow == null ? 0.1 : B.glow;
    s.distance = C.distance == null ? 99 : C.distance;
    s.victory = C.victory && C.victory.phase ? C.victory.phase : '';
    s.sighting = !!C.sighting;
  }

  // ---- clips ----------------------------------------------------------------------------------------------------
  _applyClips(dt, g, C) {
    const act = this.act;
    const info = this.clipInfo;
    const f = this._forced;
    const w = g.w;
    // one-shot triggers
    const tr = g.triggers;
    for (let i = 0; i < tr.length; i++) {
      const a = act[tr[i]];
      if (!a) continue;
      a.reset();
      a.setEffectiveWeight(0);
      a.play();
      const ci = info[tr[i]];
      ci.prevT = -1;
      ci.active = true; // the start event goes out now (not when the envelope has faded in)
      ci.on = false;
      this._emitClip(tr[i], 'start', 0, C, 0);
    }
    for (let li = 0; li < 2; li++) {
      const list = CLIP_LISTS[li];
      for (let i = 0; i < list.length; i++) {
        const n = list[i];
        const a = act[n];
        if (!a) continue;
        const ci = info[n];
        const isF = !!f && f.name === n;
        const wt = f ? (isF ? 1 : 0) : w[n];
        if (n === 'rear_windup' || n === 'strike') {
          // phase lock: always paused, scrubbed by the sim's own attack timer
          a.paused = true;
          const t = isF ? f.u * ci.duration : n === 'rear_windup' ? g.windupTime : g.strikeTime;
          if (t >= 0 && (isF || !f)) a.time = t;
          else if (wt < 0.001) a.time = 0;
        } else if (isF && f.hold) {
          a.paused = true;
          a.time = f.u * ci.duration;
        } else a.paused = false;
        a.setEffectiveWeight(wt);
        ci.weight = wt;
        this._events(n, a, wt, C);
      }
    }
    for (let i = 0; i < PARAM_CLIPS.length; i++) {
      const n = PARAM_CLIPS[i];
      const a = act[n];
      if (!a) continue;
      const v = f ? (f.name === n ? f.u : 0) : g.param[n];
      const ci = info[n];
      a.paused = true;
      a.time = clamp(v, 0, 1) * ci.duration * 0.999;
      a.setEffectiveWeight(v > 0.002 ? 1 : 0);
      ci.weight = v;
      if (v > 0.5) this._events(n, a, 1, C);
      else ci.prevT = -1;
    }
  }

  _events(name, a, weight, C) {
    const ci = this.clipInfo[name];
    // start / end edges (the audio sync starts and stops its layers on these)
    if (weight > 0.3) {
      if (!ci.active) {
        ci.active = true;
        this._emitClip(name, 'start', 0, C, name === 'rear_windup' ? this.graph.snapshot.atkWindup : name === 'plate_shiver' ? weight : 0);
      }
      ci.on = true;
    } else if (ci.active && ci.on && weight < 0.08) {
      ci.active = false;
      ci.on = false;
      this._emitClip(name, 'end', ci.duration, C, 0);
    }
    const ev = ci.events;
    const t = a.time;
    const prev = ci.prevT;
    ci.prevT = weight > 0.02 ? t : -1;
    if (!ev.length || prev < 0 || weight < 0.15) return;
    const wrapped = t < prev;
    if (wrapped && !ci.loop) return;
    for (let i = 0; i < ev.length; i++) {
      const et = ev[i].t;
      const hit = wrapped ? et > prev || et <= t : et > prev && et <= t;
      if (hit) this._emitClip(name, ev[i].name, et, C, 0);
    }
  }

  _emitClip(name, event, t, C, extra) {
    if (name === 'strike' && event === 'contact') this._slam(C, 1);
    else if (name === 'roar_display' && event === 'peak') this._slam(C, 0.5);
    if (!this.bus) return;
    const h = C && C.body && C.body.head;
    const p = { name, event, t, x: h ? h.x : 0, y: h ? h.y : 0, z: h ? h.z : 0 };
    if (extra) {
      if (name === 'rear_windup') p.dur = extra;
      else p.weight = extra;
    }
    this.bus.emit('creature:clip', p);
  }

  // ---- crown aim ------------------------------------------------------------------------------------------------
  _aim(dt, B, F) {
    const fc = this._focus;
    const foc = B.focus;
    let ty = 0;
    let tp = 0;
    let gt = 0; // the wanted focus gain
    const attacking = this.graph.snapshot.phase !== null;
    if (foc && !attacking) {
      const dx = foc.x - F[0];
      const dy = foc.y - F[1];
      const dz = foc.z - F[2];
      const lr = dx * F[9] + dy * F[10] + dz * F[11];
      const lu = dx * F[6] + dy * F[7] + dz * F[8];
      const lf = dx * F[3] + dy * F[4] + dz * F[5];
      gt = clamp((foc.amount || 0) * 1.5 + (this.graph.snapshot.listening ? 0.5 : 0), 0, 1);
      if (gt > 0.001 && len3(dx, dy, dz) > 1) {
        const lim = 70 * (Math.PI / 180);
        const limP = 45 * (Math.PI / 180);
        const a = -Math.atan2(lr, lf);
        const aa = Math.abs(a);
        // a target behind the crown must not flip the head from one side to the other (atan2 wraps there): past 100 degrees the aim
        // fades back to neutral, gone at 150
        let back = 1;
        if (aa > 1.745) {
          const e = (aa - 1.745) / 0.873;
          back = e >= 1 ? 0 : 1 - e * e * (3 - 2 * e);
        }
        ty = clamp(a, -lim, lim) * back;
        tp = clamp(Math.atan2(lu, Math.sqrt(lr * lr + lf * lf)), -limP, limP) * back;
      }
    }
    // the state's focus amount is a step (and an attack drops it to nothing): ease it, so the head turns where it looks instead of snapping
    fc.gain += (gt - fc.gain) * (dt > 0 ? 1 - Math.exp(-5 * dt) : 1);
    ty *= fc.gain;
    tp *= fc.gain;
    // spring: ~0.3 s lag, ~2 % overshoot (damping 0.8), and a cap on how fast the head may swing (290 / 230 deg/s)
    const w0 = 8.5;
    const z = 0.8;
    const n = dt > 0 ? Math.max(1, Math.ceil(dt / 0.016)) : 0;
    const h = n ? dt / n : 0;
    for (let i = 0; i < n; i++) {
      fc.vyaw += (w0 * w0 * (ty - fc.yaw) - 2 * z * w0 * fc.vyaw) * h;
      fc.vyaw = clamp(fc.vyaw, -5.05, 5.05);
      fc.yaw += fc.vyaw * h;
      fc.vpitch += (w0 * w0 * (tp - fc.pitch) - 2 * z * w0 * fc.vpitch) * h;
      fc.vpitch = clamp(fc.vpitch, -4, 4);
      fc.pitch += fc.vpitch * h;
    }
  }

  // ---- bones ----------------------------------------------------------------------------------------------------
  _poseSpine(F, S) {
    const sp = this.spine;
    const rp = this.restPos;
    const fc = this._focus;
    for (let i = 0; i < SEG; i++) {
      const b = sp[i];
      const o = i * 12;
      // frame: columns right, up, back
      const R = _m3a;
      R[0] = F[o + 9];
      R[1] = F[o + 6];
      R[2] = -F[o + 3];
      R[3] = F[o + 10];
      R[4] = F[o + 7];
      R[5] = -F[o + 4];
      R[6] = F[o + 11];
      R[7] = F[o + 8];
      R[8] = -F[o + 5];
      const q = b.quaternion;
      quat3(_m3b, q.x, q.y, q.z, q.w);
      let M = R;
      if (i === 0) {
        // the aim spring: yaw about +Y, then pitch about +X (Ry * Rx), then the clip's neck delta
        const cy = Math.cos(fc.yaw);
        const sy = Math.sin(fc.yaw);
        const cp = Math.cos(fc.pitch);
        const sp2 = Math.sin(fc.pitch);
        _m3c[0] = cy;
        _m3c[1] = sy * sp2;
        _m3c[2] = sy * cp;
        _m3c[3] = 0;
        _m3c[4] = cp;
        _m3c[5] = -sp2;
        _m3c[6] = -sy;
        _m3c[7] = cy * sp2;
        _m3c[8] = cy * cp;
        mul3(_m3d, R, _m3c);
        M = _m3d;
      }
      mul3(_m3e, M, _m3b);
      const Rm = _m3e;
      const s = S[i];
      // delta translation (the clip's heave) in the bone frame
      const dx = (b.position.x - rp[i * 3]) * s;
      const dy = (b.position.y - rp[i * 3 + 1]) * s;
      const dz = (b.position.z - rp[i * 3 + 2]) * s;
      const px = F[o] + R[0] * dx + R[1] * dy + R[2] * dz;
      const py = F[o + 1] + R[3] * dx + R[4] * dy + R[5] * dz;
      const pz = F[o + 2] + R[6] * dx + R[7] * dy + R[8] * dz;
      const e = b.matrixWorld.elements;
      e[0] = Rm[0] * s;
      e[1] = Rm[3] * s;
      e[2] = Rm[6] * s;
      e[3] = 0;
      e[4] = Rm[1] * s;
      e[5] = Rm[4] * s;
      e[6] = Rm[7] * s;
      e[7] = 0;
      e[8] = Rm[2] * s;
      e[9] = Rm[5] * s;
      e[10] = Rm[8] * s;
      e[11] = 0;
      e[12] = px;
      e[13] = py;
      e[14] = pz;
      e[15] = 1;
    }
    if (this.tail1) this.tail1.matrixWorld.copy(sp[SEG - 1].matrixWorld);
  }

  _poseCrown() {
    const list = this.crown;
    for (let i = 0; i < list.length; i++) {
      const b = list[i];
      b.updateMatrix();
      b.matrixWorld.multiplyMatrices(b.parent.matrixWorld, b.matrix);
    }
  }

  _poseLegs(dt, B, F, S, level, g, lodFar) {
    // follower footholds sit where the lead legs find the surface: average hip -> planted hook distance along the body's down
    const limbs = B.limbs;
    if (limbs) {
      let sum = 0;
      let n = 0;
      for (let i = 0; i < limbs.length; i++) {
        const L = limbs[i];
        if (!L.planted) continue;
        const o = L.seg * 12;
        const d = (F[o] - L.foot.x) * F[o + 6] + (F[o + 1] - L.foot.y) * F[o + 7] + (F[o + 2] - L.foot.z) * F[o + 8];
        if (d > 0.3 && d < 14) {
          sum += d;
          n++;
        }
      }
      if (n) this._hug += (sum / n - this._hug) * (1 - Math.exp(-Math.max(dt, 0.001) * 2));
    }
    this.legs.hug = this._hug;
    const freeze = g.freeze || !!(this._forced && this._forced.hold);
    this.legs.update(dt, F, S, limbs, level, freeze, lodFar, this._speed);
    this._legSmoke(dt, limbs);
  }

  // ---- ground dust ------------------------------------------------------------------------------------------------
  _landed(x, y, z, w, lead) {
    const d = this.dust;
    if (!d || this._camD > 90) return;
    const u = this._gu;
    const v = this._gv;
    const size = this.opts.size;
    d.foot(x, y, z, u[0], u[1], u[2], size * (lead ? 1.1 : 0.8), clamp(w * (0.35 + this._speed / 9), 0.2, 1), this._wet, v[0], v[1], v[2]);
  }

  /** Brown dirt smoke at the feet while it moves: one leg at a time, round robin, more the faster it goes. */
  _legSmoke(dt, limbs) {
    const d = this.dust;
    if (!d || this._camD > 90) return;
    const sp = this._speed;
    const size = this.opts.size;
    const mv = clamp(sp / (2.5 * Math.max(size, 0.3) ** 0.5), 0, 1.6);
    if (mv < 0.1) return;
    const list = this.legs.legs;
    if (!list.length) return;
    this._smokeAcc += dt * (2 + sp * 1.1) * (this.opts.variant ? 0.8 : 1);
    const u = this._gu;
    const v = this._gv;
    let guard = 0;
    while (this._smokeAcc >= 1 && guard++ < 4) {
      this._smokeAcc -= 1;
      const L = list[this._smokeI++ % list.length];
      let x;
      let y;
      let z;
      if (L.kind === 'lead') {
        const sim = limbs && limbs[L.simLimb];
        if (!sim) continue;
        x = sim.foot.x;
        y = sim.foot.y;
        z = sim.foot.z;
      } else {
        x = L.fx;
        y = L.fy;
        z = L.fz;
      }
      d.smoke(x, y, z, u[0], u[1], u[2], size * (L.kind === 'lead' ? 1.1 : 0.8), clamp(mv, 0.25, 1), this._wet, v[0] * 0.5, v[1] * 0.5, v[2] * 0.5);
    }
  }

  /** Under-body wake: a low drifting wisp every so often while it moves (more when fast), the slam on a strike's contact. */
  _wake(dt, C, B, F, size) {
    const d = this.dust;
    if (!d || this._camD > 90) return;
    const o = 6 * 12;
    this._gu[0] = F[o + 6];
    this._gu[1] = F[o + 7];
    this._gu[2] = F[o + 8];
    const sp = this._speed;
    this._gv[0] = F[o + 3] * sp;
    this._gv[1] = F[o + 4] * sp;
    this._gv[2] = F[o + 5] * sp;
    this._wet = sectionWet(C.sectionIndex);
    const mv = clamp(sp / (3 * Math.max(size, 0.3) ** 0.5), 0, 2);
    if (mv < 0.12 && !(this._wet > 0.3)) return;
    // emission by distance travelled and a slow idle seep over wet stone
    const perM = this.opts.variant ? 1.2 : 0.7; // wisps per metre of travel
    this._trailAcc += dt * (sp * perM + this._wet * (0.5 + 0.8 * mv));
    let guard = 0;
    while (this._trailAcc >= 1 && guard++ < 3) {
      this._trailAcc -= 1;
      const i = this._trailI;
      this._trailI = i >= 16 ? 3 : i + 1;
      const hug = this._hug * 0.95;
      const q = i * 12;
      d.trail(F[q] - F[q + 6] * hug, F[q + 1] - F[q + 7] * hug, F[q + 2] - F[q + 8] * hug, F[q + 6], F[q + 7], F[q + 8], size, clamp(mv, 0.2, 1), this._wet, this._gv[0] * 0.5, this._gv[1] * 0.5, this._gv[2] * 0.5);
    }
  }

  _slam(C, strength) {
    const d = this.dust;
    const h = C && C.body && C.body.head;
    if (!d || !h || this._camD > 90) return;
    const u = this._gu;
    const size = this.opts.size;
    // the impact point: the crown's tip on the surface it strikes (the head height above it is the hug)
    d.slam(h.x - u[0] * this._hug * 0.8, h.y - u[1] * this._hug * 0.8, h.z - u[2] * this._hug * 0.8, u[0], u[1], u[2], size * 1.5, strength, this._wet);
  }

  _bounds(sp, hs) {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < SEG; i++) {
      const x = sp[i * 3];
      const y = sp[i * 3 + 1];
      const z = sp[i * 3 + 2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }
    const sph = this._sphere;
    sph.center.set((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
    sph.radius = len3(maxX - minX, maxY - minY, maxZ - minZ) / 2 + (this.opts.size < 1 ? 3 : 12) + 9 * hs;
    const list = this.meshes[this._lod];
    for (let i = 0; i < list.length; i++) list[i].boundingSphere.copy(sph);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // debug
  // ---------------------------------------------------------------------------------------------------------------
  _makeDebug() {
    const self = this;
    return {
      /** Plays a clip (loops it / plays it once) instead of the sim-driven graph. */
      play(name, opts) {
        if (!self.act[name]) return false;
        self._forced = { name, u: 0, hold: false };
        const a = self.act[name];
        a.reset();
        a.play();
        if (self.clipInfo[name].kind === 'parametric' || self.clipInfo[name].kind === 'base' || self.clipInfo[name].kind === 'additive') {
          if (opts && opts.hold) {
            self._forced.hold = true;
            self._forced.u = clamp(+opts.u || 0, 0, 1);
          }
        }
        return true;
      },
      /** Freezes the forced clip at normalised time u (0..1); pose(u, name) also selects the clip. */
      pose(u, name) {
        const nm = name || (self._forced && self._forced.name);
        if (!nm || !self.act[nm]) return false;
        self._forced = { name: nm, u: clamp(+u || 0, 0, 1), hold: true };
        return true;
      },
      stop() {
        self._forced = null;
        return true;
      },
      clear() {
        self._dbg = null;
        self._forced = null;
        self.legs.reset();
        self.fit.reset();
        return true;
      },
      /** Places a synthetic Mason near the player (screenshots): { player, camera, distance, height, yaw, up:[x,y,z], state, hug }. */
      place(o) {
        o = o || {};
        const P = o.player || { x: 0, y: 0, z: 0 };
        let fx = 0;
        let fz = -1;
        if (o.camera) {
          o.camera.getWorldDirection(_v0);
          const l = Math.hypot(_v0.x, _v0.z) || 1;
          fx = _v0.x / l;
          fz = _v0.z / l;
        }
        const yaw = ((o.yaw || 0) * Math.PI) / 180;
        const cy = Math.cos(yaw);
        const sy = Math.sin(yaw);
        const dx = fx * cy - fz * sy;
        const dz = fx * sy + fz * cy;
        const dist = o.distance == null ? (self.opts.size < 1 ? 5 : 12) : o.distance;
        const hx = P.x + dx * dist;
        const hz = P.z + dz * dist;
        const hy = P.y + (o.height || 0);
        // faces the player; the body trails away behind it
        let ffx = P.x - hx;
        let ffy = o.pitchToPlayer ? P.y - hy : 0;
        let ffz = P.z - hz;
        const fl = len3(ffx, ffy, ffz) || 1;
        ffx /= fl;
        ffy /= fl;
        ffz /= fl;
        if (o.faceYaw) {
          // turn the facing about the world vertical (90 = crawling across the player's view)
          const a = (o.faceYaw * Math.PI) / 180;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const nx = ffx * ca + ffz * sa;
          const nz = -ffx * sa + ffz * ca;
          ffx = nx;
          ffz = nz;
        }
        const up = o.up || [0, 1, 0];
        self._dbg = { creature: makeSyntheticCreature(hx, hy, hz, ffx, ffy, ffz, up, o.state || 'OBSERVING', o.hug || 1.45 * self.opts.size, self._lastCreature, self.opts.size) };
        self._dbg.creature.speed = o.speed || 0;
        self.legs.reset();
        self.fit.reset();
        return { x: hx, y: hy, z: hz };
      },
      state() {
        return {
          lod: self._lod,
          visible: self.root.visible,
          headScale: self.fit.scale,
          headLift: self.fit.lift,
          clear: Array.from(self.fit.clear),
          forced: self._forced,
          synthetic: !!self._dbg,
          weights: Object.fromEntries(Object.entries(self.clipInfo).map(([k, v]) => [k, +v.weight.toFixed(3)])),
          legs: self.legs.stats,
          triangles: self.info.triangles,
          drawCalls: self.info.drawCalls,
        };
      },
      /** Writes a synthetic creature field (state, listening, attack.phase ...) for the next frames. */
      set(patch) {
        const c = self._dbg && self._dbg.creature;
        if (!c || !patch) return false;
        Object.assign(c, patch);
        return true;
      },
    };
  }

  setVisible(v) {
    this.root.visible = !!v;
  }

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    const seen = new Set();
    for (const l of this.meshes) {
      for (const m of l) {
        if (seen.has(m)) continue;
        seen.add(m);
        if (!this.opts.variant) m.geometry.dispose(); // clones share the Mason's geometry
      }
    }
    for (const mat of this.materials) {
      if (this.opts.variant) {
        mat.dispose(); // textures are the Mason's
        continue;
      }
      for (const k of Object.keys(mat)) {
        const v = mat[k];
        if (v && v.isTexture) v.dispose();
      }
      mat.dispose();
    }
    if (this.skeleton && this.skeleton.boneTexture) this.skeleton.boneTexture.dispose();
    if (this.mixer) this.mixer.stopAllAction();
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// A synthetic creature for screenshots / tools: the same body payload the sim writes, built from a head point, a facing and
// a clinging plane (feet planted on it).
// ---------------------------------------------------------------------------------------------------------------------
const LIMB_DEFS = [
  [2, 1, 8.6],
  [3, -1, 8.3],
  [4, 1, 7.9],
  [6, -1, 7.5],
  [7, 1, 7.1],
  [9, -1, 6.8],
  [10, 1, 6.4],
  [12, -1, 6.1],
  [14, 1, 5.7],
  [15, -1, 5.4],
];

function makeSyntheticCreature(hx, hy, hz, fx, fy, fz, up, state, hug, real, size) {
  size = size || 1;
  let ux = up[0];
  let uy = up[1];
  let uz = up[2];
  const ul = len3(ux, uy, uz) || 1;
  ux /= ul;
  uy /= ul;
  uz /= ul;
  const d = ux * fx + uy * fy + uz * fz;
  let u2x = ux - fx * d;
  let u2y = uy - fy * d;
  let u2z = uz - fz * d;
  const l2 = len3(u2x, u2y, u2z) || 1;
  u2x /= l2;
  u2y /= l2;
  u2z /= l2;
  const rx = fy * u2z - fz * u2y;
  const ry = fz * u2x - fx * u2z;
  const rz = fx * u2y - fy * u2x;
  const spine = new Float32Array(SEG * 3);
  const upA = new Float32Array(SEG * 3);
  const scale = new Float32Array(SEG);
  let cum = 0;
  for (let i = 0; i < SEG; i++) {
    const t = i / (SEG - 1);
    const taper = 1 - 0.45 * Math.pow(Math.max(0, (t - 0.06) / 0.94), 1.25);
    scale[i] = taper;
    if (i > 0) cum += 1.5 * size * 0.5 * (scale[i - 1] + taper);
    const sway = Math.sin((cum / size) * 0.28) * 1.6 * size * Math.min(1, cum / (6 * size));
    const arch = i > 0 ? 0.65 * size * Math.sin(Math.PI * i / (SEG - 1)) * Math.min(1, i / 4) : 0;
    spine[i * 3] = hx - fx * cum + rx * sway + u2x * arch;
    spine[i * 3 + 1] = hy - fy * cum + ry * sway + u2y * arch;
    spine[i * 3 + 2] = hz - fz * cum + rz * sway + u2z * arch;
    upA[i * 3] = u2x;
    upA[i * 3 + 1] = u2y;
    upA[i * 3 + 2] = u2z;
  }
  const limbs = LIMB_DEFS.map((def) => {
    const i = def[0];
    const hipx = spine[i * 3];
    const hipy = spine[i * 3 + 1];
    const hipz = spine[i * 3 + 2];
    const out = def[2] * size * 0.42 * def[1];
    return {
      seg: i,
      side: def[1],
      reach: def[2] * size,
      weight: 1,
      planted: true,
      lift: 0,
      k: -1,
      o: { x: 0, y: 0, z: 0 },
      t: { x: 0, y: 0, z: 0 },
      hip: { x: hipx, y: hipy, z: hipz },
      foot: {
        x: hipx + rx * out - u2x * (hug + 0.6 * size),
        y: hipy + ry * out - u2y * (hug + 0.6 * size),
        z: hipz + rz * out - u2z * (hug + 0.6 * size),
      },
    };
  });
  return {
    active: true,
    synthetic: true,
    state,
    attack: { phase: null, t: 0, windup: 0.75, hit: false },
    speed: 0,
    hug,
    f: [fx, fy, fz],
    u: [u2x, u2y, u2z],
    r: [rx, ry, rz],
    listening: false,
    creeping: false,
    distance: 12,
    victory: null,
    sighting: null,
    level: real && real.level ? real.level : null,
    sectionIndex: real ? real.sectionIndex : -1,
    body: {
      size,
      spine,
      up: upA,
      scale,
      limbs,
      frondOpen: 0.5,
      glow: 0.5,
      lunge: 0,
      jitter: 0,
      listen: 0,
      time: 0,
      visible: true,
      head: { x: hx, y: hy, z: hz, fx, fy, fz, ux: u2x, uy: u2y, uz: u2z },
      focus: { x: 0, y: 0, z: 0, amount: 0 },
    },
  };
}

/** Walks the synthetic Mason forward (a rigid shift) with sim-like lead-leg stepping, so a screenshot shows the gait in motion. */
function advanceSynthetic(C, dt) {
  const B = C.body;
  const f = C.f;
  const d = C.speed * dt;
  const sp = B.spine;
  for (let i = 0; i < SEG; i++) {
    sp[i * 3] += f[0] * d;
    sp[i * 3 + 1] += f[1] * d;
    sp[i * 3 + 2] += f[2] * d;
  }
  B.head.x = sp[0];
  B.head.y = sp[1];
  B.head.z = sp[2];
  B.time += dt;
  for (const L of B.limbs) {
    const i = L.seg;
    const hx = sp[i * 3];
    const hy = sp[i * 3 + 1];
    const hz = sp[i * 3 + 2];
    L.hip.x = hx;
    L.hip.y = hy;
    L.hip.z = hz;
    const out = L.reach * 0.42 * L.side;
    const down = C.hug + 0.6 * (C.body.size || 1);
    const ix = hx + C.r[0] * out - C.u[0] * down + f[0] * L.reach * 0.2;
    const iy = hy + C.r[1] * out - C.u[1] * down + f[1] * L.reach * 0.2;
    const iz = hz + C.r[2] * out - C.u[2] * down + f[2] * L.reach * 0.2;
    if (L.k < 0) {
      const dx = L.foot.x - ix;
      const dy = L.foot.y - iy;
      const dz = L.foot.z - iz;
      if (dx * dx + dy * dy + dz * dz > L.reach * L.reach * 0.2) {
        L.k = 0;
        L.o.x = L.foot.x;
        L.o.y = L.foot.y;
        L.o.z = L.foot.z;
        L.t.x = ix + f[0] * L.reach * 0.3;
        L.t.y = iy + f[1] * L.reach * 0.3;
        L.t.z = iz + f[2] * L.reach * 0.3;
        L.planted = false;
      }
    } else {
      L.k += dt / 0.28;
      if (L.k >= 1) {
        L.k = -1;
        L.planted = true;
        L.lift = 0;
        L.foot.x = L.t.x;
        L.foot.y = L.t.y;
        L.foot.z = L.t.z;
      } else {
        const e = L.k * L.k * (3 - 2 * L.k);
        const lift = Math.sin(Math.PI * L.k) * L.reach * 0.14;
        L.lift = Math.sin(Math.PI * L.k);
        L.foot.x = L.o.x + (L.t.x - L.o.x) * e + C.u[0] * lift;
        L.foot.y = L.o.y + (L.t.y - L.o.y) * e + C.u[1] * lift;
        L.foot.z = L.o.z + (L.t.z - L.o.z) * e + C.u[2] * lift;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// WP-SKITTER: clones of the loaded rig for the skitterlings (one GLB download, shared geometry / textures / clips)
// ---------------------------------------------------------------------------------------------------------------------
export const SKITTER_VIEW = {
  variant: 'skitter',
  size: 0.45,
  clipRate: 1.5, // clips play 1.5x speed
  twitch: 0.025, // procedural quiver (m of sideways shiver per vertebra at full agitation, before the size); the body spring chain adds the rest
  lodDistance: 6, // LOD1 (20k tris) beyond 6 m; LOD0 only when it is on top of you
  lodHysteresis: 1,
  farDistance: 34, // beyond this the pose refreshes every 2nd frame
  fogHide: 0, // the red veins glow on every mesh and pierce the fog: no glow-only mode
  // 110 -> 75 m (perf pass): past the haze only the hair-thin veins show (sub-pixel beyond ~70 m), yet LOD1 is 20 k tris x 2 eyes,
  // skinned, plus its mixer and leg IK every 2nd frame
  hideDistance: 75,
  glowPierce: 0.6,
  bodyScale: 0.98,
};

/** Clones the glTF scene `n` times. Call BEFORE the Mason's own view is built (it moves the meshes out of gltf.scene). */
export function cloneSkitterScenes(gltf, n) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(cloneRigged(gltf.scene));
  return out;
}

/**
 * Builds the skitterling views from the clones of skitter_rig.glb (the original Mason model, kept for the small hunters). The
 * clips of that glTF are shared by its clones: the first view makes the additive ones additive, the others reuse them
 * (`clipsReady` = the caller already did it, e.g. the clips are those of another view).
 */
export function makeSkitterViews(scene, gltf, clones, clipsReady = false) {
  const views = [];
  for (let i = 0; i < clones.length; i++) {
    const v = new MasonRigView(scene, { parser: gltf.parser, scene: clones[i], animations: gltf.animations, sharedClips: clipsReady || i > 0 }, SKITTER_VIEW);
    v.root.name = 'SkitterRigView' + i;
    views.push(v);
  }
  return views;
}
