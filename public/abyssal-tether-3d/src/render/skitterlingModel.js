/* THE LANTERN (ABYSSAL TETHER 3D) — render/skitterlingModel.js
 * THE SKITTERLINGS, ONE SPECIES (docs/abyssal-tether-3d/plans/SKITTERLINGS.md): the red, glossy cockroach model and its wet-chitin shader,
 * shared by both tiers so they are plainly the same animal:
 *
 *   swarm skitterlings   tiny (3.4 cm), ambient, harmless: sim/roaches.js + render/roachView.js, ONE InstancedMesh of the 27-triangle model
 *   hunter skitterlings  the big ones that bite (sim/skitter3d.js, unchanged): render/skitterlingView.js, the HUNTER model (LOD0, ~160
 *                        triangles) near, the swarm's 27-triangle model (LOD1) far, the same shader with the HUNTER define (rear-up / lunge)
 *
 * MODEL (1 unit long, +z forward, +y off the surface, origin at the middle of the body on the surface). Per vertex aRig = (part, weight,
 * tripod phase, side): part 0 carapace / 1 head (and cerci) / 2 + 0.1 * pair a leg (pair 0 front, 1 middle, 2 hind) / 3 antenna; weight 0 at
 * the root .. 1 at the tip; the alternating tripod L1 R2 L3 (phase 0) against R1 L2 R3 (phase PI); side -1 left / +1 right.
 * Per instance aAnim = (gait phase, speed 0..1 (< 0: a swarm smear, -1 fresh .. 0 gone), seed 0..1, antenna twitch 0..1); the HUNTER define
 * adds aPose = (rear 0..1: the front legs raised and pawing, antennae up; lunge 0..1: the legs flung out; glint 0..1: the faint red sheen
 * on the head, never eyes (the Mason's two red eyes stay its own); agitation 0..1: a shiver).
 * LOOK: the carried lantern only (the shared LOOK uniforms the lighting drives), a lacquered red with a hard glint, the wing-case seam, a lighter
 * pronotum, darker legs; the level's fog. No textures, no outlines, no toon bands (the realistic shading pass: never injectToon here).
 */
import * as THREE from 'three';
import { LOOK } from './materials.js';

export const SWARM_TRIS = 27;

