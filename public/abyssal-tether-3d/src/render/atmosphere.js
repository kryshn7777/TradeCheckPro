/* ABYSSAL TETHER 3D — atmosphere.js
 * Volumetric-looking fog without raymarching, in ONE draw call:
 *  - drifting fog CARDS: camera-facing quads (an instanced quad) anchored in
 *    world space around the head and recycled as the player moves: big far cards
 *    (the shaft's layered depth) and, every third card, a small near-field card
 *    that lives within ~7 m of the head with finer noise (the lantern's lit pool). Each card
 *    is a soft slice through one tileable 3D noise field (64³, built once at
 *    load) that is sampled at the fragment's WORLD position and blown by a slow
 *    wind, so billboard rotation never shows and overlapping cards read as one
 *    volume;
 *  - low-lying mist SHEETS: horizontal quads just above nearby ledges/floors
 *    (spilling a little over the edges) and one or two layers across the
 *    shaft below the player (the abyss smokes), sampled from the same field.
 * Everything is shaded in the fragment shader by the player's lantern, the two
 * nearest environment lights, the cold key light falling down the shaft and the
 * creature's sensory glow (FxLighting below,
 * shared with the dust, grit and drips), tinted by the section fog colour and
 * faded near the eye, with distance (scene fog) and at the volume's edge.
 *
 * Quest notes: no depth texture, no extra passes, a fixed instance buffer
 * (inactive instances collapse to zero area), ≤ 4 instance respawns per frame,
 * no per-frame allocation, programs compiled by Renderer3D.precompile().
 */

import * as THREE from 'three';
import { DITHER_GLSL } from './vrShade.js';

// -----------------------------------------------------------------------------
// Shared FX lighting (lantern + 2 env lights + shaft key + creature glow + ambient)
// -----------------------------------------------------------------------------

const LANTERN_REF = 6.5; // Renderer3D's lantern candela at flicker 1
const GLOW_COLOR = new THREE.Color(0xb8f0e0); // the creature's sensory glow (creatureView)
const NO_POS = -1e5;

/** GLSL: the shared lighting uniforms and atLightAt(p, viewDir, g). */
export const FX_LIGHT_GLSL = /* glsl */ `
uniform vec3 uLanternPos;
uniform vec3 uLanternCol;
uniform vec4 uEnvPos[ 2 ];
uniform vec3 uEnvCol[ 2 ];
uniform vec4 uGlowPos;
uniform vec3 uGlowCol;
uniform vec3 uAmbient;
uniform vec3 uKeyDir; // unit, toward the shaft key light (from above)
uniform vec3 uKeyCol;
float atWindow( float d, float range ) {
  float x = clamp( d / range, 0.0, 1.0 );
  x = 1.0 - x * x * x * x;
  return x * x;
}
// Henyey-Greenstein-ish phase: light travelling dl (unit, light→point), seen along -v (v: eye→point).
float atPhase( vec3 dl, vec3 v, float g ) {
  float c = dot( dl, -v );
  float k = 1.0 + g * g - 2.0 * g * c;
  return ( 1.0 - g * g ) / ( k * sqrt( k ) );
}
// The lantern's light reaching p (falloff exponent k: 1.6 like the PointLight; lower = the
// softer, multiply-scattered glow a haze shows), seen along v (unit eye→p).
vec3 atLantern( vec3 p, vec3 v, float g, float k ) {
  vec3 dl = p - uLanternPos;
  float d = length( dl );
  return uLanternCol * ( atWindow( d, 30.0 ) / ( pow( d, k ) + 0.35 ) ) * atPhase( dl / max( d, 1e-3 ), v, g );
}
vec3 atEnvLights( vec3 p, vec3 v, float g ) {
  vec3 L = vec3( 0.0 );
  for ( int i = 0; i < 2; i ++ ) {
    vec3 de = p - uEnvPos[ i ].xyz;
    float e = length( de );
    L += uEnvCol[ i ] * ( atWindow( e, uEnvPos[ i ].w ) / ( e * e + 1.0 ) ) * atPhase( de / max( e, 1e-3 ), v, g );
  }
  return L;
}
vec3 atGlow( vec3 p ) {
  vec3 dg = p - uGlowPos.xyz;
  float gd2 = dot( dg, dg ) / ( uGlowPos.w * uGlowPos.w );
  return uGlowCol / ( 1.0 + gd2 * 3.0 ) * atWindow( sqrt( gd2 ), 2.2 );
}
// The cold key light falling down the shaft, scattered toward the eye: the haze glows looking
// up toward where you came from and darkens looking down into the abyss.
vec3 atKey( vec3 v, float g ) {
  return uKeyCol * atPhase( - uKeyDir, v, g );
}
// In-scattered light at world point p; v = unit eye→p; g = forward scattering (0 = isotropic).
vec3 atLightAt( vec3 p, vec3 v, float g ) {
  return atLantern( p, v, g, 1.6 ) + atEnvLights( p, v, g * 0.6 ) + atGlow( p );
}
`;

function findLanternLight(scene) {
  const g = scene.getObjectByName('Lantern');
  if (!g) return null;
  for (let i = 0; i < g.children.length; i++) if (g.children[i].isPointLight) return g.children[i];
  return null;
}

/**
 * Gathers the lights FX shades with (read-only: the renderer owns them) into
 * uniforms shared by every FX material. Lights are found by name once
 * (Renderer3D: group 'Lantern', 'EnvLight0/1', 'ShaftKey', the HemisphereLight).
 */
