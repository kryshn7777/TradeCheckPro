/* ABYSSAL TETHER 3D — render/mereView.js
 * THE MERE: the last image of Chapter II (docs/abyssal-tether-3d/plans/CHAPTER_II_DIRECTION.md section 4). Black water, perfectly still, a field of dark
 * lanterns floating on it like lilies, and the Ushers of the Mere standing under it in ranks: each a throat that, once the wave of clicks has reached it, shows a
 * pale ring; the nearest one rises beside the platform and opens its ring at your eye height; then they all rise and bow into an aisle of arches that runs away
 * into the fog, to one small warm light.
 *
 *   const v = new MereView(scene)
 *   v.build(hook)                    hook = level.data.c2.hook (water.y, chain {x, y, z}, aisle {x, z}, seat {dist})
 *   v.update(dt, hookState, platformY)   hookState = HookSequence.state (open, wave, rear, bow, seat); shows itself while open > 0
 *   v.dispose()
 *
 * Four draw calls: the water, the lanterns (instanced), the throats with their rings (instanced, bent in the vertex shader: no CPU work per frame), the seat's
 * light. No per-frame allocation. DOM-free apart from three.js; Node-testable with no renderer (the test builds it and reads `stats`).
 */
import * as THREE from 'three';

const COUNTS = { lanterns: 1400, ranks: 17, columns: 3 };
const TUBE_SEG = 18;
const TUBE_RAD = 6;

