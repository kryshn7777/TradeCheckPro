/* THE LANTERN (ABYSSAL TETHER 3D) — render/skitterlingView.js
 * THE HUNTER SKITTERLINGS' view (docs/abyssal-tether-3d/plans/SKITTERLINGS.md): the big red cockroaches that bite. The sim is unchanged
 * (sim/skitter3d.js: SkitterGroup of Creature3D 'skitterling' variants, their speeds, reach, wind-up, lunge, bites and sounds); this replaces
 * the old view (three skinned clones of the Mason rig, 57 k / 21 k triangles each, from a 5.4 MB GLB) with the SAME animal as the swarm
 * skitterlings, bigger and meaner: render/skitterlingModel.js, the hunter model near (LOD0, HUNTER_TRIS) and the swarm's 27-triangle model
 * far (LOD1), one InstancedMesh per LOD (<= 2 draw calls for every hunter), one shared ShaderMaterial (the HUNTER define).
 *
 * Driven by the sim's head frame: Creature3D.body.head (the point it crawls at, `hug` m off the wall, facing, dorsal up), its speed (the
 * tripod gait's clock: a phase advanced by the distance run, capped at GAIT_HZ_MAX), its attack (the wind-up = the roach REARS on its hind
 * legs, front legs up and pawing, antennae raised; the strike = it leaves the wall and flies at you, legs flung out; the recoil = it drops
 * back), its glow (a faint red sheen on the head: never eyes) and its jitter (a shiver). Allocation-free per frame; deterministic (no clock
 * of its own but dt, no random).
 *
 *   const v = new SkitterlingView(scene)     v.update(group, dt, camera, tier)     v.stats { shown, lod0, lod1, triangles, calls }
 *   v.debug.place([...]) / clear() / state()  synthetic hunters for screenshots and tests
 */
import * as THREE from 'three';
import { CREATURE_TUNING } from '../sim/creature3d.js';
import { SWARM_TRIS, buildSwarmGeometry, buildHunterGeometry, makeSkitterlingMaterial, trianglesOf } from './skitterlingModel.js';

export const HUNTER = Object.freeze({
  max: 4, // instances per LOD (SKITTER.maxAlive is 3; one spare for the debug placements)
  len: 0.4, // m: the model's unit (the shield ~0.42 m, ~0.48 m with the head and cerci; the antennae reach ~0.6 m ahead)
  lod: Object.freeze({ high: 10, quest: 6, low: 4 }), // m: LOD0 within this of the camera
  lodHysteresis: 0.75,
  gaitStride: 0.32, // m of travel per gait cycle at speed
  gaitHzMax: 16, // the tripod never cycles faster than this (a blur of legs, not a strobe)
  speedFull: 1.6, // m/s: the leg swing at full amplitude
  rearPitch: 0.62, // rad the body tips up on its hind legs at full rear-up
  rearPivot: -0.42, // the pivot of that tip (model units: the hind feet)
  headZ: 0.56, // model units: where the sim's head point sits along the body
  amb: Object.freeze([0.06, 0.04, 0.035]), // a trace more ambient than the swarm: the hunter's silhouette survives a dim lantern
});

export const HUNTER_TRIS = trianglesOf(buildHunterGeometry());

const TAU = Math.PI * 2;

function hashSeed(i) {
  let h = Math.imul(i + 1, 0x9e3779b1) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b) >>> 0;
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
}

/** The rear-up (0..1) and the leap (0..1: off the wall, at you) the sim's attack asks for this frame. */
export function poseTargets(c, out) {
  out.rear = 0;
  out.leap = 0;
  if (c.dbgRear != null || c.dbgLeap != null) {
    out.rear = +c.dbgRear || 0;
    out.leap = +c.dbgLeap || 0;
    return out;
  }
  const a = c.attack;
  if (c.state === 'ATTACK' && a && a.phase) {
    if (a.phase === 'windup') out.rear = Math.sin(Math.min(1, Math.max(0, a.t / Math.max(a.windup, 0.05))) * Math.PI * 0.5);
    else if (a.phase === 'strike') out.leap = 1;
    else out.leap = Math.max(0, 1 - a.t / CREATURE_TUNING.postStrike);
  }
  return out;
}