export class FxLighting {
  constructor(scene) {
    this.scene = scene;
    this.uniforms = {
      uLanternPos: { value: new THREE.Vector3(0, NO_POS, 0) },
      uLanternCol: { value: new THREE.Color(0, 0, 0) },
      uEnvPos: { value: [new THREE.Vector4(0, NO_POS, 0, 1), new THREE.Vector4(0, NO_POS, 0, 1)] },
      uEnvCol: { value: [new THREE.Color(0, 0, 0), new THREE.Color(0, 0, 0)] },
      uGlowPos: { value: new THREE.Vector4(0, NO_POS, 0, 5) },
      uGlowCol: { value: new THREE.Color(0, 0, 0) },
      uAmbient: { value: new THREE.Color(0, 0, 0) },
      uKeyDir: { value: new THREE.Vector3(0, 1, 0) },
      uKeyCol: { value: new THREE.Color(0, 0, 0) },
    };
    this.lanternLevel = 1;
    this.creatureNear = 0; // 0..1 (distance < 32 m, closer → 1)
    this.creatureSpeed = 0;
    this._lantern = null;
    this._env = [null, null];
    this._hemi = null;
    this._key = null;
    this._findT = 0;
  }

  _find() {
    const s = this.scene;
    this._lantern = findLanternLight(s);
    this._env[0] = s.getObjectByName('EnvLight0') || null;
    this._env[1] = s.getObjectByName('EnvLight1') || null;
    this._hemi = null;
    for (let i = 0; i < s.children.length; i++) if (s.children[i].isHemisphereLight) this._hemi = s.children[i];
    const k = s.getObjectByName('ShaftKey');
    this._key = k && k.isDirectionalLight ? k : null;
  }

  update(dt, game) {
    this._findT -= dt;
    if (this._findT <= 0 && (!this._lantern || !this._lantern.parent || !this._hemi)) {
      this._findT = 1;
      this._find();
    }
    const U = this.uniforms;
    const l = this._lantern;
    if (l && l.visible !== false) {
      const e = l.matrixWorld.elements;
      U.uLanternPos.value.set(e[12], e[13], e[14]);
      U.uLanternCol.value.copy(l.color).multiplyScalar(l.intensity);
      this.lanternLevel = l.intensity / LANTERN_REF;
    } else {
      U.uLanternPos.value.set(0, NO_POS, 0);
      U.uLanternCol.value.setRGB(0, 0, 0);
      this.lanternLevel = 0;
    }
    for (let i = 0; i < 2; i++) {
      const L = this._env[i];
      const P = U.uEnvPos.value[i];
      if (L && L.intensity > 0) {
        P.set(L.position.x, L.position.y, L.position.z, Math.max(2, L.distance || 10));
        U.uEnvCol.value[i].copy(L.color).multiplyScalar(L.intensity);
      } else {
        P.set(0, NO_POS, 0, 1);
        U.uEnvCol.value[i].setRGB(0, 0, 0);
      }
    }
    const h = this._hemi;
    if (h) U.uAmbient.value.copy(h.color).lerp(h.groundColor, 0.5).multiplyScalar(h.intensity * 0.3);
    const key = this._key;
    if (key && key.intensity > 0) {
      // DirectionalLight: lit from position toward target (origin unless retargeted)
      const kd = U.uKeyDir.value.copy(key.position);
      if (key.target) kd.sub(key.target.position);
      if (kd.lengthSq() > 1e-8) kd.normalize();
      else kd.set(0, 1, 0);
      U.uKeyCol.value.copy(key.color).multiplyScalar(key.intensity);
    } else U.uKeyCol.value.setRGB(0, 0, 0);
    // The creature: sensory glow near its crown when it is close.
    const c = game && game.creature;
    let near = 0;
    let speed = 0;
    if (c && c.active && !c.isNull && isFinite(c.distance) && c.distance < 32) {
      near = 1 - c.distance / 32;
      speed = Math.sqrt((c.vx || 0) * (c.vx || 0) + (c.vy || 0) * (c.vy || 0) + (c.vz || 0) * (c.vz || 0));
      const b = c.body;
      const sp = b && b.spine && b.spine.length >= 3 ? b.spine : null;
      const glow = b && isFinite(b.glow) ? b.glow : 0.3;
      U.uGlowPos.value.set(sp ? sp[0] : c.x, sp ? sp[1] : c.y, sp ? sp[2] : c.z, 7);
      U.uGlowCol.value.copy(GLOW_COLOR).multiplyScalar((0.25 + glow * 1.6) * Math.min(1, near * 1.6));
    } else {
      U.uGlowPos.value.set(0, NO_POS, 0, 5);
      U.uGlowCol.value.setRGB(0, 0, 0);
    }
    this.creatureNear = near;
    this.creatureSpeed = speed;
  }
}

// -----------------------------------------------------------------------------
// Tileable 3D noise (built once at load)
// -----------------------------------------------------------------------------