const hash = (n) => {
  let x = Math.imul(n ^ 0x9e3779b1, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
};

/** A unit stem: a tube along +y (0..1) with an annular ring on its tip. `part` = 0 on the tube, 1 on the ring (the shader scales and bends them). */
export function stemGeometry() {
  const pos = [];
  const part = [];
  const idx = [];
  for (let i = 0; i <= TUBE_SEG; i++) {
    for (let j = 0; j < TUBE_RAD; j++) {
      const a = (j / TUBE_RAD) * Math.PI * 2;
      pos.push(Math.cos(a), i / TUBE_SEG, Math.sin(a));
      part.push(0);
    }
  }
  for (let i = 0; i < TUBE_SEG; i++) {
    for (let j = 0; j < TUBE_RAD; j++) {
      const a = i * TUBE_RAD + j;
      const b = i * TUBE_RAD + ((j + 1) % TUBE_RAD);
      idx.push(a, b, a + TUBE_RAD, b, b + TUBE_RAD, a + TUBE_RAD);
    }
  }
  // the ring: 12 quads of an annulus (inner 0.5, outer 1.0 of the ring radius), at s = 1
  const base = pos.length / 3;
  const N = 12;
  for (let j = 0; j < N; j++) {
    const a = (j / N) * Math.PI * 2;
    pos.push(Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5, Math.cos(a), 1, Math.sin(a));
    part.push(1, 1);
  }
  for (let j = 0; j < N; j++) {
    const i0 = base + j * 2;
    const i1 = base + ((j + 1) % N) * 2;
    idx.push(i0, i0 + 1, i1, i1, i0 + 1, i1 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setIndex(idx);
  return g;
}

const STEM_VERT = `
attribute float aPart;
attribute vec3 aBase;
attribute vec2 aDir;
attribute float aLen;
attribute float aPhase;
attribute float aDist;
attribute float aNear;
uniform float uWave, uRear, uBow, uTime, uWaterY, uEye;
varying float vLit;
varying float vPart;
varying float vS;
void main() {
  float s = position.y;
  // how far the throat stands out of the water (m over the surface): submerged, risen beside you, or standing tall to bow
  float tall = aLen * (0.7 + 0.3 * aPhase);
  float nearH = mix(-3.0, uEye, uRear); // the near throat rises to your eye height and waits
  float H = mix(mix(-3.0, tall, uBow), mix(nearH, tall, uBow), aNear);
  float Ls = H + 3.0;
  float th = mix(uBow * 1.65 * (0.8 + 0.2 * aPhase), 0.28 * uRear * (1.0 - uBow) + uBow * 1.65, aNear);
  float a = s * th;
  float R = th > 0.001 ? Ls / th : 1e6;
  float along = th > 0.001 ? R * sin(a) : s * Ls;
  float out_ = th > 0.001 ? R * (1.0 - cos(a)) : 0.0;
  vec3 dir = vec3(aDir.x, 0.0, aDir.y);
  vec3 c = aBase + vec3(0.0, uWaterY - 3.0 + along, 0.0) + dir * out_;
  // the frame: tangent T (up, leaning into dir), normal N (in the bend plane), binormal B (across)
  vec3 T = vec3(0.0, cos(a), 0.0) + dir * sin(a);
  vec3 N = vec3(0.0, -sin(a), 0.0) + dir * cos(a);
  vec3 B = vec3(-dir.z, 0.0, dir.x);
  float r = aPart > 0.5 ? 0.62 : 0.13 + 0.05 * (1.0 - s);
  vec3 p = c + N * position.x * r + B * position.z * r;
  vS = s;
  vPart = aPart;
  vLit = step(aDist, uWave) * (0.65 + 0.35 * sin(uTime * 1.3 + aPhase * 6.28)) + uRear * aNear;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const STEM_FRAG = `
varying float vLit;
varying float vPart;
varying float vS;
void main() {
  vec3 tube = vec3(0.06, 0.065, 0.075) * (0.5 + 0.5 * vS);
  vec3 ring = vec3(0.62, 0.85, 0.92) * clamp(vLit, 0.0, 1.4);
  vec3 col = mix(tube + ring * 0.05 * vS, ring + vec3(0.04), vPart);
  gl_FragColor = vec4(col, 1.0);
}`;

const LANTERN_VERT = `
attribute vec3 aPos;
attribute float aSeed;
uniform float uWave, uTime, uWaterY, uOrigin0, uOrigin1;
varying float vGlow;
void main() {
  float d = length(vec2(aPos.x - uOrigin0, aPos.z - uOrigin1));
  vGlow = step(d, uWave) * (0.35 + 0.25 * sin(uTime * 0.8 + aSeed * 40.0));
  vec3 p = aPos + position * vec3(0.5, 0.35, 0.5);
  p.y += uWaterY + 0.08 + 0.03 * sin(uTime * 0.6 + aSeed * 20.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const LANTERN_FRAG = `
varying float vGlow;
void main() {
  vec3 col = vec3(0.05, 0.035, 0.03) + vec3(0.9, 0.55, 0.25) * vGlow;
  gl_FragColor = vec4(col, 1.0);
}`;

export class MereView {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group();
    this.root.name = 'AT3D-mere';
    this.root.visible = false;
    this.stats = { stems: 0, lanterns: 0, drawCalls: 0, shown: false };
    this._built = false;
    this._t = 0;
    this.u = {
      uWave: { value: 0 },
      uRear: { value: 0 },
      uBow: { value: 0 },
      uTime: { value: 0 },
      uWaterY: { value: 0 },
      uEye: { value: 7.6 },
    };
    this.ul = { uWave: { value: 0 }, uTime: this.u.uTime, uWaterY: this.u.uWaterY, uOrigin0: { value: 0 }, uOrigin1: { value: 0 } };
    this.parts = {};
    if (scene && scene.add) scene.add(this.root);
  }

  build(hook) {
    if (this._built || !hook) return;
    this._built = true;
    const wy = hook.water.y;
    const ch = hook.chain;
    const ax = hook.aisle ? hook.aisle.x : 1;
    const az = hook.aisle ? hook.aisle.z : 0;
    const px = -az; // across the aisle
    const pz = ax;
    this.u.uWaterY.value = wy;
    this.ul.uOrigin0.value = ch.x;
    this.ul.uOrigin1.value = ch.z;
    // the water: one big dark plane, a hair of sheen from the ring light is the fog's job
    const water = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200), new THREE.MeshBasicMaterial({ color: 0x020406, fog: true }));
    water.rotation.x = -Math.PI / 2;
    water.position.set(ch.x, wy, ch.z);
    water.name = 'mere-water';
    water.frustumCulled = false;
    this.root.add(water);
    this.parts.water = water;
    // the lanterns: dark lilies on the water, lit from below once the wave has passed
    {
      const n = COUNTS.lanterns;
      const g = new THREE.InstancedBufferGeometry();
      const b = new THREE.BoxGeometry(1, 1, 1);
      g.index = b.index;
      g.setAttribute('position', b.getAttribute('position'));
      const aPos = new Float32Array(n * 3);
      const aSeed = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const r = 14 + Math.sqrt(hash(i * 3 + 1)) * 190;
        const a = hash(i * 3 + 2) * Math.PI * 2;
        aPos[i * 3] = ch.x + Math.cos(a) * r;
        aPos[i * 3 + 1] = 0;
        aPos[i * 3 + 2] = ch.z + Math.sin(a) * r;
        aSeed[i] = hash(i * 3 + 3);
      }
      g.setAttribute('aPos', new THREE.InstancedBufferAttribute(aPos, 3));
      g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(aSeed, 1));
      g.instanceCount = n;
      const m = new THREE.ShaderMaterial({ vertexShader: LANTERN_VERT, fragmentShader: LANTERN_FRAG, uniforms: this.ul });
      const mesh = new THREE.Mesh(g, m);
      mesh.name = 'mere-lanterns';
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.parts.lanterns = mesh;
      this.stats.lanterns = n;
    }
    // the Ushers of the Mere: ranks along the aisle, columns either side of it; the first one (aNear) rises beside the platform
    {
      const list = [];
      list.push({ x: ch.x + px * 2.2 + ax * 0.5, z: ch.z + pz * 2.2 + az * 0.5, side: -1, near: 1, len: 8, seed: 0.3 });
      for (let k = 0; k < COUNTS.ranks; k++) {
        for (let c = 0; c < COUNTS.columns; c++) {
          for (const side of [-1, 1]) {
            const lat = (6 + c * 7.5 + (hash(k * 17 + c * 5 + (side > 0 ? 1 : 2)) - 0.5) * 2.2) * side;
            const along = 12 + k * 9.5 + (hash(k * 31 + c * 7 + (side > 0 ? 3 : 4)) - 0.5) * 3;
            list.push({ x: ch.x + ax * along + px * lat, z: ch.z + az * along + pz * lat, side, near: 0, len: 6 + hash(k * 13 + c * 3 + 5) * 3.5, seed: hash(k * 7 + c + side) });
          }
        }
      }
      const n = list.length;
      const g = new THREE.InstancedBufferGeometry();
      const sg = stemGeometry();
      g.index = sg.index;
      g.setAttribute('position', sg.getAttribute('position'));
      g.setAttribute('aPart', sg.getAttribute('aPart'));
      const aBase = new Float32Array(n * 3);
      const aDir = new Float32Array(n * 2);
      const aLen = new Float32Array(n);
      const aPhase = new Float32Array(n);
      const aDist = new Float32Array(n);
      const aNear = new Float32Array(n);
      list.forEach((s, i) => {
        aBase[i * 3] = s.x;
        aBase[i * 3 + 1] = 0;
        aBase[i * 3 + 2] = s.z;
        // they bow toward the aisle's centre line (side -1 bows toward +perp, side 1 toward -perp); the near one toward the platform
        aDir[i * 2] = px * -s.side;
        aDir[i * 2 + 1] = pz * -s.side;
        aLen[i] = s.len;
        aPhase[i] = s.seed;
        aDist[i] = Math.hypot(s.x - ch.x, s.z - ch.z);
        aNear[i] = s.near;
      });
      g.setAttribute('aBase', new THREE.InstancedBufferAttribute(aBase, 3));
      g.setAttribute('aDir', new THREE.InstancedBufferAttribute(aDir, 2));
      g.setAttribute('aLen', new THREE.InstancedBufferAttribute(aLen, 1));
      g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(aPhase, 1));
      g.setAttribute('aDist', new THREE.InstancedBufferAttribute(aDist, 1));
      g.setAttribute('aNear', new THREE.InstancedBufferAttribute(aNear, 1));
      g.instanceCount = n;
      const m = new THREE.ShaderMaterial({ vertexShader: STEM_VERT, fragmentShader: STEM_FRAG, uniforms: this.u, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, m);
      mesh.name = 'mere-stems';
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.parts.stems = mesh;
      this.stats.stems = n;
    }
    // the seat: one small warm light (the only lamp in the Mere that nobody lit) at the far end of the aisle, drawn through the fog
    {
      const d = hook.seat ? hook.seat.dist : 180;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([ch.x + ax * d, wy + 2.4, ch.z + az * d], 3));
      const m = new THREE.PointsMaterial({ color: 0xffb860, size: 14, sizeAttenuation: false, fog: false, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending });
      const pts = new THREE.Points(g, m);
      pts.name = 'mere-seat';
      pts.frustumCulled = false;
      this.root.add(pts);
      this.parts.seat = pts;
    }
    this.stats.drawCalls = 4;
  }

  /** hookState: HookSequence.state; platformY: the chain platform's height now (the near throat rises to its eye height). */
  update(dt, st, platformY) {
    if (!this._built) return;
    const show = !!st && st.open > 0;
    this.root.visible = show;
    this.stats.shown = show;
    if (!show) return;
    this._t += dt;
    this.u.uTime.value = this._t;
    this.u.uWave.value = st.wave;
    this.ul.uWave.value = st.wave;
    this.u.uRear.value = st.rear;
    this.u.uBow.value = st.bow;
    this.u.uEye.value = Math.max(2, platformY + 1.6 - this.u.uWaterY.value);
    const seat = this.parts.seat;
    if (seat) seat.material.opacity = st.seat * (0.85 + 0.15 * Math.sin(this._t * 2.1));
  }

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
  }
}
