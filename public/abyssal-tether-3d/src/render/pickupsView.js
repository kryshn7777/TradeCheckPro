/* ABYSSAL TETHER 3D — pickupsView.js
 * The supplies lying in the Underspire as small glowing props. TWO draw calls for every pickup of the run:
 *
 *   1. the props: ONE mesh whose geometry is the merged silhouettes of the chosen items (rebuilt, a few hundred
 *      vertices, when the pickups change). Spin, bob, glow pulse and the vanish on collection all happen in the
 *      vertex shader (per-vertex item centre + phase), so nothing is touched per frame but one uniform. A
 *      MeshStandardMaterial with vertex colours, so the lantern lights them like the rest of the level and the
 *      fog swallows them; a little self-emission pulses.
 *   2. the glow: one instanced camera-facing quad per item (additive, depth-tested, no depth write): the soft
 *      pulsing halo, tinted per kind, and the collect puff (the halo swells and fades over 0.55 s). It fades out
 *      before the fog does.
 *
 * Silhouettes (readable without colour, the same shapes as the icons in bagFx.js):
 *   FIRST_AID   a wide case with a handle on top and a cross standing proud of its face
 *   BANDAGE     a roll seen from the side (a squat drum, a dark core, a band) with a flat loose tail
 *   ADRENALINE  a syringe on the diagonal: barrel, needle, plunger rod, finger flange and thumb plate
 *   BATTERY     an upright cell: tall drum, a terminal nub, a wide band
 *
 *   PickupsView(game)         game: { renderer.scene, pickups }
 *   .update(dt, game)         once per frame (Game3D._updateViews)
 *   .sync(pickups)            rebuild from pickups.items (called when pickups.version changes)
 *   .dispose()
 * The meshes exist (visible) from the start so the scene precompile compiles their programs; items beyond the fog
 * distance switch both off.
 */

import * as THREE from 'three';
import { ITEM, ITEM_COUNT } from '../sim/inventory3d.js';

const MAX_ITEMS = 48;
const PUFF_S = 0.55;
const NONE = -1e9;
const TILT = 0.28; // rad: the props are tipped toward the viewer a little so the spin shows their tops

// ---------------------------------------------------------------------------------------------
// Silhouette templates (metres; origin at the prop centre)
// ---------------------------------------------------------------------------------------------

const col = (hex) => new THREE.Color(hex);

/** Merges parts {geo, pos:[x,y,z], rot:[x,y,z], color} into flat arrays (indexed, vertex-coloured). */
function mergeAll(parts, size = 1, tiltAngle = TILT) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const nm = new THREE.Matrix3();
  const tilt = new THREE.Matrix4().makeRotationX(tiltAngle);
  const v = new THREE.Vector3();
  const pos = [];
  const nor = [];
  const colr = [];
  const idx = [];
  for (const p of parts) {
    const g = p.geo;
    e.set(p.rot ? p.rot[0] : 0, p.rot ? p.rot[1] : 0, p.rot ? p.rot[2] : 0);
    q.setFromEuler(e);
    m.compose(new THREE.Vector3(p.pos[0], p.pos[1], p.pos[2]), q, new THREE.Vector3(1, 1, 1)).premultiply(tilt);
    nm.getNormalMatrix(m);
    const base = pos.length / 3;
    const pa = g.attributes.position;
    const na = g.attributes.normal;
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(m);
      pos.push(v.x * size, v.y * size, v.z * size);
      v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
      nor.push(v.x, v.y, v.z);
      colr.push(p.color.r, p.color.g, p.color.b);
    }
    const ia = g.index;
    for (let i = 0; i < ia.count; i++) idx.push(base + ia.getX(i));
    g.dispose();
  }
  return { pos: new Float32Array(pos), nor: new Float32Array(nor), col: new Float32Array(colr), idx: new Uint16Array(idx), verts: pos.length / 3 };
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (r0, r1, h, seg = 10) => new THREE.CylinderGeometry(r0, r1, h, seg, 1);