function rng32(seed) {
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
 * Periodic gradient-noise fBm in a size³ R8 texture (wraps on every axis),
 * remapped to a billowy 0..255 range. Each octave is evaluated at 6 samples per
 * lattice cell (≤ size) and trilinearly upsampled: ~40–60 ms for 64³ on a
 * desktop, once, while the game boots.
 */
export function makeNoise3D(size = 64, seed = 0x0a7f0c) {
  const N = size;
  const field = new Float32Array(N * N * N);
  const r = rng32(seed);
  const octaves = [
    [4, 0.6],
    [8, 0.3],
    [16, 0.16],
  ];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  for (const [P, amp] of octaves) {
    const G = new Float32Array(P * P * P * 3);
    for (let i = 0; i < P * P * P; i++) {
      const z = r() * 2 - 1;
      const a = r() * Math.PI * 2;
      const q = Math.sqrt(1 - z * z);
      G[i * 3] = q * Math.cos(a);
      G[i * 3 + 1] = q * Math.sin(a);
      G[i * 3 + 2] = z;
    }
    const M = Math.min(N, P * 6); // samples per axis for this octave
    const i0 = new Int32Array(M);
    const i1 = new Int32Array(M);
    const tt = new Float32Array(M);
    const ff = new Float32Array(M);
    for (let x = 0; x < M; x++) {
      const f = (x * P) / M;
      const b = Math.floor(f);
      i0[x] = b % P;
      i1[x] = (b + 1) % P;
      tt[x] = f - b;
      ff[x] = fade(f - b);
    }
    const oct = M === N ? field : new Float32Array(M * M * M);
    let o = 0;
    for (let z = 0; z < M; z++) {
      const z0 = i0[z] * P * P * 3;
      const z1 = i1[z] * P * P * 3;
      const tz = tt[z];
      const wz = ff[z];
      const uz = tz - 1;
      for (let y = 0; y < M; y++) {
        const y0 = i0[y] * P * 3;
        const y1 = i1[y] * P * 3;
        const ty = tt[y];
        const wy = ff[y];
        const uy = ty - 1;
        for (let x = 0; x < M; x++, o++) {
          const x0 = i0[x] * 3;
          const x1 = i1[x] * 3;
          const tx = tt[x];
          const wx = ff[x];
          const ux = tx - 1;
          let k = z0 + y0 + x0;
          const a0 = G[k] * tx + G[k + 1] * ty + G[k + 2] * tz;
          k = z0 + y0 + x1;
          const a1 = G[k] * ux + G[k + 1] * ty + G[k + 2] * tz;
          k = z0 + y1 + x0;
          const b0 = G[k] * tx + G[k + 1] * uy + G[k + 2] * tz;
          k = z0 + y1 + x1;
          const b1 = G[k] * ux + G[k + 1] * uy + G[k + 2] * tz;
          k = z1 + y0 + x0;
          const c0 = G[k] * tx + G[k + 1] * ty + G[k + 2] * uz;
          k = z1 + y0 + x1;
          const c1 = G[k] * ux + G[k + 1] * ty + G[k + 2] * uz;
          k = z1 + y1 + x0;
          const d0 = G[k] * tx + G[k + 1] * uy + G[k + 2] * uz;
          k = z1 + y1 + x1;
          const d1 = G[k] * ux + G[k + 1] * uy + G[k + 2] * uz;
          const e0 = a0 + (a1 - a0) * wx;
          const e1 = b0 + (b1 - b0) * wx;
          const e2 = c0 + (c1 - c0) * wx;
          const e3 = d0 + (d1 - d0) * wx;
          const f0 = e0 + (e1 - e0) * wy;
          const f1 = e2 + (e3 - e2) * wy;
          oct[o] += (f0 + (f1 - f0) * wz) * amp;
        }
      }
    }
    if (oct !== field) {
      // periodic trilinear upsample M³ → N³
      const sc = M / N;
      let q = 0;
      for (let z = 0; z < N; z++) {
        const fz = z * sc;
        const zz = Math.floor(fz);
        const tz = fz - zz;
        const za = (zz % M) * M * M;
        const zb = ((zz + 1) % M) * M * M;
        for (let y = 0; y < N; y++) {
          const fy = y * sc;
          const yy = Math.floor(fy);
          const ty = fy - yy;
          const ya = (yy % M) * M;
          const yb = ((yy + 1) % M) * M;
          for (let x = 0; x < N; x++, q++) {
            const fx = x * sc;
            const xx = Math.floor(fx);
            const tx = fx - xx;
            const xa = xx % M;
            const xb = (xx + 1) % M;
            const a = oct[za + ya + xa] + (oct[za + ya + xb] - oct[za + ya + xa]) * tx;
            const b = oct[za + yb + xa] + (oct[za + yb + xb] - oct[za + yb + xa]) * tx;
            const c = oct[zb + ya + xa] + (oct[zb + ya + xb] - oct[zb + ya + xa]) * tx;
            const d = oct[zb + yb + xa] + (oct[zb + yb + xb] - oct[zb + yb + xa]) * tx;
            const e = a + (b - a) * ty;
            field[q] += e + (c + (d - c) * ty - e) * tz;
          }
        }
      }
    }
  }
  // Normalise to 0..1 (robust range), soft billows.
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < field.length; i++) {
    const v = field[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const data = new Uint8Array(field.length);
  const span = Math.max(1e-6, hi - lo);
  for (let i = 0; i < field.length; i++) {
    let v = (field[i] - lo) / span;
    v = v * v * (3 - 2 * v); // a little contrast
    data[i] = Math.max(0, Math.min(255, Math.round(v * 255)));
  }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RedFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.wrapR = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  tex.name = 'at3dFogNoise';
  return tex;
}

// -----------------------------------------------------------------------------
// Atmosphere: fog cards + mist sheets (one instanced draw)
// -----------------------------------------------------------------------------

const MAX_CARDS = 36;
const MAX_LEDGE = 8;
const MAX_PIT = 2;
const SHEET0 = 0; // instance layout: [ledge sheets][pit layers][cards]
const PIT0 = MAX_LEDGE;
const CARD0 = MAX_LEDGE + MAX_PIT;
const INSTANCES = CARD0 + MAX_CARDS;

/** Quality tiers: 0 reduced effects, 1 XR (Quest), 2 desktop high. */
const TIERS = [
  { cards: 10, ledges: 0, pits: 1, radius: 1.15, near: [0.35, 0.9] },
  { cards: 18, ledges: 4, pits: 1, radius: 1.0, near: [0.3, 0.8] },
  { cards: 36, ledges: 8, pits: 2, radius: 1.0, near: [0.18, 0.65] },
];

// Section mood (index = section): fog thickness, mist on ledges, abyss smoke.
/** Thickness of the volumetric fog per fx tier (low / quest / desktop). Denser cards shade more pixels (the early-out below skips only the thin ones), so the headset keeps
 *  its original cost (fog cards are the fill-rate heavy part of the frame there) and the cheap distance fog (renderer3d FOG_THICKNESS) carries the 2x. */
const TIER_THICKNESS = [1, 1, 2];
const SECTION_DENSITY = [0.8, 0.85, 1.0, 0.9, 1.15, 1.0, 0.95, 1.1];
// S5 / S8: the brown-amber fog hue sat over every floor as a flat orange wash; their sheets are thinner now
// air hue saturation: the brown-amber S5 / S8 fog read as an orange wash at full saturation
const SECTION_TINT = [1, 1, 1, 1, 0.55, 1, 1, 0.55];
const SECTION_MIST = [0.6, 0.7, 0.9, 0.8, 0.62, 0.95, 0.9, 0.66];

const VOL_R = 16; // horizontal radius of the card volume around the head (m)
const VOL_UP = 9; // above the head
const VOL_DOWN = 20; // below the head (looking down the shaft is the main view)
const RESPAWNS_PER_FRAME = 4;
const NEAR_K = 0.42; // the near-field cards (every third) live in a smaller volume around the head
const isNear = (i) => i % 3 === 2;
const SHEET_HALF = 7; // m: half size cap of a ledge/floor mist sheet
const NOISE_PERIOD = 18; // metres per noise tile (horizontal)

const VERT = /* glsl */ `
attribute vec4 aCard;  // xyz centre at spawn, w radius (card) / half size x (sheet)
attribute vec4 aDrift; // xyz drift velocity (m/s), w spawn time
attribute vec4 aMisc;  // x type (0 card, 1 sheet), y alpha, z half size z (sheet) / volume scale (card), w seed
uniform float uTime;
uniform vec3 uHead;
uniform vec3 uVol; // x horizontal radius, y up, z down
uniform vec2 uNearK; // card fade-out by eye distance / card radius (overdraw control)
varying vec3 vWorld;
varying vec2 vLocal;
varying float vAlpha;
varying float vType;
varying float vNear;
#include <fog_pars_vertex>
void main() {
  float age = uTime - aDrift.w;
  vec3 c = aCard.xyz + aDrift.xyz * age;
  float a = aMisc.y * smoothstep( 0.0, 1.8, age );
  vec3 wp;
  vec2 local = position.xy;
  if ( aMisc.x < 0.5 ) {
    vec3 toCam = cameraPosition - c;
    float dist = max( length( toCam ), 1e-3 );
    vec3 f = toCam / dist;
    vec3 r = cross( vec3( 0.0, 1.0, 0.0 ), f );
    float rl = length( r );
    r = rl > 1e-3 ? r / rl : vec3( 1.0, 0.0, 0.0 );
    vec3 u = cross( f, r );
    float rad = aCard.w;
    // Close to a card its slice fills the view and shows nothing new: fade, then collapse.
    float nearK = smoothstep( uNearK.x, uNearK.y, dist / max( rad, 0.1 ) );
    vec3 q = ( c - uHead ) / ( vec3( uVol.x, c.y > uHead.y ? uVol.y : uVol.z, uVol.x ) * aMisc.z );
    float volK = 1.0 - smoothstep( 0.72, 1.0, length( q ) );
    a *= nearK * volK;
    if ( a <= 0.0 ) rad = 0.0;
    wp = c + ( r * position.x + u * position.y ) * rad;
  } else {
    vec2 sq = position.xy / max( max( abs( position.x ), abs( position.y ) ), 1e-4 ) * step( 1e-4, length( position.xy ) );
    local = sq;
    wp = c + vec3( sq.x * aCard.w, 0.0, sq.y * aMisc.z );
    // Never seen edge-on at eye level (a bright line): fade as the eye nears the layer.
    a *= smoothstep( 0.5, 1.5, abs( cameraPosition.y - c.y ) );
  }
  vWorld = wp;
  vLocal = local;
  vAlpha = a;
  vType = aMisc.x;
  vNear = aMisc.x < 0.5 && aMisc.z < 0.9 ? 1.0 : 0.0;
  vec4 mvPosition = viewMatrix * vec4( wp, 1.0 );
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform sampler3D uNoise;
uniform vec3 uWind;
uniform vec3 uScale;
uniform float uDensity;
uniform float uMist;
uniform float uCover;
uniform float uScatter;
uniform float uBase;
uniform float uAmb;
uniform float uFloor;
uniform float uLanternGain;
uniform float uGlowGain;
uniform float uLanternK;
uniform float uDetail;
uniform float uKeyGain;
uniform float uTintSat;
varying vec3 vWorld;
varying vec2 vLocal;
varying float vAlpha;
varying float vType;
varying float vNear;
${FX_LIGHT_GLSL}
${DITHER_GLSL}
#include <common>
#include <fog_pars_fragment>
void main() {
  vec3 p = vWorld;
  vec3 eye = p - cameraPosition;
  float d = length( eye );
  vec3 v = eye / max( d, 1e-3 );
  float mask;
  float near;
  float a;
  if ( vType < 0.5 ) {
    float r2 = dot( vLocal, vLocal );
    mask = max( 0.0, 1.0 - r2 );
    mask *= mask * ( 1.0 - 0.45 * vNear + 0.45 * vNear * mask );
    near = smoothstep( 0.9, 3.2, d );
    a = uDensity;
  } else {
    vec2 e = abs( vLocal );
    mask = ( 1.0 - smoothstep( 0.55, 1.0, e.x ) ) * ( 1.0 - smoothstep( 0.55, 1.0, e.y ) );
    near = smoothstep( 0.5, 2.4, d );
    // A thin layer: thicker at grazing angles, gone when exactly edge-on.
    float s = abs( v.y );
    a = uMist * smoothstep( 0.015, 0.09, s ) * min( 2.2, 0.45 / max( s, 0.2 ) );
    // Seen from standing height the sheet over the floor in front of you covers the whole floor: thin it
    // out near the eye (the haze belongs to the far ledges and the pit, not to the ground at your feet).
    a *= mix( 0.4, 1.0, smoothstep( 1.2, 9.0, abs( cameraPosition.y - p.y ) ) ) * mix( 0.5, 1.0, smoothstep( 2.0, 14.0, d ) );
  }
  #ifdef USE_FOG
    float ff = atFogFactor( vFogDepth );
  #else
    float ff = 0.0;
  #endif
  a *= vAlpha * mask * near * ( 1.0 - 0.8 * ff );
  // Nothing to add here (disc rim, next to the eye, swallowed by distance): skip the
  // noise fetches and the lighting (blending zero leaves the pixel as it is).
  if ( a < 0.002 ) {
    gl_FragColor = vec4( 0.0 );
    return;
  }
  // the small near-field cards need finer detail or they read as smooth discs
  vec3 sc = uScale * ( 1.0 + 1.7 * vNear );
  vec3 q = p * sc + uWind * uTime;
  float n0 = texture( uNoise, q ).r;
  if ( vType > 0.5 ) {
    // A layer has depth: average the field at the top and bottom of a ~0.6 m slab along the
    // view ray (parallax as you move, never a flat decal).
    vec3 pb = p + v * min( 0.6 / max( abs( v.y ), 0.05 ), 4.0 );
    n0 = 0.5 * ( n0 + texture( uNoise, pb * sc + uWind * uTime ).r );
  }
  float n = n0;
  // the finer octave only on tiers that can afford its second fetch (a uniform branch: coherent)
  if ( uDetail > 0.5 ) n = n0 * 0.62 + texture( uNoise, q * 2.37 + vec3( 0.31, 0.57, 0.13 ) - uWind * ( uTime * 1.7 ) ).r * 0.38;
  // a thin haze everywhere, thicker wisps and banks where the field is dense
  float dens = uFloor + ( 1.0 - uFloor ) * smoothstep( uCover, 0.95, n );
  a *= dens * ( 1.0 - 0.35 * vNear );
  #ifdef USE_FOG
    vec3 base = fogColor;
  #else
    vec3 base = vec3( 0.02 );
  #endif
  // The air's own colour: the section fog hue, a little more saturated (cool stone dust up
  // in the shaft, warm rust and peat-brown in the deep), on the ambient and the shaft light.
  vec3 hue = base / max( dot( base, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 );
  vec3 air = max( mix( vec3( 1.0 ), hue, uTintSat * ( vType > 0.5 ? 0.45 : 1.0 ) ), vec3( 0.0 ) );
  // The lantern lights the haze around the player (soft, multiply-scattered falloff);
  // lamps glow through it; the creature's sensory glow tints it when it is close.
  vec3 lit = atLantern( p, v, 0.15, uLanternK ) * uLanternGain + atEnvLights( p, v, 0.2 ) + atGlow( p ) * uGlowGain;
  vec3 col = base * uBase + ( uAmbient * uAmb + atKey( v, 0.4 ) * ( uKeyGain * uScatter ) ) * air + lit * uScatter;
  #ifdef USE_FOG
    col = mix( col, fogColor, ff );
  #endif
  gl_FragColor = vec4( col, clamp( a, 0.0, 1.0 ) );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb *= gl_FragColor.a;
  // dither: sub-LSB noise on the little this layer adds, so long dark gradients do not band in 8 bit
  // (interleaved gradient noise: stable, per-eye, triangular +-1 LSB; weighted by what this layer adds)
  gl_FragColor.rgb += atDither3( gl_FragCoord.xy ) * ( 1.0 / 255.0 ) * min( 1.0, gl_FragColor.a * 20.0 );
}
`;

function boxDist2(s, x, y, z) {
  const dx = x < s.minX ? s.minX - x : x > s.maxX ? x - s.maxX : 0;
  const dy = y < s.minY ? s.minY - y : y > s.maxY ? y - s.maxY : 0;
  const dz = z < s.minZ ? s.minZ - z : z > s.maxZ ? z - s.maxZ : 0;
  return dx * dx + dy * dy + dz * dz;
}

export class Atmosphere {
  /**
   * @param {THREE.Scene} scene
   * @param {FxLighting} lighting  shared light uniforms
   * @param {THREE.Data3DTexture} noise
   * @param {() => number} rand
   */
  constructor(scene, lighting, noise, rand) {
    this.scene = scene;
    this.lighting = lighting;
    this.rand = rand;
    this.time = 0;
    this.tier = 1;
    this.level = null;
    this._ledges = [];
    this._near = new Array(MAX_LEDGE).fill(null);
    this._nearN = 0;
    this._scratch = [];
    this._sheetT = 0;
    this._lastHead = new THREE.Vector3(0, NO_POS, 0);
    this._headVy = 0;
    this._fillAll = true;
    this.density = 1;
    this.mist = 1;
    this.tintK = 1;
    this._section = -1;

    // An octagon: a card's soft disc wastes ~10 % of its fragments instead of a quad's ~30 %;
    // sheets map the same 9 vertices onto their rectangle (vertex shader).
    const base = new THREE.CircleGeometry(1, 8);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.getAttribute('position'));
    this.aCard = new THREE.InstancedBufferAttribute(new Float32Array(INSTANCES * 4), 4);
    this.aDrift = new THREE.InstancedBufferAttribute(new Float32Array(INSTANCES * 4), 4);
    this.aMisc = new THREE.InstancedBufferAttribute(new Float32Array(INSTANCES * 4), 4);
    for (const a of [this.aCard, this.aDrift, this.aMisc]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('aCard', this.aCard);
    g.setAttribute('aDrift', this.aDrift);
    g.setAttribute('aMisc', this.aMisc);
    g.instanceCount = INSTANCES;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.geometry = g;

    // CPU mirror of the cards (positions at spawn, drift, spawn time, radius).
    this.c = {
      x: new Float32Array(MAX_CARDS),
      y: new Float32Array(MAX_CARDS),
      z: new Float32Array(MAX_CARDS),
      vx: new Float32Array(MAX_CARDS),
      vy: new Float32Array(MAX_CARDS),
      vz: new Float32Array(MAX_CARDS),
      t0: new Float32Array(MAX_CARDS),
      r: new Float32Array(MAX_CARDS), // 0 = inactive
      k: new Float32Array(MAX_CARDS).fill(1), // volume scale: 1 far cards, NEAR_K near (lantern) cards
    };
    // Sheet slots: the ledge (or pit key) they currently show.
    this._sheetKey = new Array(MAX_LEDGE + MAX_PIT).fill(null);

    // The shared light uniforms are the same objects (one update feeds every FX material).
    this.uniforms = Object.assign(THREE.UniformsUtils.clone(THREE.UniformsLib.fog), lighting.uniforms, {
      uTime: { value: 0 },
      uHead: { value: new THREE.Vector3() },
      uVol: { value: new THREE.Vector3(VOL_R, VOL_UP, VOL_DOWN) },
      uNearK: { value: new THREE.Vector2(0.3, 0.8) },
      uNoise: { value: noise },
      uWind: { value: new THREE.Vector3(0.006, -0.004, 0.004) },
      // stretched horizontally: the shaft's air lies in strata more than in clouds
      uScale: { value: new THREE.Vector3(1 / NOISE_PERIOD, 2.2 / NOISE_PERIOD, 1 / NOISE_PERIOD) },
      uDensity: { value: 0.16 },
      uMist: { value: 0.22 },
      uCover: { value: 0.32 },
      uScatter: { value: 0.16 },
      uBase: { value: 1.15 },
      uAmb: { value: 0.35 },
      uFloor: { value: 0.2 },
      uLanternGain: { value: 1 },
      uLanternK: { value: 1.9 },
      uGlowGain: { value: 2 },
      uDetail: { value: 1 },
      uKeyGain: { value: 0.06 },
      uTintSat: { value: 1.3 },
    });
    /** Look parameters (tuned on screenshots; per-section mood multiplies density/mist). */
    this.params = { density: 0.17, mist: 0.22, scatter: 0.8, base: 1.1, ambient: 0.3, cover: 0.25, floor: 0.28, lantern: 2.0, lanternK: 1.9, glow: 2, key: 0.06, tint: 1.3 };
    const mat = new THREE.ShaderMaterial({
      name: 'at3dFog',
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
      side: THREE.DoubleSide,
      forceSinglePass: true, // a transparent double-sided material would otherwise draw twice (back, then front)
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.name = 'fxFog';
    this.mesh.frustumCulled = false;
    // After the opaque world and the shaft light beams (10), before glows (15) and dust (30).
    this.mesh.renderOrder = 12;
    this.scene.add(this.mesh);
  }

  // ---------------------------------------------------------------------------
  /** Flat tops worth a mist sheet (ledges, landings, floors), built once per level. */
  _buildLedges(level) {
    this._ledges.length = 0;
    const solids = level && Array.isArray(level.solids) ? level.solids : [];
    const above = this._scratch;
    for (let i = 0; i < solids.length; i++) {
      const s = solids[i];
      if (!s || s.kind === 'pillar' || s.kind === 'grate') continue;
      const sx = s.maxX - s.minX;
      const sz = s.maxZ - s.minZ;
      if (sx < 1.6 || sz < 1.6 || sx * sz < 5 || s.maxY - s.minY > 9) continue;
      // Something lying right on top (a wall or another slab)? Skip mostly-covered tops.
      level.querySolids(s.minX, s.maxY + 0.05, s.minZ, s.maxX, s.maxY + 2.2, s.maxZ, above);
      let covered = 0;
      for (let k = 0; k < above.length; k++) {
        const o = above[k];
        if (o === s) continue;
        const ox = Math.max(0, Math.min(s.maxX, o.maxX) - Math.max(s.minX, o.minX));
        const oz = Math.max(0, Math.min(s.maxZ, o.maxZ) - Math.max(s.minZ, o.minZ));
        covered += ox * oz;
      }
      if (covered > sx * sz * 0.5) continue;
      this._ledges.push({ s, y: s.maxY + 0.22, d: 0, cx: NaN, cz: NaN });
    }
  }

  _setLevel(level) {
    this.level = level || null;
    this._buildLedges(level);
    this._fillAll = true;
    for (let i = 0; i < this._sheetKey.length; i++) this._sheetKey[i] = null;
  }

  /** Clears all fog (restart/respawn: refilled around the new head position next frame). */
  reset() {
    this._fillAll = true;
  }

  // ---------------------------------------------------------------------------
  /**
   * @param {number} dt
   * @param {object} game
   * @param {THREE.Vector3} head
   * @param {number} tier  0 reduced, 1 XR, 2 desktop high
   * @param {number} threat 0..1 (eased)
   */
  update(dt, game, head, tier, threat) {
    this.time += dt;
    const level = game && game.level;
    if (level !== this.level) this._setLevel(level);
    const T = TIERS[tier] || TIERS[1];
    this.tier = tier;
    const U = this.uniforms;
    U.uTime.value = this.time;
    U.uHead.value.copy(head);
    U.uNearK.value.set(T.near[0], T.near[1]);

    // Head motion: teleports refill everything; a fast descent spawns ahead (below).
    const jumped = this._lastHead.y === NO_POS || this._lastHead.distanceToSquared(head) > 18 * 18;
    if (jumped) this._fillAll = true;
    else if (dt > 0) this._headVy += ((head.y - this._lastHead.y) / dt - this._headVy) * (1 - Math.exp(-4 * dt));
    this._lastHead.copy(head);

    // Section mood, eased.
    let si = 0;
    if (level && typeof level.sectionIndexAt === 'function') si = level.sectionIndexAt(head.y);
    const k = jumped ? 1 : 1 - Math.exp(-1.2 * dt);
    this.density += ((SECTION_DENSITY[si] || 1) - this.density) * k;
    this.mist += ((SECTION_MIST[si] || 1) - this.mist) * k;
    this.tintK += ((SECTION_TINT[si] || 1) - this.tintK) * k;
    // Threat thickens the air a little and stirs it upward (the shaft breathes in).
    const P = this.params;
    const thick = TIER_THICKNESS[Math.max(0, Math.min(2, tier | 0))];
    U.uDensity.value = P.density * this.density * (1 + threat * 0.25) * thick;
    U.uMist.value = P.mist * this.mist * thick;
    U.uWind.value.y = (-0.004 + threat * 0.012) * (1 + this.lighting.creatureNear);
    U.uScatter.value = P.scatter;
    U.uBase.value = P.base;
    U.uAmb.value = P.ambient;
    U.uCover.value = P.cover;
    U.uFloor.value = P.floor;
    U.uLanternGain.value = P.lantern;
    U.uLanternK.value = P.lanternK;
    U.uGlowGain.value = P.glow;
    U.uDetail.value = tier >= 1 ? 1 : 0;
    U.uKeyGain.value = P.key;
    U.uTintSat.value = P.tint * this.tintK;

    if (!level) {
      for (let i = 0; i < MAX_CARDS; i++) this._setCard(i, 0);
      return;
    }
    this._updateCards(T, head);
    this._sheetT -= dt;
    if (this._sheetT <= 0 || jumped) {
      this._sheetT = 0.3;
      this._updateSheets(T, head, level, si);
    }
    this._fillAll = false;
  }

  // ---------------------------------------------------------------------------
  // Cards
  // ---------------------------------------------------------------------------
  _updateCards(T, head) {
    const c = this.c;
    const t = this.time;
    let budget = this._fillAll ? MAX_CARDS : RESPAWNS_PER_FRAME;
    let dirty = false;
    for (let i = 0; i < MAX_CARDS; i++) {
      if (i >= T.cards) {
        if (c.r[i] > 0) {
          c.r[i] = 0;
          this._setCard(i, 0);
          dirty = true;
        }
        continue;
      }
      let out = this._fillAll || c.r[i] <= 0;
      if (!out) {
        const age = t - c.t0[i];
        const kv = c.k[i];
        const dx = (c.x[i] + c.vx[i] * age - head.x) / (VOL_R * kv);
        const dyRaw = c.y[i] + c.vy[i] * age - head.y;
        const dy = dyRaw / ((dyRaw > 0 ? VOL_UP : VOL_DOWN) * kv);
        const dz = (c.z[i] + c.vz[i] * age - head.z) / (VOL_R * kv);
        out = dx * dx + dy * dy + dz * dz > 1.03;
      }
      if (!out || budget <= 0) continue;
      budget--;
      if (this._spawnCard(i, head, T, this._fillAll)) dirty = true;
      else if (c.r[i] > 0) {
        c.r[i] = 0;
        this._setCard(i, 0);
        dirty = true;
      }
    }
    if (dirty) {
      this.aCard.needsUpdate = true;
      this.aDrift.needsUpdate = true;
      this.aMisc.needsUpdate = true;
    }
  }

  /** Finds open air for card i (clear of solids, in sight of the head). */
  _spawnCard(i, head, T, initial) {
    const level = this.level;
    const r = this.rand;
    const c = this.c;
    const b = level.bounds;
    const list = this._scratch;
    const near = isNear(i);
    const kv = near ? NEAR_K : 1;
    c.k[i] = kv;
    for (let attempt = 0; attempt < 6; attempt++) {
      const rad = (near ? 2.6 - attempt * 0.3 : 5.5 - attempt * 0.6) * (0.75 + r() * 0.45) * T.radius;
      const ang = r() * Math.PI * 2;
      const rr = VOL_R * kv * Math.sqrt(r()) * 0.92;
      const x = head.x + Math.cos(ang) * rr;
      const z = head.z + Math.sin(ang) * rr;
      // Mostly below the head (the view down the shaft); falling fast → well below.
      let y;
      if (!initial && this._headVy < -2.5) y = head.y - VOL_DOWN * kv * (0.45 + r() * 0.5);
      else if (!initial && this._headVy > 2.5) y = head.y + VOL_UP * kv * (0.3 + r() * 0.6);
      else y = head.y + (r() < (near ? 0.4 : 0.3) ? r() * VOL_UP * kv * 0.9 : -r() * VOL_DOWN * kv * 0.92);
      if (b && (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ || y < b.minY || y > b.maxY)) continue;
      const clear = rad * 0.72;
      level.querySolids(x - clear, y - clear, z - clear, x + clear, y + clear, z + clear, list);
      let ok = true;
      const c2 = clear * clear;
      for (let k = 0; k < list.length; k++) {
        const s = list[k];
        if (s.active === false) continue;
        if (boxDist2(s, x, y, z) < c2) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      if (level.segmentBlocked(head.x, head.y, head.z, x, y, z, 0)) continue;
      const sp = 0.04 + r() * 0.14;
      const da = r() * Math.PI * 2;
      c.x[i] = x;
      c.y[i] = y;
      c.z[i] = z;
      c.vx[i] = Math.cos(da) * sp;
      c.vy[i] = (r() - 0.55) * 0.06;
      c.vz[i] = Math.sin(da) * sp;
      c.t0[i] = initial ? this.time - 2 - r() : this.time;
      c.r[i] = rad;
      this._setCard(i, 0.75 + r() * 0.5);
      return true;
    }
    return false;
  }

  _setCard(i, alpha) {
    const c = this.c;
    const o = (CARD0 + i) * 4;
    const A = this.aCard.array;
    const D = this.aDrift.array;
    const M = this.aMisc.array;
    A[o] = c.x[i];
    A[o + 1] = c.y[i];
    A[o + 2] = c.z[i];
    A[o + 3] = alpha > 0 ? c.r[i] : 0;
    D[o] = c.vx[i];
    D[o + 1] = c.vy[i];
    D[o + 2] = c.vz[i];
    D[o + 3] = c.t0[i];
    M[o] = 0;
    M[o + 1] = alpha;
    M[o + 2] = c.k[i];
    M[o + 3] = i * 0.137;
  }

  // ---------------------------------------------------------------------------
  // Sheets: mist on the nearest ledges + abyss layers below
  // ---------------------------------------------------------------------------
  _updateSheets(T, head, level, si) {
    let dirty = false;
    // Ledges: nearest few tops within reach (by distance from the head to the top rectangle).
    const near = this._near;
    let nn = 0;
    if (T.ledges > 0) {
      for (let i = 0; i < this._ledges.length; i++) {
        const L = this._ledges[i];
        const s = L.s;
        if (s.active === false || s.fallen) continue;
        const dy = head.y - L.y;
        if (dy < 0.6 || dy > 26) continue; // tops below eye level (mist lies ON the stone; no fixed eye height assumed)
        const dx = head.x < s.minX ? s.minX - head.x : head.x > s.maxX ? head.x - s.maxX : 0;
        const dz = head.z < s.minZ ? s.minZ - head.z : head.z > s.maxZ ? head.z - s.maxZ : 0;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 30 * 30) continue;
        L.d = d2;
        // insertion into the K nearest (fixed array, no allocation)
        let k;
        if (nn < T.ledges) k = nn++;
        else if (d2 >= near[nn - 1].d) continue;
        else k = nn - 1;
        near[k] = L;
        while (k > 0 && near[k - 1].d > near[k].d) {
          const tmp = near[k - 1];
          near[k - 1] = near[k];
          near[k] = tmp;
          k--;
        }
      }
    }
    this._nearN = nn;
    for (let j = 0; j < MAX_LEDGE; j++) {
      const L = j < nn ? near[j] : null;
      // keep a slot's ledge if it is still wanted (no pop), else take a free wanted one
      if (this._sheetKey[j] !== L) dirty = this._assignLedge(j, L) || dirty;
      dirty = this._recentre(j, head) || dirty;
    }
    // Abyss layers: world-anchored heights below the head, across the section's shaft.
    const sec = level.sections && level.sections[si];
    const sh = sec && sec.shaft;
    for (let j = 0; j < MAX_PIT; j++) {
      let key = null;
      let y = 0;
      if (sh && j < T.pits) {
        y = Math.floor((head.y - 9) / 11) * 11 - j * 11;
        key = si * 100000 + y;
        if (y < level.bounds.minY + 2) key = null;
      }
      if (this._sheetKey[PIT0 + j] === key) continue;
      this._sheetKey[PIT0 + j] = key;
      dirty = true;
      const o = (PIT0 + j) * 4;
      if (key === null || !this._pitClear(level, sh, y)) {
        this.aCard.array[o + 3] = 0;
        this.aMisc.array[o + 1] = 0;
        continue;
      }
      const cx = (sh.minX + sh.maxX) / 2;
      const cz = (sh.minZ + sh.maxZ) / 2;
      this._writeSheet(PIT0 + j, cx, y, cz, (sh.maxX - sh.minX) / 2 - 0.6, (sh.maxZ - sh.minZ) / 2 - 0.6, 1.25);
    }
    if (dirty) {
      this.aCard.needsUpdate = true;
      this.aDrift.needsUpdate = true;
      this.aMisc.needsUpdate = true;
    }
  }

  _wanted(L) {
    for (let k = 0; k < this._nearN; k++) if (this._near[k] === L) return true;
    return false;
  }

  _shown(L) {
    for (let k = 0; k < MAX_LEDGE; k++) if (this._sheetKey[k] === L) return true;
    return false;
  }

  _assignLedge(j, L) {
    // Is L already shown in another slot? Then this slot frees up.
    if (L) for (let k = 0; k < MAX_LEDGE; k++) if (k !== j && this._sheetKey[k] === L) L = null;
    // Keep the current one if it is still among the wanted.
    const cur = this._sheetKey[j];
    if (cur && this._wanted(cur)) return false;
    if (!L) {
      for (let k = 0; k < this._nearN && !L; k++) if (!this._shown(this._near[k])) L = this._near[k];
    }
    if (cur === L) return false;
    this._sheetKey[j] = L;
    const o = (SHEET0 + j) * 4;
    if (!L) {
      this.aCard.array[o + 3] = 0;
      this.aMisc.array[o + 1] = 0;
      return true;
    }
    L.cx = NaN; // placed by _recentre
    this._recentre(j, this._lastHead, true);
    return true;
  }

  /**
   * A big floor gets a sheet of at most 2×SHEET_HALF around the player's side of it,
   * moved along (edges only: the mist itself is world-anchored) when the player
   * wanders off; a ledge gets one sheet spilling a little over its edges.
   */
  _recentre(j, head, force) {
    const L = this._sheetKey[j];
    if (!L) return false;
    const s = L.s;
    const hx = Math.min(SHEET_HALF, (s.maxX - s.minX) / 2 + 0.5);
    const hz = Math.min(SHEET_HALF, (s.maxZ - s.minZ) / 2 + 0.5);
    const cx = Math.min(Math.max(head.x, s.minX - 0.5 + hx), s.maxX + 0.5 - hx);
    const cz = Math.min(Math.max(head.z, s.minZ - 0.5 + hz), s.maxZ + 0.5 - hz);
    if (!force && isFinite(L.cx) && Math.abs(cx - L.cx) < 4 && Math.abs(cz - L.cz) < 4) return false;
    const fresh = !isFinite(L.cx);
    L.cx = cx;
    L.cz = cz;
    this._writeSheet(SHEET0 + j, cx, L.y, cz, hx, hz, 1, !fresh);
    return true;
  }

  _writeSheet(idx, x, y, z, hx, hz, alpha, keepTime) {
    const o = idx * 4;
    const A = this.aCard.array;
    const D = this.aDrift.array;
    const M = this.aMisc.array;
    A[o] = x;
    A[o + 1] = y;
    A[o + 2] = z;
    A[o + 3] = Math.max(0.5, hx);
    D[o] = 0;
    D[o + 1] = 0;
    D[o + 2] = 0;
    // after a warp/respawn: present at once; moved along: no new fade-in
    if (!keepTime) D[o + 3] = this._fillAll ? this.time - 2 : this.time;
    M[o] = 1;
    M[o + 1] = alpha;
    M[o + 2] = Math.max(0.5, hz);
    M[o + 3] = idx * 0.71;
  }

  /** An abyss layer only where it does not slice through a floor/platform. */
  _pitClear(level, sh, y) {
    const list = this._scratch;
    level.querySolids(sh.minX + 0.6, y - 0.4, sh.minZ + 0.6, sh.maxX - 0.6, y + 0.4, sh.maxZ - 0.6, list);
    const area = (sh.maxX - sh.minX) * (sh.maxZ - sh.minZ);
    let cut = 0;
    for (let k = 0; k < list.length; k++) {
      const s = list[k];
      if (s.active === false) continue;
      const ox = Math.max(0, Math.min(sh.maxX, s.maxX) - Math.max(sh.minX, s.minX));
      const oz = Math.max(0, Math.min(sh.maxZ, s.maxZ) - Math.max(sh.minZ, s.minZ));
      cut += ox * oz;
    }
    return cut < area * 0.06;
  }

  /** Fog cards currently placed (stats). */
  activeCards() {
    let n = 0;
    for (let i = 0; i < MAX_CARDS; i++) if (this.c.r[i] > 0) n++;
    return n;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.mesh.material.dispose();
  }
}
