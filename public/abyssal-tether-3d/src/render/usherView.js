/* ABYSSAL TETHER 3D — usherView.js
 * THE USHER (the Chapter II villain, sim/usher3d.js), drawn: a headless man in a suit whose throat coils and whips, from
 * assets/models/usher.glb (tools/abyssal-tether-3d/build_usher.py, docs/abyssal-tether-3d/plans/USHER.md: 34 bones with a 14-bone
 * throat chain and a ring bone, clips Idle / Listen / Walk / Lunge (+ Sit when the model has it), six flat materials, 28.7 k triangles),
 * plus THE TORCH (CHAPTER_II_DIRECTION 3.4): a sphere of light centred on the aim point, a thin line back to the ring.
 *
 *   const v = new UsherView(renderer)        renderer: { scene, qualityTier? } (Renderer3D); the view adds ONE group to the scene
 *   await v.load(url?)                       fetch + parse usher.glb (default USHER_URL) -> true | false, never throws; (buildFromGLTF(gltf)
 *                                            does the same from an already parsed glTF: the tests). Until it resolves everything is a no-op.
 *   v.setStates(list)                        once per frame, before update: one plain object per usher IN VIEW (the array may be reused by
 *                                            the caller and may be longer than the pool: 5 ordinary + 1 head are drawn, the head first, then
 *                                            the nearest; an usher keeps its pool slot while its id stays in the list):
 *     { id, head, x, y, z, yaw, clip, t, stretch, ring, sphere, visible, collar? }
 *       x y z   the FEET, world (the model's origin); with `collar: true` they are the base of the throat instead (the Head Usher of
 *               sim/usher3d.js: its `pos` is the collar, 1.62 m x 1.8 above its feet), so the view puts the collar there
 *       yaw     radians about +Y, 0 = faces +Z (forward = (sin yaw, 0, cos yaw)), like the glTF and the sim's atan2(dx, dz)
 *       clip    'Idle' | 'Listen' | 'Walk' | 'Lunge' | 'Sit' (a name the file lacks falls back to Idle);  t  seconds INTO the clip. A looping
 *               clip (Idle, Listen, Walk) wraps t, a once clip (Lunge, Sit) holds its ends: the sim scrubs COIL / WHIP / RECOIL through Lunge
 *       stretch >= 1, the HEAD USHER's throat length factor (1 = the modelled 3.75 m x 1.8, 5.5 = 37 m); ignored on the others
 *       ring    {x,y,z} | null  the torch ring (the throat's tip) in the world; null = read it off the skeleton (the Maw bone)
 *       sphere  {x,y,z,r,stage} | null  stage 'listen' | 'coil' | 'commit' | 'whip' | 'snuff'; a sphere that goes null fades like 'snuff'.
 *               It shows even when `visible` is false (a telegraph is gameplay: the usher may be out of sight, the sphere is not)
 *       visible false = the body is not drawn (the sphere still is)
 *   v.update(dt, camera)                     poses (clips sampled at t, crossfaded 0.2 s on a change, the head's throat stretched), picks the LOD
 *                                            by distance, moves the spheres and the line, hides the unused pool members
 *   v.setTier('low'|'quest'|'high'|null)     LOD distances (null = the renderer's qualityTier, like DresserView)
 *   v.setReducedEffects(bool)                the spheres become thin outlines, no pulsing (comfort: CHAPTER_II_DIRECTION 3.10)
 *   v.stats                                  { shown, drawCalls, triangles, sphereShown, poolSize, lods:[n0,n1,n2,glint], hulls }
 *   v.dispose()
 *
 * THE LONG THROAT. The chain is rotation-only in the clips and the weights were authored for a fixed length: each throat vertex was
 * owned by ONE bone for the first half of its segment and shared 50/50 with the next after that, a jump that is invisible while the
 * bones only turn but tears the tube open the moment they move apart. So at load the throat's skin weights (skin, vein, glow) are
 * rebuilt as a partition of unity along the chain (a vertex between bone k and k+1 is (1-f, f) of the two, f from its position in the
 * bone's own frame; the ring and its membrane are pure Maw, the Maw scale is compensated), and `stretch` is applied as TRANSLATION:
 * the offsets of Neck02..Neck14 and Maw are multiplied by it, every bone keeps scale 1. The tube is then stretched linearly between
 * joints, with no shear (a non-uniform bone scale under a rotating chain shears every child), and the thickness is unchanged. Ribs
 * stretch with the tube (no accordion at 3 x, a gently swelling pipe at 5 x). No ribbon fallback was needed.
 *
 * Levels of detail (the GLB ships one): LOD0 = the model (6 draws), LOD1 / LOD2 = vertex-clustered copies of suit + shirt + skin + shoe
 * (the veins are dropped) merged into ONE draw with baked vertex colours, plus the shared glow mesh (2 draws), beyond that ONLY a ring
 * glint (one shared quad batch, a pale dot is what a coat in the dark is from the Gallery). The ink outline (outline.js) is one hull
 * from the cheap geometry, near and far. The head is judged at distance / 1.8.
 */
import * as THREE from 'three';
import { loadGLB } from './glbLoad.js';
import { injectToon } from './materials.js';
import { OUTLINE, addOutline, mergedHullGeometry, removeOutline } from './outline.js';

export const USHER_URL = new URL('../../assets/models/usher.glb', import.meta.url).href;

export const POOL_ORDINARY = 5;
export const POOL_SIZE = 6; // 5 ordinary + the head (the last slot)
export const HEAD_SLOT = 5;
export const HEAD_SCALE = 1.8;
export const STRETCH_MAX = 8;
/** Camera distance (m, / 1.8 for the head) of the LOD switches: LOD0 -> LOD1, LOD1 -> LOD2, LOD2 -> glint only. */
export const LOD_DIST = { low: [8, 22, 55], quest: [12, 30, 70], high: [24, 50, 100] };
export const GLINT_FAR = 320; // m: beyond this nothing of him is drawn
const LOD_HYST = 2;
const CLUSTER_CELL = [0.05, 0.034, 0.075]; // m: the vertex-clustering cell of the far ink hull, LOD1 and LOD2 (real units, before the 1.8 x)
const FADE = 0.2; // s: clip crossfade
const RING_LIP = 0.1; // m: from the Maw bone's head to the lip of the ring along the bone (build_usher.py: ring_len 0.11)
const NECKS = 14;
const LOOPING = { Idle: true, Listen: true, Walk: true };
const CLIP_FALLBACK = { Sit: 'Idle', Snuff: 'Lunge', Bow: 'Lunge' };

export const STAGE = { none: 0, listen: 1, coil: 2, commit: 3, whip: 4, snuff: 5 };
const _stageId = Object.assign(Object.create(null), STAGE);

