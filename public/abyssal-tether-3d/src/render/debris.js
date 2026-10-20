/* ABYSSAL TETHER 3D — debris.js
 * Two pooled debris systems used by FX:
 *  - Rubble: stones and pebbles (one InstancedMesh of fractured, mottled
 *    80-triangle stones: smooth weathered faces, sharp fracture edges, a
 *    procedural grain bump; chunky pieces and flat spalls) with simple CPU
 *    physics: gravity, bounces off the level's ACTIVE solids (level.querySolids),
 *    friction, then rest on the floor for a few seconds and crumble away.
 *    Sleeping stones cost nothing but a matrix; a stone never fills the eye
 *    (it shrinks away inside ~0.4 m of the head).
 *  - Trickles: grit trickling from cracks under ledges and down walls, and
 *    water drips in the wet deep sections — one instanced draw of streak quads
 *    whose fall is computed in the vertex shader from a time uniform (zero CPU
 *    per grain). The CPU only picks emitters near the player now and then, and
 *    spawns the small dust puffs / splashes where they land.
 */

import * as THREE from 'three';
import { mergeVertices, toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { FX_LIGHT_GLSL } from './atmosphere.js';

const G = 9.81;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _q0 = new THREE.Quaternion();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _c = new THREE.Color();

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * An irregular stone: a subdivided icosahedron (80 triangles), welded, its
 * vertices pushed in and out (lumps) and cut by three fracture planes, mottled
 * with vertex colour; the instance colour tints it per stone. Creased normals:
 * the weathered faces shade smoothly, the fresh fractures keep sharp edges.
 */
function rockGeometry(seed = 7) {
  let s = seed;
  const rnd = () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
  const geo = mergeVertices(new THREE.IcosahedronGeometry(1, 1).deleteAttribute('normal').deleteAttribute('uv'));
  const pos = geo.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  // a couple of flat "fracture" planes make it read as broken stone, not a pebble
  const cuts = [];
  for (let k = 0; k < 3; k++) {
    const v = new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).normalize();
    cuts.push([v, 0.55 + rnd() * 0.25]);
  }
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    p.multiplyScalar(0.8 + rnd() * 0.32);
    for (const [n, d] of cuts) {
      const h = p.dot(n);
      if (h > d) p.addScaledVector(n, d - h);
    }
    pos.setXYZ(i, p.x, p.y, p.z);
    const m = 0.78 + rnd() * 0.34;
    col[i * 3] = m;
    col[i * 3 + 1] = m * (0.97 + rnd() * 0.04);
    col[i * 3 + 2] = m * (0.93 + rnd() * 0.05);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const out = toCreasedNormals(geo, THREE.MathUtils.degToRad(38));
  geo.dispose();
  return out;
}

// =============================================================================
// Rubble
// =============================================================================

