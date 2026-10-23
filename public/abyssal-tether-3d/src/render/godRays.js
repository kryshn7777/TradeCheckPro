/* ABYSSAL TETHER 3D — godRays.js
 * Volumetric light shafts without a pass, a depth texture or raymarching through the level: ONE draw call (instanced) for
 *  - the authored 'shaft-light' beams of the level (cold light falling down the shafts),
 *  - window beams: the cold baked lights that pour through the S1 / S2 windows (level.lights: cool, steady, strong),
 *  - the carried lantern's cone in the haze (a wide soft cone along the look direction, angular streaks like light through the cage),
 *  - the lantern's omnidirectional glow (lanternHalo.js' closed-form atan integral): folded into this draw as a camera-facing square
 *    (instance kind 3: the hull's vertices are mapped onto a square) so the whole volumetric layer costs ONE call; the halo's own mesh
 *    only draws when the rays are off (low tier / reduced effects).
 * Each instance is a cheap low-poly hull (10-gon frustum, 40 tris) around a light volume. The fragment shader intersects the
 * view ray with the volume ANALYTICALLY: the volume is a cylinder of radius R(s) with the compact density (1 - d²/R²)², whose
 * line integral is a closed-form polynomial (a·t² + 2b·t + c is the squared distance of the ray to the axis), evaluated for
 * 2-5 consecutive chord segments so the taper, the axial fade and a 3D-noise streak (dust motes, drifting fog) vary along it.
 * In-scatter = colour × density × Henyey-Greenstein phase (strongest looking up the beam into the light) × fog transmittance.
 *
 * Stereo-correct (everything is derived from cameraPosition per eye), depth-tested against the opaque world (hands, ledges and
 * walls in front hide it), additive, dithered with the vrShade noise. Seen from outside the hull the front faces draw, from inside
 * (the camera in the beam) the back faces. Tiers: low / reducedEffects = off (the old cheap shaft shells draw again), quest = 3
 * segments, high = 5 segments + a second noise octave; the governor drops to 2 segments (level 2) and off (level 3).
 * No per-frame allocation: a fixed instance buffer of MAX instances, selection by insertion into preallocated arrays.
 */

import * as THREE from 'three';
import { DITHER_GLSL } from './vrShade.js';
import { LOOK } from './materials.js';

const MAX = 9; // instances: lantern cone + lantern glow + window beams + nearest shafts
const MAX_SHAFTS = 5;
const SIDES = 10;
const HULL = 1.07; // circumradius of the 10-gon over the density radius (cos 18° = 0.951)

const TIERS = {
  // segs along the chord, noise octaves
  off: { segs: 0, oct: 0 },
  quest: { segs: 3, oct: 1 },
  high: { segs: 5, oct: 2 },
};

const VERT = /* glsl */ `
attribute vec4 iA;
attribute vec4 iB;
attribute vec4 iC;
attribute vec4 iK;
uniform float uHull;
uniform float uHHalf;
flat varying vec4 fA;
flat varying vec4 fB;
flat varying vec4 fC;
flat varying vec4 fK;
flat varying float fIn;
varying vec3 vWorld;
void main() {
  if ( iK.z > 2.5 ) {
    // lantern glow: a camera-facing square at the lantern (the hull's ring vertices are projected onto the square's border)
    vec2 pq = position.xy / max( max( abs( position.x ), abs( position.y ) ), 1e-3 );
    vec3 right = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );
    vec3 up = vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] );
    vec3 hp = iA.xyz + ( right * pq.x + up * pq.y ) * uHHalf;
    fA = iA;
    fB = iB;
    fC = iC;
    fK = iK;
    fIn = 0.0;
    vWorld = hp;
    gl_Position = projectionMatrix * viewMatrix * vec4( hp, 1.0 );
    return;
  }
  vec3 A = iA.xyz;
  vec3 ax = iB.xyz - A;
  float L = max( length( ax ), 1e-3 );
  vec3 D = ax / L;
  vec3 h = abs( D.y ) < 0.95 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
  vec3 U = normalize( cross( D, h ) );
  vec3 W = cross( D, U );
  float t = position.z;
  float R = mix( iA.w, iB.w, t ) * uHull;
  vec3 wp = A + ax * t + ( U * position.x + W * position.y ) * R;
  // is the camera inside the volume? (then the back faces draw, else the front faces)
  vec3 mc = cameraPosition - A;
  float ms = dot( mc, D );
  float perp = length( mc - D * ms );
  float s = ms / L;
  fIn = ( s > 0.0 && s < 1.0 && perp < mix( iA.w, iB.w, s ) ) ? 1.0 : 0.0;
  fA = iA;
  fB = iB;
  fC = iC;
  fK = iK;
  vWorld = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );
}
`;