/** The four item silhouettes (templates[kind] = {pos, nor, col, idx, verts}); tilt = rad about X (the world props lean toward the viewer; dropped props use 0). */
export function buildTemplates(tilt = TILT) {
  const t = [];
  const mergeParts = (parts, size) => mergeAll(parts, size, tilt);
  // FIRST_AID: case + handle + proud cross (front and back) + latch
  const caseC = col(0xd9d4c4);
  const red = col(0xb8281f);
  const dark = col(0x3a3733);
  t[ITEM.FIRST_AID] = mergeParts([
    { geo: box(0.3, 0.2, 0.11), pos: [0, 0, 0], color: caseC },
    { geo: box(0.13, 0.03, 0.03), pos: [0, 0.135, 0], color: dark },
    { geo: box(0.03, 0.05, 0.03), pos: [-0.05, 0.11, 0], color: dark },
    { geo: box(0.03, 0.05, 0.03), pos: [0.05, 0.11, 0], color: dark },
    { geo: box(0.05, 0.15, 0.025), pos: [0, 0, 0.0675], color: red },
    { geo: box(0.15, 0.05, 0.025), pos: [0, 0, 0.0675], color: red },
    { geo: box(0.05, 0.15, 0.025), pos: [0, 0, -0.0675], color: red },
    { geo: box(0.15, 0.05, 0.025), pos: [0, 0, -0.0675], color: red },
    { geo: box(0.035, 0.03, 0.02), pos: [0.12, 0.09, 0.06], color: dark },
  ]);
  // BANDAGE: a roll (axis along Z), a dark core, a tape band, a flat loose tail
  const gauze = col(0xe0d6b8);
  const tape = col(0xb89a62);
  const core = col(0x2c2a26);
  t[ITEM.BANDAGE] = mergeParts([
    { geo: cyl(0.085, 0.085, 0.11, 14), pos: [-0.03, 0, 0], rot: [Math.PI / 2, 0, 0], color: gauze },
    { geo: cyl(0.04, 0.04, 0.118, 10), pos: [-0.03, 0, 0], rot: [Math.PI / 2, 0, 0], color: core },
    { geo: cyl(0.0875, 0.0875, 0.036, 14), pos: [-0.03, 0, 0], rot: [Math.PI / 2, 0, 0], color: tape },
    { geo: box(0.17, 0.008, 0.1), pos: [0.115, -0.081, 0], rot: [0, 0, -0.1], color: gauze },
    { geo: box(0.014, 0.012, 0.1), pos: [0.19, -0.092, 0], rot: [0, 0, -0.1], color: tape },
  ]);
  // ADRENALINE: a syringe along X, tipped 35 degrees about Z
  const glass = col(0xa9d8d2);
  const fluid = col(0xe8a23c);
  const metal = col(0x8d9096);
  const plastic = col(0x2d3238);
  const rz = 0.61;
  t[ITEM.ADRENALINE] = mergeParts([
    { geo: cyl(0.024, 0.024, 0.16, 10), pos: [0, 0, 0], rot: [0, 0, Math.PI / 2 + rz], color: glass },
    { geo: cyl(0.017, 0.017, 0.09, 8), pos: [-0.02, 0, 0], rot: [0, 0, Math.PI / 2 + rz], color: fluid },
    { geo: box(0.012, 0.085, 0.024), pos: [0.0, 0, 0], rot: [0, 0, rz], color: plastic }, // finger flange (wide, flat)
    { geo: cyl(0.008, 0.008, 0.1, 6), pos: [0.13, 0.0, 0], rot: [0, 0, Math.PI / 2 + rz], color: plastic },
    { geo: cyl(0.032, 0.032, 0.01, 10), pos: [0.19, 0.0, 0], rot: [0, 0, Math.PI / 2 + rz], color: plastic }, // thumb plate
    { geo: cyl(0.0, 0.007, 0.085, 6), pos: [-0.1, 0, 0], rot: [0, 0, Math.PI / 2 + rz + Math.PI], color: metal }, // needle
    { geo: cyl(0.011, 0.011, 0.02, 6), pos: [-0.088, 0, 0], rot: [0, 0, Math.PI / 2 + rz], color: plastic },
  ], 1.55);
  // BATTERY: an upright cell
  const body = col(0x34383c);
  const band = col(0xd9a441);
  const cap = col(0xb9bcc0);
  t[ITEM.BATTERY] = mergeParts([
    { geo: cyl(0.055, 0.055, 0.17, 12), pos: [0, 0, 0], color: body },
    { geo: cyl(0.0565, 0.0565, 0.06, 12), pos: [0, -0.02, 0], color: band },
    { geo: cyl(0.022, 0.022, 0.035, 8), pos: [0, 0.1, 0], color: cap },
    { geo: cyl(0.056, 0.056, 0.012, 12), pos: [0, 0.085, 0], color: cap },
  ], 1.15);
  return t;
}