export class Rubble {
  /**
   * @param {THREE.Scene} scene
   * @param {number} max pool size
   * @param {() => number} rand
   * @param {object} [lightUniforms] FxLighting.uniforms (the creature's glow lights the stones near it)
   */
  constructor(scene, max, rand, lightUniforms) {
    this.scene = scene;
    this.max = max;
    this.rand = rand;
    this.level = null;
    this.onImpact = null; // (x, y, z, speed, size) → void
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.93, metalness: 0, vertexColors: true });
    mat.name = 'at3dRubble';
    // Grain: a cheap 3D value noise on the stone's own (object-space) surface — speckle and
    // darker pits in the albedo, and the same field as a bump (screen-space derivatives,
    // height in metres so it reads the same on a pebble at the feet and a chunk 5 m away):
    // a stone near the lantern reads as rough stone, not as a smooth low-poly lump.
    mat.onBeforeCompile = (shader) => {
      if (lightUniforms) {
        shader.uniforms.uGlowPos = lightUniforms.uGlowPos;
        shader.uniforms.uGlowCol = lightUniforms.uGlowCol;
      }
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vRockP;\nvarying float vRockS;\nvarying vec3 vRockW;')
        .replace(
          '#include <begin_vertex>',
          '#include <begin_vertex>\n  vRockP = position;\n#ifdef USE_INSTANCING\n  vRockS = length( instanceMatrix[ 0 ].xyz );\n  vRockW = ( modelMatrix * instanceMatrix * vec4( transformed, 1.0 ) ).xyz;\n#else\n  vRockS = 0.05;\n  vRockW = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;\n#endif',
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying vec3 vRockP;
varying float vRockS;
varying vec3 vRockW;
uniform vec4 uGlowPos;
uniform vec3 uGlowCol;
float atRockHash( vec3 p ) {
  p = fract( p * 0.3183099 + 0.1 );
  p *= 17.0;
  return fract( p.x * p.y * p.z * ( p.x + p.y + p.z ) );
}
float atRockNoise( vec3 x ) {
  vec3 i = floor( x );
  vec3 f = fract( x );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( mix( atRockHash( i ), atRockHash( i + vec3( 1, 0, 0 ) ), f.x ), mix( atRockHash( i + vec3( 0, 1, 0 ) ), atRockHash( i + vec3( 1, 1, 0 ) ), f.x ), f.y ),
              mix( mix( atRockHash( i + vec3( 0, 0, 1 ) ), atRockHash( i + vec3( 1, 0, 1 ) ), f.x ), mix( atRockHash( i + vec3( 0, 1, 1 ) ), atRockHash( i + vec3( 1, 1, 1 ) ), f.x ), f.y ), f.z );
}`,
        )
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\n  float atG = atRockNoise( vRockP * 5.0 ) * 0.6 + atRockNoise( vRockP * 13.0 ) * 0.4;\n  diffuseColor.rgb *= 0.55 + 0.75 * atG;',
        )
        // the creature's sensory glow washes over the stones it sheds (they would be invisible in the dark)
        .replace(
          '#include <emissivemap_fragment>',
          '#include <emissivemap_fragment>\n  {\n    vec3 atD = vRockW - uGlowPos.xyz;\n    float atQ = dot( atD, atD ) / ( uGlowPos.w * uGlowPos.w );\n    totalEmissiveRadiance += diffuseColor.rgb * uGlowCol * ( 1.6 / ( 1.0 + atQ * 3.0 ) );\n  }',
        )
        .replace(
          '#include <normal_fragment_maps>',
          `#include <normal_fragment_maps>
  {
    float atH = ( atG * 0.55 + atRockNoise( vRockP * 29.0 ) * 0.45 ) * vRockS * 0.07;
    vec3 atSx = dFdx( - vViewPosition );
    vec3 atSy = dFdy( - vViewPosition );
    vec3 atR1 = cross( atSy, normal );
    vec3 atR2 = cross( normal, atSx );
    float atDet = dot( atSx, atR1 ) * faceDirection;
    vec3 atGrad = sign( atDet ) * ( dFdx( atH ) * atR1 + dFdy( atH ) * atR2 );
    normal = normalize( abs( atDet ) * normal - atGrad );
  }`,
        );
    };
    mat.customProgramCacheKey = () => 'at3d-rubble-bump2';
    this.mesh = new THREE.InstancedMesh(rockGeometry(), mat, max);
    this.mesh.name = 'fxDebris';
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.setRGB(1, 1, 1)); // creates instanceColor before the first compile
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.visible = false; // shown while any stone is alive
    scene.add(this.mesh);
    const F = (n) => new Float32Array(n);
    this.d = {
      n: 0,
      px: F(max),
      py: F(max),
      pz: F(max),
      vx: F(max),
      vy: F(max),
      vz: F(max),
      ax: F(max * 3),
      ang: F(max),
      spin: F(max),
      size: F(max),
      fy: F(max), // shape: y/z scale (chunks ~0.8, flat spalls ~0.4)
      fz: F(max),
      q0: F(max * 4), // orientation when it came to rest (blends to lying flat)
      blend: F(max), // > 0: still turning onto its flat side
      life: F(max), // flight time left
      rest: F(max), // > 0: resting, seconds left
      hits: new Uint8Array(max),
    };
    this._list = [];
    this.tint = new THREE.Color(1, 1, 1);
  }

  /** Spawns one stone (recycles a random live one when full). */
  spawn(x, y, z, vx, vy, vz, size) {
    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) return;
    const d = this.d;
    const r = this.rand;
    let i = d.n;
    if (i >= this.max) {
      // Full: recycle the stone closest to its end (best of a few random picks), not a random live one.
      let best = Infinity;
      for (let k = 0; k < 6; k++) {
        const j = Math.floor(r() * this.max);
        const left = d.rest[j] > 0 ? d.rest[j] : d.life[j];
        if (left < best) {
          best = left;
          i = j;
        }
      }
    } else d.n++;
    d.px[i] = x;
    d.py[i] = y;
    d.pz[i] = z;
    d.vx[i] = vx;
    d.vy[i] = vy;
    d.vz[i] = vz;
    _axis.set(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    d.ax[i * 3] = _axis.x;
    d.ax[i * 3 + 1] = _axis.y;
    d.ax[i * 3 + 2] = _axis.z;
    d.ang[i] = r() * 6.28;
    d.spin[i] = (r() - 0.5) * 14;
    d.size[i] = size;
    const flake = r() < 0.35;
    d.fy[i] = flake ? 0.36 + r() * 0.16 : 0.68 + r() * 0.24;
    d.fz[i] = 0.78 + r() * 0.3;
    d.life[i] = 6;
    d.rest[i] = 0;
    d.blend[i] = 0;
    d.hits[i] = 0;
    // Weathered ashlar greys and browns, a few darker (soot / wet) stones.
    const v = 0.6 + r() * 0.45;
    const dark = r() < 0.2 ? 0.6 : 1;
    _c.setRGB(0.3 * v * dark, 0.285 * v * dark, 0.26 * v * dark).multiply(this.tint);
    this.mesh.setColorAt(i, _c);
    this.mesh.instanceColor.needsUpdate = true;
  }

  reset() {
    this.d.n = 0;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  _remove(i, n) {
    const d = this.d;
    if (i === n) return;
    d.px[i] = d.px[n];
    d.py[i] = d.py[n];
    d.pz[i] = d.pz[n];
    d.vx[i] = d.vx[n];
    d.vy[i] = d.vy[n];
    d.vz[i] = d.vz[n];
    d.ax[i * 3] = d.ax[n * 3];
    d.ax[i * 3 + 1] = d.ax[n * 3 + 1];
    d.ax[i * 3 + 2] = d.ax[n * 3 + 2];
    d.ang[i] = d.ang[n];
    d.spin[i] = d.spin[n];
    d.size[i] = d.size[n];
    d.fy[i] = d.fy[n];
    d.fz[i] = d.fz[n];
    d.life[i] = d.life[n];
    d.rest[i] = d.rest[n];
    d.blend[i] = d.blend[n];
    for (let k = 0; k < 4; k++) d.q0[i * 4 + k] = d.q0[n * 4 + k];
    d.hits[i] = d.hits[n];
    const ca = this.mesh.instanceColor.array;
    ca[i * 3] = ca[n * 3];
    ca[i * 3 + 1] = ca[n * 3 + 1];
    ca[i * 3 + 2] = ca[n * 3 + 2];
    this.mesh.instanceColor.needsUpdate = true;
  }

  /**
   * @param {number} dt
   * @param {object|null} level (querySolids)
   * @param {THREE.Vector3|null} head  world eye position (stones shrink away right at the eye)
   */
  update(dt, level, head) {
    const hx = head ? head.x : 0;
    const hy = head ? head.y : -1e9;
    const hz = head ? head.z : 0;
    const d = this.d;
    let n = d.n;
    let i = 0;
    const list = this._list;
    while (i < n) {
      if (d.rest[i] > 0) {
        d.rest[i] -= dt;
        if (d.rest[i] <= 0) {
          n--;
          this._remove(i, n);
          continue;
        }
      } else {
        d.life[i] -= dt;
        if (d.life[i] <= 0) {
          n--;
          this._remove(i, n);
          continue;
        }
        d.vy[i] -= G * dt;
        const ox = d.px[i];
        const oy = d.py[i];
        const oz = d.pz[i];
        let x = ox + d.vx[i] * dt;
        let y = oy + d.vy[i] * dt;
        let z = oz + d.vz[i] * dt;
        const r = d.size[i] * 0.8;
        if (level) {
          level.querySolids(Math.min(ox, x) - r, Math.min(oy, y) - r, Math.min(oz, z) - r, Math.max(ox, x) + r, Math.max(oy, y) + r, Math.max(oz, z) + r, list);
          for (let k = 0; k < list.length; k++) {
            const s = list[k];
            if (s.active === false || s.fallen) continue;
            let nx = 0;
            let ny = 0;
            let nz = 0;
            let push = 0;
            if (oy - r >= s.maxY - 1e-3 && y - r < s.maxY && x >= s.minX && x <= s.maxX && z >= s.minZ && z <= s.maxZ) {
              // Swept onto the top face (fast stones never tunnel through thin slabs).
              ny = 1;
              push = s.maxY + r - y;
            } else {
              const cx = clamp(x, s.minX, s.maxX);
              const cy = clamp(y, s.minY, s.maxY);
              const cz = clamp(z, s.minZ, s.maxZ);
              const dx = x - cx;
              const dy = y - cy;
              const dz = z - cz;
              const q = dx * dx + dy * dy + dz * dz;
              if (q >= r * r) continue;
              if (q > 1e-10) {
                const l = Math.sqrt(q);
                nx = dx / l;
                ny = dy / l;
                nz = dz / l;
                push = r - l;
              } else {
                // Centre inside the box: out through the nearest face.
                const fx0 = x - s.minX;
                const fx1 = s.maxX - x;
                const fy0 = y - s.minY;
                const fy1 = s.maxY - y;
                const fz0 = z - s.minZ;
                const fz1 = s.maxZ - z;
                let m = fy1;
                ny = 1;
                if (fx0 < m) ((m = fx0), (nx = -1), (ny = 0), (nz = 0));
                if (fx1 < m) ((m = fx1), (nx = 1), (ny = 0), (nz = 0));
                if (fz0 < m) ((m = fz0), (nx = 0), (ny = 0), (nz = -1));
                if (fz1 < m) ((m = fz1), (nx = 0), (ny = 0), (nz = 1));
                if (fy0 < m) ((m = fy0), (nx = 0), (ny = -1), (nz = 0));
                push = m + r;
              }
            }
            x += nx * push;
            y += ny * push;
            z += nz * push;
            const vn = d.vx[i] * nx + d.vy[i] * ny + d.vz[i] * nz;
            if (vn < 0) {
              const e = 0.28 + this.rand() * 0.14;
              d.vx[i] -= (1 + e) * vn * nx;
              d.vy[i] -= (1 + e) * vn * ny;
              d.vz[i] -= (1 + e) * vn * nz;
              // friction on the tangential part
              const vn2 = d.vx[i] * nx + d.vy[i] * ny + d.vz[i] * nz;
              const f = 0.7;
              d.vx[i] = vn2 * nx + (d.vx[i] - vn2 * nx) * f;
              d.vy[i] = vn2 * ny + (d.vy[i] - vn2 * ny) * f;
              d.vz[i] = vn2 * nz + (d.vz[i] - vn2 * nz) * f;
              d.spin[i] = d.spin[i] * 0.55 + (this.rand() - 0.5) * Math.min(12, -vn * 2);
              if (d.hits[i] < 255) d.hits[i]++;
              if (this.onImpact && -vn > 3.5 && d.hits[i] <= 2) this.onImpact(x, y - r * ny, z, -vn, d.size[i]);
              const sp2 = d.vx[i] * d.vx[i] + d.vy[i] * d.vy[i] + d.vz[i] * d.vz[i];
              if (ny > 0.6 && sp2 < 0.8) {
                // Settle: tip over onto its flat side (a quick turn, not a snap) and sit on the face.
                if (ny > 0.95) {
                  y = s.maxY + d.size[i] * d.fy[i] * 0.85;
                  _axis.set(d.ax[i * 3], d.ax[i * 3 + 1], d.ax[i * 3 + 2]);
                  _q.setFromAxisAngle(_axis, d.ang[i]);
                  d.q0[i * 4] = _q.x;
                  d.q0[i * 4 + 1] = _q.y;
                  d.q0[i * 4 + 2] = _q.z;
                  d.q0[i * 4 + 3] = _q.w;
                  d.ax[i * 3] = 0;
                  d.ax[i * 3 + 1] = 1;
                  d.ax[i * 3 + 2] = 0;
                  d.ang[i] = this.rand() * 6.28;
                  d.blend[i] = 0.16;
                }
                d.vx[i] = 0;
                d.vy[i] = 0;
                d.vz[i] = 0;
                d.spin[i] = 0;
                d.rest[i] = 2.2 + this.rand() * 1.6;
                break;
              }
            }
          }
        }
        d.px[i] = x;
        d.py[i] = y;
        d.pz[i] = z;
        d.ang[i] += d.spin[i] * dt;
      }
      _axis.set(d.ax[i * 3], d.ax[i * 3 + 1], d.ax[i * 3 + 2]);
      _q.setFromAxisAngle(_axis, d.ang[i]);
      if (d.blend[i] > 0) {
        d.blend[i] = Math.max(0, d.blend[i] - dt);
        _q0.set(d.q0[i * 4], d.q0[i * 4 + 1], d.q0[i * 4 + 2], d.q0[i * 4 + 3]);
        const u = 1 - d.blend[i] / 0.16;
        _q.copy(_q0.slerp(_q, u * u * (3 - 2 * u)));
      }
      let k = d.rest[i] > 0 ? Math.min(1, d.rest[i] / 0.6) : Math.min(1, d.life[i] / 0.4);
      // Never a stone filling the eye (a pebble flicked up, rain through the head in VR).
      const ex = d.px[i] - hx;
      const ey = d.py[i] - hy;
      const ez = d.pz[i] - hz;
      const e2 = ex * ex + ey * ey + ez * ez;
      if (e2 < 0.42 * 0.42) k *= Math.max(0, (Math.sqrt(e2) - 0.18) / 0.24);
      const sz = d.size[i] * k;
      _s.set(sz, sz * d.fy[i], sz * d.fz[i]);
      _p.set(d.px[i], d.py[i], d.pz[i]);
      this.mesh.setMatrixAt(i, _m.compose(_p, _q, _s));
      i++;
    }
    d.n = n;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (n) this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

// =============================================================================
// Trickles: grit and drips (one instanced streak draw)
// =============================================================================

const MAX_STREAMS = 8;
const GRAINS = 32;
const RIBBON = 99; // aGrain.w of the veil instance (one per stream)
const STRIDE = GRAINS + 1;
const DRIP_DROPS = 3;
const GRIT = 0;
const DRIP = 1;

/** Streams per tier (0 reduced, 1 XR, 2 desktop high). */
const STREAMS_BY_TIER = [3, 6, 8];

const TRICKLE_VERT = /* glsl */ `
attribute vec4 aGrain; // x stream, y phase 0..1, z seed 0..1, w index in the stream (${RIBBON} = the veil)
uniform vec4 uStreamA[ ${MAX_STREAMS} ]; // xyz source, w fall length
uniform vec4 uStreamB[ ${MAX_STREAMS} ]; // x alpha, y grains shown, z kind (0 grit, 1 drip), w spread
uniform float uTime;
${FX_LIGHT_GLSL}
varying vec2 vQ;
varying float vAlpha;
varying vec3 vCol;
varying float vKind;
varying vec3 vWorld;
varying float vFall; // veil: metres below the source
#include <fog_pars_vertex>
void main() {
  int si = int( aGrain.x + 0.5 );
  vec4 A = uStreamA[ si ];
  vec4 B = uStreamB[ si ];
  float L = max( A.w, 0.05 );
  float kind = B.z;
  vQ = position.xy;
  vFall = 0.0;
  vec3 wp;
  if ( aGrain.w > 50.0 ) {
    // The veil: the fine dust between the grains, a faint column that fans out as it falls.
    // (Drips have none.) It is lit per fragment: the lantern's pool is far too uneven for vertices.
    float Lr = min( L, 12.0 );
    float u = 1.0 - position.y; // 0 at the source, 1 at the bottom
    vec3 c = vec3( A.x, A.y - Lr * u, A.z );
    vec3 toCam = cameraPosition - c;
    vec3 side = vec3( toCam.z, 0.0, -toCam.x );
    float sl = length( side );
    side = sl > 1e-4 ? side / sl : vec3( 1.0, 0.0, 0.0 );
    float hw = 0.05 + B.w * ( 0.6 + 2.2 * pow( u, 0.7 ) ) + 0.08 * u;
    wp = c + side * ( position.x * hw );
    vFall = Lr * u;
    vAlpha = ( 1.0 - kind ) * B.x * 0.7 * smoothstep( 0.0, 0.05, u ) * ( 1.0 - 0.75 * u );
    vCol = vec3( 0.0 );
    vKind = 2.0;
  } else {
    float T = sqrt( 2.0 * L / ${G.toFixed(2)} );
    float show = step( aGrain.w + 0.5, B.y ) * B.x;
    float t;
    float len;
    if ( kind < 0.5 ) {
      float period = T * ( 1.0 + 0.45 * aGrain.z ) + 0.08;
      // grains bunch into clumps: the phase is pulled toward a slowly travelling set of waves
      float ph = aGrain.y + 0.22 * sin( 6.2832 * ( aGrain.y * 3.0 + uTime * 0.07 ) );
      t = fract( uTime / period + ph ) * period;
      float u = t / T;
      show *= step( t, T ) * smoothstep( 0.0, 0.08, u ) * ( 1.0 - smoothstep( 0.82, 1.0, u ) );
      len = clamp( ${G.toFixed(2)} * t * 0.016, 0.015, 0.2 ) * ( 0.55 + 0.9 * fract( aGrain.z * 7.31 ) );
      show *= 0.3 + 0.7 * fract( aGrain.z * 13.7 + 0.3 );
    } else {
      float period = T + 0.9 + 2.2 * aGrain.z;
      float tc = fract( uTime / period + aGrain.y ) * period;
      float hang = period - T;
      t = max( 0.0, tc - hang );
      show *= 1.0 - smoothstep( 0.9, 1.0, t / T );
      // a bead swelling under the lip, then a falling glint
      len = t > 0.0 ? clamp( ${G.toFixed(2)} * t * 0.032, 0.014, 0.5 ) : 0.004 + 0.012 * smoothstep( 0.0, hang, tc );
    }
    float fall = min( 0.5 * ${G.toFixed(2)} * t * t, L );
    vec3 c = A.xyz - vec3( 0.0, fall, 0.0 );
    float ang = aGrain.z * 41.3 + aGrain.w * 2.1;
    float spread = B.w * 2.0 * ( kind < 0.5 ? ( 0.25 + 0.75 * clamp( fall / 4.0, 0.0, 1.0 ) ) * ( 0.3 + aGrain.z ) : 0.0 );
    c.xz += vec2( cos( ang ), sin( ang ) ) * spread;
    if ( kind < 0.5 ) c.xz += vec2( sin( t * 5.0 + aGrain.z * 40.0 ), cos( t * 4.3 + aGrain.z * 23.0 ) ) * 0.012 * min( t, 1.0 );
    vec3 toCam = cameraPosition - c;
    float dist = max( length( toCam ), 1e-3 );
    vec3 side = vec3( toCam.z, 0.0, -toCam.x );
    float sl = length( side );
    side = sl > 1e-4 ? side / sl : vec3( 1.0, 0.0, 0.0 );
    float wid = kind < 0.5 ? 0.006 + 0.008 * aGrain.z : 0.0065;
    // Never thinner than ~1 px: widen and fade instead (no shimmering sub-pixel lines).
    float minW = dist * 0.0014;
    show *= min( 1.0, wid / minW );
    wid = max( wid, minW );
    wp = c + side * ( position.x * wid ) + vec3( 0.0, position.y * len, 0.0 );
    vec3 light = min( uAmbient + atLightAt( c, toCam / -dist, 0.0 ) * 0.9, vec3( 1.5 ) );
    // grit is grey stone dust: the lantern warms it, it does not turn it orange
    light = mix( vec3( dot( light, vec3( 0.2126, 0.7152, 0.0722 ) ) ), light, 0.45 );
    vCol = kind < 0.5 ? vec3( 0.8, 0.76, 0.7 ) * light : vec3( 0.75, 0.85, 0.92 ) * ( light * 4.0 + 0.03 ); // water glints: specular, brighter than stone
    vAlpha = show;
    vKind = kind;
  }
  vWorld = wp;
  vec4 mvPosition = viewMatrix * vec4( wp, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const TRICKLE_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vQ;
varying float vAlpha;
varying vec3 vCol;
varying float vKind;
varying vec3 vWorld;
varying float vFall;
${FX_LIGHT_GLSL}
#include <common>
#include <fog_pars_fragment>
void main() {
  vec3 col = vCol;
  float a;
  if ( vKind > 1.5 ) {
    // the veil: soft across, streaky along, drifting down with the grains
    float across = 1.0 - vQ.x * vQ.x;
    float f = vFall * 5.0 + vQ.x * 3.0;
    float streak = 0.55 + 0.25 * sin( f - uTime * 6.0 ) + 0.2 * sin( f * 2.7 - uTime * 9.3 + vQ.x * 4.0 );
    a = clamp( vAlpha * across * across * streak, 0.0, 1.0 );
    vec3 v = normalize( vWorld - cameraPosition );
    vec3 light = min( uAmbient + atLightAt( vWorld, v, 0.0 ) * 0.9, vec3( 1.5 ) );
    light = mix( vec3( dot( light, vec3( 0.2126, 0.7152, 0.0722 ) ) ), light, 0.45 );
    col = vec3( 0.7, 0.67, 0.62 ) * light;
  } else {
    float across = 1.0 - vQ.x * vQ.x;
    float along = vKind < 0.5 ? 1.0 - vQ.y * 0.85 : 1.0 - vQ.y * 0.6;
    a = clamp( vAlpha * across * along, 0.0, 1.0 );
  }
  #ifdef USE_FOG
    float ff = atFogFactor( vFogDepth );
    if ( vKind < 0.5 || vKind > 1.5 ) col = mix( col, fogColor, ff );
    else col *= 1.0 - ff;
  #endif
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // premultiplied: grit and veil blend over, drips add (alpha 0)
  gl_FragColor = vec4( gl_FragColor.rgb * a, vKind > 0.5 && vKind < 1.5 ? 0.0 : a );
}
`;

export class Trickles {
  /**
   * @param {THREE.Scene} scene
   * @param {object} lightUniforms  FxLighting.uniforms (shared objects)
   * @param {() => number} rand
   */
  constructor(scene, lightUniforms, rand) {
    this.scene = scene;
    this.rand = rand;
    this.time = 0;
    this.agitation = 0;
    this.burst = null; // (kind, x, y, z, opts) → void (FX.burst)
    this._list = [];
    this._hit = { t: 0, solid: null, x: 0, y: 0, z: 0 };
    this._pickT = 0;

    const n = MAX_STREAMS * STRIDE;
    const base = new THREE.PlaneGeometry(2, 1, 1, 1);
    base.translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    const grain = new Float32Array(n * 4);
    this._phase = new Float32Array(n);
    this._seed = new Float32Array(n);
    this._prev = new Float32Array(n); // drips: last cycle time (splash detection)
    for (let s = 0; s < MAX_STREAMS; s++) {
      for (let k = 0; k <= GRAINS; k++) {
        const i = s * STRIDE + k;
        const ph = rand(); // irregular: grains bunch into clumps like a real trickle
        const sd = rand();
        grain[i * 4] = s;
        grain[i * 4 + 1] = ph;
        grain[i * 4 + 2] = sd;
        grain[i * 4 + 3] = k === GRAINS ? RIBBON : k;
        this._phase[i] = ph;
        this._seed[i] = sd;
      }
    }
    g.setAttribute('aGrain', new THREE.InstancedBufferAttribute(grain, 4));
    g.instanceCount = n;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geometry = g;

    this.streams = [];
    const A = [];
    const B = [];
    for (let s = 0; s < MAX_STREAMS; s++) {
      A.push(new THREE.Vector4(0, -1e5, 0, 1));
      B.push(new THREE.Vector4(0, 0, 0, 0.05));
      this.streams.push({ kind: GRIT, alpha: 0, target: 0, life: 0, grains: 0, x: 0, y: -1e5, z: 0, L: 1, floor: false, puffT: 0, active: false });
    }
    this.uniforms = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), lightUniforms, {
      uTime: { value: 0 },
      uStreamA: { value: A },
      uStreamB: { value: B },
    });
    const mat = new THREE.ShaderMaterial({
      name: 'at3dTrickles',
      uniforms: this.uniforms,
      vertexShader: TRICKLE_VERT,
      fragmentShader: TRICKLE_FRAG,
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.name = 'fxTrickles';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 29; // before the dust (30) and bursts (31)
    this.mesh.visible = false; // while any stream shows
    scene.add(this.mesh);
  }

  /** Streams currently showing (stats). */
  activeStreams() {
    let n = 0;
    for (let i = 0; i < MAX_STREAMS; i++) if (this.streams[i].active) n++;
    return n;
  }

  /** A shake (rumble, creature passing, gate slam): every stream runs heavy for a while. */
  agitate(amount) {
    this.agitation = Math.min(1.5, this.agitation + amount);
    this._pickT = Math.min(this._pickT, 0.05);
  }

  reset() {
    for (const s of this.streams) {
      s.alpha = 0;
      s.target = 0;
      s.active = false;
    }
    this.agitation = 0;
  }

  /**
   * @param {number} dt
   * @param {object|null} level
   * @param {THREE.Vector3} head
   * @param {number} tier     0 reduced, 1 XR, 2 desktop
   * @param {number} wet      0..1: share of streams that are drips
   * @param {number} stir     0..1: creature proximity / threat (heavier grit)
   */
  update(dt, level, head, tier, wet, stir) {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    this.agitation = Math.max(0, this.agitation - dt * 0.35);
    const want = STREAMS_BY_TIER[tier] || STREAMS_BY_TIER[1];
    const drips = Math.round(want * clamp(wet, 0, 1) * 0.6);
    const heavy = clamp(stir + this.agitation, 0, 1.5);
    this._pickT -= dt;
    let any = false;
    let nDrip = 0;
    for (let i = 0; i < MAX_STREAMS; i++) if (this.streams[i].active && this.streams[i].kind === DRIP) nDrip++;
    for (let i = 0; i < MAX_STREAMS; i++) {
      const s = this.streams[i];
      const A = this.uniforms.uStreamA.value[i];
      const B = this.uniforms.uStreamB.value[i];
      if (s.active) {
        s.life -= dt;
        const far = (s.x - head.x) * (s.x - head.x) + (s.z - head.z) * (s.z - head.z) > 24 * 24 || s.y - head.y > 22 || head.y - (s.y - s.L) > 30;
        if (s.life <= 0 || far || i >= want || !level) s.target = 0;
        s.alpha += clamp(s.target - s.alpha, -dt * 1.2, dt * 0.8);
        if (s.alpha <= 0 && s.target <= 0) {
          s.active = false;
          if (s.kind === DRIP) nDrip--;
        }
      }
      if (!s.active && level && i < want && this._pickT <= 0) {
        this._pickT = this.agitation > 0.2 ? 0.08 : 0.35;
        // drips where there is an overhang to drip from; grit otherwise
        let kind = nDrip < drips ? DRIP : GRIT;
        let found = this._pick(s, level, head, kind);
        if (!found && kind === DRIP) found = this._pick(s, level, head, (kind = GRIT));
        if (found) {
          s.active = true;
          s.alpha = 0;
          s.target = 1;
          s.life = 7 + this.rand() * 9;
          if (kind === DRIP) nDrip++;
          A.set(s.x, s.y, s.z, s.L);
          for (let k = 0; k < GRAINS; k++) this._prev[i * STRIDE + k] = -1;
        }
      }
      if (!s.active) {
        B.x = 0;
        continue;
      }
      any = true;
      s.grains = s.kind === DRIP ? DRIP_DROPS : clamp(Math.round(16 + heavy * 14), 5, GRAINS);
      B.set(s.alpha * (s.kind === DRIP ? 1 : 0.8 + 0.2 * heavy), s.grains, s.kind, s.kind === DRIP ? 0 : 0.06 + 0.08 * heavy);
      this._landings(dt, i, s, head);
    }
    this.mesh.visible = any;
  }

  /** Dust where grit lands; splashes where drops land (only near the player). */
  _landings(dt, i, s, head) {
    if (!this.burst || !s.floor || s.alpha < 0.3) return;
    const by = s.y - s.L;
    const dx = s.x - head.x;
    const dy = by - head.y;
    const dz = s.z - head.z;
    if (dx * dx + dy * dy + dz * dz > 20 * 20) return;
    if (s.kind === GRIT) {
      s.puffT -= dt * (0.4 + s.grains / GRAINS);
      if (s.puffT <= 0) {
        s.puffT = 0.5 + this.rand() * 0.8;
        this.burst('dust', s.x, by + 0.04, s.z, { count: 1 });
      }
      return;
    }
    const T = Math.sqrt((2 * s.L) / G);
    for (let k = 0; k < DRIP_DROPS; k++) {
      const j = i * STRIDE + k;
      const period = T + 0.9 + 2.2 * this._seed[j];
      let u = this.time / period + this._phase[j];
      u -= Math.floor(u);
      const tc = u * period;
      if (this._prev[j] >= 0 && tc < this._prev[j]) this.burst('splash', s.x, by + 0.02, s.z, { count: 4 });
      this._prev[j] = tc;
    }
  }

  /** A source near the player: under a ledge (crack) or down a wall face; drips only from undersides. */
  _pick(s, level, head, kind) {
    const r = this.rand;
    const list = this._list;
    level.querySolids(head.x - 14, head.y - 3, head.z - 14, head.x + 14, head.y + 16, head.z + 14, list);
    if (!list.length) return false;
    let ok = false;
    for (let attempt = 0; attempt < 8 && !ok; attempt++) {
      const b = list[Math.floor(r() * list.length)];
      if (!b || b.active === false || b.fallen) continue;
      let x;
      let y;
      let z;
      const under = kind === DRIP || r() < 0.55;
      if (under) {
        const sx = b.maxX - b.minX;
        const sz = b.maxZ - b.minZ;
        if (sx < 0.5 || sz < 0.5 || b.minY < head.y - 2.5 || b.minY > head.y + 15) continue;
        // near an edge of the underside (where cracks run), on the head's side
        const ex = r() < 0.5;
        x = ex ? (head.x < (b.minX + b.maxX) / 2 ? b.minX + 0.15 + r() * 0.6 : b.maxX - 0.15 - r() * 0.6) : b.minX + 0.2 + r() * (sx - 0.4);
        z = ex ? b.minZ + 0.2 + r() * (sz - 0.4) : head.z < (b.minZ + b.maxZ) / 2 ? b.minZ + 0.15 + r() * 0.6 : b.maxZ - 0.15 - r() * 0.6;
        y = b.minY - 0.03;
      } else {
        if (b.maxY - b.minY < 2.5) continue;
        // the face looking toward the head
        const cx = (b.minX + b.maxX) / 2;
        const cz = (b.minZ + b.maxZ) / 2;
        const alongX = Math.abs(head.x - cx) / Math.max(0.5, b.maxX - b.minX) > Math.abs(head.z - cz) / Math.max(0.5, b.maxZ - b.minZ);
        y = clamp(head.y + 1 + r() * 11, b.minY + 1, b.maxY - 0.3);
        if (alongX) {
          x = head.x > cx ? b.maxX + 0.04 : b.minX - 0.04;
          z = clamp(head.z + (r() - 0.5) * 16, b.minZ + 0.3, b.maxZ - 0.3);
        } else {
          z = head.z > cz ? b.maxZ + 0.04 : b.minZ - 0.04;
          x = clamp(head.x + (r() - 0.5) * 16, b.minX + 0.3, b.maxX - 0.3);
        }
      }
      const dx = x - head.x;
      const dz = z - head.z;
      const hd2 = dx * dx + dz * dz;
      if (hd2 < 2 * 2 || hd2 > 18 * 18) continue;
      // spread out: not right next to another stream
      let crowded = false;
      for (let k = 0; k < this.streams.length && !crowded; k++) {
        const o = this.streams[k];
        if (o === s || !o.active) continue;
        const ox = o.x - x;
        const oy = o.y - y;
        const oz = o.z - z;
        crowded = ox * ox + oy * oy + oz * oz < 2.5 * 2.5;
      }
      if (crowded) continue;
      const hit = level.raycast(x, y - 0.02, z, 0, -1, 0, 24, this._hit);
      const L = hit ? hit.t : 24;
      if (L < (kind === DRIP ? 1.2 : 1.8)) continue;
      // in sight from the head (middle of the fall)
      if (level.segmentBlocked(head.x, head.y, head.z, x, y - Math.min(L, 6) * 0.5, z, 0.3)) continue;
      s.kind = kind;
      s.x = x;
      s.y = y;
      s.z = z;
      s.L = L;
      s.floor = !!hit;
      s.puffT = r();
      ok = true;
    }
    return ok;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.mesh.material.dispose();
  }
}