const FRAG = /* glsl */ `
${DITHER_GLSL}
uniform sampler3D uNoise;
uniform vec3 uWind;
uniform float uTime;
uniform float uSegs;
uniform float uOct;
uniform float uGain;
uniform float uG;
uniform float uHaze;
uniform vec2 uFogNF;
uniform vec3 uFog;
uniform vec4 uProbeC;
uniform vec3 uProbeH;
uniform float uHHalf;
uniform float uHGain;
uniform float uHCore;
uniform float uHReach;
uniform float uHTint;
uniform float uHSharp;
uniform vec3 uHCol;
flat varying vec4 fA;
flat varying vec4 fB;
flat varying vec4 fC;
flat varying vec4 fK;
flat varying float fIn;
varying vec3 vWorld;

// same curve as the scene fog (materials.js installRadialFog)
float rayFog( float d ) {
  float t = clamp( ( d - uFogNF.x ) / max( uFogNF.y - uFogNF.x, 1e-3 ), 0.0, 1.0 );
  float u = 1.0 - t;
  return 1.0 - u * u * sqrt( u );
}
float hg( float c, float g ) {
  float k = 1.0 + g * g - 2.0 * g * c;
  return ( 1.0 - g * g ) / ( k * sqrt( k ) );
}
// the lantern's glow in the haze (lanternHalo.js, unchanged maths): the 1/(r²+a²) integral along the view ray is an atan
void haloMain() {
  vec3 C = cameraPosition;
  vec3 v = normalize( vWorld - C );
  vec3 w = fA.xyz - C;
  float ang = pow( max( 0.5 + 0.5 * dot( v, w / max( length( w ), 1e-3 ) ), 0.0 ), uHSharp );
  if ( ang < 0.004 ) discard;
  float t0 = dot( w, v );
  float b2 = max( dot( w, w ) - t0 * t0, 0.0 );
  float b = sqrt( b2 + uHCore * uHCore );
  float I = ( atan( uHReach / b ) + atan( t0 / b ) ) / b;
  vec3 q = ( C + v * max( t0, 0.0 ) ) * ( 1.0 / 7.0 ) + vec3( 0.006, - 0.004, 0.004 ) * uTime;
  float n = texture( uNoise, q ).r;
  I *= ( 0.55 + 0.9 * n ) * ang;
  float h = 1.0 - exp( - I * uHGain );
  vec3 hue = uFog / max( dot( uFog, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-4 );
  vec3 tint = mix( vec3( 1.0 ), hue, uHTint );
  vec3 col = uHCol * ( h * 0.9 ) * mix( vec3( 1.0 ), tint, 0.35 );
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  gl_FragColor.rgb += atDither3( gl_FragCoord.xy ) * ( 1.0 / 255.0 ) * min( 1.0, h * 12.0 );
  gl_FragColor.a = h * 0.18; // premultiplied: the colour is the light the haze adds, the alpha the little it veils
}

void main() {
  // inside the volume only the back faces draw, outside only the front faces
  if ( gl_FrontFacing == ( fIn > 0.5 ) ) discard;
  if ( fK.z > 2.5 ) {
    haloMain();
    return;
  }
  vec3 C = cameraPosition;
  vec3 v = normalize( vWorld - C );
  vec3 A = fA.xyz;
  vec3 ax = fB.xyz - A;
  float L = max( length( ax ), 1e-3 );
  vec3 D = ax / L;
  vec3 m = C - A;
  float vd = dot( v, D );
  float md = dot( m, D );
  vec3 vp = v - D * vd;
  vec3 mp = m - D * md;
  float a = max( dot( vp, vp ), 1e-5 );
  float b = dot( mp, vp );
  float cc = dot( mp, mp );
  // axial slab 0..L
  float ta = 0.0;
  float tb = 1e4;
  if ( abs( vd ) > 1e-4 ) {
    float t0 = - md / vd;
    float t1 = ( L - md ) / vd;
    ta = max( ta, min( t0, t1 ) );
    tb = min( tb, max( t0, t1 ) );
  } else if ( md < 0.0 || md > L ) {
    discard;
  }
  // outer cylinder
  float Rm = max( fA.w, fB.w );
  float disc = b * b - a * ( cc - Rm * Rm );
  if ( disc <= 0.0 ) discard;
  float sq = sqrt( disc );
  ta = max( ta, ( - b - sq ) / a );
  tb = min( tb, ( - b + sq ) / a );
  tb = min( tb, uFogNF.y );
  // the chamber the eye is in: walls and floor end the light (the shaft box of the reflection probe; no scene depth is available)
  if ( uProbeC.w > 0.5 ) {
    vec3 iv = 1.0 / ( v + vec3( 1e-5 ) * sign( v + vec3( 1e-9 ) ) );
    vec3 bl = ( uProbeC.xyz - uProbeH - C ) * iv;
    vec3 bh = ( uProbeC.xyz + uProbeH - C ) * iv;
    vec3 bf = max( bl, bh );
    vec3 bn = min( bl, bh );
    float te = min( bf.x, min( bf.y, bf.z ) );
    float tn = max( bn.x, max( bn.y, bn.z ) );
    if ( tn < 0.0 && te > 0.0 ) tb = min( tb, te );
  }
  if ( tb <= ta ) discard;

  float N = uSegs;
  float dt = ( tb - ta ) / N;
  float tm = - b / a; // closest approach to the axis
  float sum = 0.0;
  // frame for the streak noise
  vec3 hh = abs( D.y ) < 0.95 ? vec3( 0.0, 1.0, 0.0 ) : vec3( 1.0, 0.0, 0.0 );
  vec3 U = normalize( cross( D, hh ) );
  vec3 W = cross( D, U );
  float kind = fK.z; // 0 shaft, 1 window beam, 2 lantern cone
  float seed = fC.w;
  vec3 wind = uWind * uTime;
  if ( kind > 1.5 ) {
    // the lantern's cone: a true cone (compact density in r / R(s)), integrated numerically with 6 jittered samples; the streaks are
    // angular noise (a function of the direction from the lantern only), so they fan out from it like light through the cage
    // chord inside the cone itself: a·t² + 2b·t + cc <= ( r(m) + k·vd·t )² with r(m) the radius at the eye's axial position
    float kk = ( fB.w - fA.w ) / L;
    float rm = fA.w + kk * md;
    float A2 = a - kk * kk * vd * vd;
    float B2 = b - kk * vd * rm;
    float C2 = cc - rm * rm;
    float D2 = B2 * B2 - A2 * C2;
    float tc = ta;
    float td = tb;
    if ( A2 > 1e-4 ) {
      if ( D2 <= 0.0 ) discard;
      float sd = sqrt( D2 );
      tc = max( ta, ( - B2 - sd ) / A2 );
      td = min( tb, ( - B2 + sd ) / A2 );
      if ( td <= tc ) discard;
    }
    float dtc = ( td - tc ) / 6.0;
    float jit = 0.5; // no jitter: the density is smooth, a jitter would print its pattern (diagonal hatching) into the streaks
    for ( int i = 0; i < 6; i++ ) {
      float t = tc + dtc * ( float( i ) + jit );
      vec3 lp = C + v * t - A;
      float ls = dot( lp, D );
      float s = ls / L;
      vec3 pr = lp - D * ls;
      float Rc = mix( fA.w, fB.w, clamp( s, 0.0, 1.0 ) );
      float f = max( 1.0 - dot( pr, pr ) / ( Rc * Rc ), 0.0 );
      f *= f;
      float axc = smoothstep( 0.03, 0.2, s ) * ( 1.0 - smoothstep( 0.45, 1.0, s ) ) / ( 1.0 + 3.0 * s );
      vec3 dir = lp / max( length( lp ), 1e-3 );
      vec3 q = vec3( dot( dir, U ), dot( dir, W ), dot( dir, D ) ) * 3.2 + vec3( seed * 0.173, seed * 0.311, uTime * 0.02 );
      float n = texture( uNoise, q ).r;
      float mc = max( 1.0 + fK.y * ( n - 0.5 ) * 1.5, 0.0 );
      sum += f * axc * mc * ( 1.0 - rayFog( t ) ) * dtc;
    }
  } else {
    for ( int i = 0; i < 5; i++ ) {
      if ( float( i ) >= N ) break;
      float t1 = ta + dt * float( i );
      float t2 = t1 + dt;
      float tmid = 0.5 * ( t1 + t2 );
      float s = clamp( ( md + vd * tmid ) / L, 0.0, 1.0 );
      float R = mix( fA.w, fB.w, s );
      // this segment against its own radius
      float dR = b * b - a * ( cc - R * R );
      if ( dR <= 0.0 ) continue;
      float sr = sqrt( dR ) / a;
      float lo = max( t1, tm - sr ) - tm;
      float hi = min( t2, tm + sr ) - tm;
      if ( hi <= lo ) continue;
      float f0 = 1.0 - ( cc - b * b / a ) / ( R * R );
      float k = a / ( R * R );
      // integral of ( f0 - k·tau² )² over [lo, hi]
      float lo2 = lo * lo;
      float hi2 = hi * hi;
      float I = f0 * f0 * ( hi - lo ) - ( 2.0 / 3.0 ) * f0 * k * ( hi2 * hi - lo2 * lo ) + 0.2 * k * k * ( hi2 * hi2 * hi - lo2 * lo2 * lo );
      // axial profile
      float ax_ = kind > 1.5
        ? ( 1.0 / ( 1.0 + s * s * 60.0 ) ) * ( 1.0 - smoothstep( 0.7, 1.0, s ) )
        : ( kind > 0.5 ? ( 0.25 + 0.75 * ( 1.0 - s ) * ( 1.0 - s ) ) : ( 0.12 + 0.88 * ( 1.0 - s ) * ( 1.0 - s ) ) ) * smoothstep( 0.0, 0.06, s ) * ( 1.0 - smoothstep( 0.8, 1.0, s ) );
      // streaks: noise in the beam frame (long along the axis; angular for the lantern cone), drifting
      vec3 p = C + v * clamp( tmid, ta, tb );
      vec3 lp = p - A;
      float ls = dot( lp, D );
      vec3 q;
      if ( kind > 1.5 ) {
        float z = max( ls, 0.35 );
        q = vec3( dot( lp, U ) / z, dot( lp, W ) / z, ls * 0.035 ) * vec3( 1.7, 1.7, 1.0 );
      } else {
        q = vec3( dot( lp, U ) * 0.32, dot( lp, W ) * 0.32, ls * 0.045 );
      }
      q += vec3( seed * 0.173, seed * 0.311, seed * 0.097 ) + wind * ( kind > 1.5 ? 2.0 : 1.0 );
      float n = texture( uNoise, q ).r;
      if ( uOct > 1.5 ) n = 0.62 * n + 0.38 * texture( uNoise, q * 2.7 + vec3( 0.31, 0.17, uTime * 0.01 ) ).r;
      // dust and fog drift: fine grain stays inside a bright core
      float mod_ = max( 1.0 + fK.y * ( n - 0.5 ) * 2.4, 0.0 );
      // fog transmittance to this segment
      float tr = 1.0 - rayFog( tmid );
      sum += I * ax_ * mod_ * tr;
    }
  }
  // phase: light travels along D; the eye looks along v
  float c = dot( D, - v );
  float ph = clamp( hg( c, uG ) / hg( 0.0, uG ), 0.35, 4.5 );
  ph = mix( 1.0, ph, fK.w );
  vec3 col = fC.rgb * ( sum * uGain * uHaze * ph );
  // soft shoulder per channel: bright where it is dense, never a white-out
  col = vec3( 1.0 ) - exp( - col );
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  float lit = max( gl_FragColor.r, max( gl_FragColor.g, gl_FragColor.b ) );
  gl_FragColor.rgb += atDither3( gl_FragCoord.xy ) * ( 1.0 / 255.0 ) * min( 1.0, lit * 24.0 );
  gl_FragColor.rgb = max( gl_FragColor.rgb, vec3( 0.0 ) );
  gl_FragColor.a = 0.0;
}
`;

