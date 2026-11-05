/* ABYSSAL TETHER 3D — render/waterView.js
 * Water in the old shaft (sim/waterPlan.js lays it out): sheets that fall down the wall faces, thin streams that run across wide ledges and spill
 * over their lips, and the mist that rises where they land.
 *
 *   SHEETS   ONE InstancedMesh of quads (one draw call for every fall, stream and lip of the level). The look is all in the fragment shader:
 *            streaks of value noise scrolling down the sheet (faster for a fall, slower and rippled for a stream), thin at the edges and at the
 *            spout, foam at the foot of a fall; pale blue-white, brighter near the lantern, swallowed by the same radial haze as the rest of the
 *            level (the shared fog chunks). No collision, no lights, alpha-blended, no depth write.
 *   MIST     ONE Points cloud: 12 soft puffs per foot of a fall (and per lip), rising and thinning (positions animated on the CPU: ~250 points).
 *
 *   new WaterView(game)       game: { renderer.scene, level }
 *   .update(dt, game)         once per frame (Game._updateViews)
 *   .list                     the planned features (sim/waterPlan.js), read by the audio
 *   .stats                    { sheets, puffs }
 * The meshes exist (visible) from the start so the scene precompile compiles their programs.
 */
import * as THREE from 'three';
import { planWater, WATER } from '../sim/waterPlan.js';