/** The torch's colours (sRGB, as the spec gives them): listen pale cyan-white, coil warms toward gold, commit GOLD, whip white-gold. */
const COL_LISTEN = new THREE.Color('#b8e8ff');
const COL_COIL = new THREE.Color('#ffd98a');
const COL_COMMIT = new THREE.Color('#ffc24d');
const COL_WHIP = new THREE.Color('#fff1c4');
const COL_GLINT = new THREE.Color('#c8eaff');

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// scratch (no allocation per frame)
const _v = new THREE.Vector3();
const _cam = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _d = new THREE.Vector3();
const _s = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _col = new THREE.Color();

/**
 * The level of detail for a camera distance (pure: the tests read it). `d` is already divided by the usher's scale; `cur` the
 * current LOD (hysteresis: a finer LOD needs LOD_HYST m closer than the switch). 0 full, 1, 2, 3 = glint only, -1 = nothing.
 */
export function pickLod(d, tier, cur = 0) {
  if (d > GLINT_FAR) return -1;
  const t = LOD_DIST[tier] || LOD_DIST.quest;
  let lod = 0;
  if (d > (cur >= 1 ? t[0] - LOD_HYST : t[0])) lod = 1;
  if (d > (cur >= 2 ? t[1] - LOD_HYST : t[1])) lod = 2;
  if (d > (cur >= 3 ? t[2] - LOD_HYST : t[2])) lod = 3;
  return lod;
}

// ---------------------------------------------------------------------------------------------------------------------
// Geometry preparation (pure: the tests call them on the parsed glTF)
// ---------------------------------------------------------------------------------------------------------------------
/**
 * Rebuilds the throat's skin weights as a partition of unity along the bone chain (see the header). `geometry` a skinned primitive,
 * `ctx` { neck: [Neck01..Neck14 bone indices], maw: Maw bone index, boneInverses: Matrix4[], D: the dequantisation matrix (real = D * stored),
 * heads: the REAL rest positions of the heads of Neck01..Neck14 and Maw, 15 x [x, y, z] }. A vertex that the file gave to link k is cut
 * by the planes through the two joints of that link (each perpendicular to the bisector of the two links that meet there, so a bend does
 * not skew the measure): f is its distance past the first plane over the distance between them, and it is (1 - f) of bone k and f of
 * the next. Vertices with no throat weight are untouched; the ring (dominated by Maw) goes fully to Maw; what is not throat (the root
 * of the throat blends into the chest) is kept. Returns the number of vertices re-weighted.
 */
export function restretchWeights(geometry, ctx) {
  const pos = geometry.attributes.position;
  const si = geometry.attributes.skinIndex;
  const sw = geometry.attributes.skinWeight;
  if (!pos || !si || !sw) return 0;
  const n = pos.count;
  const nb = ctx.boneInverses.length;
  const e = ctx.D.elements;
  const H = ctx.heads;
  // the cutting planes: the link directions, then one normal per joint
  const dir = [];
  for (let k = 0; k < NECKS; k++) {
    const dx = H[k + 1][0] - H[k][0];
    const dy = H[k + 1][1] - H[k][1];
    const dz = H[k + 1][2] - H[k][2];
    const l = Math.hypot(dx, dy, dz) || 1;
    dir.push([dx / l, dy / l, dz / l]);
  }
  const nrm = [];
  for (let j = 0; j <= NECKS; j++) {
    const a = dir[Math.max(0, j - 1)];
    const b = dir[Math.min(NECKS - 1, j)];
    const x = a[0] + b[0];
    const y = a[1] + b[1];
    const z = a[2] + b[2];
    const l = Math.hypot(x, y, z) || 1;
    nrm.push([x / l, y / l, z / l]);
  }
  const isNeck = new Int8Array(nb).fill(-1);
  for (let k = 0; k < NECKS; k++) isNeck[ctx.neck[k]] = k;
  isNeck[ctx.maw] = NECKS;
  const outI = new Uint16Array(n * 4);
  const outW = new Float32Array(n * 4);
  const ix = [0, 0, 0, 0];
  const wt = [0, 0, 0, 0];
  let changed = 0;
  for (let i = 0; i < n; i++) {
    let neckW = 0;
    let best = -1;
    let bestW = 0;
    for (let j = 0; j < 4; j++) {
      ix[j] = si.getComponent(i, j);
      wt[j] = sw.getComponent(i, j);
      const k = wt[j] > 0 ? isNeck[ix[j]] : -1;
      if (k >= 0) {
        neckW += wt[j];
        if (wt[j] > bestW) {
          bestW = wt[j];
          best = k;
        }
      }
    }
    let m = 0;
    if (neckW <= 0) {
      for (let j = 0; j < 4; j++) {
        outI[i * 4 + j] = ix[j];
        outW[i * 4 + j] = wt[j];
      }
      continue;
    }
    changed++;
    for (let j = 0; j < 4; j++) {
      if (wt[j] > 0 && isNeck[ix[j]] < 0) {
        outI[i * 4 + m] = ix[j];
        outW[i * 4 + m] = wt[j];
        m++;
      }
    }
    if (best >= NECKS) {
      outI[i * 4 + m] = ctx.maw;
      outW[i * 4 + m] = neckW;
      m++;
    } else {
      const x0 = pos.getX(i);
      const y0 = pos.getY(i);
      const z0 = pos.getZ(i);
      const X = e[0] * x0 + e[4] * y0 + e[8] * z0 + e[12];
      const Y = e[1] * x0 + e[5] * y0 + e[9] * z0 + e[13];
      const Z = e[2] * x0 + e[6] * y0 + e[10] * z0 + e[14];
      const a = nrm[best];
      const b = nrm[best + 1];
      const h0 = H[best];
      const h1 = H[best + 1];
      const d0 = (X - h0[0]) * a[0] + (Y - h0[1]) * a[1] + (Z - h0[2]) * a[2]; // past the first joint's plane
      const d1 = (h1[0] - X) * b[0] + (h1[1] - Y) * b[1] + (h1[2] - Z) * b[2]; // short of the second
      const f = d0 <= 0 ? 0 : d1 <= 0 ? 1 : d0 / (d0 + d1);
      outI[i * 4 + m] = ctx.neck[best];
      outW[i * 4 + m] = neckW * (1 - f);
      m++;
      outI[i * 4 + m] = best + 1 >= NECKS ? ctx.maw : ctx.neck[best + 1];
      outW[i * 4 + m] = neckW * f;
      m++;
    }
    let tot = 0;
    for (let j = 0; j < m; j++) tot += outW[i * 4 + j];
    for (let j = 0; j < m; j++) outW[i * 4 + j] /= tot || 1;
  }
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(outI, 4));
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(outW, 4));
  return changed;
}