export const SKITTERLING_VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aRig;   // part, weight, tripod phase, side
attribute vec4 aAnim;  // gait phase, speed (< 0 smear), seed, twitch
#ifdef HUNTER
attribute vec4 aPose;  // rear, lunge, glint, agitation
varying float vGlint;
#endif
uniform float uTime;
varying vec3 vN;
varying vec3 vW;
varying vec3 vObj;
varying vec4 vInfo;    // part, seed, smear 0..1 (1 fresh), weight
void main() {
  vec3 p = position;
  vec3 n = normal;
  float part = aRig.x;
  float w = aRig.y;
  float spd = clamp(aAnim.y, 0.0, 1.0);
  float smear = aAnim.y < 0.0 ? -aAnim.y : 0.0;
  float seed = aAnim.z;
  float tw = aAnim.w;
#ifdef HUNTER
  float rear = aPose.x;
  float lunge = aPose.y;
  vGlint = aPose.z;
#endif
  if (smear > 0.0) {
    // squished: flat, splayed, shrinking away as it dries
    float k = sqrt(smear);
    p.y *= 0.04;
    if (part > 2.5) p *= 0.0; // the antennae are gone
    else if (part > 1.5) p.xz *= 0.55; // the legs: a few stubs at the rim
    else if (part > 0.5) p.xz *= vec2(1.4, 0.72); // the head pressed into it
    else p.xz *= vec2(1.75, 1.35) * (1.0 + 0.22 * sin(p.z * 19.0 + p.x * 11.0 + seed * 30.0)); // an irregular splat
    p.xz *= k;
    n = vec3(0.0, 1.0, 0.0);
  } else {
    float ph = aAnim.x;
    if (part > 1.5 && part < 2.5) {
      // the tripod: a foot swings forward lifted, plants and pulls back
      float g = ph + aRig.z;
      float amp = 0.05 + 0.95 * spd;
      p.z += sin(g) * 0.16 * amp * w;
      p.y += max(0.0, cos(g)) * 0.07 * amp * w;
      p.x += sin(uTime * 23.0 + seed * 37.0 + aRig.z * 3.0) * 0.012 * (1.0 - spd) * w * tw; // a twitch at rest
#ifdef HUNTER
      float pair = floor((part - 2.0) * 10.0 + 0.5);
      if (pair < 0.5) {
        // the front pair rises and paws the air (the telegraph), then is thrown forward in the lunge
        p.y += rear * 0.42 * w + rear * sin(uTime * 26.0 + aRig.w * 1.7) * 0.06 * w;
        p.z += rear * 0.2 * w + lunge * 0.3 * w;
      } else {
        // the others brace back and out
        p.z -= (rear * 0.06 + lunge * 0.16) * w * pair;
        p.x += aRig.w * (rear * 0.05 + lunge * 0.08) * w;
      }
#endif
    } else if (part > 2.5) {
      // the antennae sweep and twitch (harder when it freezes)
      float a = sin(uTime * (5.0 + seed * 6.0) + seed * 21.0 + aRig.w) * (0.08 + 0.3 * tw) + sin(uTime * 17.0 + seed * 9.0) * 0.08 * tw;
      p.x += a * w * w * 0.8;
      p.y += sin(uTime * 7.3 + seed * 13.0 + aRig.w * 2.0) * 0.06 * tw * w;
#ifdef HUNTER
      p.y += rear * 0.3 * w;
      p.x += aRig.w * rear * 0.12 * w;
#endif
    } else {
      p.y *= 1.0 + sin(ph * 2.0) * 0.06 * spd; // the body bobs as it runs
#ifdef HUNTER
      p.x += sin(uTime * 41.0 + p.z * 9.0 + seed * 17.0) * 0.008 * aPose.w; // the shiver
#endif
    }
  }
  vObj = p;
  vInfo = vec4(part, seed, smear, w);
  vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
  vW = wp.xyz;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * n);
  vec4 mvPosition = viewMatrix * wp;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