export class SkitterlingView {
  constructor(scene) {
    this.scene = scene;
    const N = HUNTER.max;
    this.material = makeSkitterlingMaterial(true, new THREE.Color(HUNTER.amb[0], HUNTER.amb[1], HUNTER.amb[2]));
    this.uniforms = this.material.uniforms;
    this.lods = [this._mesh(buildHunterGeometry(), 'skitterlings-hunter-lod0'), this._mesh(buildSwarmGeometry(), 'skitterlings-hunter-lod1')];
    this.tris = [HUNTER_TRIS, SWARM_TRIS];
    // per slot (the sim's slot index): the gait phase, the eased rear / leap, the LOD it is drawn at
    this.ph = new Float64Array(N);
    this.rear = new Float64Array(N);
    this.leap = new Float64Array(N);
    this.lod = new Int8Array(N);
    this.seed = new Float32Array(N);
    for (let i = 0; i < N; i++) this.seed[i] = 0.25 + 0.5 * hashSeed(i);
    this.stats = { shown: 0, lod0: 0, lod1: 0, triangles: 0, calls: 0 };
    this._t = 0;
    this._pose = { rear: 0, leap: 0 };
    this._dbg = null; // synthetic hunters (debug.place)
    this.debug = this._makeDebug();
  }

  _mesh(geo, name) {
    const N = HUNTER.max;
    const anim = new Float32Array(N * 4);
    const pose = new Float32Array(N * 4);
    const aAnim = new THREE.InstancedBufferAttribute(anim, 4);
    const aPose = new THREE.InstancedBufferAttribute(pose, 4);
    aAnim.setUsage(THREE.DynamicDrawUsage);
    aPose.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAnim', aAnim);
    geo.setAttribute('aPose', aPose);
    const m = new THREE.InstancedMesh(geo, this.material, N);
    m.name = name;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; // at most four instances: the GPU clips them for less than a bounds pass costs
    m.count = 0;
    m.visible = false;
    m.userData.noShadowCast = true;
    m.userData.anim = anim;
    m.userData.pose = pose;
    m.userData.aAnim = aAnim;
    m.userData.aPose = aPose;
    if (this.scene) this.scene.add(m);
    return m;
  }