// ---------------------------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------------------------

const GLOW_VERT = /* glsl */ `
attribute vec4 aItem;
attribute float aKind;
attribute float aTaken;
uniform float uTime;
uniform float uFar;
varying vec2 vUv;
varying float vA;
varying float vKind;
void main() {
  vUv = uv;
  float bob = sin(uTime * 1.6 + aItem.w * 1.3) * 0.045;
  vec3 c = aItem.xyz + vec3(0.0, bob, 0.0);
  float pulse = 0.5 + 0.5 * sin(uTime * 2.1 + aItem.w * 1.7);
  float scale;
  float alpha;
  if (aTaken > -1.0e8) {
    float puff = clamp((uTime - aTaken) / ${PUFF_S.toFixed(2)}, 0.0, 1.0);
    scale = 0.4 + puff * 1.2;
    alpha = (1.0 - puff) * (1.0 - puff) * 0.8;
  } else {
    scale = 0.4 + 0.06 * pulse;
    alpha = 0.2 + 0.16 * pulse;
  }
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float dist = length(cameraPosition - c);
  // The halo is a camera-facing quad: a floor or wall within its radius used to slice it in half (a hard line through the glow).
  // Pushing the quad toward the eye by its own radius (never past 55 % of the way) puts the whole disc in front of whatever lies
  // within that radius behind the item, so the soft falloff is never cut by geometry; the shape is unchanged for the eye.
  float R = 0.5 * scale;
  c += (cameraPosition - c) / max(dist, 1.0e-3) * min(R * 1.15, dist * 0.55);
  vec3 wp = c + (right * position.x + up * position.y) * scale;
  vA = alpha * (1.0 - smoothstep(uFar * 0.5, uFar * 0.92, dist));
  vKind = aKind;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

const GLOW_FRAG = /* glsl */ `
varying vec2 vUv;
varying float vA;
varying float vKind;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float core = exp(-r * r * 8.0);
  float halo = exp(-r * 3.2) * 0.2;
  float edge = 1.0 - smoothstep(0.45, 1.0, r);
  vec3 tint = vKind < 0.5 ? vec3(1.0, 0.55, 0.45) : vKind < 1.5 ? vec3(1.0, 0.86, 0.55) : vKind < 2.5 ? vec3(0.5, 0.95, 0.9) : vec3(1.0, 0.78, 0.3);
  gl_FragColor = vec4(tint * (core + halo) * edge * vA, 1.0);
  #include <colorspace_fragment>
}`;

export class PickupsView {
  constructor(game) {
    this.game = game;
    this.scene = game.renderer.scene;
    this.t = 0;
    this._uniforms = { uTime: { value: 0 }, uFar: { value: 60 } };
    this._version = -1;
    this._pk = null;
    this._takenAt = new Float32Array(MAX_ITEMS).fill(NONE);
    this._wasTaken = new Uint8Array(MAX_ITEMS);
    this._n = 0;
    this._pos = [];

    // ---- props ----
    this.templates = buildTemplates();
    let maxV = 0;
    let maxI = 0;
    for (let k = 0; k < ITEM_COUNT; k++) {
      maxV = Math.max(maxV, this.templates[k].verts);
      maxI = Math.max(maxI, this.templates[k].idx.length);
    }
    const capV = MAX_ITEMS * maxV;
    const geo = new THREE.BufferGeometry();
    this._aPos = new THREE.BufferAttribute(new Float32Array(capV * 3), 3);
    this._aNor = new THREE.BufferAttribute(new Float32Array(capV * 3), 3);
    this._aCol = new THREE.BufferAttribute(new Float32Array(capV * 3), 3);
    this._aItem = new THREE.BufferAttribute(new Float32Array(capV * 4), 4);
    this._aLife = new THREE.BufferAttribute(new Float32Array(capV), 1);
    for (const a of [this._aPos, this._aNor, this._aCol, this._aItem, this._aLife]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this._aPos);
    geo.setAttribute('normal', this._aNor);
    geo.setAttribute('color', this._aCol);
    geo.setAttribute('aItem', this._aItem);
    geo.setAttribute('aLife', this._aLife);
    this._aIdx = new THREE.BufferAttribute(new Uint16Array(MAX_ITEMS * maxI), 1);
    this._aIdx.setUsage(THREE.DynamicDrawUsage);
    geo.setIndex(this._aIdx);
    geo.setDrawRange(0, 0);
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.12 });
    mat.name = 'pickupProps';
    const uni = this._uniforms;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uni.uTime;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 aItem;\nattribute float aLife;\nuniform float uTime;\nvarying float vPulse;')
        .replace(
          '#include <beginnormal_vertex>',
          `float pAng = uTime * 0.9 + aItem.w;
