/* THE LANTERN (ABYSSAL TETHER 3D) — render/roachView.js
 * The RED ROACHES (sim/roaches.js, docs/abyssal-tether-3d/plans/ROACHES.md): ONE InstancedMesh, ONE draw call for every roach and every smear.
 *
 *   MODEL    procedural, 27 triangles, 1 unit long (+z forward, +y off the surface): an oval carapace tented along the spine (10), a head (3),
 *            six legs as thin quads (12), two long antennae (2). Per vertex aRig = (part 0 body / 1 head / 2 leg / 3 antenna, weight 0 at the
 *            root .. 1 at the tip, the leg's tripod phase 0 / PI, side -1 / +1).
 *   GAIT     all in the vertex shader from one per-instance vec4 aAnim = (gait phase, speed 0..1 (< 0: a smear, -1 fresh .. 0 gone), seed,
 *            antenna twitch): the alternating tripod (L1 R2 L3 against R1 L2 R3) swings and lifts the feet, the body bobs, the antennae sweep
 *            and twitch (harder when it freezes). No skeleton, no per-roach CPU animation beyond the instance matrix.
 *   LOOK     a ShaderMaterial: the carried lantern only (the shared LOOK uniforms uLanternW / uLanternC / uLanternR the lighting drives for the
 *            wet film), wrapped diffuse, a tight glossy chitin highlight and a lantern-coloured rim, a seam down the wing cases and a lighter
 *            pronotum, a trace of ambient so a silhouette survives; the level's radial haze (fog chunks), tone mapping, colour space.
 *            A squished one is the same instance flattened and splayed into a dark wet smear that shrinks away.
 *
 *   new RoachView(game)       game: { renderer.{scene, camera, ...} }; the mesh is in the scene from the start (hidden while empty)
 *   .update(dt, game)         once per frame (Game._updateViews): fills the sim's context, steps game.roaches, writes the instances
 *   .stats                    { shown, triangles, calls }
 *   roachContext(game, ctx)   the glue: head pose + frustum, lantern, hands, body, governor, tier, on/off (also the tests)
 *   buildRoachGeometry()      the model (also the tests)
 */
import * as THREE from 'three';
import { LOOK } from './materials.js';
import { ROACH, ROACH_STATE, makeRoachCtx } from '../sim/roaches.js';
import { CONFIG } from '../sim/config3d.js';

export const ROACH_TRIS = 27;

const VERT = /* glsl */ `
#include <common>
#include <fog_pars_vertex>
attribute vec4 aRig;   // part, weight, tripod phase, side
attribute vec4 aAnim;  // gait phase, speed (< 0 smear), seed, twitch
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
  if (smear > 0.0) {
    // squished: flat, splayed, shrinking away as it dries
    float k = sqrt(smear);
    p.y *= 0.05;
    p.xz *= (1.35 + 0.35 * w) * k;
    if (part > 1.5 && part < 2.5) p.x *= 1.25;
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
    } else if (part > 2.5) {
      // the antennae sweep and twitch (harder when it freezes)
      float a = sin(uTime * (5.0 + seed * 6.0) + seed * 21.0 + aRig.w) * (0.08 + 0.3 * tw) + sin(uTime * 17.0 + seed * 9.0) * 0.08 * tw;
      p.x += a * w * w * 0.8;
      p.y += sin(uTime * 7.3 + seed * 13.0 + aRig.w * 2.0) * 0.06 * tw * w;
    } else {
      p.y *= 1.0 + sin(ph * 2.0) * 0.06 * spd; // the body bobs as it runs
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

const FRAG = /* glsl */ `
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
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