/**
 * Vertex clustering of skinned parts into ONE geometry: the vertices of a part that fall in the same `cell` (m) cell collapse onto the one
 * nearest to their centroid (it keeps its skin weights; the normal is the cluster's average), triangles that lose a corner are dropped.
 * `parts` [{ geometry, color: [r,g,b] linear }], `D` the dequantisation matrix of the glTF (positions are normalised int16: real = D * p).
 * The result has position / normal / color / skinIndex / skinWeight / index, in the same normalised space (so the same inverse binds apply).
 */
export function clusterSkinned(parts, D, cell) {
  const e = D.elements;
  const P = [];
  const N = [];
  const C = [];
  const SI = [];
  const SW = [];
  const I = [];
  let base = 0;
  for (const part of parts) {
    const g = part.geometry;
    const pos = g.attributes.position;
    const nor = g.attributes.normal;
    const si = g.attributes.skinIndex;
    const sw = g.attributes.skinWeight;
    const idx = g.index;
    const n = pos.count;
    const cl = new Int32Array(n);
    const map = new Map();
    const sum = [];
    const rx = new Float32Array(n);
    const ry = new Float32Array(n);
    const rz = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const X = e[0] * x + e[4] * y + e[8] * z + e[12];
      const Y = e[1] * x + e[5] * y + e[9] * z + e[13];
      const Z = e[2] * x + e[6] * y + e[10] * z + e[14];
      rx[i] = X;
      ry[i] = Y;
      rz[i] = Z;
      const key = ((Math.floor(X / cell) + 1024) * 2048 + (Math.floor(Y / cell) + 1024)) * 2048 + (Math.floor(Z / cell) + 1024);
      let id = map.get(key);
      if (id === undefined) {
        id = sum.length;
        map.set(key, id);
        sum.push([0, 0, 0, 0, 0, 0, 0]); // x y z count nx ny nz
      }
      cl[i] = id;
      const s = sum[id];
      s[0] += X;
      s[1] += Y;
      s[2] += Z;
      s[3]++;
      s[4] += nor.getX(i);
      s[5] += nor.getY(i);
      s[6] += nor.getZ(i);
    }
    const nc = sum.length;
    const rep = new Int32Array(nc).fill(-1);
    const repD = new Float64Array(nc).fill(Infinity);
    for (let i = 0; i < n; i++) {
      const s = sum[cl[i]];
      const dx = rx[i] - s[0] / s[3];
      const dy = ry[i] - s[1] / s[3];
      const dz = rz[i] - s[2] / s[3];
      const dd = dx * dx + dy * dy + dz * dz;
      if (dd < repD[cl[i]]) {
        repD[cl[i]] = dd;
        rep[cl[i]] = i;
      }
    }
    for (let c = 0; c < nc; c++) {
      const i = rep[c];
      const s = sum[c];
      const l = Math.hypot(s[4], s[5], s[6]) || 1;
      P.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      N.push(s[4] / l, s[5] / l, s[6] / l);
      C.push(part.color[0], part.color[1], part.color[2]);
      for (let j = 0; j < 4; j++) {
        SI.push(si.getComponent(i, j));
        SW.push(sw.getComponent(i, j));
      }
    }
    const seen = new Set();
    for (let t = 0; t < idx.count; t += 3) {
      const a = cl[idx.getX(t)];
      const b = cl[idx.getX(t + 1)];
      const c = cl[idx.getX(t + 2)];
      if (a === b || b === c || a === c) continue;
      const lo = Math.min(a, b, c);
      const hi = Math.max(a, b, c);
      const key = (lo * nc + (a + b + c - lo - hi)) * nc + hi;
      if (seen.has(key)) continue;
      seen.add(key);
      I.push(a + base, b + base, c + base);
    }
    base += nc;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  out.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(SI), 4));
  out.setAttribute('skinWeight', new THREE.Float32BufferAttribute(SW, 4));
  out.setIndex(base > 65535 ? new THREE.Uint32BufferAttribute(I, 1) : new THREE.Uint16BufferAttribute(I, 1));
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Materials and the torch's shaders
// ---------------------------------------------------------------------------------------------------------------------
const BODY_UNIFORMS = {
  uAmb: { value: new THREE.Color(0.1, 0.13, 0.16) }, // a faint cold ambient (x albedo) so the dark coat keeps its form
  uRim: { value: new THREE.Color(0.16, 0.2, 0.24) }, // a grazing rim that separates him from the haze
};

function patchBody(mat) {
  mat.vertexColors = mat.vertexColors === true;
  mat.metalness = 0;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, BODY_UNIFORMS);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uAmb;\nuniform vec3 uRim;')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
{
  float uFr = 1.0 - clamp( dot( normal, normalize( vViewPosition ) ), 0.0, 1.0 );
  reflectedLight.indirectDiffuse += diffuseColor.rgb * uAmb;
  reflectedLight.directSpecular += uRim * ( uFr * uFr * uFr );
}`,
      );
    injectToon(shader); // the cel bands: the lit colour is final here, before tone mapping and the fog
  };
  mat.customProgramCacheKey = () => 'at3d-usher-body' + (mat.vertexColors ? '-vc' : '');
  mat.needsUpdate = true;
  return mat;
}

function makeShellMaterial() {
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uI: { value: 0 }, uFill: { value: 0.07 }, uPow: { value: 2.6 } },
    vertexShader: `varying vec3 vN;
varying vec3 vE;
void main() {
  vec4 mv = modelViewMatrix * vec4( position, 1.0 );
  vN = normalize( normalMatrix * normal );
  vE = - mv.xyz;
  gl_Position = projectionMatrix * mv;
}`,
    fragmentShader: `uniform vec3 uColor;