  /**
   * Once per frame. `group`: the SkitterGroup (or null), its slots are drawn in order; `camera` picks the LOD; `tier` the LOD distance.
   * Returns how many hunters are drawn.
   */
  update(group, dt, camera, tier) {
    const d = dt > 0 ? dt : 0;
    this._t = (this._t + d) % 1000;
    this.uniforms.uTime.value = this._t;
    const list = this._dbg || (group && group.slots) || null;
    const m0 = this.lods[0];
    const m1 = this.lods[1];
    let n0 = 0;
    let n1 = 0;
    if (list) {
      const lodD = HUNTER.lod[tier] || HUNTER.lod.high;
      const ce = camera ? camera.matrixWorld.elements : null;
      const N = Math.min(list.length, HUNTER.max);
      for (let i = 0; i < N; i++) {
        const c = list[i];
        if (!c || !c.on || !c.body || !c.body.visible) {
          this.rear[i] = this.leap[i] = 0;
          continue;
        }
        const B = c.body;
        const h = B.head;
        // the gait: a phase advanced by the distance run (the tripod alternates in the shader), capped
        const sp = c.speed > 0 ? c.speed : 0;
        const hz = Math.min(sp / HUNTER.gaitStride, HUNTER.gaitHzMax);
        this.ph[i] = (this.ph[i] + hz * TAU * d) % (TAU * 64);
        // the attack pose, eased (the rear in 0.08 s, the leap at once out and 0.12 s back)
        const P = poseTargets(c, this._pose);
        const kr = d > 0 ? 1 - Math.exp(-d / 0.08) : 1;
        this.rear[i] += (P.rear - this.rear[i]) * kr;
        if (P.leap > this.leap[i]) this.leap[i] = P.leap;
        else this.leap[i] += (P.leap - this.leap[i]) * (d > 0 ? 1 - Math.exp(-d / 0.12) : 1);
        if (c.dbgRear != null) this.rear[i] = P.rear;
        if (c.dbgLeap != null) this.leap[i] = P.leap;
        // the frame: up = the dorsal normal, forward = the facing flattened onto the surface, right = up x forward
        let ux = h.ux;
        let uy = h.uy;
        let uz = h.uz;
        let l = Math.sqrt(ux * ux + uy * uy + uz * uz);
        if (l < 1e-6) {
          ux = 0;
          uy = 1;
          uz = 0;
        } else {
          ux /= l;
          uy /= l;
          uz /= l;
        }
        let fx = h.fx;
        let fy = h.fy;
        let fz = h.fz;
        const fu = fx * ux + fy * uy + fz * uz;
        fx -= ux * fu;
        fy -= uy * fu;
        fz -= uz * fu;
        l = Math.sqrt(fx * fx + fy * fy + fz * fz);
        if (l < 1e-4) {
          // facing straight along the normal: any tangent
          fx = Math.abs(uy) < 0.9 ? -uz : 0;
          fy = Math.abs(uy) < 0.9 ? 0 : uz;
          fz = Math.abs(uy) < 0.9 ? ux : -uy;
          l = Math.sqrt(fx * fx + fy * fy + fz * fz) || 1;
        }
        fx /= l;
        fy /= l;
        fz /= l;
        // rear up: tip forward / up about the right axis
        const a = this.rear[i] * HUNTER.rearPitch;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const Fx = fx * ca + ux * sa;
        const Fy = fy * ca + uy * sa;
        const Fz = fz * ca + uz * sa;
        const Ux = ux * ca - fx * sa;
        const Uy = uy * ca - fy * sa;
        const Uz = uz * ca - fz * sa;
        const xx = Uy * Fz - Uz * Fy;
        const xy = Uz * Fx - Ux * Fz;
        const xz = Ux * Fy - Uy * Fx;
        // the body on the surface under the head point (the sim holds the head `hug` m off the wall), off it as it leaps
        const s = HUNTER.len;
        const hug = CREATURE_TUNING.hug * (B.size || 0.45) * (1 - this.leap[i]);
        const zp = HUNTER.rearPivot * s;
        const ox = h.x - ux * hug - fx * HUNTER.headZ * s + fx * zp - Fx * zp;
        const oy = h.y - uy * hug - fy * HUNTER.headZ * s + fy * zp - Fy * zp;
        const oz = h.z - uz * hug - fz * HUNTER.headZ * s + fz * zp - Fz * zp;
        // the level of detail, with hysteresis
        let lod = this.lod[i];
        if (ce) {
          const dx = ox - ce[12];
          const dy = oy - ce[13];
          const dz = oz - ce[14];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < lodD - HUNTER.lodHysteresis) lod = 0;
          else if (dist > lodD + HUNTER.lodHysteresis) lod = 1;
        } else lod = 0;
        this.lod[i] = lod;
        const m = lod === 0 ? m0 : m1;
        const k = lod === 0 ? n0++ : n1++;
        const arr = m.instanceMatrix.array;
        const o = k * 16;
        arr[o] = xx * s;
        arr[o + 1] = xy * s;
        arr[o + 2] = xz * s;
        arr[o + 3] = 0;
        arr[o + 4] = Ux * s;
        arr[o + 5] = Uy * s;
        arr[o + 6] = Uz * s;
        arr[o + 7] = 0;
        arr[o + 8] = Fx * s;
        arr[o + 9] = Fy * s;
        arr[o + 10] = Fz * s;
        arr[o + 11] = 0;
        arr[o + 12] = ox;
        arr[o + 13] = oy;
        arr[o + 14] = oz;
        arr[o + 15] = 1;
        const an = m.userData.anim;
        const q = k * 4;
        an[q] = this.ph[i];
        an[q + 1] = Math.min(1, sp / HUNTER.speedFull);
        an[q + 2] = this.seed[i];
        const tw = 0.35 + 0.65 * (B.listen || 0) + 0.5 * (B.jitter || 0);
        an[q + 3] = tw > 1 ? 1 : tw;
        const po = m.userData.pose;
        po[q] = this.rear[i];
        po[q + 1] = this.leap[i];
        po[q + 2] = B.glow > 0 ? (B.glow < 1 ? B.glow : 1) : 0;
        po[q + 3] = B.jitter > 0 ? (B.jitter < 1 ? B.jitter : 1) : 0;
      }
    }
    this._commit(m0, n0);
    this._commit(m1, n1);
    const st = this.stats;
    st.shown = n0 + n1;
    st.lod0 = n0;
    st.lod1 = n1;
    st.triangles = n0 * this.tris[0] + n1 * this.tris[1];
    st.calls = (n0 > 0 ? 1 : 0) + (n1 > 0 ? 1 : 0);
    return st.shown;
  }

  _commit(m, n) {
    m.count = n;
    m.visible = n > 0;
    if (n > 0) {
      // whole buffers (4 x 96 bytes): three's update ranges allocate (see roachView.js)
      m.instanceMatrix.needsUpdate = true;
      m.userData.aAnim.needsUpdate = true;
      m.userData.aPose.needsUpdate = true;
    }
  }

  _makeDebug() {
    const self = this;
    return {
      /**
       * Synthetic hunters (screenshots, tests) in place of the sim's until clear(): each { x, y, z (a point ON the surface), ux, uy, uz
       * (its normal, default up), fx, fy, fz (facing), speed, rear 0..1, leap 0..1, glow, jitter, state }.
       */
      place(list) {
        const out = [];
        const arr = Array.isArray(list) ? list : [list];
        for (let i = 0; i < arr.length && i < HUNTER.max; i++) {
          const o = arr[i] || {};
          const ux = o.ux == null ? 0 : +o.ux;
          const uy = o.uy == null ? 1 : +o.uy;
          const uz = o.uz == null ? 0 : +o.uz;
          const size = 0.45;
          const hug = CREATURE_TUNING.hug * size;
          out.push({
            on: true,
            state: o.state || 'PURSUING',
            speed: +o.speed || 0,
            attack: { phase: null, t: 0, windup: 0.5 },
            dbgRear: o.rear == null ? 0 : +o.rear,
            dbgLeap: o.leap == null ? 0 : +o.leap,
            body: {
              visible: true,
              size,
              glow: o.glow == null ? 0.45 : +o.glow,
              jitter: +o.jitter || 0,
              listen: +o.listen || 0,
              head: { x: +o.x + ux * hug, y: +o.y + uy * hug, z: +o.z + uz * hug, fx: o.fx == null ? 0 : +o.fx, fy: +o.fy || 0, fz: o.fz == null ? 1 : +o.fz, ux, uy, uz },
            },
          });
        }
        self._dbg = out;
        return out.length;
      },
      clear() {
        self._dbg = null;
        return true;
      },
      state() {
        return { synthetic: !!self._dbg, ...self.stats, lods: Array.from(self.lod), rear: Array.from(self.rear), leap: Array.from(self.leap), tris: self.tris.slice() };
      },
    };
  }

  dispose() {
    for (const m of this.lods) {
      if (m.parent) m.parent.remove(m);
      m.geometry.dispose();
    }
    this.material.dispose();
  }
}