export const SKITTERLING_FRAG = /* glsl */ `
#include <common>
#include <fog_pars_fragment>
uniform vec3 uLanternW;
uniform vec4 uLanternC;
uniform vec2 uLanternR;
uniform vec3 uAmb;
varying vec3 vN;
varying vec3 vW;
varying vec3 vObj;
varying vec4 vInfo;
#ifdef HUNTER
varying float vGlint;
#endif
void main() {
  float part = vInfo.x;
  float seed = vInfo.y;
  float smear = vInfo.z;
  vec3 N = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
  // albedo: a lacquered red, darker legs, a lighter pronotum behind the head, a dark seam down the wing cases
  vec3 red = mix(vec3(0.40, 0.030, 0.018), vec3(0.62, 0.075, 0.030), seed);
  vec3 alb = red;
  float gloss = 1.0;
  if (part > 1.5) {
    alb = red * vec3(0.45, 0.32, 0.30);
    gloss = 0.25;
  } else if (part > 0.5) {
    alb = red * 0.55;
  } else {
    float pron = smoothstep(0.16, 0.22, vObj.z);
    alb = mix(alb, red * vec3(1.15, 1.25, 1.1) + vec3(0.03, 0.006, 0.0), pron);
    alb *= mix(1.0, 0.45, (1.0 - smoothstep(0.0, 0.025, abs(vObj.x))) * (1.0 - pron));
#ifdef HUNTER
    alb *= mix(1.0, 0.5, 1.0 - smoothstep(0.0, 0.012, abs(vObj.z - 0.17))); // the pronotum's rim over the wing cases
#endif
  }
  if (smear > 0.0) {
    alb = vec3(0.16, 0.012, 0.008);
    gloss = 0.7;
  }
  vec3 V = normalize(cameraPosition - vW);
  vec3 col = alb * uAmb;
  vec3 Lv = uLanternW - vW;
  float d = length(Lv);
  if (d < uLanternR.x) {
    vec3 l = Lv / max(d, 1e-3);
    float at = pow2(saturate(1.0 - pow4(d / uLanternR.x))) / max(pow(d, uLanternR.y), 0.01);
    float nl = dot(N, l);
    float wrap = saturate((nl + 0.35) / 1.35);
    vec3 H = normalize(l + V);
    float nh = saturate(dot(N, H));
    float spec = pow(nh, 70.0) * 2.2 + pow(nh, 12.0) * 0.12; // a hard chitin glint over a soft sheen
    float rim = pow(1.0 - saturate(dot(N, V)), 4.0) * 0.35;
    vec3 Lc = uLanternC.rgb * at;
    col += alb * Lc * wrap * RECIPROCAL_PI;
    col += Lc * (spec * gloss * saturate(nl * 4.0) + rim * gloss * 0.25) * vec3(1.0, 0.86, 0.72) * 0.16;
  }
#ifdef HUNTER
  // a faint wet red sheen on the head and the front of the shield when it hunts: a glint, not eyes
  float hg = (part > 0.5 && part < 1.5 && vObj.z > 0.3) ? 1.0 : smoothstep(0.3, 0.46, vObj.z) * (part < 0.5 ? 0.5 : 0.0);
  col += vec3(0.11, 0.006, 0.003) * vGlint * hg * pow(1.0 - saturate(dot(N, V)), 1.5);
#endif
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** The species material. `hunter`: the HUNTER define (aPose: rear-up, lunge, glint, shiver). No toon, no outline. */
export function makeSkitterlingMaterial(hunter = false, amb = null) {
  const uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uAmb: { value: amb || new THREE.Color(0.05, 0.035, 0.03) } }]);
  // the shared lantern uniforms (driven by the lighting each frame), by reference
  uniforms.uLanternW = LOOK.uLanternW;
  uniforms.uLanternC = LOOK.uLanternC;
  uniforms.uLanternR = LOOK.uLanternR;
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: SKITTERLING_VERT, fragmentShader: SKITTERLING_FRAG, fog: true, side: THREE.DoubleSide });
  if (hunter) mat.defines = { HUNTER: '' };
  mat.userData.noLook = true;
  return mat;
}

function builder() {
  const P = [];
  const Nn = [];
  const R = [];
  const idx = [];
  const add = (x, y, z, nx, ny, nz, part, w, ph, side) => {
    P.push(x, y, z);
    const l = Math.hypot(nx, ny, nz) || 1;
    Nn.push(nx / l, ny / l, nz / l);
    R.push(part, w, ph, side);
    return P.length / 3 - 1;
  };
  const geo = () => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
    g.setAttribute('aRig', new THREE.Float32BufferAttribute(R, 4));
    g.setIndex(idx);
    return g;
  };
  return { add, idx, geo };
}

/** The tripod: L1 R2 L3 move together (phase 0), R1 L2 R3 against them (phase PI). pair 0 front, 1 middle, 2 hind; side -1 / +1. */
export function tripodPhase(pair, side) {
  return (pair % 2 === 0) === side < 0 ? 0 : Math.PI;
}

/** The swarm skitterling (and the hunter's far LOD): 27 triangles, 1 unit long. */
export function buildSwarmGeometry() {
  const { add, idx, geo } = builder();
  // carapace: an 8-point oval base (a = 0.5 along z, b = 0.27 across) tented to a spine ridge (front and back ridge points)
  const A = 0.5;
  const Bw = 0.27;
  const Hh = 0.2;
  const ring = [];
  for (let k = 0; k < 8; k++) {
    const t = (k / 8) * Math.PI * 2; // 0 = front
    const x = Math.sin(t) * Bw;
    const z = Math.cos(t) * A - 0.04;
    ring.push(add(x, 0.03, z, x / (Bw * Bw), 0.6, (z + 0.04) / (A * A), 0, 0, 0, 0));
  }
  const rf = add(0, Hh, 0.16, 0, 1, 0.25, 0, 0, 0, 0);
  const rb = add(0, Hh * 0.92, -0.22, 0, 1, -0.3, 0, 0, 0, 0);
  // ring 0 front, 1 front-right ... 4 back ... 7 front-left; the front ridge point owns 7,0,1,2 and 6..; the back one 2..6
  const front = [6, 7, 0, 1, 2];
  for (let k = 0; k < front.length - 1; k++) idx.push(rf, ring[front[k]], ring[front[k + 1]]);
  const back = [2, 3, 4, 5, 6];
  for (let k = 0; k < back.length - 1; k++) idx.push(rb, ring[back[k]], ring[back[k + 1]]);
  idx.push(rf, ring[2], rb); // the ridge's two sides
  idx.push(rf, rb, ring[6]);
  // head: a small blunt wedge under the front of the shield
  const h0 = add(0, 0.11, 0.62, 0, 0.6, 1, 1, 0, 0, 0);
  const h1 = add(-0.11, 0.03, 0.47, -1, 0.4, 0.4, 1, 0, 0, 0);
  const h2 = add(0.11, 0.03, 0.47, 1, 0.4, 0.4, 1, 0, 0, 0);
  const h3 = add(0, 0.02, 0.66, 0, -0.2, 1, 1, 0, 0, 0);
  idx.push(h0, h1, h2, h0, h3, h1, h0, h2, h3);
  // legs: 3 pairs of thin quads, hip -> foot, splayed
  const legs = [
    // z hip, foot dx, foot dz
    [0.24, 0.4, 0.3],
    [0.04, 0.5, -0.1],
    [-0.16, 0.48, -0.56],
  ];
  for (let j = 0; j < 3; j++) {
    for (const side of [-1, 1]) {
      const [zh, fx, fz] = legs[j];
      const ph = tripodPhase(j, side);
      const part = 2 + j * 0.1;
      const hx = side * 0.16;
      const tx = side * fx;
      const tz = zh + fz;
      // the quad's width across the leg's direction
      const dx = tx - hx;
      const dz = tz - zh;
      const l = Math.hypot(dx, dz);
      const wx = (-dz / l) * 0.025;
      const wz = (dx / l) * 0.025;
      const a = add(hx - wx, 0.06, zh - wz, 0, 1, 0, part, 0, ph, side);
      const b = add(hx + wx, 0.06, zh + wz, 0, 1, 0, part, 0, ph, side);
      const c = add(tx + wx * 0.4, 0.0, tz + wz * 0.4, 0, 1, 0, part, 1, ph, side);
      const d = add(tx - wx * 0.4, 0.0, tz - wz * 0.4, 0, 1, 0, part, 1, ph, side);
      if (side > 0) idx.push(a, b, c, a, c, d);
      else idx.push(a, c, b, a, d, c);
    }
  }
  // antennae: one long thin triangle each, from the head forward and out, longer than the body
  for (const side of [-1, 1]) {
    const a = add(side * 0.035, 0.08, 0.62, 0, 1, 0, 3, 0, 0, side);
    const b = add(side * 0.06, 0.08, 0.6, 0, 1, 0, 3, 0, 0, side);
    const c = add(side * 0.3, 0.14, 1.3, 0, 1, 0, 3, 1, 0, side);
    if (side > 0) idx.push(a, b, c);
    else idx.push(a, c, b);
  }
  return geo();
}

// the hunter's legs: hip, knee (femur end), foot, per pair (right side; x mirrored for the left). Front short and forward, hind long and back.
export const HUNTER_LEGS = [
  { hip: [0.13, 0.06, 0.24], knee: [0.3, 0.15, 0.36], foot: [0.42, 0.0, 0.56] },
  { hip: [0.15, 0.06, 0.05], knee: [0.38, 0.17, 0.07], foot: [0.58, 0.0, -0.1] },
  { hip: [0.14, 0.06, -0.14], knee: [0.36, 0.18, -0.34], foot: [0.56, 0.0, -0.78] },
];

/**
 * The hunter skitterling, LOD0 (~160 triangles, 1 unit long): a domed oval shield (12 around x 3 bands, a flat belly), the pronotum's rim
 * and the wing-case seam in the shader, a small head tucked under the shield with mouthparts, long fine three-segment antennae, six legs of
 * femur + tibia as crossed blades with two spines on each tibia, two cerci at the rear.
 */
export function buildHunterGeometry() {
  const { add, idx, geo } = builder();
  const A = 0.5;
  const Bw = 0.28;
  const Hh = 0.19;
  const N = 12;
  const zc = -0.04;
  // the dome: rings at radius 1, 0.72, 0.38, the apex; the height follows a flattened ellipsoid (roaches are flat)
  const rings = [1, 0.72, 0.38];
  const hAt = (r) => 0.03 + (Hh - 0.03) * Math.pow(1 - r * r, 0.55);
  const ids = [];
  for (const r of rings) {
    const row = [];
    for (let k = 0; k < N; k++) {
      const t = (k / N) * Math.PI * 2; // 0 = front
      const x = Math.sin(t) * Bw * r;
      const z = Math.cos(t) * A * r + zc;
      const y = hAt(r);
      // the ellipsoid's normal, flattened
      row.push(add(x, y, z, (x / (Bw * Bw)) * 0.3, (y - 0.02) / (Hh * Hh) * 0.3 + 0.2, ((z - zc) / (A * A)) * 0.3, 0, 0, 0, 0));
    }
    ids.push(row);
  }
  const apex = add(0, Hh, zc - 0.02, 0, 1, 0, 0, 0, 0, 0);
  for (let b = 0; b < rings.length - 1; b++) {
    const o = ids[b];
    const i = ids[b + 1];
    for (let k = 0; k < N; k++) {
      const k1 = (k + 1) % N;
      idx.push(o[k], o[k1], i[k1], o[k], i[k1], i[k]);
    }
  }
  const last = ids[rings.length - 1];
  for (let k = 0; k < N; k++) idx.push(apex, last[k], last[(k + 1) % N]);
  // the belly: a flat fan under the rim
  const belly = add(0, 0.025, zc, 0, -1, 0, 0, 0, 0, 0);
  const rim = ids[0];
  for (let k = 0; k < N; k++) idx.push(belly, rim[(k + 1) % N], rim[k]);
  // the head: tucked under the front of the shield, a blunt wedge (6) and two palps (2)
  const h0 = add(0, 0.085, 0.5, 0, 1, 0.5, 1, 0, 0, 0);
  const h1 = add(-0.09, 0.03, 0.42, -1, 0.3, 0.3, 1, 0, 0, 0);
  const h2 = add(0.09, 0.03, 0.42, 1, 0.3, 0.3, 1, 0, 0, 0);
  const h3 = add(-0.05, 0.02, 0.58, -0.6, 0, 1, 1, 0, 0, 0);
  const h4 = add(0.05, 0.02, 0.58, 0.6, 0, 1, 1, 0, 0, 0);
  const h5 = add(0, 0.06, 0.6, 0, 0.5, 1, 1, 0, 0, 0);
  idx.push(h0, h1, h2, h0, h3, h1, h0, h2, h4, h0, h5, h3, h0, h4, h5, h3, h5, h4);
  for (const side of [-1, 1]) {
    const a = add(side * 0.03, 0.02, 0.57, 0, -1, 0, 1, 0, 0, side);
    const b = add(side * 0.05, 0.02, 0.56, 0, -1, 0, 1, 0, 0, side);
    const c = add(side * 0.045, 0.0, 0.66, 0, -1, 0, 1, 0, 0, side);
    if (side > 0) idx.push(a, b, c);
    else idx.push(a, c, b);
  }
  // antennae: three tapering ribbons each, sweeping forward and out, half again the body's length
  const ant = [
    [0.035, 0.08, 0.58],
    [0.11, 0.13, 0.86],
    [0.22, 0.15, 1.18],
    [0.36, 0.12, 1.52],
  ];
  for (const side of [-1, 1]) {
    let prev = null;
    for (let s = 0; s < ant.length; s++) {
      const [ax, ay, az] = ant[s];
      const wd = 0.012 * (1 - s / ant.length) + 0.003;
      const w = s / (ant.length - 1);
      const a = add(side * (ax - wd), ay, az + wd * 0.3, 0, 1, 0, 3, w, 0, side);
      const b = add(side * (ax + wd), ay, az - wd * 0.3, 0, 1, 0, 3, w, 0, side);
      if (prev) {
        if (side > 0) idx.push(prev[0], prev[1], b, prev[0], b, a);
        else idx.push(prev[0], b, prev[1], prev[0], a, b);
      }
      prev = [a, b];
    }
  }
  // legs: femur (hip -> knee) and tibia (knee -> foot), each two crossed blades; two spines on the tibia
  const blade = (p, q, wp, wq, part, w0, w1, ph, side) => {
    // across in the horizontal plane (the flat blade), and the vertical (the upright blade)
    let ax = -(q[2] - p[2]);
    let az = q[0] - p[0];
    const al = Math.hypot(ax, az) || 1;
    ax /= al;
    az /= al;
    // blade 1: flat
    let a = add(p[0] - ax * wp, p[1], p[2] - az * wp, 0, 1, 0, part, w0, ph, side);
    let b = add(p[0] + ax * wp, p[1], p[2] + az * wp, 0, 1, 0, part, w0, ph, side);
    let c = add(q[0] + ax * wq, q[1], q[2] + az * wq, 0, 1, 0, part, w1, ph, side);
    let d = add(q[0] - ax * wq, q[1], q[2] - az * wq, 0, 1, 0, part, w1, ph, side);
    idx.push(a, b, c, a, c, d);
    // blade 2: upright (its normal across the leg, tipped up so the lantern above still catches it)
    a = add(p[0], p[1] - wp, p[2], ax, 0.6, az, part, w0, ph, side);
    b = add(p[0], p[1] + wp, p[2], ax, 0.6, az, part, w0, ph, side);
    c = add(q[0], q[1] + wq, q[2], ax, 0.6, az, part, w1, ph, side);
    d = add(q[0], q[1] - wq, q[2], ax, 0.6, az, part, w1, ph, side);
    idx.push(a, b, c, a, c, d);
  };
  for (let j = 0; j < 3; j++) {
    const L = HUNTER_LEGS[j];
    for (const side of [-1, 1]) {
      const ph = tripodPhase(j, side);
      const part = 2 + j * 0.1;
      const m = (v) => [v[0] * side, v[1], v[2]];
      const hip = m(L.hip);
      const knee = m(L.knee);
      const foot = m(L.foot);
      blade(hip, knee, 0.03, 0.022, part, 0, 0.4, ph, side);
      blade(knee, foot, 0.018, 0.006, part, 0.4, 1, ph, side);
      // spines: two thorns along the tibia, pointing out and back
      for (const f of [0.35, 0.68]) {
        const px = knee[0] + (foot[0] - knee[0]) * f;
        const py = knee[1] + (foot[1] - knee[1]) * f;
        const pz = knee[2] + (foot[2] - knee[2]) * f;
        const w = 0.4 + 0.6 * f;
        const a = add(px, py + 0.008, pz + 0.012, 0, 1, 0, part, w, ph, side);
        const b = add(px, py - 0.008, pz - 0.012, 0, 1, 0, part, w, ph, side);
        const c = add(px + side * 0.05, py + 0.025, pz - 0.05, 0, 1, 0, part, w, ph, side);
        if (side > 0) idx.push(a, b, c);
        else idx.push(a, c, b);
      }
    }
  }
  // cerci: two short tapering spikes at the rear
  for (const side of [-1, 1]) {
    const a = add(side * 0.04, 0.05, -0.5, 0, 1, 0, 1, 0, 0, side);
    const b = add(side * 0.09, 0.045, -0.48, 0, 1, 0, 1, 0, 0, side);
    const c = add(side * 0.13, 0.07, -0.66, 0, 1, 0, 1, 0, 0, side);
    const d = add(side * 0.07, 0.035, -0.52, 0, -1, 0, 1, 0, 0, side);
    if (side > 0) idx.push(a, b, c, b, d, c);
    else idx.push(a, c, b, b, c, d);
  }
  return geo();
}

/** Triangle count of a model geometry. */
export function trianglesOf(g) {
  return g.index ? g.index.count / 3 : g.attributes.position.count / 3;
}