const PUFFS = 12;

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aParams; // kind (0 fall, 1 stream, 2 lip), flow, seed, width
attribute float aLen;
varying vec2 vUv;
varying vec4 vP;
varying float vLen;
varying vec3 vW;
void main() {
  vUv = uv;
  vP = aParams;
  vLen = aLen;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform float uTime;
uniform vec3 uCam;
varying vec2 vUv;
varying vec4 vP;
varying float vLen;
varying vec3 vW;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float kind = vP.x;
  float flow = vP.y;
  float seed = vP.z;
  float width = vP.w;
  float u = vUv.x;
  float s = 1.0 - vUv.y; // 0 at the spout / the start, 1 at the foot / the lip
  float edge = smoothstep(0.0, 0.2, u) * smoothstep(1.0, 0.8, u);
  float a;
  float n;
  if (kind > 0.5 && kind < 1.5) {
    // a stream over a ledge: ripples drifting along it, thin at the edges, bright where it reaches the lip
    vec2 q = vec2(u * width * 1.8 + seed * 17.0, s * vLen * 0.8 - uTime * 1.6 * flow);
    n = 0.5 * vn(q) + 0.5 * vn(q * 2.3 + 5.0);
    a = (0.2 + 0.5 * n) * edge * smoothstep(0.0, 0.12, s) + 0.25 * smoothstep(0.85, 1.0, s) * edge;
  } else {
    // a fall: long streaks sliding down
    vec2 q = vec2(u * width * 2.6 + seed * 13.0, s * vLen * 0.2 - uTime * 3.2 * flow);
    n = 0.6 * vn(q * vec2(1.0, 0.55)) + 0.4 * vn(q * vec2(2.9, 1.5) + 7.0);
    float lip = kind > 1.5 ? 0.9 : 1.0;
    a = (0.28 + 0.62 * n) * edge * smoothstep(0.0, 0.03, s) * lip;
    a += 0.45 * smoothstep(0.93, 1.0, s) * (0.5 + 0.5 * n); // the foam where it lands
    a *= 1.0 - 0.35 * smoothstep(0.0, 0.25, 1.0 - s) * 0.0;
  }
  float d = length(vW - uCam);
  float lit = 0.26 + 0.95 * exp(-d / 15.0); // brighter in the lantern's reach, a faint sheen far off
  vec3 col = mix(vec3(0.36, 0.56, 0.66), vec3(0.9, 0.97, 1.0), n) * lit;
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.92));
  #include <fog_fragment>
}
`;

function puffTexture() {
  const n = 32;
  const data = new Uint8Array(n * n * 4);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = (i + 0.5) / n - 0.5;
      const y = (j + 0.5) / n - 0.5;
      const r = Math.sqrt(x * x + y * y) * 2;
      const v = Math.max(0, 1 - r);
      const o = (j * n + i) * 4;
      data[o] = data[o + 1] = data[o + 2] = 255;
      data[o + 3] = Math.round(v * v * 255);
    }
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const hash = (n) => {
  const s = Math.sin(n * 91.3 + 17.7) * 43758.5453;
  return s - Math.floor(s);
};

export class WaterView {
  constructor(game) {
    this.scene = game.renderer.scene;
    this.level = game.level || null;
    this.list = game.level ? planWater(game.level) : [];
    this.stats = { sheets: 0, puffs: 0 };
    this._t = 0;
    this._cam = new THREE.Vector3();
    const N = Math.max(1, this.list.length);
    const geo = new THREE.PlaneGeometry(1, 1);
    const params = new Float32Array(N * 4);
    const lens = new Float32Array(N);
    geo.setAttribute('aParams', new THREE.InstancedBufferAttribute(params, 4));
    geo.setAttribute('aLen', new THREE.InstancedBufferAttribute(lens, 1));
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() } }]);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.sheets = new THREE.InstancedMesh(geo, this.material, N);
    this.sheets.name = 'waterSheets';
    this.sheets.frustumCulled = false;
    this.sheets.renderOrder = 6;
    this.scene.add(this.sheets);
    this._lay(params, lens);
    // mist
    const feet = this.list.filter((f) => f.kind === 'fall' || f.kind === 'lip');
    this._feet = feet;
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, feet.length) * PUFFS * 3), 3));
    pg.setDrawRange(0, feet.length * PUFFS);
    this.mapTex = puffTexture();
    this.mistMat = new THREE.PointsMaterial({ map: this.mapTex, size: 1.6, sizeAttenuation: true, transparent: true, opacity: 0.22, depthWrite: false, color: 0xcfe6ee });
    this.mist = new THREE.Points(pg, this.mistMat);
    this.mist.name = 'waterMist';
    this.mist.frustumCulled = false;
    this.mist.renderOrder = 7;
    this.scene.add(this.mist);
    this.stats.sheets = this.list.length;
    this.stats.puffs = feet.length * PUFFS;
    if (!this.list.length) {
      this.sheets.visible = false;
      this.mist.visible = false;
    }
  }

  _lay(params, lens) {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const sc = new THREE.Vector3();
    for (let i = 0; i < this.list.length; i++) {
      const f = this.list[i];
      let kind = 0;
      if (f.kind === 'stream') {
        kind = 1;
        // flat, its length along (dx, dz): local +y points BACK up the flow (s = 0 at the start)
        const yaw = Math.atan2(f.dx, f.dz); // local +y after rotateX(-90deg) points to -z at yaw 0; rotated about Y by psi it points to (-sin psi, -cos psi) = against the flow
        e.set(-Math.PI / 2, 0, 0, 'XYZ');
        q.setFromEuler(e);
        const qy = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        q.premultiply(qy);
        p.set(f.x, f.y, f.z);
        sc.set(f.w, f.len, 1);
      } else {
        kind = f.kind === 'lip' ? 2 : 0;
        // upright, facing (nx, nz): the plane's normal is +z
        e.set(0, Math.atan2(f.nx, f.nz), 0, 'XYZ');
        q.setFromEuler(e);
        p.set(f.x, f.y - f.len / 2, f.z);
        sc.set(f.w, f.len, 1);
      }
      m.compose(p, q, sc);
      this.sheets.setMatrixAt(i, m);
      params[i * 4] = kind;
      params[i * 4 + 1] = f.flow;
      params[i * 4 + 2] = hash(i + 1);
      params[i * 4 + 3] = f.w;
      lens[i] = f.len;
    }
    this.sheets.instanceMatrix.needsUpdate = true;
    this.sheets.geometry.getAttribute('aParams').needsUpdate = true;
    this.sheets.geometry.getAttribute('aLen').needsUpdate = true;
  }

  update(dt, game) {
    if (!this.list.length) return;
    this._t += dt > 0 ? dt : 0;
    this.uniforms.uTime.value = this._t;
    const cam = game.renderer && game.renderer.camera;
    if (cam) {
      cam.getWorldPosition(this._cam);
      this.uniforms.uCam.value.copy(this._cam);
    }
    // the mist: each foot throws a slow column of puffs that rise, drift outward and (the sprite is soft) thin
    const pos = this.mist.geometry.getAttribute('position');
    const feet = this._feet;
    for (let i = 0; i < feet.length; i++) {
      const f = feet[i];
      const by = f.baseY;
      const cx = this._cam.x - f.x;
      const cy = this._cam.y - by;
      const cz = this._cam.z - f.z;
      const near = cx * cx + cy * cy + cz * cz < 90 * 90;
      for (let k = 0; k < PUFFS; k++) {
        const ph = (this._t * 0.22 * f.flow + k / PUFFS + hash(i * 31 + k)) % 1;
        const a = hash(i * 7 + k * 3) * Math.PI * 2;
        const r = (0.3 + ph * 1.6) * (0.6 + f.w * 0.5);
        const o = (i * PUFFS + k) * 3;
        if (!near) {
          pos.array[o + 1] = -1e5;
          continue;
        }
        pos.array[o] = f.x + (f.nx || 0) * (0.4 + ph * 1.2) + Math.cos(a) * r * 0.6;
        pos.array[o + 1] = by + 0.2 + ph * 2.4;
        pos.array[o + 2] = f.z + (f.nz || 0) * (0.4 + ph * 1.2) + Math.sin(a) * r * 0.6;
      }
    }
    pos.needsUpdate = true;
  }

  dispose() {
    for (const o of [this.sheets, this.mist]) if (o.parent) o.parent.remove(o);
    this.sheets.geometry.dispose();
    this.material.dispose();
    this.mist.geometry.dispose();
    this.mistMat.dispose();
    this.mapTex.dispose();
  }
}

export { WATER };