function hullGeometry() {
  const g = new THREE.InstancedBufferGeometry();
  const pos = [];
  const idx = [];
  for (let i = 0; i < SIDES; i++) {
    const a = (i / SIDES) * Math.PI * 2;
    pos.push(Math.cos(a), Math.sin(a), 0); // ring 0: i
  }
  for (let i = 0; i < SIDES; i++) {
    const a = (i / SIDES) * Math.PI * 2;
    pos.push(Math.cos(a), Math.sin(a), 1); // ring 1: SIDES + i
  }
  pos.push(0, 0, 0, 0, 0, 1); // centres: 2*SIDES, 2*SIDES+1
  const c0 = 2 * SIDES;
  const c1 = c0 + 1;
  for (let i = 0; i < SIDES; i++) {
    const j = (i + 1) % SIDES;
    idx.push(i, j, SIDES + j, i, SIDES + j, SIDES + i); // side, outward
    idx.push(c0, j, i); // cap 0, normal -z
    idx.push(c1, SIDES + i, SIDES + j); // cap 1, normal +z
  }
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return g;
}

const _col = new THREE.Color();
const _v = new THREE.Vector3();

export class GodRays {
  /**
   * @param {THREE.Scene} scene
   * @param {object} lightUniforms FxLighting.uniforms
   * @param {THREE.Data3DTexture} noise
   * @param {object} [halo] LanternHalo: its uniforms drive the folded-in glow, its own mesh hides while the rays draw
   */
  constructor(scene, lightUniforms, noise, halo) {
    this.scene = scene;
    this.halo = halo || null;
    this._lightUniforms = lightUniforms;
    this.materials = null; // the material library (lightShaft shells are hidden while the rays draw)
    this.level = null;
    this.src = []; // beams of the level: { ax, ay, az, bx, by, bz, r0, r1, col, seed, kind, k, phase, strength }
    this.enabled = true;
    this.tierName = 'quest';
    this.gov = 0;
    this.reduced = false;
    this.params = {
      gain: 0.1, // 1/m: optical depth per metre of the densest part of a beam
      g: 0.6, // Henyey-Greenstein anisotropy
      lantern: 0.16, // strength of the lantern cone relative to a shaft
      lanternHalf: 0.62, // rad
      lanternLen: 14,
      streak: 0.75,
      windowLen: 34,
    };
    this.stats = { on: false, instances: 0, shafts: 0, windows: 0, segs: 0, tier: 'quest' };
    this._pick = new Int32Array(MAX_SHAFTS);
    this._pickD = new Float32Array(MAX_SHAFTS);
    this._fwd = new THREE.Vector3(0, 0, -1);
    this._fwdInit = false;
    this._haze = 1;

    const g = hullGeometry();
    this._iA = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this._iB = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this._iC = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    this._iK = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iA', this._iA);
    g.setAttribute('iB', this._iB);
    g.setAttribute('iC', this._iC);
    g.setAttribute('iK', this._iK);
    g.instanceCount = 0;
    this.geometry = g;
    this.uniforms = {
      uNoise: { value: noise },
      uWind: { value: new THREE.Vector3(0.006, -0.012, 0.004) },
      uTime: { value: 0 },
      uSegs: { value: 3 },
      uOct: { value: 1 },
      uGain: { value: this.params.gain },
      uG: { value: this.params.g },
      uHaze: { value: 1 },
      uHull: { value: HULL },
      uFogNF: { value: new THREE.Vector2(2, 60) },
      uFog: { value: new THREE.Color(0x202020) },
      uProbeC: LOOK.uProbeC,
      uProbeH: LOOK.uProbeH,
    };
    const hu = halo ? halo.uniforms : null;
    // the glow's numbers are the halo's (shared uniform objects: LanternHalo.update keeps driving them)
    this.uniforms.uHHalf = hu ? hu.uHalf : { value: 7 };
    this.uniforms.uHGain = hu ? hu.uGain : { value: 0.016 };
    this.uniforms.uHCore = hu ? hu.uCore : { value: 0.5 };
    this.uniforms.uHReach = hu ? hu.uReach : { value: 4 };
    this.uniforms.uHTint = hu ? hu.uTint : { value: 0.5 };
    this.uniforms.uHSharp = hu ? hu.uSharp : { value: 12 };
    this.uniforms.uHCol = hu ? hu.uLanternCol : { value: new THREE.Color(0, 0, 0) };
    const mat = new THREE.ShaderMaterial({
      name: 'at3dGodRays',
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      fog: false,
      side: THREE.DoubleSide,
      forceSinglePass: true,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor, // premultiplied: the rays write alpha 0 (= additive), the glow a little alpha
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.name = 'fxGodRays';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 13; // after the opaque world, the old shells (10) and the fog cards (12): rays and glow sit in front of the haze cards
    scene.add(this.mesh); // visible until the first update (so a precompile pass sees it)
  }

  /** Tier from the lighting tier name ('low' | 'quest' | 'high'), the governor level and reducedEffects. */
  setQuality(name, govLevel, reduced) {
    this.tierName = name === 'high' || name === 'quest' ? name : 'low';
    this.gov = govLevel | 0;
    this.reduced = !!reduced;
  }

  setEnabled(on) {
    this.enabled = !!on;
  }

  // ---------------------------------------------------------------------------
  // Level data → beams
  // ---------------------------------------------------------------------------
  _setLevel(level) {
    this.level = level;
    this.src.length = 0;
    if (!level) return;
    const decor = Array.isArray(level.decor) ? level.decor : [];
    let seed = 1;
    for (const d of decor) {
      if (!d || !/^(shaft-light|lightshaft|light-shaft|beam)$/.test(d.type)) continue;
      const R = Math.max(d.sx || 4, d.sz || 4);
      const h = Math.max(4, d.sy || 30);
      _col.set(typeof d.color === 'string' || typeof d.color === 'number' ? d.color : '#7fb4c8');
      this.src.push({
        ax: d.x, ay: d.y + h / 2, az: d.z, bx: d.x, by: d.y - h / 2, bz: d.z,
        r0: R * 0.22, r1: R * 0.78, r: _col.r, g: _col.g, b: _col.b, seed: seed++, kind: 0, k: 1, strength: 1,
      });
    }
    // window beams: the strong, steady, cool baked lights at a shaft wall (S1 east window, S2 west window): they pour inward and down
    const lights = Array.isArray(level.lights) ? level.lights : [];
    const secs = Array.isArray(level.sections) ? level.sections : [];
    const P = this.params;
    for (const l of lights) {
      if (!l || l.far || l.still || (l.flicker || 0) > 0.01 || l.intensity < 2.4 || l.range < 40) continue;
      _col.set(l.color);
      if (_col.b < _col.r * 1.05) continue; // cool light only
      const si = typeof level.sectionIndexAt === 'function' ? level.sectionIndexAt(l.y) : 0;
      const sh = secs[si] && secs[si].shaft;
      if (!sh) continue;
      // the wall it sits against
      const dW = Math.abs(l.x - sh.minX);
      const dE = Math.abs(l.x - sh.maxX);
      const dN = Math.abs(l.z - sh.minZ);
      const dS = Math.abs(l.z - sh.maxZ);
      const dm = Math.min(dW, dE, dN, dS);
      if (dm > 4) continue;
      let ox = 0;
      let oz = 0; // outward
      if (dm === dW) ox = -1;
      else if (dm === dE) ox = 1;
      else if (dm === dN) oz = -1;
      else oz = 1;
      const out = 1.2;
      const ex = 0.5;
      const dirx = -ox * 0.62;
      const dirz = -oz * 0.62;
      const diry = -0.78;
      const len = P.windowLen;
      const ax = l.x + ox * out;
      const az = l.z + oz * out;
      this.src.push({
        ax, ay: l.y + ex, az, bx: ax + dirx * len, by: l.y + ex + diry * len, bz: az + dirz * len,
        r0: 5.2, r1: 8.5, r: _col.r, g: _col.g, b: _col.b, seed: seed++, kind: 1, k: 1, strength: 0.5,
      });
    }
    this._shaftIdx = [];
    this._winIdx = [];
    for (let i = 0; i < this.src.length; i++) (this.src[i].kind === 0 ? this._shaftIdx : this._winIdx).push(i);
  }

  // ---------------------------------------------------------------------------
  // Per frame
  // ---------------------------------------------------------------------------
  /**
   * @param {number} dt
   * @param {number} time FX clock
   * @param {object} game
   * @param {THREE.Vector3} head world head position
   * @param {number} density Atmosphere.density (0.6..1.2)
   * @param {number} lanternLevel FxLighting.lanternLevel
   * @param {THREE.Color} fog scene fog colour
   * @param {THREE.Camera} camera
   */
  update(dt, time, game, head, density, lanternLevel, fog, camera) {
    const level = (game && game.level) || null;
    if (level !== this.level) this._setLevel(level);
    const T = this._tier();
    const on = this.enabled && T.segs > 0 && !!level;
    this.stats.on = on;
    this.stats.tier = this.tierName;
    if (this.materials && this.materials.lightShaft) this.materials.lightShaft.visible = !on;
    this.mesh.visible = on;
    if (!on) {
      this.geometry.instanceCount = 0;
      this.stats.instances = 0;
      return;
    }
    const U = this.uniforms;
    const P = this.params;
    U.uTime.value = time;
    U.uSegs.value = T.segs;
    U.uOct.value = T.oct;
    U.uG.value = P.g;
    U.uFog.value.copy(fog);
    const f = this.scene.fog;
    if (f) U.uFogNF.value.set(f.near, f.far);
    // thicker air carries stronger rays (0.6 .. 1.2 → 0.75 .. 1.35)
    this._haze += ((0.45 + 0.75 * density) - this._haze) * (1 - Math.exp(-2 * dt));
    U.uHaze.value = this._haze;
    U.uGain.value = P.gain;

    const far = f ? f.far : 60;
    // nearest authored shafts by distance from the head to the beam segment
    const sh = this._shaftIdx;
    let np = 0;
    for (let n = 0; n < MAX_SHAFTS; n++) this._pickD[n] = 1e9;
    for (let k = 0; k < sh.length; k++) {
      const s = this.src[sh[k]];
      const dy = s.by - s.ay;
      const t = THREE.MathUtils.clamp((head.y - s.ay) / (dy || -1), 0, 1);
      const ex = head.x - s.ax;
      const ez = head.z - s.az;
      const ey = head.y - (s.ay + dy * t);
      const R = s.r0 + (s.r1 - s.r0) * t;
      const d = Math.sqrt(ex * ex + ey * ey + ez * ez) - R;
      if (d > far) continue;
      // insertion into the sorted nearest list
      let j = np < MAX_SHAFTS ? np : MAX_SHAFTS - 1;
      if (np >= MAX_SHAFTS && d >= this._pickD[j]) continue;
      while (j > 0 && this._pickD[j - 1] > d) {
        this._pickD[j] = this._pickD[j - 1];
        this._pick[j] = this._pick[j - 1];
        j--;
      }
      this._pickD[j] = d;
      this._pick[j] = sh[k];
      if (np < MAX_SHAFTS) np++;
    }
    let n = 0;
    // the lantern: the glow (the halo's, merged into this draw) and the cone
    if (this.halo) {
      if (lanternLevel > 0.001) n = this._writeHalo(n);
      this.halo.mesh.visible = false;
    }
    if (lanternLevel > 0.001) n = this._writeLantern(n, lanternLevel, camera, dt);
    // window beams in range
    let nw = 0;
    for (const i of this._winIdx) {
      const s = this.src[i];
      const dx = head.x - s.ax;
      const dy = head.y - s.ay;
      const dz = head.z - s.az;
      if (dx * dx + dy * dy + dz * dz > (far + 30) * (far + 30)) continue;
      if (n >= MAX) break;
      this._write(n++, s);
      nw++;
    }
    for (let k = 0; k < np && n < MAX; k++) this._write(n++, this.src[this._pick[k]]);
    this._iA.needsUpdate = this._iB.needsUpdate = this._iC.needsUpdate = this._iK.needsUpdate = true;
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0;
    this.stats.instances = n;
    this.stats.shafts = np;
    this.stats.windows = nw;
    this.stats.segs = T.segs;
  }

  _tier() {
    if (this.reduced || this.tierName === 'low') return TIERS.off; // the frame governor does not thin the rays (this.gov is informational)
    return TIERS[this.tierName] || TIERS.quest;
  }

  _write(i, s) {
    const A = this._iA.array;
    const B = this._iB.array;
    const C = this._iC.array;
    const K = this._iK.array;
    const o = i * 4;
    A[o] = s.ax; A[o + 1] = s.ay; A[o + 2] = s.az; A[o + 3] = s.r0;
    B[o] = s.bx; B[o + 1] = s.by; B[o + 2] = s.bz; B[o + 3] = s.r1;
    const st = s.strength;
    C[o] = s.r * st; C[o + 1] = s.g * st; C[o + 2] = s.b * st; C[o + 3] = s.seed;
    K[o] = 0; K[o + 1] = this.params.streak; K[o + 2] = s.kind; K[o + 3] = 1;
  }

  /** The lantern glow (instance kind 3): only the position matters, the rest comes from the halo's uniforms. */
  _writeHalo(i) {
    const lp = this._lightUniforms.uLanternPos.value;
    const o = i * 4;
    const A = this._iA.array;
    const B = this._iB.array;
    const C = this._iC.array;
    const K = this._iK.array;
    A[o] = B[o] = lp.x;
    A[o + 1] = B[o + 1] = lp.y;
    A[o + 2] = B[o + 2] = lp.z;
    A[o + 3] = B[o + 3] = 1;
    C[o] = C[o + 1] = C[o + 2] = C[o + 3] = 0;
    K[o] = 0; K[o + 1] = 0; K[o + 2] = 3; K[o + 3] = 1;
    return i + 1;
  }

  /** The lantern's cone: apex at the lantern, along the (smoothed) look direction tilted a little down. */
  _writeLantern(i, level, camera, dt) {
    const P = this.params;
    const lp = this._lightUniforms.uLanternPos.value;
    if (camera) {
      camera.getWorldDirection(_v);
      _v.y -= 0.12;
      _v.normalize();
      if (!this._fwdInit) {
        this._fwd.copy(_v);
        this._fwdInit = true;
      } else {
        this._fwd.lerp(_v, 1 - Math.exp(-6 * dt)).normalize();
      }
    }
    const f = this._fwd;
    const L = P.lanternLen;
    const A = this._iA.array;
    const B = this._iB.array;
    const C = this._iC.array;
    const K = this._iK.array;
    const o = i * 4;
    A[o] = lp.x; A[o + 1] = lp.y; A[o + 2] = lp.z; A[o + 3] = 0.12;
    B[o] = lp.x + f.x * L; B[o + 1] = lp.y + f.y * L; B[o + 2] = lp.z + f.z * L; B[o + 3] = L * Math.tan(P.lanternHalf);
    // hue of the shared lantern colour (candela-scaled), brightness by the lantern level
    const lc = this._lightUniforms.uLanternCol.value;
    const mx = Math.max(lc.r, lc.g, lc.b, 1e-4);
    const k = P.lantern * Math.min(1, level);
    C[o] = (lc.r / mx) * k;
    C[o + 1] = (lc.g / mx) * k;
    C[o + 2] = (lc.b / mx) * k;
    C[o + 3] = 3.7;
    K[o] = 0; K[o + 1] = 1.0; K[o + 2] = 2; K[o + 3] = 0.55;
    return i + 1;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.geometry.dispose();
    this.mesh.material.dispose();
    if (this.materials && this.materials.lightShaft) this.materials.lightShaft.visible = true;
  }
}