float pCa = cos(pAng);
float pSa = sin(pAng);
mat3 pRot = mat3(pCa, 0.0, -pSa, 0.0, 1.0, 0.0, pSa, 0.0, pCa);
vec3 objectNormal = pRot * vec3(normal);
vPulse = 0.5 + 0.5 * sin(uTime * 2.1 + aItem.w * 1.7);`,
        )
        .replace(
          '#include <begin_vertex>',
          'vec3 transformed = pRot * (position * aLife) + aItem.xyz + vec3(0.0, sin(uTime * 1.6 + aItem.w * 1.3) * 0.045, 0.0);',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vPulse;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * (0.16 + 0.16 * vPulse);');
    };
    mat.customProgramCacheKey = () => 'at3dPickupProps';
    this.props = new THREE.Mesh(geo, mat);
    this.props.name = 'pickupProps';
    this.props.frustumCulled = false;
    this.scene.add(this.props);

    // ---- glow (instanced quads) ----
    const quad = new THREE.PlaneGeometry(1, 1);
    const gg = new THREE.InstancedBufferGeometry();
    gg.index = quad.index;
    gg.setAttribute('position', quad.attributes.position);
    gg.setAttribute('uv', quad.attributes.uv);
    this._gItem = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ITEMS * 4), 4);
    this._gKind = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ITEMS), 1);
    this._gTaken = new THREE.InstancedBufferAttribute(new Float32Array(MAX_ITEMS).fill(NONE), 1);
    for (const a of [this._gItem, this._gKind, this._gTaken]) a.setUsage(THREE.DynamicDrawUsage);
    gg.setAttribute('aItem', this._gItem);
    gg.setAttribute('aKind', this._gKind);
    gg.setAttribute('aTaken', this._gTaken);
    gg.instanceCount = 0;
    const gm = new THREE.ShaderMaterial({
      vertexShader: GLOW_VERT,
      fragmentShader: GLOW_FRAG,
      uniforms: { uTime: uni.uTime, uFar: uni.uFar },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: true,
      fog: false,
      toneMapped: false,
    });
    gm.name = 'pickupGlow';
    this.glow = new THREE.Mesh(gg, gm);
    this.glow.name = 'pickupGlow';
    this.glow.frustumCulled = false;
    this.glow.renderOrder = 6;
    this.scene.add(this.glow);
  }

  /** Rebuilds the props and the glow from the pickups' current items. */
  sync(pickups) {
    const items = pickups ? pickups.items : [];
    const n = Math.min(MAX_ITEMS, items.length);
    const P = this._aPos.array;
    const N = this._aNor.array;
    const C = this._aCol.array;
    const I = this._aItem.array;
    const L = this._aLife.array;
    const X = this._aIdx.array;
    let vo = 0;
    let io = 0;
    for (let i = 0; i < n; i++) {
      const it = items[i];
      const tpl = this.templates[it.kind];
      if (!tpl) continue;
      const taken = it.taken;
      if (taken && !this._wasTaken[i]) this._takenAt[i] = this.t;
      else if (!taken) this._takenAt[i] = NONE;
      this._wasTaken[i] = taken ? 1 : 0;
      P.set(tpl.pos, vo * 3);
      N.set(tpl.nor, vo * 3);
      C.set(tpl.col, vo * 3);
      for (let k = 0; k < tpl.verts; k++) {
        const o = (vo + k) * 4;
        I[o] = it.x;
        I[o + 1] = it.y;
        I[o + 2] = it.z;
        I[o + 3] = it.phase;
        L[vo + k] = taken ? 0 : 1;
      }
      for (let k = 0; k < tpl.idx.length; k++) X[io + k] = vo + tpl.idx[k];
      this._gItem.array[i * 4] = it.x;
      this._gItem.array[i * 4 + 1] = it.y;
      this._gItem.array[i * 4 + 2] = it.z;
      this._gItem.array[i * 4 + 3] = it.phase;
      this._gKind.array[i] = it.kind;
      this._gTaken.array[i] = taken ? this._takenAt[i] : NONE;
      vo += tpl.verts;
      io += tpl.idx.length;
    }
    this._n = n;
    this._pos = items;
    for (const a of [this._aPos, this._aNor, this._aCol, this._aItem, this._aLife, this._aIdx, this._gItem, this._gKind, this._gTaken]) a.needsUpdate = true;
    this.props.geometry.setDrawRange(0, io);
    this.glow.geometry.instanceCount = n;
  }

  update(dt, game) {
    const g = game || this.game;
    this.t += dt;
    this._uniforms.uTime.value = this.t;
    const pk = g.pickups;
    if (pk && (pk !== this._pk || pk.version !== this._version)) {
      if (pk !== this._pk) this._takenAt.fill(NONE), this._wasTaken.fill(0);
      this._pk = pk;
      this._version = pk.version;
      this.sync(pk);
    }
    const fog = this.scene.fog;
    const far = fog && fog.far ? fog.far : 60;
    this._uniforms.uFar.value = far;
    // Out of sight beyond the fog: nothing to draw.
    let near = false;
    const cam = g.renderer && g.renderer.camera;
    if (cam && this._n > 0) {
      const cp = cam.matrixWorld.elements;
      const lim = (far + 6) * (far + 6);
      const items = this._pos;
      for (let i = 0; i < this._n; i++) {
        const it = items[i];
        const dy = it.y - cp[13];
        if (dy * dy > lim) continue;
        const dx = it.x - cp[12];
        const dz = it.z - cp[14];
        if (dx * dx + dy * dy + dz * dz < lim) {
          near = true;
          break;
        }
      }
    }
    const show = near && !g.hidePlayer;
    this.props.visible = show;
    this.glow.visible = show;
  }

  dispose() {
    for (const m of [this.props, this.glow]) {
      if (m.parent) m.parent.remove(m);
      m.geometry.dispose();
      m.material.dispose();
    }
  }
}