/** The model: 27 triangles, 1 unit long. */
export function buildRoachGeometry() {
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
  // legs: 3 pairs of thin quads, hip -> foot, splayed; the tripod L1 R2 L3 (phase 0) against R1 L2 R3 (phase PI)
  const legs = [
    // z hip, foot dx, foot dz, length scale
    [0.22, 0.62, 0.5],
    [0.02, 0.7, 0.05],
    [-0.2, 0.68, -0.48],
  ];
  for (let j = 0; j < 3; j++) {
    for (const side of [-1, 1]) {
      const [zh, fx, fz] = legs[j];
      const ph = ((j % 2 === 0) === (side < 0) ? 0 : Math.PI);
      const hx = side * 0.16;
      const tx = side * fx;
      const tz = zh + fz;
      // the quad's width across the leg's direction
      const dx = tx - hx;
      const dz = tz - zh;
      const l = Math.hypot(dx, dz);
      const wx = (-dz / l) * 0.025;
      const wz = (dx / l) * 0.025;
      const a = add(hx - wx, 0.06, zh - wz, 0, 1, 0, 2, 0, ph, side);
      const b = add(hx + wx, 0.06, zh + wz, 0, 1, 0, 2, 0, ph, side);
      const c = add(tx + wx * 0.4, 0.0, tz + wz * 0.4, 0, 1, 0, 2, 1, ph, side);
      const d = add(tx - wx * 0.4, 0.0, tz - wz * 0.4, 0, 1, 0, 2, 1, ph, side);
      if (side > 0) idx.push(a, b, c, a, c, d);
      else idx.push(a, c, b, a, d, c);
    }
  }
  // antennae: one long thin triangle each, from the head forward and out, longer than the body
  for (const side of [-1, 1]) {
    const a = add(side * 0.03, 0.08, 0.6, 0, 1, 0, 3, 0, 0, side);
    const b = add(side * 0.07, 0.08, 0.58, 0, 1, 0, 3, 0, 0, side);
    const c = add(side * 0.42, 0.16, 1.45, 0, 1, 0, 3, 1, 0, side);
    if (side > 0) idx.push(a, b, c);
    else idx.push(a, c, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(Nn, 3));
  g.setAttribute('aRig', new THREE.Float32BufferAttribute(R, 4));
  g.setIndex(idx);
  return g;
}

/** Fills the sim's context from the game (allocation-free). Returns ctx. */
export function roachContext(game, ctx) {
  const r = game.renderer;
  const p = game.player;
  const st = game.settings;
  const sc = game.deathScene;
  ctx.on = !!(r && r.camera && p && p.alive && game.state === 'playing' && !(game.victoryT >= 0) && !(sc && sc.active) && !(st && st.roaches === false));
  if (!ctx.on) return ctx;
  ctx.tier = r.qualityTier || 'quest';
  ctx.gov = r.governor && typeof r.governor.level === 'number' ? r.governor.level : 0;
  // the head: the camera's world pose (in a headset the user camera carries the XR pose) and a frustum at least as wide as the headset's
  const cam = r.camera;
  const e = cam.matrixWorld.elements;
  const H = ctx.head;
  H.x = e[12];
  H.y = e[13];
  H.z = e[14];
  let l = Math.hypot(e[0], e[1], e[2]) || 1;
  H.rx = e[0] / l;
  H.ry = e[1] / l;
  H.rz = e[2] / l;
  l = Math.hypot(e[4], e[5], e[6]) || 1;
  H.ux = e[4] / l;
  H.uy = e[5] / l;
  H.uz = e[6] / l;
  l = Math.hypot(e[8], e[9], e[10]) || 1;
  H.fx = -e[8] / l;
  H.fy = -e[9] / l;
  H.fz = -e[10] / l;
  const pm = cam.projectionMatrix.elements;
  const xr = !!game.xrActive;
  H.tanH = Math.max(pm[0] > 0 ? 1 / pm[0] : 1, xr ? 1.45 : 0);
  H.tanV = Math.max(pm[5] > 0 ? 1 / pm[5] : 0.8, xr ? 1.3 : 0);
  // the lantern: where it hangs, shining along the view
  const L = ctx.lantern;
  const lan = r.lantern;
  if (lan) {
    const m = lan.matrixWorld.elements;
    L.x = m[12];
    L.y = m[13];
    L.z = m[14];
    L.k = lan.visible === false ? 0 : Math.max(0, Math.min(1, lan.intensity / (r.lanternBase || 6.5)));
  } else {
    L.x = H.x;
    L.y = H.y;
    L.z = H.z;
    L.k = 0;
  }
  L.ax = H.fx;
  L.ay = H.fy;
  L.az = H.fz;
  // the hands (XR: the controllers / tracked hands; desktop: the virtual hands in front of the camera)
  for (let k = 0; k < 2; k++) {
    const hd = ctx.hands[k];
    hd.ok = false;
    if (typeof game.handOrigin === 'function') {
      game.handOrigin(k === 0 ? 'left' : 'right', hd);
      hd.ok = Number.isFinite(hd.x);
    }
  }
  // the body
  const B = ctx.body;
  B.x = p.rx;
  B.y = p.ry;
  B.z = p.rz;
  B.vx = p.vx || 0;
  B.vy = p.vy || 0;
  B.vz = p.vz || 0;
  B.grounded = !!p.grounded;
  B.footY = p.ry - ((CONFIG && CONFIG.player && CONFIG.player.radius) || 0.38);
  B.landed = !!p.landedThisStep;
  return ctx;
}

export class RoachView {
  constructor(game) {
    this.scene = game.renderer.scene;
    this.ctx = makeRoachCtx();
    this.stats = { shown: 0, triangles: 0, calls: 0 };
    this._t = 0;
    const N = ROACH.pool;
    const geo = buildRoachGeometry();
    this.anim = new Float32Array(N * 4);
    const aAnim = new THREE.InstancedBufferAttribute(this.anim, 4);
    aAnim.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aAnim', aAnim);
    this._aAnim = aAnim;
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uAmb: { value: new THREE.Color(0.05, 0.035, 0.03) } }]);
    // the shared lantern uniforms (driven by the lighting each frame), by reference
    this.uniforms.uLanternW = LOOK.uLanternW;
    this.uniforms.uLanternC = LOOK.uLanternC;
    this.uniforms.uLanternR = LOOK.uLanternR;
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, fog: true, side: THREE.DoubleSide });
    this.material.userData.noLook = true;
    this.mesh = new THREE.InstancedMesh(geo, this.material, N);
    this.mesh.name = 'roaches';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.userData.noShadowCast = true;
    this.scene.add(this.mesh);
  }

  /** Steps the sim (game.roaches) and writes the instances. */
  update(dt, game) {
    const sim = game.roaches;
    if (!sim) {
      this._hide();
      return;
    }
    this._t = (this._t + (dt > 0 ? dt : 0)) % 1000;
    this.uniforms.uTime.value = this._t;
    if (game.state === 'paused') return; // frozen as they were
    if (!sim.hasHotspots && game.remainsView && game.remainsView.plan && game.remainsView.level === sim.level) sim.setHotspots(game.remainsView.plan);
    roachContext(game, this.ctx);
    sim.update(dt, this.ctx);
    this.write(sim);
  }

  /** Writes the sim's live roaches and smears into the instance buffers (allocation-free). Returns how many. */
  write(sim) {
    const arr = this.mesh.instanceMatrix.array;
    const an = this.anim;
    const P = ROACH.pool;
    const pos = sim.pos;
    let n = 0;
    for (let i = 0; i < P; i++) {
      const s = sim.st[i];
      if (s === ROACH_STATE.FREE) continue;
      const a = sim.axis[i];
      const k = a >> 1; // the normal's component
      const sg = a & 1 ? 1 : -1;
      // Y = the face normal; Z = the heading on the face (cos along u, sin along v); X = Y x Z
      let yx = 0;
      let yy = 0;
      let yz = 0;
      if (k === 0) yx = sg;
      else if (k === 1) yy = sg;
      else yz = sg;
      const ca = Math.cos(sim.ang[i]);
      const sa = Math.sin(sim.ang[i]);
      // u / v components per face (sim/roaches.js UC / VC): x-faces (z, y), y-faces (x, z), z-faces (x, y)
      let zx = 0;
      let zy = 0;
      let zz = 0;
      if (k === 0) {
        zz = ca;
        zy = sa;
      } else if (k === 1) {
        zx = ca;
        zz = sa;
      } else {
        zx = ca;
        zy = sa;
      }
      const xx = yy * zz - yz * zy;
      const xy = yz * zx - yx * zz;
      const xz = yx * zy - yy * zx;
      const sc = ROACH.len * sim.sz[i];
      const o = n * 16;
      arr[o] = xx * sc;
      arr[o + 1] = xy * sc;
      arr[o + 2] = xz * sc;
      arr[o + 3] = 0;
      arr[o + 4] = yx * sc;
      arr[o + 5] = yy * sc;
      arr[o + 6] = yz * sc;
      arr[o + 7] = 0;
      arr[o + 8] = zx * sc;
      arr[o + 9] = zy * sc;
      arr[o + 10] = zz * sc;
      arr[o + 11] = 0;
      arr[o + 12] = pos[i * 3];
      arr[o + 13] = pos[i * 3 + 1];
      arr[o + 14] = pos[i * 3 + 2];
      arr[o + 15] = 1;
      const q = n * 4;
      an[q] = sim.ph[i];
      if (s === ROACH_STATE.SMEAR) {
        const f = sim.tmr[i] / ROACH.smearFade;
        an[q + 1] = -(0.002 + (f > 1 ? 1 : f < 0 ? 0 : f));
      } else an[q + 1] = Math.min(1, sim.spd[i] / 1.2);
      an[q + 2] = sim.seedK[i];
      an[q + 3] = sim.tw[i];
      n++;
    }
    const m = this.mesh;
    m.count = n;
    m.visible = n > 0;
    if (n > 0) {
      // the whole buffers go up (at most 96 x 80 bytes = 7.5 KB): update ranges would allocate a range record and the array's
      // backing store every frame (three clears them with length = 0 after each upload)
      m.instanceMatrix.needsUpdate = true;
      this._aAnim.needsUpdate = true;
    }
    this.stats.shown = n;
    this.stats.triangles = n * ROACH_TRIS;
    this.stats.calls = n > 0 ? 1 : 0;
    return n;
  }

  _hide() {
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.stats.shown = this.stats.triangles = this.stats.calls = 0;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