uniform float uI;
uniform float uFill;
uniform float uPow;
varying vec3 vN;
varying vec3 vE;
void main() {
  float d = abs( dot( normalize( vN ), normalize( vE ) ) );
  float fr = pow( 1.0 - d, uPow );
  float a = ( fr * 1.7 + uFill ) * uI;
  gl_FragColor = vec4( uColor * a, 1.0 );
  #include <colorspace_fragment>
}`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  m.forceSinglePass = true; // (a transparent double-sided mesh would otherwise be drawn twice: additive light does not care about the order)
  m.name = 'at3dUsherShell';
  return m;
}

function makeGlintMaterial() {
  const m = new THREE.ShaderMaterial({
    uniforms: { uColor: { value: COL_GLINT.clone() } },
    vertexShader: `varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`,
    fragmentShader: `uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float r = length( vUv - 0.5 ) * 2.0;
  float core = exp( - r * r * 7.0 );
  float q = ( r - 0.55 ) * 5.0;
  float ring = exp( - q * q ) * 0.45;
  float a = ( core + ring ) * ( 1.0 - smoothstep( 0.85, 1.0, r ) );
  gl_FragColor = vec4( uColor * a, 1.0 );
  #include <colorspace_fragment>
}`,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: false,
    toneMapped: false,
  });
  m.forceSinglePass = true;
  m.name = 'at3dUsherGlint';
  return m;
}

// ---------------------------------------------------------------------------------------------------------------------
// One pool member: a skeleton, its meshes per level of detail, its pose and torch state
// ---------------------------------------------------------------------------------------------------------------------
class Member {
  constructor(index, head) {
    this.index = index;
    this.head = head;
    this.root = new THREE.Group();
    this.root.name = head ? 'HeadUsher' : 'Usher' + index;
    this.root.visible = false;
    this.bones = [];
    this.skeleton = null;
    this.neck = []; // Neck01..Neck14
    this.maw = null;
    this.lod0 = []; // the five body primitives
    this.glow = null;
    this.body1 = null;
    this.body2 = null;
    this.hullNear = null;
    this.hullFar = null;
    this.bs = new THREE.Sphere(new THREE.Vector3(0, 1.7, 0.2), 3);
    // state (copied from the sim's object in setStates)
    this.used = false;
    this.keep = false;
    this.id = null;
    this.vis = false;
    this.x = 0;
    this.y = 0;
    this.z = 0;
    this.yaw = 0;
    this.clipId = 0;
    this.t = 0;
    this.stretch = 1;
    this.collar = false;
    this.hasRing = false;
    this.rx = 0;
    this.ry = 0;
    this.rz = 0;
    this.hasSphere = false;
    this.sx = 0;
    this.sy = 0;
    this.sz = 0;
    this.sr = 1;
    this.stage = 0;
    // pose
    this.fresh = true;
    this.wasPosed = false;
    this.prevClip = -1;
    this.prevT = 0;
    this.fade = 0;
    this.lod = 0;
    this.lodShown = -2;
    // the ring in the world (given, or read off the skeleton), valid when ringOk
    this.ringOk = false;
    this.ringX = 0;
    this.ringY = 0;
    this.ringZ = 0;
    // torch envelope
    this.tStage = 0;
    this.tT = 0;
    this.tR0 = 1;
    this.tI = 0; // current brightness 0..1.2
    this.tOn = false;
  }
}

export class UsherView {
  constructor(renderer, opts = {}) {
    this.renderer = renderer || null;
    this.opts = Object.assign({ reducedEffects: false }, opts || {});
    this.scene = (renderer && renderer.scene) || null;
    this.root = new THREE.Group();
    this.root.name = 'UsherView';
    this.members = [];
    this.ready = false;
    this._loading = null;
    this._disposed = false;
    this._tier = null;
    this._reduced = !!this.opts.reducedEffects;
    this._time = 0;
    this._glints = 0;
    this._shellTris = 0;
    this._ringComp = true;
    this._camSeen = false;
    this._clips = null;
    this._clipNames = [];
    this._clipIdx = Object.create(null);
    this._done = new Uint8Array(64);
    this.info = { triangles: [0, 0, 0], hull: [0, 0], bones: 0, clips: 0 };
    this.collarLocal = [0, 1.62, 0.08]; // m, model space: the head of Neck01 (set from the file)
    this._stats = { shown: 0, drawCalls: 0, triangles: 0, sphereShown: false, poolSize: 0, lods: [0, 0, 0, 0], hulls: 0 };
    this._owned = []; // geometries and materials this view disposes
    this.spheres = [];
    this._buildTorch();
    if (this.scene) this.scene.add(this.root);
  }

  /** Is the model in (the pool built)? */
  get isReady() {
    return this.ready;
  }

  /** The tier in effect: setTier's, else the renderer's qualityTier (like DresserView), else 'quest'. */
  get tier() {
    return this._tier || (this.renderer && this.renderer.qualityTier) || 'quest';
  }

  get stats() {
    return this._stats;
  }

  setTier(tier) {
    this._tier = tier === 'low' || tier === 'quest' || tier === 'high' ? tier : null;
  }

  setReducedEffects(on) {
    this._reduced = !!on;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Loading
  // ---------------------------------------------------------------------------------------------------------------
  /** Fetches and parses usher.glb and builds the pool. Resolves true / false, never throws; idempotent. */
  load(url = USHER_URL) {
    if (this._loading) return this._loading;
    if (this.ready) return Promise.resolve(true);
    this._loading = Promise.resolve()
      .then(() => loadGLB(url))
      .then((gltf) => {
        if (this._disposed) return false;
        this.buildFromGLTF(gltf);
        return true;
      })
      .catch((err) => {
        this.error = err;
        if (typeof console !== 'undefined' && console.warn) console.warn('[AT3D] usher.glb unavailable', err && err.message);
        this._loading = null;
        return false;
      });
    return this._loading;
  }

  /** Builds the pool from a parsed usher.glb (a GLTFLoader result). Throws on a model that does not honour the contract. */
  buildFromGLTF(gltf, opts = {}) {
    if (this._disposed || this.ready) return;
    const skinned = [];
    gltf.scene.traverse((o) => {
      if (o.isSkinnedMesh) skinned.push(o);
    });
    if (!skinned.length) throw new Error('usher.glb: no skinned mesh');
    const sk = skinned[0].skeleton;
    const tb = sk.bones;
    const byName = Object.create(null);
    tb.forEach((b, i) => (byName[b.name] = i));
    const need = ['Root', 'Pelvis', 'Spine3', 'Maw'];
    for (let i = 1; i <= NECKS; i++) need.push('Neck' + String(i).padStart(2, '0'));
    for (const n of need) if (byName[n] === undefined) throw new Error('usher.glb: missing bone ' + n);
    gltf.scene.updateMatrixWorld(true);

    // the dequantisation matrix (positions are normalised int16; it lives in the inverse binds): real = D * stored
    const D = new THREE.Matrix4().multiplyMatrices(tb[0].matrixWorld, sk.boneInverses[0]);
    const neckIdx = [];
    for (let i = 1; i <= NECKS; i++) neckIdx.push(byName['Neck' + String(i).padStart(2, '0')]);
    const mawIdx = byName.Maw;
    const heads = [];
    for (let k = 0; k <= NECKS; k++) {
      _v.setFromMatrixPosition(tb[k < NECKS ? neckIdx[k] : mawIdx].matrixWorld);
      heads.push([_v.x, _v.y, _v.z]);
    }
    this.collarLocal = heads[0].slice();

    // the primitives by material
    const prim = {};
    for (const m of skinned) {
      const nm = String(m.material && m.material.name).replace('Usher_', '');
      prim[nm] = prim[nm] || m;
    }
    const bodyNames = ['suit', 'shirt', 'skin', 'vein', 'shoe'].filter((n) => prim[n]);
    const glowMesh = prim.glow || null;

    // the throat's weights (skin: throat + ring, vein: veins and thorns, glow: the membrane)
    if (opts.reweight !== false) {
      const ctx = { neck: neckIdx, maw: mawIdx, boneInverses: sk.boneInverses, D, heads };
      for (const n of ['skin', 'vein', 'glow']) if (prim[n]) restretchWeights(prim[n].geometry, ctx);
    }

    this._ringComp = opts.reweight !== false;
    for (const n of bodyNames) this._owned.push(prim[n].geometry);
    if (glowMesh) this._owned.push(glowMesh.geometry);

    // the materials (view-owned clones: the GLB's stay untouched)
    const mats = {};
    for (const n of bodyNames) {
      const mat = prim[n].material.clone();
      mat.vertexColors = false;
      mats[n] = patchBody(mat);
      this._owned.push(mat);
    }
    let glowMat = null;
    if (glowMesh) {
      glowMat = glowMesh.material.clone();
      glowMat.fog = false; // the ring pierces the haze: it is the only light he has
      this._owned.push(glowMat);
    }
    const farMat = patchBody(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0, side: THREE.DoubleSide }));
    farMat.name = 'Usher_far';
    this._owned.push(farMat);

    // levels of detail 1 and 2: suit + shirt + skin + shoe clustered into one geometry each (no veins)
    const parts = ['suit', 'shirt', 'skin', 'shoe']
      .filter((n) => prim[n])
      .map((n) => ({ geometry: prim[n].geometry, color: [prim[n].material.color.r, prim[n].material.color.g, prim[n].material.color.b] }));
    const geo1 = clusterSkinned(parts, D, CLUSTER_CELL[1]);
    const geo2 = clusterSkinned(parts, D, CLUSTER_CELL[2]);
    this._owned.push(geo1, geo2);
    // the ink hulls: near = the real surface without the veins, far = the LOD1 geometry
    let hullNearGeo = null;
    const hullSources = ['suit', 'shirt', 'skin', 'shoe'].filter((n) => prim[n]).map((n) => prim[n]);
    try {
      hullNearGeo = mergedHullGeometry(hullSources);
      if (hullNearGeo) this._owned.push(hullNearGeo);
    } catch {
      hullNearGeo = null;
    }
    let hullFarGeo = null;
    try {
      // the far hull is a coarser copy still (cell 5 cm: within the line's width from 12 m on)
      hullFarGeo = mergedHullGeometry([{ geometry: clusterSkinned(parts, D, CLUSTER_CELL[0]) }]);
      if (hullFarGeo) this._owned.push(hullFarGeo);
    } catch {
      hullFarGeo = null;
    }

    const tri = (g) => (g.index ? g.index.count / 3 : g.attributes.position.count / 3);
    let t0 = 0;
    for (const n of bodyNames) t0 += tri(prim[n].geometry);
    if (glowMesh) t0 += tri(glowMesh.geometry);
    const tg = glowMesh ? tri(glowMesh.geometry) : 0;
    this.info.triangles = [t0, tri(geo1) + tg, tri(geo2) + tg];
    this.info.hull = [hullNearGeo ? tri(hullNearGeo) : 0, hullFarGeo ? tri(hullFarGeo) : 0];
    this.info.bones = tb.length;

    // the clips: every track resolved to (bone, kind, interpolant) once
    this._clips = [];
    for (const clip of gltf.animations || []) {
      const bone = [];
      const kind = [];
      const terp = [];
      for (const tr of clip.tracks) {
        const dot = tr.name.lastIndexOf('.');
        const bi = byName[tr.name.slice(0, dot)];
        const prop = tr.name.slice(dot + 1);
        const kd = prop === 'position' ? 0 : prop === 'quaternion' ? 1 : prop === 'scale' ? 2 : -1;
        if (bi === undefined || kd < 0) continue;
        bone.push(bi);
        kind.push(kd);
        terp.push(tr.createInterpolant());
      }
      this._clips.push({ name: clip.name, duration: Math.max(clip.duration, 1e-3), loop: !!LOOPING[clip.name], bone, kind, terp });
      this._clipNames.push(clip.name);
    }
    if (!this._clips.length) throw new Error('usher.glb: no clips');
    this._clips.forEach((c, i) => (this._clipIdx[c.name] = i));
    this._idle = this._clipIdx.Idle !== undefined ? this._clipIdx.Idle : 0;
    for (const alias of Object.keys(CLIP_FALLBACK)) {
      if (this._clipIdx[alias] === undefined) {
        const to = this._clipIdx[CLIP_FALLBACK[alias]];
        this._clipIdx[alias] = to !== undefined ? to : this._idle;
      }
    }
    this.info.clips = this._clips.length;

    // the pool
    for (let i = 0; i < POOL_SIZE; i++) {
      const m = new Member(i, i === HEAD_SLOT);
      // bones: clones of the template's (same names, rest transform, parents)
      for (let b = 0; b < tb.length; b++) {
        const nb = new THREE.Bone();
        nb.name = tb[b].name;
        nb.position.copy(tb[b].position);
        nb.quaternion.copy(tb[b].quaternion);
        nb.scale.copy(tb[b].scale);
        m.bones.push(nb);
      }
      for (let b = 0; b < tb.length; b++) {
        const p = tb[b].parent && tb[b].parent.isBone ? tb.indexOf(tb[b].parent) : -1;
        if (p >= 0) m.bones[p].add(m.bones[b]);
        else m.root.add(m.bones[b]);
      }
      m.skeleton = new THREE.Skeleton(m.bones, sk.boneInverses);
      m.neck = neckIdx.map((bi) => m.bones[bi]);
      m.maw = m.bones[mawIdx];
      const bind = skinned[0].bindMatrix;
      const make = (geo, mat, name, visible) => {
        const sm = new THREE.SkinnedMesh(geo, mat);
        sm.name = name;
        sm.bind(m.skeleton, bind);
        sm.boundingSphere = m.bs;
        sm.frustumCulled = true;
        sm.castShadow = false;
        sm.receiveShadow = false;
        sm.userData.noShadowCast = true;
        sm.visible = visible;
        m.root.add(sm);
        return sm;
      };
      for (const n of bodyNames) m.lod0.push(make(prim[n].geometry, mats[n], 'usher_' + n, false));
      if (glowMesh) m.glow = make(glowMesh.geometry, glowMat, 'usher_glow', false);
      m.body1 = make(geo1, farMat, 'usher_lod1', false);
      m.body2 = make(geo2, farMat, 'usher_lod2', false);
      const nearSources = m.lod0.filter((s) => /usher_(suit|shirt|skin|shoe)$/.test(s.name));
      if (hullNearGeo && nearSources.length) m.hullNear = addOutline(nearSources, { geometry: hullNearGeo });
      if (hullFarGeo) m.hullFar = addOutline([m.body1], { geometry: hullFarGeo });
      m.root.scale.setScalar(m.head ? HEAD_SCALE : 1);
      this.root.add(m.root);
      this.members.push(m);
    }
    this.ready = true;
    this._stats.poolSize = this.members.length;
    UsherView.ready = true;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The torch: one shell per pool slot, one batched line, one batch of glints
  // ---------------------------------------------------------------------------------------------------------------
  _buildTorch() {
    const sg = new THREE.SphereGeometry(1, 20, 12);
    this._shellTris = sg.index.count / 3;
    this._owned.push(sg);
    for (let i = 0; i < POOL_SIZE; i++) {
      const mat = makeShellMaterial();
      this._owned.push(mat);
      const mesh = new THREE.Mesh(sg, mat);
      mesh.name = 'UsherTorch' + i;
      mesh.visible = false;
      mesh.renderOrder = 30;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.root.add(mesh);
      this.spheres.push(mesh);
    }
    // the line from each ring to its sphere's centre: a camera-facing ribbon, 6 quads in one draw
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POOL_SIZE * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    lg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(POOL_SIZE * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const li = [];
    for (let i = 0; i < POOL_SIZE; i++) li.push(i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 1, i * 4 + 3, i * 4 + 2);
    lg.setIndex(li);
    const lm = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, side: THREE.DoubleSide, fog: false, toneMapped: false });
    lm.forceSinglePass = true;
    lm.name = 'at3dUsherLine';
    this.line = new THREE.Mesh(lg, lm);
    this.line.name = 'UsherTorchLine';
    this.line.frustumCulled = false;
    this.line.visible = false;
    this.line.renderOrder = 29;
    this.root.add(this.line);
    this._owned.push(lg, lm);
    // the ring glints of the far ushers
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POOL_SIZE * 4 * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const uv = new Float32Array(POOL_SIZE * 4 * 2);
    for (let i = 0; i < POOL_SIZE; i++) uv.set([0, 0, 1, 0, 0, 1, 1, 1], i * 8);
    gg.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    gg.setIndex(li);
    const gm = makeGlintMaterial();
    this.glints = new THREE.Mesh(gg, gm);
    this.glints.name = 'UsherGlints';
    this.glints.frustumCulled = false;
    this.glints.visible = false;
    this.glints.renderOrder = 28;
    this.root.add(this.glints);
    this._owned.push(gg, gm);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // States
  // ---------------------------------------------------------------------------------------------------------------
  /** The sim's list of ushers in view (see the header). Allocation-free; the objects are copied, not kept. */
  setStates(list) {
    if (!this.ready || this._disposed) return;
    const P = this.members;
    const n = list ? Math.min(list.length, this._done.length) : 0;
    const done = this._done;
    for (let i = 0; i < P.length; i++) P[i].keep = false;
    for (let i = 0; i < n; i++) {
      done[i] = 0;
      const s = list[i];
      if (!s || (s.visible === false && !s.sphere)) {
        done[i] = 1; // nothing to draw
        continue;
      }
      // an usher that already has a slot keeps it
      for (let j = 0; j < P.length; j++) {
        const m = P[j];
        if (m.used && !m.keep && m.id === s.id && m.head === !!s.head) {
          this._take(m, s, false);
          done[i] = 1;
          break;
        }
      }
    }
    // the rest: the head first, then the nearest to the camera
    if (!P[HEAD_SLOT].keep) {
      for (let i = 0; i < n; i++) {
        if (!done[i] && list[i].head) {
          this._take(P[HEAD_SLOT], list[i], true);
          done[i] = 1;
          break;
        }
      }
    }
    for (;;) {
      let free = null;
      for (let j = 0; j < POOL_ORDINARY; j++) {
        if (!P[j].keep) {
          free = P[j];
          break;
        }
      }
      if (!free) break;
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        if (done[i] || list[i].head) continue;
        const s = list[i];
        const dx = num(s.x) - _cam.x;
        const dy = num(s.y) - _cam.y;
        const dz = num(s.z) - _cam.z;
        const dd = this._camSeen ? dx * dx + dy * dy + dz * dz : i;
        if (dd < bestD) {
          bestD = dd;
          best = i;
        }
      }
      if (best < 0) break;
      this._take(free, list[best], true);
      done[best] = 1;
    }
    for (let j = 0; j < P.length; j++) if (!P[j].keep) P[j].used = false;
  }

  _take(m, s, fresh) {
    m.keep = true;
    if (fresh) {
      m.used = true;
      m.id = s.id;
      m.lod = 0;
      m.fresh = true;
      m.fade = 0;
      m.tI = 0;
      m.tStage = 0;
      m.tOn = false;
      m.hasSphere = false;
    }
    m.vis = s.visible !== false;
    m.x = num(s.x);
    m.y = num(s.y);
    m.z = num(s.z);
    m.yaw = num(s.yaw);
    m.collar = s.collar === true;
    let ci = this._clipIdx[s.clip];
    if (ci === undefined) ci = this._idle;
    if (ci !== m.clipId && !m.fresh) {
      m.prevClip = m.clipId;
      m.prevT = m.t;
      m.fade = 1;
    }
    m.clipId = ci;
    m.t = Math.max(0, num(s.t));
    m.stretch = m.head ? clamp(s.stretch >= 1 ? s.stretch : 1, 1, STRETCH_MAX) : 1;
    const r = s.ring;
    if (r) {
      m.hasRing = true;
      m.rx = num(r.x);
      m.ry = num(r.y);
      m.rz = num(r.z);
    } else m.hasRing = false;
    const sp = s.sphere;
    if (sp) {
      m.hasSphere = true;
      m.sx = num(sp.x);
      m.sy = num(sp.y);
      m.sz = num(sp.z);
      m.sr = Math.max(0.05, num(sp.r));
      m.stage = _stageId[sp.stage] || STAGE.listen;
    } else m.hasSphere = false;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------------------------------------------
  update(dt, camera) {
    if (!this.ready || this._disposed) return;
    dt = dt > 0 && dt < 0.5 ? dt : dt >= 0.5 ? 0.5 : 0;
    this._time += dt;
    if (camera && camera.matrixWorld) {
      const e = camera.matrixWorld.elements;
      _cam.set(e[12], e[13], e[14]);
      _right.set(e[0], e[1], e[2]).normalize();
      _up.set(e[4], e[5], e[6]).normalize();
      this._camSeen = true;
    }
    const tier = this.tier;
    const st = this._stats;
    st.shown = 0;
    st.drawCalls = 0;
    st.triangles = 0;
    st.hulls = 0;
    st.lods[0] = st.lods[1] = st.lods[2] = st.lods[3] = 0;
    const P = this.members;
    for (let i = 0; i < P.length; i++) {
      const m = P[i];
      if (!m.used) {
        this._hide(m);
        continue;
      }
      this._place(m, dt, tier);
    }
    this._updateTorch(dt);
    this.glints.visible = this._glints > 0;
    if (this._glints > 0) {
      st.drawCalls++;
      st.triangles += this._glints * 2;
    }
  }

  _hide(m) {
    this._applyLod(m, -2);
    m.root.visible = false;
    m.ringOk = false;
    m.wasPosed = false;
  }

  _place(m, dt, tier) {
    const st = this._stats;
    const sc = m.head ? HEAD_SCALE : 1;
    let px = m.x;
    let py = m.y;
    let pz = m.z;
    if (m.collar) {
      // (x, y, z) is the base of the throat: the model's origin is its collar's offset away, turned by the yaw
      const cs = Math.sin(m.yaw);
      const cc = Math.cos(m.yaw);
      const lx = this.collarLocal[0] * sc;
      const lz = this.collarLocal[2] * sc;
      px -= lx * cc + lz * cs;
      py -= this.collarLocal[1] * sc;
      pz -= -lx * cs + lz * cc;
    }
    m.root.position.set(px, py, pz);
    m.root.rotation.y = m.yaw;
    m.root.scale.setScalar(sc);
    m.bs.radius = Math.max(2.4, 3.9 * m.stretch + 0.6);
    // the level of detail from the camera to his chest (the head is judged as if it were the stock height)
    let lod = 0;
    if (this._camSeen) {
      const dx = px - _cam.x;
      const dy = py + 1.2 * sc - _cam.y;
      const dz = pz - _cam.z;
      lod = pickLod(Math.sqrt(dx * dx + dy * dy + dz * dz) / sc, tier, m.lod < 0 ? 3 : m.lod);
    }
    m.lod = lod;
    m.ringOk = false;
    if (m.vis && lod >= 0) {
      this._pose(m, dt);
      m.root.visible = lod <= 2; // (a glint is not the group's business)
      // the torch ring: the sim's, or the lip of the Maw bone (needed for a sphere's line and for the glint of a far one)
      if (!m.hasRing && (m.hasSphere || m.tI > 0.01 || lod === 3)) {
        m.root.updateMatrixWorld(true);
        _v.set(0, RING_LIP, 0).applyMatrix4(m.maw.matrixWorld);
        m.ringX = _v.x;
        m.ringY = _v.y;
        m.ringZ = _v.z;
        m.ringOk = true;
      }
    } else {
      m.root.visible = false;
      m.wasPosed = false;
    }
    if (m.hasRing) {
      m.ringX = m.rx;
      m.ringY = m.ry;
      m.ringZ = m.rz;
      m.ringOk = true;
    }
    this._applyLod(m, m.vis ? lod : -2);
    if (m.vis && lod >= 0 && lod <= 2) {
      st.shown++;
      st.lods[lod]++;
      st.drawCalls += lod === 0 ? m.lod0.length + (m.glow ? 1 : 0) : 1 + (m.glow ? 1 : 0);
      st.triangles += this.info.triangles[lod];
      if (OUTLINE.on) {
        const hull = lod === 0 ? m.hullNear : lod === 1 ? m.hullFar : null;
        if (hull) {
          st.drawCalls++;
          st.hulls++;
          st.triangles += this.info.hull[lod];
        }
      }
    } else if (m.vis && lod === 3) {
      st.shown++;
      st.lods[3]++;
    }
  }

  _applyLod(m, lod) {
    if (m.lodShown !== lod) {
      m.lodShown = lod;
      const l0 = lod === 0;
      for (let k = 0; k < m.lod0.length; k++) m.lod0[k].visible = l0;
      if (m.glow) m.glow.visible = lod >= 0 && lod <= 2;
      m.body1.visible = lod === 1;
      m.body2.visible = lod === 2;
    }
    const on = OUTLINE.on;
    if (m.hullNear) m.hullNear.visible = on && lod === 0;
    if (m.hullFar) m.hullFar.visible = on && lod === 1;
  }

  /** Samples the clip (crossfading from the previous one), then the head's throat stretch and the ring's scale. */
  _pose(m, dt) {
    const clips = this._clips;
    const c = clips[m.clipId];
    if (!m.wasPosed) m.fade = 0; // (just appeared: nothing to fade from)
    m.wasPosed = true;
    if (m.fade > 0) m.fade = Math.max(0, m.fade - dt / FADE);
    if (m.fade > 0 && m.prevClip >= 0) {
      m.prevT += dt;
      this._sample(m, clips[m.prevClip], m.prevT, 1);
      this._sample(m, c, m.t, 1 - m.fade);
    } else this._sample(m, c, m.t, 1);
    m.fresh = false;
    // the throat pays out: the link offsets grow (the chain only turns in the clips; every bone keeps scale 1)
    const s = m.stretch;
    if (s > 1) {
      for (let k = 1; k < NECKS; k++) m.neck[k].position.multiplyScalar(s);
      m.maw.position.multiplyScalar(s);
    }
    // the ring's membrane is pure Maw now (it was 75 % Maw, 25 % Neck14): keep the opening the clip meant
    if (this._ringComp) {
      const sx = m.maw.scale.x;
      if (sx !== 1) m.maw.scale.setScalar(1 + 0.75 * (sx - 1));
    }
  }

  /** Writes the clip's pose at time t over the skeleton with weight w (1 = replace, less = blend from what is there). */
  _sample(m, c, t, w) {
    const tt = c.loop ? t - Math.floor(t / c.duration) * c.duration : t < c.duration ? t : c.duration;
    const bones = m.bones;
    const n = c.bone.length;
    for (let i = 0; i < n; i++) {
      const b = bones[c.bone[i]];
      const r = c.terp[i].evaluate(tt);
      switch (c.kind[i]) {
        case 0:
          if (w >= 1) b.position.set(r[0], r[1], r[2]);
          else b.position.set(b.position.x + (r[0] - b.position.x) * w, b.position.y + (r[1] - b.position.y) * w, b.position.z + (r[2] - b.position.z) * w);
          break;
        case 1:
          if (w >= 1) b.quaternion.set(r[0], r[1], r[2], r[3]);
          else {
            _q.set(r[0], r[1], r[2], r[3]);
            b.quaternion.slerp(_q, w);
          }
          break;
        default:
          if (w >= 1) b.scale.set(r[0], r[1], r[2]);
          else b.scale.set(b.scale.x + (r[0] - b.scale.x) * w, b.scale.y + (r[1] - b.scale.y) * w, b.scale.z + (r[2] - b.scale.z) * w);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The torch
  // ---------------------------------------------------------------------------------------------------------------
  _updateTorch(dt) {
    const st = this._stats;
    const P = this.members;
    const lp = this.line.geometry.attributes.position.array;
    const lc = this.line.geometry.attributes.color.array;
    const gp = this.glints.geometry.attributes.position.array;
    let lines = 0;
    let shells = 0;
    let glints = 0;
    const reduced = this._reduced;
    for (let i = 0; i < P.length; i++) {
      const m = P[i];
      const mesh = this.spheres[i];
      // the envelope: what the stage looks like (a sphere that goes away dies like 'snuff', where it was)
      const stage = m.used && m.hasSphere ? m.stage : m.tI > 0.01 ? STAGE.snuff : STAGE.none;
      if (stage !== m.tStage) {
        m.tStage = stage;
        m.tT = 0;
        if (stage === STAGE.coil) m.tR0 = m.sr;
      } else m.tT += dt;
      const u = mesh.material.uniforms;
      const tm = this._time;
      let target = 0;
      let rate = 12;
      let fill = u.uFill.value;
      let pw = u.uPow.value;
      switch (stage) {
        case STAGE.listen: // pale, wide, drifting (the position is the sim's)
          target = 0.55 + (reduced ? 0 : 0.1 * Math.sin(tm * 5.65)); // 0.9 Hz
          rate = 10;
          fill = 0.07;
          pw = 2.6;
          _col.copy(COL_LISTEN);
          break;
        case STAGE.coil: { // tightens (the radius falls to ~0.6 of where the coil began) and brightens, pale -> warm
          const p = clamp(Math.max((1 - m.sr / m.tR0) / 0.4, m.tT / 1.4), 0, 1);
          target = 0.65 + 0.35 * p + (reduced ? 0 : 0.06 * (1 - p) * Math.sin(tm * 8.8)); // 1.4 Hz
          rate = 8;
          fill = 0.07 + 0.08 * p;
          pw = 2.8 + 0.6 * p;
          _col.copy(COL_LISTEN).lerp(COL_COIL, p);
          break;
        }
        case STAGE.commit: // GOLD, frozen
          target = 1;
          rate = 30;
          fill = 0.16;
          pw = 3.8;
          _col.copy(COL_COMMIT);
          break;
        case STAGE.whip: // a white-gold flash (+18 %, well under the 30 % comfort step) that settles
          target = 1 + 0.18 * Math.exp(-m.tT / 0.12);
          rate = 60;
          fill = 0.2;
          pw = 3.8;
          _col.copy(COL_WHIP);
          break;
        default: // snuff: it dies where it was, in the colour it had
          target = 0;
          rate = 9;
          _col.copy(u.uColor.value);
      }
      m.tI += (target - m.tI) * (1 - Math.exp(-rate * dt));
      if (target === 0 && m.tI < 0.02) m.tI = 0;
      if (m.tI <= 0) {
        m.tOn = false;
        mesh.visible = false;
        continue;
      }
      m.tOn = true;
      mesh.visible = true;
      shells++;
      mesh.position.set(m.sx, m.sy, m.sz);
      mesh.scale.setScalar(m.sr);
      u.uColor.value.copy(_col);
      u.uI.value = m.tI;
      u.uFill.value = reduced ? 0 : fill;
      u.uPow.value = reduced ? 7 : pw;
      st.drawCalls++;
      st.triangles += this._shellTris;
      // the thin line back to the ring
      if (m.ringOk && m.tI > 0.01) {
        const j = lines * 12;
        _d.set(m.sx - m.ringX, m.sy - m.ringY, m.sz - m.ringZ);
        _s.set(m.ringX + _d.x * 0.5 - _cam.x, m.ringY + _d.y * 0.5 - _cam.y, m.ringZ + _d.z * 0.5 - _cam.z);
        const dist = _s.length();
        _s.crossVectors(_d, _s);
        const sl = _s.length();
        if (sl > 1e-6) {
          const hw = Math.max(0.012, dist * 0.0014);
          _s.multiplyScalar(hw / sl);
          lp[j] = m.ringX - _s.x;
          lp[j + 1] = m.ringY - _s.y;
          lp[j + 2] = m.ringZ - _s.z;
          lp[j + 3] = m.ringX + _s.x;
          lp[j + 4] = m.ringY + _s.y;
          lp[j + 5] = m.ringZ + _s.z;
          lp[j + 6] = m.sx - _s.x;
          lp[j + 7] = m.sy - _s.y;
          lp[j + 8] = m.sz - _s.z;
          lp[j + 9] = m.sx + _s.x;
          lp[j + 10] = m.sy + _s.y;
          lp[j + 11] = m.sz + _s.z;
          const a = 0.9 * m.tI;
          const b = 0.4 * m.tI;
          lc[j] = lc[j + 3] = _col.r * a;
          lc[j + 1] = lc[j + 4] = _col.g * a;
          lc[j + 2] = lc[j + 5] = _col.b * a;
          lc[j + 6] = lc[j + 9] = _col.r * b;
          lc[j + 7] = lc[j + 10] = _col.g * b;
          lc[j + 8] = lc[j + 11] = _col.b * b;
          lines++;
        }
      }
    }
    // the glints of the ushers too far to be drawn
    for (let i = 0; i < P.length; i++) {
      const m = P[i];
      if (!m.used || !m.vis || m.lod !== 3 || !m.ringOk) continue;
      const sc = m.head ? HEAD_SCALE : 1;
      _s.set(m.ringX - _cam.x, m.ringY - _cam.y, m.ringZ - _cam.z);
      const rad = Math.max(0.3 * sc, _s.length() * 0.0035);
      const j = glints * 12;
      for (let c = 0; c < 4; c++) {
        const sx = c & 1 ? 1 : -1;
        const sy = c & 2 ? 1 : -1;
        gp[j + c * 3] = m.ringX + (_right.x * sx + _up.x * sy) * rad;
        gp[j + c * 3 + 1] = m.ringY + (_right.y * sx + _up.y * sy) * rad;
        gp[j + c * 3 + 2] = m.ringZ + (_right.z * sx + _up.z * sy) * rad;
      }
      glints++;
    }
    // unused quads collapse to nothing
    for (let k = lines * 12; k < lp.length; k++) lp[k] = 0;
    for (let k = glints * 12; k < gp.length; k++) gp[k] = 0;
    this.line.geometry.attributes.position.needsUpdate = true;
    this.line.geometry.attributes.color.needsUpdate = true;
    this.glints.geometry.attributes.position.needsUpdate = true;
    this._glints = glints;
    this.line.geometry.setDrawRange(0, lines * 6);
    this.glints.geometry.setDrawRange(0, glints * 6);
    this.line.visible = lines > 0;
    if (lines > 0) {
      st.drawCalls++;
      st.triangles += lines * 2;
    }
    st.sphereShown = shells > 0;
  }

  // ---------------------------------------------------------------------------------------------------------------
  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    this.ready = false;
    for (const m of this.members) {
      removeOutline(m.hullNear);
      removeOutline(m.hullFar);
      if (m.skeleton) m.skeleton.dispose();
      if (m.root.parent) m.root.parent.remove(m.root);
    }
    if (this.root.parent) this.root.parent.remove(this.root);
    for (const o of this._owned) o.dispose();
    this._owned.length = 0;
    this._stats.poolSize = 0;
    this._stats.shown = this._stats.drawCalls = this._stats.triangles = 0;
    this._stats.sphereShown = false;
    this.members = [];
    this.spheres = [];
  }
}

UsherView.ready = false;

function num(v) {
  return typeof v === 'number' && isFinite(v) ? v : 0;
}

