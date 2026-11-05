/* ABYSSAL TETHER 3D — deathOverlay.js
 * The two things a death puts on the lens (sim/deathScene.js drives them):
 *
 *   EYELIDS   an upper and a lower lid that close over the view: arcs, soft and reddish at the edge, black behind it
 *   BLOOD     a splatter on the lens (one baked 256 px texture: blobs, droplets and run-off streaks) that runs down as `drip` grows
 *
 * ONE sphere around the head (the fade sphere's trick: it is stereo-correct in a headset, no screen-space quad), one draw call, drawn
 * after the world and the black fade (renderOrder 920) and before every UI panel (950+). Both layers are a function of the VIEW
 * DIRECTION (azimuth / elevation), so the lids are arcs in the eye's own frame at any FOV and the blood is stuck to the "lens".
 * Hidden (visible = false) unless something is showing; precompiled with the rest (Renderer3D.precompile makes hidden meshes visible
 * for the compile).
 *
 * The blood map is generated in plain JS (no canvas), so tests and the node harness can build it too.
 */
import * as THREE from 'three';

const RADIUS = 0.58;
const MAP = 256;

function mulberry(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The blood splatter: R = coverage (0 clear .. 1 blood), G = thickness (the dark / bright of it). Metaballs for the splats, tiny
 * ones around them for the spray, thin vertical capsules under the big ones for the run-off. Deterministic.
 * @returns {Uint8Array} MAP * MAP * 4
 */
export function makeBloodMap(seed = 7, size = MAP) {
  const rng = mulberry(seed);
  const balls = []; // [x, y, r, w]
  const streaks = []; // [x, y0, y1, w]
  const nBig = 9;
  for (let i = 0; i < nBig; i++) {
    const x = 0.12 + rng() * 0.76;
    const y = 0.15 + rng() * 0.7;
    const r = 0.045 + rng() * 0.085;
    balls.push([x, y, r, 1]);
    // the splat's satellites: a ring of droplets flung out
    const n = 3 + ((rng() * 5) | 0);
    for (let k = 0; k < n; k++) {
      const a = rng() * Math.PI * 2;
      const d = r * (1.5 + rng() * 2.6);
      balls.push([x + Math.cos(a) * d, y + Math.sin(a) * d, r * (0.1 + rng() * 0.22), 1]);
    }
    if (rng() < 0.7) streaks.push([x + (rng() - 0.5) * r * 0.8, y, y - (0.12 + rng() * 0.3), 0.006 + rng() * 0.008]); // run-off: v grows upward, blood runs toward smaller v
  }
  for (let i = 0; i < 60; i++) balls.push([rng(), rng(), 0.004 + rng() * 0.01, 1]); // spray
  const data = new Uint8Array(size * size * 4);
  const inv = 1 / size;
  for (let j = 0; j < size; j++) {
    const v = (j + 0.5) * inv;
    for (let i = 0; i < size; i++) {
      const u = (i + 0.5) * inv;
      let f = 0;
      for (let b = 0; b < balls.length; b++) {
        const q = balls[b];
        const dx = u - q[0];
        const dy = v - q[1];
        const d2 = dx * dx + dy * dy;
        const r2 = q[2] * q[2];
        if (d2 < r2 * 6) f += (r2 / (d2 + 1e-6)) * 0.5 * q[3]; // metaball falloff (field 1 at the radius)
      }
      let s = 0;
      for (let b = 0; b < streaks.length; b++) {
        const q = streaks[b];
        if (v > q[1] || v < q[2]) continue;
        const dx = Math.abs(u - q[0]);
        const w = q[3] * (0.6 + 0.4 * ((v - q[2]) / (q[1] - q[2] || 1)));
        if (dx < w) s = Math.max(s, 1 - dx / w);
      }
      const cover = Math.max(f > 0.5 ? Math.min(1, (f - 0.5) * 6) : 0, s > 0 ? Math.min(1, s * 3) : 0);
      const o = (j * size + i) * 4;
      data[o] = Math.round(cover * 255);
      data[o + 1] = Math.round(Math.min(1, f * 0.7 + s * 0.4) * 255);
      data[o + 2] = 0;
      data[o + 3] = 255;
    }
  }
  return data;
}

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
uniform float uLids;
uniform float uBlood;
uniform float uDrip;
uniform sampler2D uMap;
varying vec3 vDir;

vec4 over(vec4 dst, vec3 c, float a) {
  return vec4(c * a + dst.rgb * (1.0 - a), a + dst.a * (1.0 - a));
}

void main() {
  vec3 d = normalize(vDir);
  float az = atan(d.x, -d.z);
  float el = atan(d.y, length(d.xz));
  vec4 acc = vec4(0.0);

  // a heaviness over the whole view as the eyes close
  acc = over(acc, vec3(0.0), 0.3 * uLids);

  // blood on the lens (+ a thin red veil), running down
  vec2 uv = vec2(az / 1.7, el / 1.2) * 0.5 + 0.5;
  float inb = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  vec4 t0 = texture2D(uMap, uv);
  vec4 t1 = texture2D(uMap, uv + vec2(0.0, 0.07 * uDrip));
  vec4 t2 = texture2D(uMap, uv + vec2(0.0, 0.16 * uDrip));
  float ba = max(t0.r, max(t1.r * 0.92, t2.r * 0.82)) * inb * uBlood;
  float th = max(t0.g, max(t1.g, t2.g));
  vec3 bc = mix(vec3(0.17, 0.0, 0.008), vec3(0.58, 0.025, 0.03), clamp(th, 0.0, 1.0));
  bc += vec3(0.3, 0.14, 0.14) * smoothstep(0.75, 1.0, th) * 0.35;
  acc = over(acc, vec3(0.1, 0.0, 0.0), 0.22 * uBlood);
  acc = over(acc, bc, clamp(ba, 0.0, 1.0));

  // the lids: arcs that meet in the middle; at the very end they flatten so nothing is left uncovered
  float k = uLids;
  float curv = 0.95 * (1.0 - smoothstep(0.86, 1.0, k));
  float a2 = az * az;
  float eu = mix(1.05, -0.32, k) + curv * a2;
  float ed = mix(-1.05, 0.30, k) - curv * a2 * 0.8;
  float s = 0.05 + 0.1 * k;
  float cu = smoothstep(eu - s, eu + s, el);
  float cd = smoothstep(ed + s, ed - s, el);
  float cover = max(cu, cd);
  float inside = max(el - eu, ed - el); // how far under a lid (rad)
  vec3 lc = mix(vec3(0.17, 0.028, 0.024), vec3(0.0), smoothstep(0.0, 0.22, inside));
  acc = over(acc, lc, cover);

  if (acc.a < 0.002) discard;
  gl_FragColor = acc; // premultiplied
}
`;

export class DeathOverlay {
  /** @param {THREE.Object3D} parent  the camera (the sphere rides the head) */
  constructor(parent) {
    const tex = new THREE.DataTexture(makeBloodMap(), MAP, MAP, THREE.RGBAFormat);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this.map = tex;
    this.material = new THREE.ShaderMaterial({
      uniforms: { uLids: { value: 0 }, uBlood: { value: 0 }, uDrip: { value: 0 }, uMap: { value: tex } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.BackSide,
      fog: false,
      toneMapped: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(RADIUS, 24, 16), this.material);
    this.mesh.name = 'deathOverlay';
    this.mesh.renderOrder = 920; // over the black fade (900), under every UI panel (950+)
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    if (parent) parent.add(this.mesh);
  }

  /** @param {{lids:number, blood:number, drip:number}|null} snap  null = nothing to show */
  update(snap) {
    const m = this.mesh;
    if (!snap) {
      m.visible = false;
      return;
    }
    const u = this.material.uniforms;
    const lids = snap.lids > 0 ? Math.min(1, snap.lids) : 0;
    const blood = snap.blood > 0 ? Math.min(1, snap.blood) : 0;
    if (lids <= 0.001 && blood <= 0.001) {
      m.visible = false;
      return;
    }
    u.uLids.value = lids;
    u.uBlood.value = blood;
    u.uDrip.value = snap.drip > 0 ? Math.min(1, snap.drip) : 0;
    m.visible = true;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.map.dispose();
  }
}
